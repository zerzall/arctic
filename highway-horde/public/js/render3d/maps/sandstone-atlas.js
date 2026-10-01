// Picture atlas of Sandstone (render3d/maps/sandstone.js): awning and tarp canvas in stripes, kilim
// rugs, zellige tile mosaics and a tile frieze, painted gate and shop signs, enamel street plaques,
// faded posters, graffiti, crate stencils, the two sites' painted marks, lantern glass, iron grilles,
// a lattice screen, laundry, market goods and wall grime. Painted once per page on a canvas (nothing
// is loaded from files); cells are laid out by a fixed shelf packer, so a cell's uv rect never depends
// on what the browser can draw.
//
//   ssUV(name) → [u0, v0, u1, v1]   (texture flipY = true, like world-tex.js atlasUV)
//   makeSandTexture(aniso)           THREE.CanvasTexture (a new texture per renderer, one shared canvas)

import * as THREE from 'three';

const AW = 2048, AH = 1024;
const FONT = '"Arial Black","Helvetica Neue",Arial,"DejaVu Sans","Liberation Sans",sans-serif';
const SERIF = 'Georgia,"DejaVu Serif","Liberation Serif",serif';
const HAND = '"Marker Felt","Comic Sans MS","Segoe Print","DejaVu Sans","Liberation Sans",sans-serif';

/** Cell sizes (w, h) in atlas pixels. */
export const SS_CELLS = {
  white: [16, 16],
  // canvas in stripes (tileable across u), rugs, mosaics
  st_red: [128, 128], st_blue: [128, 128], st_ochre: [128, 128], st_green: [128, 128], st_plain: [128, 128],
  rug1: [256, 128], rug2: [256, 128], rug3: [256, 128], rug4: [256, 128],
  zel1: [128, 128], zel2: [128, 128], zel3: [128, 128], frieze: [256, 64],
  // signs and plaques
  s_gate: [512, 96], s_cistern: [256, 96], s_caravan: [512, 96], s_souk: [256, 96], s_cafe: [384, 96], s_hammam: [256, 96],
  s_pharm: [256, 96], s_bakery: [256, 96], s_tailor: [256, 96],
  p_rue1: [160, 56], p_rue2: [160, 56], p_rue3: [160, 56], p_rue4: [160, 56],
  // posters, graffiti, stencils
  poster1: [128, 192], poster2: [128, 192], poster3: [128, 192],
  graf1: [256, 96], graf2: [256, 96], graf3: [256, 96], graf4: [256, 128], gx: [128, 128],
  stencil: [128, 128], stencil2: [128, 128],
  // the sites' marks
  m_sun: [256, 256], m_drop: [256, 256],
  // lantern glass, grilles, lattice, laundry, goods
  lantern: [64, 128], grille: [128, 128], lattice: [128, 256], laundry: [256, 64], fruit: [128, 64], spice: [128, 64], baskets: [128, 64],
  // weathering
  grime: [256, 128], blood1: [256, 256], blood2: [256, 128], cracks: [256, 256], streak: [64, 256],
};

let canvas = null;
let cells = null;

function pack() {
  const out = {};
  let x = 0, y = 0, rowH = 0;
  const list = Object.entries(SS_CELLS).sort((p, q) => q[1][1] - p[1][1] || (p[0] < q[0] ? -1 : 1));
  for (const [k, [w, h]] of list) {
    if (x + w + 2 > AW) { x = 0; y += rowH + 2; rowH = 0; }
    out[k] = [x, y, x + w, y + h];
    x += w + 2;
    rowH = Math.max(rowH, h);
  }
  return out;
}

/** UV rect [u0, v0, u1, v1] of a cell (unknown names give the white cell). */
export function ssUV(name) {
  if (!cells) cells = pack();
  const c = cells[name] || cells.white;
  return [(c[0] + 0.5) / AW, 1 - (c[3] - 0.5) / AH, (c[2] - 0.5) / AW, 1 - (c[1] + 0.5) / AH];
}

