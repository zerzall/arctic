// Zombie navigation: a grid flow field toward every target at once (multi-source
// Dijkstra), rebuilt a few times per second by the simulation.
//
// Walkability is stored per *edge* rather than per cell: two neighbouring cells are
// connected when the straight segment between their centres clears every collider
// (grown by `pad`). That lets a thin guard rail cut the grid exactly where it runs,
// while a gap narrower than a cell still stays open if a centre line passes through
// it. Cells that hug a wall get a soft extra cost so crowds flow down the middle of
// lanes, and barricade cells cost BARRICADE_COST so zombies path around them when a
// reasonable detour exists but smash straight through when not.

import { NAV_CELL } from './constants.js';
import {
  StaticIndex, makeObb, pointInObb, mapColliders, MASK_MOVE,
} from './geom.js';
import { BARRICADE } from './constants.js';

/** Extra cost multiplier on cells covered by a barricade. */
export const BARRICADE_COST = 8;
const WALL_COST = 1.6;
const SQRT2 = Math.SQRT2;
const UNREACHED = 1e30;

// Neighbour order: E, SE, S, SW, W, NW, N, NE. Opposite of k is (k + 4) & 7.
const NDX = [1, 1, 0, -1, -1, -1, 0, 1];
const NDY = [0, 1, 1, 1, 0, -1, -1, -1];
const NLEN = [1, SQRT2, 1, SQRT2, 1, SQRT2, 1, SQRT2];
const UX = NDX.map((v, k) => v / NLEN[k]);
const UY = NDY.map((v, k) => v / NLEN[k]);

// Bucket width (px of path cost) and bucket count of the circular bucket queue. Every
// edge costs at least one cell (32 px) and at most sqrt(2) * cell * WALL_COST *
// BARRICADE_COST, which must stay below NB * BW so pushes never wrap onto the bucket
// being drained.
const BW = 4;
const NB = 1024;

/**
 * Dial-style monotone bucket queue. Keys inside one bucket differ by < BW px and every
 * edge is longer than BW, so nodes pop in exact order of their bucket and relaxations
 * never land in the bucket being drained. Stale duplicates are skipped by the caller.
 */
class BucketQueue {
  constructor(capacity) {
    this.head = new Int32Array(NB).fill(-1);
    this.cellOf = new Int32Array(capacity);
    this.keyOf = new Float64Array(capacity);
    this.next = new Int32Array(capacity);
    this.used = 0;
    this.pending = 0;
    this.cur = 0;
  }

  reset() {
    this.head.fill(-1);
    this.used = 0;
    this.pending = 0;
    this.cur = 0;
  }

  push(key, cell) {
    if (this.used >= this.cellOf.length) this._grow();
    const e = this.used++;
    const b = Math.floor(key / BW) & (NB - 1);
    this.cellOf[e] = cell;
    this.keyOf[e] = key;
    this.next[e] = this.head[b];
    this.head[b] = e;
    this.pending++;
  }

  /** Pops an entry index (use cellOf/keyOf), or -1 when empty. */
  pop() {
    if (this.pending === 0) return -1;
    for (;;) {
      const b = this.cur & (NB - 1);
      const e = this.head[b];
      if (e >= 0) {
        this.head[b] = this.next[e];
        this.pending--;
        return e;
      }
      this.cur++;
    }
  }

  _grow() {
    const n = this.cellOf.length * 2;
    const c = new Int32Array(n); c.set(this.cellOf); this.cellOf = c;
    const k = new Float64Array(n); k.set(this.keyOf); this.keyOf = k;
    const x = new Int32Array(n); x.set(this.next); this.next = x;
  }
}

