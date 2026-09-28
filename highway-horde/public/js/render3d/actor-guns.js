// Detailed procedural guns, one model per weapons.js `sprite.style` (coloured from
// sprite.color / sprite.accent), shared by the first-person viewmodel, the teammates'
// held weapons and the weapon crates. Parts are real shapes, not box stacks: side
// profiles extruded with bevelled edges (slides, frames, stocks, curved magazines, trigger
// guards), rounded boxes (receivers, optics), lathed barrels and muzzle devices, rails,
// sights with glowing dots and glinting lenses, wood furniture. Moving assemblies (slide
// or bolt, magazine, pump, cylinder, drum, break-open barrels, spinning barrels, bow
// string, warhead...) are separate geometries with pivots so the viewmodel can animate
// them. All gun parts share ONE PBR material: a per-vertex surface class (blued steel,
// anodised alloy, polymer, wood, rubber, brass, glass, paint) selects a tile of a
// procedural atlas (actor-tex.js: brushed/scratched metal, stippled polymer, wood grain,
// knurling — normal + roughness + albedo) and a per-vertex edge-wear value lets bare
// metal show through on edges.
//
// Gun space: +X toward the muzzle, +Y up, +Z to the right; the origin is where the firing
// hand wraps the grip. Units are world units (1 ≈ 3 cm), a rifle is ~34 long.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS } from '../shared/weapons.js';
import { shadeHex, mixHex } from './actor-kit.js';
import { gunAtlasTexture } from './actor-tex.js';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

/** Surface classes (per vertex, select roughness/metalness/atlas tile). */
export const GM = { STEEL: 0, ALLOY: 1, POLY: 2, WOOD: 3, RUBBER: 4, BRASS: 5, LENS: 6, PAINT: 7 };

const STEEL = '#35393e', DARK = '#1b1c1e', BLUED = '#23262b', BRASS = '#c9a24a', RUBBER = '#161616', COPPER = '#b8683a';

// sprite.len (top-down pixels) → 3D length; small guns are drawn oversized top-down
const LEN_SCALE = {
  pistol: 0.62, revolver: 0.62, double: 1.0, smg: 0.8, dual: 0.72, shotgun: 0.98, rifle: 0.95,
  crossbow: 0.9, dmr: 0.95, sniper: 0.92, autoshotgun: 0.95, flamethrower: 0.95, lmg: 0.92,
  launcher: 0.9, rocket: 0.95, tesla: 0.95, minigun: 0.85, railgun: 0.9,
};

// ---------------------------------------------------------------------------------------
// builder

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _s = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();

// Third-person guns (teammates, crates) are built 'lite': fewer segments, no rail teeth,
// serrations or vent slots, and every part merged into one mesh (the spinning barrels
// excepted) — one draw call per gun instead of five, ~40 % of the triangles.
let LITE = false;
const segs = (n) => (LITE ? Math.max(6, Math.round(n * 0.5)) : n);

/** Accumulates transformed primitives into named parts (each: solid + glow geometry). */
class GunBuilder {
  constructor() { this.parts = new Map(); }

  _bucket(part, glow) {
    if (LITE && part !== 'spin') part = 'body';
    const key = part + (glow ? ':glow' : '');
    let b = this.parts.get(key);
    if (!b) { b = { pos: [], nor: [], uv: [], col: [], gun: [], idx: [] }; this.parts.set(key, b); }
    return b;
  }

  /**
   * @param {THREE.BufferGeometry} g (disposed here)
   * @param {object} o { part, glow, at, rot, scale, color, mat, wear, tile, matrix }
   */
  add(g, o = {}) {
    const b = this._bucket(o.part || 'body', !!o.glow);
    if (o.matrix) _m.copy(o.matrix);
    else {
      _q.setFromEuler(_e.set(...(o.rot || [0, 0, 0]), o.order || 'XYZ'));
      const s = o.scale || [1, 1, 1];
      _m.compose(_v.set(...(o.at || [0, 0, 0])), _q, _s.set(s[0], s[1], s[2]));
    }
    _nm.getNormalMatrix(_m);
    const P = g.attributes.position, N = g.attributes.normal;
    const base = b.pos.length / 3;
    _c.set(o.color || '#888888');
    const mat = o.mat ?? GM.STEEL;
    const wearK = o.wear ?? 1;
    const tile = o.tile || 3.2;
    const woodGrain = mat === GM.WOOD;
    for (let i = 0; i < P.count; i++) {
      _n.fromBufferAttribute(N, i);
      // edge wear from the part-local normal: bevels and rounded edges are neither
      // axis-aligned nor flat, so they catch it (cylinders get a little everywhere)
      const edge = 1 - Math.max(Math.abs(_n.x), Math.abs(_n.y), Math.abs(_n.z));
      const wear = Math.min(1, (o.round ? 0.12 : Math.max(0, (edge - 0.04) * 3.2)) * wearK);
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      _n.applyMatrix3(_nm).normalize();
      b.pos.push(_v.x, _v.y, _v.z);
      b.nor.push(_n.x, _n.y, _n.z);
      // box projection by the dominant normal (wood grain always runs along the gun)
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
      let u, v;
      if (woodGrain) { u = _v.x / tile * 0.35; v = (ay > az ? _v.z : _v.y) / tile; } else if (ax >= ay && ax >= az) { u = _v.z / tile; v = _v.y / tile; } else if (ay >= az) { u = _v.x / tile; v = _v.z / tile; } else { u = _v.x / tile; v = _v.y / tile; }
      b.uv.push(u, v);
      b.col.push(_c.r, _c.g, _c.b);
      b.gun.push(mat, wear);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) b.idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < P.count; i++) b.idx.push(i + base);
    g.dispose();
    return this;
  }

  build() {
    const out = {};
    for (const [key, b] of this.parts) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute('aGun', new THREE.Float32BufferAttribute(b.gun, 2));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      out[key] = g;
    }
    return out;
  }
}

/** Shape from a point list: [x,y] line, [cx,cy,x,y] quadratic, [c1x,c1y,c2x,c2y,x,y] bezier. */
function shapeOf(pts, Cls = THREE.Shape) {
  const s = new Cls();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 2) s.lineTo(p[0], p[1]);
    else if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else s.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  return s;
}

// primitive helpers (all in gun space)
function ext(gb, pts, z0, z1, o = {}) {
  const shape = shapeOf(pts);
  if (o.holes) for (const h of o.holes) shape.holes.push(shapeOf(h, THREE.Path));
  const bev = o.bevel ?? 0.12;
  const depth = Math.max(0.01, z1 - z0 - bev * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * (o.bevelSize ?? 0.8), bevelSegments: LITE ? 1 : o.bevelSeg ?? 2, curveSegments: LITE ? 4 : o.curve ?? 8 });
  g.translate(0, 0, z0 + bev);
  gb.add(g, o);
}
function rbox(gb, x0, x1, y0, y1, z0, z1, r, o = {}) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  // lite: tiny detail boxes are skipped; rounded boxes lose their bevel segments
  if (LITE && (o.detail || (w < 0.6 && h < 0.6) || (w < 0.6 && d < 0.6) || (h < 0.6 && d < 0.6))) return;
  const g = rr > 0.02 ? new RoundedBoxGeometry(w, h, d, LITE ? 1 : o.seg ?? 2, rr) : new THREE.BoxGeometry(w, h, d);
  gb.add(g, { ...o, at: [(x0 + x1) / 2 + (o.at ? o.at[0] : 0), (y0 + y1) / 2 + (o.at ? o.at[1] : 0), (z0 + z1) / 2 + (o.at ? o.at[2] : 0)] });
}
/** Cylinder along X from x0 to x1 at (y, z); r0 at x0, r1 at x1. */
function cylX(gb, x0, x1, y, z, r0, r1 = r0, o = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, x1 - x0, segs(o.seg ?? 16), 1, !!o.open);
  g.rotateZ(-HALF_PI);
  g.translate((x0 + x1) / 2, y, z);
  gb.add(g, { round: true, ...o });
}
/** Lathe along X: profile [[x, r], ...] at (y, z). */
function latheX(gb, profile, y, z, o = {}) {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(0.0001, r), x));
  const g = new THREE.LatheGeometry(pts, segs(o.seg ?? 18));
  g.rotateZ(-HALF_PI);
  g.translate(0, y, z);
  gb.add(g, { round: true, ...o });
}
function sphere(gb, x, y, z, r, o = {}) {
  const sg = segs(o.seg ?? 10);
  const g = new THREE.SphereGeometry(r, sg, Math.max(4, sg * 0.6 | 0));
  g.translate(x, y, z);
  gb.add(g, { round: true, ...o });
}
function torusX(gb, x, y, z, R, r, o = {}) {
  const g = new THREE.TorusGeometry(R, r, LITE ? 5 : o.seg2 ?? 8, segs(o.seg ?? 20), o.arc ?? TAU);
  g.rotateY(HALF_PI);
  g.translate(x, y, z);
  gb.add(g, { round: true, ...o });
}
/** Tube through points [[x,y,z]...] (hoses, belts, wires). */
function tubePath(gb, pts, r, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, segs(o.seg ?? pts.length * 6), r, LITE ? 5 : o.radial ?? 8, false);
  gb.add(g, { round: true, ...o });
}
/** Picatinny rail along X on top at height y. */
function rail(gb, x0, x1, y, z, w, o = {}) {
  rbox(gb, x0, x1, y, y + (LITE ? 0.34 : 0.22), z - w / 2, z + w / 2, 0.05, { color: DARK, mat: GM.ALLOY, ...o });
  if (LITE) return;
  const n = Math.max(2, Math.floor((x1 - x0) / 0.52));
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.18 + i * ((x1 - x0 - 0.36) / (n - 1));
    rbox(gb, x - 0.15, x + 0.15, y + 0.2, y + 0.36, z - w / 2 - 0.06, z + w / 2 + 0.06, 0.04, { color: DARK, mat: GM.ALLOY, ...o, seg: 1 });
  }
}
/** Trigger + guard with a real hole. */
function triggerGroup(gb, x, y = 0, color = DARK, o = {}) {
  ext(gb, [[x - 0.4, y + 0.1], [x + 2.9, y + 0.1], [x + 2.9, y - 0.2], [x + 2.4, y - 1.55], [x + 0.9, y - 1.7], [x - 0.2, y - 1.3], [x - 0.4, y - 0.2]], -0.32, 0.32,
    { color, mat: GM.STEEL, bevel: 0.08, holes: [[[x + 0.05, y - 0.15], [x + 2.45, y - 0.15], [x + 2.1, y - 1.25], [x + 0.9, y - 1.35], [x + 0.2, y - 1.05]]], ...o });
  ext(gb, [[x + 1.0, y + 0.05], [x + 1.35, y + 0.05], [x + 1.2, y - 0.5], [x + 0.95, y - 1.05], [x + 0.75, y - 1.0], [x + 0.95, y - 0.5]], -0.14, 0.14, { color: STEEL, mat: GM.STEEL, bevel: 0.04, ...o });
}
/** Pistol grip, raked back, with a knurled panel. */
function pistolGrip(gb, x, color, o = {}) {
  const h = o.h ?? 3.9, rake = o.rake ?? 0.9, w = o.w ?? 0.62, top = o.top ?? 0.2;
  ext(gb, [[x - 0.9, top], [x + 1.1, top], [x + 0.95, top - 0.8], [x + 0.9 - rake * 0.6, top - h * 0.55], [x + 0.75 - rake, top - h], [x - 1.3 - rake, top - h], [x - 1.2 - rake, top - h + 0.4],
    [x - 1.0 - rake * 0.5, top - h * 0.5], [x - 1.1, top - 0.6]], -w, w, { color, mat: o.mat ?? GM.RUBBER, bevel: 0.2, bevelSeg: 3, ...o });
}
/** Glow dot (iron sight inserts, indicators). */
function dot(gb, x, y, z, r, color, part) {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.translate(x, y, z);
  gb.add(g, { glow: true, color, part: part || 'body', round: true });
}

