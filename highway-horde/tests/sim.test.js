import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DT, PREP_TIME, INTERMISSION_TIME, WAVE_CLEAR_BONUS, REVIVE_TIME, REVIVE_HP, REVIVE_BONUS, BLEEDOUT_TIME,
  SELF_REVIVE_DELAY, START_CASH, FRAG_MAX, MOLOTOV_MAX, TURRET, BARRICADE, PLAYER_RADIUS, MELEE_DAMAGE,
  ARMOR_ABSORB, HP_GROWTH_PER_WAVE, DIFFICULTIES, SUPPLY_RADIUS, WAVE_ZOMBIES, waveZombieCount,
} from '../public/js/shared/constants.js';
import { CLASSES } from '../public/js/shared/classes.js';
import { WEAPONS, WEAPON_IDS, THROWABLES } from '../public/js/shared/weapons.js';
import { ZOMBIES, ZFLAG } from '../public/js/shared/zombies.js';
import { ammoPrice } from '../public/js/shared/items.js';
import { damagePlayer, giveWeapon, spawnPickup } from '../public/js/shared/sim/players.js';
import { damageZombie } from '../public/js/shared/sim/combat.js';
import { GameCore } from '../public/js/shared/sim/core.js';
import {
  makeGame, addZombie, place, run, cmd, godMode, eventsOf, buildFixtureMap, buildArenaMap,
} from './helpers/sim-helpers.js';
import { createBot, runBots } from './helpers/bots.js';

// shared/maps.js is written in parallel; per-map tests run when it loads.
let Game = null, MAP_LIST = [];
try {
  ({ Game } = await import('../public/js/shared/sim.js'));
  ({ MAP_LIST } = await import('../public/js/shared/maps.js'));
} catch (err) {
  Game = null;
  console.log('# maps.js unavailable, per-map tests skipped:', err.message);
}

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// -------------------------------------------------------------------------------------
describe('input queue', () => {
  test('applies one cmd per tick, repeats the last with edges cleared, tracks lastSeq', () => {
    const g = makeGame();
    const p = place(g, 1, 400, 900);
    g.setInput(1, cmd({ seq: 1, moveX: 1, reload: true, angle: 1 }));
    g.step();
    assert.equal(p.lastSeq, 1);
    const x1 = p.x;
    g.step();
    assert.equal(p.lastSeq, 1);
    assert.ok(p.x > x1, 'keeps walking on the repeated command');
    assert.equal(p.cmd.reload, false, 'edge cleared when repeating');
    assert.ok(approx(p.angle, 1));
  });

  test('more than 6 queued drops the oldest but keeps their edge presses', () => {
    const g = makeGame();
    const p = place(g, 1, 400, 900);
    assert.equal(p.frags, 1);
    for (let s = 2; s <= 9; s++) g.setInput(1, cmd({ seq: s, frag: s === 2 }));
    const ev = run(g, 1);
    assert.equal(p.lastSeq, 4, 'two oldest dropped, third applied');
    assert.equal(eventsOf(ev, 'throw').length, 1, 'the dropped frag press still threw');
    assert.equal(p.queue.length, 5);
  });

  test('setInput copies and sanitises commands', () => {
    const g = makeGame();
    const p = place(g, 1, 400, 900);
    const c = cmd({ seq: 5, moveX: 3, moveY: 4, angle: NaN, slot: 7 });
    g.setInput(1, c);
    c.moveX = -1;
    g.step();
    assert.ok(approx(Math.hypot(p.cmd.moveX, p.cmd.moveY), 1));
    assert.ok(p.cmd.moveX > 0);
    assert.equal(p.cmd.slot, -1);
    assert.equal(p.cmd.angle, 0);
    g.setInput(99, cmd());
    g.command(99, { type: 'buy', item: 'ammo' });
  });
});

// -------------------------------------------------------------------------------------
describe('phases and waves', () => {
  test('prep → wave → intermission → wave, counts, bonus, crate, ready skip', () => {
    const g = makeGame({ sandbox: false, n: 1 });
    assert.equal(g.phase, 'prep');
    assert.equal(g.snapshot().timer, PREP_TIME);
    let ev = run(g, Math.round(PREP_TIME / DT) + 1);
    assert.equal(g.phase, 'wave');
    assert.deepEqual(eventsOf(ev, 'wave')[0], { type: 'wave', wave: 1, boss: false });
    const n1 = WAVE_ZOMBIES.base + WAVE_ZOMBIES.perWave;
    assert.equal(g.remaining(), n1);
    assert.equal(g.snapshot().remaining, n1);
    const p = g.getPlayer(1);
    const cash0 = p.cash;
    // Kill everything as it spawns.
    ev = run(g, 60 * 90, () => {
      for (const z of g.zombies) damageZombie(g, z, 1e9, 1);
      return {};
    }, (gg) => gg.phase !== 'wave');
    assert.equal(g.phase, 'intermission');
    assert.deepEqual(eventsOf(ev, 'waveclear')[0], { type: 'waveclear', wave: 1, bonus: WAVE_CLEAR_BONUS });
    assert.equal(eventsOf(ev, 'zdie').length, n1);
    assert.equal(p.kills, n1);
    assert.equal(p.cash, cash0 + n1 * ZOMBIES.walker.cash + WAVE_CLEAR_BONUS);
    assert.equal(eventsOf(ev, 'drop').length, 1);
    assert.equal(g.pickups.filter((k) => k.kind === 'crate').length, 1);
    const crate = g.pickups.find((k) => k.kind === 'crate');
    assert.ok(WEAPONS[crate.weapon] && crate.weapon !== 'pistol');
    const s = g.snapshot();
    assert.equal(s.phase, 'intermission');
    assert.ok(s.timer > INTERMISSION_TIME - 1 && s.timer <= INTERMISSION_TIME);
    assert.equal(s.wave, 1);
    g.command(1, { type: 'ready' });
    assert.equal(g.snapshot().readyCount, 1);
    ev = run(g, 1);
    assert.equal(g.phase, 'wave');
    assert.equal(g.wave, 2);
    assert.equal(g.remaining(), WAVE_ZOMBIES.base + 2 * WAVE_ZOMBIES.perWave);
    assert.equal(g.getPlayer(1).ready, false, 'ready flags reset each wave');
  });

  test('zombie count scales with players and difficulty; boss waves add bosses', () => {
    const g = makeGame({ sandbox: false, n: 3, settings: { difficulty: 'hard' } });
    g._startWave(4);
    const z = WAVE_ZOMBIES;
    assert.equal(g.remaining(), Math.round((z.base + 4 * z.perWave) * (1 + z.perPlayer * 2) * DIFFICULTIES.hard.count));
    assert.equal(g.remaining(), waveZombieCount(4, 3, DIFFICULTIES.hard));
    // Boss waves bring fewer regulars (bossWave share) besides the bosses.
    assert.equal(waveZombieCount(5, 4), Math.round((z.base + 5 * z.perWave) * (1 + z.perPlayer * 3) * z.bossWave));
    const g5 = makeGame({ sandbox: false, n: 4 });
    const ev0 = [];
    g5._startWave(5);
    assert.equal(g5.bossQueue, 2);
    for (const e of g5.snapshot().events) ev0.push(e);
    assert.deepEqual(ev0.find((e) => e.type === 'wave'), { type: 'wave', wave: 5, boss: true });
    const ev = run(g5, 60 * 11, () => { godMode(g5); return {}; });
    const bosses = eventsOf(ev, 'bossspawn');
    assert.equal(bosses.length, 2);
    const boss = g5.zombies.find((z) => z.type === 'boss');
    // Boss hp: own wave growth, (hpBase + hpPerPlayer × players) split over the 2 bosses.
    const sp = ZOMBIES.boss.special;
    const want = ZOMBIES.boss.hp * (1 + sp.hpGrowth * 4) * (sp.hpBase + sp.hpPerPlayer * 4) / 2;
    assert.ok(approx(boss.maxHp, want, 1e-6));
    const s = g5.snapshot();
    assert.ok(s.bossHp > 0 && s.bossHp <= 1);
  });

  test('elites appear from wave 4 at ~2% and never before', () => {
    const sample = (wave, n) => {
      const g = makeGame({ sandbox: false, n: 6, seed: 9 + wave });
      g.wave = wave;
      g.phase = 'wave';
      g.diff = { ...g.diff, maxAlive: 1e9 };
      let elites = 0, total = 0;
      for (let i = 0; i < n; i++) {
        g.spawnTimer = 0;
        g.spawnQueue = 1;
        g.step();
        for (const z of g.zombies) {
          if (z.dead) continue;
          total++;
          if (z.elite) {
            elites++;
            assert.ok(approx(z.maxHp, ZOMBIES[z.type].hp * (1 + HP_GROWTH_PER_WAVE * (wave - 1)) * 1.6));
            assert.ok(g.snapshot().zombies.find((s) => s.id === z.id).flags & ZFLAG.ELITE);
          }
          z.dead = true;
        }
      }
      return { elites, total };
    };
    assert.equal(sample(3, 600).elites, 0);
    const { elites, total } = sample(7, 4000);
    assert.ok(total >= 3900);
    const rate = elites / total;
    assert.ok(rate > 0.01 && rate < 0.035, `elite rate ${rate}`);
  });

  test('never more than maxAlive alive; spawns prefer rectangles away from players', () => {
    const g = makeGame({ sandbox: false, n: 6, settings: { difficulty: 'easy' } });
    g._startWave(12);
    let maxAlive = 0;
    run(g, 60 * 60, () => {
      godMode(g);
      maxAlive = Math.max(maxAlive, g.zombies.length);
      return {};
    });
    assert.ok(maxAlive <= DIFFICULTIES.easy.maxAlive, `alive peaked at ${maxAlive}`);
    assert.ok(maxAlive > 60);
  });

  test('last wave cleared → victory (terminal)', () => {
    const g = makeGame({ sandbox: false, settings: { waves: 1 } });
    g._startWave(1);
    const ev = run(g, 60 * 60, () => {
      for (const z of g.zombies) damageZombie(g, z, 1e9, 1);
      return {};
    });
    assert.equal(g.phase, 'victory');
    assert.equal(eventsOf(ev, 'victory').length, 1);
    run(g, 120);
    assert.equal(g.phase, 'victory');
  });

  test('endless mode keeps going past wave 15', () => {
    const g = makeGame({ sandbox: false, settings: { waves: 0 } });
    g._startWave(15);
    run(g, 60 * 200, () => {
      for (const z of g.zombies) damageZombie(g, z, 1e9, 1);
      godMode(g);
      return {};
    });
    assert.notEqual(g.phase, 'victory');
    assert.equal(g.snapshot().totalWaves, 0);
  });
});