/** A sub-rect of a cell (u0..u1, v0..v1 in 0..1 of the cell, v up). */
export function ssSub(name, u0, v0, u1, v1) {
  const [a, b, c, d] = ssUV(name);
  return [a + (c - a) * u0, b + (d - b) * v0, a + (c - a) * u1, b + (d - b) * v1];
}

// ---- painting helpers -------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fit(g, str, cx, cy, w, h, o = {}) {
  let size = Math.min(o.max || 999, h);
  const set = () => { g.font = `${o.weight || 'bold'} ${size}px ${o.font || FONT}`; };
  set();
  const m = g.measureText(str).width;
  if (m > w) { size = Math.max(4, size * (w / m)); set(); }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (o.stroke) { g.lineWidth = o.strokeW || Math.max(1, size * 0.1); g.strokeStyle = o.stroke; g.lineJoin = 'round'; g.strokeText(str, cx, cy); }
  g.fillStyle = o.color || '#fff';
  g.fillText(str, cx, cy);
}

/** Specks, sun bleaching toward the top, grime toward the bottom. */
function weather(g, w, h, r, amount = 1) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 80 * amount; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '40,28,16' : '240,228,205'},${0.03 + r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 3);
  }
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, `rgba(255,245,225,${0.12 * amount})`);
  grd.addColorStop(1, `rgba(40,26,12,${0.25 * amount})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** Spray paint with drips and overspray. */
function spray(g, str, cx, cy, w, h, color, r, o = {}) {
  g.save();
  g.shadowColor = color;
  g.shadowBlur = h * 0.1;
  let size = h;
  g.font = `bold ${size}px ${o.font || FONT}`;
  const m = g.measureText(str).width;
  if (m > w) { size *= w / m; g.font = `bold ${size}px ${o.font || FONT}`; }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.translate(cx, cy);
  g.rotate(o.tilt || 0);
  g.fillText(str, 0, 0);
  const tw = Math.min(w, m);
  for (let i = 0; i < 6; i++) g.fillRect(-tw / 2 + r() * tw, size * 0.3, Math.max(1, size * 0.04), size * (0.15 + r() * 0.5));
  g.restore();
}

function stripes(g, w, h, a, b, n = 6) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect((i / n) * w, 0, w / n + 1, h);
  }
  // a woven texture and a sun-faded top
  for (let y = 0; y < h; y += 2) {
    g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.04 : 0.08})`;
    g.fillRect(0, y, w, 1);
  }
}

/** A kilim: diamond lozenges in rows between borders. */
function kilim(g, w, h, r, pal) {
  g.fillStyle = pal[0];
  g.fillRect(0, 0, w, h);
  const bw = h * 0.12;
  g.fillStyle = pal[1];
  g.fillRect(0, 0, w, bw);
  g.fillRect(0, h - bw, w, bw);
  g.fillStyle = pal[3];
  for (let x = 0; x < w; x += 10) {
    g.fillRect(x, bw * 0.35, 5, bw * 0.3);
    g.fillRect(x + 5, h - bw * 0.65, 5, bw * 0.3);
  }
  const n = 4, cy = h / 2, rh = (h - bw * 2) * 0.38;
  for (let i = 0; i < n; i++) {
    const cx = ((i + 0.5) / n) * w, rw = w / n * 0.42;
    for (const [k, c] of [[1, pal[2]], [0.66, pal[1]], [0.33, pal[3]]]) {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(cx - rw * k, cy);
      g.lineTo(cx, cy - rh * k);
      g.lineTo(cx + rw * k, cy);
      g.lineTo(cx, cy + rh * k);
      g.closePath();
      g.fill();
    }
  }
  // fringes and wear
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,220'},${0.04 + r() * 0.08})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1);
  }
}