// ---------------------------------------------------------------------------------------
// models

const cache = new Map();

/**
 * Model description for one weapon (cached per id; callers must not dispose geometries).
 * @param {string} weaponId
 */
export function gunModel(weaponId, lite = false) {
  const id = WEAPONS[weaponId] ? weaponId : 'pistol';
  const key = lite ? id + ':lite' : id;
  let m = cache.get(key);
  if (!m) {
    LITE = lite;
    try { m = build(id); } finally { LITE = false; }
    m.lite = lite;
    cache.set(key, m);
  }
  return m;
}

function build(id) {
  const w = WEAPONS[id];
  const sp = w.sprite;
  const style = sp.style;
  const L = sp.len * (LEN_SCALE[style] || 0.9);
  const gb = new GunBuilder();
  const out = {
    id, style, length: L, muzzle: [L, 1.5, 0], front: [L * 0.55, 0.6, 0], eject: [3, 2, 0.8], magwell: [2.5, -1, 0],
    dual: style === 'dual', glowColor: sp.accent, heavy: false, twoHanded: true, reload: 'mag',
    pivots: {}, travel: { slide: 0, bolt: 0 }, casing: 'rifle',
  };
  const B = BUILDERS[style] || BUILDERS.pistol;
  B(gb, L, sp, out, w);
  const geos = gb.build();
  out.geos = geos;
  out.partNames = [...new Set(Object.keys(geos).map((k) => k.split(':')[0]))];
  return out;
}

const BUILDERS = {};

// ---- pistol (M9-ish) ------------------------------------------------------------------
BUILDERS.pistol = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  // frame: dust cover + trigger guard + grip
  ext(gb, [[-1.5, 0.62], [L * 0.78, 0.62], [L * 0.8, 0.2], [L * 0.62, -0.15], [2.9, -0.15], [2.6, 0.05], [-1.3, 0.05]], -0.58, 0.58, { color: shadeHex(col, 0.06), mat: GM.ALLOY });
  triggerGroup(gb, 0.1, 0.05, shadeHex(col, 0.06), { mat: GM.ALLOY });
  pistolGrip(gb, -0.1, acc, { h: 4.0, rake: 0.8, w: 0.66, top: 0.2 });
  rbox(gb, -1.3, 0.45, -3.5, -0.4, 0.55, 0.72, 0.1, { color: shadeHex(acc, 0.12), mat: GM.RUBBER });        // grip panel
  rbox(gb, -1.3, 0.45, -3.5, -0.4, -0.72, -0.55, 0.1, { color: shadeHex(acc, 0.12), mat: GM.RUBBER });
  // slide (recoils)
  const S = { part: 'slide' };
  ext(gb, [[-1.7, 0.62], [L - 0.35, 0.62], [L - 0.2, 0.9], [L - 0.35, 1.95], [-1.4, 1.95], [-1.75, 1.6]], -0.64, 0.64, { ...S, color: col, mat: GM.STEEL, bevel: 0.14 });
  for (let k = 0; k < 7; k++) {                                                                      // rear serrations
    const x = -1.3 + k * 0.3;
    for (const z of [-0.66, 0.66]) rbox(gb, x, x + 0.13, 0.8, 1.8, z - 0.04, z + 0.04, 0.02, { ...S, color: shadeHex(col, -0.3), mat: GM.STEEL, seg: 1 });
  }
  rbox(gb, 1.2, 3.8, 1.25, 1.96, 0.5, 0.67, 0.06, { ...S, color: '#0c0c0c', mat: GM.STEEL });           // ejection port
  rbox(gb, 1.35, 3.6, 1.3, 1.85, 0.3, 0.55, 0.05, { ...S, color: BRASS, mat: GM.BRASS });                 // barrel hood
  rbox(gb, L - 1.2, L - 0.7, 1.95, 2.35, -0.14, 0.14, 0.05, { ...S, color: DARK });                       // front sight
  rbox(gb, -1.4, -0.9, 1.95, 2.4, -0.45, 0.45, 0.06, { ...S, color: DARK });                              // rear sight
  rbox(gb, -1.2, -0.7, 1.4, 1.75, 0.64, 0.84, 0.06, { ...S, color: DARK });                              // decocker
  cylX(gb, L - 0.5, L - 0.18, 1.25, 0, 0.36, 0.36, { ...S, color: '#101010' });                          // muzzle crown
  cylX(gb, L - 0.2, L - 0.16, 1.25, 0, 0.22, 0.22, { ...S, color: '#030303' });
  dot(gb, L - 0.95, 2.35, 0, 0.11, '#6dff8a', 'slide');
  dot(gb, -1.15, 2.4, -0.3, 0.1, '#6dff8a', 'slide');
  dot(gb, -1.15, 2.4, 0.3, 0.1, '#6dff8a', 'slide');
  // hammer + slide stop
  ext(gb, [[-1.5, 0.7], [-1.35, 1.5], [-1.9, 1.75], [-2.05, 1.5], [-1.8, 0.8]], -0.22, 0.22, { part: 'hammer', color: DARK, bevel: 0.05 });
  rbox(gb, 0.4, 2.2, 0.35, 0.62, 0.58, 0.72, 0.05, { color: DARK });
  // magazine (in the grip, base plate showing)
  const M = { part: 'mag' };
  rbox(gb, -1.75, 0.2, -3.6, -0.6, -0.42, 0.42, 0.12, { ...M, color: '#2a2a2a', mat: GM.STEEL, at: [-0.3, 0, 0] });
  rbox(gb, -2.35, -0.05, -4.2, -3.7, -0.58, 0.58, 0.14, { ...M, color: shadeHex(acc, 0.05), mat: GM.POLY });
  out.pivots.hammer = [-1.6, 0.8, 0];
  out.muzzle = [L - 0.15, 1.25, 0];
  out.front = [0.2, -2.2, -1.2];
  out.eject = [2.4, 1.95, 0.6];
  out.magwell = [-0.8, -3.9, 0];
  out.twoHanded = false;
  out.glowColor = '#6dff8a';
  out.travel.slide = 1.6;
  out.casing = 'pistol';
};

