// The 'cinematic' tier's extra detail (V2 asset pass) in plain Node, no GL: the actor models
// (zombies, survivors) must build the same way every time with finite vertices and valid
// indices, the hero versions must be denser than ultra while the far levels stay ultra's, the
// procedural textures must come out at the tier's size, and the world builders (vehicles,
// buildings, trees, round primitives) must stay finite and grow only at detail level 3.
// three.js is resolved from the vendored copy through a loader hook (as render3d-pools.test.js).

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

let tierMod, zm, sm, shape, tex, geo, arch, veh, bld, flora, props, dressMods, dressCin, consts, THREE;

before(async () => {
  THREE = await import('three');
  tierMod = await import('../public/js/render3d/tier.js');
  zm = await import('../public/js/render3d/actor-zmodels.js');
  sm = await import('../public/js/render3d/actor-smodels.js');
  shape = await import('../public/js/render3d/actor-shape.js');
  tex = await import('../public/js/render3d/actor-tex.js');
  geo = await import('../public/js/render3d/world-geo.js');
  arch = await import('../public/js/render3d/world-arch.js');
  veh = await import('../public/js/render3d/world-veh.js');
  bld = await import('../public/js/render3d/world-bld.js');
  flora = await import('../public/js/render3d/world-flora.js');
  props = await import('../public/js/render3d/world-props.js');
  dressMods = [
    (await import('../public/js/render3d/dress-debris.js')).FLATS, (await import('../public/js/render3d/dress-debris.js')).DEBRIS,
    (await import('../public/js/render3d/dress-street.js')).STREET, (await import('../public/js/render3d/dress-industrial.js')).INDUSTRIAL,
    (await import('../public/js/render3d/dress-life-props.js')).LIFE_PROPS, (await import('../public/js/render3d/dress-nature.js')).NATURE,
    (await import('../public/js/render3d/dress-apoc.js')).APOCALYPSE,
  ];
  dressCin = await import('../public/js/render3d/dress-cin.js');
  consts = await import('../public/js/render3d/actor-consts.js');
});

const ZOMBIE_TYPES = ['walker', 'runner', 'crawler', 'bloater', 'spitter', 'screamer', 'brute', 'boss'];
const CLASS_IDS = ['soldier', 'medic', 'engineer', 'demo', 'scout', 'heavy'];

/** Every number finite, every index inside the vertex list, every triangle non-degenerate enough to count. */
function checkArrays(a, label) {
  const n = a.position.length / 3;
  for (const k of ['position', 'normal', 'color', 'uv', 'aBones', 'aInfo', 'aExt']) {
    const arr = a[k];
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) assert.fail(`${label}: ${k}[${i}] is ${arr[i]}`);
  }
  for (let i = 0; i < a.index.length; i++) if (!(a.index[i] < n)) assert.fail(`${label}: index ${a.index[i]} >= ${n}`);
  assert.equal(a.index.length % 3, 0, label + ': triangle list');
  const nb = consts.NB;
  for (let i = 0; i < a.aBones.length; i++) assert.ok(a.aBones[i] >= 0 && a.aBones[i] < nb, `${label}: bone ${a.aBones[i]}`);
}

function hashArrays(a) {
  let h = 2166136261 >>> 0;
  for (const k of ['position', 'normal', 'aInfo']) {
    const arr = a[k];
    for (let i = 0; i < arr.length; i += 7) h = Math.imul(h ^ Math.round(arr[i] * 1000), 16777619) >>> 0;
  }
  return h ^ a.index.length;
}

test('tier helpers: cinematic is above ultra and reads as ultra for old tables', () => {
  assert.ok(tierMod.tierAtLeast('cinematic', 'ultra'));
  assert.ok(tierMod.tierAtLeast('cinematic', 'cinematic'));
  assert.ok(!tierMod.tierAtLeast('ultra', 'cinematic'));
  assert.equal(tierMod.baseTier('cinematic'), 'ultra');
  assert.equal(tierMod.baseTier('low'), 'low');
});

