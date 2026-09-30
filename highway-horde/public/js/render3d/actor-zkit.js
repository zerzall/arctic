// Accessory groups for the zombie models (actor-zmodels.js): hats, hair, glasses, ties,
// lanyards, packs, belts, cuffs, gore (entrails, spine, stumps, rebar), brute armour.
// Every piece is tagged with its option name (`opt`), so it lives in the model's single
// vertex buffer and the rig shader collapses it unless the instance's look (actor-zlook.js)
// switched it on. Coordinates are model space (+X forward, +Y up, +Z right, feet at y = 0)
// derived from the type's proportions P; L is the level of detail (0 near .. 2 far).
//
// Several looks share one group and differ by a per-instance parameter the shader reads:
// the cap is a visor when its crown is cut away, hair strands are long, shoulder-length,
// a bob or shaggy by their cut height, and one shoe is a dress shoe, a sneaker or a boot.
// Hidden groups still cost their vertices, so everything here is low-poly.

import { SLOT, MAT, PART, lineRings } from './actor-shape.js';
import { B } from './actor-consts.js';

const bw = (a, b, w) => (w <= 0 ? a : w >= 1 ? b : [a, b, w]);
const BLACK = '#161616', STRAP = '#22201c', BONE = '#d9d0b4', FLESH = '#6a1616', GUTS = '#8a3a44', RUST = '#5a3a26';

/** Push a sphere toward a rounded cube (unit-space deform). */
function cubeDeform(e = 0.5) {
  return (p) => {
    const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
    const x = f(p.x), y = f(p.y), z = f(p.z);
    const l = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1;
    p.x = x / l; p.y = y / l; p.z = z / l;
  };
}

/** A builder facade: everything it adds carries the option name. */
function grp(sb, opt, defaults = {}) {
  const base = { opt, ...defaults };
  return {
    ell(c, r, o = {}) { return sb.ellipsoid(c, r, { segW: 8, segH: 5, ...base, ...o }); },
    box(c, size, o = {}) {
      const sg = o.seg || 6;
      return sb.ellipsoid(c, [size[0] / 2, size[1] / 2, size[2] / 2], { segW: sg, segH: Math.max(4, sg - 2), deform: cubeDeform(o.round ?? 0.5), ...base, ...o });
    },
    tube(rings, o = {}) { return sb.tube(rings, { seg: 6, ...base, ...o }); },
    line(a, b, r0, r1, n, o = {}, extra) { return sb.tube(lineRings(a, b, r0, r1, n, extra), { seg: 5, ...base, ...o }); },
  };
}

// ---------------------------------------------------------------------------------------
// headwear

function domeDeform(cutY, front) {
  return (p) => {
    const cut = cutY + Math.max(0, p.x) * front;
    if (p.y < cut) p.y = cut + (p.y - cut) * 0.1;
  };
}

