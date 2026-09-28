// Jumping (SPEC §3.2): the arc, the grounded rule, vaulting low cover (and not cars or
// fences), never ending up inside something after a landing, host/client determinism
// through the wire format, the sim integration (snapshot, crawlers) and the cmd builder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionWorld, stepPlayerMovement } from '../public/js/shared/movement.js';
import { jumpHeight, stepJump, jumpClearance, JUMP_CLEAR_MAX } from '../public/js/shared/jump.js';
import { encodeSnapshot, decodeSnapshot, encodeInputs, decodeInputs, quantizeInput } from '../public/js/shared/protocol.js';
import {
  DT, PLAYER_RADIUS, STAMINA_MAX, JUMP_HEIGHT, JUMP_TIME, JUMP_COOLDOWN, JUMP_CLEAR, CRAWLER_REACH_Z,
} from '../public/js/shared/constants.js';
import { copyCmd, mergeEdges, clearEdges } from '../public/js/shared/sim/core.js';
import { downPlayer, respawnPlayer } from '../public/js/shared/sim/players.js';
import { CmdBuilder } from '../public/js/net/cmd-builder.js';
import { buildArenaMap } from './fixtures/sim-map.js';
import { bigSnapshot } from './fixtures/net-fake-game.js';
import { makeGame, place, run, addZombie, eventsOf, godMode } from './helpers/sim-helpers.js';

const R = PLAYER_RADIUS;
const AIR_TICKS = Math.round(JUMP_TIME / DT);
const COOL_TICKS = Math.round(JUMP_COOLDOWN / DT);

function player(x, y, over = {}) {
  return { x, y, state: 'alive', stamina: STAMINA_MAX, sprintLock: false, speedMult: 1, moveMult: 1, jumpT: 0, z: 0, ...over };
}

function ob(id, kind, x, y, w, h, extra = {}) {
  return { id, kind, x, y, w, h, a: 0, color: '#777', solid: false, wrecked: false, roof: null, ...extra };
}

/** Empty 1200 x 900 arena with the given obstacles (and areas). */
function arena(obstacles, areas = []) {
  return { ...buildArenaMap({ width: 1200, height: 900, objective: false }), obstacles, areas };
}

/**
 * Walk right into whatever is at x ≈ 600, stop against it, then jump while still pushing
 * right; run until well after landing. Returns the player.
 */
function vault(world, { startX = 520, y = 450, sprint = false, jump = true, speedMult = 1 } = {}) {
  const p = player(startX, y, { speedMult });
  let jumped = false, lastX = p.x;
  for (let t = 0; t < 240 && p.x < 760; t++) {
    // stopped against it (no progress on the last tick): jump, still pushing on
    const blocked = t > 2 && Math.abs(p.x - lastX) < 1e-6;
    lastX = p.x;
    const now = jump && !jumped && blocked;
    if (now) jumped = true;
    stepPlayerMovement(p, { moveX: 1, moveY: 0, sprint, jump: now }, DT, world);
  }
  // settle: a few more grounded ticks
  for (let t = 0; t < AIR_TICKS + COOL_TICKS; t++) stepPlayerMovement(p, { moveX: 0, moveY: 0 }, DT, world);
  return p;
}

test('the arc: a snappy parabola, JUMP_HEIGHT at mid-air, a whole number of ticks long', () => {
  assert.ok(JUMP_TIME >= 0.55 && JUMP_TIME <= 0.7, `airtime ${JUMP_TIME}`);
  assert.ok(JUMP_HEIGHT >= 45 && JUMP_HEIGHT <= 60, `apex ${JUMP_HEIGHT}`);
  assert.ok(Math.abs(JUMP_TIME / DT - AIR_TICKS) < 1e-9, 'airtime is whole ticks');
  assert.ok(Math.abs(JUMP_COOLDOWN / DT - COOL_TICKS) < 1e-9 && COOL_TICKS > 0, 'cooldown is whole ticks');
  assert.equal(jumpHeight(0), 0);
  assert.equal(jumpHeight(-0.05), 0);
  assert.equal(jumpHeight(JUMP_TIME), 0);
  assert.equal(jumpHeight(NaN), 0);
  assert.ok(Math.abs(jumpHeight(JUMP_TIME / 2) - JUMP_HEIGHT) < 1e-9);
  for (const t of [0.05, 0.1, 0.2, 0.25]) assert.ok(Math.abs(jumpHeight(t) - jumpHeight(JUMP_TIME - t)) < 1e-9, 'symmetric');
  // rising, then falling
  let prev = 0;
  for (let k = 1; k <= AIR_TICKS / 2; k++) {
    const z = jumpHeight(k * DT);
    assert.ok(z > prev);
    prev = z;
  }
  // every low-cover height is reachable, with room to spare
  assert.ok(JUMP_CLEAR_MAX < JUMP_HEIGHT * 0.75);
});