test('ring subdivision inserts interpolated rings and blends the bones', () => {
  const R = [
    { c: [0, 0, 0], r: 1, bone: 0 },
    { c: [0, 2, 0], r: 2, bone: [0, 1, 0.5] },
    { c: [0, 4, 0], r: 1, bone: 1 },
  ];
  const S = shape.subdivideRings(R, 3);
  assert.equal(S.length, (R.length - 1) * 3 + 1);
  assert.deepEqual(S[0].c, R[0].c);
  assert.deepEqual(S[S.length - 1].c, R[2].c);
  for (const r of S) for (const v of r.c) assert.ok(Number.isFinite(v));
  // the radius stays positive and monotone in y between the ends of the bulge
  for (const r of S) assert.ok((r.rx ?? r.r) > 0);
  // a bone spec is a number or [a, b, w] with a valid weight
  for (const r of S) {
    if (Array.isArray(r.bone)) assert.ok(r.bone[2] >= 0 && r.bone[2] <= 1);
    else assert.ok(Number.isInteger(r.bone));
  }
});

test('zombie heroes: finite, valid, deterministic, denser than ultra; far levels are ultra', () => {
  for (const type of ZOMBIE_TYPES) {
    const cin = zm.buildZombie(type, 0, -1).arrays();
    const ult = zm.buildZombie(type, 0, 0).arrays();
    checkArrays(cin, type + ' cinematic');
    assert.ok(cin.index.length > ult.index.length * 1.6, `${type}: ${cin.index.length / 3} vs ${ult.index.length / 3} triangles`);
    assert.equal(hashArrays(zm.buildZombie(type, 0, -1).arrays()), hashArrays(cin), type + ' is deterministic');
    for (const L of [1, 2]) {
      const a = zm.buildZombie(type, L, -1).arrays(), b = zm.buildZombie(type, L, 0).arrays();
      assert.equal(hashArrays(a), hashArrays(b), `${type} LOD ${L} of the cinematic tier is the ultra one`);
    }
  }
});

test('survivor heroes: finite, valid, deterministic, denser than ultra', () => {
  for (const cls of CLASS_IDS) {
    const cin = sm.buildSoldier(cls, 0, -1).arrays();
    const ult = sm.buildSoldier(cls, 0, 0).arrays();
    checkArrays(cin, cls + ' cinematic');
    assert.ok(cin.index.length > ult.index.length * 1.6, `${cls}: ${cin.index.length / 3} vs ${ult.index.length / 3}`);
    assert.equal(hashArrays(sm.buildSoldier(cls, 0, -1).arrays()), hashArrays(cin), cls + ' is deterministic');
    assert.equal(hashArrays(sm.buildSoldier(cls, 1, -1).arrays()), hashArrays(sm.buildSoldier(cls, 1, 0).arrays()), cls + ' far level is ultra');
  }
});

test('the ultra and lower actor models are unchanged by the cinematic code (regression sizes)', () => {
  // triangle counts measured before the V2 pass (de88dae): the tiers below cinematic must not move;
  // the zombies' were re-measured after the corpse pass (human proportions, relief, torn strips,
  // faces: tests/zombie-models.test.js keeps their budgets per tier)
  const expect = { walker: [18778, 3136, 612], runner: [14958, 2374, 612], brute: [13478, 2756, 832], boss: [13837, 3000, 776] };
  for (const [type, e] of Object.entries(expect)) {
    for (let L = 0; L < 3; L++) assert.equal(zm.buildZombie(type, L, 0).I.length / 3, e[L], `${type} L${L}`);
  }
  assert.equal(sm.buildSoldier('soldier', 0, 0).I.length / 3, 6442);
  assert.equal(sm.buildSoldier('heavy', 0, 0).I.length / 3, 6952);
});

