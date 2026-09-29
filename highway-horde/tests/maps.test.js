// Map contract tests (SPEC §2): schema, bounds, determinism, spawn safety and
// reachability of every player spawn, the supply station and the objective from every
// zombie spawn, measured on a NAV_CELL occupancy grid like the one the sim navigates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAP_LIST, buildMap, OVERPASS } from '../public/js/shared/maps.js';
import { NAV_CELL } from '../public/js/shared/constants.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import { pickSpawnRect } from '../public/js/shared/sim/zombies.js';
import { createRng } from '../public/js/shared/rng.js';

const MAP_IDS = ['highway', 'truckstop', 'bridge', 'checkpoint', 'harlan'];
/** Maps built for the Evac Run only (SPEC §3.7): big, no central objective to defend. */
const ZONE_ONLY = new Set(['harlan']);
const SEEDS = [1, 42, 9001];
const WALKER_RADIUS = 14;

const AREA_KINDS = ['asphalt', 'concrete', 'grass', 'dirt', 'gravel', 'sand', 'water'];
const LINE_KINDS = ['white', 'white_dashed', 'yellow', 'yellow_double', 'crosswalk', 'parking', 'stop'];
const OBSTACLE_KINDS = ['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker', 'barrier',
  'sandbags', 'building', 'wall', 'container', 'pump', 'tree', 'rock', 'hesco', 'tent', 'booth',
  'guardrail', 'pillar', 'pier', 'ramp', 'silo', 'grave'];
const DECOR_KINDS = ['tree_canopy', 'bush', 'grass_tuft', 'rock', 'cone', 'debris', 'tire', 'crack',
  'oil', 'blood_old', 'paper', 'skid', 'manhole', 'lamp_post', 'sign', 'flag', 'rubble', 'signal', 'pylon'];
const OBJECTIVE_KINDS = ['bus', 'diner', 'apc', 'radio'];
const LOW_COVER = ['guardrail', 'barrier', 'sandbags', 'grave'];
/** Obstacle budget per map (the long highway map holds more wrecks and rails, Harlan County its woods). */
const MAX_OBSTACLES = { highway: 300, harlan: 900 };
/** Headroom under a deck a player walks beneath (eye 52, plus a jump, plus margin). */
const DECK_CLEARANCE = 150;
const HEX = /^#[0-9a-f]{6}$/i;

// ---- geometry helpers (oriented rectangles, centre + full size + angle)

function pointInRect(px, py, r, pad = 0) {
  const dx = px - r.x, dy = py - r.y;
  const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
  return Math.abs(dx * c + dy * s) <= r.w / 2 + pad && Math.abs(-dx * s + dy * c) <= r.h / 2 + pad;
}

function corners(r) {
  const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
  const out = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * r.w / 2, ly = sy * r.h / 2;
    out.push([r.x + lx * c - ly * s, r.y + lx * s + ly * c]);
  }
  return out;
}

function rectsOverlap(A, B) {
  const axes = [];
  for (const r of [A, B]) {
    const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
    axes.push([c, s], [-s, c]);
  }
  const ca = corners(A), cb = corners(B);
  for (const [ux, uy] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, y] of ca) { const p = x * ux + y * uy; amin = Math.min(amin, p); amax = Math.max(amax, p); }
    for (const [x, y] of cb) { const p = x * ux + y * uy; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

// ---- navigation grid: a cell is blocked when its centre lies inside an obstacle, the
// objective or water grown by `pad` (the walker radius), or too close to the world edge.

function buildGrid(map, pad) {
  const cols = Math.ceil(map.width / NAV_CELL), rows = Math.ceil(map.height / NAV_CELL);
  const blocked = new Uint8Array(cols * rows);   // 0 free, 1 obstacle/water/bounds, 2 objective
  const water = map.areas.filter((a) => a.kind === 'water');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * NAV_CELL, y = (r + 0.5) * NAV_CELL;
      const i = r * cols + c;
      if (x < pad || y < pad || x > map.width - pad || y > map.height - pad) { blocked[i] = 1; continue; }
      if (pointInRect(x, y, map.objective, pad)) { blocked[i] = 2; continue; }
      if (water.some((w) => pointInRect(x, y, w, pad))) { blocked[i] = 1; continue; }
      if (map.obstacles.some((o) => pointInRect(x, y, o, pad))) blocked[i] = 1;
    }
  }
  return { cols, rows, blocked };
}

