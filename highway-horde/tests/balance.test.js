// Balance (docs/BALANCE.md): the bots' skill profiles (skilled lobby bots vs the
// "average human" stand-in used by scripts/balance.js), the tuning rules added by the
// balance pass (capped bleedout from hits, objective hp per player and damage share,
// boss-wave counts) and the headless harness itself.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLEEDOUT_TIME, DOWNED_HIT_BLEED, DOWNED_HIT_BLEED_RATE, DOWNED_HIT_BLEED_BANK, DT,
  OBJECTIVE_DAMAGE_MULT, OBJECTIVE_HP_PER_PLAYER, WAVE_ZOMBIES, waveZombieCount, BOSS_EVERY,
} from '../public/js/shared/constants.js';
import { WEAPONS, WEAPON_IDS } from '../public/js/shared/weapons.js';
import { damagePlayer } from '../public/js/shared/sim/players.js';
import {
  skillProfile, BOT_SKILL, nextPurchase, targetScore,
} from '../public/js/shared/sim/bots.js';
import { makeGame, addZombie, place, buildArenaMap } from './helpers/sim-helpers.js';

const HUMAN = { id: 1, name: 'Human', color: 0, cls: 'soldier' };
const bot = (id, skill, cls = 'soldier') => ({ id, name: `Bot${id}`, color: id - 1, cls, bot: true, botSkill: skill });

let harness = null;
try {
  harness = await import('../scripts/balance.js');
} catch (err) {
  console.log('# balance harness unavailable:', err.message);
}

