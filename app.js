import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword as signIn, createUserWithEmailAndPassword as signUp, signOut, sendPasswordResetEmail as reset, sendEmailVerification as verify } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, query, where, orderBy, limit, getDocs, getDoc, getCountFromServer, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app), fns = getFunctions(app);
const call = n => async d => (await httpsCallable(fns, n)(d)).data;
const $ = (s, r = document) => r.querySelector(s), main = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let user = null, isAdmin = false;

const toast = (m, ok = true) => { const t = document.createElement('div'); t.className = 'toast' + (ok ? '' : ' err'); t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 3500); };
const go = p => { history.pushState({}, '', p); render(); };
const busy = async (btn, f) => { btn.disabled = true; btn.classList.add('spin'); try { await f(); } catch (e) { toast(e.message, false); } finally { btn.disabled = false; btn.classList.remove('spin'); } };
const dl = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
const csv = (name, rows) => dl(URL.createObjectURL(new Blob([rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })), name);
const qr = (el, text, size) => new QRCode(el, { text, width: size, height: size });
const qrPng = (url, id) => { const d = document.createElement('div'); qr(d, url, 512); dl(d.querySelector('canvas').toDataURL(), id + '.png'); };

function nav() {
  $('#nav').innerHTML = `<a data-l href="/" class="brand">🐾 Pawbi</a><nav>${user
    ? `${isAdmin ? '<a data-l href="/admin">Admin</a>' : ''}<a data-l href="/dashboard">Dashboard</a><button class="ghost" id="lo">Log out</button>`
    : '<a data-l href="/login">Log in</a><a data-l class="btn" href="/signup">Get started</a>'}</nav>`;
  $('#lo')?.addEventListener('click', () => signOut(auth).then(() => go('/')));
}

function landing() {
  main.innerHTML = `<section class="hero"><h1>Every Paw Deserves a Way Home.</h1>
  <p>Smart NFC pet tags that help bring lost pets back to the people who love them.</p>
  <div class="row"><a data-l class="btn" href="/signup">Get Your Pawbi</a><a class="btn ghost" href="#how">How It Works</a></div></section>
  <section id="how" class="steps">${['Get your Pawbi tag.', 'Attach it to your pet’s collar.', 'Anyone can scan it to help your pet get home.'].map((t, i) => `<div class="card"><b>Step ${i + 1}</b><p>${t}</p></div>`).join('')}</section>`;
}

function authPage(signup) {
  main.innerHTML = `<form class="card narrow" id="f"><h2>${signup ? 'Create your account' : 'Welcome back'}</h2>
  ${signup ? '<input name="name" placeholder="Your name" required minlength="2">' : ''}
  <input name="email" type="email" placeholder="Email" required>
  <input name="pw" type="password" placeholder="Password (8+ characters)" required minlength="8">
  <button class="btn">${signup ? 'Sign up' : 'Log in'}</button>
  ${signup ? '' : '<a href="#" id="fp">Forgot password?</a>'}
  <a data-l href="${signup ? '/login' : '/signup'}">${signup ? 'Have an account? Log in' : 'New here? Sign up'}</a></form>`;
  $('#f').onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    busy($('#f .btn'), async () => {
      if (signup) {
        const c = await signUp(auth, d.email, d.pw);
        await setDoc(doc(db, 'users', c.user.uid), { name: d.name.trim(), email: d.email, createdAt: serverTimestamp() });
        await verify(c.user);
        toast('Welcome! Check your inbox to verify your email.');
      } else await signIn(auth, d.email, d.pw);
      const n = sessionStorage.getItem('next'); sessionStorage.removeItem('next');
      go(n || '/dashboard');
    });
  };
  $('#fp')?.addEventListener('click', e => {
    e.preventDefault();
    const em = $('[name=email]').value;
    if (!em) return toast('Enter your email first.', false);
    reset(auth, em).then(() => toast('Reset link sent.')).catch(x => toast(x.message, false));
  });
}

async function scan(token) {
  main.innerHTML = '<div class="load">🐾</div>';
  let t = null;
  try { t = await call('getTagStatus')({ token }); } catch { }
  const msg = (h, p) => main.innerHTML = `<div class="card narrow"><h2>${h}</h2><p>${p}</p></div>`;
  if (!t) return msg('Tag not found', 'This link doesn’t match a Pawbi tag.');
  if (t.status === 'revoked') return msg('Tag deactivated', 'This Pawbi tag is no longer in use.');
  if (t.status === 'claimed') return msg('This Pawbi tag is active 🐾', 'Its owner has set it up.');
  if (!user) sessionStorage.setItem('next', location.pathname);
  main.innerHTML = `<div class="card narrow"><h2>Your pet's new identity starts here 🐾</h2><p>Let's connect this tag to your furry friend.</p>
  <span class="pill">${esc(t.tagId)}</span>
  ${user ? '<form id="c" class="card" style="padding:0;box-shadow:none"><input name="code" placeholder="Activation code from the packaging" required autocomplete="off"><button class="btn">Activate tag</button></form>'
      : '<div class="row"><a data-l class="btn" href="/login">Log in</a><a data-l class="btn ghost" href="/signup">Create account</a></div>'}</div>`;
  $('#c')?.addEventListener('submit', e => {
    e.preventDefault();
    busy($('#c .btn'), async () => {
      const r = await call('claimTag')({ token, code: e.target.code.value });
      if (!r.ok) throw new Error(r.error);
      toast('Tag activated! 🎉'); go('/dashboard');
    });
  });
}

