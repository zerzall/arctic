// Predicted weapon state in the client's view (SPEC §6.2): the local player's slot, mags,
// reserves and reload progress in getView() come from the client's prediction, so the HUD
// ammo counter drops on the very frame a shot is fired and agrees with the host once the
// cmds are acknowledged. Real Game over the local transport with a fake clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { WEAPONS } from '../public/js/shared/weapons.js';

const IDLE = {
  moveX: 0, moveY: 0, aimScreenX: 0, aimScreenY: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0,
  shop: false, scoreboard: false, chat: false, ready: false, pause: false,
};

function input(over) {
  return { ...IDLE, ...over };
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

async function realGame() {
  try {
    const { Game } = await import('../public/js/shared/sim.js');
    return Game;
  } catch (err) {
    return err;
  }
}

async function setup(Game) {
  let t = 1000;
  const clock = () => t;
  clock.advance = (dt) => {
    t += dt;
  };
  const hub = createLocalHub({ code: 'ABCDE' });
  let game = null;
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', transport: hub.host,
    hooks: {
      now: clock, manual: true,
      createGame: (opts) => {
        game = new Game(opts);
        return game;
      },
    },
  });
  const client = await joinGame({ name: 'Alice', color: 1, cls: 'soldier', via: hub.connect(), hooks: { now: clock, manual: true } });
  host.start();
  await flush();
  const env = { clock, host, client, game: () => game };
  /** n frames: host first, then the client (so a client cmd reaches the host a frame later). */
  env.frames = async (n, inp = () => null) => {
    for (let i = 0; i < n; i++) {
      clock.advance(1 / 60);
      host.update(1 / 60, null, 0);
      client.update(1 / 60, inp(i), 0);
      await flush(2);
    }
  };
  return env;
}

function localOf(session) {
  return session.getView().players.find((p) => p.id === session.localId);
}

function hostPlayerOf(env) {
  return env.game().players.find((p) => p.id === env.client.localId);
}

/** Wait until the client's newest snapshot acknowledges every cmd it has sent. */
async function settle(env) {
  for (let i = 0; i < 60; i++) {
    await env.frames(1);
    if (env.client.pending.length === 0) break;
  }
  await env.frames(4);
}

function assertMatchesHost(env, what) {
  const me = localOf(env.client);
  const hp = hostPlayerOf(env);
  assert.equal(me.slot, hp.slot, `${what}: slot`);
  for (let i = 0; i < 3; i++) {
    const want = hp.slots[i] ? [hp.mag[i], hp.res[i]] : [0, 0];
    assert.deepEqual(me.ammo[i], want, `${what}: ammo of slot ${i}`);
  }
  assert.equal(me.reloading > 0, hp.reloadT > 0, `${what}: reloading`);
}

test('client view: predicted ammo drops on the frame a shot is fired and matches the host after the ack', async (t) => {
  const Game = await realGame();
  if (typeof Game !== 'function') {
    t.skip(`shared/sim.js not loadable: ${Game.message}`);
    return;
  }
  const env = await setup(Game);
  const a = env.client;
  await env.frames(20);
  const before = localOf(a);
  const slot = before.slot;
  const gun = before.slots[slot];
  assert.equal(gun, 'rifle');
  const mag0 = before.ammo[slot][0];
  assert.equal(mag0, WEAPONS.rifle.mag);

  // One frame with the trigger down: the view already shows one round fewer, while the
  // newest snapshot (and the host) still have the full magazine.
  env.clock.advance(1 / 60);
  a.update(1 / 60, input({ fire: true }), 0);
  const now = localOf(a);
  assert.equal(now.ammo[slot][0], mag0 - 1, 'counter dropped at once');
  assert.equal(a.newestLocal.ammo[slot][0], mag0, 'not yet acknowledged');
  assert.equal(hostPlayerOf(env).mag[slot], mag0, 'host has not seen the cmd yet');
  // Other players' records and the rest of the local record are untouched.
  assert.deepEqual(now.slots, a.newestLocal.slots);
  assert.equal(now.cash, a.newestLocal.cash);

  // Keep firing for a while: the view is always at or ahead of the acknowledged state.
  for (let i = 0; i < 12; i++) {
    await env.frames(1, () => input({ fire: true }));
    const me = localOf(a);
    assert.ok(me.ammo[slot][0] <= a.newestLocal.ammo[slot][0], `frame ${i}: predicted ≤ acked`);
  }
  await settle(env);
  assertMatchesHost(env, 'after firing');
  assert.ok(localOf(a).ammo[slot][0] < mag0);

  // Manual reload: progress shows at once, finishes with the host's numbers.
  await env.frames(1, () => input({ reload: true }));
  const r = localOf(a);
  assert.ok(r.reloading > 0 && r.reloading < 0.2, `reload started at once (${r.reloading})`);
  assert.equal(a.newestLocal.reloading, 0, 'before the host confirmed it');
  await env.frames(20);
  const mid = localOf(a).reloading;
  assert.ok(mid > r.reloading, `reload progresses (${mid})`);
  await env.frames(Math.ceil(WEAPONS.rifle.reload * 60) + 10);
  await settle(env);
  assertMatchesHost(env, 'after the reload');
  assert.equal(localOf(a).ammo[slot][0], WEAPONS.rifle.mag);
  assert.equal(localOf(a).reloading, 0);

  // Slot switch shows at once too.
  env.clock.advance(1 / 60);
  a.update(1 / 60, input({ slot: 0 }), 0);
  assert.equal(localOf(a).slot, 0, 'switched in the view at once');
  assert.equal(a.newestLocal.slot, slot);
  await settle(env);
  assertMatchesHost(env, 'after switching');

  // The host's own view is the sim's state (nothing predicted, no extra fields).
  const hv = env.host.getView().players.find((p) => p.id === env.host.localId);
  assert.equal(hv.predicted, undefined);
  assert.equal(hv.reloading, 0);
  env.host.leave();
  await flush(6);
});