// Connected components over free cells (8-neighbour, no corner cutting).
function labelComponents(grid) {
  const { cols, rows, blocked } = grid;
  const label = new Int32Array(cols * rows).fill(-1);
  let next = 0;
  const stack = [];
  for (let start = 0; start < label.length; start++) {
    if (blocked[start] || label[start] >= 0) continue;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const c = i % cols, r = (i - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const j = nr * cols + nc;
          if (blocked[j] || label[j] >= 0) continue;
          if (dr && dc && (blocked[r * cols + nc] || blocked[nr * cols + c])) continue;
          label[j] = next;
          stack.push(j);
        }
      }
    }
    next++;
  }
  return label;
}

function cellOf(grid, x, y) {
  return Math.floor(y / NAV_CELL) * grid.cols + Math.floor(x / NAV_CELL);
}

// Free cells touching the objective's footprint: where zombies stand to hit it.
function objectiveRing(grid) {
  const { cols, rows, blocked } = grid;
  const ring = [];
  for (let i = 0; i < blocked.length; i++) {
    if (blocked[i]) continue;
    const c = i % cols, r = (i - c) / cols;
    let touches = false;
    for (let dr = -1; dr <= 1 && !touches; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && blocked[nr * cols + nc] === 2) { touches = true; break; }
      }
    }
    if (touches) ring.push(i);
  }
  return ring;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Ground-level ends of the overpass ramps. */
function rampToes(m) {
  if (!m.overpass) return [];
  return m.overpass.decks.filter((d) => d.kind === 'ramp').map((d) => {
    const p = d.pts.reduce((a, b) => (b[2] < a[2] ? b : a));
    return { x: p[0], y: p[1] };
  });
}

/** Deck top height over (x, y), 0 off the decks (mirrors render3d's deckHeightAt). */
function deckAt(m, x, y, pad = 0) {
  let best = 0;
  for (const d of (m.overpass && m.overpass.decks) || []) {
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [x0, y0, z0] = d.pts[i], [x1, y1, z1] = d.pts[i + 1];
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
      const t = ((x - x0) * dx + (y - y0) * dy) / L2;
      if (t < 0 || t > 1) continue;
      const px = x0 + dx * t, py = y0 + dy * t;
      if (Math.hypot(x - px, y - py) > d.w / 2 + pad) continue;
      best = Math.max(best, z0 + (z1 - z0) * t);
    }
  }
  return best;
}

const cache = new Map();
function getMap(id, seed) {
  const key = `${id}:${seed}`;
  if (!cache.has(key)) cache.set(key, buildMap(id, seed));
  return cache.get(key);
}

// ---------------------------------------------------------------------------------

test('MAP_LIST lists the five maps in lobby order', () => {
  assert.deepEqual(MAP_LIST.map((m) => m.id), MAP_IDS);
  for (const m of MAP_LIST) {
    assert.equal(typeof m.name, 'string');
    assert.ok(m.name.length > 0);
    assert.equal(typeof m.description, 'string');
    assert.ok(m.description.length > 10);
  }
  assert.deepEqual(MAP_LIST.map((m) => m.name),
    ['Highway 9 Pileup', 'Last Chance Truck Stop', 'Blackwater Bridge', 'Checkpoint Delta', 'Harlan County']);
});

test('buildMap throws on an unknown id', () => {
  assert.throws(() => buildMap('nowhere', 1));
  assert.throws(() => buildMap('toString', 1));
  assert.throws(() => buildMap(undefined, 1));
});

test('objectives match the spec', () => {
  const expected = {
    highway: ['bus', 'School Bus'],
    truckstop: ['diner', 'The Diner'],
    bridge: ['apc', 'Army APC'],
    checkpoint: ['radio', 'Radio Tower'],
    harlan: ['radio', 'Radio Tower'],
  };
  for (const id of MAP_IDS) {
    const m = getMap(id, 1);
    assert.deepEqual([m.objective.kind, m.objective.name], expected[id]);
  }
});

