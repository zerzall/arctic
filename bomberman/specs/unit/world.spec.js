import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, movePlayer, effectiveSpeed, effectiveDir, overlapsTile, makeEnv, computeBlast } from '../../shared/world.js';
import { generateMap } from '../../shared/mapgen.js';
import { makeRng } from '../../shared/rng.js';
import * as C from '../../shared/constants.js';

const { STATE, PLAYER_HALF: HALF, EPS, DT, GRID_W: W, GRID_H: H } = C;

// ---- Test helpers ------------------------------------------------------------------------------

const fighter = (id, over = {}) => ({ id, name: `P${id}`, color: id, team: id % 2, isBot: false, lastSeq: 0, ...over });

/**
 * A world for scenario tests. `open` clears every soft block, `flat` also clears the pillars, so a scenario
 * only contains the walls and blocks it plants itself.
 */
function mk({ n = 2, fighters, open = true, flat = false, ...opts } = {}) {
  const list = fighters ?? Array.from({ length: n }, (_, i) => fighter(i));
  const w = new World({
    seed: 7, mode: 'ffa', layout: 'classic', blocks: 'few', items: 'none', theme: 'meadow', roundTime: 120, suddenDeath: true, ...opts, fighters: list,
  });
  for (let i = 0; i < w.grid.length; i++) {
    const tx = i % W;
    const ty = (i - tx) / W;
    const border = tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1;
    if (w.grid[i] === '+' && open) w.grid[i] = '.';
    if (w.grid[i] === '#' && flat && !border) w.grid[i] = '.';
  }
  return w;
}

/** Skip the countdown and the spawn shields. */
function live(w) {
  while (w.state === STATE.COUNTDOWN) w.tick();
  for (const p of w.players) p.spawnShield = 0;
  return w;
}

const put = (w, id, tx, ty, dx = 0, dy = 0) => {
  const p = w.player(id);
  p.x = tx + 0.5 + dx;
  p.y = ty + 0.5 + dy;
  return p;
};
const cmd = (w, id, d = 0, b = 0, x = 0) => w.applyCmd(id, { s: w.player(id).lastSeq + 1, d, b, x });
const run = (w, n) => { for (let i = 0; i < n; i++) w.tick(); };
const plant = (w, tx, ty, prize = null) => { w.grid[ty * W + tx] = '+'; w._drops[ty * W + tx] = prize; };
const idx = (tx, ty) => ty * W + tx;

/** Places a bomb for `id` on tile (tx,ty) (teleporting the owner there) and returns it. */
function bombAt(w, id, tx, ty, range) {
  const p = put(w, id, tx, ty);
  if (range) p.range = range;
  cmd(w, id, 0, 1);
  return w.bombs[w.bombs.length - 1];
}

/** Collects events tick by tick (absolute cursor + trim, like the Room does). */
function record(w) {
  const log = [];
  let cursor = w.evCount;
  const pull = () => {
    for (const ev of w.eventsSince(cursor)) log.push({ k: w.tickNo, ev });
    cursor = w.evCount;
    w.trimEvents(cursor);
  };
  return {
    log,
    pull,
    tick(n = 1) { for (let i = 0; i < n; i++) { w.tick(); pull(); } },
    of: (code) => log.filter((e) => e.ev[0] === code),
    clear() { log.length = 0; },
  };
}

const flameTiles = (w) => w.flames.map((f) => `${f.tx},${f.ty}:${f.mask}`).sort();
const gridEnv = (w) => makeEnv(w.grid, w.bombs, W, H);
const closeTo = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

/** A classic-layout grid string with no soft blocks. */
const CLASSIC = (() => {
  let s = '';
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) s += (tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1 || (tx % 2 === 0 && ty % 2 === 0)) ? '#' : '.';
  }
  return s;
})();
const FLAT = CLASSIC.replace(/#/g, (c, i) => ((i % W === 0 || i % W === W - 1 || i < W || i >= W * (H - 1)) ? '#' : '.'));
const newPlayer = (over = {}) => ({ id: 0, x: 1.5, y: 1.5, facing: 2, moving: false, speedLv: 0, curse: null, ...over });

// ---- Pure helpers ------------------------------------------------------------------------------

test('effectiveSpeed: speed levels and curses', () => {
  for (let lv = 0; lv <= C.MAX_SPEED_LV; lv++) closeTo(effectiveSpeed(newPlayer({ speedLv: lv })), 3.6 + 0.5 * lv);
  assert.equal(effectiveSpeed(newPlayer({ curse: 'slow', speedLv: 6 })), 1.6);
  assert.equal(effectiveSpeed(newPlayer({ curse: 'rush', speedLv: 0 })), 7.5);
  for (const curse of ['reverse', 'nobomb', 'spam']) closeTo(effectiveSpeed(newPlayer({ curse, speedLv: 2 })), 4.6);
  closeTo(effectiveSpeed(newPlayer({ speedLv: C.MAX_SPEED_LV })), 6.6);
});

test('effectiveDir: reverse mirrors, rush autoruns in the facing direction, others are transparent', () => {
  for (let d = 0; d <= 4; d++) {
    assert.equal(effectiveDir(newPlayer(), d), d);
    assert.equal(effectiveDir(newPlayer({ curse: 'slow' }), d), d);
    assert.equal(effectiveDir(newPlayer({ curse: 'reverse' }), effectiveDir(newPlayer({ curse: 'reverse' }), d)), d, 'involution');
  }
  const rev = newPlayer({ curse: 'reverse' });
  assert.deepEqual([0, 1, 2, 3, 4].map((d) => effectiveDir(rev, d)), [0, 3, 4, 1, 2]);
  for (let facing = 0; facing < 4; facing++) {
    const rush = newPlayer({ curse: 'rush', facing });
    assert.equal(effectiveDir(rush, 0), facing + 1);
    assert.equal(effectiveDir(rush, 3), 3, 'explicit input wins');
  }
});

test('overlapsTile: strict hitbox test', () => {
  const p = newPlayer({ x: 1.5, y: 1.5 });
  assert.ok(overlapsTile(p, 1, 1));
  assert.ok(!overlapsTile(p, 2, 1));
  assert.ok(!overlapsTile(p, 1, 2));
  assert.ok(!overlapsTile(p, 0, 0));
  p.x = 1.5 + 0.16 + 1e-9;
  assert.ok(overlapsTile(p, 2, 1), 'right edge just past the boundary');
  p.x = 1.5 + 0.16 - 1e-9;
  assert.ok(!overlapsTile(p, 2, 1), 'right edge just short of the boundary');
  p.x = 2 + HALF;                                    // left edge exactly on the boundary between tiles 1 and 2
  assert.ok(!overlapsTile(p, 1, 1) || p.x - HALF < 2, 'touching is not overlapping');
  p.x = 2.7;
  p.y = 1.5;
  assert.ok(overlapsTile(p, 2, 1) && overlapsTile(p, 3, 1));
});

test('makeEnv.isSolid: bounds, cells, bombs, pass, left map, flying bombs', () => {
  const bombs = [{ id: 1, tx: 3, ty: 1, fly: null, pass: [] }, { id: 2, tx: 5, ty: 1, fly: null, pass: [0] }, { id: 3, tx: 7, ty: 1, fly: { left: 3 }, pass: [] }];
  const grid = CLASSIC.split('');
  grid[idx(9, 1)] = '+';
  grid[idx(11, 1)] = 'X';
  const env = makeEnv(grid, bombs, W, H);
  assert.equal(env.W, 15);
  assert.equal(env.H, 13);
  const me = { id: 0 };
  const other = { id: 9 };
  for (const [tx, ty] of [[-1, 1], [1, -1], [15, 1], [1, 13], [0, 0], [2, 2]]) assert.ok(env.isSolid(tx, ty, me), `${tx},${ty}`);
  assert.ok(!env.isSolid(1, 1, me));
  assert.ok(env.isSolid(9, 1, me), 'soft block');
  assert.ok(env.isSolid(11, 1, me), 'sudden-death wall');
  assert.ok(env.isSolid(3, 1, me), 'bomb without pass');
  assert.ok(!env.isSolid(5, 1, me), 'pass exemption');
  assert.ok(env.isSolid(5, 1, other), 'pass is per fighter');
  assert.ok(!env.isSolid(7, 1, me), 'flying bombs are not solid');
  const left = { 2: true };
  assert.ok(makeEnv(grid, bombs, W, H, left).isSolid(5, 1, me), 'once the hitbox left the bomb it is solid again');
  assert.ok(!makeEnv(grid, bombs, W, H, { 1: true }).isSolid(5, 1, me), 'left is keyed by bomb id');
  const snapBomb = [{ id: 4, tx: 3, ty: 3, fly: 0, pass: [0] }];
  assert.ok(!makeEnv(CLASSIC, snapBomb).isSolid(3, 3, me), 'decoded snapshot bombs (fly = 0) and a string grid work');
  assert.ok(makeEnv(CLASSIC, [{ id: 5, tx: 3, ty: 3 }]).isSolid(3, 3, me), 'ghost without pass');
});

test('makeEnv follows bombs and grid mutated in place', () => {
  const bombs = [];
  const grid = CLASSIC.split('');
  const env = makeEnv(grid, bombs, W, H);
  assert.ok(!env.isSolid(3, 1, { id: 0 }));
  bombs.push({ id: 1, tx: 3, ty: 1, fly: null, pass: [] });
  assert.ok(env.isSolid(3, 1, { id: 0 }));
  grid[idx(4, 1)] = '+';
  assert.ok(env.isSolid(4, 1, { id: 0 }));
});

test('computeBlast: arms, walls, blocks, chained bombs', () => {
  const bomb = (id, tx, ty, range) => ({ id, tx, ty, range, fly: null });
  let r = computeBlast(CLASSIC, [], bomb(1, 1, 1, 2));
  assert.deepEqual(r.tiles, [[1, 1], [2, 1], [3, 1], [1, 2], [1, 3]]);
  assert.deepEqual(r.blocks, []);
  assert.deepEqual(r.hitBombs, []);

  r = computeBlast(CLASSIC, [], bomb(1, 5, 5, 3));
  assert.equal(r.tiles.length, 1 + 4 * 3);
  assert.deepEqual(r.tiles[0], [5, 5]);
  assert.deepEqual(r.tiles.slice(1, 4), [[5, 4], [5, 3], [5, 2]], 'up arm first, outward');

  r = computeBlast(CLASSIC, [], bomb(1, 2, 1, 5));
  assert.ok(!r.tiles.some(([tx, ty]) => tx === 2 && ty === 2), 'stops before the pillar');
  assert.ok(!r.tiles.some(([tx, ty]) => ty === 2 && tx === 2));

  const grid = CLASSIC.split('');
  grid[idx(5, 3)] = '+';
  r = computeBlast(grid, [], bomb(1, 5, 5, 4));
  assert.deepEqual(r.blocks, [[5, 3]]);
  assert.ok(r.tiles.some(([tx, ty]) => tx === 5 && ty === 3), 'the block tile is in the flame set');
  assert.ok(!r.tiles.some(([tx, ty]) => tx === 5 && ty === 2), 'and stops the arm');

  const chained = [bomb(1, 5, 5, 5), bomb(2, 8, 5, 1), { id: 3, tx: 5, ty: 2, range: 1, fly: { left: 4 } }];
  r = computeBlast(CLASSIC, chained, chained[0]);
  assert.deepEqual(r.hitBombs, [2], 'a flying bomb is ignored, a standing one is reached');
  assert.ok(r.tiles.some(([tx, ty]) => tx === 8 && ty === 5));
  assert.ok(!r.tiles.some(([tx, ty]) => tx === 9 && ty === 5), 'the arm ends AT the bomb');
  assert.ok(r.tiles.some(([tx, ty]) => tx === 5 && ty === 2), 'flame passes over a flying bomb');

  const before = JSON.stringify(chained);
  computeBlast(CLASSIC, chained, chained[1]);
  assert.equal(JSON.stringify(chained), before, 'pure');
});

test('computeBlast: sudden-death walls stop arms and range 10 stays inside the board', () => {
  const grid = CLASSIC.split('');
  grid[idx(8, 5)] = 'X';
  const r = computeBlast(grid, [], { id: 1, tx: 5, ty: 5, range: 10, fly: null });
  assert.ok(!r.tiles.some(([tx, ty]) => tx === 8 && ty === 5));
  for (const [tx, ty] of r.tiles) assert.ok(tx >= 1 && ty >= 1 && tx <= 13 && ty <= 11);
});

// ---- movePlayer --------------------------------------------------------------------------------

/** Depth by which the hitbox penetrates the deepest solid tile (0 if none). */
function penetration(p, env) {
  let worst = 0;
  const x0 = Math.floor(p.x - HALF);
  const x1 = Math.floor(p.x + HALF);
  const y0 = Math.floor(p.y - HALF);
  const y1 = Math.floor(p.y + HALF);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!env.isSolid(tx, ty, p)) continue;
      const ox = Math.min(p.x + HALF, tx + 1) - Math.max(p.x - HALF, tx);
      const oy = Math.min(p.y + HALF, ty + 1) - Math.max(p.y - HALF, ty);
      if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
    }
  }
  return worst;
}

test('movePlayer: d = 0 stands still', () => {
  const p = newPlayer({ moving: true });
  assert.deepEqual(movePlayer(p, 0, makeEnv(CLASSIC, [])), { moved: false, blocked: false });
  assert.equal(p.moving, false);
  assert.equal(p.x, 1.5);
});

test('movePlayer: free movement advances by speed * DT and sets facing and moving', () => {
  const env = makeEnv(CLASSIC, []);
  for (const [d, dx, dy] of [[2, 1, 0], [4, -1, 0], [3, 0, 1], [1, 0, -1]]) {
    const p = newPlayer({ x: 7.5, y: 5.5 });
    const r = movePlayer(p, d, env);
    assert.deepEqual(r, { moved: true, blocked: false });
    closeTo(p.x, 7.5 + dx * 3.6 * DT);
    closeTo(p.y, 5.5 + dy * 3.6 * DT);
    assert.equal(p.facing, d - 1);
    assert.equal(p.moving, true);
  }
});

test('movePlayer: mutates nothing but x, y, facing and moving', () => {
  const p = newPlayer({ x: 7.5, y: 5.5, extra: { a: 1 }, shield: 5 });
  const before = { ...p };
  movePlayer(p, 2, makeEnv(CLASSIC, []));
  for (const k of Object.keys(before)) if (!['x', 'y', 'facing', 'moving'].includes(k)) assert.deepEqual(p[k], before[k], k);
  assert.deepEqual(Object.keys(p), Object.keys(before));
});

test('movePlayer: speed scales with level and curses', () => {
  const env = makeEnv(CLASSIC, []);
  const configs = [...Array.from({ length: 7 }, (_, lv) => ({ speedLv: lv, want: 3.6 + 0.5 * lv })), { curse: 'slow', want: 1.6 }, { curse: 'rush', want: 7.5 }];
  for (const c of configs) {
    const p = newPlayer({ x: 2.5, y: 1.5, speedLv: c.speedLv ?? 0, curse: c.curse ?? null });
    for (let i = 0; i < 30; i++) movePlayer(p, 2, env);
    closeTo(p.x - 2.5, c.want * DT * 30, 1e-9);
  }
});

// The eight solid sides of the classic layout: [label, dir, tile x, tile y, axis, flush coordinate].
const WALL_SIDES = [
  ['border above', 1, 1, 1, 'y', 1 + HALF], ['border left', 4, 1, 1, 'x', 1 + HALF], ['border right', 2, 13, 1, 'x', 14 - HALF], ['border below', 3, 1, 11, 'y', 12 - HALF],
  ['pillar right of (1,2)', 2, 1, 2, 'x', 2 - HALF], ['pillar below (2,1)', 3, 2, 1, 'y', 2 - HALF], ['pillar left of (3,2)', 4, 3, 2, 'x', 3 + HALF], ['pillar above (2,3)', 1, 2, 3, 'y', 3 + HALF],
];

test('movePlayer: pushing into any wall side for 100 ticks is stable and never penetrates (all speeds, slow and rush)', () => {
  const env = makeEnv(CLASSIC, []);
  const configs = [...Array.from({ length: 7 }, (_, lv) => ({ speedLv: lv })), { curse: 'slow' }, { curse: 'rush' }];
  for (const [label, d, tx, ty, axis, flush] of WALL_SIDES) {
    for (const cfg of configs) {
      const p = newPlayer({ x: tx + 0.5, y: ty + 0.5, speedLv: cfg.speedLv ?? 0, curse: cfg.curse ?? null });
      let settled = null;
      for (let i = 0; i < 100; i++) {
        movePlayer(p, d, env);
        assert.ok(penetration(p, env) < 1e-9, `${label} ${JSON.stringify(cfg)} tick ${i}`);
        if (i === 20) settled = p[axis];
      }
      assert.equal(p[axis], settled, `${label} ${JSON.stringify(cfg)}: position stable once clamped`);
      closeTo(p[axis], flush, 2 * EPS);
      assert.equal(movePlayer(p, d, env).blocked, true);
    }
  }
});

test('movePlayer: blocked results report blocked, and a player flush against a wall can walk away', () => {
  const env = makeEnv(CLASSIC, []);
  const p = newPlayer({ x: 1.5, y: 1.5 });
  for (let i = 0; i < 10; i++) movePlayer(p, 4, env);
  assert.deepEqual(movePlayer(p, 4, env), { moved: false, blocked: true });
  assert.equal(p.moving, false);
  assert.deepEqual(movePlayer(p, 2, env), { moved: true, blocked: false });
  assert.equal(p.moving, true);
});

test('movePlayer: an edge exactly on a tile boundary counts as inside the tile behind it', () => {
  const env = makeEnv(CLASSIC, []);
  // Wall at (2,2) and (2,1) is floor: a player whose right edge is exactly 2.0 in row 2 must not be blocked by tile 2 until it moves in.
  const p = newPlayer({ x: 2 - HALF, y: 2.5 });
  assert.deepEqual(movePlayer(p, 4, env), { moved: true, blocked: false }, 'moving away from the wall');
  const q = newPlayer({ x: 2 - HALF, y: 2.5 });
  assert.deepEqual(movePlayer(q, 2, env), { moved: false, blocked: true });
  assert.ok(q.x + HALF <= 2 + 1e-12, 'clamped flush, not inside the pillar');
  const r = newPlayer({ x: 3 + HALF, y: 2.5 });
  assert.deepEqual(movePlayer(r, 2, env), { moved: true, blocked: false }, 'left edge exactly on the boundary, walking away');
  const s = newPlayer({ x: 3 + HALF, y: 2.5 });
  assert.deepEqual(movePlayer(s, 4, env), { moved: false, blocked: true });
  assert.ok(s.x - HALF >= 3 - 1e-12);
});

