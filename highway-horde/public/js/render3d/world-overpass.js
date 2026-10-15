// Elevated roads of the static world (WORLD, SPEC §2 MapDef.overpass, §7.5): the viaduct
// deck on its pier bents, the ramps on their retaining-wall embankments, parapets, lane
// paint, deck lamps, the fascia signs, sodium fixtures under the deck and the wrecks up on
// top. The sim only knows the piers and the ramp walls (obstacles); everything overhead is
// built here from the map data into the same merged world buckets as the rest of the map,
// so the whole structure costs no extra draw calls beyond its cells.
//
// Deck frame: a deck point [x, y, z] has its road surface at height z. Under it: the slab
// and girders (OVERPASS.depth), then at each bent a cap beam (OVERPASS.cap) on two columns.

import { T, shadeHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { buildVehicle, buildSemiCab, buildTrailer } from './world-veh.js';
import { lampPost } from './world-props.js';
import { OVERPASS } from '../shared/maps.js';

const CONCRETE = '#8f8b82';
const CONCRETE_DARK = '#6d6962';
const PANEL = '#a39e93';
const ASPHALT = '#2a2b2e';
const PAINT = '#cfcdc2';
const YELLOW = '#c99a34';
const PIECE = 400;          // decks are cut into pieces this long (culling cells, lamp spacing)
const SLAB = 14;            // road slab (the rest of OVERPASS.depth is girders)
// parapet: a concrete F-shape barrier, 14 wide at the foot, OVERPASS.parapet tall
const PARAPET = [[-7, 0], [7, 0], [7, 3], [3.2, 9], [2.4, 30], [-2.4, 30], [-3.2, 9], [-7, 3]];

/**
 * Deck surface height (world units) over a sim point: the highest deck there, 0 when none.
 * @param {object} map MapDef
 * @param {number} x
 * @param {number} y
 * @param {number} [pad] extra reach past the deck edges
 * @returns {number}
 */
export function deckHeightAt(map, x, y, pad = 0) {
  let best = 0;
  const ov = map && map.overpass;
  if (!ov) return 0;
  for (const d of ov.decks) {
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [x0, y0, z0] = d.pts[i], [x1, y1, z1] = d.pts[i + 1];
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
      if (!(L2 > 0)) continue;
      const t = ((x - x0) * dx + (y - y0) * dy) / L2;
      if (t < 0 || t > 1) continue;
      if (Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)) > d.w / 2 + pad) continue;
      best = Math.max(best, z0 + (z1 - z0) * t);
    }
  }
  return best;
}

/**
 * Roofs over walkable ground (viaduct decks; ramps sit on solid embankments) as oriented
 * rects { x, y, a, hl, hw, z } — effects that must stop under a deck (rain) use them.
 * @param {object} map MapDef
 * @returns {object[]}
 */
export function deckRoofs(map) {
  const out = [];
  const ov = map && map.overpass;
  if (!ov) return out;
  for (const d of ov.decks) {
    if (d.kind === 'ramp') continue;
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [x0, y0, z0] = d.pts[i], [x1, y1, z1] = d.pts[i + 1];
      out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, a: Math.atan2(y1 - y0, x1 - x0), hl: Math.hypot(x1 - x0, y1 - y0) / 2, hw: d.w / 2, z: Math.min(z0, z1) - OVERPASS.depth });
    }
  }
  return out;
}

/**
 * Write the overpass into the world's geometry builder.
 * @param {object} B geo builder (world-geo.js)
 * @param {object} map MapDef (map.overpass may be null: nothing to build)
 * @param {{ halos: object[] }} fx effect lists of the world (lamp and fixture glows)
 */
