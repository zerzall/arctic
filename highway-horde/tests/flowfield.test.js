import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowField, BARRICADE_COST } from '../public/js/shared/flowfield.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import { NAV_CELL } from '../public/js/shared/constants.js';
import { buildFixtureMap, buildArenaMap } from './fixtures/sim-map.js';

function ob(id, x, y, w, h, a = 0, solid = true, kind = 'wall') {
  return { id, kind, x, y, w, h, a, color: '#777', solid, wrecked: false, roof: null };
}

function emptyMap(obstacles = [], extra = {}) {
  return { ...buildArenaMap({ width: 1600, height: 1200, objective: false }), obstacles, ...extra };
}

/**
 * Walk an agent along the field with the real collision world (like a zombie).
 * @returns {{ reached: boolean, steps: number, x: number, y: number }}
 */
function follow(ff, world, x, y, tx, ty, r = 14, maxSteps = 6000, speed = 90) {
  const pos = { x, y };
  const out = { x: 0, y: 0 };
  for (let i = 0; i < maxSteps; i++) {
    if (Math.hypot(pos.x - tx, pos.y - ty) < 40) return { reached: true, steps: i, ...pos };
    if (!ff.sample(pos.x, pos.y, out)) return { reached: false, steps: i, ...pos };
    world.moveCircle(pos, r, out.x * speed / 60, out.y * speed / 60);
  }
  return { reached: false, steps: maxSteps, ...pos };
}

test('open ground: every sample points (roughly) at the target', () => {
  const map = emptyMap();
  const ff = new FlowField(map);
  ff.update([{ x: 800, y: 600 }]);
  const out = {};
  for (const [x, y] of [[100, 100], [1500, 100], [100, 1100], [1500, 1100], [800, 100], [300, 600]]) {
    assert.ok(ff.sample(x, y, out));
    const dx = 800 - x, dy = 600 - y, l = Math.hypot(dx, dy);
    const dot = (out.x * dx + out.y * dy) / l;
    assert.ok(dot > 0.9, `(${x},${y}) points away from the target: dot ${dot.toFixed(2)}`);
    assert.ok(Math.abs(Math.hypot(out.x, out.y) - 1) < 1e-9);
  }
  const d = ff.distanceAt(100, 600);
  assert.ok(d > 650 && d < 760, `path distance ~700 (${d})`);
});

test('routes through the gap in a wall and around a thin guard rail', () => {
  // Vertical wall at x=800 with a 60 px gap at y=900; thin rail below the target.
  const map = emptyMap([
    ob(0, 800, 420, 20, 840),
    ob(1, 800, 1070, 20, 260),
    ob(2, 1200, 700, 500, 8, 0, false, 'guardrail'),
  ]);
  const world = createCollisionWorld(map);
  const ff = new FlowField(map);
  ff.update([{ x: 1200, y: 500 }]);
  const res = follow(ff, world, 300, 300, 1200, 500);
  assert.ok(res.reached, `walker reached the target through the gap (ended at ${res.x.toFixed(0)},${res.y.toFixed(0)})`);
  // Coming from below the rail, the path goes around its ends, not through it.
  const out = {};
  ff.sample(1200, 760, out);
  assert.ok(Math.abs(out.x) > 0.5, `below the rail the flow runs sideways (${out.x.toFixed(2)}, ${out.y.toFixed(2)})`);
  const res2 = follow(ff, world, 1200, 900, 1200, 500);
  assert.ok(res2.reached, 'walker from below gets around the rail');
});

test('no corner cutting: diagonal moves need both side cells open', () => {
  const map = emptyMap([ob(0, 400, 400, 64, 64)]);
  const ff = new FlowField(map);
  const cols = ff.cols;
  for (let c = 0; c < ff.n; c++) {
    const cx = c % cols, cy = (c - cx) / cols;
    for (const [k, dx, dy] of [[1, 1, 1], [3, -1, 1], [5, -1, -1], [7, 1, -1]]) {
      if (!(ff.edges[c] & (1 << k))) continue;
      assert.equal(ff.blocked[cy * cols + cx + dx], 0);
      assert.equal(ff.blocked[(cy + dy) * cols + cx], 0);
    }
  }
});

test('edges are symmetric and never cross colliders', () => {
  const map = buildFixtureMap(7);
  const ff = new FlowField(map);
  const offs = ff.offs;
  for (let c = 0; c < ff.n; c++) {
    for (let k = 0; k < 8; k++) {
      if (!(ff.edges[c] & (1 << k))) continue;
      const nc = c + offs[k];
      assert.ok(ff.edges[nc] & (1 << ((k + 4) & 7)), 'edge symmetry');
      assert.equal(ff.blocked[nc], 0);
    }
  }
});

test('barricades cost more: detour when possible, straight through when not', () => {
  // A corridor between two walls with a side route.
  const map = emptyMap([ob(0, 800, 300, 20, 600), ob(1, 800, 1000, 20, 400)]);
  const ff = new FlowField(map);
  ff.update([{ x: 1300, y: 700 }]);
  const before = ff.distanceAt(300, 700);
  // Barricade across the 200 px gap at y=700 (two barricades end to end).
  ff.setBarricades([{ x: 800, y: 650, a: Math.PI / 2 }, { x: 800, y: 750, a: Math.PI / 2 }]);
  ff.update([{ x: 1300, y: 700 }]);
  const after = ff.distanceAt(300, 700);
  assert.ok(after > before, 'barricades make the path longer');
  assert.ok(after < Infinity, 'but it is still reachable (zombies smash through)');
  const c = ff.cellAt(800, 700);
  assert.ok(Math.abs(ff.cost[c] / ff.baseCost[c] - BARRICADE_COST) < 1e-9);
  ff.setBarricades([]);
  assert.ok(Math.abs(ff.cost[c] - ff.baseCost[c]) < 1e-9);
});

