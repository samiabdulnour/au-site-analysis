/* Site Analyst UI.
   State lives in one object; the options are plain buttons that write into it,
   which avoids native <select> chrome in a page that is otherwise all text. */

// `template` and which templates exist at all come from the session: the
// office style belongs to the office door, so the public page never lists it.
const state = { sheet: 'context', scale: '3000', rotate: 'north', template: 'neutral' };
let allowedTemplates = ['neutral'];

// [value, label, previewImage, previewCaption] — every option previews a real
// sheet generated for the same demo address, so the comparison is like for like.
const SHEETS = [
  ['context', 'context', '/samples/context.jpg', 'context analysis · A1 · 1:3000'],
  ['site',    'site',    '/samples/site.jpg',    'site analysis · A1 · auto scale'],
  ['summary', 'summary', '/samples/summary.jpg', 'development summary · A1 · table'],
];
const SCALES = {
  context: [
    ['2000', '2000', '/samples/context-2000.jpg', 'context · 1:2000 — tighter, more detail'],
    ['3000', '3000', '/samples/context.jpg',      'context · 1:3000 — the default'],
    ['4000', '4000', '/samples/context-4000.jpg', 'context · 1:4000 — wider catchment'],
  ],
  site: [
    ['0',   'auto', '/samples/site.jpg',     'site · auto — tightest scale that fits the lot'],
    ['200', '200',  '/samples/site-200.jpg', 'site · 1:200 — a small lot fills the sheet'],
    ['250', '250',  '/samples/site-250.jpg', 'site · 1:250'],
    ['300', '300',  '/samples/site-300.jpg', 'site · 1:300'],
    ['400', '400',  '/samples/site-400.jpg', 'site · 1:400'],
    ['500', '500',  '/samples/site-500.jpg', 'site · 1:500 — more of the surrounds'],
  ],
  summary: [],
};
// Graphic template: colours, typeface and symbol family. Content is identical
// between templates — only the drawing's appearance changes.
const TEMPLATES = [
  ['fuse',    'fuse',    '/samples/tpl-fuse.jpg',    'fuse — the office style'],
  ['neutral', 'neutral', '/samples/tpl-neutral.jpg', 'neutral — restrained palette, mono-safe'],
];
const NORTH = [
  ['north', 'up',    '/samples/site.jpg',       'north up — the sheet is oriented to north'],
  ['auto',  'align', '/samples/north-align.jpg', 'aligned — the lot is squared to the sheet'],
];

// Which entrance this page is. Sent with the login so the door is checked as
// well as the code — /fuse does not open to the public code.
const DOOR = location.pathname.replace(/\/+$/, '') === '/fuse' ? 'fuse' : 'public';

const $ = (id) => document.getElementById(id);
const f = $('f'), loginForm = $('login');
const out = $('out'), logEl = $('log'), queueEl = $('queue');
const linksEl = $('links'), errEl = $('error'), go = $('go'), noteEl = $('note');
const preview = $('preview');

// ---- token rendering -----------------------------------------------------

// Every row of the options table is the same width, so a row with fewer
// choices than the widest one is padded with blank cells — otherwise the
// table's right edge steps in and out from row to row.
const ROW_CELLS = 3;

function tokens(host, items, current, onPick) {
  host.innerHTML = '';
  items.forEach(([value, label, img, cap]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(value === current));
    b.addEventListener('click', () => onPick(value));
    if (img) {
      b.addEventListener('mouseenter', (e) => showPreview(img, cap, e));
      b.addEventListener('mousemove', movePreview);
      b.addEventListener('mouseleave', hidePreview);
      // Touch has no hover: a tap also pins the preview open.
      b.addEventListener('click', () => {
        if (matchMedia('(hover: none)').matches) togglePreview(img, cap, b);
      });
    }
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
    (v) => { state.sheet = v; syncScale(); renderAll(); });

  // A table has neither a scale nor an orientation.
  const scales = SCALES[state.sheet];
  const isTable = state.sheet === 'summary';
  $('scaleRow').hidden = isTable || scales.length === 0;
  $('northRow').hidden = isTable;
  if (scales.length) {
    tokens($('scaleOpts'), scales, state.scale, (v) => { state.scale = v; renderAll(); });
  }
  tokens($('northOpts'), NORTH, state.rotate, (v) => { state.rotate = v; renderAll(); });

  // One template is not a choice — the row only earns its space when the
  // session can actually pick between them.
  const tpls = TEMPLATES.filter(([v]) => allowedTemplates.includes(v));
  $('templateRow').hidden = tpls.length < 2;
  tokens($('templateOpts'), tpls, state.template, (v) => { state.template = v; renderAll(); });
}

/** Take what the door told us about this session. */
function applySession(j) {
  allowedTemplates = Array.isArray(j.templates) && j.templates.length ? j.templates : ['neutral'];
  state.template = allowedTemplates.includes(j.template) ? j.template : allowedTemplates[0];
  if (j.tier === 'fuse') {
    const lead = document.querySelector('#f .lead');
    if (lead) lead.textContent = 'FUSE edition. Search a NSW address to generate its site analysis.';
    // The status view is the office's, so the way to it only exists once the
    // office code has been given. /api/status refuses anyone else regardless.
    const actions = document.querySelector('.actions');
    if (actions && !document.getElementById('statusLink')) {
      const a = document.createElement('a');
      a.id = 'statusLink';
      a.className = 'btn';
      a.href = '/status';
      a.textContent = 'STATUS';
      actions.append(a);
    }
  }
  renderAll();
}

