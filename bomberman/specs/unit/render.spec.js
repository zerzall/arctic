// render.js under Node with a fake canvas: fit and canvas budget, time-sliced sprite swaps, the flash and shake safety numbers of
// docs/SPEC.md section 8.2, reduced effects, adaptive quality, event handling and a soak run driven by a real World.
// (What the pixels look like is judged by eye with scripts/dev/render/shots.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, STATE, PLAYER_COLORS, GRID_W, GRID_H, MAX_PLAYERS } from '../../shared/constants.js';
import { EVENT_ARGS } from '../../shared/protocol.js';
import { World } from '../../shared/world.js';
import { Renderer, computeLayout, tagStyleFor, tagWanted } from '../../client/js/render.js';
import { makeRng } from '../../shared/rng.js';
import { ClientGame } from '../../client/js/game.js';
import { makeRoom, joinN, say, tick, startMatch } from '../helpers/room-fixtures.js';
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
  renderer.reducedEffects = false;                       // plain assignment works too
  assert.equal(renderer.reducedEffects, false);
  renderer.reducedEffects = null;
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

// ---- Name tags -----------------------------------------------------------------------------------------------------

test('name tags: a coloured pill where there is room, a small pill on phones, plain text on small screens, local-only on the tiniest', () => {
  assert.equal(tagStyleFor(83, 1), 0, '83 css px per tile');
  assert.equal(tagStyleFor(44, 1), 0);
  assert.equal(tagStyleFor(43, 1), 1);
  assert.equal(tagStyleFor(60, 2), 1, '30 css px per tile: a landscape phone');
  assert.equal(tagStyleFor(52, 2), 2, '26 css px per tile: a portrait phone');
  assert.equal(tagWanted(false, 46, 2), true);
  assert.equal(tagWanted(false, 42, 2), false, '21 css px per tile: eight names would hide the arena');
  assert.equal(tagWanted(true, 42, 2), true, 'but the local fighter always keeps theirs');
});

test('on the tiniest screens only the local fighter is tagged', () => {
  const { renderer } = boot({ css: [320, 568], dpr: 2 });
  const m = makeMatch({ n: 4 });
  let now = warmUp(renderer, m.view);
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(renderer.layout.tile, 42);
  const tagged = m.view.players.filter((p) => renderer.players.get(p.id).tag).map((p) => p.id);
  assert.deepEqual(tagged, [m.view.players.find((p) => p.isMe).id]);
});

test('tags of fighters standing shoulder to shoulder are pushed apart instead of printing over each other', () => {
  const { renderer } = boot({ css: [1280, 800], dpr: 1 });
  const m = makeMatch({ n: 4 });
  let now = warmUp(renderer, m.view);
  m.view.players.forEach((p, i) => { p.x = 5.5 + i * 0.8; p.y = 5.5; p.alive = true; p.deadT = 0; });
  renderer.render(m.view, 16.7, now += 16.7);
  const r = renderer.tagRect;
  let checked = 0;
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      const ox = Math.min(r[a * 4] + r[a * 4 + 2], r[b * 4] + r[b * 4 + 2]) - Math.max(r[a * 4], r[b * 4]);
      const oy = Math.min(r[a * 4 + 1] + r[a * 4 + 3], r[b * 4 + 1] + r[b * 4 + 3]) - Math.max(r[a * 4 + 1], r[b * 4 + 1]);
      assert.ok(ox <= 0 || oy <= 0, `tags ${a} and ${b} overlap by ${ox} x ${oy}`);
      checked++;
    }
  }
  assert.equal(checked, 6);
  const me = m.view.players.findIndex((p) => p.isMe), home = Math.round(m.view.players[me].x * renderer.set.tile - r[me * 4 + 2] / 2);
  assert.equal(r[renderer.tagOf.indexOf(me) * 4], home, 'the local fighter\'s tag stays where it belongs');
});

