// Harlan Metro (story level 5, shared/levels/metro.js + render3d/levels/metro.js): the SPEC,
// determinism, the route walkable through the flow field with every gate open, each gate cutting the
// route, doorways wide enough, anchors / checkpoints / spawns on clear ground, the levels of the city
// (the street and the square up top, the concourse, the platform, the tunnels), the stairs between
// them, and the level art building headless on every tier.
//
// (The checks are repeated in level-mall and level-metro: each test file stands alone.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildMap } from '../public/js/shared/maps.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { mapColliders } from '../public/js/shared/geom.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import { LEVEL_SPECS } from '../public/js/shared/levels/index.js';
import { checkLevelSpec, GATE_KINDS, ROOF_KINDS } from '../public/js/shared/levels/kit.js';
import { DRESS_KINDS } from '../public/js/shared/dress.js';

// three.js from the vendored copy (the renderer modules import it by its bare name)
const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

/** A flow field of the map with the gates in `open` (ids) made non-solid, seeded at (x, y). */
export function fieldFrom(map, open, x, y) {
  const openSet = new Set(open);
  const cols = mapColliders(map).filter((b) => !(b.ref && b.ref.gate && openSet.has(b.ref.gate)));
  const f = new FlowField(map, { colliders: cols });
  f.update([{ x, y }]);
  return f;
}

/** Is (x, y) reachable in field f (the point's cell, or an open cell within one cell of it)? */
export function reach(f, x, y) {
  if (f.reachable(x, y)) return true;
  for (const [dx, dy] of [[32, 0], [-32, 0], [0, 32], [0, -32], [24, 24], [-24, 24], [24, -24], [-24, -24]]) {
    if (f.reachable(x + dx, y + dy)) return true;
  }
  return false;
}

/** Every structural check of a level (the map built with seed 7). */
export function checkLevel(id) {
  const map = buildMap(id, 7);
  const spec = LEVEL_SPECS[id];
  assert.deepEqual(checkLevelSpec(map, spec), [], 'spec');
  // the hand placed dressing uses kinds the renderer knows (an unknown kind draws a placeholder)
  for (const d of map.dressItems || []) assert.ok(DRESS_KINDS[d.k], 'dress kind ' + d.k);
  assert.ok(map.width <= 12400 && map.height <= 5600, 'world size');
  for (const r of map.roofs) assert.ok(ROOF_KINDS.includes(r.kind), 'roof kind ' + r.kind);
  for (const g of map.gates) assert.ok(GATE_KINDS.includes(g.kind));

  // doorways: every door frame (open doorways and the gates) at least 70 wide
  const doors = (map.levelArt || []).filter((a) => a.t === 'door');
  for (const d of doors) assert.ok(d.w >= 70, `door at ${d.x},${d.y} is ${d.w} wide`);
  // gates fill their doorway and are at least 70 wide; every gate has a frame
  for (const g of map.gates) {
    const obs = g.obstacles.map((i) => map.obstacles[i]);
    const span = obs.reduce((s, o) => s + o.w, 0);
    assert.ok(span >= 70, `gate ${g.id} is ${span} wide`);
    assert.ok(doors.some((d) => d.gate === g.id), `gate ${g.id} has a door frame`);
  }

  // anchors, checkpoints and spawns stand on clear ground (a survivor fits there)
  const world = createCollisionWorld(map);
  for (const [n, a] of Object.entries(map.anchors)) assert.ok(world.isCircleFree(a.x, a.y, 16, false), `anchor ${n} at ${a.x},${a.y} is blocked`);
  for (const c of map.checkpoints) assert.ok(world.isCircleFree(c.x, c.y, 16, false), `checkpoint ${c.section} at ${c.x},${c.y} is blocked`);
  for (const z of map.zombieSpawns) {
    let free = 0, n = 0;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      n++;
      if (world.isCircleFree(z.x - z.w / 2 + (z.w * i) / 4, z.y - z.h / 2 + (z.h * j) / 4, 12, false)) free++;
    }
    assert.ok(free >= n * 0.6, `spawn rect ${z.section} at ${z.x},${z.y} is mostly blocked (${free}/${n})`);
    assert.ok(map.sections.some((s) => s.id === z.section), 'spawn section');
  }

  // the route: with every gate open, every checkpoint and anchor is reachable from the start
  const st = map.anchors.start;
  const all = map.gates.map((g) => g.id);
  const open = fieldFrom(map, all, st.x, st.y);
  for (const c of map.checkpoints) assert.ok(reach(open, c.x, c.y), `checkpoint ${c.section} ${c.x},${c.y} unreachable with the gates open`);
  for (const [n, a] of Object.entries(map.anchors)) assert.ok(reach(open, a.x, a.y), `anchor ${n} unreachable with the gates open`);

  // each gate cuts the route: shut it alone and the sections past it are cut off, the ones before are not
  const secIndex = Object.fromEntries(map.sections.map((s) => [s.id, s.i]));
  for (const g of spec.gates) {
    const f = fieldFrom(map, all.filter((x) => x !== g.id), st.x, st.y);
    for (const c of map.checkpoints) {
      const i = secIndex[c.section];
      if (i <= secIndex[g.from]) assert.ok(reach(f, c.x, c.y), `${g.id} shut: ${c.section} checkpoint should stay reachable`);
      if (i >= secIndex[g.to]) assert.ok(!f.reachable(c.x, c.y), `${g.id} shut: ${c.section} checkpoint ${c.x},${c.y} must be cut off`);
    }
  }
  return map;
}