// -------------------------------------------------------------------------------------
describe('bot skill profiles', () => {
  test('skill 1 is exactly the skilled brain; the average profile is worse at everything', () => {
    const s = skillProfile(1);
    for (const k of ['react', 'aimErr', 'decay', 'jitter', 'turn', 'aware', 'kite', 'pack', 'throwGap', 'trigger']) {
      assert.equal(s[k], 1, k);
    }
    assert.equal(s.lapse, 0);
    assert.equal(s.planner, true);
    const a = skillProfile(BOT_SKILL.AVERAGE);
    assert.ok(a.react > 1.5 && a.aimErr > 1.5 && a.jitter > 1.5 && a.trigger > 1.5, 'slower, sloppier');
    assert.ok(a.decay < 1 && a.turn < 1 && a.aware < 1 && a.kite < 1, 'settles slower, less aware');
    assert.ok(a.lapse > 0 && !a.planner && a.maxBuys < s.maxBuys);
    assert.deepEqual(skillProfile(7), skillProfile(1), 'clamped');
    assert.deepEqual(skillProfile(NaN), skillProfile(1));
    assert.ok(skillProfile(0).react > a.react);
  });

  test('botSkill reaches the brain (default: skilled)', () => {
    const g = makeGame({ players: [HUMAN, bot(2, BOT_SKILL.AVERAGE), { ...bot(3), botSkill: undefined }] });
    assert.ok(Math.abs(g.bots[0].prof.level - BOT_SKILL.AVERAGE) < 1e-9);
    assert.equal(g.bots[1].prof.level, 1);
  });

  test('reaction time scales with the profile', () => {
    const react = (skill) => {
      const g = makeGame({ players: [HUMAN, bot(2, skill)] });
      place(g, 1, 100, 1100);
      place(g, 2, 800, 800);
      const z = addZombie(g, 'walker', 1100, 800);
      z.speed = 0;
      const b = g.bots[0];
      for (let t = 0; t < 30 && !b.target; t++) g.step();
      assert.equal(b.target, z);
      return b.reactT / b.skill / b.prof.react;
    };
    // Unscaled reaction: 0.08-0.32 s before the skill multipliers, whatever the profile.
    for (const s of [1, BOT_SKILL.AVERAGE]) {
      const r = react(s);
      assert.ok(r > 0.07 && r <= 0.33, `${s}: ${r}`);
    }
  });

  test('an average player buys the best gun it can afford now; a planner saves up', () => {
    const g = makeGame({ players: [HUMAN, bot(2, 1, 'medic')] });
    g.wave = 2;
    const p = g.getPlayer(2);
    p.slots = ['pistol', 'uzi', 'magnum'];
    p.mag = [12, 32, 6];
    p.res = [-1, 288, 48];
    p.armor = 60;
    p.frags = 3;
    // $2000: the dual SMGs ($2100) are $100 away; a rifle ($1900) is affordable now.
    p.cash = 2000;
    const planner = nextPurchase(g, p, skillProfile(1));
    assert.ok(!planner || !(planner.item in WEAPONS), `planner keeps saving: ${JSON.stringify(planner)}`);
    const avg = nextPurchase(g, p, skillProfile(BOT_SKILL.AVERAGE));
    assert.deepEqual(avg, { item: 'rifle', slot: 2 }, 'replaces the weakest gun with what it can pay for');
    assert.deepEqual(nextPurchase(g, p), planner, 'no profile = the skilled rules');
    // Plenty of spare cash buys a self-revive kit (the late-game cash sink).
    p.slots = ['pistol', 'railgun', 'minigun'];
    p.mag = [12, WEAPONS.railgun.mag, WEAPONS.minigun.mag];
    p.res = [-1, WEAPONS.railgun.reserve, WEAPONS.minigun.reserve];
    p.cash = 5000;
    assert.deepEqual(nextPurchase(g, p, skillProfile(1)), { item: 'selfrevive', slot: -1 });
    p.selfRevive = true;
    assert.notEqual((nextPurchase(g, p, skillProfile(1)) || {}).item, 'selfrevive');
  });

  test('objective alarm: a horde chewing on the objective outranks a closer walker', () => {
    const g = makeGame({ players: [HUMAN, bot(2)], objective: true });
    g.phase = 'wave';
    place(g, 2, 200, 1000);
    const b = g.bots[0];
    const walker = addZombie(g, 'walker', 500, 1000);
    const chewer = addZombie(g, 'walker', 1100, 1000);
    chewer.tgtKind = 3;
    chewer.tgtGap = 5;
    const range = WEAPONS.lmg.range;
    b.objAlarm = 0;
    assert.ok(targetScore(g, b, walker, 300, range) > targetScore(g, b, chewer, 900, range), 'a lone chewer waits');
    b.objAlarm = 6;
    assert.ok(targetScore(g, b, chewer, 900, range) > targetScore(g, b, walker, 300, range), 'a horde on it does not');
  });
});

