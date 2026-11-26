// Host robustness against a (possibly modified) client and netcode behaviour under bad
// network conditions (SPEC §6): control-message budgets, shop ids, kick bans and room
// lock, rejoin bookkeeping, p2p handshake buffering, name cleaning, echo of reordered
// snapshots, clock sync with a host that falls behind, deep ack lag, and stale events
// after a hidden tab. Local transport and a fake clock, like tests/session.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { PeerHostTransport, congested } from '../public/js/net/transport-peer.js';
import { backlogged } from '../public/js/net/transport-relay.js';
import { sanitizeName, sanitizeChat, isShopItem } from '../public/js/net/lobby-rules.js';
import { PERISHABLE_EVENTS } from '../public/js/net/event-rules.js';
import { decodeSnapshot, messageType, MSG } from '../public/js/shared/protocol.js';
import { GAME_VERSION, PROTOCOL_VERSION, DT } from '../public/js/shared/constants.js';
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

async function setup({ clients = [], hostNow, createGame } = {}) {
  const clock = makeClock();
  const hub = createLocalHub({ code: 'ABCDE' });
  const games = [];
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', transport: hub.host,
    hooks: {
      now: hostNow ? () => hostNow(clock()) : clock, manual: true,
      createGame: (opts) => {
        const g = createGame ? createGame(opts) : new FakeGame(opts);
        games.push(g);
        return g;
      },
    },
  });
  const env = { clock, hub, host, clients: [], games, game: () => games[games.length - 1] };
  env.join = (profile, via = hub.connect()) => joinGame({ ...profile, via, hooks: { now: clock, manual: true, ...profile.hooks } });
  for (const profile of clients) env.clients.push(await env.join(profile));
  return env;
}

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

/** A raw client transport that has completed the hello (a modified client). */
async function rawClient(env, name = 'Eve', extra = {}) {
  const raw = await env.hub.connect();
  const got = [];
  raw.onMessage((ch, msg) => {
    if (ch === 'ctl') got.push(msg);
  });
  raw.send('ctl', { t: 'hello', version: GAME_VERSION, protocol: PROTOCOL_VERSION, name, color: 0, cls: 'soldier', ...extra });
  await flush();
  return { raw, got };
}

// ---- shop ids and control budgets -----------------------------------------------------

test('buy: only real shop ids reach the game (no huge, unknown or prototype-key items)', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.start();
  await flush();
  for (const item of ['A'.repeat(40000), 'x'.repeat(33), 'constructor', '__proto__', 'toString', 'pistol', 'nothing', 42]) {
    a.net.send('ctl', { t: 'buy', item });
  }
  a.buy('rifle');
  a.buy('ammo');
  await flush();
  env.host.buy('constructor');
  env.host.buy('turret');
  const cmds = env.game().log.commands.map((c) => [c.id, c.cmd.item]);
  assert.deepEqual(cmds, [[2, 'rifle'], [2, 'ammo'], [1, 'turret']]);
  // And the snapshots stay small.
  const sizes = [];
  a.net.on('message', (ch, data) => {
    if (ch === 'state') sizes.push(data.byteLength);
  });
  await frames(env, 12);
  assert.ok(sizes.length > 0 && Math.max(...sizes) < 20000, `snapshot sizes ${sizes}`);
  assert.equal(isShopItem('medkit'), true);
  assert.equal(isShopItem('hasOwnProperty'), false);
});

