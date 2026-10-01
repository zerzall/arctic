// Fort Harlan Airfield (shared/levels/airbase.js, render3d/levels/airbase*.js): the SPEC holds, the layout
// is deterministic, the route is walkable end to end with every gate open (through the flow field at a
// survivor's width), each gate cuts the later sections off, the tower's radio room stands on terrain the
// sim walks (up its stair only), the anchors stand in the open, and the level art builds headless on every
// tier, by day and by night, within its budget.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildMap } from '../public/js/shared/maps.js';
import { checkLevelSpec, GATE_KINDS } from '../public/js/shared/levels/kit.js';
import { SPEC, DEF, BASE } from '../public/js/shared/levels/airbase.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { mapColliders } from '../public/js/shared/geom.js';
import { terrainOf } from '../public/js/shared/terrain.js';

const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

const ID = 'airbase';
const map = buildMap(ID, 7);

function inRect(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}

/** A flow field from `start` over the map with the listed gates' pieces removed (open). pad 14: a survivor fits. */
function reach(m, open) {
  const m2 = { ...m, obstacles: m.obstacles.filter((o) => !(o.gate && open.has(o.gate))) };
  const ff = new FlowField(m2, { colliders: mapColliders(m2), cell: 16, pad: 14 });
  ff.update([{ x: m.anchors.start.x, y: m.anchors.start.y }]);
  return ff;
}

test('airbase: the SPEC holds (sections in order, anchors, gates of known kinds, checkpoints, spawns)', () => {
  assert.deepEqual(checkLevelSpec(map, SPEC), []);
  assert.equal(map.width, DEF.width);
  assert.equal(map.height, DEF.height);
  assert.ok(map.width <= 12000 && map.height <= 4000);
  for (const g of map.gates) assert.ok(GATE_KINDS.includes(g.kind));
  for (const s of SPEC.sections) {
    assert.ok(map.checkpoints.filter((c) => c.section === s.id).length >= 2, `${s.id}: two checkpoints`);
    assert.ok(map.zombieSpawns.filter((z) => z.section === s.id).length >= 2, `${s.id}: spawns`);
  }
  // SPEC gates keep their kinds
  for (const g of SPEC.gates) assert.equal(map.gates.find((q) => q.id === g.id).kind, g.kind);
});

test('airbase: deterministic for a seed', () => {
  assert.equal(JSON.stringify(buildMap(ID, 11)), JSON.stringify(buildMap(ID, 11)));
});

test('airbase: the route is walkable with every gate open; every checkpoint, anchor and spawn is reachable', () => {
  const ff = reach(map, new Set(map.gates.map((g) => g.id)));
  for (const c of map.checkpoints) assert.ok(ff.reachable(c.x, c.y), `checkpoint ${c.section} (${c.x}, ${c.y})`);
  for (const [n, a] of Object.entries(map.anchors)) assert.ok(ff.reachable(a.x, a.y), `anchor ${n}`);
  for (const z of map.zombieSpawns) assert.ok(ff.reachable(z.x, z.y), `spawn ${z.section} (${z.x}, ${z.y})`);
});

test('airbase: each gate shut cuts off every later section', () => {
  const secs = SPEC.sections.map((s) => s.id);
  for (const g of SPEC.gates) {
    const ff = reach(map, new Set(SPEC.gates.filter((q) => q.id !== g.id).map((q) => q.id)));
    const to = secs.indexOf(g.to);
    for (const c of map.checkpoints) {
      const i = secs.indexOf(c.section);
      if (i >= to) assert.ok(!ff.reachable(c.x, c.y), `${g.id} shut, yet ${c.section} (${c.x}, ${c.y}) is reachable`);
      else assert.ok(ff.reachable(c.x, c.y), `${g.id} shut cuts off the earlier ${c.section}`);
    }
  }
});

test('airbase: gates fill doorways a crowd fits through; anchors and checkpoints stand in the open', () => {
  for (const g of map.gates) {
    for (const id of g.obstacles) {
      const o = map.obstacles[id];
      assert.ok(Math.max(o.w, o.h) >= 70, `${g.id} is ${Math.max(o.w, o.h)} wide`);
    }
  }
  const solid = map.obstacles.filter((o) => o.solid);
  for (const [n, a] of Object.entries(map.anchors)) assert.ok(!solid.some((o) => inRect(o, a.x, a.y, 4)), `anchor ${n} in an obstacle`);
  for (const c of map.checkpoints) assert.ok(!map.obstacles.some((o) => inRect(o, c.x, c.y, 10)), `checkpoint ${c.section} in an obstacle`);
  for (const p of map.playerSpawns) assert.ok(!map.obstacles.some((o) => inRect(o, p.x, p.y, 10)), 'player spawn in an obstacle');
});

