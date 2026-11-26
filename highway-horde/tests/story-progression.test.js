// Story layer: the XP curve, perks, weapon tiers, hideout upgrades and the mods that
// become sim numbers (shared/story/{progression,perks,upgrades,mods}.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LEVEL, MAX_XP, xpForLevel, levelForXp, xpBar, killXp, statsXp, catchUpMult, addXp, KILL_XP,
} from '../public/js/shared/story/progression.js';
import {
  PERKS, PERK_IDS, MAX_RANK, RANK_LEVELS, canBuyPerk, buyPerk, resetPerks, perkEffects, perkPointsSpent,
  totalPerkPoints, rankOf, neutralEffects,
} from '../public/js/shared/story/perks.js';
import {
  tierEffect, tierMag, tierCost, tierSpent, MAX_TIER, TIER_BASE_COST, canUpgradeWeapon, upgradeWeapon, canBuyWeapon, buyWeapon,
  grantWeapon, setLoadout, weaponChapter, weaponScrapCost, HIDEOUT_UPGRADES, HIDEOUT_IDS, hideoutEffects, upgradeTier,
  canUpgradeHideout, upgradeHideout, KIT_ITEMS,
} from '../public/js/shared/story/upgrades.js';
import { perkEffects as perkEffectsReal } from '../public/js/shared/story/perks.js';
import { specFromProfile, sanitizeSpec, storyMods, weaponFor, deriveWeapon } from '../public/js/shared/story/mods.js';
import { createProfile } from '../public/js/shared/story/profile.js';
import { createWorld } from '../public/js/shared/story/world.js';
import { WEAPONS, WEAPON_IDS } from '../public/js/shared/weapons.js';

// ---- XP curve -------------------------------------------------------------------------------

test('XP curve: cumulative XP to reach level L is round(90 * (L-1)^1.7)', () => {
  for (let l = 1; l <= MAX_LEVEL; l++) {
    assert.equal(xpForLevel(l), l === 1 ? 0 : Math.round(90 * Math.pow(l - 1, 1.7)), `level ${l}`);
  }
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 90);
  assert.equal(xpForLevel(3), 292);
  assert.equal(xpForLevel(20), Math.round(90 * Math.pow(19, 1.7)));
  assert.equal(MAX_XP, xpForLevel(20));
  assert.equal(MAX_LEVEL, 20);
  // clamped outside the range
  assert.equal(xpForLevel(0), 0);
  assert.equal(xpForLevel(99), xpForLevel(20));
  assert.equal(xpForLevel(NaN), 0);
});

test('levelForXp inverts xpForLevel, caps at 20 and never exceeds it', () => {
  for (let l = 1; l <= MAX_LEVEL; l++) {
    assert.equal(levelForXp(xpForLevel(l)), l);
    if (l > 1) assert.equal(levelForXp(xpForLevel(l) - 1), l - 1);
  }
  assert.equal(levelForXp(-5), 1);
  assert.equal(levelForXp('x'), 1);
  assert.equal(levelForXp(1e9), MAX_LEVEL);
});

test('xpBar reports progress inside the level and 1 at the cap', () => {
  const b = xpBar({ xp: 90 + 100 });
  assert.equal(b.level, 2);
  assert.equal(b.floor, 90);
  assert.equal(b.next, 292);
  assert.equal(b.into, 100);
  assert.ok(Math.abs(b.frac - 100 / 202) < 1e-9);
  assert.equal(b.maxed, false);
  const top = xpBar({ xp: 1e9 });
  assert.equal(top.level, MAX_LEVEL);
  assert.equal(top.maxed, true);
  assert.equal(top.frac, 1);
});

