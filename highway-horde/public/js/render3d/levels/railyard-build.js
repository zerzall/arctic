// The Rail Yard's buildings and structures: the brick engine shed (walls with tall arched windows, the
// road doors, the roof with its smoke vents and glazing, the pits, the overhead crane, the foreman's
// office), the two-storey signal box with its outside stair and lever frame, the steel truss bridge, the
// fences, the gates' models and the small yard furniture. Coordinates: shared/levels/railyard.js (YARD).

import { YARD } from '../../shared/levels/railyard.js';
import {
  T, DET, S, CONC, RUST, STEEL, PAINTED, WOOD, CORR, PLASTER, COL, at, pic, flatPic, quad4, slopedWall, rod, railing, lampGlow, bulkhead, tubeLamp,
  shadeHex, mixHex, hash01, atlasUV, toWorld,
} from './dam-kit.js';

const BRICK = S(DET.brick, 0.9, 0);
const HALF = Math.PI / 2;
const SH = YARD.shed;

// ---- the engine shed ---------------------------------------------------------------------------------------

/** The shed's shell: brick walls with piers and arched windows, the road doors, the gables. */
export function engineShed(P) {
  const { B, gy, halos, tier } = P;
  const x0 = SH.x0, x1 = SH.x1, y0 = SH.y0, y1 = SH.y1, f = SH.floor;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, L = x1 - x0, D = y1 - y0;
  const H = f + 250;             // wall top (absolute)
  const brick = '#7a4232', brickD = '#5c2e22', trim = '#b8ae98';
  at(B, gy, cx, cy, 0, 0, 2001);
  // the long walls: a plinth, brick between piers, arched window bays (glass, some panes out), a cornice
  for (const s of [-1, 1]) {
    const z = s * D / 2;
    B.block('std', 0, 0, z, L + 24, 40, 26, '#7a6a5a', null, CONC);
    const bay = 160;
    for (let x = -L / 2; x < L / 2 - 1; x += bay) {
      const xa = x, xb = Math.min(L / 2, x + bay), xm = (xa + xb) / 2, bw = xb - xa;
      B.block('std', xa + 14, 40, z, 28, H - 40, 30, brickD, null, BRICK);               // pier
      B.block('std', xm + 7, 40, z, bw - 14, 60, 24, brick, null, BRICK);                // below the sill
      B.block('std', xm + 7, 210, z, bw - 14, H - 210, 24, brick, null, BRICK);          // above the arch
      const ww = bw - 64;
      for (const sx of [-1, 1]) B.block('std', xm + 7 + sx * (ww / 2 + 12.5), 100, z, 25, 110, 24, brick, null, BRICK);
      // the window: glazing bars over glass (a few panes broken), a stone sill and a brick arch
      B.box('std', xm + 7, 100, z + s * 4, ww + 10, 4, 30, trim, null, CONC);
      const glassZ = z - s * 2;
      for (let gx = 0; gx < 4; gx++) for (let gyy = 0; gyy < 4; gyy++) {
        const pw = ww / 4, ph = 100 / 4;
        const px = xm + 7 - ww / 2 + pw * (gx + 0.5), py = 104 + ph * (gyy + 0.5);
        if (hash01(xa * 3 + gx * 7 + gyy * 13 + s) > 0.18) B.box('vglass', px, py, glassZ, pw - 2, ph - 2, 0.5, '#3a4a4e');
      }
      for (let gx = 0; gx <= 4; gx++) B.box('std', xm + 7 - ww / 2 + (ww / 4) * gx, 154, glassZ, 1.6, 104, 2, '#2a2c2e', null, STEEL);
      for (let gyy = 0; gyy <= 4; gyy++) B.box('std', xm + 7, 104 + 25 * gyy, glassZ, ww, 1.6, 2, '#2a2c2e', null, STEEL);
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (k / 8);
        B.box('std', xm + 7 + Math.cos(a) * (ww / 2 + 4), 206 + Math.sin(a) * 10, z + s * 2, 8, 8, 26, brickD, [0, 0, a - HALF], BRICK);
      }
    }
    B.block('std', 0, H - 12, z + s * 4, L + 30, 14, 32, trim, null, CONC);
  }
  // the gables: brick with the road doors (the west middle one is the gate; the east road-3 door stands open)
  for (const e of [-1, 1]) {
    const x = e * L / 2;
    const doors = e < 0 ? [SH.roads[0], SH.roads[1], SH.roads[2]] : [SH.roads[0], SH.roads[1], SH.roads[2]];
    const cuts = doors.map((y) => [y - cy - 80, y - cy + 80]).sort((a, b) => a[0] - b[0]);
    let prev = -D / 2 - 13;
    for (const [a, b] of cuts) {
      B.block('std', x, 0, (prev + a) / 2, 26, H, a - prev, brick, null, BRICK);
      B.block('std', x, 180, (a + b) / 2, 26, H - 180, b - a, brick, null, BRICK);
      prev = b;
    }
    B.block('std', x, 0, (prev + D / 2 + 13) / 2, 26, H, D / 2 + 13 - prev, brick, null, BRICK);
    // the gable's pediment and the shed's name over the middle door
    B.add('std', T.profile('c3shedgable' + D, [[-D / 2 - 14, 0], [D / 2 + 14, 0], [0, 110]], 0, 1), [x, H, 0], [1, 1, 26], [0, HALF, 0], brick, BRICK);
    const face = x + e * 13.5, ry = e < 0 ? -HALF : HALF;
    pic(B, 'shed', face + e * 0.2, H - 58, 0, 26, ry);
    // an oculus in the pediment, a stone string course, pilasters between the doors, downpipes, soot
    B.add('glass', T.cyl(20, 1), [face + e * 0.6, H + 44, 0], [34, 1.2, 34], [0, 0, HALF], '#1a2226');
    B.add('std', T.torus(20, 0.14, 6), [face + e * 1.4, H + 44, 0], [38, 38, 6], [0, HALF, 0], trim, CONC);
    for (const a of [0, HALF]) B.add('std', T.box(), [face + e * 1.2, H + 44, 0], [2, 68, 2.4], [a, 0, 0], '#2a2c2e', STEEL);
    B.box('std', face + e * 2, H - 4, 0, 5, 8, D + 30, trim, null, CONC);
    B.box('std', face + e * 2, 182, 0, 5, 6, D + 30, trim, null, CONC);
    const piers = [-D / 2 - 6, D / 2 + 6];
    for (let k = 0; k < cuts.length - 1; k++) piers.push((cuts[k][1] + cuts[k + 1][0]) / 2);
    for (const z of piers) {
      B.block('std', face + e * 3, 0, z, 7, H - 8, 34, brickD, null, BRICK);
      B.block('std', face + e * 3, 0, z, 9, 36, 38, '#7a6a5a', null, CONC);
    }
    for (const s of [-1, 1]) {
      B.cyl('std', face + e * 9, 0, s * (D / 2 + 22), 2.6, H - 6, '#34373a', 8, 1, null, RUST);
      B.box('std', face + e * 9, H - 8, s * (D / 2 + 16), 7, 7, 14, '#34373a', null, RUST);
    }
    doors.forEach((y) => pic(B, 'd_soot', face + e * 0.5, 212, y - cy, 60, ry, { w: 180 }));
    // closed doors (the others): timber doors in two leaves
    doors.forEach((y, k) => {
      const z = y - cy;
      const isGate = e < 0 && k === 1;
      const isOpen = e > 0 && k === 2;
      if (isGate) return;
      if (isOpen) {
        // folded back against the wall outside
        for (const sz of [-1, 1]) B.add('std', T.box(), [x + e * 40, 90, z + sz * 84], [80, 180, 4], [0, sz * 0.2, 0], '#5a3a2a', WOOD);
        return;
      }
      for (const sz of [-1, 1]) {
        B.box('std', x, 90, z + sz * 40, 6, 176, 78, '#5a3a2a', null, WOOD);
        for (let k2 = 0; k2 < 3; k2++) B.box('std', x + e * 3.4, 40 + k2 * 55, z + sz * 40, 1, 6, 76, '#3a2a1c', [0, 0, 0], WOOD);
      }
      if (e < 0) pic(B, 'd_graf' + (1 + (k % 4)), x - 3.6, 60, z, 30, -HALF);
    });
  }
  // the floor slab over the raised terrain and the pits' walls, rims and lights
  for (const p of P.pits) {
    const pcx = (p.x0 + p.x1) / 2 - cx, pcz = (p.y0 + p.y1) / 2 - cy, pl = p.x1 - p.x0, pw = p.y1 - p.y0;
    for (const s of [-1, 1]) {
      B.box('std', pcx, f / 2, pcz + s * (pw / 2 - 0.5), pl, f, 1, '#7a766c', null, { ...CONC, noJitter: true });
      B.box('std', pcx, f + 0.3, pcz + s * (pw / 2 + 4), pl, 0.6, 8, COL.yellow, null, { ...PAINTED, noJitter: true });
    }
    for (const e of [-1, 1]) B.box('std', pcx + e * (pl / 2 - 0.5), f / 2, pcz, 1, f, pw, '#7a766c', null, CONC);
    B.box('std', pcx, 0.4, pcz, pl, 0.8, pw, '#2a2622', null, S(DET.concrete, 0.7, 0));
    // steps down at the east end, oil in the bottom, caged lamps on the pit walls
    for (let k = 0; k < 3; k++) B.box('std', pcx + pl / 2 - 20 - k * 12, (k + 1) * 8, pcz, 12, 3, pw - 4, '#6a665e', null, CONC);
    flatPic(B, 'd_soot', pcx - 100, 0.9, pcz, 200, pw - 6, 0);
    for (let x = -pl / 2 + 120; x < pl / 2; x += 260) {
      const [wx, wy] = [x + cx + pcx, pcz + cy - pw / 2 + 2];
      bulkhead(B, halos, pcx + x, f - 10, pcz - pw / 2 + 0.5, wx, wy, '#ffc070', { y0: 0, halo: 30 });
    }
  }
  // the overhead crane: runway beams along the long walls, the bridge girder over road 2
  const rw = f + 200;
  for (const s of [-1, 1]) {
    B.box('std', 0, rw, s * (D / 2 - 30), L - 60, 12, 10, '#3a3e42', null, STEEL);
    for (let x = -L / 2 + 80; x < L / 2; x += 160) B.box('std', x, rw - 50, s * (D / 2 - 26), 8, 100, 8, '#3a3e42', null, STEEL);
  }
  const bx = 4000 - cx;
  for (const s of [-1, 1]) B.box('std', bx + s * 20, rw + 14, 0, 12, 22, D - 50, '#c89818', null, PAINTED);
  pic(B, 'hazard', bx - 26.5, rw + 14, 0, 10, -HALF, { w: 300 });
  B.rblock('std', bx, rw + 24, -120, 54, 22, 44, 2, '#a87a14', null, PAINTED);
  for (const dx of [-5, 5]) rod(B, 'std', [bx + dx, rw + 24, -120], [bx + dx, f + 70, -120], 0.6, '#1a1a1a', STEEL, 4);
  B.rblock('std', bx, f + 52, -120, 18, 18, 12, 2, '#c89818', null, PAINTED);
  B.add('std', T.torus(10, 0.3, 6), [bx, f + 44, -120], [7, 7, 7], null, '#3a3a3a', STEEL);
  // the pendant control hanging by the anchor
  rod(B, 'std', [bx + 20, rw + 10, -120], [bx + 20, f + 50, -120], 0.4, '#1a1a1a', STEEL, 3);
  B.rblock('std', bx + 20, f + 40, -120, 6, 12, 5, 1, '#e0b020', null, PAINTED);
  // high-bay lamps under the roof where the layout put them
  for (let k = 0; k < 4; k++) {
    const lx = 3650 + k * 380 - cx;
    rod(B, 'std', [lx, H + 40, 0], [lx, H - 20, 0], 0.6, '#1a1a1a', STEEL, 4);
    B.add('std', T.cyl(12, 0.35, true), [lx, H - 30, 0], [14, 12, 14], [Math.PI, 0, 0], '#4a4e52', STEEL);
    lampGlow(B, halos, lx, H - 34, 0, lx + cx, cy, '#ffd0a0', { size: [16, 1.5, 16], k: P.day ? 1.2 : 3, halo: 130, strength: 0.55, flicker: k === 1 ? 0.3 : 0, y0: 0 });
  }
  void tier;
}

