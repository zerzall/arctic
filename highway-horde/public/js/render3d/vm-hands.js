// The first-person hands and sleeves (viewmodel.js): tactical gloves on both hands, sculpted
// per grip, and the outfit's fabric sleeves.
//
// The gloves are built like real ones: a stretch-fabric back, a synthetic-leather palm that
// carries on up the fingers, a moulded knuckle guard across the four knuckles and a small pad
// on the back of each finger, stitched seams down the sides of the fingers and round the
// back of the hand, and a neoprene cuff closed by a hook-and-loop strap with a pull tab.
// Fingers are jointed tubes: they swell at the knuckles and taper to rounded tips.
// The sleeves are the outfit's fabric with folds at the cuff, a seam, and the player's colour
// as a small hook-and-loop patch on the forearm (it used to be a band right round the arm).
//
// The material (makeHandMaterial) shades by surface class: fabric gets a woven ripstop
// relief, leather a pebbled grain, the moulded pads a matte rubber, so the hands read as
// cloth and leather rather than as one smooth plastic.
//
// Gun space as in actor-guns.js: +X to the muzzle, +Y up, +Z to the gun's right; the firing
// hand wraps the pistol grip at the origin; the camera sits behind, above and to the left.

import * as THREE from 'three';
import { shadeHex, mixHex } from './actor-kit.js';
import { GLOVES, CLASS_SKIN } from './actor-sgear.js';
import { ShapeBuilder, SLOT, MAT, lineRings, noise3 } from './actor-shape.js';

const HALF_PI = Math.PI / 2;

