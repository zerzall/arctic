// AI survivors (SPEC §3.6, shared/sim/bots.js): target choice, revive, kiting, weapon
// handling, throwables, shopping and the ready vote, whole waves on every map with an
// idle human, nobody getting stuck, determinism and the per-tick cost.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPLY_RADIUS, PREP_TIME } from '../public/js/shared/constants.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { GameCore } from '../public/js/shared/sim/core.js';
import { damagePlayer, spawnPickup } from '../public/js/shared/sim/players.js';
import { targetScore, nextPurchase, GUN_VALUE } from '../public/js/shared/sim/bots.js';
import {
  makeGame, addZombie, place, run, eventsOf, godMode, buildFixtureMap, buildArenaMap, cmd,
} from './helpers/sim-helpers.js';
import { createBot } from './helpers/bots.js';

let Game = null, MAP_LIST = [];
try {
  ({ Game } = await import('../public/js/shared/sim.js'));
  ({ MAP_LIST } = await import('../public/js/shared/maps.js'));
} catch (err) {
  Game = null;
  console.log('# maps.js unavailable, per-map bot tests skipped:', err.message);
}

const HUMAN = { id: 1, name: 'Human', color: 0, cls: 'soldier' };
const bot = (id, cls = 'soldier') => ({ id, name: `Bot${id}`, color: id - 1, cls, bot: true });
const brainOf = (g, id) => g.bots.find((b) => b.pid === id);

/** Make bot `id` want to hold exactly where it stands (its defend spot). */
function pinSpot(g, id) {
  const b = brainOf(g, id);
  b.spotX = b.p.x;
  b.spotY = b.p.y;
  b.spotAX = b.ax = g.getPlayer(1).x;
  b.spotAY = b.ay = g.getPlayer(1).y;
  b.spotT = 1e9;
  return b;
}

/** Mid-wave with nothing left to spawn: only the zombies a test adds exist. */
function battle(g) {
  g.phase = 'wave';
  g.wave = 1;
  g.timer = 0;
  g.spawnQueue = 0;
  g.bossQueue = 0;
  return g;
}

/** A zombie that stands still and does no harm (a target dummy). */
function dummy(g, type, x, y) {
  const z = addZombie(g, type, x, y);
  z.speed = 0;
  z.damage = 0;
  z.specialCd = 1e9;
  return z;
}

/** Arena with extra obstacles: [{ x, y, w, h, a?, solid? }]. */
function arenaWith(obstacles) {
  const map = buildArenaMap({ objective: false });
  map.obstacles = obstacles.map((o, i) => ({
    id: i, kind: o.kind || 'wall', x: o.x, y: o.y, w: o.w, h: o.h, a: o.a || 0,
    color: '#777777', solid: o.solid !== false, wrecked: false, roof: null,
  }));
  return map;
}

function shotsBy(events, pid) {
  return events.filter((e) => e.type === 'shot' && e.pid === pid);
}

// -------------------------------------------------------------------------------------
describe('bots in the game', () => {
  test('bots are players with a brain; the solo self-revive kit counts bots as players', () => {
    const g = makeGame({ players: [HUMAN, bot(2, 'medic')], sandbox: false });
    assert.equal(g.bots.length, 1);
    assert.equal(g.getPlayer(2).bot, true);
    assert.equal(g.getPlayer(1).bot, false);
    assert.equal(g.getPlayer(1).selfRevive, false, 'two players (one a bot): no solo kit');
    const solo = makeGame({ players: [bot(1)], sandbox: false });
    assert.equal(solo.getPlayer(1).selfRevive, true, 'exactly one player, even a bot, gets the kit');
    // Same class, same stats: no cheating numbers for bots.
    assert.deepEqual(g.getPlayer(2).perks, makeGame({ players: [{ ...HUMAN, cls: 'medic' }] }).getPlayer(1).perks);
    // Late join and removal keep the brain list in step.
    g.addPlayer(bot(3, 'heavy'));
    assert.deepEqual(g.bots.map((b) => b.pid), [2, 3]);
    g.removePlayer(2);
    assert.deepEqual(g.bots.map((b) => b.pid), [3]);
  });

  test('every bot cmd goes through the input queue (lastSeq advances once per tick)', () => {
    const g = makeGame({ players: [HUMAN, bot(2)], sandbox: false });
    const p = g.getPlayer(2);
    for (let i = 0; i < 10; i++) g.step();
    assert.equal(p.lastSeq, 10);
    assert.equal(p.queue.length, 0);
  });
});

