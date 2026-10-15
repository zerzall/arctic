// The co-op rules of the World (docs/SPEC.md Appendix C, shared/coop.js): monsters, the exit door, shared lives and comebacks, level
// and wave plans, no friendly fire, the outcome of a co-op round, the co-op snapshot keys. The battle modes are checked to be untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World } from '../../shared/world.js';
import { makeRng } from '../../shared/rng.js';
import { BotBrain } from '../../shared/bots.js';
import { M, MF, EVENT_ARGS, decodeMonster } from '../../shared/protocol.js';
import {
  adventureLevel, ADVENTURE_TABLE, coopWavePlan, coopWaveItems, coopTeamStart, startingLives, assignSidedSlots, MONSTER_KILLER,
} from '../../shared/coop.js';
import * as C from '../../shared/constants.js';

const { STATE, GRID_W: W, GRID_H: H, MONSTER_DEFS, MONSTER_KINDS, RESPAWN_TICKS, SPAWN_SHIELD_TICKS, CLEAR_POINTS, ENEMY_POINTS } = C;

const fighter = (id, over = {}) => ({ id, name: `P${id}`, color: id, team: 0, isBot: false, lastSeq: 0, ...over });
const adventure = ({ seed = 7, n = 1, level = 1, difficulty = 'normal', lives, fighters } = {}) => new World({
  seed, mode: 'adventure', fighters: fighters ?? Array.from({ length: n }, (_, i) => fighter(i)), coop: { level, difficulty, ...(lives !== undefined ? { lives } : {}) },
});
const coop = ({ seed = 7, team = 1, foes = 1, roundTime = 120, suddenDeath = true } = {}) => new World({
  seed, mode: 'coop', roundTime, suddenDeath, coop: { level: 1 },
  fighters: [...Array.from({ length: team }, (_, i) => fighter(i)), ...Array.from({ length: foes }, (_, i) => fighter(team + i, { team: 1, isBot: true }))],
});
const live = (w) => { while (w.state === STATE.COUNTDOWN) w.tick(); return w; };
const cmd = (w, id, d = 0, b = 0) => w.applyCmd(id, { s: w.player(id).lastSeq + 1, d, b, x: 0 });
const put = (w, id, tx, ty) => { const p = w.player(id); p.x = tx + 0.5; p.y = ty + 0.5; };
const events = (w, from = 0) => w.eventsSince(from);
const ofKind = (w, code) => w.eventsSince(0).filter((e) => e[0] === code);
/** A quiet board: monsters parked on the far side, so a test controls who meets whom. */
const park = (w) => { for (const m of w.coop.monsters) { m.x = 12.5; m.y = 11.5; m.tx = 12; m.ty = 11; m.dir = 0; m.stun = 1e9; } };
const clearTile = (w, tx, ty) => { w.grid[ty * W + tx] = '.'; };

/** A bomb owned by `owner` on (tx, ty) that goes off on the next tick. */
function bombNow(w, owner, tx, ty, range = 2) {
  const b = { id: w._nextBombId++, owner, x: tx + 0.5, y: ty + 0.5, tx, ty, range, fuse: 1, dir: 0, step: 0, pass: [], fly: null };
  w.bombs.push(b);
  return b;
}

// ---- Plans: levels and waves --------------------------------------------------------------------------

test('adventure levels: monsters come in gradually, harder levels bring more, the table has every kind', () => {
  assert.equal(ADVENTURE_TABLE.length, C.ADVENTURE_LEVELS);
  const firstSeen = {};
  for (let level = 1; level <= C.ADVENTURE_LEVELS; level++) {
    for (const kind of adventureLevel(level).monsters) firstSeen[kind] ??= level;
  }
  assert.deepEqual(firstSeen, { puff: 1, zippy: 2, ghost: 3, tank: 4, jelly: 5 });
  assert.deepEqual(adventureLevel(1).monsters, ['puff', 'puff', 'puff']);
  const count = (l, d, t) => adventureLevel(l, d, t).monsters.length;
  assert.ok(count(8) > count(1) && count(5) >= count(3));
  assert.ok(count(4, 'easy') < count(4, 'normal') && count(4, 'hard') > count(4, 'normal'), 'difficulty moves the count');
  assert.ok(count(4, 'normal', 5) > count(4, 'normal', 1), 'bigger teams meet more monsters');
  for (const l of ADVENTURE_TABLE) assert.ok(l.drops > 0 && l.drops <= 1);
  assert.ok(ADVENTURE_TABLE.at(-1).drops < ADVENTURE_TABLE[0].drops, 'later levels drop fewer power-ups');
  assert.deepEqual(adventureLevel(99), adventureLevel(C.ADVENTURE_LEVELS), 'past the table the last level repeats');
});

