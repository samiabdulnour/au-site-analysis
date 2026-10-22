/* Site Analyst UI.
   State lives in one object; the options are plain buttons that write into it,
   which avoids native <select> chrome in a page that is otherwise all text. */

const state = { sheet: 'context', scale: '3000', rotate: 'north', template: 'flamingo' };

// [value, label, caption] — the caption is that option's words in the
// sentence that describes the expected result to a screen reader.
// The yield took the summary's place; the deck is offered as the site report.
const SHEETS = [
  ['context', 'context',     'Context analysis on A1'],
  ['site',    'site',        'Site analysis on A1'],
  ['yield',   'yield',       'Planning yield on A1: the controls, the envelope, the floor area, apartments and parking'],
  ['slides',  'site report', 'Site report on A3, its pages shown in turn'],
];
const SCALES = {
  context: [
    ['2000', '2000', 'at 1:2000'],
    ['3000', '3000', 'at 1:3000'],
    ['4000', '4000', 'at 1:4000'],
    ['5000', '5000', 'at 1:5000'],
  ],
  site: [
    ['0',    'auto', 'at the tightest scale that fits the lot'],
    ['250',  '250',  'at 1:250'],
    ['500',  '500',  'at 1:500'],
    ['1000', '1000', 'at 1:1000'],
  ],
  yield: [],
  slides: [],
};
// The styles each drawing takes: the context sheet has its templates, the site
// analysis its own themes, and the yield and the site report none. An unknown one
// falls back to the drawing's default on the server. The two maps share their
// style names, so the site's are in the context's order: a style keeps its column.
const STYLES = {
  context: [
    ['flamingo',   'flamingo',   'in Flamingo'],
    ['kingfisher', 'kingfisher', 'in Kingfisher'],
    ['heron',      'heron',      'in Heron'],
    ['canary',     'canary',     'in Canary'],
  ],
  site: [
    ['flamingo',   'flamingo',   'in Flamingo'],
    ['kingfisher', 'kingfisher', 'in Kingfisher'],
    ['heron',      'heron',      'in Heron'],
    ['canary',     'canary',     'in Canary'],
  ],
  yield: [],
  slides: [],
};
const NORTH = [
  ['north', 'up',    'north up'],
  ['auto',  'align', 'long side horizontal'],
];

// Every picture in the expected-result frame is a real sheet drawn for this
// one address, in every combination the table offers (`npm run samples`), so
// what is shown is what the chosen options produce rather than a likeness.
const EXAMPLE_ADDRESS = '150 George Street, Parramatta';

const $ = (id) => document.getElementById(id);
const f = $('f'), loginForm = $('login');
const out = $('out'), queueEl = $('queue');
const linksEl = $('links'), errEl = $('error'), go = $('go'), noteEl = $('note');
const progressEl = $('progress'), fillEl = $('progressFill');
const doneEl = $('done'), doneImg = $('doneImg'), unlockWhat = $('unlockWhat');
const resultImg = $('resultImg'), resultMissing = $('resultMissing');

// ---- token rendering -----------------------------------------------------

// Every row of the options table is the same width, so a row with fewer
// choices than the widest one is padded with blank cells — otherwise the
// table's right edge steps in and out from row to row.
const ROW_CELLS = 4;

function tokens(host, items, current, onPick) {
  host.innerHTML = '';
  items.forEach(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(value === current));
    b.addEventListener('click', () => onPick(value));
    host.append(b);
  });
  for (let i = items.length; i < ROW_CELLS; i++) {
    const fill = document.createElement('span');
    fill.className = 'cell-empty';
    fill.innerHTML = '&nbsp;';
    host.append(fill);
  }
}

