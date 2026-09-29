// Climbing (SPEC §3.2, §3.4): mantling onto cars, vans and containers, standing and
// walking on top of them, falling off, roof-to-roof jumps, exact client prediction through
// the wire format, zombies getting at perched survivors, and shooting from up high.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionWorld, stepPlayerMovement, findLedge, ledgeAhead } from '../public/js/shared/movement.js';
import { Z_UNIT, JUMP_TICKS } from '../public/js/shared/jump.js';
import { encodeSnapshot, decodeSnapshot, encodeInputs, decodeInputs, quantizeInput } from '../public/js/shared/protocol.js';
import {
  DT, PLAYER_RADIUS, STAMINA_MAX, CLIMB_TOP, MANTLE_TICKS, MANTLE_REACH, JUMP_HEIGHT, ZOMBIE_REACH_Z, STAND_PAD,
} from '../public/js/shared/constants.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { fireHitscan } from '../public/js/shared/sim/combat.js';
import { buildArenaMap } from './fixtures/sim-map.js';
import { bigSnapshot } from './fixtures/net-fake-game.js';
import { makeGame, place, run, addZombie, eventsOf } from './helpers/sim-helpers.js';

const R = PLAYER_RADIUS;

function player(x, y, over = {}) {
  return { x, y, state: 'alive', stamina: STAMINA_MAX, sprintLock: false, speedMult: 1, moveMult: 1, ...over };
}

function ob(id, kind, x, y, w, h, extra = {}) {
  return { id, kind, x, y, w, h, a: 0, color: '#777', solid: kind !== 'car', wrecked: false, roof: null, ...extra };
}

function arena(obstacles, width = 1200, height = 900) {
  return { ...buildArenaMap({ width, height, objective: false }), obstacles, areas: [] };
}

/** Put a record on top of collider c (standing). */
function perch(p, c) {
  p.zq = c.topQ;
  p.z = c.top;
  p.vzq = 0;
  return p;
}

/**
 * Walk along (mx, my) into an obstacle; once stopped against it press jump (held for
 * `hold` ticks) and keep pushing. Returns the per-tick log [{ ev, x, y, z, climbT }].
 */
function climbInto(world, p, mx, my, { ticks = 150, hold = 1, jump = true } = {}) {
  const log = [];
  let last = null, pressed = -1;
  for (let t = 0; t < ticks; t++) {
    const stuck = last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6 && p.vzq === 0 && !p.climbT;
    last = { x: p.x, y: p.y };
    if (jump && stuck && pressed < 0) pressed = t;
    const j = pressed >= 0 && t < pressed + hold;
    const ev = stepPlayerMovement(p, { moveX: mx, moveY: my, jump: j }, DT, world);
    log.push({ ev, x: p.x, y: p.y, z: p.z, climbT: p.climbT });
  }
  return log;
}

test('the climbable-heights table follows the rendered heights and the reach rule', () => {
  // everything standable from the ground is reachable at the top of a jump
  const fromGround = JUMP_HEIGHT + MANTLE_REACH;
  for (const k of ['car', 'suv', 'pickup', 'van', 'hesco']) assert.ok(CLIMB_TOP[k] <= fromGround, k);
  assert.ok(CLIMB_TOP.container[1] <= fromGround, 'a shipping container');
  for (const k of ['truck', 'bus', 'tanker']) assert.ok(CLIMB_TOP[k] > fromGround, `${k}: only from a perch`);
  assert.ok(CLIMB_TOP.semi[1] > fromGround);
  // a car roof is within a zombie's grab; anything taller needs a climb
  assert.ok(CLIMB_TOP.car <= ZOMBIE_REACH_Z && CLIMB_TOP.van > ZOMBIE_REACH_Z && CLIMB_TOP.hesco > ZOMBIE_REACH_Z);
  assert.ok(ZOMBIE_REACH_Z >= JUMP_HEIGHT, 'no dodging a walker by hopping');
});