// ---- revolver ---------------------------------------------------------------------------
BUILDERS.revolver = (gb, L, sp, out) => {
  const col = sp.color, wood = sp.accent;
  // frame with the cylinder window
  ext(gb, [[-1.2, -0.25], [0.95, -0.25], [0.95, 0.55], [3.75, 0.55], [3.75, -0.1], [4.3, -0.1], [4.3, 2.3], [-0.4, 2.3], [-1.2, 1.6]], -0.62, 0.62,
    { color: col, mat: GM.STEEL, holes: [[[1.0, 0.65], [3.65, 0.65], [3.65, 2.1], [1.0, 2.1]]] });
  triggerGroup(gb, -0.3, -0.2, col);
  // wooden bird's-head grip with checkering panel
  ext(gb, [[-1.3, 0.1], [0.5, 0.1], [0.3, -1.4], [-0.1, -3.5], [-0.7, -4.1], [-1.9, -3.9], [-2.1, -3.0], [-1.7, -1.0], [-1.8, 0.4]], -0.7, 0.7, { color: wood, mat: GM.WOOD, bevel: 0.25, bevelSeg: 3 });
  rbox(gb, -1.5, 0.0, -3.2, -0.6, 0.66, 0.78, 0.1, { color: shadeHex(wood, -0.15), mat: GM.RUBBER });
  rbox(gb, -1.5, 0.0, -3.2, -0.6, -0.78, -0.66, 0.1, { color: shadeHex(wood, -0.15), mat: GM.RUBBER });
  // barrel: heavy with an underlug and a ventilated top rib
  cylX(gb, 4.2, L, 1.45, 0, 0.55, 0.52, { color: col, mat: GM.STEEL, seg: 20 });
  rbox(gb, 4.2, L - 0.1, 0.5, 1.45, -0.46, 0.46, 0.22, { color: col, mat: GM.STEEL });
  rbox(gb, 4.1, L - 0.1, 1.85, 2.25, -0.3, 0.3, 0.08, { color: shadeHex(col, 0.08), mat: GM.STEEL });
  for (let x = 5; x < L - 1; x += 1.1) rbox(gb, x, x + 0.5, 1.95, 2.28, -0.31, 0.31, 0.04, { color: '#101010', seg: 1 });
  rbox(gb, L - 1.0, L - 0.2, 2.2, 2.75, -0.13, 0.13, 0.05, { color: '#c62828', mat: GM.PAINT });           // red ramp
  cylX(gb, L - 0.05, L + 0.01, 1.45, 0, 0.32, 0.32, { color: '#050505' });
  rbox(gb, -0.9, 0.2, 2.25, 2.45, -0.35, 0.35, 0.05, { color: DARK });                                      // rear sight notch
  // cylinder (rotates; swings out on reload)
  const C = { part: 'cyl' };
  latheX(gb, [[0.95, 0], [0.95, 1.0], [1.05, 1.15], [3.55, 1.15], [3.65, 1.02], [3.65, 0]], 1.2, 0, { ...C, color: shadeHex(col, -0.05), mat: GM.STEEL, seg: 24 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.PI / 6;
    rbox(gb, 1.6, 3.2, -0.14, 0.14, -0.2, 0.2, 0.08, { ...C, color: '#15171a', at: [0, 1.2 + Math.sin(a) * 1.13, Math.cos(a) * 1.13], seg: 1 });
    cylX(gb, 3.62, 3.68, 1.2 + Math.sin(a + Math.PI / 6) * 0.7, Math.cos(a + Math.PI / 6) * 0.7, 0.26, 0.26, { ...C, color: BRASS, mat: GM.BRASS, seg: 10 });
  }
  cylX(gb, 3.65, 4.25, 0.72, 0, 0.18, 0.18, { ...C, color: col });                                         // ejector rod
  // hammer (cocks back)
  ext(gb, [[-0.4, 1.3], [0.1, 2.0], [-0.3, 2.4], [-1.3, 2.9], [-1.5, 2.6], [-0.9, 2.1], [-0.9, 1.4]], -0.26, 0.26, { part: 'hammer', color: DARK, bevel: 0.06 });
  out.pivots.cyl = [2.3, 1.2, 0];
  out.pivots.crane = [2.3, 0.3, -0.6];
  out.pivots.hammer = [-0.6, 1.3, 0];
  out.muzzle = [L, 1.45, 0];
  out.front = [0.2, -2.2, -1.3];
  out.twoHanded = false;
  out.reload = 'cylinder';
  out.casing = 'pistol';
};

// ---- sawed-off double barrel -----------------------------------------------------------
BUILDERS.double = (gb, L, sp, out) => {
  const wood = sp.color === '#3b2a1e' ? '#6b4526' : sp.color, steel = '#5a5e62';
  rbox(gb, -0.9, 3.3, 0.0, 2.3, -1.05, 1.05, 0.35, { color: steel, mat: GM.STEEL });                      // receiver
  rbox(gb, -0.4, 2.8, 0.4, 1.9, -1.1, 1.1, 0.2, { color: shadeHex(steel, 0.12), mat: GM.STEEL, wear: 2 }); // engraved side plates
  ext(gb, [[-0.8, 2.0], [-3.2, 1.6], [-4.3, 0.2], [-4.4, -1.3], [-3.1, -3.9], [-1.6, -3.8], [-1.0, -1.2], [-0.2, -0.3], [0.2, 0.1]], -0.78, 0.78, { color: wood, mat: GM.WOOD, bevel: 0.3, bevelSeg: 3 });
  triggerGroup(gb, 0.1, 0.05, steel);
  rbox(gb, 1.9, 2.2, -0.9, 0.05, -0.12, 0.12, 0.05, { color: STEEL });                                      // 2nd trigger
  for (const z of [-0.45, 0.45]) ext(gb, [[-0.4, 1.9], [0.0, 2.1], [-0.3, 2.9], [-1.0, 3.1], [-1.1, 2.8], [-0.6, 2.4]], z - 0.16, z + 0.16, { part: 'hammer', color: DARK, bevel: 0.05 });
  rbox(gb, -0.3, 1.2, 2.25, 2.5, -0.25, 0.25, 0.08, { color: STEEL });                                      // top lever
  // barrels + forend (break open about the hinge)
  const Bk = { part: 'barrels' };
  for (const z of [-0.64, 0.64]) {
    cylX(gb, 3.2, L, 1.35, z, 0.66, 0.64, { ...Bk, color: '#3a3d40', mat: GM.STEEL, seg: 20 });
    cylX(gb, L - 0.05, L + 0.01, 1.35, z, 0.5, 0.5, { ...Bk, color: '#040404', seg: 14 });
    cylX(gb, 3.1, 3.25, 1.35, z, 0.5, 0.5, { ...Bk, color: '#050505', seg: 14 });
  }
  rbox(gb, 3.3, L - 0.2, 1.9, 2.15, -0.25, 0.25, 0.06, { ...Bk, color: '#2e3134' });                         // rib
  sphere(gb, L - 0.5, 2.25, 0, 0.12, { ...Bk, color: BRASS, mat: GM.BRASS });
  ext(gb, [[3.4, 1.0], [L * 0.64, 1.0], [L * 0.66, 0.6], [L * 0.6, -0.35], [3.6, -0.35], [3.3, 0.2]], -0.98, 0.98, { ...Bk, color: wood, mat: GM.WOOD, bevel: 0.28, bevelSeg: 3 });
  out.pivots.barrels = [3.2, 0.1, 0];
  out.pivots.hammer = [-0.4, 1.9, 0];
  out.muzzle = [L, 1.35, 0];
  out.front = [L * 0.45, -0.3, 0];
  out.reload = 'break';
  out.casing = 'shell';
};

// ---- SMG / dual machine pistols ---------------------------------------------------------
function smgBody(gb, L, col, acc, dual) {
  rbox(gb, -1.9, L * 0.6, 0.15, 2.2, -0.82, 0.82, 0.32, { color: col, mat: GM.STEEL });                    // receiver
  rbox(gb, L * 0.02, L * 0.5, 0.7, 1.1, 0.8, 0.9, 0.08, { color: '#0c0c0c' });                            // ejection port
  if (dual) rbox(gb, -1.5, L * 0.55, 0.9, 1.2, -0.86, 0.86, 0.1, { color: acc, mat: GM.BRASS });          // gold inlay
  // handguard with vents
  rbox(gb, L * 0.5, L * 0.78, 0.05, 1.95, -0.9, 0.9, 0.4, { color: shadeHex(col, 0.1), mat: GM.POLY });
  for (let k = 0; k < 4; k++) rbox(gb, L * 0.54 + k * 0.9, L * 0.54 + k * 0.9 + 0.45, 0.6, 1.5, -0.93, 0.93, 0.12, { color: '#070707', seg: 1 });
  cylX(gb, L * 0.78, L - 0.6, 1.15, 0, 0.36, 0.36, { color: STEEL, seg: 14 });
  latheX(gb, [[L - 0.8, 0], [L - 0.8, 0.5], [L - 0.2, 0.55], [L, 0.45], [L, 0]], 1.15, 0, { color: DARK, seg: 14 });
  cylX(gb, L - 0.02, L + 0.02, 1.15, 0, 0.22, 0.22, { color: '#030303', seg: 10 });
  // sights
  ext(gb, [[-1.6, 2.2], [-0.4, 2.2], [-0.5, 2.9], [-1.5, 2.9]], -0.5, 0.5, { color: DARK, bevel: 0.08, holes: [[[-1.3, 2.4], [-0.7, 2.4], [-0.75, 2.7], [-1.25, 2.7]]] });
  ext(gb, [[L * 0.62, 2.2], [L * 0.7, 2.2], [L * 0.69, 3.0], [L * 0.63, 3.0]], -0.45, 0.45, { color: DARK, bevel: 0.06, holes: [[[L * 0.64, 2.35], [L * 0.68, 2.35], [L * 0.675, 2.8], [L * 0.645, 2.8]]] });
  rbox(gb, L * 0.65, L * 0.665, 2.2, 2.75, -0.05, 0.05, 0.01, { color: STEEL, seg: 1 });
  // cocking handle (bolt) on the left, forward
  rbox(gb, L * 0.36, L * 0.46, 1.7, 2.05, -1.25, -0.8, 0.1, { part: 'bolt', color: DARK });
  triggerGroup(gb, 0.1, 0.15, col);
  pistolGrip(gb, -0.1, shadeHex(col, -0.05), { h: 3.4, rake: 0.5, w: 0.62, top: 0.3, mat: GM.POLY });
}
BUILDERS.smg = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  smgBody(gb, L, col, acc, false);
  // curved magazine ahead of the trigger
  const M = { part: 'mag' };
  ext(gb, [[2.9, 0.3], [4.3, 0.3], [4.45, -1.5], [4.9, -4.7], [3.6, -5.0], [3.1, -1.6]], -0.52, 0.52, { ...M, color: '#1d1d1d', mat: GM.STEEL, bevel: 0.1 });
  rbox(gb, 3.35, 5.2, -5.3, -4.8, -0.6, 0.6, 0.12, { ...M, color: '#141414', mat: GM.POLY, rot: [0, 0, 0.1] });
  rbox(gb, 2.6, 4.6, -0.2, 0.3, -0.72, 0.72, 0.12, { color: col, mat: GM.STEEL });                          // mag well
  // collapsible wire stock
  for (const z of [-0.55, 0.55]) cylX(gb, -7.2, -1.8, 1.55, z, 0.2, 0.2, { color: DARK, seg: 8 });
  rbox(gb, -7.6, -7.0, -0.9, 2.1, -0.75, 0.75, 0.25, { color: DARK, mat: GM.RUBBER });
  out.muzzle = [L, 1.15, 0];
  out.front = [L * 0.6, -0.05, 0];
  out.magwell = [3.6, -0.3, 0];
  out.eject = [L * 0.25, 1.2, 0.9];
  out.travel.bolt = 1.2;
  out.casing = 'pistol';
};
BUILDERS.dual = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  smgBody(gb, L, col, acc, true);
  const M = { part: 'mag' };
  rbox(gb, -1.5, 0.3, -5.8, -0.4, -0.45, 0.45, 0.12, { ...M, color: '#1a1a1a', mat: GM.STEEL, rot: [0, 0, 0.12] });
  rbox(gb, -2.2, 0.3, -6.2, -5.7, -0.55, 0.55, 0.14, { ...M, color: acc, mat: GM.BRASS, rot: [0, 0, 0.12] });
  out.muzzle = [L, 1.15, 0];
  out.front = [0.3, -2, -1];
  out.magwell = [-0.6, -5.8, 0];
  out.eject = [L * 0.25, 1.2, 0.9];
  out.twoHanded = false;
  out.travel.bolt = 1.0;
  out.casing = 'pistol';
};

// ---- pump / auto shotgun ----------------------------------------------------------------
BUILDERS.shotgun = (gb, L, sp, out) => {
  const wood = '#7a4f2c', steel = '#2a2c30';
  ext(gb, [[-1.1, 0.0], [6.6, 0.0], [6.6, 2.35], [0.4, 2.45], [-1.1, 2.0]], -0.95, 0.95, { color: steel, mat: GM.STEEL, bevel: 0.2 });   // receiver
  rbox(gb, 1.0, 4.4, 1.1, 2.2, 0.85, 1.0, 0.08, { color: '#080808' });                                       // ejection port
  rbox(gb, 1.2, 4.2, -0.05, 0.2, -0.55, 0.55, 0.05, { color: '#090909' });                                    // loading port
  cylX(gb, 6.4, L, 1.75, 0, 0.6, 0.58, { color: steel, mat: GM.STEEL, seg: 20 });                            // barrel
  cylX(gb, L - 0.04, L + 0.01, 1.75, 0, 0.45, 0.45, { color: '#030303', seg: 14 });
  rbox(gb, 6.6, L - 0.3, 2.3, 2.45, -0.2, 0.2, 0.04, { color: DARK });                                         // vent rib
  for (let x = 7; x < L - 0.6; x += 1.4) rbox(gb, x, x + 0.25, 2.2, 2.35, -0.12, 0.12, 0.02, { color: DARK, seg: 1 });
  sphere(gb, L - 0.35, 2.58, 0, 0.14, { color: BRASS, mat: GM.BRASS });
  cylX(gb, 6.4, L - 2.4, 0.72, 0, 0.5, 0.5, { color: '#25272a', mat: GM.STEEL, seg: 16 });                     // mag tube
  latheX(gb, [[L - 2.45, 0], [L - 2.45, 0.56], [L - 1.9, 0.56], [L - 1.75, 0.4], [L - 1.75, 0]], 0.72, 0, { color: STEEL, seg: 16 });
  rbox(gb, L - 2.4, L - 1.4, 0.6, 1.9, -0.25, 0.25, 0.1, { color: steel });                                    // barrel clamp
  // pump forend (ribbed wood)
  const Pm = { part: 'pump' };
  latheX(gb, [[L * 0.4, 0], [L * 0.4, 0.8], [L * 0.41, 0.95], [L * 0.63, 0.95], [L * 0.64, 0.8], [L * 0.64, 0]], 0.72, 0, { ...Pm, color: wood, mat: GM.WOOD, seg: 18, scale: [1, 1, 1] });
  for (let k = 0; k < 7; k++) torusX(gb, L * 0.43 + k * (L * 0.028), 0.72, 0, 0.95, 0.09, { ...Pm, color: shadeHex(wood, -0.25), mat: GM.WOOD, seg: 18 });
  // stock with pistol-grip wrist and recoil pad
  ext(gb, [[-0.9, 2.1], [-4, 1.95], [-11.6, 1.55], [-11.9, -2.5], [-8.5, -1.9], [-4.4, -1.1], [-2.9, -2.9], [-1.6, -3.0], [-1.0, -1.0], [-0.3, -0.1]], -0.9, 0.9, { color: wood, mat: GM.WOOD, bevel: 0.35, bevelSeg: 3 });
  rbox(gb, -12.6, -11.7, -2.55, 1.6, -0.95, 0.95, 0.3, { color: RUBBER, mat: GM.RUBBER });
  triggerGroup(gb, 0.1, 0.05, steel);
  out.muzzle = [L, 1.75, 0];
  out.front = [L * 0.52, 0.0, 0];
  out.eject = [2.7, 1.8, 1.0];
  out.magwell = [2.7, -0.1, 0];
  out.reload = 'shells';
  out.casing = 'shell';
  out.pivots.pump = [0, 0, 0];
};
BUILDERS.autoshotgun = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  rbox(gb, -1.5, 7.5, -0.1, 2.6, -1.05, 1.05, 0.3, { color: col, mat: GM.STEEL });                             // receiver
  rbox(gb, 7.3, L - 1.4, 0.45, 2.55, -1.15, 1.15, 0.35, { color: acc, mat: GM.STEEL });                       // shroud
  for (let k = 0; k < 6; k++) rbox(gb, 8.2 + k * 2.4, 9.3 + k * 2.4, 1.2, 1.9, -1.2, 1.2, 0.18, { color: '#070707', seg: 1 });
  latheX(gb, [[L - 1.6, 0], [L - 1.6, 0.85], [L, 0.85], [L, 0]], 1.5, 0, { color: DARK, seg: 16 });           // muzzle brake
  for (let k = 0; k < 3; k++) rbox(gb, L - 1.4 + k * 0.45, L - 1.2 + k * 0.45, 1.1, 1.9, -0.95, 0.95, 0.05, { color: '#050505', seg: 1 });
  rail(gb, -1.2, 7.2, 2.6, 0, 1.2);
  ext(gb, [[0.5, 3.1], [6.2, 3.1], [6.6, 4.3], [5.5, 4.6], [1.4, 4.6], [0.2, 4.1]], -0.35, 0.35, { color: DARK, holes: [[[1.6, 3.4], [5.4, 3.4], [5.3, 4.1], [1.7, 4.1]]] });  // carry handle
  pistolGrip(gb, -0.1, DARK, { mat: GM.POLY, h: 3.6, rake: 0.7 });
  triggerGroup(gb, 0.1, -0.1, col);
  ext(gb, [[-1.4, 2.4], [-11.8, 2.1], [-12.2, -2.2], [-9.8, -1.8], [-5.2, 0.2], [-1.4, -0.1]], -0.95, 0.95, { color: '#1a1a1a', mat: GM.POLY, bevel: 0.28, holes: [[[-5.5, 1.6], [-9.8, 1.5], [-10.2, -0.9], [-6.2, 0.7]]] });
  rbox(gb, -12.7, -11.8, -2.3, 2.2, -0.98, 0.98, 0.3, { color: RUBBER, mat: GM.RUBBER });
  // drum magazine
  const M = { part: 'mag' };
  const g = new THREE.CylinderGeometry(2.7, 2.7, 1.9, 28);
  gb.add(g, { ...M, at: [3.4, -2.6, 0], rot: [HALF_PI, 0, 0], color: '#262626', mat: GM.POLY, round: true });
  for (const z of [-0.98, 0.98]) gb.add(new THREE.TorusGeometry(2.3, 0.13, 6, 28), { ...M, at: [3.4, -2.6, z], color: '#3a3a3a', mat: GM.POLY, round: true });
  rbox(gb, 2.4, 4.4, -0.8, 0.2, -0.7, 0.7, 0.15, { ...M, color: '#262626', mat: GM.POLY });
  out.muzzle = [L, 1.5, 0];
  out.front = [L * 0.5, 0.35, 0];
  out.magwell = [3.4, -0.6, 0];
  out.eject = [3.5, 2.0, 1.1];
  out.travel.bolt = 0;
  out.casing = 'shell';
};

