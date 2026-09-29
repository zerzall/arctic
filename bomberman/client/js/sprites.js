// sprites.js - the procedural sprite factory of Blast Party (docs/SPEC.md section 8.2).
//
// Everything on the arena is vector art drawn with the 2D canvas API into a few cached atlas pages; the render
// loop only ever calls drawSprite() (a single drawImage). No image files, no DOM access at import time, so the
// module also loads in Node (pass `createCanvas` for tests) and works with OffscreenCanvas.
//
// ----------------------------------------------------------------------------------------------------------
// USAGE
//
//   const set = buildSpriteSet({ tile: 64, theme: 'lava', dpr: 2 });   // tile = device pixels per arena tile
//   drawSprite(ctx, set.floorAt(tx, ty), tx * tile, ty * tile);
//   drawSprite(ctx, set.character(colorIndex).walk[facing][frame], x * tile, y * tile);   // (x, y) = tile units
//   ...
//   set.dispose();                                                     // when the tile size or theme changes
//
// dispose() zeroes every canvas (iOS Safari's canvas memory budget), and drawImage() of an empty canvas throws, so stop
// drawing a set's sprites before you dispose it; disposing while a build is still being pumped is fine.
//
// Building takes ~110 ms at tile 64 and ~130 ms at tile 96 (headless Chromium, software raster, all eight colours), plus ~35 ms to crop
// the actor atlas to the visible pixels (see Atlas.queueCompaction).
// The build is shared: a set for another theme at the same tile size only redraws the terrain (10-20 ms), because
// characters, bombs, flames, items and effects are theme independent and kept in a reference-counted cache until
// the last set using them is disposed.
//
// Non-blocking build (spread over a few frames during the countdown):
//   const build = startSpriteBuild({ tile, theme });  ...each frame:  if (build.pump(4 /*ms*/)) use(build.set);
// `set.ready` tells whether every sprite has been drawn; sprites that are not drawn yet are transparent.
//
// ----------------------------------------------------------------------------------------------------------
// SPRITES AND ANCHORS
//
// A Sprite is { img, x, y, w, h, ax, ay }: a rectangle of an atlas canvas plus its anchor in sprite pixels.
// drawSprite(ctx, sprite, px, py, sx = 1, sy = sx) puts the anchor on (px, py) (device pixels, optional scale about
// the anchor for squash and stretch). Never scale by more than ~1.25: sprites are built for their tile size.
//
//   terrain (origin = the tile's top-left corner, so draw at tx * tile, ty * tile)
//     set.floorAt(tx, ty)          checkerboard floor with a deterministic decoration variant
//     set.hardWallAt(tx, ty)       pillar '#'      (taller than a tile: the top face reaches into the tile above)
//     set.softBlockAt(tx, ty)      crate '+'
//     set.borderAt(tx, ty)         arena border ring '#'
//     set.suddenWall               sudden-death wall 'X'
//     set.blockShadow              soft cast shadow to the right of / below a block; draw on the floor BEFORE the blocks
//     set.floor[parity][variant], set.hardWall[], set.softBlock[], set.border[]   the raw variant lists
//     set.debris[0..3], set.dust[0..1]   chunk and puff textures in theme colours (centre anchored), for particles
//     set.backdrop                 { canvas, size }: seamless 4 x 4 tile pattern for the area around the arena
//                                  (ctx.createPattern(set.backdrop.canvas, 'repeat')); canvas is null until set.ready
//     set.palette                  THEME_PALETTES[theme]
//     set.pages                    every canvas the sprites are drawn from (atlas pages + backdrop), for debug overlays and memory accounting
//     set.pixels                   pixels allocated by those canvases
//   things at a position (anchor = the entity's centre in tile units, i.e. draw at x * tile, y * tile)
//     set.character(colorIndex)    { idle[4], blink[4], walk[4][WALK_FRAMES], cheer[4], death[6], flash[4], ghost[2] }
//                                  arrays are indexed by facing (0 up, 1 right, 2 down, 3 left); the anchor is the
//                                  hitbox centre, the feet are about 0.33 tile below it, the head/accessory up to
//                                  ~0.95 tile above it. death[] is the dizzy pose spinning through a full turn;
//                                  flash[] are white silhouettes to overlay for the hurt flash; ghost[] floats up.
//     set.bomb(colorIndex, phase, hot)  colorIndex 0..7, or -1 for an orphaned bomb; phase 0..3 indexes BOMB_PULSE
//                                  (a pulse, cycle it faster as the fuse burns); hot = red glow (last half second).
//                                  Animation counters may run on: bomb phases and flame frames wrap, softPopAt clamps, and
//                                  a colour index outside 0..7 draws the orphan bomb, so the render loop never sees undefined
//     set.flame(mask, frame)       mask 0..15 (1 up, 2 right, 4 down, 8 left = neighbours the fire connects to; 0 is
//                                  a lone fireball), frame 0..FLAME_FRAMES-1. Tiles join seamlessly; draw all of them
//                                  from one frame counter (<= 8 Hz), add fx.glowWarm with 'lighter' for the glow
//     set.item(kind), set.itemGlow(kind)  item token and the additive glow behind it (kind from ITEM_KINDS)
//     set.shield[4], set.spawnShield[4]   bubble frames (shimmer sweep), centred on the fighter
//     set.curseAura[8]             orbiting skulls, centred on the fighter
//     set.teamRing[team]           feet ring: team 0 solid coral, team 1 dashed teal; centre it ~0.34 tile below the body
//     set.softPopAt(tx, ty, f)     the crate at that tile bursting apart, f in 0..SOFT_POP_FRAMES-1 (anchor = the tile's top-left, it
//                                  overflows the tile by ~0.35 tile all around): play ~3 frames of 50 ms where a block was destroyed
//     set.emote(index)             speech bubble whose tail tip is the anchor: put it at the head (index 0..7 = EMOTES
//                                  order: grin, laugh, angry, scream, thumbs-up, party, bomb, skull; 8..11 = GG, heart,
//                                  cry, cool for future use)
//     set.fx                       { shadow, dot, glowWarm, glowCool, flameGlow, spark, smoke[3], darkSmoke[3], ember, twinkle, skull, ring, star,
//                                  confetti[6], warning }
//                                  soft blob shadow (scale it per object), particle textures, sudden-death marker
//
// Animation hints: walk with walkFrame(distanceWalked) (about WALK_TILES_PER_CYCLE tiles per cycle) and show
// idle[facing] when not moving, swapping in blink[facing] for ~120 ms every 3-5 s; on death play death[] once or twice
// around (~6 ticks a frame) while the body shrinks, then float ghost[] up ~1.2 tiles fading out (deadT < 60);
// cheer[] loops while the winner jumps. Draw at integer device pixels for crisp edges.
//
// Suggested draw order (see scripts/dev/art/sheets.js for a complete mock): backdrop, floor, block shadows, flames,
// then everything else y-sorted by its bottom edge. Draw the border ring FIRST as scenery: its bottom row would
// otherwise cover the feet of the fighters spawning in the last row. Blocks are "taller than a tile" on purpose;
// a fighter standing directly above a block has its lower third hidden, exactly as in a real 2.5-D view.
//
// ----------------------------------------------------------------------------------------------------------
// DOM HELPERS (cached PNG data URLs, '' when there is no document)
//
//   avatarDataURL(colorIndex, size)   blastie head + accessory portrait for lobby / HUD chips
//   iconDataURL(name, size)           item and curse badges, crown, star, ghost, bot, heart, emote faces (ICON_NAMES);
//                                     size is in device pixels, so pass css size * devicePixelRatio
//
// EXPORTS: buildSpriteSet, startSpriteBuild, drawSprite, tileHash, iconDataURL, avatarDataURL, THEME_PALETTES,
//   COLOR_NAMES, ACCESSORIES, ICON_NAMES, EMOTE_ICONS, EXTRA_EMOTE_ICONS, walkFrame, WALK_FRAMES, WALK_TILES_PER_CYCLE,
//   FLAME_FRAMES, SOFT_POP_FRAMES, SHIELD_FRAMES, CURSE_AURA_FRAMES, BOMB_PULSE, BOMB_FUSE_TIP, BACKDROP_TILES.
//
// ----------------------------------------------------------------------------------------------------------
// NOTES FOR MAINTAINERS
//   * Design units: all drawing code works in units where one tile is 100 and is scaled by tile / 100.
//   * Light comes from the top left of the screen everywhere; mirrored (left-facing) layers are drawn with the
//     highlights flipped back (see LX). Shadows are one deep indigo, outlines are hue-shifted darks, not black.
//   * Speed: a gradient fill costs ~20 us, a stroke ~14 us, a drawImage from a small canvas ~5 us, and drawing an
//     atlas page onto itself ~1 ms. That is why animated characters are composed from cached layers (makeLayer /
//     stamp) and why nothing ever copies from a page it is writing to. Drawing sprites onto the arena is cheap only when it is
//     1:1 at integer positions (~7 us); the same draw scaled costs ~45 us and rotated ~100 us (software raster), so bake variants
//     instead of transforming at draw time.
//   * Memory: pages are shelf-packed, at most 2048 x 2048 each, released with width = height = 0 on dispose(). The actor atlas is
//     cropped to the visible pixels after it is drawn (sprites are drawn in generous cells so any pose fits): all eight colours at tile 96
//     are about 7.8 Mpx (31 MB) instead of 10.4, tile 64 about 3.5 Mpx. This matters: Chromium's GPU texture cache thrashes when the images
//     a frame draws from (atlas + screen canvas + anything baked) exceed roughly 40 MB, and every frame then pays 2 to 5 ms of uploads.
//     So sprites are cropped views of their cell: never assume w and h are the design cell, only that (ax, ay) is the anchor inside them.
//   * `dpr` is informational: sprites are built at `tile` device pixels; dpr only keys the shared cache.
//   * Emote icons follow the wire order of EMOTES in constants.js (emoji semantics), not the older brief.

import { PLAYER_COLORS, TEAM_COLORS, THEMES, ITEM_KINDS } from '../../shared/constants.js';
import { makeRng } from '../../shared/rng.js';

// ================================================================================================
// Vocabulary
// ================================================================================================

/** Player colour names by colour index (Red, Blue, ...). */
export const COLOR_NAMES = Object.freeze(PLAYER_COLORS.map((c) => c.name));
/** Head accessory ids by colour index: antenna, propeller, sprout, crown, horns, flame, bow, headphones. */
export const ACCESSORIES = Object.freeze(PLAYER_COLORS.map((c) => c.accessory));

/** Frames per walk cycle (one full cycle = two steps). */
export const WALK_FRAMES = 6;
/** Distance walked (in tiles) per cycle; a little more than the feet could cover, so it reads as brisk trotting rather than a blur. */
export const WALK_TILES_PER_CYCLE = 1.3;

/** Walk frame for the distance a fighter has travelled since a fixed origin (accumulate |dx| + |dy| per frame). */
export function walkFrame(distance) {
  if (!Number.isFinite(distance)) return 0;   // a NaN would index walk[facing][NaN] and crash the render loop
  const f = Math.floor((distance / WALK_TILES_PER_CYCLE) * WALK_FRAMES) % WALK_FRAMES;
  return f < 0 ? f + WALK_FRAMES : f;
}

const TAU = Math.PI * 2;
const UNIT = 100; // design units per tile: all drawing code works in these and is scaled by tile / 100

// ================================================================================================
// Colour toolkit
// ================================================================================================

const cssCache = new Map();

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** hsl(a) string with hue in degrees and s, l, a in 0..1. */
function hsl(h, s, l, a = 1) {
  const key = `${Math.round(h)}|${Math.round(s * 100)}|${Math.round(l * 100)}|${a}`;
  let v = cssCache.get(key);
  if (v === undefined) {
    v = a >= 1 ? `hsl(${Math.round(((h % 360) + 360) % 360)},${Math.round(clamp01(s) * 100)}%,${Math.round(clamp01(l) * 100)}%)`
      : `hsla(${Math.round(((h % 360) + 360) % 360)},${Math.round(clamp01(s) * 100)}%,${Math.round(clamp01(l) * 100)}%,${a})`;
    cssCache.set(key, v);
  }
  return v;
}

/** Move hue h towards target by fraction t along the short arc. */
function hueToward(h, target, t) {
  const d = ((target - h + 540) % 360) - 180;
  return h + d * t;
}

/** rgba() string from a hex colour. */
function rgba(hex, a) {
  const key = `${hex}|${a}`;
  let v = cssCache.get(key);
  if (v === undefined) {
    const [r, g, b] = hexToRgb(hex);
    v = `rgba(${r},${g},${b},${a})`;
    cssCache.set(key, v);
  }
  return v;
}

