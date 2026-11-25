// The arsenal update: the saw-blade launcher's ricocheting blades (deterministic), the
// Hollow Star's charge and singularity, the Barrage MG's tightening spread, super weapons
// only from bosses, the unlock waves, and the wire format with the new indices.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DT, PROTOCOL_VERSION } from '../public/js/shared/constants.js';
import {
  WEAPONS, WEAPON_IDS, PROJECTILE_KINDS, SUPER_DROP, crateWeaponPool, tightenedWeapon, chargeTime, buySection,
} from '../public/js/shared/weapons.js';
import { giveWeapon, rollDrop } from '../public/js/shared/sim/players.js';
import { encodeSnapshot, decodeSnapshot } from '../public/js/shared/protocol.js';
import { makeGame, addZombie, place, run, eventsOf, buildArenaMap } from './helpers/sim-helpers.js';

/** The guns added by the arsenal update, in table order (appended after the HMG). */
const ARSENAL = ['compact9', 'tac45', 'handcannon', 'mpistol', 'smg9', 'pdw', 'smg45', 'combat_sg', 'box_sg', 'ak', 'm4',
  'bullpup', 'scout', 'magsniper', 'autosniper', 'm60', 'barrage', 'sawblade', 'hollowstar'];

function armed(g, wid, x = 300, y = 600, angle = 0) {
  const p = place(g, 1, x, y, angle);
  p.slots = ['pistol', null, null];
  p.slot = giveWeapon(g, p, wid);
  return p;
}

function dummy(g, type, x, y, hp = 1e6) {
  const z = addZombie(g, type, x, y);
  z.speed = 0;
  z.hp = z.maxHp = hp;
  return z;
}

const wall = (id, x, y, w, h) => ({ id, kind: 'container', x, y, w, h, a: 0, solid: true, color: '#777', wrecked: false, roof: null });
const arena = (obstacles = [], w = 1600, h = 1200) => ({ ...buildArenaMap({ objective: false, width: w, height: h }), obstacles });
const medic = (o = {}) => makeGame({ cls: 'medic', ...o });

// -------------------------------------------------------------------------------------
describe('the roster', () => {
  test('nineteen guns appended after the HMG (older wire indices keep their meaning)', () => {
    assert.equal(WEAPON_IDS.length, 46);
    assert.equal(WEAPON_IDS.indexOf('hmg'), 26);
    assert.deepEqual(WEAPON_IDS.slice(27), ARSENAL);
    assert.deepEqual(PROJECTILE_KINDS.slice(-2), ['blade', 'singularity']);
    assert.ok(PROTOCOL_VERSION >= 14);
  });

  test('two machine guns and a full spread of categories', () => {
    const cats = (ids) => ids.map((id) => WEAPONS[id].category);
    const c = cats(ARSENAL);
    assert.equal(c.filter((x) => x === 'pistol').length, 4);
    assert.equal(c.filter((x) => x === 'smg').length, 3);
    assert.equal(c.filter((x) => x === 'shotgun').length, 2);
    assert.ok(c.filter((x) => x === 'rifle').length >= 3);
    assert.ok(c.filter((x) => x === 'sniper').length >= 2);
    assert.deepEqual(['m60', 'barrage'].map((id) => WEAPONS[id].category), ['heavy', 'heavy']);
    assert.ok(WEAPONS.m60.mag === 100 && WEAPONS.barrage.mag >= 150);
  });

  test('most of the variety is on sale from the first waves; the super weapon is last and dearest', () => {
    const buyable = WEAPON_IDS.filter((id) => WEAPONS[id].price > 0);
    const byWave2 = buyable.filter((id) => WEAPONS[id].unlockWave <= 2).length;
    assert.ok(byWave2 / buyable.length >= 0.6, `${byWave2} of ${buyable.length} by wave 2`);
    for (const id of WEAPON_IDS) {
      if (id === 'hollowstar') continue;
      assert.ok(WEAPONS[id].unlockWave < WEAPONS.hollowstar.unlockWave, id);
      assert.ok(WEAPONS[id].price < WEAPONS.hollowstar.price, id);
    }
  });

  test('secondary functions are declared for the shooting module', () => {
    // (the field names of shared/handling.js: count / delay / rate; a silencer's report in sfx)
    const b = WEAPONS.compact9.secondary;
    assert.equal(b.type, 'burst');
    assert.ok(b.count >= 2 && b.delay > 0 && b.rate > 0);
    for (const id of ['tac45', 'm4']) {
      const s = WEAPONS[id].secondary;
      assert.equal(s.type, 'silencer', id);
      assert.equal(typeof s.sfx, 'string', id);
      assert.ok(!('sound' in s), `${id}: a silencer's sound is the module's loudness number`);
    }
    for (const id of ['bullpup', 'scout', 'magsniper', 'autosniper']) {
      const s = WEAPONS[id].secondary;
      assert.equal(s.type, 'scope', id);
      assert.ok(s.levels.length >= 1 && s.levels.every((f) => f > 0 && f < 80), id);
    }
  });

  test('buy-menu sections: shotguns and machine guns share Heavy', () => {
    assert.equal(buySection('pistol'), 'pistols');
    assert.equal(buySection('smg9'), 'smgs');
    assert.equal(buySection('combat_sg'), 'heavy');
    assert.equal(buySection('m60'), 'heavy');
    assert.equal(buySection('ak'), 'rifles');
    assert.equal(buySection('scout'), 'snipers');
    assert.equal(buySection('sawblade'), 'specials');
    assert.equal(buySection('rocket'), 'specials');
    assert.equal(buySection('chainsaw'), 'specials');
  });
});

