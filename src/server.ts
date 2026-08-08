// Minimal web interface: enter a NSW address, get the CONTEXT ANALYSIS PDF.
// Plain node:http, no extra dependencies. Jobs run one at a time (the NSW
// endpoints and the public isochrone server should not be hit in parallel).
//
//   npm run serve          # http://localhost:3000  (PORT env to change)

import { createServer } from 'node:http';
import { readFile, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runPipeline } from './pipeline.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
import { htmlToPdf } from './render/pdf.js';
import { writeFile } from 'node:fs/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (TFNSW_API_KEY) like the CLI does.
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

interface Job {
  id: string;
  address: string;
  scale: number;
  status: 'queued' | 'running' | 'done' | 'error';
  log: string[];
  pdfPath?: string;
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
  const outDir = join(ROOT, 'out', 'web', job.id);
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
    job.status = 'done';
    job.log.push('done');
  } catch (e: any) {
    job.status = 'error';
    job.error = e?.message ?? String(e);
    job.log.push(`ERROR: ${job.error}`);
  }
}

function json(res: any, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    readFile(join(ROOT, 'web', 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('missing web/index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on('end', () => {
      try {
        const { address, scale } = JSON.parse(body || '{}');
        const addr = String(address ?? '').trim();
        if (addr.length < 8 || addr.length > 120) return json(res, 400, { error: 'Enter a full NSW street address.' });
        const sc = Math.min(6000, Math.max(1000, Number(scale) || 3000));
        const job: Job = {
          id: randomUUID(), address: addr, scale: sc,
          status: 'queued', log: [], createdAt: Date.now(),
        };
        enqueue(job);
        json(res, 202, { id: job.id, queued: [...jobs.values()].filter((j) => j.status === 'queued').length });
      } catch {
        json(res, 400, { error: 'Bad request.' });
      }
    });
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return json(res, 404, { error: 'Unknown job.' });
    return json(res, 200, {
      id: job.id, address: job.address, status: job.status,
      log: job.log.slice(-12), error: job.error,
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

  res.writeHead(404); res.end('Not found');
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => console.log(`site analyst web UI on http://localhost:${PORT}`));
