// Procedural textures of the static world (WORLD): the atlas (lit windows with silhouettes,
// neon signs, pump displays, licence plates, hazard stripes, placards, posters, shop
// fronts, fluorescent tubes), the chain-link fence mask, leaf-cluster and grass cards and
// the water normal map. All painted on canvases at start-up; nothing is loaded from files.

import * as THREE from 'three';
import { periodicFbm, createRng } from '../render/util.js';

const AW = 1024, AH = 1536;
// Atlas cells in canvas pixels [x0, y0, x1, y1] (y down).
const CELLS = {
  plate0: [0, 512, 128, 576],
  plate1: [128, 512, 256, 576],
  plate2: [256, 512, 384, 576],
  plate3: [384, 512, 512, 576],
  stripeRW: [512, 512, 640, 576],
  stripeYB: [640, 512, 768, 576],
  tube: [768, 512, 832, 576],
  hazmat: [832, 512, 896, 576],
  star: [896, 512, 960, 576],
  poster0: [0, 576, 128, 768],
  poster1: [128, 576, 256, 768],
  poster2: [256, 576, 384, 768],
  shop: [384, 576, 640, 704],
  winTV: [640, 576, 768, 704],
  winBlind: [768, 576, 896, 704],
  winOffice: [896, 576, 1024, 704],
  truckSign: [0, 768, 512, 896],
  garage: [512, 768, 640, 896],
  speed: [640, 768, 768, 896],
  roadSign: [768, 768, 1024, 896],
  motel: [0, 896, 512, 1024],
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
  gantry: [384, 256, 896, 448],
  gasSign: [896, 256, 1024, 448],
};
// Painted shop / building signs (256 x 64, 4 columns x 6 rows), neon signs (2 rows) and
// spray-paint graffiti with alpha (128 x 64, in the free corner under the road signs).
export const SIGN_NAMES = [
  'PHARMACY', 'HARDWARE', 'DELI & GROCERY', 'PAWN SHOP', 'CAFE', 'LAUNDROMAT', 'BAKERY', 'GUNS & AMMO', 'LIQUOR', 'AUTO PARTS', 'MOTEL OFFICE', 'BARBER SHOP',
  'FEED & SEED', 'BAIL BONDS', 'GENERAL STORE', 'TIRES', 'POST OFFICE', 'SHERIFF', 'CLINIC', 'BAR & GRILL', 'PIZZA', 'VIDEO RENTAL', 'SAWMILL CO.', "ST. JUDE'S CHURCH",
];
export const NEON_NAMES = ['OPEN', 'BAR', 'PIZZA', 'HOTEL', 'LIQUOR', '24 HR', 'CAFE', 'MOTEL'];
SIGN_NAMES.forEach((_, i) => { CELLS['sign' + i] = [(i % 4) * 256, 1024 + Math.floor(i / 4) * 64, (i % 4) * 256 + 256, 1024 + Math.floor(i / 4) * 64 + 64]; });
NEON_NAMES.forEach((_, i) => { CELLS['nsign' + i] = [(i % 4) * 256, 1408 + Math.floor(i / 4) * 64, (i % 4) * 256 + 256, 1408 + Math.floor(i / 4) * 64 + 64]; });
for (let i = 0; i < 9; i++) CELLS['gfx' + i] = [(i % 3) * 128, 320 + Math.floor(i / 3) * 64, (i % 3) * 128 + 128, 320 + Math.floor(i / 3) * 64 + 64];
export const SIGN_COUNT = SIGN_NAMES.length, NEON_COUNT = NEON_NAMES.length, GFX_COUNT = 9;

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
    g.fillText('EXIT 9 ▸', w / 2, h / 2 + 2);
  });
  cell('stripe', (w, h) => {
    for (let x = -h; x < w + h; x += 32) {
      g.fillStyle = '#e8e2d0';
      g.beginPath();
      g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0);
      g.fill();
    }
  });
  paintExtraCells(g, cell, person);
  paintFacadeCells(g, cell);
  return atlas;
}

