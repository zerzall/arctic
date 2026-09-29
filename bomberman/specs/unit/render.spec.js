// render.js under Node with a fake canvas: fit and canvas budget, time-sliced sprite swaps, the flash and shake safety numbers of
// docs/SPEC.md section 8.2, reduced effects, adaptive quality, event handling and a soak run driven by a real World.
// (What the pixels look like is judged by eye with scripts/dev/render/shots.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, STATE, PLAYER_COLORS, GRID_W, GRID_H, MAX_PLAYERS } from '../../shared/constants.js';
import { EVENT_ARGS } from '../../shared/protocol.js';
import { World } from '../../shared/world.js';
import { Renderer, computeLayout } from '../../client/js/render.js';
import { createView, fillView, roundFor } from '../../scripts/dev/render/view-adapter.js';
import { AutoPilot } from '../../scripts/dev/render/autopilot.js';

// ---- A canvas that accepts every call and counts the interesting ones ------------------------------------------------

function makeContext(canvas) {
  const stats = {};
  return new Proxy({ canvas, stats }, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 8 });
      if (prop === 'createPattern') return () => ({});
      if (typeof prop === 'string' && prop.startsWith('create')) return () => ({ addColorStop() {} });
      return (...args) => { stats[prop] = (stats[prop] ?? 0) + 1; if (prop === 'fillRect') t.lastFillRect = args; };
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}

/** Factory whose canvases can be inspected: `made` lists every canvas ever created through it. */
function canvasFactory() {
  const made = [];
  const create = (width = 300, height = 150) => {
    const c = { width, height, style: {}, ctx: null, getContext() { return (c.ctx ??= makeContext(c)); }, toDataURL() { return ''; } };
    made.push(c);
    return c;
  };
  create.made = made;
  create.live = (minPixels = 0) => made.filter((c) => c.width * c.height > minPixels);
  return create;
}

function boot({ css = [960, 780], dpr = 1, theme = 'meadow', ...opts } = {}) {
  const create = canvasFactory();
  const canvas = create(300, 150);
  const mql = { matches: !!opts.systemReduced, addEventListener(_, fn) { mql.fn = fn; }, removeEventListener() { mql.fn = null; } };
  const renderer = new Renderer(canvas, { createCanvas: create, matchMedia: () => mql, random: () => 0.5, ...opts });
  renderer.resize(css[0], css[1], dpr);
  const view = createView();
  view.theme = theme;
  return { renderer, canvas, create, view, mql, made: create.made };
}

