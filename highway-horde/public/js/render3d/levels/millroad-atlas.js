// Picture atlas of this owner's story levels (Mill Road, Hollow Creek, Blackpine): shop fascias and
// price boards, road and park signs, posters and notices, hand-painted plywood, product fronts for
// shelves and coolers, liveries, and the alpha-cut pictures: corn plants, graffiti, blood smears and
// grime. Painted once per page on a canvas (nothing is loaded from files). Cells are laid out by a
// fixed shelf packer, so a cell's uv rect never depends on what the browser can draw.
//
//   lvUV(name) → [u0, v0, u1, v1]    (texture flipY = true, like world-tex.js atlasUV)
//   makeLevelTexture(aniso)           THREE.CanvasTexture (new texture per renderer, one shared canvas)

import * as THREE from 'three';

const AW = 2048, AH = 2048;
const FONT = '"Arial Black","Helvetica Neue",Arial,"DejaVu Sans","Liberation Sans",sans-serif';
const COND = '"Arial Narrow","Liberation Sans Narrow","DejaVu Sans Condensed",Arial,sans-serif';
const HAND = '"Marker Felt","Comic Sans MS","Segoe Print","DejaVu Sans","Liberation Sans",sans-serif';
const SERIF = 'Georgia,"DejaVu Serif","Liberation Serif",serif';

/** Cell sizes (w, h) in atlas pixels, in packing order. */
export const LV_CELLS = {
  // generic, alpha-cut (the 'lvdecal' / 'lvleaf' buckets)
  white: [16, 16], blood1: [256, 256], blood2: [256, 256], blood3: [256, 128], hands: [128, 128], grime: [256, 128], drip: [128, 256],
  graf1: [256, 96], graf2: [256, 96], graf3: [256, 96], graf4: [256, 96], graf5: [256, 128], xcode: [128, 128],
  corn1: [256, 512], corn2: [256, 512], corn3: [256, 512], cornrow: [512, 256], papers: [128, 128],
  // posters and notices
  poster1: [128, 192], poster2: [128, 192], poster3: [128, 192], poster4: [128, 192], notice: [128, 160],
  // product fronts and store dressing
  shelfA: [256, 64], shelfB: [256, 64], shelfC: [256, 64], shelfD: [256, 64], cooler: [128, 256], magazines: [128, 128], chips: [128, 128],
  // Mill Road
  mr_logo: [256, 256], mr_fascia: [512, 64], mr_prices: [256, 256], mr_service: [512, 64], mr_mart: [512, 64], mr_shady: [512, 160],
  mr_office: [256, 64], mr_slow: [128, 160], mr_poolrules: [128, 192], mr_ozzy: [256, 128], mr_haskell: [512, 128], mr_closed: [256, 192],
  mr_millrd: [256, 64], mr_gas2: [256, 128], mr_shadysign: [256, 128], mr_rhsign: [256, 128], mr_deke: [256, 128], mr_ambulance: [256, 64],
  mr_flammable: [128, 128], mr_wash: [256, 64], mr_reefer: [512, 128], mr_agair: [256, 64], mr_harvest: [128, 32], mr_lotto: [128, 64],
  mr_radio: [256, 128], mr_parkmap: [256, 192], mr_hours: [128, 128], mr_beer: [128, 64], mr_evac: [256, 128], mr_tagx: [128, 64],
};

let canvas = null;
let cells = null;

function pack() {
  const out = {};
  let x = 0, y = 0, rowH = 0;
  for (const [k, [w, h]] of Object.entries(LV_CELLS)) {
    if (x + w + 2 > AW) { x = 0; y += rowH + 2; rowH = 0; }
    out[k] = [x, y, x + w, y + h];
    x += w + 2;
    rowH = Math.max(rowH, h);
  }
  return out;
}

/** UV rect [u0, v0, u1, v1] of a cell (unknown names give the white cell). */
export function lvUV(name) {
  if (!cells) cells = pack();
  const c = cells[name] || cells.white;
  // (half a texel in: neighbours never bleed into a cell's edge)
  return [(c[0] + 0.5) / AW, 1 - (c[3] - 0.5) / AH, (c[2] - 0.5) / AW, 1 - (c[1] + 0.5) / AH];
}

/** A sub-rect of a cell (u0..u1, v0..v1 in 0..1 of the cell, v up). */
export function lvSub(name, u0, v0, u1, v1) {
  const [a, b, c, d] = lvUV(name);
  return [a + (c - a) * u0, b + (d - b) * v0, a + (c - a) * u1, b + (d - b) * v1];
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
  const set = () => { g.font = `${o.italic ? 'italic ' : ''}${o.weight || 'bold'} ${size}px ${font}`; };
  set();
  const m = g.measureText(str).width;
  if (m > w) { size = Math.max(4, size * (w / m)); set(); }
  g.textAlign = o.align || 'center';
  g.textBaseline = 'middle';
  if (o.stroke) { g.lineWidth = o.strokeW || Math.max(1, size * 0.12); g.strokeStyle = o.stroke; g.lineJoin = 'round'; g.strokeText(str, cx, cy); }
  g.fillStyle = o.color || '#fff';
  g.fillText(str, cx, cy);
  return size;
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

/** Weathering: specks, a grime gradient toward the bottom, faded patches. */
function weather(g, w, h, r, amount = 1) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 90 * amount; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '30,24,16' : '225,215,195'},${0.03 + r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 3);
  }
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, `rgba(20,14,8,${0.05 * amount})`);
  grd.addColorStop(1, `rgba(20,14,8,${0.28 * amount})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  // rust / water streaks from the top edge
  for (let i = 0; i < 5 * amount; i++) {
    const x = r() * w, len = h * (0.2 + r() * 0.6);
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, `rgba(80,50,25,${0.18 * amount})`);
    gr.addColorStop(1, 'rgba(80,50,25,0)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 2 + r() * 5, len);
  }
  g.restore();
}

/** A weathered board: base colour, plank lines, grain, nails. */
function board(g, w, h, base, r, planks = 3) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < planks; i++) {
    const y0 = (i / planks) * h;
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,210'},${0.03 + r() * 0.08})`;
    g.fillRect(0, y0, w, h / planks);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, y0, w, 1.5);
  }
  for (let i = 0; i < w * h / 110; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '20,14,8' : '235,225,200'},${0.03 + r() * 0.1})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 9, 1 + r());
  }
}

