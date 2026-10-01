// Hollow Creek, sections 1 and 2: the town line (the rail line and the stopped freight, the crossing, the
// water tower, the welcome sign, the feed store, the sheriff's cars, the barricade across Main Street) and
// Main Street (the Bijou, the post office, Miller's Hardware and the diner inside and out, the fountain,
// the memorial, the festival bunting, the acorn lamps, the town's last stand at the west end).

import * as THREE from 'three';
import {
  atlasUV, T, S, WOOD, RUSTY, METAL, CORR, CONC, FABRIC, PLAST, RUBBER, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, rod, plank, sign, sign2, shelfRow, decal, floorDecal, glowBox, crate, carton, drum, tyre, toWorld, lvUV, litter, pendant, tubeFixture,
} from './millroad-kit.js';
import { lvSub } from './millroad-atlas.js';
import { wheel } from './millroad-jam.js';
import { building } from '../world-bld.js';
import { buildVehicle } from '../world-veh.js';

const GLASS = { noJitter: true, surf: [0, 0.06, 0] };

/** A lamp that is lit at night and plain glass by day. */
function lamp(P, bucketNight, x, y, z, sx, sy, sz, color, dayColor = '#d8dcd8') {
  const { B } = P;
  if (P.day) B.add('std', T.sphere(10, 8), [x, y, z], [sx, sy, sz], null, dayColor, { noJitter: true, surf: [0, 0.15, 0] });
  else B.add(bucketNight, T.sphere(10, 8), [x, y, z], [sx, sy, sz], null, color, { emissive: 3.2, uv: atlasUV('white'), noAO: true, noJitter: true });
}

// ---- the rail line --------------------------------------------------------------------------------------------

/** The track: ballast shoulders, ties, tie plates and two rails (along local x, `len` long). */
function rails(P) {
  const { B, o } = P;
  const len = o.len, r = B.rng;
  const G = 18;
  B.box('std', 0, 1.5, 0, len, 3, 58, '#6a665e', null, { noJitter: true, surf: [DET.gravel, 0.95, 0] });
  const step = P.lod === 0 ? 30 : 17;
  for (let x = -len / 2 + 8; x < len / 2; x += step) {
    B.box('std', x + r.range(-1, 1), 3.6, r.range(-1, 1), 8, 2.4, 52, mixHex('#4a3a2a', '#5e4a36', r.next()), [0, r.range(-0.03, 0.03), 0], { noJitter: true, ...WOOD });
  }
  for (const s of [-1, 1]) {
    B.box('std', 0, 5.6, s * G, len, 2.2, 3, '#5a4a40', null, { noJitter: true, ...S(DET.rust, 0.6, 0.6) });
    B.box('std', 0, 7.2, s * G, len, 1.2, 2, '#a8a8a4', null, { noJitter: true, ...S(0, 0.3, 0.9) });
  }
}

/** The crossing: flashing signals with crossbucks and gate arms (one snapped), both sides of the road. */
function crossing(P) {
  const { B, o, halos } = P;
  const one = (x, z, face, broken) => {
    B.rblock('std', x, 0, z, 16, 6, 16, 1, '#a8a498', null, CONC);
    B.cyl('std', x, 6, z, 2.4, 110, '#c8ccce', 10, 1, null, CHROME);
    // the crossbuck
    for (const k of [-1, 1]) sign2(B, 'hc_crossbuck', x, 104, z, 70, 13, face, { rz: k * 0.62 });
    // the lamp heads, back plate and hoods
    B.box('std', x, 80, z, 44, 16, 2, '#1a1a1a', [0, face, 0], METAL);
    for (const s of [-1, 1]) {
      const [lx, lz] = [x + Math.cos(face) * s * 14 + Math.sin(face) * 3, z - Math.sin(face) * s * 14 + Math.cos(face) * 3];
      if (P.day) B.add('std', T.sphere(8, 6), [lx, 80, lz], [5, 5, 3], [0, face, 0], '#6a1a14', S(0, 0.2, 0));
      else {
        B.add('blink', T.sphere(8, 6), [lx, 80, lz], [5, 5, 3], [0, face, 0], '#ff2a10', { emissive: 3 });
        const [wx, wy] = toWorld(o, lx, lz);
        halos.push({ x: wx, y: wy, h: 80, color: '#ff3a1a', size: 40, blink: 1, strength: 0.6 });
      }
    }
    B.cyl('std', x, 112, z, 5, 5, '#1a1a1a', 10, 0.6, null, METAL);   // the bell
    // the gate mechanism and its arm (down across the lane, or snapped)
    B.rblock('std', x + Math.sin(face) * 10, 20, z + Math.cos(face) * 10, 12, 22, 12, 1, '#c8ccce', [0, face, 0], METAL);
    const dir = [Math.cos(face + HALF), -Math.sin(face + HALF)];
    const ax = x + Math.sin(face) * 12, az = z + Math.cos(face) * 12;
    const armLen = broken ? 58 : 130;
    const stripes = Math.round(armLen / 10);
    for (let k = 0; k < stripes; k++) {
      const t0 = (k + 0.5) * (armLen / stripes);
      B.add('std', T.box(), [ax + dir[0] * t0, 32 - (broken ? 0 : 0), az + dir[1] * t0], [armLen / stripes, 3, 2.4], [0, face + HALF, 0], k % 2 ? '#f0f0ea' : '#c62828', PLAST);
    }
    if (broken) B.add('std', T.box(), [ax + dir[0] * 100, 1.5, az + dir[1] * 100 + 6], [70, 3, 2.4], [0, face + HALF + 0.3, 0], '#f0f0ea', PLAST);
  };
  // westbound (north lane) signal faces east; eastbound (south lane) faces west
  one(62, -172, HALF, true);
  one(-62, 172, -HALF, false);
  // the advance warning disc and the tracks' plank crossing
  sign2(B, 'hc_rrx', 420, 70, -186, 28, 28, HALF);
  B.cyl('std', 420, 0, -186, 1.4, 58, '#9aa0a4', 8, 1, null, CHROME);
  for (const s of [-1, 1]) B.box('std', 0, 6.6, s * 0, 36, 1.6, 260, '#3a3632', null, { noJitter: true, surf: [DET.asphalt, 0.9, 0] });
}

/** Wheels of a rail truck (two axles), the side frames. */
function railTruck(B, x, W) {
  for (const sd of [-1, 1]) {
    B.box('std', x, 12, sd * (W / 2 - 7), 44, 8, 4, '#2a2624', null, RUSTY);
    for (const dx of [-12, 12]) B.add('std', T.cyl(14), [x + dx, 10, sd * (W / 2 - 11)], [10, 3, 10], [HALF, 0, 0], '#2a2624', { ...RUSTY, map: 'cyl' });
  }
  B.box('std', x, 17, 0, 12, 6, W - 14, '#2a2624', null, RUSTY);
}