/** A World, its View and the `round` info, stepped one tick at a time. */
function makeMatch({ n = 4, seed = 5, theme = 'meadow', mode = 'ffa', roundTime = 120, bombRate = 0.15 } = {}) {
  const fighters = Array.from({ length: n }, (_, i) => ({ id: i, name: ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'][i], color: i, team: i % 2, isBot: i > 0, lastSeq: 0 }));
  const world = new World({ seed, fighters, mode, theme, roundTime, suddenDeath: true });
  const round = roundFor(world, mode), view = createView(), pilot = new AutoPilot(world, { seed: seed + 1, bombRate });
  let cursor = 0, events = [];
  const step = () => {
    for (const p of world.players) world.applyCmd(p.id, pilot.think(p.id));
    world.tick();
    const snap = world.snapshot({ grid: true, evFrom: cursor });
    cursor = world.evCount; world.trimEvents(cursor);
    fillView(view, snap, round, 0);
    events = snap.e;
    return events;
  };
  step();
  return { world, view, round, step, get events() { return events; } };
}

/** Render until the sprite set is up (the build is time-sliced across frames). */
function warmUp(renderer, view, now = 1000) {
  for (let i = 0; i < 200 && !renderer.set; i++) renderer.render(view, 16.7, now += 16.7);
  assert.ok(renderer.set, 'the sprite set finished building');
  return now;
}

const boom = (tx, ty, range = 3) => ['boom', 1, 0, tx, ty, range, [[tx, ty], [tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]];

// ---- Layout ---------------------------------------------------------------------------------------------------------

test('computeLayout: the arena fits, is centred and the tile follows the spec formula', () => {
  const hd = computeLayout(1920, 1080, 1);
  assert.equal(hd.tile, 83);                        // floor(min(1920/15, 1080/13)): the spec's formula
  assert.equal(computeLayout(390, 844, 2).tile, 52);
  assert.equal(computeLayout(1280, 800, 1).tile, 61);
  assert.equal(hd.width, 1920); assert.equal(hd.height, 1080);
  assert.equal(hd.ox, Math.floor((1920 - 15 * 83) / 2));
  for (const L of [hd, computeLayout(390, 844, 2), computeLayout(844, 390, 2), computeLayout(1024, 768, 2), computeLayout(320, 480, 3)]) {
    assert.ok(L.ox >= 0 && L.ox + GRID_W * L.tile <= L.width, 'fits horizontally');
    assert.ok(L.oy >= 0 && L.oy + GRID_H * L.tile <= L.height, 'the arena is never clipped');
    assert.ok(L.tile >= 8 && L.tile <= 96);
  }
});

test('computeLayout: dpr is capped by the quality level and the canvas backing store stays within 2.5 Mpx', () => {
  assert.equal(computeLayout(500, 400, 3, 2).dpr, 2);
  assert.equal(computeLayout(500, 400, 3, 1).dpr, 1.5);
  assert.equal(computeLayout(500, 400, 3, 0).dpr, 1);
  assert.equal(computeLayout(500, 400, 0.5, 2).dpr, 0.5, 'a zoomed-out browser is not scaled up');
  for (const [w, h, d] of [[1920, 1080, 1], [1920, 1080, 2], [2560, 1440, 2], [3840, 2160, 1], [1024, 1366, 2], [390, 844, 3], [7680, 4320, 1], [1, 1, 1], [0, 0, 1]]) {
    for (const q of [0, 1, 2]) {
      const L = computeLayout(w, h, d, q);
      assert.ok(L.width * L.height <= 2.5e6, `${w}x${h}@${d} q${q}: ${L.width}x${L.height}`);
      assert.ok(L.tile <= 96 && L.tile >= 8);
    }
  }
  const tv = computeLayout(3840, 2160, 1);
  assert.ok(tv.dpr < 1 && tv.tile >= 85 && tv.tile <= 96, 'a 4K container renders below 1x and the browser scales it up');
});

test('computeLayout: portrait containers pin the arena to the top, landscape ones centre it, the wall overhang shows when there is room', () => {
  const portrait = computeLayout(390, 844, 2);
  assert.equal(portrait.oy, portrait.over, 'top edge of the arena is just below the visible wall face');
  const centred = computeLayout(390, 844, 2, 2, 'center');
  assert.equal(centred.oy, Math.floor((1688 - 13 * centred.tile) / 2));
  const wide = computeLayout(1000, 500, 1);                       // height-limited: 500 - 13 * 38 = 6 px to spare
  assert.equal(wide.tile, 38);
  assert.equal(wide.oy, 6, 'all the spare height goes above the arena, where the wall face reaches');
  const roomy = computeLayout(1200, 900, 1);                      // tile 69: 3 px spare -> oy 3
  assert.ok(roomy.oy <= roomy.over);
  const spare = computeLayout(1600, 1000, 1);                     // tile 76: 12 px spare, over = 23
  assert.equal(spare.oy, 12);
  const top = computeLayout(1200, 1500, 1, 2, 'top');
  assert.equal(top.oy, top.over);
});

test('resize sizes the canvas and its CSS box, and getArenaRect reports the arena in css pixels', () => {
  const { renderer, canvas } = boot({ css: [800, 600], dpr: 2 });
  assert.equal(canvas.width, renderer.layout.width);
  assert.equal(canvas.style.width, '800px'); assert.equal(canvas.style.height, '600px'); assert.equal(canvas.style.display, 'block');
  const r = renderer.getArenaRect();
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 800 + 1 && r.y + r.h <= 600 + 1);
  assert.ok(Math.abs(r.w / r.h - GRID_W / GRID_H) < 0.01, 'the arena rectangle has the 15 x 13 shape');
  renderer.resize(400, 300, 1);
  assert.equal(canvas.width, renderer.layout.width);
  assert.equal(canvas.style.width, '400px');
  assert.equal(renderer.stats.tilePx, renderer.layout.tile);
});

// ---- Sprite sets ----------------------------------------------------------------------------------------------------

test('the sprite set is built in time slices and a theme change swaps it without leaking canvases', () => {
  const { renderer, view, made, create } = boot({ theme: 'meadow' });
  view.grid = '#'.repeat(195); view.players = []; view.bombs = []; view.flames = []; view.items = []; view.falling = []; view.ghostBombs = [];
  let now = 1000, frames = 0;
  while (!renderer.set && frames < 400) { renderer.render(view, 16.7, now += 16.7); frames++; }
  assert.ok(renderer.set, 'built');
  assert.equal(renderer.set.theme, 'meadow');
  assert.equal(renderer.stats.builds, 1);
  const bigLive = create.live(200000).length;
  view.theme = 'lava';
  frames = 0;
  while (renderer.set.theme !== 'lava' && frames < 400) { renderer.render(view, 16.7, now += 16.7); frames++; }
  assert.equal(renderer.set.theme, 'lava');
  assert.ok(frames >= 2, 'the swap took more than one frame (it is sliced)');
  renderer.render(view, 16.7, now += 16.7);
  assert.equal(create.live(200000).length, bigLive, 'the old theme released its canvases (width = height = 0)');
  assert.ok(made.some((c) => c.width === 0 && c.height === 0), 'released canvases are zeroed for iOS');
});

test('the arena is baked into its own layer while the canvas memory allows it, and rebaked when the walls change', () => {
  const { renderer, made } = boot({ css: [600, 500], dpr: 1 });
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(renderer.staticOk, true);
  assert.ok(renderer.statics, 'baked');
  const first = renderer.statics.canvas, count = made.length;
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(renderer.statics.canvas, first);
  assert.equal(made.length, count, 'nothing is baked again while the walls stay');
  const cells = m.view.grid.split('');
  cells[2 * GRID_W + 2] = cells[2 * GRID_W + 2] === '#' ? '.' : '#';        // another layout: a pillar appears or vanishes
  const changed = { ...m.view, grid: cells.join('') };
  renderer.render(changed, 16.7, now += 16.7);
  assert.notEqual(renderer.statics.canvas, first);
  assert.equal(first.width, 0, 'the old bake was released');
  // crates going away do not touch the bake (they are drawn live)
  const crateGone = { ...changed, grid: changed.grid.replace('+', '.') };
  const bake = renderer.statics.canvas;
  renderer.render(crateGone, 16.7, now += 16.7);
  assert.equal(renderer.statics.canvas, bake);
});

test('on a big screen the arena is drawn piece by piece instead: a bake would push the canvas memory past its limit', () => {
  const { renderer } = boot({ css: [2560, 1440], dpr: 1 });
  const m = makeMatch({ n: 2 });
  const now = warmUp(renderer, m.view);
  renderer.render(m.view, 16.7, now + 16.7);
  assert.ok(renderer.layout.tile >= 85);
  assert.equal(renderer.staticOk, false);
  assert.equal(renderer.statics, null);
  assert.deepEqual(renderer.errors, []);
});

test('an unknown or missing view theme falls back to the hinted theme, then meadow', () => {
  const { renderer, view } = boot();
  view.theme = null;
  view.grid = '#'.repeat(195); view.players = []; view.bombs = []; view.flames = []; view.items = []; view.falling = []; view.ghostBombs = [];
  renderer.setTheme('candy');
  warmUp(renderer, view);
  assert.equal(renderer.set.theme, 'candy');
  renderer.setTheme('nonsense');
  assert.equal(renderer.hintTheme, 'candy', 'invalid hints are ignored');
  for (const theme of THEMES) { renderer.setTheme(theme); assert.equal(renderer.hintTheme, theme); }
});

// ---- Flash and shake safety (section 8.2) ----------------------------------------------------------------------------

test('twenty explosions within a second start at most three flashes, none stronger than 0.18', () => {
  const { renderer } = boot();
  const m = makeMatch();
  let now = warmUp(renderer, m.view);
  const t0 = now;
  let peak = 0;
  for (let i = 0; i < 20; i++) {
    now = t0 + i * 50;
    renderer.handleEvents([boom(3 + (i % 7), 3 + (i % 5), 8)], m.view, now);
    renderer.render(m.view, 50, now);
    peak = Math.max(peak, renderer.flash.peak);
  }
  assert.ok(renderer.stats.flashes >= 1 && renderer.stats.flashes <= 3, `flashes: ${renderer.stats.flashes}`);
  assert.ok(peak <= 0.18 + 1e-9, `peak alpha ${peak}`);
  // ... and stays rate limited over a longer stretch: never more than 2.5 per second (+1 for the first)
  for (let i = 0; i < 100; i++) { now += 50; renderer.handleEvents([boom(5, 5, 4)], m.view, now); renderer.render(m.view, 50, now); }
  assert.ok(renderer.stats.flashes <= 3 + Math.ceil(5.0 * 2.5), `flashes after 6 s: ${renderer.stats.flashes}`);
});

test('camera shake never exceeds 6 css pixels and ends within 250 ms', () => {
  const { renderer } = boot({ dpr: 2 });
  const m = makeMatch();
  const now = warmUp(renderer, m.view);
  for (let i = 0; i < 12; i++) renderer.handleEvents([boom(7, 6, 10)], m.view, now);
  assert.ok(renderer.stats.shakes >= 1);
  const dpr = renderer.layout.dpr;
  let maxSeen = 0;
  for (let dt = 0; dt < 250; dt += 3) {
    const off = renderer.cameraOffset(now + dt, dpr, false);
    maxSeen = Math.max(maxSeen, Math.abs(off[0]), Math.abs(off[1]));
  }
  assert.ok(maxSeen > 0, 'it shakes');
  assert.ok(maxSeen <= 6 * dpr + 1, `max offset ${maxSeen} device px`);
  const after = renderer.cameraOffset(now + 251, dpr, false);
  assert.deepEqual([after[0], after[1]], [0, 0]);
});

test('reduced effects: no shake, no flash, no confetti, no ambient particles, at most 60 particles, static flames', () => {
  const { renderer } = boot({ reducedEffects: true });
  const m = makeMatch();
  let now = warmUp(renderer, m.view);
  assert.equal(renderer.reducedEffects, true);
  assert.equal(renderer.particles.cap, 60);
  assert.equal(renderer.particles.ambient.count, 0, 'no ambient background particles');
  for (let i = 0; i < 20; i++) { now += 40; renderer.handleEvents([boom(3 + i % 8, 5, 8), ['block', 3, 3, 0], ['death', 1, 0, 4.5, 4.5]], m.view, now); renderer.render(m.view, 40, now); }
  assert.equal(renderer.stats.flashes, 0);
  assert.equal(renderer.stats.shakes, 0);
  const off = renderer.cameraOffset(now, 1, true);
  assert.deepEqual([off[0], off[1]], [0, 0]);
  assert.ok(renderer.particles.live <= 60);
  // win cheer: still no confetti
  const ended = { ...m.view, state: STATE.ENDING, players: m.view.players.map((p, i) => ({ ...p, alive: i === 0, shield: i === 0 ? 65535 : 0 })) };
  renderer.render(ended, 16.7, now += 16.7);
  const confetti = Array.from(renderer.particles.kind).filter((k, i) => renderer.particles.life[i] > 0 && k === 5).length;
  assert.equal(confetti, 0);
});

test('the reduced-effects setting follows the system preference until the user overrides it', () => {
  const { renderer, mql } = boot({ systemReduced: true });
  assert.equal(renderer.reducedEffects, true);
  assert.equal(renderer.systemReducedMotion, true);
  renderer.setReducedEffects(false);
  assert.equal(renderer.reducedEffects, false);
  renderer.setReducedEffects(null);
  assert.equal(renderer.reducedEffects, true);
  mql.fn({ matches: false });                            // the OS setting changes while playing
  assert.equal(renderer.reducedEffects, false);
  assert.equal(renderer.particles.cap, 400);
  renderer.dispose();
  assert.equal(mql.fn, null, 'the media listener is removed');
});

// ---- Quality -------------------------------------------------------------------------------------------------------

test('quality levels set the particle cap, the dpr cap and glow: 400/200/60', () => {
  const { renderer } = boot({ css: [600, 500], dpr: 2 });
  assert.equal(renderer.particles.cap, 400);
  assert.equal(renderer.layout.dpr, 2);
  renderer.setQuality(1);
  assert.equal(renderer.particles.cap, 200);
  assert.equal(renderer.layout.dpr, 1.5);
  renderer.setQuality(0);
  assert.equal(renderer.particles.cap, 60);
  assert.equal(renderer.layout.dpr, 1);
  assert.equal(renderer.fxLevel.glow, false);
  renderer.setQuality(7);
  assert.equal(renderer.quality, 2, 'out of range is clamped');
});

test('an EMA of frame time above 24 ms for 120 frames lowers the quality, never raises it, and ignores stalls', () => {
  const { renderer, view } = boot();
  view.grid = '#'.repeat(195); view.players = []; view.bombs = []; view.flames = []; view.items = []; view.falling = []; view.ghostBombs = [];
  let now = 0;
  for (let i = 0; i < 300; i++) renderer.render(view, 400, now += 400);      // a backgrounded tab: huge intervals are not "slow frames"
  assert.equal(renderer.quality, 2);
  for (let i = 0; i < 100; i++) renderer.render(view, 16.7, now += 16.7);
  assert.equal(renderer.quality, 2);
  for (let i = 0; i < 400 && renderer.quality === 2; i++) renderer.render(view, 32, now += 32);
  assert.equal(renderer.quality, 1);
  for (let i = 0; i < 400 && renderer.quality === 1; i++) renderer.render(view, 32, now += 32);
  assert.equal(renderer.quality, 0);
  for (let i = 0; i < 300; i++) renderer.render(view, 8, now += 8);
  assert.equal(renderer.quality, 0, 'fast frames afterwards do not bring quality back');
  assert.equal(renderer.stats.quality, 0);
});

// ---- Events ---------------------------------------------------------------------------------------------------------

test('every event of Appendix A.3 is handled, and malformed ones are ignored without throwing', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 4 });
  const now = warmUp(renderer, m.view);
  const good = [
    ['go'], ['bomb', 3, 0, 2, 2], boom(4, 4, 3), ['block', 3, 3, 0], ['itemspawn', 9, 3, 3, 'flame'], ['pickup', 9, 0, 'flame', 3, 3], ['pickup', 10, 0, 'skull', 3, 3],
    ['itemgone', 9, 3, 3, 'skull'], ['bombgone', 3, 2, 2], ['death', 1, 0, 4.5, 3.5], ['left', 2], ['shieldhit', 0, 1.5, 1.5], ['kick', 0, 3, 2], ['throw', 0, 3, 2, 2, 5, 2],
    ['land', 3, 5, 2], ['curse', 0, 'reverse', 1], ['curse', 0, 'spam', -1], ['curse', 0, 0, -1], ['sdstart'], ['sdland', 4, 4], ['showdown'],
  ];
  assert.deepEqual([...new Set(good.map((e) => e[0]))].sort(), Object.keys(EVENT_ARGS).sort(), 'the test covers the whole closed list');
  renderer.handleEvents(good, m.view, now);
  const nasty = [[], null, 'boom', ['nope'], ['boom'], ['boom', 1, 1, NaN, 3, 4, []], ['death'], ['left', 999], ['pickup', 1, 1, 'unknown-kind', 1, 1], ['curse', 77, 'slow', 0], ['throw'], ['land', 'x'], ['block', Infinity, 2]];
  renderer.handleEvents(nasty, m.view, now);
  renderer.handleEvents([], m.view);
  renderer.handleEvents(undefined, m.view);
  assert.deepEqual(renderer.errors, []);
  for (let i = 0; i < renderer.particles.size; i++) if (renderer.particles.life[i] > 0) assert.ok(Number.isFinite(renderer.particles.x[i]) && Number.isFinite(renderer.particles.y[i]));
  renderer.render(m.view, 16.7, now + 16.7);
  assert.deepEqual(renderer.errors, []);
});

