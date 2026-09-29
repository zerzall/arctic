import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { World } from '../../shared/world.js';
import { BotBrain, DangerMap, hypothetical } from '../../shared/bots.js';
import { STATE, GRID_W, GRID_H, FUSE_TICKS, FLAME_TICKS } from '../../shared/constants.js';
import { playRound, playSeries, summarize, runGates, winnerLevel } from '../../scripts/dev/bots/arena.mjs';

// Bots (docs/SPEC.md §6, §6.1). Three layers: the contract of think(), hand-built boards that pin down one behaviour each (the bot
// under test drives player 0 for real, through World.applyCmd and World.tick), and a small arena battery for the quality gates.

const W = GRID_W;

// ---- Scenes ----------------------------------------------------------------------------------------

/**
 * A board with the classic pillars, no blocks and no items (or the given terrain rows), every fighter standing still on the given
 * tile without any protection. Fighter 0 is the one under test; `dummy` is parked out of the way so that the round does not end.
 */
function scene({ rows = null, players = [{ tx: 1, ty: 1 }, { tx: 13, ty: 11 }], mode = 'ffa', roundTime = 0, seed = 5 } = {}) {
  const fighters = players.map((_, i) => ({ id: i, name: `P${i}`, color: i, team: mode === 'teams' ? i % 2 : i, isBot: true, lastSeq: 0 }));
  const world = new World({ seed, fighters, mode, blocks: 'none', items: 'none', roundTime });
  while (world.state === STATE.COUNTDOWN) world.tick();
  if (rows) {
    assert.equal(rows.length, GRID_H);
    rows.forEach((row, y) => { assert.equal(row.length, GRID_W); for (let x = 0; x < GRID_W; x++) world.grid[y * W + x] = row[x]; });
  } else {
    for (let i = 0; i < world.grid.length; i++) if (world.grid[i] === '+') world.grid[i] = '.';
  }
  world.gridVer++;
  world.items.length = 0;
  players.forEach(({ tx, ty, ...props }, i) => {
    const p = world.player(i);
    Object.assign(p, { x: tx + 0.5, y: ty + 0.5, shield: 0, spawnShield: 0, moving: false }, props);
  });
  return world;
}

function addBomb(world, tx, ty, { owner = 1, fuse = FUSE_TICKS, range = 2 } = {}) {
  const bomb = { id: world._nextBombId++, owner, x: tx + 0.5, y: ty + 0.5, tx, ty, range, fuse, dir: 0, step: 0, pass: [], fly: null };
  world.bombs.push(bomb);
  return bomb;
}

function addFlame(world, tx, ty, ticks) {
  const rec = { tx, ty, ticks, mask: 15, owners: [1] };
  world._flameGrid[ty * W + tx] = rec;
  world.flames.push(rec);
}

function addItem(world, tx, ty, kind) {
  world.items.push({ id: world._nextItemId++, tx, ty, kind, born: world.tickNo });
}

/** Plays `ticks` ticks with a brain of `level` on fighter 0 (others idle). Returns what the brain did. */
function drive(world, { level = 'normal', seed = 1, ticks = 300, ids = [0], until = null } = {}) {
  const brains = ids.map((id) => new BotBrain({ level, seed: seed + id }));
  const seen = { bombs: 0, throws: 0, ticks: 0, cmds: [] };
  for (let k = 0; k < ticks && world.state === STATE.PLAYING; k++) {
    ids.forEach((id, j) => {
      if (!world.player(id).alive) return;
      const cmd = brains[j].think(world, id);
      seen.bombs += cmd.b;
      seen.throws += cmd.x;
      if (id === 0) seen.cmds.push(cmd);
      world.applyCmd(id, { s: k + 1, d: cmd.d, b: cmd.b, x: cmd.x });
    });
    world.tick();
    seen.ticks++;
    if (until && until(world)) break;
  }
  return seen;
}

const LEVELS = ['easy', 'normal', 'hard'];

// ---- Contract -----------------------------------------------------------------------------------------