/** Hand-painted letters: uneven, drips. */
function paint(g, str, cx, cy, w, h, color, r, o = {}) {
  const size = Math.min(h, o.max || 999);
  g.save();
  g.font = `bold ${size}px ${o.font || HAND}`;
  let total = g.measureText(str).width;
  let k = 1;
  if (total > w) { k = w / total; g.font = `bold ${size * k}px ${o.font || HAND}`; total = w; }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let x = cx - total / 2;
  g.fillStyle = color;
  for (const ch of str) {
    const cw = g.measureText(ch).width;
    g.save();
    g.translate(x + cw / 2, cy + (r() - 0.5) * size * k * 0.1);
    g.rotate((r() - 0.5) * 0.12 + (o.tilt || 0));
    g.fillText(ch, -cw / 2, 0);
    g.restore();
    if (ch !== ' ' && r() < (o.drips ?? 0.2)) g.fillRect(x + cw * (0.3 + r() * 0.4), cy + size * k * 0.3, Math.max(1, size * k * 0.035), size * k * (0.12 + r() * 0.4));
    x += cw;
  }
  g.restore();
}

/** Spray-paint letters with overspray (alpha around them). */
function spray(g, str, cx, cy, w, h, color, r, o = {}) {
  g.save();
  g.shadowColor = color;
  g.shadowBlur = h * 0.12;
  paint(g, str, cx, cy, w, h, color, r, { font: o.font || FONT, drips: 0.35, max: o.max, tilt: o.tilt });
  g.restore();
  for (let i = 0; i < 160; i++) {
    g.fillStyle = color;
    g.globalAlpha = 0.25 * r();
    g.fillRect(cx + (r() - 0.5) * w, cy + (r() - 0.5) * h * 1.1, 1.2, 1.2);
  }
  g.globalAlpha = 1;
}

function blood(g, w, h, r, kind) {
  g.clearRect(0, 0, w, h);
  const col = (a) => `rgba(${95 + Math.floor(r() * 40)},${6 + Math.floor(r() * 10)},${6 + Math.floor(r() * 8)},${a})`;
  if (kind === 'smear') {
    // a hand dragged down a wall: broad streaks with finger lines and runs
    for (let k = 0; k < 4; k++) {
      const x0 = w * (0.3 + k * 0.1 + r() * 0.05);
      g.strokeStyle = col(0.75);
      g.lineWidth = w * 0.05;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, h * 0.08); g.bezierCurveTo(x0 + w * 0.05, h * 0.4, x0 - w * 0.08, h * 0.6, x0 + w * 0.02, h * 0.92); g.stroke();
    }
    for (let i = 0; i < 8; i++) { g.fillStyle = col(0.6); g.fillRect(w * (0.25 + r() * 0.5), h * (0.3 + r() * 0.4), 2 + r() * 2, h * (0.1 + r() * 0.4)); }
    return;
  }
  // a splatter: a core, lobes, satellites and spray
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.26;
  g.fillStyle = col(0.9);
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2, rr = R * (0.6 + r() * 0.55);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * (kind === 'pool' ? 0.6 : 1);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.fill();
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = R * (1 + r() * 1.1), s = 2 + r() * R * 0.18;
    g.fillStyle = col(0.5 + r() * 0.4);
    g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * (kind === 'pool' ? 0.6 : 1), s, s * (0.5 + r() * 0.6), a, 0, 6.3); g.fill();
  }
  // darker dried rim
  g.strokeStyle = 'rgba(40,4,4,0.5)';
  g.lineWidth = 2;
  g.stroke();
}

// ---- the cells --------------------------------------------------------------------------------

