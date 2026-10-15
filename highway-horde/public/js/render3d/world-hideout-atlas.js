// Picture atlas of the hideouts (world-hideout*.js): hand-painted signs, neon words, the
// mission map with its pins, chalk tallies and blueprints, kids' crayon drawings, polaroids,
// notes, a red cross plate, a target. Painted once per page on a canvas at start-up (nothing
// is loaded from files); cells are laid out by a fixed shelf packer so a cell's uv rect never
// depends on what the browser can draw.
//
//   hubUV(name) → [u0, v0, u1, v1]   (texture flipY = true, like world-tex.js atlasUV)
//   makeHubTexture(aniso) → THREE.CanvasTexture (new texture per renderer, shared canvas)
//   HUB_CELLS                        cell name → [w, h] in atlas pixels

import * as THREE from 'three';

const AW = 2048, AH = 2048;
const FONT = '"Arial Black","Helvetica Neue",Arial,"DejaVu Sans","Liberation Sans",sans-serif';
const HAND = '"Marker Felt","Comic Sans MS","Segoe Print","DejaVu Sans","Liberation Sans",sans-serif';
const SERIF = 'Georgia,"DejaVu Serif","Liberation Serif",serif';

/** Cell sizes (w, h) in atlas pixels, in packing order. */
export const HUB_CELLS = {
  // neon (emissive words, bright strokes on transparent)
  n_roadhouse: [512, 112], n_vacancy: [400, 96], n_no: [128, 96], n_motel: [320, 96], n_open: [256, 96], n_cafe: [256, 96],
  n_depot: [512, 112], n_water: [320, 96], n_forge: [256, 96], n_farm: [512, 112], n_eggs: [256, 96], n_pies: [256, 96], n_haven: [400, 96],
  // painted signs (opaque boards with lettering)
  p_haven: [512, 128], p_office: [256, 64], p_room: [128, 64], p_deke: [384, 96], p_medic: [256, 96], p_armory: [384, 96],
  p_range: [384, 96], p_board: [320, 96], p_fund: [384, 96], p_garden: [256, 80], p_eggs: [256, 80], p_pies: [256, 80],
  p_farm: [512, 128], p_depot: [512, 128], p_water: [256, 80], p_bunks: [256, 80], p_forge: [256, 80], p_mess: [256, 80],
  p_rules: [256, 192], p_greenhouse: [320, 80], p_apples: [256, 80], p_dock: [256, 80], p_noparking: [128, 128], p_thanks: [384, 96],
  // things pinned to walls and boards
  map: [512, 384], tally: [256, 320], blueprint: [320, 224], polaroids: [512, 256], kids: [512, 256], notes: [256, 192],
  calendar: [192, 256], cross: [128, 128], target: [128, 128], bullseye: [128, 128], cork: [64, 64], plank: [64, 64],
  paper: [64, 64], stamp: [128, 64], chalk: [256, 128], tag: [96, 48],
};

let canvas = null;
let cells = null;

function pack() {
  const out = {};
  let x = 0, y = 0, rowH = 0;
  for (const [k, [w, h]] of Object.entries(HUB_CELLS)) {
    if (x + w + 2 > AW) { x = 0; y += rowH + 2; rowH = 0; }
    out[k] = [x, y, x + w, y + h];
    x += w + 2;
    rowH = Math.max(rowH, h);
  }
  return out;
}

/** UV rect [u0, v0, u1, v1] of a cell (unknown names give the paper cell). */
export function hubUV(name) {
  if (!cells) cells = pack();
  const c = cells[name] || cells.paper;
  return [c[0] / AW, 1 - c[3] / AH, c[2] / AW, 1 - c[1] / AH];
}

// ---- painting helpers ----------------------------------------------------------------------

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
  const font = o.font || FONT;
  let size = Math.min(o.max || 999, h);
  g.font = `${o.italic ? 'italic ' : ''}${o.weight || 'bold'} ${size}px ${font}`;
  const m = g.measureText(str).width;
  if (m > w) { size = Math.max(4, size * (w / m)); g.font = `${o.italic ? 'italic ' : ''}${o.weight || 'bold'} ${size}px ${font}`; }
  g.textAlign = o.align || 'center';
  g.textBaseline = 'middle';
  if (o.stroke) { g.lineWidth = o.strokeW || Math.max(1, size * 0.1); g.strokeStyle = o.stroke; g.lineJoin = 'round'; g.strokeText(str, cx, cy); }
  g.fillStyle = o.color || '#fff';
  g.fillText(str, cx, cy);
  return size;
}

