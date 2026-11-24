// Walk-in buildings of the open maps (shops, houses, offices, warehouses, gas station kiosks, the
// Sandstone houses): real rooms the crew and the horde can walk into, built from the same pieces the
// story levels use (JOURNEY.md §3): thick 'wall' obstacles with doorways, a roof (`map.roofs`, so the
// renderer puts a ceiling over the rooms and the indoor light mask keeps the sky, sun and rain out),
// low furniture ('counter', 'desk') and tall cabinets, shelving and racks ('cabinet'), lamps
// (`map.lights`) and, on one building per map that has it, a stair (terrain flights, shared/terrain.js)
// up onto a roof terrace.
//
// A building is laid out in its own frame: local x along its width `w` (the map angle `a`), local y
// along its depth `h`; the front is the +y side ('s' when a = 0). The outer walls stand inside the
// footprint (their outer faces are its edges), so the footprint is exactly the old solid block.
//
// The record `map.walkins[i]` (plain data, the same on every client: maps are built from (id, seed))
// carries what the 3D art (render3d/world-walkin.js) needs: the footprint, storeys and height, the
// colours, the doorways and windows of the outer walls, the partitions, the furniture and the floor and
// wall finishes. Every obstacle it made carries `walkin` (the record's index) and a `style` 'wi:*'.
// The simulation sees ordinary obstacles: zombies path in through the doorways with the flow field.

import { round1 } from './math.js';

/** Outer wall thickness. */
export const WALKIN_T = 16;
/** Partition thickness. */
export const WALKIN_TI = 10;
/** Narrowest doorway (a brute fits: heavies are 2 × 22 wide plus the flow field's pad). */
export const WALKIN_DOOR = 84;
/** Ceiling height of the ground floor (and the first storey line of the façade). */
export const WALKIN_CEIL = 120;
/** Height of every storey above it. */
export const WALKIN_STOREY = 96;

const r3 = (v) => Math.round(v * 1000) / 1000;

/** The side lines of a w × h footprint (local), inset by t/2: [x1, y1, x2, y2] and the outward normal. */
function sideLine(side, w, h, t) {
  const hw = w / 2, hh = h / 2;
  switch (side) {
    case 'n': return { x1: -hw, y1: -hh + t / 2, x2: hw, y2: -hh + t / 2, nx: 0, ny: -1 };
    case 's': return { x1: -hw, y1: hh - t / 2, x2: hw, y2: hh - t / 2, nx: 0, ny: 1 };
    case 'w': return { x1: -hw + t / 2, y1: -hh + t, x2: -hw + t / 2, y2: hh - t, nx: -1, ny: 0 };
    default: return { x1: hw - t / 2, y1: -hh + t, x2: hw - t / 2, y2: hh - t, nx: 1, ny: 0 };
  }
}

/**
 * Lay out a walk-in building.
 * @param {object} B map builder (maps.js createBuilder)
 * @param {object} spec
 *   { id, type ('kiosk'|'shop'|'house'|'office'|'warehouse'|'apartment'|'sandhouse'|'garage'), name,
 *     x, y, w, h, a, storeys (≥ 1, the façade's), ceil, color, trim, roof (colour), top ('flat'|'gable'),
 *     kind (ceiling: 'plain'|'office'|'house'|'industrial'|'mall'), floor, wall (finishes),
 *     doors: [{ side: 'n'|'s'|'e'|'w', at (offset from the side's middle along +x / +y), w, shutter? }],
 *     parts: [{ x1, y1, x2, y2, gaps: [[at (from x1, y1), w]] }] (local, axis-aligned),
 *     props: [{ k (obstacle kind), x, y, w, h, a, style, color, solid }] (local),
 *     lights: [{ x, y, r, color, flicker }] (local), noWindows: ['n', ...], dark (0..1), section }
 * @returns {object} the record (also pushed to map.walkins)
 */
