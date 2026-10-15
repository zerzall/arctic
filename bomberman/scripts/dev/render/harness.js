// Browser side of the renderer harness (developer tooling, not part of the game).
//
// Drives a REAL World (shared/world.js, seeded) with the autopilot and scripted staging, turns every tick into a View exactly as
// ClientGame will (view-adapter.js), feeds the events to the REAL Renderer and lets shots.mjs photograph the canvas.
// Time is synthetic (1/60 s per tick) so every run and every picture is reproducible.
//
// window.harness is the whole API; shots.mjs and perf.mjs call it through page.evaluate.
import { World } from '/shared/world.js';
import { Renderer } from '/js/render.js';
import { createView, fillView, roundFor } from '/__render/view-adapter.js';
import { AutoPilot } from '/__render/autopilot.js';
import { DIR_DX, DIR_DY, GRID_W, FUSE_TICKS } from '/shared/constants.js';

const TICK_MS = 1000 / 60;
const NAMES = ['Ana', 'Bolt', 'Chloe', 'Dmitry', 'Eve', 'Fuse', 'Grandma Rosalind-Maria', 'Zed'];

const h = {
  world: null, pilot: null, renderer: null, view: createView(), round: null, me: 0, nowMs: 1000, evCursor: 0,
  manual: new Map(), frozen: new Set(), rendered: 0, lastEvents: [],
};

function makeWorld(o) {
  const fighters = [];
  for (let i = 0; i < o.n; i++) fighters.push({ id: i, name: NAMES[i % NAMES.length], color: i % 8, team: i % 2, isBot: i !== o.me, lastSeq: 0 });
  return new World({ seed: o.seed, fighters, mode: o.mode, layout: o.layout, blocks: o.blocks, items: o.items, theme: o.theme, roundTime: o.roundTime, suddenDeath: o.suddenDeath });
}

/**
 * Start a fresh round.
 * @param {object} o { css:[w,h], dpr, theme, seed, n, mode, layout, blocks, items, roundTime, suddenDeath, quality, reduced, me,
 *                     reckless, bombRate, align }
 */
h.setup = function setup(o = {}) {
  const opts = {
    css: [960, 780], dpr: 1, theme: 'meadow', seed: 7, n: 8, mode: 'ffa', layout: 'classic', blocks: 'normal', items: 'normal',
    roundTime: 120, suddenDeath: true, quality: 2, reduced: false, me: 0, reckless: 0.01, bombRate: 0.07, align: 'auto', ...o,
  };
  h.opts = opts;
  if (h.renderer) h.renderer.dispose();
  const wrap = document.getElementById('wrap');
  wrap.style.width = `${opts.css[0]}px`; wrap.style.height = `${opts.css[1]}px`;
  wrap.replaceChildren();
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  h.canvas = canvas;
  h.me = opts.me;
  h.world = makeWorld(opts);
  h.pilot = new AutoPilot(h.world, { seed: opts.seed * 31 + 5, reckless: opts.reckless, bombRate: opts.bombRate });
  h.round = roundFor(h.world, opts.mode);
  h.renderer = new Renderer(canvas, { reducedEffects: opts.reduced, align: opts.align });
  h.renderer.setQuality(opts.quality);
  h.renderer.setPlayers(h.round);
  if (opts.direct) h.renderer.staticPolicy = () => false;   // experiment: draw the arena piece by piece instead of from its baked layer
  h.renderer.resize(opts.css[0], opts.css[1], opts.dpr);
  h.nowMs = 1000; h.evCursor = 0; h.manual.clear(); h.frozen.clear(); h.view = createView();
  // the first frames build the sprite set in time slices, exactly like the game
  for (let i = 0; i < 400 && !h.renderer.set; i++) h.frame(false);
  return { tile: h.renderer.layout.tile, width: canvas.width, height: canvas.height, builds: h.renderer.stats.builds };
};

