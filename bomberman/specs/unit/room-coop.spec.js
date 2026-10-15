// The Room in the co-op modes (docs/SPEC.md Appendix C): settings and readiness, coop waves with their enemy bots, adventure levels
// with shared lives, the run's progress in roundEnd and matchEnd, carried power-ups, late joiners. Fake connections, fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE, MAX_PLAYERS, ADVENTURE_LEVELS, OVER_HOLD_TICKS, ENDING_TICKS, SETTINGS_DEFS } from '../../shared/constants.js';
import { parseClientMessage } from '../../shared/protocol.js';
import { makeRoom, joinN, say, tick, ticks, runUntil, startMatch } from '../helpers/room-fixtures.js';
import { FakeConn } from '../helpers/fake-conn.js';

const coopRoom = (mode, settings = {}, { humans = 1, bots = 0, seed = 5 } = {}) => {
  const room = makeRoom({ seed });
  const conns = joinN(room, humans);
  for (let i = 0; i < bots; i++) say(room, conns[0], { t: 'addBot', level: 'easy' });
  say(room, conns[0], { t: 'settings', patch: { mode, ...settings } });
  return { room, conns, host: conns[0] };
};
const live = (room) => runUntil(room, (r) => r.world?.state === STATE.PLAYING);
const roundEnds = (c) => c.msgs('roundEnd');
const passHold = (room) => ticks(room, ENDING_TICKS + OVER_HOLD_TICKS + 2);

/** Clears the running wave or level at once: the enemies (coop) are knocked out, or (adventure) the monsters vanish and a fighter steps on the open door. */
function clearStage(room) {
  const w = room.world;
  if (w.mode === 'coop') {
    for (const p of w.players) if (p.team === 1 && p.alive) w._killPlayer(p, w.players[0].id);
  } else {
    w.coop.monsters.length = 0;
    w.grid[w.door.ty * w.W + w.door.tx] = '.';
    w.coop.onBlockOpened(w.door.ty * w.W + w.door.tx);
    tick(room);
    const p = w.players.find((q) => q.alive);
    p.x = w.door.tx + 0.5;
    p.y = w.door.ty + 0.5;
  }
  tick(room);
}

/** Loses the running wave or level: every team member goes down (and, adventure, has no life to come back with). */
function loseStage(room) {
  const w = room.world;
  if (w.coop) { w.coop.lives = 0; w.coop.respawnAt.clear(); }
  for (const p of w.players) if (p.team === 0 && p.alive) { p.shield = 0; p.spawnShield = 0; w._killPlayer(p, -1); }
  tick(room);
}

test('settings: the co-op modes and the difficulty are host settings validated like the others', () => {
  for (const mode of ['coop', 'adventure']) assert.deepEqual(parseClientMessage({ t: 'settings', patch: { mode } }).msg.patch, { mode });
  assert.deepEqual(parseClientMessage({ t: 'settings', patch: { difficulty: 'hard', mode: 'quest' } }).msg.patch, { difficulty: 'hard' });
  const room = makeRoom();
  assert.equal(room.settings.difficulty, SETTINGS_DEFS.difficulty.def);
});

test('switching to a co-op mode puts everybody (lobby bots too) on one team, and team picks are ignored', () => {
  const room = makeRoom();
  const [host, ana] = joinN(room, 2);
  say(room, host, { t: 'settings', patch: { mode: 'teams' } });
  say(room, host, { t: 'addBot', level: 'easy' });
  assert.deepEqual(room.entries.map((e) => e.team), [0, 1, 0]);
  say(room, host, { t: 'settings', patch: { mode: 'adventure' } });
  assert.deepEqual(room.entries.map((e) => e.team), [0, 0, 0]);
  say(room, ana, { t: 'profile', team: 1 });
  assert.equal(room.entries[1].team, 0);
  say(room, host, { t: 'addBot', level: 'normal' });
  assert.equal(room.entries.at(-1).team, 0);
});

test('readiness: one human can start a co-op match; coop keeps a seat for the enemy (need_seat)', () => {
  for (const mode of ['coop', 'adventure']) {
    const { room, host } = coopRoom(mode);
    say(room, host, { t: 'start' });
    assert.equal(room.phase, 'match', mode);
    assert.equal(host.msgs('error').length, 0);
  }
  const { room, host } = coopRoom('coop', {}, { bots: MAX_PLAYERS - 1 });
  say(room, host, { t: 'start' });
  assert.equal(room.phase, 'lobby');
  assert.equal(host.last('error').code, 'need_seat');
  const adv = coopRoom('adventure', {}, { bots: MAX_PLAYERS - 1 });
  say(adv.room, adv.host, { t: 'start' });
  assert.equal(adv.room.phase, 'match', 'an adventure has room for eight');
});

