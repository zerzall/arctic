// Session over the local transport (SPEC §6.2): lobby (hello, names, colours, settings,
// chat, ready), version/full rejection, start, late join, leave/kick/host-left, buy and
// ready forwarding, input edges, prediction + reconciliation, snapshot interpolation and
// event release. Time is a fake clock and nothing runs on real timers, so the tests are
// deterministic; the last tests run the real Game from shared/sim.js when it loads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { GAME_VERSION, PROTOCOL_VERSION, DT, CHAT_MAX_LENGTH } from '../public/js/shared/constants.js';
import { createRng } from '../public/js/shared/rng.js';
import { FakeGame } from './fixtures/net-fake-game.js';

function makeClock(start = 1000) {
  let t = start;
  const clock = () => t;
  clock.advance = (dt) => {
    t += dt;
  };
  return clock;
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const IDLE = {
  moveX: 0, moveY: 0, aimScreenX: 0, aimScreenY: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0,
  shop: false, scoreboard: false, chat: false, ready: false, pause: false,
};

function input(over) {
  return { ...IDLE, ...over };
}

/** Host + clients on one local hub, fake clock, FakeGame (or the real one). */
async function setup({ clients = [], hub: hubOpts = {}, createGame, hostProfile } = {}) {
  const clock = makeClock();
  const hub = createLocalHub({ code: 'ABCDE', ...hubOpts });
  const games = [];
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', ...hostProfile,
    transport: hub.host,
    hooks: {
      now: clock, manual: true,
      createGame: (opts) => {
        const g = createGame ? createGame(opts) : new FakeGame(opts);
        games.push(g);
        return g;
      },
    },
  });
  const joined = [];
  for (const profile of clients) joined.push(await join(hub, clock, profile));
  return { clock, hub, host, clients: joined, games, game: () => games[games.length - 1] };
}

function join(hub, clock, profile) {
  return joinGame({ ...profile, via: hub.connect(), hooks: { now: clock, manual: true } });
}

/** Run `n` 60 fps frames on every session. inputFor(session, frame) → InputState|null */
async function frames(env, n, inputFor = () => null, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    env.clock.advance(dt);
    env.host.update(dt, inputFor(env.host, i), 0);
    for (const c of env.clients) if (!c.left) c.update(dt, inputFor(c, i), 0);
    await flush(2);
  }
}

function collect(session, event) {
  const out = [];
  session.on(event, (v) => out.push(v));
  return out;
}

test('hello: roster, unique names, distinct colours, welcome data', async () => {
  const env = await setup({ clients: [{ name: 'bob', color: 0, cls: 'medic' }, { name: ' Carol​ ', color: 9, cls: 'wizard' }] });
  const [c1, c2] = env.clients;
  await flush();
  assert.equal(env.host.isHost, true);
  assert.equal(env.host.localId, 1);
  assert.equal(env.host.code, 'ABCDE');
  assert.equal(c1.isHost, false);
  assert.equal(c1.localId, 2);
  assert.equal(c2.localId, 3);
  assert.equal(c1.code, 'ABCDE');
  assert.equal(c1.transport, 'local');
  const r = env.host.roster;
  assert.deepEqual(r.map((e) => e.name), ['Bob', 'bob 2', 'Carol']);
  assert.deepEqual(r.map((e) => e.color), [0, 1, 2]);
  assert.deepEqual(r.map((e) => e.cls), ['soldier', 'medic', 'soldier']);
  assert.deepEqual(r.map((e) => e.host), [true, false, false]);
  for (const e of r) {
    assert.equal(e.ready, false);
    assert.equal(typeof e.ping, 'number');
  }
  assert.deepEqual(c1.roster, r);
  assert.deepEqual(c2.roster, r);
  assert.deepEqual(c1.settings, env.host.settings);
});

test('profile changes: name, colour (taken colours refused), class and ready in lobby', async () => {
  const env = await setup({ clients: [{ name: 'Alice', color: 1, cls: 'medic' }] });
  const [c] = env.clients;
  const notices = collect(c, 'notice');
  const rosters = collect(env.host, 'roster');
  c.setProfile({ name: 'Bob', color: 0, cls: 'heavy', ready: true });
  await flush();
  const me = env.host.roster.find((e) => e.id === c.localId);
  assert.equal(me.name, 'Bob 2');
  assert.equal(me.color, 1, 'colour 0 is the host\'s');
  assert.equal(me.cls, 'heavy');
  assert.equal(me.ready, true);
  assert.ok(rosters.length >= 1);
  assert.deepEqual(notices, [{ text: 'That colour is already taken' }]);
  c.setProfile({ color: 4 });
  env.host.setProfile({ name: 'Boss', ready: true });
  await flush();
  assert.equal(c.roster.find((e) => e.id === c.localId).color, 4);
  assert.equal(c.roster[0].name, 'Boss');
  assert.equal(c.roster[0].ready, true);
});

