// The streetscape's faces drawn from Google's Photorealistic 3D Tiles: each
// an orthographic elevation, so a metre is a metre everywhere on it, nothing
// leans, and a tree stands where it stands rather than where a camera saw it.
//
// The meshes (src/fetch/tiles3d.ts) are loaded into three.js in a headless
// Chromium with WebGL in software, carried from Earth-centred coordinates into
// the site's east-north-up frame in double precision (the GPU's single
// precision would wobble by metres at the Earth's radius), and shown unlit,
// as their textures were photographed. For each face the ground under the
// footpath is found first by rays cast down at the boundary, the lowest thing
// each meets; then an orthographic camera stands on the street's centreline
// looking square at the face, its near plane on the centreline, so the near
// half of the street (the other side's buildings and trees) is cut away, and
// its far plane `depthM` behind the boundary, so the next street's towers are
// not drawn over the face. Everything is served to the page from this
// process through Playwright's routing: the key and the meshes never touch
// the disk, and only the finished pictures do.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { launch } from './pdf.js';
import type { StreetTile } from '../fetch/tiles3d.js';

export interface FaceView {
  side: 1 | -1;
  /** The window along the street, metres. */
  sMin: number; sMax: number;
  /** Where the camera stands (east, north) on the centreline, opposite the window's middle, and the way it looks. */
  camera: [number, number]; dir: [number, number];
  /** How far the camera sees past its near plane: to the boundary and `depthM` behind it. */
  far: number;
  /** Where the ground is sought: on the footpath at the boundary every metre, east and north. */
  rays: { s: number; x: number; y: number }[];
}

export interface Elevation {
  side: 1 | -1;
  file: string;
  /** Pixels a metre, and the picture's size. */
  ppm: number; width: number; height: number;
  /** What the picture spans: s at its left and right edges, height (ellipsoidal metres) at its top and bottom. */
  sAtLeft: number; sAtRight: number; zTop: number; zBottom: number;
  /** The ground at the boundary every metre: where a ray found the mesh, until `settleGround` puts the elevation model there. */
  ground: { s: number; z: number }[];
  /** The top of whatever stands on each metre of the face, where anything does. */
  tops: { s: number; z: number }[];
}

/** The elevations' sky, which the sheet's bands share. */
export const SCAPE_SKY = '#dfe4e6';
const BELOW_M = 4, ABOVE_M = 70;
const MAX_PX = 8000;