/** Neon lettering: a wide coloured glow, the tube in the colour and a white-hot core. */
function neon(g, str, w, h, color, o = {}) {
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, font = o.font || FONT;
  let size = h * 0.72;
  g.font = `bold ${size}px ${font}`;
  const m = g.measureText(str).width;
  if (m > w * 0.94) { size *= (w * 0.94) / m; g.font = `bold ${size}px ${font}`; }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.save();
  g.shadowColor = color;
  g.shadowBlur = size * 0.35;
  g.strokeStyle = color;
  g.lineWidth = size * 0.16;
  g.strokeText(str, cx, cy);
  g.restore();
  g.strokeStyle = color;
  g.lineWidth = size * 0.11;
  g.strokeText(str, cx, cy);
  g.strokeStyle = '#ffffff';
  g.lineWidth = size * 0.04;
  g.strokeText(str, cx, cy);
  if (o.underline) {
    g.fillStyle = color;
    g.fillRect(w * 0.06, h * 0.92, w * 0.88, size * 0.06);
  }
}

/** A weathered board: base colour, plank lines, grain, scuffs. */
function board(g, w, h, base, r, o = {}) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const planks = o.planks || Math.max(1, Math.round(h / 34));
  for (let i = 0; i < planks; i++) {
    const y0 = (i / planks) * h;
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,210'},${0.03 + r() * 0.08})`;
    g.fillRect(0, y0, w, h / planks);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y0, w, 1.5);
  }
  for (let i = 0; i < w * h / 120; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '20,14,8' : '235,225,200'},${0.03 + r() * 0.1})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 8, 1 + r());
  }
  // rusty corners and nail heads
  g.fillStyle = 'rgba(30,20,14,0.5)';
  for (const [x, y] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]]) { g.beginPath(); g.arc(x, y, 2, 0, 6.3); g.fill(); }
}

/** Hand-painted lettering: slightly uneven, with a drip or two. */
function paint(g, str, cx, cy, w, h, color, r, o = {}) {
  const size = Math.min(h, o.max || 999);
  g.save();
  g.font = `${o.weight || 'bold'} ${size}px ${o.font || HAND}`;
  let total = g.measureText(str).width;
  let k = 1;
  if (total > w) { k = w / total; g.font = `${o.weight || 'bold'} ${size * k}px ${o.font || HAND}`; total = w; }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let x = cx - total / 2;
  g.fillStyle = color;
  for (const ch of str) {
    const cw = g.measureText(ch).width;
    g.save();
    g.translate(x + cw / 2, cy + (r() - 0.5) * size * k * 0.08);
    g.rotate((r() - 0.5) * 0.09 + (o.tilt || 0));
    g.fillText(ch, -cw / 2, 0);
    g.restore();
    if (ch !== ' ' && r() < 0.16) {
      g.fillRect(x + cw * (0.3 + r() * 0.4), cy + size * k * 0.32, Math.max(1, size * k * 0.03), size * k * (0.1 + r() * 0.3));
    }
    x += cw;
  }
  g.restore();
}

function weather(g, w, h, r, amount = 1) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 70 * amount; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '30,24,16' : '215,205,185'},${0.03 + r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 3);
  }
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(20,14,8,${0.22 * amount})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.restore();
}