test('think returns a { d, b, x } command with d in 0..4 and b, x in {0, 1}, every tick of a real round', () => {
  const world = scene({ players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 1 }, { tx: 1, ty: 11 }, { tx: 13, ty: 11 }], roundTime: 120 });
  for (const level of LEVELS) {
    const brain = new BotBrain({ level, seed: 3 });
    for (let k = 0; k < 40; k++) {
      const cmd = brain.think(world, 0);
      assert.deepEqual(Object.keys(cmd).sort(), ['b', 'd', 'x']);
      assert.ok(Number.isInteger(cmd.d) && cmd.d >= 0 && cmd.d <= 4, `d=${cmd.d}`);
      assert.ok(cmd.b === 0 || cmd.b === 1);
      assert.ok(cmd.x === 0 || cmd.x === 1);
    }
  }
});

test('think is idle when the fighter is dead, unknown, or the round is not being played', () => {
  const world = scene();
  const brain = new BotBrain({ level: 'hard', seed: 1 });
  assert.deepEqual(brain.think(world, 99), { d: 0, b: 0, x: 0 });
  world.player(0).alive = false;
  assert.deepEqual(brain.think(world, 0), { d: 0, b: 0, x: 0 });
  world.player(0).alive = true;
  world.state = STATE.COUNTDOWN;
  assert.deepEqual(brain.think(world, 0), { d: 0, b: 0, x: 0 });
  world.state = STATE.ENDING;
  assert.deepEqual(brain.think(world, 0), { d: 0, b: 0, x: 0 });
});

test('think never changes the world it reads', () => {
  for (const level of LEVELS) {
    const world = new World({
      seed: 11, fighters: [0, 1, 2, 3].map((i) => ({ id: i, name: `P${i}`, color: i, team: i, isBot: true, lastSeq: 0 })), roundTime: 120,
    });
    const brains = [0, 1, 2, 3].map((i) => new BotBrain({ level, seed: i }));
    for (let k = 0; k < 900; k++) {
      if (world.state === STATE.PLAYING) {
        const before = JSON.stringify(world.snapshot({ grid: true }));
        const cmds = brains.map((brain, i) => brain.think(world, i));
        assert.equal(JSON.stringify(world.snapshot({ grid: true })), before, `${level} changed the world at tick ${world.tickNo}`);
        cmds.forEach((cmd, i) => world.applyCmd(i, { s: k + 1, ...cmd }));
      }
      world.tick();
    }
  }
});

test('the same seed plays the same round; another seed plays another', () => {
  const play = (botSeed) => playRound({ seed: 21, levels: ['hard', 'normal', 'easy', 'hard'], roundTime: 40, factory: ({ level, seed }) => new BotBrain({ level, seed: seed + botSeed }) });
  const a = play(0);
  const b = play(0);
  assert.equal(a.ticks, b.ticks);
  assert.deepEqual(a.deaths, b.deaths);
  assert.deepEqual(a.stats, b.stats);
  const c = play(77);
  assert.notDeepEqual([c.ticks, c.deaths], [a.ticks, a.deaths]);
});

test('an unknown level plays as normal', () => {
  const a = new BotBrain({ level: 'godlike', seed: 1 });
  const b = new BotBrain({ level: 'normal', seed: 1 });
  const wa = scene();
  const wb = scene();
  for (let k = 0; k < 60; k++) {
    const ca = a.think(wa, 0);
    const cb = b.think(wb, 0);
    assert.deepEqual(ca, cb);
    wa.applyCmd(0, { s: k + 1, ...ca });
    wb.applyCmd(0, { s: k + 1, ...cb });
    wa.tick();
    wb.tick();
  }
});

// ---- The danger map ------------------------------------------------------------------------------------

const CORRIDOR = [
  '###############',
  '#.............#',
  ...Array(11).fill('###############'),
].slice(0, GRID_H);

test('DangerMap: a bomb is lethal on its cross from the tick it explodes for exactly FLAME_TICKS ticks', () => {
  const world = scene({ rows: CORRIDOR, players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 1 }] });
  const T = world.tickNo;
  addBomb(world, 5, 1, { fuse: 10, range: 3 });
  const dz = new DangerMap().build(world);
  for (const x of [2, 3, 4, 5, 6, 7, 8]) {
    assert.equal(dz.lethal(x, 1, T + 9), false, `x=${x} before the blast`);
    assert.equal(dz.lethal(x, 1, T + 10), true, `x=${x} at the blast`);
    assert.equal(dz.lethal(x, 1, T + 10 + FLAME_TICKS - 1), true, `x=${x} at the last flame tick`);
    assert.equal(dz.lethal(x, 1, T + 10 + FLAME_TICKS), false, `x=${x} after the flame`);
  }
  assert.equal(dz.lethal(1, 1, T, T + 100), false, 'out of range');
  assert.equal(dz.lethal(9, 1, T, T + 100), false, 'out of range');
});