// ---- Danger marks and the local ring --------------------------------------------------------------------------------

/** An open arena: border and pillars only. */
function emptyGrid() {
  let g = '';
  for (let ty = 0; ty < GRID_H; ty++) for (let tx = 0; tx < GRID_W; tx++) g += (tx === 0 || ty === 0 || tx === GRID_W - 1 || ty === GRID_H - 1 || (tx % 2 === 0 && ty % 2 === 0)) ? '#' : '.';
  return g;
}
const bombAt = (id, tx, ty, fuse, range, extra = {}) => ({ id, owner: 0, x: tx + 0.5, y: ty + 0.5, tx, ty, fuse, range, dir: 0, fly: null, pass: [], ...extra });
const at = (tx, ty) => ty * GRID_W + tx;

test('danger marks: a tile burns when the soonest bomb of its chain goes off, walls stop the fire and far bombs are not marked', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  m.view.grid = emptyGrid();
  m.view.bombs = [bombAt(1, 3, 1, 40, 5), bombAt(2, 5, 1, 130, 4), bombAt(3, 11, 9, 100, 3)];
  renderer.render(m.view, 16.7, now += 16.7);
  const d = renderer.danger;
  assert.equal(d[at(3, 1)], 40);
  assert.equal(d[at(3, 6)], 40, 'range 5 reaches down to row 6');
  assert.equal(d[at(5, 1)], 40, 'the second bomb goes off with the first');
  assert.equal(d[at(5, 5)], 40, 'and so do the tiles ITS arms burn, though its own fuse is 130');
  assert.equal(d[at(8, 1)], 40);
  assert.equal(d[at(5, 6)], 1e9, 'its range is 4');
  assert.equal(d[at(1, 1)], 40, 'the left arm runs to the border ...');
  assert.equal(d[at(0, 1)], 1e9, '... and stops at it');
  assert.equal(d[at(11, 9)], 1e9, 'a bomb with 100 ticks left is not marked yet');
  m.view.bombs = [bombAt(1, 3, 1, 40, 5), bombAt(2, 3, 3, 130, 1, { fly: { fx: 3.5, fy: 3.5, tx: 7, ty: 3, left: 10, total: 26 } })];
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(renderer.danger[at(3, 3)], 40, 'the arm passes over a flying bomb: fire ignores it');
  assert.equal(renderer.danger[at(4, 3)], 1e9, 'a bomb in the air is no bomb of the chain');
});

test('crates and pillars stop a bomb\'s marks', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  const cells = emptyGrid().split('');
  cells[at(5, 3)] = '+';
  m.view.grid = cells.join('');
  m.view.bombs = [bombAt(1, 5, 1, 30, 6)];
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(renderer.danger[at(5, 2)], 30);
  assert.equal(renderer.danger[at(5, 3)], 1e9, 'the crate absorbs the arm');
  assert.equal(renderer.danger[at(5, 4)], 1e9);
  assert.equal(renderer.danger[at(6, 1)], 30, 'along the row the fire goes on');
});

test('marked tiles are drawn with the hazard sprite, and the local ring turns to a warning while their own tile is about to burn', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  const hazard = renderer.set.fx.hazard;
  let drawn = 0;
  Object.defineProperty(hazard, 'img', { get() { drawn++; return hazard.__img; }, set(v) { hazard.__img = v; }, configurable: true });
  hazard.__img = { fake: true };
  const rings = [];
  const paintRing = renderer.paintLocalRing.bind(renderer);
  renderer.paintLocalRing = (...a) => { rings.push(a[a.length - 1]); return paintRing(...a); };
  m.view.grid = emptyGrid();
  const me = m.view.players.find((p) => p.isMe);
  me.x = 3.5; me.y = 4.5; me.alive = true;
  m.view.bombs = [];
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(drawn, 0, 'nothing to warn about');
  m.view.bombs = [bombAt(1, 3, 1, 50, 5)];
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(drawn, 13, 'its own tile, two to the left, five to the right, five down (the border stops the arm up)');
  assert.equal(rings.at(-2), 1e9);
  assert.equal(rings.at(-1), 50);
  assert.ok(rings.at(-1) > 45, 'a fuse of 50 is not yet an alarm');
  m.view.bombs = [bombAt(1, 3, 1, 30, 5)];
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(rings.at(-1), 30);
});