function renderAll() {
  tokens($('sheetOpts'), SHEETS, state.sheet,
    (v) => { state.sheet = v; syncScale(); syncStyle(); renderAll(); });

  // A table has neither a scale nor an orientation; the deck's maps are drawn
  // at a fixed scale, north up.
  const scales = SCALES[state.sheet];
  const isTable = state.sheet === 'yield' || state.sheet === 'slides';
  $('scaleRow').hidden = isTable || scales.length === 0;
  $('northRow').hidden = isTable;
  if (scales.length) {
    tokens($('scaleOpts'), scales, state.scale, (v) => { state.scale = v; renderAll(); });
  }
  tokens($('northOpts'), NORTH, state.rotate, (v) => { state.rotate = v; renderAll(); });
  const styles = STYLES[state.sheet];
  $('styleRow').hidden = styles.length === 0;
  if (styles.length) tokens($('styleOpts'), styles, state.template, (v) => { state.template = v; renderAll(); });
  renderResult();
}

/** Take what the server told us about this session. */
function applySession(j) {
  // A free account is told what it gets once, above the bar, with the way to more.
  $('plan').hidden = !(j.grants && !j.grants.cleanPdf);
  // An account that has not clicked its verification link is told generating
  // waits on it, with the resend beside the words. Just back from the link
  // (?verified=1), the banner's place says so instead.
  const unverified = Boolean(j.account) && j.account.verified === false;
  $('verify').hidden = !unverified;
  if (!unverified && verifiedParam === '1') {
    $('verify').textContent = 'Email verified.';
    $('verify').hidden = false;
  }
  // A session is a thirty-day cookie and the code field is hidden while one is
  // valid, so without a way to put it down a browser that entered the shared
  // code could not be handed the operator's — for a month. The cookie is
  // HttpOnly; only the server can clear it.
  if (j.required) {
    const nav = $('nav');
    if (nav && !document.getElementById('signOut')) {
      const b = document.createElement('button');
      b.id = 'signOut';
      b.type = 'button';
      b.className = 'btn';
      b.textContent = 'SIGN OUT';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await fetch('/api/logout', { method: 'POST' }); } catch { /* offline: ask anyway */ }
        location.replace('/');
      });
      nav.append(b);
    }
  }
  if (j.operator) {
    // The status view is the operator's, so the way to it only exists once the
    // operator code has been given. /api/status refuses anyone else regardless.
    const nav = $('nav');
    if (nav && !document.getElementById('statusLink')) {
      const a = document.createElement('a');
      a.id = 'statusLink';
      a.className = 'btn';
      a.href = '/status';
      a.textContent = 'STATUS';
      nav.append(a);
    }
  }
  renderAll();
}

/** Keep the style valid when the drawing changes: each drawing has its own, or none. */
function syncStyle() {
  const valid = STYLES[state.sheet].map((s) => s[0]);
  if (!valid.includes(state.template)) state.template = valid[0] ?? '';
}

/** Keep the scale valid when the drawing changes — 1:3000 means nothing for a lot. */
function syncScale() {
  const valid = SCALES[state.sheet].map((s) => s[0]);
  if (!valid.length) { state.scale = '0'; return; }
  if (!valid.includes(state.scale)) {
    state.scale = state.sheet === 'context' ? '3000' : valid[0];
  }
}

// ---- expected result -----------------------------------------------------

/** The two sheets that are maps take a scale and an orientation; the yield and the site report do not. */
const isMap = () => state.sheet === 'context' || state.sheet === 'site';

function caption(items, value) {
  const hit = items.find((i) => i[0] === value);
  return hit ? hit[2] : '';
}

// The site report has pages, so its frame turns through them: one every second
// and a half, from result-slides-1.jpg on until a number has no picture, then back
// to the first. The pointer over the frame holds the page, a click turns it,
// and with reduced motion asked for it only turns on a click.
const PAGE_MS = 1500;
let deck = null;   // { page, last, timer, held }

const pageSrc = (n) => '/samples/result-slides-' + n + '.jpg';

function stopDeck() {
  if (deck) clearTimeout(deck.timer);
  deck = null;
}

function showPage(n) {
  deck.page = n;
  resultImg.src = pageSrc(n);
  resultImg.alt = 'Site report on A3, page ' + n + (deck.last ? ' of ' + deck.last : '') +
    '. An example drawn for ' + EXAMPLE_ADDRESS + '.';
}

