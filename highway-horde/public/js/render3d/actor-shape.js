// Organic shape builder for the rigged actors (zombies, survivors, first-person hands).
// Parts are generalized tubes (a ring of vertices swept along a path, per-ring radii and
// bone weights — limbs, torsos, fingers, necks) and deformable ellipsoids (heads, bellies,
// growths), merged into one indexed BufferGeometry per model so a whole zombie type is a
// single draw call. Normals are smoothed per part across UV seams (welded by position),
// so the bodies read as sculpted, not faceted.
//
// Vertex attributes (consumed by actor-rig.js):
//   position, normal, uv (world units / tile), color (vertex tint and baked occlusion),
//   aBones  vec2  two bones that move the vertex,
//   aInfo   vec4  (weight of the second bone, colour slot, material class, paint 0..1),
//   aExt    vec2  (accessory option bit + 1 or 0 = always drawn, garment part code — PART).
// Model space: +X forward, +Y up, +Z to the model's right (see actor-rig.js).

import * as THREE from 'three';
import { SLOT, MAT, PART, optBit } from './actor-consts.js';

export { SLOT, MAT, PART };

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// cheap deterministic 3D value noise (build time only)

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 3D value noise in -1..1 (build-time lumps and wrinkles). */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi), c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1), c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w) * 2 - 1;
}

/** Two-octave noise (lumpier, still smooth). */
export function fbm3(x, y, z) {
  return noise3(x, y, z) * 0.65 + noise3(x * 2.13 + 7.1, y * 2.13 - 3.3, z * 2.13 + 1.7) * 0.35;
}

// ---------------------------------------------------------------------------------------

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Scratch passed to per-vertex callbacks. */
const _bw = { a: 0, b: 0, w: 0 };

function colorOf(c) {
  if (c && c.isColor) return c;
  return _c.set(c || '#ffffff');
}

/** Bone spec (number | [a, b, w]) → { a, b, w }. */
function boneSpec(b) {
  if (Array.isArray(b)) return { a: b[0], b: b[1], w: b[2] };
  const a = b | 0;
  return { a, b: a, w: 0 };
}

/** Blend two bone specs (weights over at most two bones survive). */
function blendBones(b0, b1, t) {
  if (typeof b0 === 'function' || typeof b1 === 'function') return t < 0.5 ? b0 : b1;
  const p = boneSpec(b0), q = boneSpec(b1);
  const W = new Map();
  const add = (bone, w) => { if (w > 1e-6) W.set(bone, (W.get(bone) || 0) + w); };
  add(p.a, (1 - t) * (1 - p.w)); add(p.b, (1 - t) * p.w);
  add(q.a, t * (1 - q.w)); add(q.b, t * q.w);
  const top = [...W.entries()].sort((x, y) => y[1] - x[1]);
  if (top.length === 1) return top[0][0];
  const w0 = top[0][1], w1 = top[1][1];
  const a = top[0][0], b = top[1][0];
  return a === b ? a : [a, b, w1 / (w0 + w1)];
}

/** Catmull-Rom scalar through p1..p2 at t. */
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Insert n - 1 spline-interpolated rings between every pair of authored rings. */
export function subdivideRings(R, n) {
  if (R.length < 2 || n < 2) return R;
  const out = [];
  const at = (i) => R[Math.max(0, Math.min(R.length - 1, i))];
  for (let i = 0; i < R.length - 1; i++) {
    const r0 = at(i - 1), r1 = at(i), r2 = at(i + 1), r3 = at(i + 2);
    out.push(r1);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const ring = { ...r1 };
      ring.c = [0, 1, 2].map((d) => cr(r0.c[d], r1.c[d], r2.c[d], r3.c[d], t));
      const sx = (r) => r.rx ?? r.r, sz = (r) => r.rz ?? r.r;
      ring.rx = Math.max(0.0001, cr(sx(r0), sx(r1), sx(r2), sx(r3), t));
      ring.rz = Math.max(0.0001, cr(sz(r0), sz(r1), sz(r2), sz(r3), t));
      ring.r = undefined;
      if (r1.bone !== undefined && r2.bone !== undefined) ring.bone = blendBones(r1.bone, r2.bone, t);
      if (r1.paint !== undefined && r2.paint !== undefined) ring.paint = r1.paint + (r2.paint - r1.paint) * t;
      if (r1.tw !== undefined || r2.tw !== undefined) ring.tw = (r1.tw || 0) + ((r2.tw || 0) - (r1.tw || 0)) * t;
      if (r1.color && r2.color && r1.color !== r2.color) ring.color = t < 0.5 ? r1.color : r2.color;
      out.push(ring);
    }
  }
  out.push(R[R.length - 1]);
  return out;
}

