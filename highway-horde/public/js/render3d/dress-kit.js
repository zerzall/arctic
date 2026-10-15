// Small helpers shared by the set-dressing prop builders (dress-*.js): rods between two
// points, atlas planes lying on the ground or standing on a post, leaf cards, palettes.
// Every prop is written in its own frame: local +x = the way it faces, +y up, +z sideways;
// the geo builder (world-geo.js) has already placed that frame on the ground.

import * as THREE from 'three';
import { T } from './world-geo.js';
import { DET } from './world-surf.js';
import { dressUV, dressSize } from './dress-atlas.js';
import { atlasUV } from './world-tex.js';

export { DET, T, dressUV, dressSize, atlasUV };

/** Surface shorthand for `{ surf: [layer, roughness, metalness] }`. */
export const S = (layer = 0, rough = 0.8, metal = 0) => ({ surf: [layer, rough, metal] });

export const METAL = '#8a9096';
export const STEEL = '#5c6268';
export const RUST = '#6a4a38';
export const WOOD = '#6b4a2c';
export const WOOD_D = '#4a3422';
export const PLASTIC = '#c8c4b8';
export const CANVAS = ['#5a6340', '#6b7449', '#8a7a55', '#3f5a6a', '#7a4a3a', '#a8a08a', '#4a4f35'];
export const BRIGHT = ['#c8281e', '#2a5ac4', '#e0a020', '#2f8a4a', '#d8d8d0', '#7a3a9a', '#e0641c', '#20a0b0'];
export const MUTED = ['#6b2d2a', '#2f4858', '#5b5f63', '#7a6a4f', '#3b4a3a', '#8c7b5a', '#4a3b52', '#355c7d'];

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

/** Cylinder between two local points (radius `rad`, optional taper `top` = top/bottom radius). */
export function rod(D, bucket, p0, p1, rad, color, o = null, seg = 6, top = 1) {
  _d.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = _d.length();
  if (len < 1e-4) return;
  _q.setFromUnitVectors(_up, _d.normalize());
  _e.setFromQuaternion(_q, 'XYZ');
  D.add(bucket, T.cyl(seg, top), [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], [rad, len, rad], [_e.x, _e.y, _e.z], color, o && o.map ? o : { ...(o || {}), map: 'cyl' });
}

/** Thin box between two local points (planks, straps): width along y', thickness along z'. */
export function plank(D, bucket, p0, p1, w, t, color, o = null, roll = 0) {
  _d.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = _d.length();
  if (len < 1e-4) return;
  _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), _d.normalize());
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
  _e.setFromQuaternion(_q, 'XYZ');
  D.add(bucket, T.box(), [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], [len, w, t], [_e.x, _e.y, _e.z], color, o);
}

/** An atlas picture on a vertical plane facing local +x (standing signs, decals on walls). */
export function pic(D, cell, x, y, z, w, h, o = {}) {
  const { color = '#ffffff', ry = 0, rx = 0, rz = 0, emissive, bucket = 'sign' } = o;
  D.add(bucket, T.plane(), [x, y, z], [w, h, 1], [rx, Math.PI / 2 + ry, rz], color, { uv: dressUV(cell), noAO: true, noJitter: true, emissive });
}

/** An atlas picture facing local +z (side-on views of vehicles and walls along x). */
export function picZ(D, cell, x, y, z, w, h, o = {}) {
  const { color = '#ffffff', ry = 0, rx = 0, rz = 0, emissive, bucket = 'sign' } = o;
  D.add(bucket, T.plane(), [x, y, z], [w, h, 1], [rx, ry, rz], color, { uv: dressUV(cell), noAO: true, noJitter: true, emissive });
}

const _m4 = new THREE.Matrix4();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
/** A plane whose normal points along n (width along the horizontal, up as close to +y as it can be). */
export function facing(D, bucket, cell, pos, w, h, n, o = {}) {
  _bz.set(n[0], n[1], n[2]).normalize();
  _bx.set(0, 1, 0).cross(_bz);
  if (_bx.lengthSq() < 1e-6) _bx.set(1, 0, 0);
  _bx.normalize();
  _by.crossVectors(_bz, _bx);
  _m4.makeBasis(_bx, _by, _bz);
  _e.setFromRotationMatrix(_m4, 'XYZ');
  D.add(bucket, T.plane(), pos, [w, h, 1], [_e.x, _e.y, _e.z], o.color || '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
}

/** A flat mark lying on the ground (bucket 'flat' or 'wet'); w along local x, d along z. */
export function mark(D, cell, x, z, w, d, rot = 0, color = '#ffffff', y = 0.25, bucket = 'flat') {
  D.add(bucket, T.plane(), [x, y, z], [w, d, 1], [-Math.PI / 2, 0, rot], color, { uv: dressUV(cell), noAO: true, noJitter: true });
}

/** A horizontal atlas picture at height y (a newspaper, a leaflet): opaque, on the sign bucket. */
export function sheet(D, cell, x, y, z, w, d, rot = 0, color = '#ffffff', tilt = [0, 0]) {
  D.add('sign', T.plane(), [x, y, z], [w, d, 1], [-Math.PI / 2 + tilt[0], tilt[1], rot], color, { uv: dressUV(cell), noAO: true, noJitter: true });
}

/** Leaf-card accumulator (the 'leaves' bucket): quads with upward-ish normals. */
export function cards() {
  return { pos: [], nor: [], uv: [] };
}
const _cq = new THREE.Quaternion();
const _cv = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
/** One card centred at c facing f (unit vector), size w × h, atlas rect. */
export function card(list, c, f, spin, w, h, rect, bend = 0) {
  _cq.setFromUnitVectors(_z, new THREE.Vector3(f[0], f[1], f[2]).normalize());
  _cq.multiply(new THREE.Quaternion().setFromAxisAngle(_z, spin));
  const P = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => {
    _cv.set(x * w, y * h, (x * x + y * y) * bend).applyQuaternion(_cq);
    return [c[0] + _cv.x, c[1] + _cv.y, c[2] + _cv.z];
  });
  const n = [0, 1, 0.2];
  const nl = Math.hypot(n[0], n[1], n[2]);
  const [u0, v0, u1, v1] = rect;
  const U = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (const k of [0, 1, 2, 0, 2, 3]) {
    list.pos.push(...P[k]);
    list.nor.push(n[0] / nl, n[1] / nl, n[2] / nl);
    list.uv.push(...U[k]);
  }
}
export function cardGeo(list) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(list.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(list.uv, 2));
  return g;
}

/** Wavy cloth panel (the 'cloth' bucket): a subdivided plane in local x (length) × y (height); uv.y = 0 at the pinned top edge. */
export function clothGeo(nx = 6, ny = 3) {
  return T.custom(`cloth${nx}x${ny}`, () => {
    const g = new THREE.PlaneGeometry(1, 1, nx, ny);
    return g;
  });
}

/** Random pick from an array with the builder's rng. */
export const pick = (D, arr) => arr[Math.floor(D.rng.next() * arr.length) % arr.length];
export const range = (D, a, b) => a + (b - a) * D.rng.next();