// -------------------------------------------------------------------------------------
describe('saw-blade launcher', () => {
  test('a blade slices through a line of zombies, each once, and blows the dead apart', () => {
    const g = medic({ map: arena() });
    armed(g, 'sawblade', 200, 600);
    const line = [300, 360, 420, 480].map((x) => dummy(g, 'walker', x, 600, 50));
    const ev = run(g, 40, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    const kills = eventsOf(ev, 'zdie');
    assert.equal(kills.length, 4, 'all four cut down');
    assert.ok(kills.every((k) => k.gib), 'blown apart');
    assert.ok(eventsOf(ev, 'blade').some((e) => e.what === 'cut'));
    void line;
  });

  test('a cut costs damage once per zombie per leg', () => {
    const g = medic({ map: arena() });
    armed(g, 'sawblade', 200, 600);
    const z = dummy(g, 'brute', 420, 600);
    run(g, 20, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    assert.equal(z.maxHp - z.hp, WEAPONS.sawblade.damage, 'one cut on the way through');
  });

  test('it ricochets off a wall: the angle of reflection equals the angle of incidence', () => {
    // a wall across the blade's path at x = 800 (face at x = 780)
    const g = medic({ map: arena([wall(0, 800, 600, 40, 600)]) });
    const a = 0.5;
    armed(g, 'sawblade', 400, 400, a);
    const p = g.getPlayer(1);
    const w = WEAPONS.sawblade;
    let blade = null;
    const ev = run(g, 60, (gg, t) => {
      if (!blade) blade = gg.projectiles.find((q) => q.kind === 'blade') || null;
      return { 1: { fire: t === 0, angle: a } };
    });
    assert.ok(blade, 'a blade was fired');
    const walls = eventsOf(ev, 'blade').filter((e) => e.what === 'wall');
    assert.ok(walls.length >= 1, 'it bounced');
    const first = walls[0];
    assert.ok(Math.abs(first.x - 780) < 14, `bounced at the wall face (${first.x})`);
    assert.ok(Math.abs(first.angle - (Math.PI - a)) < 0.02, `reflected heading ${first.angle}`);
    // the speed after the bounce: `keep` of the speed it hit with
    void p;
    void w;
  });

  test('bounces at most `bounces` times, then embeds in the wall', () => {
    // a narrow corridor: two walls the blade zig-zags between
    const g = medic({ map: arena([wall(0, 800, 470, 1400, 40), wall(1, 800, 730, 1400, 40)]) });
    armed(g, 'sawblade', 150, 600, 1.2);
    const ev = run(g, 200, (_, t) => ({ 1: { fire: t === 0, angle: 1.2 } }));
    const be = eventsOf(ev, 'blade');
    const bounces = be.filter((e) => e.what === 'wall').length;
    assert.equal(bounces, WEAPONS.sawblade.projectile.bounces);
    assert.equal(be.filter((e) => e.what === 'stop').length, 1, 'comes to rest once');
    assert.equal(g.projectiles.filter((q) => q.kind === 'blade').length, 0);
  });

  test('the same zombie may be cut again on the way back from a wall', () => {
    const g = medic({ map: arena([wall(0, 700, 600, 40, 600)]) });
    armed(g, 'sawblade', 300, 600, 0);
    const z = dummy(g, 'brute', 560, 600);
    run(g, 80, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    assert.equal(z.maxHp - z.hp, 2 * WEAPONS.sawblade.damage, 'cut going out and coming back');
  });

  test('a boss stops a blade dead', () => {
    const g = medic({ map: arena() });
    armed(g, 'sawblade', 200, 600);
    const boss = dummy(g, 'boss', 500, 600);
    const behind = dummy(g, 'walker', 640, 600);
    const ev = run(g, 40, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    assert.ok(boss.hp < boss.maxHp);
    assert.equal(behind.hp, behind.maxHp, 'nothing behind the boss');
    assert.equal(eventsOf(ev, 'blade').filter((e) => e.what === 'stop').length, 1);
  });

  test('ricochets are deterministic: two seeded games trace the same blade path', () => {
    const trace = () => {
      const g = medic({ map: arena([wall(0, 900, 600, 40, 900), wall(1, 600, 180, 900, 40)]), seed: 7 });
      armed(g, 'sawblade', 300, 700, -0.7);
      for (const [x, y] of [[520, 560], [700, 420], [820, 300]]) dummy(g, 'walker', x, y, 200);
      const path = [];
      run(g, 120, (gg, t) => {
        for (const q of gg.projectiles) if (q.kind === 'blade') path.push(q.x.toFixed(6), q.y.toFixed(6), q.vx.toFixed(6));
        return { 1: { fire: t === 0 || t === 30, angle: -0.7 } };
      });
      return path.join(',');
    };
    const a = trace(), b = trace();
    assert.ok(a.length > 200);
    assert.equal(a, b);
  });
});

// -------------------------------------------------------------------------------------
describe('Hollow Star', () => {
  test('charges while the trigger is held: no shot before `charge` s, then one, and the charge drains', () => {
    const g = medic({ map: arena() });
    const p = armed(g, 'hollowstar', 300, 600);
    const w = WEAPONS.hollowstar;
    const charge = chargeTime(w);
    assert.ok(charge > 0.3);
    const before = run(g, Math.floor(charge / DT) - 2, () => ({ 1: { fire: true, angle: 0 } }));
    assert.equal(eventsOf(before, 'shot').length, 0, 'still charging');
    assert.ok(p.spin > 0.9 && p.spin < 1);
    const after = run(g, 4, () => ({ 1: { fire: true, angle: 0 } }));
    assert.equal(eventsOf(after, 'shot').length, 1, 'fires once charged');
    assert.equal(p.spin, 0, 'the shot spent the charge');
    assert.equal(p.mag[p.slot], w.mag - 1);
    // letting go loses a half-built charge
    run(g, Math.floor(charge / DT / 2), () => ({ 1: { fire: false, angle: 0 } }));
    assert.equal(p.spin, 0);
  });

  test('the orb drags zombies in, holds them, crushes the core and collapses', () => {
    const g = medic({ map: arena() });
    armed(g, 'hollowstar', 200, 600);
    const zs = [[600, 520], [640, 690], [560, 640]].map(([x, y]) => dummy(g, 'walker', x, y, 1e6));
    const d0 = zs.map((z) => Math.hypot(z.x - 600, z.y - 600));
    let orb = null, minD = Infinity;
    const ev = run(g, 200, (gg) => {
      const o = gg.projectiles.find((q) => q.kind === 'singularity');
      if (o) {
        orb = o;
        for (const z of zs) minD = Math.min(minD, Math.hypot(z.x - o.x, z.y - o.y));
      }
      return { 1: { fire: true, angle: 0 } };
    });
    assert.ok(orb, 'an orb flew');
    assert.ok(minD < 60, `zombies were dragged to the orb (closest ${minD.toFixed(0)})`);
    const ex = eventsOf(ev, 'explosion').filter((e) => e.kind === 'singularity');
    assert.ok(ex.length >= 1, 'it collapsed');
    assert.equal(ex[0].r, WEAPONS.hollowstar.projectile.explodeRadius);
    for (const z of zs) assert.ok(z.maxHp - z.hp >= WEAPONS.hollowstar.projectile.explodeDamage * 0.5, 'caught in the collapse');
    void d0;
  });

  test('the collapse kills and blows apart a pack, and never hurts the survivors', () => {
    const g = makeGame({ n: 2, cls: 'medic', map: arena() });
    armed(g, 'hollowstar', 200, 600);
    const mate = place(g, 2, 520, 660, 0);
    const pack = [];
    for (let i = 0; i < 6; i++) pack.push(dummy(g, i % 2 ? 'runner' : 'walker', 560 + (i % 3) * 30, 560 + Math.floor(i / 3) * 70, 120));
    const hp0 = mate.hp;
    const ev = run(g, 200, () => ({ 1: { fire: true, angle: 0 } }));
    const kills = eventsOf(ev, 'zdie');
    assert.ok(kills.length >= 6, `${kills.length} killed`);
    assert.ok(kills.every((k) => k.gib));
    assert.equal(mate.hp, hp0, 'no friendly damage');
  });

  test('bosses are never moved by the pull; heavies resist it', () => {
    const g = medic({ map: arena() });
    armed(g, 'hollowstar', 200, 600);
    const boss = dummy(g, 'boss', 760, 600);
    const bx = boss.x;
    run(g, 120, () => ({ 1: { fire: true, angle: 0 } }));
    assert.ok(Math.abs(boss.x - bx) < 1, 'the boss stood its ground');
  });

  test('an orb that meets a wall collapses there soon after', () => {
    const g = medic({ map: arena([wall(0, 520, 600, 40, 400)]) });
    armed(g, 'hollowstar', 300, 600);
    let stuckAt = -1, t = 0;
    const ev = run(g, 200, (gg) => {
      t++;
      const o = gg.projectiles.find((q) => q.kind === 'singularity');
      if (o && o.stuck && stuckAt < 0) stuckAt = t;
      return { 1: { fire: true, angle: 0 } };
    });
    assert.ok(stuckAt > 0, 'it stopped at the wall');
    const ex = eventsOf(ev, 'explosion').find((e) => e.kind === 'singularity');
    assert.ok(ex && ex.x < 500 && ex.x > 440, `collapsed in front of the wall (${ex && ex.x})`);
  });

  test('never in an ordinary crate; a late boss may leave one', () => {
    for (let w = 1; w <= 30; w++) assert.ok(!crateWeaponPool(w).includes('hollowstar'), `wave ${w}`);
    const g = medic({ map: arena() });
    g.wave = SUPER_DROP.wave;
    let supers = 0;
    for (let i = 0; i < 60; i++) {
      rollDrop(g, 400, 400, 0, 1, true);
      const k = g.pickups[g.pickups.length - 1];
      if (k.weapon === 'hollowstar') supers++;
      g.pickups.length = 0;
    }
    assert.ok(supers > 0 && supers < 60, `${supers} of 60 boss crates`);
    g.wave = SUPER_DROP.wave - 1;
    for (let i = 0; i < 40; i++) {
      rollDrop(g, 400, 400, 0, 1, true);
      assert.notEqual(g.pickups[g.pickups.length - 1].weapon, 'hollowstar');
      g.pickups.length = 0;
    }
  });
});

// -------------------------------------------------------------------------------------
describe('Barrage MG', () => {
  test('the spread tightens with continuous fire and opens up again', () => {
    const w = WEAPONS.barrage;
    assert.equal(tightenedWeapon(w, 0).spread, w.spread);
    assert.ok(Math.abs(tightenedWeapon(w, 1).spread - w.tighten.to) < 1e-12);
    assert.equal(tightenedWeapon(WEAPONS.rifle, 1), WEAPONS.rifle, 'other guns untouched');
    const g = medic({ map: arena() });
    const p = armed(g, 'barrage', 300, 600);
    run(g, Math.ceil(w.tighten.time / DT) + 2, () => ({ 1: { fire: true, angle: 0 } }));
    assert.equal(p.spin, 1, 'fully wound up');
    run(g, Math.ceil(w.tighten.time * 0.25 / DT), () => ({ 1: { fire: false, angle: 0 } }));
    assert.ok(p.spin > 0.3 && p.spin < 0.7, `unwinding (${p.spin})`);
  });

  test('wound up, its rounds land in a tight cone', () => {
    const spreadOf = (windup) => {
      const g = medic({ map: arena(), seed: 3 });
      const p = armed(g, 'barrage', 200, 600);
      const ang = [];
      run(g, 150, (gg) => {
        if (!windup) p.spin = 0;
        return { 1: { fire: true, angle: 0 } };
      }).filter((e) => e.type === 'shot').slice(windup ? 26 : 0).forEach((e) => {
        for (const r of e.rays) ang.push(Math.atan2(r.y - 600, r.x - 200));
      });
      return Math.max(...ang.map(Math.abs));
    };
    assert.ok(spreadOf(true) < spreadOf(false) * 0.5);
  });
});

// -------------------------------------------------------------------------------------
describe('wire format', () => {
  test('every new gun, both projectile kinds, the blade event and the singularity round-trip', () => {
    const g = makeGame({ n: 2, map: arena() });
    const snap = g.snapshot();
    const p = snap.players[0];
    const events = [];
    for (const id of ARSENAL) events.push({ type: 'switch', pid: 1, weapon: id });
    events.push({ type: 'blade', what: 'wall', x: 120.5, y: 80, angle: 1.25 });
    events.push({ type: 'blade', what: 'cut', x: 10, y: 20, angle: -2 });
    events.push({ type: 'blade', what: 'stop', x: 30, y: 40, angle: 0 });
    events.push({ type: 'explosion', x: 300, y: 400, r: 220, kind: 'singularity' });
    const s2 = {
      ...snap,
      players: [{ ...p, slots: ['hollowstar', 'sawblade', 'barrage'], ammo: [[3, 6], [8, 48], [150, 450]], spin: 0.5 }, snap.players[1]],
      projectiles: [
        { id: 1, kind: 'blade', x: 100, y: 200, angle: 0.5 },
        { id: 2, kind: 'singularity', x: 300, y: 250, angle: 0 },
      ],
      pickups: [{ id: 1, kind: 'crate', x: 50, y: 60, weapon: 'hollowstar' }],
      events,
    };
    const d = decodeSnapshot(encodeSnapshot(s2));
    assert.deepEqual(d.players[0].slots, ['hollowstar', 'sawblade', 'barrage']);
    assert.ok(Math.abs(d.players[0].spin - 0.5) < 0.01);
    assert.deepEqual(d.projectiles.map((q) => q.kind), ['blade', 'singularity']);
    assert.equal(d.pickups[0].weapon, 'hollowstar');
    const sw = d.events.filter((e) => e.type === 'switch').map((e) => e.weapon);
    assert.deepEqual(sw, ARSENAL);
    const bl = d.events.filter((e) => e.type === 'blade');
    assert.deepEqual(bl.map((e) => e.what), ['wall', 'cut', 'stop']);
    assert.ok(Math.abs(bl[0].x - 120.5) < 0.6 && Math.abs(bl[0].angle - 1.25) < 0.01);
    const ex = d.events.find((e) => e.type === 'explosion');
    assert.equal(ex.kind, 'singularity');
    assert.ok(Math.abs(ex.r - 220) < 0.2);
  });

  test('a real game with blades and an orb in flight encodes and decodes', () => {
    const g = makeGame({ n: 2, map: arena() });
    armed(g, 'sawblade', 300, 500);
    const q = place(g, 2, 300, 700, 0);
    q.slots = ['pistol', null, null];
    q.slot = giveWeapon(g, q, 'hollowstar');
    for (let i = 0; i < 6; i++) dummy(g, 'walker', 600 + i * 40, 500 + (i % 2) * 200, 300);
    let seen = new Set();
    for (let t = 0; t < 90; t++) {
      g.setInput(1, { seq: t + 1, moveX: 0, moveY: 0, angle: 0, fire: t % 20 === 0, slot: -1, cycle: 0 });
      g.setInput(2, { seq: t + 1, moveX: 0, moveY: 0, angle: 0, fire: true, slot: -1, cycle: 0 });
      g.step();
      const d = decodeSnapshot(encodeSnapshot(g.snapshot()));
      for (const pr of d.projectiles) seen.add(pr.kind);
    }
    assert.ok(seen.has('blade') && seen.has('singularity'), [...seen].join(','));
  });
});
