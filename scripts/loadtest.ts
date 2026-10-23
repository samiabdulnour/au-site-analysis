// Load test: how many sheets one server draws at once, and what it costs.
//
//   npx tsx scripts/loadtest.ts --workers 10 --levels 5,10,30 --sheet context
//
// Boots a server of its own (src/server.ts) on throwaway directories with
// WORKERS set, then for each level submits that many sheets at the same
// moment, each for a different address, and follows every one to the end.
// While they run it samples this machine's CPU and memory once a second. Per
// level it reports how long the whole lot took, how long each waited in the
// queue and then took to draw, what failed and why, and the peaks.
//
// Options:
//   --workers N        WORKERS for the server it boots (default 4)
//   --levels a,b,c     sheets submitted together, one level after another (default 1,5,10)
//   --sheet KIND       context | site | yield | slides | mix (default context;
//                      mix takes them in turn)
//   --addresses FILE   one address per line instead of the built-in thirty
//   --base URL         test a server that is already running instead; its
//                      per-IP budget (JOBS_PER_HOUR) must allow the sheets, and
//                      CPU and memory are only sampled if it is on this machine
//   --port N           port for the server it boots (default 3190)
//
// Anything else the server reads (OVERPASS_LOCAL, PRINT_SLOTS,
// UPSTREAM_PER_HOST, the API keys) is passed through from this environment.
//
// The sheets are real: every one fetches from the same services a visitor's
// does, bounded per host by the server's slots (src/lib/slots.ts). Thirty
// site reports against the public services is a real load on them; run the
// big levels where the data is held locally, or with --sheet context.
//
// The report is printed and kept in out/loadtest/<time>.json.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const WORKERS = Math.max(1, Number(arg('workers', '4')) || 4);
const LEVELS = String(arg('levels', '1,5,10')).split(',').map(Number).filter((n) => n > 0);
const SHEET = arg('sheet', 'context')!;
const PORT = Number(arg('port', '3190'));
const BASE = arg('base') ?? `http://127.0.0.1:${PORT}`;
const KINDS = ['context', 'site', 'yield', 'slides'];
if (SHEET !== 'mix' && !KINDS.includes(SHEET)) {
  console.error(`--sheet must be one of ${[...KINDS, 'mix'].join(', ')}`);
  process.exit(1);
}

// Thirty addresses across Greater Sydney, each checked to geocode, so a level
// of thirty draws thirty different sites rather than one site's cache.
const BUILT_IN = [
  '150 George Street, Parramatta NSW 2150', '30 Campsie Street, Campsie NSW 2194', '1 Bay Street, Botany NSW 2019',
  '100 Market Street, Sydney NSW 2000', '50 Bridge Street, Sydney NSW 2000', '100 Oxford Street, Paddington NSW 2021',
  '300 Crown Street, Darlinghurst NSW 2010', '10 Railway Parade, Burwood NSW 2134', '20-34 Hunter Street, Hornsby NSW 2077',
  '20 Hall Street, Bondi Beach NSW 2026', '20 Belmore Road, Randwick NSW 2031', '10 Pitt Street, Mortdale NSW 2223',
  '100 Liverpool Road, Ashfield NSW 2131', '100 Church Street, Ryde NSW 2112', '30 Archer Street, Chatswood NSW 2067',
  '50 Pacific Highway, North Sydney NSW 2060', '10 Darcy Street, Parramatta NSW 2150', '100 Walker Street, North Sydney NSW 2060',
  '100 Queen Street, Campbelltown NSW 2560', '10 The Boulevarde, Strathfield NSW 2135', '50 Pitt Street, Redfern NSW 2016',
  '15 Wentworth Street, Manly NSW 2095', '10 Rowe Street, Eastwood NSW 2122', '10-12 Beamish Street, Campsie NSW 2194',
  '100 Princes Highway, Arncliffe NSW 2205', '100 John Street, Cabramatta NSW 2166', '40 King Street, Newtown NSW 2042',
  '1 Burwood Road, Concord NSW 2137', '60 Military Road, Neutral Bay NSW 2089', '10 Phillip Street, Glebe NSW 2037',
];
const ADDRESSES = arg('addresses')
  ? readFileSync(arg('addresses')!, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : BUILT_IN;

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
const s = (ms: number) => `${(ms / 1000).toFixed(0)}s`;
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

// ---- this machine, sampled -------------------------------------------------------
// Linux only (/proc), which is what the server runs on; elsewhere the columns
// are left empty rather than guessed.
const canSample = existsSync('/proc/stat') && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(BASE);
function cpuTicks(): { busy: number; total: number } | null {
  try {
    const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = f[3] + (f[4] ?? 0);
    const total = f.reduce((a, b) => a + b, 0);
    return { busy: total - idle, total };
  } catch { return null; }
}
function memUsedMb(): number | null {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8');
    const kb = (k: string) => Number(m.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? NaN);
    return Math.round((kb('MemTotal') - kb('MemAvailable')) / 1024);
  } catch { return null; }
}

