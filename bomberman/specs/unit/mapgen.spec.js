import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../../shared/mapgen.js';
import { makeRng } from '../../shared/rng.js';
import {
  GRID_W as W, GRID_H as H, SPAWN_SLOTS, START_RANGE, BLOCK_DENSITY, DROP_CHANCE, ITEM_KINDS, ITEM_WEIGHTS,
} from '../../shared/constants.js';

const LAYOUTS = ['classic', 'open'];
const DENSITIES = ['few', 'normal', 'many'];
const ITEM_LEVELS = ['none', 'few', 'normal', 'many'];
const at = (grid, tx, ty) => grid[ty * W + tx];
const gen = (seed, layout = 'classic', blocks = 'normal', items = 'normal', numFighters = 4) =>
  generateMap({ layout, blocks, items, numFighters, rng: makeRng(seed) });

const isPillar = (layout, tx, ty) => (layout === 'classic' ? tx % 2 === 0 && ty % 2 === 0 : tx % 4 === 3 && ty % 4 === 2);
const nearSlot = (tx, ty) => SPAWN_SLOTS.some(([sx, sy]) => Math.abs(sx - tx) + Math.abs(sy - ty) <= 2);

/** Flood fill over every non-wall cell (soft blocks count as floor: hard walls must never partition the board). */
function floorIsConnected(grid) {
  const cells = [];
  for (let i = 0; i < W * H; i++) if (grid[i] !== '#') cells.push(i);
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop();
    for (const n of [c - 1, c + 1, c - W, c + W]) {
      if (grid[n] !== '#' && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen.size === cells.length;
}

/** Independent first-bomb check written straight from the spec text. */
function canEscapeFirstBomb(grid, [sx, sy]) {
  const flames = new Set([`${sx},${sy}`]);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    for (let k = 1; k <= START_RANGE; k++) {
      const c = at(grid, sx + dx * k, sy + dy * k);
      if (c === '#') break;
      flames.add(`${sx + dx * k},${sy + dy * k}`);
      if (c === '+') break;
    }
  }
  const seen = new Set([`${sx},${sy}`]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const key = `${x + dx},${y + dy}`;
      if (at(grid, x + dx, y + dy) === '.' && !seen.has(key)) { seen.add(key); queue.push([x + dx, y + dy]); }
    }
  }
  return [...seen].some((k) => !flames.has(k));
}

test('invariants hold over 500 seeds, both layouts, all block densities, several item levels', () => {
  for (let seed = 1; seed <= 500; seed++) {
    for (const layout of LAYOUTS) {
      for (const blocks of DENSITIES) {
        const items = ITEM_LEVELS[(seed + blocks.length) % ITEM_LEVELS.length];
        const numFighters = 2 + (seed % 7);
        const label = `seed ${seed} ${layout} ${blocks} ${items} n${numFighters}`;
        const { grid, spawns, drops } = gen(seed, layout, blocks, items, numFighters);

        assert.equal(typeof grid, 'string');
        assert.equal(grid.length, W * H, label);
        assert.equal(drops.length, W * H, label);
        assert.deepEqual(spawns, SPAWN_SLOTS.map(([tx, ty]) => ({ tx, ty })), label);

        let pillars = 0;
        for (let ty = 0; ty < H; ty++) {
          for (let tx = 0; tx < W; tx++) {
            const c = at(grid, tx, ty);
            const border = tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1;
            const wall = border || isPillar(layout, tx, ty);
            if (!border && isPillar(layout, tx, ty)) pillars++;
            assert.equal(c === '#', wall, `${label}: wall at ${tx},${ty}`);
            assert.ok('#.+'.includes(c), `${label}: char ${c}`);
            if (c === '+') assert.ok(!nearSlot(tx, ty), `${label}: soft block in a safe zone at ${tx},${ty}`);
            assert.equal(drops[ty * W + tx] === null || c === '+', true, `${label}: drop only under a soft block`);
            if (drops[ty * W + tx] !== null) assert.ok(ITEM_KINDS.includes(drops[ty * W + tx]));
          }
        }
        assert.equal(pillars, layout === 'classic' ? 30 : 9, label);
        for (const [tx, ty] of SPAWN_SLOTS) assert.equal(at(grid, tx, ty), '.', `${label}: spawn ${tx},${ty}`);
        if (items === 'none') assert.ok(drops.every((d) => d === null), label);

        for (let ty = 0; ty < H; ty++) {
          for (let tx = 0; tx < W; tx++) {
            const i = ty * W + tx;
            for (const j of [ty * W + (W - 1 - tx), (H - 1 - ty) * W + tx, (H - 1 - ty) * W + (W - 1 - tx)]) {
              assert.equal(grid[i], grid[j], `${label}: grid symmetry ${tx},${ty}`);
              assert.equal(drops[i], drops[j], `${label}: drop symmetry ${tx},${ty}`);
            }
          }
        }

        assert.ok(floorIsConnected(grid), `${label}: connected floor`);
        assert.ok(floorIsConnected(grid.replace(/\+/g, '.')), `${label}: connected without soft blocks`);
        SPAWN_SLOTS.forEach((slot, s) => assert.ok(canEscapeFirstBomb(grid, slot), `${label}: slot ${s} first-bomb escape`));
      }
    }
  }
});