/** The next page, fetched before it is shown so the frame never blinks; past the last, the first. */
function turnPage() {
  if (!deck) return;
  clearTimeout(deck.timer);
  const d = deck;
  const next = d.last && d.page >= d.last ? 1 : d.page + 1;
  const img = new Image();
  img.onload = () => { if (deck === d) { showPage(next); schedulePage(); } };
  img.onerror = () => { if (deck === d) { d.last = d.page; if (d.page > 1) showPage(1); schedulePage(); } };
  img.src = pageSrc(next);
}

function schedulePage() {
  if (!deck || deck.held || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  clearTimeout(deck.timer);
  deck.timer = setTimeout(turnPage, PAGE_MS);
}

resultImg.addEventListener('click', () => { if (deck) turnPage(); });
resultImg.parentElement.addEventListener('mouseenter', () => { if (deck) { deck.held = true; clearTimeout(deck.timer); } });
resultImg.parentElement.addEventListener('mouseleave', () => { if (deck) { deck.held = false; schedulePage(); } });

/** Show the sample for the whole selection, named as `npm run samples` writes it. */
function renderResult() {
  if (state.sheet === 'slides') {
    // renderAll runs on every pick; a deck already turning keeps its place.
    if (deck) return;
    deck = { page: 1, last: 0, timer: 0, held: resultImg.parentElement.matches(':hover') };
    resultImg.hidden = false;
    resultMissing.hidden = true;
    resultImg.classList.add('loading');
    showPage(1);
    schedulePage();
    return;
  }
  stopDeck();
  const parts = isMap()
    ? [state.sheet, state.scale, state.rotate, state.template]
    : [state.sheet];
  const src = '/samples/result-' + parts.join('-') + '.jpg';
  let text = caption(SHEETS, state.sheet);
  if (isMap()) text += ' ' + caption(SCALES[state.sheet], state.scale) + ', ' + caption(NORTH, state.rotate);
  const style = caption(STYLES[state.sheet], state.template);
  text += (style ? ', ' + style : '') + '.';
  // The frame shows the picture alone; what it is is said to a screen reader.
  resultImg.alt = text + ' An example drawn for ' + EXAMPLE_ADDRESS + '.';
  // renderAll runs on every pick; asking again for the picture already shown
  // would only make it flicker.
  if (resultImg.getAttribute('src') !== src) {
    resultImg.hidden = false;
    resultMissing.hidden = true;
    // The last picture stays up until the next arrives, so it is dimmed
    // meanwhile rather than passed off as the new choice's.
    resultImg.classList.add('loading');
    resultImg.src = src;
  }
}
resultImg.addEventListener('load', () => resultImg.classList.remove('loading'));
// A combination without a picture says so rather than showing a broken image
// or, worse, the previous choice's picture as if it were this one's.
resultImg.addEventListener('error', () => {
  stopDeck();
  resultImg.classList.remove('loading');
  resultImg.hidden = true;
  resultMissing.hidden = false;
});

/* The expected result sits between the options and the progress box, so on a
   laptop screen that box opens below the fold and GENERATE looks as if it did
   nothing. Bring it, and the row its links appear in, into view. */
function revealOutput() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelector('.actions').scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

// ---- http helpers --------------------------------------------------------

// A restart, a proxy hiccup or a rate limit can answer with an empty or
// non-JSON body; r.json() throws "Unexpected end of JSON input" there and the
// raw parser message ends up in front of the user. Always read defensively.
async function readJson(r) {
  const text = await r.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function httpMessage(r, j) {
  if (j && j.error) return j.error;
  if (r.status === 401) return 'session expired — reload and unlock again';
  if (r.status === 429) return 'rate limited — wait a minute';
  if (r.status >= 500) return 'service restarting — try again shortly';
  return 'request failed (HTTP ' + r.status + ')';
}

// ---- address type-ahead --------------------------------------------------

const addrInput = $('address');
const suggestBox = $('suggest');
// The field suggests the address the expected-result pictures were drawn for.
addrInput.placeholder = EXAMPLE_ADDRESS;
let suggestTimer = null, activeIdx = -1, lastQuery = '';

function closeSuggest() { suggestBox.classList.remove('open'); activeIdx = -1; }

/** A line of guidance in place of results — never selectable. */
function showNote(text) {
  suggestBox.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'hint';
  li.textContent = text;
  suggestBox.append(li);
  suggestBox.classList.add('open');
  activeIdx = -1;
}

function renderSuggest(items) {
  if (!items.length) return showNote('no match — check the street and the suburb');
  suggestBox.innerHTML = '';
  items.forEach((a, i) => {
    const li = document.createElement('li');
    li.textContent = a;
    li.addEventListener('mousedown', (e) => { e.preventDefault(); addrInput.value = a; closeSuggest(); });
    li.addEventListener('mouseenter', () => { activeIdx = i; highlight(); });
    suggestBox.append(li);
  });
  suggestBox.classList.add('open');
}
function highlight() {
  [...suggestBox.children].forEach((li, i) => li.classList.toggle('active', i === activeIdx));
}

addrInput.addEventListener('input', () => {
  const q = addrInput.value.trim();
  clearTimeout(suggestTimer);
  if (q.length < 4) return closeSuggest();
  // The address register is indexed on the address string, which begins with
  // the house number, so a street-first query cannot be answered at all —
  // matching mid-string takes the service half a minute. Say what to type
  // instead of leaving the field looking broken.
  if (!/^\d/.test(q)) return showNote('start with the house number — e.g. ' + EXAMPLE_ADDRESS);
  suggestTimer = setTimeout(async () => {
    if (q === lastQuery) return;
    lastQuery = q;
    // The lookup runs from about half a second to four, depending on the
    // upstream service, which is long enough for a silent field to read as
    // broken.
    showNote('searching…');
    try {
      const r = await fetch('/api/address?q=' + encodeURIComponent(q));
      const j = await readJson(r);
      if (addrInput.value.trim() !== q) return;        // superseded by newer typing
      // The reply can also land after the field has been left or the job
      // started; rendering then would pop the list back open over the page.
      if (document.activeElement !== addrInput) return closeSuggest();
      renderSuggest(j.suggestions || []);
    } catch { closeSuggest(); }
  }, 250);
});

addrInput.addEventListener('keydown', (e) => {
  if (!suggestBox.classList.contains('open')) return;
  if (suggestBox.querySelector('.hint')) {           // a note, nothing to walk
    if (e.key === 'Escape') closeSuggest();
    return;
  }
  const n = suggestBox.children.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % n; highlight(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + n) % n; highlight(); }
  else if (e.key === 'Enter' && activeIdx >= 0) {
    e.preventDefault();
    addrInput.value = suggestBox.children[activeIdx].textContent;
    closeSuggest();
  } else if (e.key === 'Escape') closeSuggest();
});
addrInput.addEventListener('blur', () => setTimeout(closeSuggest, 120));

// ---- session -------------------------------------------------------------

/* Four uses of one form: an account's email and password, a new free account,
   the office's shared code (which also takes the operator code, since that
   grants a superset and an operator should not need two sessions), and asking
   for a password-reset email. The operator's own gate is /admin, which asks
   whatever session is held — this page hides its form once any session exists.
   A fifth state, choosing the new password, arrives only by the emailed link
   (?reset=<token>) and takes the form over. */
const AUTH_MODES = [
  // [value, label, button, password placeholder, autocomplete]
  ['signin', 'sign in',  'SIGN IN',          'password',                       'current-password'],
  ['signup', 'sign up',  'SIGN UP',          'password, 8 characters or more', 'new-password'],
  ['code',   'code',     'UNLOCK',           'access code',                    'off'],
  ['reset',  'reset',    'EMAIL RESET LINK', '',                               'off'],
];
const boot = new URLSearchParams(location.search);
// ?signup is where the pricing page sends someone who has no account yet.
let authMode = boot.has('signup') ? 'signup' : 'signin';
// The emailed reset link. The token is spent on the server when the new
// password is set, so the URL is only cleaned then — a reload keeps the form.
let resetToken = /^[0-9a-f]{64}$/.test(boot.get('reset') || '') ? boot.get('reset') : null;
// Back from the verification link: '1' verified, '0' expired or already used.
const verifiedParam = boot.get('verified');
if (verifiedParam !== null) history.replaceState(null, '', '/');

function renderAuth() {
  $('authRow').hidden = Boolean(resetToken);
  if (resetToken) {
    $('emailBar').hidden = true;
    $('code').hidden = false;
    $('code').placeholder = 'new password, 8 characters or more';
    $('code').autocomplete = 'new-password';
    $('authGo').textContent = 'SET NEW PASSWORD';
    return;
  }
  tokens($('authOpts'), AUTH_MODES, authMode, (v) => {
    authMode = v; renderAuth();
    $('authError').textContent = ''; $('authNote').hidden = true;
  });
  const m = AUTH_MODES.find((x) => x[0] === authMode);
  $('emailBar').hidden = authMode === 'code';
  // Asking for the reset email takes only the address; a password field here
  // would invite typing the new password into a form that cannot take one yet.
  $('code').hidden = authMode === 'reset';
  $('authGo').textContent = m[2];
  $('code').placeholder = m[3];
  $('code').autocomplete = m[4];
}

function note(text) {
  const n = $('authNote');
  n.textContent = text;
  n.hidden = !text;
}

function showLogin() {
  f.hidden = true;
  loginForm.hidden = false;
  renderAuth();
  // Clicked in a browser that holds no session (another device, say): the
  // click still verified, so say so beside the form it lands on.
  if (verifiedParam === '1') note('Email verified — sign in.');
  else if (verifiedParam === '0') note('That verification link has expired or was already used. Sign in and resend it.');
  (resetToken || authMode === 'code' ? $('code') : $('email')).focus();
}

function enter(j) {
  loginForm.hidden = true;
  f.hidden = false;
  applySession(j);
  addrInput.focus();
  resumeJob();
}

// The emailed reset link outranks whatever session this browser holds: the
// person following it came to set a password, not to be signed straight in.
if (resetToken) showLogin();
else fetch('/api/me').then(async (r) => {
  if (!r.ok) return showLogin();
  enter(await readJson(r));
}).catch(showLogin);

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const authErr = $('authError');
  authErr.textContent = '';
  note('');
  const password = $('code').value;
  let path, body;
  if (resetToken) {
    path = '/api/password/reset'; body = { token: resetToken, password };
  } else if (authMode === 'reset') {
    path = '/api/password/forgot'; body = { email: $('email').value.trim() };
  } else if (authMode === 'code') {
    path = '/api/login'; body = { code: password };
  } else {
    path = authMode === 'signup' ? '/api/signup' : '/api/login';
    body = { email: $('email').value.trim(), password };
  }
  let r;
  try {
    r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    authErr.textContent = 'no answer from the server — try again';
    return;
  }
  const j = await readJson(r);
  if (!r.ok) { authErr.textContent = httpMessage(r, j); return; }
  if (!resetToken && authMode === 'reset') {
    // One answer whether or not the address has an account — the server's
    // words, so the page cannot be made to say which.
    note(j.message || 'If that email has an account, a reset link is on its way to it.');
    return;
  }
  if (resetToken) { resetToken = null; history.replaceState(null, '', '/'); }
  enter(j);
});