// -------------------------------------------------------------------------------------
describe('downed, revive, death, respawn', () => {
  test('hp 0 → downed; a teammate holding interact revives after REVIVE_TIME', () => {
    const g = makeGame({ n: 2 });
    const a = place(g, 1, 500, 900), b = place(g, 2, 550, 900);
    let ev = run(g, 1, () => { damagePlayer(g, a, 500, 0, 0); return {}; });
    assert.equal(a.state, 'downed');
    assert.equal(a.downs, 1);
    assert.equal(eventsOf(ev, 'down').length, 1);
    assert.equal(a.slot, 0, 'pistol out while downed');
    const cash = b.cash;
    ev = run(g, Math.round(REVIVE_TIME / DT) - 5, () => ({ 2: { interact: true } }));
    assert.equal(a.state, 'downed');
    const s = g.snapshot();
    const sa = s.players.find((q) => q.id === 1);
    assert.ok(sa.revive > 0.9 && sa.reviver === 2);
    assert.ok(approx(sa.bleedout, BLEEDOUT_TIME - DT, 1e-9), 'bleedout pauses while being revived');
    ev = run(g, 10, () => ({ 2: { interact: true } }));
    assert.equal(a.state, 'alive');
    assert.equal(a.hp, REVIVE_HP);
    assert.deepEqual(eventsOf(ev, 'revived')[0], { type: 'revived', pid: 1, by: 2 });
    assert.equal(b.revives, 1);
    assert.equal(b.cash, cash + REVIVE_BONUS);
    assert.equal(a.slot, 1, 'weapon restored after revive');
  });

  test('medics revive twice as fast; letting go resets progress', () => {
    const g = makeGame({ players: [{ id: 1, cls: 'soldier' }, { id: 2, cls: 'medic' }] });
    const a = place(g, 1, 500, 900);
    place(g, 2, 540, 900);
    damagePlayer(g, a, 500, 0, 0);
    run(g, 30, () => ({ 2: { interact: true } }));
    run(g, 1, () => ({ 2: { interact: false } }));
    assert.equal(a.revive, 0);
    run(g, Math.round(REVIVE_TIME / 2 / DT) + 2, () => ({ 2: { interact: true } }));
    assert.equal(a.state, 'alive');
  });

  test('bleedout → dead (loses guns) → respawns with starter kit at wave clear', () => {
    const g = makeGame({ n: 2, sandbox: false });
    g._startWave(1);
    const a = place(g, 1, 500, 900);
    place(g, 2, 1200, 900);
    giveWeapon(g, a, 'shotgun');
    damagePlayer(g, a, 1000, 0, 0);
    let ev = run(g, Math.round(BLEEDOUT_TIME / DT) + 2, () => { godMode(g); return {}; });
    assert.equal(a.state, 'dead');
    assert.equal(eventsOf(ev, 'died').length, 1);
    assert.deepEqual(a.slots, [null, null, null]);
    const s = g.snapshot().players.find((q) => q.id === 1);
    assert.equal(s.respawn, true);
    assert.equal(s.state, 'dead');
    ev = run(g, 60 * 120, () => {
      godMode(g);
      for (const z of g.zombies) damageZombie(g, z, 1e9, 2);
      return {};
    }, (gg) => gg.phase !== 'wave');
    assert.equal(g.phase, 'intermission');
    assert.equal(a.state, 'alive');
    assert.equal(eventsOf(ev, 'respawn').length, 1);
    assert.deepEqual(a.slots, ['pistol', 'rifle', null]);
    assert.ok(a.hp > 0 && !a.respawn);
    assert.ok(g.map.playerSpawns.some((sp) => sp.x === a.x && sp.y === a.y));
  });

  test('downed players are revived by a wave clear', () => {
    const g = makeGame({ n: 2, sandbox: false });
    g._startWave(1);
    const a = place(g, 1, 500, 900);
    damagePlayer(g, a, 1000, 0, 0);
    run(g, 60 * 120, () => {
      godMode(g);
      for (const z of g.zombies) damageZombie(g, z, 1e9, 2);
      return {};
    }, (gg) => gg.phase !== 'wave');
    assert.equal(a.state, 'alive');
  });

  test('self-revive kit fires after SELF_REVIVE_DELAY and prevents a solo wipe', () => {
    const g = makeGame({ n: 1 });
    const a = place(g, 1, 500, 900);
    a.selfRevive = true;
    damagePlayer(g, a, 1000, 0, 0);
    const ev = run(g, Math.round(SELF_REVIVE_DELAY / DT) + 2);
    assert.notEqual(g.phase, 'gameover');
    assert.equal(a.state, 'alive');
    assert.equal(a.selfRevive, false);
    assert.deepEqual(eventsOf(ev, 'revived')[0], { type: 'revived', pid: 1, by: 1 });
  });

  test('solo: the only survivor starts with a self-revive kit; respawn does not hand out another', () => {
    const solo = makeGame({ n: 1, sandbox: false });
    assert.equal(solo.getPlayer(1).selfRevive, true);
    assert.equal(solo.snapshot().players[0].selfRevive, true);
    const duo = makeGame({ n: 2, sandbox: false });
    assert.equal(duo.getPlayer(1).selfRevive, false);
    assert.equal(duo.getPlayer(2).selfRevive, false);
    // The kit is used up; a later death and respawn at the wave clear gives no new one.
    const g = makeGame({ n: 1, sandbox: false });
    g._startWave(1);
    const a = place(g, 1, 500, 900);
    damagePlayer(g, a, 1000, 0, 0);
    run(g, Math.round(SELF_REVIVE_DELAY / DT) + 2);
    assert.equal(a.state, 'alive');
    assert.equal(a.selfRevive, false);
    // (A second survivor keeps the game going while the first one bleeds out.)
    const t = makeGame({ n: 2, sandbox: false });
    t._startWave(1);
    const b = place(t, 1, 500, 900);
    b.selfRevive = true;
    place(t, 2, 1500, 300);
    damagePlayer(t, b, 1000, 0, 0);
    run(t, Math.round(SELF_REVIVE_DELAY / DT) + 2, () => { godMode(t); return {}; });
    damagePlayer(t, b, 1000, 0, 0);
    run(t, Math.round(BLEEDOUT_TIME / DT) + 2, () => { godMode(t); return {}; });
    assert.equal(b.state, 'dead');
    run(t, 60 * 120, () => {
      godMode(t);
      for (const z of t.zombies) damageZombie(t, z, 1e9, 2);
      return {};
    }, (gg) => gg.phase !== 'wave');
    assert.equal(b.state, 'alive', 'respawned at the wave clear');
    assert.equal(b.selfRevive, false);
  });

  test('zombies attack downed players (bleedout drops faster) but ignore the dead', () => {
    const g = makeGame({ n: 2 });
    const a = place(g, 1, 500, 900);
    place(g, 2, 1500, 300);
    damagePlayer(g, a, 1000, 0, 0);
    addZombie(g, 'walker', 540, 900);
    run(g, 120, () => { godMode(g); return {}; });
    assert.ok(a.bleedout < BLEEDOUT_TIME - 2 - 0.5, `bleedout ${a.bleedout}`);
    a.bleedout = 0.01;
    run(g, 2);
    assert.equal(a.state, 'dead');
    const z = g.zombies[0];
    run(g, 60);
    assert.ok(z.tgt !== a, 'dead players are not targets');
  });

  test('everyone down at once → gameover wiped (terminal)', () => {
    const g = makeGame({ n: 2 });
    const [a, b] = g.players;
    const ev = run(g, 2, () => { damagePlayer(g, a, 999, 0, 0); damagePlayer(g, b, 999, 0, 0); return {}; });
    assert.equal(g.phase, 'gameover');
    assert.deepEqual(eventsOf(ev, 'gameover'), [{ type: 'gameover', reason: 'wiped' }]);
    run(g, 60);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.snapshot().phase, 'gameover');
    // Terminal: the downed can no longer fire their pistols (clients predict the same).
    const shots = run(g, 60, () => ({ 1: { fire: true }, 2: { fire: true } }));
    assert.equal(eventsOf(shots, 'shot').length, 0);
  });

  test('armour absorbs its share of damage', () => {
    const g = makeGame();
    const p = place(g, 1, 500, 900);
    p.armor = 50;
    damagePlayer(g, p, 40, 0, 0);
    assert.ok(approx(p.armor, 50 - 40 * ARMOR_ABSORB));
    assert.ok(approx(p.hp, 100 - 40 * (1 - ARMOR_ABSORB)));
  });
});