async function dash() {
  if (!user) { sessionStorage.setItem('next', '/dashboard'); return go('/login'); }
  main.innerHTML = '<div class="load">🐾</div>';
  const u = (await getDoc(doc(db, 'users', user.uid))).data() || {};
  const s = await getDocs(query(collection(db, 'tags'), where('ownerId', '==', user.uid)));
  main.innerHTML = `<h2>Hey, ${esc(u.name || 'friend')}! Welcome to Pawbi 🐾</h2>
  ${user.emailVerified ? '' : '<p class="note">Please verify your email. We sent a link when you signed up.</p>'}
  <h3>Your tags</h3><div class="grid">${s.docs.map(d => `<div class="card"><b>${esc(d.id)}</b><span class="pill ok">${esc(d.data().status)}</span></div>`).join('') || '<div class="card">No tags yet. Scan the QR code on your Pawbi packaging to activate one.</div>'}</div>`;
}

async function admin() {
  if (!isAdmin) return main.innerHTML = '<div class="card narrow"><h2>Admins only</h2></div>';
  main.innerHTML = '<div class="load">🐾</div>';
  const cnt = async (c, ...w) => (await getCountFromServer(query(collection(db, c), ...w))).data().count;
  const T = s => cnt('tags', where('status', '==', s));
  const [total, un, cl, rv, pets, users] = await Promise.all([cnt('tags'), T('unclaimed'), T('claimed'), T('revoked'), cnt('pets'), cnt('users')]);
  const snap = await getDocs(query(collection(db, 'tags'), orderBy('createdAt', 'desc'), limit(500)));
  const rows = snap.docs.map(d => d.data());
  main.innerHTML = `<h2>Admin</h2>
  <div class="grid">${[['Total tags', total], ['Unclaimed', un], ['Claimed (active)', cl], ['Revoked', rv], ['Pets', pets], ['Customers', users]].map(([k, v]) => `<div class="card"><small>${k}</small><b class="big">${v}</b></div>`).join('')}</div>
  <form id="g" class="card"><div class="row"><label>Tags to generate <input name="n" type="number" min="1" max="200" value="1" style="width:90px"></label><button class="btn">Generate tags</button></div></form>
  <div id="gen"></div>
  <h3>All tags</h3><div class="row"><input id="q" placeholder="Search by tag ID or status"><button class="ghost" id="ex">Export CSV</button></div>
  <div class="wrap"><table><thead><tr><th>Tag</th><th>URL</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase();
    $('#tb').innerHTML = rows.filter(r => (r.tagId + r.status).toLowerCase().includes(q)).map(r => `<tr><td>${esc(r.tagId)}</td><td>/p/${esc(r.token)}</td><td><span class="pill ${r.status === 'claimed' ? 'ok' : ''}">${esc(r.status)}</span></td><td>${r.createdAt?.toDate().toLocaleDateString() || ''}</td><td><button class="ghost" data-qr="${esc(r.tagId)}">QR</button> ${r.status !== 'revoked' ? `<button class="ghost" data-rv="${esc(r.tagId)}">Revoke</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No tags yet. Generate your first batch above.</td></tr>';
  };
  draw();
  $('#q').oninput = draw;
  $('#ex').onclick = () => csv('pawbi-tags.csv', [['Tag ID', 'URL', 'Status', 'Owner ID', 'Created'], ...rows.map(r => [r.tagId, location.origin + '/p/' + r.token, r.status, r.ownerId, r.createdAt?.toDate().toISOString()])]);
  $('#tb').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.qr) { const r = rows.find(x => x.tagId === b.dataset.qr); qrPng(location.origin + '/p/' + r.token, r.tagId); }
    if (b.dataset.rv && confirm('Revoke ' + b.dataset.rv + '? Its link will stop working.')) {
      busy(b, async () => { await call('revokeTag')({ tagId: b.dataset.rv }); toast('Tag revoked.'); admin(); });
    }
  };
  $('#g').onsubmit = e => {
    e.preventDefault();
    busy($('#g .btn'), async () => {
      const { tags } = await call('generateTags')({ count: +e.target.n.value });
      $('#gen').innerHTML = `<div class="card"><p class="note">Activation codes are shown only once. Download the production sheet before leaving this page.</p>
      <div class="row"><button id="ps">Download production sheet</button><button class="ghost" id="pr">Print labels</button></div>
      <div class="labels">${tags.map((t, i) => `<div class="label"><div id="q${i}"></div><b>${t.tagId}</b></div>`).join('')}</div></div>`;
      tags.forEach((t, i) => qr($('#q' + i), t.url, 96));
      $('#ps').onclick = () => csv('pawbi-production-sheet.csv', [['Tag ID', 'NFC URL', 'Activation code'], ...tags.map(t => [t.tagId, t.url, t.code])]);
      $('#pr').onclick = () => print();
      toast(`Generated ${tags.length} tag${tags.length > 1 ? 's' : ''}.`);
    });
  };
}

function render() {
  const p = location.pathname;
  window.scrollTo(0, 0);
  if (p.startsWith('/p/')) return scan(p.split('/')[2]);
  if (p === '/login' || p === '/signup') return authPage(p === '/signup');
  if (p === '/admin') return admin();
  if (p === '/dashboard') return dash();
  landing();
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-l]');
  if (a) { e.preventDefault(); go(a.getAttribute('href')); }
});
addEventListener('popstate', render);
onAuthStateChanged(auth, async u => {
  user = u;
  isAdmin = false;
  if (u) { try { isAdmin = (await getDoc(doc(db, 'admins', u.uid))).exists(); } catch { } }
  nav(); render();
});
