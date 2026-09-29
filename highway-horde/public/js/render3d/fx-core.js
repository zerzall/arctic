// Shared GPU-friendly effect primitives for the ACTORS sub-systems. One instance per
// renderer ctx (looked up with acquireFx(ctx) so zombies, items, players and effects all
// feed the same pools): simulated particles (billboards, ground-flat quads or sprites
// stretched along their velocity; additive in HDR — they bloom — or alpha-blended smoke
// that is warm while it is hot and lit from above; optional ground bounce), streak
// particles and beams (camera-facing ribbons: tracers, sparks, tesla arcs, rail beams),
// immediate-mode glows re-submitted every frame (pickup halos, status lights, exhausts),
// and surface decals (bullet holes and scorch marks on obstacles, oriented by the
// surface normal, fading out oldest-first).
//
// Four draw calls in total. Buffers are written once per rendered frame from a
// THREE.LOD's update() hook, which three.js calls while projecting the scene — i.e.
// after every sub-system's update() and before the attribute upload — so the order in
// which renderer3d updates the sub-systems never matters.

import * as THREE from 'three';
import { makeCanvas } from './actor-kit.js';
import { createDecalLayer, releaseDecalAtlas, DC, DK } from './fx-decals.js';

export { DC, DK };

// particle flags
export const F_ADD = 1, F_FLAT = 2, F_STREAK = 4, F_BOUNCE = 8, F_FIRE = 16, F_FLICKER = 32, F_SHRINK = 64, F_SPIN = 128,
  F_VSTRETCH = 256, F_HOT = 512;
// atlas frames (8 x 8 of 128 px)
export const FR = {
  GLOW: 0, DOT: 1, SMOKE: 2, SMOKE2: 3, FLAME: 4, STAR: 5, RING: 6, CHUNK: 7,
  FLASH: 8, MIST: 9, SQUARE: 10, SHARD: 11, SOFTRING: 12, BOLT: 13, CROSS: 14, BUBBLE: 15,
  SMOKE3: 16, SMOKE4: 17, FLAME2: 18, SPARK: 19, DROP: 20, SPLAT: 21, HOLE: 22, SCORCH: 23,
  DUST: 24, FIREBALL: 25, EMBER: 26, SHOCK: 27, GLINT: 28, CRACK: 29, BLOB: 30, SMOKE5: 31,
  LEAF: 32, PAPER: 33, MOTE: 34, BIRD1: 35, BIRD2: 36, CRYSTAL: 37, STREAK: 38, PETAL: 39, FIREFLY: 40, SPLASH: 41, WISP: 42,
};
const GRID = 8;

const QUALITY = {
  ultra: { particles: 4200, beams: 480, gore: 1600, marks: 700 },
  high: { particles: 2600, beams: 320, gore: 800, marks: 360 },
  low: { particles: 900, beams: 140, gore: 160, marks: 80 },
};

const registry = new WeakMap();

/**
 * Shared fx pools for this ctx (created on first use, reference counted).
 * @returns {ReturnType<typeof createFx>}
 */
export function acquireFx(ctx) {
  let fx = registry.get(ctx);
  if (!fx) {
    fx = createFx(ctx);
    registry.set(ctx, fx);
  }
  fx.refs++;
  return fx;
}

/** The pools of this ctx if a sub-system has created them, else null (never creates). */
export function peekFx(ctx) {
  return registry.get(ctx) || null;
}

/** Drop one reference; the pools are disposed with the last one. */
export function releaseFx(ctx) {
  const fx = registry.get(ctx);
  if (!fx) return;
  if (--fx.refs <= 0) {
    fx.dispose();
    registry.delete(ctx);
  }
}

// ---------------------------------------------------------------------------------------
// procedural sprite atlas

let atlasTex = null;
let atlasCanvas = null;

/** Free the shared sprite atlas' GPU copies (renderer3d.destroy; it re-uploads on reuse). */
export function releaseFxAtlas() {
  if (atlasTex) atlasTex.dispose();
  releaseDecalAtlas();
}

function atlas() {
  if (atlasTex) return atlasTex;
  if (!atlasCanvas) atlasCanvas = paintAtlas();
  atlasTex = new THREE.CanvasTexture(atlasCanvas);
  atlasTex.generateMipmaps = true;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex.anisotropy = 4;
  return atlasTex;
}

// tiny value noise for the smoke/fire cells
function makeNoise(seed) {
  const P = 64, L = new Float32Array(P * P);
  let s = seed;
  for (let i = 0; i < L.length; i++) { s = (s * 16807) % 2147483647; L[i] = s / 2147483647; }
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const a = ((xi % P) + P) % P, b = ((yi % P) + P) % P, a1 = (a + 1) % P, b1 = (b + 1) % P;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v00 = L[b * P + a], v10 = L[b * P + a1], v01 = L[b1 * P + a], v11 = L[b1 * P + a1];
    return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
  };
  return (x, y, oct = 4) => {
    let v = 0, amp = 0.5, f = 1, t = 0;
    for (let o = 0; o < oct; o++) { v += n(x * f, y * f) * amp; t += amp; amp *= 0.5; f *= 2.03; }
    return v / t;
  };
}