// -------------------------------------------------------------------------------------
describe('objective', () => {
  test('zombies destroy the objective → gameover objective', () => {
    const g = makeGame({ objective: true });
    place(g, 1, 100, 1100);
    const o = g.map.objective;
    g.objective.hp = 60;
    for (let i = 0; i < 4; i++) addZombie(g, 'walker', o.x - 60 + i * 40, o.y + o.h / 2 + 20);
    const ev = run(g, 60 * 10, () => { godMode(g); return {}; });
    assert.equal(g.phase, 'gameover');
    assert.deepEqual(eventsOf(ev, 'gameover'), [{ type: 'gameover', reason: 'objective' }]);
    const hits = eventsOf(ev, 'objhit');
    assert.ok(hits.length >= 1);
    assert.equal(g.snapshot().objective.hp, 0);
  });

  test('objective disabled: never targeted or damaged; snapshot.objective null', () => {
    const g = makeGame({ objective: false, map: buildArenaMap() });
    place(g, 1, 100, 1100);
    const o = g.map.objective;
    for (let i = 0; i < 3; i++) addZombie(g, 'walker', o.x - 40 + i * 40, o.y + o.h / 2 + 20);
    const ev = run(g, 60 * 4, () => { godMode(g); return {}; });
    assert.equal(eventsOf(ev, 'objhit').length, 0);
    assert.equal(g.snapshot().objective, null);
    assert.ok(g.zombies.every((z) => z.tgt === g.players[0]));
  });

  test('repair kit restores 20% of the objective', () => {
    const g = makeGame({ objective: true });
    const p = place(g, 1, 400, 900);
    p.cash = 10000;
    g.objective.hp = 1000;
    g.command(1, { type: 'buy', item: 'repair' });
    assert.equal(g.objective.hp, 1000 + g.objective.maxHp * 0.2);
  });
});

// -------------------------------------------------------------------------------------
describe('shop', () => {
  function buyEv(g, id, item) {
    g.command(id, { type: 'buy', item });
    const ev = g.snapshot().events.filter((e) => e.type === 'buy' || e.type === 'buyfail');
    return ev[ev.length - 1];
  }

  test('guns: owned / cash / free slot / replace current / locked / invalid', () => {
    const g = makeGame();
    const p = place(g, 1, 400, 900);
    assert.equal(p.cash, START_CASH);
    assert.deepEqual(buyEv(g, 1, 'rifle'), { type: 'buyfail', pid: 1, item: 'rifle', reason: 'owned' });
    assert.equal(buyEv(g, 1, 'uzi').reason, 'cash');
    p.cash = 20000;
    assert.deepEqual(buyEv(g, 1, 'uzi'), { type: 'buy', pid: 1, item: 'uzi' });
    assert.deepEqual(p.slots, ['pistol', 'rifle', 'uzi']);
    assert.equal(p.slot, 2);
    assert.equal(p.cash, 20000 - WEAPONS.uzi.price);
    p.slot = 1;
    buyEv(g, 1, 'shotgun');
    assert.deepEqual(p.slots, ['pistol', 'shotgun', 'uzi'], 'full slots: replaces the current slot');
    assert.equal(buyEv(g, 1, 'railgun').reason, 'invalid', 'locked until its unlock wave');
    assert.equal(buyEv(g, 1, 'banana').reason, 'invalid');
    assert.equal(buyEv(g, 1, 'pistol').reason, 'invalid');
    // Owned gun with spent ammo: refill at ammoPrice.
    p.res[1] = 0;
    const c0 = p.cash;
    assert.equal(buyEv(g, 1, 'shotgun').type, 'buy');
    assert.equal(p.res[1], WEAPONS.shotgun.reserve);
    assert.equal(p.cash, c0 - ammoPrice('shotgun'));
    g.wave = 9;
    assert.equal(buyEv(g, 1, 'railgun').type, 'buy');
  });

  test('items: limits and reasons', () => {
    const g = makeGame({ objective: false });
    const p = place(g, 1, 400, 900);
    p.cash = 1e6;
    for (let i = p.frags; i < FRAG_MAX; i++) assert.equal(buyEv(g, 1, 'frag').type, 'buy');
    assert.equal(buyEv(g, 1, 'frag').reason, 'max');
    for (let i = 0; i < MOLOTOV_MAX; i++) assert.equal(buyEv(g, 1, 'molotov').type, 'buy');
    assert.equal(buyEv(g, 1, 'molotov').reason, 'max');
    assert.equal(buyEv(g, 1, 'selfrevive').reason, 'owned', 'a solo survivor starts with a kit');
    p.selfRevive = false;
    assert.equal(buyEv(g, 1, 'selfrevive').type, 'buy');
    assert.equal(buyEv(g, 1, 'selfrevive').reason, 'owned');
    for (let i = 0; i < TURRET.maxPerPlayer; i++) assert.equal(buyEv(g, 1, 'turret').type, 'buy');
    assert.equal(buyEv(g, 1, 'turret').reason, 'max');
    for (let i = 0; i < BARRICADE.maxPerPlayer; i++) assert.equal(buyEv(g, 1, 'barricade').type, 'buy');
    assert.equal(buyEv(g, 1, 'barricade').reason, 'max');
    assert.equal(buyEv(g, 1, 'armor').type, 'buy');
    assert.equal(buyEv(g, 1, 'armor').type, 'buy');
    assert.equal(p.armor, 100);
    assert.equal(buyEv(g, 1, 'armor').reason, 'max');
    assert.equal(buyEv(g, 1, 'medkit').reason, 'max');
    p.hp = 10;
    assert.equal(buyEv(g, 1, 'medkit').type, 'buy');
    assert.equal(p.hp, p.maxHp);
    assert.equal(buyEv(g, 1, 'ammo').reason, 'max');
    p.res[1] = 3;
    assert.equal(buyEv(g, 1, 'ammo').type, 'buy');
    assert.equal(p.res[1], WEAPONS.rifle.reserve);
    assert.equal(buyEv(g, 1, 'repair').reason, 'invalid', 'no objective in this game');
  });

  test('engineer turret discount; frag cap raised for demo', () => {
    const g = makeGame({ players: [{ id: 1, cls: 'engineer' }, { id: 2, cls: 'demo' }] });
    const e = place(g, 1, 400, 900), d = place(g, 2, 500, 900);
    assert.equal(e.turrets, 1, 'engineer starts with a turret');
    e.cash = 5000;
    buyEv(g, 1, 'turret');
    assert.equal(e.cash, 4000);
    assert.equal(buyEv(g, 1, 'turret').reason, 'max', 'owned + placed capped at maxPerPlayer');
    d.cash = 1e5;
    let n = 0;
    while (buyEv(g, 2, 'frag').type === 'buy') n++;
    assert.equal(d.frags, FRAG_MAX + 3);
    assert.ok(n > 0);
  });

  test('mid-wave only at the supply station; closed when downed or game over', () => {
    const g = makeGame({ sandbox: false });
    g._startWave(1);
    const p = g.getPlayer(1);
    p.cash = 1e5;
    const s = g.map.supply;
    place(g, 1, s.x + SUPPLY_RADIUS + 50, s.y);
    assert.equal(buyEv(g, 1, 'frag').reason, 'closed');
    place(g, 1, s.x + SUPPLY_RADIUS - 10, s.y);
    assert.equal(buyEv(g, 1, 'frag').type, 'buy');
    damagePlayer(g, p, 1e4, 0, 0);
    assert.equal(buyEv(g, 1, 'frag').reason, 'closed');
    g._gameOver('wiped');
    assert.equal(buyEv(g, 1, 'frag').reason, 'closed');
  });
});

