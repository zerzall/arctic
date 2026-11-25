// The MakeHuman body in the game's rest pose (scripts/build-zbody.js): the base mesh and its morph
// targets posed by the default skeleton (linear blend skinning with MakeHuman's own weights, up to
// a dozen bones a vertex, so the shoulders keep their volume) from MakeHuman's A-pose into the rig's
// rest pose: arms hanging straight down at the sides, palms to the thighs, legs straight under the
// hips. Then converted to model space (+X forward, +Y up, +Z right, ~3 cm units, soles on y = 0)
// and the weights folded onto the rig's 20 bones (actor-consts.js B).

import { jointPos } from './mh.js';

// actor-consts.js B (kept in sync by hand: the build script must not import render3d)
export const B = {
  HIPS: 0, SPINE: 1, CHEST: 2, NECK: 3, HEAD: 4, JAW: 5,
  UARM_L: 6, FARM_L: 7, HAND_L: 8, UARM_R: 9, FARM_R: 10, HAND_R: 11,
  THIGH_L: 12, SHIN_L: 13, FOOT_L: 14, THIGH_R: 15, SHIN_R: 16, FOOT_R: 17,
};

/** MakeHuman decimetres → model units (1 ≈ 3 cm): a 1.67 m base mesh is ~56 units tall. */
export const UNIT = 56 / 16.66;

/** The rig bone a MakeHuman bone's weight goes to ([bone, share] pairs for the split ones). */
export function rigBoneOf(name, bones) {
  const side = name.endsWith('.L') ? 'L' : name.endsWith('.R') ? 'R' : '';
  const base = name.replace(/\.[LR]$/, '');
  // the jaw and everything hanging off it (tongue, lower lip)
  for (let b = name; b; b = bones[b] && bones[b].parent) if (b === 'jaw') return [[B.JAW, 1]];
  if (['root', 'pelvis', 'spine05'].includes(base)) return [[B.HIPS, 1]];
  if (['spine04', 'spine03'].includes(base)) return [[B.SPINE, 1]];
  if (['spine02', 'spine01', 'breast', 'clavicle'].includes(base)) return [[B.CHEST, 1]];
  if (base.startsWith('neck')) return [[B.NECK, 1]];
  if (base === 'shoulder01') return [[B.CHEST, 0.45], [side === 'L' ? B.UARM_L : B.UARM_R, 0.55]];
  if (base.startsWith('upperarm')) return [[side === 'L' ? B.UARM_L : B.UARM_R, 1]];
  if (base.startsWith('lowerarm')) return [[side === 'L' ? B.FARM_L : B.FARM_R, 1]];
  if (base === 'wrist' || base.startsWith('metacarpal') || base.startsWith('finger')) return [[side === 'L' ? B.HAND_L : B.HAND_R, 1]];
  if (base.startsWith('upperleg')) return [[side === 'L' ? B.THIGH_L : B.THIGH_R, 1]];
  if (base.startsWith('lowerleg')) return [[side === 'L' ? B.SHIN_L : B.SHIN_R, 1]];
  if (base === 'foot' || base.startsWith('toe')) return [[side === 'L' ? B.FOOT_L : B.FOOT_R, 1]];
  return [[B.HEAD, 1]];   // head, eyes, the face's muscles
}

