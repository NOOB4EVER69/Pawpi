const G = 'https://www.gstatic.com/firebasejs/10.14.1/';
let onAuthStateChanged, signIn, signUp, signOut, reset, verify, collection, query, where, orderBy, limit, getDocs, getDoc, getCountFromServer, doc, setDoc, serverTimestamp, auth, db, fbP;
const load = () => fbP ||= Promise.all([import(G + 'firebase-app.js'), import(G + 'firebase-auth.js'), import(G + 'firebase-firestore.js'), import('./firebase-config.js')]).then(([a, u, f, c]) => {
  const ap = a.initializeApp(c.firebaseConfig);
  ({ onAuthStateChanged, signOut, signInWithEmailAndPassword: signIn, createUserWithEmailAndPassword: signUp, sendPasswordResetEmail: reset, sendEmailVerification: verify } = u);
  ({ collection, query, where, orderBy, limit, getDocs, getDoc, getCountFromServer, doc, setDoc, serverTimestamp } = f);
  auth = u.getAuth(ap); db = f.getFirestore(ap);
});

/* ---------- Helpers ---------- */
let user = null, isAdmin = false, rid = 0;
const call = n => async d => {
  const t = user ? await user.getIdToken() : '';
  const r = await fetch('/api/fn', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ ...d, action: n }) });
  const j = await r.json().catch(() => ({ error: 'Server error' }));
  if (!r.ok) throw new Error(j.error || 'Server error');
  return j;
};
const $ = (s, r = document) => r.querySelector(s), main = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AUTH = {
  'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'Wrong email or password.',
  'auth/email-already-in-use': 'That email already has an account. Try logging in.', 'auth/weak-password': 'Pick a password with at least 8 characters.',
  'auth/invalid-email': 'That email looks wrong.', 'auth/too-many-requests': 'Too many tries. Wait a moment and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
};
const friendly = e => AUTH[e.code] || e.message || 'Something went wrong.';