// The sign-up's email never arrived, or its link ran out.
$('resend').addEventListener('click', async () => {
  const b = $('resend');
  b.disabled = true;
  let r, j;
  try {
    r = await fetch('/api/verify/resend', { method: 'POST' });
    j = await readJson(r);
  } catch {
    b.disabled = false;
    b.textContent = 'no answer from the server — resend the email';
    return;
  }
  if (r.ok) { b.textContent = j.message || 'sent'; return; }
  b.disabled = false;
  b.textContent = httpMessage(r, j) + ' — resend the email';
});

// ---- run -----------------------------------------------------------------

/** How long ago the sheet being handed back was drawn, in words. */
function ago(mins) {
  if (!(mins > 0)) return 'a moment ago';
  if (mins < 60) return mins === 1 ? 'a minute ago' : mins + ' minutes ago';
  const h = Math.round(mins / 60);
  return h === 1 ? 'an hour ago' : h + ' hours ago';
}

/* The server answers an identical request with the sheet it already drew, so
   say so — an instant PDF is otherwise indistinguishable from a stale one — and
   put the way to insist on a new one right next to the claim. */
function noteReused(mins) {
  noteEl.textContent = 'this sheet was drawn ' + ago(mins) + ' — reusing it · ';
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'generate a fresh one';
  again.addEventListener('click', () => submit(true));
  noteEl.append(again);
}