/** Zellige: an eight-pointed star tiling in glazed colours. */
function zellige(g, w, h, r, pal) {
  g.fillStyle = pal[0];
  g.fillRect(0, 0, w, h);
  const s = w / 2;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const cx = (i + 0.5) * s, cy = (j + 0.5) * s;
    g.save();
    g.translate(cx, cy);
    for (const rot of [0, Math.PI / 4]) {
      g.save();
      g.rotate(rot);
      g.fillStyle = pal[1];
      g.fillRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
      g.restore();
    }
    g.fillStyle = pal[2];
    g.beginPath();
    g.arc(0, 0, s * 0.16, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // the corner crosses
    g.fillStyle = pal[3];
    g.fillRect(i * s - s * 0.06, j * s - s * 0.06, s * 0.12, s * 0.12);
  }
  // grout lines and glaze glints
  g.strokeStyle = 'rgba(240,232,215,0.55)';
  g.lineWidth = 1;
  for (let k = 0; k <= 8; k++) {
    g.beginPath(); g.moveTo((k / 8) * w, 0); g.lineTo((k / 8) * w, h); g.stroke();
    g.beginPath(); g.moveTo(0, (k / 8) * h); g.lineTo(w, (k / 8) * h); g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.15})`;
    g.fillRect(r() * w, r() * h, 2, 1);
  }
}

/** A painted sign board: plaster panel, a border, the lettering, faded and chipped. */
function signBoard(g, w, h, r, text, o = {}) {
  g.fillStyle = o.bg || '#e8dcc0';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = o.border || '#2f6f9a';
  g.lineWidth = h * 0.08;
  g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  if (o.icon) o.icon(g, h * 0.62, h / 2, h * 0.3);
  fit(g, text, w / 2 + (o.icon ? h * 0.3 : 0), h * 0.52, w - h * (o.icon ? 1.6 : 0.8), h * 0.56, { color: o.color || '#7a2a1a', font: o.font || SERIF });
  weather(g, w, h, r, 1.2);
  // chipped paint
  for (let i = 0; i < 18; i++) {
    g.fillStyle = 'rgba(150,120,90,0.55)';
    g.beginPath();
    g.arc(r() * w, r() * h, 1 + r() * 4, 0, Math.PI * 2);
    g.fill();
  }
}

/** A blue enamel street plaque with a white border. */
function plaque(g, w, h, r, line1, line2) {
  g.fillStyle = '#e8e6de';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f4f8f';
  g.fillRect(3, 3, w - 6, h - 6);
  g.strokeStyle = '#e8e6de';
  g.lineWidth = 2;
  g.strokeRect(6, 6, w - 12, h - 12);
  fit(g, line1, w / 2, h * 0.38, w - 20, h * 0.34, { color: '#f4f2ea', font: SERIF });
  fit(g, line2, w / 2, h * 0.72, w - 24, h * 0.22, { color: '#d8dce8', font: SERIF, weight: 'normal' });
  for (let i = 0; i < 10; i++) {
    g.fillStyle = 'rgba(40,30,20,0.7)';
    g.beginPath();
    g.arc(r() * w, r() * h, 1 + r() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

const PAINT = {
  white(g, w, h) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); },
  st_red(g, w, h) { stripes(g, w, h, '#b33a28', '#e8dcc4'); },
  st_blue(g, w, h) { stripes(g, w, h, '#2b5f8c', '#e6dcc8'); },
  st_ochre(g, w, h) { stripes(g, w, h, '#c98a2a', '#7a3a22', 4); },
  st_green(g, w, h) { stripes(g, w, h, '#3f6f4a', '#d8cfb4'); },
  st_plain(g, w, h, r) { g.fillStyle = '#d9cbb0'; g.fillRect(0, 0, w, h); weather(g, w, h, r, 0.8); },
  rug1(g, w, h, r) { kilim(g, w, h, r, ['#8e2a1e', '#1f3a5a', '#d8b46a', '#e8dcc4']); },
  rug2(g, w, h, r) { kilim(g, w, h, r, ['#2a3f6a', '#a8321e', '#e0c890', '#1a1a1a']); },
  rug3(g, w, h, r) { kilim(g, w, h, r, ['#c4782a', '#5a1e1a', '#2e5a4a', '#efe2c4']); },
  rug4(g, w, h, r) { kilim(g, w, h, r, ['#5a2a4a', '#d8a83a', '#2a6a7a', '#e8dcc4']); },
  zel1(g, w, h, r) { zellige(g, w, h, r, ['#e8e0cc', '#1f5f8f', '#c8a03a', '#2e7a5a']); },
  zel2(g, w, h, r) { zellige(g, w, h, r, ['#f0e8d4', '#2e7a5a', '#a8321e', '#1f4f7f']); },
  zel3(g, w, h, r) { zellige(g, w, h, r, ['#1f3f6a', '#e8dcc0', '#c8a03a', '#7a2a1e']); },
  frieze(g, w, h, r) {
    g.fillStyle = '#e8e0cc';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < w / 32; i++) {
      const x = i * 32;
      g.fillStyle = i % 2 ? '#1f5f8f' : '#2e7a5a';
      g.beginPath();
      g.moveTo(x, h * 0.2); g.lineTo(x + 16, h * 0.5); g.lineTo(x, h * 0.8); g.lineTo(x - 16, h * 0.5);
      g.fill();
      g.fillStyle = '#c8a03a';
      g.fillRect(x + 14, h * 0.45, 4, h * 0.1);
    }
    g.fillStyle = '#7a2a1e';
    g.fillRect(0, 0, w, h * 0.1);
    g.fillRect(0, h * 0.9, w, h * 0.1);
    weather(g, w, h, r, 0.6);
  },
  s_gate(g, w, h, r) {
    // carved into a stone lintel: the name of the great gate
    g.fillStyle = '#cdb48a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '90,70,40' : '240,225,190'},${0.08 + r() * 0.12})`; g.fillRect(r() * w, r() * h, 2 + r() * 6, 1 + r() * 2); }
    fit(g, 'BAB EL-KEBIR', w / 2, h * 0.54, w * 0.86, h * 0.62, { color: '#5a3a1e', font: SERIF, stroke: 'rgba(255,240,210,0.35)', strokeW: 2 });
    g.strokeStyle = 'rgba(90,60,30,0.6)';
    g.lineWidth = 3;
    g.strokeRect(8, 8, w - 16, h - 16);
  },
  s_cistern(g, w, h, r) { signBoard(g, w, h, r, 'THE CISTERN', { bg: '#e6dcc4', border: '#2f6f9a', color: '#1f4f7f', icon: (gg, x, y, s) => { gg.fillStyle = '#2f6f9a'; gg.beginPath(); gg.moveTo(x, y - s); gg.quadraticCurveTo(x + s, y + s * 0.4, x, y + s); gg.quadraticCurveTo(x - s, y + s * 0.4, x, y - s); gg.fill(); } }); },
  s_caravan(g, w, h, r) { signBoard(g, w, h, r, 'CARAVANSERAI', { bg: '#d8c49a', border: '#7a3a22', color: '#5a2a16' }); },
  s_souk(g, w, h, r) { signBoard(g, w, h, r, 'SOUK', { bg: '#2f6f9a', border: '#e8dcc4', color: '#f0e6cc' }); },
  s_cafe(g, w, h, r) { signBoard(g, w, h, r, 'CAFÉ DES NOMADES', { bg: '#1f4f3f', border: '#c8a03a', color: '#f0e2b8' }); },
  s_hammam(g, w, h, r) { signBoard(g, w, h, r, 'HAMMAM', { bg: '#e8e0cc', border: '#1f5f8f', color: '#1f5f8f' }); },
  s_pharm(g, w, h, r) {
    signBoard(g, w, h, r, 'PHARMACIE', { bg: '#f0ece0', border: '#2e8a4a', color: '#1e6a3a', icon: (gg, x, y, s) => { gg.fillStyle = '#2eaa4a'; gg.fillRect(x - s * 0.3, y - s, s * 0.6, s * 2); gg.fillRect(x - s, y - s * 0.3, s * 2, s * 0.6); } });
  },
  s_bakery(g, w, h, r) { signBoard(g, w, h, r, 'BOULANGERIE', { bg: '#c98a2a', border: '#5a2a16', color: '#3a1a0a' }); },
  s_tailor(g, w, h, r) { signBoard(g, w, h, r, 'TAILLEUR', { bg: '#e6dcc4', border: '#8a3a5c', color: '#5a1a3a' }); },
  p_rue1(g, w, h, r) { plaque(g, w, h, r, 'RUE DU PUITS', 'Well Street'); },
  p_rue2(g, w, h, r) { plaque(g, w, h, r, 'RUE DES POTIERS', 'Potters\' Lane'); },
  p_rue3(g, w, h, r) { plaque(g, w, h, r, 'PLACE DE LA FONTAINE', 'Fountain Square'); },
  p_rue4(g, w, h, r) { plaque(g, w, h, r, 'DERB EL-ARSA', 'Garden Alley'); },
  poster1(g, w, h, r) {
    // a faded tourism poster: the sun over palms and dunes
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#e89a4a'); grd.addColorStop(0.6, '#f0d090'); grd.addColorStop(1, '#c88a4a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff2c8'; g.beginPath(); g.arc(w * 0.5, h * 0.42, w * 0.22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a3a22';
    g.beginPath(); g.moveTo(0, h * 0.72); g.quadraticCurveTo(w * 0.4, h * 0.6, w, h * 0.74); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    g.fillStyle = '#2a1a10'; g.fillRect(w * 0.2, h * 0.45, 3, h * 0.3);
    for (let i = 0; i < 5; i++) { g.save(); g.translate(w * 0.2, h * 0.46); g.rotate(-1.2 + i * 0.6); g.fillRect(0, -1, w * 0.18, 3); g.restore(); }
    fit(g, 'VISITEZ', w / 2, h * 0.1, w * 0.8, h * 0.08, { color: '#5a2a16', font: SERIF });
    fit(g, 'LE SUD', w / 2, h * 0.88, w * 0.8, h * 0.12, { color: '#fff2c8', font: SERIF });
    weather(g, w, h, r, 1.5);
  },
  poster2(g, w, h, r) {
    // an evacuation notice
    g.fillStyle = '#efe8d8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b3261e'; g.fillRect(0, 0, w, h * 0.16);
    fit(g, 'ÉVACUATION', w / 2, h * 0.08, w * 0.9, h * 0.11, { color: '#fff' });
    g.fillStyle = '#333';
    for (let i = 0; i < 9; i++) g.fillRect(w * 0.1, h * (0.24 + i * 0.05), w * (0.5 + r() * 0.3), 3);
    g.fillStyle = '#b3261e';
    g.beginPath(); g.moveTo(w * 0.5, h * 0.72); g.lineTo(w * 0.7, h * 0.84); g.lineTo(w * 0.58, h * 0.84); g.lineTo(w * 0.58, h * 0.95); g.lineTo(w * 0.42, h * 0.95); g.lineTo(w * 0.42, h * 0.84); g.lineTo(w * 0.3, h * 0.84); g.fill();
    weather(g, w, h, r, 1.6);
  },
  poster3(g, w, h, r) {
    // a missing person with a hand-written line
    g.fillStyle = '#f2ecdc'; g.fillRect(0, 0, w, h);
    fit(g, 'DISPARU', w / 2, h * 0.09, w * 0.8, h * 0.1, { color: '#1a1a1a' });
    g.fillStyle = '#6a6058'; g.fillRect(w * 0.2, h * 0.18, w * 0.6, h * 0.42);
    g.fillStyle = '#3a3028'; g.beginPath(); g.arc(w * 0.5, h * 0.33, w * 0.13, 0, Math.PI * 2); g.fill();
    g.fillRect(w * 0.3, h * 0.45, w * 0.4, h * 0.15);
    g.fillStyle = '#333';
    for (let i = 0; i < 5; i++) g.fillRect(w * 0.12, h * (0.66 + i * 0.05), w * (0.6 + r() * 0.2), 2);
    fit(g, 'Karim, 9 ans', w / 2, h * 0.92, w * 0.8, h * 0.07, { color: '#1a3a7a', font: HAND });
    weather(g, w, h, r, 1.4);
  },
  graf1(g, w, h, r) { spray(g, 'THEY HEAR YOU', w / 2, h / 2, w * 0.92, h * 0.5, '#a8221a', r, { tilt: -0.04 }); },
  graf2(g, w, h, r) { spray(g, 'DON\'T GO SOUTH', w / 2, h / 2, w * 0.92, h * 0.46, '#1a1a1a', r, { tilt: 0.03 }); },
  graf3(g, w, h, r) {
    spray(g, 'SQUARE', w * 0.4, h / 2, w * 0.6, h * 0.5, '#e8e0cc', r);
    g.fillStyle = '#e8e0cc';
    g.beginPath(); g.moveTo(w * 0.78, h * 0.25); g.lineTo(w * 0.95, h * 0.5); g.lineTo(w * 0.78, h * 0.75); g.lineTo(w * 0.78, h * 0.6); g.lineTo(w * 0.7, h * 0.6); g.lineTo(w * 0.7, h * 0.4); g.lineTo(w * 0.78, h * 0.4); g.fill();
  },
  graf4(g, w, h, r) {
    // a skull tag and a count of the days
    g.fillStyle = '#1a1a1a';
    g.beginPath(); g.arc(w * 0.2, h * 0.4, h * 0.25, 0, Math.PI * 2); g.fill();
    g.fillRect(w * 0.13, h * 0.55, w * 0.14, h * 0.18);
    g.fillStyle = 'rgba(0,0,0,0)';
    g.clearRect(w * 0.14, h * 0.32, h * 0.12, h * 0.12);
    g.clearRect(w * 0.22, h * 0.32, h * 0.12, h * 0.12);
    g.fillStyle = '#1a1a1a';
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 4; k++) g.fillRect(w * (0.42 + i * 0.13) + k * 6, h * 0.25, 3, h * 0.45);
      g.save(); g.translate(w * (0.42 + i * 0.13) - 2, h * 0.62); g.rotate(-0.9); g.fillRect(0, 0, h * 0.5, 3); g.restore();
    }
  },
  gx(g, w, h, r) {
    // a search mark: X with the date and the count
    g.strokeStyle = '#c8301e';
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(w * 0.15, h * 0.15); g.lineTo(w * 0.85, h * 0.85); g.moveTo(w * 0.85, h * 0.15); g.lineTo(w * 0.15, h * 0.85); g.stroke();
    fit(g, '3', w * 0.5, h * 0.2, w * 0.2, h * 0.16, { color: '#c8301e', font: HAND });
    fit(g, '12/9', w * 0.2, h * 0.5, w * 0.2, h * 0.12, { color: '#c8301e', font: HAND });
    void r;
  },
  stencil(g, w, h, r) {
    g.fillStyle = 'rgba(0,0,0,0)';
    fit(g, 'FRAGILE', w / 2, h * 0.18, w * 0.84, h * 0.17, { color: '#2a1a10' });
    g.fillStyle = '#2a1a10';
    for (const x of [0.3, 0.7]) {
      g.beginPath(); g.moveTo(w * x, h * 0.32); g.lineTo(w * (x + 0.12), h * 0.5); g.lineTo(w * (x + 0.05), h * 0.5); g.lineTo(w * (x + 0.05), h * 0.66); g.lineTo(w * (x - 0.05), h * 0.66); g.lineTo(w * (x - 0.05), h * 0.5); g.lineTo(w * (x - 0.12), h * 0.5); g.fill();
    }
    fit(g, 'N° 07', w / 2, h * 0.84, w * 0.6, h * 0.16, { color: '#2a1a10' });
    void r;
  },
  stencil2(g, w, h, r) {
    fit(g, 'SAHARA', w / 2, h * 0.3, w * 0.86, h * 0.2, { color: '#3a2010' });
    fit(g, 'EXPORT', w / 2, h * 0.55, w * 0.7, h * 0.16, { color: '#3a2010' });
    g.strokeStyle = '#3a2010'; g.lineWidth = 4; g.strokeRect(w * 0.1, h * 0.12, w * 0.8, h * 0.76);
    void r;
  },
  m_sun(g, w, h, r) {
    // the Terrace's mark: a sun painted on the plaster, faded
    g.translate(w / 2, h / 2);
    g.fillStyle = 'rgba(178,58,32,0.85)';
    for (let i = 0; i < 12; i++) { g.save(); g.rotate((i / 12) * Math.PI * 2); g.beginPath(); g.moveTo(-w * 0.05, -w * 0.26); g.lineTo(0, -w * 0.46); g.lineTo(w * 0.05, -w * 0.26); g.fill(); g.restore(); }
    g.beginPath(); g.arc(0, 0, w * 0.22, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(232,210,170,0.9)';
    g.beginPath(); g.arc(0, 0, w * 0.12, 0, Math.PI * 2); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 140; i++) { g.clearRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 4); }
  },
  m_drop(g, w, h, r) {
    // the Cistern's mark: a drop over three waves
    g.fillStyle = 'rgba(31,79,143,0.85)';
    g.beginPath(); g.moveTo(w * 0.5, h * 0.08); g.quadraticCurveTo(w * 0.82, h * 0.48, w * 0.5, h * 0.62); g.quadraticCurveTo(w * 0.18, h * 0.48, w * 0.5, h * 0.08); g.fill();
    g.strokeStyle = 'rgba(31,79,143,0.85)';
    g.lineWidth = w * 0.04;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let i = 0; i <= 20; i++) { const x = w * (0.12 + i * 0.038), y = h * (0.72 + k * 0.08) + Math.sin(i * 0.9) * h * 0.025; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 140; i++) { g.clearRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 4); }
  },
  lantern(g, w, h) {
    const grd = g.createRadialGradient(w / 2, h * 0.55, 2, w / 2, h * 0.55, w * 0.6);
    grd.addColorStop(0, '#fff6d8'); grd.addColorStop(0.5, '#ffc070'); grd.addColorStop(1, '#a8501a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(40,20,8,0.75)';
    for (let i = 0; i < 4; i++) g.fillRect((i / 4) * w + w / 8 - 1, 0, 3, h);
    for (let j = 0; j < 6; j++) g.fillRect(0, (j / 6) * h, w, 2);
  },
  grille(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 5;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo((i / 6) * w, 0); g.lineTo((i / 6) * w, h); g.stroke(); }
    g.lineWidth = 4;
    for (const y of [0.25, 0.75]) { g.beginPath(); g.moveTo(0, y * h); g.lineTo(w, y * h); g.stroke(); }
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc((i + 0.5) / 6 * w, 0.5 * h, w / 12, 0, Math.PI * 2); g.stroke(); }
    g.strokeRect(2, 2, w - 4, h - 4);
  },
  lattice(g, w, h) {
    // a mashrabiya screen: turned wood in a grid of beads, alpha-cut
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#5a3a1e';
    const n = 8, m = 16;
    for (let i = 0; i <= n; i++) g.fillRect((i / n) * w - 2, 0, 4, h);
    for (let j = 0; j <= m; j++) g.fillRect(0, (j / m) * h - 2, w, 4);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      g.beginPath(); g.arc((i + 0.5) / n * w, (j + 0.5) / m * h, 4, 0, Math.PI * 2); g.fill();
    }
    g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
  },
  laundry(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    const cols = ['#e8e2d4', '#2f6f9a', '#b33a28', '#d8b46a', '#f0f0e8', '#3f6f4a', '#8a3a5c'];
    let x = 4;
    while (x < w - 20) {
      const cw = 18 + r() * 30, ch = h * (0.5 + r() * 0.45);
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      if (r() < 0.4) { g.fillRect(x, 4, cw, ch); g.fillRect(x - 6, 4, cw + 12, ch * 0.3); } else g.fillRect(x, 4, cw, ch);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 4 + ch * 0.6, cw, ch * 0.4);
      x += cw + 3 + r() * 8;
    }
    g.fillStyle = '#3a3a3a'; g.fillRect(0, 2, w, 2);
  },
  fruit(g, w, h, r) {
    g.fillStyle = '#6a4a2a'; g.fillRect(0, 0, w, h);
    const cols = ['#e8901a', '#f0a830', '#c8401a', '#d8c040', '#6a1a1a'];
    for (let i = 0; i < 70; i++) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.beginPath(); g.arc(r() * w, h * 0.2 + r() * h * 0.8, 5 + r() * 4, 0, Math.PI * 2); g.fill();
    }
  },
  spice(g, w, h, r) {
    g.fillStyle = '#4a3020'; g.fillRect(0, 0, w, h);
    const cols = ['#c8401a', '#e8a01a', '#7a5a1a', '#a8321e', '#d8c070', '#4a6a2a'];
    for (let i = 0; i < 6; i++) {
      g.fillStyle = cols[i];
      g.beginPath(); g.moveTo((i / 6) * w + 2, h); g.lineTo(((i + 0.5) / 6) * w, h * 0.15 + r() * 10); g.lineTo(((i + 1) / 6) * w - 2, h); g.fill();
    }
  },
  baskets(g, w, h, r) {
    g.fillStyle = '#3a2a18'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = ['#c8a060', '#b08850', '#d8b878', '#a07840'][i];
      g.beginPath(); g.ellipse((i + 0.5) / 4 * w, h * 0.6, w / 9, h * 0.38, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(60,40,20,0.6)'; g.lineWidth = 1;
      for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo((i + 0.5) / 4 * w - w / 9, h * (0.35 + k * 0.1)); g.lineTo((i + 0.5) / 4 * w + w / 9, h * (0.35 + k * 0.1)); g.stroke(); }
    }
    void r;
  },
  grime(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = r() * w, len = h * (0.3 + r() * 0.7);
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, `rgba(60,40,20,${0.15 + r() * 0.2})`);
      gr.addColorStop(1, 'rgba(60,40,20,0)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 2 + r() * 10, len);
    }
  },
  blood1(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(110,10,6,0.85)';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(w / 2 + (r() - 0.5) * w * 0.5, h / 2 + (r() - 0.5) * h * 0.5, 4 + r() * 22, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 9; i++) g.fillRect(w / 2 + (r() - 0.5) * w * 0.5, h / 2, 3 + r() * 4, h * (0.2 + r() * 0.3));
  },
  blood2(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(100,8,6,0.8)';
    // a hand dragged along the wall
    for (let i = 0; i < 40; i++) g.fillRect(w * (0.1 + i * 0.02), h * (0.4 + Math.sin(i * 0.3) * 0.1) + r() * 6, 6, 3 + r() * 12);
    void r;
  },
  cracks(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(50,34,20,0.7)';
    for (let k = 0; k < 4; k++) {
      let x = r() * w, y = r() * h * 0.3;
      g.lineWidth = 1.5 + r() * 1.5;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 12; i++) { x += (r() - 0.5) * 30; y += 10 + r() * 16; g.lineTo(x, y); }
      g.stroke();
    }
  },
  streak(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(50,34,20,0.45)');
    gr.addColorStop(1, 'rgba(50,34,20,0)');
    g.fillStyle = gr;
    g.fillRect(w * 0.3, 0, w * 0.4, h);
    void r;
  },
};

function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  if (!cells) cells = pack();
  let seed = 31;
  for (const [name, box] of Object.entries(cells)) {
    const [x0, y0, x1, y1] = box;
    const w = x1 - x0, h = y1 - y0;
    g.save();
    g.beginPath();
    g.rect(x0, y0, w, h);
    g.clip();
    g.translate(x0, y0);
    try {
      const fn = PAINT[name];
      if (fn) fn(g, w, h, rng(seed += 7));
    } catch (err) { /* a missing font is not fatal */ }
    g.restore();
  }
  return c;
}

/** The atlas as a texture (one shared canvas, a texture per renderer). */
export function makeSandTexture(anisotropy = 8) {
  if (!canvas) canvas = paintAtlas();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
