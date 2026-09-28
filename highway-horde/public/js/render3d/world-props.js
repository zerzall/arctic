// Props of the static world (WORLD, SPEC §7.5): jersey barriers, sandbags, guard rails,
// fences and walls, HESCO bastions, shipping containers / dumpsters / generators / the
// propane cage, fuel pumps, canopy pillars and slabs, tents, guard booths, rocks, and the
// small decor (street lamps, cones, tyres, rubble, debris, trash bags, road signs, grass
// tufts). All at the canonical heights; everything goes through the geo builder with a
// detail layer (world-surf.js) so concrete, canvas, wire mesh and rust read up close.

import { T, mixHex, shadeHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { signalMode } from '../render/maplayer.js';

const CONCRETE = '#8a877e';
const POLE = '#6e757b';    // galvanised steel: a black pole vanished against the night sky
const RUBBER = '#1b1b1c';
const GRASS = ['#3d4f26', '#4a5a2c', '#56552f', '#34461f', '#5e5a36'];
const TYRE_PROFILE = [[0.6, -0.5], [0.86, -0.5], [0.96, -0.44], [1.0, -0.3], [1.0, 0.3], [0.96, 0.44], [0.86, 0.5], [0.6, 0.5]];

// ---- barriers & fortifications -------------------------------------------------------------

/** Jersey barrier run: concrete (some painted with red/white hazard stripes), reflectors. */
export function jersey(B, L, W, color) {
  const pts = [[-W / 2, 0], [W / 2, 0], [W / 2, 5], [W * 0.2, 12], [W * 0.15, 26], [-W * 0.15, 26], [-W * 0.2, 12], [-W / 2, 5]];
  const n = Math.max(1, Math.round(L / 60));
  const seg = L / n;
  const r = B.rng;
  const striped = hash01(Math.round(L * 7 + W)) < 0.5;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * seg;
    const c = r.chance(0.2) ? shadeHex(color, -0.2) : color;
    const tilt = r.range(-0.012, 0.012);
    B.add('std', T.profile('jersey' + W, pts, 0.9, seg - 1.2), [x, 0, 0], [1, 1, 1], [0, Math.PI / 2, tilt], c, { surf: [DET.concrete, 0.88, 0] });
    if (striped) {
      // hazard band on both faces of the upper slope
      for (const sd of [-1, 1]) {
        B.add('glow', T.plane(), [x, 19.5, sd * (W * 0.19 + 0.45)], [seg - 5, 8, 1], [0, sd > 0 ? 0 : Math.PI, 0], '#ffffff', { uv: atlasUV('stripeRW'), emissive: 0.5, noAO: true });
      }
    } else if (r.chance(0.6)) {
      for (const sd of [-1, 1]) B.box('glow', x, 21, sd * (W * 0.16 + 0.3), 5, 2.4, 0.4, '#ffb030', null, { emissive: 1.6, uv: atlasUV('white') });
    }
    // lifting slots at the foot
    B.box('std', x, 2.5, 0, 8, 3, W * 1.02, '#2a2926', null, { surf: [0, 0.95, 0] });
  }
}

/** Sandbag wall: staggered courses of sack-shaped bags. */
export function sandbags(B, L, W, color) {
  const r = B.rng;
  const rows = 4, bagL = 20, bagH = 7.6;
  const depth = Math.min(W, 26);
  color = mixHex(color, '#6a5e44', 0.3);
  for (let row = 0; row < rows; row++) {
    const n = Math.max(1, Math.round(L / (bagL - 1.5)));
    const off = row % 2 ? 0.5 : 0;
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + ((i + 0.5 + off * (i < n - 1 ? 1 : 0)) * L) / n;
      const c = mixHex(color, r.chance(0.5) ? '#a09070' : '#5e5238', r.range(0, 0.35));
      B.add('std', T.pillow(12, 7, 0.4), [x, bagH * 0.5 + row * (bagH - 0.8), r.range(-1, 1)], [bagL / 2 + 0.6, bagH * 0.6, depth / 2 - row * 1.1], [r.range(-0.05, 0.05), r.range(-0.1, 0.1), r.range(-0.06, 0.06)], c, { surf: [DET.fabric, 0.92, 0] });
    }
  }
}

/** Highway W-beam guard rail on posts with blockouts and amber reflectors. */
export function guardrail(B, L, W, color) {
  const n = Math.max(2, Math.round(L / 38) + 1);
  const steel = mixHex(color, '#9aa0a4', 0.5);
  const S = [DET.rust, 0.5, 0.75];
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i * L) / (n - 1);
    B.block('std', x, 0, -1, 3, 20, 2.4, '#50565a', null, { surf: S });
    B.block('std', x, 11, W * 0.05, 2.2, 7, 3.2, '#3a2e22', null, { surf: [DET.wood, 0.85, 0] });
    if (i % 2 === 0) B.box('glow', x, 16, W * 0.18 + 1.2, 1.4, 1.4, 0.4, '#ffb020', null, { emissive: 1.8, uv: atlasUV('white') });
  }
  // the W profile, extruded along the run
  const wpts = [[-0.3, -4.2], [0.8, -3.6], [1.1, -1.4], [0.5, 0], [1.1, 1.4], [0.8, 3.6], [-0.3, 4.2], [-0.3, 3.2], [0.1, 1.2], [-0.2, 0], [0.1, -1.2], [-0.3, -3.2]];
  B.add('std', T.profile('wbeam', wpts), [0, 16, W * 0.18], [1, 1, L], [0, Math.PI / 2, 0], steel, { surf: S });
}

