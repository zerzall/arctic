// Horde Elimination (settings.mode 'horde', SPEC §3.12): the horde's size by party size and
// difficulty, the surge plan, the entrances, the buy time, surges under their alive cap, the
// win when the whole horde is dead, the loss when everyone is, no respawns, late joiners,
// determinism, and the shop's stock.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/shared/sim.js';
import { buildMap } from '../public/js/shared/maps.js';
import {
  HORDE, hordeTotal, surgePlan, surgeGap, surgeLull, hordeLanes, hordeHold, laneNames, shopWaveOf,
  HS_PREP, HS_BREATHER, HS_SURGE, HS_HOLD,
} from '../public/js/shared/horde.js';
import { mapModes, MODE_IDS } from '../public/js/shared/zone.js';
import { DIFFICULTIES, START_CASH, PROTOCOL_VERSION } from '../public/js/shared/constants.js';
import { encodeSnapshot, decodeSnapshot } from '../public/js/shared/protocol.js';
import { killZombie } from '../public/js/shared/sim/combat.js';
import { damagePlayer } from '../public/js/shared/sim/players.js';
import { shopWave } from '../public/js/shared/sim/players.js';

const MAP = 'truckstop';

function team(n, bot = false) {
  const cls = ['soldier', 'medic', 'engineer', 'assault', 'sniper', 'demo'];
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, color: i, cls: cls[i % cls.length], bot }));
}

function hordeGame({ mapId = MAP, n = 1, seed = 5, difficulty = 'normal', bot = false, players = null } = {}) {
  return new Game({ mapId, seed, settings: { mode: 'horde', difficulty }, players: players || team(n, bot) });
}

/** Survivors who can't be hurt (tests about the horde, not about dying). */
function guard(g) {
  for (const p of g.players) {
    if (p.state !== 'alive') continue;
    p.hp = p.maxHp;
  }
}

/** Kill every live zombie (the test's "perfect team"). */
function cull(g) {
  for (const z of g.zombies) if (!z.dead) killZombie(g, z, g.players[0].id, false);
}

/** End the buy time now. */
function skipBuy(g) {
  g.timer = 0;
  g.step();
}

describe('the horde: size, surges, entrances', () => {
  test('the mode is listed and the standard maps play it', () => {
    assert.ok(MODE_IDS.includes('horde'));
    for (const id of ['highway', 'truckstop', 'bridge', 'checkpoint', 'sandstone']) assert.ok(mapModes(id).includes('horde'), id);
    assert.ok(!mapModes('harlan').includes('horde'), 'Harlan County is too big for one round');
  });

  test('the horde grows with the party and the difficulty', () => {
    const n = DIFFICULTIES.normal;
    assert.equal(hordeTotal(1, n), 150);
    const totals = [1, 2, 3, 4, 5, 6].map((k) => hordeTotal(k, n));
    for (let i = 1; i < totals.length; i++) assert.ok(totals[i] > totals[i - 1], `${i + 1} players: ${totals[i]}`);
    assert.equal(totals[3], Math.round(HORDE.total.base * (1 + HORDE.total.perPlayer * 3)));
    const byDiff = ['easy', 'normal', 'hard', 'nightmare'].map((d) => hordeTotal(1, DIFFICULTIES[d]));
    for (let i = 1; i < byDiff.length; i++) assert.ok(byDiff[i] > byDiff[i - 1], `difficulty ${i}`);
    assert.ok(byDiff[0] >= 100 && byDiff[1] >= 120 && byDiff[1] <= 180, `solo: ${byDiff.join(' / ')}`);
  });

  test('the surge plan adds up, ramps the tier and the cap, saves the bosses for the end', () => {
    for (const [diffId, d] of Object.entries(DIFFICULTIES)) {
      for (let n = 1; n <= 6; n++) {
        const total = hordeTotal(n, d);
        const plan = surgePlan(total, n, d, diffId);
        assert.equal(plan.length, HORDE.surges);
        assert.equal(plan.reduce((a, s) => a + s.size, 0), total, `${diffId} ${n}: sizes add up`);
        assert.equal(plan[0].tier, 1, 'walkers first');
        assert.equal(plan[plan.length - 1].tier, HORDE.tier[diffId]);
        for (let k = 1; k < plan.length; k++) {
          assert.ok(plan[k].size >= plan[k - 1].size, 'the surges grow');
          assert.ok(plan[k].tier >= plan[k - 1].tier, 'the mix ramps');
          assert.ok(plan[k].cap >= plan[k - 1].cap, 'the cap grows');
          assert.ok(plan[k].cap <= d.maxAlive);
        }
        const bosses = plan.map((s) => s.bosses);
        assert.deepEqual(bosses.slice(0, -1), Array(HORDE.surges - 1).fill(0), 'no early bosses');
        assert.equal(bosses[bosses.length - 1], Math.ceil(n / 3));
      }
    }
    // the breather shortens and the lull grows over the round
    assert.equal(surgeGap(1), HORDE.gap.first);
    assert.equal(surgeGap(2), HORDE.gap.max);
    assert.equal(surgeGap(HORDE.surges), HORDE.gap.min);
    assert.ok(surgeLull(HORDE.surges) > surgeLull(1));
  });

  test('entrances: named lanes on a map that names them, compass sectors elsewhere', () => {
    const m = buildMap(MAP, 1);
    const lanes = hordeLanes(m);
    assert.ok(lanes.length >= 3, `${lanes.length} lanes`);
    const seen = new Set();
    for (const l of lanes) {
      assert.ok(l.rects.length > 0, l.name);
      for (const r of l.rects) seen.add(r);
      assert.ok(/^(North|South|East|West)/.test(l.name), l.name);
    }
    assert.equal(seen.size, m.zombieSpawns.length, 'every spawn rect belongs to a lane');
    assert.deepEqual(hordeLanes(m), lanes, 'cached');
    assert.equal(laneNames(m, 1 | (1 << 1)).length, 2);
    const hold = hordeHold(m);
    assert.ok(Math.hypot(hold.x - m.objective.x, hold.y - m.objective.y) < 1, 'holds at the objective');
    // a map that names its own
    const named = { ...m, horde: { lanes: [{ name: 'Gate A', x: 1, y: 1 }, { name: 'Gate B', x: 2, y: 2, late: true }] } };
    named.zombieSpawns = m.zombieSpawns.map((r, i) => ({ ...r, lane: i % 2 }));
    const nl = hordeLanes(named);
    assert.deepEqual(nl.map((l) => l.name), ['Gate A', 'Gate B']);
    assert.equal(nl[1].late, true);
  });

  test('the shop sells the surge\'s tier (at least the buy time\'s stock)', () => {
    assert.equal(shopWaveOf('prep', 0, { tier: 1 }), HORDE.shopMin);
    assert.equal(shopWaveOf('wave', 3, { tier: 6 }), 6);
    assert.equal(shopWaveOf('prep', 0, null), 1);
    assert.equal(shopWaveOf('intermission', 4, null), 5);
    const g = hordeGame();
    assert.equal(shopWave(g), HORDE.shopMin);
  });
});

