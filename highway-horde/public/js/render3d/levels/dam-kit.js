// The modelling kit of agent C3's level art (Blackwater Dam, the Rail Yard, Fort Harlan): the extra
// buckets and their materials (the C3 sign atlas lit, emissive and blended), frames at absolute
// heights on the terrain, pictures, free quads and sloped walls, railings, lamps, canyon rock faces with
// their tops and pines, and the stair shafts that climb the terrain flights of the layout.
//
// Everything writes through the world's geo builder `B` (world-geo.js). Local frame of an object: +x
// along its facing, +y up, +z to its right (sim +y at a = 0). A frame placed with `at(...)` has its
// local y = 0 at an absolute height (the terrain under a frame would otherwise lift it).

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01, seededRng } from '../world-geo.js';
import { DET } from '../world-surf.js';
import { atlasUV } from '../world-tex.js';
import { rod, plank } from '../dress-kit.js';
import { canopy } from '../world-veg.js';
import { c3UV, c3Aspect, makeC3Texture } from './dam-atlas.js';

export { T, shadeHex, mixHex, hash01, seededRng, DET, atlasUV, rod, plank, c3UV, c3Aspect };

/** The extra geo-builder buckets of the C3 levels (world.js merges them via levels/index.js). */
export const C3_BUCKETS = {
  c3sign: { uv: true },            // lit, alpha-tested atlas pictures: signs, plaques, stencils, papers
  c3glow: { uv: true, ao: false }, // unlit atlas pictures: screens, exit signs, indicator lamps
  c3stain: { uv: true },           // blended atlas decals: blood, graffiti, rust and water streaks
};

/**
 * The materials of the C3 buckets (one atlas texture per renderer).
 * @param {object} deps level art deps (aniso, day)
 */
export function createC3Materials(deps) {
  const tex = makeC3Texture(deps.aniso || 8);
  const glowK = deps.day ? 0.55 : 1;
  const stainOpts = { vertexColors: true, map: tex, transparent: true, depthWrite: false, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, map: tex });
  glow.color.setScalar(glowK);
  const hi = {
    c3sign: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, roughness: 0.72, metalness: 0.05, envMapIntensity: 0.6 }),
    c3glow: glow,
    c3stain: new THREE.MeshStandardMaterial({ ...stainOpts, roughness: 0.85, metalness: 0, envMapIntensity: 0.3 }),
  };
  const low = {
    c3sign: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, alphaTest: 0.5 }),
    c3glow: glow,
    c3stain: new THREE.MeshLambertMaterial(stainOpts),
  };
  return {
    tex,
    material(bucket, t) { return (t === 'low' ? low : hi)[bucket] || null; },
    dispose() {
      for (const m of new Set([...Object.values(hi), ...Object.values(low)])) m.dispose();
      tex.dispose();
    },
  };
}

// ---- surfaces and palette ------------------------------------------------------------------------------

/** Surface shorthand: detail layer, roughness, metalness. */
export const S = (layer = 0, rough = 0.8, metal = 0) => ({ surf: [layer, rough, metal] });
export const CONC = S(DET.concrete, 0.9, 0);
export const SLAB = S(DET.slab, 0.88, 0);
export const RUST = S(DET.rust, 0.6, 0.65);
export const STEEL = S(DET.panel, 0.45, 0.7);
export const PAINTED = S(DET.panel, 0.55, 0.25);
export const PLASTER = S(DET.plaster, 0.85, 0);
export const WOOD = S(DET.wood, 0.85, 0);
export const CORR = S(DET.corrugated, 0.5, 0.55);
export const ROCK = S(DET.rock, 0.9, 0);
export const GLASS_S = S(DET.glass, 0.12, 0.3);

export const COL = {
  conc: '#9a968c', concD: '#7c786f', concL: '#b4afa4', concW: '#6e6a62', asph: '#3a3a3c',
  steel: '#6a7076', steelD: '#3e4246', rust: '#7a4a30', yellow: '#d8a21c', red: '#a8261c', green: '#3a5a44',
  bronze: '#8a6a3a', glass: '#1a2228', paintG: '#56706a', cream: '#d8d0bc', black: '#1c1c1e',
};

// ---- frames ------------------------------------------------------------------------------------------------