test('coop waves: as many bots as the team at first, more and smarter later, never more than the free seats', () => {
  assert.deepEqual(coopWavePlan(1, 'normal', 1).map((f) => f.level), ['easy']);
  assert.equal(coopWavePlan(1, 'normal', 3).length, 3);
  assert.equal(coopWavePlan(1, 'hard', 3).length, 4);
  assert.ok(coopWavePlan(5, 'normal', 2).length > coopWavePlan(1, 'normal', 2).length);
  for (let side = 1; side <= 7; side++) for (let n = 1; n <= 7; n++) {
    const plan = coopWavePlan(n, 'hard', side);
    assert.ok(plan.length >= 1 && side + plan.length <= C.MAX_PLAYERS, `side ${side} wave ${n}`);
  }
  assert.ok(coopWavePlan(7, 'easy', 2).every((f) => f.level !== 'hard'), 'easy never brings hard bots');
  assert.ok(coopWavePlan(7, 'hard', 2).some((f) => f.level === 'hard'));
  assert.deepEqual(coopWavePlan(1, 'normal', 1)[0].start, { bombsMax: 1, range: 2, speedLv: 0, kick: false });
  assert.ok(coopWavePlan(5, 'normal', 1)[0].start.range > 2, 'later waves start with power-ups');
  assert.equal(coopWaveItems(1, 'many'), 'many');
  assert.equal(coopWaveItems(4, 'many'), 'normal');
  assert.equal(coopWaveItems(9, 'normal'), 'few');
  assert.equal(coopWaveItems(9, 'none'), 'none');
  assert.deepEqual(coopTeamStart('easy', null), { bombsMax: 2, range: 3, speedLv: 1 });
  assert.equal(coopTeamStart('normal', undefined), undefined);
  assert.equal(startingLives('normal', 1), 3);
  assert.equal(startingLives('easy', 3), 7);
});

test('sided spawns: the team fills the left side first, the enemies the right', () => {
  const fighters = [fighter(0), fighter(1), fighter(2, { team: 1 }), fighter(3, { team: 1 })];
  const slots = assignSidedSlots(fighters, makeRng(3));
  for (const i of [0, 1]) assert.ok([0, 3, 6].includes(slots[i]));
  for (const i of [2, 3]) assert.ok([1, 2, 7].includes(slots[i]));
  assert.equal(new Set(slots).size, 4);
});

// ---- The adventure board ----------------------------------------------------------------------------

test('an adventure level: the door hides under a crate away from the start, monsters stand on floor far from the team', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const level of [1, 4, 8]) {
      const w = adventure({ seed, level, n: 1 + (seed % 4) });
      const door = w.door;
      assert.ok(door && !door.revealed && !door.open);
      assert.equal(w.grid[door.ty * W + door.tx], '+', 'the door is under a crate');
      assert.equal(w._drops[door.ty * W + door.tx], null, 'and that crate hides nothing else');
      assert.equal(w.monsters.length, adventureLevel(level, 'normal', w.players.length).monsters.length);
      for (const m of w.monsters) {
        assert.equal(w.grid[m.ty * W + m.tx], '.', 'monsters start on floor');
        for (const p of w.players) assert.ok(Math.abs(Math.floor(p.x) - m.tx) + Math.abs(Math.floor(p.y) - m.ty) >= 3, `seed ${seed}: monster too close`);
      }
      assert.equal(w.roundTime, C.ADVENTURE_TIME);
      assert.equal(w.sdEnabled, false, 'no sudden death in an adventure');
      assert.ok(w.players.every((p) => p.team === 0));
    }
  }
});