test('settings: host only, validated, broadcast', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [c] = env.clients;
  const seen = collect(c, 'settings');
  assert.equal(env.host.setSettings({ mapId: 'bridge', difficulty: 'hard', waves: 20, objective: 'yes', friendlyFire: true, evil: 1 }), true);
  assert.equal(env.host.setSettings({ mapId: 'moon', difficulty: 'godlike', waves: -3 }), true);
  await flush();
  const want = { mapId: 'bridge', difficulty: 'hard', waves: 20, objective: true, friendlyFire: true };
  assert.deepEqual(env.host.settings, want);
  assert.deepEqual(c.settings, want);
  assert.deepEqual(seen[seen.length - 1], want);
  assert.equal(c.setSettings({ waves: 10 }), false);
  assert.equal(c.start(), false);
});

test('chat: trimmed, capped, relayed to everyone, rate limited', async () => {
  const env = await setup({ clients: [{ name: 'A' }, { name: 'B' }] });
  const [a, b] = env.clients;
  const atHost = collect(env.host, 'chat');
  const atB = collect(b, 'chat');
  const notices = collect(a, 'notice');
  a.sendChat('  hello \u0000  world  ');
  a.sendChat('x'.repeat(500));
  a.sendChat('   ');
  await flush();
  assert.deepEqual(atB[0], { pid: 2, name: 'A', text: 'hello world', system: false });
  assert.equal(atB[1].text.length, CHAT_MAX_LENGTH);
  assert.equal(atHost.length, 2);
  for (let i = 0; i < 10; i++) a.sendChat(`spam ${i}`);
  await flush();
  const spam = atB.filter((m) => m.text.startsWith('spam'));
  assert.ok(spam.length >= 1 && spam.length <= 3, `rate limited to the bucket (${spam.length})`);
  assert.ok(notices.length >= 1);
  env.clock.advance(10);
  a.sendChat('later');
  await flush();
  env.host.sendChat('from host');
  await flush();
  assert.equal(atB[atB.length - 2].text, 'later');
  assert.deepEqual(atB[atB.length - 1], { pid: 1, name: 'Bob', text: 'from host', system: false });
});

test('version mismatch is rejected by the host and reported by joinGame', async () => {
  const env = await setup();
  // A raw client speaking an older version.
  const raw = await env.hub.connect();
  const got = [];
  raw.onMessage((ch, msg) => got.push(msg));
  raw.send('ctl', { t: 'hello', version: '0.9.0', protocol: PROTOCOL_VERSION, name: 'Old', color: 0, cls: 'soldier' });
  await flush();
  assert.deepEqual(got, [{ t: 'reject', reason: 'Game version mismatch' }]);
  assert.equal(env.host.roster.length, 1);
  await wait(300);
  assert.equal(raw.closed, true, 'rejected peers are disconnected');

  // And a client talking to a host that rejects it gets the SPEC message.
  const hub = createLocalHub({ code: 'ZZZZZ' });
  hub.host.onMessage((peer, ch, msg) => {
    if (msg.t === 'hello') {
      assert.equal(msg.version, GAME_VERSION);
      assert.equal(msg.protocol, PROTOCOL_VERSION);
      hub.host.send(peer, 'ctl', { t: 'reject', reason: 'Game version mismatch' });
    }
  });
  await assert.rejects(joinGame({ via: hub.connect(), name: 'X', hooks: { manual: true } }), { message: 'Game version mismatch' });
});

test('room is full after MAX_PLAYERS', async () => {
  const env = await setup({ clients: [1, 2, 3, 4, 5].map((i) => ({ name: `P${i}`, color: i })) });
  assert.equal(env.host.roster.length, 6);
  assert.deepEqual(env.host.roster.map((r) => r.color).sort(), [0, 1, 2, 3, 4, 5]);
  await assert.rejects(join(env.hub, env.clock, { name: 'Seven' }), { message: 'Room is full' });
  assert.equal(env.host.roster.length, 6);
  // A slot frees up when someone leaves.
  env.clients[0].leave();
  await flush(6);
  assert.equal(env.host.roster.length, 5);
  const late = await join(env.hub, env.clock, { name: 'Seven' });
  assert.equal(late.localId, 7);
});

test('start: Game built from roster + settings, everyone told, map rebuilt on clients', async () => {
  const env = await setup({ clients: [{ name: 'A', cls: 'demo', color: 3 }] });
  const [c] = env.clients;
  env.host.setSettings({ mapId: 'truckstop', waves: 10 });
  const starts = collect(c, 'start');
  const hostStarts = collect(env.host, 'start');
  assert.equal(env.host.start(), true);
  assert.equal(env.host.start(), false, 'already running');
  await flush();
  await wait(5);
  const g = env.game();
  assert.equal(env.host.inGame, true);
  assert.equal(c.inGame, true);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].mapId, 'truckstop');
  assert.equal(starts[0].seed, hostStarts[0].seed);
  assert.equal(starts[0].settings.waves, 10);
  assert.deepEqual(g.players.map((p) => [p.id, p.name, p.color, p.cls]), [[1, 'Bob', 0, 'soldier'], [2, 'A', 3, 'demo']]);
  assert.equal(c.getMap().id, 'truckstop');
  assert.equal(c.getMap().width, env.host.getMap().width);
  assert.equal(env.host.setSettings({ waves: 20 }), false, 'settings are locked in game');
});

