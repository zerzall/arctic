// Procedural textures and shared sprites. Everything here is generated once per page and
// cached at module level, so several renderers (game, lobby preview) share them.

import {
  makeCanvas, createRng, hashString, periodicFbm, hexToRgb, mix, shade, rgba,
  makeRadialSprite, blobPath, fillCircle, fillEllipse,
} from './util.js';

export const TILE = 256;

// Base colours per ground kind. They are deliberately a little brighter and more
// saturated than "realistic" because the darkness overlay takes most of it away.
export const AREA_COLORS = {
  asphalt: '#34363a',
  concrete: '#6e6c66',
  grass: '#3d5230',
  dirt: '#5a4a38',
  gravel: '#5f5a50',
  sand: '#8f7d5a',
  water: '#123238',
};

const tileCache = new Map();

/**
 * A seamless 256x256 texture tile for a ground kind, tinted around `base`.
 * @param {string} kind 'ground'|'asphalt'|'concrete'|'grass'|'dirt'|'gravel'|'sand'|'water'
 * @param {string} base '#rrggbb'
 */
export function groundTile(kind, base) {
  const key = kind + base;
  let c = tileCache.get(key);
  if (c) return c;
  c = makeCanvas(TILE, TILE);
  const g = c.getContext('2d');
  const rng = createRng(hashString(key));
  const low = periodicFbm(4, 4, rng, 0.55);
  const mid = periodicFbm(16, 2, rng, 0.5);
  const img = g.createImageData(TILE, TILE);
  const d = img.data;
  const [br, bg, bb] = hexToRgb(base);
  const alt = hexToRgb(altColor(kind, base));
  const P = PARAMS[kind] || PARAMS.ground;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const u = x / TILE, v = y / TILE;
      const n = low(u, v);
      const m = mid(u, v);
      let t = clamp01((n - 0.5) * P.mixK + 0.5);
      if (kind === 'sand') {
        // Wind ripples: bands bent by the low-frequency noise.
        const rip = Math.sin((v * 22 + n * 5 + u * 3) * Math.PI * 2);
        t = clamp01(t + rip * 0.12);
      }
      const grain = (rng.next() - 0.5) * P.grain + (m - 0.5) * P.midAmp;
      const f = 1 + (n - 0.5) * P.lowAmp + grain;
      const i = (y * TILE + x) * 4;
      d[i] = (br + (alt[0] - br) * t) * f;
      d[i + 1] = (bg + (alt[1] - bg) * t) * f;
      d[i + 2] = (bb + (alt[2] - bb) * t) * f;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const deco = DECO[kind];
  if (deco) deco(g, rng, base);
  tileCache.set(key, c);
  return c;
}

const PARAMS = {
  ground: { lowAmp: 0.28, grain: 0.1, midAmp: 0.12, mixK: 1.6 },
  asphalt: { lowAmp: 0.18, grain: 0.2, midAmp: 0.08, mixK: 1.2 },
  concrete: { lowAmp: 0.16, grain: 0.1, midAmp: 0.1, mixK: 1.3 },
  grass: { lowAmp: 0.3, grain: 0.18, midAmp: 0.16, mixK: 2.0 },
  dirt: { lowAmp: 0.3, grain: 0.14, midAmp: 0.16, mixK: 1.8 },
  gravel: { lowAmp: 0.2, grain: 0.3, midAmp: 0.12, mixK: 1.4 },
  sand: { lowAmp: 0.2, grain: 0.09, midAmp: 0.08, mixK: 1.5 },
  water: { lowAmp: 0.35, grain: 0.03, midAmp: 0.1, mixK: 2.0 },
};

function altColor(kind, base) {
  switch (kind) {
    case 'grass': return mix(base, '#6b6a3a', 0.45);     // dry, yellowed patches
    case 'dirt': return shade(base, -0.25);
    case 'gravel': return mix(base, '#7a7466', 0.5);
    case 'sand': return mix(base, '#b5a07a', 0.35);
    case 'asphalt': return shade(base, -0.3);
    case 'concrete': return mix(base, '#58564f', 0.6);
    case 'water': return mix(base, '#1d4a50', 0.8);
    default: return mix(base, '#5a4a36', 0.35);
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Call fn at (x, y) and at its wrapped copies when the shape crosses a tile edge. */
function wrapped(x, y, m, fn) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx * TILE, py = y + dy * TILE;
      if (px + m < 0 || py + m < 0 || px - m > TILE || py - m > TILE) continue;
      fn(px, py);
    }
  }
}