test('airbase: plays by night; the radio room stands on terrain up its stair, gates and roofs on the ground', () => {
  assert.equal(SPEC.time, 'night');
  assert.ok(map.look && map.look.day && map.look.night, 'a look for both times of day');
  const t = terrainOf(map);
  assert.ok(!t.flat);
  const T = BASE.tower;
  assert.equal(t.height(8740, 1600), T.floor, 'the radio room');
  assert.equal(t.height(8480, 1650), 0, 'the lobby');
  for (const g of map.gates) for (const id of g.obstacles) assert.equal(t.height(map.obstacles[id].x, map.obstacles[id].y), 0, `${g.id} on the ground`);
  for (const r of map.roofs) assert.equal(t.height(r.x - r.w / 2 + 2, r.y + r.h / 2 - 2), 0, `roof ${r.style} stands on the ground`);
  // the flight's risers are walkable without falling
  for (const fl of map.levelArt.flights) {
    let prev = null;
    for (let k = 0; k <= 200; k++) {
      const x = fl.x0 - 4 + (fl.x1 - fl.x0 + 8) * (k / 200);
      const h = t.height(x, (fl.y0 + fl.y1) / 2);
      if (prev !== null) assert.ok(h - prev <= 12.01 && h >= prev - 0.01, `flight step ${prev} → ${h}`);
      prev = h;
    }
  }
  // nowhere in the lobby is the radio room's floor within a step: its edge is walled except at the stair
  const solid = map.obstacles.filter((o) => o.solid);
  for (let y = T.y0 + 12; y < T.y1 - 12; y += 4) {
    for (let x = T.x0 + 12; x < T.x1 - 12; x += 4) {
      const h = t.height(x, y);
      if (h < 1 || solid.some((o) => inRect(o, x, y, 0))) continue;
      for (const [dx, dy] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
        const h2 = t.height(x + dx, y + dy);
        if (h - h2 > 12.01 && !solid.some((o) => inRect(o, x + dx / 2, y + dy / 2, 2))) assert.fail(`an open drop of ${h - h2} at (${x}, ${y})`);
      }
    }
  }
  const ff = reach(map, new Set(map.gates.map((g) => g.id)));
  assert.ok(ff.reachable(map.anchors.tower_radio.x, map.anchors.tower_radio.y));
  assert.ok(ff.reachable(map.anchors.hangar_plane.x, map.anchors.hangar_plane.y));
});

// ---- the renderer, headless -----------------------------------------------------------------------

let THREE, geo, levels, arch;

before(async () => {
  globalThis.document = {
    createElement: () => {
      const c = { width: 1, height: 1, style: {} };
      const grad = { addColorStop() {} };
      const methods = {
        createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        measureText: () => ({ width: 10 }),
      };
      c.getContext = () => new Proxy({ canvas: c }, { get: (t, p) => (p in methods ? methods[p] : p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
      return c;
    },
  };
  THREE = await import('three');
  geo = await import('../public/js/render3d/world-geo.js');
  levels = await import('../public/js/render3d/levels/index.js');
  arch = await import('../public/js/render3d/world-arch.js');
});

function buildArt(m, tier, day) {
  arch.setDetailLevel(tier === 'low' ? 0 : tier === 'high' ? 1 : tier === 'ultra' ? 2 : 3);
  const t = terrainOf(m);
  const gy = t.flat ? () => 0 : (x, y) => t.height(x, y);
  const buckets = {
    std: { det: true }, paint: { det: true }, glass: { det: true }, vglass: { uv: true, ao: false }, decal: { uv: true }, glow: { uv: true, ao: false },
    neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false },
    sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true }, ...levels.levelBuckets(m),
  };
  const newBuilder = () => { const b = geo.createGeoBuilder({ cell: 1600, buckets }); b.setGround(gy); return b; };
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  try {
    const root = new THREE.Group();
    const ctx = { map: m, quality: tier, camera: new THREE.PerspectiveCamera(), lights: { steady() {}, flash() {} } };
    const fx = { uTime: { value: 0 }, uFog: { value: 0.001 }, uFogColor: { value: new THREE.Color() }, uPx: { value: 500 } };
    const art = levels.createLevelArt(ctx, { root, mats: { get: () => new THREE.MeshBasicMaterial() }, fx, halos: [], shafts: [], day, aniso: 1, gy, tier: tier === 'cinematic' ? 'ultra' : tier, full: tier, newBuilder, matOf: () => new THREE.MeshBasicMaterial() });
    assert.ok(art, 'the level has art');
    for (const b of Object.keys(art.buckets)) assert.ok(art.material(b, tier === 'low' ? 'low' : 'high'), `material for ${b}`);
    const B = newBuilder();
    const undrawn = new Set();
    for (const o of m.obstacles) { B.obj(o.x, o.y, o.a || 0, o.id * 31); if (!art.obstacle(B, o) && o.style) undrawn.add(o.style); }
    for (const r of m.roofs) art.roof(B, r);
    art.props(B);
    for (const g of m.gates) { const o = m.obstacles[g.obstacles[0]]; B.obj(o.x, o.y, o.a || 0, 1); assert.ok(art.gateModel(B, g, o), `gate model ${g.id}`); }
    const parts = B.finish();
    art.finish();
    for (let k = 0; k < 3; k++) art.update({}, { dt: 0.05, camX: 1000, camY: 3000 });
    art.setQuality(tier);
    let tris = 0;
    for (const { geometry } of parts) {
      tris += geometry.attributes.position.count / 3;
      const p = geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 97) assert.ok(Number.isFinite(p[i]), 'finite vertices');
    }
    const extra = root.children.length;
    art.dispose();
    return { tris, meshes: parts.length, extra, warnings, undrawn: [...undrawn] };
  } finally {
    console.warn = warn;
  }
}

test('airbase: the level art builds on every tier, day and night, within budget', (t) => {
  for (const [tier, day] of [['low', true], ['high', false], ['ultra', true], ['cinematic', false]]) {
    const r = buildArt(map, tier, day);
    t.diagnostic(`${tier}${day ? ' day' : ' night'}: ${Math.round(r.tris)} triangles in ${r.meshes} meshes (+${r.extra} fx meshes)`);
    assert.deepEqual(r.warnings, [], `${tier}: ${r.warnings.join(' | ')}`);
    assert.deepEqual(r.undrawn, [], `${tier}: styles the art does not draw`);
    assert.ok(r.tris > 50000, `${tier}: ${r.tris} triangles is too little art`);
    assert.ok(r.tris < (tier === 'low' ? 450000 : 1300000), `${tier}: ${r.tris} triangles`);
    assert.ok(r.meshes < 260, `${tier}: ${r.meshes} meshes`);
  }
});