/** Thin fence (h ≤ 8): wooden plank fence or chain link on galvanised posts. */
export function fence(B, L, W, color) {
  const r = B.rng;
  const wood = parseInt(color.slice(1, 3), 16) > parseInt(color.slice(5, 7), 16) + 12;
  if (wood) {
    const n = Math.max(2, Math.round(L / 42) + 1);
    for (let i = 0; i < n; i++) B.block('std', -L / 2 + (i * L) / (n - 1), 0, 0, 5, 40 + r.range(-3, 2), 5, shadeHex(color, -0.1), [0, 0, r.range(-0.05, 0.05)], { surf: [DET.wood, 0.85, 0] });
    for (const y of [13, 25, 36]) {
      if (r.chance(0.15)) continue;   // a missing rail here and there
      B.box('std', 0, y, 2.4, L, 4, 1.6, color, [r.range(-0.01, 0.01), 0, 0], { surf: [DET.wood, 0.85, 0] });
    }
    // vertical pickets on one side, a few missing
    for (let x = -L / 2 + 3; x < L / 2; x += 6.5) {
      if (r.chance(0.12)) continue;
      B.block('std', x, 1, 3.6, 5.6, 36 + r.range(-2, 2), 0.9, shadeHex(color, r.range(-0.15, 0.08)), [0, 0, r.range(-0.03, 0.03)], { surf: [DET.wood, 0.85, 0] });
    }
  } else {
    const n = Math.max(2, Math.round(L / 60) + 1);
    const S = [DET.rust, 0.45, 0.9];
    for (let i = 0; i < n; i++) B.cyl('std', -L / 2 + (i * L) / (n - 1), 0, 0, 1.6, 42, '#8c9296', 8, 1, null, { surf: S });
    B.cylX('std', 0, 41, 0, 1.1, L, '#8c9296', 8, { surf: S });
    B.cylX('std', 0, 3, 0, 0.7, L, '#8c9296', 6, { surf: S });
    B.add('fence', T.plane(), [0, 21, 0], [L, 38, 1], null, '#7a8084', { uvScale: [L / 16, 38 / 16] });
  }
}

/** Masonry wall with piers and a capping course. */
export function wall(B, L, W, color) {
  const brick = hash01(Math.round(L * 3 + W * 5)) < 0.5;
  const S = [brick ? DET.brick : DET.concrete, 0.9, 0];
  B.block('std', 0, 0, 0, L, 86, W, color, null, { surf: S });
  B.rblock('std', 0, 86, 0, L + 2, 4, W + 4, 0.8, shadeHex(color, 0.12), null, { surf: [DET.concrete, 0.85, 0] });
  const n = Math.max(1, Math.round(L / 90));
  for (let i = 0; i <= n; i++) B.block('std', -L / 2 + (i * L) / n, 0, 0, 8, 88, W + 4, shadeHex(color, -0.06), null, { surf: S });
  if (B.rng.chance(0.5)) {
    const x = B.rng.range(-L * 0.35, L * 0.35);
    B.add('decal', T.plane(), [x, 34, W / 2 + 0.3], [16, 24, 1], null, '#ffffff', { uv: atlasUV('poster' + Math.floor(B.rng.next() * 3)), noAO: true });
  }
}

/** HESCO bastion: wire-mesh cells of sandy geotextile. */
export function hesco(B, L, W, color) {
  const n = Math.max(1, Math.round(L / 44));
  const cell = L / n;
  const r = B.rng;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * cell;
    const c = mixHex(color, r.chance(0.5) ? '#b8a57a' : '#8c7a58', r.range(0, 0.3));
    B.rblock('std', x, 0, 0, cell - 1.4, 66, W - 1, 1.6, c, null, { surf: [DET.hesco, 0.82, 0.1] });
    // sand heaped on top, a little proud
    B.add('std', T.pillow(10, 5, 0.6), [x, 66.5, 0], [cell / 2 - 2, 3, W / 2 - 2.5], null, mixHex(c, '#5a4a30', 0.3), { surf: [DET.dirt, 0.95, 0] });
    for (const s of [-1, 1]) for (const z of [-1, 1]) B.block('std', x + s * (cell / 2 - 0.8), 0, z * (W / 2 - 0.4), 1, 70, 1, '#7a7c78', null, { surf: [DET.rust, 0.5, 0.8] });
    for (const z of [-1, 1]) B.box('std', x, 69.6, z * (W / 2 - 0.4), cell, 0.8, 0.8, '#7a7c78', null, { surf: [DET.rust, 0.5, 0.8] });
  }
}

// ---- containers ---------------------------------------------------------------------------------