test('XP per kill by type, elites pay double, stats fold objectives and revives in', () => {
  for (const t of Object.keys(KILL_XP)) assert.equal(killXp(t), KILL_XP[t]);
  assert.equal(killXp('brute', true), KILL_XP.brute * 2);
  assert.equal(killXp('mystery'), 2);
  assert.equal(statsXp(null), 0);
  assert.equal(statsXp({ kinds: { walker: 10, runner: 2 } }), 10 * KILL_XP.walker + 2 * KILL_XP.runner);
  // a plain kill count without a breakdown pays like walkers; the breakdown is not counted twice
  assert.equal(statsXp({ kills: 10 }), 10 * KILL_XP.walker);
  assert.equal(statsXp({ kills: 12, kinds: { runner: 2 } }), 2 * KILL_XP.runner + 10 * KILL_XP.walker);
  assert.equal(statsXp({ objectives: 3, revives: 2 }), 3 * 20 + 2 * 15);
  assert.equal(statsXp({ kills: -5, objectives: 'lots' }), 0);
});

test('catch-up: 10% more XP per level below the mission, at most 50%', () => {
  assert.equal(catchUpMult(5, 5), 1);
  assert.equal(catchUpMult(9, 5), 1);
  assert.ok(Math.abs(catchUpMult(3, 5) - 1.2) < 1e-9);
  assert.equal(catchUpMult(1, 20), 1.5);
  assert.equal(catchUpMult(1, 0), 1);
});

test('addXp: level-ups give one perk point each, the cap holds, the input stays unchanged', () => {
  const p = createProfile({ name: 'A' });
  const before = JSON.stringify(p);
  const r = addXp(p, 300);
  assert.equal(JSON.stringify(p), before);
  assert.equal(r.profile.xp, 300);
  assert.equal(r.fromLevel, 1);
  assert.equal(r.toLevel, 3);
  assert.deepEqual(r.levels, [2, 3]);
  assert.equal(r.perkPointsGained, 2);
  assert.equal(r.profile.perkPoints, 2);
  assert.equal(r.profile.level, 3);
  const cap = addXp(r.profile, 1e7);
  assert.equal(cap.profile.xp, MAX_XP);
  assert.equal(cap.profile.level, MAX_LEVEL);
  assert.equal(cap.profile.perkPoints + 0, 19, 'a level-20 survivor has earned 19 points in all');
  assert.equal(addXp(cap.profile, 500).gained, 0);
  assert.equal(addXp(p, -20).gained, 0);
  assert.equal(addXp(p, 'x').gained, 0);
});

// ---- perks ----------------------------------------------------------------------------------

test('twelve perks with three ranks each, every rank has text and numbers', () => {
  assert.equal(PERK_IDS.length, 12);
  assert.deepEqual(PERK_IDS.slice().sort(), [
    'demolition', 'hoarder', 'ironwill', 'lucky', 'marksman', 'medic', 'quick', 'scavenger', 'secondwind', 'sprinter', 'steady', 'thick',
  ]);
  for (const id of PERK_IDS) {
    const p = PERKS[id];
    assert.equal(p.id, id);
    assert.ok(p.name && p.desc);
    assert.equal(p.ranks.length, MAX_RANK);
    for (const r of p.ranks) {
      assert.ok(r.text);
      assert.ok(Object.keys(r).length >= 2, `${id} rank has an effect`);
    }
  }
  assert.equal(PERKS.steady.name, 'Steady Hands');
  assert.equal(PERKS.medic.name, 'Field Medic');
  assert.equal(PERKS.secondwind.name, 'Second Wind');
});

test('every perk strictly improves with its rank', () => {
  const better = (id, key, dir) => {
    const v = PERKS[id].ranks.map((r) => r[key]);
    for (let i = 1; i < v.length; i++) assert.ok(dir > 0 ? v[i] > v[i - 1] : v[i] < v[i - 1], `${id}.${key} rank ${i + 1}`);
  };
  better('steady', 'spread', -1);
  better('quick', 'reload', -1);
  better('thick', 'hp', 1);
  better('medic', 'reviveSpeed', 1);
  better('scavenger', 'scrap', 1);
  better('hoarder', 'reserve', 1);
  better('sprinter', 'speed', 1);
  better('ironwill', 'bleedout', 1);
  better('demolition', 'explosive', 1);
  better('demolition', 'radius', 1);
  better('marksman', 'falloffFix', 1);
  better('lucky', 'drop', 1);
});