test('non-wall cell counts: classic 113, open 134 (without soft blocks)', () => {
  const count = (layout) => gen(1, layout, 'few', 'none').grid.replace(/\+/g, '.').split('').filter((c) => c === '.').length;
  assert.equal(count('classic'), 113);
  assert.equal(count('open'), 134);
});

test('layouts match the spec pictures', () => {
  const rows = (layout) => {
    const g = gen(3, layout, 'few', 'none').grid.replace(/\+/g, '.');
    return Array.from({ length: H }, (_, y) => g.slice(y * W, y * W + W));
  };
  const classic = rows('classic');
  assert.equal(classic[0], '#'.repeat(15));
  assert.equal(classic[1], '#' + '.'.repeat(13) + '#');
  assert.equal(classic[2], '#.#.#.#.#.#.#.#');
  const open = rows('open');
  assert.equal(open[2], '#..#...#...#..#');
  assert.equal(open[6], '#..#...#...#..#');
  assert.equal(open[10], '#..#...#...#..#');
  assert.equal(open[3], '#' + '.'.repeat(13) + '#');
});

test('same inputs give the same map; a different seed gives a different one', () => {
  const a = gen(123, 'classic', 'many', 'many', 8);
  const b = gen(123, 'classic', 'many', 'many', 8);
  assert.deepEqual(a, b);
  assert.notEqual(gen(124, 'classic', 'many', 'many', 8).grid, a.grid);
});

test('density orders the number of soft blocks: few < normal < many', () => {
  const avg = (blocks) => {
    let n = 0;
    for (let s = 0; s < 100; s++) n += gen(s, 'classic', blocks, 'none').grid.split('+').length - 1;
    return n / 100;
  };
  const [few, normal, many] = DENSITIES.map(avg);
  assert.ok(few < normal && normal < many, `${few} < ${normal} < ${many}`);
  let plantable = 0;
  for (let ty = 1; ty < H - 1; ty++) for (let tx = 1; tx < W - 1; tx++) if (!isPillar('classic', tx, ty) && !nearSlot(tx, ty)) plantable++;
  assert.ok(many <= plantable, `${many} soft blocks fit into the ${plantable} cells outside the safe zones`);
});

test('bigger rooms hide more items: pDrop scales with the fighter count and is capped at 0.85', () => {
  const totalDrops = (items, n) => {
    let count = 0;
    for (let s = 0; s < 200; s++) count += gen(s, 'classic', 'normal', items, n).drops.filter(Boolean).length;
    return count / 200;
  };
  const four = totalDrops('normal', 4);
  const eight = totalDrops('normal', 8);
  const two = totalDrops('normal', 2);
  assert.ok(Math.abs(two - four) < 1.5, 'two to four fighters are unchanged');
  assert.ok(eight > four * 1.8 && eight < four * 2.2, `${eight} vs ${four}`);
  const many8 = gen(9, 'classic', 'many', 'many', 8);
  const blocks = many8.grid.split('+').length - 1;
  assert.ok(many8.drops.filter(Boolean).length <= blocks);
});

test('prize kinds follow the item weights', () => {
  const counts = Object.fromEntries(ITEM_KINDS.map((k) => [k, 0]));
  for (let s = 0; s < 300; s++) for (const d of gen(s, 'classic', 'many', 'many', 8).drops) if (d) counts[d]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const weightSum = Object.values(ITEM_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const kind of ITEM_KINDS) {
    const share = counts[kind] / total;
    const want = ITEM_WEIGHTS[kind] / weightSum;
    assert.ok(Math.abs(share - want) < 0.02, `${kind}: ${share.toFixed(3)} vs ${want.toFixed(3)}`);
  }
});

// ---- An independent reference implementation of SPEC 3.1, compared cell for cell -------------------