const DECO = {
  asphalt(g, rng) {
    // Light aggregate chips and dark tar seams.
    for (let i = 0; i < 900; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE;
      g.fillStyle = rng.chance(0.5) ? 'rgba(200,200,190,0.10)' : 'rgba(0,0,0,0.14)';
      g.fillRect(x, y, 1 + rng.next(), 1 + rng.next());
    }
    for (let i = 0; i < 5; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE, r = 10 + rng.next() * 26;
      wrapped(x, y, r, (px, py) => {
        g.fillStyle = 'rgba(0,0,0,0.07)';
        blobPath(g, px, py, r, rng, 10, 0.5);
        g.fill();
      });
    }
  },
  concrete(g, rng) {
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let k = 0; k <= TILE; k += 128) {
      g.moveTo(k + 0.5, 0); g.lineTo(k + 0.5, TILE);
      g.moveTo(0, k + 0.5); g.lineTo(TILE, k + 0.5);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.beginPath();
    for (let k = 0; k <= TILE; k += 128) {
      g.moveTo(k + 2, 0); g.lineTo(k + 2, TILE);
      g.moveTo(0, k + 2); g.lineTo(TILE, k + 2);
    }
    g.stroke();
    for (let i = 0; i < 7; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE, r = 8 + rng.next() * 22;
      wrapped(x, y, r, (px, py) => {
        g.fillStyle = 'rgba(40,30,20,0.08)';
        blobPath(g, px, py, r, rng, 9, 0.6);
        g.fill();
      });
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      g.fillRect(rng.next() * TILE, rng.next() * TILE, 1, 1);
    }
  },
  grass(g, rng, base) {
    const light = rgba(mix(base, '#9fb86a', 0.35), 0.5);
    const dark = rgba(shade(base, -0.45), 0.55);
    const dry = rgba(mix(base, '#9a9055', 0.5), 0.45);
    g.lineCap = 'round';
    for (let i = 0; i < 1500; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE;
      const a = -Math.PI / 2 + (rng.next() - 0.5) * 1.6;
      const len = 2 + rng.next() * 4;
      const r = rng.next();
      g.strokeStyle = r < 0.45 ? dark : r < 0.85 ? light : dry;
      g.lineWidth = 0.8 + rng.next() * 0.7;
      wrapped(x, y, len, (px, py) => {
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
        g.stroke();
      });
    }
  },
  dirt(g, rng, base) {
    for (let i = 0; i < 220; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE, r = 0.8 + rng.next() * 1.8;
      g.fillStyle = rng.chance(0.5) ? rgba(shade(base, 0.25), 0.45) : 'rgba(0,0,0,0.25)';
      fillCircle(g, x, y, r);
    }
    for (let i = 0; i < 10; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE, r = 6 + rng.next() * 16;
      wrapped(x, y, r, (px, py) => {
        g.fillStyle = 'rgba(0,0,0,0.06)';
        blobPath(g, px, py, r, rng, 9, 0.6);
        g.fill();
      });
    }
  },
  gravel(g, rng, base) {
    for (let i = 0; i < 1400; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE, r = 0.8 + rng.next() * 1.8;
      const c = mix(base, rng.chance(0.5) ? '#a09a8c' : '#3a362f', rng.next() * 0.7);
      fillEllipse(g, x + 0.4, y + 0.6, r, r * 0.8, 'rgba(0,0,0,0.35)');
      fillEllipse(g, x, y, r, r * 0.8, c);
    }
  },
  sand(g, rng) {
    for (let i = 0; i < 160; i++) {
      g.fillStyle = rng.chance(0.6) ? 'rgba(60,45,25,0.35)' : 'rgba(255,240,210,0.2)';
      fillCircle(g, rng.next() * TILE, rng.next() * TILE, 0.6 + rng.next() * 1.2);
    }
  },
  ground(g, rng, base) {
    DECO.grass(g, rng, mix(base, '#3d5230', 0.3));
    DECO.dirt(g, rng, base);
  },
  water(g, rng) {
    for (let i = 0; i < 60; i++) {
      const x = rng.next() * TILE, y = rng.next() * TILE, len = 10 + rng.next() * 30;
      wrapped(x, y, len, (px, py) => {
        g.strokeStyle = 'rgba(120,190,200,0.05)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + len / 2, py - 3, px + len, py);
        g.stroke();
      });
    }
  },
};