test('the battle modes have no monsters, no door and no co-op snapshot keys', () => {
  const w = new World({ seed: 3, fighters: [fighter(0), fighter(1, { team: 1 })] });
  assert.equal(w.coop, null);
  assert.deepEqual(w.monsters, []);
  assert.equal(w.door, null);
  const snap = w.snapshot({ grid: true });
  for (const key of ['m', 'dr', 'lv', 'sc', 'rp']) assert.ok(!(key in snap), key);
  assert.ok(!('monsters' in w.player(0).stats), 'battle stats keep their shape');
});

// ---- Monsters move ----------------------------------------------------------------------------------

test('monsters walk tile to tile: never into walls or bombs, crates only for ghosts, along tile-centre lanes', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const w = live(adventure({ seed, level: 5 + (seed % 4), n: 2 }));
    for (const p of w.players) p.shield = C.SHIELD_FOREVER;            // nobody gets caught: the monsters keep walking for the whole test
    const rng = makeRng(seed);
    for (let t = 0; t < 2400; t++) {
      if (rng.int(90) === 0) {                                          // drop a bomb somewhere free now and then
        const tx = 1 + rng.int(13), ty = 1 + rng.int(11);
        if (w.grid[ty * W + tx] === '.' && !w._bombAtTile(tx, ty)) bombNow(w, -1, tx, ty).fuse = 120;
      }
      w.tick();
      for (const m of w.monsters) {
        const cx = Math.floor(m.x), cy = Math.floor(m.y);
        const c = w.grid[cy * W + cx];
        assert.ok(c === '.' || (c === '+' && MONSTER_DEFS[m.kind].ghost), `seed ${seed} t ${t}: ${m.kind} inside '${c}'`);
        const offX = Math.abs(m.x - (cx + 0.5)), offY = Math.abs(m.y - (cy + 0.5));
        assert.ok(offX < 1e-9 || offY < 1e-9, `seed ${seed}: ${m.kind} off its lanes at ${m.x},${m.y}`);
        assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
      }
      if (w.state !== STATE.PLAYING) break;
    }
  }
});

test('a bomb dropped ahead of a monster turns it round', () => {
  const w = live(adventure({ seed: 2 }));
  const m = w.monsters[0];
  w.coop.monsters.length = 1;
  for (let x = 1; x < W - 1; x++) w.grid[5 * W + x] = '.';           // a straight corridor on row 5
  Object.assign(m, { x: 4.5, y: 5.5, tx: 5, ty: 5, dir: 2, facing: 1, stun: 0, wait: 0 });
  w.tick();
  bombNow(w, -1, 5, 5).fuse = 200;
  w.tick();
  assert.equal(m.dir, 4, 'heading back west');
  for (let i = 0; i < 40; i++) w.tick();
  assert.ok(m.x < 5, `it never entered the bomb tile (x ${m.x})`);
});

test('chasers head for a nearby fighter, wanderers do not care', () => {
  const near = (kind) => {
    let closer = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = live(adventure({ seed }));
      for (const p of w.players) p.shield = C.SHIELD_FOREVER;
      for (let i = 0; i < W * H; i++) if (w.grid[i] === '+') w.grid[i] = '.';
      w.coop.monsters.length = 1;
      const m = w.coop.monsters[0];
      Object.assign(m, { kind, x: 7.5, y: 5.5, tx: 7, ty: 5, dir: 0, speed: MONSTER_DEFS[kind].speed, angry: false, stun: 0 });
      put(w, 0, 3, 5);
      const d0 = Math.abs(m.x - 3.5) + Math.abs(m.y - 5.5);
      for (let t = 0; t < 120; t++) w.tick();
      if (Math.abs(m.x - 3.5) + Math.abs(m.y - 5.5) < d0 - 1) closer++;
    }
    return closer;
  };
  assert.ok(near('zippy') >= 15, `zippies came closer in ${near('zippy')} of 20`);
  assert.ok(near('puff') < near('zippy'));
});

test('monster runs are deterministic: same seed and inputs, byte-identical snapshots', () => {
  const play = () => {
    const w = adventure({ seed: 11, level: 6, n: 3 });
    const brains = w.players.map((p) => new BotBrain({ level: 'normal', seed: 100 + p.id }));
    const sha = createHash('sha1');
    let cursor = 0;
    for (let t = 0; t < 2400 && w.state !== STATE.OVER; t++) {
      if (w.state === STATE.PLAYING) w.players.forEach((p, i) => { if (p.alive) { const c = brains[i].think(w, p.id); w.applyCmd(p.id, { s: t + 1, ...c }); } });
      w.tick();
      sha.update(JSON.stringify(w.snapshot({ grid: true, evFrom: cursor })));
      cursor = w.evCount;
    }
    return sha.digest('hex');
  };
  assert.equal(play(), play());
});