function rrect(g, x, y, w, h, rad) {
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

// ---- the cells ----------------------------------------------------------------------------

const PAINT = {
  p_haven(g, w, h, r) {
    board(g, w, h, '#7a5a38', r, { planks: 3 });
    paint(g, 'HAVEN OR BUST', w / 2, h * 0.46, w * 0.9, h * 0.62, '#f4efe0', r, { max: 96 });
    g.fillStyle = '#c0392b';
    g.fillRect(w * 0.08, h * 0.83, w * 0.84, 5);
    weather(g, w, h, r);
  },
  p_office(g, w, h, r) {
    board(g, w, h, '#40606a', r, { planks: 2 });
    paint(g, 'OFFICE', w / 2, h / 2, w * 0.8, h * 0.6, '#f3ecd8', r, { font: FONT, max: 44 });
    weather(g, w, h, r);
  },
  p_room(g, w, h, r) {
    g.fillStyle = '#b8863a';
    rrect(g, 2, 2, w - 4, h - 4, 8);
    g.fill();
    g.fillStyle = '#2a1e12';
    fit(g, '12', w / 2, h / 2, w * 0.8, h * 0.8, { font: SERIF, max: 52 });
    weather(g, w, h, r, 0.5);
  },
  p_deke(g, w, h, r) {
    board(g, w, h, '#4a4f52', r, { planks: 2 });
    paint(g, "DEKE'S GARAGE", w / 2, h * 0.4, w * 0.9, h * 0.5, '#f0d060', r, { max: 46 });
    paint(g, 'WE FIX IT. MOSTLY.', w / 2, h * 0.76, w * 0.8, h * 0.22, '#d8d8d0', r, { max: 22 });
    weather(g, w, h, r);
  },
  p_medic(g, w, h, r) {
    board(g, w, h, '#d8d4c4', r, { planks: 2 });
    g.fillStyle = '#c62828';
    g.fillRect(14, h / 2 - 20, 40, 40);
    g.fillStyle = '#d8d4c4';
    g.fillRect(28, h / 2 - 20, 12, 40);
    g.fillRect(14, h / 2 - 6, 40, 12);
    g.fillStyle = '#c62828';
    g.fillRect(14, h / 2 - 6, 40, 12);
    g.fillRect(28, h / 2 - 20, 12, 40);
    paint(g, 'MEDIC', w * 0.62, h / 2, w * 0.6, h * 0.55, '#8a1c1c', r, { max: 48 });
    weather(g, w, h, r);
  },
  p_armory(g, w, h, r) {
    board(g, w, h, '#4b5030', r, { planks: 2 });
    paint(g, 'ARMORY', w / 2, h * 0.38, w * 0.86, h * 0.5, '#e8e2c8', r, { max: 46 });
    paint(g, 'SIGN OUT. SIGN BACK IN.', w / 2, h * 0.76, w * 0.88, h * 0.22, '#d8c880', r, { max: 20 });
    weather(g, w, h, r);
  },
  p_range(g, w, h, r) {
    board(g, w, h, '#6a4a2c', r, { planks: 2 });
    paint(g, 'RANGE', w / 2, h * 0.38, w * 0.7, h * 0.5, '#f4efe0', r, { max: 46 });
    paint(g, 'MUFFS ON. MIND THE DUMMIES.', w / 2, h * 0.78, w * 0.92, h * 0.2, '#e0c060', r, { max: 18 });
    weather(g, w, h, r);
  },
  p_board(g, w, h, r) {
    board(g, w, h, '#3e5a44', r, { planks: 2 });
    paint(g, 'MISSIONS', w / 2, h * 0.4, w * 0.86, h * 0.5, '#f4efe0', r, { max: 48 });
    paint(g, 'RADIO ON. EARS OPEN.', w / 2, h * 0.78, w * 0.9, h * 0.2, '#d8d8a0', r, { max: 18 });
    weather(g, w, h, r);
  },
  p_fund(g, w, h, r) {
    board(g, w, h, '#5a4630', r, { planks: 2 });
    paint(g, 'HAVEN FUND', w / 2, h * 0.4, w * 0.88, h * 0.5, '#f0e0a0', r, { max: 46 });
    paint(g, 'EVERY BIT HELPS', w / 2, h * 0.78, w * 0.8, h * 0.2, '#e8e0c8', r, { max: 20 });
    weather(g, w, h, r);
  },
  p_garden(g, w, h, r) {
    board(g, w, h, '#4a6a3a', r, { planks: 2 });
    paint(g, "JUNE'S GARDEN", w / 2, h / 2, w * 0.9, h * 0.6, '#fff0f0', r, { max: 34 });
    weather(g, w, h, r);
  },
  p_eggs(g, w, h, r) {
    board(g, w, h, '#d8c890', r, { planks: 2 });
    paint(g, 'FRESH EGGS', w / 2, h / 2, w * 0.9, h * 0.6, '#5a2a1a', r, { max: 40 });
    weather(g, w, h, r);
  },
  p_pies(g, w, h, r) {
    board(g, w, h, '#a8482e', r, { planks: 2 });
    paint(g, 'APPLE PIES', w / 2, h / 2, w * 0.9, h * 0.6, '#f8f0d8', r, { max: 40 });
    weather(g, w, h, r);
  },
  p_farm(g, w, h, r) {
    board(g, w, h, '#f0e8d0', r, { planks: 3 });
    paint(g, 'HARLAN FARM', w / 2, h * 0.42, w * 0.92, h * 0.5, '#7a2418', r, { font: SERIF, max: 60 });
    paint(g, 'EST. 1931', w / 2, h * 0.8, w * 0.5, h * 0.2, '#5a4632', r, { font: SERIF, max: 22 });
    weather(g, w, h, r, 0.8);
  },
  p_depot(g, w, h, r) {
    board(g, w, h, '#2f3c34', r, { planks: 3 });
    paint(g, 'BLACKWATER', w / 2, h * 0.4, w * 0.92, h * 0.5, '#f0e6c0', r, { font: SERIF, max: 60 });
    paint(g, 'RAILWAY DEPOT', w / 2, h * 0.8, w * 0.7, h * 0.22, '#c8b880', r, { font: SERIF, max: 26 });
    weather(g, w, h, r);
  },
  p_water(g, w, h, r) {
    board(g, w, h, '#35546a', r, { planks: 2 });
    paint(g, 'WATER - CLEAN', w / 2, h / 2, w * 0.9, h * 0.6, '#eaf4f8', r, { max: 34 });
    weather(g, w, h, r);
  },
  p_bunks(g, w, h, r) {
    board(g, w, h, '#5a4a3a', r, { planks: 2 });
    paint(g, 'BUNKS', w / 2, h / 2, w * 0.7, h * 0.65, '#f0e6c8', r, { max: 44 });
    weather(g, w, h, r);
  },
  p_forge(g, w, h, r) {
    board(g, w, h, '#3a2c26', r, { planks: 2 });
    paint(g, 'THE FORGE', w / 2, h / 2, w * 0.86, h * 0.65, '#ff9a48', r, { max: 40 });
    weather(g, w, h, r);
  },
  p_mess(g, w, h, r) {
    board(g, w, h, '#6a5a3a', r, { planks: 2 });
    paint(g, 'MESS TENT', w / 2, h / 2, w * 0.86, h * 0.65, '#fff4d8', r, { max: 40 });
    weather(g, w, h, r);
  },
  p_rules(g, w, h, r) {
    board(g, w, h, '#d8cfae', r, { planks: 1 });
    g.fillStyle = '#3a2c1c';
    const lines = ['HOUSE RULES', '1. Dishes in the tub', '2. Knock first', '3. Share the fire', '4. No one goes alone', '5. Be kind'];
    lines.forEach((t, i) => {
      g.font = `${i === 0 ? 'bold' : ''} ${i === 0 ? 24 : 17}px ${HAND}`;
      g.textAlign = i === 0 ? 'center' : 'left';
      g.textBaseline = 'middle';
      g.fillText(t, i === 0 ? w / 2 : 22, 26 + i * 27);
    });
    weather(g, w, h, r, 0.6);
  },
  p_greenhouse(g, w, h, r) {
    board(g, w, h, '#3a6a4a', r, { planks: 2 });
    paint(g, 'GREENHOUSE', w / 2, h / 2, w * 0.9, h * 0.6, '#f0f8e0', r, { max: 34 });
    weather(g, w, h, r);
  },
  p_apples(g, w, h, r) {
    board(g, w, h, '#8a2a24', r, { planks: 2 });
    paint(g, 'PICK YOUR OWN', w / 2, h / 2, w * 0.9, h * 0.6, '#f8ecd0', r, { max: 34 });
    weather(g, w, h, r);
  },
  p_dock(g, w, h, r) {
    board(g, w, h, '#4a6a78', r, { planks: 2 });
    paint(g, 'NO DIVING', w / 2, h / 2, w * 0.86, h * 0.6, '#f4f4e8', r, { max: 34 });
    weather(g, w, h, r);
  },
  p_noparking(g, w, h, r) {
    g.fillStyle = '#f2f2ea';
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 6.3); g.fill();
    g.strokeStyle = '#c62828';
    g.lineWidth = 8;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 12, 0, 6.3); g.stroke();
    g.beginPath(); g.moveTo(w * 0.22, h * 0.22); g.lineTo(w * 0.78, h * 0.78); g.stroke();
    fit(g, 'P', w / 2, h / 2, w * 0.4, h * 0.5, { color: '#222', max: 60 });
    weather(g, w, h, r);
  },
  p_thanks(g, w, h, r) {
    board(g, w, h, '#6a4a3a', r, { planks: 2 });
    paint(g, 'THANK YOU, KINDLY', w / 2, h / 2, w * 0.9, h * 0.6, '#f8f0d8', r, { max: 34 });
    weather(g, w, h, r);
  },
};