const toast = (m, ok = true) => {
  const t = document.createElement('div'); t.className = 'toast' + (ok ? '' : ' err'); t.textContent = m; $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3400);
};
const go = p => { history.pushState({}, '', p); render(); };
const busy = async (btn, f) => {
  if (btn) { btn.disabled = true; btn.classList.add('spin'); }
  try { await f(); } catch (e) { toast(friendly(e), false); } finally { if (btn) { btn.disabled = false; btn.classList.remove('spin'); } }
};
const dl = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
const csv = (name, rows) => dl(URL.createObjectURL(new Blob([rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })), name);
const qr = (el, text, size) => new QRCode(el, { text, width: size, height: size });
let qrP;
const loadQR = () => qrP ||= new Promise((ok, no) => { const e = document.createElement('script'); e.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; e.onload = ok; e.onerror = no; document.head.append(e); });
const qrPng = async (url, id) => { await loadQR(); const d = document.createElement('div'); qr(d, url, 512); setTimeout(() => dl(d.querySelector('canvas').toDataURL(), id + '.png'), 60); };
const copy = async text => { try { await navigator.clipboard.writeText(text); toast('Link copied.'); } catch { toast('Could not copy. Long-press the link instead.', false); } };
const ago = ts => {
  const d = ts?.toDate ? ts.toDate() : null; if (!d) return '';
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString();
};
const countUps = () => document.querySelectorAll('[data-count]').forEach(el => el.textContent = el.dataset.count);
// Bottom sheet / modal. Returns { el, close }.
function sheet(html, dir = 'ltr') {
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" dir="${dir}">${html}</div>`;
  const close = () => { o.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  o.addEventListener('click', e => { if (e.target === o) close(); });
  document.addEventListener('keydown', esc_);
  document.body.append(o);
  o.querySelector('input,textarea,button')?.focus({ preventScroll: true });
  return { el: o, close };
}

/* ---------- Pet data ---------- */
const TYPES = { dog: ['Dog', '🐶', '#FFE3D6'], cat: ['Cat', '🐱', '#FFF0C9'], rabbit: ['Rabbit', '🐰', '#F3E2F5'], bird: ['Bird', '🐦', '#D9EEFB'], hamster: ['Hamster', '🐹', '#FDE7C8'], horse: ['Horse', '🐴', '#EBDCCB'], turtle: ['Turtle', '🐢', '#CDEFD6'], fish: ['Fish', '🐠', '#D3F0F0'], other: ['Other', '🐾', '#EBDFCB'] };
const AR_TYPES = { dog: 'كلب', cat: 'قطة', rabbit: 'أرنب', bird: 'طائر', hamster: 'هامستر', horse: 'حصان', turtle: 'سلحفاة', fish: 'سمكة', other: 'حيوان أليف' };
const avatar = (s, z = 96, photo = '') => {
  const [, e, c] = TYPES[s] || TYPES.other;
  if (photo) return `<img class="avatar" src="${esc(photo)}" alt="" width="${z}" height="${z}" style="width:${z}px;height:${z}px">`;
  return `<div class="avatar" style="width:${z}px;height:${z}px;font-size:${Math.round(z * .55)}px;background:${c}">${e}</div>`;
};

const CODES = [['🇪🇬', '+20'], ['🇸🇦', '+966'], ['🇦🇪', '+971'], ['🇰🇼', '+965'], ['🇶🇦', '+974'], ['🇧🇭', '+973'], ['🇴🇲', '+968'], ['🇯🇴', '+962'], ['🇱🇧', '+961'], ['🇮🇶', '+964'], ['🇸🇾', '+963'], ['🇵🇸', '+970'], ['🇸🇩', '+249'], ['🇱🇾', '+218'], ['🇹🇳', '+216'], ['🇩🇿', '+213'], ['🇲🇦', '+212'], ['🇹🇷', '+90'], ['🇬🇧', '+44'], ['🇺🇸', '+1'], ['🇩🇪', '+49'], ['🇫🇷', '+33'], ['🇮🇳', '+91'], ['🇵🇰', '+92']];
const splitPhone = p => {
  p = String(p || '');
  const m = CODES.map(c => c[1]).filter(c => p.startsWith(c)).sort((a, b) => b.length - a.length)[0];
  return m ? [m, p.slice(m.length)] : ['+20', p.replace(/^\+/, '')];
};
const phoneField = (name, val, req) => {
  const [c, n] = splitPhone(val);
  return `<div class="phone-field"><select name="${name}_c" aria-label="Country code">${CODES.map(([f, k]) => `<option value="${k}"${k === c ? ' selected' : ''}>${f} ${k}</option>`).join('')}</select>
  <input name="${name}" type="tel" inputmode="tel" ${req ? 'required' : ''} value="${esc(n)}" placeholder="100 000 0000" autocomplete="tel-national"></div>`;
};
const readPhone = (f, name) => {
  const v = String(f[name] || '').replace(/[\s().-]/g, '');
  if (!v) return '';
  if (v.startsWith('+')) return v;
  if (v.startsWith('00')) return '+' + v.slice(2);
  return f[name + '_c'] + v.replace(/^0+/, '');
};
// Crop to a centered square and shrink so the photo is small enough to store with the pet.
async function resizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Could not read that image.')); i.src = url; });
    for (const [size, q] of [[480, .82], [400, .7], [320, .6]]) {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      const out = c.toDataURL('image/jpeg', q);
      if (out.length < 150000) return out;
    }
    throw new Error('That photo is too big. Try a different one.');
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Finder page text (English / Arabic) ---------- */
const I18N = {
  en: {
    dir: 'ltr', found: 'If you found me, please contact my owner', lostT: "I'm lost!", lostS: 'Please help me get home.',
    call: 'Call owner', wa: 'WhatsApp owner', call2: 'Call backup number', mail: 'Email owner', report: 'I found this pet', save: 'Save contact',
    notes: 'Good to know', breed: 'Breed', color: 'Color', age: 'Age', owner: 'Owner',
    rt: 'Tell the owner', rs: 'Share where you are so the owner can reach their pet fast.', loc: 'Share my location', locOk: 'Location added',
    msg: 'Short note (optional)', msgP: 'e.g. Safe with me at the café', contact: 'Your phone number (optional)', send: 'Send to owner',
    sent: 'Sent! The owner has been notified. Thank you', noGeo: 'Location is not available on this device.', geoDeny: 'Location was blocked. You can still send a note.',
    waMsg: n => `Hi! I found ${n}`, demo: 'This is only a demo page.', species: k => TYPES[k][0],
  },
  ar: {
    dir: 'rtl', found: 'إذا وجدتني، من فضلك تواصل مع صاحبي', lostT: 'أنا تائه!', lostS: 'ساعدني على العودة إلى البيت.',
    call: 'اتصل بالمالك', wa: 'واتساب المالك', call2: 'اتصل برقم بديل', mail: 'راسل المالك', report: 'لقد وجدت هذا الحيوان', save: 'حفظ جهة الاتصال',
    notes: 'معلومات مهمة', breed: 'السلالة', color: 'اللون', age: 'العمر', owner: 'المالك',
    rt: 'أبلغ المالك', rs: 'شارك مكانك ليصل المالك إلى حيوانه بسرعة.', loc: 'شارك موقعي', locOk: 'تمت إضافة الموقع',
    msg: 'ملاحظة قصيرة (اختياري)', msgP: 'مثال: هو بأمان معي في المقهى', contact: 'رقم هاتفك (اختياري)', send: 'أرسل إلى المالك',
    sent: 'تم الإرسال! تم إبلاغ المالك. شكرًا لك', noGeo: 'الموقع غير متاح على هذا الجهاز.', geoDeny: 'تم حظر الموقع. يمكنك إرسال ملاحظة فقط.',
    waMsg: n => `مرحبًا! وجدت ${n}`, demo: 'هذه صفحة تجريبية فقط.', species: k => AR_TYPES[k],
  },
};
const getLang = () => { try { const l = localStorage.getItem('lang'); if (l) return l; } catch { } return (navigator.language || '').startsWith('ar') ? 'ar' : 'en'; };
const vcard = p => `BEGIN:VCARD\nVERSION:3.0\nFN:${(p.ownerName || 'Owner')} (${p.name}'s owner)\nTEL;TYPE=CELL:${p.phone}\n${p.phone2 ? `TEL;TYPE=CELL:${p.phone2}\n` : ''}${p.email ? `EMAIL:${p.email}\n` : ''}END:VCARD`;

// The public pet card. Used by the real scan page, the demo, and the live preview in the editor.
function finderCard(p, lang = 'en', demo = false) {
  const L = I18N[lang], tel = n => demo ? 'href="#" data-demo' : `href="tel:${esc(n)}"`;
  const chips = [[L.breed, p.breed], [L.color, p.color], [L.age, p.age]].filter(c => c[1]).map(([k, v]) => `<span class="pill">${k}: ${esc(v)}</span>`).join('');
  const wa = demo ? 'href="#" data-demo' : `href="https://wa.me/${esc(String(p.phone).replace(/\D/g, ''))}?text=${encodeURIComponent(L.waMsg(p.name))}" target="_blank" rel="noopener"`;
  const foundBtn = `<button type="button" class="btn dark block" id="rp">📍 ${L.report}</button>`;
  return `<div class="pawcard" dir="${L.dir}">
  ${p.lost ? `<div class="lostbar" role="alert"><b>🚨 ${L.lostT}</b>${esc(p.lostMessage) || L.lostS}</div>` : ''}
  <div class="cover" style="background:${(TYPES[p.species] || TYPES.other)[2]}"></div>
  <div class="body">${avatar(p.species, 128, p.photo)}
    <h1>${esc(p.name)}</h1>
    <div class="chips"><span class="pill">${esc(L.species(TYPES[p.species] ? p.species : 'other'))}</span>${chips}</div>
    ${p.ownerName ? `<small>${L.owner}: ${esc(p.ownerName)}</small>` : ''}
    ${p.notes ? `<div class="infobox"><b>${L.notes}</b>${esc(p.notes)}</div>` : ''}
    <p>${L.found}</p>
    <div class="acts">
      ${p.lost ? foundBtn : ''}
      <a class="btn" ${tel(p.phone)}>📞 ${L.call}</a>
      <a class="btn wa" ${wa}>💬 ${L.wa}</a>
      ${p.phone2 ? `<a class="btn ghost" ${tel(p.phone2)}>${L.call2}</a>` : ''}
      ${p.email ? `<a class="btn ghost" ${demo ? 'href="#" data-demo' : `href="mailto:${esc(p.email)}"`}>${L.mail}</a>` : ''}
      ${p.lost ? '' : foundBtn}
      <button type="button" class="btn soft" id="vc">${L.save}</button>
    </div>
  </div></div>`;
}
const langBar = lang => `<div class="langs"><button class="${lang === 'en' ? 'on' : ''}" data-lang="en">English</button><button class="${lang === 'ar' ? 'on' : ''}" data-lang="ar">العربية</button></div>`;

function showFinder(p, token, demo, tagId) {
  document.body.dataset.page = 'finder';
  const lang = getLang(), L = I18N[lang];
  main.innerHTML = `<div class="view mid">${langBar(lang)}${finderCard(p, lang, demo)}<p class="powered" style="text-align:center">Pawbi · ${esc(tagId || 'demo')}</p></div>`;
  main.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { try { localStorage.setItem('lang', b.dataset.lang); } catch { } showFinder(p, token, demo, tagId); });
  $('#vc').onclick = () => demo ? toast(L.demo, false) : dl(URL.createObjectURL(new Blob([vcard(p)], { type: 'text/vcard' })), p.name + '-owner.vcf');
  $('#rp').onclick = () => reportSheet(token, p, L, demo);
}
function reportSheet(token, p, L, demo) {
  let pos = null;
  const s = sheet(`<h2>${L.rt}</h2><p class="muted">${L.rs}</p>
  <button type="button" class="btn ghost block" id="loc">${L.loc}</button>
  <form class="stack" id="rf"><label>${L.msg}<textarea name="message" maxlength="300" placeholder="${L.msgP}"></textarea></label>
  <label>${L.contact}<input name="contact" type="tel" inputmode="tel" maxlength="60" autocomplete="tel"></label>
  <button class="btn block">${L.send}</button></form>`, L.dir);
  const lb = $('#loc', s.el);
  lb.onclick = () => {
    if (!navigator.geolocation) return toast(L.noGeo, false);
    lb.disabled = true; lb.classList.add('spin');
    navigator.geolocation.getCurrentPosition(
      r => { pos = { lat: r.coords.latitude, lng: r.coords.longitude }; lb.textContent = L.locOk; lb.classList.remove('spin'); lb.disabled = false; },
      () => { toast(L.geoDeny, false); lb.classList.remove('spin'); lb.disabled = false; },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  };
  $('#rf', s.el).onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('.btn', e.target), async () => {
      if (demo) { toast(L.demo, false); return; }
      await call('reportFound')({ token, ...(pos || {}), message: f.message, contact: f.contact });
      s.close(); toast(L.sent);
    });
  };
}