// ---- AR family ---------------------------------------------------------------------------
function arLower(gb, col, magwellX = 1.9) {
  ext(gb, [[-1.9, 1.15], [5.1, 1.15], [5.1, 0.2], [magwellX + 2.8, -0.9], [magwellX + 2.6, -1.25], [magwellX, -1.25], [magwellX - 0.2, -0.3], [-0.2, -0.3], [-1.9, 0.2]], -0.78, 0.78, { color: col, mat: GM.ALLOY });
  triggerGroup(gb, -0.15, -0.25, col, { mat: GM.ALLOY });
  rbox(gb, magwellX + 0.4, magwellX + 1.2, -0.6, -0.2, 0.75, 0.9, 0.05, { color: DARK });                      // mag release
  rbox(gb, -1.2, -0.4, 0.35, 0.8, 0.75, 0.95, 0.12, { color: DARK });                                          // selector
}
function arUpper(gb, L, col, xEnd) {
  ext(gb, [[-2.3, 1.1], [xEnd, 1.1], [xEnd, 2.35], [-2.3, 2.35]], -0.8, 0.8, { color: col, mat: GM.ALLOY, bevel: 0.14 });
  rail(gb, -2.1, xEnd - 0.2, 2.35, 0, 0.95);
  rbox(gb, 1.3, 4.6, 1.35, 2.15, 0.72, 0.9, 0.06, { color: '#070707' });                                         // ejection port
  rbox(gb, 1.2, 4.7, 1.3, 1.45, 0.78, 0.95, 0.04, { color: col, mat: GM.ALLOY });                                 // dust cover hinge
  cylX(gb, -1.4, -0.6, 1.85, 0.9, 0.28, 0.28, { color: col, mat: GM.ALLOY, seg: 12 });                            // forward assist
  rbox(gb, 0.2, 1.1, 1.3, 2.3, 0.78, 1.15, 0.12, { color: col, mat: GM.ALLOY });                                   // brass deflector
  // charging handle (racks on reload)
  ext(gb, [[-2.35, 2.2], [-2.35, 2.55], [-3.1, 2.55], [-3.1, 2.2]], -0.9, 0.9, { part: 'bolt', color: DARK, bevel: 0.08 });
}
function buffStock(gb, col) {
  cylX(gb, -8.7, -2.2, 1.55, 0, 0.58, 0.58, { color: DARK, mat: GM.ALLOY, seg: 16 });
  ext(gb, [[-6.4, 2.25], [-11.9, 2.4], [-12.2, 1.9], [-12.3, -1.8], [-11.5, -2.0], [-10.8, -0.8], [-9.3, 0.3], [-6.4, 0.9]], -0.72, 0.72, { color: col, mat: GM.POLY, bevel: 0.24, bevelSeg: 3 });
  rbox(gb, -12.9, -12.1, -2.0, 2.45, -0.8, 0.8, 0.28, { color: RUBBER, mat: GM.RUBBER });
  rbox(gb, -9.8, -7.2, 0.5, 0.9, -0.45, 0.45, 0.1, { color: DARK });                                             // adjust lever
}
function stanag(gb, x, curve, color, part = 'mag', len = 5.8) {
  const M = { part };
  ext(gb, [[x, 0.2], [x + 2.3, 0.2], [x + 2.4 + curve * 0.3, -len * 0.4], [x + 2.2 + curve, -len], [x - 0.1 + curve, -len - 0.3], [x - 0.15 + curve * 0.25, -len * 0.45]], -0.56, 0.56,
    { ...M, color, mat: GM.POLY, bevel: 0.12 });
  for (let k = 0; k < 4; k++) {
    const t = 0.25 + k * 0.15;
    rbox(gb, x + curve * t * t + 0.1, x + curve * t * t + 2.1, -len * t - 0.08, -len * t + 0.08, -0.6, 0.6, 0.04, { ...M, color: shadeHex(color, -0.2), mat: GM.POLY, seg: 1 });
  }
  rbox(gb, x - 0.35 + curve, x + 2.5 + curve, -len - 0.65, -len - 0.15, -0.66, 0.66, 0.16, { ...M, color: shadeHex(color, -0.1), mat: GM.POLY, rot: [0, 0, curve * 0.06] });
}
function redDot(gb, x, y, glow = '#ff3a2a') {
  // holographic sight: a low base, a hooded window with a glowing reticle, a battery cap
  rbox(gb, x, x + 2.6, y, y + 0.55, -0.7, 0.7, 0.15, { color: '#202224', mat: GM.POLY });
  ext(gb, [[x + 0.1, y + 0.5], [x + 2.5, y + 0.5], [x + 2.5, y + 1.55], [x + 2.1, y + 1.8], [x + 0.5, y + 1.8], [x + 0.1, y + 1.5]], -0.75, 0.75,
    { color: '#202224', mat: GM.POLY, bevel: 0.1, holes: [[[x + 0.35, y + 0.7], [x + 2.25, y + 0.7], [x + 2.25, y + 1.55], [x + 0.35, y + 1.55]]] });
  rbox(gb, x + 1.2, x + 1.25, y + 0.7, y + 1.55, -0.52, 0.52, 0.01, { color: '#223848', mat: GM.LENS, seg: 1 });
  dot(gb, x + 1.3, y + 1.12, 0, 0.055, glow);
  cylX(gb, x + 0.4, x + 1.2, y + 0.3, 0.85, 0.28, 0.28, { color: '#202224', mat: GM.POLY, seg: 12 });
}
function scope(gb, x0, x1, y, r, o = {}) {
  // body, eyepiece + objective bells, turrets, rings, lens glint
  const L = x1 - x0;
  latheX(gb, [[x0, 0], [x0, r * 1.2], [x0 + L * 0.02, r * 1.3], [x0 + L * 0.16, r * 1.25], [x0 + L * 0.24, r * 0.82], [x0 + L * 0.6, r * 0.82],
    [x0 + L * 0.74, r * 1.45], [x1 - L * 0.02, r * 1.5], [x1, r * 1.38], [x1, 0]], y, 0, { color: '#131517', mat: GM.ALLOY, seg: 24 });
  cylX(gb, x0 + L * 0.38, x0 + L * 0.46, y + r * 1.25, 0, 0.5 * r, 0.5 * r, { color: DARK, rot: [0, 0, 0] });
  const tg = new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 0.9, 14);
  gb.add(tg, { at: [x0 + L * 0.42, y + r * 1.1, 0], color: '#18191b', mat: GM.ALLOY, round: true });
  const tg2 = new THREE.CylinderGeometry(r * 0.4, r * 0.4, r * 0.8, 14);
  gb.add(tg2, { at: [x0 + L * 0.42, y, r * 1.05], rot: [HALF_PI, 0, 0], color: '#18191b', mat: GM.ALLOY, round: true });
  for (const f of [0.28, 0.58]) rbox(gb, x0 + L * f, x0 + L * f + 0.7, y - r * 1.4, y + r * 0.9, -r * 1.05, r * 1.05, 0.15, { color: DARK, mat: GM.ALLOY });
  // lenses: objective glints (glass), eyepiece dark
  const lg = new THREE.CircleGeometry(r * 1.32, 20);
  gb.add(lg, { at: [x1 + 0.01, y, 0], rot: [0, HALF_PI, 0], color: '#1c3a5a', mat: GM.LENS });
  const lg2 = new THREE.CircleGeometry(r * 1.1, 20);
  gb.add(lg2, { at: [x0 - 0.01, y, 0], rot: [0, -HALF_PI, 0], color: '#0a1420', mat: GM.LENS });
  if (o.glint !== false) dot(gb, x1 + 0.02, y + r * 0.4, -r * 0.35, r * 0.18, '#9ad8ff');
}
BUILDERS.rifle = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  arLower(gb, col);
  arUpper(gb, L, col, 10.2);
  // free-float handguard with M-LOK slots and a top rail
  latheX(gb, [[10.0, 0], [10.0, 1.15], [10.3, 1.25], [L * 0.72, 1.25], [L * 0.73, 1.1], [L * 0.73, 0]], 1.35, 0, { color: acc, mat: GM.ALLOY, seg: 8 });
  rail(gb, 10.2, L * 0.72, 2.35, 0, 0.95, { color: shadeHex(acc, -0.2) });
  for (let k = 0; k < 5; k++) {
    const x = 11.4 + k * 2.1;
    for (const z of [-1.2, 1.2]) rbox(gb, x, x + 1.3, 0.95, 1.5, z - 0.1, z + 0.1, 0.1, { color: '#060606', seg: 1 });
    rbox(gb, x, x + 1.3, 0.05, 0.25, -0.3, 0.3, 0.1, { color: '#060606', seg: 1 });
  }
  cylX(gb, L * 0.73, L - 1.6, 1.35, 0, 0.34, 0.32, { color: BLUED, seg: 14 });
  rbox(gb, L * 0.76, L * 0.79, 0.95, 1.85, -0.45, 0.45, 0.1, { color: DARK });                                       // gas block
  latheX(gb, [[L - 1.9, 0], [L - 1.9, 0.52], [L - 0.2, 0.52], [L, 0.44], [L, 0]], 1.35, 0, { color: DARK, seg: 12 }); // flash hider
  for (let k = 0; k < 4; k++) rbox(gb, L - 1.3, L - 0.05, -0.08, 0.08, -0.06, 0.06, 0.01, { color: '#030303', at: [0, 1.35 + Math.sin(k * HALF_PI + 0.78) * 0.5, Math.cos(k * HALF_PI + 0.78) * 0.5], seg: 1 });
  cylX(gb, L - 0.02, L + 0.02, 1.35, 0, 0.26, 0.26, { color: '#020202', seg: 10 });
  redDot(gb, 1.2, 2.9);
  // flip-up front sight on the rail
  ext(gb, [[L * 0.68, 2.85], [L * 0.71, 2.85], [L * 0.705, 3.9], [L * 0.685, 3.9]], -0.45, 0.45, { color: DARK, bevel: 0.05, holes: [[[L * 0.688, 3.05], [L * 0.702, 3.05], [L * 0.7, 3.7], [L * 0.69, 3.7]]] });
  pistolGrip(gb, -0.2, DARK, { mat: GM.POLY, h: 3.7, rake: 1.1, top: -0.1 });
  buffStock(gb, DARK);
  stanag(gb, 2.05, 1.3, '#1d1d1d');
  out.muzzle = [L, 1.35, 0];
  out.front = [L * 0.5, 0.05, 0];
  out.eject = [3.0, 1.8, 1.0];
  out.magwell = [3.2, -1.2, 0];
  out.glowColor = '#ff3a2a';
  out.travel.bolt = 2.4;
};
BUILDERS.dmr = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  arLower(gb, col);
  arUpper(gb, L, col, 10.4);
  latheX(gb, [[10.2, 0], [10.2, 1.2], [10.5, 1.3], [L * 0.66, 1.3], [L * 0.67, 1.1], [L * 0.67, 0]], 1.35, 0, { color: acc, mat: GM.ALLOY, seg: 10 });
  rail(gb, 10.4, L * 0.66, 2.35, 0, 0.95, { color: shadeHex(acc, -0.2) });
  for (let k = 0; k < 6; k++) for (const z of [-1.25, 1.25]) rbox(gb, 11.5 + k * 2.2, 12.8 + k * 2.2, 0.9, 1.6, z - 0.1, z + 0.1, 0.1, { color: '#060606', seg: 1 });
  cylX(gb, L * 0.67, L - 2.0, 1.35, 0, 0.42, 0.38, { color: BLUED, seg: 12 });
  for (let k = 0; k < 6; k++) rbox(gb, L * 0.69, L - 2.4, -0.04, 0.04, -0.04, 0.04, 0.01, { color: '#0a0a0a', at: [0, 1.35 + Math.sin(k * 1.047) * 0.4, Math.cos(k * 1.047) * 0.4], seg: 1 });   // fluting
  rbox(gb, L - 2.2, L - 0.1, 0.75, 1.95, -0.55, 0.55, 0.2, { color: DARK });                                         // compensator
  for (let k = 0; k < 3; k++) rbox(gb, L - 1.9 + k * 0.6, L - 1.6 + k * 0.6, 1.75, 1.97, -0.4, 0.4, 0.04, { color: '#050505', seg: 1 });
  cylX(gb, L - 0.12, L + 0.02, 1.35, 0, 0.26, 0.26, { color: '#020202', seg: 10 });
  scope(gb, -0.8, 11.5, 4.15, 0.78);
  pistolGrip(gb, -0.2, DARK, { mat: GM.POLY, h: 3.7, rake: 1.1, top: -0.1 });
  buffStock(gb, shadeHex(acc, -0.3));
  rbox(gb, -10.6, -6.8, 2.4, 3.0, -0.6, 0.6, 0.2, { color: shadeHex(acc, -0.3), mat: GM.POLY });                    // cheek riser
  stanag(gb, 2.05, 0.3, '#1d1d1d', 'mag', 5.0);
  // folded bipod under the handguard
  for (const z of [-0.5, 0.5]) cylX(gb, L * 0.44, L * 0.63, -0.2, z, 0.16, 0.16, { color: DARK, seg: 8 });
  out.muzzle = [L, 1.35, 0];
  out.front = [L * 0.48, 0.05, 0];
  out.eject = [3.0, 1.8, 1.0];
  out.magwell = [3.1, -1.1, 0];
  out.glowColor = '#9ad8ff';
  out.travel.bolt = 2.4;
};
BUILDERS.sniper = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  // chassis stock with a thumbhole grip, adjustable cheek and butt
  ext(gb, [[-0.6, 1.2], [L * 0.52, 1.2], [L * 0.53, 0.2], [L * 0.5, -0.4], [4.8, -0.5], [4.2, -1.3], [1.8, -1.3], [1.4, -0.4], [0.8, -0.3], [0.9, -3.4], [-0.6, -3.7],
    [-1.9, -3.3], [-2.5, -1.2], [-5.5, -1.6], [-12.6, -2.2], [-12.8, 2.3], [-8.0, 2.2], [-4.2, 1.9], [-2.0, 1.5]], -0.95, 0.95,
  { color: acc, mat: GM.POLY, bevel: 0.3, bevelSeg: 3, holes: [[[-1.6, 1.0], [-3.2, 0.8], [-3.4, -0.4], [-2.2, -0.6], [-1.0, -0.1]]] });
  rbox(gb, -13.5, -12.6, -2.3, 2.4, -1.0, 1.0, 0.3, { color: RUBBER, mat: GM.RUBBER });
  rbox(gb, -10.5, -5.2, 2.2, 2.8, -0.75, 0.75, 0.25, { color: shadeHex(acc, -0.2), mat: GM.POLY });
  // action + heavy fluted barrel + brake
  cylX(gb, -1.8, 8.4, 1.8, 0, 0.95, 0.95, { color: col, mat: GM.STEEL, seg: 20 });
  rbox(gb, 1.2, 4.2, 1.5, 2.55, 0.82, 1.0, 0.08, { color: '#060606' });
  cylX(gb, 8.4, L - 2.6, 1.8, 0, 0.66, 0.52, { color: BLUED, mat: GM.STEEL, seg: 18 });
  for (let k = 0; k < 6; k++) rbox(gb, 9.4, L - 3.6, -0.05, 0.05, -0.05, 0.05, 0.01, { color: '#080808', at: [0, 1.8 + Math.sin(k * 1.047) * 0.55, Math.cos(k * 1.047) * 0.55], seg: 1 });
  rbox(gb, L - 2.8, L - 0.1, 1.05, 2.55, -0.72, 0.72, 0.22, { color: DARK });
  for (let k = 0; k < 3; k++) for (const z of [-0.74, 0.74]) rbox(gb, L - 2.4 + k * 0.8, L - 2.0 + k * 0.8, 1.35, 2.25, z - 0.05, z + 0.05, 0.05, { color: '#030303', seg: 1 });
  cylX(gb, L - 0.12, L + 0.02, 1.8, 0, 0.3, 0.3, { color: '#020202', seg: 10 });
  rail(gb, -1.4, 8.2, 2.6, 0, 0.9);
  scope(gb, -2.4, 12.8, 4.7, 1.0);
  // bolt (cycles after each shot)
  const Bo = { part: 'bolt' };
  cylX(gb, -2.4, -1.6, 1.8, 0, 0.6, 0.6, { ...Bo, color: col, seg: 14 });
  cylX(gb, -1.2, -0.9, 1.8, 0.95, 0.18, 0.18, { ...Bo, color: STEEL, rot: [0, 0, 0], seg: 8 });
  const bh = new THREE.CylinderGeometry(0.16, 0.16, 1.8, 8);
  gb.add(bh, { ...Bo, at: [-1.05, 1.6, 1.8], rot: [HALF_PI - 0.35, 0, 0], color: STEEL, mat: GM.STEEL, round: true });
  sphere(gb, -1.05, 1.28, 2.65, 0.42, { ...Bo, color: '#1a1a1a', mat: GM.POLY });
  triggerGroup(gb, -0.1, -0.35, DARK);
  // box mag + folded bipod
  const M = { part: 'mag' };
  rbox(gb, 1.6, 4.3, -3.2, -0.3, -0.6, 0.6, 0.16, { ...M, color: '#1b1b1b', mat: GM.STEEL });
  for (const z of [-0.55, 0.55]) cylX(gb, L * 0.3, L * 0.48, -0.9, z, 0.18, 0.18, { color: DARK, seg: 8 });
  rbox(gb, L * 0.47, L * 0.52, -1.2, -0.1, -0.7, 0.7, 0.15, { color: DARK });
  out.pivots.bolt = [-1.8, 1.8, 0];
  out.muzzle = [L, 1.8, 0];
  out.front = [L * 0.4, -0.5, 0];
  out.eject = [2.7, 2.2, 1.0];
  out.magwell = [2.9, -1.5, 0];
  out.glowColor = '#9ad8ff';
  out.travel.bolt = 3.2;
  out.boltAction = true;
};