/** Keep the scale valid when the drawing changes — 1:3000 means nothing for a lot. */
function syncScale() {
  const valid = SCALES[state.sheet].map((s) => s[0]);
  if (!valid.length) { state.scale = '0'; return; }
  if (!valid.includes(state.scale)) {
    state.scale = state.sheet === 'context' ? '3000' : valid[0];
  }
}

// ---- hover preview -------------------------------------------------------

let pinned = false;

function showPreview(src, cap, e) {
  if (pinned) return;
  preview.querySelector('img').src = src;
  preview.querySelector('.cap').textContent = cap;
  preview.classList.add('on');
  movePreview(e);
}
function movePreview(e) {
  if (!preview.classList.contains('on') || pinned) return;
  const w = preview.offsetWidth, h = preview.offsetHeight, pad = 16;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - pad) x = Math.max(pad, e.clientX - w - pad);
  if (y + h > innerHeight - pad) y = Math.max(pad, innerHeight - h - pad);
  preview.style.left = x + 'px';
  preview.style.top = y + 'px';
}
function hidePreview() { if (!pinned) preview.classList.remove('on'); }

function togglePreview(src, cap, anchor) {
  pinned = !pinned;
  if (!pinned) { preview.classList.remove('on'); return; }
  preview.querySelector('img').src = src;
  preview.querySelector('.cap').textContent = cap;
  preview.classList.add('on');
  const r = anchor.getBoundingClientRect();
  preview.style.left = Math.max(8, Math.min(r.left, innerWidth - preview.offsetWidth - 8)) + 'px';
  preview.style.top = (r.bottom + 8) + 'px';
}
document.addEventListener('click', (e) => {
  if (pinned && !e.target.closest('.cell')) { pinned = false; preview.classList.remove('on'); }
});

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
  if (!/^\d/.test(q)) return showNote('start with the house number — e.g. 212 Bondi Road, Bondi');
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

function showLogin() {
  f.hidden = true;
  loginForm.hidden = false;
  if (DOOR === 'fuse') {
    // The office knows what the tool is; the introduction is for the public
    // door, where it is the only thing a visitor gets before the code field.
    const intro = $('intro');
    if (intro) intro.hidden = true;
    const prompt = loginForm.querySelector('.lead:not(.intro)');
    if (prompt) prompt.textContent = 'FUSE. Enter the office access code.';
  }
}

fetch('/api/me').then(async (r) => {
  if (!r.ok) return showLogin();
  const j = await readJson(r);
  // A session from the other entrance is not a session here.
  if (j.tier !== DOOR) return showLogin();
  f.hidden = false;
  loginForm.hidden = true;
  applySession(j);
  addrInput.focus();
}).catch(showLogin);

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: $('code').value, door: DOOR }),
  });
  if (r.ok) {
    loginForm.hidden = true;
    f.hidden = false;
    applySession(await readJson(r));
    addrInput.focus();
  } else {
    const j = await readJson(r);
    out.hidden = false;
    errEl.textContent = j.error || 'wrong access code';
  }
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
  out.hidden = false;
  errEl.textContent = ''; linksEl.innerHTML = ''; queueEl.textContent = '';
  noteEl.textContent = '';
  go.disabled = true;
  logEl.textContent = 'submitting';
  try {
    const r = await fetch('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, scale: state.scale, rotate: state.rotate,
                             sheet: state.sheet, template: state.template,
                             fresh: fresh === true }),
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

f.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });

// misses: consecutive transient failures. A generation takes minutes, so a
// deploy or a dropped connection mid-run must not throw the sheet away —
// keep polling for a while before giving up.
async function poll(id, misses) {
  misses = misses || 0;
  try {
    const r = await fetch('/api/jobs/' + id);
    if (r.status >= 500) {
      if (misses < 20) {
        logEl.textContent = 'service restarting, reconnecting';
        return setTimeout(() => poll(id, misses + 1), 3000);
      }
      throw new Error('service restarting — try again shortly');
    }
    const j = await readJson(r);
    if (r.status === 404) throw new Error('service restarted, job lost — run again');
    if (!r.ok) throw new Error(httpMessage(r, j));

    if (j.status === 'queued' && j.queuePosition > 0) {
      queueEl.textContent = j.queuePosition === 1
        ? 'queued, next in line'
        : 'queued, position ' + j.queuePosition + ' — about ' + j.etaMinutes + ' minutes';
    } else if (j.status === 'running') {
      queueEl.textContent = 'generating';
    }
    logEl.textContent = (j.log || []).map((l) => l.trim()).join('\n');
    logEl.scrollTop = logEl.scrollHeight;

    if (j.status === 'done') {
      queueEl.textContent = 'done';
      linksEl.innerHTML = '';
      addLink('open pdf', '/api/jobs/' + id + '/pdf', true);
      if (j.hasCad) addLink('download cad', '/api/jobs/' + id + '/cad');
      if (j.hasData) addLink('download csv', '/api/jobs/' + id + '/data');
      go.disabled = false;
      return;
    }
    if (j.status === 'error') throw new Error(j.error || 'generation failed');
    setTimeout(() => poll(id, 0), 2500);
  } catch (err) {
    // fetch() rejects outright when the connection drops — same transient case.
    if (err instanceof TypeError && misses < 20) {
      logEl.textContent = 'connection lost, reconnecting';
      return setTimeout(() => poll(id, misses + 1), 3000);
    }
    fail(err.message);
  }
}

function addLink(label, href, newTab) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  // The first result is the one to press; the rest sit beside it sharing a rule.
  a.className = linksEl.childNodes.length ? 'btn' : 'btn primary';
  if (newTab) a.target = '_blank';
  linksEl.append(a);
}

function fail(msg) {
  queueEl.textContent = '';
  errEl.textContent = msg;
  go.disabled = false;
}

renderAll();
