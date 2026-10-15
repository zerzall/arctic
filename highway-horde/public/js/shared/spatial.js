// Uniform-grid spatial hash for moving entities (zombies, players, turrets).
// Rebuilt from scratch every tick with a counting sort into reusable typed arrays,
// so there is no per-tick allocation and iteration order is deterministic.

const EPS = 1e-9;

/** Uniform grid of live entities, re-bucketed every tick (see rebuild). */
export class SpatialHash {
  /**
   * @param {number} width world width in px
   * @param {number} height world height in px
   * @param {number} [cellSize] grid cell size; queries are cheapest when it is about
   *   twice the typical query radius
   */
  constructor(width, height, cellSize = 64) {
    this.cs = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    const n = this.cols * this.rows;
    this.start = new Int32Array(n + 1);
    this.fill = new Int32Array(n);
    this.cellStamp = new Uint32Array(n);
    this.stamp = 0;
    this.capacity = 0;
    this.cellOf = new Int32Array(0);
    this.order = new Int32Array(0);
    this.items = [];
    this.count = 0;
    this._grow(256);
  }

  _grow(n) {
    let cap = this.capacity || 256;
    while (cap < n) cap *= 2;
    if (cap === this.capacity) return;
    this.capacity = cap;
    this.cellOf = new Int32Array(cap);
    this.order = new Int32Array(cap);
  }

  /** Cell index for a world position (clamped to the grid). */
  cellIndex(x, y) {
    let cx = Math.floor(x / this.cs), cy = Math.floor(y / this.cs);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * Re-bucket `items[0..n)`. Items need numeric `x`, `y`; items with a truthy `dead`
   * are skipped. The array is kept by reference and must not be reordered until the
   * next rebuild.
   */
  rebuild(items, n = items.length) {
    if (n > this.capacity) this._grow(n);
    this.items = items;
    this.count = n;
    const start = this.start, fill = this.fill, cellOf = this.cellOf;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      if (it.dead) { cellOf[i] = -1; continue; }
      const c = this.cellIndex(it.x, it.y);
      cellOf[i] = c;
      start[c + 1]++;
    }
    const cells = this.cols * this.rows;
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    fill.fill(0);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c < 0) continue;
      this.order[start[c] + fill[c]++] = i;
    }
  }

  /**
   * Collect items whose centre lies within `r` of (x, y) into `out` (in grid order).
   * @returns {number} count (out.length is set to it)
   */
  queryRadius(x, y, r, out) {
    const cs = this.cs;
    let x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs);
    let y0 = Math.floor((y - r) / cs), y1 = Math.floor((y + r) / cs);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= this.cols) x1 = this.cols - 1;
    if (y1 >= this.rows) y1 = this.rows - 1;
    const r2 = r * r;
    const items = this.items, order = this.order, start = this.start;
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.cols + cx;
        for (let i = start[c], e = start[c + 1]; i < e; i++) {
          const it = items[order[i]];
          if (it.dead) continue;
          const dx = it.x - x, dy = it.y - y;
          if (dx * dx + dy * dy <= r2) out[n++] = it;
        }
      }
    }
    out.length = n;
    return n;
  }

  /**
   * Nearest live item to (x, y) within maxR for which `accept(item)` is true (or any
   * item when accept is omitted). Searches outward ring by ring.
   * @returns {object|null}
   */
  nearest(x, y, maxR, accept = null) {
    const cs = this.cs;
    const ccx = Math.floor(x / cs), ccy = Math.floor(y / cs);
    const maxRing = Math.ceil(maxR / cs) + 1;
    let best = null, bestD2 = maxR * maxR;
    const items = this.items, order = this.order, start = this.start;
    for (let ring = 0; ring <= maxRing; ring++) {
      // Once the best candidate is closer than anything the next ring could hold, stop.
      if (best && (ring - 1) * cs > 0 && ((ring - 1) * cs) * ((ring - 1) * cs) > bestD2) break;
      for (let cy = ccy - ring; cy <= ccy + ring; cy++) {
        if (cy < 0 || cy >= this.rows) continue;
        const edgeRow = cy === ccy - ring || cy === ccy + ring;
        for (let cx = ccx - ring; cx <= ccx + ring; cx += (edgeRow ? 1 : 2 * ring || 1)) {
          if (cx < 0 || cx >= this.cols) continue;
          const c = cy * this.cols + cx;
          for (let i = start[c], e = start[c + 1]; i < e; i++) {
            const it = items[order[i]];
            if (it.dead) continue;
            const dx = it.x - x, dy = it.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2 && (!accept || accept(it))) {
              bestD2 = d2;
              best = it;
            }
          }
        }
      }
    }
    return best;
  }

  /**
   * Gather candidate items that may lie within `pad` of the ray segment from
   * (ox, oy) along unit (dx, dy) for maxT px. Candidates are a superset; callers do
   * the exact ray-vs-circle test. `pad` should cover the largest item radius.
   * @returns {number} count (out.length is set to it)
   */
  queryRay(ox, oy, dx, dy, maxT, pad, out) {
    const cs = this.cs;
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.cellStamp.fill(0);
      this.stamp = 1;
    }
    const st = this.stamp;
    const k = Math.max(1, Math.ceil(pad / cs));
    const items = this.items, order = this.order, start = this.start, cellStamp = this.cellStamp;
    let cx = Math.floor(ox / cs), cy = Math.floor(oy / cs);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    let tMaxX = adx < EPS ? Infinity : ((cx + (dx > 0 ? 1 : 0)) * cs - ox) / dx;
    let tMaxY = ady < EPS ? Infinity : ((cy + (dy > 0 ? 1 : 0)) * cs - oy) / dy;
    const tDX = adx < EPS ? Infinity : cs / adx, tDY = ady < EPS ? Infinity : cs / ady;
    let n = 0;
    const maxSteps = this.cols + this.rows + 4;
    for (let step = 0; step < maxSteps; step++) {
      for (let yy = cy - k; yy <= cy + k; yy++) {
        if (yy < 0 || yy >= this.rows) continue;
        for (let xx = cx - k; xx <= cx + k; xx++) {
          if (xx < 0 || xx >= this.cols) continue;
          const c = yy * this.cols + xx;
          if (cellStamp[c] === st) continue;
          cellStamp[c] = st;
          for (let i = start[c], e = start[c + 1]; i < e; i++) {
            const it = items[order[i]];
            if (!it.dead) out[n++] = it;
          }
        }
      }
      const tNext = tMaxX < tMaxY ? tMaxX : tMaxY;
      if (tNext > maxT) break;
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDX;
      } else {
        cy += stepY;
        tMaxY += tDY;
      }
      // Stop once the ray has left the grid for good (including the padding band).
      if ((cx < -k && stepX < 0) || (cx >= this.cols + k && stepX > 0)) break;
      if ((cy < -k && stepY < 0) || (cy >= this.rows + k && stepY > 0)) break;
    }
    out.length = n;
    return n;
  }
}