// ---- crossbow ---------------------------------------------------------------------------
BUILDERS.crossbow = (gb, L, sp, out) => {
  const wood = mixHex(sp.color, '#8a5a34', 0.4), metal = '#8f9296';
  ext(gb, [[-0.5, 1.6], [-10.8, 1.3], [-11.2, -2.1], [-8.2, -1.8], [-4.2, -0.9], [-2.6, -3.0], [-1.1, -3.1], [-0.6, -0.8], [0.2, -0.3]], -0.85, 0.85, { color: wood, mat: GM.WOOD, bevel: 0.3, bevelSeg: 3 });
  ext(gb, [[-0.6, 0.3], [L * 0.86, 0.5], [L * 0.87, 1.7], [-0.6, 1.8]], -0.75, 0.75, { color: shadeHex(wood, 0.05), mat: GM.WOOD, bevel: 0.2 });
  rbox(gb, 0, L * 0.84, 1.75, 2.1, -0.32, 0.32, 0.06, { color: metal, mat: GM.STEEL });                          // flight rail
  triggerGroup(gb, 0.1, 0.05, DARK);
  // riser + recurve limbs
  const bx = L * 0.82;
  rbox(gb, bx - 1.4, bx + 0.4, 0.5, 2.6, -1.4, 1.4, 0.3, { color: DARK, mat: GM.ALLOY });
  for (const s of [-1, 1]) {
    tubePath(gb, [[bx, 1.6, s * 1.2], [bx - 0.4, 1.7, s * 3.8], [bx - 1.6, 1.7, s * 6.2], [bx - 1.1, 1.7, s * 7.6]], 0.34, { color: '#2a2d30', mat: GM.POLY, radial: 8, seg: 24 });
    sphere(gb, bx - 1.1, 1.7, s * 7.6, 0.4, { color: DARK, mat: GM.ALLOY });
  }
  // string (drawn back when loaded) and the loaded bolt
  const St = { part: 'string' };
  for (const s of [-1, 1]) tubePath(gb, [[bx - 1.1, 1.95, s * 7.5], [1.2, 1.95, s * 0.15]], 0.07, { ...St, color: '#e0d8c0', mat: GM.RUBBER, radial: 4, seg: 6 });
  const Tp = { part: 'tip' };
  cylX(gb, 1.0, L * 0.98, 2.3, 0, 0.14, 0.14, { ...Tp, color: '#3a3a3a', mat: GM.ALLOY, seg: 8 });
  latheX(gb, [[L * 0.98, 0.0], [L * 0.98, 0.35], [L * 0.98 + 1.4, 0]], 2.3, 0, { ...Tp, color: '#c8ccd0', mat: GM.STEEL, seg: 4 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    rbox(gb, 1.2, 3.1, -0.02, 0.02, 0, 0.55, 0.01, { ...Tp, color: k ? '#e8e0d0' : '#d84a2a', mat: GM.POLY, at: [0, 2.3, 0], rot: [a, 0, 0], seg: 1 });
  }
  // stirrup + small scope
  torusX(gb, L * 0.9, 0.2, 0, 1.3, 0.14, { color: DARK, arc: Math.PI, seg: 12 });
  scope(gb, -1.2, 5.4, 3.3, 0.5, { glint: true });
  out.muzzle = [L, 2.3, 0];
  out.front = [L * 0.44, 0.1, 0];
  out.reload = 'bolt';
  out.glowColor = '#c8e6ff';
  out.casing = null;
};

// ---- flamethrower -----------------------------------------------------------------------
BUILDERS.flamethrower = (gb, L, sp, out) => {
  const tank = mixHex(sp.color, '#3a2a26', 0.35);
  // skeletal stock + receiver
  ext(gb, [[-0.5, 2.0], [-8.2, 1.6], [-8.4, -1.9], [-7.4, -1.9], [-6.8, 0.2], [-2.0, 0.6], [-0.5, 0.3]], -0.5, 0.5, { color: '#2a2a2a', mat: GM.STEEL, holes: [[[-2.5, 1.4], [-6.8, 1.2], [-6.5, 0.8], [-2.6, 0.95]]] });
  rbox(gb, -1.2, 6.5, 0.4, 2.6, -0.95, 0.95, 0.35, { color: '#3a3a3a', mat: GM.STEEL });
  pistolGrip(gb, -0.2, DARK, { mat: GM.RUBBER });
  triggerGroup(gb, 0.1, 0.35, '#3a3a3a');
  // nozzle pipe + perforated heat shield
  cylX(gb, 6.4, L - 1.6, 2.2, 0, 0.52, 0.52, { color: '#3b3b3b', mat: GM.STEEL, seg: 16 });
  cylX(gb, L * 0.45, L - 2.2, 2.2, 0, 0.95, 0.95, { color: '#4a4c4e', mat: GM.STEEL, seg: 20, open: true });
  for (let r = 0; r < 4; r++) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU, x = L * 0.49 + r * 2.2;
    sphere(gb, x, 2.2 + Math.sin(a) * 0.93, Math.cos(a) * 0.93, 0.2, { color: '#070707', seg: 6 });
  }
  latheX(gb, [[L - 2.3, 0], [L - 2.3, 0.62], [L - 0.6, 0.72], [L + 0.2, 0.9], [L + 0.2, 0.55], [L - 0.2, 0.4], [L - 0.2, 0]], 2.2, 0, { color: '#6a6a6a', mat: GM.STEEL, seg: 18 });
  // igniter cage + pilot light (glow)
  rbox(gb, L - 0.6, L + 0.4, 0.95, 1.55, -0.3, 0.3, 0.08, { color: DARK });
  // gauge
  cylX(gb, 3.0, 3.3, 3.0, 0, 0.75, 0.75, { color: STEEL, rot: [0, 0, 0], seg: 18 });
  const gg = new THREE.CylinderGeometry(0.72, 0.72, 0.3, 18);
  gb.add(gg, { at: [3.2, 3.2, 0.35], rot: [HALF_PI, 0, 0], color: STEEL, mat: GM.STEEL, round: true });
  const gf = new THREE.CircleGeometry(0.6, 18);
  gb.add(gf, { at: [3.2, 3.2, 0.51], color: '#e8e4d0', mat: GM.PAINT });
  rbox(gb, 3.18, 3.22, 3.2, 3.7, 0.52, 0.56, 0.01, { color: '#c62828', mat: GM.PAINT, rot: [0, 0, -0.6], seg: 1 });
  // foregrip
  ext(gb, [[L * 0.44, 0.4], [L * 0.52, 0.4], [L * 0.51, -3.2], [L * 0.44, -3.3]], -0.6, 0.6, { color: RUBBER, mat: GM.RUBBER, bevel: 0.22 });
  // fuel tank (swapped on reload) with a hose to the nozzle
  const M = { part: 'mag' };
  latheX(gb, [[0.2, 0], [0.3, 1.1], [1.0, 1.7], [L * 0.62, 1.7], [L * 0.66, 1.2], [L * 0.67, 0]], -0.6, 0, { ...M, color: tank, mat: GM.PAINT, seg: 24 });
  for (const f of [0.18, 0.5]) torusX(gb, L * f, -0.6, 0, 1.72, 0.1, { ...M, color: '#6a6660', mat: GM.STEEL, seg: 24 });
  latheX(gb, [[L * 0.33, 1.72], [L * 0.33, 1.74], [L * 0.355, 1.74], [L * 0.355, 1.72]], -0.6, 0, { ...M, color: '#d8a800', mat: GM.PAINT, seg: 24 });
  tubePath(gb, [[1.0, 0.4, 1.3], [2.5, 1.2, 1.6], [5.0, 1.4, 1.3], [7.0, 1.9, 0.6]], 0.3, { color: RUBBER, mat: GM.RUBBER, seg: 20 });
  dot(gb, L + 0.2, 1.1, 0, 0.28, '#5aa8ff');
  out.pivots.pilot = [L + 0.2, 1.1, 0];
  out.muzzle = [L + 0.4, 2.2, 0];
  out.front = [L * 0.48, -2.9, 0];
  out.magwell = [L * 0.35, -1.5, 0];
  out.glowColor = '#ff9a40';
  out.heavy = true;
  out.casing = null;
};

