// Surface decals of the first-person view (EFFECTS, SPEC §7.5): blood splatter and spray on
// walls, cars, props and the ground, drips that run down walls, pools that spread and dry
// (darken, lose their gloss), footprints, drag smears, bullet holes and chips by surface,
// scorch marks and craters.
//
// One draw call. Every decal is an instance of a quad that lies on a surface (position,
// normal, size) and lives in two ring buffers — `gore` (blood, pools, prints, smears) and
// `marks` (holes, chips, scorch) — so a long fight recycles the oldest marks first and the
// memory / draw cost is fixed. All ageing happens on the GPU from the decal's birth time
// (pools grow, blood dries from bright wet red to a dark crust, drips run, everything fades
// at the end of its life): the CPU writes a decal once, when it is born.
//
// Lit by the scene lights (a Phong material patched with the atlas / clipping code), so a
// splatter on a wall glistens in the flashlight and is dark in the shade; it receives the
// sun's and the flashlight's shadows. A decal may be clipped to the top edge of the
// surface it is on (a splat on a car door never floats over the roof) and to a horizontal
// span (a wall's ends).

import * as THREE from 'three';
import { makeCanvas } from './actor-kit.js';

/** Decal atlas cells (8 x 8 of 128 px). */
export const DC = {
  SPLAT: 0, SPLAT_N: 6, SPRAY: 6, SPRAY_N: 6, DRIP: 12, DRIP_N: 2, FOOT_SHOE: 14, FOOT_BARE: 15, SMEAR: 16, SMEAR_N: 2,
  POOL: 18, POOL_N: 2, MIST: 20, MIST_N: 2, HOLE: 24, HOLE_N: 3, HOLE_METAL: 27, HOLE_GLASS: 28, HOLE_WOOD: 29,
  CHIP: 30, CHIP_N: 2, DENT: 32, SCORCH: 34, SCORCH_N: 2, CRATER: 36, SOOT: 37, ACID: 38, CLAW: 39, SPLASH_RING: 40, ASH: 41,
};
/** Decal kinds (shading). */
export const DK = { BLOOD: 0, DARK: 1, HOLE: 2, ACID: 3, DRIP: 4, PALE: 5, GLASS: 6 };

const GRID = 8;
let atlasCanvas = null;
let atlasTex = null;

/** Free the atlas' GPU copy (renderer destroy; re-uploads on reuse). */
export function releaseDecalAtlas() {
  if (atlasTex) { atlasTex.dispose(); atlasTex = null; }
}

function atlas() {
  if (atlasTex) return atlasTex;
  if (!atlasCanvas) atlasCanvas = paintAtlas();
  atlasTex = new THREE.CanvasTexture(atlasCanvas);
  atlasTex.generateMipmaps = true;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex.anisotropy = 8;
  return atlasTex;
}

// ---------------------------------------------------------------------------------------
// painting (canvas 2D, coordinates in cell units: -1..1 across a 128 px cell, y down)