/* ---------- Nav ---------- */
function nav() {
  const b = (h, t, c = 'ghost') => `<a data-l class="btn ${c} sm" href="${h}">${t}</a>`;
  $('#nav').innerHTML = `<a data-l href="/" class="brand"><i>🐾</i>Pawbi</a>${!known ? '' : `<nav>${user
    ? (isAdmin ? b('/admin', 'Admin') : '') + b('/dashboard', 'Dashboard') + b('/settings', 'Settings')
    : b('/login', 'Log in') + b('/signup', 'Sign up', '')}</nav>`}`;
}

/* ---------- Landing ---------- */
const DEMO = { name: 'Luna', species: 'dog', phone: '+201000000000', phone2: '', email: 'owner@example.com', ownerName: 'Sara', breed: 'Golden retriever', color: 'Golden', age: '3 years', notes: 'Friendly, but scared of loud noises. Needs her evening medication.', photo: '', lost: false, lostMessage: '' };

function landing() {
  const feats = [
    ['Works on any phone', 'Tap with NFC or scan the QR code. Nothing to install.'],
    ['One-touch contact', 'Finders can call, WhatsApp or email you from your pet’s page.'],
    ['Location sharing', 'A finder can send you their location. You see it on your dashboard.'],
    ['Lost mode', 'One switch turns your pet’s page into an urgent call for help.'],
    ['English and Arabic', 'Finders read the page in the language they speak.'],
  ];
  const faqs = [
    ['Does the person who finds my pet need an app?', 'No. They tap the tag with their phone or scan the QR code, and your pet’s page opens in their browser.'],
    ['Do I need to charge anything?', 'No. The tag has no battery to charge or replace.'],
    ['What does a finder see?', 'Only what you add: your pet’s name, photo, notes and the contact details you choose. We never ask for your home address.'],
    ['Can I change my phone number later?', 'Yes. Edit your pet’s profile at any time. The change shows up instantly and you don’t need a new tag.'],
    ['Can one tag cover two pets?', 'Each tag is linked to one pet, so get one tag for each pet.'],
  ];
  const go1 = user ? '/dashboard' : '/signup';
  main.innerHTML = `<div class="view">
  <section class="hero"><div class="tag">Smart NFC tags for pets</div><h1>Every paw deserves a way home.</h1>
    <p class="lead">Pawbi is a tag for your pet’s collar. Anyone can tap or scan it, see who to call, and send you their location.</p>
    <div class="row"><a data-l class="btn" href="${go1}">${user ? 'Go to dashboard' : 'Get your Pawbi'}</a><a data-l class="btn ghost" href="/demo">See an example</a></div>
    <div class="peek" aria-hidden="true">${finderCard(DEMO, 'en', true)}</div></section>
  <section class="block"><h2>How it works</h2><ol class="steps">
    <li><b>Activate your tag</b><span class="muted">Tap the tag with your phone, log in, and enter the code from the packaging.</span></li>
    <li><b>Add your pet</b><span class="muted">Add a photo, your phone number and anything a finder should know.</span></li>
    <li><b>Put it on the collar</b><span class="muted">If your pet goes missing, whoever finds them can reach you right away.</span></li></ol></section>
  <section class="block"><h2>What finders can do</h2><ul class="feats">${feats.map(([t, p]) => `<li><b>${t}</b><span class="muted">${p}</span></li>`).join('')}</ul></section>
  <section class="block"><h2>Questions</h2>${faqs.map(([q, a]) => `<details><summary>${q}</summary><div class="ans">${a}</div></details>`).join('')}</section>
  <footer class="foot">Pawbi, made for pets and the people who love them.</footer></div>`;
}