function paintAtlas() {
  const S = 128, c = makeCanvas(S * GRID, S * GRID), g = c.getContext('2d');
  const R = S / 2;
  const cell = (i, fn) => {
    g.save();
    g.translate((i % GRID) * S + R, Math.floor(i / GRID) * S + R);
    g.beginPath();
    g.rect(-R, -R, S, S);
    g.clip();
    fn(R);
    g.restore();
  };
  // per-pixel cells (noise): write white RGB with the computed alpha
  const pixels = (i, fn) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
        const a = Math.max(0, Math.min(1, fn(u, v)));
        const o = (y * S + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, (i % GRID) * S, Math.floor(i / GRID) * S);
  };
  const radial = (r, stops) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [t, a] of stops) gr.addColorStop(t, `rgba(255,255,255,${a})`);
    g.fillStyle = gr;
    g.fillRect(-r, -r, r * 2, r * 2);
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  cell(FR.GLOW, (r) => radial(r, [[0, 1], [0.2, 0.6], [0.5, 0.16], [1, 0]]));
  cell(FR.DOT, (r) => radial(r, [[0, 1], [0.35, 0.95], [0.6, 0.25], [1, 0]]));
  // billowing smoke puffs: fbm density inside a soft disc, a different seed per variant
  [FR.SMOKE, FR.SMOKE2, FR.SMOKE3, FR.SMOKE4, FR.SMOKE5].forEach((fr, k) => {
    const nz = makeNoise(101 + k * 37);
    pixels(fr, (u, v) => {
      const d = Math.hypot(u, v);
      const n = nz(u * 2.2 + k * 3.1 + 5, v * 2.2 + 7, 5);
      const edge = 1 - sm(0.35, 1.0, d + (n - 0.5) * 0.7);
      return edge * sm(0.25, 0.75, n + 0.28 - d * 0.25) * 0.95;
    });
  });
  // dust: a flatter, grainier puff
  { const nz = makeNoise(211); pixels(FR.DUST, (u, v) => { const d = Math.hypot(u, v * 1.3); const n = nz(u * 4 + 3, v * 4, 4); return (1 - sm(0.3, 1.0, d + (n - 0.5) * 0.6)) * sm(0.2, 0.8, n) * 0.85; }); }
  // flames: teardrop tongues with a turbulent edge (white core; colour from the particle)
  [FR.FLAME, FR.FLAME2].forEach((fr, k) => {
    const nz = makeNoise(307 + k * 19);
    pixels(fr, (u, v) => {
      const y = -v;                               // up is +y
      const w = 0.55 * Math.pow(Math.max(0, (1 - y) / 2), 0.7) * (y > 0.85 ? 0 : 1);
      const n = nz(u * 3 + k * 5, y * 2.2 + 3, 4);
      const d = Math.abs(u + (n - 0.5) * 0.35 * (1 + y)) / Math.max(0.02, w + (n - 0.5) * 0.25);
      const core = 1 - sm(0.2, 1.0, d);
      return core * sm(-1.0, -0.55, y) * (1 - sm(0.55, 0.95, y + (n - 0.5) * 0.4));
    });
  });
  // fireball: a lumpy hot ball
  { const nz = makeNoise(401); pixels(FR.FIREBALL, (u, v) => { const d = Math.hypot(u, v); const n = nz(u * 3 + 1, v * 3 + 2, 5); return (1 - sm(0.45, 0.95, d + (n - 0.5) * 0.55)) * (0.55 + n * 0.6); }); }
  cell(FR.STAR, (r) => {
    radial(r * 0.5, [[0, 1], [0.5, 0.45], [1, 0]]);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 8; k++) {
      g.save();
      g.rotate((k / 8) * Math.PI * 2 + rnd() * 0.3);
      const L = r * (k % 2 ? 0.6 : 0.97);
      const gr = g.createLinearGradient(0, 0, L, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, -r * 0.07); g.quadraticCurveTo(L * 0.5, -r * 0.02, L, 0); g.quadraticCurveTo(L * 0.5, r * 0.02, 0, r * 0.07);
      g.fill();
      g.restore();
    }
  });
  cell(FR.GLINT, (r) => {
    radial(r * 0.3, [[0, 1], [1, 0]]);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      g.save();
      g.rotate(k * Math.PI / 2);
      const gr = g.createLinearGradient(0, 0, r, 0);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -r * 0.05); g.lineTo(r, 0); g.lineTo(0, r * 0.05); g.fill();
      g.restore();
    }
  });
  cell(FR.RING, (r) => radial(r, [[0, 0], [0.74, 0], [0.86, 1], [0.93, 0.35], [1, 0]]));
  cell(FR.SOFTRING, (r) => radial(r, [[0, 0], [0.45, 0.04], [0.76, 0.55], [0.9, 0.22], [1, 0]]));
  cell(FR.SHOCK, (r) => radial(r, [[0, 0], [0.6, 0.02], [0.82, 0.35], [0.9, 0.9], [0.96, 0.3], [1, 0]]));
  cell(FR.CHUNK, (r) => {
    g.fillStyle = '#fff';
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2, d = r * (0.5 + rnd() * 0.35);
      if (k === 0) g.moveTo(Math.cos(a) * d, Math.sin(a) * d); else g.lineTo(Math.cos(a) * d, Math.sin(a) * d);
    }
    g.fill();
  });
  cell(FR.FLASH, (r) => {
    // side-on muzzle flash: long bright cone with a hot base
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const gr = g.createLinearGradient(-r, 0, r, 0);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      const w = r * (0.35 - k * 0.1);
      g.beginPath();
      g.moveTo(-r, -w); g.quadraticCurveTo(r * 0.2, -w * 0.9, r, 0); g.quadraticCurveTo(r * 0.2, w * 0.9, -r, w);
      g.fill();
    }
  });
  // blood mist: a cloud of fine droplets
  cell(FR.MIST, (r) => {
    radial(r * 0.7, [[0, 0.35], [1, 0]]);
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * r * 0.75, rr = r * (0.03 + rnd() * 0.07);
      g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`;
      g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, Math.PI * 2); g.fill();
    }
  });
  cell(FR.SQUARE, (r) => { g.fillStyle = '#fff'; g.fillRect(-r * 0.6, -r * 0.45, r * 1.2, r * 0.9); });
  cell(FR.SHARD, (r) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(-r * 0.2, -r * 0.8); g.lineTo(r * 0.5, r * 0.1); g.lineTo(-r * 0.1, r * 0.8); g.lineTo(-r * 0.45, 0);
    g.fill();
  });
  cell(FR.BOLT, (r) => {
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-r, 0);
    for (let k = 1; k <= 8; k++) g.lineTo(-r + (k / 8) * r * 2, (rnd() - 0.5) * r * 0.7);
    g.stroke();
  });
  cell(FR.CROSS, (r) => {
    radial(r, [[0, 0.8], [0.4, 0.3], [1, 0]]);
    g.fillStyle = '#fff';
    g.fillRect(-r * 0.12, -r * 0.7, r * 0.24, r * 1.4);
    g.fillRect(-r * 0.7, -r * 0.12, r * 1.4, r * 0.24);
  });
  cell(FR.BUBBLE, (r) => {
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = r * 0.14;
    g.beginPath(); g.arc(0, 0, r * 0.6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fill();
  });
  // spark: a thin hot line with a bright head (stretched along velocity)
  cell(FR.SPARK, (r) => {
    const gr = g.createLinearGradient(-r, 0, r, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(0, 0, r * 0.95, r * 0.12, 0, 0, Math.PI * 2); g.fill();
  });
  // blood drop: a teardrop (stretched along velocity), and a flat splat for the ground
  cell(FR.DROP, (r) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(r * 0.9, 0);
    g.quadraticCurveTo(r * 0.1, -r * 0.34, -r * 0.55, -r * 0.3);
    g.arc(-r * 0.55, 0, r * 0.3, -Math.PI / 2, Math.PI / 2, true);
    g.quadraticCurveTo(r * 0.1, r * 0.34, r * 0.9, 0);
    g.fill();
  });
  { const nz = makeNoise(503); pixels(FR.SPLAT, (u, v) => { const a = Math.atan2(v, u), d = Math.hypot(u, v); const n = nz(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, 3); const reach = 0.45 + n * 0.45 + (Math.sin(a * 7) > 0.8 ? 0.2 : 0); return sm(reach, reach - 0.08, d) * 0.95 + (nz(u * 9, v * 9, 2) > 0.72 && d < 0.95 ? 0.8 : 0); }); }
  // bullet hole: dark core, cracked rim, soot
  { const nz = makeNoise(601); pixels(FR.HOLE, (u, v) => { const d = Math.hypot(u, v), a = Math.atan2(v, u); const n = nz(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 5, 3); const soot = (1 - sm(0.15, 0.9, d + (n - 0.5) * 0.5)) * 0.6; const core = 1 - sm(0.12, 0.2, d); const crack = Math.abs(Math.sin(a * 5 + n * 4)) > 0.96 && d < 0.6 ? 0.7 : 0; return Math.max(core, soot, crack); }); }
  { const nz = makeNoise(701); pixels(FR.SCORCH, (u, v) => { const d = Math.hypot(u, v); const n = nz(u * 3 + 2, v * 3 + 9, 4); return (1 - sm(0.2, 1.0, d + (n - 0.5) * 0.8)) * (0.6 + n * 0.4); }); }
  { const nz = makeNoise(801); pixels(FR.CRACK, (u, v) => { const d = Math.hypot(u, v), a = Math.atan2(v, u); let m = 0; for (let k = 0; k < 7; k++) { const ak = k * 0.9 + 0.3; const da = Math.abs(((a - ak + Math.PI * 3) % (Math.PI * 2)) - Math.PI); m = Math.max(m, sm(0.06, 0.0, da * d + (nz(d * 6, k, 2) - 0.5) * 0.05)); } return m * (1 - sm(0.7, 1, d)) * 0.9; }); }
  cell(FR.EMBER, (r) => radial(r * 0.5, [[0, 1], [0.4, 0.8], [1, 0]]));
  // ambient life / new effects
  cell(FR.LEAF, (r) => {
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(-r * 0.8, 0); g.quadraticCurveTo(-r * 0.1, -r * 0.55, r * 0.8, 0); g.quadraticCurveTo(-r * 0.1, r * 0.55, -r * 0.8, 0); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-r * 0.7, 0); g.lineTo(r * 0.7, 0); g.stroke(); g.globalCompositeOperation = 'source-over';
  });
  cell(FR.PAPER, (r) => {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-r * 0.55, -r * 0.7); g.lineTo(r * 0.5, -r * 0.62); g.lineTo(r * 0.58, r * 0.7); g.lineTo(-r * 0.5, r * 0.6); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k < 6; k++) g.fillRect(-r * 0.4, -r * 0.5 + k * r * 0.17, r * (0.5 + rnd() * 0.4), r * 0.04);
  });
  cell(FR.MOTE, (r) => radial(r * 0.5, [[0, 1], [0.3, 0.55], [1, 0]]));
  // birds: two wing poses seen from below/behind (a dark cross with swept wings)
  [FR.BIRD1, FR.BIRD2].forEach((fr, k) => cell(fr, (r) => {
    g.fillStyle = '#fff';
    const up = k ? -0.55 : 0.4;
    g.beginPath(); g.moveTo(0, -r * 0.12); g.quadraticCurveTo(-r * 0.5, up * r, -r * 0.95, up * r * 0.6 + r * 0.05); g.quadraticCurveTo(-r * 0.5, up * r * 0.5 + r * 0.14, 0, r * 0.14); g.fill();
    g.beginPath(); g.moveTo(0, -r * 0.12); g.quadraticCurveTo(r * 0.5, up * r, r * 0.95, up * r * 0.6 + r * 0.05); g.quadraticCurveTo(r * 0.5, up * r * 0.5 + r * 0.14, 0, r * 0.14); g.fill();
    g.beginPath(); g.ellipse(0, 0, r * 0.11, r * 0.24, 0, 0, Math.PI * 2); g.fill();
  }));
  cell(FR.CRYSTAL, (r) => {
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) {
      g.save(); g.rotate((k / 6) * Math.PI * 2);
      const gr = g.createLinearGradient(0, 0, r * 0.95, 0); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0.1)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -r * 0.05); g.lineTo(r * 0.9, 0); g.lineTo(0, r * 0.05); g.fill();
      g.beginPath(); g.moveTo(r * 0.45, 0); g.lineTo(r * 0.62, -r * 0.16); g.lineTo(r * 0.5, 0); g.lineTo(r * 0.62, r * 0.16); g.fill();
      g.restore();
    }
    radial(r * 0.25, [[0, 1], [1, 0]]);
  });
  cell(FR.STREAK, (r) => {
    const gr = g.createLinearGradient(-r, 0, r, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(-r, 0); g.lineTo(r * 0.9, -r * 0.05); g.quadraticCurveTo(r, 0, r * 0.9, r * 0.05); g.closePath(); g.fill();
  });
  cell(FR.PETAL, (r) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, r * 0.5, r * 0.28, 0, 0, Math.PI * 2); g.fill(); });
  cell(FR.FIREFLY, (r) => radial(r, [[0, 1], [0.12, 0.9], [0.3, 0.25], [1, 0]]));
  cell(FR.SPLASH, (r) => {
    g.fillStyle = '#fff';
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.32, L = r * (0.55 + (k % 2) * 0.25) * (1 - Math.abs(k - 3) * 0.1);
      g.beginPath(); g.moveTo(Math.cos(a) * 3 - 3, 0); g.quadraticCurveTo(Math.cos(a) * L * 0.5, Math.sin(a) * L * 0.5, Math.cos(a) * L, Math.sin(a) * L); g.quadraticCurveTo(Math.cos(a) * L * 0.5 + 4, Math.sin(a) * L * 0.5, Math.cos(a) * 3 + 3, 0); g.fill();
      g.beginPath(); g.arc(Math.cos(a) * L, Math.sin(a) * L, 2.5, 0, Math.PI * 2); g.fill();
    }
  });
  cell(FR.WISP, (r) => { const nz = makeNoise(977); const S2 = 64; void nz; void S2; radial(r, [[0, 0.5], [0.4, 0.25], [1, 0]]); });
  { const nz = makeNoise(901); pixels(FR.BLOB, (u, v) => { const d = Math.hypot(u, v); const n = nz(u * 2.5 + 4, v * 2.5 + 1, 3); return 1 - sm(0.55, 0.8, d + (n - 0.5) * 0.4); }); }
  return c;
}

// ---------------------------------------------------------------------------------------
// shaders

const FOG_FACTOR = /* glsl */`
float hhFog() {
  float f = 0.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      f = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
  return f;
}
`;

const PART_VERT = /* glsl */`
attribute vec4 iPos;    // xyz, rotation
attribute vec4 iCol;    // rgb (HDR), alpha
attribute vec4 iSize;   // width, height, frame, flags (1 flat, 2 stretch along velocity)
attribute vec4 iVel;    // velocity xyz, stretch seconds
varying vec2 vUv;
varying vec4 vCol;
varying float vLocalY;
varying float vDepth;
varying float vWY;
uniform float uSoft;
#include <fog_pars_vertex>
void main() {
  vec2 c = position.xy;          // -0.5..0.5 quad corner
  float fl = iSize.w;
  float cr = cos(iPos.w), sr = sin(iPos.w);
  vec2 q = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * iSize.xy;
  vec4 mvPosition;
  if (mod(fl, 2.0) > 0.5) {
    // lying flat on the ground (rings, glows, puddles)
    mvPosition = modelViewMatrix * vec4(iPos.x + q.x, iPos.y, iPos.z + q.y, 1.0);
  } else {
    mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);
    if (mod(floor(fl / 2.0), 2.0) > 0.5) {
      // stretched along the screen-space velocity (blood drops, sparks, debris trails)
      vec3 vv = (modelViewMatrix * vec4(iVel.xyz, 0.0)).xyz;
      float l = length(vv.xy);
      vec2 ax = l > 1e-3 ? vv.xy / l : vec2(1.0, 0.0);
      vec2 ay = vec2(-ax.y, ax.x);
      q = ax * c.x * (iSize.x + l * iVel.w) + ay * c.y * iSize.y;
    }
    mvPosition.xy += q;
  }
  // world height of this corner (soft ground contact: smoke / fire fade out toward the ground
  // instead of being sliced by it)
  float softD = max(0.6, min(uSoft, 0.7 * iSize.y));
  vWY = (mod(fl, 2.0) > 0.5) ? 9.0 : (iPos.y + viewMatrix[1][0] * q.x + viewMatrix[1][1] * q.y + 0.5) / softD;
  gl_Position = projectionMatrix * mvPosition;
  float fr = iSize.z;
  vUv = (vec2(mod(fr, ${GRID}.0), ${GRID - 1}.0 - floor(fr / ${GRID}.0)) + (c + 0.5)) / ${GRID}.0;
  vCol = iCol;
  vLocalY = c.y + 0.5;
  vDepth = -mvPosition.z;
  #include <fog_vertex>
}
`;

const PART_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uAdditive;
uniform float uSoft;
varying vec2 vUv;
varying vec4 vCol;
varying float vLocalY;
varying float vDepth;
varying float vWY;
#include <fog_pars_fragment>
${FOG_FACTOR}
void main() {
  float a = texture2D(uMap, vUv).a * vCol.a;
  // right in front of the lens a puff would fill the screen: fade it away
  a *= smoothstep(3.0, 20.0, vDepth);
  // and where it meets the ground: a soft contact instead of a hard slice
  a *= smoothstep(0.0, 1.0, vWY);
  if (a < 0.003) discard;
  float f = hhFog();
  vec3 rgb = vCol.rgb;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(rgb * a * (1.0 - f * 0.8), 1.0);
  } else {
    // smoke and dust: lit from above, shadowed underneath
    rgb *= mix(0.7, 1.15, vLocalY);
    #ifdef USE_FOG
      rgb = mix(rgb, fogColor, f);
    #endif
    gl_FragColor = vec4(rgb, a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BEAM_VERT = /* glsl */`
attribute vec4 iA;      // start xyz, width at start
attribute vec4 iB;      // end xyz, width at end
attribute vec4 iCol;    // rgb, alpha
attribute vec4 iParam;  // core (0..1), fade-in length (u), fade-out length (u), unused
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
#include <fog_pars_vertex>
void main() {
  float u = position.x + 0.5;    // along
  float v = position.y * 2.0;    // across -1..1
  vec4 a = modelViewMatrix * vec4(iA.xyz, 1.0);
  vec4 b = modelViewMatrix * vec4(iB.xyz, 1.0);
  vec3 p = mix(a.xyz, b.xyz, u);
  vec3 axis = b.xyz - a.xyz;
  vec3 side = cross(axis, p);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = mix(iA.w, iB.w, u);
  // keep beams at least ~1.2 px wide so far tracers never shimmer away
  float minW = -p.z * 0.0022;
  p += side * v * 0.5 * max(w, minW);
  vec4 mvPosition = vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = vec2(u, v);
  vCol = iCol;
  vParam = iParam;
  #include <fog_vertex>
}
`;

const BEAM_FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
#include <fog_pars_fragment>
${FOG_FACTOR}
void main() {
  float v = abs(vUv.y);
  float glow = exp(-v * v * 5.0) * (1.0 - v);
  float core = smoothstep(0.35, 0.0, v) * vParam.x;
  float along = 1.0;
  if (vParam.y > 0.0) along *= smoothstep(0.0, vParam.y, vUv.x);
  if (vParam.z > 0.0) along *= smoothstep(1.0, 1.0 - vParam.z, vUv.x);
  float a = (glow + core) * along * vCol.a;
  vec3 rgb = mix(vCol.rgb, vec3(max(vCol.r, max(vCol.g, vCol.b))), core * 0.6) * a;
  gl_FragColor = vec4(rgb * (1.0 - hhFog() * 0.8), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function quadGeometry(count, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const out = {};
  for (const name of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out[name] = a;
  }
  g.instanceCount = 0;
  return { geometry: g, attrs: out };
}

function fxMaterial(vert, frag, additive, extra = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, extra]);
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ---------------------------------------------------------------------------------------

function createFx(ctx) {
  const q = QUALITY[ctx.quality] || QUALITY.high;
  // Buffers sized for the biggest tier so setQuality can switch without reallocating.
  const CAP = QUALITY.ultra.particles, BCAP = QUALITY.ultra.beams;
  let cap = q.particles, bcap = q.beams;
  const R = ctx.rng || Math.random;

  // ---- particle state (structure of arrays, swap-remove compaction) ----
  const px = new Float32Array(CAP), py = new Float32Array(CAP), pz = new Float32Array(CAP);
  const vx = new Float32Array(CAP), vy = new Float32Array(CAP), vz = new Float32Array(CAP);
  const age = new Float32Array(CAP), life = new Float32Array(CAP);
  const s0 = new Float32Array(CAP), s1 = new Float32Array(CAP), stretch = new Float32Array(CAP);
  const cr = new Float32Array(CAP), cg = new Float32Array(CAP), cb = new Float32Array(CAP), ca = new Float32Array(CAP);
  const rot = new Float32Array(CAP), vrot = new Float32Array(CAP), grav = new Float32Array(CAP), drag = new Float32Array(CAP);
  const frame = new Uint8Array(CAP), flags = new Uint16Array(CAP), vstr = new Float32Array(CAP);
  let n = 0;

  // immediate-mode (per frame) glows and beams
  const G_CAP = 400;
  const gl = new Float32Array(G_CAP * 12);
  let gn = 0;
  const bm = new Float32Array(BCAP * 16);
  let bn = 0;
  // decals: two ring buffers on the GPU (fx-decals.js)
  const decals = createDecalLayer(ctx.scene, { gore: q.gore, marks: q.marks }, { gore: QUALITY.ultra.gore, marks: QUALITY.ultra.marks });
  // heat / shockwave distortion sources (post.js projects them): { x, h, y, r, k, life, age, kind }
  const DIST_CAP = 6;
  const dist = [];
  let clock = 0;

  // ---- GPU side ----
  const map = atlas();
  const addQ = quadGeometry(CAP + G_CAP, ['iPos', 'iCol', 'iSize', 'iVel']);
  const nrmQ = quadGeometry(CAP, ['iPos', 'iCol', 'iSize', 'iVel']);
  const beamQ = quadGeometry(BCAP, ['iA', 'iB', 'iCol', 'iParam']);
  const addMat = fxMaterial(PART_VERT, PART_FRAG, true, { uMap: { value: map }, uAdditive: { value: 1 }, uSoft: { value: 3.5 } });
  const nrmMat = fxMaterial(PART_VERT, PART_FRAG, false, { uMap: { value: map }, uAdditive: { value: 0 }, uSoft: { value: 9 } });
  const beamMat = fxMaterial(BEAM_VERT, BEAM_FRAG, true);
  addMat.uniforms.uMap.value = map;
  nrmMat.uniforms.uMap.value = map;
  const addMesh = new THREE.Mesh(addQ.geometry, addMat);
  const nrmMesh = new THREE.Mesh(nrmQ.geometry, nrmMat);
  const beamMesh = new THREE.Mesh(beamQ.geometry, beamMat);
  for (const m of [addMesh, nrmMesh, beamMesh]) {
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
  }
  // decals first, then smoke, then additive light on top of it
  nrmMesh.renderOrder = 10;
  addMesh.renderOrder = 11;
  beamMesh.renderOrder = 12;
  const root = new THREE.LOD();
  root.name = 'fx-core';
  root.add(nrmMesh, addMesh, beamMesh);
  root.update = () => flush();     // called by three.js while projecting the scene
  ctx.scene.add(root);

  let pendingDt = 0, lastNow = -1, flushedNow = -2;
  let camX = 0, camH = 52, camZ = 0;

  /** Register the frame (idempotent per frame.now); every user calls it first. */
  function begin(frame) {
    if (frame.now === lastNow) return;
    lastNow = frame.now;
    pendingDt = Math.min(0.1, Math.max(0, frame.dt || 0));
    const c = ctx.camera.position;
    camX = c.x; camH = c.y; camZ = c.z;
  }

  /**
   * Spawn one particle. Position in three.js space: (x, h, y) = sim (x, y) at height h.
   * Colours may exceed 1 (HDR: additive particles above ~1 bloom).
   * @returns {number} index or -1 when the pool is full
   */
  function spawn(x, h, y, vxs, vhs, vys, lifeS, size0, size1, color, alpha, fr, fl, g = 0, dr = 0) {
    if (n >= cap) return -1;
    const i = n++;
    px[i] = x; py[i] = h; pz[i] = y;
    vx[i] = vxs; vy[i] = vhs; vz[i] = vys;
    age[i] = 0; life[i] = Math.max(0.01, lifeS);
    s0[i] = size0; s1[i] = size1; stretch[i] = 1; vstr[i] = 0.03;
    cr[i] = color.r; cg[i] = color.g; cb[i] = color.b; ca[i] = alpha;
    rot[i] = R() * Math.PI * 2; vrot[i] = (fl & F_SPIN) ? (R() - 0.5) * 6 : (R() - 0.5) * 0.8;
    grav[i] = g; drag[i] = dr;
    frame[i] = fr; flags[i] = fl;
    return i;
  }

  function step(dt) {
    let i = 0;
    while (i < n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        const j = --n;
        if (i !== j) {
          px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
          age[i] = age[j]; life[i] = life[j]; s0[i] = s0[j]; s1[i] = s1[j]; stretch[i] = stretch[j]; vstr[i] = vstr[j];
          cr[i] = cr[j]; cg[i] = cg[j]; cb[i] = cb[j]; ca[i] = ca[j]; rot[i] = rot[j]; vrot[i] = vrot[j];
          grav[i] = grav[j]; drag[i] = drag[j]; frame[i] = frame[j]; flags[i] = flags[j];
        }
        continue;
      }
      const k = drag[i] > 0 ? Math.exp(-drag[i] * dt) : 1;
      vx[i] *= k; vz[i] *= k; vy[i] = vy[i] * k - grav[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      rot[i] += vrot[i] * dt;
      if (py[i] < 0.6 && (flags[i] & F_BOUNCE)) {
        py[i] = 0.6;
        if (vy[i] < 0) vy[i] *= -0.35;
        vx[i] *= 0.55; vz[i] *= 0.55; vrot[i] *= 0.5;
        if (Math.abs(vy[i]) < 20) { vy[i] = 0; grav[i] = 0; drag[i] = Math.max(drag[i], 6); }
      }
      i++;
    }
    clock += dt;
    for (let d = dist.length - 1; d >= 0; d--) {
      const e = dist[d];
      e.age += dt;
      if (e.age >= e.life) dist.splice(d, 1);
    }
  }

  function flush() {
    if (flushedNow === lastNow) return;
    flushedNow = lastNow;
    const pendingDt0 = pendingDt;
    if (pendingDt > 0) step(pendingDt);
    pendingDt = 0;
    const aP = addQ.attrs.iPos.array, aC = addQ.attrs.iCol.array, aS = addQ.attrs.iSize.array, aV = addQ.attrs.iVel.array;
    const nP = nrmQ.attrs.iPos.array, nC = nrmQ.attrs.iCol.array, nS = nrmQ.attrs.iSize.array, nV = nrmQ.attrs.iVel.array;
    let na = 0, nn = 0;
    bn = Math.min(bn, bcap);
    for (let i = 0; i < n; i++) {
      const t = age[i] / life[i];
      const f = flags[i];
      // quick fade-in, then fade out over the life
      let a = ca[i] * Math.min(1, age[i] * 30) * (1 - t);
      if (f & F_FLICKER) a *= 0.7 + R() * 0.3;
      let r = cr[i], g = cg[i], b = cb[i];
      if (f & F_FIRE) {
        // white-yellow core → orange → deep red as the tongue rises and cools (HDR: blooms)
        const u = Math.min(1, t * 1.8);
        r = 1.75 - u * 0.95; g = 1.05 - u * 0.87; b = 0.42 - u * 0.4;
        r *= cr[i]; g *= cg[i]; b *= cb[i];
        a *= 1 - t * 0.4;
      } else if (f & F_HOT) {
        // smoke that leaves a fire glows orange before it cools to its own colour
        const u = Math.min(1, t * 3.5);
        r = r + (1.25 - r) * (1 - u); g = g + (0.5 - g) * (1 - u); b = b + (0.12 - b) * (1 - u);
      }
      const size = s0[i] + (s1[i] - s0[i]) * t;
      if (f & F_STREAK) {
        if (bn >= bcap) continue;
        // sparks: a short ribbon along the velocity
        const L = stretch[i] * 0.028;
        const o = bn++ * 16;
        bm[o] = px[i]; bm[o + 1] = py[i]; bm[o + 2] = pz[i]; bm[o + 3] = size;
        bm[o + 4] = px[i] - vx[i] * L; bm[o + 5] = py[i] - vy[i] * L; bm[o + 6] = pz[i] - vz[i] * L; bm[o + 7] = size * 0.3;
        bm[o + 8] = r; bm[o + 9] = g; bm[o + 10] = b; bm[o + 11] = a;
        bm[o + 12] = 0.8; bm[o + 13] = 0; bm[o + 14] = 0.5; bm[o + 15] = 0;
        continue;
      }
      let P, C, S, V, o;
      if (f & F_ADD) { P = aP; C = aC; S = aS; V = aV; o = na++ * 4; } else { P = nP; C = nC; S = nS; V = nV; o = nn++ * 4; }
      P[o] = px[i]; P[o + 1] = py[i]; P[o + 2] = pz[i]; P[o + 3] = rot[i];
      C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = a;
      S[o] = size; S[o + 1] = size * stretch[i]; S[o + 2] = frame[i]; S[o + 3] = ((f & F_FLAT) ? 1 : 0) + ((f & F_VSTRETCH) ? 2 : 0);
      V[o] = vx[i]; V[o + 1] = vy[i]; V[o + 2] = vz[i]; V[o + 3] = vstr[i];
    }
    for (let k = 0; k < gn; k++) {
      const s = k * 12, o = na++ * 4;
      aP[o] = gl[s]; aP[o + 1] = gl[s + 1]; aP[o + 2] = gl[s + 2]; aP[o + 3] = gl[s + 3];
      aC[o] = gl[s + 4]; aC[o + 1] = gl[s + 5]; aC[o + 2] = gl[s + 6]; aC[o + 3] = gl[s + 7];
      aS[o] = gl[s + 8]; aS[o + 1] = gl[s + 9]; aS[o + 2] = gl[s + 10]; aS[o + 3] = gl[s + 11];
      aV[o] = 0; aV[o + 1] = 0; aV[o + 2] = 0; aV[o + 3] = 0;
    }
    gn = 0;
    const bA = beamQ.attrs.iA.array, bB = beamQ.attrs.iB.array, bC = beamQ.attrs.iCol.array, bPa = beamQ.attrs.iParam.array;
    for (let k = 0; k < bn; k++) {
      const s = k * 16, o = k * 4;
      bA[o] = bm[s]; bA[o + 1] = bm[s + 1]; bA[o + 2] = bm[s + 2]; bA[o + 3] = bm[s + 3];
      bB[o] = bm[s + 4]; bB[o + 1] = bm[s + 5]; bB[o + 2] = bm[s + 6]; bB[o + 3] = bm[s + 7];
      bC[o] = bm[s + 8]; bC[o + 1] = bm[s + 9]; bC[o + 2] = bm[s + 10]; bC[o + 3] = bm[s + 11];
      bPa[o] = bm[s + 12]; bPa[o + 1] = bm[s + 13]; bPa[o + 2] = bm[s + 14]; bPa[o + 3] = bm[s + 15];
    }
    upload(addQ, na);
    upload(nrmQ, nn);
    upload(beamQ, bn);
    decals.flush(pendingDt0);
    // children are projected after this hook, so hiding empty pools saves their draw
    addMesh.visible = na > 0;
    nrmMesh.visible = nn > 0;
    beamMesh.visible = bn > 0;
    stats.particles = n;
    stats.beams = bn;
    stats.decals = decals.stats.total;
    bn = 0;
  }

  function upload(qd, count) {
    qd.geometry.instanceCount = count;
    for (const k in qd.attrs) {
      const a = qd.attrs[k];
      a.clearUpdateRanges();
      if (count > 0) {
        a.addUpdateRange(0, count * 4);
        a.needsUpdate = true;
      }
    }
  }

  /** Immediate additive sprite for this frame only (re-submit every frame). */
  function glow(x, h, y, size, color, alpha, fr = FR.GLOW, flat = false, rotation = 0, stretchY = 1) {
    if (gn >= G_CAP) return;
    const o = gn++ * 12;
    gl[o] = x; gl[o + 1] = h; gl[o + 2] = y; gl[o + 3] = rotation;
    gl[o + 4] = color.r; gl[o + 5] = color.g; gl[o + 6] = color.b; gl[o + 7] = alpha;
    gl[o + 8] = size; gl[o + 9] = size * stretchY; gl[o + 10] = fr; gl[o + 11] = flat ? 1 : 0;
  }

  /**
   * Immediate additive ribbon from (ax, ah, ay) to (bx, bh, by) for this frame only.
   * @param {number} core 0..1 white-hot core strength
   */
  function beam(ax, ah, ay, bx, bh, by, w0, w1, color, alpha, core = 0.6, fadeIn = 0, fadeOut = 0) {
    if (bn >= bcap) return;
    const o = bn++ * 16;
    bm[o] = ax; bm[o + 1] = ah; bm[o + 2] = ay; bm[o + 3] = w0;
    bm[o + 4] = bx; bm[o + 5] = bh; bm[o + 6] = by; bm[o + 7] = w1;
    bm[o + 8] = color.r; bm[o + 9] = color.g; bm[o + 10] = color.b; bm[o + 11] = alpha;
    bm[o + 12] = core; bm[o + 13] = fadeIn; bm[o + 14] = fadeOut; bm[o + 15] = 0;
  }

  /**
   * A mark on a surface (bullet hole, scorch...): sim point (x, y) at height h, surface normal
   * (nx, nh, ny) in three.js axes, `size` across. Oldest marks are recycled first. `fr` is a
   * particle-atlas frame (HOLE / SCORCH / CRACK); the decal atlas has its own richer cells.
   */
  function decal(x, h, y, nx, nh, ny, size, fr, color, alpha, lifeS = 40) {
    const cell = fr === FR.SCORCH ? DC.SCORCH + ((R() * DC.SCORCH_N) | 0) : fr === FR.HOLE ? DC.HOLE + ((R() * DC.HOLE_N) | 0) : DC.CRATER;
    decals.add(1, x, h, y, nx, nh, ny, size, cell, DK.DARK, color.r, color.g, color.b, alpha, lifeS);
  }

  /** A heat shimmer that lasts while it is re-registered every frame under the same key. */
  function distortSteady(key, x, h, y, r, k) {
    for (let i = 0; i < dist.length; i++) {
      const e = dist[i];
      if (e.key === key) { e.x = x; e.h = h; e.y = y; e.r = r; e.k = k; e.age = 0; e.life = 0.15; return; }
    }
    if (dist.length >= DIST_CAP) dist.shift();
    dist.push({ key, x, h, y, r, k, life: 0.15, age: 0, kind: 0 });
  }

  /** Register a heat / shockwave distortion source (kind 0 heat shimmer, 1 expanding shock ring). */
  function distort(x, h, y, r, k, life, kind = 0) {
    if (dist.length >= DIST_CAP) dist.shift();
    dist.push({ x, h, y, r, k, life, age: 0, kind });
  }

  const stats = { particles: 0, beams: 0, decals: 0 };

  // ---- gore setting ('on' | 'low' | 'off'): the palette every blood effect draws with ----
  // 'off' replaces red with dark ash for sensitive players; 'low' keeps red but thins it out.
  const gore = {
    mode: 'on',
    /** 1 = full, 0.5 = low, 0 = off: scales the counts of gory particles / decals / gibs. */
    k: 1,
    blood: new THREE.Color('#5a0606'), blood2: new THREE.Color('#7a0a0a'), mist: new THREE.Color('#4a0505'),
    splat: new THREE.Color('#5e0808'), pool: new THREE.Color('#4a0606'), flesh: new THREE.Color('#7a1a1a'),
  };
  function setGore(mode) {
    const m = mode === 'off' || mode === 'low' ? mode : 'on';
    if (m === gore.mode) return false;
    gore.mode = m;
    gore.k = m === 'on' ? 1 : m === 'low' ? 0.5 : 0;
    if (m === 'off') {
      gore.blood.set('#26262a'); gore.blood2.set('#34343a'); gore.mist.set('#2a2a2e');
      gore.splat.set('#4a4a50'); gore.pool.set('#3a3a3e'); gore.flesh.set('#48484c');
    } else {
      gore.blood.set('#5a0606'); gore.blood2.set('#7a0a0a'); gore.mist.set('#4a0505');
      gore.splat.set('#5e0808'); gore.pool.set('#4a0606'); gore.flesh.set('#7a1a1a');
    }
    return true;
  }

  return {
    refs: 0,
    stats,
    begin,
    spawn,
    glow,
    beam,
    decal,
    gore,
    setGore,
    decals,
    distort,
    distortSteady,
    distortions: dist,
    get clock() { return clock; },
    rng: R,
    /** Fraction of the particle pool in use (ambient emitters back off when high). */
    load: () => n / cap,
    /** Distance² from the camera in the ground plane. */
    camDist2: (x, y) => (x - camX) * (x - camX) + (y - camZ) * (y - camZ),
    get camHeight() { return camH; },
    /** Multiply the last spawned particle's height by `k` (stretched sprites: flames). */
    stretchLast: (i, k) => { if (i >= 0) stretch[i] = k; },
    /** Set the rotation (radians in the view plane) / spin of particle i (billboards: 0 = quad x axis to the right). */
    rotLast: (i, r, w = 0) => { if (i >= 0) { rot[i] = r; vrot[i] = w; } },
    /** Seconds of velocity a F_VSTRETCH particle is stretched by (default 0.03). */
    velStretch: (i, k) => { if (i >= 0) vstr[i] = k; },
    get quality() { return cap >= QUALITY.ultra.particles ? 'ultra' : cap <= QUALITY.low.particles ? 'low' : 'high'; },
    setQuality(qn) {
      const qq = QUALITY[qn] || QUALITY.high;
      cap = qq.particles;
      bcap = qq.beams;
      if (n > cap) n = cap;
      decals.setCaps(qq);
    },
    dispose() {
      root.removeFromParent();
      addQ.geometry.dispose(); nrmQ.geometry.dispose(); beamQ.geometry.dispose();
      addMat.dispose(); nrmMat.dispose(); beamMat.dispose();
      decals.dispose();
    },
  };
}
