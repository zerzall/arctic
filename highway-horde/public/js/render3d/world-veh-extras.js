// Vehicle variety on top of the lofted bodies of world-veh.js (WORLD): every car, SUV,
// van and pickup can be a taxi, a police cruiser, an ambulance, a delivery, plumber's or
// news van, a tow truck or a contractor's pickup — with the paint, the lettering (the text
// atlas of dress-atlas.js, bucket 'sign'), roof light bars (blinking red/blue on the
// 'blink' bucket), roof signs, ladders and dishes; plus damage on the rest of them: a
// hood standing open over the engine, a flat tyre, dents and scratches, an antenna, luggage
// on the roof. And the fire engine (a red 'truck'), the school bus lettering and the
// company liveries of trailers. All of it is chosen per obstacle id, deterministically.

import { T, shadeHex, hash01, mixHex } from './world-geo.js';
import { DET } from './world-surf.js';
import { dressUV } from './dress-atlas.js';
import { atlasUV } from './world-tex.js';

const CHROME = '#c9ced3';
const TRIM = '#222324';
const INTERIOR = '#0c0b0a';

export const ROLE_COLOR = {
  taxi: '#e2b41c', police: '#1a1c22', ambulance: '#e6e6e0', swift: '#6a3a1a', bread: '#e8e0c4', plumb: '#1e4f9a',
  news: '#e8e8e4', fire: '#b01818', tow: '#d0a020',
};

/** Which special job (if any) this obstacle has: null for an ordinary vehicle. */
export function roleFor(o) {
  if (o.wrecked) return null;
  const h = hash01(o.id * 41 + 7);
  switch (o.kind) {
    case 'car': return h < 0.08 ? 'taxi' : h < 0.15 ? 'police' : null;
    case 'suv': return h < 0.12 ? 'police' : h < 0.17 ? 'news' : null;
    case 'van': return h < 0.1 ? 'ambulance' : h < 0.2 ? 'swift' : h < 0.29 ? 'bread' : h < 0.37 ? 'plumb' : h < 0.43 ? 'news' : null;
    case 'pickup': return h < 0.1 ? 'tow' : h < 0.22 ? 'contractor' : null;
    case 'truck': return isRed(o.color) ? 'fire' : null;
    default: return null;
  }
}

function isRed(hex) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r > 130 && g < 70 && b < 70;
}

/** Per-vehicle damage picks (flat tyre, hood, dents), on top of vehicleLook's. */
export function damageFor(o) {
  const h = (k) => hash01(o.id * 53 + k);
  return {
    flat: h(1) < (o.wrecked ? 0.35 : 0.12) ? Math.floor(h(2) * 4) : -1,
    hoodOpen: (o.kind === 'car' || o.kind === 'suv' || o.kind === 'pickup') && h(3) < (o.wrecked ? 0.32 : 0.09),
    dents: h(4) < (o.wrecked ? 0.9 : 0.4) ? 1 + Math.floor(h(5) * 3) : 0,
    antenna: !o.wrecked && h(6) < 0.3,
    roofLoad: !o.wrecked && (o.kind === 'car' || o.kind === 'suv') && h(7) < 0.1 ? Math.floor(h(8) * 3) : -1,
    plywood: !o.wrecked && h(9) < 0.03,
  };
}

const GEO = {
  car: { roofY: 41.8, roofX: [-0.12, 0.06], hoodY: 29.6, hoodX: [0.28, 0.45], doorX: [-0.2, 0.2], beltY: 29, doorY: [12, 27] },
  suv: { roofY: 55.2, roofX: [-0.4, 0.1], hoodY: 35.6, hoodX: [0.3, 0.46], doorX: [-0.3, 0.24], beltY: 35, doorY: [14, 34] },
  pickup: { roofY: 57, roofX: [-0.1, 0.1], hoodY: 37.4, hoodX: [0.23, 0.45], doorX: [-0.08, 0.2], beltY: 36, doorY: [14, 34], bed: [-0.5, -0.14], bedY: 34 },
  van: { roofY: 71.6, roofX: [-0.5, 0.3], hoodY: 42, hoodX: [0.36, 0.43], doorX: [0.2, 0.36], beltY: 41, doorY: [14, 40] },
};

