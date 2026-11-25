// Counter-Strike-style gunplay (SPEC §3.4): 3D hit zones on the zombie bodies, deterministic
// spray patterns and their recovery, the inaccuracy model, wall penetration, secondary fire
// (scope, burst, suppressor), deploy times, lag compensation, the 3D shots in the sim
// (headshots, leg tagging, wallbangs, roofs) and their events on the wire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handlingOf, secondaryOf, sprayOffset, createAim, aimTick, aimKick, inaccuracyOf, zoneMult, discOffset, fireSpec,
  resetHandling, scopeFov, secondaryLabel, ZONE, MODE_BURST, MODE_SIL, ACCURATE_SPEED, CATEGORY_HANDLING,
} from '../public/js/shared/handling.js';
import { rayZombie, aimPoint, zombieBody, zombieVolumes, worldVolumes, TYPE_ZONES, ZOMBIE_SCALE } from '../public/js/shared/hitbox.js';
import { createTrace, traceShot, penDamage, shotTop, penCost } from '../public/js/shared/ballistics.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { ZOMBIES } from '../public/js/shared/zombies.js';
import { DT, PLAYER_SPEED, EYE_HEIGHT, PROTOCOL_VERSION } from '../public/js/shared/constants.js';
import { deployTime } from '../public/js/shared/sim/players.js';
import { SHOT_3D, SHOT_SIL, TAG_TIME } from '../public/js/shared/sim/combat.js';
import { encodeSnapshot, decodeSnapshot, encodeInputs, decodeInputs } from '../public/js/shared/protocol.js';
import { validBinds, DEFAULT_BINDS, keyLabel, RESERVED_KEYS } from '../public/js/ui/input.js';
import { crosshairSettings, dynamicGap, baseGap, XH_DEFAULTS } from '../public/js/ui/crosshair.js';
import { buildArenaMap } from './fixtures/sim-map.js';
import { bigSnapshot } from './fixtures/net-fake-game.js';
import { makeGame, addZombie, place, run, eventsOf, cmd } from './helpers/sim-helpers.js';

// ---- helpers ------------------------------------------------------------------------------

function arenaWith(obstacles, opts = {}) {
  const map = buildArenaMap({ objective: false, ...opts });
  map.obstacles = obstacles.map((o, i) => ({
    id: i, kind: o.kind || 'wall', x: o.x, y: o.y, w: o.w, h: o.h, a: o.a || 0,
    color: '#777777', solid: o.solid !== false, wrecked: false, roof: null, ...(o.extra || {}),
  }));
  return map;
}

/** A zombie that stands still, facing `angle`, and does no harm. */
function dummy(g, type, x, y, angle = Math.PI) {
  const z = addZombie(g, type, x, y);
  z.speed = 0;
  z.damage = 0;
  z.specialCd = 1e9;
  z.angle = angle;
  z.hp = z.maxHp = 100000;
  return z;
}

/** Arm player `id` with `gun` in slot 1, drawn and ready (no deploy wait). */
function arm(g, id, gun) {
  const p = g.getPlayer(id);
  p.slots = ['pistol', gun, null];
  p.mag = [12, WEAPONS[gun].mag, 0];
  p.res = [-1, 500, 0];
  p.slot = 1;
  p.cooldown = 0;
  p.modes = [0, 0, 0];
  return p;
}

/** The pitch from a standing player's eye at (px, py) to a body part of zombie z. */
function pitchTo(p, z, part) {
  const ap = aimPoint(z.type, z.id, 0, part);
  const tx = z.x + Math.cos(z.angle) * ap.f - Math.sin(z.angle) * ap.side;
  const ty = z.y + Math.sin(z.angle) * ap.f + Math.cos(z.angle) * ap.side;
  const d = Math.hypot(tx - p.x, ty - p.y);
  return { pitch: Math.atan2((z.z || 0) + ap.h - ((p.z || 0) + EYE_HEIGHT), d), yaw: Math.atan2(ty - p.y, tx - p.x) };
}

/** Fire one 3D shot from player 1 at a part of z; returns the run's events. */
function shootAt(g, p, z, part, extra = {}) {
  const a = pitchTo(p, z, part);
  return run(g, 1, () => ({ 1: { angle: a.yaw, pitch: a.pitch, aim3d: true, fire: true, ...extra } }));
}

// ---- hit volumes -----------------------------------------------------------------------------

test('hit volumes: each type has a head, a chest, a stomach and legs at the 3D model\'s heights', () => {
  for (const type of Object.keys(ZOMBIES)) {
    for (const id of [1, 7, 33]) {
      const vols = zombieVolumes(type, id, 0);
      const zones = new Set();
      for (let i = 0; i < vols.count; i++) zones.add(vols[i * 10 + 1]);
      for (const zn of [ZONE.HEAD, ZONE.CHEST, ZONE.STOMACH, ZONE.LEGS]) assert.ok(zones.has(zn), `${type}#${id} has zone ${zn}`);
      const head = aimPoint(type, id, 0, 'head'), chest = aimPoint(type, id, 0, 'chest'), legs = aimPoint(type, id, 0, 'legs');
      assert.ok(head.h > chest.h && chest.h > legs.h, `${type}#${id}: head over chest over legs`);
    }
  }
  // the standing types: the head near the top of a ~56-unit body, scaled per type
  const w = aimPoint('walker', 5, 0, 'head');
  assert.ok(w.h > 44 && w.h < 58, `walker head at ${w.h.toFixed(1)}`);
  const b = aimPoint('brute', 5, 0, 'head');
  assert.ok(b.h > w.h * 1.3, 'a brute is much taller');
  const c = aimPoint('crawler', 5, 0, 'head');
  assert.ok(c.h < 22, `a crawler's head is near the ground (${c.h.toFixed(1)})`);
  assert.deepEqual(Object.keys(ZOMBIE_SCALE).sort(), Object.keys(ZOMBIES).sort(), 'a scale per zombie type');
});