test('a chain reaction of a hundred explosions cannot overflow the particle pool or a frame', () => {
  const { renderer } = boot();
  const m = makeMatch();
  let now = warmUp(renderer, m.view);
  const events = [];
  for (let i = 0; i < 100; i++) events.push(boom(1 + (i % 13), 1 + (i % 11), 10));
  renderer.handleEvents(events, m.view, now);
  assert.ok(renderer.particles.live <= renderer.particles.cap);
  for (let i = 0; i < 90; i++) { now += 16.7; renderer.render(m.view, 16.7, now); assert.ok(renderer.stats.particles <= renderer.particles.cap); }
  assert.deepEqual(renderer.errors, []);
});

test('emotes: a bubble shows above the fighter for a few seconds', () => {
  const { renderer } = boot();
  const m = makeMatch();
  let now = warmUp(renderer, m.view);
  const calls = [];
  const emote = renderer.set.emote.bind(renderer.set);
  renderer.set.emote = (i) => { calls.push(i); return emote(i); };
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(calls.length, 0);
  renderer.showEmote(m.view.players[0].id, 3);
  renderer.showEmote(m.view.players[1].id, 99);                      // out of range is clamped, not a crash
  renderer.render(m.view, 16.7, now += 16.7);
  assert.deepEqual(calls.sort((a, b) => a - b), [3, 11]);
  calls.length = 0;
  renderer.render(m.view, 16.7, now += 3000);
  assert.equal(calls.length, 0, 'gone after about 2.4 s');
});

