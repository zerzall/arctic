import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { WsClient, delay, eventually } from '../helpers/ws-client.js';

// Reconnect, grace, host migration, kick/ban and lock over real sockets. Deadlines are shortened through `timeouts`
// (grace 1.5 s in the lobby, 0.8 s in a match, host hand-over after 0.5 s) so the specs never wait long.

const TIMEOUTS = {
  HELLO_MS: 300, PING_MS: 200, DEAD_MS: 600, GRACE_LOBBY_MS: 1500, GRACE_MATCH_MS: 800, HOST_MIGRATE_MS: 500, EMPTY_CLOSE_MS: 600,
};

const idleBots = () => ({ think: () => ({ d: 0, b: 0, x: 0 }) });

/** Starts a server and registers cleanup: every client made through `open` is terminated when the test ends. */
async function harness(t, extra = {}) {
  const app = await startServer({ port: 0, timeouts: TIMEOUTS, log: () => {}, botFactory: idleBots, ...extra });
  const clients = [];
  t.after(async () => { for (const c of clients) c.ws.terminate(); await app.close(); });
  const track = (c) => { clients.push(c); return c; };
  return {
    app,
    create: async (name) => track(await WsClient.create(app.port, name)),
    join: async (code, name, opts) => track(await WsClient.join(app.port, code, name, opts)),
    raw: async (opts) => track(await WsClient.connect(app.port, opts)),
  };
}

const lobbyWith = (c, pred) => c.next('lobby', pred);
const playerRow = (lobby, id) => lobby.players.find((p) => p.id === id);

