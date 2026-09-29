// The Campaign's static world (SPEC §3.8 / §7.5): the hill's fortifications (palisades, the
// ruined watchtower), the tall office tower with its glowing crown, the office floors inside
// it (walls, desks, cabinets, counters, columns, the stairs, ceilings with light panels, doors,
// windows full of daylight), the rooftop (parapet, plant, helipad, antenna, the zip-line gantry
// and cable), the landing pad, and the distant skyline. Everything is written through the
// world-geo.js accumulator like the rest of the static world (world.js dispatches here by
// obstacle kind and calls buildRidgeWorld once), except the skyline (one merged mesh with a
// tiled window texture) and a few painted signs (small canvas-textured meshes).
//
// Kinds and their canonical heights live in shared/maps-campaign.js CAMPAIGN_HEIGHT; the
// floors' ceilings are at `floor.base + floor.ceil`, and the interior walls and columns are
// built to their obstacle's `top` (the ceiling height of their floor).

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { beam } from './world-bld.js';
import { CAMPAIGN_HEIGHT, PLATEAU_EDGE } from '../shared/maps-campaign.js';

const STEEL = [DET.rust, 0.45, 0.85];
const WOOD = { surf: [DET.wood, 0.85, 0] };

/** World (x, y) of a point in an obstacle's local frame (local x along w, local z along h). */
function wpos(o, lx, lz) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
}

/** Canonical height of a campaign kind (an explicit obstacle `top` wins for walls, columns, masts, the tower). */
export function ridgeHeight(kind, o) {
  if (o && Number.isFinite(o.top) && (kind === 'iwall' || kind === 'ipillar' || kind === 'stairs' || kind === 'mast' || kind === 'tower')) return o.top;
  return CAMPAIGN_HEIGHT[kind] ?? 40;
}

// ---- hill ---------------------------------------------------------------------------------------

/** Timber stake wall: sharpened logs lashed to two rails, a few broken off. */
export function palisade(B, L, W) {
  const r = B.rng;
  const n = Math.max(3, Math.round(L / 9.5));
  const step = L / n;
  const bark = ['#6b4a2c', '#5e4126', '#74532f', '#4f3a24', '#7a5c38'];
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * step;
    const broken = r.chance(0.08);
    const h = broken ? r.range(28, 46) : r.range(64, 78);
    const c = r.pick(bark);
    B.cyl('std', x, 0, r.range(-1.2, 1.2), step * 0.54, h, c, 7, broken ? 0.7 : 0.22, [0, 0, r.range(-0.03, 0.03)], { surf: [DET.bark, 0.92, 0], wobble: { amp: 0.06, seed: i } });
  }
  for (const y of [22, 50]) {
    B.box('std', 0, y, W * 0.5 + 1.4, L, 4.2, 3, '#5a4126', [r.range(-0.01, 0.01), 0, 0], WOOD);
    B.box('std', 0, y + 1, -W * 0.5 - 1.4, L, 4.2, 3, '#5a4126', null, WOOD);
  }
  // rope lashings and a crooked banner rag
  for (const y of [22, 50]) B.box('std', 0, y, W * 0.5 + 3, L, 1.4, 1, '#c8b27a', null, { surf: [DET.fabric, 0.95, 0] });
  if (r.chance(0.5)) B.add('std', T.plane(), [r.range(-L * 0.3, L * 0.3), 60, W * 0.5 + 3.4], [12, 16, 1], [0, 0, r.range(-0.2, 0.2)], r.pick(['#8a1c1c', '#c8c0a8', '#1c3a8a']), { surf: [DET.fabric, 0.95, 0] });
}

/** The ruined lookout: four legs, a platform with a railing and a half roof, a ladder, a searchlight. */
export function watchtower(B, o, halos) {
  const r = B.rng;
  const S = 84;
  const legX = 32;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    B.cyl('std', sx * legX, 0, sz * legX, 5.2, 156, '#5b4a36', 8, 0.85, [sx * 0.05, 0, -sz * 0.05], { surf: [DET.wood, 0.9, 0], wobble: { amp: 0.04, seed: sx * 3 + sz } });
  }
  // X bracing on the four faces
  for (const y0 of [8, 78]) {
    for (const s of [-1, 1]) {
      beam(B, 'std', -legX, y0, s * legX, legX, y0 + 62, s * legX, 1.8, '#4b3c2a', [DET.wood, 0.9, 0]);
      beam(B, 'std', legX, y0, s * legX, -legX, y0 + 62, s * legX, 1.8, '#4b3c2a', [DET.wood, 0.9, 0]);
      beam(B, 'std', s * legX, y0, -legX, s * legX, y0 + 62, legX, 1.8, '#4b3c2a', [DET.wood, 0.9, 0]);
    }
  }
  // platform
  B.block('std', 0, 154, 0, S, 5, S, '#6b5638', null, WOOD);
  for (let x = -S / 2 + 6; x < S / 2; x += 12) B.box('std', x, 159.4, 0, 0.8, 0.6, S - 2, '#3b2d1e', null, WOOD);
  // railing with a gap, sandbags along it
  for (const s of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      B.block('std', k * 12, 159, s * (S / 2 - 3), 2.4, 30, 2.4, '#5b4a36', null, WOOD);
      B.block('std', s * (S / 2 - 3), 159, k * 12, 2.4, 30, 2.4, '#5b4a36', null, WOOD);
    }
    B.box('std', 0, 187, s * (S / 2 - 3), S, 2.4, 2.4, '#4b3c2a', null, WOOD);
    if (s > 0) B.box('std', s * (S / 2 - 3), 187, -14, 2.4, 2.4, S - 28, '#4b3c2a', null, WOOD);
  }
  B.add('std', T.pillow(10, 6, 0.4), [-18, 165, S / 2 - 8], [16, 6, 8], [0, 0.1, 0], '#8a7a55', { surf: [DET.fabric, 0.92, 0] });
  B.add('std', T.pillow(10, 6, 0.4), [4, 165, S / 2 - 8], [16, 6, 8], [0, -0.1, 0], '#7d6f4c', { surf: [DET.fabric, 0.92, 0] });
  // half a roof: corrugated iron on two posts, torn open on the far side
  for (const [x, z] of [[-legX + 6, -legX + 6], [legX - 6, -legX + 6]]) B.cyl('std', x, 159, z, 2.2, 66, '#5b4a36', 6, 1, null, { surf: [DET.wood, 0.9, 0] });
  B.add('std', T.profile('wtroof', [[-52, 0], [52, 0], [0, 26]], 0.8, 40), [0, 224, -22], [1, 1, 1], [0, Math.PI / 2, 0.06], '#8d8a7d', { surf: [DET.corrugated, 0.5, 0.6] });
  // ladder on the front
  for (let y = 10; y < 150; y += 12) B.box('std', 0, y, legX + 5, 16, 1.6, 1.6, '#4b3c2a', null, WOOD);
  for (const s of [-1, 1]) B.block('std', s * 8, 0, legX + 5, 1.8, 154, 1.8, '#4b3c2a', null, WOOD);
  // searchlight on a post
  B.cyl('std', -28, 159, -30, 1.8, 26, '#3a3c3e', 6, 1, null, { surf: STEEL });
  B.rbox('std', -28, 190, -30, 12, 9, 12, 1.2, '#2a2c2e', [0.3, 0.6, 0], { surf: STEEL });
  B.box('glow', -28 + 5, 190, -30 + 4, 8, 5.5, 0.6, '#fff4d8', [0.3, 0.6, 0], { emissive: 4, uv: atlasUV('white') });
  if (halos) {
    const [hx, hy] = wpos(o, -28, -30);
    halos.push({ x: hx, y: hy, h: 190, color: '#fff0d0', size: 120, strength: 0.7 });
  }
  // fallen planks and a barrel at the foot
  for (let i = 0; i < 5; i++) B.block('std', r.range(-40, 40), 0, r.range(-46, -30), r.range(14, 30), 2, 5, '#5b4a36', [0, r.range(-0.6, 0.6), 0], WOOD);
  B.cyl('std', 44, 0, -38, 8, 22, '#4a3424', 10, 1, null, { surf: [DET.rust, 0.8, 0.6] });
}

