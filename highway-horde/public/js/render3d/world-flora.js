// Trees, bushes and undergrowth of the static world (WORLD, SPEC §7.5). Species by map and
// tree: oak, maple (autumn colours), birch (white bark, small pale leaves), pine, spruce,
// dead trees (a skeleton of bare limbs), and in the desert dead trees, palms and flat-topped
// acacias. Trunks flare into roots; crowns are alpha-tested leaf-cluster cards (world-veg's
// `card`) around a dark inner mass, with normals out of the crown so they shade like foliage.
// Bushes come as leafy, flowering, hedge, fern clumps and (desert) agave, cacti and dry
// scrub. `scatterFlora` adds the undergrowth: ferns and logs under trees, weeds along
// fences and building bases, ivy climbing walls, tall grass on the road verges.

import * as THREE from 'three';
import { T, shadeHex, hash01, seededRng } from './world-geo.js';
import { DET } from './world-surf.js';
import { LEAF_CELLS } from './world-tex.js';
import { DETAIL } from './world-arch.js';

export const LEAF = ['#2a4a26', '#31502a', '#3a5a2c', '#2c4628', '#40582e'];
export const PINE = ['#1f3a26', '#24402a', '#2a4630', '#1d3624'];
const BARK = '#4a3a2a';
const AUTUMN = ['#b3401c', '#c8641a', '#d29a22', '#a02a1c', '#9a7a1c'];
const BIRCH_LEAF = ['#7a9a3a', '#8fae4a', '#a2b24e', '#6f9438'];
const PALM = ['#3f5f2a', '#4a6a2c', '#385a26'];
const FLOWERS = ['#d8d24a', '#ececdf', '#c15ab0', '#d8402e', '#7a6ad8', '#f09a2a'];

// ---- card helpers -------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _up = new THREE.Vector3(0, 1, 0);

/** Accumulates leaf cards (quads) with crown-radial normals. */
export function cardList() {
  return { pos: [], nor: [], uv: [] };
}

/**
 * One card: centre c, facing direction f (unit), spin about f, size w x h, crown centre `cc`
 * (normals are blended toward c - cc), atlas rect uv.
 */
export function card(list, c, f, spin, w, h, cc, rect, bend = 0) {
  _q.setFromUnitVectors(_z, f);
  _qs.setFromAxisAngle(_z, spin);
  _q.multiply(_qs);
  const [u0, v0, u1, v1] = rect;
  // corner order: (-,-) (+,-) (+,+) (-,+); two triangles 0 1 2, 0 2 3
  for (let k = 0; k < 4; k++) {
    const x = CORN[k * 2], y = CORN[k * 2 + 1];
    _v.set(x * w, y * h, (x * x + y * y) * bend).applyQuaternion(_q);
    const px = c[0] + _v.x, py = c[1] + _v.y, pz = c[2] + _v.z;
    _n.set(px - cc[0], (py - cc[1]) * 0.8 + 0.25 * Math.abs(cc[1]) * 0.01, pz - cc[2]).normalize().multiplyScalar(0.65);
    _n.x += f.x * 0.35; _n.y += f.y * 0.35; _n.z += f.z * 0.35;
    _n.normalize();
    const o = k * 3;
    _cp[o] = px; _cp[o + 1] = py; _cp[o + 2] = pz;
    _cn[o] = _n.x; _cn[o + 1] = _n.y; _cn[o + 2] = _n.z;
  }
  const us = [u0, u1, u1, u0], vs = [v0, v0, v1, v1];
  for (let t = 0; t < 6; t++) {
    const k = QUAD[t], o = k * 3;
    list.pos.push(_cp[o], _cp[o + 1], _cp[o + 2]);
    list.nor.push(_cn[o], _cn[o + 1], _cn[o + 2]);
    list.uv.push(us[k], vs[k]);
  }
}
const _qs = new THREE.Quaternion();
const _cp = new Float64Array(12), _cn = new Float64Array(12);
const CORN = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
const QUAD = [0, 1, 2, 0, 2, 3];

/**
 * A strip card along `u` (unit) from `base`, `segs` quads long, drooping by `droop` at the end
 * (a palm frond): the texture's left edge is the base. `v` is the sideways direction.
 */
export function stripCard(list, base, u, v, len, wid, rect, droop, segs = 5, nUp = 0.85) {
  const [u0, v0, u1, v1] = rect;
  const pts = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const c = [base[0] + u.x * len * t, base[1] + u.y * len * t - droop * t * t, base[2] + u.z * len * t];
    pts.push(c);
  }
  const nrm = [u.z * 0.2 * 0 + 0, nUp, 0];
  for (let s = 0; s < segs; s++) {
    const a = pts[s], b = pts[s + 1];
    const ua = u0 + (u1 - u0) * (s / segs), ub = u0 + (u1 - u0) * ((s + 1) / segs);
    const q = [
      [a[0] - v.x * wid / 2, a[1] - v.y * wid / 2, a[2] - v.z * wid / 2, ua, v0],
      [b[0] - v.x * wid / 2, b[1] - v.y * wid / 2, b[2] - v.z * wid / 2, ub, v0],
      [b[0] + v.x * wid / 2, b[1] + v.y * wid / 2, b[2] + v.z * wid / 2, ub, v1],
      [a[0] + v.x * wid / 2, a[1] + v.y * wid / 2, a[2] + v.z * wid / 2, ua, v1],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      list.pos.push(q[k][0], q[k][1], q[k][2]);
      list.nor.push(u.x * 0.3, nrm[1], u.z * 0.3);
      list.uv.push(q[k][3], q[k][4]);
    }
  }
}

export function listGeo(list) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(list.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(list.uv, 2));
  return g;
}

export const randDir = (r) => {
  const u = r.next() * 2 - 1, a = r.next() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(Math.cos(a) * s, u, Math.sin(a) * s);
};

