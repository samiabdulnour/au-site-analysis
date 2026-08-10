// Web interface: enter a NSW address, get the CONTEXT ANALYSIS PDF.
// Plain node:http, no extra dependencies. Jobs run one at a time (the NSW
// endpoints and the public isochrone server should not be hit in parallel).
//
//   ACCESS_CODE=… npm run serve     # http://localhost:3000  (PORT to change)
//
// Auth: single shared access code (ACCESS_CODE env). Successful login sets an
// HttpOnly session cookie derived from the code, so restarts keep sessions.
// Set ALLOW_NO_AUTH=1 only for local use.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readFileSync, existsSync } from 'node:fs';
import { rm, readdir, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { runPipeline, runSitePipeline } from './pipeline.js';
import { suggestAddresses } from './fetch/geocode.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
import { renderSiteSheet } from './render/siteSheet.js';
import { htmlToPdf } from './render/pdf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (TFNSW_API_KEY, ACCESS_CODE) like the CLI does.
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const ACCESS_CODE = process.env.ACCESS_CODE ?? '';
if (!ACCESS_CODE && process.env.ALLOW_NO_AUTH !== '1') {
  console.error('Set ACCESS_CODE=<shared code> (or ALLOW_NO_AUTH=1 for local use).');
  process.exit(1);
}
const SESSION_TOKEN = ACCESS_CODE
  ? createHmac('sha256', ACCESS_CODE).update('site-analyst-session-v1').digest('hex')
  : '';

const JOB_RETENTION_MS = 24 * 3600 * 1000;
const WEB_OUT = join(ROOT, 'out', 'web');

// Is the local Overpass container up and serving yet? Reported by /api/version
// so the switchover can be checked without shell access to the host. Cached,
// because /api/version is public and this reaches a neighbouring container.
let osmProbe: { at: number; state: string } = { at: 0, state: 'unknown' };
async function probeLocalOverpass(): Promise<string> {
  if (Date.now() - osmProbe.at < 60_000) return osmProbe.state;
  const url = process.env.OVERPASS_LOCAL ?? 'http://overpass-nsw/api/interpreter';
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

interface Job {
  id: string;
  address: string;
  sheet: 'context' | 'site';
  scale: number;            // 0 = auto (site sheets)
  rotate: 'north' | 'auto';
  status: 'queued' | 'running' | 'done' | 'error';
  log: string[];
  pdfPath?: string;
  cadPath?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();
let queue: Promise<void> = Promise.resolve();

function enqueue(job: Job) {
  jobs.set(job.id, job);
  queue = queue.then(() => runJob(job)).catch(() => {});
}

async function runJob(job: Job) {
  job.status = 'running';
  const outDir = join(WEB_OUT, job.id);
  try {
    const office = JSON.parse(readFileSync(join(ROOT, 'config', 'office.json'), 'utf8'));
    const meta: SheetMeta = {
      jobNo: '', client: '', status: '', sheetNo: '', revision: '',
      checked: '', drawn: '', date: '', preliminary: false, office,
    };
    if (job.sheet === 'site') {
      const sb = await runSitePipeline(job.address, {
        mapWidthMm: MAP_W,
        mapHeightMm: MAP_H,
        outDir,
        scale: job.scale || undefined,   // 0 => auto-fit
        rotate: job.rotate,
        log: (m) => job.log.push(m),
      });
      job.log.push('composing site analysis…');
      const htmlPath = join(outDir, 'site_sheet.html');
      await writeFile(htmlPath, renderSiteSheet(sb, meta));
      job.log.push('printing PDF…');
      const pdfPath = join(outDir, 'SITE_ANALYSIS.pdf');
      await htmlToPdf(htmlPath, pdfPath);
      job.pdfPath = pdfPath;
    } else {
      const bundle = await runPipeline(job.address, {
        scale: job.scale,
        mapWidthMm: MAP_W,
        mapHeightMm: MAP_H,
        outDir,
        rotate: job.rotate,
        log: (m) => job.log.push(m),
      });
      job.log.push('composing context analysis…');
      const htmlPath = join(outDir, 'sheet.html');
      await writeFile(htmlPath, renderSheet(bundle, meta));
      job.log.push('printing PDF…');
      const pdfPath = join(outDir, 'CONTEXT_ANALYSIS.pdf');
      await htmlToPdf(htmlPath, pdfPath);
      job.pdfPath = pdfPath;
      job.log.push('exporting CAD (DXF/DWG)…');
      const { spawnSync } = await import('node:child_process');
      const cad = spawnSync('python3', [join(ROOT, 'src', 'export', 'dxf_export.py'), outDir], { encoding: 'utf8' });
      if (cad.status === 0 && existsSync(join(outDir, 'CONTEXT_ANALYSIS_CAD.zip'))) {
        job.cadPath = join(outDir, 'CONTEXT_ANALYSIS_CAD.zip');
      } else {
        job.log.push('CAD export unavailable for this run');
      }
    }
    job.status = 'done';
    job.log.push('done');
  } catch (e: any) {
    job.status = 'error';
    job.error = e?.message ?? String(e);
    job.log.push(`ERROR: ${job.error}`);
  }
  void cleanupOldJobs();
}

async function cleanupOldJobs() {
  for (const [id, job] of jobs) {
    if (Date.now() - job.createdAt > JOB_RETENTION_MS && job.status !== 'running') jobs.delete(id);
  }
  try {
    for (const name of await readdir(WEB_OUT)) {
      const dir = join(WEB_OUT, name);
      const s = await stat(dir).catch(() => null);
      if (s && Date.now() - s.mtimeMs > JOB_RETENTION_MS)
        await rm(dir, { recursive: true, force: true });
    }
  } catch { /* out/web may not exist yet */ }
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
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// ---- auth ----------------------------------------------------------------
function authed(req: IncomingMessage): boolean {
  if (!ACCESS_CODE) return true;
  const cookies = req.headers.cookie ?? '';
  const m = cookies.match(/(?:^|;\s*)sa_session=([0-9a-f]{64})/);
  if (!m) return false;
  const got = Buffer.from(m[1]);
  const want = Buffer.from(SESSION_TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ip = clientIp(req);

  if (req.method === 'GET' && url.pathname === '/') {
    readFile(join(ROOT, 'web', 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('missing web/index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/version') {
    return json(res, 200, {
      sha: process.env.GIT_SHA ?? 'dev',
      osm: process.env.OVERPASS_LOCAL ? 'local' : 'public',
      osmLocal: await probeLocalOverpass(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    return json(res, authed(req) ? 200 : 401, { authed: authed(req) });
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    if (limited(`login:${ip}`, 10, 15 * 60_000)) return json(res, 429, { error: 'Too many attempts. Try later.' });
    const body = await readBody(req);
    let code = '';
    try { code = String(JSON.parse(body || '{}').code ?? ''); } catch { /* fall through */ }
    const got = Buffer.from(code.padEnd(256).slice(0, 256));
    const want = Buffer.from(ACCESS_CODE.padEnd(256).slice(0, 256));
    if (!ACCESS_CODE || !timingSafeEqual(got, want)) return json(res, 401, { error: 'Wrong access code.' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `sa_session=${SESSION_TOKEN}; HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/${secure}`,
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Everything below requires auth.
  if (!authed(req)) return json(res, 401, { error: 'Not authorised.' });

  if (req.method === 'GET' && url.pathname === '/api/address') {
    const q = url.searchParams.get('q') ?? '';
    if (limited(`sugg:${ip}`, 120, 60_000)) return json(res, 429, { suggestions: [] });
    try {
      return json(res, 200, { suggestions: await suggestAddresses(q) });
    } catch {
      return json(res, 200, { suggestions: [] });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    if (limited(`jobs:${ip}`, 12, 3600_000)) return json(res, 429, { error: 'Rate limit: try again later.' });
    const body = await readBody(req);
    try {
      const { address, scale, rotate, sheet } = JSON.parse(body || '{}');
      const addr = String(address ?? '').trim();
      if (addr.length < 8 || addr.length > 120) return json(res, 400, { error: 'Enter a full NSW street address.' });
      const kind: 'context' | 'site' = sheet === 'site' ? 'site' : 'context';
      const raw = Number(scale) || 0;
      const sc = kind === 'site'
        ? (raw ? Math.min(1000, Math.max(100, raw)) : 0)          // 0 = auto-fit
        : Math.min(6000, Math.max(1000, raw || 3000));
      const job: Job = {
        id: randomUUID(), address: addr, sheet: kind, scale: sc,
        rotate: rotate === 'auto' ? 'auto' : 'north',
        status: 'queued', log: [], createdAt: Date.now(),
      };
      enqueue(job);
      json(res, 202, { id: job.id, queued: [...jobs.values()].filter((j) => j.status === 'queued').length });
    } catch {
      json(res, 400, { error: 'Bad request.' });
    }
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return json(res, 404, { error: 'Unknown job.' });
    return json(res, 200, {
      id: job.id, address: job.address, status: job.status,
      log: job.log.slice(-12), error: job.error, hasCad: Boolean(job.cadPath), sheet: job.sheet,
    });
  }

  const pdfMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/pdf$/);
  if (req.method === 'GET' && pdfMatch) {
    const job = jobs.get(pdfMatch[1]);
    if (!job?.pdfPath) return json(res, 404, { error: 'Not ready.' });
    readFile(job.pdfPath, (err, data) => {
      if (err) return json(res, 500, { error: 'PDF unreadable.' });
      const slug = job.address.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
      const kind = job.sheet === 'site' ? 'SITE' : 'CONTEXT';
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${kind}_ANALYSIS_${slug}.pdf"`,
      });
      res.end(data);
    });
    return;
  }

  const cadMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/cad$/);
  if (req.method === 'GET' && cadMatch) {
    const job = jobs.get(cadMatch[1]);
    if (!job?.cadPath) return json(res, 404, { error: 'Not ready.' });
    readFile(job.cadPath, (err, data) => {
      if (err) return json(res, 500, { error: 'CAD package unreadable.' });
      const slug = job.address.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="CONTEXT_ANALYSIS_CAD_${slug}.zip"`,
      });
      res.end(data);
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => console.log(`site analyst web UI on http://localhost:${PORT}${ACCESS_CODE ? ' (auth on)' : ' (NO AUTH)'}`));