/** The shed's roof (roof style 'shed'): a pitched roof on trusses with a raised smoke vent and glazing. */
export function shedRoof(P) {
  const { B, gy } = P;
  const x0 = SH.x0, x1 = SH.x1, y0 = SH.y0, y1 = SH.y1, f = SH.floor;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, L = x1 - x0, D = y1 - y0;
  const H = f + 250, rise = 110;
  at(B, gy, cx, cy, 0, 0, 2101);
  const slope = Math.atan2(rise, D / 2), len = Math.hypot(rise, D / 2);
  for (const s of [-1, 1]) {
    // slates on the outside, boards on the inside; a glazed band in each pitch
    B.add('std', T.box(), [0, H + rise / 2, s * D / 4], [L + 40, 3, len * 0.64], [s * slope, 0, 0], '#3e4448', S(DET.shingle, 0.8, 0.1));
    B.add('std', T.box(), [0, H + rise * 0.18, s * (D / 2 - D * 0.09)], [L + 40, 3, len * 0.2], [s * slope, 0, 0], '#3e4448', S(DET.shingle, 0.8, 0.1));
    B.add('vglass', T.box(), [0, H + rise * 0.56 - 12, s * (D / 4 - 20)], [L - 40, 1, len * 0.18], [s * slope, 0, 0], '#9ab0b8');
    B.add('std', T.box(), [0, H + rise / 2 - 3, s * D / 4], [L + 30, 1, len * 0.9], [s * slope, 0, 0], '#5a4a3a', WOOD);
  }
  // the smoke vent along the ridge: a raised louvred box
  B.box('std', 0, H + rise + 10, 0, L - 120, 30, 60, '#2a2c2e', null, STEEL);
  for (let x = -L / 2 + 80; x < L / 2 - 60; x += 12) for (const s of [-1, 1]) B.box('std', x, H + rise + 10, s * 30, 8, 24, 1, '#1a1a1c', [0.4 * s, 0, 0], STEEL);
  B.add('std', T.box(), [0, H + rise + 30, 0], [L - 110, 3, 80], null, '#3a3e40', S(DET.metalroof, 0.6, 0.4));
  // the trusses
  for (let x = -L / 2 + 80; x < L / 2; x += 160) {
    B.box('std', x, H, 0, 8, 8, D, '#2a2c2e', null, STEEL);
    for (const s of [-1, 1]) {
      rod(B, 'std', [x, H, s * D / 2], [x, H + rise, 0], 3, '#2a2c2e', STEEL, 5);
      for (let k = 1; k < 4; k++) {
        const z = s * (D / 2) * (1 - k / 4);
        rod(B, 'std', [x, H, z], [x, H + rise * (k / 4), z], 1.2, '#2a2c2e', STEEL, 4);
        rod(B, 'std', [x, H, s * (D / 2) * (1 - (k - 1) / 4)], [x, H + rise * (k / 4), z], 1.2, '#2a2c2e', STEEL, 4);
      }
    }
  }
}

