// Set dressing in the classic top-down view: the flat marks (skid marks, puddles, stains,
// leaves, chalk outlines) and simple glyphs for the props people would notice from above
// (barrels, crates, benches, tents, bales, boulders, logs, bushes, poles and wires...).
// Painted into the baked ground chunks by maplayer.js paintGround when the renderer
// attached the list (`prep.dress`, shared/dress.js); the 3D ground never does.

import { DRESS_KINDS } from '../shared/dress.js';

// kind → [shape, fill, w, h] (w/h = the drawn size in world units; the item's scale multiplies them)
const GLYPH = {
  bench: ['rect', '#6b4a2c', 40, 12], busstop: ['rect', 'rgba(150,170,180,0.8)', 30, 56], mailbox: ['circle', '#3a3c40', 7, 7], postbox: ['circle', '#1c4fa8', 9, 9],
  phone: ['rect', '#a01818', 18, 18], bin: ['circle', '#3a4a3a', 11, 11], bin_fall: ['rect', '#3a4a3a', 22, 11], meter: ['circle', '#5a5e62', 5, 5],
  hydrant: ['circle', '#c8281e', 8, 8], vend: ['rect', '#c91d24', 16, 30], newsbox: ['rect', '#c8281e', 10, 10], billboard: ['rect', '#2c2f33', 10, 220],
  barrel_t: ['circle', '#e8641c', 11, 11], bollard: ['circle', '#3a3e42', 6, 6], bikerack: ['rect', '#9aa0a4', 6, 30], planter: ['rect', '#8a877e', 24, 12],
  pole: ['circle', '#4a3a2a', 8, 8], lamp_old: ['circle', '#1e2a26', 8, 8], atm: ['rect', '#8a8e92', 14, 22], flagpole: ['circle', '#c9ced3', 6, 6],
  pallet: ['rect', '#8a6a44', 36, 27], pallets: ['rect', '#a98552', 36, 27], crate: ['rect', '#7a5a32', 22, 16], crates: ['rect', '#7a5a32', 46, 24],
  drum: ['circle', '#2a5a9a', 17, 17], drums: ['rect', '#2a5a9a', 36, 36], pipes: ['rect', '#8a877e', 60, 30], generator: ['rect', '#d8281e', 22, 18],
  forklift: ['rect', '#e0a020', 60, 22], hay: ['circle', '#b09a50', 34, 34], hay_sq: ['rect', '#b09a50', 24, 13], tractor: ['rect', '#2f6a3a', 62, 30],
  watertower: ['circle', '#c8ccc8', 84, 84], reel: ['circle', '#7a5a34', 28, 28], woodpile: ['rect', '#6b4a2c', 24, 30], wheelbarrow: ['rect', '#2f6a3a', 30, 12],
  gascyl: ['circle', '#c8ccc8', 10, 10], ibc: ['rect', '#dfe6ea', 30, 26], trough: ['rect', '#7a7e82', 44, 12],
  stroller: ['rect', '#2a5ac4', 22, 12], bicycle: ['rect', '#5a5e62', 30, 5], cart: ['rect', '#c9ced3', 24, 14], picnic: ['rect', '#8a6a44', 46, 42],
  tent_camp: ['blob', '#5a6340', 46, 40], chair: ['rect', '#c8281e', 10, 12], sleeping_bag: ['rect', '#2f4858', 24, 9], cooler: ['rect', '#c8281e', 18, 11],
  grill: ['circle', '#1a1a1c', 14, 14], campfire: ['circle', '#2a2420', 20, 20], laundry: ['rect', '#e8e4d8', 4, 60], umbrella: ['circle', '#c8281e', 40, 40],
  wheelchair: ['rect', '#202224', 16, 16], gurney: ['rect', '#e8e8e2', 38, 13], scarecrow: ['circle', '#5a4632', 12, 12],
  barricade: ['rect', '#5a4632', 8, 64], plywood: ['rect', '#a08a60', 6, 28], bodybag: ['capsule', '#151618', 32, 10], milcrate: ['rect', '#4b5320', 24, 12],
  mil_box: ['rect', '#4b5320', 12, 8], sandarc: ['blob', '#8a7a55', 48, 20], tarp: ['rect', '#2a5ac4', 4, 42], medtent: ['rect', '#e2ddc8', 64, 44],
  shrine: ['circle', '#d8281e', 20, 20], cross: ['circle', '#e8e4d8', 8, 8], sawhorse: ['rect', '#c8281e', 8, 44],
  log: ['capsule', '#4a3a2a', 80, 11], stump: ['circle', '#5a4632', 12, 12], boulders: ['blob', '#6d6a63', 44, 36], shrub: ['blob', '#2f4a26', 28, 26],
  fern: ['blob', '#3a5a2c', 22, 22], flowers: ['dots', '#f2d020', 22, 22], tallgrass: ['blob', 'rgba(150,130,60,0.7)', 26, 26], mushrooms: ['circle', '#c8281e', 6, 6],
  deadtree: ['circle', '#4a4238', 14, 14], reeds: ['blob', '#6a7a38', 24, 24], driftwood: ['capsule', '#b8b09a', 44, 6], rowboat: ['blob', '#3a5a7a', 54, 22],
  suitcase: ['rect', '#7a3a2a', 22, 15], duffel: ['capsule', '#2f4858', 26, 12], backpack: ['rect', '#c8281e', 12, 14], box: ['rect', '#a98552', 12, 10],
  box_stack: ['rect', '#a98552', 18, 14], box_open: ['rect', '#a98552', 14, 11], car_door: ['rect', '#5b5f63', 34, 20], spill: ['blob', '#a98552', 46, 34],
  cone_up: ['circle', '#e8641c', 9, 9], cone_dn: ['capsule', '#e8641c', 18, 8], triangle: ['circle', '#c8281e', 10, 10], flare: ['circle', '#ff3a2a', 6, 6],
  fuel_can: ['rect', '#b81c1c', 8, 4], bumper: ['rect', '#c9ced3', 28, 5], panel: ['rect', '#5b5f63', 22, 15], wheel_loose: ['circle', '#1b1b1c', 16, 16],
};

