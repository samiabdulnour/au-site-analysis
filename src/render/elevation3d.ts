// The streetscape's faces drawn on Google's Photorealistic 3D Tiles: each an
// orthographic elevation, so a metre is a metre everywhere on it, nothing
// leans, and a tree stands where it stands rather than where a camera saw it;
// and, with Street View frames, the frames' photographs laid onto it.
//
// The meshes (src/fetch/tiles3d.ts) are loaded into three.js in a headless
// Chromium with WebGL in software, carried from Earth-centred coordinates into
// the site's east-north-up frame in double precision (the GPU's single
// precision would wobble by metres at the Earth's radius). For each face the
// ground under the footpath is read first, by rays cast down at the boundary
// (`settleGround`); then an orthographic camera stands on the street's
// centreline looking square at the face, its near plane on the centreline, so
// the near half of the street (the other side's buildings and trees) is cut
// away, and its far plane `far` metres off, so the next street's towers are
// not drawn over the face.
//
// The meshes' own textures are the base. Over them each Street View frame is
// projected from where its camera stood, as a slide projector would: every
// point of the face the elevation shows is carried into the frame's picture,
// and takes the frame's colour there when the frame saw it (a depth map
// rendered from the camera, as for shadows, says whether something stood
// between). Where several frames saw a point, the one that saw it largest and
// most square, from nearest along the street, wins; where none did (a roof, a
// wall behind a tree from every side), the mesh's texture stays. So the
// facades are photographs, each where it is in depth, and the trees are the
// trees, at their size and in their place.
//
// Everything is served to the page from this process through Playwright's
// routing: the key and the meshes never touch the disk, and only the finished
// pictures do.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { launch } from './pdf.js';
import type { StreetTile } from '../fetch/tiles3d.js';

/** A Street View frame to lay on a face: its camera in the east-north-up frame (height in AHD), and how it looked. */
export interface DrapeFrame { file: string; x: number; y: number; zAhd: number; s: number; heading: number; pitch: number; fov: number; px: number }

export interface FaceView {
  side: 1 | -1;
  /** The window along the street, metres. */
  sMin: number; sMax: number;
  /** Where the camera stands (east, north) on the centreline, opposite the window's middle, and the way it looks. */
  camera: [number, number]; dir: [number, number];
  /** How far the camera sees past its near plane: to the boundary and some way behind it. */
  far: number;
  /** Where the ground is sought: on the footpath at the boundary every metre, east and north. */
  rays: { s: number; x: number; y: number }[];
  /** The elevation model at the boundary every metre, m AHD. */
  dem: { s: number; z: number }[];
  /** The street's axis, for where along it a point of the face is. */
  at0: [number, number]; axis: [number, number];
  /** The Street View frames to lay on the face; none draws the meshes' own textures alone. */
  frames: DrapeFrame[];
  /** The face's building line: its boundary's distance from the axis, metres. */
  boundary: number;
}

export interface Elevation {
  side: 1 | -1;
  file: string;
  /** Pixels a metre, and the picture's size. */
  ppm: number; width: number; height: number;
  /** What the picture spans: s at its left and right edges, height (ellipsoidal metres) at its top and bottom. */
  sAtLeft: number; sAtRight: number; zTop: number; zBottom: number;
  /** The ground at the boundary every metre, on the meshes' heights. */
  ground: { s: number; z: number }[];
  /** How far the meshes stand above AHD here (the geoid and their own error). */
  offsetM: number;
  /** The top of whatever stands on each metre of the face, where anything does. */
  tops: { s: number; z: number }[];
  /** The top of the buildings on each metre: what stands at or behind the building line and is not green (none in
   *  bundles drawn before they were read). */
  roofs?: { s: number; z: number }[];
  /** The Street View frames laid on it, and the share of the face's surface they hold. */
  draped: number; photoShare: number;
}