// ---- LMG --------------------------------------------------------------------------------
BUILDERS.lmg = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  rbox(gb, -1.4, L * 0.4, -0.1, 2.7, -1.1, 1.1, 0.3, { color: col, mat: GM.STEEL });
  ext(gb, [[-0.8, 2.7], [L * 0.33, 2.7], [L * 0.33, 3.3], [0.6, 3.5], [-0.8, 3.2]], -1.05, 1.05, { color: shadeHex(col, 0.08), mat: GM.STEEL });   // feed cover
  rbox(gb, -1.1, -0.5, 2.9, 3.5, -0.6, 0.6, 0.1, { color: DARK });
  rail(gb, 1.0, L * 0.3, 3.4, 0, 0.9);
  rbox(gb, L * 0.4, L * 0.74, 0.55, 2.55, -1.0, 1.0, 0.35, { color: '#2a2c2a', mat: GM.STEEL });                // heat shield
  for (let k = 0; k < 6; k++) rbox(gb, L * 0.42 + k * 1.9, L * 0.42 + k * 1.9 + 1.0, 2.3, 2.6, -0.7, 0.7, 0.1, { color: '#080808', seg: 1 });
  cylX(gb, L * 0.74, L - 1.4, 1.5, 0, 0.46, 0.44, { color: BLUED, seg: 14 });
  latheX(gb, [[L - 1.6, 0], [L - 1.6, 0.65], [L, 0.62], [L, 0]], 1.5, 0, { color: DARK, seg: 14 });
  cylX(gb, L - 0.02, L + 0.02, 1.5, 0, 0.3, 0.3, { color: '#020202', seg: 10 });
  ext(gb, [[L * 0.45, 2.6], [L * 0.47, 4.4], [L * 0.63, 4.4], [L * 0.65, 2.6]], -0.3, 0.3, { color: DARK, holes: [[[L * 0.48, 2.9], [L * 0.49, 4.0], [L * 0.61, 4.0], [L * 0.62, 2.9]]] }); // carry handle
  for (const s of [-1, 1]) cylX(gb, L * 0.6, L * 0.88, 0.15, s * 0.55, 0.2, 0.2, { color: DARK, seg: 8 });       // folded bipod
  pistolGrip(gb, -0.2, DARK, { mat: GM.POLY });
  triggerGroup(gb, 0.1, -0.1, col);
  ext(gb, [[-1.3, 2.2], [-11, 2.0], [-11.4, -2.0], [-10, -2.1], [-5, -0.4], [-1.3, 0.0]], -0.9, 0.9, { color: '#1e1e1a', mat: GM.POLY, holes: [[[-3, 1.3], [-9.5, 1.3], [-9.6, -0.7], [-5.3, 0.4]]] });
  rbox(gb, -12, -11.1, -2.1, 2.1, -0.95, 0.95, 0.3, { color: RUBBER, mat: GM.RUBBER });
  // box magazine + belt of brass into the feed tray
  const M = { part: 'mag' };
  rbox(gb, 1.2, 6.4, -4.8, -0.3, -2.9, -0.2, 0.45, { ...M, color: acc, mat: GM.PAINT });
  rbox(gb, 1.5, 6.1, -4.5, -0.6, -2.95, -2.8, 0.2, { ...M, color: shadeHex(acc, -0.2), mat: GM.PAINT });
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    const x = 2.4 + t * 2.4, y = 1.5 + Math.sin(t * Math.PI) * 0.6 - t * 0.2, z = -1.1 - (1 - t) * 0.9;
    const g = new THREE.CylinderGeometry(0.22, 0.26, 1.7, 8);
    gb.add(g, { ...M, at: [x, y, z], rot: [HALF_PI, 0, 0], color: BRASS, mat: GM.BRASS, round: true });
  }
  out.muzzle = [L, 1.5, 0];
  out.front = [L * 0.48, 0.2, 0];
  out.eject = [4, 1.2, 1.2];
  out.magwell = [3.8, -2.2, -1.5];
  out.heavy = true;
  out.travel.bolt = 0;
};