async function submit(fresh) {
  const address = addrInput.value.trim();
  if (!address) return;
  clearTimeout(suggestTimer);
  closeSuggest();
  startOutput('sending');
  go.disabled = true;
  revealOutput();
  try {
    const r = await fetch('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, scale: state.scale, rotate: state.rotate,
                             sheet: state.sheet, template: state.template, fresh: fresh === true }),
    });
    const j = await readJson(r);
    if (!r.ok) throw new Error(httpMessage(r, j));
    if (!j.id) throw new Error('service restarting — try again shortly');
    if (j.reused) noteReused(j.ageMinutes);
    // Someone else asked for this drawing first and it is still running;
    // following their job is why this one does not join the queue behind it.
    else if (j.joined) noteEl.textContent = 'already being drawn for this address — following that run';
    poll(j.id);
  } catch (err) { fail(err.message); }
}

f.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(false);
});

// ---- progress ------------------------------------------------------------

/* The server says where a job is (queued, drawing, done), not how far along it
   is: nothing inside the pipeline knows its own fraction, and a sheet takes one
   to three minutes, the site report longer. So the bar is filled by time, fast
   at first and ever more slowly: it never stands still, and it never reaches
   the end before the server says the drawing is done. */
let runningSince = 0;

function timeFraction(seconds, sheet) {
  const pace = sheet === 'slides' ? 150 : 60;
  return Math.min(0.95, 1 - Math.exp(-seconds / pace));
}