// Pillar (2,2): [label, dir, start x, start y, axis that must change, expected sign of the change]. Each start sits 0.01 short of the boundary.
const SLIDES = [
  ['right, above the pillar', 2, 1.65, 1.85, 'y', -1], ['right, below the pillar', 2, 1.65, 3.15, 'y', 1],
  ['left, above the pillar', 4, 3.35, 1.85, 'y', -1], ['left, below the pillar', 4, 3.35, 3.15, 'y', 1],
  ['down, left of the pillar', 3, 1.85, 1.65, 'x', -1], ['down, right of the pillar', 3, 3.15, 1.65, 'x', 1],
  ['up, left of the pillar', 1, 1.85, 3.35, 'x', -1], ['up, right of the pillar', 1, 3.15, 3.35, 'x', 1],
];

test('movePlayer: corner slide works in both directions on both axes', () => {
  const env = makeEnv(CLASSIC, []);
  for (const [label, d, x, y, axis, sign] of SLIDES) {
    const p = newPlayer({ x, y });
    const before = { x, y };
    assert.deepEqual(movePlayer(p, d, env), { moved: true, blocked: false }, label);
    const travel = axis === 'x' ? 'y' : 'x';
    assert.equal(p[travel], before[travel], `${label}: the travel axis is untouched while sliding`);
    assert.equal(Math.sign(p[axis] - before[axis]), sign, label);
    assert.ok(penetration(p, env) < 1e-9);
  }
});

test('movePlayer: a corner slide ends inside the free lane and the fighter then passes the pillar', () => {
  const env = makeEnv(CLASSIC, []);
  for (const [label, d, x, y, axis] of SLIDES) {
    const p = newPlayer({ x, y });
    for (let i = 0; i < 100; i++) movePlayer(p, d, env);
    assert.ok(penetration(p, env) < 1e-9, label);
    const travel = axis === 'x' ? 'y' : 'x';
    const start = travel === 'x' ? x : y;
    assert.ok(Math.abs(p[travel] - start) > 1, `${label}: got past the pillar`);
    assert.equal(Math.floor(p[axis] - HALF + EPS), Math.floor(p[axis] + HALF - EPS), `${label}: ended inside one lane, clear of the pillar`);
  }
});

test('movePlayer: no slide when the centre is over the solid lane (blocked instead)', () => {
  const env = makeEnv(CLASSIC, []);
  const p = newPlayer({ x: 1.65, y: 2.15 });      // hitbox rows 1 and 2, centre in row 2 (the pillar row)
  assert.deepEqual(movePlayer(p, 2, env), { moved: false, blocked: true });
  assert.equal(p.y, 2.15, 'no perpendicular movement either');
});

test('movePlayer: bombs are solid unless the fighter is on the bomb pass list', () => {
  const bomb = { id: 1, tx: 5, ty: 5, fly: null, pass: [] };
  const p = newPlayer({ x: 3.5, y: 5.5 });
  const solid = makeEnv(CLASSIC, [bomb]);
  for (let i = 0; i < 60; i++) movePlayer(p, 2, solid);
  closeTo(p.x, 5 - HALF - EPS, 1e-12);
  const q = newPlayer({ x: 3.5, y: 5.5 });
  bomb.pass = [0];
  for (let i = 0; i < 60; i++) movePlayer(q, 2, solid);
  assert.ok(q.x > 5.5, 'walked through a bomb it may pass');
  const r = newPlayer({ x: 5.5, y: 5.5 });
  const left = { 1: true };
  assert.deepEqual(movePlayer(r, 2, makeEnv(CLASSIC, [bomb], W, H, left)), { moved: true, blocked: false }, 'inside the bomb tile, nothing to cross');
  const back = newPlayer({ x: 6.4, y: 5.5 });
  for (let i = 0; i < 20; i++) movePlayer(back, 4, makeEnv(CLASSIC, [bomb], W, H, left));
  closeTo(back.x, 6 + HALF + EPS, 1e-12);          // pass ended (left) so the bomb blocks from behind
});

test('movePlayer: a fighter 0.0-0.49 off the bomb lane centre is blocked, never stuck without feedback', () => {
  const env = makeEnv(FLAT, [{ id: 1, tx: 6, ty: 5, fly: null, pass: [] }]);
  for (let off = 0; off < 0.5; off += 0.01) {
    for (const sign of [1, -1]) {
      const p = newPlayer({ x: 4.5, y: 5.5 + sign * off });
      let last;
      for (let i = 0; i < 60; i++) last = movePlayer(p, 2, env);
      assert.equal(last.blocked, true, `offset ${sign * off}`);
      assert.ok(p.x + HALF <= 6 + 1e-9);
    }
  }
});

/** Random map with soft blocks and a few bombs, for the fuzzers. */
function fuzzMap(seed) {
  const rng = makeRng(seed);
  const grid = CLASSIC.split('');
  for (let i = 0; i < grid.length; i++) if (grid[i] === '.' && rng.next() < 0.3) grid[i] = '+';
  const floor = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === '.') floor.push(i);
  return { rng, grid, floor };
}

/**
 * Random walk with random bombs. Unquantised positions may sit up to EPS (1e-6 tile) inside a wall for one tick when a step
 * happens to land in the EPS tolerance band of an edge (SPEC 3.5's own tolerance); the next tick clamps it back out. Positions
 * rounded to 3 decimals, which is what the wire carries, never overlap at all.
 */
function randomWalk(seed, ticks, quantise) {
  const { rng, grid, floor } = fuzzMap(seed);
  const bombs = [];
  const env = makeEnv(grid, bombs, W, H);
  const start = rng.pick(floor);
  const p = newPlayer({ id: 0, x: (start % W) + 0.5, y: Math.floor(start / W) + 0.5 });
  let dir = 0;
  let untilTurn = 0;
  for (let t = 0; t < ticks; t++) {
    if (untilTurn-- <= 0) {
      dir = rng.int(5);
      untilTurn = 1 + rng.int(40);
      if (rng.int(6) === 0) { p.speedLv = rng.int(7); p.curse = rng.pick([null, null, 'slow', 'rush', 'reverse']); }
    }
    const d = effectiveDir(p, dir);
    const result = movePlayer(p, d, env);
    if (result.blocked && !env.isSolid(Math.floor(p.x) + C.DIR_DX[d], Math.floor(p.y) + C.DIR_DY[d], p)) {
      assert.fail(`seed ${seed} tick ${t}: stuck at ${p.x},${p.y} pressing ${d} with a free tile ahead of its centre`);   // no sticking
    }
    if (t % 97 === 0) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      if (!bombs.some((b) => b.tx === tx && b.ty === ty)) bombs.push({ id: t, tx, ty, fly: null, pass: [0] });
    }
    if (t % 331 === 0 && bombs.length > 3) bombs.shift();
    for (const b of bombs) if (b.pass.length && !overlapsTile(p, b.tx, b.ty)) b.pass.length = 0;
    if (quantise && t % 3 === 0) {
      p.x = Math.round(p.x * 1000) / 1000;
      p.y = Math.round(p.y * 1000) / 1000;
    }
    const depth = penetration(p, env);
    if (depth >= (quantise ? 1e-9 : EPS + 1e-9)) assert.fail(`seed ${seed} tick ${t}: penetration ${depth} at ${p.x},${p.y}${quantise ? ' (quantised)' : ''}`);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) assert.fail(`seed ${seed} tick ${t}: NaN`);
  }
}

test('movePlayer fuzz: 200 seeded maps x 50 000 ticks never sink into a solid tile by more than EPS', () => {
  for (let seed = 1; seed <= 200; seed++) randomWalk(seed, 50000, false);
});

test('movePlayer fuzz: the same walks with x,y rounded to 3 decimals every 3 ticks still never overlap', () => {
  for (let seed = 1; seed <= 200; seed++) randomWalk(seed, 50000, true);
});

test('movePlayer: the EPS tolerance band is the only slack (slow fighter in a one-tile gap between a bomb and a block)', () => {
  const grid = FLAT.split('');
  grid[idx(7, 7)] = '+';
  const env = makeEnv(grid, [{ id: 1, tx: 5, ty: 7, fly: null, pass: [] }], W, H);
  const p = newPlayer({ x: 6.5, y: 7.5, curse: 'slow' });
  for (let i = 0; i < 30; i++) movePlayer(p, 4, env);        // flush against the bomb on the left
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    movePlayer(p, i % 40 < 20 ? 2 : 4, env);                 // shuffle between both sides of the gap
    worst = Math.max(worst, penetration(p, env));
  }
  assert.ok(worst <= EPS + 1e-9, `penetration ${worst}`);
  assert.ok(penetration(newPlayer({ x: p.x, y: p.y }), env) <= EPS + 1e-9);
});

test('movePlayer: at maximum speed no wall is ever tunnelled (thin pillars, rush, 600 000 ticks of stress)', () => {
  const env = makeEnv(CLASSIC, []);
  const rng = makeRng(99);
  const p = newPlayer({ x: 1.5, y: 1.5, curse: 'rush' });
  for (let t = 0; t < 600000; t++) {
    if (t % 17 === 0) p.curse = rng.pick(['rush', 'rush', null]);
    if (t % 17 === 0) p.speedLv = rng.pick([0, 6]);
    movePlayer(p, rng.int(5) === 0 ? rng.int(5) : effectiveDir(p, t % 50 < 25 ? 2 : 3), env);
    if (p.x < 1 + HALF - 1e-9 || p.x > 14 - HALF + 1e-9 || p.y < 1 + HALF - 1e-9 || p.y > 12 - HALF + 1e-9) assert.fail(`escaped the board at tick ${t}: ${p.x},${p.y}`);
    if (t % 1000 === 0 && penetration(p, env) >= 1e-9) assert.fail(`penetration at tick ${t}`);
  }
});

// ---- Constructor -------------------------------------------------------------------------------

test('constructor: initial state, spawns and the normative rng draw order (map, then slots)', () => {
  const fighters = [fighter(3), fighter(5), fighter(9), fighter(12)];
  const w = new World({ seed: 1234, fighters, mode: 'ffa', layout: 'classic', blocks: 'normal', items: 'normal', theme: 'lava', roundTime: 90, suddenDeath: true });
  const rng = makeRng(1234);
  const map = generateMap({ layout: 'classic', blocks: 'normal', items: 'normal', numFighters: 4, rng });
  const order = rng.shuffle([0, 1, 2, 3]);
  assert.equal(w.grid.join(''), map.grid);
  assert.ok(Array.isArray(w.grid) && w.grid.length === 195 && w.grid.every((c) => c.length === 1));
  assert.deepEqual(w.players.map((p) => p.id), [3, 5, 9, 12], 'fighter order');
  fighters.forEach((f, i) => {
    const p = w.player(f.id);
    assert.equal(p.slot, order[i]);
    assert.equal(p.x, C.SPAWN_SLOTS[order[i]][0] + 0.5);
    assert.equal(p.y, C.SPAWN_SLOTS[order[i]][1] + 0.5);
    assert.equal(p.facing, 2);
  });
  assert.equal(new Set(w.players.map((p) => p.slot)).size, 4);
  assert.ok(w.players.every((p) => p.slot < 4), 'N fighters use slots 0..N-1');
  assert.equal(w.W, 15);
  assert.equal(w.H, 13);
  assert.equal(w.gridVer, 0);
  assert.equal(w.tickNo, 0);
  assert.equal(w.state, STATE.COUNTDOWN);
  assert.equal(w.countdown, 180);
  assert.equal(w.timeLeft, 90 * 60);
  assert.equal(w.suddenDeath, false);
  assert.deepEqual(w.sdOrder, []);
  assert.equal(w.sdNext, 0);
  assert.equal(w.outcome, null);
  assert.equal(w.evCount, 0);
  assert.equal(w.theme, 'lava');
  for (const list of [w.bombs, w.flames, w.items, w.falling]) assert.deepEqual(list, []);
  assert.equal(w.player(99), undefined);
});

test('constructor: fresh player fields follow the starting stats of SPEC 3', () => {
  const w = new World({ seed: 1, fighters: [fighter(0, { lastSeq: 41, isBot: true, name: 'Bolt', color: 5, team: 1 }), fighter(1)], roundTime: 0 });
  const p = w.player(0);
  assert.deepEqual({ ...p, x: 0, y: 0, slot: 0, _ran: false }, {
    id: 0, name: 'Bolt', color: 5, team: 1, isBot: true, slot: 0, x: 0, y: 0, facing: 2, moving: false, alive: true, removed: false,
    bombsMax: 1, range: 2, speedLv: 0, kick: false, glove: false, shield: 0, spawnShield: 0, curse: null, curseTicks: 0, curseCooldown: 0, spamCd: 0,
    lastShieldHit: p.lastShieldHit, lastSeq: 41, deathTick: -1, killer: -1, stats: { kills: 0, deaths: 0, selfKills: 0, blocks: 0, items: 0 }, _ran: false,
  });
  assert.ok(p.lastShieldHit <= -C.SHIELDHIT_GAP_TICKS, 'the first shieldhit is never throttled');
  assert.equal(w.timeLeft, -1, 'roundTime 0 = unlimited');
  assert.equal(w.player(1).lastSeq, 0);
});

test('constructor: 2v2 team mode gives each team one diagonal; other team layouts use a plain shuffle', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const fighters = [fighter(0, { team: 0 }), fighter(1, { team: 1 }), fighter(2, { team: 0 }), fighter(3, { team: 1 })];
    const w = new World({ seed, fighters, mode: 'teams' });
    const slots = fighters.map((f) => w.player(f.id).slot);
    assert.deepEqual([slots[0], slots[2]].sort(), [0, 1], `team 0 holds slots {0,1} (seed ${seed})`);
    assert.deepEqual([slots[1], slots[3]].sort(), [2, 3], `team 1 holds slots {2,3} (seed ${seed})`);
    seen.add(`${slots[0]}${slots[1]}`);
    const rng = makeRng(seed);
    generateMap({ layout: 'classic', blocks: 'normal', items: 'normal', numFighters: 4, rng });
    const first = rng.shuffle([0, 1]);
    const second = rng.shuffle([2, 3]);
    assert.deepEqual(slots, [first[0], second[0], first[1], second[1]], 'team 0 is shuffled first');
  }
  assert.ok(seen.size >= 3, 'shuffled inside the teams');
  const three = new World({ seed: 5, mode: 'teams', fighters: [fighter(0, { team: 0 }), fighter(1, { team: 1 }), fighter(2, { team: 0 })] });
  assert.deepEqual(three.players.map((p) => p.slot).sort(), [0, 1, 2]);
});

test('constructor: same seed and fighters give the same world; bad fighter counts are rejected', () => {
  const a = new World({ seed: 42, fighters: [fighter(0), fighter(1), fighter(2)] });
  const b = new World({ seed: 42, fighters: [fighter(0), fighter(1), fighter(2)] });
  assert.equal(JSON.stringify(a.snapshot({ grid: true })), JSON.stringify(b.snapshot({ grid: true })));
  assert.throws(() => new World({ seed: 1, fighters: [] }), RangeError);
  assert.throws(() => new World({ seed: 1, fighters: Array.from({ length: 9 }, (_, i) => fighter(i)) }), RangeError);
  assert.doesNotThrow(() => new World({ seed: 1, fighters: Array.from({ length: 8 }, (_, i) => fighter(i)) }));
});

test('constructor: sudden death is disabled for an unlimited clock', () => {
  const w = live(new World({ seed: 1, fighters: [fighter(0), fighter(1)], roundTime: 0, suddenDeath: true }));
  assert.equal(w.timeLeft, -1);
  assert.equal(w.sdEnabled, false);
});

// ---- Countdown and commands --------------------------------------------------------------------

test('countdown: players are frozen and cmds only acked; GO on tick 180 starts play and the spawn shield', () => {
  const w = mk({ n: 3 });
  const rec = record(w);
  const before = w.players.map((p) => [p.x, p.y]);
  cmd(w, 0, 2, 1, 1);
  assert.equal(w.player(0).lastSeq, 1, 'acked even though ignored');
  assert.equal(w.bombs.length, 0);
  rec.tick(179);
  assert.equal(w.state, STATE.COUNTDOWN);
  assert.equal(w.countdown, 1);
  assert.equal(w.tickNo, 179);
  assert.equal(rec.log.length, 0);
  assert.deepEqual(w.snapshot().cd, 1);
  assert.deepEqual(w.players.map((p) => [p.x, p.y]), before);
  rec.tick(1);
  assert.equal(w.state, STATE.PLAYING);
  assert.equal(w.countdown, 0);
  assert.deepEqual(rec.log.map((e) => e.ev), [['go']]);
  assert.ok(w.players.every((p) => p.spawnShield === C.SPAWN_SHIELD_TICKS));
  assert.equal(w.timeLeft, 7200, 'the GO tick does not consume round time');
  assert.equal(w.snapshot().cd, 0);
  rec.tick(1);
  assert.equal(w.timeLeft, 7199);
  assert.ok(w.players.every((p) => p.spawnShield === C.SPAWN_SHIELD_TICKS - 1));
});

test('countdown: the first live cmd applies just before the next tick and moves the fighter', () => {
  const w = mk();
  run(w, 180);
  const p = put(w, 0, 5, 5);
  cmd(w, 0, 2);
  assert.ok(p.x > 5.5);
  assert.equal(p.moving, true);
  w.tick();
  assert.equal(p.moving, true, 'moved this tick');
  w.tick();
  assert.equal(p.moving, false, 'no cmd since the previous tick: not walking');
});

test('applyCmd never throws and keeps lastSeq as a maximum of safe integers', () => {
  const w = live(mk());
  const garbage = [undefined, null, 0, 'x', [], {}, { s: 'a' }, { s: NaN, d: '2' }, { d: 99, b: 'yes', x: {} }, { s: Infinity }, { s: -5 }, { s: 1.5 }, { s: 2 ** 60 }, Object.create(null), () => 1, true];
  garbage.forEach((g, i) => assert.doesNotThrow(() => w.applyCmd(0, g), `garbage #${i}`));
  assert.doesNotThrow(() => w.applyCmd(999, { s: 1, d: 1, b: 1, x: 1 }));
  assert.doesNotThrow(() => w.applyCmd(undefined, { s: 1 }));
  assert.equal(w.player(0).lastSeq, 0);
  w.applyCmd(0, { s: 5, d: 0, b: 0, x: 0 });
  w.applyCmd(0, { s: 3, d: 0, b: 0, x: 0 });
  assert.equal(w.player(0).lastSeq, 5);
  w.applyCmd(0, { s: '9' });
  w.applyCmd(0, { s: 6.5 });
  assert.equal(w.player(0).lastSeq, 5);
  w.applyCmd(0, { s: 2147483647 });
  assert.equal(w.player(0).lastSeq, 2147483647);
});