test('hit volumes: rays resolve to the zone they cross; above the head and beside the body miss', () => {
  for (const type of ['walker', 'runner', 'spitter', 'brute', 'boss']) {
    const id = 11;
    for (const part of ['head', 'chest', 'stomach', 'legs']) {
      const ap = aimPoint(type, id, 0, part);
      // zombie at (400, 0) facing the shooter at the origin; a level ray at the part's height
      const tx = 400 + Math.cos(Math.PI) * ap.f, ty = 0 + Math.cos(Math.PI) * ap.side;
      const r = rayZombie(type, id, 0, 400, 0, 0, Math.PI, 0, ty, ap.h, 1, 0, 0, 2000);
      assert.ok(r.s > 0 && r.s < tx + 1, `${type} ${part}: hit (s ${r.s})`);
      const want = { head: ZONE.HEAD, chest: ZONE.CHEST, stomach: ZONE.STOMACH, legs: ZONE.LEGS }[part];
      assert.equal(r.zone, want, `${type} ${part}: zone ${r.zone}`);
    }
    const head = aimPoint(type, id, 0, 'head');
    assert.equal(rayZombie(type, id, 0, 400, 0, 0, Math.PI, 0, 0, head.h * 1.35 + 6, 1, 0, 0, 2000).s, -1, `${type}: over the head`);
    assert.equal(rayZombie(type, id, 0, 400, 0, 0, Math.PI, 0, 80 * ZOMBIE_SCALE[type], 30, 1, 0, 0, 2000).s, -1, `${type}: beside it`);
  }
  // a sloped ray (from a roof down to the head)
  const ap = aimPoint('walker', 3, 0, 'head');
  const k = (ap.h - 140) / (400 - ap.f);
  const r = rayZombie('walker', 3, 0, 400, 0, 0, Math.PI, 0, 0, 140, 1, 0, k, 2000);
  assert.equal(r.zone, ZONE.HEAD, 'from up high');
  // the same zombie standing on a car roof (z 40): a level shot at its old head height hits lower
  const up = rayZombie('walker', 3, 0, 400, 0, 40, Math.PI, 0, 0, ap.h + 40, 1, 0, 0, 2000);
  assert.equal(up.zone, ZONE.HEAD, 'feet at z: the volumes ride with them');
});

test('hit volumes: the world volumes for the dev overlay sit where the zombie stands', () => {
  const v = worldVolumes('walker', 4, 0, 1000, 500, 0, 0);
  assert.ok(v.length >= 6);
  for (const q of v) {
    const pts = q.kind === 'cap' ? [q.a, q.b] : q.corners;
    for (const [x, h, y] of pts) {
      assert.ok(Math.abs(x - 1000) < 40 && Math.abs(y - 500) < 40, 'around the zombie');
      assert.ok(h > -2 && h < 62, 'feet to head');
    }
  }
  const b = zombieBody('walker', 4);
  assert.deepEqual(zombieBody('walker', 4), b, 'the build is a pure function of the id');
});

test('zone multipliers: head ×4 (brute and boss ×2), stomach ×1.25, chest ×1, legs ×0.75; 2D hits ×1', () => {
  const h = handlingOf('rifle');
  assert.equal(zoneMult(h, ZONE.HEAD), 4);
  assert.equal(zoneMult(h, ZONE.STOMACH), 1.25);
  assert.equal(zoneMult(h, ZONE.CHEST), 1);
  assert.equal(zoneMult(h, ZONE.LEGS), 0.75);
  assert.equal(zoneMult(h, ZONE.NONE), 1, 'a 2D (zone-less) hit');
  assert.equal(zoneMult(h, ZONE.HEAD, TYPE_ZONES.brute), 2);
  assert.equal(zoneMult(h, ZONE.HEAD, TYPE_ZONES.boss), 2);
});

// ---- spray patterns, recoil, inaccuracy ----------------------------------------------------------

