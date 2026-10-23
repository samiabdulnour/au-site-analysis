// One job, in a process of its own. The server forks this file for each sheet
// it draws (src/server.ts, runJob) and talks to it over the IPC channel:
//
//   server → worker   { run: { spec, outDir } }   once, to start
//   worker → server   { log: "…" }                each progress line
//                     { done: { pdfPath, … } }    the sheet is drawn
//                     { error: "…" }              it is not
//                     { slot: … }                 a slot of src/lib/slots.ts
//
// A process per job, not a thread or a shared loop, for three reasons. The
// composing and the PNG work is CPU on the main thread: ten jobs in the
// server's own loop would take turns with each other and with every page
// request. A job that crashes, or leaks, takes only itself down, and its
// memory goes back when it exits. And the module-level caches the fetchers
// keep cannot leak from one job into the next.
//
// The worker exits when its job is done, and also as soon as the server goes:
// a sheet nobody can be told about is not worth finishing.

import { drawSheet, type SheetSpec } from './draw.js';

interface RunMsg { run: { spec: SheetSpec; outDir: string } }

if (!process.send) {
  console.error('src/worker.ts is forked by the server, not run on its own');
  process.exit(1);
}

const send = (m: object) => new Promise<void>((resolve) => {
  if (!process.connected) return resolve();
  process.send!(m, undefined, {}, () => resolve());
});

process.on('disconnect', () => process.exit(0));

process.on('message', async (m: unknown) => {
  const run = (m as RunMsg)?.run;
  if (!run) return;                    // a slot grant, handled in src/lib/slots.ts
  try {
    const drawn = await drawSheet(run.spec, run.outDir, (line) => { void send({ log: line }); });
    await send({ done: drawn });
  } catch (e: any) {
    await send({ error: e?.message ?? String(e) });
  }
  // Explicitly: a keep-alive socket or a timer a fetcher left behind would
  // otherwise hold the process, and the server is waiting for the exit.
  process.exit(0);
});