// ---- the server ---------------------------------------------------------------------
let server: ChildProcess | undefined;
let tmp: string | undefined;
async function bootServer() {
  tmp = mkdtempSync(join(tmpdir(), 'loadtest-'));
  server = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'server.ts')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT), WORKERS: String(WORKERS),
      WEB_OUT_DIR: join(tmp, 'web'), ACCOUNTS_DIR: join(tmp, 'accounts'),
      // A budget for the test, not the public one; and no human check, email
      // or billing, none of which a load test touches.
      JOBS_PER_HOUR: '100000',
      TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
      STRIPE_SECRET_KEY: '', RESEND_API_KEY: '', SMTP_HOST: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout!.on('data', (d) => { log += d; });
  server.stderr!.on('data', (d) => { log += d; });
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`server exited:\n${log}`);
    try { if ((await fetch(`${BASE}/api/me`)).ok) return; } catch { /* not up yet */ }
    await nap(500);
  }
  throw new Error(`server did not come up:\n${log}`);
}
function stopServer() {
  server?.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

// ---- one level --------------------------------------------------------------------
interface JobRow {
  address: string; sheet: string; id?: string; status: string; error?: string;
  submittedAt: number; startedAt?: number; finishedAt?: number;
}

async function runLevel(n: number, offset: number) {
  const rows: JobRow[] = Array.from({ length: n }, (_, i) => ({
    address: ADDRESSES[(offset + i) % ADDRESSES.length],
    sheet: SHEET === 'mix' ? KINDS[i % KINDS.length] : SHEET,
    status: 'submitting', submittedAt: 0,
  }));
  const t0 = Date.now();
  // All at once: the point is what the server does when they arrive together.
  await Promise.all(rows.map(async (r) => {
    r.submittedAt = Date.now();
    try {
      const res = await fetch(`${BASE}/api/jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: r.address, sheet: r.sheet, fresh: true }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || !body.id) { r.status = 'error'; r.error = `submit HTTP ${res.status}: ${body.error ?? ''}`; r.finishedAt = Date.now(); return; }
      r.id = body.id; r.status = 'queued';
    } catch (e: any) {
      r.status = 'error'; r.error = `submit failed: ${e?.message ?? e}`; r.finishedAt = Date.now();
    }
  }));

  const cpu0 = cpuTicks(), mem0 = memUsedMb();
  let lastCpu = cpu0, peakCpu = 0, peakMem = mem0 ?? 0;
  const cores = cpus().length;
  let lastPrint = 0;
  while (rows.some((r) => r.status === 'queued' || r.status === 'running')) {
    await nap(1000);
    await Promise.all(rows.filter((r) => r.id && (r.status === 'queued' || r.status === 'running')).map(async (r) => {
      try {
        const j: any = await (await fetch(`${BASE}/api/jobs/${r.id}`)).json();
        if (j.status === 'running' && !r.startedAt) r.startedAt = Date.now();
        if (j.status === 'done' || j.status === 'error') {
          r.startedAt ??= Date.now();
          r.finishedAt = Date.now();
          r.error = j.error;
        }
        r.status = j.status ?? r.status;
      } catch { /* the next poll */ }
    }));
    if (canSample) {
      const c = cpuTicks();
      if (c && lastCpu && c.total > lastCpu.total) peakCpu = Math.max(peakCpu, (c.busy - lastCpu.busy) / (c.total - lastCpu.total));
      lastCpu = c;
      const m = memUsedMb();
      if (m !== null) peakMem = Math.max(peakMem, m);
    }
    if (Date.now() - lastPrint > 15_000) {
      lastPrint = Date.now();
      const count = (st: string) => rows.filter((r) => r.status === st).length;
      console.log(`  ${s(Date.now() - t0)}: ${count('queued')} queued, ${count('running')} running, ${count('done')} done, ${count('error')} failed`);
    }
  }
  const wall = Date.now() - t0;
  const cpu1 = cpuTicks();
  const done = rows.filter((r) => r.status === 'done');
  const waits = rows.filter((r) => r.startedAt).map((r) => r.startedAt! - r.submittedAt);
  const runs = done.map((r) => r.finishedAt! - r.startedAt!);
  return {
    level: n, workers: arg('base') ? null : WORKERS, sheet: SHEET,
    wallMs: wall, done: done.length, failed: rows.length - done.length,
    sheetsPerMinute: done.length ? +(done.length / (wall / 60_000)).toFixed(2) : 0,
    waitMs: { p50: pct(waits, 50), max: Math.max(0, ...waits) },
    runMs: { p50: pct(runs, 50), p95: pct(runs, 95), max: Math.max(0, ...runs) },
    machine: canSample ? {
      cores,
      avgCpu: cpu0 && cpu1 ? +((cpu1.busy - cpu0.busy) / (cpu1.total - cpu0.total)).toFixed(2) : null,
      peakCpu: +peakCpu.toFixed(2),
      memBeforeMb: mem0, peakMemMb: peakMem, peakMemAddedMb: mem0 === null ? null : peakMem - mem0,
    } : null,
    errors: rows.filter((r) => r.status !== 'done').map((r) => ({ address: r.address, sheet: r.sheet, error: r.error ?? r.status })),
  };
}

// ---- the run ------------------------------------------------------------------------
process.on('SIGINT', () => { stopServer(); process.exit(130); });
const results = [];
try {
  if (!arg('base')) {
    console.log(`booting a server with WORKERS=${WORKERS} on :${PORT}…`);
    await bootServer();
  }
  let offset = 0;
  for (const n of LEVELS) {
    console.log(`\nlevel ${n}: ${n} × ${SHEET} submitted together`);
    const r = await runLevel(n, offset);
    offset += n;    // the next level starts on addresses this one did not draw
    results.push(r);
    const m = r.machine;
    console.log(`  all finished in ${s(r.wallMs)}: ${r.done} done, ${r.failed} failed, ${r.sheetsPerMinute} sheets/min`);
    console.log(`  queue wait p50 ${s(r.waitMs.p50)}, max ${s(r.waitMs.max)}; drawing p50 ${s(r.runMs.p50)}, p95 ${s(r.runMs.p95)}, max ${s(r.runMs.max)}`);
    if (m) console.log(`  CPU avg ${Math.round((m.avgCpu ?? 0) * 100)}%, peak ${Math.round(m.peakCpu * 100)}% of ${m.cores} cores; memory +${m.peakMemAddedMb} MB at peak (${m.peakMemMb} MB in use)`);
    for (const e of r.errors) console.log(`  FAILED ${e.sheet} ${e.address}: ${e.error}`);
  }
} finally {
  stopServer();
}

const dir = join(ROOT, 'out', 'loadtest');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), base: BASE, workers: arg('base') ? null : WORKERS, levels: results }, null, 2));
console.log(`\nreport: ${file}`);