test('stepJump: take off only when grounded and ready, land after JUMP_TIME, then a cooldown', () => {
  const p = { state: 'alive', jumpT: 0, z: 0 };
  const hold = { jump: true };
  assert.equal(stepJump(p, hold, DT), 1, 'took off');
  assert.ok(p.z > 0 && p.jumpT > 0);
  let airborne = 1, landedAt = -1, maxZ = p.z;
  for (let t = 2; t < 200 && landedAt < 0; t++) {
    const ev = stepJump(p, hold, DT);
    assert.notEqual(ev, 1, 'no double jump while airborne');
    if (ev === -1) landedAt = t;
    else airborne++;
    maxZ = Math.max(maxZ, p.z);
  }
  assert.equal(landedAt, AIR_TICKS, 'lands exactly JUMP_TIME after take-off');
  assert.equal(airborne, AIR_TICKS - 1);
  assert.equal(p.z, 0);
  assert.ok(maxZ > JUMP_HEIGHT - 0.5 && maxZ <= JUMP_HEIGHT);
  // holding the button hops again, once the cooldown is over
  let ground = 1;
  while (stepJump(p, hold, DT) !== 1) {
    assert.equal(p.z, 0);
    ground++;
    assert.ok(ground < 50);
  }
  assert.equal(ground, COOL_TICKS, 'the landing cooldown');
  // a press in mid-air changes nothing: same arc as without it
  const a = { state: 'alive', jumpT: 0, z: 0 }, b = { state: 'alive', jumpT: 0, z: 0 };
  stepJump(a, hold, DT);
  stepJump(b, hold, DT);
  for (let t = 0; t < AIR_TICKS + 3; t++) {
    stepJump(a, { jump: t % 3 === 0 }, DT);
    stepJump(b, { jump: false }, DT);
    assert.equal(a.jumpT, b.jumpT);
  }
});

test('downed and dead survivors never take off; one downed mid-air still comes down', () => {
  const d = { state: 'downed', jumpT: 0, z: 0 };
  for (let t = 0; t < 30; t++) assert.equal(stepJump(d, { jump: true }, DT), 0);
  assert.equal(d.z, 0);
  const m = { state: 'alive', jumpT: 0, z: 0 };
  stepJump(m, { jump: true }, DT);
  for (let t = 0; t < 10; t++) stepJump(m, {}, DT);
  m.state = 'downed';
  let landed = false;
  for (let t = 0; t < AIR_TICKS && !landed; t++) landed = stepJump(m, { jump: true }, DT) === -1;
  assert.ok(landed && m.z === 0);
  for (let t = 0; t < 30; t++) assert.notEqual(stepJump(m, { jump: true }, DT), 1);
  const dead = { state: 'dead', jumpT: 0.2, z: 30 };
  stepJump(dead, { jump: true }, DT);
  assert.equal(dead.jumpT, 0);
  assert.equal(dead.z, 0);
  const w = createCollisionWorld(arena([]));
  const corpse = player(300, 300, { state: 'dead', jumpT: 0.3, z: 40 });
  stepPlayerMovement(corpse, { jump: true }, DT, w);
  assert.equal(corpse.z, 0);
});

test('jumpClearance: guard rails, jersey barriers and sandbags; nothing tall', () => {
  assert.equal(jumpClearance({ kind: 'guardrail' }), JUMP_CLEAR.guardrail);
  assert.equal(jumpClearance({ kind: 'barrier' }), JUMP_CLEAR.barrier);
  assert.equal(jumpClearance({ kind: 'sandbags' }), JUMP_CLEAR.sandbags);
  for (const kind of ['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker', 'building', 'wall', 'container',
    'pump', 'tree', 'rock', 'hesco', 'tent', 'booth', 'pillar', 'constructor', 'toString', undefined]) {
    assert.equal(jumpClearance({ kind }), Infinity, String(kind));
  }
  assert.equal(jumpClearance(null), Infinity);
  const w = createCollisionWorld({ ...arena([ob(0, 'barrier', 600, 450, 16, 300), ob(1, 'car', 800, 450, 90, 44, { solid: true })]), areas: [{ kind: 'water', x: 300, y: 200, w: 100, h: 100, a: 0 }] });
  const hops = w.colliders.map((c) => c.hop);
  assert.deepEqual(hops, [JUMP_CLEAR.barrier, Infinity, Infinity, Infinity], 'barrier, car, water, objective');
  w.setBarricades([{ x: 500, y: 700, a: 0 }]);
  assert.equal(w.barricades[0].hop, Infinity, 'player barricades are too tall to jump');
});