/** The foreman's office in the shed (roof style 'shedoffice'): a ceiling, a lamp, a window onto the shed. */
export function shedOffice(P, r) {
  const { B, gy, halos } = P;
  at(B, gy, r.x, r.y, SH.floor, 0, 2201);
  B.box('std', 0, 133, 0, r.w, 6, r.h, '#8a867c', null, CONC);
  tubeLamp(B, halos, 0, 128, 0, 60, r.x, r.y, { y0: SH.floor, flicker: 0.2 });
  // walls (inside faces), the window onto the shed with a desk lamp's view
  pic(B, 'timetable', 0, 80, -r.h / 2 + 12.6, 40, 0);
  pic(B, 'calendar', 90, 80, -r.h / 2 + 12.6, 34, 0);
  pic(B, 'diagram', -60, 80, r.h / 2 - 12.6, 26, Math.PI);
}

/** Office and signal-box walls (styles 'officewall', 'boxwall'), the shed walls (drawn by engineShed). */
export function yardWall(P, o) {
  const { B } = P;
  const L = Math.max(o.w, o.h), along = o.w >= o.h, t = Math.min(o.w, o.h);
  if (!along) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
  switch (o.style) {
    case 'shedwall': case 'bridgehead': case 'bankwall': case 'stackwall': {
      if (o.style === 'shedwall') return true;
      if (o.style === 'stackwall') return stackWall(P, o, L, t);
      // a concrete river wall / bridgehead with a railing
      B.block('std', 0, 0, 0, L, 60, t, '#8a867c', null, CONC);
      railing(B, -L / 2, 0, L / 2, 0, 60, 30, '#6a6e72', { step: 60 });
      if (o.style === 'bridgehead' && L > 400) pic(B, 'trespass', 0, 36, -t / 2 - 0.4, 24, Math.PI);
      return true;
    }
    case 'officewall': {
      B.block('std', 0, 0, 0, L, 130, t, '#b8b0a0', null, PLASTER);
      B.box('std', 0, 26, 0, L + 0.2, 52, t + 1.2, '#5a6a62', null, PAINTED);
      if (L > 250) {
        B.box('std', 0, 90, 0, L * 0.5, 40, t + 1, '#2a2c2e', null, STEEL);
        B.box('vglass', 0, 90, 0, L * 0.5 - 6, 34, t + 1.6, '#2a3a40');
      }
      return true;
    }
    case 'boxwall': {
      // the signal box: a brick lower storey, the timber lever room above with windows all round
      const X = YARD.box, f = X.floor;
      B.block('std', 0, 0, 0, L, f, t, '#8a4a34', null, BRICK);
      B.block('std', 0, f, 0, L, 30, t, '#3a4a3a', null, WOOD);
      B.block('std', 0, f + 110, 0, L, 20, t, '#3a4a3a', null, WOOD);
      for (let x = -L / 2 + 20; x < L / 2 - 10; x += 40) {
        B.box('std', x, f + 70, 0, 4, 80, t + 2, '#e8e2d0', null, WOOD);
        B.box('vglass', x + 20, f + 70, 0, 36, 76, 1, '#1e2a2e');   // (one thin pane: a thick glass box reads white)
      }
      B.box('std', 0, f + 30, 0, L, 3, t + 4, '#e8e2d0', null, WOOD);
      return true;
    }
    case 'yardfence': {
      for (let x = -L / 2; x <= L / 2; x += 100) {
        B.box('std', x, 50, 0, 6, 100, 6, '#8a867c', null, CONC);
        rod(B, 'std', [x, 100, 0], [x, 112, -8], 0.8, '#5a5e62', STEEL, 3);
      }
      B.add('fence', T.plane(), [0, 50, 0], [L, 96, 1], null, '#9aa0a4', { uvScale: [L / 26, 96 / 26] });
      B.add('fence', T.plane(), [0, 50, 0], [L, 96, 1], [0, Math.PI, 0], '#9aa0a4', { uvScale: [L / 26, 96 / 26] });
      for (const [y, z] of [[104, -3], [108, -6], [112, -9]]) rod(B, 'std', [-L / 2, y, z], [L / 2, y, z], 0.35, '#4a4a4a', STEEL, 3);
      if (L > 600 && hash01(o.id) < 0.5) pic(B, 'trespass', 0, 60, 1, 24, 0);
      return true;
    }
    case 'stairrail': {
      railing(B, -L / 2, 0, L / 2, 0, 0, 40, '#e8e2d0', { step: 30 });
      return true;
    }
    case 'truss': return true;   // (the bridge draws its trusses)
    default: return false;
  }
}