test('control flood: excess messages dropped, roster broadcasts coalesced, flooder disconnected', async () => {
  const env = await setup({ clients: [{ name: 'A' }, { name: 'B', color: 2 }] });
  const [a, b] = env.clients;
  const rostersAtB = collect(b, 'roster');
  const rostersAtHost = collect(env.host, 'roster');
  // A burst of profile toggles: only the budget is applied, a handful of rosters go out.
  for (let i = 0; i < 60; i++) a.net.send('ctl', { t: 'profile', name: i % 2 ? 'Tic' : 'Tac' });
  await flush();
  assert.equal(a.left, false, 'a burst is not a reason to disconnect');
  assert.ok(rostersAtB.length <= 6, `roster broadcasts coalesced (${rostersAtB.length})`);
  assert.ok(rostersAtHost.length <= 6);
  // The last applied change is published once the budget refills.
  env.clock.advance(1);
  await frames(env, 2);
  assert.deepEqual(b.roster, env.host.roster, 'everyone ends up with the host roster');
  assert.deepEqual(a.roster, env.host.roster);

  // The same for buys in game.
  env.host.start();
  await flush();
  env.clock.advance(5);
  for (let i = 0; i < 100; i++) a.buy('ammo');
  await flush();
  const buys = env.game().log.commands.filter((c) => c.cmd.type === 'buy').length;
  assert.ok(buys >= 30 && buys <= 45, `buys over budget dropped (${buys})`);

  // A client that keeps flooding is thrown out; the others play on.
  env.clock.advance(5);
  const gone = collect(a, 'disconnected');
  for (let i = 0; i < 400; i++) a.net.send('ctl', { t: 'ready' });
  await flush(6);
  await wait(300);
  await flush(6);
  assert.deepEqual(gone, [{ reason: 'Disconnected: too many messages' }]);
  assert.equal(env.host.roster.some((r) => r.id === a.localId), false);
  assert.equal(b.left, false);
  // pong is never budgeted (the ping must keep working for everyone else).
  for (let i = 0; i < 200; i++) b.net.send('ctl', { t: 'pong', n: -1, ts: 0 });
  await flush();
  assert.equal(b.left, false);
});

// ---- kick bans, room lock, rejoin bookkeeping ---------------------------------------------

test('kick keeps the player out (same name or same tab); a locked room refuses everyone', async () => {
  const env = await setup({ clients: [{ name: 'Eve', hooks: { token: 'tab-eve-1234' } }, { name: 'Ann' }] });
  const [eve] = env.clients;
  assert.equal(env.host.kick(eve.localId), true);
  await flush(6);
  await assert.rejects(env.join({ name: 'eve' }), { message: 'You were kicked from this room' });
  await assert.rejects(env.join({ name: 'Mallory', hooks: { token: 'tab-eve-1234' } }), { message: 'You were kicked from this room' });
  env.host.start();
  await flush();
  await assert.rejects(env.join({ name: ' Eve ' }), { message: 'You were kicked from this room' });
  assert.deepEqual(env.host.roster.map((r) => r.name), ['Bob', 'Ann']);
  // A player renamed in the lobby is banned under both names; nameless players are not
  // all banned because one of them was kicked.
  const ann = env.clients[1];
  ann.setProfile({ name: 'Annabel' });
  const anon = await env.join({ name: '' });
  await flush();
  env.host.kick(ann.localId);
  env.host.kick(anon.localId);
  await flush(6);
  await assert.rejects(env.join({ name: 'Ann' }), { message: 'You were kicked from this room' });
  await assert.rejects(env.join({ name: 'annabel' }), { message: 'You were kicked from this room' });
  const nameless = await env.join({ name: '\u200b' });
  assert.ok(nameless.localId > 0);
  // Someone else is still welcome, until the host locks the room.
  const carl = await env.join({ name: 'Carl' });
  assert.ok(carl.localId > 0);
  assert.equal(env.host.setLocked(true), true);
  await assert.rejects(env.join({ name: 'Dora' }), { message: 'Room is locked' });
  assert.equal(env.clients[1].setLocked(true), false, 'clients cannot lock');
  env.host.setLocked(false);
  const dora = await env.join({ name: 'Dora' });
  assert.ok(dora.localId > 0);
});

test('leaving and rejoining the running game keeps the cash (real Game)', async (t) => {
  let Game;
  try {
    ({ Game } = await import('../public/js/shared/sim.js'));
  } catch (err) {
    t.skip(`shared/sim.js not loadable: ${err.message}`);
    return;
  }
  const env = await setup({ clients: [{ name: 'Ann' }], createGame: (opts) => new Game(opts) });
  const [ann] = env.clients;
  env.host.start();
  await frames(env, 6);
  const g = env.game();
  const start = g.getPlayer(ann.localId).cash;
  g.getPlayer(ann.localId).cash = 7;
  await frames(env, 6);
  ann.leave();
  await flush(6);
  assert.equal(g.getPlayer(ann.localId), null);
  // The host hands the Game the same (sanitised) name, so the Game recognises her.
  const back = await env.join({ name: ' Ann ' });
  assert.equal(env.host.roster.find((r) => r.id === back.localId).name, 'Ann');
  assert.equal(g.getPlayer(back.localId).cash, 7);
  const other = await env.join({ name: 'Zed' });
  assert.equal(g.getPlayer(other.localId).cash, start);
  env.host.leave();
  await flush(6);
});

