// Blackpine Forest (JOURNEY.md): the layout keeps its SPEC, the route is walkable end to end with the gates
// open and cut at every gate with them shut, the way is wide, the doorways are wide enough, spawns and
// anchors stand on clear ground, and the level's art builds headless on every tier within its budget.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildMap } from '../public/js/shared/maps.js';
import { LEVEL_SPECS } from '../public/js/shared/levels/index.js';
import { checkLevelSpec } from '../public/js/shared/levels/kit.js';
import { FlowField } from '../public/js/shared/flowfield.js';

const ID = 'forest';
const SPEC = LEVEL_SPECS[ID];

// three.js from the vendored copy (the renderer modules import it by its bare name)
const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

const cache = new Map();
const getMap = (seed = 1) => {
  if (!cache.has(seed)) cache.set(seed, buildMap(ID, seed));
  return cache.get(seed);
};

function inRect(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}
/** Separating-axis overlap of two oriented rectangles. */
function overlap(A, Bq) {
  const axes = [A.a || 0, (A.a || 0) + Math.PI / 2, Bq.a || 0, (Bq.a || 0) + Math.PI / 2];
  for (const t of axes) {
    const ux = Math.cos(t), uy = Math.sin(t);
    const proj = (R) => {
      const c = Math.cos(R.a || 0), s = Math.sin(R.a || 0);
      const e = Math.abs(ux * c + uy * s) * R.w / 2 + Math.abs(-ux * s + uy * c) * R.h / 2;
      const m = R.x * ux + R.y * uy;
      return [m - e, m + e];
    };
    const [a0, a1] = proj(A), [b0, b1] = proj(Bq);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
/** A flow field toward the start with the listed gates open. */
function field(map, open, pad) {
  const m = { ...map, obstacles: map.obstacles.filter((o) => !(o.gate && open.has(o.gate))) };
  const ff = new FlowField(m, { pad });
  ff.update([{ x: map.anchors.start.x, y: map.anchors.start.y }]);
  return ff;
}

test(`${ID}: keeps its SPEC and is deterministic`, () => {
  const map = getMap(1);
  assert.deepEqual(checkLevelSpec(map, SPEC), []);
  assert.equal(JSON.stringify(buildMap(ID, 5)), JSON.stringify(buildMap(ID, 5)));
  // the sections in travel order, each with checkpoints and spawns of its own
  assert.deepEqual(map.sections.map((s) => s.id), SPEC.sections.map((s) => s.id));
  for (const s of SPEC.sections) {
    assert.ok(map.checkpoints.filter((c) => c.section === s.id).length >= 2, `${s.id}: two checkpoints`);
    assert.ok(map.zombieSpawns.filter((z) => z.section === s.id).length >= 2, `${s.id}: spawns`);
  }
  assert.ok(map.playerSpawns.length >= 4 && map.playerSpawns.length <= 6);
  assert.ok(map.width <= 12000 && map.height <= 4400);
});

test(`${ID}: checkpoints lie in their sections, anchors and checkpoints on clear ground`, () => {
  const map = getMap(1);
  for (const c of map.checkpoints) {
    const s = map.sections.find((q) => q.id === c.section);
    assert.ok(inRect(s, c.x, c.y), `checkpoint ${c.x},${c.y} outside ${c.section}`);
  }
  for (const p of [...map.checkpoints, ...Object.values(map.anchors)]) {
    for (const o of map.obstacles) assert.ok(!inRect(o, p.x, p.y, 10), `${p.x},${p.y} inside obstacle ${o.id} ${o.kind}/${o.style || ''}`);
  }
  // zombie spawn rectangles touch no obstacle (a zombie can appear anywhere inside one) and no water
  for (const z of map.zombieSpawns) {
    const r = { x: z.x, y: z.y, w: z.w, h: z.h, a: 0 };
    for (const o of map.obstacles) assert.ok(!overlap(r, o), `spawn ${z.section} ${z.x},${z.y} overlaps obstacle ${o.id} ${o.kind}/${o.style || ''}`);
    for (const a of map.areas) if (a.kind === 'water') assert.ok(!overlap(r, a), `spawn ${z.x},${z.y} in water`);
    assert.ok(z.x - z.w / 2 >= 0 && z.y - z.h / 2 >= 0 && z.x + z.w / 2 <= map.width && z.y + z.h / 2 <= map.height, 'spawn inside the world');
  }
  // no spawn inside a roofed room of an earlier section
  const idx = (id) => map.sections.findIndex((s) => s.id === id);
  for (const z of map.zombieSpawns) {
    for (const r of map.roofs) if (r.section && idx(r.section) < idx(z.section)) assert.ok(!inRect(r, z.x, z.y), `spawn ${z.x},${z.y} in an earlier room`);
  }
});

test(`${ID}: doorways are wide, walls thick enough that nobody hops them`, () => {
  const map = getMap(1);
  for (const d of map.art.doors) assert.ok(d.w >= 70, `doorway ${d.x},${d.y} is ${d.w} wide`);
  for (const g of map.gates) {
    for (const oid of g.obstacles) {
      const o = map.obstacles[oid];
      assert.ok(o.w >= 160, `gate ${g.id} opening ${o.w}`);
      assert.ok(Math.min(o.w, o.h) > 8, `gate ${g.id} would be a jumpable fence`);
    }
  }
  for (const o of map.obstacles) if (o.kind === 'wall' && o.style && o.style.startsWith('w:')) assert.ok(o.h > 8, `wall ${o.id} ${o.style} is ${o.h} thick`);
});

test(`${ID}: the route is walkable with the gates open, and every gate cuts it`, () => {
  const map = getMap(1);
  const all = new Set(map.gates.map((g) => g.id));
  const ff = field(map, all, 16);
  for (const c of map.checkpoints) assert.ok(ff.reachable(c.x, c.y), `checkpoint ${c.section} ${c.x},${c.y}`);
  for (const [n, a] of Object.entries(map.anchors)) assert.ok(ff.reachable(a.x, a.y), `anchor ${n}`);
  for (const z of map.zombieSpawns) assert.ok(ff.reachable(z.x, z.y), `spawn ${z.section} ${z.x},${z.y}`);
  // the main way is wide: a ~160 corridor (pad 70 on the 32-unit grid) reaches every checkpoint
  const wide = field(map, all, 70);
  for (const c of map.checkpoints) assert.ok(wide.reachable(c.x, c.y), `narrow before ${c.section} ${c.x},${c.y}`);
  // with a gate shut (and the ones before it open) the next section cannot be reached
  SPEC.gates.forEach((g, i) => {
    const f = field(map, new Set(SPEC.gates.slice(0, i).map((q) => q.id)), 16);
    for (const c of map.checkpoints.filter((q) => q.section === g.to)) assert.ok(!f.reachable(c.x, c.y), `${g.id} shut, ${g.to} still reachable at ${c.x},${c.y}`);
    const from = map.checkpoints.filter((q) => q.section === g.from);
    for (const c of from) assert.ok(f.reachable(c.x, c.y), `${g.id} shut, ${g.from} unreachable at ${c.x},${c.y}`);
  });
});

// ---- the art, headless ---------------------------------------------------------------------------------

let THREE, geo, levels, arch;
before(async () => {
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
  geo = await import('../public/js/render3d/world-geo.js');
  levels = await import('../public/js/render3d/levels/index.js');
  arch = await import('../public/js/render3d/world-arch.js');
});

/** Build the level's art the way world.js does: { tris, meshes, warnings, dress }. */
function buildArt(tier, day) {
  const map = buildMap(ID, 1);
  arch.setDetailLevel(tier === 'low' ? 0 : tier === 'high' ? 1 : tier === 'ultra' ? 2 : 3);
  const buckets = {
    std: { det: true }, paint: { det: true }, glass: { det: true }, vglass: { uv: true, ao: false }, decal: { uv: true }, glow: { uv: true, ao: false },
    neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false },
    sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true }, ...levels.levelBuckets(map),
  };
  const newBuilder = () => geo.createGeoBuilder({ cell: 1600, buckets });
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  try {
    const base = tier === 'cinematic' ? 'ultra' : tier;
    const art = levels.createLevelArt({ map, quality: tier }, {
      root: new THREE.Group(), mats: { get: () => new THREE.MeshBasicMaterial() }, fx: null, halos: [], shafts: [], day, aniso: 1, gy: () => 0,
      tier: base, full: tier, newBuilder, matOf: () => new THREE.MeshBasicMaterial(),
    });
    assert.ok(art, 'the level has art');
    for (const b of Object.keys(art.buckets)) assert.ok(art.material(b, base), `material for ${b}`);
    const B = newBuilder();
    for (const o of map.obstacles) { B.obj(o.x, o.y, o.a || 0, o.id * 31); art.obstacle(B, o); }
    for (const r of map.roofs) art.roof(B, r);
    for (const g of map.gates) for (const oid of g.obstacles) { const o = map.obstacles[oid]; B.obj(o.x, o.y, o.a || 0, 1); art.gateModel(B, g, o); }
    art.props(B);
    const parts = B.finish();
    art.finish();
    art.update({}, { dt: 0.016, camX: 0, camY: 0 });
    art.setQuality(tier);
    let tris = 0;
    for (const { geometry } of parts) tris += geometry.attributes.position.count / 3;
    art.dispose();
    return { tris, meshes: parts.length, warnings, dress: map.dressItems || [] };
  } finally {
    console.warn = warn;
  }
}

test(`${ID}: the art builds on every tier, day and night, within budget`, (t) => {
  let low = 0;
  for (const tier of ['low', 'high', 'ultra', 'cinematic']) {
    const r = buildArt(tier, tier !== 'high');
    t.diagnostic(`${ID} ${tier}: ${Math.round(r.tris)} triangles in ${r.meshes} meshes, ${r.dress.length} dress items`);
    assert.deepEqual(r.warnings, [], `${tier}: ${r.warnings.join(' | ')}`);
    assert.ok(r.tris > 50000, `${tier}: ${r.tris} triangles is too bare`);
    assert.ok(r.tris < (tier === 'cinematic' ? 1.9e6 : 1.2e6), `${tier}: ${r.tris} triangles`);
    assert.ok(r.meshes < 260, `${tier}: ${r.meshes} meshes`);
    if (tier === 'low') low = r.tris;
    else assert.ok(r.tris >= low, `${tier} draws at least what low does`);
    // the hand-placed dressing is in, and nothing of the automatic dressing is left indoors
    const map = getMap(1);
    for (const it of r.dress) {
      if (!it.h) for (const f of map.art.floors) assert.ok(!inRect(f, it.x, it.y), `${it.k} indoors at ${it.x},${it.y}`);
    }
  }
});