test('vaulting: low cover is cleared at the top of a jump; cars, fences and barricades still block', () => {
  for (const [kind, depth] of [['guardrail', 8], ['barrier', 16], ['sandbags', 24]]) {
    const world = createCollisionWorld(arena([ob(0, kind, 600, 450, depth, 600)]));
    const stuck = vault(world, { jump: false });
    assert.ok(stuck.x < 600 - depth / 2 - R + 0.5, `${kind}: walking into it stops you (${stuck.x})`);
    const p = vault(world);
    assert.ok(p.x > 600 + depth / 2 + R, `${kind}: jumped over (${p.x.toFixed(1)})`);
    assert.ok(!world.circleBlockedAt(p.x, p.y, R, 0), `${kind}: landed clear`);
    // heavy guns slow you down: the widest cover then wants a sprint
    const sprinted = vault(world, { sprint: true, speedMult: 0.8 });
    assert.ok(sprinted.x > 600 + depth / 2 + R, `${kind}: sprinting with a heavy gun clears it too`);
  }
  for (const [what, o] of [
    ['a sedan', ob(0, 'car', 640, 450, 90, 600, { solid: true })],
    ['a chain-link fence', ob(0, 'wall', 600, 450, 6, 600)],
    ['a hesco wall', ob(0, 'hesco', 620, 450, 40, 600, { solid: true })],
  ]) {
    const world = createCollisionWorld(arena([o]));
    const p = vault(world);
    assert.ok(p.x < o.x - o.w / 2, `${what} blocks a jump (${p.x.toFixed(1)})`);
  }
  const world = createCollisionWorld(arena([]));
  world.setBarricades([{ x: 600, y: 450, a: Math.PI / 2 }]);
  const p = vault(world, { y: 450 });
  assert.ok(p.x < 600, `a player barricade blocks a jump (${p.x.toFixed(1)})`);
});

test('landing on low cover wedged against something tall never leaves you inside either', () => {
  // A gap narrower than a player behind the rail: the shortest push-out bounces between
  // the rail and the blocker; the landing walks out to the nearest free spot instead.
  const cases = [
    ['a car 20 px behind a guard rail', [ob(0, 'guardrail', 600, 450, 10, 400), ob(1, 'car', 672, 450, 94, 400, { solid: true })], []],
    ['water right behind sandbags', [ob(0, 'sandbags', 600, 450, 24, 400)], [{ kind: 'water', x: 700, y: 450, w: 160, h: 400, a: 0 }]],
    ['the map edge behind a guard rail', [ob(0, 'guardrail', 1185, 450, 10, 400)], []],
  ];
  for (const [what, obstacles, areas] of cases) {
    const world = createCollisionWorld(arena(obstacles, areas));
    const startX = obstacles[0].x - 80;
    for (const sprint of [false, true]) {
      const p = player(startX, 450);
      let jumpedAt = -1;
      for (let t = 0; t < 200; t++) {
        const jump = jumpedAt < 0 && p.x > obstacles[0].x - 40;
        if (jump) jumpedAt = t;
        stepPlayerMovement(p, { moveX: 1, moveY: 0, sprint, jump }, DT, world);
        if (p.z === 0 || p.z < JUMP_CLEAR_MAX) {
          // whenever the feet are low, the player overlaps nothing it can't clear
          assert.ok(!world.circleBlockedAt(p.x, p.y, R - 0.01, p.z), `${what}: inside something at tick ${t} (${p.x.toFixed(2)}, z ${p.z.toFixed(1)})`);
        }
      }
      assert.ok(jumpedAt >= 0, `${what}: jumped`);
      assert.ok(!world.circleBlockedAt(p.x, p.y, R - 0.01, 0), `${what}: stuck at ${p.x.toFixed(2)}`);
    }
  }
  // the search itself: a circle dropped inside a pocket goes to the nearest free spot
  const w = createCollisionWorld(arena([ob(0, 'guardrail', 600, 450, 10, 400), ob(1, 'car', 672, 450, 94, 400, { solid: true })]));
  const pos = { x: 608, y: 450 };
  assert.ok(w.circleBlockedAt(pos.x, pos.y, R, 0));
  assert.ok(w.unstick(pos, R, 0));
  assert.ok(!w.circleBlockedAt(pos.x, pos.y, R, 0));
  assert.ok(pos.x < 600 && Math.abs(pos.y - 450) < 1e-9, `back out on the open side (${pos.x}, ${pos.y})`);
  assert.equal(w.unstick(pos, R, 0), false, 'a free circle stays put');
});

