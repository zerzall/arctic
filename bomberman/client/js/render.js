// render.js - the arena renderer of Blast Party (docs/SPEC.md section 8.2, interface in 8.1).
//
//   const renderer = new Renderer(canvas);                        // once, on the #arena canvas
//   renderer.resize(cssW, cssH, Math.min(devicePixelRatio, 2));   // from the ResizeObserver on the canvas container
//   each frame:  renderer.handleEvents(game.takeEvents(), view);  renderer.render(view, dtMs, nowMs);
//
// WHAT IT DOES
//   * Fit: 15 x 13 tiles centred in the container (pinned to the top in a portrait container, where the touch controls go underneath),
//     tile = min(96, floor(min(w / 15, h / 13))) device pixels exactly as in the spec, dpr capped by the quality level, and the canvas
//     backing store kept under 2.5 Mpx (dpr drops, below 1 if it must, and CSS scales the canvas up). The canvas fills the container; the
//     themed backdrop (slowly drifting) surrounds the arena. The 2.5-D face of the top wall row reaches 0.3 tile above the arena: it is
//     shown when the leftover height allows, else the canvas edge clips it. getArenaRect() tells the HUD where the arena is.
//   * Sprites (sprites.js) are rebuilt for a new tile size or theme in time slices while the old set keeps drawing (scaled if the layout
//     has already changed); the finished set is prepared in one frame and swapped in the next, so no frame carries the whole changeover.
//   * Draw order: backdrop, arena (floor, wall shadows and border ring: baked into one layer when the canvas memory allows, else drawn
//     piece by piece), floor-level effects (cast shadows, blast danger tint, sudden-death telegraphs, throw targets, item glows, flames),
//     then walls and everything that stands up merged by depth (row by row: an entity whose feet line is above a wall row goes first),
//     flying things, a light pass (additive flame glow), particles, and overlays (name tags, emotes, popups, banners, flash, tints).
//   * Effects come from events (handleEvents) and from watching the View (walk cycles from distance walked, fuse pulse, item pop-in ...).
//     Camera shake and screen flash obey the safety numbers of section 8.2 and are off in reduced-effects mode.
//
// PERFORMANCE RULES (measured in headless Chromium, see scripts/dev/render/perf.mjs)
//   * Everything is an axis-aligned drawImage of an atlas sprite at integer device pixels. A scaled draw costs several times a plain one
//     and a rotated one (save, rotate, restore) 20 to 100 times, so scaling is reserved for short pops and rotation for the few rolling or
//     flying bombs; flames, glows and the great majority of particles are drawn 1:1.
//   * The images a frame draws from (atlas pages, the screen canvas, the baked arena) must stay under ~10 Mpx together or Chromium's GPU
//     texture cache thrashes: sprites.js crops its atlas to the visible pixels, and the arena bake is skipped on big screens.
//   * Nothing allocates per frame: typed-array pools (particles), preallocated draw list, cached fonts, tags baked once.
//
// VIEW ASSUMPTIONS (docs/SPEC.md Appendix A.2, plus what the spec does not say)
//   * Arrays in the View are exactly as long as their content (the renderer iterates `.length`). The View is read, never written.
//   * The View carries no tick number, so item pop-in, walk cycles, death and cheer animations run on the render clock; the renderer
//     tracks ids across frames itself. Team mode is not in the View either: `view.mode === 'teams'` is honoured if the client adds it,
//     else the renderer uses the `mode` of the last setPlayers(roundMsg) hint, else it draws free-for-all (no team rings).
//   * `view.ghostBombs[i]` = { x, y } tile-centre coordinates of a local bomb the server has not confirmed yet.
//   * A new round is recognised by its countdown starting over (state 0 after another state, or the counter jumping up).
//   * A round winner is derived from the View: during ENDING/OVER the fighters still alive cheer if they are the only one (FFA) or all on
//     one team (teams); a timeout with several survivors in FFA is a draw and nobody cheers.
//   * Events are trusted only when they have all the arguments of EVENT_ARGS with finite numbers; anything else is dropped.
//
// THINGS DECIDED WHERE THE SPEC IS SILENT
//   * The "SUDDEN DEATH!" and "SHOWDOWN" banners are drawn here (canvas); the countdown digits, "GO!" and the winner banner are HUD (ui.js).
//   * The tiles a bomb about to explode will burn are tinted on the floor (its own arms, chains not predicted) so danger reads at a glance.
//   * Colour-blind help: every fighter has a different accessory (sprites.js); the local fighter also gets a golden name tag, a golden ring
//     under the feet (a bobbing arrow during the countdown), and in team mode a team ring (solid coral = team 0, dashed teal = team 1).
//   * Debug overlay (`?debug=1`): setDebug(true) draws it on the canvas (main.js can put rtt, ws state and its recent errors in
//     renderer.debugInfo), or main.js feeds debugText() to boot.js's DOM overlay.

import {
  GRID_W, GRID_H, PLAYER_COLORS, ITEM_KINDS, THEMES, STATE, EMOTES,
  DEATH_ANIM_TICKS, FLAME_TICKS, SD_WARN_TICKS, SHIELD_FOREVER, THROW_TICKS, FUSE_TICKS,
} from '../../shared/constants.js';
import {
  startSpriteBuild, drawSprite, walkFrame, THEME_PALETTES, BOMB_FUSE_TIP, BOMB_PULSE, SOFT_POP_FRAMES, EXTRA_EMOTE_ICONS, WALK_FRAMES,
} from './sprites.js';
import { EVENT_ARGS } from '../../shared/protocol.js';
import { ParticleSystem, FloatingText, RING, POOL_SIZE } from './particles.js';

// ---- Tunables -------------------------------------------------------------------------------------------------

const MAX_TILE = 96;                // device px per tile at most (arena backing store <= 1440 x 1248)
const MIN_TILE = 8;                 // sprites.js refuses smaller
const MAX_DPR = 2;
const CANVAS_BUDGET_PX = 2.5e6;     // total canvas backing store (iOS Safari is the reason)
const TOP_OVERHANG = 0.3;           // tiles: the top border row's 2.5-D top face reaches above the arena (about 0.28)
const STATIC_MARGIN = 0.45;         // tiles of shadow room around the baked arena
const QUALITY = [                   // index = quality level
  { dprCap: 1, particles: 60, glow: false, ambient: 0, sparks: 0 },
  { dprCap: 1.5, particles: 200, glow: true, ambient: 12, sparks: 1 },
  { dprCap: MAX_DPR, particles: POOL_SIZE, glow: true, ambient: 26, sparks: 2 },
];
const REDUCED_PARTICLES = 60;
const CANVAS_MEMORY_SOFT_LIMIT = 10e6;   // px: above this many canvas pixels alive (atlas + screen + baked arena) the GPU texture cache thrashes
const DANGER_TICKS = 66;            // a bomb (or a chain) this close to exploding marks the floor its blast will burn
const DANGER_ALERT_TICKS = 45;      // the local fighter's ring turns to a warning when their tile burns this soon
const NO_DANGER = 1e9;
const BOMB_CAP = 96;                // bombs considered for the danger marks (8 fighters carry at most 64)

const FLASH_MAX_ALPHA = 0.18;       // section 8.2 flash safety
const FLASH_RAMP_MS = 100;
const FLASH_DECAY_MS = 250;
const FLASH_MIN_GAP_MS = 400;
const SHAKE_MAX_PX = 6;             // css px
const SHAKE_MS = 250;

const SLOW_FRAME_MS = 24, SLOW_FRAMES = 120;       // adaptive quality: an EMA of the frame interval above this for this many frames lowers the level
const CAP_FRAME_MS = 1000 / 30, CAP_TOLERANCE_MS = 1.2, CAP_JITTER_MS = 0.6;   // ... unless the frames are steadily 30 Hz apart (a capped display)
const TICK_MS = 1000 / 60;
const REVIVE_GRACE_MS = 400;        // a `death` event is trusted over a View that still says alive for this long (snapshots lag events)
const DYING_TICKS = 36;             // a defeated fighter's own body: hurt flash, dizzy spin, gone in a poof ...
const GHOST_FROM_TICKS = 28;        // ... and the ghost floats up from here until DEATH_ANIM_TICKS
const DIR4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const TAU = Math.PI * 2;
const FONT = '"Baloo 2","Fredoka","Trebuchet MS","Avenir Next Rounded",system-ui,sans-serif';
const GOLD = '#ffd23f';

const CELL_FLOOR = 0, CELL_HARD = 1, CELL_SOFT = 2, CELL_SUDDEN = 3;
const CELLS = GRID_W * GRID_H;

const ITEM_COLORS = { bomb: '#5cc0ff', flame: '#ff6a4d', speed: '#7dff5a', kick: '#a99cff', glove: '#ffd84a', shield: '#6aa8ff', skull: '#c46bff' };
const ITEM_LABELS = { bomb: '+1 BOMB', flame: '+1 RANGE', speed: 'SPEED UP', kick: 'KICK!', glove: 'GLOVE!', shield: 'SHIELD!' };
const CURSE_LABELS = { slow: 'SLOW', rush: 'RUSH', reverse: 'REVERSED', nobomb: 'NO BOMBS', spam: 'BOMB SPAM' };
const CURE_COLOR = '#8ff7a8';
const CURSE_COLOR = '#d59bff';

const ZERO2 = [0, 0];               // shake offsets are written into CAM to avoid allocating
const CAM = [0, 0];

/**
 * Whether a wire event has all its arguments, with finite numbers where numbers belong (Appendix A.3 via EVENT_ARGS). Anything else is
 * dropped instead of putting NaN into the particle pool.
 */
function validEvent(e) {
  const names = EVENT_ARGS[e[0]];
  if (!names || e.length <= names.length) return false;
  for (let i = 0; i < names.length; i++) {
    const name = names[i], v = e[i + 1];
    if (name === 'tiles') { if (!Array.isArray(v)) return false; } else if (name !== 'kind' && !Number.isFinite(v)) return false;
  }
  return true;
}

const now0 = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const fontCache = new Map();
/** CSS font strings by pixel size, so drawing text never builds a string per frame. */
function boldFont(px) {
  let f = fontCache.get(px);
  if (f === undefined) { f = `900 ${px}px ${FONT}`; fontCache.set(px, f); }
  return f;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeOutBack = (t) => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };
const easeOutCubic = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

// ---- Layout (pure, exported for tests and for ui.js/main.js if they want to place HUD next to the arena) --------------

/**
 * Where the arena goes for a container of cssW x cssH css pixels: tile = floor(min(w / 15, h / 13)) device pixels, exactly as in the spec.
 * @param {number} cssW @param {number} cssH @param {number} dprIn device pixel ratio (any positive number)
 * @param {number} quality 0..2 (level 2 caps dpr at 2, 1 at 1.5, 0 at 1)
 * @param {'auto'|'center'|'top'} align where the arena sits when the container is taller than it: 'top' pins it to the top edge, which is
 *   what a portrait phone wants (touch controls go underneath), 'center' letterboxes evenly, 'auto' = top in portrait, centre otherwise
 * @returns {{cssW:number, cssH:number, dpr:number, width:number, height:number, tile:number, ox:number, oy:number, over:number}}
 *   width/height = canvas backing store; tile = device px per tile; (ox, oy) = top-left of the 15 x 13 tile arena in device px;
 *   `over` = how far the top wall row's face reaches above oy.
 */
export function computeLayout(cssW, cssH, dprIn, quality = 2, align = 'auto') {
  cssW = Math.max(1, cssW || 1);
  cssH = Math.max(1, cssH || 1);
  const q = QUALITY[clamp(Math.round(quality), 0, 2)];
  let dpr = Math.min(dprIn > 0 ? dprIn : 1, q.dprCap);
  // Lower the dpr until the backing store fits the budget; on a huge container that means below 1 (the browser scales the canvas up).
  if (cssW * cssH * dpr * dpr > CANVAS_BUDGET_PX) dpr = Math.sqrt(CANVAS_BUDGET_PX / (cssW * cssH));
  let width = Math.max(1, Math.round(cssW * dpr)), height = Math.max(1, Math.round(cssH * dpr));
  while (width * height > CANVAS_BUDGET_PX && width > 1) { width--; height = Math.max(1, Math.round((height * width) / (width + 1))); }
  const tile = clamp(Math.floor(Math.min(width / GRID_W, height / GRID_H)), MIN_TILE, MAX_TILE);
  const over = Math.ceil(TOP_OVERHANG * tile);
  const ox = Math.floor((width - GRID_W * tile) / 2);
  // The top wall row's 2.5-D face reaches `over` above the arena: show it whenever the leftover height allows, else let the canvas edge clip it
  // (the arena itself is never clipped, so the HUD and the touch controls can rely on the spec's exact 15 x 13 fit).
  const slack = Math.max(0, height - GRID_H * tile);
  const top = align === 'top' || (align === 'auto' && cssH > cssW * 1.15);
  const oy = top ? Math.min(over, slack) : Math.max(Math.floor(slack / 2), Math.min(over, slack));
  return { cssW, cssH, dpr: width / cssW, width, height, tile, ox, oy, over };
}

