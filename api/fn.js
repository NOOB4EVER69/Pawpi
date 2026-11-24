// Vercel serverless backend (replaces Firebase Cloud Functions, so no Blaze plan needed).
// Put this file at  api/fn.js  in your repo.
const admin = require('firebase-admin');
const crypto = require('crypto');
const webpush = require('web-push');
let db, FieldValue;

// Tolerant key loader: copes with stray spaces/line breaks from phone copy-paste.
function init() {
  if (db) return;
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').replace(/\\n/g, '\n');
  if (!raw.trim()) throw fail('FIREBASE_SERVICE_ACCOUNT is empty. Add it in Vercel, then redeploy.', 500);
  const pick = k => ((raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]+)"')) || [])[1] || '').replace(/\s/g, '');
  const body = ((raw.match(/BEGIN PRIVATE KEY([\s\S]*?)END PRIVATE KEY/) || [])[1] || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const projectId = pick('project_id'), clientEmail = pick('client_email');
  if (!projectId || !clientEmail || body.length < 100) throw fail('Key looks incomplete. Paste the whole .json file into FIREBASE_SERVICE_ACCOUNT.', 500);
  const privateKey = '-----BEGIN PRIVATE KEY-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
  try {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    db = admin.firestore();
    FieldValue = admin.firestore.FieldValue;
  } catch (e) { throw fail('Key rejected: ' + e.message, 500); }
}

const SPECIES = ['dog', 'cat', 'rabbit', 'bird', 'hamster', 'horse', 'turtle', 'fish', 'other'];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PHONE_RE = /^\+\d{7,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

const fail = (m, c = 400) => Object.assign(new Error(m), { http: c });
const norm = c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (p, c) => crypto.createHmac('sha256', p).update(norm(c)).digest('hex');
const text = (v, max, label) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length > max) throw fail(label + ' is too long (max ' + max + ' characters).');
  return s;
};
const cleanPhone = v => String(v || '').replace(/[\s().-]/g, '');
const newCode = () => {
  const s = Array.from({ length: 10 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
  return s.slice(0, 5) + '-' + s.slice(5);
};

// Hashing key lives in Firestore (meta/pepper, no client access); created on first use.
const getPepper = async () => {
  const ref = db.doc('meta/pepper');
  let s = await ref.get();
  if (!s.exists) { await ref.create({ v: crypto.randomBytes(32).toString('hex') }).catch(() => { }); s = await ref.get(); }
  return s.data().v;
};
const needAdmin = async uid => {
  if (!uid || !(await db.doc('admins/' + uid).get()).exists) throw fail('Admins only.', 403);
};
// Simple fixed-window limiter. Returns true when the caller is over the limit.
const limited = async (key, max, windowMs) => {
  const ref = db.doc('rateLimits/' + key), now = Date.now();
  const s = await ref.get();
  let r = s.exists ? s.data() : { n: 0, t: now };
  if (now - r.t > windowMs) r = { n: 0, t: now };
  if (r.n >= max) return true;
  await ref.set({ n: r.n + 1, t: r.t });
  return false;
};
// Send a push notification to every device the owner has turned alerts on for.
// Never throws: a failed push must not fail the finder's report.
const notifyOwner = async (ownerId, payload, base) => {
  try {
    const pub = String(process.env.VAPID_PUBLIC || '').trim(), priv = String(process.env.VAPID_PRIVATE || '').trim();
    if (!pub || !priv || !ownerId) return;
    webpush.setVapidDetails(base, pub, priv);
    const s = await db.collection('pushSubs').where('ownerId', '==', ownerId).limit(10).get();
    const body = JSON.stringify(payload);
    await Promise.all(s.docs.map(d => {
      const v = d.data();
      return webpush.sendNotification({ endpoint: v.endpoint, keys: v.keys }, body, { TTL: 86400, urgency: 'high' })
        .catch(e => {
          if (e.statusCode === 404 || e.statusCode === 410) return d.ref.delete(); // device unsubscribed
          console.error('push failed', e.statusCode, e.body);
        });
    }));
  } catch (e) { console.error('notifyOwner', e); }
};
const ownTag = async (tagId, uid) => {
  if (typeof tagId !== 'string' || tagId.length > 20) throw fail('tagId required.');
  const ref = db.doc('tags/' + tagId), s = await ref.get();
  if (!s.exists || s.data().ownerId !== uid || s.data().status !== 'claimed') throw fail('That tag is not yours.', 403);
  return { ref, data: s.data() };
};

const actions = {
  // ---------- admin ----------
  async generateTags(d, uid, base) {
    await needAdmin(uid);
    const n = Math.floor(Number(d.count));
    if (!(n >= 1 && n <= 200)) throw fail('Count must be between 1 and 200.');
    const pepper = await getPepper();
    const counter = db.doc('meta/counters');
    const start = await db.runTransaction(async tx => {
      const s = await tx.get(counter);
      const c = s.exists ? s.data().tags : 0;
      tx.set(counter, { tags: c + n }, { merge: true });
      return c;
    });
    const batch = db.batch(), tags = [];
    for (let i = 1; i <= n; i++) {
      const tagId = 'PWB-' + String(start + i).padStart(6, '0');
      const token = crypto.randomBytes(8).toString('base64url');
      const code = newCode();
      batch.set(db.doc('tags/' + tagId), { tagId, token, status: 'unclaimed', ownerId: null, petId: null, scans: 0, createdAt: FieldValue.serverTimestamp(), claimedAt: null });
      // The plain code is kept (server-only, admins can read it) until the tag is claimed, then deleted.
      batch.set(db.doc('tagSecrets/' + tagId), { activationCodeHash: hash(pepper, code), activationCode: code });
      tags.push({ tagId, url: base + '/p/' + token, code });
    }
    await batch.commit();
    return { tags };
  },

  // Admin only: activation codes of tags that are still unclaimed.
  async getTagCodes(d, uid) {
    await needAdmin(uid);
    const s = await db.collection('tagSecrets').limit(2000).get();
    const codes = {};
    s.docs.forEach(x => { const c = x.data().activationCode; if (c) codes[x.id] = c; });
    return { codes };
  },

  async revokeTag(d, uid) {
    await needAdmin(uid);
    if (typeof d.tagId !== 'string') throw fail('tagId required.');
    await db.doc('tags/' + d.tagId).update({ status: 'revoked' });
    return { ok: true };
  },

  // Undo a revoke: back to claimed if it had an owner, otherwise back to unclaimed.
  async restoreTag(d, uid) {
    await needAdmin(uid);
    if (typeof d.tagId !== 'string') throw fail('tagId required.');
    const ref = db.doc('tags/' + d.tagId), s = await ref.get();
    if (!s.exists) throw fail('Tag not found.', 404);
    if (s.data().status !== 'revoked') throw fail('That tag is not revoked.');
    await ref.update({ status: s.data().ownerId ? 'claimed' : 'unclaimed' });
    return { ok: true };
  },

  // ---------- public (finder) ----------
  async getTagStatus(d, uid) {
    const t = d.token;
    if (typeof t !== 'string' || t.length > 32) throw fail('Bad token.');
    const s = await db.collection('tags').where('token', '==', t).limit(1).get();
    if (s.empty) return null;
    const doc = s.docs[0], x = doc.data();
    const out = { tagId: x.tagId, status: x.status };
    if (x.status === 'claimed' && x.petId) {
      const p = await db.doc('pets/' + x.petId).get();
      if (p.exists) {
        const v = p.data();
        out.pet = {
          name: v.name, species: v.species, phone: v.phone, phone2: v.phone2 || '', email: v.email || '',
          ownerName: v.ownerName || '', breed: v.breed || '', color: v.color || '', age: v.age || '',
          notes: v.notes || '', photo: v.photo || '', lost: !!v.lost, lostMessage: v.lostMessage || '',
        };
      }
      // Count scans by other people (not the owner checking their own tag).
      if (x.ownerId !== uid) {
        await doc.ref.update({ scans: FieldValue.increment(1), lastScanAt: FieldValue.serverTimestamp() }).catch(() => { });
      }
    }
    return out; // owner ID is never exposed
  },

  // Finder taps "I found this pet": saves an optional location + note for the owner.
  async reportFound(d, uid, base, ip) {
    const token = d.token;
    if (typeof token !== 'string' || token.length > 32) throw fail('Bad token.');
    const key = 'f_' + crypto.createHash('sha256').update(ip + '|' + token).digest('hex').slice(0, 28);
    if (await limited(key, 5, 60 * 60 * 1000)) throw fail('Too many reports from this device. Please call the owner instead.', 429);
    const s = await db.collection('tags').where('token', '==', token).limit(1).get();
    if (s.empty) throw fail('Tag not found.', 404);
    const x = s.docs[0].data();
    if (x.status !== 'claimed' || !x.petId) throw fail('This tag is not active.');
    let lat = null, lng = null;
    if (d.lat != null && d.lng != null) {
      lat = Number(d.lat); lng = Number(d.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail('Bad location.');
      lat = Math.round(lat * 1e5) / 1e5; lng = Math.round(lng * 1e5) / 1e5;
    }
    const message = text(d.message, 300, 'Message'), contact = text(d.contact, 60, 'Contact');
    if (lat == null && !message && !contact) throw fail('Share your location or write a short note.');
    const pet = await db.doc('pets/' + x.petId).get();
    const petName = pet.exists ? pet.data().name : '';
    await db.collection('foundReports').add({
      tagId: x.tagId, petId: x.petId, ownerId: x.ownerId, petName,
      lat, lng, message, contact, read: false, createdAt: FieldValue.serverTimestamp(),
    });
    const lost = pet.exists && !!pet.data().lost;
    const bits = [];
    if (message) bits.push(message);
    if (lat != null) bits.push('📍 Location shared');
    if (contact) bits.push('📞 ' + contact);
    await notifyOwner(x.ownerId, {
      title: (lost ? '🚨 ' : '🐾 ') + 'Someone found ' + (petName || 'your pet'),
      body: bits.join(' · ').slice(0, 180) || 'Open Pawbi to see the details.',
      url: '/dashboard', tag: 'found-' + x.tagId, urgent: lost,
    }, base);
    return { ok: true };
  },

  // ---------- owner ----------
  async claimTag(d, uid) {
    if (!uid) throw fail('Sign in first.', 401);
    const { token, code } = d;
    if (typeof token !== 'string' || typeof code !== 'string' || code.length > 20) throw fail('Missing token or code.');
    const pepper = await getPepper();
    const rl = db.doc('rateLimits/' + uid);
    const q = db.collection('tags').where('token', '==', token).limit(1);
    return db.runTransaction(async tx => {
      const [rs, qs] = await Promise.all([tx.get(rl), tx.get(q)]);
      const now = Date.now();
      let r = rs.exists ? rs.data() : { n: 0, t: now };
      if (now - r.t > 15 * 60 * 1000) r = { n: 0, t: now };
      if (r.n >= 5) throw fail('Too many attempts. Try again in 15 minutes.', 429);
      const bad = error => { tx.set(rl, { n: r.n + 1, t: r.t }); return { ok: false, error }; };
      if (qs.empty) return bad('Tag not found.');
      const tag = qs.docs[0];
      const sec = await tx.get(db.doc('tagSecrets/' + tag.id));
      if (tag.data().status !== 'unclaimed') return bad('This tag is already claimed or deactivated.');
      const a = Buffer.from(hash(pepper, code)), b = Buffer.from(sec.data().activationCodeHash);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return bad('That activation code is not right.');
      tx.update(tag.ref, { status: 'claimed', ownerId: uid, claimedAt: FieldValue.serverTimestamp() });
      tx.update(sec.ref, { activationCode: FieldValue.delete() }); // plain code no longer needed
      tx.set(rl, { n: 0, t: now });
      return { ok: true, tagId: tag.id };
    });
  },

  async savePet(d, uid) {
    if (!uid) throw fail('Sign in first.', 401);
    const name = text(d.name, 40, 'Pet name');
    if (!name) throw fail('Pet name is required (max 40 characters).');
    if (!SPECIES.includes(d.species)) throw fail('Pick an animal type.');
    const phone = cleanPhone(d.phone), phone2 = cleanPhone(d.phone2), email = String(d.email || '').trim();
    if (!PHONE_RE.test(phone)) throw fail('Phone must include the country code, like +201001234567.');
    if (phone2 && !PHONE_RE.test(phone2)) throw fail('The backup phone must include the country code, like +201001234567.');
    if (email && !EMAIL_RE.test(email)) throw fail('That email looks wrong.');
    const data = {
      name, species: d.species, phone, phone2, email,
      ownerName: text(d.ownerName, 40, 'Your name'),
      breed: text(d.breed, 40, 'Breed'), color: text(d.color, 40, 'Color'), age: text(d.age, 20, 'Age'),
      notes: String(d.notes ?? '').trim().slice(0, 300),
    };
    if (d.photo !== undefined) {
      const p = String(d.photo || '');
      if (p && (!PHOTO_RE.test(p) || p.length > 200000)) throw fail('That photo is too big. Try a smaller one.');
      data.photo = p;
    }
    const { ref: tagRef } = await ownTag(d.tagId, uid);
    return db.runTransaction(async tx => {
      const t = await tx.get(tagRef);
      if (!t.exists || t.data().ownerId !== uid || t.data().status !== 'claimed') throw fail('That tag is not yours.', 403);
      const petId = t.data().petId || db.collection('pets').doc().id;
      const ref = db.doc('pets/' + petId), old = await tx.get(ref);
      tx.set(ref, { ...data, petId, ownerId: uid, tagId: d.tagId, updatedAt: FieldValue.serverTimestamp(), ...(old.exists ? {} : { createdAt: FieldValue.serverTimestamp(), lost: false }) }, { merge: true });
      if (!t.data().petId) tx.update(tagRef, { petId });
      return { ok: true };
    });
  },

  async setLost(d, uid) {
    if (!uid) throw fail('Sign in first.', 401);
    const { data } = await ownTag(d.tagId, uid);
    if (!data.petId) throw fail('Set up your pet first.');
    const lost = !!d.lost;
    await db.doc('pets/' + data.petId).update({
      lost, lostMessage: lost ? text(d.message, 200, 'Message') : '',
      lostAt: lost ? FieldValue.serverTimestamp() : null, updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  },

  // ---------- push notifications ----------
  async pushKey() {
    const k = String(process.env.VAPID_PUBLIC || '').trim();
    if (!k) throw fail('Alerts are not set up on the server yet.', 503);
    return { key: k };
  },

  async savePush(d, uid) {
    if (!uid) throw fail('Sign in first.', 401);
    const s = d.sub;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000
      || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string'
      || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) throw fail('Bad subscription.');
    const id = crypto.createHash('sha256').update(s.endpoint).digest('hex').slice(0, 40);
    const ref = db.doc('pushSubs/' + id);
    if (!(await ref.get()).exists) {
      const n = (await db.collection('pushSubs').where('ownerId', '==', uid).limit(10).get()).size;
      if (n >= 10) throw fail('Too many devices have alerts on. Turn them off on one first.');
    }
    // Keyed by endpoint: if someone else logs in on this device, it now belongs to them.
    await ref.set({ ownerId: uid, endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  },

  async removePush(d, uid) {
    if (!uid) throw fail('Sign in first.', 401);
    if (typeof d.endpoint !== 'string' || d.endpoint.length > 1000) throw fail('Bad endpoint.');
    const ref = db.doc('pushSubs/' + crypto.createHash('sha256').update(d.endpoint).digest('hex').slice(0, 40));
    const s = await ref.get();
    if (s.exists && s.data().ownerId === uid) await ref.delete();
    return { ok: true };
  },

  async markReportsRead(d, uid) {
    if (!uid) throw fail('Sign in first.', 401);
    const s = await db.collection('foundReports').where('ownerId', '==', uid).where('read', '==', false).limit(200).get();
    if (!s.empty) {
      const batch = db.batch();
      s.docs.forEach(r => batch.update(r.ref, { read: true }));
      await batch.commit();
    }
    return { ok: true };
  },
};

module.exports = async (req, res) => {
  try {
    init();
    if (req.method !== 'POST') throw fail('POST only.', 405);
    const b = req.body || {};
    const act = Object.hasOwn(actions, b.action) && actions[b.action];
    if (!act) throw fail('Unknown action.');
    let uid = null;
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (t) { try { uid = (await admin.auth().verifyIdToken(t)).uid; } catch { } }
    const base = 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host).replace(/[^\w.:-]/g, '');
    const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
    res.status(200).json(await act(b, uid, base, ip));
  } catch (e) {
    console.error(e);
    res.status(e.http || 500).json({ error: e.http ? e.message : 'Server error. Check the Vercel logs.' });
  }
};
          
