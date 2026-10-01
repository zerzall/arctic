// Wire protocol (SPEC §5): every Snapshot and InputCmd field survives a round trip within
// its quantisation, every event type is carried, odd inputs never crash the encoder, the
// size budget holds, and mismatched versions fail loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSnapshot, decodeSnapshot, encodeInputs, decodeInputs, quantizeInput, messageType, MSG,
  EVENT_TYPES,
} from '../public/js/shared/protocol.js';
import { PROTOCOL_VERSION } from '../public/js/shared/constants.js';
import { angleDiff } from '../public/js/shared/math.js';
import { ZFLAG } from '../public/js/shared/zombies.js';
import { bigSnapshot, sampleEvents, samplePlayer } from './fixtures/net-fake-game.js';

const SPEC_EVENT_TYPES = ['shot', 'chain', 'melee', 'zdie', 'zattack', 'spit', 'scream', 'charge', 'slam',
  'explosion', 'ignite', 'pdamage', 'down', 'revived', 'died', 'respawn', 'pickup', 'buy', 'buyfail',
  'reload', 'switch', 'empty', 'throw', 'place', 'destroyed', 'objhit', 'wave', 'bossspawn', 'waveclear',
  'drop', 'gameover', 'victory'];

function near(actual, expected, tol, what) {
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} vs ${expected} (tol ${tol})`);
}

function nearAngle(actual, expected, tol, what) {
  assert.ok(Math.abs(angleDiff(expected, actual)) <= tol, `${what}: ${actual} vs ${expected}`);
}

const ANG16 = Math.PI * 2 / 65536;
const ANG8 = Math.PI * 2 / 256;
const U8 = 1 / 255 / 2 + 1e-9;

function checkPlayer(d, s) {
  const w = `player ${s.id}`;
  assert.equal(d.id, s.id);
  near(d.x, s.x, 0.001, `${w} x`);
  near(d.y, s.y, 0.001, `${w} y`);
  nearAngle(d.angle, s.angle, ANG16, `${w} angle`);
  assert.equal(d.state, s.state);
  near(d.hp, s.hp, 0.05, `${w} hp`);
  near(d.maxHp, s.maxHp, 0.05, `${w} maxHp`);
  near(d.armor, s.armor, 0.05, `${w} armor`);
  near(d.stamina, s.stamina, 0.005, `${w} stamina`);
  assert.equal(d.sprinting, s.sprinting);
  assert.equal(d.slot, s.slot);
  assert.deepEqual(d.slots, s.slots);
  assert.deepEqual(d.ammo, s.ammo);
  near(d.reloading, s.reloading, 1 / 255, `${w} reloading`);
  assert.equal(d.reloading > 0, s.reloading > 0, `${w} reloading stays non-zero`);
  near(d.spin, s.spin, U8, `${w} spin`);
  assert.equal(d.firing, s.firing);
  near(d.meleeing, s.meleeing, 1 / 255, `${w} meleeing`);
  assert.equal(d.meleeing > 0, s.meleeing > 0, `${w} meleeing stays non-zero`);
  for (const k of ['cash', 'kills', 'damage', 'revives', 'downs', 'frags', 'molotovs', 'turrets',
    'barricades', 'reviver', 'lastSeq']) {
    assert.equal(d[k], s[k], `${w} ${k}`);
  }
  if (s.earned !== undefined) assert.equal(d.earned, s.earned);
  assert.equal(d.selfRevive, s.selfRevive);
  near(d.bleedout, s.bleedout, 0.005, `${w} bleedout`);
  near(d.revive, s.revive, U8, `${w} revive`);
  assert.equal(d.respawn, s.respawn);
  assert.equal(d.ready, s.ready);
  assert.equal(d.sprintLock, !!s.sprintLock, `${w} sprintLock`);
  // vertical state: exact integers; z follows from zq
  for (const k of ['zq', 'vzq', 'jumpCd', 'climbT']) assert.equal(d[k], s[k] || 0, `${w} ${k}`);
  assert.equal(d.climbTo, s.climbT > 0 ? s.climbTo : -1, `${w} climbTo`);
  near(d.z, s.z || 0, 1e-6, `${w} z`);
}

function checkEvent(d, s) {
  assert.equal(d.type, s.type);
  assert.deepEqual(Object.keys(d).sort(), Object.keys(s).sort(), `${s.type} keys`);
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (k === 'angle') nearAngle(d[k], v, ANG16, `${s.type}.angle`);
    else if (typeof v === 'number') near(d[k], v, 0.26, `${s.type}.${k}`);
    else if (Array.isArray(v)) {
      assert.equal(d[k].length, v.length, `${s.type}.${k} length`);
      v.forEach((pt, i) => {
        near(d[k][i].x, pt.x, 0.26, `${s.type}.${k}[${i}].x`);
        near(d[k][i].y, pt.y, 0.26, `${s.type}.${k}[${i}].y`);
        if ('hit' in pt) assert.equal(d[k][i].hit, pt.hit);
      });
    } else assert.deepEqual(d[k], v, `${s.type}.${k}`);
  }
}

function checkSnapshot(d, s) {
  for (const k of ['tick', 'phase', 'wave', 'totalWaves', 'remaining', 'readyCount']) assert.equal(d[k], s[k], k);
  near(d.timer, s.timer, 0.005, 'timer');
  if (s.bossHp < 0) assert.equal(d.bossHp, -1);
  else near(d.bossHp, s.bossHp, 1e-4, 'bossHp');
  if (s.objective) {
    near(d.objective.hp, s.objective.hp, 0.01, 'objective.hp');
    near(d.objective.maxHp, s.objective.maxHp, 0.01, 'objective.maxHp');
  } else {
    assert.equal(d.objective, null);
  }
  assert.equal(d.players.length, s.players.length);
  s.players.forEach((p, i) => checkPlayer(d.players[i], p));
  assert.equal(d.zombies.length, s.zombies.length);
  s.zombies.forEach((z, i) => {
    const e = d.zombies[i];
    assert.equal(e.id, z.id);
    assert.equal(e.type, z.type);
    near(e.x, z.x, 0.125, 'zombie x');
    near(e.y, z.y, 0.125, 'zombie y');
    nearAngle(e.angle, z.angle, ANG8, 'zombie angle');
    near(e.hp, z.hp, U8, 'zombie hp');
    assert.equal(e.flags, z.flags);
    near(e.z, Math.min(255, z.z || 0), 0.5, 'zombie z');
  });
  assert.equal(d.projectiles.length, s.projectiles.length);
  s.projectiles.forEach((p, i) => {
    const e = d.projectiles[i];
    assert.equal(e.id, p.id);
    assert.equal(e.kind, p.kind);
    near(e.x, p.x, 0.125, 'projectile x');
    near(e.y, p.y, 0.125, 'projectile y');
    nearAngle(e.angle, p.angle, ANG8, 'projectile angle');
  });
  assert.equal(d.pickups.length, s.pickups.length);
  s.pickups.forEach((p, i) => {
    const e = d.pickups[i];
    assert.equal(e.id, p.id);
    assert.equal(e.kind, p.kind);
    near(e.x, p.x, 0.125, 'pickup x');
    near(e.y, p.y, 0.125, 'pickup y');
    assert.equal(e.weapon, p.weapon);
  });
  assert.equal(d.turrets.length, s.turrets.length);
  s.turrets.forEach((t, i) => {
    const e = d.turrets[i];
    assert.equal(e.id, t.id);
    assert.equal(e.owner, t.owner);
    near(e.x, t.x, 0.125, 'turret x');
    near(e.y, t.y, 0.125, 'turret y');
    nearAngle(e.angle, t.angle, ANG16, 'turret angle');
    near(e.hp, t.hp, U8, 'turret hp');
    near(e.ammo, t.ammo, U8, 'turret ammo');
    assert.equal(e.firing, t.firing);
  });
  assert.equal(d.barricades.length, s.barricades.length);
  s.barricades.forEach((b, i) => {
    const e = d.barricades[i];
    assert.equal(e.id, b.id);
    assert.equal(e.owner, b.owner);
    near(e.x, b.x, 0.001, 'barricade x');
    near(e.y, b.y, 0.001, 'barricade y');
    nearAngle(e.angle, b.angle, ANG16, 'barricade angle');
    near(e.hp, b.hp, U8, 'barricade hp');
  });
  assert.equal(d.hazards.length, s.hazards.length);
  s.hazards.forEach((h, i) => {
    const e = d.hazards[i];
    assert.equal(e.id, h.id);
    assert.equal(e.kind, h.kind);
    near(e.x, h.x, 0.125, 'hazard x');
    near(e.y, h.y, 0.125, 'hazard y');
    near(e.r, h.r, 0.05, 'hazard r');
    near(e.life, h.life, U8, 'hazard life');
  });
  assert.equal(d.events.length, s.events.length);
  s.events.forEach((ev, i) => checkEvent(d.events[i], ev));
}

test('snapshot round-trips every field of a busy snapshot', () => {
  const snap = bigSnapshot(60);
  const buf = encodeSnapshot(snap);
  assert.ok(buf instanceof ArrayBuffer);
  assert.equal(messageType(buf), MSG.SNAPSHOT);
  checkSnapshot(decodeSnapshot(buf), snap);
});

test('size budget: 6 players + 250 zombies + 60 events < 14 KB', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const bytes = encodeSnapshot(bigSnapshot(60, seed)).byteLength;
    assert.ok(bytes < 14 * 1024, `snapshot is ${bytes} bytes`);
  }
});

test('every SPEC event type has a compact encoding and round-trips', () => {
  for (const t of SPEC_EVENT_TYPES) assert.ok(EVENT_TYPES.includes(t), `no schema for ${t}`);
  const events = sampleEvents();
  const covered = new Set(events.map((e) => e.type));
  for (const t of SPEC_EVENT_TYPES) assert.ok(covered.has(t), `fixture lacks ${t}`);
  const snap = { ...bigSnapshot(0), events };
  const d = decodeSnapshot(encodeSnapshot(snap));
  events.forEach((ev, i) => checkEvent(d.events[i], ev));
});

test('reload time is carried compactly to the millisecond', () => {
  const events = [
    { type: 'reload', pid: 3, weapon: 'rifle', time: 1.615 },
    { type: 'reload', pid: 3, weapon: 'minigun', time: 5 },
  ];
  const base = encodeSnapshot({ ...bigSnapshot(0), events: [] }).byteLength;
  const buf = encodeSnapshot({ ...bigSnapshot(0), events });
  assert.ok(buf.byteLength - base <= 2 * 6, 'binary, not JSON');
  const d = decodeSnapshot(buf);
  assert.deepEqual(d.events, events);
  // Without a time (older senders) it still arrives, as JSON.
  const old = decodeSnapshot(encodeSnapshot({ ...bigSnapshot(0), events: [{ type: 'reload', pid: 1, weapon: 'pistol' }] }));
  assert.deepEqual(old.events, [{ type: 'reload', pid: 1, weapon: 'pistol' }]);
});

test('the new guns: weapon ids, frost flags, flare/frost/harpoon projectiles, flare hazards and freeze events', () => {
  const guns = ['flare', 'tommy', 'burst_rifle', 'lever', 'chainsaw', 'harpoon', 'cryo', 'amr'];
  const players = guns.map((g, i) => ({ ...samplePlayer(i + 1), slot: 1, slots: ['pistol', g, i % 2 ? 'amr' : null], ammo: [[12, -1], [3, g === 'chainsaw' ? -1 : 40], i % 2 ? [5, 30] : [0, 0]] }));
  const snap = {
    ...bigSnapshot(0),
    players,
    zombies: [
      { id: 1, type: 'walker', x: 100, y: 200, angle: 1, hp: 0.5, flags: ZFLAG.SLOWED },
      { id: 2, type: 'brute', x: 300, y: 200, angle: 2, hp: 1, flags: ZFLAG.SLOWED | ZFLAG.FROZEN | ZFLAG.ELITE },
    ],
    projectiles: [
      { id: 1, kind: 'flare', x: 10, y: 20, angle: 0.5 },
      { id: 2, kind: 'frost', x: 30, y: 40, angle: 1.5 },
      { id: 3, kind: 'harpoon', x: 50, y: 60, angle: 2.5 },
    ],
    hazards: [{ id: 4, kind: 'flare', x: 400, y: 500, r: 52, life: 0.75 }],
    pickups: [{ id: 5, kind: 'crate', x: 1, y: 2, weapon: 'chainsaw' }],
    events: [
      { type: 'freeze', id: 2, x: 300, y: 200 },
      { type: 'shot', pid: 1, turret: 0, weapon: 'chainsaw', x: 10, y: 20, angle: Math.PI / 2, rays: [{ x: 40, y: 22, hit: 1 }] },
      { type: 'shot', pid: 2, turret: 0, weapon: 'amr', x: 10, y: 20, angle: 0, rays: [{ x: 1040, y: 20, hit: 1 }] },
      { type: 'reload', pid: 3, weapon: 'lever', time: 0.42 },
      { type: 'switch', pid: 4, weapon: 'burst_rifle' },
      { type: 'pickup', pid: 5, kind: 'crate', x: 1, y: 2, weapon: 'harpoon' },
    ],
  };
  const base = encodeSnapshot({ ...snap, events: [] }).byteLength;
  const buf = encodeSnapshot(snap);
  const d = decodeSnapshot(buf);
  d.players.forEach((p, i) => checkPlayer(p, players[i]));
  assert.deepEqual(d.zombies.map((z) => z.flags), [ZFLAG.SLOWED, ZFLAG.SLOWED | ZFLAG.FROZEN | ZFLAG.ELITE]);
  assert.deepEqual(d.projectiles.map((p) => p.kind), ['flare', 'frost', 'harpoon']);
  assert.equal(d.hazards[0].kind, 'flare');
  near(d.hazards[0].r, 52, 0.05, 'flare radius');
  assert.equal(d.pickups[0].weapon, 'chainsaw');
  assert.deepEqual(d.events, snap.events);
  assert.ok(EVENT_TYPES.includes('freeze'));
  assert.ok(buf.byteLength - base < 80, 'all binary, no JSON');
  assert.ok(PROTOCOL_VERSION >= 8, 'the block layouts of 8 are still part of every later protocol');
});

test('sprintLock round-trips both ways', () => {
  for (const lock of [true, false]) {
    const p = { ...samplePlayer(4), sprintLock: lock };
    const d = decodeSnapshot(encodeSnapshot({ ...bigSnapshot(0), players: [p] }));
    assert.equal(d.players[0].sprintLock, lock);
  }
});

test('unknown events and events that do not fit their schema travel as JSON', () => {
  const events = [
    { type: 'mystery', foo: 'bar', n: 1.23456, nested: { a: [1, 2] } },
    { type: 'down', pid: 3, extra: 'field' },
    { type: 'pickup', pid: 2, kind: 'rainbow', x: 1, y: 2, weapon: null },
    { type: 'buy', pid: 1, item: 'x'.repeat(200) },
    { type: 'pdamage', pid: 1, amount: 99999, x: 1, y: 1 },
    { type: 'switch', pid: 1, weapon: 'laser_sword' },
  ];
  const d = decodeSnapshot(encodeSnapshot({ ...bigSnapshot(0), events }));
  assert.deepEqual(d.events[0], { type: 'mystery', foo: 'bar', n: 1.23, nested: { a: [1, 2] } });
  assert.deepEqual(d.events[1], events[1]);
  assert.deepEqual(d.events[2], events[2]);
  assert.deepEqual(d.events[3], events[3]);
  assert.deepEqual(d.events[4], events[4]);
  assert.deepEqual(d.events[5], events[5]);
});

test('empty snapshot: no entities, no events, no objective, no boss', () => {
  const snap = {
    tick: 0, phase: 'prep', wave: 0, totalWaves: 0, timer: 20, remaining: 0, bossHp: -1, objective: null,
    readyCount: 0, players: [], zombies: [], projectiles: [], pickups: [], turrets: [], barricades: [],
    hazards: [], events: [],
  };
  const d = decodeSnapshot(encodeSnapshot(snap));
  checkSnapshot(d, snap);
  assert.equal(d.echo, undefined);
  assert.ok(encodeSnapshot(snap).byteLength < 64);
});

test('missing arrays and garbage values never crash the encoder', () => {
  const d = decodeSnapshot(encodeSnapshot({ tick: 5, phase: 'nonsense', players: [{ id: 1, x: NaN, y: Infinity }] }));
  assert.equal(d.tick, 5);
  assert.equal(d.players.length, 1);
  assert.equal(d.players[0].x, 0);
  assert.deepEqual(d.zombies, []);
  assert.deepEqual(d.events, []);
});

test('extreme values clamp or survive', () => {
  const p = samplePlayer(255);
  Object.assign(p, {
    x: -900.5, y: 15999.25, angle: 17.5, hp: 6553.5, maxHp: 1000, stamina: 100, state: 'downed',
    cash: 0xffffffff, kills: 4e9, damage: 4.2e9, lastSeq: 0xffffffff, slot: 2,
    slots: [null, null, 'railgun'], ammo: [[0, 0], [0, 0], [65535, 65534]],
    reloading: 0.0001, meleeing: 1e-6, spin: 1, revive: 1, bleedout: 30,
  });
  const snap = {
    tick: 0xffffffff, phase: 'victory', wave: 65535, totalWaves: 0, timer: 655.35, remaining: 1e6, bossHp: 1,
    objective: { hp: 0, maxHp: 123456 }, readyCount: 6,
    players: [p],
    zombies: [
      { id: 65535, type: 'boss', x: -1024, y: 15359.75, angle: -Math.PI, hp: 1, flags: 31 },
      { id: 0, type: 'walker', x: 0, y: 0, angle: Math.PI, hp: 0, flags: 0 },
    ],
    projectiles: [{ id: 65535, kind: 'acid', x: 12, y: 13, angle: 100 }],
    pickups: [{ id: 1, kind: 'frag', x: 1, y: 1, weapon: null }],
    turrets: [{ id: 9, owner: 255, x: 1, y: 1, angle: -7, hp: 0, ammo: 1, firing: false }],
    barricades: [{ id: 2, owner: 1, x: 3999.123, y: 0.001, angle: 3.14159, hp: 1 }],
    hazards: [{ id: 3, kind: 'acid', x: 1, y: 2, r: 6553.5, life: 0 }],
    events: [],
  };
  checkSnapshot(decodeSnapshot(encodeSnapshot(snap)), snap);

  // Out-of-range values clamp instead of wrapping.
  const clamp = decodeSnapshot(encodeSnapshot({
    ...snap,
    zombies: [{ id: 70000, type: 'walker', x: -5000, y: 99999, angle: 0, hp: 7, flags: 0 }],
    players: [{ ...p, hp: -5, reloading: 3 }],
    bossHp: 5,
  }));
  assert.equal(clamp.zombies[0].id, 65535);
  assert.equal(clamp.zombies[0].x, -1024);
  assert.equal(clamp.zombies[0].y, 15359.75);
  assert.equal(clamp.zombies[0].hp, 1);
  assert.equal(clamp.players[0].hp, 0);
  assert.equal(clamp.players[0].reloading, 1);
  assert.equal(clamp.bossHp, 1);
});

test('netcode extras: match counter and echoed events', () => {
  const snap = { ...bigSnapshot(3), match: 7, echo: [{ tick: 120, events: sampleEvents().slice(0, 4) }, { tick: 123, events: [] }] };
  const d = decodeSnapshot(encodeSnapshot(snap));
  assert.equal(d.match, 7);
  assert.equal(d.echo.length, 2);
  assert.equal(d.echo[0].tick, 120);
  snap.echo[0].events.forEach((ev, i) => checkEvent(d.echo[0].events[i], ev));
  assert.deepEqual(d.echo[1].events, []);
});

test('encoded buffers are independent (the writer is reused internally)', () => {
  const a = encodeSnapshot(bigSnapshot(5, 1));
  const copy = new Uint8Array(a).slice();
  encodeSnapshot(bigSnapshot(60, 2));
  assert.deepEqual(new Uint8Array(a), copy);
});

test('decoding accepts typed-array views (Node Buffers, subarrays)', () => {
  const buf = encodeSnapshot(bigSnapshot(10));
  const padded = new Uint8Array(buf.byteLength + 7);
  padded.set(new Uint8Array(buf), 5);
  const view = padded.subarray(5, 5 + buf.byteLength);
  assert.equal(decodeSnapshot(view).zombies.length, 250);
  assert.equal(decodeSnapshot(Buffer.from(buf)).players.length, 6);
});

test('wrong version, wrong tag and truncated buffers throw', () => {
  const buf = encodeSnapshot(bigSnapshot(10));
  const bad = new Uint8Array(buf.slice(0));
  bad[1] = PROTOCOL_VERSION + 1;
  assert.throws(() => decodeSnapshot(bad.buffer), /version mismatch/i);
  const inputs = encodeInputs([{ seq: 1 }]);
  assert.throws(() => decodeSnapshot(inputs), /message type/i);
  assert.throws(() => decodeInputs(buf), /message type/i);
  assert.throws(() => decodeSnapshot(buf.slice(0, buf.byteLength - 10)));
  assert.throws(() => decodeSnapshot(new ArrayBuffer(0)));
  assert.equal(messageType(new ArrayBuffer(0)), -1);
  assert.equal(messageType('hello'), -1);
});

function cmd(seq, over = {}) {
  return {
    seq, moveX: 0.6, moveY: -0.8, angle: 2.5, fire: true, melee: false, sprint: true, interact: false,
    reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false,
    slot: -1, cycle: 0, jump: false, ...over,
  };
}

test('inputs round-trip every InputCmd field', () => {
  const edges = ['reload', 'frag', 'molotov', 'turret', 'barricade', 'lastWeapon', 'fire', 'melee', 'sprint', 'interact', 'jump'];
  const cmds = edges.map((e, i) => {
    const c = cmd(1000 + i, { fire: false, sprint: false, slot: i % 4 - 1, cycle: (i % 3) - 1, moveX: -1 + i * 0.2, moveY: 0.1 * i - 0.5, angle: -3 + i * 0.6 });
    c[e] = true;
    return c;
  }).slice(-4);
  const buf = encodeInputs(cmds);
  assert.equal(messageType(buf), MSG.INPUTS);
  const d = decodeInputs(buf);
  assert.equal(d.length, cmds.length);
  cmds.forEach((c, i) => {
    const e = d[i];
    assert.equal(e.seq, c.seq);
    near(e.moveX, c.moveX, 0.5 / 127 + 1e-9, 'moveX');
    near(e.moveY, c.moveY, 0.5 / 127 + 1e-9, 'moveY');
    nearAngle(e.angle, c.angle, ANG16, 'angle');
    for (const k of edges) assert.equal(e[k], c[k], k);
    assert.equal(e.slot, c.slot);
    assert.equal(e.cycle, c.cycle);
  });
  assert.ok(buf.byteLength <= 3 + 4 * 12);
});

test('inputs: at most MAX_INPUTS_PER_MESSAGE newest cmds, extremes, empty list', () => {
  const many = Array.from({ length: 20 }, (_, i) => cmd(i + 1));
  const d = decodeInputs(encodeInputs(many));
  assert.equal(d.length, 8);
  assert.equal(d[0].seq, 13);
  assert.equal(d[7].seq, 20);
  assert.deepEqual(decodeInputs(encodeInputs([])), []);
  const [x] = decodeInputs(encodeInputs([cmd(0xffffffff, { moveX: 5, moveY: -Infinity, angle: NaN, slot: 2, cycle: 9 })]));
  assert.equal(x.seq, 0xffffffff);
  assert.equal(x.moveX, 1);
  assert.equal(x.moveY, 0);
  assert.equal(x.slot, 2);
  assert.equal(x.cycle, 1);
});

test('quantizeInput matches what the host decodes exactly', () => {
  for (let i = 0; i < 200; i++) {
    const c = cmd(i + 1, { moveX: Math.sin(i * 1.7), moveY: Math.cos(i * 2.3), angle: i * 0.37 - 30 });
    const [host] = decodeInputs(encodeInputs([c]));
    const local = quantizeInput({ ...c });
    assert.equal(local.moveX, host.moveX);
    assert.equal(local.moveY, host.moveY);
    assert.equal(local.angle, host.angle);
    // Idempotent: quantising twice changes nothing.
    const again = quantizeInput({ ...local });
    assert.equal(again.moveX, local.moveX);
    assert.equal(again.angle, local.angle);
  }
});

test('a snapshot produced by the real Game after a few hundred ticks round-trips', async (t) => {
  let Game;
  try {
    ({ Game } = await import('../public/js/shared/sim.js'));
  } catch (err) {
    t.skip(`shared/sim.js not loadable: ${err.message}`);
    return;
  }
  const players = [1, 2, 3].map((id) => ({ id, name: `P${id}`, color: id - 1, cls: ['soldier', 'demo', 'engineer'][id - 1] }));
  const game = new Game({ mapId: 'highway', seed: 99, settings: { difficulty: 'hard', waves: 10, objective: true, friendlyFire: false }, players });
  let seq = 0;
  let checked = 0;
  for (let tick = 0; tick < 1500; tick++) {
    for (const p of players) {
      game.setInput(p.id, cmd(++seq, {
        moveX: Math.sin(tick / 40 + p.id), moveY: Math.cos(tick / 50 + p.id), angle: tick / 30 + p.id,
        sprint: false, fire: true, reload: tick % 300 === 0, frag: tick % 400 === p.id * 7, molotov: tick % 500 === 3,
      }));
    }
    if (tick === 5) game.command(1, { type: 'ready' });
    game.step();
    if (tick % 3 === 2) {
      const snap = game.snapshot();
      if (tick >= 300 && tick % 150 === 2) {
        const buf = encodeSnapshot(snap);
        checkSnapshot(decodeSnapshot(buf), snap);
        checked++;
      }
    }
  }
  assert.ok(checked >= 5);
});

test('an oversized JSON event is dropped instead of blowing up the snapshot', () => {
  const events = [
    { type: 'buyfail', pid: 2, item: 'A'.repeat(40000), reason: 'invalid' },
    { type: 'mystery', blob: 'x'.repeat(1024) },
    { type: 'buy', pid: 1, item: 'x'.repeat(200) },
    { type: 'down', pid: 3 },
  ];
  const buf = encodeSnapshot({ ...bigSnapshot(0), players: [], zombies: [], events, echo: [{ tick: 3, events }] });
  assert.ok(buf.byteLength < 2000, `snapshot stays small (${buf.byteLength} bytes)`);
  const d = decodeSnapshot(buf);
  assert.deepEqual(d.events, [events[2], events[3]]);
  assert.deepEqual(d.echo[0].events, [events[2], events[3]]);
});

test('freeMag round-trips when the sender publishes it, and is absent otherwise', () => {
  for (const freeMag of [0, 7, 12, 254]) {
    const d = decodeSnapshot(encodeSnapshot({ ...bigSnapshot(0), players: [{ ...samplePlayer(3), freeMag }] }));
    assert.equal(d.players[0].freeMag, freeMag);
  }
  for (const freeMag of [undefined, -1, 1.5, 255, 'x']) {
    const d = decodeSnapshot(encodeSnapshot({ ...bigSnapshot(0), players: [{ ...samplePlayer(3), freeMag }] }));
    assert.equal('freeMag' in d.players[0], false);
  }
});

test('decodeInputs refuses more cmds than an honest client ever sends', async () => {
  const { encodeInputs, decodeInputs, MAX_INPUTS_PER_MESSAGE } = await import('../public/js/shared/protocol.js');
  const cmd = (seq) => ({ seq, moveX: 0, moveY: 0, angle: 0, fire: false, melee: false, sprint: false, interact: false,
    reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0 });
  const one = new Uint8Array(encodeInputs([cmd(1)]));
  const two = new Uint8Array(encodeInputs([cmd(1), cmd(2)]));
  const cmdSize = two.length - one.length;
  const headerLen = one.length - 1 - cmdSize;
  const full = new Uint8Array(encodeInputs(Array.from({ length: MAX_INPUTS_PER_MESSAGE }, (_, i) => cmd(i + 1))));
  assert.equal(decodeInputs(full.buffer).length, MAX_INPUTS_PER_MESSAGE);
  // Same message with one more cmd appended and the count bumped.
  const over = new Uint8Array(full.length + cmdSize);
  over.set(full);
  over.set(full.subarray(full.length - cmdSize), full.length);
  over[headerLen] = MAX_INPUTS_PER_MESSAGE + 1;
  assert.throws(() => decodeInputs(over.buffer), /Too many inputs/);
});
