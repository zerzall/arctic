// Westgate's picture atlas (render3d/levels/mall.js): the WESTGATE letters and the pylon, the shop and
// food-stall fascias, menus, neon, the department signs of Harrow's, the goods on the shelves (clothes,
// boxes, pills, phones, sports), the TV wall's screens and the security monitors, the car park's signs,
// posters and flyers, and the blood, grime, water stains and graffiti. Painted once per page on a canvas
// (hospital-kit.js createAtlas).

import { createAtlas, text, rrect, weather, panelSign, arrow, blood, graffiti, grime, FONT, SANS, HAND, SERIF } from './hospital-kit.js';

/** The shop fronts: fascia cell → [name, background, lettering, font, italic]. */
export const SHOPS = {
  g1: ['LUXE NAILS', '#d86a9a', '#fff4f8', SERIF, true],
  g2: ['PAGE TURNER BOOKS', '#1f4a3a', '#f0e6c8', SERIF, false],
  g3: ['GAMEZONE', '#101418', '#6cff4a', FONT, false],
  g4: ['OPTIX EYEWEAR', '#f2f0ea', '#1a2e5a', SANS, false],
  g5: ['TOY PLANET', '#f2c21a', '#d8231b', FONT, false],
  g6: ['CITY SPORTS', '#14305a', '#ffffff', FONT, true],
  up1: ['LITTLE STARS', '#6ab0e0', '#ffffff', FONT, false],
  up2: ['GOLDLEAF JEWELERS', '#121212', '#d8b25a', SERIF, false],
  up3: ['WESTGATE CINEMA 6', '#5a1420', '#f2d27a', FONT, false],
  phone: ['CELL CITY', '#f27a1a', '#ffffff', FONT, true],
  clothes: ['THREADS', '#2a2a2e', '#f4f0e8', SERIF, true],
};

/** The food stalls: name → [sign text, background, lettering, accent]. */
export const STALLS = {
  pizza: ['PIZZA NAPOLI', '#1f7a3a', '#ffffff', '#d8231b'],
  wok: ['GOLDEN WOK', '#b3120e', '#f7d24a', '#f7d24a'],
  burger: ['BIG BUN BURGERS', '#f2b21a', '#5a2a10', '#d8231b'],
  taco: ['TACO LOCO', '#1aa6a0', '#ffffff', '#e8288a'],
  coffee: ['BEAN THERE', '#4a2c1c', '#f0e2c8', '#c8883a'],
};

const CELLS = {
  white: [16, 16],
  // the big signs
  wg_logo: [1024, 176], wg_pylon: [256, 512], wg_banner: [192, 512], wg_directory: [256, 384], wg_harrows: [512, 112], wg_foodcourt: [512, 96],
  // fascias, stall signs, menus
  ...Object.fromEntries(Object.keys(SHOPS).map((k) => ['f_' + k, [384, 64]])),
  ...Object.fromEntries(Object.keys(STALLS).map((k) => ['st_' + k, [320, 72]])),
  mn_0: [320, 112], mn_1: [320, 112], mn_2: [320, 112],
  // neon (tubes painted white: the vertex colour tints them; dead ones are grey)
  n_open: [256, 96], n_sale: [256, 96], n_eat: [256, 96], n_star: [128, 128], n_cola: [256, 96],
  // posters and papers
  wg_sale: [128, 192], wg_poster1: [128, 192], wg_poster2: [128, 192], wg_poster3: [128, 192], wg_missing: [128, 160], wg_notice: [160, 128], wg_movie: [128, 192],
  // goods on the shelves and screens
  g_clothes: [256, 96], g_shoes: [256, 96], g_boxes: [256, 96], g_pharm: [256, 96], g_general: [256, 96], g_sport: [256, 128], g_phones: [256, 128],
  g_toys: [256, 96], g_frozen: [256, 96], g_cosmetics: [256, 96], g_guns: [256, 128],
  g_tv_on: [128, 80], g_tv_off: [128, 80], g_tv_static: [128, 80], wg_cctv: [256, 160], wg_cctv_off: [128, 80], wg_screen: [96, 64],
  // wayfinding and warnings
  wg_exit: [128, 48], wg_restroom: [256, 64], wg_parking: [256, 64], wg_deckb: [256, 64], wg_pay: [192, 64], wg_bay1: [128, 64], wg_bay2: [128, 64], wg_bay3: [128, 64],
  wg_nopark: [192, 64], wg_security: [256, 64], wg_staff: [192, 64], wg_pharmacy: [256, 64], wg_electronics: [256, 64], wg_sporting: [256, 64],
  wg_cosmetics: [256, 64], wg_fashion: [256, 64], wg_clearance: [192, 96], wg_level1: [96, 96], wg_level2: [96, 96], wg_caution: [256, 32],
  wg_cart: [192, 64], wg_height: [256, 48], wg_dock: [256, 64], wg_entry: [192, 64], wg_exitlane: [192, 64], wg_vent: [64, 64], wg_hazard: [64, 64],
  wg_grille: [128, 128], wg_letters: [512, 64],
  // blood, grime, graffiti
  blood_trail: [512, 128], blood_hand: [256, 256], blood_splat: [256, 256], blood_drip: [128, 256], blood_pool: [256, 256],
  grime: [256, 256], grime2: [256, 256], mold: [256, 256], wstain: [128, 256], mud: [256, 256],
  g_help: [256, 96], g_alive: [256, 96], g_dead: [256, 96], g_noentry: [256, 96], g_tally: [128, 96], g_arrow: [192, 96], g_looters: [256, 96],
};