test('spray: the same pattern every time; an automatic climbs for its first rounds, then wanders side to side', () => {
  for (const id of ['rifle', 'uzi', 'lmg', 'tommy', 'hmg', 'minigun']) {
    const h = handlingOf(id);
    const a = [], b = [];
    for (let k = 0; k <= 30; k++) { a.push(sprayOffset(h.spray, k, [0, 0]).slice()); b.push(sprayOffset(h.spray, k, [0, 0]).slice()); }
    assert.deepEqual(a, b, `${id}: deterministic`);
    assert.deepEqual(a[0], [0, 0], `${id}: the first shot goes where the crosshair is`);
    const climb = h.spray.climb;
    assert.ok(climb >= 6 && climb <= 12, `${id}: climbs for ${climb} rounds`);
    for (let k = 2; k <= climb; k++) assert.ok(a[k][1] > a[k - 1][1] - 0.003, `${id}: shot ${k} keeps climbing`);
    // past the climb: the yaw turns back the other way (side to side)
    let flips = 0;
    for (let k = climb + 2; k <= 30; k++) {
      const d0 = a[k - 1][0] - a[k - 2][0], d1 = a[k][0] - a[k - 1][0];
      if (Math.abs(d0) > 1e-4 && Math.abs(d1) > 1e-4 && Math.sign(d0) !== Math.sign(d1)) flips++;
    }
    assert.ok(flips >= 1, `${id}: drifts side to side after the climb`);
  }
  // a semi-automatic kicks once per shot
  const dmr = handlingOf('dmr');
  assert.ok(sprayOffset(dmr.spray, 1, [0, 0])[1] > 0.02);
});

test('recoil: kicks follow the pattern, recover when the trigger is let go, and a re-spray repeats it', () => {
  const h = handlingOf('rifle');
  const rate = WEAPONS.rifle.rate;
  const spray = () => {
    const a = createAim();
    const out = [];
    let t = 0;
    for (let shot = 0; shot < 12; shot++) {
      out.push([a.py, a.pp]);
      aimKick(a, h);
      for (let i = 0; i < Math.round(60 / rate); i++, t++) aimTick(a, h, rate, DT);
    }
    return { out, a };
  };
  const s1 = spray(), s2 = spray();
  assert.deepEqual(s1.out, s2.out, 'the same spray twice');
  assert.ok(s1.out[9][1] > 0.06, `the climb (${s1.out[9][1].toFixed(3)} rad after 9 rounds)`);
  // let go: back to rest within about the recovery time
  const a = s1.a;
  let ticks = 0;
  while (a.spray > 0 && ticks < 300) { aimTick(a, h, rate, DT); ticks++; }
  assert.equal(a.pp, 0);
  assert.ok(ticks * DT < h.recovery + 0.3, `recovered in ${(ticks * DT).toFixed(2)} s`);
  // a semi-automatic tapped as fast as it cycles doesn't climb forever
  const dh = handlingOf('dmr');
  const d = createAim();
  for (let shot = 0; shot < 20; shot++) {
    aimKick(d, dh);
    for (let i = 0; i < Math.ceil(60 / WEAPONS.dmr.rate); i++) aimTick(d, dh, WEAPONS.dmr.rate, DT);
  }
  assert.ok(d.pp < 0.06, `semi-auto spam stays bounded (${d.pp.toFixed(3)})`);
});

test('inaccuracy: standing still is tight, crouching tighter; moving, the air, landing and sprinting open it', () => {
  for (const id of ['pistol', 'uzi', 'rifle', 'dmr', 'lmg']) {
    const h = handlingOf(id);
    const base = { speed: 0, maxSpeed: PLAYER_SPEED, air: false, landT: 999, duck: 0, scope: 0, scopeK: 0, sprint: false, added: 0, accK: 1 };
    const stand = inaccuracyOf(h, base);
    assert.ok(Math.abs(stand - h.inacc.stand) < 1e-9, `${id}: the first shot of a rested, standing gun is the standing cone`);
    assert.ok(inaccuracyOf(h, { ...base, duck: 1 }) < stand, `${id}: crouched`);
    const run = inaccuracyOf(h, { ...base, speed: PLAYER_SPEED });
    const walk = inaccuracyOf(h, { ...base, speed: PLAYER_SPEED * 0.52 });
    const slow = inaccuracyOf(h, { ...base, speed: PLAYER_SPEED * ACCURATE_SPEED * 0.9 });
    assert.ok(run > walk && walk > slow, `${id}: scales with speed`);
    assert.ok(slow < stand * 1.2, `${id}: below the accurate speed it is (nearly) as good as standing`);
    assert.ok(inaccuracyOf(h, { ...base, air: true }) > run, `${id}: in the air`);
    assert.ok(inaccuracyOf(h, { ...base, landT: 2 }) > stand, `${id}: just landed`);
    assert.ok(inaccuracyOf(h, { ...base, speed: PLAYER_SPEED * 1.4, sprint: true }) > run, `${id}: sprinting is worse than running`);
    assert.ok(inaccuracyOf(h, { ...base, added: 0.05 }) > stand + 0.04, `${id}: the per-shot part adds`);
  }
  // a rifle running flat out is much worse than a pistol running
  const run = (id) => inaccuracyOf(handlingOf(id), { speed: PLAYER_SPEED, maxSpeed: PLAYER_SPEED, air: false, landT: 999, duck: 0, scope: 0, scopeK: 0, sprint: false, added: 0, accK: 1 });
  assert.ok(run('rifle') > run('pistol') * 2);
  // the cone is uniform in radius, inside it
  const o = [0, 0];
  for (let i = 0; i < 200; i++) {
    discOffset(0.01, (i * 0.618) % 1, (i * 0.377) % 1, o);
    assert.ok(Math.hypot(o[0], o[1]) <= 0.01 + 1e-12);
  }
});