test('mantle onto a car: Space while pushing into it pulls you up in MANTLE_TICKS, onto the roof', () => {
  const world = createCollisionWorld(arena([ob(0, 'car', 600, 450, 84, 42)]));
  const car = world.colliders[0];
  const p = player(600, 380);
  const log = climbInto(world, p, 0, 1);
  const start = log.findIndex((e) => e.ev === 2);
  assert.ok(start > 0, 'a climb started');
  const end = log.findIndex((e, i) => i > start && e.ev === -1);
  assert.equal(end - start, MANTLE_TICKS, 'the climb lasts MANTLE_TICKS');
  for (let i = start + 1; i <= end; i++) assert.ok(log[i].z >= log[i - 1].z, 'the feet only rise');
  assert.equal(log[end].z, car.top, 'standing on the roof');
  assert.ok(Math.abs(log[end].y - 450) <= 21 - R + 2 + 1e-6, `well onto the roof (${log[end].y})`);
  // walking on across the roof is not blocked by the car itself
  const after = log.slice(end + 1);
  const onRoof = after.filter((e) => e.z === car.top);
  assert.ok(onRoof.length > 3 && onRoof.some((e) => e.y > 450), 'walked across the roof');
  // ... and off the far edge, falling back down
  assert.equal(p.z, 0, 'back on the ground');
  assert.ok(p.y > 450 + 21 + R - 0.5, `came down on the far side (${p.y.toFixed(1)})`);
});

test('mantle a van or a shipping container from the top of a jump; not a building, a truck or a wall', () => {
  for (const [kind, w, h] of [['van', 104, 50], ['container', 150, 56], ['hesco', 114, 44]]) {
    const world = createCollisionWorld(arena([ob(0, kind, 600, 450, w, h)]));
    const top = world.colliders[0].top;
    const p = player(600, 450 - h / 2 - 40);
    const log = climbInto(world, p, 0, 1, { ticks: 60, hold: 30 });
    const start = log.findIndex((e) => e.ev === 2);
    assert.ok(start > 0, `${kind}: climbed`);
    assert.ok(log[start].z >= top - MANTLE_REACH - 1e-9, `${kind}: grabbed within reach (${log[start].z.toFixed(1)} of ${top})`);
    assert.ok(log.some((e) => e.z === top && e.climbT === 0), `${kind}: stood on top`);
  }
  for (const [what, o] of [
    ['a building', ob(0, 'building', 600, 450, 200, 100)],
    ['an army truck', ob(0, 'truck', 600, 450, 136, 56)],
    ['a tall wall', ob(0, 'wall', 600, 450, 240, 14)],
    ['a gas pump', ob(0, 'pump', 600, 450, 46, 24)],
  ]) {
    const world = createCollisionWorld(arena([o]));
    const p = player(600, 450 - o.h / 2 - 40);
    const log = climbInto(world, p, 0, 1, { ticks: 90, hold: 60 });
    assert.ok(!log.some((e) => e.ev === 2), `${what}: no climb`);
    assert.ok(p.y < 450 - o.h / 2, `${what}: still in front of it`);
  }
  // without Space, walking into a car just stops you
  const world = createCollisionWorld(arena([ob(0, 'car', 600, 450, 84, 42)]));
  const p = player(600, 380);
  climbInto(world, p, 0, 1, { jump: false });
  assert.equal(p.z, 0);
  assert.ok(p.y <= 450 - 21 - R + 1e-6);
});

