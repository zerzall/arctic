// Renderer tests that run in plain Node: camera maths, lighting mood, the dev fixtures'
// coverage of the SPEC, and a smoke run of every drawing code path (all real maps, the
// fixture scene with every entity/flag/event) against a recording mock 2D context.
// Pixel output is checked visually with the Playwright sandbox, not here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM / canvas stand-ins -------------------------------------------------------------

function mockContext(canvas) {
  const store = {
    canvas, fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif', textAlign: 'start',
    textBaseline: 'alphabetic', imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: 'transparent',
  };
  const gradient = () => ({ addColorStop(t, c) { assert.ok(t >= 0 && t <= 1, `color stop ${t}`); assert.equal(typeof c, 'string'); } });
  const methods = {
    createLinearGradient: gradient,
    createRadialGradient: (...a) => { assert.ok(a.every(Number.isFinite), 'radial gradient args finite'); return gradient(); },
    createPattern: () => ({ setTransform() {} }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    drawImage: (img, ...a) => {
      assert.ok(img && img.width > 0, 'drawImage source has a size');
      assert.ok(a.every(Number.isFinite), 'drawImage args finite');
      counters.drawImage++;
    },
    setTransform: (...a) => { assert.ok(a.every(Number.isFinite), 'setTransform args finite'); },
  };
  return new Proxy(store, {
    get(t, p) {
      if (p in methods) return methods[p];
      if (p in t) return t[p];
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
const counters = { drawImage: 0 };

function mockCanvas(w = 300, h = 150) {
  const c = {
    width: w, height: h, clientWidth: w, clientHeight: h, style: {}, dataset: {},
    getBoundingClientRect: () => ({ width: c.clientWidth, height: c.clientHeight, left: 0, top: 0 }),
  };
  let ctx = null;
  c.getContext = () => (ctx || (ctx = mockContext(c)));
  return c;
}

globalThis.document = { createElement: () => mockCanvas() };
globalThis.window = { devicePixelRatio: 1 };
globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} rect() {} arc() {} };

const { createRenderer, renderMapPreview, renderClassPortrait } = await import('../public/js/render/renderer.js');
const { zoomFor, createCamera } = await import('../public/js/render/camera.js');
const { nightFor } = await import('../public/js/render/lighting.js');
const { createFixtureMap, createFixtureScene, allEventsSample } = await import('../public/dev/render-fixtures.js');
const { ZOMBIE_IDS, ZFLAG } = await import('../public/js/shared/zombies.js');
const { PROJECTILE_KINDS } = await import('../public/js/shared/weapons.js');
const { PICKUP_KINDS } = await import('../public/js/shared/items.js');
const { CLASS_IDS } = await import('../public/js/shared/classes.js');
const { PLAYER_COLORS } = await import('../public/js/shared/constants.js');

let maps = null;
try {
  maps = await import('../public/js/shared/maps.js');
} catch {
  maps = null;
}

const SPEC_EVENTS = ['shot', 'chain', 'melee', 'zdie', 'zattack', 'spit', 'scream', 'charge', 'slam', 'explosion',
  'ignite', 'pdamage', 'down', 'revived', 'died', 'respawn', 'pickup', 'buy', 'buyfail', 'reload', 'switch', 'empty',
  'throw', 'place', 'destroyed', 'objhit', 'wave', 'bossspawn', 'waveclear', 'drop', 'gameover', 'victory'];

/** Run `fn` and fail if the renderer logged an error (or a warning, unless allowed). */
function noRenderErrors(fn, allowWarnings = false) {
  const orig = console.error, origWarn = console.warn;
  const errs = [];
  console.error = (...a) => errs.push(a.map(String).join(' '));
  if (!allowWarnings) console.warn = (...a) => errs.push('warn: ' + a.map(String).join(' '));
  try {
    fn();
  } finally {
    console.error = orig;
    console.warn = origWarn;
  }
  assert.deepEqual(errs, [], 'renderer logged errors');
}

// ---- camera & mood ------------------------------------------------------------------------------

test('zoom shows ~1400 world px across 1080p and less on small screens', () => {
  const z = zoomFor(1920, 1080);
  assert.ok(Math.abs(1920 / z - 1400) < 1, `1080p visible ${1920 / z}`);
  const phone = zoomFor(800, 400);
  assert.ok(800 / phone < 1000 && 800 / phone > 700, `phone visible ${800 / phone}`);
  const big = zoomFor(3840, 2160);
  assert.ok(3840 / big > 1400 && 3840 / big < 2400, `4k visible ${3840 / big}`);
});

test('camera clamps to the map, looks ahead and shakes only when allowed', () => {
  const map = { width: 3000, height: 2000 };
  const cam = createCamera(map);
  cam.update(1 / 60, 10, 10, 0, 0, 1400, 800, true, true);
  assert.equal(cam.x, 700);
  assert.equal(cam.y, 400);
  for (let i = 0; i < 240; i++) cam.update(1 / 60, 1500, 1000, 500, 0, 1400, 800, true, false);
  assert.ok(cam.x > 1500 + 100 && cam.x <= 1500 + 231, `look-ahead x ${cam.x}`);
  cam.addTrauma(1);
  cam.update(1 / 60, 1500, 1000, 0, 0, 1400, 800, false, false);
  assert.equal(cam.shakeX, 0);
  cam.addTrauma(1);
  let moved = false;
  for (let i = 0; i < 10; i++) {
    cam.update(1 / 60, 1500, 1000, 0, 0, 1400, 800, true, false);
    if (cam.shakeX !== 0 || cam.shakeY !== 0) moved = true;
  }
  assert.ok(moved, 'shake applied');
});

test('night mood is dark but never opaque', () => {
  for (const d of [0, 0.5, 0.68, 1]) {
    const n = nightFor('#2c4a7a', d);
    assert.ok(n.alpha >= 0.35 && n.alpha <= 0.9, `alpha ${n.alpha}`);
    assert.match(n.color, /^rgb\(\d+,\d+,\d+\)$/);
  }
});

// ---- fixtures follow the SPEC --------------------------------------------------------------------

test('fixture scene exercises every zombie type/flag, projectile, pickup and event', () => {
  const map = createFixtureMap('bus');
  assert.ok(map.width >= 2400 && map.height >= 1600);
  const scene = createFixtureScene(map, { zombies: 250, spam: true, seed: 3 });
  const types = new Set(), projectiles = new Set(), pickups = new Set(), events = new Set(), states = new Set();
  let flags = 0;
  for (let i = 0; i < 60 * 30; i++) {
    const { view, events: ev } = scene.step(1 / 60, 0.5);
    for (const z of view.zombies) { types.add(z.type); flags |= z.flags; }
    for (const p of view.projectiles) projectiles.add(p.kind);
    for (const p of view.pickups) pickups.add(p.kind);
    for (const p of view.players) states.add(p.state);
    for (const e of ev) events.add(e.type);
  }
  for (const t of ZOMBIE_IDS) assert.ok(types.has(t), `zombie ${t}`);
  for (const f of Object.values(ZFLAG)) assert.ok(flags & f, `flag ${f}`);
  for (const k of PROJECTILE_KINDS) assert.ok(projectiles.has(k), `projectile ${k}`);
  for (const k of PICKUP_KINDS) assert.ok(pickups.has(k), `pickup ${k}`);
  for (const s of ['alive', 'downed', 'dead']) assert.ok(states.has(s), `state ${s}`);
  const sample = new Set(allEventsSample(0, 0).map((e) => e.type));
  for (const t of SPEC_EVENTS) assert.ok(events.has(t) || sample.has(t), `event ${t}`);
  for (const t of SPEC_EVENTS) assert.ok(sample.has(t), `sample event ${t}`);
});

// ---- smoke-run every draw path ----------------------------------------------------------------------

function runScene(map, quality, frames, opts = {}) {
  const canvas = mockCanvas(1280, 720);
  const r = createRenderer(canvas, { map, quality, time: opts.time });
  const scene = createFixtureScene(map, { zombies: 250, spam: true, seed: 11 });
  const cursor = { x: 900, y: 300 };
  noRenderErrors(() => {
    r.addEvents(allEventsSample(map.width / 2, map.height / 2), { localId: 1 });
    for (let i = 0; i < frames; i++) {
      const { view, events } = scene.step(1 / 60, i * 0.05);
      r.addEvents(events, { localId: 1 });
      r.render(view, {
        localId: opts.localId ?? 1, roster: scene.roster, now: i / 60, dt: 1 / 60, cursor,
        settings: { screenShake: true, showNames: true, lighting: i % 50 < 40 },
      });
    }
  });
  const w = r.screenToWorld(640, 360);
  const s = r.worldToScreen(w.x, w.y);
  assert.ok(Math.abs(s.x - 640) < 1e-6 && Math.abs(s.y - 360) < 1e-6, 'screen/world round trip');
  const st = r.stats;
  assert.ok(st.particles <= (quality === 'low' ? 700 : 2600), `particle cap ${st.particles}`);
  r.setQuality(quality === 'low' ? 'high' : 'low');
  noRenderErrors(() => r.render(scene.step(1 / 60, 0).view, { localId: 1, roster: scene.roster, dt: 1 / 60 }));
  r.destroy();
  noRenderErrors(() => r.render(null, {}));
  return st;
}

test('predicted shots draw but never flash the hit marker; echo shots only drive it', async () => {
  const { createEffects } = await import('../public/js/render/effects.js');
  const noop = new Proxy({}, { get: () => () => {} });
  const fx = createEffects({ cap: 2000, quality: 'high', decals: noop, zsprites: null });
  let shake = 0;
  const env = { localId: 2, time: 0, player: () => null, dist: () => 0, shake: (a) => { shake += a; } };
  const shotEv = (over) => ({
    type: 'shot', pid: 2, turret: 0, weapon: 'rifle', x: 500, y: 500, angle: 0,
    rays: [{ x: 700, y: 500, hit: 1 }], ...over,
  });
  // Echo: nothing drawn (no particles, flash, light or shake) but a real hit marks.
  fx.addEvents([shotEv({ echo: true })], env);
  assert.equal(fx.count, 0, 'echo spawns no particles');
  assert.equal(shake, 0, 'echo does not shake');
  assert.equal(fx.bloom, 0, 'echo adds no crosshair bloom');
  assert.equal(fx.hitMarker, 1, 'echo hit drives the hit marker');
  fx.update(1);
  assert.equal(fx.hitMarker, 0);
  fx.addEvents([shotEv({ echo: true, rays: [{ x: 700, y: 500, hit: 2 }] })], env);
  assert.equal(fx.hitMarker, 0, 'an echo miss does not mark');
  // Predicted: drawn like any own shot, but its guessed hit does not mark.
  fx.addEvents([shotEv({ predicted: true })], env);
  assert.ok(fx.count > 0, 'predicted shot spawns effects');
  assert.ok(shake > 0, 'predicted shot kicks the camera');
  assert.equal(fx.hitMarker, 0, 'predicted hits are guesses');
  // Unflagged own shot (host / solo): drawn and marks.
  fx.addEvents([shotEv({})], env);
  assert.equal(fx.hitMarker, 1);
});

test('getCamera exposes the camera centre (the audio listener)', () => {
  const map = createFixtureMap('bus');
  const r = createRenderer(mockCanvas(1280, 720), { map, quality: 'high' });
  const scene = createFixtureScene(map, { zombies: 10, seed: 3 });
  noRenderErrors(() => {
    for (let i = 0; i < 60; i++) r.render(scene.step(1 / 60, i / 60).view, { localId: 1, roster: scene.roster, now: i / 60, dt: 1 / 60, settings: { screenShake: false } });
  });
  const c = r.getCamera();
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
  const mid = r.screenToWorld(640, 360);
  assert.ok(Math.abs(mid.x - c.x) < 1e-6 && Math.abs(mid.y - c.y) < 1e-6, 'centre of the screen');
  c.x = -1;
  assert.notEqual(r.getCamera().x, -1, 'read-only copy');
  r.destroy();
});

test('renderer draws the fixture scene in both qualities without errors', () => {
  const map = createFixtureMap('bus');
  counters.drawImage = 0;
  const st = runScene(map, 'high', 240);
  assert.ok(counters.drawImage > 1000, 'something was drawn');
  assert.ok(st.visibleZombies > 50, `visible zombies ${st.visibleZombies}`);
  runScene(map, 'low', 120);
});

test('daytime (time: day): no darkness overlay, both qualities and the map preview draw without errors', () => {
  const map = createFixtureMap('bus');
  counters.drawImage = 0;
  runScene(map, 'high', 120, { time: 'day' });
  assert.ok(counters.drawImage > 500, 'something was drawn');
  runScene(map, 'low', 60, { time: 'day' });
  // a map that plays only the day is previewed in daylight
  const dayMap = { ...createFixtureMap('bus'), time: 'day' };
  noRenderErrors(() => renderMapPreview(mockCanvas(320, 180), dayMap));
});

test('renderer handles every objective kind, spectating and odd input', () => {
  for (const kind of ['bus', 'diner', 'apc', 'radio']) runScene(createFixtureMap(kind), 'high', 30);
  // local player id not in the snapshot (spectator / not yet spawned)
  runScene(createFixtureMap('bus'), 'high', 30, { localId: 99 });
  const map = createFixtureMap('bus');
  const r = createRenderer(mockCanvas(640, 360), { map, quality: 'high' });
  noRenderErrors(() => {
    r.render(null, { dt: 1 / 60 });
    r.render({ tick: 1, players: [] }, { dt: 1 / 60 });            // lists missing
    r.render({ players: [{ id: 1, x: 5, y: 5, angle: 0, state: 'alive', hp: 1, maxHp: 100, slots: [null, null, null], slot: 0 }] }, { localId: 1, dt: 0 });
    r.addEvents([{ type: 'shot', weapon: 'nope', rays: [] }, { type: 'zdie', ztype: 'nope', x: 1, y: 1 }, {}, null], { localId: 1 });
    r.render(null, { dt: 1 / 60 });
  }, true);
  r.destroy();
});

test('real maps: previews and full renders of every map', { skip: !maps && 'shared/maps.js missing' }, () => {
  for (const { id } of maps.MAP_LIST) {
    const map = maps.buildMap(id, 1234);
    noRenderErrors(() => renderMapPreview(mockCanvas(360, 240), map));
    runScene(map, 'high', 20);
  }
});

test('class portraits for every class and colour', () => {
  noRenderErrors(() => {
    for (const cls of CLASS_IDS) for (let c = 0; c < PLAYER_COLORS.length; c++) renderClassPortrait(mockCanvas(96, 96), cls, c);
    renderClassPortrait(mockCanvas(40, 40), 'unknown-class', 42);
  });
});

// ---- the real simulation's snapshots (raw on the host, decoded on clients) --------------------------

let simMod = null, protoMod = null;
try {
  simMod = await import('../public/js/shared/sim.js');
  protoMod = await import('../public/js/shared/protocol.js');
} catch {
  simMod = null;
}

test('renders real Game snapshots, raw and after the wire round trip', { skip: !simMod && 'sim/protocol missing' }, () => {
  const players = CLASS_IDS.map((cls, i) => ({ id: i + 1, name: 'P' + i, color: i, cls }));
  const game = new simMod.Game({
    mapId: 'highway', seed: 9, players,
    settings: { difficulty: 'normal', waves: 15, objective: true, friendlyFire: false },
  });
  const canvas = mockCanvas(1280, 720);
  const r = createRenderer(canvas, { map: game.map, quality: 'high' });
  const roster = players.map((p) => ({ ...p, ready: false, ping: 0, host: p.id === 1 }));
  const seen = new Set();
  noRenderErrors(() => {
    for (let t = 0; t < 60 * 40; t++) {
      for (const p of players) {
        game.setInput(p.id, {
          seq: t, moveX: Math.sin(t / 90 + p.id), moveY: Math.cos(t / 70 + p.id) * 0.5, angle: t / 40 + p.id,
          fire: true, melee: t % 97 === 0, sprint: false, interact: false, reload: false,
          frag: t % 400 === p.id * 10, molotov: t % 500 === p.id * 10, turret: false, barricade: false,
          lastWeapon: false, slot: -1, cycle: 0,
        });
      }
      game.step();
      if (t % 3) continue;
      let snap = game.snapshot();
      if (protoMod && t % 6 === 0) snap = protoMod.decodeSnapshot(protoMod.encodeSnapshot(snap));
      for (const e of snap.events) seen.add(e.type);
      r.addEvents(snap.events, { localId: 1 });
      r.render(snap, { localId: 1, roster, now: t / 60, dt: 1 / 20, cursor: { x: 800, y: 300 }, settings: { screenShake: true, showNames: true, lighting: true } });
    }
  });
  assert.ok(seen.has('shot'), 'real shots rendered');
  r.destroy();
});