// ---- small 3×4 affine helpers (row-major [r00 r01 r02 t0, r10 ...]) ----
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}
const apply = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
const dir = (m, d) => [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Rotation (axis-angle) about point c as an affine matrix; t ∈ 0..1 takes a share of the angle. */
function rotAbout(axis, ang, c) {
  const [x, y, z] = norm(axis), s = Math.sin(ang), k = Math.cos(ang), q = 1 - k;
  const R = [k + x * x * q, x * y * q - z * s, x * z * q + y * s, 0, y * x * q + z * s, k + y * y * q, y * z * q - x * s, 0, z * x * q - y * s, z * y * q + x * s, k + z * z * q, 0];
  const rc = apply(R, c);
  R[3] = c[0] - rc[0]; R[7] = c[1] - rc[1]; R[11] = c[2] - rc[2];
  return R;
}
/** Shortest rotation taking direction a onto b → [axis, angle]. */
function between(a, b) {
  a = norm(a); b = norm(b);
  const ax = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return [Math.hypot(...ax) < 1e-9 ? [1, 0, 0] : ax, Math.acos(d)];
}

/**
 * The pose: per bone, the world-space transform from the A-pose. Arms hang straight down
 * (a slight bend at the elbow), the hands in line with the forearms, the legs straight below the
 * hip joints, the feet as they stood. Directions in MakeHuman space (+X = the body's left).
 */
export function poseBones(rig, pos) {
  const { bones } = rig;
  const order = [];
  const seen = new Set();
  const visit = (n) => { if (seen.has(n)) return; const p = bones[n].parent; if (p) visit(p); seen.add(n); order.push(n); };
  Object.keys(bones).forEach(visit);
  const head = {}, tail = {};
  for (const n of order) { head[n] = jointPos(rig, pos, bones[n].head); tail[n] = jointPos(rig, pos, bones[n].tail); }
  const G = {};
  // direction targets (L side; the R side mirrors x)
  const T = {
    upperarm01: [0.07, -1, -0.04], upperarm02: [0.07, -1, -0.04],
    lowerarm01: [0.0, -1, 0.17], lowerarm02: [0.0, -1, 0.17],
    upperleg01: [0.035, -1, 0.0], upperleg02: [0.035, -1, 0.0], lowerleg01: [0.0, -1, -0.02], lowerleg02: [0.0, -1, -0.02],
  };
  const keepWorld = new Set(['foot']);
  for (const n of order) {
    const p = bones[n].parent;
    const PG = p ? G[p] : ident();
    const base = n.replace(/\.[LR]$/, ''), side = n.endsWith('.L') ? 1 : n.endsWith('.R') ? -1 : 0;
    const h = apply(PG, head[n]);
    const cur = dir(PG, sub(tail[n], head[n]));
    let A = null;
    if (T[base]) {
      const t = T[base];
      const [ax, ang] = between(cur, [t[0] * side, t[1], t[2]]);
      A = rotAbout(ax, ang, h);
    } else if (base === 'shoulder01' || base === 'clavicle') {
      // a share of the upper arm's swing goes to the shoulder, so the deltoid rounds over instead of folding
      const ua = 'upperarm01' + n.slice(-2);
      const d0 = dir(PG, sub(tail[ua], head[ua]));
      const [ax, ang] = between(d0, [0.07 * side, -1, -0.04]);
      A = rotAbout(ax, ang * (base === 'clavicle' ? 0.08 : 0.22), h);
    } else if (base === 'wrist') {
      // the hand in line with the (posed) forearm, palm to the thigh
      const fa = 'lowerarm02' + n.slice(-2);
      const fd = dir(G[fa], sub(tail[fa], head[fa]));
      const [ax, ang] = between(cur, norm([fd[0] * 0.5, fd[1], fd[2] * 0.5 + 0.03]));
      A = rotAbout(ax, ang, h);
    } else if (keepWorld.has(base)) {
      // undo the leg's swing: the foot stands flat as it did
      const [ax, ang] = between(cur, sub(tail[n], head[n]));
      A = rotAbout(ax, ang, h);
    }
    G[n] = A ? mul(A, PG) : PG;
  }
  return { G, head, tail, order };
}

/** Per vertex: [[bone name, weight], ...] normalised (MakeHuman's own weights). */
export function vertexWeights(rig, nv) {
  const W = Array.from({ length: nv }, () => []);
  for (const [bone, list] of Object.entries(rig.weights)) for (const [v, w] of list) if (v < nv) W[v].push([bone, w]);
  for (const l of W) { const s = l.reduce((a, b) => a + b[1], 0); if (s > 0) for (const e of l) e[1] /= s; }
  return W;
}

/** Linear blend skinning of positions (Float64Array xyz) by the pose → new Float64Array. */
export function skin(pos, W, G, fallback) {
  const out = new Float64Array(pos.length);
  for (let v = 0; v < pos.length / 3; v++) {
    const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    let l = W[v];
    if (!l.length && fallback) l = [[fallback(v), 1]];
    if (!l.length) { out.set(p, v * 3); continue; }
    let x = 0, y = 0, z = 0;
    for (const [b, w] of l) { const q = apply(G[b], p); x += q[0] * w; y += q[1] * w; z += q[2] * w; }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
  }
  return out;
}

/** MakeHuman space → model space (in place on a copy): x ← z, z ← −x, scaled, soles at `floor`. */
export function toModel(pos, floor) {
  const out = new Float64Array(pos.length);
  for (let v = 0; v < pos.length / 3; v++) {
    out[v * 3] = pos[v * 3 + 2] * UNIT;
    out[v * 3 + 1] = (pos[v * 3 + 1] - floor) * UNIT;
    out[v * 3 + 2] = -pos[v * 3] * UNIT;
  }
  return out;
}

/** A MakeHuman point → model space. */
export const pointToModel = (p, floor) => [p[2] * UNIT, (p[1] - floor) * UNIT, -p[0] * UNIT];

/** The rig's two strongest bones per vertex → { a, b, w } (w = share of b). */
export function rigWeights(W, bones, fallback) {
  const cache = new Map();
  const map = (n) => { let m = cache.get(n); if (!m) { m = rigBoneOf(n, bones); cache.set(n, m); } return m; };
  return W.map((l, v) => {
    const acc = new Map();
    if (!l.length && fallback) acc.set(fallback(v), 1);
    for (const [n, w] of l) for (const [rb, k] of map(n)) acc.set(rb, (acc.get(rb) || 0) + w * k);
    const s = [...acc.entries()].sort((a, b) => b[1] - a[1]);
    if (!s.length) return { a: B.HIPS, b: B.HIPS, w: 0 };
    if (s.length === 1 || s[1][1] < 0.02) return { a: s[0][0], b: s[0][0], w: 0 };
    const t = s[0][1] + s[1][1];
    return { a: s[0][0], b: s[1][0], w: s[1][1] / t };
  });
}