test('a fighter with the team ring keeps the gold "this is you" ring around it', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 4, mode: 'teams' });
  renderer.setPlayers(m.round);
  let now = warmUp(renderer, m.view);
  const args = [];
  const paintRing = renderer.paintLocalRing.bind(renderer);
  renderer.paintLocalRing = (...a) => { args.push(a); return paintRing(...a); };
  renderer.render(m.view, 16.7, now += 16.7);
  assert.equal(args.length, 1, 'once, for the local fighter only');
  assert.equal(args[0][5], true, 'and told that there is a team ring to encircle');
});

// ---- Sprite lifecycle: failures, hints ---------------------------------------------------------------------------------

test('a sprite build that fails is dropped, retried after a pause and, from the second failure on, at a lower quality; the frame still draws', () => {
  const create = canvasFactory();
  let fail = true, attempts = 0;
  const flaky = (w, h) => { if (fail) { attempts++; throw new Error('out of canvas memory'); } return create(w, h); };
  const canvas = create(300, 150);
  const renderer = new Renderer(canvas, { createCanvas: flaky, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), random: () => 0.5 });
  renderer.resize(960, 780, 2);
  const view = createView();
  view.grid = emptyGrid();
  let now = 1000;
  renderer.render(view, 16.7, now += 16.7);
  assert.equal(renderer.set, null);
  assert.equal(renderer.buildFailures, 1);
  assert.equal(renderer.errors.length, 1);
  const first = attempts;
  for (let i = 0; i < 20; i++) renderer.render(view, 16.7, now += 16.7);          // 0.33 s: inside the pause
  assert.equal(attempts, first, 'no attempt while waiting');
  renderer.render(view, 16.7, now += 400);
  assert.equal(renderer.buildFailures, 2);
  assert.equal(renderer.quality, 1, 'the second failure lowers the quality: smaller sprites need less canvas memory');
  fail = false;
  for (let i = 0; i < 400 && !renderer.set; i++) renderer.render(view, 16.7, now += 16.7);
  assert.ok(renderer.set, 'the build works again once memory is back');
  assert.equal(renderer.buildFailures, 0);
});

test('a theme hint starts the sprite build before the first View exists, and rendering nothing paints the backdrop colour', () => {
  const { renderer, canvas } = boot();
  renderer.setTheme('lava');
  let now = 1000;
  for (let i = 0; i < 400 && !renderer.set; i++) renderer.render(null, 16.7, now += 16.7);
  assert.ok(renderer.set, 'built without a View');
  assert.equal(renderer.set.theme, 'lava');
  assert.ok(canvas.ctx.stats.fillRect > 0, 'and the canvas was not left black');
  assert.deepEqual(renderer.errors, []);
});

test('items of a kind this build does not know are skipped without losing the frame', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  m.view.items = [{ id: 501, x: 3.5, y: 3.5, kind: 'banana', born: 0 }, { id: 502, x: 5.5, y: 3.5, kind: 'flame', born: 0 }];
  renderer.render(m.view, 16.7, now += 16.7);
  renderer.render(m.view, 16.7, now += 16.7);
  assert.deepEqual(renderer.errors, []);
});