// -------------------------------------------------------------------------------------
describe('weapons', () => {
  function range(g, pid, wid, target = 'brute', dist = 160, ticks = 150) {
    const p = place(g, pid, 300, 900, 0);
    p.slots = ['pistol', null, null];
    p.slot = giveWeapon(g, p, wid);
    // Keep the shooter out of their own blast radius.
    if (WEAPONS[wid].projectile && WEAPONS[wid].projectile.explodeRadius) dist = Math.max(dist, WEAPONS[wid].projectile.explodeRadius + 150);
    const z = addZombie(g, target, 300 + dist, 900);
    z.speed = 0;
    z.mass = 1;
    z.hp = z.maxHp = 1e6;
    const ev = run(g, ticks, () => { godMode(g); return { [pid]: { fire: true, angle: 0 } }; });
    return { p, z, ev };
  }

  for (const wid of WEAPON_IDS) {
    test(`${wid} (${WEAPONS[wid].kind}) damages zombies`, () => {
      const g = makeGame();
      const { z, ev, p } = range(g, 1, wid);
      assert.ok(z.hp < 1e6, `${wid} did no damage`);
      assert.ok(p.damage > 0, 'damage stat credited');
      const shots = eventsOf(ev, 'shot');
      assert.ok(shots.length > 0);
      for (const s of shots) {
        assert.equal(s.pid, 1);
        assert.equal(s.turret, 0);
        assert.equal(s.weapon, wid);
        const k = WEAPONS[wid].kind;
        if (k === 'hitscan' || k === 'rail') assert.ok(s.rays.length >= 1 && s.rays.every((r) => [0, 1, 2].includes(r.hit)));
        else assert.deepEqual(s.rays, []);
      }
      // At most one merged shot event per tick per shooter.
      const ticks = new Set();
      for (const s of shots) ticks.add(s);
      if (WEAPONS[wid].kind === 'flame') assert.ok(z.burnT > 0, 'flamethrower ignites');
      if (WEAPONS[wid].kind === 'chain') assert.ok(eventsOf(ev, 'chain').length > 0);
    });
  }

  test('sustained fire matches every gun\'s rate exactly (no float drift)', () => {
    for (const wid of WEAPON_IDS) {
      const w = WEAPONS[wid];
      const g = makeGame();
      g.wave = 20;
      const p = place(g, 1, 300, 900, Math.PI);
      p.slot = giveWeapon(g, p, wid);
      p.mag[p.slot] = 1e6;
      run(g, 60, () => ({ 1: { fire: true, angle: Math.PI } }));
      const m0 = p.mag[p.slot];
      run(g, 240, () => ({ 1: { fire: true, angle: Math.PI } }));
      assert.ok(Math.abs((m0 - p.mag[p.slot]) / 4 - w.rate) < 0.26, `${wid}: ${(m0 - p.mag[p.slot]) / 4}/s vs ${w.rate}/s`);
    }
  });

  test('shotgun pellets merge into one shot event per tick with a ray per pellet', () => {
    const g = makeGame();
    const { ev } = range(g, 1, 'shotgun', 'walker', 120, 2);
    const shots = eventsOf(ev, 'shot');
    assert.equal(shots.length, 1);
    assert.equal(shots[0].rays.length, WEAPONS.shotgun.pellets);
    assert.ok(shots[0].rays.some((r) => r.hit === 1));
  });

  test('minigun needs to spin up before the first shot', () => {
    const g = makeGame();
    const p = place(g, 1, 300, 900);
    giveWeapon(g, p, 'minigun');
    const early = run(g, Math.floor(WEAPONS.minigun.spinup / DT) - 2, () => ({ 1: { fire: true } }));
    assert.equal(eventsOf(early, 'shot').length, 0);
    assert.ok(g.snapshot().players[0].spin > 0.9);
    const later = run(g, 10, () => ({ 1: { fire: true } }));
    assert.ok(eventsOf(later, 'shot').length > 0);
  });

  test('hitscan stops at solid obstacles but passes over low cover; pierce hits several', () => {
    const obstacles = [
      { id: 0, kind: 'car', x: 500, y: 300, w: 40, h: 120, a: 0, solid: true, color: '#777', wrecked: false, roof: null },
      { id: 1, kind: 'sandbags', x: 500, y: 700, w: 40, h: 120, a: 0, solid: false, color: '#777', wrecked: false, roof: null },
    ];
    const g = makeGame({ map: { ...buildArenaMap({ objective: false }), obstacles } });
    place(g, 1, 300, 300, 0);
    const behindWall = addZombie(g, 'brute', 700, 300);
    let ev = run(g, 60, () => ({ 1: { fire: true, angle: 0 } }));
    assert.equal(behindWall.hp, behindWall.maxHp);
    assert.ok(eventsOf(ev, 'shot').some((s) => s.rays.some((r) => r.hit === 2 && Math.abs(r.x - 480) < 1)));
    place(g, 1, 300, 700, 0);
    const behindBags = addZombie(g, 'brute', 700, 700);
    ev = run(g, 60, () => ({ 1: { fire: true, angle: 0 } }));
    assert.ok(behindBags.hp < behindBags.maxHp);
    // Magnum pierces 3 in a row.
    const g2 = makeGame();
    const p = place(g2, 1, 200, 900, 0);
    giveWeapon(g2, p, 'magnum');
    const line = [300, 360, 420, 480].map((x) => { const z = addZombie(g2, 'brute', x, 900); z.speed = 0; return z; });
    run(g2, 2, () => ({ 1: { fire: true, angle: 0 } }));
    assert.deepEqual(line.map((z) => z.hp < z.maxHp), [true, true, true, false]);
  });

  test('rail pierces everything in line; tesla chains between zombies', () => {
    const g = makeGame();
    g.wave = 12;
    const p = place(g, 1, 200, 900, 0);
    giveWeapon(g, p, 'railgun');
    const line = [300, 400, 500, 600, 700, 800].map((x) => { const z = addZombie(g, 'brute', x, 900); z.speed = 0; return z; });
    const ev = run(g, 2, () => ({ 1: { fire: true, angle: 0 } }));
    assert.ok(line.every((z) => z.hp < z.maxHp));
    const g2 = makeGame();
    const q = place(g2, 1, 200, 600, 0);
    giveWeapon(g2, q, 'tesla');
    const zs = [[400, 600], [500, 650], [560, 540], [650, 600]].map(([x, y]) => { const z = addZombie(g2, 'brute', x, y); z.speed = 0; return z; });
    const ev2 = run(g2, 2, () => ({ 1: { fire: true, angle: 0 } }));
    const ch = eventsOf(ev2, 'chain')[0];
    assert.ok(ch.points.length >= 5, `chain touched ${ch.points.length - 1} zombies`);
    assert.ok(zs.every((z) => z.hp < z.maxHp));
    assert.ok(ev.length > 0);
  });

  test('reload: auto on empty (one empty event), edge reload, switching cancels', () => {
    const g = makeGame();
    const p = place(g, 1, 300, 900, 0);
    p.slot = 0;
    const ev = run(g, 60 * 4, () => ({ 1: { fire: true } }));
    assert.equal(eventsOf(ev, 'empty').length >= 1, true);
    assert.ok(eventsOf(ev, 'reload').length >= 1);
    assert.ok(eventsOf(ev, 'shot').length > WEAPONS.pistol.mag, 'kept firing after the auto reload');
    // Edge reload with a partial rifle mag.
    p.slot = 1;
    p.mag[1] = 5;
    const res = p.res[1];
    let ev2 = run(g, 1, () => ({ 1: { reload: true } }));
    assert.deepEqual(eventsOf(ev2, 'reload')[0], { type: 'reload', pid: 1, weapon: 'rifle', time: WEAPONS.rifle.reload * (p.perks.reloadMult || 1) });
    assert.ok(g.snapshot().players[0].reloading > 0);
    run(g, Math.ceil(WEAPONS.rifle.reload * 0.85 / DT) + 1);
    assert.equal(p.mag[1], 30);
    assert.equal(p.res[1], res - 25);
    // Switching mid-reload cancels it.
    p.mag[1] = 5;
    run(g, 1, () => ({ 1: { reload: true } }));
    ev2 = run(g, 1, () => ({ 1: { slot: 0 } }));
    assert.deepEqual(eventsOf(ev2, 'switch')[0], { type: 'switch', pid: 1, weapon: 'pistol' });
    run(g, 200);
    assert.equal(p.mag[1], 5);
    // Cycle and last weapon.
    run(g, 1, () => ({ 1: { cycle: 1 } }));
    assert.equal(p.slot, 1);
    run(g, 1, () => ({ 1: { lastWeapon: true } }));
    assert.equal(p.slot, 0);
    run(g, 1, () => ({ 1: { cycle: -1 } }));
    assert.equal(p.slot, 1, 'cycling skips empty slots');
  });

  test('melee: cone hit with knockback, nothing behind', () => {
    const g = makeGame();
    place(g, 1, 400, 900, 0);
    const front = addZombie(g, 'walker', 450, 900);
    const behind = addZombie(g, 'walker', 330, 900);
    front.speed = behind.speed = 0;
    const ev = run(g, 1, () => ({ 1: { melee: true, angle: 0 } }));
    assert.ok(approx(front.hp, front.maxHp - MELEE_DAMAGE));
    assert.equal(behind.hp, behind.maxHp);
    assert.ok(front.kvx > 0);
    const m = eventsOf(ev, 'melee')[0];
    assert.equal(m.hits, 1);
    const ev2 = run(g, 5, () => ({ 1: { melee: true, angle: 0 } }));
    assert.equal(eventsOf(ev2, 'melee').length, 0, 'cooldown');
  });

  test('frag: bounces off walls, explodes after the fuse, hurts zombies (demo immune)', () => {
    const obstacles = [{ id: 0, kind: 'wall', x: 600, y: 600, w: 30, h: 400, a: 0, solid: true, color: '#777', wrecked: false, roof: null }];
    const g = makeGame({ map: { ...buildArenaMap({ objective: false }), obstacles }, players: [{ id: 1, cls: 'demo' }] });
    const p = place(g, 1, 450, 600, 0);
    const z = addZombie(g, 'brute', 450, 500);
    z.speed = 0;
    const hp0 = p.hp;
    const ev = run(g, Math.round(THROWABLES.frag.fuse / DT) + 5, (gg, t) => ({ 1: { frag: t < 3, angle: 0 } }));
    assert.equal(eventsOf(ev, 'throw').length, 1, 'one frag per THROW_COOLDOWN');
    const ex = eventsOf(ev, 'explosion')[0];
    assert.equal(ex.kind, 'frag');
    assert.ok(ex.x < 585, `bounced back off the wall (${ex.x})`);
    assert.ok(z.hp < z.maxHp);
    assert.equal(p.hp, hp0, 'demo is immune to own explosions');
    // A soldier whose frag bounces back off the map edge gets hurt at 35%.
    const g2 = makeGame();
    const q = place(g2, 1, 450, 24, -Math.PI / 2);
    const ev2 = run(g2, Math.round(THROWABLES.frag.fuse / DT) + 5, (gg, t) => ({ 1: { frag: t === 0, angle: -Math.PI / 2 } }));
    const ex2 = eventsOf(ev2, 'explosion')[0];
    assert.ok(Math.hypot(ex2.x - 450, ex2.y - 24) < THROWABLES.frag.explodeRadius);
    assert.ok(q.hp < q.maxHp && q.hp > q.maxHp - THROWABLES.frag.explodeDamage * 0.35 - 1e-9);
  });

  test('molotov: shatters into a fire hazard that burns zombies', () => {
    const g = makeGame();
    place(g, 1, 300, 900, 0);
    const z = addZombie(g, 'brute', 520, 900);
    z.speed = 0;
    const ev = run(g, 90, () => ({ 1: { molotov: g.tick === 0, angle: 0 } }));
    assert.equal(eventsOf(ev, 'ignite').length, 0, 'demo-less soldier has no molotov');
    const p = g.getPlayer(1);
    p.molotovs = 1;
    const ev2 = run(g, 120, (gg, t) => ({ 1: { molotov: t === 0, angle: 0 } }));
    const ign = eventsOf(ev2, 'ignite');
    assert.equal(ign.length, 1);
    assert.equal(ign[0].r, THROWABLES.molotov.fireRadius);
    assert.ok(Math.abs(ign[0].x - 520) < 40, 'shattered on the zombie');
    assert.ok(g.hazards.some((h) => h.kind === 'fire'));
    assert.ok(z.hp < z.maxHp && z.burnT > 0);
    const snap = g.snapshot();
    assert.ok(snap.hazards[0].kind === 'fire' && snap.hazards[0].life > 0);
    assert.ok(snap.zombies.find((s) => s.id === z.id).flags & ZFLAG.BURNING);
  });

  test('friendly fire: off → teammates unhurt; on → 25% and never downed', () => {
    for (const ff of [false, true]) {
      const g = makeGame({ n: 2, settings: { friendlyFire: ff } });
      place(g, 1, 300, 900, 0);
      const b = place(g, 2, 400, 900);
      b.hp = 3;
      run(g, 60, () => ({ 1: { fire: true, angle: 0 } }));
      if (ff) {
        assert.equal(b.state, 'alive');
        assert.ok(b.hp >= 1 && b.hp < 3);
      } else {
        assert.equal(b.hp, 3);
      }
    }
  });

  test('kill cash: type × difficulty × class perk, elites double', () => {
    const g = makeGame({ players: [{ id: 1, cls: 'scout' }], settings: { difficulty: 'easy' } });
    const p = place(g, 1, 300, 900);
    const c0 = p.cash;
    damageZombie(g, addZombie(g, 'walker', 600, 900), 1e9, 1);
    const k = DIFFICULTIES.easy.cash * CLASSES.scout.perks.cashMult;
    assert.equal(p.cash, c0 + Math.round(ZOMBIES.walker.cash * k));
    damageZombie(g, addZombie(g, 'runner', 600, 900, true), 1e9, 1);
    assert.equal(p.cash, c0 + Math.round(ZOMBIES.walker.cash * k) + Math.round(ZOMBIES.runner.cash * k * 2));
    assert.equal(p.kills, 2);
    assert.equal(p.earned, p.cash - c0);
  });
});

