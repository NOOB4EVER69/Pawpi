// Vercel serverless backend (replaces Firebase Cloud Functions, so no Blaze plan needed).
const admin = require('firebase-admin');
const crypto = require('crypto');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const fail = (m, c = 400) => Object.assign(new Error(m), { http: c });
const norm = c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (p, c) => crypto.createHmac('sha256', p).update(norm(c)).digest('hex');
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

const actions = {
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
      batch.set(db.doc('tags/' + tagId), { tagId, token, status: 'unclaimed', ownerId: null, petId: null, createdAt: FieldValue.serverTimestamp(), claimedAt: null });
      batch.set(db.doc('tagSecrets/' + tagId), { activationCodeHash: hash(pepper, code) });
      tags.push({ tagId, url: base + '/p/' + token, code });
    }
    await batch.commit();
    return { tags }; // plaintext codes leave the server only here, once
  },

  async getTagStatus(d) {
    const t = d.token;
    if (typeof t !== 'string' || t.length > 32) throw fail('Bad token.');
    const s = await db.collection('tags').where('token', '==', t).limit(1).get();
    if (s.empty) return null;
    const x = s.docs[0].data();
    return { tagId: x.tagId, status: x.status };
  },

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
      tx.set(rl, { n: 0, t: now });
      return { ok: true, tagId: tag.id };
    });
  },

  async revokeTag(d, uid) {
    await needAdmin(uid);
    if (typeof d.tagId !== 'string') throw fail('tagId required.');
    await db.doc('tags/' + d.tagId).update({ status: 'revoked' });
    return { ok: true };
  },
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw fail('POST only.', 405);
    const b = req.body || {};
    const act = Object.hasOwn(actions, b.action) && actions[b.action];
    if (!act) throw fail('Unknown action.');
    let uid = null;
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (t) { try { uid = (await admin.auth().verifyIdToken(t)).uid; } catch { } }
    const base = 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host).replace(/[^\w.:-]/g, '');
    res.status(200).json(await act(b, uid, base));
  } catch (e) {
    console.error(e);
    res.status(e.http || 500).json({ error: e.http ? e.message : 'Server error. Check the Vercel logs.' });
  }
};
