// Story sessions against the REAL simulation (no fake game): the stub hideout with its
// press-E stations, the stub mission on a real map, and the client's prediction agreeing with
// the host when the survivor has weapon tiers and perks (reload time, magazine, fire cadence,
// movement speed all come from the same spec on both sides).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { createProfile } from '../public/js/shared/story/profile.js';
import { createWorld, changeWorld } from '../public/js/shared/story/world.js';
import { setStoryContent } from '../public/js/shared/story/content.js';
import { STUB_CONTENT } from '../public/js/shared/story/stub-content.js';
import { xpForLevel } from '../public/js/shared/story/progression.js';
import { tierMag } from '../public/js/shared/story/upgrades.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { perksFor } from '../public/js/shared/classes.js';
import { isRangeTarget } from '../public/js/shared/sim/range.js';

setStoryContent(STUB_CONTENT);

const IDLE = {
  moveX: 0, moveY: 0, aimScreenX: 0, aimScreenY: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0,
  shop: false, scoreboard: false, chat: false, ready: false, pause: false,
};
const input = (over) => ({ ...IDLE, ...over });

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

async function setup({ clientProfile, world }) {
  let t = 1000;
  const clock = () => t;
  clock.advance = (dt) => {
    t += dt;
  };
  const hub = createLocalHub({ code: 'ABCDE' });
  const games = [];
  const hostProfile = createProfile({ name: 'Bob', cls: 'soldier', color: 0 });
  // (no createGame hook: the host builds its games the way production does)
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', transport: hub.host,
    story: { profile: hostProfile, world: world || createWorld({ name: 'W', profile: hostProfile }) },
    hooks: { now: clock, manual: true },
  });
  const client = await joinGame({
    name: 'Alice', color: 1, cls: 'soldier', via: hub.connect(),
    story: { profile: clientProfile || createProfile({ name: 'Alice', cls: 'soldier', color: 1 }) },
    hooks: { now: clock, manual: true },
  });
  const env = { clock, host, client, games };
  env.frames = async (n, inp = () => null) => {
    for (let i = 0; i < n; i++) {
      clock.advance(1 / 60);
      host.update(1 / 60, null, 0);
      client.update(1 / 60, inp(i), 0);
      await flush(2);
    }
    await new Promise((r) => setTimeout(r, 2));
  };
  return env;
}

const localOf = (s) => s.getView().players.find((p) => p.id === s.localId);

test('the hideout: stations exist, E next to one is an interact event for both sides, no zombies ever come', async () => {
  const env = await setup({});
  const { host, client } = env;
  host.start();
  await env.frames(3);
  const map = client.getMap();
  assert.equal(map.kind, 'hideout');
  assert.ok(map.interactables.length >= 5);
  // the real hideouts (maps-hideouts.js) have every station kind: the five panels plus bed, range and campfire
  assert.deepEqual([...new Set(map.interactables.map((i) => i.kind))].sort(), ['armory', 'bed', 'board', 'campfire', 'infirmary', 'range', 'upgrades', 'workbench']);
  assert.deepEqual(host.getMap().interactables, map.interactables, 'both sides built the same hub');
  const bench = map.interactables.find((i) => i.kind === 'workbench');
  const p = host.game.getPlayer(client.localId);
  p.x = bench.x + 10;
  p.y = bench.y;
  const hostSeen = [];
  const clientSeen = [];
  await env.frames(6, (i) => (i === 2 ? input({ interact: true }) : null));
  for (let i = 0; i < 3; i++) {
    await env.frames(2);
    hostSeen.push(...host.drainEvents().filter((e) => e.type === 'interact'));
    clientSeen.push(...client.drainEvents().filter((e) => e.type === 'interact'));
  }
  // (events are released at render time on the client)
  await env.frames(30);
  clientSeen.push(...client.drainEvents().filter((e) => e.type === 'interact'));
  hostSeen.push(...host.drainEvents().filter((e) => e.type === 'interact'));
  assert.deepEqual(hostSeen.map((e) => [e.pid, e.id, e.kind]), [[client.localId, 'workbench', 'workbench']]);
  assert.deepEqual(clientSeen.map((e) => [e.pid, e.id, e.kind]), [[client.localId, 'workbench', 'workbench']]);
  // 25 game seconds later: still no wave, no zombies
  await env.frames(60 * 25);
  const v = host.getView();
  // (the shooting range's practice dummies stand in the zombie list; no real zombie ever comes)
  assert.equal(v.zombies.filter((z) => !isRangeTarget(host.getMap(), z.x, z.y)).length, 0);
  assert.equal(host.game.settings.mode, 'hideout', 'the real story game, not a stand-in');
  assert.equal(host.game.safe, true, 'nothing can hurt a survivor in the hideout');
  assert.equal(v.story.mode, 'hideout');
  // the cash shop is shut
  host.game.getPlayer(1).cash = 5000;
  host.buy('rifle');
  assert.equal(host.game.getPlayer(1).cash, 5000);
  // a tap on E away from every station is nothing
  p.x = 60;
  p.y = 60;
  const before = host.drainEvents().length;
  await env.frames(3, (i) => (i === 1 ? input({ interact: true }) : null));
  assert.equal(host.drainEvents().filter((e) => e.type === 'interact').length, 0, `${before}`);
});