// ---- water shimmer ----------------------------------------------------------------------

let shimmerTile = null;

/** Tileable wavy highlight lines, scrolled over water every frame with 'lighter'. */
export function waterShimmerTile() {
  if (shimmerTile) return shimmerTile;
  const c = makeCanvas(TILE, TILE);
  const g = c.getContext('2d');
  const rng = createRng(77);
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = rng.next() * TILE, y = rng.next() * TILE, len = 12 + rng.next() * 34;
    const a = 0.05 + rng.next() * 0.14;
    wrapped(x, y, len, (px, py) => {
      g.strokeStyle = `rgba(150,215,230,${a})`;
      g.lineWidth = 1 + rng.next() * 1.5;
      g.beginPath();
      g.moveTo(px, py);
      g.bezierCurveTo(px + len * 0.3, py - 3, px + len * 0.6, py + 3, px + len, py);
      g.stroke();
    });
  }
  shimmerTile = c;
  return c;
}

// ---- light sprites ----------------------------------------------------------------------

let glowWhite = null;
/** White radial falloff, used as a light cut-out and as a generic soft dot. */
export function glowSprite() {
  if (!glowWhite) {
    glowWhite = makeRadialSprite(128, [[0, 1], [0.2, 0.9], [0.45, 0.55], [0.7, 0.22], [0.88, 0.06], [1, 0]]);
  }
  return glowWhite;
}

const tintedGlows = new Map();
/** Coloured radial glow for additive light pools. */
export function tintedGlow(color) {
  let c = tintedGlows.get(color);
  if (!c) {
    c = makeRadialSprite(128, [[0, 0.9], [0.25, 0.55], [0.5, 0.25], [0.75, 0.08], [1, 0]], color);
    tintedGlows.set(color, c);
  }
  return c;
}

let hotCore = null;
/** Bright core glow (white centre, used for flashes and flames). */
export function coreSprite() {
  if (!hotCore) hotCore = makeRadialSprite(64, [[0, 1], [0.3, 0.8], [0.6, 0.25], [1, 0]]);
  return hotCore;
}

let cone = null;
export const CONE_HALF_ANGLE = 0.46;
/**
 * Flashlight cone, apex at the left-middle of the sprite (0, 128) pointing along +x.
 * Drawn scaled so its width equals the beam range.
 */
export function coneSprite() {
  if (cone) return cone;
  const W = 256, H = 256;
  cone = makeCanvas(W, H);
  const g = cone.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5, dy = y + 0.5 - H / 2;
      const r = Math.hypot(dx, dy) / W;
      if (r > 1) continue;
      const ang = Math.abs(Math.atan2(dy, dx));
      const edge = 1 - smooth((ang - CONE_HALF_ANGLE * 0.55) / (CONE_HALF_ANGLE * 0.45));
      const radial = Math.pow(1 - r, 0.9) * smooth(r / 0.08);
      const a = Math.max(0, Math.min(1, edge * radial * 1.25));
      d[(y * W + x) * 4 + 3] = a * 255;
      d[(y * W + x) * 4] = d[(y * W + x) * 4 + 1] = d[(y * W + x) * 4 + 2] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cone;
}

