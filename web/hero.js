/* The animated windows: the welcome's two, and How it works' one. Each
   blinks, gif-like, through the app's sheets with the illustrations cut in
   among them. A window is any <img data-hero>; a page whose window carries
   data-hero-autostart starts on its own, and the welcome starts and stops
   its windows from app.js as the visitor comes and goes. The
   sheets are hero-*.jpg, drawn for addresses around NSW just for this panel
   (`npm run generate`, rasterised like the samples), so the welcome never
   shows the example the generator's result frame uses; the illustrations are
   art-*, the studio's graphics.

   The sheets are shuffled on every visit and dealt between the windows,
   so each turns through its own and never shows the same one as another;
   a window reshuffles its share when it has been through it. After every
   three to five sheets, four on average, a window cuts to an illustration
   picked at random from all of them, so either window may show any one, never
   the same one twice running, and never while another window shows one:
   then it shows a sheet and takes its illustration at the next cut. A sheet
   holds for SHEET_MS, an illustration only a flash, ART_MS. Each frame is fetched before it is shown and swapped in one cut; each
   window after the first runs half a beat behind the one before. Held still when motion is
   asked not to.

   The windows have no frame, so a sheet's own white paper margin would leave
   the drawing short of the panel's edges and below the words beside it. Each
   sheet is enlarged and shifted by its own margin, measured once on a small
   canvas, so the drawing starts on the panel's left and top edges; the
   illustrations keep their white, which is part of them. A context or site
   sheet shows its map alone: whole, fitted into the window at its top left,
   the legend column beside it left out.

   Each window holds two pictures, one shown and one hidden. The next frame
   loads, decodes and is fitted in the hidden one, and the two change places
   in one go, so no picture is ever on screen with another's crop: a browser
   that keeps the old picture up while it decodes the new one (Safari) would
   otherwise show it cut to the next one's shape for a moment. */
// The samples' cache-busting query, as app.js names them.
const sample = (name) => '/samples/' + name + '?r=2';
const HERO_COUNT = 25;   // web/samples/hero-1.jpg … hero-<n>.jpg
const HERO_SHEETS = Array.from({ length: HERO_COUNT }, (_, i) => sample('hero-' + (i + 1) + '.jpg'));
// web/samples/art-1 … art-8, each in whichever of PNG or JPEG kept it lighter.
const HERO_ART = ['art-1.png', 'art-2.jpg', 'art-3.jpg', 'art-4.jpg',
                  'art-5.jpg', 'art-6.png', 'art-7.png', 'art-8.png'].map(sample);
const SHEET_MS = 2000, ART_MS = 500;

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
/** Sheets before the next illustration: three, four or five, four on average. */
const sheetsBeforeArt = () => 3 + Math.floor(Math.random() * 3);

const heroPool = shuffled(HERO_SHEETS);
const heroEls = [...document.querySelectorAll('img[data-hero]')];
const HERO_PANELS = heroEls.map((el, side) => {
  const sheets = heroPool.filter((_, i) => i % heroEls.length === side);
  // The window's second picture, hidden behind the first until it holds the
  // next frame, ready.
  const back = el.cloneNode(false);
  back.removeAttribute('id');
  back.removeAttribute('data-hero');
  back.removeAttribute('data-hero-autostart');
  back.alt = '';
  back.setAttribute('aria-hidden', 'true');
  back.hidden = true;
  el.after(back);
  // artBusy: an illustration is this window's, from the moment it is chosen
  // until the frame after it is on screen, so the other window waits it out.
  return { front: el, back, sheets, deck: sheets.slice(),
           sinceArt: 0, artAfter: sheetsBeforeArt(), lastArt: null, lastSheet: null,
           artBusy: false };
});
let heroOn = false;

// A picture's white margins, as fractions of its width and height, by URL.
const margins = new Map();
const INK = 240 * 3;      // darker than near-white, summed over r, g and b
const NONE = { l: 0, t: 0, r: 0, map: null };

/** The white margin round a sheet: rows and columns in which less than one
    pixel in two hundred is drawn on count as paper. And, on a context or site
    sheet, where its map ends: such a sheet keeps its legend in a column of its
    own, past a gutter with nothing in it down the middle of the sheet (the
    legend's heading and the scale bar reach into it at the top and foot). The
    deck's pages have no such gutter. */
function marginsOf(img) {
  if (margins.has(img.src)) return margins.get(img.src);
  let m = NONE;
  try {
    const w = 600, h = Math.round(w * img.naturalHeight / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(w * h);
    const cols = new Uint32Array(w), rows = new Uint32Array(h), mid = new Uint32Array(w);
    const y0 = Math.round(h * 0.1), y1 = Math.round(h * 0.9);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < INK) {
        ink[y * w + x] = 1; cols[x]++; rows[y]++;
        if (y >= y0 && y < y1) mid[x]++;
      }
    }
    const first = (a, n) => { const i = a.findIndex((v) => v > n / 200); return i < 0 ? 0 : i; };
    const l = first(cols, h), t = first(rows, w), r = first([...cols].reverse(), h);
    // A margin over a tenth is no paper edge; leave such a picture as it is.
    if (l < w / 10 && r < w / 10 && t < h / 10) {
      m = { l: l / w, t: t / h, r: r / w, map: null };
      // The gutter: the first run of three empty columns or more in the right
      // third. A map whose right edge is blank paper runs on into it, so a run
      // wider than the gutter's own width (8 of 1193) is taken to be the map
      // up to its last eight.
      let start = -1;
      for (let x = Math.round(w * 0.7); x < w * 0.97 - 3; x++) {
        if (!mid[x] && !mid[x + 1] && !mid[x + 2]) { start = x; break; }
      }
      if (start > 0) {
        let end = start;
        while (end + 1 < w && !mid[end + 1]) end++;
        const own = Math.max(3, Math.round(w * 8 / 1193));
        const gutter = end + 1 - start > 2 * own ? end + 1 - own : start;
        // The map's foot: its last row with ink in it, over the map's columns.
        let foot = t;
        for (let y = t; y < h; y++) {
          let n = 0;
          for (let x = l; x < gutter; x++) n += ink[y * w + x];
          if (n > (gutter - l) / 200) foot = y;
        }
        m.map = { r: gutter / w, b: (foot + 1) / h };
      }
    }
  } catch { /* unreadable: shown as it is */ }
  margins.set(img.src, m);
  return m;
}