function referenceMap({ layout, blocks, items, numFighters, rng }) {
  const g = Array.from({ length: H }, (_, ty) => Array.from({ length: W }, (_, tx) =>
    (tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1 || isPillar(layout, tx, ty)) ? '#' : '.'));
  const dr = Array.from({ length: H }, () => Array(W).fill(null));
  const pDrop = Math.min(0.85, DROP_CHANCE[items] * Math.max(1, numFighters / 4));
  const total = ITEM_KINDS.reduce((s, k) => s + ITEM_WEIGHTS[k], 0);
  for (let ty = 1; ty <= 6; ty++) {
    for (let tx = 1; tx <= 7; tx++) {
      if (g[ty][tx] !== '.' || nearSlot(tx, ty)) continue;
      if (rng.next() < BLOCK_DENSITY[blocks]) {
        let kind = null;
        if (rng.next() < pDrop) {
          const r = rng.next() * total;
          let acc = 0;
          for (const k of ITEM_KINDS) { acc += ITEM_WEIGHTS[k]; if (r < acc) { kind = k; break; } }
        }
        for (const [x, y] of [[tx, ty], [14 - tx, ty], [tx, 12 - ty], [14 - tx, 12 - ty]]) { g[y][x] = '+'; dr[y][x] = kind; }
      }
    }
  }
  const flat = () => g.map((r) => r.join('')).join('');
  for (const slot of SPAWN_SLOTS) {
    for (let guard = 0; guard < 100 && !canEscapeFirstBomb(flat(), slot); guard++) {
      const [sx, sy] = slot;
      const flames = new Set([`${sx},${sy}`]);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        for (let k = 1; k <= START_RANGE; k++) {
          const c = g[sy + dy * k][sx + dx * k];
          if (c === '#') break;
          flames.add(`${sx + dx * k},${sy + dy * k}`);
          if (c === '+') break;
        }
      }
      const reach = new Set([`${sx},${sy}`]);
      const queue = [[sx, sy]];
      while (queue.length) {
        const [x, y] = queue.shift();
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          if (g[y + dy][x + dx] === '.' && !reach.has(`${x + dx},${y + dy}`)) { reach.add(`${x + dx},${y + dy}`); queue.push([x + dx, y + dy]); }
        }
      }
      const candidates = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (g[y][x] === '+' && [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => reach.has(`${x + dx},${y + dy}`))) candidates.push([x, y]);
        }
      }
      const pick = candidates.find(([x, y]) => !flames.has(`${x},${y}`)) ?? candidates[0];
      const [px, py] = pick;
      for (const [x, y] of [[px, py], [14 - px, py], [px, 12 - py], [14 - px, 12 - py]]) { g[y][x] = '.'; dr[y][x] = null; }
    }
  }
  return { grid: flat(), drops: dr.flat() };
}

test('output equals an independent reference implementation of the normative draw order', () => {
  for (let seed = 1; seed <= 150; seed++) {
    for (const layout of LAYOUTS) {
      for (const blocks of DENSITIES) {
        const items = ITEM_LEVELS[seed % 4];
        const n = 2 + (seed % 7);
        const got = gen(seed, layout, blocks, items, n);
        const want = referenceMap({ layout, blocks, items, numFighters: n, rng: makeRng(seed) });
        assert.equal(got.grid, want.grid, `seed ${seed} ${layout} ${blocks}`);
        assert.deepEqual(got.drops, want.drops, `seed ${seed} ${layout} ${blocks}`);
      }
    }
  }
});

test('the post-pass only ever removes blocks: it never plants or adds prizes', () => {
  // With the escape pass a slot that would be sealed gets opened; check that at least some seeds needed it.
  let opened = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rng = makeRng(seed);
    const { grid } = generateMap({ layout: 'classic', blocks: 'many', items: 'normal', numFighters: 4, rng });
    const raw = referenceMapWithoutPostPass(seed);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== raw[i]) { assert.equal(raw[i], '+'); assert.equal(grid[i], '.'); opened++; }
    }
  }
  assert.ok(opened > 0, 'the escape pass is exercised by the sample');
});

function referenceMapWithoutPostPass(seed) {
  const rng = makeRng(seed);
  const cells = Array.from({ length: W * H }, (_, i) => {
    const tx = i % W;
    const ty = (i - tx) / W;
    return (tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1 || isPillar('classic', tx, ty)) ? '#' : '.';
  });
  for (let ty = 1; ty <= 6; ty++) {
    for (let tx = 1; tx <= 7; tx++) {
      if (cells[ty * W + tx] !== '.' || nearSlot(tx, ty)) continue;
      if (rng.next() < BLOCK_DENSITY.many) {
        if (rng.next() < Math.min(0.85, DROP_CHANCE.normal)) rng.next();
        for (const [x, y] of [[tx, ty], [14 - tx, ty], [tx, 12 - ty], [14 - tx, 12 - ty]]) cells[y * W + x] = '+';
      }
    }
  }
  return cells;
}

test('the rng stream is consumed only by the quadrant loop (a later draw is unaffected by the post-pass)', () => {
  const a = makeRng(77);
  generateMap({ layout: 'classic', blocks: 'many', items: 'many', numFighters: 8, rng: a });
  const b = makeRng(77);
  referenceMap({ layout: 'classic', blocks: 'many', items: 'many', numFighters: 8, rng: b });
  assert.equal(a.next(), b.next());
});