test('prediction: a client replaying from any snapshot mid-jump lands where the host does', () => {
  const world = createCollisionWorld(arena([ob(0, 'barrier', 600, 450, 16, 600), ob(1, 'sandbags', 760, 450, 24, 600)]));
  // scripted inputs: run right, sprint in bursts, jump a few times (as the wire delivers them)
  const cmds = [];
  for (let i = 0; i < 260; i++) {
    const c = quantizeInput({
      seq: i + 1, moveX: 1, moveY: Math.sin(i / 23) * 0.3, angle: 0,
      sprint: i % 90 < 40, jump: i === 12 || (i >= 70 && i < 74) || i === 150 || i > 200,
    });
    cmds.push(decodeInputs(encodeInputs([c]))[0]);
  }
  const host = player(520, 450);
  const states = [];
  for (const c of cmds) {
    stepPlayerMovement(host, c, DT, world);
    states.push({ ...host });
  }
  assert.ok(host.x > 780, `the host player got over both (${host.x.toFixed(1)})`);
  // A client acknowledged at tick k rebuilds its player from the snapshot and replays the rest.
  let airborneAcks = 0, cooldownAcks = 0;
  for (let k = 0; k < cmds.length - 1; k += 1) {
    const s = states[k];
    const snap = { ...bigSnapshot(0), players: [{ ...bigSnapshot(0).players[0], x: s.x, y: s.y, stamina: s.stamina, sprintLock: s.sprintLock, jumpT: s.jumpT, z: s.z }] };
    const d = decodeSnapshot(encodeSnapshot(snap)).players[0];
    assert.equal(Math.round(d.jumpT / DT), Math.round(s.jumpT / DT), 'jump state travels in whole ticks');
    assert.ok(Math.abs(d.z - s.z) < 1e-9, 'z follows from it');
    if (s.jumpT > 0) airborneAcks++;
    if (s.jumpT < 0) cooldownAcks++;
    const c = player(d.x, d.y, { stamina: d.stamina, sprintLock: d.sprintLock, jumpT: d.jumpT, z: d.z });
    for (let i = k + 1; i < cmds.length; i++) {
      stepPlayerMovement(c, cmds[i], DT, world);
      assert.equal(Math.round(c.jumpT / DT), Math.round(states[i].jumpT / DT), `ack ${k}: jump state at tick ${i}`);
    }
    assert.ok(Math.abs(c.x - host.x) < 0.01 && Math.abs(c.y - host.y) < 0.01, `ack ${k}: ${c.x},${c.y} vs ${host.x},${host.y}`);
    assert.equal(c.z, host.z);
  }
  assert.ok(airborneAcks > 40 && cooldownAcks > 5, 'acks landed in the air and in the cooldown');
});

test('protocol: the jump bit and the jump state round-trip', () => {
  const [a, b] = decodeInputs(encodeInputs([{ seq: 1, jump: true }, { seq: 2, jump: false, reload: true }]));
  assert.equal(a.jump, true);
  assert.equal(b.jump, false);
  assert.equal(b.reload, true);
  for (const ticks of [0, 1, 17, AIR_TICKS - 1, -1, -COOL_TICKS]) {
    const p = { ...bigSnapshot(0).players[0], jumpT: ticks * DT, z: jumpHeight(ticks * DT) };
    const d = decodeSnapshot(encodeSnapshot({ ...bigSnapshot(0), players: [p] })).players[0];
    assert.ok(Math.abs(d.jumpT - ticks * DT) < 1e-12, `${ticks} ticks`);
    assert.ok(Math.abs(d.z - p.z) < 1e-9);
  }
  // senders without the fields (older fixtures): on the ground
  const { jumpT, z, ...bare } = bigSnapshot(0).players[0];
  const d = decodeSnapshot(encodeSnapshot({ ...bigSnapshot(0), players: [bare] })).players[0];
  assert.equal(d.jumpT, 0);
  assert.equal(d.z, 0);
  assert.ok(jumpT !== undefined && z !== undefined);
});