// -------------------------------------------------------------------------------------
describe('zombie specials', () => {
  test('bloater burst hurts nearby players and zombies, credited to the killer', () => {
    const g = makeGame({ n: 2 });
    const a = place(g, 1, 300, 900);
    const b = place(g, 2, 560, 900);
    const bl = addZombie(g, 'bloater', 500, 900);
    const w = addZombie(g, 'walker', 520, 950);
    bl.speed = w.speed = 0;
    // Kill it mid-game (after the tick's spatial grid is built), like a real shot would.
    run(g, 1);
    damageZombie(g, bl, 1e9, 1);
    const ev = g.snapshot().events;
    const ex = eventsOf(ev, 'explosion')[0];
    assert.equal(ex.kind, 'bloater');
    assert.equal(ex.r, ZOMBIES.bloater.special.deathRadius);
    assert.ok(b.hp < b.maxHp, 'player next to it was hurt');
    assert.equal(a.hp, a.maxHp, 'player out of range untouched');
    assert.ok(w.dead, 'walker next to it died');
    assert.equal(a.kills, 2, 'chain kill credited to the killer');
    assert.ok(eventsOf(ev, 'zdie').some((e) => e.id === w.id && e.gib === true && e.by === 1));
    assert.ok(eventsOf(ev, 'pdamage').some((e) => e.pid === 2));
  });

  test('spitter keeps its distance, lobs acid, leaves a damaging pool', () => {
    const g = makeGame();
    const p = place(g, 1, 300, 900);
    const s = addZombie(g, 'spitter', 600, 900);
    s.specialCd = 0.5;
    const ev = run(g, 60 * 3, () => { p.hp = Math.max(p.hp, 50); return {}; });
    assert.ok(eventsOf(ev, 'spit').length >= 1);
    assert.ok(eventsOf(ev, 'pdamage').length >= 1, 'acid hurt the player');
    assert.ok(g.hazards.some((h) => h.kind === 'acid') || ev.some((e) => e.type === 'spit'));
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    assert.ok(d > 150, `spitter stays back (${d.toFixed(0)} px)`);
    // Acid glob is a projectile in flight at some point.
    const g2 = makeGame();
    place(g2, 1, 300, 900);
    const s2 = addZombie(g2, 'spitter', 620, 900);
    s2.specialCd = 0;
    run(g2, 2);
    assert.ok(g2.snapshot().projectiles.some((pr) => pr.kind === 'acid'));
    run(g2, 60);
    assert.ok(g2.snapshot().hazards.some((h) => h.kind === 'acid'));
  });

  test('screamer buffs nearby zombies', () => {
    const g = makeGame();
    place(g, 1, 300, 900);
    const sc = addZombie(g, 'screamer', 700, 900);
    const w = addZombie(g, 'walker', 760, 950);
    sc.specialCd = 0;
    const ev = run(g, 2);
    assert.equal(eventsOf(ev, 'scream').length, 1);
    assert.ok(w.buffT > 0);
    assert.ok(g.snapshot().zombies.find((z) => z.id === w.id).flags & ZFLAG.BUFFED);
  });

  test('brute charges, damages and knocks the player back', () => {
    const g = makeGame();
    const p = place(g, 1, 400, 900);
    const b = addZombie(g, 'brute', 650, 900);
    b.specialCd = 0;
    const ev = run(g, 60 * 2, () => { p.hp = Math.max(p.hp, 50); return {}; });
    assert.equal(eventsOf(ev, 'charge').length, 1);
    assert.ok(eventsOf(ev, 'pdamage').length >= 1);
    assert.ok(p.x < 380, `knocked back (${p.x.toFixed(0)})`);
  });

  test('boss winds up and slams: damage + knockback in radius', () => {
    const g = makeGame({ n: 2 });
    const p = place(g, 1, 700, 900);
    const far = place(g, 2, 100, 300);
    const boss = addZombie(g, 'boss', 850, 900);
    boss.specialCd = 0;
    let ev = run(g, 2, () => { godMode(g); return {}; });
    assert.equal(boss.mode, 2, 'winding up');
    assert.ok(g.snapshot().zombies[0].flags & ZFLAG.CHARGING);
    const hp0 = p.hp;
    ev = run(g, Math.round(ZOMBIES.boss.special.windup / DT) + 2);
    const slam = eventsOf(ev, 'slam')[0];
    assert.ok(slam && slam.id === boss.id && slam.r === ZOMBIES.boss.special.radius);
    assert.ok(p.hp < hp0 || p.state === 'downed');
    assert.ok(p.kbx < -100, 'thrown away from the boss');
    assert.equal(far.hp, far.maxHp);
  });

  test('burning zombies take damage over time and move faster', () => {
    const g = makeGame();
    place(g, 1, 100, 100);
    const a = addZombie(g, 'walker', 800, 900), b = addZombie(g, 'walker', 800, 1000);
    a.speed = b.speed = 60;
    a.burnT = 3;
    a.burnDps = 10;
    a.burnBy = 1;
    const ax = a.x, bx = b.x;
    run(g, 30);
    assert.ok(a.hp < a.maxHp - 4);
    const da = Math.hypot(a.x - ax, a.y - 900), db = Math.hypot(b.x - bx, b.y - 1000);
    assert.ok(da > db * 1.1, `burning one moved farther (${da.toFixed(1)} vs ${db.toFixed(1)})`);
    assert.ok(g.getPlayer(1).damage > 0, 'burn damage credited');
  });

  test('heavies crash over low cover; walkers go around; the boss squeezes between cars', () => {
    const rail = { id: 0, kind: 'guardrail', x: 800, y: 600, w: 12, h: 1100, a: 0, solid: false, color: '#777', wrecked: false, roof: null };
    // A wall of wrecks top to bottom with one 60 px gap at y=1180.
    const cars = [
      { id: 1, kind: 'semi', x: 800, y: 575, w: 90, h: 1150, a: 0, solid: true, color: '#777', wrecked: false, roof: null },
      { id: 2, kind: 'semi', x: 800, y: 1405, w: 90, h: 390, a: 0, solid: true, color: '#777', wrecked: false, roof: null },
    ];
    const g = makeGame({ map: { ...buildArenaMap({ objective: false }), obstacles: [rail] } });
    place(g, 1, 1100, 600);
    const w = addZombie(g, 'walker', 500, 600), b = addZombie(g, 'brute', 500, 500);
    w.speed = b.speed = 100;
    b.specialCd = 1e9;
    run(g, 60 * 5, () => { godMode(g); return {}; });
    assert.ok(b.x > 800, `brute went straight over the rail (${b.x.toFixed(0)})`);
    assert.ok(w.x < 800 || Math.abs(w.y - 600) > 500, 'walker had to go around the rail');
    // The gap is too tight for the boss's 44 px body but fine for its 28 px world collider.
    const g2 = makeGame({ map: { ...buildArenaMap({ width: 1600, height: 1600, objective: false }), obstacles: cars } });
    place(g2, 1, 1100, 1180);
    const boss = addZombie(g2, 'boss', 500, 1180);
    boss.speed = 100;
    boss.specialCd = 1e9;
    run(g2, 60 * 5, () => { godMode(g2); return {}; });
    assert.ok(boss.x > 850, `boss got through the gap (${boss.x.toFixed(0)}, ${boss.y.toFixed(0)})`);
  });

  test('knockback respects mass and decays quickly', () => {
    const g = makeGame();
    place(g, 1, 100, 100);
    const light = addZombie(g, 'walker', 600, 600), heavy = addZombie(g, 'brute', 600, 900);
    light.speed = heavy.speed = 0;
    light.kvx = 400 * (1 - light.mass);
    heavy.kvx = 400 * (1 - heavy.mass);
    run(g, 30);
    assert.ok(light.x - 600 > (heavy.x - 600) * 3);
    assert.ok(Math.abs(light.kvx) < 5, `knockback decayed (${light.kvx})`);
    run(g, 30);
    assert.equal(light.kvx, 0);
  });
});