/** Shipping container, dumpster, generator or the propane cage (by size and colour). */
export function container(B, o, L, W) {
  const r = B.rng;
  const color = o.color;
  if (Math.max(L, W) <= 72) {
    const light = parseInt(color.slice(1, 3), 16) > 190;
    if (light) {
      // propane cage: wire cage with white cylinders inside
      for (let x = -L / 2 + 8; x < L / 2 - 4; x += 12) {
        B.cyl('std', x, 0, 0, 5.5, 40, '#e8e6e0', 12, 1, null, { surf: [DET.panel, 0.35, 0.3] });
        B.add('std', T.sphere(10, 6), [x, 40, 0], [5.5, 3, 5.5], null, '#e8e6e0', { surf: [DET.panel, 0.35, 0.3] });
        B.cyl('std', x, 43, 0, 1.2, 3, '#8a8a80', 6, 1, null, { surf: [0, 0.3, 0.9] });
      }
      B.block('std', 0, 60, 0, L, 3, W, '#9aa0a4', null, { surf: [DET.rust, 0.5, 0.8] });
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', (x * L) / 2, 0, (z * W) / 2, 2, 62, 2, '#9aa0a4', null, { surf: [DET.rust, 0.5, 0.8] });
      for (const s of [-1, 1]) {
        B.add('fence', T.plane(), [0, 30, (s * W) / 2], [L, 60, 1], null, '#8a9094', { uvScale: [L / 12, 60 / 12] });
        B.add('fence', T.plane(), [(s * L) / 2, 30, 0], [W, 60, 1], [0, Math.PI / 2, 0], '#8a9094', { uvScale: [W / 12, 60 / 12] });
      }
      B.add('decal', T.plane(), [L / 2 + 0.6, 44, 0], [14, 14, 1], [0, Math.PI / 2, Math.PI / 4], '#ffffff', { uv: atlasUV('hazmat'), noAO: true });
    } else if (L >= 55 && W >= 40) {
      // generator: skid, enclosure with louvres, exhaust, status light
      B.block('std', 0, 0, 0, L, 8, W, '#222', null, { surf: [DET.rust, 0.7, 0.6] });
      B.rblock('std', 0, 8, 0, L * 0.96, 48, W * 0.96, 2, color, null, { surf: [DET.panel, 0.55, 0.4] });
      for (const s of [-1, 1]) B.box('std', L * 0.2, 32, s * (W * 0.48 + 0.3), L * 0.4, 30, 0.8, '#1c1c1c', null, { surf: [DET.corrugated, 0.6, 0.5] });
      B.cyl('std', -L * 0.3, 56, W * 0.2, 3, 14, '#3a3a3a', 8, 1, null, { surf: [DET.rust, 0.7, 0.6] });
      B.box('glow', -L * 0.2, 44, W * 0.48 + 0.4, 5, 3, 0.4, '#7dff7a', null, { emissive: 2.4, uv: atlasUV('white') });
      B.add('decal', T.plane(), [L * 0.2, 44, W * 0.48 + 0.35], [12, 6, 1], null, '#ffffff', { uv: atlasUV('stripeYB'), noAO: true });
    } else {
      // dumpster: sloped plastic lids, rusty body, trash spilling around it
      B.block('std', 0, 0, 0, L * 0.9, 4, W * 0.9, '#1a1a1a', null, { surf: [DET.rust, 0.8, 0.5] });
      B.add('std', T.profile('dumpster' + L, [[-L / 2, 4], [L / 2, 4], [L / 2, 52], [-L / 2, 46]], 1.2, W), [0, 0, 0], [1, 1, 1], null, color, { surf: [DET.rust, 0.7, 0.4] });
      B.rbox('std', 0, 53, 0, L + 2, 2, W + 2, 0.8, shadeHex(color, -0.35), [0, 0, 0.1], { surf: [DET.plastic, 0.5, 0] });
      trashBags(B, r, 2 + Math.floor(r.next() * 3), L, W / 2 + 5);
    }
    return;
  }
  // shipping container: corrugated walls, doors with lock bars, corner castings
  const H = 84;
  const S = [DET.corrugated, 0.6, 0.55];
  B.block('std', 0, 0, 0, L, H, W, color, null, { surf: S });
  B.block('std', 0, H, 0, L - 2, 1.5, W - 2, o.roof || shadeHex(color, -0.1), null, { surf: [DET.rust, 0.7, 0.5] });
  for (const s of [-1, 1]) {
    B.box('std', s * (L / 2 + 0.5), H / 2, 0, 1, H - 6, W - 6, shadeHex(color, -0.12), null, { surf: [DET.corrugated, 0.6, 0.5] });
    for (const z of [-0.3, -0.12, 0.12, 0.3]) B.cyl('std', s * (L / 2 + 1.4), 4, z * W, 0.7, H - 8, '#6a6e72', 6, 1, null, { surf: [DET.rust, 0.5, 0.9] });
  }
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (const y of [0, H - 5]) B.block('std', (x * (L - 4)) / 2, y, (z * (W - 4)) / 2, 5.2, 5.2, 5.2, shadeHex(color, -0.35), null, { surf: [DET.rust, 0.7, 0.6] });
  }
  for (const y of [1.5, H - 1.5]) for (const z of [-1, 1]) B.box('std', 0, y, z * (W / 2 + 0.3), L, 3, 1, shadeHex(color, -0.3), null, { surf: [DET.rust, 0.7, 0.6] });
  if (r.chance(0.6)) B.add('decal', T.plane(), [r.range(-L * 0.25, L * 0.25), H * 0.7, W / 2 + 1.2], [22, 7, 1], null, '#ffffff', { uv: atlasUV('stripeYB'), noAO: true });
}

/**
 * Black plastic sacks heaped beside something (dumpsters, buildings): spread over `span`
 * along x, starting `zNear` from the centre (its sign = which side) and 10 units deep.
 */
