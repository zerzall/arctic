import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { makeRng } from '../../shared/rng.js';
import { WsClient } from '../helpers/ws-client.js';
import { wanderBots } from '../helpers/room-fixtures.js';

// Full flows over real sockets: create, join x3, bots, start, scripted play, match end, back to lobby; and the wire budgets
// (snapshot size, server CPU) with 4 humans + 4 bots. Real time is unavoidable here (the countdown alone is 3 s), so the
// scenarios run concurrently, each on its own server.

const TIMEOUTS = { HELLO_MS: 300, PING_MS: 200, DEAD_MS: 600 };
const quiet = () => {};

/** 'easy' bots plant one bomb on their spawn tile and stay (they lose); other levels idle. */
const flowBots = ({ level }) => {
  if (level !== 'easy') return { think: () => ({ d: 0, b: 0, x: 0 }) };
  let fired = false;
  return { think: () => { const b = fired ? 0 : 1; fired = true; return { d: 0, b, x: 0 }; } };
};

/** Builds scripted `in` frames for one human; the seq counter lives as long as the socket. */
class Player {
  constructor(client) {
    this.client = client;
    this.seq = 0;
  }

  cmd(d = 0, b = 0, x = 0) {
    return [++this.seq, d, b, x];
  }

  send(...cmds) {
    this.client.send({ t: 'in', c: cmds });
  }
}

const row = (snap, id) => snap.p.find((r) => r[0] === id);
const stats = async (port) => (await fetch(`http://127.0.0.1:${port}/api/stats`)).json();

/** The messages a client saw, with runs of `snap` collapsed. */
const sequence = (client) => client.frames.map((f) => f.msg.t).filter((t, i, all) => t !== 'snap' || all[i - 1] !== 'snap');