/**
 * Accumulates organic parts into one indexed, smooth-shaded geometry.
 */
export class ShapeBuilder {
  constructor() {
    this.P = []; this.N = []; this.UV = []; this.C = []; this.BN = []; this.IN = []; this.EX = []; this.I = [];
    this.tile = 18;     // world units per texture tile
  }

  get vertexCount() { return this.P.length / 3; }

  /**
   * Append one part from local arrays. Smooth normals are computed over the part with
   * vertices welded by position (seams and poles share normals).
   * @param {number[]} pos flat xyz
   * @param {number[]} idx triangle indices (local)
   * @param {number[]} uv flat uv
   * @param {object} o part options (see tube())
   * @param {number[]} [ringOf] per-vertex ring index (for per-ring attributes)
   * @param {object[]} [rings] ring specs
   */
  _part(pos, idx, uv, o, ringOf, rings) {
    const n = pos.length / 3;
    // ---- smooth normals, welded by quantized position ----
    const nor = new Float32Array(n * 3);
    const key = new Map();
    const canon = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      // three 17-bit quantized coordinates packed into one exact double (numeric Map keys
      // are several times faster than strings: the cinematic meshes have 100k+ vertices)
      const k = ((Math.round(pos[i * 3] * 400) + 65536) * 131072 + (Math.round(pos[i * 3 + 1] * 400) + 65536)) * 131072 + (Math.round(pos[i * 3 + 2] * 400) + 65536);
      let c = key.get(k);
      if (c === undefined) { c = i; key.set(k, i); }
      canon[i] = c;
    }
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
      const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      for (const v of [canon[a], canon[b], canon[c]]) {
        nor[v * 3] += fx; nor[v * 3 + 1] += fy; nor[v * 3 + 2] += fz;
      }
    }
    for (let i = 0; i < n; i++) {
      const c = canon[i];
      const x = nor[c * 3], y = nor[c * 3 + 1], z = nor[c * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l;
    }
    // ---- append with attributes ----
    const base = this.vertexCount;
    const slot = o.slot ?? SLOT.FIXED, mat = o.mat ?? MAT.SKIN;
    const col0 = colorOf(o.color).clone();
    const ao = o.ao ?? 0.18;
    const opt = o.opt ? optBit(o.opt) + 1 : 0;
    if (o.opt && opt === 0) throw new Error('unknown option ' + o.opt);
    const partCode = o.part ?? PART.NONE;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
      this.P.push(x, y, z);
      this.N.push(nx, ny, nz);
      this.UV.push(uv[i * 2], uv[i * 2 + 1]);
      // bones
      const ring = ringOf ? rings[ringOf[i]] : null;
      _bw.a = 0; _bw.b = 0; _bw.w = 0;
      const bone = ring && ring.bone !== undefined ? ring.bone : o.bone;
      if (typeof bone === 'function') bone(x, y, z, _bw);
      else if (Array.isArray(bone)) { _bw.a = bone[0]; _bw.b = bone[1]; _bw.w = bone[2]; } else { _bw.a = bone | 0; _bw.b = bone | 0; }
      if (_bw.w <= 0) _bw.b = _bw.a;
      this.BN.push(_bw.a, _bw.b);
      // colour: part colour (or per-ring / per-vertex), baked cavity + underside occlusion
      let cc = col0;
      if (ring && ring.color) cc = colorOf(ring.color);
      if (o.colorFn) cc = colorOf(o.colorFn(x, y, z, nx, ny, nz));
      let k = 1 - ao * Math.max(0, -ny) * 0.8;
      if (o.shade) k *= o.shade(x, y, z, nx, ny, nz);
      this.C.push(cc.r * k, cc.g * k, cc.b * k);
      let paint = ring && ring.paint !== undefined ? ring.paint : (typeof o.paint === 'function' ? o.paint(x, y, z) : (o.paint || 0));
      if (o.paintFn) paint = Math.max(paint, o.paintFn(x, y, z));
      const m = o.matFn ? o.matFn(x, y, z) : mat;
      this.IN.push(_bw.w, slot, m, Math.max(0, Math.min(1, paint)));
      this.EX.push(opt, typeof o.partFn === 'function' ? o.partFn(x, y, z) : partCode);
    }
    for (let t = 0; t < idx.length; t++) this.I.push(idx[t] + base);
    return this;
  }

  /**
   * Generalized tube: a (possibly elliptical) ring swept through `rings`.
   * @param {Array<{c:number[], r?:number, rx?:number, rz?:number, bone?:any, color?:any, paint?:number, tw?:number}>} rings
   *   c = centre; rx = radius along the frame normal (the part's "front"), rz = along the
   *   binormal (its "side"); a ring with radius 0 becomes a pole vertex (closed end).
   * @param {object} o { seg, cap0, cap1 ('round'|'flat'|'none'), ref:[x,y,z] frame hint, bone,
   *   slot, mat, color, paint, noise:{amp, freq}, profile(theta)→k, uvTile, ao, shade,
   *   disp(x, y, z, ux, uy, uz)→radial offset (model space; u = outward unit direction) }
   */
  tube(rings, o = {}) {
    const seg = Math.max(3, o.seg || 8);
    // expand round caps into extra shrinking rings
    let R = rings.slice();
    // far levels of detail: keep every dec-th ring (and the last)
    if (o.dec > 1) R = R.filter((_, i) => i % o.dec === 0 || i === R.length - 1);
    // the cinematic tier: spline-interpolated rings between the authored ones (smooth curvature)
    if (o.subdiv > 1) R = subdivideRings(R, o.subdiv);
    const capRings = o.capRings ?? Math.max(2, Math.round(seg / 4));
    const capOf = (end) => {
      const i0 = end ? R.length - 1 : 0, i1 = end ? R.length - 2 : 1;
      const a = R[i0], b = R[i1];
      const dx = a.c[0] - b.c[0], dy = a.c[1] - b.c[1], dz = a.c[2] - b.c[2];
      const L = Math.hypot(dx, dy, dz) || 1;
      const rx = a.rx ?? a.r, rz = a.rz ?? a.r;
      const len = (o.capLen ?? 1) * Math.min(rx, rz);
      const out = [];
      for (let k = 1; k <= capRings; k++) {
        const t = k / capRings;
        const s = Math.cos(t * Math.PI / 2), h = Math.sin(t * Math.PI / 2) * len;
        out.push({ ...a, c: [a.c[0] + dx / L * h, a.c[1] + dy / L * h, a.c[2] + dz / L * h], rx: rx * s, rz: rz * s, r: undefined });
      }
      return out;
    };
    if (o.cap1 === 'round') R = R.concat(capOf(true));
    else if (o.cap1 === 'flat') R.push({ ...R[R.length - 1], rx: 0, rz: 0, r: 0 });
    if (o.cap0 === 'round') R = capOf(false).reverse().concat(R);
    else if (o.cap0 === 'flat') R.unshift({ ...R[0], rx: 0, rz: 0, r: 0 });

    // frames by parallel transport
    const n = R.length;
    const T = [], Nn = [];
    for (let i = 0; i < n; i++) {
      const a = R[Math.max(0, i - 1)].c, b = R[Math.min(n - 1, i + 1)].c;
      const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (t.lengthSq() < 1e-10) t.set(0, 1, 0);
      T.push(t.normalize());
    }
    const ref = new THREE.Vector3(...(o.ref || [1, 0, 0]));
    let N0 = ref.clone().addScaledVector(T[0], -ref.dot(T[0]));
    if (N0.lengthSq() < 1e-6) N0 = new THREE.Vector3(0, 0, 1).addScaledVector(T[0], -T[0].z);
    N0.normalize();
    Nn.push(N0);
    for (let i = 1; i < n; i++) {
      const prev = Nn[i - 1];
      const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]);
      Nn.push(prev.clone().applyQuaternion(q).addScaledVector(T[i], -prev.dot(T[i])).normalize());
    }
    // arc length for v
    const tile = o.uvTile || this.tile;
    const arcLen = [0];
    for (let i = 1; i < n; i++) {
      const a = R[i - 1].c, b = R[i].c;
      arcLen.push(arcLen[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    let maxPer = 0;
    for (const r of R) maxPer = Math.max(maxPer, Math.PI * ((r.rx ?? r.r) + (r.rz ?? r.r)));
    const uRep = Math.max(1, Math.round(maxPer / tile));
    const pos = [], uv = [], idx = [], ringOf = [];
    const start = [];     // first vertex index of each ring; pole rings have one vertex
    const B = new THREE.Vector3();
    const noise = o.noise;
    const arc = o.arc || null;
    for (let i = 0; i < n; i++) {
      const r = R[i];
      const rx = r.rx ?? r.r, rz = r.rz ?? r.r;
      start.push(pos.length / 3);
      if (rx < 1e-4 && rz < 1e-4) {
        pos.push(r.c[0], r.c[1], r.c[2]);
        uv.push(0.5 * uRep, arcLen[i] / tile);
        ringOf.push(i);
        continue;
      }
      B.crossVectors(T[i], Nn[i]).normalize();
      const tw = r.tw || 0;
      for (let s = 0; s <= seg; s++) {
        const th = (arc ? arc[0] + (s / seg) * (arc[1] - arc[0]) : (s / seg) * TAU) + tw;
        const ct = Math.cos(th), st = Math.sin(th);
        let k = o.profile ? o.profile(th, i / (n - 1)) : 1;
        let dx = Nn[i].x * ct * rx + B.x * st * rz;
        let dy = Nn[i].y * ct * rx + B.y * st * rz;
        let dz = Nn[i].z * ct * rx + B.z * st * rz;
        let px = r.c[0] + dx * k, py = r.c[1] + dy * k, pz = r.c[2] + dz * k;
        if (noise) {
          const l = Math.hypot(dx, dy, dz) || 1;
          const d = fbm3(px * noise.freq + (noise.seed || 0), py * noise.freq, pz * noise.freq) * noise.amp;
          px += dx / l * d; py += dy / l * d; pz += dz / l * d;
        }
        if (o.disp) {
          // model-space relief (the zombies' collarbones, ribs, knees): a radial offset from
          // the point and its outward direction
          const l = Math.hypot(dx, dy, dz) || 1;
          const d = o.disp(px, py, pz, dx / l, dy / l, dz / l);
          px += dx / l * d; py += dy / l * d; pz += dz / l * d;
        }
        pos.push(px, py, pz);
        uv.push((s / seg) * uRep * (arc ? (arc[1] - arc[0]) / TAU : 1), arcLen[i] / tile);
        ringOf.push(i);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = start[i], b = start[i + 1];
      const poleA = (i + 1 < n ? start[i + 1] - start[i] : 0) === 1;
      const poleB = (i + 2 < n ? start[i + 2] - start[i + 1] : pos.length / 3 - start[i + 1]) === 1;
      if (poleA && poleB) continue;
      for (let s = 0; s < seg; s++) {
        if (poleA) idx.push(a, b + s + 1, b + s);
        else if (poleB) idx.push(a + s, a + s + 1, b);
        else idx.push(a + s, a + s + 1, b + s + 1, a + s, b + s + 1, b + s);
      }
    }
    // winding: outward faces are counter-clockwise when the frame is right-handed
    if (o.inside) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
    return this._part(pos, idx, uv, o, ringOf, R);
  }

  /**
   * Deformable ellipsoid (a tube from pole to pole along its local Y).
   * @param {number[]} c centre
   * @param {number[]} r radii [x, y, z]
   * @param {object} o { segW, segH, rot:[x,y,z], deform(x,y,z)→{x,y,z} in unit space (mutate), bone, ... }
   */
  ellipsoid(c, r, o = {}) {
    const segW = o.segW || 12, segH = o.segH || 8;
    const pos = [], uv = [], idx = [];
    _q.setFromEuler(_e.set(...(o.rot || [0, 0, 0]), 'XYZ'));
    const tile = o.uvTile || this.tile;
    const uRep = Math.max(1, Math.round(Math.PI * (r[0] + r[2]) / tile));
    const vRep = Math.max(1, Math.round(Math.PI * r[1] / tile));
    const p = { x: 0, y: 0, z: 0 };
    const rowStart = [];
    for (let j = 0; j <= segH; j++) {
      const ph = (j / segH) * Math.PI;              // 0 at the bottom pole
      const sy = -Math.cos(ph), sr = Math.sin(ph);
      rowStart.push(pos.length / 3);
      const pole = j === 0 || j === segH;
      const cnt = pole ? 0 : segW;
      for (let s = 0; s <= cnt; s++) {
        const th = pole ? 0 : (s / segW) * TAU;
        p.x = Math.cos(th) * sr; p.y = sy; p.z = Math.sin(th) * sr;
        if (o.deform) o.deform(p, th, ph);
        _v.set(p.x * r[0], p.y * r[1], p.z * r[2]).applyQuaternion(_q);
        pos.push(_v.x + c[0], _v.y + c[1], _v.z + c[2]);
        uv.push(pole ? 0.5 * uRep : (s / segW) * uRep, (j / segH) * vRep);
      }
    }
    for (let j = 0; j < segH; j++) {
      const a = rowStart[j], b = rowStart[j + 1];
      if (j === 0) { for (let s = 0; s < segW; s++) idx.push(a, b + s + 1, b + s); continue; }
      if (j === segH - 1) { for (let s = 0; s < segW; s++) idx.push(a + s, a + s + 1, b); continue; }
      for (let s = 0; s < segW; s++) idx.push(a + s, a + s + 1, b + s + 1, a + s, b + s + 1, b + s);
    }
    // the sphere above is wound clockwise seen from outside; flip to CCW
    for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
    if (o.inside) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
    return this._part(pos, idx, uv, o);
  }

  /**
   * Any three.js geometry, transformed (at/rot/size or matrix), with part attributes.
   * @param {THREE.BufferGeometry} g
   * @param {object} o { at, rot, size, matrix, keepNormals, ... part options }
   */
  geometry(g, o = {}) {
    if (o.matrix) _m.copy(o.matrix);
    else {
      _q.setFromEuler(_e.set(...(o.rot || [0, 0, 0]), o.order || 'XYZ'));
      const s = o.size || [1, 1, 1];
      _m.compose(_v.set(...(o.at || [0, 0, 0])), _q, _n.set(s[0], s[1], s[2]));
    }
    const P = g.attributes.position, UVa = g.attributes.uv;
    const pos = [], uv = [], idx = [];
    const tile = o.uvTile || this.tile;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      pos.push(_v.x, _v.y, _v.z);
      if (UVa && !o.boxUv) uv.push(UVa.getX(i) * (o.uvScale || 1), UVa.getY(i) * (o.uvScale || 1));
      else uv.push((_v.x + _v.z) / tile, _v.y / tile);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(i);
    return this._part(pos, idx, uv, o);
  }

  /** @returns {THREE.BufferGeometry} */
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aBones', new THREE.Float32BufferAttribute(this.BN, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.IN, 4));
    g.setAttribute('aExt', new THREE.Float32BufferAttribute(this.EX, 2));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }

  /** Plain typed-array snapshot (cacheable across renderers; see geometryFromArrays). */
  arrays() {
    return {
      position: new Float32Array(this.P), normal: new Float32Array(this.N), uv: new Float32Array(this.UV),
      color: new Float32Array(this.C), aBones: new Float32Array(this.BN), aInfo: new Float32Array(this.IN), aExt: new Float32Array(this.EX),
      index: this.vertexCount > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I),
    };
  }
}

/**
 * A fresh BufferGeometry over cached arrays (the arrays are shared, the GPU buffers are
 * per renderer, so disposing the geometry never touches another game's copy).
 */
export function geometryFromArrays(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('aBones', new THREE.BufferAttribute(a.aBones, 2));
  g.setAttribute('aInfo', new THREE.BufferAttribute(a.aInfo, 4));
  g.setAttribute('aExt', new THREE.BufferAttribute(a.aExt, 2));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Helper for ring lists: a straight tube from a to b with n rings, radius r0 → r1. */
export function lineRings(a, b, r0, r1, n, extra) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const ring = { c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], r: r0 + (r1 - r0) * t };
    if (extra) extra(ring, t, i);
    out.push(ring);
  }
  return out;
}