export function trashBags(B, r, n, span, zNear) {
  for (let i = 0; i < n; i++) {
    const s = r.range(4.5, 7);
    B.add('std', T.pillow(9, 6, 0.55), [r.range(-span / 2, span / 2), s * 0.7, zNear + Math.sign(zNear) * r.range(0, 10)], [s, s * 0.85, s * 0.9], [r.range(-0.2, 0.2), r.range(0, 6), r.range(-0.2, 0.2)], r.chance(0.8) ? '#131416' : '#3a3f2a', { wobble: { amp: 0.18, seed: i + 3 }, surf: [DET.plastic, 0.28, 0] });
  }
}

// ---- forecourt ---------------------------------------------------------------------------------

/** Fuel pump on its island: curb, bollards, lit price display, hoses. */
export function pump(B, L, W, color) {
  B.rblock('std', 0, 0, 0, L + 8, 6, W + 12, 1.2, CONCRETE, null, { surf: [DET.slab, 0.85, 0] });
  for (const s of [-1, 1]) B.cyl('std', s * (L / 2 + 1), 6, 0, 2.2, 30, '#e8c21a', 10, 1, null, { surf: [DET.panel, 0.5, 0.2] });
  B.rblock('std', 0, 6, 0, L * 0.72, 44, W * 0.62, 1.4, color, null, { surf: [DET.panel, 0.42, 0.3] });
  B.rblock('std', 0, 50, 0, L * 0.84, 5, W * 0.72, 1, shadeHex(color, -0.25), null, { surf: [DET.panel, 0.45, 0.4] });
  for (const s of [-1, 1]) {
    B.add('glow', T.plane(), [s * (L * 0.36 + 0.3), 37, 0], [W * 0.42, 10, 1], [0, s * Math.PI / 2, 0], '#ffffff', { emissive: 1.8, uv: atlasUV('pump') });
    B.box('std', s * (L * 0.36 + 1.2), 24, W * 0.18, 2, 10, 4, '#1a1a1a', null, { surf: [0, 0.4, 0.6] });
    // hose hanging in a loop to the nozzle
    B.add('std', T.torus(10, 0.12, 5), [s * (L * 0.36 + 2.5), 16, W * 0.18], [7, 9, 7], [0, s * Math.PI / 2, 0], RUBBER, { surf: [0, 0.6, 0] });
  }
  B.add('glow', T.plane(), [0, 53, W * 0.36 + 0.3], [L * 0.7, 3, 1], null, '#ff3a2a', { emissive: 1.4, uv: atlasUV('white') });
}

export function pillar(B, L, W, color) {
  B.rblock('std', 0, 0, 0, L + 6, 8, W + 6, 1.2, CONCRETE, null, { surf: [DET.concrete, 0.85, 0] });
  B.rblock('std', 0, 8, 0, L * 0.8, 142, W * 0.8, 1.6, color, null, { surf: [DET.panel, 0.4, 0.4] });
  B.box('glow', 0, 60, W * 0.4 + 0.3, 2, 30, 0.4, '#ffffff', null, { emissive: 0.5, uv: atlasUV('stripeRW') });
}

/**
 * Canopy slabs over clusters of forecourt pillars: fascia bands, and bright fluorescent
 * tubes underneath (emissive > 1 → bloom). Returns the canopies (centre, size) so the
 * world can light them.
 */
export function buildCanopies(B, map) {
  const pillars = map.obstacles.filter((o) => o.kind === 'pillar');
  const used = new Set();
  const out = [];
  for (const p of pillars) {
    if (used.has(p)) continue;
    const group = [p];
    used.add(p);
    for (let k = 0; k < group.length; k++) {
      for (const q of pillars) {
        if (!used.has(q) && Math.hypot(q.x - group[k].x, q.y - group[k].y) < 420) { used.add(q); group.push(q); }
      }
    }
    if (group.length < 2) continue;
    const xs = group.map((g) => g.x), ys = group.map((g) => g.y);
    const x0 = Math.min(...xs) - 70, x1 = Math.max(...xs) + 70, y0 = Math.min(...ys) - 70, y1 = Math.max(...ys) + 70;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    B.obj(cx, cy, 0, 4242);
    B.rblock('std', 0, 150, 0, w, 16, h, 2, '#dcd8cc', null, { surf: [DET.panel, 0.5, 0.2] });
    B.block('std', 0, 149.4, 0, w - 8, 0.6, h - 8, '#b8b4aa', null, { surf: [DET.panel, 0.6, 0.1] });
    for (const s of [-1, 1]) {
      B.box('std', 0, 158, s * (h / 2 + 0.6), w + 1, 12, 1, '#b3261e', null, { surf: [DET.panel, 0.35, 0.2] });
      B.box('std', s * (w / 2 + 0.6), 158, 0, 1, 12, h + 1, '#b3261e', null, { surf: [DET.panel, 0.35, 0.2] });
      B.box('glow', 0, 151.5, s * (h / 2 + 0.8), w + 1, 1.6, 1, '#4a8aff', null, { emissive: 1.8, uv: atlasUV('white') });
    }
    // fluorescent strips under the canopy
    for (let x = -w / 2 + 45; x < w / 2 - 20; x += 70) {
      for (let y = -h / 2 + 40; y < h / 2 - 20; y += 60) {
        B.box('std', x, 148.8, y, 36, 1.2, 8, '#d8d8d8', null, { surf: [0, 0.4, 0.6] });
        B.add('glow', T.plane(), [x, 147.8, y], [32, 5, 1], [Math.PI / 2, 0, 0], '#f2f6ff', { emissive: 4.2, uv: atlasUV('tube') });
      }
    }
    out.push({ x: cx, y: cy, w, h });
  }
  return out;
}