test('handling: every category and every gun has a record; unknown guns and categories fall back safely', () => {
  for (const id of Object.keys(WEAPONS)) {
    const h = handlingOf(id);
    assert.ok(h.inacc.stand >= 0 && h.recovery > 0 && h.deploy >= 0 && h.tracer >= 1, id);
    assert.ok(Object.isFrozen(h), `${id}: frozen`);
  }
  for (const cat of ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'heavy', 'melee', 'special', 'explosive']) assert.ok(CATEGORY_HANDLING[cat], cat);
  const ghost = handlingOf('no_such_gun');
  assert.equal(ghost.category, 'special');
  assert.ok(ghost.inacc.stand >= 0 && ghost.deploy > 0);
  WEAPONS.__test_odd = { name: 'Odd', category: 'banana', kind: 'hitscan', damage: 10, rate: 3, mag: 5, reserve: 5, reload: 1, pellets: 1, spread: 0, range: 500, pierce: 1, falloff: 1, moveMult: 0.9 };
  try {
    const h = handlingOf('__test_odd');
    assert.equal(h.category, 'special', 'an unknown category');
    assert.equal(h.speed, 0.9, 'its own move speed');
  } finally {
    delete WEAPONS.__test_odd;
    resetHandling();
  }
});

// ---- penetration ---------------------------------------------------------------------------------

test('penetration: rifles and snipers go through thin cover at reduced damage; pistols barely; never buildings', () => {
  const world = createCollisionWorld(arenaWith([
    { kind: 'wall', x: 400, y: 300, w: 10, h: 200 },        // a thin wall
    { kind: 'car', x: 400, y: 600, w: 84, h: 42, a: Math.PI / 2, solid: false },
    { kind: 'building', x: 400, y: 900, w: 120, h: 120 },
  ]));
  const tr = createTrace();
  const at = (y, power) => traceShot(world, 200, y, 30, 1, 0, 0, 1000, power, tr);
  // the thin wall: a rifle (power 2) goes through with most of its damage, a pistol with less
  const rifle = at(300, handlingOf('rifle').pen);
  assert.equal(rifle.hit, 0, 'the rifle round went on');
  assert.ok(rifle.n >= 1 && rifle.mult[rifle.n - 1] > 0.4, `rifle keeps ${rifle.mult[rifle.n - 1].toFixed(2)}`);
  const pistol = at(300, handlingOf('pistol').pen);
  assert.ok(pistol.hit === 2 || pistol.mult[pistol.n - 1] < rifle.mult[rifle.n - 1], 'a pistol keeps less (or stops)');
  // the car body: a sniper gets through, a shotgun pellet doesn't
  assert.equal(at(600, handlingOf('sniper').pen).hit, 0, 'sniper through the car');
  assert.equal(at(600, handlingOf('shotgun').pen).hit, 2, 'buckshot stops in the car');
  // never through a building, whatever the power
  assert.equal(at(900, 99).hit, 2);
  // the cost model
  assert.ok(penDamage(0.25, 2) > penDamage(1.2, 2) && penDamage(1.2, 2) > penDamage(1.2, 1));
  assert.ok(shotTop({ kind: 'car', w: 84, h: 42 }) < shotTop({ kind: 'van', w: 104, h: 50 }));
  assert.equal(penCost({ kind: 'building', w: 100, h: 100 }, 10), Infinity);
});

test('sim: a wallbang kill through a thin wall is flagged, with the damage cut', () => {
  const g = makeGame({ map: arenaWith([{ kind: 'wall', x: 500, y: 450, w: 10, h: 300 }]) });
  const p = arm(g, 1, 'rifle');
  place(g, 1, 300, 450, 0);
  const z = dummy(g, 'walker', 700, 450);
  z.hp = z.maxHp = 15;
  const ev = shootAt(g, p, z, 'chest');
  const shot = eventsOf(ev, 'shot')[0];
  assert.ok(shot && (shot.fl & SHOT_3D), 'a 3D shot');
  assert.equal(shot.rays[0].hit, 1, 'hit the zombie behind the wall');
  assert.ok(shot.rays[0].pen >= 1, 'through one wall');
  const die = eventsOf(ev, 'zdie')[0];
  assert.ok(die && die.wb === true, 'the kill is a wallbang');
  // the damage behind the wall is cut
  const g2 = makeGame({ map: arenaWith([{ kind: 'wall', x: 500, y: 450, w: 10, h: 300 }]) });
  const p2 = arm(g2, 1, 'rifle');
  place(g2, 1, 300, 450, 0);
  const z2 = dummy(g2, 'brute', 700, 450);
  shootAt(g2, p2, z2, 'chest');
  const dealt = (z2.maxHp - z2.hp) / (p2.perks.damageMult || 1);
  assert.ok(dealt > 0 && dealt < WEAPONS.rifle.damage * 0.95, `through the wall: ${dealt.toFixed(1)} of ${WEAPONS.rifle.damage}`);
});

// ---- the 3D shot in the sim ---------------------------------------------------------------------