export function buildOverpass(B, map, fx) {
  const ov = map.overpass;
  if (!ov) return;
  const breaches = parapetBreaches(map);
  ov.decks.forEach((d, di) => {
    let station = 0;   // along the whole deck, like the breach stations
    for (let i = 0; i + 1 < d.pts.length; i++) {
      buildDeckSegment(B, map, d, di * 16 + i, d.pts[i], d.pts[i + 1], station, breaches.get(d) || [], fx);
      station += Math.hypot(d.pts[i + 1][0] - d.pts[i][0], d.pts[i + 1][1] - d.pts[i][1]);
    }
  });
  ov.bents.forEach((b, i) => buildBent(B, map, b, i));
  ov.vehicles.forEach((v, i) => buildDeckVehicle(B, map, v, i));
  ov.signs.forEach((s, i) => buildSign(B, map, s, i));
  // sodium fixtures hanging under the deck for the map's lights placed there
  map.lights.forEach((l, i) => {
    if (!Number.isFinite(l.h) || deckHeightAt(map, l.x, l.y) <= l.h) return;
    B.obj(l.x, l.y, 0, 900 + i);
    B.rbox('std', 0, l.h + 3, 0, 22, 6, 12, 1.5, '#3a3c3e', null, { surf: [DET.panel, 0.5, 0.6] });
    B.box('std', 0, l.h + 8, 0, 3, 6, 3, '#2a2c2e', null, { surf: [DET.rust, 0.6, 0.7] });
    B.box('glow', 0, l.h - 0.2, 0, 18, 0.5, 9, l.color, null, { emissive: 4, uv: atlasUV('white') });
    fx.halos.push({ x: l.x, y: l.y, h: l.h - 3, color: l.color, size: 95, strength: 0.7, flicker: l.flicker || 0 });
  });
}

/**
 * Where the parapets open: over a ramp joining a deck edge, and where a wreck went through.
 * @returns {Map<object, Array<{side: number, s0: number, s1: number}>>} per deck (by object)
 */
function parapetBreaches(map) {
  const out = new Map();
  const add = (d, side, s0, s1) => {
    if (!out.has(d)) out.set(d, []);
    out.get(d).push({ side, s0, s1 });
  };
  const ov = map.overpass;
  // station (along the deck from its first point) and side of a point next to a deck
  const locate = (d, x, y) => {
    let acc = 0;
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [x0, y0] = d.pts[i], [x1, y1] = d.pts[i + 1];
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      const t = ((x - x0) * dx + (y - y0) * dy) / (L * L);
      if (t >= -0.01 && t <= 1.01) {
        const off = ((x - x0) * -dy + (y - y0) * dx) / L;   // + = the deck frame's local +z side
        if (Math.abs(off) <= d.w / 2 + 12) return { s: acc + t * L, side: off >= 0 ? 1 : -1, off };
      }
      acc += L;
    }
    return null;
  };
  for (const r of ov.decks) {
    if (r.kind !== 'ramp') continue;
    const top = r.pts.reduce((a, b) => (b[2] > a[2] ? b : a));
    for (const d of ov.decks) {
      if (d === r) continue;
      const hit = locate(d, top[0], top[1]);
      if (hit && Math.abs(Math.abs(hit.off) - d.w / 2) < 14) add(d, hit.side, hit.s - r.w * 0.55, hit.s + r.w * 0.55);
    }
  }
  for (const v of ov.vehicles) {
    if (!v.pitch && !v.roll) continue;
    for (const d of ov.decks) {
      const hit = locate(d, v.x, v.y);
      if (hit) add(d, hit.side, hit.s - v.w * 0.7, hit.s + v.w * 0.7);
    }
  }
  return out;
}

