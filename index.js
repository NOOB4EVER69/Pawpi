const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const norm = c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (p, c) => crypto.createHmac('sha256', p).update(norm(c)).digest('hex');
// Hashing key lives in Firestore (meta/pepper, no client access). Created automatically on first use.
const getPepper = async () => {
  const ref = db.doc('meta/pepper');
  let s = await ref.get();
  if (!s.exists) { await ref.create({ v: crypto.randomBytes(32).toString('hex') }).catch(() => { }); s = await ref.get(); }
  return s.data().v;
};
const newCode = () => {
  const s = Array.from({ length: 10 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');
  return s.slice(0, 5) + '-' + s.slice(5);
};
const needAdmin = async req => {
  const uid = req.auth?.uid;
  if (!uid || !(await db.doc('admins/' + uid).get()).exists) throw new HttpsError('permission-denied', 'Admins only.');
};

exports.generateTags = onCall(async req => {
  await needAdmin(req);
  const n = Math.floor(Number(req.data?.count));
  if (!(n >= 1 && n <= 200)) throw new HttpsError('invalid-argument', 'Count must be between 1 and 200.');
  const base = String(req.data?.base || '');
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(base)) throw new HttpsError('invalid-argument', 'Bad site address.');
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
    batch.set(db.doc('tags/' + tagId), {
      tagId, token, status: 'unclaimed', ownerId: null, petId: null,
      createdAt: FieldValue.serverTimestamp(), claimedAt: null,
    });
    batch.set(db.doc('tagSecrets/' + tagId), { activationCodeHash: hash(pepper, code) });
    tags.push({ tagId, url: base + '/p/' + token, code });
  }
  await batch.commit();
  return { tags }; // plaintext codes leave the server only here, once
});

exports.getTagStatus = onCall(async req => {
  const t = req.data?.token;
  if (typeof t !== 'string' || t.length > 32) throw new HttpsError('invalid-argument', 'Bad token.');
  const s = await db.collection('tags').where('token', '==', t).limit(1).get();
  if (s.empty) return null;
  const d = s.docs[0].data();
  return { tagId: d.tagId, status: d.status }; // never owner or code data
});

exports.claimTag = onCall(async req => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { token, code } = req.data || {};
  if (typeof token !== 'string' || typeof code !== 'string' || code.length > 20)
    throw new HttpsError('invalid-argument', 'Missing token or code.');
  const pepper = await getPepper();
  const rl = db.doc('rateLimits/' + uid);
  const q = db.collection('tags').where('token', '==', token).limit(1);
  return db.runTransaction(async tx => {
    const [rs, qs] = await Promise.all([tx.get(rl), tx.get(q)]);
    const now = Date.now();
    let r = rs.exists ? rs.data() : { n: 0, t: now };
    if (now - r.t > 15 * 60 * 1000) r = { n: 0, t: now };
    if (r.n >= 5) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again in 15 minutes.');
    const fail = error => { tx.set(rl, { n: r.n + 1, t: r.t }); return { ok: false, error }; };
    if (qs.empty) return fail('Tag not found.');
    const tag = qs.docs[0];
    const sec = await tx.get(db.doc('tagSecrets/' + tag.id));
    if (tag.data().status !== 'unclaimed') return fail('This tag is already claimed or deactivated.');
    const a = Buffer.from(hash(pepper, code)), b = Buffer.from(sec.data().activationCodeHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('That activation code is not right.');
    tx.update(tag.ref, { status: 'claimed', ownerId: uid, claimedAt: FieldValue.serverTimestamp() });
    tx.set(rl, { n: 0, t: now });
    return { ok: true, tagId: tag.id };
  });
});

exports.revokeTag = onCall(async req => {
  await needAdmin(req);
  const id = req.data?.tagId;
  if (typeof id !== 'string') throw new HttpsError('invalid-argument', 'tagId required.');
  await db.doc('tags/' + id).update({ status: 'revoked' });
  return { ok: true };
});
