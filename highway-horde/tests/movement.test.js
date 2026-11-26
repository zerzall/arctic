import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionWorld, stepPlayerMovement, eyeHeight, MASK_HEAVY } from '../public/js/shared/movement.js';
import { circleOverlapsObb, MASK_MOVE, MASK_BARRICADE } from '../public/js/shared/geom.js';
import {
  DT, PLAYER_RADIUS, PLAYER_SPEED, SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  STAMINA_MIN_TO_SPRINT, DOWNED_SPEED, WALK_MULT, CROUCH_MULT, DUCK_TICKS, EYE_HEIGHT, CROUCH_EYE,
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

/** Hold `cmd` for `n` ticks (the ground speed settles), then return one more tick's step length. */
function settled(world, p, cmd, n = 60) {
  for (let i = 0; i < n; i++) stepPlayerMovement(p, cmd, DT, world);
  const x0 = p.x, y0 = p.y;
  stepPlayerMovement(p, cmd, DT, world);
  return Math.hypot(p.x - x0, p.y - y0);
}

test('walks at PLAYER_SPEED once up to speed, diagonal input is normalised, speed multipliers apply', () => {
  const world = createCollisionWorld(wallMap([]));
  assert.ok(near(settled(world, player(300, 300), { moveX: 1, moveY: 0 }), PLAYER_SPEED * DT));
  const q = player(300, 450);
  assert.ok(near(settled(world, q, { moveX: 1, moveY: 1 }, 40), PLAYER_SPEED * DT));
  const r = player(300, 800, { speedMult: 1.15, moveMult: 0.62 });
  assert.ok(near(settled(world, r, { moveX: 0, moveY: -1 }), PLAYER_SPEED * 1.15 * 0.62 * DT));
  const s = player(300, 300);
  assert.ok(near(settled(world, s, { moveX: 0.5, moveY: 0 }), PLAYER_SPEED * 0.5 * DT), 'analog input scales speed');
  const t = player(300, 300);
  stepPlayerMovement(t, { moveX: NaN, moveY: undefined }, DT, world);
  assert.ok(near(t.x, 300) && near(t.y, 300), 'garbage input is ignored');
});

test('ground acceleration and friction: a quick start, a short stop, counter-strafing stops faster', () => {
  const world = createCollisionWorld(wallMap([]));
  const p = player(200, 450);
  // the first tick moves a little at once, then the speed climbs to 90 % within ~0.3 s
  stepPlayerMovement(p, { moveX: 1, moveY: 0 }, DT, world);
  assert.ok(p.x > 200 && p.mvx > 0 && p.mvx < PLAYER_SPEED * 0.2, `first tick ${p.mvx}`);
  let n = 1;
  while (p.mvx < PLAYER_SPEED * 0.9 && n < 200) { stepPlayerMovement(p, { moveX: 1, moveY: 0 }, DT, world); n++; }
  assert.ok(n * DT < 0.35, `90 % speed after ${(n * DT).toFixed(2)} s`);
  for (let i = 0; i < 40; i++) stepPlayerMovement(p, { moveX: 1, moveY: 0 }, DT, world);
  assert.ok(near(p.mvx, PLAYER_SPEED, 1e-6), 'never above the running speed');
  // letting go: friction stops it in ~0.35 s
  const q = { ...p };
  let stop = 0;
  while (q.mvx > 0 && stop < 200) { stepPlayerMovement(q, { moveX: 0, moveY: 0 }, DT, world); stop++; }
  assert.ok(stop * DT > 0.2 && stop * DT < 0.45, `stopped after ${(stop * DT).toFixed(2)} s`);
  // counter-strafing (the opposite key) gets below the accurate speed (34 %) in a few ticks
  const c = { ...p };
  let cs = 0;
  while (c.mvx > PLAYER_SPEED * 0.34 && cs < 200) { stepPlayerMovement(c, { moveX: -1, moveY: 0 }, DT, world); cs++; }
  const d = { ...p };
  let rel = 0;
  while (d.mvx > PLAYER_SPEED * 0.34 && rel < 200) { stepPlayerMovement(d, { moveX: 0, moveY: 0 }, DT, world); rel++; }
  assert.ok(cs <= 5 && cs < rel, `counter-strafe ${cs} ticks vs ${rel} letting go`);
});

test('walking and crouching: slower; the crouch takes DUCK_TICKS; neither sprints', () => {
  const world = createCollisionWorld(wallMap([]));
  const w = player(200, 300);
  assert.ok(near(settled(world, w, { moveX: 1, moveY: 0, walk: true, sprint: true }), PLAYER_SPEED * WALK_MULT * DT));
  assert.ok(!w.sprinting, 'walking never sprints');
  const c = player(200, 500);
  stepPlayerMovement(c, { moveX: 0, moveY: 0, crouch: true }, DT, world);
  assert.equal(c.duckT, 1);
  assert.ok(near(eyeHeight(c), EYE_HEIGHT - (EYE_HEIGHT - CROUCH_EYE) / DUCK_TICKS));
  assert.ok(near(settled(world, c, { moveX: 1, moveY: 0, crouch: true, sprint: true }), PLAYER_SPEED * CROUCH_MULT * DT));
  assert.equal(c.duckT, DUCK_TICKS);
  assert.equal(eyeHeight(c), CROUCH_EYE);
  assert.ok(!c.sprinting, 'crouching never sprints');
  for (let i = 0; i < DUCK_TICKS; i++) stepPlayerMovement(c, { moveX: 0, moveY: 0 }, DT, world);
  assert.equal(c.duckT, 0, 'stands back up');
  assert.equal(eyeHeight({ state: 'downed', duckT: 8 }), 16);
});

test('sprint: faster, drains stamina, locks when empty until STAMINA_MIN_TO_SPRINT', () => {
  const world = createCollisionWorld(wallMap([]));
  const p = player(100, 450);
  stepPlayerMovement(p, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(p.sprinting);
  assert.ok(near(p.stamina, STAMINA_MAX - STAMINA_DRAIN * DT));
  assert.ok(near(settled(world, player(100, 600), { moveX: 1, moveY: 0, sprint: true }), PLAYER_SPEED * SPRINT_MULT * DT));
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
  // Still locked below the threshold even with sprint held (back down to running speed)...
  // (20 ticks: enough for the speed to settle back to running, too few to regain the threshold)
  for (let i = 0; i < 20; i++) stepPlayerMovement(q, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(q.sprintLock, 'still locked');
  const x0 = q.x;
  stepPlayerMovement(q, { moveX: 1, moveY: 0, sprint: true }, DT, world);
  assert.ok(!q.sprinting && near(Math.abs(q.x - x0), PLAYER_SPEED * DT, 1e-6));
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
  assert.ok(near(settled(world, p, { moveX: 1, moveY: 0, sprint: true, crouch: true }), DOWNED_SPEED * DT));
  assert.ok(!p.sprinting && p.duckT === 0);
  const d = player(300, 300, { state: 'dead' });
  stepPlayerMovement(d, { moveX: 1, moveY: 0 }, DT, world);
  assert.equal(d.x, 300);
});

test('slides along walls instead of sticking', () => {
  // A long wall along y = 400; walk diagonally into it.
  const world = createCollisionWorld(wallMap([ob(0, 600, 400, 1000, 20)]));
  const p = player(300, 400 - 10 - PLAYER_RADIUS - 1);
  for (let i = 0; i < 60; i++) stepPlayerMovement(p, { moveX: 0.7071, moveY: 0.7071 }, DT, world);
  // (the first ~0.3 s is the speed building up)
  assert.ok(p.x > 300 + PLAYER_SPEED * 0.7071 * 0.85, `kept sliding along x (${p.x})`);
  assert.ok(Math.abs(p.mvy) < 1e-6, 'the wall took the velocity into it');
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
