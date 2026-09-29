// Set dressing (shared/dress.js): deterministic placement on every map, nothing inside an
// obstacle, water, the objective, the supply station or a spawn, quality tiers that thin the
// same list, and every prop kind has a model (render3d/dress-*.js, checked on the source text
// because Node cannot import three.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap, MAP_LIST, FIRE_ENGINE } from '../public/js/shared/maps.js';
import { buildDress, dressForTier, dressDensity, DRESS_DENSITY, DRESS_KINDS } from '../public/js/shared/dress.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARIANTS = [
  ['highway'], ['truckstop'], ['bridge'], ['checkpoint'], ['harlan'],
  ['highway', 'campaign'], ['checkpoint', 'campaign'], ['harlan', 'campaign'],
];
const VEHICLES = new Set(['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanger', 'tanker']);
const cache = new Map();
function dressed(id, mode, seed = 1234) {
  const key = `${id}:${mode}:${seed}`;
  if (!cache.has(key)) {
    const map = buildMap(id, seed, mode ? { mode } : null);
    cache.set(key, { map, items: buildDress(map) });
  }
  return cache.get(key);
}

function inRect(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}

test('dress: deterministic for (map, seed), different for another seed', () => {
  const a = buildMap('truckstop', 77), b = buildMap('truckstop', 77), c = buildMap('truckstop', 78);
  assert.deepEqual(buildDress(a), buildDress(b));
  assert.notDeepEqual(buildDress(a), buildDress(c));
  const d1 = buildMap('harlan', 5, { mode: 'campaign' }), d2 = buildMap('harlan', 5, { mode: 'campaign' });
  assert.deepEqual(buildDress(d1), buildDress(d2));
});

test('dress: every map is richly dressed and every item is well formed', () => {
  const minimum = { highway: 2500, truckstop: 1200, bridge: 900, checkpoint: 1300, harlan: 6000 };
  for (const [id, mode] of VARIANTS) {
    const { map, items } = dressed(id, mode);
    assert.ok(items.length >= minimum[id], `${id}${mode ? ':' + mode : ''} has ${items.length} props`);
    const kinds = new Set();
    for (const it of items) {
      assert.ok(DRESS_KINDS[it.k], `unknown kind ${it.k}`);
      assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y) && Number.isFinite(it.a) && it.s > 0, 'finite pose');
      assert.ok(it.q >= 0 && it.q < 1, 'rank in [0, 1)');
      assert.ok(it.x > 0 && it.y > 0 && it.x < map.width && it.y < map.height, `${it.k} inside the map`);
      kinds.add(it.k);
    }
    // variety: a dozen families of prop on every map
    assert.ok(kinds.size >= 55, `${id}${mode ? ':' + mode : ''} uses ${kinds.size} kinds`);
  }
});

test('dress: nothing inside an obstacle, water, the objective, the supply or a spawn', () => {
  for (const [id, mode] of VARIANTS) {
    const { map, items } = dressed(id, mode);
    const waters = map.areas.filter((a) => a.kind === 'water');
    for (const it of items) {
      const def = DRESS_KINDS[it.k];
      const fl = def[2] || '';
      const at = `${id}${mode ? ':' + mode : ''} ${it.k} at ${it.x},${it.y}`;
      // spawns and objective: never (walls, posters and lines are placed by their anchor, so test the anchor too)
      for (const p of map.playerSpawns) assert.ok(Math.hypot(it.x - p.x, it.y - p.y) > 40, `${at} on a player spawn`);
      if (map.supply) assert.ok(Math.hypot(it.x - map.supply.x, it.y - map.supply.y) > 60, `${at} on the supply station`);
      if (map.objective) assert.ok(!inRect(map.objective, it.x, it.y, 10), `${at} inside the objective`);
      for (const z of map.zombieSpawns) assert.ok(!inRect({ ...z, a: 0 }, it.x, it.y, 10), `${at} in a zombie spawn`);
      if (map.campaign) {
        for (const p of map.campaign.hill.spawns) assert.ok(Math.hypot(it.x - p.x, it.y - p.y) > 40, `${at} on a hill spawn`);
        for (const f of map.campaign.floors) {
          assert.ok(!(it.x > f.x0 && it.x < f.x1 && it.y > f.y0 && it.y < f.y1), `${at} inside the annex floor ${f.id}`);
          for (const s of f.spawns) assert.ok(!inRect({ ...s, a: 0 }, it.x, it.y, 10), `${at} in a floor spawn`);
        }
        const rf = map.campaign.roof;
        assert.ok(!(it.x > rf.x0 && it.x < rf.x1 && it.y > rf.y0 && it.y < rf.y1), `${at} on the roof`);
      }
      // water: nothing but the lily pads (and the shore plants) reaches it
      if (it.k !== 'lily' && it.k !== 'reeds') for (const w of waters) assert.ok(!inRect(w, it.x, it.y, 0), `${at} in the water`);
      // wall-attached pieces (graffiti, posters, boards, perches) hang on their obstacle by design
      if (fl.includes('w') || fl.includes('l')) continue;
      for (const o of map.obstacles) {
        if (fl.includes('f') && VEHICLES.has(o.kind)) continue;   // a skid mark leads under the wreck
        assert.ok(!inRect(o, it.x, it.y, 0), `${at} inside ${o.kind} #${o.id}`);
      }
    }
  }
});

