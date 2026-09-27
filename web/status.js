/* The operator's view of what this server has been doing.

   /api/version is the public window and says only whether the thing is up.
   This one names the addresses people searched for and the reasons their
   sheets failed, so it takes the operator code and 403s for anyone else. */

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 10_000;

// ---- formatting ----------------------------------------------------------

function bytes(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
}

function duration(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

function uptime(sec) {
  if (sec < 3600) return Math.round(sec / 60) + ' min';
  if (sec < 86400) return (sec / 3600).toFixed(1) + ' h';
  return (sec / 86400).toFixed(1) + ' days';
}

/** Local clock, since whoever is reading this is looking for "just now". */
function clock(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return today ? t : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + t;
}

// ---- rendering -----------------------------------------------------------

/** The same hairline table the about page uses: a label column and a value. */
function deftable(host, rows) {
  host.innerHTML = '';
  for (const [k, v, cls] of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('div');
    vEl.className = 'v' + (cls ? ' ' + cls : '');
    vEl.textContent = v;
    row.append(kEl, vEl);
    host.append(row);
  }
}

/* Cron runs the deployer every five minutes, so three missed passes is the
   point at which it has stopped rather than merely not run yet. */
const DEPLOY_STALE_SECONDS = 15 * 60;

/** The deployer's last pass, and whether it looks like there was one. */
function deployRow(dep) {
  if (!dep || !dep.text || dep.text === 'none')
    return ['deployer', 'no status — deployer has not reported', 'warn'];
  const failed = /^FAILED/.test(dep.text);
  const stale = dep.ageSeconds === null || dep.ageSeconds > DEPLOY_STALE_SECONDS;
  const age = dep.ageSeconds === null ? 'age unknown' : uptime(dep.ageSeconds) + ' ago';
  // Stale is worth the same red as failed: a deployer that has stopped saying
  // anything is the case that went unnoticed for six days, and it says
  // something reassuring like "up-to-date" right up until someone checks when.
  return ['deployer', dep.text + ' · ' + age, failed || stale ? 'warn' : ''];
}

function renderServer(j) {
  const osm = j.osm.mode === 'local'
    ? 'local · ' + j.osm.state + (j.osm.setup && j.osm.setup !== 'none' ? ' · ' + j.osm.setup : '')
    : 'public mirrors';
  deftable($('server'), [
    ['version', j.sha.slice(0, 9)],
    ['uptime', uptime(j.uptimeSeconds)],
    deployRow(j.deploy),
    ['domain', j.domain],
    // The local database is what the site sheet's trees and driveways come
    // from, so "building" or "absent" is the difference between a full sheet
    // and a thin one, not just a slower one.
    ['openstreetmap', osm, j.osm.mode === 'local' && j.osm.state !== 'serving' ? 'warn' : ''],
    ['queue', j.queue.running + ' running, ' + j.queue.queued + ' waiting'],
  ]);
}

function renderDisk(j) {
  const d = j.disk;
  const pct = d.budgetBytes ? Math.round((d.usedBytes / d.budgetBytes) * 100) : 0;
  // Free space on the volume is the one that ends the service: the Overpass
  // database shares it, and it is the first thing to look at when sheets start
  // failing for no reason the log explains.
  const lowFree = d.freeBytes !== null && d.freeBytes < 2 * 1024 ** 3;
  deftable($('disk'), [
    ['sheets', bytes(d.usedBytes) + ' of ' + bytes(d.budgetBytes) + ' budget (' + pct + '%)',
      pct >= 90 ? 'warn' : ''],
    ['volume free', d.freeBytes === null ? '—'
      : bytes(d.freeBytes) + ' of ' + bytes(d.totalBytes), lowFree ? 'warn' : ''],
  ]);
}

function renderJobs(list) {
  const host = $('jobs');
  host.innerHTML = '';
  $('empty').hidden = list.length > 0;
  $('jobcount').textContent = list.length ? '(' + list.length + ')' : '';

  for (const j of list) {
    const row = document.createElement('div');
    row.className = 'job ' + j.status;

    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = clock(j.createdAt);

    const what = document.createElement('div');
    what.className = 'what';
    const addr = document.createElement('div');
    addr.className = 'addr';
    addr.textContent = j.address;
    const spec = document.createElement('div');
    spec.className = 'spec muted';
    spec.textContent = [
      j.sheet,
      j.sheet === 'summary' ? null : j.scale ? '1:' + j.scale : 'auto scale',
      j.sheet === 'summary' ? null : j.rotate === 'auto' ? 'aligned' : 'north up',
      j.sheet === 'context' ? j.template : null,
    ].filter(Boolean).join(' · ');
    what.append(addr, spec);
    // A failure is only useful with its reason, and the reason is the whole
    // point of looking at this page.
    if (j.status === 'error' && j.error) {
      const why = document.createElement('div');
      why.className = 'why';
      why.textContent = j.error;
      what.append(why);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const st = document.createElement('div');
    st.className = 'st';
    st.textContent = j.status;
    const num = document.createElement('div');
    num.className = 'num muted';
    num.textContent = duration(j.durationMs) + (j.bytes ? ' · ' + bytes(j.bytes) : '');
    meta.append(st, num);

    row.append(when, what, meta);
    host.append(row);
  }
}

// ---- polling -------------------------------------------------------------

async function refresh() {
  let r;
  try {
    r = await fetch('/api/status');
  } catch {
    return;                       // a deploy is landing; the next tick will do
  }
  if (r.status === 403 || r.status === 401) {
    $('denied').hidden = false;
    $('view').hidden = true;
    return;
  }
  if (!r.ok) return;
  let j;
  try { j = JSON.parse(await r.text()); } catch { return; }
  $('denied').hidden = true;
  $('view').hidden = false;
  renderServer(j);
  renderDisk(j);
  renderJobs(j.jobs || []);
}

refresh();
setInterval(refresh, REFRESH_MS);
