// What a bullet, a gib or a splash of blood lands on (EFFECTS, SPEC §7.5): the map's
// obstacles as oriented rectangles (face normal, top height, extent along the face) and its
// ground areas (asphalt, dirt, grass, water...), derived client-side from the map data —
// the simulation carries no surface information. Both lookups are uniform grids, so a query
// is a few comparisons and allocates nothing (results are written into a caller's object).

/** Material classes that decide the look of an impact. */
export const MAT = { CONCRETE: 0, METAL: 1, WOOD: 2, DIRT: 3, WATER: 4, GLASS: 5, SAND: 6, CLOTH: 7, STONE: 8, FLESH: 9 };

const KIND_MAT = {
  car: MAT.METAL, suv: MAT.METAL, pickup: MAT.METAL, van: MAT.METAL, truck: MAT.METAL, bus: MAT.METAL, tanker: MAT.METAL,
  semi: MAT.METAL, pump: MAT.METAL, guardrail: MAT.METAL, container: MAT.METAL, hvac: MAT.METAL, mast: MAT.METAL,
  booth: MAT.CONCRETE, barrier: MAT.CONCRETE, wall: MAT.CONCRETE, building: MAT.CONCRETE, pillar: MAT.CONCRETE, pier: MAT.CONCRETE,
  ramp: MAT.CONCRETE, stairs: MAT.CONCRETE, parapet: MAT.CONCRETE, rim: MAT.CONCRETE, iwall: MAT.CONCRETE, ipillar: MAT.CONCRETE,
  silo: MAT.METAL, hesco: MAT.SAND, sandbags: MAT.SAND, tent: MAT.CLOTH, rock: MAT.STONE, grave: MAT.STONE,
  tree: MAT.WOOD, palisade: MAT.WOOD, watchtower: MAT.WOOD, desk: MAT.WOOD, cabinet: MAT.METAL, counter: MAT.WOOD, tower: MAT.CONCRETE,
};

/** Material class of an obstacle kind (concrete by default). */
export function materialOfKind(kind) {
  const m = KIND_MAT[kind];
  return m === undefined ? MAT.CONCRETE : m;
}

const GROUND_MAT = {
  asphalt: MAT.CONCRETE, concrete: MAT.CONCRETE, gravel: MAT.DIRT, dirt: MAT.DIRT, grass: MAT.DIRT, sand: MAT.SAND, water: MAT.WATER, ground: MAT.DIRT,
};

/**
 * Obstacle lookup: for a point on or next to an obstacle, its outward face normal (sim
 * axes), its height, kind and the extent of that face along the tangent (for decal clipping).
 * @returns {(x: number, y: number, out: object) => object|null}
 */
export function surfaceIndex(ctx) {
  const ground = ctx.groundY || (() => 0);
  const obs = (ctx.map && ctx.map.obstacles) || [];
  const CELL = 128;
  const grid = new Map();
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const r = Math.hypot(o.w, o.h) / 2 + 4;
    for (let gx = Math.floor((o.x - r) / CELL); gx <= Math.floor((o.x + r) / CELL); gx++) {
      for (let gy = Math.floor((o.y - r) / CELL); gy <= Math.floor((o.y + r) / CELL); gy++) {
        const k = gx * 4096 + gy;
        let l = grid.get(k);
        if (!l) { l = []; grid.set(k, l); }
        l.push(o);
      }
    }
  }
  const heights = new Map();
  const heightOf = (o) => {
    let h = heights.get(o);
    if (h === undefined) {
      try { h = ctx.heightOf ? ctx.heightOf(o.kind, o) : 40; } catch { h = 40; }
      if (!Number.isFinite(h)) h = 40;
      heights.set(o, h);
    }
    return h;
  };
  return (x, y, out) => {
    const l = grid.get(Math.floor(x / CELL) * 4096 + Math.floor(y / CELL));
    if (!l) return null;
    let best = null, bd = 4, bex = 0;
    for (let i = 0; i < l.length; i++) {
      const o = l[i];
      const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
      const dx = x - o.x, dy = y - o.y;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const ex = Math.abs(lx) - o.w / 2, ey = Math.abs(ly) - o.h / 2;
      const d = Math.max(ex, ey);
      if (d > bd || d < -6) continue;
      bd = d;
      best = o;
      let nlx = 0, nly = 0;
      if (ex > ey) nlx = Math.sign(lx) || 1; else nly = Math.sign(ly) || 1;
      out.nx = nlx * c - nly * s;
      out.ny = nlx * s + nly * c;
      bex = ex > ey ? o.h / 2 : o.w / 2;       // half extent along the face
    }
    if (!best) return null;
    out.top = heightOf(best) + ground(best.x, best.y);
    out.kind = best.kind;
    out.mat = materialOfKind(best.kind);
    out.d = bd;
    // extent of the face along the decal tangent t = (ny, -nx): from the hit point to each end
    const tx = out.ny, ty = -out.nx;
    const along = (best.x - x) * tx + (best.y - y) * ty;
    out.s0 = along - bex; out.s1 = along + bex;
    out.o = best;
    return out;
  };
}

/**
 * Ground material lookup by the map's areas (last matching area wins; cached per 48-unit cell).
 * @returns {(x: number, y: number) => number} a MAT.* class
 */
export function groundIndex(ctx) {
  const areas = (ctx.map && ctx.map.areas) || [];
  const CELL = 48;
  const cache = new Map();
  function kindAt(x, y) {
    for (let i = areas.length - 1; i >= 0; i--) {
      const r = areas[i];
      const dx = x - r.x, dy = y - r.y;
      const a = r.a || 0;
      const c = Math.cos(a), s = Math.sin(a);
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      if (Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2) return r.kind;
    }
    return 'ground';
  }
  return (x, y) => {
    const key = Math.floor(x / CELL) * 8192 + Math.floor(y / CELL);
    let m = cache.get(key);
    if (m === undefined) {
      m = GROUND_MAT[kindAt((Math.floor(x / CELL) + 0.5) * CELL, (Math.floor(y / CELL) + 0.5) * CELL)];
      if (m === undefined) m = MAT.DIRT;
      if (cache.size > 6000) cache.clear();
      cache.set(key, m);
    }
    return m;
  };
}