test('DangerMap: chain reactions are resolved in time order', () => {
  const world = scene({ rows: CORRIDOR, players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 1 }] });
  const T = world.tickNo;
  addBomb(world, 4, 1, { fuse: 10, range: 2 });
  addBomb(world, 6, 1, { fuse: 100, range: 2 });
  const dz = new DangerMap().build(world);
  assert.equal(dz.lethal(8, 1, T + 10), true, 'the second bomb goes off with the first');
  assert.equal(dz.lethal(8, 1, T + 9), false);
  assert.equal(dz.lethal(8, 1, T + 10 + FLAME_TICKS - 1), true);
  assert.equal(dz.lethal(8, 1, T + 100), false, 'the second bomb is gone: it does not explode a second time at its own fuse');
});

test('DangerMap: hard walls and soft blocks stop a blast, and a block that already burned no longer does', () => {
  const rows = CORRIDOR.slice();
  rows[1] = '#....#..+.....#';
  const world = scene({ rows, players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 1 }] });
  const T = world.tickNo;
  addBomb(world, 3, 1, { fuse: 10, range: 6 });
  const wall = new DangerMap().build(world);
  assert.equal(wall.lethal(4, 1, T + 10), true);
  assert.equal(wall.lethal(5, 1, T + 10), false, 'hard wall');
  assert.equal(wall.lethal(6, 1, T + 10), false);

  rows[1] = '#.......+.....#';
  const block = scene({ rows, players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 1 }] });
  addBomb(block, 4, 1, { fuse: 20, range: 7 });
  const alone = new DangerMap().build(block);
  assert.equal(alone.lethal(8, 1, T + 20), true, 'the block itself burns');
  assert.equal(alone.lethal(9, 1, T + 20), false, 'but stops the flame');

  // A bomb next to the block goes off first and opens it: the later blast now reaches through.
  addBomb(block, 9, 1, { fuse: 10, range: 1 });
  const opened = new DangerMap().build(block);
  assert.equal(opened.lethal(11, 1, T + 20), true);
  assert.equal(alone.lethal(11, 1, T + 20), false);
});

test('DangerMap: lingering flames are lethal for the ticks they have left, and a hypothetical bomb is added on request', () => {
  const world = scene({ rows: CORRIDOR, players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 1 }] });
  const T = world.tickNo;
  addFlame(world, 6, 1, 12);
  const dz = new DangerMap().build(world);
  assert.equal(dz.lethal(6, 1, T + 1), true);
  assert.equal(dz.lethal(6, 1, T + 12), true);
  assert.equal(dz.lethal(6, 1, T + 13), false);
  assert.equal(dz.lethal(6, 1, T), false, 'a flame with n ticks left is lethal on ticks T+1..T+n');

  const dh = new DangerMap().build(world, [hypothetical(3, 1, 2, T, FUSE_TICKS)]);
  assert.equal(dh.lethal(5, 1, T + FUSE_TICKS), true);
  assert.equal(dz.lethal(5, 1, T + FUSE_TICKS), false, 'the real board is untouched');
});

// ---- Survival ------------------------------------------------------------------------------------------

test('flees a bomb that is about to explode next to it (all levels)', () => {
  for (const level of LEVELS) {
    const world = scene({ players: [{ tx: 3, ty: 1 }, { tx: 13, ty: 11 }] });
    addBomb(world, 2, 1, { fuse: 40, range: 3 });
    drive(world, { level, ticks: 200 });
    assert.ok(world.player(0).alive, `${level} died next to a bomb`);
  }
});

test('flees a chain: the second bomb makes a flame the first one alone would not', () => {
  for (const level of ['normal', 'hard']) {
    const world = scene({ players: [{ tx: 7, ty: 5 }, { tx: 13, ty: 11 }] });
    addBomb(world, 7, 3, { fuse: 30, range: 2 });
    addBomb(world, 9, 3, { fuse: 140, range: 4 });
    addBomb(world, 5, 3, { fuse: 140, range: 4 });
    drive(world, { level, ticks: 260 });
    assert.ok(world.player(0).alive, `${level} died in a chain`);
  }
});