// ---- p2p host: handshake buffering ---------------------------------------------------------

class FakeEmitter {
  constructor() {
    this.handlers = new Map();
  }

  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, []);
    this.handlers.get(ev).push(fn);
  }

  off(ev, fn) {
    const list = this.handlers.get(ev) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  fire(ev, ...args) {
    for (const fn of [...(this.handlers.get(ev) || [])]) fn(...args);
  }
}

class FakeConn extends FakeEmitter {
  constructor(peer, label) {
    super();
    this.peer = peer;
    this.label = label;
    this.open = false;
    this.closed = false;
    this.sent = [];
  }

  close() {
    this.closed = true;
    this.open = false;
  }

  send(data) {
    this.sent.push(data);
  }

  opened() {
    this.open = true;
    this.fire('open');
  }
}

test('p2p host: ctl data before the state channel opens is capped; pending remotes are capped', () => {
  const peer = new FakeEmitter();
  peer.destroy = () => {};
  const net = new PeerHostTransport(peer, 'ABCDE');
  try {
    const joins = [];
    const msgs = [];
    net.onPeerJoin((id) => joins.push(id));
    net.onMessage((id, ch, data) => msgs.push([id, ch, data]));

    // A normal client: hello before 'state' opens is held, then delivered.
    const ctl = new FakeConn('good', 'ctl');
    const state = new FakeConn('good', 'state');
    peer.fire('connection', ctl);
    peer.fire('connection', state);
    ctl.opened();
    ctl.fire('data', { t: 'hello', name: 'A' });
    state.opened();
    assert.deepEqual(joins, ['good']);
    assert.deepEqual(msgs, [['good', 'ctl', { t: 'hello', name: 'A' }]]);

    // Only 'ctl', then a stream of big messages: dropped long before it costs memory.
    const evil = new FakeConn('evil', 'ctl');
    peer.fire('connection', evil);
    evil.opened();
    const blob = 'x'.repeat(15000);
    for (let i = 0; i < 200; i++) evil.fire('data', { t: 'chat', text: blob });
    assert.equal(evil.closed, true);
    assert.equal(net.remotes.has('evil'), false);
    const many = new FakeConn('many', 'ctl');
    peer.fire('connection', many);
    many.opened();
    for (let i = 0; i < 100; i++) many.fire('data', { t: 'x' });
    assert.equal(net.remotes.has('many'), false);
    assert.equal(msgs.length, 1, 'nothing of theirs was delivered');

    // Half-open remotes cannot pile up without limit.
    const conns = [];
    for (let i = 0; i < 40; i++) {
      const c = new FakeConn(`half${i}`, 'ctl');
      conns.push(c);
      peer.fire('connection', c);
    }
    const pending = [...net.remotes.values()].filter((r) => !r.joined).length;
    assert.ok(pending <= 16, `pending remotes capped (${pending})`);
    assert.ok(conns[39].closed);
  } finally {
    net.close();
  }
});

test('state channels skip a message once a few are queued (p2p and relay)', () => {
  const dc = (bufferedAmount) => ({ dataChannel: { bufferedAmount } });
  assert.equal(congested(dc(0), 1200), false);
  assert.equal(congested(dc(10000), 1200), false);
  assert.equal(congested(dc(20000), 1200), true, '20 KB queued is well over 3 snapshots');
  assert.equal(congested(dc(40000), 14000), false, 'room for 3 of the biggest snapshots');
  assert.equal(backlogged({ bufferedAmount: 20000 }, 1200), true);
  assert.equal(backlogged({ bufferedAmount: 10000 }, 1200), false);
  assert.equal(backlogged({ bufferedAmount: 60000 }, 4000, 5), false, 'a per-peer fan-out has room for its frames');
});

// ---- names -----------------------------------------------------------------------------------

test('names: blank-looking characters and mark towers are cleaned', () => {
  for (const blank of ['ㅤㅤ', '⠀', '­­', '᠎', '\u{E0041}\u{E0042}', '؜', 'ﾠ', '͏', 'ᅟᅠ', '឴឵', ' ​ ']) {
    assert.equal(sanitizeName(blank), 'Survivor', JSON.stringify(blank));
  }
  assert.equal(sanitizeName('AㅤB⠀C'), 'ABC');
  assert.equal(sanitizeName('a' + '́'.repeat(15)), 'á́');
  assert.equal(sanitizeName('Zoë'), 'Zoë');
  assert.equal(sanitizeName('José'.normalize('NFD')), 'José'.normalize('NFD'));
  assert.equal(sanitizeName('김철수'), '김철수');
  assert.equal(sanitizeName('...'), '...');
  assert.equal(sanitizeChat('hi⠀ㅤthere'), 'hi there');
});

