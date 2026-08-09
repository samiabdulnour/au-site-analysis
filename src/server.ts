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
import { runPipeline } from './pipeline.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
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

interface Job {
  id: string;
  address: string;
  scale: number;
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
    const bundle = await runPipeline(job.address, {
      scale: job.scale,
      mapWidthMm: MAP_W,
      mapHeightMm: MAP_H,
      outDir,
      rotate: job.rotate,
      log: (m) => job.log.push(m),
    });
    job.log.push('composing sheet…');
    const html = renderSheet(bundle, meta);
    const htmlPath = join(outDir, 'sheet.html');
    await writeFile(htmlPath, html);
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

  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    if (limited(`jobs:${ip}`, 12, 3600_000)) return json(res, 429, { error: 'Rate limit: try again later.' });
    const body = await readBody(req);
    try {
      const { address, scale, rotate } = JSON.parse(body || '{}');
      const addr = String(address ?? '').trim();
      if (addr.length < 8 || addr.length > 120) return json(res, 400, { error: 'Enter a full NSW street address.' });
      const sc = Math.min(6000, Math.max(1000, Number(scale) || 3000));
      const job: Job = {
        id: randomUUID(), address: addr, scale: sc,
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
      log: job.log.slice(-12), error: job.error, hasCad: Boolean(job.cadPath),
    });
  }

  const pdfMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/pdf$/);
  if (req.method === 'GET' && pdfMatch) {
    const job = jobs.get(pdfMatch[1]);
    if (!job?.pdfPath) return json(res, 404, { error: 'Not ready.' });
    readFile(job.pdfPath, (err, data) => {
      if (err) return json(res, 500, { error: 'PDF unreadable.' });
      const slug = job.address.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="CONTEXT_ANALYSIS_${slug}.pdf"`,
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
