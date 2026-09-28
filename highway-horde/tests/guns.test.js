// The eight guns added after launch and their mechanics: burst fire, round-by-round
// reloads, the flare that burns (and lights) where it lands, cryo frost (slow, freeze,
// thaw), the chainsaw's cutting cone, the harpoon that skewers and pins, the .50 that
// punches through thin cover — plus a completeness check that every gun has what the
// renderers, the audio engine, the shop and the bots need.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DT } from '../public/js/shared/constants.js';
import {
  WEAPONS, WEAPON_IDS, PROJECTILE_KINDS, FROST, effectiveRate, fullReloadTime, crateWeaponPool,
} from '../public/js/shared/weapons.js';
import { ZFLAG } from '../public/js/shared/zombies.js';
import { giveWeapon } from '../public/js/shared/sim/players.js';
import { damageZombie, igniteZombie, chillZombie } from '../public/js/shared/sim/combat.js';
import { GUN_VALUE, nextPurchase, gunScore } from '../public/js/shared/sim/bots.js';
import { SOUNDS } from '../public/js/audio/sounds.js';
import { RELOADS } from '../public/js/audio/audio.js';
import { CATEGORY } from '../public/js/ui/shop.js';
import { makeGame, addZombie, place, run, eventsOf, buildArenaMap } from './helpers/sim-helpers.js';

const NEW_GUNS = ['flare', 'tommy', 'burst_rifle', 'lever', 'chainsaw', 'harpoon', 'cryo', 'amr'];

/** A player holding `wid` in slot 1 at (x, y) facing `angle` (medic: no damage/reload perks). */
function armed(g, wid, x = 300, y = 900, angle = 0) {
  const p = place(g, 1, x, y, angle);
  p.slots = ['pistol', null, null];
  p.slot = giveWeapon(g, p, wid);
  return p;
}

/** A zombie that stands still and doesn't die. */
function dummy(g, type, x, y, hp = 1e6) {
  const z = addZombie(g, type, x, y);
  z.speed = 0;
  z.hp = z.maxHp = hp;
  return z;
}

const medic = () => makeGame({ cls: 'medic' });