test('sim: a headshot does ×4 (×2 on a brute), flags the kill and can burst the head', () => {
  const g = makeGame();
  const p = arm(g, 1, 'rifle');
  place(g, 1, 300, 450, 0);
  const z = dummy(g, 'brute', 650, 450);
  const before = z.hp;
  shootAt(g, p, z, 'head');
  const dealt = (before - z.hp) / (p.perks.damageMult || 1);
  assert.ok(Math.abs(dealt - WEAPONS.rifle.damage * 2) < 1e-6, `brute head: ${dealt}`);
  // a walker, killed by a headshot: hs on the zdie; a big hit pops the head
  const g2 = makeGame();
  const p2 = arm(g2, 1, 'rifle');
  place(g2, 1, 300, 450, 0);
  const w = dummy(g2, 'walker', 600, 450);
  w.hp = w.maxHp = 120;
  const ev = shootAt(g2, p2, w, 'head');
  assert.equal(eventsOf(ev, 'shot')[0].rays[0].zone, ZONE.HEAD);
  const die = eventsOf(ev, 'zdie')[0];
  assert.ok(die && die.hs === true, 'a headshot kill');
  assert.equal(die.pop, false, 'a rifle round kills it but leaves the head on');
  // a big gun (a battle rifle's 85 before the ×4) bursts the head
  const g3 = makeGame();
  const p3 = arm(g3, 1, 'dmr');
  place(g3, 1, 300, 450, 0);
  const w3 = dummy(g3, 'walker', 600, 450);
  w3.hp = w3.maxHp = 120;
  const die3 = eventsOf(shootAt(g3, p3, w3, 'head'), 'zdie')[0];
  assert.ok(die3 && die3.hs && die3.pop, 'head popped');
  // never on the big ones (their heads hold), nor from a body shot
  const g4 = makeGame();
  const p4 = arm(g4, 1, 'dmr');
  place(g4, 1, 300, 450, 0);
  const w4 = dummy(g4, 'walker', 600, 450);
  w4.hp = w4.maxHp = 50;
  const die4 = eventsOf(shootAt(g4, p4, w4, 'chest'), 'zdie')[0];
  assert.ok(die4 && !die4.hs && !die4.pop, 'a body kill');
});

test('sim: chest ×1, stomach ×1.25, legs ×0.75 and a leg hit slows the zombie for a moment', () => {
  const dmg = (part) => {
    const g = makeGame();
    const p = arm(g, 1, 'rifle');
    p.slot = 0;
    place(g, 1, 300, 450, 0);
    const z = dummy(g, 'brute', 520, 450);
    const before = z.hp;
    const ev = shootAt(g, p, z, part);
    return { dealt: (before - z.hp) / (p.perks.damageMult || 1), z, ev };
  };
  const base = WEAPONS.pistol.damage;
  assert.ok(Math.abs(dmg('chest').dealt - base) < 1e-6, 'chest');
  assert.ok(Math.abs(dmg('stomach').dealt - base * 1.25) < 1e-6, 'stomach');
  const legs = dmg('legs');
  assert.ok(Math.abs(legs.dealt - base * 0.75) < 1e-6, 'legs');
  assert.ok(legs.z.tagT > 0 && legs.z.tagT <= TAG_TIME + 1e-9 && legs.z.tagK > 0, 'tagged');
});

test('sim: shooting down from a roof and up at a zombie on one keeps working', () => {
  const map = arenaWith([{ kind: 'container', x: 300, y: 450, w: 150, h: 60 }]);
  const g = makeGame({ map });
  const p = arm(g, 1, 'rifle');
  place(g, 1, 300, 450, 0);
  const c = g.world.colliders[0];
  p.zq = c.topQ;
  p.z = c.top;
  const z = dummy(g, 'walker', 650, 450);
  const before = z.hp;
  const ap = aimPoint('walker', z.id, 0, 'chest');
  const d = 650 - ap.f - 300;
  const pitch = Math.atan2(ap.h - (p.z + EYE_HEIGHT), d);
  const ev = run(g, 1, () => ({ 1: { angle: 0, pitch, aim3d: true, fire: true } }));
  assert.ok(before - z.hp > 0, 'hit from the roof');
  assert.ok(eventsOf(ev, 'shot')[0].z > c.top, 'the shot starts at the raised eye');
  // a level shot from the roof flies over its head
  const g2 = makeGame({ map });
  const p2 = arm(g2, 1, 'rifle');
  place(g2, 1, 300, 450, 0);
  p2.zq = c.topQ;
  p2.z = c.top;
  const z2 = dummy(g2, 'walker', 650, 450);
  run(g2, 1, () => ({ 1: { angle: 0, pitch: 0.02, aim3d: true, fire: true } }));
  assert.equal(z2.hp, z2.maxHp, 'over the head');
});

test('sim: commands without a pitch (2D view, turrets, NPCs) keep the 2D hit: body, ×1', () => {
  const g = makeGame();
  const p = arm(g, 1, 'rifle');
  place(g, 1, 300, 450, 0);
  const z = dummy(g, 'brute', 650, 450);
  const before = z.hp;
  const ev = run(g, 1, () => ({ 1: { angle: 0, fire: true } }));
  const shot = eventsOf(ev, 'shot')[0];
  assert.equal(shot.fl & SHOT_3D, 0, 'a 2D shot');
  assert.equal(shot.rays[0].zone, 0, 'no zone');
  assert.ok(Math.abs((before - z.hp) / (p.perks.damageMult || 1) - WEAPONS.rifle.damage) < 1e-6, 'full body damage');
});