test('points inside blocked cells get pointed back to open ground', () => {
  const map = emptyMap([ob(0, 800, 600, 300, 300)]);
  const ff = new FlowField(map);
  ff.update([{ x: 200, y: 600 }]);
  const out = {};
  // Just inside the box's left face: must head left/out, not deeper in.
  assert.ok(ff.sample(660, 600, out));
  assert.ok(out.x < -0.5, `escapes toward open ground (${out.x.toFixed(2)})`);
  assert.equal(ff.reachable(800, 600), false, 'inside the box is not itself on a path');
  assert.ok(ff.distanceAt(800, 600) < Infinity);
});

test('cut-off pockets point at the nearest reachable ground; rectangle targets; bias', () => {
  // A walled pen: nothing inside can path out, so it heads for the nearest cell that can.
  const map = emptyMap([ob(0, 300, 200, 220, 20), ob(1, 300, 400, 220, 20), ob(2, 200, 300, 20, 220), ob(3, 400, 300, 20, 220)]);
  const ff = new FlowField(map);
  const out = {};
  assert.equal(ff.sample(300, 300, out), false, 'no targets yet');
  assert.equal(ff.hasPath, false);
  ff.update([{ x: 1200, y: 900 }]);
  assert.ok(ff.hasPath);
  assert.equal(ff.reachable(300, 300), false);
  assert.ok(ff.sample(300, 300, out));
  assert.ok(Math.abs(Math.hypot(out.x, out.y) - 1) < 1e-9);
  const d = ff.distanceAt(300, 300);
  assert.ok(d < Infinity && d > ff.distanceAt(440, 300));
  // With no targets at all, there is no direction.
  const empty = new FlowField(map);
  empty.update([]);
  assert.equal(empty.sample(800, 800, out), false);
  assert.equal(out.x, 0);
  assert.equal(empty.distanceAt(800, 800), Infinity);
  // Rectangle target: an agent ends up hugging the rectangle.
  const m2 = emptyMap([]);
  const w2 = createCollisionWorld({ ...m2, obstacles: [ob(0, 800, 600, 200, 80)] });
  const f2 = new FlowField({ ...m2, obstacles: [ob(0, 800, 600, 200, 80)] });
  f2.update([{ x: 800, y: 600, w: 200, h: 80, a: 0 }]);
  const res = follow(f2, w2, 100, 100, 700, 560, 14);
  assert.ok(res.reached || Math.hypot(res.x - 800, res.y - 600) < 140);
  // Bias: a biased target loses to an unbiased one at a similar distance.
  const f3 = new FlowField(m2);
  f3.update([{ x: 400, y: 600 }, { x: 1200, y: 600, bias: 300 }]);
  f3.sample(820, 600, out);
  assert.ok(out.x < 0, 'heads to the unbiased target even though the biased one is nearer');
});

test('agents from every zombie spawn of the fixture map reach the objective', () => {
  const map = buildFixtureMap(7);
  const world = createCollisionWorld(map);
  const ff = new FlowField(map, { colliders: world.colliders });
  const big = new FlowField(map, { colliders: world.colliders, pad: 20 });
  const o = map.objective;
  ff.update([{ x: o.x, y: o.y, w: o.w, h: o.h, a: o.a }]);
  big.update([{ x: o.x, y: o.y, w: o.w, h: o.h, a: o.a }]);
  for (const s of map.zombieSpawns) {
    for (const [dx, dy] of [[0, 0], [-0.4, -0.4], [0.4, 0.4]]) {
      const x = s.x + dx * s.w, y = s.y + dy * s.h;
      const res = follow(ff, world, x, y, o.x, o.y + o.h / 2 + 20, 14, 8000);
      assert.ok(res.reached || Math.hypot(res.x - o.x, res.y - o.y) < 200,
        `walker from spawn (${x.toFixed(0)},${y.toFixed(0)}) stuck at ${res.x.toFixed(0)},${res.y.toFixed(0)}`);
      const rb = follow(big, world, x, y, o.x, o.y + o.h / 2 + 30, 26, 8000);
      assert.ok(rb.reached || Math.hypot(rb.x - o.x, rb.y - o.y) < 220,
        `brute from spawn (${x.toFixed(0)},${y.toFixed(0)}) stuck at ${rb.x.toFixed(0)},${rb.y.toFixed(0)}`);
    }
  }
});

test('update is fast on the largest map size (4000x3200, 160 obstacles)', () => {
  const map = buildFixtureMap(3, { width: 4000, height: 3200, clutter: 160 });
  const ff = new FlowField(map);
  assert.equal(ff.cols, Math.ceil(4000 / NAV_CELL));
  const targets = [{ x: 1800, y: 1500 }, { x: 2300, y: 1700 }, { x: 2000, y: 1400 }, map.objective];
  for (let i = 0; i < 30; i++) ff.update(targets);
  const t0 = performance.now();
  const N = 100;
  for (let i = 0; i < N; i++) ff.update(targets);
  const avg = (performance.now() - t0) / N;
  // The budget is 2 ms; allow headroom for slow CI machines.
  assert.ok(avg < 6, `average update ${avg.toFixed(3)} ms`);
});