// ---- Views ----------------------------------------------------------------------------------------------------------

test('round winners are derived from the View: one survivor (FFA) or one surviving team, never a timeout draw', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 4 });
  let now = warmUp(renderer, m.view);
  const withAlive = (state, alive, teams) => ({ ...m.view, state, players: m.view.players.map((p, i) => ({ ...p, alive: alive.includes(i), team: teams ? teams[i] : p.team })) });
  renderer.render(withAlive(STATE.ENDING, [2]), 16.7, now += 16.7);
  assert.equal(renderer.winners, 1);
  renderer.render(withAlive(STATE.ENDING, [1, 2]), 16.7, now += 16.7);
  assert.equal(renderer.winners, 0, 'two survivors in a free-for-all is a draw');
  renderer.render(withAlive(STATE.ENDING, []), 16.7, now += 16.7);
  assert.equal(renderer.winners, 0);
  renderer.render(withAlive(STATE.PLAYING, [2]), 16.7, now += 16.7);
  assert.equal(renderer.winners, 0, 'nobody has won while the round is on');
  renderer.setPlayers({ mode: 'teams', players: [] });
  renderer.render(withAlive(STATE.ENDING, [0, 2], [0, 1, 0, 1]), 16.7, now += 16.7);
  assert.equal(renderer.winners, 1, 'both survivors are on team 0');
  renderer.render(withAlive(STATE.ENDING, [0, 1], [0, 1, 0, 1]), 16.7, now += 16.7);
  assert.equal(renderer.winners, 0);
});