const PAINT = {
  white(g, w, h) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); },
  blood1(g, w, h, r) { blood(g, w, h, r, 'splat'); },
  blood2(g, w, h, r) { blood(g, w, h, r, 'smear'); },
  blood3(g, w, h, r) { blood(g, w, h, r, 'pool'); },
  hands(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 3; k++) {
      const x = 20 + k * 36 + r() * 8, y = 30 + r() * 50;
      g.fillStyle = `rgba(110,10,8,${0.6 + r() * 0.3})`;
      g.beginPath(); g.ellipse(x, y + 18, 11, 13, 0, 0, 6.3); g.fill();
      for (let f = 0; f < 5; f++) { g.beginPath(); g.ellipse(x - 12 + f * 6, y - (f === 0 ? -6 : 4) + Math.abs(f - 2) * 2, 2.6, 8, (f - 2) * 0.12, 0, 6.3); g.fill(); }
      g.fillRect(x - 2, y + 28, 3, 20 + r() * 30);
    }
  },
  grime(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const x = r() * w, gr = g.createLinearGradient(0, 0, 0, h);
      const a = 0.08 + r() * 0.18;
      gr.addColorStop(0, `rgba(30,24,16,${a})`);
      gr.addColorStop(0.7, `rgba(30,24,16,${a * 0.4})`);
      gr.addColorStop(1, 'rgba(30,24,16,0)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 2 + r() * 10, h * (0.4 + r() * 0.6));
    }
  },
  drip(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = 10 + r() * (w - 20), len = h * (0.3 + r() * 0.65);
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(120,12,10,0.9)');
      gr.addColorStop(1, 'rgba(80,6,6,0.2)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 2 + r() * 4, len);
      g.beginPath(); g.ellipse(x + 2, len, 3, 4, 0, 0, 6.3); g.fill();
    }
    g.fillStyle = 'rgba(120,12,10,0.85)';
    g.fillRect(0, 0, w, 10);
  },
  graf1(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, "THEY'RE INSIDE", w / 2, h / 2, w * 0.92, h * 0.6, '#c8261e', r); },
  graf2(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, 'DEAD AHEAD', w / 2, h / 2, w * 0.9, h * 0.62, '#e8e0d0', r); },
  graf3(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, 'GOD HELP US', w / 2, h / 2, w * 0.9, h * 0.62, '#1a1a1a', r); },
  graf4(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, 'NO SURVIVORS', w / 2, h / 2, w * 0.9, h * 0.56, '#d8a020', r); },
  graf5(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    spray(g, 'HAVEN ->', w / 2, h * 0.38, w * 0.8, h * 0.4, '#3aa0e8', r);
    spray(g, 'WEST', w / 2, h * 0.78, w * 0.5, h * 0.3, '#3aa0e8', r);
  },
  xcode(g, w, h, r) {
    // a search-and-rescue X: date top, team left, hazards right, the dead at the bottom
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#e04a1a';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(14, 14); g.lineTo(w - 14, h - 14); g.moveTo(w - 14, 14); g.lineTo(14, h - 14); g.stroke();
    g.fillStyle = '#e04a1a';
    g.font = `bold 20px ${HAND}`;
    g.textAlign = 'center';
    g.fillText('9/14', w / 2, 26);
    g.fillText('3', w / 2, h - 12);
    g.fillText('K9', 22, h / 2 + 6);
    g.fillText('Z', w - 20, h / 2 + 6);
    void r;
  },
  corn1(g, w, h, r) { cornPlant(g, w, h, r, 0); },
  corn2(g, w, h, r) { cornPlant(g, w, h, r, 1); },
  corn3(g, w, h, r) { cornPlant(g, w, h, r, 2); },
  cornrow(g, w, h, r) {
    // a far row: many thin stalks and leaves, a ragged top
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = r() * w, top = h * (0.02 + r() * 0.2);
      g.strokeStyle = `rgb(${110 + r() * 40},${120 + r() * 30},${50 + r() * 20})`;
      g.lineWidth = 2 + r() * 2;
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + (r() - 0.5) * 8, top); g.stroke();
      for (let k = 0; k < 5; k++) {
        const y = top + (h - top) * (0.1 + k * 0.17), s = r() < 0.5 ? -1 : 1;
        g.fillStyle = `rgb(${90 + r() * 60},${110 + r() * 40},${40 + r() * 25})`;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * 30, y - 12, x + s * (40 + r() * 20), y + 16 + r() * 10); g.quadraticCurveTo(x + s * 24, y - 4, x, y + 5); g.fill();
      }
    }
  },
  papers(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      g.save();
      g.translate(20 + r() * (w - 40), 20 + r() * (h - 40));
      g.rotate(r() * 6.3);
      g.fillStyle = r() < 0.7 ? '#ece6d6' : '#f2e08a';
      g.fillRect(-14, -18, 28, 36);
      g.fillStyle = 'rgba(40,40,50,0.5)';
      for (let l = 0; l < 7; l++) g.fillRect(-10, -13 + l * 4.4, 14 + r() * 6, 1.2);
      g.restore();
    }
  },
  poster1(g, w, h, r) { poster(g, w, h, r, 'MISSING', '#c62828', 'HAVE YOU SEEN', 'LILY - AGE 7'); },
  poster2(g, w, h, r) { poster(g, w, h, r, 'EVACUATE', '#1a4a8a', 'SHELTER AT', 'HARLAN H.S.'); },
  poster3(g, w, h, r) { poster(g, w, h, r, 'LOST DOG', '#2e7d32', 'ANSWERS TO', 'BUSTER'); },
  poster4(g, w, h, r) { poster(g, w, h, r, 'CURFEW', '#e0a020', 'DUSK TO DAWN', 'BY ORDER'); },
  notice(g, w, h, r) {
    g.fillStyle = '#ece6d6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1a1a';
    fit(g, 'NOTICE', w / 2, 20, w * 0.8, 22, { color: '#1a1a1a', font: SERIF });
    for (let l = 0; l < 12; l++) g.fillRect(12, 40 + l * 9, w - 24 - r() * 30, 2);
    g.fillStyle = 'rgba(190,40,30,0.8)';
    g.beginPath(); g.arc(w - 26, h - 26, 14, 0, 6.3); g.fill();
    weather(g, w, h, r, 0.8);
  },
  shelfA(g, w, h, r) { products(g, w, h, r, 'cans'); },
  shelfB(g, w, h, r) { products(g, w, h, r, 'boxes'); },
  shelfC(g, w, h, r) { products(g, w, h, r, 'bottles'); },
  shelfD(g, w, h, r) { products(g, w, h, r, 'looted'); },
  cooler(g, w, h, r) {
    // a glass cooler door: a dark cabinet with lit shelves of bottles and cans, the frame
    g.fillStyle = '#1a2024';
    g.fillRect(0, 0, w, h);
    for (let s = 0; s < 5; s++) {
      const y = 20 + s * 46;
      g.fillStyle = '#8a9296';
      g.fillRect(6, y + 38, w - 12, 3);
      let x = 10;
      while (x < w - 16) {
        const bw = 9 + r() * 6, bh = 26 + r() * 10;
        if (r() < 0.2) { x += bw + 4; continue; }
        const hue = ['#c8281e', '#2a5ac4', '#e0a020', '#2f8a4a', '#e8e8e0', '#6a2a8a', '#1a1a1a'][Math.floor(r() * 7)];
        g.fillStyle = hue;
        rrect(g, x, y + 38 - bh, bw, bh, 3);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x + 2, y + 38 - bh + 4, 2, bh - 8);
        x += bw + 3;
      }
    }
    const gl = g.createLinearGradient(0, 0, w, h);
    gl.addColorStop(0, 'rgba(255,255,255,0.18)');
    gl.addColorStop(0.5, 'rgba(255,255,255,0)');
    gl.addColorStop(1, 'rgba(255,255,255,0.1)');
    g.fillStyle = gl;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9aa0a4';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#c0c4c8';
    g.fillRect(w - 18, h * 0.35, 6, h * 0.3);
  },
  magazines(g, w, h, r) {
    g.fillStyle = '#2a2622';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const x = (i % 4) * 32, y = Math.floor(i / 4) * 64;
      g.fillStyle = ['#c62828', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#e8e8e0', '#222'][i];
      g.fillRect(x + 2, y + 4, 28, 58);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(x + 5, y + 8, 22, 6);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x + 6, y + 22, 18, 26);
    }
    void r;
  },
  chips(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const x = (i % 3) * 42 + 3, y = Math.floor(i / 3) * 62 + 4;
      g.fillStyle = ['#c8a82a', '#a8382e', '#3a5a94', '#3a7a4a', '#c0642c', '#5a3a6a'][Math.floor(r() * 6)];
      g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + 38, y + 6); g.lineTo(x + 36, y + 58); g.lineTo(x + 2, y + 58); g.closePath(); g.fill();
      g.fillStyle = 'rgba(240,230,200,0.6)';
      g.beginPath(); g.ellipse(x + 19, y + 24, 9, 5, -0.2, 0, 6.3); g.fill();
      g.fillStyle = 'rgba(210,160,60,0.9)';
      g.beginPath(); g.ellipse(x + 19, y + 42, 8, 6, 0, 0, 6.3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x + 5, y + 8, 4, 48);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x, y + 4, 38, 4);
    }
  },
  mr_logo(g, w, h, r) {
    // the station's roundel: a red ring, a cream field, a green wheat sheaf and the name
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#b3261e';
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 6.3); g.fill();
    g.fillStyle = '#f2ead6';
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 26, 0, 6.3); g.fill();
    g.fillStyle = '#1f5a34';
    for (let k = -2; k <= 2; k++) {
      g.save(); g.translate(w / 2, h * 0.6); g.rotate(k * 0.22);
      g.fillRect(-3, -70, 6, 70);
      for (let j = 0; j < 5; j++) { g.beginPath(); g.ellipse(-7, -70 + j * 10, 6, 3.4, -0.6, 0, 6.3); g.ellipse(7, -70 + j * 10, 6, 3.4, 0.6, 0, 6.3); g.fill(); }
      g.restore();
    }
    fit(g, 'MILL ROAD', w / 2, h * 0.73, w * 0.62, 30, { color: '#b3261e' });
    fit(g, 'GAS', w / 2, h * 0.84, w * 0.3, 24, { color: '#1a1a1a' });
    weather(g, w, h, r, 0.5);
  },
  mr_fascia(g, w, h, r) {
    g.fillStyle = '#f2ead6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, w, 8);
    g.fillRect(0, h - 8, w, 8);
    fit(g, 'MILL ROAD GAS', w * 0.36, h / 2, w * 0.62, h * 0.62, { color: '#b3261e' });
    fit(g, 'FOOD MART', w * 0.83, h / 2, w * 0.28, h * 0.46, { color: '#1f5a34' });
    weather(g, w, h, r, 0.7);
  },
  mr_prices(g, w, h, r) {
    // the pylon's price board: black panel, fuel grades on white strips, red LED digits
    g.fillStyle = '#1c1c1e';
    g.fillRect(0, 0, w, h);
    const rows = [['REGULAR', '3.89'], ['PLUS', '4.09'], ['DIESEL', '4.39']];
    rows.forEach(([n, p], i) => {
      const y = 22 + i * 76;
      g.fillStyle = '#f0ece0';
      g.fillRect(12, y, w - 24, 22);
      fit(g, n, w / 2, y + 12, w * 0.8, 18, { color: '#1a1a1a' });
      fit(g, p, w * 0.44, y + 48, w * 0.6, 40, { color: '#ff3a1a', font: COND });
      fit(g, '9', w * 0.82, y + 38, 20, 20, { color: '#ff3a1a' });
    });
    weather(g, w, h, r, 0.5);
  },
  mr_service(g, w, h, r) {
    g.fillStyle = '#1f5a34';
    g.fillRect(0, 0, w, h);
    fit(g, 'SERVICE  -  TOWING  -  TIRES', w / 2, h / 2, w * 0.92, h * 0.58, { color: '#f2ead6' });
    weather(g, w, h, r, 0.8);
  },
  mr_mart(g, w, h, r) {
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, w, h);
    fit(g, 'COLD BEER  *  ICE  *  BAIT  *  LOTTO', w / 2, h / 2, w * 0.94, h * 0.55, { color: '#fff' });
    weather(g, w, h, r, 0.6);
  },
  mr_shady(g, w, h, r) {
    board(g, w, h, '#2f4a3a', r, 3);
    g.strokeStyle = '#e8dcb0';
    g.lineWidth = 5;
    g.strokeRect(8, 8, w - 16, h - 16);
    fit(g, 'SHADY ACRES', w / 2, h * 0.4, w * 0.84, h * 0.4, { color: '#f4e8c0', font: SERIF });
    fit(g, 'MOBILE HOME PARK', w / 2, h * 0.74, w * 0.6, h * 0.18, { color: '#e8c060', font: SERIF });
    // two little pines
    for (const x of [w * 0.07, w * 0.93]) {
      g.fillStyle = '#e8dcb0';
      g.beginPath(); g.moveTo(x, h * 0.2); g.lineTo(x - 16, h * 0.72); g.lineTo(x + 16, h * 0.72); g.fill();
    }
    weather(g, w, h, r, 0.9);
  },
  mr_office(g, w, h, r) {
    board(g, w, h, '#e8e2d0', r, 1);
    fit(g, 'OFFICE', w / 2, h / 2, w * 0.7, h * 0.6, { color: '#2f4a3a', font: SERIF });
    weather(g, w, h, r, 0.6);
  },
  mr_slow(g, w, h, r) {
    g.fillStyle = '#f0d020';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 4;
    g.strokeRect(5, 5, w - 10, h - 10);
    fit(g, 'SLOW', w / 2, 30, w * 0.8, 28, { color: '#1a1a1a' });
    // a running child
    g.fillStyle = '#1a1a1a';
    g.beginPath(); g.arc(w / 2, 62, 8, 0, 6.3); g.fill();
    g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w / 2, 70); g.lineTo(w / 2 - 4, 98); g.moveTo(w / 2 - 4, 98); g.lineTo(w / 2 - 16, 118); g.moveTo(w / 2 - 4, 98); g.lineTo(w / 2 + 10, 116); g.moveTo(w / 2, 78); g.lineTo(w / 2 - 16, 88); g.moveTo(w / 2, 78); g.lineTo(w / 2 + 16, 86); g.stroke();
    fit(g, 'CHILDREN', w / 2, 138, w * 0.84, 18, { color: '#1a1a1a' });
    weather(g, w, h, r, 0.5);
  },
  mr_poolrules(g, w, h, r) {
    g.fillStyle = '#e8eef2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a4a8a';
    g.fillRect(0, 0, w, 30);
    fit(g, 'POOL RULES', w / 2, 16, w * 0.86, 20, { color: '#fff' });
    const lines = ['NO LIFEGUARD', 'NO DIVING', 'NO GLASS', 'SHOWER FIRST', 'CLOSED AT DUSK'];
    lines.forEach((t, i) => fit(g, t, w / 2, 48 + i * 26, w * 0.86, 14, { color: '#1a2a3a', font: COND }));
    weather(g, w, h, r, 0.8);
  },
  mr_ozzy(g, w, h, r) {
    board(g, w, h, '#3a3a3e', r, 2);
    paint(g, "OZZY'S", w / 2, h * 0.3, w * 0.8, h * 0.34, '#f0d060', r);
    paint(g, 'KEEP OUT', w / 2, h * 0.62, w * 0.7, h * 0.22, '#e84a3a', r);
    paint(g, 'W5-OZZ  144.390', w / 2, h * 0.86, w * 0.8, h * 0.14, '#d8d8d0', r, { drips: 0 });
    weather(g, w, h, r);
  },
  mr_haskell(g, w, h, r) {
    board(g, w, h, '#f0e8d0', r, 3);
    paint(g, 'HASKELL FARMS', w / 2, h * 0.42, w * 0.9, h * 0.46, '#7a2418', r, { font: SERIF, drips: 0 });
    paint(g, 'EST. 1952  -  SWEET CORN', w / 2, h * 0.8, w * 0.7, h * 0.18, '#3a4a2a', r, { font: SERIF, drips: 0 });
    weather(g, w, h, r, 0.8);
  },
  mr_closed(g, w, h, r) {
    g.fillStyle = '#f2f0e8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c62828';
    g.fillRect(0, 0, w, 58);
    fit(g, 'ROAD CLOSED', w / 2, 30, w * 0.9, 40, { color: '#fff' });
    fit(g, 'QUARANTINE ZONE', w / 2, 84, w * 0.9, 26, { color: '#1a1a1a' });
    fit(g, 'NO ENTRY - USE OF FORCE', w / 2, 116, w * 0.9, 16, { color: '#1a1a1a', font: COND });
    fit(g, 'AUTHORIZED', w / 2, 140, w * 0.9, 16, { color: '#1a1a1a', font: COND });
    g.fillStyle = '#1a1a1a';
    fit(g, 'BY ORDER OF THE GOVERNOR', w / 2, 170, w * 0.8, 12, { color: '#444', font: SERIF });
    weather(g, w, h, r, 0.7);
  },
  mr_millrd(g, w, h, r) {
    g.fillStyle = '#1e6a3a';
    rrect(g, 2, 2, w - 4, h - 4, 8);
    g.fill();
    g.strokeStyle = '#f0f0e8';
    g.lineWidth = 3;
    rrect(g, 6, 6, w - 12, h - 12, 6);
    g.stroke();
    fit(g, 'MILL RD', w / 2, h / 2, w * 0.8, h * 0.62, { color: '#f0f0e8', font: COND });
    weather(g, w, h, r, 0.4);
  },
  mr_gas2(g, w, h, r) { guide(g, w, h, r, ['MILL ROAD GAS', 'FOOD - DIESEL - 2 MI'], '#1e6a3a'); },
  mr_shadysign(g, w, h, r) { guide(g, w, h, r, ['SHADY ACRES', 'MOBILE HOME PARK ->'], '#6a4a2a'); },
  mr_rhsign(g, w, h, r) { guide(g, w, h, r, ['ROADHOUSE', 'MOTEL - DINER  1 MI'], '#8a2a4a'); },
  mr_deke(g, w, h, r) {
    board(g, w, h, '#b9955a', r, 3);
    paint(g, "DEKE'S - ALIVE", w / 2, h * 0.34, w * 0.9, h * 0.34, '#c62828', r);
    paint(g, 'HONK TWICE - NO BITES', w / 2, h * 0.72, w * 0.86, h * 0.2, '#1a1a1a', r);
    weather(g, w, h, r, 0.7);
  },
  mr_ambulance(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    fit(g, 'AMBULANCE', w / 2, h / 2, w * 0.9, h * 0.7, { color: '#c62828' });
    void r;
  },
  mr_flammable(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#d8281e';
    g.fillRect(-42, -42, 84, 84);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.strokeRect(-38, -38, 76, 76);
    g.restore();
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(w / 2, h * 0.26); g.quadraticCurveTo(w * 0.64, h * 0.42, w / 2 + 10, h * 0.52); g.quadraticCurveTo(w / 2, h * 0.5, w / 2 - 10, h * 0.54); g.quadraticCurveTo(w * 0.36, h * 0.4, w / 2, h * 0.26); g.fill();
    fit(g, 'FLAMMABLE', w / 2, h * 0.64, w * 0.5, 12, { color: '#fff' });
    fit(g, '3', w / 2, h * 0.78, 20, 16, { color: '#fff' });
    void r;
  },
  mr_wash(g, w, h, r) {
    g.fillStyle = '#1a6ab0';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(r() * w, r() * h, 3 + r() * 7, 0, 6.3); g.fill(); }
    fit(g, 'SUDS CAR WASH', w / 2, h / 2, w * 0.86, h * 0.6, { color: '#fff', stroke: '#0a3a70' });
    weather(g, w, h, r, 0.5);
  },
  mr_reefer(g, w, h, r) {
    g.fillStyle = '#e8e4da';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f8a4a';
    g.fillRect(0, h * 0.7, w, h * 0.12);
    fit(g, 'FRESH FIELDS', w * 0.42, h * 0.38, w * 0.7, h * 0.44, { color: '#2f8a4a', italic: true });
    fit(g, 'PRODUCE CO.', w * 0.86, h * 0.44, w * 0.24, h * 0.2, { color: '#1a4a2a' });
    weather(g, w, h, r, 0.6);
  },
  mr_agair(g, w, h, r) { g.clearRect(0, 0, w, h); fit(g, 'N4417K  AG-AIR', w / 2, h / 2, w * 0.9, h * 0.6, { color: '#1a1a1a', font: COND }); void r; },
  mr_harvest(g, w, h, r) { g.clearRect(0, 0, w, h); fit(g, 'HARVEST KING', w / 2, h / 2, w * 0.92, h * 0.8, { color: '#f0d020' }); void r; },
  mr_lotto(g, w, h, r) {
    g.fillStyle = '#f0d020';
    g.fillRect(0, 0, w, h);
    fit(g, 'LOTTO', w / 2, h * 0.42, w * 0.8, h * 0.5, { color: '#c62828' });
    fit(g, 'PLAY HERE', w / 2, h * 0.8, w * 0.6, h * 0.2, { color: '#1a1a1a' });
    void r;
  },
  mr_radio(g, w, h, r) {
    // Ozzy's rig: a rack of radios with dials, meters and green displays
    g.fillStyle = '#1a1c1e';
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 3; row++) {
      const y = 6 + row * 40;
      g.fillStyle = ['#3a3c40', '#2a2c30', '#4a4238'][row];
      g.fillRect(4, y, w - 8, 36);
      g.fillStyle = '#0c2a14';
      g.fillRect(14, y + 8, 60, 16);
      fit(g, ['144.390', '7.200 LSB', 'CH 19'][row], 44, y + 16, 56, 12, { color: '#6aff8a', font: COND });
      for (let k = 0; k < 5; k++) {
        g.fillStyle = '#c8c4b8';
        g.beginPath(); g.arc(96 + k * 30, y + 18, 9, 0, 6.3); g.fill();
        g.strokeStyle = '#1a1a1a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(96 + k * 30, y + 18); g.lineTo(96 + k * 30 + Math.cos(r() * 6) * 8, y + 18 + Math.sin(r() * 6) * 8); g.stroke();
      }
    }
  },
  mr_parkmap(g, w, h, r) {
    g.fillStyle = '#e8e2d0';
    g.fillRect(0, 0, w, h);
    fit(g, 'SHADY ACRES - SITE MAP', w / 2, 14, w * 0.9, 14, { color: '#2f4a3a' });
    g.fillStyle = '#9a9488';
    g.fillRect(20, 40, w - 40, 12); g.fillRect(20, 100, w - 40, 12); g.fillRect(20, 160, w - 40, 12); g.fillRect(20, 40, 12, 132); g.fillRect(w - 32, 40, 12, 132);
    g.fillStyle = '#c8b890';
    for (let i = 0; i < 18; i++) g.fillRect(40 + (i % 9) * 20, 58 + Math.floor(i / 9) * 60, 12, 36);
    g.fillStyle = '#4a8ac8';
    g.fillRect(w - 90, 118, 44, 32);
    g.fillStyle = '#c62828';
    g.beginPath(); g.arc(60, 150, 6, 0, 6.3); g.fill();
    fit(g, 'YOU ARE HERE', 90, 150, 60, 9, { color: '#c62828' });
    weather(g, w, h, r, 0.6);
  },
  mr_hours(g, w, h, r) {
    g.fillStyle = '#f2f0e8';
    g.fillRect(0, 0, w, h);
    fit(g, 'OPEN', w / 2, 22, w * 0.7, 26, { color: '#b3261e' });
    fit(g, '24 HOURS', w / 2, 52, w * 0.8, 18, { color: '#1a1a1a' });
    fit(g, 'WE ACCEPT', w / 2, 84, w * 0.7, 12, { color: '#444', font: COND });
    for (let k = 0; k < 3; k++) { g.fillStyle = ['#1a4a9a', '#c62828', '#e0a020'][k]; g.fillRect(18 + k * 32, 96, 26, 18); }
    void r;
  },
  mr_beer(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    fit(g, 'COLD BEER', w / 2, h / 2, w * 0.9, h * 0.7, { color: '#ff4a2a', stroke: '#ffd0c0', strokeW: 1 });
    void r;
  },
  mr_evac(g, w, h, r) {
    g.fillStyle = '#e8e4d8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a4a8a';
    g.fillRect(0, 0, w, 32);
    fit(g, 'EVACUATION ROUTE', w / 2, 17, w * 0.9, 20, { color: '#fff' });
    fit(g, 'I-44 WEST  ->  HARLAN', w / 2, 60, w * 0.9, 20, { color: '#1a1a1a', font: COND });
    fit(g, 'DO NOT STOP  -  DO NOT', w / 2, 88, w * 0.9, 14, { color: '#c62828', font: COND });
    fit(g, 'APPROACH THE INFECTED', w / 2, 106, w * 0.9, 14, { color: '#c62828', font: COND });
    weather(g, w, h, r, 0.7);
  },
  mr_tagx(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, 'EMPTY', w / 2, h / 2, w * 0.9, h * 0.7, '#e04a1a', r); },
};