test('late join receives start and is added to the running game; leave removes them', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  env.host.start();
  await frames(env, 10);
  const chat = collect(env.host, 'chat');
  const late = await join(env.hub, env.clock, { name: 'Late', cls: 'scout' });
  const starts = collect(late, 'start');
  assert.equal(late.inGame, true, 'start arrives with the welcome');
  await wait(5);
  assert.equal(starts.length, 1, 'the late joiner can still subscribe to start after joinGame resolves');
  assert.equal(starts[0].mapId, 'highway');
  assert.equal(late.getMap().id, 'highway');
  const g = env.game();
  assert.deepEqual(g.log.added.map((p) => [p.id, p.name, p.cls]), [[3, 'Late', 'scout']]);
  assert.ok(chat.some((m) => m.system && m.text === 'Late joined the game'));
  env.clients.push(late);
  await frames(env, 6);
  assert.ok(late.getView(), 'late joiner renders snapshots');
  late.leave();
  await flush(6);
  assert.deepEqual(g.log.removed, [3]);
  assert.equal(env.host.roster.length, 2);
  assert.ok(chat.some((m) => m.system && m.text === 'Late left the game'));
});

test('disconnect reasons: host left, kicked, connection lost', async () => {
  const env = await setup({ clients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  const [a, b, c] = env.clients;
  const da = collect(a, 'disconnected');
  const db = collect(b, 'disconnected');
  const dc = collect(c, 'disconnected');
  assert.equal(env.host.kick(b.localId), true);
  await flush(6);
  assert.deepEqual(db, [{ reason: 'Kicked' }]);
  assert.equal(env.host.roster.length, 3);
  // Transport-level drop without a goodbye.
  const peerC = [...env.hub.host.clients.values()].find((t) => t === c.net).peerId;
  env.hub.host.disconnect(peerC);
  await flush(6);
  assert.deepEqual(dc, [{ reason: 'Connection lost' }]);
  env.host.leave();
  await flush(6);
  assert.deepEqual(da, [{ reason: 'Host left the game' }]);
  assert.equal(a.left, true);
});

test('client watchdog: silence from the host means Connection lost', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  const d = collect(a, 'disconnected');
  env.clock.advance(11);
  a.update(0.016, null, 0);
  assert.deepEqual(d, [{ reason: 'Connection lost' }]);
});

test('ping is measured by the host and published in the roster and client stats', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.clock.advance(2.5);
  env.host.update(0.016, null, 0);   // housekeeping sends the ping
  env.clock.advance(0.042);          // "network" time before the pong is handled
  await flush();
  env.clock.advance(2.1);
  env.host.update(0.016, null, 0);   // next round publishes the roster (and pings again)
  env.clock.advance(0.042);
  await flush();
  assert.equal(env.host.roster[1].ping, 42);
  assert.equal(a.roster[1].ping, 42);
  assert.equal(a.stats.ping, 42);
});

test('buy / ready forwarding and ready in lobby vs in game', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  a.setProfile({ ready: true });
  await flush();
  assert.equal(env.host.roster[1].ready, true, 'lobby ready is a roster flag');
  env.host.start();
  await flush();
  assert.equal(env.host.roster[1].ready, false, 'reset when the game starts');
  a.buy('rifle');
  a.ready();
  await flush();
  env.host.buy('turret');
  env.host.ready();
  a.setProfile({ ready: true });
  await flush();
  const cmds = env.game().log.commands.map((c) => [c.id, c.cmd.type, c.cmd.item]);
  assert.deepEqual(cmds, [[2, 'buy', 'rifle'], [2, 'ready', undefined], [1, 'buy', 'turret'], [1, 'ready', undefined], [2, 'ready', undefined]]);
  await frames(env, 3);
  const events = a.drainEvents();
  assert.ok(Array.isArray(events));
});

test('host: snapshots at TICK_RATE / SNAPSHOT_EVERY, catch-up capped, host view interpolated', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.start();
  await flush();
  let snaps = 0;
  a.net.on('message', (ch) => {
    if (ch === 'state') snaps++;
  });
  await frames(env, 60);
  assert.equal(env.game().tick, 60);
  assert.equal(snaps, 20);
  // A 5 s stall only simulates MAX_CATCHUP_TICKS.
  env.clock.advance(5);
  env.host.update(0.016, null, 0);
  assert.equal(env.game().tick, 60 + 8);
  const view = env.host.getView();
  assert.equal(view.zombies.length, 250);
  assert.deepEqual(view.events, []);
  assert.ok(env.host.drainEvents().length > 0);
  assert.equal(env.host.getMap(), env.game().map);
});

test('host: own input fed once per tick, edges exactly once, stale input → stand still', async () => {
  const env = await setup();
  env.host.start();
  // Presses in frames too short to produce a tick are carried into the next produced cmd.
  for (let i = 0; i < 5; i++) {
    env.clock.advance(0.002);
    env.host.update(0.002, input({ reload: i === 1, cycle: 1, moveX: 1 }), 0.5);
  }
  assert.equal(env.game().tick, 0);
  await frames(env, 30, () => input({ moveX: 1, fire: true }));
  const applied = env.game().log.applied.get(1);
  assert.equal(applied.length, 30);
  assert.equal(applied.filter((c) => c.reload).length, 1, 'reload applied exactly once');
  assert.ok(applied[0].reload, 'on the first tick after the press');
  assert.deepEqual(applied.slice(0, 4).map((c) => c.cycle), [1, 1, 1, 0], 'one notch per cmd, at most 3 pending');
  assert.ok(applied.every((c) => c.angle === 0 || c.angle === 0.5));
  const before = applied.length;
  // No update() for a while (hidden tab): the worker keeps the game going, the host stands still.
  env.clock.advance(1);
  env.host._housekeep();
  const idle = applied.slice(before);
  assert.ok(idle.length >= 8);
  assert.ok(idle.every((c) => c.moveX === 0 && !c.fire), 'stale input holds nothing');
});