function paintAtlas() {
  const S = 128, R = S / 2;
  const c = makeCanvas(S * GRID, S * GRID), g = c.getContext('2d');
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rr = (a, b) => a + (b - a) * rnd();
  const W = (a) => `rgba(255,255,255,${a})`;
  const cell = (i, fn) => {
    g.save();
    g.translate((i % GRID) * S + R, Math.floor(i / GRID) * S + R);
    g.beginPath(); g.rect(-R, -R, S, S); g.clip();
    g.scale(R, R);
    g.lineCap = 'round'; g.lineJoin = 'round';
    fn();
    g.restore();
  };
  const disc = (x, y, r, a = 1) => { g.fillStyle = W(a); g.beginPath(); g.arc(x, y, Math.max(0.002, r), 0, Math.PI * 2); g.fill(); };
  const ell = (x, y, rx, ry, rot, a = 1) => { g.fillStyle = W(a); g.beginPath(); g.ellipse(x, y, Math.max(0.002, rx), Math.max(0.002, ry), rot, 0, Math.PI * 2); g.fill(); };
  // a lumpy blob: points on an irregular circle joined by quadratic curves
  const blob = (cx, cy, r, irr, a, lobes = 13, sx = 1) => {
    const pts = [];
    for (let k = 0; k < lobes; k++) {
      const t = (k / lobes) * Math.PI * 2, rad = r * (1 + (rnd() - 0.5) * 2 * irr);
      pts.push([cx + Math.cos(t) * rad * sx, cy + Math.sin(t) * rad]);
    }
    g.fillStyle = W(a);
    g.beginPath();
    for (let k = 0; k < lobes; k++) {
      const p0 = pts[k], p1 = pts[(k + 1) % lobes];
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      if (k === 0) g.moveTo(mx, my);
      else g.quadraticCurveTo(p0[0], p0[1], mx, my);
    }
    g.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    g.fill();
  };
  // a tapered arm from (0,0) at angle a, length L, base width w, ending in a droplet
  const arm = (x0, y0, a, L, w, alpha = 1) => {
    const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
    g.fillStyle = W(alpha);
    g.beginPath();
    g.moveTo(x0 + nx * w, y0 + ny * w);
    g.quadraticCurveTo(x0 + ca * L * 0.55 + nx * w * 0.35, y0 + sa * L * 0.55 + ny * w * 0.35, x0 + ca * L, y0 + sa * L);
    g.quadraticCurveTo(x0 + ca * L * 0.55 - nx * w * 0.35, y0 + sa * L * 0.55 - ny * w * 0.35, x0 - nx * w, y0 - ny * w);
    g.closePath();
    g.fill();
    disc(x0 + ca * (L + w * 1.1), y0 + sa * (L + w * 1.1), w * rr(0.7, 1.25), alpha);
  };

  // --- splats: a heavy centre, tapered arms with droplet tips, satellite droplets
  for (let v = 0; v < DC.SPLAT_N; v++) {
    cell(DC.SPLAT + v, () => {
      const r0 = rr(0.12, 0.2);
      blob(0, 0, r0 * 1.9, 0.45, 0.5);
      blob(0, 0, r0, 0.3, 1);
      const arms = 8 + ((rnd() * 6) | 0);
      const bias = rnd() * 6.28, sharp = rr(0, 0.8);
      for (let k = 0; k < arms; k++) {
        const a = bias + (rnd() - 0.5) * 6.28 * (1 - sharp * 0.7);
        const L = rr(0.22, 0.6) * (1 + sharp * 0.5 * Math.cos(a - bias));
        arm(Math.cos(a) * r0 * 0.5, Math.sin(a) * r0 * 0.5, a, Math.min(0.72, L), rr(0.022, 0.06), 1);
      }
      const drops = 16 + ((rnd() * 12) | 0);
      for (let k = 0; k < drops; k++) {
        const a = rnd() * 6.28, d = rr(0.3, 0.86), r = rr(0.008, 0.032);
        const stretch = rr(1, 2.1);
        ell(Math.cos(a) * d, Math.sin(a) * d, r * stretch, r, a, 1);
      }
    });
  }
  // --- sprays: a directional fan of streaks along +x from the left (wall hits, exit wounds)
  for (let v = 0; v < DC.SPRAY_N; v++) {
    cell(DC.SPRAY + v, () => {
      const ox = -0.8;
      blob(ox + 0.06, 0, rr(0.1, 0.15), 0.35, 1, 11, 1.2);
      blob(ox + 0.12, 0, rr(0.2, 0.28), 0.5, 0.5, 11, 1.4);
      const n = 34 + ((rnd() * 24) | 0), spread = rr(0.28, 0.5);
      for (let k = 0; k < n; k++) {
        const t = Math.pow(rnd(), 0.75);
        const x = ox + 0.1 + t * 1.6;
        const ang = (rnd() + rnd() - 1) * spread;
        const y = Math.tan(ang) * (x - ox);
        const len = (0.02 + t * 0.09) * rr(0.6, 1.4);
        const wd = rr(0.008, 0.026) * (1 - t * 0.4);
        if (Math.abs(y) > 0.9) continue;
        ell(x, y, len, wd, ang, rr(0.7, 1));
        if (rnd() < 0.3) arm(ox + 0.1, 0, ang * 0.7, Math.min(1.5, t * 1.5 + 0.2), rr(0.014, 0.03), 1);
      }
      for (let k = 0; k < 40; k++) { const t = rnd(); disc(ox + 0.1 + t * 1.65, (rnd() - 0.5) * (0.15 + t * 0.9), rr(0.004, 0.011), 0.85); }
    });
  }
  // --- drips: a run down a wall (anchored at the top of the cell), bulb at the end
  for (let v = 0; v < DC.DRIP_N; v++) {
    cell(DC.DRIP + v, () => {
      const xs = v ? [-0.25, 0.22] : [0];
      for (const x0 of xs) {
        const w = v ? 0.07 : 0.1;
        g.fillStyle = W(0.9);
        g.beginPath(); g.moveTo(x0 - w, -0.98); g.lineTo(x0 + w, -0.98); g.lineTo(x0 + w * 0.6, 0.72); g.lineTo(x0 - w * 0.6, 0.72); g.closePath(); g.fill();
        disc(x0, 0.76, w * 1.35, 1);
        disc(x0, -0.9, w * 2.2, 0.7);
      }
    });
  }
  // --- footprints (toe at +x): a boot sole with a heel and cut tread, and a bare foot
  cell(DC.FOOT_SHOE, () => {
    g.fillStyle = W(1);
    g.beginPath();
    g.moveTo(0.05, -0.34); g.quadraticCurveTo(0.75, -0.4, 0.82, -0.02); g.quadraticCurveTo(0.78, 0.36, 0.05, 0.32);
    g.quadraticCurveTo(-0.18, 0.2, -0.16, 0); g.quadraticCurveTo(-0.18, -0.2, 0.05, -0.34); g.fill();
    ell(-0.55, 0, 0.24, 0.2, 0, 1);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.8)';
    for (let k = 0; k < 6; k++) g.fillRect(-0.05 + k * 0.12, -0.34, 0.035, 0.68);
    g.fillRect(-0.34, -0.03, 0.55, 0.03);
    g.globalCompositeOperation = 'source-over';
  });
  cell(DC.FOOT_BARE, () => {
    g.fillStyle = W(1);
    g.beginPath(); g.moveTo(-0.7, 0); g.quadraticCurveTo(-0.5, -0.2, 0, -0.16); g.quadraticCurveTo(0.35, -0.3, 0.45, -0.02); g.quadraticCurveTo(0.3, 0.32, 0, 0.26); g.quadraticCurveTo(-0.5, 0.2, -0.7, 0); g.fill();
    ell(-0.55, 0, 0.2, 0.15, 0, 1);
    for (let k = 0; k < 5; k++) disc(0.55 + k * 0.018 - Math.abs(k - 2) * 0.03, -0.24 + k * 0.12, 0.055 - k * 0.003, 1);
  });
  // --- smears along +x (a dragged body, a slid gib): parallel dry-brush streaks
  for (let v = 0; v < DC.SMEAR_N; v++) {
    cell(DC.SMEAR + v, () => {
      const lanes = 9 + v * 2;
      for (let k = 0; k < lanes; k++) {
        const y = (k / (lanes - 1) - 0.5) * 0.62 + (rnd() - 0.5) * 0.05;
        const edge = 1 - Math.pow(Math.abs(y) / 0.34, 2);
        const x0 = -0.95 + rnd() * 0.1, x1 = x0 + (0.7 + rnd() * 0.25) * (0.55 + 0.45 * edge) * 1.9;
        const w = rr(0.03, 0.06) * (0.6 + edge * 0.6);
        const gr = g.createLinearGradient(x0, 0, Math.min(0.97, x1), 0);
        gr.addColorStop(0, W(0.95)); gr.addColorStop(0.55, W(0.7 * edge + 0.25)); gr.addColorStop(1, W(0));
        g.strokeStyle = gr; g.lineWidth = w;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(Math.min(0.97, x1), y + (rnd() - 0.5) * 0.04); g.stroke();
      }
      blob(-0.82, 0, 0.16, 0.3, 1, 10, 1.2);
    });
  }
  // --- pools: lobed, thin film at the edge, thick in the middle
  for (let v = 0; v < DC.POOL_N; v++) {
    cell(DC.POOL + v, () => {
      blob(0, 0, 0.78, 0.16, 0.45, 15);
      for (let k = 0; k < 6; k++) { const a = rnd() * 6.28, d = rr(0.05, 0.3); blob(Math.cos(a) * d, Math.sin(a) * d, rr(0.28, 0.5), 0.25, 0.7, 12); }
      blob(0, 0, 0.36, 0.2, 1, 12);
      for (let k = 0; k < 4; k++) { const a = rnd() * 6.28; arm(Math.cos(a) * 0.5, Math.sin(a) * 0.5, a, rr(0.12, 0.26), rr(0.03, 0.05), 0.7); }
    });
  }
  // --- fine mist speckle
  for (let v = 0; v < DC.MIST_N; v++) {
    cell(DC.MIST + v, () => {
      for (let k = 0; k < 130; k++) { const a = rnd() * 6.28, d = Math.pow(rnd(), 0.6) * 0.92; disc(Math.cos(a) * d, Math.sin(a) * d, rr(0.006, 0.02) * (1.2 - d * 0.6), rr(0.55, 1)); }
    });
  }
  // --- bullet holes: a crater core, a scorched / cracked halo
  for (let v = 0; v < DC.HOLE_N; v++) {
    cell(DC.HOLE + v, () => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 0.5);
      gr.addColorStop(0, W(0.7)); gr.addColorStop(0.5, W(0.3)); gr.addColorStop(1, W(0));
      g.fillStyle = gr; g.fillRect(-1, -1, 2, 2);
      g.strokeStyle = W(0.7); g.lineWidth = 0.014;
      for (let k = 0; k < 5 + v * 2; k++) { const a = rnd() * 6.28, L = rr(0.2, 0.5); g.beginPath(); g.moveTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1); g.lineTo(Math.cos(a + 0.1) * L * 0.6, Math.sin(a + 0.1) * L * 0.6); g.lineTo(Math.cos(a - 0.05) * L, Math.sin(a - 0.05) * L); g.stroke(); }
      blob(0, 0, 0.13, 0.3, 1, 9);
    });
  }
  cell(DC.HOLE_METAL, () => {
    g.strokeStyle = W(0.5); g.lineWidth = 0.09;
    g.beginPath(); g.arc(0, 0, 0.21, 0, Math.PI * 2); g.stroke();
    const gr = g.createRadialGradient(0, 0, 0.1, 0, 0, 0.42);
    gr.addColorStop(0, W(0.35)); gr.addColorStop(1, W(0));
    g.fillStyle = gr; g.fillRect(-1, -1, 2, 2);
    disc(0, 0, 0.1, 1);
    for (let k = 0; k < 4; k++) { const a = rnd() * 6.28; g.strokeStyle = W(0.8); g.lineWidth = 0.02; g.beginPath(); g.moveTo(Math.cos(a) * 0.08, Math.sin(a) * 0.08); g.lineTo(Math.cos(a) * rr(0.2, 0.34), Math.sin(a) * rr(0.2, 0.34)); g.stroke(); }
  });
  cell(DC.HOLE_GLASS, () => {
    g.strokeStyle = W(0.95);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * 6.28 + rnd() * 0.3, L = rr(0.5, 0.95);
      g.lineWidth = 0.02;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.stroke();
      g.lineWidth = 0.011;
      for (let b = 0; b < 2; b++) { const t = rr(0.25, 0.7), a2 = a + (rnd() - 0.5) * 1.1; g.beginPath(); g.moveTo(Math.cos(a) * L * t, Math.sin(a) * L * t); g.lineTo(Math.cos(a2) * L * (t + 0.22), Math.sin(a2) * L * (t + 0.22)); g.stroke(); }
    }
    g.lineWidth = 0.011;
    for (const rad of [0.2, 0.36, 0.55]) { g.beginPath(); for (let k = 0; k <= 12; k++) { const a = (k / 12) * 6.28, d = rad * rr(0.9, 1.1); const px = Math.cos(a) * d, py = Math.sin(a) * d; if (k) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); }
    disc(0, 0, 0.07, 1);
  });
  cell(DC.HOLE_WOOD, () => {
    g.strokeStyle = W(0.9); g.lineWidth = 0.022;
    for (let k = 0; k < 12; k++) { const a = rnd() * 6.28, L = rr(0.24, 0.6); g.beginPath(); g.moveTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1); g.lineTo(Math.cos(a + 0.06) * L, Math.sin(a + 0.06) * L); g.stroke(); }
    blob(0, 0, 0.14, 0.35, 1, 9);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 0.38); gr.addColorStop(0, W(0.55)); gr.addColorStop(1, W(0)); g.fillStyle = gr; g.fillRect(-1, -1, 2, 2);
  });
  // --- chips: the pale spalled patch around a hit in concrete / stone
  for (let v = 0; v < DC.CHIP_N; v++) {
    cell(DC.CHIP + v, () => {
      blob(0, 0, 0.42, 0.35, 0.85, 12);
      for (let k = 0; k < 9; k++) { const a = rnd() * 6.28, d = rr(0.35, 0.8); g.fillStyle = W(rr(0.7, 1)); g.beginPath(); const x = Math.cos(a) * d, y = Math.sin(a) * d, s = rr(0.03, 0.09); g.moveTo(x, y); g.lineTo(x + s * rr(-1, 1), y + s * rr(0.4, 1.4)); g.lineTo(x + s * rr(0.3, 1.5), y + s * rr(-1, 0.6)); g.fill(); }
      for (let k = 0; k < 40; k++) { const a = rnd() * 6.28, d = rr(0.4, 0.95); disc(Math.cos(a) * d, Math.sin(a) * d, rr(0.006, 0.018), rr(0.5, 0.95)); }
    });
  }
  cell(DC.DENT, () => {
    const gr = g.createRadialGradient(0, 0, 0.05, 0, 0, 0.9);
    gr.addColorStop(0, W(0.55)); gr.addColorStop(0.55, W(0.25)); gr.addColorStop(1, W(0));
    g.fillStyle = gr; g.fillRect(-1, -1, 2, 2);
  });
  // --- scorch: soot smudge with blast streaks; crater: a dark irregular pit; soot: an upward smudge
  for (let v = 0; v < DC.SCORCH_N; v++) {
    cell(DC.SCORCH + v, () => {
      for (let k = 0; k < 9; k++) { const a = rnd() * 6.28, d = rr(0, 0.28); const gr = g.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, rr(0.35, 0.65)); gr.addColorStop(0, W(0.6)); gr.addColorStop(1, W(0)); g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); }
      g.strokeStyle = W(0.5); g.lineWidth = 0.02;
      for (let k = 0; k < 22; k++) { const a = rnd() * 6.28, L = rr(0.5, 0.95); const gr = g.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L); gr.addColorStop(0, W(0.6)); gr.addColorStop(1, W(0)); g.strokeStyle = gr; g.lineWidth = rr(0.008, 0.03); g.beginPath(); g.moveTo(Math.cos(a) * 0.15, Math.sin(a) * 0.15); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.stroke(); }
    });
  }
  cell(DC.CRATER, () => {
    blob(0, 0, 0.5, 0.3, 0.7, 14);
    blob(0, 0, 0.32, 0.3, 1, 12);
    for (let k = 0; k < 16; k++) { const a = rnd() * 6.28; arm(Math.cos(a) * 0.3, Math.sin(a) * 0.3, a, rr(0.15, 0.5), rr(0.015, 0.04), 0.85); }
  });
  cell(DC.SOOT, () => {
    for (let k = 0; k < 8; k++) { const x = rr(-0.3, 0.3); const gr = g.createLinearGradient(x, 0.9, x, -0.9); gr.addColorStop(0, W(0.7)); gr.addColorStop(1, W(0)); g.strokeStyle = gr; g.lineWidth = rr(0.06, 0.2); g.beginPath(); g.moveTo(x, 0.85); g.lineTo(x + rr(-0.15, 0.15), -rr(0.4, 0.95)); g.stroke(); }
  });
  cell(DC.ACID, () => {
    blob(0, 0, 0.7, 0.14, 0.55, 16);
    blob(0, 0, 0.5, 0.2, 0.95, 14);
    for (let k = 0; k < 16; k++) { const a = rnd() * 6.28, d = rr(0.1, 0.55); g.strokeStyle = W(0.35); g.lineWidth = 0.02; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, rr(0.03, 0.09), 0, 6.28); g.stroke(); }
    for (let k = 0; k < 14; k++) { const a = rnd() * 6.28; disc(Math.cos(a) * rr(0.7, 0.92), Math.sin(a) * rr(0.7, 0.92), rr(0.01, 0.03), 1); }
  });
  cell(DC.CLAW, () => {
    for (let k = -1; k <= 1; k++) { g.strokeStyle = W(0.95); g.lineWidth = 0.035; g.beginPath(); g.moveTo(-0.8, k * 0.22 - 0.2); g.quadraticCurveTo(0, k * 0.22 + 0.02, 0.8, k * 0.22 + 0.25); g.stroke(); }
  });
  cell(DC.SPLASH_RING, () => {
    g.strokeStyle = W(0.9); g.lineWidth = 0.06; g.beginPath(); g.ellipse(0, 0, 0.55, 0.55, 0, 0, 6.28); g.stroke();
    g.strokeStyle = W(0.45); g.lineWidth = 0.05; g.beginPath(); g.ellipse(0, 0, 0.8, 0.8, 0, 0, 6.28); g.stroke();
  });
  cell(DC.ASH, () => {
    blob(0, 0, 0.6, 0.25, 0.5, 14);
    for (let k = 0; k < 60; k++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * 0.9; disc(Math.cos(a) * d, Math.sin(a) * d, rr(0.01, 0.04), rr(0.3, 0.8)); }
  });
  return c;
}