/* ---------- Auth ---------- */
function authPage(signup) {
  main.innerHTML = `<div class="view authwrap"><form class="card narrow" id="f"><div class="face">${signup ? '🐕' : '🐈'}</div><h2>${signup ? 'Create your account' : 'Welcome back'}</h2>
  <p class="muted" style="text-align:center">${signup ? 'It takes less than a minute.' : 'Log in to manage your pets.'}</p>
  ${signup ? '<label>Your name<input name="name" placeholder="Sara" required minlength="2" autocomplete="name"></label>' : ''}
  <label>Email<input name="email" type="email" placeholder="you@email.com" required autocomplete="email"></label>
  <label>Password<div class="pw"><input name="pw" type="password" placeholder="8+ characters" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}"><button type="button" class="ghost" id="sp">Show</button></div></label>
  <button class="btn">${signup ? 'Create account' : 'Log in'}</button>
  ${signup ? '' : '<a href="#" class="link" id="fp">Forgot password?</a>'}
  <a data-l class="link" href="${signup ? '/login' : '/signup'}">${signup ? 'Have an account? Log in' : 'New here? Create an account'}</a></form></div>`;
  $('#sp').onclick = e => { const i = $('[name=pw]'); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
  $('#f').onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    busy($('#f .btn'), async () => {
      await startAuth();
      if (signup) {
        const c = await signUp(auth, d.email, d.pw);
        await setDoc(doc(db, 'users', c.user.uid), { name: d.name.trim(), email: d.email, createdAt: serverTimestamp() });
        await verify(c.user).catch(() => { });
        toast('Welcome to Pawbi! Check your inbox to verify your email.');
      } else await signIn(auth, d.email, d.pw);
      const n = sessionStorage.getItem('next'); sessionStorage.removeItem('next');
      go(n || '/dashboard');
    });
  };
  $('#fp')?.addEventListener('click', e => {
    e.preventDefault();
    const em = $('[name=email]').value;
    if (!em) return toast('Enter your email first.', false);
    startAuth().then(() => reset(auth, em)).then(() => toast('Reset link sent. Check your inbox.')).catch(x => toast(friendly(x), false));
  });
}

/* ---------- Scan page (public) ---------- */
async function scan(token) {
  const my = ++rid;
  main.innerHTML = '<div class="load">🐾</div>';
  let t = null;
  try { t = await call('getTagStatus')({ token }); } catch { }
  if (my !== rid) return;
  const msg = (e, h, p) => main.innerHTML = `<div class="view card narrow empty"><div class="big-emoji">${e}</div><h2>${h}</h2><p class="muted">${p}</p><a data-l class="btn ghost" href="/">Go to Pawbi</a></div>`;
  if (!t) return msg('', 'Tag not found', 'This link doesn’t match a Pawbi tag.');
  if (t.status === 'revoked') return msg('', 'Tag deactivated', 'This Pawbi tag is no longer in use.');
  if (t.status === 'claimed') return t.pet ? showFinder(t.pet, token, false, t.tagId) : msg('', 'This Pawbi tag is active', 'Its owner is still setting up the pet profile.');
  await startAuth(); if (my !== rid) return;
  if (!user) sessionStorage.setItem('next', location.pathname);
  main.innerHTML = `<div class="view card narrow"><div class="face">🎁</div><h2 style="text-align:center">Your pet’s new identity starts here</h2><p class="muted" style="text-align:center">Let’s connect this tag to your furry friend.</p>
  <div style="text-align:center"><span class="pill">${esc(t.tagId)}</span></div>
  ${user ? '<form id="c" class="stack"><label>Activation code<input name="code" placeholder="XXXXX-XXXXX" required autocomplete="off" autocapitalize="characters" maxlength="11" style="text-align:center;letter-spacing:.14em;font-weight:800"></label><span class="hint">You’ll find it on the packaging.</span><button class="btn">Activate tag</button></form>'
      : '<div class="stack"><a data-l class="btn" href="/signup">Create account</a><a data-l class="btn ghost" href="/login">I already have an account</a></div>'}</div>`;
  $('#c [name=code]')?.addEventListener('input', e => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    e.target.value = v.length > 5 ? v.slice(0, 5) + '-' + v.slice(5) : v;
  });
  $('#c')?.addEventListener('submit', e => {
    e.preventDefault();
    busy($('#c .btn'), async () => {
      const r = await call('claimTag')({ token, code: e.target.code.value });
      if (!r.ok) throw new Error(r.error);
      toast('Tag activated!'); go('/pet/' + r.tagId);
    });
  });
}