// ---- the tower ----------------------------------------------------------------------------------

const GLASS_C = '#243444';
const CURTAIN = '#5d6b7a';

/**
 * The tall office tower: L = depth (the door is on the +x face), W = width. A lit lobby with
 * a canopy, a glass curtain-wall shaft with spandrels and mullions and a scatter of lit
 * windows, a setback, a crown with a helipad ring, an antenna and an aircraft beacon.
 */
export function skyscraper(B, o, L, W, halos) {
  const r = B.rng;
  const H = ridgeHeight('tower', o);
  const hl = L / 2, hw = W / 2;
  const S = [DET.concrete, 0.86, 0];
  // plinth, podium and lobby glass
  B.rblock('std', 0, 0, 0, L + 16, 10, W + 16, 2, '#8b8880', null, { surf: S });
  B.block('std', 0, 10, 0, L, 44, W, '#6f7780', null, { surf: [DET.panel, 0.45, 0.4] });
  // lobby glazing on all four faces, lit from inside
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < 8; i++) {
      const t = -hw + 22 + (i * (W - 44)) / 7;
      B.add('glass', T.plane(), [s * (hl + 0.3), 32, t], [26, 36, 1], [0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0], GLASS_C, { surf: [0, -1, -1] });
      if (i !== 3 && i !== 4 || s < 0) B.add('glow', T.plane(), [s * (hl + 0.1), 32, t], [24, 34, 1], [0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0], '#ffe9c4', { emissive: 0.55, uv: atlasUV('winOffice') });
    }
    for (let i = 0; i < 6; i++) {
      const t = -hl + 22 + (i * (L - 44)) / 5;
      B.add('glass', T.plane(), [t, 32, s * (hw + 0.3)], [30, 36, 1], [0, s > 0 ? 0 : Math.PI, 0], GLASS_C, { surf: [0, -1, -1] });
      B.add('glow', T.plane(), [t, 32, s * (hw + 0.1)], [28, 34, 1], [0, s > 0 ? 0 : Math.PI, 0], '#ffe9c4', { emissive: 0.45, uv: atlasUV('winOffice') });
    }
  }
  // the front door: a glass revolving door, a canopy, warm underlights, planters
  B.block('std', hl + 0.4, 10, 0, 1.4, 38, 60, '#20262c', null, { surf: [DET.panel, 0.4, 0.6] });
  B.add('glow', T.plane(), [hl + 1.2, 30, 0], [56, 34, 1], [0, Math.PI / 2, 0], '#fff0d6', { emissive: 1.5, uv: atlasUV('shop') });
  B.rblock('std', hl + 28, 56, 0, 64, 5, 132, 1.4, '#ccd0d4', null, { surf: [DET.panel, 0.4, 0.5] });
  for (const z of [-58, 58]) B.cyl('std', hl + 54, 10, z, 3.2, 46, '#b8bcc0', 10, 1, null, { surf: [0, 0.25, 0.9] });
  for (let i = 0; i < 6; i++) B.box('glow', hl + 30, 55.2, -50 + i * 20, 14, 0.8, 5, '#fff6e0', null, { emissive: 3.6, uv: atlasUV('tube') });
  for (const z of [-92, 92]) {
    B.rblock('std', hl + 40, 10, z, 24, 16, 24, 2, '#5c574f', null, { surf: S });
    B.add('std', T.sphere(8, 6), [hl + 40, 32, z], [11, 9, 11], null, '#3f5a2c', { surf: [DET.grass, 0.9, 0] });
  }
  // steps
  for (let k = 0; k < 3; k++) B.rblock('std', hl + 8 + k * 9, 0, 0, 30 - k * 4, 4 + (2 - k) * 3, 150, 0.8, '#9a978e', null, { surf: S });

  // the shaft: floor bands (dark glass) between spandrels, mullions, corner columns
  const y0 = 54, yTop = 318, band = 22;
  const shaft = (top, inset, colr) => {
    const iw = W - inset * 2, il = L - inset * 2;
    B.block('std', 0, y0, 0, il, top - y0, iw, colr, null, { surf: [DET.panel, 0.5, 0.35] });
  };
  shaft(yTop, 0, CURTAIN);
  const faces = [
    { len: W, off: hl, rot: Math.PI / 2, ax: 'x', sgn: 1 }, { len: W, off: hl, rot: -Math.PI / 2, ax: 'x', sgn: -1 },
    { len: L, off: hw, rot: 0, ax: 'z', sgn: 1 }, { len: L, off: hw, rot: Math.PI, ax: 'z', sgn: -1 },
  ];
  const bays = 9;
  for (const f of faces) {
    const bw = f.len / bays;
    for (let fl = 0, y = y0 + 4; y + band < yTop; fl++, y += band) {
      // spandrel band
      const place = (t, yy, dOut, sx, sy, sz) => {
        if (f.ax === 'x') B.add('std', T.box(), [f.sgn * (f.off + dOut), yy, t], [sz, sy, sx], null, CURTAIN, { surf: [DET.panel, 0.4, 0.5] });
        else B.add('std', T.box(), [t, yy, f.sgn * (f.off + dOut)], [sx, sy, sz], null, CURTAIN, { surf: [DET.panel, 0.4, 0.5] });
      };
      place(0, y + 2, 0.6, f.len, 4, 1.2);
      // glass strip (a plane per bay so the reflection breaks up)
      for (let b = 0; b < bays; b++) {
        const t = -f.len / 2 + (b + 0.5) * bw;
        const tone = hash01(fl * 31 + b * 7 + faces.indexOf(f) * 101);
        const lit = tone < 0.075;
        const px = f.ax === 'x' ? [f.sgn * (f.off + 0.7), y + 4 + (band - 4) / 2, t] : [t, y + 4 + (band - 4) / 2, f.sgn * (f.off + 0.7)];
        B.add(lit ? 'glow' : 'glass', T.plane(), px, [bw - 2.2, band - 6, 1], [0, f.rot, 0], lit ? '#ffffff' : shadeHex(GLASS_C, (tone - 0.5) * 0.24),
          lit ? { emissive: 0.8, uv: atlasUV(tone < 0.03 ? 'winCool' : 'winOffice') } : { surf: [0, -1, -1] });
      }
    }
    // mullions
    for (let b = 0; b <= bays; b++) {
      const t = -f.len / 2 + b * bw;
      if (f.ax === 'x') B.block('std', f.sgn * (f.off + 1), y0, t, 2.4, yTop - y0, 2.2, '#8a95a0', null, { surf: [DET.panel, 0.35, 0.7] });
      else B.block('std', t, y0, f.sgn * (f.off + 1), 2.2, yTop - y0, 2.4, '#8a95a0', null, { surf: [DET.panel, 0.35, 0.7] });
    }
  }
  // corner columns
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.rblock('std', sx * (hl + 1), y0, sz * (hw + 1), 7, yTop - y0, 7, 1.2, '#7e8790', null, { surf: [DET.concrete, 0.6, 0.2] });
  // mechanical floor + the setback + the upper glass block
  B.rblock('std', 0, yTop, 0, L + 6, 12, W + 6, 1.4, '#69737d', null, { surf: [DET.panel, 0.5, 0.4] });
  const ins = 24;
  B.block('std', 0, yTop + 12, 0, L - ins * 2, 76, W - ins * 2, '#56636f', null, { surf: [DET.panel, 0.5, 0.35] });
  for (const f of faces) {
    const len = f.len - ins * 2, off = f.off - ins;
    for (let b = 0; b < 6; b++) {
      const t = -len / 2 + ((b + 0.5) * len) / 6;
      const px = f.ax === 'x' ? [f.sgn * (off + 0.7), yTop + 50, t] : [t, yTop + 50, f.sgn * (off + 0.7)];
      B.add('glass', T.plane(), px, [len / 6 - 3, 58, 1], [0, f.rot, 0], GLASS_C, { surf: [0, -1, -1] });
    }
  }
  // crown: a plant deck, a helipad ring, the lift shaft housing, antenna and beacons
  const topY = yTop + 88;
  B.rblock('std', 0, topY, 0, L - ins * 2 + 8, 5, W - ins * 2 + 8, 1.2, '#4a545e', null, { surf: [DET.slab, 0.85, 0] });
  B.rblock('std', -hl * 0.3, topY + 5, hw * 0.3, 54, 30, 54, 1.4, '#59636d', null, { surf: [DET.panel, 0.5, 0.4] });
  B.rblock('std', hl * 0.2, topY + 5, -hw * 0.3, 36, 18, 44, 1.2, '#525c66', null, { surf: [DET.panel, 0.5, 0.4] });
  B.cyl('neon', 0, topY + 5.2, 0, 66, 0.6, '#ffb84a', 40, 1, null, { emissive: 2.4, uv: atlasUV('white') });
  B.cyl('std', 0, topY + 5, 0, 62, 0.5, '#2a3138', 40, 1, null, { surf: [DET.slab, 0.9, 0] });
  const mastX = -hl * 0.55, mastZ = -hw * 0.5;
  B.cyl('std', mastX, topY + 5, mastZ, 2.4, 120, '#9aa0a6', 8, 0.55, null, { surf: STEEL });
  for (const [x, y, z] of [[mastX, topY + 125, mastZ], [hl * 0.8, topY + 6, hw * 0.75], [-hl * 0.8, topY + 6, -hw * 0.75], [hl * 0.8, topY + 6, -hw * 0.75], [-hl * 0.8, topY + 6, hw * 0.75]]) {
    B.add('blink', T.sphere(6, 4), [x, y, z], [3.4, 3.4, 3.4], null, '#ff2a1a', { emissive: 3.6 });
  }
  // uplights washing the setback, and the corner sign strips
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    B.box('glow', sx * (hl - 6), yTop + 40, sz * (hw - 6), 2, 84, 2, '#9fd8ff', null, { emissive: 2.6, uv: atlasUV('white') });
  }
  if (halos) {
    const [mx, my] = wpos(o, mastX, mastZ), [dx, dy] = wpos(o, hl + 40, 0);
    halos.push({ x: mx, y: my, h: topY + 125, color: '#ff2a1a', size: 220, blink: 1, strength: 1.2 });
    halos.push({ x: o.x, y: o.y, h: topY + 8, color: '#ffb84a', size: 360, strength: 0.7 });
    halos.push({ x: dx, y: dy, h: 34, color: '#ffe9c4', size: 300, strength: 0.6 });
  }
}

