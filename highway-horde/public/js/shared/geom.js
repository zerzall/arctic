// Oriented-rectangle geometry and a static broadphase for the map's colliders.
// Used by movement (circle push-out), the flow field (rasterisation), and the
// simulation (hitscan, line of sight, projectiles, explosions).
//
// Every oriented box ("OBB") is a plain object built by makeObb(): centre (x, y),
// half extents (hw, hh), angle a with its cosine/sine cached, an axis-aligned
// bounding box, a `mask` of MASK_* bits describing what it blocks, and `top`: the height
// feet must reach to pass over it (Infinity = can't be jumped or climbed). Map colliders
// also carry `topQ` (top in whole jump.js Z_UNITs; `top` = topQ × Z_UNIT exactly), `stand`
// (true when it can be stood on) and `ci` (their index in the collider list).

import { jumpClearance, standTop, toZq, Z_UNIT } from './jump.js';
import { terrainOf } from './terrain.js';

/** Blocks bullets, beams, projectiles and line of sight. */
export const MASK_SOLID = 1;
/** Blocks walking (players and zombies). */
export const MASK_MOVE = 2;
/** Water area (walk-blocking, shots pass over it). */
export const MASK_WATER = 4;
/** The defended objective. */
export const MASK_OBJECTIVE = 8;
/** A player-built barricade. */
export const MASK_BARRICADE = 16;
/**
 * Too big for heavies (bloater, brute, boss) to crash through: everything except
 * crushable low cover (see isCrushable). Separate from MASK_SOLID because a sedan
 * blocks a brute but, seen from eye level, not a bullet fired over its bonnet.
 */
export const MASK_BULKY = 32;

/** Low cover that heavies trample: jersey barriers, sandbags, guard rails, fences. */
export function isCrushable(o) {
  return o.kind === 'barrier' || o.kind === 'sandbags' || o.kind === 'guardrail'
    || (o.kind === 'wall' && !o.solid);
}

const EPS = 1e-9;

/**
 * Build an oriented box.
 * @param {number} x centre x
 * @param {number} y centre y
 * @param {number} w full width (along the box's local x axis)
 * @param {number} h full height
 * @param {number} a angle in radians
 * @param {number} [mask] MASK_* bits
 * @param {*} [ref] back-reference to the source object (obstacle, barricade, ...)
 */
export function makeObb(x, y, w, h, a = 0, mask = 0, ref = null) {
  const ob = {
    x, y, hw: w / 2, hh: h / 2, a, c: 1, s: 0, mask, ref,
    minX: 0, minY: 0, maxX: 0, maxY: 0, top: Infinity, topQ: Infinity, baseQ: 0, stand: false, ci: -1,
  };
  setObbPose(ob, x, y, a);
  return ob;
}

/** Move/rotate an existing box in place (keeps its size), refreshing cached values. */
export function setObbPose(ob, x, y, a) {
  ob.x = x;
  ob.y = y;
  ob.a = a;
  ob.c = Math.cos(a);
  ob.s = Math.sin(a);
  const ex = Math.abs(ob.c) * ob.hw + Math.abs(ob.s) * ob.hh;
  const ey = Math.abs(ob.s) * ob.hw + Math.abs(ob.c) * ob.hh;
  ob.minX = x - ex;
  ob.maxX = x + ex;
  ob.minY = y - ey;
  ob.maxY = y + ey;
  return ob;
}

/** True if (px, py) lies inside the box grown by `pad` on every side. */
export function pointInObb(ob, px, py, pad = 0) {
  const dx = px - ob.x, dy = py - ob.y;
  const lx = dx * ob.c + dy * ob.s;
  const ly = -dx * ob.s + dy * ob.c;
  return lx >= -ob.hw - pad && lx <= ob.hw + pad && ly >= -ob.hh - pad && ly <= ob.hh + pad;
}

/** Distance from a point to the box's surface (0 when inside). */
export function distToObb(ob, px, py) {
  const dx = px - ob.x, dy = py - ob.y;
  const lx = dx * ob.c + dy * ob.s;
  const ly = -dx * ob.s + dy * ob.c;
  const ex = Math.max(Math.abs(lx) - ob.hw, 0);
  const ey = Math.max(Math.abs(ly) - ob.hh, 0);
  return Math.hypot(ex, ey);
}