/** Linear mix of two hex colours, t = 0 gives a, t = 1 gives b. Returns a hex string. */
function mix(a, b, t) {
  const key = `m|${a}|${b}|${t}`;
  let v = cssCache.get(key);
  if (v === undefined) {
    const x = hexToRgb(a), y = hexToRgb(b);
    const c = x.map((p, i) => Math.round(p + (y[i] - p) * t));
    v = `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
    cssCache.set(key, v);
  }
  return v;
}

/**
 * A shading ramp for one base colour. Highlights drift towards warm yellow and shadows towards
 * violet (hue-shifted shading keeps colours rich instead of muddy grey).
 */
class Ramp {
  constructor(hex) {
    this.hex = hex;
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    this.h = h; this.s = s; this.l = l;
    this.hi = hsl(hueToward(h, 55, 0.14), s * 0.9, Math.min(0.9, l + 0.17));
    this.glint = hsl(hueToward(h, 55, 0.2), s * 0.7, Math.min(0.96, l + 0.3));
    this.base = hex;
    this.lo = hsl(hueToward(h, 275, 0.2), Math.min(1, s * 1.05), l * 0.68);
    this.deep = hsl(hueToward(h, 275, 0.3), Math.min(1, s * 0.8), Math.max(0.16, l * 0.36));
    this.line = hsl(hueToward(h, 280, 0.4), Math.min(0.75, s * 0.7), 0.2);
  }
  /** Same hue, lightness shifted by dl (-1..1), optional alpha. */
  tone(dl, a = 1) { return hsl(this.h, this.s, this.l + dl, a); }
}

const rampCache = new Map();
function ramp(hex) {
  let r = rampCache.get(hex);
  if (!r) { r = new Ramp(hex); rampCache.set(hex, r); }
  return r;
}

// ================================================================================================
// Theme palettes (exported: render.js / ui.js read backdrops, accents and ambient particle hints)
// ================================================================================================

// Filled in by the terrain section below.
export const THEME_PALETTES = {};

// ================================================================================================
// Canvas plumbing: atlas pages, deferred drawing, cached layers
// ================================================================================================

const PAGE_MAX = 2048; // spec 8.2: no atlas canvas larger than 2048 x 2048
const GAP = 2;         // transparent gutter between sprites so smoothed / scaled draws never bleed
const ALPHA_MIN = 4;   // alpha (0..255) below which a pixel counts as empty when cropping sprites
const SCAN_CHUNK = 24, COPY_CHUNK = 48;   // sprites per time slice while compacting

function defaultCreateCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('sprites.js needs a canvas implementation (document or OffscreenCanvas)');
}

function releaseCanvas(c) {
  // iOS Safari keeps a global budget for canvas memory; zeroing the size hands it back at once.
  c.width = 0; c.height = 0;
}

/**
 * Shelf-packed sprite atlas whose sprites are drawn later, in small time slices (pump).
 * `add()` only reserves a rectangle; the drawing callback runs when the build is pumped.
 *
 * Performance notes that shaped this file (measured in headless Chromium, software raster):
 * a gradient fill costs ~20 us, a stroke ~14 us, but a plain drawImage from a small canvas only ~5 us,
 * while drawing an atlas page onto itself costs ~1 ms (it snapshots the page). So animated sprites are
 * composed from a few cached vector *layers* (see makeLayer) instead of being re-rendered per frame.
 */
/** Shelf packing of rectangles into pages of at most PAGE_MAX x PAGE_MAX (rows fill left to right, a full page starts the next). */
class ShelfPacker {
  constructor() {
    this.pages = [];
    this.cur = null;
  }

  /** Reserve a w x h rectangle (plus the gutter); returns { page, x, y }. */
  place(w, h) {
    const bw = w + GAP, bh = h + GAP;
    let p = this.cur;
    if (p && p.x + bw > PAGE_MAX) { p.y += p.rowH; p.x = 0; p.rowH = 0; }
    if (!p || p.y + Math.max(p.rowH, bh) > PAGE_MAX) {
      p = this.cur = { w: 0, h: 0, x: 0, y: 0, rowH: 0, canvas: null, g: null, readable: false };
      this.pages.push(p);
    }
    const x = p.x, y = p.y;
    p.x += bw;
    p.rowH = Math.max(p.rowH, bh);
    p.w = Math.max(p.w, x + w);
    p.h = Math.max(p.h, y + h);
    return { page: p, x, y };
  }
}

class Atlas {
  constructor(env) {
    // Helper canvases (cached layers, scratch copies) are tracked so that disposing in the middle of a build, e.g. on a
    // resize during the countdown, still hands them back to iOS instead of leaving them to the garbage collector.
    this.scratch = new Set();
    this.createPage = env.createCanvas;
    this.env = { ...env, createCanvas: (w, h) => { const c = env.createCanvas(w, h); this.scratch.add(c); return c; } };
    this.packer = new ShelfPacker();
    this.tasks = [];
    this.cursor = 0;
    this.readable = false;   // the pages are read back while compacting, which wants CPU-backed canvases
    this.fresh = null;       // the compacted pages while a compaction is under way
  }

  get pages() { return this.packer.pages; }

  /**
   * Reserve a sprite. Sizes and the anchor are in design units (100 = one tile). `draw(g, env)` receives a
   * context whose origin is the anchor; with `raw` the scale is 1 device pixel (for drawImage compositions),
   * otherwise tile / 100 (for vector drawing in design units).
   */
  add(wu, hu, axu, ayu, draw, raw = false) {
    const { s } = this.env;
    const sprite = { img: null, x: 0, y: 0, w: Math.ceil(wu * s - 1e-6), h: Math.ceil(hu * s - 1e-6), ax: Math.round(axu * s), ay: Math.round(ayu * s) };
    const spot = this.packer.place(sprite.w, sprite.h);
    sprite.x = spot.x; sprite.y = spot.y;
    this.tasks.push({ sprite, page: spot.page, draw, raw });
    return sprite;
  }

  /** A task without a sprite: prepares or releases shared scratch state between sprite tasks. */
  job(fn) {
    this.tasks.push({ sprite: null, page: null, draw: fn, raw: true });
  }

  /** Allocate the page canvases (cheap until first drawn on) and point every sprite at its page. */
  seal() {
    for (const p of this.pages) { p.canvas = this.createPage(Math.max(1, p.w), Math.max(1, p.h)); p.readable = this.readable; }
    for (const t of this.tasks) if (t.sprite) t.sprite.img = t.page.canvas;
  }

  get done() { return this.cursor >= this.tasks.length; }

  context(page) {
    return (page.g ??= page.canvas.getContext('2d', { willReadFrequently: true }));
  }

  /** Draw queued sprites until the deadline (performance.now() ms) passes. Returns true when finished. */
  pump(deadline) {
    const { env } = this;
    while (this.cursor < this.tasks.length) {
      const t = this.tasks[this.cursor++];
      if (t.sprite) {
        const sp = t.sprite;
        const g = this.context(t.page);
        g.save();
        g.beginPath();
        g.rect(sp.x, sp.y, sp.w, sp.h);
        g.clip();
        g.translate(sp.x + sp.ax, sp.y + sp.ay);
        if (!t.raw) g.scale(env.s, env.s);
        t.draw(g, env);
        g.restore();
      } else {
        t.draw(null, env);
      }
      if (performance.now() >= deadline) break;
    }
    if (this.done) this.scratch.clear();   // the build's own jobs released every temporary by now
    return this.done;
  }

  /**
   * Shrink the atlas to what is visible; call after the last add() and before seal(), when the sprites are known.
   *
   * Sprites are laid out in generous cells (an animation frame must fit its widest pose), so about a third of every page is
   * transparent margin. In Chromium that memory is not free: once the images a frame draws from add up to roughly 40 MB together
   * with the canvases around them, the GPU texture cache thrashes and each frame pays to upload the biggest pages again (measured:
   * 0.5 ms of JavaScript per frame below the limit, 2 to 5 ms above it, 800 draw calls either way). iOS Safari has a hard budget too.
   *
   * The jobs queued here run after every sprite is drawn: measure each sprite's opaque bounds, repack only those rectangles into
   * fresh pages, and update the sprite objects in place (callers already hold them), then release the old pages.
   */
  queueCompaction() {
    this.readable = true;
    const entries = this.tasks.filter((t) => t.sprite);
    const boxes = new Array(entries.length);
    for (let i = 0; i < entries.length; i += SCAN_CHUNK) {
      this.job(() => { for (let j = i; j < Math.min(i + SCAN_CHUNK, entries.length); j++) boxes[j] = this.opaqueBounds(entries[j]); });
    }
    this.job(() => {
      const packer = new ShelfPacker();
      entries.forEach((t, j) => { t.spot = packer.place(boxes[j].w, boxes[j].h); });
      for (const p of packer.pages) p.canvas = this.env.createCanvas(Math.max(1, p.w), Math.max(1, p.h));
      this.fresh = packer.pages;
    });
    for (let i = 0; i < entries.length; i += COPY_CHUNK) {
      this.job(() => { for (let j = i; j < Math.min(i + COPY_CHUNK, entries.length); j++) this.moveSprite(entries[j], boxes[j]); });
    }
    this.job(() => {
      for (const p of this.pages) { if (p.canvas) releaseCanvas(p.canvas); p.canvas = null; p.g = null; }
      this.packer.pages = this.fresh;
      this.fresh = null;
      for (const t of entries) t.spot = null;
    });
  }

  /** The smallest rectangle of the sprite's cell (in cell pixels) that holds every non-empty pixel; the whole cell if it cannot be read. */
  opaqueBounds({ sprite: sp, page }) {
    const whole = { x: 0, y: 0, w: sp.w, h: sp.h };
    const image = this.context(page).getImageData?.(sp.x, sp.y, sp.w, sp.h);
    if (!image || !image.data) return whole;
    const alpha = image.data, stride = sp.w * 4;
    // Per row, walk in from both sides until the first visible pixel: rows cost their margins, not their width.
    let x0 = sp.w, x1 = -1, y0 = -1, y1 = -1;
    for (let y = 0, row = 3; y < sp.h; y++, row += stride) {
      let left = 0;
      while (left < sp.w && alpha[row + left * 4] < ALPHA_MIN) left++;
      if (left === sp.w) continue;
      let right = sp.w - 1;
      while (alpha[row + right * 4] < ALPHA_MIN) right--;
      if (y0 < 0) y0 = y;
      y1 = y;
      if (left < x0) x0 = left;
      if (right > x1) x1 = right;
    }
    return y0 < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Copy a sprite's visible rectangle to its new place and make the sprite object describe it. */
  moveSprite(t, box) {
    const sp = t.sprite, dst = t.spot.page, src = t.page;
    this.context(dst).drawImage(src.canvas, sp.x + box.x, sp.y + box.y, box.w, box.h, t.spot.x, t.spot.y, box.w, box.h);
    sp.img = dst.canvas; sp.x = t.spot.x; sp.y = t.spot.y;
    sp.ax -= box.x; sp.ay -= box.y; sp.w = box.w; sp.h = box.h;
  }

  dispose() {
    for (const p of [...this.pages, ...(this.fresh ?? [])]) { if (p.canvas) releaseCanvas(p.canvas); p.canvas = null; p.g = null; }
    for (const c of this.scratch) releaseCanvas(c);
    this.scratch.clear();
    this.packer = new ShelfPacker(); this.tasks = []; this.cursor = 0; this.fresh = null;
  }

  /** Total pixels currently allocated (for the debug overlay and the memory test). */
  get pixels() { return this.pages.reduce((n, p) => n + p.w * p.h, 0); }
}

// Sign of the light's x direction. The light always comes from the top left of the SCREEN, so while a
// mirrored (left-facing) layer is drawn the highlights must be flipped back.
let LX = 1;

/**
 * A small scratch canvas holding one vector part (body, accessory, foot, ...) that animated sprites are
 * composed from with cheap integer-offset drawImage calls. The box is symmetric in x so that a mirrored
 * layer has the same geometry; `oy` is the design-space y that maps to the layer's anchor row.
 */
function makeLayer(env, { hw, top, bottom, oy = 0 }, draw, mirror = false) {
  const { s } = env;
  const ax = Math.ceil(hw * s), ay = Math.ceil((oy - top) * s);
  const layer = { canvas: env.createCanvas(2 * ax, ay + Math.ceil((bottom - oy) * s)), ax, ay, oy };
  const g = layer.canvas.getContext('2d');
  g.translate(ax, ay);
  g.scale(s, s);
  g.translate(0, -oy);
  if (mirror) { g.scale(-1, 1); LX = -1; }
  try { draw(g); } finally { LX = 1; }
  return layer;
}

/** Composite a layer into a raw-mode sprite; (x, y) is the offset from the layer's natural position, in design units. */
function stamp(g, env, layer, x, y) {
  const { s } = env;
  g.drawImage(layer.canvas, Math.round(x * s) - layer.ax, Math.round((layer.oy + y) * s) - layer.ay);
}

function releaseLayers(obj) {
  for (const v of Object.values(obj)) {
    if (v && v.canvas) releaseCanvas(v.canvas);
    else if (v && typeof v === 'object') releaseLayers(v);
  }
}

// ================================================================================================
// Drawing kit
// ================================================================================================

/** Rounded-rectangle path (no reliance on ctx.roundRect, which older Safari lacks). */
function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Superellipse-ish blob: k = 0.5523 is an ellipse, larger is boxier. */
function squircle(g, cx, cy, hw, hh, k = 0.66) {
  const ox = hw * k, oy = hh * k;
  g.moveTo(cx, cy - hh);
  g.bezierCurveTo(cx + ox, cy - hh, cx + hw, cy - oy, cx + hw, cy);
  g.bezierCurveTo(cx + hw, cy + oy, cx + ox, cy + hh, cx, cy + hh);
  g.bezierCurveTo(cx - ox, cy + hh, cx - hw, cy + oy, cx - hw, cy);
  g.bezierCurveTo(cx - hw, cy - oy, cx - ox, cy - hh, cx, cy - hh);
  g.closePath();
}

function ellipse(g, cx, cy, rx, ry, rot = 0) {
  g.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot));
  g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
}

function circle(g, cx, cy, r) {
  g.moveTo(cx + r, cy);
  g.arc(cx, cy, r, 0, TAU);
}

/** Linear gradient with evenly listed [offset, colour] stops. */
function lin(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function rad(g, x0, y0, r0, x1, y1, r1, stops) {
  const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

/** Fill the current path, then stroke it with a round-joined outline. */
function fillLine(g, fill, line, lw) {
  g.fillStyle = fill; g.fill();
  if (line) { g.lineWidth = lw; g.strokeStyle = line; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
}

const SHADOW_INK = '#1a0f3a'; // every drop shadow uses one deep indigo so the scene stays cohesive

// ================================================================================================
// Blasties (characters)
// ================================================================================================
//
// A blastie is drawn once per colour as a handful of vector layers (bodies in a few squash states and
// expressions, accessories, feet, hands); every animation frame is then a cheap composition of those layers
// at integer offsets. Character space: design units around the hitbox centre, the feet sit 33 units below it.

const CH_W = 122, CH_H = 149, CH_AY = 98;     // character cell (design units) and the anchor row (hitbox centre); measured to fit every frame
const FEET_Y = 33;                            // baseline the body squashes on
const HEAD_TOP = -38;
const BODY = { cx: 0, cy: -4, hw: 40, hh: 35 };
const LINE_W = 4.6;
const EYE_INK = '#251650';
const ACC_PHASES = 3;                         // animated accessories (propeller, flame, sprout, antenna) have 3 states

/** Body states: squash/stretch about the feet plus the face. */
const BODY_STATES = {
  n: {},
  sq: { sx: 1.07, sy: 0.93 },
  st: { sx: 0.96, sy: 1.05 },
  blink: { eyes: 'blink' },
  happy: { eyes: 'happy', mouth: 'grin' },
  happySt: { sx: 0.96, sy: 1.05, eyes: 'happy', mouth: 'grin' },
  dead: { eyes: 'x', mouth: 'wavy' },
};
// Which states each view needs (the up view has no face, so no expressions).
const BODY_KEYS = { down: ['n', 'sq', 'st', 'blink', 'happy', 'happySt', 'dead'], side: ['n', 'sq', 'st', 'blink'], up: ['n', 'sq', 'st'] };
const SIDE_LEAN = { n: 0, sq: 0.07, st: 0.03 };

/** Per-colour look: body ramp, feet tone, cream face plate. */
function makeLook(hex) {
  return { r: ramp(hex), foot: ramp(mix(hex, '#3a2a70', 0.38)), plate: '#fff6e6', plateLo: '#ffd9c4' };
}

/** hsl() strings cannot take an alpha suffix, so gradients that fade a ramp colour use this. */
function rgbaOf(color, a) {
  if (color.startsWith('hsl(')) return color.replace('hsl(', 'hsla(').replace(')', `,${a})`);
  return rgba(color, a);
}

function drawFoot(g, L, sx = 1) {
  const f = L.foot;
  g.beginPath(); ellipse(g, 0, 0, 14 * sx, 9);
  fillLine(g, lin(g, 0, -9, 0, 9, [[0, f.hi], [0.55, f.base], [1, f.lo]]), L.r.line, LINE_W * 0.9);
  g.beginPath(); ellipse(g, -4 * sx, -3.4, 5.5 * sx, 2.4, -0.2);
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
}

function drawHand(g, L, r = 9) {
  const b = L.r;
  g.beginPath(); circle(g, 0, 0, r);
  fillLine(g, rad(g, -r * 0.35, -r * 0.4, 1, 0, 0, r * 1.2, [[0, b.glint], [0.5, b.hi], [1, b.base]]), b.line, LINE_W * 0.85);
  g.beginPath(); ellipse(g, -r * 0.33, -r * 0.4, r * 0.34, r * 0.22, -0.6);
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
}

function drawBodyBlob(g, L) {
  const b = L.r, { cx, cy, hw, hh } = BODY;
  g.beginPath(); squircle(g, cx, cy, hw, hh);
  g.fillStyle = rad(g, -16 * LX, -26, 2, -6 * LX, -6, 74, [[0, b.hi], [0.38, b.base], [1, b.lo]]);
  g.fill();
  g.save();
  g.clip();
  // bounce light from the ground at the lower right, ambient occlusion at the very bottom
  g.fillStyle = rad(g, 30 * LX, 30, 4, 30 * LX, 30, 46, [[0, rgbaOf(b.glint, 0.55)], [1, rgbaOf(b.glint, 0)]]);
  g.fillRect(-60, -60, 120, 120);
  g.fillStyle = lin(g, 0, cy + hh - 12, 0, cy + hh, [[0, 'rgba(40,10,80,0)'], [1, 'rgba(40,10,80,0.28)']]);
  g.fillRect(-60, cy + hh - 12, 120, 14);
  // glossy highlight
  g.beginPath(); ellipse(g, -19 * LX, -26, 15, 7.5, -0.55 * LX);
  g.fillStyle = rad(g, -21 * LX, -28, 1, -19 * LX, -26, 16, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
  g.fill();
  g.beginPath(); circle(g, -30 * LX, -12, 2.4);
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill();
  g.restore();
  g.beginPath(); squircle(g, cx, cy, hw, hh);
  g.lineWidth = LINE_W; g.strokeStyle = b.line; g.lineJoin = 'round'; g.stroke();
}

function eyeOpen(g, L, x, y, rx, ry) {
  g.beginPath(); ellipse(g, x, y, rx, ry);
  g.fillStyle = lin(g, 0, y - ry, 0, y + ry, [[0, '#1a0f3d'], [0.6, EYE_INK], [1, L.r.tone(-0.1)]]);
  g.fill();
  g.beginPath(); circle(g, x - rx * 0.28 * LX, y - ry * 0.34, rx * 0.5);
  g.fillStyle = '#fff'; g.fill();
  g.beginPath(); circle(g, x + rx * 0.36 * LX, y + ry * 0.42, rx * 0.24);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
}

function eyeArc(g, x, y, w, up) {
  g.beginPath();
  g.moveTo(x - w, y + (up ? 3 : -2));
  g.quadraticCurveTo(x, y + (up ? -6 : 5), x + w, y + (up ? 3 : -2));
  g.lineWidth = 3.4; g.strokeStyle = EYE_INK; g.lineCap = 'round'; g.stroke();
}

function eyeCross(g, x, y, r) {
  g.beginPath();
  g.moveTo(x - r, y - r); g.lineTo(x + r, y + r);
  g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
  g.lineWidth = 3.6; g.strokeStyle = EYE_INK; g.lineCap = 'round'; g.stroke();
}

function drawEye(g, L, kind, x, y, rx, ry) {
  if (kind === 'open') eyeOpen(g, L, x, y, rx, ry);
  else if (kind === 'blink') eyeArc(g, x, y + 2, rx * 0.9, false);
  else if (kind === 'happy') eyeArc(g, x, y + 1, rx * 0.95, true);
  else if (kind === 'x') eyeCross(g, x, y, rx * 0.7);
}

function drawMouth(g, kind, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  if (kind === 'smile') {
    g.beginPath(); g.moveTo(-5, 0); g.quadraticCurveTo(0, 6, 5, 0);
    g.lineWidth = 2.8; g.strokeStyle = '#6b2340'; g.lineCap = 'round'; g.stroke();
  } else if (kind === 'grin') {
    g.beginPath(); g.moveTo(-8, -1); g.quadraticCurveTo(0, 1.5, 8, -1); g.quadraticCurveTo(6, 11, 0, 11); g.quadraticCurveTo(-6, 11, -8, -1);
    fillLine(g, '#6b2340', '#6b2340', 1.6);
    g.save(); g.clip();
    g.beginPath(); ellipse(g, 0, 11, 6, 4); g.fillStyle = '#ff7a8f'; g.fill();
    g.restore();
  } else if (kind === 'wavy') {
    g.beginPath(); g.moveTo(-6, 2); g.quadraticCurveTo(-3, -2, 0, 2); g.quadraticCurveTo(3, 6, 6, 2);
    g.lineWidth = 2.6; g.strokeStyle = '#6b2340'; g.lineCap = 'round'; g.stroke();
  }
  g.restore();
}

function drawBlush(g, x, y, rx = 6.5, ry = 4) {
  g.beginPath(); ellipse(g, x, y, rx, ry);
  g.fillStyle = rad(g, x, y, 0, x, y, rx, [[0, 'rgba(255,92,128,0.62)'], [0.7, 'rgba(255,92,128,0.4)'], [1, 'rgba(255,92,128,0)']]);
  g.fill();
}

function drawPlate(g, L, cx, cy, hw, hh) {
  g.beginPath(); squircle(g, cx, cy, hw, hh, 0.62);
  g.fillStyle = lin(g, 0, cy - hh, 0, cy + hh, [[0, L.plateLo], [0.3, L.plate], [1, '#fffaf2']]);
  g.fill();
  g.lineWidth = 2.4; g.strokeStyle = L.r.deep; g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1;
}

function drawFace(g, L, dir, st) {
  const eyes = st.eyes ?? 'open', mouth = st.mouth ?? 'smile';
  if (dir === 'down') {
    drawPlate(g, L, 0, -2, 31, 24.5);
    drawBlush(g, -23, 6); drawBlush(g, 23, 6);
    drawEye(g, L, eyes, -12.5, -7.5, 7, 10.2);
    drawEye(g, L, eyes, 12.5, -7.5, 7, 10.2);
    drawMouth(g, mouth, 0, 8);
  } else {
    g.save();
    g.beginPath(); squircle(g, BODY.cx, BODY.cy, BODY.hw - 1.5, BODY.hh - 1.5); g.clip();
    drawPlate(g, L, 15, -2, 27, 24.5);
    g.restore();
    drawBlush(g, 30, 6, 6, 3.8);
    drawEye(g, L, eyes, 8, -7.5, 5.6, 9.4);
    drawEye(g, L, eyes, 25, -7.5, 7, 10.2);
    drawMouth(g, mouth, 18, 8, 0.92);
  }
}

/** The back of the hood: a collar seam and a nape highlight, so the up view is not just a blank ball. */
function drawBack(g, L) {
  const b = L.r;
  g.beginPath(); g.moveTo(-33, 8); g.quadraticCurveTo(0, 30, 33, 8);
  g.lineWidth = 3.2; g.strokeStyle = b.lo; g.globalAlpha = 0.7; g.lineCap = 'round'; g.stroke(); g.globalAlpha = 1;
  g.beginPath(); ellipse(g, 0, -14, 15, 9);
  g.fillStyle = rad(g, 0, -14, 0, 0, -14, 15, [[0, rgbaOf(b.glint, 0.5)], [1, rgbaOf(b.glint, 0)]]); g.fill();
}

/** Body layer: blob + face (or back) in a squash state. dir: 'down' | 'side' (faces right) | 'up'. */
function drawBody(g, L, dir, key) {
  const st = BODY_STATES[key];
  g.translate(0, FEET_Y);
  g.rotate(dir === 'side' ? (SIDE_LEAN[key] ?? 0) : 0);
  g.scale(st.sx ?? 1, st.sy ?? 1);
  g.translate(0, -FEET_Y);
  drawBodyBlob(g, L);
  if (dir === 'up') drawBack(g, L); else drawFace(g, L, dir, st);
}

// ---- Accessories -------------------------------------------------------------------------------------

function accAntenna(g, L, p) {
  const sway = p.sway * 40, x = p.dir === 'side' ? -4 : 0;
  g.beginPath(); g.moveTo(x, HEAD_TOP + 3); g.quadraticCurveTo(x + sway * 0.3, HEAD_TOP - 12, x + sway, HEAD_TOP - 22);
  g.lineWidth = 3.8; g.strokeStyle = L.r.line; g.lineCap = 'round'; g.stroke();
  const bx = x + sway, by = HEAD_TOP - 27;
  g.beginPath(); circle(g, bx, by, 9.5);
  fillLine(g, rad(g, bx - 3 * LX, by - 3.5, 1, bx, by, 11, [[0, '#ffffff'], [0.35, L.r.glint], [1, L.r.base]]), L.r.line, LINE_W * 0.9);
  g.beginPath(); ellipse(g, bx - 3.4 * LX, by - 4, 3.2, 2, -0.7 * LX);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
}

function accPropeller(g, L, p) {
  const x = p.dir === 'side' ? -3 : 0, y = HEAD_TOP - 1;
  const a = p.spin * TAU;
  // blur disc, then two blades whose apparent length follows the rotation
  g.beginPath(); ellipse(g, x, y - 8, 32, 6);
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
  const drawBlade = (dirSign, col) => {
    const len = 30 * Math.cos(a) * dirSign;
    g.beginPath();
    g.moveTo(x, y - 8);
    g.quadraticCurveTo(x + len * 0.5, y - 8 - 8, x + len, y - 8 - 1.5);
    g.quadraticCurveTo(x + len * 0.5, y - 8 + 4, x, y - 8);
    fillLine(g, col, L.r.line, 2.8);
  };
  g.beginPath(); rrect(g, x - 5.5, y - 8, 11, 9, 3.5);
  fillLine(g, lin(g, 0, y - 8, 0, y + 1, [[0, '#ffe27a'], [1, '#e8a01c']]), L.r.line, LINE_W * 0.8);
  drawBlade(-1, '#ffd23f'); drawBlade(1, '#ff5d5d');
  g.beginPath(); circle(g, x, y - 8, 3.4);
  fillLine(g, '#f2f2fa', L.r.line, 2.4);
}

function accSprout(g, L, p) {
  const x = p.dir === 'side' ? -4 : 0, sw = p.sway * 30;
  const stemTopX = x + sw * 0.6, stemTopY = HEAD_TOP - 17;
  g.beginPath(); g.moveTo(x, HEAD_TOP + 3); g.quadraticCurveTo(x - 3, HEAD_TOP - 8, stemTopX, stemTopY);
  g.lineWidth = 4.4; g.strokeStyle = L.r.line; g.lineCap = 'round'; g.stroke();
  g.lineWidth = 2; g.strokeStyle = '#7ed957'; g.stroke();
  const leaf = (ang, len, wid) => {
    g.save(); g.translate(stemTopX, stemTopY); g.rotate(ang);
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(len * 0.25, -wid, len * 0.75, -wid, len, 0); g.bezierCurveTo(len * 0.75, wid, len * 0.25, wid, 0, 0);
    fillLine(g, lin(g, 0, -wid, 0, wid, [[0, '#c3f36a'], [0.5, '#5fd35a'], [1, '#2ea04c']]), '#1d5a3a', 3.4);
    g.beginPath(); g.moveTo(len * 0.12, 0); g.quadraticCurveTo(len * 0.5, -1.6, len * 0.86, 0);
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.6)'; g.stroke();
    g.restore();
  };
  leaf(-2.55 + p.sway * 0.4, 25, 8.8);
  leaf(-0.6 + p.sway * 0.4, 29, 10);
}

function accCrown(g, L, p) {
  const x = p.dir === 'side' ? -4 : 0, y = HEAD_TOP + 4;
  g.save(); g.translate(x, y); g.rotate(p.dir === 'side' ? -0.05 : -0.09);
  g.beginPath();
  g.moveTo(-24, 3);
  g.lineTo(-27, -20); g.lineTo(-13, -8); g.lineTo(0, -26); g.lineTo(13, -8); g.lineTo(27, -20);
  g.lineTo(24, 3);
  g.quadraticCurveTo(0, 8, -24, 3);
  g.closePath();
  fillLine(g, lin(g, 0, -26, 0, 6, [[0, '#fff2a6'], [0.4, '#ffc628'], [1, '#e08a00']]), '#6b3a10', LINE_W);
  g.beginPath(); rrect(g, -24, -3, 48, 8.5, 4);
  fillLine(g, lin(g, 0, -3, 0, 6, [[0, '#ffd85a'], [1, '#d98200']]), '#6b3a10', 3);
  const gem = (gx, gy, r, col) => {
    g.beginPath(); circle(g, gx, gy, r);
    fillLine(g, rad(g, gx - 1, gy - 1.5, 0.5, gx, gy, r * 1.2, [[0, '#fff'], [0.4, col], [1, mix(col, '#2a0a50', 0.5)]]), '#6b3a10', 2);
  };
  gem(0, -14, 4.6, '#ff3d6b'); gem(-20, -11, 3, '#3db8ff'); gem(20, -11, 3, '#3dff9a'); gem(-11, 2, 2.6, '#ff3d6b'); gem(11, 2, 2.6, '#ff3d6b');
  g.beginPath(); g.moveTo(-8 * LX, -5); g.lineTo(-1 * LX, -20);
  g.lineWidth = 2.2; g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineCap = 'round'; g.stroke();
  g.restore();
}

function accHorns(g, L, p) {
  const drawHorn = (sx, ox) => {
    g.save(); g.translate(ox, HEAD_TOP + 8); g.scale(sx, 1);
    g.beginPath();
    g.moveTo(-8, 2); g.bezierCurveTo(-11, -10, -6, -22, 6, -29); g.bezierCurveTo(4, -17, 6, -8, 9, 2); g.closePath();
    fillLine(g, lin(g, -10, 0, 10, -20, [[0, '#ffe9c4'], [0.6, '#f6c98f'], [1, '#d78d54']]), '#5a2450', LINE_W * 0.9);
    g.beginPath(); g.moveTo(-3, -6); g.quadraticCurveTo(-3, -15, 2, -22);
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineCap = 'round'; g.stroke();
    g.restore();
  };
  if (p.dir === 'side') { drawHorn(-1, -12); drawHorn(1, 4); } else { drawHorn(-1, -24); drawHorn(1, 24); }
}

function accFlame(g, L, p) {
  const x = p.dir === 'side' ? -4 : 0, y = HEAD_TOP + 5, fl = p.flick;
  const tongue = (h, w, dx) => {
    g.beginPath();
    g.moveTo(x - w, y);
    g.bezierCurveTo(x - w * 1.1, y - h * 0.5, x - w * 0.2 + dx, y - h * 0.6, x + dx * 1.3, y - h);
    g.bezierCurveTo(x + w * 0.3 + dx, y - h * 0.55, x + w * 1.1, y - h * 0.45, x + w, y);
    g.closePath();
  };
  tongue(36, 17, fl * 4);
  fillLine(g, lin(g, 0, y - 36, 0, y, [[0, '#ff7a1a'], [1, '#e8281e']]), '#7a1a2a', LINE_W * 0.9);
  tongue(26, 11.5, -fl * 3);
  fillLine(g, lin(g, 0, y - 26, 0, y, [[0, '#ffe45c'], [1, '#ff9a1a']]), null, 0);
  tongue(14, 6, fl * 2);
  fillLine(g, '#fffbe0', null, 0);
}

function accBow(g, L, p) {
  const side = p.dir === 'side';
  const bx = side ? -12 : 20, by = HEAD_TOP + 6;
  g.save(); g.translate(bx, by); g.rotate(side ? -0.2 : 0.3);
  const wing = (s) => {
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(s * 10, -16, s * 26, -15, s * 26, -2); g.bezierCurveTo(s * 26, 12, s * 10, 12, 0, 0); g.closePath();
    fillLine(g, lin(g, 0, -14, 0, 12, [[0, '#ff6f9a'], [1, '#d81f5e']]), '#6a1240', LINE_W * 0.85);
  };
  wing(-1); wing(1);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (const [dx, dy] of [[-15, -6], [15, -6], [-10, 3], [10, 3]]) { g.beginPath(); circle(g, dx, dy, 1.9); g.fill(); }
  g.beginPath(); circle(g, 0, 0, 6.2);
  fillLine(g, rad(g, -1.5, -2, 0.5, 0, 0, 7, [[0, '#ff9bb8'], [1, '#c81655']]), '#6a1240', LINE_W * 0.8);
  g.restore();
}

function accHeadphones(g, L, p) {
  const band = (x0, x1, top) => {
    g.beginPath(); g.moveTo(x0, -6); g.bezierCurveTo(x0, top, x1, top, x1, -6);
    g.lineWidth = 9; g.strokeStyle = '#24244d'; g.lineCap = 'round'; g.stroke();
    g.lineWidth = 5; g.strokeStyle = '#4a5aa6'; g.stroke();
    g.lineWidth = 1.8; g.strokeStyle = 'rgba(255,255,255,0.5)'; g.translate(-1, -1.5); g.stroke(); g.translate(1, 1.5);
  };
  const cup = (cx, cy, w, h) => {
    g.beginPath(); rrect(g, cx - w / 2, cy - h / 2, w, h, w * 0.42);
    fillLine(g, lin(g, cx - w / 2, 0, cx + w / 2, 0, [[0, '#5a6ad0'], [0.5, '#2f3b8a'], [1, '#1f2560']]), '#151538', LINE_W * 0.85);
    g.beginPath(); rrect(g, cx - w * 0.28, cy - h * 0.28, w * 0.56, h * 0.56, w * 0.24);
    g.fillStyle = L.r.hi; g.fill();
    g.beginPath(); ellipse(g, cx - w * 0.15, cy - h * 0.28, w * 0.13, h * 0.09, -0.4);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.fill();
  };
  if (p.dir === 'side') {
    band(-21, 22, -62);
    cup(-19, -4, 17, 28);
  } else {
    band(-41, 41, -68);
    cup(-42, -4, 15, 28); cup(42, -4, 15, 28);
  }
}

const ACCESSORY_DRAW = { antenna: accAntenna, propeller: accPropeller, sprout: accSprout, crown: accCrown, horns: accHorns, flame: accFlame, bow: accBow, headphones: accHeadphones };
const ANIMATED_ACCESSORIES = new Set(['antenna', 'propeller', 'sprout', 'flame']);

// ---- Layer sets ----------------------------------------------------------------------------------------

const BODY_BOX = { hw: 52, top: -52, bottom: 38, oy: FEET_Y };
const ACC_BOX = { hw: 54, top: -98, bottom: 16, oy: HEAD_TOP };
const FOOT_BOX = { hw: 18, top: -12, bottom: 12 };
const HAND_BOX = { hw: 12, top: -12, bottom: 12 };

/** Every cached layer one colour needs. `side` and the side accessories exist twice: [0] right-facing, [1] left-facing. */
function buildRig(env, index) {
  const L = makeLook(PLAYER_COLORS[index].hex), acc = PLAYER_COLORS[index].accessory;
  const rig = { body: { down: {}, side: [{}, {}], up: {} }, acc: { down: [], side: [[], []], up: [] }, foot: null, footS: null, hand: null };
  for (const key of BODY_KEYS.down) rig.body.down[key] = makeLayer(env, BODY_BOX, (g) => drawBody(g, L, 'down', key));
  for (const key of BODY_KEYS.up) rig.body.up[key] = makeLayer(env, BODY_BOX, (g) => drawBody(g, L, 'up', key));
  for (const m of [0, 1]) for (const key of BODY_KEYS.side) rig.body.side[m][key] = makeLayer(env, BODY_BOX, (g) => drawBody(g, L, 'side', key), m === 1);
  const phases = ANIMATED_ACCESSORIES.has(acc) ? ACC_PHASES : 1;
  const drawAcc = ACCESSORY_DRAW[acc];
  for (let k = 0; k < phases; k++) {
    const p = { sway: (k - 1) * 0.11, spin: (k + 0.35) / phases, flick: k - 1 };
    rig.acc.down.push(makeLayer(env, ACC_BOX, (g) => drawAcc(g, L, { ...p, dir: 'down' })));
    rig.acc.up.push(makeLayer(env, ACC_BOX, (g) => drawAcc(g, L, { ...p, dir: 'up' })));
    for (const m of [0, 1]) rig.acc.side[m].push(makeLayer(env, ACC_BOX, (g) => drawAcc(g, L, { ...p, dir: 'side' }), m === 1));
  }
  rig.foot = makeLayer(env, FOOT_BOX, (g) => drawFoot(g, L));
  rig.footS = makeLayer(env, FOOT_BOX, (g) => drawFoot(g, L, 0.9));
  rig.hand = makeLayer(env, HAND_BOX, (g) => drawHand(g, L));
  return rig;
}

/**
 * Compose one frame. pose: { dir, flip, body, acc (phase), bob (design units up), feet: [[x,y],[x,y]], hands: [[x,y],[x,y]] }.
 * For side views the pairs are [far, near]; flip mirrors a side view to face left (x offsets are given for the right-facing pose).
 */
function composeBlastie(g, env, rig, pose) {
  const { dir, flip } = pose, side = dir === 'side', sx = flip ? -1 : 1;
  const bodyLayer = side ? rig.body.side[flip ? 1 : 0][pose.body] : rig.body[dir][pose.body];
  const accList = side ? rig.acc.side[flip ? 1 : 0] : rig.acc[dir];
  const accLayer = accList[Math.min(pose.acc, accList.length - 1)];
  const st = BODY_STATES[pose.body];
  const accDy = -pose.bob + (1 - (st.sy ?? 1)) * (FEET_Y - HEAD_TOP);
  const foot = side ? rig.footS : rig.foot;
  const putFoot = (f) => stamp(g, env, foot, f[0] * sx, f[1]);
  const putHand = (h) => stamp(g, env, rig.hand, h[0] * sx, h[1] - pose.bob);
  if (side) { putFoot(pose.feet[0]); putHand(pose.hands[0]); } else { putFoot(pose.feet[0]); putFoot(pose.feet[1]); }
  stamp(g, env, bodyLayer, 0, -pose.bob);
  stamp(g, env, accLayer, 0, accDy);
  if (side) { putFoot(pose.feet[1]); putHand(pose.hands[1]); } else { putHand(pose.hands[0]); putHand(pose.hands[1]); }
}

// ---- Poses -----------------------------------------------------------------------------------------------

const REST_FEET = { front: [[-16, FEET_Y], [16, FEET_Y]], side: [[-6, FEET_Y], [6, FEET_Y]] };
const REST_HANDS = { front: [[-46, 5], [46, 5]], side: [[-32, 9], [-17, 16]] };

function restPose(dir, flip, body = 'n') {
  const kind = dir === 'side' ? 'side' : 'front';
  return { dir, flip, body, acc: 1, bob: 0, feet: REST_FEET[kind], hands: REST_HANDS[kind] };
}

/** Walk-cycle pose i of n. Samples are offset by half a frame so no frame is a degenerate "both feet together" one. */
function walkPose(dir, flip, i, n) {
  const ph = ((i + 0.5) / n) * TAU;
  const s = Math.sin(ph), c = Math.cos(ph);
  const accPhase = s > 0.33 ? 2 : s < -0.33 ? 0 : 1;
  if (dir === 'side') {
    const step = (sgn) => [sgn * 13 * Math.sin(ph) - 2, FEET_Y - 8 * Math.max(0, sgn * Math.cos(ph))];
    const high = Math.abs(c) > 0.7;
    return {
      dir, flip, body: high ? 'st' : 'sq', acc: i % ACC_PHASES, bob: Math.round(3.6 * Math.abs(c)),
      feet: [step(-1), step(1)],
      hands: [[-32 - 9 * s, 9 - 2.5 * Math.abs(s)], [-17 + 11 * s, 16 - 2.5 * Math.abs(s)]],
    };
  }
  const high = Math.abs(s) > 0.7;
  return {
    dir, flip, body: high ? 'st' : 'sq', acc: accPhase, bob: Math.round(3.4 * Math.abs(s)),
    feet: [[-16, FEET_Y - 8 * Math.max(0, s) + 1.5 * Math.max(0, -s)], [16, FEET_Y - 8 * Math.max(0, -s) + 1.5 * Math.max(0, s)]],
    hands: [[-46 + 2 * s, 6 + 6 * s], [46 + 2 * s, 6 - 6 * s]],
  };
}

const CHEER_POSES = [
  { dir: 'down', flip: false, body: 'happy', acc: 0, bob: 0, feet: [[-18, FEET_Y], [18, FEET_Y]], hands: [[-44, -2], [44, -2]] },
  { dir: 'down', flip: false, body: 'happySt', acc: 1, bob: 8, feet: [[-13, FEET_Y - 3], [13, FEET_Y - 3]], hands: [[-42, -30], [42, -30]] },
  { dir: 'down', flip: false, body: 'happySt', acc: 2, bob: 14, feet: [[-11, FEET_Y - 9], [11, FEET_Y - 9]], hands: [[-38, -42], [38, -42]] },
  { dir: 'down', flip: false, body: 'happy', acc: 1, bob: 5, feet: [[-15, FEET_Y - 2], [15, FEET_Y - 2]], hands: [[-44, -18], [44, -18]] },
];

const DEATH_POSE = { dir: 'down', flip: false, body: 'dead', acc: 1, bob: 0, feet: [[-15, FEET_Y - 4], [17, FEET_Y - 8]], hands: [[-46, -14], [46, -8]] };
const DEATH_SPIN_FRAMES = 6;
const DEATH_CELL = 134;

/**
 * Sprites for one colour, all in `atlas`. Facing indices follow the wire (0 up, 1 right, 2 down, 3 left).
 * The rig (scratch layers) is created by a job right before the first sprite that needs it and released after the last.
 */
function buildCharacter(atlas, index) {
  let rig = null;
  const out = { idle: [], blink: [], walk: [[], [], [], []], cheer: [], death: [], flash: [] };
  const cell = (pose) => atlas.add(CH_W, CH_H, CH_W / 2, CH_AY, (g, env) => composeBlastie(g, env, rig, pose), true);
  const dirOf = (f) => (f === 0 ? 'up' : f === 2 ? 'down' : 'side');
  atlas.job((_, env) => { rig = buildRig(env, index); });
  for (let f = 0; f < 4; f++) {
    out.idle.push(cell(restPose(dirOf(f), f === 3)));
    out.blink.push(f === 0 ? out.idle[0] : cell(restPose(dirOf(f), f === 3, 'blink')));
    for (let i = 0; i < WALK_FRAMES; i++) out.walk[f].push(cell(walkPose(dirOf(f), f === 3, i, WALK_FRAMES)));
    // hurt flash: the idle pose as a white silhouette
    const pose = restPose(dirOf(f), f === 3);
    out.flash.push(atlas.add(CH_W, CH_H, CH_W / 2, CH_AY, (g, env) => {
      composeBlastie(g, env, rig, pose);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = '#fff';
      g.fillRect(-CH_W, -CH_H, CH_W * 2, CH_H * 2);
    }, true));
  }
  for (const pose of CHEER_POSES) out.cheer.push(cell(pose));
  // death: the dizzy pose spun through a full turn (composed once, rotated per frame)
  let scratch = null;
  atlas.job((_, env) => {
    scratch = { w: Math.ceil(CH_W * env.s), h: Math.ceil(CH_H * env.s), ax: Math.round((CH_W / 2) * env.s), ay: Math.round(CH_AY * env.s) };
    scratch.canvas = env.createCanvas(scratch.w, scratch.h);
    const sg = scratch.canvas.getContext('2d');
    sg.translate(scratch.ax, scratch.ay);
    composeBlastie(sg, env, rig, DEATH_POSE);
  });
  for (let k = 0; k < DEATH_SPIN_FRAMES; k++) {
    out.death.push(atlas.add(DEATH_CELL, DEATH_CELL, DEATH_CELL / 2, DEATH_CELL / 2, (g) => {
      g.rotate((k / DEATH_SPIN_FRAMES) * TAU);
      g.scale(0.82, 0.82);
      g.drawImage(scratch.canvas, -scratch.ax, -scratch.ay);
    }, true));
  }
  atlas.job(() => { releaseLayers({ rig, scratch }); rig = null; scratch = null; });
  const look = makeLook(PLAYER_COLORS[index].hex);
  out.ghost = [0, 1].map((k) => atlas.add(80, 104, 40, 62, (g) => drawGhost(g, look, k * Math.PI)));
  return out;
}

// ================================================================================================
// Ghosts, shield bubbles, curse aura, team rings, shadows
// ================================================================================================

/** The soul that floats up from a defeated blastie: a translucent blob in the fighter's colour with a halo. */
function drawGhost(g, L, wave) {
  const b = L.r;
  const skirt = (x, phase) => 26 + Math.sin(phase + x * 0.09) * 3.5;
  g.beginPath();
  g.moveTo(-32, 20);
  g.bezierCurveTo(-36, -18, -20, -40, 0, -40);
  g.bezierCurveTo(20, -40, 36, -18, 32, 20);
  for (let x = 32; x >= -32; x -= 8) g.lineTo(x, skirt(x, wave) + (Math.floor((x + 32) / 8) % 2 ? 8 : 0));
  g.closePath();
  g.fillStyle = lin(g, 0, -40, 0, 34, [[0, 'rgba(255,255,255,0.95)'], [0.6, rgbaOf(b.glint, 0.88)], [1, rgbaOf(b.hi, 0.72)]]);
  g.fill();
  g.lineWidth = LINE_W * 0.85; g.strokeStyle = rgbaOf(b.line, 0.75); g.lineJoin = 'round'; g.stroke();
  g.beginPath(); ellipse(g, -13 * LX, -25, 9, 4.5, -0.5 * LX);
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
  for (const ex of [-11, 11]) { g.beginPath(); ellipse(g, ex, -8, 5.2, 7.4); g.fillStyle = EYE_INK; g.fill(); g.beginPath(); circle(g, ex - 1.6, -10.5, 1.9); g.fillStyle = '#fff'; g.fill(); }
  g.beginPath(); ellipse(g, 0, 8, 4, 5); g.fillStyle = '#6b2340'; g.fill();
  drawBlush(g, -21, 4, 5, 3); drawBlush(g, 21, 4, 5, 3);
  // halo
  g.beginPath(); ellipse(g, 0, -50, 17, 5);
  g.lineWidth = 4.6; g.strokeStyle = '#a5761c'; g.stroke();
  g.lineWidth = 2.6; g.strokeStyle = '#ffe36a'; g.stroke();
}

/** Bubble around a fighter. `tint` is the rim colour; `k` (0..1) sweeps the shimmer across it. */
function drawBubble(g, tint, k) {
  const R = 55;
  g.beginPath(); circle(g, 0, 0, R + 2.4); g.lineWidth = 3; g.strokeStyle = rgba(SHADOW_INK, 0.32); g.stroke();
  g.beginPath(); circle(g, 0, 0, R);
  g.fillStyle = rad(g, -14, -18, 4, 0, 0, R, [[0, rgba(tint, 0.10)], [0.6, rgba(tint, 0.16)], [0.88, rgba(tint, 0.42)], [1, rgba(tint, 0.72)]]);
  g.fill();
  g.lineWidth = 3.6; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
  g.save();
  g.beginPath(); circle(g, 0, 0, R - 1.5); g.clip();
  g.translate(-70 + k * 140, 0); g.rotate(0.5);
  g.fillStyle = lin(g, -14, 0, 14, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(-14, -90, 28, 180);
  g.restore();
  g.beginPath(); g.arc(0, 0, R - 8, Math.PI * 1.08, Math.PI * 1.42);
  g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineCap = 'round'; g.stroke();
  g.beginPath(); circle(g, -35, -32, 2.8); g.fillStyle = '#fff'; g.fill();
  g.beginPath(); g.arc(0, 0, R - 6, Math.PI * 0.12, Math.PI * 0.32);
  g.lineWidth = 3.4; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke();
}

/** Purple mist ring with skulls circling; `k` (0..1) is the orbit phase. */
function drawCurseAura(g, k) {
  const R = 52;
  g.beginPath(); ellipse(g, 0, 4, R, R * 0.8);
  g.fillStyle = rad(g, 0, 4, R * 0.3, 0, 4, R, [[0, 'rgba(150,60,220,0)'], [0.7, 'rgba(150,60,220,0.4)'], [1, 'rgba(150,60,220,0)']]);
  g.fill();
  for (let i = 0; i < 3; i++) {
    const a = (k + i / 3) * TAU;
    const x = Math.cos(a) * R * 0.92, y = 4 + Math.sin(a) * R * 0.5, front = Math.sin(a) > 0;
    g.save(); g.translate(x, y); g.scale(front ? 1 : 0.8, front ? 1 : 0.8); g.globalAlpha = front ? 1 : 0.7;
    g.beginPath(); circle(g, 0, 0, 17); g.fillStyle = 'rgba(120,40,190,0.6)'; g.fill();
    g.scale(0.46, 0.46);
    ICONS.skull(g, false);
    g.restore();
  }
}

function drawTeamRing(g, color, dashed) {
  g.beginPath(); ellipse(g, 0, 0, 48, 24);
  g.lineWidth = 11; g.strokeStyle = rgba(color, 0.3); g.stroke();
  if (dashed) g.setLineDash([16, 10]);
  g.beginPath(); ellipse(g, 0, 0, 46, 22);
  g.lineWidth = 8.4; g.strokeStyle = SHADOW_INK; g.globalAlpha = 0.7; g.stroke(); g.globalAlpha = 1;
  g.lineWidth = 5.6; g.strokeStyle = color; g.stroke();
  g.setLineDash([]);
}

function drawSoftShadow(g) {
  g.save(); g.scale(1, 0.5);
  g.beginPath(); circle(g, 0, 0, 50);
  g.fillStyle = rad(g, 0, 0, 0, 0, 0, 50, [[0, rgba(SHADOW_INK, 0.5)], [0.6, rgba(SHADOW_INK, 0.32)], [1, rgba(SHADOW_INK, 0)]]);
  g.fill();
  g.restore();
}

// ================================================================================================
// Icon library: item tokens, curse badges, emotes and small UI glyphs (shared by sprites and DOM data URLs)
// ================================================================================================
//
// Every icon draws around the origin inside roughly +-42 design units.

const INK = '#1b1033';

function ink(g, w = 4.4) { g.lineWidth = w; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }

/** A four-pointed glint. */
function glint(g, x, y, r, color = '#fff') {
  g.beginPath();
  g.moveTo(x, y - r); g.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y); g.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
  g.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y); g.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r);
  g.closePath(); g.fillStyle = color; g.fill();
}

function star5(g, cx, cy, ro, ri, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro, a = rot + (i * Math.PI) / 5;
    if (i) g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function iconBomb(g, sparkle = true, band = null) {
  g.beginPath(); circle(g, -2, 8, 27);
  g.fillStyle = rad(g, -12, -3, 2, -2, 8, 32, [[0, '#7a7fb0'], [0.35, '#34375c'], [1, '#0c0c22']]); g.fill();
  if (band) {
    g.save(); g.clip();
    g.beginPath(); g.moveTo(-40, 12); g.quadraticCurveTo(-2, 30, 40, 12); g.lineTo(40, 24); g.quadraticCurveTo(-2, 42, -40, 24); g.closePath();
    g.fillStyle = band; g.fill();
    g.restore();
  }
  g.beginPath(); circle(g, -2, 8, 27); ink(g, 4.6);
  g.beginPath(); ellipse(g, -12, -2, 9, 5.4, -0.7); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
  g.beginPath(); circle(g, -19, 9, 2.2); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
  g.beginPath(); rrect(g, -12, -24, 18, 10, 3);
  fillLine(g, lin(g, -12, 0, 6, 0, [[0, '#e3e6f2'], [0.5, '#9a9fbb'], [1, '#5c6084']]), INK, 3.8);
  g.beginPath(); g.moveTo(-3, -24); g.quadraticCurveTo(0, -36, 13, -37);
  g.lineWidth = 8; g.strokeStyle = INK; g.lineCap = 'round'; g.stroke();
  g.lineWidth = 4; g.strokeStyle = '#c9a56a'; g.stroke();
  if (sparkle) {
    g.beginPath(); circle(g, 15, -38, 9); g.fillStyle = rad(g, 15, -38, 0, 15, -38, 9, [[0, 'rgba(255,240,150,1)'], [1, 'rgba(255,140,30,0)']]); g.fill();
    glint(g, 15, -38, 8.5, '#fff6b0');
  }
}

function iconFlame(g) {
  const shape = (sc, dy) => {
    g.save(); g.translate(0, dy); g.scale(sc, sc);
    g.beginPath();
    g.moveTo(0, 42);
    g.bezierCurveTo(-28, 42, -34, 16, -22, -3);
    g.bezierCurveTo(-20, 9, -13, 11, -10, 5);
    g.bezierCurveTo(-16, -14, -2, -30, 6, -46);
    g.bezierCurveTo(9, -27, 31, -14, 31, 13);
    g.bezierCurveTo(31, 32, 18, 42, 0, 42);
    g.closePath();
    g.restore();
  };
  shape(1, 0); fillLine(g, lin(g, 0, -46, 0, 42, [[0, '#ff9a1f'], [1, '#e8281e']]), INK, 4.6);
  shape(0.66, 14); g.fillStyle = lin(g, 0, -20, 0, 42, [[0, '#ffe45c'], [1, '#ff9a1a']]); g.fill();
  shape(0.36, 26); g.fillStyle = '#fffbe0'; g.fill();
}

function iconSpeed(g) {
  g.beginPath();
  g.moveTo(16, -44); g.lineTo(-22, 5); g.lineTo(-3, 5); g.lineTo(-15, 44); g.lineTo(25, -8); g.lineTo(5, -8); g.closePath();
  fillLine(g, lin(g, 0, -44, 0, 44, [[0, '#fff6a0'], [0.5, '#ffd21f'], [1, '#ff9a00']]), INK, 4.8);
  g.beginPath(); g.moveTo(11, -34); g.lineTo(-11, -4); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineCap = 'round'; g.stroke();
}

function iconKick(g) {
  g.save(); g.translate(-4, 2); g.scale(0.92, 0.92);
  g.beginPath();
  g.moveTo(-22, -42); g.lineTo(8, -42); g.lineTo(10, -10); g.quadraticCurveTo(38, -4, 40, 20); g.lineTo(40, 30);
  g.quadraticCurveTo(40, 37, 33, 37); g.lineTo(-24, 37); g.quadraticCurveTo(-31, 37, -31, 30); g.lineTo(-31, -35); g.quadraticCurveTo(-31, -42, -22, -42); g.closePath();
  fillLine(g, lin(g, -30, -40, 40, 36, [[0, '#f0a35a'], [0.55, '#c8702c'], [1, '#8a4718']]), INK, 4.8);
  g.beginPath(); rrect(g, -31, -42, 41, 15, 5); fillLine(g, lin(g, 0, -42, 0, -27, [[0, '#ffffff'], [1, '#cfd6ee']]), INK, 3.8);
  g.beginPath(); g.moveTo(-31, 26); g.lineTo(40, 26); g.lineTo(40, 30); g.quadraticCurveTo(40, 37, 33, 37); g.lineTo(-24, 37); g.quadraticCurveTo(-31, 37, -31, 30); g.closePath();
  fillLine(g, '#3a2350', INK, 3);
  g.strokeStyle = '#fff'; g.lineWidth = 2.6; g.lineCap = 'round';
  for (const y of [-16, -6, 4]) { g.beginPath(); g.moveTo(-12, y); g.lineTo(2, y + 2); g.stroke(); }
  g.beginPath(); ellipse(g, 26, 12, 6, 3.2, -0.5); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill();
  g.restore();
  g.strokeStyle = '#fff'; g.lineWidth = 3.6; g.lineCap = 'round';
  for (const [y0, y1] of [[-4, -12], [8, 8], [20, 28]]) { g.beginPath(); g.moveTo(36, y0); g.lineTo(46, y1); g.stroke(); }
}

function iconGlove(g) {
  g.save(); g.rotate(-0.32);
  g.beginPath();
  g.moveTo(-20, 22); g.bezierCurveTo(-32, 8, -32, -30, -8, -40); g.bezierCurveTo(14, -48, 34, -34, 32, -8); g.bezierCurveTo(31, 8, 24, 16, 20, 22); g.closePath();
  fillLine(g, rad(g, -8, -22, 2, 0, -6, 46, [[0, '#ff8a8a'], [0.5, '#ea2b3f'], [1, '#a30e2d']]), INK, 4.8);
  g.beginPath(); g.moveTo(-26, -2); g.bezierCurveTo(-42, -2, -42, 20, -28, 20); g.bezierCurveTo(-20, 20, -18, 8, -20, 0); g.closePath();
  fillLine(g, rad(g, -32, 4, 1, -30, 8, 16, [[0, '#ff8a8a'], [1, '#c8122d']]), INK, 4);
  g.beginPath(); rrect(g, -21, 20, 42, 22, 5); fillLine(g, lin(g, 0, 20, 0, 42, [[0, '#ffffff'], [1, '#c9d0ea']]), INK, 4.2);
  g.beginPath(); g.moveTo(-9, 22); g.lineTo(-9, 40); g.moveTo(3, 22); g.lineTo(3, 40); g.lineWidth = 2.4; g.strokeStyle = '#ea2b3f'; g.stroke();
  g.beginPath(); ellipse(g, -6, -26, 10, 5, -0.7); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill();
  g.restore();
}

function iconShield(g) {
  const path = (k) => {
    g.beginPath();
    g.moveTo(0, -43 * k); g.bezierCurveTo(14 * k, -38 * k, 28 * k, -36 * k, 36 * k, -34 * k); g.lineTo(36 * k, -8 * k);
    g.bezierCurveTo(36 * k, 20 * k, 20 * k, 36 * k, 0, 46 * k); g.bezierCurveTo(-20 * k, 36 * k, -36 * k, 20 * k, -36 * k, -8 * k);
    g.lineTo(-36 * k, -34 * k); g.bezierCurveTo(-28 * k, -36 * k, -14 * k, -38 * k, 0, -43 * k); g.closePath();
  };
  path(1); fillLine(g, lin(g, -30, -40, 30, 44, [[0, '#e9f6ff'], [0.5, '#9ed0f5'], [1, '#5b95e0']]), INK, 4.8);
  g.save(); g.translate(0, 1); path(0.74);
  g.fillStyle = lin(g, -20, -30, 20, 34, [[0, '#4d8df0'], [1, '#2447b5']]); g.fill(); g.restore();
  star5(g, 0, -2, 15, 6.6); fillLine(g, lin(g, 0, -17, 0, 13, [[0, '#fff7b0'], [1, '#ffc21f']]), '#1c2f7a', 2.6);
  g.beginPath(); g.moveTo(-28, -30); g.quadraticCurveTo(-30, -6, -20, 14); g.lineWidth = 3.4; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineCap = 'round'; g.stroke();
}

function iconSkull(g, glow = true) {
  if (glow) { g.beginPath(); circle(g, 0, 0, 44); g.fillStyle = rad(g, 0, 0, 10, 0, 0, 44, [[0, 'rgba(176,107,255,0.45)'], [1, 'rgba(176,107,255,0)']]); g.fill(); }
  g.beginPath();
  g.moveTo(-14, 40); g.lineTo(-14, 30); g.bezierCurveTo(-34, 24, -38, 4, -34, -10); g.bezierCurveTo(-30, -36, -14, -44, 0, -44);
  g.bezierCurveTo(14, -44, 30, -36, 34, -10); g.bezierCurveTo(38, 4, 34, 24, 14, 30); g.lineTo(14, 40); g.closePath();
  fillLine(g, rad(g, -12, -22, 2, 0, -2, 52, [[0, '#ffffff'], [0.55, '#e9e2f7'], [1, '#a99cd0']]), INK, 4.8);
  for (const ex of [-14, 14]) {
    g.beginPath(); ellipse(g, ex, -5, 10, 12.5, ex < 0 ? 0.12 : -0.12);
    g.fillStyle = rad(g, ex, -3, 1, ex, -5, 13, [[0, '#e6c8ff'], [0.45, '#8a3fd0'], [1, '#2a0f4a']]); g.fill(); ink(g, 3.2);
  }
  g.beginPath(); g.moveTo(0, 8); g.lineTo(-5, 18); g.lineTo(5, 18); g.closePath(); g.fillStyle = '#2a0f4a'; g.fill();
  g.beginPath(); g.moveTo(-8, 30); g.lineTo(-8, 39); g.moveTo(0, 30); g.lineTo(0, 40); g.moveTo(8, 30); g.lineTo(8, 39);
  g.lineWidth = 2.6; g.strokeStyle = INK; g.stroke();
  g.beginPath(); ellipse(g, -17, -30, 9, 4.5, -0.6); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
}

function iconSlow(g) {
  g.beginPath(); g.moveTo(-40, 26); g.quadraticCurveTo(-42, 12, -22, 12); g.lineTo(26, 12); g.quadraticCurveTo(36, 12, 36, 0);
  g.lineTo(36, -18); g.quadraticCurveTo(36, -26, 42, -26); g.quadraticCurveTo(46, -26, 46, -18); g.lineTo(46, 12); g.quadraticCurveTo(46, 26, 30, 26); g.closePath();
  fillLine(g, lin(g, 0, -20, 0, 26, [[0, '#ffe6a8'], [1, '#e8a860']]), INK, 4.2);
  g.beginPath(); circle(g, -6, -6, 26);
  fillLine(g, rad(g, -14, -16, 2, -6, -6, 30, [[0, '#ffb3d6'], [0.6, '#e8558f'], [1, '#a2205a']]), INK, 4.6);
  g.beginPath(); g.moveTo(-6, -6); g.bezierCurveTo(-2, -12, 8, -8, 6, 0); g.bezierCurveTo(4, 10, -14, 10, -16, -2); g.bezierCurveTo(-16, -16, 4, -22, 14, -12);
  g.lineWidth = 3.4; g.strokeStyle = '#fff'; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
  for (const x of [40, 47]) { g.beginPath(); g.moveTo(x, -22); g.lineTo(x + (x - 43) * 1.2, -36); g.lineWidth = 3; g.strokeStyle = INK; g.stroke(); g.beginPath(); circle(g, x + (x - 43) * 1.2, -37, 3.2); g.fillStyle = '#ffe6a8'; g.fill(); ink(g, 2); }
  g.beginPath(); circle(g, 41, -12, 2.2); g.fillStyle = INK; g.fill();
}

function iconRush(g) {
  const chevron = (x, fill) => {
    g.beginPath(); g.moveTo(x - 18, -34); g.lineTo(x + 8, 0); g.lineTo(x - 18, 34); g.lineTo(x - 4, 34); g.lineTo(x + 22, 0); g.lineTo(x - 4, -34); g.closePath();
    fillLine(g, fill, INK, 4.2);
  };
  chevron(-14, lin(g, 0, -34, 0, 34, [[0, '#ffd08a'], [1, '#ff7a1a']]));
  chevron(14, lin(g, 0, -34, 0, 34, [[0, '#fff2a0'], [1, '#ffb01f']]));
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.lineCap = 'round';
  for (const y of [-22, 0, 22]) { g.beginPath(); g.moveTo(-46, y); g.lineTo(-34, y); g.stroke(); }
}

function iconReverse(g) {
  const arrow = (dir, y, fill) => {
    g.save(); g.translate(0, y); g.scale(dir, 1);
    g.beginPath(); g.moveTo(-34, -8); g.lineTo(6, -8); g.lineTo(6, -20); g.lineTo(36, 0); g.lineTo(6, 20); g.lineTo(6, 8); g.lineTo(-34, 8); g.closePath();
    fillLine(g, fill, INK, 4.2); g.restore();
  };
  arrow(1, -20, lin(g, 0, -40, 0, 0, [[0, '#a8f0ff'], [1, '#3dc3e8']]));
  arrow(-1, 20, lin(g, 0, 0, 0, 40, [[0, '#ffc2e6'], [1, '#ff5fae']]));
}

function iconNoBomb(g) {
  g.save(); g.scale(0.8, 0.8); g.translate(0, 3); iconBomb(g, false); g.restore();
  g.beginPath(); circle(g, 0, 0, 36); g.lineWidth = 9; g.strokeStyle = INK; g.stroke();
  g.lineWidth = 5.2; g.strokeStyle = '#ff3d55'; g.stroke();
  g.beginPath(); g.moveTo(-25, 25); g.lineTo(25, -25); g.lineWidth = 9; g.strokeStyle = INK; g.stroke();
  g.lineWidth = 5.2; g.strokeStyle = '#ff3d55'; g.stroke();
}

function iconSpam(g) {
  for (const [x, y] of [[-20, 18], [20, 18], [0, -14]]) { g.save(); g.translate(x, y); g.scale(0.5, 0.5); iconBomb(g, false); g.restore(); }
  glint(g, 30, -30, 9, '#fff6b0'); glint(g, -32, -20, 6, '#fff6b0');
}

function iconCrown(g) {
  g.beginPath();
  g.moveTo(-34, 24); g.lineTo(-40, -22); g.lineTo(-17, -4); g.lineTo(0, -34); g.lineTo(17, -4); g.lineTo(40, -22); g.lineTo(34, 24); g.closePath();
  fillLine(g, lin(g, 0, -34, 0, 26, [[0, '#fff2a6'], [0.4, '#ffc628'], [1, '#e08a00']]), '#6b3a10', 4.8);
  g.beginPath(); rrect(g, -34, 14, 68, 14, 6); fillLine(g, lin(g, 0, 14, 0, 28, [[0, '#ffd85a'], [1, '#d98200']]), '#6b3a10', 3.6);
  for (const [x, y, r, c] of [[0, -14, 6, '#ff3d6b'], [-27, -8, 4, '#3db8ff'], [27, -8, 4, '#3dff9a']]) {
    g.beginPath(); circle(g, x, y, r); fillLine(g, rad(g, x - 1, y - 2, 0.5, x, y, r * 1.2, [[0, '#fff'], [0.4, c], [1, mix(c, '#2a0a50', 0.5)]]), '#6b3a10', 2.2);
  }
  g.beginPath(); g.moveTo(-12, -2); g.lineTo(-2, -22); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineCap = 'round'; g.stroke();
}

function iconStar(g) {
  star5(g, 0, 2, 42, 19);
  fillLine(g, lin(g, 0, -40, 0, 40, [[0, '#fff6a0'], [0.5, '#ffd21f'], [1, '#f08a00']]), '#7a4a00', 5);
  g.beginPath(); g.moveTo(-8, -14); g.lineTo(-1, -30); g.lineWidth = 3.2; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineCap = 'round'; g.stroke();
}

function iconGhost(g) {
  g.save(); g.translate(0, 6); g.scale(0.72, 0.72); drawGhost(g, makeLook('#a55eea'), 0); g.restore();
}

function iconBot(g) {
  g.beginPath(); g.moveTo(0, -18); g.lineTo(0, -34); g.lineWidth = 5; g.strokeStyle = INK; g.lineCap = 'round'; g.stroke();
  g.beginPath(); circle(g, 0, -37, 6.5); fillLine(g, rad(g, -2, -39, 0.5, 0, -37, 7, [[0, '#fff'], [1, '#ff5a6a']]), INK, 3.4);
  g.beginPath(); rrect(g, -32, -20, 64, 52, 15); fillLine(g, lin(g, 0, -20, 0, 32, [[0, '#dfe6ff'], [1, '#8f9dd8']]), INK, 4.8);
  for (const x of [-15, 15]) { g.beginPath(); rrect(g, x - 8, -9, 16, 16, 5); fillLine(g, rad(g, x, -3, 1, x, -1, 10, [[0, '#e8ffff'], [1, '#22c3e8']]), INK, 3.4); }
  g.beginPath(); rrect(g, -13, 16, 26, 9, 4); fillLine(g, '#3a3f6e', INK, 3);
  g.strokeStyle = '#8f9dd8'; g.lineWidth = 2; for (const x of [-6, 0, 6]) { g.beginPath(); g.moveTo(x, 17.5); g.lineTo(x, 23.5); g.stroke(); }
  for (const x of [-38, 38]) { g.beginPath(); rrect(g, x - 5, -6, 10, 22, 4); fillLine(g, '#8f9dd8', INK, 3.4); }
}

function iconHeart(g) {
  g.beginPath(); g.moveTo(0, 36); g.bezierCurveTo(-52, 4, -34, -40, -14, -34); g.bezierCurveTo(-6, -32, 0, -24, 0, -18);
  g.bezierCurveTo(0, -24, 6, -32, 14, -34); g.bezierCurveTo(34, -40, 52, 4, 0, 36); g.closePath();
  fillLine(g, rad(g, -14, -14, 2, 0, 0, 46, [[0, '#ffb3c9'], [0.45, '#ff3d6b'], [1, '#b0123e']]), INK, 4.8);
  g.beginPath(); ellipse(g, -17, -18, 8, 4.4, -0.7); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
}

// ---- Emote faces -------------------------------------------------------------------------------------

function emojiFace(g, skin, draw) {
  g.beginPath(); circle(g, 0, 0, 38);
  fillLine(g, rad(g, -12, -16, 2, 0, 0, 44, [[0, mix(skin, '#ffffff', 0.55)], [0.5, skin], [1, mix(skin, '#8a3a00', 0.42)]]), INK, 4.8);
  draw(g);
  g.beginPath(); ellipse(g, -15, -24, 11, 5, -0.6); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
}

const eyeDot = (g, x, y, rx, ry) => {
  g.beginPath(); ellipse(g, x, y, rx, ry); g.fillStyle = INK; g.fill();
  g.beginPath(); circle(g, x - rx * 0.3, y - ry * 0.35, rx * 0.36); g.fillStyle = '#fff'; g.fill();
};

function iconGrin(g) {
  emojiFace(g, '#ffd23f', (c) => {
    eyeDot(c, -13, -8, 5.4, 7.6); eyeDot(c, 13, -8, 5.4, 7.6);
    c.beginPath(); c.moveTo(-21, 8); c.quadraticCurveTo(0, 12, 21, 8); c.quadraticCurveTo(16, 30, 0, 30); c.quadraticCurveTo(-16, 30, -21, 8);
    fillLine(c, '#7a1f3a', INK, 3.6);
    c.beginPath(); c.moveTo(-17, 9); c.quadraticCurveTo(0, 12, 17, 9); c.lineTo(15, 16); c.quadraticCurveTo(0, 19, -15, 16); c.closePath(); c.fillStyle = '#fff'; c.fill();
  });
}

function iconLaugh(g) {
  emojiFace(g, '#ffd23f', (c) => {
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 20, -14); c.lineTo(s * 8, -8); c.lineTo(s * 20, -2); c.lineWidth = 4; c.strokeStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); }
    c.beginPath(); c.moveTo(-22, 6); c.quadraticCurveTo(0, 10, 22, 6); c.quadraticCurveTo(16, 32, 0, 32); c.quadraticCurveTo(-16, 32, -22, 6);
    fillLine(c, '#7a1f3a', INK, 3.6);
    c.beginPath(); ellipse(c, 0, 26, 9, 5); c.fillStyle = '#ff7a8f'; c.fill();
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 34, -4); c.quadraticCurveTo(s * 44, -2, s * 42, 10); c.quadraticCurveTo(s * 34, 12, s * 34, -4); fillLine(c, '#8be3ff', INK, 2.6); }
  });
}

function iconAngry(g) {
  emojiFace(g, '#ff6b4a', (c) => {
    for (const s of [-1, 1]) {
      c.beginPath(); c.moveTo(s * 25, -20); c.lineTo(s * 6, -10); c.lineWidth = 6; c.strokeStyle = INK; c.lineCap = 'round'; c.stroke();
      eyeDot(c, s * 13, -4, 4.8, 6.4);
    }
    c.beginPath(); c.moveTo(-15, 26); c.quadraticCurveTo(0, 12, 15, 26); c.lineWidth = 5; c.strokeStyle = INK; c.lineCap = 'round'; c.stroke();
  });
}

function iconScream(g) {
  emojiFace(g, '#7fc4ff', (c) => {
    for (const s of [-1, 1]) { c.beginPath(); ellipse(c, s * 13, -8, 8, 10.5); fillLine(c, '#fff', INK, 3); c.beginPath(); circle(c, s * 13, -6, 3.4); c.fillStyle = INK; c.fill(); }
    c.beginPath(); ellipse(c, 0, 21, 9, 12); fillLine(c, '#7a1f3a', INK, 3.6);
    for (const s of [-1, 1]) { c.beginPath(); ellipse(c, s * 32, 10, 8, 11, s * 0.3); fillLine(c, '#ffd0a8', INK, 3.2); }
  });
}

function iconThumbsUp(g) {
  g.save(); g.rotate(-0.1);
  g.beginPath(); rrect(g, -38, -6, 20, 42, 6); fillLine(g, lin(g, 0, -6, 0, 36, [[0, '#7fc4ff'], [1, '#3d78e0']]), INK, 4.6);
  g.beginPath();
  g.moveTo(-14, -2); g.lineTo(-4, -2); g.bezierCurveTo(4, -14, 6, -26, 8, -36); g.bezierCurveTo(16, -40, 24, -30, 20, -14); g.lineTo(20, -8);
  g.lineTo(34, -8); g.bezierCurveTo(42, -6, 42, 2, 38, 6); g.bezierCurveTo(42, 10, 40, 18, 36, 20); g.bezierCurveTo(38, 26, 34, 32, 30, 32);
  g.bezierCurveTo(32, 38, 26, 42, 20, 40); g.lineTo(-14, 40); g.closePath();
  fillLine(g, lin(g, -14, -30, 30, 40, [[0, '#ffe1c2'], [1, '#f3a877']]), INK, 4.6);
  g.beginPath(); g.moveTo(-6, 4); g.lineTo(26, 4); g.moveTo(-6, 16); g.lineTo(30, 16); g.moveTo(-6, 28); g.lineTo(24, 28);
  g.lineWidth = 2.4; g.strokeStyle = 'rgba(120,50,20,0.45)'; g.stroke();
  g.restore();
}

function iconParty(g) {
  g.beginPath(); g.moveTo(-36, 38); g.lineTo(-10, -14); g.lineTo(14, 10); g.closePath();
  fillLine(g, lin(g, -36, 38, 14, -14, [[0, '#ff5fa8'], [0.5, '#ffb01f'], [1, '#ff7a1a']]), INK, 4.6);
  g.save(); g.beginPath(); g.moveTo(-36, 38); g.lineTo(-10, -14); g.lineTo(14, 10); g.closePath(); g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 4.4;
  for (const o of [-18, -4, 10]) { g.beginPath(); g.moveTo(-40 + o, 20 + o * 0.2); g.lineTo(6 + o, -12 + o * 0.6); g.stroke(); }
  g.restore();
  const dots = [[10, -26, '#3dc3e8', 5], [30, -10, '#ff5fa8', 4.4], [22, -34, '#ffd21f', 4.2], [36, 8, '#7be36a', 4.4], [-2, -38, '#ff7a1a', 4], [28, 24, '#a55eea', 4]];
  for (const [x, y, c, r] of dots) { g.beginPath(); circle(g, x, y, r); fillLine(g, c, INK, 2.2); }
  g.strokeStyle = '#3dc3e8'; g.lineWidth = 3.4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(16, 0); g.quadraticCurveTo(28, -6, 26, -20); g.stroke();
}

function iconCry(g) {
  emojiFace(g, '#ffd23f', (c) => {
    for (const s of [-1, 1]) {
      c.beginPath(); c.moveTo(s * 20, -10); c.quadraticCurveTo(s * 13, -19, s * 6, -10); c.lineWidth = 4; c.strokeStyle = INK; c.lineCap = 'round'; c.stroke();
      c.beginPath(); c.moveTo(s * 13, -5); c.quadraticCurveTo(s * 22, 8, s * 15, 22); c.quadraticCurveTo(s * 8, 14, s * 13, -5); fillLine(c, '#8be3ff', INK, 2.6);
    }
    c.beginPath(); c.moveTo(-13, 27); c.quadraticCurveTo(0, 14, 13, 27); c.lineWidth = 4.4; c.strokeStyle = INK; c.lineCap = 'round'; c.stroke();
  });
}

function iconCool(g) {
  emojiFace(g, '#ffd23f', (c) => {
    c.beginPath(); rrect(c, -30, -16, 26, 20, 8); rrect(c, 4, -16, 26, 20, 8);
    c.fillStyle = lin(c, 0, -16, 0, 4, [[0, '#4a4a78'], [1, '#101024']]); c.fill(); ink(c, 3.6);
    c.beginPath(); c.moveTo(-4, -8); c.lineTo(4, -8); ink(c, 3.6);
    c.beginPath(); c.moveTo(-26, -12); c.lineTo(-16, -12); c.moveTo(8, -12); c.lineTo(18, -12); c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.7)'; c.stroke();
    c.beginPath(); c.moveTo(-14, 16); c.quadraticCurveTo(2, 28, 18, 14); c.lineWidth = 4.4; c.strokeStyle = INK; c.lineCap = 'round'; c.stroke();
  });
}

function iconGG(g) {
  g.beginPath(); rrect(g, -40, -26, 80, 52, 16);
  fillLine(g, lin(g, 0, -26, 0, 26, [[0, '#8f6bff'], [1, '#4a2fc0']]), INK, 4.8);
  g.font = '900 40px "Arial Black", Impact, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = INK; g.lineJoin = 'round'; g.strokeText('GG', 0, 3);
  g.fillStyle = lin(g, 0, -16, 0, 22, [[0, '#ffffff'], [1, '#ffe27a']]); g.fillText('GG', 0, 3);
  g.beginPath(); ellipse(g, -22, -18, 12, 4, -0.2); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
}

const ICONS = {
  bomb: iconBomb, flame: iconFlame, speed: iconSpeed, kick: iconKick, glove: iconGlove, shield: iconShield, skull: iconSkull,
  slow: iconSlow, rush: iconRush, reverse: iconReverse, nobomb: iconNoBomb, spam: iconSpam,
  crown: iconCrown, star: iconStar, ghost: iconGhost, bot: iconBot, heart: iconHeart,
  'emote-grin': iconGrin, 'emote-laugh': iconLaugh, 'emote-angry': iconAngry, 'emote-scream': iconScream, 'emote-thumbsup': iconThumbsUp,
  'emote-party': iconParty, 'emote-bomb': iconBomb, 'emote-skull': iconSkull, 'emote-gg': iconGG, 'emote-heart': iconHeart, 'emote-cry': iconCry, 'emote-cool': iconCool,
};

/** Token colour behind each badge-style icon. Items and curses get a rounded tile; the rest are drawn bare. */
const TOKEN_COLORS = {
  bomb: '#3fa9ff', flame: '#e8344a', speed: '#46c23a', kick: '#6b5be6', glove: '#ffc41f', shield: '#2f66e0', skull: '#4a2278',
  slow: '#8b3fd1', rush: '#8b3fd1', reverse: '#8b3fd1', nobomb: '#8b3fd1', spam: '#8b3fd1',
};

/** Names accepted by iconDataURL(): the seven item kinds, five curses, and a few UI glyphs and emotes. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));
/** Emote icon names by wire index (matches EMOTES in constants.js), then the extra icons GG, heart, cry and cool. */
export const EMOTE_ICONS = Object.freeze(['emote-grin', 'emote-laugh', 'emote-angry', 'emote-scream', 'emote-thumbsup', 'emote-party', 'emote-bomb', 'emote-skull']);
export const EXTRA_EMOTE_ICONS = Object.freeze(['emote-gg', 'emote-heart', 'emote-cry', 'emote-cool']);

/** A glossy rounded tile (spiky for the skull) the item and curse icons sit on. */
function drawToken(g, color, spiky) {
  const r = ramp(color);
  g.beginPath();
  if (spiky) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, rr = i % 2 ? 36 : 42;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
  } else rrect(g, -40, -40, 80, 80, 27);
  fillLine(g, lin(g, -30, -40, 34, 42, [[0, r.hi], [0.5, r.base], [1, r.lo]]), r.line, 5.2);
  g.save(); g.clip();
  g.beginPath(); if (spiky) circle(g, 0, 0, 33); else rrect(g, -35, -35, 70, 70, 23);
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.32)'; g.stroke();
  g.beginPath(); ellipse(g, -14, -28, 26, 10, -0.5);
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
  g.restore();
}

/** Draw an icon (with its token when it has one) filling roughly +-42 units around the origin. */
function drawIcon(g, name) {
  const color = TOKEN_COLORS[name];
  if (color) {
    drawToken(g, color, name === 'skull');
    g.save(); g.scale(0.72, 0.72); ICONS[name](g); g.restore();
  } else {
    ICONS[name](g);
  }
}

// ================================================================================================
// DOM helpers: cached PNG data URLs for the HUD and lobby
// ================================================================================================

const dataUrlCache = new Map();

function renderDataURL(key, size, draw) {
  if (typeof document === 'undefined') return '';
  size = Math.round(size);
  size = size >= 1 ? Math.min(size, 1024) : 32;   // NaN, 0 or a runaway value must not allocate a useless or huge canvas
  const id = `${key}@${size}`;
  let url = dataUrlCache.get(id);
  if (url === undefined) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    g.scale(size / 100, size / 100);
    draw(g);
    url = c.toDataURL('image/png');
    releaseCanvas(c);
    dataUrlCache.set(id, url);
  }
  return url;
}

/**
 * PNG data URL of an item, curse or UI icon, `size` x `size` device pixels (cached). Unknown names give ''.
 * Names: ICON_NAMES (bomb, flame, speed, kick, glove, shield, skull, slow, rush, reverse, nobomb, spam, crown, star, ghost, bot, heart, emote-*).
 */
export function iconDataURL(name, size = 32) {
  if (!ICONS[name]) return '';
  return renderDataURL(`icon:${name}`, size, (g) => drawIcon(g, name));
}

/** PNG data URL of a blastie portrait (head, face and accessory) for lobby and HUD, `size` x `size` device pixels (cached). */
export function avatarDataURL(colorIndex, size = 48) {
  const c = PLAYER_COLORS[colorIndex];
  if (!c) return '';
  return renderDataURL(`avatar:${colorIndex}`, size, (g) => {
    const L = makeLook(c.hex), draw = ACCESSORY_DRAW[c.accessory];
    g.scale(0.76, 0.76);
    g.translate(0, 24);
    g.beginPath(); ellipse(g, 0, 36, 34, 9);
    g.fillStyle = rgba(SHADOW_INK, 0.25); g.fill();
    drawBodyBlob(g, L);
    drawFace(g, L, 'down', {});
    draw(g, L, { dir: 'down', sway: 0, spin: 0.35, flick: 0 });
  });
}

// ================================================================================================
// Bombs
// ================================================================================================

/** Uniform scale of the four baked pulse phases (rest, swell, peak, swell). */
export const BOMB_PULSE = Object.freeze([1, 1.05, 1.1, 1.05]);
/** Where the fuse ends, in tile units from the bomb's anchor at pulse scale 1 (spawn fuse sparks here). */
export const BOMB_FUSE_TIP = Object.freeze({ x: 0.16, y: -0.5 });
const BOMB = { cy: 8, r: 33, pivotY: 41 };
const BOMB_BOX = { hw: 56, top: -74, bottom: 58 };
const ORPHAN_BAND = '#9aa0b5';

function bombBodyPath(g) { circle(g, 0, BOMB.cy, BOMB.r); }

/** Sphere without gloss; `hot` is the red glow of the last half second before it blows. */
function drawBombBase(g, sc, hot) {
  g.translate(0, BOMB.pivotY); g.scale(sc, sc); g.translate(0, -BOMB.pivotY);
  if (hot) {
    g.beginPath(); circle(g, 0, BOMB.cy, BOMB.r + 12);
    g.fillStyle = rad(g, 0, BOMB.cy, BOMB.r * 0.6, 0, BOMB.cy, BOMB.r + 12, [[0, 'rgba(255,60,40,0.55)'], [1, 'rgba(255,60,40,0)']]); g.fill();
  }
  g.beginPath(); bombBodyPath(g);
  g.fillStyle = hot ? rad(g, -11, -6, 2, 0, BOMB.cy, 46, [[0, '#ff9a8a'], [0.3, '#b3222f'], [1, '#3a0a1c']])
    : rad(g, -11, -6, 2, 0, BOMB.cy, 46, [[0, '#8489bd'], [0.32, '#363a63'], [1, '#0b0b22']]);
  g.fill();
  g.save(); g.clip();
  g.fillStyle = rad(g, 22, 34, 2, 22, 34, 34, [[0, hot ? 'rgba(255,120,110,0.5)' : 'rgba(110,130,255,0.5)'], [1, 'rgba(110,130,255,0)']]);
  g.fillRect(-50, -50, 100, 120);
  g.restore();
}

/** Gloss, outline, collar and fuse. */
function drawBombTop(g, sc, hot) {
  g.translate(0, BOMB.pivotY); g.scale(sc, sc); g.translate(0, -BOMB.pivotY);
  g.beginPath(); bombBodyPath(g); ink(g, 4.8);
  g.beginPath(); ellipse(g, -14, -6, 11, 6.4, -0.7); g.fillStyle = 'rgba(255,255,255,0.88)'; g.fill();
  g.beginPath(); circle(g, -22, 8, 2.6); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
  g.beginPath(); rrect(g, -13, -27, 24, 13, 4);
  fillLine(g, lin(g, -13, 0, 11, 0, [[0, '#eef0fa'], [0.45, '#a3a8c4'], [1, '#5c6084']]), INK, 4);
  g.beginPath(); g.moveTo(-1, -27); g.quadraticCurveTo(2, -40, 16, -42);
  g.lineWidth = 8.4; g.strokeStyle = INK; g.lineCap = 'round'; g.stroke();
  g.lineWidth = 4.2; g.strokeStyle = '#d2b078'; g.stroke();
  g.beginPath(); circle(g, 16, -42, 4.6); g.fillStyle = hot ? '#fff' : '#ffb01f'; g.fill(); ink(g, 2);
}

function drawBombBand(g, color, sc) {
  g.translate(0, BOMB.pivotY); g.scale(sc, sc); g.translate(0, -BOMB.pivotY);
  const r = ramp(color);
  g.save();
  g.beginPath(); bombBodyPath(g); g.clip();
  g.beginPath(); g.moveTo(-40, 9); g.quadraticCurveTo(0, 25, 40, 9); g.lineTo(40, 25); g.quadraticCurveTo(0, 41, -40, 25); g.closePath();
  g.fillStyle = lin(g, 0, 10, 0, 34, [[0, r.hi], [0.5, r.base], [1, r.lo]]); g.fill();
  g.lineWidth = 2.4; g.strokeStyle = r.line; g.stroke();
  g.restore();
}

function buildBombs(atlas) {
  const out = { byColor: [] };
  let layers = null;
  atlas.job((_, env) => {
    layers = { base: [], top: [] };
    for (const hot of [false, true]) {
      for (const sc of BOMB_PULSE) {
        (layers.base[+hot] ??= []).push(makeLayer(env, { ...BOMB_BOX, oy: 0 }, (g) => drawBombBase(g, sc, hot)));
        (layers.top[+hot] ??= []).push(makeLayer(env, { ...BOMB_BOX, oy: 0 }, (g) => drawBombTop(g, sc, hot)));
      }
    }
  });
  const colors = [...PLAYER_COLORS.map((c) => c.hex), ORPHAN_BAND];
  colors.forEach((color, ci) => {
    const set = out.byColor[ci] = [[], []];
    for (const hot of [0, 1]) {
      BOMB_PULSE.forEach((sc, phase) => {
        const twin = BOMB_PULSE.indexOf(sc);   // the swell on the way back is the swell on the way out: one sprite serves both
        if (twin !== phase) { set[hot].push(set[hot][twin]); return; }
        set[hot].push(atlas.add(112, 124, 56, 66, (g, env) => {
          stamp(g, env, layers.base[hot][phase], 0, 0);
          g.save(); g.scale(env.s, env.s); drawBombBand(g, color, sc); g.restore();
          stamp(g, env, layers.top[hot][phase], 0, 0);
        }, true));
      });
    }
  });
  atlas.job(() => { releaseLayers(layers); layers = null; });
  return out;
}

// ================================================================================================
// Flames
// ================================================================================================

export const FLAME_FRAMES = 4;
const FLAME_PAD = 4;
const FLAME_W = 27;      // arm half width where it meets a neighbouring tile (identical in every sprite so tiles join seamlessly)
const FLAME_LAYERS = [   // outermost first: dark rim, red, orange, yellow, white-hot
  { k: 1.14, color: '#a3141a' },
  { k: 1, color: '#ff4a1f' },
  { k: 0.74, color: '#ff8a1e' },
  { k: 0.48, color: '#ffd23c' },
  { k: 0.22, color: '#fffbe6' },
];
const ARM_DIRS = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];

/**
 * A flame tile: a chain of overlapping discs along every connected arm plus a hub, so the edges are bumpy like a
 * cartoon blast; the disc on each tile edge has a fixed size so neighbouring tiles join seamlessly. Licks (little
 * tongues) move from frame to frame.
 */
function flameDiscs(mask, frame) {
  const ph = (frame / FLAME_FRAMES) * TAU;
  const discs = [];
  const arms = ARM_DIRS.filter((d) => mask & d[2]);
  const straight = mask === 5 || mask === 10;
  const hub = arms.length === 0 ? 40 : straight ? FLAME_W : arms.length === 1 ? FLAME_W * 1.04 : FLAME_W * 1.24;
  discs.push([0, 0, hub * (1 + 0.05 * Math.sin(ph))]);
  arms.forEach(([dx, dy], a) => {
    [[14, 0.9, 0.7], [29, 1.16, 2.4], [43, 0.94, 4.1]].forEach(([d, k, off]) => {
      discs.push([dx * d, dy * d, FLAME_W * (k + 0.1 * Math.sin(ph + off + a * 1.9))]);
    });
    discs.push([dx * 50, dy * 50, FLAME_W]);
  });
  if (arms.length === 1) {   // rounded free end past the centre, breathing in length
    const [dx, dy] = arms[0];
    const len = 13 + 6 * Math.sin(ph * 2 + 1);
    discs.push([-dx * len, -dy * len, FLAME_W * 0.98]);
  }
  return discs;
}

function drawFlame(g, mask, frame) {
  const discs = flameDiscs(mask, frame);
  for (const layer of FLAME_LAYERS) {
    g.beginPath();
    if (layer.k > 0.6) {   // bumpy outer body
      for (const [x, y, r] of discs) { g.moveTo(x + r * layer.k, y); g.arc(x, y, r * layer.k, 0, TAU); }
      g.fillStyle = layer.color; g.fill();
    } else {               // smooth hot core: one thick line per arm
      const [hx, hy, hr] = discs[0];
      g.moveTo(hx + hr * layer.k, hy); g.arc(hx, hy, hr * layer.k, 0, TAU);
      g.fillStyle = layer.color; g.fill();
      g.beginPath();
      for (const [dx, dy, bit] of ARM_DIRS) if (mask & bit) { g.moveTo(0, 0); g.lineTo(dx * 50, dy * 50); }
      g.lineCap = 'butt'; g.lineWidth = 2 * FLAME_W * layer.k; g.strokeStyle = layer.color; g.stroke();
      if (mask !== 0 && (mask & (mask - 1)) === 0) {   // single arm: the core also fills the rounded free end
        const d = discs[discs.length - 1];
        g.beginPath(); g.moveTo(d[0] + d[2] * layer.k, d[1]); g.arc(d[0], d[1], d[2] * layer.k, 0, TAU); g.fillStyle = layer.color; g.fill();
        g.beginPath(); g.moveTo(0, 0); g.lineTo(d[0], d[1]); g.lineWidth = 2 * FLAME_W * layer.k; g.strokeStyle = layer.color; g.stroke();
      }
    }
  }
  // licks: little tongues that leave the blast where no arm continues
  const ph = (frame / FLAME_FRAMES) * TAU;
  const open = ARM_DIRS.filter((d) => mask & d[2]);
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = ph * 0.35 + (i / 5) * TAU + i * 0.4, ax = Math.cos(a), ay = Math.sin(a);
    if (open.some((d) => d[0] * ax + d[1] * ay > 0.55)) continue;
    const r0 = (mask === 0 ? 34 : 24) + 3 * Math.sin(ph + i), r1 = r0 + 9 + 5 * Math.sin(ph * 2 + i * 1.7);
    g.moveTo(ax * r0 - ay * 7, ay * r0 + ax * 7);
    g.quadraticCurveTo(ax * (r0 + 5) - ay * 3, ay * (r0 + 5) + ax * 3, ax * r1, ay * r1);
    g.quadraticCurveTo(ax * (r0 + 5) + ay * 3, ay * (r0 + 5) - ax * 3, ax * r0 + ay * 7, ay * r0 - ax * 7);
  }
  g.fillStyle = '#ff5a1f'; g.fill();
}

function buildFlames(atlas) {
  const out = [];
  const size = 100 + 2 * FLAME_PAD;
  for (let mask = 0; mask < 16; mask++) {
    const frames = [];
    for (let f = 0; f < FLAME_FRAMES; f++) frames.push(atlas.add(size, size, size / 2, size / 2, (g) => drawFlame(g, mask, f)));
    out.push(frames);
  }
  return out;
}

// ================================================================================================
// Items
// ================================================================================================

const ITEM_GLOW = {
  bomb: '#5cc0ff', flame: '#ff5a3d', speed: '#7dff5a', kick: '#9a8cff', glove: '#ffd84a', shield: '#5b9dff', skull: '#b04cff',
};

function buildItems(atlas) {
  const tokens = {}, glows = {};
  for (const kind of ITEM_KINDS) {
    tokens[kind] = atlas.add(100, 100, 50, 50, (g) => { g.scale(0.84, 0.84); drawIcon(g, kind); });
    const glow = ITEM_GLOW[kind];
    glows[kind] = atlas.add(150, 150, 75, 75, (g) => {
      g.beginPath(); circle(g, 0, 0, 75);
      g.fillStyle = rad(g, 0, 0, 12, 0, 0, 75, [[0, rgba(glow, 0.75)], [0.5, rgba(glow, 0.32)], [1, rgba(glow, 0)]]); g.fill();
    });
  }
  return { tokens, glows };
}

// ================================================================================================
// Particle textures and other small shared sprites
// ================================================================================================

const CONFETTI_COLORS = ['#ff4d5e', '#3d8bff', '#38c85a', '#ffd23f', '#a55eea', '#ff7eb6'];

function drawSmoke(g, seed, tint) {
  const rnd = makeRng(seed);
  const puffs = [[0, 0, 26]];
  for (let i = 0; i < 6; i++) { const a = rnd.next() * TAU, d = 12 + rnd.next() * 12; puffs.push([Math.cos(a) * d, Math.sin(a) * d * 0.85, 13 + rnd.next() * 8]); }
  for (const [x, y, r] of puffs) {
    g.beginPath(); circle(g, x, y, r);
    g.fillStyle = rad(g, x - r * 0.25, y - r * 0.3, 0, x, y, r, [[0, rgba(tint, 0.95)], [0.6, rgba(tint, 0.75)], [1, rgba(tint, 0)]]); g.fill();
  }
}

function buildFx(atlas) {
  const fx = { smoke: [], confetti: [] };
  fx.dot = atlas.add(64, 64, 32, 32, (g) => {
    g.beginPath(); circle(g, 0, 0, 30);
    g.fillStyle = rad(g, 0, 0, 0, 0, 0, 30, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]); g.fill();
  });
  fx.glowWarm = atlas.add(200, 200, 100, 100, (g) => {
    g.beginPath(); circle(g, 0, 0, 100);
    g.fillStyle = rad(g, 0, 0, 0, 0, 0, 100, [[0, 'rgba(255,214,120,0.85)'], [0.35, 'rgba(255,140,40,0.42)'], [1, 'rgba(255,90,20,0)']]); g.fill();
  });
  fx.glowCool = atlas.add(200, 200, 100, 100, (g) => {
    g.beginPath(); circle(g, 0, 0, 100);
    g.fillStyle = rad(g, 0, 0, 0, 0, 0, 100, [[0, 'rgba(170,230,255,0.8)'], [0.35, 'rgba(90,160,255,0.4)'], [1, 'rgba(60,110,255,0)']]); g.fill();
  });
  fx.spark = atlas.add(48, 48, 24, 24, (g) => {
    g.beginPath(); circle(g, 0, 0, 22); g.fillStyle = rad(g, 0, 0, 0, 0, 0, 22, [[0, 'rgba(255,240,170,0.7)'], [1, 'rgba(255,200,80,0)']]); g.fill();
    glint(g, 0, 0, 22, '#fffbe6');
  });
  for (let i = 0; i < 3; i++) fx.smoke.push(atlas.add(100, 100, 50, 50, (g) => drawSmoke(g, 11 + i * 7, '#e9e4f5')));
  fx.darkSmoke = [];   // explosion smoke: reads on light floors, and keeps a violet cast so it is still visible on dark ones
  for (let i = 0; i < 3; i++) fx.darkSmoke.push(atlas.add(100, 100, 50, 50, (g) => drawSmoke(g, 41 + i * 5, '#5d5473')));
  fx.flameGlow = atlas.add(140, 140, 70, 70, (g) => {   // additive light around a flame tile, drawn 1:1 (a scaled draw costs several times more)
    g.beginPath(); circle(g, 0, 0, 70);
    g.fillStyle = rad(g, 0, 0, 0, 0, 0, 70, [[0, 'rgba(255,214,120,0.8)'], [0.4, 'rgba(255,140,40,0.4)'], [1, 'rgba(255,90,20,0)']]); g.fill();
  });
  fx.ember = atlas.add(48, 48, 24, 24, (g) => {
    g.beginPath(); circle(g, 0, 0, 22);
    g.fillStyle = rad(g, 0, 0, 0, 0, 0, 22, [[0, 'rgba(255,246,190,1)'], [0.3, 'rgba(255,168,50,0.9)'], [1, 'rgba(255,90,20,0)']]); g.fill();
  });
  fx.twinkle = atlas.add(48, 48, 24, 24, (g) => {
    g.beginPath(); circle(g, 0, 0, 21); g.fillStyle = rad(g, 0, 0, 0, 0, 0, 21, [[0, 'rgba(210,235,255,0.55)'], [1, 'rgba(160,200,255,0)']]); g.fill();
    glint(g, 0, 0, 22, '#ffffff');
  });
  fx.skull = atlas.add(76, 76, 38, 38, (g) => { g.scale(0.62, 0.62); ICONS.skull(g, true); });
  fx.ring = atlas.add(128, 128, 64, 64, (g) => {
    g.beginPath(); circle(g, 0, 0, 52); g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); circle(g, 0, 0, 44); g.stroke();
  });
  fx.star = atlas.add(68, 68, 34, 34, (g) => { g.scale(0.66, 0.66); iconStar(g); });
  for (const c of CONFETTI_COLORS) {
    fx.confetti.push(atlas.add(28, 20, 14, 10, (g) => {
      g.beginPath(); rrect(g, -10, -5, 20, 10, 2.4); fillLine(g, lin(g, 0, -5, 0, 5, [[0, mix(c, '#ffffff', 0.35)], [1, c]]), null, 0);
    }));
  }
  fx.warning = atlas.add(92, 92, 46, 46, (g) => {   // sudden-death marker
    g.beginPath(); g.moveTo(0, -32); g.lineTo(34, 26); g.lineTo(-34, 26); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = INK; g.stroke();
    fillLine(g, lin(g, 0, -32, 0, 26, [[0, '#ffe45c'], [1, '#ff9a1a']]), '#ffe45c', 5);
    g.beginPath(); g.moveTo(0, -12); g.lineTo(0, 8); g.lineWidth = 7; g.strokeStyle = INK; g.lineCap = 'round'; g.stroke();
    g.beginPath(); circle(g, 0, 17, 3.8); g.fillStyle = INK; g.fill();
  });
  fx.shadow = atlas.add(104, 54, 52, 27, drawSoftShadow);
  return fx;
}

// ================================================================================================
// Terrain: floor, pillars, crates, borders, debris and backdrops, one look per theme
// ================================================================================================

const H_PILLAR = 34, H_SOFT = 30, H_BORDER = 28;   // extrusion heights (design units above the tile)
const FLOOR_VARIANTS = 3, PILLAR_VARIANTS = 3, SOFT_VARIANTS = 4, BORDER_VARIANTS = 3, DEBRIS_VARIANTS = 4;
export const BACKDROP_TILES = 4;                    // the backdrop pattern is 4 x 4 tiles and repeats seamlessly

/**
 * An extruded block that fills a tile: front face below, lighter top face raised by `h`.
 * Origin = tile top-left, so the top face reaches h units above the tile. decorTop/decorFront draw clipped
 * details and receive the face boxes {x0, x1, y0, y1}.
 */
function extrude(g, o) {
  const m = o.m ?? 3, h = o.h, r = o.r ?? 15, lw = o.lw ?? 4.4;
  const x0 = m, x1 = 100 - m, yb = 100 - m, yt = yb - h, y0 = m - h;
  const top = { x0, x1, y0, y1: yt }, front = { x0, x1, y0: yt, y1: yb };
  g.beginPath(); rrect(g, x0, yt - 24, x1 - x0, h + 24, r);
  g.fillStyle = lin(g, 0, yt, 0, yb, o.front); g.fill();
  g.save(); g.clip();
  // rounded-edge shading: darker toward the sides and the base
  g.fillStyle = lin(g, x0, 0, x1, 0, [[0, 'rgba(255,255,255,0.16)'], [0.12, 'rgba(255,255,255,0)'], [0.86, 'rgba(20,10,60,0)'], [1, 'rgba(20,10,60,0.3)']]);
  g.fillRect(x0, yt, x1 - x0, h);
  g.fillStyle = lin(g, 0, yb - 12, 0, yb, [[0, 'rgba(20,10,60,0)'], [1, 'rgba(20,10,60,0.28)']]);
  g.fillRect(x0, yb - 12, x1 - x0, 12);
  o.decorFront?.(g, front);
  g.restore();
  g.beginPath(); rrect(g, x0, yt - 24, x1 - x0, h + 24, r); ink2(g, o.line, lw);
  g.beginPath(); rrect(g, x0, y0, x1 - x0, yt - y0, r);
  g.fillStyle = lin(g, x0, y0, x1, yt, o.top); g.fill();
  g.save(); g.clip();
  o.decorTop?.(g, top);
  g.restore();
  // bevel: light on the top-left rim, shade on the bottom-right
  g.beginPath(); rrect(g, x0 + 3.2, y0 + 3.2, x1 - x0 - 6.4, yt - y0 - 6.4, Math.max(2, r - 3));
  g.lineWidth = 3; g.strokeStyle = lin(g, x0, y0, x1, yt, [[0, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(20,10,60,0.3)']]); g.stroke();
  g.beginPath(); rrect(g, x0, y0, x1 - x0, yt - y0, r); ink2(g, o.line, lw);
  return { top, front };
}

function ink2(g, color, w) { g.lineWidth = w; g.strokeStyle = color; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }

function speckle(g, rnd, n, x0, y0, x1, y1, colors, r0, r1) {
  for (let i = 0; i < n; i++) {
    g.beginPath(); circle(g, x0 + rnd.next() * (x1 - x0), y0 + rnd.next() * (y1 - y0), r0 + rnd.next() * (r1 - r0));
    g.fillStyle = colors[rnd.int(colors.length)]; g.fill();
  }
}

function blob(g, x, y, r, fill, line, lw = 2.4) {
  g.beginPath(); circle(g, x, y, r); fillLine(g, fill, line, lw);
}

/** Polyline with a soft glow, used for lava cracks and neon. */
function glowLine(g, pts, colors, w) {
  g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.lineWidth = w * 3.2; g.strokeStyle = colors[0]; g.globalAlpha = 0.26; g.stroke();
  g.lineWidth = w * 1.8; g.strokeStyle = colors[1]; g.globalAlpha = 0.6; g.stroke();
  g.globalAlpha = 1; g.lineWidth = w; g.strokeStyle = colors[2]; g.stroke();
}

function checkerFill(g, a, b, parity) {
  const [hi, lo] = parity ? b : a;
  g.fillStyle = lin(g, 0, 0, 100, 100, [[0, hi], [1, lo]]);
  g.fillRect(0, 0, 100, 100);
}

/** Faint tile boundary on the lower right so the grid stays readable under all lighting. */
function gridEdge(g, alpha = 0.07) {
  g.fillStyle = rgba('#12082e', alpha);
  g.fillRect(0, 98, 100, 2); g.fillRect(98, 0, 2, 100);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, 0, 100, 2); g.fillRect(0, 0, 2, 100);
}

function crackPath(rnd, x, y, len, dir, seg = 4) {
  const pts = [[x, y]];
  for (let i = 0; i < seg; i++) { x += Math.cos(dir) * len / seg + (rnd.next() - 0.5) * 8; y += Math.sin(dir) * len / seg + (rnd.next() - 0.5) * 8; pts.push([x, y]); dir += (rnd.next() - 0.5) * 1.1; }
  return pts;
}

// ---- Meadow ----------------------------------------------------------------------------------------------

function tuft(g, x, y, sc, dark, light) {
  g.save(); g.translate(x, y); g.scale(sc, sc);
  for (const [dx, ang, len] of [[-5, -0.5, 13], [0, 0.05, 16], [5, 0.5, 12]]) {
    g.beginPath(); g.moveTo(dx - 2.6, 0); g.quadraticCurveTo(dx + Math.sin(ang) * 4, -len * 0.6, dx + Math.sin(ang) * 9, -len); g.quadraticCurveTo(dx + 2, -len * 0.4, dx + 2.6, 0); g.closePath();
    g.fillStyle = lin(g, 0, -len, 0, 0, [[0, light], [1, dark]]); g.fill();
  }
  g.restore();
}

function flower(g, x, y, r, petal, center) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    blob(g, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, r * 0.7, petal, 'rgba(60,40,90,0.45)', 1.4);
  }
  blob(g, x, y, r * 0.55, center, 'rgba(120,70,0,0.6)', 1.2);
}

function moss(g, x, y, r, rnd) {
  for (let i = 0; i < 3; i++) {
    const a = rnd.next() * TAU;
    blob(g, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.4, r * (0.5 + rnd.next() * 0.35), rad(g, x - 2, y - 3, 0, x, y, r, [[0, '#a3e668'], [1, '#4aa03a']]), '#2f6b2f', 1.8);
  }
}

const MEADOW = {
  floor(g, parity, v) {
    const rnd = makeRng(500 + v * 13 + parity);
    checkerFill(g, ['#b0ec80', '#9ce069'], ['#93da62', '#82cc52'], parity);
    speckle(g, rnd, 26, 4, 4, 96, 96, ['rgba(70,150,50,0.22)', 'rgba(255,255,255,0.15)', 'rgba(70,150,50,0.14)'], 0.8, 1.6);
    if (v === 1) { tuft(g, 24 + rnd.next() * 10, 44, 1, '#4f9f3a', '#8fd85a'); tuft(g, 70, 80 + rnd.next() * 6, 0.8, '#4f9f3a', '#8fd85a'); }
    if (v === 2) { tuft(g, 74, 40, 0.75, '#4f9f3a', '#8fd85a'); flower(g, 30 + rnd.next() * 8, 66, 5.2, '#ffffff', '#ffd23f'); flower(g, 62, 84, 3.4, '#ffd6ec', '#ff9ec8'); }
    gridEdge(g, 0.05);
  },
  pillar(g, v) {
    const rnd = makeRng(610 + v);
    extrude(g, {
      h: H_PILLAR, m: 3, r: 17, top: [[0, '#f4f1fd'], [1, '#bdb7d8']], front: [[0, '#aaa4c9'], [1, '#6f6992']], line: '#3a3260',
      decorTop(c, t) {
        c.beginPath(); rrect(c, 15, t.y0 + 15, 70, t.y1 - t.y0 - 30, 12);
        c.fillStyle = lin(c, 0, t.y0 + 15, 0, t.y1 - 15, [[0, '#c3bdde'], [1, '#e6e2f5']]); c.fill();
        c.lineWidth = 3; c.strokeStyle = 'rgba(58,50,96,0.3)'; c.stroke();
        const cy = (t.y0 + t.y1) / 2;
        const crack = crackPath(rnd, 34 + v * 8, cy - 14, 34, 0.9 + v * 0.5);
        c.beginPath(); crack.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); ink2(c, 'rgba(58,50,96,0.55)', 2);
        moss(c, [22, 78, 30][v], [t.y1 - 12, t.y0 + 20, t.y1 - 16][v], 11, rnd);
      },
      decorFront(c, f) {
        c.strokeStyle = 'rgba(40,30,80,0.35)'; c.lineWidth = 2.4;
        c.beginPath(); c.moveTo(f.x0, (f.y0 + f.y1) / 2 + 3); c.lineTo(f.x1, (f.y0 + f.y1) / 2 + 3);
        c.moveTo(36 + v * 8, f.y0); c.lineTo(36 + v * 8, (f.y0 + f.y1) / 2 + 3); c.moveTo(66 - v * 6, (f.y0 + f.y1) / 2 + 3); c.lineTo(66 - v * 6, f.y1); c.stroke();
        moss(c, 20 + v * 24, f.y1 - 2, 12, rnd); moss(c, 84 - v * 10, f.y1 - 1, 9, rnd);
      },
    });
  },
  soft(g, v) {
    const rnd = makeRng(720 + v);
    extrude(g, {
      h: H_SOFT, m: 4, r: 12, top: [[0, '#ffd28a'], [1, '#d78a38']], front: [[0, '#d98a3c'], [1, '#93501d']], line: '#5a2f12',
      decorTop(c, t) {
        const H = t.y1 - t.y0;
        c.strokeStyle = 'rgba(110,55,15,0.55)'; c.lineWidth = 2.6;
        for (const f of [0.33, 0.66]) { c.beginPath(); c.moveTo(t.x0, t.y0 + H * f); c.lineTo(t.x1, t.y0 + H * f); c.stroke(); }
        c.strokeStyle = 'rgba(120,60,15,0.32)'; c.lineWidth = 1.6;
        for (let i = 0; i < 6; i++) { const y = t.y0 + 6 + rnd.next() * (H - 12), x = 10 + rnd.next() * 60; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 14, y - 2, x + 28, y + 1); c.stroke(); }
        c.beginPath(); rrect(c, t.x0 + 6, t.y0 + 6, t.x1 - t.x0 - 12, H - 12, 8); c.lineWidth = 3.6; c.strokeStyle = 'rgba(120,58,14,0.5)'; c.stroke();
        for (const [nx, ny] of [[14, t.y0 + 14], [86, t.y0 + 14], [14, t.y1 - 14], [86, t.y1 - 14]]) { blob(c, nx, ny, 2.8, '#6b4a2a', '#3a2410', 1.2); c.beginPath(); circle(c, nx - 0.8, ny - 0.9, 0.9); c.fillStyle = '#e6c9a0'; c.fill(); }
        if (v === 1) { star5(c, 50, (t.y0 + t.y1) / 2, 11, 4.8); fillLine(c, '#ffe27a', 'rgba(110,55,15,0.8)', 2); }
        if (v === 2) { c.beginPath(); c.moveTo(50, (t.y0 + t.y1) / 2 + 10); c.bezierCurveTo(30, (t.y0 + t.y1) / 2, 40, (t.y0 + t.y1) / 2 - 14, 50, (t.y0 + t.y1) / 2 - 10); c.bezierCurveTo(60, (t.y0 + t.y1) / 2 - 14, 70, (t.y0 + t.y1) / 2, 50, (t.y0 + t.y1) / 2 + 10); fillLine(c, '#7ed957', 'rgba(20,80,30,0.8)', 2); }
      },
      decorFront(c, f) {
        c.strokeStyle = 'rgba(70,30,5,0.5)'; c.lineWidth = 2.4;
        for (const x of [30, 52, 74]) { c.beginPath(); c.moveTo(x + (v % 2) * 2, f.y0); c.lineTo(x + (v % 2) * 2, f.y1); c.stroke(); }
        c.beginPath(); c.moveTo(f.x0 + 6, f.y1 - 5); c.lineTo(f.x1 - 6, f.y0 + 5); c.lineWidth = 7; c.strokeStyle = 'rgba(70,30,5,0.6)'; c.stroke();
        c.lineWidth = 3.4; c.strokeStyle = 'rgba(255,214,150,0.55)'; c.translate(-1, -1.4); c.stroke(); c.translate(1, 1.4);
        for (const [nx, ny] of [[14, f.y0 + 6], [86, f.y0 + 6], [14, f.y1 - 7], [86, f.y1 - 7]]) { blob(c, nx, ny, 2.6, '#6b4a2a', '#2b1808', 1.2); }
        c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(f.x0, f.y0, f.x1 - f.x0, 4);
      },
    });
  },
  border(g, v) {
    const rnd = makeRng(830 + v);
    extrude(g, {
      h: H_BORDER, m: 0, r: 6, lw: 3.6, top: [[0, '#69cf55'], [1, '#3c9a44']], front: [[0, '#2f8a3c'], [1, '#1c5a2c']], line: '#154a26',
      decorTop(c, t) {
        for (let i = 0; i < 16; i++) {
          const x = rnd.next() * 100, y = t.y0 + rnd.next() * (t.y1 - t.y0), r = 6 + rnd.next() * 6;
          for (const ox of [0, x < r + 4 ? 100 : x > 96 - r ? -100 : 0]) {
            blob(c, x + ox, y, r, rad(c, x + ox - r * 0.3, y - r * 0.4, 0, x + ox, y, r, [[0, '#a6ee7a'], [0.6, '#5cbf4c'], [1, '#2f8a3c']]), 'rgba(20,90,40,0.55)', 1.8);
          }
        }
        for (let i = 0; i < 3 + v; i++) blob(c, 8 + rnd.next() * 84, t.y0 + 8 + rnd.next() * (t.y1 - t.y0 - 16), 2.6, ['#ff7eb6', '#ffffff', '#ffd23f'][i % 3], 'rgba(80,20,60,0.5)', 1);
      },
      decorFront(c, f) {
        for (let i = 0; i < 14; i++) {
          const x = rnd.next() * 100, y = f.y0 + rnd.next() * (f.y1 - f.y0), r = 5 + rnd.next() * 4;
          blob(c, x, y, r, rad(c, x - 2, y - 2, 0, x, y, r, [[0, '#56b04a'], [1, '#1e6b34']]), 'rgba(10,60,30,0.5)', 1.6);
        }
      },
    });
  },
  debris(g, v) {
    g.rotate(v * 1.3);
    g.beginPath(); g.moveTo(-14, -6); g.lineTo(10, -10); g.lineTo(15, 4); g.lineTo(-8, 9); g.closePath();
    fillLine(g, lin(g, -14, -10, 14, 9, [[0, '#ffd28a'], [1, '#b8682a']]), '#5a2f12', 3);
    g.beginPath(); g.moveTo(-10, -3); g.lineTo(9, -6); g.lineWidth = 1.8; g.strokeStyle = 'rgba(90,45,10,0.5)'; g.stroke();
  },
  palette: {
    label: 'Meadow', floorA: '#aae87a', floorB: '#88d158', wallTop: '#f4f1fd', wallFront: '#6f6992', blockTop: '#ffd28a', blockFront: '#93501d',
    accent: '#ffd23f', glow: '#fff3a0', sky: ['#7fdcff', '#d2f7ae'], backdrop: '#78cf55', frame: '#2f8a3c', dust: '#e9dcae',
    ambient: { kind: 'pollen', colors: ['#ffffff', '#fff3a0', '#ffd6ec'] }, debris: ['#ffd28a', '#d78a38', '#93501d'],
  },
};

// ---- Frost ----------------------------------------------------------------------------------------------

function snowflake(g, x, y, r, color, w = 1.6) {
  g.save(); g.translate(x, y); g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI; g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(-Math.cos(a) * r, -Math.sin(a) * r); }
  g.stroke(); g.restore();
}

function icicle(g, x, y, w, len) {
  g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x - w * 0.15, y + len * 0.6, x, y + len); g.quadraticCurveTo(x + w * 0.15, y + len * 0.6, x + w / 2, y); g.closePath();
  fillLine(g, lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#ffffff'], [1, '#a9dcf6']]), '#3c78b4', 2.2);
}

const FROST = {
  floor(g, parity, v) {
    const rnd = makeRng(1500 + v * 13 + parity);
    checkerFill(g, ['#eaf8ff', '#daf1fd'], ['#c9e6f8', '#b6dbf2'], parity);
    speckle(g, rnd, 22, 4, 4, 96, 96, ['rgba(255,255,255,0.9)', 'rgba(150,200,240,0.28)'], 0.8, 1.7);
    if (v === 1) {
      g.beginPath(); ellipse(g, 20, 88, 30, 10); g.fillStyle = rad(g, 20, 88, 0, 20, 88, 30, [[0, 'rgba(255,255,255,0.95)'], [1, 'rgba(255,255,255,0)']]); g.fill();
      const c = crackPath(rnd, 60, 20, 30, 1.9, 3); g.beginPath(); c.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); ink2(g, 'rgba(120,180,225,0.6)', 1.6);
      glint(g, 78, 66, 7, '#ffffff');
    }
    if (v === 2) { snowflake(g, 38, 40, 10, 'rgba(140,195,235,0.6)'); glint(g, 72, 30, 6, '#ffffff'); glint(g, 24, 76, 4, '#ffffff'); g.beginPath(); ellipse(g, 78, 86, 18, 6); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill(); }
    gridEdge(g, 0.05);
  },
  pillar(g, v) {
    extrude(g, {
      h: H_PILLAR, m: 3, r: 17, top: [[0, '#ffffff'], [1, '#cfe6f7']], front: [[0, '#a9e0fb'], [1, '#4f9ee0']], line: '#2b5f9a',
      decorTop(c, t) {
        const cy = (t.y0 + t.y1) / 2;
        for (const [x, y, r] of [[30, cy - 12, 17], [66, cy - 6, 19], [46, cy + 14, 17], [78, cy + 18, 12], [20, cy + 18, 11]]) {
          blob(c, x, y, r, rad(c, x - r * 0.35, y - r * 0.4, 0, x, y, r, [[0, '#ffffff'], [0.7, '#f1f9ff'], [1, '#bcd9f0']]), 'rgba(90,140,200,0.35)', 1.8);
        }
        glint(c, 30 + v * 12, cy - 16, 6, '#ffffff');
      },
      decorFront(c, f) {
        c.fillStyle = lin(c, 0, 0, 100, 0, [[0, 'rgba(255,255,255,0.4)'], [0.3, 'rgba(255,255,255,0)'], [0.6, 'rgba(255,255,255,0.18)'], [0.7, 'rgba(255,255,255,0)']]);
        c.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
        c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = 3; c.lineCap = 'round';
        for (const x of [24 + v * 4, 62 - v * 3]) { c.beginPath(); c.moveTo(x, f.y0 + 10); c.lineTo(x - 4, f.y1 - 8); c.stroke(); }
        for (const x of [16, 34, 52, 70, 86]) icicle(c, x + ((x * 7 + v * 5) % 6), f.y0 - 1, 9 + (x % 3) * 2, 9 + ((x * 5 + v * 3) % 10));
      },
    });
  },
  soft(g, v) {
    const rnd = makeRng(1720 + v);
    extrude(g, {
      h: H_SOFT, m: 4, r: 13, top: [[0, '#f4fdff'], [1, '#a5e3f7']], front: [[0, '#8fdcf5'], [1, '#3f9fdc']], line: '#2a6aa8',
      decorTop(c, t) {
        const H = t.y1 - t.y0, cy = (t.y0 + t.y1) / 2;
        c.beginPath(); rrect(c, 14, t.y0 + 14, 72, H - 28, 10); c.fillStyle = lin(c, 14, t.y0, 86, t.y1, [[0, 'rgba(255,255,255,0.85)'], [1, 'rgba(160,220,245,0.4)']]); c.fill();
        c.lineWidth = 2; c.strokeStyle = 'rgba(70,140,210,0.35)'; c.stroke();
        c.beginPath(); c.moveTo(18, t.y1 - 14); c.lineTo(58, t.y0 + 12); c.lineTo(72, t.y0 + 12); c.lineTo(32, t.y1 - 14); c.closePath(); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fill();
        for (let i = 0; i < 3 + v; i++) blob(c, 22 + rnd.next() * 56, cy - 14 + rnd.next() * 28, 1.6 + rnd.next() * 2.2, 'rgba(255,255,255,0.75)', 'rgba(90,150,210,0.6)', 1);
        glint(c, 26, t.y0 + 18, 8, '#ffffff'); if (v % 2) glint(c, 76, t.y1 - 16, 5, '#ffffff');
      },
      decorFront(c, f) {
        c.beginPath(); rrect(c, 14, f.y0 + 5, 72, f.y1 - f.y0 - 11, 7); c.fillStyle = 'rgba(255,255,255,0.22)'; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.5)'; c.stroke();
        c.beginPath(); c.moveTo(20, f.y1 - 8); c.lineTo(50, f.y0 + 6); c.lineWidth = 6; c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineCap = 'round'; c.stroke();
        glint(c, 76, f.y0 + 12, 5, '#ffffff'); blob(c, 30 + v * 12, f.y1 - 12, 2.2, 'rgba(255,255,255,0.7)', 'rgba(60,120,190,0.5)', 1);
      },
    });
  },
  border(g, v) {
    extrude(g, {
      h: H_BORDER, m: 0, r: 6, lw: 3.6, top: [[0, '#ffffff'], [1, '#c8e2f6']], front: [[0, '#86a9dc'], [1, '#4b6fb0']], line: '#2b4a86',
      decorTop(c, t) {
        const cy = (t.y0 + t.y1) / 2;
        for (const [x, y, r] of [[14, cy - 8, 14], [48, cy + 6, 16], [82, cy - 10, 14], [30, cy + 22, 11], [70, cy + 24, 12], [50, cy - 20, 12], [0, cy + 6, 12], [100, cy + 6, 12]]) {
          blob(c, x, y, r, rad(c, x - r * 0.35, y - r * 0.4, 0, x, y, r, [[0, '#ffffff'], [0.7, '#f1f9ff'], [1, '#b8d6ee']]), 'rgba(90,140,200,0.3)', 1.6);
        }
        glint(c, 24 + v * 20, cy - 12, 5, '#ffffff');
      },
      decorFront(c, f) {
        c.strokeStyle = 'rgba(30,60,120,0.4)'; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(f.x0, (f.y0 + f.y1) / 2); c.lineTo(f.x1, (f.y0 + f.y1) / 2); c.moveTo(28 + v * 9, f.y0); c.lineTo(28 + v * 9, (f.y0 + f.y1) / 2); c.moveTo(72 - v * 7, (f.y0 + f.y1) / 2); c.lineTo(72 - v * 7, f.y1); c.stroke();
        for (const x of [12, 40, 66, 90]) icicle(c, x + ((x * 3 + v * 7) % 5), f.y0 - 1, 9, 8 + ((x + v * 4) % 9));
      },
    });
  },
  debris(g, v) {
    g.rotate(v * 1.1);
    g.beginPath(); g.moveTo(-4, -16); g.lineTo(10, 6); g.lineTo(-12, 10); g.closePath();
    fillLine(g, lin(g, -10, -14, 10, 10, [[0, '#ffffff'], [1, '#7ec8ef']]), '#2b6aa8', 2.6);
    g.beginPath(); g.moveTo(-4, -10); g.lineTo(-7, 4); g.lineWidth = 1.8; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
  },
  palette: {
    label: 'Frost', floorA: '#eaf8ff', floorB: '#c4e3f6', wallTop: '#ffffff', wallFront: '#4f9ee0', blockTop: '#f4fdff', blockFront: '#3f9fdc',
    accent: '#7fd6ff', glow: '#d8f4ff', sky: ['#a9d8ff', '#eaf7ff'], backdrop: '#cfe9f8', frame: '#4b6fb0', dust: '#f4fbff',
    ambient: { kind: 'snow', colors: ['#ffffff', '#e0f3ff', '#c4e6ff'] }, debris: ['#ffffff', '#a5e3f7', '#5fb6e8'],
  },
};

// ---- Lava -----------------------------------------------------------------------------------------------

const LAVA_GLOW = ['#ff5a1a', '#ff9a2a', '#ffe08a'];

function rockFacets(g, rnd, x0, y0, x1, y1, n, base) {
  for (let i = 0; i < n; i++) {
    const cx = x0 + rnd.next() * (x1 - x0), cy = y0 + rnd.next() * (y1 - y0), r = 7 + rnd.next() * 10;
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + rnd.next() * 0.6, rr = r * (0.7 + rnd.next() * 0.5); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fillStyle = mix(base, '#000000', rnd.next() * 0.25); g.fill();
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke();
  }
}

const LAVA = {
  floor(g, parity, v) {
    const rnd = makeRng(2500 + v * 13 + parity);
    checkerFill(g, ['#4d3e59', '#42344e'], ['#3a2d46', '#2f2439'], parity);
    speckle(g, rnd, 26, 4, 4, 96, 96, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.22)', 'rgba(255,120,40,0.16)'], 0.9, 1.9);
    rockFacets(g, rnd, 8, 8, 92, 92, 3, parity ? '#3a2d46' : '#45384f');
    if (v === 1) { glowLine(g, crackPath(rnd, 8, 30, 50, 0.5, 4), LAVA_GLOW, 2.4); glowLine(g, crackPath(rnd, 56, 50, 36, 0.9, 3), LAVA_GLOW, 1.8); }
    if (v === 2) { glowLine(g, crackPath(rnd, 78, 12, 50, 2.2, 4), LAVA_GLOW, 2.2); for (let i = 0; i < 4; i++) { g.beginPath(); circle(g, 14 + rnd.next() * 70, 20 + rnd.next() * 70, 1.4 + rnd.next()); g.fillStyle = '#ffb040'; g.fill(); } }
    gridEdge(g, 0.14);
  },
  pillar(g, v) {
    const rnd = makeRng(2610 + v);
    extrude(g, {
      h: H_PILLAR, m: 3, r: 16, top: [[0, '#7a6394'], [1, '#3d2c58']], front: [[0, '#3f2e5c'], [1, '#1b1030']], line: '#0e0620',
      decorTop(c, t) {
        const cy = (t.y0 + t.y1) / 2;
        rockFacets(c, rnd, t.x0 + 8, t.y0 + 8, t.x1 - 8, t.y1 - 8, 5, '#5a4678');
        c.beginPath(); c.moveTo(24, cy + 14); c.lineTo(66, cy - 20); c.lineTo(80, cy - 20); c.lineTo(38, cy + 14); c.closePath(); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fill();
        glowLine(c, crackPath(rnd, 16 + v * 22, t.y1 - 8, 46, -1.1 + v * 0.3, 4), LAVA_GLOW, 2.2);
        for (let i = 0; i < 4; i++) { c.beginPath(); circle(c, 20 + rnd.next() * 60, cy - 14 + rnd.next() * 28, 1.2 + rnd.next() * 1.2); c.fillStyle = '#ffa030'; c.fill(); }
      },
      decorFront(c, f) {
        glowLine(c, crackPath(rnd, 26 + v * 16, f.y0 + 2, f.y1 - f.y0 - 2, Math.PI / 2, 3), LAVA_GLOW, 1.9);
        glowLine(c, crackPath(rnd, 70 - v * 8, f.y0 + 8, f.y1 - f.y0 - 10, Math.PI / 2, 3), LAVA_GLOW, 1.5);
        c.fillStyle = lin(c, 0, f.y1 - 16, 0, f.y1, [[0, 'rgba(255,110,30,0)'], [1, 'rgba(255,110,30,0.55)']]); c.fillRect(f.x0, f.y1 - 16, f.x1 - f.x0, 16);
        c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(f.x0, f.y0, 8, f.y1 - f.y0);
      },
    });
  },
  soft(g, v) {
    const rnd = makeRng(2720 + v);
    extrude(g, {
      h: H_SOFT, m: 4, r: 14, top: [[0, '#b0604a'], [1, '#6a2e2c']], front: [[0, '#7a3730'], [1, '#3a1a20']], line: '#1e0a12',
      decorTop(c, t) {
        rockFacets(c, rnd, t.x0 + 6, t.y0 + 6, t.x1 - 6, t.y1 - 6, 6, '#8e4a3c');
        glowLine(c, crackPath(rnd, 18 + v * 6, t.y0 + 14, 60, 0.4 + v * 0.35, 5), LAVA_GLOW, 2.4);
        glowLine(c, crackPath(rnd, 80 - v * 6, t.y1 - 12, 40, -2.4, 3), LAVA_GLOW, 1.8);
        c.beginPath(); ellipse(c, 30, t.y0 + 16, 20, 6, -0.3); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fill();
      },
      decorFront(c, f) {
        rockFacets(c, rnd, f.x0 + 6, f.y0 + 4, f.x1 - 6, f.y1 - 4, 4, '#5e2a2a');
        glowLine(c, crackPath(rnd, 22 + v * 10, f.y0 + 2, f.y1 - f.y0, Math.PI / 2 + 0.3, 3), LAVA_GLOW, 2.2);
        glowLine(c, crackPath(rnd, 66, f.y0 + 4, f.y1 - f.y0 - 6, Math.PI / 2 - 0.4, 3), LAVA_GLOW, 1.7);
        c.fillStyle = lin(c, 0, f.y1 - 12, 0, f.y1, [[0, 'rgba(255,110,30,0)'], [1, 'rgba(255,110,30,0.4)']]); c.fillRect(f.x0, f.y1 - 12, f.x1 - f.x0, 12);
      },
    });
  },
  border(g, v) {
    const rnd = makeRng(2830 + v);
    extrude(g, {
      h: H_BORDER, m: 0, r: 6, lw: 3.6, top: [[0, '#4d3a5e'], [1, '#2a1d38']], front: [[0, '#33244a'], [1, '#170e26']], line: '#0a0414',
      decorTop(c, t) {
        rockFacets(c, rnd, 4, t.y0 + 4, 96, t.y1 - 4, 7, '#43325a');
        glowLine(c, [[0, t.y0 + 30 + v * 8], [30, t.y0 + 26], [52, t.y0 + 36], [100, t.y0 + 28 + v * 6]], LAVA_GLOW, 1.8);
      },
      decorFront(c, f) {
        rockFacets(c, rnd, 4, f.y0 + 2, 96, f.y1 - 2, 4, '#2c1f40');
        glowLine(c, crackPath(rnd, 20 + v * 20, f.y0 + 2, f.y1 - f.y0, Math.PI / 2, 2), LAVA_GLOW, 1.6);
        c.fillStyle = lin(c, 0, f.y1 - 10, 0, f.y1, [[0, 'rgba(255,110,30,0)'], [1, 'rgba(255,110,30,0.4)']]); c.fillRect(0, f.y1 - 10, 100, 10);
      },
    });
  },
  debris(g, v) {
    g.rotate(v * 1.6);
    g.beginPath(); g.moveTo(-13, -4); g.lineTo(-2, -13); g.lineTo(12, -6); g.lineTo(10, 8); g.lineTo(-8, 10); g.closePath();
    fillLine(g, lin(g, -12, -12, 12, 10, [[0, '#9a5a48'], [1, '#3a1a20']]), '#1e0a12', 3);
    g.beginPath(); g.moveTo(-6, -2); g.lineTo(4, 4); g.lineWidth = 2.4; g.strokeStyle = '#ffa030'; g.stroke();
  },
  palette: {
    label: 'Lava', floorA: '#43364f', floorB: '#2f2439', wallTop: '#7a6394', wallFront: '#1b1030', blockTop: '#b0604a', blockFront: '#3a1a20',
    accent: '#ff9a2a', glow: '#ffb060', sky: ['#4a1a3a', '#150a1e'], backdrop: '#2a1226', frame: '#170e26', dust: '#8a7a96',
    ambient: { kind: 'embers', colors: ['#ff9a2a', '#ffcf5a', '#ff5a1a'] }, debris: ['#9a5a48', '#5a2a2a', '#ffa030'],
  },
};

// ---- Candy ----------------------------------------------------------------------------------------------

const SPRINKLE_COLORS = ['#ff4d8f', '#3dc3e8', '#ffd21f', '#7be36a', '#a55eea', '#ffffff'];

function sprinkle(g, x, y, ang, color) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); rrect(g, -6, -2.3, 12, 4.6, 2.3); fillLine(g, color, 'rgba(90,30,70,0.45)', 1.2);
  g.restore();
}

function stripes(g, x0, y0, x1, y1, w, c1, c2, slope = 1) {
  g.fillStyle = c2; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = c1;
  for (let x = x0 - (y1 - y0) * slope; x < x1 + (y1 - y0); x += w * 2) {
    g.beginPath(); g.moveTo(x, y1); g.lineTo(x + w, y1); g.lineTo(x + w + (y1 - y0) * slope, y0); g.lineTo(x + (y1 - y0) * slope, y0); g.closePath(); g.fill();
  }
}

const GUMMY = ['#ff5d8f', '#7ed957', '#ffd93d', '#a86bff'];

const CANDY = {
  floor(g, parity, v) {
    const rnd = makeRng(3500 + v * 13 + parity);
    checkerFill(g, ['#fff2f8', '#ffe2f1'], ['#ffd2e8', '#ffc0de'], parity);
    if (v === 0) { speckle(g, rnd, 18, 4, 4, 96, 96, ['rgba(255,255,255,0.8)', 'rgba(255,120,180,0.22)'], 1, 2); }
    if (v === 1) {
      for (let i = 0; i < 6; i++) sprinkle(g, 12 + rnd.next() * 76, 12 + rnd.next() * 76, rnd.next() * Math.PI, SPRINKLE_COLORS[(i + parity) % 6]);
    }
    if (v === 2) {
      g.beginPath(); circle(g, 50, 50, 24); g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.stroke();
      g.beginPath(); circle(g, 50, 50, 12); g.stroke();
      for (let i = 0; i < 3; i++) sprinkle(g, 14 + rnd.next() * 72, 14 + rnd.next() * 72, rnd.next() * Math.PI, SPRINKLE_COLORS[(i * 2) % 6]);
    }
    gridEdge(g, 0.05);
  },
  pillar(g, v) {
    const stripe = ['#ff3d6b', '#2fc9a2', '#ff9a3d'][v], line = mix(stripe, '#4a1050', 0.6);   // strawberry, mint and orange canes
    extrude(g, {
      h: H_PILLAR, m: 3, r: 24, top: [[0, '#ffffff'], [1, mix('#ffffff', stripe, 0.22)]], front: [[0, '#ffffff'], [1, mix('#ffffff', stripe, 0.35)]], line,
      decorTop(c, t) {
        const cy = (t.y0 + t.y1) / 2;
        c.save(); c.beginPath(); circle(c, 50, cy, 34); c.clip();
        c.translate(50, cy); c.rotate(v * 0.5);
        for (let i = 0; i < 12; i++) { c.rotate(TAU / 12); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 40, -0.13, 0.13 + 0.16); c.closePath(); c.fillStyle = i % 2 ? '#ffffff' : stripe; c.fill(); }
        c.restore();
        c.beginPath(); circle(c, 50, cy, 34); ink2(c, line, 3);
        c.beginPath(); circle(c, 50, cy, 6); fillLine(c, rad(c, 48, cy - 2, 0, 50, cy, 6, [[0, '#ffffff'], [1, mix('#ffffff', stripe, 0.4)]]), line, 2);
        c.beginPath(); ellipse(c, 32, cy - 20, 12, 5, -0.6); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
      },
      decorFront(c, f) {
        stripes(c, f.x0, f.y0, f.x1, f.y1, 15, stripe, '#ffffff', 0.9);
        c.fillStyle = lin(c, f.x0, 0, f.x1, 0, [[0, 'rgba(255,255,255,0.5)'], [0.25, 'rgba(255,255,255,0.05)'], [0.7, 'rgba(120,20,60,0)'], [1, 'rgba(120,20,60,0.38)']]);
        c.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
      },
    });
  },
  soft(g, v) {
    const rnd = makeRng(3720 + v);
    const col = ramp(GUMMY[v]);
    extrude(g, {
      h: H_SOFT, m: 4, r: 15, top: [[0, col.glint], [0.5, col.hi], [1, col.base]], front: [[0, col.base], [1, col.lo]], line: col.deep,
      decorTop(c, t) {
        const H = t.y1 - t.y0, cy = (t.y0 + t.y1) / 2;
        c.beginPath(); ellipse(c, 50, cy + 4, 34, H * 0.36); c.fillStyle = rad(c, 50, cy, 0, 50, cy, 38, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]); c.fill();
        c.beginPath(); ellipse(c, 30, t.y0 + 16, 17, 6.4, -0.35); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
        for (let i = 0; i < 16; i++) { c.beginPath(); circle(c, 10 + rnd.next() * 80, t.y0 + 8 + rnd.next() * (H - 16), 0.8 + rnd.next() * 1.2); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill(); }
      },
      decorFront(c, f) {
        c.fillStyle = lin(c, 0, f.y0, 0, f.y1, [[0, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]); c.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
        c.beginPath(); ellipse(c, 26, f.y0 + 12, 12, 4.4, -0.2); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
        for (let i = 0; i < 8; i++) { c.beginPath(); circle(c, 10 + rnd.next() * 80, f.y0 + 6 + rnd.next() * (f.y1 - f.y0 - 12), 0.8 + rnd.next()); c.fillStyle = 'rgba(255,255,255,0.75)'; c.fill(); }
      },
    });
  },
  border(g, v) {
    const rnd = makeRng(3830 + v);
    extrude(g, {
      h: H_BORDER, m: 0, r: 6, lw: 3.6, top: [[0, '#a7684a'], [1, '#6e3a26']], front: [[0, '#84492f'], [1, '#54291a']], line: '#3a1a0e',
      decorTop(c, t) {
        c.fillStyle = 'rgba(255,255,255,0.14)';
        c.strokeStyle = 'rgba(60,25,10,0.5)'; c.lineWidth = 2.4;
        const H = t.y1 - t.y0;
        c.beginPath(); c.moveTo(0, t.y0 + H / 2); c.lineTo(100, t.y0 + H / 2); c.moveTo(50, t.y0); c.lineTo(50, t.y1); c.stroke();
        // pink frosting with a wavy lower edge
        c.beginPath(); c.moveTo(0, t.y0); c.lineTo(100, t.y0); c.lineTo(100, t.y0 + H * 0.5);
        for (let x = 100; x >= 0; x -= 20) c.quadraticCurveTo(x - 5, t.y0 + H * 0.5 + 9 + ((x / 20 + v) % 2) * 4, x - 10, t.y0 + H * 0.5);
        c.closePath(); c.fillStyle = lin(c, 0, t.y0, 0, t.y0 + H * 0.65, [[0, '#ffd0e6'], [1, '#ff8fc0']]); c.fill(); ink2(c, 'rgba(130,30,80,0.55)', 2);
        for (let i = 0; i < 4; i++) sprinkle(c, 10 + rnd.next() * 80, t.y0 + 8 + rnd.next() * (H * 0.4), rnd.next() * Math.PI, SPRINKLE_COLORS[(i + v) % 6]);
      },
      decorFront(c, f) {
        c.strokeStyle = 'rgba(40,15,5,0.5)'; c.lineWidth = 2.4;
        c.beginPath(); c.moveTo(0, (f.y0 + f.y1) / 2); c.lineTo(100, (f.y0 + f.y1) / 2); c.moveTo(34, f.y0); c.lineTo(34, f.y1); c.moveTo(68, f.y0); c.lineTo(68, f.y1); c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.13)'; for (const x of [0, 34, 68]) c.fillRect(x + 2, f.y0 + 2, 30, 5);
        c.beginPath(); c.moveTo(0, f.y0); for (let x = 0; x <= 100; x += 25) { const d = 5 + ((x / 25 + v) % 3) * 4; c.lineTo(x + 8, f.y0 + d); c.quadraticCurveTo(x + 12.5, f.y0 + d + 5, x + 17, f.y0 + d); }
        c.lineTo(100, f.y0); c.closePath(); c.fillStyle = '#ffb0d2'; c.fill();
      },
    });
  },
  debris(g, v) {
    g.rotate(v * 1.2);
    const c = ramp(GUMMY[v]);
    g.beginPath(); rrect(g, -11, -9, 22, 18, 6); fillLine(g, lin(g, -10, -9, 10, 9, [[0, c.glint], [0.5, c.base], [1, c.lo]]), c.deep, 2.8);
    g.beginPath(); ellipse(g, -4, -4, 5, 2.4, -0.4); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
  },
  palette: {
    label: 'Candy', floorA: '#fff0f7', floorB: '#ffcbe5', wallTop: '#ffffff', wallFront: '#ffb0c8', blockTop: '#ff8fb0', blockFront: '#c8365e',
    accent: '#ff4d8f', glow: '#ffd0e6', sky: ['#ffc2e2', '#fff0f7'], backdrop: '#ffb8da', frame: '#6e3a26', dust: '#ffe9f4',
    ambient: { kind: 'sprinkles', colors: SPRINKLE_COLORS }, debris: ['#ff5d8f', '#7ed957', '#ffd93d', '#a86bff'],
  },
};

// ---- Night ----------------------------------------------------------------------------------------------

const NEON = ['#37f0ff', '#8ff7ff', '#ffffff'];
const NEON_PINK = ['#ff3df0', '#ff8ff8', '#ffffff'];

const NIGHT = {
  floor(g, parity, v) {
    const rnd = makeRng(4500 + v * 13 + parity);
    checkerFill(g, ['#27316f', '#1f285f'], ['#1a2152', '#131944'], parity);
    g.strokeStyle = 'rgba(70,110,255,0.32)'; g.lineWidth = 1.8;
    g.strokeRect(1, 1, 98, 98);
    speckle(g, rnd, 10, 6, 6, 94, 94, ['rgba(140,170,255,0.55)', 'rgba(255,255,255,0.4)'], 0.6, 1.3);
    if (v === 1) { glint(g, 30 + rnd.next() * 40, 30 + rnd.next() * 40, 7, '#bfe4ff'); glint(g, 76, 74, 4, '#ffd9ff'); }
    if (v === 2) {
      g.strokeStyle = 'rgba(80,140,255,0.5)'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(18, 82); g.lineTo(18, 56); g.lineTo(42, 56); g.lineTo(42, 34); g.lineTo(76, 34); g.stroke();
      blob(g, 76, 34, 3, '#37f0ff', 'rgba(255,255,255,0.7)', 1); blob(g, 18, 82, 3, '#ff3df0', 'rgba(255,255,255,0.7)', 1);
    }
    gridEdge(g, 0.2);
  },
  pillar(g, v) {
    extrude(g, {
      h: H_PILLAR, m: 3, r: 15, top: [[0, '#4a5aa8'], [1, '#232b66']], front: [[0, '#242c66'], [1, '#0e1236']], line: '#080a22',
      decorTop(c, t) {
        const cy = (t.y0 + t.y1) / 2;
        c.beginPath(); rrect(c, 17, t.y0 + 17, 66, t.y1 - t.y0 - 34, 9); c.fillStyle = lin(c, 0, t.y0, 0, t.y1, [[0, '#1a2052'], [1, '#2e3a80']]); c.fill();
        c.beginPath(); rrect(c, 17, t.y0 + 17, 66, t.y1 - t.y0 - 34, 9); c.lineWidth = 6; c.strokeStyle = 'rgba(55,240,255,0.25)'; c.stroke(); c.lineWidth = 2.4; c.strokeStyle = '#37f0ff'; c.stroke();
        glint(c, 50, cy, 9, '#ffffff');
      },
      decorFront(c, f) {
        const y = (f.y0 + f.y1) / 2 + 2;
        glowLine(c, [[f.x0 + 4, y], [f.x1 - 4, y]], v % 2 ? NEON_PINK : NEON, 2.6);
        for (const x of [24, 50, 76]) { c.beginPath(); rrect(c, x - 5, y + 8, 10, 6, 2); c.fillStyle = 'rgba(55,240,255,0.55)'; c.fill(); }
        c.fillStyle = lin(c, 0, f.y1 - 14, 0, f.y1, [[0, 'rgba(55,240,255,0)'], [1, 'rgba(55,240,255,0.25)']]); c.fillRect(f.x0, f.y1 - 14, f.x1 - f.x0, 14);
      },
    });
  },
  soft(g, v) {
    const glow = [['#ff3df0', '#ff8ff8'], ['#37f0ff', '#8ff7ff'], ['#9dff3d', '#d6ff8f'], ['#ffb02e', '#ffe08a']][v];
    extrude(g, {
      h: H_SOFT, m: 4, r: 12, top: [[0, '#5a4aa8'], [1, '#2b2266']], front: [[0, '#3a2c80'], [1, '#180f45']], line: '#0b0626',
      decorTop(c, t) {
        const H = t.y1 - t.y0, cy = (t.y0 + t.y1) / 2;
        c.beginPath(); circle(c, 50, cy, 36); c.fillStyle = rad(c, 50, cy, 0, 50, cy, 36, [[0, rgba(glow[0], 0.55)], [1, rgba(glow[0], 0)]]); c.fill();
        c.beginPath(); rrect(c, 12, t.y0 + 12, 76, H - 24, 8); c.lineWidth = 2.6; c.strokeStyle = 'rgba(0,0,0,0.35)'; c.stroke();
        glowLine(c, [[14, t.y0 + 14], [86, t.y1 - 14]], [glow[0], glow[1], '#ffffff'], 2.4);
        glowLine(c, [[86, t.y0 + 14], [14, t.y1 - 14]], [glow[0], glow[1], '#ffffff'], 2.4);
        for (const [nx, ny] of [[16, t.y0 + 16], [84, t.y0 + 16], [16, t.y1 - 16], [84, t.y1 - 16]]) blob(c, nx, ny, 2.6, glow[1], 'rgba(255,255,255,0.8)', 1);
      },
      decorFront(c, f) {
        c.fillStyle = rgba(glow[0], 0.18); c.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
        for (const x of [26, 50, 74]) { c.beginPath(); rrect(c, x - 3.5, f.y0 + 5, 7, f.y1 - f.y0 - 10, 3.5); c.fillStyle = rgba(glow[0], 0.5); c.fill(); glowLine(c, [[x, f.y0 + 7], [x, f.y1 - 7]], [glow[0], glow[1], '#ffffff'], 1.6); }
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(f.x0, f.y0, f.x1 - f.x0, 4);
      },
    });
  },
  border(g, v) {
    const rnd = makeRng(4830 + v);
    extrude(g, {
      h: H_BORDER, m: 0, r: 6, lw: 3.6, top: [[0, '#2a3474'], [1, '#161c4e']], front: [[0, '#1c2258'], [1, '#0b0f30']], line: '#05071a',
      decorTop(c, t) {
        glowLine(c, [[0, t.y1 - 8], [100, t.y1 - 8]], NEON, 2.4);
        speckle(c, rnd, 12, 4, t.y0 + 4, 96, t.y1 - 16, ['rgba(140,170,255,0.55)', 'rgba(255,255,255,0.5)'], 0.6, 1.2);
        if (v === 1) glint(c, 30, t.y0 + 20, 6, '#ffffff');
      },
      decorFront(c, f) {
        c.strokeStyle = 'rgba(70,110,255,0.35)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, f.y0 + 4); c.lineTo(100, f.y0 + 4); c.moveTo(33, f.y0 + 4); c.lineTo(33, f.y1); c.moveTo(66, f.y0 + 4); c.lineTo(66, f.y1); c.stroke();
        for (const x of [16, 50, 84]) { blob(c, x, f.y0 + 16 + ((x + v) % 3) * 2, 2.6, v === (x % 3) ? '#ff3df0' : '#37f0ff', 'rgba(255,255,255,0.8)', 1); }
      },
    });
  },
  debris(g, v) {
    g.rotate(v * 1.4);
    g.beginPath(); g.moveTo(-12, -6); g.lineTo(2, -14); g.lineTo(13, 3); g.lineTo(-4, 11); g.closePath();
    fillLine(g, lin(g, -12, -12, 12, 10, [[0, '#6a5ac8'], [1, '#231a66']]), '#37f0ff', 2.6);
    g.beginPath(); g.moveTo(-6, -4); g.lineTo(4, 3); g.lineWidth = 2; g.strokeStyle = '#ff8ff8'; g.stroke();
  },
  palette: {
    label: 'Night', floorA: '#232c68', floorB: '#141a45', wallTop: '#4a5aa8', wallFront: '#0e1236', blockTop: '#5a4aa8', blockFront: '#180f45',
    accent: '#37f0ff', glow: '#8ff7ff', sky: ['#0b0f33', '#1d1450'], backdrop: '#0d1136', frame: '#0b0f30', dust: '#8aa0ff',
    ambient: { kind: 'stars', colors: ['#ffffff', '#bfe4ff', '#ffd9ff'] }, debris: ['#6a5ac8', '#231a66', '#37f0ff'],
  },
};

const THEME_ART = { meadow: MEADOW, frost: FROST, lava: LAVA, candy: CANDY, night: NIGHT };
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
for (const name of THEMES) THEME_PALETTES[name] = deepFreeze(THEME_ART[name].palette);
Object.freeze(THEME_PALETTES);

// ---- Backdrop (the area around the arena) ----------------------------------------------------------------

function drawBackdrop(g, theme, size) {
  const pal = THEME_PALETTES[theme], rnd = makeRng(9000 + THEMES.indexOf(theme));
  g.fillStyle = pal.backdrop;
  g.fillRect(0, 0, size, size);
  const wrap = (x, y, r, draw) => {   // draw a motif and its wrapped copies so the pattern tiles
    for (const ox of [0, -size, size]) for (const oy of [0, -size, size]) {
      if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
      g.save(); g.translate(x + ox, y + oy); draw(); g.restore();
    }
  };
  const n = 26;
  for (let i = 0; i < n; i++) {
    const x = rnd.next() * size, y = rnd.next() * size, k = rnd.next();
    if (theme === 'meadow') wrap(x, y, 40, () => { if (k < 0.5) tuft(g, 0, 0, 2.2, '#4f9f3a', '#9bea62'); else flower(g, 0, 0, 7 + k * 4, k < 0.75 ? '#ffffff' : '#ffd6ec', '#ffd23f'); });
    else if (theme === 'frost') wrap(x, y, 40, () => { if (k < 0.6) snowflake(g, 0, 0, 14 + k * 18, 'rgba(255,255,255,0.75)', 2.4); else glint(g, 0, 0, 10 + k * 10, '#ffffff'); });
    else if (theme === 'lava') wrap(x, y, 60, () => { if (k < 0.5) glowLine(g, crackPath(rnd, 0, 0, 60 + k * 60, k * 6, 4), LAVA_GLOW, 2.4); else { g.beginPath(); circle(g, 0, 0, 2 + k * 3); g.fillStyle = '#ff9a2a'; g.fill(); } });
    else if (theme === 'candy') wrap(x, y, 40, () => { if (k < 0.7) sprinkle(g, 0, 0, k * 9, SPRINKLE_COLORS[i % 6]); else { g.beginPath(); circle(g, 0, 0, 18); g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.6)'; g.stroke(); } });
    else wrap(x, y, 30, () => { if (k < 0.7) { g.beginPath(); circle(g, 0, 0, 1.2 + k * 2); g.fillStyle = '#ffffff'; g.fill(); } else glint(g, 0, 0, 5 + k * 7, '#bfe4ff'); });
  }
}

// ================================================================================================
// Sudden-death wall, cast shadow, emote bubbles
// ================================================================================================

/** The hazard block that falls during sudden death: steel with warning stripes and a bold X. */
function drawSuddenWall(g) {
  extrude(g, {
    h: H_PILLAR, m: 3, r: 14, top: [[0, '#6a6f8c'], [1, '#2c3048']], front: [[0, '#40455e'], [1, '#1c1f33']], line: '#0c0d1a',
    decorTop(c, t) {
      const cy = (t.y0 + t.y1) / 2;
      c.save(); c.beginPath(); rrect(c, 8, t.y0 + 8, 84, t.y1 - t.y0 - 16, 10); c.clip();
      stripes(c, 8, t.y0 + 8, 92, t.y1 - 8, 9, '#ffc21f', '#23253a', 0.7);
      c.restore();
      c.beginPath(); rrect(c, 8, t.y0 + 8, 84, t.y1 - t.y0 - 16, 10); ink2(c, '#0c0d1a', 3);
      c.beginPath(); rrect(c, 22, t.y0 + 22, 56, t.y1 - t.y0 - 44, 8); fillLine(c, lin(c, 0, t.y0, 0, t.y1, [[0, '#4a4f6c'], [1, '#22253a']]), '#0c0d1a', 3);
      c.beginPath(); c.moveTo(34, cy - 16); c.lineTo(66, cy + 16); c.moveTo(66, cy - 16); c.lineTo(34, cy + 16);
      c.lineCap = 'round'; c.lineWidth = 13; c.strokeStyle = '#0c0d1a'; c.stroke();
      c.lineWidth = 8; c.strokeStyle = lin(c, 0, cy - 16, 0, cy + 16, [[0, '#ff7a6a'], [1, '#e8283e']]); c.stroke();
    },
    decorFront(c, f) {
      stripes(c, f.x0, f.y0, f.x1, f.y1, 10, '#ffc21f', '#23253a', 0.8);
      c.fillStyle = lin(c, 0, f.y0, 0, f.y1, [[0, 'rgba(255,255,255,0.18)'], [1, 'rgba(0,0,20,0.35)']]); c.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
    },
  });
}

/** Soft shadow a block casts to its right and below it (origin = the block's tile top-left). */
function drawBlockShadow(g) {
  g.fillStyle = lin(g, 92, 0, 142, 0, [[0, rgba(SHADOW_INK, 0.36)], [0.5, rgba(SHADOW_INK, 0.14)], [1, rgba(SHADOW_INK, 0)]]);
  g.fillRect(92, 8, 50, 100);
  g.fillStyle = lin(g, 0, 94, 0, 116, [[0, rgba(SHADOW_INK, 0.36)], [1, rgba(SHADOW_INK, 0)]]);
  g.fillRect(4, 94, 96, 22);
  g.beginPath(); ellipse(g, 98, 100, 22, 16); g.fillStyle = rad(g, 98, 100, 0, 98, 100, 22, [[0, rgba(SHADOW_INK, 0.3)], [1, rgba(SHADOW_INK, 0)]]); g.fill();
}

export const SOFT_POP_FRAMES = 3;
const POP_PAD = 34;   // room around the block for flying shards

/** Jagged shards that partition a block sprite (origin = tile top-left, the block reaches `h` above it). */
function popShards(h) {
  const c = [52, 42 - h / 2];
  const edge = [[0, -h], [38, -h], [100, -h], [100, 34], [100, 100], [58, 100], [0, 100], [0, 30]];
  return [[0, 1], [1, 2, 3], [3, 4, 5], [5, 6, 7], [7, 0]].map((idx) => {
    const pts = [...idx.map((i) => edge[i]), c];
    const cx = pts.reduce((n, q) => n + q[0], 0) / pts.length, cy = pts.reduce((n, q) => n + q[1], 0) / pts.length;
    const len = Math.hypot(cx - c[0], cy - c[1]) || 1;
    return { pts, dx: (cx - c[0]) / len, dy: (cy - c[1]) / len, spin: (cx - c[0]) * 0.006 + 0.2 };
  });
}

/**
 * A crate bursting apart: frame 0 is a white-hot swell, later frames scatter the shards while they shrink and fade.
 * `layer` holds the intact block; the sprite anchor is the tile's top-left corner.
 */
function drawPop(g, env, layer, h, frame) {
  const { s } = env, t = (frame + 0.5) / SOFT_POP_FRAMES;
  const draw = () => g.drawImage(layer.canvas, -layer.ax / s, -layer.ay / s, layer.canvas.width / s, layer.canvas.height / s);
  if (frame === 0) {
    g.save(); g.translate(50, 50 - h / 2); g.scale(1.08, 1.08); g.translate(-50, -(50 - h / 2)); draw();
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,250,225,0.42)'; g.fillRect(-10, -h - 10, 120, h + 120);
    g.restore();
    return;
  }
  for (const shard of popShards(h)) {
    g.save();
    g.globalAlpha = 1 - t * t * 0.9;
    const d = 40 * t;
    g.translate(shard.dx * d, shard.dy * d + 16 * t * t);
    g.translate(52, 42 - h / 2); g.rotate(shard.spin * t * 2); g.scale(1 - 0.32 * t, 1 - 0.32 * t); g.translate(-52, -(42 - h / 2));
    g.beginPath(); shard.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip();
    draw();
    g.restore();
  }
}

/** Speech bubble whose tail tip is the origin; `icon` is centred in it. */
function drawEmoteBubble(g, icon) {
  g.beginPath();
  g.moveTo(-12, -14);
  g.lineTo(-46 + 16, -14);
  g.arcTo(-46, -14, -46, -14 - 16, 16);
  g.lineTo(-46, -84 + 16); g.arcTo(-46, -84, -46 + 16, -84, 16);
  g.lineTo(46 - 16, -84); g.arcTo(46, -84, 46, -84 + 16, 16);
  g.lineTo(46, -14 - 16); g.arcTo(46, -14, 46 - 16, -14, 16);
  g.lineTo(12, -14); g.quadraticCurveTo(4, -14, 0, 0); g.quadraticCurveTo(-4, -14, -12, -14);
  g.closePath();
  g.save(); g.translate(0, 5); g.fillStyle = rgba(SHADOW_INK, 0.25); g.fill(); g.restore();
  fillLine(g, lin(g, 0, -84, 0, -14, [[0, '#ffffff'], [1, '#e4e0f5']]), INK, 4.6);
  g.beginPath(); ellipse(g, -22, -76, 14, 3.6, -0.1); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
  g.save(); g.translate(0, -49); g.scale(0.62, 0.62); ICONS[icon](g); g.restore();
}

// ================================================================================================
// Build orchestration
// ================================================================================================

export const SHIELD_FRAMES = 4;
export const CURSE_AURA_FRAMES = 8;
const SPAWN_SHIELD_TINT = '#ffe58a', SHIELD_TINT = '#5bd6ff';

/** Theme-independent sprites: characters, bombs, flames, items, bubbles, rings, emotes, particle textures. */
function buildActors(env) {
  const atlas = new Atlas(env);
  const a = { atlas, refs: 0 };
  a.characters = PLAYER_COLORS.map((_, i) => buildCharacter(atlas, i));
  a.bombs = buildBombs(atlas);
  a.flames = buildFlames(atlas);
  a.items = buildItems(atlas);
  a.fx = buildFx(atlas);
  a.shield = []; a.spawnShield = []; a.curseAura = [];
  for (let k = 0; k < SHIELD_FRAMES; k++) {
    a.shield.push(atlas.add(128, 128, 64, 64, (g) => drawBubble(g, SHIELD_TINT, k / SHIELD_FRAMES)));
    a.spawnShield.push(atlas.add(128, 128, 64, 64, (g) => drawBubble(g, SPAWN_SHIELD_TINT, k / SHIELD_FRAMES)));
  }
  for (let k = 0; k < CURSE_AURA_FRAMES; k++) a.curseAura.push(atlas.add(142, 106, 71, 54, (g) => drawCurseAura(g, k / CURSE_AURA_FRAMES)));
  a.teamRing = [atlas.add(112, 66, 56, 33, (g) => drawTeamRing(g, TEAM_COLORS[0], false)), atlas.add(112, 66, 56, 33, (g) => drawTeamRing(g, TEAM_COLORS[1], true))];
  a.emotes = [...EMOTE_ICONS, ...EXTRA_EMOTE_ICONS].map((icon) => atlas.add(108, 96, 54, 92, (g) => drawEmoteBubble(g, icon)));
  atlas.queueCompaction();
  atlas.seal();
  return a;
}

/** Theme-dependent sprites: floor, walls, blocks, borders, debris, the cast shadow and the backdrop pattern. */
function buildTerrain(env, theme) {
  const art = THEME_ART[theme];
  const atlas = new Atlas(env);
  const t = { atlas, backdrop: { canvas: null, size: BACKDROP_TILES * env.tile } };
  const seeded = (n, mk) => Array.from({ length: n }, (_, v) => mk(v));
  t.floor = [0, 1].map((parity) => seeded(FLOOR_VARIANTS, (v) => atlas.add(100, 100, 0, 0, (g) => art.floor(g, parity, v))));
  const tall = (h, draw) => atlas.add(100, 100 + h, 0, h, draw);
  t.hardWall = seeded(PILLAR_VARIANTS, (v) => tall(H_PILLAR, (g) => art.pillar(g, v)));
  t.softBlock = seeded(SOFT_VARIANTS, (v) => tall(H_SOFT, (g) => art.soft(g, v)));
  t.border = seeded(BORDER_VARIANTS, (v) => tall(H_BORDER, (g) => art.border(g, v)));
  t.suddenWall = tall(H_PILLAR, drawSuddenWall);
  t.blockShadow = atlas.add(145, 118, 0, 0, drawBlockShadow);
  let intact = null;   // scratch copies of the crates the pop frames are cut from (an atlas page must not be read while it is written)
  atlas.job((_, e) => {
    const ay = Math.round(H_SOFT * e.s);
    intact = seeded(SOFT_VARIANTS, (v) => {
      const canvas = e.createCanvas(e.tile, Math.ceil((100 + H_SOFT) * e.s - 1e-6));
      const g = canvas.getContext('2d');
      g.translate(0, ay); g.scale(e.s, e.s);
      art.soft(g, v);
      return { canvas, ax: 0, ay };
    });
  });
  t.softPop = seeded(SOFT_VARIANTS, (v) => seeded(SOFT_POP_FRAMES, (f) => atlas.add(100 + 2 * POP_PAD, 100 + H_SOFT + 2 * POP_PAD, POP_PAD, POP_PAD + H_SOFT, (g, e) => drawPop(g, e, intact[v], H_SOFT, f))));
  atlas.job(() => { for (const l of intact) releaseCanvas(l.canvas); intact = null; });
  t.debris = seeded(DEBRIS_VARIANTS, (v) => atlas.add(44, 44, 22, 22, (g) => art.debris(g, v)));
  t.dust = seeded(2, (v) => atlas.add(100, 100, 50, 50, (g) => drawSmoke(g, 31 + v * 9, art.palette.dust)));
  atlas.job((_, e) => {
    const c = e.createCanvas(t.backdrop.size, t.backdrop.size);
    const g = c.getContext('2d');
    g.scale(e.s, e.s);
    drawBackdrop(g, theme, BACKDROP_TILES * UNIT);
    t.backdrop.canvas = c;
  });
  atlas.seal();
  return t;
}

/** n wrapped into 0..m-1 (animation counters just keep counting up); NaN gives 0. */
function wrapIndex(n, m) {
  const r = Math.floor(n) % m;
  return r < 0 ? r + m : r || 0;
}

/** n limited to 0..m-1 for one-shot animations. */
function clampIndex(n, m) {
  return n >= m ? m - 1 : n > 0 ? Math.floor(n) : 0;
}

const FLOOR_PICK = [0, 0, 1, 2];   // plain floor half of the time, each decorated variant a quarter; a constant so drawing allocates nothing

const actorCache = new Map();   // "tile|dpr" -> shared actor sprites, reference counted by the sets using them

/** Deterministic hash of a tile, for picking decoration variants. */
export function tileHash(tx, ty) {
  // The raw product hash only lets the low bits of tx and ty reach the low bits of the result, so `% 4` repeated the
  // crate variants in a visible 4 x 4 wallpaper; the finaliser spreads every input bit over all output bits.
  let h = Math.imul(tx + 1, 73856093) ^ Math.imul(ty + 1, 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Start building a sprite set without blocking: call `pump(ms)` from a few frames (e.g. during the countdown)
 * until it returns true, then use `.set`. `buildSpriteSet` is the blocking version.
 */
export function startSpriteBuild({ tile, theme = 'meadow', dpr = 1, createCanvas } = {}) {
  if (!Number.isFinite(tile) || tile < 8) throw new RangeError('sprites: tile must be a device-pixel size >= 8');
  tile = Math.round(tile);   // tile-sized sprites must be exactly one tile wide or the floor shows seams
  if (!THEME_ART[theme]) throw new RangeError(`sprites: unknown theme "${theme}"`);
  const env = { s: tile / UNIT, tile, dpr, createCanvas: createCanvas ?? defaultCreateCanvas };
  const key = `${tile}|${dpr}`;
  let actors = createCanvas ? null : actorCache.get(key);
  if (!actors) { actors = buildActors(env); if (!createCanvas) actorCache.set(key, actors); }
  actors.refs++;
  const terrain = buildTerrain(env, theme);
  let disposed = false;

  const set = {
    tile, theme, dpr, palette: THEME_PALETTES[theme],
    floor: terrain.floor, hardWall: terrain.hardWall, softBlock: terrain.softBlock, border: terrain.border,
    suddenWall: terrain.suddenWall, blockShadow: terrain.blockShadow, debris: terrain.debris, backdrop: terrain.backdrop,
    dust: terrain.dust, softPop: terrain.softPop,
    shield: actors.shield, spawnShield: actors.spawnShield, curseAura: actors.curseAura, teamRing: actors.teamRing, fx: actors.fx,
    get ready() { return actors.atlas.done && terrain.atlas.done; },
    /** Every canvas the sprites are drawn from (atlas pages, the backdrop pattern): the first draw from one uploads it to the GPU, so warm them before use. */
    get pages() {
      const out = [...actors.atlas.pages, ...terrain.atlas.pages].map((p) => p.canvas).filter(Boolean);
      if (terrain.backdrop.canvas) out.push(terrain.backdrop.canvas);
      return out;
    },
    /** Approximate canvas memory of this set in pixels (shared actor pages included). */
    get pixels() { return actors.atlas.pixels + terrain.atlas.pixels + (terrain.backdrop.canvas ? terrain.backdrop.size ** 2 : 0); },
    floorAt(tx, ty) { return terrain.floor[(tx + ty) & 1][FLOOR_PICK[tileHash(tx, ty) & 3]]; },
    hardWallAt(tx, ty) { return terrain.hardWall[tileHash(tx, ty) % PILLAR_VARIANTS]; },
    softBlockAt(tx, ty) { return terrain.softBlock[tileHash(tx, ty) % SOFT_VARIANTS]; },
    /** The crate at (tx, ty) bursting apart, frame 0..SOFT_POP_FRAMES-1; draw at the tile's top-left corner (it overflows the tile). */
    softPopAt(tx, ty, frame) { return terrain.softPop[tileHash(tx, ty) % SOFT_VARIANTS][clampIndex(frame, SOFT_POP_FRAMES)]; },
    borderAt(tx, ty) { return terrain.border[tileHash(tx, ty) % BORDER_VARIANTS]; },
    /** colorIndex 0..7, or -1 for an orphaned bomb; phase 0..3 (BOMB_PULSE); hot = red blink of the last half second. */
    bomb(colorIndex, phase, hot = false) {
      const ci = colorIndex >= 0 && colorIndex < PLAYER_COLORS.length ? Math.floor(colorIndex) : PLAYER_COLORS.length;   // anything else is drawn as an orphan
      return actors.bombs.byColor[ci][hot ? 1 : 0][wrapIndex(phase, BOMB_PULSE.length)];
    },
    /** mask 0..15 (bit 1 up, 2 right, 4 down, 8 left), frame 0..FLAME_FRAMES-1. */
    flame(mask, frame) { return actors.flames[mask & 15][wrapIndex(frame, FLAME_FRAMES)]; },
    item(kind) { return actors.items.tokens[kind]; },
    itemGlow(kind) { return actors.items.glows[kind]; },
    /** { idle[4], blink[4], walk[4][WALK_FRAMES], cheer[4], death[6], flash[4], ghost[2] }, arrays indexed by facing 0 up, 1 right, 2 down, 3 left. */
    character(colorIndex) { return actors.characters[colorIndex]; },
    /** Speech bubble for emote index 0..7 (EMOTES order) or 8..11 (GG, heart, cry, cool). */
    emote(index) { return actors.emotes[index]; },
    dispose() {
      if (disposed) return;
      disposed = true;
      terrain.atlas.dispose();
      if (terrain.backdrop.canvas) { releaseCanvas(terrain.backdrop.canvas); terrain.backdrop.canvas = null; }
      if (--actors.refs === 0) { actors.atlas.dispose(); if (actorCache.get(key) === actors) actorCache.delete(key); }
    },
  };

  return {
    set,
    /** Draw for about `budgetMs` milliseconds. Returns true once every sprite is ready. */
    pump(budgetMs = 4) {
      if (disposed) return true;
      const deadline = performance.now() + budgetMs;
      actors.atlas.pump(deadline);
      if (actors.atlas.done) terrain.atlas.pump(deadline);
      return set.ready;
    },
  };
}

/** Build a complete sprite set at once (blocking). See the header for the returned shape. */
export function buildSpriteSet(opts) {
  const build = startSpriteBuild(opts);
  build.pump(Infinity);
  return build.set;
}

/**
 * Draw a sprite so that its anchor lands on (x, y); optional scale (e.g. squash and stretch about the anchor).
 * This is the only call the render loop needs per sprite.
 */
export function drawSprite(ctx, sprite, x, y, sx = 1, sy = sx) {
  ctx.drawImage(sprite.img, sprite.x, sprite.y, sprite.w, sprite.h, x - sprite.ax * sx, y - sprite.ay * sy, sprite.w * sx, sprite.h * sy);
}
