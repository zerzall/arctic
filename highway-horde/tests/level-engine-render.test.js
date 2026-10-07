// Story levels in the renderers (JOURNEY.md §4.1, §4.4), headless: every gate kind's model and
// its animation (gates3d.js), every roof kind (roofs3d.js), the indoor light mask (indoor.js)
// and the shader patch that reads it, the lights of a section going out (lights.js), and the
// top-down renderer drawing gates, roofs and dark sections.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMap, buildPlaceholderLevel } from '../public/js/shared/maps.js';
import { LEVEL_IDS, LEVEL_SPECS } from '../public/js/shared/levels/index.js';
import { GATE_KINDS, ROOF_KINDS } from '../public/js/shared/levels/kit.js';
import { levelGates } from '../public/js/shared/level.js';

// three.js from the vendored copy (the renderer modules import it by its bare name)
const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

let THREE, geoMod, gatesMod, roofsMod, indoorMod;

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
  geoMod = await import('../public/js/render3d/world-geo.js');
  gatesMod = await import('../public/js/render3d/gates3d.js');
  roofsMod = await import('../public/js/render3d/roofs3d.js');
  indoorMod = await import('../public/js/render3d/indoor.js');
});

const BUCKETS = {
  std: { det: true }, paint: { det: true }, glass: { det: true }, vglass: { uv: true, ao: false }, decal: { uv: true }, glow: { uv: true, ao: false },
  neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false },
  sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true },
};

function harness(map, extra = {}) {
  const warnings = [];
  const newBuilder = () => geoMod.createGeoBuilder({ cell: 1600, buckets: BUCKETS });
  const root = new THREE.Group();
  const mats = new Map();
  const matOf = (b) => {
    if (!mats.has(b)) mats.set(b, b === 'glow' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial());
    return mats.get(b);
  };
  const shakes = [];
  const ctx = {
    map, THREE, quality: 'high', camera: new THREE.PerspectiveCamera(), shake: (k) => shakes.push(k),
    lights: { flash() {}, steady: (...a) => (extra.steady || []).push(a) }, level: extra.level || null,
    scene: new THREE.Scene(), rng: Math.random,
  };
  return { ctx, deps: { root, newBuilder, matOf, tier: 'high', gy: () => 0, roofs: extra.roofs || null, day: false, halos: [], level: extra.level || null }, root, warnings, shakes };
}

function quiet(fn) {
  const warns = [];
  const w = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  try {
    return { out: fn(), warns };
  } finally {
    console.warn = w;
  }
}

/** A level map whose gates are one of every kind (Mill Road's pieces, re-kinded; a vehicle-sized one). */
function everyKindMap() {
  const m = JSON.parse(JSON.stringify(buildMap('metro', 4)));
  const kinds = [...GATE_KINDS];
  m.gates.forEach((g, i) => {
    g.kind = kinds[i % kinds.length];
    for (const id of g.obstacles) m.obstacles[id].gateKind = g.kind;
  });
  // two more gates so all eight kinds are there: a wide one (double doors) and a vehicle
  for (const [kind, w, h] of [['door', 40, 180], ['vehicle', 240, 80], ['bars', 40, 120]]) {
    const o = { id: m.obstacles.length, kind: 'wall', x: 600 + m.gates.length * 300, y: 500, w, h, a: 0.3, color: '#5d6166', solid: true, wrecked: false, roof: null, top: 140, gate: 'extra' + m.gates.length, gateKind: kind };
    m.obstacles.push(o);
    m.gates.push({ id: o.gate, kind, obstacles: [o.id], label: '' });
  }
  return m;
}

test('gates3d: a model for every kind, animated from shut to open without a NaN', () => {
  const map = everyKindMap();
  const kinds = new Set(map.gates.map((g) => g.kind));
  assert.equal(kinds.size, GATE_KINDS.length, 'the test map has every kind');
  const h = harness(map);
  const { out: gates, warns } = quiet(() => gatesMod.createGates(h.ctx, h.deps));
  assert.deepEqual(warns, []);
  assert.ok(gates.stats.pieces >= map.gates.length);
  const pos = new THREE.Vector3();
  const poses = [];
  // the snapshot opens every gate at tick 100; frames from tick 100 on
  const view = { tick: 100, level: { gates: map.gates.map(() => ({ open: true, t: 100 })) } };
  for (let f = 0; f <= 90; f++) {
    gates.update(view, { dt: 1 / 60, now: f / 60 });
    if (f % 15 === 0) {
      const snap = [];
      h.root.updateMatrixWorld(true);
      h.root.traverse((o) => {
        if (!o.isMesh) return;
        o.getWorldPosition(pos);
        assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), 'finite pose');
        snap.push(pos.x + pos.y + pos.z + o.rotation.x + o.rotation.y + o.parent.rotation.x + o.parent.rotation.y + o.parent.scale.y);
      });
      poses.push(snap.join(','));
    }
  }
  for (let i = 0; i < map.gates.length; i++) assert.equal(gates.progress(i), 1, `gate ${map.gates[i].kind} open after 1.5 s`);
  assert.notEqual(poses[0], poses[poses.length - 1], 'the gates moved');
  // shut again later: back to 0
  const view2 = { tick: 400, level: { gates: map.gates.map(() => ({ open: false, t: 400 })) } };
  for (let f = 0; f < 90; f++) gates.update(view2, { dt: 1 / 60, now: 2 + f / 60 });
  for (let i = 0; i < map.gates.length; i++) assert.equal(gates.progress(i), 0);
  // a late joiner: a gate opened long ago is simply open
  const h2 = harness(map);
  const late = gatesMod.createGates(h2.ctx, h2.deps);
  late.update({ tick: 90000, level: { gates: map.gates.map(() => ({ open: true, t: 60 })) } }, { dt: 1 / 60, now: 0 });
  for (let i = 0; i < map.gates.length; i++) assert.equal(late.progress(i), 1);
  gates.dispose();
  late.dispose();
});