/** A boxcar stopped on the line: ribbed sides, the sliding door (one side open), roofwalk, ladders, lettering. */
function boxcar(P) {
  const { B, o } = P;
  const L = o.w, W = o.h, r = B.rng;
  const col = o.color || '#6a3a2a';
  const seed = Math.round(o.x + o.y);
  for (const s of [-1, 1]) railTruck(B, s * (L / 2 - 34), W);
  B.box('std', 0, 22, 0, L - 6, 6, W - 10, '#1e1c1a', null, RUSTY);
  const y0 = 25, H = 74;
  B.rblock('std', 0, y0, 0, L, H, W, 1.5, col, null, S(DET.rust, 0.75, 0.35));
  B.add('std', T.box(), [0, y0 + H + 2, 0], [L, 4, W * 0.72], null, shadeHex(col, -0.15), S(DET.rust, 0.7, 0.4));
  const openSide = hash01(seed) < 0.5 ? 1 : -1;
  for (const sd of [-1, 1]) {
    const z = sd * (W / 2 + 0.2);
    // ribs
    if (P.lod >= 1) for (let x = -L / 2 + 8; x < L / 2; x += 15) if (Math.abs(x) > 34) B.box('std', x, y0 + H / 2, z + sd * 0.8, 2.4, H - 4, 1.6, shadeHex(col, -0.12), null, S(DET.rust, 0.7, 0.4));
    // the door: slid open (a dark hole, the door beside it) or shut
    const open = sd === openSide;
    if (open) {
      B.box('std', 0, y0 + H / 2 - 2, z - sd * 0.5, 60, H - 8, 1, '#0a0908', null, NJ);
      B.box('std', 62, y0 + H / 2 - 2, z + sd * 1.8, 60, H - 6, 2, shadeHex(col, 0.06), null, S(DET.rust, 0.7, 0.4));
    } else B.box('std', 0, y0 + H / 2 - 2, z + sd * 1.8, 60, H - 6, 2, shadeHex(col, 0.06), null, S(DET.rust, 0.7, 0.4));
    for (const y of [y0 + 2, y0 + H - 4]) B.box('std', open ? 30 : 0, y, z + sd * 2.6, 124, 2, 1.6, '#2a2624', null, RUSTY);
    // lettering and the herald (mirrored side: rotate)
    const ry = sd > 0 ? 0 : PI;
    const xs = sd > 0 ? 1 : -1;
    sign(B, 'hc_rrname', -xs * 76, y0 + H - 16, z + sd * 1.2, 92, 11.5, ry);
    sign(B, 'hc_herald', xs * 92, y0 + H / 2, z + sd * 1.2, 26, 26, ry);
    if (P.lod >= 2 && hash01(seed + sd * 3) < 0.7) decal(B, r.pick(['graf2', 'graf4', 'graf3', 'graf5', 'hc_church_graf']), -xs * 70, y0 + 24, z + sd * 1.4, 70, 26, ry);
    if (P.lod >= 1) decal(B, 'grime', r.range(-60, 60), y0 + H * 0.55, z + sd * 1.3, 120, H, ry);
  }
  // ladders at the corners, a brake wheel, the couplers, a roofwalk
  for (const s of [-1, 1]) {
    for (let y = y0 + 6; y < y0 + H; y += 9) B.box('std', s * (L / 2 + 1.2), y, W / 2 - 8, 1, 1, 10, '#2a2624', null, RUSTY);
    B.box('std', s * (L / 2 + 6), 22, 0, 12, 6, 8, '#1e1c1a', null, RUSTY);
  }
  B.add('std', T.torus(10, 0.12, 4), [L / 2 + 1.6, y0 + H - 10, 0], [7, 7, 7], [0, HALF, 0], '#2a2624', RUSTY);
  if (P.lod >= 1) B.box('std', 0, y0 + H + 4.6, 0, L - 10, 1.2, 12, '#3a3632', null, S(DET.rust, 0.7, 0.4));
}

/** A tank car: the barrel on its frame, the dome and valves, a walkway, the hazmat placard. */
function tankcar(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  const col = '#1c1c1e';
  for (const s of [-1, 1]) railTruck(B, s * (L / 2 - 34), W);
  B.box('std', 0, 22, 0, L - 6, 6, W - 14, '#1e1c1a', null, RUSTY);
  const R = W / 2 - 3;
  B.add('std', T.cyl(20), [0, 26 + R, 0], [R, L - 26, R], [0, 0, HALF], col, { ...S(DET.panel, 0.45, 0.5), map: 'cyl' });
  for (const s of [-1, 1]) B.add('std', T.sphere(14, 8), [s * (L / 2 - 13), 26 + R, 0], [12, R, R], null, col, S(DET.panel, 0.45, 0.5));
  B.cyl('std', 0, 26 + 2 * R - 4, 0, 11, 12, '#2a2a2c', 14, 1, null, METAL);
  B.box('std', 0, 26 + 2 * R + 8, 0, 44, 1.4, 18, '#3a3632', null, METAL);
  for (const s of [-1, 1]) for (const x of [-20, 20]) rod(B, 'std', [x, 26 + 2 * R + 8, s * 9], [x, 26 + 2 * R + 20, s * 9], 0.5, '#8a8e92', CHROME, 4);
  for (const sd of [-1, 1]) {
    sign(B, 'hc_placard', 0, 26 + R, sd * (R + 0.4), 24, 24, sd > 0 ? 0 : PI);
    sign(B, 'hc_rrname', sd * 50, 26 + R + 12, sd * (R * 0.94 + 0.6), 70, 9, sd > 0 ? 0 : PI, { rx: sd * -0.35 });
    if (P.lod >= 1) decal(B, 'grime', 0, 26 + R, sd * (R + 0.6), L * 0.8, R * 1.6, sd > 0 ? 0 : PI);
  }
}

// ---- the water tower, the welcome sign, the feed store, the cruisers ---------------------------------------------

/** The town's water tower: four raking legs with bracing, the riser, the tank with its balcony and cone, the name. */
function watertower(P) {
  const { B } = P;
  const legs = [[-44, -44], [44, -44], [44, 44], [-44, 44]];
  const top = 196;
  const steel = '#9aa4a8';
  const mo = { ...S(DET.panel, 0.5, 0.5) };
  const tip = ([x, z]) => [x * 0.78, top, z * 0.78];
  for (const l of legs) {
    rod(B, 'std', [l[0], 0, l[1]], tip(l), 4.2, steel, mo, 10);
    B.rblock('std', l[0], 0, l[1], 18, 8, 18, 1, '#a8a498', null, CONC);
  }
  // bracing: horizontal struts and X rods on each face at two levels
  for (let i = 0; i < 4; i++) {
    const a = legs[i], b = legs[(i + 1) % 4];
    for (const [f0, f1] of [[0.12, 0.5], [0.5, 0.88]]) {
      const pa0 = [a[0] * (1 - 0.22 * f0), top * f0, a[1] * (1 - 0.22 * f0)], pb0 = [b[0] * (1 - 0.22 * f0), top * f0, b[1] * (1 - 0.22 * f0)];
      const pa1 = [a[0] * (1 - 0.22 * f1), top * f1, a[1] * (1 - 0.22 * f1)], pb1 = [b[0] * (1 - 0.22 * f1), top * f1, b[1] * (1 - 0.22 * f1)];
      rod(B, 'std', pa0, pb0, 2, steel, mo, 6);
      if (P.lod >= 1) { rod(B, 'std', pa0, pb1, 0.8, steel, mo, 4); rod(B, 'std', pb0, pa1, 0.8, steel, mo, 4); }
    }
  }
  B.cyl('std', 0, 0, 0, 6, top, steel, 12, 1, null, mo);
  // the tank: a bowl, the drum, the balcony, the cone, the finial
  const R = 58, y0 = top + 4, H = 84;
  B.add('std', T.sphere(24, 12), [0, y0 + 2, 0], [R, 44, R], null, '#c8d0d2', S(DET.panel, 0.5, 0.45));
  B.cyl('std', 0, y0 + 2, 0, R, H, '#d0d6d8', 28, 1, null, S(DET.panel, 0.5, 0.45));
  B.add('std', T.cyl(28, 0.06), [0, y0 + H + 22, 0], [R + 3, 40, R + 3], null, '#b8c0c4', { ...S(DET.metalroof, 0.5, 0.5), map: 'cyl' });
  B.cyl('std', 0, y0 + H + 41, 0, 2.4, 12, '#8a8e92', 8, 1, null, CHROME);
  B.cyl('std', 0, y0 + 10, 0, R + 7, 1.4, '#8a9296', 28, 1, null, METAL);
  if (P.lod >= 1) {
    const n = 32;
    for (let k = 0; k < n; k++) { const a = (k / n) * PI * 2; B.cyl('std', Math.cos(a) * (R + 6), y0 + 11, Math.sin(a) * (R + 6), 0.6, 18, steel, 4, 1, null, mo); }
    B.add('std', T.torus(36, 0.01, 3), [0, y0 + 29, 0], [R + 6, R + 6, R + 6], [HALF, 0, 0], steel, mo);
  }
  // the ladder up a leg and the tank
  const [lx, lz] = [44, 44];
  for (let y = 8; y < top; y += 10) { const f = y / top; B.box('std', lx * (1 - 0.22 * f) + 5, y, lz * (1 - 0.22 * f) + 5, 8, 1, 1, steel, [0, -PI / 4, 0], mo); }
  // the name, twice round the drum (sliced over facets)
  const n = 14, span = 1.45;
  for (const th0 of [-span / 2, PI - span / 2]) {
    for (let k = 0; k < n; k++) {
      const th = th0 + ((k + 0.5) / n) * span;
      const wdt = 2 * (R + 0.6) * Math.tan(span / n / 2) + 0.4;
      B.add('lvsign', T.plane(), [Math.sin(th) * (R + 0.6), y0 + H * 0.62, Math.cos(th) * (R + 0.6)], [wdt, 24, 1], [0, th, 0], '#ffffff', { uv: lvSub('hc_town', k / n, 0, (k + 1) / n, 1), noAO: true, noJitter: true });
    }
  }
  if (P.lod >= 1) for (let k = 0; k < 6; k++) { const th = (k / 6) * PI * 2 + 0.3; decal(B, 'grime', Math.sin(th) * (R + 0.8), y0 + H * 0.4, Math.cos(th) * (R + 0.8), 40, H * 1.1, th); }
}