test('buying perks: points, level gates, max rank, reset refunds', () => {
  let p = { ...createProfile({ name: 'A' }), level: 1, perkPoints: 0 };
  assert.deepEqual(canBuyPerk(p, 'steady'), { ok: false, reason: 'points' });
  p = { ...p, level: 5, perkPoints: 4 };
  assert.deepEqual(canBuyPerk(p, 'nope'), { ok: false, reason: 'unknown' });
  let r = buyPerk(p, 'steady');
  assert.equal(r.ok, true);
  assert.equal(r.profile.perks.steady, 1);
  assert.equal(r.profile.perkPoints, 3);
  assert.equal(p.perkPoints, 4, 'input untouched');
  r = buyPerk(r.profile, 'steady');
  assert.equal(r.profile.perks.steady, 2);
  // rank 3 needs level 8
  assert.deepEqual(canBuyPerk(r.profile, 'steady'), { ok: false, reason: 'level' });
  const lv8 = { ...r.profile, level: 8, perkPoints: 5 };
  const r3 = buyPerk(lv8, 'steady');
  assert.equal(r3.profile.perks.steady, 3);
  assert.deepEqual(canBuyPerk(r3.profile, 'steady'), { ok: false, reason: 'max' });
  assert.deepEqual(RANK_LEVELS, [1, 4, 8]);
  const back = resetPerks({ ...r3.profile, perkPoints: 2 });
  assert.deepEqual(back.perks, {});
  assert.equal(back.perkPoints, 2 + 3);
  assert.equal(perkPointsSpent(r3.profile.perks), 3);
  assert.equal(totalPerkPoints(20), 19);
  assert.equal(totalPerkPoints(1), 0);
  assert.equal(rankOf({ steady: 2 }, 'steady'), 2);
  assert.equal(rankOf({ steady: 2 }, 'toString'), 0);
});

test('perkEffects: neutral with no perks, multipliers multiply, bonuses add', () => {
  assert.deepEqual(perkEffects({}), neutralEffects());
  const fx = perkEffects({ steady: 3, quick: 1, thick: 3, medic: 2, hoarder: 3, marksman: 3, secondwind: 3 });
  assert.equal(fx.spread, 0.65);
  assert.equal(fx.reload, 0.92);
  assert.equal(fx.hp, 35);
  assert.equal(fx.armor, 10);
  assert.equal(fx.reviveSpeed, 1.5);
  assert.equal(fx.healAura, 0.6);
  assert.equal(fx.reserve, 1.5);
  assert.equal(fx.frags, 1);
  assert.equal(fx.falloffFix, 1);
  assert.equal(fx.range, 1.1);
  assert.equal(fx.kit, 1);
  assert.equal(fx.reviveDelay, 0.35);
  assert.equal(fx.reviveHp, 30);
  // unknown ids and bad ranks are ignored
  assert.deepEqual(perkEffects({ bogus: 3, steady: 'x', quick: 99 }), perkEffects({ quick: 3 }));
});

// ---- weapon tiers ---------------------------------------------------------------------------

test('tier effects: +7% damage, -4% reload, -6% spread per tier, tier 0 changes nothing', () => {
  assert.deepEqual(tierEffect(0), { damage: 1, rate: 1, reload: 1, spread: 1, mag: 0 });
  const t5 = tierEffect(5);
  assert.equal(t5.damage, 1.35);
  assert.equal(t5.reload, 0.8);
  assert.equal(t5.spread, 0.7);
  assert.equal(t5.rate, 1.15);
  assert.equal(tierEffect(9).damage, t5.damage, 'tier is capped');
  assert.equal(MAX_TIER, 5);
  for (let t = 1; t <= MAX_TIER; t++) {
    assert.ok(tierEffect(t).damage > tierEffect(t - 1).damage);
    assert.ok(tierEffect(t).reload < tierEffect(t - 1).reload);
  }
});