test('dress: nothing tall stands under a viaduct deck', () => {
  const { map, items } = dressed('highway');
  const decks = map.overpass.decks.filter((d) => d.kind === 'viaduct');
  assert.ok(decks.length > 0);
  for (const it of items) {
    if (!(DRESS_KINDS[it.k][2] || '').includes('t')) continue;
    for (const d of decks) {
      for (let i = 0; i + 1 < d.pts.length; i++) {
        const [x1, y1] = d.pts[i], [x2, y2] = d.pts[i + 1];
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((it.x - x1) * dx + (it.y - y1) * dy) / l2));
        assert.ok(Math.hypot(it.x - (x1 + dx * t), it.y - (y1 + dy * t)) >= d.w / 2, `${it.k} under the viaduct at ${it.x},${it.y}`);
      }
    }
  }
});

test('dress: quality tiers show nested subsets (ultra all, high ~60 %, low ~25 %)', () => {
  const { items } = dressed('checkpoint');
  const ultra = dressForTier(items, 'ultra'), high = dressForTier(items, 'high'), low = dressForTier(items, 'low');
  assert.equal(ultra.length, items.length);
  assert.ok(high.length < ultra.length && low.length < high.length);
  const fr = (n) => n / items.length;
  assert.ok(Math.abs(fr(high.length) - DRESS_DENSITY.high) < 0.08, `high ${fr(high.length)}`);
  assert.ok(Math.abs(fr(low.length) - DRESS_DENSITY.low) < 0.08, `low ${fr(low.length)}`);
  const inHigh = new Set(high);
  for (const it of low) assert.ok(inHigh.has(it), 'the low set is inside the high set');
  assert.equal(dressDensity('nope'), DRESS_DENSITY.high);
});

test('dress: the sim never sees it (the MapDef carries no dressing)', () => {
  const map = buildMap('bridge', 1);
  buildDress(map);
  assert.equal(map.dress, undefined);
  assert.equal(map.dressItems, undefined);
});

test('dress: every prop kind has a model in render3d/dress-*.js', () => {
  const dir = path.join(ROOT, 'public/js/render3d');
  const modelled = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!/^dress-.*\.js$/.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const k of Object.keys(DRESS_KINDS)) {
      // a builder is listed in the file's export table (`kind,` / `kind: fn,`) or is a method (`kind(P) {`)
      if (new RegExp(`(^|[\\s{,])${k}\\s*(\\(P\\)|:|,|\\n)`, 'm').test(src.slice(src.lastIndexOf('\nexport const '))) || new RegExp(`(^|\\s)${k}\\(P\\) \\{`, 'm').test(src)) modelled.add(k);
    }
  }
  const NOT_MODELS = new Set(['perch']);   // crow perches (dress-life.js), not meshes
  const missing = Object.keys(DRESS_KINDS).filter((k) => !modelled.has(k) && !NOT_MODELS.has(k));
  assert.deepEqual(missing, [], 'kinds without a builder: ' + missing.join(', '));
  // and the atlas cells (or cell families) the builders name exist
  const atlas = fs.readFileSync(path.join(dir, 'dress-atlas.js'), 'utf8');
  for (const n of ['stop', 'p_god', 'w_god', 'miss', 'news', 'bb', 'ad', 'vend', 'v_police', 'v_amb', 'f_skid', 'f_puddle', 'quar', 'redcross', 'checker']) {
    assert.ok(atlas.includes(`'${n}'`), 'atlas cell ' + n);
  }
});

test('dress: every map in the lobby is covered by the variants above', () => {
  const ids = new Set(VARIANTS.map((v) => v[0]));
  for (const m of MAP_LIST) assert.ok(ids.has(m.id), m.id);
});

test('dress: a red truck is the fire engine of the 3D view (and only a paint job for the sim)', () => {
  for (const id of ['highway', 'checkpoint', 'harlan']) {
    const map = buildMap(id, 1234);
    const engines = map.obstacles.filter((o) => o.kind === 'truck' && o.color === FIRE_ENGINE);
    assert.ok(engines.length >= 1, id + ' has a fire engine');
    for (const e of engines) assert.equal(e.solid, true);
  }
});