/** WELCOME TO HOLLOW CREEK: the board between fieldstone piers, the flower bed, a spotlight, the wreck's damage. */
function welcome(P) {
  const { B } = P;
  for (const s of [-1, 1]) {
    B.rblock('std', s * 84, 0, 0, 18, 118, 18, 1.5, '#9a9282', null, { noJitter: true, surf: [DET.rock, 0.92, 0] });
    B.rblock('std', s * 84, 118, 0, 22, 5, 22, 1, '#a8a092', null, CONC);
  }
  B.box('std', 0, 88, 0, 152, 80, 4, '#2a4a36', null, { noJitter: true, ...WOOD });
  B.box('std', 0, 129, 0, 156, 3, 6, '#efe4c4', null, WOOD);
  B.box('std', 0, 47, 0, 156, 3, 6, '#efe4c4', null, WOOD);
  sign(B, 'hc_welcome', 0, 88, 2.1, 150, 76, 0);
  decal(B, 'graf3', 0, 88, -2.2, 120, 44, PI);
  // the flower bed (gone to weeds), a spotlight on a stake
  B.rblock('std', 0, 0, 30, 170, 6, 34, 2, '#5a4a36', null, { noJitter: true, surf: [DET.dirt, 0.95, 0] });
  const r = B.rng;
  for (let i = 0; i < (P.lod >= 1 ? 40 : 12); i++) B.add('std', T.sphere(5, 4), [r.range(-80, 80), 7, r.range(18, 44)], [r.range(3, 6), r.range(2, 5), r.range(3, 6)], null, r.pick(['#3a5a2a', '#4a6a30', '#c8a020', '#a83a3a', '#e8e0d0']), { noJitter: true, surf: [DET.grass, 0.95, 0] });
  B.cyl('std', 40, 0, 50, 1, 10, '#2a2a2a', 6, 1, null, METAL);
  B.add('std', T.cyl(10), [40, 12, 48], [4, 6, 4], [-0.9, 0, 0], '#2a2a2c', METAL);
  // the cruiser went into the south pier: scraped stone, the board hanging, glass
  B.add('std', T.box(), [-78, 60, 8], [20, 10, 3], [0.3, 0.2, 0.6], '#9a9282', { noJitter: true, surf: [DET.rock, 0.92, 0] });
  if (P.lod >= 1) for (let k = 0; k < 10; k++) B.add('glass', T.box(), [r.range(-120, -40), 0.5, r.range(20, 80)], [r.range(2, 5), 0.3, r.range(2, 4)], [0, r.range(0, 6), 0], '#9ab4c0', S(0, 0.1, 0.2));
}

/** Creek Feed & Seed: the world's warehouse with the store's board, sacks of feed on pallets, a propane cage. */
function feedstore(P) {
  const { B, o } = P;
  building(B, o, o.w, o.h, null);
  const W = o.h, L = o.w;
  B.box('std', -L * 0.12, 116, W / 2 + 1.4, 230, 44, 2, '#6a2a22', null, WOOD);
  sign(B, 'hc_feed', -L * 0.12, 116, W / 2 + 2.6, 226, 42, 0);
  const r = B.rng;
  for (const [x, n] of [[L * 0.3, 14], [L * 0.38, 10]]) {
    B.box('std', x, 3, W / 2 + 26, 40, 6, 36, '#8a6a48', null, WOOD);
    for (let i = 0; i < n; i++) B.add('std', T.pillow(8, 5, 0.4), [x + ((i % 3) - 1) * 13, 10 + Math.floor(i / 6) * 8, W / 2 + 18 + (Math.floor(i / 3) % 2) * 16], [6.4, 4, 8.4], [0, r.range(-0.2, 0.2), 0], r.pick(['#e8dcc0', '#d8ccb0', '#c8b890']), FABRIC);
  }
  // the propane cage
  B.box('std', -L / 2 + 30, 30, W / 2 + 20, 40, 60, 24, '#8a8e92', null, CORR);
  sign(B, 'mr_flammable', -L / 2 + 30, 44, W / 2 + 32.4, 14, 14, 0);
}

/** A Hollow Creek police car (the world's sedan, black and white): white doors, the lettering, a light bar, a push bar. */
function cruiser(P) {
  const { B, o, halos } = P;
  const L = o.w, W = o.h;
  buildVehicle(B, { ...o, color: '#16181c' });
  const sag = o.wrecked ? -2.2 : 0;
  for (const sd of [-1, 1]) {
    B.box('paint', -0.02 * L, 20 + sag, sd * (W / 2 - 0.4), 0.46 * L, 13, 0.8, '#eceae4', null, { surf: [DET.panel, 0.4, 0.3] });
    sign(B, 'hc_cruiser', -0.02 * L, 21 + sag, sd * (W / 2 + 0.2), 0.44 * L, 10.5, sd > 0 ? 0 : PI);
    sign(B, 'hc_badge', 0.3 * L, 22 + sag, sd * (W / 2 - 1.6), 9, 9, sd > 0 ? 0 : PI);
  }
  // the light bar
  const y = 42.6 + sag;
  B.rblock('std', 0.04 * L, y, 0, 8, 2, W * 0.78, 0.6, '#1a1a1a', null, METAL);
  for (const [z, c] of [[-W * 0.2, '#ff2a1a'], [W * 0.2, '#2a5aff']]) {
    if (P.day || o.wrecked) B.rbox('std', 0.04 * L, y + 3.8, z, 7, 3.4, W * 0.3, 1, shadeHex(c, -0.35), null, S(0, 0.2, 0.1));
    else {
      B.add('blink', T.box(), [0.04 * L, y + 3.8, z], [7, 3.4, W * 0.3], null, c, { emissive: 3 });
      const [wx, wy] = toWorld(o, 0.04 * L, z);
      halos.push({ x: wx, y: wy, h: y + 4, color: c, size: 70, blink: 1, strength: 0.7 });
    }
  }
  // the push bar
  B.box('std', L / 2 + 3, 13 + sag, 0, 2, 14, W * 0.6, '#1a1a1a', null, METAL);
  for (const s of [-1, 1]) B.box('std', L / 2 + 1, 13 + sag, s * W * 0.2, 5, 16, 2, '#1a1a1a', null, METAL);
}

// ---- the barricade ---------------------------------------------------------------------------------------------

/** The Main Street barricade (the gate): a steel frame faced with plywood and corrugated sheet, sandbags, the sign. */
function barricade(P) {
  const { B, o } = P;
  const L = o.w, t = o.h, r = B.rng;
  const H = 130;
  for (let x = -L / 2 + 6; x <= L / 2 - 6; x += (L - 12) / 5) {
    B.box('std', x, H / 2, 6, 6, H, 6, '#3a3c3e', null, RUSTY);
    if (P.lod >= 1) plank(B, 'std', [x, H - 8, 8], [x, 4, t / 2], 5, 3, '#3a3c3e', RUSTY);
  }
  const n = Math.max(3, Math.round(L / 44));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const wood = r.chance(0.55);
    B.block('std', x, 16, -4 + r.range(-2, 2), L / n + 4, H - 16 - r.range(0, 22), 2.4, wood ? r.pick(['#a8844e', '#b9955a', '#9a7a4e']) : r.pick(['#7a8488', '#8a7a62', '#6a7478']), [0, r.range(-0.05, 0.05), r.range(-0.04, 0.04)], wood ? WOOD : CORR);
    if (P.lod >= 2 && r.chance(0.35)) decal(B, r.pick(['graf2', 'xcode', 'graf4']), x, 70, -6.6, L / n * 1.1, 24, PI);
  }
  for (let x = -L / 2 + 8; x < L / 2 - 6; x += 16) {
    for (let k = 0; k < 2; k++) B.add('std', T.pillow(8, 5, 0.4), [x + (k ? 8 : 0), 4 + k * 7.5, -t / 2 + 2], [8.4, 4, 7], [0, r.range(-0.1, 0.1), 0], mixHex('#8a7a55', '#6a5e40', r.next()), FABRIC);
  }
  // TOWN CLOSED on the outside, razor wire along the top
  B.box('std', -L * 0.18, 84, -8.6, 76, 38, 1.6, '#b9955a', null, WOOD);
  sign(B, 'hc_closed', -L * 0.18, 84, -9.6, 74, 37, PI);
  if (P.lod >= 1) for (let x = -L / 2 + 8; x < L / 2; x += 14) B.add('std', T.torus(8, 0.05, 3), [x, H + 2, 0], [8, 8, 8], [0, HALF + 0.2, 0], '#8a8e92', CHROME);
}