test('a ledge only counts when you push into it (not sliding along it), and needs room on top', () => {
  const world = createCollisionWorld(arena([ob(0, 'car', 600, 450, 84, 42), ob(1, 'building', 800, 455, 100, 100)]));
  const x = 600, y = 450 - 21 - R; // touching the car's long side
  assert.equal(findLedge(world, x, y, R, 0, 0, 1), 0, 'straight in');
  assert.equal(findLedge(world, x, y, R, 0, 0.6, 0.8), 0, 'at an angle');
  assert.equal(findLedge(world, x, y, R, 0, 1, 0), -1, 'along it');
  assert.equal(findLedge(world, x, y, R, 0, 0, -1), -1, 'away from it');
  assert.equal(findLedge(world, x, y - 20, R, 0, 0, 1), -1, 'too far away');
  // above the roof already: nothing to climb
  assert.equal(findLedge(world, x, y, R, world.colliders[0].topQ, 0, 1), -1);
  // a van too high from the ground without jumping
  const w2 = createCollisionWorld(arena([ob(0, 'van', 600, 450, 104, 50)]));
  assert.equal(findLedge(w2, 600, 450 - 25 - R, R, 0, 0, 1), -1, 'from the ground: out of reach');
  assert.equal(findLedge(w2, 600, 450 - 25 - R, R, Math.round(35 / Z_UNIT), 0, 1), 0, 'mid-jump: grabbed');
  // a car parked under a building's overhang: no room on its roof
  const w3 = createCollisionWorld(arena([ob(0, 'car', 600, 450, 84, 42), ob(1, 'building', 600, 470, 200, 20)]));
  assert.equal(findLedge(w3, 600, 450 - 21 - R, R, 0, 0, 1), -1, 'blocked on top');
});

test('the HUD hint: a ledge just ahead that a jump would climb (car, container), not a truck or a building', () => {
  const world = createCollisionWorld(arena([
    ob(0, 'car', 300, 450, 84, 42), ob(1, 'container', 600, 450, 150, 56), ob(2, 'truck', 900, 450, 136, 56), ob(3, 'building', 600, 750, 200, 100),
  ]));
  const [car, cont] = world.colliders;
  assert.equal(ledgeAhead(world, 300, 450 - 21 - R - 20, 0, 0, 1), 0, 'facing the car 20 px away');
  assert.equal(ledgeAhead(world, 300, 450 - 21 - R - 20, 0, 0, -1), -1, 'turned away from it');
  assert.equal(ledgeAhead(world, 300, 450 - 21 - R - 80, 0, 0, 1), -1, 'too far');
  assert.equal(ledgeAhead(world, 600, 450 - 28 - R - 10, 0, 0, 1), 1, 'the container');
  assert.equal(ledgeAhead(world, 900, 450 - 28 - R - 10, 0, 0, 1), -1, 'not the truck from the ground');
  assert.equal(ledgeAhead(world, 900, 450 - 28 - R - 10, cont.topQ, 0, 1), 2, 'but from a perch as high as the container');
  assert.equal(ledgeAhead(world, 600, 750 - 50 - R - 10, 0, 0, 1), -1, 'never a building');
  assert.equal(ledgeAhead(world, 300, 450 - 21 - R - 20, car.topQ, 0, 1), -1, 'nothing to climb when already that high');
});

test('standing on a car: walk around its roof, a taller neighbour still blocks, step down onto a lower one', () => {
  // a car with a van nose-to-tail on its right and an SUV-height... a truck on its left
  const world = createCollisionWorld(arena([
    ob(0, 'car', 600, 450, 84, 42), ob(1, 'truck', 600 - 42 - 68 - 4, 450, 136, 56), ob(2, 'van', 600 + 42 + 52 + 4, 450, 104, 50),
  ]));
  const [car, truck, van] = world.colliders;
  const p = perch(player(600, 450), car);
  // walk left: the truck (taller) blocks at roof height, we stay on the car
  for (let t = 0; t < 60; t++) stepPlayerMovement(p, { moveX: -1, moveY: 0 }, DT, world);
  assert.equal(p.z, car.top, 'still on the car roof');
  assert.ok(p.x - R >= truck.x + truck.hw - 1e-6, `stopped by the truck (${p.x.toFixed(1)})`);
  // from the van roof, walk left onto the car: step down onto it
  const q = perch(player(van.x, 450), van);
  const zs = [];
  for (let t = 0; t < 45; t++) {
    stepPlayerMovement(q, { moveX: -1, moveY: 0 }, DT, world);
    zs.push(q.z);
  }
  assert.equal(q.z, car.top, `dropped onto the car (${q.z})`);
  assert.ok(zs.every((z) => z >= car.top), 'never below the car roof on the way');
  // standing still on the roof is stable (no drift, no fall)
  const r = perch(player(600, 450), car);
  for (let t = 0; t < 120; t++) stepPlayerMovement(r, { moveX: 0, moveY: 0 }, DT, world);
  assert.deepEqual([r.x, r.y, r.z, r.vzq], [600, 450, car.top, 0]);
});

