// The client half of the co-op modes (docs/SPEC.md Appendix C): the View and hudModel built from the optional snapshot keys, the
// glue decisions (kill feed, winning, the level intro), the lobby's start rule and the awards, and the bots' view of monsters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientGame } from '../../client/js/game.js';
import { deathText, deathAnnouncement, wonMatch, monsterIntro, stageName, MONSTER_NAMES, MONSTER_TIPS, isCoopMode, errorToast } from '../../client/js/glue.js';
import { startBlocker, computeAwards } from '../../client/js/ui.js';
import { World } from '../../shared/world.js';
import { BotBrain, DangerMap } from '../../shared/bots.js';
import { adventureLevel } from '../../shared/coop.js';
import { MONSTER_KINDS, STATE, TICK_RATE, MAX_PLAYERS, GRID_W as W } from '../../shared/constants.js';

const TICK_MS = 1000 / TICK_RATE;
const prow = (id, x, y, alive = true) => [id, x, y, 2, alive ? 2 : 0, 0, 0, 0, 0, 1, 2, 0, alive ? 0 : 10];
const round = (mode, players) => ({
  t: 'round', n: 3, seed: 1, theme: 'meadow', mode, w: 15, h: 13, grid: '.'.repeat(195), players, winsNeeded: 8, roundTime: 180, suddenDeath: false, serverTick: 0,
  coop: { mode, level: 3, of: 8, difficulty: 'normal' },
});
const snap = (k, o) => ({ t: 'snap', k, st: 1, cd: 0, r: 5000, sd: 0, gv: 0, ack: { 0: 0 }, p: [], b: [], f: [], i: [], fall: [], e: [], ...o });

function client(mode = 'adventure') {
  let t = 0;
  const game = new ClientGame({ me: 0, send: () => {}, now: () => t });
  game.reset(round(mode, [
    { id: 0, name: 'Mia', color: 0, team: 0, slot: 0, isBot: false, x: 1.5, y: 1.5 },
    { id: 1, name: 'Bolt', color: 1, team: mode === 'coop' ? 1 : 0, slot: 1, isBot: true, x: 13.5, y: 11.5 },
  ]));
  return { game, at: (ms) => { t = ms; return t; } };
}

test('the View carries the monsters (interpolated), the door once found, and lives / score / comebacks', () => {
  const { game, at } = client();
  game.onSnapshot(snap(30, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5, false)], m: [[4, 'puff', 5.5, 5.5, 1, 0, 1]], lv: 3, sc: 200, rp: [[1, 120]] }), at(0));
  game.onSnapshot(snap(33, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5, false)], m: [[4, 'puff', 5.65, 5.5, 1, 1, 1], [5, 'mini', 3.5, 3.5, 2, 3, 1]], dr: [7, 3, 1], lv: 3, sc: 300, rp: [[1, 117]] }), at(50));
  const v = game.getView(at(125));                                       // render tick 31.5: between the two snapshots
  assert.equal(v.monsters.length, 2);
  const m = v.monsters[0];
  assert.equal(m.kind, 'puff');
  assert.ok(m.x > 5.5 && m.x < 5.65, `interpolated between snapshots: ${m.x}`);
  assert.deepEqual([m.hurt, m.angry], [true, false]);
  assert.deepEqual([v.monsters[1].hurt, v.monsters[1].angry], [true, true]);
  assert.deepEqual({ ...v.door }, { tx: 7, ty: 3, open: true });
  assert.equal(v.coop.lives, 3);
  assert.equal(v.coop.score, 300);
  assert.ok(v.coop.respawn.get(1) > 100 && v.coop.respawn.get(1) <= 117);
  const hud = game.hudModel(v, [{ id: 0, wins: 2, connected: true, waiting: false }]);
  assert.deepEqual({ ...hud.coop }, { mode: 'adventure', level: 3, of: 8, lives: 3, score: 300, monsters: 2, foes: 0, door: 'open', respawnSec: 0, hurry: false });
  assert.equal(hud.players[1].respawnSec, 2);
  game.onSnapshot(snap(36, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)], m: [], lv: 3, sc: 300, rp: [] }), at(100));
  const after = game.getView(at(200));
  assert.equal(after.monsters.length, 0);
  assert.equal(after.door, null, 'a snapshot without `dr` means no door on screen');
});

test('a battle snapshot leaves the co-op View fields empty', () => {
  const { game, at } = client();
  game.onSnapshot(snap(30, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)] }), at(0));
  const v = game.getView(at(10));
  assert.deepEqual([v.monsters.length, v.door, v.coop], [0, null, null]);
  assert.equal(game.hudModel(v, []).coop, null);
});

