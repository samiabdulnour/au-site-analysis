// A task tried once more after a pause when it fails outright.
//
// The samples run is a score of drawings, each asking the same public services
// afresh, and one of them meeting a service's bad minute lost the whole run:
// the NSW address register "did not answer in time" on the fifth context sheet
// of eight. A second failure is the caller's.

export async function onceMore<T>(run: () => Promise<T>, opts: { waitMs?: number; onFail?: (reason: string) => void } = {}): Promise<T> {
  try { return await run(); } catch (e: any) {
    opts.onFail?.(String(e?.message ?? e).split('\n')[0]);
    await new Promise((r) => setTimeout(r, opts.waitMs ?? 120_000));
    return run();
  }
}