/** A tapered limb from (x,y,z) along `dir` (unit Vector3): a cone-like cylinder of length len. */
function limb(B, x, y, z, dir, len, rad, col, taper = 0.4, seg = 5) {
  const e = new THREE.Euler().setFromQuaternion(_q.setFromUnitVectors(_up, dir));
  B.add('std', T.cyl(seg, taper), [x + dir.x * len / 2, y + dir.y * len / 2, z + dir.z * len / 2], [rad, len, rad], [e.x, e.y, e.z], col, { surf: [DET.bark, 0.9, 0], map: 'cyl', noJitter: true });
}

// ---- species -------------------------------------------------------------------------------------

const state = { desert: false, cell: 48, canopies: new Map(), map: null, force: null };

const key = (x, y) => Math.floor(x / state.cell) + ',' + Math.floor(y / state.cell);

/** Species of the i-th canopy decor. */
function speciesByIndex(i) {
  const r = hash01(i * 7 + 3);
  // (a story hideout names the species it grows: map.look.trees)
  if (state.force) return state.force[Math.floor(r * state.force.length) % state.force.length];
  if (state.desert) return r < 0.42 ? 'dead' : r < 0.72 ? 'palm' : 'acacia';
  return r < 0.26 ? 'pine' : r < 0.52 ? 'oak' : r < 0.67 ? 'birch' : r < 0.78 ? 'maple' : r < 0.86 ? 'dead' : 'spruce';
}

/** Index the map's canopy decor by species so the trunk obstacles agree with their crowns. */
export function setBiome(map) {
  const gc = new THREE.Color(map.ground);
  state.desert = gc.r > gc.g * 1.05;
  state.force = map.look && Array.isArray(map.look.trees) && map.look.trees.length ? map.look.trees : null;
  state.canopies.clear();
  state.map = map;
  map.decor.forEach((d, i) => {
    if (d.kind !== 'tree_canopy') return;
    const k = key(d.x, d.y);
    const arr = state.canopies.get(k) || [];
    arr.push({ x: d.x, y: d.y, sp: speciesByIndex(i) });
    state.canopies.set(k, arr);
  });
}

function speciesNear(x, y) {
  let best = null, bd = 60 * 60;
  const cx = Math.floor(x / state.cell), cy = Math.floor(y / state.cell);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const arr = state.canopies.get((cx + i) + ',' + (cy + j));
    if (!arr) continue;
    for (const c of arr) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c.sp; }
    }
  }
  if (best) return best;
  const r = hash01(Math.round(x) * 73856093 ^ Math.round(y) * 19349663);
  if (state.force) return state.force[Math.floor(r * state.force.length) % state.force.length];
  return state.desert ? (r < 0.6 ? 'dead' : 'palm') : r < 0.5 ? 'oak' : r < 0.8 ? 'pine' : 'birch';
}

// ---- trunks --------------------------------------------------------------------------------------------

/** Trunk of a 'tree' obstacle (w = trunk size), by species: flare, roots, limbs. */
export function trunk(B, size, o) {
  const r = B.rng;
  const sp = speciesNear(o.x, o.y);
  const rad = size * 0.28;
  const S = { wobble: { amp: 0.07, seed: o.id }, surf: [DET.bark, 0.85, 0] };
  if (sp === 'palm') {
    // a slender, slightly leaning trunk in ringed segments
    const lean = r.range(-0.06, 0.06), a = r.range(0, 6.28);
    let x = 0, z = 0;
    for (let s = 0; s < 7; s++) {
      const h = 16;
      B.cyl('std', x, s * h, z, rad * (0.62 - s * 0.03), h + 1, s % 2 ? '#7a6448' : '#8a7452', 8, 0.93, null, { surf: [DET.bark, 0.9, 0], noJitter: true });
      x += Math.cos(a) * lean * h; z += Math.sin(a) * lean * h;
    }
    B.cyl('std', 0, 0, 0, rad * 0.9, 6, '#6a5238', 8, 0.7, null, { surf: [DET.bark, 0.9, 0] });
    return;
  }
  let col = o.color || BARK;
  if (sp === 'birch') col = '#cfcabc';
  else if (sp === 'dead') col = '#6b645a';
  else if (sp === 'pine' || sp === 'spruce') col = '#3a2c20';
  const tall = sp === 'pine' || sp === 'spruce' ? 130 : 104;
  const topK = sp === 'dead' ? 0.62 : 0.55;
  const cin = DETAIL.level >= 3;
  const tseg = cin ? 16 : sp === 'birch' ? 8 : 9;
  B.cyl('std', 0, 0, 0, rad, tall, col, tseg, topK, null, { wobble: { amp: cin ? 0.05 : 0.07, seed: o.id }, surf: [sp === 'birch' ? DET.plaster : DET.bark, 0.85, 0] });
  B.cyl('std', 0, 0, 0, rad * 1.45, 9, shadeHex(col, -0.15), cin ? 16 : 9, 0.68, null, { surf: [DET.bark, 0.9, 0] });
  if (cin && sp !== 'palm') {
    // bark in bands: a second, slightly wider skin in short sleeves with a darker seam between them
    for (let k = 0; k < 6; k++) B.cyl('std', 0, 18 + k * 17 + r.range(-3, 3), 0, rad * (1.02 - k * 0.055) * (topK < 0.6 ? 1 : 1), r.range(6, 11), shadeHex(col, r.range(-0.12, 0.06)), 14, 0.97, null, { wobble: { amp: 0.09, seed: o.id + k }, surf: [DET.bark, 0.9, 0], noJitter: true });
    // knots and a scar
    for (let k = 0; k < 3; k++) {
      const a = r.range(0, 6.28), y = r.range(20, tall * 0.7);
      B.add('std', T.sphere(7, 5), [Math.cos(a) * rad * (1 - y / tall * 0.4) * 0.98, y, Math.sin(a) * rad * (1 - y / tall * 0.4) * 0.98], [rad * 0.16, rad * 0.22, rad * 0.16], null, shadeHex(col, -0.3), { surf: [DET.bark, 0.9, 0], noJitter: true });
    }
  }
  if (sp === 'birch') {
    // dark scars ringing the white bark
    for (let k = 0; k < 8; k++) B.cyl('std', 0, 10 + k * 11 + r.range(0, 4), 0, rad * (0.99 - k * 0.04), 1.6 + r.range(0, 1.6), '#2a2622', 8, 1, null, { noJitter: true, surf: [DET.bark, 0.9, 0] });
  }
  // roots: buttresses running out over the ground
  if (DETAIL.level >= 1) {
    const nr = (sp === 'oak' || sp === 'maple' ? 5 : 3) + (DETAIL.level >= 3 ? 3 : 0);
    for (let k = 0; k < nr; k++) {
      const a = (k / nr) * 6.28 + r.range(-0.3, 0.3);
      const dir = new THREE.Vector3(Math.cos(a), -0.32, Math.sin(a)).normalize();
      limb(B, Math.cos(a) * rad * 0.6, 7, Math.sin(a) * rad * 0.6, dir, rad * 3 + r.range(0, 8), rad * 0.5, shadeHex(col, -0.1), 0.25, 5);
    }
  }
  // limbs fork upward into the crown (they stay inside it: no bare sticks poking out)
  if (sp === 'oak' || sp === 'maple' || sp === 'birch') {
    for (let i = 0; i < 4; i++) {
      const a = r.range(0, 6.28) + i * 1.6;
      const y = 96 + i * 10;
      const tilt = 0.55 + r.range(0, 0.2);
      B.add('std', T.cyl(7, 0.25), [Math.cos(a) * (rad * 0.6 + 9), y + 14, Math.sin(a) * (rad * 0.6 + 9)], [rad * 0.3, 34 - i * 3, rad * 0.3], [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt], col, { surf: [DET.bark, 0.85, 0], map: 'cyl' });
    }
  }
}