function buildDeckSegment(B, map, d, di, p0, p1, s0, cut, fx) {
  const [x0, y0, z0] = p0, [x1, y1, z1] = p1;
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (!(len > 1)) return;
  const a = Math.atan2(dy, dx);
  const ramp = d.kind === 'ramp';
  const slope = Math.atan2(z1 - z0, len);
  const w = d.w;
  const n = Math.max(1, Math.ceil(len / PIECE));
  const S = [DET.concrete, 0.9, 0];
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const tm = (t0 + t1) / 2;
    const cx = x0 + dx * tm, cy = y0 + dy * tm, cz = z0 + (z1 - z0) * tm;
    const Lp = Math.hypot(len / n, (z1 - z0) / n);   // sloped piece length
    B.obj(cx, cy, a, di * 97 + k * 7 + 1, cz, slope ? [0, slope] : null);
    B.setJitter(0.03);
    // wearing course, slab, fascia beams
    B.block('std', 0, -3, 0, Lp + 0.4, 3, w - 12, ASPHALT, null, { surf: [DET.asphalt, 0.62, 0], noAO: true });
    B.block('std', 0, -SLAB, 0, Lp + 0.4, SLAB - 3, w, CONCRETE, null, { surf: S });
    for (const sd of [-1, 1]) B.box('std', 0, -OVERPASS.depth / 2 + 3, sd * (w / 2 + 1.5), Lp + 0.4, OVERPASS.depth - 4, 3, shadeHex(CONCRETE, 0.08), null, { surf: S, noAO: true });
    if (!ramp) {
      // box girders under the slab, a drip edge along the fascia
      for (const gz of [-0.36, -0.12, 0.12, 0.36]) B.block('std', 0, -OVERPASS.depth, gz * w, Lp + 0.4, OVERPASS.depth - SLAB, 18, CONCRETE_DARK, null, { surf: S, noAO: true });
    } else {
      // retaining walls down into the ground: panels with joints, a coping under the parapet
      const zHigh = Math.max(z0 + (z1 - z0) * t0, z0 + (z1 - z0) * t1);
      const hWall = zHigh + 30;
      for (const sd of [-1, 1]) {
        B.block('std', 0, -hWall - SLAB, sd * (w / 2 - 5), Lp + 0.4, hWall, 10, PANEL, null, { surf: [DET.slab, 0.88, 0] });
      }
    }
    // parapets, open where a ramp joins or a wreck broke through
    const sA = s0 + len * t0, sB = s0 + len * t1;
    for (const sd of [-1, 1]) {
      let spans = [[sA, sB]];
      for (const c of cut) {
        if (c.side !== sd) continue;
        const next = [];
        for (const [u, v] of spans) {
          if (c.s1 <= u || c.s0 >= v) { next.push([u, v]); continue; }
          if (c.s0 > u) next.push([u, c.s0]);
          if (c.s1 < v) next.push([c.s1, v]);
        }
        spans = next;
      }
      const k0 = Math.cos(slope);
      for (const [u, v] of spans) {
        if (v - u < 4) continue;
        const mid = ((u + v) / 2 - (sA + sB) / 2) / k0;
        const lp = (v - u) / k0;
        B.add('std', T.profile('parapet', PARAPET), [mid, 0, sd * (w / 2 - 7)], [1, 1, lp], [0, Math.PI / 2, 0], shadeHex(CONCRETE, 0.1), { surf: S });
        // reflectors every few metres
        for (let s = Math.ceil(u / 90) * 90; s < v; s += 90) {
          B.box('glow', (s - (sA + sB) / 2) / k0, 20, sd * (w / 2 - 10.3), 3, 2, 0.3, '#ffb030', null, { emissive: 1.5, uv: atlasUV('white'), noAO: true });
        }
      }
    }
    // lane paint (a little above the wearing course)
    const dash = (z, color) => {
      for (let s = -Lp / 2 + 20; s < Lp / 2 - 20; s += 92) B.box('std', s + 20, 0.25, z, 40, 0.5, 3, color, null, { surf: [0, 0.5, 0], noAO: true });
    };
    const line = (z, color) => B.box('std', 0, 0.25, z, Lp, 0.5, 3.4, color, null, { surf: [0, 0.5, 0], noAO: true });
    line(-(w / 2 - 22), PAINT);
    line(w / 2 - 22, PAINT);
    if (!ramp) {
      line(-3.5, YELLOW);
      line(3.5, YELLOW);
      dash(-w / 4 + 2, PAINT);
      dash(w / 4 - 2, PAINT);
    }
    // deck lamps on the parapets, alternating sides; some bulbs are out
    if (!ramp) {
      const side = k % 2 ? 1 : -1;
      const s = (sA + sB) / 2;
      const inCut = cut.some((c) => c.side === side && s > c.s0 - 20 && s < c.s1 + 20);
      if (!inCut) {
        const lit = hash01(di * 131 + k * 17 + 5) > 0.3;
        const la = a + (side > 0 ? -Math.PI / 2 : Math.PI / 2);   // the arm reaches over the road
        // lampPost stands its pole 16 behind the frame's origin: put the pole on the parapet
        const off = w / 2 - 7 - 16;
        const lx = cx - Math.sin(a) * side * off, ly = cy + Math.cos(a) * side * off;
        B.obj(lx, ly, la, di * 53 + k * 3 + 2, cz + OVERPASS.parapet);
        const head = lampPost(B, { s: 0.8 }, lit, '#ffc978');
        if (head) fx.halos.push({ x: lx + Math.cos(la) * head.x, y: ly + Math.sin(la) * head.x, h: cz + OVERPASS.parapet + head.h, color: '#ffc978', size: 120, strength: 0.75 });
      }
    }
  }
}