// ---------------------------------------------------------------------------------------
// GPU side

const PATCH_COMMON = /* glsl */`
#include <common>
attribute vec4 iPos;     // xyz, rotation
attribute vec4 iNrm;     // surface normal xyz, size
attribute vec4 iCol;     // rgb (fresh colour), alpha
attribute vec4 iInfo;    // atlas cell, birth time, life, kind
attribute vec4 iClip;    // top height (0 = none), span min, span max (along the tangent), floor height
attribute vec4 iShape;   // aspect (x stretch), growth seconds (0 = none), drip length, wetness
uniform float uNow;
varying vec4 vDCol;
varying vec4 vDInfo;     // age, life, kind, wetness
varying vec4 vDClip;
varying vec2 vDUv;
varying vec3 vDWorld;
varying float vDS;
`;

function patchVertex(src) {
  return src
    .replace('#include <common>', PATCH_COMMON)
    .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(iNrm.xyz);')
    .replace('#include <begin_vertex>', /* glsl */`
      float dAge = uNow - iInfo.y;
      float dKind = iInfo.w;
      vec3 dN = objectNormal;
      vec3 dT = normalize(abs(dN.y) > 0.9 ? cross(vec3(1.0, 0.0, 0.0), dN) : cross(vec3(0.0, 1.0, 0.0), dN));
      vec3 dB = cross(dN, dT);
      float dGrow = iShape.y > 0.0 ? 0.42 + 0.58 * (1.0 - exp(-max(dAge, 0.0) / iShape.y)) : 1.0;
      float dSize = iNrm.w * dGrow;
      vec2 dc = position.xy;
      vec2 dq = dc * vec2(dSize * iShape.x, dSize);
      float dcr = cos(iPos.w), dsr = sin(iPos.w);
      dq = vec2(dq.x * dcr - dq.y * dsr, dq.x * dsr + dq.y * dcr);
      if (dKind > 3.5 && dKind < 4.5) {
        // a drip runs down from its anchor and slows
        dq = vec2(dc.x * dSize * 0.5, -(0.5 - dc.y) * iShape.z * (1.0 - exp(-max(dAge, 0.0) / 3.0)));
      }
      vec3 transformed = iPos.xyz + dN * 0.3 + dT * dq.x + dB * dq.y;
      vDCol = iCol;
      vDInfo = vec4(dAge, iInfo.z, dKind, iShape.w);
      vDClip = iClip;
      vDUv = (vec2(mod(iInfo.x, ${GRID}.0), ${GRID - 1}.0 - floor(iInfo.x / ${GRID}.0)) + (dc + 0.5)) / ${GRID}.0;
      vDWorld = transformed;
      vDS = dot(transformed - iPos.xyz, dT);
    `);
}