// -------------------------------------------------------------------------------------
describe('target choice', () => {
  test('a zombie mauling a teammate beats a nearer one coming for the bot', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 500, 600);
    place(g, 2, 900, 600);
    const mauler = addZombie(g, 'walker', 530, 600);
    addZombie(g, 'walker', 900, 300);
    const b = brainOf(g, 2);
    for (let t = 0; t < 20 && !b.target; t++) {
      godMode(g);
      g.step();
    }
    assert.equal(b.target, mauler);
  });

  test('specials at range rank above walkers; bloaters next to a teammate are left alone', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 300, 300);
    place(g, 2, 800, 600);
    const b = brainOf(g, 2);
    const walker = addZombie(g, 'walker', 800, 220);
    const spitter = addZombie(g, 'spitter', 1180, 600);
    const bloaterNear = addZombie(g, 'bloater', 360, 300);
    const bloaterFar = addZombie(g, 'bloater', 800, 1000);
    const range = WEAPONS.rifle.range;
    const s = (z) => targetScore(g, b, z, Math.hypot(z.x - 800, z.y - 600), range);
    assert.ok(s(spitter) > s(walker), 'spitter at 380 px over a walker at 380 px');
    assert.ok(s(bloaterFar) > s(walker), 'a lone bloater is popped at range');
    assert.ok(s(bloaterNear) < s(walker), 'a bloater hugging a teammate is not');
    const outOfRange = targetScore(g, b, walker, WEAPONS.shotgun.range + 50, WEAPONS.shotgun.range);
    assert.ok(outOfRange < 0, 'out of weapon range scores below zero');
  });

  test('only shoots what it can see: a nearer zombie behind a wall is ignored', () => {
    const map = arenaWith([{ x: 800, y: 450, w: 300, h: 30 }]);
    const g = battle(makeGame({ map, players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 200, 1000);
    place(g, 2, 800, 600);
    const hidden = dummy(g, 'walker', 800, 330);
    const seen = dummy(g, 'walker', 1250, 600);
    const b = brainOf(g, 2);
    for (let t = 0; t < 20 && !b.target; t++) g.step();
    assert.equal(b.target, seen);
    assert.notEqual(b.target, hidden);
  });
});