// ---- camp ------------------------------------------------------------------------------------------

export function tent(B, L, W, color, roof) {
  const pts = [[-W / 2, 0], [W / 2, 0], [W / 2, 34], [0, 80], [-W / 2, 34]];
  const c = roof || color;
  B.add('std', T.profile('tent' + W, pts, 0.8, L), [0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0], c, { surf: [DET.fabric, 0.9, 0] });
  // ridge seams and rolled-up side flaps
  B.box('std', 0, 79.5, 0, L + 1, 1.2, 2, shadeHex(c, -0.3), null, { surf: [DET.fabric, 0.9, 0] });
  for (const s of [-1, 1]) B.add('std', T.cyl(8), [0, 36, s * (W / 2 + 0.8)], [2, L * 0.9, 2], [0, 0, Math.PI / 2], shadeHex(c, -0.15), { surf: [DET.fabric, 0.9, 0], map: 'cyl' });
  B.box('std', L / 2 + 0.4, 22, 0, 0.6, 44, W * 0.3, '#1c1f14', null, { surf: [DET.fabric, 0.95, 0] });
  B.box('std', -L / 2 - 0.4, 22, 0, 0.6, 44, W * 0.3, '#1c1f14', null, { surf: [DET.fabric, 0.95, 0] });
  // warm light spilling out of the door
  B.add('glow', T.plane(), [L / 2 + 0.8, 20, 0], [W * 0.22, 36, 1], [0, Math.PI / 2, 0], '#ffcf8a', { emissive: 1.3, uv: atlasUV('white') });
  for (const s of [-1, 1]) {
    B.cyl('std', 0, 0, s * (W / 2 + 14), 1.2, 12, '#3a3a2a', 5, 1, null, { surf: [DET.wood, 0.9, 0] });
    // guy ropes
    B.add('std', T.cyl(4), [0, 18, s * (W / 2 + 7)], [0.3, 30, 0.3], [s * 1.0, 0, 0], '#8a8266', { surf: [0, 0.9, 0], map: 'cyl' });
    // clear plastic windows along the walls (a dim lamp inside)
    for (let x = -L / 2 + 24; x < L / 2 - 20; x += 34) B.add('glow', T.plane(), [x, 22, s * (W / 2 + 0.3)], [12, 8, 1], [0, s > 0 ? 0 : Math.PI, 0], '#ffffff', { emissive: 0.4, uv: atlasUV('winDim') });
    // sandbags holding down the skirt
    for (let x = -L / 2 + 8; x < L / 2 - 4; x += 16) B.add('std', T.pillow(8, 5, 0.45), [x, 3, s * (W / 2 + 3)], [7.5, 3.4, 4.5], [0, B.rng.range(-0.2, 0.2), 0], '#6e6248', { surf: [DET.fabric, 0.92, 0] });
  }
  // stove pipe through the roof, and a red cross on some
  B.cyl('std', L * 0.25, 52, W * 0.18, 1.8, 40, '#2a2a2a', 8, 1, null, { surf: [DET.rust, 0.7, 0.6] });
  if (B.rng.chance(0.4)) {
    for (const s of [-1, 1]) {
      B.box('std', 0, 22, s * (W / 2 + 0.35), 16, 4, 0.3, '#c01a1a', null, { surf: [0, 0.7, 0] });
      B.box('std', 0, 22, s * (W / 2 + 0.35), 4, 16, 0.3, '#c01a1a', null, { surf: [0, 0.7, 0] });
    }
  }
}

export function booth(B, L, W, color, roof) {
  B.rblock('std', 0, 0, 0, L, 40, W, 1.2, color, null, { surf: [DET.concrete, 0.85, 0] });
  // glazed upper half: a dim lit room behind blinds (not a light box)
  B.block('glow', 0, 40, 0, L - 2, 32, W - 2, '#ffffff', null, { emissive: 0.5, uv: atlasUV('winBlind') });
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', (x * (L - 3)) / 2, 40, (z * (W - 3)) / 2, 3.5, 34, 3.5, shadeHex(color, -0.2), null, { surf: [DET.panel, 0.5, 0.4] });
  B.rblock('std', 0, 74, 0, L + 10, 5, W + 10, 1, roof || '#44493c', null, { surf: [DET.panel, 0.6, 0.3] });
  B.block('std', 0, 79, 0, L - 4, 11, W - 4, shadeHex(color, -0.1), null, { surf: [DET.concrete, 0.85, 0] });
  B.box('blink', 0, 92, 0, 4, 4, 4, '#ff3a2a', null, { emissive: 3 });
  B.box('glow', L / 2 + 1, 30, 0, 0.4, 10, 20, '#ffffff', null, { emissive: 0.6, uv: atlasUV('stripeYB') });
}

export function rock(B, L, W, color, H) {
  B.add('std', T.dodeca(), [0, H * 0.32, 0], [L * 0.52, H * 0.75, W * 0.52], [0, B.rng.range(0, 6), 0], color, { wobble: { amp: 0.28, seed: Math.floor(B.rng.next() * 1000) }, surf: [DET.rock, 0.82, 0] });
  B.add('std', T.dodeca(), [L * 0.25, H * 0.15, W * 0.2], [L * 0.25, H * 0.4, W * 0.25], [0.3, 1, 0], shadeHex(color, -0.1), { wobble: { amp: 0.3, seed: 7 }, surf: [DET.rock, 0.82, 0] });
}