const NEON = {
  n_roadhouse: ['ROADHOUSE', '#ff4f9a'],
  n_vacancy: ['VACANCY', '#38e8ff'],
  n_no: ['NO', '#ff3b30'],
  n_motel: ['MOTEL', '#ffb03a'],
  n_open: ['OPEN', '#5dff8a'],
  n_cafe: ['CAFE', '#ff8a3a'],
  n_depot: ['BLACKWATER', '#ffb347'],
  n_water: ['WATER', '#5ac8ff'],
  n_forge: ['FORGE', '#ff7a2a'],
  n_farm: ['HARLAN FARM', '#ffd56a'],
  n_eggs: ['EGGS', '#ffe27a'],
  n_pies: ['PIES', '#ff9a6a'],
  n_haven: ['HAVEN', '#7affc8'],
};

function paintMap(g, w, h, r) {
  g.fillStyle = '#d9c9a0';
  g.fillRect(0, 0, w, h);
  // paper folds and stains
  g.fillStyle = 'rgba(120,90,50,0.08)';
  for (let i = 0; i < 6; i++) g.fillRect(r() * w, r() * h, 60 + r() * 120, 40 + r() * 80);
  g.strokeStyle = 'rgba(90,70,40,0.35)';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  // rivers, roads, towns
  g.strokeStyle = '#6a9ab0';
  g.lineWidth = 7;
  g.beginPath(); g.moveTo(w * 0.05, h * 0.72); g.bezierCurveTo(w * 0.3, h * 0.55, w * 0.6, h * 0.9, w * 0.95, h * 0.62); g.stroke();
  g.strokeStyle = '#7a5a3a';
  g.lineWidth = 4;
  const route = [[0.08, 0.2], [0.24, 0.32], [0.4, 0.26], [0.52, 0.42], [0.66, 0.36], [0.8, 0.52], [0.92, 0.42]];
  g.setLineDash([10, 6]);
  g.beginPath();
  route.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = '#b03a2c';
  g.lineWidth = 5;
  g.beginPath();
  route.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
  g.stroke();
  // pins
  route.forEach(([x, y], i) => {
    g.fillStyle = i === route.length - 1 ? '#2e7d32' : i === 0 ? '#1565c0' : '#c62828';
    g.beginPath(); g.arc(x * w, y * h, 9, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(x * w - 2, y * h - 3, 3, 0, 6.3); g.fill();
  });
  g.fillStyle = '#2e2418';
  g.font = `bold 20px ${HAND}`;
  g.fillText('HAVEN', w * 0.83, h * 0.34);
  g.font = `bold 16px ${HAND}`;
  g.fillText('you are here', w * 0.05, h * 0.14);
  g.font = `15px ${HAND}`;
  for (const [t, x, y] of [['Harlan', 0.6, 0.6], ['Blackwater', 0.3, 0.78], ['Delta', 0.45, 0.18], ['I-70', 0.15, 0.5]]) g.fillText(t, x * w, y * h);
  // grid + handwriting
  g.strokeStyle = 'rgba(70,90,110,0.18)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  weather(g, w, h, r, 0.7);
}

function paintTally(g, w, h, r) {
  g.fillStyle = '#26302a';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 40; i++) g.fillRect(r() * w, r() * h, 30 + r() * 60, 10 + r() * 20);
  g.strokeStyle = '#efe8d4';
  g.lineWidth = 3;
  g.lineCap = 'round';
  // tally marks in fives
  for (let row = 0; row < 5; row++) {
    for (let grp = 0; grp < 3; grp++) {
      const x0 = 16 + grp * 44, y0 = 96 + row * 34;
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x0 + k * 8, y0); g.lineTo(x0 + k * 8 + (r() - 0.5) * 2, y0 + 24); g.stroke(); }
      g.beginPath(); g.moveTo(x0 - 4, y0 + 20); g.lineTo(x0 + 32, y0 + 4); g.stroke();
    }
  }
  g.fillStyle = '#efe8d4';
  g.font = `bold 24px ${HAND}`;
  g.textAlign = 'left';
  g.fillText('TO BUILD', 16, 34);
  g.font = `17px ${HAND}`;
  ['lights', 'tower', 'more beds', 'garden', 'walls'].forEach((t, i) => g.fillText(t, 100, 60 + i * 0 + 0 + 0));
  g.font = `16px ${HAND}`;
  ['- power', '- tower', '- walls', '- garden'].forEach((t, i) => g.fillText(t, 150, 100 + i * 34));
}

