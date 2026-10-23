// Counted slots: how many of one kind of thing may happen at once, across
// every job the server is running, not just inside one of them.
//
// With jobs in their own processes (src/worker.ts), a limit kept in a module
// is a limit per job — ten workers would each allow their own sixteen requests
// to the NSW planning server, and their own Chromium. So a worker asks the
// server for a slot over the IPC channel it was forked with, and the server
// keeps the one count for everybody. A process with no parent channel (the
// CLI, a test, the server itself) keeps the count locally, which for a single
// process is the same thing.
//
// Two kinds of slot are used:
//
//   chromium      one printing browser (src/render/pdf.ts). The memory peak of
//                 a job is its browser, so this is what bounds the peak of ten
//                 jobs printing at once. PRINT_SLOTS, default 2.
//   host:<name>   one request in flight to that host (src/lib/http.ts), so the
//                 free services this tool is a guest of see a bounded number
//                 of requests however many jobs run. UPSTREAM_PER_HOST,
//                 default 16; UPSTREAM_LIMITS="host=n,host=n" for one host.
//                 The local Overpass and anything else on this machine or its
//                 private network is ours and not counted.
//
// A slot a crashed worker held is given back when the worker exits, so one
// bad job cannot slowly starve the rest.

import type { ChildProcess } from 'node:child_process';

type Release = () => void;

interface Pool { held: number; waiting: (() => void)[] }
const pools = new Map<string, Pool>();

function positive(v: string | undefined, def: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Hosts that are ours: this machine, the Docker network's names, a private address. */
function isLocalHost(host: string): boolean {
  const h = host.replace(/:\d+$/, '').toLowerCase();
  if (h === 'localhost' || !h.includes('.')) return true;    // overpass-nsw, other container names
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
  const local = process.env.OVERPASS_LOCAL?.trim();
  if (local) {
    try { if (new URL(local).hostname.toLowerCase() === h) return true; } catch { /* not a URL */ }
  }
  return false;
}

function hostLimits(): Map<string, number> {
  const m = new Map<string, number>();
  for (const part of (process.env.UPSTREAM_LIMITS ?? '').split(',')) {
    const [host, n] = part.split('=').map((s) => s?.trim());
    if (host && n) m.set(host.toLowerCase(), positive(n, 1));
  }
  return m;
}

/** How many of `key` may be held at once; Infinity for what is not limited. */
export function slotLimit(key: string): number {
  if (key === 'chromium') return positive(process.env.PRINT_SLOTS, 2);
  if (key.startsWith('host:')) {
    const host = key.slice(5).toLowerCase();
    if (isLocalHost(host)) return Infinity;
    return hostLimits().get(host) ?? positive(process.env.UPSTREAM_PER_HOST, 16);
  }
  return Infinity;
}

/** Waits for a slot in this process's own count. The release is safe to call twice. */
function acquireLocal(key: string): Promise<Release> {
  const limit = slotLimit(key);
  if (limit === Infinity) return Promise.resolve(() => {});
  let pool = pools.get(key);
  if (!pool) pools.set(key, (pool = { held: 0, waiting: [] }));
  const p = pool;
  const granted = (): Release => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = p.waiting.shift();
      if (next) next();               // handed straight on: held stays the same
      else p.held -= 1;
    };
  };
  if (p.held < limit) {
    p.held += 1;
    return Promise.resolve(granted());
  }
  return new Promise((resolve) => p.waiting.push(() => resolve(granted())));
}

// ---- the worker's side: ask the server --------------------------------------

interface SlotMsg { slot: 'acquire' | 'release' | 'grant'; id: number; key?: string }
const isSlotMsg = (m: any): m is SlotMsg => m && typeof m === 'object' && typeof m.slot === 'string';

let nextId = 1;
const pending = new Map<number, () => void>();
let listening = false;

function acquireRemote(key: string): Promise<Release> {
  if (slotLimit(key) === Infinity) return Promise.resolve(() => {});
  if (!listening) {
    listening = true;
    process.on('message', (m) => {
      if (isSlotMsg(m) && m.slot === 'grant') { pending.get(m.id)?.(); pending.delete(m.id); }
    });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, () => {
      let done = false;
      resolve(() => {
        if (done) return;
        done = true;
        if (process.connected) process.send!({ slot: 'release', id } satisfies SlotMsg);
      });
    });
    process.send!({ slot: 'acquire', id, key } satisfies SlotMsg);
  });
}

/** Waits for a slot of `key`; call the returned function to give it back. */
export function acquire(key: string): Promise<Release> {
  return process.send && process.connected ? acquireRemote(key) : acquireLocal(key);
}

/** `fn` while holding a slot of `key`. */
export async function withSlot<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquire(key);
  try { return await fn(); } finally { release(); }
}

/** The slot for a request to `url`'s host. */
export function hostKey(url: string): string {
  try { return `host:${new URL(url).host}`; } catch { return 'host:?'; }
}

// ---- the server's side: answer a worker ---------------------------------------

/**
 * Grants `child`'s slot requests from this process's count, and gives back
 * whatever it still holds when it exits, however it exits.
 */
export function serveSlots(child: ChildProcess): void {
  const held = new Map<number, Release>();
  let gone = false;
  child.on('message', (m) => {
    if (!isSlotMsg(m)) return;
    if (m.slot === 'acquire' && m.key) {
      void acquireLocal(m.key).then((release) => {
        // Asked for, then died before it was granted: straight back.
        if (gone) { release(); return; }
        held.set(m.id, release);
        child.send({ slot: 'grant', id: m.id } satisfies SlotMsg, (err) => { if (err) { held.delete(m.id); release(); } });
      });
    } else if (m.slot === 'release') {
      held.get(m.id)?.();
      held.delete(m.id);
    }
  });
  child.once('exit', () => {
    gone = true;
    for (const release of held.values()) release();
    held.clear();
  });
}

/** What is held and waiting right now, for the status view. */
export function slotState(): Record<string, { held: number; waiting: number; limit: number }> {
  const out: Record<string, { held: number; waiting: number; limit: number }> = {};
  for (const [key, p] of pools) {
    if (p.held || p.waiting.length) out[key] = { held: p.held, waiting: p.waiting.length, limit: slotLimit(key) };
  }
  return out;
}