test('sim: the deploy time holds the first shot of a freshly drawn gun', () => {
  const g = makeGame();
  const p = arm(g, 1, 'lmg');
  p.slot = 0;
  place(g, 1, 300, 450, 0);
  dummy(g, 'brute', 650, 450);
  let first = -1;
  for (let t = 0; t < 120 && first < 0; t++) {
    const ev = run(g, 1, () => ({ 1: { angle: 0, fire: true, aim3d: true, slot: t === 0 ? 1 : -1 } }));
    if (eventsOf(ev, 'shot').length) first = t;
  }
  const want = deployTime('lmg');
  assert.ok(want >= 1, 'a heavy gun is slow to bring up');
  assert.ok(first * DT >= want - DT * 1.5 && first * DT <= want + DT * 4, `first shot at ${(first * DT).toFixed(2)} s (deploy ${want} s)`);
});

test('sim: spread randomness comes from the host rng — same seed, same shots', () => {
  const shots = (seed) => {
    const g = makeGame({ seed });
    arm(g, 1, 'rifle');
    place(g, 1, 300, 450, 0);
    dummy(g, 'brute', 900, 450);
    const ev = run(g, 40, () => ({ 1: { angle: 0, pitch: 0.01, aim3d: true, fire: true, moveX: 1 } }));
    return eventsOf(ev, 'shot').map((e) => e.rays.map((r) => [r.x, r.y, r.z]));
  };
  assert.deepEqual(shots(5), shots(5));
  assert.notDeepEqual(shots(5), shots(6));
});

// ---- secondary fire ------------------------------------------------------------------------------

test('secondary: the sniper scope cycles its zoom levels, tightens the cone, and a bolt gun drops out of it after a shot', () => {
  const sec = secondaryOf('sniper');
  assert.equal(sec.type, 'scope');
  assert.deepEqual(sec.levels, [40, 15]);
  assert.equal(secondaryLabel(sec), 'ZOOM');
  assert.equal(scopeFov('sniper', 1), 40);
  assert.equal(scopeFov('sniper', 0), null);
  assert.equal(secondaryOf('amr').type, 'scope');
  assert.equal(secondaryOf('rifle'), null, 'no secondary: right click shoves');
  const g = makeGame();
  const p = arm(g, 1, 'sniper');
  place(g, 1, 300, 450, 0);
  let ev = run(g, 1, () => ({ 1: { alt: true } }));
  assert.equal(p.scope, 1);
  assert.equal(eventsOf(ev, 'alt')[0].what, 'zoom');
  run(g, 1, () => ({ 1: {} }));
  run(g, 1, () => ({ 1: { alt: true } }));
  assert.equal(p.scope, 2);
  run(g, 1, () => ({ 1: {} }));
  ev = run(g, 1, () => ({ 1: { alt: true } }));
  assert.equal(p.scope, 0);
  assert.equal(eventsOf(ev, 'alt')[0].what, 'unzoom');
  // scoped and settled: far tighter than unscoped
  const h = handlingOf('sniper');
  const st = { speed: 0, maxSpeed: PLAYER_SPEED, air: false, landT: 999, duck: 0, scope: 0, scopeK: 0, sprint: false, added: 0, accK: 1 };
  assert.ok(inaccuracyOf(h, { ...st, scope: 1, scopeK: 1 }) < inaccuracyOf(h, st) / 10);
  // a shot through the scope: the bolt is worked, the eye leaves the glass, then goes back
  run(g, 1, () => ({ 1: { alt: true } }));
  run(g, 30, () => ({ 1: {} }));
  ev = run(g, 1, () => ({ 1: { fire: true, aim3d: true, angle: 0 } }));
  assert.ok(eventsOf(ev, 'shot')[0].fl & 4, 'flagged as a scoped shot');
  assert.equal(p.scope, 0, 'out of the scope while the bolt cycles');
  run(g, 90, () => ({ 1: {} }));
  assert.equal(p.scope, 1, 'back in the scope');
  // the scope slows the shooter down
  run(g, 1, () => ({ 1: { reload: true } }));
  assert.equal(p.scope, 0, 'a reload drops the scope');
});