function paintBlueprint(g, w, h, r) {
  g.fillStyle = '#2a5a90';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.strokeStyle = 'rgba(240,248,255,0.9)';
  g.lineWidth = 2;
  // a watchtower elevation, a wall section, a windmill
  g.strokeRect(30, 30, 60, 150);
  g.beginPath(); g.moveTo(20, 30); g.lineTo(60, 8); g.lineTo(100, 30); g.stroke();
  for (let y = 50; y < 170; y += 24) { g.beginPath(); g.moveTo(30, y); g.lineTo(90, y + 12); g.moveTo(90, y); g.lineTo(30, y + 12); g.stroke(); }
  g.beginPath(); g.arc(200, 90, 40, 0, 6.3); g.stroke();
  g.beginPath(); g.moveTo(200, 50); g.lineTo(200, 130); g.moveTo(160, 90); g.lineTo(240, 90); g.stroke();
  g.fillStyle = 'rgba(240,248,255,0.9)';
  g.font = `14px ${HAND}`;
  g.fillText('WATCH 2.4 m', 110, 40);
  g.fillText('POWER 5 kW', 175, 160);
  g.fillText('rev. C', 250, 210);
}

function paintPolaroids(g, w, h, r) {
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, w, h);
  const tints = ['#c99a6a', '#7a9ab0', '#a0b078', '#d0a0a0', '#b8a0c8', '#e0c070'];
  for (let i = 0; i < 8; i++) {
    const cw = 108, ch = 124;
    const x = 8 + (i % 4) * 124, y = 6 + Math.floor(i / 4) * 124;
    g.save();
    g.translate(x + cw / 2, y + ch / 2);
    g.rotate((r() - 0.5) * 0.18);
    g.fillStyle = '#f0ece0';
    g.fillRect(-cw / 2, -ch / 2, cw, ch);
    // a tiny scene: sky, hill, two stick people
    const t = tints[i % tints.length];
    g.fillStyle = t;
    g.fillRect(-cw / 2 + 7, -ch / 2 + 7, cw - 14, ch - 34);
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.fillRect(-cw / 2 + 7, -ch / 2 + 7, cw - 14, (ch - 34) * 0.45);
    g.fillStyle = 'rgba(40,60,40,0.55)';
    g.beginPath(); g.ellipse(0, ch / 2 - 30, cw * 0.5, 22, 0, 0, 6.3); g.fill();
    g.fillStyle = '#2a2a30';
    for (const dx of [-14, 12]) { g.beginPath(); g.arc(dx, -6, 6, 0, 6.3); g.fill(); g.fillRect(dx - 4, 0, 8, 22); }
    g.restore();
  }
}