/**
 * Closest point on (or inside) the box to (px, py), written to out {x, y}.
 * @returns {object} out
 */
export function closestPointOnObb(ob, px, py, out) {
  const dx = px - ob.x, dy = py - ob.y;
  let lx = dx * ob.c + dy * ob.s;
  let ly = -dx * ob.s + dy * ob.c;
  lx = lx < -ob.hw ? -ob.hw : lx > ob.hw ? ob.hw : lx;
  ly = ly < -ob.hh ? -ob.hh : ly > ob.hh ? ob.hh : ly;
  out.x = ob.x + lx * ob.c - ly * ob.s;
  out.y = ob.y + lx * ob.s + ly * ob.c;
  return out;
}

/**
 * Circle vs box overlap. When they overlap, writes the minimum push-out for the
 * circle into out { nx, ny, depth } (unit normal pointing away from the box) and
 * returns true.
 */
export function circleObbPush(ob, cx, cy, r, out) {
  if (cx + r < ob.minX || cx - r > ob.maxX || cy + r < ob.minY || cy - r > ob.maxY) return false;
  const dx = cx - ob.x, dy = cy - ob.y;
  const lx = dx * ob.c + dy * ob.s;
  const ly = -dx * ob.s + dy * ob.c;
  const hw = ob.hw, hh = ob.hh;
  const qx = lx < -hw ? -hw : lx > hw ? hw : lx;
  const qy = ly < -hh ? -hh : ly > hh ? hh : ly;
  let nlx, nly, depth;
  if (qx === lx && qy === ly) {
    // Centre inside the box: leave through the nearest face.
    const px = hw - Math.abs(lx);
    const py = hh - Math.abs(ly);
    if (px < py) {
      nlx = lx >= 0 ? 1 : -1;
      nly = 0;
      depth = px + r;
    } else {
      nlx = 0;
      nly = ly >= 0 ? 1 : -1;
      depth = py + r;
    }
  } else {
    const ex = lx - qx, ey = ly - qy;
    const d2 = ex * ex + ey * ey;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    nlx = ex / d;
    nly = ey / d;
    depth = r - d;
  }
  out.nx = nlx * ob.c - nly * ob.s;
  out.ny = nlx * ob.s + nly * ob.c;
  out.depth = depth;
  return true;
}

/** True if a circle overlaps the box. */
export function circleOverlapsObb(ob, cx, cy, r) {
  if (cx + r < ob.minX || cx - r > ob.maxX || cy + r < ob.minY || cy - r > ob.maxY) return false;
  const dx = cx - ob.x, dy = cy - ob.y;
  const lx = dx * ob.c + dy * ob.s;
  const ly = -dx * ob.s + dy * ob.c;
  const ex = Math.max(Math.abs(lx) - ob.hw, 0);
  const ey = Math.max(Math.abs(ly) - ob.hh, 0);
  return ex * ex + ey * ey < r * r;
}

/**
 * Ray vs box (slab test in the box's local frame). (dx, dy) must be a unit vector.
 * @param {number} pad grows the box on every side (swept-circle approximation)
 * @param {object} [out] receives the entry normal { nx, ny } on a hit from outside
 * @returns {number} distance along the ray to the entry point (0 if the origin is
 *   inside), or -1 when the ray misses within maxT.
 */
