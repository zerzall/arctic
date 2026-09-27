// Procedural textures of the static world (WORLD): the emissive atlas (lit windows with
// silhouettes, neon signs, pump displays), the chain-link fence mask and the water normal
// map. All painted on canvases at start-up; nothing is loaded from files.

import * as THREE from 'three';
import { periodicFbm, createRng } from '../render/util.js';

const AW = 1024, AH = 512;
// Atlas cells in canvas pixels [x0, y0, x1, y1] (y down).
const CELLS = {
  white: [8, 8, 56, 56],
  win: [64, 0, 192, 128],
  winCool: [192, 0, 320, 128],
  busWin: [320, 0, 576, 128],
  dinerWin: [576, 0, 832, 128],
  winDim: [832, 0, 960, 128],
  neonDiner: [0, 128, 512, 256],
  neonEat: [512, 128, 768, 256],
  pump: [768, 128, 896, 192],
  sign: [0, 256, 256, 320],
  stripe: [256, 256, 384, 320],
};

/** UV rect [u0, v0, u1, v1] of an atlas cell (texture uses flipY = true). */
export function atlasUV(name) {
  const c = CELLS[name] || CELLS.white;
  return [c[0] / AW, 1 - c[3] / AH, c[2] / AW, 1 - c[1] / AH];
}