test('walking off the edge: a free fall (n² height units after n ticks), no damage, a landing', () => {
  const world = createCollisionWorld(arena([ob(0, 'container', 600, 450, 150, 56)]));
  const c = world.colliders[0];
  const p = perch(player(600, 450), c);
  let leftAt = -1, landedAt = -1;
  const zqs = [];
  for (let t = 0; t < 120 && landedAt < 0; t++) {
    const ev = stepPlayerMovement(p, { moveX: 0, moveY: 1 }, DT, world);
    if (leftAt < 0 && p.vzq !== 0) leftAt = t;
    if (leftAt >= 0) zqs.push(p.zq);
    if (ev === -1) landedAt = t;
  }
  assert.ok(leftAt > 0 && landedAt > leftAt, 'fell and landed');
  assert.ok(p.y > 450 + 28, 'beyond the edge');
  // the centre left the footprint + STAND_PAD when the fall began
  assert.equal(p.z, 0);
  for (let n = 1; n < zqs.length - 1; n++) assert.equal(zqs[n], c.topQ - n * n, `tick ${n} of the fall`);
  assert.ok(landedAt - leftAt <= Math.ceil(Math.sqrt(c.topQ)) + 1, 'a quick drop');
  // the player never ended up inside the container on the way down
  const q = perch(player(600, 450), c);
  for (let t = 0; t < 60; t++) {
    stepPlayerMovement(q, { moveX: 0.3, moveY: 1 }, DT, world);
    assert.ok(!world.circleBlockedAt(q.x, q.y, R - 0.01, q.z), `inside at tick ${t}`);
  }
  assert.ok(Math.abs(q.y - 450) > 28 + STAND_PAD - 1, 'off');
});

test('roof to roof: a running jump crosses a gap between two vans, landing on the far roof', () => {
  const world = createCollisionWorld(arena([ob(0, 'van', 500, 450, 104, 50), ob(1, 'van', 690, 450, 104, 50)]));
  const [a, b] = world.colliders;
  const p = perch(player(470, 450), a);
  let jumped = false;
  for (let t = 0; t < 90; t++) {
    const jump = !jumped && p.x > 540;
    if (jump) jumped = true;
    stepPlayerMovement(p, { moveX: 1, moveY: 0, sprint: true, jump }, DT, world);
    if (jumped && p.vzq === 0) break;
  }
  assert.ok(jumped);
  assert.equal(p.z, b.top, `on the second van (${p.x.toFixed(1)}, z ${p.z.toFixed(1)})`);
});