test('name tags are baked once per name and released when the name or the tile size changes', () => {
  const { renderer, made } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  renderer.render(m.view, 16.7, now += 16.7);
  const fx = renderer.players.get(m.view.players[0].id);
  const tag = fx.tag;
  assert.ok(tag && tag.canvas.width > 0);
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(fx.tag, tag, 'reused');
  m.view.players[0].name = 'Renamed';
  renderer.render(m.view, 16.7, now += 16.7);
  assert.notEqual(fx.tag, tag);
  assert.equal(tag.canvas.width, 0, 'the old tag canvas was released');
  renderer.showNames = false;
  const before = made.length;
  m.view.players[0].name = 'Again';
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(made.length, before, 'names off: nothing is baked');
});

test('the team ring appears only in team mode', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 4, mode: 'teams' });
  let now = warmUp(renderer, m.view);
  const rings = [];
  const ring = renderer.set.teamRing;
  for (let t = 0; t < 2; t++) { const sp = ring[t]; Object.defineProperty(sp, 'img', { get() { rings.push(t); return sp.__img; }, set(v) { sp.__img = v; }, configurable: true }); sp.__img = { fake: true }; }
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(rings.length, 0, 'ffa by default: no rings');
  renderer.setPlayers(m.round);
  renderer.render(m.view, 16.7, now += 16.7);
  assert.ok(rings.includes(0) && rings.includes(1), `rings drawn for both teams: ${rings}`);
});