/* ---------- Dashboard ---------- */
const myPets = async () => Object.fromEntries((await getDocs(query(collection(db, 'pets'), where('ownerId', '==', user.uid)))).docs.map(d => [d.data().tagId, d.data()]));
const reportRow = r => `<div class="report"><div style="flex:1;min-width:0"><b>${esc(r.petName || 'Your pet')}</b> ${r.read === false ? '<span class="pill bad">New</span>' : ''}
  <div class="hint">${ago(r.createdAt)}</div>${r.message ? `<p>${esc(r.message)}</p>` : ''}${r.contact ? `<p><a href="tel:${esc(r.contact)}">${esc(r.contact)}</a></p>` : ''}
  ${r.lat != null ? `<a class="btn sm soft" style="margin-top:6px" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${Number(r.lat)},${Number(r.lng)}">Open in Maps</a>` : ''}</div></div>`;

async function dash() {
  if (!user) { sessionStorage.setItem('next', '/dashboard'); return go('/login'); }
  const my = ++rid;
  main.innerHTML = '<div class="view"><div class="grid"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div></div>';
  const [uSnap, tSnap, pets, rSnap] = await Promise.all([
    getDoc(doc(db, 'users', user.uid)), getDocs(query(collection(db, 'tags'), where('ownerId', '==', user.uid))), myPets(),
    getDocs(query(collection(db, 'foundReports'), where('ownerId', '==', user.uid), limit(50))).catch(() => ({ docs: [] })),
  ]);
  if (my !== rid) return;
  const u = uSnap.data() || {};
  const tags = tSnap.docs.map(d => d.data()).sort((a, b) => (b.claimedAt?.seconds || 0) - (a.claimedAt?.seconds || 0));
  const reports = rSnap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const unread = reports.filter(r => r.read === false).length, scans = tags.reduce((s, t) => s + (t.scans || 0), 0), lostN = Object.values(pets).filter(p => p.lost).length;
  main.innerHTML = `<div class="view stack" style="gap:20px">
  <div class="dh"><h2>Hey, ${esc(u.name || 'friend')} 👋</h2><p class="muted">${tags.length ? 'Here’s how your pets are doing.' : 'Let’s get your first tag set up.'}</p></div>
  ${user.emailVerified ? '' : '<div class="note warn row between"><span>Please verify your email. We sent a link when you signed up.</span><button class="btn sm ghost" id="rv">Resend</button></div>'}
  ${tags.length ? `<div class="grid stats">
    <div class="card stat"><small>Pets</small><b class="big" data-count="${tags.length}">0</b></div>
    <div class="card stat"><small>Tag scans</small><b class="big" data-count="${scans}">0</b></div>
    <div class="card stat"><small>Found alerts</small><b class="big" data-count="${reports.length}">0</b></div>
    <div class="card stat"><small>In lost mode</small><b class="big" data-count="${lostN}">0</b></div></div>` : ''}
  ${reports.length ? `<div class="card ${unread ? 'alertcard' : ''}"><div class="row between"><h3>${unread ? `${unread} new found alert${unread > 1 ? 's' : ''}` : 'Found alerts'}</h3></div>${reports.slice(0, 5).map(reportRow).join('')}</div>` : ''}
  <h3>Your pets</h3>
  <div class="grid stagger">${tags.map((t, i) => {
    const p = pets[t.tagId];
    return `<div class="card pcard ${p?.lost ? 'is-lost' : ''}" style="--i:${i}"><div class="cover" style="background:${TYPES[p ? p.species : 'other']?.[2] || TYPES.other[2]}"></div><div class="inner">${avatar(p ? p.species : 'other', 88, p?.photo)}<h3>${p ? esc(p.name) : 'New tag'}</h3>
    <div class="row" style="justify-content:center"><span class="pill ok">${esc(t.tagId)}</span>${p?.lost ? '<span class="pill bad">Lost mode</span>' : ''}</div>
    <div class="meta"><span>${t.scans || 0} scan${t.scans === 1 ? '' : 's'}</span>${t.lastScanAt ? `<span>Last: ${ago(t.lastScanAt)}</span>` : ''}</div>
    ${p ? `<label class="lostrow" for="l${i}"><span>Mark as lost</span><span class="sw"><input type="checkbox" id="l${i}" data-lost="${esc(t.tagId)}" ${p.lost ? 'checked' : ''}><span></span></span></label>` : ''}
    <div class="btns"><a data-l class="btn ${p ? 'soft' : ''} ${p ? '' : 'full'}" href="/pet/${esc(t.tagId)}">${p ? 'Edit' : 'Set up pet'}</a>
    ${p ? `<a class="btn soft" href="/p/${esc(t.token)}" target="_blank">View</a><button class="btn ghost sm" data-qr="${esc(t.tagId)}" data-tok="${esc(t.token)}">QR code</button><button class="btn ghost sm" data-cp="${esc(t.token)}">Copy link</button>` : ''}</div></div></div>`;
  }).join('') || `<div class="card empty" style="grid-column:1/-1"><div class="big-emoji">🐶</div><h3>No tags yet</h3><p class="muted">Tap your Pawbi tag with your phone, or scan the QR code on the packaging, to activate it.</p></div>`}</div></div>`;
  countUps();
  $('#rv')?.addEventListener('click', e => busy(e.target, async () => { await verify(user); toast('Verification email sent.'); }));
  if (unread) call('markReportsRead')({}).catch(() => { });
  main.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.qr) qrPng(location.origin + '/p/' + b.dataset.tok, b.dataset.qr);
    if (b.dataset.cp) copy(location.origin + '/p/' + b.dataset.cp);
  };
  main.onchange = e => {
    const sw = e.target.closest('[data-lost]'); if (!sw) return;
    const tagId = sw.dataset.lost, lost = sw.checked;
    if (!lost) {
      busy(null, async () => {
        try { await call('setLost')({ tagId, lost: false }); } catch (x) { sw.checked = true; throw x; }
        toast('Welcome home! Lost mode is off.'); dash();
      });
      return;
    }
    const s = sheet(`<h2>Mark as lost</h2><p class="muted">Their page will show a red alert. Add a message for whoever finds them.</p>
      <form class="stack" id="lf"><label>Message (optional)<textarea name="m" maxlength="200" placeholder="e.g. Last seen near the park. Reward offered."></textarea></label>
      <button class="btn danger block">Turn on lost mode</button><button type="button" class="btn ghost block" id="lc">Cancel</button></form>`);
    const cancel = () => { sw.checked = false; s.close(); };
    $('#lc', s.el).onclick = cancel;
    s.el.addEventListener('click', e2 => { if (e2.target === s.el) sw.checked = false; });
    $('#lf', s.el).onsubmit = e2 => {
      e2.preventDefault();
      busy($('.danger', s.el), async () => { await call('setLost')({ tagId, lost: true, message: e2.target.m.value }); s.close(); toast('Lost mode is on. Stay hopeful'); dash(); });
    };
  };
}