/** Plates, hazard stripes, placards, posters, shop fronts, signs (the atlas' lower half). */
function paintExtraCells(g, cell, person) {
  const plates = [['7HX 214', '#f4f2ea', '#1b2a5a', 'CALIFORNIA'], ['BRT 9Z2', '#f7e7a8', '#1a1a1a', 'NEVADA'], ['4KD-771', '#eef1f4', '#8a1a1a', 'OREGON'], ['ZMB 0NE', '#f2f2f2', '#1d4a2a', 'ARIZONA']];
  plates.forEach(([txt, bg, fg, state], k) => cell('plate' + k, (w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 4;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = fg;
    g.font = 'bold 12px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(state, w / 2, 7);
    g.font = 'bold 30px "Courier New", monospace';
    g.textBaseline = 'middle';
    g.fillText(txt, w / 2, h * 0.62);
    // grime toward the bottom
    const gr = g.createLinearGradient(0, h * 0.5, 0, h);
    gr.addColorStop(0, 'rgba(60,50,30,0)');
    gr.addColorStop(1, 'rgba(60,50,30,0.35)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }));
  const stripes = (w, h, a, b) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    for (let x = -h * 2; x < w + h; x += 32) {
      g.beginPath();
      g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0);
      g.fill();
    }
  };
  cell('stripeRW', (w, h) => stripes(w, h, '#f2efe8', '#c41a1a'));
  cell('stripeYB', (w, h) => stripes(w, h, '#f2c21a', '#141414'));
  cell('tube', (w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(0.3, '#ffffff');
    gr.addColorStop(0.7, '#ffffff');
    gr.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  cell('hazmat', (w, h) => {
    g.fillStyle = '#d8262a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#ffffff';
    g.font = 'bold 22px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('1203', w / 2, h * 0.42);
    g.font = 'bold 12px Arial, sans-serif';
    g.fillText('3', w / 2, h * 0.78);
  });
  cell('star', (w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)';
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#434a22';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9d6c4';
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? w * 0.18 : w * 0.44;
      g.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr);
    }
    g.fill();
  });
  const poster = (w, h, bg, title, sub, col) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = col;
    g.font = 'bold 26px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(title, w / 2, 14);
    g.font = 'bold 13px Arial, sans-serif';
    g.fillText(sub, w / 2, 48);
    person(w * 0.5, h * 0.52, 1.5, 'rgba(0,0,0,0.6)');
    // torn corner and weathering
    g.fillStyle = 'rgba(40,36,30,0.9)';
    g.beginPath();
    g.moveTo(w, h); g.lineTo(w * 0.62, h); g.lineTo(w, h * 0.78);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let k = 0; k < 40; k++) g.fillRect(Math.random() * w, Math.random() * h, 2, 6);
  };
  cell('poster0', (w, h) => poster(w, h, '#d8cfb8', 'MISSING', 'HAVE YOU SEEN ME?', '#1a1a1a'));
  cell('poster1', (w, h) => poster(w, h, '#8a1d1d', 'EVACUATE', 'ROUTE 9 NORTH', '#f2e6c8'));
  cell('poster2', (w, h) => poster(w, h, '#1d3a5a', 'QUARANTINE', 'ZONE C - NO ENTRY', '#f2e6c8'));
  cell('shop', (w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#fff6e0');
    gr.addColorStop(1, '#d8b47a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    // shelves with goods
    for (let y = 30; y < h - 10; y += 28) {
      g.fillStyle = '#6a4a2a';
      g.fillRect(0, y, w, 4);
      for (let x = 4; x < w - 8; x += 9) {
        g.fillStyle = ['#c43a2a', '#2a6ac4', '#e0c02a', '#3a9a4a', '#e8e8e8'][(x * 7 + y) % 5];
        g.fillRect(x, y - 8 - ((x * 13 + y) % 7), 7, 8 + ((x * 13 + y) % 7));
      }
    }
    g.fillStyle = 'rgba(20,10,5,0.85)';
    g.fillRect(0, 0, w, 6);
    g.fillRect(0, h - 6, w, 6);
    for (let x = 0; x <= w; x += w / 3) g.fillRect(x - 3, 0, 6, h);
    person(w * 0.7, h * 0.36, 1.3, 'rgba(25,14,8,0.85)');
  });
  cell('winTV', (w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#7fa8ff');
    gr.addColorStop(1, '#27407a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#0a0d14';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#0a0d14';
    g.fillRect(w / 2 - 3, 0, 6, h);
  });
  cell('winBlind', (w, h) => {
    g.fillStyle = '#f0d6a0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(90,60,30,0.55)';
    for (let y = 4; y < h; y += 7) g.fillRect(0, y, w, 3);
    g.strokeStyle = '#120d08';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
  });
  cell('winOffice', (w, h) => {
    g.fillStyle = '#e8f0ff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let x = 12; x < w; x += 40) g.fillRect(x, 6, 26, 5);   // ceiling tubes
    g.fillStyle = 'rgba(60,70,90,0.5)';
    g.fillRect(0, h * 0.62, w, h * 0.38);                       // desks / partitions
    person(w * 0.3, h * 0.44, 0.9, 'rgba(20,24,34,0.8)');
    g.strokeStyle = '#141820';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
  });
  const neonText = (w, h, text, core, glow, size, frame = true) => {
    g.fillStyle = '#0c0a10';
    g.fillRect(0, 0, w, h);
    if (frame) {
      g.strokeStyle = 'rgba(90,80,90,0.9)';
      g.lineWidth = 6;
      g.strokeRect(4, 4, w - 8, h - 8);
    }
    g.font = `bold ${size}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = glow;
    for (const blur of [24, 12, 5]) {
      g.shadowBlur = blur;
      g.strokeStyle = glow;
      g.lineWidth = 6;
      g.strokeText(text, w / 2, h / 2 + 3);
    }
    g.shadowBlur = 3;
    g.lineWidth = 2.5;
    g.strokeStyle = core;
    g.strokeText(text, w / 2, h / 2 + 3);
    g.shadowBlur = 0;
  };
  cell('truckSign', (w, h) => neonText(w, h, 'TRUCK STOP', '#fff8e0', '#ffb020', 58));
  cell('motel', (w, h) => neonText(w, h, 'MOTEL  VACANCY', '#f0fff8', '#20e0a0', 50));
  cell('garage', (w, h) => {
    g.fillStyle = '#8a8c88';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y + 13, w, 3);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(0, y, w, 2);
    }
    g.fillStyle = 'rgba(80,40,20,0.35)';
    g.fillRect(0, h * 0.8, w, h * 0.2);
  });
  cell('speed', (w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111';
    g.lineWidth = 5;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#111';
    g.font = 'bold 18px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText('SPEED', w / 2, 16);
    g.fillText('LIMIT', w / 2, 36);
    g.font = 'bold 52px Arial, sans-serif';
    g.fillText('55', w / 2, 60);
  });
  cell('roadSign', (w, h) => {
    g.fillStyle = '#1d5a36';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#eeeeee';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#eeeeee';
    g.font = 'bold 24px Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('BLACKWATER', 18, 38);
    g.fillText('FORT DELTA', 18, 76);
    g.textAlign = 'right';
    g.fillText('12', w - 18, 38);
    g.fillText('31', w - 18, 76);
    g.font = 'bold 16px Arial, sans-serif';
    g.textAlign = 'left';
    g.fillText('▲ NORTH  I-9', 18, 108);
  });
  // overpass fascia sign: the crossing interstate and the next exit
  cell('gantry', (w, h) => {
    g.fillStyle = '#17563a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#eeeeee';
    g.lineWidth = 5;
    g.strokeRect(8, 8, w - 16, h - 16);
    // interstate shield
    g.fillStyle = '#eeeeee';
    g.beginPath();
    g.moveTo(40, 30); g.lineTo(120, 30); g.lineTo(124, 70); g.quadraticCurveTo(118, 118, 80, 132); g.quadraticCurveTo(42, 118, 36, 70);
    g.closePath();
    g.fill();
    g.fillStyle = '#1d3f8a';
    g.fillRect(44, 58, 72, 44);
    g.fillStyle = '#c62828';
    g.fillRect(44, 36, 72, 18);
    g.fillStyle = '#eeeeee';
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('44', 80, 82);
    g.textAlign = 'left';
    g.font = 'bold 40px Arial, sans-serif';
    g.fillText('NORTH ▲', 150, 60);
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText('Mill Rd  EXIT 31', 150, 116);
    g.font = 'bold 24px Arial, sans-serif';
    g.fillText('½ MILE', 150, 158);
  });
  // gas station price pylon
  cell('gasSign', (w, h) => {
    g.fillStyle = '#f2efe6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c62828';
    g.fillRect(0, 0, w, 58);
    g.fillStyle = '#ffffff';
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('GAS', w / 2, 31);
    g.fillStyle = '#141414';
    g.fillRect(8, 68, w - 16, 116);
    g.fillStyle = '#ff5a2a';
    g.font = 'bold 30px monospace';
    g.fillText('3.99', w / 2, 98);
    g.fillText('4.29', w / 2, 152);
  });
}

/** Shop signs, neon signs and graffiti (the atlas' new rows). */
function paintFacadeCells(g, cell) {
  // [bg, fg, accent] per sign; every one is weathered differently (fade, drips, chips)
  const STYLES = [
    ['#f2efe6', '#1a6a3c', '#c62828'], ['#f2c21a', '#1a1a1a', '#c41a1a'], ['#a8221e', '#f4e8cc', '#f2c21a'], ['#1d2c5a', '#e8c24a', '#e8e8e8'],
    ['#5a3a24', '#f4e8cc', '#c8a060'], ['#2a5aa8', '#f0f4f8', '#f2c21a'], ['#f4e6d0', '#b04a5a', '#5a3a24'], ['#1c1c1c', '#f08a1a', '#c41a1a'],
    ['#151515', '#e83a3a', '#f2c21a'], ['#b71c1c', '#f4f4f0', '#1a1a1a'], ['#1d5a36', '#f0e8d0', '#c8a060'], ['#f4f4f0', '#c41a1a', '#1d3f8a'],
    ['#c8b088', '#24422a', '#7a3a1a'], ['#f2c21a', '#1a1a1a', '#1a1a1a'], ['#24422a', '#e8c86a', '#f4e8cc'], ['#1a1a1a', '#f2c21a', '#f4f4f0'],
    ['#1d3f8a', '#f4f4f0', '#c62828'], ['#c8b48c', '#4a3020', '#4a3020'], ['#f4f4f0', '#1a8a8a', '#c62828'], ['#5a1a1a', '#f4e6c8', '#c8a060'],
    ['#c62828', '#f2c21a', '#f4f4f0'], ['#4a1d6a', '#f2c21a', '#f4f4f0'], ['#5a4030', '#e8dcc0', '#c8a060'], ['#f0ece0', '#1a1a1a', '#7a1a1a'],
  ];
  const rng = createRng(555);
  SIGN_NAMES.forEach((name, i) => cell('sign' + i, (w, h) => {
    const [bg, fg, ac] = STYLES[i % STYLES.length];
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // border, and stripes of the accent colour
    g.strokeStyle = fg;
    g.lineWidth = 3;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = ac;
    g.fillRect(9, h - 12, w - 18, 3);
    g.fillRect(9, 9, w - 18, 2);
    // the name, fitted to the board
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 34;
    do {
      g.font = `bold ${size}px Impact, "Arial Black", "Arial Narrow", Arial, sans-serif`;
      size -= 2;
    } while (g.measureText(name).width > w - 30 && size > 12);
    g.fillText(name, w / 2, h / 2 - 1);
    // weather: sun-faded top, rust drips from the bottom edge, chips down to bare board, scratches
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(0, 0, w, h * 0.35);
    for (let k = 0; k < 7; k++) {
      const x = rng.next() * w, len = 6 + rng.next() * 30;
      const dg = g.createLinearGradient(0, h - len, 0, h);
      dg.addColorStop(0, 'rgba(90,50,20,0)');
      dg.addColorStop(1, 'rgba(90,50,20,0.42)');
      g.fillStyle = dg;
      g.fillRect(x, h - len, 1 + rng.next() * 2, len);
    }
    g.fillStyle = 'rgba(46,38,30,0.55)';
    for (let k = 0; k < 9; k++) g.fillRect(rng.next() * w, rng.next() * h, 1 + rng.next() * 5, 1 + rng.next() * 3);
    g.strokeStyle = 'rgba(30,26,20,0.3)';
    g.lineWidth = 1;
    for (let k = 0; k < 6; k++) {
      const x = rng.next() * w, y = rng.next() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 12 + rng.next() * 24, y + (rng.next() - 0.5) * 8);
      g.stroke();
    }
    const dirt = g.createLinearGradient(0, h * 0.6, 0, h);
    dirt.addColorStop(0, 'rgba(50,38,24,0)');
    dirt.addColorStop(1, 'rgba(50,38,24,0.3)');
    g.fillStyle = dirt;
    g.fillRect(0, 0, w, h);
  }));
  const NEON_COLORS = [['#ffe6e6', '#ff2a3a'], ['#e8fbff', '#2ac8ff'], ['#fff4d8', '#ff7a1a'], ['#f0fff8', '#20e0a0'], ['#ffeaf6', '#ff3d8b'], ['#f6f0ff', '#a05aff'], ['#fffbe0', '#ffc61a'], ['#e6ffe8', '#3aff6a']];
  NEON_NAMES.forEach((name, i) => cell('nsign' + i, (w, h) => {
    g.fillStyle = '#0c0a10';
    g.fillRect(0, 0, w, h);
    const [core, glow] = NEON_COLORS[i % NEON_COLORS.length];
    g.font = `bold ${name.length > 5 ? 34 : 44}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = glow;
    for (const blur of [16, 8, 3]) {
      g.shadowBlur = blur;
      g.strokeStyle = glow;
      g.lineWidth = 4;
      g.strokeText(name, w / 2, h / 2 + 2);
    }
    g.shadowBlur = 2;
    g.lineWidth = 1.6;
    g.strokeStyle = core;
    g.strokeText(name, w / 2, h / 2 + 2);
    g.shadowBlur = 0;
    g.strokeStyle = glow;
    g.lineWidth = 2;
    g.strokeRect(5, 5, w - 10, h - 10);
  }));
  // graffiti: spray tags with drips, on a transparent cell
  const TAGS = [['REPENT', '#e8e0d0'], ['RIP', '#d8261e'], ['RUN', '#f2c21a'], ['DEAD', '#1a1a1a'], ['NO EXIT', '#e8e0d0'], ['HELP', '#d8261e'], ['END IS NEAR', '#2a8ad8'], ['ZED', '#3aa84a'], ['GOD SEES', '#e8e0d0']];
  TAGS.forEach(([txt, col], i) => cell('gfx' + i, (w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 40;
    do { g.font = `bold ${size}px Impact, "Arial Black", Arial, sans-serif`; size -= 3; } while (g.measureText(txt).width > w - 14 && size > 10);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((rng.next() - 0.5) * 0.18);
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(txt, 0, 0);
    g.fillStyle = col;
    g.fillText(txt, 0, 0);
    g.restore();
    // drips
    g.fillStyle = col;
    for (let k = 0; k < 6; k++) {
      const x = w * 0.15 + rng.next() * w * 0.7;
      g.fillRect(x, h / 2 + 4, 1.4, 6 + rng.next() * 22);
      g.beginPath();
      g.arc(x + 0.7, h / 2 + 10 + rng.next() * 22, 1.6, 0, 7);
      g.fill();
    }
  }));
}