const FLAT = {
  skid: (g, s) => { g.fillStyle = 'rgba(8,8,10,0.5)'; for (const z of [-5, 5]) g.fillRect(-60 * s, z * s - 1.6 * s, 120 * s, 3 * s); },
  tread: (g, s) => { g.fillStyle = 'rgba(8,8,10,0.4)'; for (const z of [-4, 4]) g.fillRect(-50 * s, z * s - 1.5 * s, 100 * s, 3 * s); },
  puddle: (g, s) => { g.fillStyle = 'rgba(14,26,34,0.62)'; g.beginPath(); g.ellipse(0, 0, 26 * s, 20 * s, 0.4, 0, 6.3); g.fill(); },
  mud: (g, s) => { g.fillStyle = 'rgba(40,30,20,0.55)'; g.beginPath(); g.ellipse(0, 0, 22 * s, 17 * s, 0.7, 0, 6.3); g.fill(); },
  stain: (g, s) => { g.fillStyle = 'rgba(8,8,8,0.5)'; g.beginPath(); g.ellipse(0, 0, 18 * s, 15 * s, 0, 0, 6.3); g.fill(); },
  soot: (g, s) => { g.fillStyle = 'rgba(5,5,5,0.5)'; g.beginPath(); g.ellipse(0, 0, 22 * s, 20 * s, 0, 0, 6.3); g.fill(); },
  leaves: (g, s) => { const c = ['#a8541c', '#c8801c', '#7a8a24']; for (let i = 0; i < 9; i++) { g.fillStyle = c[i % 3]; g.fillRect(Math.sin(i * 12.9) * 22 * s, Math.cos(i * 7.7) * 22 * s, 3 * s, 2 * s); } },
  paperf: (g, s) => { g.fillStyle = 'rgba(220,214,196,0.9)'; for (let i = 0; i < 4; i++) g.fillRect(Math.sin(i * 9.1) * 14 * s, Math.cos(i * 5.3) * 14 * s, 6 * s, 8 * s); },
  chalk: (g, s) => { g.strokeStyle = 'rgba(240,240,230,0.85)'; g.lineWidth = 1.6; g.beginPath(); g.ellipse(0, -22 * s, 6 * s, 6 * s, 0, 0, 6.3); g.moveTo(0, -16 * s); g.lineTo(0, 16 * s); g.moveTo(-14 * s, -8 * s); g.lineTo(14 * s, -8 * s); g.moveTo(0, 16 * s); g.lineTo(-8 * s, 28 * s); g.moveTo(0, 16 * s); g.lineTo(8 * s, 28 * s); g.stroke(); },
  glassf: (g, s) => { g.fillStyle = 'rgba(200,230,240,0.7)'; for (let i = 0; i < 7; i++) g.fillRect(Math.sin(i * 8.3) * 12 * s, Math.cos(i * 6.1) * 12 * s, 1.6 * s, 1.6 * s); },
  blood: (g, s) => { g.fillStyle = 'rgba(70,10,8,0.7)'; g.beginPath(); g.ellipse(0, 0, 14 * s, 11 * s, 0.5, 0, 6.3); g.fill(); },
};