const side = (sd) => [0, sd > 0 ? 0 : Math.PI, 0];
/** A lettering picture on a flank of the vehicle (sd = +1 the +z side). */
function flankSign(B, cell, x, y, halfW, sd, w, h, tilt = 0) {
  B.add('sign', T.plane(), [x, y, sd * (halfW + 0.12)], [w, h, 1], [0, sd > 0 ? 0 : Math.PI, tilt], '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
}

/** Roof light bar; police: red + blue, ambulance: red + white. */
function lightBar(B, x, y, wid, colors, v) {
  B.rbox('std', x, y + 1.1, 0, 5.4, 2.2, wid, 0.7, '#18181a', null, { surf: [DET.plastic, 0.4, 0.2] });
  const on = v.lightsOn;
  colors.forEach((c, i) => {
    const z = (i === 0 ? -1 : 1) * wid * 0.25;
    B.box('blink', x, y + 2.9, z, 4.4, 2, wid * 0.44, c, null, { emissive: on ? 3.6 : 1.2 });
  });
  B.box('glass', x, y + 2.7, 0, 5.6, 2.6, wid * 0.98, '#c8d0d8', null, { surf: [0, 0.1, 0.1] });
}

function pushBar(B, x, y, wid) {
  const S2 = { surf: [0, 0.35, 0.8] };
  B.box('std', x, y, 0, 1.4, 1.4, wid, '#111', null, S2);
  for (const z of [-wid / 2, wid / 2]) B.box('std', x - 1, y - 3, z, 1.2, 8, 1.2, '#111', null, S2);
}

function dents(B, o, v, geo, L, W, n) {
  const hw = W / 2 - 0.4;
  for (let i = 0; i < n; i++) {
    const sd = B.rng.chance(0.5) ? 1 : -1;
    const x = B.rng.range(geo.doorX[0], geo.doorX[1] + 0.2) * L, y = B.rng.range(geo.doorY[0] + 3, geo.doorY[1] - 2);
    const c = shadeHex(v.color, B.rng.chance(0.5) ? -0.28 : 0.12);
    B.add(v.paintBucket, T.box(), [x, y, sd * (hw + 0.18)], [B.rng.range(4, 9), B.rng.range(2, 5), 0.35], [0, 0, B.rng.range(-0.5, 0.5)], c, { surf: v.paintSurf, noAO: true });
    if (B.rng.chance(0.6)) B.add('std', T.box(), [x + 1, y - 2, sd * (hw + 0.28)], [B.rng.range(5, 10), 0.35, 0.2], [0, 0, B.rng.range(-0.3, 0.3)], shadeHex(v.color, 0.35), { surf: [0, 0.5, 0.5], noAO: true });
  }
}

function openHood(B, o, v, geo, L, W) {
  const hx0 = geo.hoodX[0] * L, hx1 = geo.hoodX[1] * L, hl = hx1 - hx0, y = geo.hoodY;
  // the engine bay showing over the closed hood, the hood propped up on its hinge
  B.box('std', (hx0 + hx1) / 2, y + 0.3, 0, hl * 0.94, 0.7, W * 0.8, '#0b0a09', null, { surf: [DET.char, 0.9, 0.3] });
  B.rbox('std', hx0 + hl * 0.5, y + 2.6, 0, hl * 0.42, 4.4, W * 0.34, 0.8, '#3a3c40', null, { surf: [DET.rust, 0.6, 0.6] });
  B.rbox('std', hx0 + hl * 0.9, y + 2.4, 0, 2, 5, W * 0.6, 0.6, '#1a1a1c', null, { surf: [DET.plastic, 0.6, 0] });
  for (const z of [-W * 0.34, W * 0.34]) B.cyl('std', hx0 + hl * 0.3, y + 0.5, z, 2.2, 5.5, '#151517', 8, 1, null, { surf: [DET.rubber, 0.8, 0] });
  const a = 1.15;
  B.add(v.paintBucket, T.rbox(hl * 0.98, 0.9, W * 0.82, 0.4), [hx0 + Math.cos(a) * hl / 2, y + 0.6 + Math.sin(a) * hl / 2, 0], [1, 1, 1], [0, 0, a], v.color, { surf: v.paintSurf });
  B.add('std', T.rbox(hl * 0.9, 0.5, W * 0.7, 0.3), [hx0 + Math.cos(a) * hl / 2 - Math.sin(a) * 0.7, y + 0.6 + Math.sin(a) * hl / 2 + Math.cos(a) * 0.7, 0], [1, 1, 1], [0, 0, a], '#9a9a94', { surf: [DET.panel, 0.7, 0.2] });
  B.cyl('std', hx0 + hl * 0.6, y, W * 0.3, 0.35, hl * 0.6, '#c9ced3', 5, 1, [0, 0, 0.45], { surf: [0, 0.3, 0.9] });   // the prop rod
}

// ---- extras of the road vehicles -------------------------------------------------------------------

/**
 * Livery, light bars, roof loads and damage of a road vehicle.
 * @param {object} B builder (frame at the vehicle) @param {object} o obstacle
 * @param {object} v vehicleLook result (role, dmg, color, paintBucket, paintSurf, lightsOn...)
 */
export function vehicleExtras(B, o, v) {
  const geo = GEO[o.kind];
  if (!geo) return;
  const L = o.w, W = o.h, r = B.rng;
  const hw = W / 2 - 0.5;
  const rx = (f) => f * L;
  const roofMid = rx((geo.roofX[0] + geo.roofX[1]) / 2);
  const dm = v.dmg;
  const sag = v.wrecked ? -2.2 : 0;

  if (!v.wrecked) {
    switch (v.role) {
      case 'taxi': {
        // roof sign, checker band and the company name on the doors
        B.rbox('std', roofMid, geo.roofY + 2.4, 0, 5, 4.2, 15, 0.8, '#ece8d6', null, { surf: [DET.plastic, 0.35, 0] });
        for (const sd of [-1, 1]) B.add('sign', T.plane(), [roofMid, geo.roofY + 2.5, sd * 7.65], [14, 4.2, 1], side(sd), '#ffffff', { uv: dressUV('v_taxi'), noAO: true, noJitter: true });
        B.box('glow', roofMid, geo.roofY + 4.6, 0, 3.6, 0.5, 13, '#fff2c0', null, { emissive: 0.7, uv: atlasUV('white') });
        for (const sd of [-1, 1]) flankSign(B, 'v_taxi_side', rx(0.0), 20.5 + sag, hw, sd, 34, 5.4);
        break;
      }
      case 'police': {
        // white doors, lettering, star, light bar, push bar
        for (const sd of [-1, 1]) {
          B.rbox(v.paintBucket, rx((geo.doorX[0] + geo.doorX[1]) / 2), 19.5, sd * (hw + 0.1), rx(geo.doorX[1] - geo.doorX[0]), 14, 0.5, 0.3, '#ecebe4', null, { surf: v.paintSurf });
          flankSign(B, 'v_police', rx(-0.02), 18.6, hw + 0.4, sd, 30, 5.6);
          flankSign(B, 'v_star', rx(0.13), 22.5, hw + 0.4, sd, 6, 6);
        }
        lightBar(B, roofMid, geo.roofY, W * 0.62, ['#ff2a1a', '#2a6aff'], v);
        pushBar(B, L / 2 + 1.2, 16, W * 0.6);
        break;
      }
      case 'ambulance': {
        for (const sd of [-1, 1]) {
          B.rbox(v.paintBucket, rx(-0.06), 42, sd * (hw + 0.1), L * 0.9, 5, 0.5, 0.3, '#c81c22', null, { surf: v.paintSurf });
          B.rbox(v.paintBucket, rx(-0.06), 34.6, sd * (hw + 0.1), L * 0.9, 1.4, 0.5, 0.3, '#c81c22', null, { surf: v.paintSurf });
          flankSign(B, 'v_amb', rx(-0.1), 53, hw + 0.4, sd, 44, 8.2);
          flankSign(B, 'v_cross', rx(0.3), 58, hw + 0.4, sd, 9, 9);
        }
        B.add('sign', T.plane(), [-L / 2 - 0.3, 57, 0], [12, 12, 1], [0, -Math.PI / 2, 0], '#ffffff', { uv: dressUV('v_cross'), noAO: true, noJitter: true });
        lightBar(B, rx(0.22), geo.roofY, W * 0.7, ['#ff2a1a', '#f4f4ec'], v);
        B.box('std', -L / 2 - 0.4, 22, 0, 0.8, 4, W * 0.9, '#161616', null, { surf: [DET.plastic, 0.5, 0] });
        break;
      }
      case 'swift': case 'bread': case 'plumb': {
        const cell = 'v_' + v.role;
        for (const sd of [-1, 1]) flankSign(B, cell, rx(-0.06), 52, W / 2 + 0.05, sd, 68, 17);
        B.add('sign', T.plane(), [-L / 2 - 0.3, 62, 0], [24, 6, 1], [0, -Math.PI / 2, 0], '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
        if (v.role === 'plumb') {
          // pipes on a roof rack
          for (const sd of [-1, 1]) B.box('std', roofMid, geo.roofY + 1.6, sd * 12, 60, 1, 1.4, '#161616', null, { surf: [0, 0.4, 0.8] });
          for (const z of [-4, 0, 4]) B.cylX('std', roofMid, geo.roofY + 4, z, 1.5, 62, '#b87a4a', 8, { surf: [DET.panel, 0.3, 0.9] });
        }
        break;
      }
      case 'news': {
        for (const sd of [-1, 1]) flankSign(B, 'v_news', rx(-0.02), o.kind === 'suv' ? 40 : 52, (o.kind === 'suv' ? W / 2 - 0.5 : W / 2) + 0.05, sd, o.kind === 'suv' ? 26 : 34, o.kind === 'suv' ? 9.75 : 12.7);
        const y = geo.roofY;
        B.cyl('std', -roofMid * 0 - 6, y, 0, 0.9, 40, '#8a8e92', 8, 0.8, null, { surf: [0, 0.3, 0.9] });
        B.add('std', T.sphere(12, 5), [-6, y + 42, 0], [8, 2.2, 8], [0.5, 0, 0.6], '#e8e8e4', { surf: [DET.panel, 0.4, 0.4] });
        B.cyl('std', -6 + 3, y + 43, 0, 0.6, 5, '#3a3e42', 6, 1, [0, 0, -0.6], { surf: [0, 0.4, 0.8] });
        B.rbox('std', 4, y + 2, 0, 12, 4, 16, 0.8, '#d8d8d0', null, { surf: [DET.panel, 0.4, 0.4] });
        break;
      }
      case 'tow': {
        // beacon on the cab, name on the door, a hook and chains at the back
        B.rbox('std', roofMid, geo.roofY + 1.2, 0, 4, 2, 10, 0.6, '#1c1c1e', null, { surf: [DET.plastic, 0.5, 0] });
        B.box('blink', roofMid, geo.roofY + 3, 0, 3, 2.2, 9, '#ffa010', null, { emissive: v.lightsOn ? 3.6 : 1.4 });
        for (const sd of [-1, 1]) flankSign(B, 'v_tow', rx(0.06), 22, hw + 0.4, sd, 20, 6.2);
        B.rbox('std', rx(-0.4), 38, 0, 4, 6, W * 0.9, 0.8, '#c8281e', null, { surf: [DET.panel, 0.5, 0.5] });
        for (let k = 0; k < 4; k++) B.add('std', T.torus(6, 0.25, 3), [-L / 2 - 2, 34 - k * 2.4, 0], [1.4, 1.4, 1], [0, k % 2 ? 0 : Math.PI / 2, 0], '#3a3a3c', { surf: [DET.rust, 0.6, 0.8] });
        break;
      }
      case 'contractor': {
        // ladder rack over the bed, ladders, a toolbox, safety cones
        const bx0 = rx(geo.bed[0]) + 6, bx1 = rx(geo.bed[1]) - 2;
        for (const sd of [-1, 1]) B.box('std', (bx0 + bx1) / 2, geo.bedY + 1, sd * (W / 2 - 4), bx1 - bx0, 1.2, 1.2, '#161616', null, { surf: [0, 0.4, 0.8] });
        for (const x of [bx0 + 4, bx1 - 4]) B.box('std', x, geo.bedY + 8, 0, 1.4, 16, W - 6, '#161616', null, { surf: [0, 0.4, 0.8] });
        for (const sd of [-1, 1]) {
          B.box('std', (bx0 + bx1) / 2 - 8, geo.bedY + 17, sd * 5, 60, 1.2, 1, '#d8a020', null, { surf: [DET.panel, 0.4, 0.7] });
          for (let x = -22; x < 14; x += 6) B.box('std', (bx0 + bx1) / 2 - 8 + x, geo.bedY + 17, 0, 0.8, 0.8, 10, '#d8a020', null, { surf: [DET.panel, 0.4, 0.7] });
        }
        B.rblock('std', (bx0 + bx1) / 2 + 6, geo.bedY - 12, 0, 10, 8, W * 0.7, 0.6, '#5a5e62', null, { surf: [DET.panel, 0.4, 0.6] });
        break;
      }
      default: break;
    }
    if (dm.antenna) B.cyl('std', -L * 0.4, geo.roofY - 12, r.chance(0.5) ? W * 0.3 : -W * 0.3, 0.32, 24, '#161616', 4, 0.6, [0.06, 0, 0.1], { surf: [0, 0.4, 0.8] });
    if (dm.roofLoad >= 0 && !v.role) {
      // luggage strapped to the roof, a mattress or a kayak
      const y = geo.roofY + 0.4;
      if (dm.roofLoad === 0) for (let k = 0; k < 3; k++) B.rbox('std', roofMid + (k - 1) * 12, y + 4, r.range(-3, 3), 11, 8, 16, 0.8, r.pick(['#2f4858', '#6b2d2a', '#3b4a3a', '#8a7a55']), [0, r.range(-0.15, 0.15), 0], { surf: [DET.fabric, 0.85, 0] });
      else if (dm.roofLoad === 1) B.add('std', T.pillow(10, 5, 0.5), [roofMid, y + 3, 0], [34, 3, 14], [0, 0, 0.04], '#c8c4b0', { surf: [DET.fabric, 0.9, 0] });
      else B.add('std', T.sphere(12, 5), [roofMid, y + 4, 4], [30, 3.6, 5], [0, 0, 0.03], r.pick(['#d8281e', '#e0a020', '#2a8aa0']), { surf: [DET.plastic, 0.3, 0] });
      for (const dx of [-10, 10]) B.box('std', roofMid + dx, y + 5, 0, 0.8, 0.5, W * 0.8, '#161616', null, { surf: [DET.fabric, 0.9, 0] });
    }
  }
  if (v.wrecked && o.kind !== 'van') {
    // the burnt-out cabin seen through the empty window frames: seat skeletons and a steering wheel
    const x0 = geo.roofX[0] * L + 5, x1 = geo.roofX[1] * L - 5, y0 = geo.beltY - 14 + sag;
    const F = { surf: [DET.char, 0.95, 0.4] };
    for (const [x, back] of [[x0 + (x1 - x0) * 0.25, 1], [x0 + (x1 - x0) * 0.75, 1]]) {
      for (const z of [-W * 0.22, W * 0.22]) {
        B.box('std', x, y0 + 4, z, 8, 1, 7, '#1c1a18', null, F);
        B.box('std', x - 4 * back, y0 + 12, z, 1.2, 15, 7, '#1c1a18', [0, 0, 0.12], F);
        B.box('std', x - 4 * back, y0 + 19.5, z, 1.4, 1.4, 3, '#2a2826', null, F);
      }
    }
    B.add('std', T.torus(8, 0.35, 3), [x1 + 3, y0 + 13, -W * 0.22], [4, 4, 4], [0, 1.3, 0.6], '#221f1c', F);
    B.box('std', x1 + 5, y0 + 6, 0, 3, 8, W * 0.7, '#161412', null, F);
  }
  if (dm.hoodOpen && geo.hoodX) openHood(B, o, v, geo, L, W);
  if (dm.dents) dents(B, o, v, geo, L, W, dm.dents);
  if (dm.plywood) {
    // a hand-lettered sheet propped in the windshield
    B.add('sign', T.plane(), [geo.hoodX[0] * L - 4, geo.beltY + 4, 0], [W * 0.5, W * 0.5 * 96 / 256, 1], [0, Math.PI / 2, -0.75], '#ffffff', { uv: dressUV(r.pick(['p_help', 'p_run', 'p_stay'])), noAO: true, noJitter: true });
  }
}

// ---- the fire engine -------------------------------------------------------------------------------

/** A red 'truck' obstacle: pumper with ladder, compartments, hose reel and a light bar. */
export function fireTruck(B, o, v, L, W, wheelFn) {
  const r = B.rng;
  const red = v.color;
  const S2 = { surf: [DET.panel, 0.32, 0.4] };
  const Sm = { surf: [0, 0.2, 0.9] };
  B.block('std', 0, 13, 0, L * 0.98, 5, W * 0.62, '#1a1a1a', null, { surf: [DET.rust, 0.8, 0.5] });
  // cab (forward), pump body (aft), compartments
  B.rblock('paint', 0.3 * L, 16, 0, 0.36 * L, 60, W * 0.98, 3, red, null, S2);
  B.rblock('paint', -0.18 * L, 16, 0, 0.62 * L, 50, W * 0.98, 2.4, red, null, S2);
  B.rblock('paint', -0.18 * L, 66, 0, 0.6 * L, 3, W * 0.92, 1, shadeHex(red, -0.15), null, S2);
  for (const sd of [-1, 1]) {
    const z = sd * (W / 2 + 0.3);
    // roll-up compartment doors with chrome frames
    for (let k = 0; k < 4; k++) {
      const x = -0.4 * L + k * 0.15 * L;
      B.box('std', x, 40, z, 0.12 * L, 24, 0.5, '#b8b8b2', null, { surf: [DET.corrugated, 0.35, 0.8] });
      B.box('std', x, 40, z + sd * 0.2, 0.125 * L, 26, 0.3, CHROME, null, Sm);
    }
    B.box('std', 0.25 * L, 46, z, 0.3 * L, 16, 0.5, INTERIOR, null, { surf: [0, 0.4, 0.2] });   // cab windows
    B.box('std', -0.26 * L, 22, z, 0.5 * L, 1.8, 0.5, CHROME, null, Sm);                           // running board
    B.add('sign', T.plane(), [-0.04 * L, 58, sd * (W / 2 + 0.5)], [50, 9.4, 1], side(sd), '#ffffff', { uv: dressUV('v_fire'), noAO: true, noJitter: true });
    B.add('sign', T.plane(), [0.3 * L, 32, sd * (W / 2 + 0.5)], [14, 6.6, 1], side(sd), '#ffffff', { uv: dressUV('v_num'), noAO: true, noJitter: true });
    B.box('std', 0.5 * L, 22, sd * W * 0.36, 1, 6, 9, '#e8e8e0', null, S2);
  }
  // windshield, grille, bumper, siren and light bar
  B.box('glass', 0.478 * L, 50, 0, 0.6, 15, W * 0.84, '#22303a', null, { surf: [0, 0.12, 0.3] });
  B.box('std', 0.481 * L, 50, 0, 0.8, 16.6, 1.6, red, null, S2);
  B.box('std', 0.481 * L, 58.2, 0, 0.8, 1.6, W * 0.88, red, null, S2);
  B.box('std', 0.481 * L, 42, 0, 0.8, 1.4, W * 0.88, red, null, S2);
  B.box('std', 0.48 * L + 0.3, 30, 0, 1, 18, W * 0.5, '#1a1a1a', null, { surf: [DET.corrugated, 0.4, 0.8] });
  B.rbox('std', 0.5 * L - 1, 18, 0, 5, 7, W * 1.02, 1.4, CHROME, null, Sm);
  lightBar(B, 0.34 * L, 76, W * 0.86, ['#ff2a1a', '#f4f4ec'], v);
  for (const sd of [-1, 1]) B.box('blink', 0.5 * L - 1, 60, sd * W * 0.4, 1.4, 2, 2.4, '#ff2a1a', null, { emissive: 3 });
  // extension ladder on the roof: rails, rungs, and a hose reel
  for (const sd of [-1, 1]) B.box('std', -0.16 * L, 72, sd * 10, 0.64 * L, 2.2, 1.6, '#c8c8c0', null, Sm);
  for (let x = -0.44 * L; x < 0.14 * L; x += 6) B.box('std', x, 72, 0, 0.8, 1, 20, '#c8c8c0', null, Sm);
  B.cylX('std', -0.26 * L, 71, 0, 3.6, 0.3 * L, '#1a1a1a', 10, { surf: [DET.rubber, 0.8, 0] });   // hose bed
  for (let k = 0; k < 3; k++) B.cylX('std', -0.16 * L, 70 + (k > 1 ? 4 : 0), (k % 2 ? 1 : -1) * 6, 2.6, 0.2 * L, k ? '#c8a020' : '#1a1a1a', 8, { surf: [DET.fabric, 0.8, 0] });
  // deck gun and hydrant hose connections at the back
  B.cyl('std', -0.36 * L, 66, 0, 2, 6, CHROME, 8, 1, null, Sm);
  B.cylX('std', -0.34 * L, 73, 0, 1.3, 10, CHROME, 8, Sm);
  for (const z of [-8, 0, 8]) B.cyl('std', -L / 2 - 1.4, 38 + (z === 0 ? 4 : 0), z, 2, 3, CHROME, 8, 1, [0, 0, Math.PI / 2], Sm);
  for (const sd of [-1, 1]) B.box('glow', -L / 2 - 0.4, 32, sd * W * 0.38, 0.6, 3.6, 6, '#d01418', null, { emissive: v.lightsOn ? 2 : 0.5, uv: atlasUV('white') });
  const R = 13;
  for (const [x, dual] of [[0.32, false], [-0.2, true], [-0.36, true]]) {
    for (const sd of [-1, 1]) {
      wheelFn(B, x * L, R, sd * (W / 2 - 5.5), 10, sd, { spokes: 0, rim: '#c9ced3' });
      if (dual) wheelFn(B, x * L, R, sd * (W / 2 - 15), 9, sd, { spokes: 0, rim: '#c9ced3' });
    }
  }
  void r;
}

// ---- lettering on buses and trailers -----------------------------------------------------------------

/** School bus: the name along both sides, SCHOOL BUS on the roof caps. */
export function busLettering(B, L, W, hood, sag) {
  for (const sd of [-1, 1]) {
    B.add('sign', T.plane(), [-0.06 * L, 88 + sag, sd * (W / 2 + 0.35)], [L * 0.6, L * 0.6 * 40 / 256, 1], side(sd), '#ffffff', { uv: dressUV('v_bus'), noAO: true, noJitter: true });
    B.add('sign', T.plane(), [0.2 * L, 34 + sag, sd * (W / 2 + 0.4)], [12, 5, 1], side(sd), '#ffffff', { uv: dressUV('v_num'), noAO: true, noJitter: true });
  }
  B.add('sign', T.plane(), [L / 2 - hood + 0.8, 94 + sag, 0], [W * 0.62, W * 0.62 * 48 / 192, 1], [0, Math.PI / 2, 0], '#ffffff', { uv: dressUV('v_bus_big'), noAO: true, noJitter: true });
  B.add('sign', T.plane(), [-L / 2 - 0.9, 94 + sag, 0], [W * 0.62, W * 0.62 * 48 / 192, 1], [0, -Math.PI / 2, 0], '#ffffff', { uv: dressUV('v_bus_big'), noAO: true, noJitter: true });
}

/** A company's name and colours on a box trailer (chosen per obstacle id). */
export function trailerLivery(B, o, L, W, sag) {
  const h = hash01(o.id * 29 + 5);
  if (h > 0.5) return;
  const cell = h < 0.17 ? 'v_swift' : h < 0.34 ? 'v_bread' : 'v_plumb';
  for (const sd of [-1, 1]) B.add('sign', T.plane(), [L * 0.04, 80 + sag, sd * (W / 2 + 1.1)], [L * 0.5, L * 0.5 * 64 / 256, 1], side(sd), '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
}

void mixHex;