/**
 * Place the object frame at sim (x, y) with its local y = 0 at the absolute height h (default: the
 * ground there), facing sim angle a. `gy` is the terrain height function (deps.gy).
 */
export function at(B, gy, x, y, h = null, a = 0, seed = 0) {
  const g = gy(x, y);
  B.obj(x, y, a, seed, h === null ? 0 : h - g);
  return B;
}

/** Local → world (sim) point of an obstacle-like frame {x, y, a}. */
export function toWorld(o, lx, lz) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
}

// ---- pictures ----------------------------------------------------------------------------------------------

/**
 * An atlas picture on a vertical plane facing local +z rotated by `ry` about y (0 faces +z, PI/2 faces +x).
 * Height `h`; the width follows the cell's aspect unless o.w is given.
 */
export function pic(B, cell, x, y, z, h, ry = 0, o = {}) {
  const w = o.w || h * c3Aspect(cell);
  const bucket = o.bucket || (cell.startsWith('e_') ? 'c3glow' : cell.startsWith('d_') ? 'c3stain' : 'c3sign');
  B.add(bucket, T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry, o.rz || 0], o.color || '#ffffff', { uv: c3UV(cell), noAO: true, noJitter: true, emissive: o.k });
}

/** A picture lying on the ground (or any horizontal surface) at height y, rotated `rot` about y. */
export function flatPic(B, cell, x, y, z, w, d, rot = 0, o = {}) {
  const bucket = o.bucket || (cell.startsWith('d_') ? 'c3stain' : 'c3sign');
  B.add(bucket, T.plane(), [x, y, z], [w, d, 1], [-Math.PI / 2, rot, 0], o.color || '#ffffff', { uv: c3UV(cell), noAO: true, noJitter: true });
}

/** A sign plate on a backing board with a frame (facing local +z after ry). */
export function signBoard(B, cell, x, y, z, h, ry = 0, o = {}) {
  const w = h * c3Aspect(cell);
  const d = o.depth ?? 1.6;
  B.add('std', T.box(), [x - Math.sin(ry) * d / 2, y, z - Math.cos(ry) * d / 2], [w + 1.2, h + 1.2, d], [0, ry, 0], o.back || '#4a4e52', STEEL);
  pic(B, cell, x + Math.sin(ry) * 0.12, y, z + Math.cos(ry) * 0.12, h, ry, o);
}

/** A sign on one or two posts standing on the ground at (x, z), facing local +z after ry. */
export function postSign(B, cell, x, z, h, y0, ry = 0, o = {}) {
  const w = h * c3Aspect(cell);
  const posts = o.posts ?? (w > 60 ? 2 : 1);
  for (let k = 0; k < posts; k++) {
    const off = posts === 1 ? 0 : (k ? 1 : -1) * w * 0.32;
    const px = x + Math.cos(ry) * off, pz = z - Math.sin(ry) * off;
    B.cyl('std', px - Math.sin(ry) * 1.8, 0, pz - Math.cos(ry) * 1.8, 1.6, y0 + h, o.post || '#8a8e92', 8, 1, null, STEEL);
  }
  signBoard(B, cell, x, y0 + h / 2, z, h, ry, o);
}

// ---- free geometry -----------------------------------------------------------------------------------------