test('prediction: a client replaying from any snapshot (mid-mantle, on the roof, mid-fall) matches the host', () => {
  // a car, a van and a container nose to tail: up the car, down, up the van, up the container
  const world = createCollisionWorld(arena([ob(0, 'car', 600, 450, 84, 42), ob(1, 'van', 760, 450, 104, 50), ob(2, 'container', 891, 450, 150, 56)]));
  // Scripted inputs (as the wire delivers them): walk along, weaving; jump whenever
  // stopped against something, and now and then anyway. The host run records them.
  const cmds = [];
  const host = player(480, 440);
  const states = [];
  let climbs = 0, maxZ = 0, lastX = host.x, lastY = host.y;
  for (let i = 0; i < 480; i++) {
    const stuck = i > 0 && Math.hypot(host.x - lastX, host.y - lastY) < 0.5;
    lastX = host.x;
    lastY = host.y;
    const q = quantizeInput({
      seq: i + 1, moveX: 0.8, moveY: Math.sin(i / 37) * 0.08, angle: 0,
      sprint: i % 100 < 30, jump: stuck,
    });
    const c = decodeInputs(encodeInputs([q]))[0];
    cmds.push(c);
    if (stepPlayerMovement(host, c, DT, world) === 2) climbs++;
    maxZ = Math.max(maxZ, host.z);
    states.push({ ...host });
  }
  assert.ok(climbs >= 3, `climbed several times (${climbs})`);
  assert.equal(maxZ, world.colliders[2].top, `got up on the container (${maxZ.toFixed(1)})`);
  let midClimb = 0, onTop = 0;
  for (let k = 0; k < cmds.length - 1; k += 3) {
    const s = states[k];
    const snap = { ...bigSnapshot(0), players: [{ ...bigSnapshot(0).players[0], ...s }] };
    const d = decodeSnapshot(encodeSnapshot(snap)).players[0];
    if (d.climbT > 0) midClimb++;
    if (d.zq > 0 && d.vzq === 0 && !d.climbT) onTop++;
    const c = player(d.x, d.y, { stamina: d.stamina, sprintLock: d.sprintLock, zq: d.zq, vzq: d.vzq, jumpCd: d.jumpCd, climbT: d.climbT, climbTo: d.climbTo });
    for (let i = k + 1; i < cmds.length; i++) {
      stepPlayerMovement(c, cmds[i], DT, world);
      assert.equal(c.zq, states[i].zq, `ack ${k}: height at tick ${i}`);
      assert.equal(c.climbT, states[i].climbT, `ack ${k}: climb at tick ${i}`);
    }
    assert.ok(Math.abs(c.x - host.x) < 0.01 && Math.abs(c.y - host.y) < 0.01, `ack ${k}: ${c.x},${c.y} vs ${host.x},${host.y}`);
  }
  assert.ok(midClimb > 3 && onTop > 3, `acks mid-climb (${midClimb}) and on a roof (${onTop})`);
});

test('protocol: zombie heights round-trip in a byte, only for zombies off the ground', () => {
  const base = bigSnapshot(0);
  const zombies = [
    { id: 1, type: 'walker', x: 100, y: 100, angle: 0, hp: 1, flags: 1, z: 0 },
    { id: 2, type: 'runner', x: 200, y: 100, angle: 0, hp: 1, flags: 64, z: 84 },
    { id: 3, type: 'walker', x: 300, y: 100, angle: 0, hp: 1, flags: 0, z: 123.6 },
    { id: 4, type: 'walker', x: 300, y: 100, angle: 0, hp: 1, flags: 0 },
  ];
  const d = decodeSnapshot(encodeSnapshot({ ...base, zombies })).zombies;
  assert.deepEqual(d.map((z) => z.z), [0, 84, 124, 0]);
  assert.deepEqual(d.map((z) => z.flags), [1, 64, 0, 0], 'flags untouched');
  const flat = encodeSnapshot({ ...base, zombies: zombies.map((z) => ({ ...z, z: 0 })) }).byteLength;
  assert.equal(encodeSnapshot({ ...base, zombies }).byteLength - flat, 2, 'one byte per zombie up high');
});

// ---- zombies vs perched survivors -------------------------------------------------------------