test('coop hud: enemy bots are foes, and how many are left is counted', () => {
  const { game, at } = client('coop');
  game.onSnapshot(snap(30, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)], sc: 250 }), at(0));
  const hud = game.hudModel(game.getView(at(10)), []);
  assert.equal(hud.players[1].foe, true);
  assert.equal(hud.players[0].foe, false);
  assert.deepEqual([hud.coop.mode, hud.coop.foes, hud.coop.lives, hud.coop.score], ['coop', 1, -1, 250]);
});

test('a fighter coming back from a respawn is drawn where they stand up, not slid there from where they fell', () => {
  const { game, at } = client();
  game.onSnapshot(snap(30, { p: [prow(0, 1.5, 1.5), prow(1, 12.5, 9.5, false)], lv: 2, sc: 0, rp: [[1, 3]] }), at(0));
  game.onSnapshot(snap(33, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)], lv: 2, sc: 0, rp: [] }), at(50));
  const v = game.getView(at(50 + TICK_MS * 7.5));
  assert.deepEqual([v.players[1].x, v.players[1].y], [13.5, 11.5]);
});

test('glue: monster knock-outs in the kill feed, co-op wins, the intro of a level', () => {
  const ctx = { name: (id) => ['Mia', 'Bolt'][id], team: () => 0, teams: false, suddenDeath: false };
  assert.equal(deathText(['death', 0, -3, 1, 1], ctx), 'A monster caught Mia');
  assert.equal(deathAnnouncement(['death', 0, -3, 1, 1], ctx.name), 'A monster caught you.');
  assert.equal(deathText(['death', 0, 0, 1, 1], ctx), 'Mia blew themselves up');
  assert.equal(wonMatch({ reason: 'victory', winnerTeam: 0, standings: [], coop: { victory: true } }, 0), true);
  assert.equal(wonMatch({ reason: 'gameover', winnerTeam: null, standings: [{ id: 0, place: 1 }], coop: { victory: false } }, 0), false);
  assert.equal(stageName('adventure', 4), 'Level 4');
  assert.equal(stageName('coop', 2), 'Wave 2');
  assert.ok(isCoopMode('coop') && isCoopMode('adventure') && !isCoopMode('teams'));
  for (const kind of MONSTER_KINDS) assert.ok(MONSTER_NAMES[kind]);
  for (const kind of MONSTER_KINDS.filter((k) => k !== 'mini')) assert.ok(MONSTER_TIPS[kind]);
  const before = [1, 2].flatMap((l) => adventureLevel(l).monsters);
  assert.deepEqual(monsterIntro(adventureLevel(3).monsters, before), { kinds: ['puff', 'zippy', 'ghost'], fresh: ['ghost'] });
  assert.deepEqual(monsterIntro(adventureLevel(1).monsters, []).fresh, ['puff']);
  assert.match(errorToast('need_seat'), /free seat/);
});

test('lobby: one player can start a co-op mode; coop needs a free seat; the Monster Popper award', () => {
  const lobby = (mode, n) => ({ settings: { mode }, players: Array.from({ length: n }, (_, id) => ({ id, team: 0 })) });
  assert.equal(startBlocker(lobby('adventure', 1)), null);
  assert.equal(startBlocker(lobby('coop', 1)), null);
  assert.match(startBlocker(lobby('coop', MAX_PLAYERS)), /free seat/);
  assert.equal(startBlocker(lobby('adventure', MAX_PLAYERS)), null);
  assert.match(startBlocker(lobby('ffa', 1)), /at least 2/);
  const awards = computeAwards([
    { id: 0, name: 'Mia', monsters: 5, kills: 0, deaths: 1, selfKills: 0, blocks: 3, items: 1 },
    { id: 1, name: 'Bolt', monsters: 2, kills: 0, deaths: 2, selfKills: 1, blocks: 9, items: 0 },
  ]);
  assert.deepEqual(awards.find((a) => a.stat === 'monsters').player.id, 0);
});

// ---- Bots and monsters ---------------------------------------------------------------------------------