// -------------------------------------------------------------------------------------
describe('burst rifle', () => {
  test('one tap fires exactly one 3-round burst, finishing after the trigger is released', () => {
    const g = medic();
    const p = armed(g, 'burst_rifle');
    const w = WEAPONS.burst_rifle;
    const ev = run(g, 60, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    const shots = eventsOf(ev, 'shot');
    assert.equal(shots.length, w.burst, 'one burst');
    assert.equal(p.mag[p.slot], w.mag - w.burst);
    assert.equal(p.burstLeft, 0);
  });

  test('holding the trigger fires bursts separated by the burst delay', () => {
    const g = medic();
    const p = armed(g, 'burst_rifle');
    const w = WEAPONS.burst_rifle;
    const shotTicks = [];
    for (let t = 0; t < 120; t++) {
      const before = p.mag[p.slot];
      run(g, 1, () => ({ 1: { fire: true, angle: 0 } }));
      if (p.mag[p.slot] < before) shotTicks.push(t);
    }
    assert.ok(shotTicks.length >= 9);
    const gaps = shotTicks.slice(1).map((t, i) => t - shotTicks[i]);
    // pattern: short, short, long, short, short, long ...
    for (let i = 0; i < gaps.length; i++) {
      const want = (i % w.burst) === w.burst - 1 ? w.burstDelay / DT : 1 / w.rate / DT;
      assert.ok(Math.abs(gaps[i] - want) <= 1, `gap ${i}: ${gaps[i]} ticks vs ${want}`);
    }
    assert.ok(Math.abs(effectiveRate(w) - w.burst / ((w.burst - 1) / w.rate + w.burstDelay)) < 1e-9);
    assert.ok(effectiveRate(w) < w.rate / 2, 'the pauses cost real fire rate');
  });

  test('switching weapons or starting a reload cancels a burst in progress', () => {
    const g = medic();
    const p = armed(g, 'burst_rifle');
    run(g, 1, () => ({ 1: { fire: true, angle: 0 } }));
    assert.equal(p.burstLeft, 2);
    const ev = run(g, 30, (_, t) => ({ 1: { fire: false, slot: t === 0 ? 0 : -1 } }));
    assert.equal(eventsOf(ev, 'shot').filter((s) => s.weapon === 'burst_rifle').length, 0);
    assert.equal(p.burstLeft, 0);
  });
});

// -------------------------------------------------------------------------------------
describe('lever-action rifle (round-by-round reload)', () => {
  test('loads one round per reload time until full, a reload event per round', () => {
    const g = medic();
    const p = armed(g, 'lever');
    const w = WEAPONS.lever;
    p.mag[p.slot] = 0;
    const ev = run(g, Math.ceil(fullReloadTime(w) / DT) + 10, (_, t) => ({ 1: { reload: t === 0 } }));
    assert.equal(p.mag[p.slot], w.mag);
    assert.equal(p.res[p.slot], w.reserve - w.mag);
    const rl = eventsOf(ev, 'reload');
    assert.equal(rl.length, w.mag, 'one reload event per round');
    assert.ok(rl.every((e) => Math.abs(e.time - w.reload) < 1e-9));
    assert.equal(p.reloadT, 0);
  });

  test('a fresh trigger pull with a round in stops the reload and fires', () => {
    const g = medic();
    const p = armed(g, 'lever');
    const w = WEAPONS.lever;
    p.mag[p.slot] = 0;
    const two = Math.ceil((2 * w.reload) / DT) + 2;
    run(g, two, (_, t) => ({ 1: { reload: t === 0 } }));
    assert.equal(p.mag[p.slot], 2);
    assert.ok(p.reloadT > 0, 'still loading');
    const ev = run(g, 2, () => ({ 1: { fire: true, angle: 0 } }));
    assert.equal(eventsOf(ev, 'shot').length, 1);
    assert.equal(p.reloadT, 0, 'reload stopped');
    assert.equal(p.mag[p.slot], 1);
  });

  test('holding the trigger on an empty gun keeps loading instead of firing each round', () => {
    const g = medic();
    const p = armed(g, 'lever');
    const w = WEAPONS.lever;
    p.mag[p.slot] = 0;
    let full = false;
    const ev = run(g, Math.ceil(fullReloadTime(w) / DT) - 5, () => {
      if (p.mag[p.slot] === w.mag) full = true;
      return { 1: { fire: true, angle: 0 } };
    });
    assert.equal(eventsOf(ev, 'shot').length, 0);
    assert.equal(eventsOf(ev, 'empty').length, 1);
    assert.ok(!full && p.mag[p.slot] >= w.mag - 1);
    const later = run(g, 40, () => ({ 1: { fire: true, angle: 0 } }));
    assert.ok(eventsOf(later, 'shot').length >= 1);
  });

  test('pierces two zombies with heavy rounds', () => {
    const g = medic();
    armed(g, 'lever');
    const line = [420, 480, 540].map((x) => dummy(g, 'walker', x, 900));
    run(g, 2, () => ({ 1: { fire: true, angle: 0 } }));
    assert.deepEqual(line.map((z) => z.hp < z.maxHp), [true, true, false]);
    assert.ok(line[0].maxHp - line[0].hp >= WEAPONS.lever.damage * 0.99);
  });
});

// -------------------------------------------------------------------------------------
describe('flare gun', () => {
  test('a direct hit sets the zombie alight and the flare burns on the ground there', () => {
    const g = medic();
    armed(g, 'flare');
    const z = dummy(g, 'walker', 600, 900);
    const ev = run(g, 60, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    assert.equal(eventsOf(ev, 'shot').length, 1);
    assert.ok(z.hp < z.maxHp);
    assert.ok(z.burnT > 0, 'ignited');
    const fl = g.hazards.filter((h) => h.kind === 'flare');
    assert.equal(fl.length, 1);
    assert.ok(Math.hypot(fl[0].x - z.x, fl[0].y - z.y) < 40, 'dropped at the zombie');
    const snap = g.snapshot();
    assert.ok(snap.hazards.some((h) => h.kind === 'flare'));
  });

  test('a flare that hits nothing lands where it runs out and ignites zombies that walk in', () => {
    const g = medic();
    armed(g, 'flare', 300, 900, 0);
    run(g, 90, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    const fl = g.hazards.find((h) => h.kind === 'flare');
    assert.ok(fl, 'landed');
    const spec = WEAPONS.flare.projectile;
    assert.ok(fl.x > 300 + spec.speed * spec.life * 0.8, `landed at ${fl.x}`);
    const z = dummy(g, 'walker', fl.x, fl.y);
    run(g, 5);
    assert.ok(z.burnT > 0, 'walked into the flare');
    // burns out after its duration
    run(g, Math.ceil(spec.flare.duration / DT));
    assert.equal(g.hazards.filter((h) => h.kind === 'flare').length, 0);
  });

  test('the projectile travels as a flare in snapshots', () => {
    const g = medic();
    armed(g, 'flare');
    run(g, 3, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    assert.ok(g.snapshot().projectiles.some((pr) => pr.kind === 'flare'));
  });
});

// -------------------------------------------------------------------------------------
describe('cryo blaster (slow, freeze, thaw)', () => {
  test('frost slows a zombie in proportion to its chill', () => {
    const g = medic();
    place(g, 1, 800, 1100);
    const a = addZombie(g, 'walker', 200, 300);
    const b = addZombie(g, 'walker', 200, 500);
    a.speed = b.speed = 60;
    a.chill = 0.6;
    const ax = a.x, ay = a.y, bx = b.x, by = b.y;
    run(g, 20);
    const da = Math.hypot(a.x - ax, a.y - ay), db = Math.hypot(b.x - bx, b.y - by);
    assert.ok(da < db * 0.8, `chilled ${da.toFixed(1)} vs ${db.toFixed(1)}`);
    assert.ok(g.snapshot().zombies.find((z) => z.id === a.id).flags & ZFLAG.SLOWED);
  });

  test('a sustained stream freezes a zombie solid: no moving, no attacking, a freeze event', () => {
    const g = medic();
    armed(g, 'cryo');
    const z = addZombie(g, 'walker', 470, 900);
    z.hp = z.maxHp = 1e6;
    let froze = null;
    const ev = run(g, 120, () => ({ 1: { fire: true, angle: 0 } }), (gg) => {
      if (z.frozenT > 0 && !froze) froze = gg.tick;
      return !!froze;
    });
    assert.ok(froze, 'froze');
    assert.equal(eventsOf(ev, 'freeze').length, 1);
    assert.equal(eventsOf(ev, 'freeze')[0].id, z.id);
    assert.ok(g.snapshot().zombies[0].flags & ZFLAG.FROZEN);
    // frozen right next to the survivor: it stays put and never swings
    const p = g.getPlayer(1);
    place(g, 1, z.x - 34, z.y, 0);
    const x0 = z.x, y0 = z.y, hp = p.hp;
    const idle = run(g, Math.floor((FROST.freezeTime * 0.8) / DT) - 30);
    assert.equal(eventsOf(idle, 'zattack').length, 0);
    assert.ok(Math.hypot(z.x - x0, z.y - y0) < 1, 'did not move');
    assert.equal(p.hp, hp);
  });

  test('it thaws after freezeTime, still chilled, and the chill melts away', () => {
    const g = medic();
    place(g, 1, 800, 1100);
    const z = addZombie(g, 'walker', 300, 300);
    for (let i = 0; i < 40 && !z.frozenT; i++) chillZombie(g, z, WEAPONS.cryo.chill);
    assert.ok(z.frozenT > 0);
    run(g, Math.ceil(FROST.freezeTime / DT) + 1);
    assert.equal(z.frozenT, 0);
    assert.ok(Math.abs(z.chill - FROST.afterThaw) < 0.05, `chill ${z.chill}`);
    const f = g.snapshot().zombies[0].flags;
    assert.ok(f & ZFLAG.SLOWED);
    assert.ok(!(f & ZFLAG.FROZEN));
    run(g, Math.ceil(FROST.afterThaw / FROST.thaw / DT) + 5);
    assert.equal(z.chill, 0);
    assert.ok(!(g.snapshot().zombies[0].flags & ZFLAG.SLOWED));
  });

  test('frozen zombies are brittle; fire thaws them and frost puts fire out', () => {
    const g = medic();
    const z = dummy(g, 'walker', 300, 300, 1000);
    for (let i = 0; i < 40 && !z.frozenT; i++) chillZombie(g, z, 0.1);
    damageZombie(g, z, 100, 0);
    assert.ok(Math.abs(z.maxHp - z.hp - 100 * FROST.brittle) < 1e-6);
    igniteZombie(z, 20, 3, 0);
    assert.equal(z.frozenT, 0);
    assert.equal(z.chill, 0);
    chillZombie(g, z, 0.1);
    assert.equal(z.burnT, 0, 'frost puts the fire out');
  });

  test('bosses slow down but never freeze; brutes chill at half the rate', () => {
    const g = medic();
    const boss = dummy(g, 'boss', 300, 300);
    const brute = dummy(g, 'brute', 700, 300);
    for (let i = 0; i < 100; i++) {
      chillZombie(g, boss, 0.1);
      if (i < 10) chillZombie(g, brute, 0.1);
    }
    assert.equal(boss.frozenT, 0);
    assert.ok(boss.chill <= FROST.bossCap + 1e-9);
    assert.ok(Math.abs(brute.chill - 10 * 0.1 * FROST.heavyGain) < 1e-9);
  });
});

// -------------------------------------------------------------------------------------
describe('chainsaw (melee cone)', () => {
  test('cuts what is in front and in reach, not what is behind, to the side or too far', () => {
    const g = medic();
    const p = armed(g, 'chainsaw');
    const front = dummy(g, 'walker', 355, 900);
    const behind = dummy(g, 'walker', 240, 900);
    const side = dummy(g, 'walker', 300, 962);
    const far = dummy(g, 'walker', 420, 905);
    for (const z of [front, behind, side, far]) z.mass = 1;
    const ev = run(g, 1, () => ({ 1: { fire: true, angle: 0 } }));
    assert.ok(front.hp < front.maxHp, 'front cut');
    assert.equal(behind.hp, behind.maxHp);
    assert.equal(side.hp, side.maxHp);
    assert.equal(far.hp, far.maxHp);
    const shot = eventsOf(ev, 'shot')[0];
    assert.equal(shot.weapon, 'chainsaw');
    assert.equal(shot.rays.length, 1);
    assert.equal(shot.rays[0].hit, 1);
    assert.ok(front.maxHp - front.hp >= WEAPONS.chainsaw.damage * 0.99);
    assert.equal(p.mag[p.slot], WEAPONS.chainsaw.mag - 1, 'one unit of fuel per sweep');
  });

  test('sweeps the whole cone at its rate, shoves hard and gibs what it kills', () => {
    const g = medic();
    const p = armed(g, 'chainsaw');
    const pack = [[350, 880], [352, 925], [340, 900]].map(([x, y]) => dummy(g, 'walker', x, y));
    const weak = dummy(g, 'runner', 350, 860, 10);
    const ev = run(g, 60, () => ({ 1: { fire: true, angle: 0 } }));
    assert.ok(pack.every((z) => z.hp < z.maxHp), 'every zombie in the cone');
    const kill = eventsOf(ev, 'zdie').find((e) => e.id === weak.id);
    assert.ok(kill && kill.gib, 'gibbed');
    assert.ok(Math.abs(WEAPONS.chainsaw.mag - p.mag[p.slot] - WEAPONS.chainsaw.rate) <= 1, 'fuel at the sweep rate');
    const moved = pack.some((z) => z.x > 380);
    assert.ok(moved, 'knocked back');
  });

  test('fuel never runs out for good (a refuel is a reload) and it slows the wielder', () => {
    const w = WEAPONS.chainsaw;
    assert.equal(w.reserve, -1);
    assert.ok(w.moveMult < 1);
    const g = medic();
    const p = armed(g, 'chainsaw');
    p.mag[p.slot] = 1;
    run(g, Math.ceil((w.reload + 0.3) / DT), () => ({ 1: { fire: true, angle: 0 } }));
    assert.ok(p.mag[p.slot] > 0.5 * w.mag, 'refuelled');
  });

  test('bots never buy it, never want it from a crate and never switch to it', () => {
    const g = medic();
    g.wave = 20;
    const p = g.getPlayer(1);
    p.cash = 1e6;
    for (let i = 0; i < 20; i++) {
      const buy = nextPurchase(g, p);
      assert.notEqual(buy && buy.item, 'chainsaw');
      if (!buy) break;
      g.command(1, { type: 'buy', item: buy.item });
    }
    assert.equal(GUN_VALUE.chainsaw, 0);
    p.slots = ['pistol', 'chainsaw', null];
    p.mag = [12, 100, 0];
    p.res = [-1, -1, 0];
    const b = { p, crowd: 5, target: null };
    assert.equal(gunScore(g, b, 1, 30), 0);
    assert.ok(gunScore(g, b, 0, 30) > 0);
  });
});

// -------------------------------------------------------------------------------------
describe('harpoon gun', () => {
  test('pierces up to five zombies in a line', () => {
    const g = medic();
    armed(g, 'harpoon');
    const line = [400, 440, 480, 520, 560, 600].map((x) => dummy(g, 'walker', x, 900));
    run(g, 60, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    assert.deepEqual(line.map((z) => z.hp < z.maxHp), [true, true, true, true, true, false]);
  });

  test('drags skewered zombies along and pins them where it strikes a wall', () => {
    const obstacles = [{ id: 0, kind: 'container', x: 900, y: 900, w: 60, h: 300, a: 0, solid: true, color: '#777', wrecked: false, roof: null }];
    const g = makeGame({ cls: 'medic', map: { ...buildArenaMap({ objective: false }), obstacles } });
    armed(g, 'harpoon');
    const z = dummy(g, 'walker', 420, 900);
    z.mass = 0.2;
    run(g, 60, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }), (gg) => gg.projectiles.length === 0 && gg.tick > 2);
    assert.equal(g.projectiles.length, 0, 'harpoon stopped');
    assert.ok(z.x > 780, `dragged to the wall (x ${z.x.toFixed(0)})`);
    assert.ok(Math.abs(z.y - 900) < 3);
    assert.equal(z.mode, 3, 'pinned (stunned)');
    assert.ok(z.modeT > WEAPONS.harpoon.projectile.pin * 0.8);
    const x = z.x;
    run(g, 30);
    assert.ok(Math.abs(z.x - x) < 1, 'stays pinned');
  });

  test('bosses are skewered but never dragged', () => {
    const g = medic();
    armed(g, 'harpoon');
    const boss = dummy(g, 'boss', 460, 900);
    const x = boss.x;
    run(g, 40, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    assert.ok(boss.hp < boss.maxHp);
    assert.ok(Math.abs(boss.x - x) < 2);
  });
});

// -------------------------------------------------------------------------------------
describe('.50 anti-materiel rifle (cover penetration)', () => {
  const wall = (id, x, w, kind = 'car') => ({ id, kind, x, y: 900, w, h: 160, a: 0, solid: true, color: '#777', wrecked: false, roof: null });

  test('punches through a car (with some loss) but not a building; a sniper round stops at the car', () => {
    const obstacles = [wall(0, 500, 44), wall(1, 1150, 220, 'building')];
    const map = { ...buildArenaMap({ objective: false, width: 1600 }), obstacles };
    const w = WEAPONS.amr;
    for (const [gun, through] of [['amr', true], ['sniper', false]]) {
      const g = makeGame({ cls: 'medic', map });
      armed(g, gun);
      const behindCar = dummy(g, 'brute', 700, 900, 1e5);
      const behindBuilding = dummy(g, 'brute', 1400, 900, 1e5);
      const ev = run(g, 2, () => ({ 1: { fire: true, angle: 0 } }));
      assert.equal(behindCar.hp < behindCar.maxHp, through, `${gun} through the car`);
      assert.equal(behindBuilding.hp, behindBuilding.maxHp, `${gun} never through the building`);
      if (gun === 'amr') {
        assert.ok(Math.abs(behindCar.maxHp - behindCar.hp - w.damage * (1 - w.penetrate.loss)) < 1e-6);
        const ray = eventsOf(ev, 'shot')[0].rays[0];
        assert.equal(ray.hit, 1);
        assert.ok(Math.abs(ray.x - (1150 - 110)) < 2, `ray ends at the building (${ray.x})`);
      }
    }
  });

  test('goes through at most `walls` thin obstacles', () => {
    const obstacles = [wall(0, 450, 40), wall(1, 600, 40), wall(2, 750, 40)];
    const map = { ...buildArenaMap({ objective: false, width: 1600 }), obstacles };
    const g = makeGame({ cls: 'medic', map });
    armed(g, 'amr');
    const z1 = dummy(g, 'walker', 680, 900);
    const z2 = dummy(g, 'walker', 850, 900);
    run(g, 2, () => ({ 1: { fire: true, angle: 0 } }));
    const w = WEAPONS.amr;
    assert.equal(w.penetrate.walls, 2);
    assert.ok(Math.abs(z1.maxHp - z1.hp - w.damage * (1 - w.penetrate.loss) ** 2) < 1e-6, 'two walls in');
    assert.equal(z2.hp, z2.maxHp, 'the third wall stops it');
  });

  test('pierces a long line of zombies and blows them apart', () => {
    const g = medic();
    armed(g, 'amr', 150, 900);
    const line = Array.from({ length: 12 }, (_, i) => dummy(g, 'walker', 220 + i * 40, 900, 500));
    const ev = run(g, 2, () => ({ 1: { fire: true, angle: 0 } }));
    const kills = eventsOf(ev, 'zdie');
    assert.equal(kills.length, 12);
    assert.ok(kills.every((k) => k.gib));
    void line;
  });
});

// -------------------------------------------------------------------------------------
describe('every gun is complete', () => {
  const src = (f) => readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
  const guns3d = src('render3d/actor-guns.js');
  const vm = src('render3d/viewmodel.js');
  const topdown = src('render/actors.js');
  const KINDS = ['hitscan', 'projectile', 'flame', 'chain', 'rail', 'cryo', 'melee'];

  test('27 guns, the eight new ones and the belt-fed HMG included', () => {
    assert.equal(WEAPON_IDS.length, 27);
    assert.ok(WEAPONS.hmg);
    for (const id of NEW_GUNS) assert.ok(WEAPONS[id], id);
  });

  for (const id of WEAPON_IDS) {
    test(`${id}: data, HUD name, shop category, sound, reload, 2D sprite, 3D model`, () => {
      const w = WEAPONS[id];
      assert.equal(typeof w.name, 'string');
      assert.ok(w.short.length >= 2 && w.short.length <= 5, `short name ${w.short}`);
      assert.ok(CATEGORY[w.category], `shop category ${w.category}`);
      assert.ok(KINDS.includes(w.kind), `kind ${w.kind}`);
      for (const k of ['price', 'unlockWave', 'damage', 'rate', 'mag', 'reserve', 'reload', 'range', 'pierce', 'falloff', 'knockback', 'moveMult', 'recoil']) {
        assert.ok(Number.isFinite(w[k]), `${k}`);
      }
      assert.ok(w.rate > 0 && w.mag > 0 && w.reload > 0 && w.range > 0);
      assert.match(w.tracer, /^#[0-9a-f]{6}$/i);
      assert.ok(SOUNDS[w.sound] || SOUNDS[w.sound + '_loop'], `sound ${w.sound}`);
      assert.ok(RELOADS[id], 'reload choreography');
      for (const [snd] of RELOADS[id]) assert.ok(SOUNDS[snd], `reload sound ${snd}`);
      const sp = w.sprite;
      assert.ok(sp && sp.len > 0 && sp.width > 0 && /^#/.test(sp.color) && /^#/.test(sp.accent), 'sprite');
      assert.ok(guns3d.includes(`BUILDERS.${sp.style} =`), `3D model for style ${sp.style}`);
      assert.match(vm, new RegExp(`\\b${sp.style}: \\[`), `viewmodel placement for ${sp.style}`);
      if (sp.style !== 'rifle') assert.ok(topdown.includes(`'${sp.style}'`), `top-down sprite for ${sp.style}`);
      if (w.projectile) assert.ok(PROJECTILE_KINDS.includes(w.projectile.kind));
      if (w.burst) assert.ok(w.burst > 1 && w.burstDelay > 0);
      assert.ok(effectiveRate(w) > 0 && fullReloadTime(w) >= w.reload);
    });
  }

  test('short names are unique and new guns reach the crates by their unlock wave', () => {
    const shorts = WEAPON_IDS.map((id) => WEAPONS[id].short);
    assert.equal(new Set(shorts).size, shorts.length);
    for (const id of NEW_GUNS) assert.ok(crateWeaponPool(WEAPONS[id].unlockWave).includes(id), id);
  });

  test('the .50 is the most expensive gun and unlocks last', () => {
    for (const id of WEAPON_IDS) {
      assert.ok(WEAPONS[id].price <= WEAPONS.amr.price, id);
      assert.ok(WEAPONS[id].unlockWave <= WEAPONS.amr.unlockWave, id);
    }
  });
});

describe('belt-fed heavy MG', () => {
  test('500-round belt, fires on the first tick (no spin-up) and keeps going', () => {
    const w = WEAPONS.hmg;
    assert.equal(w.mag, 500);
    assert.ok(!w.spinup);
    assert.equal(WEAPON_IDS[WEAPON_IDS.length - 1], 'hmg', 'appended, so older weapon indices keep their meaning');
    const g = makeGame();
    const p = armed(g, 'hmg');
    const first = run(g, 1, () => ({ 1: { fire: true, angle: 0 } }));
    assert.equal(eventsOf(first, 'shot').length, 1);
    const ev = run(g, 60, () => ({ 1: { fire: true, angle: 0 } }));
    const shots = eventsOf(ev, 'shot').length;
    assert.ok(Math.abs(shots - w.rate) <= 1, `about ${w.rate} shots a second, got ${shots}`);
    assert.equal(p.mag[p.slot], 500 - 1 - shots);
  });

  test('sits between the LMG and the minigun', () => {
    const dps = (id) => WEAPONS[id].damage * WEAPONS[id].rate;
    assert.ok(dps('hmg') > dps('lmg') && dps('hmg') < dps('minigun'));
    assert.ok(WEAPONS.hmg.price > WEAPONS.lmg.price && WEAPONS.hmg.price < WEAPONS.minigun.price);
    assert.ok(GUN_VALUE.hmg > GUN_VALUE.lmg);
  });
});