// ---- Canvas helpers -------------------------------------------------------------------------------------------------

function defaultCreateCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('render.js needs a canvas implementation (document or OffscreenCanvas)');
}

function releaseCanvas(c) {
  if (c) { c.width = 0; c.height = 0; }   // hand the memory back to iOS at once
}

function roundedRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---- Name tags ------------------------------------------------------------------------------------------------------

/** Where the styles change, in css pixels per tile: a coloured pill where there is room, a small translucent pill on phones, plain text below. */
const TAG_PILL_MIN = 44, TAG_COMPACT_MIN = 27;
const TAG_PILL = 0, TAG_COMPACT = 1, TAG_PLAIN = 2;
/** Names are only drawn for the local fighter below this tile size: eight tags would hide a fifth of a 320 px wide arena. */
const TAG_LOCAL_ONLY_BELOW = 22;
const TAG_CAP = 16;                  // tags laid out per frame (a room has at most 8 fighters)
const TAG_ABOVE = 0.9;               // tiles: a tag's bottom edge sits this far above the fighter's centre (the accessories reach ~0.95)

/** Which tag style suits tiles of `T` device pixels at `dpr` (exported for the tests). */
export function tagStyleFor(T, dpr) {
  const css = T / (dpr || 1);
  return css >= TAG_PILL_MIN ? TAG_PILL : css >= TAG_COMPACT_MIN ? TAG_COMPACT : TAG_PLAIN;
}

/** Whether the fighter's tag is drawn at all at this tile size (see TAG_LOCAL_ONLY_BELOW). */
export function tagWanted(isMe, T, dpr) {
  return isMe || T / (dpr || 1) >= TAG_LOCAL_ONLY_BELOW;
}

/**
 * A player's name as a small label, baked once per (name, colour, size) because live fillText of eight labels costs more than a blit.
 * Phones get a smaller, see-through label and the smallest screens plain outlined text, so the tag never hides more of the arena than
 * the fighter itself: a 0.6 tile tall pill above every head made a 390 px wide arena unreadable in a fight.
 */
function buildNameTag(createCanvas, probe, name, hex, isMe, T, dpr) {
  const style = tagStyleFor(T, dpr);
  const fontPx = Math.round(style === TAG_PILL ? Math.max(T * 0.22, 10 * dpr) : style === TAG_COMPACT ? Math.max(T * 0.3, 9 * dpr) : Math.max(T * 0.36, 9 * dpr));
  const font = `800 ${fontPx}px ${FONT}`;
  probe.font = font;
  const maxText = 3 * T - fontPx;                         // spec: fillText(text, x, y, maxWidth = 3 * tile)
  const textW = Math.min(probe.measureText(name)?.width ?? name.length * fontPx * 0.6, maxText);
  const pill = style !== TAG_PLAIN;
  const padX = Math.round(fontPx * (style === TAG_PILL ? 0.55 : pill ? 0.4 : 0.15));
  const lw = Math.max(pill ? 1 : 2, Math.round(fontPx * (style === TAG_PILL ? 0.14 : pill ? 0.1 : 0.26)));   // border of a pill, halo of plain text
  const w = Math.ceil(textW + padX * 2 + lw * 2), h = Math.ceil(fontPx * (style === TAG_PILL ? 1.5 : pill ? 1.3 : 1.15) + lw * 2);
  const canvas = createCanvas(w, h);
  const g = canvas.getContext('2d');
  if (pill) {
    g.beginPath(); roundedRect(g, lw / 2, lw / 2, w - lw, h - lw, h / 2);
    g.fillStyle = isMe ? `rgba(52,34,8,${style === TAG_PILL ? 0.86 : 0.78})` : `rgba(27,16,51,${style === TAG_PILL ? 0.74 : 0.6})`; g.fill();
    g.lineWidth = lw; g.strokeStyle = isMe ? GOLD : hex; g.stroke();
  }
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const ty = h / 2 + fontPx * 0.06;
  if (!pill) {                                            // a dark halo keeps white text legible on any floor
    g.lineJoin = 'round'; g.lineWidth = lw * 2; g.strokeStyle = isMe ? 'rgba(52,34,8,0.9)' : 'rgba(27,16,51,0.85)';
    g.strokeText(name, w / 2, ty, maxText);
  }
  g.fillStyle = isMe ? '#fff3c4' : '#ffffff';
  g.fillText(name, w / 2, ty, maxText);
  return { canvas, w, h };
}

// ---- Per-entity animation state -------------------------------------------------------------------------------------

/** What the renderer remembers about one fighter between frames. */
class PlayerFx {
  constructor(id) {
    this.id = id;
    this.seen = 0;               // frame number of the last View that contained this fighter
    this.init = false;
    this.x = 0; this.y = 0;      // position at the previous frame (walk distance, speed)
    this.walk = 0;               // distance walked, tiles
    this.speed = 0;              // smoothed tiles/s
    this.moving = false;
    this.stepAcc = 0;
    this.phase = Math.random() * TAU;
    this.blinkAt = 0;            // render-clock ms of the next/current blink
    this.dead = false;           // dying, or a ghost already
    this.deathAt = -1; this.poofed = false; this.gone = false;   // gone = left the match, only a poof remained
    this.cheerAt = -1;
    this.placeAt = -1e9; this.kickAt = -1e9; this.throwAt = -1e9; this.pickupAt = -1e9; this.hitAt = -1e9;
    this.curseAcc = 0;
    this.emote = -1; this.emoteAt = -1e9;
    this.tag = null; this.tagName = ''; this.tagColor = -1; this.tagMe = false; this.tagT = 0; this.tagDpr = 0;
  }

  releaseTag() {
    if (this.tag) { releaseCanvas(this.tag.canvas); this.tag = null; }
  }
}

class BombFx {
  constructor() {
    this.seen = 0;
    this.born = 0;               // render-clock ms of first sight (pop-in), inherited from a ghost bomb on the same tile
    this.phase = 0;              // pulse phase in cycles
    this.spin = 0;               // rolling / tumbling angle
    this.x = 0; this.y = 0;
    this.landAt = -1e9;
    this.sparkAcc = 0;
    this.trail = 0;              // distance rolled since the last puff of dust
    this.init = false;
  }
}

class ItemFx {
  constructor(now) { this.seen = 0; this.born = now; this.glintAcc = Math.random(); }
}

// ---- Depth-sorted entity list (preallocated) ------------------------------------------------------------------------

const LIST_CAP = 384;
const E_PLAYER = 0, E_BOMB = 1, E_GHOST = 2, E_ITEM = 3, E_POP = 4;

class DrawList {
  constructor() {
    this.key = new Float32Array(LIST_CAP);
    this.type = new Uint8Array(LIST_CAP);
    this.ref = new Int16Array(LIST_CAP);
    this.order = new Uint16Array(LIST_CAP);
    this.n = 0;
  }

  clear() { this.n = 0; }

  add(type, ref, key) {
    if (this.n >= LIST_CAP) return;
    this.key[this.n] = key; this.type[this.n] = type; this.ref[this.n] = ref;
    this.n++;
  }

  /** Insertion sort of the order array by key: the list is short and mostly ordered, and it allocates nothing. */
  sort() {
    const { key, order, n } = this;
    for (let i = 0; i < n; i++) {
      let j = i;
      const k = key[i];
      while (j > 0 && key[order[j - 1]] > k) { order[j] = order[j - 1]; j--; }
      order[j] = i;
    }
  }
}

