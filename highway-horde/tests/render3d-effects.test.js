// Smoke test of the first-person effects in plain Node (no GL): every event type the
// simulation emits goes through effects3d / ambient3d on every tier, on a real map, in every
// gore mode; nothing may throw and every pool must stay inside its cap. (Pixels are checked
// visually with the Playwright sandbox.)

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

function fakeContext(canvas) {
  const grad = { addColorStop() {} };
  const methods = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 10 }),
  };
  return new Proxy({ canvas }, {
    get: (t, p) => (p in methods ? methods[p] : p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

let THREE, effects, ambient, core, MAP_LIST, buildMap, WEAPONS;

before(async () => {
  globalThis.document = {
    createElement: () => {
      const c = { width: 1, height: 1, style: {} };
      c.getContext = () => fakeContext(c);
      return c;
    },
  };
  THREE = await import('three');
  effects = await import('../public/js/render3d/effects3d.js');
  ambient = await import('../public/js/render3d/ambient3d.js');
  core = await import('../public/js/render3d/fx-core.js');
  const maps = await import('../public/js/shared/maps.js');
  ({ MAP_LIST } = maps);
  buildMap = maps.getMap || maps.buildMap || maps.createMap;
  ({ WEAPONS } = await import('../public/js/shared/weapons.js'));
});

function makeCtx(map, quality, time = 'night') {
  const camera = new THREE.PerspectiveCamera(70, 1.6, 2, 8000);
  const sp = map.playerSpawns[0];
  camera.position.set(sp.x, 52, sp.y);
  camera.updateMatrixWorld();
  let flashes = 0, decals = 0, shakes = 0;
  const ctx = {
    THREE, scene: new THREE.Scene(), camera, map, quality, time, amb: {}, terrain: { flat: true },
    groundY: () => 0, heightOf: () => 60, rng: Math.random,
    lights: { flash: () => { flashes++; }, steady() {} },
    ground: { decal: () => { decals++; } },
    shake: () => { shakes++; },
    overlay: fakeContext({}),
    counts: () => ({ flashes, decals, shakes }),
  };
  return ctx;
}

function eventsFor(map, x, y) {
  const list = [];
  const a = 0.4;
  const rays = (n, hit) => Array.from({ length: n }, (_, i) => ({ x: x + Math.cos(a) * (120 + i * 30), y: y + Math.sin(a) * (120 + i * 30), hit }));
  for (const [id, w] of Object.entries(WEAPONS)) {
    list.push({ type: 'shot', pid: 1, weapon: id, x, y, angle: a, rays: rays(w.kind === 'hitscan' ? Math.min(w.pellets || 1, 6) : 1, 1) });
    list.push({ type: 'shot', pid: 2, weapon: id, x, y, angle: a + 1, rays: rays(3, 2) });
    list.push({ type: 'shot', pid: 1, weapon: id, x, y, angle: a + 2, rays: rays(2, 0) });
  }
  list.push({ type: 'chain', pid: 1, points: [{ x, y }, { x: x + 80, y }, { x: x + 130, y: y + 40 }] });
  list.push({ type: 'melee', pid: 1, x, y, angle: 0, hits: 3 });
  list.push({ type: 'spit', x, y, angle: 1 });
  for (const kind of ['rocket', 'grenade', 'bloater', 'frag']) list.push({ type: 'explosion', x: x + 90, y, r: 150, kind });
  for (const t of ['walker', 'runner', 'brute', 'bloater', 'boss']) {
    list.push({ type: 'zdie', id: 100 + list.length, ztype: t, x: x + 60, y: y + 30, angle: 1, gib: false, by: 1 });
    list.push({ type: 'zdie', id: 300 + list.length, ztype: t, x: x + 70, y: y - 30, angle: 2, gib: true, by: 1 });
  }
  list.push({ type: 'zdie', id: 999, ztype: 'nope', x, y, angle: 0 });
  for (const type of ['scream', 'charge', 'slam', 'freeze', 'ignite', 'pdamage', 'down', 'revived', 'respawn', 'died', 'pickup', 'place', 'destroyed', 'objhit', 'drop', 'bossspawn']) {
    list.push({ type, x: x + 40, y: y + 20, pid: 1, angle: 1, r: 120, amount: 30, kind: type === 'destroyed' ? 'turret' : 'ammo' });
  }
  return list;
}

const view = (map) => {
  const sp = map.playerSpawns[0];
  const zs = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, type: 'walker', x: sp.x + 100 + i * 9, y: sp.y + i * 3, angle: 0, hp: 0.4, flags: 0 }));
  return { players: [{ id: 1, x: sp.x, y: sp.y, angle: 0, state: 'alive', hp: 60, maxHp: 100 }, { id: 2, x: sp.x + 30, y: sp.y, angle: 1, state: 'alive', hp: 100, maxHp: 100 }], zombies: zs, projectiles: [], pickups: [], turrets: [], barricades: [], hazards: [{ id: 1, kind: 'fire', x: sp.x + 50, y: sp.y + 50, r: 80, life: 0.9 }], events: [] };
};