/** The throat's walls of containers (style 'stackwall'): stacks three high, doors and markings. */
function stackWall(P, o, L, t) {
  const { B } = P;
  const cols = ['#2f5a78', '#7a3b2e', '#3d6b45', '#8a6d2f', '#5b6770', '#8a3a24'];
  const n = Math.max(1, Math.round(L / 150));
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + (k + 0.5) * (L / n);
    for (let lv = 0; lv < 3; lv++) {
      if (lv === 2 && hash01(o.id * 7 + k) < 0.4) continue;
      box20(B, x, lv * 58, 0, L / n - 4, 56, Math.max(t, 56), cols[Math.floor(hash01(o.id * 13 + k * 3 + lv) * cols.length)], k + lv);
    }
  }
  return true;
}

/** One shipping container standing on y0 (length along x): ribs, doors on one end, a logo. */
export function box20(B, x, y0, z, L, H, W, col, seed, o = {}) {
  B.block('std', x, y0, z, L, H, W, col, null, { surf: [DET.corrugated, 0.55, 0.45] });
  B.box('std', x, y0 + H - 1, z, L + 1, 2, W + 1, shadeHex(col, -0.25), null, RUST);
  B.box('std', x, y0 + 1, z, L + 1, 2, W + 1, shadeHex(col, -0.25), null, RUST);
  for (const e of [-1, 1]) B.box('std', x + e * (L / 2 - 1), y0 + H / 2, z, 2, H, W + 1, shadeHex(col, -0.2), null, RUST);
  if (!o.noLogo) {
    const cell = ['cont0', 'cont1', 'cont2', 'cont3'][seed % 4];
    pic(B, cell, x, y0 + H * 0.55, z + W / 2 + 0.3, H * 0.3, 0, { w: L * 0.6 });
    pic(B, cell, x, y0 + H * 0.55, z - W / 2 - 0.3, H * 0.3, Math.PI, { w: L * 0.6 });
  }
}