test('applyCmd: an out-of-range direction is standing still; dead, removed and post-OVER fighters are only acked', () => {
  const w = live(mk({ n: 3 }));
  const p = put(w, 0, 5, 5);
  cmd(w, 0, 7);
  assert.equal(p.x, 5.5);
  p.alive = false;
  cmd(w, 0, 2, 1);
  assert.equal(p.x, 5.5);
  assert.equal(w.bombs.length, 0);
  assert.equal(p.lastSeq, 2);
  w.removeFighter(1);
  cmd(w, 1, 2, 1);
  assert.equal(w.player(1).lastSeq, 1);
  assert.equal(w.bombs.length, 0);
  w.state = STATE.OVER;
  const q = put(w, 2, 5, 7);
  cmd(w, 2, 2, 1);
  assert.equal(q.x, 5.5);
  assert.equal(q.lastSeq, 1);
});

// ---- Bombs -------------------------------------------------------------------------------------

test('placing a bomb: fields, event, one per tile, capacity, range at placement time', () => {
  const w = live(mk({ n: 2 }));
  const p = put(w, 0, 5, 5);
  cmd(w, 0, 0, 1);
  assert.deepEqual(w.bombs, [{ id: 1, owner: 0, x: 5.5, y: 5.5, tx: 5, ty: 5, range: 2, fuse: 150, dir: 0, step: 0, pass: [0], fly: null }]);
  assert.deepEqual(w.eventsSince(0).filter((e) => e[0] === 'bomb'), [['bomb', 1, 0, 5, 5]]);
  p.bombsMax = 3;
  cmd(w, 0, 0, 1);
  assert.equal(w.bombs.length, 1, 'one bomb per tile');
  p.range = 4;
  put(w, 0, 6, 5);
  cmd(w, 0, 0, 1);
  put(w, 0, 7, 5);
  cmd(w, 0, 0, 1);
  assert.deepEqual(w.bombs.map((b) => [b.id, b.tx, b.range]), [[1, 5, 2], [2, 6, 4], [3, 7, 4]]);
  put(w, 0, 8, 5);
  cmd(w, 0, 0, 1);
  assert.equal(w.bombs.length, 3, 'capacity reached');
});

test('placing a bomb: pass lists every alive fighter whose hitbox overlaps the tile', () => {
  const w = live(mk({ n: 4 }));
  put(w, 0, 5, 5);
  put(w, 1, 5, 5, 0.7, 0);          // x = 6.2: hitbox reaches into tile 5
  put(w, 2, 5, 5, 0.9, 0);          // x = 6.4: hitbox [6.06, 6.74] clear of tile 5
  put(w, 3, 5, 5);
  w.player(3).alive = false;
  cmd(w, 0, 0, 1);
  assert.deepEqual(w.bombs[0].pass, [0, 1]);
});

test('placing a bomb: refused by nobomb, walls, dead fighters and an occupied tile; allowed onto a live flame', () => {
  const w = live(mk({ n: 3 }));
  const p = put(w, 0, 5, 5);
  p.bombsMax = 5;
  p.curse = 'nobomb';
  cmd(w, 0, 0, 1);
  assert.equal(w.bombs.length, 0);
  p.curse = null;
  put(w, 0, 5, 5);
  w.grid[idx(5, 5)] = '+';
  cmd(w, 0, 0, 1);
  assert.equal(w.bombs.length, 0, 'not on a block');
  w.grid[idx(5, 5)] = '.';
  bombAt(w, 1, 5, 5);
  bombAt(w, 0, 5, 5);
  assert.equal(w.bombs.length, 1, 'tile already holds a bomb');
  assert.equal(w.bombs[0].owner, 1, 'the first placer keeps it (lower id wins a same-tick request)');
});

test('a bomb explodes in the 150th tick after placement, not before', () => {
  const w = live(mk({ n: 2 }));
  const rec = record(w);
  put(w, 0, 5, 5);
  cmd(w, 0, 0, 1);
  put(w, 0, 1, 1);
  const bomb = w.bombs[0];
  for (let i = 1; i <= 149; i++) {
    rec.tick();
    assert.equal(w.bombs.length, 1, `tick ${i}`);
    assert.equal(bomb.fuse, 150 - i);
  }
  assert.equal(rec.of('boom').length, 0);
  rec.tick();
  assert.equal(w.bombs.length, 0);
  assert.deepEqual(rec.of('boom').map((e) => e.ev), [['boom', 1, 0, 5, 5, 2, [[5, 5], [5, 4], [5, 3], [6, 5], [7, 5], [5, 6], [5, 7], [4, 5], [3, 5]]]]);
});

test('flame masks: centre is the OR of the arms, interiors have both axis bits, tips only the bit towards the centre', () => {
  const w = live(mk({ n: 2 }));
  put(w, 0, 5, 5);
  cmd(w, 0, 0, 1);
  put(w, 0, 1, 1);
  run(w, 150);
  const mask = Object.fromEntries(w.flames.map((f) => [`${f.tx},${f.ty}`, f.mask]));
  assert.deepEqual(mask, {
    '5,5': 15, '5,4': 5, '5,3': 4, '6,5': 10, '7,5': 8, '5,6': 5, '5,7': 1, '4,5': 10, '3,5': 2,
  });
  assert.ok(w.flames.every((f) => f.ticks === C.FLAME_TICKS - 1), 'aged once in the tick it was created');
  const sorted = [...w.flames].sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  assert.deepEqual(w.flames, sorted, 'flames ascend by (ty, tx)');
  assert.deepEqual(w.flames[0].owners, [0]);
});

test('flames stop before hard walls and after soft blocks; a block opens, credits its owner and reveals its prize', () => {
  const w = live(mk({ n: 2 }));
  const rec = record(w);
  plant(w, 5, 3, 'kick');
  bombAt(w, 0, 5, 5, 4);
  put(w, 0, 1, 1);
  const gv = w.gridVer;
  rec.tick(150);
  const tiles = w.flames.map((f) => `${f.tx},${f.ty}`);
  assert.ok(tiles.includes('5,3') && !tiles.includes('5,2'), 'the block tile burns and stops the arm');
  assert.equal(w.grid[idx(5, 3)], '.');
  assert.equal(w.gridVer, gv + 1);
  assert.deepEqual(rec.of('block').map((e) => e.ev), [['block', 5, 3, 0]]);
  assert.deepEqual(rec.of('itemspawn').map((e) => e.ev), [['itemspawn', 1, 5, 3, 'kick']]);
  assert.deepEqual(w.items, [{ id: 1, tx: 5, ty: 3, kind: 'kick', born: w.tickNo }]);
  assert.equal(w.player(0).stats.blocks, 1);
  const order = rec.log.map((e) => e.ev[0]);
  assert.ok(order.indexOf('boom') < order.indexOf('block') && order.indexOf('block') < order.indexOf('itemspawn'));
  rec.clear();
  const walls = live(mk({ n: 2 }));
  bombAt(walls, 0, 1, 1, 6);
  put(walls, 0, 13, 11);
  run(walls, 150);
  assert.deepEqual(walls.flames.map((f) => `${f.tx},${f.ty}`).sort(), ['1,1', '1,2', '1,3', '1,4', '1,5', '1,6', '1,7', '2,1', '3,1', '4,1', '5,1', '6,1', '7,1'].sort());
});

test('an empty block spawns no item and no itemspawn event', () => {
  const w = live(mk({ n: 2 }));
  const rec = record(w);
  plant(w, 5, 3, null);
  bombAt(w, 0, 5, 5, 3);
  put(w, 0, 1, 1);
  rec.tick(150);
  assert.equal(w.items.length, 0);
  assert.equal(rec.of('itemspawn').length, 0);
  assert.equal(rec.of('block').length, 1);
});

test('a revealed item survives the blast that revealed it, and dies to the next one', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  plant(w, 5, 3, 'speed');
  bombAt(w, 0, 5, 5, 3);
  put(w, 0, 1, 1);
  rec.tick(150);
  assert.equal(w.items.length, 1);
  assert.equal(rec.of('itemgone').length, 0);
  bombAt(w, 1, 5, 4, 2);
  put(w, 1, 13, 11);
  rec.tick(150);
  assert.equal(w.items.length, 0);
  assert.deepEqual(rec.of('itemgone').map((e) => e.ev), [['itemgone', 1, 5, 3, 'speed']]);
});

test('lingering flames do not destroy items that appear later', () => {
  const w = live(mk({ n: 3 }));
  bombAt(w, 0, 5, 5, 3);
  put(w, 0, 1, 1);
  run(w, 150);
  const item = { id: 77, tx: 5, ty: 4, kind: 'bomb', born: w.tickNo };
  w.items.push(item);
  run(w, 20);
  assert.deepEqual(w.items, [item]);
});

test('chain reaction: bombs in reach go off in the same tick, in queue order, whatever their fuse', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  bombAt(w, 0, 5, 5);
  bombAt(w, 1, 7, 5);
  bombAt(w, 2, 7, 7);
  put(w, 0, 1, 1);
  put(w, 1, 1, 11);
  put(w, 2, 13, 1);
  w.bombs[1].fuse = 400;
  w.bombs[2].fuse = 300;
  rec.tick(150);
  assert.deepEqual(rec.of('boom').map((e) => [e.k, e.ev[1]]), [[w.tickNo, 1], [w.tickNo, 2], [w.tickNo, 3]]);
  assert.equal(w.bombs.length, 0);
  assert.ok(rec.of('boom').every((e) => e.k === rec.of('boom')[0].k));
});

test('a chain stops at a bomb: the arm ends AT it and the bomb\'s own range takes over', () => {
  const w = live(mk({ n: 2 }));
  const rec = record(w);
  bombAt(w, 0, 3, 5, 6);
  bombAt(w, 1, 7, 5, 1);
  put(w, 0, 1, 1);
  put(w, 1, 13, 11);
  w.bombs[1].fuse = 500;
  rec.tick(150);
  const tiles = w.flames.map((f) => `${f.tx},${f.ty}`);
  for (const t of ['7,5', '7,4', '7,6', '8,5', '6,5']) assert.ok(tiles.includes(t), `${t} burns (the chained bomb has range 1)`);
  assert.ok(!tiles.includes('9,5'), 'the first bomb\'s arm did not pass through the second');
  assert.equal(w.bombs.length, 0);
});

test('order independence: the flame set does not depend on which bomb has the lower id', () => {
  const scenario = (firstIsBig, bigDue) => {
    const w = live(mk({ n: 3 }));
    const place = (big) => (big ? bombAt(w, 0, 3, 5, 6) : bombAt(w, 1, 6, 5, 1));
    firstIsBig ? (place(true), place(false)) : (place(false), place(true));
    put(w, 0, 1, 1);
    put(w, 1, 1, 11);
    put(w, 2, 13, 1);
    const big = w.bombs.find((b) => b.range === 6);
    const small = w.bombs.find((b) => b.range === 1);
    if (bigDue) small.fuse = 400; else big.fuse = 400;
    run(w, 150);
    return flameTiles(w);
  };
  for (const bigDue of [true, false]) {
    const a = scenario(true, bigDue);
    const b = scenario(false, bigDue);
    assert.deepEqual(a, b, `bigDue=${bigDue}`);
    assert.ok(a.length > 0);
  }
});

test('two flames on one block in the same tick: one destruction, one drop, credit to the first owner', () => {
  for (const [firstOwner, secondOwner] of [[0, 1], [1, 0]]) {
    const w = live(mk({ n: 3 }));
    const rec = record(w);
    plant(w, 5, 5, 'shield');
    bombAt(w, firstOwner, 5, 3);
    bombAt(w, secondOwner, 5, 7);
    put(w, 0, 1, 1);
    put(w, 1, 1, 11);
    put(w, 2, 13, 1);
    const gv = w.gridVer;
    rec.tick(150);
    assert.equal(rec.of('block').length, 1);
    assert.equal(rec.of('itemspawn').length, 1);
    assert.equal(w.items.length, 1);
    assert.equal(w.gridVer, gv + 1);
    assert.equal(w.player(firstOwner).stats.blocks, 1, 'owners[0] is the lower bomb id');
    assert.equal(w.player(secondOwner).stats.blocks, 0);
    assert.equal(rec.of('block')[0].ev[3], firstOwner);
    const tile = w.flames.find((f) => f.tx === 5 && f.ty === 5);
    assert.deepEqual(tile.owners, [firstOwner, secondOwner]);
  }
});

test('flame tiles keep every owner in first-seen order and a re-burn refreshes ticks and ORs masks', () => {
  const w = live(mk({ n: 3, flat: true }));
  bombAt(w, 0, 5, 5, 2);
  put(w, 0, 1, 1);
  run(w, 150);
  const first = w.flames.find((f) => f.tx === 6 && f.ty === 5);
  assert.equal(first.mask, 10);
  run(w, 10);
  assert.equal(first.ticks, 25);
  bombAt(w, 1, 6, 7, 2);
  put(w, 1, 13, 11);
  w.bombs[0].fuse = 1;
  run(w, 1);
  const crossing = w.flames.find((f) => f.tx === 6 && f.ty === 5);
  assert.equal(crossing, first, 'same record, merged in place');
  assert.equal(crossing.mask, 10 | 4, 'the tip of the second bomb\'s up arm joins the horizontal arm');
  assert.equal(crossing.ticks, C.FLAME_TICKS - 1);
  assert.deepEqual(crossing.owners, [0, 1]);
});

test('a flame is lethal for exactly FLAME_TICKS (36) consecutive kill checks', () => {
  const victimEntersAfter = (k) => {
    const w = live(mk({ n: 3 }));
    bombAt(w, 0, 7, 5);
    put(w, 0, 1, 11);
    put(w, 1, 1, 1);
    put(w, 2, 13, 1);
    run(w, 150);                                  // the explosion tick T
    run(w, k);
    put(w, 1, 7, 4);
    w.tick();                                     // tick T + k + 1
    return w.player(1).alive;
  };
  assert.equal(victimEntersAfter(0), false);
  assert.equal(victimEntersAfter(20), false);
  assert.equal(victimEntersAfter(34), false, 'the 36th check (T + 35) still kills');
  assert.equal(victimEntersAfter(35), true, 'the 37th does not');
  assert.equal(victimEntersAfter(36), true);
});

test('a bomb placed onto a lingering flame explodes in that very tick', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  bombAt(w, 0, 7, 5);
  put(w, 0, 1, 11);
  run(w, 150);
  const t = w.tickNo;
  run(w, 5);
  const p = put(w, 2, 7, 4);
  p.shield = 1000;
  cmd(w, 2, 0, 1);
  rec.pull();
  assert.equal(w.bombs.length, 1);
  rec.clear();
  rec.tick();
  assert.equal(w.tickNo, t + 6);
  assert.equal(w.bombs.length, 0);
  assert.equal(rec.of('boom').length, 1);
  assert.equal(w.player(2).alive, true, 'shielded placer survives');
});

// ---- Shields, deaths and kill credit -----------------------------------------------------------

/** Explosion at tile (bx,by) with the victim standing in the up arm; returns the world one tick before the explosion. */
function shieldScenario(field, value) {
  const w = live(mk({ n: 3 }));
  bombAt(w, 0, 7, 5);
  put(w, 0, 1, 11);
  put(w, 1, 7, 4);
  put(w, 2, 13, 1);
  w.player(1)[field] = value;
  run(w, 149);
  return w;
}

test('a shield or spawn shield of N ticks absorbs exactly N kill checks, then the flame kills', () => {
  for (const field of ['shield', 'spawnShield']) {
    for (const n of [1, 2, 10]) {
      const w = shieldScenario(field, n + 149);       // it also counts down over the 149 quiet ticks
      const rec = record(w);
      let diedAt = null;
      for (let i = 0; i < 40 && diedAt === null; i++) {
        rec.tick();
        if (!w.player(1).alive) diedAt = i;
      }
      assert.equal(diedAt, n, `${field} ${n}`);
      assert.equal(rec.of('shieldhit').length >= 1, true);
      assert.equal(rec.of('death').length, 1);
    }
  }
});

test('shieldhit is throttled to one event per fighter per 12 ticks', () => {
  const w = shieldScenario('shield', 149 + 30);
  const rec = record(w);
  rec.tick(36);
  const hits = rec.of('shieldhit');
  assert.deepEqual(hits.map((e) => e.k - hits[0].k), [0, 12, 24]);
  assert.deepEqual(hits[0].ev, ['shieldhit', 1, 7.5, 4.5]);
  assert.equal(rec.of('death').length, 1, 'the shield ran out at 30 and the flame (36 ticks) was still there');
});

test('a fighter overlapping a flame tile but centred on a clean tile survives (deliberate leniency)', () => {
  const w = live(mk({ n: 3 }));
  bombAt(w, 0, 7, 5);
  put(w, 0, 1, 11);
  const p = put(w, 1, 8, 3, -0.49, 0);                  // centre x = 8.01 is in tile 8 (clean); the hitbox reaches into the burning column 7
  put(w, 2, 13, 1);
  run(w, 150);
  assert.ok(overlapsTile(p, 7, 3), 'the hitbox overlaps a flame tile');
  assert.ok(w.flames.some((f) => f.tx === 7 && f.ty === 3));
  run(w, 36);
  assert.equal(p.alive, true);
});

test('two deaths on one tick are a draw (wipe); with a third fighter alive that one wins', () => {
  const two = live(mk({ n: 2 }));
  bombAt(two, 0, 5, 5);
  put(two, 0, 5, 5);
  put(two, 1, 5, 6);
  const rec = record(two);
  rec.tick(150);
  assert.equal(rec.of('death').length, 2);
  assert.deepEqual(two.outcome, { winnerId: null, winnerTeam: null, draw: true, reason: 'wipe', tick: two.tickNo });
  assert.equal(two.state, STATE.ENDING);

  const three = live(mk({ n: 3 }));
  bombAt(three, 0, 5, 5);
  put(three, 0, 5, 5);
  put(three, 1, 5, 6);
  put(three, 2, 13, 11);
  run(three, 150);
  assert.deepEqual(three.outcome, { winnerId: 2, winnerTeam: null, draw: false, reason: 'last', tick: three.tickNo });
});