// ---- decor -----------------------------------------------------------------------------------------

/**
 * Street lamp: tapered galvanised pole on a footing, curved arm, a cobra head with a
 * glowing lens (emissive > 1: blooms). Floodlight masts (s > 1.1) carry a bank of lamps.
 * Returns the lamp head's local position (for halos / light shafts) or null when unlit.
 */
export function lampPost(B, d, lit, color) {
  const s = d.s || 1;
  const H = 230 * s;
  const S = [DET.panel, 0.48, 0.6];
  if (s > 1.1) {
    B.cyl('std', 0, 0, 0, 3.6, H, POLE, 10, 0.65, null, { surf: S });
    B.rblock('std', 0, 0, 0, 14, 7, 14, 1, CONCRETE, null, { surf: [DET.concrete, 0.85, 0] });
    B.box('std', 0, H, 0, 38, 3, 4, POLE, null, { surf: S });
    for (const x of [-13.5, -4.5, 4.5, 13.5]) {
      B.rbox('std', x, H - 5, 3, 8, 9, 5, 1, '#2a2c2e', [0.6, 0, 0], { surf: [DET.panel, 0.5, 0.5] });
      if (lit) B.box('glow', x, H - 7, 5.4, 6.8, 7, 0.5, color, [0.6, 0, 0], { emissive: 4.5, uv: atlasUV('white') });
    }
    return lit ? { x: 0, h: H - 6 } : null;
  }
  // foot 16 behind the head (the top-down convention); the arm reaches out along +x
  B.cyl('std', -16, 0, 0, 2.8, H - 6, POLE, 10, 0.62, null, { surf: S });
  B.rblock('std', -16, 0, 0, 8, 5, 8, 1, CONCRETE, null, { surf: [DET.concrete, 0.85, 0] });
  B.cyl('std', -16, 5, 0, 4, 3, '#2a2d30', 8, 0.8, null, { surf: S });
  // arm: rises from the pole top and bends out
  B.add('std', T.cyl(6), [-12.5, H - 7, 0], [1.3, 10, 1.3], [0, 0, -0.9], POLE, { surf: S, map: 'cyl' });
  B.add('std', T.cyl(6), [-3, H - 3.4, 0], [1.2, 12, 1.2], [0, 0, Math.PI / 2 - 0.08], POLE, { surf: S, map: 'cyl' });
  // cobra head: a long rounded housing tapering to the front, lens underneath
  B.rbox('std', 5, H - 3.6, 0, 17, 4.4, 8.4, 1.8, '#5a5e62', [0, 0, -0.06], { surf: [DET.panel, 0.4, 0.5] });
  B.rbox('std', 4, H - 1.4, 0, 12, 2, 6, 1, '#6a6e72', [0, 0, -0.06], { surf: [DET.panel, 0.4, 0.5] });
  if (lit) {
    B.box('glow', 5.4, H - 6.1, 0, 13, 0.6, 6.4, color, [0, 0, -0.06], { emissive: 5, uv: atlasUV('white') });
    return { x: 5.4, h: H - 8 };
  }
  B.box('glass', 5.4, H - 6.1, 0, 13, 0.6, 6.4, '#40444a', [0, 0, -0.06]);
  return null;
}

/**
 * Traffic signal (the map's 'signal' decor): a galvanised pole with a mast arm reaching
 * 150 × s along +x, signal heads hanging from it facing local -z. The power is out on this
 * road: per pole (by `i`) the heads are dark, flash amber, flash red or flicker a failing
 * red. Glowing lenses get a halo (same blink phase as the 'blink' material).
 * @param {object} B geo builder (frame at the pole)
 * @param {object} d decor { x, y, a, s }
 * @param {number} i decor index (picks the failure)
 * @param {object[]} halos the world's halo list
 */