// ---- the level art, headless ------------------------------------------------------------------------

let THREE = null, geoMod = null;

/** Load three.js and the geo builder with a fake canvas (the atlas painters draw into nothing). */
export async function loadRenderer() {
  if (THREE) return { THREE, geoMod };
  globalThis.document = globalThis.document || {
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
  geoMod = await import('../public/js/render3d/world-geo.js');
  return { THREE, geoMod };
}

/**
 * Build a level's art the way world.js does (obstacles, roofs, props, finish) on a tier, headless.
 * Returns { tris, meshes, warnings, finishMeshes }.
 */
export async function buildLevelArt(map, tier, day = false) {
  const { THREE: T3, geoMod: G } = await loadRenderer();
  const levels = await import('../public/js/render3d/levels/index.js');
  const { createWorldMaterials } = await import('../public/js/render3d/world-mat.js');
  const { setDetailLevel } = await import('../public/js/render3d/world-arch.js');
  const { terrainOf } = await import('../public/js/shared/terrain.js');
  const terr = terrainOf(map);
  const gy = terr.flat ? () => 0 : (x, y) => terr.height(x, y);
  const buckets = {
    std: { det: true }, paint: { det: true }, glass: { det: true }, vglass: { uv: true, ao: false }, decal: { uv: true }, glow: { uv: true, ao: false },
    neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false },
    sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true }, ...levels.levelBuckets(map),
  };
  const newBuilder = () => { const b = G.createGeoBuilder({ cell: 1600, buckets }); if (!terr.flat) b.setGround(gy); return b; };
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  setDetailLevel(tier === 'low' ? 0 : tier === 'high' ? 1 : tier === 'ultra' ? 2 : 3);
  try {
    const tex = new T3.DataTexture(new Uint8Array(4), 1, 1);
    const mats = createWorldMaterials({ detail: tex, atlas: tex, chain: tex, leaves: tex });
    const root = new T3.Group();
    const halos = [], shafts = [];
    const ctx = { map, quality: tier, groundY: gy, terrain: terr };
    const art = levels.createLevelArt(ctx, { root, mats, fx: null, halos, shafts, day, aniso: 1, gy, tier: tier === 'cinematic' ? 'ultra' : tier, full: tier, newBuilder, matOf: (b, t) => (art && art.buckets[b] ? art.material(b, t) : mats.get(b, t)) });
    assert.ok(art, 'the level has art');
    const B = newBuilder();
    for (const o of map.obstacles) {
      B.obj(o.x, o.y, o.a || 0, o.id * 31);
      art.obstacle(B, o);
    }
    for (const r of map.roofs) art.roof(B, r);
    art.props(B);
    const parts = B.finish();
    let tris = 0;
    for (const { bucket, geometry } of parts) {
      tris += geometry.attributes.position.count / 3;
      assert.ok(art.buckets[bucket] || mats.get(bucket, 'high'), `material for ${bucket}`);
      const p = geometry.attributes.position.array;
      for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new Error(`NaN vertex in ${bucket}`);
    }
    art.finish();
    let finishMeshes = 0, finishTris = 0;
    root.traverse((m) => { if (m.isMesh) { finishMeshes++; finishTris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; } });
    art.update({ players: [], zombies: [] }, { dt: 0.016, camX: map.anchors.start.x, camY: map.anchors.start.y });
    art.setQuality(tier === 'low' ? 'high' : 'low');
    art.dispose();
    mats.dispose();
    return { tris, meshes: parts.length, warnings, finishMeshes, finishTris, halos: halos.length };
  } finally {
    console.warn = warn;
  }
}