function paintKids(g, w, h, r) {
  g.clearRect(0, 0, w, h);
  const cols = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00'];
  for (let i = 0; i < 4; i++) {
    const x = 6 + (i % 2) * 250, y = 6 + Math.floor(i / 2) * 124;
    g.save();
    g.translate(x + 120, y + 58);
    g.rotate((r() - 0.5) * 0.14);
    g.fillStyle = '#f8f4e8';
    g.fillRect(-120, -58, 240, 116);
    g.lineWidth = 4;
    g.lineCap = 'round';
    // sun, house, stick family, a big fat cat
    g.strokeStyle = cols[3]; g.beginPath(); g.arc(-84, -30, 14, 0, 6.3); g.stroke();
    for (let k = 0; k < 8; k++) { const a = k * 0.785; g.beginPath(); g.moveTo(-84 + Math.cos(a) * 19, -30 + Math.sin(a) * 19); g.lineTo(-84 + Math.cos(a) * 27, -30 + Math.sin(a) * 27); g.stroke(); }
    g.strokeStyle = cols[i % 6]; g.strokeRect(-20, 6, 46, 34); g.beginPath(); g.moveTo(-26, 6); g.lineTo(3, -22); g.lineTo(32, 6); g.stroke();
    g.strokeStyle = cols[(i + 2) % 6];
    for (const dx of [50, 68, 86]) { g.beginPath(); g.arc(dx, 8, 6, 0, 6.3); g.moveTo(dx, 14); g.lineTo(dx, 34); g.moveTo(dx - 8, 22); g.lineTo(dx + 8, 22); g.moveTo(dx, 34); g.lineTo(dx - 6, 46); g.moveTo(dx, 34); g.lineTo(dx + 6, 46); g.stroke(); }
    g.strokeStyle = cols[(i + 4) % 6]; g.beginPath(); g.ellipse(-70, 34, 24, 14, 0, 0, 6.3); g.stroke();
    g.beginPath(); g.moveTo(-88, 24); g.lineTo(-90, 12); g.lineTo(-80, 20); g.moveTo(-60, 22); g.lineTo(-56, 10); g.lineTo(-52, 22); g.stroke();
    g.restore();
  }
}