test('one frame with a non-finite position does not poison a fighter\'s walking animation', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  const p = m.view.players[0];
  p.alive = true; p.x = 4.5; p.y = 3.5;
  renderer.render(m.view, 16.7, now += 16.7);
  p.x = NaN;
  renderer.render(m.view, 16.7, now += 16.7);
  for (let i = 0; i < 30; i++) { p.x = 4.5 + i * 0.06; renderer.render(m.view, 16.7, now += 16.7); }
  const fx = renderer.players.get(p.id);
  assert.ok(Number.isFinite(fx.speed) && Number.isFinite(fx.walk));
  assert.equal(fx.moving, true, 'and the fighter is seen walking again');
});

// ---- Adaptive quality and 30 Hz displays -----------------------------------------------------------------------------

test('a display capped to 30 Hz (steady 33.3 ms frames) does not cost quality: a lower level would not make it faster', () => {
  const { renderer, view } = boot();
  view.grid = emptyGrid(); view.players = []; view.bombs = []; view.flames = []; view.items = []; view.falling = []; view.ghostBombs = [];
  let now = 0;
  for (let i = 0; i < 1200; i++) renderer.render(view, 1000 / 30, now += 1000 / 30);
  assert.equal(renderer.quality, 2);
  // the same average with real jitter is a slow renderer
  for (let i = 0; i < 400 && renderer.quality === 2; i++) renderer.render(view, i % 2 ? 24 : 42, now += i % 2 ? 24 : 42);
  assert.equal(renderer.quality, 1);
});

test('frames while a sprite set is being built do not count as slow frames', () => {
  const { renderer } = boot();
  renderer.build = {};                                  // a build in progress
  for (let i = 0; i < 600; i++) renderer.trackFrameTime(i % 2 ? 30 : 60, i * 45);
  assert.equal(renderer.quality, 2);
  renderer.build = null;
  for (let i = 0; i < 400 && renderer.quality === 2; i++) renderer.trackFrameTime(i % 2 ? 30 : 60, 30000 + i * 45);
  assert.equal(renderer.quality, 1);
});

// ---- Effects added with the polish pass ---------------------------------------------------------------------------------

test('an explosion leaves soot on its tile that fades within a few seconds and is gone in the next round', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 3 });
  let now = warmUp(renderer, m.view);
  renderer.handleEvents([boom(6, 5, 3)], m.view, now);
  assert.equal(renderer.scorch[at(6, 5)], now);
  assert.equal(renderer.scorch[at(7, 5)], -1e9, 'only where the bomb stood');
  renderer.render(m.view, 16.7, now += 16.7);
  const after = { ...m.view, state: STATE.COUNTDOWN, countdown: 180 };
  renderer.render({ ...m.view, state: STATE.OVER, countdown: 0 }, 16.7, now += 16.7);
  renderer.render(after, 16.7, now += 16.7);
  assert.equal(renderer.scorch[at(6, 5)], -1e9);
});

test('a rolling bomb kicks up dust as it travels, a resting one does not', () => {
  const { renderer } = boot();
  const m = makeMatch({ n: 2 });
  let now = warmUp(renderer, m.view);
  m.view.grid = emptyGrid();
  let dust = 0;
  const original = renderer.particles.dust.bind(renderer.particles);
  renderer.particles.dust = (...a) => { dust++; return original(...a); };
  for (let i = 0; i < 40; i++) renderer.render({ ...m.view, bombs: [bombAt(9, 3, 1, 100, 2, { x: 3.5 + i * 0.1, dir: 2 })] }, 16.7, now += 16.7);
  assert.ok(dust >= 4, `dust puffs: ${dust}`);
  dust = 0;
  for (let i = 0; i < 40; i++) renderer.render({ ...m.view, bombs: [bombAt(9, 3, 1, 100, 2)] }, 16.7, now += 16.7);
  assert.equal(dust, 0);
});

// ---- The real pipeline ---------------------------------------------------------------------------------------------------

/** A bot brain for the Room made of the harness autopilot (bound to each round's World on first use). */
const pilotBots = ({ seed }) => {
  let pilot = null;
  return { think(world, id) { if (!pilot || pilot.world !== world) pilot = new AutoPilot(world, { seed, bombRate: 0.1 }); return pilot.think(id); } };
};