/* ---------- Pet editor ---------- */
async function petForm(tagId) {
  if (!user) { sessionStorage.setItem('next', location.pathname); return go('/login'); }
  const my = ++rid;
  main.innerHTML = '<div class="load">🐾</div>';
  const [pets, uSnap] = await Promise.all([myPets(), getDoc(doc(db, 'users', user.uid))]);
  if (my !== rid) return;
  const u = uSnap.data() || {}, pe = pets[tagId] || {}, isNew = !pe.name, sel = pe.species || 'dog';
  let photo = pe.photo || '', photoChanged = false;
  main.innerHTML = `<div class="view editor"><form id="pf" class="card"><h2>${isNew ? 'Add your pet' : 'Edit your pet'}</h2><div><span class="pill">${esc(tagId)}</span></div>
  <div class="stack" style="align-items:center"><button type="button" class="photo" id="ph" aria-label="Choose a photo"></button><input type="file" id="pi" accept="image/*" hidden>
    <button type="button" class="btn sm ghost" id="pr" ${photo ? '' : 'hidden'}>Remove photo</button></div>
  <label>Pet name<input name="name" required maxlength="40" value="${esc(pe.name)}" placeholder="Luna" autocomplete="off"></label>
  <div><div class="sect" style="margin-bottom:8px">Animal type</div><div class="types">${Object.entries(TYPES).map(([k, [l, e, c]]) => `<label class="type"><input type="radio" name="species" value="${k}" ${k === sel ? 'checked' : ''}><span style="background:${c}">${e}<small>${l}</small></span></label>`).join('')}</div></div>
  <div class="two"><label>Breed<input name="breed" maxlength="40" value="${esc(pe.breed)}" placeholder="Golden retriever"></label><label>Color<input name="color" maxlength="40" value="${esc(pe.color)}" placeholder="Golden"></label></div>
  <label>Age<input name="age" maxlength="20" value="${esc(pe.age)}" placeholder="3 years"></label>
  <div class="sect">How finders reach you</div>
  <label>Your name<input name="ownerName" maxlength="40" value="${esc(pe.ownerName ?? u.name)}" autocomplete="name"></label>
  <label>Phone<span class="hint">Pick your country. You can type the number the way you normally dial it.</span>${phoneField('phone', pe.phone || u.phone, true)}</label>
  <label>Backup phone (optional)${phoneField('phone2', pe.phone2)}</label>
  <label>Email (optional)<input name="email" type="email" value="${esc(pe.email ?? u.email ?? user.email)}" placeholder="you@email.com"></label>
  <label>Good to know (optional)<textarea name="notes" maxlength="300" placeholder="Medication, allergies, nervous around strangers…">${esc(pe.notes)}</textarea></label>
  <p class="hint warn">Everything on this page is shown to anyone who scans the tag.</p>
  <button class="btn">Save</button>
  ${isNew ? '' : '<a data-l class="btn ghost" href="/dashboard">Back to dashboard</a>'}</form></div>`;
  const form = $('#pf');
  const values = () => {
    const f = Object.fromEntries(new FormData(form));
    return { name: f.name || 'Your pet', species: f.species, breed: f.breed, color: f.color, age: f.age, ownerName: f.ownerName, notes: f.notes, phone: readPhone(f, 'phone') || '+20000000000', phone2: readPhone(f, 'phone2'), email: f.email, photo, lost: !!pe.lost, lostMessage: pe.lostMessage };
  };
  const drawPhoto = () => {
    $('#ph').innerHTML = photo ? `<img src="${esc(photo)}" alt="">` : 'Add photo';
    $('#pr').hidden = !photo;
  };
  const preview = () => {};
  drawPhoto(); preview();
  form.addEventListener('input', () => { if (!photo) drawPhoto(); preview(); });
  $('#ph').onclick = () => $('#pi').click();
  $('#pr').onclick = () => { photo = ''; photoChanged = true; drawPhoto(); preview(); };
  $('#pi').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { photo = await resizePhoto(file); photoChanged = true; drawPhoto(); preview(); } catch (x) { toast(x.message, false); }
    e.target.value = '';
  };
  form.onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const payload = { tagId, name: f.name, species: f.species, breed: f.breed, color: f.color, age: f.age, ownerName: f.ownerName, notes: f.notes, email: f.email, phone: readPhone(f, 'phone'), phone2: readPhone(f, 'phone2') };
    if (photoChanged) payload.photo = photo;
    busy($('#pf .btn'), async () => { await call('savePet')(payload); toast('Saved!'); go('/dashboard'); });
  };
}