test('secondary: burst / automatic toggle and the suppressor (declared on the weapon)', () => {
  WEAPONS.uzi.secondary = { type: 'burst' };
  WEAPONS.pistol.secondary = { type: 'silencer' };
  resetHandling();
  try {
    assert.equal(secondaryLabel(secondaryOf('uzi')), 'BURST');
    assert.equal(secondaryLabel(secondaryOf('pistol')), 'SIL');
    // burst: three rounds per pull, then a pause
    const g = makeGame();
    const p = arm(g, 1, 'uzi');
    place(g, 1, 300, 450, 0);
    dummy(g, 'brute', 650, 450);
    let ev = run(g, 1, () => ({ 1: { alt: true } }));
    assert.equal(eventsOf(ev, 'alt')[0].what, 'burst');
    assert.equal(p.modes[1] & MODE_BURST, MODE_BURST);
    const spec = fireSpec(WEAPONS.uzi, handlingOf('uzi'), p.modes[1], {});
    assert.equal(spec.burst, 3);
    ev = run(g, 20, () => ({ 1: { fire: true, aim3d: true, angle: 0 } }));
    assert.equal(eventsOf(ev, 'shot').length, 3, 'one burst of three');
    run(g, 1, () => ({ 1: { alt: true } }));
    assert.equal(p.modes[1] & MODE_BURST, 0, 'back to automatic');
    // suppressor: quieter (shot flag), a little less damage, screwing it on takes a moment
    const g2 = makeGame();
    const q = arm(g2, 1, 'rifle');
    q.slot = 0;
    place(g2, 1, 300, 450, 0);
    const z = dummy(g2, 'brute', 600, 450);
    ev = run(g2, 1, () => ({ 1: { alt: true } }));
    assert.equal(eventsOf(ev, 'alt')[0].what, 'silencer_on');
    assert.equal(q.modes[0] & MODE_SIL, MODE_SIL);
    ev = run(g2, 120, () => ({ 1: { fire: true, aim3d: true, angle: 0, pitch: pitchTo(q, z, 'chest').pitch } }), (gg) => z.hp < z.maxHp);
    const shot = eventsOf(ev, 'shot')[0];
    assert.ok(shot.fl & SHOT_SIL, 'a suppressed shot');
    assert.ok(Math.abs((z.maxHp - z.hp) / (q.perks.damageMult || 1) - WEAPONS.pistol.damage * secondaryOf('pistol').damage) < 1e-6, 'slightly less damage');
  } finally {
    delete WEAPONS.uzi.secondary;
    delete WEAPONS.pistol.secondary;
    resetHandling();
  }
});

// ---- lag compensation ----------------------------------------------------------------------------

test('lag compensation: a client shot hits the zombie where that client saw it (up to the cap)', () => {
  const g = makeGame();
  const p = arm(g, 1, 'rifle');
  place(g, 1, 300, 450, 0);
  const z = dummy(g, 'brute', 650, 450, Math.PI);
  z.speed = 0;
  // record a few ticks of history, then move the zombie sideways out of the line
  run(g, 10, () => ({ 1: {} }));
  const seen = g.tick - 1;
  z.y = 560;
  run(g, 6, () => ({ 1: {} }));
  const a = pitchTo(p, { ...z, y: 450 }, 'chest');
  const before = z.hp;
  run(g, 1, () => ({ 1: { angle: 0, pitch: a.pitch, aim3d: true, fire: true, vt: seen & 0xffff } }));
  assert.ok(z.hp < before, 'hit where it was seen');
  // the host's own shots (no view tick) see the present
  const g2 = makeGame();
  const p2 = arm(g2, 1, 'rifle');
  place(g2, 1, 300, 450, 0);
  const z2 = dummy(g2, 'brute', 650, 450, Math.PI);
  run(g2, 10, () => ({ 1: {} }));
  z2.y = 560;
  run(g2, 6, () => ({ 1: {} }));
  const b2 = z2.hp;
  run(g2, 1, () => ({ 1: { angle: 0, pitch: a.pitch, aim3d: true, fire: true } }));
  assert.equal(z2.hp, b2, 'no view tick: the present (a miss)');
  assert.ok(p2);
});

// ---- bots -----------------------------------------------------------------------------------------

test('bots aim in 3D: pitch at the body, their shots resolve on the hit volumes', () => {
  const g = makeGame({ players: [{ id: 1, name: 'H', color: 0, cls: 'soldier' }, { id: 2, name: 'B', color: 1, cls: 'soldier', bot: true }], sandbox: false });
  g.phase = 'wave'; g.wave = 1; g.timer = 0; g.spawnQueue = 0; g.bossQueue = 0;
  place(g, 1, 200, 1000);
  place(g, 2, 400, 600, 0);
  dummy(g, 'brute', 800, 600);
  const ev = run(g, 150);
  const shots = eventsOf(ev, 'shot').filter((e) => e.pid === 2);
  assert.ok(shots.length > 0, 'the bot fired');
  assert.ok(shots.every((e) => e.fl & SHOT_3D), 'every bot shot is 3D');
  const zones = shots.flatMap((e) => e.rays).filter((r) => r.hit === 1).map((r) => r.zone);
  assert.ok(zones.length > 0 && zones.every((zn) => zn >= 1 && zn <= 4), 'hits land on zones');
  const b = g.bots.find((q) => q.pid === 2);
  assert.equal(b.cmd.aim3d, true);
});

// ---- protocol --------------------------------------------------------------------------------------