export function trafficSignal(B, d, i, halos) {
  const s = d.s || 1;
  const len = 150 * s;
  const S = [DET.panel, 0.48, 0.6];
  const H = 178;
  B.cyl('std', 0, 0, 0, 3.4, H, POLE, 10, 0.8, null, { surf: S });
  B.rblock('std', 0, 0, 0, 10, 5, 10, 1, CONCRETE, null, { surf: [DET.concrete, 0.85, 0] });
  B.cyl('std', 0, H, 0, 3.6, 3, '#50565a', 10, 0.6, null, { surf: S });
  // mast arm (tapered) and its tie rod
  B.add('std', T.cyl(8, 0.55), [len / 2, H - 12, 0], [2.6, len, 2.6], [0, 0, -Math.PI / 2], POLE, { surf: S, map: 'cyl' });
  const brace = Math.hypot(len * 0.45, 20);
  B.add('std', T.cyl(5), [len * 0.225, H - 2, 0], [0.8, brace, 0.8], [0, 0, Math.atan2(len * 0.45, 20)], POLE, { surf: S, map: 'cyl' });
  // push-button box and a controller cabinet at the foot
  B.rbox('std', 3.8, 44, 0, 3, 7, 5, 0.8, '#c8a51c', null, { surf: [DET.panel, 0.5, 0.2] });
  const mode = signalMode(i);
  const heads = Math.max(1, Math.round(len / 72));
  const ca = Math.cos(d.a || 0), sa = Math.sin(d.a || 0);
  for (let k = 0; k < heads; k++) {
    const hx = len * (heads === 1 ? 0.8 : 0.42 + (0.55 * k) / (heads - 1));
    const top = H - 14;
    const hy = top - 18;   // head centre (the head hangs 32 tall under the arm)
    B.box('std', hx, top - 1, 0, 1.6, 4, 1.6, '#2a2c2e', null, { surf: S });
    B.rblock('std', hx, top - 34, 0, 11, 32, 9, 1.4, '#22251f', null, { surf: [DET.plastic, 0.6, 0.1] });
    // backplate behind the head with a reflective border seen by the traffic (local -z)
    B.box('std', hx, hy, 5, 17, 38, 1, '#161816', null, { surf: [DET.plastic, 0.7, 0] });
    B.box('glow', hx, hy, 4.4, 17.4, 38.4, 0.2, '#e8e0a0', null, { emissive: 0.18, uv: atlasUV('white'), noAO: true });
    const lenses = [['#ff2a1a', 10], ['#ffae1a', 0], ['#2aff8a', -10]];
    lenses.forEach(([col, dy], j) => {
      const on = (mode === 'amber' && j === 1) || ((mode === 'red' || mode === 'failing') && j === 0);
      // visor
      B.add('std', T.cyl(10, 1, true), [hx, hy + dy + 1.5, -6.5], [4.4, 5, 4.4], [Math.PI / 2, 0, 0], '#1a1c19', { surf: [DET.plastic, 0.6, 0] });
      if (on) {
        const bucket = mode === 'failing' ? 'flicker' : 'blink';
        const o = bucket === 'flicker' ? { emissive: 3.4, uv: atlasUV('white'), noAO: true } : { emissive: 3.4, noAO: true };
        B.add(bucket, T.cyl(12), [hx, hy + dy, -4.7], [3.6, 0.6, 3.6], [Math.PI / 2, 0, 0], col, o);
        const wx = d.x + ca * hx + sa * 6, wy = d.y + sa * hx - ca * 6;
        halos.push({ x: wx, y: wy, h: hy + dy, color: col, size: 46, strength: 0.9, blink: mode === 'failing' ? 0 : 1, flicker: mode === 'failing' ? 1 : 0 });
      } else {
        B.add('glass', T.cyl(12), [hx, hy + dy, -4.7], [3.6, 0.6, 3.6], [Math.PI / 2, 0, 0], shadeHex(col, -0.8));
      }
    });
  }
}

/** Roadside price pylon (the map's 'pylon' decor): two posts and a lit sign box on top. */
export function pricePylon(B, d) {
  const s = d.s || 1;
  const S = [DET.rust, 0.45, 0.85];
  for (const x of [-14 * s, 14 * s]) B.cyl('std', x, 0, 0, 2.4, 150 * s, '#7a7e82', 8, 1, null, { surf: S });
  B.rblock('std', 0, 0, 0, 44 * s, 6, 12, 1, CONCRETE, null, { surf: [DET.concrete, 0.85, 0] });
  const w = 46 * s, h = 70 * s, y0 = 146 * s;
  B.rblock('std', 0, y0, 0, w + 4, h + 4, 9, 1.5, '#2c2f33', null, { surf: [DET.panel, 0.5, 0.6] });
  for (const f of [-1, 1]) {
    B.add('glow', T.plane(), [0, y0 + 2 + h / 2, f * 4.7], [w, h, 1], [0, f > 0 ? 0 : Math.PI, 0], '#ffffff', { emissive: 1.1, uv: atlasUV('gasSign'), noAO: true });
  }
}

/** Traffic cone (upright or knocked over) with retro-reflective bands. */
export function cone(B, d) {
  const s = d.s || 1;
  const R = 6 * s;
  const r = B.rng;
  const orange = '#e8641c';
  const S = [DET.plastic, 0.55, 0];
  if (r.chance(0.3)) {
    B.add('std', T.cyl(12, 0.18), [0, R * 0.8, 0], [R, R * 3, R], [0, r.range(0, 6), Math.PI / 2], orange, { surf: S, map: 'cyl' });
    return;
  }
  B.rblock('std', 0, 0, 0, R * 2.1, 1.5, R * 2.1, 0.4, '#1c1c1c', null, { surf: [DET.rubber, 0.8, 0] });
  B.cyl('std', 0, 1.5, 0, R * 0.95, R * 3, orange, 12, 0.18, null, { surf: S });
  B.cyl('glow', 0, R * 1.2, 0, R * 0.7, R * 0.45, '#ffffff', 12, 0.8, null, { emissive: 0.7, uv: atlasUV('white') });
  B.cyl('glow', 0, R * 2.0, 0, R * 0.46, R * 0.3, '#ffffff', 12, 0.75, null, { emissive: 0.7, uv: atlasUV('white') });
}

/** Loose tyre(s): lying flat or stacked. */
export function tires(B, d) {
  const s = d.s || 1;
  const R = 7.5 * s;
  const r = B.rng;
  const stack = r.chance(0.35) ? 2 + Math.floor(r.next() * 2) : 1;
  for (let k = 0; k < stack; k++) {
    B.add('std', T.lathe('tyre', TYRE_PROFILE, 18), [r.range(-1, 1), R * 0.45 + k * R * 0.9, r.range(-1, 1)], [R, R * 0.9, R], [r.range(-0.08, 0.08), r.range(0, 6), r.range(-0.08, 0.08)], RUBBER, { surf: [DET.rubber, 0.85, 0], map: 'cyl' });
  }
  if (stack === 1 && r.chance(0.4)) B.add('std', T.lathe('tyre', TYRE_PROFILE, 18), [R * 1.6, R, 0], [R, R * 0.9, R], [Math.PI / 2 - 0.25, r.range(0, 6), 0], RUBBER, { surf: [DET.rubber, 0.85, 0], map: 'cyl' });
}