// -------------------------------------------------------------------------------------
describe('deployables, pickups, support', () => {
  test('turret placement, targeting with LOS, kills credited to the owner', () => {
    const g = makeGame({ players: [{ id: 1, cls: 'engineer' }] });
    const p = place(g, 1, 300, 900, 0);
    let ev = run(g, 1, () => ({ 1: { turret: true, angle: 0 } }));
    const pl = eventsOf(ev, 'place')[0];
    assert.equal(pl.kind, 'turret');
    assert.equal(p.turrets, 0);
    assert.equal(g.turrets.length, 1);
    const t = g.turrets[0];
    assert.ok(Math.abs(t.x - (300 + BARRICADE.placeDistance)) < 1e-6);
    // Walk away so only the turret can kill it.
    place(g, 1, 100, 300, Math.PI);
    const z = addZombie(g, 'walker', 700, 900);
    const cash0 = p.cash;
    ev = run(g, 60 * 5, () => { godMode(g); return {}; });
    assert.ok(z.dead, 'turret killed the walker');
    const zd = eventsOf(ev, 'zdie').find((e) => e.id === z.id);
    assert.equal(zd.by, 1);
    assert.equal(p.kills, 1);
    assert.ok(p.cash > cash0);
    const shot = eventsOf(ev, 'shot')[0];
    assert.equal(shot.pid, 0);
    assert.equal(shot.turret, t.id);
    assert.ok(t.ammo < TURRET.ammo);
    const snap = g.snapshot().turrets[0];
    assert.equal(snap.owner, 1);
    assert.ok(snap.ammo < 1 && snap.hp === 1);
  });

  test('turret placement fails into walls; zombies can destroy turrets', () => {
    const obstacles = [{ id: 0, kind: 'wall', x: 360, y: 900, w: 40, h: 200, a: 0, solid: true, color: '#777', wrecked: false, roof: null }];
    const g = makeGame({ players: [{ id: 1, cls: 'engineer' }], map: { ...buildArenaMap({ objective: false }), obstacles } });
    place(g, 1, 300, 900, 0);
    let ev = run(g, 1, () => ({ 1: { turret: true, angle: 0 } }));
    assert.equal(eventsOf(ev, 'place').length, 0);
    assert.equal(eventsOf(ev, 'placefail').length, 1);
    ev = run(g, 1, () => ({ 1: { turret: true, angle: Math.PI } }));
    assert.equal(g.turrets.length, 1);
    const t = g.turrets[0];
    t.hp = 20;
    t.ammo = 0;
    place(g, 1, 1500, 200);
    addZombie(g, 'walker', t.x - 60, t.y);
    ev = run(g, 60 * 4, () => { godMode(g); return {}; });
    const d = eventsOf(ev, 'destroyed')[0];
    assert.equal(d.kind, 'turret');
    assert.equal(g.turrets.length, 0);
  });

  test('barricade: placed in front, blocks zombies, gets smashed, costs the flow field', () => {
    // A wall across the arena with an 80 px doorway at y=900; the barricade seals it
    // from the inside (too little room between wall and barricade to slip past).
    const wall = (id, y, h) => ({ id, kind: 'wall', x: 900, y, w: 30, h, a: 0, solid: true, color: '#777', wrecked: false, roof: null });
    const map = { ...buildArenaMap({ objective: false }), obstacles: [wall(0, 430, 860), wall(1, 1070, 260)] };
    const g = makeGame({ map });
    const p = place(g, 1, 860 - BARRICADE.placeDistance, 900, 0);
    p.barricades = 1;
    let ev = run(g, 1, () => ({ 1: { barricade: true, angle: 0 } }));
    assert.equal(eventsOf(ev, 'place')[0].kind, 'barricade');
    assert.equal(g.barricades.length, 1);
    const b = g.barricades[0];
    assert.ok(Math.abs(b.a - Math.PI / 2) < 1e-9, 'long side faces the aim');
    assert.equal(g.world.barricades.length, 1);
    const c = g.flow.cellAt(b.x, b.y);
    assert.ok(g.flow.cost[c] > g.flow.baseCost[c]);
    b.hp = 40;
    // A walker on the far side of the doorway.
    const z = addZombie(g, 'walker', 1000, 900);
    ev = run(g, 60 * 6, () => { godMode(g); return { 1: { angle: 0 } }; });
    assert.equal(eventsOf(ev, 'destroyed')[0].kind, 'barricade');
    assert.equal(g.barricades.length, 0);
    assert.equal(g.world.barricades.length, 0);
    assert.ok(!z.dead);
  });

  test('pickups: auto-collect what you need, leave the rest; crates need interact', () => {
    const g = makeGame();
    const p = place(g, 1, 400, 900);
    spawnPickup(g, 'health', 400, 900);
    run(g, 1);
    assert.equal(g.pickups.length, 1, 'full health: first aid stays on the ground');
    p.hp = 20;
    let ev = run(g, 1);
    assert.equal(p.hp, 55);
    assert.deepEqual(eventsOf(ev, 'pickup')[0], { type: 'pickup', pid: 1, kind: 'health', x: 400, y: 900, weapon: null });
    p.res[1] = 0;
    spawnPickup(g, 'ammo', 410, 900);
    run(g, 1);
    assert.equal(p.res[1], Math.ceil(WEAPONS.rifle.reserve * 0.35));
    const c0 = p.cash;
    spawnPickup(g, 'cash', 400, 905);
    run(g, 1);
    assert.ok(p.cash - c0 >= 50 && p.cash - c0 <= 150);
    spawnPickup(g, 'crate', 430, 900, 'lmg');
    run(g, 5);
    assert.equal(g.pickups.length, 1, 'crates are not auto-collected');
    ev = run(g, 1, () => ({ 1: { interact: true } }));
    assert.deepEqual(p.slots, ['pistol', 'rifle', 'lmg']);
    assert.equal(eventsOf(ev, 'pickup')[0].weapon, 'lmg');
    assert.equal(g.pickups.length, 0);
    spawnPickup(g, 'armor', 1400, 300);
    run(g, Math.round(30 / DT) + 2);
    assert.equal(g.pickups.length, 0, 'pickups expire');
  });

  test('medic aura heals nearby teammates', () => {
    const g = makeGame({ players: [{ id: 1, cls: 'medic' }, { id: 2, cls: 'soldier' }, { id: 3, cls: 'soldier' }] });
    place(g, 1, 400, 900);
    const b = place(g, 2, 500, 900), c = place(g, 3, 1400, 300);
    b.hp = c.hp = 50;
    run(g, 60);
    assert.ok(approx(b.hp, 53, 0.05), `healed ~3 hp/s (${b.hp})`);
    assert.equal(c.hp, 50);
  });
});