export function walkIn(B, spec) {
  const map = B.map;
  if (!map.walkins) map.walkins = [];
  const i = map.walkins.length;
  const t = WALKIN_T;
  const a = spec.a || 0;
  const c = Math.cos(a), s = Math.sin(a);
  const { w, h } = spec;
  const P = (lx, ly) => [spec.x + lx * c - ly * s, spec.y + lx * s + ly * c];
  const ceil = spec.ceil || WALKIN_CEIL;
  const storeys = Math.max(1, spec.storeys || 1);
  const H = spec.height || ceil + (storeys - 1) * WALKIN_STOREY;
  const rec = {
    i, id: spec.id || `walkin${i}`, type: spec.type || 'shop', name: spec.name || '',
    x: round1(spec.x), y: round1(spec.y), w: round1(w), h: round1(h), a: r3(a), t,
    ceil, storeys, H: round1(H), top: spec.top || 'flat',
    color: spec.color || '#a89a84', trim: spec.trim || '#d9d2bf', roof: spec.roof || '#4e4a45',
    floor: spec.floor || 'linoleum', wall: spec.wall || 'plaster', kind: spec.kind || 'plain',
    sign: spec.sign || null,
    doors: [], windows: [], parts: [], props: [], lights: [], stair: null,
  };
  map.walkins.push(rec);
  const tag = (o, style) => { o.walkin = i; o.style = style; if (spec.section) o.section = spec.section; return o; };

  // ---- the outer walls, cut at the doorways
  const doorsBy = { n: [], s: [], e: [], w: [] };
  for (const d of spec.doors || []) {
    const dw = Math.max(WALKIN_DOOR, d.w || 96);
    doorsBy[d.side].push({ side: d.side, at: d.at || 0, w: dw, shutter: !!d.shutter });
  }
  const parts = spec.parts || [];
  for (const side of ['n', 's', 'w', 'e']) {
    const L = sideLine(side, w, h, t);
    const along = side === 'n' || side === 's';
    const a0 = along ? L.x1 : L.y1, a1 = along ? L.x2 : L.y2;
    const gaps = doorsBy[side].map((d) => [d.at - d.w / 2, d.at + d.w / 2]).sort((p, q) => p[0] - q[0]);
    let cur = a0;
    const pieces = [];
    for (const [g0, g1] of gaps) {
      if (g0 > cur + 4) pieces.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (a1 > cur + 4) pieces.push([cur, a1]);
    for (const [p0, p1] of pieces) {
      const m = (p0 + p1) / 2;
      const [cx, cy] = along ? P(m, L.y1) : P(L.x1, m);
      const o = B.ob('wall', cx, cy, along ? p1 - p0 : t, along ? t : p1 - p0, a, { color: rec.color });
      o.top = round1(H);
      tag(o, 'wi:ext');
    }
    for (const d of doorsBy[side]) rec.doors.push({ side, at: round1(d.at), w: round1(d.w), shutter: d.shutter });
    // windows: evenly along the side, clear of the corners, the doorways and where partitions meet it
    if (!(spec.noWindows || []).includes(side)) {
      const len = along ? w : h;
      const ww = spec.windowW || 44;
      const n = Math.max(0, Math.floor((len - 70) / (spec.windowBay || 110)));
      const stops = [];
      for (const d of doorsBy[side]) stops.push([d.at - d.w / 2 - 22, d.at + d.w / 2 + 22]);
      for (const p of parts) {
        // a partition reaching this wall (within t + 2 of its inner face)
        const inner = along ? (side === 'n' ? -h / 2 + t : h / 2 - t) : (side === 'w' ? -w / 2 + t : w / 2 - t);
        for (const [px, py] of [[p.x1, p.y1], [p.x2, p.y2]]) {
          const q = along ? py : px, at = along ? px : py;
          if (Math.abs(q - inner) <= t + 2) stops.push([at - 30, at + 30]);
        }
      }
      for (let k = 0; k < n; k++) {
        const at = -len / 2 + 35 + (k + 0.5) * ((len - 70) / n);
        if (stops.some(([s0, s1]) => at + ww / 2 > s0 && at - ww / 2 < s1)) continue;
        rec.windows.push({ side, at: round1(at), w: ww });
      }
    }
  }

  // ---- partitions (local lines, axis-aligned) with their doorways
  for (const p of parts) {
    const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
    const ux = (p.x2 - p.x1) / len, uy = (p.y2 - p.y1) / len;
    const gaps = (p.gaps || []).map(([at, gw]) => [at - Math.max(WALKIN_DOOR, gw) / 2, at + Math.max(WALKIN_DOOR, gw) / 2]).sort((q, r) => q[0] - r[0]);
    let cur = 0;
    const pieces = [];
    for (const [g0, g1] of gaps) {
      if (g0 > cur + 4) pieces.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (len > cur + 4) pieces.push([cur, len]);
    const pa = Math.atan2(uy, ux);
    for (const [p0, p1] of pieces) {
      const m = (p0 + p1) / 2;
      const [cx, cy] = P(p.x1 + ux * m, p.y1 + uy * m);
      const o = B.ob('wall', cx, cy, p1 - p0, WALKIN_TI, a + pa, { color: rec.color });
      o.top = round1(ceil);
      tag(o, 'wi:part');
    }
    rec.parts.push({ x1: round1(p.x1), y1: round1(p.y1), x2: round1(p.x2), y2: round1(p.y2), gaps: gaps.map(([g0, g1]) => [round1(g0), round1(g1)]), look: p.look || null });
  }

  // ---- furniture: obstacles the art draws by style
  for (const q of spec.props || []) {
    const [px, py] = P(q.x, q.y);
    const opts = { color: q.color };
    if (q.solid !== undefined) opts.solid = q.solid;
    const o = B.ob(q.k, px, py, q.w, q.h, a + (q.a || 0), opts);
    tag(o, 'wi:' + (q.style || q.k));
    rec.props.push({ id: o.id, style: q.style || q.k, x: round1(q.x), y: round1(q.y), w: q.w, h: q.h, a: r3(q.a || 0) });
  }

  // ---- lamps under the ceiling (the roof then adds no fixture lights of its own)
  for (const l of spec.lights || []) {
    const [lx, ly] = P(l.x, l.y);
    B.light(lx, ly, l.r || 260, l.color || '#ffe2b0', l.flicker || 0, ceil - 14);
    rec.lights.push({ x: round1(l.x), y: round1(l.y) });
  }

  // ---- the floor (no grass, no scatter), the roof (the ceiling, the indoor mask), a clear apron
  B.area(spec.ground || 'concrete', spec.x, spec.y, w - 2 * t, h - 2 * t, a);
  B.roof(spec.x, spec.y, w - 2 * t, h - 2 * t, a, { kind: rec.kind, height: ceil, dark: spec.dark ?? 0.78, section: spec.section });
  map.roofs[map.roofs.length - 1].shell = i;
  B.keep(spec.x, spec.y, w + 90, h + 90, a);
  return rec;
}

/**
 * A stair up onto a roof terrace beside a walk-in building (the map gains terrain: a plateau for the
 * terrace and a flight of fine steps up to it, shared/terrain.js). Axis-aligned only (a = 0).
 * The wing [x0, x1] × [y0, y1] stands against the building; the flight runs along x0 + t .. x0 + t + lane
 * (its foot at the y1 side, the street) up to the terrace at `rise`. Walls: the wing's outer walls (the
 * terrace's parapet) and the stair's inner wall; the building's own wall closes the x0 side.
 * @param {object} B map builder
 * @param {object} rec the building's record (walkIn's result)
 * @param {{ x0, y0, x1, y1, rise, lane, run, side ('w'|'e': which side of the wing the stair runs on) }} o world rect
 */
export function roofTerrace(B, rec, o) {
  const map = B.map;
  const t = WALKIN_T;
  const rise = o.rise || 120;
  const lane = o.lane || 96;
  const run = o.run || Math.round(rise * 1.4);
  const west = (o.side || 'w') === 'w';
  const { x0, y0, x1, y1 } = o;
  // the stair lane (inside the wing, along its stair side), foot at y1, top landing at y1 - run
  const sx0 = west ? x0 : x1 - lane, sx1 = west ? x0 + lane : x1;
  const top = y1 - run;
  // terrain: the terrace plateau over the wing (but the flight), the flight of fine steps
  const terrain = map.terrain || (map.terrain = { hills: [], plateaus: [] });
  const plat = (a0, b0, a1, b1, hh) => terrain.plateaus.push({ x0: round1(a0), y0: round1(b0), x1: round1(a1), y1: round1(b1), h: r3(hh), edge: 0 });
  plat(x0, y0, x1, top, rise);                                     // the terrace and the landing
  plat(west ? sx1 : x0, top, west ? x1 : sx0, y1, rise);           // the wing beside the flight
  const n = 40;
  for (let j = 1; j < n; j++) plat(sx0, top, sx1, top + (run * (n - j)) / n, (rise * j) / n);
  // ground guides just outside the raised block (the ground mesh climbs at the walls, inside them)
  plat(x0 - 1, y0 - 1, x1 + 1, y1 + 1, 0);
  // walls: north and the far side full height; the front beside the lane; the lane's inner wall
  const wallOb = (cx, cy, ww, hh, style) => {
    const ob = B.ob('wall', cx, cy, ww, hh, 0, { color: rec.color });
    ob.top = round1(rise + 34);
    ob.walkin = rec.i;
    ob.style = style;
    return ob;
  };
  // (west: the wing stands east of the building, whose wall closes its x0 side; east: the mirror)
  wallOb((x0 + x1) / 2, y0 + t / 2, x1 - x0, t, 'wi:wing');
  if (west) wallOb(x1 - t / 2, (y0 + y1) / 2 + t / 2, t, y1 - y0 - t, 'wi:wing');
  else wallOb(x0 + t / 2, (y0 + y1) / 2 + t / 2, t, y1 - y0 - t, 'wi:wing');
  const fx0 = west ? sx1 : x0 + t, fx1 = west ? x1 - t : sx0;
  wallOb((fx0 + fx1) / 2, y1 - t / 2, fx1 - fx0, t, 'wi:wing');
  const ix = west ? sx1 + WALKIN_TI / 2 : sx0 - WALKIN_TI / 2;
  const inner = B.ob('wall', ix, (top + y1 - t) / 2, WALKIN_TI, y1 - t - top, 0, { color: rec.color });
  inner.top = round1(rise + 34);
  inner.walkin = rec.i;
  inner.style = 'wi:stairwall';
  B.area('concrete', (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0);
  B.keep((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 + 90, y1 - y0 + 90);
  rec.stair = { x0: round1(x0), y0: round1(y0), x1: round1(x1), y1: round1(y1), sx0: round1(sx0), sx1: round1(sx1), top: round1(top), rise, run, side: west ? 'w' : 'e' };
  return rec.stair;
}

// ---------------------------------------------------------------------------------------------------
// Ready-made layouts: a building type laid out on its footprint (furniture and partitions scale with it).

/**
 * Furniture and partitions of a building type on a w × h footprint with its front door on the +y side.
 * @param {string} type
 * @param {number} w
 * @param {number} h
 * @param {object} [o] { door: offset of the front door along x, back: true = a back door on the -y side }
 * @returns {{ doors, parts, props, lights, kind, floor, wall, ceil }}
 */
export function layoutOf(type, w, h, o = {}) {
  const t = WALKIN_T;
  const ix0 = -w / 2 + t, ix1 = w / 2 - t, iy0 = -h / 2 + t, iy1 = h / 2 - t;
  const door = o.door || 0;
  const doors = [{ side: 's', at: door, w: o.doorW || 100 }];
  if (o.back) doors.push({ side: 'n', at: o.backAt ?? (door > 0 ? -w * 0.25 : w * 0.25), w: 88 });
  const parts = [], props = [], lights = [];
  const P = (k, x, y, pw, ph, style, extra = {}) => props.push({ k, x, y, w: pw, h: ph, style, ...extra });
  switch (type) {
    case 'kiosk': {
      // a gas station store: a counter by the door, aisles of shelves, coolers on the back wall, a stock room
      const sx = ix1 - 110;   // the stock room's wall
      parts.push({ x1: sx, y1: iy0, x2: sx, y2: iy1, gaps: [[(iy1 - iy0) * 0.62, 88]] });
      P('counter', door - 90 < ix0 + 60 ? door + 100 : door - 90, iy1 - 52, 110, 34, 'till');
      for (let k = 0; k < 2; k++) P('counter', ix0 + 70 + k * 92, -6, 26, Math.min(130, (iy1 - iy0) * 0.5), 'shelf');
      for (let x = ix0 + 40; x < sx - 40; x += 46) P('cabinet', x, iy0 + 13, 42, 24, 'cooler');
      P('cabinet', sx + 55, iy0 + 30, 80, 34, 'rack');
      P('counter', sx + 50, iy1 - 34, 44, 34, 'crate');
      lights.push({ x: (ix0 + sx) / 2, y: 0, r: 280, color: '#eaf2ff' }, { x: sx + 55, y: iy0 + 50, r: 160, color: '#ffd9a0', flicker: 0.25 });
      return { doors, parts, props, lights, kind: 'office', floor: 'linoleum', wall: 'drywall' };
    }
    case 'shop': {
      // a store: shelving aisles front to back, a counter, an office at the back
      const by = iy0 + Math.min(110, (iy1 - iy0) * 0.38);
      parts.push({ x1: ix0, y1: by, x2: ix1, y2: by, gaps: [[(ix1 - ix0) * 0.3, 90]] });
      const aisles = Math.max(2, Math.floor((ix1 - ix0 - 120) / 95));
      for (let k = 0; k < aisles; k++) {
        const x = ix0 + 80 + k * ((ix1 - ix0 - 160) / Math.max(1, aisles - 1));
        if (Math.abs(x - door) < 70) continue;
        P('counter', x, (by + iy1) / 2 - 10, 26, Math.max(60, (iy1 - by) * 0.48), 'shelf');
      }
      P('counter', ix1 - 70, iy1 - 50, 34, 110, 'till');
      P('desk', ix0 + 70, (iy0 + by) / 2, 70, 40, 'desk');
      P('cabinet', ix1 - 30, (iy0 + by) / 2, 30, 60, 'filing');
      P('counter', ix0 + (ix1 - ix0) * 0.62, iy0 + 30, 44, 34, 'crate');
      lights.push({ x: 0, y: (by + iy1) / 2, r: 300, color: '#eef4ff' }, { x: ix0 + 90, y: (iy0 + by) / 2, r: 170, color: '#ffd49a', flicker: 0.2 });
      return { doors, parts, props, lights, kind: 'office', floor: 'linoleum', wall: 'drywall' };
    }
    case 'house': {
      // a hall in the middle of the front, the living room to one side, the kitchen behind, a bedroom
      const mx = ix0 + (ix1 - ix0) * 0.5, my = iy0 + (iy1 - iy0) * 0.46;
      parts.push({ x1: ix0, y1: my, x2: ix1, y2: my, gaps: [[(mx - ix0) * 0.5, 88], [(ix1 - ix0) * 0.75, 88]] });
      parts.push({ x1: mx, y1: iy0, x2: mx, y2: my - WALKIN_TI / 2, gaps: [[(my - iy0) * 0.5, 86]] });
      P('desk', ix0 + 70, iy1 - 50, 100, 40, 'sofa');
      P('desk', ix0 + 70, iy1 - 120, 54, 32, 'table');
      P('cabinet', ix1 - 26, iy1 - 70, 26, 70, 'shelf');
      P('counter', ix0 + 26, (iy0 + my) / 2, 30, Math.max(60, my - iy0 - 50), 'kitchen');
      P('desk', (ix0 + mx) / 2 + 20, (iy0 + my) / 2, 60, 44, 'table');
      P('desk', (mx + ix1) / 2 + 10, iy0 + 50, 80, 60, 'bed');
      P('cabinet', ix1 - 22, (iy0 + my) / 2 + 20, 24, 54, 'wardrobe');
      lights.push({ x: (ix0 + ix1) / 2 - 40, y: (my + iy1) / 2, r: 230, color: '#ffd49a' }, { x: (ix0 + mx) / 2, y: (iy0 + my) / 2, r: 170, color: '#ffe2b0' }, { x: (mx + ix1) / 2, y: (iy0 + my) / 2, r: 160, color: '#ffc98a', flicker: 0.3 });
      return { doors, parts, props, lights, kind: 'house', floor: 'wood', wall: 'wallpaper', ceil: 112 };
    }
    case 'office': {
      // reception, a corridor across the back, two offices off it
      const cy = iy0 + (iy1 - iy0) * 0.42;
      const mx = (ix0 + ix1) / 2;
      parts.push({ x1: ix0, y1: cy, x2: ix1, y2: cy, gaps: [[(ix1 - ix0) * 0.22, 90], [(ix1 - ix0) * 0.78, 90]] });
      parts.push({ x1: mx, y1: iy0, x2: mx, y2: cy - WALKIN_TI / 2, gaps: [] });
      P('counter', door + (door > 0 ? -110 : 110), (cy + iy1) / 2 + 10, 120, 34, 'reception');
      P('desk', ix0 + 40, iy1 - 70, 40, 90, 'sofa');
      for (const [x0, x1] of [[ix0, mx], [mx, ix1]]) {
        P('desk', (x0 + x1) / 2, (iy0 + cy) / 2 - 10, 74, 40, 'desk');
        P('cabinet', x1 - 24 - (x1 === ix1 ? 0 : WALKIN_TI), iy0 + 40, 26, 50, 'filing');
      }
      lights.push({ x: 0, y: (cy + iy1) / 2, r: 280, color: '#eef4ff' }, { x: (ix0 + mx) / 2, y: (iy0 + cy) / 2, r: 170, color: '#eef4ff' }, { x: (mx + ix1) / 2, y: (iy0 + cy) / 2, r: 170, color: '#eef4ff', flicker: 0.35 });
      return { doors, parts, props, lights, kind: 'office', floor: 'carpet', wall: 'drywall' };
    }
    case 'warehouse': {
      // a high hall: pallet racks in rows, crates, a corner office
      const ox = ix0 + 120, oy = iy0 + 100;
      parts.push({ x1: ox, y1: iy0, x2: ox, y2: oy, gaps: [] });
      parts.push({ x1: ix0, y1: oy, x2: ox + WALKIN_TI / 2, y2: oy, gaps: [[60, 86]] });
      P('desk', ix0 + 55, iy0 + 45, 64, 36, 'desk');
      const rows = Math.max(1, Math.floor((ix1 - ox - 120) / 120));
      for (let k = 0; k < rows; k++) P('cabinet', ox + 110 + k * 120, iy0 + 30 + (iy1 - iy0) * 0.22, 34, Math.min(170, (iy1 - iy0) * 0.44), 'rack');
      P('counter', ix1 - 60, iy1 - 60, 44, 44, 'crate');
      P('counter', ix1 - 110, iy1 - 50, 40, 40, 'crate');
      P('counter', ix0 + 60, iy1 - 60, 60, 44, 'pallet');
      lights.push({ x: (ox + ix1) / 2, y: 0, r: 340, color: '#ffc27a' }, { x: ix0 + 60, y: iy0 + 50, r: 150, color: '#ffe2b0', flicker: 0.4 });
      return { doors, parts, props, lights, kind: 'industrial', floor: 'concrete', wall: 'block', ceil: 190 };
    }
    case 'apartment': {
      // a lobby with mailboxes and a front desk, a flat at the back (a living room and a bedroom)
      const cy = iy0 + (iy1 - iy0) * 0.48;
      const mx = (ix0 + ix1) / 2;
      parts.push({ x1: ix0, y1: cy, x2: ix1, y2: cy, gaps: [[(ix1 - ix0) * 0.3, 90]] });
      parts.push({ x1: mx + 30, y1: iy0, x2: mx + 30, y2: cy - WALKIN_TI / 2, gaps: [[(cy - iy0) * 0.5, 86]] });
      P('cabinet', ix0 + 13, (cy + iy1) / 2, 18, 80, 'mailbox');
      P('counter', ix1 - 70, (cy + iy1) / 2, 90, 30, 'reception');
      P('desk', (ix0 + mx) / 2, iy0 + 60, 100, 40, 'sofa');
      P('desk', (ix0 + mx) / 2, iy0 + 130 < cy - 40 ? iy0 + 130 : iy0 + 110, 54, 32, 'table');
      P('desk', (mx + ix1) / 2 + 15, iy0 + 52, 80, 60, 'bed');
      lights.push({ x: 0, y: (cy + iy1) / 2, r: 260, color: '#ffe2b0', flicker: 0.2 }, { x: (ix0 + mx) / 2, y: (iy0 + cy) / 2, r: 180, color: '#ffd49a' }, { x: (mx + ix1) / 2, y: (iy0 + cy) / 2, r: 150, color: '#ffc98a' });
      return { doors, parts, props, lights, kind: 'office', floor: 'tile', wall: 'wallpaper' };
    }
    case 'garage': {
      // a workshop: a wide roll-up opening, a car lift, workbenches, tyres
      P('counter', ix0 + 30, 0, 34, Math.min(160, (iy1 - iy0) * 0.6), 'bench');
      P('cabinet', ix1 - 20, iy0 + 50, 26, 70, 'toolwall');
      P('counter', ix1 - 50, iy1 - 50, 40, 40, 'tyres');
      lights.push({ x: 0, y: 0, r: 300, color: '#ffd9a0', flicker: 0.15 });
      return { doors, parts, props, lights, kind: 'industrial', floor: 'concrete', wall: 'block', ceil: 160 };
    }
    case 'sandhouse': {
      // a desert house: whitewashed rooms, rugs, a low table, jars, a bed roll
      const mx = (ix0 + ix1) / 2;
      if (ix1 - ix0 > 240) parts.push({ x1: mx, y1: iy0, x2: mx, y2: iy1, gaps: [[(iy1 - iy0) * 0.5, 88]] });
      P('desk', (ix0 + mx) / 2, iy0 + 50, 60, 40, 'lowtable');
      P('counter', ix0 + 26, iy1 - 40, 30, 30, 'jars');
      P('desk', ix1 - 50, iy0 + 45, 70, 44, 'bedroll');
      P('cabinet', ix1 - 18, iy1 - 60, 20, 60, 'niche');
      lights.push({ x: (ix0 + ix1) / 2, y: 0, r: 230, color: '#ffb866', flicker: 0.35 });
      return { doors, parts, props, lights, kind: 'plain', floor: 'tile', wall: 'plaster', ceil: 124 };
    }
    default:
      return { doors, parts, props, lights, kind: 'plain', floor: 'concrete', wall: 'plaster' };
  }
}

/**
 * A walk-in building of a ready-made type: layoutOf(type) plus walkIn. `o` overrides any field.
 * @returns {object} the record
 */
export function walkInOf(B, type, x, y, w, h, a, o = {}) {
  const L = layoutOf(type, w, h, o);
  return walkIn(B, { type, x, y, w, h, a, ...L, ...o, doors: o.doors || L.doors, parts: o.parts || L.parts, props: o.props || L.props, lights: o.lights || L.lights });
}