/** The town side of the barricade: two scaffold lookouts with searchlights, a ladder, a generator, fuel cans. */
function barricadeback(P) {
  const { B, o, halos } = P;
  const r = B.rng;
  for (const s of [-1, 1]) {
    const x = s * 196, z = 46;
    for (const [dx, dz] of [[-22, -18], [22, -18], [-22, 18], [22, 18]]) B.box('std', x + dx, 60, z + dz, 3, 120, 3, '#8a8e92', null, CHROME);
    for (const y of [40, 118]) {
      B.box('std', x, y, z - 18, 44, 2, 2, '#8a8e92', null, CHROME);
      B.box('std', x, y, z + 18, 44, 2, 2, '#8a8e92', null, CHROME);
    }
    B.box('std', x, 118, z, 48, 2.4, 40, '#6a4a30', null, WOOD);
    for (let k = 0; k < 4; k++) B.add('std', T.pillow(8, 5, 0.4), [x - 16 + k * 10.6, 122, z - 17], [5.6, 4, 5], null, '#7a6a48', FABRIC);
    for (let y = 8; y < 118; y += 10) B.box('std', x + 25, y, z + 6, 1, 1, 12, '#8a8e92', null, CHROME);
    // the searchlight aimed out over the barricade
    B.cyl('std', x, 120, z, 2, 10, '#2a2a2c', 8, 1, null, METAL);
    B.add('std', T.cyl(12), [x, 134, z - 2], [8, 12, 8], [HALF + 0.25, 0, 0], '#3a3c3e', { ...METAL, map: 'cyl' });
    if (!P.day) {
      glowBox(B, x, 136, z - 9, 12, 12, 1, '#f0f4ff', 3);
      const [wx, wy] = toWorld(o, x, z - 12);
      halos.push({ x: wx, y: wy, h: 136, color: '#e8f0ff', size: 90, strength: 0.7 });
    }
  }
  B.rblock('std', 60, 0, 70, 30, 20, 18, 2, '#c83a1a', null, METAL);
  for (let i = 0; i < 4; i++) B.rblock('std', 90 + i * 9, 0, 66 + r.range(-4, 4), 7, 12, 11, 1, '#c8281e', [0, r.range(-0.3, 0.3), 0], PLAST);
  for (let i = 0; i < 30; i++) B.add('std', T.cyl(6), [r.range(-200, 200), 0.6, r.range(20, 80)], [0.7, 2.4, 0.7], [HALF, r.range(0, 6), 0], '#c8a040', { ...S(0, 0.3, 0.9), map: 'cyl' });
}

// ---- Main Street ---------------------------------------------------------------------------------------------------

/** The Bijou: the world's shop building with a marquee over the sidewalk, bulbs, the blade sign, poster cases. */
function theater(P) {
  const { B, o, halos } = P;
  building(B, o, o.w, o.h, null);
  const W = o.h;
  const z0 = W / 2;
  // the marquee: a box over the doors with letterboards both angled sides, bulbs round the edge
  B.rblock('std', 0, 104, z0 + 26, 210, 34, 52, 2, '#8a1a1a', null, S(DET.panel, 0.5, 0.4));
  for (const s of [-1, 1]) {
    sign(B, 'hc_bijou', 0, 121, z0 + 26 + s * 26.4, 196, 30, s > 0 ? 0 : PI);
    sign(B, 'hc_bijou', s * 105.4, 121, z0 + 26, 50, 30, s * HALF, { uv: lvSub('hc_bijou', 0, 0, 0.25, 1) });
  }
  B.box('std', 0, 102.4, z0 + 26, 214, 3, 56, '#e8c060', null, S(DET.panel, 0.4, 0.6));
  if (P.lod >= 1) {
    for (let x = -100; x <= 100; x += 10) {
      lamp(P, 'glow', x, 101, z0 + 53, 1.6, 1.6, 1.6, '#fff0c0', hash01(x) < 0.3 ? '#4a4a48' : '#d8d4c4');
    }
  }
  if (!P.day) for (const x of [-60, 0, 60]) { const [wx, wy] = toWorld(o, x, z0 + 50); halos.push({ x: wx, y: wy, h: 100, color: '#ffd9a0', size: 90, strength: 0.5 }); }
  // the blade sign up the front
  B.box('std', 0, 190, z0 + 14, 4, 130, 28, '#6a1a1a', null, METAL);
  for (const s of [-1, 1]) (P.day ? sign : (b, c, x, y, z, w, h, ry) => sign(b, c, x, y, z, w, h, ry, { bucket: 'lvglow' }))(B, 'hc_bijouv', s * 2.2, 190, z0 + 14, 26, 120, s * HALF);
  // poster cases each side of the doors, the ticket booth
  for (const s of [-1, 1]) {
    B.box('std', s * 80, 52, z0 + 1.6, 30, 44, 2.4, '#e8c060', null, METAL);
    sign(B, s > 0 ? 'hc_movie1' : 'hc_movie2', s * 80, 52, z0 + 3, 26, 39, 0);
  }
  B.rblock('std', 0, 0, z0 + 10, 30, 64, 20, 1.5, '#8a1a1a', null, S(DET.panel, 0.5, 0.4));
  B.box('vglass', 0, 48, z0 + 20.4, 24, 22, 0.4, '#8fa2ac', null, GLASS);
}

/** The post office: the world's shop building with its lettering, the flagpole and flag, a blue collection box. */
function postoffice(P) {
  const { B, o } = P;
  building(B, o, o.w, o.h, null);
  const W = o.h, L = o.w;
  B.box('std', 0, 150, W / 2 + 1.2, 300, 30, 2, '#e8e2d4', null, CONC);
  sign(B, 'hc_post', 0, 150, W / 2 + 2.4, 296, 28, 0);
  B.cyl('std', L / 2 - 30, 0, W / 2 + 40, 1.6, 230, '#c8ccce', 10, 1, null, CHROME);
  B.add('std', T.sphere(6, 4), [L / 2 - 30, 231, W / 2 + 40], [2.4, 2.4, 2.4], null, '#e8c060', METAL);
  sign2(B, 'hc_flag', L / 2 - 30 + 30, 206, W / 2 + 40, 58, 38, 0, { rz: -0.05 });
  B.rblock('std', -L / 2 + 50, 0, W / 2 + 40, 20, 40, 18, 5, '#1a3a8a', null, METAL);
  B.add('std', T.cyl(12, 1, false), [-L / 2 + 50, 40, W / 2 + 40], [9, 20, 10], [HALF, HALF, 0], '#1a3a8a', { ...METAL, map: 'cyl' });
}

/** Hardware shelving: a pegboard spine, shelves of stock on both faces, paint cans below (along local x). */
function hwshelf(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const H = 76;
  B.box('std', 0, 3, 0, L, 6, D, '#3a3c3e', null, METAL);
  B.box('std', 0, H / 2, 0, L, H, 2.4, '#b89a70', null, S(DET.panel, 0.7, 0));
  for (const s of [-1, 1]) {
    for (const y of [22, 42, 62]) {
      B.box('std', 0, y, s * D / 4, L, 1.4, D / 2 - 1, '#5a6a7a', null, METAL);
      shelfRow(B, ['shelfA', 'shelfB', 'shelfD', 'shelfB'], -L / 2 + 2, L / 2 - 2, y + 8, s * (D / 2 - 1.5), 15, s > 0 ? 0 : PI, 60);
    }
    // paint cans on the bottom deck, some knocked into the aisle
    for (let x = -L / 2 + 8; x < L / 2 - 4; x += 10) if (r.chance(0.75)) B.cyl('std', x, 6, s * (D / 2 - 6), 4, 9, r.pick(['#e8e4dc', '#c8281e', '#2a5ab0', '#e0b020', '#3a8a4a']), 10, 1, null, S(0, 0.4, 0.6));
    if (P.lod >= 1) for (let k = 0; k < 4; k++) B.add('std', T.cyl(10), [r.range(-L / 2, L / 2), 4, s * (D / 2 + r.range(6, 30))], [4, 9, 4], [HALF, r.range(0, 6), 0], r.pick(['#e8e4dc', '#c8281e', '#2a5ab0']), { ...S(0, 0.4, 0.6), map: 'cyl' });
    if (P.lod >= 1) floorDecal(B, 'blood3', r.range(-L / 3, L / 3), s * (D / 2 + 22), 40, 26, r.range(0, 6), 0.6, r.pick(['#e8e8f0', '#8aa0ff', '#ffffff']));
  }
  // pegboard hooks on the ends: hammers and saws
  for (const s of [-1, 1]) {
    for (let k = 0; k < 5; k++) B.box('std', s * (L / 2 + 0.8), 30 + (k % 3) * 12, -8 + k * 4, 1.2, 8, 2, r.pick(['#c8281e', '#1a1a1a', '#e0b020']), null, PLAST);
  }
}