test('the real pipeline (Room, wire snapshots, ClientGame, Renderer) draws whole rounds and matches, themes changing, without a single error', () => {
  const room = makeRoom({ seed: 31, botFactory: pilotBots });
  const [conn] = joinN(room, 1, { names: ['Ana'] });
  startMatch(room, [conn], { bots: 5, level: 'normal', settings: { theme: 'random', roundTime: 60, rounds: 3 } });
  const { renderer } = boot({ css: [900, 700], dpr: 1 });
  let game = null, read = 0, pilot = null, ghosts = 0, rounds = 0;
  const themes = new Set(), codes = new Set(), states = new Set();
  let now = 0;
  for (let frame = 0; frame < 9000; frame++) {
    tick(room);
    now = room.clock.now();
    for (; read < conn.sent.length; read++) {
      const msg = JSON.parse(conn.sent[read]);
      if (msg.t === 'joined') { game = new ClientGame({ me: msg.id, send: (m) => say(room, conn, m), now: () => room.clock.now() }); game.setSeq(msg.seq); }
      else if (msg.t === 'round') { game.reset(msg); renderer.setPlayers(msg); rounds++; }
      else if (msg.t === 'snap' && game) game.onSnapshot(msg, now);
    }
    if (!game || game.round === null) continue;
    const world = room.world;
    if (world) {
      if (!pilot || pilot.world !== world) pilot = new AutoPilot(world, { seed: 7, bombRate: 0.12 });
      const c = pilot.think(game.me);
      game.setIntent({ d: c.d, bomb: c.b === 1, special: c.x === 1 });
    }
    game.update(now);
    const view = game.getView(now);
    const events = game.takeEvents();
    for (const e of events) codes.add(e[0]);
    ghosts += view.ghostBombs.length;
    themes.add(view.theme); states.add(view.state);
    renderer.handleEvents(events, view);
    renderer.render(view, 1000 / 60, now);
    if (rounds >= 3 && world && world.state === STATE.OVER) break;
  }
  assert.deepEqual(renderer.errors, []);
  assert.ok(rounds >= 3, `rounds played: ${rounds}`);
  for (const code of ['go', 'bomb', 'boom', 'block', 'death', 'pickup', 'itemspawn']) assert.ok(codes.has(code), `saw ${code}`);
  assert.ok(ghosts > 0, 'the local fighter\'s predicted bombs reached the renderer');
  assert.ok(themes.size >= 2, `themes seen: ${[...themes]}`);
  assert.deepEqual([...states].sort(), [0, 1, 2]);
  assert.ok(renderer.stats.builds >= 2, 'the sprite set was rebuilt for a new theme without an error');
});

// ---- Fuzz ---------------------------------------------------------------------------------------------------------------