// -------------------------------------------------------------------------------------
describe('aim and fire', () => {
  test('reaction delay before the first shot, then hits: aim error shrinks while tracking', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 200, 1000);
    const p = place(g, 2, 400, 600, Math.PI);
    const z = dummy(g, 'brute', 900, 600);
    const ev = [];
    let firstShot = -1;
    for (let t = 0; t < 180; t++) {
      g.step();
      for (const e of g.snapshot().events) {
        ev.push(e);
        if (firstShot < 0 && e.type === 'shot' && e.pid === 2) firstShot = t;
      }
    }
    assert.ok(firstShot >= 6, `no instant snap-shot (first shot at tick ${firstShot})`);
    assert.ok(firstShot < 90, `fires within 1.5 s (tick ${firstShot})`);
    const b = brainOf(g, 2);
    assert.ok(Math.abs(b.aimErr) < 0.02, `aim error decayed (${b.aimErr.toFixed(3)})`);
    const rays = shotsBy(ev, 2).flatMap((e) => e.rays);
    const hits = rays.filter((r) => r.hit === 1).length;
    assert.ok(hits / rays.length > 0.6, `mostly hits once tracking (${hits}/${rays.length})`);
    assert.ok(z.hp < z.maxHp, 'the target took damage');
    assert.ok(p.x < 420, 'stood its ground against a slow target out of reach');
  });

  test('never holds the trigger at nothing; reloads between fights', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 200, 1000);
    const p = place(g, 2, 800, 600);
    dummy(g, 'walker', 1550, 80);
    p.mag[1] = 5;
    const ev = run(g, 150);
    assert.equal(shotsBy(ev, 2).length, 0, 'nothing in sight, nothing fired');
    assert.ok(eventsOf(ev, 'reload').some((e) => e.pid === 2), 'topped up a low magazine in the lull');
  });

  test('friendly fire on: never shoots through a teammate; fires once the line is clear', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2)], sandbox: false, settings: { friendlyFire: true } }));
    const human = place(g, 1, 650, 600);
    place(g, 2, 450, 600);
    dummy(g, 'brute', 1000, 600);
    let ev = run(g, 90, () => ({ 1: {} }));
    assert.equal(shotsBy(ev, 2).length, 0, 'held fire with the human in the way');
    assert.equal(human.hp, human.maxHp);
    human.y = 850;
    ev = run(g, 90, () => ({ 1: {} }));
    assert.ok(shotsBy(ev, 2).length > 0, 'fires when the human steps aside');
  });

  test('switches to the better gun for the range and shoves when surrounded', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2, 'heavy')], sandbox: false }));
    place(g, 1, 200, 1000);
    const p = place(g, 2, 800, 600);
    p.slots = ['pistol', 'shotgun', 'dmr'];
    p.mag = [12, 6, 20];
    p.res = [-1, 48, 160];
    p.slot = 1;
    dummy(g, 'brute', 800, 1100);
    run(g, 60);
    assert.equal(p.slots[p.slot], 'dmr', 'long range: the battle rifle, not the shotgun');
    for (const [dx, dy] of [[34, 0], [-34, 0], [0, 34]]) dummy(g, 'walker', p.x + dx, p.y + dy);
    const ev = run(g, 40);
    assert.ok(eventsOf(ev, 'melee').some((e) => e.pid === 2), 'shoved the walkers off');
  });
});