test('tier magazines grow: about +8% a tier, small magazines a round every two tiers', () => {
  assert.equal(tierMag(30, 0), 30);
  assert.equal(tierMag(30, 5), 30 + 12);
  assert.equal(tierMag(2, 2), 2 + 0 + 1);
  assert.equal(tierMag(2, 5), 2 + 1 + 2);
  assert.equal(tierMag(1, 5), 1 + 0 + 2);
  for (const id of WEAPON_IDS) {
    let prev = tierMag(WEAPONS[id].mag, 0);
    for (let t = 1; t <= MAX_TIER; t++) {
      const m = tierMag(WEAPONS[id].mag, t);
      assert.ok(m >= prev, `${id} mag never shrinks`);
      prev = m;
    }
  }
});

test('tier costs rise with the tier and with the gun', () => {
  for (const id of WEAPON_IDS) {
    let prev = 0;
    for (let t = 1; t <= MAX_TIER; t++) {
      const c = tierCost(id, t);
      assert.ok(c > prev, `${id} tier ${t}`);
      assert.equal(c % 5, 0);
      prev = c;
    }
  }
  assert.ok(tierCost('minigun', 3) > tierCost('pistol', 3));
  assert.equal(tierCost('pistol', 0), 0);
  assert.equal(tierCost('bogus', 1), 0);
  assert.equal(tierSpent('rifle', 0), 0);
  assert.equal(tierSpent('rifle', 2), tierCost('rifle', 1) + tierCost('rifle', 2));
  assert.equal(TIER_BASE_COST.length, MAX_TIER + 1);
});

test('workbench: upgrade an owned gun step by step with scrap', () => {
  let p = { ...createProfile({ name: 'A', cls: 'soldier' }), scrap: 1000 };
  assert.deepEqual(canUpgradeWeapon(p, 'minigun'), { ok: false, reason: 'unowned' });
  assert.deepEqual(canUpgradeWeapon(p, 'x'), { ok: false, reason: 'unknown' });
  const cost1 = tierCost('rifle', 1);
  const r = upgradeWeapon(p, 'rifle');
  assert.equal(r.ok, true);
  assert.equal(r.cost, cost1);
  assert.equal(r.profile.weapons.rifle.tier, 1);
  assert.equal(r.profile.scrap, 1000 - cost1);
  assert.equal(p.weapons.rifle.tier, 0, 'input untouched');
  // a discount lowers the price
  assert.ok(upgradeWeapon(p, 'rifle', 0.8).cost < cost1);
  // not enough scrap
  const poor = { ...p, scrap: cost1 - 1 };
  assert.equal(canUpgradeWeapon(poor, 'rifle').reason, 'scrap');
  // max tier
  let m = { ...p, scrap: 99999 };
  for (let i = 0; i < MAX_TIER; i++) m = upgradeWeapon(m, 'rifle').profile;
  assert.equal(m.weapons.rifle.tier, MAX_TIER);
  assert.equal(canUpgradeWeapon(m, 'rifle').reason, 'max');
});

test('workbench: buy guns with scrap, gated by chapter; rewards grant free', () => {
  const p = { ...createProfile({ name: 'A' }), scrap: 5000 };
  assert.equal(weaponScrapCost('pistol'), 0);
  assert.equal(weaponScrapCost('minigun'), 800);
  assert.equal(weaponChapter('shotgun'), 1);
  assert.ok(weaponChapter('minigun') > weaponChapter('shotgun'));
  assert.equal(canBuyWeapon(p, 'pistol').reason, 'owned');
  assert.equal(canBuyWeapon(p, 'minigun', 1).reason, 'locked');
  const ok = buyWeapon(p, 'shotgun', 1);
  assert.equal(ok.ok, true);
  assert.equal(ok.profile.scrap, 5000 - weaponScrapCost('shotgun'));
  assert.deepEqual(ok.profile.weapons.shotgun, { tier: 0 });
  assert.equal(buyWeapon({ ...p, scrap: 5 }, 'shotgun', 1).reason, 'scrap');
  const g = grantWeapon(p, 'dmr');
  assert.deepEqual(g.weapons.dmr, { tier: 0 });
  assert.equal(grantWeapon(g, 'dmr'), g, 'no change when owned');
  assert.equal(grantWeapon(p, 'nope'), p);
});