function setProgress(fraction) {
  fillEl.style.width = (fraction * 100).toFixed(1) + '%';
}

/** A fresh output box: the bar empty, nothing of the last drawing left in it. */
function startOutput(word) {
  out.hidden = false;
  errEl.textContent = ''; linksEl.innerHTML = ''; noteEl.textContent = '';
  queueEl.textContent = word;
  runningSince = 0;
  progressEl.hidden = false;
  setProgress(0);
  doneEl.hidden = true;
  doneImg.removeAttribute('src');
  unlockWhat.hidden = true;
}

// misses: consecutive transient failures. A generation takes minutes, so a
// deploy or a dropped connection mid-run must not throw the sheet away —
// keep polling for a while before giving up.
async function poll(id, misses) {
  misses = misses || 0;
  try {
    const r = await fetch('/api/jobs/' + id);
    if (r.status >= 500) {
      if (misses < 20) {
        queueEl.textContent = 'reconnecting';
        return setTimeout(() => poll(id, misses + 1), 3000);
      }
      throw new Error('service restarting — try again shortly');
    }
    const j = await readJson(r);
    if (r.status === 404) throw new Error('service restarted, job lost — run again');
    if (!r.ok) throw new Error(httpMessage(r, j));

    if (j.status === 'queued' && j.queuePosition > 0) {
      queueEl.textContent = j.queuePosition === 1
        ? 'queued · next in line'
        : 'queued · ' + (j.queuePosition - 1) + ' ahead · about ' + j.etaMinutes + ' minutes';
      runningSince = 0;
      setProgress(0);
    } else if (j.status === 'running') {
      queueEl.textContent = 'drawing';
      if (!runningSince) runningSince = Date.now();
      setProgress(timeFraction((Date.now() - runningSince) / 1000, j.sheet));
    }

    if (j.status === 'done') {
      queueEl.textContent = 'done';
      progressEl.hidden = true;
      linksEl.innerHTML = '';
      // What this viewer may take away of this drawing, as the server says:
      // the plan's, or everything once its site is bought. The server decides
      // regardless — a free account asking for the CAD gets 402.
      const grants = j.grants || { cleanPdf: false, openData: false };
      // Back from paying for this site: Stripe tells the server by webhook,
      // which can land a few seconds after the visitor does.
      if (awaitingPayment > 0 && !grants.cleanPdf) {
        awaitingPayment -= 1;
        noteEl.textContent = 'payment received — unlocking the site…';
        return setTimeout(() => poll(id, 0), 2000);
      }
      if (returnedFromPayment) {
        noteEl.textContent = grants.cleanPdf ? 'site unlocked'
          : 'payment not confirmed yet — reload this page in a minute';
        returnedFromPayment = false;
      }
      // The drawing itself, small: a picture of a few hundred kilobytes shows at
      // once where the PDF can be tens of megabytes, so the PDF is downloaded
      // rather than opened in the browser.
      if (j.hasPreview) {
        doneImg.src = '/api/jobs/' + id + '/preview';
        doneImg.alt = 'The finished drawing for ' + j.address + '.';
        doneEl.hidden = false;
      }
      if (j.unlock) {
        // What is bought, said in full: the address, not just this drawing of it.
        unlockWhat.textContent = 'Unlocking this address gives you every drawing of it — context, ' +
          'site, yield and site report, at any scale or style — clean, with the CAD and data files, ' +
          'for 30 days.';
        unlockWhat.hidden = false;
        addButton('unlock this address · ' + j.unlock, () => unlock(id));
      }
      addLink(grants.cleanPdf ? 'download pdf' : 'download pdf · watermarked',
        '/api/jobs/' + id + '/pdf?download', { download: true });
      const dataLabel = j.sheet === 'slides' ? 'download json' : 'download csv';
      if (grants.openData) {
        if (j.hasCad) addLink('download cad', '/api/jobs/' + id + '/cad');
        if (j.hasData) addLink(dataLabel, '/api/jobs/' + id + '/data');
      } else {
        // Shown, not hidden: what paying adds is the reason to pay.
        if (j.hasCad) addLink('cad · locked', '/pricing', { locked: true });
        if (j.hasData) addLink(dataLabel.replace('download ', '') + ' · locked', '/pricing', { locked: true });
      }
      go.disabled = false;
      return;
    }
    if (j.status === 'error') throw new Error(j.error || 'generation failed');
    setTimeout(() => poll(id, 0), 2500);
  } catch (err) {
    // fetch() rejects outright when the connection drops — same transient case.
    if (err instanceof TypeError && misses < 20) {
      queueEl.textContent = 'reconnecting';
      return setTimeout(() => poll(id, misses + 1), 3000);
    }
    fail(err.message);
  }
}