/** A one-off geometry from triangles given as flat [x,y,z, ...] positions (normals from the winding). */
export function triGeo(pos, uv = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * A quad through four local points a, b, c, d (in order, counter-clockwise seen from the front), as two
 * triangles in the current frame. Any shape (sloped walls, ramps, gable ends).
 */
export function quad4(B, bucket, a, b, c, d, color, o = null) {
  B.add(bucket, triGeo([...a, ...b, ...c, ...a, ...c, ...d]), [0, 0, 0], [1, 1, 1], null, color, o);
}

/** A thick sloped slab between two x positions: bottom y0/y1 at x0/x1, `th` thick, spanning z0..z1. */
export function slopedSlab(B, bucket, x0, x1, y0, y1, th, z0, z1, color, o = null) {
  const p = [];
  const v = (x, y, z) => [x, y, z];
  const A = v(x0, y0, z0), Bb = v(x1, y1, z0), Cc = v(x1, y1, z1), D = v(x0, y0, z1);
  const A2 = v(x0, y0 + th, z0), B2 = v(x1, y1 + th, z0), C2 = v(x1, y1 + th, z1), D2 = v(x0, y0 + th, z1);
  const face = (a, b, c, d) => p.push(...a, ...b, ...c, ...a, ...c, ...d);
  face(A2, D2, C2, B2);   // top
  face(A, Bb, Cc, D);     // bottom
  face(A, A2, B2, Bb);    // z0 side
  face(D, Cc, C2, D2);    // z1 side
  face(A, D, D2, A2);     // x0 end
  face(Bb, B2, C2, Cc);   // x1 end
  B.add(bucket, triGeo(p), [0, 0, 0], [1, 1, 1], null, color, o);
}

/** A wall panel between local x0 and x1 along z = zc (thickness t), bottom y0a/y0b and top y1a/y1b at the ends (a sloped wall). */
export function slopedWall(B, bucket, x0, x1, zc, t, y0a, y0b, y1a, y1b, color, o = null) {
  const z0 = zc - t / 2, z1 = zc + t / 2;
  const p = [];
  const face = (a, b, c, d) => p.push(...a, ...b, ...c, ...a, ...c, ...d);
  face([x0, y0a, z1], [x1, y0b, z1], [x1, y1b, z1], [x0, y1a, z1]);
  face([x1, y0b, z0], [x0, y0a, z0], [x0, y1a, z0], [x1, y1b, z0]);
  face([x0, y1a, z1], [x1, y1b, z1], [x1, y1b, z0], [x0, y1a, z0]);
  face([x0, y0a, z0], [x0, y0a, z1], [x0, y1a, z1], [x0, y1a, z0]);
  face([x1, y0b, z1], [x1, y0b, z0], [x1, y1b, z0], [x1, y1b, z1]);
  B.add(bucket, triGeo(p), [0, 0, 0], [1, 1, 1], null, color, o);
}

// ---- railings, lamps ------------------------------------------------------------------------------------------

/** A pipe railing from local (x0, z0) to (x1, z1) standing on y0: posts, a top rail and a mid rail. */
export function railing(B, x0, z0, x1, z1, y0 = 0, h = 36, color = COL.yellow, o = {}) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / (o.step || 48)));
  const sf = o.surf || PAINTED;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    B.cyl('std', x0 + (x1 - x0) * t, y0, z0 + (z1 - z0) * t, o.post || 1.2, h, color, 6, 1, null, sf);
  }
  rod(B, 'std', [x0, y0 + h, z0], [x1, y0 + h, z1], o.rail || 1.3, color, sf, 6);
  if (o.mid !== false) rod(B, 'std', [x0, y0 + h * 0.52, z0], [x1, y0 + h * 0.52, z1], 0.9, color, sf, 5);
  if (o.kick) B.add('std', T.box(), [(x0 + x1) / 2, y0 + 2.5, (z0 + z1) / 2], [len, 5, 0.8], [0, -Math.atan2(z1 - z0, x1 - x0), 0], color, sf);
}

/** An emissive light source (a lens/bulb box) with a halo in world space: (wx, wy) sim position, y the height. */
let KIT_DAY = false;
/** By day a lamp's flicker is dropped from its halo (the world shows flickering halos by day as fires). */
export function setKitDay(day) { KIT_DAY = !!day; }
const flick = (f) => (KIT_DAY ? 0 : f || 0);

export function lampGlow(B, halos, lx, y, lz, wx, wy, color, o = {}) {
  const sz = o.size || [6, 2, 6];
  B.add('glow', o.shape === 'sphere' ? T.sphere(6, 4) : T.box(), [lx, y, lz], o.shape === 'sphere' ? [sz[0], sz[0], sz[0]] : sz, o.rot || null, color, { emissive: o.k ?? 4, uv: atlasUV('white'), noAO: true, noJitter: true });
  if (halos && (o.halo ?? 60) > 0) halos.push({ x: wx, y: wy, h: y + (o.y0 || 0), abs: true, color, size: o.halo ?? 60, strength: o.strength ?? 0.5, flicker: flick(o.flicker), blink: o.blink || 0 });
}