function perchedGame(kind, w, h, types, { dist = 300, seconds = 20 } = {}) {
  const map = arena([ob(0, kind, 800, 600, w, h)], 1600, 1200);
  const g = makeGame({ map });
  const c = g.world.colliders[0];
  const p = perch(place(g, 1, 800, 600, 0), c);
  const zs = types.map((t, i) => addZombie(g, t, 800 + dist * Math.cos(i * 1.3), 600 + dist * Math.sin(i * 1.3)));
  const stats = { firstHit: -1, hits: 0, maxZ: 0 };
  for (let t = 0; t < 60 * seconds; t++) {
    p.hp = p.maxHp;
    p.armor = 0;
    g.setInput(1, { seq: t + 1, moveX: 0, moveY: 0, angle: 0 });
    g.step();
    for (const z of zs) stats.maxZ = Math.max(stats.maxZ, z.z);
    const n = eventsOf(g.snapshot().events, 'pdamage').filter((e) => e.pid === 1).length;
    if (n && stats.firstHit < 0) stats.firstHit = t / 60;
    stats.hits += n;
  }
  return { g, p, c, zs, stats };
}

test('zombies: a car roof is no refuge — walkers grab your legs from beside it', () => {
  const { stats } = perchedGame('car', 84, 42, ['walker'], { seconds: 12 });
  assert.ok(stats.firstHit >= 0 && stats.firstHit < 8, `hit after ${stats.firstHit}s`);
  assert.equal(stats.maxZ, 0, 'no need to climb a car');
});

test('zombies: walkers, runners and screamers climb up after a survivor on a container within seconds', () => {
  for (const [type, limit] of [['runner', 4], ['walker', 9], ['screamer', 8]]) {
    const { stats, c, zs } = perchedGame('container', 150, 56, [type], { seconds: 14 });
    assert.ok(stats.firstHit >= 0 && stats.firstHit < limit, `${type}: hit after ${stats.firstHit}s`);
    assert.equal(stats.maxZ, c.top, `${type}: up on the container`);
    assert.ok(stats.hits > 3, `${type}: keeps hitting`);
    assert.equal(zs[0].climbT, 0);
  }
  // even on top of a semi trailer (only reachable from a perch)
  const { stats } = perchedGame('semi', 240, 62, ['runner', 'walker'], { seconds: 12 });
  assert.ok(stats.firstHit >= 0 && stats.firstHit < 6, `semi: hit after ${stats.firstHit}s`);
});

test('zombies: crawlers and bloaters wait below; spitter acid still reaches the roof', () => {
  for (const type of ['crawler', 'bloater']) {
    const { stats } = perchedGame('container', 150, 56, [type], { seconds: 12 });
    assert.equal(stats.hits, 0, `${type}: can't get up`);
    assert.equal(stats.maxZ, 0);
  }
  const { stats } = perchedGame('container', 150, 56, ['spitter'], { seconds: 10 });
  assert.ok(stats.hits > 0, 'acid');
});

test('zombies: a brute reaches up and shoves you off a van roof', () => {
  const { p, stats } = perchedGame('van', 104, 50, ['brute'], { seconds: 20 });
  assert.ok(stats.firstHit >= 0 && stats.firstHit < 10, `hit after ${stats.firstHit}s`);
  assert.ok(stats.hits >= 2);
  assert.ok(p.z === 0 || Math.hypot(p.x - 800, p.y - 600) > 20, `shoved (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, z ${p.z})`);
});

test('zombies: once the survivor jumps down, the climbers walk off the roof after them', () => {
  const { g, p, c, zs } = perchedGame('container', 150, 56, ['runner', 'runner'], { seconds: 6 });
  assert.ok(zs.some((z) => z.z === c.top), 'runners up top');
  // the survivor steps off far away (teleported to the ground for the test)
  p.x = 800;
  p.y = 1000;
  p.zq = 0;
  p.z = 0;
  let down = false;
  for (let t = 0; t < 60 * 6 && !down; t++) {
    p.hp = p.maxHp;
    g.setInput(1, { seq: 10000 + t, moveX: 0, moveY: 0, angle: 0 });
    g.step();
    down = zs.every((z) => z.dead || z.z === 0);
  }
  assert.ok(down, `came down (${zs.map((z) => z.z).join(', ')})`);
});