test('a real mission from the board: the client predicts tiers and perks exactly as the host simulates them', async () => {
  const tough = {
    ...createProfile({ name: 'Alice', cls: 'soldier', color: 1 }),
    xp: xpForLevel(12), perkPoints: 0, perks: { quick: 3, hoarder: 2, sprinter: 2, steady: 1 },
    weapons: { pistol: { tier: 2 }, rifle: { tier: 5 } }, scrap: 0,
  };
  const world = createWorld({ name: 'W', profile: createProfile({ name: 'Bob' }) });
  const done = changeWorld(world, (w) => { w.progress.completed.m1_1 = { stars: 1, time: 1 }; });
  const env = await setup({ clientProfile: tough, world: done });
  const { host, client } = env;
  host.start();
  await env.frames(3);
  host.story.pickMission('m1_2');
  await env.frames(2);
  host.story.deploy();
  await env.frames(4);
  assert.equal(client.story.stage, 'mission');
  assert.equal(client.getMap().id, 'truckstop');
  const hp = host.game.getPlayer(client.localId);
  // the same numbers on both sides
  const base = WEAPONS.rifle;
  assert.equal(hp.mag[1], tierMag(base.mag, 5));
  assert.equal(hp.res[1], Math.round(base.reserve * 1.3));
  assert.equal(client.mods.tiers.rifle, 5);
  const cls = perksFor('soldier');
  assert.ok(Math.abs(hp.speedMult - cls.speedMult * 1.06) < 1e-12);
  assert.equal(client.pred.speedMult, hp.speedMult, 'client prediction uses the very same speed multiplier');
  assert.equal(client.pred.staminaMult, hp.staminaMult);

  // fire a while, reload, fire again
  const script = (i) => {
    if (i < 90) return input({ fire: true, moveX: i % 60 < 30 ? 1 : -1 });
    if (i === 100) return input({ reload: true });
    if (i > 100 && i < 130) return null;
    if (i >= 250 && i < 300) return input({ fire: true });
    return null;
  };
  let mismatches = 0;
  for (let i = 0; i < 340; i++) {
    await env.frames(1, () => script(i));
    // once the host has acknowledged everything we sent, the predicted weapon must equal the host's
    if (client.pending.length === 0) {
      const me = localOf(client);
      const hostHas = host.game.getPlayer(client.localId);
      if (me.slot !== hostHas.slot || me.ammo[hostHas.slot][0] !== hostHas.mag[hostHas.slot]) mismatches++;
    }
  }
  for (let i = 0; i < 60 && client.pending.length; i++) await env.frames(1);
  await env.frames(6);
  const me = localOf(client);
  assert.ok(hp.mag[1] < tierMag(base.mag, 5) || hp.res[1] < Math.round(base.reserve * 1.3), 'shots were fired');
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(me.ammo[i], hp.slots[i] ? [hp.mag[i], hp.res[i]] : [0, 0], `slot ${i} ammo agrees`);
  }
  assert.ok(mismatches <= 6, `prediction disagreed with the host on ${mismatches} settled frames`);
  // the reload the host started took the tier and perk time
  assert.ok(Math.abs(client._reloadTime('rifle') - base.reload * 0.8 * 0.72 * cls.reloadMult) < 1e-9);
  // prediction of the position: the client is where the host says it is
  const hostP = host.game.getPlayer(client.localId);
  const mine = client.getPredictedLocal();
  assert.ok(Math.hypot(mine.x - hostP.x, mine.y - hostP.y) < 6, 'predicted position converges to the host\'s');
});