for (const id of MAP_IDS) {
  for (const seed of SEEDS) {
    const label = `${id} seed ${seed}`;

    test(`${label}: schema`, () => {
      const m = getMap(id, seed);
      assert.equal(m.id, id);
      assert.equal(m.name, MAP_LIST.find((e) => e.id === id).name);
      assert.equal(m.seed, seed);
      assert.ok(Number.isFinite(m.width) && m.width >= 2400 && m.width <= 8000, 'width');
      assert.ok(Number.isFinite(m.height) && m.height >= 1600 && m.height <= (ZONE_ONLY.has(id) ? 8000 : 3000), 'height');
      assert.equal(typeof m.ambient, 'object');
      assert.ok(m.ambient.darkness >= 0.55 && m.ambient.darkness <= 0.75, 'darkness');
      assert.match(m.ambient.tint, HEX);
      assert.match(m.ground, HEX);

      for (const a of m.areas) {
        assert.ok(AREA_KINDS.includes(a.kind), `area kind ${a.kind}`);
        for (const k of ['x', 'y', 'w', 'h', 'a']) assert.ok(Number.isFinite(a[k]), `area.${k}`);
        assert.ok(a.w > 0 && a.h > 0);
      }
      for (const l of m.lines) {
        assert.ok(LINE_KINDS.includes(l.kind), `line kind ${l.kind}`);
        for (const k of ['x1', 'y1', 'x2', 'y2', 'w']) assert.ok(Number.isFinite(l[k]), `line.${k}`);
        assert.ok(l.w > 0);
        assert.ok(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0, 'zero-length line');
      }
      m.obstacles.forEach((o, i) => {
        assert.equal(o.id, i, 'obstacle id = index');
        assert.ok(OBSTACLE_KINDS.includes(o.kind), `obstacle kind ${o.kind}`);
        for (const k of ['x', 'y', 'w', 'h', 'a']) assert.ok(Number.isFinite(o[k]), `obstacle.${k}`);
        assert.ok(o.w > 0 && o.h > 0);
        assert.match(o.color, HEX);
        assert.equal(typeof o.solid, 'boolean');
        assert.equal(typeof o.wrecked, 'boolean');
        assert.ok(o.roof === null || HEX.test(o.roof), 'roof');
        if (LOW_COVER.includes(o.kind)) assert.equal(o.solid, false, `${o.kind} must be low cover`);
        if (o.kind === 'hesco') assert.equal(o.solid, true);
      });
      for (const d of m.decor) {
        assert.ok(DECOR_KINDS.includes(d.kind), `decor kind ${d.kind}`);
        for (const k of ['x', 'y', 'a', 's']) assert.ok(Number.isFinite(d[k]), `decor.${k}`);
        assert.ok(d.s > 0);
      }
      for (const l of m.lights) {
        for (const k of ['x', 'y', 'r']) assert.ok(Number.isFinite(l[k]), `light.${k}`);
        assert.ok(l.r > 0);
        assert.match(l.color, HEX);
        assert.ok(typeof l.flicker === 'number' && l.flicker >= 0 && l.flicker <= 1, 'flicker 0..1');
      }
      for (const f of m.fires) {
        for (const k of ['x', 'y', 'r']) assert.ok(Number.isFinite(f[k]), `fire.${k}`);
        assert.ok(f.r > 0);
      }
      assert.ok(m.playerSpawns.length >= 6, '>= 6 player spawns');
      for (const p of m.playerSpawns) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(m.zombieSpawns.length >= 4);
      for (const z of m.zombieSpawns) {
        for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(z[k]), `zombieSpawn.${k}`);
        assert.ok(z.w > 0 && z.h > 0);
      }
      const ob = m.objective;
      assert.ok(OBJECTIVE_KINDS.includes(ob.kind));
      assert.equal(typeof ob.name, 'string');
      for (const k of ['x', 'y', 'w', 'h', 'a', 'hp']) assert.ok(Number.isFinite(ob[k]), `objective.${k}`);
      assert.ok(ob.hp > 0 && ob.w > 0 && ob.h > 0);
      assert.ok(Number.isFinite(m.supply.x) && Number.isFinite(m.supply.y));
      assert.ok(m.lights.length >= 8, 'lit enough to see');
      assert.ok(m.fires.length >= 2, 'some fires');
      assert.ok(m.decor.length >= 300, 'lived-in ground');
    });

    test(`${label}: obstacle budget and world bounds`, () => {
      const m = getMap(id, seed);
      assert.ok(m.obstacles.length >= 60 && m.obstacles.length <= (MAX_OBSTACLES[id] || 160), `obstacles: ${m.obstacles.length}`);
      const inside = (x, y, tol = 0.5) => x >= -tol && y >= -tol && x <= m.width + tol && y <= m.height + tol;
      for (const o of m.obstacles) {
        for (const [x, y] of corners(o)) assert.ok(inside(x, y), `obstacle ${o.id} (${o.kind}) out of bounds`);
      }
      for (const a of m.areas) {
        for (const [x, y] of corners(a)) assert.ok(inside(x, y, 1), `area ${a.kind} at ${a.x},${a.y} out of bounds`);
      }
      for (const [x, y] of corners(m.objective)) assert.ok(inside(x, y));
      for (const l of m.lines) assert.ok(inside(l.x1, l.y1) && inside(l.x2, l.y2), 'line out of bounds');
      for (const d of m.decor) assert.ok(inside(d.x, d.y), `decor ${d.kind} out of bounds`);
      for (const l of m.lights) assert.ok(inside(l.x, l.y), 'light out of bounds');
      for (const f of m.fires) assert.ok(inside(f.x, f.y), 'fire out of bounds');
      for (const p of m.playerSpawns) assert.ok(inside(p.x, p.y, -40), 'player spawn too close to the edge');
      assert.ok(inside(m.supply.x, m.supply.y, -60));
      for (const z of m.zombieSpawns) {
        assert.ok(inside(z.x - z.w / 2, z.y - z.h / 2) && inside(z.x + z.w / 2, z.y + z.h / 2), 'zombie spawn out of bounds');
      }
    });

    test(`${label}: layout rules (objective central, supply distance, spawns near edges)`, { skip: ZONE_ONLY.has(id) && 'an Evac Run map: its own layout test below' }, () => {
      const m = getMap(id, seed);
      const ob = m.objective;
      assert.ok(Math.abs(ob.x - m.width / 2) < m.width * 0.2, 'objective roughly central (x)');
      assert.ok(Math.abs(ob.y - m.height / 2) < m.height * 0.2, 'objective roughly central (y)');
      const sd = dist(m.supply, ob);
      assert.ok(sd >= 250 && sd <= 450, `supply ${sd.toFixed(0)} px from objective`);
      for (const p of m.playerSpawns) assert.ok(dist(p, ob) < 400, 'player spawns near the objective');
      const toes = rampToes(m);
      for (const z of m.zombieSpawns) {
        const edge = Math.min(z.x, z.y, m.width - z.x, m.height - z.y);
        const foot = toes.some((t) => Math.hypot(t.x - z.x, t.y - z.y) <= 160);
        assert.ok(edge <= 250 || foot, 'zombie spawn hugs an edge (or the foot of an overpass ramp)');
        assert.ok(dist(z, ob) >= 800, 'zombie spawn far from the objective');
      }
    });

    test(`${label}: nothing spawns inside obstacles, the objective or water`, () => {
      const m = getMap(id, seed);
      const water = m.areas.filter((a) => a.kind === 'water');
      const clear = (x, y, pad, what) => {
        for (const o of m.obstacles) assert.ok(!pointInRect(x, y, o, pad), `${what} inside obstacle ${o.id} (${o.kind})`);
        assert.ok(!pointInRect(x, y, m.objective, pad), `${what} inside the objective`);
        for (const w of water) assert.ok(!pointInRect(x, y, w, pad), `${what} in water`);
      };
      for (const p of m.playerSpawns) clear(p.x, p.y, 20, `player spawn ${p.x},${p.y}`);
      clear(m.supply.x, m.supply.y, 20, 'supply');
      for (const z of m.zombieSpawns) {
        clear(z.x, z.y, 20, `zombie spawn ${z.x},${z.y}`);
        // Zombies may appear anywhere inside the rectangle, so it must be entirely open.
        const rect = { x: z.x, y: z.y, w: z.w, h: z.h, a: 0 };
        for (const o of m.obstacles) assert.ok(!rectsOverlap(rect, o), `zombie spawn ${z.x},${z.y} overlaps obstacle ${o.id} (${o.kind})`);
        for (const w of water) assert.ok(!rectsOverlap(rect, w), 'zombie spawn overlaps water');
        assert.ok(!rectsOverlap(rect, m.objective));
      }
      // Player spawns keep a body's width apart so six players never start stacked.
      for (let i = 0; i < m.playerSpawns.length; i++) {
        for (let j = i + 1; j < m.playerSpawns.length; j++) {
          assert.ok(dist(m.playerSpawns[i], m.playerSpawns[j]) >= 40, 'player spawns overlap');
        }
      }
    });

    test(`${label}: decor never hides under obstacles or in water`, () => {
      const m = getMap(id, seed);
      const water = m.areas.filter((a) => a.kind === 'water');
      for (const d of m.decor) {
        if (d.kind === 'tree_canopy') continue;
        for (const o of m.obstacles) assert.ok(!pointInRect(d.x, d.y, o, 2), `${d.kind} at ${d.x},${d.y} under obstacle ${o.id} (${o.kind})`);
        assert.ok(!pointInRect(d.x, d.y, m.objective, 2), `${d.kind} under the objective`);
        for (const w of water) assert.ok(!pointInRect(d.x, d.y, w, 0), `${d.kind} in water`);
      }
      // Every canopy sits on a trunk.
      const trunks = m.obstacles.filter((o) => o.kind === 'tree');
      for (const d of m.decor.filter((e) => e.kind === 'tree_canopy')) {
        assert.ok(trunks.some((t) => Math.hypot(t.x - d.x, t.y - d.y) < 1), 'canopy without a trunk');
      }
    });

    test(`${label}: every player spawn, the supply and the objective are reachable from every zombie spawn`, () => {
      const m = getMap(id, seed);
      const grid = buildGrid(m, WALKER_RADIUS);
      const comp = labelComponents(grid);
      const targets = m.playerSpawns.map((p) => ({ what: `player spawn ${p.x},${p.y}`, cell: cellOf(grid, p.x, p.y) }));
      targets.push({ what: 'supply', cell: cellOf(grid, m.supply.x, m.supply.y) });
      const ring = objectiveRing(grid);
      assert.ok(ring.length >= 12, `open ground around the objective (${ring.length} ring cells)`);
      for (const cell of ring) targets.push({ what: `objective ring cell ${cell}`, cell });
      for (const z of m.zombieSpawns) {
        const zc = cellOf(grid, z.x, z.y);
        assert.equal(grid.blocked[zc], 0, `zombie spawn ${z.x},${z.y} cell is blocked`);
        for (const t of targets) {
          assert.equal(grid.blocked[t.cell], 0, `${t.what} cell is blocked`);
          assert.equal(comp[t.cell], comp[zc], `${t.what} unreachable from zombie spawn ${z.x},${z.y}`);
        }
      }
    });

    test(`${label}: stays connected on a coarse grid (cells touched by an obstacle count as blocked)`, () => {
      // A cell-overlap grid is what a cheap flow field would build; the approaches must
      // survive it too, so the horde never loses its way to the team.
      const m = getMap(id, seed);
      const grid = buildGrid(m, WALKER_RADIUS + NAV_CELL / 2);
      const comp = labelComponents(grid);
      const ring = objectiveRing(grid);
      const zc = m.zombieSpawns.map((z) => comp[cellOf(grid, z.x, z.y)]);
      assert.ok(zc.every((c) => c >= 0 && c === zc[0]), 'all zombie spawns share one region');
      const reachableRing = ring.filter((c) => comp[c] === zc[0]).length;
      assert.ok(reachableRing >= ring.length * 0.8, `objective ring mostly reachable (${reachableRing}/${ring.length})`);
      assert.equal(comp[cellOf(grid, m.supply.x, m.supply.y)], zc[0], 'supply reachable');
      const spawnsOk = m.playerSpawns.filter((p) => comp[cellOf(grid, p.x, p.y)] === zc[0]).length;
      assert.ok(spawnsOk >= 6, `player spawns reachable on the coarse grid (${spawnsOk})`);
    });
  }

  test(`${id}: deterministic for a seed; seeds change only the dressing`, () => {
    const a = buildMap(id, 42), b = buildMap(id, 42);
    assert.deepEqual(a, b);
    assert.deepEqual(buildMap(id, 42), getMap(id, 42));
    const c = buildMap(id, 9001);
    assert.notDeepEqual(a.decor, c.decor, 'decor varies with the seed');
    for (const k of ['id', 'name', 'width', 'height', 'ambient', 'ground', 'lines', 'playerSpawns', 'zombieSpawns', 'objective', 'supply']) {
      assert.deepEqual(a[k], c[k], `${k} is part of the fixed layout`);
    }
    const waterA = a.areas.filter((w) => w.kind === 'water');
    assert.deepEqual(waterA, c.areas.filter((w) => w.kind === 'water'), 'water is fixed');
    assert.equal(waterA.length > 0, id === 'bridge' || id === 'harlan');
    // Hand-placed structure stays put; only vehicles and scatter jitter.
    const fixedKinds = ['building', 'hesco', 'guardrail', 'barrier', 'sandbags', 'booth', 'tent', 'wall', 'pump'];
    const fixed = (m) => m.obstacles.filter((o) => fixedKinds.includes(o.kind)).map((o) => [o.kind, o.x, o.y, o.w, o.h, o.a]);
    assert.deepEqual(fixed(a), fixed(c));
    // Maps built with different ids from the same seed must not share their dressing stream.
    assert.equal(a.seed, 42);
  });

  test(`${id}: water only as axis-aligned 'water' areas`, () => {
    const m = getMap(id, 1);
    for (const w of m.areas.filter((a) => a.kind === 'water')) assert.equal(w.a, 0);
  });
}

