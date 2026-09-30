// Arena generation (docs/SPEC.md §3.1). A pure function of (layout, blocks, items, numFighters, rng state).
//
// Layout of the result: 15x13 row-major. '#' hard wall, '+' soft block, '.' floor.
// Soft blocks and their hidden prizes are rolled for the top-left quadrant only and mirrored
// four ways, so every corner and mid-edge spawn sees identical surroundings and identical prizes.
// `drops` is server-only: it must never be put on the wire (it would reveal what is under each block).

import {
  GRID_W, GRID_H, SPAWN_SLOTS, START_RANGE, BLOCK_DENSITY, DROP_CHANCE, ITEM_KINDS, ITEM_WEIGHTS,
} from './constants.js';

const W = GRID_W;
const H = GRID_H;
const CELLS = W * H;
const ITEM_WEIGHT_TOTAL = ITEM_KINDS.reduce((sum, kind) => sum + ITEM_WEIGHTS[kind], 0);
const ARMS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Interior hard-wall pillar of a layout (the border ring is handled separately). */
function isPillar(layout, tx, ty) {
  return layout === 'open' ? tx % 4 === 3 && ty % 4 === 2 : tx % 2 === 0 && ty % 2 === 0;
}

/** Cells within Manhattan distance 2 of ANY slot stay free of soft blocks, whatever the player count. */
function markSafeZones() {
  const safe = new Array(CELLS).fill(false);
  for (const [sx, sy] of SPAWN_SLOTS) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = sx + dx;
        const ty = sy + dy;
        if (Math.abs(dx) + Math.abs(dy) <= 2 && tx >= 0 && ty >= 0 && tx < W && ty < H) safe[ty * W + tx] = true;
      }
    }
  }
  return safe;
}
const SAFE_ZONE = markSafeZones();

/** One rng.next() picks the kind by cumulative weight, in ITEM_KINDS order. */
function weightedPick(rng) {
  let r = rng.next() * ITEM_WEIGHT_TOTAL;
  for (const kind of ITEM_KINDS) {
    r -= ITEM_WEIGHTS[kind];
    if (r < 0) return kind;
  }
  return ITEM_KINDS[ITEM_KINDS.length - 1];
}

/** The four mirror images of a tile index (not deduplicated: centre lines map onto themselves). */
function mirrors(tx, ty) {
  return [ty * W + tx, ty * W + (W - 1 - tx), (H - 1 - ty) * W + tx, (H - 1 - ty) * W + (W - 1 - tx)];
}

/** Flame set of a START_RANGE bomb: arms stop before '#', and stop inclusive at '+'. */
function firstBombFlames(cells, tx, ty) {
  const flames = new Set([ty * W + tx]);
  for (const [dx, dy] of ARMS) {
    for (let k = 1; k <= START_RANGE; k++) {
      const x = tx + dx * k;
      const y = ty + dy * k;
      const c = cells[y * W + x];
      if (c === '#') break;
      flames.add(y * W + x);
      if (c === '+') break;
    }
  }
  return flames;
}

/** Floor cells reachable from the slot without crossing a wall or a soft block. */
function reachableFloor(cells, tx, ty) {
  const seen = new Set([ty * W + tx]);
  const queue = [ty * W + tx];
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    const x = idx % W;
    const y = (idx - x) / W;
    for (const [dx, dy] of ARMS) {
      const n = (y + dy) * W + (x + dx);
      if (!seen.has(n) && cells[n] === '.') {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

/**
 * The most natural first move is dropping a bomb on your own spawn tile, so that must be survivable:
 * some floor cell reachable from the slot has to lie outside the bomb's flames. Otherwise open up the
 * first soft block (row-major) that touches the reachable area, preferring one outside the flames,
 * together with its three mirror images (which keeps the 4-fold symmetry).
 */
function guaranteeFirstBombEscape(cells, drops) {
  for (const [sx, sy] of SPAWN_SLOTS) {
    for (;;) {
      const flames = firstBombFlames(cells, sx, sy);
      const reach = reachableFloor(cells, sx, sy);
      let escapable = false;
      for (const idx of reach) if (!flames.has(idx)) { escapable = true; break; }
      if (escapable) break;

      let target = -1;
      let fallback = -1;
      for (let idx = 0; idx < CELLS && target < 0; idx++) {
        if (cells[idx] !== '+') continue;
        const x = idx % W;
        const y = (idx - x) / W;
        if (!ARMS.some(([dx, dy]) => reach.has((y + dy) * W + (x + dx)))) continue;
        if (fallback < 0) fallback = idx;
        if (!flames.has(idx)) target = idx;
      }
      if (target < 0) target = fallback;
      if (target < 0) break;          // sealed by hard walls only: nothing left to open (the layouts never get here)

      const tx = target % W;
      for (const m of mirrors(tx, (target - tx) / W)) {
        cells[m] = '.';
        drops[m] = null;
      }
    }
  }
}

/**
 * @param {{ layout: 'classic'|'open', blocks: 'few'|'normal'|'many', items: 'none'|'few'|'normal'|'many',
 *           numFighters: number, rng: ReturnType<import('./rng.js').makeRng> }} opts
 * @returns {{ grid: string, spawns: {tx:number,ty:number}[], drops: (string|null)[] }}
 */
export function generateMap({ layout, blocks, items, numFighters, rng }) {
  const cells = new Array(CELLS);
  const drops = new Array(CELLS).fill(null);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const border = tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1;
      cells[ty * W + tx] = border || isPillar(layout, tx, ty) ? '#' : '.';
    }
  }

  const density = BLOCK_DENSITY[blocks];
  const pDrop = Math.min(0.85, DROP_CHANCE[items] * Math.max(1, numFighters / 4));   // bigger rooms get more items
  // Normative draw order: top-left quadrant, row-major; one prize roll per planted block, shared by its 4 images.
  for (let ty = 1; ty <= 6; ty++) {
    for (let tx = 1; tx <= 7; tx++) {
      const idx = ty * W + tx;
      if (cells[idx] !== '.' || SAFE_ZONE[idx]) continue;
      if (!(rng.next() < density)) continue;
      const prize = rng.next() < pDrop ? weightedPick(rng) : null;
      for (const m of mirrors(tx, ty)) {
        cells[m] = '+';
        drops[m] = prize;
      }
    }
  }

  guaranteeFirstBombEscape(cells, drops);

  return {
    grid: cells.join(''),
    spawns: SPAWN_SLOTS.map(([tx, ty]) => ({ tx, ty })),
    drops,
  };
}