/** Neon glyphs: a word drawn as a double stroke (the tube and its core). */
function neon(g, w, h, str, o = {}) {
  g.clearRect(0, 0, w, h);
  g.save();
  const size = Math.min(h * 0.7, w / (str.length * 0.62));
  g.font = `${o.italic ? 'italic ' : ''}bold ${size}px ${o.font || HAND}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = size * 0.16;
  g.strokeText(str, w / 2, h / 2);
  g.strokeStyle = '#fff';
  g.lineWidth = size * 0.07;
  g.strokeText(str, w / 2, h / 2);
  if (o.box) { g.lineWidth = size * 0.06; rrect(g, 6, 6, w - 12, h - 12, 12); g.stroke(); }
  g.restore();
}

/** A shelf of goods: rows of rectangles from a palette (shelf edges between). */
function shelfGoods(g, w, h, r, rows, o) {
  g.fillStyle = o.back || '#2a2622';
  g.fillRect(0, 0, w, h);
  const rh = h / rows;
  for (let j = 0; j < rows; j++) {
    let x = 2;
    while (x < w - 4) {
      const iw = o.w[0] + r() * (o.w[1] - o.w[0]);
      if (r() < (o.gap ?? 0.12)) { x += iw; continue; }          // taken
      const ih = rh * (o.h[0] + r() * (o.h[1] - o.h[0]));
      const c = o.pal[Math.floor(r() * o.pal.length)];
      g.fillStyle = c;
      const y = (j + 1) * rh - 4 - ih;
      if (o.round) { g.beginPath(); g.ellipse(x + iw / 2, y + ih / 2, iw / 2, ih / 2, 0, 0, 6.3); g.fill(); } else g.fillRect(x, y, iw - 1.5, ih);
      if (o.label) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + iw * 0.15, y + ih * 0.35, iw * 0.6, ih * 0.18); }
      if (o.band) { g.fillStyle = o.band[Math.floor(r() * o.band.length)]; g.fillRect(x, y + ih * 0.6, iw - 1.5, ih * 0.14); }
      x += iw;
    }
    g.fillStyle = o.shelf || '#8a8f94';
    g.fillRect(0, (j + 1) * rh - 4, w, 4);
  }
  weather(g, w, h, r, 0.4);
}

/** A TV screen: the emergency broadcast, static, or dark glass. */
function tv(g, w, h, r, kind) {
  if (kind === 'off') {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#1c2226'); grd.addColorStop(0.5, '#0a0c0e'); grd.addColorStop(1, '#14181b');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.moveTo(w * 0.1, 0); g.lineTo(w * 0.4, 0); g.lineTo(w * 0.15, h); g.lineTo(0, h); g.fill();
    return;
  }
  if (kind === 'static') {
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const v = (r() * 200) | 0; g.fillStyle = `rgb(${v},${v},${v + 10})`; g.fillRect(x, y, 2, 2); }
    return;
  }
  g.fillStyle = '#0a2a6a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d8231b'; g.fillRect(0, h * 0.12, w, h * 0.2);
  text(g, 'EMERGENCY ALERT', w / 2, h * 0.22, w * 0.9, h * 0.15, { color: '#fff', font: FONT });
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(w * 0.1, h * (0.42 + i * 0.1), w * (0.5 + r() * 0.3), h * 0.04); }
  g.fillStyle = '#f2c21a'; g.fillRect(0, h * 0.86, w, h * 0.14);
  text(g, 'STAY INDOORS · AVOID CONTACT', w / 2, h * 0.93, w * 0.95, h * 0.1, { color: '#111', font: SANS });
}

function poster(g, w, h, r, o) {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, o.c0); grd.addColorStop(1, o.c1);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  if (o.figure) {
    g.fillStyle = o.figure;
    g.beginPath(); g.ellipse(w / 2, h * 0.38, w * 0.14, h * 0.1, 0, 0, 6.3); g.fill();
    g.beginPath(); g.moveTo(w * 0.22, h * 0.78); g.quadraticCurveTo(w / 2, h * 0.36, w * 0.78, h * 0.78); g.fill();
  }
  text(g, o.title, w / 2, h * 0.12, w * 0.9, h * 0.12, { color: o.fg || '#fff', font: o.font || FONT });
  if (o.sub) text(g, o.sub, w / 2, h * 0.88, w * 0.85, h * 0.07, { color: o.fg || '#fff', font: SANS, weight: 'normal' });
  weather(g, w, h, r, 0.8);
}

function paint(g, name, w, h, r) {
  if (name.startsWith('f_')) {
    const [str, bg, fg, font, italic] = SHOPS[name.slice(2)];
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 4, w, 4);
    text(g, str, w / 2, h / 2 + 1, w * 0.9, h * 0.6, { color: fg, font, italic });
    weather(g, w, h, r, 0.5);
    return;
  }
  if (name.startsWith('st_')) {
    const [str, bg, fg, acc] = STALLS[name.slice(3)];
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = acc; g.fillRect(0, h - 10, w, 6); g.fillRect(0, 4, w, 4);
    text(g, str, w / 2, h / 2, w * 0.86, h * 0.56, { color: fg, font: FONT, stroke: 'rgba(0,0,0,0.35)' });
    weather(g, w, h, r, 0.4);
    return;
  }
  if (name.startsWith('mn_')) {
    g.fillStyle = '#16181a'; g.fillRect(0, 0, w, h);
    const k = +name.slice(3);
    for (let c = 0; c < 3; c++) {
      const x = 8 + c * (w - 16) / 3;
      g.fillStyle = ['#c8783a', '#d8b04a', '#b8402a', '#6a9a3a'][(c + k) % 4];
      rrect(g, x + 4, 8, (w - 16) / 3 - 8, h * 0.42, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(x + (w - 16) / 6, 8 + h * 0.21, 20, 12, 0, 0, 6.3); g.fill();
      for (let i = 0; i < 3; i++) {
        g.fillStyle = 'rgba(240,236,224,0.85)'; g.fillRect(x + 6, h * (0.6 + i * 0.12), (w - 16) / 3 * 0.55, 3);
        text(g, '$' + (3 + ((c * 3 + i + k) % 7)) + '.99', x + (w - 16) / 3 - 22, h * (0.6 + i * 0.12) + 2, 36, 10, { color: '#f2c21a', font: SANS });
      }
    }
    weather(g, w, h, r, 0.3);
    return;
  }
  switch (name) {
    case 'white': g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); return;
    case 'wg_logo': {
      // channel letters on a dark band (the band is the façade's; the letters carry the lit face)
      g.clearRect(0, 0, w, h);
      g.save();
      g.font = `bold ${h * 0.72}px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#f4f0e6';
      g.fillText('WESTGATE', w * 0.56, h * 0.54);
      g.restore();
      // the star mark
      g.save();
      g.translate(w * 0.08, h * 0.5);
      g.fillStyle = '#e8b83a';
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? h * 0.17 : h * 0.4; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
      g.restore();
      return;
    }
    case 'wg_letters': text(g, 'SHOPPING · DINING · CINEMA', w / 2, h / 2, w * 0.95, h * 0.6, { color: '#f4f0e6', font: SANS }); return;
    case 'wg_pylon': {
      g.fillStyle = '#23262b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#b33a2a'; g.fillRect(8, 8, w - 16, h * 0.2);
      text(g, 'WESTGATE', w / 2, h * 0.12, w * 0.86, h * 0.1, { color: '#fff', font: FONT });
      text(g, 'MALL', w / 2, h * 0.19, w * 0.4, h * 0.05, { color: '#f2d27a', font: SANS });
      const ten = ["HARROW'S", 'FOOD COURT', 'CINEMA 6', 'CITY SPORTS', 'CELL CITY', 'TOY PLANET', 'OPEN 7 DAYS'];
      ten.forEach((t, i) => {
        const y = h * 0.24 + i * h * 0.105;
        g.fillStyle = i === 6 ? '#b33a2a' : '#f0ece2'; g.fillRect(10, y, w - 20, h * 0.09);
        text(g, t, w / 2, y + h * 0.045, w * 0.8, h * 0.055, { color: i === 6 ? '#fff' : '#1a1c20', font: i % 2 ? SANS : FONT });
      });
      weather(g, w, h, r, 0.7);
      return;
    }
    case 'wg_banner': {
      g.fillStyle = '#c8231b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#f2c21a'; g.fillRect(0, h * 0.62, w, h * 0.2);
      text(g, 'SUMMER', w / 2, h * 0.16, w * 0.86, h * 0.1, { color: '#fff', font: FONT });
      text(g, 'SALE', w / 2, h * 0.34, w * 0.86, h * 0.2, { color: '#fff', font: FONT });
      text(g, 'UP TO', w / 2, h * 0.52, w * 0.6, h * 0.06, { color: '#fff', font: SANS });
      text(g, '70% OFF', w / 2, h * 0.72, w * 0.9, h * 0.12, { color: '#c8231b', font: FONT });
      text(g, 'WESTGATE', w / 2, h * 0.92, w * 0.7, h * 0.05, { color: '#fff', font: SANS });
      weather(g, w, h, r, 0.5);
      return;
    }
    case 'wg_directory': {
      g.fillStyle = '#1d2a3a'; g.fillRect(0, 0, w, h);
      text(g, 'DIRECTORY', w / 2, h * 0.06, w * 0.8, h * 0.06, { color: '#fff', font: FONT });
      const cols = ['#d86a9a', '#3a8a5a', '#e8b83a', '#4a7ab0', '#c8583a', '#8a6ab0'];
      for (let i = 0; i < 16; i++) {
        g.fillStyle = cols[i % cols.length];
        g.fillRect(16 + (i % 4) * 56, h * 0.12 + Math.floor(i / 4) * 44, 50, 38);
      }
      g.fillStyle = '#d8231b'; g.beginPath(); g.arc(w * 0.3, h * 0.36, 7, 0, 6.3); g.fill();
      text(g, 'YOU ARE HERE', w * 0.3, h * 0.4, 100, 12, { color: '#fff', font: SANS });
      for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(16, h * 0.6 + i * 12, 60 + r() * 120, 4); }
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'wg_harrows': {
      g.clearRect(0, 0, w, h);
      text(g, "Harrow's", w / 2, h * 0.5, w * 0.95, h * 0.9, { color: '#f4f0e6', font: SERIF, italic: true });
      return;
    }
    case 'wg_foodcourt': {
      g.fillStyle = '#2a3a4a'; g.fillRect(0, 0, w, h);
      text(g, 'FOOD COURT', w / 2, h / 2 + 2, w * 0.9, h * 0.62, { color: '#f7d24a', font: FONT });
      weather(g, w, h, r, 0.4);
      return;
    }
    case 'n_open': return neon(g, w, h, 'OPEN', { box: true, font: FONT });
    case 'n_sale': return neon(g, w, h, 'SALE', { italic: true });
    case 'n_eat': return neon(g, w, h, 'EAT', { font: FONT, box: true });
    case 'n_cola': return neon(g, w, h, 'Cool Cola', { italic: true });
    case 'n_star': {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? w * 0.18 : w * 0.42; g.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr); }
      g.stroke();
      return;
    }
    case 'wg_sale': return poster(g, w, h, r, { c0: '#d8231b', c1: '#8a1210', title: 'SALE', sub: 'EVERYTHING MUST GO', fg: '#fff' });
    case 'wg_poster1': return poster(g, w, h, r, { c0: '#e8d8c8', c1: '#b89a88', title: 'NEW SEASON', sub: 'THREADS', fg: '#2a2a2e', figure: '#3a2a2a', font: SERIF });
    case 'wg_poster2': return poster(g, w, h, r, { c0: '#2a6ab0', c1: '#122a4a', title: 'GO FURTHER', sub: 'CITY SPORTS', figure: '#f2c21a' });
    case 'wg_poster3': return poster(g, w, h, r, { c0: '#f2c21a', c1: '#e87a1a', title: 'SUPER PHONE X', sub: 'CELL CITY', fg: '#1a1a1a', figure: '#1a1a1a' });
    case 'wg_movie': return poster(g, w, h, r, { c0: '#101418', c1: '#3a1010', title: 'NIGHTFALL', sub: 'IN CINEMAS NOW', fg: '#e8d8a8', figure: '#5a1a1a' });
    case 'wg_missing': {
      g.fillStyle = '#f0ece0'; g.fillRect(0, 0, w, h);
      text(g, 'MISSING', w / 2, h * 0.1, w * 0.9, h * 0.12, { color: '#b3120e', font: FONT });
      g.fillStyle = '#8a8a86'; g.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.42);
      g.fillStyle = '#5a5a56'; g.beginPath(); g.ellipse(w / 2, h * 0.36, w * 0.13, h * 0.09, 0, 0, 6.3); g.fill();
      g.fillRect(w * 0.3, h * 0.47, w * 0.4, h * 0.15);
      for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(30,30,40,0.7)'; g.fillRect(w * 0.12, h * (0.7 + i * 0.05), w * (0.5 + r() * 0.3), 2); }
      text(g, 'HAVE YOU SEEN HER?', w / 2, h * 0.94, w * 0.9, h * 0.05, { color: '#1a1a1a', font: HAND });
      weather(g, w, h, r, 1);
      return;
    }
    case 'wg_notice': {
      g.fillStyle = '#f4f0e2'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d4f8a'; g.fillRect(0, 0, w, h * 0.18);
      text(g, 'EVACUATION NOTICE', w / 2, h * 0.09, w * 0.9, h * 0.12, { color: '#fff', font: SANS });
      for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(30,30,40,0.6)'; g.fillRect(w * 0.08, h * (0.26 + i * 0.07), w * (0.55 + r() * 0.35), 2); }
      text(g, 'BUS: RIVERSIDE ARENA', w / 2, h * 0.92, w * 0.9, h * 0.07, { color: '#b3120e', font: SANS });
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'g_clothes': return shelfGoods(g, w, h, r, 3, { w: [18, 30], h: [0.25, 0.55], pal: ['#2a3a5a', '#8a2a2a', '#d8d0c0', '#3a5a3a', '#1a1a1a', '#b89a78', '#6a7a9a'], back: '#d8d4cc', shelf: '#b8b0a4', gap: 0.08 });
    case 'g_shoes': return shelfGoods(g, w, h, r, 4, { w: [22, 30], h: [0.4, 0.5], pal: ['#e8e4d8', '#f27a1a', '#1a1a1a', '#b8402a', '#4a7ab0'], band: ['#fff', '#1a1a1a'], back: '#e8e4dc', gap: 0.15 });
    case 'g_boxes': return shelfGoods(g, w, h, r, 3, { w: [26, 44], h: [0.5, 0.85], pal: ['#b89a6a', '#c8a878', '#a88858', '#d8c8a8'], label: true, back: '#1a1816', shelf: '#e87a1a', gap: 0.18 });
    case 'g_pharm': return shelfGoods(g, w, h, r, 4, { w: [10, 18], h: [0.35, 0.65], pal: ['#f4f4f0', '#e8eef4', '#f0f0e8'], band: ['#d8231b', '#2a6ab0', '#3a9a5a', '#e8b83a', '#8a3ab0'], back: '#e0e0da', shelf: '#c8c8c0', gap: 0.2 });
    case 'g_general': return shelfGoods(g, w, h, r, 4, { w: [10, 22], h: [0.4, 0.8], pal: ['#d8231b', '#f2c21a', '#2a6ab0', '#3a9a5a', '#e87a1a', '#f4f0e8', '#8a3ab0', '#6a3a1a'], label: true, back: '#e8e6e0', shelf: '#b8bcc0', gap: 0.22 });
    case 'g_toys': return shelfGoods(g, w, h, r, 3, { w: [20, 40], h: [0.4, 0.8], pal: ['#f2c21a', '#d8231b', '#2a8ad8', '#3aba5a', '#e8288a', '#8a3ab0'], label: true, back: '#f0f0ec', gap: 0.2 });
    case 'g_frozen': return shelfGoods(g, w, h, r, 3, { w: [22, 34], h: [0.4, 0.7], pal: ['#c8d8e8', '#e8e8f0', '#a8c0d8', '#d8a878', '#b8c8a8'], label: true, back: '#98a8b8', shelf: '#e8f0f8', gap: 0.25 });
    case 'g_cosmetics': return shelfGoods(g, w, h, r, 3, { w: [6, 12], h: [0.3, 0.6], pal: ['#f4d8e0', '#1a1a1a', '#d8b25a', '#f4f0e8', '#c8284a', '#8a4a6a'], back: '#f4f0ec', shelf: '#e8e0d8', gap: 0.15 });
    case 'g_sport': {
      g.fillStyle = '#c8c4bc'; g.fillRect(0, 0, w, h);
      for (let y = 8; y < h; y += 16) { g.fillStyle = '#a8a49c'; g.fillRect(0, y, w, 3); }
      for (let i = 0; i < 9; i++) {
        const x = 16 + i * 27, y = 20 + (i % 3) * 36;
        g.fillStyle = ['#f27a1a', '#f4f0e8', '#1a1a1a', '#e8e41a'][i % 4];
        g.beginPath(); g.arc(x, y, 11, 0, 6.3); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 11, 0.3, 2.6); g.stroke();
      }
      for (let i = 0; i < 5; i++) { g.fillStyle = ['#8a5a2a', '#2a2a2a', '#b8b8c0'][i % 3]; g.save(); g.translate(40 + i * 45, h * 0.75); g.rotate(-0.5 + i * 0.2); g.fillRect(-3, -30, 6, 60); g.restore(); }
      weather(g, w, h, r, 0.4);
      return;
    }
    case 'g_phones': {
      g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h);
      for (let j = 0; j < 3; j++) for (let i = 0; i < 8; i++) {
        const x = 10 + i * 30, y = 10 + j * 40;
        if (r() < 0.3) { g.fillStyle = '#d8d8d4'; g.fillRect(x + 6, y + 28, 12, 3); continue; }   // the dummy's been taken
        g.fillStyle = '#1a1c20'; rrect(g, x, y, 22, 34, 4); g.fill();
        g.fillStyle = ['#2a4a7a', '#3a6a5a', '#6a3a7a', '#1a1a1a'][(i + j) % 4]; g.fillRect(x + 2, y + 3, 18, 27);
      }
      weather(g, w, h, r, 0.3);
      return;
    }
    case 'g_guns': {
      g.fillStyle = '#5a4a3a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        const x = 16 + i * 34;
        if (r() < 0.55) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, 10, 6, h - 20); continue; }   // looted
        g.fillStyle = '#1a1a1a'; g.fillRect(x, 10, 6, h - 30);
        g.fillStyle = '#6a4a2a'; g.fillRect(x - 2, h - 34, 10, 26);
      }
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'g_tv_on': return tv(g, w, h, r, 'on');
    case 'g_tv_off': return tv(g, w, h, r, 'off');
    case 'g_tv_static': return tv(g, w, h, r, 'static');
    case 'wg_cctv': {
      g.fillStyle = '#0a0c0e'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 4; k++) {
        const x = (k % 2) * w / 2, y = Math.floor(k / 2) * h / 2;
        const grd = g.createLinearGradient(x, y, x, y + h / 2);
        grd.addColorStop(0, '#5a6a64'); grd.addColorStop(1, '#2a302e');
        g.fillStyle = grd; g.fillRect(x + 2, y + 2, w / 2 - 4, h / 2 - 4);
        // a corridor in perspective, figures
        g.strokeStyle = 'rgba(200,220,210,0.4)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + 4, y + h / 2 - 4); g.lineTo(x + w / 4 - 10, y + h / 4); g.lineTo(x + w / 4 + 10, y + h / 4); g.lineTo(x + w / 2 - 4, y + h / 2 - 4); g.stroke();
        for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(20,24,22,0.9)'; g.fillRect(x + 20 + r() * (w / 2 - 40), y + h / 4 + r() * 10, 5, 14); }
        text(g, 'CAM 0' + (k + 1), x + 26, y + 10, 44, 9, { color: '#e8f0e8', font: SANS, align: 'left' });
      }
      return;
    }
    case 'wg_cctv_off': return tv(g, w, h, r, 'off');
    case 'wg_screen': {
      g.fillStyle = '#0a1a2a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d6ab0'; g.fillRect(4, 4, w - 8, 10);
      for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(200,220,255,0.6)'; g.fillRect(6, 20 + i * 8, 30 + r() * 40, 3); }
      return;
    }
    case 'wg_exit': {
      g.fillStyle = '#0f7a34'; rrect(g, 1, 1, w - 2, h - 2, 5); g.fill();
      text(g, 'EXIT', w / 2 + 12, h / 2 + 1, w * 0.56, h * 0.62, { color: '#e8fff0', font: FONT });
      arrow(g, 20, h / 2, 12, 'l', '#e8fff0');
      return;
    }
    case 'wg_restroom': return panelSign(g, w, h, r, { bg: '#1d2a3a', text: 'RESTROOMS', sub: 'TELEPHONES · ATM', arrow: 'r' });
    case 'wg_parking': return panelSign(g, w, h, r, { bg: '#1d4f8a', text: 'PARKING', sub: 'LEVELS A · B', arrow: 'u' });
    case 'wg_deckb': return panelSign(g, w, h, r, { bg: '#1d4f8a', text: 'DECK B', sub: 'ROOF PARKING', arrow: 'r' });
    case 'wg_pay': return panelSign(g, w, h, r, { bg: '#f2c21a', fg: '#1a1a1a', text: 'PAY HERE', sub: 'CASH · CARDS', fg2: '#1a1a1a' });
    case 'wg_bay1': case 'wg_bay2': case 'wg_bay3': {
      g.fillStyle = '#f2c21a'; g.fillRect(0, 0, w, h);
      text(g, 'BAY ' + name.slice(-1), w / 2, h / 2 + 2, w * 0.8, h * 0.62, { color: '#111', font: FONT });
      weather(g, w, h, r, 0.9);
      return;
    }
    case 'wg_nopark': return panelSign(g, w, h, r, { bg: '#b3120e', text: 'NO PARKING', sub: 'LOADING ZONE' });
    case 'wg_security': return panelSign(g, w, h, r, { bg: '#1a1c20', text: 'SECURITY', sub: 'MALL OFFICE · STAFF ONLY' });
    case 'wg_staff': return panelSign(g, w, h, r, { bg: '#5a5e62', text: 'STAFF ONLY' });
    case 'wg_pharmacy': return panelSign(g, w, h, r, { bg: '#1f7a3a', text: 'PHARMACY', sub: 'PRESCRIPTIONS', icon: (gg, x, y, s) => { gg.fillStyle = '#fff'; gg.fillRect(x + s * 0.34, y, s * 0.32, s); gg.fillRect(x, y + s * 0.34, s, s * 0.32); } });
    case 'wg_electronics': return panelSign(g, w, h, r, { bg: '#1a1c20', text: 'ELECTRONICS', sub: 'TV · AUDIO · PHONES' });
    case 'wg_sporting': return panelSign(g, w, h, r, { bg: '#14305a', text: 'SPORTING GOODS', sub: 'OUTDOORS · CAMPING' });
    case 'wg_cosmetics': return panelSign(g, w, h, r, { bg: '#f4f0ea', fg: '#2a2a2e', fg2: '#6a6a6e', text: 'BEAUTY', sub: 'FRAGRANCE · COSMETICS', font: SERIF });
    case 'wg_fashion': return panelSign(g, w, h, r, { bg: '#2a2a2e', text: 'FASHION', sub: "WOMEN'S · MEN'S · KIDS", font: SERIF });
    case 'wg_clearance': {
      g.fillStyle = '#f2c21a'; g.fillRect(0, 0, w, h);
      text(g, 'CLEARANCE', w / 2, h * 0.34, w * 0.9, h * 0.34, { color: '#d8231b', font: FONT });
      text(g, 'ALL ITEMS 50%', w / 2, h * 0.72, w * 0.8, h * 0.22, { color: '#1a1a1a', font: SANS });
      weather(g, w, h, r, 0.5);
      return;
    }
    case 'wg_level1': case 'wg_level2': {
      g.fillStyle = name === 'wg_level1' ? '#2a6ab0' : '#c8583a'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, 6.3); g.fill();
      text(g, name === 'wg_level1' ? '1' : '2', w / 2, h / 2 + 3, w * 0.6, h * 0.7, { color: '#fff', font: FONT });
      return;
    }
    case 'wg_caution': {
      for (let x = -h; x < w + h; x += 24) { g.fillStyle = '#f2c21a'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 0); g.lineTo(x + 12 - h, h); g.lineTo(x - h, h); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.9)';
      for (let x = -h + 12; x < w + h; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 0); g.lineTo(x + 12 - h, h); g.lineTo(x - h, h); g.fill(); }
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'wg_cart': return panelSign(g, w, h, r, { bg: '#b33a2a', text: 'CART RETURN', sub: 'THANK YOU!' });
    case 'wg_height': return panelSign(g, w, h, r, { bg: '#f2c21a', fg: '#111', fg2: '#111', text: 'CLEARANCE 2.1 m', dirt: 0.8 });
    case 'wg_dock': return panelSign(g, w, h, r, { bg: '#5a5e62', text: 'LOADING DOCK', sub: 'DELIVERIES · NO PUBLIC ACCESS' });
    case 'wg_entry': return panelSign(g, w, h, r, { bg: '#1f7a3a', text: 'ENTRANCE', arrow: 'r' });
    case 'wg_exitlane': return panelSign(g, w, h, r, { bg: '#b3120e', text: 'EXIT', sub: 'PAY AT BOOTH', arrow: 'd' });
    case 'wg_vent': {
      g.fillStyle = '#6d7378'; g.fillRect(0, 0, w, h);
      for (let y = 6; y < h - 4; y += 8) { g.fillStyle = '#1a1c1e'; g.fillRect(6, y, w - 12, 4); }
      return;
    }
    case 'wg_hazard': {
      g.fillStyle = '#f2c21a'; g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w - 4, h - 6); g.lineTo(4, h - 6); g.closePath(); g.fill();
      text(g, '!', w / 2, h * 0.62, w * 0.3, h * 0.5, { color: '#111', font: FONT });
      return;
    }
    case 'wg_grille': {
      // a security grille: a lattice of bars (alpha between)
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#c8ccd0';
      for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h);
      for (let y = 0; y < h; y += 32) { g.fillRect(0, y, w, 4); }
      for (let x = 8; x < w; x += 16) for (let y = 16; y < h; y += 32) g.fillRect(x - 5, y - 1, 10, 3);
      return;
    }
    case 'blood_trail': return blood(g, w, h, r, 'trail');
    case 'blood_hand': return blood(g, w, h, r, 'hand');
    case 'blood_splat': return blood(g, w, h, r, 'splat');
    case 'blood_drip': return blood(g, w, h, r, 'drip');
    case 'blood_pool': return blood(g, w, h, r, 'pool');
    case 'grime': return grime(g, w, h, r);
    case 'grime2': return grime(g, w, h, r, '22,26,20');
    case 'mold': return grime(g, w, h, r, '34,44,24');
    case 'mud': return grime(g, w, h, r, '58,48,30');
    case 'wstain': {
      // water run down from a leak: streaks and a tide mark
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 18; i++) {
        const x = w * (0.15 + r() * 0.7), len = h * (0.3 + r() * 0.7), wd = 2 + r() * 8;
        const grd = g.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, 'rgba(60,50,30,0.35)'); grd.addColorStop(1, 'rgba(60,50,30,0)');
        g.fillStyle = grd; g.fillRect(x, 0, wd, len);
      }
      return;
    }
    case 'g_help': return graffiti(g, w, h, r, 'HELP US', '#d8231b');
    case 'g_alive': return graffiti(g, w, h, r, 'STILL ALIVE ↑', '#f4f0e8');
    case 'g_dead': return graffiti(g, w, h, r, 'DEAD INSIDE', '#d8231b');
    case 'g_noentry': return graffiti(g, w, h, r, 'DO NOT ENTER', '#f2c21a');
    case 'g_looters': return graffiti(g, w, h, r, 'LOOTERS SHOT', '#e8e8e8');
    case 'g_arrow': return graffiti(g, w, h, r, 'DOCK →', '#6cff4a');
    case 'g_tally': {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(230,230,220,0.9)'; g.lineWidth = 3;
      for (let k = 0; k < 4; k++) {
        const x0 = 8 + k * 30;
        for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x0 + i * 5, 20); g.lineTo(x0 + i * 5 + 1, 70); g.stroke(); }
        g.beginPath(); g.moveTo(x0 - 3, 60); g.lineTo(x0 + 22, 28); g.stroke();
      }
      return;
    }
    default:
      g.fillStyle = '#888'; g.fillRect(0, 0, w, h);
  }
}

/** Westgate's atlas (created once per page). */
export function mallAtlas() {
  return createAtlas('mall', CELLS, paint, 2048);
}