test('loadout: three owned guns, slot 0 required, no duplicates', () => {
  const p = grantWeapon(createProfile({ name: 'A', cls: 'soldier' }), 'shotgun');
  assert.equal(setLoadout(p, ['shotgun', 'rifle', 'pistol']).ok, true);
  assert.deepEqual(setLoadout(p, ['shotgun', 'rifle', 'pistol']).profile.loadout, ['shotgun', 'rifle', 'pistol']);
  assert.equal(setLoadout(p, [null, 'rifle', null]).reason, 'empty');
  assert.equal(setLoadout(p, ['shotgun', 'shotgun', null]).reason, 'duplicate');
  assert.equal(setLoadout(p, ['minigun', null, null]).reason, 'unowned');
  assert.equal(setLoadout(p, 'x').reason, 'invalid');
});

// ---- hideout upgrades -----------------------------------------------------------------------

test('hideout: seven upgrade lines with three tiers and rising costs', () => {
  assert.deepEqual(HIDEOUT_IDS, ['generator', 'watchtower', 'infirmary', 'armory', 'radio', 'garden', 'palisade']);
  for (const id of HIDEOUT_IDS) {
    const u = HIDEOUT_UPGRADES[id];
    assert.equal(u.tiers.length, 3);
    for (let i = 1; i < 3; i++) {
      assert.ok(u.tiers[i].cost.scrap > u.tiers[i - 1].cost.scrap, `${id} scrap rises`);
      assert.ok(u.tiers[i].cost.parts >= u.tiers[i - 1].cost.parts);
    }
    for (const t of u.tiers) assert.ok(t.text && t.fx);
  }
});

test('hideout effects combine tiers: none neutral, then armour, reserve, xp, scrap, turrets, barricades', () => {
  const none = hideoutEffects({});
  assert.equal(none.armor, 0);
  assert.equal(none.reserve, 1);
  assert.equal(none.xp, 1);
  const fx = hideoutEffects({ infirmary: 3, armory: 2, radio: 3, garden: 1, watchtower: 3, palisade: 2, generator: 2 });
  assert.equal(fx.armor, 30);
  assert.equal(fx.reviveSpeed, 1.2);
  assert.equal(fx.reserve, 1.16);
  assert.equal(fx.xp, 1.06);
  assert.equal(fx.scrap, 1.08);
  assert.equal(fx.turrets, 1);
  assert.equal(fx.barricades, 2);
  assert.equal(fx.bench, 0.9);
  assert.equal(upgradeTier({ radio: 9 }, 'radio'), 3);
  assert.equal(upgradeTier({ radio: 'x' }, 'radio'), 0);
  assert.equal(upgradeTier({ radio: 2 }, '__proto__'), 0);
});