// ---------------------------------------------------------------------------------------------

const ID = 'metro';

test('metro: builds, keeps its SPEC, the route and the gates work', () => {
  checkLevel(ID);
});

test('metro: a day level; deterministic for a seed; dressing and art lists are data', () => {
  const a = buildMap(ID, 3), b = buildMap(ID, 3);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(LEVEL_SPECS[ID].time, 'day');
  assert.ok(a.levelArt.length > 50, 'art items');
  assert.ok(a.dressItems.length > 200, 'hand placed dressing');
});

test('metro: the street and the square up top, the concourse, platform and tunnels below; the stairs walk', async () => {
  const { terrainOf } = await import('../public/js/shared/terrain.js');
  const map = buildMap(ID, 7);
  const t = terrainOf(map);
  const a = map.anchors;
  const at = (n) => t.height(a[n].x, a[n].y);
  for (const n of ['start', 'metro_entrance', 'newsstand', 'square_statue', 'exit_stairs']) assert.equal(at(n), 320, n + ' is at street level');
  for (const n of ['concourse_gates', 'ticket_office', 'concourse_shops']) assert.equal(at(n), 140, n + ' is in the concourse');
  for (const n of ['platform_train', 'platform_cab', 'platform_end']) assert.equal(at(n), 40, n + ' is on the platform');
  for (const n of ['tunnel_junction', 'tunnel_signal', 'pump_room', 'sump_valve', 'breaker', 'workshop', 'maint_lift']) assert.equal(at(n), 0, n + ' is down in the tunnels');
  // walking the stairs: the ground never steps more than a walker follows
  for (const [y, x0, x1] of [[2110, 2290, 2710], [1200, 4790, 5210], [960, 8790, 9010], [4310, 4890, 5510]]) {
    let prev = null;
    for (let x = x0; x <= x1; x++) { const h = t.height(x, y); if (prev !== null) assert.ok(Math.abs(h - prev) <= 4, `step ${h - prev} at ${x},${y}`); prev = h; }
  }
  // the train's cars are entered from the platform at its level
  for (const [x0, x1] of [[5500, 6100], [6120, 6720], [6740, 7340]]) assert.equal(t.height((x0 + x1) / 2, 745), 40, 'car floor');
});

test('metro: the level art builds on every tier, by day and by night, within budget', async (t) => {
  const map = buildMap(ID, 7);
  const out = {};
  for (const tier of ['low', 'high', 'ultra', 'cinematic']) {
    for (const day of [true, false]) {
      const r = await buildLevelArt(map, tier, day);
      assert.deepEqual(r.warnings, [], `${tier}${day ? ' day' : ''}: ${r.warnings.join(' | ')}`);
      out[tier + (day ? '-day' : '')] = r;
    }
  }
  for (const [k, r] of Object.entries(out)) t.diagnostic(`${k}: static ${Math.round(r.tris)} tris in ${r.meshes} meshes; finish ${Math.round(r.finishTris)} tris in ${r.finishMeshes} meshes; ${r.halos} halos`);
  assert.ok(out['ultra-day'].tris + out['ultra-day'].finishTris < 1300000, `ultra: ${out['ultra-day'].tris + out['ultra-day'].finishTris} triangles`);
  assert.ok(out['low-day'].tris < out['ultra-day'].tris, 'low is lighter than ultra');
  assert.ok(out['ultra-day'].meshes + out['ultra-day'].finishMeshes < 260, `ultra: ${out['ultra-day'].meshes + out['ultra-day'].finishMeshes} meshes`);
});