test('bridge: the river splits the map and only the bridge crosses it', () => {
  const m = getMap('bridge', 42);
  const water = m.areas.filter((a) => a.kind === 'water');
  assert.equal(water.length, 2);
  const grid = buildGrid(m, WALKER_RADIUS);
  // Every row outside the bridge band is cut by water.
  const deckTop = Math.min(...water.map((w) => w.y + w.h / 2).filter((y) => y < m.height / 2 + 1));
  const deckBottom = Math.max(...water.map((w) => w.y - w.h / 2).filter((y) => y > m.height / 2 - 1));
  assert.ok(deckBottom - deckTop >= 400, 'bridge at least 400 px wide');
  // Both banks hold zombie spawns.
  const west = m.zombieSpawns.filter((z) => z.x < m.width / 2).length;
  const east = m.zombieSpawns.filter((z) => z.x > m.width / 2).length;
  assert.ok(west >= 3 && east >= 3, 'zombies come from both banks');
  // Water blocks a straight line of cells from top to bottom at the river's centre.
  const col = Math.floor(m.width / 2 / NAV_CELL);
  for (let r = 0; r < grid.rows; r++) {
    const y = (r + 0.5) * NAV_CELL;
    if (y < deckTop - WALKER_RADIUS || y > deckBottom + WALKER_RADIUS) assert.equal(grid.blocked[r * grid.cols + col], 1);
  }
});