/** cmd for fighter `id` this tick: manual override, else autopilot, else idle. */
function cmdFor(id) {
  const m = h.manual.get(id);
  if (m) {
    const c = { s: (m.seq = (m.seq ?? 0) + 1), d: m.d ?? 0, b: m.b ?? 0, x: m.x ?? 0 };
    m.b = 0; m.x = 0;
    if (m.ticks !== undefined && --m.ticks <= 0) h.manual.delete(id);
    return c;
  }
  if (h.frozen.has(id)) return { s: 0, d: 0, b: 0, x: 0 };
  return h.pilot.think(id);
}

/** Simulate one tick; when `render`, also build the View, hand over the events and draw. */
h.frame = function frame(render = true) {
  const w = h.world;
  for (const p of w.players) w.applyCmd(p.id, cmdFor(p.id));
  w.tick();
  h.nowMs += TICK_MS;
  const snap = w.snapshot({ grid: true, evFrom: h.evCursor });
  h.evCursor = w.evCount;
  w.trimEvents(h.evCursor);
  fillView(h.view, snap, h.round, h.me);
  h.lastEvents = snap.e;
  if (render) {
    h.renderer.handleEvents(snap.e, h.view, h.nowMs);
    h.renderer.render(h.view, TICK_MS, h.nowMs);
    h.rendered++;
  } else {
    h.renderer.render(h.view, TICK_MS, h.nowMs);   // keeps sprite builds moving; cheap enough
  }
};

/** n ticks; the last `keep` of them fully rendered (default all). Earlier ones only simulate and are not shown. */
h.advance = function advance(n, keep = n) {
  for (let i = 0; i < n; i++) {
    if (i < n - keep) {
      const w = h.world;
      for (const p of w.players) w.applyCmd(p.id, cmdFor(p.id));
      w.tick();
      h.nowMs += TICK_MS;
      h.evCursor = w.evCount; w.trimEvents(h.evCursor);
    } else h.frame(true);
  }
};

const PREDICATES = {
  flames: (n) => () => h.world.flames.length >= n,
  death: () => () => h.lastEvents.some((e) => e[0] === 'death'),
  boom: () => () => h.lastEvents.some((e) => e[0] === 'boom'),
  block: () => () => h.lastEvents.some((e) => e[0] === 'block'),
  sdland: () => () => h.lastEvents.some((e) => e[0] === 'sdland'),
  sdstart: () => () => h.lastEvents.some((e) => e[0] === 'sdstart'),
  ending: () => () => h.world.state >= 2,
  go: () => () => h.lastEvents.some((e) => e[0] === 'go'),
  pickup: () => () => h.lastEvents.some((e) => e[0] === 'pickup'),
  event: (code) => () => h.lastEvents.some((e) => e[0] === code),
  tick: (n) => () => h.world.tickNo >= n,
};

/** Run (rendering everything after `warm` silent ticks) until the predicate holds; returns the tick or -1. */
h.runUntil = function runUntil(name, arg, maxTicks = 4000, warm = 0) {
  const pred = PREDICATES[name](arg);
  h.advance(warm, 0);
  for (let i = 0; i < maxTicks; i++) {
    h.frame(true);
    if (pred()) return h.world.tickNo;
  }
  return -1;
};

/** Silently play the countdown away so bombs, flames and clocks run. */
h.skipCountdown = function skipCountdown() {
  while (h.world.state === 0) h.advance(1, 0);
  h.advance(2);
};

h.shot = () => h.canvas.toDataURL('image/png');

// ---- Staging: bend the World into the situation a picture needs (tooling only; the game never does this) -------------

