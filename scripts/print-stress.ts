// Prints sheets side by side, in processes of their own as the server's
// workers would, and reads every PDF back for what Chromium left out.
//
//   CHROMIUM_NO_SANDBOX=1 npx tsx scripts/print-stress.ts out/<slug>/sheet.html [more.html …] [--procs 4] [--rounds 3]
//
// Each round starts --procs prints at the same moment, each in its own
// process with its own Chromium and no shared slot, so that they really do
// print together (the server would hold all but PRINT_SLOTS of them back).
// The HTML files are taken in turn, so a context sheet can print beside a
// heavier one. Every print is the one htmlToPdf makes (src/render/pdf.ts,
// printSheetOnce) without its second attempt: what the check of
// src/render/printCheck.ts finds missing is reported, not retried.
//
// Per print: how long it took, the PDF's size, what the check found missing,
// and, where poppler's pdftoppm is installed, how much of the title-block
// column is ink (a whole context sheet is about 0.12, a print that stopped
// short 0.00 to 0.02). Per round: the memory in use at its peak.
//
// The PDFs and a JSON report are kept in out/print-stress/<time>/.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- as a child: one print ------------------------------------------------------
if (process.env.PRINT_STRESS_CHILD) {
  const { html, pdf } = JSON.parse(process.env.PRINT_STRESS_CHILD) as { html: string; pdf: string };
  const { printSheetOnce } = await import('../src/render/pdf.js');
  const t0 = Date.now();
  let missing: string[] = [], error: string | undefined;
  try { missing = await printSheetOnce(html, pdf); } catch (e: any) { error = e?.message ?? String(e); }
  // a pipe is written asynchronously: exit once the line is out, not before
  process.stdout.write(`${JSON.stringify({ ms: Date.now() - t0, missing, error })}\n`, () => process.exit(0));
  await new Promise(() => {});
}

// ---- as the parent ------------------------------------------------------------------
const { titleColumnInk } = await import('../src/render/printCheck.js');
const argv = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = argv.indexOf(`--${name}`);
  const n = i > -1 ? Number(argv[i + 1]) : def;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};
const htmls = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')).map((h) => resolve(h));
if (!htmls.length || htmls.some((h) => !existsSync(h))) {
  console.error('usage: npx tsx scripts/print-stress.ts <sheet.html> [more.html …] [--procs 4] [--rounds 3]');
  process.exit(1);
}
const procs = opt('procs', 4), rounds = opt('rounds', 3);
const outDir = join(ROOT, 'out', 'print-stress', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(outDir, { recursive: true });

/** Memory in use on this machine, MB: total less what is available. */
function memInUseMb(): number | null {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8');
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(m)?.[1] ?? NaN);
    const v = (kb('MemTotal') - kb('MemAvailable')) / 1024;
    return Number.isFinite(v) ? Math.round(v) : null;
  } catch { return null; }
}

interface Print { round: number; n: number; html: string; pdf: string; ms: number; bytes: number; missing: string[]; error?: string; ink?: number }
const prints: Print[] = [];
const roundsOut: { round: number; memBeforeMb: number | null; peakMemMb: number | null }[] = [];

const runOne = (round: number, n: number): Promise<Print> => {
  const html = htmls[(round * procs + n) % htmls.length];
  const pdf = join(outDir, `r${round}_${n}_${basename(html, '.html')}.pdf`);
  return new Promise((done) => {
    // spawned, not forked: a child without an IPC channel keeps its own slot
    // count (src/lib/slots.ts), so none waits on another
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
      cwd: ROOT,
      env: { ...process.env, PRINT_STRESS_CHILD: JSON.stringify({ html, pdf }) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => {
      let r: { ms: number; missing: string[]; error?: string } = { ms: 0, missing: [], error: `exit ${code}` };
      try { r = JSON.parse(out.trim().split('\n').pop()!); } catch { /* the default above */ }
      const bytes = existsSync(pdf) ? statSync(pdf).size : 0;
      done({ round, n, html: basename(html), pdf, ms: r.ms, bytes, missing: r.missing, error: r.error, ink: bytes ? titleColumnInk(pdf) : undefined });
    });
  });
};

for (let round = 0; round < rounds; round++) {
  const memBefore = memInUseMb();
  let peak = memBefore;
  const sampler = setInterval(() => { const m = memInUseMb(); if (m !== null && (peak === null || m > peak)) peak = m; }, 250);
  const got = await Promise.all(Array.from({ length: procs }, (_, n) => runOne(round, n)));
  clearInterval(sampler);
  roundsOut.push({ round, memBeforeMb: memBefore, peakMemMb: peak });
  prints.push(...got);
  console.log(`round ${round + 1}/${rounds}: ${procs} at once, memory ${memBefore} MB before, ${peak} MB at peak`);
  for (const p of got) {
    const verdict = p.error ? `ERROR ${p.error}` : p.missing.length ? `INCOMPLETE: ${p.missing.join(', ')}` : 'whole';
    console.log(`  ${p.html.padEnd(24)} ${(p.ms / 1000).toFixed(1).padStart(5)} s  ${(p.bytes / 1e6).toFixed(2).padStart(6)} MB  ink ${p.ink === undefined ? '  -  ' : p.ink.toFixed(3)}  ${verdict}`);
  }
}

const bad = prints.filter((p) => p.error || p.missing.length);
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ htmls, procs, rounds, memory: roundsOut, prints }, null, 2));
console.log(`\n${prints.length} prints, ${bad.length} incomplete or failed; PDFs and report.json in ${outDir}`);