// ---------------------------------------------------------------------------------
// Navigation on the sim's own flow field, the long highway's layout and its overpass.

for (const id of MAP_IDS) {
  test(`${id}: the real flow field leads from every zombie spawn and player start to the objective`, () => {
    const m = getMap(id, 42);
    const field = new FlowField(m, { pad: 3 });
    field.update([m.objective]);
    const out = { x: 0, y: 0 };
    for (const z of m.zombieSpawns) {
      for (const [fx, fy] of [[0, 0], [-0.4, -0.4], [0.4, 0.4], [0.4, -0.4], [-0.4, 0.4]]) {
        const x = z.x + fx * z.w, y = z.y + fy * z.h;
        assert.ok(field.reachable(x, y), `zombie spawn ${z.x},${z.y} (${x.toFixed(0)},${y.toFixed(0)}) cannot reach the objective`);
        assert.ok(field.sample(x, y, out) && Math.hypot(out.x, out.y) > 0.5, 'a walking direction');
      }
    }
    for (const p of m.playerSpawns) assert.ok(field.reachable(p.x, p.y), `player start ${p.x},${p.y} cut off`);
    assert.ok(field.reachable(m.supply.x, m.supply.y), 'supply cut off');
  });
}

test('highway: a long highway with two crossroads, an overpass and its ramps', () => {
  const m = getMap('highway', 1);
  assert.ok(m.width >= 7000 && m.width <= 8000, `width ${m.width}`);
  assert.ok(Math.abs(m.objective.x - m.width / 2) < 300, 'the bus stays near the middle');
  // Crossroads: two asphalt roads running the full height across the highway.
  const roads = m.areas.filter((a) => a.kind === 'asphalt' && a.h >= m.height - 1 && a.w <= 200);
  assert.equal(roads.length, 2, 'two crossroads');
  for (const r of roads) {
    const signals = m.decor.filter((d) => d.kind === 'signal' && Math.abs(d.x - r.x) < 150);
    assert.ok(signals.length >= 4, `signals at the junction at x=${r.x}`);
    const near = (l) => Math.abs((l.x1 + l.x2) / 2 - r.x) < 180;
    assert.ok(m.lines.filter((l) => l.kind === 'crosswalk' && near(l)).length >= 4, 'crosswalks');
    assert.ok(m.lines.filter((l) => l.kind === 'stop' && near(l)).length >= 4, 'stop lines');
    // The median barrier opens so the crossroad goes through.
    for (const o of m.obstacles) {
      if (o.kind === 'barrier') assert.ok(Math.abs(o.x - r.x) > r.w / 2 + 20, 'barrier across the junction');
    }
    for (const y of [60, m.height - 60]) {
      assert.ok(m.zombieSpawns.some((z) => Math.abs(z.x - r.x) < 60 && Math.abs(z.y - y) < 60), `horde comes down the crossroad (y=${y})`);
    }
  }
  // Overpass: a viaduct over the highway, past both map edges, and two ramps onto the shoulders.
  const decks = m.overpass.decks;
  const viaduct = decks.find((d) => d.kind === 'viaduct');
  assert.ok(viaduct, 'a viaduct');
  const ys = viaduct.pts.map((p) => p[1]);
  assert.ok(Math.min(...ys) < 0 && Math.max(...ys) > m.height, 'the viaduct runs on past the map edges');
  assert.ok(deckAt(m, viaduct.pts[0][0], 1000) > 150 && deckAt(m, viaduct.pts[0][0], 1250) > 150, 'it crosses the highway');
  const toes = rampToes(m);
  assert.ok(toes.length >= 2, 'on/off ramps');
  for (const t of toes) {
    assert.ok((t.y > 760 && t.y < 860) || (t.y > 1340 && t.y < 1440), `ramp toe ${t.x},${t.y} lands on a shoulder`);
    assert.ok(m.zombieSpawns.some((z) => Math.hypot(z.x - t.x, z.y - t.y) < 160), 'zombies come down the ramp');
  }
  assert.ok(m.zombieSpawns.some((z) => z.x < 150) && m.zombieSpawns.some((z) => z.x > m.width - 150), 'both ends of the highway');
  // Up on the deck: vehicles, one of them tipped over the edge.
  assert.ok(m.overpass.vehicles.length >= 3 && m.overpass.vehicles.some((v) => v.pitch !== 0), 'wrecks up on the deck');
  for (const v of m.overpass.vehicles) assert.ok(deckAt(m, v.x, v.y, 20) > 150, 'deck vehicles sit on (or teeter over the edge of) the deck');
});