test('kill credit: an enemy owner gets the kill, the victim gets the death', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  bombAt(w, 0, 5, 5);
  put(w, 0, 1, 1);
  put(w, 1, 5, 6);
  put(w, 2, 13, 11);
  rec.tick(150);
  assert.deepEqual(rec.of('death').map((e) => e.ev), [['death', 1, 0, 5.5, 6.5]]);
  assert.equal(w.player(0).stats.kills, 1);
  assert.equal(w.player(1).stats.deaths, 1);
  assert.equal(w.player(1).killer, 0);
  assert.equal(w.player(1).alive, false);
  assert.equal(w.player(1).deathTick, w.tickNo);
});

test('kill credit: an own goal counts as a self kill, not a kill', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  bombAt(w, 0, 5, 5);
  put(w, 0, 5, 5);
  put(w, 1, 13, 1);
  put(w, 2, 13, 11);
  rec.tick(150);
  assert.deepEqual(rec.of('death').map((e) => e.ev), [['death', 0, 0, 5.5, 5.5]]);
  assert.deepEqual(w.player(0).stats, { kills: 0, deaths: 1, selfKills: 1, blocks: 0, items: 0 });
});

test('kill credit: with two owners on the tile the first ENEMY owner is credited, even over the victim\'s own bomb', () => {
  for (const [victim, killer] of [[0, 1], [1, 0]]) {
    const w = live(mk({ n: 3 }));
    bombAt(w, 0, 5, 5);
    bombAt(w, 1, 5, 7);
    put(w, 0, 13, 1);
    put(w, 1, 13, 11);
    put(w, 2, 1, 1);
    put(w, victim, 5, 6);
    run(w, 150);
    assert.equal(w.player(victim).killer, killer, `victim ${victim}`);
    assert.equal(w.player(killer).stats.kills, 1);
    assert.equal(w.player(victim).stats.selfKills, 0);
  }
});

test('kill credit: a teammate\'s bomb kills without kills or selfKills credit (friendly fire is on)', () => {
  const fighters = [fighter(0, { team: 0 }), fighter(1, { team: 1 }), fighter(2, { team: 0 }), fighter(3, { team: 1 })];
  const w = live(mk({ fighters, mode: 'teams' }));
  bombAt(w, 0, 5, 5);
  put(w, 0, 1, 1);
  put(w, 2, 5, 6);
  put(w, 1, 13, 11);
  put(w, 3, 13, 1);
  run(w, 150);
  const victim = w.player(2);
  assert.equal(victim.alive, false);
  assert.equal(victim.killer, 0, 'owners[0]');
  assert.equal(w.player(0).stats.kills, 0);
  assert.equal(w.player(0).stats.selfKills, 0);
  assert.equal(victim.stats.deaths, 1);
});

test('kill credit: a teammate is skipped in favour of an enemy owner on the same tile', () => {
  const fighters = [fighter(0, { team: 0 }), fighter(1, { team: 1 }), fighter(2, { team: 0 }), fighter(3, { team: 1 })];
  const w = live(mk({ fighters, mode: 'teams' }));
  bombAt(w, 0, 5, 5);
  bombAt(w, 1, 5, 7);
  put(w, 0, 1, 1);
  put(w, 1, 13, 11);
  put(w, 3, 13, 1);
  put(w, 2, 5, 6);
  run(w, 150);
  assert.equal(w.player(2).killer, 1);
  assert.equal(w.player(1).stats.kills, 1);
});

test('kill credit: an orphaned bomb credits nobody (killer -1)', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  bombAt(w, 0, 5, 5);
  put(w, 1, 5, 6);
  put(w, 2, 13, 11);
  w.removeFighter(0);
  assert.equal(w.bombs[0].owner, -1);
  rec.tick(150);
  assert.deepEqual(rec.of('death').map((e) => e.ev), [['death', 1, -1, 5.5, 6.5]]);
  assert.ok(w.players.every((p) => p.stats.kills === 0 && p.stats.selfKills === 0));
  assert.equal(rec.of('boom')[0].ev[2], -1);
});

test('kill credit: bombs of dead fighters still explode and credit their owner', () => {
  const w = live(mk({ n: 3 }));
  bombAt(w, 0, 3, 3);
  bombAt(w, 1, 7, 7);
  put(w, 0, 7, 6);
  put(w, 1, 13, 1);
  put(w, 2, 3, 4);
  w.bombs[1].fuse = 40;
  run(w, 40);
  assert.equal(w.player(0).alive, false, 'p0 was blown up by p1\'s bomb');
  run(w, 110);
  assert.equal(w.player(2).alive, false);
  assert.equal(w.player(2).killer, 0);
  assert.equal(w.player(0).stats.kills, 1);
});

test('blocks are credited to the owner of the flame tile that reached them, orphans to nobody', () => {
  const w = live(mk({ n: 3 }));
  plant(w, 5, 3);
  plant(w, 9, 5);
  bombAt(w, 0, 5, 5);
  bombAt(w, 1, 7, 5);
  put(w, 0, 13, 1);
  put(w, 1, 13, 11);
  put(w, 2, 1, 1);
  w.removeFighter(1);
  const rec = record(w);
  rec.tick(150);
  const credit = Object.fromEntries(rec.of('block').map((e) => [`${e.ev[1]},${e.ev[2]}`, e.ev[3]]));
  assert.deepEqual(credit, { '5,3': 0, '9,5': -1 });
  assert.equal(w.player(0).stats.blocks, 1);
  assert.equal(w.player(1).stats.blocks, 0);
});

test('the spam curse drops bombs from inside tick(), with no cmds at all, every SPAM_INTERVAL ticks', () => {
  const w = live(mk({ n: 2 }));
  const rec = record(w);
  const p = put(w, 0, 3, 1);
  p.curse = 'spam';
  p.curseTicks = 600;
  p.bombsMax = 8;
  p.shield = 5000;
  rec.tick(1);
  assert.equal(w.bombs.length, 1, 'first bomb on the very next tick, without any cmd');
  let x = 5;
  put(w, 0, x, 1);
  for (let i = 0; i < 110; i++) {
    const placed = rec.of('bomb').length;
    rec.tick();
    if (rec.of('bomb').length > placed) put(w, 0, (x += 2), 1);          // step onto a free tile (a position change, not a cmd)
  }
  const ticks = rec.of('bomb').map((e) => e.k);
  assert.equal(ticks[0], 181);
  assert.ok(ticks.length >= 5, `${ticks.length} bombs`);
  for (let i = 1; i < ticks.length; i++) assert.equal(ticks[i] - ticks[i - 1], C.SPAM_INTERVAL, 'cadence');
  assert.ok(w.player(0).lastSeq === 0, 'no cmd was ever applied');
});

test('nobomb blocks manual bombs and spam but not glove or kick', () => {
  const w = live(mk({ n: 2 }));
  const p = put(w, 0, 3, 3);
  p.curse = 'nobomb';
  p.curseTicks = 600;
  p.glove = true;
  cmd(w, 0, 0, 1);
  run(w, 5);
  assert.equal(w.bombs.length, 0);
  p.curse = null;
  cmd(w, 0, 0, 1);
  assert.equal(w.bombs.length, 1);
  p.curse = 'nobomb';
  cmd(w, 0, 0, 0, 1);
  assert.equal(w.bombs[0].fly !== null, true, 'glove still works');
});

// ---- Items -------------------------------------------------------------------------------------

const drop = (w, kind, tx, ty) => {
  const item = { id: 500 + w.items.length, tx, ty, kind, born: w.tickNo };
  w.items.push(item);
  return item;
};

test('pickup: every item kind applies its effect, is consumed, counts and emits `pickup`', () => {
  const effects = {
    bomb: (p) => p.bombsMax === 2, flame: (p) => p.range === 3, speed: (p) => p.speedLv === 1, kick: (p) => p.kick === true,
    glove: (p) => p.glove === true, shield: (p) => p.shield === C.SHIELD_TICKS - 1, skull: (p) => p.curse !== null,
  };
  for (const kind of C.ITEM_KINDS) {
    const w = live(mk({ n: 3 }));
    const rec = record(w);
    put(w, 0, 5, 5);
    const item = drop(w, kind, 5, 5);
    rec.tick();
    assert.equal(w.items.length, 0, kind);
    assert.ok(effects[kind](w.player(0)), kind);
    assert.equal(w.player(0).stats.items, 1);
    assert.deepEqual(rec.of('pickup').map((e) => e.ev), [['pickup', item.id, 0, kind, 5, 5]]);
  }
});

test('pickup: capped stats still consume the item', () => {
  const w = live(mk({ n: 3 }));
  const p = put(w, 0, 5, 5);
  Object.assign(p, { bombsMax: C.MAX_BOMBS, range: C.MAX_RANGE, speedLv: C.MAX_SPEED_LV });
  for (const kind of ['bomb', 'flame', 'speed']) {
    put(w, 0, 5, 5);
    drop(w, kind, 5, 5);
    w.tick();
  }
  assert.deepEqual([p.bombsMax, p.range, p.speedLv], [8, 10, 6]);
  assert.equal(w.items.length, 0);
  assert.equal(p.stats.items, 3);
});

test('pickup: the fighter whose centre is nearest the tile centre takes it; ties go to the lowest id', () => {
  const w = live(mk({ n: 3 }));
  put(w, 0, 5, 5, 0.3, 0);
  put(w, 1, 5, 5, -0.1, 0.05);
  put(w, 2, 13, 11);
  drop(w, 'kick', 5, 5);
  w.tick();
  assert.equal(w.player(1).kick, true);
  assert.equal(w.player(0).kick, false);

  const tie = live(mk({ n: 3 }));
  put(tie, 0, 5, 5, 0.2, 0);
  put(tie, 1, 5, 5, -0.2, 0);
  put(tie, 2, 13, 11);
  drop(tie, 'glove', 5, 5);
  tie.tick();
  assert.equal(tie.player(0).glove, true);
  assert.equal(tie.player(1).glove, false);
});

test('pickup: only the centre tile counts, dead fighters cannot pick up, and it works during `ending`', () => {
  const w = live(mk({ n: 3 }));
  put(w, 0, 5, 5, 0.49, 0);
  put(w, 1, 6, 5, -0.49, 0);
  put(w, 2, 13, 11);
  drop(w, 'bomb', 5, 5);
  w.tick();
  assert.equal(w.player(0).bombsMax, 2, 'centre x=5.99 is tile 5');
  put(w, 1, 5, 6);
  w.player(1).alive = false;
  drop(w, 'flame', 5, 6);
  w.tick();
  assert.equal(w.items.length, 1, 'the dead do not eat items');
  w.state = STATE.ENDING;
  w.player(1).alive = true;
  w.tick();
  assert.equal(w.items.length, 0);
  assert.equal(w.player(1).range, 3);
});

test('pickup runs before the kill check: a fighter stepping onto an item in a flame takes it and then dies, unless the item is a shield', () => {
  const trial = (kind) => {
    const w = live(mk({ n: 3 }));
    const rec = record(w);
    bombAt(w, 0, 7, 5);
    put(w, 0, 1, 11);
    put(w, 2, 13, 1);
    run(w, 150);
    drop(w, kind, 7, 4);                              // lingering flames never destroy items
    put(w, 1, 7, 4);
    rec.clear();
    rec.tick();
    return { w, rec };
  };
  const bomb = trial('bomb');
  assert.equal(bomb.w.player(1).bombsMax, 2, 'took the item...');
  assert.equal(bomb.w.player(1).alive, false, '...and then the flame killed it');
  assert.deepEqual(bomb.rec.log.map((e) => e.ev[0]).filter((c) => c === 'pickup' || c === 'death'), ['pickup', 'death']);
  const shield = trial('shield');
  assert.equal(shield.w.player(1).alive, true, 'a shield picked up first protects at the kill check');
  assert.equal(shield.rec.of('shieldhit').length, 1);
});

test('skull: a random curse other than the current one, curseTicks and spamCd set, events `pickup` then `curse`', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  const p = put(w, 0, 5, 5);
  put(w, 1, 13, 11);
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const before = p.curse;
    p.spamCd = 9;
    p.curseCooldown = 0;
    put(w, 0, 5, 5);
    drop(w, 'skull', 5, 5);
    rec.clear();
    rec.tick();
    assert.ok(C.CURSE_KINDS.includes(p.curse));
    assert.notEqual(p.curse, before, 'never re-rolls to the same curse');
    assert.equal(p.curseTicks, C.CURSE_TICKS - 1, 'set to 600, aged once in the same tick');
    assert.equal(p.spamCd, 0);
    assert.deepEqual(rec.log.map((e) => e.ev[0]), ['pickup', 'curse']);
    assert.deepEqual(rec.of('curse')[0].ev, ['curse', 0, p.curse, -1]);
    seen.add(p.curse);
  }
  assert.equal(seen.size, 5, 'all five curses occur');
});

test('skull picked up after the outcome lock gives no curse', () => {
  const w = live(mk({ n: 2 }));
  w.player(1).alive = false;
  w.tick();
  assert.equal(w.state, STATE.ENDING);
  put(w, 0, 5, 5);
  drop(w, 'skull', 5, 5);
  w.tick();
  assert.equal(w.player(0).curse, null);
  assert.equal(w.items.length, 0);
});

// ---- Curses ------------------------------------------------------------------------------------

test('a curse lasts CURSE_TICKS ticks and is announced as cured', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  const p = put(w, 0, 5, 5);
  put(w, 1, 13, 11);
  put(w, 2, 1, 1);
  drop(w, 'skull', 5, 5);
  rec.tick();
  const start = w.tickNo;
  assert.ok(p.curse);
  rec.tick(C.CURSE_TICKS - 2);
  assert.ok(p.curse, 'still cursed one tick before the end');
  rec.clear();
  rec.tick();
  assert.equal(p.curse, null);
  assert.equal(w.tickNo, start + C.CURSE_TICKS - 1);
  assert.deepEqual(rec.of('curse').map((e) => e.ev), [['curse', 0, 0, -1]]);
  assert.equal(p.curseTicks, 0);
});

function curseWorld(kind = 'slow') {
  const w = live(mk({ n: 4 }));
  put(w, 0, 5, 5, 0, 0);
  put(w, 1, 5, 5, 0.5, 0);
  put(w, 2, 13, 11);
  put(w, 3, 1, 11);
  const g = w.player(0);
  g.curse = kind;
  g.curseTicks = C.CURSE_TICKS;
  return w;
}

test('curse touch: the curse hops to the nearest healthy fighter within 0.7, both get a cooldown, one event', () => {
  const w = curseWorld('reverse');
  const rec = record(w);
  rec.tick();
  assert.equal(w.player(0).curse, null);
  assert.equal(w.player(1).curse, 'reverse');
  assert.equal(w.player(1).curseTicks, C.CURSE_TICKS - 1);
  assert.equal(w.player(0).curseCooldown, C.CURSE_XFER_COOLDOWN - 1);
  assert.equal(w.player(1).curseCooldown, C.CURSE_XFER_COOLDOWN - 1);
  assert.deepEqual(rec.of('curse').map((e) => e.ev), [['curse', 1, 'reverse', 0]]);
});

test('curse touch: distance limit is inclusive at 0.7', () => {
  for (const [d, hops] of [[0.699999, true], [0.700001, false], [0.69, true]]) {
    const w = curseWorld();
    put(w, 1, 5, 5, d, 0);
    w.tick();
    assert.equal(w.player(1).curse !== null, hops, `distance ${d}`);
  }
  const diag = curseWorld();
  put(diag, 1, 5, 5, 0.5, 0.5);
  diag.tick();
  assert.equal(diag.player(1).curse, null, 'euclidean, not manhattan: 0.707 > 0.7');
});

test('curse touch: nearest target wins, ties go to the lowest id, shields do not block, teammates are included', () => {
  const w = curseWorld();
  put(w, 1, 5, 5, 0.6, 0);
  put(w, 2, 5, 5, 0, 0.4);
  w.tick();
  assert.equal(w.player(2).curse, 'slow');
  assert.equal(w.player(1).curse, null);

  const tie = curseWorld();
  put(tie, 1, 5, 5, 0.5, 0);
  put(tie, 2, 5, 5, -0.5, 0);
  tie.tick();
  assert.equal(tie.player(1).curse, 'slow');

  const shielded = curseWorld();
  shielded.player(1).shield = 500;
  shielded.player(1).spawnShield = 50;
  shielded.player(1).team = shielded.player(0).team;
  shielded.tick();
  assert.equal(shielded.player(1).curse, 'slow');
});

test('curse touch: two cursed fighters do nothing; a receiver cannot pass it on for CURSE_XFER_COOLDOWN ticks', () => {
  const both = curseWorld('slow');
  both.player(1).curse = 'spam';
  both.player(1).curseTicks = 300;
  both.tick();
  assert.deepEqual([both.player(0).curse, both.player(1).curse], ['slow', 'spam']);

  const w = curseWorld('slow');
  put(w, 2, 5, 5, 1.1, 0);                            // 0.6 from fighter 1, 1.1 from fighter 0
  w.tick();
  put(w, 0, 1, 1);
  assert.equal(w.player(1).curse, 'slow');
  assert.equal(w.player(2).curse, null, 'one hop per tick: the receiver is on cooldown');
  run(w, C.CURSE_XFER_COOLDOWN - 2);
  assert.equal(w.player(2).curse, null, 'still cooling down');
  run(w, 2);
  assert.equal(w.player(2).curse, 'slow', 'passes on as soon as the cooldown is over');
  assert.equal(w.player(1).curse, null);
});

test('a curse is cleared, with an event, when the holder dies', () => {
  const w = curseWorld('spam');
  const rec = record(w);
  put(w, 1, 13, 1);
  bombAt(w, 2, 5, 5);
  put(w, 2, 13, 11);
  w.player(0).x = 5.5;
  rec.tick(150);
  assert.equal(w.player(0).alive, false);
  assert.equal(w.player(0).curse, null);
  const kinds = rec.log.map((e) => e.ev[0]);
  assert.ok(kinds.indexOf('death') < kinds.lastIndexOf('curse'));
  assert.deepEqual(rec.of('curse').map((e) => e.ev), [['curse', 0, 0, -1]]);
});