test('zombies up on something are in the snapshot with their height', () => {
  const { g, zs, c } = perchedGame('container', 150, 56, ['runner'], { seconds: 5 });
  assert.equal(zs[0].z, c.top);
  const s = g.snapshot().zombies.find((z) => z.id === zs[0].id);
  assert.equal(s.z, c.top);
  const d = decodeSnapshot(encodeSnapshot(g.snapshot())).zombies.find((z) => z.id === zs[0].id);
  assert.equal(d.z, Math.round(c.top));
});

// ---- shooting from up high ---------------------------------------------------------------------

test('shooting from a roof: over the SUV next door onto the ground; from the ground at a zombie on a roof', () => {
  const map = arena([ob(0, 'container', 500, 450, 150, 56), ob(1, 'suv', 600, 450, 46, 92), ob(2, 'building', 900, 450, 60, 300)], 1200, 900);
  const g = makeGame({ map });
  const [cont, suv] = g.world.colliders;
  assert.ok(suv.ref.solid, 'an SUV stops bullets from the ground');
  const p = perch(place(g, 1, 500, 450, 0), cont);
  const behind = addZombie(g, 'walker', 700, 450);
  const w = WEAPONS.rifle;
  const shoot = (shooter, x, y, a) => fireHitscan(g, 'k' + Math.random(), 1, 0, 'rifle', { ...w, spread: 0 }, x, y, a, 1, 1, shooter);
  g.zgrid.rebuild(g.zombies, g.zombies.length);
  let hp = behind.hp;
  shoot(p, p.x, p.y, 0);
  assert.ok(behind.hp < hp, 'from the container roof, over the SUV');
  // the same shot from the ground stops at the SUV
  const q = place(g, 1, 500, 520, 0);
  q.zq = 0;
  q.z = 0;
  hp = behind.hp;
  shoot(q, 560, 450, 0);
  assert.equal(behind.hp, hp, 'from the ground the SUV is in the way');
  // a zombie standing on the container is shot from the ground; one behind it is not
  const up = addZombie(g, 'walker', 500, 450);
  up.z = cont.top;
  const hidden = addZombie(g, 'walker', 500, 540 + 200);
  g.zgrid.rebuild(g.zombies, g.zombies.length);
  hp = up.hp;
  shoot(q, 500, 250, Math.PI / 2);
  assert.ok(up.hp < hp, 'the zombie on the roof is hit');
  const h2 = hidden.hp;
  shoot(q, 500, 250, Math.PI / 2);
  assert.equal(hidden.hp, h2, 'the one on the ground behind the container is covered');
  // nothing shoots through the building, however high you stand
  const far = addZombie(g, 'walker', 1000, 450);
  g.zgrid.rebuild(g.zombies, g.zombies.length);
  const fh = far.hp;
  shoot(p, 800, 450, 0);
  assert.equal(far.hp, fh);
});

test('sim: a survivor mantles onto a car in the real game and the snapshot shows the climb', () => {
  const g = makeGame({ map: arena([ob(0, 'car', 700, 600, 84, 42)]) });
  const p = place(g, 1, 700, 520, Math.PI / 2);
  const car = g.world.colliders[0];
  const seen = [];
  run(g, 90, (game, t) => ({ 1: { moveY: 1, angle: Math.PI / 2, jump: t >= 20 && t < 24 } }), (game) => {
    const s = game.snapshot().players[0];
    seen.push({ z: s.z, climbT: s.climbT });
    return false;
  });
  assert.ok(seen.some((s) => s.climbT > 0), 'the snapshot shows the climb');
  assert.ok(seen.some((s) => s.z === car.top && !s.climbT), 'and the survivor on the roof');
  assert.ok(p.y > 600 || p.z === car.top);
  assert.ok(JUMP_TICKS > 0);
});