/** The hardware store's counter: the register, the key cutter, a jar of keys, a bell. */
function hwcounter(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 38, D, 1, '#8a6a48', null, WOOD);
  B.box('std', 0, 39, 0, L + 4, 2, D + 4, '#d8d0bc', null, S(0, 0.5, 0));
  B.rblock('std', -L * 0.25, 40, 0, 20, 12, 16, 1, '#3a3c3e', null, METAL);
  B.box('std', -L * 0.25, 44, 10, 16, 3, 8, '#2a2c2e', null, METAL);
  B.rblock('std', L * 0.2, 40, 0, 16, 10, 14, 1, '#6a7a8a', null, METAL);
  B.cyl('std', L * 0.38, 40, 4, 3, 7, '#c8d0d2', 10, 1, null, GLASS);
  B.cyl('std', L * 0.05, 40, -6, 2.2, 2, '#c8a040', 10, 0.5, null, CHROME);
}

/** Miller's Hardware round its walls: the fascia and awning outside, the sidewalk display, the aisle signs,
 *  the pegboard back wall, tube lights, the mess. */
function hwstuff(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  const zf = h / 2 + 7;
  sign(B, 'hc_hardware', 0, 125, zf + 0.6, 300, 30, 0);
  // a canvas awning over the glass, blue and white stripes
  for (let k = 0; k < 12; k++) B.add('std', T.box(), [-w * 0.42 + (k + 0.5) * (w * 0.84 / 12), 100, zf + 16], [w * 0.84 / 12, 1.2, 34], [0.42, 0, 0], k % 2 ? '#e8e4dc' : '#1f3a5a', FABRIC);
  sign(B, 'hc_sale', w * 0.28, 60, zf - 6.4, 60, 15, PI);
  // the sidewalk display: a wheelbarrow, bags of mulch, a rack of rakes
  B.rblock('std', w * 0.34, 10, zf + 22, 30, 10, 20, 3, '#2f7a3a', null, METAL);
  wheel(B, w * 0.34 + 18, 5, zf + 22, 3, 1);
  for (let i = 0; i < 6; i++) B.add('std', T.pillow(8, 5, 0.4), [-w * 0.36 + (i % 3) * 12, 4 + Math.floor(i / 3) * 7, zf + 18], [6, 3.6, 9], [0, r.range(-0.2, 0.2), 0], '#5a3a22', FABRIC);
  for (let k = 0; k < 6; k++) rod(B, 'std', [-w * 0.2 + k * 4, 0, zf + 12], [-w * 0.2 + k * 4 + 2, 64, zf + 6], 0.7, '#a8844e', WOOD, 4);
  // inside: the aisle signs over the shelves, tube lights, the pegboard back wall
  for (let k = 0; k < 3; k++) {
    const x = [-100, 20, 140][k];
    for (const s of [-1, 1]) B.add('lvsign', T.plane(), [x, 120, s * 0.6], [60, 15, 1], [0, s > 0 ? 0 : PI, 0], '#ffffff', { uv: lvSub('hc_aisles', k / 4, 0, (k + 1) / 4, 1), noAO: true, noJitter: true });
    rod(B, 'std', [x, 128, 0], [x, 146, 0], 0.3, '#2a2a2a', METAL, 3);
    tubeFixture(B, P.halos, x, 142, -60, 0, hash01(k + 7) < 0.3 ? 'dead' : hash01(k + 3) < 0.3 ? 'flicker' : 'lit');
  }
  B.box('std', 0, 70, -h / 2 + 8, w - 40, 90, 1.4, '#b89a70', null, S(DET.panel, 0.7, 0));
  for (let i = 0; i < (P.lod >= 1 ? 40 : 12); i++) B.box('std', r.range(-w / 2 + 30, w / 2 - 30), r.range(34, 110), -h / 2 + 9.4, r.range(2, 5), r.range(6, 16), 1.6, r.pick(['#c8281e', '#1a1a1a', '#e0b020', '#8a8e92', '#2a5ab0']), [0, 0, r.range(-0.3, 0.3)], METAL);
  // the step ladder, dropped stock, a blood trail to the back door
  plank(B, 'std', [w / 2 - 40, 0, -h / 2 + 30], [w / 2 - 44, 70, -h / 2 + 16], 20, 2, '#b8bcc0', METAL);
  litter(B, -w / 2 + 20, -h / 2 + 20, w / 2 - 20, h / 2 - 20, P.lod >= 1 ? 30 : 10, 0.6);
  if (P.lod >= 1) for (let k = 0; k < 5; k++) floorDecal(B, 'blood3', 110 + k * 4, -20 - k * 22, 16, 12, r.range(0, 6), 0.62);
}

/** The diner's counter: stainless front, laminate top, stools, the pie case, napkins and sugar, the register. */
function dinercounter(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  B.box('std', 0, 19, 0, L, 38, D, '#c8ccce', null, S(DET.panel, 0.3, 0.8));
  B.box('std', 0, 30, D / 2 + 0.4, L, 5, 1, '#b3261e', null, S(DET.panel, 0.4, 0.2));
  B.box('std', 0, 39.4, 4, L + 4, 2.4, D + 10, '#e8dcc8', null, S(0, 0.35, 0));
  B.box('std', 0, 38, D / 2 + 9, L + 4, 1.2, 1.4, '#c8ccce', null, CHROME);
  // stools: a chrome pedestal and a red vinyl seat (one knocked over)
  for (let x = -L / 2 + 22; x < L / 2 - 10; x += 34) {
    const z = D / 2 + 22;
    if (r.chance(0.12)) {
      B.add('std', T.cyl(14), [x, 7, z + 16], [7, 4, 7], [HALF, 0, r.range(0, 6)], '#b3261e', { ...FABRIC, map: 'cyl' });
      rod(B, 'std', [x - 10, 3, z + 10], [x + 12, 3, z + 22], 1.4, '#c8ccce', CHROME, 6);
      continue;
    }
    B.cyl('std', x, 0, z, 6, 1.4, '#c8ccce', 12, 1, null, CHROME);
    B.cyl('std', x, 1.4, z, 1.4, 22, '#c8ccce', 8, 1, null, CHROME);
    B.cyl('std', x, 23, z, 8, 4, '#b3261e', 14, 1, null, FABRIC);
    B.cyl('std', x, 23, z, 8.4, 1, '#c8ccce', 14, 1, null, CHROME);
  }
  // on top: the pie case, napkin dispensers, sugar, mugs, the register
  B.box('vglass', -L * 0.3, 50, 2, 34, 18, 20, '#8fa2ac', null, GLASS);
  B.box('std', -L * 0.3, 41.4, 2, 34, 1, 20, '#c8ccce', null, CHROME);
  for (let k = 0; k < 3; k++) B.cyl('std', -L * 0.3 - 10 + k * 10, 42, 2, 4.4, 2.4, r.pick(['#c89a4a', '#8a2a3a', '#e8d8a0']), 12, 1, null, S(0, 0.6, 0));
  for (let x = -L / 2 + 30; x < L / 2 - 20; x += 50) {
    B.rblock('std', x, 40.6, 8, 5, 6, 3, 0.5, '#c8ccce', null, CHROME);
    B.cyl('std', x + 8, 40.6, 8, 1.6, 5, '#e8e8e0', 8, 1, null, GLASS);
    if (r.chance(0.5)) B.cyl('std', x + r.range(12, 22), 40.6, r.range(0, 10), 2, 3.6, '#f0ece0', 10, 1, null, S(0, 0.4, 0));
  }
  B.rblock('std', L * 0.38, 40.6, -2, 16, 10, 12, 1, '#4a4c4e', null, METAL);
}