test('client: edges carried across frames without ticks, sent redundantly, applied once', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.start();
  await flush();
  await frames(env, 5);
  // 240 fps: most frames produce no cmd. The press happens in one of them.
  let pressed = false;
  await frames(env, 60, (s, i) => {
    if (s !== a) return null;
    const press = !pressed && i === 1;
    if (press) pressed = true;
    return input({ frag: press, molotov: i === 20, slot: i === 30 ? 2 : -1, moveY: 1 });
  }, 1 / 240);
  await frames(env, 10);
  const applied = env.game().log.applied.get(a.localId);
  assert.equal(applied.filter((c) => c.frag).length, 1);
  assert.equal(applied.filter((c) => c.molotov).length, 1);
  assert.equal(applied.filter((c) => c.slot === 2).length, 1);
  const seqs = applied.map((c) => c.seq);
  const unique = new Set(seqs);
  // Starved ticks repeat the previous cmd, so seqs repeat but never go backwards.
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] >= seqs[i - 1]);
  assert.ok(unique.size >= 15);
});

test('slow frames lose no cmds; presses made in the lobby do not leak into the game', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.update(1 / 60, input({ frag: true }), 0);
  a.update(1 / 60, input({ reload: true }), 0);
  env.host.start();
  await flush();
  await frames(env, 10, () => input({ moveX: 1 }));
  // ~12 fps: five cmds per frame, more than the usual redundancy of four.
  await frames(env, 20, (s) => (s === a ? input({ moveX: -1 }) : null), 0.08);
  await frames(env, 10);
  const applied = env.game().log.applied.get(a.localId);
  assert.ok(!applied.some((c) => c.reload), 'lobby reload did not leak');
  assert.ok(!env.game().log.applied.get(1).some((c) => c.frag), 'lobby frag did not leak');
  const seqs = [...new Set(applied.map((c) => c.seq))].sort((x, y) => x - y);
  for (let i = 1; i < seqs.length; i++) assert.equal(seqs[i], seqs[i - 1] + 1, `no gap after seq ${seqs[i - 1]}`);
  assert.ok(seqs.length >= 100);
});

function hostPlayer(env, id) {
  return env.game().players.find((p) => p.id === id);
}

test('prediction: local player moves immediately and converges with the host', async () => {
  const env = await setup({ clients: [{ name: 'A', cls: 'scout' }] });
  const [a] = env.clients;
  env.host.start();
  await flush();
  await frames(env, 10);
  const start = a.getPredictedLocal();
  assert.ok(start, 'prediction starts with the first snapshot');
  // One frame of input moves the predicted player before any snapshot can confirm it.
  env.clock.advance(1 / 60);
  a.update(1 / 60, input({ moveX: 1 }), 0);
  const moved = a.getPredictedLocal();
  assert.ok(moved.x > start.x + 2, `predicted immediately (${start.x} → ${moved.x})`);
  await frames(env, 90, (s, i) => (s === a ? input({ moveX: 1, moveY: i % 20 < 10 ? 0.5 : -0.5, sprint: i < 60 }) : null));
  await frames(env, 30);
  const hp = hostPlayer(env, a.localId);
  const pred = a.getPredictedLocal();
  assert.ok(Math.hypot(hp.x - start.x, hp.y - start.y) > 100, 'the host moved the player');
  assert.ok(Math.abs(pred.x - hp.x) < 0.01 && Math.abs(pred.y - hp.y) < 0.01, `pred ${pred.x},${pred.y} host ${hp.x},${hp.y}`);
  const view = a.getView();
  const lp = view.players.find((p) => p.id === a.localId);
  assert.ok(Math.abs(lp.x - hp.x) < 0.01);
});

test('reconciliation: lost inputs and host-side corrections are smoothed, then converge', async () => {
  const env = await setup({ clients: [{ name: 'A' }], hub: { loss: 0.25, random: createRng(5).next } });
  const [a] = env.clients;
  env.host.start();
  await flush();
  await frames(env, 10);
  let maxOffset = 0;
  await frames(env, 120, (s, i) => {
    if (s !== a) return null;
    maxOffset = Math.max(maxOffset, Math.hypot(a.offX, a.offY));
    return input({ moveX: Math.cos(i / 15), moveY: Math.sin(i / 15) });
  });
  // Knock the player sideways on the host (like a brute charge): a correction arrives.
  const hp = hostPlayer(env, a.localId);
  hp.x += 60;
  const knockTick = env.game().tick;
  let midOffset = 0;
  for (let i = 0; i < 30 && midOffset === 0; i++) {
    await frames(env, 1);
    if (a.newest.tick > knockTick) midOffset = Math.hypot(a.offX, a.offY);
  }
  assert.ok(midOffset > 1, `visual offset absorbs the correction (${midOffset})`);
  await frames(env, 40);
  const pred = a.getPredictedLocal();
  assert.ok(Math.abs(pred.x - hp.x) < 0.01 && Math.abs(pred.y - hp.y) < 0.01, `pred ${pred.x},${pred.y} host ${hp.x},${hp.y}`);
  // A huge correction snaps instead of sliding.
  hp.x += 400;
  await frames(env, 6);
  assert.ok(Math.abs(a.getPredictedLocal().x - hp.x) < 0.01);
  assert.ok(maxOffset < 120);
});