test('input queue: a dropped cmd keeps its jump, a repeated one never jumps again', () => {
  const c = copyCmd({ seq: 3, jump: 1 });
  assert.equal(c.jump, true);
  assert.equal(copyCmd({ seq: 4 }).jump, false);
  const into = copyCmd({ seq: 5 });
  mergeEdges(into, c);
  assert.equal(into.jump, true);
  assert.equal(clearEdges(copyCmd({ jump: true })).jump, false);
});

test('cmd builder: jump while held, and a tap between two ticks reaches exactly one cmd', () => {
  const b = new CmdBuilder();
  b.feed({ jump: true }, 0);
  assert.equal(b.next().jump, true);
  assert.equal(b.next().jump, true, 'held');
  b.feed({ jump: false }, 0);
  assert.equal(b.next().jump, false);
  // pressed in a frame that produced no cmd, released before the next one
  b.feed({ jump: true }, 0);
  b.feed({ jump: false }, 0);
  assert.equal(b.next().jump, true, 'carried over');
  assert.equal(b.next().jump, false, 'once');
  b.feed({ jump: true }, 0);
  assert.equal(b.idle().jump, false, 'stale input never jumps');
  b.feed({ jump: false }, 0);
  assert.equal(b.next().jump, false, 'the latched tap died with the stale input');
  b.feed({ jump: true }, 0);
  b.reset();
  assert.equal(b.next().jump, false);
});

test('sim: jumping a jersey barrier, the snapshot shows the arc, respawn/death reset it', () => {
  const map = arena([ob(0, 'barrier', 700, 600, 16, 500)]);
  const g = makeGame({ map });
  godMode(g);
  const p = place(g, 1, 600, 600, 0);
  // run into the barrier, jump against it
  const zs = [];
  run(g, 150, (game, t) => ({ 1: { moveX: 1, jump: t === 30 } }), (game) => {
    const s = game.snapshot().players[0];
    zs.push(s.z);
    return false;
  });
  assert.ok(p.x > 700 + 8 + R, `over the barrier (${p.x.toFixed(1)})`);
  const top = Math.max(...zs);
  assert.ok(top > JUMP_HEIGHT - 1 && top <= JUMP_HEIGHT, `snapshot z peaks at ${top}`);
  assert.equal(zs[zs.length - 1], 0);
  const snap = g.snapshot().players[0];
  assert.ok('z' in snap && 'jumpT' in snap);
  // downed mid-air: comes down and never takes off again
  run(g, 5, () => ({ 1: { jump: true } }));
  assert.ok(p.z > 0);
  downPlayer(g, p);
  run(g, AIR_TICKS + 30, () => ({ 1: { jump: true } }));
  assert.equal(p.state, 'downed');
  assert.equal(p.z, 0);
  // respawned: on the ground
  p.jumpT = 0.2;
  respawnPlayer(g, p, 0);
  assert.equal(p.jumpT, 0);
  assert.equal(p.z, 0);
});

test('sim: two games with the same jumping inputs stay identical', () => {
  const mk = () => makeGame({ n: 2, map: arena([ob(0, 'sandbags', 700, 600, 24, 500), ob(1, 'guardrail', 820, 560, 8, 400)]) });
  const a = mk(), b = mk();
  const inputs = (g, t) => ({
    1: { moveX: Math.cos(t / 30), moveY: Math.sin(t / 45), sprint: t % 100 < 50, jump: t % 37 < 3 },
    2: { moveX: 1, moveY: 0, jump: t > 40 },
  });
  run(a, 600, inputs);
  run(b, 600, inputs);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(a.players.some((p) => p.x > 720), 'someone crossed the cover');
});

test('sim: crawlers bite at ankle height — they miss a survivor in the air, walkers do not', () => {
  const hits = (type, airborne) => {
    const g = makeGame({ n: 1 });
    const p = place(g, 1, 800, 600, 0);
    addZombie(g, type, 800 + R + 12, 600);
    let n = 0;
    for (let t = 0; t < 360; t++) {
      godMode(g);
      // keep the survivor at the top of a jump (the sim advances it one tick per step)
      if (airborne) p.jumpT = JUMP_TIME / 2;
      g.setInput(1, { seq: t + 1, moveX: 0, moveY: 0, angle: 0 });
      g.step();
      if (airborne) assert.ok(p.z > CRAWLER_REACH_Z);
      n += eventsOf(g.snapshot().events, 'pdamage').filter((e) => e.pid === 1).length;
    }
    return n;
  };
  assert.ok(hits('crawler', false) > 0, 'a crawler bites a survivor on the ground');
  assert.equal(hits('crawler', true), 0, 'but not one in the air');
  assert.ok(hits('walker', true) > 0, 'a walker still reaches a jumping survivor');
});