/** A booth by the window: two red vinyl benches facing across a table (the benches along local z). */
function booth(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - 7);
    B.rblock('std', x, 0, 0, 13, 16, D - 2, 1, '#8a1a1a', null, FABRIC);
    B.rblock('std', x - s * 1, 16, 0, 12, 4, D - 4, 1.8, '#b3261e', null, FABRIC);
    B.rblock('std', x + s * 5, 16, 0, 4, 26, D - 2, 1.8, '#b3261e', null, FABRIC);
    B.box('std', x + s * 5, 42.4, 0, 5, 1, D - 1, '#c8ccce', null, CHROME);
  }
  B.cyl('std', 0, 0, 0, 1.6, 26, '#c8ccce', 8, 1, null, CHROME);
  B.box('std', 0, 27, 0, L - 30, 1.6, D - 6, '#e8dcc8', null, S(0, 0.35, 0));
  B.box('std', 0, 26.8, 0, L - 29, 1.4, D - 5, '#c8ccce', null, CHROME);
  B.rblock('std', 0, 28, -D / 2 + 6, 8, 7, 4, 0.5, '#c8ccce', null, CHROME);
  for (let k = 0; k < 2; k++) {
    const z = r.range(-8, 12), x = (k ? 1 : -1) * 6;
    B.cyl('std', x, 27.8, z, 5, 0.6, '#f0ece0', 14, 1, null, S(0, 0.4, 0));
    if (r.chance(0.6)) B.cyl('std', x + 5, 27.8, z - 6, 1.8, 3.6, '#f0ece0', 10, 1, null, S(0, 0.4, 0));
  }
  B.cyl('std', 2, 27.8, 8, 1.2, 6, '#c8281e', 8, 0.5, null, PLAST);
}

/** The diner round its walls: the roof sign and EAT, the menu board, the back bar, the kitchen, fans, lights. */
function dinerstuff(P) {
  const { B, o, halos } = P;
  const w = o.w, h = o.h, r = B.rng;
  const zf = h / 2 + 6;
  // the roof sign: an enamel board on a frame, lit from below at night
  for (const s of [-1, 1]) B.box('std', s * 90, 146, zf - 14, 4, 34, 4, '#3a3c3e', null, METAL);
  B.rblock('std', 0, 138, zf - 12, 250, 64, 5, 2, '#efe6d0', null, METAL);
  sign(B, 'hc_diner', 0, 170, zf - 9.4, 246, 61, 0, P.day ? {} : { bucket: 'lvglow' });
  B.box('std', w / 2 - 20, 90, zf + 18, 3, 40, 34, '#b3261e', null, METAL);
  for (const s of [-1, 1]) sign(B, 'hc_eat', w / 2 - 20 + s * 1.7, 90, zf + 18, 32, 16, s * HALF, P.day ? {} : { bucket: 'lvglow' });
  if (!P.day) { const [wx, wy] = toWorld(o, 0, zf + 10); halos.push({ x: wx, y: wy, h: 170, color: '#ffe0b0', size: 140, strength: 0.5 }); }
  // the menu board over the pass, the back bar: coffee urns, the mixer, cups
  const zp = -50 + 5.4;
  sign(B, 'hc_menu', 60, 96, zp + 0.4, 60, 45, 0);
  B.box('std', 30, 21, zp + 10, 200, 42, 12, '#c8ccce', null, S(DET.panel, 0.3, 0.8));
  for (const x of [-30, -10]) { B.cyl('std', x, 42, zp + 10, 6, 22, '#c8ccce', 14, 1, null, CHROME); B.cyl('std', x, 64, zp + 10, 6.4, 2, '#1a1a1a', 14, 1, null, PLAST); }
  B.rblock('std', 20, 42, zp + 10, 10, 26, 10, 1, '#5aa0c8', null, S(0, 0.4, 0.3));
  for (let k = 0; k < 10; k++) B.cyl('std', 50 + (k % 5) * 7, 42 + Math.floor(k / 5) * 5, zp + 8, 2.4, 4.6, '#f0ece0', 10, 1, null, S(0, 0.4, 0));
  // the kitchen: the grill and the hood, the fryer, the prep table, shelves of cans
  const zk = -h / 2 + 22;
  B.box('std', -120, 19, zk, 90, 38, 30, '#8a8e92', null, S(DET.panel, 0.4, 0.8));
  B.box('std', -120, 38.6, zk, 88, 1.2, 28, '#1a1a1a', null, S(0, 0.5, 0.8));
  B.box('std', -120, 118, zk + 2, 100, 24, 40, '#a8acb0', [0.12, 0, 0], S(DET.panel, 0.4, 0.8));
  B.box('std', -50, 19, zk, 40, 38, 30, '#8a8e92', null, S(DET.panel, 0.4, 0.8));
  B.box('std', 60, 19, zk + 40, 90, 3, 30, '#c8ccce', null, CHROME);
  for (const s of [-1, 1]) for (const x of [20, 100]) rod(B, 'std', [x, 0, zk + 40 + s * 12], [x, 18, zk + 40 + s * 12], 1, '#c8ccce', CHROME, 4);
  B.box('std', 150, 60, zk - 8, 80, 120, 14, '#6a6e72', null, METAL);
  for (let i = 0; i < (P.lod >= 1 ? 28 : 8); i++) B.cyl('std', 115 + (i % 7) * 10, 18 + Math.floor(i / 7) * 26, zk - 4, 3.4, 9, r.pick(['#c8281e', '#e8e0d0', '#2a6a3a', '#e0a020']), 10, 1, null, S(0, 0.4, 0.6));
  // pendant lights over the counter, ceiling fans over the booths
  for (const x of [-90, -20, 50, 120]) {
    const [wx, wy] = toWorld(o, x + 65, 0);
    pendant(B, P.day ? null : halos, x + 65, 104, 0, wx, wy, '#ffd9a0', !P.day);
  }
  if (P.lod >= 1) {
    for (const x of [-150, -50, 100]) {
      rod(B, 'std', [x, 116, 110], [x, 128, 110], 0.5, '#2a2a2a', METAL, 4);
      B.cyl('std', x, 110, 110, 5, 6, '#6a4a30', 10, 1, null, WOOD);
      for (let k = 0; k < 4; k++) B.add('std', T.box(), [x + Math.cos(k * HALF + 0.3) * 20, 112, 110 + Math.sin(k * HALF + 0.3) * 20], [32, 0.8, 8], [0, -(k * HALF + 0.3), 0], '#6a4a30', WOOD);
    }
  }
  // the jukebox against the east wall, litter, blood by the booths
  B.rblock('std', w / 2 - 20, 0, 60, 24, 50, 18, 6, '#b3261e', null, S(0, 0.4, 0.3));
  B.add(P.day ? 'std' : 'glow', T.cyl(14, 1, false), [w / 2 - 20, 46, 60], [10, 16, 7], [0, 0, HALF], '#f0c060', P.day ? S(0, 0.3, 0) : { emissive: 2, uv: atlasUV('white'), noAO: true });
  litter(B, -w / 2 + 20, -40, w / 2 - 20, h / 2 - 10, P.lod >= 1 ? 22 : 8, 0.6);
  if (P.lod >= 1) { floorDecal(B, 'blood1', -100, 90, 60, 60, 0.4, 0.62); floorDecal(B, 'blood3', -60, 100, 40, 30, 1.2, 0.62); }
}

