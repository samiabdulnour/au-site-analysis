const f = document.getElementById('f');
const loginForm = document.getElementById('login');
const sheetSel = document.getElementById('sheet');
const scaleSel = document.getElementById('scale');
const rotateSel = document.getElementById('rotate');

// Context sheets work at neighbourhood scales; site sheets at lot scales
// (auto picks the tightest standard scale that fits the lot plus a margin).
const SCALES = {
  context: [['2100', '1:2100'], ['3000', '1:3000 (default)'], ['4000', '1:4000']],
  site: [['0', 'Auto scale'], ['200', '1:200'], ['250', '1:250'], ['300', '1:300'],
         ['400', '1:400'], ['500', '1:500']],
  summary: [],   // a table, not a map
};
function fillScales() {
  // The development summary has no map, so scale and orientation mean nothing
  // for it — hide them rather than offer settings that do not apply.
  const table = sheetSel.value === 'summary';
  scaleSel.style.display = table ? 'none' : '';
  rotateSel.style.display = table ? 'none' : '';
  if (table) { scaleSel.innerHTML = '<option value="0"></option>'; return; }
  const opts = SCALES[sheetSel.value];
  scaleSel.innerHTML = opts.map(([v, l], i) =>
    `<option value="${v}"${i === (sheetSel.value === 'context' ? 1 : 0) ? ' selected' : ''}>${l}</option>`).join('');
}
sheetSel.addEventListener('change', fillScales);
fillScales();

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
  if (r.status === 401) return 'Session expired — reload the page and sign in again.';
  if (r.status === 429) return 'Too many requests — wait a minute and try again.';
  if (r.status >= 500) return 'The service is restarting — try again in a moment.';
  return 'Request failed (HTTP ' + r.status + ').';
}

// ---- address type-ahead against the NSW address register -----------------
const addrInput = document.getElementById('address');
const suggestBox = document.getElementById('suggest');
let suggestTimer = null, activeIdx = -1, lastQuery = '';

function closeSuggest() { suggestBox.classList.remove('open'); activeIdx = -1; }

function renderSuggest(items) {
  if (!items.length) return closeSuggest();
  suggestBox.innerHTML = items.map((a) => `<li>${a}</li>`).join('');
  [...suggestBox.children].forEach((li, i) => {
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addrInput.value = li.textContent;
      closeSuggest();
    });
    li.addEventListener('mouseenter', () => { activeIdx = i; highlight(); });
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
  suggestTimer = setTimeout(async () => {
    if (q === lastQuery) return;
    lastQuery = q;
    try {
      const r = await fetch('/api/address?q=' + encodeURIComponent(q));
      const j = await readJson(r);
      if (addrInput.value.trim() === q) renderSuggest(j.suggestions || []);
    } catch { closeSuggest(); }
  }, 250);
});

addrInput.addEventListener('keydown', (e) => {
  if (!suggestBox.classList.contains('open')) return;
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

// Show the generator or the code prompt depending on session state. The rest
// of the page is public either way — a visitor without a code should still
// understand exactly what the tool produces.
fetch('/api/me').then(r => {
  (r.ok ? f : loginForm).style.display = 'flex';
  document.getElementById('gatehint').style.display = r.ok ? 'none' : 'block';
  document.getElementById('waithint').style.display = r.ok ? 'block' : 'none';
  if (r.ok) document.getElementById('address').focus();
}).catch(() => { loginForm.style.display = 'flex'; });

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: document.getElementById('code').value }),
  });
  if (r.ok) {
    loginForm.style.display = 'none';
    f.style.display = 'flex';
    document.getElementById('gatehint').style.display = 'none';
    document.getElementById('waithint').style.display = 'block';
    document.getElementById('address').focus();
  } else {
    const j = await readJson(r);
    error_.textContent = j.error || 'Wrong access code.';
    error_.style.display = 'block';
  }
});

const go = document.getElementById('go');
const status_ = document.getElementById('status');
const log = document.getElementById('log');
const queueEl = document.getElementById('queue');
const result = document.getElementById('result');
const error_ = document.getElementById('error');

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  error_.style.display = 'none'; result.style.display = 'none';
  const address = document.getElementById('address').value.trim();
  if (!address) return;
  go.disabled = true; status_.classList.add('active');
  queueEl.textContent = ''; log.textContent = 'submitting…';
  try {
    const r = await fetch('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, scale: scaleSel.value,
                             rotate: rotateSel.value, sheet: sheetSel.value }),
    });
    const j = await readJson(r);
    if (!r.ok) throw new Error(httpMessage(r, j));
    if (!j.id) throw new Error('The service is restarting — try again in a moment.');
    poll(j.id);
  } catch (err) { fail(err.message); }
});

// misses: consecutive transient failures. A generation takes minutes, so a
// deploy or a dropped connection mid-run must not throw the sheet away —
// keep polling for a while before giving up.
async function poll(id, misses) {
  misses = misses || 0;
  try {
    const r = await fetch('/api/jobs/' + id);
    if (r.status >= 500) {
      if (misses < 20) { log.textContent = 'service restarting, reconnecting…';
                         return setTimeout(() => poll(id, misses + 1), 3000); }
      throw new Error('The service is restarting — try again in a moment.');
    }
    const j = await readJson(r);
    if (r.status === 404) throw new Error('The service restarted and this job was lost — please generate again.');
    if (!r.ok) throw new Error(httpMessage(r, j));

    // Waiting behind other people is the normal case on one server; say where
    // you are in the line rather than showing an anonymous spinner.
    if (j.status === 'queued' && j.queuePosition > 0) {
      queueEl.textContent = j.queuePosition === 1
        ? 'Next in the queue — starting shortly.'
        : `${ordinal(j.queuePosition)} in the queue — about ${j.etaMinutes} minutes.`;
    } else if (j.status === 'running') {
      queueEl.textContent = 'Generating your drawing…';
    }
    log.textContent = j.log.join('\n') || 'waiting…';

    if (j.status === 'done') {
      status_.classList.remove('active');
      const dl = document.getElementById('dl');
      dl.href = '/api/jobs/' + id + '/pdf';
      dl.textContent = j.sheet === 'site' ? 'OPEN SITE ANALYSIS PDF'
        : j.sheet === 'summary' ? 'OPEN DEVELOPMENT SUMMARY PDF' : 'OPEN CONTEXT ANALYSIS PDF';
      const cad = document.getElementById('dlcad');
      if (j.hasCad) { cad.href = '/api/jobs/' + id + '/cad'; cad.style.display = 'inline-block'; }
      const dat = document.getElementById('dldata');
      if (j.hasData) { dat.href = '/api/jobs/' + id + '/data'; dat.style.display = 'inline-block'; }
      result.style.display = 'block';
      go.disabled = false;
      return;
    }
    if (j.status === 'error') throw new Error(j.error || 'Generation failed');
    setTimeout(() => poll(id, 0), 2500);
  } catch (err) {
    // fetch() rejects outright when the connection drops — same transient case.
    if (err instanceof TypeError && misses < 20) {
      log.textContent = 'connection lost, reconnecting…';
      return setTimeout(() => poll(id, misses + 1), 3000);
    }
    fail(err.message);
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fail(msg) {
  status_.classList.remove('active');
  queueEl.textContent = '';
  error_.textContent = msg;
  error_.style.display = 'block';
  go.disabled = false;
}