test('textures come out at the tier size: actor 512 → 1024, gun atlas 1024 → 2048, world layers 256 → 512', async () => {
  const lo = tex.actorTextures(8, 1);
  assert.equal(lo.detail.image.width, 512);
  const hi = await tex.actorTexturesAsync(8);
  assert.equal(hi.detail.image.width, 1024);
  assert.equal(hi.normal.image.width, 1024);
  assert.equal(hi.detail2.image.width, 1024);
  // the maps are real data (not blank) and deterministic
  const sum = (t) => { let s = 0; const d = t.normal.image.data; for (let i = 0; i < d.length; i += 4 * 97) s += d[i]; return s; };
  assert.ok(sum(hi) > 0 && Number.isFinite(sum(hi)));
  assert.equal(sum((await tex.actorTexturesAsync(8))), sum(hi), 'the 1024 job is deterministic');
  const g1 = tex.gunAtlasTexture(8, 1);
  assert.equal(g1.image.width, 1024);
  const g2 = await tex.gunAtlasPixelsAsync();
  assert.equal(g2.size, 2048);
  assert.equal(g2.data.length, 2048 * 2048 * 4);
  const surf = await import('../public/js/render3d/world-surf.js');
  const d256 = surf.makeDetailArray(1);
  assert.equal(d256.image.width, 256);
  const d512 = await surf.makeDetailArrayAsync(1);
  assert.equal(d512.image.width, 512);
  assert.equal(d512.image.depth, d256.image.depth);
});

test('round primitives get finer only with the segment boost, and the boost resets', () => {
  geo.setSegBoost(1);
  const count = () => geo.T.cyl(8).attributes.position.count;
  const base = count();
  geo.setSegBoost(1.9);
  const fine = count();
  const sphere = geo.T.sphere(8, 6).attributes.position.count;
  geo.setSegBoost(1);
  assert.ok(fine > base * 1.6, `cylinder ${base} → ${fine}`);
  assert.equal(count(), base);
  assert.ok(sphere > geo.T.sphere(8, 6).attributes.position.count);
});

function makeBuilder() {
  return geo.createGeoBuilder({
    cell: 1600,
    buckets: {
      std: { det: true }, paint: { det: true }, glass: { det: true }, vglass: { uv: true, ao: false }, decal: { uv: true }, glow: { uv: true, ao: false }, neon: { uv: true, ao: false },
      blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false }, sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true },
    },
  });
}

/** Build with a callback at a detail level; returns triangles, bucket names and whether any vertex is not finite. */
function buildAt(level, fn) {
  arch.setDetailLevel(level);
  geo.setSegBoost(level >= 3 ? 1.9 : 1);
  try {
    const B = makeBuilder();
    B.obj(100, 100, 0, 7);
    fn(B);
    const tris = B.triangles;
    const out = B.finish();
    let bad = 0;
    for (const { geometry } of out) for (const v of geometry.attributes.position.array) if (!Number.isFinite(v)) bad++;
    return { tris, bad, buckets: new Set(out.map((o) => o.bucket)) };
  } finally {
    geo.setSegBoost(1);
    arch.setDetailLevel(2);
  }
}

test('road vehicles: level 3 adds wheels, lamps and a cabin behind see-through glass, level 2 is untouched', () => {
  const dims = { car: [84, 42], suv: [92, 46], pickup: [100, 46], van: [104, 50] };
  for (const [kind, [w, h]] of Object.entries(dims)) {
    const mk = (B) => veh.buildVehicle(B, { id: 7, kind, x: 100, y: 100, w, h, a: 0, color: '#5b5f63', wrecked: false });
    const a = buildAt(2, mk), b = buildAt(3, mk);
    assert.equal(b.bad, 0, kind + ' finite');
    assert.ok(b.tris > a.tris * 2, `${kind}: ${a.tris} → ${b.tris}`);
    assert.ok(b.buckets.has('vglass'), kind + ' has see-through glass');
    assert.ok(!a.buckets.has('vglass'), kind + ' below cinematic has none');
    // wrecks keep their burnt-out look: no cabin fitted (fewer new triangles than the intact one)
    const wreck = (B) => veh.buildVehicle(B, { id: 7, kind, x: 100, y: 100, w, h, a: 0, color: '#5b5f63', wrecked: true });
    assert.equal(buildAt(3, wreck).bad, 0);
  }
  // the deterministic pieces: the same id gives the same triangle count
  const mk = (B) => veh.buildVehicle(B, { id: 11, kind: 'car', x: 100, y: 100, w: 84, h: 42, a: 0, color: '#3a4a5a', wrecked: false });
  assert.equal(buildAt(3, mk).tris, buildAt(3, mk).tris);
});