// -------------------------------------------------------------------------------------
describe('tuning rules', () => {
  test('hits on a downed player drain bleedout at most DOWNED_HIT_BLEED_RATE extra s per s', () => {
    const g = makeGame({ n: 2 });
    const a = place(g, 1, 300, 900);
    place(g, 2, 1400, 300);
    damagePlayer(g, a, 1000, 0, 0);
    assert.equal(a.state, 'downed');
    // A mauling: 1000 damage every tick for 2 s.
    for (let t = 0; t < 120; t++) {
      damagePlayer(g, a, 1000, 0, 0);
      g.step();
    }
    const lost = BLEEDOUT_TIME - a.bleedout;
    assert.ok(lost <= 2 * (1 + DOWNED_HIT_BLEED_RATE) + 1e-6, `lost ${lost}`);
    assert.ok(lost > 2 * (1 + DOWNED_HIT_BLEED_RATE) - 0.05, `lost ${lost}`);
    assert.ok(a.hitBleed <= DOWNED_HIT_BLEED_BANK);
    // One walker hit costs its full share, spread over the next ticks.
    const g2 = makeGame({ n: 2 });
    const b = place(g2, 1, 300, 900);
    place(g2, 2, 1400, 300);
    damagePlayer(g2, b, 1000, 0, 0);
    damagePlayer(g2, b, 12, 0, 0);
    for (let t = 0; t < 120; t++) g2.step();
    assert.ok(Math.abs(BLEEDOUT_TIME - b.bleedout - (120 * DT + 12 * DOWNED_HIT_BLEED)) < 1e-6);
  });

  test('the objective has more hp for bigger teams and takes a share of zombie damage', () => {
    const map = buildArenaMap();
    const g1 = makeGame({ map, n: 1, objective: true });
    const g4 = makeGame({ map, n: 4, objective: true });
    assert.equal(g1.objective.maxHp, map.objective.hp);
    assert.equal(g4.objective.maxHp, Math.round(map.objective.hp * (1 + OBJECTIVE_HP_PER_PLAYER * 3)));
    assert.equal(g4.objective.hp, g4.objective.maxHp);
    // A walker at the mast (players far away) chews it for damage × OBJECTIVE_DAMAGE_MULT.
    place(g1, 1, 100, 1150);
    const o = map.objective;
    const z = addZombie(g1, 'walker', o.x, o.y - o.h / 2 - 15);
    let hp = g1.objective.hp;
    for (let t = 0; t < 180 && g1.objective.hp === hp; t++) g1.step();
    assert.ok(Math.abs(hp - g1.objective.hp - z.damage * OBJECTIVE_DAMAGE_MULT) < 1e-9, `${hp - g1.objective.hp}`);
  });

  test('boss waves bring a share of the regulars; others follow the wave formula', () => {
    const z = WAVE_ZOMBIES;
    assert.equal(waveZombieCount(1, 1), z.base + z.perWave);
    assert.equal(waveZombieCount(BOSS_EVERY, 1), Math.round((z.base + z.perWave * BOSS_EVERY) * z.bossWave));
    assert.ok(z.bossWave > 0 && z.bossWave <= 1);
    assert.ok(waveZombieCount(3, 4) > waveZombieCount(3, 2));
  });
});

// -------------------------------------------------------------------------------------
describe('balance harness (scripts/balance.js)', () => {
  test('runMatch plays a real game with bots and reports per-wave numbers', { skip: !harness }, () => {
    const r = harness.runMatch({ map: 'highway', diff: 'easy', size: 2, seed: 3, profile: 'skilled', waves: 1 });
    assert.equal(r.over, 'victory');
    assert.equal(r.cleared, 1);
    assert.equal(r.waves.length, 1);
    const w = r.waves[0];
    assert.equal(w.wave, 1);
    assert.ok(w.cleared && w.dur > 5 && w.kills > 0 && w.peakAlive > 0);
    assert.ok(w.earned > 0 && w.bank > 0);
    const kills = Object.values(r.kills).reduce((a, b) => a + b, 0);
    assert.equal(kills, w.kills, 'every kill attributed to a source');
    assert.equal(r.players.length, 2);
    assert.ok(r.players.every((p) => p.kills >= 0 && typeof p.cls === 'string'));
    assert.ok(r.inHand && Object.keys(r.inHand).length > 0);
  });

  test('overrides patch the data tables and reject unknown paths; quick mode stays small', { skip: !harness }, () => {
    const old = WEAPONS.pistol.damage;
    try {
      harness.applySets('WEAPONS.pistol.damage=31');
      assert.equal(WEAPONS.pistol.damage, 31);
    } finally {
      WEAPONS.pistol.damage = old;
    }
    assert.throws(() => harness.applySets('WEAPONS.pistol.nope=1'), /unknown/);
    const jobs = harness.buildJobs({ quick: true });
    assert.ok(jobs.length > 20 && jobs.length <= 60, `${jobs.length} quick runs`);
    assert.ok(jobs.some((j) => j.profile === 'average') && jobs.some((j) => j.profile === 'skilled'));
    assert.ok(new Set(jobs.map((j) => j.size)).size === 4);
    const table = harness.gunTable();
    for (const id of WEAPON_IDS) assert.ok(table.includes(`| ${id} |`), id);
  });
});