test('highway: overpass piers block movement and the ground under the deck stays open', () => {
  const m = getMap('highway', 42);
  const world = createCollisionWorld(m);
  const piers = m.obstacles.filter((o) => o.kind === 'pier');
  assert.ok(piers.length >= 10, `pier columns (${piers.length})`);
  for (const p of piers) {
    assert.equal(p.solid, true, 'piers stop bullets');
    assert.ok(!world.isCircleFree(p.x, p.y, 14, false), 'a pier blocks');
    const deck = deckAt(m, p.x, p.y);
    assert.ok(deck > 0, `pier ${p.x},${p.y} stands under a deck`);
    assert.ok(Math.abs(p.top - (deck - OVERPASS.depth - OVERPASS.cap)) < 1, 'the column reaches the pier cap');
    // Walking into it from either side stops at its face.
    for (const s of [-1, 1]) {
      const pos = { x: p.x + s * 60, y: p.y };
      if (!world.isCircleFree(pos.x, pos.y, 14, false)) continue;
      world.moveCircle(pos, 14, -s * 120, 0);
      assert.ok(Math.abs(pos.x - p.x) >= p.w / 2 + 14 - 0.5, 'walked through a pier');
    }
  }
  // Under the viaduct: open ground between the bents, connected to the rest of the map,
  // and headroom for the camera everywhere a player can stand.
  const viaduct = m.overpass.decks.find((d) => d.kind === 'viaduct');
  const grid = buildGrid(m, WALKER_RADIUS);
  const comp = labelComponents(grid);
  const main = comp[cellOf(grid, m.zombieSpawns[0].x, m.zombieSpawns[0].y)];
  let free = 0, total = 0;
  for (let y = 40; y < m.height - 40; y += 20) {
    for (const dx of [-100, 0, 100]) {
      const x = viaduct.pts[0][0] + dx;
      total++;
      const c = cellOf(grid, x, y);
      if (grid.blocked[c]) continue;
      free++;
      assert.equal(comp[c], main, `under the viaduct at ${x},${y} is cut off`);
    }
  }
  assert.ok(free / total > 0.8, `mostly open under the viaduct (${free}/${total})`);
  for (let x = 20; x < m.width; x += 20) {
    for (let y = 20; y < m.height; y += 20) {
      const z = deckAt(m, x, y);
      if (z <= OVERPASS.walk || !world.isCircleFree(x, y, 14, false)) continue;
      // standing under a deck: the pier caps (its lowest part) stay far above the eye
      assert.ok(z - OVERPASS.depth - OVERPASS.cap >= DECK_CLEARANCE - 20, `low deck over walkable ground at ${x},${y} (z ${z.toFixed(0)})`);
    }
  }
});