function paintNotes(g, w, h, r) {
  g.clearRect(0, 0, w, h);
  const cols = ['#fff59d', '#ffcc80', '#a5d6a7', '#90caf9', '#f48fb1'];
  const txt = ['Ozzy: radio', 'Mara: bandages!', 'no. more. peas.', 'Deke owes me', 'June + cat', 'HAVEN 200mi', 'fuel low', 'Thanks all'];
  for (let i = 0; i < 8; i++) {
    const x = 6 + (i % 4) * 62, y = 6 + Math.floor(i / 4) * 90;
    g.save();
    g.translate(x + 28, y + 36);
    g.rotate((r() - 0.5) * 0.25);
    g.fillStyle = cols[i % cols.length];
    g.fillRect(-28, -34, 56, 68);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(-28, 26, 56, 8);
    g.fillStyle = '#3a3226';
    g.font = `11px ${HAND}`;
    g.textAlign = 'center';
    const words = txt[i].split(' ');
    words.forEach((wd, k) => g.fillText(wd, 0, -12 + k * 14));
    g.restore();
  }
}

function paintCalendar(g, w, h, r) {
  g.fillStyle = '#f0e8d0';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#b03a2c';
  g.fillRect(0, 0, w, 44);
  g.fillStyle = '#fff';
  g.font = `bold 22px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('DAY 41', w / 2, 30);
  g.strokeStyle = '#8a7a5a';
  g.lineWidth = 1;
  for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) g.strokeRect(6 + i * 25, 54 + j * 36, 25, 36);
  g.strokeStyle = '#b03a2c';
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) { const cx = 6 + (i % 7) * 25 + 12, cy = 54 + Math.floor(i / 7) * 36 + 18; g.beginPath(); g.moveTo(cx - 8, cy - 8); g.lineTo(cx + 8, cy + 8); g.moveTo(cx + 8, cy - 8); g.lineTo(cx - 8, cy + 8); g.stroke(); }
}

function paintCross(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#f4f2ea';
  rrect(g, 4, 4, w - 8, h - 8, 14);
  g.fill();
  g.fillStyle = '#d32f2f';
  g.fillRect(w * 0.4, h * 0.16, w * 0.2, h * 0.68);
  g.fillRect(w * 0.16, h * 0.4, w * 0.68, h * 0.2);
}

function paintTarget(g, w, h) {
  g.clearRect(0, 0, w, h);
  const rings = ['#f4f0e0', '#1e1e1e', '#f4f0e0', '#c62828', '#f4f0e0', '#c62828'];
  rings.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(w / 2, h / 2, (w / 2 - 3) * (1 - i / rings.length), 0, 6.3);
    g.fill();
  });
  g.fillStyle = '#1e1e1e';
  g.beginPath(); g.arc(w / 2, h / 2, 5, 0, 6.3); g.fill();
}

function paintCork(g, w, h, r) {
  g.fillStyle = '#b08850';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 360; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '90,56,24' : '220,180,120'},${0.15 + r() * 0.25})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

function paintPlank(g, w, h, r) {
  g.fillStyle = '#8a6a44';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '40,24,10' : '230,200,150'},${0.06 + r() * 0.16})`;
    g.fillRect(0, r() * h, w, 1 + r() * 3);
  }
}