function smooth(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// ---- particles & decals -----------------------------------------------------------------

const fireSprites = [];
/** Flame blobs from hot core (0) to dark red (2). */
export function fireSprite(i) {
  if (!fireSprites.length) {
    fireSprites.push(makeRadialSprite(64, [[0, 1], [0.25, 0.9], [0.55, 0.35], [1, 0]], '#fff1c4'));
    fireSprites.push(makeRadialSprite(64, [[0, 0.95], [0.3, 0.75], [0.6, 0.3], [1, 0]], '#ff9a2e'));
    fireSprites.push(makeRadialSprite(64, [[0, 0.8], [0.35, 0.55], [0.7, 0.18], [1, 0]], '#d8401a'));
    fireSprites.push(makeRadialSprite(64, [[0, 0.9], [0.3, 0.7], [0.6, 0.25], [1, 0]], '#9dff4a'));
    fireSprites.push(makeRadialSprite(64, [[0, 1], [0.3, 0.75], [0.6, 0.25], [1, 0]], '#9fdcff'));
  }
  return fireSprites[i];
}

let smokeSprite = null;
/** Soft grey puff with a noisy edge. */
export function smokePuff() {
  if (smokeSprite) return smokeSprite;
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const rng = createRng(4242);
  for (let i = 0; i < 9; i++) {
    const x = 32 + (rng.next() - 0.5) * 20, y = 32 + (rng.next() - 0.5) * 20, r = 10 + rng.next() * 10;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  smokeSprite = c;
  return c;
}

const bloodSprites = new Map();
/**
 * Blood splat decal variants. `tone` 'red' (fresh), 'green' (bloater/acid), 'dark' (pool).
 * Returns an array of canvases (all 96x96, centred).
 */
export function bloodSplats(tone = 'red') {
  let arr = bloodSprites.get(tone);
  if (arr) return arr;
  arr = [];
  const col = tone === 'green' ? ['#3f5a12', '#5d7a1c', '#2e420b'] : tone === 'dark' ? ['#3a0606', '#4a0909', '#2a0404'] : ['#6e0b0b', '#8a1010', '#520707'];
  for (let v = 0; v < 6; v++) {
    const c = makeCanvas(96, 96);
    const g = c.getContext('2d');
    const rng = createRng(hashString(tone) + v * 131);
    // Main pool
    g.fillStyle = rgba(col[0], 0.85);
    blobPath(g, 48, 48, 16 + rng.next() * 6, rng, 12, 0.45);
    g.fill();
    g.fillStyle = rgba(col[2], 0.6);
    blobPath(g, 48 + (rng.next() - 0.5) * 6, 48 + (rng.next() - 0.5) * 6, 9 + rng.next() * 4, rng, 10, 0.4);
    g.fill();
    // Spatter streaks + droplets flung in a preferred direction
    const dir = rng.next() * Math.PI * 2;
    for (let i = 0; i < 16; i++) {
      const a = dir + (rng.next() - 0.5) * 2.2;
      const dist = 16 + rng.next() * 28;
      const x = 48 + Math.cos(a) * dist, y = 48 + Math.sin(a) * dist;
      const r = 0.8 + rng.next() * 3;
      g.fillStyle = rgba(col[1], 0.8);
      fillEllipse(g, x, y, r * 1.6, r, null, a);
      g.fill();
    }
    // glossy highlight so fresh blood reads as wet
    if (tone !== 'dark') {
      g.fillStyle = 'rgba(255,255,255,0.07)';
      fillEllipse(g, 44, 44, 6, 3, null, -0.6);
    }
    arr.push(c);
  }
  bloodSprites.set(tone, arr);
  return arr;
}

let scorch = null;
/** Burnt ground left by explosions. 128x128, centred. */
export function scorchSprite() {
  if (scorch) return scorch;
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const rng = createRng(999);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(8,6,5,0.9)');
  grad.addColorStop(0.5, 'rgba(15,12,10,0.7)');
  grad.addColorStop(1, 'rgba(20,16,12,0)');
  g.fillStyle = grad;
  blobPath(g, 64, 64, 58, rng, 16, 0.3);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * Math.PI * 2, r0 = 14 + rng.next() * 10, r1 = 38 + rng.next() * 24;
    g.lineWidth = 1 + rng.next() * 2.5;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0);
    g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1);
    g.stroke();
  }
  scorch = c;
  return c;
}

let crackSprite = null;
/** Radial ground cracks for the boss slam. 128x128. */
export function slamCracks() {
  if (crackSprite) return crackSprite;
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const rng = createRng(31337);
  g.strokeStyle = 'rgba(10,8,6,0.8)';
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    let a = (i / 12) * Math.PI * 2 + rng.next() * 0.4;
    let x = 64, y = 64;
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 4 + rng.int(0, 3);
    for (let s = 0; s < steps; s++) {
      a += (rng.next() - 0.5) * 0.7;
      const l = 6 + rng.next() * 9;
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      g.lineTo(x, y);
      g.lineWidth = Math.max(0.6, g.lineWidth * 0.8);
    }
    g.stroke();
  }
  fillCircle(g, 64, 64, 12, 'rgba(10,8,6,0.5)');
  crackSprite = c;
  return c;
}