const stage = {
  teleport(id, tx, ty, facing) {
    const p = h.world.player(id);
    p.x = tx + 0.5; p.y = ty + 0.5;
    if (facing !== undefined) p.facing = facing;
  },
  set(id, props) { Object.assign(h.world.player(id), props); },
  cell(tx, ty, ch) {
    const w = h.world;
    if (w.grid[ty * GRID_W + tx] !== ch) { w.grid[ty * GRID_W + tx] = ch; w.gridVer++; }
  },
  clear(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (h.world.grid[y * GRID_W + x] === '+') stage.cell(x, y, '.');
  },
  bomb(owner, tx, ty, { range, fuse } = {}) {
    const w = h.world, p = w.player(owner), keep = { x: p.x, y: p.y, range: p.range };
    p.x = tx + 0.5; p.y = ty + 0.5;
    if (range) p.range = range;
    w._placeBomb(p);
    p.x = keep.x; p.y = keep.y; p.range = keep.range;
    const b = w.bombs[w.bombs.length - 1];
    if (fuse !== undefined) b.fuse = fuse;
    b.pass = [];
    return b;
  },
  item(kind, tx, ty) {
    const w = h.world, it = { id: w._nextItemId++, tx, ty, kind, born: w.tickNo };
    w.items.push(it);
    w._emit('itemspawn', it.id, tx, ty, kind);
  },
  curse(id, kind, from = -1) {
    const p = h.world.player(id);
    p.curse = kind; p.curseTicks = 600;
    h.world._emit('curse', id, kind, from);
  },
  emit(...ev) { h.world._emit(...ev); },
  freeze(...ids) { for (const id of ids) h.frozen.add(id); },
  drive(id, cmd) { h.manual.set(id, { ...cmd }); },
  /** Make the whole round about to end up a "quiet" board: no autopilot for anyone but the listed ids. */
  quiet(except = []) { for (const p of h.world.players) if (!except.includes(p.id)) h.frozen.add(p.id); },
};
h.stage = stage;

// ---- Filmstrips: several frames of one place side by side ------------------------------------------------------------

/**
 * Step the round and cut the same region out of the canvas every `every` ticks.
 * @param {{ frames:number, every:number, crop:[number,number,number,number], scale?:number, cols?:number, label?:boolean, follow?:number }} o
 *   crop = [tx, ty, wTiles, hTiles] in arena tile units; `follow` = fighter id the crop tracks instead (centred on it).
 */
h.strip = function strip(o) {
  const L = h.renderer.layout, T = L.tile, scale = o.scale ?? 1, cols = o.cols ?? o.frames;
  let [cx, cy] = o.crop;
  const [, , cw, ch] = o.crop;
  const w = Math.round(cw * T * scale), hh = Math.round(ch * T * scale), rows = Math.ceil(o.frames / cols);
  const out = document.createElement('canvas');
  out.width = w * cols + (cols - 1) * 4; out.height = hh * rows + (rows - 1) * 4;
  const g = out.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, out.width, out.height);
  for (let f = 0; f < o.frames; f++) {
    if (f > 0) h.advance(o.every);
    else h.advance(1);
    if (o.follow !== undefined) { const p = h.world.player(o.follow); cx = p.x - cw / 2; cy = p.y - ch / 2 - 0.1; }
    const sx = L.ox + cx * T, sy = L.oy + cy * T;
    const col = f % cols, row = Math.floor(f / cols);
    g.drawImage(h.canvas, sx, sy, cw * T, ch * T, col * (w + 4), row * (hh + 4), w, hh);
    if (o.label !== false) {
      g.font = '14px monospace'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
      const txt = `+${f * o.every}`;
      g.strokeText(txt, col * (w + 4) + 4, row * (hh + 4) + 14); g.fillText(txt, col * (w + 4) + 4, row * (hh + 4) + 14);
    }
  }
  return out.toDataURL('image/png');
};

