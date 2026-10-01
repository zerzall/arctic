// Small building blocks shared by the ACTORS sub-systems (zombies, players, items,
// effects, viewmodel): a low-poly part builder that merges primitive three.js
// geometries into one vertex-coloured BufferGeometry (so a whole model is one draw
// call), colour helpers and procedural canvas textures. Everything procedural — no
// model or texture files (SPEC §7.5).

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Matrix3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

/** Linear-space THREE.Color from '#rrggbb' (cached per string: colours are reused a lot). */
const colorCache = new Map();
export function col(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

/** Mix two '#rrggbb' colours in sRGB, t = 0..1 → '#rrggbb'. */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => {
    const x = (pa >> s) & 255, y = (pb >> s) & 255;
    return Math.round(x + (y - x) * t);
  };
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

/** Lighten (amt > 0) or darken (amt < 0) a '#rrggbb' colour. */
export function shadeHex(hex, amt) {
  return amt >= 0 ? mixHex(hex, '#ffffff', amt) : mixHex(hex, '#000000', -amt);
}

/** Deterministic 0..1 hash of an integer (per-entity variation without state). */
export function hash01(n) {
  let x = (n | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Shared unit primitives, built once. Low segment counts: the look is deliberately
// chunky and it keeps 250 zombies cheap.
let prims = null;
function primitives() {
  if (prims) return prims;
  prims = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    cone6: new THREE.ConeGeometry(0.5, 1, 6),
    cone8: new THREE.ConeGeometry(0.5, 1, 8),
    ico0: new THREE.IcosahedronGeometry(0.5, 0),
    ico1: new THREE.IcosahedronGeometry(0.5, 1),
    tetra: new THREE.TetrahedronGeometry(0.5, 0),
    torus: new THREE.TorusGeometry(0.5, 0.12, 5, 10),
  };
  for (const k in prims) {
    if (prims[k].index) prims[k] = prims[k].toNonIndexed();
  }
  return prims;
}

/** Name → unit primitive geometry (non-indexed). Kinds: box cyl6 cyl8 cyl12 cone6 cone8 ico0 ico1 tetra torus. */
export function prim(kind) {
  const p = primitives();
  return p[kind] || p.box;
}

/**
 * Accumulates transformed, coloured primitives into one non-indexed BufferGeometry.
 * Extra per-vertex attributes used by the GPU rig: `aBone` (which bone moves the
 * vertex) and `aSlot` (which colour slot tints it — see actor-rig.js).
 */
export class PartBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.colr = [];
    this.bone = [];
    this.slot = [];
    this.uv = [];
  }

  /**
   * Add one primitive.
   * @param {string|THREE.BufferGeometry} kind prim() name or a geometry
   * @param {object} o { at:[x,y,z], rot:[x,y,z] (Euler XYZ), size:[sx,sy,sz], color:'#hex',
   *   bone:int, slot:int, ao:0..1 (darken the part's underside), taper:[top x/z scale] }
   */
  add(kind, o = {}) {
    const g = typeof kind === 'string' ? prim(kind) : (kind.index ? kind.toNonIndexed() : kind);
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
    const size = o.size || [1, 1, 1];
    _s.set(size[0], size[1], size[2]);
    const r = o.rot || [0, 0, 0];
    _q.setFromEuler(_e.set(r[0], r[1], r[2], o.order || 'XYZ'));
    const at = o.at || [0, 0, 0];
    _p.set(at[0], at[1], at[2]);
    _m.compose(_p, _q, _s);
    _n.getNormalMatrix(_m);
    _c.copy(col(o.color || '#ffffff'));
    const ao = o.ao ?? 0.25;
    const taper = o.taper;
    const bone = o.bone ?? 0, slot = o.slot ?? 0;
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (taper) {
        // scale x/z by height inside the unit primitive (-0.5..0.5): top gets taper
        const t = y + 0.5;
        const kx = 1 + (taper[0] - 1) * t, kz = 1 + ((taper[1] ?? taper[0]) - 1) * t;
        x *= kx; z *= kz;
      }
      _v.set(x, y, z).applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_n).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      // cheap baked occlusion: the underside of every part is a little darker
      const k = 1 - ao * (0.5 - y);
      this.colr.push(_c.r * k, _c.g * k, _c.b * k);
      this.bone.push(bone);
      this.slot.push(slot);
      if (UV) this.uv.push(UV.getX(i), UV.getY(i));
      else this.uv.push(0, 0);
    }
    return this;
  }

  /** Number of vertices so far. */
  get count() { return this.pos.length / 3; }

  /** @returns {THREE.BufferGeometry} */
  build({ rig = false, uv = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colr, 3));
    if (rig) {
      g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1));
      g.setAttribute('aSlot', new THREE.Float32BufferAttribute(this.slot, 1));
    }
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** A canvas (DOM) of the given size; callers paint it and wrap it in a CanvasTexture. */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** CanvasTexture in sRGB with mipmaps — for icons and labels. */
export function canvasTexture(canvas, { srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}

/** Squared distance in the ground plane. */
export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** Shortest signed angle from a to b. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Frame-rate independent exponential approach factor. */
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/**
 * Cap a colour's luminance (linear, Rec.709) at `max` by scaling it down. Near-white
 * cloth under the flashlight otherwise reads as a glowing silhouette and blooms; the
 * bloom convention keeps ordinary surfaces below ~0.8.
 * @param {THREE.Color} c linear colour (mutated)
 */
export function capLuma(c, max = 0.42) {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  if (l > max) c.multiplyScalar(max / l);
  return c;
}