/** Rubble heap: broken concrete and brick chunks, a bent rebar or pipe. */
export function rubble(B, d) {
  const s = d.s || 1;
  const R = 22 * s;
  const r = B.rng;
  for (let k = 0; k < 13; k++) {
    const sz = r.range(3, 10) * s;
    const brick = r.chance(0.3);
    B.add('std', r.chance(0.5) ? T.box() : T.dodeca(), [r.range(-R, R) * 0.8, sz * 0.3, r.range(-R, R) * 0.7], [sz * r.range(1, 2), sz, sz * r.range(0.8, 1.5)], [r.range(0, 1), r.range(0, 6), r.range(0, 1)],
      brick ? r.pick(['#7a3a2c', '#8a4a34']) : r.pick(['#7a766e', '#5f5b54', '#8d887d', '#6b5a48']), { surf: [brick ? DET.brick : DET.concrete, 0.9, 0] });
  }
  for (let k = 0; k < 2; k++) B.add('std', T.cyl(5), [r.range(-R, R) * 0.5, 4, r.range(-R, R) * 0.5], [0.6, R * 1.4, 0.6], [r.range(-0.4, 0.4), r.range(0, 3), 1.3], '#6a4a38', { surf: [DET.rust, 0.7, 0.8], map: 'cyl' });
}

/** Scattered debris: bits of sheet metal, planks, a bucket, a crate. */
export function debris(B, d) {
  const s = d.s || 1;
  const r = B.rng;
  const n = 2 + Math.floor(r.next() * 3);
  for (let k = 0; k < n; k++) {
    const roll = r.next();
    const x = r.range(-10, 10) * s, z = r.range(-10, 10) * s;
    if (roll < 0.35) B.box('std', x, 0.6, z, r.range(8, 16) * s, 0.8, r.range(3, 6) * s, r.pick(['#5a4632', '#6b5a44', '#4a3a2a']), [r.range(-0.1, 0.1), r.range(0, 6), r.range(-0.08, 0.08)], { surf: [DET.wood, 0.85, 0] });
    else if (roll < 0.65) B.box('std', x, 0.5, z, r.range(8, 14) * s, 0.5, r.range(6, 10) * s, r.pick(['#5a5e62', '#6a3a2a', '#3a4a5a']), [r.range(-0.15, 0.15), r.range(0, 6), r.range(-0.15, 0.15)], { surf: [DET.rust, 0.6, 0.7] });
    else if (roll < 0.8) B.cyl('std', x, 0, z, 3.4 * s, 7 * s, r.pick(['#c43a2a', '#2a5ac4', '#e0c02a', '#e8e8e8']), 10, 0.85, null, { surf: [DET.plastic, 0.45, 0] });
    else B.add('std', T.pillow(9, 6, 0.55), [x, 3.6 * s, z], [5 * s, 4.2 * s, 4.6 * s], [0, r.range(0, 6), 0], '#141518', { wobble: { amp: 0.18, seed: k }, surf: [DET.plastic, 0.28, 0] });
  }
}

/** Road sign on two posts (exit / distances / speed limit). */
export function roadSign(B, d, i) {
  const s = d.s || 1;
  const Ls = 44 * s;
  const speed = hash01(i * 3 + 1) < 0.35;
  const S = [DET.rust, 0.45, 0.85];
  if (speed) {
    B.cyl('std', 0, 0, 0, 1.4, 60, '#7a7e82', 8, 1, null, { surf: S });
    B.box('std', 0, 60, -0.5, 16, 20, 0.8, '#8a8e92', null, { surf: [DET.panel, 0.5, 0.8] });
    B.add('decal', T.plane(), [0, 60, 0.1], [15.4, 19.4, 1], null, '#ffffff', { uv: atlasUV('speed'), noAO: true });
    return;
  }
  for (const x of [-Ls * 0.35, Ls * 0.35]) B.cyl('std', x, 0, 0, 1.6, 74, '#7a7e82', 8, 1, null, { surf: S });
  B.box('std', 0, 64, -0.6, Ls, 26, 1.2, '#8a8e92', null, { surf: [DET.panel, 0.5, 0.8] });
  const cell = hash01(i * 7 + 2) < 0.5 ? 'sign' : 'roadSign';
  // retro-reflective sheeting: lit by the flashlight, a little by itself
  B.add('glow', T.plane(), [0, 64, 0.1], [Ls - 1, 25, 1], null, '#ffffff', { emissive: 0.4, uv: atlasUV(cell) });
}

/** A few blades of grass (the map's grass_tuft decor). */
export function grassTuft(B, d, i) {
  const s = d.s || 1;
  const r = B.rng;
  const n = 6 + (i % 5);
  for (let k = 0; k < n; k++) {
    const h = r.range(7, 16) * s;
    B.add('std', T.blade(), [r.range(-5, 5) * s, 0, r.range(-5, 5) * s], [r.range(1.4, 2.4), h, 1], [r.range(-0.35, 0.35), r.range(0, 6.28), r.range(-0.35, 0.35)], r.pick(GRASS), { noAO: true, surf: [0, 0.9, 0] });
  }
}