test('a local ghost bomb hands its pop-in and pulse over to the server bomb on the same tile', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  const view = { ...m.view, bombs: [], ghostBombs: [{ x: 3.5, y: 5.5 }] };
  for (let i = 0; i < 6; i++) renderer.render(view, 16.7, now += 16.7);
  const idx = 5 * GRID_W + 3, born = renderer.tilePop[idx];
  assert.ok(born > 0 && born < now, 'the ghost started its pop when first seen');
  const withBomb = { ...m.view, ghostBombs: [], bombs: [{ id: 41, owner: 0, x: 3.5, y: 5.5, tx: 3, ty: 5, fuse: 148, range: 2, dir: 0, fly: null, pass: [0] }] };
  renderer.render(withBomb, 16.7, now += 16.7);
  assert.equal(renderer.bombs.get(41).born, born, 'the pop-in does not restart when the confirmed bomb replaces the ghost');
  const other = { ...withBomb, bombs: [{ ...withBomb.bombs[0], id: 42, x: 9.5, y: 5.5, tx: 9, ty: 5 }] };
  renderer.render(other, 16.7, now += 16.7);
  assert.equal(renderer.bombs.get(42).born, now, 'a bomb on a tile without a ghost starts fresh');
});

test('a new round (the countdown starting over) clears the last round\'s effects and per-fighter state', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 3 });
  let now = warmUp(renderer, m.view);
  renderer.handleEvents([boom(5, 5, 4), ['death', 1, 0, 5.5, 5.5], ['sdstart']], m.view, now);
  renderer.render(m.view, 16.7, now += 16.7);
  assert.ok(renderer.particles.live > 0 && renderer.players.get(1).deathAt >= 0);
  const over = { ...m.view, state: STATE.OVER, countdown: 0 };
  renderer.render(over, 16.7, now += 16.7);
  const next = { ...m.view, state: STATE.COUNTDOWN, countdown: 180, players: m.view.players.map((p) => ({ ...p, alive: true, deadT: 0 })) };
  renderer.render(next, 16.7, now += 16.7);
  assert.equal(renderer.players.get(1).deathAt, -1);
  assert.equal(renderer.banner.t0 < 0, true);
  assert.ok(renderer.particles.live <= renderer.particles.ambient.count + 2, 'only ambient decoration is left');
});