test('bots: a monster\'s tile and the tile it heads into are lethal for the horizon, tiles further out from about when it could arrive', () => {
  const w = new World({ seed: 3, mode: 'adventure', fighters: [{ id: 0, name: 'a', color: 0, team: 0, isBot: false }], coop: { level: 1 } });
  while (w.state === STATE.COUNTDOWN) w.tick();
  for (let i = 0; i < 195; i++) if (w.grid[i] === '+') w.grid[i] = '.';
  w.coop.monsters.length = 1;
  Object.assign(w.coop.monsters[0], { kind: 'puff', x: 7.5, y: 5.5, tx: 8, ty: 5, dir: 2 });
  const dz = new DangerMap().build(w);
  const T = w.tickNo;
  assert.ok(dz.lethal(7, 5, T, T + 200) && dz.lethal(8, 5, T + 1, T + 1), 'its tile and the next');
  assert.ok(dz.lethal(6, 5, T + 1, T + 1), 'next to it: at once');
  assert.ok(!dz.lethal(7, 3, T, T + 10) && dz.lethal(7, 3, T + 100, T + 100), 'two steps away: only from about when it could get there');
  assert.ok(!dz.lethal(7, 1, T, T + 250), 'out of its reach: never');
  assert.ok(!dz.lethal(1, 11, T, T + 250), 'far away: never');
  const ffa = new World({ seed: 3, fighters: [{ id: 0, name: 'a', color: 0, team: 0, isBot: false }, { id: 1, name: 'b', color: 1, team: 1, isBot: false }] });
  const plain = new DangerMap().build(ffa);
  let marked = 0;
  for (let i = 0; i < 195; i++) marked += plain.cnt[i];
  assert.equal(marked, 0, 'a battle board without bombs has nothing to fear');
});

test('bots: in the co-op modes a team-mate\'s bomb is harmless (but still a wall), their own is not; in team battles both are deadly', () => {
  const mk = (mode) => {
    const w = new World({ seed: 4, mode, coop: { level: 1 }, fighters: [{ id: 0, name: 'a', color: 0, team: 0, isBot: false }, { id: 1, name: 'b', color: 1, team: 0, isBot: false }, { id: 2, name: 'c', color: 2, team: 1, isBot: false }] });
    while (w.state === STATE.COUNTDOWN) w.tick();
    for (let i = 0; i < 195; i++) if (w.grid[i] === '+') w.grid[i] = '.';
    w.bombs.push({ id: 90, owner: 1, x: 5.5, y: 5.5, tx: 5, ty: 5, range: 2, fuse: 30, dir: 0, step: 0, pass: [], fly: null });
    w.bombs.push({ id: 91, owner: 0, x: 9.5, y: 5.5, tx: 9, ty: 5, range: 2, fuse: 30, dir: 0, step: 0, pass: [], fly: null });
    const dz = new DangerMap();
    dz.viewer = w.player(0);
    dz.build(w);
    return { dz, T: w.tickNo };
  };
  const coop = mk('coop');
  assert.ok(!coop.dz.lethal(6, 5, coop.T + 31, coop.T + 31), 'the team-mate\'s fire');
  assert.ok(coop.dz.closed(5 * W + 5, coop.T + 10), 'their bomb still blocks the way');
  assert.ok(coop.dz.lethal(10, 5, coop.T + 31, coop.T + 31), 'my own fire');
  const teams = mk('teams');
  assert.ok(teams.dz.lethal(6, 5, teams.T + 31, teams.T + 31));
});

test('bots: a helper walks to the open door, and level 1 is cleared by a lone bot on every seed', () => {
  let cleared = 0;
  let livesLost = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const w = new World({ seed, mode: 'adventure', fighters: [{ id: 0, name: 'a', color: 0, team: 0, isBot: false }], coop: { level: 1 } });
    const brain = new BotBrain({ level: 'normal', seed });
    let s = 0;
    while (w.state !== STATE.OVER && w.tickNo < 60 * 60 * 6) {
      if (w.state === STATE.PLAYING && w.player(0).alive) w.applyCmd(0, { s: ++s, ...brain.think(w, 0) });
      w.tick();
    }
    if (w.outcome?.reason === 'clear') cleared++;
    livesLost += w.eventsSince(0).filter((e) => e[0] === 'life').length;
  }
  assert.ok(cleared >= 11, `${cleared} of 12 cleared`);
  assert.ok(livesLost <= 6, `${livesLost} lives lost over 12 levels`);
});

test('bots: thinking in an adventure stays cheap (8 fighters, level 8)', () => {
  const w = new World({ seed: 9, mode: 'adventure', fighters: Array.from({ length: 8 }, (_, id) => ({ id, name: `p${id}`, color: id, team: 0, isBot: id > 0 })), coop: { level: 8 } });
  const brains = w.players.map((p) => new BotBrain({ level: 'hard', seed: p.id + 1 }));
  let calls = 0;
  let ms = 0;
  for (let s = 1; s <= 1800 && w.state !== STATE.OVER; s++) {
    if (w.state === STATE.PLAYING) {
      w.players.forEach((p, i) => {
        if (!p.alive) return;
        const t0 = performance.now();
        const c = brains[i].think(w, p.id);
        ms += performance.now() - t0;
        calls++;
        w.applyCmd(p.id, { s, ...c });
      });
    }
    w.tick();
  }
  assert.ok(calls > 1000);
  assert.ok(ms / calls < 0.25, `${(ms / calls).toFixed(3)} ms per think`);
});