/** A caged bulkhead lamp on a wall facing local +z at (x, y, z). */
export function bulkhead(B, halos, x, y, z, wx, wy, color = '#ffc070', o = {}) {
  B.rbox('std', x, y, z + 2, 10, 6, 4, 1, '#3a3c3e', null, STEEL);
  B.add('glow', T.sphere(6, 4), [x, y, z + 4.2], [3.6, 2.4, 2], null, color, { emissive: o.k ?? 3.6, uv: atlasUV('white'), noAO: true, noJitter: true });
  for (const dx of [-3, 0, 3]) rod(B, 'std', [x + dx, y - 3, z + 5.6], [x + dx, y + 3, z + 5.6], 0.3, '#2a2a2c', STEEL, 4);
  if (halos && wx !== undefined) halos.push({ x: wx, y: wy, h: y + (o.y0 || 0), abs: true, color, size: o.halo ?? 44, strength: o.strength ?? 0.45, flicker: flick(o.flicker) });
}

/** A fluorescent tube fixture hanging at y (length along local x). */
export function tubeLamp(B, halos, x, y, z, len, wx, wy, o = {}) {
  B.box('std', x, y + 2.2, z, len + 4, 2.4, 9, '#c8ccd0', null, PAINTED);
  const lit = o.lit !== false;
  B.box(lit ? 'glow' : 'std', x, y + 0.6, z, len, 1.2, 6, lit ? (o.color || '#eef4ff') : '#8a8e92', null, lit ? { emissive: o.k ?? 3.2, uv: atlasUV('white'), noAO: true, noJitter: true } : PAINTED);
  if (o.hang) for (const dx of [-len * 0.4, len * 0.4]) rod(B, 'std', [x + dx, y + 3, z], [x + dx, y + 3 + o.hang, z], 0.3, '#2a2a2c', STEEL, 4);
  if (lit && halos && wx !== undefined) halos.push({ x: wx, y: wy, h: y + (o.y0 || 0), abs: true, color: o.color || '#eef4ff', size: o.halo ?? 50, strength: o.strength ?? 0.35, flicker: flick(o.flicker) });
}

// ---- noise ---------------------------------------------------------------------------------------------------

function h2(ix, iy, s) {
  return hash01((Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(s, 83492791)) | 0);
}

/** Value noise 0..1 on a lattice of unit cells. */
export function vnoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, s), b = h2(ix + 1, iy, s), c = h2(ix, iy + 1, s), d = h2(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal value noise, roughly 0..1. */
export function fbm(x, y, s = 0, oct = 4) {
  let v = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x, y, s + i * 17) * amp;
    tot += amp;
    x *= 2.03; y *= 2.03; amp *= 0.5;
  }
  return v / tot;
}

// ---- canyon rock faces -----------------------------------------------------------------------------------------

const ROCK_BANDS = ['#6f6558', '#7c7062', '#655c52', '#857868', '#5e574f', '#746a5c', '#8a7e6c', '#6a6156'];

/**
 * The canyon walls of a level (map.levelArt.cliffs): each polyline becomes a displaced rock face of its
 * height (ledges, fissures, bulges, strata in bands of colour), leaning back as it rises, with a rough top
 * that runs back from the rim and pines along it.
 * @param {object} B geo builder
 * @param {function} gy terrain height
 * @param {object[]} cliffs [{ pts, h, side, seed, rough }]
 * @param {string} tier 'low' | 'high' | 'ultra' | 'cinematic'
 */