test('coop: each wave brings its own enemy bots (team 1, fresh ids, not lobby entries); lobby bots help', () => {
  const { room, host } = coopRoom('coop', { rounds: 3 }, { bots: 1 });
  say(room, host, { t: 'start' });
  const round = host.last('round');
  assert.deepEqual(round.coop, { mode: 'coop', level: 1, of: 3, difficulty: 'normal' });
  assert.equal(round.winsNeeded, 3);
  const team = round.players.filter((p) => p.team === 0);
  const foes = round.players.filter((p) => p.team === 1);
  assert.deepEqual(team.map((p) => p.id), room.entries.map((e) => e.id));
  assert.equal(foes.length, 2, 'as many enemies as the team on wave 1');
  assert.ok(foes.every((f) => f.isBot && f.id > Math.max(...room.entries.map((e) => e.id))));
  assert.equal(host.last('lobby').players.length, 2, 'the enemy bots never show up in the lobby');
  assert.equal(new Set(round.players.map((p) => p.color)).size, round.players.length, 'every fighter has its own colour');
  live(room);
  const snap = host.last('snap');
  assert.equal(snap.p.length, 4);
  assert.equal(snap.sc, 0);
  assert.ok(room._foes.every((f) => f.brain), 'the enemy bots think');
});

test('coop: a cleared wave counts for the whole team, the next wave is bigger; a lost wave ends the run', () => {
  const { room, host } = coopRoom('coop', { rounds: 3 });
  say(room, host, { t: 'start' });
  live(room);
  const firstFoes = room._foes.map((f) => f.id);
  clearStage(room);
  const end1 = roundEnds(host).at(-1);
  assert.equal(end1.reason, 'clear');
  assert.equal(end1.winnerTeam, 0);
  assert.equal(end1.matchOver, false);
  assert.deepEqual({ ...end1.coop, score: 0 }, { mode: 'coop', level: 1, of: 3, cleared: 1, lives: -1, score: 0 });
  assert.ok(end1.coop.score > 0);
  assert.equal(host.last('lobby').players[0].wins, 1, 'wins = waves cleared');
  passHold(room);
  assert.equal(host.last('round').n, 2);
  assert.ok(room._foes.every((f) => !firstFoes.includes(f.id)), 'ids are never reused');
  live(room);
  loseStage(room);
  const end2 = roundEnds(host).at(-1);
  assert.deepEqual([end2.reason, end2.matchOver, end2.coop.cleared], ['wipe', true, 1]);
  passHold(room);
  assert.equal(room.phase, 'results');
  const me = host.last('matchEnd');
  assert.equal(me.reason, 'gameover');
  assert.equal(me.winnerTeam, null);
  assert.deepEqual({ ...me.coop, score: 0 }, { mode: 'coop', difficulty: 'normal', of: 3, cleared: 1, reached: 2, score: 0, lives: 0, victory: false });
  assert.deepEqual(Object.keys(me.standings[0]).sort(), ['blocks', 'color', 'deaths', 'id', 'items', 'kills', 'monsters', 'name', 'place', 'selfKills', 'team', 'wins'].sort());
  assert.equal(room._foes.length, 0);
});

test('coop: clearing every wave is a victory', () => {
  const { room, host } = coopRoom('coop', { rounds: 1 });
  say(room, host, { t: 'start' });
  live(room);
  clearStage(room);
  assert.equal(roundEnds(host).at(-1).matchOver, true);
  passHold(room);
  const me = host.last('matchEnd');
  assert.deepEqual([me.reason, me.winnerTeam, me.coop.victory, me.coop.cleared], ['victory', 0, true, 1]);
});