function poster(g, w, h, r, title, color, l1, l2) {
  g.fillStyle = '#ece6d6';
  g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.fillRect(0, 0, w, 36);
  fit(g, title, w / 2, 19, w * 0.9, 26, { color: '#fff' });
  // a grey photo block
  g.fillStyle = '#8a8a86';
  g.fillRect(24, 46, w - 48, 72);
  g.fillStyle = '#5a5a58';
  g.beginPath(); g.arc(w / 2, 72, 16, 0, 6.3); g.fill();
  g.fillRect(w / 2 - 22, 90, 44, 28);
  fit(g, l1, w / 2, 134, w * 0.86, 13, { color: '#1a1a1a', font: COND });
  fit(g, l2, w / 2, 154, w * 0.86, 15, { color: '#1a1a1a' });
  for (let i = 0; i < 6; i++) { g.fillStyle = '#1a1a1a'; g.fillRect(8 + i * 20, h - 16, 2, 14); }
  weather(g, w, h, r, 0.9);
}

function guide(g, w, h, r, lines, color) {
  g.fillStyle = color;
  rrect(g, 2, 2, w - 4, h - 4, 10);
  g.fill();
  g.strokeStyle = '#f0f0e8';
  g.lineWidth = 3;
  rrect(g, 7, 7, w - 14, h - 14, 7);
  g.stroke();
  fit(g, lines[0], w / 2, h * 0.38, w * 0.86, h * 0.32, { color: '#f0f0e8', font: COND });
  fit(g, lines[1], w / 2, h * 0.7, w * 0.86, h * 0.2, { color: '#f0f0e8', font: COND });
  weather(g, w, h, r, 0.4);
}