/** Paint the dressing that touches `rect` (world coordinates; `g` is already transformed). */
export function paintDress2D(g, items, rect) {
  for (const it of items) {
    if (it.k === 'wire') {
      if (Math.max(it.x, it.x2) < rect.x0 || Math.min(it.x, it.x2) > rect.x1 || Math.max(it.y, it.y2) < rect.y0 || Math.min(it.y, it.y2) > rect.y1) continue;
      g.strokeStyle = 'rgba(10,10,10,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(it.x, it.y);
      g.lineTo(it.x2, it.y2);
      g.stroke();
      continue;
    }
    const def = DRESS_KINDS[it.k];
    const m = 70;
    if (!def || it.x < rect.x0 - m || it.x > rect.x1 + m || it.y < rect.y0 - m || it.y > rect.y1 + m) continue;
    const s = it.s || 1;
    g.save();
    g.translate(it.x, it.y);
    g.rotate(it.a || 0);
    const flat = FLAT[it.k];
    if (flat) flat(g, s);
    else if (it.k === 'fence_cl' || it.k === 'fence_pk' || it.k === 'tape' || it.k === 'banner') {
      g.strokeStyle = it.k === 'fence_pk' ? 'rgba(220,216,200,0.8)' : it.k === 'tape' ? 'rgba(240,200,32,0.9)' : it.k === 'banner' ? 'rgba(232,194,28,0.9)' : 'rgba(150,156,160,0.8)';
      g.lineWidth = it.k === 'fence_pk' ? 3 : 1.6;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(it.w || 60, 0);
      g.stroke();
    } else {
      const gl = GLYPH[it.k];
      if (gl) {
        const [shape, fill, w, h] = gl;
        g.fillStyle = fill;
        g.beginPath();
        if (shape === 'circle') g.arc(0, 0, (w / 2) * s, 0, 6.3);
        else if (shape === 'rect') g.rect((-w / 2) * s, (-h / 2) * s, w * s, h * s);
        else if (shape === 'capsule') { g.ellipse(0, 0, (w / 2) * s, (h / 2) * s, 0, 0, 6.3); }
        else if (shape === 'dots') { for (let i = 0; i < 5; i++) { g.moveTo(Math.sin(i * 11) * w * 0.4 * s + 2, Math.cos(i * 7) * h * 0.4 * s); g.arc(Math.sin(i * 11) * w * 0.4 * s, Math.cos(i * 7) * h * 0.4 * s, 2 * s, 0, 6.3); } }
        else g.ellipse(0, 0, (w / 2) * s, (h / 2) * s, 0.4, 0, 6.3);
        g.fill();
        if (shape === 'rect' && w * s > 14) {
          g.strokeStyle = 'rgba(0,0,0,0.35)';
          g.lineWidth = 1;
          g.stroke();
        }
      }
    }
    g.restore();
  }
}
