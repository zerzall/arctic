// Accessory groups for the zombie models (actor-zmodels.js): hats, hair, glasses, ties,
// lanyards, packs, belts, cuffs, gore (entrails, spine, stumps, rebar), brute armour.
// Every piece is tagged with its option name (`opt`), so it lives in the model's single
// vertex buffer and the rig shader collapses it unless the instance's look (actor-zlook.js)
// switched it on. Coordinates are model space (+X forward, +Y up, +Z right, feet at y = 0)
// derived from the type's proportions P; L is the level of detail (0 near .. 2 far). Gear
// worn on the top sits on its shell (P.frontX / backX / sideZ / shellX / crestY): straps,
// cords and sashes run up the front, over the crest of the shoulder and down the back a hair
// off the cloth, so nothing cuts through a shirt. The nose is an option too: most zombies
// still wear theirs over the skull's rotted cavity.
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
  // (laid out on a 4.5-high skull: offsets and brims scale with the type's head)
  const hk = r[1] / 4.5;
  const dome = (g, y0, k, o, cut = -0.05, front = 0.2) => g.ell([c[0] - 0.2, c[1] + y0 * hk, 0], [r[0] * k, r[1] * k * 0.95, r[2] * k * 1.02], { segW: W, segH: H, bone: B.HEAD, deform: domeDeform(cut, front), ...o });
  const brim = (g, x, y, w, d, o = {}) => g.ell([c[0] + x, c[1] + y * hk, 0], [d * hk, 0.28, w * hk], { segW: 8, segH: 3, bone: B.HEAD, deform: (p) => { if (p.x < 0) p.x *= 0.25; }, ...o });
  const band = (g, y0, y1, kx, kz, o = {}) => g.tube([{ c: [c[0] - 0.2, c[1] + y0 * hk, 0], rx: r[0] * kx, rz: r[2] * kz }, { c: [c[0] - 0.2, c[1] + y1 * hk, 0], rx: r[0] * kx, rz: r[2] * kz }], { seg: W, bone: B.HEAD, ...o });
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
    // long strands from the crown and the back, lank and thin (the shader splits each into
    // clumps and the instance cuts them to length)
    const n = L ? 6 : cin ? 96 : 30;
    const hk = r[1] / 4.5;
    for (let i = 0; i < n; i++) {
      const h1 = ((i * 0.618034) % 1), h2 = ((i * 0.414214 + 0.3) % 1);
      const lon = Math.PI * (cin ? 0.28 : 0.32) + (i / (n - 1)) * Math.PI * (cin ? 1.44 : 1.36);
      const lat = cin ? 0.18 + h2 * 0.55 : 0.24 + h2 * 0.45;
      const ux = Math.cos(lon) * Math.cos(lat), uz = Math.sin(lon) * Math.cos(lat), uy = Math.sin(lat);
      const root = on(ux, uy, uz, 0.96);
      const len = 17 * (0.8 + h1 * 0.3);
      const pts = [];
      const nr = L ? 3 : cin ? 6 : 5;
      const wob = cin ? Math.sin(i * 2.3) * 0.5 : Math.sin(i * 2.3) * 0.25;
      const w = L ? 1 : cin ? 0.55 : 0.62;
      for (let j = 0; j <= nr; j++) {
        const t = j / nr, sag = t * t;
        pts.push({ c: [root[0] + ux * 0.22 * t * hk - sag * 1.2, root[1] - len * sag - t * 0.6, root[2] + uz * 0.2 * t * hk + sag * uz * 0.6 + wob * Math.sin(t * 3.1 + i)],
          rx: (cin ? 0.12 - t * 0.06 : L ? 0.42 - t * 0.16 : 0.16 - t * 0.07) * hk, rz: (1.15 - t * 0.55) * w * (0.8 + h1 * 0.4) * hk, bone: t < 0.3 ? B.HEAD : t < 0.7 ? bw(B.HEAD, B.CHEST, 0.5) : B.CHEST });
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

function face(sb, P, L, has, headDef, cin = false) {
  if (L > 0) return;
  const c = P.headC, r = P.headR;
  const at = (x, y, z, inset = 1) => {
    const l = Math.hypot(x, y, z);
    const p = { x: x / l, y: y / l, z: z / l };
    headDef(p);
    return [c[0] + p.x * r[0] * inset, c[1] + p.y * r[1] * inset, c[2] + p.z * r[2] * inset];
  };
  // (laid out on a 3.45-wide skull: sizes scale with the type's head)
  const fk = r[2] / 3.45;
  if (has('nose')) {
    // a nose over the skull's rotted cavity: a narrow bridge between the sockets, a tip and wings
    const g = grp(sb, 'nose', { bone: B.HEAD, slot: SLOT.SKIN, mat: MAT.SKIN, part: PART.HEAD, paint: 0.3 });
    const tip = at(0.97, -0.13, 0, 1.0), top = at(0.98, 0.08, 0, 1.0);
    const hs = r[1] / 3.85;
    g.ell([(tip[0] + top[0]) / 2 - 0.12 * hs, (tip[1] + top[1]) / 2 - 0.05 * hs, 0], [0.5 * hs, 0.72 * hs, 0.34 * hs], { segW: cin ? 14 : 10, segH: cin ? 10 : 7, color: '#dcd4d0', rot: [0, 0, -0.32],
      deform: (p) => {
        const t = (p.y + 1) / 2;                                   // 0 at the tip, 1 at the bridge
        const w = 0.45 + 0.55 * (1 - t) * (1 - t) + 0.15 * Math.exp(-((t - 0.15) ** 2) / 0.02);
        p.z *= w;
        if (p.x < 0) p.x *= 0.4;                                  // (the back is inside the face)
        p.x *= 0.75 + 0.35 * (1 - t);
      } });
    for (const s of [-1, 1]) g.ell([tip[0] - 0.22 * hs, tip[1] - 0.05 * hs, s * 0.26 * hs], [0.26 * hs, 0.2 * hs, 0.18 * hs], { segW: 7, segH: 5, color: '#d0c4c4' });
    for (const s of [-1, 1]) g.ell([tip[0] - 0.12 * hs, tip[1] - 0.22 * hs, s * 0.12 * hs], [0.12 * hs, 0.06 * hs, 0.09 * hs], { segW: 6, segH: 4, slot: SLOT.FIXED, mat: MAT.FLESH, color: '#140404' });
  }
  if (has('face_glasses')) {
    // glasses or sunglasses (the lens darkness is per instance), resting on the brow and
    // cheekbones in front of the sunken sockets
    const g = grp(sb, 'face_glasses', { bone: B.HEAD });
    for (const s of [-1, 1]) {
      const e = at(0.95, 0.13, s * 0.37, 1.0);
      e[0] = Math.max(e[0], c[0] + r[0] * 0.97);
      g.ell([e[0] - 0.05, e[1], e[2]], [0.1, 1.2 * fk, 1.36 * fk], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.METAL, color: '#101010' });
      g.ell([e[0] + 0.06, e[1], e[2]], [0.08, 1.0 * fk, 1.15 * fk], { segW: 8, segH: 5, slot: SLOT.FIXED, mat: MAT.GLASS, color: '#ffffff', part: PART.LENS });
      g.line([e[0] - 0.2, e[1] + 0.1, e[2] + s * 1.15 * fk], [c[0] - r[0] * 0.8, e[1] + 0.2, s * r[2] * 0.99], 0.11, 0.11, 2, { seg: 3, slot: SLOT.FIXED, mat: MAT.METAL, color: '#101010' });
    }
    const bridge = at(0.98, 0.15, 0, 1.0);
    bridge[0] = Math.max(bridge[0], c[0] + r[0] * 0.98);
    g.line([bridge[0], bridge[1], -0.8 * fk], [bridge[0], bridge[1], 0.8 * fk], 0.11, 0.11, 2, { seg: 3, slot: SLOT.FIXED, mat: MAT.METAL, color: '#101010' });
  }
  if (has('face_mask')) {
    const g = grp(sb, 'face_mask', { bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#a8d0e0' });
    const m = at(0.85, -0.3, 0, 1.06);
    g.ell([m[0] - 0.2, m[1], 0], [1.4 * fk, 1.9 * fk, r[2] * 0.86], { segW: 8, segH: 6, deform: (p) => { p.x = Math.abs(p.x) * 0.5 + (p.x > 0 ? 0.3 : 0); } });
    for (const s of [-1, 1]) g.line([m[0] - 0.6, m[1] + 0.5, s * r[2] * 0.85], [c[0] - 0.5, c[1] + 0.3, s * r[2] * 1.02], 0.12, 0.12, 2, { seg: 3, color: '#e0e8ec' });
  }
  if (has('face_gasmask')) {
    const g = grp(sb, 'face_gasmask', { bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#26282a' });
    g.ell([c[0] + r[0] * 0.35, c[1] - 0.6 * fk, 0], [r[0] * 0.78, r[1] * 0.8, r[2] * 1.07], { segW: 10, segH: 7, deform: (p) => { if (p.x < -0.1) p.x = -0.1 + (p.x + 0.1) * 0.3; } });
    for (const s of [-1, 1]) g.ell([c[0] + r[0] * 1.02, c[1] + 0.7 * fk, s * 1.5 * fk], [0.3, 1.0 * fk, 1.05 * fk], { segW: 7, segH: 4, mat: MAT.GLASS, color: '#0a1418' });
    g.line([c[0] + r[0] * 1.0, c[1] - 2.2 * fk, 0.9 * fk], [c[0] + r[0] * 1.45, c[1] - 2.5 * fk, 1.4 * fk], 1.0 * fk, 1.0 * fk, 2, { seg: 7, mat: MAT.METAL, color: '#6a6a60' });
  }
  if (has('face_beard')) {
    grp(sb, 'face_beard', { bone: B.JAW }).ell([c[0] + r[0] * 0.42, c[1] - r[1] * 0.76, 0], [r[0] * 0.62, r[1] * 0.42, r[2] * 0.9], {
      segW: 9, segH: 6, slot: SLOT.HAIR, mat: MAT.HAIR, color: '#ffffff', deform: (p) => { if (p.y > 0.25) p.y = 0.25 + (p.y - 0.25) * 0.4; if (p.x < -0.2) p.x *= 0.4; } });
  }
  if (has('face_eyepatch')) {
    const g = grp(sb, 'face_eyepatch', { bone: B.HEAD, slot: SLOT.FIXED, mat: MAT.LEATHER, color: BLACK });
    const e = at(0.95, 0.13, -0.37, 1.0);
    e[0] = Math.max(e[0], c[0] + r[0] * 0.97);
    g.ell([e[0], e[1], e[2]], [0.2, 0.95 * fk, 1.0 * fk], { segW: 7, segH: 4 });
    g.line([e[0] - 0.3, e[1] + 0.9, e[2] + 0.3], [c[0] - 0.5, c[1] + 1.6, 1.8], 0.12, 0.12, 3, { seg: 3 });
  }
}

// ---------------------------------------------------------------------------------------
// neck, chest, torso, back

/** A point a hair off the top's shell (face +1 its front, -1 its back). */
function onTop(P, y, z, off, face = 1) {
  return [P.shellX ? P.shellX(y, z, face) + face * off : face * (5.3 * (P.fitD ?? P.depth) + off), y, z];
}

/**
 * A strap or cord lying on the top at side offset z: up the front from yFront, over the
 * shoulder's crest, down the back to yBack (null: it ends at the crest) — a hair off the
 * cloth all the way, so none of it cuts through the shirt.
 */
function strapOn(P, z, yFront, yBack, off, n = 6) {
  const yc = P.crestY ? P.crestY(z) : P.sY + 1;
  const pts = [];
  for (let k = 0; k < n; k++) { const t = 1 - (1 - k / n) ** 2; pts.push(onTop(P, yFront + (yc - yFront) * t, z, off)); }
  const f = onTop(P, yc, z, 0, 1), b = onTop(P, yc, z, 0, -1);
  pts.push([(f[0] + b[0]) / 2, yc + off + 0.1, z]);
  if (yBack !== null) for (let k = n - 1; k >= 0; k--) { const t = 1 - (1 - k / n) ** 2; pts.push(onTop(P, yBack + (yc - yBack) * t, z, off, -1)); }
  return pts;
}

/**
 * A bag's strap worn across the body: from the hip on the far side (z1) up the back, over the
 * shoulder on side s, and down across the chest back to the hip (y1), on the cloth throughout.
 */
function sash(P, s, z1, y1, off = 0.15, n = 7) {
  const z0 = s * 3.3, yc = P.crestY ? P.crestY(z0) : P.sY + 1;
  const run = (face) => {
    const pts = [];
    for (let k = 1; k <= n; k++) { const t = k / n; const y = yc + (y1 - yc) * t, z = z0 + (z1 - z0) * t; pts.push(onTop(P, y, z, off + 0.1 * t, face)); }
    return pts;
  };
  const f = onTop(P, yc, z0, 0, 1), b = onTop(P, yc, z0, 0, -1);
  return [...run(-1).reverse(), [(f[0] + b[0]) / 2, yc + off + 0.1, z0], ...run(1)];
}

function torsoGear(sb, P, L, has) {
  const D = P.fitD ?? P.depth, K = P.fitK ?? P.bulk;
  // the top's surface: in front (x) and at the side (z) at a height (model: actor-zmodels shellFront / shellSide)
  const fx = 5.3 * D;
  const F = P.frontX || (() => fx);
  const Z = P.sideZ || (() => 7.4 * K);
  const S = { bone: B.CHEST };
  if (L > 0) return;
  const strap = (z, yFront, yBack, off, n) => strapOn(P, z, yFront, yBack, off, n);
  if (has('tie')) {
    const g = grp(sb, 'tie', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    const y = [P.sY + 0.3, P.chest + 5, P.chest + 2.2, P.chest - 1.6, P.chest - 3.4];
    g.tube([{ c: [F(y[0]) + 0.3, y[0], 0], rx: 0.45, rz: 0.62 }, { c: [F(y[1]) + 0.28, y[1], 0], rx: 0.28, rz: 0.5 }, { c: [F(y[2]) + 0.32, y[2], 0], rx: 0.28, rz: 0.9 }, { c: [F(y[3]) + 0.3, y[3], 0], rx: 0.26, rz: 1.05 }, { c: [F(y[4]) + 0.22, y[4], 0], rx: 0.22, rz: 0.35 }],
      { seg: 4, color: '#ffffff', ref: [1, 0, 0] });
    g.ell([F(P.sY - 0.1) + 0.35, P.sY - 0.1, 0], [0.55, 0.65, 0.8], { segW: 5, segH: 4, color: '#e8e8e8' });
  }
  if (has('lanyard')) {
    const g = grp(sb, 'lanyard', { ...S });
    for (const s of [-1, 1]) g.tube([[F(P.chest + 4.4) + 0.15, P.chest + 4.4, s * 0.2], ...strap(s * 2.0, P.sY - 1.5, P.sY + 0.5, 0.12)].map((c) => ({ c, r: 0.14 })), { seg: 3, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#ffffff' });
    g.box([F(P.chest + 2.6) + 0.25, P.chest + 2.6, 0.4], [0.24, 2.9, 2.0], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#e8e8e4' });
    g.box([F(P.chest + 3.1) + 0.4, P.chest + 3.1, 0.4], [0.1, 1.05, 1.05], { seg: 4, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#8a7a68' });
  }
  if (has('stetho')) {
    const g = grp(sb, 'stetho', { ...S, slot: SLOT.FIXED, mat: MAT.RUBBER, color: '#1c1c1c' });
    // draped round the neck: one end on the chest, the other hanging lower on the far side
    const right = strap(2.3, P.chest + 3.6, null, 0.14), left = strap(-2.3, P.chest + 0.5, null, 0.14);
    const nape = [P.shellX ? P.shellX(P.neck, 0, -1) - 0.2 : -2, P.neck + 0.3, 0];
    const pts = [...right, nape, ...left.reverse()].map((c) => ({ c, r: 0.2 }));
    g.tube(pts, { seg: 4 });
    g.ell([F(P.chest + 3.2) + 0.3, P.chest + 3.2, 2.2], [0.28, 0.8, 0.8], { segW: 6, segH: 4, mat: MAT.METAL, color: '#b0b0b0' });
  }
  if (has('scarf')) {
    const g = grp(sb, 'scarf', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    g.tube([{ c: [0.3, P.neck - 0.4, 0], rx: 2.7, rz: 3.0, bone: bw(B.CHEST, B.NECK, 0.5) }, { c: [0.3, P.neck + 1.6, 0], rx: 2.3, rz: 2.6, bone: bw(B.CHEST, B.NECK, 0.5) }], { seg: 10, color: '#ffffff' });
    g.tube([{ c: [F(P.neck - 0.4) + 0.4, P.neck - 0.4, 1.0], rx: 0.5, rz: 1.2 }, { c: [F(P.chest + 6) + 0.3, P.chest + 6, 1.2], rx: 0.45, rz: 1.3 }, { c: [F(P.chest + 1) + 0.3, P.chest + 1, 1.4], rx: 0.4, rz: 1.3 }], { seg: 5, color: '#e8e8e8' });
  }
  if (has('camera')) {
    const g = grp(sb, 'camera', { ...S, slot: SLOT.FIXED });
    const yc = P.chest + 0.4;
    for (const s of [-1, 1]) g.tube([[F(yc) + 0.4, yc + 1.0, s * 1.4], ...strap(s * 2.0, P.chest + 2.2, P.sY + 0.5, 0.12)].map((c) => ({ c, r: 0.15 })), { seg: 3, mat: MAT.LEATHER, color: BLACK });
    g.box([F(yc) + 1.0, yc, 0], [1.8, 2.2, 3.3], { seg: 6, round: 0.3, mat: MAT.METAL, color: '#2a2a2c' });
    g.line([F(yc) + 1.85, yc - 0.1, 0], [F(yc) + 3.1, yc - 0.1, 0], 0.8, 0.7, 2, { seg: 7, mat: MAT.METAL, color: '#181818' });
  }
  if (has('dogtags')) {
    const g = grp(sb, 'dogtags', { ...S, slot: SLOT.FIXED, mat: MAT.METAL, color: '#9a9a96' });
    for (const s of [-1, 1]) g.tube([[F(P.chest + 4) + 0.15, P.chest + 4.0, s * 0.15], ...strap(s * 1.8, P.sY - 1.5, P.sY + 0.5, 0.1)].map((c) => ({ c, r: 0.1 })), { seg: 3 });
    g.box([F(P.chest + 3.2) + 0.2, P.chest + 3.2, 0.3], [0.12, 1.4, 0.9], { seg: 4, round: 0.3 });
  }
  if (has('badge')) {
    grp(sb, 'badge', { ...S, slot: SLOT.FIXED, mat: MAT.METAL, color: '#c8b050' }).ell([F(P.chest + 3.6) - 0.15, P.chest + 3.6, 2.4], [0.2, 1.05, 0.95], { segW: 8, segH: 5, deform: (p) => { const a = Math.atan2(p.z, p.y); const k = 0.75 + 0.25 * Math.abs(Math.cos(a * 2.5)); p.y *= k; p.z *= k; } });
  }
  if (has('vest_plate')) {
    const g = grp(sb, 'vest_plate', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    const ring = (y, x) => ({ c: [x, y, 0], rx: F(y) - x + 0.45, rz: Z(y) + 0.4 });
    g.tube([ring(P.waist + 1.8, 0.0), ring(P.chest + 1.2, 0.1), ring(P.sY - 1.4, 0.0)], { seg: 12, cap0: 'flat', cap1: 'flat', color: '#ffffff' });
    for (let k = -1; k <= 1; k++) g.box([F(P.waist + 4.2) + 1.1, P.waist + 4.2, k * 2.3], [1.4, 3.2, 1.9], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#3a3f32' });
    g.box([F(P.chest + 3.0) + 0.85, P.chest + 3.0, 0], [1.1, 6.0, 6.0], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#4a4f3c' });
  }
  const back = P.backX || ((y) => -F(y) * 0.95);
  if (has('suspenders')) {
    // (in the gear colour: a farmer's red or tan braces, the denim straps of bib overalls)
    const g = grp(sb, 'suspenders', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#e0e0e0' });
    for (const s of [-1, 1]) g.tube(strap(s * 3.4, P.waist + 0.6, P.waist + 0.6, 0.18).map((c) => ({ c, rx: 0.16, rz: 0.6 })), { seg: 4, ref: [1, 0, 0] });
  }
  if (has('apron')) {
    const g = grp(sb, 'apron', { ...S, slot: SLOT.GEAR, mat: MAT.CLOTH });
    const fh = P.frontX ? F(P.hip - 1) : fx;
    g.tube([{ c: [F(P.sY - 1.2) + 0.35, P.sY - 1.2, 0], rx: 0.3, rz: 2.8 }, { c: [F(P.chest) + 0.4, P.chest, 0], rx: 0.3, rz: Z(P.chest) * 0.85 }, { c: [Math.max(F(P.waist - 4.5), fh) + 0.55, P.waist - 4.5, 0], rx: 0.35, rz: Z(P.waist - 4.5) * 0.95, bone: bw(B.SPINE, B.HIPS, 0.6) }, { c: [fh + 1.2, P.knee + 4, 0], rx: 0.35, rz: Z(P.hip - 2) * 1.05, bone: B.HIPS }], { seg: 8, color: '#ffffff', ref: [1, 0, 0], cap0: 'flat', cap1: 'flat' });
    for (const s of [-1, 1]) g.tube(strap(s * 2.4, P.sY - 1.2, P.sY + 0.4, 0.12).map((c) => ({ c, r: 0.18 })), { seg: 3, color: '#f0f0f0' });
  }
  // belts sit on the trousers' waistband (actor-zmodels: rx 3.4 · depth, rz 5.1 · bulk)
  const bx = P.fitD ? 3.52 * P.depth : 4.6 * D + 0.5, bz = P.fitD ? 5.22 * P.bulk : 6.2 * K + 0.5;
  const belt = (opt, color) => grp(sb, opt, { bone: B.SPINE, slot: SLOT.FIXED, mat: MAT.LEATHER, color });
  const beltTube = (g, color) => g.tube([{ c: [0.3, P.waist - 1.8, 0], rx: bx, rz: bz }, { c: [0.3, P.waist + 0.4, 0], rx: bx, rz: bz }], { seg: 12, color });
  if (has('belt_duty')) {
    const g = belt('belt_duty', '#181818');
    beltTube(g, '#181818');
    g.box([1.0, P.waist - 3.4, bz + 0.6], [2.2, 4.0, 1.5], { seg: 5, round: 0.3 });
    g.box([bx * 0.6, P.waist - 1.1, -bz * 0.72], [1.3, 2.2, 1.5], { seg: 5, round: 0.3 });
    g.box([-bx * 0.6, P.waist - 1.0, -bz * 0.95], [1.3, 3.2, 1.4], { seg: 5, round: 0.3, color: '#26282a' });
    g.box([bx + 0.3, P.waist - 0.7, 0], [0.5, 1.4, 1.4], { seg: 4, round: 0.4, mat: MAT.METAL, color: '#8a8a86' });
  }
  if (has('belt_tool')) {
    const g = belt('belt_tool', '#4a3a26');
    beltTube(g, '#4a3a26');
    g.box([bx * 0.72, P.waist - 3.4, bz * 0.72], [2.4, 3.8, 2.0], { seg: 5, round: 0.3 });
    g.box([bx * 0.66, P.waist - 3.0, -bz * 0.72], [2.2, 3.0, 1.9], { seg: 5, round: 0.3, color: '#3a2a1a' });
    g.line([bx * 0.4, P.waist - 3, bz + 0.5], [bx * 0.4, P.waist - 10.5, bz + 0.7], 0.3, 0.3, 2, { seg: 4, mat: MAT.METAL, color: '#7a7a78' });
    g.box([bx * 0.4, P.waist - 11.2, bz + 0.7], [1.0, 1.4, 2.8], { seg: 5, round: 0.3, mat: MAT.METAL, color: '#5a5a58' });
  }
  if (has('fanny')) {
    const g = belt('fanny', '#2a2a2c');
    beltTube(g, '#1c1c1c');
    g.box([bx + 0.9, P.waist - 1.6, 1.0], [2.0, 3.2, 5.2], { seg: 6, round: 0.3, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#ffffff' });
  }
}

function backGear(sb, P, L, has) {
  if (L > 0) {
    // mid range: the big shapes only
    if (!(has('pack_small') || has('pack_big'))) return;
  }
  const D = P.fitD ?? P.depth, K = P.fitK ?? P.bulk;
  const back = P.backX || ((y) => -4.6 * D);
  const F = P.frontX || ((y) => 4.7 * D);
  const xb = back(P.chest + 1.5);
  const hz = P.fitD ? 5.55 * P.bulk : 6.9 * K;      // the trousers' side at the hip
  const S = { bone: B.CHEST, slot: SLOT.GEAR, mat: MAT.CLOTH, color: '#ffffff' };
  const straps = (g, yTop) => {
    if (L > 0) return;
    for (const s of [-1, 1]) g.tube([[xb - 0.4, yTop, s * 3.0], ...strapOn(P, s * 3.3, P.chest - 2, null, 0.2).reverse()].map((c) => ({ c, rx: 0.2, rz: 0.8 })), { seg: 4, slot: SLOT.FIXED, color: STRAP, mat: MAT.CLOTH, bone: B.CHEST, ref: [1, 0, 0] });
  };
  if (has('pack_small')) {
    const g = grp(sb, 'pack_small', S);
    g.box([xb - 2.2, P.chest + 1.4, 0], [4.4, 9.5, 8.0 * K], { seg: 7, round: 0.4 });
    if (L === 0) g.box([xb - 4.2, P.chest - 0.5, 0], [1.3, 4.4, 6.0 * K], { seg: 5, round: 0.3, color: '#d8d8d8' });
    straps(g, P.sY - 1);
  }
  if (has('pack_big')) {
    const g = grp(sb, 'pack_big', S);
    g.box([xb - 3.0, P.chest + 1.4, 0], [6.0, 12.5, 9.2 * K], { seg: 7, round: 0.4 });
    g.box([xb - 2.8, P.chest + 8.5, 0], [6.6, 3.1, 9.4 * K], { seg: 6, round: 0.4, color: '#d0d0d0' });
    if (L === 0) {
      for (const s of [-1, 1]) g.box([xb - 2.9, P.chest - 1.2, s * 5.3 * K], [3.4, 5.8, 2.5], { seg: 5, round: 0.4, color: '#d8d8d8' });
      g.line([xb - 5.3, P.chest - 5.6, -5.2 * K], [xb - 5.3, P.chest - 5.6, 5.2 * K], 1.7, 1.7, 2, { seg: 6, cap0: 'round', cap1: 'round', capRings: 1, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#6a6a4a' });
    }
    straps(g, P.sY - 1);
  }
  if (L > 0) return;
  if (has('bag_msg')) {
    const g = grp(sb, 'bag_msg', { ...S, bone: B.HIPS });
    g.box([-2.6 * D, P.hip - 1.6, hz + 1.3], [5.8, 5.0, 2.4], { seg: 6, round: 0.3 });
    g.tube(sash(P, -1, hz, P.waist - 0.5).map((c) => ({ c, rx: 0.16, rz: 0.8 })), { seg: 4, bone: B.CHEST, slot: SLOT.FIXED, color: STRAP, ref: [1, 0, 0] });
  }
  if (has('tank_o2')) {
    const g = grp(sb, 'tank_o2', { ...S, mat: MAT.METAL });
    for (const s of [-1, 1]) g.line([xb - 2.1, P.chest - 3.5, s * 2.1 * K], [xb - 2.1, P.chest + 8.5, s * 2.1 * K], 1.5, 1.5, 2, { seg: 8, cap0: 'round', cap1: 'round', capRings: 1, color: '#ffffff' });
    g.box([xb - 0.8, P.chest + 2, 0], [1.1, 11.5, 7.5], { seg: 5, round: 0.3, slot: SLOT.FIXED, mat: MAT.LEATHER, color: '#26262a' });
    straps(g, P.sY - 1);
  }
  if (has('bag_medic')) {
    const g = grp(sb, 'bag_medic', { ...S, bone: B.HIPS });
    g.box([1.0, P.hip - 5.0, hz + 1.4], [7.0, 5.2, 2.8], { seg: 6, round: 0.3 });
    g.box([1.0, P.hip - 5.0, hz + 2.85], [1.8, 0.55, 0.2], { seg: 4, round: 0.2, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828' });
    g.box([1.0, P.hip - 5.0, hz + 2.85], [0.55, 1.8, 0.2], { seg: 4, round: 0.2, slot: SLOT.FIXED, mat: MAT.CLOTH, color: '#c62828' });
    g.tube(sash(P, 1, -hz, P.waist - 0.5).map((c) => ({ c, rx: 0.16, rz: 0.8 })), { seg: 4, bone: B.CHEST, slot: SLOT.FIXED, color: STRAP, ref: [1, 0, 0] });
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
      g.tube([{ c: [0.2, wr + 1.6, z], rx: P.armR * 0.6 + 0.55, rz: P.armR * 0.66 + 0.5 }, { c: [0.2, wr + 0.6, z], rx: P.armR * 0.58 + 0.6, rz: P.armR * 0.66 + 0.55 }], { seg: 8, cap0: 'flat', cap1: 'flat' });
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
      g.box([0.2, P.hip - 7, P.legGap + P.thighR + 1.1], [2.0, 7.0, 1.8], { seg: 5, round: 0.3 });
    }
    if (has('stump_hand_l') && !R) stump(sb, 'stump_hand_l', [0.2, wr + 0.8, z], FA, 1.5, 0.35);
    if (has('stump_hand_r') && R) stump(sb, 'stump_hand_r', [0.2, wr + 0.8, z], FA, 1.5, 0.35);
    if (has('stump_l') && !R) stump(sb, 'stump_l', [-0.3, el - 0.2, z], UA, 1.9, 0.55);
    if (has('stump_r') && R) stump(sb, 'stump_r', [-0.3, el - 0.2, z], UA, 1.9, 0.55);
  }
  if (has('skirt')) {
    const g = grp(sb, 'skirt', { bone: B.HIPS, slot: SLOT.CLOTH2, mat: MAT.CLOTH, part: PART.PELVIS });
    g.tube([{ c: [0.3, P.waist + 0.4, 0], rx: 3.6 * P.depth, rz: 5.3 * P.bulk }, { c: [0.2, P.hip - 1.5, 0], rx: 4.2 * P.depth, rz: 6.0 * P.bulk }, { c: [0.1, P.hip - 6, 0], rx: 5.2 * P.depth, rz: 7.1 * P.bulk }], { seg: 12, color: '#ffffff' });
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
  const D = P.fitD ?? P.depth, K = P.fitK ?? P.bulk;
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
  const D = P.fitD ?? P.depth, K = P.fitK ?? P.bulk;
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
  face(sb, P, L, has, headDef, cin);
  torsoGear(sb, P, L, has);
  backGear(sb, P, L, has);
  limbGear(sb, P, L, has);
  gore(sb, P, L, has);
  armour(sb, P, L, has);
}