// ---- interior ------------------------------------------------------------------------------------

const PLASTER = '#d6d0c2';

/** A wall: plaster over a wainscot, baseboard and cap; long walls (an arena's ring) carry daylight windows. */
export function iwall(B, o, L, W) {
  const H = ridgeHeight('iwall', o);
  const S = [DET.stucco, 0.9, 0];
  B.block('std', 0, 0, 0, L, H, W, PLASTER, null, { surf: S });
  B.block('std', 0, 0, 0, L + 0.6, 34, W + 1.2, '#7c766a', null, { surf: [DET.panel, 0.7, 0.1] });
  B.block('std', 0, 0, 0, L + 1, 5, W + 2.4, '#3a3630', null, { surf: [DET.panel, 0.6, 0.2] });
  B.block('std', 0, 34, 0, L + 0.4, 2.4, W + 1.6, '#8f887a', null, { surf: [DET.panel, 0.6, 0.2] });
  B.block('std', 0, H - 4, 0, L + 0.4, 4, W + 1.2, '#bdb6a8', null, { surf: S });
  if (L >= 500 && W >= 20) {
    // pilasters and daylight windows on both faces
    const n = Math.max(2, Math.round(L / 150));
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + ((i + 0.5) * L) / n;
      for (const s of [-1, 1]) {
        B.add('std', T.box(), [x, 82, s * (W / 2 + 0.7)], [96, 60, 1.4], null, '#3b3934', { surf: [DET.panel, 0.5, 0.5] });
        B.add('glow', T.plane(), [x, 82, s * (W / 2 + 1.5)], [88, 52, 1], [0, s > 0 ? 0 : Math.PI, 0], '#d4e8ff', { emissive: 2.1, uv: atlasUV('white') });
        B.add('std', T.box(), [x, 82, s * (W / 2 + 1.7)], [1.6, 52, 0.8], null, '#3b3934', { surf: [DET.panel, 0.5, 0.5] });
        B.add('std', T.box(), [x, 82, s * (W / 2 + 1.7)], [88, 1.6, 0.8], null, '#3b3934', { surf: [DET.panel, 0.5, 0.5] });
        B.block('std', x + 62, 0, s * (W / 2 + 1), 8, H, 2, '#c5bfb1', null, { surf: S });
      }
    }
  }
}