/** The emissive atlas as a texture (new texture each call; the canvas is shared). */
export function makeAtlasTexture() {
  const tex = new THREE.CanvasTexture(atlasCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

let atlas = null;
function atlasCanvas() {
  if (atlas) return atlas;
  atlas = document.createElement('canvas');
  atlas.width = AW;
  atlas.height = AH;
  const g = atlas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, AW, AH);
  const rng = createRng(777);
  const cell = (name, fn) => {
    const [x0, y0, x1, y1] = CELLS[name];
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    g.translate(x0, y0);
    fn(x1 - x0, y1 - y0);
    g.restore();
  };
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 64);

  const warmRoom = (w, h, top = '#ffd896', bot = '#c9782f') => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bot);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  };
  const frame = (w, h, t = 6) => {
    g.strokeStyle = '#120d08';
    g.lineWidth = t;
    g.strokeRect(t / 2, t / 2, w - t, h - t);
  };
  const person = (x, y, s, col = 'rgba(28,16,10,0.93)') => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(x, y, 9 * s, 11 * s, 0, 0, Math.PI * 2);   // head
    g.fill();
    g.beginPath();
    g.moveTo(x - 22 * s, y + 60 * s);
    g.quadraticCurveTo(x - 22 * s, y + 14 * s, x, y + 13 * s);
    g.quadraticCurveTo(x + 22 * s, y + 14 * s, x + 22 * s, y + 60 * s);
    g.fill();
  };

  cell('win', (w, h) => {
    warmRoom(w, h);
    // curtains half drawn
    g.fillStyle = 'rgba(120,50,20,0.55)';
    g.fillRect(0, 0, w * 0.22, h);
    g.fillRect(w * 0.8, 0, w * 0.2, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 4; x < w * 0.22; x += 8) g.fillRect(x, 0, 3, h);
    frame(w, h);
    g.fillStyle = '#120d08';
    g.fillRect(w / 2 - 3, 0, 6, h);
    g.fillRect(0, h * 0.45, w, 6);
  });
  cell('winCool', (w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#e6f4ff');
    grad.addColorStop(1, '#7ea6c4');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(20,30,40,0.35)';
    for (let y = 6; y < h * 0.7; y += 9) g.fillRect(0, y, w, 3);   // blinds
    frame(w, h);
  });
  cell('winDim', (w, h) => {
    warmRoom(w, h, '#7a5a3a', '#3a2616');
    person(w * 0.6, h * 0.42, 1.2, 'rgba(10,6,4,0.9)');
    frame(w, h);
  });
  cell('busWin', (w, h) => {
    warmRoom(w, h, '#ffe0a6', '#d08a3c');
    // kids' and adults' heads above the seat backs
    const heads = [[0.16, 0.42, 0.9], [0.4, 0.5, 0.7], [0.63, 0.38, 1.0], [0.86, 0.52, 0.65]];
    for (const [x, y, s] of heads) person(w * x, h * y, s * 1.3);
    g.fillStyle = 'rgba(60,25,15,0.9)';
    g.fillRect(0, h * 0.72, w, h * 0.28);   // seat backs
    g.fillStyle = '#120d08';
    for (let x = 0; x <= w; x += w / 2) g.fillRect(x - 5, 0, 10, h);
    frame(w, h, 8);
  });
  cell('dinerWin', (w, h) => {
    warmRoom(w, h, '#fff0c8', '#e0a050');
    // pendant lamps
    for (let x = 30; x < w; x += 64) {
      g.fillStyle = '#fffbe8';
      g.beginPath();
      g.arc(x, 16, 9, 0, Math.PI);
      g.fill();
    }
    person(w * 0.22, h * 0.45, 1.1);
    person(w * 0.55, h * 0.5, 0.95);
    person(w * 0.8, h * 0.4, 1.15);
    g.fillStyle = '#7a1a1a';
    g.fillRect(0, h * 0.74, w, h * 0.1);    // counter
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, h * 0.84, w, h * 0.04);
    g.fillStyle = '#120d08';
    for (let x = 0; x <= w; x += w / 4) g.fillRect(x - 3, 0, 6, h);
    frame(w, h, 6);
  });
  const neon = (w, h, text, core, glow, size) => {
    g.fillStyle = '#12070c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,60,70,0.8)';
    g.lineWidth = 4;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.font = `bold ${size}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = glow;
    for (const blur of [26, 14, 6]) {
      g.shadowBlur = blur;
      g.strokeStyle = glow;
      g.lineWidth = 7;
      g.strokeText(text, w / 2, h / 2 + 4);
    }
    g.shadowBlur = 4;
    g.lineWidth = 3;
    g.strokeStyle = core;
    g.strokeText(text, w / 2, h / 2 + 4);
    g.shadowBlur = 0;
  };
  cell('neonDiner', (w, h) => neon(w, h, 'DINER', '#fff0f6', '#ff3d8b', 92));
  cell('neonEat', (w, h) => neon(w, h, 'EAT', '#fff4d8', '#ff7a1a', 90));
  cell('pump', (w, h) => {
    g.fillStyle = '#0a1208';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9dff7a';
    g.font = 'bold 26px monospace';
    g.textBaseline = 'middle';
    g.fillText('88.8', 12, h * 0.34);
    g.fillStyle = '#ffb347';
    g.fillText('$ 0.00', 12, h * 0.74);
  });
  cell('sign', (w, h) => {
    g.fillStyle = '#1d5a36';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8e8e8';
    g.lineWidth = 4;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#eeeeee';
    g.font = 'bold 30px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(rng.next() < 2 ? 'EXIT 9 ▸' : '', w / 2, h / 2 + 2);
  });
  cell('stripe', (w, h) => {
    for (let x = -h; x < w + h; x += 32) {
      g.fillStyle = '#e8e2d0';
      g.beginPath();
      g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0);
      g.fill();
    }
  });
  return atlas;
}

/** Chain-link fence mask (alpha), repeat every 16 units. */
export function makeChainLinkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(200,205,210,1)';
  g.lineWidth = 3;
  g.beginPath();
  for (let k = -64; k <= 128; k += 32) {
    g.moveTo(k, 0); g.lineTo(k + 64, 64);
    g.moveTo(k + 64, 0); g.lineTo(k, 64);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tileable water normal map from fBm ripples. */
export function makeWaterNormal() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const rng = createRng(31337);
  const f = periodicFbm(8, 3, rng, 0.5);
  const hts = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hts[y * N + x] = f(x / N, y / N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hx = hts[y * N + ((x + 1) % N)] - hts[y * N + ((x + N - 1) % N)];
      const hy = hts[((y + 1) % N) * N + x] - hts[((y + N - 1) % N) * N + x];
      const nx = -hx * 6, ny = -hy * 6, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * N + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