test('waits for a flame to die out instead of walking into it, then goes on', () => {
  for (const level of ['normal', 'hard']) {
    const rows = CORRIDOR.slice();
    rows[1] = '#.............#';
    const world = scene({ rows, players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 1 }] });
    addFlame(world, 4, 1, 30);
    addItem(world, 6, 1, 'flame');
    drive(world, { level, ticks: 200, until: (w) => w.items.length === 0 });
    assert.ok(world.player(0).alive, `${level} walked into the flame`);
    assert.equal(world.items.length, 0, `${level} never got the item behind the flame`);
  }
});

test('does not bomb where it cannot get away, and does not die trying (escape before bomb)', () => {
  const rows = Array(GRID_H).fill('#'.repeat(GRID_W));
  rows[1] = '#..+###########';
  rows[3] = '#.....#########';
  const cul = rows.map((r) => r.padEnd(GRID_W, '#'));
  for (const level of LEVELS) {
    const world = scene({ rows: cul, players: [{ tx: 1, ty: 1 }, { tx: 3, ty: 3 }] });
    const seen = drive(world, { level, ticks: 1500 });
    assert.equal(seen.bombs, 0, `${level} bombed in a dead end`);
    assert.ok(world.player(0).alive);
  }
});

test('bombs a block it can escape from, and survives its own bomb', () => {
  for (const level of LEVELS) {
    const world = scene({ players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 11 }] });
    world.grid[1 * W + 3] = '+';
    const seen = drive(world, { level, ticks: 700 });
    assert.ok(world.player(0).alive, `${level} killed itself`);
    assert.ok(seen.bombs >= 1, `${level} never bombed`);
    assert.ok(world.player(0).stats.blocks >= 1, `${level} opened nothing`);
  }
});

test('walks to an item and takes it', () => {
  for (const level of LEVELS) {
    const world = scene({ players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 11 }] });
    addItem(world, 2, 1, 'speed');
    drive(world, { level, ticks: 240, until: (w) => w.items.length === 0 });
    assert.equal(world.player(0).speedLv, 1, `${level} left the item`);
  }
  const far = scene({ players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 11 }] });
  addItem(far, 9, 1, 'bomb');
  drive(far, { level: 'hard', ticks: 400, until: (w) => w.items.length === 0 });
  assert.equal(far.player(0).bombsMax, 2, 'hard fetches an item that is far away');
});

test('hard leaves a skull where it lies', () => {
  const world = scene({ players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 11 }] });
  addItem(world, 3, 1, 'skull');
  drive(world, { level: 'hard', ticks: 300 });
  assert.equal(world.player(0).curse, null);
  assert.equal(world.items.length, 1, 'the skull is left where it is');
});

// ---- Kick and throw ---------------------------------------------------------------------------------------

test('kicks the bomb that blocks its only way out (kick)', () => {
  for (const level of ['normal', 'hard']) {
    const rows = CORRIDOR.slice();
    const world = scene({ rows, players: [{ tx: 1, ty: 1, kick: true }, { tx: 13, ty: 1 }] });
    const bomb = addBomb(world, 2, 1, { fuse: 60, range: 3 });
    drive(world, { level, ticks: 200 });
    assert.ok(world.player(0).alive, `${level} stayed for the blast`);
    assert.ok(bomb.tx > 2 || !world.bombs.includes(bomb), `${level} never kicked it`);
  }
});

test('throws a bomb away with the glove when it is the only way out', () => {
  const rows = CORRIDOR.slice();
  const world = scene({ rows, players: [{ tx: 1, ty: 1, glove: true, facing: 1 }, { tx: 13, ty: 1 }] });
  addBomb(world, 2, 1, { fuse: 60, range: 2 });
  const seen = drive(world, { level: 'hard', ticks: 200 });
  assert.ok(world.player(0).alive);
  assert.ok(seen.throws >= 1);
});

// ---- Curses ----------------------------------------------------------------------------------------------

test('normal and hard compensate reverse: they still get where they want to go', () => {
  for (const level of ['normal', 'hard']) {
    const world = scene({ players: [{ tx: 1, ty: 1, curse: 'reverse', curseTicks: 900 }, { tx: 13, ty: 11 }] });
    addItem(world, 5, 1, 'flame');
    drive(world, { level, ticks: 300, until: (w) => w.items.length === 0 });
    assert.equal(world.items.length, 0, `${level} could not reach the item under reverse`);
  }
});

