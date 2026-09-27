// Map contract tests (SPEC §2): schema, bounds, determinism, spawn safety and
// reachability of every player spawn, the supply station and the objective from every
// zombie spawn, measured on a NAV_CELL occupancy grid like the one the sim navigates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, buildMap } from '../public/js/shared/maps.js';
import { NAV_CELL } from '../public/js/shared/constants.js';

const MAP_IDS = ['highway', 'truckstop', 'bridge', 'checkpoint'];
const SEEDS = [1, 42, 9001];
const WALKER_RADIUS = 14;

const AREA_KINDS = ['asphalt', 'concrete', 'grass', 'dirt', 'gravel', 'sand', 'water'];
const LINE_KINDS = ['white', 'white_dashed', 'yellow', 'yellow_double', 'crosswalk', 'parking', 'stop'];
const OBSTACLE_KINDS = ['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker', 'barrier',
  'sandbags', 'building', 'wall', 'container', 'pump', 'tree', 'rock', 'hesco', 'tent', 'booth',
  'guardrail', 'pillar'];
const DECOR_KINDS = ['tree_canopy', 'bush', 'grass_tuft', 'rock', 'cone', 'debris', 'tire', 'crack',
  'oil', 'blood_old', 'paper', 'skid', 'manhole', 'lamp_post', 'sign', 'flag', 'rubble'];
const OBJECTIVE_KINDS = ['bus', 'diner', 'apc', 'radio'];
const LOW_COVER = ['guardrail', 'barrier', 'sandbags'];
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

const cache = new Map();
function getMap(id, seed) {
  const key = `${id}:${seed}`;
  if (!cache.has(key)) cache.set(key, buildMap(id, seed));
  return cache.get(key);
}

// ---------------------------------------------------------------------------------

test('MAP_LIST lists the four maps in lobby order', () => {
  assert.deepEqual(MAP_LIST.map((m) => m.id), MAP_IDS);
  for (const m of MAP_LIST) {
    assert.equal(typeof m.name, 'string');
    assert.ok(m.name.length > 0);
    assert.equal(typeof m.description, 'string');
    assert.ok(m.description.length > 10);
  }
  assert.deepEqual(MAP_LIST.map((m) => m.name),
    ['Highway 9 Pileup', 'Last Chance Truck Stop', 'Blackwater Bridge', 'Checkpoint Delta']);
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
      assert.ok(Number.isFinite(m.width) && m.width >= 2400 && m.width <= 4000, 'width');
      assert.ok(Number.isFinite(m.height) && m.height >= 1600 && m.height <= 3000, 'height');
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
      assert.ok(m.obstacles.length >= 60 && m.obstacles.length <= 160, `obstacles: ${m.obstacles.length}`);
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

    test(`${label}: layout rules (objective central, supply distance, spawns near edges)`, () => {
      const m = getMap(id, seed);
      const ob = m.objective;
      assert.ok(Math.abs(ob.x - m.width / 2) < m.width * 0.2, 'objective roughly central (x)');
      assert.ok(Math.abs(ob.y - m.height / 2) < m.height * 0.2, 'objective roughly central (y)');
      const sd = dist(m.supply, ob);
      assert.ok(sd >= 250 && sd <= 450, `supply ${sd.toFixed(0)} px from objective`);
      for (const p of m.playerSpawns) assert.ok(dist(p, ob) < 400, 'player spawns near the objective');
      for (const z of m.zombieSpawns) {
        const edge = Math.min(z.x, z.y, m.width - z.x, m.height - z.y);
        assert.ok(edge <= 250, 'zombie spawn hugs an edge');
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
    assert.equal(waterA.length > 0, id === 'bridge');
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