test('interpolation: remote entities render INTERP_DELAY behind, between snapshots', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.start();
  await flush();
  await frames(env, 60);
  const view = a.getView();
  assert.ok(view);
  assert.equal(view.zombies.length, 250);
  const newest = a.newest.tick;
  assert.ok(view.tick <= newest);
  // Render time is ~0.1 s (6 ticks) behind the newest snapshot.
  const rt = a.lastRender / DT;
  assert.ok(newest - rt > 3 && newest - rt < 10, `render tick ${rt} newest ${newest}`);
  // Zombie 1 moves on a circle: the view is between the two bracketing snapshots.
  const buf = a.buffer;
  let i = 0;
  while (i < buf.length && buf[i].tick * DT < a.lastRender) i++;
  const z0 = buf[i - 1].zombies[0], z1 = buf[i].zombies[0], zv = view.zombies.find((z) => z.id === 1);
  assert.ok(zv.x >= Math.min(z0.x, z1.x) - 1e-6 && zv.x <= Math.max(z0.x, z1.x) + 1e-6);
  // Host stops sending: extrapolate at most 100 ms, then hold.
  await frames({ ...env, host: { update() {} } }, 30);
  const v1 = a.getView();
  env.clock.advance(1);
  const v2 = a.getView();
  assert.deepEqual(v1.zombies[0], v2.zombies[0], 'holds once the extrapolation budget is spent');
});

test('events are released in tick order when render time reaches their snapshot', async () => {
  const env = await setup({ clients: [{ name: 'A' }], hub: { jitter: 0 } });
  const [a] = env.clients;
  env.host.start();
  await flush();
  let n = 0;
  const origStep = FakeGame.prototype.step;
  const g = env.game();
  g.step = function step() {
    origStep.call(this);
    this.events.push({ type: 'marker', n: ++n, tick: this.tick });
  };
  const released = [];
  for (let f = 0; f < 120; f++) {
    await frames(env, 1);
    const evs = a.drainEvents().filter((e) => e.type === 'marker');
    for (const e of evs) {
      assert.ok(e.tick * DT <= a.lastRender + 1e-6, 'never before its time');
      released.push(e.n);
    }
  }
  assert.ok(released.length > 80);
  for (let i = 0; i < released.length; i++) assert.equal(released[i], released[0] + i, 'in order, none lost or doubled');
  assert.ok(released[released.length - 1] < n, 'the newest events are still waiting');
});

test('lossy p2p state channel: important events are echoed and delivered exactly once', async () => {
  const env = await setup({ clients: [{ name: 'A' }], hub: { loss: 0.4, random: createRng(11).next } });
  env.hub.host.kind = 'p2p';
  env.host.transport = 'p2p';
  const [a] = env.clients;
  env.host.start();
  await flush();
  const g = env.game();
  let id = 0;
  const origStep = FakeGame.prototype.step;
  g.step = function step() {
    origStep.call(this);
    if (this.tick % 3 === 0) this.events.push({ type: 'zdie', id: ++id, ztype: 'walker', x: 1, y: 2, angle: 0, by: 1, gib: false });
  };
  const got = [];
  for (let f = 0; f < 240; f++) {
    await frames(env, 1);
    for (const e of a.drainEvents()) if (e.type === 'zdie' && e.x === 1) got.push(e.id);
  }
  await frames({ ...env, host: { update() {} } }, 20);
  for (const e of a.drainEvents()) if (e.type === 'zdie' && e.x === 1) got.push(e.id);
  const unique = new Set(got);
  assert.equal(unique.size, got.length, 'no duplicates');
  // With 40% loss and two echoes, nearly everything arrives (p(lost) ≈ 0.4³ ≈ 6%).
  assert.ok(unique.size >= id * 0.85, `${unique.size}/${id} delivered`);
});

test('returnToLobby: everyone back in the lobby, new game gets a new match number', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  const lobby = collect(a, 'lobby');
  env.host.start();
  await frames(env, 10);
  assert.ok(a.getView());
  assert.equal(env.host.returnToLobby(), true);
  await flush();
  assert.equal(env.host.inGame, false);
  assert.equal(a.inGame, false);
  assert.equal(lobby.length, 1);
  assert.equal(a.getView(), null);
  assert.equal(env.host.getView(), null);
  env.host.start();
  await frames(env, 10);
  assert.equal(a.match, 2);
  assert.ok(a.getView());
});

