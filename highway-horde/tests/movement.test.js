import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionWorld, stepPlayerMovement, MASK_HEAVY } from '../public/js/shared/movement.js';
import { circleOverlapsObb, MASK_MOVE, MASK_BARRICADE } from '../public/js/shared/geom.js';
import {
  DT, PLAYER_RADIUS, PLAYER_SPEED, SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  STAMINA_MIN_TO_SPRINT, DOWNED_SPEED,
} from '../public/js/shared/constants.js';
import { createRng } from '../public/js/shared/rng.js';
import { buildFixtureMap, buildArenaMap } from './fixtures/sim-map.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function player(x, y, over = {}) {
  return { x, y, state: 'alive', stamina: STAMINA_MAX, sprintLock: false, speedMult: 1, moveMult: 1, ...over };
}

function wallMap(obstacles, extra = {}) {
  return { ...buildArenaMap({ width: 1200, height: 900, objective: false }), obstacles, ...extra };
}

function ob(id, x, y, w, h, a = 0, solid = true, kind = 'wall') {
  return { id, kind, x, y, w, h, a, color: '#777', solid, wrecked: false, roof: null };
}

function overlapsAny(world, x, y, r) {
  for (const c of world.colliders) if (circleOverlapsObb(c, x, y, r - 0.01)) return true;
  for (const b of world.barricades) if (circleOverlapsObb(b, x, y, r - 0.01)) return true;
  return false;
}

test('walks at PLAYER_SPEED, diagonal input is normalised, speed multipliers apply', () => {
  const world = createCollisionWorld(wallMap([]));
  const p = player(300, 300);
  stepPlayerMovement(p, { moveX: 1, moveY: 0 }, DT, world);
  assert.ok(near(p.x, 300 + PLAYER_SPEED * DT) && near(p.y, 300));
  const q = player(300, 300);
  stepPlayerMovement(q, { moveX: 1, moveY: 1 }, DT, world);
  assert.ok(near(Math.hypot(q.x - 300, q.y - 300), PLAYER_SPEED * DT));
  const r = player(300, 300, { speedMult: 1.15, moveMult: 0.62 });
  stepPlayerMovement(r, { moveX: 0, moveY: -1 }, DT, world);
  assert.ok(near(300 - r.y, PLAYER_SPEED * 1.15 * 0.62 * DT));
  const s = player(300, 300);
  stepPlayerMovement(s, { moveX: 0.5, moveY: 0 }, DT, world);
  assert.ok(near(s.x - 300, PLAYER_SPEED * 0.5 * DT), 'analog input scales speed');
  const t = player(300, 300);
  stepPlayerMovement(t, { moveX: NaN, moveY: undefined }, DT, world);
  assert.ok(near(t.x, 300) && near(t.y, 300), 'garbage input is ignored');
});