function patchFragment(src) {
  return src
    .replace('#include <common>', `#include <common>
uniform sampler2D uMap;
varying vec4 vDCol;
varying vec4 vDInfo;
varying vec4 vDClip;
varying vec2 vDUv;
varying vec3 vDWorld;
varying float vDS;
`)
    .replace('#include <map_fragment>', /* glsl */`
      float dAge = vDInfo.x;
      float dLife = vDInfo.y;
      float dKind = vDInfo.z;
      if (dAge < 0.0) discard;
      if (vDClip.x > 0.0 && vDWorld.y > vDClip.x) discard;
      if (vDWorld.y < vDClip.w) discard;
      if (vDClip.y < vDClip.z && (vDS < vDClip.y || vDS > vDClip.z)) discard;
      float dTex = texture2D(uMap, vDUv).a;
      float dCov = smoothstep(0.1, 0.34, dTex);
      float dThick = smoothstep(0.32, 0.98, dTex);
      float dFade = (1.0 - smoothstep(0.8, 1.0, dAge / dLife)) * min(1.0, dAge * 18.0);
      float dDry = smoothstep(2.5, 75.0, dAge);
      float dWet = (1.0 - dDry) * vDInfo.w;
      vec3 dRgb = vDCol.rgb;
      float dA = dCov * vDCol.a;
      float dEmis = 0.0;
      if (dKind < 0.5 || (dKind > 3.5 && dKind < 4.5)) {
        // blood: bright and glossy when fresh, a dark matte crust when dry; thin film is translucent
        dRgb = mix(dRgb * (0.7 + 0.55 * dThick), dRgb * vec3(0.3, 0.2, 0.18), dDry);
        dA *= (0.5 + 0.5 * dThick) * (1.0 - 0.18 * dDry);
        dWet *= 0.35 + 0.65 * dThick;
      } else if (dKind < 1.5) {
        dA = dTex * vDCol.a;
        dWet = 0.0;
      } else if (dKind < 2.5) {
        dA = mix(dTex, dCov, 0.5) * vDCol.a;
        dWet = 0.0;
      } else if (dKind < 3.5) {
        dRgb = mix(dRgb, dRgb * vec3(0.35, 0.5, 0.25), dDry);
        dA *= 0.5 + 0.5 * dThick;
        dEmis = (1.0 - dDry) * (0.25 + 0.5 * dThick);
        dWet = 0.6 * (1.0 - dDry);
      } else if (dKind < 5.5) {
        dA = dTex * vDCol.a;
        dWet = 0.0;
      } else {
        dA = dCov * vDCol.a;
        dRgb *= 0.8 + 0.3 * dThick;
        dWet = 0.5;
        dEmis = 0.0;
      }
      diffuseColor = vec4(dRgb, dA * dFade);
      if (diffuseColor.a < 0.004) discard;
      float dSpec = dWet;
    `)
    .replace('#include <specularmap_fragment>', 'float specularStrength = dSpec;')
    .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += dRgb * dEmis;');
}