for (const tier of ['cinematic', 'ultra', 'high', 'low']) {
  for (const gore of ['on', 'low', 'off']) {
    test(`every event type runs through the effects on ${tier}, gore ${gore}, without throwing`, () => {
      const map = typeof buildMap === 'function' ? buildMap('highway') : MAP_LIST.find((m) => m.id === 'highway');
      const ctx = makeCtx(map, tier);
      const e = effects.createEffects3D(ctx);
      const amb = ambient.createAmbient3D(ctx);
      const sp = map.playerSpawns[0];
      const evs = eventsFor(map, sp.x, sp.y);
      const v = view(map);
      const frame = (now) => ({ dt: 1 / 30, now, localId: 1, roster: [], local: v.players[0], camX: sp.x, camY: sp.y, camH: 52, pitch: 0, yaw: 0, settings: { gore } });
      core.acquireFx(ctx).setGore(gore);       // (the renderer sets it before the frame's events)
      e.addEvents(evs, { localId: 1 });
      amb.addEvents(evs, { localId: 1 });
      let t = 0;
      for (let f = 0; f < 90; f++) {
        t += 1 / 30;
        core.acquireFx(ctx); core.releaseFx(ctx);
        e.update(v, frame(t));
        amb.update(v, frame(t));
        ctx.scene.children.find((c) => c.name === 'fx-core').update();
        if (f % 20 === 5) e.addEvents(evs.slice(0, 40), { localId: 1 });
      }
      const st = e.stats;
      if (process.env.FX_DEBUG) console.log(tier, gore, JSON.stringify(st), JSON.stringify(ctx.counts()));
      const cap = core.QUALITY[tier];
      assert.ok(st.particles <= cap.particles, 'particles inside the cap');
      assert.ok(st.decals <= cap.gore + cap.marks, 'decals inside the cap');
      assert.ok(st.pieces <= (tier === 'cinematic' ? 240 : 110) && st.casings <= (tier === 'cinematic' ? 340 : 140));
      if (gore !== 'on') assert.equal(st.pieces, 0, `no limbs with gore ${gore}`);
      e.setQuality(tier === 'low' ? 'cinematic' : 'low');
      e.update(v, frame(t + 1));
      e.dispose();
      amb.dispose();
    });
  }
}

test('every map has a complete night grade, tuned per place', async () => {
  const { nightGradeFor } = await import('../public/js/render3d/post.js');
  const seen = new Set();
  for (const id of ['highway', 'truckstop', 'bridge', 'checkpoint', 'harlan', 'unknown-map']) {
    const g = nightGradeFor({ id });
    for (const k of ['contrast', 'saturation', 'vignette', 'grain', 'bloom', 'bloomThreshold']) assert.ok(Number.isFinite(g[k]), `${id}.${k}`);
    for (const k of ['lift', 'gamma', 'gain']) assert.ok(g[k].length === 3 && g[k].every(Number.isFinite), `${id}.${k}`);
    assert.ok(g.saturation > 0.7 && g.saturation < 1.2 && g.grain < 0.06, 'a grade, not a filter');
    seen.add(JSON.stringify([g.saturation, g.lift, g.gain]));
  }
  assert.ok(seen.size >= 5, 'the maps do not all look alike');
});

test('daytime ambient life (birds, motes, leaves) runs and stays inside its budget', () => {
  const map = typeof buildMap === 'function' ? buildMap('highway') : MAP_LIST.find((m) => m.id === 'highway');
  const ctx = makeCtx(map, 'ultra', 'day');
  const amb = ambient.createAmbient3D(ctx);
  const sp = map.playerSpawns[0];
  const v = view(map);
  let t = 0;
  for (let f = 0; f < 240; f++) {
    t += 1 / 30;
    core.acquireFx(ctx); core.releaseFx(ctx);
    amb.update(v, { dt: 1 / 30, now: t, camX: sp.x, camY: sp.y, camH: 52, settings: {} });
    if (f === 60) amb.addEvents([{ type: 'shot', pid: 1, weapon: 'rifle', x: sp.x, y: sp.y, angle: 0, rays: [] }]);
  }
  assert.ok(amb.stats.birds <= 18);
  amb.dispose();
});

test('render scale: supersampling values are accepted and dynamic resolution can climb above 100%', async () => {
  const { normPostSettings, createDynRes, RENDER_SCALE_LIMIT } = await import('../public/js/render3d/post.js');
  assert.equal(RENDER_SCALE_LIMIT, 2);
  for (const v of [0.5, 1, 1.25, 1.5, 2]) assert.equal(normPostSettings({ renderScale: v }).renderScale, v);
  assert.equal(normPostSettings({ renderScale: 3 }).renderScale, 2, 'clamped to the supersampling limit');
  assert.equal(normPostSettings({ renderScale: 0.1 }).renderScale, 0.5);
  assert.equal(normPostSettings({}).renderScale, 'auto');

  // a GPU with lots of headroom (60 fps, 4 ms of GPU) steps up past 1 only when allowed to
  const run = (max) => {
    const dyn = createDynRes(max);
    let now = 0;
    for (let i = 0; i < 60 * 40; i++) { now += 1000 / 60; dyn.tick(now, 4); }
    return dyn.scale;
  };
  assert.equal(run(1), 1, 'phones and hi-dpi screens stay at 100%');
  const up = run(1.5);
  assert.ok(up > 1.3 && up <= 1.5, `desktop climbs toward 150%, got ${up}`);
  // a GPU-bound machine (14.8 ms at 100%, cost grows with the pixel count) settles near
  // the resolution that holds 60 fps instead of staying at 150%
  const dyn = createDynRes(1.5);
  dyn.reset(1.5);
  let now = 0, scale = 1.5;
  for (let i = 0; i < 60 * 90; i++) {
    const gpu = 14.8 * scale * scale;
    now += Math.max(1000 / 60, gpu);
    const ns = dyn.tick(now, gpu);
    if (ns !== null) scale = ns;
  }
  assert.ok(scale <= 1.2 && scale >= 0.85, `settles near what the GPU can hold, got ${scale}`);
});
