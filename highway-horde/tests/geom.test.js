import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeObb, pointInObb, distToObb, closestPointOnObb, circleObbPush, circleOverlapsObb, rayObb, rayCircle,
  obbOverlap, StaticIndex, mapColliders, MASK_SOLID, MASK_MOVE, MASK_WATER, MASK_OBJECTIVE,
} from '../public/js/shared/geom.js';
import { createRng } from '../public/js/shared/rng.js';
import { buildFixtureMap } from './fixtures/sim-map.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('pointInObb respects rotation and padding', () => {
  const ob = makeObb(100, 100, 100, 20, Math.PI / 4);
  assert.ok(pointInObb(ob, 100, 100));
  // Along the rotated long axis.
  assert.ok(pointInObb(ob, 100 + 40 * Math.SQRT1_2, 100 + 40 * Math.SQRT1_2));
  // Same distance along world x is outside a 20 px thick rotated bar.
  assert.ok(!pointInObb(ob, 140, 100));
  assert.ok(pointInObb(ob, 100 + 12 * -Math.SQRT1_2, 100 + 12 * Math.SQRT1_2, 3));
  assert.ok(!pointInObb(ob, 100 + 12 * -Math.SQRT1_2, 100 + 12 * Math.SQRT1_2, 1));
});

test('distToObb and closestPointOnObb', () => {
  const ob = makeObb(0, 0, 20, 10, 0);
  assert.equal(distToObb(ob, 0, 0), 0);
  assert.ok(near(distToObb(ob, 20, 0), 10));
  assert.ok(near(distToObb(ob, 13, 8), Math.hypot(3, 3)));
  const out = closestPointOnObb(ob, 30, 30, {});
  assert.ok(near(out.x, 10) && near(out.y, 5));
});

test('circleObbPush pushes out along the shortest way', () => {
  const ob = makeObb(0, 0, 100, 20, 0);
  const out = {};
  assert.equal(circleObbPush(ob, 0, 30, 10, out), false);
  assert.ok(circleObbPush(ob, 0, 18, 10, out));
  assert.ok(near(out.nx, 0) && near(out.ny, 1) && near(out.depth, 2));
  // Centre inside: leave through the nearest face (top, 4 px away).
  assert.ok(circleObbPush(ob, 10, -6, 5, out));
  assert.ok(near(out.nx, 0) && near(out.ny, -1) && near(out.depth, 9));
  // Corner: diagonal normal.
  assert.ok(circleObbPush(ob, 53, 13, 5, out));
  assert.ok(near(out.nx, Math.SQRT1_2) && near(out.ny, Math.SQRT1_2));
  assert.ok(near(out.depth, 5 - Math.hypot(3, 3)));
  // Rotated box: normal is rotated too.
  const rb = makeObb(0, 0, 100, 20, Math.PI / 2);
  assert.ok(circleObbPush(rb, 15, 0, 10, out));
  assert.ok(near(out.nx, 1, 1e-9) && near(out.ny, 0, 1e-9) && near(out.depth, 5));
  assert.ok(circleOverlapsObb(rb, 15, 0, 10));
  assert.ok(!circleOverlapsObb(rb, 25, 0, 10));
});

test('rayObb slab test: distance, normal, misses, inside', () => {
  const ob = makeObb(100, 0, 20, 20, 0);
  const n = {};
  assert.ok(near(rayObb(ob, 0, 0, 1, 0, 1000, 0, n), 90));
  assert.ok(near(n.nx, -1) && near(n.ny, 0));
  assert.equal(rayObb(ob, 0, 0, 1, 0, 50), -1);
  assert.equal(rayObb(ob, 0, 0, -1, 0, 1000), -1);
  assert.equal(rayObb(ob, 0, 30, 1, 0, 1000), -1);
  assert.ok(near(rayObb(ob, 0, 30, 1, 0, 1000, 25), 65));
  assert.equal(rayObb(ob, 100, 0, 0, 1, 1000), 0);
  // Rotated 45°: the ray along +x hits the diamond's corner at x = 100 - 10*sqrt(2).
  const d = makeObb(100, 0, 20, 20, Math.PI / 4);
  assert.ok(near(rayObb(d, 0, 0, 1, 0, 1000), 100 - 10 * Math.SQRT2, 1e-9));
});

test('rayCircle', () => {
  assert.ok(near(rayCircle(0, 0, 1, 0, 50, 0, 10, 100), 40));
  assert.equal(rayCircle(0, 0, 1, 0, 50, 20, 10, 100), -1);
  assert.equal(rayCircle(0, 0, 1, 0, 50, 0, 10, 30), -1);
  assert.equal(rayCircle(0, 0, -1, 0, 50, 0, 10, 100), -1);
  assert.equal(rayCircle(48, 0, 1, 0, 50, 0, 10, 100), 0);
});

