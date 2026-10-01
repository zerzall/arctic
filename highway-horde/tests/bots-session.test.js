// AI survivors in the session layer (SPEC §6.2): host-only addBot/removeBot in the
// lobby, bot roster entries over the local transport, bots passed to the Game and kept
// through repeated games, a human joining a full room pushing a bot out (lobby and
// mid-game), colours handed over to humans, and a real solo game with a bot squad.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { BOT_NAMES, botProfile } from '../public/js/net/lobby-rules.js';
import { MAX_PLAYERS } from '../public/js/shared/constants.js';
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

const IDLE = {
  moveX: 0, moveY: 0, aimScreenX: 0, aimScreenY: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0,
  shop: false, scoreboard: false, chat: false, ready: false, pause: false,
};

async function setup({ clients = [], createGame, hostProfile } = {}) {
  const clock = makeClock();
  const hub = createLocalHub({ code: 'BOTSQ' });
  const games = [];
  const opts = [];
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', ...hostProfile,
    transport: hub.host,
    hooks: {
      now: clock, manual: true,
      createGame: (o) => {
        opts.push(o);
        const g = createGame ? createGame(o) : new FakeGame(o);
        games.push(g);
        return g;
      },
    },
  });
  const env = { clock, hub, host, clients: [], games, opts, game: () => games[games.length - 1] };
  for (const profile of clients) env.clients.push(await join(env, profile));
  return env;
}

function join(env, profile) {
  return joinGame({ ...profile, via: env.hub.connect(), hooks: { now: env.clock, manual: true } });
}

async function frames(env, n) {
  for (let i = 0; i < n; i++) {
    env.clock.advance(1 / 60);
    env.host.update(1 / 60, IDLE, 0);
    for (const c of env.clients) if (!c.left) c.update(1 / 60, IDLE, 0);
    await flush(2);
  }
}

const bots = (roster) => roster.filter((r) => r.bot);

test('botProfile: listed names, free colours, classes nobody has yet', () => {
  const roster = [{ name: 'Ripley', color: 0, cls: 'medic' }, { name: 'X', color: 1, cls: 'soldier' }];
  const p = botProfile(roster);
  assert.ok(BOT_NAMES.includes(p.name) && p.name !== 'Ripley');
  assert.equal(p.color, 2);
  assert.equal(p.cls, 'engineer', 'medic and soldier are taken');
  const all = BOT_NAMES.map((name, i) => ({ name, color: i % 6, cls: 'medic' }));
  assert.equal(botProfile(all).name, 'Bot', 'falls back to a generic name when the list runs out');
});

test('addBot: host only, lobby only, bot roster entries seen by every client', async () => {
  const env = await setup({ clients: [{ name: 'Alice', color: 1, cls: 'medic' }] });
  const [c] = env.clients;
  const chat = [];
  env.host.on('chat', (m) => chat.push(m));
  const a = env.host.addBot();
  const b = env.host.addBot();
  await flush();
  assert.ok(a && b);
  for (const e of [a, b]) {
    assert.deepEqual(Object.keys(e).sort(), ['bot', 'cls', 'color', 'host', 'id', 'name', 'ping', 'ready']);
    assert.equal(e.bot, true);
    assert.equal(e.ready, true, 'bots are ready by definition');
    assert.equal(e.ping, 0);
    assert.equal(e.host, false);
    assert.ok(BOT_NAMES.includes(e.name));
  }
  const r = env.host.roster;
  assert.equal(r.length, 4);
  assert.equal(new Set(r.map((e) => e.color)).size, 4, 'distinct colours');
  assert.equal(new Set(r.map((e) => e.name)).size, 4, 'distinct names');
  assert.ok(!['soldier', 'medic'].includes(a.cls) && !['soldier', 'medic'].includes(b.cls), 'classes the humans did not take');
  assert.notEqual(a.cls, b.cls);
  assert.deepEqual(c.roster, r, 'clients see the bots (roster over the local transport)');
  assert.ok(chat.some((m) => m.system && m.text.includes(a.name)));
  // Fill up: MAX_PLAYERS in total.
  while (env.host.addBot());
  assert.equal(env.host.roster.length, MAX_PLAYERS);
  assert.equal(env.host.addBot(), null, 'full');
  // removeBot: only bots, only in the lobby.
  assert.equal(env.host.removeBot(c.localId), false, 'humans are not bots');
  assert.equal(env.host.removeBot(a.id), true);
  assert.equal(env.host.removeBot(a.id), false, 'already gone');
  await flush();
  assert.equal(c.roster.length, MAX_PLAYERS - 1);
  env.host.start();
  assert.equal(env.host.addBot(), null, 'not in game');
  assert.equal(env.host.removeBot(b.id), false, 'not in game');
});

test('start passes bots to the Game; they keep their slot, ready, through repeated games', async () => {
  const env = await setup({ clients: [{ name: 'Alice', color: 1, cls: 'medic' }] });
  const bot = env.host.addBot();
  env.host.start();
  await flush();
  const g1 = env.game();
  assert.deepEqual(g1.players.map((p) => p.id), [1, 2, bot.id]);
  assert.deepEqual(env.opts[0].players.map((p) => p.bot), [false, false, true], 'Game players carry bot: true');
  env.host.returnToLobby();
  await flush();
  const entry = env.host.roster.find((r) => r.id === bot.id);
  assert.ok(entry && entry.bot && entry.ready, 'bot stays, still ready');
  assert.equal(env.host.roster.find((r) => r.id === 2).ready, false, 'humans must ready again');
  env.host.start();
  await flush();
  assert.deepEqual(env.game().players.map((p) => p.id), [1, 2, bot.id], 'second game has the bot too');
});