export function rockFaces(B, gy, cliffs, tier, o = {}) {
  const du = tier === 'low' ? 64 : tier === 'high' ? 34 : tier === 'ultra' ? 22 : 15;
  const dv = tier === 'low' ? 80 : tier === 'high' ? 40 : tier === 'ultra' ? 26 : 18;
  let treeN = 0;
  for (const c of cliffs) {
    const pts = c.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 10) continue;
      const tx = (bx - ax) / L, ty = (by - ay) / L;
      // into the rock: away from the walkable side (left of travel is (ty, -tx) in sim space)
      const bkx = -c.side * ty, bky = c.side * tx;
      const ext = 40;
      const len = L + ext * 2;
      const nu = Math.max(2, Math.ceil(len / du)), nv = Math.max(3, Math.ceil(c.h / dv));
      const midX = (ax + bx) / 2, midY = (ay + by) / 2;
      const base = gy(ax, ay);
      const seed = (c.seed * 131 + i * 17) | 0;
      at(B, gy, midX, midY, 0, 0, seed);
      // grid of (u, v) → world position, relative to the frame
      const P = new Float32Array((nu + 1) * (nv + 1) * 3);
      const topH = new Float32Array(nu + 1);
      const dTop = new Float32Array(nu + 1);
      for (let iu = 0; iu <= nu; iu++) {
        const u = -ext + (iu / nu) * len;
        const gu = (u + i * 977 + c.seed * 331) / 1;
        const ht = c.h * (0.86 + 0.26 * fbm(gu / 420, 3.1, seed)) + base;
        topH[iu] = ht;
        for (let iv = 0; iv <= nv; iv++) {
          const f = iv / nv;
          const vv = base + (ht - base) * f;
          const hh = vv - base;
          let d = hh * 0.1;                                                     // the face leans back
          d += 55 * (fbm(gu / 300, hh / 260, seed + 1) - 0.5) * (c.rough ?? 1);   // bulges and bays
          const led = (hh / 46 + 0.35 * fbm(gu / 180, 0.5, seed + 2)) % 1;     // ledges (strata)
          d += 14 * Math.max(0, (led - 0.72) / 0.28) ** 2;
          d += 9 * (fbm(gu / 48, hh / 38, seed + 3) - 0.5);                     // roughness
          const fis = Math.abs(Math.sin(gu / 83 + fbm(gu / 200, hh / 300, seed + 4) * 5));
          d += 22 * Math.pow(1 - fis, 10);                                       // vertical fissures
          // the foot never steps out over the walkable ground, the rim rounds off
          if (hh < 70) d = Math.max(0, Math.min(d, 18 + hh * 0.2));
          else d = Math.max(4, d);
          if (f > 0.93) d += (f - 0.93) * 900;
          const wx = ax + tx * u + bkx * d, wy = ay + ty * u + bky * d;
          const k = (iu * (nv + 1) + iv) * 3;
          P[k] = wx - midX; P[k + 1] = vv; P[k + 2] = wy - midY;
          if (iv === nv) dTop[iu] = d;
        }
      }
      // bands of rows, each its own colour (strata)
      const rowsPer = Math.max(1, Math.round(90 / dv));
      for (let r0 = 0, band = 0; r0 < nv; r0 += rowsPer, band++) {
        const r1 = Math.min(nv, r0 + rowsPer);
        const pos = [];
        for (let iu = 0; iu < nu; iu++) {
          for (let iv = r0; iv < r1; iv++) {
            const k00 = (iu * (nv + 1) + iv) * 3, k10 = ((iu + 1) * (nv + 1) + iv) * 3, k01 = (iu * (nv + 1) + iv + 1) * 3, k11 = ((iu + 1) * (nv + 1) + iv + 1) * 3;
            // wind toward the walkable side
            if (c.side > 0) pos.push(P[k00], P[k00 + 1], P[k00 + 2], P[k01], P[k01 + 1], P[k01 + 2], P[k10], P[k10 + 1], P[k10 + 2], P[k10], P[k10 + 1], P[k10 + 2], P[k01], P[k01 + 1], P[k01 + 2], P[k11], P[k11 + 1], P[k11 + 2]);
            else pos.push(P[k00], P[k00 + 1], P[k00 + 2], P[k10], P[k10 + 1], P[k10 + 2], P[k01], P[k01 + 1], P[k01 + 2], P[k10], P[k10 + 1], P[k10 + 2], P[k11], P[k11 + 1], P[k11 + 2], P[k01], P[k01 + 1], P[k01 + 2]);
          }
        }
        const hFrac = (r0 + 0.5) / nv;
        let col = ROCK_BANDS[(band * 3 + seed) % ROCK_BANDS.length];
        if (hFrac < 0.12) col = mixHex(col, '#3e3a30', 0.35);                  // wet, dark foot
        else if (hFrac > 0.85) col = mixHex(col, '#8c8470', 0.25);             // bleached rim
        B.add('std', smoothGeo(pos), [0, 0, 0], [1, 1, 1], null, col, { surf: [hFrac > 0.4 ? DET.strata : DET.rock, 0.9, 0] });
      }
      // the top: a rough strip running back from the rim, and pines on it
      const back = o.back ?? 700;
      const pos = [];
      const rows = 3;
      const TP = [];
      for (let iu = 0; iu <= nu; iu++) {
        const u = -ext + (iu / nu) * len;
        const col = [];
        for (let r = 0; r <= rows; r++) {
          const d = dTop[iu] + (r / rows) * back;
          const hh = topH[iu] + (r > 0 ? 20 + 60 * fbm(u / 160, r * 0.7, seed + 9) : 0);
          col.push([ax + tx * u + bkx * d - midX, hh, ay + ty * u + bky * d - midY]);
        }
        TP.push(col);
      }
      for (let iu = 0; iu < nu; iu++) {
        for (let r = 0; r < rows; r++) {
          const a = TP[iu][r], b = TP[iu + 1][r], cc = TP[iu + 1][r + 1], d = TP[iu][r + 1];
          if (c.side > 0) pos.push(...a, ...d, ...b, ...b, ...d, ...cc);
          else pos.push(...a, ...b, ...d, ...b, ...cc, ...d);
        }
      }
      B.add('std', smoothGeo(pos), [0, 0, 0], [1, 1, 1], null, '#5a5a44', { surf: [DET.dirt, 0.95, 0] });
      // pines and boulders along the rim (not on 'low')
      if (tier !== 'low' && o.trees !== false) {
        const step = tier === 'high' ? 170 : 120;
        for (let u = 30; u < L - 30; u += step * (0.6 + hash01(seed + u) * 0.8)) {
          const iu = Math.min(nu, Math.round(((u + ext) / len) * nu));
          const d = dTop[iu] + 40 + hash01(seed * 3 + u) * (back * 0.8);
          const wx = ax + tx * u + bkx * d, wy = ay + ty * u + bky * d;
          const hh = topH[iu] + 30;
          const s = 0.8 + hash01(seed + u * 7) * 0.7;
          at(B, gy, wx, wy, hh - 6, hash01(u) * 6.28, seed + u);
          B.cyl('std', 0, -10, 0, 5 * s, 90 * s, '#3a2c20', 7, 0.5, null, S(DET.bark, 0.9, 0));
          canopy(B, { x: wx, y: wy, a: 0, s }, 7 + (treeN++ % 40) * 13);
        }
        at(B, gy, midX, midY, 0, 0, seed);
      }
    }
  }
}