/** A square column from floor to ceiling. */
export function ipillar(B, o, L, W) {
  const H = ridgeHeight('ipillar', o);
  B.rblock('std', 0, 0, 0, L + 8, 8, W + 8, 1, '#8f8a7e', null, { surf: [DET.concrete, 0.85, 0] });
  B.rblock('std', 0, 8, 0, L, H - 16, W, 1.4, '#d8d4c8', null, { surf: [DET.concrete, 0.7, 0.05] });
  B.rblock('std', 0, H - 8, 0, L + 8, 8, W + 8, 1, '#bdb8ac', null, { surf: [DET.concrete, 0.85, 0] });
  B.box('glow', 0, 60, W * 0.5 + 0.3, 2, 40, 0.3, '#ffe9c4', null, { emissive: 0.9, uv: atlasUV('white') });
}

/** Office desk, waiting-room bench (thin) or conference table (wide). */
export function desk(B, o, L, W) {
  const r = B.rng;
  if (W <= 30) {
    // bench
    B.rblock('std', 0, 13, 0, L, 3, W - 8, 0.8, '#7a5a38', null, WOOD);
    for (const s of [-1, 1]) B.rblock('std', s * (L / 2 - 8), 0, 0, 5, 14, W - 12, 0.8, '#2f3236', null, { surf: STEEL });
    B.rblock('std', 0, 14, -W / 2 + 6, L, 15, 2.4, 0.8, '#7a5a38', [-0.18, 0, 0], WOOD);
    return;
  }
  if (W >= 48) {
    // conference table with a glowing centre strip
    B.rblock('std', 0, 24, 0, L, 4, W, 1.4, '#5d4630', null, WOOD);
    B.rblock('std', 0, 0, 0, L * 0.4, 24, W * 0.5, 1.2, '#2c2f33', null, { surf: STEEL });
    B.box('glow', 0, 28.4, 0, L * 0.5, 0.5, 4, '#9fd8ff', null, { emissive: 1.6, uv: atlasUV('white') });
    for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) B.rblock('std', i * (L / 5.5), 0, s * (W / 2 + 10), 14, 22, 14, 1.6, '#2a2c30', [0, 0, 0], { surf: [DET.fabric, 0.9, 0] });
    return;
  }
  B.rblock('std', 0, 24, 0, L, 3.4, W, 0.8, r.pick(['#8a6b4a', '#a39380', '#6f7a84']), null, WOOD);
  B.rblock('std', -L / 2 + 8, 0, 0, 14, 24, W - 4, 0.8, '#5b5f66', null, { surf: [DET.panel, 0.5, 0.5] });
  B.rblock('std', L / 2 - 4, 0, 0, 3, 24, W - 4, 0.6, '#5b5f66', null, { surf: [DET.panel, 0.5, 0.5] });
  // monitor, keyboard, papers, a lamp
  const mx = r.range(-L * 0.15, L * 0.15);
  B.rblock('std', mx, 27.4, -W * 0.15, 18, 12, 2.2, 0.6, '#1c1e22', [0, 0, 0], { surf: [0, 0.4, 0.5] });
  B.box('glow', mx, 34, -W * 0.15 + 1.2, 16, 9.4, 0.4, '#8fd0ff', null, { emissive: 1.1, uv: atlasUV('winCool') });
  B.box('std', mx, 27.6, W * 0.12, 15, 0.8, 5, '#26282c', null, { surf: [0, 0.6, 0.3] });
  B.box('std', -L * 0.3, 27.4, W * 0.05, 9, 0.5, 12, '#e9e6dc', [0, r.range(-0.3, 0.3), 0], { surf: [0, 0.9, 0] });
  // the chair (tucked in on the open side)
  B.rblock('std', L * 0.1, 0, W * 0.9, 16, 16, 16, 2, '#2a2d33', [0, r.range(-0.3, 0.3), 0], { surf: [DET.fabric, 0.9, 0] });
}

/** Filing cabinet, cubicle partition (thin) or server rack (tall and narrow). */
export function cabinet(B, o, L, W) {
  const r = B.rng;
  if (W <= 20 || L <= 20) {
    // cubicle partition: fabric panel with an aluminium frame
    const len = Math.max(L, W), thin = Math.min(L, W), along = L >= W;
    if (along) {
      B.block('std', 0, 0, 0, len, 86, thin, '#6d7f8c', null, { surf: [DET.fabric, 0.95, 0] });
      B.block('std', 0, 86, 0, len + 1, 2.4, thin + 1.4, '#9aa0a6', null, { surf: STEEL });
    } else {
      B.block('std', 0, 0, 0, thin, 86, len, '#6d7f8c', null, { surf: [DET.fabric, 0.95, 0] });
      B.block('std', 0, 86, 0, thin + 1.4, 2.4, len + 1, '#9aa0a6', null, { surf: STEEL });
    }
    return;
  }
  if (W >= 60 || L >= 60 && W >= 50) {
    // server rack: dark cabinet with a bank of blinking lights
    const h = 96;
    B.rblock('std', 0, 0, 0, L, h, W, 1.2, '#20242a', null, { surf: [DET.panel, 0.4, 0.6] });
    const along = W < L;
    for (let i = 0; i < 5; i++) {
      const y = 12 + i * 16;
      if (along) {
        B.box('std', 0, y, W / 2 + 0.3, L - 8, 1.2, 0.8, '#0b0d10', null, { surf: [0, 0.4, 0.6] });
        for (let k = 0; k < 6; k++) B.add('blink', T.sphere(4, 3), [-L / 2 + 10 + k * 9, y + 5, W / 2 + 0.9], [1, 1, 1], null, k % 3 ? '#3aff6a' : '#ff5a2a', { emissive: 3 });
      } else {
        B.box('std', L / 2 + 0.3, y, 0, 0.8, 1.2, W - 8, '#0b0d10', null, { surf: [0, 0.4, 0.6] });
        for (let k = 0; k < 6; k++) B.add('blink', T.sphere(4, 3), [L / 2 + 0.9, y + 5, -W / 2 + 10 + k * 9], [1, 1, 1], null, k % 3 ? '#3aff6a' : '#ff5a2a', { emissive: 3 });
      }
    }
    return;
  }
  // filing cabinets side by side
  const h = 88;
  const n = Math.max(1, Math.round(Math.max(L, W) / 34));
  const along = L >= W;
  for (let i = 0; i < n; i++) {
    const t = -(along ? L : W) / 2 + ((i + 0.5) * (along ? L : W)) / n;
    const w2 = (along ? L : W) / n - 1;
    const d2 = along ? W : L;
    const c = r.pick(['#7d8489', '#6b7379', '#8a9096']);
    if (along) B.rblock('std', t, 0, 0, w2, h, d2, 0.8, c, null, { surf: [DET.panel, 0.5, 0.6] });
    else B.rblock('std', 0, 0, t, d2, h, w2, 0.8, c, null, { surf: [DET.panel, 0.5, 0.6] });
    for (let k = 0; k < 3; k++) {
      const y = 12 + k * 26;
      if (along) {
        B.box('std', t, y + 8, d2 / 2 + 0.3, w2 - 4, 0.8, 0.6, '#2a2d30', null, { surf: [0, 0.5, 0.5] });
        B.box('std', t, y + 14, d2 / 2 + 0.6, 8, 1.6, 1, '#c9ced3', null, { surf: [0, 0.2, 1] });
      } else {
        B.box('std', d2 / 2 + 0.3, y + 8, t, 0.6, 0.8, w2 - 4, '#2a2d30', null, { surf: [0, 0.5, 0.5] });
        B.box('std', d2 / 2 + 0.6, y + 14, t, 1, 1.6, 8, '#c9ced3', null, { surf: [0, 0.2, 1] });
      }
    }
  }
}