// ---- Monsters and fighters ----------------------------------------------------------------------------

test('touching a monster knocks a fighter out (killer -3); a shield holds', () => {
  const w = live(adventure({ seed: 4, n: 2 }));
  park(w);
  const m = w.coop.monsters[0];
  const p = w.player(0);
  p.spawnShield = 0;
  Object.assign(m, { x: p.x + 0.4, y: p.y, stun: 1e9 });
  w.tick();
  const death = ofKind(w, 'death').at(-1);
  assert.deepEqual(death.slice(0, 3), ['death', 0, MONSTER_KILLER]);
  const q = w.player(1);
  q.spawnShield = 0;
  q.shield = 200;
  Object.assign(m, { x: q.x, y: q.y + 0.3 });
  w.tick();
  assert.ok(q.alive);
  assert.ok(ofKind(w, 'shieldhit').some((e) => e[1] === 1));
});

test('flames pop monsters for points; a tank takes two hits and gets angry; a jelly bursts into two minis', () => {
  const w = live(adventure({ seed: 5, level: 8 }));
  park(w);
  const p = w.player(0);
  p.shield = C.SHIELD_FOREVER;
  const kinds = new Map(w.monsters.map((m) => [m.kind, m]));
  const zap = (m, tx, ty) => { Object.assign(m, { x: tx + 0.5, y: ty + 0.5, tx, ty, dir: 0, stun: 1e9 }); clearTile(w, tx, ty); bombNow(w, 0, tx, ty); w.tick(); };
  const tank = kinds.get('tank');
  zap(tank, 3, 3);
  assert.equal(tank.hp, 1);
  assert.ok(tank.angry && tank.hurt > C.FLAME_TICKS, 'angry, and invulnerable for longer than the fire lasts');
  assert.ok(ofKind(w, 'mhit').length === 1 && w.monsters.includes(tank));
  for (let i = 0; i < 60; i++) w.tick();
  const score = w.coop.score;
  zap(tank, 3, 3);
  assert.ok(!w.monsters.includes(tank));
  assert.equal(w.coop.score - score, MONSTER_DEFS.tank.points);
  assert.equal(p.stats.monsters, 1);
  const pop = ofKind(w, 'mdeath').at(-1);
  assert.deepEqual([pop[2], pop[5], pop[6]], ['tank', 0, MONSTER_DEFS.tank.points]);

  const jelly = kinds.get('jelly');
  const before = w.monsters.length;
  zap(jelly, 9, 3);
  const minis = w.monsters.filter((m) => m.kind === 'mini');
  assert.equal(minis.length, 2);
  assert.equal(w.monsters.length, before - 1 + 2);
  assert.ok(minis.every((m) => m.hurt > 0), 'the minis survive the blast that made them');
  assert.equal(ofKind(w, 'mspawn').length, 2);
  for (const e of [...ofKind(w, 'mspawn'), ...ofKind(w, 'mdeath'), ...ofKind(w, 'mhit')]) assert.equal(e.length - 1, EVENT_ARGS[e[0]].length);
});