function hats(sb, P, L, has) {
  const c = P.headC, r = P.headR;
  const W = L === 0 ? 10 : 8, H = L === 0 ? 6 : 5;
  const dome = (g, y0, k, o, cut = -0.05, front = 0.2) => g.ell([c[0] - 0.2, c[1] + y0, 0], [r[0] * k, r[1] * k * 0.95, r[2] * k * 1.02], { segW: W, segH: H, bone: B.HEAD, deform: domeDeform(cut, front), ...o });
  const brim = (g, x, y, w, d, o = {}) => g.ell([c[0] + x, c[1] + y, 0], [d, 0.28, w], { segW: 8, segH: 3, bone: B.HEAD, deform: (p) => { if (p.x < 0) p.x *= 0.25; }, ...o });
  const band = (g, y0, y1, kx, kz, o = {}) => g.tube([{ c: [c[0] - 0.2, c[1] + y0, 0], rx: r[0] * kx, rz: r[2] * kz }, { c: [c[0] - 0.2, c[1] + y1, 0], rx: r[0] * kx, rz: r[2] * kz }], { seg: W, bone: B.HEAD, ...o });
  if (has('hat_cap')) {
    // baseball cap; as a visor the crown (PART.CROWN) is cut away per instance
    const g = grp(sb, 'hat_cap', { slot: SLOT.GEAR, mat: MAT.CLOTH, part: PART.HAT });
    dome(g, 0.9, 1.08, { color: '#ffffff', part: PART.CROWN });
    brim(g, r[0] * 1.02, 1.0, 3.0, 2.9, { rot: [0, 0, -0.14], color: '#e8e8e8' });
    band(g, 1.0, 1.55, 1.075, 1.1, { color: '#bdbdbd' });
  }
  if (has('hat_hard')) {
    const g = grp(sb, 'hat_hard', { slot: SLOT.GEAR, mat: MAT.RUBBER, part: PART.HAT });
    dome(g, 1.0, 1.16, { color: '#ffffff' });
    g.tube([{ c: [c[0] + 0.1, c[1] + 0.7, 0], rx: r[0] * 1.46, rz: r[2] * 1.4 }, { c: [c[0] + 0.1, c[1] + 1.15, 0], rx: r[0] * 1.42, rz: r[2] * 1.36 }], { seg: W, bone: B.HEAD, cap0: 'flat', cap1: 'flat', color: '#efefef' });
    g.line([c[0] - 4.2, c[1] + r[1] * 1.1 + 0.6, 0], [c[0] + 4.4, c[1] + r[1] * 1.1 + 0.6, 0], 0.55, 0.55, 4, { seg: 4, bone: B.HEAD, color: '#f8f8f8' }, (q, t) => { q.c[1] += Math.sin(t * Math.PI) * 0.9; });
  }
  if (has('hat_peak')) {
    const g = grp(sb, 'hat_peak', { slot: SLOT.GEAR, mat: MAT.CLOTH, part: PART.HAT });
    g.ell([c[0] - 0.3, c[1] + 1.7, 0], [r[0] * 1.28, 1.7, r[2] * 1.32], { segW: W, segH: 5, bone: B.HEAD, color: '#ffffff', deform: (p) => { if (p.y < 0) p.y *= 0.3; p.x *= 1 + 0.08 * Math.max(0, p.y); } });
    g.tube([{ c: [c[0] - 0.3, c[1] + 0.5, 0], rx: r[0] * 1.22, rz: r[2] * 1.26 }, { c: [c[0] - 0.3, c[1] + 1.6, 0], rx: r[0] * 1.24, rz: r[2] * 1.28 }], { seg: W, bone: B.HEAD, slot: SLOT.FIXED, color: '#101012', mat: MAT.LEATHER });
    brim(g, r[0] * 1.1, 0.6, 3.0, 2.6, { rot: [0, 0, -0.18], slot: SLOT.FIXED, color: '#101012', mat: MAT.LEATHER });
    g.ell([c[0] + r[0] * 1.24, c[1] + 1.3, 0], [0.25, 0.7, 0.7], { segW: 5, segH: 4, bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.METAL, color: '#b8a040' });
  }
  if (has('hat_helmet')) {
    const g = grp(sb, 'hat_helmet', { slot: SLOT.GEAR, mat: MAT.CLOTH, part: PART.HAT });
    dome(g, 0.65, 1.2, { color: '#ffffff' }, -0.02, 0.05);
    band(g, 0.25, 0.85, 1.24, 1.27, { slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#2a2a26' });
    if (L === 0) {
      g.box([c[0] + r[0] * 1.2, c[1] + 2.9, 0], [0.9, 1.6, 1.8], { seg: 5, bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.METAL, color: '#2a2a2a' });
      for (const s of [-1, 1]) g.line([c[0] - 0.4, c[1] + 0.4, s * r[2] * 1.13], [c[0] + 1.8, c[1] - 4.3, s * r[2] * 0.7], 0.22, 0.22, 2, { seg: 3, bone: bw(B.HEAD, B.JAW, 0.3), slot: SLOT.FIXED, mat: MAT.LEATHER, color: STRAP });
    }
  }
  if (has('hat_fire')) {
    const g = grp(sb, 'hat_fire', { slot: SLOT.GEAR, mat: MAT.LEATHER, part: PART.HAT });
    dome(g, 1.0, 1.18, { color: '#ffffff' });
    g.ell([c[0] - r[0] * 0.9, c[1] + 0.9, 0], [r[0] * 1.35, 0.35, r[2] * 1.55], { segW: 10, segH: 3, bone: B.HEAD, color: '#e8e8e8', rot: [0, 0, 0.32], deform: (p) => { if (p.x > 0.5) p.x = 0.5 + (p.x - 0.5) * 0.4; } });
    g.ell([c[0] + r[0] * 1.0, c[1] + 2.9, 0], [0.4, 1.6, 2.1], { segW: 6, segH: 4, bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.METAL, color: '#c8b040' });
    g.line([c[0] - 4.6, c[1] + r[1] * 1.14 + 0.8, 0], [c[0] + 4.6, c[1] + r[1] * 1.14 + 0.8, 0], 0.6, 0.6, 4, { seg: 4, bone: B.HEAD, color: '#f4f4f4' }, (q, t) => { q.c[1] += Math.sin(t * Math.PI) * 1.0; });
  }
  if (has('hat_beanie')) {
    const g = grp(sb, 'hat_beanie', { slot: SLOT.GEAR, mat: MAT.CLOTH, part: PART.HAT });
    dome(g, 1.3, 1.1, { color: '#ffffff' }, -0.1, 0.12);
    band(g, 0.1, 1.9, 1.13, 1.16, { color: '#cfcfcf' });
    g.ell([c[0] - 0.4, c[1] + r[1] * 1.05 + 1.4, 0], [0.8, 0.8, 0.8], { segW: 6, segH: 4, bone: B.HEAD, color: '#e0e0e0' });
  }
  if (has('hat_straw')) {
    const g = grp(sb, 'hat_straw', { slot: SLOT.GEAR, mat: MAT.CLOTH, part: PART.HAT });
    dome(g, 1.2, 1.08, { color: '#ffffff' }, -0.05, 0.05);
    g.ell([c[0], c[1] + 1.3, 0], [r[0] * 2.05, 0.3, r[2] * 2.35], { segW: 12, segH: 3, bone: B.HEAD, color: '#f0f0f0', deform: (p) => { p.y += (p.x * p.x + p.z * p.z) * 0.35; } });
    band(g, 1.3, 2.2, 1.1, 1.13, { slot: SLOT.FIXED, color: '#8a2a22', mat: MAT.CLOTH });
  }
  if (has('hat_hood')) {
    // hood up: a soft shell round the back and sides of the head with a rounded opening
    const g = grp(sb, 'hat_hood', { slot: SLOT.CLOTH, mat: MAT.CLOTH, part: PART.TOP });
    g.ell([c[0] - 0.9, c[1] + 0.2, 0], [r[0] * 1.32, r[1] * 1.22, r[2] * 1.36], { segW: 10, segH: 7, bone: B.HEAD, color: '#ffffff',
      deform: (p) => { if (p.x > 0.1) { const k = 1 - (p.x - 0.1) * 0.05; p.x = 0.1 + (p.x - 0.1) * 0.12; p.z *= k; p.y *= k; } if (p.y < -0.55) p.y = -0.55 + (p.y + 0.55) * 0.2; } });
    g.tube([{ c: [c[0] + 0.1, c[1] - r[1] * 0.75, 0], rx: 2.6, rz: r[2] * 1.25, bone: B.HEAD }, { c: [c[0] - 0.5, c[1] - r[1] * 1.15 - 1.2, 0], rx: 3.6, rz: r[2] * 1.5, bone: B.NECK }], { seg: 10, color: '#f0f0f0' });
  }
}

// ---------------------------------------------------------------------------------------
// hair

function hair(sb, P, L, has, headDef, cin = false) {
  const c = P.headC, r = P.headR;
  const on = (x, y, z, inset) => {
    const l = Math.hypot(x, y, z);
    const p = { x: x / l, y: y / l, z: z / l };
    headDef(p);
    return [c[0] + p.x * r[0] * inset, c[1] + p.y * r[1] * inset, c[2] + p.z * r[2] * inset];
  };
  const S = { slot: SLOT.HAIR, mat: MAT.HAIR, color: '#ffffff', bone: B.HEAD };
  if (has('hair_scalp')) {
    // a thin, matted scalp layer (the hair material thins it into bald patches)
    sb.ellipsoid([c[0] - 0.15, c[1] + 0.05, 0], cin ? [r[0] * 1.03, r[1] * 1.026, r[2] * 1.035] : [r[0] * 1.012, r[1] * 1.01, r[2] * 1.018], {
      ...S, opt: 'hair_scalp', segW: L ? 8 : cin ? 40 : 14, segH: L ? 5 : cin ? 28 : 9,
      deform: (p) => {
        headDef(p);
        const hl = 0.25 + Math.max(0, p.x) * 0.3 - Math.max(0, -p.x) * 0.4;
        if (p.y < hl) { p.x *= 0.94; p.y = hl - (hl - p.y) * 0.2; p.z *= 0.94; }
      },
    });
  }
  if (has('hair_strands')) {
    // long strands from the crown and the back; the instance cuts them to length
    const n = L ? 6 : cin ? 72 : 18;
    for (let i = 0; i < n; i++) {
      const h1 = ((i * 0.618034) % 1), h2 = ((i * 0.414214 + 0.3) % 1);
      const lon = Math.PI * (cin ? 0.28 : 0.32) + (i / (n - 1)) * Math.PI * (cin ? 1.44 : 1.36);
      const lat = cin ? 0.18 + h2 * 0.55 : 0.28 + h2 * 0.4;
      const ux = Math.cos(lon) * Math.cos(lat), uz = Math.sin(lon) * Math.cos(lat), uy = Math.sin(lat);
      const root = on(ux, uy, uz, 0.97);
      const len = 17 * (0.8 + h1 * 0.3);
      const pts = [];
      const nr = L ? 3 : cin ? 6 : 4;
      const wob = cin ? Math.sin(i * 2.3) * 0.5 : 0;
      for (let j = 0; j <= nr; j++) {
        const t = j / nr, sag = t * t;
        pts.push({ c: [root[0] + ux * 0.35 * t - sag * 1.3, root[1] - len * sag - t * 0.8, root[2] + uz * 0.3 * t + sag * uz * 0.7 + wob * Math.sin(t * 3.1 + i)],
          rx: cin ? 0.2 - t * 0.12 : 0.42 - t * 0.16, rz: cin ? (0.78 - t * 0.5) * (0.85 + h1 * 0.4) : (1.15 - t * 0.55) * 1.05, bone: t < 0.3 ? B.HEAD : t < 0.7 ? bw(B.HEAD, B.CHEST, 0.5) : B.CHEST });
      }
      sb.tube(pts, { ...S, opt: 'hair_strands', part: PART.HAIR, seg: 4, subdiv: cin ? 2 : 1, cap1: 'round', capRings: 1, ref: [ux, uy, uz] });
    }
  }
  if (L > 0 && !has('hair_afro')) return;
  if (has('hair_pony')) {
    const root = [c[0] - r[0] * 0.95, c[1] + r[1] * 0.2, 0];
    sb.tube([{ c: root, rx: 1.1, rz: 1.1, bone: B.HEAD }, { c: [root[0] - 2.2, root[1] - 1.2, 0], rx: 1.0, rz: 1.1, bone: B.HEAD }, { c: [root[0] - 3.0, root[1] - 5.5, 0.2], rx: 0.9, rz: 1.0, bone: bw(B.HEAD, B.CHEST, 0.5) }, { c: [root[0] - 2.6, root[1] - 10, 0.5], rx: 0.5, rz: 0.6, bone: B.CHEST }],
      { ...S, opt: 'hair_pony', seg: 5, cap0: 'round', cap1: 'round', capRings: 1 });
  }
  if (has('hair_bun')) sb.ellipsoid([c[0] - r[0] * 0.5, c[1] + r[1] * 1.0, 0], [1.5, 1.3, 1.5], { ...S, opt: 'hair_bun', segW: 7, segH: 5 });
  if (has('hair_mohawk')) {
    const pts = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push({ c: [c[0] + (t - 0.5) * 7.4, c[1] + r[1] * 0.88 + Math.sin(t * Math.PI) * 2.6, 0], rx: 0.6, rz: 0.35 + Math.sin(t * Math.PI) * 0.4, bone: B.HEAD }); }
    sb.tube(pts, { ...S, opt: 'hair_mohawk', seg: 5, ref: [0, 1, 0] });
  }
  if (has('hair_afro')) sb.ellipsoid([c[0] - 0.6, c[1] + 1.2, 0], [r[0] * 1.5, r[1] * 1.32, r[2] * 1.55], { ...S, opt: 'hair_afro', segW: L ? 8 : 10, segH: L ? 5 : 7, deform: (p) => { const k = 1 + 0.06 * Math.sin(p.x * 9) * Math.sin(p.y * 8) * Math.sin(p.z * 7); p.x *= k; p.y *= k; p.z *= k; if (p.y < -0.2 && p.x > 0) { p.x *= 0.7; p.y = -0.2 + (p.y + 0.2) * 0.3; } } });
}

// ---------------------------------------------------------------------------------------
// face

function face(sb, P, L, has, headDef) {
  if (L > 0) return;
  const c = P.headC, r = P.headR;
  const at = (x, y, z, inset = 1) => {
    const l = Math.hypot(x, y, z);
    const p = { x: x / l, y: y / l, z: z / l };
    headDef(p);
    return [c[0] + p.x * r[0] * inset, c[1] + p.y * r[1] * inset, c[2] + p.z * r[2] * inset];
  };
  if (has('face_glasses')) {
    // glasses or sunglasses (the lens darkness is per instance)
    const g = grp(sb, 'face_glasses', { bone: B.HEAD });
    for (const s of [-1, 1]) {
      const e = at(0.95, 0.13, s * 0.37, 1.05);
      g.ell([e[0] - 0.05, e[1], e[2]], [0.12, 1.28, 1.42], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.METAL, color: '#101010' });
      g.ell([e[0] + 0.08, e[1], e[2]], [0.1, 1.06, 1.2], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.GLASS, color: '#ffffff', part: PART.LENS });
      g.line([e[0] - 0.2, e[1] + 0.1, e[2] + s * 1.2], [e[0] - 3.4, e[1] + 0.2, s * r[2] * 0.99], 0.13, 0.13, 2, { seg: 3, slot: SLOT.FIXED, mat: MAT.METAL, color: '#101010' });
    }
    const bridge = at(0.98, 0.15, 0, 1.05);
    g.line([bridge[0], bridge[1], -0.9], [bridge[0], bridge[1], 0.9], 0.13, 0.13, 2, { seg: 3, slot: SLOT.FIXED, mat: MAT.METAL, color: '#101010' });
  }
  if (has('face_mask')) {
    const g = grp(sb, 'face_mask', { bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#a8d0e0' });
    const m = at(0.85, -0.3, 0, 1.06);
    g.ell([m[0] - 0.2, m[1], 0], [1.5, 2.1, r[2] * 0.86], { segW: 8, segH: 6, deform: (p) => { p.x = Math.abs(p.x) * 0.5 + (p.x > 0 ? 0.3 : 0); } });
    for (const s of [-1, 1]) g.line([m[0] - 0.6, m[1] + 0.5, s * r[2] * 0.85], [c[0] - 0.5, c[1] + 0.3, s * r[2] * 1.02], 0.14, 0.14, 2, { seg: 3, color: '#e0e8ec' });
  }
  if (has('face_gasmask')) {
    const g = grp(sb, 'face_gasmask', { bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#26282a' });
    g.ell([c[0] + r[0] * 0.35, c[1] - 0.6, 0], [r[0] * 0.78, r[1] * 0.8, r[2] * 1.07], { segW: 10, segH: 7, deform: (p) => { if (p.x < -0.1) p.x = -0.1 + (p.x + 0.1) * 0.3; } });
    for (const s of [-1, 1]) g.ell([c[0] + r[0] * 1.02, c[1] + 0.7, s * 1.5], [0.3, 1.0, 1.05], { segW: 7, segH: 4, mat: MAT.GLASS, color: '#0a1418' });
    g.line([c[0] + r[0] * 1.0, c[1] - 2.2, 0.9], [c[0] + r[0] * 1.45, c[1] - 2.5, 1.4], 1.05, 1.05, 2, { seg: 7, mat: MAT.METAL, color: '#6a6a60' });
  }
  if (has('face_beard')) {
    grp(sb, 'face_beard', { bone: B.JAW }).ell([c[0] + r[0] * 0.42, c[1] - r[1] * 0.76, 0], [r[0] * 0.62, r[1] * 0.42, r[2] * 0.9], {
      segW: 9, segH: 6, slot: SLOT.HAIR, mat: MAT.HAIR, color: '#ffffff', deform: (p) => { if (p.y > 0.25) p.y = 0.25 + (p.y - 0.25) * 0.4; if (p.x < -0.2) p.x *= 0.4; } });
  }
  if (has('face_eyepatch')) {
    const g = grp(sb, 'face_eyepatch', { bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.LEATHER, color: BLACK });
    const e = at(0.95, 0.13, -0.37, 1.04);
    g.ell([e[0], e[1], e[2]], [0.22, 1.0, 1.05], { segW: 7, segH: 4 });
    g.line([e[0] - 0.3, e[1] + 0.9, e[2] + 0.3], [c[0] - 0.5, c[1] + 1.6, 1.8], 0.12, 0.12, 3, { seg: 3 });
  }
}

// ---------------------------------------------------------------------------------------
// neck, chest, torso, back

function torsoGear(sb, P, L, has) {
  const D = P.depth, K = P.bulk;
  const fx = 5.3 * D;           // the top's surface (torso + loose shell)
  const S = { bone: B.CHEST };
  if (L > 0) return;
  if (has('tie')) {
    const g = grp(sb, 'tie', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    g.tube([{ c: [fx * 0.9 + 0.5, P.sY + 0.4, 0], rx: 0.5, rz: 0.75 }, { c: [fx + 0.45, P.chest + 5, 0], rx: 0.32, rz: 0.55 }, { c: [fx + 0.62, P.chest + 2.2, 0], rx: 0.32, rz: 1.05 }, { c: [fx + 0.55, P.chest - 1.6, 0], rx: 0.3, rz: 1.25 }, { c: [fx + 0.3, P.chest - 3.4, 0], rx: 0.25, rz: 0.4 }],
      { seg: 4, color: '#ffffff', ref: [1, 0, 0] });
    g.ell([fx * 0.95 + 0.4, P.sY - 0.2, 0], [0.7, 0.8, 1.0], { segW: 5, segH: 4, color: '#e8e8e8' });
  }
  if (has('lanyard')) {
    const g = grp(sb, 'lanyard', { ...S });
    for (const s of [-1, 1]) g.tube([{ c: [-0.6, P.neck + 0.2, s * 2.6], r: 0.2 }, { c: [1.2, P.neck - 0.3, s * 3.2], r: 0.2 }, { c: [fx * 0.92, P.sY - 1.2, s * 2.2], r: 0.2 }, { c: [fx + 0.4, P.chest + 4.4, s * 0.2], r: 0.2 }], { seg: 3, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#ffffff' });
    g.box([fx + 0.55, P.chest + 2.6, 0.4], [0.28, 3.3, 2.3], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#e8e8e4' });
    g.box([fx + 0.72, P.chest + 3.2, 0.4], [0.1, 1.2, 1.2], { seg: 4, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#8a7a68' });
  }
  if (has('stetho')) {
    const g = grp(sb, 'stetho', { ...S, slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#1c1c1c' });
    const pts = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push({ c: [Math.sin(a) * 3.4 * D + 0.9, P.neck - 0.5 - Math.sin(a * 0.5) * 3.8, Math.cos(a) * 3.6 * K], r: 0.28 }); }
    g.tube(pts, { seg: 4 });
    g.ell([fx * 0.96 + 0.4, P.chest + 3.2, 2.6], [0.3, 0.9, 0.9], { segW: 6, segH: 4, mat: MAT.METAL, color: '#b0b0b0' });
    g.line(pts[8].c, [fx * 0.96 + 0.3, P.chest + 3.6, 2.6], 0.24, 0.24, 2, { seg: 3 });
  }
  if (has('scarf')) {
    const g = grp(sb, 'scarf', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    g.tube([{ c: [0.3, P.neck - 0.4, 0], rx: 3.3, rz: 3.6, bone: bw(B.CHEST, B.NECK, 0.5) }, { c: [0.3, P.neck + 1.6, 0], rx: 3.0, rz: 3.3, bone: bw(B.CHEST, B.NECK, 0.5) }], { seg: 10, color: '#ffffff' });
    g.tube([{ c: [fx * 0.75, P.neck - 0.4, 1.2], rx: 0.6, rz: 1.4 }, { c: [fx * 0.92, P.chest + 6, 1.4], rx: 0.5, rz: 1.5 }, { c: [fx * 0.98, P.chest + 1, 1.6], rx: 0.4, rz: 1.5 }], { seg: 5, color: '#e8e8e8' });
  }
  if (has('camera')) {
    const g = grp(sb, 'camera', { ...S, slot: SLOT.FIXED });
    for (const s of [-1, 1]) g.line([0.3, P.neck, s * 2.6], [fx * 0.95, P.chest + 1.6, s * 1.6], 0.2, 0.2, 3, { seg: 3, mat: MAT.LEATHER, color: BLACK });
    g.box([fx + 1.0, P.chest + 0.4, 0], [1.9, 2.4, 3.6], { seg: 6, round: 0.3, mat: MAT.METAL, color: '#2a2a2c' });
    g.line([fx + 1.9, P.chest + 0.3, 0], [fx + 3.2, P.chest + 0.3, 0], 0.85, 0.75, 2, { seg: 7, mat: MAT.METAL, color: '#181818' });
  }
  if (has('dogtags')) {
    const g = grp(sb, 'dogtags', { ...S, slot: SLOT.FIXED, mat: MAT.METAL, color: '#9a9a96' });
    g.tube([{ c: [0.5, P.neck, -2.5], r: 0.13 }, { c: [fx * 0.95, P.sY - 1.5, -1.0], r: 0.13 }, { c: [fx + 0.3, P.chest + 4.0, 0], r: 0.13 }, { c: [fx * 0.95, P.sY - 1.5, 1.0], r: 0.13 }, { c: [0.5, P.neck, 2.5], r: 0.13 }], { seg: 3 });
    g.box([fx + 0.4, P.chest + 3.2, 0.3], [0.12, 1.5, 1.0], { seg: 4, round: 0.3 });
  }
  if (has('badge')) {
    grp(sb, 'badge', { ...S, slot: SLOT.FIXED, mat: MAT.METAL, color: '#c8b050' }).ell([fx + 0.15, P.chest + 3.6, 2.8], [0.22, 1.2, 1.1], { segW: 8, segH: 5, deform: (p) => { const a = Math.atan2(p.z, p.y); const k = 0.75 + 0.25 * Math.abs(Math.cos(a * 2.5)); p.y *= k; p.z *= k; } });
  }
  if (has('vest_plate')) {
    const g = grp(sb, 'vest_plate', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    g.tube([{ c: [0.0, P.waist + 1.8, 0], rx: 4.9 * D + 0.6, rz: 6.2 * K + 0.5 }, { c: [0.1, P.chest + 1.2, 0], rx: 5.3 * D + 0.6, rz: 7.4 * K + 0.5 }, { c: [0.0, P.sY - 1.4, 0], rx: 4.8 * D + 0.6, rz: 7.9 * K + 0.4 }], { seg: 12, cap0: 'flat', cap1: 'flat', color: '#ffffff' });
    for (let k = -1; k <= 1; k++) g.box([fx + 1.15, P.waist + 4.2, k * 2.6], [1.5, 3.4, 2.1], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#3a3f32' });
    g.box([fx + 0.9, P.chest + 3.0, 0], [1.2, 6.5, 6.8], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#4a4f3c' });
  }
  if (has('suspenders')) {
    const g = grp(sb, 'suspenders', { ...S, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#3a2a22' });
    for (const s of [-1, 1]) g.tube([{ c: [fx * 0.98, P.waist + 0.6, s * 3.0], rx: 0.35, rz: 0.75 }, { c: [fx * 0.9, P.chest + 3, s * 3.3], rx: 0.35, rz: 0.75 }, { c: [1.0, P.sY + 0.9, s * 3.6], rx: 0.4, rz: 0.75 }, { c: [-fx * 0.9, P.chest + 3, s * 3.6], rx: 0.35, rz: 0.75 }, { c: [-fx, P.waist + 0.6, s * 3.2], rx: 0.35, rz: 0.75 }], { seg: 4, ref: [1, 0, 0] });
  }
  if (has('apron')) {
    const g = grp(sb, 'apron', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    g.tube([{ c: [fx * 0.95 + 0.5, P.sY - 1.2, 0], rx: 0.35, rz: 3.3 }, { c: [fx * 0.98 + 0.55, P.chest, 0], rx: 0.35, rz: 5.6 * K }, { c: [fx * 0.9 + 0.7, P.waist - 4.5, 0], rx: 0.4, rz: 6.6 * K, bone: bw(B.SPINE, B.HIPS, 0.6) }, { c: [fx * 0.85 + 0.8, P.knee + 4, 0], rx: 0.4, rz: 6.8 * K, bone: B.HIPS }], { seg: 8, color: '#ffffff', ref: [1, 0, 0], cap0: 'flat', cap1: 'flat' });
    for (const s of [-1, 1]) g.tube([{ c: [-0.5, P.neck + 0.2, s * 2.6], r: 0.25 }, { c: [fx * 0.9 + 0.5, P.sY - 0.8, s * 2.6], r: 0.25 }], { seg: 3, color: '#f0f0f0' });
  }
  const belt = (opt, color) => grp(sb, opt, { bone: B.SPINE, slot: SLOT.FIXED, mat: MAT.LEATHER, color });
  const beltTube = (g, color) => g.tube([{ c: [0.3, P.waist - 1.8, 0], rx: 4.6 * D + 0.5, rz: 6.2 * K + 0.5 }, { c: [0.3, P.waist + 0.4, 0], rx: 4.6 * D + 0.5, rz: 6.2 * K + 0.5 }], { seg: 12, color });
  if (has('belt_duty')) {
    const g = belt('belt_duty', '#181818');
    beltTube(g, '#181818');
    g.box([1.0, P.waist - 3.4, 6.4 * K], [2.4, 4.2, 1.6], { seg: 5, round: 0.3 });
    g.box([2.6, P.waist - 1.1, -3.2], [1.4, 2.4, 1.6], { seg: 5, round: 0.3 });
    g.box([-2.4, P.waist - 1.0, -5.6 * K], [1.4, 3.4, 1.5], { seg: 5, round: 0.3, color: '#26282a' });
    g.box([4.1 * D, P.waist - 1.1, 0], [0.5, 1.5, 1.5], { seg: 4, round: 0.4, mat: MAT.METAL, color: '#8a8a86' });
  }
  if (has('belt_tool')) {
    const g = belt('belt_tool', '#4a3a26');
    beltTube(g, '#4a3a26');
    g.box([3.6, P.waist - 3.6, 5.0 * K], [2.6, 4.0, 2.2], { seg: 5, round: 0.3 });
    g.box([3.2, P.waist - 3.2, -4.8 * K], [2.4, 3.2, 2.0], { seg: 5, round: 0.3, color: '#3a2a1a' });
    g.line([2.4, P.waist - 3, 6.8 * K], [2.4, P.waist - 10.5, 7.0 * K], 0.32, 0.32, 2, { seg: 4, mat: MAT.METAL, color: '#7a7a78' });
    g.box([2.4, P.waist - 11.2, 7.0 * K], [1.0, 1.5, 3.0], { seg: 5, round: 0.3, mat: MAT.METAL, color: '#5a5a58' });
  }
  if (has('fanny')) {
    const g = belt('fanny', '#2a2a2c');
    beltTube(g, '#1c1c1c');
    g.box([4.6 * D + 0.9, P.waist - 1.6, 1.0], [2.2, 3.4, 5.6], { seg: 6, round: 0.3, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#ffffff' });
  }
}

function backGear(sb, P, L, has) {
  if (L > 0) {
    // mid range: the big shapes only
    if (!(has('pack_small') || has('pack_big'))) return;
  }
  const D = P.depth, K = P.bulk;
  const xb = -4.6 * D;
  const S = { bone: B.CHEST, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#ffffff' };
  const straps = (g, yTop) => {
    if (L > 0) return;
    for (const s of [-1, 1]) g.tube([{ c: [xb - 0.6, yTop, s * 3.2 * K], rx: 0.4, rz: 0.9 }, { c: [0.0, P.sY + 1.2, s * 3.5 * K], rx: 0.5, rz: 1.0 }, { c: [4.5 * D, P.chest + 4, s * 3.8 * K], rx: 0.5, rz: 1.0 }, { c: [4.9 * D, P.chest - 2, s * 4.6 * K], rx: 0.4, rz: 0.9 }], { seg: 4, slot: SLOT.FIXED, color: STRAP, mat: MAT.CLOTH, bone: B.CHEST, ref: [1, 0, 0] });
  };
  if (has('pack_small')) {
    const g = grp(sb, 'pack_small', S);
    g.box([xb - 2.4, P.chest + 1.4, 0], [4.6, 10, 8.4 * K], { seg: 7, round: 0.4 });
    if (L === 0) g.box([xb - 4.5, P.chest - 0.5, 0], [1.4, 4.6, 6.2 * K], { seg: 5, round: 0.3, color: '#d8d8d8' });
    straps(g, P.sY - 1);
  }
  if (has('pack_big')) {
    const g = grp(sb, 'pack_big', S);
    g.box([xb - 3.2, P.chest + 1.4, 0], [6.2, 13, 9.6 * K], { seg: 7, round: 0.4 });
    g.box([xb - 3.0, P.chest + 8.8, 0], [6.8, 3.2, 9.8 * K], { seg: 6, round: 0.4, color: '#d0d0d0' });
    if (L === 0) {
      for (const s of [-1, 1]) g.box([xb - 3.1, P.chest - 1.2, s * 5.6 * K], [3.6, 6, 2.6], { seg: 5, round: 0.4, color: '#d8d8d8' });
      g.line([xb - 5.6, P.chest - 5.8, -5.4 * K], [xb - 5.6, P.chest - 5.8, 5.4 * K], 1.8, 1.8, 2, { seg: 6, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#6a6a4a' });
    }
    straps(g, P.sY - 1);
  }
  if (L > 0) return;
  if (has('bag_msg')) {
    const g = grp(sb, 'bag_msg', { ...S, bone: B.HIPS });
    g.box([-3.8 * D, P.hip - 1.6, 6.9 * K], [6.2, 5.4, 2.6], { seg: 6, round: 0.3 });
    g.tube([{ c: [-1.6 * D, P.sY + 1.2, -3.4 * K], rx: 0.3, rz: 0.9 }, { c: [3.6 * D, P.chest + 4.4, -0.6], rx: 0.4, rz: 1.0 }, { c: [3.8 * D, P.chest - 2, 4.6 * K], rx: 0.4, rz: 1.0 }, { c: [-1.6 * D, P.waist - 0.5, 6.7 * K], rx: 0.4, rz: 0.9, bone: B.SPINE }], { seg: 4, bone: B.CHEST, slot: SLOT.FIXED, color: STRAP, ref: [1, 0, 0] });
  }
  if (has('tank_o2')) {
    const g = grp(sb, 'tank_o2', { ...S, mat: MAT.METAL });
    for (const s of [-1, 1]) g.line([xb - 2.2, P.chest - 3.5, s * 2.2 * K], [xb - 2.2, P.chest + 8.5, s * 2.2 * K], 1.55, 1.55, 2, { seg: 8, cap0: 'round', cap1: 'round', capRings: 1, color: '#ffffff' });
    g.box([xb - 0.9, P.chest + 2, 0], [1.2, 12, 8], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.LEATHER, color: '#26262a' });
    straps(g, P.sY - 1);
  }
  if (has('bag_medic')) {
    const g = grp(sb, 'bag_medic', { ...S, bone: B.HIPS });
    g.box([1.0, P.hip - 5.0, 8.4 * K], [7.4, 5.4, 3.0], { seg: 6, round: 0.3 });
    g.box([1.0, P.hip - 5.0, 9.95 * K], [1.9, 0.6, 0.2], { seg: 4, round: 0.2, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828' });
    g.box([1.0, P.hip - 5.0, 9.95 * K], [0.6, 1.9, 0.2], { seg: 4, round: 0.2, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828' });
    g.tube([{ c: [-1.6 * D, P.sY + 1.2, 3.4 * K], rx: 0.3, rz: 0.9 }, { c: [3.6 * D, P.chest + 4.4, 0.6], rx: 0.4, rz: 1.0 }, { c: [3.8 * D, P.chest - 2, -4.6 * K], rx: 0.4, rz: 1.0 }, { c: [-1.6 * D, P.waist - 0.5, -6.7 * K], rx: 0.4, rz: 0.9, bone: B.SPINE }], { seg: 4, bone: B.CHEST, slot: SLOT.FIXED, color: STRAP, ref: [1, 0, 0] });
  }
}

// ---------------------------------------------------------------------------------------
// hands, legs, skirt

function limbGear(sb, P, L, has) {
  if (L > 0) return;
  const el = P.sY - P.uarm, wr = P.sY - P.uarm - P.farm;
  for (const s of [-1, 1]) {
    const R = s > 0;
    const FA = R ? B.FARM_R : B.FARM_L, HD = R ? B.HAND_R : B.HAND_L, UA = R ? B.UARM_R : B.UARM_L;
    const z = s * P.sw;
    if (has('cuffs')) {
      const g = grp(sb, 'cuffs', { bone: FA, slot: SLOT.FIXED, mat: MAT.METAL, color: '#8a8a88' });
      g.tube([{ c: [0.2, wr + 1.6, z], rx: 1.85, rz: 1.7 }, { c: [0.2, wr + 0.6, z], rx: 1.9, rz: 1.75 }], { seg: 8, cap0: 'flat', cap1: 'flat' });
      g.line([0.9, wr + 0.9, z], [2.4, wr - 3.5, z * 0.7], 0.14, 0.14, 3, { seg: 3, bone: HD });
    }
    if (has('watch') && !R) {
      const g = grp(sb, 'watch', { bone: FA, slot: SLOT.FIXED, mat: MAT.METAL, color: '#2a2a2e' });
      g.tube([{ c: [0.2, wr + 1.7, z], rx: 1.55, rz: 1.45 }, { c: [0.2, wr + 0.9, z], rx: 1.55, rz: 1.45 }], { seg: 8, mat: MAT.LEATHER, color: '#3a2a1e' });
      g.box([1.55, wr + 1.35, z], [0.4, 1.2, 1.4], { seg: 5, round: 0.3, color: '#9a9a96' });
    }
    if (has('bandage_hand') && R) {
      const g = grp(sb, 'bandage_hand', { bone: FA, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#e8e4d8' });
      g.tube([{ c: [0.2, wr + 5.0, z], rx: 1.95, rz: 1.8 }, { c: [0.2, wr + 1.8, z], rx: 1.95, rz: 1.8 }], { seg: 8 });
      g.ell([0.7, wr - 1.6, z], [1.5, 2.6, 1.9], { segW: 7, segH: 5, bone: HD, color: '#e4e0d4', deform: (p) => { if (p.y < 0) p.y *= 0.8; } });
      g.ell([1.0, wr + 4.2, z + 0.4], [0.5, 0.8, 0.5], { segW: 5, segH: 4, color: '#8a1414', bone: FA });
    }
    if (has('pompom')) {
      const g = grp(sb, 'pompom', { bone: HD, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#ffffff' });
      g.ell([1.6, wr - 2.6, z], [2.6, 2.6, 2.6], { segW: 8, segH: 6, deform: (p) => { const k = 1 + 0.16 * Math.sin(p.x * 11 + p.y * 7) * Math.sin(p.z * 9); p.x *= k; p.y *= k; p.z *= k; } });
    }
    if (has('kneepads')) {
      const g = grp(sb, 'kneepads', { slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#26282a' });
      const TH = R ? B.THIGH_R : B.THIGH_L, SH = R ? B.SHIN_R : B.SHIN_L;
      g.ell([P.thighR * 0.8, P.knee + 0.4, s * P.legGap], [1.0, 2.3, 2.1], { segW: 7, segH: 5, bone: bw(TH, SH, 0.5) });
    }
    if (has('holster') && R) {
      const g = grp(sb, 'holster', { bone: B.THIGH_R, slot: SLOT.FIXED, mat: MAT.LEATHER, color: '#1c1c1c' });
      g.box([0.2, P.hip - 7, P.legGap + 3.6], [2.0, 7.0, 1.8], { seg: 5, round: 0.3 });
    }
    if (has('stump_hand_l') && !R) stump(sb, 'stump_hand_l', [0.2, wr + 0.8, z], FA, 1.5, 0.35);
    if (has('stump_hand_r') && R) stump(sb, 'stump_hand_r', [0.2, wr + 0.8, z], FA, 1.5, 0.35);
    if (has('stump_l') && !R) stump(sb, 'stump_l', [-0.3, el - 0.2, z], UA, 1.9, 0.55);
    if (has('stump_r') && R) stump(sb, 'stump_r', [-0.3, el - 0.2, z], UA, 1.9, 0.55);
  }
  if (has('skirt')) {
    const g = grp(sb, 'skirt', { bone: B.HIPS, slot: SLOT.CLOTH2, mat: MAT.CLOTH, part: PART.PELVIS });
    g.tube([{ c: [0.3, P.waist + 0.4, 0], rx: 4.3 * P.depth, rz: 5.9 * P.bulk }, { c: [0.2, P.hip - 1.5, 0], rx: 5.4 * P.depth, rz: 7.0 * P.bulk }, { c: [0.1, P.hip - 6, 0], rx: 6.4 * P.depth, rz: 8.2 * P.bulk }], { seg: 12, color: '#ffffff' });
  }
}

function stump(sb, opt, at, bone, r, boneR) {
  const g = grp(sb, opt, { bone });
  g.ell([at[0], at[1] - 0.2, at[2]], [r, 1.0, r], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.FLESH, color: FLESH, paint: 0.9 });
  g.ell([at[0], at[1] - 0.6, at[2]], [boneR, 1.0, boneR], { segW: 5, segH: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE });
}

// ---------------------------------------------------------------------------------------
// gore and armour

function gore(sb, P, L, has) {
  const D = P.depth, K = P.bulk;
  if (has('ribs') && L < 2) {
    const g = grp(sb, 'ribs', { bone: B.CHEST });
    g.ell([2.8 * D, P.chest + 1.4, -4.6 * K], [1.7, 4.0, 2.5 * K], { segW: 7, segH: 5, rot: [0, -0.9, 0], slot: SLOT.FIXED, mat: MAT.FLESH, color: '#3a0808', paint: 0.6 });
    if (L === 0) {
      for (let k = 0; k < 4; k++) {
        const y = P.chest - 0.9 + k * 1.85;
        const rx = 4.85 * D, rz = (7.3 - Math.abs(k - 1.5) * 0.35) * K;
        const pts = [];
        for (let s = 0; s <= 4; s++) {
          const th = 0.28 + (s / 4) * 1.15;
          pts.push({ c: [Math.cos(th) * rx * 1.0, y - s * 0.16, -Math.sin(th) * rz * 1.0], r: 0.44 - s * 0.03 });
        }
        g.tube(pts, { seg: 4, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE });
      }
    }
  }
  if (L > 0) return;
  if (has('entrails')) {
    const g = grp(sb, 'entrails', { bone: B.SPINE, slot: SLOT.FIXED, mat: MAT.FLESH, color: GUTS, paint: 0.9 });
    for (let k = 0; k < 3; k++) {
      const z0 = 0.3 + k * 0.7, pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push({ c: [4.6 * D + Math.sin(t * 5 + k) * 0.5 + t * 0.9, P.waist + 0.6 - t * (7 + k * 2.2), z0 + Math.sin(t * 7 + k * 2) * 0.9], r: 0.72 + Math.sin(t * 12 + k) * 0.22 });
      }
      g.tube(pts, { seg: 5, cap0: 'round', cap1: 'round', capRings: 1, color: k % 2 ? '#8a3a44' : '#a04a52' });
    }
  }
  if (has('spine')) {
    const g = grp(sb, 'spine', { bone: B.CHEST });
    g.ell([-4.1 * D, P.chest + 1.8, 0], [1.1, 11.6, 3.0], { segW: 7, segH: 7, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#5a1414', paint: 0.9 });
    for (let i = 0; i < 7; i++) g.ell([-4.5 * D - 0.4, P.sY + 2.6 - i * 1.9, 0], [0.95, 0.6, 1.05], { segW: 5, segH: 4, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE });
  }
  if (has('bone_arm')) {
    const g = grp(sb, 'bone_arm', { bone: B.FARM_R });
    const y = P.sY - P.uarm - 4.5, z = P.sw;
    g.line([0.2, y, z + 1.0], [2.6, y + 1.4, z + 4.6], 0.5, 0.2, 2, { seg: 5, slot: SLOT.FIXED, mat: MAT.BONE, color: BONE });
    g.ell([0.3, y, z + 0.9], [1.2, 1.3, 1.2], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: FLESH, paint: 1 });
  }
  if (has('rebar')) {
    const g = grp(sb, 'rebar', { bone: B.CHEST, slot: SLOT.FIXED, mat: MAT.METAL, color: RUST });
    g.line([-9, P.chest + 5, -3.5], [9, P.chest + 1, 4.0], 0.42, 0.42, 3, { seg: 5 });
    g.line([9, P.chest + 1, 4.0], [12.5, P.chest - 0.4, 4.6], 0.5, 0.5, 2, { seg: 5 });
    g.ell([4.0, P.chest + 1.6, 2.8], [0.9, 1.5, 1.5], { segW: 6, segH: 4, mat: MAT.FLESH, color: FLESH, paint: 1 });
  }
  if (has('arrow')) {
    const g = grp(sb, 'arrow', { bone: B.CHEST });
    g.line([-4.3 * D, P.chest + 3, -2.0], [-12, P.chest + 7, -4.6], 0.16, 0.14, 2, { seg: 4, slot: SLOT.FIXED, mat: MAT.LEATHER, color: '#8a6a3a' });
    for (const a of [0, 2.1, 4.2]) g.line([-11, P.chest + 6.8, -4.4], [-13.8, P.chest + 8.0 + Math.cos(a) * 0.9, -5.2 + Math.sin(a) * 0.9], 0.5, 0.1, 2, { seg: 3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828' });
  }
}

function armour(sb, P, L, has) {
  if (L > 1) return;
  const D = P.depth, K = P.bulk;
  const M = { slot: SLOT.GEAR, mat: MAT.METAL, color: '#ffffff' };
  if (has('plate_chest')) {
    const g = grp(sb, 'plate_chest', { ...M, bone: B.CHEST });
    g.tube([{ c: [0.1, P.waist + 1.5, 0], rx: 4.7 * D + 0.9, rz: 6.2 * K + 0.9 }, { c: [0.15, P.chest + 1.0, 0], rx: 5.2 * D + 1.0, rz: 7.6 * K + 1.0 }, { c: [0.0, P.sY - 1.2, 0], rx: 4.8 * D + 0.9, rz: 8.0 * K + 0.8 }], { seg: L ? 8 : 12, arc: [-1.2, 1.2], color: '#8a8a86' });
    if (L === 0) {
      for (const y of [P.waist + 3.5, P.chest + 2.5]) g.tube([{ c: [0.1, y, 0], rx: 4.85 * D + 1.2, rz: 6.6 * K + 1.2 }, { c: [0.1, y + 1.0, 0], rx: 4.85 * D + 1.2, rz: 6.6 * K + 1.2 }], { seg: 12, arc: [-1.15, 1.15], color: '#66605a' });
      for (let i = 0; i < 4; i++) g.ell([4.9 * D + 1.4, P.chest - 1 + (i % 2) * 3.2, (i < 2 ? -1 : 1) * 3.4], [0.35, 0.35, 0.35], { segW: 5, segH: 4, color: '#c8c4b8' });
    }
  }
  if (has('plate_shoulder')) {
    const g = grp(sb, 'plate_shoulder', { ...M });
    for (const s of [-1, 1]) {
      const big = s > 0 ? 1.15 : 0.9;
      g.ell([0, P.sY + 0.6, s * (P.sw + 0.4)], [3.8 * big, 2.4 * big, 4.6 * big], { segW: L ? 7 : 10, segH: L ? 4 : 6, bone: bw(B.CHEST, s < 0 ? B.UARM_L : B.UARM_R, 0.75), color: s > 0 ? '#7a7a76' : '#66605a',
        deform: (p) => { if (p.y < -0.1) p.y = -0.1 + (p.y + 0.1) * 0.25; } });
      if (L === 0) for (let i = 0; i < 3; i++) g.line([0.4 + (i - 1) * 1.2, P.sY + 2.5 * big, s * (P.sw + 0.6 + (i - 1) * 1.4)], [0.4 + (i - 1) * 1.7, P.sY + 6.2 * big - i % 2, s * (P.sw + 0.8 + (i - 1) * 2.2)], 0.7, 0.05, 2, { seg: 4, bone: s < 0 ? B.UARM_L : B.UARM_R, color: '#b8b0a0' });
    }
  }
  if (has('plate_arm') && L === 0) {
    const g = grp(sb, 'plate_arm', { ...M });
    for (const s of [-1, 1]) {
      const FA = s < 0 ? B.FARM_L : B.FARM_R;
      const el = P.sY - P.uarm * (s > 0 ? P.rArmK : 1), wr = P.sY - (P.uarm + P.farm) * (s > 0 ? P.rArmK : 1);
      g.tube([{ c: [0, el - 1.0, s * P.sw], rx: P.armR * 1.15 + 0.7, rz: P.armR * 1.1 + 0.7 }, { c: [0, wr + 1.5, s * P.sw], rx: P.armR * 1.0 + 0.6, rz: P.armR * 0.95 + 0.6 }], { seg: 9, arc: [-2.2, 2.2], bone: FA, color: '#6a6a66' });
    }
  }
  if (has('shield') && L === 0) {
    const g = grp(sb, 'shield', { ...M, bone: B.FARM_L });
    const y0 = P.sY - P.uarm * 0.8;
    g.ell([P.armR * 1.2 + 1.5, y0 - 5, -P.sw - 3.4], [1.0, 11, 7], { segW: 10, segH: 7, color: '#2a3038', mat: MAT.GLASS, deform: (p) => { p.x += p.z * p.z * 0.6; } });
    g.tube([{ c: [P.armR * 1.2 + 1.6, y0 + 5.6, -P.sw - 3.4], rx: 0.5, rz: 7.2 }, { c: [P.armR * 1.2 + 1.6, y0 - 15.6, -P.sw - 3.4], rx: 0.5, rz: 7.2 }], { seg: 10, color: '#8a8a86', cap0: 'flat', cap1: 'flat' });
  }
  if (has('spikes')) {
    const g = grp(sb, 'spikes', { ...M, bone: B.CHEST });
    const list = [[-4.8 * D, P.sY + 1.5, -3.5, -0.5, 4.4], [-5.0 * D, P.chest + 4, 2.5, 0.35, 4.6], [-4.6 * D, P.chest, -2.5, -0.2, 3.8], [-3.5 * D, P.sY + 2.8, 4.5, 0.6, 3.6]];
    for (const [x, y, z, a, len] of list) g.line([x, y, z], [x - Math.cos(a) * 0.85 * len, y + 0.4 * len, z + Math.sin(a) * 0.9 * len], 0.8, 0.05, 2, { seg: 4, cap0: 'round', capRings: 1, color: '#a8a090' });
  }
  if (has('chains') && L === 0) {
    const g = grp(sb, 'chains', { bone: B.CHEST, slot: SLOT.FIXED, mat: MAT.METAL, color: '#5a5a58' });
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, a = t * Math.PI;
      pts.push({ c: [Math.sin(a) * (5.5 * D + 0.5) * 0.98 + 0.2, P.sY - 0.8 - t * (P.sY - P.waist - 4), (t - 0.5) * 14 * K], r: 0.45 + (i % 2) * 0.22 });
    }
    g.tube(pts, { seg: 4 });
  }
}

// ---------------------------------------------------------------------------------------

/**
 * Add every accessory group the model can show.
 * @param {ShapeBuilder} sb
 * @param {object} P type proportions
 * @param {number} L level of detail
 * @param {(p: object) => void} headDef the head shape's deform (unit space)
 * @param {(name: string) => boolean} has whether this type's model carries the group at all
 */
export function addAccessories(sb, P, L, headDef, has = () => true, cin = false) {
  if (L === 2) return;
  hats(sb, P, L, has);
  hair(sb, P, L, has, headDef, cin);
  face(sb, P, L, has, headDef);
  torsoGear(sb, P, L, has);
  backGear(sb, P, L, has);
  limbGear(sb, P, L, has);
  gore(sb, P, L, has);
  armour(sb, P, L, has);
}