function buildBent(B, map, b, i) {
  const z = deckHeightAt(map, b.x, b.y) || b.z;
  const capTop = z - OVERPASS.depth, capBottom = capTop - OVERPASS.cap;
  const P = OVERPASS.pier;
  const ca = Math.cos(b.a), sa = Math.sin(b.a);
  const S = [DET.concrete, 0.9, 0];
  for (const s of [-1, 1]) {
    const px = b.x + ca * s * b.span / 2, py = b.y + sa * s * b.span / 2;
    B.obj(px, py, b.a, 700 + i * 2 + (s > 0 ? 1 : 0));
    B.setJitter(0.04);
    B.rblock('std', 0, 0, 0, P + 12, 6, P + 12, 1.5, CONCRETE_DARK, null, { surf: S });
    B.rblock('std', 0, 0, 0, P, capBottom + 2, P, 5, CONCRETE, null, { surf: S });
    // a flared capital into the cap beam
    B.rblock('std', 0, capBottom - 14, 0, P + 10, 16, P + 6, 3, CONCRETE, null, { surf: S });
    // hazard markers facing the traffic under the deck (it runs along the bent's x)
    for (const f of [-1, 1]) {
      B.add('glow', T.plane(), [f * (P / 2 + 0.35), 34, 0], [P - 6, 30, 1], [0, f * Math.PI / 2, 0], '#ffffff', { uv: atlasUV('stripeYB'), emissive: 0.4, noAO: true });
    }
  }
  // cap beam across the deck, bearing pads on it
  B.obj(b.x, b.y, b.a, 760 + i);
  B.rblock('std', 0, capBottom, 0, b.span + P + 36, OVERPASS.cap, 34, 3, CONCRETE, null, { surf: S });
  for (const gz of [-0.36, -0.12, 0.12, 0.36]) B.block('std', gz * (b.span + 80), capTop - 3, 0, 20, 3, 18, '#2b2b2b', null, { surf: [DET.rubber, 0.9, 0] });
  // a streak of water stains down the columns
  B.box('std', 0, capBottom - 0.6, 0, b.span + P + 36, 1.2, 35, shadeHex(CONCRETE_DARK, -0.2), null, { surf: S, noAO: true });
}

function buildDeckVehicle(B, map, v, i) {
  const z = deckHeightAt(map, v.x, v.y, 20);
  const o = { ...v, id: 5000 + i };
  B.obj(v.x, v.y, v.a, 3000 + i * 13, z, v.pitch || v.roll ? [v.roll || 0, v.pitch || 0] : null);
  B.setJitter(0.06);
  if (v.kind === 'semi') {
    if (v.w <= 100) buildSemiCab(B, o); else buildTrailer(B, o);
  } else {
    buildVehicle(B, o);
  }
  // shattered parapet chunks under a wreck that went through
  if (v.pitch || v.roll) {
    B.obj(v.x, v.y, v.a, 3100 + i, z);
    const r = B.rng;
    for (let k = 0; k < 7; k++) {
      const sz = r.range(4, 10);
      B.add('std', T.dodeca(), [r.range(-30, 10), sz * 0.3, r.range(-26, 26)], [sz * 1.4, sz, sz], [r.range(0, 1), r.range(0, 6), 0], shadeHex(CONCRETE, r.range(-0.15, 0.1)), { surf: [DET.concrete, 0.9, 0] });
    }
  }
}

function buildSign(B, map, s, i) {
  const z = deckHeightAt(map, s.x, s.y, 20);
  if (!(z > 0)) return;
  // local +z faces the way the sign reads (s.a); +x runs along the fascia
  B.obj(s.x + Math.cos(s.a) * 8, s.y + Math.sin(s.a) * 8, s.a - Math.PI / 2, 4200 + i, z);
  const W = s.w, Hs = W * 0.375;
  const y0 = -8;
  B.box('std', 0, y0 + Hs / 2, -2, W + 6, Hs + 6, 4, '#3f4447', null, { surf: [DET.rust, 0.5, 0.8] });
  for (const x of [-W * 0.3, W * 0.3]) B.box('std', x, y0 - 6, -6, 4, 14, 8, '#4a4f53', null, { surf: [DET.rust, 0.5, 0.8] });
  B.add('glow', T.plane(), [0, y0 + Hs / 2, 0.3], [W, Hs, 1], null, '#ffffff', { emissive: 0.55, uv: atlasUV('gantry'), noAO: true });
  // two sign lights under it, one dead
  for (const [k, x] of [[0, -W * 0.25], [1, W * 0.25]]) {
    B.box('std', x, y0 - 3, 8, 10, 4, 6, '#2a2c2e', null, { surf: [DET.panel, 0.5, 0.5] });
    if (hash01(i * 7 + k) > 0.4) B.box('glow', x, y0 - 5.2, 8, 8, 0.4, 4, '#e8f0ff', null, { emissive: 3, uv: atlasUV('white') });
  }
}
