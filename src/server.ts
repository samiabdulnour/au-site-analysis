// Web interface: enter a NSW address, get the CONTEXT ANALYSIS PDF.
// Plain node:http, no extra dependencies. Each job is drawn in a process of
// its own (src/worker.ts), WORKERS of them at once (default 1); what they may
// ask of each upstream host, and how many browsers they may open, is counted
// across all of them (src/lib/slots.ts).
//
//   npm run serve     # http://localhost:3000  (PORT to change)
//
// Open to anyone: drawing needs no account, and without one a drawing is its
// picture on the page. A free account (an email and a password) downloads the
// PDFs, served watermarked (src/render/watermark.ts), and is what buying starts
// from — unlocking an address, or the subscription (src/billing.ts,
// src/plans.ts) — which serves them clean with the CAD and data files beside
// them. What holds the open side down is the per-IP budgets
// and the bounded worker pool, not a login. ACCESS_CODE, when set, is the
// office's shared code and carries the subscription. Set ALLOW_NO_AUTH=1 only
// for local use: everything granted, and SIGN IN never offered.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { rm, readdir, stat, statfs, utimes } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { fork } from 'node:child_process';
import { suggestAddresses } from './fetch/geocode.js';
import { themeFor, type SheetKind } from './render/template.js';
import { previewOf, type SheetSpec, type DrawnSheet } from './draw.js';
import { serveSlots, slotState } from './lib/slots.js';
import { stampPdf, watermarkId } from './render/watermark.js';
import { GRANTS, PRICE_LABEL, SITE_PRICE_LABEL, planOf, paidFor, siteKey, type Plan, type Grants } from './plans.js';
import { TERMS_VERSION } from './terms.js';
import {
  initAccounts, accountFromCookie, accountCounts, createAccount, signIn, sessionCookieValue,
  normaliseEmail, validEmail, PASSWORD_MIN, ACCOUNT_COOKIE, SESSION_DAYS, type Account,
  unlockedSites, siteUnlocked, accountByEmail,
  isVerified, issueVerification, confirmEmail, accountByVerifyToken,
  issueReset, accountByResetToken, resetPassword,
  hashPassword, startSignup, dropSignup, finishSignup,
} from './accounts.js';
import {
  emailEnabled, emailVia, sendVerification, sendReset, sendSignupLink, sendAlreadyRegistered, EmailCapped,
} from './email.js';
import { humanCheckKey, isHuman } from './human.js';
import {
  billingEnabled, subscriptionsOpen, sitesOpen, webhookEnabled, checkoutUrl, siteCheckoutUrl, portalUrl,
  verifySignature, handleEvent, checkBilling, webhookSeen,
} from './billing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (TFNSW_API_KEY, ACCESS_CODE) like the CLI does.
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// One door. There used to be two — a public entrance and an office one — but
// the only thing they separated was the office graphic template, and that sheet
// is drawn in ArchiCAD now. A door that grants nothing the other does not is
// just a second lock on the same room.
//
// What did not go with it is the operator permission. /status names the
// addresses people searched for and why their sheets failed, and it had been
// riding on the office tier because that was the only notion of "privileged"
// this server had. It gets its own credential rather than inheriting one from
// a graphic style that no longer exists.
//
// The shared code is no longer the only way in: accounts are (src/accounts.ts).
// It stays as the office's own code, which carries the subscription, so the
// people already using it keep clean PDFs and their CAD without an account.
// Unset, it opens nothing and accounts are the only door.
const ACCESS_CODE = process.env.ACCESS_CODE ?? '';
// Its own secret, deliberately not inherited from the office code that used to
// gate the house style. Those grant different things: one drew a template, this
// one shows every address anyone searched for and why their sheets failed.
// Unset, nothing opens /status — which is the right way for it to fail.
const ADMIN_CODE = process.env.ADMIN_CODE ?? '';
// Local use: no sign-in at all, and everything granted. Only when no code is
// set either — a server given a code is a server meant to ask for it.
const NO_AUTH = process.env.ALLOW_NO_AUTH === '1' && !ACCESS_CODE;
// An empty code must never derive a usable token, or an unset ADMIN_CODE would
// hand the status view to anyone presenting the HMAC of the empty key.
const tokenFor = (code: string) =>
  code ? createHmac('sha256', code).update('site-analyst-session-v1').digest('hex') : '';
const SESSION_TOKEN = tokenFor(ACCESS_CODE);
const ADMIN_SESSION_TOKEN = tokenFor(ADMIN_CODE);

const JOB_RETENTION_MS = 24 * 3600 * 1000;
// Both on the host volume in production. Settable so a test can run the
// server against directories of its own.
const WEB_OUT = process.env.WEB_OUT_DIR?.trim() || join(ROOT, 'out', 'web');
const ACCOUNTS_DIR = process.env.ACCOUNTS_DIR?.trim() || join(ROOT, 'out', 'accounts');

// Is the local Overpass container up and serving yet? Reported by /api/version
// so the switchover can be checked without shell access to the host. Cached,
// because /api/version is public and this reaches a neighbouring container.
// deploy/ensure-overpass.sh writes a one-line status here on the host; the
// directory is mounted read-only into this container. Sanitised and length-
// capped before publishing, since /api/version is unauthenticated.
function hostFile(path: string, cap: number): string {
  try {
    return readFileSync(path, 'utf8').replace(/[^\w.:/= ()-]/g, '').trim().slice(0, cap) || 'empty';
  } catch { return 'none'; }
}

function hostStatus(): string {
  try {
    return readFileSync('/hostinfo/overpass.status', 'utf8')
      .replace(/[^\w.:= -]/g, '').trim().slice(0, 80) || 'empty';
  } catch {
    // Tell the two failures apart: no mount means this container predates the
    // change, no file means ensure-overpass.sh is not running on the host.
    return existsSync('/hostinfo') ? 'no-status-file' : 'no-mount';
  }
}

/**
 * The deployer's own account of its last pass — what it did and when, written
 * by a trap in deploy/update.sh so that a pass which died still leaves one.
 *
 * The age is the half that makes it worth anything. `up-to-date` from a
 * deployer that stopped running last week reads exactly like `up-to-date` from
 * one that ran a minute ago, and the difference between those was six days of
 * this server quietly not deploying anything while every other line here went
 * on looking healthy.
 */
function deployStatus(): { text: string; ageSeconds: number | null } {
  const text = hostFile('/hostinfo/deploy.status', 100);
  const m = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z/);
  const at = m ? Date.parse(`${m[1]}Z`) : NaN;
  return {
    text,
    ageSeconds: Number.isNaN(at) ? null : Math.max(0, Math.round((Date.now() - at) / 1000)),
  };
}

let osmProbe: { at: number; state: string } = { at: 0, state: 'unknown' };
async function probeLocalOverpass(): Promise<string> {
  if (Date.now() - osmProbe.at < 60_000) return osmProbe.state;
  // `||`, not `??`: the deployer passes OVERPASS_LOCAL="" when it is unset,
  // so the variable exists but is empty and `??` would not fall back.
  const url = process.env.OVERPASS_LOCAL?.trim() || 'http://overpass-nsw/api/interpreter';
  let state = 'absent';
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: '[out:json][timeout:5];node(-33.9125,151.1000,-33.9105,151.1040)["highway"="bus_stop"];out 2;' }),
      signal: AbortSignal.timeout(8_000),
    });
    const text = await res.text();
    state = text.trimStart().startsWith('{') ? 'serving' : 'building';
  } catch (e: any) {
    // Tell "still building" apart from "never installed": while the database
    // builds the container exists but Apache is not up yet (ECONNREFUSED),
    // whereas a missing container fails to resolve at all (ENOTFOUND).
    const code = e?.cause?.code ?? e?.code ?? '';
    state = code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'absent' : `building (${code || 'no answer'})`;
  }
  osmProbe = { at: Date.now(), state };
  return state;
}

/**
 * The drawing a request names. The yield took the summary's place in the
 * options table; the summary is still drawn for a request that asks for it,
 * so a batch or a bookmark from before keeps working.
 */
function sheetKind(v: unknown): SheetKind {
  return v === 'site' || v === 'summary' || v === 'yield' || v === 'slides' ? v : 'context';
}

/** What each drawing's PDF is called when it is downloaded. */
const PDF_NAME: Record<SheetKind, string> = {
  context: 'CONTEXT_ANALYSIS', site: 'SITE_ANALYSIS', summary: 'DEVELOPMENT_SUMMARY', yield: 'PLANNING_YIELD', slides: 'OVERALL_ANALYSIS',
};

interface Job {
  id: string;
  address: string;
  sheet: SheetKind;
  scale: number;            // 0 = auto (site sheets, slides)
  rotate: 'north' | 'auto';
  template: string;
  key: string;              // what makes two requests the same request
  status: 'queued' | 'running' | 'done' | 'error';
  log: string[];
  pdfPath?: string;
  cadPath?: string;
  dataPath?: string;   // CSV for table sheets, JSON for the deck
  error?: string;
  createdAt: number;
  // For the status view: how long it took, and what it is costing the disk.
  startedAt?: number;
  finishedAt?: number;
  bytes?: number;
}

const jobs = new Map<string, Job>();