// ---- foliage cards ---------------------------------------------------------------------------

/**
 * Leaf-cluster atlas (alpha): 4×2 cells — broadleaf clusters A and B, a pine bough, a
 * scrub / bush cluster, a palm frond, birch foliage, a fern and ivy. Grey-scale (the vertex colour tints it), dense enough that
 * alpha-tested mips stay full at distance.
 */
export const LEAF_CELLS = {
  broadA: [0, 0, 0.25, 0.5], broadB: [0.25, 0, 0.5, 0.5], pine: [0, 0.5, 0.25, 1], scrub: [0.25, 0.5, 0.5, 1],
  // palm frond (rib along +u from the left middle), birch foliage (small pale leaves), fern (base at the bottom middle), ivy
  frond: [0.5, 0, 0.75, 0.5], birch: [0.75, 0, 1, 0.5], fern: [0.5, 0.5, 0.75, 1], ivy: [0.75, 0.5, 1, 1],
};

let leafCanvas = null;
let leafData = null;   // straight-alpha RGBA of leafCanvas (see makeLeafTexture)
export function makeLeafTexture(anisotropy = 4) {
  if (!leafCanvas) {
    const S = 256, CW = 1024, CH = 512;
    leafCanvas = document.createElement('canvas');
    leafCanvas.width = CW;
    leafCanvas.height = CH;
    const g = leafCanvas.getContext('2d');
    g.clearRect(0, 0, CW, CH);
    const rng = createRng(9001);
    const H = S;
    const leaf = (x, y, len, wid, ang, shade) => {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, -wid, len, 0);
      g.quadraticCurveTo(len * 0.5, wid, 0, 0);
      g.fill();
      g.restore();
    };
    const cluster = (ox, oy, n, spread, len, wid, pineMode) => {
      g.save();
      g.beginPath();
      g.rect(ox + 1, oy + 1, H - 2, H - 2);
      g.clip();
      // twigs first, then leaves from the outside in (inner leaves lighter: light through)
      g.strokeStyle = 'rgb(70,60,50)';
      g.lineWidth = 2;
      for (let k = 0; k < 7; k++) {
        const a = rng.next() * Math.PI * 2;
        g.beginPath();
        g.moveTo(ox + H / 2, oy + H / 2);
        g.lineTo(ox + H / 2 + Math.cos(a) * spread * 0.8, oy + H / 2 + Math.sin(a) * spread * 0.8);
        g.stroke();
      }
      for (let k = 0; k < n; k++) {
        const a = rng.next() * Math.PI * 2;
        const rr = Math.sqrt(rng.next()) * spread;
        const x = ox + H / 2 + Math.cos(a) * rr, y = oy + H / 2 + Math.sin(a) * rr * 0.9;
        const shade = Math.round(120 + (1 - rr / spread) * 90 + rng.range(-25, 25));
        if (pineMode) {
          // needles: bundles of thin strokes along a bough
          g.strokeStyle = `rgb(${shade},${shade},${shade})`;
          g.lineWidth = 1.6;
          const ang = a + rng.range(-0.4, 0.4);
          for (let m = 0; m < 5; m++) {
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + Math.cos(ang + (m - 2) * 0.25) * len, y + Math.sin(ang + (m - 2) * 0.25) * len);
            g.stroke();
          }
        } else {
          leaf(x, y, len * rng.range(0.7, 1.2), wid * rng.range(0.7, 1.2), rng.next() * Math.PI * 2, shade);
        }
      }
      g.restore();
    };
    cluster(0, H, 520, H * 0.44, 20, 8, false);     // broadA (uv bottom-left in GL = bottom row here)
    cluster(H, H, 420, H * 0.42, 26, 10, false);    // broadB
    cluster(0, 0, 360, H * 0.44, 18, 0, true);      // pine
    cluster(H, 0, 620, H * 0.42, 13, 6, false);     // scrub
    // ---- palm frond: a rib curving along +x, leaflets sweeping forward and drooping
    {
      const ox = 2 * H, oy = H;
      g.save();
      g.beginPath();
      g.rect(ox + 1, oy + 1, H - 2, H - 2);
      g.clip();
      const ribY = (t) => oy + H * 0.5 - Math.sin(t * Math.PI * 0.9) * H * 0.07 + t * t * H * 0.1;
      g.strokeStyle = 'rgb(200,200,200)';
      g.lineWidth = 3.4;
      g.beginPath();
      for (let t = 0; t <= 1.001; t += 0.05) g.lineTo(ox + 6 + t * (H - 12), ribY(t));
      g.stroke();
      for (let k = 0; k < 46; k++) {
        const t = 0.06 + (k / 46) * 0.92;
        const px = ox + 6 + t * (H - 12), py = ribY(t);
        const len = H * 0.4 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.06)) + 6;
        for (const sd of [-1, 1]) {
          const shade = Math.round(150 + rng.range(-30, 40));
          g.strokeStyle = `rgb(${shade},${shade},${shade})`;
          g.lineWidth = 3.0 - t * 1.2;
          g.beginPath();
          g.moveTo(px, py);
          g.quadraticCurveTo(px + len * 0.45, py + sd * len * 0.55, px + len * 0.7, py + sd * len * 0.95 + len * 0.15);
          g.stroke();
        }
      }
      g.restore();
    }
    // ---- birch: dense small pale leaves on fine twigs
    {
      const ox = 3 * H, oy = H;
      g.save();
      g.beginPath();
      g.rect(ox + 1, oy + 1, H - 2, H - 2);
      g.clip();
      g.strokeStyle = 'rgb(210,205,195)';
      g.lineWidth = 1.6;
      for (let k = 0; k < 10; k++) {
        const a = rng.next() * Math.PI * 2, r = H * (0.25 + rng.next() * 0.2);
        g.beginPath();
        g.moveTo(ox + H / 2, oy + H / 2);
        g.quadraticCurveTo(ox + H / 2 + Math.cos(a) * r * 0.5 + 8, oy + H / 2 + Math.sin(a) * r * 0.5, ox + H / 2 + Math.cos(a) * r, oy + H / 2 + Math.sin(a) * r);
        g.stroke();
      }
      for (let k = 0; k < 700; k++) {
        const a = rng.next() * Math.PI * 2, rr = Math.sqrt(rng.next()) * H * 0.46;
        const x = ox + H / 2 + Math.cos(a) * rr, y = oy + H / 2 + Math.sin(a) * rr * 0.92;
        const shade = Math.round(150 + (1 - rr / (H * 0.46)) * 70 + rng.range(-20, 20));
        leaf(x, y, 10 + rng.next() * 8, 4.4 + rng.next() * 2.4, rng.next() * 6.28, shade);
      }
      g.restore();
    }
    // ---- fern: a pinnate frond growing up from the bottom middle
    {
      const ox = 2 * H, oy = 0;
      g.save();
      g.beginPath();
      g.rect(ox + 1, oy + 1, H - 2, H - 2);
      g.clip();
      const bx = ox + H / 2, by = oy + H - 4;
      const curve = (t) => Math.sin(t * 2.0) * 10 * (t > 0.5 ? 1 : 0.4);
      g.strokeStyle = 'rgb(170,170,170)';
      g.lineWidth = 2.6;
      g.beginPath();
      for (let t = 0; t <= 1.001; t += 0.05) g.lineTo(bx + curve(t), by - t * (H - 12));
      g.stroke();
      for (let k = 0; k < 26; k++) {
        const t = 0.08 + (k / 26) * 0.9;
        const px = bx + curve(t), py = by - t * (H - 12);
        const len = H * 0.46 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.12)) + 4;
        for (const sd of [-1, 1]) {
          const shade = Math.round(150 + rng.range(-30, 40));
          g.strokeStyle = `rgb(${shade},${shade},${shade})`;
          g.lineWidth = 2.4 - t;
          g.beginPath();
          g.moveTo(px, py);
          g.quadraticCurveTo(px + sd * len * 0.6, py - len * 0.12, px + sd * len, py + len * 0.25);
          g.stroke();
          for (let m = 1; m < 5; m++) {
            const mx = px + sd * len * (m / 5) * 0.95, my = py + (len * 0.25 - len * 0.1) * (m / 5) - 2;
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(mx, my);
            g.lineTo(mx + sd * 4, my - 9 * (1 - m / 6));
            g.stroke();
          }
        }
      }
      g.restore();
    }
    // ---- ivy: glossy heart-shaped leaves on a vine
    {
      const ox = 3 * H, oy = 0;
      g.save();
      g.beginPath();
      g.rect(ox + 1, oy + 1, H - 2, H - 2);
      g.clip();
      g.strokeStyle = 'rgb(90,70,50)';
      g.lineWidth = 2;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        const x0 = ox + 30 + rng.next() * (H - 60);
        g.moveTo(x0, oy + H);
        g.bezierCurveTo(x0 + rng.range(-40, 40), oy + H * 0.66, x0 + rng.range(-40, 40), oy + H * 0.33, x0 + rng.range(-30, 30), oy);
        g.stroke();
      }
      for (let k = 0; k < 190; k++) {
        const x = ox + 8 + rng.next() * (H - 16), y = oy + 8 + rng.next() * (H - 16);
        const shade = Math.round(120 + rng.range(-30, 70));
        g.save();
        g.translate(x, y);
        g.rotate(rng.next() * 6.28);
        g.fillStyle = `rgb(${shade},${shade},${shade})`;
        g.beginPath();
        const s = 7 + rng.next() * 6;
        g.moveTo(0, s);
        g.bezierCurveTo(-s * 1.3, s * 0.3, -s * 0.9, -s * 0.9, 0, -s * 0.35);
        g.bezierCurveTo(s * 0.9, -s * 0.9, s * 1.3, s * 0.3, 0, s);
        g.fill();
        g.restore();
      }
      g.restore();
    }
  }
  // The canvas holds premultiplied pixels: every transparent texel is black, and the
  // mipmaps averaged that black into the needles, so a distant pine turned into dark
  // speckles over its cone. Upload straight RGBA instead, with the transparent texels
  // carrying the mean leaf shade (colour bleed), rows flipped like a canvas upload.
  if (!leafData) {
    const CW = leafCanvas.width, CH = leafCanvas.height;
    const src = leafCanvas.getContext('2d').getImageData(0, 0, CW, CH).data;
    let sum = 0, n = 0;
    for (let i = 0; i < src.length; i += 4) if (src[i + 3] > 200) { sum += src[i]; n++; }
    const mean = n ? sum / n : 150;
    leafData = new Uint8Array(src.length);
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const i = (y * CW + x) * 4, o = ((CH - 1 - y) * CW + x) * 4;
        const a = src[i + 3] / 255;
        // canvas readback is un-premultiplied already; blend the fringe toward the mean
        for (let k = 0; k < 3; k++) leafData[o + k] = Math.round(src[i + k] * a + mean * (1 - a));
        leafData[o + 3] = src[i + 3];
      }
    }
  }
  const tex = new THREE.DataTexture(leafData, leafCanvas.width, leafCanvas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
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
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
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
