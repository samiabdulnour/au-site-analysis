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
   asked not to. */
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
  // artBusy: an illustration is this window's, from the moment it is chosen
  // until the frame after it is on screen, so the other window waits it out.
  return { el, sheets, deck: sheets.slice(),
           sinceArt: 0, artAfter: sheetsBeforeArt(), lastArt: null, lastSheet: null,
           artBusy: false };
});
let heroOn = false;

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
  const el = panel.el;
  const frame = nextFrame(panel);
  // The next frame is fetched before it is shown, so the cut never flashes white.
  const pre = new Image();
  pre.onload = () => {
    if (!heroOn) return;
    el.src = frame.src;
    // The illustration before this frame is off screen now.
    if (!frame.art) panel.artBusy = false;
    panel.timer = setTimeout(() => heroTurn(panel), frame.ms);
  };
  pre.onerror = () => {
    if (!heroOn) return;
    if (frame.art) panel.artBusy = false;
    panel.timer = setTimeout(() => heroTurn(panel), 0);   // a missing frame is skipped over
  };
  pre.src = frame.src;
}

function startHero() {
  HERO_PANELS.forEach((p) => {
    if (!p.el.getAttribute('src')) p.el.src = nextFrame(p).src;
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