describe('a horde round', () => {
  test('buy time: the prep phase, horde cash, the ready vote skips it, no objective', () => {
    const g = hordeGame({ n: 2 });
    assert.equal(g.mode, 'horde');
    assert.equal(g.phase, 'prep');
    assert.equal(g.timer, HORDE.prep);
    assert.equal(g.objective, null, 'nothing to defend');
    for (const p of g.players) assert.equal(p.cash, HORDE.startCash);
    assert.ok(HORDE.startCash > START_CASH);
    assert.equal(g.horde.stage, HS_PREP);
    let snap = g.snapshot();
    assert.equal(snap.horde.total, hordeTotal(2, DIFFICULTIES.normal));
    assert.equal(snap.horde.left, snap.horde.total);
    assert.equal(snap.totalWaves, HORDE.surges);
    // a third survivor joining in the buy time makes the horde bigger
    g.addPlayer({ id: 3, name: 'P3', color: 2, cls: 'medic' });
    g.step();
    assert.equal(g.horde.total, hordeTotal(3, DIFFICULTIES.normal));
    for (const p of g.players) g.command(p.id, { type: 'ready' });
    g.step();
    assert.equal(g.phase, 'wave', 'everyone ready: the round starts');
    assert.equal(g.horde.stage, HS_BREATHER);
    snap = g.snapshot();
    const next = snap.events.find((e) => e.type === 'surge');
    assert.ok(next && next.what === 'next' && next.n === 1 && next.lanes > 0, 'surge 1 announced with its entrances');
    // the horde is fixed from now on: a late joiner neither grows it nor plays
    const total = g.horde.total;
    const late = g.addPlayer({ id: 4, name: 'Late', color: 3, cls: 'soldier' });
    assert.equal(late.state, 'dead', 'a late joiner spectates');
    assert.equal(late.respawn, false);
    g.step();
    assert.equal(g.horde.total, total);
  });

  test('surges come out of their entrances under the alive cap, the type mix ramps', () => {
    const g = hordeGame({ n: 2, seed: 9 });
    skipBuy(g);
    const lanes = hordeLanes(g.map);
    const plan = g.horde.plan;
    const typesBySurge = new Map();
    let goes = 0;
    for (let t = 0; t < 60 * 60 * 12 && !g.over; t++) {
      guard(g);
      const before = g.zombies.length;
      g.step();
      for (const e of g.snapshot().events) if (e.type === 'surge' && e.what === 'go') goes++;
      const h = g.horde;
      // every new zombie came out of one of the current surge's entrances
      for (let i = before; i < g.zombies.length; i++) {
        const z = g.zombies[i];
        const lane = lanes.find((l) => l.rects.some((r) => Math.abs(z.x - r.x) <= r.w / 2 + 40 && Math.abs(z.y - r.y) <= r.h / 2 + 40));
        assert.ok(lane && (h.mask & (1 << lane.i)), `zombie at ${Math.round(z.x)},${Math.round(z.y)} outside surge ${h.surge}'s entrances`);
        if (!typesBySurge.has(h.surge)) typesBySurge.set(h.surge, new Set());
        typesBySurge.get(h.surge).add(z.type);
      }
      let alive = 0, bosses = 0;
      for (const z of g.zombies) if (!z.dead) { alive++; if (z.boss) bosses++; }
      if (h.surge > 0) assert.ok(alive - bosses <= plan[h.surge - 1].cap, `surge ${h.surge}: ${alive} alive over the cap ${plan[h.surge - 1].cap}`);
      // a sloppy team: every other second the oldest zombies die (the round must keep moving)
      if (t % 120 === 0) for (const z of g.zombies.slice(0, 6)) if (!z.dead) killZombie(g, z, 1, false);
    }
    assert.equal(goes, HORDE.surges, 'every surge hit');
    assert.deepEqual([...typesBySurge.get(1)], ['walker'], 'walkers first');
    assert.ok([...typesBySurge.get(HORDE.surges)].some((t) => t !== 'walker' && t !== 'runner'), 'specials late');
    assert.ok(typesBySurge.get(HORDE.surges).has('boss'), 'the boss walks in with the last surge');
  });

  test('victory once the whole horde is dead; the shop stock follows the surges', () => {
    const g = hordeGame({ n: 1, seed: 3 });
    skipBuy(g);
    const events = [];
    let maxShop = 0;
    for (let t = 0; t < 60 * 60 * 10 && !g.over; t++) {
      guard(g);
      g.step();
      cull(g);
      maxShop = Math.max(maxShop, shopWave(g));
      events.push(...g.snapshot().events);
    }
    assert.equal(g.phase, 'victory');
    assert.equal(g.horde.left(), 0);
    assert.equal(g.horde.spawned, g.horde.total);
    assert.equal(g.players[0].kills, g.horde.total, 'every zombie of the horde counted');
    assert.ok(events.some((e) => e.type === 'victory'));
    assert.equal(maxShop, HORDE.tier.normal, 'the last surge sells the last tier');
    assert.equal(events.filter((e) => e.type === 'waveclear').length, 0, 'no wave is ever cleared');
    const snap = g.snapshot();
    assert.equal(snap.horde.left, 0);
    assert.equal(snap.phase, 'victory');
  });

  test('defeat when every survivor is down for good; the horde left is reported', () => {
    const g = hordeGame({ n: 2, seed: 4 });
    skipBuy(g);
    for (let t = 0; t < 60 * 30; t++) g.step();
    for (const p of g.players) {
      p.selfRevive = false;
      damagePlayer(g, p, 1e6, p.x + 10, p.y);
    }
    let t = 0;
    while (!g.over && t++ < 60 * 40) g.step();
    assert.equal(g.phase, 'gameover');
    assert.equal(g.over, 'wiped');
    const snap = g.snapshot();
    assert.ok(snap.horde.left > 0 && snap.horde.left === g.horde.left(), `left ${snap.horde.left}`);
    assert.ok(snap.events.some((e) => e.type === 'gameover' && e.reason === 'wiped'));
  });

  test('no respawns: the fallen stay dead through the surges, the downed can be revived', () => {
    const g = hordeGame({ n: 2, seed: 6 });
    skipBuy(g);
    const [a, b] = g.players;
    a.selfRevive = false;
    damagePlayer(g, a, 1e6, a.x + 10, a.y);
    assert.equal(a.state, 'downed');
    // b revives a: the ordinary down / revive rules hold
    b.x = a.x + 30;
    b.y = a.y;
    for (let t = 0; t < 60 * 5 && a.state === 'downed'; t++) {
      guard(g);
      b.hp = b.maxHp;
      g.setInput(b.id, { seq: t + 1, moveX: 0, moveY: 0, angle: 0, interact: true });
      g.step();
    }
    assert.equal(a.state, 'alive', 'revived by a teammate');
    // now a bleeds out (b lets go of E and walks away)
    g.setInput(b.id, { seq: 1000, moveX: 0, moveY: 0, angle: 0, interact: false });
    b.x = a.x + 400;
    damagePlayer(g, a, 1e6, a.x + 10, a.y);
    for (let t = 0; t < 60 * 40 && a.state !== 'dead'; t++) {
      b.hp = b.maxHp;
      g.step();
    }
    assert.equal(a.state, 'dead');
    assert.equal(a.respawn, false, 'not waiting for any respawn');
    const surgeAtDeath = g.horde.surge;
    for (let t = 0; t < 60 * 60 * 6 && g.horde.surge < Math.min(HORDE.surges, surgeAtDeath + 3) && !g.over; t++) {
      b.hp = b.maxHp;
      g.step();
      cull(g);
      assert.equal(a.state, 'dead', 'still dead');
    }
    assert.ok(g.horde.surge >= Math.min(HORDE.surges, surgeAtDeath + 2), 'surges went by');
    assert.equal(a.state, 'dead');
  });

  test('deterministic: same seed and inputs, same round', () => {
    const a = hordeGame({ n: 3, bot: true, seed: 21 });
    const b = hordeGame({ n: 3, bot: true, seed: 21 });
    for (let t = 0; t < 60 * 70; t++) {
      a.step();
      b.step();
      if (t % 300 === 299) assert.deepEqual(a.snapshot(), b.snapshot(), `tick ${t}`);
    }
    assert.equal(a.phase, 'wave');
    assert.ok(a.horde.surge >= 1);
    const c = hordeGame({ n: 3, bot: true, seed: 22 });
    for (let t = 0; t < 60 * 70; t++) c.step();
    assert.notDeepEqual(JSON.stringify(c.snapshot().zombies), JSON.stringify(a.snapshot().zombies), 'another seed, another round');
  });

  test('stages: breather, surge, hold; the next surge waits for the lull or the clock', () => {
    const g = hordeGame({ n: 1, seed: 8 });
    skipBuy(g);
    assert.equal(g.horde.stage, HS_BREATHER);
    const t0 = g.time;
    while (g.horde.stage === HS_BREATHER) g.step();
    assert.ok(Math.abs(g.time - t0 - HORDE.gap.first) < 0.1, 'the first breather');
    assert.equal(g.horde.stage, HS_SURGE);
    assert.equal(g.wave, 1);
    while (g.horde.stage === HS_SURGE) { guard(g); g.step(); }
    assert.equal(g.horde.stage, HS_HOLD);
    // nobody kills anything: the next one comes after HORDE.gap.wait anyway
    const t1 = g.time;
    while (g.horde.stage === HS_HOLD) { guard(g); g.step(); }
    assert.equal(g.horde.stage, HS_BREATHER);
    assert.ok(Math.abs(g.time - t1 - HORDE.gap.wait) < 0.1, `waited ${(g.time - t1).toFixed(2)} s`);
    // the surge bonus is paid when the next surge hits
    const cash = g.players[0].cash;
    while (g.horde.stage === HS_BREATHER) { guard(g); g.step(); }
    assert.equal(g.players[0].cash, cash + HORDE.surgeBonus);
  });
});