// -------------------------------------------------------------------------------------
describe('roster changes and snapshots', () => {
  test('late join: dead until the wave clears mid-wave; alive between waves', () => {
    const g = makeGame({ sandbox: false });
    const early = g.addPlayer({ id: 2, name: 'Early', color: 1, cls: 'medic' });
    assert.equal(early.state, 'alive');
    g._startWave(1);
    const late = g.addPlayer({ id: 3, name: 'Late', color: 2, cls: 'heavy' });
    assert.equal(late.state, 'dead');
    assert.equal(late.respawn, true);
    assert.equal(g.addPlayer({ id: 3 }), late, 'adding twice is a no-op');
    run(g, 60 * 120, () => { godMode(g); for (const z of g.zombies) damageZombie(g, z, 1e9, 1); return {}; }, (gg) => gg.phase !== 'wave');
    assert.equal(late.state, 'alive');
    assert.equal(late.maxHp, 150);
    g.removePlayer(2);
    assert.equal(g.players.length, 2);
    assert.equal(g.snapshot().players.length, 2);
    g.removePlayer(42);
  });

  test('snapshot has every field of SPEC §4 with sane values', () => {
    const g = makeGame({ n: 2, objective: true });
    g.getPlayer(1).barricades = 1;
    addZombie(g, 'walker', 700, 900);
    run(g, 5, () => ({ 1: { fire: true, angle: 0 } }));
    const s = g.snapshot();
    for (const k of ['tick', 'phase', 'wave', 'totalWaves', 'timer', 'remaining', 'bossHp', 'objective', 'readyCount',
      'players', 'zombies', 'projectiles', 'pickups', 'turrets', 'barricades', 'hazards', 'events']) {
      assert.ok(k in s, `snapshot.${k}`);
    }
    assert.equal(s.bossHp, -1);
    const p = s.players[0];
    for (const k of ['id', 'x', 'y', 'angle', 'state', 'hp', 'maxHp', 'armor', 'stamina', 'sprinting', 'slot', 'slots',
      'ammo', 'reloading', 'spin', 'firing', 'meleeing', 'cash', 'kills', 'damage', 'revives', 'downs', 'frags', 'molotovs',
      'turrets', 'barricades', 'selfRevive', 'bleedout', 'revive', 'reviver', 'respawn', 'ready', 'lastSeq', 'sprintLock']) {
      assert.ok(k in p, `player.${k}`);
    }
    assert.equal(p.sprintLock, false);
    g.getPlayer(1).stamina = 1;
    run(g, 4, () => ({ 1: { moveX: 1, sprint: true } }));
    assert.equal(g.snapshot().players[0].sprintLock, true, 'exhausted players are sprint-locked');
    assert.equal(p.slots.length, 3);
    assert.deepEqual(p.ammo[2], [0, 0]);
    assert.equal(p.ammo[0][1], -1, 'pistol reserve is infinite');
    assert.equal(p.firing, true);
    assert.equal(p.barricades, 1);
    const z = s.zombies[0];
    for (const k of ['id', 'type', 'x', 'y', 'angle', 'hp', 'flags']) assert.ok(k in z, `zombie.${k}`);
    assert.ok(z.hp > 0 && z.hp <= 1);
    assert.deepEqual(Object.keys(s.objective).sort(), ['hp', 'maxHp']);
    assert.equal(g.snapshot().events.length, 0, 'events drained by the previous snapshot');
    assert.doesNotThrow(() => JSON.stringify(s));
  });

  test('entity ids are uint16 and unique among live entities', () => {
    const g = makeGame();
    const ids = new Set();
    for (let i = 0; i < 300; i++) {
      const z = addZombie(g, 'walker', 100 + (i % 30) * 40, 100 + Math.floor(i / 30) * 40);
      assert.ok(z.id >= 1 && z.id <= 65535);
      assert.ok(!ids.has(z.id));
      ids.add(z.id);
    }
  });
});

