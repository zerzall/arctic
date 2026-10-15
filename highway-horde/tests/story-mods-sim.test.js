// Story mods in the simulation: a survivor's perks, weapon tiers and hideout upgrades become
// numbers the existing sim code paths use (sim/profile-mods.js), and a game without story
// specs is exactly what it always was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT, BLEEDOUT_TIME, REVIVE_HP, SELF_REVIVE_DELAY, STAMINA_MAX } from '../public/js/shared/constants.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { perksFor } from '../public/js/shared/classes.js';
import { weaponOf, applyProfileToPlayer } from '../public/js/shared/sim/profile-mods.js';
import { downPlayer, giveWeapon } from '../public/js/shared/sim/players.js';
import { killZombie } from '../public/js/shared/sim/combat.js';
import { tierMag } from '../public/js/shared/story/upgrades.js';
import { makeGame, addZombie, place, run, eventsOf } from './helpers/sim-helpers.js';

/** A one-player sandbox game whose player has this profile-derived spec. */
function storyGame(specOver = {}, { cls = 'soldier', players = null } = {}) {
  const spec = { loadout: ['pistol', 'rifle', null], ...specOver };
  const list = players || [{ id: 1, name: 'P1', color: 0, cls, story: spec }];
  return makeGame({ players: list });
}

test('without a spec nothing changes: no story mods, the plain gun table, class perks only', () => {
  const g = makeGame({ cls: 'soldier' });
  const p = g.getPlayer(1);
  assert.equal(p.story, undefined);
  assert.equal(weaponOf(p, 'rifle'), WEAPONS.rifle);
  assert.deepEqual(p.perks, perksFor('soldier'));
  assert.equal(p.maxHp, perksFor('soldier').maxHp);
  assert.deepEqual(p.slots, ['pistol', 'rifle', null]);
  assert.equal(p.mag[1], WEAPONS.rifle.mag);
  assert.equal(p.res[1], WEAPONS.rifle.reserve);
});

test('the loadout replaces the class kit and fills magazines and reserves from the tiered table', () => {
  const g = storyGame({ loadout: ['shotgun', 'rifle', 'magnum'], tiers: { rifle: 5, shotgun: 2 }, perks: { hoarder: 3 } });
  const p = g.getPlayer(1);
  assert.deepEqual(p.slots, ['shotgun', 'rifle', 'magnum']);
  assert.equal(p.slot, 1, 'starts on slot 1 like the classic kit');
  assert.equal(p.mag[1], tierMag(WEAPONS.rifle.mag, 5));
  assert.equal(p.res[1], Math.round(WEAPONS.rifle.reserve * 1.5));
  assert.equal(p.mag[0], tierMag(WEAPONS.shotgun.mag, 2));
  assert.equal(p.res[2], Math.round(WEAPONS.magnum.reserve * 1.5));
  // a loadout without the pistol: the pistol slot is just another gun
  const g2 = storyGame({ loadout: ['smg-that-does-not-exist', 'rifle', null] });
  assert.equal(g2.getPlayer(1).slots[0], 'pistol', 'unknown ids fall back to the pistol');
});

test('perks and hideout upgrades adjust hp, armour, speed, stamina, revive and heal numbers', () => {
  const g = storyGame({
    perks: { thick: 3, sprinter: 3, medic: 3, scavenger: 3, demolition: 3 },
    hideout: { infirmary: 2 },
    kit: { armor: 1, frag: 2, molotov: 1, barricade: 2, turret: 1 },
  }, { cls: 'scout' });
  const p = g.getPlayer(1);
  const base = perksFor('scout');
  assert.equal(p.maxHp, base.maxHp + 35);
  assert.equal(p.hp, p.maxHp);
  assert.equal(p.armor, 10 + 20 + 50);
  assert.ok(Math.abs(p.speedMult - base.speedMult * 1.1) < 1e-9);
  assert.ok(Math.abs(p.staminaMult - base.staminaMult * 1.5) < 1e-9);
  assert.ok(Math.abs(p.perks.reviveSpeed - 2 * 1.1) < 1e-9);
  assert.equal(p.perks.healAura, 1.2);
  assert.ok(Math.abs(p.perks.cashMult - base.cashMult * 1.2) < 1e-9);
  assert.ok(Math.abs(p.perks.explosiveMult - 1.5) < 1e-9);
  assert.equal(p.perks.explosiveRadius, 1.25);
  assert.equal(p.frags, 2);
  assert.equal(p.molotovs, 1);
  assert.equal(p.barricades, 2);
  assert.equal(p.turrets, 1);
  // the class table itself is never mutated
  assert.deepEqual(perksFor('scout'), base);
});