/**
 * The decal layer: one instanced mesh, two ring buffers.
 * @param {THREE.Scene} scene
 * @param {{ gore: number, marks: number }} caps ring sizes for the current tier
 */
export function createDecalLayer(scene, caps, maxCaps) {
  const GMAX = maxCaps.gore, MMAX = maxCaps.marks, TOT = GMAX + MMAX;
  let gCap = caps.gore, mCap = caps.marks;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const A = {};
  for (const n of ['iPos', 'iNrm', 'iCol', 'iInfo', 'iClip', 'iShape']) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(TOT * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(n, a);
    A[n] = a;
  }
  geo.instanceCount = 0;
  const map = atlas();
  const mat = new THREE.MeshPhongMaterial({
    color: 0xffffff, specular: new THREE.Color(0.42, 0.38, 0.38), shininess: 60, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const uniforms = { uMap: { value: map }, uNow: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMap = uniforms.uMap;
    sh.uniforms.uNow = uniforms.uNow;
    sh.vertexShader = patchVertex(sh.vertexShader);
    sh.fragmentShader = patchFragment(sh.fragmentShader);
  };
  mat.customProgramCacheKey = () => 'hh-decals-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 8;
  mesh.name = 'fx-decals';
  scene.add(mesh);

  // ring state: [0, gCap) gore, [GMAX, GMAX + mCap) marks
  let gn = 0, gHead = 0, mn = 0, mHead = 0;
  let dirtyLo = TOT, dirtyHi = -1;
  let clock = 0;
  const stats = { gore: 0, marks: 0, total: 0, born: 0 };
  // per-decal options set by the caller just before add() (consumed and reset)
  const opt = { top: 0, s0: 0, s1: 0, floor: -1e4, aspect: 1, grow: 0, drip: 0, wet: 1, rot: NaN };

  function slotFor(ring) {
    if (ring === 0) {
      if (gn < gCap) return gn++;
      const s = gHead; gHead = (gHead + 1) % gCap; return s;
    }
    let s;
    if (mn < mCap) s = mn++; else { s = mHead; mHead = (mHead + 1) % mCap; }
    return GMAX + s;
  }

  /**
   * Add a decal. ring 0 = gore, 1 = marks. cell/kind: see DC / DK. (nx, nh, ny) = surface normal
   * in three.js axes. colour (r, g, b) is the FRESH colour (linear).
   */
  function add(ring, x, h, y, nx, nh, ny, size, cell, kind, r, g, b, alpha, life) {
    if ((ring === 0 ? gCap : mCap) <= 0) return;
    const s = slotFor(ring), o = s * 4;
    const nl = Math.hypot(nx, nh, ny) || 1;
    const P = A.iPos.array, N = A.iNrm.array, C = A.iCol.array, I = A.iInfo.array, K = A.iClip.array, S = A.iShape.array;
    P[o] = x; P[o + 1] = h; P[o + 2] = y; P[o + 3] = opt.rot === opt.rot ? opt.rot : Math.random() * 6.2832;
    N[o] = nx / nl; N[o + 1] = nh / nl; N[o + 2] = ny / nl; N[o + 3] = size;
    C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = alpha;
    I[o] = cell; I[o + 1] = clock; I[o + 2] = Math.max(1, life); I[o + 3] = kind;
    K[o] = opt.top; K[o + 1] = opt.s0; K[o + 2] = opt.s1; K[o + 3] = opt.floor;
    S[o] = opt.aspect; S[o + 1] = opt.grow; S[o + 2] = opt.drip; S[o + 3] = opt.wet;
    opt.top = 0; opt.s0 = 0; opt.s1 = 0; opt.floor = -1e4; opt.aspect = 1; opt.grow = 0; opt.drip = 0; opt.wet = 1; opt.rot = NaN;
    if (s < dirtyLo) dirtyLo = s;
    if (s > dirtyHi) dirtyHi = s;
    stats.born++;
  }

  /** Per rendered frame: advance the clock, upload what was written. */
  function flush(dt) {
    clock += dt;
    uniforms.uNow.value = clock;
    if (dirtyHi >= dirtyLo) {
      for (const k in A) {
        const a = A[k];
        a.clearUpdateRanges();
        a.addUpdateRange(dirtyLo * 4, (dirtyHi - dirtyLo + 1) * 4);
        a.needsUpdate = true;
      }
      dirtyLo = TOT; dirtyHi = -1;
    }
    geo.instanceCount = mn > 0 ? GMAX + mn : gn;
    mesh.visible = gn + mn > 0;
    stats.gore = gn; stats.marks = mn; stats.total = gn + mn;
  }

  function clear() {
    for (const k in A) A[k].array.fill(0);
    gn = mn = gHead = mHead = 0;
    dirtyLo = 0; dirtyHi = TOT - 1;
  }

  return {
    mesh, opt, add, flush, clear, stats,
    /** Test / screenshot hook: jump the decal clock ahead (pools spread, blood dries). */
    advance(seconds) { clock += seconds; uniforms.uNow.value = clock; },
    get clock() { return clock; },
    get caps() { return { gore: gCap, marks: mCap }; },
    setCaps(c) { clear(); gCap = Math.min(GMAX, c.gore); mCap = Math.min(MMAX, c.marks); },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
    },
  };
}