const PAGE = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
try {
  const job = await (await fetch('/job.json')).json();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const draco = new DRACOLoader().setDecoderPath('/three/examples/jsm/libs/draco/gltf/');
  const ktx2 = new KTX2Loader().setTranscoderPath('/three/examples/jsm/libs/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
  const enu = new THREE.Matrix4().fromArray(job.enu);
  // glTF is y-up; 3D Tiles turn it z-up before the tile's own transform
  const yUp = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const scene = new THREE.Scene();
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < job.tiles.length) {
      const t = job.tiles[next++];
      const gltf = await loader.parseAsync(await (await fetch('/tile/' + t.id + '.glb')).arrayBuffer(), '');
      const root = gltf.scene;
      root.matrixAutoUpdate = false;
      root.matrix.copy(enu).multiply(new THREE.Matrix4().fromArray(t.transform)).multiply(yUp);
      scene.add(root);
    }
  }));
  const meshes = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    // unlit, as photographed: the light is in the textures
    const m = o.material;
    if (!m.isMeshBasicMaterial) o.material = new THREE.MeshBasicMaterial({ map: m.map ?? null, color: m.map ? 0xffffff : (m.color ?? 0xcccccc) });
    o.material.side = THREE.DoubleSide;
    meshes.push(o);
  });
  scene.updateMatrixWorld(true);

  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, 0, -1);
  const faces = [];
  for (const f of job.faces) {
    // the ground: the lowest thing a ray down meets, under any awning or tree
    const ground = [];
    for (const r of f.rays) {
      ray.set(new THREE.Vector3(r.x, r.y, 3000), down);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length) ground.push({ s: r.s, z: hits[hits.length - 1].point.z });
    }
    if (!ground.length) { faces.push(null); continue; }
    const zs = ground.map((g) => g.z).sort((a, b) => a - b);
    const zBottom = zs[0] - job.below, zTop = zs[zs.length - 1] + job.above;
    const ppm = Math.min(job.ppm, job.maxPx / (f.sMax - f.sMin), job.maxPx / (zTop - zBottom));
    const W = Math.round((f.sMax - f.sMin) * ppm), H = Math.round((zTop - zBottom) * ppm);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    const half = (f.sMax - f.sMin) / 2;
    const cam = new THREE.OrthographicCamera(-half, half, zTop, zBottom, 0.05, f.far);
    cam.up.set(0, 0, 1);
    cam.position.set(f.camera[0], f.camera[1], 0);
    cam.lookAt(f.camera[0] + f.dir[0], f.camera[1] + f.dir[1], 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    // the top of what stands on each metre, from the picture's coverage (rows come bottom first)
    const gl = renderer.getContext();
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const tops = [];
    const metres = Math.floor(W / ppm);
    for (let m = 0; m < metres; m++) {
      let top = -1;
      for (let x = Math.round(m * ppm); x < Math.round((m + 1) * ppm) && x < W; x++) {
        for (let y = H - 1; y > top; y--) if (px[(y * W + x) * 4 + 3] > 0) { top = y; break; }
      }
      if (top >= 0) tops.push({ m, z: zBottom + (top + 1) / ppm });
    }
    // onto the sheet's sky, as a JPEG
    const c2 = document.createElement('canvas');
    c2.width = W; c2.height = H;
    const ctx = c2.getContext('2d');
    ctx.fillStyle = job.background;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(renderer.domElement, 0, 0);
    faces.push({ jpeg: c2.toDataURL('image/jpeg', 0.9), W, H, ppm, zTop, zBottom, ground, tops });
  }
  window.__result = { faces, meshes: meshes.length };
} catch (e) {
  window.__error = String(e && e.stack || e);
}
</script>`;

/**
 * The ground under an elevation. The meshes are photogrammetry, a single surface draped over everything: under a
 * tree's canopy or an awning there is no ground in them, so a ray down there meets the canopy and nothing below.
 * The elevation model has the ground everywhere, but in AHD, where the meshes stand on the ellipsoid; the two
 * differ by the geoid (about 22 m at Sydney) and the meshes' own error. That difference is read where the rays met
 * the ground, the low fifth of them (a canopy only ever lifts a ray), and the elevation model, lifted by it, is the
 * line. Returns the line and the offset, or null where too few rays met anything to read it.
 */
export function settleGround(hits: { s: number; z: number }[], dem: { s: number; z: number }[]): { ground: { s: number; z: number }[]; offsetM: number } | null {
  const at = new Map(dem.map((g) => [Math.round(g.s), g.z]));
  const diffs = hits.map((h) => (at.has(Math.round(h.s)) ? h.z - at.get(Math.round(h.s))! : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (diffs.length < 10) return null;
  const offsetM = diffs[Math.floor(diffs.length * 0.2)];
  return { ground: dem.map((g) => ({ s: g.s, z: g.z + offsetM })), offsetM };
}

/**
 * Each face's elevation, as `elevation_<l|r>.jpg` in `outDir`, on `background`; null for a face whose ground no
 * ray found (no mesh there). `ppm` is the pixels a metre asked for, lowered where the picture would pass the
 * renderer's largest.
 */
export async function renderElevations(tiles: StreetTile[], enuMatrix: number[], faces: FaceView[], outDir: string, opts: { ppm: number; background: string; log?: (m: string) => void }): Promise<(Elevation | null)[]> {
  // the package's own folder, from its main entry (its exports leave out package.json): build/three.cjs
  const three = dirname(dirname(createRequire(import.meta.url).resolve('three')));
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const job = JSON.stringify({
    enu: enuMatrix, ppm: opts.ppm, maxPx: MAX_PX, below: BELOW_M, above: ABOVE_M, background: opts.background,
    tiles: tiles.map((t) => ({ id: t.id, transform: t.transform })), faces,
  });
  const browser = await launch(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
  try {
    const page = await browser.newPage();
    await page.route('http://render.local/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: PAGE });
      if (path === '/job.json') return route.fulfill({ contentType: 'application/json', body: job });
      const tile = path.match(/^\/tile\/(\d+)\.glb$/);
      if (tile) {
        const t = byId.get(Number(tile[1]));
        return t ? route.fulfill({ contentType: 'model/gltf-binary', body: Buffer.from(t.bytes) }) : route.fulfill({ status: 404 });
      }
      if (path.startsWith('/three/') && !path.includes('..')) {
        try {
          const body = await readFile(join(three, path.slice('/three/'.length)));
          const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
          return route.fulfill({ contentType: type, body });
        } catch { return route.fulfill({ status: 404 }); }
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto('http://render.local/', { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).__result || (window as any).__error, null, { timeout: 15 * 60_000, polling: 1000 });
    const err = await page.evaluate(() => (window as any).__error as string | undefined);
    if (err) throw new Error(`elevation render: ${err.split('\n')[0]}`);
    const res = await page.evaluate(() => (window as any).__result) as { meshes: number; faces: ({ jpeg: string; W: number; H: number; ppm: number; zTop: number; zBottom: number; ground: { s: number; z: number }[]; tops: { m: number; z: number }[] } | null)[] };
    opts.log?.(`  3D tiles: ${res.meshes} meshes drawn`);
    const out: (Elevation | null)[] = [];
    for (const [i, r] of res.faces.entries()) {
      const f = faces[i];
      if (!r) { out.push(null); continue; }
      const file = `elevation_${f.side > 0 ? 'l' : 'r'}.jpg`;
      await writeFile(join(outDir, file), Buffer.from(r.jpeg.split(',')[1], 'base64'));
      // the camera's right is the street's direction for the left face, against it for the right
      const sAtLeft = f.side > 0 ? f.sMin : f.sMax, sAtRight = f.side > 0 ? f.sMax : f.sMin;
      const sOfMetre = (m: number) => sAtLeft + (sAtRight - sAtLeft) * ((m + 0.5) / (r.W / r.ppm));
      out.push({
        side: f.side, file, ppm: r.ppm, width: r.W, height: r.H, sAtLeft, sAtRight, zTop: r.zTop, zBottom: r.zBottom,
        ground: r.ground.sort((a, b) => a.s - b.s), tops: r.tops.map((t) => ({ s: sOfMetre(t.m), z: t.z })).sort((a, b) => a.s - b.s),
      });
    }
    return out;
  } finally {
    await browser.close();
  }
}