/** Reception counter (long) or the atrium planter (square): 40 high. */
export function counter(B, o, L, W) {
  const r = B.rng;
  if (Math.abs(L - W) < 6) {
    // planter: a stone basin with soil, ferns and a small tree
    B.rblock('std', 0, 0, 0, L, 34, W, 2.4, '#b6b0a2', null, { surf: [DET.concrete, 0.8, 0.02] });
    B.rblock('std', 0, 30, 0, L - 12, 8, W - 12, 1.6, '#4a3626', null, { surf: [DET.dirt, 0.95, 0] });
    for (let i = 0; i < 9; i++) B.add('std', T.sphere(7, 5), [r.range(-L * 0.35, L * 0.35), 46 + r.range(0, 10), r.range(-W * 0.35, W * 0.35)], [12, 9, 12], null, r.pick(['#3f6b2c', '#4d7d33', '#356024']), { surf: [DET.grass, 0.9, 0] });
    B.cyl('std', 0, 34, 0, 2.6, 60, '#5a4126', 8, 0.7, null, { surf: [DET.bark, 0.9, 0] });
    B.add('std', T.sphere(9, 6), [0, 104, 0], [28, 20, 28], null, '#3f6b2c', { surf: [DET.grass, 0.9, 0], wobble: { amp: 0.18, seed: 7 } });
    return;
  }
  B.rblock('std', 0, 0, 0, L, 34, W, 1.6, '#9a8f7c', null, WOOD);
  B.rblock('std', 0, 34, 0, L + 3, 4, W + 3, 1, '#4a4038', null, WOOD);
  for (const s of [-1, 1]) {
    B.add('glow', T.plane(), [0, 20, s * (W / 2 + 0.4)], [L * 0.7, 6, 1], [0, s > 0 ? 0 : Math.PI, 0], '#ffe6b0', { emissive: 1.6, uv: atlasUV('white') });
  }
  // a terminal and a bell on the near end
  B.rblock('std', L * 0.3, 38, 0, 16, 12, 2, 0.6, '#1c1e22', null, { surf: [0, 0.4, 0.5] });
  B.box('glow', L * 0.3, 43, 1.2, 14, 8, 0.4, '#8fd0ff', null, { emissive: 1.1, uv: atlasUV('winCool') });
  B.cyl('std', -L * 0.3, 38, 0, 3, 3, '#c9ced3', 10, 0.7, null, { surf: [0, 0.2, 1] });
}

/** A staircase going up into the ceiling: treads rise along +x, handrails, a lit exit sign. */
export function stairs(B, o, L, W) {
  const H = ridgeHeight('stairs', o);
  const n = 14;
  const S = [DET.concrete, 0.8, 0.02];
  for (let i = 0; i < n; i++) {
    const x0 = -L / 2 + (i * L) / n;
    const h = ((i + 1) * H) / n;
    B.block('std', x0 + L / n / 2, 0, 0, L / n + 0.4, h, W, '#8d8a82', null, { surf: S });
    B.box('std', x0 + L / n - 1.2, h - 0.6, 0, 2.4, 1.2, W - 1, '#d9b23a', null, { surf: [0, 0.7, 0.1] });
  }
  for (const s of [-1, 1]) {
    B.block('std', 0, 0, s * (W / 2 + 1.2), L, H, 2.4, '#6f6c66', null, { surf: S });
    beam(B, 'std', -L / 2, 34, s * (W / 2 - 4), L / 2, H + 34, s * (W / 2 - 4), 1.4, '#2f3236', STEEL);
  }
  // signage: green EXIT / UP light above the top
  B.box('glow', L / 2 - 2, H - 16, 0, 1, 9, 30, '#3cff7a', null, { emissive: 3.2, uv: atlasUV('white') });
  B.box('glow', -L / 2 - 0.4, 16, 0, 0.8, 5, W * 0.7, '#ffcf5a', null, { emissive: 2, uv: atlasUV('stripeYB') });
}

// ---- the roof -------------------------------------------------------------------------------------

/** Rooftop plant unit: louvred cabinet, a fan housing and a duct. */
export function hvac(B, o, L, W) {
  const r = B.rng;
  B.rblock('std', 0, 0, 0, L, 44, W, 1.6, r.pick(['#9aa0a4', '#8e9498', '#a3a89f']), null, { surf: [DET.panel, 0.45, 0.6] });
  for (let i = 0; i < 6; i++) B.box('std', -L / 2 + 8 + i * ((L - 16) / 5), 22, W / 2 + 0.4, 1.4, 26, 0.6, '#2a2d30', null, { surf: [0, 0.5, 0.5] });
  B.rblock('std', 0, 44, 0, L * 0.7, 10, W * 0.7, 1.2, '#7d8286', null, { surf: [DET.panel, 0.5, 0.6] });
  B.cyl('std', L * 0.15, 54, 0, Math.min(L, W) * 0.24, 2, '#2a2d30', 16, 1, null, { surf: [DET.hesco, 0.5, 0.7] });
  B.cylX('std', -L / 2 - 8, 30, 0, 6, 18, '#b8bcbf', 10, { surf: [0, 0.35, 0.8] });
  B.add('blink', T.sphere(4, 3), [L / 2 - 6, 48, W / 2 - 4], [1.2, 1.2, 1.2], null, '#3aff6a', { emissive: 2.4 });
}

/** Parapet: a low concrete wall with a coping stone and expansion joints. */
export function parapet(B, o, L, W) {
  const S = [DET.concrete, 0.88, 0];
  B.rblock('std', 0, 0, 0, L, 40, W, 1.2, '#a49f95', null, { surf: S });
  B.rblock('std', 0, 40, 0, L + 1, 4, W + 3, 0.8, '#bcb7ac', null, { surf: [DET.concrete, 0.8, 0] });
  const n = Math.round(L / 140);
  for (let i = 1; i < n; i++) B.box('std', -L / 2 + (i * L) / n, 22, 0, 1.2, 40, W + 0.4, '#5c584f', null, { surf: S });
}