test('fuzz: random Views and events never throw, and never put a non-finite number into the particle pool', () => {
  const rng = makeRng(20240229);
  const { renderer, view } = boot({ css: [800, 700], dpr: 1 });
  const m = makeMatch({ n: 5 });
  let now = warmUp(renderer, m.view);
  const kinds = ['bomb', 'flame', 'speed', 'kick', 'glove', 'shield', 'skull', 'mystery'];
  const codes = Object.keys(EVENT_ARGS);
  const pickCell = () => [rng.int(GRID_W), rng.int(GRID_H)];
  for (let frame = 0; frame < 500; frame++) {
    const v = createView();
    v.theme = THEMES[rng.int(THEMES.length)]; v.mode = rng.int(2) ? 'teams' : 'ffa'; v.me = rng.int(6) - 1;
    v.state = rng.int(4); v.countdown = rng.int(200); v.timeLeft = rng.int(300) - 1; v.suddenDeath = rng.int(2) === 1;
    v.grid = Array.from({ length: GRID_W * GRID_H }, () => '.#+X'[rng.int(4)]).join('');
    v.players = Array.from({ length: rng.int(9) }, (_, i) => ({
      id: i, x: rng.next() * GRID_W, y: rng.next() * GRID_H, facing: rng.int(4), moving: rng.int(2) === 1, alive: rng.int(3) > 0, shield: [0, 30, 200, 65535][rng.int(4)],
      spawnShield: rng.int(2) * 60, curse: [null, 'slow', 'rush', 'reverse', 'nobomb', 'spam'][rng.int(6)], curseTicks: rng.int(600), deadT: rng.int(80), isMe: i === v.me,
      color: rng.int(8), team: rng.int(2), name: ['Ana', '', 'Grandma Rosalind-Maria', '\u{1F600}'][rng.int(4)], isBot: rng.int(2) === 1,
      bombsMax: 1 + rng.int(8), range: 2 + rng.int(9), speedLv: rng.int(7), kick: rng.int(2) === 1, glove: rng.int(2) === 1,
    }));
    v.bombs = Array.from({ length: rng.int(20) }, (_, i) => {
      const [tx, ty] = pickCell();
      return bombAt(i, tx, ty, rng.next() * 150, 1 + rng.int(10), { owner: rng.int(6) - 1, dir: rng.int(5), x: tx + rng.next(), y: ty + rng.next(),
        fly: rng.int(4) === 0 ? { fx: tx, fy: ty, tx: rng.int(GRID_W), ty: rng.int(GRID_H), left: rng.int(26), total: 26 } : null });
    });
    v.flames = Array.from({ length: rng.int(40) }, () => { const [tx, ty] = pickCell(); return { x: tx + 0.5, y: ty + 0.5, mask: rng.int(16), ticksLeft: rng.next() * 40 }; });
    v.items = Array.from({ length: rng.int(12) }, (_, i) => { const [tx, ty] = pickCell(); return { id: i, x: tx + 0.5, y: ty + 0.5, kind: kinds[rng.int(kinds.length)], born: 0 }; });
    v.falling = Array.from({ length: rng.int(6) }, () => { const [tx, ty] = pickCell(); return { tx, ty, ticksLeft: rng.int(49) }; });
    v.ghostBombs = Array.from({ length: rng.int(3) }, () => { const [tx, ty] = pickCell(); return { x: tx + 0.5, y: ty + 0.5 }; });
    const events = Array.from({ length: rng.int(4) }, () => {
      const code = codes[rng.int(codes.length)], [tx, ty] = pickCell();
      const args = { bombId: rng.int(20), ownerId: rng.int(6), tx, ty, range: 1 + rng.int(9), tiles: [[tx, ty], [Math.min(tx + 1, GRID_W - 1), ty]], playerId: rng.int(8), killerId: rng.int(6) - 1,
        x: rng.next() * GRID_W, y: rng.next() * GRID_H, itemId: rng.int(10), kind: kinds[rng.int(kinds.length)], dir: 1 + rng.int(4), fromTx: tx, fromTy: ty, toTx: tx, toTy: ty, fromId: rng.int(6) - 1 };
      return [code, ...EVENT_ARGS[code].map((name) => (name === 'kind' && code === 'curse' ? ['slow', 'rush', 0][rng.int(3)] : args[name]))];
    });
    if (rng.int(10) === 0) renderer.resize(300 + rng.int(1500), 300 + rng.int(900), 1 + rng.int(2));
    if (rng.int(20) === 0) renderer.showEmote(rng.int(10), rng.int(12));
    renderer.handleEvents(events, v, now);
    renderer.render(v, 16.7 + rng.int(20), now += 16.7);
  }
  assert.deepEqual(renderer.errors, []);
  const p = renderer.particles;
  for (let i = 0; i < p.size; i++) if (p.life[i] > 0) for (const field of [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.s0, p.s1, p.age]) assert.ok(Number.isFinite(field[i]), `slot ${i}`);
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