test('sprint: faster, drains stamina, locks when empty until STAMINA_MIN_TO_SPRINT', () => {
  const world = createCollisionWorld(wallMap([]));
  const p = player(100, 450);
  stepPlayerMovement(p, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(p.sprinting);
  assert.ok(near(p.x - 100, PLAYER_SPEED * SPRINT_MULT * DT));
  assert.ok(near(p.stamina, STAMINA_MAX - STAMINA_DRAIN * DT));
  // Standing still with sprint held is not sprinting and regenerates.
  const idle = player(100, 450, { stamina: 50 });
  stepPlayerMovement(idle, { moveX: 0, moveY: 0, sprint: true }, DT, world);
  assert.ok(!idle.sprinting && near(idle.stamina, 50 + STAMINA_REGEN * DT));
  // Run dry.
  let ticks = 0;
  const q = player(20, 450);
  while (!q.sprintLock && ticks < 1000) {
    stepPlayerMovement(q, { moveX: ticks % 400 < 200 ? 1 : -1, moveY: 0, sprint: true }, DT, world);
    ticks++;
  }
  assert.ok(q.sprintLock && q.stamina === 0);
  assert.ok(near(ticks * DT, STAMINA_MAX / STAMINA_DRAIN, DT * 2));
  // Still locked below the threshold even with sprint held...
  const x0 = q.x;
  stepPlayerMovement(q, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(!q.sprinting && near(q.x - x0, PLAYER_SPEED * DT));
  while (q.stamina < STAMINA_MIN_TO_SPRINT - 0.5) stepPlayerMovement(q, { moveX: 0, moveY: 0 }, DT, world);
  stepPlayerMovement(q, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(!q.sprinting || q.stamina >= STAMINA_MIN_TO_SPRINT - STAMINA_DRAIN * DT);
  while (q.stamina < STAMINA_MIN_TO_SPRINT) stepPlayerMovement(q, { moveX: 0, moveY: 0 }, DT, world);
  stepPlayerMovement(q, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(q.sprinting && !q.sprintLock, 'unlocks once enough stamina is back');
});

test('staminaMult slows drain and speeds regeneration', () => {
  const world = createCollisionWorld(wallMap([]));
  const p = player(100, 450, { staminaMult: 1.6 });
  stepPlayerMovement(p, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(near(p.stamina, STAMINA_MAX - (STAMINA_DRAIN / 1.6) * DT));
  const q = player(100, 450, { staminaMult: 1.6, stamina: 10 });
  stepPlayerMovement(q, { moveX: 0, moveY: 0 }, DT, world);
  assert.ok(near(q.stamina, 10 + STAMINA_REGEN * 1.6 * DT));
});

test('downed players crawl at DOWNED_SPEED and cannot sprint; dead players do not move', () => {
  const world = createCollisionWorld(wallMap([]));
  const p = player(300, 300, { state: 'downed', speedMult: 1.2, moveMult: 0.5 });
  stepPlayerMovement(p, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(!p.sprinting && near(p.x - 300, DOWNED_SPEED * DT));
  const d = player(300, 300, { state: 'dead' });
  stepPlayerMovement(d, { moveX: 1, moveY: 0 }, DT, world);
  assert.equal(d.x, 300);
});

test('slides along walls instead of sticking', () => {
  // A long wall along y = 400; walk diagonally into it.
  const world = createCollisionWorld(wallMap([ob(0, 600, 400, 1000, 20)]));
  const p = player(300, 400 - 10 - PLAYER_RADIUS - 1);
  for (let i = 0; i < 60; i++) stepPlayerMovement(p, { moveX: 0.7071, moveY: 0.7071 }, DT, world);
  assert.ok(p.x > 300 + PLAYER_SPEED * 0.7071 * 0.95, `kept sliding along x (${p.x})`);
  assert.ok(p.y <= 400 - 10 - PLAYER_RADIUS + 1e-6, 'never enters the wall');
  // Rotated wall: sliding follows its direction.
  const w2 = createCollisionWorld(wallMap([ob(0, 600, 450, 900, 20, Math.PI / 6)]));
  const q = player(400, 200);
  for (let i = 0; i < 240; i++) stepPlayerMovement(q, { moveX: 0, moveY: 1 }, DT, w2);
  assert.ok(!overlapsAny(w2, q.x, q.y, PLAYER_RADIUS));
  assert.ok(q.x > 400 + 30 || q.x < 400 - 30, 'slid sideways along the slanted wall');
});

test('bounds are clamped and water is impassable', () => {
  const map = wallMap([], { areas: [{ kind: 'water', x: 600, y: 450, w: 100, h: 900, a: 0 }] });
  const world = createCollisionWorld(map);
  const p = player(20, 20);
  for (let i = 0; i < 30; i++) stepPlayerMovement(p, { moveX: -1, moveY: -1 }, DT, world);
  assert.ok(near(p.x, PLAYER_RADIUS) && near(p.y, PLAYER_RADIUS));
  const q = player(500, 450);
  for (let i = 0; i < 120; i++) stepPlayerMovement(q, { moveX: 1, moveY: 0 }, DT, world);
  assert.ok(near(q.x, 550 - PLAYER_RADIUS, 1e-6), `stopped at the bank (${q.x})`);
});

test('low cover (solid: false) still blocks walking; objective blocks walking', () => {
  const map = wallMap([ob(0, 900, 400, 20, 400, 0, false, 'guardrail')]);
  const world = createCollisionWorld(map);
  const p = player(800, 400);
  for (let i = 0; i < 90; i++) stepPlayerMovement(p, { moveX: 1, moveY: 0 }, DT, world);
  assert.ok(p.x <= 890 - PLAYER_RADIUS + 1e-6);
  const o = map.objective;
  const q = player(o.x, o.y + o.h / 2 + PLAYER_RADIUS + 30);
  for (let i = 0; i < 90; i++) stepPlayerMovement(q, { moveX: 0, moveY: -1 }, DT, world);
  assert.ok(q.y >= o.y + o.h / 2 + PLAYER_RADIUS - 1e-6);
});

test('barricades block movement and can be replaced', () => {
  const world = createCollisionWorld(wallMap([]));
  world.setBarricades([{ x: 600, y: 300, a: Math.PI / 2 }]);
  const p = player(500, 300);
  for (let i = 0; i < 90; i++) stepPlayerMovement(p, { moveX: 1, moveY: 0 }, DT, world);
  assert.ok(p.x <= 600 - 11 - PLAYER_RADIUS + 1e-6, `blocked by the barricade (${p.x})`);
  const touched = world.resolveCircle({ x: 600 - 11 - PLAYER_RADIUS + 2, y: 300 }, PLAYER_RADIUS);
  assert.ok(touched & MASK_BARRICADE);
  assert.equal(world.touchedBarricade, 0);
  world.setBarricades([]);
  for (let i = 0; i < 90; i++) stepPlayerMovement(p, { moveX: 1, moveY: 0 }, DT, world);
  assert.ok(p.x > 700);
  // A barricade dropped on top of someone pushes them out even if they stand still.
  world.setBarricades([{ x: p.x + 5, y: p.y, angle: Math.PI / 2 }]);
  stepPlayerMovement(p, { moveX: 0, moveY: 0 }, DT, world);
  assert.ok(!overlapsAny(world, p.x, p.y, PLAYER_RADIUS));
});

test('random walks through a cluttered map never end inside anything', () => {
  const map = buildFixtureMap(11);
  const world = createCollisionWorld(map);
  const rng = createRng(5);
  for (let k = 0; k < 12; k++) {
    let p;
    do p = player(rng.range(50, map.width - 50), rng.range(50, map.height - 50));
    while (!world.isCircleFree(p.x, p.y, PLAYER_RADIUS));
    let mx = 1, my = 0;
    for (let i = 0; i < 1500; i++) {
      if (i % 40 === 0) {
        const a = rng.range(-Math.PI, Math.PI);
        mx = Math.cos(a);
        my = Math.sin(a);
      }
      stepPlayerMovement(p, { moveX: mx, moveY: my, sprint: i % 300 < 150 }, DT, world);
      assert.ok(!overlapsAny(world, p.x, p.y, PLAYER_RADIUS - 0.05), `walker ${k} inside a collider at tick ${i} (${p.x}, ${p.y})`);
    }
  }
});

test('fast movers do not tunnel through thin walls', () => {
  const world = createCollisionWorld(wallMap([ob(0, 600, 450, 6, 900)]));
  const pos = { x: 560, y: 300 };
  world.moveCircle(pos, 11, 120, 0);
  assert.ok(pos.x < 600, `stayed on the near side (${pos.x})`);
  assert.ok(world.moveCircle({ x: 560, y: 300 }, 11, 120, 0) & MASK_MOVE);
});

test('deterministic: two worlds replaying the same inputs agree exactly', () => {
  const map = buildFixtureMap(3);
  const a = createCollisionWorld(map), b = createCollisionWorld(buildFixtureMap(3));
  const rng = createRng(77);
  const cmds = [];
  for (let i = 0; i < 3000; i++) {
    cmds.push({ moveX: Math.cos(i * 0.013) * rng.range(0.5, 1), moveY: Math.sin(i * 0.021), sprint: rng.chance(0.3) });
  }
  const pa = player(map.playerSpawns[0].x, map.playerSpawns[0].y, { speedMult: 1.15, moveMult: 0.95, staminaMult: 1.6 });
  const pb = { ...pa };
  for (const c of cmds) {
    stepPlayerMovement(pa, c, DT, a);
    stepPlayerMovement(pb, c, DT, b);
  }
  assert.deepEqual(pa, pb);
});

test('lineOfSight ignores low cover and water; lineOfMovement does not', () => {
  const map = wallMap([ob(0, 600, 300, 20, 300, 0, false, 'sandbags'), ob(1, 600, 700, 20, 200, 0, true, 'car')]);
  const world = createCollisionWorld(map);
  assert.ok(world.lineOfSight(500, 300, 700, 300));
  assert.ok(!world.lineOfMovement(500, 300, 700, 300));
  assert.ok(!world.lineOfSight(500, 700, 700, 700));
  world.setBarricades([{ x: 300, y: 500, a: Math.PI / 2 }]);
  assert.ok(world.lineOfSight(200, 500, 400, 500), 'barricades never block shots');
  assert.ok(!world.lineOfMovement(200, 500, 400, 500));
  const t = world.raycastSolid(500, 700, 1, 0, 1000);
  assert.ok(near(t, 90));
});

test('sedans are shot over but block heavies; barriers are trampled by heavies', () => {
  const world = createCollisionWorld(wallMap([
    ob(0, 300, 300, 84, 42, 0, false, 'car'),
    ob(1, 600, 300, 96, 26, 0, false, 'barrier'),
  ]));
  // Bullets pass over both kinds of low cover.
  assert.equal(world.lineOfSight(200, 300, 700, 300), true);
  // Walkers are blocked by both.
  assert.equal(world.isCircleFree(300, 300, 14, false, MASK_MOVE), false);
  assert.equal(world.isCircleFree(600, 300, 14, false, MASK_MOVE), false);
  // Heavies are blocked by the car but crash through the barrier.
  assert.equal(world.isCircleFree(300, 300, 14, false, MASK_HEAVY), false);
  assert.equal(world.isCircleFree(600, 300, 14, false, MASK_HEAVY), true);
});