test('Quick Hands and reload tiers shorten the reload the sim reports', () => {
  const plain = storyGame({});
  const fast = storyGame({ perks: { quick: 3 }, tiers: { rifle: 5 } });
  const time = (g) => {
    const p = g.getPlayer(1);
    p.mag[p.slot] = 0;
    const ev = run(g, 2, () => ({ 1: { reload: true } }));
    return eventsOf(ev, 'reload')[0].time;
  };
  const t0 = time(plain), t1 = time(fast);
  assert.ok(Math.abs(t0 - WEAPONS.rifle.reload * perksFor('soldier').reloadMult) < 1e-9);
  assert.ok(Math.abs(t1 - WEAPONS.rifle.reload * 0.8 * 0.72 * perksFor('soldier').reloadMult) < 1e-9, `reload ${t1}`);
  assert.ok(t1 < t0);
});

test('a reload fills the tiered magazine from the boosted reserve', () => {
  const g = storyGame({ tiers: { rifle: 4 }, perks: { hoarder: 2 } });
  const p = g.getPlayer(1);
  const w = weaponOf(p, 'rifle');
  p.mag[1] = 0;
  p.res[1] = 100;
  run(g, 240, (_, t) => ({ 1: { reload: t === 0 } }), (gg) => !gg.getPlayer(1).reloadT);
  assert.equal(p.mag[1], w.mag);
  assert.equal(p.res[1], 100 - w.mag);
  assert.equal(w.mag, tierMag(WEAPONS.rifle.mag, 4));
});

test('a higher fire rate fires more rounds in the same time', () => {
  const count = (g) => {
    const p = g.getPlayer(1);
    p.mag[1] = 1000;
    p.res[1] = 1000;
    const ev = run(g, 180, () => ({ 1: { fire: true, angle: 0 } }));
    return eventsOf(ev, 'shot').length;
  };
  const a = count(storyGame({ loadout: ['pistol', 'rifle', null] }));
  const b = count(storyGame({ loadout: ['pistol', 'rifle', null], tiers: { rifle: 5 } }));
  assert.ok(b > a, `${b} > ${a}`);
  assert.ok(Math.abs(b / a - 1.15) < 0.06, `about 15% more (${b}/${a})`);
});