// -------------------------------------------------------------------------------------
describe('movement', () => {
  test('kites back from a rush while shooting', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 150, 1050);
    const p = place(g, 2, 800, 600);
    pinSpot(g, 2);
    const zs = [];
    for (let i = 0; i < 3; i++) {
      const z = addZombie(g, 'walker', 1100, 560 + i * 40);
      z.speed = 120;
      z.hp = z.maxHp = 5000;
      zs.push(z);
    }
    const ev = [];
    for (let t = 0; t < 150; t++) {
      godMode(g);
      g.step();
      for (const e of g.snapshot().events) ev.push(e);
    }
    assert.ok(p.x < 740, `backed off (x ${p.x.toFixed(0)})`);
    assert.ok(shotsBy(ev, 2).length > 0, 'shot while kiting');
    const gap = Math.min(...zs.map((z) => Math.hypot(z.x - p.x, z.y - p.y)));
    assert.ok(gap > 60, `kept its distance (${gap.toFixed(0)} px)`);
  });

  test('kiting against a wall slides along it instead of pushing into it', () => {
    // A long wall right behind the bot; the rush comes straight at it.
    const map = arenaWith([{ x: 700, y: 600, w: 30, h: 700 }]);
    const g = battle(makeGame({ map, players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 150, 1100);
    // Flush against the wall (x 715 + radius 16): the spot where a too-fat probe fails.
    const p = place(g, 2, 731, 600);
    pinSpot(g, 2);
    for (let i = 0; i < 3; i++) {
      const z = addZombie(g, 'walker', 1000, 580 + i * 20);
      z.speed = 110;
      z.hp = z.maxHp = 5000;
    }
    const y0 = p.y;
    for (let t = 0; t < 150; t++) {
      godMode(g);
      g.step();
      g.snapshot();
    }
    assert.ok(Math.abs(p.y - y0) > 80, `slid along the wall (moved ${Math.abs(p.y - y0).toFixed(0)} px)`);
  });

  test('walks around obstacles to reach its post (A* over the bots\' grid)', () => {
    // A U-shaped trap between the bot and the human it follows.
    const map = arenaWith([
      { x: 800, y: 500, w: 500, h: 30 },
      { x: 560, y: 380, w: 30, h: 260 },
      { x: 1040, y: 380, w: 30, h: 260 },
    ]);
    const g = battle(makeGame({ map, players: [HUMAN, bot(2)], sandbox: false }));
    place(g, 1, 800, 850);
    const p = place(g, 2, 800, 380);
    dummy(g, 'walker', 60, 60);
    const b = brainOf(g, 2);
    b.lastSeenT = 1e9;
    for (let t = 0; t < 600; t++) {
      g.step();
      g.snapshot();
      b.lastSeenT = g.time;
    }
    assert.ok(Math.hypot(p.x - 800, p.y - 850) < 260, `reached the human (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
    assert.ok(g.botNav.searches > 0, 'used a path search');
  });
});

// -------------------------------------------------------------------------------------
describe('support', () => {
  test('revives a downed teammate', () => {
    const g = makeGame({ players: [HUMAN, bot(2, 'soldier')] });
    const human = place(g, 1, 800, 800);
    place(g, 2, 800, 400);
    damagePlayer(g, human, 1000, 800, 700);
    assert.equal(human.state, 'downed');
    const ev = run(g, 60 * 8, null, () => human.state === 'alive');
    assert.equal(human.state, 'alive');
    assert.ok(eventsOf(ev, 'revived').some((e) => e.pid === 1 && e.by === 2));
  });

  test('clears the zombies around a swarmed teammate before reviving', () => {
    const g = makeGame({ players: [HUMAN, bot(2, 'soldier')] });
    const human = place(g, 1, 800, 800);
    const p = place(g, 2, 800, 250);
    p.slots[2] = 'lmg';
    p.mag[2] = 100;
    p.res[2] = 400;
    damagePlayer(g, human, 1000, 800, 700);
    const zs = [];
    for (let i = 0; i < 4; i++) zs.push(dummy(g, 'walker', 700 + i * 60, 900));
    run(g, 32);
    assert.equal(brainOf(g, 2).mode, 'clear', 'secures the area first');
    run(g, 60 * 15, null, () => human.state === 'alive');
    assert.ok(zs.every((z) => z.dead), 'killed the zombies');
    assert.equal(human.state, 'alive', 'then revived');
  });

  test('throws a frag at a dense pack, never with a teammate next to it', () => {
    const setup = (humanNear) => {
      const g = battle(makeGame({ players: [HUMAN, bot(2, 'demo')], sandbox: false }));
      place(g, 1, humanNear ? 780 : 150, humanNear ? 700 : 1100);
      place(g, 2, 400, 600);
      for (let i = 0; i < 9; i++) dummy(g, 'walker', 740 + (i % 3) * 30, 570 + Math.floor(i / 3) * 30);
      return g;
    };
    const ev = run(setup(false), 90);
    assert.ok(eventsOf(ev, 'throw').some((e) => e.pid === 2 && e.kind === 'frag'), 'frag out');
    const ev2 = run(setup(true), 90, () => ({ 1: {} }));
    assert.equal(eventsOf(ev2, 'throw').filter((e) => e.pid === 2).length, 0, 'no frag next to the human');
  });

  test('picks up a better gun from a weapon crate', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2, 'soldier')], sandbox: false }));
    place(g, 1, 150, 1100);
    const p = place(g, 2, 600, 600);
    dummy(g, 'walker', 1560, 60);
    spawnPickup(g, 'crate', 850, 700, 'lmg');
    const ev = run(g, 60 * 5, null, () => p.slots.includes('lmg'));
    assert.ok(p.slots.includes('lmg'), `took the lmg: ${p.slots}`);
    assert.ok(eventsOf(ev, 'pickup').some((e) => e.pid === 2 && e.kind === 'crate'));
  });

  test('a downed bot crawls toward a teammate and fires its pistol', () => {
    const g = battle(makeGame({ players: [HUMAN, bot(2, 'soldier')], sandbox: false }));
    place(g, 1, 1200, 600);
    const p = place(g, 2, 400, 600);
    damagePlayer(g, p, 1000, 400, 500);
    assert.equal(p.state, 'downed');
    dummy(g, 'brute', 400, 250);
    const x0 = p.x;
    const ev = run(g, 150, () => ({ 1: {} }));
    assert.ok(p.x > x0 + 40, `crawled toward the human (${x0} → ${p.x.toFixed(0)})`);
    assert.ok(shotsBy(ev, 2).some((e) => e.weapon === 'pistol'), 'fired the pistol while down');
  });
});

// -------------------------------------------------------------------------------------
describe('shop and ready', () => {
  test('nextPurchase: ammo when low, upgrades into the weakest slot, saves for a close upgrade', () => {
    const g = makeGame({ players: [HUMAN, bot(2, 'medic')] });
    g.wave = 2;
    const p = g.getPlayer(2);
    p.cash = 3000;
    p.res[1] = 10;
    assert.deepEqual(nextPurchase(g, p), { item: 'ammo', slot: -1 });
    p.res[1] = WEAPONS.uzi.reserve;
    const buy = nextPurchase(g, p);
    assert.ok(buy && buy.item in WEAPONS && buy.slot === -1, `a gun into the free slot: ${JSON.stringify(buy)}`);
    assert.ok(WEAPONS[buy.item].unlockWave <= 3 && GUN_VALUE[buy.item] > GUN_VALUE.uzi);
    p.slots = ['pistol', 'uzi', 'magnum'];
    p.mag = [12, 32, 6];
    p.res = [-1, 288, 48];
    const swap = nextPurchase(g, p);
    assert.equal(swap.slot, 2, 'replaces the magnum (the weakest)');
    // $1600 is $300 short of a rifle-class upgrade: keep the money, buy armour only if bare.
    p.cash = 1650;
    p.armor = 40;
    const save = nextPurchase(g, p);
    assert.ok(!save || !(save.item in WEAPONS) || GUN_VALUE[save.item] >= GUN_VALUE.rifle, JSON.stringify(save));
    p.cash = 100;
    assert.equal(nextPurchase(g, p), null, 'broke: nothing');
  });

  test('prep: walks to the supply station, buys, then readies once the human has', () => {
    const g = makeGame({ players: [HUMAN, bot(2, 'medic')], sandbox: false });
    const p = g.getPlayer(2);
    p.cash = 3000;
    const s = g.map.supply;
    let wasAtStation = false;
    const ev = [];
    for (let t = 0; t < 60 * 8; t++) {
      g.step();
      for (const e of g.snapshot().events) ev.push(e);
      if (Math.hypot(p.x - s.x, p.y - s.y) <= SUPPLY_RADIUS) wasAtStation = true;
    }
    const buys = eventsOf(ev, 'buy').filter((e) => e.pid === 2);
    assert.ok(wasAtStation, 'went to the supply station');
    assert.ok(buys.some((e) => e.item in WEAPONS), `bought a gun: ${buys.map((e) => e.item)}`);
    assert.equal(p.ready, false, 'does not ready before the human');
    assert.equal(g.phase, 'prep');
    g.command(1, { type: 'ready' });
    run(g, 120, null, (gg) => gg.phase === 'wave');
    assert.equal(g.phase, 'wave', 'the bot readied after the human');
    assert.ok(g.time < PREP_TIME, 'skipped the rest of the prep timer');
  });

  test('a bot-only team readies by itself after shopping', () => {
    const g = makeGame({ players: [bot(1, 'soldier'), bot(2, 'engineer')], sandbox: false });
    run(g, 60 * 12, null, (gg) => gg.phase === 'wave');
    assert.equal(g.phase, 'wave');
    assert.ok(g.time < PREP_TIME);
  });
});

// -------------------------------------------------------------------------------------
describe('determinism and cost', () => {
  function playthrough(seed, ticks) {
    const g = new GameCore({
      map: buildFixtureMap(7), seed, settings: { difficulty: 'normal', waves: 15, objective: true },
      players: [HUMAN, bot(2, 'medic'), bot(3, 'engineer'), bot(4, 'demo')],
    });
    const human = createBot(g, 1);
    for (let t = 0; t < ticks; t++) {
      if ((g.phase === 'prep' || g.phase === 'intermission') && t % 60 === 0) human.shop();
      g.setInput(1, human.think());
      g.step();
      if (t % 3 === 0) g.snapshot();
    }
    return JSON.stringify(g.snapshot());
  }

  test('same seed + same inputs → identical snapshots with bots in the game', () => {
    const a = playthrough(321, 3000), b = playthrough(321, 3000);
    assert.equal(a, b);
    assert.notEqual(playthrough(322, 3000), a);
  });

  test('perf: 5 bots next to 250 zombies cost well under 0.5 ms per tick', () => {
    const g = makeGame({
      map: buildFixtureMap(7), sandbox: false,
      players: [HUMAN, bot(2, 'medic'), bot(3, 'engineer'), bot(4, 'scout'), bot(5, 'demo'), bot(6, 'heavy')],
    });
    battle(g);
    const rects = g.map.zombieSpawns;
    const types = ['walker', 'walker', 'walker', 'runner', 'crawler', 'bloater', 'spitter', 'screamer', 'brute'];
    let botMs = 0, k = 0;
    const orig = g._runBots.bind(g);
    g._runBots = () => {
      const t0 = performance.now();
      orig();
      botMs += performance.now() - t0;
    };
    for (let t = 0; t < 700; t++) {
      while (g.zombies.length < 250) {
        const r = rects[k % rects.length];
        addZombie(g, types[k % types.length], r.x + ((k * 37) % r.w) - r.w / 2, r.y + ((k * 53) % r.h) - r.h / 2);
        k++;
      }
      godMode(g);
      if (t === 100) botMs = 0;
      g.setInput(1, cmd({ seq: t + 1 }));
      g.step();
      if (t % 3 === 0) g.snapshot();
    }
    const avg = botMs / 600;
    console.log(`# bots: ${avg.toFixed(3)} ms per tick for 5 bots (250 zombies)`);
    assert.ok(avg < 0.5, `average ${avg.toFixed(3)} ms`);
  });
});

// -------------------------------------------------------------------------------------
describe('every map with an idle human and three bots', { skip: !Game && 'shared/maps.js not available' }, () => {
  // (Evac Run maps: tests/zone.test.js runs a bot team through the moving zones.)
  for (const { id } of MAP_LIST.filter((m) => !m.modes || m.modes.includes('defend'))) {
    test(`${id}: clears waves 1-3 on normal, and no bot gets stuck`, () => {
      const g = new Game({
        mapId: id, seed: 77, settings: { difficulty: 'normal', waves: 3, objective: true },
        players: [HUMAN, bot(2, 'medic'), bot(3, 'engineer'), bot(4, 'heavy')],
      });
      // Stuck = within 20 px of the same spot for 20 s while zombies are alive, alive
      // itself and not holding a position on purpose.
      const since = new Map();
      const stuck = [];
      for (let t = 0; t < 60 * 60 * 12; t++) {
        g.step();
        if (t % 3 === 0) g.snapshot();
        const zombies = g.zombies.some((z) => !z.dead);
        for (const b of g.bots) {
          const p = b.p;
          const s = since.get(b.pid);
          if (!s || !zombies || p.state !== 'alive' || b.holding || Math.hypot(p.x - s.x, p.y - s.y) > 20) {
            since.set(b.pid, { x: p.x, y: p.y, t });
          } else if (t - s.t > 20 * 60) {
            stuck.push(`bot ${b.pid} at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) mode ${b.mode} wave ${g.wave}`);
            s.t = t;
          }
        }
        if (g.phase === 'victory' || g.phase === 'gameover') break;
      }
      const kills = g.players.filter((p) => p.bot).map((p) => p.kills);
      console.log(`# ${id}: ${g.phase} after ${(g.time / 60).toFixed(1)} min, bot kills ${kills.join('/')}`);
      assert.equal(g.phase, 'victory', `${id}: ended ${g.phase}/${g.over} on wave ${g.wave}`);
      assert.deepEqual(stuck, []);
      assert.equal(g.getPlayer(1).kills, 0, 'the human really was idle');
    });
  }
});
