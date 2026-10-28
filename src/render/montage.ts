// The streetscape's faces from Street View frames alone: each face one
// picture, composed by src/py/streetscape_montage.py from every frame that
// saw it. A frame is a pinhole picture and a frontage is near enough a
// vertical plane, so each frame is rectified onto its frontage's boundary by
// one homography; then every column of the face takes one panorama, the one
// that saw it squarest with the least foliage and nothing missing (the newest
// where those are equal), the picture changing panorama only where the two
// agree, over a short crossfade. The sky is found from the top of each column
// down and left transparent, so the sheet's own sky shows and the roofline is
// the picture's; the footpath below the ground line is kept and what is below
// that is cut. The result is a true-scale elevation of what the cameras saw:
// a tree in front of the boundary still reads a little large and a building
// set back from it a little small, as in any montage, but a tree the street
// was driven past bare in another year is gone.
//
// The cameras must have driven the carriageway: Google also walks some streets
// (Riley Street, Darlinghurst, in October 2024), and a camera a metre or two
// from a facade, which Google then places in the road, shows a few metres of
// wall magnified several times. Such a capture is set aside by its month
// (`skipDrives`, from --skip-drives or STREETSCAPE_SKIP_DRIVES); the log names
// the drives found so one can be. Of the rest the newest drive that covers
// the window is the primary, and the older drives, the bare months first,
// fill in where it has foliage.
//
// The picture is drawn by Python (Pillow and NumPy, in the image; `pip install
// pillow numpy` elsewhere). Without them the script says so, the faces fall
// back to the frames laid on the sheet one by one (src/render/streetscape.ts),
// and the log says why.

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BELOW_GROUND_M, type StreetscapePlan, type ScapeFrame } from '../fetch/streetscape.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'py', 'streetscape_montage.py');
/** Pixels a metre: 300 dpi at 1:500. */
export const MONTAGE_PPM = 24;
/** A picture no wider than this, whatever the window: the scale drops to fit. */
const MAX_WIDTH_PX = 14_000;

export interface Montage {
  side: 1 | -1;
  file: string;
  /** Pixels a metre, and the picture's size. */
  ppm: number; width: number; height: number;
  /** What the picture spans: s at its left and right edges as the viewer sees the face, m AHD at its top and bottom. */
  sAtLeft: number; sAtRight: number; zTop: number; zBottom: number;
  /** How many panoramas the face took its columns from, of how many were laid on it, and their months; the drive most of it is from. */
  panoramas: number; candidates: number; dates: string[]; drive?: string;
  /** The share of the window's columns some frame reached, of the face's surface that is foliage, and that was sky. */
  columnsCovered: number; foliageShare: number; skyShare: number;
  /** The top of whatever stands on each metre of the face, once the sky is taken off, where anything does. */
  tops: { s: number; z: number }[];
  /** Which panorama each run of the face came from. */
  sources: { s0: number; s1: number; panoId: string; date?: string }[];
}

interface Result {
  faces: ({ file: string; width: number; height: number; ppm: number; panoramas: number; candidates: number; dates: string[]; drive?: string; columnsCovered: number; foliageShare: number; skyShare: number; opaqueShare: number; tops: { m: number; z: number }[]; sources: { x0: number; x1: number; panoId: string; date?: string }[] } | null)[];
  notes: string[];
  error?: string;
}

const run = (args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> =>
  new Promise((resolve) => {
    execFile('python3', args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: err ? ((err as any).code ?? 1) : 0 });
    });
  });

/**
 * Each face's montage, as `montage_<l|r>.png` in `outDir`, from the frames in that folder; null for a face no
 * frame reached, and null altogether when Python or its imaging modules are not there (the log says). `reachM`
 * is how far over the face's highest ground the frames were asked to look, which is the picture's top.
 */
export interface MontageOpts {
  /** How far over the face's highest ground the frames were asked to look, metres: the picture's top. */
  reachM: number;
  ppm?: number;
  /** Whether the sky is taken off (the default). */
  sky?: boolean;
  /** Captures to leave out, by month ("2024-10") or year ("2024"): a footpath walk, which Google places in the road. */
  skipDrives?: string[];
  /** Whether each camera's distance is calibrated from the pictures (experimental; see the script). */
  calibrate?: boolean;
  log?: (m: string) => void;
}