test('buying a hideout tier spends the stash, needs the chapter, stops at tier 3', () => {
  let w = createWorld({ name: 'Crew' });
  w.hideout.stash.scrap = 1000;
  w.hideout.stash.parts = 10;
  const can = canUpgradeHideout(w, 'garden', 1);
  assert.equal(can.ok, true);
  assert.deepEqual(can.cost, HIDEOUT_UPGRADES.garden.tiers[0].cost);
  const r = upgradeHideout(w, 'garden', 1);
  assert.equal(r.upgrades.garden, 1);
  assert.equal(r.stash.scrap, 1000 - HIDEOUT_UPGRADES.garden.tiers[0].cost.scrap);
  assert.equal(r.stash.parts, 10 - HIDEOUT_UPGRADES.garden.tiers[0].cost.parts);
  assert.equal(w.hideout.stash.scrap, 1000, 'input untouched');
  // tier 2 needs chapter 2, tier 3 chapter 4
  w = { ...w, hideout: { ...w.hideout, upgrades: { garden: 1 } } };
  assert.deepEqual(canUpgradeHideout(w, 'garden', 1), { ok: false, reason: 'chapter', need: 2 });
  assert.equal(canUpgradeHideout(w, 'garden', 2).ok, true);
  w = { ...w, hideout: { ...w.hideout, upgrades: { garden: 2 } } };
  assert.deepEqual(canUpgradeHideout(w, 'garden', 3), { ok: false, reason: 'chapter', need: 4 });
  w = { ...w, hideout: { ...w.hideout, upgrades: { garden: 3 } } };
  assert.equal(canUpgradeHideout(w, 'garden', 6).reason, 'max');
  assert.equal(canUpgradeHideout(w, 'moat', 6).reason, 'unknown');
  const poor = createWorld({ name: 'P' });
  poor.hideout.stash.scrap = 10;
  assert.equal(canUpgradeHideout(poor, 'garden', 1).reason, 'scrap');
  poor.hideout.stash.scrap = 500;
  poor.hideout.stash.parts = 0;
  assert.equal(canUpgradeHideout(poor, 'garden', 1).reason, 'parts');
  for (const k of Object.keys(KIT_ITEMS)) assert.ok(KIT_ITEMS[k].scrap > 0 && KIT_ITEMS[k].max > 0);
});

// ---- mods: perks and tiers become sim numbers -------------------------------------------------

test('specFromProfile keeps only what matters and sanitizeSpec repairs a hostile one', () => {
  let p = createProfile({ name: 'A', cls: 'soldier' });
  p = { ...p, level: 10, perks: { steady: 2, quick: 3 }, weapons: { ...p.weapons, rifle: { tier: 3 }, pistol: { tier: 1 } }, kit: { frag: 2, turret: 1 } };
  const spec = specFromProfile(p, { armory: 2, infirmary: 1 });
  assert.deepEqual(spec.perks, { steady: 2, quick: 3 });
  assert.deepEqual(spec.tiers, { rifle: 3, pistol: 1 });
  assert.deepEqual(spec.hideout, { armory: 2, infirmary: 1 });
  assert.deepEqual(spec.kit, { frag: 2, turret: 1 });
  assert.deepEqual(spec.loadout, ['pistol', 'rifle', null]);
  const hostile = sanitizeSpec({
    lvl: 'x', loadout: ['nope', 'rifle', 'rifle', 'pistol'], tiers: { rifle: 99, bogus: 3, __proto__: 4 },
    perks: { steady: 9, bogus: 1 }, hideout: { garden: 8 }, kit: { frag: 99, cheese: 2 },
  });
  assert.deepEqual(hostile.loadout, ['pistol', 'rifle', null]);
  assert.deepEqual(hostile.tiers, { rifle: 5 });
  assert.deepEqual(hostile.perks, { steady: 3 });
  assert.deepEqual(hostile.hideout, { garden: 3 });
  assert.deepEqual(hostile.kit, { frag: 3 });
  assert.equal(sanitizeSpec(null), null);
  assert.equal(sanitizeSpec('x'), null);
});

test('storyMods: perks and hideout upgrades fold into flat numbers', () => {
  const spec = sanitizeSpec({
    perks: { thick: 3, sprinter: 3, ironwill: 3, medic: 3, lucky: 3, secondwind: 2, demolition: 3, scavenger: 3 },
    hideout: { infirmary: 3, armory: 3, watchtower: 3, palisade: 3 },
    kit: { armor: 1, frag: 2, turret: 1, selfrevive: 1, barricade: 1 },
    loadout: ['pistol', 'rifle', null],
  });
  const m = storyMods(spec);
  assert.equal(m.hp, 35);
  assert.equal(m.speed, 1.1);
  assert.equal(m.stamina, 1.5);
  assert.equal(m.bleedout, 2);
  assert.ok(Math.abs(m.reviveSpeed - 2 * 1.2) < 1e-9);
  assert.equal(m.armor, 10 + 30 + 50, 'perk + infirmary + one plate');
  assert.equal(m.selfRevive, 1 + 1);
  assert.equal(m.reviveDelay, 0.6);
  assert.equal(m.frags, 1 + 1 + 2, 'watchtower + armory tier 3 grenade + 2 from the kit');
  assert.equal(m.turrets, 1 + 1);
  assert.equal(m.barricades, 3 + 1);
  assert.equal(m.explosive, 1.5);
  assert.equal(m.radius, 1.25);
  assert.equal(m.drop, 1.75);
  assert.equal(m.crate, 2);
  assert.equal(m.healAura, 1.2);
  assert.equal(storyMods(spec), m, 'memoised');
});