// ---- The renderer ---------------------------------------------------------------------------------------------------

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ createCanvas?: (w:number,h:number)=>any, matchMedia?: Function, reducedEffects?: boolean, align?: 'auto'|'center'|'top', random?: () => number }} [opts]
   *   all optional; the seams exist for tests under Node with a fake canvas.
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.makeCanvas = opts.createCanvas ?? defaultCreateCanvas;
    this.align = opts.align ?? 'auto';
    this.showNames = true;

    this.quality = 2;
    this.qualityFrames = 0; this.frameEma = 0; this.pace = { n: 0, mean: 0, m2: 0 };   // pace: running mean and variance of the slow window
    this.reduceUser = typeof opts.reducedEffects === 'boolean' ? opts.reducedEffects : null;   // null = follow the system preference
    this.reduceSystem = false;
    const mm = opts.matchMedia ?? (typeof matchMedia === 'function' ? matchMedia : null);
    if (mm) {
      try {
        this.mql = mm('(prefers-reduced-motion: reduce)');
        this.reduceSystem = !!this.mql.matches;
        this.onMedia = (e) => { this.reduceSystem = !!e.matches; this.applyQuality(); };
        if (this.mql.addEventListener) this.mql.addEventListener('change', this.onMedia);
        else if (this.mql.addListener) this.mql.addListener(this.onMedia);
      } catch { this.mql = null; }
    }

    this.cssW = 0; this.cssH = 0; this.dprIn = 1;
    this.layout = null;
    this.set = null; this.build = null; this.buildTile = 0; this.buildTheme = '';
    this.buildFailures = 0; this.buildRetryAt = 0;
    this.wantTileSince = 0;
    this.statics = null;          // baked arena: { canvas, x, y }
    this.staticOk = false;        // whether baking is worth its memory at this size (see staticPolicy)
    this.buildDone = false;       // the pending build has drawn everything
    this.prepared = null;         // { pattern, statics } derived from a finished build, waiting one frame for the swap
    this.staticKey = '';
    this.backdropPattern = null;
    this.tintCurse = null; this.tintDanger = null; this.tintBase = null; this.dimTop = 0;
    this.hintTheme = 'meadow';
    this.mode = 'ffa';
    this.lastView = null;

    this.now = 0; this.frameNo = 0;
    this.gridStr = ''; this.cells = new Uint8Array(CELLS); this.hardVersion = 0;
    this.players = new Map(); this.bombs = new Map(); this.items = new Map();
    this.tilePop = new Float64Array(CELLS).fill(-1e9); this.tileSeen = new Int32Array(CELLS).fill(-1e6); this.tilePhase = new Float32Array(CELLS);
    this.pops = [];                                    // crates bursting apart: { tx, ty, t0 }
    this.list = new DrawList();
    this.tagRect = new Float32Array(TAG_CAP * 4); this.tagOf = new Int16Array(TAG_CAP); this.headTop = new Float32Array(TAG_CAP);   // name tag layout, reused every frame
    this.danger = new Float32Array(CELLS).fill(NO_DANGER); this.tileBomb = new Int16Array(CELLS).fill(-1);   // ticks until a tile burns; the bomb on a tile
    this.bombFuse = new Float32Array(BOMB_CAP); this.chainFrom = new Int16Array(BOMB_CAP * 4); this.chainTo = new Int16Array(BOMB_CAP * 4);
    this.pose = { sx: 1, sy: 1, dx: 0, dy: 0 };
    this.lastState = -1; this.lastCountdown = 0; this.goAt = -1e9; this.endAt = -1e9; this.winners = 0;

    this.particles = new ParticleSystem({ random: opts.random });
    this.texts = new FloatingText();
    this.emitBudget = 0;

    this.shake = { amp: 0, t0: -1e9 };
    this.flash = { t0: -1e9, peak: 0, count: 0 };
    this.banner = { text: '', t0: -1e9, dur: 0, kind: '' };
    this.errors = [];
    this.probe = null;            // 1x1 canvas context for measuring text
    this.debug = false;
    this.debugInfo = { rtt: 0, ws: '', errors: [] };
    this.debugLines = []; this.debugAt = -1e9;
    this.fpsFrames = 0; this.fpsT0 = 0;
    this.stats = {
      fps: 0, frameMs: 0, renderMs: 0, dpr: 1, tilePx: 0, quality: 2, particles: 0, flashes: 0, shakes: 0, builds: 0,
    };
    this.applyQuality();
  }

  // ---- Public API (docs/SPEC.md 8.1) -----------------------------------------------------------------------------

  /** Container size in css pixels; `dpr` is already capped by main.js (capped again here by quality and the canvas budget). */
  resize(cssW, cssH, dpr) {
    this.cssW = cssW; this.cssH = cssH; this.dprIn = dpr;
    this.relayout();
  }

  /**
   * Draw one frame. `dtMs` is the time since the previous frame, `nowMs` the frame timestamp (any monotonic clock, ms).
   * Never throws: a failure inside a frame is recorded in `errors` and the next frame tries again.
   */
  render(view, dtMs, nowMs) {
    const t0 = now0();
    this.now = nowMs;
    this.frameNo++;
    const dt = clamp(dtMs || 0, 0, 100) / 1000;
    this.trackFrameTime(dtMs, nowMs);
    if (!this.layout) return;
    const drawable = !!(view && view.grid);
    try {
      // Without a View (before the first `round`) the frame still moves the sprite build along, so a theme hint has a head start.
      if (drawable) { this.lastView = view; this.updateCells(view.grid); }
      this.syncSprites(drawable ? view.theme : undefined);
      if (this.set && drawable) {
        this.advance(view, dt);
        this.paint(view);
      } else {
        this.paintPlaceholder(drawable ? view.theme : undefined);
      }
    } catch (err) {
      this.noteError(err);
    }
    const ms = now0() - t0;
    this.stats.renderMs = this.stats.renderMs ? this.stats.renderMs + (ms - this.stats.renderMs) * 0.1 : ms;
  }

  /**
   * Turn wire events (Appendix A.3) into particles, popups, shake and flashes. Returns nothing: audio is main.js's business.
   * `view` supplies colours and the local player; `nowMs` defaults to the time of the last render() call.
   */
  handleEvents(events, view, nowMs = this.now) {
    if (!events || !events.length || !view) return;
    this.emitBudget = this.particles.cap;   // one call's share of the pool: a chain reaction must not burn the whole frame
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!Array.isArray(e) || !validEvent(e)) continue;
      try { this.onEvent(e, view, nowMs); } catch (err) { this.noteError(err); }
    }
  }

  /** Show emote bubble `emoteIndex` (0..7 in EMOTES order; 8..11 are GG, heart, cry, cool) above fighter `playerId`. */
  showEmote(playerId, emoteIndex) {
    const n = EMOTES.length + EXTRA_EMOTE_ICONS.length;
    const fx = this.fxFor(playerId);
    fx.emote = clamp(Math.floor(emoteIndex) || 0, 0, n - 1);
    fx.emoteAt = this.now;
  }

  /** Optional prewarm hint: start building this theme's sprites before the first View of the round arrives. */
  setTheme(name) {
    if (THEMES.includes(name)) this.hintTheme = name;
  }

  /** Optional hint: the `round` message (or its players array). Only `mode` is used; the View stays the source of truth. */
  setPlayers(info) {
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      if (info.mode === 'teams' || info.mode === 'ffa') this.mode = info.mode;
      if (THEMES.includes(info.theme)) this.hintTheme = info.theme;
    }
  }

  /** Quality level 0..2 (spec: 2 = dpr cap 2, 1 = dpr cap 1.5 and fewer particles, 0 = dpr 1, no glow, 60 particles). */
  setQuality(q) {
    this.quality = clamp(Math.round(q) || 0, 0, 2);
    this.resetPace();
    this.applyQuality();
    this.relayout();
  }

  /** true / false = the user's "Reduce effects" choice, null = follow prefers-reduced-motion. */
  setReducedEffects(value) {
    this.reduceUser = typeof value === 'boolean' ? value : null;
    this.applyQuality();
  }

  get reducedEffects() { return this.reduceUser ?? this.reduceSystem; }

  /** The system's prefers-reduced-motion at this moment (for main.js to seed the "Reduce effects" setting). */
  get systemReducedMotion() { return this.reduceSystem; }

  setDebug(on) { this.debug = !!on; }

  /** The 15 x 13 tile arena in css pixels within the container (the wall overhang above it excluded); HUD elements can align to it. */
  getArenaRect() {
    const L = this.layout;
    if (!L) return { x: 0, y: 0, w: 0, h: 0 };
    const kx = L.cssW / L.width, ky = L.cssH / L.height;
    return { x: L.ox * kx, y: L.oy * ky, w: GRID_W * L.tile * kx, h: GRID_H * L.tile * ky };
  }

  /** Release every canvas (iOS counts them) and stop listening. The Renderer is unusable afterwards. */
  dispose() {
    if (this.mql && this.onMedia) {
      if (this.mql.removeEventListener) this.mql.removeEventListener('change', this.onMedia);
      else if (this.mql.removeListener) this.mql.removeListener(this.onMedia);
    }
    this.dropBuild();
    this.dropSet();
    if (this.probeCanvas) { releaseCanvas(this.probeCanvas); this.probeCanvas = null; this.probe = null; }
    this.players.forEach((fx) => fx.releaseTag());
    this.players.clear(); this.bombs.clear(); this.items.clear();
    this.lastView = null;
  }

  // ---- Quality, layout ---------------------------------------------------------------------------------------------

  applyQuality() {
    const q = QUALITY[this.quality];
    this.particles.setCap(this.reducedEffects ? Math.min(REDUCED_PARTICLES, q.particles) : q.particles);
    this.seedAmbient();
    this.stats.quality = this.quality;
  }

  /** Effective settings at the current quality and reduced-effects flag. */
  get fxLevel() { return QUALITY[this.quality]; }

  trackFrameTime(dtMs, nowMs) {
    if (this.fpsT0 === 0) this.fpsT0 = nowMs;
    this.fpsFrames++;
    if (nowMs - this.fpsT0 >= 500) {
      this.stats.fps = Math.round((this.fpsFrames * 1000) / (nowMs - this.fpsT0));
      this.fpsFrames = 0; this.fpsT0 = nowMs;
    }
    if (!(dtMs > 0 && dtMs < 250)) return;                     // (a stall or a backgrounded tab is not a slow frame)
    this.frameEma = this.frameEma ? this.frameEma + (dtMs - this.frameEma) * 0.05 : dtMs;
    this.stats.frameMs = this.frameEma;
    // Adaptive quality (8.2): an EMA of the frame interval above 24 ms for 120 frames lowers the level; only setQuality() raises it again.
    // Frames while a sprite set is being built do not count (the build slices are meant to cost time), and neither does a window whose
    // frames are 33.3 ms apart with hardly any jitter: that is a display capped to 30 Hz (iOS Low Power Mode, browser energy savers),
    // where a lower quality would make the picture worse without making it any faster.
    if (this.frameEma <= SLOW_FRAME_MS || this.quality === 0) { this.resetPace(); return; }
    if (this.build !== null) return;
    const pace = this.pace, n = ++pace.n, delta = dtMs - pace.mean;
    pace.mean += delta / n; pace.m2 += delta * (dtMs - pace.mean);
    if (++this.qualityFrames < SLOW_FRAMES) return;
    const capped = Math.sqrt(pace.m2 / (n - 1)) < CAP_JITTER_MS && Math.abs(pace.mean - CAP_FRAME_MS) < CAP_TOLERANCE_MS;
    this.resetPace();
    if (!capped) this.setQuality(this.quality - 1);
  }

  resetPace() {
    this.qualityFrames = 0;
    this.pace.n = 0; this.pace.mean = 0; this.pace.m2 = 0;
  }

  relayout() {
    if (!this.cssW || !this.cssH) return;
    const L = computeLayout(this.cssW, this.cssH, this.dprIn, this.quality, this.align);
    const old = this.layout;
    const backingChanged = !old || old.width !== L.width || old.height !== L.height;
    const changed = !old || backingChanged || old.tile !== L.tile || old.ox !== L.ox || old.oy !== L.oy || old.cssW !== L.cssW || old.cssH !== L.cssH;
    if (!changed) return;
    this.layout = L;
    if (backingChanged) { this.canvas.width = L.width; this.canvas.height = L.height; }
    const st = this.canvas.style;
    if (st) { st.display = 'block'; st.width = `${L.cssW}px`; st.height = `${L.cssH}px`; }
    this.stats.dpr = L.dpr; this.stats.tilePx = L.tile;
    if (!old || old.tile !== L.tile) this.wantTileSince = this.now;
    this.staticKey = '';
    this.updateStaticPolicy();
    this.buildTints();
    this.seedAmbient();
    // Resizing clears a canvas; repaint at once (a ResizeObserver callback runs after the frame's rAF and before paint).
    if (this.lastView && this.set) {
      try { this.paint(this.lastView); } catch (err) { this.noteError(err); }
    }
  }

  /** Screen-space tints as reusable gradients (the curse vignette and the sudden-death edge glow). */
  buildTints() {
    const L = this.layout, g = this.ctx;
    if (!L || !g.createRadialGradient) return;
    const cx = L.width / 2, cy = L.height / 2, r0 = Math.min(L.width, L.height) * 0.42, r1 = Math.hypot(cx, cy);
    const make = (rgb) => {
      const grad = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
      grad.addColorStop(0, `rgba(${rgb},0)`); grad.addColorStop(1, `rgba(${rgb},1)`);
      return grad;
    };
    this.tintCurse = make('120,40,190');
    this.tintDanger = make('255,90,40');
    // A portrait screen leaves a lot of backdrop below the arena, where the touch controls go: let it fall quiet towards the bottom.
    const under = L.oy + GRID_H * L.tile;
    this.dimTop = under;
    if (L.height - under > L.tile * 1.5) {
      const grad = g.createLinearGradient(0, under, 0, L.height);
      grad.addColorStop(0, 'rgba(12,6,32,0)'); grad.addColorStop(0.4, 'rgba(12,6,32,0.3)'); grad.addColorStop(1, 'rgba(12,6,32,0.55)');
      this.tintBase = grad;
    } else this.tintBase = null;
  }

  seedAmbient() {
    const L = this.layout;
    if (!L || !this.set) return;
    const n = this.reducedEffects ? 0 : this.fxLevel.ambient;
    const T = L.tile;
    this.particles.setAmbient(this.set.palette.ambient.kind, n, -L.ox / T, -L.oy / T, (L.width - L.ox) / T, (L.height - L.oy) / T);
  }

  // ---- Sprites: time-sliced rebuilds, baked static arena --------------------------------------------------------------

  /**
   * Keep the sprite set in step with the layout and the theme. A missing or stale set is rebuilt in time slices while the old one keeps
   * drawing. A build that fails (out of canvas memory on a phone) is dropped and retried after a pause, and after the second failure at a
   * lower quality, which means smaller sprites. Never throws: a broken build must not take the picture down with it.
   */
  syncSprites(viewTheme) {
    const L = this.layout;
    const theme = THEMES.includes(viewTheme) ? viewTheme : this.hintTheme;
    const cur = this.set;
    if (cur && cur.tile === L.tile && cur.theme === theme) { if (this.build || this.prepared) this.dropBuild(); return; }
    if (this.now < this.buildRetryAt) return;
    try {
      this.stepBuild(L, theme, cur);
    } catch (err) {
      this.noteError(err);
      this.dropBuild();
      this.buildRetryAt = this.now + Math.min(8000, 500 * 2 ** this.buildFailures);
      if (++this.buildFailures >= 2 && this.quality > 0) {
        this.setQuality(this.quality - 1);
        this.buildRetryAt = this.now + 250;
      }
    }
  }

  stepBuild(L, theme, cur) {
    if (!this.build || this.buildTile !== L.tile || this.buildTheme !== theme) {
      // While a window is being dragged the tile size changes every frame; wait until it settles (the old set keeps drawing, scaled).
      if (cur && cur.tile !== L.tile && this.now - this.wantTileSince < 150) return;
      this.dropBuild();
      this.build = startSpriteBuild({ tile: L.tile, theme, dpr: Math.round(L.dpr * 100) / 100, createCanvas: this.makeCanvas === defaultCreateCanvas ? undefined : this.makeCanvas });
      this.buildTile = L.tile; this.buildTheme = theme;
    }
    // A new theme is on screen the moment it is ready, so it gets a bigger slice than a same-theme resize (terrain alone is ~15 ms);
    // with no set at all there is nothing to draw, so take even more.
    if (!this.buildDone) {
      this.buildDone = this.build.pump(!cur ? 12 : cur.theme !== theme ? 8 : 3);
      if (!this.buildDone || cur) return;
    }
    // Built. What depends on the new set (the baked arena, the backdrop pattern) is prepared in a frame of its own, and the swap happens
    // in the next one, so that no frame pays for the whole changeover. With no set on screen yet there is nothing to protect.
    if (!this.prepared) {
      this.prepared = this.prepare(this.build.set);
      if (cur) return;
    }
    this.swapSet(this.build.set, this.prepared);
    this.buildFailures = 0;
  }

  /** Everything that is derived from a finished sprite set and costs a few milliseconds. */
  prepare(set) {
    const g = this.ctx;
    return {
      pattern: set.backdrop.canvas ? g.createPattern(set.backdrop.canvas, 'repeat') : null,
      statics: this.staticPolicy(set) ? this.bakeArena(set) : null,
      hardVersion: this.hardVersion,
    };
  }

  swapSet(next, prepared) {
    const old = this.set;
    const retile = !old || old.tile !== next.tile;
    this.set = next;
    this.build = null; this.buildTile = 0; this.buildTheme = ''; this.buildDone = false; this.prepared = null;
    this.stats.builds++;
    this.particles.bind(next);
    this.backdropPattern = prepared.pattern;
    if (this.statics) releaseCanvas(this.statics.canvas);
    this.statics = prepared.statics;
    this.staticKey = prepared.statics ? this.staticKeyFor(next, prepared.hardVersion) : '';
    this.staticOk = prepared.statics !== null;
    if (retile) this.players.forEach((fx) => fx.releaseTag());
    this.seedAmbient();
    if (old) old.dispose();
  }

  dropBuild() {
    if (this.build) { this.build.set.dispose(); this.build = null; this.buildTile = 0; this.buildTheme = ''; this.buildDone = false; }
    if (this.prepared) { if (this.prepared.statics) releaseCanvas(this.prepared.statics.canvas); this.prepared = null; }
  }

  dropSet() {
    if (this.set) { this.set.dispose(); this.set = null; }
    if (this.statics) { releaseCanvas(this.statics.canvas); this.statics = null; }
    this.staticKey = '';
  }

  /**
   * Whether baking the arena is worth its memory. It saves ~200 draw calls a frame but costs one more arena-sized canvas; measured in
   * Chromium, frame cost jumps 3-4x once the pixels alive in canvases (atlas pages, the screen, this bake) pass ~10 Mpx, which happens
   * on big screens, so there the arena is drawn piece by piece instead. It is also only correct at layout scale 1.
   */
  staticPolicy(set) {
    const L = this.layout;
    if (!L || L.tile !== set.tile) return false;
    const margin = Math.ceil(set.tile * STATIC_MARGIN);
    const bakePx = (GRID_W * set.tile + 2 * margin) * (GRID_H * set.tile + Math.ceil(TOP_OVERHANG * set.tile) + 2 * margin);
    return set.pixels + L.width * L.height + bakePx <= CANVAS_MEMORY_SOFT_LIMIT;
  }

  /** After a layout change the same set may or may not deserve its bake any more. */
  updateStaticPolicy() {
    if (!this.set) return;
    this.staticOk = this.staticPolicy(this.set);
    if (!this.staticOk && this.statics) { releaseCanvas(this.statics.canvas); this.statics = null; this.staticKey = ''; }
  }

  staticKeyFor(set, hardVersion) { return `${set.tile}|${set.theme}|${hardVersion}`; }

  /** Rebake when the walls changed (a new round with another layout). */
  ensureStatic() {
    const key = this.staticKeyFor(this.set, this.hardVersion);
    if (this.statics && this.staticKey === key) return;
    if (this.statics) releaseCanvas(this.statics.canvas);
    this.statics = this.bakeArena(this.set);
    this.staticKey = key;
  }

  /** Bake the part of the arena that never changes within a round: shadow of the ring, floor, wall shadows, border ring. */
  bakeArena(set) {
    const T = set.tile, M = Math.ceil(T * STATIC_MARGIN), over = Math.ceil(TOP_OVERHANG * T);
    const canvas = this.makeCanvas(GRID_W * T + 2 * M, GRID_H * T + over + 2 * M);
    const g = canvas.getContext('2d');
    g.translate(M, M + over);
    // Cast shadow of the whole ring onto the backdrop. The shape is drawn far off-canvas so only its shadow lands here.
    const OFF = 20000;
    g.save();
    g.shadowColor = 'rgba(26,15,58,0.5)'; g.shadowBlur = T * 0.4; g.shadowOffsetX = OFF; g.shadowOffsetY = T * 0.2;
    g.fillStyle = '#000';
    g.beginPath(); roundedRect(g, -OFF, -over * 0.4, GRID_W * T, GRID_H * T + over * 0.4, T * 0.25); g.fill();
    g.restore();
    this.drawArenaBase(g, T, set);
    return { canvas, x: -M, y: -M - over };
  }

  /** Floor, wall shadows and the border ring (scenery: drawn before everything else, as the sprite notes advise). */
  drawArenaBase(g, T, set = this.set) {
    const { cells } = this;
    // Opaque under everything, so the rounded corners of the border sprites never show a stale canvas.
    const over = Math.ceil(TOP_OVERHANG * T);
    g.fillStyle = set.palette.backdrop;
    g.fillRect(0, -over, GRID_W * T, GRID_H * T + over);
    for (let ty = 1; ty < GRID_H - 1; ty++) for (let tx = 1; tx < GRID_W - 1; tx++) drawSprite(g, set.floorAt(tx, ty), tx * T, ty * T);
    for (let ty = 1; ty < GRID_H - 1; ty++) {
      for (let tx = 1; tx < GRID_W - 1; tx++) if (cells[ty * GRID_W + tx] === CELL_HARD) drawSprite(g, set.blockShadow, tx * T, ty * T);
    }
    for (let ty = 0; ty < GRID_H; ty++) {
      const edgeRow = ty === 0 || ty === GRID_H - 1;
      for (let tx = 0; tx < GRID_W; tx += edgeRow ? 1 : GRID_W - 1) drawSprite(g, set.borderAt(tx, ty), tx * T, ty * T);
    }
  }

  updateCells(grid) {
    if (grid === this.gridStr) return;
    this.gridStr = grid;
    const cells = this.cells;
    let hardChanged = false;
    for (let i = 0; i < CELLS; i++) {
      const c = grid.charCodeAt(i);
      const code = c === 35 ? CELL_HARD : c === 43 ? CELL_SOFT : c === 88 ? CELL_SUDDEN : CELL_FLOOR;
      if ((code === CELL_HARD) !== (cells[i] === CELL_HARD)) hardChanged = true;
      cells[i] = code;
    }
    if (hardChanged) this.hardVersion++;
  }

  // ---- Per-frame simulation of purely visual state ----------------------------------------------------------------

  fxFor(id) {
    let fx = this.players.get(id);
    if (!fx) { fx = new PlayerFx(id); this.players.set(id, fx); }
    return fx;
  }

  noteError(err) {
    const msg = err && err.stack ? String(err.stack).split('\n').slice(0, 3).join(' | ') : String(err);
    if (this.errors[this.errors.length - 1] !== msg) {
      this.errors.push(msg);
      if (this.errors.length > 5) this.errors.shift();
      if (typeof console !== 'undefined') console.error('[render]', err);
    }
  }

  /** Advance particle physics and everything that is derived from watching the View. */
  advance(view, dt) {
    const now = this.now, pt = this.particles;
    const reduced = this.reducedEffects, detail = this.fxLevel.sparks;
    if (this.frameNo % 240 === 0) this.sweep();
    // fighters
    const ps = view.players;
    let alive = 0, aliveTeam = -1, sameTeam = true;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.alive) { alive++; if (aliveTeam < 0) aliveTeam = p.team; else if (aliveTeam !== p.team) sameTeam = false; }
      if (p.isMe) this.myColor = p.color;
    }
    const ending = view.state === STATE.ENDING || view.state === STATE.OVER;
    if (view.state === STATE.COUNTDOWN && (this.lastState !== STATE.COUNTDOWN || view.countdown > this.lastCountdown + 1)) this.newRound();
    this.lastCountdown = view.countdown;
    if (view.state !== this.lastState) {
      if (view.state === STATE.ENDING && this.lastState !== STATE.OVER) this.endAt = now;
      this.lastState = view.state;
    }
    this.winners = ending && alive > 0 && (this.teamMode(view) ? sameTeam : alive === 1) ? 1 : 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], fx = this.fxFor(p.id);
      fx.seen = this.frameNo;
      const dx = p.x - fx.x, dy = p.y - fx.y, d = Math.abs(dx) + Math.abs(dy);
      if (!fx.init || !(d <= 3)) { fx.x = p.x; fx.y = p.y; fx.init = true; } else if (dt > 0) {   // (a NaN distance is a teleport too: it must not poison the smoothed speed)
        fx.x = p.x; fx.y = p.y;
        fx.speed += (d / dt - fx.speed) * Math.min(1, dt * 14);
        if (!fx.moving && fx.speed > 0.6) fx.moving = true; else if (fx.moving && fx.speed < 0.25) fx.moving = false;
        if (fx.moving) {
          fx.walk += d; fx.stepAcc += d;
          if (fx.stepAcc > 0.62 && !fx.dead) { fx.stepAcc = 0; if (detail > 0) pt.dust(p.x - Math.sign(dx) * 0.12, p.y + 0.3, 1, 0.2, 0.18, 0.12); }
        }
      }
      if (!p.alive) {
        if (!fx.dead) { fx.dead = true; if (fx.deathAt < 0 && !fx.gone) fx.deathAt = now - p.deadT * TICK_MS; }
      } else if (fx.dead && (fx.deathAt < 0 || now - fx.deathAt > REVIVE_GRACE_MS)) {   // alive again: a new round
        fx.dead = false; fx.deathAt = -1; fx.poofed = false; fx.gone = false;
      }
      const alive = !fx.dead;
      if (fx.dead && !fx.poofed && fx.deathAt >= 0 && (now - fx.deathAt) / TICK_MS >= DYING_TICKS) {
        fx.poofed = true;
        pt.smoke(p.x, p.y, 0.1, 4, false, 0.45, 0.9, 0.2);
      }
      if (alive && p.alive && this.winners) {
        if (fx.cheerAt < 0) { fx.cheerAt = now; if (!reduced) pt.confetti(p.x, p.y - 0.3, 0.4, 14, 3.2, 6); }
      } else fx.cheerAt = -1;
      if (alive && p.curse) {
        fx.curseAcc += dt;
        if (fx.curseAcc > 0.28 && detail > 0) { fx.curseAcc = 0; pt.skulls(p.x, p.y - 0.2, 1); }
      }
    }
    if (this.winners && !reduced && now - this.endAt < 1800) {
      // keep a little confetti fountain going over the winners for the first moments of ENDING
      if (this.frameNo % 12 === 0) {
        for (let i = 0; i < ps.length; i++) if (ps[i].alive) pt.confetti(ps[i].x, ps[i].y - 0.5, 0.6, 3, 2.4, 5.5);
      }
    }
    // bombs
    const bs = view.bombs;
    for (let i = 0; i < bs.length; i++) this.trackBomb(bs[i], dt);
    for (let i = 0; i < view.ghostBombs.length; i++) this.trackGhost(view.ghostBombs[i], dt);
    // items
    const its = view.items;
    for (let i = 0; i < its.length; i++) {
      const it = its[i];
      let fx = this.items.get(it.id);
      if (!fx) { fx = new ItemFx(now); this.items.set(it.id, fx); }
      fx.seen = this.frameNo;
      if (!reduced && detail > 0) {
        fx.glintAcc += dt * (it.kind === 'skull' ? 1.6 : 0.9);
        if (fx.glintAcc > 1) {
          fx.glintAcc -= 1 + Math.random() * 0.6;
          if (it.kind === 'skull') pt.skulls(it.x, it.y, 1); else pt.glint(it.x + (Math.random() - 0.5) * 0.5, it.y - 0.1 + (Math.random() - 0.5) * 0.3, 0.15);
        }
      }
    }
    // burst crates
    for (let i = this.pops.length - 1; i >= 0; i--) if (now - this.pops[i].t0 >= 50 * SOFT_POP_FRAMES) this.pops.splice(i, 1);
    pt.update(dt);
    this.texts.update(dt);
    this.stats.particles = pt.live;
  }

  trackBomb(b, dt) {
    const now = this.now;
    let fx = this.bombs.get(b.id);
    const idx = b.ty * GRID_W + b.tx;
    if (!fx) {
      fx = new BombFx();
      this.bombs.set(b.id, fx);
      const ghost = idx >= 0 && idx < CELLS && this.tileSeen[idx] >= this.frameNo - 3;   // a local ghost bomb sat here: carry on its animation
      fx.born = ghost ? this.tilePop[idx] : now;
      fx.phase = ghost ? this.tilePhase[idx] : 0;
    }
    fx.seen = this.frameNo;
    const reduced = this.reducedEffects;
    // Pulse: about 1.3 cycles/s at a fresh fuse, speeding up to ~6 when the bomb is about to go.
    const burn = 1 - clamp(b.fuse / FUSE_TICKS, 0, 1);
    fx.phase += dt * (reduced ? 1.4 : 1.3 + 4.7 * burn * burn);
    if (b.dir !== 0 || b.fly) {
      const dx = fx.init ? b.x - fx.x : 0, dy = fx.init ? b.y - fx.y : 0;
      fx.spin += (Math.abs(dx) > Math.abs(dy) ? dx : dy) / 0.33;
      if (b.fly) fx.spin += dt * 9;
      else if (!reduced && this.fxLevel.sparks > 0 && (fx.trail += Math.abs(dx) + Math.abs(dy)) > 0.55) {   // a rolling bomb kicks up a little dust
        fx.trail = 0;
        const [ux, uy] = DIR4[(b.dir - 1) & 3];
        this.particles.dust(b.x - ux * 0.25, b.y - uy * 0.25 + 0.3, 1, 0.17, 0.1, 0.12);
      }
    } else { fx.spin *= 0.6; fx.trail = 0; }
    fx.x = b.x; fx.y = b.y; fx.init = true;
    if (idx >= 0 && idx < CELLS && !b.fly) { this.tileSeen[idx] = this.frameNo; this.tilePop[idx] = fx.born; this.tilePhase[idx] = fx.phase; }
    if (!reduced && this.fxLevel.sparks > 0 && !b.fly) {
      fx.sparkAcc += dt * (4 + 12 * burn);
      if (fx.sparkAcc >= 1) {
        fx.sparkAcc -= 1;
        const s = BOMB_PULSE[Math.floor(fx.phase * BOMB_PULSE.length) % BOMB_PULSE.length];   // the fuse rides the swelling body
        if (b.dir === 0) this.particles.fuseSpark(b.x + BOMB_FUSE_TIP.x * s, b.y, -BOMB_FUSE_TIP.y * s);
        else {                                                                          // ... and turns with a rolling one (its centre is 0.08 below the anchor)
          const c = Math.cos(fx.spin), n = Math.sin(fx.spin), ox = BOMB_FUSE_TIP.x * s, oy = (BOMB_FUSE_TIP.y - 0.08) * s;
          this.particles.fuseSpark(b.x + ox * c - oy * n, b.y, -(ox * n + oy * c) - 0.08);
        }
      }
    }
  }

  trackGhost(gb, dt) {
    const idx = Math.floor(gb.y) * GRID_W + Math.floor(gb.x);
    if (idx < 0 || idx >= CELLS) return;
    if (this.tileSeen[idx] < this.frameNo - 3) { this.tilePop[idx] = this.now; this.tilePhase[idx] = 0; }
    this.tileSeen[idx] = this.frameNo;
    this.tilePhase[idx] += dt * 1.3;
  }

  /** Forget ids that have not been in a View for a while (prevents unbounded maps in a long-lived room). */
  sweep() {
    const cutoff = this.frameNo - 240;
    this.players.forEach((fx, id) => { if (fx.seen < cutoff) { fx.releaseTag(); this.players.delete(id); } });
    this.bombs.forEach((fx, id) => { if (fx.seen < cutoff) this.bombs.delete(id); });
    this.items.forEach((fx, id) => { if (fx.seen < cutoff) this.items.delete(id); });
  }

  /** A countdown that starts from the top means a new round: forget the last one's effects and per-fighter animation state. */
  newRound() {
    this.particles.clear();
    this.texts.clear();
    this.pops.length = 0;
    this.banner.t0 = -1e9;
    this.shake.t0 = -1e9;
    this.flash.t0 = -1e9;
    this.goAt = -1e9;
    this.bombs.clear(); this.items.clear();
    this.tileSeen.fill(-1e6);
    this.players.forEach((fx) => {
      fx.init = false; fx.walk = 0; fx.speed = 0; fx.moving = false; fx.dead = false; fx.deathAt = -1; fx.poofed = false; fx.gone = false;
      fx.cheerAt = -1; fx.emote = -1; fx.placeAt = fx.kickAt = fx.throwAt = fx.pickupAt = fx.hitAt = -1e9;
    });
    this.seedAmbient();
  }

  teamMode(view) { return view.mode === 'teams' || (view.mode !== 'ffa' && this.mode === 'teams'); }

  // ---- Painting ---------------------------------------------------------------------------------------------------

  paintPlaceholder(theme) {
    const g = this.ctx, L = this.layout;
    const pal = THEME_PALETTES[THEMES.includes(theme) ? theme : this.hintTheme];
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = pal.backdrop;
    g.fillRect(0, 0, L.width, L.height);
  }

  paint(view) {
    const g = this.ctx, L = this.layout, set = this.set, now = this.now;
    const T = set.tile, k = L.tile / T, reduced = this.reducedEffects;
    // A frame that threw half way may have left a transform, an alpha or a blend mode behind; every frame starts from a known state.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    const cam = this.cameraOffset(now, L.dpr, reduced), sx = cam[0], sy = cam[1];
    const level = this.fxLevel;

    // 1. backdrop around the arena (also under the shake margin)
    this.paintBackdrop(g, L, set, sx, sy, k, reduced);

    // 2. the arena in world space: 1 unit = 1 device pixel of the sprite set
    g.setTransform(k, 0, 0, k, L.ox + sx, L.oy + sy);
    if (this.staticOk) {
      this.ensureStatic();
      const s = this.statics;
      g.drawImage(s.canvas, s.x, s.y);
    } else this.drawArenaBase(g, T);

    this.paintFloorLevel(g, view, T, now, reduced, level);
    this.paintFlames(g, view, T, now, reduced);
    this.paintEntities(g, view, T, now, reduced);
    this.paintAloft(g, view, T, now);
    if (level.glow) this.paintLight(g, view, T, now, reduced);
    this.particles.draw(g, T, false, level.glow);
    this.particles.draw(g, T, true, level.glow);
    this.paintOverlays(g, view, T, now, reduced);

    // 3. screen space
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.paintScreen(g, view, L, now, reduced);
    if (this.debug) this.paintDebug(g, L);
  }

  /** Camera shake offset in device pixels: decaying, at most SHAKE_MAX_PX css px and SHAKE_MS long. */
  cameraOffset(now, dpr, reduced) {
    const s = this.shake, age = now - s.t0;
    if (reduced || age >= SHAKE_MS || s.amp <= 0) return ZERO2;
    const decay = (1 - age / SHAKE_MS) ** 2, a = s.amp * decay * dpr;
    CAM[0] = Math.round(Math.sin(age * 0.11 + s.t0) * a);
    CAM[1] = Math.round(Math.cos(age * 0.13 + s.t0 * 0.7) * a);
    return CAM;
  }

  /** The themed pattern around the arena, drifting slowly (parallax) unless effects are reduced. */
  paintBackdrop(g, L, set, sx, sy, k, reduced) {
    const T = set.tile;
    const pat = this.backdropPattern;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!pat) { g.fillStyle = set.palette.backdrop; g.fillRect(0, 0, L.width, L.height); return; }
    // A pattern is anchored to the canvas, so the drift is a translation of the context. Rectangles are given in that drifting,
    // sprite-set-sized space; the arena itself is skipped (its static layer is opaque) and the canvas is overdrawn by the shake margin.
    // (whole pixels only: a fractional offset makes the browser filter the whole pattern, several times slower)
    const dx = reduced ? 0 : Math.floor((this.now * 0.0035) % (T * k * 4)), dy = Math.floor(dx * 0.5);
    const m = Math.ceil(SHAKE_MAX_PX * L.dpr) + 1, inv = 1 / k;
    g.setTransform(k, 0, 0, k, sx + dx, sy + dy);
    g.fillStyle = pat;
    const wx0 = (-m - sx - dx) * inv, wx1 = (L.width + m - sx - dx) * inv;
    const wy0 = (-m - sy - dy) * inv, wy1 = (L.height + m - sy - dy) * inv;
    const ax0 = (L.ox - dx) * inv, ax1 = ax0 + GRID_W * L.tile * inv;
    const ay0 = (L.oy - L.over - dy) * inv, ay1 = ay0 + (GRID_H * L.tile + L.over) * inv;   // (the overhang is arena too)
    if (ay0 > wy0) g.fillRect(wx0, wy0, wx1 - wx0, ay0 - wy0);
    if (wy1 > ay1) g.fillRect(wx0, ay1, wx1 - wx0, wy1 - ay1);
    if (ax0 > wx0) g.fillRect(wx0, ay0, ax0 - wx0, ay1 - ay0);
    if (wx1 > ax1) g.fillRect(ax1, ay0, wx1 - ax1, ay1 - ay0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.tintBase) { g.fillStyle = this.tintBase; g.fillRect(0, this.dimTop, L.width, L.height - this.dimTop); }
  }

  /** Cast shadows of crates and sudden-death walls, sudden-death telegraphs, throw targets, item glows. */
  paintFloorLevel(g, view, T, now, reduced, level) {
    const { set, cells } = this;
    for (let ty = 1; ty < GRID_H - 1; ty++) {
      for (let tx = 1; tx < GRID_W - 1; tx++) {
        const c = cells[ty * GRID_W + tx];
        if (c === CELL_SOFT || c === CELL_SUDDEN) drawSprite(g, set.blockShadow, tx * T, ty * T);
      }
    }
    this.paintDanger(g, view, T, now, reduced);
    // Sudden death: the tile darkens and a warning mark pulses as the block comes down.
    const fl = view.falling;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i], u = 1 - clamp(f.ticksLeft / SD_WARN_TICKS, 0, 1);
      const cx = (f.tx + 0.5) * T, cy = (f.ty + 0.5) * T, half = T * (0.28 + 0.22 * u);
      g.fillStyle = 'rgb(20,8,40)';
      g.globalAlpha = 0.18 + 0.5 * u;
      g.fillRect(Math.round(cx - half), Math.round(cy - half), Math.round(half * 2), Math.round(half * 2));
      const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(now * (0.012 + 0.03 * u));
      g.globalAlpha = 0.55 + 0.45 * u;
      drawSprite(g, set.fx.warning, cx, cy, 0.62 * pulse * (0.8 + 0.3 * u));
      g.globalAlpha = 1;
    }
    // Where a thrown bomb will land, and its shadow while it flies.
    const bs = view.bombs;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (!b.fly) continue;
      const tx = (b.fly.tx) * T, ty = (b.fly.ty) * T;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.014);
      g.strokeStyle = '#fff'; g.fillStyle = '#fff';
      g.lineWidth = Math.max(2, T * 0.06);
      g.globalAlpha = 0.45 + 0.4 * pulse;
      g.beginPath(); g.arc(tx, ty, T * (0.3 + 0.05 * pulse), 0, TAU); g.stroke();
      g.beginPath(); g.arc(tx, ty, T * 0.08, 0, TAU); g.fill();
      const h = this.flightHeight(b), s = 0.95 - 0.35 * clamp(h / 2, 0, 1);
      g.globalAlpha = 0.7;
      drawSprite(g, set.fx.shadow, b.x * T, (b.y + 0.34) * T, s, s);
      g.globalAlpha = 1;
    }
    // Item glows sit on the floor under the tokens.
    const its = view.items;
    if (its.length) {
      if (level.glow) g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < its.length; i++) {
        const it = its[i], glow = set.itemGlow(it.kind);
        if (!glow) continue;                                   // (a kind this build does not know: skip it rather than lose the frame)
        const fx = this.items.get(it.id);
        const born = fx ? clamp((now - fx.born) / 260, 0, 1) : 1;
        const pulse = reduced ? 0.9 : 0.85 + 0.15 * Math.sin(now * 0.005 + it.id);
        g.globalAlpha = (level.glow ? 0.9 : 0.6) * pulse * born;
        drawSprite(g, glow, it.x * T, (it.y + 0.02) * T, 0.8);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  /**
   * Mark the tiles that bombs are about to burn, so danger reads at a glance. Chain reactions count: a blast that reaches another bomb
   * sets it off in the same instant, so a tile burns when the SOONEST bomb of its chain goes off, and the marks show that. Strength and
   * pulse grow as the moment nears; a bright border keeps the mark readable on any floor (a plain red wash all but vanished on candy
   * pink). Leaves `this.danger` (ticks until each tile burns) for the local fighter's ring.
   */
  paintDanger(g, view, T, now, reduced) {
    const bs = view.bombs, n = Math.min(bs.length, BOMB_CAP), cells = this.cells, at = this.tileBomb, danger = this.danger, fuse = this.bombFuse;
    const from = this.chainFrom, to = this.chainTo;
    danger.fill(NO_DANGER);
    if (n === 0) return;
    at.fill(-1);
    for (let i = 0; i < n; i++) {
      const b = bs[i], idx = b.ty * GRID_W + b.tx;
      const live = !b.fly && idx >= 0 && idx < CELLS;
      fuse[i] = live ? b.fuse : NO_DANGER;                                            // (a thrown bomb is in the air: fire ignores it)
      if (live) at[idx] = i;
    }
    let edges = 0;                                                                    // bomb i's blast reaches bomb j
    for (let i = 0; i < n; i++) {
      if (fuse[i] === NO_DANGER) continue;
      const b = bs[i];
      for (let d = 0; d < 4; d++) {
        const dx = DIR4[d][0], dy = DIR4[d][1];
        for (let k = 1; k <= b.range; k++) {
          const x = b.tx + dx * k, y = b.ty + dy * k;
          if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H || cells[y * GRID_W + x] !== CELL_FLOOR) break;   // a wall stops the fire, a crate absorbs it
          const j = at[y * GRID_W + x];
          if (j >= 0) { if (edges < from.length) { from[edges] = i; to[edges++] = j; } break; }                // the arm ends at the next bomb
        }
      }
    }
    for (let pass = 0; pass < n; pass++) {                                            // the soonest fuse of a chain spreads along it
      let changed = false;
      for (let e = 0; e < edges; e++) if (fuse[from[e]] < fuse[to[e]]) { fuse[to[e]] = fuse[from[e]]; changed = true; }
      if (!changed) break;
    }
    let any = false;
    for (let i = 0; i < n; i++) {
      const f = fuse[i];
      if (!(f <= DANGER_TICKS)) continue;
      any = true;
      const b = bs[i], c0 = b.ty * GRID_W + b.tx;
      if (f < danger[c0]) danger[c0] = f;
      for (let d = 0; d < 4; d++) {
        const dx = DIR4[d][0], dy = DIR4[d][1];
        for (let k = 1; k <= b.range; k++) {
          const x = b.tx + dx * k, y = b.ty + dy * k;
          if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) break;
          const idx = y * GRID_W + x;
          if (cells[idx] !== CELL_FLOOR) break;
          if (f < danger[idx]) danger[idx] = f;
          if (at[idx] >= 0) break;
        }
      }
    }
    if (!any) return;
    const mark = this.set.fx.hazard;
    for (let idx = 0; idx < CELLS; idx++) {
      const f = danger[idx];
      if (f > DANGER_TICKS) continue;
      const u = 1 - f / DANGER_TICKS;                                                 // 0 far away .. 1 about to burn
      const pulse = reduced ? 1 : 0.88 + 0.12 * Math.sin(now * (0.008 + 0.01 * u));                // 1.3 Hz rising to 2.9 Hz: never a strobe
      g.globalAlpha = (0.4 + 0.6 * u) * pulse;
      drawSprite(g, mark, (idx % GRID_W) * T, Math.floor(idx / GRID_W) * T);
    }
    g.globalAlpha = 1;
  }

  flightHeight(b) {
    const f = b.fly, total = Math.hypot(f.tx - f.fx, f.ty - f.fy);
    const u = total > 0.01 ? clamp(Math.hypot(b.x - f.fx, b.y - f.fy) / total, 0, 1) : 1 - clamp(f.left / (f.total || THROW_TICKS), 0, 1);
    return 4 * (0.7 + 0.28 * total) * u * (1 - u);
  }

  paintFlames(g, view, T, now, reduced) {
    const fl = view.flames, set = this.set;
    if (!fl.length) return;
    const frame = reduced ? (Math.floor(now / 250) & 1) * 2 : Math.floor(now / 125) & 3;   // one counter for all tiles so arms join; <= 8 Hz
    for (let i = 0; i < fl.length; i++) {
      // Fire fades in over 3 ticks and out over the last 9; scaling the sprites instead would cost several times more per tile.
      const f = fl[i], age = FLAME_TICKS - f.ticksLeft;
      const a = age < 3 ? 0.55 + 0.15 * age : f.ticksLeft < 9 ? f.ticksLeft / 9 : 1;
      if (a < 1) g.globalAlpha = a;
      drawSprite(g, set.flame(f.mask, frame), f.x * T, f.y * T);
      if (a < 1) g.globalAlpha = 1;
    }
  }

  paintEntities(g, view, T, now, reduced) {
    const { list, cells, set } = this;
    list.clear();
    const ps = view.players, bs = view.bombs, gs = view.ghostBombs, its = view.items;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], fx = this.players.get(p.id);
      if (!fx || fx.gone) continue;
      if (!fx.dead || (fx.deathAt >= 0 && (now - fx.deathAt) / TICK_MS < DYING_TICKS)) list.add(E_PLAYER, i, p.y + 0.33);
    }
    for (let i = 0; i < bs.length; i++) if (!bs[i].fly) list.add(E_BOMB, i, bs[i].y + 0.32);
    for (let i = 0; i < gs.length; i++) list.add(E_GHOST, i, gs[i].y + 0.32);
    for (let i = 0; i < its.length; i++) list.add(E_ITEM, i, its[i].y + 0.1);
    for (let i = 0; i < this.pops.length; i++) list.add(E_POP, i, this.pops[i].ty + 1);
    list.sort();
    const { order, key } = list;
    let e = 0;
    for (let row = 0; row < GRID_H; row++) {
      while (e < list.n && key[order[e]] < row + 1) { this.drawEntity(g, view, order[e], T, now, reduced); e++; }
      if (row === 0 || row === GRID_H - 1) continue;   // the border ring is baked
      for (let col = 1; col < GRID_W - 1; col++) {
        const c = cells[row * GRID_W + col];
        if (c === CELL_FLOOR) continue;
        const sprite = c === CELL_HARD ? set.hardWallAt(col, row) : c === CELL_SOFT ? set.softBlockAt(col, row) : set.suddenWall;
        drawSprite(g, sprite, col * T, row * T);
      }
    }
    while (e < list.n) { this.drawEntity(g, view, order[e], T, now, reduced); e++; }
  }

  drawEntity(g, view, i, T, now, reduced) {
    const { type, ref } = this.list;
    switch (type[i]) {
      case E_PLAYER: this.drawPlayer(g, view, view.players[ref[i]], T, now, reduced); break;
      case E_BOMB: this.drawBomb(g, view, view.bombs[ref[i]], T, now, reduced); break;
      case E_GHOST: this.drawGhostBomb(g, view.ghostBombs[ref[i]], T, now, reduced); break;
      case E_ITEM: this.drawItem(g, view.items[ref[i]], T, now, reduced); break;
      default: {
        const p = this.pops[ref[i]];
        drawSprite(g, this.set.softPopAt(p.tx, p.ty, Math.floor((now - p.t0) / 50)), p.tx * T, p.ty * T);
      }
    }
  }

  // ---- Fighters ----------------------------------------------------------------------------------------------------

  /** Squash/stretch/hop from the fighter's latest action, written into this.pose. */
  actionPose(fx, now, reduced) {
    const o = this.pose;
    o.sx = 1; o.sy = 1; o.dx = 0; o.dy = 0;
    let t = (now - fx.placeAt) / 200;
    if (t >= 0 && t < 1) { const s = Math.sin(t * Math.PI); o.sx += 0.13 * s; o.sy -= 0.16 * s; }
    t = (now - fx.kickAt) / 200;
    if (t >= 0 && t < 1) { const s = Math.sin(t * Math.PI); o.sx += 0.1 * s; o.sy -= 0.08 * s; }
    t = (now - fx.throwAt) / 300;
    if (t >= 0 && t < 1) { const s = Math.sin(t * Math.PI); o.sx -= 0.06 * s; o.sy += 0.12 * s; o.dy -= 0.08 * s; }
    t = (now - fx.pickupAt) / 260;
    if (t >= 0 && t < 1) { const s = Math.sin(t * Math.PI); o.sx -= 0.05 * s; o.sy += 0.08 * s; o.dy -= 0.16 * s; }
    t = (now - fx.hitAt) / 220;
    if (t >= 0 && t < 1 && !reduced) o.dx += Math.sin(t * 40) * 0.05 * (1 - t);
    return o;
  }

  drawPlayer(g, view, p, T, now, reduced) {
    const set = this.set, fx = this.players.get(p.id);
    const ci = clamp(p.color | 0, 0, PLAYER_COLORS.length - 1);
    const ch = set.character(ci), face = p.facing & 3;
    const px = p.x * T, py = p.y * T;
    if (fx.dead) { this.drawDying(g, p, fx, ch, face, T, now); return; }
    const pose = this.actionPose(fx, now, reduced);
    let sprite, bob = 0;
    if (fx.cheerAt >= 0) {
      sprite = ch.cheer[Math.floor((now - fx.cheerAt) / 115) & 3];
    } else if (fx.moving) {
      sprite = ch.walk[face][walkFrame(fx.walk) % WALK_FRAMES];
    } else {
      if (now > fx.blinkAt + 130) fx.blinkAt = now + 2200 + Math.random() * 2800;
      sprite = now >= fx.blinkAt ? ch.blink[face] : ch.idle[face];
      if (!reduced) bob = Math.sin(now * 0.0042 + fx.phase) * 0.014;
    }
    const feet = 0.33 * T;
    const cx = Math.round(px + pose.dx * T), cy = Math.round(py + (pose.dy + bob) * T + feet * (1 - pose.sy));
    // shadow shrinks while hopping
    const lift = clamp(-pose.dy * 3, 0, 0.4);
    drawSprite(g, set.fx.shadow, Math.round(px), Math.round(py + 0.36 * T), 0.95 - lift * 0.5);
    const teams = this.teamMode(view);
    if (teams) drawSprite(g, set.teamRing[p.team & 1], Math.round(px), Math.round(py + 0.34 * T));
    if (p.isMe) this.paintLocalRing(g, px, py, T, now, teams, this.dangerAt(p));
    drawSprite(g, sprite, cx, cy, pose.sx, pose.sy);
    // shield bubble: item shield first (its last 2 s blink), else the spawn shield (blinks all along)
    if (p.shield > 0 && p.shield !== SHIELD_FOREVER) {
      const blink = p.shield <= 120 && !reduced && (Math.floor(now / 90) & 1);
      g.globalAlpha = blink ? 0.35 : 1;
      drawSprite(g, set.shield[Math.floor(now / 110) & 3], cx, Math.round(py - 0.02 * T), 1 + this.hitPulse(fx, now));
      g.globalAlpha = 1;
    } else if (p.spawnShield > 0) {
      g.globalAlpha = reduced ? 0.8 : (Math.floor(now / 110) & 1) ? 0.45 : 0.95;
      drawSprite(g, set.spawnShield[Math.floor(now / 110) & 3], cx, Math.round(py - 0.02 * T));
      g.globalAlpha = 1;
    }
    if (p.curse) drawSprite(g, set.curseAura[Math.floor(now / 85) & 7], cx, Math.round(py + 0.05 * T));
    const hurt = (now - fx.hitAt) / 200;
    if (hurt >= 0 && hurt < 1 && p.shield === 0) { g.globalAlpha = 0.85 * (1 - hurt); drawSprite(g, ch.flash[face], cx, cy, pose.sx, pose.sy); g.globalAlpha = 1; }
  }

  measureContext() {
    if (!this.probe) this.probeCanvas = this.makeCanvas(4, 4), this.probe = this.probeCanvas.getContext('2d');
    return this.probe;
  }

  hitPulse(fx, now) {
    const t = (now - fx.hitAt) / 260;
    return t >= 0 && t < 1 ? 0.14 * Math.sin(t * Math.PI) : 0;
  }

  /** Ticks until the tile under a fighter burns (NO_DANGER when no bomb threatens it). */
  dangerAt(p) {
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    return tx >= 0 && ty >= 0 && tx < GRID_W && ty < GRID_H ? this.danger[ty * GRID_W + tx] : NO_DANGER;
  }

  /** The gold ring that says "this one is you"; it turns to a pulsing red warning while a bomb is about to burn the tile underfoot. */
  paintLocalRing(g, px, py, T, now, teams, danger) {
    const alarm = danger <= DANGER_ALERT_TICKS && !this.reducedEffects;
    const swell = alarm ? 0.05 * Math.sin(now * 0.018) : 0.02 * Math.sin(now * 0.006);
    g.strokeStyle = danger <= DANGER_ALERT_TICKS ? '#ff5a3c' : '#ffe06e';
    g.globalAlpha = 0.92;
    g.lineWidth = Math.max(2, T * (danger <= DANGER_ALERT_TICKS ? 0.08 : 0.06));
    g.beginPath();
    g.ellipse(px, py + 0.35 * T, T * ((teams ? 0.53 : 0.44) + swell), T * ((teams ? 0.24 : 0.19) + swell * 0.4), 0, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
  }

  /** hurt flash, dizzy spin shrinking away, then the ghost floats up (drawn in paintAloft). */
  drawDying(g, p, fx, ch, face, T, now) {
    const tk = (now - fx.deathAt) / TICK_MS;
    if (tk >= DYING_TICKS) return;
    const px = p.x * T, py = p.y * T;
    if (tk < 6) {
      drawSprite(g, this.set.fx.shadow, Math.round(px), Math.round(py + 0.36 * T), 0.95);
      drawSprite(g, ch.idle[face], Math.round(px), Math.round(py));
      g.globalAlpha = 1 - tk / 8; drawSprite(g, ch.flash[face], Math.round(px), Math.round(py)); g.globalAlpha = 1;
      return;
    }
    const u = (tk - 6) / (DYING_TICKS - 6), frame = Math.floor((tk - 6) / 5) % ch.death.length;
    const s = 1 - 0.75 * u * u;
    drawSprite(g, this.set.fx.shadow, Math.round(px), Math.round(py + 0.36 * T), 0.95 * s);
    g.globalAlpha = 1 - u * u * u;
    drawSprite(g, ch.death[frame], Math.round(px), Math.round(py - Math.sin(u * Math.PI) * 0.4 * T + 0.1 * T), s);
    g.globalAlpha = 1;
  }

  // ---- Bombs and items ---------------------------------------------------------------------------------------------

  ownerColor(view, id) {
    const ps = view.players;
    for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i].color;
    return -1;
  }

  drawBomb(g, view, b, T, now, reduced) {
    const set = this.set, fx = this.bombs.get(b.id);
    if (!fx) return;
    const color = b.owner >= 0 ? this.ownerColor(view, b.owner) : -1;
    const hot = b.fuse <= 30 && (reduced || (Math.floor(b.fuse / 6) & 1) === 0);
    const sprite = set.bomb(color, Math.floor(fx.phase * BOMB_PULSE.length), hot);
    const t = clamp((now - fx.born) / 240, 0, 1);
    const pop = t < 1 ? 0.35 + 0.65 * easeOutBack(t) : 1;
    let sx = pop, sy = pop;
    const land = (now - fx.landAt) / 200;
    if (land >= 0 && land < 1) { const s = Math.sin(land * Math.PI); sx *= 1 + 0.2 * s; sy *= 1 - 0.22 * s; }
    const px = Math.round(b.x * T), py = b.y * T;
    if (!b.fly) drawSprite(g, set.fx.shadow, px, Math.round(py + 0.34 * T), 0.9 * sx);   // (a thrown bomb's shadow is on the floor layer)
    if (b.dir === 0 && !b.fly) { drawSprite(g, sprite, px, Math.round(py), sx, sy); return; }
    // Rolling or flying: the whole ball turns, so the fuse whirls around it. The body's centre is 0.08 tile below the sprite anchor.
    g.save();
    try {
      g.translate(px, Math.round(py + (b.fly ? -this.flightHeight(b) * T : 0) + 0.08 * T));
      g.rotate(b.fly ? fx.spin * 0.5 : fx.spin);
      drawSprite(g, sprite, 0, Math.round(-0.08 * T), sx, sy);
    } finally {
      g.restore();
    }
  }

  drawGhostBomb(g, gb, T, now, reduced) {
    const set = this.set, idx = Math.floor(gb.y) * GRID_W + Math.floor(gb.x);
    const born = idx >= 0 && idx < CELLS ? this.tilePop[idx] : now;
    const phase = idx >= 0 && idx < CELLS ? this.tilePhase[idx] : 0;
    const t = clamp((now - born) / 240, 0, 1), sc = t < 1 ? 0.35 + 0.65 * easeOutBack(t) : 1;
    const px = Math.round(gb.x * T), py = Math.round(gb.y * T);
    drawSprite(g, set.fx.shadow, px, Math.round(py + 0.34 * T), 0.9 * sc);
    drawSprite(g, set.bomb(this.localColor, Math.floor((reduced ? 0 : phase) * BOMB_PULSE.length), false), px, py, sc);
  }

  drawItem(g, it, T, now, reduced) {
    const set = this.set, fx = this.items.get(it.id), token = set.item(it.kind);
    if (!fx || !token) return;
    const t = clamp((now - fx.born) / 320, 0, 1), sc = t < 1 ? easeOutBack(t) : 1;
    const bob = reduced ? 0 : Math.sin(now * 0.005 + it.id * 1.7) * 0.05;
    const jitter = it.kind === 'skull' && !reduced ? Math.sin(now * 0.05) * 0.012 : 0;
    const px = Math.round((it.x + jitter) * T), py = Math.round((it.y - 0.04 + bob) * T);
    drawSprite(g, set.fx.shadow, Math.round(it.x * T), Math.round((it.y + 0.3) * T), 0.6 - bob * 0.8);
    drawSprite(g, token, px, py, sc);
  }

  // ---- Things above the y-sorted layer -------------------------------------------------------------------------------

  paintAloft(g, view, T, now) {
    const { set } = this;
    const ps = view.players;
    // ghosts of defeated fighters float up and fade
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], fx = this.players.get(p.id);
      if (!fx || !fx.dead || fx.gone || fx.deathAt < 0) continue;
      const tk = (now - fx.deathAt) / TICK_MS;
      if (tk < GHOST_FROM_TICKS || tk >= DEATH_ANIM_TICKS) continue;
      const u = (tk - GHOST_FROM_TICKS) / (DEATH_ANIM_TICKS - GHOST_FROM_TICKS), ci = clamp(p.color | 0, 0, PLAYER_COLORS.length - 1);
      g.globalAlpha = u < 0.2 ? u / 0.2 : 1 - clamp((u - 0.55) / 0.45, 0, 1);
      drawSprite(g, set.character(ci).ghost[Math.floor(now / 220) & 1], Math.round(p.x * T + Math.sin(u * 7) * 0.08 * T), Math.round((p.y - 0.1 - easeOutCubic(u) * 1.3) * T), 0.9);
    }
    g.globalAlpha = 1;
    // thrown bombs were sorted out of the list: they fly over walls
    const bs = view.bombs;
    for (let i = 0; i < bs.length; i++) if (bs[i].fly) this.drawBomb(g, view, bs[i], T, now, this.reducedEffects);
    // sudden-death blocks falling in
    const fl = view.falling;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      if (f.ticksLeft > 26) continue;
      const u = f.ticksLeft / 26, off = u * u * 7 * T;
      drawSprite(g, set.suddenWall, f.tx * T, Math.round(f.ty * T - off));
    }
  }

  /** Additive bloom around flames. */
  paintLight(g, view, T, now, reduced) {
    const fl = view.flames, set = this.set;
    if (!fl.length) return;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      // one glow per two tiles along a straight arm is enough to light the whole arm (the sprite is 1.3 tiles wide)
      if ((f.mask === 5 || f.mask === 10) && ((f.x + f.y) & 1)) continue;
      const flick = reduced ? 1 : 0.8 + 0.2 * Math.sin(now * 0.03 + f.x * 3 + f.y * 5);
      g.globalAlpha = clamp(f.ticksLeft / 18, 0, 1) * 0.42 * flick;
      drawSprite(g, set.fx.flameGlow, f.x * T, f.y * T);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // ---- Overlays ----------------------------------------------------------------------------------------------------

  paintOverlays(g, view, T, now, reduced) {
    const set = this.set, ps = view.players, n = Math.min(ps.length, TAG_CAP);
    const rect = this.tagRect, tagOf = this.tagOf, above = this.headTop, dpr = this.layout.dpr;
    let tags = 0;
    for (let i = 0; i < n; i++) {
      const p = ps[i], fx = this.players.get(p.id);
      above[i] = NaN;
      if (!fx || fx.gone) continue;
      let y = (p.y - TAG_ABOVE) * T;                                   // what sits on a fighter's head starts here
      if (this.showNames && !fx.dead && p.name && tagWanted(p.isMe, T, dpr)) {
        if (!fx.tag || fx.tagName !== p.name || fx.tagColor !== p.color || fx.tagMe !== p.isMe || fx.tagT !== T || fx.tagDpr !== dpr) {
          fx.releaseTag();
          fx.tag = buildNameTag(this.makeCanvas, this.measureContext(), p.name, PLAYER_COLORS[clamp(p.color | 0, 0, PLAYER_COLORS.length - 1)].hex, p.isMe, T, dpr);
          fx.tagName = p.name; fx.tagColor = p.color; fx.tagMe = p.isMe; fx.tagT = T; fx.tagDpr = dpr;
        }
        const tag = fx.tag, at = tags * 4;
        rect[at] = Math.round(p.x * T - tag.w / 2); rect[at + 1] = Math.round(y - tag.h); rect[at + 2] = tag.w; rect[at + 3] = tag.h;
        tagOf[tags++] = i;
        y -= tag.h;
      }
      above[i] = y;
    }
    if (tags > 1) this.spreadTags(tags, view, T);
    for (let k = 0; k < tags; k++) {
      const i = tagOf[k], at = k * 4;
      g.drawImage(this.players.get(ps[i].id).tag.canvas, rect[at], rect[at + 1]);
      above[i] = rect[at + 1];
    }
    for (let i = 0; i < n; i++) {
      const p = ps[i], fx = this.players.get(p.id), y = above[i];
      if (!fx || y !== y) continue;                                    // (NaN: not drawn at all)
      const px = Math.round(p.x * T);
      if (p.isMe && !fx.dead && (view.state === STATE.COUNTDOWN || now - this.goAt < 2200)) this.paintArrow(g, px, y - 0.06 * T, T, now, reduced);
      const age = now - fx.emoteAt;
      if (fx.emote >= 0 && age < 2400) {
        const pop = age < 240 ? easeOutBack(age / 240) : 1, out = age > 2000 ? (age - 2000) / 400 : 0;
        g.globalAlpha = 1 - out;
        drawSprite(g, set.emote(fx.emote), px, Math.round(y - (0.1 + out * 0.3) * T), pop);
        g.globalAlpha = 1;
      }
    }
    this.texts.draw(g, T, FONT);
    this.paintBanner(g, T, now, reduced);
  }

  /**
   * Push overlapping name tags apart (rects in this.tagRect, owners in this.tagOf) along the axis on which they overlap least: two
   * fighters in a brawl would otherwise print over each other's name. The local fighter's tag stays put; tags stay on the canvas.
   */
  spreadTags(n, view, T) {
    const r = this.tagRect, of = this.tagOf, ps = view.players, L = this.layout, k = L.tile / T;
    const minX = -L.ox / k, maxX = (L.width - L.ox) / k, minY = -L.oy / k;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const A = a * 4, B = b * 4;
          const ox = Math.min(r[A] + r[A + 2], r[B] + r[B + 2]) - Math.max(r[A], r[B]) + 2;
          const oy = Math.min(r[A + 1] + r[A + 3], r[B + 1] + r[B + 3]) - Math.max(r[A + 1], r[B + 1]) + 2;
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          const meA = ps[of[a]].isMe, meB = ps[of[b]].isMe;
          if (oy <= ox) {
            const up = r[A + 1] <= r[B + 1] ? A : B, low = up === A ? B : A;
            if ((up === A ? meA : meB) && !(low === A ? meA : meB)) r[low + 1] += oy; else r[up + 1] -= oy;
          } else {
            const left = r[A] <= r[B] ? A : B, right = left === A ? B : A;
            const meL = left === A ? meA : meB, meR = right === A ? meA : meB;
            if (meL) r[right] += ox; else if (meR) r[left] -= ox; else { r[left] -= ox / 2; r[right] += ox / 2; }
          }
        }
      }
      for (let a = 0; a < n; a++) {
        const A = a * 4;
        r[A] = Math.round(clamp(r[A], minX + 1, maxX - r[A + 2] - 1));
        r[A + 1] = Math.round(Math.max(r[A + 1], minY + 1));
      }
      if (!moved) break;
    }
  }

  paintArrow(g, x, y, T, now, reduced) {
    const bob = reduced ? 0 : Math.sin(now * 0.008) * 0.08 * T, s = T * 0.2;
    g.beginPath();
    g.moveTo(x - s, y - s * 1.6 + bob); g.lineTo(x + s, y - s * 1.6 + bob); g.lineTo(x, y - s * 0.2 + bob); g.closePath();
    g.fillStyle = GOLD; g.fill();
    g.lineWidth = Math.max(2, T * 0.05); g.strokeStyle = '#3a2408'; g.lineJoin = 'round'; g.stroke();
  }

  paintBanner(g, T, now, reduced) {
    const b = this.banner, age = now - b.t0;
    if (age < 0 || age >= b.dur) return;
    const inMs = 260, outMs = 380;
    const a = age < inMs ? age / inMs : age > b.dur - outMs ? (b.dur - age) / outMs : 1;
    const pop = reduced ? 1 : age < inMs ? 0.55 + 0.45 * easeOutBack(age / inMs) : 1;
    const size = Math.round(T * (b.kind === 'sd' ? 1 : 0.9));
    g.save();
    try {
      g.globalAlpha = clamp(a, 0, 1);
      g.translate(GRID_W * T / 2, GRID_H * T * 0.36);
      g.scale(pop, pop);
      g.font = boldFont(size); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = size * 0.2; g.strokeStyle = 'rgba(27,16,51,0.95)'; g.strokeText(b.text, 0, size * 0.05);
      g.fillStyle = b.kind === 'sd' ? '#ff6a3d' : GOLD; g.fillText(b.text, 0, 0);
    } finally {
      g.restore();
    }
  }

  /** Flash, tints and the debug text in screen space. */
  paintScreen(g, view, L, now, reduced) {
    const fl = this.flash, t = now - fl.t0;
    if (!reduced && t >= 0 && t < FLASH_RAMP_MS + FLASH_DECAY_MS) {
      const a = (t < FLASH_RAMP_MS ? t / FLASH_RAMP_MS : 1 - (t - FLASH_RAMP_MS) / FLASH_DECAY_MS) * fl.peak;
      g.fillStyle = 'rgb(255,240,214)';
      g.globalAlpha = clamp(a, 0, FLASH_MAX_ALPHA);
      g.fillRect(0, 0, L.width, L.height);
      g.globalAlpha = 1;
    }
    if (this.tintCurse) {
      const me = this.localPlayer(view);
      if (me && me.alive && me.curse) {
        g.fillStyle = this.tintCurse;
        g.globalAlpha = reduced ? 0.16 : 0.12 + 0.05 * Math.sin(now * 0.005);
        g.fillRect(0, 0, L.width, L.height);
        g.globalAlpha = 1;
      }
      if (view.suddenDeath && view.state === STATE.PLAYING) {
        g.fillStyle = this.tintDanger;
        g.globalAlpha = reduced ? 0.1 : 0.08 + 0.03 * Math.sin(now * 0.003);
        g.fillRect(0, 0, L.width, L.height);
        g.globalAlpha = 1;
      }
    }
  }

  localPlayer(view) {
    const ps = view.players;
    for (let i = 0; i < ps.length; i++) if (ps[i].isMe) return ps[i];
    return null;
  }

  get localColor() { return this.myColor ?? 0; }

  /**
   * The numbers of the `?debug=1` overlay of section 8.2 that only the renderer knows: fps, frame times, dpr, tile size, quality, atlases and
   * particles. main.js can hand it to boot.js's overlay (`window.__bpDebug.info(...)`) or use setDebug(true) to have the canvas draw it.
   */
  debugText() {
    const s = this.stats, L = this.layout;
    return `fps ${s.fps}  frame ${s.frameMs.toFixed(1)}ms  render ${s.renderMs.toFixed(2)}ms\n`
      + `dpr ${L ? L.dpr.toFixed(2) : '-'}  tile ${s.tilePx}px  q${s.quality}  atlases ${(this.set ? 1 : 0) + (this.build ? 1 : 0)}  particles ${s.particles}`;
  }

  /** The canvas overlay (setDebug(true)): debugText() plus rtt, ws state and the last errors, rebuilt twice a second, not every frame. */
  paintDebug(g, L) {
    if (this.now - this.debugAt > 500 || this.debugAt > this.now) {
      this.debugAt = this.now;
      const d = this.debugInfo;
      this.debugLines = [...this.debugText().split('\n'), `rtt ${d.rtt}ms  ws ${d.ws}`, ...this.errors.concat(d.errors).slice(-5)];
    }
    const lines = this.debugLines, fs = Math.max(11, Math.round(11 * L.dpr));
    g.font = `${fs}px monospace`; g.textAlign = 'left'; g.textBaseline = 'top';
    let w = 0;
    for (let i = 0; i < lines.length; i++) w = Math.max(w, g.measureText(lines[i]).width);
    w = Math.min(L.width - 8, w + 12);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(4, 4, w, lines.length * (fs + 3) + 8);
    g.fillStyle = '#9dffb0';
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], 10, 8 + i * (fs + 3), w - 12);
  }

  // ---- Events -> effects -------------------------------------------------------------------------------------------

  /** Take particles from the frame's share; false when it is used up. */
  spend(n) {
    if (this.emitBudget < n) return false;
    this.emitBudget -= n;
    return true;
  }

  startShake(amp, now) {
    if (this.reducedEffects) return;
    const cur = this.shake, age = now - cur.t0;
    const left = age < SHAKE_MS ? cur.amp * (1 - age / SHAKE_MS) ** 2 : 0;
    if (amp > left) { cur.amp = Math.min(SHAKE_MAX_PX, amp); cur.t0 = now; this.stats.shakes++; }
  }

  /** A warm white flash, at most FLASH_MAX_ALPHA strong and at most one per FLASH_MIN_GAP_MS. */
  startFlash(strength, now) {
    if (this.reducedEffects) return false;
    const fl = this.flash;
    if (now - fl.t0 < FLASH_MIN_GAP_MS) return false;
    fl.t0 = now; fl.peak = clamp(FLASH_MAX_ALPHA * strength, 0.04, FLASH_MAX_ALPHA);
    fl.count++;
    this.stats.flashes = fl.count;
    return true;
  }

  showBanner(text, kind, dur, now) {
    const b = this.banner;
    b.text = text; b.kind = kind; b.t0 = now; b.dur = dur;
  }

  playerById(view, id) {
    const ps = view.players;
    for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }

  /** 1 next to the local fighter, fading to 0.45 across the arena. */
  proximity(view, x, y) {
    const me = this.localPlayer(view);
    if (!me) return 0.7;
    return clamp(1.1 - Math.hypot(me.x - x, me.y - y) / 14, 0.45, 1);
  }

  onEvent(e, view, now) {
    const pt = this.particles, detail = this.fxLevel.sparks;
    switch (e[0]) {
      case 'go': {
        this.goAt = now;
        const ps = view.players;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          if (!p.alive) continue;
          if (this.spend(6)) { pt.ring(p.x, p.y + 0.3, 0, 0.2, 1.1, 0.5, RING.WHITE, 0.7); pt.stars(p.x, p.y, 0.4, 3, 1.6); }
        }
        break;
      }
      case 'bomb': {
        const [, , owner, tx, ty] = e;
        const idx = ty * GRID_W + tx;
        if (idx >= 0 && idx < CELLS) { if (this.tileSeen[idx] < this.frameNo - 3) this.tilePop[idx] = now; }
        const fx = this.players.get(owner);
        if (fx) fx.placeAt = now;
        if (this.spend(2)) pt.dust(tx + 0.5, ty + 0.62, 2, 0.24, 0.3, 0.15);
        break;
      }
      case 'boom': this.onBoom(e, view, now, detail); break;
      case 'block': {
        const [, tx, ty] = e;
        this.pops.push({ tx, ty, t0: now });
        if (this.spend(9)) { pt.debris(tx + 0.5, ty + 0.5, detail > 1 ? 6 : 4); pt.dust(tx + 0.5, ty + 0.6, 3, 0.3, 0.4, 0.3); }
        break;
      }
      case 'itemspawn': {
        const [, , tx, ty, kind] = e;
        if (this.spend(6)) { pt.ring(tx + 0.5, ty + 0.55, 0.05, 0.1, 0.55, 0.4, RING.WHITE, 0.8); pt.sparkle(tx + 0.5, ty + 0.5, 0.2, 5, Math.max(0, ITEM_KINDS.indexOf(kind))); }
        break;
      }
      case 'pickup': {
        const [, , playerId, kind, tx, ty] = e;
        const ki = Math.max(0, ITEM_KINDS.indexOf(kind)), fx = this.players.get(playerId);
        if (fx) fx.pickupAt = now;
        if (this.spend(12)) { pt.sparkle(tx + 0.5, ty + 0.5, 0.2, 9, ki, 2.4); pt.ring(tx + 0.5, ty + 0.6, 0.05, 0.15, 0.7, 0.4, RING.WHITE, 0.8); }
        const me = this.playerById(view, playerId);
        if (me && me.isMe && ITEM_LABELS[kind]) this.texts.add(ITEM_LABELS[kind], me.x, me.y, ITEM_COLORS[kind]);
        break;
      }
      case 'itemgone': {
        const [, , tx, ty, kind] = e;
        if (this.spend(6)) { pt.sparks(tx + 0.5, ty + 0.5, 0.1, 4, 2, 0.4, 0.5); pt.smoke(tx + 0.5, ty + 0.5, 0.1, 2, true, 0.4, 0.7, 0.15); }
        if (kind === 'skull' && this.spend(3)) pt.skulls(tx + 0.5, ty + 0.5, 2);
        break;
      }
      case 'bombgone': {
        const [, , tx, ty] = e;
        if (this.spend(5)) { pt.dust(tx + 0.5, ty + 0.55, 3, 0.3, 0.35, 0.2); pt.sparks(tx + 0.5, ty + 0.5, 0.2, 3, 1.8, 0.4, 0.5); }
        break;
      }
      case 'death': {
        const [, victim, , x, y] = e;
        const fx = this.fxFor(victim);
        fx.deathAt = now; fx.poofed = false; fx.dead = true; fx.hitAt = now;
        if (this.spend(14)) { pt.stars(x, y, 0.3, 6, 2.6); pt.ring(x, y + 0.2, 0.1, 0.15, 1, 0.45, RING.WHITE, 0.9); pt.smoke(x, y, 0.15, 2, false, 0.45, 0.8, 0.2); }
        const me = this.playerById(view, victim);
        if (me && me.isMe) this.startShake(3.2, now);
        break;
      }
      case 'left': {
        const p = this.playerById(view, e[1]);
        const fx = this.fxFor(e[1]);
        fx.gone = true; fx.dead = true; fx.deathAt = -1;
        if (p && this.spend(9)) { pt.smoke(p.x, p.y, 0.1, 5, false, 0.5, 0.9, 0.25); pt.sparkle(p.x, p.y, 0.3, 4, 0, 1.4); }
        break;
      }
      case 'shieldhit': {
        const [, id, x, y] = e;
        const fx = this.players.get(id);
        if (fx) fx.hitAt = now;
        if (this.spend(8)) { pt.ring(x, y, 0.2, 0.3, 1.1, 0.35, RING.ICE, 0.9); pt.glow(x, y, 0.3, 1.1, 0.25, true, 0.8); pt.sparkle(x, y, 0.3, 5, ITEM_KINDS.indexOf('shield'), 2.2); }
        break;
      }
      case 'kick': {
        const [, id, bombId] = e;
        const fx = this.players.get(id);
        if (fx) fx.kickAt = now;
        const b = this.bombs.get(bombId);
        if (b && this.spend(4)) pt.dust(b.x, b.y + 0.3, 3, 0.26, 0.3, 0.2);
        break;
      }
      case 'throw': {
        const [, id, , ftx, fty] = e;
        const fx = this.players.get(id);
        if (fx) fx.throwAt = now;
        if (this.spend(3)) pt.dust(ftx + 0.5, fty + 0.55, 3, 0.26, 0.3, 0.2);
        break;
      }
      case 'land': {
        const [, bombId, tx, ty] = e;
        const b = this.bombs.get(bombId);
        if (b) b.landAt = now;
        if (this.spend(8)) { pt.dust(tx + 0.5, ty + 0.62, 5, 0.32, 0.5, 0.2); pt.ring(tx + 0.5, ty + 0.6, 0, 0.15, 0.8, 0.3, RING.WHITE, 0.7); }
        this.startShake(1.6 * this.proximity(view, tx + 0.5, ty + 0.5), now);
        break;
      }
      case 'curse': this.onCurse(e, view); break;
      case 'sdstart':
        this.showBanner('SUDDEN DEATH!', 'sd', 2300, now);
        this.startShake(2.5, now);
        this.startFlash(0.6, now);
        break;
      case 'sdland': {
        const [, tx, ty] = e;
        if (this.spend(14)) { pt.dust(tx + 0.5, ty + 0.6, 6, 0.4, 0.6, 0.35); pt.debris(tx + 0.5, ty + 0.5, 4, 3.4); pt.ring(tx + 0.5, ty + 0.6, 0, 0.2, 1.2, 0.35, RING.FIRE, 0.8); }
        this.startShake(3 * this.proximity(view, tx + 0.5, ty + 0.5), now);
        break;
      }
      case 'showdown': this.showBanner('SHOWDOWN', 'showdown', 2300, now); break;
      default: break;
    }
  }

  onBoom(e, view, now, detail) {
    const pt = this.particles;
    const [, , , tx, ty, range, tiles] = e;
    const cx = tx + 0.5, cy = ty + 0.5;
    if (this.spend(30)) {
      pt.glow(cx, cy, 0.2, 3.4, 0.32, false, 1);
      pt.ring(cx, cy, 0.15, 0.3, 1.9 + range * 0.12, 0.42, RING.FIRE, 0.95);
      pt.sparks(cx, cy, 0.3, 6 + detail * 3, 4.5, 0.55, 0.85);
      pt.smoke(cx, cy, 0.2, 3, true, 0.7, 1.4, 0.4);
      pt.embers(cx, cy, 3 + detail * 2, 0.5, 1.6);
    }
    if (Array.isArray(tiles)) {
      const n = Math.min(tiles.length, 48);
      for (let i = 0; i < n; i++) {
        const t = tiles[i];
        if (!t) continue;
        const x = t[0] + 0.5, y = t[1] + 0.5, dx = Math.sign(t[0] - tx), dy = Math.sign(t[1] - ty);
        if (dx === 0 && dy === 0) continue;
        if (detail > 0 && i % 2 === 1 && this.spend(2)) pt.streak(x - dx * 0.5, y - dy * 0.5, dx, dy, detail, 5, 0.35);
        if (i % 3 === 0 && this.spend(2)) { pt.smoke(x, y, 0.15, 1, true, 0.5, 1.1, 0.25); pt.embers(x, y, 1, 0.3, 1.2); }
      }
    }
    const near = this.proximity(view, cx, cy);
    this.startShake((1.6 + range * 0.5) * near, now);
    this.startFlash((0.5 + range * 0.1) * near, now);
  }

  onCurse(e, view) {
    const [, id, kind, from] = e;
    const p = this.playerById(view, id), pt = this.particles;
    if (!p) return;
    if (kind === 0) {
      if (this.spend(8)) { pt.sparkle(p.x, p.y, 0.4, 7, ITEM_KINDS.indexOf('speed'), 2); pt.ring(p.x, p.y + 0.2, 0.1, 0.2, 1, 0.4, RING.WHITE, 0.8); }
      if (p.isMe && p.alive) this.texts.add('CURED!', p.x, p.y, CURE_COLOR);
      return;
    }
    if (this.spend(10)) { pt.skulls(p.x, p.y, 4); pt.ring(p.x, p.y + 0.2, 0.1, 0.2, 1.1, 0.45, RING.CURSE, 0.9); }
    if (from >= 0) {
      const giver = this.playerById(view, from);
      if (giver && this.spend(6)) pt.skulls(giver.x, giver.y, 4, p.x, p.y);
    }
    const fx = this.players.get(id);
    if (fx) fx.hitAt = this.now;
    this.texts.add(CURSE_LABELS[kind] ?? String(kind).toUpperCase(), p.x, p.y, CURSE_COLOR, p.isMe ? 0.46 : 0.36, 1.3);
  }
}