// ---- events: echo of reordered/skipped snapshots, stale events after a hidden tab ----------

/** Host + one client whose incoming state messages can be held back by the test. */
async function heldStateEnv(kind) {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.transport = kind;
  env.host.start();
  await flush();
  const deliver = a.net._deliver.bind(a.net);
  const ctl = { hold: false, held: [] };
  a.net._deliver = (ch, data) => {
    if (ch === 'state' && ctl.hold) ctl.held.push(data);
    else deliver(ch, data);
  };
  ctl.release = () => {
    const h = ctl.held;
    ctl.held = [];
    for (const d of h) deliver('state', d);
  };
  return { env, a, ctl, deliver };
}

function injectAt(game, tick, events) {
  const step = game.step.bind(game);
  game.step = function () {
    step();
    if (this.tick === tick) for (const ev of events) this.events.push({ ...ev });
  };
}

const MARKED = [
  { type: 'reload', pid: 1, weapon: 'pistol', time: 1.5 },
  { type: 'zattack', id: 77, ztype: 'walker', x: 5, y: 5, angle: 0 },
  { type: 'throw', pid: 1, kind: 'frag' },
];

function marked(events) {
  return events.filter((e) => (e.type === 'reload' && e.pid === 1) || (e.type === 'zattack' && e.id === 77)
    || (e.type === 'throw' && e.pid === 1)).map((e) => e.type);
}

test('p2p: a snapshot overtaken by the next one still delivers all its events exactly once', async () => {
  const { env, a, ctl, deliver } = await heldStateEnv('p2p');
  injectAt(env.game(), 63, MARKED);
  const got = [];
  let swapped = false;
  for (let f = 0; f < 150; f++) {
    // Hold the snapshot of tick 63 until the next one has been delivered.
    ctl.hold = env.game().tick >= 62 && env.game().tick < 66 && !swapped;
    await frames(env, 1);
    if (!ctl.hold && ctl.held.length && !swapped) {
      swapped = true;
      const [first, ...rest] = ctl.held;
      ctl.held = [];
      for (const d of rest) deliver('state', d);
      await flush();
      deliver('state', first);
    }
    got.push(...marked(a.drainEvents()));
  }
  assert.ok(swapped);
  assert.deepEqual(got.sort(), ['reload', 'throw', 'zattack']);
});

test('relay: snapshots echo important events too (a congested socket skips state frames)', async () => {
  const { env, a, ctl } = await heldStateEnv('relay');
  injectAt(env.game(), 63, MARKED);
  const echoes = [];
  a.net.on('message', (ch, data) => {
    if (ch === 'state' && messageType(data) === MSG.SNAPSHOT) {
      const snap = decodeSnapshot(data);
      if (snap.echo) echoes.push(...snap.echo);
    }
  });
  const got = [];
  for (let f = 0; f < 150; f++) {
    // The snapshot of tick 63 is lost for good.
    ctl.hold = env.game().tick >= 62 && env.game().tick < 64;
    await frames(env, 1);
    if (!ctl.hold) ctl.held = [];
    got.push(...marked(a.drainEvents()));
  }
  assert.ok(echoes.some((e) => e.tick === 63), 'tick 63 was echoed');
  assert.deepEqual(got, ['throw'], 'the important event arrived with the echo');
});

test('hidden client tab: stale tracers and sounds are dropped, lasting events still arrive', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  const [a] = env.clients;
  env.host.start();
  await frames(env, 30);
  a.drainEvents();
  // 8 s without frames on the client (hidden tab); the network keeps delivering.
  for (let i = 0; i < 8 * 60; i++) {
    env.clock.advance(1 / 60);
    env.host.update(1 / 60, null, 0);
    await flush(2);
  }
  await frames(env, 1);
  a.getView();
  const out = a.drainEvents();
  const perishable = out.filter((e) => PERISHABLE_EVENTS.has(e.type));
  const kills = out.filter((e) => e.type === 'zdie');
  assert.ok(kills.length >= 20, `kills kept for corpses (${kills.length})`);
  assert.ok(perishable.length <= 40, `stale perishable events dropped (${perishable.length} of ${out.length})`);
});