test('weaponFor: neutral mods change nothing, tiers and perks change the numbers', () => {
  const neutral = storyMods(sanitizeSpec({}));
  for (const id of WEAPON_IDS) {
    const w = weaponFor(neutral, id);
    assert.equal(w.damage, WEAPONS[id].damage);
    assert.equal(w.mag, WEAPONS[id].mag);
    assert.equal(w.reserve, WEAPONS[id].reserve);
    assert.equal(w.reload, WEAPONS[id].reload);
    assert.equal(w.spread, WEAPONS[id].spread);
    assert.equal(w.rate, WEAPONS[id].rate);
    assert.equal(w.falloff, WEAPONS[id].falloff);
    assert.equal(w.range, WEAPONS[id].range);
  }
  assert.equal(weaponFor(null, 'rifle'), WEAPONS.rifle);
  const spec = sanitizeSpec({ tiers: { rifle: 5 }, perks: { steady: 3, quick: 3, hoarder: 3, marksman: 3 } });
  const m = storyMods(spec);
  const r = weaponFor(m, 'rifle');
  const base = WEAPONS.rifle;
  assert.ok(Math.abs(r.damage - base.damage * 1.35) < 1e-9);
  assert.ok(Math.abs(r.reload - base.reload * 0.8 * 0.72) < 1e-9);
  assert.ok(Math.abs(r.spread - base.spread * 0.7 * 0.65) < 1e-9);
  assert.ok(Math.abs(r.rate - base.rate * 1.15) < 1e-9);
  assert.equal(r.mag, tierMag(base.mag, 5));
  assert.equal(r.reserve, Math.round(base.reserve * 1.5));
  assert.equal(r.falloff, 1);
  assert.equal(r.range, Math.round(base.range * 1.1));
  assert.equal(r.tier, 5);
  assert.equal(base.damage, 36, 'the table itself is untouched');
  // a gun without a tier still gets the perk effects
  const s = weaponFor(m, 'shotgun');
  assert.equal(s.tier, 0);
  assert.ok(s.spread < WEAPONS.shotgun.spread);
  assert.equal(weaponFor(m, 'rifle'), r, 'derived once');
  assert.equal(weaponFor(m, 'nope'), undefined);
});

test('deriveWeapon: projectile splash scales with the tier, unlimited reserve stays unlimited, bursts stay bursts', () => {
  const fx = perkEffectsFor({});
  const gl = deriveWeapon(WEAPONS.grenade_launcher, 4, fx);
  assert.ok(gl.projectile.explodeDamage > WEAPONS.grenade_launcher.projectile.explodeDamage);
  const pistol = deriveWeapon(WEAPONS.pistol, 5, fx);
  assert.equal(pistol.reserve, -1);
  const burst = deriveWeapon(WEAPONS.burst_rifle, 5, fx);
  assert.equal(burst.burst, 3);
  assert.ok(burst.burstDelay < WEAPONS.burst_rifle.burstDelay);
  const melee = deriveWeapon(WEAPONS.chainsaw, 2, { ...fx, range: 1.1 });
  assert.equal(melee.range, WEAPONS.chainsaw.range, 'perks do not stretch a chainsaw');
});

function perkEffectsFor(perks) {
  return { ...perkEffectsReal(perks) };
}