// ---- the job index -------------------------------------------------------
//
// A finished sheet is reachable only through its job record: the PDF sits in
// out/web/<id>/ under a name nobody is told, so losing the record loses the
// drawing even though the file is still there. Keeping the records in memory
// alone meant every deploy took them, and the auto-deployer lands one whenever
// main moves — a visitor who generated a sheet five minutes before a
// commit landed got "service restarted, job lost" on a PDF that existed.
//
// So the map is mirrored to disk on every state change and read back at boot.
// out/ is a host volume (deploy/update.sh), so the directory outlives the
// container that wrote it.
const JOB_INDEX = join(WEB_OUT, 'jobs.json');

/**
 * What makes two requests the same request: the address and every option that
 * changes the drawing. The typed address is normalised for case, punctuation
 * and spacing, so "1 Bay Street, Botany" and "1 BAY STREET BOTANY," are one
 * request. Two genuinely different spellings of the same address are still two,
 * because the geocode that would settle it happens inside the pipeline this is
 * trying to avoid running — and the type-ahead hands back one canonical string,
 * which is what most repeats are.
 */
function jobKey(r: Pick<Job, 'address' | 'sheet' | 'scale' | 'rotate' | 'template'>): string {
  return createHash('sha256')
    .update([siteKey(r.address), r.sheet, r.scale, r.rotate, r.template].join('|'))
    .digest('hex').slice(0, 32);
}

/**
 * The same request already answered, or being answered right now. A sheet takes
 * one to three minutes of somebody else's public data services, and the
 * controls it draws move in months, so asking twice inside the retention window
 * should not fetch and compose twice.
 */
function reusable(key: string): Job | undefined {
  const same = [...jobs.values()].filter((j) => j.key === key);
  // In flight wins over finished: it is the fresher of the two, and following
  // it is what stops two people asking at once from queueing the sheet twice.
  const live = same.find((j) => j.status === 'running' || j.status === 'queued');
  if (live) return live;
  return same
    .filter((j) => j.status === 'done' && j.pdfPath && existsSync(j.pdfPath))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

interface StoredJob {
  id: string; address: string; sheet: Job['sheet']; scale: number;
  rotate: Job['rotate']; template: string; status: Job['status'];
  log: string[]; error?: string; createdAt: number;
  startedAt?: number; finishedAt?: number; bytes?: number;
  // Basenames, not paths: what the record has to survive is a new container,
  // and an absolute path is a fact about the old one.
  pdf?: string; cad?: string; data?: string;
}

function saveIndex() {
  const rows: StoredJob[] = [...jobs.values()].map((j) => ({
    id: j.id, address: j.address, sheet: j.sheet, scale: j.scale,
    rotate: j.rotate, template: j.template, status: j.status,
    // Only the tail is ever served, so only the tail is worth keeping.
    log: j.log.slice(-12), error: j.error, createdAt: j.createdAt,
    startedAt: j.startedAt, finishedAt: j.finishedAt, bytes: j.bytes,
    pdf: j.pdfPath && basename(j.pdfPath),
    cad: j.cadPath && basename(j.cadPath),
    data: j.dataPath && basename(j.dataPath),
  }));
  try {
    mkdirSync(WEB_OUT, { recursive: true });
    // Written whole and moved into place. A deploy landing mid-write would
    // otherwise leave a half-written file, and that loses every job rather
    // than the one being saved.
    const tmp = `${JOB_INDEX}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rows));
    renameSync(tmp, JOB_INDEX);
  } catch { /* the index is a convenience; never fail a job over it */ }
}

function loadIndex() {
  let rows: unknown;
  try { rows = JSON.parse(readFileSync(JOB_INDEX, 'utf8')); } catch { return; }
  if (!Array.isArray(rows)) return;
  let restored = 0, interrupted = 0;
  for (const r of rows as StoredJob[]) {
    if (!r || typeof r.id !== 'string' || !/^[0-9a-f-]{36}$/.test(r.id)) continue;
    const dir = join(WEB_OUT, r.id);
    // A job that was queued or running when the container went away cannot be
    // picked up — the pipeline's work was in the process that died. Say that,
    // rather than leaving it queued behind a queue that no longer exists.
    const lost = r.status === 'queued' || r.status === 'running';
    const job: Job = {
      id: r.id,
      address: String(r.address ?? ''),
      sheet: sheetKind(r.sheet),
      scale: Number(r.scale) || 0,
      rotate: r.rotate === 'auto' ? 'auto' : 'north',
      template: String(r.template ?? ''),
      status: lost ? 'error' : r.status === 'done' ? 'done' : 'error',
      log: Array.isArray(r.log) ? r.log.map(String) : [],
      error: lost ? 'interrupted by a server restart — run again' : r.error,
      createdAt: Number(r.createdAt) || Date.now(),
      // Records from when jobs carried a door still have `tier`; it is simply
      // not read, so they load as they are rather than needing a migration.
      startedAt: Number(r.startedAt) || undefined,
      finishedAt: Number(r.finishedAt) || undefined,
      bytes: Number(r.bytes) || undefined,
      key: '',
    };
    // Recomputed, not read back: the key is derived from fields that are all
    // here, so a change to how requests are matched takes effect for the sheets
    // already on disk instead of only for the next ones.
    job.key = jobKey(job);
    if (job.status === 'done') {
      // Only the files still on disk: a sheet outlives the container but not
      // the 24h sweep, and a link to a deleted file is worse than no link.
      const kept = (name?: string) =>
        name && existsSync(join(dir, name)) ? join(dir, name) : undefined;
      job.pdfPath = kept(r.pdf);
      job.cadPath = kept(r.cad);
      job.dataPath = kept(r.data);
      if (!job.pdfPath) continue;      // nothing left to offer
      restored += 1;
    } else if (lost) {
      interrupted += 1;
    }
    jobs.set(job.id, job);
  }
  if (restored || interrupted)
    console.log(`job index: ${restored} sheet(s) still downloadable, ${interrupted} interrupted by the restart`);
}

// ---- batches -------------------------------------------------------------
//
// A dozen sites is an ordinary afternoon's work, and submitting them one at a
// time means coming back every two minutes to start the next. A batch is
// nothing more than a named list of ordinary jobs: they queue on the same
// queue, in the same order, and each one goes through the same reuse check —
// so a batch of twelve where five are already drawn runs seven. A batch gets
// no workers of its own: it shares the pool with everyone else, so one office
// submitting a dozen does not shut the site to the next visitor for longer
// than the pool's share of it.
//
// Kept in their own file rather than folded into jobs.json, which is an array
// an older container would still read: a rollback that met an object there
// would find no jobs at all.
const BATCH_INDEX = join(WEB_OUT, 'batches.json');
const MAX_BATCH = 12;          // one hour's worth of the per-IP job budget
// The per-IP budget. A setting so a load test (scripts/loadtest.ts) can run
// thirty sheets from one address against a server of its own; the public site
// leaves it at the default.
const JOBS_PER_HOUR = Math.max(1, Number(process.env.JOBS_PER_HOUR) || 12);

interface BatchEntry {
  /** As submitted. Kept here so a row still reads after its job is swept. */
  address: string;
  jobId: string;
}
interface Batch {
  id: string;
  createdAt: number;
  sheet: Job['sheet'];
  entries: BatchEntry[];
}

const batches = new Map<string, Batch>();

function saveBatches() {
  try {
    mkdirSync(WEB_OUT, { recursive: true });
    const tmp = `${BATCH_INDEX}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify([...batches.values()]));
    renameSync(tmp, BATCH_INDEX);
  } catch { /* as with the job index, never fail a submission over this */ }
}

function loadBatches() {
  let rows: unknown;
  try { rows = JSON.parse(readFileSync(BATCH_INDEX, 'utf8')); } catch { return; }
  if (!Array.isArray(rows)) return;
  for (const r of rows as Batch[]) {
    if (!r || typeof r.id !== 'string' || !Array.isArray(r.entries)) continue;
    batches.set(r.id, {
      id: r.id,
      createdAt: Number(r.createdAt) || Date.now(),
      sheet: sheetKind(r.sheet),
      entries: r.entries
        .filter((e) => e && typeof e.address === 'string' && typeof e.jobId === 'string')
        .map((e) => ({ address: String(e.address), jobId: String(e.jobId) })),
    });
  }
}

/**
 * Position in the queue, 1 = next to run (0 = already running). A visitor who
 * is fourth in line with two workers waits for two rounds of sheets before
 * theirs starts — better to say so than to show a spinner for ten minutes.
 */
function queuePosition(job: Job): number {
  if (job.status !== 'queued') return 0;
  const waiting = [...jobs.values()]
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt);
  return waiting.findIndex((j) => j.id === job.id) + 1;
}

/**
 * Rough minutes until this job finishes, for the waiting message: the rounds
 * of the pool ahead of it, its own included. With one worker that is the old
 * count, one sheet after another.
 */
const MINUTES_PER_SHEET = 2;
function etaMinutes(job: Job): number {
  const running = [...jobs.values()].filter((j) => j.status === 'running').length;
  const ahead = job.status === 'running' ? 0 : queuePosition(job) + running;
  return Math.max(1, Math.ceil(ahead / WORKERS)) * MINUTES_PER_SHEET;
}