// ---- the signal box -----------------------------------------------------------------------------------------

/** The signal box's roof, the lever frame's room (roof style 'leverroom') and its outside stair. */
export function signalBox(P, fl) {
  const { B, gy, halos } = P;
  const X = YARD.box, f = X.floor;
  const cx = (X.x0 + X.x1) / 2, cy = (X.y0 + X.y1) / 2, L = X.x1 - X.x0, D = X.y1 - X.y0;
  at(B, gy, cx, cy, 0, 0, 2301);
  // the hipped roof with a deep overhang, a chimney, the name boards
  B.add('std', T.cyl(4, 0.45), [0, f + 150, 0], [(L + 40) * 0.72, 44, (D + 40) * 0.72], [0, Math.PI / 4, 0], '#3e4448', S(DET.shingle, 0.8, 0.1));
  B.box('std', 0, f + 128, 0, L + 30, 4, D + 30, '#3a4a3a', null, WOOD);
  B.block('std', L / 2 - 40, f + 130, -20, 18, 60, 18, '#8a4a34', null, BRICK);
  pic(B, 'signalbox', 0, f + 118, D / 2 + 11, 18, 0, { w: 160 });
  pic(B, 'signalbox', 0, f + 118, -D / 2 - 11, 18, Math.PI, { w: 160 });
  // the lever room inside: the floor boards, the diagram over the frame, the block shelf, a stove
  B.box('std', 0, f + 0.6, 0, L - 20, 1.2, D - 20, '#6a5238', null, WOOD);
  pic(B, 'diagram', 0, f + 96, D / 2 - 10.6, 26, Math.PI, { w: 150 });
  B.box('std', 0, f + 60, D / 2 - 14, L - 40, 3, 12, '#5a4a3a', null, WOOD);
  for (let k = 0; k < 6; k++) B.rblock('std', -90 + k * 36, f + 61.5, D / 2 - 14, 18, 16, 10, 1.5, '#6a4a2c', null, WOOD);
  B.cyl('std', -L / 2 + 30, f, -D / 2 + 30, 10, 36, '#2a2a2c', 12, 1, null, RUST);
  rod(B, 'std', [-L / 2 + 30, f + 36, -D / 2 + 30], [-L / 2 + 30, f + 130, -D / 2 + 30], 2.4, '#2a2a2c', RUST, 6);
  tubeLamp(B, halos, 0, f + 120, 0, 50, cx, cy, { y0: 0, color: '#ffe8c0' });
  // the stair: its treads and stringers over the terrain flight, the landing's deck
  if (fl) {
    const n = fl.n, run = (fl.y1 - fl.y0) / n, rise = (fl.h1 - fl.h0) / n;
    at(B, gy, (fl.x0 + fl.x1) / 2, fl.y1, 0, 0, 2302);
    for (let k = 0; k < n; k++) {
      const z = -(k + 0.5) * run, top = rise * (k + 1);
      B.box('std', 0, top - 2, z, fl.x1 - fl.x0, 4, run + 1, '#5a4a3a', null, WOOD);
    }
    for (const s of [-1, 1]) {
      const x = s * ((fl.x1 - fl.x0) / 2 + 2);
      rod(B, 'std', [x, 0, 0], [x, fl.h1, -(fl.y1 - fl.y0)], 2, '#3a3e3a', STEEL, 5);
    }
    at(B, gy, (fl.x0 + X.x0 + 10) / 2, fl.y0 - 45, 0, 0, 2303);
    B.box('std', 0, f - 2, 0, X.x0 + 10 - fl.x0, 4, 90, '#5a4a3a', null, WOOD);
    for (const [x, z] of [[-40, -40], [40, -40], [-40, 40]]) B.cyl('std', x, 0, z, 3, f - 4, '#3a3e3a', 8, 1, null, STEEL);
  }
}