test('solo: local transport with no network at all', async () => {
  const solo = await hostGame({ name: 'Solo', color: 2, cls: 'heavy', transport: 'local', hooks: { manual: true, createGame: (o) => new FakeGame(o) } });
  assert.equal(solo.code, null);
  assert.equal(solo.inviteUrl, null);
  assert.equal(solo.transport, 'local');
  assert.equal(solo.start(), true);
  solo.update(0.1, input({ moveX: 1 }), 0);
  assert.ok(solo.getView());
  assert.ok(solo.getPredictedLocal());
  solo.leave();
});

test('joinGame input validation', async () => {
  await assert.rejects(joinGame({ code: 'nope', name: 'x' }), { message: 'Room not found' });
  await assert.rejects(joinGame({ code: 'ABCD0', name: 'x' }), { message: 'Room not found' });
});

// ---- the real simulation ------------------------------------------------------------

async function realGame() {
  try {
    const { Game } = await import('../public/js/shared/sim.js');
    return Game;
  } catch (err) {
    return err;
  }
}

test('real Game over the local transport: host + 2 clients, inputs move players, prediction converges', async (t) => {
  const Game = await realGame();
  if (typeof Game !== 'function') {
    t.skip(`shared/sim.js not loadable: ${Game.message}`);
    return;
  }
  const env = await setup({
    clients: [{ name: 'Alice', cls: 'medic', color: 1 }, { name: 'Carl', cls: 'heavy', color: 2 }],
    createGame: (opts) => new Game(opts),
  });
  const [a, b] = env.clients;
  env.host.setSettings({ mapId: 'highway', difficulty: 'easy' });
  env.host.start();
  await flush();
  const g = env.game();
  assert.equal(g.players.length, 3);
  await frames(env, 10);
  const startA = { ...g.players.find((p) => p.id === a.localId) };
  const startB = { ...g.players.find((p) => p.id === b.localId) };
  let snapsA = 0;
  a.net.on('message', (ch) => {
    if (ch === 'state') snapsA++;
  });
  await frames(env, 120, (s, i) => {
    if (s === a) return input({ moveX: 1, moveY: i < 60 ? 0.3 : -0.3, sprint: i < 40 });
    if (s === b) return input({ moveX: -0.7, moveY: 0.7 });
    return input({ moveY: -1 });
  });
  await frames(env, 30);
  const hpA = g.players.find((p) => p.id === a.localId);
  const hpB = g.players.find((p) => p.id === b.localId);
  assert.ok(Math.hypot(hpA.x - startA.x, hpA.y - startA.y) > 80, 'inputs moved Alice on the host');
  assert.ok(Math.hypot(hpB.x - startB.x, hpB.y - startB.y) > 60, 'inputs moved Carl on the host');
  assert.ok(snapsA >= 45, `Alice received ${snapsA} snapshots`);
  for (const [c, hp] of [[a, hpA], [b, hpB]]) {
    const pred = c.getPredictedLocal();
    assert.ok(Math.abs(pred.x - hp.x) < 0.05 && Math.abs(pred.y - hp.y) < 0.05,
      `${c.localId}: pred ${pred.x.toFixed(2)},${pred.y.toFixed(2)} host ${hp.x.toFixed(2)},${hp.y.toFixed(2)}`);
    const view = c.getView();
    assert.equal(view.players.length, 3);
    assert.ok(view.phase);
  }
  // Remote players in Alice's view trail the host by about INTERP_DELAY.
  const carlInA = a.getView().players.find((p) => p.id === b.localId);
  assert.ok(Math.hypot(carlInA.x - hpB.x, carlInA.y - hpB.y) < 40);
  // Buying goes through the host's real Game and comes back as an event.
  a.buy('ammo');
  await frames(env, 20);
  const evs = a.drainEvents();
  assert.ok(evs.some((e) => (e.type === 'buy' || e.type === 'buyfail') && e.pid === a.localId), 'buy result event reached the client');
  env.host.leave();
  await flush(6);
});

test('real Game solo: hostGame({ transport: "local" }) runs the simulation', async (t) => {
  const Game = await realGame();
  if (typeof Game !== 'function') {
    t.skip(`shared/sim.js not loadable: ${Game.message}`);
    return;
  }
  const clock = makeClock();
  const solo = await hostGame({ name: 'Solo', color: 0, cls: 'soldier', transport: 'local', hooks: { manual: true, now: clock } });
  solo.start();
  const p0 = { ...solo.getView().players[0] };
  for (let i = 0; i < 60; i++) {
    clock.advance(1 / 60);
    solo.update(1 / 60, input({ moveX: 1 }), 0);
  }
  const p1 = solo.getView().players[0];
  assert.ok(p1.x > p0.x + 100, `moved ${p0.x} → ${p1.x}`);
  assert.ok(Math.abs(solo.getPredictedLocal().x - p1.x) < 1e-9);
  solo.leave();
});