/** The square's fountain: a stone basin of green water, a pedestal with two tiers of bowls, dry now. */
function fountain(P) {
  const { B, o } = P;
  const R = o.w / 2 - 2, r = B.rng;
  const stone = { noJitter: true, surf: [DET.rock, 0.9, 0] };
  B.cyl('std', 0, 0, 0, R, 24, '#a8a498', 28, 1, null, stone);
  B.add('std', T.torus(28, 0.14, 6), [0, 24, 0], [R - 3, R - 3, 22], [HALF, 0, 0], '#b8b4a8', stone);
  B.cyl('std', 0, 18, 0, R - 8, 0.8, '#2a3a2c', 28, 1, null, { noJitter: true, surf: [0, 0.06, 0.1] });
  B.cyl('std', 0, 18, 0, 14, 44, '#a8a498', 14, 0.8, null, stone);
  B.add('std', T.lathe('hcbowl', [[10, 0], [30, 6], [38, 12], [36, 14], [12, 8]], 20), [0, 60, 0], [1, 1, 1], null, '#b0aca0', stone);
  B.cyl('std', 0, 74, 0, 6, 22, '#a8a498', 12, 0.8, null, stone);
  B.add('std', T.lathe('hcbowl2', [[6, 0], [18, 4], [22, 8], [20, 9], [8, 5]], 16), [0, 96, 0], [1, 1, 1], null, '#b0aca0', stone);
  B.add('std', T.sphere(10, 8), [0, 108, 0], [5, 8, 5], null, '#8a9a8a', S(DET.panel, 0.6, 0.5));
  // leaves on the water, a coin glint, algae streaks on the bowls
  if (P.lod >= 1) {
    for (let i = 0; i < 24; i++) { const a = r.range(0, 6.28), d = r.range(20, R - 12); B.add('std', T.box(), [Math.cos(a) * d, 19, Math.sin(a) * d], [3, 0.2, 2], [0, r.range(0, 6), 0], r.pick(['#8a5a2a', '#a87a3a', '#6a4a22']), NJ); }
    for (const [y, rad] of [[62, 34], [97, 20]]) for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.28; decal(B, 'grime', Math.cos(a) * rad, y - 6, Math.sin(a) * rad, 16, 20, HALF - a); }
  }
}

/** The square's bandstand: an octagonal deck on a lattice skirt, white posts and rails, the roof and finial,
 *  and the sandbags someone stacked on it, the casings, the blood. */
function gazebo(P) {
  const { B, o } = P;
  const R = o.w / 2 - 2, r = B.rng;
  const white = '#ece8dc';
  const wd = { noJitter: true, ...WOOD };
  B.add('std', T.cyl(8), [0, 18, 0], [R, 36, R], [0, PI / 8, 0], white, { ...wd, map: 'cyl' });
  B.add('std', T.cyl(8), [0, 37, 0], [R + 3, 3, R + 3], [0, PI / 8, 0], '#c8c0b0', { ...wd, map: 'cyl' });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2, x = Math.cos(a) * (R - 4), z = Math.sin(a) * (R - 4);
    B.box('std', x, 38 + 50, z, 4, 100, 4, white, null, wd);
    const a2 = ((k + 1) / 8) * PI * 2, x2 = Math.cos(a2) * (R - 4), z2 = Math.sin(a2) * (R - 4);
    if (k !== 2) {
      plank(B, 'std', [x, 64, z], [x2, 64, z2], 3, 2, white, wd);
      for (let t = 0.1; t < 1; t += 0.12) B.box('std', x + (x2 - x) * t, 51, z + (z2 - z) * t, 1.4, 26, 1.4, white, null, wd);
    } else {
      // the steps down to the square
      const mx = (x + x2) / 2, mz = (z + z2) / 2, am = (a + a2) / 2;
      for (let s = 0; s < 4; s++) B.box('std', mx * (1 + (s + 1) * 0.12), 31 - s * 9, mz * (1 + (s + 1) * 0.12), 44, 4, 14, white, [0, -am + HALF, 0], wd);
    }
    plank(B, 'std', [x, 138, z], [x2, 138, z2], 6, 3, white, wd);
  }
  B.add('std', T.cyl(8, 0.05), [0, 160, 0], [R + 14, 44, R + 14], [0, PI / 8, 0], '#3a4a5a', { noJitter: true, surf: [DET.shingle, 0.8, 0.1], map: 'cyl' });
  B.add('std', T.sphere(8, 6), [0, 186, 0], [4, 6, 4], null, '#c8a040', S(0, 0.3, 0.8));
  // sandbags round the deck's edge (not across the steps), ammo boxes, casings
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * PI * 2;
    if (Math.abs(a - (2.5 * PI) / 4) < 0.4) continue;
    B.add('std', T.pillow(8, 5, 0.4), [Math.cos(a) * (R - 14), 42 + (k % 2) * 7, Math.sin(a) * (R - 14)], [8.4, 4, 6], [0, -a + HALF, 0], mixHex('#8a7a55', '#6a5e40', r.next()), FABRIC);
  }
  for (let i = 0; i < 3; i++) B.rblock('std', r.range(-20, 20), 39, r.range(-20, 20), 10, 7, 6, 0.5, '#3a4a2a', [0, r.range(0, 3), 0], METAL);
  for (let i = 0; i < 30; i++) B.add('std', T.cyl(6), [r.range(-R + 10, R - 10), 39.6, r.range(-R + 10, R - 10)], [0.7, 2.4, 0.7], [HALF, r.range(0, 6), 0], '#c8a040', { ...S(0, 0.3, 0.9), map: 'cyl' });
  floorDecal(B, 'blood1', 10, -10, 50, 50, 0.4, 39.4);
}

/** The war memorial: a granite obelisk on a stepped base, the bronze plaque, small flags, a wreath, candles. */
function memorial(P) {
  const { B, o, halos } = P;
  const g = { noJitter: true, surf: [DET.rock, 0.5, 0.1] };
  B.rblock('std', 0, 0, 0, 44, 6, 44, 1, '#6a6a6e', null, g);
  B.rblock('std', 0, 6, 0, 32, 16, 32, 1, '#5a5a60', null, g);
  B.add('std', T.cyl(4, 0.55), [0, 22 + 45, 0], [16, 90, 16], [0, PI / 4, 0], '#6a6a70', g);
  B.add('std', T.cyl(4, 0.01), [0, 112 + 4, 0], [9, 8, 9], [0, PI / 4, 0], '#6a6a70', g);
  for (const s of [1, -1]) sign(B, 'hc_plaque', 0, 14, s * 16.2, 26, 13, s > 0 ? 0 : PI);
  for (const x of [-18, -6, 6, 18]) {
    rod(B, 'std', [x, 0, 26], [x + 1, 22, 27], 0.3, '#2a2a2a', METAL, 3);
    B.add('std', T.plane(), [x + 5, 19, 27], [9, 6, 1], [0, 0.3, 0], '#ffffff', { uv: lvUV('hc_flag'), noAO: true, noJitter: true });
    B.add('std', T.plane(), [x + 5, 19, 27], [9, 6, 1], [0, 0.3 + PI, 0], '#ffffff', { uv: lvUV('hc_flag'), noAO: true, noJitter: true });
  }
  B.add('std', T.torus(16, 0.28, 6), [0, 18, 17.5], [8, 8, 8], null, '#2a4a2a', FABRIC);
  for (const x of [-10, 10]) {
    B.cyl('std', x, 0, 30, 2, 5, '#c8281e', 8, 1, null, GLASS);
    if (!P.day) { glowBox(B, x, 5.6, 30, 1, 2, 1, '#ffb050', 3); const [wx, wy] = toWorld(o, x, 30); halos.push({ x: wx, y: wy, h: 6, color: '#ffb050', size: 26, strength: 0.6, flicker: 0.5 }); }
  }
}

/** Festival bunting across the street between two wooden poles (along local x), the banner in the middle. */
function bunting(P) {
  const { B, o } = P;
  const len = o.len, r = B.rng;
  const half = len / 2 - 40;
  for (const s of [-1, 1]) B.cyl('std', s * half, 0, 0, 3, 170, '#5a4632', 8, 1, null, WOOD);
  const cols = ['#c62828', '#f0ece0', '#1a4a8a', '#e08a1a', '#e8c020'];
  const tri = T.custom('hc-pennant', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0, 0.5, 0, 0, -0.5, 0, 0, 0, -1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
    return g;
  });
  for (const [yTop, sag, off] of [[160, 26, 0], [148, 34, 6]]) {
    const n = Math.round((half * 2) / 12);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = -half + t * half * 2;
      const y = yTop - Math.sin(t * PI) * sag;
      if (i < n) {
        const x2 = -half + ((i + 1) / n) * half * 2, y2 = yTop - Math.sin(((i + 1) / n) * PI) * sag;
        rod(B, 'std', [x, y, off], [x2, y2, off], 0.25, '#2a2a2a', FABRIC, 3);
        if (P.lod >= 1 || i % 2 === 0) B.add('std', tri, [(x + x2) / 2, (y + y2) / 2, off], [9, 11, 1], [0, r.range(-0.2, 0.2), 0], cols[(i + off) % cols.length], FABRIC);
      }
    }
  }
  if (o.text) {
    for (const s of [-1, 1]) rod(B, 'std', [s * 100, 136, 0], [s * 100, 126, 0], 0.3, '#2a2a2a', FABRIC, 3);
    sign2(B, 'hc_banner', 0, 116, 0, 200, 25, 0);
  }
}