test('effectiveDir on the server: reverse mirrors input, rush autoruns until blocked', () => {
  const w = live(mk({ n: 2, flat: true }));
  const p = put(w, 0, 5, 5);
  p.curse = 'reverse';
  p.curseTicks = 600;
  cmd(w, 0, 2);
  assert.ok(p.x < 5.5, 'right became left');
  assert.equal(p.facing, 3);
  p.curse = 'rush';
  p.facing = 1;
  put(w, 0, 5, 5);
  const x0 = p.x;
  for (let i = 0; i < 10; i++) cmd(w, 0, 0);
  closeTo(p.x - x0, 10 * 7.5 * DT, 1e-9);
  for (let i = 0; i < 100; i++) cmd(w, 0, 0);
  assert.ok(p.x <= 14 - HALF, 'stopped by the wall');
  cmd(w, 0, 3);
  assert.ok(p.y > 5.5, 'explicit input overrides the autorun');
});

test('a client predictor built from the shared exports reproduces the server over 300 ticks of reverse and of rush', () => {
  for (const curse of ['reverse', 'rush', 'slow']) {
    const w = live(mk({ n: 3, blocks: 'normal', open: false }));
    const me = w.player(0);
    put(w, 1, 13, 11);
    put(w, 2, 13, 1);
    me.curse = curse;
    me.curseTicks = 600;
    me.speedLv = 2;
    const rng = makeRng(31);
    const pred = { id: 0, x: me.x, y: me.y, facing: me.facing, moving: false, speedLv: me.speedLv, curse };
    let dir = 0;
    for (let t = 0; t < 300; t++) {
      if (t % 9 === 0) dir = rng.int(5);
      const snap = JSON.parse(JSON.stringify(w.snapshot({ grid: true })));
      const bombs = snap.b.map((row) => ({ id: row[0], tx: row[4], ty: row[5], fly: row[9], pass: row[10] }));
      const env = makeEnv(snap.g, bombs, W, H);
      cmd(w, 0, dir);
      movePlayer(pred, effectiveDir(pred, dir), env);
      w.tick();
      assert.ok(Math.abs(pred.x - me.x) < 1e-9 && Math.abs(pred.y - me.y) < 1e-9, `${curse} tick ${t}: ${pred.x},${pred.y} vs ${me.x},${me.y}`);
    }
  }
});

// ---- Kick and sliding bombs --------------------------------------------------------------------

/** p0 (with kick) at (4,5), a bomb of p1 at (6,5) that nobody stands on any more, bystander p2 far away. */
function kickWorld(opts = {}) {
  const w = live(mk({ n: 3, flat: true, ...opts }));
  put(w, 2, 13, 11);
  const bomb = bombAt(w, 1, 6, 5);
  put(w, 1, 6, 9);
  w.tick();
  bomb.fuse = 5000;
  const p = put(w, 0, 4, 5);
  p.kick = true;
  return { w, bomb, p };
}

/** Holds `d` for up to `max` ticks until a kick event appears; returns the recorder. */
function pushUntilKick(w, id, d, max = 60) {
  const rec = record(w);
  for (let i = 0; i < max && rec.of('kick').length === 0; i++) {
    cmd(w, id, d);
    rec.tick();
  }
  return rec;
}

test('kick: walking into a bomb starts it sliding; event carries player, bomb and direction', () => {
  const { w, bomb } = kickWorld();
  const rec = pushUntilKick(w, 0, 2);
  assert.deepEqual(rec.of('kick').map((e) => e.ev), [['kick', 0, bomb.id, 2]]);
  assert.equal(bomb.dir, 2);
});

test('kick: the bomb glides one whole tile every KICK_STEP_TICKS without ever jumping backwards, and stops at the wall on a tile centre', () => {
  const { w, bomb } = kickWorld();
  pushUntilKick(w, 0, 2);
  const path = [];
  let lastX = bomb.x;
  for (let i = 0; i < 90 && bomb.dir !== 0; i++) {
    w.tick();
    assert.ok(bomb.x >= lastX - 1e-12, `tick ${i}: x went backwards ${lastX} -> ${bomb.x}`);
    assert.ok(bomb.x - lastX <= 1 / C.KICK_STEP_TICKS + 1e-9, 'continuous glide');
    assert.ok(Math.abs(bomb.x - (bomb.tx + 0.5 - (bomb.step / C.KICK_STEP_TICKS))) < 1e-12, 'x = centre(tx) - step/7');
    assert.equal(bomb.y, 5.5);
    lastX = bomb.x;
    if (path[path.length - 1] !== bomb.tx) path.push(bomb.tx);
  }
  assert.deepEqual(path, [7, 8, 9, 10, 11, 12, 13]);
  assert.equal(bomb.dir, 0);
  assert.equal(bomb.x, 13.5);
  assert.deepEqual(bomb.pass, []);
});

test('kick: timing is exactly one tile per 7 ticks', () => {
  const { w, bomb } = kickWorld();
  pushUntilKick(w, 0, 2);
  assert.equal(bomb.tx, 7, 'reserved (in the tick right after the kick)');
  const seenAt = [];
  for (let i = 1; i <= 30; i++) {
    w.tick();
    if (seenAt.length < bomb.tx - 7) seenAt.push(i);
  }
  assert.deepEqual(seenAt, [7, 14, 21, 28]);
});

test('kick: the reserved tile is solid immediately and the tile it left is free', () => {
  const { w, bomb } = kickWorld();
  pushUntilKick(w, 0, 2);
  const env = gridEnv(w);
  const probe = { id: 9 };
  assert.equal(bomb.tx, 7);
  assert.ok(env.isSolid(7, 5, probe), 'occupies the tile it is heading into');
  assert.ok(!env.isSolid(6, 5, probe), 'the tile it left is free');
  assert.equal(bomb.x, 6.5, 'visual position starts at the old centre');
});

test('kick: works at every lane offset from 0.00 to 0.49 on either side', () => {
  for (let i = 0; i < 50; i++) {
    for (const sign of [1, -1]) {
      const { w, bomb, p } = kickWorld();
      p.y = 5.5 + sign * i * 0.01;
      const rec = pushUntilKick(w, 0, 2);
      assert.equal(rec.of('kick').length, 1, `offset ${sign * i * 0.01}`);
      assert.equal(bomb.dir, 2);
    }
  }
});

test('kick: all four directions', () => {
  for (const [d, start, bx, by] of [[1, [6, 8], 6, 6], [3, [6, 3], 6, 6], [4, [8, 6], 6, 6], [2, [3, 6], 6, 6]]) {
    const w = live(mk({ n: 3, flat: true }));
    put(w, 2, 13, 11);
    const bomb = bombAt(w, 1, bx, by);
    put(w, 1, 1, 1);
    w.tick();
    const p = put(w, 0, start[0], start[1]);
    p.kick = true;
    const rec = pushUntilKick(w, 0, d);
    assert.deepEqual(rec.of('kick').map((e) => e.ev), [['kick', 0, bomb.id, d]], `dir ${d}`);
  }
});

test('kick: needs the kick item, a bomb nobody stands in, and a free tile behind it', () => {
  const noKick = kickWorld();
  noKick.p.kick = false;
  assert.equal(pushUntilKick(noKick.w, 0, 2, 40).of('kick').length, 0);
  assert.equal(noKick.bomb.dir, 0);

  const occupied = kickWorld();
  put(occupied.w, 2, 7, 5);                            // a fighter stands on the far tile
  assert.equal(pushUntilKick(occupied.w, 0, 2, 60).of('kick').length, 0, 'holding the key emits no repeated events');
  assert.equal(occupied.bomb.dir, 0);

  const overlapping = kickWorld();
  put(overlapping.w, 2, 7, 5, -0.6, 0);                // only its hitbox reaches into the far tile
  assert.equal(pushUntilKick(overlapping.w, 0, 2, 60).of('kick').length, 0);

  const walled = kickWorld();
  walled.w.grid[idx(7, 5)] = '+';
  assert.equal(pushUntilKick(walled.w, 0, 2, 60).of('kick').length, 0);

  const doubled = kickWorld();
  bombAt(doubled.w, 2, 7, 5);
  put(doubled.w, 2, 13, 11);
  assert.equal(pushUntilKick(doubled.w, 0, 2, 60).of('kick').length, 0, 'another bomb behind');
});

test('kick: a fighter standing on the bomb cannot kick it; once they step off it can be kicked', () => {
  const w = live(mk({ n: 3, flat: true }));
  put(w, 2, 13, 11);
  const bomb = bombAt(w, 1, 6, 5);
  const p = put(w, 0, 4, 5);
  p.kick = true;
  assert.deepEqual(bomb.pass, [1]);
  assert.equal(pushUntilKick(w, 0, 2, 40).of('kick').length, 0, 'owner still standing in it');
  put(w, 1, 6, 9);
  w.tick();
  assert.deepEqual(bomb.pass, []);
  assert.equal(pushUntilKick(w, 0, 2, 40).of('kick').length, 1);
});

test('kick: a stopped bomb can be kicked again, but not when it is against a wall', () => {
  const { w, bomb } = kickWorld();
  pushUntilKick(w, 0, 2);
  run(w, 60);
  assert.equal(bomb.tx, 13);
  const p = put(w, 0, 11, 5);
  assert.equal(pushUntilKick(w, 0, 2, 40).of('kick').length, 0, 'wall behind it');
  put(w, 0, 13, 7);
  const rec = pushUntilKick(w, 0, 1);
  assert.deepEqual(rec.of('kick').map((e) => e.ev.slice(0, 3)), [['kick', 0, bomb.id]]);
  assert.ok(p);
});

test('kick: a fighter stepping in front of a sliding bomb stops it on a tile centre, with no overlap and no jump back', () => {
  const { w, bomb } = kickWorld();
  pushUntilKick(w, 0, 2);
  w.tick();
  w.tick();
  assert.equal(bomb.tx, 7);
  const blocker = put(w, 2, 8, 5);
  let lastX = bomb.x;
  for (let i = 0; i < 20; i++) {
    w.tick();
    assert.ok(bomb.x >= lastX - 1e-12, 'never backwards');
    lastX = bomb.x;
  }
  assert.equal(bomb.dir, 0);
  assert.equal(bomb.tx, 7);
  assert.equal(bomb.x, 7.5);
  assert.equal(bomb.y, 5.5);
  assert.ok(!overlapsTile(blocker, bomb.tx, bomb.ty), 'the bomb stopped short of the fighter');
  assert.deepEqual(bomb.pass, []);
});

test('kick: a fighter cannot walk into the tile a sliding bomb has reserved', () => {
  const { w, bomb } = kickWorld();
  pushUntilKick(w, 0, 2);
  w.tick();
  const walker = put(w, 2, 9, 5);
  for (let i = 0; i < 6; i++) {
    cmd(w, 2, 4);
    if (bomb.tx === 8) break;
    w.tick();
  }
  for (let i = 0; i < 30; i++) {
    cmd(w, 2, 4);
    w.tick();
    assert.ok(penetration(walker, gridEnv(w)) < 1e-9, 'never inside a bomb tile');
  }
});

test('kick: two bombs entering one tile on one tick - the lower id moves, the other stops', () => {
  for (const order of [['left', 'top'], ['top', 'left']]) {
    const w = live(mk({ n: 3, flat: true }));
    put(w, 2, 13, 11);
    const heading = { left: { tx: 4, ty: 5, dir: 2 }, top: { tx: 5, ty: 4, dir: 3 } };      // both head for (5,5)
    const bombs = order.map((name, i) => ({ name, bomb: bombAt(w, i, heading[name].tx, heading[name].ty) }));
    put(w, 0, 1, 1);
    put(w, 1, 1, 11);
    w.tick();
    for (const { name, bomb } of bombs) Object.assign(bomb, { fuse: 5000, dir: heading[name].dir, step: 0 });
    w.tick();
    const [lower, higher] = bombs;                     // the first placed has the lower id
    assert.ok(lower.bomb.id < higher.bomb.id);
    assert.equal(w.bombs.filter((b) => b.tx === 5 && b.ty === 5).length, 1, 'never two bombs on one tile');
    assert.deepEqual([lower.bomb.tx, lower.bomb.ty], [5, 5], `${order}: the lower id moves in`);
    assert.equal(higher.bomb.dir, 0, 'the other one stops');
    assert.deepEqual([higher.bomb.tx, higher.bomb.ty], [heading[higher.name].tx, heading[higher.name].ty]);
    assert.equal(higher.bomb.x, higher.bomb.tx + 0.5);
  }
});

test('kick: items and flames do not stop a bomb, and a flame on its tile ignites it in that tick', () => {
  const { w, bomb } = kickWorld();
  drop(w, 'bomb', 8, 5);
  pushUntilKick(w, 0, 2);
  run(w, 20);
  assert.ok(bomb.tx >= 8, 'slid over the item');
  assert.equal(w.items.length, 1, 'the item is untouched');

  const burning = kickWorld();
  const rec = record(burning.w);
  bombAt(burning.w, 2, 7, 3);                            // its down arm burns (7,4),(7,5)
  put(burning.w, 2, 13, 11);
  burning.w.bombs[burning.w.bombs.length - 1].fuse = 1;
  burning.p.shield = 5000;
  rec.tick();
  assert.ok(burning.w.flames.some((f) => f.tx === 7 && f.ty === 5));
  rec.clear();
  for (let i = 0; i < 60 && rec.of('kick').length === 0; i++) {
    cmd(burning.w, 0, 2);
    rec.tick();
  }
  const kickTick = rec.of('kick')[0].k;
  const boom = rec.of('boom').find((e) => e.ev[1] === burning.bomb.id);
  assert.ok(boom, 'the kicked bomb exploded');
  assert.equal(boom.k, kickTick, 'in the very tick it slid into the burning tile');
  assert.equal(burning.bomb.tx, 7);
});

test('kick: the fuse keeps burning while sliding', () => {
  const { w, bomb } = kickWorld();
  bomb.fuse = 30;
  pushUntilKick(w, 0, 2);
  const fuse = bomb.fuse;
  run(w, 10);
  assert.equal(bomb.fuse, fuse - 10);
});

// ---- Glove and flying bombs --------------------------------------------------------------------

/** p0 (glove, facing right) stands on (3,5); flat board; p1 and p2 are spare fighters. */
function gloveWorld(tx = 3, ty = 5) {
  const w = live(mk({ n: 3, flat: true }));
  put(w, 1, 13, 11);
  put(w, 2, 1, 1);
  const p = put(w, 0, tx, ty);
  p.glove = true;
  p.facing = 1;
  return { w, p };
}

const throwOwn = (w, id = 0) => {
  const bomb = bombAt(w, id, Math.floor(w.player(id).x), Math.floor(w.player(id).y));
  cmd(w, id, 0, 0, 1);
  return bomb;
};

test('glove: throws the bomb under the player three tiles away; flight lasts THROW_TICKS then it lands', () => {
  const { w } = gloveWorld();
  const rec = record(w);
  const bomb = bombAt(w, 0, 3, 5);
  rec.pull();
  cmd(w, 0, 0, 0, 1);
  rec.pull();
  assert.deepEqual(rec.of('throw').map((e) => e.ev), [['throw', 0, bomb.id, 3, 5, 6, 5]]);
  assert.deepEqual(bomb.fly, { fx: 3.5, fy: 5.5, tx: 6, ty: 5, left: 26, total: 26 });
  assert.deepEqual([bomb.tx, bomb.ty, bomb.dir, bomb.pass], [6, 5, 0, []]);
  const fuse = bomb.fuse;
  rec.tick(10);
  assert.equal(bomb.fuse, fuse, 'the fuse is paused in flight');
  closeTo(bomb.x, 3.5 + 3 * (10 / 26), 1e-12);
  assert.equal(bomb.y, 5.5);
  rec.tick(15);
  assert.ok(bomb.fly, 'still flying after 25 ticks');
  assert.equal(rec.of('land').length, 0);
  rec.tick(1);
  assert.equal(bomb.fly, null);
  assert.deepEqual(rec.of('land').map((e) => e.ev), [['land', bomb.id, 6, 5]]);
  assert.deepEqual([bomb.x, bomb.y, bomb.tx, bomb.ty], [6.5, 5.5, 6, 5]);
  rec.tick(1);
  assert.equal(bomb.fuse, fuse - 1, 'the fuse resumes');
});

test('glove: a target on the adjacent tile travels two tiles (the destination counts from the thrower)', () => {
  const { w } = gloveWorld();
  const bomb = bombAt(w, 1, 4, 5);
  put(w, 1, 13, 11);
  w.tick();
  const rec = record(w);
  cmd(w, 0, 0, 0, 1);
  rec.pull();
  assert.deepEqual(rec.of('throw').map((e) => e.ev), [['throw', 0, bomb.id, 4, 5, 6, 5]], 'any owner, front tile');
});

test('glove: the bomb under the player wins over the one in front; nothing to throw = nothing happens', () => {
  const { w } = gloveWorld();
  const front = bombAt(w, 1, 4, 5);
  put(w, 1, 13, 11);
  const own = bombAt(w, 0, 3, 5);
  const rec = record(w);
  cmd(w, 0, 0, 0, 1);
  rec.pull();
  assert.equal(own.fly !== null, true);
  assert.equal(front.fly, null);

  const empty = gloveWorld();
  const rec2 = record(empty.w);
  cmd(empty.w, 0, 0, 0, 1);
  rec2.tick(3);
  assert.equal(rec2.log.length, 0);

  const noGlove = gloveWorld();
  noGlove.p.glove = false;
  const b = bombAt(noGlove.w, 0, 3, 5);
  cmd(noGlove.w, 0, 0, 0, 1);
  assert.equal(b.fly, null);
});

