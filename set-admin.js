// Usage: GOOGLE_APPLICATION_CREDENTIALS=key.json node set-admin.js owner@email.com
const admin = require('firebase-admin');
admin.initializeApp();
(async () => {
  const u = await admin.auth().getUserByEmail(process.argv[2]);
  await admin.auth().setCustomUserClaims(u.uid, { admin: true });
  console.log('Admin role set for', u.email, '- sign out and back in.');
})().catch(e => { console.error(e.message); process.exit(1); });