test('obbOverlap (SAT) on rotated boxes', () => {
  const a = makeObb(0, 0, 100, 10, 0);
  assert.ok(obbOverlap(a, makeObb(0, 0, 100, 10, Math.PI / 2)));
  assert.ok(!obbOverlap(a, makeObb(0, 30, 100, 10, 0)));
  // AABBs overlap but the rotated bars don't.
  const b = makeObb(60, 40, 100, 10, Math.PI / 4);
  const c = makeObb(0, 0, 60, 10, Math.PI / 4);
  assert.ok(!obbOverlap(c, b));
  assert.ok(obbOverlap(c, b, 40));
});

function bruteRay(obbs, ox, oy, dx, dy, maxT, mask, pad) {
  let best = -1;
  for (const ob of obbs) {
    if (!(ob.mask & mask)) continue;
    const t = rayObb(ob, ox, oy, dx, dy, maxT, pad);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

test('StaticIndex.raycast matches brute force on random scenes', () => {
  const rng = createRng(1234);
  const obbs = [];
  for (let i = 0; i < 160; i++) {
    obbs.push(makeObb(rng.range(0, 4000), rng.range(0, 3000), rng.range(8, 200), rng.range(8, 120), rng.range(-3, 3),
      rng.chance(0.7) ? MASK_SOLID | MASK_MOVE : MASK_MOVE));
  }
  const idx = new StaticIndex(obbs, 4000, 3000, { cellSize: 128, margin: 24 });
  for (let i = 0; i < 3000; i++) {
    const ox = rng.range(-50, 4050), oy = rng.range(-50, 3050);
    const a = rng.range(-Math.PI, Math.PI);
    const dx = Math.cos(a), dy = Math.sin(a);
    const maxT = rng.range(10, 3000);
    const mask = rng.chance(0.5) ? MASK_SOLID : MASK_MOVE;
    const pad = rng.chance(0.3) ? rng.range(0, 20) : 0;
    const want = bruteRay(obbs, ox, oy, dx, dy, maxT, mask, pad);
    const got = idx.raycast(ox, oy, dx, dy, maxT, mask, pad);
    assert.ok(near(got, want, 1e-6), `ray ${i}: got ${got} want ${want}`);
    if (got >= 0) assert.ok(idx.hit.obb.mask & mask);
  }
});

test('StaticIndex.query / pointBlocked / circleBlocked agree with brute force', () => {
  const rng = createRng(99);
  const obbs = [];
  for (let i = 0; i < 80; i++) obbs.push(makeObb(rng.range(0, 2000), rng.range(0, 2000), rng.range(10, 150), rng.range(10, 80), rng.range(-3, 3), MASK_MOVE));
  const idx = new StaticIndex(obbs, 2000, 2000);
  const out = [];
  for (let i = 0; i < 1000; i++) {
    const x = rng.range(0, 2000), y = rng.range(0, 2000), r = rng.range(2, 50);
    const n = idx.query(x - r, y - r, x + r, y + r, MASK_MOVE, out);
    const want = obbs.filter((o) => circleOverlapsObb(o, x, y, r));
    for (const w of want) assert.ok(out.slice(0, n).includes(w), 'query misses an overlapping box');
    assert.equal(new Set(out.slice(0, n)).size, n, 'query returned duplicates');
    assert.equal(idx.circleBlocked(x, y, r, MASK_MOVE), want.length > 0);
    assert.equal(idx.pointBlocked(x, y, MASK_MOVE), obbs.some((o) => pointInObb(o, x, y)));
  }
  assert.equal(idx.query(0, 0, 2000, 2000, MASK_WATER, out), 0);
});

test('two indexes can share the same boxes', () => {
  const obbs = [makeObb(100, 0, 20, 20, 0, MASK_SOLID), makeObb(200, 0, 20, 20, 0, MASK_SOLID)];
  const a = new StaticIndex(obbs, 400, 400), b = new StaticIndex(obbs, 400, 400, { cellSize: 64 });
  for (let i = 0; i < 5; i++) {
    assert.ok(near(a.raycast(0, 0, 1, 0, 400, MASK_SOLID), 90));
    assert.ok(near(b.raycast(0, 0, 1, 0, 400, MASK_SOLID), 90));
  }
});

test('segmentClear and mapColliders masks', () => {
  const map = buildFixtureMap(7);
  const cols = mapColliders(map);
  const water = cols.filter((c) => c.mask & MASK_WATER);
  assert.equal(water.length, 3);
  for (const w of water) assert.ok(!(w.mask & MASK_SOLID), 'water never blocks shots');
  const obj = cols.filter((c) => c.mask & MASK_OBJECTIVE);
  assert.equal(obj.length, 1);
  assert.ok(obj[0].mask & MASK_SOLID && obj[0].mask & MASK_MOVE);
  const rails = cols.filter((c) => c.ref && c.ref.kind === 'guardrail');
  assert.ok(rails.length > 0 && rails.every((c) => !(c.mask & MASK_SOLID) && (c.mask & MASK_MOVE)));
  const idx = new StaticIndex(cols, map.width, map.height);
  // A shot across the river is clear; walking across it is not.
  assert.ok(idx.segmentClear(2600, 1200, 2800, 1200, MASK_SOLID));
  assert.ok(!idx.segmentClear(2600, 1200, 2800, 1200, MASK_MOVE));
});