test('glove destinations: walls, occupied tiles and tiles already targeted push the landing further or back', () => {
  const destOf = (tx, ty, setup, facing = 1) => {
    const { w, p } = gloveWorld(tx, ty);
    p.facing = facing;
    setup?.(w);
    const bomb = bombAt(w, 0, tx, ty);
    cmd(w, 0, 0, 0, 1);
    return [bomb.fly.tx, bomb.fly.ty];
  };
  assert.deepEqual(destOf(3, 5), [6, 5]);
  assert.deepEqual(destOf(7, 5, null, 0), [7, 2], 'facing up');
  assert.deepEqual(destOf(7, 5, null, 2), [7, 8], 'facing down');
  assert.deepEqual(destOf(7, 5, null, 3), [4, 5], 'facing left');
  assert.deepEqual(destOf(11, 5), [13, 5], 'wall ahead: the last free tile before it');
  assert.deepEqual(destOf(12, 5), [13, 5]);
  assert.deepEqual(destOf(13, 5), [13, 5], 'facing the wall from the last tile: back onto its own tile');
  assert.deepEqual(destOf(10, 5), [13, 5], 'distance 3 is the last free tile');
  assert.deepEqual(destOf(3, 5, (w) => { bombAt(w, 1, 6, 5); put(w, 1, 13, 11); }), [7, 5], 'an occupied target tile is skipped');
  assert.deepEqual(destOf(3, 5, (w) => { w.grid[idx(6, 5)] = '+'; }), [7, 5], 'and so is a block');
  assert.deepEqual(destOf(3, 5, (w) => { put(w, 1, 6, 5); }), [6, 5], 'players do not disqualify a tile');
  assert.deepEqual(destOf(3, 5, (w) => { drop(w, 'bomb', 6, 5); }), [6, 5], 'items neither');
  assert.deepEqual(destOf(3, 5, (w) => { for (const x of [6, 7, 8, 9, 10, 11, 12, 13]) w.grid[idx(x, 5)] = '#'; }), [5, 5], 'everything ahead blocked: 2 tiles');
  assert.deepEqual(destOf(3, 5, (w) => { for (const x of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) w.grid[idx(x, 5)] = '#'; }), [3, 5], 'no candidate at all: the origin');
});

test('glove destinations: a tile that another bomb in flight is heading for is skipped', () => {
  const { w } = gloveWorld();
  const thrower2 = put(w, 1, 9, 5);
  thrower2.glove = true;
  thrower2.facing = 3;
  const a = bombAt(w, 0, 3, 5);
  const b = bombAt(w, 1, 9, 5);
  cmd(w, 0, 0, 0, 1);
  cmd(w, 1, 0, 0, 1);
  assert.deepEqual([a.fly.tx, a.fly.ty], [6, 5]);
  assert.deepEqual([b.fly.tx, b.fly.ty], [5, 5], 'dist 3 = (6,5) is taken, so dist 4');
});

test('flying bombs are not solid, ignore flames, cannot be thrown or kicked again, and still count against bombsMax', () => {
  const { w, p } = gloveWorld();
  const bomb = bombAt(w, 0, 3, 5);
  cmd(w, 0, 0, 0, 1);
  assert.ok(bomb.fly);
  const env = gridEnv(w);
  assert.equal(env.isSolid(6, 5, { id: 1 }), false, 'the landing tile is not solid yet');
  p.kick = true;
  cmd(w, 0, 0, 0, 1);
  assert.equal(bomb.fly.left, 26, 'a second throw of the same bomb is ignored');
  assert.equal(w.bombs.length, 1);
  put(w, 0, 3, 6);
  cmd(w, 0, 0, 1);
  assert.equal(w.bombs.length, 1, 'bombsMax counts the flying bomb');

  const burnt = gloveWorld();
  const thrown = bombAt(burnt.w, 0, 3, 5);
  cmd(burnt.w, 0, 0, 0, 1);
  bombAt(burnt.w, 1, 6, 7);                              // its up arm crosses the landing tile
  burnt.w.bombs[burnt.w.bombs.length - 1].fuse = 1;
  put(burnt.w, 1, 13, 11);
  const rec = record(burnt.w);
  rec.tick(1);
  assert.ok(burnt.w.flames.some((f) => f.tx === 6 && f.ty === 5));
  assert.ok(burnt.w.bombs.includes(thrown), 'a flying bomb is ignored by flames');
});

test('landing: pass lists the thrower and enemies overlapping the landing tile', () => {
  const { w } = gloveWorld();
  const bomb = bombAt(w, 0, 3, 5);
  cmd(w, 0, 0, 0, 1);
  put(w, 0, 6, 5);
  put(w, 1, 6, 5, 0.6, 0);
  run(w, 26);
  assert.deepEqual([bomb.tx, bomb.ty, bomb.fly], [6, 5, null]);
  assert.deepEqual(bomb.pass, [0, 1]);
  run(w, 1);
  assert.deepEqual(bomb.pass, [0, 1], 'still overlapping');
  put(w, 1, 9, 9);
  w.tick();
  assert.deepEqual(bomb.pass, [0]);
});

test('landing: when the destination became invalid the nearest free tile is used (BFS: up, right, down, left)', () => {
  for (const [label, block, want] of [
    ['a bomb settled there', (w) => { bombAt(w, 1, 6, 5); put(w, 1, 13, 11); }, [6, 4]],
    ['a sudden-death wall landed there', (w) => { w.grid[idx(6, 5)] = 'X'; }, [6, 4]],
    ['a block appeared there', (w) => { w.grid[idx(6, 5)] = '+'; }, [6, 4]],
    ['up is taken as well', (w) => { w.grid[idx(6, 5)] = 'X'; w.grid[idx(6, 4)] = 'X'; }, [7, 5]],
    ['up and right are taken', (w) => { for (const [x, y] of [[6, 5], [6, 4], [7, 5]]) w.grid[idx(x, y)] = 'X'; }, [6, 6]],
    ['up, right and down are taken', (w) => { for (const [x, y] of [[6, 5], [6, 4], [7, 5], [6, 6]]) w.grid[idx(x, y)] = 'X'; }, [5, 5]],
  ]) {
    const { w } = gloveWorld();
    const bomb = bombAt(w, 0, 3, 5);
    cmd(w, 0, 0, 0, 1);
    put(w, 0, 1, 1);
    run(w, 5);
    block(w);
    const rec = record(w);
    rec.tick(21);
    assert.deepEqual([bomb.tx, bomb.ty], want, label);
    assert.deepEqual(rec.of('land').map((e) => e.ev), [['land', bomb.id, want[0], want[1]]], label);
  }
});

test('landing: with nothing valid within six steps the search continues from the origin', () => {
  const { w } = gloveWorld();
  const bomb = bombAt(w, 0, 3, 5);
  cmd(w, 0, 0, 0, 1);
  put(w, 0, 1, 1);
  // Wall off everything within 6 steps of the destination (6,5), keeping the origin's neighbourhood free.
  for (let ty = 1; ty <= 11; ty++) for (let tx = 1; tx <= 13; tx++) {
    if (Math.abs(tx - 6) + Math.abs(ty - 5) <= 6) w.grid[idx(tx, ty)] = 'X';
  }
  w.grid[idx(3, 5)] = '.';
  w.grid[idx(2, 5)] = '.';
  run(w, 26);
  assert.deepEqual([bomb.tx, bomb.ty], [3, 5], 'lands on/near the origin, the nearest free tile from there');
  assert.equal(bomb.fly, null);
});

test('landing: two bombs due on one tile - the lower id lands, the other takes the BFS neighbour', () => {
  const { w } = gloveWorld();
  const thrower2 = put(w, 1, 3, 6);
  thrower2.glove = true;
  thrower2.facing = 1;
  const a = bombAt(w, 0, 3, 5);
  const b = bombAt(w, 1, 3, 6);
  cmd(w, 0, 0, 0, 1);
  cmd(w, 1, 0, 0, 1);
  b.fly.tx = a.fly.tx;                                   // force the same destination (both were valid when thrown)
  b.fly.ty = a.fly.ty;
  b.tx = a.tx;
  b.ty = a.ty;
  put(w, 0, 1, 1);
  put(w, 1, 13, 11);
  run(w, 26);
  assert.deepEqual([a.tx, a.ty], [6, 5]);
  assert.deepEqual([b.tx, b.ty], [6, 4], 'up is the first BFS neighbour');
  assert.equal(w.bombs.filter((x) => x.tx === 6 && x.ty === 5).length, 1);
});

test('landing on a lingering flame detonates in the landing tick', () => {
  const { w } = gloveWorld();
  const rec = record(w);
  const bomb = bombAt(w, 0, 3, 5);
  cmd(w, 0, 0, 0, 1);
  put(w, 0, 1, 1);
  const other = bombAt(w, 1, 6, 7);
  other.fuse = 10;
  put(w, 1, 13, 11);
  rec.tick(25);
  assert.equal(rec.of('boom').length, 1, 'only the helper bomb so far');
  assert.ok(bomb.fly);
  rec.tick(1);
  const land = rec.of('land')[0];
  const boom = rec.of('boom').find((e) => e.ev[1] === bomb.id);
  assert.ok(boom);
  assert.equal(boom.k, land.k);
});

test('a sliding bomb cannot be thrown', () => {
  const { w, p } = gloveWorld();
  p.kick = true;
  const bomb = bombAt(w, 1, 4, 5);
  put(w, 1, 13, 11);
  w.tick();
  bomb.fuse = 5000;
  put(w, 0, 3, 5);
  Object.assign(bomb, { dir: 2, step: 3 });
  const rec = record(w);
  cmd(w, 0, 0, 0, 1);
  rec.pull();
  assert.equal(rec.of('throw').length, 0);
});

// ---- Sudden death ------------------------------------------------------------------------------

/** The last cell of the spiral, in the middle of the board: (7,6) is a pillar in the open layout, so use (8,6) there. */
const LAST_CELL = { classic: [7, 6], open: [8, 6] };

/** Runs a fresh world to the tick sudden death starts; both fighters idle on the last cell of the spiral. */
function toSuddenDeath(opts = {}) {
  const w = live(mk({ n: 2, open: false, roundTime: 60, ...opts }));
  for (const p of w.players) put(w, p.id, ...LAST_CELL[opts.layout ?? 'classic']);
  while (!w.suddenDeath) w.tick();
  return w;
}

test('sudden death starts exactly when the clock reaches 0, with event sdstart and the clock pinned at 0', () => {
  const w = live(mk({ n: 2, roundTime: 60 }));
  for (const p of w.players) put(w, p.id, 7, 6);
  const rec = record(w);
  rec.tick(3599);
  assert.equal(w.suddenDeath, false);
  assert.equal(w.timeLeft, 1);
  rec.tick(1);
  assert.equal(w.suddenDeath, true);
  assert.equal(w.timeLeft, 0);
  assert.equal(w.tickNo, 180 + 3600);
  assert.equal(w.sdStart, 180 + 3600);
  assert.equal(rec.of('sdstart').length, 1);
  assert.equal(w.snapshot().sd, 1);
  assert.equal(w.snapshot().r, 0);
  rec.tick(100);
  assert.equal(rec.of('sdstart').length, 1);
  assert.equal(w.timeLeft, 0);
});

test('the spiral covers every non-wall cell exactly once, clockwise from the top-left of each ring (both layouts)', () => {
  for (const layout of ['classic', 'open']) {
    const w = toSuddenDeath({ layout });
    const cells = [];
    for (let i = 0; i < w.grid.length; i++) if (w.grid[i] !== '#') cells.push(i);
    assert.equal(w.sdOrder.length, layout === 'classic' ? 113 : 134);
    assert.deepEqual([...w.sdOrder].sort((a, b) => a - b), cells, `${layout}: every non-wall cell once`);
    const xy = (i) => [i % W, Math.floor(i / W)];
    const head = w.sdOrder.slice(0, 13).map(xy);
    assert.deepEqual(head, Array.from({ length: 13 }, (_, k) => [k + 1, 1]), 'top row of ring 1 left to right');
    const right = w.sdOrder.slice(13, 23).map(xy);
    assert.deepEqual(right, Array.from({ length: 10 }, (_, k) => [13, k + 2]), 'right column downwards');
    const bottom = w.sdOrder.slice(23, 35).map(xy);
    assert.deepEqual(bottom, Array.from({ length: 12 }, (_, k) => [12 - k, 11]), 'bottom row right to left');
    const left = w.sdOrder.slice(35, 44).map(xy);
    assert.deepEqual(left, Array.from({ length: 9 }, (_, k) => [1, 10 - k]), 'left column upwards');
    assert.deepEqual(xy(w.sdOrder[w.sdOrder.length - 1]), LAST_CELL[layout], 'ends in the middle');
    assert.equal(w.sdNext, 1, 'first cell started on the very tick');
  }
});

test('the spiral skips hard walls but includes soft blocks and current holders of bombs', () => {
  const w = live(mk({ n: 2, roundTime: 60 }));
  w.grid[idx(1, 1)] = 'X';                         // a wall placed before sudden death is skipped
  for (const p of w.players) put(w, p.id, 7, 6);
  while (!w.suddenDeath) w.tick();
  assert.ok(!w.sdOrder.includes(idx(1, 1)));
  assert.equal(w.sdOrder.length, 112);
});

test('schedule: cell i starts falling at sdStart + 8i and its wall lands SD_WARN_TICKS later, exactly at landTick', () => {
  const w = toSuddenDeath();
  const n = w.sdOrder.length;
  const rec = record(w);
  const landed = new Map();
  const started = new Map();
  const startTick = w.sdStart;
  const first = w.falling.map((f) => [f.tx, f.ty, f.ticksLeft]);
  assert.deepEqual(first, [[1, 1, C.SD_WARN_TICKS]], 'the first tile is telegraphed on the sdstart tick');
  for (let t = 0; t < n * 8 + 60 && w.state === STATE.PLAYING; t++) {
    rec.tick();
    for (const f of w.falling) if (!started.has(`${f.tx},${f.ty}`)) started.set(`${f.tx},${f.ty}`, w.tickNo);
    for (const e of rec.log) if (e.ev[0] === 'sdland' && !landed.has(`${e.ev[1]},${e.ev[2]}`)) landed.set(`${e.ev[1]},${e.ev[2]}`, e.k);
  }
  for (let i = 1; i <= n - 1; i++) {
    const t = w.sdOrder[i];
    const key = `${t % W},${Math.floor(t / W)}`;
    assert.equal(started.get(key), startTick + i * C.SD_INTERVAL, `cell ${i} starts`);
    assert.equal(landed.get(key), startTick + i * C.SD_INTERVAL + C.SD_WARN_TICKS, `cell ${i} lands`);
    assert.equal(w.landTick(t % W, Math.floor(t / W)), landed.get(key));
    assert.equal(w.grid[t], 'X');
  }
  assert.ok(w.landTick(7, 6) - w.sdStart <= 952, 'within the classic bound');
});

test('gridVer counts every cell change: one per destroyed block and one per landed sudden-death tile', () => {
  const w = toSuddenDeath();
  const rec = record(w);
  const before = w.gridVer;
  for (let t = 0; t < 400 && w.state === STATE.PLAYING; t++) rec.tick();
  const landed = rec.of('sdland').length;
  assert.ok(landed > 40, 'a good part of the spiral landed');
  assert.equal(w.gridVer - before, landed, 'each landing bumps gridVer exactly once (a soft block under the tile included)');
  assert.equal(w.grid.filter((c) => c === 'X').length, landed);
});

test('landTick: Infinity before sudden death, for walls, and for anything cancelled by the lock', () => {
  const w = live(mk({ n: 2, roundTime: 60 }));
  assert.equal(w.landTick(3, 3), Infinity);
  for (const p of w.players) put(w, p.id, 7, 6);
  while (!w.suddenDeath) w.tick();
  assert.equal(w.landTick(0, 0), Infinity);
  assert.equal(w.landTick(2, 2), Infinity, 'pillar');
  assert.equal(w.landTick(99, 99), Infinity);
  assert.equal(w.landTick(3.5, 3), Infinity, 'a fractional tile is not scheduled (never NaN)');
  assert.equal(w.landTick(NaN, 3), Infinity);
  assert.equal(w.landTick(3, 3), w.sdStart + w.sdOrder.indexOf(idx(3, 3)) * 8 + 48);
  w.player(1).alive = false;
  w.tick();
  assert.equal(w.state, STATE.ENDING);
  assert.equal(w.landTick(3, 3), Infinity, 'cancelled falling and unstarted cells never land now');
});

test('classic sudden death ends every round within 952 ticks; open within 1120', () => {
  for (const [layout, bound] of [['classic', 952], ['open', 1120]]) {
    const w = live(mk({ n: 2, open: false, roundTime: 60, layout }));
    const spot = layout === 'classic' ? [7, 6] : [8, 6];
    for (const p of w.players) put(w, p.id, spot[0], spot[1]);
    while (!w.suddenDeath) w.tick();
    const start = w.sdStart;
    while (w.state === STATE.PLAYING) w.tick();
    assert.ok(w.outcome.tick - start <= bound, `${layout}: ${w.outcome.tick - start}`);
    assert.equal(w.outcome.reason, 'wipe');
  }
});

test('landing kills every fighter whose HITBOX overlaps the tile, shield or not, with killer -1', () => {
  const w = live(mk({ n: 3, roundTime: 60 }));
  const rec = record(w);
  const nearby = put(w, 0, 3, 1, -0.2, 0);          // x = 3.3: centre in tile 3, hitbox [2.96, 3.64] overlaps tile 2
  nearby.shield = 5000;
  nearby.spawnShield = 5000;
  put(w, 1, 7, 6);
  put(w, 2, 7, 6);
  while (!w.suddenDeath) w.tick();
  rec.clear();
  const landAt = w.landTick(2, 1);
  while (w.tickNo < landAt) rec.tick();
  assert.equal(nearby.alive, false);
  assert.equal(nearby.killer, -1);
  const events = rec.log.filter((e) => e.k === landAt).map((e) => e.ev);
  assert.deepEqual(events, [['death', 0, -1, 3.3, 1.5], ['sdland', 2, 1]]);
  assert.equal(nearby.stats.selfKills, 0);
  assert.equal(nearby.stats.deaths, 1);
});

test('a fighter clear of the landing tile survives it and cannot walk into the new wall', () => {
  const w = live(mk({ n: 3, roundTime: 60 }));
  const safe = put(w, 0, 5, 3);
  const walker = put(w, 1, 3, 1);                   // x = 3.5: hitbox clear of tile 2, tile 3 only lands 8 ticks after tile 2
  put(w, 2, 7, 6);
  while (!w.suddenDeath) w.tick();
  put(w, 1, 3, 1);
  while (w.tickNo < w.landTick(2, 1)) w.tick();
  assert.equal(w.grid[idx(2, 1)], 'X');
  assert.equal(safe.alive, true);
  assert.equal(walker.alive, true, 'the hitbox never touched tile 2');
  for (let i = 0; i < 7; i++) {
    cmd(w, 1, 4);
    w.tick();
    assert.ok(walker.alive);
    assert.ok(walker.x - HALF >= 3 - 1e-9, 'never inside the new wall');
  }
  closeTo(walker.x, 3 + HALF + EPS, 1e-9);
  assert.equal(walker.moving, false);
});