// ---- the worker pool ------------------------------------------------------
//
// Jobs ran one at a time for two reasons. The free services this tool fetches
// from should not see a burst of everyone's sheets at once; and the graphic
// template was a module-level global that two renders would trample. The
// second went with withTemplate(); the first is now a count per host that
// every worker shares (src/lib/slots.ts), which bounds what any one service
// sees however many sheets are being drawn. So the pool can be as wide as the
// machine: WORKERS sheets at once, each in its own process (src/worker.ts),
// and the rest wait in order.
//
// One is the default, which is how the site has always behaved. A machine with
// the data held locally can take one per core or so: a sheet keeps about a
// core busy while it composes and needs a gigabyte and a half while it prints,
// and PRINT_SLOTS bounds how many print at once.
const WORKERS = Math.max(1, Math.min(64, Math.floor(Number(process.env.WORKERS)) || 1));
// A job stuck on a service that never answers would hold its worker for good,
// so after this long it is stopped and reported, and the worker freed.
const JOB_TIMEOUT_MS = Math.max(60_000, Number(process.env.JOB_TIMEOUT_MS) || 20 * 60_000);
const WORKER = join(ROOT, 'src', 'worker.ts');

const waiting: Job[] = [];
let runningCount = 0;

function enqueue(job: Job) {
  jobs.set(job.id, job);
  saveIndex();
  waiting.push(job);
  pump();
}

function pump() {
  while (runningCount < WORKERS && waiting.length) {
    const job = waiting.shift()!;
    runningCount += 1;
    void runJob(job).finally(() => { runningCount -= 1; pump(); });
  }
}

/**
 * Draws `job` in a worker and keeps its record up to date: the progress lines
 * as they come, then the files or the error. Resolves once the worker has
 * gone, however it went, so the pool's count is always the real one.
 */
async function runJob(job: Job) {
  job.status = 'running';
  job.startedAt = Date.now();
  saveIndex();
  const outDir = join(WEB_OUT, job.id);
  const spec: SheetSpec = {
    address: job.address, sheet: job.sheet, scale: job.scale, rotate: job.rotate, template: job.template,
  };
  // The loader the server itself was started with (tsx), so the worker can
  // import TypeScript too, unless the server was started with it already.
  const execArgv = process.execArgv.some((a) => a.includes('tsx')) ? process.execArgv : [...process.execArgv, '--import', 'tsx'];
  let outcome: { done?: DrawnSheet; error?: string } = {};
  try {
    await new Promise<void>((resolve) => {
      const child = fork(WORKER, [], { cwd: ROOT, execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      serveSlots(child);
      const timer = setTimeout(() => {
        outcome = { error: `stopped after ${Math.round(JOB_TIMEOUT_MS / 60_000)} minutes — run again` };
        child.kill('SIGKILL');
      }, JOB_TIMEOUT_MS);
      child.on('message', (m: any) => {
        if (typeof m?.log === 'string') job.log.push(m.log);
        else if (m?.done) outcome = { done: m.done };
        else if (typeof m?.error === 'string') outcome = { error: m.error };
      });
      child.once('spawn', () => child.send({ run: { spec, outDir } }));
      // A fork that never started emits this and may never emit 'exit'.
      child.once('error', (e) => {
        if (!outcome.done) outcome = { error: `worker failed: ${e.message}` };
        if (child.exitCode === null && child.pid === undefined) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (!outcome.done && !outcome.error) outcome = { error: `worker stopped (${signal ?? `exit ${code}`}) — run again` };
        resolve();
      });
    });
  } catch (e: any) {
    outcome = { error: e?.message ?? String(e) };
  }
  if (outcome.done) {
    job.pdfPath = outcome.done.pdfPath;
    job.cadPath = outcome.done.cadPath;
    job.dataPath = outcome.done.dataPath;
    job.status = 'done';
    job.log.push('done');
  } else {
    job.status = 'error';
    job.error = outcome.error ?? 'unknown error';
    job.log.push(`ERROR: ${job.error}`);
  }
  job.finishedAt = Date.now();
  job.bytes = await dirBytes(outDir).catch(() => undefined);
  saveIndex();
  void cleanupOldJobs();
}

// Outputs now live on a host volume, so they accumulate for real instead of
// dying with the container. Two ceilings hold that down: age, as before, and
// total size — a sheet carries its whole GeoJSON bundle and aerial tiles, and
// what it is really competing for is the free space the Overpass database
// needs to rebuild itself. That rebuild is a fresh download rather than a
// diff, and both deploy/setup-overpass.sh and ensure-overpass.sh refuse to
// start below 12GB free, so sheets left to accumulate would not fill the
// volume so much as quietly stop the data under them being refreshed.
//
// The budget is floored, so that a mistyped one cannot sweep the directory
// bare, and the flooring is said out loud — a silently ignored setting is
// worse than a rejected one.
const OUT_BUDGET_MIN_MB = 256;
const OUT_BUDGET_MB = (() => {
  const asked = Number(process.env.WEB_OUT_BUDGET_MB) || 4096;
  if (asked < OUT_BUDGET_MIN_MB)
    console.log(`WEB_OUT_BUDGET_MB=${asked} is below the ${OUT_BUDGET_MIN_MB}MB floor — using ${OUT_BUDGET_MIN_MB}`);
  return Math.max(OUT_BUDGET_MIN_MB, asked);
})();
const OUT_BUDGET_BYTES = OUT_BUDGET_MB * 1024 * 1024;

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else total += (await stat(full).catch(() => null))?.size ?? 0;
    }
  };
  await walk(dir);
  return total;
}

/**
 * Drop what is too old, then what does not fit, then any record left pointing
 * at a file the sweep took. Runs hourly as well as after each job: it used to
 * run only at the end of a job, so an idle server never reclaimed anything and
 * yesterday's sheets sat there until somebody happened to generate a new one.
 */
async function cleanupOldJobs() {
  for (const [id, job] of jobs) {
    if (Date.now() - job.createdAt > JOB_RETENTION_MS && job.status !== 'running') jobs.delete(id);
  }
  // Per-IP counters. Without this the map keeps a row for every address that
  // ever asked for anything, which on a public site is a leak with no ceiling.
  for (const [key, b] of buckets) if (Date.now() > b.resetAt) buckets.delete(key);

  // A job still in the queue owns its directory even if it is momentarily the
  // oldest thing here, so it is never a candidate.
  const busy = new Set([...jobs.values()]
    .filter((j) => j.status === 'running' || j.status === 'queued')
    .map((j) => j.id));
  try {
    const dirs: { dir: string; mtime: number; bytes: number }[] = [];
    for (const name of await readdir(WEB_OUT)) {
      if (!/^[0-9a-f-]{36}$/.test(name)) continue;   // jobs.json, tmp files, anything else
      if (busy.has(name)) continue;
      const dir = join(WEB_OUT, name);
      const st = await stat(dir).catch(() => null);
      if (!st?.isDirectory()) continue;
      if (Date.now() - st.mtimeMs > JOB_RETENTION_MS) {
        await rm(dir, { recursive: true, force: true });
        continue;
      }
      const bytes = await dirBytes(dir);
      // The sweep is already walking, so the status view gets its sizes free.
      const owner = jobs.get(name);
      if (owner) owner.bytes = bytes;
      dirs.push({ dir, mtime: st.mtimeMs, bytes });
    }
    // Over budget: oldest first, which is also least likely to be wanted again.
    let total = dirs.reduce((n, d) => n + d.bytes, 0);
    if (total > OUT_BUDGET_BYTES) {
      dirs.sort((a, b) => a.mtime - b.mtime);
      for (const d of dirs) {
        if (total <= OUT_BUDGET_BYTES) break;
        await rm(d.dir, { recursive: true, force: true });
        total -= d.bytes;
        console.log(`out/web over budget — removed ${basename(d.dir)} (${Math.round(d.bytes / 1e6)}MB)`);
      }
    }
  } catch { /* out/web may not exist yet */ }

  // Whatever the sweep took, the records that named it are dead links now.
  for (const [id, job] of jobs) {
    if (job.status === 'done' && job.pdfPath && !existsSync(job.pdfPath)) jobs.delete(id);
  }
  saveIndex();
}

// ---- tiny per-IP rate limiting ------------------------------------------
const buckets = new Map<string, { count: number; resetAt: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  b.count += 1;
  return b.count > max;
}

// A batch spends several at once, and has to know what it can afford before it
// starts creating jobs — half a batch accepted is worse than none, because the
// visitor cannot tell which half.
function remaining(key: string, max: number, windowMs: number): number {
  const b = buckets.get(key);
  if (!b || Date.now() > b.resetAt) return max;
  return Math.max(0, max - b.count);
}
function spend(key: string, windowMs: number, n: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) buckets.set(key, { count: n, resetAt: now + windowMs });
  else b.count += n;
}
// The last entry, not the first: Caddy appends the address it was reached
// from, and anything before that is whatever the visitor chose to send. Older
// Caddy passes a visitor's own X-Forwarded-For through, so the first entry is
// one a bot could change on every request to start every limit afresh.
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',').pop()!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// Wrong passwords, counted per account and per address over fifteen minutes.
// With the human check on, a few of them put it in front of the next attempt
// rather than refusing it: a lockout is a way for a stranger to keep an owner
// out of their own account. Without the check, the account's attempts are
// held for the rest of the window after many, which is the only brake left.
const FAIL_WINDOW = 15 * 60_000;
const failuresOf = (key: string) => {
  const b = buckets.get(key);
  return b && Date.now() <= b.resetAt ? b.count : 0;
};
const failed = (key: string) => spend(key, FAIL_WINDOW, 1);