export function rayObb(ob, ox, oy, dx, dy, maxT, pad = 0, out = null) {
  const rx = ox - ob.x, ry = oy - ob.y;
  const lx = rx * ob.c + ry * ob.s;
  const ly = -rx * ob.s + ry * ob.c;
  const ldx = dx * ob.c + dy * ob.s;
  const ldy = -dx * ob.s + dy * ob.c;
  const hw = ob.hw + pad, hh = ob.hh + pad;
  let tmin = -Infinity, tmax = Infinity;
  let nlx = 0, nly = 0;
  if (Math.abs(ldx) < EPS) {
    if (lx < -hw || lx > hw) return -1;
  } else {
    const inv = 1 / ldx;
    let t1 = (-hw - lx) * inv, t2 = (hw - lx) * inv;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nlx = n; nly = 0; }
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(ldy) < EPS) {
    if (ly < -hh || ly > hh) return -1;
  } else {
    const inv = 1 / ldy;
    let t1 = (-hh - ly) * inv, t2 = (hh - ly) * inv;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nlx = 0; nly = n; }
    if (t2 < tmax) tmax = t2;
  }
  if (tmax < 0 || tmin > tmax || tmin > maxT) return -1;
  if (tmin < 0) {
    if (out) { out.nx = -dx; out.ny = -dy; }
    return 0;
  }
  if (out) {
    out.nx = nlx * ob.c - nly * ob.s;
    out.ny = nlx * ob.s + nly * ob.c;
  }
  return tmin;
}

/**
 * Ray vs circle. (dx, dy) must be a unit vector.
 * @returns {number} entry distance (0 if the origin is inside), or -1 on a miss within maxT.
 */
export function rayCircle(ox, oy, dx, dy, cx, cy, r, maxT) {
  const fx = ox - cx, fy = oy - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const b = fx * dx + fy * dy;
  if (b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t <= maxT ? t : -1;
}

/** Separating-axis overlap test between two boxes, optionally grown by `pad`. */
export function obbOverlap(a, b, pad = 0) {
  if (a.maxX + pad < b.minX || b.maxX + pad < a.minX || a.maxY + pad < b.minY || b.maxY + pad < a.minY) {
    return false;
  }
  const tx = b.x - a.x, ty = b.y - a.y;
  // Axes: a's x, a's y, b's x, b's y.
  const axes = [a.c, a.s, -a.s, a.c, b.c, b.s, -b.s, b.c];
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i], ay = axes[i + 1];
    const ra = a.hw * Math.abs(a.c * ax + a.s * ay) + a.hh * Math.abs(-a.s * ax + a.c * ay);
    const rb = b.hw * Math.abs(b.c * ax + b.s * ay) + b.hh * Math.abs(-b.s * ax + b.c * ay);
    if (Math.abs(tx * ax + ty * ay) > ra + rb + pad) return false;
  }
  return true;
}

/** The four corners of a box as [x0, y0, x1, y1, ...] (fresh array; not for hot loops). */
export function obbCorners(ob) {
  const out = [];
  const sx = [-1, 1, 1, -1], sy = [-1, -1, 1, 1];
  for (let i = 0; i < 4; i++) {
    const lx = sx[i] * ob.hw, ly = sy[i] * ob.hh;
    out.push(ob.x + lx * ob.c - ly * ob.s, ob.y + lx * ob.s + ly * ob.c);
  }
  return out;
}

/**
 * Static broadphase over a fixed set of boxes: a coarse uniform grid of cells that
 * each list the boxes whose (padded) bounds overlap them. Ray queries walk the grid
 * with a DDA so a bullet only tests the handful of boxes near its path.
 */