test('a landing tile clears bombs, items and flames on it and opens no drop from a soft block', () => {
  const w = live(mk({ n: 3, roundTime: 60 }));
  const rec = record(w);
  plant(w, 6, 1, 'kick');
  const bomb = bombAt(w, 0, 5, 1);
  bomb.fuse = 99999;
  drop(w, 'bomb', 5, 1);
  for (const p of w.players) put(w, p.id, 7, 6);
  while (!w.suddenDeath) w.tick();
  const helper = bombAt(w, 1, 3, 3);                 // explodes 40 ticks into sudden death; its flames burn (3,1) until +75
  helper.fuse = 40;
  put(w, 1, 7, 6);
  rec.clear();
  const flameAt = (tx, ty) => w.flames.some((f) => f.tx === tx && f.ty === ty);
  while (w.tickNo < w.landTick(3, 1) - 1) rec.tick();
  assert.ok(flameAt(3, 1), 'a flame is burning on the tile that is about to land');
  rec.tick();
  assert.ok(!flameAt(3, 1), 'and it is gone with the tile');
  assert.equal(w.grid[idx(3, 1)], 'X');
  while (w.tickNo < w.landTick(5, 1)) rec.tick();
  assert.ok(!w.bombs.includes(bomb));
  assert.equal(w.items.length, 0);
  assert.ok(rec.of('bombgone').some((e) => e.ev[1] === bomb.id && e.ev[2] === 5 && e.ev[3] === 1));
  assert.ok(rec.of('itemgone').some((e) => e.ev[2] === 5 && e.ev[3] === 1 && e.ev[4] === 'bomb'));
  while (w.tickNo < w.landTick(6, 1)) rec.tick();
  assert.equal(w.grid[idx(6, 1)], 'X');
  assert.equal(w.items.length, 0, 'the block\'s prize is not revealed');
  assert.equal(rec.of('block').length, 0);
  assert.equal(rec.of('itemspawn').length, 0);
});

test('a bomb on a landing tile is removed without exploding, and its owner may place again', () => {
  const w = live(mk({ n: 3, roundTime: 60 }));
  const rec = record(w);
  const bomb = bombAt(w, 0, 4, 1);
  bomb.fuse = 99999;
  for (const p of w.players) put(w, p.id, 7, 6);
  while (!w.suddenDeath) w.tick();
  while (w.tickNo < w.landTick(4, 1)) rec.tick();
  assert.equal(w.bombs.length, 0);
  assert.equal(rec.of('boom').length, 0);
  assert.equal(rec.of('bombgone').length, 1);
});

test('safety net: a fighter whose centre tile is a wall or block dies with killer -1, shield ignored', () => {
  for (const c of ['#', 'X', '+']) {
    const w = live(mk({ n: 3 }));
    const p = put(w, 0, 5, 5);
    p.shield = 900;
    w.grid[idx(5, 5)] = c;
    const rec = record(w);
    rec.tick();
    assert.equal(p.alive, false, c);
    assert.deepEqual(rec.of('death').map((e) => e.ev), [['death', 0, -1, 5.5, 5.5]]);
  }
});

test('the outcome lock cancels falling tiles and freezes the schedule; survivors are not crushed during ending', () => {
  const w = toSuddenDeath();
  run(w, 100);
  assert.ok(w.falling.length > 0);
  const next = w.sdNext;
  w.player(1).alive = false;
  w.tick();
  assert.equal(w.state, STATE.ENDING);
  assert.equal(w.falling.length, 0);
  const grid = w.grid.join('');
  const rec = record(w);
  rec.tick(149);
  assert.equal(w.sdNext, next, 'sdNext frozen');
  assert.equal(rec.of('sdland').length, 0);
  assert.equal(w.grid.join(''), grid);
  assert.equal(w.player(0).alive, true);
  assert.equal(w.suddenDeath, true, 'the flag stays for the renderer');
});

test('roundTime 0 or suddenDeath off never starts sudden death', () => {
  const off = live(mk({ n: 3, roundTime: 60, suddenDeath: false }));
  run(off, 3700);
  assert.equal(off.suddenDeath, false);
  assert.equal(off.eventsSince(0).filter((e) => e[0] === 'sdstart').length, 0);
});

// ---- Outcome lock ------------------------------------------------------------------------------

test('last fighter standing wins; the lock shields survivors, clears curses and starts the ending timeline', () => {
  const w = live(mk({ n: 2 }));
  const rec = record(w);
  const p0 = put(w, 0, 1, 1);
  p0.curse = 'spam';
  p0.curseTicks = 400;
  p0.shield = 5;
  p0.spawnShield = 7;
  bombAt(w, 0, 5, 5);
  put(w, 0, 1, 1);
  put(w, 1, 5, 6);
  const timeBefore = w.timeLeft;
  rec.tick(150);
  const lockTick = w.tickNo;
  assert.deepEqual(w.outcome, { winnerId: 0, winnerTeam: null, draw: false, reason: 'last', tick: lockTick });
  assert.equal(w.state, STATE.ENDING);
  assert.equal(p0.shield, C.SHIELD_FOREVER);
  assert.equal(p0.spawnShield, 0);
  assert.equal(p0.curse, null);
  assert.equal(p0.curseTicks, 0);
  assert.deepEqual(rec.of('curse').map((e) => e.ev), [['curse', 0, 0, -1]]);
  assert.equal(w.timeLeft, timeBefore - 150, 'the clock stopped at the lock');
  const outcome = w.outcome;
  rec.tick(149);
  assert.equal(w.state, STATE.ENDING, '149 ticks after the lock it is still ending');
  assert.equal(w.timeLeft, timeBefore - 150);
  assert.equal(p0.shield, C.SHIELD_FOREVER, 'never decremented');
  rec.tick(1);
  assert.equal(w.state, STATE.OVER, 'OVER at lock + ENDING_TICKS');
  assert.equal(w.tickNo, lockTick + C.ENDING_TICKS);
  assert.equal(w.outcome, outcome, 'set exactly once');
});

test('OVER is terminal: tick() is a no-op and the snapshot stops changing', () => {
  const w = live(mk({ n: 2 }));
  w.player(1).alive = false;
  run(w, 151);
  assert.equal(w.state, STATE.OVER);
  const before = JSON.stringify(w.snapshot({ grid: true }));
  const tickNo = w.tickNo;
  run(w, 50);
  assert.equal(w.tickNo, tickNo);
  assert.equal(JSON.stringify(w.snapshot({ grid: true })), before);
  assert.equal(w.snapshot().st, 3);
});

test('during ending survivors may walk, bomb and collect, bombs and flames keep resolving, and nothing can kill them', () => {
  const w = live(mk({ n: 2 }));
  const p0 = put(w, 0, 5, 5);
  w.player(1).alive = false;
  w.tick();
  assert.equal(w.state, STATE.ENDING);
  cmd(w, 0, 2);
  assert.ok(p0.x > 5.5, 'walking');
  cmd(w, 0, 0, 1);
  assert.equal(w.bombs.length, 1, 'placing');
  drop(w, 'flame', Math.floor(p0.x), Math.floor(p0.y) + 1);
  put(w, 0, Math.floor(p0.x), Math.floor(p0.y) + 1);
  w.tick();
  assert.equal(p0.range, 3, 'collecting');
  put(w, 0, 5, 5);
  const outcome = w.outcome;
  w.bombs[0].fuse = 10;
  run(w, 10);                                        // the bomb explodes on top of the survivor
  assert.equal(w.bombs.length, 0);
  assert.ok(w.flames.length > 0, 'flames keep resolving');
  run(w, 5);
  assert.equal(p0.alive, true);
  assert.equal(w.outcome, outcome);
});

test('a kill on the last tick of the clock still wins (suddenDeath off)', () => {
  const w = live(mk({ n: 2, roundTime: 60, suddenDeath: false }));
  bombAt(w, 0, 5, 5);
  put(w, 0, 1, 1);
  put(w, 1, 5, 6);
  w.timeLeft = 150;                                  // reaches 0 on the very tick the bomb explodes
  run(w, 150);
  assert.equal(w.timeLeft, 0);
  assert.deepEqual([w.outcome.reason, w.outcome.winnerId, w.outcome.draw], ['last', 0, false]);
});

test('last-second double KO is a wipe, not a timeout', () => {
  const w = live(mk({ n: 2, roundTime: 60, suddenDeath: false }));
  bombAt(w, 0, 5, 5);
  put(w, 0, 5, 5);
  put(w, 1, 5, 6);
  w.timeLeft = 150;
  run(w, 150);
  assert.deepEqual([w.outcome.reason, w.outcome.draw], ['wipe', true]);
});

test('timeout with suddenDeath off is a draw even when several fighters are alive', () => {
  const w = live(mk({ n: 3, roundTime: 60, suddenDeath: false }));
  run(w, 3599);
  assert.equal(w.outcome, null);
  w.tick();
  assert.deepEqual(w.outcome, { winnerId: null, winnerTeam: null, draw: true, reason: 'timeout', tick: 180 + 3600 });
  assert.equal(w.state, STATE.ENDING);
  assert.ok(w.players.every((p) => p.alive && p.shield === C.SHIELD_FOREVER));
});

test('roundTime 0 with two idle fighters is a draw at MAX_ROUND_TICKS', () => {
  const w = live(mk({ n: 2, roundTime: 0 }));
  run(w, C.MAX_ROUND_TICKS - 1);
  assert.equal(w.outcome, null);
  assert.equal(w.timeLeft, -1);
  w.tick();
  assert.deepEqual(w.outcome, { winnerId: null, winnerTeam: null, draw: true, reason: 'timeout', tick: 180 + C.MAX_ROUND_TICKS });
  assert.equal(w.suddenDeath, false);
});

test('teams: the last team standing wins (winnerTeam set, winnerId null); friendly survivors keep the round going', () => {
  const fighters = [fighter(0, { team: 0 }), fighter(1, { team: 1 }), fighter(2, { team: 0 }), fighter(3, { team: 1 })];
  const w = live(mk({ fighters, mode: 'teams' }));
  bombAt(w, 0, 5, 5);
  put(w, 0, 1, 1);
  put(w, 2, 13, 1);
  put(w, 1, 5, 6);
  put(w, 3, 13, 11);
  run(w, 150);
  assert.equal(w.outcome, null, 'team 1 still has a fighter');
  w.player(3).alive = false;
  w.tick();
  assert.deepEqual(w.outcome, { winnerId: null, winnerTeam: 0, draw: false, reason: 'last', tick: w.tickNo });

  const ffa = live(mk({ fighters, mode: 'ffa' }));
  ffa.player(1).alive = false;
  ffa.player(3).alive = false;
  run(ffa, 5);
  assert.equal(ffa.outcome, null, 'in FFA two teammates still fight each other');
});

test('teams: everyone dead is a wipe; a timeout with both teams alive is a draw', () => {
  const fighters = [fighter(0, { team: 0 }), fighter(1, { team: 1 })];
  const wipe = live(mk({ fighters, mode: 'teams' }));
  wipe.players.forEach((p) => { p.alive = false; });
  wipe.tick();
  assert.equal(wipe.outcome.reason, 'wipe');
  const timeout = live(mk({ fighters, mode: 'teams', roundTime: 60, suddenDeath: false }));
  run(timeout, 3600);
  assert.deepEqual([timeout.outcome.reason, timeout.outcome.draw, timeout.outcome.winnerTeam], ['timeout', true, null]);
});

// ---- Showdown ----------------------------------------------------------------------------------

/** One human (id 0) and three bots; the human dies to its own bomb on play tick `at`. */
function showdownWorld(at, opts = {}) {
  const fighters = [fighter(0), fighter(1, { isBot: true }), fighter(2, { isBot: true }), fighter(3, { isBot: true })];
  const w = live(mk({ fighters, ...opts }));
  put(w, 1, 13, 1);
  put(w, 2, 13, 11);
  put(w, 3, 1, 11);
  const rec = record(w);
  run(w, at - C.FUSE_TICKS);                        // to play tick (at - 150)
  bombAt(w, 0, 5, 5);
  rec.pull();
  rec.tick(C.FUSE_TICKS);
  return { w, rec };
}

test('showdown: when the last human dies with >= 2 fighters left the clock is cut to SHOWDOWN_TICKS', () => {
  const { w, rec } = showdownWorld(600);
  assert.equal(w.tickNo, 180 + 600);
  assert.equal(w.player(0).alive, false);
  assert.equal(w.timeLeft, C.SHOWDOWN_TICKS);
  const shows = rec.of('showdown');
  assert.equal(shows.length, 1);
  assert.equal(shows[0].k, 780);
  const order = rec.log.map((e) => e.ev[0]);
  assert.ok(order.indexOf('death') < order.indexOf('showdown'));
  run(w, C.SHOWDOWN_TICKS);
  assert.equal(w.suddenDeath, true, 'sudden death follows 15 s later');
});

test('showdown: not announced when it would not shorten anything, when SD is off, or while another human lives', () => {
  const late = showdownWorld(6500);
  assert.equal(late.rec.of('showdown').length, 0, 'timeLeft was already <= 900');
  assert.ok(late.w.timeLeft <= C.SHOWDOWN_TICKS);

  const noSd = showdownWorld(600, { suddenDeath: false });
  assert.equal(noSd.rec.of('showdown').length, 0);
  assert.ok(noSd.w.timeLeft > C.SHOWDOWN_TICKS);

  const fighters = [fighter(0), fighter(1), fighter(2, { isBot: true }), fighter(3, { isBot: true })];
  const two = live(mk({ fighters }));
  put(two, 1, 13, 1);
  put(two, 2, 13, 11);
  put(two, 3, 1, 11);
  bombAt(two, 0, 5, 5);
  run(two, 150);
  assert.equal(two.player(0).alive, false);
  assert.equal(two.eventsSince(0).filter((e) => e[0] === 'showdown').length, 0, 'a human is still alive');
  assert.ok(two.timeLeft > C.SHOWDOWN_TICKS);
});

test('showdown: needs a fight to be left, and never fires in a bot-only round', () => {
  const fighters = [fighter(0), fighter(1, { isBot: true })];
  const w = live(mk({ fighters }));
  bombAt(w, 0, 5, 5);
  put(w, 1, 13, 11);
  run(w, 150);
  assert.equal(w.outcome.winnerId, 1, 'the round is simply over');
  assert.equal(w.eventsSince(0).filter((e) => e[0] === 'showdown').length, 0);

  const bots = live(mk({ fighters: [1, 2, 3].map((id) => fighter(id, { isBot: true })) }));
  bombAt(bots, 1, 5, 5);
  put(bots, 2, 13, 1);
  put(bots, 3, 13, 11);
  run(bots, 150);
  assert.equal(bots.eventsSince(0).filter((e) => e[0] === 'showdown').length, 0);
});

test('showdown: a human who leaves does not count, and in team mode both teams must still be alive', () => {
  const fighters = [fighter(0), fighter(1, { isBot: true }), fighter(2, { isBot: true })];
  const w = live(mk({ fighters }));
  const rec = record(w);
  w.removeFighter(0);
  rec.tick();
  assert.equal(w.timeLeft, C.SHOWDOWN_TICKS);
  assert.equal(rec.of('showdown').length, 1);

  const teams = [fighter(0, { team: 0 }), fighter(1, { team: 1, isBot: true }), fighter(2, { team: 1, isBot: true })];
  const same = live(mk({ fighters: teams, mode: 'teams' }));
  bombAt(same, 0, 5, 5);
  put(same, 0, 5, 5);
  put(same, 1, 13, 11);
  put(same, 2, 13, 1);
  run(same, 150);
  assert.equal(same.player(0).alive, false);
  assert.equal(same.outcome.winnerTeam, 1, 'the two bots are one team: decided at once');
  assert.equal(same.eventsSince(0).filter((e) => e[0] === 'showdown').length, 0);
  assert.ok(same.timeLeft > C.SHOWDOWN_TICKS);
});

// ---- removeFighter -----------------------------------------------------------------------------

test('removeFighter: dies with only a `left` event, keeps stats, orphans bombs, stays in the players array', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  const p = put(w, 1, 5, 5);
  p.curse = 'slow';
  p.curseTicks = 100;
  cmd(w, 1, 0, 1);
  const bomb = w.bombs[0];
  rec.pull();
  rec.clear();
  w.removeFighter(1);
  rec.pull();
  assert.deepEqual(rec.log.map((e) => e.ev), [['left', 1]]);
  assert.equal(p.alive, false);
  assert.equal(p.removed, true);
  assert.equal(p.killer, -2);
  assert.equal(p.moving, false);
  assert.equal(p.stats.deaths, 0);
  assert.equal(p.stats.selfKills, 0);
  assert.equal(bomb.owner, -1);
  assert.ok(w.players.includes(p));
  assert.equal(w.player(1), p);
  w.removeFighter(1);
  w.removeFighter(99);
  rec.pull();
  assert.equal(rec.log.length, 1, 'idempotent, unknown ids ignored');
  const row = w.snapshot().p.find((r) => r[0] === 1);
  assert.equal(row[4] & 2, 0, 'not alive on the wire');
  assert.equal(w.snapshot().ack[1], undefined, 'no ack for a removed fighter');
});

test('removeFighter: the outcome is evaluated at the end of the next tick; orphaned bombs explode and credit nobody', () => {
  const w = live(mk({ n: 2 }));
  assert.equal(w.outcome, null);
  w.removeFighter(1);
  assert.equal(w.outcome, null, 'not synchronously');
  w.tick();
  assert.deepEqual(w.outcome, { winnerId: 0, winnerTeam: null, draw: false, reason: 'last', tick: w.tickNo });

  const both = live(mk({ n: 2 }));
  both.removeFighter(0);
  both.removeFighter(1);
  both.tick();
  assert.equal(both.outcome.reason, 'wipe');

  const late = live(mk({ n: 2 }));
  late.player(1).alive = false;
  late.tick();
  const outcome = late.outcome;
  late.removeFighter(0);
  run(late, 5);
  assert.equal(late.outcome, outcome, 'a survivor leaving after the lock changes nothing');
});

test('removeFighter before the round starts, and cmds from removed fighters are only acked', () => {
  const w = mk({ n: 3 });
  w.removeFighter(2);
  live(w);
  assert.equal(w.state, STATE.PLAYING);
  cmd(w, 2, 2, 1);
  assert.equal(w.player(2).lastSeq, 1);
  assert.equal(w.bombs.length, 0);
});

// ---- Event log ---------------------------------------------------------------------------------