test('shot prediction: own shots shown at once, host shots echoed, mag and reload respected', async (t) => {
  const Game = await realGame();
  if (typeof Game !== 'function') {
    t.skip(`shared/sim.js not loadable: ${Game.message}`);
    return;
  }
  const { WEAPONS } = await import('../public/js/shared/weapons.js');
  const { perksFor } = await import('../public/js/shared/classes.js');
  const { damagePlayer } = await import('../public/js/shared/sim/players.js');
  const env = await setup({ clients: [{ name: 'Alice', cls: 'soldier', color: 1 }], createGame: (opts) => new Game(opts) });
  const [a] = env.clients;
  env.host.start();
  await flush();
  const g = env.game();
  await frames(env, 20);
  a.drainEvents();
  env.host.drainEvents();
  const rifle = WEAPONS.rifle;
  const reload = rifle.reload * perksFor('soldier').reloadMult;

  // Hold fire: the very first frame already yields a predicted shot, before any snapshot.
  const hostEvents = [];
  const log = [];
  const firing = (n) => frames(env, n, (s) => (s === a ? input({ fire: true }) : null));
  await firing(1);
  const first = a.drainEvents().filter((e) => e.type === 'shot');
  assert.equal(first.length, 1, 'predicted immediately');
  const s0 = first[0];
  assert.equal(s0.predicted, true);
  assert.equal(s0.echo, undefined);
  assert.equal(s0.pid, a.localId);
  assert.equal(s0.turret, 0);
  assert.equal(s0.weapon, 'rifle');
  assert.equal(s0.rays.length, 1);
  const me = a.getPredictedLocal();
  assert.ok(Math.hypot(s0.x - me.x, s0.y - me.y) < 23, 'muzzle in front of the player');
  log.push({ frame: 0, ev: s0 });

  // Keep firing ~6 s: a full mag, an auto reload, then more.
  for (let frame = 1; frame < 400; frame++) {
    await firing(1);
    for (const e of a.drainEvents()) if (e.type === 'shot') log.push({ frame, ev: e });
    hostEvents.push(...env.host.drainEvents());
  }
  await frames(env, 40);
  for (const e of a.drainEvents()) if (e.type === 'shot') log.push({ frame: 999, ev: e });
  hostEvents.push(...env.host.drainEvents());

  const predicted = log.filter((l) => l.ev.predicted);
  const echoes = log.filter((l) => l.ev.echo);
  assert.equal(predicted.length + echoes.length, log.length, 'every own shot is predicted or an echo');
  assert.ok(echoes.every((l) => l.ev.pid === a.localId && !l.ev.predicted));
  const hostShots = hostEvents.filter((e) => e.type === 'shot' && e.pid === a.localId);
  assert.equal(echoes.length, hostShots.length, 'every host shot came back as an echo');
  assert.ok(Math.abs(predicted.length - echoes.length) <= 1, `predicted ${predicted.length} vs host ${echoes.length}`);
  // The host never marks anything.
  assert.ok(hostEvents.every((e) => !e.predicted && !e.echo));
  // Exactly one magazine, then a pause of about the reload time.
  const frames1 = predicted.map((l) => l.frame);
  let gapAt = -1;
  for (let i = 1; i < frames1.length; i++) {
    if (frames1[i] - frames1[i - 1] > 20) {
      gapAt = i;
      break;
    }
  }
  assert.equal(gapAt, rifle.mag, 'first burst is one magazine');
  const gap = (frames1[gapAt] - frames1[gapAt - 1]) / 60;
  assert.ok(gap >= reload && gap < reload + 0.3, `reload pause ${gap.toFixed(3)} s vs ${reload}`);
  const hostP = g.players.find((p) => p.id === a.localId);
  assert.ok(predicted.length > rifle.mag + 10, `kept firing after the reload (${predicted.length} shots)`);

  // A manual reload stops prediction until it is done.
  await frames(env, 5);
  a.drainEvents();
  assert.ok(hostP.mag[1] < rifle.mag);
  await frames(env, 1, (s) => (s === a ? input({ reload: true }) : null));
  const during = [];
  for (let i = 0; i < Math.floor(reload * 60) - 4; i++) {
    await firing(1);
    for (const e of a.drainEvents()) if (e.type === 'shot' && e.predicted) during.push(e);
  }
  assert.equal(during.length, 0, 'no shots predicted while reloading');
  await firing(20);
  assert.ok(a.drainEvents().some((e) => e.type === 'shot' && e.predicted), 'fires again after the reload');

  // Rays are traced against the rendered zombies (and a zombie right in front is hit).
  await frames(env, 30);
  a.drainEvents();
  const view = a.getView();
  const pos = a.getPredictedLocal();
  view.zombies.push({ id: 60000, type: 'walker', x: pos.x + 120, y: pos.y, angle: 0, hp: 1, flags: 0 });
  await firing(1);
  const traced = a.drainEvents().find((e) => e.type === 'shot' && e.predicted);
  assert.ok(traced, 'a predicted shot');
  assert.equal(traced.rays[0].hit, 1);
  assert.ok(Math.abs(traced.rays[0].x - (pos.x + 120 - 14)) < 3, `ray stops at the zombie: ${traced.rays[0].x}`);

  // Downed: pistol rules.
  await frames(env, 30);
  damagePlayer(g, hostP, 1e6, hostP.x, hostP.y);
  await frames(env, 20);
  a.drainEvents();
  await firing(10);
  const downed = a.drainEvents().filter((e) => e.type === 'shot' && e.predicted);
  assert.ok(downed.length >= 1);
  assert.ok(downed.every((e) => e.weapon === 'pistol'));
  env.host.leave();
  await flush(6);
});