/** Grid flow field toward a set of targets; see the file comment. */
export class FlowField {
  /**
   * @param {object} map MapDef
   * @param {object} [opts]
   *   cell     grid size in px (NAV_CELL)
   *   pad      colliders grow by this much for edge tests (bigger = only wide gaps count)
   *   inflate  cells whose centre is within this of a wall get the soft wall cost
   *   colliders optional prebuilt collider list (from geom.mapColliders)
   *   mask     which colliders block (MASK_MOVE; heavies use movement's MASK_HEAVY)
   */
  constructor(map, { cell = NAV_CELL, pad = 3, inflate = 12, colliders = null, mask = MASK_MOVE } = {}) {
    this.cell = cell;
    this.pad = pad;
    this.mask = mask;
    this.width = map.width;
    this.height = map.height;
    this.cols = Math.ceil(map.width / cell);
    this.rows = Math.ceil(map.height / cell);
    const n = this.cols * this.rows;
    this.n = n;
    const cols = this.cols;
    this.offs = NDX.map((dx, k) => dx + NDY[k] * cols);
    this._step = new Float64Array(NLEN.map((l) => l * cell));
    const obbs = colliders || mapColliders(map);
    this.index = new StaticIndex(obbs, map.width, map.height, { cellSize: 128, margin: Math.max(24, pad + inflate + 2) });

    /** 1 where the cell centre lies inside a collider. */
    this.blocked = new Uint8Array(n);
    /** Bit k set when the edge to neighbour k is walkable. */
    this.edges = new Uint8Array(n);
    this.baseCost = new Float64Array(n);
    this.cost = new Float64Array(n);
    this.dist = new Float64Array(n);
    /** Direction index toward the next cell on the path; 8 = seed (use seedX/seedY), 255 = none. */
    this.dirK = new Uint8Array(n);
    this.seedX = new Float32Array(n);
    this.seedY = new Float32Array(n);
    /** For blocked cells: the nearest open cell (-1 if none). */
    this.escape = new Int32Array(n);
    /** After update(): for every cell, the nearest cell that can reach a target (-1 if none). */
    this.reach = new Int32Array(n).fill(-1);
    this._queue = new Int32Array(n);
    /** True once update() found any cell with a path. */
    this.hasPath = false;
    this.queue = new BucketQueue(n * 2 + 64);
    this.version = 0;
    this._buildStatic(inflate);
    this.cost.set(this.baseCost);
    this.dist.fill(UNREACHED);
    this.dirK.fill(255);
  }