test('events: absolute indexes, eventsSince, trimEvents and the 128 cap', () => {
  const w = mk({ n: 2 });
  assert.deepEqual(w.eventsSince(0), []);
  for (let i = 0; i < 300; i++) w._emit('bomb', i, 0, 0, 0);
  assert.equal(w.evCount, 300);
  const all = w.eventsSince(0);
  assert.equal(all.length, 128, 'at most the newest 128');
  assert.equal(all[all.length - 1][1], 299);
  assert.equal(all[0][1], 172);
  assert.deepEqual(w.eventsSince(298).map((e) => e[1]), [298, 299]);
  assert.deepEqual(w.eventsSince(300), []);
  assert.deepEqual(w.eventsSince(1000), []);
  w.trimEvents(250);
  assert.deepEqual(w.eventsSince(0).map((e) => e[1]).slice(0, 2), [250, 251], 'trimmed events are gone');
  assert.deepEqual(w.eventsSince(290).map((e) => e[1]), [290, 291, 292, 293, 294, 295, 296, 297, 298, 299]);
  w._emit('go');
  assert.equal(w.evCount, 301);
  assert.deepEqual(w.eventsSince(300), [['go']]);
  w.trimEvents(301);
  assert.deepEqual(w.eventsSince(0), []);
  w.trimEvents(5);
  assert.equal(w.evCount, 301, 'trimming backwards is harmless');
});

test('events: an untrimmed log stays bounded but absolute indexes stay correct', () => {
  const w = mk({ n: 2 });
  for (let i = 0; i < 5000; i++) w._emit('bomb', i, 0, 0, 0);
  assert.equal(w.evCount, 5000);
  assert.ok(w._events.length <= 1100, `retained ${w._events.length}`);
  assert.deepEqual(w.eventsSince(4998).map((e) => e[1]), [4998, 4999]);
  assert.equal(w.eventsSince(0).at(-1)[1], 4999);
});

test('events are emitted in the step order of SPEC 3.2a within one tick', () => {
  const w = live(mk({ n: 3 }));
  const rec = record(w);
  plant(w, 5, 3, 'bomb');
  drop(w, 'flame', 7, 5);
  bombAt(w, 0, 5, 5, 3);
  put(w, 0, 1, 1);
  put(w, 1, 5, 6);
  put(w, 2, 13, 11);
  rec.tick(150);
  const codes = rec.log.filter((e) => e.k === w.tickNo).map((e) => e.ev[0]);
  assert.deepEqual(codes, ['itemgone', 'boom', 'block', 'itemspawn', 'death']);
});

// ---- Performance -------------------------------------------------------------------------------

test('a full 8-player 9000-tick round with bot-like random commands simulates in under 300 ms', () => {
  const simulate = (seed) => {
    const fighters = Array.from({ length: 8 }, (_, i) => fighter(i, { isBot: i > 0, team: i % 2 }));
    const w = new World({ seed, fighters, mode: 'ffa', layout: 'classic', blocks: 'normal', items: 'normal', theme: 'meadow', roundTime: 180, suddenDeath: true });
    const rng = makeRng(seed);
    for (const p of w.players) { p.kick = true; p.glove = true; p.bombsMax = 3; }
    const started = performance.now();
    for (let t = 0; t < 9000; t++) {
      for (const p of w.players) {
        if (t % 40 === 0) p.shield = C.SHIELD_FOREVER;                    // keep everyone in the game so all systems stay busy
        if (t % 5 === 0 || p.moving === false) w.applyCmd(p.id, { s: t + 1, d: rng.int(5), b: rng.int(24) === 0 ? 1 : 0, x: rng.int(60) === 0 ? 1 : 0 });
      }
      w.tick();
      if (t % 3 === 0) { w.snapshot({ evFrom: 0 }); w.trimEvents(w.evCount); }
    }
    return performance.now() - started;
  };
  simulate(3);                                                             // warm-up
  const best = Math.min(simulate(11), simulate(12), simulate(13));
  assert.ok(best < 300, `best of 3: ${best.toFixed(1)} ms`);
});

// ---- Hostile API use ---------------------------------------------------------------------------

test('hostile call sequences never throw and never break the simulation', () => {
  const rng = makeRng(0xbad);
  const junk = () => rng.pick([
    undefined, null, 0, 1, -1, 2.5, NaN, Infinity, '2', 'x', true, false, [], [1, 2], {}, { d: '2' }, { s: 1e300 }, { s: -1, d: 1, b: 1, x: 1 },
    { s: 5, d: 3, b: 'yes', x: {} }, { d: 4, b: 1, x: 1 }, { d: -3 }, Object.create(null), () => 1, Symbol('s'),
  ]);
  for (let round = 0; round < 12; round++) {
    const n = 2 + (round % 7);
    const w = new World({ seed: round + 1, fighters: Array.from({ length: n }, (_, i) => fighter(i)), roundTime: 60, blocks: 'many', items: 'many' });
    for (const p of w.players) { p.kick = true; p.glove = true; p.bombsMax = 4; }
    for (let t = 0; t < 6000 && w.state !== STATE.OVER; t++) {
      for (let k = 0; k < 6; k++) {
        const id = rng.pick([0, 1, 2, n - 1, 99, -1, '0', null, undefined, 1.5]);
        const c = rng.int(3) === 0 ? junk() : { s: t * 10 + k, d: rng.int(5), b: rng.int(9) === 0 ? 1 : 0, x: rng.int(9) === 0 ? 1 : 0 };
        assert.doesNotThrow(() => w.applyCmd(id, c));
      }
      if (rng.int(500) === 0) w.removeFighter(rng.pick([0, 1, 2, 77, null, undefined, 'a']));
      if (rng.int(20) === 0) {
        assert.doesNotThrow(() => w.snapshot(rng.pick([undefined, {}, { grid: true }, { evFrom: 'x' }, { evFrom: -5 }, { evFrom: 1e9 }, { grid: 'true', evFrom: NaN }])));
        assert.doesNotThrow(() => w.eventsSince(rng.pick([undefined, null, 'a', -1, 0, 5, 1e9, NaN])));
        assert.doesNotThrow(() => w.trimEvents(rng.pick([undefined, null, 'a', -1, 0, 5, 1e9, NaN])));
        assert.doesNotThrow(() => w.landTick(rng.pick([-1, 0, 7, 99, NaN, undefined]), rng.pick([-1, 0, 6, 99, NaN, undefined])));
        assert.doesNotThrow(() => w.player(rng.pick([0, 1, 99, null, undefined, 'x', {}])));
      }
      w.tick();
      for (const p of w.players) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN position in round ${round}`);
    }
    assert.ok(w.state === STATE.OVER || w.tickNo >= 6000);
    const before = w.tickNo;
    w.applyCmd(0, { s: 1, d: 1, b: 1, x: 1 });
    w.tick();
    if (w.state === STATE.OVER) assert.equal(w.tickNo, before);
  }
});

// ---- Added by the audit: gaps found by mutation testing ---------------------------------------------

test('a shield picked up after the outcome lock never lowers SHIELD_FOREVER', () => {
  const w = live(mk({ n: 2 }));
  put(w, 0, 3, 3);
  put(w, 1, 13, 11);
  w.player(1).alive = false;
  w.tick();
  assert.equal(w.state, STATE.ENDING);
  assert.equal(w.player(0).shield, C.SHIELD_FOREVER);
  drop(w, 'shield', 3, 3);
  w.tick();
  assert.equal(w.items.length, 0, 'the item is consumed');
  assert.equal(w.player(0).shield, C.SHIELD_FOREVER, 'and Math.max keeps the never-ending shield');
});

test('landing: the BFS from an invalid destination reaches tiles up to six steps away before it falls back to the origin', () => {
  const { w } = gloveWorld();
  const bomb = bombAt(w, 0, 3, 5);
  cmd(w, 0, 0, 0, 1);
  put(w, 0, 1, 1);
  const wall = (cx, cy, r) => {
    for (let ty = 1; ty <= 11; ty++) for (let tx = 1; tx <= 13; tx++) if (Math.abs(tx - cx) + Math.abs(ty - cy) <= r) w.grid[idx(tx, ty)] = 'X';
  };
  wall(6, 5, 3);                                       // the destination and everything within three steps of it
  wall(3, 5, 2);                                       // the origin's neighbourhood, so a fallback would land somewhere else entirely
  run(w, 26);
  assert.equal(bomb.fly, null);
  assert.equal(Math.abs(bomb.tx - 6) + Math.abs(bomb.ty - 5), 4, `landed on ${bomb.tx},${bomb.ty}, four steps from the destination`);
  assert.ok(Math.abs(bomb.tx - 3) + Math.abs(bomb.ty - 5) > 2, 'not near the origin');
});

test('the outcome lock ends a running spawn shield (the blinking stops, only SHIELD_FOREVER remains)', () => {
  const w = mk({ n: 2 });
  while (w.state === STATE.COUNTDOWN) w.tick();
  assert.equal(w.player(0).spawnShield, C.SPAWN_SHIELD_TICKS);
  w.player(1).alive = false;
  w.tick();
  assert.equal(w.state, STATE.ENDING);
  assert.equal(w.player(0).spawnShield, 0);
  assert.equal(w.player(0).shield, C.SHIELD_FOREVER);
});

// ---- Differential tests against literal transcriptions of the SPEC listings ----------------------------

/** SPEC 3.5, transcribed verbatim (with the per-call closures the production code inlines). */
function specMovePlayer(p, d, env) {
  if (d === 0) { p.moving = false; return { moved: false, blocked: false }; }
  const horiz = d === 2 || d === 4, sgn = (d === 2 || d === 3) ? 1 : -1;
  p.facing = d - 1;
  const step = effectiveSpeed(p) * DT;
  const a = horiz ? 'x' : 'y', q = horiz ? 'y' : 'x';
  const ap = p[a], pp = p[q];
  const lo = Math.floor(pp - HALF + EPS), hi = Math.floor(pp + HALF - EPS);
  const np = ap + sgn * step;
  const edgeTile = (e) => sgn > 0 ? Math.floor(e - EPS) : Math.floor(e + EPS);
  const tOld = edgeTile(ap + sgn * HALF), tNew = edgeTile(np + sgn * HALF);
  const solid = (t, lane) => horiz ? env.isSolid(t, lane, p) : env.isSolid(lane, t, p);
  let sLo = false, sHi = false;
  if (tNew !== tOld) { sLo = solid(tNew, lo); sHi = lo === hi ? sLo : solid(tNew, hi); }
  let r;
  if (!sLo && !sHi) { p[a] = np; r = { moved: true, blocked: false }; }
  else if (lo !== hi && sLo !== sHi && Math.floor(pp) === (sLo ? hi : lo)) {
    const delta = (sLo ? hi : lo) + 0.5 - pp;
    p[q] = pp + Math.sign(delta) * Math.min(step, Math.abs(delta));
    r = { moved: true, blocked: false };
  } else {
    p[a] = sgn > 0 ? tNew - HALF - EPS : tNew + 1 + HALF + EPS;
    r = { moved: false, blocked: true };
  }
  p.moving = r.moved;
  return r;
}

test('movePlayer is bit-identical to the SPEC 3.5 listing on 300 000 random states, including positions on the EPS boundaries', () => {
  const rng = makeRng(99);
  const curses = [null, 'slow', 'rush'];
  const nudges = [0, EPS, -EPS, 2 * EPS, 1e-9];
  for (let map = 0; map < 150; map++) {
    const grid = [];
    for (let i = 0; i < W * H; i++) {
      const tx = i % W;
      const ty = (i - tx) / W;
      grid.push(tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1 || rng.next() < 0.3 ? '#' : '.');
    }
    const env = makeEnv(grid, []);
    for (let k = 0; k < 2000; k++) {
      const base = { id: 0, x: 1 + rng.next() * 13, y: 1 + rng.next() * 11, facing: 0, moving: false, speedLv: rng.int(7), curse: curses[rng.int(3)] };
      if (rng.int(3) === 0) base.x = Math.round(base.x) + (rng.int(2) ? 1 : -1) * (HALF + nudges[rng.int(5)]);
      if (rng.int(3) === 0) base.y = Math.round(base.y) + (rng.int(2) ? 1 : -1) * (HALF + nudges[rng.int(5)]);
      if (rng.int(4) === 0) base.x = Math.floor(base.x) + 0.5;
      if (rng.int(4) === 0) base.y = Math.floor(base.y) + 0.5;
      const d = rng.int(5);
      const got = { ...base };
      const want = { ...base };
      const rGot = movePlayer(got, d, env);
      const rWant = specMovePlayer(want, d, env);
      assert.deepEqual(got, want, `state after ${JSON.stringify(base)} d=${d}`);
      assert.deepEqual({ ...rGot }, rWant);
    }
  }
});

/** SPEC 3.6a, transcribed literally: the flame maps, blocks and boom order of one resolution. */
function specResolve(w) {
  const nonFlying = w.bombs.filter((b) => !b.fly);
  const lingering = new Set(w.flames.map((f) => f.ty * W + f.tx));
  const queue = nonFlying.filter((b) => b.fuse <= 0 || lingering.has(b.ty * W + b.tx)).sort((a, b) => a.id - b.id);
  const boom = new Set(queue.map((b) => b.id));
  const blocks = new Set();
  const flames = new Map();
  const booms = [];
  const bit = [0, 1, 2, 4, 8];
  const back = [0, 4, 8, 1, 2];
  const addFlame = (x, y, owner, mask) => {
    let f = flames.get(y * W + x);
    if (!f) flames.set(y * W + x, f = { mask: 0, owners: [] });
    f.mask |= mask;
    if (!f.owners.includes(owner)) f.owners.push(owner);
  };
  for (let qi = 0; qi < queue.length; qi++) {
    const b = queue[qi];
    const tiles = [[b.tx, b.ty]];
    let centre = 0;
    for (let d = 1; d <= 4; d++) {
      const arm = [];
      for (let k = 1; k <= b.range; k++) {
        const x = b.tx + C.DIR_DX[d] * k;
        const y = b.ty + C.DIR_DY[d] * k;
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        const c = w.grid[y * W + x];
        if (c === '#' || c === 'X') break;
        arm.push([x, y]);
        tiles.push([x, y]);
        if (c === '+') { blocks.add(y * W + x); break; }
        const other = nonFlying.find((o) => o.tx === x && o.ty === y);
        if (other) {
          if (!boom.has(other.id)) { boom.add(other.id); queue.push(other); }
          break;
        }
      }
      if (arm.length) centre |= bit[d];
      arm.forEach(([x, y], i) => addFlame(x, y, b.owner, i < arm.length - 1 ? bit[d] | back[d] : back[d]));
    }
    addFlame(b.tx, b.ty, b.owner, centre);
    booms.push([b.id, b.owner, b.tx, b.ty, b.range, tiles]);
  }
  return { flames, blocks: [...blocks].sort((a, b) => a - b), booms };
}

test('the explosion resolver equals a literal transcription of SPEC 3.6a on 1500 random boards (chains, blocks, lingering flames, owners, masks)', () => {
  const rng = makeRng(5);
  for (let trial = 0; trial < 1500; trial++) {
    const w = live(mk({ n: 4, open: false, seed: trial, blocks: ['few', 'normal', 'many'][trial % 3], items: 'many', layout: trial % 2 ? 'open' : 'classic' }));
    const floor = [];
    for (let i = 0; i < W * H; i++) if (w.grid[i] !== '#') floor.push(i);
    for (let i = 0, n = 1 + rng.int(10); i < n; i++) {
      const at = floor[rng.int(floor.length)];
      const tx = at % W;
      const ty = (at - tx) / W;
      if (w.grid[at] !== '.' || w.bombs.some((b) => b.tx === tx && b.ty === ty)) continue;
      w.bombs.push({ id: w.bombs.length + 100 + i, owner: rng.int(5) - 1, x: tx + 0.5, y: ty + 0.5, tx, ty, range: 1 + rng.int(5), fuse: rng.int(3) === 0 ? 1 : 2 + rng.int(100), dir: 0, step: 0, pass: [], fly: null });
    }
    w.bombs.sort((a, b) => a.id - b.id);
    for (let i = 0, n = rng.int(4); i < n; i++) {                       // lingering flames from earlier ticks
      const at = floor[rng.int(floor.length)];
      if (w.grid[at] === '#' || w._flameGrid[at]) continue;
      const rec = { tx: at % W, ty: (at - (at % W)) / W, ticks: 5, mask: 0, owners: [3] };
      w._flameGrid[at] = rec;
      w.flames.push(rec);
    }
    w.flames.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
    for (const p of w.players) p.shield = C.SHIELD_FOREVER;
    const before = { items: w.items.map((it) => ({ ...it })), drops: w._drops.slice(), flames: new Map(w.flames.map((f) => [f.ty * W + f.tx, { mask: f.mask, owners: f.owners.slice() }])) };
    // the resolver runs after the fuse step of the same tick, so pre-decrement the fuses the way tick() will
    for (const b of w.bombs) b.fuse++;
    const ref = specResolve({ grid: w.grid, bombs: w.bombs.map((b) => ({ ...b, fuse: b.fuse - 1 })), flames: w.flames });
    const rec = record(w);
    rec.tick();
    const ctx = `trial ${trial}`;
    assert.deepEqual(rec.of('boom').map((e) => e.ev.slice(1)), ref.booms, `${ctx}: boom events`);
    assert.deepEqual(rec.of('block').map((e) => e.ev[2] * W + e.ev[1]), ref.blocks, `${ctx}: destroyed blocks`);
    for (const [at, f] of ref.flames) {
      const old = before.flames.get(at);
      const got = w.flames.find((r) => r.ty * W + r.tx === at);
      assert.ok(got, `${ctx}: flame at ${at}`);
      assert.equal(got.mask, f.mask | (old ? old.mask : 0), `${ctx}: mask at ${at}`);
      assert.deepEqual(got.owners, old ? [...old.owners, ...f.owners.filter((o) => !old.owners.includes(o))] : f.owners, `${ctx}: owners at ${at}`);
    }
    assert.equal(w.flames.length, new Set([...ref.flames.keys(), ...before.flames.keys()]).size, `${ctx}: no extra flames`);
    assert.deepEqual(rec.of('itemgone').map((e) => e.ev[1]), before.items.filter((it) => ref.flames.has(it.ty * W + it.tx)).map((it) => it.id), `${ctx}: items destroyed`);
    assert.equal(rec.of('itemspawn').length, ref.blocks.filter((at) => before.drops[at]).length, `${ctx}: prizes revealed`);
  }
});