/** Enlarge and shift a window's picture by the sheet's margins (none for an
    illustration). Widths and margins in % are of the panel's width, so the
    one panel width sizes all three; the panel crops what runs past its foot.
    A context or site sheet's map is fitted whole instead: as large as the
    window holds it, at the window's top left, in pixels of the window as it
    is now (so it is fitted again when the window changes size), with the
    legend beside it clipped away. */
function fit(el, img) {
  const m = /\/samples\/hero-/.test(img.src) ? marginsOf(img) : NONE;
  const ratio = img.naturalHeight / img.naturalWidth;
  if (m.map) {
    const box = el.parentElement.getBoundingClientRect();
    if (!box.width || !box.height) return;   // not on screen: fitted when it is
    const mw = m.map.r - m.l, mh = m.map.b - m.t;
    const width = Math.min(box.width / mw, box.height / (mh * ratio));
    el.style.width = width + 'px';
    el.style.marginLeft = (-m.l * width) + 'px';
    el.style.marginTop = (-m.t * width * ratio) + 'px';
    el.style.clipPath = `inset(${100 * m.t}% ${100 * (1 - m.map.r)}% ${100 * (1 - m.map.b)}% ${100 * m.l}%)`;
    return;
  }
  const k = 1 / (1 - m.l - m.r);
  el.style.width = (100 * k) + '%';
  el.style.marginLeft = (-100 * m.l * k) + '%';
  el.style.marginTop = (-100 * m.t * k * ratio) + '%';
  el.style.clipPath = '';
}
// The first frames fit once they are in; a window that changes size, or
// comes on screen, fits its pictures again.
HERO_PANELS.forEach((p) => p.front.addEventListener('load', () => fit(p.front, p.front)));
if (window.ResizeObserver) {
  const refit = new ResizeObserver((entries) => entries.forEach((e) => {
    e.target.querySelectorAll('img').forEach((el) => {
      if (el.complete && el.naturalWidth) fit(el, el);
    });
  }));
  heroEls.forEach((el) => refit.observe(el.parentElement));
}

/** The next frame for a window: its next sheet, or, when its turn has come, an illustration. */
function nextFrame(panel) {
  if (panel.sinceArt >= panel.artAfter && !HERO_PANELS.some((p) => p !== panel && p.artBusy)) {
    const art = pick(HERO_ART.filter((a) => a !== panel.lastArt));
    panel.lastArt = art;
    panel.sinceArt = 0;
    panel.artAfter = sheetsBeforeArt();
    panel.artBusy = true;
    return { src: art, ms: ART_MS, art: true };
  }
  if (!panel.deck.length) {
    // Through its share: deal it again in a new order, not opening on the
    // sheet it has just shown.
    do panel.deck = shuffled(panel.sheets);
    while (panel.sheets.length > 1 && panel.deck[0] === panel.lastSheet);
  }
  const sheet = panel.deck.shift();
  panel.lastSheet = sheet;
  panel.sinceArt += 1;
  return { src: sheet, ms: SHEET_MS };
}

function heroTurn(panel) {
  const next = panel.back;
  const frame = nextFrame(panel);
  // The next frame is loaded, decoded and fitted out of sight, then the two
  // pictures change places in one go: the cut never flashes white, and never
  // shows a picture in another's crop.
  const cut = () => {
    if (!heroOn) return;
    fit(next, next);
    next.hidden = false;
    panel.front.hidden = true;
    panel.back = panel.front;
    panel.front = next;
    // The illustration before this frame is off screen now.
    if (!frame.art) panel.artBusy = false;
    panel.timer = setTimeout(() => heroTurn(panel), frame.ms);
  };
  const ready = () => (next.decode ? next.decode() : Promise.resolve()).catch(() => {}).then(cut);
  next.onload = ready;
  next.onerror = () => {
    if (!heroOn) return;
    if (frame.art) panel.artBusy = false;
    panel.timer = setTimeout(() => heroTurn(panel), 0);   // a missing frame is skipped over
  };
  // The hidden picture may already hold this frame (it showed it two cuts
  // ago), and setting the same address again need not load it again.
  if (next.getAttribute('src') === frame.src && next.complete && next.naturalWidth) ready();
  else next.src = frame.src;
}

function startHero() {
  HERO_PANELS.forEach((p) => {
    if (!p.front.getAttribute('src')) p.front.src = nextFrame(p).src;
  });
  if (heroOn || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  heroOn = true;
  // Out of step by half a beat, so the windows blink in turn.
  HERO_PANELS.forEach((p, i) => {
    p.timer = setTimeout(() => heroTurn(p), SHEET_MS + i * (SHEET_MS / 2));
  });
}

function stopHero() {
  heroOn = false;
  HERO_PANELS.forEach((p) => clearTimeout(p.timer));
}

if (document.querySelector('img[data-hero][data-hero-autostart]')) startHero();