test('shot prediction: never on the host, never for other players, nothing once the game is over', async (t) => {
  const Game = await realGame();
  if (typeof Game !== 'function') {
    t.skip(`shared/sim.js not loadable: ${Game.message}`);
    return;
  }
  const env = await setup({ clients: [{ name: 'Alice', cls: 'medic', color: 1 }, { name: 'Bea', cls: 'heavy', color: 2 }], createGame: (opts) => new Game(opts) });
  const [a, b] = env.clients;
  env.host.start();
  await flush();
  const g = env.game();
  await frames(env, 20);
  for (const s of [env.host, a, b]) s.drainEvents();
  const seen = new Map([[env.host, []], [a, []], [b, []]]);
  const all = (n) => frames(env, n, () => input({ fire: true })).then(() => {
    for (const [s, list] of seen) list.push(...s.drainEvents().filter((e) => e.type === 'shot'));
  });
  for (let i = 0; i < 60; i++) await all(1);
  await frames(env, 20);
  for (const [s, list] of seen) list.push(...s.drainEvents().filter((e) => e.type === 'shot'));
  assert.ok(seen.get(env.host).length > 10);
  assert.ok(seen.get(env.host).every((e) => !e.predicted && !e.echo), 'host: no flags');
  for (const c of [a, b]) {
    const list = seen.get(c);
    for (const e of list) {
      if (e.pid === c.localId) assert.ok(e.predicted || e.echo, 'own shots are flagged');
      else assert.ok(!e.predicted && !e.echo, 'other players\' shots are not');
    }
    assert.ok(list.some((e) => e.pid !== c.localId), 'sees the others shoot');
  }
  // Game over: firing is impossible, nothing is predicted (and the host fires nothing).
  g._gameOver('wiped');
  await frames(env, 10);
  for (const s of [env.host, a, b]) s.drainEvents();
  for (let i = 0; i < 30; i++) await frames(env, 1, () => input({ fire: true }));
  for (const s of [env.host, a, b]) assert.equal(s.drainEvents().filter((e) => e.type === 'shot').length, 0);
  env.host.leave();
  await flush(6);
});

test('getServerInfo: relay only on a JSON { relay: true }; HTML, static file, 404 or junk mean p2p', async () => {
  const saved = { fetch: globalThis.fetch, location: globalThis.location, HH_CONFIG: globalThis.HH_CONFIG };
  const cases = [
    [{ ok: true, body: '{"relay":true,"version":"1.0.0","protocol":1}' }, { relay: true, version: '1.0.0' }],
    [{ ok: true, body: '{"relay":false}\n' }, { relay: false }],
    [{ ok: true, body: '<!doctype html><html><body>index</body></html>' }, { relay: false }],
    [{ ok: true, body: '' }, { relay: false }],
    [{ ok: false, body: 'Not found' }, { relay: false }],
    [{ throws: true }, { relay: false }],
  ];
  try {
    delete globalThis.HH_CONFIG;
    Object.defineProperty(globalThis, 'location', { value: { href: 'http://game.test/play/', protocol: 'http:' }, configurable: true, writable: true });
    let n = 0;
    for (const [reply, want] of cases) {
      const urls = [];
      globalThis.fetch = async (url) => {
        urls.push(String(url));
        if (reply.throws) throw new TypeError('network down');
        return { ok: reply.ok, status: reply.ok ? 200 : 404, text: async () => reply.body };
      };
      // A fresh module instance: the result is cached per page load.
      const mod = await import(`../public/js/net/session.js?case=${n++}`);
      assert.deepEqual(await mod.getServerInfo(), want, JSON.stringify(reply));
      assert.deepEqual(urls, ['http://game.test/play/api/info']);
      assert.equal(await mod.getServerInfo(), await mod.getServerInfo(), 'cached');
    }
  } finally {
    globalThis.fetch = saved.fetch;
    Object.defineProperty(globalThis, 'location', { value: saved.location, configurable: true, writable: true });
    if (saved.location === undefined) delete globalThis.location;
    if (saved.HH_CONFIG !== undefined) globalThis.HH_CONFIG = saved.HH_CONFIG;
  }
});

test('prediction takes the sprint lock from the snapshot (host-side exhaustion converges exactly)', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.start();
  await flush();
  await frames(env, 10);
  const run = (n) => frames(env, n, (s, i) => (s === a ? input({ moveX: Math.cos(i / 40), moveY: Math.sin(i / 40), sprint: true }) : null));
  await run(30);
  // The host exhausts the player out of band (the client could never derive this).
  const hp = hostPlayer(env, a.localId);
  hp.stamina = 2;
  hp.sprintLock = true;
  const tick = env.game().tick;
  for (let i = 0; i < 30 && !(a.newest && a.newest.tick > tick); i++) await run(1);
  assert.equal(a.newestLocal.sprintLock, true, 'the snapshot carries the lock');
  assert.equal(a.pred.sprintLock, true, 'prediction adopted it');
  assert.equal(a.pred.sprinting, false);
  await run(40);
  await frames(env, 30);
  const pred = a.getPredictedLocal();
  assert.ok(Math.abs(pred.x - hp.x) < 0.01 && Math.abs(pred.y - hp.y) < 0.01, `pred ${pred.x},${pred.y} host ${hp.x},${hp.y}`);
  assert.equal(a.pred.sprintLock, hp.sprintLock);
});