/** Non-indexed triangles with smooth normals (vertices at the same position share their normal). */
function smoothGeo(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = pos.length / 3;
  const nor = new Float32Array(pos.length);
  const acc = new Map();
  const key = (i) => `${Math.round(pos[i * 3] * 4)},${Math.round(pos[i * 3 + 1] * 4)},${Math.round(pos[i * 3 + 2] * 4)}`;
  for (let t = 0; t < n; t += 3) {
    const ax = pos[t * 3], ay = pos[t * 3 + 1], az = pos[t * 3 + 2];
    const ux = pos[t * 3 + 3] - ax, uy = pos[t * 3 + 4] - ay, uz = pos[t * 3 + 5] - az;
    const vx = pos[t * 3 + 6] - ax, vy = pos[t * 3 + 7] - ay, vz = pos[t * 3 + 8] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) {
      const kk = key(t + k);
      const e = acc.get(kk);
      if (e) { e[0] += nx; e[1] += ny; e[2] += nz; } else acc.set(kk, [nx, ny, nz]);
    }
  }
  for (let i = 0; i < n; i++) {
    const e = acc.get(key(i));
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    nor[i * 3] = e[0] / l; nor[i * 3 + 1] = e[1] / l; nor[i * 3 + 2] = e[2] / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

export { smoothGeo };

// ---- stair shafts ---------------------------------------------------------------------------------------------

/**
 * A stair shaft over a terrain flight (shared/levels/dam.js stairFlight): concrete treads with steel
 * nosings over the height field's steps, the two side walls (inside and out) and a sloped ceiling and
 * roof, handrails and caged lamps. `o.open` leaves the roof and outer walls off (a stair under a canopy).
 * @param {object} fl flight { x0, y0, x1, y1, up, h0, h1, n }
 */
export function stairShaft(B, gy, halos, fl, o = {}) {
  const alongY = fl.up === 'n' || fl.up === 's';
  // a frame at the foot of the flight, facing up the stairs
  const a = fl.up === 'n' ? -Math.PI / 2 : fl.up === 's' ? Math.PI / 2 : fl.up === 'e' ? 0 : Math.PI;
  const run = alongY ? fl.y1 - fl.y0 : fl.x1 - fl.x0;
  const wid = alongY ? fl.x1 - fl.x0 : fl.y1 - fl.y0;
  const cx = (fl.x0 + fl.x1) / 2, cy = (fl.y0 + fl.y1) / 2;
  // the foot: the end the flight climbs away from
  const fx = fl.up === 'e' ? fl.x0 : fl.up === 'w' ? fl.x1 : cx;
  const fy = fl.up === 's' ? fl.y0 : fl.up === 'n' ? fl.y1 : cy;
  at(B, gy, fx, fy, fl.h0, a, o.seed || 11);
  const n = fl.n, tr = run / n, rise = (fl.h1 - fl.h0) / n;
  const hw = wid / 2;
  const concCol = o.color || COL.conc;
  // treads (local +x up the flight, z across)
  for (let k = 0; k < n; k++) {
    const top = rise * (k + 1);
    B.box('std', tr * (k + 0.5), top - 7, 0, tr + 0.4, 14, wid, shadeHex(concCol, (k % 2) * 0.03 - 0.04), null, { ...CONC, noJitter: true });
    B.box('std', tr * k + 1.2, top + 0.2, 0, 2.4, 0.8, wid - 4, o.nosing || '#b8a040', null, STEEL);
  }
  const H = o.ceil ?? 160;
  const Wt = o.wall ?? 20;
  const L = run;
  const y0a = -2, y0b = fl.h1 - fl.h0 - 2;
  // side walls (the flight's own lane walls are the obstacles: draw them inside and out)
  for (const s of [-1, 1]) {
    const zc = s * (hw + Wt / 2);
    // (down to the ground under the flight: the terrain's stepped wedge must not show beside it)
    const ya = o.toGround === false ? y0a - 60 : -fl.h0 - 2, yb = o.toGround === false ? y0b - 60 : -fl.h0 - 2;
    slopedWall(B, 'std', -30, L + 30, zc, Wt, ya, yb, H + 10, fl.h1 - fl.h0 + H + 10, o.wallCol || COL.concD, { ...CONC, noJitter: true });
    // a dado of paint and a handrail on the inside face
    slopedWall(B, 'std', -30, L + 30, s * (hw - 0.6), 1, 0, fl.h1 - fl.h0, 40, fl.h1 - fl.h0 + 40, o.dado || '#5a6a62', { ...PAINTED, noJitter: true });
    rod(B, 'std', [0, 36, s * (hw - 5)], [L, fl.h1 - fl.h0 + 36, s * (hw - 5)], 1.3, '#c8a030', PAINTED, 6);
    for (let k = 0; k <= Math.floor(L / 90); k++) {
      const x = k * 90, y = (x / L) * (fl.h1 - fl.h0);
      rod(B, 'std', [x, y + 36, s * (hw - 5)], [x, y + 36, s * (hw - 0.6)], 0.8, '#c8a030', PAINTED, 5);
    }
  }
  // the ceiling (inside) and the roof over it
  slopedSlab(B, 'std', -30, L + 30, H, fl.h1 - fl.h0 + H, 12, -hw - Wt, hw + Wt, o.ceilCol || '#8a867c', { ...CONC, noJitter: true });
  // lamps every 140 of run on alternating walls
  for (let x = 60, k = 0; x < L; x += 140, k++) {
    const y = (x / L) * (fl.h1 - fl.h0) + H - 30;
    const s = k % 2 ? -1 : 1;
    const c = Math.cos(a), sn = Math.sin(a);
    const wx = fx + x * c - s * (hw - 4) * sn, wy = fy + x * sn + s * (hw - 4) * c;
    B.rbox('std', x, y, s * (hw - 2), 10, 6, 4, 1, '#3a3c3e', null, STEEL);
    B.add('glow', T.sphere(6, 4), [x, y, s * (hw - 4.4)], [3.6, 2.4, 2], null, o.lamp || '#ffb050', { emissive: 3.4, uv: atlasUV('white'), noAO: true, noJitter: true });
    if (halos) halos.push({ x: wx, y: wy, h: y + fl.h0, color: o.lamp || '#ffb050', size: 46, strength: 0.4, flicker: flick(k % 3 === 1 ? 0.4 : 0), base: fl.h0 + (x / L) * (fl.h1 - fl.h0) });
  }
  return { a, fx, fy, L, hw, H };
}