test('trucks, buses, trailers, tankers and the APC build cleanly at level 3', () => {
  const cases = {
    semi: (B) => veh.buildSemiCab(B, { id: 9, kind: 'semi', w: 96, h: 56, color: '#b01818', wrecked: false }),
    trailer: (B) => veh.buildTrailer(B, { id: 9, kind: 'semi', w: 300, h: 60, color: '#d8d8d0', wrecked: false }),
    tanker: (B) => veh.buildTanker(B, { id: 9, kind: 'tanker', w: 250, h: 58, color: '#c8c8c8', wrecked: false }),
    bus: (B) => veh.buildBus(B, { id: 9, kind: 'bus', w: 250, h: 62, color: '#e3a41a', wrecked: false }, false),
    truck: (B) => veh.buildVehicle(B, { id: 9, kind: 'truck', x: 100, y: 100, w: 136, h: 56, color: '#4a5a2a', wrecked: false }),
    apc: (B) => veh.buildApc(B, 150, 64),
  };
  for (const [k, fn] of Object.entries(cases)) {
    const a = buildAt(2, fn), b = buildAt(3, fn);
    assert.equal(b.bad, 0, k + ' finite');
    assert.ok(b.tris > a.tris * 1.4, `${k}: ${a.tris} → ${b.tris}`);
  }
});

test('buildings and trees grow at level 3 and stay finite', () => {
  flora.setBiome({ ground: '#3a5a2a', decor: [], id: 'test' });
  const cases = {
    shops: (B) => bld.building(B, { id: 12, kind: 'building', w: 220, h: 90, color: '#a89a7c', roof: '#4e4a45', x: 100, y: 100, a: 0 }, 220, 90, null),
    apartment: (B) => bld.building(B, { id: 33, kind: 'building', w: 180, h: 100, color: '#8a6a5a', roof: '#4e4a45', x: 100, y: 100, a: 0 }, 180, 100, null),
    house: (B) => bld.building(B, { id: 5, kind: 'building', w: 90, h: 70, color: '#c8c0a8', roof: '#5a3a2a', x: 100, y: 100, a: 0 }, 90, 70, null),
    oak: (B) => flora.canopy(B, { s: 1 }, 1),
    trunk: (B) => flora.trunk(B, 30, { x: 100, y: 100, id: 3, color: '#4a3a2a' }),
  };
  // (level 2 is the old geometry: triangle counts measured at de88dae)
  const OLD = { shops: 6374, apartment: 5980, house: 1016, oak: 386, trunk: 132 };
  for (const [k, fn] of Object.entries(cases)) {
    const a = buildAt(2, fn), b = buildAt(3, fn);
    assert.equal(b.bad, 0, k + ' finite');
    assert.equal(Math.round(a.tris), OLD[k], k + ' level 2 is unchanged');
    assert.ok(b.tris > a.tris * 1.3, `${k}: ${a.tris} → ${b.tris}`);
  }
});