describe('integration: reconnect', () => {
  it('a dropped player rejoins with its token: same id, same colour, same room, still connected for everyone else', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    const before = (await lobbyWith(guest, (m) => m.players.length === 2)).players.find((p) => p.id === guest.id);

    await guest.drop();
    const gone = await lobbyWith(host, (m) => playerRow(m, guest.id)?.connected === false);
    assert.equal(gone.hostId, host.id);
    assert.equal(playerRow(gone, guest.id).name, 'Dad', 'the slot is kept during the grace period');

    const back = await h.join(host.code, 'whoever', { token: guest.token });
    assert.deepEqual([back.id, back.token, back.joined.seq], [guest.id, guest.token, 0]);
    const lobby = await lobbyWith(back, (m) => m.players.length === 2);
    assert.deepEqual(playerRow(lobby, guest.id), { ...before, connected: true });
    assert.equal(playerRow(await lobbyWith(host, (m) => playerRow(m, guest.id)?.connected === true), guest.id).name, 'Dad');
    assert.equal(h.app.rooms.size, 1);
  });

  it('a lone host who was away is still host of the same room; past the grace period the entry (and later the room) is gone', async (t) => {
    const h = await harness(t);
    const host = await h.create('Solo');
    await host.drop();
    await delay(700);                                                    // well inside the 1.5 s grace
    const back = await h.join(host.code, 'x', { token: host.token });
    const lobby = await lobbyWith(back, (m) => m.players.length === 1);
    assert.deepEqual([back.id, lobby.hostId, lobby.players[0].connected], [host.id, host.id, true]);
    assert.equal(h.app.rooms.size, 1);

    await back.drop();
    await eventually(() => h.app.rooms.size === 0, { timeout: 4000, label: 'the empty room to close' });
    const late = await h.raw();
    late.send({ t: 'join', v: 1, code: host.code, name: 'x', token: host.token });
    assert.equal((await late.next('error')).code, 'no_room');
    assert.equal((await late.closed).code, 1000);
  });

  it('a second socket with the same token replaces the first (4001) and the old socket\'s late close changes nothing', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    await lobbyWith(host, (m) => m.players.length === 2);
    host.take();

    const second = await h.join(host.code, 'Dad again', { token: guest.token });
    const closed = await guest.closed;
    assert.deepEqual(closed, { code: 4001, reason: 'replaced' });
    assert.equal(second.id, guest.id);
    await delay(200);                                                   // the old socket's close has reached the server by now
    const lobbies = host.take('lobby');
    assert.ok(lobbies.length >= 1);
    assert.ok(lobbies.every((m) => playerRow(m, guest.id).connected === true), 'never shown as disconnected');
    second.send({ t: 'chat', text: 'still me' });
    assert.equal((await host.next('chat')).text, 'still me');
    assert.equal(h.app.rooms.size, 1);
  });

  it('a token join into a running match replays joined, lobby, the LIVE round and a full snapshot; the seq carries on', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    host.send({ t: 'addBot', level: 'normal' });
    host.send({ t: 'settings', patch: { theme: 'lava' } });
    await lobbyWith(host, (m) => m.players.length === 3 && m.settings.theme === 'lava');
    host.send({ t: 'start' });
    await guest.next('round');
    await guest.next('snap', (m) => m.st === 1);
    guest.send({ t: 'in', c: [[1, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0]] });
    await guest.next('snap', (m) => m.ack[guest.id] === 3);

    await guest.drop();
    await lobbyWith(host, (m) => playerRow(m, guest.id)?.connected === false);
    const back = await h.join(host.code, 'x', { token: guest.token });
    assert.equal(back.joined.seq, 3, 'the client resumes counting from what the server accepted');
    assert.equal((await back.next('lobby')).phase, 'match');
    const round = await back.next('round');
    assert.equal(round.theme, 'lava');
    assert.ok(round.serverTick > 0, 'the round is live, not restarted');
    assert.ok(round.players.some((p) => p.id === guest.id), 'still a fighter');
    const full = await back.next('snap', (m) => 'g' in m);
    assert.equal(full.g.length, 195, 'a full snapshot with the grid');

    back.send({ t: 'in', c: [[4, 0, 0, 0]] });
    assert.equal((await back.next('snap', (m) => m.ack[guest.id] === 4)).ack[guest.id], 4);
  });

  it('after the grace period a stale token is a fresh join: new id, new token, waiting spectator in a match', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    host.send({ t: 'addBot', level: 'normal' });
    await lobbyWith(host, (m) => m.players.length === 3);
    host.send({ t: 'start' });
    await guest.next('round');
    await guest.drop();
    await lobbyWith(host, (m) => m.players.length === 2 && !m.players.some((p) => p.id === guest.id));   // grace (0.8 s) expired: removed
    const back = await h.join(host.code, 'Dad', { token: guest.token });
    assert.notEqual(back.id, guest.id);
    assert.notEqual(back.token, guest.token);
    const lobby = await back.next('lobby');
    assert.equal(playerRow(lobby, back.id).waiting, true);
    assert.ok(!(await back.next('round')).players.some((p) => p.id === back.id));
  });

  it('host migration: after the hand-over delay another connected human is host; the returning ex-host is an ordinary player', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const dad = await h.join(host.code, 'Dad');
    const kid = await h.join(host.code, 'Kid');
    await lobbyWith(kid, (m) => m.players.length === 3);
    await host.drop();
    const moved = await lobbyWith(kid, (m) => m.hostId !== host.id);
    assert.equal(moved.hostId, dad.id, 'the oldest-joined connected human');
    assert.equal((await kid.next('sys', (m) => m.text === 'Dad is now the host')).text, 'Dad is now the host');
    const back = await h.join(host.code, 'Mom', { token: host.token });
    const lobby = await lobbyWith(back, (m) => m.players.length === 3);
    assert.equal(lobby.hostId, dad.id);
    assert.equal(playerRow(lobby, host.id).isHost, false);
    back.send({ t: 'start' });
    assert.equal((await back.next('error')).code, 'not_host');
  });

  it('a host who leaves on purpose hands over at once', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const dad = await h.join(host.code, 'Dad');
    await lobbyWith(dad, (m) => m.players.length === 2);
    host.send({ t: 'leave' });
    await host.closed;
    const lobby = await lobbyWith(dad, (m) => m.players.length === 1);
    assert.equal(lobby.hostId, dad.id);
  });

  it('kick: the target hears `kicked` and is closed; its token is refused with `kicked`, a fresh join is fine', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    const other = await h.join(host.code, 'Kid');
    other.send({ t: 'kick', id: guest.id });
    assert.equal((await other.next('error')).code, 'not_host');
    host.send({ t: 'kick', id: guest.id });
    assert.deepEqual(await guest.next('kicked'), { t: 'kicked' });
    await guest.closed;
    await lobbyWith(host, (m) => m.players.length === 2);

    const retry = await h.raw();
    retry.send({ t: 'join', v: 1, code: host.code, name: 'Dad', token: guest.token });
    assert.equal((await retry.next('error')).code, 'kicked');
    assert.equal((await retry.closed).code, 1000);
    const fresh = await h.join(host.code, 'Dad');
    assert.notEqual(fresh.id, guest.id);
  });

  it('locked rooms refuse strangers with `locked` but let a token holder back in', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    host.send({ t: 'settings', patch: { locked: true } });
    await lobbyWith(host, (m) => m.settings.locked === true);
    const stranger = await h.raw();
    stranger.send({ t: 'join', v: 1, code: host.code, name: 'Eve' });
    assert.equal((await stranger.next('error')).code, 'locked');
    await stranger.closed;
    await guest.drop();
    const back = await h.join(host.code, 'Dad', { token: guest.token });
    assert.equal(back.id, guest.id);
  });

  it('errors that end a join are followed by a close: no_room for an unknown or malformed code, full for a full room', async (t) => {
    const h = await harness(t);
    for (const code of ['BBBB', 'nope', 'ZZZZZZZZZZ', 'A1B2']) {
      const c = await h.raw();
      c.send({ t: 'join', v: 1, code, name: 'x' });
      assert.equal((await c.next('error')).code, 'no_room', code);
      assert.equal((await c.closed).code, 1000);
    }
    const host = await h.create('H0');
    for (let i = 1; i < 8; i++) await h.join(host.code, `H${i}`);
    const late = await h.raw();
    late.send({ t: 'join', v: 1, code: host.code, name: 'Late' });
    const err = await late.next('error');
    assert.deepEqual([err.code, typeof err.msg], ['full', 'string']);
    await late.closed;
  });

  it('a peer that stops answering pings is dropped after DEAD_MS and shows as disconnected', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const mute = await WsClient.connect(h.app.port, { autoPong: false });
    mute.send({ t: 'join', v: 1, code: host.code, name: 'Mute' });
    await mute.expectJoined();
    await lobbyWith(host, (m) => m.players.length === 2 && m.players[1].connected);
    const gone = await lobbyWith(host, (m) => m.players.length === 2 && m.players[1].connected === false);
    assert.equal(gone.players[1].name, 'Mute');
    await mute.closed;
  });
});