test('highway: ramp embankments are walls only where the ramp is too tall to step onto', () => {
  const m = getMap('highway', 9001);
  const ramps = m.obstacles.filter((o) => o.kind === 'ramp');
  assert.ok(ramps.length >= 4);
  for (const o of ramps) {
    assert.ok(deckAt(m, o.x, o.y) > 0, 'ramp obstacle under a ramp deck');
    assert.equal(o.solid, o.top > OVERPASS.low, `ramp piece up to ${o.top} is ${o.solid ? 'solid' : 'low cover'}`);
  }
  for (const d of m.overpass.decks.filter((dd) => dd.kind === 'ramp')) {
    const [x0, y0, z0] = d.pts[0], [x1, y1, z1] = d.pts[d.pts.length - 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    for (let s = 0; s <= L; s += 8) {
      const x = x0 + ((x1 - x0) * s) / L, y = y0 + ((y1 - y0) * s) / L, z = z0 + ((z1 - z0) * s) / L;
      const inRamp = ramps.some((o) => pointInRect(x, y, o, 0));
      if (z < OVERPASS.walk - 1) assert.ok(!inRamp, `the ramp's toe is walkable (${x.toFixed(0)},${y.toFixed(0)} z ${z.toFixed(1)})`);
      else if (z > OVERPASS.walk + 2 && s > 6 && s < L - 12) assert.ok(inRamp, `the ramp at z ${z.toFixed(0)} is a wall (${x.toFixed(0)},${y.toFixed(0)})`);
    }
  }
});

test('highway: spawn weights send most zombies from near the bus, a few from the far ends', () => {
  const m = getMap('highway', 1);
  assert.ok(m.zombieSpawns.every((z) => z.weight > 0), 'every rect weighted');
  const game = { map: m, players: [{ state: 'alive', x: m.objective.x, y: m.objective.y }], rng: createRng(7) };
  const counts = new Map();
  const N = 20000;
  let dist = 0;
  for (let i = 0; i < N; i++) {
    const r = pickSpawnRect(game);
    counts.set(r, (counts.get(r) || 0) + 1);
    dist += Math.hypot(r.x - m.objective.x, r.y - m.objective.y);
  }
  const total = m.zombieSpawns.reduce((s, z) => s + z.weight, 0);
  for (const z of m.zombieSpawns) {
    const share = (counts.get(z) || 0) / N;
    assert.ok(Math.abs(share - z.weight / total) < 0.02, `rect ${z.x},${z.y}: picked ${(share * 100).toFixed(1)} %`);
  }
  // on average a group spawns about as far out as on the old, shorter map (~1500 px)
  assert.ok(dist / N < 1900, `mean spawn distance ${(dist / N).toFixed(0)} px`);
  assert.ok(counts.get(m.zombieSpawns.find((z) => z.x < 150)) > 0, 'the far ends still send some');
  // unweighted maps keep a uniform pick
  const t = getMap('truckstop', 1);
  assert.ok(t.zombieSpawns.every((z) => z.weight === undefined));
});

test('the renderers know every obstacle and decor kind the maps use', () => {
  const src = (p) => fs.readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
  const topdown = src('render/obstacles.js'), world3d = src('render3d/world.js'), flat = src('render/maplayer.js');
  const modelled = new Set(src('render3d/ground.js').match(/MODELLED_DECOR = new Set\(\[([^\]]*)\]/)[1].match(/'[a-z_]+'/g).map((k) => k.slice(1, -1)));
  const obstacleKinds = new Set(), decorKinds = new Set();
  for (const id of MAP_IDS) {
    const m = getMap(id, 1);
    for (const o of m.obstacles) obstacleKinds.add(o.kind);
    for (const d of m.decor) decorKinds.add(d.kind);
  }
  for (const k of obstacleKinds) {
    assert.ok(topdown.includes(`case '${k}'`), `top-down renderer draws '${k}' obstacles`);
    assert.ok(world3d.includes(`case '${k}'`), `3D world builds '${k}' obstacles`);
  }
  for (const k of decorKinds) {
    if (k !== 'tree_canopy') assert.ok(flat.includes(`case '${k}'`), `top-down paints '${k}' decor`);
    if (modelled.has(k)) assert.ok(world3d.includes(`case '${k}'`), `3D world models '${k}' decor`);
  }
});

test('harlan: a zone map — spawns on the edges, the start and the station in town, the lake has a dock', () => {
  const m = getMap('harlan', 1);
  for (const z of m.zombieSpawns) {
    assert.ok(Math.min(z.x, z.y, m.width - z.x, m.height - z.y) <= 250, 'zombie spawn hugs an edge');
  }
  const town = m.pois.find((p) => p.name === 'Main Street');
  for (const p of m.playerSpawns) assert.ok(dist(p, town) < 400, 'the team starts on Main Street');
  assert.ok(dist(m.supply, town) < 450, 'the supply station is in town');
  // the dock: walkable ground reaching out between two water areas
  const grid = buildGrid(m, WALKER_RADIUS);
  const comp = labelComponents(grid);
  const main = comp[cellOf(grid, m.playerSpawns[0].x, m.playerSpawns[0].y)];
  const lake = m.pois.find((p) => p.name === 'Lake Harlan Marina');
  assert.equal(comp[cellOf(grid, lake.x, 6800)], main, 'out on the dock');
  assert.equal(grid.blocked[cellOf(grid, lake.x - 300, 6800)], 1, 'water beside the dock');
});