function addLink(label, href, { newTab, locked, download } = {}) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  // The first result is the one to press; the rest sit beside it sharing a rule.
  a.className = linksEl.childNodes.length ? 'btn' : 'btn primary';
  if (locked) a.classList.add('locked');
  if (newTab) a.target = '_blank';
  // Saved rather than followed, so an error in place of the file never takes
  // the page, and the job on it, away. The server's filename wins over this one.
  if (download) a.download = '';
  linksEl.append(a);
}

function addButton(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = linksEl.childNodes.length ? 'btn' : 'btn primary';
  b.textContent = label;
  b.addEventListener('click', onClick);
  linksEl.append(b);
}

// Polls left to wait for a site's payment to arrive, after Stripe sends the
// visitor back (?paid=1).
let awaitingPayment = 0, returnedFromPayment = false;

/** Off to Stripe to pay for this drawing's site; it sends the visitor back here. */
async function unlock(id) {
  errEl.textContent = '';
  try {
    const r = await fetch('/api/billing/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: id }),
    });
    const j = await readJson(r);
    if (r.ok && j.url) return location.assign(j.url);
    errEl.textContent = httpMessage(r, j);
  } catch {
    errEl.textContent = 'no answer from the server — try again';
  }
}

/** Back from Stripe (or from a link to a drawing): show that drawing again. */
function resumeJob() {
  const params = new URLSearchParams(location.search);
  const id = params.get('job');
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return;
  if (params.has('paid')) { awaitingPayment = 15; returnedFromPayment = true; }
  // Once, not on every reload.
  history.replaceState(null, '', '/');
  startOutput('');
  poll(id);
}

function fail(msg) {
  queueEl.textContent = '';
  progressEl.hidden = true;
  errEl.textContent = msg;
  go.disabled = false;
}

renderAll();