describe('integration: flows', { concurrency: true }, () => {
  it('create -> join x3 -> bots -> start -> scripted play -> match end -> back to lobby', async () => {
    const app = await startServer({ port: 0, timeouts: TIMEOUTS, log: quiet, botFactory: flowBots, seedFn: () => 4242 });
    const clients = [];
    after(async () => { for (const c of clients) c.ws.terminate(); await app.close(); });

    // -- create and join
    const mom = await WsClient.create(app.port, 'Mom');
    clients.push(mom);
    assert.match(mom.code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.deepEqual([mom.joined.seq, mom.joined.build, mom.joined.v], [0, '1.0.0', 1]);
    assert.match(mom.token, /^[0-9a-f]{32}$/);
    const first = await mom.next('lobby');
    assert.deepEqual([first.you, first.hostId, first.phase, first.players.length], [mom.id, mom.id, 'lobby', 1]);

    const guests = [];
    for (const name of ['Dad', 'Kid', 'Gran']) {
      const g = await WsClient.join(app.port, mom.code.toLowerCase(), name);
      clients.push(g);
      guests.push(g);
      assert.equal(g.code, mom.code);
    }
    const [dad, kid, gran] = guests;
    const lobby4 = await mom.next('lobby', (m) => m.players.length === 4);
    assert.deepEqual(lobby4.players.map((p) => p.name), ['Mom', 'Dad', 'Kid', 'Gran']);
    assert.equal(new Set(lobby4.players.map((p) => p.color)).size, 4, 'colours are unique');
    assert.equal((await mom.next('sys', (m) => m.text === 'Gran joined')).text, 'Gran joined');
    assert.equal((await gran.next('lobby')).you, gran.id);
    assert.equal(app.rooms.size, 1);

    // -- chat, emote, ping, host-only rules
    dad.send({ t: 'chat', text: 'ready?' });
    for (const c of clients) assert.equal((await c.next('chat')).text, 'ready?');
    kid.send({ t: 'emote', e: 4 });
    assert.deepEqual(await mom.next('emote'), { t: 'emote', from: kid.id, e: 4 });
    gran.send({ t: 'ping', ts: 123 });
    assert.deepEqual(await gran.next('pong'), { t: 'pong', ts: 123 });
    dad.send({ t: 'start' });
    assert.equal((await dad.next('error')).code, 'not_host');

    // -- bots and settings, then start
    for (let i = 0; i < 3; i++) mom.send({ t: 'addBot', level: 'easy' });
    mom.send({ t: 'settings', patch: { rounds: 1, roundTime: 60, theme: 'candy' } });
    const ready = await mom.next('lobby', (m) => m.players.length === 7 && m.settings.rounds === 1);
    assert.deepEqual(ready.players.filter((p) => p.isBot).map((p) => [p.name, p.level]), [['Bolt', 'easy'], ['Fuse', 'easy'], ['Pixel', 'easy']]);
    mom.send({ t: 'start' });

    const rounds = await Promise.all(clients.map((c) => c.next('round')));
    for (const r of rounds) {
      assert.equal(r.n, 1);
      assert.equal(r.theme, 'candy');
      assert.equal(r.grid.length, 195);
      assert.equal(r.players.length, 7);
      assert.equal(r.serverTick, 0);
    }
    assert.deepEqual(rounds[0], rounds[3], 'every client gets the same round');
    const humansIn = (r) => r.players.filter((p) => !p.isBot).map((p) => p.name);
    assert.deepEqual(humansIn(rounds[0]), ['Mom', 'Dad', 'Kid', 'Gran']);

    // -- scripted play: Kid walks, everybody else plants a bomb where they stand and stays put
    const players = new Map(clients.map((c) => [c.id, new Player(c)]));
    const go = await Promise.all(clients.map((c) => c.next('snap', (m) => m.st === 1)));
    const kidStart = row(go[2], kid.id);
    for (const c of [mom, dad, gran]) players.get(c.id).send(players.get(c.id).cmd(0, 1, 0));
    const walker = players.get(kid.id);
    const tileAt = (dx, dy) => rounds[2].grid[(Math.floor(kidStart[2]) + dy) * 15 + Math.floor(kidStart[1]) + dx];
    const dir = [[2, 1, 0], [4, -1, 0], [3, 0, 1], [1, 0, -1]].find(([, dx, dy]) => tileAt(dx, dy) === '.')[0];   // a way out of the spawn tile
    for (let i = 0; i < 4; i++) walker.send(walker.cmd(dir), walker.cmd(dir), walker.cmd(dir));
    const moved = await kid.next('snap', (m) => Math.abs(row(m, kid.id)[1] - kidStart[1]) + Math.abs(row(m, kid.id)[2] - kidStart[2]) > 0.3);
    assert.equal(row(moved, kid.id)[3], dir - 1, 'facing the way he walks');
    assert.ok(moved.ack[kid.id] >= 1, 'and his cmds are acknowledged');
    assert.deepEqual(Object.keys(moved.ack).map(Number), clients.map((c) => c.id), 'ack lists the four humans and no bot');

    // -- the round ends: Kid is the last one standing
    const end = await mom.next('roundEnd');
    assert.deepEqual({ ...end, scores: undefined }, {
      t: 'roundEnd', n: 1, winnerId: kid.id, winnerTeam: null, draw: false, reason: 'last', scores: undefined, matchOver: true,
    });
    assert.equal(end.scores.find((s) => s.id === kid.id).wins, 1);
    const seq = sequence(mom);
    const at = seq.indexOf('roundEnd');
    assert.deepEqual(seq.slice(at - 1, at + 2), ['snap', 'roundEnd', 'lobby'], 'snap, roundEnd, lobby');

    const over = await mom.next('matchEnd');
    assert.equal(over.reason, 'wins');
    assert.equal(over.winnerId, kid.id);
    assert.equal(over.standings.length, 7);
    assert.equal(over.standings[0].id, kid.id);
    assert.equal(over.standings[0].place, 1);
    assert.ok(over.standings.slice(1).every((s) => s.place === 2 && s.deaths === 1 && s.selfKills === 1), 'everybody else blew themselves up');
    const results = await mom.next('lobby', (m) => m.phase === 'results');
    assert.equal(results.players.find((p) => p.id === kid.id).wins, 1);
    assert.equal(results.round.n, 1);
    const seqAll = sequence(mom);
    assert.deepEqual(seqAll.slice(seqAll.lastIndexOf('matchEnd') - 1, seqAll.lastIndexOf('matchEnd') + 1), ['lobby', 'matchEnd']);

    // -- back to the lobby: the host says so, wins reset, chat still works
    kid.send({ t: 'lobby' });
    assert.equal((await kid.next('error')).code, 'not_host');
    mom.take('lobby');                                                    // everything up to the results screen has been read
    mom.send({ t: 'lobby' });
    const back = await mom.next('lobby');
    assert.equal(back.phase, 'lobby');
    assert.ok(back.players.every((p) => p.wins === 0));
    assert.equal(back.round.n, 0);
    assert.equal(back.players.length, 7);
    gran.send({ t: 'leave' });
    assert.equal((await gran.closed).code, 1000);
    const afterLeave = await mom.next('lobby', (m) => m.players.length === 6);
    assert.ok(!afterLeave.players.some((p) => p.id === gran.id));
    assert.equal(app.rooms.size, 1);
  });

  it('wire budget: 4 humans + 4 bots keep snapshots under 1.2 KB on average (p99 4 KB) and a tick far below 16.7 ms', async (t) => {
    const app = await startServer({ port: 0, timeouts: TIMEOUTS, log: quiet, botFactory: wanderBots, seedFn: () => 99 });
    const clients = [];
    after(async () => { for (const c of clients) c.ws.terminate(); await app.close(); });

    const host = await WsClient.create(app.port, 'Host');
    clients.push(host);
    for (const name of ['A', 'B', 'C']) clients.push(await WsClient.join(app.port, host.code, name));
    for (let i = 0; i < 4; i++) host.send({ t: 'addBot', level: 'hard' });
    host.send({ t: 'settings', patch: { rounds: 7, roundTime: 240, mode: 'ffa' } });
    await host.next('lobby', (m) => m.players.length === 8 && m.settings.rounds === 7);
    host.send({ t: 'start' });
    await Promise.all(clients.map((c) => c.next('round')));

    // Every human wanders and bombs a little, as fast as a real client would send: one frame per 50 ms with 3 cmds.
    const rng = makeRng(5);
    const seqs = clients.map(() => 0);
    const dirs = clients.map(() => 0);
    let frameNo = 0;
    const driver = setInterval(() => {
      if (frameNo++ % 8 === 0) dirs.forEach((_, i) => { dirs[i] = rng.int(5); });
      clients.forEach((c, i) => {
        if (c.ws.readyState !== 1) return;
        c.send({ t: 'in', c: [[++seqs[i], dirs[i], rng.next() < 0.01 ? 1 : 0, 0], [++seqs[i], dirs[i], 0, 0], [++seqs[i], dirs[i], 0, 0]] });
      });
    }, 50);
    after(() => clearInterval(driver));

    await host.next('snap', (m) => m.st === 1);
    await host.next('snap', (m) => m.st === 1 && m.k >= 360);            // 3 s of live play
    clearInterval(driver);

    const sizes = clients.flatMap((c) => c.frames.filter((f) => f.msg.t === 'snap' && f.msg.st === 1).map((f) => f.bytes)).sort((a, b) => a - b);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const p99 = sizes[Math.floor(sizes.length * 0.99)];
    const s = await stats(app.port);
    t.diagnostic(`${sizes.length} live snapshots: mean ${mean.toFixed(0)} B, p99 ${p99} B, max ${sizes.at(-1)} B; server tick avg ${s.tickMs.avg} ms, p99 ${s.tickMs.p99} ms, max ${s.tickMs.max} ms`);
    assert.ok(sizes.length > 200, `${sizes.length} snapshots`);
    assert.ok(mean <= 1200, `mean ${mean}`);
    assert.ok(p99 <= 4096, `p99 ${p99}`);

    assert.equal(s.rooms, 1);
    assert.equal(s.players, 8);
    assert.equal(s.humans, 4);
    assert.equal(s.conns, 4);
    assert.ok(s.tickMs.avg > 0 && s.tickMs.avg < 2, `avg ${s.tickMs.avg}`);
    assert.ok(s.tickMs.p99 < 4, `p99 ${s.tickMs.p99}`);
    assert.equal(s.droppedTicks, 0);
    assert.ok(!JSON.stringify(s).includes(host.code), 'stats never include room codes');
  });

  it('a spectator who joins mid-match gets the live round and snapshots, and can chat', async () => {
    const app = await startServer({ port: 0, timeouts: TIMEOUTS, log: quiet, botFactory: flowBots });
    const clients = [];
    after(async () => { for (const c of clients) c.ws.terminate(); await app.close(); });
    const host = await WsClient.create(app.port, 'Host');
    clients.push(host);
    host.send({ t: 'addBot', level: 'normal' });
    await host.next('lobby', (m) => m.players.length === 2);
    host.send({ t: 'start' });
    await host.next('round');
    await host.next('snap', (m) => m.k >= 30);

    const late = await WsClient.join(app.port, host.code, 'Late');
    clients.push(late);
    const round = await late.next('round');
    assert.ok(round.serverTick >= 30, 'the live tick');
    assert.ok(!round.players.some((p) => p.id === late.id));
    const full = await late.next('snap', (m) => 'g' in m);
    assert.equal(full.g.length, 195);
    assert.equal((await late.next('lobby')).players.find((p) => p.id === late.id).waiting, true);
    late.send({ t: 'chat', text: 'spectating' });
    assert.equal((await host.next('chat')).text, 'spectating');
    late.send({ t: 'in', c: [[1, 2, 1, 0]] });
    late.send({ t: 'sync' });
    const synced = await late.next('snap', (m) => 'g' in m && m.e.length === 0);
    assert.equal(synced.ack[late.id], undefined, 'spectators have no ack entry');
  });
});