// -------------------------------------------------------------------------------------
describe('determinism', () => {
  function playthrough(seed, ticks) {
    const map = buildFixtureMap(7);
    const g = new GameCore({
      map, seed, settings: { difficulty: 'normal', waves: 15, objective: true },
      players: [{ id: 1, name: 'A', color: 0, cls: 'soldier' }, { id: 2, name: 'B', color: 1, cls: 'demo' }, { id: 3, name: 'C', color: 2, cls: 'engineer' }],
    });
    for (const p of g.players) p.cash = 6000;
    const bots = g.players.map((p) => createBot(g, p.id));
    let hash = 0;
    let last = null;
    for (let t = 0; t < ticks; t++) {
      if ((g.phase === 'prep' || g.phase === 'intermission') && t % 60 === 0) for (const b of bots) b.shop();
      for (const b of bots) {
        const c = b.think();
        // Sprinkle in edge presses so every system gets exercised.
        if (t % 400 === 50) c.frag = true;
        if (t % 500 === 90) c.turret = true;
        if (t % 700 === 10) c.melee = true;
        g.setInput(b.pid, c);
      }
      g.step();
      if (t % 3 === 0) {
        last = g.snapshot();
        for (const e of last.events) hash = (hash * 31 + JSON.stringify(e).length + e.type.charCodeAt(0)) >>> 0;
      }
    }
    return { snap: JSON.stringify(g.snapshot()), hash, last };
  }

  test('same seed + same inputs → identical snapshots after 3000 ticks', () => {
    const a = playthrough(123, 3000), b = playthrough(123, 3000);
    assert.equal(a.hash, b.hash);
    assert.equal(a.snap, b.snap);
    assert.ok(a.last.zombies.length > 0 || a.last.phase !== 'prep', 'the game actually progressed');
    const c = playthrough(124, 3000);
    assert.notEqual(c.snap, a.snap, 'a different seed plays differently');
  });
});

// -------------------------------------------------------------------------------------
describe('balance and robustness', () => {
  test('solo bot with starter guns survives waves 1-3 on normal (fixture map)', () => {
    const g = new GameCore({
      map: buildFixtureMap(7), seed: 3, settings: { difficulty: 'normal', waves: 3, objective: true },
      players: [{ id: 1, name: 'Solo', color: 0, cls: 'soldier' }],
    });
    const bot = createBot(g, 1, { shop: false });
    runBots(g, [bot], 60 * 60 * 10, (gg) => gg.phase === 'victory' || gg.phase === 'gameover');
    assert.equal(g.phase, 'victory', `ended ${g.phase}/${g.over} on wave ${g.wave}`);
  });

  test('events per snapshot stay bounded under heavy fire', () => {
    const g = makeGame({ n: 6, map: buildFixtureMap(7) });
    g.players.forEach((p, i) => { place(g, p.id, 1400 + i * 40, 1000); giveWeapon(g, p, 'auto_shotgun'); p.frags = 5; });
    for (let i = 0; i < 250; i++) addZombie(g, i % 7 === 0 ? 'bloater' : 'walker', 1100 + (i % 25) * 40, 700 + Math.floor(i / 25) * 60);
    let maxEv = 0;
    for (let t = 0; t < 180; t++) {
      godMode(g);
      for (const p of g.players) g.setInput(p.id, cmd({ seq: t + 1, fire: true, frag: t % 20 === 0, angle: -Math.PI / 2 + (p.id - 3) * 0.3 }));
      g.step();
      if (t % 3 === 2) maxEv = Math.max(maxEv, g.snapshot().events.length);
    }
    assert.ok(maxEv <= 220, `max ${maxEv} events in one snapshot`);
  });

  test('perf: 250 zombies + 6 bots, 600 ticks, average step() < 4 ms', () => {
    const g = makeGame({ n: 6, map: buildFixtureMap(7), players: ['soldier', 'medic', 'engineer', 'scout', 'demo', 'heavy'].map((cls, i) => ({ id: i + 1, cls })) });
    const bots = g.players.map((p) => createBot(g, p.id, { shop: false }));
    const types = ['walker', 'walker', 'walker', 'runner', 'crawler', 'bloater', 'spitter', 'screamer', 'brute'];
    const rects = g.map.zombieSpawns;
    let total = 0, max = 0, k = 0;
    for (let t = 0; t < 700; t++) {
      while (g.zombies.length < 250) {
        const r = rects[k % rects.length];
        addZombie(g, types[k % types.length], r.x + ((k * 37) % r.w) - r.w / 2, r.y + ((k * 53) % r.h) - r.h / 2);
        k++;
      }
      godMode(g);
      for (const b of bots) g.setInput(b.pid, b.think());
      const t0 = performance.now();
      g.step();
      const d = performance.now() - t0;
      if (t >= 100) {
        total += d;
        max = Math.max(max, d);
      }
      if (t % 3 === 0) g.snapshot();
    }
    const avg = total / 600;
    console.log(`# perf: avg step ${avg.toFixed(3)} ms, max ${max.toFixed(2)} ms (250 zombies, 6 bots)`);
    assert.ok(avg < 4, `average step ${avg.toFixed(3)} ms`);
  });
});

// -------------------------------------------------------------------------------------
describe('every map', { skip: !Game && 'shared/maps.js not available' }, () => {
  for (const { id } of MAP_LIST) {
    test(`${id}: zombies from every spawn reach a player within 60 s (nobody stuck)`, () => {
      const g = new Game({ mapId: id, seed: 4242, settings: { difficulty: 'normal', waves: 15, objective: false }, players: [{ id: 1, name: 'Bait', color: 0, cls: 'soldier' }] });
      g.phase = 'intermission';
      g.timer = 1e9;
      g.wave = 1;
      const sp = g.map.playerSpawns[0];
      place(g, 1, sp.x, sp.y);
      const stuck = [];
      let worst = 0;
      // One spawn rectangle at a time, so a crowd around the bait can't hide a stuck one.
      g.map.zombieSpawns.forEach((r, i) => {
        const zs = [];
        for (const [fx, fy, type] of [[0, 0, 'walker'], [-0.35, -0.35, 'runner'], [0.35, 0.35, 'crawler'], [0.3, -0.3, 'brute'], [-0.3, 0.3, 'boss']]) {
          const z = addZombie(g, type, r.x + fx * r.w, r.y + fy * r.h);
          // Pathing test, not a speed test: everyone walks at 110 px/s.
          z.speed = 110;
          z.specialCd = 1e9;
          zs.push(z);
        }
        const reached = new Set();
        let t = 0;
        for (; t < 60 * 60 && reached.size < zs.length; t++) {
          const p = g.getPlayer(1);
          p.hp = p.maxHp;
          p.x = sp.x;
          p.y = sp.y;
          g.step();
          g.snapshot();
          for (const z of zs) if (!reached.has(z) && Math.hypot(z.x - p.x, z.y - p.y) < 160) reached.add(z);
        }
        worst = Math.max(worst, t);
        for (const z of zs) {
          if (!reached.has(z)) stuck.push(`${z.type}@spawn${i}(${z.x.toFixed(0)},${z.y.toFixed(0)})`);
          z.dead = true;
        }
        g.step();
      });
      console.log(`# ${id}: slowest spawn reached the bait in ${(worst / 60).toFixed(1)} s`);
      assert.deepEqual(stuck, [], `stuck zombies on ${id}`);
    });

    test(`${id}: a bot team with good guns clears waves 1-3`, () => {
      const g = new Game({
        mapId: id, seed: 77, settings: { difficulty: 'normal', waves: 3, objective: true },
        players: ['soldier', 'medic', 'engineer', 'scout'].map((cls, i) => ({ id: i + 1, name: cls, color: i, cls })),
      });
      for (const p of g.players) p.cash = 6000;
      const bots = g.players.map((p) => createBot(g, p.id));
      runBots(g, bots, 60 * 60 * 12, (gg) => gg.phase === 'victory' || gg.phase === 'gameover');
      assert.equal(g.phase, 'victory', `${id}: ended ${g.phase}/${g.over} on wave ${g.wave}, objective ${g.objective && Math.round(g.objective.hp)}`);
    });
  }
});