function products(g, w, h, r, kind) {
  g.fillStyle = '#d8d4c8';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#7a7e82';
  g.fillRect(0, h - 6, w, 6);
  let x = 2;
  while (x < w - 4) {
    const gap = kind === 'looted' ? r() < 0.6 : r() < 0.08;
    const bw = kind === 'cans' ? 12 : kind === 'bottles' ? 10 : 18 + r() * 14;
    if (gap) { x += bw + 2; continue; }
    const bh = kind === 'cans' ? 22 + r() * 6 : kind === 'bottles' ? 34 + r() * 16 : 30 + r() * 24;
    const hue = ['#a8382e', '#3a5a94', '#c09030', '#3a7a4a', '#d8d4c8', '#5a3a6a', '#c0642c', '#2a2a2a', '#3a8a94', '#8a6a3a'][Math.floor(r() * 10)];
    const fallen = kind === 'looted' && r() < 0.4;
    g.save();
    g.translate(x + bw / 2, h - 6);
    if (fallen) g.rotate((r() - 0.5) * 1.4);
    g.fillStyle = hue;
    if (kind === 'bottles') {
      g.fillRect(-bw / 2, -bh, bw, bh * 0.75);
      g.fillRect(-bw / 5, -bh * 1.08, bw / 2.5, bh * 0.35);
    } else g.fillRect(-bw / 2, -bh, bw, bh);
    g.fillStyle = 'rgba(240,235,220,0.5)';
    g.fillRect(-bw / 2 + 2, -bh * 0.7, bw - 4, bh * 0.16);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-bw / 2 + 3, -bh * 0.4, bw - 6, 1.5);
    g.fillRect(-bw / 2 + 3, -bh * 0.3, (bw - 6) * 0.6, 1.2);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(bw / 2 - 3, -bh, 3, bh);
    g.restore();
    x += bw + 2;
  }
}