/** The elevations' sky, which the sheet's bands share. */
export const SCAPE_SKY = '#dfe4e6';
const BELOW_M = 4, ABOVE_M = 70;
/** What stands this near a frame's camera hides nothing in it: see the depth maps. */
const NEAR_IGNORE_M = 4;
const MAX_PX = 8000;

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

const PAGE = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

let renderer, scene;
const meshes = [];
const WORLD_VS = 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
// every pixel's point of the face, in the east-north-up frame; w = 1 where there is one
const posMat = new THREE.ShaderMaterial({ vertexShader: WORLD_VS, fragmentShader: 'varying vec3 vW; void main() { gl_FragColor = vec4(vW, 1.0); }', side: THREE.DoubleSide });
// the distance from a frame's camera to what it sees first: the frame's depth map. Nothing within ${NEAR_IGNORE_M} m
// counts: the meshes draw a street tree as a solid lump hanging over the road, and a camera on a car's roof is often
// inside one, where the photograph sees out perfectly well
const camU = { value: new THREE.Vector3() };
const distMat = new THREE.ShaderMaterial({ uniforms: { cam: camU }, vertexShader: WORLD_VS, fragmentShader: 'uniform vec3 cam; varying vec3 vW; void main() { float d = length(vW - cam); if (d < ${NEAR_IGNORE_M}.0) discard; gl_FragColor = vec4(d, 0.0, 0.0, 1.0); }', side: THREE.DoubleSide });
// a frame laid on the face where it saw it clear, its weight as depth so the best frame for each pixel wins; its
// pixels carry an alpha of 254, so the share the photographs hold can be counted. What a frame saw only through
// something else, or edge-on (the surface's normal from the position picture's own slopes), it leaves to another
// frame or to the mesh: a roof seen through a tree is the tree in every photograph, and a lump of tree seen edge-on
// smears. The street's trees keep the meshes' texture, one material for every tree: what stands in the reserve more
// than 2.5 m in front of the boundary, and what is green in the meshes' own picture nearer it (the meshes are not
// true to the boundary closer than that, and a facade there is the photograph's).
const drapeMat = new THREE.ShaderMaterial({
  uniforms: { posTex: { value: null }, baseTex: { value: null }, shadow: { value: null }, photo: { value: null }, cam: { value: new THREE.Vector3() }, fwd: { value: new THREE.Vector3() }, rgt: { value: new THREE.Vector3() }, upv: { value: new THREE.Vector3() }, focal: { value: 1 }, size: { value: 640 }, sCam: { value: 0 }, at0: { value: new THREE.Vector2() }, axis: { value: new THREE.Vector2() }, faceDir: { value: new THREE.Vector3() }, boundary: { value: 0 }, side: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: \`
    uniform sampler2D posTex, baseTex, shadow, photo;
    uniform vec3 cam, fwd, rgt, upv, faceDir;
    uniform float focal, size, sCam, boundary, side;
    uniform vec2 at0, axis;
    varying vec2 vUv;
    void main() {
      vec4 P = texture2D(posTex, vUv);
      vec3 n = cross(dFdx(P.xyz), dFdy(P.xyz));
      if (P.w < 0.5) discard;
      vec3 v = P.xyz - cam;
      float zc = dot(v, fwd);
      if (zc < 0.5) discard;
      float u = 0.5 * size + focal * dot(v, rgt) / zc;
      float w = 0.5 * size - focal * dot(v, upv) / zc;
      float edge = min(min(u, size - u), min(w, size - w));
      if (edge < 2.0) discard;
      vec2 st = vec2(u / size, 1.0 - w / size);
      float dist = length(v);
      float d0 = texture2D(shadow, st).r;
      if (d0 > 0.0 && dist > d0 + 0.35 + 0.015 * dist) discard;
      float facing = length(n) > 1e-9 ? abs(dot(normalize(n), v / dist)) : 1.0;
      if (facing < 0.3) discard;
      float across = dot(P.xy - at0, vec2(-axis.y, axis.x)) * side;
      vec3 b = texture2D(baseTex, vUv).rgb;
      bool green = b.g - max(b.r, b.b) > 0.02 && b.g < 0.75;
      if (across < boundary - 2.5 || (across < boundary + 0.5 && green)) discard;
      vec3 c = texture2D(photo, st).rgb;
      float ds = (dot(P.xy - at0, axis) - sCam) / 8.0;
      float q = (focal / zc) * facing * max(0.05, dot(v / dist, faceDir)) * (0.2 + exp(-ds * ds)) * smoothstep(2.0, 48.0, edge);
      gl_FragDepth = 1.0 / (1.0 + q);
      gl_FragColor = vec4(c, 254.0 / 255.0);
    }\`,
  depthTest: true, depthWrite: true,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), drapeMat);
quad.frustumCulled = false;
const quadScene = new THREE.Scene();
quadScene.add(quad);
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

window.scape = {
  async load(job) {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.autoClear = false;
    const draco = new DRACOLoader().setDecoderPath('/three/examples/jsm/libs/draco/gltf/');
    const ktx2 = new KTX2Loader().setTranscoderPath('/three/examples/jsm/libs/basis/').detectSupport(renderer);
    const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
    const enu = new THREE.Matrix4().fromArray(job.enu);
    // glTF is y-up; 3D Tiles turn it z-up before the tile's own transform
    const yUp = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    scene = new THREE.Scene();
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
    scene.traverse((o) => {
      if (!o.isMesh) return;
      // unlit, as photographed, and the textures' bytes as they are: the pictures are sRGB in and sRGB out
      const m = o.material;
      const map = m.map ?? null;
      if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
      o.material = new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : (m.color ?? 0xcccccc), side: THREE.DoubleSide });
      meshes.push(o);
    });
    scene.updateMatrixWorld(true);
    return meshes.length;
  },

  // the lowest thing a ray down meets, under any awning or tree
  ground(rays) {
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, 0, -1), out = [];
    for (const r of rays) {
      ray.set(new THREE.Vector3(r.x, r.y, 3000), down);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length) out.push({ s: r.s, z: hits[hits.length - 1].point.z });
    }
    return out;
  },

  async render(f) {
    const ppm = Math.min(f.ppm, ${MAX_PX} / (f.sMax - f.sMin), ${MAX_PX} / (f.zTop - f.zBottom));
    const W = Math.round((f.sMax - f.sMin) * ppm), H = Math.round((f.zTop - f.zBottom) * ppm);
    const half = (f.sMax - f.sMin) / 2;
    const cam = new THREE.OrthographicCamera(-half, half, f.zTop, f.zBottom, 0.05, f.far);
    cam.up.set(0, 0, 1);
    cam.position.set(f.camera[0], f.camera[1], 0);
    cam.lookAt(f.camera[0] + f.dir[0], f.camera[1] + f.dir[1], 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    // the base: the meshes' own textures
    const color = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    renderer.setRenderTarget(color);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    scene.overrideMaterial = null;
    renderer.render(scene, cam);

    // the buildings' tops: the meshes again with the camera's near plane a metre short of the building line, so the
    // street's trees and the awnings over the footpath are cut away and what stands behind them shows; in each
    // column, the highest pixel that is not green (a garden's tree)
    const roofRow = new Int32Array(W).fill(-1);
    {
      const camAcross = ((f.camera[0] - f.at0[0]) * -f.axis[1] + (f.camera[1] - f.at0[1]) * f.axis[0]) * f.side;
      const cut = cam.clone();
      cut.near = Math.max(0.05, f.boundary - 1 - camAcross);
      cut.updateProjectionMatrix();
      const rb = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      renderer.setRenderTarget(rb);
      renderer.clear(true, true, true);
      renderer.render(scene, cut);
      const rp = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      renderer.setRenderTarget(rp);
      renderer.clear(true, true, true);
      scene.overrideMaterial = posMat;
      renderer.render(scene, cut);
      scene.overrideMaterial = null;
      const CH = 128, pf = new Float32Array(W * CH * 4), pb = new Uint8Array(W * CH * 4);
      for (let y0 = 0; y0 < H; y0 += CH) {
        const rows = Math.min(CH, H - y0);
        renderer.readRenderTargetPixels(rp, 0, y0, W, rows, pf);
        renderer.readRenderTargetPixels(rb, 0, y0, W, rows, pb);
        for (let r = 0; r < rows; r++) for (let x = 0; x < W; x++) {
          const i = (r * W + x) * 4;
          if (pf[i + 3] === 0) continue;
          if ((pb[i + 1] - Math.max(pb[i], pb[i + 2])) / 255 > 0.02 && pb[i + 1] / 255 < 0.75) continue;
          if (y0 + r > roofRow[x]) roofRow[x] = y0 + r;
        }
      }
      rb.dispose();
      rp.dispose();
    }

    let draped = 0;
    if (f.frames.length) {
      // the meshes' own picture again, for the drape to read what is green in it
      const base = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      renderer.setRenderTarget(base);
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
      const pos = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      renderer.setRenderTarget(pos);
      renderer.clear(true, true, true);
      scene.overrideMaterial = posMat;
      renderer.render(scene, cam);

      const shadow = new THREE.WebGLRenderTarget(640, 640, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      const persp = new THREE.PerspectiveCamera(90, 1, 0.3, 600);
      persp.up.set(0, 0, 1);
      // the frames compete through the colour target's depth: cleared once, each pass keeps what it wins
      renderer.setRenderTarget(color);
      renderer.clearDepth();
      const loader = new THREE.TextureLoader();
      const faceDir = new THREE.Vector3(f.dir[0], f.dir[1], 0);
      for (const fr of f.frames) {
        const tex = await loader.loadAsync('/frame/' + encodeURIComponent(fr.file));
        tex.colorSpace = THREE.NoColorSpace;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        const th = fr.heading * Math.PI / 180, ph = fr.pitch * Math.PI / 180;
        const fwd = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th) * Math.cos(ph), Math.sin(ph));
        const rgt = new THREE.Vector3(Math.cos(th), -Math.sin(th), 0);
        const upv = new THREE.Vector3(-Math.sin(th) * Math.sin(ph), -Math.cos(th) * Math.sin(ph), Math.cos(ph));
        const at = new THREE.Vector3(fr.x, fr.y, fr.z);
        // what the camera saw first, everywhere in its picture
        persp.fov = fr.fov;
        persp.position.copy(at);
        persp.lookAt(at.clone().add(fwd));
        persp.updateMatrixWorld(true);
        persp.updateProjectionMatrix();
        camU.value.copy(at);
        renderer.setRenderTarget(shadow);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true, true);
        scene.overrideMaterial = distMat;
        renderer.render(scene, persp);
        // the frame laid on the face, only near where it stood
        const u = drapeMat.uniforms;
        u.posTex.value = pos.texture; u.baseTex.value = base.texture; u.shadow.value = shadow.texture; u.photo.value = tex;
        u.boundary.value = f.boundary; u.side.value = f.side;
        u.cam.value.copy(at); u.fwd.value.copy(fwd); u.rgt.value.copy(rgt); u.upv.value.copy(upv);
        u.focal.value = (fr.px / 2) / Math.tan(fr.fov * Math.PI / 360); u.size.value = fr.px; u.sCam.value = fr.s;
        u.at0.value.set(f.at0[0], f.at0[1]); u.axis.value.set(f.axis[0], f.axis[1]); u.faceDir.value.copy(faceDir);
        renderer.setRenderTarget(color);
        const x0 = (f.side > 0 ? fr.s - 45 - f.sMin : f.sMax - fr.s - 45) * ppm;
        renderer.setScissorTest(true);
        renderer.setScissor(Math.max(0, Math.floor(x0)), 0, Math.ceil(90 * ppm), H);
        renderer.render(quadScene, quadCam);
        renderer.setScissorTest(false);
        tex.dispose();
        draped++;
      }
      scene.overrideMaterial = null;
      shadow.dispose();
      base.dispose();
      pos.dispose();
    }

    // the picture, its rows top first; the top of what stands on each metre; the share the photographs hold
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(color, 0, 0, W, H, px);
    color.dispose();
    renderer.setRenderTarget(null);
    let surface = 0, photo = 0;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] === 0) continue;
      surface++;
      if (px[i] === 254) photo++;
      px[i] = 255;
    }
    const tops = [];
    const metres = Math.floor(W / ppm);
    for (let m = 0; m < metres; m++) {
      let top = -1;
      for (let x = Math.round(m * ppm); x < Math.round((m + 1) * ppm) && x < W; x++) {
        for (let y = H - 1; y > top; y--) if (px[(y * W + x) * 4 + 3] > 0) { top = y; break; }
      }
      if (top >= 0) tops.push({ m, z: f.zBottom + (top + 1) / ppm });
    }
    const roofs = [];
    for (let m = 0; m < metres; m++) {
      let top = -1;
      for (let x = Math.round(m * ppm); x < Math.round((m + 1) * ppm) && x < W; x++) top = Math.max(top, roofRow[x]);
      if (top >= 0) roofs.push({ m, z: f.zBottom + (top + 1) / ppm });
    }
    const c2 = document.createElement('canvas');
    c2.width = W; c2.height = H;
    const ctx = c2.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    // onto the sheet's sky, kept for stitch() to lay beside the face's other pieces
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = f.background;
    ctx.fillRect(0, 0, W, H);
    pieces.push(c2);
    return { W, H, ppm, tops, roofs, draped, surface, photo };
  },

  // the pieces drawn since the last stitch, left to right, as one JPEG
  stitch() {
    const c = document.createElement('canvas');
    c.width = pieces.reduce((w, p) => w + p.width, 0); c.height = pieces[0].height;
    const ctx = c.getContext('2d');
    let x = 0;
    for (const p of pieces) { ctx.drawImage(p, x, 0); x += p.width; }
    pieces.length = 0;
    return c.toDataURL('image/jpeg', 0.9);
  },
};
const pieces = [];
window.ready = true;
</script>`;

/**
 * Each face's elevation, as `elevation_<l|r>.jpg` in `outDir`, on `background`; null for a face whose ground no
 * ray found (no mesh there). `ppm` is the pixels a metre asked for, lowered where the picture would pass the
 * renderer's largest. A face's Street View frames are read from `outDir` by their file names.
 */
export async function renderElevations(tiles: StreetTile[], enuMatrix: number[], faces: FaceView[], outDir: string, opts: { ppm: number; background: string; log?: (m: string) => void }): Promise<(Elevation | null)[]> {
  // the package's own folder, from its main entry (its exports leave out package.json): build/three.cjs
  const three = dirname(dirname(createRequire(import.meta.url).resolve('three')));
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const browser = await launch(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
  try {
    const page = await browser.newPage();
    await page.route('http://render.local/**', async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: PAGE });
      const tile = path.match(/^\/tile\/(\d+)\.glb$/);
      if (tile) {
        const t = byId.get(Number(tile[1]));
        return t ? route.fulfill({ contentType: 'model/gltf-binary', body: Buffer.from(t.bytes) }) : route.fulfill({ status: 404 });
      }
      const frame = path.match(/^\/frame\/([\w.-]+\.jpg)$/);
      if (frame) {
        try { return route.fulfill({ contentType: 'image/jpeg', body: await readFile(join(outDir, frame[1])) }); }
        catch { return route.fulfill({ status: 404 }); }
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
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://render.local/', { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).ready, null, { timeout: 60_000 }).catch(() => { throw new Error(`elevation page: ${errors[0] ?? 'did not load'}`); });
    const n = await page.evaluate((job) => (window as any).scape.load(job), { enu: enuMatrix, tiles: tiles.map((t) => ({ id: t.id, transform: t.transform })) });
    opts.log?.(`  3D tiles: ${n} meshes loaded`);

    const out: (Elevation | null)[] = [];
    for (const f of faces) {
      const hits = await page.evaluate((rays) => (window as any).scape.ground(rays), f.rays) as { s: number; z: number }[];
      const settled = settleGround(hits, f.dem);
      if (!settled) { out.push(null); continue; }
      const zs = settled.ground.map((g) => g.z);
      const zBottom = Math.min(...zs) - BELOW_M, zTop = Math.max(...zs) + ABOVE_M;
      // the frames' cameras on the meshes' heights: the elevation model's, lifted as the ground is
      const frames = f.frames.map((fr) => ({ ...fr, z: fr.zAhd + settled.offsetM }));
      // a face wider than the renderer's widest picture is drawn in pieces of whole metres, the camera moved along
      // the street to each one's middle, and laid side by side; the camera's right is the street's direction for the
      // left face, against it for the right, so the pieces go left to right in that order
      const span = f.sMax - f.sMin, count = Math.max(1, Math.ceil((span * opts.ppm) / MAX_PX)), sMid = (f.sMin + f.sMax) / 2;
      const edges = Array.from({ length: count + 1 }, (_, k) => f.sMin + Math.round((k * span) / count));
      const ks = Array.from({ length: count }, (_, k) => (f.side > 0 ? k : count - 1 - k));
      let W = 0, H = 0, ppm = opts.ppm, draped = 0, surface = 0, photo = 0;
      const tops: { s: number; z: number }[] = [], roofs: { s: number; z: number }[] = [];
      for (const k of ks) {
        const a = edges[k], b = edges[k + 1], mid = (a + b) / 2;
        const camera: [number, number] = [f.camera[0] + f.axis[0] * (mid - sMid), f.camera[1] + f.axis[1] * (mid - sMid)];
        const r = await page.evaluate((spec) => (window as any).scape.render(spec), {
          ...f, sMin: a, sMax: b, camera, frames: frames.filter((fr) => fr.s > a - 50 && fr.s < b + 50), zBottom, zTop, ppm: opts.ppm, background: opts.background,
        }) as { W: number; H: number; ppm: number; tops: { m: number; z: number }[]; roofs: { m: number; z: number }[]; draped: number; surface: number; photo: number };
        const left = f.side > 0 ? a : b, right = f.side > 0 ? b : a;
        const sOfMetre = (m: number) => left + (right - left) * ((m + 0.5) / (r.W / r.ppm));
        tops.push(...r.tops.map((t) => ({ s: sOfMetre(t.m), z: t.z })));
        roofs.push(...r.roofs.map((t) => ({ s: sOfMetre(t.m), z: t.z })));
        W += r.W; H = r.H; ppm = r.ppm; draped += r.draped; surface += r.surface; photo += r.photo;
      }
      const jpeg = await page.evaluate(() => (window as any).scape.stitch()) as string;
      const file = `elevation_${f.side > 0 ? 'l' : 'r'}.jpg`;
      await writeFile(join(outDir, file), Buffer.from(jpeg.split(',')[1], 'base64'));
      const sAtLeft = f.side > 0 ? f.sMin : f.sMax, sAtRight = f.side > 0 ? f.sMax : f.sMin;
      out.push({
        side: f.side, file, ppm, width: W, height: H, sAtLeft, sAtRight, zTop, zBottom,
        ground: settled.ground, offsetM: settled.offsetM,
        tops: tops.sort((a, b) => a.s - b.s), roofs: roofs.sort((a, b) => a.s - b.s),
        draped, photoShare: surface ? photo / surface : 0,
      });
    }
    return out;
  } finally {
    await browser.close();
  }
}