test('tier damage hits harder and Marksman keeps damage at range', () => {
  const dmgAt = (spec, dist) => {
    const g = storyGame(spec);
    place(g, 1, 300, 900, 0);
    const z = addZombie(g, 'walker', 300 + dist, 900);
    z.speed = 0;
    z.hp = z.maxHp = 1e6;
    const p = g.getPlayer(1);
    p.cooldown = 0;
    // the rifle's spread is tiny; aim the ray dead on for a clean number
    const w = weaponOf(p, 'rifle');
    const saved = w.spread;
    w.spread = 0;
    run(g, 2, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
    w.spread = saved;
    return z.maxHp - z.hp;
  };
  const base = dmgAt({}, 200);
  const tier5 = dmgAt({ tiers: { rifle: 5 } }, 200);
  assert.ok(base > 0);
  assert.ok(Math.abs(tier5 / base - 1.35) < 1e-6, `tier 5 = +35% (${tier5}/${base})`);
  const farBase = dmgAt({}, 1000);
  const farMarks = dmgAt({ perks: { marksman: 3 } }, 1000);
  assert.ok(farMarks > farBase * 1.1, `Marksman keeps damage at range (${farMarks} vs ${farBase})`);
  assert.ok(Math.abs(farMarks - WEAPONS.rifle.damage * perksFor('soldier').damageMult) < 1e-6, 'no falloff at rank 3');
});

test('Steady Hands and tiers tighten the spread the shot uses', () => {
  const g = storyGame({ tiers: { shotgun: 5 }, perks: { steady: 3 }, loadout: ['pistol', 'shotgun', null] });
  const p = g.getPlayer(1);
  const w = weaponOf(p, 'shotgun');
  assert.ok(Math.abs(w.spread - WEAPONS.shotgun.spread * 0.7 * 0.65) < 1e-12);
  assert.equal(WEAPONS.shotgun.spread, 0.28);
  // the shot event carries as many rays as pellets, all inside the tighter cone
  place(g, 1, 300, 900, 0);
  const ev = run(g, 2, (_, t) => ({ 1: { fire: t === 0, angle: 0 } }));
  const shot = eventsOf(ev, 'shot')[0];
  assert.equal(shot.rays.length, WEAPONS.shotgun.pellets);
  for (const r of shot.rays) {
    const a = Math.atan2(r.y - shot.y, r.x - shot.x);
    assert.ok(Math.abs(a) <= w.spread + 1e-6, `ray angle ${a} inside ±${w.spread}`);
  }
});

test('Iron Will lengthens the bleedout, Second Wind gives a faster self-revive and more health back', () => {
  const g = storyGame({ perks: { ironwill: 3, secondwind: 3 } });
  const p = g.getPlayer(1);
  assert.equal(p.selfRevive, true);
  downPlayer(g, p);
  assert.equal(p.bleedout, BLEEDOUT_TIME * 2);
  // self-revive after 35% of the normal delay, with +30 hp
  run(g, Math.ceil(SELF_REVIVE_DELAY * 0.35 / DT) + 3);
  assert.equal(p.state, 'alive');
  assert.equal(p.hp, Math.min(p.maxHp, REVIVE_HP + 30));
  assert.equal(p.selfRevive, false);
  // the plain game keeps the classic numbers
  const g2 = makeGame({});
  const q = g2.getPlayer(1);
  downPlayer(g2, q);
  assert.equal(q.bleedout, BLEEDOUT_TIME);
});

test('Field Medic revives faster', () => {
  const players = [
    { id: 1, name: 'A', color: 0, cls: 'soldier', story: { loadout: ['pistol', 'rifle', null], perks: { medic: 3 } } },
    { id: 2, name: 'B', color: 1, cls: 'soldier' },
  ];
  const g = makeGame({ players });
  place(g, 1, 500, 900, 0);
  place(g, 2, 520, 900, 0);
  const b = g.getPlayer(2);
  downPlayer(g, b);
  b.bleedout = 100;
  const ticks = run(g, 400, () => ({ 1: { interact: true } }), (gg) => gg.getPlayer(2).state === 'alive');
  assert.equal(b.state, 'alive');
  assert.ok(g.tick < 1.7 * 60 + 5, `revived in ${g.tick} ticks (3 s / 2)`);
  void ticks;
});

test('Lucky Loot raises the drop chance of the killer', () => {
  const count = (perks) => {
    const g = makeGame({ players: [{ id: 1, name: 'A', color: 0, cls: 'soldier', story: { loadout: ['pistol', 'rifle', null], perks } }], seed: 5 });
    let pickups = 0;
    for (let i = 0; i < 20000; i++) {
      const z = addZombie(g, 'walker', 400, 900);
      killZombie(g, z, 1, false);
      pickups += g.pickups.length;
      g.pickups.length = 0;
      g.zombies.length = 0;
      g.snapshot();
    }
    return pickups;
  };
  const base = count({});
  const lucky = count({ lucky: 3 });
  assert.ok(base > 600, `some drops happen (${base})`);
  assert.ok(lucky > base * 1.5, `Lucky Loot 3 drops about 75% more (${lucky} vs ${base})`);
  assert.ok(lucky < base * 2.1);
});

test('Demolition widens the owner\'s explosions and Second Wind only applies with a spec', () => {
  const radiusOf = (perks) => {
    const g = makeGame({ players: [{ id: 1, name: 'A', color: 0, cls: 'soldier', story: { loadout: ['pistol', 'rifle', null], perks } }] });
    const p = g.getPlayer(1);
    place(g, 1, 300, 900, 0);
    p.frags = 1;
    const ev = run(g, 200, (_, t) => ({ 1: { frag: t === 0, angle: 0 } }));
    return eventsOf(ev, 'explosion')[0].r;
  };
  assert.equal(radiusOf({}), 150);
  assert.equal(radiusOf({ demolition: 3 }), 150 * 1.25);
  const plain = makeGame({});
  assert.equal(plain.getPlayer(1).selfRevive, true, 'solo games still start with the kit (unchanged rule)');
});

test('crate guns and bought guns use the survivor\'s table too', () => {
  const g = storyGame({ tiers: { shotgun: 3 }, perks: { hoarder: 3 }, loadout: ['pistol', 'rifle', null] });
  const p = g.getPlayer(1);
  const slot = giveWeapon(g, p, 'shotgun');
  assert.equal(p.slots[slot], 'shotgun');
  assert.equal(p.mag[slot], tierMag(WEAPONS.shotgun.mag, 3));
  assert.equal(p.res[slot], Math.round(WEAPONS.shotgun.reserve * 1.5));
  // an ammo pickup tops up to the boosted reserve, not the plain one
  p.res[slot] = 0;
  g.pickups.push({ id: 900, kind: 'ammo', x: p.x, y: p.y, weapon: null, life: 10 });
  run(g, 3);
  assert.ok(p.res[slot] > 0);
  assert.ok(p.res[slot] <= Math.round(WEAPONS.shotgun.reserve * 1.5));
});

test('a respawn restores the story loadout, not the class kit', () => {
  const g = storyGame({ loadout: ['shotgun', 'magnum', null], tiers: { magnum: 2 } });
  const p = g.getPlayer(1);
  // what dying does to the loadout, then the wave clear
  p.slots = [null, null, null];
  p.mag = [0, 0, 0];
  p.res = [0, 0, 0];
  p.state = 'dead';
  p.respawn = true;
  p.hp = 0;
  g.wave = 1;
  g._waveClear();
  assert.equal(p.state, 'alive');
  assert.deepEqual(p.slots, ['shotgun', 'magnum', null]);
  assert.equal(p.mag[1], tierMag(WEAPONS.magnum.mag, 2));
  assert.equal(p.slot, 1);
});

test('a spec is sanitised again inside the sim (a hostile one cannot cheat)', () => {
  const g = storyGame({ tiers: { rifle: 99 }, perks: { thick: 99, steady: 99 }, kit: { turret: 99 }, hideout: { garden: 99 } });
  const p = g.getPlayer(1);
  assert.equal(p.maxHp, perksFor('soldier').maxHp + 35);
  assert.equal(weaponOf(p, 'rifle').tier, 5);
  assert.equal(p.turrets, 1);
  const bad = makeGame({ players: [{ id: 1, name: 'A', color: 0, cls: 'soldier', story: 'lol' }] });
  assert.equal(bad.getPlayer(1).story, undefined, 'an unusable spec leaves the classic kit');
  assert.equal(applyProfileToPlayer(bad, bad.getPlayer(1), null), null);
});

test('two games built from the same spec and inputs stay identical (determinism)', () => {
  const make = () => {
    const g = storyGame({ tiers: { rifle: 3 }, perks: { quick: 2, steady: 1 } });
    const z = addZombie(g, 'walker', 700, 900);
    z.speed = 0;
    return g;
  };
  const a = make(), b = make();
  const inputs = (_, t) => ({ 1: { fire: t % 40 < 30, angle: 0, reload: t === 90 } });
  run(a, 400, inputs);
  run(b, 400, inputs);
  const snap = (g) => JSON.stringify(g.snapshot());
  assert.equal(snap(a), snap(b));
});

test('stamina and movement speed use the story multipliers', () => {
  const g = storyGame({ perks: { sprinter: 3 } });
  const p = g.getPlayer(1);
  assert.ok(p.speedMult > perksFor('soldier').speedMult);
  assert.equal(p.stamina, STAMINA_MAX);
  place(g, 1, 300, 900, 0);
  const x0 = p.x;
  run(g, 60, () => ({ 1: { moveX: 1, angle: 0 } }));
  const fast = p.x - x0;
  const plain = makeGame({});
  const q = place(plain, 1, 300, 900, 0);
  const y0 = q.x;
  run(plain, 60, () => ({ 1: { moveX: 1, angle: 0 } }));
  assert.ok(fast > (q.x - y0) * 1.09, `10% farther in a second (${fast} vs ${q.x - y0})`);
});