test('gates3d: every level builds its gates; a level art model is animated as a whole', () => {
  for (const id of LEVEL_IDS) {
    const map = buildMap(id, 2);
    const h = harness(map);
    const { out: g, warns } = quiet(() => gatesMod.createGates(h.ctx, h.deps));
    assert.deepEqual(warns, [], id);
    assert.equal(g.stats.gates, levelGates(map).length, id);
    g.dispose();
  }
  const map = buildPlaceholderLevel(LEVEL_SPECS.millroad, 2);
  const seen = [];
  const art = { gateModel(B, gate, o) { seen.push(gate.id); B.block('std', 0, 0, 0, o.w, 100, o.h, '#ff0000'); return true; } };
  const h = harness(map, { level: art });
  const g = gatesMod.createGates(h.ctx, h.deps);
  assert.deepEqual(seen, map.gates.map((q) => q.id));
  g.update({ tick: 10, level: { gates: map.gates.map(() => ({ open: true, t: 10 })) } }, { dt: 1 / 60, now: 0 });
  for (let f = 0; f < 80; f++) g.update({ tick: 10, level: { gates: map.gates.map(() => ({ open: true, t: 10 })) } }, { dt: 1 / 60, now: f / 60 });
  assert.equal(g.progress(0), 1);
  g.dispose();
});

/** A placeholder level with one roof of every kind over walled rooms. */
function roomsMap() {
  const m = JSON.parse(JSON.stringify(buildPlaceholderLevel(LEVEL_SPECS.millroad, 3)));
  let x = 400;
  for (const kind of ROOF_KINDS) {
    const w = kind === 'mall' ? 700 : 360, d = 300, cx = x + w / 2, cy = 420;
    const wall = (wx, wy, ww, wh) => m.obstacles.push({ id: m.obstacles.length, kind: 'wall', x: wx, y: wy, w: ww, h: wh, a: 0, color: '#8a877e', solid: true, wrecked: false, roof: null });
    wall(cx, cy - d / 2, w, 14);
    wall(cx - w / 2, cy, 14, d);
    wall(cx + w / 2, cy, 14, d);
    // the south wall with a doorway in the middle
    wall(cx - w / 4 - 25, cy + d / 2, w / 2 - 50, 14);
    wall(cx + w / 4 + 25, cy + d / 2, w / 2 - 50, 14);
    m.roofs.push({ x: cx, y: cy, w: w + 14, h: d + 14, a: 0, height: kind === 'mall' ? 260 : 150, kind, section: 'jam', dark: 0.8 });
    x += w + 120;
  }
  return m;
}

test('roofs3d: every kind builds a ceiling, a roof and fixtures; walls under it reach the ceiling', () => {
  const map = roomsMap();
  const steady = [];
  const h = harness(map, { steady });
  const { out: roofs, warns } = quiet(() => roofsMod.createRoofs(h.ctx, h.deps));
  assert.deepEqual(warns, []);
  const B = h.deps.newBuilder();
  const t0 = B.triangles;
  roofs.build(B);
  const tRoof = B.triangles - t0;
  for (const o of map.obstacles) {
    B.obj(o.x, o.y, o.a || 0, o.id);
    roofs.wallTop(B, o);
  }
  assert.ok(tRoof > 2000, `roof models: ${tRoof} triangles`);
  assert.ok(B.triangles - t0 - tRoof > 20, 'the walls under the roofs were topped up');
  roofs.finish();
  const fixtures = h.root.children.filter((c) => c.name === 'roof-fixtures');
  assert.ok(fixtures.length >= 1, 'fixture glow meshes');
  // a roof without map lights of its own gets fixture lights near the camera
  const keys = new Set();
  for (const r of map.roofs) {
    steady.length = 0;
    roofs.update(null, { camX: r.x, camY: r.y, dt: 1 / 60 });
    for (const a of steady) keys.add(a[0].split(':')[1]);
  }
  assert.equal(keys.size, ROOF_KINDS.length, `fixture lights of every roof: ${[...keys]}`);
  // a power cut in the section: no fixture lights, the glow dims
  steady.length = 0;
  roofs.setDark(1 << 0);
  roofs.update(null, { camX: map.roofs[0].x, camY: map.roofs[0].y, dt: 1 / 60 });
  assert.equal(steady.length, 0);
  assert.ok(fixtures[0].material.color.r < 0.1);
  assert.equal(roofs.ceilingAt(map.roofs[0].x, map.roofs[0].y), 150);
  assert.equal(roofs.ceilingAt(-100, -100), 0);
  const shelters = roofs.nearest(map.roofs[1].x, map.roofs[1].y, 4);
  assert.equal(shelters.length, 4);
  assert.equal(shelters[0].x, map.roofs[1].x, 'the camera\'s own roof first');
  roofs.dispose();
});