/** One corn plant (a clump of 2-3 stalks): long arching leaves, tassels on top, an ear or two. */
function cornPlant(g, w, h, r, v) {
  g.clearRect(0, 0, w, h);
  const stalks = 2 + (v === 1 ? 1 : 0);
  const late = v === 2;   // drier, more yellow
  for (let s = 0; s < stalks; s++) {
    const x0 = w * (0.3 + s * 0.2 + (r() - 0.5) * 0.1);
    const top = h * (0.04 + r() * 0.08);
    const lean = (r() - 0.5) * 24;
    const sc = (a, b) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * r())},${Math.round(a[1] + (b[1] - a[1]) * r())},${Math.round(a[2] + (b[2] - a[2]) * r())})`;
    const green = late ? [[150, 140, 60], [190, 170, 90]] : [[70, 110, 40], [120, 150, 60]];
    // the stalk: tapering, jointed
    g.strokeStyle = sc(...green);
    g.lineCap = 'round';
    for (let k = 0; k < 10; k++) {
      const y0 = h - (h - top) * (k / 10), y1 = h - (h - top) * ((k + 1) / 10);
      g.lineWidth = 9 - k * 0.6;
      g.beginPath(); g.moveTo(x0 + lean * (k / 10), y0); g.lineTo(x0 + lean * ((k + 1) / 10), y1); g.stroke();
    }
    // the leaves: long blades arching out and drooping, alternating sides
    for (let k = 0; k < 9; k++) {
      const t = 0.12 + k * 0.095;
      const y = h - (h - top) * t, x = x0 + lean * t;
      const side = (k + s) % 2 ? 1 : -1;
      const len = w * (0.32 + r() * 0.22) * (1 - t * 0.35);
      const lift = h * (0.06 + r() * 0.06);
      const droop = h * (0.1 + r() * 0.14);
      const wid = 6 + r() * 4;
      g.fillStyle = sc(...(late && r() < 0.4 ? [[170, 150, 80], [210, 190, 120]] : green));
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + side * len * 0.45, y - lift - wid, x + side * len, y + droop);
      g.quadraticCurveTo(x + side * len * 0.45, y - lift + wid * 0.6, x, y + wid);
      g.fill();
      // the midrib
      g.strokeStyle = 'rgba(230,230,180,0.35)';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y + wid * 0.4); g.quadraticCurveTo(x + side * len * 0.45, y - lift, x + side * len * 0.95, y + droop * 0.95); g.stroke();
    }
    // an ear in its husk with silk
    for (let e = 0; e < (s === 0 ? 2 : 1); e++) {
      const t = 0.42 + e * 0.12 + r() * 0.05;
      const y = h - (h - top) * t, x = x0 + lean * t;
      const side = e % 2 ? 1 : -1;
      g.save();
      g.translate(x + side * 8, y);
      g.rotate(side * 0.35);
      g.fillStyle = late ? '#c8b070' : '#8aa850';
      g.beginPath(); g.ellipse(0, 0, 7, 22, 0, 0, 6.3); g.fill();
      g.fillStyle = '#b08040';
      for (let k = 0; k < 6; k++) g.fillRect(-2 + (r() - 0.5) * 6, -22 - k * 3, 1.5, 8);
      g.restore();
    }
    // the tassel
    g.strokeStyle = late ? '#c8a860' : '#c8b878';
    g.lineWidth = 2;
    const tx = x0 + lean, ty = top;
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + (k - 3) * 0.28;
      g.beginPath(); g.moveTo(tx, ty + 6); g.quadraticCurveTo(tx + Math.cos(a) * 14, ty + Math.sin(a) * 18, tx + Math.cos(a) * 22, ty + Math.sin(a) * 10 + 12); g.stroke();
    }
  }
}

function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  if (!cells) cells = pack();
  let seed = 23;
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

/**
 * Register more cells before the atlas is first painted (the other levels of this owner add theirs).
 * @param {object} sizes name → [w, h]
 * @param {object} painters name → fn(g, w, h, rng)
 */
export function addCells(sizes, painters) {
  if (canvas) return;
  for (const [k, v] of Object.entries(sizes)) if (!LV_CELLS[k]) LV_CELLS[k] = v;
  for (const [k, fn] of Object.entries(painters)) PAINT[k] = fn;
  cells = null;
}

/** Painting helpers for the cells other modules add. */
export const PAINTERS = { fit, rrect, weather, board, paint, spray, poster, guide, blood, FONT, COND, HAND, SERIF };

/** The atlas as a texture (a new texture per call, one shared canvas). */
export function makeLevelTexture(anisotropy = 8) {
  if (!canvas) canvas = paintAtlas();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