/** The lever frame (style 'leverframe'): a row of levers painted by function, catch handles, name plates. */
export function leverFrame(P, o) {
  const { B } = P;
  const L = o.w, W = o.h;
  B.box('std', 0, 6, 0, L, 12, W, '#3a3e3a', null, STEEL);
  const cols = ['#b8261c', '#b8261c', '#e0b020', '#1c1c1e', '#1c1c1e', '#2a4a9a', '#b8261c', '#1c1c1e', '#b8261c', '#e0b020', '#1c1c1e', '#b8261c'];
  for (let k = 0; k < 12; k++) {
    const x = -L / 2 + 10 + k * ((L - 20) / 11);
    const pulled = hash01(k * 5) < 0.35;
    rod(B, 'std', [x, 12, 0], [x, 58, pulled ? -14 : 8], 1.4, cols[k], PAINTED, 5);
    B.box('std', x, 58, pulled ? -14 : 8, 3, 6, 3, '#d8d0b8', null, STEEL);
  }
  pic(B, 'lever', 0, 18, -W / 2 - 0.4, 6, Math.PI, { w: L - 10 });
  return true;
}

// ---- the bridge ---------------------------------------------------------------------------------------------------

/** The steel through-truss bridge over the river (a mark): spans of Pratt trusses, portals, piers, the deck. */
export function trussBridge(P, m) {
  const { B, gy, tier } = P;
  const spans = m.spans || 3;
  const x0 = m.x0 - 60, x1 = m.x1 + 60, y0 = m.y0 + 6, y1 = m.y1 - 6;
  const SL = (x1 - x0) / spans;
  const H = 180, panel = SL / 8;
  const col = '#5a6a6e', colD = '#3e4a4e';
  for (let s = 0; s < spans; s++) {
    const sx0 = x0 + s * SL, sx1 = sx0 + SL, scx = (sx0 + sx1) / 2;
    at(B, gy, scx, (y0 + y1) / 2, 0, 0, 2400 + s);
    const hw = (y1 - y0) / 2;
    for (const side of [-1, 1]) {
      const z = side * hw;
      // chords: the bottom chord along the deck, the top chord between the end posts
      B.box('std', 0, 10, z, SL, 20, 10, colD, null, RUST);
      B.box('std', 0, H, z, SL - panel * 2, 14, 12, col, null, RUST);
      // end posts inclined, verticals and diagonals (Pratt: diagonals slope toward the middle)
      rod(B, 'std', [-SL / 2, 18, z], [-SL / 2 + panel, H, z], 4, col, RUST, 6);
      rod(B, 'std', [SL / 2, 18, z], [SL / 2 - panel, H, z], 4, col, RUST, 6);
      for (let k = 1; k < 8; k++) {
        const x = -SL / 2 + k * panel;
        rod(B, 'std', [x, 18, z], [x, H, z], 2.4, col, RUST, 5);
        if (tier !== 'low') {
          const toward = x < 0 ? 1 : -1;
          if (k !== 4) rod(B, 'std', [x, H, z], [x + toward * panel, 18, z], 1.8, colD, RUST, 4);
        }
      }
      // rivet plates at the panel points
      if (tier !== 'low') for (let k = 1; k < 8; k++) B.box('std', -SL / 2 + k * panel, 20, z, 16, 16, 12, colD, null, RUST);
    }
    // top lateral bracing and the portal frames at the span ends
    for (let k = 1; k < 8; k++) B.box('std', -SL / 2 + k * panel, H + 2, 0, 5, 6, hw * 2, colD, null, RUST);
    if (tier !== 'low') for (let k = 1; k < 7; k++) rod(B, 'std', [-SL / 2 + k * panel, H + 4, -hw], [-SL / 2 + (k + 1) * panel, H + 4, hw], 1, colD, RUST, 3);
    for (const e of [-1, 1]) {
      const x = e * (SL / 2 - panel * 0.7);
      B.box('std', x, H - 24, 0, 8, 22, hw * 2, col, null, RUST);
      for (const zz of [-1, 1]) rod(B, 'std', [x, H - 36, zz * hw], [x, H - 60, zz * (hw - 30)], 1.6, colD, RUST, 4);
    }
    pic(B, 'bridgemp', -SL / 2 + panel * 0.7, H - 24, -hw + 0.1, 12, 0, { w: 90 });
    // the deck: cross girders under a steel plate with a walkway grating each side
    B.box('std', 0, -3, 0, SL, 6, hw * 2 + 8, '#4a4e50', null, S(DET.panel, 0.6, 0.5));
    for (const side of [-1, 1]) B.box('std', 0, 0.5, side * (hw - 18), SL, 1, 28, '#5a5e60', null, STEEL);
    // the pier under the span's east end (the last span ends on the bank)
    if (s < spans - 1) {
      at(B, gy, sx1, (y0 + y1) / 2, -80, 0, 2410 + s);
      B.rblock('std', 0, 0, 0, 60, 76, (y1 - y0) + 60, 4, COL.concD, null, CONC);
      B.add('std', T.cyl(12, 1), [0, 0, -(y1 - y0) / 2 - 30], [30, 76, 30], null, COL.concD, CONC);
      B.add('std', T.cyl(12, 1), [0, 0, (y1 - y0) / 2 + 30], [30, 76, 30], null, COL.concD, CONC);
      B.box('std', 0, 60, 0, 61, 12, (y1 - y0) + 61, '#4a4a3e', null, CONC);
    }
  }
}

