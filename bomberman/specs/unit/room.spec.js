import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Room, roundSeed, errorFrame } from '../../shared/room.js';
import { makeRng } from '../../shared/rng.js';
import { STATE, SETTINGS_DEFS, TIMEOUTS, MAX_PLAYERS, INPUT_QUEUE_MAX, OVER_HOLD_TICKS, COUNTDOWN_TICKS } from '../../shared/constants.js';
import { FakeConn } from '../helpers/fake-conn.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { makeRoom, joinN, say, tick, ticks, runUntil, startMatch, idleBots, wanderBots, TICK_MS } from '../helpers/room-fixtures.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.example.json`, import.meta.url), 'utf8'));
/** The key structure of a message: nested keys sorted, arrays reduced to their first element, values ignored. */
const shape = (v) => (Array.isArray(v) ? [v.length ? shape(v[0]) : null] : v !== null && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])])) : 'value');
const lobbyOf = (c) => c.last('lobby');
const playerOf = (c, id) => lobbyOf(c).players.find((p) => p.id === id);
const errorsOf = (c) => c.msgs('error').map((m) => m.code);
const sysOf = (c) => c.msgs('sys').map((m) => m.text);
const inFrame = (room, conn, ...cmds) => say(room, conn, { t: 'in', c: cmds });
const entryOf = (room, conn) => room._byId.get(conn.id);
const playing = (room) => room.world?.state === STATE.PLAYING;

/** 'easy' bots plant one bomb on their spawn tile and stay: a reliable, deterministic way to lose a round. */
const suicideBots = ({ level }) => {
  let fired = false;
  return { think: () => { const b = fired ? 0 : 1; fired = true; return { d: 0, b, x: 0 }; } };
};
const lazyBots = ({ level }) => (level === 'easy' ? suicideBots({ level }) : idleBots());

/** Room with `humans` joined and, optionally, a started match. */
function setup({ humans = 2, bots = 0, start = false, settings = {}, ...opts } = {}) {
  const room = makeRoom(opts);
  const conns = joinN(room, humans);
  if (start) startMatch(room, conns, { bots, settings });
  else {
    for (let i = 0; i < bots; i++) say(room, conns[0], { t: 'addBot', level: 'easy' });
    if (Object.keys(settings).length) say(room, conns[0], { t: 'settings', patch: settings });
  }
  return { room, conns, host: conns[0] };
}

const compressSnaps = (types) => types.filter((t, i) => t !== 'snap' || types[i - 1] !== 'snap');

// ---- Joining, names, colours ---------------------------------------------------------------------

test('join: the first human is host; joined and lobby carry exactly the specified fields', () => {
  const room = makeRoom({ code: 'KQXZ', build: '9.9.9' });
  const c = new FakeConn();
  const res = room.join(c, { name: 'Mom' });
  assert.deepEqual({ ok: res.ok, id: res.id, resumed: res.resumed }, { ok: true, id: 0, resumed: false });
  assert.match(res.token, /^[0-9a-f]{32}$/);
  assert.deepEqual(c.msgs('joined')[0], { t: 'joined', v: 1, id: 0, token: res.token, code: 'KQXZ', seq: 0, build: '9.9.9' });
  assert.deepEqual(c.types(), ['joined', 'lobby'], 'the Room itself sends joined and lobby before join() returns');

  const lobby = lobbyOf(c);
  assert.deepEqual(shape(lobby), shape(fixture('lobby')), 'same keys as the golden fixture');
  assert.equal(lobby.hostId, 0);
  assert.equal(lobby.you, 0);
  assert.equal(lobby.phase, 'lobby');
  assert.deepEqual(lobby.round, { n: 0, winsNeeded: 3 });
  assert.deepEqual(lobby.settings, Object.fromEntries(Object.entries(SETTINGS_DEFS).map(([k, d]) => [k, d.def])));
  assert.deepEqual(lobby.players[0], { id: 0, name: 'Mom', color: 0, team: 0, isBot: false, level: null, connected: true, isHost: true, wins: 0, waiting: false });
  assert.ok(!('local' in lobby), 'local only appears for Practice');
  const other = new FakeConn();
  room.join(other, { name: 'Ana' });
  assert.ok(!c.sent.join('').includes(other.msgs('joined')[0].token), 'tokens are never broadcast');
  assert.equal(c.sent.join('').split(res.token).length, 2, 'a token appears only in its owner\'s `joined`');
});

test('join: a second human gets its own `you`, the others get lobby and a sys line; ids are never reused', () => {
  const room = makeRoom();
  const [a, b] = joinN(room, 2);
  assert.equal(lobbyOf(b).you, 1);
  assert.equal(lobbyOf(a).you, 0);
  assert.deepEqual(lobbyOf(a).players.map((p) => p.id), [0, 1]);
  assert.deepEqual(sysOf(a), ['P2 joined']);
  assert.deepEqual(sysOf(b), [], 'the joiner is not told about itself');
  say(room, b, { t: 'leave' });
  const [c] = joinN(room, 1);
  assert.equal(c.id, 2, 'id 1 is not reused');
});

test('local: Practice rooms mark the lobby message', () => {
  const room = makeRoom({ local: true });
  const [c] = joinN(room, 1);
  assert.equal(lobbyOf(c).local, true);
});

test('names: sanitised, "Player N" fallback, duplicates get a suffix after truncation', () => {
  const room = makeRoom();
  const names = ['  Ana  ', '', 'ana', 'ANA', '‮evil​', 'A very very long name indeed', 'A very very long name indeed'];
  const conns = names.map((name) => { const c = new FakeConn(); const r = room.join(c, { name }); c.id = r.id; return c; });
  const got = lobbyOf(conns[0]).players.map((p) => p.name);
  assert.deepEqual(got.slice(0, 5), ['Ana', 'Player 2', 'ana 2', 'ANA 3', 'evil']);
  assert.equal(got[5], 'A very very lo');
  assert.equal(got[6], 'A very very lo 2', 'the suffix comes after truncation, so a name may exceed MAX_NAME by 2');
});

test('names: an undefined name and a missing options object still join', () => {
  const room = makeRoom();
  const c = new FakeConn();
  assert.equal(room.join(c).ok, true);
  assert.equal(lobbyOf(c).players[0].name, 'Player 1');
});

test('colours: unique among entries; a requested free colour is honoured, a taken one falls back to the lowest free', () => {
  const room = makeRoom();
  const mk = (color) => { const c = new FakeConn(); const r = room.join(c, { name: `c${color}`, color }); c.id = r.id; return c; };
  const a = mk(5);
  mk(5);
  const c = mk(undefined);
  const players = lobbyOf(a).players;
  assert.deepEqual(players.map((p) => p.color), [5, 0, 1]);
  say(room, c, { t: 'profile', color: 5 });
  assert.equal(playerOf(c, c.id).color, 1, 'a profile request for a taken colour is ignored');
  say(room, c, { t: 'profile', color: 7 });
  assert.equal(playerOf(c, c.id).color, 7);
});

test('teams: a new entry joins the team with fewer entries; ties go to fewer team wins, then team 0', () => {
  const room = makeRoom();
  const conns = joinN(room, 4);
  assert.deepEqual(lobbyOf(conns[0]).players.map((p) => p.team), [0, 1, 0, 1]);
  const teamOfFirstJoiner = (teamWins) => {
    const r = makeRoom();
    r.teamWins = teamWins;
    const [c] = joinN(r, 1);
    return lobbyOf(c).players[0].team;
  };
  assert.equal(teamOfFirstJoiner([2, 0]), 1, 'equal counts: the team with fewer wins takes the newcomer');
  assert.equal(teamOfFirstJoiner([0, 2]), 0);
  assert.equal(teamOfFirstJoiner([1, 1]), 0, 'equal counts and wins: team 0');
});

// ---- Capacity, locking, spectators -----------------------------------------------------------------

test('capacity: a human evicts the most recently added bot in the lobby; without a bot the room is full', () => {
  const { room, conns } = setup({ humans: 1 });
  for (let i = 0; i < 7; i++) say(room, conns[0], { t: 'addBot', level: 'normal' });
  assert.equal(room.entries.length, MAX_PLAYERS);
  say(room, conns[0], { t: 'addBot', level: 'normal' });
  assert.equal(room.entries.length, MAX_PLAYERS, 'addBot on a full room is ignored');
  const lastBot = lobbyOf(conns[0]).players.at(-1);
  const guest = new FakeConn();
  const res = room.join(guest, { name: 'Grandma' });
  assert.equal(res.ok, true);
  assert.equal(room.entries.length, MAX_PLAYERS);
  assert.ok(!room._byId.has(lastBot.id));
  assert.ok(sysOf(conns[0]).includes(`${lastBot.name} made room for Grandma`));
  assert.equal(lobbyOf(guest).players.filter((p) => !p.isBot).length, 2);

  for (let i = 0; i < 6; i++) assert.equal(room.join(new FakeConn(), { name: `H${i}` }).ok, true, 'each newcomer evicts one more bot');
  assert.equal(room.entries.filter((e) => !e.isBot).length, MAX_PLAYERS);
  assert.deepEqual(room.join(new FakeConn(), { name: 'Late' }), { ok: false, error: 'full' });
});

test('capacity: a full room of humans answers `full`, and a match never evicts', () => {
  const { room } = setup({ humans: 8 });
  assert.deepEqual(room.join(new FakeConn(), { name: 'x' }), { ok: false, error: 'full' });
  const m = setup({ humans: 4, bots: 4, start: true });
  assert.deepEqual(m.room.join(new FakeConn(), { name: 'x' }), { ok: false, error: 'full' });
  assert.equal(m.room.entries.filter((e) => e.isBot).length, 4, 'nobody was evicted mid-match');
});

test('locked: a fresh join is refused, a token join still resumes', () => {
  const { room, conns, host } = setup({ humans: 2 });
  say(room, host, { t: 'settings', patch: { locked: true } });
  assert.equal(lobbyOf(host).settings.locked, true);
  assert.deepEqual(room.join(new FakeConn(), { name: 'Stranger' }), { ok: false, error: 'locked' });
  const back = new FakeConn();
  const res = room.join(back, { name: 'P2', token: conns[1].token });
  assert.deepEqual({ ok: res.ok, resumed: res.resumed, id: res.id }, { ok: true, resumed: true, id: conns[1].id });
});

test('closed: join on a closed room says so', () => {
  const room = makeRoom();
  room.close();
  assert.deepEqual(room.join(new FakeConn(), { name: 'x' }), { ok: false, error: 'closed' });
});

test('errorFrame: the exact JSON of an error frame', () => {
  assert.deepEqual(JSON.parse(errorFrame('full')), { t: 'error', code: 'full', msg: 'That room is full.' });
  assert.deepEqual(JSON.parse(errorFrame('x', 'custom')), { t: 'error', code: 'x', msg: 'custom' });
});

// ---- Settings, bots, profile -----------------------------------------------------------------------

test('settings: host only, validated per key, lobby re-sent only when something changed', () => {
  const { room, conns, host } = setup({ humans: 2 });
  const [, guest] = conns;
  say(room, guest, { t: 'settings', patch: { rounds: 5 } });
  assert.deepEqual(errorsOf(guest), ['not_host']);
  host.clear();
  say(room, host, { t: 'settings', patch: { rounds: 5, roundTime: 90, theme: 'lava', bogus: 1 } });
  assert.deepEqual(lobbyOf(host).settings, { ...lobbyOf(host).settings, rounds: 5, roundTime: 90, theme: 'lava' });
  assert.ok(!('bogus' in lobbyOf(host).settings));
  host.clear();
  say(room, host, { t: 'settings', patch: { rounds: 5 } });
  say(room, host, { t: 'settings', patch: {} });
  assert.deepEqual(host.types(), [], 'no change, no lobby');
  say(room, host, { t: 'settings', patch: { rounds: 4 } });
  assert.deepEqual(host.types(), [], 'an invalid value is dropped per key');
});

test('settings: switching to teams sets team = index % 2 by entry order', () => {
  const { room, host } = setup({ humans: 3, bots: 2 });
  say(room, host, { t: 'settings', patch: { mode: 'teams' } });
  assert.deepEqual(lobbyOf(host).players.map((p) => p.team), [0, 1, 0, 1, 0]);
});

test('bots: names come from BOT_NAMES in order, colours are the lowest free, the host edits them, removeBot ignores humans', () => {
  const { room, conns, host } = setup({ humans: 2 });
  const guest = conns[1];
  say(room, host, { t: 'addBot', level: 'hard' });
  say(room, host, { t: 'addBot', level: 'easy' });
  const bots = lobbyOf(host).players.filter((p) => p.isBot);
  assert.deepEqual(bots.map((b) => [b.name, b.level, b.color, b.connected]), [['Bolt', 'hard', 2, true], ['Fuse', 'easy', 3, true]]);
  say(room, guest, { t: 'addBot', level: 'easy' });
  assert.deepEqual(errorsOf(guest), ['not_host']);

  say(room, host, { t: 'profile', id: bots[0].id, name: 'Robo', color: 6, team: 1 });
  assert.deepEqual(lobbyOf(host).players.find((p) => p.id === bots[0].id), { ...bots[0], name: 'Robo', color: 6, team: 1 });
  say(room, guest, { t: 'profile', id: bots[1].id, name: 'Hacked' });
  assert.equal(lobbyOf(guest).players.find((p) => p.id === bots[1].id).name, 'Fuse', 'only the host edits bots');
  say(room, host, { t: 'profile', id: guest.id, name: 'Nope' });
  assert.equal(lobbyOf(host).players.find((p) => p.id === guest.id).name, 'P2', 'the id form never edits a human');

  say(room, host, { t: 'removeBot', id: guest.id });
  assert.ok(room._byId.has(guest.id), 'removeBot on a human is ignored');
  say(room, host, { t: 'removeBot', id: bots[0].id });
  assert.ok(!room._byId.has(bots[0].id));
  say(room, host, { t: 'addBot', level: 'easy' });
  assert.equal(lobbyOf(host).players.at(-1).name, 'Bolt', 'the first unused bot name is reused');
});

test('profile: self name change works, rate limited to 4 per 2 s, and colour/team edits wait for the lobby', () => {
  const { room, conns } = setup({ humans: 2, bots: 0 });
  const guest = conns[1];
  for (let i = 0; i < 6; i++) say(room, guest, { t: 'profile', name: `N${i}` });
  assert.equal(playerOf(guest, guest.id).name, 'N3', 'the 5th and 6th requests inside 2 s are dropped silently');
  assert.deepEqual(errorsOf(guest), []);
  room.clock.advance(2001);
  say(room, guest, { t: 'profile', name: 'Later' });
  assert.equal(playerOf(guest, guest.id).name, 'Later');
});

// ---- Start, phases, round message ---------------------------------------------------------------------

test('start: errors in the order not_host, bad_phase, need_players, need_teams; a lone human may start with a bot', () => {
  const { room, host } = setup({ humans: 1 });
  say(room, host, { t: 'start' });
  assert.deepEqual(errorsOf(host), ['need_players']);
  const room2 = makeRoom();
  const [h2, g2] = joinN(room2, 2);
  say(room2, g2, { t: 'start' });
  assert.deepEqual(errorsOf(g2), ['not_host']);
  say(room2, h2, { t: 'settings', patch: { mode: 'teams' } });
  say(room2, h2, { t: 'profile', team: 1 });
  say(room2, g2, { t: 'profile', team: 1 });
  say(room2, h2, { t: 'start' });
  assert.deepEqual(errorsOf(h2), ['need_teams']);
  say(room2, h2, { t: 'profile', team: 0 });
  say(room2, h2, { t: 'start' });
  assert.equal(room2.phase, 'match');
  say(room2, h2, { t: 'start' });
  assert.equal(errorsOf(h2).at(-1), 'bad_phase');
  say(room, host, { t: 'addBot', level: 'easy' });
  say(room, host, { t: 'start' });
  assert.equal(room.phase, 'match');
});

test('start: waiting friends in grace do not count towards need_players', () => {
  const { room, conns, host } = setup({ humans: 2 });
  room.disconnect(conns[1].id, conns[1]);
  say(room, host, { t: 'start' });
  assert.deepEqual(errorsOf(host), ['need_players']);
  assert.equal(room.phase, 'lobby');
});

test('start: messages are lobby, round, full snap; the round message matches the golden shape and the snapshot order', () => {
  const { room, host, conns } = setup({ humans: 2, bots: 2, start: true });
  const types = host.types().slice(-3);
  assert.deepEqual(types.slice(0, 2), ['lobby', 'round']);
  const round = host.last('round');
  assert.deepEqual(shape(round), shape(fixture('round')));
  assert.equal(round.n, 1);
  assert.equal(round.grid.length, 195);
  assert.equal(round.serverTick, 0);
  assert.equal(round.seed, roundSeed(room.seed, 1));
  assert.match(round.theme, /^(meadow|frost|lava|candy|night)$/);
  assert.equal(round.roundTime, 120);
  assert.equal(round.winsNeeded, 3);
  const snap = host.last('snap');
  assert.equal(snap.g, round.grid, 'the first snapshot is unicast-style: with the grid, without events');
  assert.deepEqual(snap.e, []);
  assert.deepEqual(snap.p.map((row) => row[0]), round.players.map((p) => p.id), 'round.players is in snapshot order');
  assert.deepEqual(Object.keys(snap.ack), conns.map((c) => String(c.id)), 'ack lists humans only');
  assert.equal(lobbyOf(host).phase, 'match');
  assert.deepEqual(lobbyOf(host).round, { n: 1, winsNeeded: 3 });
  for (const p of round.players) {
    assert.equal(p.x % 1, 0.5);
    assert.equal(p.y % 1, 0.5);
  }
});

test('start: theme "random" resolves to a concrete theme from a separate seeded stream, a fixed theme is kept', () => {
  const a = setup({ humans: 1, bots: 1, start: true });
  const theme = a.host.last('round').theme;
  assert.equal(theme, makeRng((roundSeed(a.room.seed, 1) ^ 0xA5A5A5A5) >>> 0).pick(['meadow', 'frost', 'lava', 'candy', 'night']));
  const b = setup({ humans: 1, bots: 1, start: true, settings: { theme: 'candy' } });
  assert.equal(b.host.last('round').theme, 'candy');
});

test('start: a match is deterministic given seed, clock and inputs', () => {
  const run = () => {
    const { room, host } = setup({ humans: 2, bots: 2, start: true, seed: 42, botFactory: wanderBots });
    ticks(room, 700);
    return host.sent;
  };
  assert.deepEqual(run(), run());
});

test('roundSeed: distinct per round, a pure function of the room seed', () => {
  assert.notEqual(roundSeed(7, 1), roundSeed(7, 2));
  assert.equal(roundSeed(7, 3), (7 + Math.imul(3, 0x9E3779B1)) >>> 0);
  assert.equal(roundSeed(0xFFFFFFFF, 1) >>> 0, roundSeed(0xFFFFFFFF, 1));
});

test('phase gating: settings, bots, team and colour are ignored in a match; name, chat, emote and leave still work', () => {
  const { room, host, conns } = setup({ humans: 2, bots: 1, start: true });
  const guest = conns[1];
  const before = JSON.stringify(lobbyOf(host));
  say(room, host, { t: 'settings', patch: { rounds: 7 } });
  say(room, host, { t: 'addBot', level: 'easy' });
  say(room, host, { t: 'removeBot', id: room.entries.find((e) => e.isBot).id });
  say(room, guest, { t: 'profile', color: 7, team: 1 });
  assert.equal(JSON.stringify(lobbyOf(host)), before);
  say(room, guest, { t: 'profile', name: 'Renamed' });
  assert.equal(playerOf(host, guest.id).name, 'Renamed');
  say(room, guest, { t: 'chat', text: 'hello' });
  assert.equal(host.last('chat').text, 'hello');
  say(room, guest, { t: 'emote', e: 3 });
  assert.deepEqual(host.last('emote'), { t: 'emote', from: guest.id, e: 3 });
});

// ---- Snapshot broadcast, events, sync ------------------------------------------------------------------

test('broadcast: a snapshot every 3rd tick with a monotonic k; nothing after OVER', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  host.clear();
  ticks(room, 30);
  const ks = host.msgs('snap').map((s) => s.k);
  assert.deepEqual(ks, [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  assert.ok(host.msgs('snap').every((s) => s.t === 'snap'));
});

test('broadcast: `g` rides along iff the grid version changed or on every 60th tick; sync does not disturb the cursors', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  host.clear();
  ticks(room, 120);
  const withGrid = host.msgs('snap').filter((s) => 'g' in s).map((s) => s.k);
  assert.deepEqual(withGrid, [60, 120]);

  const w = room.world;
  const idx = w.grid.findIndex((c, i) => c === '+' && i > 40);
  host.clear();
  w.grid[idx] = '.';
  w.gridVer++;
  ticks(room, 3);
  const changed = host.msgs('snap');
  assert.equal(changed.length, 1);
  assert.equal(changed[0].g[idx], '.');
  host.clear();
  ticks(room, 3);
  assert.ok(!('g' in host.msgs('snap')[0]), 'not repeated once sent');

  host.clear();
  w._emit('sdstart');
  say(room, host, { t: 'sync' });
  const unicast = host.last('snap');
  assert.equal(unicast.g.length, 195);
  assert.deepEqual(unicast.e, [], 'a unicast snapshot carries no events');
  ticks(room, 3);
  assert.deepEqual(host.msgs('snap').at(-1).e, [['sdstart']], 'sync did not steal the event from the next broadcast');
});

test('events: every event reaches the broadcast stream exactly once, in order', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: suicideBots });
  const events = [];
  const track = () => { for (const s of host.msgs('snap')) events.push(...s.e); host.clear(); };
  for (let i = 0; i < 400; i++) { tick(room); if (i % 30 === 0) track(); }
  track();
  assert.equal(events.length, room.world.evCount, 'no event lost, none duplicated');
  assert.equal(events[0][0], 'go');
  assert.ok(events.some((e) => e[0] === 'bomb'));
});

test('events: with nobody connected the events are dropped instead of piling up', () => {
  const { room, conns } = setup({ humans: 1, bots: 1, start: true, botFactory: suicideBots });
  room.disconnect(conns[0].id, conns[0]);
  ticks(room, 400);
  assert.equal(room.world._events.length, 0);
});

test('sync: match phase only, at most once a second', () => {
  const { room, host } = setup({ humans: 1, bots: 0 });
  say(room, host, { t: 'sync' });
  assert.deepEqual(host.msgs('snap'), [], 'no snapshot outside a match');
  say(room, host, { t: 'addBot', level: 'easy' });
  say(room, host, { t: 'start' });
  room.clock.advance(1001);
  host.clear();
  say(room, host, { t: 'sync' });
  say(room, host, { t: 'sync' });
  assert.equal(host.msgs('snap').length, 1);
  room.clock.advance(1001);
  say(room, host, { t: 'sync' });
  assert.equal(host.msgs('snap').length, 2);
});

// ---- Input queue -----------------------------------------------------------------------------------------

/** Counts what World.applyCmd receives for `id` (the queue's observable output). */
function spyApplied(room, id) {
  const applied = [];
  const real = room.world.applyCmd.bind(room.world);
  room.world.applyCmd = (pid, cmd) => { if (pid === id) applied.push({ ...cmd }); real(pid, cmd); };
  return applied;
}

test('input: 1.000 cmds per tick at 66 cmds/s (a speed hack gains nothing beyond the catch-up credit)', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  const applied = spyApplied(room, host.id);
  let seq = 0;
  const N = 1200;
  for (let t = 0; t < N; t++) {
    const due = Math.floor(((t + 1) * 66) / 60) - seq;
    if (due > 0) {
      const cmds = [];
      for (let i = 0; i < due; i++) cmds.push([++seq, 0, 0, 0]);
      inFrame(room, host, ...cmds);
    }
    tick(room);
  }
  assert.ok(applied.length <= N + 12 && applied.length >= N - 2, `applied ${applied.length} of ${N} ticks`);
  assert.ok(entryOf(room, host).q.length <= INPUT_QUEUE_MAX);
  assert.deepEqual(applied.map((c) => c.s), [...applied.map((c) => c.s)].sort((a, b) => a - b), 'strictly in seq order');
});

test('input: 60 cmds/s with 60 ms arrival jitter is applied 1:1 and never lags more than a few cmds', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  const applied = spyApplied(room, host.id);
  const rng = makeRng(9);
  const N = 900;
  const schedule = [];
  let at = 0;
  for (let s = 1; s <= N; s++) schedule.push({ s, at: (at = Math.max(at, s + Math.floor(rng.next() * 4))) });   // up to 4 ticks (66 ms) late; TCP keeps order
  let sent = 0;
  for (let t = 1; t <= N; t++) {
    for (const item of schedule) if (item.at === t) { inFrame(room, host, [item.s, 0, 0, 0]); sent++; }
    tick(room);
  }
  assert.ok(sent > N - 10);
  assert.ok(applied.length >= N - 8 && applied.length <= N + 12, `applied ${applied.length}`);
});

test('input: cmds already accepted are dropped in favour of seq order: replays, old seqs and gaps', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  const applied = spyApplied(room, host.id);
  inFrame(room, host, [5, 0, 0, 0], [5, 0, 0, 0], [3, 0, 0, 0], [9, 0, 0, 0]);
  inFrame(room, host, [9, 0, 0, 0], [8, 0, 0, 0]);
  ticks(room, 5);
  assert.deepEqual(applied.map((c) => c.s), [5, 9], 'strictly increasing seq only; gaps are fine');
  assert.equal(entryOf(room, host).lastSeq, 9);
});

test('input: a full queue drops the oldest cmd but keeps its bomb and special taps', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  const cmds = [];
  for (let s = 1; s <= INPUT_QUEUE_MAX; s++) cmds.push([s, 0, s === 1 ? 1 : 0, s === 1 ? 1 : 0]);
  for (let i = 0; i < cmds.length; i += 10) inFrame(room, host, ...cmds.slice(i, i + 10));
  const q = entryOf(room, host).q;
  assert.equal(q.length, INPUT_QUEUE_MAX);
  inFrame(room, host, [INPUT_QUEUE_MAX + 1, 0, 0, 0]);
  assert.equal(q.length, INPUT_QUEUE_MAX);
  assert.equal(q[0].s, 2);
  assert.deepEqual([q[0].b, q[0].x], [1, 1], 'the tap of the dropped cmd moved to the next one');
});

test('input: the last 12 countdown ticks hold cmds; they are applied after GO and each held tick earns catch-up credit', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, (r) => r.world.countdown === 20);
  inFrame(room, host, [1, 0, 0, 0]);
  tick(room);
  assert.equal(room.world.player(host.id).lastSeq, 1, 'before the hold window cmds are consumed (and ignored by the World) so acks flow');
  runUntil(room, (r) => r.world.countdown === 12);
  inFrame(room, host, [2, 3, 0, 0], [3, 3, 0, 0], [4, 3, 0, 0]);
  ticks(room, 11);
  assert.equal(room.world.state, STATE.COUNTDOWN);
  assert.equal(room.world.player(host.id).lastSeq, 1, 'held');
  assert.equal(entryOf(room, host).q.length, 3);
  assert.ok(entryOf(room, host).credit >= 11);
  ticks(room, 2);
  assert.equal(room.world.state, STATE.PLAYING);
  assert.ok(room.world.player(host.id).lastSeq >= 2, 'consumption starts at once after the hold');
});

test('input: the flood guard drops a whole frame when the bucket is short (burst 60, 120 cmds/s)', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  let seq = 0;
  const frame = () => Array.from({ length: 16 }, () => [++seq, 0, 0, 0]);
  for (let i = 0; i < 3; i++) inFrame(room, host, ...frame());       // 48 of 60 tokens
  const acceptedBefore = entryOf(room, host).lastSeq;
  assert.equal(acceptedBefore, 48);
  inFrame(room, host, ...frame());                                   // 16 > 12 left: dropped whole
  assert.equal(entryOf(room, host).lastSeq, 48);
  room.clock.advance(1000);                                          // 120 more tokens, capped at the burst
  inFrame(room, host, ...frame());
  assert.equal(entryOf(room, host).lastSeq, seq);
});

test('input: waiting spectators, bots, unknown ids and stale connections cannot inject cmds', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  const spectator = new FakeConn();
  const j = room.join(spectator, { name: 'Late' });
  spectator.id = j.id;
  assert.equal(entryOf(room, spectator).waiting, true);
  const applied = spyApplied(room, spectator.id);
  inFrame(room, spectator, [1, 2, 1, 0]);
  const stale = new FakeConn();
  room.receive(host.id, JSON.stringify({ t: 'in', c: [[1, 2, 0, 0]] }), stale);
  room.receive(999, JSON.stringify({ t: 'in', c: [[1, 2, 0, 0]] }), stale);
  room.receive(room.entries.find((e) => e.isBot).id, JSON.stringify({ t: 'in', c: [[1, 2, 0, 0]] }), stale);
  ticks(room, 3);
  assert.deepEqual(applied, []);
  assert.equal(entryOf(room, host).lastSeq, 0);
});

test('input: bots think only while PLAYING, once per tick, with their own seq; a throwing bot is muted and logged once', () => {
  const calls = [];
  const logs = [];
  const bots = () => ({ think: (w, id) => { calls.push([w.state, w.tickNo, id]); if (calls.length === 3) throw new Error('boom'); return { d: 3, b: 0, x: 0 }; } });
  const { room } = setup({ humans: 1, bots: 1, start: true, botFactory: bots, log: (...a) => logs.push(a) });
  ticks(room, COUNTDOWN_TICKS + 5);
  assert.ok(calls.every(([state]) => state === STATE.PLAYING));
  assert.equal(calls.length, 5, 'ticks 181..185');
  const bot = room.entries.find((e) => e.isBot);
  assert.equal(bot.botSeq, 5);
  assert.equal(logs.filter(([lvl, ev]) => lvl === 'error' && ev === 'room_error').length, 1);
  assert.equal(room.world.player(bot.id).lastSeq, 5, 'a failed think still stamps a (neutral) cmd');
});

test('bots: the factory gets {level, seed} with the per-round seed of 4.6, a fresh brain every round', () => {
  const made = [];
  const factory = (o) => { made.push(o); return lazyBots(o); };
  const { room } = setup({ humans: 1, bots: 1, start: true, botFactory: factory, settings: { rounds: 2 } });
  const bot = room.entries.find((e) => e.isBot);
  assert.deepEqual(made[0], { level: 'easy', seed: (roundSeed(room.seed, 1) ^ Math.imul(bot.id + 1, 0x85EBCA6B)) >>> 0 });
  runUntil(room, (r) => r.roundNo === 2, 5000);
  assert.equal(made.length, 2);
  assert.notEqual(made[0].seed, made[1].seed);
});

// ---- Rounds, scoring, match end ----------------------------------------------------------------------------

test('round flow: outcome lock sends snap, roundEnd, lobby in that order; the winner scores; OVER hold, then matchEnd', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: suicideBots, settings: { rounds: 1 } });
  runUntil(room, (r) => r.world.outcome);
  const lockTypes = compressSnaps(host.types());
  const at = lockTypes.lastIndexOf('roundEnd');
  assert.deepEqual(lockTypes.slice(at - 1, at + 2), ['snap', 'roundEnd', 'lobby']);
  const end = host.last('roundEnd');
  assert.deepEqual({ ...end, scores: undefined }, { t: 'roundEnd', n: 1, winnerId: host.id, winnerTeam: null, draw: false, reason: 'last', scores: undefined, matchOver: true });
  assert.deepEqual(end.scores, [{ id: host.id, wins: 1, team: 0 }, { id: 1, wins: 0, team: 1 }]);
  assert.equal(lobbyOf(host).players[0].wins, 1, 'the lobby that follows carries the new wins');
  assert.ok(host.msgs('snap').at(-1).e.some((e) => e[0] === 'death'), 'the flushed snapshot carries the final death events');

  const before = host.msgs('matchEnd').length;
  runUntil(room, (r) => r.world.state === STATE.OVER);
  ticks(room, OVER_HOLD_TICKS - 2);
  assert.equal(room.phase, 'match');
  assert.equal(host.msgs('matchEnd').length, before);
  ticks(room, 2);
  assert.equal(room.phase, 'results');
  const tail = host.types().slice(-2);
  assert.deepEqual(tail, ['lobby', 'matchEnd']);
  const me = host.last('matchEnd');
  assert.equal(me.reason, 'wins');
  assert.equal(me.winnerId, host.id);
  assert.equal(me.winnerTeam, null);
  assert.deepEqual(me.standings.map((s) => [s.id, s.wins, s.place]), [[host.id, 1, 1], [1, 0, 2]]);
  assert.deepEqual(Object.keys(me.standings[0]), ['id', 'name', 'color', 'team', 'wins', 'kills', 'deaths', 'selfKills', 'blocks', 'items', 'place']);
  assert.equal(me.standings[1].selfKills, 1);
  assert.equal(me.standings[1].deaths, 1);
  assert.equal(lobbyOf(host).phase, 'results');
});

test('round flow: an undecided match builds the next round after the OVER hold (round, full snap), stats accumulate', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: lazyBots, settings: { rounds: 2 } });
  runUntil(room, (r) => r.roundNo === 2, 5000);
  const types = compressSnaps(host.types());
  assert.deepEqual(types.slice(-3), ['lobby', 'round', 'snap']);
  const r2 = host.last('round');
  assert.equal(r2.n, 2);
  assert.equal(r2.seed, roundSeed(room.seed, 2));
  assert.equal(r2.serverTick, 0);
  assert.equal(room.world.tickNo, 0);
  assert.deepEqual(lobbyOf(host).round, { n: 2, winsNeeded: 2 });
  assert.equal(entryOf(room, { id: 1 }).matchStats.selfKills, 1);
  runUntil(room, (r) => r.phase === 'results', 5000);
  const me = host.last('matchEnd');
  assert.equal(me.standings.find((s) => s.id === 1).selfKills, 2);
  assert.equal(me.standings.find((s) => s.id === 1).deaths, 2);
});

test('round flow: seq is per entry, never reset: acks stay continuous across rounds', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: lazyBots, settings: { rounds: 2 } });
  runUntil(room, playing);
  let seq = 0;
  for (let i = 0; i < 40; i++) { inFrame(room, host, [++seq, 0, 0, 0]); tick(room); }
  entryOf(room, host).q.length = 0;
  inFrame(room, host, [seq + 7, 0, 0, 0]);                          // accepted but never applied before the round ends
  runUntil(room, (r) => r.roundNo === 2, 5000);
  const e = entryOf(room, host);
  assert.equal(e.appliedSeq, e.lastSeq, 'the unapplied backlog is treated as applied at a round boundary');
  assert.equal(room.world.player(host.id).lastSeq, e.lastSeq);
  assert.equal(host.last('snap').ack[host.id], e.lastSeq);
  inFrame(room, host, [e.lastSeq + 1, 0, 0, 0]);
  assert.equal(e.lastSeq, seq + 8, 'the client keeps counting from where it was');
});

test('round flow: a draw awards nothing, and a match with only draws ends at 4x rounds with joint winners', () => {
  const bothBomb = () => ({ think: () => ({ d: 0, b: 1, x: 0 }) });
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: bothBomb, settings: { rounds: 1, roundTime: 60 } });
  runUntil(room, playing);
  inFrame(room, host, [1, 0, 1, 0]);                                // the human plants a bomb on the spawn tile as well
  runUntil(room, (r) => r.world.outcome, 2000);
  assert.equal(room.world.outcome.draw, true);
  assert.equal(host.last('roundEnd').draw, true);
  assert.equal(host.last('roundEnd').matchOver, false);
  assert.deepEqual(host.last('roundEnd').scores.map((s) => s.wins), [0, 0]);
  assert.equal(room.roundsPlayed, 1);
  let round = 1;
  while (room.phase === 'match') {
    round++;
    runUntil(room, (r) => r.phase !== 'match' || (playing(r) && r.roundNo === round), 3000);
    if (room.phase === 'match') { inFrame(room, host, [50 * round, 0, 1, 0]); runUntil(room, (r) => r.phase !== 'match' || r.world?.outcome, 3000); }
  }
  assert.equal(room.roundsPlayed, 4, '4 * rounds');
  const me = host.last('matchEnd');
  assert.equal(me.reason, 'cap');
  assert.equal(me.winnerId, null);
  assert.deepEqual(me.standings.map((s) => s.place), [1, 1], 'still tied on wins, kills and deaths: joint winners');
});

test('scoring: match cap tie-breaks are wins, then kills, then fewer deaths', () => {
  const room = makeRoom();
  joinN(room, 3);
  const [a, b, c] = room.entries;
  a.wins = 1; b.wins = 1; c.wins = 0;
  a.matchStats.kills = 2; b.matchStats.kills = 5; c.matchStats.kills = 9;
  assert.deepEqual(room._standings().map((s) => [s.id, s.place]), [[b.id, 1], [a.id, 2], [c.id, 3]]);
  a.matchStats.kills = 5;
  a.matchStats.deaths = 3; b.matchStats.deaths = 1;
  assert.deepEqual(room._standings().map((s) => [s.id, s.place]), [[b.id, 1], [a.id, 2], [c.id, 3]]);
  b.matchStats.deaths = 3;
  assert.deepEqual(room._standings().map((s) => s.place), [1, 1, 3], 'joint places skip the next number');
});

test('teams: a round win scores for the team, every member shows the team wins, standings share a place per team', () => {
  const { room, host } = setup({ humans: 1, bots: 3, start: false, settings: { mode: 'teams', rounds: 1 }, botFactory: lazyBots });
  say(room, host, { t: 'profile', id: 2, team: 1 });
  say(room, host, { t: 'start' });
  assert.equal(room.phase, 'match');
  runUntil(room, (r) => r.world.outcome, 3000);
  const o = room.world.outcome;
  assert.equal(o.winnerId, null);
  const end = host.last('roundEnd');
  assert.equal(end.winnerTeam, o.winnerTeam);
  const wins = lobbyOf(host).players.map((p) => [p.team, p.wins]);
  assert.ok(wins.every(([team, w]) => w === (team === o.winnerTeam ? 1 : 0)), JSON.stringify(wins));
  runUntil(room, (r) => r.phase === 'results', 3000);
  const me = host.last('matchEnd');
  assert.equal(me.winnerId, null);
  assert.equal(me.winnerTeam, o.winnerTeam);
  const places = new Map(me.standings.map((s) => [s.team, new Set()]));
  for (const s of me.standings) places.get(s.team).add(s.place);
  assert.ok([...places.values()].every((set) => set.size === 1), 'teammates share a place');
});

test('results: back to lobby by the host (wins reset, waiting cleared) or automatically after 30 s', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: suicideBots, settings: { rounds: 1 } });
  runUntil(room, (r) => r.phase === 'results', 5000);
  assert.equal(playerOf(host, host.id).wins, 1);
  const guest = new FakeConn();
  const j = room.join(guest, { name: 'Guest' });
  guest.id = j.id;
  assert.deepEqual(guest.types().slice(0, 3), ['joined', 'lobby', 'matchEnd'], 'a results-phase joiner gets the last matchEnd');
  say(room, guest, { t: 'lobby' });
  assert.deepEqual(errorsOf(guest), ['not_host']);
  say(room, guest, { t: 'leave' });
  say(room, host, { t: 'lobby' });
  assert.equal(room.phase, 'lobby');
  assert.equal(playerOf(host, host.id).wins, 0);
  assert.deepEqual(lobbyOf(host).round, { n: 0, winsNeeded: 1 });

  say(room, host, { t: 'start' });
  runUntil(room, (r) => r.phase === 'results', 5000);
  const since = room.clock.now();
  runUntil(room, (r) => r.phase === 'lobby', 3000);
  assert.ok(room.clock.now() - since >= TIMEOUTS.RESULTS_AUTO_MS - 100 && room.clock.now() - since <= TIMEOUTS.RESULTS_AUTO_MS + 100);
});

test('results: "Play again" is host `start` from results and resets everything', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: suicideBots, settings: { rounds: 1 } });
  runUntil(room, (r) => r.phase === 'results', 5000);
  say(room, host, { t: 'start' });
  assert.equal(room.phase, 'match');
  assert.equal(room.roundNo, 1);
  assert.equal(playerOf(host, host.id).wins, 0);
  assert.equal(room.roundsPlayed, 0);
});

test('abort: host `lobby` during a match drops the World, resets wins and says so', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  say(room, host, { t: 'lobby' });
  assert.equal(room.phase, 'lobby');
  assert.equal(room.world, null);
  assert.ok(sysOf(host).includes('Host ended the match'));
  assert.equal(lobbyOf(host).phase, 'lobby');
  host.clear();
  ticks(room, 10);
  assert.deepEqual(host.msgs('snap'), [], 'snapshots stop');
});

// ---- Leavers, waiting, reconnect ---------------------------------------------------------------------------------

test('leaver: leaving mid-round removes the entry, emits `left` only, and the survivor wins the round', () => {
  const { room, host, conns } = setup({ humans: 2, bots: 0, start: false });
  say(room, host, { t: 'addBot', level: 'normal' });
  say(room, host, { t: 'start' });
  runUntil(room, playing);
  const guest = conns[1];
  say(room, guest, { t: 'leave' });
  assert.equal(guest.closed, true);
  assert.equal(guest.closeReason, 'left');
  assert.ok(!room._byId.has(guest.id));
  assert.ok(sysOf(host).includes('P2 left'));
  assert.ok(!lobbyOf(host).players.some((p) => p.id === guest.id), 'its wins disappear with it');
  ticks(room, 3);
  const events = host.msgs('snap').flatMap((s) => s.e);
  assert.deepEqual(events.filter((e) => e[0] === 'left'), [['left', guest.id]]);
  assert.ok(!events.some((e) => e[0] === 'death' && e[1] === guest.id));
  const p = room.world.player(guest.id);
  assert.deepEqual([p.removed, p.alive, p.killer, p.stats.deaths], [true, false, -2, 0]);
});

test('leaver: when the last human leaves the World stops and the room is back in the lobby (no matchEnd)', () => {
  const { room, host } = setup({ humans: 1, bots: 2, start: true });
  runUntil(room, playing);
  say(room, host, { t: 'leave' });
  assert.equal(room.phase, 'lobby');
  assert.equal(room.world, null);
  assert.deepEqual(room.entries.map((e) => e.isBot), [true, true]);
  const closed = [];
  const r2 = makeRoom({ onEmpty: () => closed.push(1) });
  const [h] = joinN(r2, 1);
  say(r2, h, { t: 'leave' });
  ticks(r2, 1);
  r2.clock.advance(TIMEOUTS.EMPTY_CLOSE_MS);
  r2.step();
  assert.deepEqual(closed, [1], 'the empty room closes after EMPTY_CLOSE_MS');
});

test('grace: when every human is gone for good the bots do not play on: the World stops and the room is back in the lobby', () => {
  const { room, host, conns } = setup({ humans: 2, bots: 1, start: true, botFactory: lazyBots });
  runUntil(room, playing);
  const droppedAt = room.clock.now();
  room.disconnect(conns[0].id, conns[0]);
  room.disconnect(conns[1].id, conns[1]);
  runUntil(room, (r) => r.phase !== 'match', 3000);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.world, null);
  assert.ok(Math.abs(room.clock.now() - droppedAt - TIMEOUTS.GRACE_MATCH_MS) < 100, 'bots never play alone for longer than a grace period');
  assert.equal(room.entries.filter((e) => !e.isBot).length, 0);
  assert.equal(host.msgs('matchEnd').length, 0, 'no matchEnd');
});

test('round boundary: a human in grace when the next round is built sends the room back to the lobby ("Waiting for players")', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: lazyBots, settings: { rounds: 3 } });
  runUntil(room, (r) => r.world.outcome, 3000);
  assert.equal(entryOf(room, host).wins, 1);
  room.disconnect(host.id, host);
  runUntil(room, (r) => r.phase !== 'match', 3000);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.world, null);
  assert.ok(room._byId.has(host.id), 'the human is still in grace, not removed');
  assert.equal(entryOf(room, host).wins, 0, 'the scoreboard is reset when the match falls apart');
  const back = new FakeConn();
  room.join(back, { name: 'x', token: host.token });
  assert.deepEqual(back.types(), ['joined', 'lobby']);
  assert.equal(lobbyOf(back).phase, 'lobby');
});

test('round boundary: too few fighters at the next round -> phase results with matchEnd not_enough_players', () => {
  const { room, host, conns } = setup({ humans: 2, bots: 0, start: true, botFactory: lazyBots, settings: { rounds: 3 } });
  runUntil(room, playing);
  say(room, conns[1], { t: 'leave' });
  runUntil(room, (r) => r.world.outcome, 3000);
  runUntil(room, (r) => r.phase !== 'match', 3000);
  assert.equal(room.phase, 'results');
  const end = host.last('matchEnd');
  assert.equal(end.reason, 'not_enough_players');
  assert.equal(end.winnerId, null);
  assert.deepEqual(end.standings.map((s) => s.id), [host.id]);
  assert.ok(sysOf(host).includes('Not enough players - match ended'));
});

test('waiting: a mid-match joiner spectates with the LIVE round + a full snapshot and becomes a fighter next round', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: lazyBots, settings: { rounds: 3 } });
  runUntil(room, playing);
  ticks(room, 45);
  const late = new FakeConn();
  const j = room.join(late, { name: 'Late' });
  late.id = j.id;
  assert.deepEqual(late.types().filter((t) => t !== 'chat'), ['joined', 'lobby', 'round', 'snap']);
  const round = late.last('round');
  assert.equal(round.serverTick, room.world.tickNo);
  assert.equal(round.grid, room.world.grid.join(''), 'the LIVE grid');
  assert.ok(!round.players.some((p) => p.id === late.id), 'not a fighter: a spectator');
  assert.equal(late.last('snap').g.length, 195);
  assert.equal(playerOf(host, late.id).waiting, true);
  say(room, late, { t: 'chat', text: 'can you hear me' });
  assert.equal(host.last('chat').text, 'can you hear me');
  inFrame(room, late, [1, 2, 0, 0]);
  assert.equal(entryOf(room, late).lastSeq, 0);
  ticks(room, 3);
  assert.ok(late.msgs('snap').length > 1, 'spectators receive the broadcasts');

  runUntil(room, (r) => r.roundNo === 2, 5000);
  assert.equal(playerOf(late, late.id).waiting, false);
  assert.ok(late.last('round').players.some((p) => p.id === late.id), 'a fighter from the next round on');
  assert.ok(Object.hasOwn(late.last('snap').ack, late.id));
});

test('reconnect: same token re-attaches, replaces the old socket (4001) and replays joined/lobby/round/snap', () => {
  const { room, host, conns } = setup({ humans: 2, bots: 1, start: true });
  runUntil(room, playing);
  ticks(room, 20);
  const guest = conns[1];
  const fresh = new FakeConn();
  const res = room.join(fresh, { name: 'ignored', token: guest.token });
  assert.deepEqual({ ok: res.ok, id: res.id, token: res.token, resumed: res.resumed }, { ok: true, id: guest.id, token: guest.token, resumed: true });
  assert.equal(guest.closed, true);
  assert.equal(guest.closeReason, 'replaced');
  assert.deepEqual(fresh.types(), ['joined', 'lobby', 'round', 'snap']);
  assert.equal(fresh.last('joined').seq, entryOf(room, guest).lastSeq);
  assert.equal(fresh.last('round').serverTick, room.world.tickNo);
  assert.ok(fresh.last('round').players.some((p) => p.id === guest.id), 'the same fighter keeps playing');
  assert.equal(fresh.last('snap').g.length, 195);
  assert.equal(entryOf(room, guest).connected, true);
  assert.ok(host.msgs('lobby').length > 0);

  room.disconnect(guest.id, guest);
  assert.equal(entryOf(room, guest).connected, true, 'the late close of the replaced socket is ignored');
  assert.equal(entryOf(room, guest).conn, fresh);
  room.receive(guest.id, JSON.stringify({ t: 'in', c: [[1, 2, 0, 0]] }), guest);
  assert.equal(entryOf(room, guest).q.length, 0, 'stale frames are ignored');
  room.receive(guest.id, JSON.stringify({ t: 'in', c: [[1, 2, 0, 0]] }), fresh);
  assert.equal(entryOf(room, guest).q.length, 1);
});

test('reconnect: joined.seq is entry.lastSeq and the queue is cleared', () => {
  const { room, conns } = setup({ humans: 1, bots: 1, start: true });
  runUntil(room, playing);
  inFrame(room, conns[0], [10, 0, 0, 0], [11, 0, 0, 0], [12, 0, 0, 0]);
  room.disconnect(conns[0].id, conns[0]);
  assert.equal(entryOf(room, conns[0]).q.length, 0, 'the queue is cleared on disconnect');
  const back = new FakeConn();
  room.join(back, { token: conns[0].token, name: 'x' });
  assert.equal(back.last('joined').seq, 12);
  assert.equal(entryOf(room, conns[0]).q.length, 0);
});

test('reconnect: with a finished round the stored roundEnd is replayed; in results the last matchEnd', () => {
  const { room, host } = setup({ humans: 1, bots: 1, start: true, botFactory: suicideBots, settings: { rounds: 1 } });
  runUntil(room, (r) => r.world.outcome, 3000);
  room.disconnect(host.id, host);
  const b1 = new FakeConn();
  room.join(b1, { token: host.token, name: 'x' });
  assert.deepEqual(b1.types(), ['joined', 'lobby', 'round', 'snap', 'roundEnd']);
  assert.equal(b1.last('roundEnd').winnerId, host.id);
  runUntil(room, (r) => r.phase === 'results', 3000);
  room.disconnect(host.id, b1);
  const b2 = new FakeConn();
  room.join(b2, { token: host.token, name: 'x' });
  assert.deepEqual(b2.types(), ['joined', 'lobby', 'matchEnd']);
});

test('reconnect: an unknown or expired token is a fresh join with a new id and token', () => {
  const { room } = setup({ humans: 1 });
  const c = new FakeConn();
  const res = room.join(c, { name: 'Stranger', token: 'f'.repeat(32) });
  assert.equal(res.ok, true);
  assert.equal(res.resumed, false);
  assert.equal(res.id, 1);
  assert.notEqual(res.token, 'f'.repeat(32));
});

test('grace: a dropped socket keeps its slot (120 s in the lobby, 30 s in a match), then the entry is removed', () => {
  const { room, host, conns } = setup({ humans: 3 });
  const [, b] = conns;
  room.disconnect(b.id, b);
  assert.equal(playerOf(host, b.id).connected, false);
  room.clock.advance(TIMEOUTS.GRACE_LOBBY_MS - 1000);
  room.step();
  assert.ok(room._byId.has(b.id));
  room.clock.advance(1001);
  room.step();
  assert.ok(!room._byId.has(b.id));
  assert.ok(sysOf(host).includes('P2 left'));

  const m = setup({ humans: 2, bots: 1, start: true });
  m.room.disconnect(m.conns[1].id, m.conns[1]);
  runUntil(m.room, (r) => !r._byId.has(m.conns[1].id), 3000);
  assert.ok(Math.abs(m.room.clock.now() - TIMEOUTS.GRACE_MATCH_MS) < 100);
  assert.equal(m.room.world.player(m.conns[1].id).removed, true, 'its fighter was removed from the World');
});

test('grace: a lone host disconnected for 100 s in the lobby returns and is still host of the same room', () => {
  const { room, host } = setup({ humans: 1 });
  room.disconnect(host.id, host);
  for (let i = 0; i < 400; i++) { room.clock.advance(250); room.step(); }
  assert.equal(room.clock.now(), 100000);
  const back = new FakeConn();
  const res = room.join(back, { name: 'Host', token: host.token });
  assert.equal(res.resumed, true);
  assert.equal(lobbyOf(back).hostId, host.id);
  assert.equal(room.closed, false);
});

test('a socket that fails to send parks its entry in grace and does not stop the others', () => {
  const { room, conns, host } = setup({ humans: 3 });
  const dead = conns[1];
  dead.failSend = true;
  say(room, host, { t: 'chat', text: 'anyone there?' });
  assert.equal(conns[2].last('chat').text, 'anyone there?', 'the healthy client still got it');
  assert.equal(entryOf(room, dead).connected, false);
  assert.equal(playerOf(conns[2], dead.id).connected, false, 'a lobby broadcast tells everyone');
  assert.equal(entryOf(room, dead).conn, null);
});

test('a stale close event does not mark a re-attached entry disconnected (also across a phase change)', () => {
  const { room, conns } = setup({ humans: 2 });
  const old = conns[1];
  const fresh = new FakeConn();
  room.join(fresh, { token: old.token, name: 'x' });
  room.disconnect(old.id, old);
  assert.equal(entryOf(room, old).connected, true);
  room.disconnect(old.id, fresh);
  assert.equal(entryOf(room, old).connected, false);
});

// ---- Host ---------------------------------------------------------------------------------------------------------------

test('host: a host who leaves is replaced at once by the oldest connected human, with a sys line', () => {
  const { room, host, conns } = setup({ humans: 3 });
  say(room, host, { t: 'leave' });
  assert.equal(lobbyOf(conns[1]).hostId, conns[1].id);
  assert.equal(playerOf(conns[1], conns[1].id).isHost, true);
  assert.ok(sysOf(conns[2]).includes('P2 is now the host'));
});

test('host: a disconnected host keeps the role for 60 s; then it moves to a connected human; the ex-host is ordinary on return', () => {
  const { room, host, conns } = setup({ humans: 3 });
  room.disconnect(host.id, host);
  room.clock.advance(TIMEOUTS.HOST_MIGRATE_MS - 1000);
  room.step();
  assert.equal(lobbyOf(conns[1]).hostId, host.id);
  room.clock.advance(1001);
  room.step();
  assert.equal(lobbyOf(conns[1]).hostId, conns[1].id, 'oldest-joined connected human');
  assert.ok(sysOf(conns[2]).includes('P2 is now the host'));
  const back = new FakeConn();
  room.join(back, { token: host.token, name: 'x' });
  assert.equal(lobbyOf(back).hostId, conns[1].id, 'no flip-flop');
  assert.equal(playerOf(back, host.id).isHost, false);
});

test('host: with no other human connected the host is unchanged; grace expiry of the host promotes the next one at once', () => {
  const { room, host, conns } = setup({ humans: 2 });
  room.disconnect(host.id, host);
  room.disconnect(conns[1].id, conns[1]);
  room.clock.advance(TIMEOUTS.HOST_MIGRATE_MS + 1000);
  room.step();
  assert.equal(room.hostId, host.id, 'nobody is connected to take over');
  const back = new FakeConn();
  room.join(back, { token: conns[1].token, name: 'x' });
  room.step();
  assert.equal(room.hostId, conns[1].id, 'as soon as another human is connected, the stale host is replaced');

  const g = setup({ humans: 2 });
  g.room.disconnect(g.host.id, g.host);
  g.room.clock.advance(TIMEOUTS.GRACE_LOBBY_MS);
  g.room.step();
  assert.equal(g.room.hostId, g.conns[1].id);
});

test('kick: the target hears `kicked` and is closed, its token is banned, a fresh join still works; only the host can', () => {
  const { room, host, conns } = setup({ humans: 3 });
  const [, b, c] = conns;
  say(room, b, { t: 'kick', id: c.id });
  assert.deepEqual(errorsOf(b), ['not_host']);
  say(room, host, { t: 'kick', id: host.id });
  say(room, host, { t: 'kick', id: 99 });
  assert.equal(room.entries.length, 3, 'self and unknown ids are ignored');
  say(room, host, { t: 'kick', id: b.id });
  assert.deepEqual(b.msgs('kicked'), [{ t: 'kicked' }]);
  assert.equal(b.closed, true);
  assert.ok(!room._byId.has(b.id));
  assert.ok(sysOf(host).includes('P2 was kicked'));
  assert.deepEqual(room.join(new FakeConn(), { name: 'x', token: b.token }), { ok: false, error: 'kicked' });
  assert.equal(room.join(new FakeConn(), { name: 'P2' }).ok, true);
  assert.ok(!JSON.stringify(lobbyOf(host)).includes(b.token));
});

test('kick: a bot kick is a removeBot, the ban list is bounded, kick works in a match', () => {
  const { room, host } = setup({ humans: 1, bots: 1 });
  const bot = room.entries.find((e) => e.isBot);
  say(room, host, { t: 'kick', id: bot.id });
  assert.ok(!room._byId.has(bot.id));

  const r = makeRoom();
  const [h] = joinN(r, 1);
  for (let i = 0; i < 20; i++) {
    const c = new FakeConn();
    const j = r.join(c, { name: `V${i}` });
    c.id = j.id; c.token = j.token;
    say(r, h, { t: 'kick', id: c.id });
    r.clock.advance(100);
  }
  assert.equal(r.banned.length, 16);

  const m = setup({ humans: 2, bots: 1, start: true });
  runUntil(m.room, playing);
  say(m.room, m.host, { t: 'kick', id: m.conns[1].id });
  assert.ok(!m.room._byId.has(m.conns[1].id));
  assert.equal(m.room.world.player(m.conns[1].id).removed, true);
});

// ---- Chat, emotes, rate limits -------------------------------------------------------------------------------------------

test('chat: sanitised, broadcast with the sender, history replayed as old:true (last 50) to joiners', () => {
  const { room, host, conns } = setup({ humans: 2 });
  say(room, host, { t: 'chat', text: '  hi ‮ there​ ' });
  assert.deepEqual(conns[1].last('chat'), { t: 'chat', from: host.id, name: 'P1', text: 'hi there' });
  say(room, host, { t: 'chat', text: '   ' });
  assert.equal(conns[1].msgs('chat').length, 1, 'empty chat is dropped');

  const spammer = makeRoom();
  const [s, listener] = joinN(spammer, 2);
  for (let i = 0; i < 60; i++) { spammer.clock.advance(1100); say(spammer, s, { t: 'chat', text: `line ${i}` }); }
  const late = new FakeConn();
  spammer.join(late, { name: 'Late' });
  const replay = late.msgs('chat');
  assert.equal(replay.length, 50);
  assert.ok(replay.every((m) => m.old === true));
  assert.equal(replay[0].text, 'line 10');
  assert.equal(replay.at(-1).text, 'line 59');
  assert.ok(listener.msgs('chat').every((m) => !('old' in m)));
});

test('chat: 5 per 5 s (excess gets rate_limited), an identical repeat within 10 s is dropped silently', () => {
  const { room, host, conns } = setup({ humans: 2 });
  for (let i = 0; i < 7; i++) say(room, host, { t: 'chat', text: `m${i}` });
  assert.equal(conns[1].msgs('chat').length, 5);
  assert.deepEqual(errorsOf(host), ['rate_limited', 'rate_limited']);
  room.clock.advance(5001);
  say(room, host, { t: 'chat', text: 'again' });
  say(room, host, { t: 'chat', text: 'again' });
  room.clock.advance(1000);
  say(room, host, { t: 'chat', text: 'again' });
  assert.equal(conns[1].msgs('chat').filter((m) => m.text === 'again').length, 1);
  assert.equal(errorsOf(host).length, 2, 'dropped repeats cost no error and no quota');
  room.clock.advance(10000);
  say(room, host, { t: 'chat', text: 'again' });
  assert.equal(conns[1].msgs('chat').filter((m) => m.text === 'again').length, 2);
});

test('emote: broadcast to everyone, 1 per 700 ms with rate_limited', () => {
  const { room, host, conns } = setup({ humans: 2 });
  say(room, host, { t: 'emote', e: 7 });
  say(room, host, { t: 'emote', e: 1 });
  assert.deepEqual(conns[1].msgs('emote'), [{ t: 'emote', from: host.id, e: 7 }]);
  assert.deepEqual(errorsOf(host), ['rate_limited']);
  room.clock.advance(701);
  say(room, host, { t: 'emote', e: 1 });
  assert.equal(conns[1].msgs('emote').length, 2);
});

test('ping/sync/other types: ping 4/s answered with pong, everything else 30/s dropped silently', () => {
  const { room, host } = setup({ humans: 1 });
  for (let i = 0; i < 6; i++) say(room, host, { t: 'ping', ts: i });
  assert.deepEqual(host.msgs('pong').map((p) => p.ts), [0, 1, 2, 3]);
  room.clock.advance(1000);
  say(room, host, { t: 'ping', ts: 99 });
  assert.equal(host.last('pong').ts, 99);
  host.clear();
  for (let i = 0; i < 40; i++) say(room, host, { t: 'settings', patch: { rounds: i % 2 ? 3 : 5 } });
  assert.equal(host.msgs('lobby').length, 30, 'the 31st settings message inside a second is dropped');
});

test('garbage never throws: fuzzed and malformed frames, unknown ids, create/join inside the room, objects instead of strings', () => {
  const { room, host } = setup({ humans: 2, bots: 1, start: true });
  const rng = makeRng(77);
  const junk = ['', '{', 'null', '[]', '"x"', '{"t":"in"}', '{"t":"in","c":[]}', '{"t":"in","c":[[1,2,3]]}', '{"t":"nope"}', '{"t":"create","v":1}', '{"t":"join","v":1,"code":"ABCD"}',
    '{"__proto__":{"x":1},"t":"ping","ts":1}', '{"t":"kick","id":"a"}', '{"t":"settings","patch":5}', 'x'.repeat(5000)];
  for (let i = 0; i < 3000; i++) {
    const pick = rng.next();
    const raw = pick < 0.4 ? junk[rng.int(junk.length)]
      : pick < 0.7 ? JSON.stringify({ t: ['in', 'chat', 'profile', 'settings', 'emote', 'kick', 'sync'][rng.int(7)], id: rng.int(10) - 1, e: rng.int(20), text: 'y'.repeat(rng.int(200)), c: [[rng.int(1e9), rng.int(6), rng.int(3), rng.int(3)]] })
        : { t: 'in', c: [[i + 1000, rng.int(5), 0, 0]], get x() { return 1; } };
    room.receive(rng.int(5) === 0 ? 99 : host.id, raw, host);
    if (i % 50 === 0) tick(room);
  }
  assert.equal(room.closed, false);
  room.receive(host.id, undefined, host);
  room.receive(undefined, undefined, undefined);
  room.disconnect(123, host);
  assert.equal(room.phase, 'match');
});

// ---- Liveness, timers, close --------------------------------------------------------------------------------------------------

test('close: idempotent, tells everyone `closed`, closes every connection, clears every timer, calls onEmpty once', () => {
  let empties = 0;
  const room = makeRoom({ onEmpty: () => empties++ });
  const conns = joinN(room, 2);
  room.startLoop();
  assert.equal(room.clock.pending, 1);
  room.close();
  room.close();
  assert.equal(empties, 1);
  assert.equal(room.clock.pending, 0);
  for (const c of conns) {
    assert.deepEqual(c.msgs('error'), [{ t: 'error', code: 'closed', msg: 'Room closed.' }]);
    assert.equal(c.closed, true);
  }
  say(room, conns[0], { t: 'chat', text: 'hi' });
  room.step();
  room.pump(1e6);
  assert.equal(conns[1].msgs('chat').length, 0, 'a closed room is inert');

  const r = makeRoom();
  const [c] = joinN(r, 1);
  r.close('restart');
  assert.equal(c.closeReason, 'restart');
  assert.equal(c.last('error').msg, 'Server restarting');
});

test('close: a throwing onEmpty or conn.close cannot stop the shutdown', () => {
  const room = makeRoom({ onEmpty: () => { throw new Error('nope'); } });
  const c = new FakeConn();
  c.close = () => { throw new Error('socket gone'); };
  room.join(c, { name: 'x' });
  const d = new FakeConn();
  room.join(d, { name: 'y' });
  room.close();
  assert.equal(d.closed, true);
});

test('liveness: the room closes EMPTY_CLOSE_MS after the last human is gone (bots do not keep it alive), unless someone joins', () => {
  const closed = [];
  const room = makeRoom({ onEmpty: () => closed.push(room.code) });
  const [a] = joinN(room, 1);
  say(room, a, { t: 'addBot', level: 'easy' });
  say(room, a, { t: 'leave' });
  room.clock.advance(TIMEOUTS.EMPTY_CLOSE_MS - 500);
  room.step();
  assert.equal(closed.length, 0);
  joinN(room, 1);
  room.clock.advance(TIMEOUTS.EMPTY_CLOSE_MS);
  room.step();
  assert.equal(closed.length, 0, 'a human joined meanwhile');

  const fresh = makeRoom({ onEmpty: () => closed.push('fresh') });
  fresh.clock.advance(TIMEOUTS.EMPTY_CLOSE_MS);
  fresh.step();
  assert.deepEqual(closed, ['fresh'], 'a room nobody ever joins also closes');
});

test('liveness: a lobby idle for 30 minutes is closed with a sys notice; chat keeps it alive, ping does not', () => {
  const closed = [];
  const room = makeRoom({ onEmpty: () => closed.push(1) });
  const [a] = joinN(room, 1);
  for (let i = 0; i < 4; i++) {
    room.clock.advance(TIMEOUTS.IDLE_LOBBY_MS - 60000);
    say(room, a, { t: 'ping', ts: 1 });
    say(room, a, { t: 'chat', text: `still here ${i}` });
    room.step();
  }
  assert.equal(closed.length, 0);
  room.clock.advance(TIMEOUTS.IDLE_LOBBY_MS - 1000);
  say(room, a, { t: 'ping', ts: 1 });
  room.step();
  assert.equal(closed.length, 0);
  room.clock.advance(1001);
  room.step();
  assert.equal(closed.length, 1);
  assert.ok(sysOf(a).includes('Room closed after inactivity'));
  assert.equal(a.last('error').code, 'closed');
});

test('liveness: a match where nobody sends a cmd for 5 minutes is closed; real input keeps it alive', () => {
  const closed = [];
  const { room, host } = setup({ humans: 1, bots: 1, start: true, settings: { roundTime: 240 }, onEmpty: () => closed.push(1) });
  runUntil(room, playing);
  room.clock.advance(TIMEOUTS.IDLE_MATCH_MS - 5000);
  inFrame(room, host, [1, 0, 0, 0]);
  room.step();
  room.clock.advance(TIMEOUTS.IDLE_MATCH_MS - 5000);
  inFrame(room, host, [2, 2, 0, 0]);
  room.step();
  assert.equal(closed.length, 0, 'an idle cmd (d=0,b=0,x=0) does not count, a real one does');
  room.clock.advance(TIMEOUTS.IDLE_MATCH_MS + 1000);
  room.step();
  assert.equal(closed.length, 1);
});

test('liveness: the 6 hour cap closes any room', () => {
  const closed = [];
  const room = makeRoom({ onEmpty: () => closed.push(1) });
  const [a] = joinN(room, 1);
  for (let i = 0; i < 17; i++) { room.clock.advance(1200000); say(room, a, { t: 'chat', text: `every 20 minutes ${i}` }); room.step(); }
  assert.equal(closed.length, 0, 'chatting keeps the room clear of the idle limit, so only the cap remains');
  room.clock.advance(1200000);
  room.step();
  assert.equal(closed.length, 1);
});

test('loop: 4 Hz housekeeping outside a match, 60 Hz in a match, back to 4 Hz afterwards; one timer at most', () => {
  const room = makeRoom({ botFactory: suicideBots });
  const delays = [];
  const setTimer = room._setTimer;
  room._setTimer = (fn, ms) => { delays.push(ms); return setTimer(fn, ms); };
  const [host] = joinN(room, 1);
  room.startLoop();
  room.startLoop();
  assert.equal(room.clock.pending, 1, 'startLoop is idempotent');
  room.clock.advance(1000);
  assert.ok(delays.slice(1).every((d) => d === 250 || d <= 250), JSON.stringify(delays));
  assert.equal(delays.length, 6, 'the first arm plus one re-arm per wake: wakes at 0, 250, 500, 750 and 1000 ms');
  say(room, host, { t: 'settings', patch: { rounds: 1 } });
  say(room, host, { t: 'addBot', level: 'easy' });
  say(room, host, { t: 'start' });
  assert.equal(room.clock.pending, 1);
  delays.length = 0;
  room.clock.advance(1000);
  assert.ok(room.world.tickNo >= 58 && room.world.tickNo <= 61, `ticked ${room.world.tickNo} times in a second`);
  assert.ok(delays.length >= 58);
  room.clock.advance(15000);
  assert.equal(room.phase, 'results');
  delays.length = 0;
  room.clock.advance(1000);
  assert.ok(delays.length <= 5, `${delays.length} wakes in the results phase`);
  room.stopLoop();
  assert.equal(room.clock.pending, 0);
  room.close();
  assert.equal(room.clock.pending, 0);
});

test('pump: at most 5 catch-up ticks per wake; longer stalls drop time instead of spiralling', () => {
  const { room } = setup({ humans: 1, bots: 1, start: true });
  const t0 = room.clock.now();
  room.pump(t0);
  room.clock.advance(60000);
  room.pump(room.clock.now());
  assert.equal(room.world.tickNo, 5);
  assert.ok(room.droppedTicks > 3000);
  room.clock.advance(TICK_MS * 2.5);
  room.pump(room.clock.now());
  assert.equal(room.world.tickNo, 7);
  room.pump(room.clock.now() - 1000);
  assert.equal(room.world.tickNo, 7, 'a clock that goes backwards adds no time');
});

test('a crash inside a tick ends the match gracefully: sys "Round crashed", phase lobby, room still usable', () => {
  const logs = [];
  const { room, host } = setup({ humans: 1, bots: 1, start: true, log: (...a) => logs.push(a) });
  runUntil(room, playing);
  room.world.tick = () => { throw new Error('world exploded'); };
  tick(room);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.world, null);
  assert.ok(sysOf(host).includes('Round crashed'));
  assert.ok(logs.some(([lvl, ev, extra]) => lvl === 'error' && ev === 'room_error' && /world exploded/.test(extra.stack)));
  say(room, host, { t: 'start' });
  assert.equal(room.phase, 'match');
});

test('a round that cannot be built sends the room back to the lobby instead of leaving it stuck in "match"', () => {
  const logs = [];
  const { room, host } = setup({ humans: 1, bots: 1, log: (...a) => logs.push(a) });
  Object.defineProperty(room.settings, 'layout', { get() { throw new Error('cannot build'); } });
  say(room, host, { t: 'start' });
  assert.equal(room.phase, 'lobby');
  assert.equal(room.world, null);
  assert.ok(sysOf(host).includes('Round crashed'));
  assert.ok(logs.some(([lvl, ev, extra]) => lvl === 'error' && extra.where === 'newRound' && /cannot build/.test(extra.stack)));
});

test('a throwing botFactory does not break the round', () => {
  const { room } = setup({ humans: 1, bots: 1, start: true, botFactory: () => { throw new Error('no bots today'); } });
  assert.equal(room.phase, 'match');
  ticks(room, COUNTDOWN_TICKS + 20);
  assert.equal(room.world.state, STATE.PLAYING);
});

// ---- Chaos ---------------------------------------------------------------------------------------------------------------------

/**
 * Random operations from many clients (joins, drops, reconnects, kicks, settings, input, time jumps) against one Room.
 * After every operation the structural invariants must hold, no internal error may be logged and every frame must be
 * well-formed and consistent with the round the connection was told about.
 */
function chaos(seed, operations) {
  const rng = makeRng(seed);
  const logs = [];
  const room = makeRoom({ seed, botFactory: wanderBots, log: (...a) => logs.push(a) });
  const people = [];                                        // { conn, id, token, seq }: conn is null while the player is offline
  const allConns = [];                                      // every socket ever opened, for the frame checks
  const nameKey = (n) => n.normalize('NFKC').toLocaleLowerCase('en');
  const pick = (list) => list[rng.int(list.length)];
  const alive = () => people.filter((p) => p.conn && !p.conn.closed && room._byId.has(p.id) && room._byId.get(p.id).conn === p.conn);

  const attach = (token, name) => {
    const conn = new FakeConn();
    allConns.push(conn);
    const res = room.join(conn, { name, token });
    if (!res.ok) return;
    conn.id = res.id;
    if (res.resumed) {
      const person = people.find((p) => p.id === res.id);
      person.conn = conn;
    } else {
      people.push({ conn, id: res.id, token: res.token, seq: 0 });
    }
  };
  const send = (person, msg) => room.receive(person.id, JSON.stringify(msg), person.conn);

  const checkInvariants = (where) => {
    const ids = room.entries.map((e) => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b), `${where}: entries in join order`);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(room._byId.size, room.entries.length);
    assert.ok(room.entries.length <= MAX_PLAYERS);
    assert.equal(new Set(room.entries.map((e) => e.color)).size, room.entries.length, `${where}: unique colours`);
    assert.equal(new Set(room.entries.map((e) => nameKey(e.name))).size, room.entries.length, `${where}: unique names`);
    const humans = room.entries.filter((e) => !e.isBot);
    if (humans.length) assert.ok(humans.some((e) => e.id === room.hostId), `${where}: a human host`);
    else assert.equal(room.hostId, null);
    for (const e of room.entries) {
      assert.equal(e.connected, e.isBot || e.conn !== null, `${where}: connected flag of ${e.id}`);
      if (!e.connected) assert.equal(e.q.length, 0);
    }
    if (room.phase !== 'match') assert.equal(room.world, null, `${where}: no world outside a match`);
    assert.ok(['lobby', 'match', 'results'].includes(room.phase));
    assert.equal(logs.filter(([lvl]) => lvl === 'error').length, 0, `${where}: ${JSON.stringify(logs.find(([lvl]) => lvl === 'error'))}`);
  };

  const checkFrames = () => {
    for (const conn of allConns) {
      let roundIds = null;
      for (const raw of conn.sent) {
        const m = JSON.parse(raw);
        if (m.t === 'round') {
          assert.equal(m.grid.length, 195);
          roundIds = m.players.map((p) => p.id);
        } else if (m.t === 'snap') {
          assert.ok(roundIds, 'a snapshot is never sent before the round it belongs to');
          assert.deepEqual(m.p.map((row) => row[0]), roundIds, 'snapshot rows follow round.players');
          for (const id of Object.keys(m.ack)) assert.ok(roundIds.includes(Number(id)));
          if ('g' in m) assert.equal(m.g.length, 195);
        } else if (m.t === 'lobby') {
          assert.equal(m.players.filter((p) => p.isHost).length, m.players.some((p) => !p.isBot) ? 1 : 0);
        }
      }
    }
  };

  for (let i = 0; i < 4; i++) attach(undefined, `Seed${i}`);
  for (let op = 0; op < operations; op++) {
    const someone = alive().length ? pick(alive()) : null;
    const dice = rng.int(100);
    if (dice < 6) attach(rng.int(3) === 0 && people.length ? pick(people).token : undefined, `Guest ${rng.int(9)}`);
    else if (dice < 10 && someone) { room.disconnect(someone.id, someone.conn); someone.conn = null; }
    else if (dice < 14 && people.length) attach(pick(people).token, 'again');                // reconnect, sometimes over a still-open socket
    else if (dice < 16 && someone) send(someone, { t: 'leave' });
    else if (dice < 19 && someone) send(someone, { t: 'kick', id: pick(room.entries).id });
    else if (dice < 25 && someone) send(someone, { t: 'addBot', level: pick(['easy', 'normal', 'hard']) });
    else if (dice < 28 && someone) send(someone, { t: 'removeBot', id: pick(room.entries).id });
    else if (dice < 34 && someone) {
      const patch = { rounds: pick([1, 2, 3]), roundTime: pick([0, 60, 90]), mode: pick(['ffa', 'teams']), theme: pick(['random', 'lava']), layout: pick(['classic', 'open']), locked: rng.int(6) === 0 };
      send(someone, { t: 'settings', patch });
    } else if (dice < 40 && someone) send(someone, { t: 'start' });
    else if (dice < 42 && someone) send(someone, { t: 'lobby' });
    else if (dice < 46 && someone) send(someone, { t: 'chat', text: `msg ${rng.int(30)}` });
    else if (dice < 48 && someone) send(someone, { t: 'emote', e: rng.int(8) });
    else if (dice < 52 && someone) send(someone, { t: 'profile', name: pick(['Ana', 'Ben', 'ana', 'Bolt', '']), color: rng.int(8), team: rng.int(2), ...(rng.int(4) === 0 ? { id: pick(room.entries).id } : {}) });
    else if (dice < 54 && someone) send(someone, { t: 'sync' });
    else if (dice < 78 && someone) {
      const cmds = Array.from({ length: 1 + rng.int(5) }, () => [(someone.seq += 1 + rng.int(2)), rng.int(5), rng.int(8) === 0 ? 1 : 0, rng.int(10) === 0 ? 1 : 0]);
      send(someone, { t: 'in', c: cmds });
    } else if (dice < 80) room.clock.advance(rng.int(3) === 0 ? rng.int(40000) : rng.int(500));
    ticks(room, dice < 92 ? 1 + rng.int(40) : 100 + rng.int(300));
    if (room.closed) break;
    checkInvariants(`seed ${seed} op ${op}`);
    if (op % 100 === 0) checkFrames();
  }
  checkFrames();
  const seen = {};
  for (const conn of allConns) for (const type of conn.types()) seen[type] = (seen[type] ?? 0) + 1;
  room.close();
  assert.equal(room.clock.pending, 0);
  return seen;
}

test('chaos: thousands of random joins, drops, reconnects, kicks, settings, inputs and time jumps never break an invariant or log an error', (t) => {
  const total = {};
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const [type, n] of Object.entries(chaos(seed, 700))) total[type] = (total[type] ?? 0) + n;
  t.diagnostic(JSON.stringify(total));
  for (const type of ['round', 'roundEnd', 'matchEnd', 'kicked', 'error', 'snap', 'sys', 'chat', 'emote']) assert.ok(total[type] > 0, `the run never produced a ${type}`);
});

// ---- Budgets ------------------------------------------------------------------------------------------------------------------------

/** 4 humans that walk about plus 4 wandering bots, one full round; returns the snapshot sizes (bytes) a client receives. */
function busyRound({ seed = 3, humans = 4, bots = 4 } = {}) {
  const room = makeRoom({ seed, botFactory: wanderBots });
  const conns = joinN(room, humans);
  startMatch(room, conns, { bots, settings: { rounds: 7, roundTime: 120 } });
  const rng = makeRng(seed + 1000);
  const seqs = conns.map(() => 0);
  const dirs = conns.map(() => 0);
  const sizes = [];
  let ms = 0;
  let stepped = 0;
  const watcher = conns[0];
  while (room.phase === 'match' && stepped < 6000) {
    if (stepped % 12 === 0) conns.forEach((c, i) => { dirs[i] = rng.int(5); });
    conns.forEach((c, i) => inFrame(room, c, [++seqs[i], dirs[i], rng.next() < 0.004 ? 1 : 0, 0]));
    const before = watcher.sent.length;
    const t0 = performance.now();
    tick(room);
    ms += performance.now() - t0;
    stepped++;
    for (let k = before; k < watcher.sent.length; k++) if (watcher.sent[k].startsWith('{"t":"snap"')) sizes.push(Buffer.byteLength(watcher.sent[k]));
  }
  return { sizes, msPerTick: ms / stepped, stepped, room };
}

test('budget: snapshots of a busy 4 humans + 4 bots round average <= 1.2 KB with p99 <= 4 KB', (t) => {
  const { sizes, stepped } = busyRound();
  const sorted = [...sizes].sort((a, b) => a - b);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  t.diagnostic(`${sizes.length} snapshots over ${stepped} ticks: mean ${mean.toFixed(0)} B, p99 ${p99} B, max ${sorted.at(-1)} B`);
  assert.ok(sizes.length > 500);
  assert.ok(mean <= 1200, `mean ${mean}`);
  assert.ok(p99 <= 4096, `p99 ${p99}`);
});

test('budget: one 8-fighter room costs far less than the 16.7 ms tick (including JSON of every snapshot)', (t) => {
  const { msPerTick, stepped } = busyRound({ seed: 11 });
  t.diagnostic(`8-fighter room: ${msPerTick.toFixed(3)} ms per tick over ${stepped} ticks`);
  assert.ok(msPerTick < 1, `${msPerTick} ms per tick`);
});

test('budget: 50 idle lobby rooms cost nothing: one 250 ms timer each and microseconds per wake', () => {
  const clock = new FakeClock();
  const rooms = Array.from({ length: 50 }, (_, i) => {
    const r = makeRoom({ code: `R${i}`, clock });
    joinN(r, 1);
    r.startLoop();
    return r;
  });
  assert.equal(clock.pending, 50);
  const t0 = performance.now();
  clock.advance(10000);
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `${ms} ms for 10 s of 50 idle rooms`);
  assert.equal(clock.pending, 50);
  for (const r of rooms) r.close();
  assert.equal(clock.pending, 0);
});

test('Practice: a local Room runs on a virtual clock with no timers and no loop', () => {
  let virtual = 0;
  const timers = [];
  const room = new Room({ code: 'LOCAL', local: true, now: () => virtual, seed: 5, setTimer: (...a) => timers.push(a), botFactory: idleBots });
  const c = new FakeConn();
  const { id } = room.join(c, { name: 'Me' });
  room.receive(id, JSON.stringify({ t: 'addBot', level: 'easy' }), c);
  room.receive(id, JSON.stringify({ t: 'start' }), c);
  for (let i = 0; i < 300; i++) { virtual += TICK_MS; room.step(); }
  assert.equal(room.world.tickNo, 300);
  assert.deepEqual(timers, []);
  assert.equal(c.last('lobby').local, true);
});