test('protocol: the gunplay fields ride the wire (cmd pitch / crouch / walk / alt / view tick, shot height and flags, ray zones, kill flags, alt events)', () => {
  assert.ok(PROTOCOL_VERSION >= 14);
  const cmds = decodeInputs(encodeInputs([
    { seq: 1, pitch: -0.3, crouch: true, walk: false, alt: true, aim3d: true, vt: 1234 },
    { seq: 2, pitch: 0.71, crouch: false, walk: true, alt: false, aim3d: false },
  ]));
  assert.ok(Math.abs(cmds[0].pitch + 0.3) < 1e-3 && Math.abs(cmds[1].pitch - 0.71) < 1e-3);
  assert.deepEqual([cmds[0].crouch, cmds[0].walk, cmds[0].alt, cmds[0].aim3d, cmds[0].vt], [true, false, true, true, 1234]);
  assert.deepEqual([cmds[1].crouch, cmds[1].walk, cmds[1].alt, cmds[1].aim3d, cmds[1].vt], [false, true, false, false, -1]);
  const base = bigSnapshot(0);
  const events = [
    { type: 'shot', pid: 1, turret: 0, weapon: 'rifle', x: 100, y: 200, angle: 0.5, z: 47, pitch: -0.12, fl: SHOT_3D | SHOT_SIL, rays: [{ x: 300, y: 260, hit: 1, z: 44.5, zone: ZONE.HEAD, pen: 1 }] },
    { type: 'zdie', id: 9, ztype: 'walker', x: 300, y: 260, angle: 1, by: 1, gib: false, hs: true, wb: true, pop: true },
    { type: 'alt', pid: 1, what: 'zoom', n: 2 },
  ];
  const d = decodeSnapshot(encodeSnapshot({ ...base, events })).events;
  const shot = d.find((e) => e.type === 'shot');
  assert.equal(shot.fl, SHOT_3D | SHOT_SIL);
  assert.ok(Math.abs(shot.z - 47) < 0.6 && Math.abs(shot.pitch + 0.12) < 1e-3);
  assert.deepEqual([shot.rays[0].zone, shot.rays[0].pen, shot.rays[0].hit], [ZONE.HEAD, 1, 1]);
  assert.ok(Math.abs(shot.rays[0].z - 44.5) <= 0.5);
  const die = d.find((e) => e.type === 'zdie');
  assert.deepEqual([die.hs, die.wb, die.pop], [true, true, true]);
  const alt = d.find((e) => e.type === 'alt');
  assert.deepEqual([alt.what, alt.n], ['zoom', 2]);
});

// ---- the UI's pure parts ------------------------------------------------------------------------

test('key bindings: browser-safe defaults, reserved keys refused, duplicates resolved', () => {
  assert.deepEqual(validBinds(null), { ...DEFAULT_BINDS });
  for (const c of Object.values(DEFAULT_BINDS)) assert.ok(!/^(Control|Alt|Meta)/.test(c), `${c}: not a browser modifier`);
  assert.equal(validBinds({ crouch: 'KeyW' }).crouch, DEFAULT_BINDS.crouch, 'movement keys are taken');
  assert.ok(RESERVED_KEYS.has('ShiftLeft'), 'Shift stays sprint');
  assert.equal(validBinds({ crouch: 'ControlLeft' }).crouch, 'ControlLeft', 'Ctrl may be chosen');
  const b = validBinds({ walk: DEFAULT_BINDS.crouch });
  assert.equal(b.walk, DEFAULT_BINDS.crouch);
  assert.equal(b.crouch, '', 'the default it took is freed, not doubled');
  assert.equal(keyLabel('KeyZ'), 'Z');
  assert.equal(keyLabel('ControlLeft'), 'L-Ctrl');
});

test('crosshair settings: validated; a dynamic gap opens with the cone and spray, a static one does not', () => {
  assert.deepEqual(crosshairSettings(null), { ...XH_DEFAULTS });
  const odd = crosshairSettings({ xhStyle: 'huge', xhColor: '#123', xhSize: 99, xhThick: -1, xhGap: 'x', xhDot: 1, xhAlpha: 2 });
  assert.equal(odd.xhStyle, 'dynamic');
  assert.equal(odd.xhColor, XH_DEFAULTS.xhColor);
  assert.equal(odd.xhSize, 14);
  assert.equal(odd.xhThick, 0.5);
  assert.equal(odd.xhGap, XH_DEFAULTS.xhGap);
  assert.equal(odd.xhDot, XH_DEFAULTS.xhDot);
  assert.equal(odd.xhAlpha, 1);
  const dyn = crosshairSettings({ xhStyle: 'dynamic' });
  const stat = crosshairSettings({ xhStyle: 'static' });
  assert.ok(dynamicGap(dyn, 1, 30, 10, 200) > dynamicGap(dyn, 1, 2, 0, 200));
  assert.equal(dynamicGap(stat, 1, 30, 10, 200), baseGap(stat));
  assert.ok(dynamicGap(dyn, 1, 1000, 1000, 120) <= 120, 'capped');
});

test('handling numbers: rifles climb hard and recover slowly next to pistols; snipers are lost unscoped', () => {
  const r = handlingOf('rifle'), p = handlingOf('pistol'), s = handlingOf('sniper');
  assert.ok(r.spray.up > p.spray.up * 3);
  assert.ok(s.inacc.stand > r.inacc.stand * 8, 'a sniper without its scope');
  assert.ok(r.pen > p.pen && s.pen > r.pen, 'penetration by class');
  assert.ok(handlingOf('lmg').deploy > p.deploy, 'heavy guns come up slower');
  assert.ok(Math.abs(zombieBody('brute', 1).h - 1) < 0.1);
});