test('hidden host tab: while nobody looks only lasting events are kept for drainEvents', async () => {
  const env = await setup({ clients: [{ name: 'A' }] });
  env.host.start();
  await frames(env, 30);
  env.host.drainEvents();
  // The worker ticker keeps the host's game running while RAF is stopped.
  for (let i = 0; i < 5 * 60; i++) {
    env.clock.advance(1 / 60);
    env.host._housekeep();
    await flush(1);
  }
  const out = env.host.drainEvents();
  const shots = out.filter((e) => e.type === 'shot' && e.weapon === 'shotgun');
  assert.ok(out.filter((e) => e.type === 'zdie').length >= 15);
  assert.ok(shots.length <= 1, `stale shots dropped (${shots.length})`);
});

// ---- clock sync and ack lag ------------------------------------------------------------------

test('a host running below real time is played back smoothly, not frozen and jumping', async () => {
  // The host manages only 50 of its 60 ticks per second (an overloaded laptop).
  const env = await setup({ clients: [{ name: 'A' }], hostNow: (t) => 1000 + (t - 1000) * (50 / 60) });
  const [a] = env.clients;
  env.host.start();
  await flush();
  let prev = null, frozen = 0, past = 0, n = 0;
  const steps = [];
  for (let f = 0; f < 60 * 10; f++) {
    // Back and forth in the open (the remote player never runs into anything).
    const dir = Math.floor(f / 40) % 2 ? -1 : 1;
    await frames(env, 1, (s) => (s === env.host ? input({ moveY: dir }) : null));
    const view = a.getView();
    const p = view && view.players.find((q) => q.id === 1);
    if (f > 180 && f % 40 > 14 && prev !== null) {
      n++;
      const step = Math.abs(p.y - prev);
      steps.push(step);
      if (step < 1e-6) frozen++;
      if (a.lastRender > a.newest.tick * DT + 1e-9) past++;
    }
    prev = p ? p.y : null;
  }
  const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
  const sd = Math.sqrt(steps.reduce((s, v) => s + (v - mean) ** 2, 0) / steps.length);
  assert.ok(frozen <= n * 0.02, `frozen in ${frozen} of ${n} frames`);
  assert.ok(past <= n * 0.05, `render time past the newest snapshot in ${past} of ${n} frames`);
  assert.ok(sd < mean * 0.35, `even motion (mean ${mean.toFixed(2)} px, sd ${sd.toFixed(2)})`);
});

test('snapshots seconds late (congested link): the local player does not rubber-band', async () => {
  // Constant lag, and a lag that builds up to more than the replay window holds.
  const lags = [[150, () => 150], [400, () => 400], [700, (f) => Math.min(700, Math.max(0, f - 100))]];
  for (const [delay, lagAt] of lags) {
    const env = await setup({ clients: [{ name: 'A' }] });
    const [a] = env.clients;
    env.host.start();
    await flush();
    const deliver = a.net._deliver.bind(a.net);
    const queue = [];
    let frame = 0;
    a.net._deliver = (ch, data) => {
      if (ch === 'state') queue.push({ at: frame + lagAt(frame), data });
      else deliver(ch, data);
    };
    let maxErr = 0, jumps = 0, prevX = null;
    for (let i = 0; i < 1200; i++) {
      frame++;
      const dir = Math.floor(i / 120) % 2 ? -1 : 1;
      await frames(env, 1, (s) => (s === a ? input({ moveX: dir, moveY: 0.2 }) : null));
      while (queue.length && queue[0].at <= frame) deliver('state', queue.shift().data);
      await flush(2);
      if (i > delay + 60) {
        const hp = env.game().getPlayer(a.localId);
        const pred = a.getPredictedLocal();
        maxErr = Math.max(maxErr, Math.hypot(pred.x - hp.x, pred.y - hp.y));
        const shown = a.getView().players.find((p) => p.id === a.localId);
        if (prevX !== null && Math.abs(shown.x - prevX) > 30) jumps++;
        prevX = shown.x;
      }
    }
    assert.ok(maxErr < 10, `${delay} frames late: prediction error ${maxErr.toFixed(1)} px`);
    assert.equal(jumps, 0, `${delay} frames late: no visible snaps`);
    env.host.leave();
    await flush(6);
  }
});