/** Steel mast: a lattice tower for the tall ones (the antenna), a plain post for the short ones. */
export function mast(B, o, L, W, halos) {
  const H = ridgeHeight('mast', o);
  const col = '#a3a8ad';
  if (H >= 220) {
    const w0 = 15, w1 = 3.5;
    const corner = (y) => w0 + (w1 - w0) * (y / H);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, 'std', sx * w0, 0, sz * w0, sx * w1, H, sz * w1, 1.5, col, STEEL);
    for (let y = 0; y < H - 30; y += 30) {
      const y2 = Math.min(H, y + 30), a = corner(y), b = corner(y2);
      for (const [px, pz, qx, qz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
        beam(B, 'std', px * a, y, pz * a, qx * b, y2, qz * b, 0.7, col, STEEL);
        beam(B, 'std', px * a, y, pz * a, qx * a, y, qz * a, 0.7, col, STEEL);
      }
    }
    B.cyl('std', 0, H, 0, 1.2, 40, col, 6, 1, null, { surf: STEEL });
    B.add('std', T.cyl(14, 1), [corner(H * 0.6) + 5, H * 0.6, 0], [10, 3, 10], [0, 0, Math.PI / 2], '#d8d8d0', { surf: [DET.panel, 0.5, 0.3] });
    for (const y of [H * 0.5, H + 34]) B.add('blink', T.sphere(6, 4), [0, y, 0], [3, 3, 3], null, '#ff2a1a', { emissive: 3.4 });
    if (halos) halos.push({ x: o.x, y: o.y, h: H + 34, color: '#ff2a1a', size: 90, blink: 1, strength: 0.9 });
  } else {
    // gantry post: a steel column with a cap, foot plate and cable clamp
    B.rblock('std', 0, 0, 0, 30, 6, 30, 1, '#4a4e52', null, { surf: STEEL });
    B.cyl('std', 0, 6, 0, 6.5, H - 6, col, 12, 0.85, null, { surf: [0, 0.35, 0.85] });
    B.rblock('std', 0, H - 3, 0, 20, 8, 20, 1.4, '#3a3e42', null, { surf: STEEL });
    B.box('glow', 0, H - 24, 0, 12.6, 2, 12.6, '#7dffb0', null, { emissive: 2.6, uv: atlasUV('white') });
  }
}

// ---- painted signs and other small textured meshes --------------------------------------------------