test('under rush a bot still flees and still stops', () => {
  for (const level of ['normal', 'hard']) {
    const world = scene({ players: [{ tx: 3, ty: 1, curse: 'rush', curseTicks: 900 }, { tx: 13, ty: 11 }] });
    addBomb(world, 2, 1, { fuse: 50, range: 3 });
    drive(world, { level, ticks: 240 });
    assert.ok(world.player(0).alive, `${level} died under rush`);
  }
});

test('nobomb: a cursed bot never presses the bomb button', () => {
  const world = scene({ players: [{ tx: 1, ty: 1, curse: 'nobomb', curseTicks: 400 }, { tx: 13, ty: 11 }] });
  world.grid[1 * W + 3] = '+';
  const seen = drive(world, { level: 'hard', ticks: 300 });
  assert.equal(seen.ticks, 300);
  assert.equal(seen.bombs, 0);
});

// ---- Stalemate, teams, layouts, sudden death -------------------------------------------------------------

test('the stall breaker: a normal or hard bot with nothing to do still ends up bombing (safely) after a while', () => {
  for (const level of ['normal', 'hard']) {
    const world = scene({ players: [{ tx: 1, ty: 1 }, { tx: 13, ty: 11 }] });
    const seen = drive(world, { level, ticks: 1800 });
    assert.ok(world.player(0).alive, `${level} died while idling`);
    assert.ok(seen.bombs >= 1, `${level} never left the stalemate`);
  }
});

test('team mode: rounds finish without an exception, and the bots hunt the other team', () => {
  const records = playSeries({ count: 4, baseSeed: 3, levels: ['hard', 'normal', 'hard', 'normal'], mode: 'teams', roundTime: 60 });
  const sum = summarize(records);
  assert.deepEqual(sum.errors, []);
  assert.equal(sum.timeouts, 0);
  assert.ok(sum.total.enemy + sum.total.sd > 0);
  assert.ok(sum.total.team <= 1, `team kills: ${sum.total.team}`);
});

test('the open layout and an unlimited clock play out without an exception', () => {
  const open = summarize(playSeries({ count: 3, baseSeed: 9, levels: ['hard', 'normal', 'easy', 'hard'], layout: 'open', roundTime: 60 }));
  assert.deepEqual(open.errors, []);
  assert.equal(open.timeouts, 0);
  const unlimited = playRound({ seed: 4, levels: ['hard', 'normal'], roundTime: 0, suddenDeath: false });
  assert.deepEqual(unlimited.errors, []);
  assert.ok(unlimited.outcome, 'somebody wins, or the round is drawn, but it ends');
});

test('sudden death is decisive: bots take their positions and the round is settled before the last tile falls', () => {
  const records = playSeries({ count: 6, baseSeed: 2, levels: ['hard', 'hard'], roundTime: 20 });
  const reached = records.filter((r) => r.sdStart >= 0);
  assert.ok(reached.length >= 3, 'sudden death is reached in some rounds');
  for (const r of records) {
    assert.deepEqual(r.errors, []);
    assert.ok(r.endedBeforeSdDone, `seed ${r.seed} played the whole spiral`);
    assert.notEqual(winnerLevel(r), 'draw', `seed ${r.seed} was drawn`);
  }
});

// ---- CPU ---------------------------------------------------------------------------------------------------

test('hard thinks in well under 0.25 ms on average, with eight bots on the board too', () => {
  const four = summarize(playSeries({ count: 2, baseSeed: 5, levels: ['hard', 'hard', 'hard', 'hard'], roundTime: 60 }));
  const hard = four.byLevel.hard;
  assert.ok(hard.thinkNs / hard.thinkCalls < 250000, `${hard.thinkNs / hard.thinkCalls} ns`);
  const eight = summarize(playSeries({ count: 1, baseSeed: 5, levels: Array(8).fill('hard'), roundTime: 60 }));
  assert.deepEqual(eight.errors, []);
  assert.ok(eight.byLevel.hard.thinkNs / eight.byLevel.hard.thinkCalls < 250000);
});

// ---- The quality gates of SPEC §6, on a reduced count ------------------------------------------------------

test('quality gates (reduced count; scripts/dev/bots/arena.mjs --gates runs the full 30)', { timeout: 60000 }, async () => {
  const { verdicts } = await runGates({ count: 14, baseSeed: 1, workers: Math.min(4, availableParallelism()) });
  for (const v of verdicts) assert.ok(v.pass, `${v.gate}: ${v.value}${v.unit ?? ''} (limit ${v.limit}${v.unit ?? ''})`);
});