/* ---------- Settings ---------- */
async function settings() {
  if (!user) { sessionStorage.setItem('next', '/settings'); return go('/login'); }
  const my = ++rid;
  const u = (await getDoc(doc(db, 'users', user.uid))).data() || {};
  if (my !== rid) return;
  main.innerHTML = `<div class="view stack" style="max-width:440px;margin:24px auto"><h2>Your account</h2>
  <form id="sf" class="card"><label>Name<input name="name" required minlength="2" maxlength="60" value="${esc(u.name)}"></label>
  <label>Phone (used to pre-fill new pets)${phoneField('phone', u.phone)}</label>
  <label>Email<input value="${esc(user.email)}" disabled></label><button class="btn">Save changes</button></form>
  <div class="card"><h3>Security</h3><button class="btn ghost" id="pw">Email me a password reset link</button>
  ${user.emailVerified ? '<span class="pill ok">Email verified</span>' : '<button class="btn ghost" id="rv">Resend verification email</button>'}</div>
  <button class="btn dark" id="lo">Log out</button></div>`;
  $('#sf').onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('#sf .btn'), async () => { await setDoc(doc(db, 'users', user.uid), { name: f.name.trim(), phone: readPhone(f, 'phone') }, { merge: true }); toast('Saved.'); });
  };
  $('#pw').onclick = e => busy(e.currentTarget, async () => { await reset(auth, user.email); toast('Reset link sent. Check your inbox.'); });
  $('#rv')?.addEventListener('click', e => busy(e.currentTarget, async () => { await verify(user); toast('Verification email sent.'); }));
  $('#lo').onclick = () => signOut(auth).then(() => go('/'));
}