// ---- the gates' models -------------------------------------------------------------------------------------------

/** A gate piece's model by style (also the engine's art.gateModel). */
export function yardGate(P, o) {
  const { B } = P;
  const L = Math.max(o.w, o.h), along = o.w >= o.h, t = Math.min(o.w, o.h);
  if (!along) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
  switch (o.style) {
    case 'shedshutter': {
      const H = 176;
      for (let y = 4; y < H; y += 6) B.box('std', 0, y, 0, L - 8, 5.6, 4, y % 12 < 6 ? '#6a4a3a' : '#5e4234', null, CORR);
      B.box('std', 0, H + 10, 0, L + 10, 20, 18, '#4a4e52', null, STEEL);
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 2), H / 2, 0, 5, H + 6, 8, '#3a3e42', null, STEEL);
      pic(B, 'hazard', 0, 12, -2.2, 8, Math.PI, { w: L - 10 });
      pic(B, 'd_graf4', 0, 80, -2.3, 40, Math.PI);
      return true;
    }
    case 'slidegate': {
      const H = 110;
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 3), H / 2 + 4, 0, 6, H, 6, '#8a8e92', null, STEEL);
      for (const y of [8, H, H * 0.55]) B.box('std', 0, y, 0, L, 5, 5, '#8a8e92', null, STEEL);
      B.add('fence', T.plane(), [0, H / 2 + 4, 0], [L - 6, H - 8, 1], null, '#9aa0a4', { uvScale: [(L - 6) / 26, (H - 8) / 26] });
      B.add('fence', T.plane(), [0, H / 2 + 4, 0], [L - 6, H - 8, 1], [0, Math.PI, 0], '#9aa0a4', { uvScale: [(L - 6) / 26, (H - 8) / 26] });
      pic(B, 'trespass', 0, 60, -3, 22, Math.PI);
      return true;
    }
    case 'portcullis': {
      const H = 160;
      B.box('std', 0, H + 20, 0, L + 20, 30, 30, '#3a3e42', null, STEEL);
      for (let x = -L / 2 + 8; x <= L / 2 - 8; x += 14) B.box('std', x, H / 2, 0, 3, H, 3, '#4a4e52', null, RUST);
      for (const y of [12, 60, 110, 150]) B.box('std', 0, y, 0, L - 4, 5, 5, '#4a4e52', null, RUST);
      pic(B, 'hazard', 0, H + 20, -15.2, 10, Math.PI, { w: L });
      return true;
    }
    case 'fencepanel': {
      const H = 110;
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 3), H / 2, 0, 5, H, 5, '#8a8e92', null, STEEL);
      B.box('std', 0, H, 0, L, 4, 4, '#8a8e92', null, STEEL);
      B.add('fence', T.plane(), [0, H / 2, 0], [L - 6, H - 4, 1], null, '#9aa0a4', { uvScale: [(L - 6) / 26, (H - 4) / 26] });
      B.add('fence', T.plane(), [0, H / 2, 0], [L - 6, H - 4, 1], [0, Math.PI, 0], '#9aa0a4', { uvScale: [(L - 6) / 26, (H - 4) / 26] });
      for (const z of [-3, 3]) rod(B, 'std', [-L / 2, H + 10, z], [L / 2, H + 10, z], 0.35, '#4a4a4a', STEEL, 3);
      pic(B, 'quarantine', 0, 60, -1.6, 22, Math.PI, { w: 110 });
      return true;
    }
    case 'boxcargate': {
      // the boxcar across the line: drawn as a wagon along the gap
      const saved = { ...o, w: L, h: t };
      B.obj(o.x, o.y, (o.a || 0) + (along ? 0 : HALF), o.id * 31);
      return P.wagon({ ...saved, style: 'boxcar' });
    }
    default: return false;
  }
}

// ---- small furniture ------------------------------------------------------------------------------------------