// ---- Frame cost: a big chain reaction with eight fighters --------------------------------------------------------------

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Measure what a frame costs while a large chain reaction plays out, driven by requestAnimationFrame like the real game loop.
 * (Timing a synchronous loop is misleading: Chromium batches canvas commands and rasterises when the task ends or a buffer fills,
 * so back-to-back frames bill the previous frames' raster to whoever fills the buffer.)
 *   js       = handleEvents + render, as called from the rAF callback: the cost of recording the frame
 *   interval = time between rAF callbacks: what the player experiences (raster and compositing included); 16.7 ms = a steady 60 fps
 * @returns {Promise<{ frames, js:{mean,p95,max}, interval:{mean,p95,max}, particlesMax, flamesPeak, tile, dpr, canvas }>}
 */
h.perf = async function perf(o = {}) {
  h.setup({ n: 8, blocks: 'few', reckless: 0.05, bombRate: 0.12, ...o });
  h.skipCountdown();
  stage.clear(1, 1, 13, 11);
  // a lattice of long-range bombs of all eight colours, chained through each other
  let n = 0;
  for (let ty = 1; ty <= 11; ty += 2) for (let tx = 1; tx <= 13; tx += 2) {
    if ((tx + ty) % 4 !== 2) continue;
    stage.bomb(n % 8, tx, ty, { range: 5 + (n % 4), fuse: n === 0 ? 3 : FUSE_TICKS });
    n++;
  }
  if (o.profile) h.profile();
  for (const name of String(o.disable ?? '').split(',').filter(Boolean)) {   // experiments: switch sections off to see what the rest costs
    const target = name.startsWith('particles.') ? h.renderer.particles : h.renderer;
    target[name.replace('particles.', '')] = () => {};
  }
  const js = [], interval = [], full = [], gl = o.flush ? h.canvas.getContext('2d') : null;
  let particlesMax = 0, flamesPeak = 0, last = await nextFrame();
  const frames = o.frames ?? 300, warm = 24;   // the first frames upload the atlas pages to the GPU: a one-off hitch, not a frame cost
  for (let i = 0; i < frames + warm; i++) {
    const stamp = await nextFrame();
    if (i >= warm) interval.push(stamp - last);
    last = stamp;
    const w = h.world;
    for (const p of w.players) w.applyCmd(p.id, cmdFor(p.id));
    w.tick();
    h.nowMs += TICK_MS;
    const snap = w.snapshot({ grid: true, evFrom: h.evCursor });
    h.evCursor = w.evCount; w.trimEvents(h.evCursor);
    fillView(h.view, snap, h.round, h.me);
    const t0 = performance.now();
    h.renderer.handleEvents(snap.e, h.view, h.nowMs);
    h.renderer.render(h.view, TICK_MS, h.nowMs);
    if (i >= warm) js.push(performance.now() - t0);
    if (gl) { gl.getImageData(0, 0, 1, 1); if (i >= warm) full.push(performance.now() - t0); }   // forces the canvas to rasterise inside the timing
    particlesMax = Math.max(particlesMax, h.renderer.stats.particles);
    flamesPeak = Math.max(flamesPeak, w.flames.length);
  }
  const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { mean: a.reduce((x, y) => x + y, 0) / a.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
  return {
    frames, profile: o.profile ? h.profileReport(frames) : null, js: stat(js), interval: stat(interval), full: full.length ? stat(full) : null, particlesMax, flamesPeak,
    tile: h.renderer.layout.tile, dpr: h.renderer.layout.dpr, canvas: [h.canvas.width, h.canvas.height],
  };
};

/** Wrap the Renderer's painting methods with timers; h.profileReport() returns ms per frame for each. */
h.profile = function profile() {
  const R = h.renderer, P = R.particles.constructor.prototype;
  h.prof = {};
  const wrap = (obj, name, label = name) => {
    const fn = obj[name];
    h.prof[label] = 0;
    obj[name] = function timed(...a) { const t = performance.now(); const r = fn.apply(this, a); h.prof[label] += performance.now() - t; return r; };
  };
  for (const n of ['drawPlayer', 'drawBomb', 'drawItem', 'drawGhostBomb', 'drawDying', 'advance', 'paintBackdrop', 'ensureStatic', 'paintFloorLevel', 'paintFlames', 'paintEntities', 'paintAloft', 'paintLight', 'paintOverlays', 'paintScreen', 'syncSprites', 'updateCells']) wrap(R, n);
  wrap(P, 'draw', 'particles.draw');
  wrap(P, 'update', 'particles.update');
  wrap(R, 'handleEvents');
};
h.profileReport = (frames) => Object.fromEntries(Object.entries(h.prof).map(([k, v]) => [k, +(v / frames).toFixed(3)]));

// ---- Scenes: named situations used by shots.mjs ----------------------------------------------------------------------

/** Two fighters on an otherwise empty floor, no autopilot: the stage for staged effects. */
function emptyStage(o, n = 2) {
  h.setup({ ...o, n, reckless: 0, blocks: 'few', items: 'none' });
  h.skipCountdown();
  stage.quiet();
  stage.clear(1, 1, 13, 11);
  for (const p of h.world.players) p.spawnShield = 0;   // the 2 s spawn shield would absorb the staged blasts
}

const scenes = {
  /** A busy mid-game moment: play until many flames burn at once. */
  battle(o) {
    h.setup(o);
    const t = h.runUntil('flames', o.flames ?? 16, 5000, o.warm ?? 500);
    h.advance(o.after ?? 4);
    return { tick: t, shots: [{ name: 'battle', data: h.shot() }] };
  },

  /** The countdown as players see it: everyone at their spawn, then GO and the spawn shields. */
  start(o) {
    h.setup({ ...o, reckless: 0 });
    h.advance(100);
    const a = h.shot();
    h.runUntil('go', undefined, 200);
    h.advance(10);
    return { shots: [{ name: 'countdown', data: a }, { name: 'go', data: h.shot() }] };
  },

  /** Bombs in a row blowing one another up. */
  chain(o) {
    emptyStage(o, 4);
    stage.teleport(0, 1, 1); stage.teleport(1, 13, 11); stage.teleport(2, 13, 1); stage.teleport(3, 1, 11);
    for (let i = 0; i < 6; i++) stage.bomb(i % 4, 3 + i * 2, 5, { range: 4, fuse: i === 0 ? 2 : FUSE_TICKS });
    stage.bomb(1, 7, 3, { range: 3, fuse: FUSE_TICKS }); stage.bomb(2, 7, 7, { range: 3, fuse: FUSE_TICKS });
    const shots = [];
    for (const [i, n] of [2, 4, 8, 14, 30].entries()) { h.advance(n); shots.push({ name: `chain-${i}`, data: h.shot() }); }
    return { shots };
  },

  /** A crate wall being blown up: block pops, debris, item reveal. */
  blocks(o) {
    h.setup({ ...o, n: 2, reckless: 0, blocks: 'many', items: 'many' });
    h.skipCountdown();
    stage.quiet();
    stage.teleport(0, 1, 1); stage.teleport(1, 13, 11);
    stage.bomb(0, 3, 3, { range: 3, fuse: 1 });
    stage.bomb(0, 3, 5, { range: 3, fuse: 1 });
    const t = [];
    for (let i = 0; i < 6; i++) { h.advance(i === 0 ? 2 : 3); t.push({ name: `blocks-${i}`, data: h.shot() }); }
    return { shots: t };
  },

  /** A fighter with the kick item runs into a bomb and sends it rolling. */
  kick(o) {
    emptyStage(o);
    stage.set(0, { kick: true }); stage.teleport(0, 3, 5, 1); stage.teleport(1, 13, 11);
    stage.bomb(1, 5, 5, { fuse: FUSE_TICKS });
    stage.drive(0, { d: 2, ticks: 200 });
    return { shots: [{ name: 'kick', data: h.strip({ frames: 10, every: 4, crop: [2, 3.6, 8, 3.2], scale: 0.9, cols: 2 }) }] };
  },

  /** A fighter with the glove lifts a bomb and throws it over the crates. */
  throw(o) {
    emptyStage(o);
    stage.set(0, { glove: true }); stage.teleport(0, 3, 5, 1); stage.teleport(1, 13, 11);
    stage.bomb(1, 4, 5, { fuse: FUSE_TICKS });
    h.advance(3);
    stage.drive(0, { d: 0, x: 1, ticks: 1 });
    return { shots: [{ name: 'throw', data: h.strip({ frames: 12, every: 3, crop: [2, 2.6, 8, 4.2], scale: 0.9, cols: 3 }) }] };
  },

  /** Skull pickup: curse burst, aura, label, tint. */
  curse(o) {
    emptyStage(o);
    stage.teleport(0, 5, 5, 2); stage.teleport(1, 8, 5, 2);
    h.advance(4);
    stage.curse(0, 'reverse');
    return { shots: [{ name: 'curse', data: h.strip({ frames: 8, every: 7, crop: [3, 3.2, 7, 3.6], scale: 1, cols: 4 }) }, { name: 'curse-full', data: h.shot() }] };
  },

  /** Blown up by a flame: hurt flash, dizzy spin, poof, ghost. */
  death(o) {
    emptyStage(o);
    stage.teleport(0, 5, 5, 2); stage.teleport(1, 13, 11);
    stage.bomb(1, 5, 5, { range: 2, fuse: 3 });
    return { shots: [{ name: 'death', data: h.strip({ frames: 12, every: 5, crop: [3.6, 3, 4.8, 4], scale: 1, cols: 6 }) }] };
  },

  /** The last one standing cheers. */
  win(o) {
    emptyStage(o);
    stage.teleport(0, 5, 5, 2); stage.teleport(1, 7, 5, 2);
    stage.bomb(0, 7, 5, { range: 1, fuse: 2 });
    h.runUntil('ending', undefined, 300);
    return { shots: [{ name: 'win', data: h.strip({ frames: 8, every: 10, crop: [3, 2.8, 6, 4.2], scale: 1, cols: 4 }) }, { name: 'win-full', data: h.shot() }] };
  },

  /** Sudden death: the warning, the fall, the landing. */
  sudden(o) {
    h.setup({ ...o, roundTime: 60, reckless: 0, bombRate: 0, n: o.n ?? 5 });   // nobody bombs: no showdown shortens the clock, sudden death starts on time
    h.runUntil('sdstart', undefined, 5000, 3600);
    h.advance(40);
    const a = h.shot();
    h.runUntil('sdland', undefined, 400);
    const shots = [{ name: 'sudden-warn', data: a }, { name: 'sudden-land', data: h.shot() }];
    h.advance(90);
    shots.push({ name: 'sudden-later', data: h.shot() });
    return { shots };
  },

  /** One bomb going off, filmed close up frame by frame (tile 96 shows every detail). */
  blast(o) {
    emptyStage(o, 3);
    stage.teleport(0, 4, 5, 0); stage.teleport(1, 9, 5, 1); stage.teleport(2, 13, 11);
    stage.cell(7, 3, '+'); stage.cell(9, 3, '+'); stage.cell(7, 7, '+');
    stage.bomb(2, 7, 5, { range: 3, fuse: 2 });
    return { shots: [{ name: 'blast', data: h.strip({ frames: 8, every: 3, crop: [3.4, 2.2, 7.2, 5.2], scale: 0.75, cols: 2 }) }] };
  },

  /** The local fighter stands in the blast of a bomb whose neighbour is chained to it: hazard marks on the whole chain, the red warning ring. */
  alarm(o) {
    emptyStage(o, 3);
    stage.teleport(0, 3, 5, 2); stage.teleport(1, 7, 9, 2); stage.teleport(2, 13, 11);
    stage.set(1, { bombsMax: 3 });
    stage.bomb(1, 3, 1, { range: 5, fuse: 40 });     // its arms reach the bomb at (5,1), which has a long fuse of its own ...
    stage.bomb(1, 5, 1, { range: 4, fuse: 130 });    // ... but goes off with it, so column 5 is marked as urgently as column 3
    stage.bomb(1, 11, 9, { range: 3, fuse: 100 });   // far from going off: no marks yet
    h.advance(3);
    return { shots: [{ name: 'alarm', data: h.shot() }, { name: 'alarm-zoom', data: h.strip({ frames: 1, every: 1, crop: [1.5, 3.4, 4, 3], scale: 1.4, label: false }) }] };
  },

  /** Bombs about to blow: the floor they will burn is tinted, blinking red bombs, a rolling one. */
  danger(o) {
    emptyStage(o, 3);
    stage.teleport(0, 5, 2, 2); stage.teleport(1, 9, 1, 2); stage.teleport(2, 13, 11);
    stage.bomb(1, 3, 5, { range: 3, fuse: 55 }); stage.bomb(2, 9, 5, { range: 4, fuse: 22 }); stage.bomb(0, 6, 9, { range: 5, fuse: 100 });
    stage.cell(9, 7, '+'); stage.cell(3, 7, '#');
    h.advance(6);
    return { shots: [{ name: 'danger', data: h.shot() }] };
  },

  /**
   * A theme change and a resize in mid-play, paced by requestAnimationFrame like the real loop (a synchronous loop lets Chromium batch
   * many frames of canvas commands and bills the raster of ten frames to one): the JS time of every frame around the swap, and pictures.
   */
  async swap(o) {
    h.setup({ ...o, theme: 'meadow', reckless: 0 });
    for (let i = 0; i < 120; i++) { await nextFrame(); h.frame(true); }
    const timed = async (n, shotsAt = []) => {
      const ms = [], shots = [];
      for (let i = 0; i < n; i++) {
        await nextFrame();
        const t = performance.now();
        h.frame(true);
        ms.push(+(performance.now() - t).toFixed(1));
        if (shotsAt.includes(i)) shots.push(h.shot());
      }
      return { ms, shots };
    };
    h.round.theme = 'frost';
    const themed = await timed(24, [0, 2, 23]);
    const big = h.opts.css;
    h.renderer.resize(Math.round(big[0] * 0.6), Math.round(big[1] * 0.75), h.opts.dpr);
    const first = h.shot();
    const resized = await timed(50, [0, 12, 49]);
    const worst = (a) => Math.max(...a);
    return {
      info: `theme swap frame ms (worst ${worst(themed.ms)}): ${themed.ms.join(' ')} | resize frame ms (worst ${worst(resized.ms)}): ${resized.ms.join(' ')}`,
      shots: [
        ...themed.shots.map((data, i) => ({ name: `swap-theme-${i}`, data })),
        { name: 'swap-resize-immediate', data: first },
        ...resized.shots.map((data, i) => ({ name: `swap-resize-${i}`, data })),
      ],
    };
  },

  /** A fighter walking a loop (right, down, left, up): walk cycles, facing changes, footstep dust; one strip per leg. */
  walk(o) {
    emptyStage(o);
    stage.teleport(0, 1, 1, 1); stage.teleport(1, 13, 11);   // the lanes between the pillars are the odd rows and columns
    const shots = [];
    for (const [i, d] of [2, 3, 4, 1].entries()) {
      stage.drive(0, { d, ticks: 60 });
      shots.push({ name: `walk-${i}`, data: h.strip({ frames: 6, every: 10, crop: [0, 0, 2.2, 2.4], follow: 0, cols: 6, label: false }) });
    }
    return { shots };
  },

  /** Name tags with fighters standing shoulder to shoulder: sizes by tile size, overlap handling, the local fighter's gold tag. */
  tags(o) {
    h.setup({ ...o, n: 8, reckless: 0 });
    h.skipCountdown();
    stage.quiet();
    stage.clear(1, 1, 13, 11);
    // side by side, one above the other, a trio, and two loners
    [[3, 3], [4, 3], [7, 2], [7, 3], [11, 5], [12, 5], [11, 6], [4, 9]].forEach(([x, y], i) => stage.teleport(i, x, y, 2));
    for (const p of h.world.players) p.spawnShield = 0;
    h.advance(6);
    return { shots: [{ name: 'tags', data: h.shot() }] };
  },

  /** Emote bubbles and a shielded, cursed, team-ringed lineup. */
  lineup(o) {
    h.setup({ ...o, n: 8, mode: 'teams', reckless: 0 });
    h.skipCountdown();
    stage.quiet();
    stage.clear(1, 1, 13, 11);
    const row = [[3, 3], [5, 3], [7, 3], [9, 3], [3, 7], [5, 7], [7, 7], [9, 7]];
    row.forEach(([x, y], i) => stage.teleport(i, x, y, i % 4));
    stage.set(1, { shield: 300 }); stage.set(2, { spawnShield: 60 }); stage.curse(3, 'slow'); stage.curse(5, 'rush'); stage.set(6, { shield: 90 });
    for (let i = 0; i < 8; i++) h.renderer.showEmote(i, i);
    h.advance(20);
    return { shots: [{ name: 'lineup', data: h.shot() }, { name: 'lineup-zoom', data: h.strip({ frames: 1, every: 1, crop: [2.2, 1.4, 5, 3.2], scale: 1, label: false }) }] };
  },
};

h.scene = (name, o = {}) => scenes[name](o);
h.scenes = () => Object.keys(scenes);
h.DIR = { DIR_DX, DIR_DY };
window.harness = h;
window.harnessReady = true;