function paintPaper(g, w, h) {
  g.fillStyle = '#f0ead8';
  g.fillRect(0, 0, w, h);
}

function paintStamp(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(200,40,40,0.85)';
  g.lineWidth = 4;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = 'rgba(200,40,40,0.85)';
  g.font = `bold 26px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('APPROVED', w / 2, h / 2);
}

function paintChalk(g, w, h, r) {
  g.fillStyle = '#23302b';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 30; i++) g.fillRect(r() * w, r() * h, 30 + r() * 80, 6 + r() * 14);
  g.fillStyle = '#efe8d4';
  g.font = `bold 22px ${HAND}`;
  g.textAlign = 'left';
  g.fillText("TODAY'S SOUP:", 14, 32);
  g.font = `20px ${HAND}`;
  g.fillText('beans. again.', 14, 62);
  g.fillText('(with love)', 14, 90);
  g.strokeStyle = '#efe8d4';
  g.lineWidth = 2;
  g.strokeRect(6, 6, w - 12, h - 12);
}

function paintTag(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#f0e6c8';
  rrect(g, 3, 3, w - 6, h - 6, 6);
  g.fill();
  g.strokeStyle = '#8a7a5a';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#3a2c1c';
  g.font = `bold 20px ${HAND}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('3 scrap', w / 2, h / 2);
}

function paint2d(g, name, w, h, seed) {
  const r = rng(seed);
  if (PAINT[name]) return PAINT[name](g, w, h, r);
  if (NEON[name]) return neon(g, NEON[name][0], w, h, NEON[name][1], name === 'n_no' ? {} : {});
  switch (name) {
    case 'map': return paintMap(g, w, h, r);
    case 'tally': return paintTally(g, w, h, r);
    case 'blueprint': return paintBlueprint(g, w, h, r);
    case 'polaroids': return paintPolaroids(g, w, h, r);
    case 'kids': return paintKids(g, w, h, r);
    case 'notes': return paintNotes(g, w, h, r);
    case 'calendar': return paintCalendar(g, w, h, r);
    case 'cross': return paintCross(g, w, h);
    case 'target': case 'bullseye': return paintTarget(g, w, h);
    case 'cork': return paintCork(g, w, h, r);
    case 'plank': return paintPlank(g, w, h, r);
    case 'paper': return paintPaper(g, w, h);
    case 'stamp': return paintStamp(g, w, h);
    case 'chalk': return paintChalk(g, w, h, r);
    case 'tag': return paintTag(g, w, h);
    default: return null;
  }
}

function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  if (!cells) cells = pack();
  let seed = 11;
  for (const [name, box] of Object.entries(cells)) {
    const [x0, y0, x1, y1] = box;
    const w = x1 - x0, h = y1 - y0;
    g.save();
    g.beginPath();
    g.rect(x0, y0, w, h);
    g.clip();
    g.translate(x0, y0);
    try { paint2d(g, name, w, h, seed += 7); } catch (err) { /* a missing font is not fatal */ }
    g.restore();
  }
  return c;
}

/** The atlas as a texture (new texture per call, one shared canvas). */
export function makeHubTexture(anisotropy = 8) {
  if (!canvas) canvas = paintAtlas();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