export class StaticIndex {
  /**
   * @param {object[]} obbs boxes from makeObb (not copied; must not move afterwards)
   * @param {number} width world width
   * @param {number} height world height
   * @param {object} [opts] { cellSize = 128, margin = 24 } — `margin` is the largest
   *   `pad` later queries may use.
   */
  constructor(obbs, width, height, { cellSize = 128, margin = 24 } = {}) {
    this.obbs = obbs;
    this.width = width;
    this.height = height;
    this.cs = cellSize;
    this.margin = margin;
    // The grid spans the world plus any box sticking out of it, so a ray that leaves
    // the grid can't hit anything more.
    let x0 = 0, y0 = 0, x1 = width, y1 = height;
    for (const ob of obbs) {
      if (ob.minX - margin < x0) x0 = ob.minX - margin;
      if (ob.minY - margin < y0) y0 = ob.minY - margin;
      if (ob.maxX + margin > x1) x1 = ob.maxX + margin;
      if (ob.maxY + margin > y1) y1 = ob.maxY + margin;
    }
    this.ox = Math.floor(x0 / cellSize) * cellSize;
    this.oy = Math.floor(y0 / cellSize) * cellSize;
    this.cols = Math.max(1, Math.ceil((x1 - this.ox) / cellSize));
    this.rows = Math.max(1, Math.ceil((y1 - this.oy) / cellSize));
    const n = this.cols * this.rows;
    const counts = new Int32Array(n + 1);
    const range = (ob, fn) => {
      const x0 = this._cx(ob.minX - margin), x1 = this._cx(ob.maxX + margin);
      const y0 = this._cy(ob.minY - margin), y1 = this._cy(ob.maxY + margin);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) fn(cy * this.cols + cx);
    };
    for (const ob of obbs) range(ob, (c) => counts[c + 1]++);
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    this.start = counts;
    // Cells hold indices into `obbs`; dedupe stamps live here (not on the boxes) so
    // several indexes can share the same box objects.
    this.items = new Int32Array(counts[n]);
    this.stamps = new Uint32Array(obbs.length);
    const fill = new Int32Array(n);
    obbs.forEach((ob, oi) => {
      range(ob, (c) => {
        this.items[counts[c] + fill[c]++] = oi;
      });
    });
    this.stamp = 1;
    this.hit = { nx: 0, ny: 0, obb: null, t: 0 };
    this._n = { nx: 0, ny: 0 };
  }

  _cx(x) {
    const c = Math.floor((x - this.ox) / this.cs);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  _cy(y) {
    const c = Math.floor((y - this.oy) / this.cs);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  _nextStamp() {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  /**
   * Collect the distinct boxes matching `mask` whose cells touch the AABB into `out`.
   * @returns {number} how many were written (out.length is set to it)
   */
  query(minX, minY, maxX, maxY, mask, out) {
    const st = this._nextStamp();
    const stamps = this.stamps;
    const x0 = this._cx(minX), x1 = this._cx(maxX), y0 = this._cy(minY), y1 = this._cy(maxY);
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.cols + cx;
        for (let i = this.start[c], e = this.start[c + 1]; i < e; i++) {
          const oi = this.items[i];
          if (stamps[oi] === st) continue;
          stamps[oi] = st;
          const ob = this.obbs[oi];
          if (!(ob.mask & mask)) continue;
          if (ob.maxX < minX || ob.minX > maxX || ob.maxY < minY || ob.minY > maxY) continue;
          out[n++] = ob;
        }
      }
    }
    out.length = n;
    return n;
  }

  /**
   * First box matching `mask` along a ray. (dx, dy) must be a unit vector.
   * On a hit, this.hit holds { t, obb, nx, ny } (entry normal).
   * @param {number} [above] boxes whose `top` is at most this high are ignored (a ray
   *   from someone standing on top of things passes over them); 0 = none are
   * @returns {number} hit distance, or -1 when nothing is hit within maxT.
   */
  raycast(ox, oy, dx, dy, maxT, mask, pad = 0, above = 0) {
    const st = this._nextStamp();
    const stamps = this.stamps;
    const cs = this.cs;
    let cx = this._cx(ox), cy = this._cy(oy);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    let tMaxX = adx < EPS ? Infinity : ((cx + (dx > 0 ? 1 : 0)) * cs + this.ox - ox) / dx;
    let tMaxY = ady < EPS ? Infinity : ((cy + (dy > 0 ? 1 : 0)) * cs + this.oy - oy) / dy;
    // An origin outside the grid, heading away on that axis, stays in the edge cells.
    if (tMaxX < 0) tMaxX = Infinity;
    if (tMaxY < 0) tMaxY = Infinity;
    const tDX = adx < EPS ? Infinity : cs / adx, tDY = ady < EPS ? Infinity : cs / ady;
    let best = Infinity, bestOb = null, bnx = 0, bny = 0;
    const nrm = this._n;
    for (;;) {
      const c = cy * this.cols + cx;
      for (let i = this.start[c], e = this.start[c + 1]; i < e; i++) {
        const oi = this.items[i];
        if (stamps[oi] === st) continue;
        stamps[oi] = st;
        const ob = this.obbs[oi];
        if (!(ob.mask & mask) || (above > 0 && ob.top <= above)) continue;
        const t = rayObb(ob, ox, oy, dx, dy, maxT, pad, nrm);
        if (t >= 0 && t < best) {
          best = t;
          bestOb = ob;
          bnx = nrm.nx;
          bny = nrm.ny;
        }
      }
      const tNext = tMaxX < tMaxY ? tMaxX : tMaxY;
      if (best <= tNext || tNext > maxT) break;
      if (tMaxX < tMaxY) {
        cx += stepX;
        if (cx < 0 || cx >= this.cols) break;
        tMaxX += tDX;
      } else {
        cy += stepY;
        if (cy < 0 || cy >= this.rows) break;
        tMaxY += tDY;
      }
    }
    if (!bestOb || best > maxT) return -1;
    const h = this.hit;
    h.t = best;
    h.obb = bestOb;
    h.nx = bnx;
    h.ny = bny;
    return best;
  }

  /**
   * True if the segment (x1,y1)-(x2,y2) touches no box matching `mask` (grown by pad)
   * whose top is higher than `above` (see raycast).
   */
  segmentClear(x1, y1, x2, y2, mask, pad = 0, above = 0) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < EPS) return !this.pointBlocked(x1, y1, mask, pad, above);
    return this.raycast(x1, y1, dx / len, dy / len, len, mask, pad, above) < 0;
  }

  /** True if (px, py) lies inside any box matching `mask` (grown by pad) topped above `above`. */
  pointBlocked(px, py, mask, pad = 0, above = 0) {
    const c = this._cy(py) * this.cols + this._cx(px);
    for (let i = this.start[c], e = this.start[c + 1]; i < e; i++) {
      const ob = this.obbs[this.items[i]];
      if ((ob.mask & mask) && !(above > 0 && ob.top <= above) && pointInObb(ob, px, py, pad)) return true;
    }
    return false;
  }

  /** True if a circle overlaps any box matching `mask`. */
  circleBlocked(px, py, r, mask) {
    const x0 = this._cx(px - r), x1 = this._cx(px + r), y0 = this._cy(py - r), y1 = this._cy(py + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.cols + cx;
        for (let i = this.start[c], e = this.start[c + 1]; i < e; i++) {
          const ob = this.obbs[this.items[i]];
          if ((ob.mask & mask) && circleOverlapsObb(ob, px, py, r)) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Build the collision boxes for a MapDef: every obstacle (walk-blocking, shot-blocking
 * when `solid`, heavy-blocking unless crushable, passable above jumpClearance and
 * standable per standTop — tops snapped to the Z_UNIT grid), every
 * 'water' area (walk-blocking only) and the objective (blocks everything).
 * @returns {object[]} boxes with `ref` pointing at the source object
 */
export function mapColliders(map) {
  const out = [];
  // A campaign map has terrain (shared/terrain.js): every obstacle stands on the ground at
  // its centre, so its top is the terrain height there plus its own height. `baseQ` is that
  // ground height in Z_UNITs (0 on a flat map, where nothing below changes).
  const terrain = terrainOf(map);
  for (const o of map.obstacles || []) {
    const mask = MASK_MOVE | (o.solid ? MASK_SOLID : 0) | (isCrushable(o) ? 0 : MASK_BULKY);
    const box = makeObb(o.x, o.y, o.w, o.h, o.a || 0, mask, o);
    const clear = jumpClearance(o);
    box.baseQ = 0;
    if (clear < Infinity) {
      if (!terrain.flat) box.baseQ = terrain.q(o.x, o.y);
      box.topQ = toZq(clear) + box.baseQ;
      box.top = box.topQ * Z_UNIT;
      box.stand = standTop(o) > 0;
    }
    out.push(box);
  }
  for (const ar of map.areas || []) {
    if (ar.kind === 'water') out.push(makeObb(ar.x, ar.y, ar.w, ar.h, ar.a || 0, MASK_MOVE | MASK_WATER, ar));
  }
  const ob = map.objective;
  if (ob && ob.w > 0 && ob.h > 0) {
    out.push(makeObb(ob.x, ob.y, ob.w, ob.h, ob.a || 0, MASK_MOVE | MASK_SOLID | MASK_BULKY | MASK_OBJECTIVE, ob));
  }
  for (let i = 0; i < out.length; i++) out[i].ci = i;
  return out;
}