test('bots reach the real Game as bots with brains', async () => {
  const { Game } = await import('../public/js/shared/sim.js');
  const env = await setup({ createGame: (o) => new Game(o) });
  env.host.addBot();
  env.host.addBot();
  env.host.start();
  const g = env.game();
  assert.equal(g.players.length, 3);
  assert.deepEqual(g.players.map((p) => !!p.bot), [false, true, true]);
  assert.equal(g.bots.length, 2);
  assert.equal(g.getPlayer(1).selfRevive, false, 'three players: no solo kit');
  env.host.leave();
});

test('a human joining a full lobby replaces a bot', async () => {
  const env = await setup({ clients: [{ name: 'Alice', color: 1 }] });
  const added = [];
  for (let i = 0; i < MAX_PLAYERS - 2; i++) added.push(env.host.addBot());
  assert.equal(env.host.roster.length, MAX_PLAYERS);
  const late = await join(env, { name: 'Carol', color: 3 });
  await flush();
  assert.equal(env.host.roster.length, MAX_PLAYERS);
  assert.equal(bots(env.host.roster).length, MAX_PLAYERS - 3);
  assert.ok(!env.host.roster.some((r) => r.id === added[added.length - 1].id), 'the newest bot made room');
  const carol = env.host.roster.find((r) => r.id === late.localId);
  assert.equal(carol.color, 3, 'a bot handed its colour over');
  assert.equal(new Set(env.host.roster.map((r) => r.color)).size, MAX_PLAYERS);
  assert.deepEqual(late.roster, env.host.roster);
  // Without bots a full room still refuses.
  const env2 = await setup({ clients: [1, 2, 3, 4, 5].map((i) => ({ name: `P${i}`, color: i })) });
  await assert.rejects(join(env2, { name: 'Seven' }), { message: 'Room is full' });
});

test('mid-game: a joiner takes a free slot and the bots stay; a full game drops a bot', async () => {
  const env = await setup();
  const b1 = env.host.addBot();
  env.host.start();
  await frames(env, 5);
  const late = await join(env, { name: 'Late' });
  env.clients.push(late);
  await flush();
  const g = env.game();
  assert.ok(env.host.roster.some((r) => r.id === b1.id), 'bots stay when there is room');
  assert.deepEqual(g.log.removed, []);
  assert.deepEqual(g.log.added.map((p) => p.id), [late.localId]);
  // Back in the lobby, fill every slot with bots and start again.
  env.host.returnToLobby();
  while (env.host.addBot());
  env.host.start();
  await frames(env, 5);
  const g2 = env.game();
  assert.equal(g2.players.length, MAX_PLAYERS);
  const last = bots(env.host.roster).pop();
  const late2 = await join(env, { name: 'Later' });
  await flush();
  assert.equal(env.host.roster.length, MAX_PLAYERS);
  assert.ok(!env.host.roster.some((r) => r.id === last.id), 'a bot left the running game');
  assert.deepEqual(g2.log.removed, [last.id]);
  assert.ok(g2.log.added.some((p) => p.id === late2.localId), 'the joiner entered the game');
  assert.equal(late2.inGame, true);
});

test('a human picking a bot\'s colour gets it; the bot takes the human\'s old one', async () => {
  const env = await setup({ clients: [{ name: 'Alice', color: 1 }] });
  const [c] = env.clients;
  const bot = env.host.addBot();
  const want = bot.color;
  c.setProfile({ color: want });
  await flush();
  assert.equal(env.host.roster.find((r) => r.id === c.localId).color, want);
  assert.equal(env.host.roster.find((r) => r.id === bot.id).color, 1);
  env.host.setProfile({ color: env.host.roster.find((r) => r.id === bot.id).color });
  assert.equal(env.host.roster[0].color, 1);
  assert.equal(env.host.roster.find((r) => r.id === bot.id).color, 0);
});

test('solo with an AI squad: local transport, bots fight in the real game', async () => {
  const clock = makeClock();
  const solo = await hostGame({ name: 'Solo', color: 0, cls: 'soldier', transport: 'local', hooks: { manual: true, now: clock } });
  assert.ok(solo.addBot());
  assert.ok(solo.addBot());
  assert.deepEqual(solo.roster.map((r) => !!r.bot), [false, true, true]);
  solo.start();
  solo.ready();
  const shotBy = new Set();
  for (let i = 0; i < 60 * 40; i++) {
    clock.advance(1 / 60);
    solo.update(1 / 60, IDLE, 0);
    for (const e of solo.drainEvents()) if (e.type === 'shot' && e.pid) shotBy.add(e.pid);
  }
  const view = solo.getView();
  assert.equal(view.phase, 'wave', 'the bots readied after the human');
  const botIds = solo.roster.filter((r) => r.bot).map((r) => r.id);
  assert.ok(botIds.every((id) => shotBy.has(id)), 'both bots fought');
  const kills = view.players.filter((p) => botIds.includes(p.id)).reduce((s, p) => s + p.kills, 0);
  assert.ok(kills > 0, 'and killed zombies');
  solo.leave();
});