/** An acorn street lamp: a fluted green pole on a base, the globe (lit at night), a hanging basket. */
function streetlamp(P) {
  const { B, o, halos } = P;
  const seed = Math.round(o.x * 3 + o.y);
  const bent = hash01(seed) < 0.12;
  const green = '#1f3a2c';
  B.cyl('std', 0, 0, 0, 7, 14, green, 12, 0.8, null, METAL);
  const lean = bent ? 0.25 : 0;
  const top = [Math.sin(lean) * 110, 14 + Math.cos(lean) * 110, 0];
  rod(B, 'std', [0, 14, 0], top, 2.6, green, METAL, 10);
  B.cyl('std', top[0], top[1], 0, 4.4, 4, green, 10, 1, null, METAL);
  const lit = !P.day && !bent && hash01(seed + 1) > 0.25;
  if (lit) {
    B.add('glow', T.sphere(10, 8), [top[0], top[1] + 12, 0], [7, 11, 7], null, '#ffe0a8', { emissive: 3, uv: atlasUV('white'), noAO: true, noJitter: true });
    const [wx, wy] = toWorld(o, top[0], 0);
    halos.push({ x: wx, y: wy, h: top[1] + 12, color: '#ffd49a', size: 80, strength: 0.6 });
  } else B.add('std', T.sphere(10, 8), [top[0], top[1] + 12, 0], [7, 11, 7], null, bent ? '#8a8e8a' : '#e8e6de', { noJitter: true, surf: [0, 0.15, 0] });
  B.add('std', T.cyl(10, 0.2), [top[0], top[1] + 26, 0], [8, 5, 8], null, green, { ...METAL, map: 'cyl' });
  // a hanging basket on a bracket (the town's flowers, dead)
  if (P.lod >= 1 && !bent) {
    B.box('std', 12, 96, 0, 22, 1.4, 1.4, green, null, METAL);
    B.add('std', T.sphere(8, 6), [22, 84, 0], [8, 6, 8], null, '#4a4a2a', S(DET.grass, 0.95, 0));
    for (let k = 0; k < 3; k++) rod(B, 'std', [22, 96, 0], [22 + Math.cos(k * 2.1) * 7, 86, Math.sin(k * 2.1) * 7], 0.2, '#2a2a2a', METAL, 3);
  }
}

/** The town's last stand at the west end: tables turned over behind the sandbags, ammo boxes, casings, a flag,
 *  the dead under tarps. */
function laststand(P) {
  const { B } = P;
  const r = B.rng;
  // diner tables on their sides: the top stood up as a shield, the legs sticking out behind
  for (const [x, z, a] of [[20, -40, 0.3], [70, 40, -0.4], [-20, 80, 1.2]]) {
    const c = Math.cos(a), sn = Math.sin(a);
    B.add('std', T.box(), [x, 15, z], [56, 30, 2], [0, a, 0], '#e8dcc8', S(0, 0.4, 0));
    B.add('std', T.box(), [x, 15, z], [57, 31, 1.4], [0, a, 0], '#b8bcc0', CHROME);
    for (const s of [-1, 1]) for (const y of [6, 24]) {
      const px = x + c * s * 20, pz = z - sn * s * 20;
      rod(B, 'std', [px, y, pz], [px + sn * 26, y, pz + c * 26], 1, '#8a8e92', CHROME, 5);
    }
  }
  for (let i = 0; i < 4; i++) B.rblock('std', 40 + i * 12, 0, -80 + r.range(-4, 4), 10, 7, 6, 0.5, '#3a4a2a', [0, r.range(-0.3, 0.3), 0], METAL);
  for (let i = 0; i < 60; i++) B.add('std', T.cyl(6), [r.range(-20, 120), 0.6, r.range(-120, 40)], [0.8, 2.6, 0.8], [HALF, r.range(0, 6), 0], r.pick(['#c8a040', '#c83a2a']), { ...S(0, 0.3, 0.9), map: 'cyl' });
  plank(B, 'std', [30, 32, -110], [70, 34, -106], 2, 2.4, '#5a3a22', WOOD);
  rod(B, 'std', [100, 0, -60], [100, 150, -60], 1.2, '#8a8e92', CHROME, 6);
  sign2(B, 'hc_flag', 124, 134, -60, 46, 30, 0, { rz: -0.1 });
  for (const [x, z, a] of [[-60, 20, 0.4], [-90, -30, 1.4], [140, 90, 2.2]]) {
    B.add('std', T.pillow(10, 6, 0.3), [x, 3, z], [28, 3.4, 10], [0, a, 0], '#2a3440', S(DET.plastic, 0.45, 0));
    B.add('std', T.sphere(8, 6), [x + Math.cos(a) * 18, 4, z - Math.sin(a) * 18], [6, 4, 7], [0, a, 0], '#2a3440', S(DET.plastic, 0.45, 0));
    floorDecal(B, 'blood3', x + 10, z + 6, 50, 36, a, 0.5);
  }
  floorDecal(B, 'blood1', 20, 0, 80, 80, 0.5, 0.5);
  decal(B, 'graf1', 0, 60, 40, 120, 40, 0);
}

/** A roadside farm stand: a plank counter under a tin roof on posts, crates of pumpkins and apples, the sign. */
function farmstand(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  B.rblock('std', 0, 0, 0, L, 36, D, 1, '#8a6a48', null, WOOD);
  B.box('std', 0, 37, 2, L + 6, 2, D + 8, '#a8845a', null, WOOD);
  for (const [x, z] of [[-L / 2, -D / 2], [L / 2, -D / 2], [-L / 2, D / 2 + 10], [L / 2, D / 2 + 10]]) B.box('std', x, 55, z, 4, 110, 4, '#6a4a30', null, WOOD);
  B.add('std', T.box(), [0, 112, 4], [L + 20, 2, D + 34], [-0.15, 0, 0], '#8a8e92', { noJitter: true, surf: [DET.corrugated, 0.5, 0.5] });
  B.box('std', 0, 96, D / 2 + 11, 120, 26, 2, '#e8e0cc', null, WOOD);
  sign(B, 'hc_stand', 0, 96, D / 2 + 12.2, 118, 29.5, 0);
  // crates on the counter: pumpkins, apples, a few jars
  for (let k = 0; k < 4; k++) {
    const x = -L / 2 + 20 + k * 33;
    B.box('std', x, 42, 4, 28, 8, 24, '#a8845a', null, WOOD);
    const fruit = k % 2 ? ['#c8281e', 2.6] : ['#d8781a', 5];
    for (let j = 0; j < (k % 2 ? 9 : 3); j++) B.add('std', T.sphere(8, 6), [x + r.range(-9, 9), 47 + fruit[1] * 0.6, 4 + r.range(-7, 7)], [fruit[1], fruit[1] * 0.85, fruit[1]], null, fruit[0], { ...S(0, 0.5, 0), wobble: { amp: 0.06, seed: j } });
  }
  for (let k = 0; k < 6; k++) B.add('std', T.sphere(10, 8), [r.range(-L / 2, L / 2), 7, D / 2 + r.range(14, 40)], [r.range(6, 9), r.range(5, 7), r.range(6, 9)], null, r.pick(['#d8781a', '#c8641c', '#e0901a']), { ...S(0, 0.5, 0), wobble: { amp: 0.08, seed: k } });
  B.rblock('std', L / 2 - 10, 38, -D / 2 + 8, 10, 12, 8, 1, '#3a5a3a', null, METAL);
}

export const TOWN_MODELS = {
  'hc-farmstand': farmstand,
  'hc-rails': rails, 'hc-crossing': crossing, 'hc-boxcar': boxcar, 'hc-tankcar': tankcar, 'hc-watertower': watertower, 'hc-welcome': welcome,
  'hc-feedstore': feedstore, 'hc-cruiser': cruiser, 'hc-barricadeback': barricadeback, 'hc-theater': theater, 'hc-postoffice': postoffice,
  'hc-hwshelf': hwshelf, 'hc-hwcounter': hwcounter, 'hc-hwstuff': hwstuff, 'hc-dinercounter': dinercounter, 'hc-booth': booth, 'hc-dinerstuff': dinerstuff,
  'hc-fountain': fountain, 'hc-gazebo': gazebo, 'hc-memorial': memorial, 'hc-bunting': bunting, 'hc-lamp': streetlamp, 'hc-laststand': laststand,
};
export const TOWN_GATES = { 'hc-barricade': barricade };
void [crate, carton, drum, tyre, RUBBER, sign2];