test('the door: found when its crate goes, open once every monster is gone, the first team member on it clears the level', () => {
  const w = live(adventure({ seed: 6, n: 2 }));
  park(w);
  for (const p of w.players) p.shield = C.SHIELD_FOREVER;
  const door = w.door;
  const p = w.player(0);
  // blow the crate from a free side: the door shows up, still closed (monsters are left)
  const side = [[0, -1], [1, 0], [0, 1], [-1, 0]].find(([dx, dy]) => w.grid[(door.ty + dy) * W + door.tx + dx] !== '#');
  clearTile(w, door.tx + side[0], door.ty + side[1]);
  bombNow(w, 0, door.tx + side[0], door.ty + side[1], 1);
  w.tick();
  assert.ok(door.revealed && !door.open);
  assert.equal(w.grid[door.ty * W + door.tx], '.');
  assert.deepEqual(ofKind(w, 'door')[0], ['door', door.tx, door.ty, 0]);
  put(w, 0, door.tx, door.ty);
  for (let i = 0; i < 40; i++) w.tick();
  assert.equal(w.state, STATE.PLAYING, 'a closed door does nothing');
  // pop every monster: the door opens
  w.coop.monsters.length = 0;
  put(w, 0, 1, 1);
  w.tick();
  assert.ok(door.open);
  assert.deepEqual(ofKind(w, 'door').at(-1), ['door', door.tx, door.ty, 1]);
  const score = w.coop.score;
  const lives = w.coop.lives;
  put(w, 1, door.tx, door.ty);
  w.tick();
  assert.equal(w.state, STATE.ENDING);
  assert.deepEqual(w.outcome, { winnerId: null, winnerTeam: 0, draw: false, reason: 'clear', tick: w.tickNo });
  assert.deepEqual(ofKind(w, 'exit')[0], ['exit', 1, door.tx, door.ty]);
  assert.equal(w.coop.score - score, CLEAR_POINTS * 1);
  assert.equal(w.coop.lives, lives + 1, 'a cleared level is worth a life');
  assert.ok(p.alive);
});

test('the door opens even while still hidden, and the level clears as soon as it is found and stepped on', () => {
  const w = live(adventure({ seed: 8 }));
  w.coop.monsters.length = 0;
  w.tick();
  assert.ok(w.door.open && !w.door.revealed);
  assert.equal(ofKind(w, 'door').length, 0, 'nothing to announce yet');
  w.grid[w.door.ty * W + w.door.tx] = '.';
  w.coop.onBlockOpened(w.door.ty * W + w.door.tx);
  assert.deepEqual(ofKind(w, 'door').at(-1), ['door', w.door.tx, w.door.ty, 1]);
});

test('lives: a human spends one and comes back at a safe spawn with a spawn shield; none left, they stay down', () => {
  const w = live(adventure({ seed: 9, n: 2, lives: 1, fighters: [fighter(0), fighter(1), fighter(2, { isBot: true })] }));
  park(w);
  const [a, b, helper] = [w.player(0), w.player(1), w.player(2)];
  for (const p of [a, b, helper]) p.spawnShield = 0;
  w._killPlayer(a, 0);
  assert.equal(w.coop.lives, 0);
  assert.deepEqual(ofKind(w, 'life').at(-1), ['life', 0, 0]);
  w._killPlayer(b, 1);
  assert.equal(w.coop.respawnAt.has(1), false, 'no life left: no comeback');
  w._killPlayer(helper, 2);
  assert.equal(w.coop.lives, 0, 'helper bots never spend the team\'s lives');
  assert.equal(w.state, STATE.PLAYING, 'somebody is still coming back');
  for (let i = 0; i < RESPAWN_TICKS - 1; i++) w.tick();
  assert.equal(a.alive, false);
  w.tick();
  assert.equal(a.alive, true);
  assert.equal(a.spawnShield, SPAWN_SHIELD_TICKS - 1, 'shielded (one tick already aged)');
  const back = ofKind(w, 'respawn').at(-1);
  assert.deepEqual(back.slice(0, 2), ['respawn', 0]);
  assert.ok(C.SPAWN_SLOTS.some(([sx, sy]) => sx + 0.5 === a.x && sy + 0.5 === a.y), 'on a spawn slot');
  a.spawnShield = 0;
  w._killPlayer(a, 0);
  w.tick();
  assert.equal(w.state, STATE.ENDING, 'nobody up and nobody coming back: game over');
  assert.equal(w.outcome.reason, 'wipe');
});

test('a comeback avoids a spawn that a monster sits next to', () => {
  const w = live(adventure({ seed: 10 }));
  const a = w.player(0);
  const [sx, sy] = C.SPAWN_SLOTS[a.slot];
  w.coop.monsters.length = 1;
  Object.assign(w.coop.monsters[0], { x: sx + 1.5, y: sy + 0.5, tx: sx + 1, ty: sy, stun: 1e9 });
  a.spawnShield = 0;
  w._killPlayer(a, 0);
  for (let i = 0; i < RESPAWN_TICKS; i++) w.tick();
  assert.ok(a.alive);
  assert.ok(Math.abs(Math.floor(a.x) - (sx + 1)) + Math.abs(Math.floor(a.y) - sy) >= 4, `came back at ${a.x},${a.y}`);
});

