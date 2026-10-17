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
    ['0',   'auto', 'at the tightest scale that fits the lot'],
    ['200', '200',  'at 1:200'],
    ['250', '250',  'at 1:250'],
    ['500', '500',  'at 1:500'],
  ],
  yield: [],
  slides: [],
};
// The styles each drawing takes: the context sheet has its templates, the site
// analysis its own themes, and the yield and the site report none. An unknown one
// falls back to the drawing's default on the server.
const STYLES = {
  context: [
    ['flamingo',   'flamingo',   'in Flamingo'],
    ['kingfisher', 'kingfisher', 'in Kingfisher'],
    ['heron',      'heron',      'in Heron'],
    ['canary',     'canary',     'in Canary'],
  ],
  site: [
    ['dove',     'dove',     'in Dove'],
    ['canary',   'canary',   'in Canary'],
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
const out = $('out'), logEl = $('log'), queueEl = $('queue');
const linksEl = $('links'), errEl = $('error'), go = $('go'), noteEl = $('note');
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
  // A session is a thirty-day cookie and the code field is hidden while one is
  // valid, so without a way to put it down a browser that entered the shared
  // code could not be handed the operator's — for a month. The cookie is
  // HttpOnly; only the server can clear it.
  if (j.required) {
    const actions = document.querySelector('.actions');
    if (actions && !document.getElementById('signOut')) {
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
      actions.append(b);
    }
  }
  if (j.operator) {
    // The status view is the operator's, so the way to it only exists once the
    // operator code has been given. /api/status refuses anyone else regardless.
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

/* This is the shared gate: it takes the access code, and the operator code too,
   since that one grants a superset and an operator should not need two sessions.
   The operator's own gate is /admin, which asks whatever session is held — this
   page hides its code field once any session exists, which is what made it
   impossible to get past holding the shared code. */
function showLogin() {
  f.hidden = true;
  loginForm.hidden = false;
  $('code').focus();
}

fetch('/api/me').then(async (r) => {
  if (!r.ok) return showLogin();
  const j = await readJson(r);
  f.hidden = false;
  loginForm.hidden = true;
  applySession(j);
  addrInput.focus();
}).catch(showLogin);

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: $('code').value }),
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
      if (j.hasData) addLink(j.sheet === 'slides' ? 'download json' : 'download csv', '/api/jobs/' + id + '/data');
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