  _buildStatic(inflate) {
    const { cols, rows, cell, pad, mask } = this;
    const idx = this.index;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx;
        const x = (cx + 0.5) * cell, y = (cy + 0.5) * cell;
        const outside = x > this.width || y > this.height;
        this.blocked[c] = outside || idx.pointBlocked(x, y, mask, pad) ? 1 : 0;
        this.baseCost[c] = !this.blocked[c] && idx.pointBlocked(x, y, mask, pad + inflate) ? WALL_COST : 1;
      }
    }
    // Edges: test E, SE, S, SW from every open cell and mirror them.
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx;
        if (this.blocked[c]) continue;
        const x = (cx + 0.5) * cell, y = (cy + 0.5) * cell;
        for (let k = 0; k < 4; k++) {
          const nx = cx + NDX[k], ny = cy + NDY[k];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nc = ny * cols + nx;
          if (this.blocked[nc]) continue;
          // Diagonals must not clip a corner: both orthogonal cells must be open too.
          if (k & 1) {
            if (this.blocked[cy * cols + nx] || this.blocked[ny * cols + cx]) continue;
          }
          if (!idx.segmentClear(x, y, (nx + 0.5) * cell, (ny + 0.5) * cell, mask, pad)) continue;
          this.edges[c] |= 1 << k;
          this.edges[nc] |= 1 << ((k + 4) & 7);
        }
      }
    }
    // Isolated open cells (no edges) behave like blocked ones for escaping.
    // Escape map: multi-source BFS from connected open cells into everything else.
    const esc = this.escape;
    esc.fill(-1);
    const queue = new Int32Array(this.n);
    let head = 0, tail = 0;
    for (let c = 0; c < this.n; c++) {
      if (!this.blocked[c] && this.edges[c]) {
        esc[c] = c;
        queue[tail++] = c;
      }
    }
    while (head < tail) {
      const c = queue[head++];
      const cx = c % cols, cy = (c - cx) / cols;
      for (let k = 0; k < 8; k += 2) {
        const nx = cx + NDX[k], ny = cy + NDY[k];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nc = ny * cols + nx;
        if (esc[nc] >= 0) continue;
        esc[nc] = esc[c];
        queue[tail++] = nc;
      }
    }
  }

  /**
   * Mark barricade cells as expensive. list: [{x, y, a}] (BARRICADE size).
   */
  setBarricades(list) {
    this.cost.set(this.baseCost);
    if (!list) return;
    const { cols, rows, cell } = this;
    for (const b of list) {
      const a = b.a !== undefined ? b.a : (b.angle || 0);
      const ob = makeObb(b.x, b.y, BARRICADE.width, BARRICADE.height, a);
      const pad = cell * 0.5;
      const x0 = Math.max(0, Math.floor((ob.minX - pad) / cell)), x1 = Math.min(cols - 1, Math.floor((ob.maxX + pad) / cell));
      const y0 = Math.max(0, Math.floor((ob.minY - pad) / cell)), y1 = Math.min(rows - 1, Math.floor((ob.maxY + pad) / cell));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (pointInObb(ob, (cx + 0.5) * cell, (cy + 0.5) * cell, cell * 0.45)) {
            const c = cy * cols + cx;
            this.cost[c] = this.baseCost[c] * BARRICADE_COST;
          }
        }
      }
    }
  }

  /** Nearest connected open cell for a world position (-1 if the map has none). */
  cellAt(x, y) {
    let cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * Recompute the field toward every target.
   * @param {object[]} targets points { x, y } and/or rectangles { x, y, w, h, a }
   *   (e.g. the objective: every open cell next to it becomes a goal). An optional
   *   `bias` (px) makes a target look that much farther away, so zombies prefer
   *   other targets unless this one is clearly closer.
   * @param {number} [count] use only targets[0..count)
   */
  update(targets, count = targets.length) {
    const { cols, rows, cell, dist, dirK, seedX, seedY, cost, edges, offs } = this;
    dist.fill(UNREACHED);
    dirK.fill(255);
    const queue = this.queue;
    queue.reset();
    let bias = 0;
    const seed = (c, tx, ty) => {
      if (c < 0) return;
      const cx = c % cols, cy = (c - cx) / cols;
      const d = Math.hypot((cx + 0.5) * cell - tx, (cy + 0.5) * cell - ty) + bias;
      if (d < dist[c]) {
        dist[c] = d;
        dirK[c] = 8;
        seedX[c] = tx;
        seedY[c] = ty;
        queue.push(d, c);
      }
    };
    for (let i = 0; i < count; i++) {
      const t = targets[i];
      bias = t.bias > 0 ? t.bias : 0;
      if (t.w > 0 && t.h > 0) {
        // Seed the ring of open cells hugging the rectangle.
        const ob = makeObb(t.x, t.y, t.w, t.h, t.a || 0);
        const reach = cell * 1.5;
        const x0 = Math.max(0, Math.floor((ob.minX - reach) / cell)), x1 = Math.min(cols - 1, Math.floor((ob.maxX + reach) / cell));
        const y0 = Math.max(0, Math.floor((ob.minY - reach) / cell)), y1 = Math.min(rows - 1, Math.floor((ob.maxY + reach) / cell));
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            const c = cy * cols + cx;
            if (this.blocked[c] || !edges[c]) continue;
            const x = (cx + 0.5) * cell, y = (cy + 0.5) * cell;
            if (!pointInObb(ob, x, y, reach)) continue;
            // Aim at the nearest point of the rectangle so the seed direction is inward.
            const dx = x - ob.x, dy = y - ob.y;
            let lx = dx * ob.c + dy * ob.s, ly = -dx * ob.s + dy * ob.c;
            lx = Math.max(-ob.hw, Math.min(ob.hw, lx));
            ly = Math.max(-ob.hh, Math.min(ob.hh, ly));
            seed(c, ob.x + lx * ob.c - ly * ob.s, ob.y + lx * ob.s + ly * ob.c);
          }
        }
      } else {
        const c = this.cellAt(t.x, t.y);
        seed(this.blocked[c] || !edges[c] ? this.escape[c] : c, t.x, t.y);
      }
    }
    const step = this._step;
    const cellOf = queue.cellOf, keyOf = queue.keyOf;
    for (;;) {
      const ent = queue.pop();
      if (ent < 0) break;
      const c = cellOf[ent];
      const d = keyOf[ent];
      if (d > dist[c]) continue;
      const e = edges[c];
      if (!e) continue;
      for (let k = 0; k < 8; k++) {
        if (!(e & (1 << k))) continue;
        const nc = c + offs[k];
        const nd = d + step[k] * cost[nc];
        if (nd < dist[nc]) {
          dist[nc] = nd;
          dirK[nc] = (k + 4) & 7;
          queue.push(nd, nc);
        }
      }
    }
    this._buildReach();
    this.version++;
  }

  /**
   * Multi-source BFS from every reached cell, so a point in a blocked cell, a pocket
   * that is too tight for this field's body size, or any other unreached spot knows
   * the nearest cell that does lead somewhere.
   */
  _buildReach() {
    const { cols, rows, dist } = this;
    const reach = this.reach, queue = this._queue;
    reach.fill(-1);
    let head = 0, tail = 0;
    for (let c = 0; c < this.n; c++) {
      if (dist[c] < UNREACHED) {
        reach[c] = c;
        queue[tail++] = c;
      }
    }
    this.hasPath = tail > 0;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % cols, cy = (c - cx) / cols;
      const r = reach[c];
      if (cx > 0 && reach[c - 1] < 0) { reach[c - 1] = r; queue[tail++] = c - 1; }
      if (cx < cols - 1 && reach[c + 1] < 0) { reach[c + 1] = r; queue[tail++] = c + 1; }
      if (cy > 0 && reach[c - cols] < 0) { reach[c - cols] = r; queue[tail++] = c - cols; }
      if (cy < rows - 1 && reach[c + cols] < 0) { reach[c + cols] = r; queue[tail++] = c + cols; }
    }
  }

  /**
   * Walking direction at a world position, written to out { x, y } as a unit vector
   * (zero when the position cannot reach any target). Blends the directions of the
   * cells around the point that are directly connected to its own cell, which smooths
   * the 8-way grid into natural curves without leaking across thin walls.
   * @returns {boolean} true if a path exists
   */
  sample(x, y, out) {
    const { cols, rows, cell, dist, dirK, edges } = this;
    const c = this.cellAt(x, y);
    let fx = 0, fy = 0;
    if (dist[c] >= UNREACHED) {
      // Blocked or cut off: make for the nearest cell that leads somewhere.
      const o = this.reach[c];
      if (o < 0) {
        out.x = 0;
        out.y = 0;
        return false;
      }
      // Head for the open cell first, then along its flow.
      const ocx = o % cols, ocy = (o - ocx) / cols;
      const tx = (ocx + 0.5) * cell - x, ty = (ocy + 0.5) * cell - y;
      const tl = Math.hypot(tx, ty) || 1;
      this._cellDir(o, x, y);
      fx = tx / tl + this._dx * 0.5;
      fy = ty / tl + this._dy * 0.5;
      const l = Math.hypot(fx, fy) || 1;
      out.x = fx / l;
      out.y = fy / l;
      return true;
    }
    // Bilinear weights over the 2x2 block of cell centres around (x, y).
    const gx = x / cell - 0.5, gy = y / cell - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0;
    const ccx = c % cols, ccy = (c - ccx) / cols;
    for (let j = 0; j < 2; j++) {
      const yy = y0 + j;
      if (yy < 0 || yy >= rows) continue;
      const wy = j ? ty : 1 - ty;
      for (let i = 0; i < 2; i++) {
        const xx = x0 + i;
        if (xx < 0 || xx >= cols) continue;
        const w = (i ? tx : 1 - tx) * wy;
        if (w <= 0) continue;
        const nc = yy * cols + xx;
        if (nc !== c) {
          // Only blend cells reachable in one step from our own cell.
          const ddx = xx - ccx, ddy = yy - ccy;
          const k = dirIndex(ddx, ddy);
          if (k < 0 || !(edges[c] & (1 << k))) continue;
        }
        if (dist[nc] >= UNREACHED) continue;
        this._cellDir(nc, x, y);
        fx += this._dx * w;
        fy += this._dy * w;
      }
    }
    const l = Math.hypot(fx, fy);
    if (l < 1e-6) {
      this._cellDir(c, x, y);
      out.x = this._dx;
      out.y = this._dy;
      return true;
    }
    out.x = fx / l;
    out.y = fy / l;
    return true;
  }

  _cellDir(c, x, y) {
    const k = this.dirK[c];
    if (k < 8) {
      this._dx = UX[k];
      this._dy = UY[k];
    } else if (k === 8) {
      const dx = this.seedX[c] - x, dy = this.seedY[c] - y;
      const l = Math.hypot(dx, dy);
      if (l > 1e-6) {
        this._dx = dx / l;
        this._dy = dy / l;
      } else {
        this._dx = 0;
        this._dy = 0;
      }
    } else {
      this._dx = 0;
      this._dy = 0;
    }
  }

  /**
   * Path distance (px, cost-weighted) from a world position to the nearest target;
   * from an unreached spot, the straight hop to the nearest reached cell plus its path.
   */
  distanceAt(x, y) {
    const c = this.cellAt(x, y);
    if (this.dist[c] < UNREACHED) return this.dist[c];
    const o = this.reach[c];
    if (o < 0) return Infinity;
    const ox = o % this.cols, oy = (o - ox) / this.cols;
    return this.dist[o] + Math.hypot((ox + 0.5) * this.cell - x, (oy + 0.5) * this.cell - y);
  }

  /** True if the cell containing (x, y) is walkable and connected. */
  isOpen(x, y) {
    const c = this.cellAt(x, y);
    return !this.blocked[c] && this.edges[c] !== 0;
  }

  /** True if the cell at (x, y) itself has a path to some target. */
  reachable(x, y) {
    return this.dist[this.cellAt(x, y)] < UNREACHED;
  }
}

function dirIndex(dx, dy) {
  for (let k = 0; k < 8; k++) if (NDX[k] === dx && NDY[k] === dy) return k;
  return -1;
}

/**
 * Convenience factory. @see FlowField
 */
export function createFlowField(map, opts) {
  return new FlowField(map, opts);
}