test('adventure: levels in a row, lives and score carried over, power-ups too; game over when the team is down', () => {
  const { room, host } = coopRoom('adventure', { difficulty: 'normal' }, { humans: 2 });
  say(room, host, { t: 'start' });
  assert.equal(host.last('round').winsNeeded, ADVENTURE_LEVELS);
  assert.deepEqual(host.last('lobby').round, { n: 1, winsNeeded: ADVENTURE_LEVELS });
  live(room);
  const w1 = room.world;
  assert.equal(w1.coop.lives, 4, '3 lives plus one for the second human');
  assert.ok(host.last('snap').m.length > 0);
  w1.players[0].bombsMax = 4;
  w1.players[0].range = 5;
  w1.players[1].spawnShield = 0;
  w1._killPlayer(w1.players[1], -1);                                  // a life spent
  clearStage(room);
  const end1 = roundEnds(host).at(-1);
  assert.equal(end1.reason, 'clear');
  assert.equal(end1.coop.lives, 4, 'one spent, one earned by clearing the level');
  passHold(room);
  const w2 = room.world;
  assert.notEqual(w2, w1);
  assert.equal(w2.coop.level, 2);
  assert.equal(w2.coop.lives, 4);
  assert.equal(w2.coop.score, end1.coop.score);
  assert.deepEqual([w2.players[0].bombsMax, w2.players[0].range], [4, 5], 'power-ups carry over between levels');
  assert.ok(w2.players.every((p) => p.alive), 'everybody is back for the next level');
  live(room);
  loseStage(room);
  passHold(room);
  const me = host.last('matchEnd');
  assert.deepEqual([me.reason, me.coop.victory, me.coop.cleared, me.coop.reached, me.coop.of], ['gameover', false, 1, 2, ADVENTURE_LEVELS]);
});

test('adventure: all eight levels make a victory', () => {
  const { room, host } = coopRoom('adventure');
  say(room, host, { t: 'start' });
  for (let level = 1; level <= ADVENTURE_LEVELS; level++) {
    live(room);
    assert.equal(room.world.coop.level, level);
    clearStage(room);
    passHold(room);
  }
  assert.equal(room.phase, 'results');
  const me = host.last('matchEnd');
  assert.deepEqual([me.reason, me.winnerTeam, me.coop.victory, me.coop.cleared], ['victory', 0, true, ADVENTURE_LEVELS]);
  assert.ok(me.coop.score >= 500 * 36, 'every level paid its clear bonus');
});

test('a late joiner watches the level and plays the next one; the run survives a helper bot', () => {
  const { room, host } = coopRoom('adventure', {}, { bots: 1 });
  say(room, host, { t: 'start' });
  live(room);
  const late = new FakeConn();
  const res = room.join(late, { name: 'Late' });
  late.id = res.id;
  assert.equal(room.entries.at(-1).waiting, true);
  assert.equal(room.entries.at(-1).team, 0);
  clearStage(room);
  passHold(room);
  assert.ok(room.world.player(late.id), 'a fighter on the next level');
  assert.equal(room.world.player(late.id).team, 0);
});

test('coop keeps a seat for the enemy when a late joiner fills the room: the newest helper bot sits the wave out', () => {
  const { room, host } = coopRoom('coop', { rounds: 3 }, { bots: MAX_PLAYERS - 2 });
  say(room, host, { t: 'start' });
  live(room);
  assert.equal(room.world.players.filter((p) => p.team === 1).length, 1);
  const extra = new FakeConn();
  extra.id = room.join(extra, { name: 'Extra' }).id;
  assert.equal(room.entries.length, MAX_PLAYERS);
  clearStage(room);
  passHold(room);
  const w = room.world;
  assert.equal(w.players.length, MAX_PLAYERS);
  assert.equal(w.players.filter((p) => p.team === 1).length, 1, 'one enemy still fits');
  assert.ok(w.player(extra.id), 'the human who joined plays');
  const benched = room.entries.filter((e) => e.waiting);
  assert.equal(benched.length, 1);
  assert.ok(benched[0].isBot);
});

test('the host can end a co-op match: back to the lobby with a clean slate', () => {
  const { room, host } = coopRoom('adventure');
  say(room, host, { t: 'start' });
  live(room);
  say(room, host, { t: 'lobby' });
  assert.equal(room.phase, 'lobby');
  assert.equal(room._run, null);
  assert.equal(room._foes.length, 0);
  assert.equal(room.entries[0].carry, null);
});

test('battle modes are unchanged: no coop fields in round, roundEnd or matchEnd', () => {
  const room = makeRoom({ seed: 2 });
  const conns = joinN(room, 1);
  startMatch(room, conns, { bots: 1, settings: { rounds: 1 } });
  const host = conns[0];
  assert.ok(!('coop' in host.last('round')));
  live(room);
  const w = room.world;
  w._killPlayer(w.players[1], 0);
  tick(room);
  assert.ok(!('coop' in roundEnds(host).at(-1)));
  passHold(room);
  const me = host.last('matchEnd');
  assert.ok(!('coop' in me));
  assert.ok(!('monsters' in me.standings[0]));
});