test('client view: the free pistol (downed) keeps its predicted mag across a reload and a stalled uplink', async (t) => {
  const Game = await realGame();
  if (typeof Game !== 'function') {
    t.skip(`shared/sim.js not loadable: ${Game.message}`);
    return;
  }
  const { downPlayer } = await import('../public/js/shared/sim/players.js');
  for (const [stall, published] of [[0, false], [0, true], [20, true], [60, true]]) {
    const env = await setup(Game);
    const a = env.client;
    const g = env.game();
    const snapshot = g.snapshot.bind(g);
    // SPEC §4: the player record carries freeMag. Without it (published = false, or a sim
    // that does not send it yet) the client can only rebuild it from its own cmds, which
    // is exact unless the host repeated or dropped cmds (a stalled uplink).
    g.snapshot = () => {
      const snap = snapshot();
      for (const rec of snap.players) {
        if (!published) delete rec.freeMag;
        else if (rec.freeMag === undefined) rec.freeMag = g.getPlayer(rec.id).freeMag;
      }
      return snap;
    };
    await env.frames(30);
    // A bought gun replaced the pistol in slot 0; downed, the player gets the free pistol.
    const p = hostPlayerOf(env);
    p.slots[0] = 'uzi';
    p.mag[0] = 10;
    p.res[0] = 10;
    downPlayer(env.game(), p);
    p.bleedout = 1e9;
    await env.frames(20);
    // Fire through the mag and its reload; the uplink stalls just before the reload ends.
    const send = a.net.send.bind(a.net);
    let held = null;
    a.net.send = (ch, data) => {
      if (held && ch === 'state') {
        held.push(data);
        return 1;
      }
      return send(ch, data);
    };
    const fire = () => input({ fire: true });
    await env.frames(Math.round(60 * 3.2), fire);
    if (stall) held = [];
    await env.frames(stall, fire);
    const h = held || [];
    held = null;
    for (const d of h) send('state', d);
    await env.frames(20, fire);
    await settle(env);
    const me = localOf(a);
    assert.equal(me.state, 'downed');
    assert.equal(me.freeMag, p.freeMag, `stall ${stall}, published ${published}: predicted free pistol mag matches the host`);
    env.host.leave();
    await flush(6);
  }
});

test('predicted rays follow the sim rule: flesh on any hit, pierce budget decides the end point', async () => {
  const { ClientSession } = await import('../public/js/net/client-session.js');
  const trace = ClientSession.prototype._traceRay;
  // A wall 400 px down the +x axis and one walker 200 px away.
  const self = {
    world: { raycastSolid: (x, y, dx, dy, maxT) => (dx > 0.99 && maxT >= 400 ? 400 : -1) },
    lastView: { zombies: [{ id: 1, type: 'walker', x: 200, y: 0 }] },
    hitScratch: null,
  };
  // Pierce 3 with one victim: still flesh, but the ray runs on to the wall.
  const magnum = trace.call(self, 0, 0, 0, WEAPONS.magnum);
  assert.equal(magnum.hit, 1);
  assert.equal(magnum.x, 400);
  // Pierce 1: the ray stops in the zombie.
  const pistol = trace.call(self, 0, 0, 0, WEAPONS.pistol);
  assert.equal(pistol.hit, 1);
  assert.ok(pistol.x < 200 && pistol.x > 180, `ended at ${pistol.x}`);
  // No zombie on the line: the wall.
  self.lastView = { zombies: [] };
  const miss = trace.call(self, 0, 0, 0, WEAPONS.magnum);
  assert.equal(miss.hit, 2);
  assert.equal(miss.x, 400);
});