// ---- grenade launcher (revolving drum) ---------------------------------------------------
BUILDERS.launcher = (gb, L, sp, out) => {
  const col = sp.color, dark = sp.accent;
  // frame rails round the drum
  rbox(gb, -1.2, 10.2, 3.6, 4.1, -0.9, 0.9, 0.18, { color: dark, mat: GM.STEEL });
  rbox(gb, -1.2, 10.2, -1.0, -0.4, -0.9, 0.9, 0.18, { color: dark, mat: GM.STEEL });
  rbox(gb, -1.4, -0.4, -1.0, 4.1, -1.2, 1.2, 0.3, { color: col, mat: GM.PAINT });
  rbox(gb, 9.6, 10.6, -1.0, 4.1, -1.2, 1.2, 0.3, { color: col, mat: GM.PAINT });
  // drum (rotates a chamber per shot)
  const C = { part: 'cyl' };
  latheX(gb, [[-0.3, 0], [-0.3, 2.3], [0.1, 2.6], [9.2, 2.6], [9.5, 2.2], [9.5, 0]], 1.6, 0, { ...C, color: shadeHex(col, -0.15), mat: GM.PAINT, seg: 24 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    rbox(gb, 0.6, 8.8, -0.2, 0.2, -0.22, 0.22, 0.15, { ...C, color: '#1c2412', at: [0, 1.6 + Math.sin(a + 0.52) * 2.55, Math.cos(a + 0.52) * 2.55], seg: 1 });
    cylX(gb, 9.45, 9.55, 1.6 + Math.sin(a) * 1.55, Math.cos(a) * 1.55, 0.62, 0.62, { ...C, color: '#0c0c0c', seg: 12 });
  }
  // barrel + foregrip + reflex sight
  latheX(gb, [[10.4, 0], [10.4, 1.45], [L - 0.5, 1.4], [L, 1.55], [L, 0]], 1.6, 0, { color: col, mat: GM.PAINT, seg: 22 });
  cylX(gb, L - 0.02, L + 0.02, 1.6, 0, 1.1, 1.1, { color: '#030303', seg: 16 });
  rail(gb, 11, L - 1, 3.05, 0, 1.1, { color: dark });
  ext(gb, [[L * 0.6, 0.2], [L * 0.68, 0.2], [L * 0.66, -3.3], [L * 0.59, -3.3]], -0.6, 0.6, { color: RUBBER, mat: GM.RUBBER, bevel: 0.22 });
  redDot(gb, 1.5, 4.1, '#ff5a2a');
  pistolGrip(gb, -0.4, RUBBER, { top: -0.9 });
  triggerGroup(gb, -0.3, -1.0, dark);
  // folding stock
  ext(gb, [[-1.4, 3.2], [-9.2, 2.6], [-9.4, -1.6], [-8.4, -1.7], [-8.0, 1.6], [-1.4, 1.4]], -0.55, 0.55, { color: dark, mat: GM.POLY });
  rbox(gb, -10.0, -9.1, -1.8, 2.8, -0.8, 0.8, 0.3, { color: RUBBER, mat: GM.RUBBER });
  out.pivots.cyl = [4.6, 1.6, 0];
  out.muzzle = [L, 1.6, 0];
  out.front = [L * 0.64, -2.6, 0];
  out.reload = 'cylinder';
  out.heavy = true;
  out.casing = null;
};

// ---- rocket launcher (RPG) -----------------------------------------------------------------
BUILDERS.rocket = (gb, L, sp, out) => {
  const tube = sp.color, wood = mixHex(sp.accent, '#8a5a34', 0.3);
  latheX(gb, [[-14.6, 2.1], [-14.6, 2.55], [-13.2, 2.4], [-11.5, 1.5], [-10.4, 1.5], [L - 4.5, 1.5], [L - 4.2, 1.7], [L - 3.6, 1.7], [L - 3.6, 1.35], [-10.4, 1.3], [-11.6, 1.3], [-13.4, 2.25], [-14.6, 2.1]], 2.4, 0,
    { color: tube, mat: GM.PAINT, seg: 28 });
  // wooden heat guards
  latheX(gb, [[-7.5, 1.5], [-7.5, 1.95], [-7.1, 2.05], [-0.4, 2.05], [0, 1.95], [0, 1.5]], 2.4, 0, { color: wood, mat: GM.WOOD, seg: 22 });
  latheX(gb, [[2.5, 1.5], [2.5, 1.9], [2.8, 2.0], [8.8, 2.0], [9.1, 1.9], [9.1, 1.5]], 2.4, 0, { color: wood, mat: GM.WOOD, seg: 22 });
  for (const x of [-7.8, 0.3, 2.2, 9.4]) torusX(gb, x, 2.4, 0, 1.55, 0.14, { color: DARK, seg: 22 });
  // grips + trigger
  pistolGrip(gb, 0.2, DARK, { mat: GM.POLY, top: 1.0 });
  triggerGroup(gb, 0.2, 0.9, DARK);
  ext(gb, [[5.4, 0.9], [7.0, 0.9], [6.8, -2.9], [5.5, -2.9]], -0.55, 0.55, { color: DARK, mat: GM.POLY, bevel: 0.2 });
  // optic on the left
  rbox(gb, -2.4, 3.2, 3.6, 5.4, -2.6, -1.1, 0.35, { color: '#2a2e22', mat: GM.PAINT });
  latheX(gb, [[-3.6, 0], [-3.6, 0.7], [-2.4, 0.55], [-2.4, 0]], 4.7, -1.85, { color: RUBBER, mat: GM.RUBBER, seg: 14 });
  const lg = new THREE.CircleGeometry(0.55, 16);
  gb.add(lg, { at: [3.21, 4.6, -1.85], rot: [0, HALF_PI, 0], color: '#3a1a10', mat: GM.LENS });
  dot(gb, 3.22, 4.6, -1.85, 0.12, '#ff5a3a');
  // warhead (only while loaded)
  const T = { part: 'tip' };
  latheX(gb, [[L - 5.2, 0], [L - 5.2, 1.3], [L - 4.0, 1.35], [L - 3.6, 1.75], [L - 2.2, 2.3], [L, 2.4], [L + 1.6, 1.9], [L + 3.0, 0.9], [L + 3.3, 0.35], [L + 4.6, 0.25], [L + 4.8, 0]], 2.4, 0,
    { ...T, color: sp.accent === '#8d6e63' ? '#5a6a3a' : sp.accent, mat: GM.PAINT, seg: 24 });
  torusX(gb, L + 0.2, 2.4, 0, 2.38, 0.1, { ...T, color: '#9a8a3a', mat: GM.BRASS, seg: 24 });
  out.muzzle = [L - 3.5, 2.4, 0];
  out.front = [6.2, -2.4, 0];
  out.glowColor = '#ff5a3a';
  out.heavy = true;
  out.reload = 'rocket';
  out.casing = null;
};

// ---- tesla gun ------------------------------------------------------------------------------
BUILDERS.tesla = (gb, L, sp, out) => {
  // the top-down sprite colours are saturated for readability; in 3D the painted shell
  // reads as military hardware when it is darker and greyer
  const body = mixHex(sp.color, '#2a3036', 0.55), glow = sp.accent;
  ext(gb, [[-6.2, 1.8], [-6.4, -1.4], [-5.4, -1.6], [-4.8, 0.2], [-1.0, 0.2], [-0.8, 2.4], [-5.2, 2.6]], -0.8, 0.8, { color: shadeHex(body, -0.3), mat: GM.PAINT, bevel: 0.25 });
  ext(gb, [[-1.2, 0.2], [L * 0.62, 0.3], [L * 0.7, 1.2], [L * 0.62, 3.3], [2.2, 3.5], [-1.2, 3.0]], -1.25, 1.25, { color: body, mat: GM.PAINT, bevel: 0.35, bevelSeg: 3 });
  for (let k = 0; k < 3; k++) rbox(gb, 1.5 + k * 3, 3.3 + k * 3, 3.3, 3.7, -0.6, 0.6, 0.15, { color: '#1a2a44', mat: GM.ALLOY });      // fins
  // copper coils with glowing gaps
  cylX(gb, L * 0.6, L * 0.95, 1.7, 0, 0.5, 0.45, { color: STEEL, seg: 14 });
  for (let k = 0; k < 7; k++) torusX(gb, L * 0.64 + k * 1.05, 1.7, 0, 1.0 - k * 0.04, 0.2, { color: COPPER, mat: GM.BRASS, seg: 22 });
  for (let k = 0; k < 6; k++) torusX(gb, L * 0.64 + k * 1.05 + 0.52, 1.7, 0, 0.75 - k * 0.03, 0.09, { glow: true, color: glow, seg: 18 });
  // prongs converging on an emitter orb
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + HALF_PI;
    tubePath(gb, [[L * 0.9, 1.7 + Math.sin(a) * 1.2, Math.cos(a) * 1.2], [L * 0.98, 1.7 + Math.sin(a) * 1.0, Math.cos(a) * 1.0], [L + 0.3, 1.7 + Math.sin(a) * 0.4, Math.cos(a) * 0.4]], 0.13, { color: '#9aa4ac', mat: GM.STEEL, radial: 6, seg: 8 });
  }
  sphere(gb, L * 0.99, 1.7, 0, 0.42, { glow: true, color: '#e8fbff', seg: 12 });
  // side capacitors with glow bands
  for (const s of [-1, 1]) {
    cylX(gb, 2.0, 7.0, 1.4, s * 1.45, 0.55, 0.55, { color: '#2a3a50', mat: GM.ALLOY, seg: 14 });
    for (let k = 0; k < 3; k++) torusX(gb, 2.8 + k * 1.6, 1.4, s * 1.45, 0.56, 0.06, { glow: true, color: glow, seg: 14 });
  }
  pistolGrip(gb, -0.3, DARK, { mat: GM.RUBBER, top: 0.3 });
  triggerGroup(gb, 0.1, 0.25, shadeHex(body, -0.3));
  ext(gb, [[L * 0.38, 0.3], [L * 0.46, 0.3], [L * 0.45, -3.1], [L * 0.38, -3.2]], -0.6, 0.6, { color: DARK, mat: GM.RUBBER, bevel: 0.22 });
  // energy cell (swapped on reload)
  const M = { part: 'mag' };
  cylX(gb, 1.5, 5.8, -0.6, 0, 0.75, 0.75, { ...M, color: '#1a2230', mat: GM.ALLOY, seg: 16 });
  cylX(gb, 1.9, 5.4, -0.6, 0, 0.78, 0.78, { ...M, glow: true, color: glow, seg: 16, open: true, scale: [1, 1, 1] });
  for (const x of [1.5, 5.8]) torusX(gb, x, -0.6, 0, 0.8, 0.12, { ...M, color: STEEL, seg: 16 });
  out.muzzle = [L, 1.7, 0];
  out.front = [L * 0.42, -2.8, 0];
  out.magwell = [3.6, -1.6, 0];
  out.glowColor = glow;
  out.casing = null;
};

// ---- minigun --------------------------------------------------------------------------------
BUILDERS.minigun = (gb, L, sp, out) => {
  const col = sp.color, acc = sp.accent;
  rbox(gb, -7.2, 5.2, -1.4, 3.3, -1.8, 1.8, 0.6, { color: col, mat: GM.STEEL });                               // motor housing
  cylX(gb, -8.6, -7.0, 1.0, 0, 1.4, 1.5, { color: DARK, seg: 18 });
  for (let k = 0; k < 5; k++) rbox(gb, -6.4 + k * 1.2, -5.9 + k * 1.2, 3.2, 3.5, -1.2, 1.2, 0.1, { color: '#0a0a0a', seg: 1 });
  // handles: rear spade grips + top carry handle
  tubePath(gb, [[-2.5, 3.3, 0], [-2.0, 5.2, 0], [3.2, 5.6, 0], [3.8, 3.3, 0]], 0.36, { color: DARK, mat: GM.RUBBER, seg: 18 });
  pistolGrip(gb, -0.2, DARK, { mat: GM.RUBBER, top: -1.3 });
  triggerGroup(gb, 0.1, -1.3, DARK);
  // feed chute with belt
  tubePath(gb, [[0.5, -1.2, -1.9], [-0.5, -3.2, -3.2], [-3.0, -4.6, -4.2]], 0.75, { color: acc, mat: GM.RUBBER, seg: 20, radial: 10 });
  for (let k = 0; k < 6; k++) {
    const g = new THREE.CylinderGeometry(0.2, 0.24, 1.4, 8);
    gb.add(g, { at: [-3.2 - k * 0.55, -4.9 - k * 0.2, -4.2], rot: [HALF_PI, 0, 0.3], color: BRASS, mat: GM.BRASS, round: true });
  }
  // barrel cluster (spins)
  const Sp = { part: 'spin' };
  const bx0 = 5.0;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    cylX(gb, bx0, L, Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0.38, 0.36, { ...Sp, color: k % 2 ? '#34373a' : '#45484b', mat: GM.STEEL, seg: 10 });
    cylX(gb, L - 0.05, L + 0.02, Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0.2, 0.2, { ...Sp, color: '#020202', seg: 8 });
  }
  cylX(gb, bx0, bx0 + 2.2, 0, 0, 1.9, 1.85, { ...Sp, color: DARK, seg: 22 });
  for (const f of [0.55, 0.85]) cylX(gb, L * f, L * f + 1.0, 0, 0, 1.78, 1.78, { ...Sp, color: '#2a2a2a', seg: 22 });
  cylX(gb, L - 1.2, L, 0, 0, 1.7, 1.7, { ...Sp, color: '#232323', seg: 22 });
  out.pivots.spin = [0, 0, 0];
  out.muzzle = [L, 0, 0];
  out.front = [0.6, 5.3, 0];
  out.eject = [3, -1.4, 1.8];
  out.magwell = [-2.5, -4.4, -4];
  out.heavy = true;
};