test('indoor mask: dark under a roof, lighter at the doorway, sky outside and above; gates and power cuts change it', () => {
  const map = roomsMap();
  const heightOf = (kind, o) => (kind === 'wall' ? (o.h <= 8 ? 40 : 90) : 60);
  const ind = indoorMod.createIndoor(map, { heightOf, sectionOf: () => 0, gateObstacles: new Set(), sunK: 0.35 });
  assert.ok(ind);
  const r = map.roofs[0];
  const deep = ind.at(r.x, r.y - r.h * 0.3);
  const door = ind.at(r.x, r.y + r.h / 2 - 12);
  assert.ok(deep > 0.7, `deep inside: ${deep}`);
  assert.ok(door < deep - 0.15, `the doorway lets the sky in (${door} vs ${deep})`);
  assert.equal(ind.at(r.x, r.y + r.h / 2 + 200), 0, 'outside');
  assert.equal(ind.at(r.x, r.y, r.height + 40), 0, 'above the ceiling');
  // the page-global uniforms point at it
  assert.equal(indoorMod.INDOOR_UNIFORMS.uIndoorMap.value, ind.texture);
  assert.equal(indoorMod.INDOOR_UNIFORMS.uIndoorSun.value, 0.35);
  // a power cut in the section: darker
  ind.setDark(1);
  assert.ok(ind.at(r.x, r.y - r.h * 0.3) > deep);
  ind.setDark(0);
  // a gate piece in the doorway: shut, it stops the light; open, it lets it in
  const gap = { id: 9999, kind: 'wall', x: r.x, y: r.y + r.h / 2 - 7, w: 100, h: 14, a: 0, gate: 'g' };
  const map2 = { ...map, obstacles: map.obstacles.concat([{ ...gap, id: map.obstacles.length }]) };
  const ind2 = indoorMod.createIndoor(map2, { heightOf, sectionOf: () => 0, gateObstacles: new Set([map.obstacles.length]) });
  const shut = ind2.at(r.x, r.y + r.h / 2 - 30);
  ind2.setGateOpen([map2.obstacles[map.obstacles.length]], true);
  const opened = ind2.at(r.x, r.y + r.h / 2 - 30);
  assert.ok(opened < shut - 0.1, `open gate: more light (${opened} vs ${shut})`);
  ind2.dispose();
  ind.dispose();
  assert.notEqual(indoorMod.INDOOR_UNIFORMS.uIndoorMap.value, ind.texture, 'disposed: back to the empty mask');
  // no roofs: no mask
  assert.equal(indoorMod.createIndoor(buildPlaceholderLevel(LEVEL_SPECS.millroad, 3), {}), null);
});

test('indoor mask: the shader patch (chunks inert without the define; a patched material defines it)', () => {
  const C = THREE.ShaderChunk;
  assert.ok(C.lights_fragment_begin.includes('HH_INDOOR') && C.lights_fragment_begin.includes('hhSunK'));
  assert.ok(C.lights_fragment_end.includes('irradiance *= 1.0 - hhUnder'));
  assert.ok(C.fog_fragment.includes('HH_INDOOR'));
  assert.equal((C.lights_fragment_begin.match(/directLight\.color \*= hhSunK/g) || []).length, 2, 'the sun and the directional lights');
  const m = new THREE.MeshStandardMaterial();
  const key0 = m.customProgramCacheKey();
  assert.equal(indoorMod.patchIndoor(m), true);
  assert.equal(indoorMod.patchIndoor(m), false, 'once');
  assert.equal(m.customProgramCacheKey(), key0 + '|hhIndoor');
  const sh = { uniforms: {}, vertexShader: '', fragmentShader: '#include <common>\nvoid main() {}' };
  m.onBeforeCompile(sh, null);
  assert.ok(sh.fragmentShader.startsWith('#define HH_INDOOR'));
  assert.ok(sh.fragmentShader.includes('uniform sampler2D uIndoorMap'));
  assert.equal(sh.uniforms.uIndoorMap, indoorMod.INDOOR_UNIFORMS.uIndoorMap);
  // an unlit material is left alone; a patched material keeps its own onBeforeCompile
  assert.equal(indoorMod.patchIndoor(new THREE.MeshBasicMaterial()), false);
  const own = new THREE.MeshLambertMaterial();
  let called = 0;
  own.onBeforeCompile = () => { called++; };
  indoorMod.patchIndoor(own);
  own.onBeforeCompile({ uniforms: {}, fragmentShader: '#include <common>' }, null);
  assert.equal(called, 1);
});