// ---- crowns ------------------------------------------------------------------------------------------------

/** Canopy of a 'tree_canopy' decor (centred on the trunk), by species. */
export function canopy(B, d, i) {
  const sp = speciesByIndex(i);
  const R = 44 * (d.s || 1);
  const r = seededRng(i * 7919 + 17);
  switch (sp) {
    case 'pine': return pineCrown(B, R, r, 7, 1.15);
    case 'spruce': return pineCrown(B, R * 0.8, r, 9, 1.0);
    case 'birch': return broadCrown(B, R * 0.86, r, i, { leaf: BIRCH_LEAF, cell: LEAF_CELLS.birch, clumps: 8, top: 175, cardsPer: 13 });
    case 'maple': return broadCrown(B, R, r, i, { leaf: AUTUMN, cell: null, clumps: 9, top: 160, cardsPer: 15 });
    case 'dead': return deadCrown(B, R, r, i);
    case 'palm': return palmCrown(B, R, r);
    case 'acacia': return acaciaCrown(B, R, r, i);
    default: return broadCrown(B, R, r, i, { leaf: LEAF, cell: null, clumps: 7 + Math.floor(r.next() * 4), top: 160, cardsPer: 14 });
  }
}

/** Cinematic conifer: whorls of drooping branches, each with needle clusters along it and a thin core. */
function pineCrownCin(B, R, r, layers, k) {
  const top = 200 + R * 1.4;
  const col = r.pick(PINE);
  const cards = cardList();
  const cards2 = cardList();
  B.cyl('std', 0, 60, 0, R * 0.2, top - 62, shadeHex(col, -0.5), 8, 0.04, null, { surf: [DET.bark, 0.95, 0], noAO: true });
  const nW = layers * 2 + 5;
  for (let m = 0; m < nW; m++) {
    const t = m / (nW - 1);
    const y = 72 + t * (top - 100);
    const rad = R * (k - t * 0.92);
    const nb = Math.max(5, Math.round(10 - t * 5));
    const a0 = r.range(0, 6.28);
    for (let q = 0; q < nb; q++) {
      const a = a0 + (q / nb) * Math.PI * 2 + r.range(-0.22, 0.22);
      const len = rad * r.range(0.8, 1.05);
      const droop = -0.16 - t * 0.05 - r.range(0, 0.08);
      const dir = new THREE.Vector3(Math.cos(a), droop, Math.sin(a)).normalize();
      limb(B, 0, y, 0, dir, len, 1.3 - t * 0.7, '#3a2c20', 0.2, 5);
      for (let c = 0; c < 3; c++) {
        const s = 0.42 + c * 0.27;
        const droopY = -len * s * 0.06 * (0.5 + c * 0.7);
        const p = [dir.x * len * s, y + dir.y * len * s + droopY, dir.z * len * s];
        const f = new THREE.Vector3(dir.x * 0.4, 0.85, dir.z * 0.4).normalize();
        const w = rad * (0.62 - c * 0.13) * r.range(0.9, 1.15);
        card(c % 2 ? cards : cards2, p, f, a + Math.PI / 2 + r.range(-0.4, 0.4), w, w * r.range(0.85, 1.15), [0, y + 14, 0], LEAF_CELLS.pine, -0.12);
      }
    }
  }
  // the leader: a tuft of upright needles
  for (let q = 0; q < 6; q++) {
    const a = q * 1.05 + r.range(-0.2, 0.2);
    card(cards, [Math.cos(a) * 3, top - 26, Math.sin(a) * 3], new THREE.Vector3(Math.cos(a) * 0.45, 0.85, Math.sin(a) * 0.45).normalize(), a, 16, 34, [0, top - 40, 0], LEAF_CELLS.pine, 0);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  B.add('leaves', listGeo(cards2), [0, 0, 0], [1, 1, 1], null, shadeHex(col, 0.12), { noAO: true });
}

function pineCrown(B, R, r, layers, k) {
  if (DETAIL.level >= 3) return pineCrownCin(B, R, r, layers, k);
  const cards = cardList();
  const top = 200 + R * 1.4;
  const col = r.pick(PINE);
  B.cyl('std', 0, 60, 0, R * 0.55, top - 70, shadeHex(col, -0.45), 8, 0.05, null, { surf: [DET.bark, 0.95, 0], noAO: true });
  for (let m = 0; m < layers; m++) {
    const t = m / (layers - 1);
    const y = 70 + t * (top - 95);
    const rad = R * (k - t * 0.9);
    const n = Math.max(5, Math.round(12 - t * 6));
    for (let q = 0; q < n; q++) {
      const a = (q / n) * Math.PI * 2 + r.range(-0.25, 0.25) + m * 0.7;
      const out = rad * r.range(0.45, 0.7);
      const c = [Math.cos(a) * out, y - rad * 0.15, Math.sin(a) * out];
      // boughs droop: the card faces up and out
      const f = new THREE.Vector3(Math.cos(a) * 0.55, 0.8, Math.sin(a) * 0.55).normalize();
      card(cards, c, f, a + Math.PI / 2 + r.range(-0.3, 0.3), rad * 1.15, rad * 0.8, [0, y + 10, 0], LEAF_CELLS.pine, -0.1);
    }
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
}

function broadCrown(B, R, r, i, o) {
  if (DETAIL.level >= 3) return broadCrownCin(B, R, r, i, o);
  const cards = cardList();
  const top = o.top + R * 1.3 - 44 * 1.3;
  const col = r.pick(o.leaf);
  const cc = [0, top - R * 1.2, 0];
  // a small dark inner mass: the crown never reads as see-through paper
  B.add('std', T.ico(1), cc, [R * 0.55, R * 0.45, R * 0.55], [0, r.range(0, 3), 0], shadeHex(col, -0.4), { wobble: { amp: 0.25, seed: i }, surf: [DET.grass, 0.95, 0], noAO: true });
  // a few visible boughs from the trunk top to the clump centres
  const ctrs = [];
  for (let k = 0; k < o.clumps; k++) {
    const dir = k === 0 ? new THREE.Vector3(0, 1, 0) : randDir(r);
    dir.y = dir.y * 0.55 - (k === 0 ? 0 : 0.08);
    const cr = R * (k === 0 ? 0.62 : r.range(0.45, 0.66));
    const ctr = [cc[0] + dir.x * R * 0.8, cc[1] + dir.y * R * 0.7, cc[2] + dir.z * R * 0.8];
    ctrs.push(ctr);
    const n = o.cardsPer + Math.floor(r.next() * 6);
    // maples: each clump its own autumn colour comes from a separate card list
    for (let m = 0; m < n; m++) {
      const f = randDir(r);
      if (f.y < -0.4) f.y = -f.y * 0.5;
      const c = [ctr[0] + f.x * cr * 0.75, ctr[1] + f.y * cr * 0.65, ctr[2] + f.z * cr * 0.75];
      const sz = cr * r.range(1.1, 1.6);
      card(cards, c, f, r.range(0, 6.28), sz, sz, cc, o.cell || (r.chance(0.5) ? LEAF_CELLS.broadA : LEAF_CELLS.broadB), sz * 0.12);
    }
    if (DETAIL.level >= 1 && k > 0 && k < 5) {
      const dv = new THREE.Vector3(ctr[0], ctr[1] - 96, ctr[2]);
      const len = dv.length();
      dv.normalize();
      limb(B, 0, 96, 0, dv, len * 0.7, 2.6 - k * 0.3, '#3f3226', 0.3, 5);
    }
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  if (o.leaf === AUTUMN && DETAIL.level >= 1) {
    // a second, differently coloured pass of cards on the crown's shoulders
    const c2 = cardList();
    for (let m = 0; m < 30; m++) {
      const f = randDir(r);
      const c = [cc[0] + f.x * R * 0.9, cc[1] + f.y * R * 0.6, cc[2] + f.z * R * 0.9];
      card(c2, c, f, r.range(0, 6.28), R * 0.5, R * 0.5, cc, LEAF_CELLS.broadB, 3);
    }
    B.add('leaves', listGeo(c2), [0, 0, 0], [1, 1, 1], null, r.pick(AUTUMN), { noAO: true });
  }
}

/** Cinematic broadleaf: a branch skeleton (limbs, sub-branches, twigs) with many small leaf clusters in three tones. */
function broadCrownCin(B, R, r, i, o) {
  const top = o.top + R * 1.3 - 44 * 1.3;
  const col = r.pick(o.leaf);
  const cc = [0, top - R * 1.2, 0];
  const tones = [cardList(), cardList(), cardList()];
  const shades = [shadeHex(col, -0.1), col, shadeHex(col, 0.14)];
  B.add('std', T.ico(1), cc, [R * 0.5, R * 0.4, R * 0.5], [0, r.range(0, 3), 0], shadeHex(col, -0.45), { wobble: { amp: 0.25, seed: i }, surf: [DET.grass, 0.95, 0], noAO: true });
  const clumps = o.clumps + 4;
  const base = new THREE.Vector3(0, 96, 0);
  for (let k = 0; k < clumps; k++) {
    const dir = k === 0 ? new THREE.Vector3(0, 1, 0) : randDir(r);
    dir.y = dir.y * 0.55 - (k === 0 ? 0 : 0.06);
    const cr = R * (k === 0 ? 0.55 : r.range(0.36, 0.55));
    const ctr = [cc[0] + dir.x * R * 0.88, cc[1] + dir.y * R * 0.78, cc[2] + dir.z * R * 0.88];
    // limb from the trunk to a fork, then a sub-branch into the clump, then twigs into its leaves
    if (k > 0 && k < 9) {
      const fork = [ctr[0] * 0.55, 96 + (ctr[1] - 96) * 0.5, ctr[2] * 0.55];
      const d1 = new THREE.Vector3(fork[0], fork[1] - 96, fork[2]);
      const l1 = d1.length(); d1.normalize();
      limb(B, 0, 96, 0, d1, l1, 3.2 - k * 0.15, '#3f3226', 0.55, 6);
      const d2 = new THREE.Vector3(ctr[0] - fork[0], ctr[1] - fork[1], ctr[2] - fork[2]);
      const l2 = d2.length(); d2.normalize();
      limb(B, fork[0], fork[1], fork[2], d2, l2 * 0.9, 1.9, '#3f3226', 0.4, 5);
      for (let tw = 0; tw < 3; tw++) {
        const d3 = d2.clone().add(randDir(r).multiplyScalar(0.7)).normalize();
        limb(B, ctr[0], ctr[1], ctr[2], d3, cr * 0.7, 0.8, '#3f3226', 0.3, 4);
      }
    }
    const n = 16 + Math.floor(r.next() * 8);
    for (let m = 0; m < n; m++) {
      const f = randDir(r);
      if (f.y < -0.4) f.y = -f.y * 0.5;
      const c = [ctr[0] + f.x * cr * 0.85, ctr[1] + f.y * cr * 0.72, ctr[2] + f.z * cr * 0.85];
      const sz = cr * r.range(0.8, 1.15);
      // outer, sun-facing cards are lighter; the ones deep in the crown are dark
      const outer = f.y * 0.6 + (Math.hypot(f.x, f.z) > 0.6 ? 0.25 : 0) + r.range(-0.3, 0.3);
      const tone = outer > 0.5 ? 2 : outer > 0 ? 1 : 0;
      card(tones[tone], c, f, r.range(0, 6.28), sz, sz, cc, o.cell || (r.chance(0.5) ? LEAF_CELLS.broadA : LEAF_CELLS.broadB), sz * 0.12);
    }
  }
  for (let t = 0; t < 3; t++) B.add('leaves', listGeo(tones[t]), [0, 0, 0], [1, 1, 1], null, o.leaf === AUTUMN && t !== 1 ? r.pick(AUTUMN) : shades[t], { noAO: true });
  void base;
}

function deadCrown(B, R, r, i) {
  // a skeleton: limbs forking three levels, silver-grey wood
  const col = '#6b645a';
  const grow = (x, y, z, dir, len, rad, depth) => {
    limb(B, x, y, z, dir, len, rad, col, 0.45, 5);
    const ex = x + dir.x * len, ey = y + dir.y * len, ez = z + dir.z * len;
    if (depth <= 0) return;
    const kids = depth > 1 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const nd = dir.clone().add(randDir(r).multiplyScalar(0.75)).normalize();
      if (nd.y < -0.1) nd.y = -nd.y * 0.4;
      nd.normalize();
      grow(ex, ey, ez, nd, len * r.range(0.6, 0.82), rad * 0.62, depth - 1);
    }
  };
  const nMain = 3 + Math.floor(r.next() * 2);
  for (let k = 0; k < nMain; k++) {
    const a = (k / nMain) * 6.28 + r.range(-0.4, 0.4);
    const dir = new THREE.Vector3(Math.cos(a) * 0.65, 0.75, Math.sin(a) * 0.65).normalize();
    grow(Math.cos(a) * 3, 96 + k * 4, Math.sin(a) * 3, dir, 42 * (R / 44) + r.range(0, 12), 4.2, DETAIL.level >= 1 ? 3 : 2);
  }
  void i;
}

function palmCrown(B, R, r) {
  const cards = cardList();
  const top = 7 * 16 + 4;
  const n = 11;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r.range(-0.2, 0.2);
    const up = 0.35 - (k % 3) * 0.25;
    const u = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
    const v = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    stripCard(cards, [0, top, 0], u, v, R * 1.55 + r.range(-6, 8), R * 0.62, LEAF_CELLS.frond, 24 + r.range(0, 16), 5);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, r.pick(PALM), { noAO: true });
  // the coconut cluster under the fronds
  if (DETAIL.level >= 1) for (let k = 0; k < 4; k++) B.add('std', T.sphere(6, 4), [Math.cos(k * 1.6) * 4, top - 3, Math.sin(k * 1.6) * 4], [2.6, 3, 2.6], null, '#4a3a22', { surf: [DET.bark, 0.8, 0], noJitter: true });
}

function acaciaCrown(B, R, r, i) {
  // a flat, spreading umbrella of leaf mats on forked limbs
  const cards = cardList();
  const top = 122;
  const col = r.pick(['#5a6a30', '#66703a', '#4a5e2c']);
  const nCl = 4;
  for (let k = 0; k < nCl; k++) {
    const a = (k / nCl) * 6.28 + r.range(-0.4, 0.4);
    const rr = k === 0 ? 0 : R * r.range(0.45, 0.75);
    const c = [Math.cos(a) * rr, top + r.range(-6, 10), Math.sin(a) * rr];
    const dir = new THREE.Vector3(c[0], c[1] - 94, c[2]);
    const len = dir.length();
    dir.normalize();
    limb(B, 0, 94, 0, dir, len, 3.4 - k * 0.3, '#4a3a2c', 0.35, 5);
    for (let m = 0; m < 9; m++) {
      const f = new THREE.Vector3(r.range(-0.3, 0.3), 1, r.range(-0.3, 0.3)).normalize();
      const q = [c[0] + r.range(-R * 0.4, R * 0.4), c[1] + r.range(-4, 6), c[2] + r.range(-R * 0.4, R * 0.4)];
      card(cards, q, f, r.range(0, 6.28), R * r.range(0.6, 0.9), R * r.range(0.6, 0.9), [0, top - 30, 0], LEAF_CELLS.scrub, 2);
    }
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  void i;
}

// ---- bushes ------------------------------------------------------------------------------------------------

/** A bush decor: leafy, flowering, a hedge or a fern clump; in the desert agave, cactus, scrub. */
export function bush(B, d, i) {
  const s = d.s || 1;
  const r = seededRng(i * 131 + 7);
  const kind = hash01(i * 17 + 5);
  if (state.desert) return desertPlant(B, s, r, i, kind);
  if (kind < 0.16) return fernClump(B, s, r);
  if (kind < 0.28) return hedge(B, s, r, i);
  const R = 15 * s;
  const col = r.pick(LEAF);
  const cards = cardList();
  B.add('std', T.ico(0), [0, R * 0.45, 0], [R * 0.7, R * 0.5, R * 0.7], [0, r.range(0, 6), 0], shadeHex(col, -0.5), { wobble: { amp: 0.2, seed: i }, surf: [DET.grass, 0.95, 0] });
  const cc = [0, R * 0.4, 0];
  const n = 10 + (i % 5);
  for (let m = 0; m < n; m++) {
    const f = randDir(r);
    if (f.y < 0) f.y = -f.y * 0.4;
    const c = [f.x * R * 0.6, R * 0.35 + f.y * R * 0.55, f.z * R * 0.6];
    const sz = R * r.range(0.9, 1.3);
    card(cards, c, f, r.range(0, 6.28), sz, sz, cc, LEAF_CELLS.scrub, sz * 0.1);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  // blossoms on some bushes
  if (kind > 0.72 && DETAIL.level >= 1) {
    const fc = r.pick(FLOWERS);
    for (let m = 0; m < 12; m++) {
      const f = randDir(r);
      if (f.y < 0.1) f.y = 0.1;
      B.add('std', T.sphere(4, 3), [f.x * R * 0.85, R * 0.4 + f.y * R * 0.75, f.z * R * 0.85], [1.5, 1.2, 1.5], null, fc, { surf: [DET.fabric, 0.7, 0], noJitter: true });
    }
  }
}

function hedge(B, s, r, i) {
  const R = 13 * s;
  const col = r.pick(LEAF);
  const cards = cardList();
  const len = 38 * s;
  B.rblock('std', 0, 0, 0, len, R * 1.5, R * 1.4, 3, shadeHex(col, -0.4), null, { surf: [DET.grass, 0.95, 0] });
  const cc = [0, R * 0.7, 0];
  for (let m = 0; m < 26; m++) {
    const f = randDir(r);
    if (f.y < 0) f.y = -f.y * 0.3;
    const c = [r.range(-len / 2, len / 2), R * 0.75 + f.y * R * 0.7, f.z * R * 0.6];
    card(cards, c, f, r.range(0, 6.28), R * 1.1, R * 1.1, [c[0], cc[1], 0], LEAF_CELLS.scrub, 1.2);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  void i;
}

function fernClump(B, s, r) {
  const cards = cardList();
  const R = 12 * s;
  for (let m = 0; m < 7; m++) {
    const a = (m / 7) * 6.28 + r.range(-0.3, 0.3);
    const f = new THREE.Vector3(Math.cos(a) * 0.7, 0.55, Math.sin(a) * 0.7).normalize();
    card(cards, [Math.cos(a) * R * 0.35, R * 0.55, Math.sin(a) * R * 0.35], f, r.range(-0.3, 0.3), R * 1.2, R * 1.5, [0, 0, 0], LEAF_CELLS.fern, R * 0.15);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, r.pick(['#2f5a2a', '#3a6a30', '#2a4c26']), { noAO: true });
}

function desertPlant(B, s, r, i, kind) {
  if (kind < 0.16) return agave(B, s, r);
  if (kind < 0.26) return cactus(B, s, r);
  // dry scrub: a knot of grey twigs with a few pale leaves
  const R = 14 * s;
  const cards = cardList();
  for (let m = 0; m < 9; m++) {
    const dir = new THREE.Vector3(r.range(-0.7, 0.7), r.range(0.6, 1.2), r.range(-0.7, 0.7)).normalize();
    limb(B, r.range(-2, 2), 0, r.range(-2, 2), dir, R * r.range(0.9, 1.5), 0.7, '#5e5040', 0.3, 4);
  }
  for (let m = 0; m < 7; m++) {
    const f = randDir(r);
    if (f.y < 0) f.y = -f.y * 0.4;
    card(cards, [f.x * R * 0.5, R * 0.55 + f.y * R * 0.4, f.z * R * 0.5], f, r.range(0, 6.28), R * 0.9, R * 0.9, [0, R * 0.4, 0], LEAF_CELLS.scrub, 1);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, r.pick(['#7a7a3e', '#8a8442', '#6a723a']), { noAO: true });
  void i;
}

function agave(B, s, r) {
  const n = 10;
  const col = r.pick(['#5f7f5c', '#6a8a62', '#56745a']);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.28 * 2.4;
    const tilt = 0.25 + (k / n) * 1.05;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
    limb(B, 0, 0, 0, dir, (16 - k * 0.6) * s, 2.1 * s, col, 0.05, 3);
  }
  B.add('std', T.ico(0), [0, 2, 0], [3 * s, 3 * s, 3 * s], null, '#3f5a3c', { surf: [DET.grass, 0.9, 0], noJitter: true });
}

function cactus(B, s, r) {
  const col = r.pick(['#5a7a52', '#4f7048', '#62805a']);
  const h = (34 + r.range(0, 14)) * s;
  const S = { surf: [DET.grass, 0.85, 0], noJitter: true };
  B.cyl('std', 0, 0, 0, 4.4 * s, h, col, 8, 0.92, null, S);
  B.add('std', T.sphere(8, 4), [0, h, 0], [4.05 * s, 4 * s, 4.05 * s], null, col, S);
  const arms = 1 + Math.floor(r.next() * 3);
  for (let k = 0; k < arms; k++) {
    const a = r.range(0, 6.28), y = h * r.range(0.35, 0.65), len = 13 * s;
    const ex = Math.cos(a) * (len + 3), ez = Math.sin(a) * (len + 3);
    B.add('std', T.cyl(6, 0.9), [Math.cos(a) * len / 2, y, Math.sin(a) * len / 2], [2.9 * s, len, 2.9 * s], [Math.sin(a) * Math.PI / 2 * 0 + Math.sin(a) * (Math.PI / 2), 0, -Math.cos(a) * (Math.PI / 2)], col, S);
    const ah = h * r.range(0.3, 0.5);
    B.cyl('std', ex, y - 1, ez, 2.9 * s, ah, col, 6, 0.9, null, S);
    B.add('std', T.sphere(6, 3), [ex, y - 1 + ah, ez], [2.7 * s, 2.7 * s, 2.7 * s], null, col, S);
  }
}

/** A saguaro / agave for the tree line and scatter (desert), scaled. */
export function desertPiece(B, kind, s, r) {
  if (kind === 'cactus') cactus(B, s, r); else agave(B, s, r);
}

// ---- undergrowth scatter --------------------------------------------------------------------------------------------

/** A clump of weeds: crossed upright scrub cards (kept low so they never hide a crawler). */
function weeds(B, r, col, size = 13) {
  const cards = cardList();
  const n = 3;
  for (let m = 0; m < n; m++) {
    const a = (m / n) * Math.PI + r.range(-0.3, 0.3);
    card(cards, [0, size * 0.45, 0], new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)).normalize(), r.range(-0.2, 0.2), size * 1.1, size, [0, size * 0.2, 0], LEAF_CELLS.scrub, 1);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
}

function tallGrass(B, r, col) {
  const cards = cardList();
  for (let m = 0; m < 4; m++) {
    const a = r.range(0, 6.28);
    card(cards, [Math.cos(a) * 3, 8, Math.sin(a) * 3], new THREE.Vector3(Math.cos(a + 1.5), 0.05, Math.sin(a + 1.5)).normalize(), r.range(-0.3, 0.3), 12, 17, [0, 4, 0], LEAF_CELLS.fern, 1.5);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
}

/** Ivy on a wall: a column of overlapping leaf cards hugging the face. (x, z) object-frame wall point, n outward normal. */
function ivy(B, r, x, z, nx, nz, width, height, col) {
  const cards = cardList();
  const f = new THREE.Vector3(nx, 0, nz);
  const tx = -nz, tz = nx;
  const rows = Math.max(2, Math.round(height / 11)), cols = Math.max(1, Math.round(width / 12));
  for (let j = 0; j < rows; j++) {
    const spread = 1 - j / rows * 0.6;
    for (let k = 0; k < cols; k++) {
      if (r.next() > 0.85 * spread + 0.15) continue;
      const t = (k - (cols - 1) / 2) * 12 * spread + r.range(-3, 3);
      const y = 4 + j * 11 + r.range(-2, 2);
      card(cards, [x + tx * t + nx * 1.1, y, z + tz * t + nz * 1.1], f, r.range(-0.5, 0.5), 14, 14, [x - nx * 20, y, z - nz * 20], LEAF_CELLS.ivy, 0);
    }
  }
  if (cards.pos.length) B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
}

/**
 * Scatter undergrowth over the map: under trees, along fences and building bases, up walls,
 * and on the road verges. Deterministic; density follows the detail level (none on low).
 */
export function scatterFlora(B, map, waters = []) {
  const lod = DETAIL.level;
  if (lod < 1) return { items: 0 };
  const rng = seededRng((map.seed | 0) * 31 + 7);
  const dens = lod >= 2 ? 1 : 0.55;
  let items = 0;
  const wet = (x, y) => waters.some((w) => x > w.x0 - 20 && x < w.x1 + 20 && y > w.y0 - 20 && y < w.y1 + 20);
  // spatial hashes of the obstacles (their footprints) and of the hard-surface areas
  const CELL = 160;
  const grid = new Map(), hard = new Map();
  const addTo = (m, x0, y0, x1, y1, item) => {
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const k = cx + ',' + cy;
        const arr = m.get(k);
        if (arr) arr.push(item); else m.set(k, [item]);
      }
    }
  };
  for (const o of map.obstacles) {
    if (o.kind === 'car' || o.kind === 'suv' || o.kind === 'pickup' || o.kind === 'van' || o.kind === 'truck') continue;
    const c = Math.cos(o.a || 0), sn = Math.sin(o.a || 0);
    const ex = Math.abs(c) * o.w / 2 + Math.abs(sn) * o.h / 2 + 12, ey = Math.abs(sn) * o.w / 2 + Math.abs(c) * o.h / 2 + 12;
    addTo(grid, o.x - ex, o.y - ey, o.x + ex, o.y + ey, { o, c, s: sn });
  }
  for (const a of map.areas) if (a.kind === 'asphalt' || a.kind === 'concrete') addTo(hard, a.x - a.w / 2 - 6, a.y - a.h / 2 - 6, a.x + a.w / 2 + 6, a.y + a.h / 2 + 6, a);
  // a story level's roofs: indoors counts as hard floor (no weeds, ferns or ivy inside a room)
  for (const r of map.roofs || []) {
    const c = Math.cos(r.a || 0), sn = Math.sin(r.a || 0);
    const ex = Math.abs(c) * r.w / 2 + Math.abs(sn) * r.h / 2 + 6, ey = Math.abs(sn) * r.w / 2 + Math.abs(c) * r.h / 2 + 6;
    addTo(hard, r.x - ex, r.y - ey, r.x + ex, r.y + ey, { roof: r, c, s: sn });
  }
  const blocked = (x, y, pad = 6) => {
    const arr = grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
    if (!arr) return false;
    for (const { o, c, s: sn } of arr) {
      const dx = x - o.x, dy = y - o.y;
      if (Math.abs(dx * c + dy * sn) < o.w / 2 + pad && Math.abs(-dx * sn + dy * c) < o.h / 2 + pad) return true;
    }
    return false;
  };
  const onRoad = (x, y) => {
    const arr = hard.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
    if (!arr) return false;
    for (const a of arr) {
      if (a.roof) {
        const dx = x - a.roof.x, dy = y - a.roof.y;
        if (Math.abs(dx * a.c + dy * a.s) < a.roof.w / 2 + 3 && Math.abs(-dx * a.s + dy * a.c) < a.roof.h / 2 + 3) return true;
      } else if (Math.abs(x - a.x) < a.w / 2 + 3 && Math.abs(y - a.y) < a.h / 2 + 3) return true;
    }
    return false;
  };
  const place = (x, y, seed) => { B.obj(x, y, rng.range(0, 6.28), seed); B.setJitter(0.12); items++; };
  const greens = state.desert ? ['#7a7a3e', '#8a8442', '#948a48'] : ['#3d5a28', '#4a6a2c', '#5a7a30', '#6a7a34', '#7a7c3c'];
  // under the broadleaf trees: ferns, fallen logs, leaf-litter mounds
  map.decor.forEach((d, i) => {
    if (d.kind !== 'tree_canopy') return;
    const sp = speciesByIndex(i);
    if (sp === 'palm' || sp === 'acacia') return;
    const R = 44 * (d.s || 1);
    if (!state.desert && sp !== 'dead') {
      const nf = Math.round((2 + rng.next() * 3) * dens);
      for (let k = 0; k < nf; k++) {
        const a = rng.range(0, 6.28), rr = R * rng.range(0.55, 1.1);
        const x = d.x + Math.cos(a) * rr, y = d.y + Math.sin(a) * rr;
        if (blocked(x, y) || onRoad(x, y) || wet(x, y)) continue;
        place(x, y, i * 13 + k);
        const cards = cardList();
        for (let m = 0; m < 5; m++) {
          const aa = (m / 5) * 6.28;
          card(cards, [Math.cos(aa) * 4, 8, Math.sin(aa) * 4], new THREE.Vector3(Math.cos(aa) * 0.7, 0.5, Math.sin(aa) * 0.7).normalize(), 0, 15, 17, [0, 0, 0], LEAF_CELLS.fern, 2);
        }
        B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, rng.pick(['#2f5a2a', '#3a6a30', '#2a4c26']), { noAO: true });
      }
    }
    if (rng.next() < 0.22 * dens && lod >= 2) {
      const a = rng.range(0, 6.28), rr = R * 1.0;
      const x = d.x + Math.cos(a) * rr, y = d.y + Math.sin(a) * rr;
      if (!blocked(x, y) && !onRoad(x, y) && !wet(x, y)) {
        place(x, y, i * 17 + 3);
        B.cyl('std', 0, 4, 0, 4, 34 + rng.range(0, 20), sp === 'birch' ? '#cfcabc' : '#4a3a2a', 8, 0.9, [0, 0, Math.PI / 2 - 0.06], { surf: [DET.bark, 0.9, 0], noJitter: true });
        B.add('std', T.ico(0), [0, 3, -6], [7, 3, 4], null, '#3f5a2a', { surf: [DET.grass, 0.9, 0], noJitter: true });
      }
    }
  });
  // buildings: weeds along the foundations, ivy up some walls, a shrub by the door
  for (const o of map.obstacles) {
    if (o.kind !== 'building') continue;
    const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
    const at = (lx, lz) => [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
    const faces = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    faces.forEach(([fx, fz], fi) => {
      const len = fx ? o.h : o.w, half = fx ? o.w / 2 : o.h / 2;
      const n = Math.max(1, Math.floor(len / 46));
      for (let k = 0; k < n; k++) {
        if (rng.next() > 0.55 * dens) continue;
        const t = -len / 2 + (k + rng.next()) * (len / n);
        const [x, y] = at(fx ? fx * (half + 7) : t, fz ? fz * (half + 7) : t);
        if (onRoad(x, y) || blocked(x, y, 2) || wet(x, y)) continue;
        place(x, y, o.id * 29 + fi * 5 + k);
        if (rng.next() < 0.5) weeds(B, rng, rng.pick(greens), 13 + rng.range(0, 6)); else tallGrass(B, rng, rng.pick(greens));
      }
      // ivy
      if (!state.desert && rng.next() < 0.28 * dens && lod >= 2 && o.w < 300) {
        const t = rng.range(-len * 0.3, len * 0.3);
        const [x, y] = at(fx ? fx * half : t, fz ? fz * half : t);
        // in the object frame of a placed point: rotate the outward normal by the building angle
        B.obj(x, y, o.a || 0, o.id * 41 + fi);
        B.setJitter(0.1);
        items++;
        ivy(B, rng, fx ? 0.2 * fx : 0, fz ? 0.2 * fz : 0, fx, fz, rng.range(18, 42), rng.range(40, 100), rng.pick(['#2f4a22', '#3a5a26', '#7a2a1a', '#2a4020']));
      }
    });
  }
  // fences and thin walls: weeds and flowers growing up through them
  for (const o of map.obstacles) {
    if (o.kind !== 'wall' || o.h > 8) continue;
    const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
    const n = Math.floor(o.w / 60);
    for (let k = 0; k < n; k++) {
      if (rng.next() > 0.6 * dens) continue;
      const lx = -o.w / 2 + (k + rng.next()) * (o.w / n), lz = rng.range(-5, 5);
      const x = o.x + lx * c - lz * s, y = o.y + lx * s + lz * c;
      if (wet(x, y) || onRoad(x, y)) continue;
      place(x, y, o.id * 7 + k);
      weeds(B, rng, rng.pick(greens), 14 + rng.range(0, 6));
      if (rng.next() < 0.3 && !state.desert) {
        const fc = rng.pick(FLOWERS);
        for (let m = 0; m < 5; m++) B.add('std', T.sphere(4, 3), [rng.range(-5, 5), 10 + rng.range(0, 6), rng.range(-5, 5)], [1.3, 1.1, 1.3], null, fc, { surf: [DET.fabric, 0.7, 0], noJitter: true });
      }
    }
  }
  // road verges: tall grass, dry weeds, the odd shrub
  const roads = map.areas.filter((a) => a.kind === 'asphalt');
  for (const a of roads) {
    const horiz = a.w >= a.h;
    const len = horiz ? a.w : a.h, wid = horiz ? a.h : a.w;
    if (len < 200) continue;
    const stepLen = 150 / dens;
    for (let p = stepLen * rng.next(); p < len; p += stepLen * (0.6 + rng.next() * 0.8)) {
      const side = rng.next() < 0.5 ? -1 : 1;
      const off = wid / 2 + rng.range(6, 24);
      const x = horiz ? a.x - len / 2 + p : a.x + side * off, y = horiz ? a.y + side * off : a.y - len / 2 + p;
      if (x < 0 || y < 0 || x > map.width || y > map.height) continue;
      if (onRoad(x, y) || blocked(x, y, 8) || wet(x, y)) continue;
      place(x, y, Math.floor(p) + Math.floor(a.x) * 3);
      const roll = rng.next();
      if (roll < 0.55) tallGrass(B, rng, rng.pick(greens));
      else weeds(B, rng, rng.pick(greens), 15 + rng.range(0, 6));
    }
  }
  return { items };
}