/** Styled furniture of the yard (bench, lathe, drums, wheels, sleepers, speeder, ground frame, switch stand, fuel tank). */
export function yardProp(P, o) {
  const { B } = P;
  const L = o.w, W = o.h;
  switch (o.style) {
    case 'bench': {
      B.rblock('std', 0, 34, 0, L, 4, W, 1, '#5a4a3a', null, WOOD);
      for (const x of [-L / 2 + 8, L / 2 - 8]) B.block('std', x, 0, 0, 8, 34, W - 6, '#3a3e42', null, STEEL);
      B.cyl('std', -L / 4, 38, 0, 6, 14, '#3a4a5a', 10, 1, null, STEEL);
      B.rblock('std', L / 4, 38, 0, 20, 8, 12, 1, '#b8261c', null, PAINTED);
      rod(B, 'std', [0, 39, 0], [16, 39, 8], 0.8, '#8a8e92', STEEL, 4);
      return true;
    }
    case 'lathe': {
      B.rblock('std', 0, 0, 0, L, 40, W * 0.6, 2, '#4a6a5a', null, PAINTED);
      for (const s of [-1, 1]) B.cylX('std', s * L * 0.3, 60, 0, 24, 10, '#2a2a2c', 18, STEEL);
      B.cylX('std', 0, 60, 0, 4, L * 0.7, '#6a6e72', 10, STEEL);
      return true;
    }
    case 'drums': {
      for (let k = 0; k < 4; k++) B.cyl('std', (k % 2 - 0.5) * 22, 0, (Math.floor(k / 2) - 0.5) * 22, 10.5, 30, ['#3b5f8a', '#7a3a2a', '#4a5a3a', '#2a2a2c'][k], 14, 1, null, RUST);
      return true;
    }
    case 'wheels': {
      for (let k = 0; k < 2; k++) {
        B.cylZ('std', 0, 16, -12 + k * 24, 15.6, 5, '#2a2b2e', 18, RUST);
        B.cylZ('std', 0, 16, 0, 2, 40, '#3a3a3c', 8, STEEL);
      }
      return true;
    }
    case 'sleepers': {
      for (let row = 0; row < 4; row++) for (let i = 0; i < 4; i++) B.rblock('std', 0, row * 6.4, (i - 1.5) * 9 + (row % 2) * 3, L, 6, 8, 0.5, mixHex('#3a2a20', '#5a4634', hash01(row * 7 + i)), [0, (hash01(row + i * 3) - 0.5) * 0.06, 0], WOOD);
      return true;
    }
    case 'speeder': {
      for (const s of [-1, 1]) for (const dx of [-20, 20]) B.cylZ('std', dx, 6, s * 11.5, 6, 2, '#2a2a2c', 10, STEEL);
      B.rblock('std', 0, 8, 0, L - 8, 14, W - 8, 2, '#c8a020', null, PAINTED);
      B.rblock('std', -6, 22, 0, 30, 20, W - 12, 2, '#c8a020', null, PAINTED);
      B.box('glass', 9.5, 32, 0, 1, 12, W - 16, '#1a2a30');
      return true;
    }
    case 'groundframe': case 'switchstand': {
      B.block('std', 0, 0, 0, L, 10, W, '#5a5e62', null, STEEL);
      rod(B, 'std', [0, 10, 0], [0, 50, 0], 2, '#3a3e42', STEEL, 6);
      B.box('std', 0, 54, 0, 16, 16, 2, '#e8e2d0', null, PAINTED);
      B.box('std', 0, 54, 1.2, 12, 4, 0.5, '#b8261c', null, PAINTED);
      rod(B, 'std', [4, 12, 0], [22, 34, 0], 1.4, '#b8261c', PAINTED, 5);
      return true;
    }
    case 'fueltank': {
      B.cylX('std', 0, 32, 0, 28, L - 10, '#c8c4b8', 18, PAINTED);
      for (const x of [-L / 3, L / 3]) B.block('std', x, 0, 0, 10, 10, W - 10, COL.concD, null, CONC);
      pic(B, 'fuel', 0, 32, 28.5, 18, 0);
      return true;
    }
    case 'reachstacker': {
      for (const s of [-1, 1]) for (const dx of [-50, 40]) B.cylZ('std', dx, 18, s * 36, 18, 14, '#1a1a1a', 14, S(DET.rubber, 0.9, 0));
      B.rblock('std', 0, 18, 0, L - 20, 30, W - 30, 3, '#c8622a', null, PAINTED);
      B.rblock('std', -40, 48, 0, 40, 40, 36, 3, '#c8622a', null, PAINTED);
      B.box('vglass', -19.5, 72, 0, 1, 24, 30, '#1a2a30');
      rod(B, 'std', [-20, 50, 0], [110, 150, 0], 8, '#c8622a', PAINTED, 8);
      B.box('std', 118, 150, 0, 16, 10, 90, '#3a3a3c', null, STEEL);
      return true;
    }
    case 'opencontainer': {
      box20(B, 0, 0, 0, L, 62, W, o.color || '#8a6d2f', 2);
      // doors swung open at the +x end, crates inside
      for (const s of [-1, 1]) B.add('std', T.box(), [L / 2 + 10, 31, s * (W / 2 + 12)], [26, 60, 2], [0, s * 0.9, 0], shadeHex(o.color || '#8a6d2f', -0.1), { surf: [DET.corrugated, 0.55, 0.45] });
      for (let k = 0; k < 4; k++) B.rblock('std', L / 2 - 20 - k * 16, 0, (k % 2 - 0.5) * 20, 14, 16 + (k % 2) * 6, 14, 0.6, '#4b5320', null, S(DET.panel, 0.6, 0.4));
      return true;
    }
    default: return false;
  }
}