test('the debug overlay draws only when switched on', () => {
  const { renderer, canvas } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  const texts = () => canvas.ctx.stats.fillText ?? 0;
  renderer.render(m.view, 16.7, now += 16.7);
  const off = texts();
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(texts(), off);
  assert.match(renderer.debugText(), /^fps \d+ .*\ndpr 1\.00 {2}tile \d+px {2}q2 {2}atlases 1 {2}particles \d+$/);
  renderer.setDebug(true);
  renderer.debugInfo.rtt = 42; renderer.debugInfo.ws = 'open';
  renderer.render(m.view, 16.7, now += 16.7);
  assert.ok(texts() >= off + 3, 'fps, dpr/tile/quality/atlases and rtt/ws lines');
});

test('dispose releases every canvas the renderer made', () => {
  const { renderer, made } = boot();
  const m = makeMatch({ n: 3 });
  let now = warmUp(renderer, m.view);
  for (let i = 0; i < 5; i++) renderer.render(m.view, 16.7, now += 16.7);
  renderer.dispose();
  assert.ok(made.length > 10);
  const live = made.filter((c) => c.width > 0 && c.height > 0 && c !== made[0]);
  assert.deepEqual(live.map((c) => `${c.width}x${c.height}`), []);
});

// ---- Soak with a real World -------------------------------------------------------------------------------------------

