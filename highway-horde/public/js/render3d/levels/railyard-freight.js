// The Rail Yard's freight terminal: container stacks (walls tagged 'stack', `label` = how many high), the
// rail-mounted gantry crane over the loading tracks, the grain elevator beyond the fence, the warehouses'
// loading docks, the Checkpoint Delta sign on the main line, and the yard's backdrop of trees and hills.

import { YARD } from '../../shared/levels/railyard.js';
import { T, DET, S, CONC, RUST, STEEL, PAINTED, CORR, COL, at, pic, postSign, rod, railing, lampGlow, shadeHex, hash01, atlasUV, toWorld } from './dam-kit.js';
import { box20 } from './railyard-build.js';

const CONT = ['#2f5a78', '#7a3b2e', '#3d6b45', '#8a6d2f', '#5b6770', '#8a3a24', '#c8622a', '#4a86b8'];
const HALF = Math.PI / 2;

/** A container stack obstacle: rows of 40' boxes `label` high, a few off-set, one door open. */
export function containerStack(P, o) {
  const { B } = P;
  const L = o.w, W = o.h;
  const n = Math.max(1, Number(o.label) || 2);
  const rows = Math.max(1, Math.round(W / 60));
  const cols = Math.max(1, Math.round(L / 150));
  const cw = L / cols, rw = W / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = n - (hash01(o.id * 11 + r * 3 + c) < 0.25 ? 1 : 0);
      for (let lv = 0; lv < Math.max(1, h); lv++) {
        const jx = lv > 0 ? (hash01(o.id + r + c * 5 + lv) - 0.5) * 8 : 0;
        const col = CONT[Math.floor(hash01(o.id * 13 + r * 7 + c * 3 + lv * 17) * CONT.length)];
        box20(B, -L / 2 + (c + 0.5) * cw + jx, lv * 58, -W / 2 + (r + 0.5) * rw, cw - 4, 56, rw - 3, col, o.id + r + c + lv);
      }
    }
  }
  return true;
}

/** The rail-mounted gantry crane (a mark and its four leg obstacles): legs on rails, the girder, the trolley. */
export function rmgCrane(P, m) {
  const { B, gy, halos } = P;
  const x = m.x, yc = (m.y0 + m.y1) / 2, span = m.y1 - m.y0;
  at(B, gy, x, yc, 0, 0, 3001);
  const H = 300, Y = '#d8a21c', YD = '#a87a14';
  for (const zs of [-span / 2, span / 2]) {
    for (const dx of [-80, 80]) {
      B.rblock('std', dx, 0, zs, 50, 20, 44, 3, '#3a3c3e', null, STEEL);
      for (const w of [-14, 14]) B.cylZ('std', dx + w, 10, zs, 10, 30, '#2a2a2c', 12, STEEL);
      B.add('std', T.cyl(4, 0.75), [dx, 20 + (H - 20) / 2, zs], [18, H - 20, 16], [0, Math.PI / 4, 0], Y, PAINTED);
    }
    B.box('std', 0, H - 10, zs, 180, 24, 24, Y, null, PAINTED);
    rod(B, 'std', [-80, 40, zs], [80, H - 30, zs], 3, YD, PAINTED, 6);
  }
  // the box girders spanning the tracks, the trolley and its spreader holding a container in the air
  for (const gx of [-50, 50]) {
    B.box('std', gx, H + 20, 0, 22, 44, span + 120, Y, null, PAINTED);
    for (let z = -span / 2 - 50; z < span / 2 + 60; z += 50) B.box('std', gx, H + 20, z, 22.4, 42, 2, YD, null, PAINTED);
  }
  pic(B, 'hazard', 0, H + 20, -span / 2 - 60.5, 20, Math.PI, { w: 124 });
  const tz = 60;
  B.rblock('std', 0, H + 42, tz, 130, 36, 90, 3, '#c89818', null, PAINTED);
  B.rblock('std', 60, H - 10, tz + 20, 40, 40, 40, 3, Y, null, PAINTED);
  B.box('vglass', 80.5, H + 8, tz + 20, 1, 24, 32, '#1a2a30');
  for (const dz of [-30, 30]) for (const dx of [-40, 40]) rod(B, 'std', [dx, H + 42, tz + dz], [dx, 160, tz + dz], 0.6, '#1a1a1a', STEEL, 3);
  B.box('std', 0, 154, tz, 150, 8, 60, '#3a3a3c', null, STEEL);
  box20(B, 0, 96, tz, 150, 56, 56, '#8a3a24', 3);
  // the stair up the leg by the anchor, lamps under the girder, the warning beacon
  for (let k = 0; k < 14; k++) B.box('std', 110, 20 + k * 20, span / 2 - 30 + (k % 2) * 30, 30, 2, 26, '#4a4e52', null, STEEL);
  for (const z of [-span / 3, 0, span / 3]) lampGlow(B, halos, 0, H - 4, z, x, yc + z, '#fff0d0', { size: [30, 2, 8], k: P.day ? 0.6 : 4, halo: 120, strength: 0.6, y0: 0 });
  lampGlow(B, halos, 0, H + 70, tz, x, yc + tz, '#ff5a3a', { size: [5, 5, 5], k: 6, halo: 110, strength: 0.7, blink: 1, y0: 0, shape: 'sphere' });
}

/** The grain elevator beyond the terminal's fence (a mark): a row of concrete silos, the headhouse, spouts. */
export function grainElevator(P, m) {
  const { B, gy, halos, tier } = P;
  at(B, gy, m.x, m.y, 0, 0, 3101);
  const R = 60, H = 460, n = 6;
  const seg = tier === 'low' ? 16 : 28;
  for (let k = 0; k < n; k++) {
    for (const z of [-R, R]) {
      const x = -((n - 1) * R) + k * R * 2;
      B.cyl('std', x, 0, z, R, H, '#b8b2a4', seg, 1, null, CONC);
      B.cyl('std', x, H, z, R + 1, 6, '#9a9486', seg, 1, null, CONC);
      if (tier !== 'low') for (let y = 40; y < H; y += 60) B.cyl('std', x, y, z, R + 0.6, 1.4, '#8a857a', seg, 1, null, CONC);
    }
  }
  // the headhouse on top of the bins and the leg tower with its spouts reaching toward the track
  B.block('std', -80, H + 6, 0, 360, 110, 100, '#a8a294', null, CONC);
  for (let x = -220; x < 80; x += 50) B.box('glass', x, H + 70, 51, 24, 30, 1, '#1a2226');
  B.block('std', (n - 1) * R + 90, 0, 0, 80, H + 160, 80, '#b0aa9c', null, CONC);
  rod(B, 'std', [(n - 1) * R + 90, H + 60, 40], [(n - 1) * R + 260, 160, 380], 5, '#5a5e62', RUST, 8);
  pic(B, 'yardname', -80, H + 90, 51, 36, 0, { w: 330 });
  pic(B, 'd_streak', -200, H - 40, R + 1, 200, 0, { w: 90 });
  lampGlow(B, halos, (n - 1) * R + 90, H + 170, 0, m.x + (n - 1) * R + 90, m.y, '#ff3a2a', { size: [5, 5, 5], k: 6, halo: 140, strength: 0.8, blink: 1, y0: 0, shape: 'sphere' });
}

/** The Checkpoint Delta sign at the end of the line (a mark). */
export function backdrop(P, marks) {
  const { B, gy } = P;
  for (const m of marks) {
    if (m.t === 'delta') { at(B, gy, m.x, m.y, 0, 0, 3201); postSign(B, 'delta', 0, 0, 60, 90, m.a || 0); }
  }
}