test('the level clock: when it runs out two angry zippies join in and the clock stops (no sudden death)', () => {
  const w = live(adventure({ seed: 12 }));
  park(w);
  w.player(0).shield = C.SHIELD_FOREVER;
  const before = w.monsters.length;
  w.timeLeft = 2;
  w.tick();
  w.tick();
  assert.equal(ofKind(w, 'hurry').length, 1);
  assert.equal(w.timeLeft, -1);
  assert.equal(w.suddenDeath, false);
  const fresh = w.monsters.slice(before);
  assert.equal(fresh.length, 2);
  assert.ok(fresh.every((m) => m.kind === 'zippy' && m.angry));
});

test('a kicked bomb stops in front of a monster', () => {
  const w = live(adventure({ seed: 13 }));
  w.coop.monsters.length = 1;
  for (let x = 1; x < W - 1; x++) w.grid[5 * W + x] = '.';
  Object.assign(w.coop.monsters[0], { x: 8.5, y: 5.5, tx: 8, ty: 5, stun: 1e9 });
  assert.equal(w._enterable(8, 5), false);
  assert.equal(w._enterable(6, 5), true);
});

// ---- Coop vs bots -----------------------------------------------------------------------------------------

test('no friendly fire: a team-mate\'s flames are harmless, your own are not, the enemy\'s are', () => {
  const w = live(coop({ team: 2, foes: 2 }));
  for (const p of w.players) p.spawnShield = 0;
  const [a, b, e1, e2] = [0, 1, 2, 3].map((id) => w.player(id));
  put(w, 0, 3, 5); put(w, 1, 4, 5); put(w, 2, 9, 5); put(w, 3, 10, 5);
  for (let x = 1; x < W - 1; x++) w.grid[5 * W + x] = '.';
  bombNow(w, 0, 5, 5, 1);                                              // a's bomb burns b's tile
  bombNow(w, 2, 11, 5, 1);                                             // e1's bomb burns e2's tile
  w.tick();
  assert.ok(b.alive, 'a team-mate stands in your fire unharmed');
  assert.ok(e2.alive, 'bots do not blow each other up either');
  w.tick();
  bombNow(w, 1, 2, 5, 1);                                              // b's bomb on a: harmless; then a's own bomb: deadly
  w.tick();
  assert.ok(a.alive);
  for (let i = 0; i < C.FLAME_TICKS + 1; i++) w.tick();
  bombNow(w, 0, 2, 5, 1);
  w.tick();
  assert.equal(a.alive, false);
  assert.ok(b.alive, 'b stood clear of that one');
  assert.deepEqual(ofKind(w, 'death').at(-1).slice(0, 3), ['death', 0, 0]);
  assert.equal(a.stats.selfKills, 1);
  bombNow(w, 3, 4, 5, 1);                                              // the enemy's fire does hurt
  w.tick();
  assert.equal(b.alive, false);
  assert.equal(e2.stats.kills, 1);
  assert.ok(e1.alive);
});

test('orphaned bombs (their owner left) hurt nobody in the co-op modes', () => {
  const w = live(coop({ team: 2, foes: 1 }));
  for (const p of w.players) p.spawnShield = 0;
  put(w, 1, 3, 5);
  for (let x = 1; x < W - 1; x++) w.grid[5 * W + x] = '.';
  bombNow(w, 0, 4, 5, 1);
  w.removeFighter(0);
  w.tick();
  assert.ok(w.player(1).alive);
});