// ---- railgun ----------------------------------------------------------------------------------
BUILDERS.railgun = (gb, L, sp, out) => {
  const body = mixHex(sp.color, '#26262c', 0.55), glow = sp.accent;
  ext(gb, [[-9.2, 2.0], [-9.4, -1.8], [-8.2, -2.0], [-7.2, 0.0], [-1.0, 0.0], [-0.6, 2.3], [-7.4, 2.5]], -0.8, 0.8, { color: '#1c1640', mat: GM.PAINT, bevel: 0.25, holes: [[[-2.0, 1.6], [-6.8, 1.7], [-6.6, 0.6], [-2.2, 0.6]]] });
  rbox(gb, -1.2, L * 0.46, -0.3, 2.9, -1.25, 1.25, 0.45, { color: body, mat: GM.PAINT });
  // twin rails with a glowing channel
  for (const y of [3.3, -0.5]) rbox(gb, L * 0.3, L, y - 0.55, y + 0.55, -0.85, 0.85, 0.2, { color: '#3a3a4a', mat: GM.ALLOY });
  rbox(gb, L * 0.3, L - 0.1, 1.05, 1.85, -0.35, 0.35, 0.1, { glow: true, color: glow });
  for (let k = 0; k < 5; k++) {
    const x = L * 0.35 + k * (L * 0.12);
    rbox(gb, x, x + 1.2, -1.2, 4.0, -1.1, 1.1, 0.3, { color: '#20202a', mat: GM.ALLOY });
    rbox(gb, x + 0.3, x + 0.9, -1.25, 4.05, -1.14, 1.14, 0.1, { glow: true, color: mixHex(glow, '#ffffff', 0.25) });
  }
  rail(gb, -0.8, L * 0.3, 2.9, 0, 1.0);
  scope(gb, -0.5, 8.5, 4.9, 0.72);
  pistolGrip(gb, -0.3, DARK, { mat: GM.RUBBER, top: -0.2 });
  triggerGroup(gb, 0.1, -0.2, body);
  ext(gb, [[L * 0.4, -0.2], [L * 0.47, -0.2], [L * 0.46, -3.4], [L * 0.4, -3.4]], -0.6, 0.6, { color: DARK, mat: GM.RUBBER, bevel: 0.22 });
  // battery (swapped on reload)
  const M = { part: 'mag' };
  rbox(gb, 1.4, 5.6, -2.6, -0.2, -0.95, 0.95, 0.3, { ...M, color: '#1a1a24', mat: GM.ALLOY });
  rbox(gb, 1.9, 5.1, -2.2, -1.9, -0.99, 0.99, 0.08, { ...M, glow: true, color: glow });
  out.muzzle = [L, 1.45, 0];
  out.front = [L * 0.44, -3.0, 0];
  out.magwell = [3.5, -1.4, 0];
  out.glowColor = glow;
  out.heavy = true;
  out.casing = null;
};

// ---------------------------------------------------------------------------------------
// materials + objects

const GUN_VERT = /* glsl */`
attribute vec2 aGun;
varying vec2 vGun;
varying vec2 vGUv;
`;
const GUN_FRAG = /* glsl */`
uniform sampler2D uGunAtlas;
varying vec2 vGun;
varying vec2 vGUv;
vec4 gT;
int gM;
float gWear;
vec3 gPerturb(vec3 N, vec3 eyePos, vec2 uv, vec2 nxy) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, N), q0p = cross(N, q0);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 Bt = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(Bt, Bt));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  return normalize(T * (nxy.x * s) + Bt * (nxy.y * s) + N * nz);
}
`;

/**
 * The shared gun material (vertex colours + surface class → atlas). `envMap` is only set
 * for the viewmodel (its own studio reflections); world guns use scene.environment.
 */
export function createGunMaterial(atlas, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5, envMap: opts.envMap || null, envMapIntensity: opts.envIntensity ?? 1 });
  const uniforms = { uGunAtlas: { value: atlas } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GUN_VERT)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGun = aGun; vGUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GUN_FRAG)
      .replace('#include <color_fragment>', /* glsl */`
  #include <color_fragment>
  gM = int(vGun.x + 0.5);
  gWear = vGun.y;
  vec2 tile = gM == 2 ? vec2(0.5, 0.0) : gM == 3 ? vec2(0.0, 0.5) : gM == 4 ? vec2(0.5, 0.5) : vec2(0.0);
  {
    vec2 f = fract(vGUv);
    vec2 a = tile + f * (0.5 - 4.0 / 1024.0) + 2.0 / 1024.0;
    gT = textureGrad(uGunAtlas, a, dFdx(vGUv) * 0.5, dFdy(vGUv) * 0.5);
  }
  float alb = gM == 3 ? 0.45 + gT.r * 0.75 : 0.72 + gT.r * 0.36;
  diffuseColor.rgb *= alb;
  // edge wear: bare steel on metal edges, scuffs on polymer/wood
  float wm = smoothstep(0.3, 0.75, gWear + (gT.a - 0.45) * 0.6);
  if (gM <= 1 || gM == 7) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.52, 0.53, 0.55), wm * 0.75);
  else if (gM == 2 || gM == 4) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.7 + 0.03, wm * 0.45);
  else if (gM == 3) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5, wm * 0.5);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
  float roughnessFactor = 0.5;
  if (gM == 0) roughnessFactor = 0.38 + gT.a * 0.5;
  else if (gM == 1) roughnessFactor = 0.45 + gT.a * 0.4;
  else if (gM == 2) roughnessFactor = 0.35 + gT.a * 0.55;
  else if (gM == 3) roughnessFactor = 0.3 + gT.a * 0.5;
  else if (gM == 4) roughnessFactor = 0.55 + gT.a * 0.4;
  else if (gM == 5) roughnessFactor = 0.22 + gT.a * 0.2;
  else if (gM == 6) roughnessFactor = 0.04;
  else if (gM == 7) roughnessFactor = 0.38 + gT.a * 0.35;
  if (gM <= 1 || gM == 7) roughnessFactor = mix(roughnessFactor, 0.24, wm);`)
      .replace('#include <metalnessmap_fragment>', /* glsl */`
  // parkerized steel and anodised alloy are finishes over the metal: mostly matte and
  // dark; only the worn edges show bare, fully metallic steel
  float metalnessFactor = gM == 0 ? 0.5 + wm * 0.5 : gM == 1 ? 0.3 + wm * 0.7 : gM == 5 ? 1.0 : gM == 6 ? 0.3 : gM == 7 ? 0.15 + wm * 0.8 : 0.0;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
  {
    float ns = gM == 3 ? 0.7 : gM == 4 ? 1.1 : gM == 6 ? 0.0 : gM == 2 ? 0.8 : 0.55;
    normal = gPerturb(normal, -vViewPosition, vGUv, (gT.gb * 2.0 - 1.0) * ns);
  }`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
  #include <emissivemap_fragment>
  if (gM == 6) totalEmissiveRadiance += diffuseColor.rgb * 0.35;`);
  };
  mat.customProgramCacheKey = () => 'hh-gun-std' + (opts.envMap ? '-env' : '');
  return mat;
}

let shared = null;
/**
 * Free the GPU copies of the cached gun geometries, the shared materials and the atlas in
 * every renderer that drew them (renderer3d calls this from destroy()). The objects stay
 * cached and valid: the next renderer uploads them again. Without it each finished game
 * left its WebGLRenderer reachable through the dispose listeners on these module-level
 * objects, with its GPU buffers still allocated on the reused canvas' context.
 */
export function releaseSharedGuns() {
  for (const m of cache.values()) for (const k in m.geos) m.geos[k].dispose();
  if (shared) {
    shared.std.dispose();
    shared.glow.dispose();
    shared.atlas.dispose();
  }
}

/** Shared materials for world guns (teammates, crates) + the atlas texture. */
export function gunMaterials() {
  if (shared) return shared;
  const atlas = gunAtlasTexture(8);
  shared = {
    atlas,
    std: createGunMaterial(atlas),
    // glowing parts: vertex colour × 2.6 in HDR (they bloom; ACES rolls them off)
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) }),
  };
  shared.lambert = shared.std;
  return shared;
}

/**
 * A ready-to-place gun: a Group with one mesh per part (moving parts in pivot groups).
 * userData: { model, parts: { name: Object3D }, glowMeshes, animate(state), dispose() }.
 * @param {string} weaponId
 * @param {{ shadow?: boolean, mirror?: boolean, lite?: boolean, material?: THREE.Material, glowMaterial?: THREE.Material }} o
 */
export function gunObject(weaponId, o = {}) {
  const model = gunModel(weaponId, !!o.lite);
  const mats = gunMaterials();
  const mat = o.material || mats.std;
  const glowMat = o.glowMaterial || mats.glow;
  const group = new THREE.Group();
  const inner = new THREE.Group();
  if (o.mirror) inner.scale.z = -1;
  group.add(inner);
  const parts = {};
  const glowMeshes = [];
  for (const name of model.partNames) {
    const pv = model.pivots[name] || null;
    let holder = inner;
    if (name !== 'body') {
      // moving part: a pivot group at its pivot so it can rotate/translate about it
      const pivot = new THREE.Group();
      const p = pv || [0, 0, 0];
      pivot.position.set(p[0], p[1], p[2]);
      const off = new THREE.Group();
      off.position.set(-p[0], -p[1], -p[2]);
      pivot.add(off);
      inner.add(pivot);
      holder = off;
      parts[name] = pivot;
    }
    const solid = model.geos[name], glow = model.geos[name + ':glow'];
    if (solid) {
      const m = new THREE.Mesh(solid, mat);
      m.castShadow = !!o.shadow;
      m.frustumCulled = false;
      holder.add(m);
    }
    if (glow) {
      const g = new THREE.Mesh(glow, glowMat);
      g.frustumCulled = false;
      holder.add(g);
      glowMeshes.push(g);
    }
  }
  let spinA = 0;
  group.userData = {
    model, parts, glowMeshes,
    /** Cheap animation for third-person guns: minigun spin, pump on shots. */
    animate(st) {
      if (parts.spin) { spinA += (st.spin || 0) * (st.dt || 0.016) * 38; parts.spin.rotation.x = spinA; }
      if (parts.pump) { const k = st.shot > 0.1 && st.shot < 0.4 ? Math.sin(((st.shot - 0.1) / 0.3) * Math.PI) : 0; parts.pump.position.x = -k * 3; }
    },
    dispose() { group.removeFromParent(); },
  };
  return group;
}

/**
 * The procedural hard-surface kit (builder + primitive helpers + surface classes), for
 * other props built in the same material: pickups, turrets, barricades, projectiles.
 */
export const gunKit = { GunBuilder, ext, rbox, cylX, latheX, sphere, torusX, tubePath, rail, dot, GM };