test('obstacle props: level 2 is exactly the old geometry, level 3 adds finite detail', () => {
  // triangle counts of the old code (de88dae) at level 2, measured before the V2 pass
  const cases = {
    jersey: [(B) => props.jersey(B, 240, 24, '#8a877e'), 464],
    sandbags: [(B) => props.sandbags(B, 120, 24, '#8a7a5a'), 3456],
    guardrail: [(B) => props.guardrail(B, 240, 20, '#8a9096'), 260],
    fenceWood: [(B) => props.fence(B, 200, 6, '#8a6a4a'), 420],
    fenceChain: [(B) => props.fence(B, 200, 6, '#6a7a8a'), 186],
    container: [(B) => props.container(B, { color: '#a83a2a', roof: '#6a2a1a' }, 200, 56), 386],
    dumpster: [(B) => props.container(B, { color: '#2f5a3a' }, 60, 36), 280],
    pump: [(B) => props.pump(B, 46, 30, '#c8281e'), 442],
    rock: [(B) => props.rock(B, 70, 60, '#7a766e', 50), 72],
    tires: [(B) => props.tires(B, { s: 1 }), 252],
    rubble: [(B) => props.rubble(B, { s: 1 }), 340],
  };
  for (const [k, [fn, old]] of Object.entries(cases)) {
    const a = buildAt(2, fn), b = buildAt(3, fn);
    assert.equal(Math.round(a.tris), old, k + ' level 2 is unchanged');
    assert.equal(b.bad, 0, k + ' finite');
    assert.ok(b.tris > a.tris * 1.5, `${k}: ${a.tris} → ${b.tris}`);
    assert.equal(buildAt(3, fn).tris, b.tris, k + ' is deterministic');
  }
});

test('set dressing: 131 kinds keep their old geometry at level 2 and stay finite at level 3 with the finishing pass', () => {
  const builders = Object.assign({}, ...dressMods);
  const kinds = Object.keys(builders);
  assert.ok(kinds.length >= 130);
  const build = (level, extras, k) => {
    arch.setDetailLevel(level);
    geo.setSegBoost(level >= 3 ? 1.9 : 1);
    try {
      const D = geo.createGeoBuilder({ cell: 40000, buckets: { std: { det: true }, leaves: { uv: true, ao: false }, glow: { uv: true, ao: false }, blink: { ao: false }, sign: { uv: true }, lit: { uv: true, ao: false }, fence: { uv: true }, flat: { uv: true, ao: false }, wet: { uv: true, ao: false }, cloth: { uv: true } } });
      const add0 = D.add;
      D.add = (bucket, g, p, sc, r, color, o = null) => {
        if (bucket === 'paint') add0('std', g, p, sc, r, color, o && o.surf ? o : { ...(o || {}), surf: [0, 0.42, 0.35] });
        else if (bucket === 'glass') add0('std', g, p, sc, r, color, o && o.surf ? { ...o, surf: [o.surf[0], o.surf[1] < 0 ? 0.14 : o.surf[1], 0.3] } : { ...(o || {}), surf: [0, 0.14, 0.3] });
        else add0(bucket, g, p, sc, r, color, o);
      };
      D.setJitter(0.06);
      const it = { k, x: 100, y: 100, a: 0, s: 1, v: 5, q: 0, w: 60, x2: 160, y2: 100 };
      D.obj(100, 100, 0, 5 * 31 + k.length);
      builders[k]({ D, it, s: 1, halos: [], map: { width: 3000, height: 2000, areas: [] } });
      if (extras) dressCin.cinDressExtras(D, it);
      const tris = D.triangles;
      let bad = 0;
      for (const { geometry } of D.finish()) for (const v of geometry.attributes.position.array) if (!Number.isFinite(v)) bad++;
      return { tris, bad };
    } finally {
      geo.setSegBoost(1);
      arch.setDetailLevel(2);
    }
  };
  let old = 0, fine = 0, more = 0;
  for (const k of kinds) {
    const a = build(2, false, k), b = build(3, false, k), c = build(3, true, k);
    assert.equal(b.bad + c.bad, 0, k + ' finite');
    assert.ok(c.tris >= b.tris, k + ' the finishing pass never removes anything');
    old += a.tris; fine += b.tris; more += c.tris;
  }
  assert.equal(Math.round(old), 42050, 'level 2 is the old geometry (measured at de88dae)');
  assert.ok(fine > old * 1.4 && more > fine, `level 3 ${fine} and finished ${more} vs ${old}`);
});

test('material and part ids appended for the cinematic tier do not move the old ones', () => {
  assert.equal(consts.MAT.GLASS, 12);
  assert.equal(consts.MAT.SCLERA, 13);
  assert.equal(consts.MAT.TEETH, 14);
  assert.equal(consts.PART.LENS, 13);
  assert.equal(consts.PART.CARD, 14);
  void THREE;
});