describe('on the wire (protocol 12)', () => {
  test('the horde block and the surge events survive a round trip; other modes carry none', () => {
    assert.ok(PROTOCOL_VERSION >= 12, 'the horde block belongs to protocol 12 and later');
    const g = hordeGame({ n: 2, seed: 3 });
    const events = [];
    g.step();
    let d = decodeSnapshot(encodeSnapshot(g.snapshot()));
    assert.deepEqual({ ...d.horde, time: 0 }, { ...g.snapshot().horde, time: 0 }, 'the buy time');
    skipBuy(g);
    for (let t = 0; t < 60 * 20; t++) {
      guard(g);
      g.step();
      const s = g.snapshot();
      events.push(...decodeSnapshot(encodeSnapshot(s)).events.filter((e) => e.type === 'surge'));
    }
    const s = g.snapshot();
    d = decodeSnapshot(encodeSnapshot(s));
    for (const k of ['total', 'left', 'alive', 'surge', 'surges', 'tier', 'stage', 'lanes']) assert.equal(d.horde[k], s.horde[k], k);
    assert.ok(Math.abs(d.horde.next - s.horde.next) < 0.01);
    assert.ok(Math.abs(d.horde.time - s.horde.time) < 1e-3);
    assert.ok(d.horde.total >= 150 && d.horde.left <= d.horde.total && d.horde.surge >= 1);
    // the first surge was announced and let loose, with its entrances
    const next = events.find((e) => e.what === 'next'), go = events.find((e) => e.what === 'go');
    assert.ok(next && go, 'surge events on the wire');
    assert.equal(next.n, 1);
    assert.equal(go.lanes, next.lanes);
    assert.ok(laneNames(g.map, go.lanes).length >= 1);
    const plain = new Game({ mapId: MAP, seed: 3, settings: { mode: 'defend' }, players: team(1) });
    plain.step();
    assert.equal(decodeSnapshot(encodeSnapshot(plain.snapshot())).horde, null);
  });
});