/** Whether a frame's month is among the captures to leave out. */
export const skipped = (date: string | undefined, skipDrives: string[] = []) => skipDrives.some((d) => d && (date ?? '').startsWith(d.trim()));

export async function composeMontages(plan: StreetscapePlan, frames: ScapeFrame[], outDir: string, opts: MontageOpts): Promise<(Montage | null)[] | null> {
  const log = opts.log ?? (() => {});
  const len = plan.s1 - plan.s0;
  const ppm = Math.min(opts.ppm ?? MONTAGE_PPM, MAX_WIDTH_PX / Math.max(1, len));
  const kept = frames.filter((fr) => !skipped(fr.date, opts.skipDrives));
  if (kept.length < frames.length) log(`  montage: ${frames.length - kept.length} frames of the ${opts.skipDrives!.join(', ')} capture set aside`);
  const spec = plan.faces.map((face) => {
    const zs = face.ground.map((g) => g.z);
    const hi = zs.length ? Math.max(...zs) : 0, lo = zs.length ? Math.min(...zs) : 0;
    const own = kept.filter((fr) => fr.side === face.side);
    return {
      side: face.side, file: `montage_${face.side > 0 ? 'l' : 'r'}.png`, ppm,
      sAtLeft: face.sRightward ? plan.s0 : plan.s1, sAtRight: face.sRightward ? plan.s1 : plan.s0,
      zTop: hi + opts.reachM, zBot: lo - BELOW_GROUND_M - 0.6,
      ground: face.ground, offsetM: face.offsetM,
      planes: face.frontages.map((f) => ({ s0: f.s0, s1: f.s1, offsetM: f.offsetM })),
      frames: own.map((fr) => ({ file: fr.file, panoId: fr.panoId, date: fr.date, s: fr.s, d: fr.d, z: fr.z, heading: fr.heading, pitch: fr.pitch, fov: fr.fov, px: fr.px ?? 640, tier: fr.tier })),
      sky: opts.sky ?? true,
      calibrate: opts.calibrate ?? false,
    };
  });
  const jobPath = join(outDir, 'montage_job.json');
  await writeFile(jobPath, JSON.stringify({ outDir, axis: [plan.axis.x, plan.axis.y], faces: spec }));
  const started = Date.now();
  const res = await run([SCRIPT, jobPath], 20 * 60_000);
  let parsed: Result | null = null;
  try { parsed = JSON.parse(res.stdout.trim().split('\n').pop() ?? '') as Result; } catch { /* not JSON */ }
  if (!parsed || res.code !== 0 || parsed.error) {
    const why = parsed?.error ?? res.stderr.trim().split('\n').pop() ?? `exit ${res.code}`;
    log(`  WARN montage not drawn (${why}); the frames go on the sheet one by one`);
    return null;
  }
  for (const n of parsed.notes) log(`  montage: ${n}`);
  log(`  montage: ${plan.faces.length} faces in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return parsed.faces.map((f, i) => {
    if (!f) return null;
    const sp = spec[i];
    const dir = sp.sAtRight >= sp.sAtLeft ? 1 : -1;
    const sOfX = (x: number) => sp.sAtLeft + (dir * x) / f.ppm;
    return {
      side: plan.faces[i].side, file: f.file, ppm: f.ppm, width: f.width, height: f.height,
      sAtLeft: sp.sAtLeft, sAtRight: sp.sAtRight, zTop: sp.zTop, zBottom: sp.zBot,
      panoramas: f.panoramas, candidates: f.candidates, dates: f.dates, drive: f.drive,
      columnsCovered: f.columnsCovered, foliageShare: f.foliageShare, skyShare: f.skyShare,
      tops: f.tops.map((t) => ({ s: sOfX((t.m + 0.5) * f.ppm), z: t.z })).sort((a, b) => a.s - b.s),
      sources: f.sources.map((s) => ({ s0: sOfX(s.x0), s1: sOfX(s.x1), panoId: s.panoId, date: s.date })),
    };
  });
}