// ---- auth ----------------------------------------------------------------
function sameToken(got: string, want: string): boolean {
  if (!want) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionToken(req: IncomingMessage): string | null {
  const m = (req.headers.cookie ?? '').match(/(?:^|;\s*)sa_session=([0-9a-f]{64})/);
  return m ? m[1] : null;
}

/**
 * Who is asking, and which side of the site they are on. Three ways in:
 *
 *   an account     email and password; free until it subscribes
 *   ACCESS_CODE    the office's shared code, which carries the subscription
 *   ADMIN_CODE     the operator's, which carries it too and opens /status
 *
 * A browser can hold an account and a code at once — the office signed in to
 * an account to see what a free visitor gets, say — and then has the better.
 */
interface Viewer {
  /** Holds a session — an account or a code. Drawing does not need one; this
   *  is what SIGN OUT means, and what buying starts from. */
  signedIn: boolean;
  operator: boolean;
  /** Holds the office or operator code, which generates without an account. */
  code: boolean;
  plan: Plan;
  account?: Account;
}

/** The code session this request holds, if any. */
function heldCode(req: IncomingMessage): { code: boolean; operator: boolean } {
  if (NO_AUTH) return { code: true, operator: true };
  const t = sessionToken(req);
  const operator = Boolean(t) && sameToken(t!, ADMIN_SESSION_TOKEN);
  return { code: operator || (Boolean(t) && sameToken(t!, SESSION_TOKEN)), operator };
}

function viewerFrom(held: { code: boolean; operator: boolean }, account?: Account): Viewer {
  return {
    signedIn: held.code || Boolean(account),
    operator: held.operator,
    code: held.code,
    plan: held.code ? 'subscription' : account ? planOf(account) : 'guest',
    account,
  };
}

const viewerOf = (req: IncomingMessage) => viewerFrom(heldCode(req), accountFromCookie(req.headers.cookie));

/**
 * What /api/me says about a session, and what a sign-in answers with: one
 * shape from one place, so the page reads the same whichever arrives first.
 */
function describe(v: Viewer) {
  const a = v.account;
  return {
    authed: v.signedIn,
    operator: v.operator,
    // `required` is not a secret: the sign-in form is shown to anyone. It
    // tells the page whether signing out means anything here.
    required: !NO_AUTH,
    plan: v.plan,
    grants: GRANTS[v.plan],
    account: a ? {
      email: a.email,
      // Whether generating waits on the verification click. With email off
      // there is no link to click, so nothing is said to wait on one.
      verified: !emailEnabled || isVerified(a),
      status: a.subscriptionStatus ?? null,
      renewsAt: a.currentPeriodEnd ?? null,
      // Stripe's portal needs a customer, which an account has once it has
      // been through Checkout.
      portal: billingEnabled && Boolean(a.stripeCustomerId),
      sites: unlockedSites(a).map((s) => ({ address: s.address, until: s.until })),
    } : null,
    // Which ways to pay are open here.
    billing: { subscription: subscriptionsOpen, site: sitesOpen },
    // The human check's site key, public by design, or null when there is none.
    humanCheck: humanCheckKey,
  };
}

/**
 * What this viewer may take away of this job: the plan's grants, or the
 * subscription's when the account has bought the job's site.
 */
function grantsFor(v: Viewer, job: Job): Grants {
  return v.account && siteUnlocked(v.account, job.address) ? GRANTS.subscription : GRANTS[v.plan];
}

function cookie(req: IncomingMessage, name: string, value: string, maxAgeSeconds: number): string {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/${secure}`;
}

/** The codes are checked with a constant-time compare over a fixed width. */
function codeMatches(given: string, want: string): boolean {
  if (!want) return false;
  return timingSafeEqual(
    Buffer.from(given.padEnd(256).slice(0, 256)),
    Buffer.from(want.padEnd(256).slice(0, 256)),
  );
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on('end', () => resolve(body));
  });
}

/**
 * The body as the bytes that arrived, for a signature computed over exactly
 * those: Stripe's webhooks are larger than readBody allows, and a string built
 * chunk by chunk can split a multi-byte character. Null past the cap.
 */
function readRaw(req: IncomingMessage, cap: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > cap) { resolve(null); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ---- the free side's PDFs ------------------------------------------------
//
// Stamped on the first download and kept beside the clean one, named for the
// watermark they carry. In flight here, so two free visitors opening one sheet
// at once stamp it once.
const stamping = new Map<string, Promise<string>>();

/**
 * Downloads say whose they are. A cache in between must not hand a
 * subscriber's clean PDF to the next free visitor, nor a stamped one to
 * someone who has just subscribed.
 */
const PRIVATE = { 'Cache-Control': 'private, no-store' };

function watermarked(job: Job): Promise<string> {
  const dest = job.pdfPath!.replace(/\.pdf$/, `.wm-${watermarkId()}.pdf`);
  if (existsSync(dest)) return Promise.resolve(dest);
  let pending = stamping.get(dest);
  if (!pending) {
    pending = (async () => {
      // Writing into the job's directory moves its mtime, which the sweep ages
      // it by; put it back, so a sheet opened on its last day still goes on time.
      const dir = dirname(dest);
      const before = await stat(dir);
      await stampPdf(job.pdfPath!, dest);
      await utimes(dir, before.atime, before.mtime).catch(() => {});
      return dest;
    })().finally(() => stamping.delete(dest));
    stamping.set(dest, pending);
  }
  return pending;
}

/**
 * Without an account a drawing is its picture on the page: the PDF, stamped or
 * not, starts with one. 401 rather than 402: signing up is free, so what is
 * missing is who is asking, not what they have paid for.
 */
const PDF_NEEDS_ACCOUNT = { error: 'Make a free account to download the PDF.', signup: true };

/** The PDF this viewer is given: the sheet as drawn, or the stamped copy. Never the first on a failure of the second. */
const pdfFor = (job: Job, v: Viewer) =>
  grantsFor(v, job).cleanPdf ? Promise.resolve(job.pdfPath!) : watermarked(job);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ip = clientIp(req);

  // Where this app is being reached, for the absolute URLs that cannot be
  // relative: robots.txt's sitemap line, sitemap.xml's entries, and the
  // og:url and og:image a link scraper resolves without ever seeing this
  // request. Taken from the request rather than named in the pages, which
  // would be one more thing to keep in step with SITE_DOMAIN. The host is
  // scrubbed to a hostname's own characters — a forged Host header only ever
  // poisons the answer to the request that forged it, but there is no reason
  // to reflect one back whole.
  const siteBase = () => {
    const host = String(req.headers.host ?? '').replace(/[^a-zA-Z0-9.:-]/g, '').slice(0, 100)
      || process.env.SITE_DOMAIN || 'site-analyst.com';
    const proto = req.headers['x-forwarded-proto'] === 'https' || !/^(localhost|127\.)/.test(host)
      ? 'https' : 'http';
    return `${proto}://${host}`;
  };

  // Two pages and their shared assets. Fixed table, so no path can be built
  // from user input.
  const PAGES: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/about': ['about.html', 'text/html; charset=utf-8'],
    '/pricing': ['pricing.html', 'text/html; charset=utf-8'],
    '/terms': ['terms.html', 'text/html; charset=utf-8'],
    '/pricing.js': ['pricing.js', 'text/javascript; charset=utf-8'],
    '/status': ['status.html', 'text/html; charset=utf-8'],
    '/admin': ['admin.html', 'text/html; charset=utf-8'],
    '/status.js': ['status.js', 'text/javascript; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  };
  const page = PAGES[url.pathname];
  if (req.method === 'GET' && page) {
    readFile(join(ROOT, 'web', page[0]), (err, data) => {
      if (err) { res.writeHead(500); res.end(`missing web/${page[0]}`); return; }
      // The link-preview tags need absolute URLs, so the pages write %ORIGIN%
      // and it is filled in with whatever host they were asked for. %PRICE% and
      // %SITE_PRICE% are the pricing page's, from PRICE_LABEL and
      // SITE_PRICE_LABEL, so a price change is not a deploy.
      const body = page[1].startsWith('text/html')
        ? data.toString('utf8').replaceAll('%ORIGIN%', siteBase()).replaceAll('%PRICE%', escapeHtml(PRICE_LABEL)).replaceAll('%SITE_PRICE%', escapeHtml(SITE_PRICE_LABEL))
        : data;
      res.writeHead(200, { 'Content-Type': page[1] });
      res.end(body);
    });
    return;
  }

  // ---- crawlers ----------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/robots.txt') {
    // Neither the status view nor the operator gate is a secret — the code is
    // what grants anything — but neither belongs in a search result. /api/ is
    // nothing a crawler can use.
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(`User-agent: *
Disallow: /api/
Disallow: /status
Disallow: /admin

Sitemap: ${siteBase()}/sitemap.xml
`);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
    const base = siteBase();
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>${base}/about</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>${base}/pricing</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>${base}/terms</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
`);
    return;
  }

  // RFC 9116: where a firewall or data provider that sees this tool's
  // requests can read what it is and reach its operator. The User-Agent its
  // fetchers send points at the GitHub repo; this points at the same record,
  // served from the running site so the identity is verifiable from both ends.
  if (req.method === 'GET' && (url.pathname === '/.well-known/security.txt' || url.pathname === '/security.txt')) {
    const base = siteBase();
    const repo = 'https://github.com/samiabdulnour/au-site-analysis';
    const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const contact = process.env.SITE_ANALYSIS_CONTACT?.trim();
    const contactLines = [
      contact ? `Contact: ${contact.includes('@') && !contact.includes(':') ? `mailto:${contact}` : contact}` : null,
      `Contact: ${repo}/security/advisories/new`,
      `Contact: ${repo}/issues`,
    ].filter(Boolean);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(`${contactLines.join('\n')}
Expires: ${expires}
Policy: ${repo}/blob/main/SECURITY.md
Preferred-Languages: en
Canonical: ${base}/.well-known/security.txt
`);
    return;
  }

  // Sample thumbnails for the landing page. Whitelisted names only — never
  // join user input onto a filesystem path.
  const sampleMatch = url.pathname.match(/^\/samples\/([a-z0-9_-]+\.(?:jpg|png|svg))$/);
  if (req.method === 'GET' && sampleMatch) {
    const file = join(ROOT, 'web', 'samples', sampleMatch[1]);
    readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const ext = sampleMatch[1].split('.').pop()!;
      const type = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/version') {
    return json(res, 200, {
      sha: process.env.GIT_SHA ?? 'dev',
      osm: process.env.OVERPASS_LOCAL ? 'local' : 'public',
      osmLocal: await probeLocalOverpass(),
      osmSetup: hostStatus(),
      osmLog: hostFile('/hostinfo/overpass.tail', 240),
      domain: hostFile('/hostinfo/domain.status', 60),
      // Public, like the rest of this endpoint, and deliberately so: the whole
      // failure was that nothing outside the host could see the deployer had
      // stopped. It reports a sha that is already published here and a stage
      // name, so there is nothing in it to withhold.
      deploy: deployStatus(),
      busy: [...jobs.values()].some((j) => j.status === 'running' || j.status === 'queued'),
      // Whether Stripe is configured, so the switch-on can be checked from
      // outside the host. Says nothing about any account.
      billing: billingEnabled,
    });
  }

  // What this server has actually been doing. The office door's, not any
  // authenticated session's: /api/version is the public window and says only
  // whether the thing is up, whereas this names addresses people searched for
  // and the reasons their sheets failed.
  if (req.method === 'GET' && url.pathname === '/api/status') {
    if (!viewerOf(req).operator) return json(res, 403, { error: 'Operator access only.' });
    const all = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
    const fs = await statfs(WEB_OUT).catch(() => null);
    return json(res, 200, {
      sha: process.env.GIT_SHA ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
      osm: {
        mode: process.env.OVERPASS_LOCAL ? 'local' : 'public',
        state: await probeLocalOverpass(),
        setup: hostStatus(),
      },
      domain: hostFile('/hostinfo/domain.status', 60),
      deploy: deployStatus(),
      queue: {
        running: all.filter((j) => j.status === 'running').length,
        queued: all.filter((j) => j.status === 'queued').length,
        workers: WORKERS,
        // The counted slots in use: browsers printing, requests in flight
        // to each limited host, and how many are waiting for one.
        slots: slotState(),
      },
      disk: {
        // What the sheets are using, what they are allowed, and what is left on
        // the volume underneath — the last is the one that ends the service,
        // since the Overpass database shares it.
        usedBytes: all.reduce((n, j) => n + (j.bytes ?? 0), 0),
        budgetBytes: OUT_BUDGET_BYTES,
        freeBytes: fs ? fs.bavail * fs.bsize : null,
        totalBytes: fs ? fs.blocks * fs.bsize : null,
      },
      accounts: accountCounts(),
      billing: await checkBilling(),
      // 24h of retention is already the ceiling on how many there can be.
      jobs: all.slice(0, 100).map((j) => ({
        id: j.id, address: j.address, sheet: j.sheet, scale: j.scale,
        rotate: j.rotate, template: j.template, status: j.status,
        error: j.error, createdAt: j.createdAt, bytes: j.bytes ?? null,
        // Still running: measured against now, so the number keeps climbing
        // rather than reading as zero for the two minutes it matters most.
        durationMs: j.startedAt ? (j.finishedAt ?? Date.now()) - j.startedAt : null,
      })),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    // 200 with or without a session: the page is open to anyone, and what it
    // asks here is which side of the site this viewer is on.
    return json(res, 200, describe(viewerOf(req)));
  }

  // A free account: an email and a password. With email on it is not made
  // here: the address gets a link and the click makes it (accounts.ts), so an
  // address nobody holds never becomes an account. Every sign-up is answered
  // alike — a new address, one that has an account, a bot's honeypot — so the
  // form does not say which addresses are taken; the address that is taken is
  // emailed to say so instead. With email off there is no link to send, and
  // the account is made and signed in at once, as it always was.
  if (req.method === 'POST' && url.pathname === '/api/signup') {
    if (limited(`signup:${ip}`, 5, 3600_000)) return json(res, 429, { error: 'Too many sign-ups from here. Try later.' });
    let email = '', password = '', human: unknown, trap = '';
    try {
      const parsed = JSON.parse((await readBody(req)) || '{}');
      email = normaliseEmail(parsed.email);
      password = String(parsed.password ?? '');
      human = parsed.human;
      trap = String(parsed.website ?? '');
    } catch { /* refused below */ }
    if (!validEmail(email)) return json(res, 400, { error: 'Enter an email address.' });
    if (password.length < PASSWORD_MIN || password.length > 200)
      return json(res, 400, { error: `Choose a password of ${PASSWORD_MIN} characters or more.` });
    const CHECK_EMAIL = { ok: true, pending: true, message: `Check ${email} — the link to finish signing up is on its way.` };
    // The honeypot: a field people never see, so only a bot fills it in. It is
    // told what everyone is told, and nothing is made or sent.
    if (trap) {
      // Said in the log, in case a browser's autofill ever fills it for a person.
      console.log(`bots: sign-up honeypot filled from ${ip}`);
      return json(res, 202, CHECK_EMAIL);
    }
    if (!(await isHuman(human, ip)))
      return json(res, 403, { error: 'Confirm you are human, then sign up again.', human: true });

    if (emailEnabled) {
      // Hashed whichever way it goes, so a taken address takes as long to
      // answer as a free one.
      const passwordHash = await hashPassword(password);
      // An account never verified is answered with a link like a new address:
      // whoever signed up with it before never proved the mailbox, and the
      // click hands it to the one who does (finishSignup).
      const taken = accountByEmail(email);
      if (taken && isVerified(taken)) {
        void sendAlreadyRegistered(taken.email, siteBase())
          .catch((e) => console.log(`email: already-registered note for ${taken.id} not sent — ${e?.message ?? e}`));
        return json(res, 202, CHECK_EMAIL);
      }
      const token = startSignup(email, passwordHash, TERMS_VERSION);
      if (!token) {
        console.log('accounts: the list of sign-ups waiting on their email is full');
        return json(res, 503, { error: 'Sign-ups are paused for a moment. Try again later.' });
      }
      // Not awaited, so the answer's timing is the same for every address. A
      // link that never left is taken back off the list.
      void sendSignupLink(email, siteBase(), token).catch((e) => {
        dropSignup(email, token);
        console.log(`email: sign-up link not sent — ${e?.message ?? e}`);
      });
      return json(res, 202, CHECK_EMAIL);
    }

    let account: Account;
    try {
      account = await createAccount(email, password, TERMS_VERSION);
    } catch (e: any) {
      if (e?.message === 'exists') return json(res, 409, { error: 'That email already has an account. Sign in instead.' });
      console.log(`accounts: sign-up failed — ${e?.message ?? e}`);
      return json(res, 500, { error: 'Could not create the account. Try again shortly.' });
    }
    res.writeHead(201, {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie(req, ACCOUNT_COOKIE, sessionCookieValue(account), SESSION_DAYS * 86400),
    });
    res.end(JSON.stringify({ ok: true, ...describe(viewerFrom(heldCode(req), account)) }));
    return;
  }

  // The sign-up link pressed: the account made, and this browser signed in.
  // A POST from the page rather than the link's own GET, so a mail scanner
  // opening the link spends nothing.
  if (req.method === 'POST' && url.pathname === '/api/signup/confirm') {
    if (limited(`confirm:${ip}`, 10, 15 * 60_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    let token = '';
    try { token = String(JSON.parse((await readBody(req)) || '{}').token ?? ''); } catch { /* refused below */ }
    const account = await finishSignup(token);
    if (!account) return json(res, 400, { error: 'That sign-up link has expired or was already used. Sign up again.' });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie(req, ACCOUNT_COOKIE, sessionCookieValue(account), SESSION_DAYS * 86400),
    });
    res.end(JSON.stringify({ ok: true, ...describe(viewerFrom(heldCode(req), account)) }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    if (limited(`login:${ip}`, 10, 15 * 60_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    const body = await readBody(req);
    let code = '', gate = '', email = '', password = '', human: unknown;
    try {
      const parsed = JSON.parse(body || '{}');
      code = String(parsed.code ?? '');
      gate = String(parsed.gate ?? '');
      email = normaliseEmail(parsed.email);
      password = String(parsed.password ?? '');
      human = parsed.human;
    } catch { /* fall through to the refusal below */ }

    // Wrong guesses so far, for whatever this attempt is against: the account,
    // or the codes, and from this address. Three at one account or five from
    // one address, and the human check stands in front of the next try.
    const target = email ? `fail:acct:${email}` : 'fail:code';
    const fromHere = `fail:ip:${ip}`;
    const askHuman = () => Boolean(humanCheckKey) && (failuresOf(target) >= 3 || failuresOf(fromHere) >= 5);
    if (askHuman() && !(await isHuman(human, ip)))
      return json(res, 401, { error: 'Confirm you are human, then sign in again.', human: true });
    if (!humanCheckKey && email && failuresOf(target) >= 10)
      return json(res, 429, { error: 'Too many wrong passwords for this account. Try again in 15 minutes, or reset the password.' });
    /** A wrong answer, counted; the reply says whether the next try meets the check. */
    const wrong = (error: string) => {
      failed(target); failed(fromHere);
      return json(res, 401, { error, human: askHuman() });
    };

    // An account, by email and password. Whatever code the browser already
    // holds is kept, and still counts.
    if (email) {
      const account = await signIn(email, password);
      if (!account) return wrong('Wrong email or password.');
      buckets.delete(target);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie(req, ACCOUNT_COOKIE, sessionCookieValue(account), SESSION_DAYS * 86400),
      });
      // The new cookie is not on this request, so the account is put in by hand.
      res.end(JSON.stringify({ ok: true, ...describe(viewerFrom(heldCode(req), account)) }));
      return;
    }

    // Two doors, one endpoint. The shared gate takes either code — the operator
    // code is a superset of what the shared one grants, so an operator holds one
    // session rather than two. The operator gate takes only the operator code,
    // which is what makes it a separate door rather than a second link to the
    // same one.
    const operator = codeMatches(code, ADMIN_CODE);
    if (gate === 'admin') {
      if (!operator) {
        // Worth distinguishing: someone at the wrong door, holding a code that
        // works at the other one, should be told so rather than left to wonder
        // whether they mistyped. It tells them nothing they did not just type.
        // Nothing is set, so a session already held is not traded down for this.
        if (codeMatches(code, ACCESS_CODE)) {
          return json(res, 403, {
            error: 'That is the shared access code. This gate takes the operator code.',
          });
        }
        return wrong('Wrong operator code.');
      }
    } else if (!operator && !codeMatches(code, ACCESS_CODE)) {
      return wrong('Wrong access code.');
    }
    const token = operator ? ADMIN_SESSION_TOKEN : SESSION_TOKEN;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie(req, 'sa_session', token, 2592000),
    });
    // Described exactly as /api/me describes it, from the same function: the
    // page takes whichever reaches it first, and a session that looked
    // different depending on which answer arrived would show the controls for
    // one of them. The new cookie is not on this request, so it is put in by hand.
    res.end(JSON.stringify({
      ok: true, ...describe(viewerFrom({ code: true, operator }, accountFromCookie(req.headers.cookie))),
    }));
    return;
  }

  // A session lasts thirty days, so signing in as someone else needs a way to
  // put the current one down. Without this a browser that had entered the
  // shared code could not reach the operator view for a month: the page hides
  // the code field once a session exists, and the cookie is HttpOnly, so the
  // page cannot clear it either. Deliberately open — ending a session you hold
  // is not a privilege, and there is nothing here to refuse.
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    // Both: the code session and the account, whichever this browser holds.
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': [cookie(req, 'sa_session', '', 0), cookie(req, ACCOUNT_COOKIE, '', 0)],
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ---- emailed links: verification and password reset ----------------------
  //
  // Before the session wall, both of them: a verification click arrives from
  // an email client holding no cookie, and the person asking for a reset is
  // precisely the one who cannot sign in.

  // The verification email's link. A GET, because an email client opens links
  // with GET; it answers with a redirect so the address bar lands on the page
  // rather than on an API answer. The token is 256 random bits, which is what
  // makes a GET that changes state safe to leave this exposed.
  if (req.method === 'GET' && url.pathname === '/api/verify') {
    const a = accountByVerifyToken(String(url.searchParams.get('token') ?? ''));
    if (a) confirmEmail(a);
    res.writeHead(303, { Location: a ? '/?verified=1' : '/?verified=0' });
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/password/forgot') {
    if (!emailEnabled)
      return json(res, 503, { error: 'This server cannot send email, so passwords cannot be reset here. Contact the operator.' });
    if (limited(`forgot:${ip}`, 5, 3600_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    let email = '', human: unknown, trap = '';
    try {
      const parsed = JSON.parse((await readBody(req)) || '{}');
      email = normaliseEmail(parsed.email);
      human = parsed.human;
      trap = String(parsed.website ?? '');
    } catch { /* refused below */ }
    if (!validEmail(email)) return json(res, 400, { error: 'Enter an email address.' });
    const ON_ITS_WAY = { ok: true, message: 'If that email has an account, a reset link is on its way to it.' };
    // The honeypot, as at sign-up: answered like everyone, and nothing sent.
    if (trap) {
      console.log(`bots: reset honeypot filled from ${ip}`);
      return json(res, 200, ON_ITS_WAY);
    }
    if (!(await isHuman(human, ip)))
      return json(res, 403, { error: 'Confirm you are human, then ask again.', human: true });
    const a = accountByEmail(email);
    // One answer whether or not the address has an account, and the send is
    // not awaited: the reply must not say — in words or in timing — which
    // addresses have accounts here.
    if (a) {
      const token = issueReset(a);
      void sendReset(a.email, siteBase(), token)
        .catch((e) => console.log(`email: reset for ${a.id} failed — ${e?.message ?? e}`));
    }
    return json(res, 200, ON_ITS_WAY);
  }

  // The reset email's link used: the new password in, and this browser signed
  // in with it. Everywhere else signs out — the cookie's signature covers the
  // hash that just changed.
  if (req.method === 'POST' && url.pathname === '/api/password/reset') {
    if (limited(`reset:${ip}`, 10, 15 * 60_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    let token = '', password = '';
    try {
      const parsed = JSON.parse((await readBody(req)) || '{}');
      token = String(parsed.token ?? '');
      password = String(parsed.password ?? '');
    } catch { /* refused below */ }
    if (password.length < PASSWORD_MIN || password.length > 200)
      return json(res, 400, { error: `Choose a password of ${PASSWORD_MIN} characters or more.` });
    const a = accountByResetToken(token);
    if (!a) return json(res, 400, { error: 'That reset link has expired or was already used. Ask for a new one.' });
    await resetPassword(a, password);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie(req, ACCOUNT_COOKIE, sessionCookieValue(a), SESSION_DAYS * 86400),
    });
    // The new cookie is not on this request, so the account is put in by hand.
    res.end(JSON.stringify({ ok: true, ...describe(viewerFrom(heldCode(req), a)) }));
    return;
  }

  // Stripe telling this server what happened at Checkout and since: a new
  // subscription, a renewal, a card that failed, a cancellation. Before the
  // auth wall, because Stripe holds no session; the signature is its proof.
  if (req.method === 'POST' && url.pathname === '/api/billing/webhook') {
    if (!webhookEnabled) return json(res, 503, { error: 'Billing is not configured.' });
    const raw = await readRaw(req, 1_000_000);
    const signature = String(req.headers['stripe-signature'] ?? '');
    if (!raw || !verifySignature(raw, signature)) {
      // Counted only when it carries a signature at all: an unsigned POST is
      // somebody probing, not Stripe with the wrong secret.
      if (signature) webhookSeen.refused = Date.now();
      return json(res, 400, { error: 'Bad signature.' });
    }
    let event: any;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'Bad payload.' }); }
    webhookSeen.accepted = { at: Date.now(), type: String(event?.type) };
    try {
      console.log(`billing: ${await handleEvent(event)}`);
      return json(res, 200, { received: true });
    } catch (e: any) {
      // Stripe retries a refused webhook for days, so failing here loses nothing.
      console.log(`billing: ${String(event?.type)} failed — ${e?.message ?? e}`);
      return json(res, 500, { error: 'Could not apply the event.' });
    }
  }

  // There is no wall below: drawing is open to anyone, and what holds it down
  // is the per-IP budgets on each route and the bounded worker pool. The
  // routes that do grant something guard themselves — billing wants an
  // account, the status view the operator code — and the open formats answer
  // 402 until the address is bought or the account subscribes.

  // The sign-up's email never arrived, or its link ran out. Only a signed-in
  // account has an address to resend to.
  if (req.method === 'POST' && url.pathname === '/api/verify/resend') {
    const v = viewerOf(req);
    if (!v.account) return json(res, 400, { error: 'Sign in with your email first.' });
    if (!emailEnabled || isVerified(v.account)) return json(res, 409, { error: 'This email does not need verifying.' });
    if (limited(`resend:${ip}`, 5, 3600_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    const token = issueVerification(v.account);
    try {
      // Awaited, unlike the sign-up's: whoever presses RESEND is asking
      // whether sending works, and deserves the real answer.
      await sendVerification(v.account.email, siteBase(), token);
    } catch (e: any) {
      console.log(`email: verification for ${v.account.id} failed — ${e?.message ?? e}`);
      if (e instanceof EmailCapped)
        return json(res, 429, { error: 'Enough emails have gone to this address for now. Try again later.' });
      return json(res, 502, { error: 'Could not send the email. Try again shortly.' });
    }
    return json(res, 200, { ok: true, message: `Sent — check ${v.account.email}.` });
  }

  // ---- billing -----------------------------------------------------------

  // Off to Stripe's own payment page; the webhook above brings the answer back.
  if (req.method === 'POST' && url.pathname === '/api/billing/checkout') {
    const v = viewerOf(req);
    if (!v.account) return json(res, 400, { error: 'A subscription belongs to an account. Sign in with your email first.' });
    if (!subscriptionsOpen) return json(res, 503, { error: 'Subscriptions are not open yet.' });
    if (paidFor(v.account.subscriptionStatus)) return json(res, 409, { error: 'This account is already subscribed.' });
    if (limited(`billing:${ip}`, 20, 3600_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    try {
      return json(res, 200, { url: await checkoutUrl(v.account, siteBase()) });
    } catch (e: any) {
      console.log(`billing: checkout failed — ${e?.message ?? e}`);
      return json(res, 502, { error: 'Could not reach the payment page. Try again shortly.' });
    }
  }

  // One site, bought from the drawing the visitor is looking at: the job names
  // the address, as it was drawn, so what is paid for is a site this server
  // has actually drawn rather than whatever was typed into a request.
  if (req.method === 'POST' && url.pathname === '/api/billing/unlock') {
    const v = viewerOf(req);
    if (!v.account) return json(res, 400, { error: 'An address is bought by an account. Sign in with your email first.' });
    if (!sitesOpen) return json(res, 503, { error: 'Addresses cannot be bought yet.' });
    let jobId = '';
    try { jobId = String(JSON.parse((await readBody(req)) || '{}').job ?? ''); } catch { /* refused below */ }
    const job = jobs.get(jobId);
    if (!job) return json(res, 404, { error: 'That drawing is gone. Generate it again, then unlock it.' });
    if (grantsFor(v, job).cleanPdf) return json(res, 409, { error: 'This address is already unlocked for you.' });
    if (limited(`billing:${ip}`, 20, 3600_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    try {
      return json(res, 200, { url: await siteCheckoutUrl(v.account, job.address, job.id, siteBase()) });
    } catch (e: any) {
      console.log(`billing: site checkout failed — ${e?.message ?? e}`);
      return json(res, 502, { error: 'Could not reach the payment page. Try again shortly.' });
    }
  }

  // Stripe's page for the card, the invoices and cancelling.
  if (req.method === 'POST' && url.pathname === '/api/billing/portal') {
    const v = viewerOf(req);
    if (!billingEnabled || !v.account?.stripeCustomerId) return json(res, 400, { error: 'This account has no billing yet.' });
    try {
      return json(res, 200, { url: await portalUrl(v.account, siteBase()) });
    } catch (e: any) {
      console.log(`billing: portal failed — ${e?.message ?? e}`);
      return json(res, 502, { error: 'Could not reach the billing page. Try again shortly.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/address') {
    const q = url.searchParams.get('q') ?? '';
    if (limited(`sugg:${ip}`, 120, 60_000)) return json(res, 429, { suggestions: [] });
    try {
      return json(res, 200, { suggestions: await suggestAddresses(q) });
    } catch {
      return json(res, 200, { suggestions: [] });
    }
  }

  // Generating is open to accounts verified or not, and to nobody in
  // particular: with no wall, a gate here would only mean signing out to get
  // past it. Verification keeps guarding what it can prove — the mailbox the
  // password reset goes to.
  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    const body = await readBody(req);
    try {
      const { address, scale, rotate, sheet, fresh, template } = JSON.parse(body || '{}');
      const addr = String(address ?? '').trim();
      if (addr.length < 8 || addr.length > 120) return json(res, 400, { error: 'Enter a full NSW street address.' });
      const kind = sheetKind(sheet);
      // The theme this kind of sheet takes (an alias resolved to its id, so
      // the two spellings share a job): a context template, a site theme, or
      // none for the summary and the deck.
      const jobTemplate = themeFor(kind, String(template ?? ''));
      const raw = Number(scale) || 0;
      const sc = kind === 'site'
        ? (raw ? Math.min(1000, Math.max(100, raw)) : 0)          // 0 = auto-fit
        : kind === 'slides'
          ? Math.min(12000, Math.max(4000, raw || 8000))           // the panels' scale
          : Math.min(6000, Math.max(1000, raw || 3000));
      const want = {
        address: addr, sheet: kind, scale: sc,
        rotate: (rotate === 'auto' ? 'auto' : 'north') as Job['rotate'],
        template: jobTemplate,
      };
      const key = jobKey(want);

      // Before the rate limit, because reuse costs nothing this limit is
      // protecting: the 12-an-hour budget is there for the public data
      // services, and a sheet that is already drawn does not touch them.
      // `fresh` is the way past it, for when the controls are known to have
      // moved, and that does spend the budget.
      if (fresh !== true) {
        const hit = reusable(key);
        if (hit) {
          return json(res, 200, {
            id: hit.id,
            reused: hit.status === 'done',
            joined: hit.status !== 'done',
            ageMinutes: Math.round((Date.now() - hit.createdAt) / 60_000),
          });
        }
      }

      if (remaining(`jobs:${ip}`, JOBS_PER_HOUR, 3600_000) < 1)
        return json(res, 429, { error: 'Rate limit: try again later.' });
      spend(`jobs:${ip}`, 3600_000, 1);
      const job: Job = {
        id: randomUUID(), ...want, key,
        status: 'queued', log: [], createdAt: Date.now(),
      };
      enqueue(job);
      json(res, 202, { id: job.id, queued: [...jobs.values()].filter((j) => j.status === 'queued').length });
    } catch {
      json(res, 400, { error: 'Bad request.' });
    }
    return;
  }

  // ---- batches -----------------------------------------------------------

  if (req.method === 'POST' && url.pathname === '/api/batches') {
    const body = await readBody(req);
    try {
      const b = JSON.parse(body || '{}');
      const raw: unknown[] = Array.isArray(b.addresses) ? b.addresses : [];
      const addresses = raw.map((a) => String(a ?? '').trim()).filter(Boolean);
      if (!addresses.length) return json(res, 400, { error: 'No addresses.' });
      if (addresses.length > MAX_BATCH)
        return json(res, 400, { error: `At most ${MAX_BATCH} addresses at a time.` });
      if (addresses.some((a) => a.length < 8 || a.length > 120))
        return json(res, 400, { error: 'Every entry must be a full NSW street address.' });

      const kind = sheetKind(b.sheet);
      const jobTemplate = themeFor(kind, String(b.template ?? ''));
      const n = Number(b.scale) || 0;
      const sc = kind === 'site'
        ? (n ? Math.min(1000, Math.max(100, n)) : 0)
        : kind === 'slides'
          ? Math.min(12000, Math.max(4000, n || 8000))
          : Math.min(6000, Math.max(1000, n || 3000));
      const rotate: Job['rotate'] = b.rotate === 'auto' ? 'auto' : 'north';

      // Resolve reuse before counting cost. A batch of a dozen where most were
      // drawn this morning should not be refused for a budget it will not
      // spend — the limit is there for the upstream services, and a sheet that
      // already exists does not touch them.
      const plan = addresses.map((address) => {
        const want = { address, sheet: kind, scale: sc, rotate, template: jobTemplate };
        return { want, key: jobKey(want), hit: b.fresh === true ? undefined : reusable(jobKey(want)) };
      });
      // Distinct keys, not rows. Two spellings of one address share a job — the
      // loop below finds the first already queued when it reaches the second —
      // so counting rows would charge the hour's budget twice for one sheet.
      const toRun = new Set(plan.filter((p) => !p.hit).map((p) => p.key)).size;
      const left = remaining(`jobs:${ip}`, JOBS_PER_HOUR, 3600_000);
      if (toRun > left) {
        // All or nothing: half a batch accepted is worse than none, because
        // there is no way to tell from the outside which half.
        return json(res, 429, {
          error: left === 0
            ? 'Rate limit reached. Try again within the hour.'
            : `Rate limit: ${toRun} new sheets requested, ${left} left this hour.`,
        });
      }
      spend(`jobs:${ip}`, 3600_000, toRun);

      const batch: Batch = {
        id: randomUUID(), createdAt: Date.now(), sheet: kind, entries: [],
      };
      for (const p of plan) {
        // Re-checked rather than trusting the plan: two identical addresses in
        // one batch mean the second finds the first already queued, so they
        // share a job instead of drawing the same sheet twice.
        const hit = b.fresh === true ? undefined : reusable(p.key);
        if (hit) {
          batch.entries.push({ address: p.want.address, jobId: hit.id });
          continue;
        }
        const job: Job = {
          id: randomUUID(), ...p.want, key: p.key,
          status: 'queued', log: [], createdAt: Date.now(),
        };
        enqueue(job);
        batch.entries.push({ address: p.want.address, jobId: job.id });
      }
      batches.set(batch.id, batch);
      saveBatches();
      return json(res, 202, { id: batch.id, total: batch.entries.length, queued: toRun });
    } catch {
      return json(res, 400, { error: 'Bad request.' });
    }
  }

  const batchMatch = url.pathname.match(/^\/api\/batches\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && batchMatch) {
    const batch = batches.get(batchMatch[1]);
    if (!batch) return json(res, 404, { error: 'Unknown batch.' });
    const rows = batch.entries.map((e) => {
      const job = jobs.get(e.jobId);
      if (!job) {
        // Swept, or lost with a container that died before it was written.
        return { address: e.address, jobId: e.jobId, status: 'gone' as const };
      }
      return {
        address: e.address, jobId: e.jobId, status: job.status, error: job.error,
        hasCad: Boolean(job.cadPath), hasData: Boolean(job.dataPath),
        queuePosition: queuePosition(job), etaMinutes: etaMinutes(job),
        note: job.log.length ? job.log[job.log.length - 1].trim() : '',
      };
    });
    return json(res, 200, {
      id: batch.id, sheet: batch.sheet, createdAt: batch.createdAt,
      total: rows.length,
      done: rows.filter((r) => r.status === 'done').length,
      failed: rows.filter((r) => r.status === 'error' || r.status === 'gone').length,
      entries: rows,
    });
  }

  const batchZip = url.pathname.match(/^\/api\/batches\/([0-9a-f-]{36})\/zip$/);
  if (req.method === 'GET' && batchZip) {
    const batch = batches.get(batchZip[1]);
    if (!batch) return json(res, 404, { error: 'Unknown batch.' });
    const v = viewerOf(req);
    const found: { job: Job; name: string }[] = [];
    const used = new Set<string>();
    for (const e of batch.entries) {
      const job = jobs.get(e.jobId);
      if (!job?.pdfPath || !existsSync(job.pdfPath)) continue;
      const kind = PDF_NAME[job.sheet];
      // The same address twice in one batch shares a job, so it would other-
      // wise be added to the zip twice under one name.
      let name = `${kind}_${e.address.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}.pdf`;
      if (used.has(name)) continue;
      used.add(name);
      found.push({ job, name });
    }
    if (!found.length) return json(res, 404, { error: 'Nothing finished yet.' });
    if (!found.every((f) => grantsFor(v, f.job).pdf)) return json(res, 401, PDF_NEEDS_ACCOUNT);
    try {
      // The same PDFs as the single download: stamped for a free account.
      const files: { path: string; name: string }[] = [];
      for (const f of found) files.push({ path: await pdfFor(f.job, v), name: f.name });
      // A zip of its own wherever any sheet in it is stamped — per account, since
      // which sites an account has bought decides which — so no request is
      // answered with a zip written for someone entitled to more.
      const clean = found.every((f) => grantsFor(v, f.job).cleanPdf);
      const zipPath = join(WEB_OUT, `${batch.id}${clean ? '' : `.wm-${v.account?.id ?? 'code'}`}.zip`);
      // python3 is already a dependency (the DXF export needs it) and this is
      // the same zipfile the CAD package is built with. execFile, not
      // spawnSync: the latter blocks the event loop, which on a server that
      // streams job progress means every other visitor stops hearing anything.
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      await promisify(execFile)('python3', [
        '-c',
        'import sys,zipfile\n' +
        'out=sys.argv[1]\n' +
        'with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:\n' +
        '    for i in range(2,len(sys.argv),2): z.write(sys.argv[i],sys.argv[i+1])\n',
        zipPath,
        ...files.flatMap((f) => [f.path, f.name]),
      ]);
      readFile(zipPath, (err, data) => {
        if (err) return json(res, 500, { error: 'Zip unreadable.' });
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="SITE_ANALYST_${files.length}_SHEETS.zip"`,
          ...PRIVATE,
        });
        res.end(data);
      });
    } catch {
      return json(res, 500, { error: 'Could not build the zip.' });
    }
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return json(res, 404, { error: 'Unknown job.' });
    const v = viewerOf(req);
    const grants = grantsFor(v, job);
    return json(res, 200, {
      id: job.id, address: job.address, status: job.status,
      log: job.log.slice(-12), error: job.error, hasCad: Boolean(job.cadPath),
      hasData: Boolean(job.dataPath), sheet: job.sheet,
      hasPreview: Boolean(job.pdfPath && existsSync(previewOf(dirname(job.pdfPath)))),
      queuePosition: queuePosition(job), etaMinutes: etaMinutes(job),
      // What this viewer may take away of it, and, where it can be bought on
      // its own, what that costs: the page offers what the server will serve.
      grants,
      // Offered to anyone the PDF is stamped for; buying it starts with a
      // free account, which the page asks for on the way to Stripe.
      unlock: sitesOpen && !grants.cleanPdf ? SITE_PRICE_LABEL : null,
    });
  }

  // The finished drawing's picture. The same for every plan: at this size it
  // shows what was drawn and is no use printed, like the examples on the page.
  const previewMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/preview$/);
  if (req.method === 'GET' && previewMatch) {
    const job = jobs.get(previewMatch[1]);
    if (!job?.pdfPath) return json(res, 404, { error: 'Not ready.' });
    readFile(previewOf(dirname(job.pdfPath)), (err, data) => {
      if (err) return json(res, 404, { error: 'No picture of this drawing.' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
      res.end(data);
    });
    return;
  }

  const pdfMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/pdf$/);
  if (req.method === 'GET' && pdfMatch) {
    const job = jobs.get(pdfMatch[1]);
    if (!job?.pdfPath) return json(res, 404, { error: 'Not ready.' });
    const v = viewerOf(req);
    if (!grantsFor(v, job).pdf) return json(res, 401, PDF_NEEDS_ACCOUNT);
    let path: string;
    try {
      path = await pdfFor(job, v);
    } catch (e: any) {
      // Refused rather than served clean: a failed stamp must not become a
      // free way to the subscriber's PDF.
      console.log(`watermark: ${job.id} failed — ${e?.message ?? e}`);
      return json(res, 500, { error: 'Could not prepare the PDF. Try again shortly.' });
    }
    readFile(path, (err, data) => {
      if (err) return json(res, 500, { error: 'PDF unreadable.' });
      const slug = job.address.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
      const kind = PDF_NAME[job.sheet];
      // Shown in the browser's viewer, or with ?download saved straight to disk.
      const disposition = url.searchParams.has('download') ? 'attachment' : 'inline';
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${kind}_${slug}.pdf"`,
        ...PRIVATE,
      });
      res.end(data);
    });
    return;
  }

  // The open formats are paid for, by the site or by the subscription. 402
  // rather than 403: nothing is wrong with who is asking, only with what they
  // have paid for.
  const OPEN_DATA_ONLY = { error: 'The CAD and data files come with an unlocked address or the subscription.', upgrade: '/pricing' };

  const cadMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/cad$/);
  if (req.method === 'GET' && cadMatch) {
    const job = jobs.get(cadMatch[1]);
    if (!job?.cadPath) return json(res, 404, { error: 'Not ready.' });
    if (!grantsFor(viewerOf(req), job).openData) return json(res, 402, OPEN_DATA_ONLY);
    readFile(job.cadPath, (err, data) => {
      if (err) return json(res, 500, { error: 'CAD package unreadable.' });
      const slug = job.address.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${job.sheet === 'site' ? 'SITE' : 'CONTEXT'}_ANALYSIS_CAD_${slug}.zip"`,
        ...PRIVATE,
      });
      res.end(data);
    });
    return;
  }

  // Table sheets download as data rather than CAD.
  const dataMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/data$/);
  if (req.method === 'GET' && dataMatch) {
    const job = jobs.get(dataMatch[1]);
    if (!job?.dataPath) return json(res, 404, { error: 'Not ready.' });
    if (!grantsFor(viewerOf(req), job).openData) return json(res, 402, OPEN_DATA_ONLY);
    readFile(job.dataPath, (err, data) => {
      if (err) return json(res, 500, { error: 'Data file unreadable.' });
      const slug = job.address.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
      const isJson = job.dataPath!.endsWith('.json');
      res.writeHead(200, {
        'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${isJson ? `OVERALL_ANALYSIS_${slug}.json` : `DEVELOPMENT_SUMMARY_${slug}.csv`}"`,
        ...PRIVATE,
      });
      res.end(data);
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// Pick the previous container's finished sheets back up, then keep the
// directory swept whether or not anyone is generating.
initAccounts(ACCOUNTS_DIR);
loadIndex();
loadBatches();
const CLEANUP_INTERVAL_MS = 3600_000;
setInterval(() => void cleanupOldJobs(), CLEANUP_INTERVAL_MS);
void cleanupOldJobs();

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => console.log(`site analyst web UI on http://localhost:${PORT}${NO_AUTH ? ' (NO AUTH)' : ''}` +
  ` — subscriptions ${subscriptionsOpen ? 'on' : 'off'}, single sites ${sitesOpen ? 'on' : 'off'}, email ${emailVia}`));

// What Stripe says about the settings, in the container's log at every start,
// so a wrong key shows in `docker logs` as well as on /status.
if (billingEnabled) {
  void checkBilling().then((rows) => {
    for (const [k, v, ok] of rows) console.log(`billing check: ${ok ? 'ok  ' : 'WARN'} ${k} — ${v}`);
  });
}