/** Play a real round through the renderer; returns what happened. */
function soak({ n, mode, seed, roundTime = 120, bombRate, ticks }) {
  const { renderer, canvas } = boot({ css: [1280, 720], dpr: 1 });
  const m = makeMatch({ n, mode, seed, roundTime, bombRate });
  renderer.setPlayers(m.round);
  let now = warmUp(renderer, m.view);
  const seen = new Set();
  let maxParticles = 0;
  for (let t = 0; t < ticks && m.world.state !== STATE.OVER; t++) {
    const events = m.step();
    for (const e of events) seen.add(e[0]);
    now += 1000 / 60;
    renderer.handleEvents(events, m.view, now);
    renderer.render(m.view, 1000 / 60, now);
    maxParticles = Math.max(maxParticles, renderer.stats.particles);
  }
  return { renderer, canvas, seen, maxParticles };
}

for (const [mode, n] of [['ffa', 8], ['teams', 4]]) {
  test(`soak: a real ${mode} round with ${n} fighters, chains and deaths renders without a single error`, () => {
    const { renderer, canvas, seen, maxParticles } = soak({ n, mode, seed: 21, ticks: 3000 });
    assert.deepEqual(renderer.errors, []);
    for (const code of ['go', 'bomb', 'boom', 'block', 'death']) assert.ok(seen.has(code), `the round produced ${code} events`);
    assert.ok(maxParticles > 0 && maxParticles <= renderer.particles.cap);
    assert.ok(canvas.ctx.stats.drawImage > 5000, 'sprites were drawn');
    assert.ok(renderer.stats.flashes >= 1 && renderer.stats.shakes >= 1, 'explosions shook and flashed the screen');
    assert.ok(renderer.stats.renderMs < 50);
  });
}

test('soak: a round nobody bombs runs into sudden death and its falling walls render without an error', () => {
  const { renderer, seen } = soak({ n: 3, mode: 'ffa', seed: 8, roundTime: 60, bombRate: 0, ticks: 4700 });
  assert.deepEqual(renderer.errors, []);
  for (const code of ['sdstart', 'sdland']) assert.ok(seen.has(code), `saw ${code}`);
  assert.ok(renderer.banner.t0 > 0 && renderer.banner.text.length > 0, 'the SUDDEN DEATH banner was shown');
});

test('sanity: the closed constants the renderer relies on exist', () => {
  assert.equal(PLAYER_COLORS.length, MAX_PLAYERS);
  assert.equal(GRID_W * GRID_H, 195);
});