/* ---------- Admin ---------- */
async function admin() {
  if (!isAdmin) return main.innerHTML = '<div class="view card narrow empty"><div class="big-emoji">🔒</div><h2>Admins only</h2></div>';
  const my = ++rid;
  main.innerHTML = `<div class="view stack" style="gap:18px"><h2>Admin</h2><div class="grid stats" id="st">${'<div class="sk" style="min-height:92px"></div>'.repeat(8)}</div>
  <form id="g" class="card"><h3>Generate tags</h3><div class="row"><label style="flex:0 0 120px">How many<input name="n" type="number" min="1" max="200" value="1"></label><button class="btn" style="align-self:flex-end">Generate</button></div></form>
  <div id="gen"></div>
  <div class="row between"><h3>All tags</h3><button class="btn ghost sm" id="ex">Export CSV</button></div>
  <input id="q" placeholder="Search by tag ID…"><div class="chipbar" id="cb">${['all', 'unclaimed', 'claimed', 'revoked'].map(s => `<button class="${s === 'all' ? 'on' : ''}" data-s="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
  <div class="wrap"><table><thead><tr><th>Tag</th><th>Status</th><th>Scans</th><th>Created</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  let rows = [], filter = 'all';
  const cnt = async (c, ...w) => (await getCountFromServer(query(collection(db, c), ...w))).data().count;
  const draw = () => {
    const q = $('#q').value.toLowerCase();
    $('#tb').innerHTML = rows.filter(r => (filter === 'all' || r.status === filter) && r.tagId.toLowerCase().includes(q)).map(r => `<tr><td><b>${esc(r.tagId)}</b></td><td><span class="pill ${r.status === 'claimed' ? 'ok' : r.status === 'revoked' ? 'bad' : ''}">${esc(r.status)}</span></td><td>${r.scans || 0}</td><td>${r.createdAt?.toDate().toLocaleDateString() || ''}</td>
      <td><button class="btn ghost sm" data-qr="${esc(r.tagId)}">QR</button> <button class="btn ghost sm" data-cp="${esc(r.token)}">Copy link</button> ${r.status === 'revoked' ? `<button class="btn ghost sm" data-rs="${esc(r.tagId)}">Restore</button>` : `<button class="btn ghost sm" data-rv="${esc(r.tagId)}">Revoke</button>`}</td></tr>`).join('') || '<tr><td colspan="5">No tags match. Generate a batch above.</td></tr>';
  };
  const refresh = async () => {
    const T = s => cnt('tags', where('status', '==', s));
    const [total, un, cl, rv, pets, users, fr] = await Promise.all([cnt('tags'), T('unclaimed'), T('claimed'), T('revoked'), cnt('pets'), cnt('users'), cnt('foundReports').catch(() => 0)]);
    const snap = await getDocs(query(collection(db, 'tags'), orderBy('createdAt', 'desc'), limit(500)));
    if (my !== rid) return;
    rows = snap.docs.map(d => d.data());
    const scans = rows.reduce((s, r) => s + (r.scans || 0), 0);
    $('#st').innerHTML = [['Total tags', total], ['Unclaimed', un], ['Claimed', cl], ['Revoked', rv], ['Pets', pets], ['Customers', users], ['Scans', scans], ['Found alerts', fr]].map(([k, v]) => `<div class="card stat"><small>${k}</small><b class="big" data-count="${v}">0</b></div>`).join('');
    countUps(); draw();
  };
  await refresh();
  $('#q').oninput = draw;
  $('#cb').onclick = e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.s; $('#cb').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  $('#ex').onclick = () => csv('pawbi-tags.csv', [['Tag ID', 'URL', 'Status', 'Owner ID', 'Scans', 'Created'], ...rows.map(r => [r.tagId, location.origin + '/p/' + r.token, r.status, r.ownerId, r.scans || 0, r.createdAt?.toDate().toISOString()])]);
  $('#tb').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.qr) { const r = rows.find(x => x.tagId === b.dataset.qr); qrPng(location.origin + '/p/' + r.token, r.tagId); }
    if (b.dataset.cp) copy(location.origin + '/p/' + b.dataset.cp);
    if (b.dataset.rv && confirm('Revoke ' + b.dataset.rv + '? Its link will stop working.')) busy(b, async () => { await call('revokeTag')({ tagId: b.dataset.rv }); toast('Tag revoked.'); await refresh(); });
    if (b.dataset.rs) busy(b, async () => { await call('restoreTag')({ tagId: b.dataset.rs }); toast('Tag restored.'); await refresh(); });
  };
  $('#g').onsubmit = e => {
    e.preventDefault();
    busy($('#g .btn'), async () => {
      const { tags } = await call('generateTags')({ count: +e.target.n.value, base: location.origin });
      $('#gen').innerHTML = `<div class="card"><p class="note warn">Activation codes are shown only once. Download the production sheet before leaving this page.</p>
      <div class="row"><button class="btn" id="ps">Download production sheet</button><button class="btn ghost" id="pr">Print labels</button></div>
      <div class="labels">${tags.map((t, i) => `<div class="label"><div id="q${i}"></div><b>${t.tagId}</b></div>`).join('')}</div></div>`;
      await loadQR();
      tags.forEach((t, i) => qr($('#q' + i), t.url, 96));
      $('#ps').onclick = () => csv('pawbi-production-sheet.csv', [['Tag ID', 'NFC URL', 'Activation code'], ...tags.map(t => [t.tagId, t.url, t.code])]);
      $('#pr').onclick = () => print();
      toast(`Generated ${tags.length} tag${tags.length > 1 ? 's' : ''}.`);
      await refresh();
    });
  };
}

/* ---------- Router ---------- */
function render() {
  const p = location.pathname.replace(/\/+$/, '') || '/', seg = decodeURIComponent(p.split('/')[2] || '');
  window.scrollTo(0, 0);
  delete document.body.dataset.page;
  main.onclick = main.onchange = null; // views attach their own handlers; drop the previous view's
  const priv = f => guard(async () => { await startAuth(); return f(); });
  const guard = f => Promise.resolve().then(f).catch(e => {
    console.error(e);
    main.innerHTML = '<div class="view card narrow empty"><div class="big-emoji">😿</div><h2>Something went wrong</h2><p class="muted">Check your connection and try again.</p><button class="btn" onclick="location.reload()">Reload</button></div>';
  });
  if (p === '/') { rid++; return landing(); }
  if (p === '/demo') { rid++; return showFinder(DEMO, '', true, 'demo'); }
  if (p === '/login' || p === '/signup') { rid++; return authPage(p === '/signup'); }
  if (p.startsWith('/p/')) return guard(() => scan(seg));
  if (p.startsWith('/pet/')) return priv(() => petForm(seg));
  if (p === '/dashboard') return priv(dash);
  if (p === '/settings') return priv(settings);
  if (p === '/admin') return priv(admin);
  rid++;
  main.innerHTML = '<div class="view card narrow empty"><div class="big-emoji">🐾</div><h2>Page not found</h2><p class="muted">This page wandered off.</p><a data-l class="btn" href="/">Back home</a></div>';
}

/* ---------- Global events ---------- */
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-l]');
  if (a) { e.preventDefault(); go(a.getAttribute('href')); return; }
  const h = e.target.closest('a[href^="#"]');
  if (h) {
    e.preventDefault();
    if (h.hasAttribute('data-demo')) return toast(I18N[getLang()].demo, false);
    const id = h.getAttribute('href').slice(1); if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
});
addEventListener('popstate', render);
let known = false, first = true, authP;
const startAuth = () => authP ||= load().then(() => new Promise(ok => onAuthStateChanged(auth, async u => {
  user = u; isAdmin = false;
  if (u) { try { isAdmin = (await getDoc(doc(db, 'admins', u.uid))).exists(); } catch { } }
  known = true; nav();
  if (first) { first = false; ok(); if (user && location.pathname === '/') render(); } else render();
})));
nav(); render();
{ const p = location.pathname; if (!p.startsWith('/p/') && p !== '/demo') (self.requestIdleCallback || setTimeout)(() => startAuth().catch(() => { })); }