test('coop outcome: the wave is cleared when no enemy is left; lost when no team member is; a tie is a loss; time up with sudden death off is a loss', () => {
  const clear = live(coop({ team: 2, foes: 2 }));
  clear._killPlayer(clear.player(2), 0);
  clear._killPlayer(clear.player(3), 1);
  const score = clear.coop.score;
  clear.tick();
  assert.equal(clear.outcome.reason, 'clear');
  assert.equal(clear.outcome.winnerTeam, 0);
  assert.equal(clear.coop.score - score, CLEAR_POINTS);
  assert.equal(score, 2 * ENEMY_POINTS, 'every enemy blasted by the team scores');

  const lost = live(coop({ team: 2, foes: 1 }));
  lost._killPlayer(lost.player(0), 2);
  lost.tick();
  assert.equal(lost.state, STATE.PLAYING, 'one team member is still up');
  lost._killPlayer(lost.player(1), 2);
  lost.tick();
  assert.deepEqual([lost.outcome.reason, lost.outcome.winnerTeam, lost.outcome.draw], ['wipe', null, true]);

  const tie = live(coop({ team: 1, foes: 1 }));
  tie._killPlayer(tie.player(0), 1);
  tie._killPlayer(tie.player(1), 0);
  tie.tick();
  assert.equal(tie.outcome.reason, 'wipe');

  const late = live(coop({ team: 1, foes: 1, roundTime: 60, suddenDeath: false }));
  late.timeLeft = 1;
  late.tick();
  assert.equal(late.outcome.reason, 'timeout');
  assert.equal(late.outcome.winnerTeam, null);
});

test('coop: no showdown, sudden death as in battle, power-ups a fighter brings', () => {
  const w = new World({ seed: 3, mode: 'coop', roundTime: 60, coop: { level: 2 }, fighters: [fighter(0, { start: { bombsMax: 3, range: 4, speedLv: 2, kick: true, glove: false } }), fighter(1, { team: 1, isBot: true, start: { bombsMax: 99 } })] });
  assert.deepEqual([w.player(0).bombsMax, w.player(0).range, w.player(0).speedLv, w.player(0).kick], [3, 4, 2, true]);
  assert.equal(w.player(1).bombsMax, C.MAX_BOMBS, 'starting stats are clamped');
  live(w);
  w._killPlayer(w.player(0), 1);
  assert.equal(ofKind(w, 'showdown').length, 0);
});

// ---- The wire ----------------------------------------------------------------------------------------------

test('co-op snapshots: m / dr / lv / sc / rp round-trip through JSON and decode', () => {
  const w = live(adventure({ seed: 14, n: 2, level: 4 }));
  let snap = w.snapshot({ grid: true });
  assert.ok(Array.isArray(snap.m) && snap.m.length === w.monsters.length);
  assert.ok(!('dr' in snap), 'a hidden door is not on the wire');
  assert.equal(snap.lv, w.coop.lives);
  assert.equal(snap.sc, 0);
  assert.deepEqual(snap.rp, []);
  const row = snap.m[0];
  const m = w.monsters[0];
  assert.deepEqual(decodeMonster(row), { id: m.id, kind: m.kind, x: m.x, y: m.y, facing: m.facing, hurt: false, angry: false, hp: MONSTER_DEFS[m.kind].hp });
  w.door.revealed = true;
  w.player(0).spawnShield = 0;
  w._killPlayer(w.player(0), 0);
  m.hurt = 5;
  m.angry = true;
  snap = w.snapshot({ grid: true });
  assert.deepEqual(snap.dr, [w.door.tx, w.door.ty, 0]);
  assert.deepEqual(snap.rp, [[0, RESPAWN_TICKS]]);
  assert.equal(snap.m[0][M.FL], MF.HURT | MF.ANGRY);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  for (const r of snap.m) assert.ok(MONSTER_KINDS.includes(r[M.K]));
  const c = live(coop({ team: 1, foes: 1 })).snapshot();
  assert.ok('sc' in c && !('m' in c) && !('lv' in c), 'coop carries the score only');
});

test('a whole adventure level with bots ends, and keeps every invariant on the way', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const w = adventure({ seed, level: 1 + (seed % 8), n: 2 });
    const brains = w.players.map((p) => new BotBrain({ level: 'normal', seed: seed * 10 + p.id }));
    let s = 0;
    while (w.state !== STATE.OVER && w.tickNo < 60 * 60 * 12) {
      if (w.state === STATE.PLAYING) w.players.forEach((p, i) => { if (p.alive) w.applyCmd(p.id, { s: ++s, ...brains[i].think(w, p.id) }); });
      w.tick();
      for (const p of w.players) if (p.alive) assert.equal(w.grid[Math.floor(p.y) * W + Math.floor(p.x)], '.');
    }
    assert.equal(w.state, STATE.OVER, `seed ${seed} ended`);
    assert.ok(['clear', 'wipe'].includes(w.outcome.reason));
    for (const e of events(w)) assert.ok(e[0] in EVENT_ARGS);
  }
});