/** A small canvas-painted sign as a mesh (unlit, bright: it glows). */
export function makeSign(text, w, h, colors) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = Math.max(64, Math.round((512 * h) / w));
  const g = cv.getContext('2d');
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = colors.fg;
  g.lineWidth = 8;
  g.strokeRect(6, 6, cv.width - 12, cv.height - 12);
  g.fillStyle = colors.fg;
  g.font = `800 ${Math.round(cv.height * 0.56)}px "Barlow Condensed", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cv.width / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: true });
  mat.color.setScalar(1.35);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return mesh;
}

/** The helipad markings: a yellow ring, a white H and the corner ticks, painted on a disc. */
export function makeHelipad(r) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  g.translate(256, 256);
  g.fillStyle = 'rgba(38,44,52,0.95)';
  g.beginPath();
  g.arc(0, 0, 250, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f2c230';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(0, 0, 226, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#eef0f2';
  g.fillRect(-84, -104, 34, 208);
  g.fillRect(50, -104, 34, 208);
  g.fillRect(-84, -17, 168, 34);
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(238,240,242,0.55)';
  g.beginPath();
  g.arc(0, 0, 190, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const geo = new THREE.PlaneGeometry(r * 2, r * 2);
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

// ---- the distant skyline --------------------------------------------------------------------------------

/** A tiling window texture (lit and dark panes) for the skyline blocks. */
function skylineTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#5e6a76';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const lit = hash01(x * 7 + y * 13) < 0.3;
      g.fillStyle = lit ? '#e8d9a8' : ['#2f3d4c', '#2a3744', '#34465a'][(x + y) % 3];
      g.fillRect(x * 32 + 5, y * 32 + 7, 22, 18);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The skyline blocks (map.campaign.skyline: { x, y, w, d, h, s }) as ONE mesh: boxes with a
 * tiled window texture (repeats scaled to each block's size), vertex-shaded darker toward
 * the ground. No collision; the fog swallows them in the distance.
 */
export function makeSkyline(list) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const base = new THREE.Color();
  let vi = 0;
  const quad = (a, b, c, d, n, u1, v1, k) => {
    for (const p of [a, b, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); }
    uv.push(0, 0, u1, 0, u1, v1, 0, v1);
    for (let i = 0; i < 4; i++) col.push(k, k, k);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  };
  for (const s of list) {
    const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, z0 = s.y - s.d / 2, z1 = s.y + s.d / 2, h = s.h;
    const tone = 0.75 + hash01(s.s) * 0.5;
    base.setHSL(0.58 + (hash01(s.s + 3) - 0.5) * 0.05, 0.12, 0.42 * tone);
    const uw = s.w / 64, ud = s.d / 64, vh = h / 64;
    const k = tone;
    quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], uw, vh, k);
    quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], uw, vh, k * 0.9);
    quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], ud, vh, k * 0.8);
    quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], ud, vh, k * 0.85);
    quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], 0.001, 0.001, k * 0.6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ map: skylineTexture(), vertexColors: true, roughness: 0.75, metalness: 0.1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'skyline';
  mesh.frustumCulled = false;
  return mesh;
}

// ---- the annex buildings: glass and concrete shells around the plateaus -----------------------------------------

/**
 * A curtain-wall shell around rect (x0, y0)-(x1, y1) from the ground up to `top`: spandrel
 * bands, a long glass strip per storey and mullions on all four faces, a cornice at the top
 * and a dark roof slab when `roofSlab` (the floors' tops, seen from the rooftop).
 */
function shell(B, rect, base, top, seed, roofSlab, tone = CURTAIN) {
  const { x0, y0, x1, y1 } = rect;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, d = y1 - y0;
  // (the object frame is lifted by the terrain under its centre: undo that, y = 0 is the world's ground)
  B.obj(cx, cy, 0, seed, -base);
  B.setJitter(0.03);
  const S = [DET.panel, 0.5, 0.35];
  const bandH = 22, first = 14;
  // the shaft's core (the faces sit just in front of it)
  B.block('std', 0, 0, 0, w, top, d, tone, null, { surf: S });
  const face = (len, off, rot, ax) => {
    const put = (t, y, out, sx, sy, sz) => (ax === 'x'
      ? B.add('std', T.box(), [off + Math.sign(off) * out, y, t], [sz, sy, sx], null, tone, { surf: S })
      : B.add('std', T.box(), [t, y, off + Math.sign(off) * out], [sx, sy, sz], null, tone, { surf: S }));
    for (let y = first; y + bandH <= top - 6; y += bandH) {
      put(0, y + 1, 0.8, len, 3.4, 1.4);
      const o2 = off + Math.sign(off) * 0.9;
      const gp = ax === 'x' ? [o2, y + 3.4 + (bandH - 4.4) / 2, 0] : [0, y + 3.4 + (bandH - 4.4) / 2, o2];
      const n = Math.round(y / bandH);
      B.add('glass', T.plane(), gp, [len - 6, bandH - 6, 1], [0, rot, 0], shadeHex(GLASS_C, (hash01(seed * 13 + n) - 0.5) * 0.3), { surf: [0, -1, -1] });
    }
    const m = Math.max(2, Math.round(len / 46));
    for (let i = 0; i <= m; i++) {
      const t = -len / 2 + (i * len) / m;
      put(t, top / 2, 1.2, 2.4, top - 4, 2.4);
    }
    // a few lit offices
    for (let i = 0; i < Math.round(len / 90); i++) {
      const t = -len / 2 + 20 + hash01(seed * 7 + i * 3 + rot * 5) * (len - 40);
      const y = first + 3.4 + Math.floor(hash01(seed * 11 + i) * Math.max(1, (top - first) / bandH - 1)) * bandH;
      const o3 = off + Math.sign(off) * 1.1;
      const gp = ax === 'x' ? [o3, y + 8, t] : [t, y + 8, o3];
      B.add('glow', T.plane(), gp, [40, 12, 1], [0, rot, 0], '#ffffff', { emissive: 0.7, uv: atlasUV('winOffice') });
    }
  };
  face(d, w / 2, Math.PI / 2, 'x');
  face(d, -w / 2, -Math.PI / 2, 'x');
  face(w, d / 2, 0, 'z');
  face(w, -d / 2, Math.PI, 'z');
  // cornice and (optionally) a roof slab with vents
  B.rblock('std', 0, top - 4, 0, w + 6, 6, d + 6, 1.4, shadeHex(tone, 0.12), null, { surf: [DET.concrete, 0.8, 0.05] });
  if (roofSlab) {
    B.block('std', 0, top + 2, 0, w - 6, 1, d - 6, '#3d434a', null, { surf: [DET.slab, 0.9, 0] });
    for (let i = 0; i < 4; i++) B.rblock('std', -w * 0.3 + i * (w * 0.2), top + 3, ((i * 37) % 3 - 1) * d * 0.25, 50, 14, 36, 1.2, '#7d8286', null, { surf: [DET.panel, 0.5, 0.6] });
  }
}

/** Outer shells of the annex buildings: the floors' blocks, the roof's cliff and the landing deck. */
function annexShells(B, c, seed) {
  const e = PLATEAU_EDGE + 0.6;
  const out = (r, k = e) => ({ x0: r.x0 - k, y0: r.y0 - k, x1: r.x1 + k, y1: r.y1 + k });
  c.floors.forEach((f, i) => {
    const top = f.base + f.ceil + 10;
    shell(B, out(f, f.base > 0 ? e : 0.6), f.base, top, seed + i, true);
  });
  shell(B, out(c.roof), c.roof.base, c.roof.base, seed + 9, false, '#66727f');
  shell(B, out(c.landing), c.landing.base, c.landing.base, seed + 10, false, '#7a8088');
}

// ---- floors, roof, zip line, landing -------------------------------------------------------------------------

/**
 * Everything of the tower's insides that is not an obstacle: ceilings with light panels,
 * doors, daylight from the atrium's skylight, the roof's helipad edge lights and plant,
 * the zip-line gantry with its cable, the landing pad.
 * @param {object} B geo builder (world-geo.js)
 * @param {object} map MapDef with `campaign`
 * @param {{ halos: object[], shafts: object[] }} fx lists the world turns into light sprites
 * @returns {{ signs: THREE.Object3D[], helipad: THREE.Object3D|null }}
 */
export function buildRidgeWorld(B, map, fx) {
  const c = map.campaign;
  const out = { signs: [], helipad: null };
  const { halos, shafts } = fx;
  let seed = 9000;
  for (const f of c.floors) {
    const w = f.x1 - f.x0, h = f.y1 - f.y0, cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2;
    B.obj(cx, cy, 0, seed++);
    B.setJitter(0.03);
    const H = f.ceil;
    // ceiling slab with a grid of panels and fluorescent tubes
    B.block('std', 0, H, 0, w - 2, 10, h - 2, '#c9c6bd', null, { surf: [DET.slab, 0.9, 0] });
    B.block('std', 0, H - 3, 0, w - 4, 3, h - 4, '#b9b6ad', null, { surf: [DET.panel, 0.85, 0] });
    for (let ix = -2; ix <= 2; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const x = ix * (w / 5.4), z = iz * (h / 3.4);
        if (f.skylight && Math.hypot(x - (f.skylight.x - cx), z - (f.skylight.y - cy)) < f.skylight.r * 0.9) continue;
        B.box('std', x, H - 4, z, 60, 1.6, 12, '#e4e2dc', null, { surf: [0, 0.5, 0.3] });
        B.add('glow', T.plane(), [x, H - 5.2, z], [56, 8, 1], [Math.PI / 2, 0, 0], '#f2f6ff', { emissive: iz === 0 && ix === 0 ? 3.0 : 4.0, uv: atlasUV('tube') });
      }
    }
    // ducts along the ceiling and sprinkler heads
    B.block('std', 0, H - 26, -h * 0.36, w * 0.9, 20, 26, '#a9adb1', null, { surf: [DET.panel, 0.5, 0.6] });
    B.block('std', 0, H - 26, h * 0.36, w * 0.9, 20, 26, '#a9adb1', null, { surf: [DET.panel, 0.5, 0.6] });
    if (f.skylight) {
      // the atrium: a big skylight full of sun, with shafts of light falling from it
      const sx = f.skylight.x - cx, sz = f.skylight.y - cy, sr = f.skylight.r;
      B.add('glow', T.plane(), [sx, H - 5.5, sz], [sr * 1.6, sr * 1.6, 1], [Math.PI / 2, 0, Math.PI / 4], '#dcecff', { emissive: 2.8, uv: atlasUV('white') });
      for (const [dx, dz] of [[0, 0], [-60, 40], [60, -30], [40, 60], [-50, -50]]) shafts.push({ x: f.skylight.x + dx, y: f.skylight.y + dz, h: f.base + H - 6, base: f.base, color: '#fff3d6', radius: 90, strength: 1.3, abs: true });
    }
    // doors: steel double doors with a red EXIT glow where the horde comes from
    for (const d of f.doors) {
      const ob = d;
      B.obj(ob.x, ob.y, ob.a, seed++);
      B.setJitter(0.02);
      const dw = ob.w;
      B.block('std', 0, 0, 0.6, dw + 12, 112, 4, '#3d4146', null, { surf: [DET.panel, 0.5, 0.6] });
      B.block('std', -dw / 4 - 0.4, 2, 2.6, dw / 2 - 2, 104, 2, '#5f666d', null, { surf: [DET.panel, 0.4, 0.7] });
      B.block('std', dw / 4 + 0.4, 2, 2.6, dw / 2 - 2, 104, 2, '#5f666d', null, { surf: [DET.panel, 0.4, 0.7] });
      for (const s of [-1, 1]) B.box('glow', s * dw / 4, 76, 3.8, dw / 2 - 12, 22, 0.4, '#9fb4c8', null, { emissive: 0.5, uv: atlasUV('winDim') });
      B.box('glow', 0, 120, 3, 26, 8, 1, '#ff2a1a', null, { emissive: 3.4, uv: atlasUV('white') });
      B.box('glow', 0, 8, 3.8, dw + 4, 2.4, 0.4, '#ffcf5a', null, { emissive: 1.6, uv: atlasUV('stripeYB') });
      if (halos) halos.push({ x: ob.x, y: ob.y, h: f.base + 120, color: '#ff2a1a', size: 80, strength: 0.7, abs: true });
    }
  }

  annexShells(B, c, 5100);
  // ---- the roof ----
  const rf = c.roof;
  B.obj(0, 0, 0, seed++);
  B.setJitter(0.02);
  const pad = rf.pad;
  const y0 = 0.5;
  // (helipad markings are their own textured disc; the edge lights blink around it)
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI * 2) / 16;
    B.add('blink', T.sphere(5, 3), [pad.x + Math.cos(a) * (pad.r + 6), y0 + 2, pad.y + Math.sin(a) * (pad.r + 6)], [1.8, 1.4, 1.8], null, '#ffb84a', { emissive: 3.2 });
  }
  // a water tank on legs, a satellite dish and vents in the north-west corner
  const wx = rf.x0 + 300, wy = rf.y1 - 150;
  for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', wx + ax * 26, 0.5, wy + az * 26, 4, 38, 4, '#3a3632', null, { surf: STEEL });
  B.cyl('std', wx, 38.5, wy, 34, 46, '#5a4a3a', 16, 1, null, { surf: [DET.wood, 0.85, 0] });
  B.cyl('std', wx, 84.5, wy, 34.6, 8, '#3a3632', 16, 0.1, null, { surf: STEEL });
  B.add('std', T.sphere(12, 6), [rf.x1 - 130, 22, rf.y0 + 300], [22, 22, 6], [0.9, 0.5, 0], '#d8d8d0', { surf: [DET.panel, 0.5, 0.3] });
  B.cyl('std', rf.x1 - 130, 0.5, rf.y0 + 300, 2, 24, '#8a8e92', 6, 1, null, { surf: STEEL });
  // the zip-line gantry: crossbeam on the two posts, the winch box and the anchor with its lamp
  const z = rf.zip;
  const gz = z.z;
  B.rblock('std', z.x, gz - 8, z.y, 116, 10, 12, 1.4, '#3a3e42', null, { surf: STEEL });
  B.rblock('std', z.x, gz - 20, z.y + 6, 30, 18, 20, 1.6, '#c25a12', null, { surf: [DET.panel, 0.45, 0.5] });
  B.box('glow', z.x, gz - 12, z.y + 16.4, 22, 3, 0.5, '#7dffb0', null, { emissive: 2.2, uv: atlasUV('white') });
  for (const s of [-1, 1]) B.box('glow', z.x + s * 46, gz + 2, z.y, 12.6, 2, 12.6, '#7dffb0', null, { emissive: 2.4, uv: atlasUV('white') });
  // the cable
  const e = c.landing.end;
  beam(B, 'std', z.x, gz - 4, z.y + 4, e.x, e.z, e.y, 2.6, '#8f979e', [0, 0.3, 0.95]);
  beam(B, 'std', z.x, gz - 4 + 3.4, z.y + 4, e.x, e.z + 3.4, e.y, 0.9, '#c9d0d6', [0, 0.2, 1]);
  // the landing: posts, the buffer block and hazard stripes, a green-lit arch and pad lights
  const l = c.landing;
  B.obj(0, 0, 0, seed++);
  B.setJitter(0.02);
  const lb = l.base;
  B.rblock('std', e.x, lb + 6, e.y, 70, 22, 14, 1.8, '#d9761a', null, { surf: [DET.rubber, 0.8, 0] });
  B.box('glow', e.x, lb + 12, e.y + 7.4, 62, 6, 0.5, '#ffffff', null, { emissive: 1.4, uv: atlasUV('stripeYB') });
  B.rblock('std', e.x, e.z - 10, e.y, 116, 10, 12, 1.4, '#3a3e42', null, { surf: STEEL });
  B.box('glow', e.x, e.z - 2, e.y + 6, 20, 2, 0.8, '#7dffb0', null, { emissive: 2.4, uv: atlasUV('white') });
  for (const [x, y] of [[l.x0 + 30, l.y0 + 30], [l.x1 - 30, l.y0 + 30], [l.x0 + 30, l.y1 - 30], [l.x1 - 30, l.y1 - 30]]) {
    B.cyl('std', x, lb, y, 3, 74, '#8a8e92', 8, 1, null, { surf: STEEL });
    B.add('glow', T.sphere(6, 4), [x, lb + 76, y], [5, 5, 5], null, '#ffffff', { emissive: 4, uv: atlasUV('white') });
    if (halos) halos.push({ x, y, h: lb + 76, color: '#dff4ff', size: 150, strength: 0.7, abs: true });
  }
  if (halos) {
    halos.push({ x: z.x - 46, y: z.y, h: gz + 3, color: '#7dffb0', size: 150, blink: 1, strength: 0.8, abs: true });
    halos.push({ x: z.x + 46, y: z.y, h: gz + 3, color: '#7dffb0', size: 150, blink: 1, strength: 0.8, abs: true });
    halos.push({ x: e.x, y: e.y, h: e.z, color: '#7dffb0', size: 160, strength: 0.7, abs: true });
  }
  // signs & the helipad disc are separate meshes
  const helipad = makeHelipad(pad.r + 14);
  helipad.position.set(pad.x, rf.base + 0.6, pad.y);
  out.helipad = helipad;
  const safe = makeSign('SAFE ZONE', 200, 42, { bg: '#0d3b22', fg: '#9dffc4' });
  safe.position.set(l.x + (l.x1 - l.x0) / 2, lb + 92, l.y1 - 28);
  safe.rotation.y = Math.PI;
  const upSign = makeSign('EXIT: ZIP LINE', 190, 32, { bg: '#0f2a3d', fg: '#a6e3ff' });
  upSign.position.set(z.x, rf.base + 100, z.y - 46);
  upSign.rotation.y = 0;
  const towerSign = makeSign('MERIDIAN', 190, 44, { bg: '#0d1620', fg: '#8fd0ff' });
  towerSign.userData.tower = true;
  out.signs.push(safe, upSign, towerSign);
  return out;
}