/** Standard material for the hands and sleeves: actor detail textures plus a fabric / leather relief by surface class. */
export function makeHandMaterial(tex, envMap) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMap, envMapIntensity: 0.5 });
  const uniforms = { uDetail: { value: tex.detail }, uNrm: { value: tex.normal } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aInfo;\nvarying float vHM;\nvarying vec2 vHUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvHM = aInfo.z; vHUv = uv * 1.6;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail;
uniform sampler2D uNrm;
varying float vHM;
varying vec2 vHUv;
vec4 hD;
int hM;
vec3 hW;
float hAA;
float hRip;
vec3 hPerturb(vec3 N, vec3 eyePos, vec2 uv, vec2 nxy) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, N), q0p = cross(N, q0);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 Bt = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(Bt, Bt));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (nxy.x * s) + Bt * (nxy.y * s) + N * sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
}
// a plain weave: threads along u and v, over and under in a checker; xy = the height's
// gradient, z = the height (thread units)
vec3 hWeave(vec2 p) {
  vec2 c = floor(p), f = fract(p) - 0.5;
  float odd = mod(c.x + c.y, 2.0);
  float a = odd > 0.5 ? f.y : f.x;
  vec2 g = odd > 0.5 ? vec2(0.0, -sin(f.y * 3.14159)) : vec2(-sin(f.x * 3.14159), 0.0);
  return vec3(g * 3.14159, cos(a * 3.14159));
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  hD = texture2D(uDetail, vHUv);
  hM = int(vHM + 0.5);
  hW = vec3(0.0);
  hAA = 0.0;
  hRip = 0.0;
  if (hM == 1) {
    // fabric: the weave (faded out where a thread gets smaller than a couple of pixels) and a ripstop grid
    vec2 wp = vHUv * 36.0;
    hAA = 1.0 - smoothstep(0.2, 0.5, max(length(dFdx(wp)), length(dFdy(wp))));
    hW = hWeave(wp) * hAA;
    vec2 rp = abs(fract(wp / 9.0) - 0.5);
    float ra = 1.0 - smoothstep(0.06, 0.16, max(length(dFdx(wp / 9.0)), length(dFdy(wp / 9.0))));
    hRip = (1.0 - smoothstep(0.03, 0.06, 0.5 - max(rp.x, rp.y))) * ra;
    diffuseColor.rgb *= (0.8 + hD.g * 0.32) * (0.965 + 0.035 * hW.z) * (1.0 + hRip * 0.09);
  } else if (hM == 3) diffuseColor.rgb *= 0.84 + hD.r * 0.26;
  else diffuseColor.rgb *= 0.85 + hD.r * 0.3;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.55, 0.48), hD.b * 0.35);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = hM == 1 ? 0.95 - hRip * 0.08 : hM == 3 ? 0.6 + hD.b * 0.22 : hM == 9 ? 0.3 : hM == 10 ? 0.56 : hM == 7 ? 0.1 : 0.6;`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = hM == 9 ? 0.8 : 0.0;')
      .replace('#include <normal_fragment_maps>', `{
    vec4 nn = texture2D(uNrm, vHUv);
    vec2 nxy;
    if (hM == 1) nxy = (nn.ba * 2.0 - 1.0) * 0.5 - hW.xy * 0.045;
    else if (hM == 3) {
      // pebbled synthetic leather: the detail normal at four times the scale
      vec4 n2 = texture2D(uNrm, vHUv * 4.1 + 0.37);
      nxy = (nn.rg * 2.0 - 1.0) * 0.3 + (n2.rg * 2.0 - 1.0) * 0.42;
    } else if (hM == 10) {
      vec4 n2 = texture2D(uNrm, vHUv * 2.3);
      nxy = (n2.rg * 2.0 - 1.0) * 0.3;
    } else nxy = (nn.rg * 2.0 - 1.0) * 0.55;
    normal = hPerturb(normal, -vViewPosition, vHUv, nxy);
  }`);
  };
  mat.customProgramCacheKey = () => 'hh-vm-hand-2';
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---- small vector helpers (arrays) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const _m4 = new THREE.Matrix4(), _e = new THREE.Euler(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
/** Euler (XYZ) of the basis (x, y, z): an ellipsoid's or a box's orientation from vectors. */
function eulerOf(x, y) {
  const X = norm(x);
  const Z = norm(cross(X, y));
  const Y = cross(Z, X);
  _m4.makeBasis(_bx.fromArray(X), _by.fromArray(Y), _bz.fromArray(Z));
  _e.setFromRotationMatrix(_m4, 'XYZ');
  return [_e.x, _e.y, _e.z];
}

/** A squarer ellipsoid (the palm and the back of the hand are boxy, not eggs): k of the way to the cube. */
function boxy(k = 0.3) {
  return (p) => {
    const m = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) || 1;
    p.x += (p.x / m - p.x) * k;
    p.y += (p.y / m - p.y) * k;
    p.z += (p.z / m - p.z) * k;
  };
}

/**
 * Gloved hands + sleeves in gun space. Returns { right, left, leftHand } geometries; the
 * left arm is modelled at its rest grip, leftHand = its grip point (the pivot the support
 * arm moves about when it leaves the gun).
 * @param {object} model gun model (front: the support grip point, twoHanded)
 * @param {{ cls?: string, outfit: string, band: string }} look class, outfit colour, the player's colour
 * @param {boolean} mirrorOnly build only the firing arm (the left gun of a dual pair)
 * @param {boolean} cin the cinematic tier (finer tubes, spline-subdivided)
 */
export function buildArms(model, look, mirrorOnly = false, cin = false) {
  const Q = (n) => (cin ? Math.round(n * 1.7) : n);
  const SD = cin ? 2 : 1;
  const cls = look.cls || 'soldier';
  const G = GLOVES[cls] || GLOVES.soldier;
  const skin = CLASS_SKIN[cls] || CLASS_SKIN.soldier;
  const outfit = look.outfit, cuff = shadeHex(look.outfit, -0.25), patch = look.band;
  const glossy = !!G.glossy;
  // the glove's surfaces: a dark stretch-fabric back, the palm and fingers in a lighter
  // synthetic suede (so the fingers read against the gun), reinforced fingertips, dark pads
  const suede = glossy ? shadeHex(G.color, -0.06) : mixHex(G.color, '#8c7b62', 0.42);
  const fabric = { slot: SLOT.FIXED, mat: glossy ? MAT.RUBBER : MAT.CLOTH, color: glossy ? G.color : shadeHex(G.color, 0.1) };
  const leather = { slot: SLOT.FIXED, mat: glossy ? MAT.RUBBER : MAT.LEATHER, color: suede };
  const pad = { slot: SLOT.FIXED, mat: MAT.RUBBER, color: G.pad === G.color ? shadeHex(G.pad, -0.18) : G.pad };
  const stitch = { slot: SLOT.FIXED, mat: MAT.CLOTH, color: shadeHex(G.color, glossy ? -0.3 : -0.5) };
  const neoprene = { slot: SLOT.FIXED, mat: MAT.CLOTH, color: G.cuff };
  const skinO = { slot: SLOT.FIXED, mat: MAT.SKIN, color: skin };
  const tipTone = glossy ? suede : shadeHex(suede, -0.16), crease = shadeHex(suede, -0.3), tipSeam = shadeHex(suede, -0.45);

  /**
   * A gloved finger along pts (knuckle → tip): slightly flattened, it swells at the joints
   * (creased there) and tapers to a rounded, reinforced tip; a moulded pad sits on the back of
   * its first segment and a seam runs down each side. back: unit vector toward the back of
   * the finger at a point.
   */
  const finger = (sb, pts, r, back, o = {}) => {
    const n = pts.length;
    const rings = pts.map((p, i) => {
      const k = r * (1 - (i / (n - 1)) * 0.2) * (i === 1 || (i === 2 && n > 3) ? 1.07 : i === 0 ? 1.04 : 1);
      return { c: p, rx: k * 0.88, rz: k };
    });
    const bare = !!G.fingerless && !o.noBare;
    const gloved = bare ? rings.slice(0, n - 1) : rings;
    // the joints' creases and the fingertip panel by position along the finger
    const joints = [];
    for (let i = 1; i < n - 1; i++) joints.push([pts[i], norm(sub(pts[i + 1], pts[i - 1]))]);
    const tipAt = lerp3(pts[n - 2], pts[n - 1], 0.42), tipDir = norm(sub(pts[n - 1], pts[n - 2]));
    const colorFn = (x, y, z) => {
      const p = [x, y, z];
      const dt = dot(sub(p, tipAt), tipDir);
      if (!bare && dt > -0.03) return dt < 0.03 ? tipSeam : tipTone;
      for (const [q, t] of joints) if (Math.abs(dot(sub(p, q), t)) < 0.045) return crease;
      return suede;
    };
    sb.tube(gloved, { ...leather, colorFn, seg: Q(10), subdiv: 3 * SD, cap0: 'round', cap1: bare ? 'flat' : 'round', capRings: 3, ref: back(pts[0]) });
    if (bare) {
      // a fingerless glove: the last joint bare, a rolled hem at the cut
      const a = pts[n - 2], b = pts[n - 1];
      sb.tube([{ c: a, r: r * 0.72 }, { c: lerp3(a, b, 0.55), r: r * 0.7 }, { c: b, r: r * 0.64 }], { ...skinO, seg: Q(8), subdiv: SD, cap1: 'round', capRings: 3 });
      sb.tube(lineRings(lerp3(a, b, -0.06), lerp3(a, b, 0.08), r * 0.93, r * 0.93, 2), { ...stitch, seg: Q(9) });
      sb.ellipsoid(addv(b, back(b), r * 0.2), [r * 0.5, r * 0.26, r * 0.5], { slot: SLOT.FIXED, mat: MAT.BONE, color: shadeHex(skin, 0.3), segW: Q(6), segH: Q(4), rot: eulerOf(sub(b, a), back(b)) });
    }
    if (o.pad !== false) {
      // the moulded pad on the back of the first segment
      const a = pts[0], b = pts[1], c = lerp3(a, b, 0.55), bk = back(c);
      sb.ellipsoid(addv(c, bk, r * 0.86), [len(sub(b, a)) * 0.34, r * 0.3, r * 0.6], { ...pad, segW: Q(9), segH: Q(5), rot: eulerOf(sub(b, a), bk), deform: boxy(0.45) });
    }
    if (o.seams !== false) {
      // stitching down both sides of the finger
      for (const s of [-1, 1]) {
        const line = [];
        for (let i = 0; i < gloved.length; i++) {
          const p = pts[i], t = sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]);
          const side = norm(cross(t, back(p)));
          line.push({ c: addv(p, side, s * gloved[i].rz * 0.97), r: 0.04 });
        }
        sb.tube(line, { ...stitch, seg: 4, subdiv: 2 * SD });
      }
    }
  };

  /** The knuckle guard: a moulded bar across the knuckles (bases) with a bump on each, pushed out along back. */
  const knuckles = (sb, bases, r, back) => {
    const pts = bases.map((b) => addv(b, back(b), r * 0.92));
    const ext = [addv(pts[0], norm(sub(pts[0], pts[1])), r * 0.5), ...pts, addv(pts[pts.length - 1], norm(sub(pts[pts.length - 1], pts[pts.length - 2])), r * 0.5)];
    sb.tube(ext.map((c) => ({ c, r: r * 0.34 })), { ...pad, seg: Q(9), subdiv: 2 * SD, cap0: 'round', cap1: 'round', capRings: 2 });
    for (let i = 0; i < pts.length; i++) {
      const along = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
      sb.ellipsoid(addv(pts[i], back(bases[i]), r * 0.16), [r * 0.48, r * 0.3, r * 0.5], { ...pad, segW: Q(9), segH: Q(5), rot: eulerOf(along, back(bases[i])), deform: boxy(0.45) });
    }
    // the seam round the guard
    sb.tube(ext.map((c, i) => ({ c: addv(c, back(bases[Math.max(0, Math.min(bases.length - 1, i - 1))]), -r * 0.24), r: 0.035 })), { ...stitch, seg: 4, subdiv: 2 * SD });
  };

  /**
   * The wrist and forearm from the hand's wrist point toward the elbow: the glove's neoprene
   * cuff with its strap and pull tab, the sleeve's hem and the sleeve (folds, a seam), the
   * player's patch where the camera sees it.
   */
  const forearm = (sb, wr, elbow, o = {}) => {
    const d = sub(elbow, wr);
    const L = len(d);
    const at = (t) => addv(wr, d, t / L);
    const axis = norm(d);
    // toward the camera (behind, above, left of the gun), squared to the arm
    const cam = norm([-1, 0.6, -0.55]);
    const face = norm(sub(cam, [axis[0] * dot(cam, axis), axis[1] * dot(cam, axis), axis[2] * dot(cam, axis)]));
    // neoprene cuff, its hook-and-loop strap round it and the pull tab
    sb.tube(lineRings(at(-0.3), at(1.25), 1.14, 1.27, 3), { ...neoprene, seg: Q(16) });
    sb.tube(lineRings(at(-0.05), at(0.5), 1.31, 1.33, 2), { ...fabric, color: shadeHex(G.cuff, -0.12), seg: Q(16) });
    const side = norm(cross(axis, face));
    sb.ellipsoid(addv(addv(at(0.22), face, 1.36), side, 0.55), [0.42, 0.11, 0.36], { ...pad, color: shadeHex(G.cuff, 0.08), segW: Q(8), segH: Q(4), rot: eulerOf(side, face), deform: boxy(0.45) });
    if (G.tape) for (let t = 0; t < 4; t++) sb.tube(lineRings(at(0.3 + t * 0.55), at(0.62 + t * 0.55), 1.36 + t * 0.02, 1.38 + t * 0.02, 2), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: t % 2 ? '#d8d0b8' : '#e4dcc6', seg: Q(14) });
    // the sleeve's hem (rolled, a little darker) and the sleeve with its folds
    sb.tube(lineRings(at(1.3), at(2.4), 1.5, 1.62, 3), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: cuff, seg: Q(18), noise: { amp: 0.06, freq: 2.2 } });
    const camo = cls === 'soldier' ? (x, y, z) => { const nn = noise3(x * 0.55, y * 0.55, z * 0.55); return nn < -0.15 ? shadeHex(outfit, -0.45) : nn < 0.25 ? outfit : mixHex(outfit, '#8a7a4a', 0.55); } : null;
    const r0 = 1.6, r1 = o.r1 ?? 2.3;
    sb.tube(lineRings(at(2.3), at(L), r0, r1, 8), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: outfit, colorFn: camo, seg: Q(18), subdiv: SD, noise: { amp: 0.14, freq: 0.9 },
      profile: (th, t) => 1 + 0.08 * Math.exp(-t * 2.4) * Math.sin(t * 26 + Math.sin(th * 2) * 2) + 0.03 * Math.sin(th * 5 + t * 6) });
    // a seam along the top of the sleeve
    const rad = (t) => r0 + (r1 - r0) * Math.max(0, (t - 2.3) / (L - 2.3));
    const seamPts = [];
    for (let t = 2.7; t < L - 0.2; t += 0.9) seamPts.push({ c: addv(at(t), norm(addv(face, side, 0.9)), rad(t) * 1.03 + 0.04), r: 0.05 });
    if (seamPts.length > 1) sb.tube(seamPts, { slot: SLOT.FIXED, mat: MAT.CLOTH, color: shadeHex(outfit, -0.38), seg: 4, subdiv: SD });
    // the player's colour: a hook-and-loop patch with a dark stitched border on the side facing
    // the camera (curved round the sleeve: arcs of tubes centred on `face`)
    if (o.patch) {
      const t = Math.min(L - 1.6, 5.2);
      const rp = rad(t) + 0.16;
      sb.tube(lineRings(at(t - 0.9), at(t + 0.9), rp - 0.03, rp - 0.03, 2), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: shadeHex(outfit, -0.55), seg: Q(10), arc: [-0.33, 0.33], ref: face });
      sb.tube(lineRings(at(t - 0.78), at(t + 0.78), rp, rp, 2), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: mixHex(patch, outfit, 0.18), seg: Q(10), arc: [-0.27, 0.27], ref: face });
      // a stitched line inset round the edge
      for (const a of [-0.22, 0.22]) {
        const pts = [];
        for (let k = 0; k <= 4; k++) {
          const tt = t - 0.68 + k * 0.34, c = at(tt);
          pts.push({ c: addv(addv(c, face, Math.cos(a) * (rp + 0.015)), side, Math.sin(a) * (rp + 0.015)), r: 0.028 });
        }
        sb.tube(pts, { slot: SLOT.FIXED, mat: MAT.CLOTH, color: shadeHex(patch, -0.45), seg: 4 });
      }
    }
    if (cls === 'engineer') sb.tube(lineRings(at(6.2), at(6.9), rad(6.2) + 0.12, rad(6.9) + 0.12, 2), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#e8e070', seg: Q(16) });
    if (cls === 'scout') for (let k = 0; k < 2; k++) sb.tube(lineRings(at(6.0 + k * 0.6), at(6.3 + k * 0.6), rad(6.2) + 0.1, rad(6.5) + 0.1, 2), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: shadeHex(outfit, -0.3), seg: Q(16) });
    if (cls === 'medic' && o.patch) {
      const c = addv(at(7.4), face, rad(7.4) + 0.05);
      sb.ellipsoid(c, [0.9, 0.08, 0.28], { slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828', segW: Q(6), segH: Q(3), rot: eulerOf(axis, face) });
      sb.ellipsoid(c, [0.28, 0.08, 0.9], { slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828', segW: Q(6), segH: Q(3), rot: eulerOf(axis, face) });
    }
    return { at, face, axis };
  };

  // ---- firing hand round the pistol grip (grip axis raked back) ----
  const R = new ShapeBuilder();
  R.tile = 5;
  // the back of a finger wrapped round the grip points away from the grip's axis
  const gripBack = (p) => norm([p[0] - (-0.1 + p[1] * 0.18), 0, p[2]]);
  // the back of the hand (stretch fabric) on the right of the grip, the palm against it
  R.ellipsoid([-0.35, -1.45, 0.92], [1.85, 1.55, 0.62], { ...fabric, segW: Q(18), segH: Q(12), rot: [0, 0, -0.28], deform: boxy(0.3), noise: { amp: 0.04, freq: 1.4 } });
  R.ellipsoid([-0.5, -1.55, 0.42], [1.7, 1.45, 0.32], { ...leather, segW: Q(14), segH: Q(9), rot: [0, 0, -0.28], deform: boxy(0.3) });
  // seams over the back of the hand
  for (const dz of [-0.5, 0.0, 0.5]) R.tube(lineRings([-1.55, -1.25 - dz * 0.6, 1.5 - Math.abs(dz) * 0.35], [0.5, -1.05 - dz * 0.6, 1.5 - Math.abs(dz) * 0.35], 0.045, 0.045, 4), { ...stitch, seg: 4 });
  const bases = [];
  for (let k = 0; k < 3; k++) {
    const y = -1.3 - k * 0.78, x0 = 1.05 - k * 0.22;
    const pts = [[x0, y, 1.05], [x0 + 0.95, y - 0.05, 0.75], [x0 + 1.25, y - 0.1, 0.0], [x0 + 0.85, y - 0.12, -0.72], [x0 + 0.2, y - 0.14, -0.95]];
    finger(R, pts, 0.37 - k * 0.02, gripBack);
    bases.push(pts[0]);
  }
  // index finger along the frame, curled onto the trigger
  const idx = [[1.0, -0.45, 1.02], [1.8, -0.5, 0.82], [2.3, -0.7, 0.45], [1.75, -0.95, 0.12]];
  finger(R, idx, 0.36, () => norm([0.1, 0.55, 1]));
  bases.unshift(idx[0]);
  knuckles(R, bases, 0.38, () => [0.15, 0.05, 1]);
  // thumb high on the left of the frame, from its fleshy base
  R.ellipsoid([-0.95, -0.75, 0.25], [0.95, 0.62, 0.52], { ...leather, segW: Q(12), segH: Q(8), rot: [0.3, 0, 0.5] });
  finger(R, [[-1.1, -0.55, 0.55], [-0.2, 0.15, 0.1], [0.7, 0.4, -0.55], [1.5, 0.35, -0.8]], 0.4, () => norm([0, 0.6, -1]));
  // the wrist and the sleeve, running back and down out of the frame
  forearm(R, [-2.25, -2.05, 0.95], [-9.5, -9.2, 4.6], { r1: 2.25 });
  const right = R.build();
  if (mirrorOnly) return { right, left: null, leftHand: [0, 0, 0] };

  // ---- support hand ----
  const Lb = new ShapeBuilder();
  Lb.tile = 5;
  const f = model.front;
  let hand;
  let elbow;
  if (!model.twoHanded) {
    // cupping the firing hand from the left: fingers over the right fingers at the front
    hand = [0.2, -2.3, -1.15];
    Lb.ellipsoid([-0.1, -2.4, -1.25], [1.8, 1.5, 0.6], { ...fabric, segW: Q(16), segH: Q(10), rot: [0, 0, -0.3], deform: boxy(0.3) });
    Lb.ellipsoid([-0.1, -2.45, -0.85], [1.65, 1.38, 0.3], { ...leather, segW: Q(14), segH: Q(9), rot: [0, 0, -0.3], deform: boxy(0.3) });
    const cupBack = (p) => norm([p[0] - 0.4, 0, p[2] - 0.2]);
    const kb = [];
    for (let k = 0; k < 4; k++) {
      const y = -1.6 - k * 0.66;
      const pts = [[1.0, y, -1.3], [1.95 - k * 0.15, y - 0.1, -0.9], [2.35 - k * 0.2, y - 0.14, -0.1], [2.1 - k * 0.2, y - 0.16, 0.55]];
      finger(Lb, pts, 0.34, cupBack);
      kb.push(pts[0]);
    }
    knuckles(Lb, kb, 0.36, cupBack);
    finger(Lb, [[-0.9, -1.4, -1.35], [0.3, -0.6, -1.25], [1.4, -0.35, -1.0]], 0.38, () => norm([0, 0.5, -1]));
    elbow = [-8, -11, -6.5];
  } else if (f[1] < -1.5 || f[1] > 3) {
    // vertical foregrip (or a top handle): a fist round it, the back of the hand to the left
    hand = [f[0] - 0.2, f[1] + 1.4, f[2]];
    const top = f[1] > 3;
    const dy = top ? -1 : 1;
    const y0 = f[1] + (top ? -0.2 : 1.9);
    const fistBack = (p) => norm([p[0] - f[0], 0, p[2] - f[2]]);
    Lb.ellipsoid([f[0] - 0.5, y0 - dy * 1.3, f[2] - 0.95], [1.7, 1.45, 0.6], { ...fabric, segW: Q(16), segH: Q(10), rot: [0, 0, 0.2], deform: boxy(0.3) });
    Lb.ellipsoid([f[0] - 0.35, y0 - dy * 1.3, f[2] - 0.5], [1.55, 1.35, 0.3], { ...leather, segW: Q(14), segH: Q(9), rot: [0, 0, 0.2], deform: boxy(0.3) });
    const kb = [];
    for (let k = 0; k < 4; k++) {
      const y = y0 - dy * (0.55 + k * 0.72);
      const pts = [[f[0] + 0.6, y, -1.1], [f[0] + 1.4, y, -0.6], [f[0] + 1.35, y, 0.35], [f[0] + 0.6, y, 0.9]];
      finger(Lb, pts, 0.36 - k * 0.015, fistBack);
      kb.push(pts[0]);
    }
    knuckles(Lb, kb, 0.38, fistBack);
    Lb.ellipsoid([f[0] - 1.1, y0 + dy * 0.05, f[2] - 0.55], [0.85, 0.55, 0.5], { ...leather, segW: Q(12), segH: Q(8), rot: [0, 0, 0.6] });
    finger(Lb, [[f[0] - 1.2, y0 - dy * 0.4, -0.8], [f[0] - 0.3, y0 + dy * 0.3, 0.1], [f[0] + 0.6, y0 + dy * 0.35, 0.7]], 0.4, () => [0, dy, 0]);
    elbow = [f[0] - 10, f[1] - 9, -6.5];
  } else {
    // palm under the handguard, fingers curling up its right side, thumb along the left
    hand = [f[0], f[1] - 0.6, f[2] - 0.2];
    const y = f[1] - 1.0;
    const hgBack = (p) => norm([0, p[1] - (f[1] + 0.35), p[2]]);
    // the back of the hand (fabric, down and to the left) and the palm (leather, against the handguard)
    Lb.ellipsoid([f[0] - 0.4, y - 0.5, -0.78], [2.0, 0.62, 1.42], { ...fabric, segW: Q(18), segH: Q(12), rot: [0.5, 0, 0], deform: boxy(0.3), noise: { amp: 0.04, freq: 1.3 } });
    Lb.ellipsoid([f[0] - 0.35, y - 0.22, -0.55], [1.85, 0.34, 1.3], { ...leather, segW: Q(16), segH: Q(9), rot: [0.5, 0, 0], deform: boxy(0.3) });
    // seams over the back of the hand toward each finger
    for (let k = 0; k < 4; k++) {
      const x = f[0] - 1.05 + k * 0.72;
      Lb.tube([{ c: [x - 1.4, y - 1.02, -0.95], r: 0.04 }, { c: [x - 0.4, y - 1.05, -0.45], r: 0.04 }, { c: [x, y - 0.95, 0.15], r: 0.04 }], { ...stitch, seg: 4, subdiv: 2 * SD });
    }
    const kb = [];
    for (let k = 0; k < 4; k++) {
      const x = f[0] - 1.05 + k * 0.72;
      const pts = [[x, y - 0.5, 0.5], [x + 0.1, y - 0.2, 1.3], [x + 0.2, y + 0.75, 1.55], [x + 0.25, y + 1.6, 1.25]];
      finger(Lb, pts, 0.35 - (k === 3 ? 0.03 : 0), hgBack);
      kb.push(pts[0]);
    }
    knuckles(Lb, kb, 0.37, hgBack);
    // the thumb along the left side from its fleshy base
    Lb.ellipsoid([f[0] - 1.45, y - 0.15, -1.25], [1.0, 0.6, 0.55], { ...leather, segW: Q(12), segH: Q(8), rot: [0.2, 0, 0.35] });
    finger(Lb, [[f[0] - 1.6, y - 0.1, -1.4], [f[0] - 0.4, y + 0.6, -1.55], [f[0] + 0.9, y + 1.0, -1.35]], 0.4, () => norm([0, 0.35, -1]));
    elbow = [f[0] - 11, f[1] - 10, -7];
  }
  // forearm: cuff and strap, the sleeve to the elbow (off-screen) with the patch
  const wr = [hand[0] - 1.9, hand[1] - 1.1, hand[2] - 0.9];
  forearm(Lb, wr, model.supportElbow || elbow, { patch: true });
  void HALF_PI;
  return { right, left: Lb.build(), leftHand: hand };
}
