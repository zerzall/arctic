// The picture atlas of agent C3's levels (Blackwater Dam, the Rail Yard, Fort Harlan): signs, stencils,
// plaques, relief lettering, control-panel mimics and screens, maps, notices, blood and graffiti. Painted
// once per page on a canvas (nothing is loaded from files); a fixed shelf packer lays the cells out, so a
// cell's uv rect never depends on what the browser could draw.
//
//   c3UV(name) → [u0, v0, u1, v1]     (texture flipY = true, like world-tex.js atlasUV)
//   makeC3Texture(aniso) → THREE.CanvasTexture (a new texture per renderer; one shared canvas)
//   C3_CELLS                          cell name → [w, h] in atlas pixels
//
// Cells whose name starts with 'e_' are drawn for the emissive bucket (screens, exit signs); 'd_' cells
// (blood, graffiti, water stains) for the blended stain bucket; the rest are lit, alpha-tested signs.

import * as THREE from 'three';

// (2048 × 4096: the three levels' cells come to ~6.2 Mpx; a 2048² sheet overflowed and the late cells
// sampled the clamped edge)
const AW = 2048, AH = 4096;
const FONT = '"Arial Black","Helvetica Neue",Arial,"DejaVu Sans","Liberation Sans",sans-serif';
const COND = '"Arial Narrow","Helvetica Neue",Arial,"DejaVu Sans Condensed","Liberation Sans Narrow",sans-serif';
const DECO = 'Futura,"Century Gothic","Trebuchet MS","DejaVu Sans","Liberation Sans",sans-serif';
const MONO = '"Courier New","DejaVu Sans Mono","Liberation Mono",monospace';
const HAND = '"Marker Felt","Comic Sans MS","Segoe Print","DejaVu Sans","Liberation Sans",sans-serif';
const SERIF = 'Georgia,"DejaVu Serif","Liberation Serif",serif';

/** Cell sizes (w, h) in atlas pixels, in packing order. */
export const C3_CELLS = {
  // ---- the dam
  damname: [1024, 112], dam1936: [256, 96], facename: [1024, 160], authority: [512, 96], elev: [192, 64],
  danger_spill: [320, 256], hv: [256, 192], auth: [384, 128], bridgeout: [320, 160], detour: [384, 128],
  hwy: [448, 224], damroad: [384, 128], powerhouse: [512, 112], gen1: [128, 128], gen2: [128, 128], gen3: [128, 128], gen4: [128, 128],
  control: [320, 80], nosmoke: [192, 128], hardhat: [256, 128], stairs: [320, 96], deep: [320, 160],
  gauge_level: [96, 768], mimic: [1024, 256], gauges: [512, 128], chart: [256, 128], mapdam: [512, 384], notices: [384, 256],
  welcome: [512, 192], depot: [768, 160], penstock: [256, 64], breaker: [256, 128], evac: [320, 224], radio: [256, 160],
  // ---- the rail yard
  yardname: [1024, 128], shed: [512, 112], signalbox: [512, 128], lever: [256, 64], overhead: [320, 192], track: [128, 128],
  cont0: [512, 96], cont1: [512, 96], cont2: [512, 96], cont3: [512, 96], wagon: [512, 96], loco: [256, 96], delta: [448, 192],
  speed15: [96, 128], whistle: [96, 128], trespass: [384, 160], bridgemp: [384, 96], diagram: [768, 256], timetable: [384, 256],
  // ---- the airbase
  basename: [1024, 160], restricted: [512, 256], hangar1: [256, 256], hangar2: [256, 256], hangar3: [256, 256], rwy27: [256, 256],
  taxi: [384, 96], hold: [256, 96], armory: [320, 96], mess: [320, 96], tower: [320, 96], barracks: [320, 96], insignia: [256, 256],
  usarmy: [512, 96], tail: [384, 96], fuel: [384, 160], quarantine: [768, 160], sandbag: [128, 64], motorpool: [320, 96], briefing: [512, 384],
  crashfire: [512, 96], rwy09: [256, 256], atc: [512, 96],
  // ---- shared: interior clutter and papers
  poster_a: [192, 256], poster_b: [192, 256], poster_c: [192, 256], calendar: [160, 224], clipboard: [128, 176], paper: [64, 64],
  exitdoor: [256, 96], firstaid: [128, 128], fireext: [128, 160], hazard: [256, 64], chevron: [256, 64], ammo: [256, 96],
  // ---- emissive
  e_crt1: [256, 192], e_crt2: [256, 192], e_crt3: [256, 192], e_exit: [256, 96], e_lamps: [512, 64], e_scope: [256, 256], e_panel: [512, 128],
  // ---- blended decals
  d_blood1: [256, 256], d_blood2: [256, 256], d_hand: [128, 128], d_drag: [512, 128], d_streak: [128, 512], d_moss: [256, 256],
  d_graf1: [512, 160], d_graf2: [512, 160], d_graf3: [512, 160], d_graf4: [384, 160], d_soot: [256, 256], d_rust: [128, 512],
};

let canvas = null;
let cells = null;

// First-fit decreasing-height shelf packing (a fixed order: height, then width, then name): each cell
// goes on the first shelf with room left, so short cells fill the ends of the tall shelves.
function pack() {
  const out = {};
  const list = Object.entries(C3_CELLS).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0] || (a[0] < b[0] ? -1 : 1));
  const shelves = [];
  let top = 0;
  for (const [k, [w, h]] of list) {
    let s = shelves.find((q) => q.x + w <= AW && h <= q.h);
    if (!s) { s = { y: top, h, x: 0 }; shelves.push(s); top += h + 2; }
    out[k] = [s.x, s.y, s.x + w, s.y + h];
    s.x += w + 2;
  }
  return out;
}

/** Cells the packer could not fit on the sheet (tests: must be none). */
export function c3CellsOutside() {
  if (!cells) cells = pack();
  return Object.keys(cells).filter((k) => cells[k][2] > AW || cells[k][3] > AH);
}

/** UV rect [u0, v0, u1, v1] of a cell (unknown names give the paper cell). */
export function c3UV(name) {
  if (!cells) cells = pack();
  const c = cells[name] || cells.paper;
  // half a texel in, so mipmaps never bleed the neighbour cell in
  return [(c[0] + 0.5) / AW, 1 - (c[3] - 0.5) / AH, (c[2] - 0.5) / AW, 1 - (c[1] + 0.5) / AH];
}

/** Aspect ratio w / h of a cell. */
export function c3Aspect(name) {
  const c = C3_CELLS[name] || C3_CELLS.paper;
  return c[0] / c[1];
}

// ---- painting helpers ---------------------------------------------------------------------------------

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

/** Text fitted into a box (shrinks to the width). */
function fit(g, str, cx, cy, w, h, o = {}) {
  const font = o.font || FONT;
  let size = Math.min(o.max || 999, h);
  const spec = (s) => `${o.italic ? 'italic ' : ''}${o.weight || 'bold'} ${s}px ${font}`;
  g.font = spec(size);
  const m = g.measureText(str).width + (o.track || 0) * str.length;
  if (m > w) { size = Math.max(4, size * (w / m)); g.font = spec(size); }
  g.textAlign = o.align || 'center';
  g.textBaseline = 'middle';
  if (o.track && 'letterSpacing' in g) g.letterSpacing = `${o.track * (size / Math.min(o.max || 999, h))}px`;
  if (o.shadow) { g.fillStyle = o.shadow; g.fillText(str, cx + size * 0.05, cy + size * 0.06); }
  if (o.stroke) { g.lineWidth = o.strokeW || Math.max(1, size * 0.1); g.strokeStyle = o.stroke; g.lineJoin = 'round'; g.strokeText(str, cx, cy); }
  g.fillStyle = o.color || '#fff';
  g.fillText(str, cx, cy);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return size;
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A sign plate: rounded rectangle, a border, bolt holes. */
function plate(g, w, h, bg, border = null, o = {}) {
  g.fillStyle = bg;
  rrect(g, 1, 1, w - 2, h - 2, o.r ?? Math.min(w, h) * 0.06);
  g.fill();
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = o.bw ?? Math.max(3, Math.min(w, h) * 0.035);
    rrect(g, o.inset ?? 7, o.inset ?? 7, w - 2 * (o.inset ?? 7), h - 2 * (o.inset ?? 7), o.r ?? Math.min(w, h) * 0.05);
    g.stroke();
  }
  if (o.bolts !== false) {
    g.fillStyle = 'rgba(40,36,30,0.55)';
    for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) { g.beginPath(); g.arc(x, y, 2.5, 0, 6.3); g.fill(); }
  }
}

/** Weathering: specks, a grime gradient, rust drips from the bolts (source-atop keeps the alpha). */
function weather(g, w, h, r, amount = 1, o = {}) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 120 * amount; i++) {
    g.fillStyle = `rgba(${r() < 0.55 ? '30,24,16' : '225,215,195'},${0.03 + r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 3);
  }
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(24,18,10,${0.3 * amount})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  if (o.drips !== false) {
    for (let i = 0; i < 5 * amount; i++) {
      const x = r() * w, y = r() * h * 0.5, l = 10 + r() * h * 0.5;
      const dg = g.createLinearGradient(0, y, 0, y + l);
      dg.addColorStop(0, `rgba(110,60,30,${0.25 + r() * 0.2})`);
      dg.addColorStop(1, 'rgba(110,60,30,0)');
      g.fillStyle = dg;
      g.fillRect(x, y, 1.5 + r() * 3, l);
    }
  }
  g.restore();
}

/** Diagonal hazard stripes over a rect. */
function stripes(g, x, y, w, h, a, b, step = 24) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = a;
  g.fillRect(x, y, w, h);
  g.fillStyle = b;
  for (let k = -h; k < w + h; k += step * 2) {
    g.beginPath();
    g.moveTo(x + k, y + h);
    g.lineTo(x + k + step, y + h);
    g.lineTo(x + k + step + h, y);
    g.lineTo(x + k + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** An arrow pointing right (flip with dir = -1) centred at (cx, cy), `s` long. */
function arrow(g, cx, cy, s, color, dir = 1) {
  g.save();
  g.translate(cx, cy);
  g.scale(dir, 1);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-s / 2, -s * 0.12);
  g.lineTo(s * 0.1, -s * 0.12);
  g.lineTo(s * 0.1, -s * 0.3);
  g.lineTo(s / 2, 0);
  g.lineTo(s * 0.1, s * 0.3);
  g.lineTo(s * 0.1, s * 0.12);
  g.lineTo(-s / 2, s * 0.12);
  g.closePath();
  g.fill();
  g.restore();
}

/** Stencilled lettering: the letters with the stencil bridges cut out. */
function stencil(g, str, cx, cy, w, h, color, o = {}) {
  const size = fit(g, str, cx, cy, w, h, { font: o.font || FONT, color, max: o.max, track: o.track });
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  const bars = Math.max(2, Math.round(w / (size * 0.62)));
  for (let i = 0; i < bars; i++) g.fillRect(cx - w / 2 + ((i + 0.5) / bars) * w - size * 0.03, cy - size * 0.05, size * 0.06, size * 0.1);
  g.restore();
}

/** Spray paint: soft overspray under a sharp line. */
function spray(g, str, cx, cy, w, h, color, r, o = {}) {
  g.save();
  const size = Math.min(h, o.max || 999);
  g.font = `bold ${size}px ${o.font || HAND}`;
  let m = g.measureText(str).width;
  const k = m > w ? w / m : 1;
  g.font = `bold ${size * k}px ${o.font || HAND}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.translate(cx, cy);
  g.rotate(o.tilt || 0);
  g.shadowColor = color;
  g.shadowBlur = size * k * 0.18;
  g.fillStyle = color;
  g.fillText(str, 0, 0);
  g.shadowBlur = 0;
  g.fillText(str, 0, 0);
  // drips
  m = g.measureText(str).width;
  for (let i = 0; i < 6; i++) {
    const x = (r() - 0.5) * m, l = size * k * (0.2 + r() * 0.6);
    g.fillRect(x, size * k * 0.25, Math.max(1.5, size * k * 0.04), l);
  }
  g.restore();
}

/** A blood splatter: a dark core, satellites, a few runs. */
function splat(g, w, h, r, o = {}) {
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * (o.cy ?? 0.5);
  const col = (a) => `rgba(${70 + r() * 30},${4 + r() * 8},${4 + r() * 6},${a})`;
  for (let i = 0; i < 14; i++) {
    const a = r() * 6.28, d = r() * w * 0.12, rr = w * (0.06 + r() * 0.12);
    g.fillStyle = col(0.75 + r() * 0.2);
    g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, rr * (0.6 + r() * 0.4), a, 0, 6.3); g.fill();
  }
  for (let i = 0; i < 60; i++) {
    const a = r() * 6.28, d = w * (0.15 + r() * 0.33), rr = 1 + r() * w * 0.02;
    g.fillStyle = col(0.6 + r() * 0.35);
    g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * (o.flat ?? 1), rr, 0, 6.3); g.fill();
  }
  if (o.runs) {
    for (let i = 0; i < 6; i++) {
      const x = cx + (r() - 0.5) * w * 0.35, l = h * (0.15 + r() * 0.35);
      g.fillStyle = col(0.7);
      g.fillRect(x, cy, 2 + r() * 4, l);
      g.beginPath(); g.arc(x + 2, cy + l, 3, 0, 6.3); g.fill();
    }
  }
}

// ---- the cells ---------------------------------------------------------------------------------------------

function sign(bg, fg, lines, o = {}) {
  return (g, w, h, r) => {
    plate(g, w, h, bg, o.border ?? fg, o);
    if (o.band) { g.fillStyle = o.band[0]; g.fillRect(8, 8, w - 16, h * o.band[1]); }
    const n = lines.length;
    const top = o.top ?? 0.1, bottom = o.bottom ?? 0.9;
    lines.forEach((ln, i) => {
      const [txt, col, scale] = Array.isArray(ln) ? ln : [ln, fg, 1];
      const y0 = top + ((bottom - top) * i) / n, y1 = top + ((bottom - top) * (i + 1)) / n;
      fit(g, txt, w / 2, h * (y0 + y1) / 2, w * 0.86, h * (y1 - y0) * 0.78 * scale, { color: col, font: o.font || FONT, max: o.max });
    });
    weather(g, w, h, r, o.wear ?? 1, o);
  };
}

function relief(str, color, o = {}) {
  // cast-bronze / concrete relief letters: a dark shadow, the face, a lit top edge (transparent ground)
  return (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const f = { font: o.font || DECO, max: h * 0.84, track: o.track ?? 10 };
    fit(g, str, w / 2 + 3, h / 2 + 4, w * 0.96, h * 0.84, { ...f, color: 'rgba(10,8,6,0.85)' });
    fit(g, str, w / 2, h / 2, w * 0.96, h * 0.84, { ...f, color });
    g.save();
    g.globalCompositeOperation = 'source-atop';
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,240,200,0.35)');
    grd.addColorStop(0.45, 'rgba(255,240,200,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.restore();
  };
}

function genNumber(n) {
  return (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e8b21a';
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, 6.3); g.fill();
    g.fillStyle = '#1a1a1a';
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.4, 0, 6.3); g.fill();
    stencil(g, String(n), w / 2, h / 2 + 4, w * 0.5, h * 0.62, '#e8b21a');
    weather(g, w, h, r, 0.6, { drips: false });
  };
}

function containerLogo(name, bg, fg, sub) {
  return (g, w, h, r) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    fit(g, name, w * 0.5, h * 0.42, w * 0.9, h * 0.58, { color: fg, font: FONT, track: 4 });
    fit(g, sub, w * 0.5, h * 0.82, w * 0.8, h * 0.18, { color: fg, font: MONO, weight: 'normal' });
    weather(g, w, h, r, 1.4);
  };
}

function crt(kind) {
  return (g, w, h, r) => {
    g.fillStyle = '#020604';
    g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    grd.addColorStop(0, 'rgba(40,110,60,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#6cff9a';
    g.font = `bold 13px ${MONO}`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    if (kind === 1) {
      const lines = ['BLACKWATER SCADA 3.1', 'RES EL   517.4 FT  !!', 'INFLOW   88400 CFS', 'SPILL    GATES CLOSED', 'UNIT 1   TRIP', 'UNIT 2   TRIP', 'UNIT 3   OFFLINE', 'UNIT 4   OFFLINE', '> ALARM: HIGH WATER', '> ACK?_'];
      lines.forEach((l, i) => { g.fillStyle = l.includes('!') || l.includes('ALARM') ? '#ff6a4a' : '#6cff9a'; g.fillText(l, 10, 8 + i * 17.5); });
    } else if (kind === 2) {
      g.strokeStyle = '#6cff9a';
      g.lineWidth = 2;
      g.strokeRect(12, 12, w - 24, h - 40);
      g.beginPath();
      for (let x = 0; x <= w - 24; x += 4) {
        const y = h - 40 - (x / (w - 24)) ** 1.6 * (h - 60) - Math.sin(x * 0.2) * 3;
        if (x === 0) g.moveTo(12 + x, y); else g.lineTo(12 + x, y);
      }
      g.stroke();
      g.fillStyle = '#ff6a4a';
      g.fillRect(12, 30, w - 24, 2);
      g.fillText('RESERVOIR 72H', 14, h - 24);
    } else {
      for (let i = 0; i < w * h / 6; i++) {
        const v = Math.floor(r() * 160);
        g.fillStyle = `rgb(${v * 0.5},${v},${v * 0.6})`;
        g.fillRect(r() * w, r() * h, 2, 1);
      }
      g.fillStyle = '#6cff9a';
      g.font = `bold 20px ${MONO}`;
      g.textAlign = 'center';
      g.fillText('NO SIGNAL', w / 2, h / 2 - 10);
    }
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  };
}

const PAINT = {
  // ---- dam
  damname: relief('BLACKWATER DAM', '#b8894a', { track: 18 }),
  dam1936: relief('1936', '#b8894a', { track: 12 }),
  facename: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    fit(g, 'BLACKWATER', w / 2, h / 2, w * 0.97, h * 0.9, { color: 'rgba(236,232,220,0.92)', font: DECO, track: 22 });
    g.save();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`; g.fillRect(r() * w, r() * h, 1 + r() * 7, 1 + r() * 3); }
    for (let i = 0; i < 40; i++) { const x = r() * w; g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, r() * h * 0.4, 2 + r() * 3, h); }
    g.restore();
  },
  authority: sign('#2f3a36', '#d8c9a0', [['HARLAN COUNTY WATER AUTHORITY', '#d8c9a0'], ['BLACKWATER PROJECT  ·  COMPLETED 1936', '#b8a878', 0.7]], { font: SERIF }),
  elev: sign('#e8e4d8', '#1a1a1a', ['EL. 520'], { border: null, bolts: false }),
  danger_spill: (g, w, h, r) => {
    plate(g, w, h, '#f2efe6', '#1a1a1a');
    g.fillStyle = '#c8161a';
    rrect(g, 16, 16, w - 32, h * 0.28, 14); g.fill();
    g.fillStyle = '#1a1a1a';
    rrect(g, 24, 22, w - 48, h * 0.28 - 12, 10); g.fill();
    g.fillStyle = '#c8161a';
    rrect(g, 28, 26, w - 56, h * 0.28 - 20, 8); g.fill();
    fit(g, 'DANGER', w / 2, 16 + h * 0.14, w * 0.7, h * 0.2, { color: '#fff' });
    fit(g, 'SPILLWAY', w / 2, h * 0.47, w * 0.84, h * 0.16, { color: '#1a1a1a' });
    fit(g, 'STAY CLEAR OF THE WATER', w / 2, h * 0.64, w * 0.84, h * 0.09, { color: '#1a1a1a' });
    fit(g, 'SIRENS MEAN RISING WATER', w / 2, h * 0.76, w * 0.84, h * 0.08, { color: '#c8161a' });
    fit(g, 'GATES MAY OPEN WITHOUT WARNING', w / 2, h * 0.87, w * 0.84, h * 0.07, { color: '#1a1a1a', font: COND });
    weather(g, w, h, r, 1.2);
  },
  hv: (g, w, h, r) => {
    plate(g, w, h, '#f2c21a', '#1a1a1a');
    g.fillStyle = '#1a1a1a';
    g.beginPath(); g.moveTo(w * 0.2, h * 0.12); g.lineTo(w * 0.4, h * 0.12); g.lineTo(w * 0.32, h * 0.34); g.lineTo(w * 0.42, h * 0.34); g.lineTo(w * 0.2, h * 0.62); g.lineTo(w * 0.27, h * 0.4); g.lineTo(w * 0.17, h * 0.4); g.closePath(); g.fill();
    fit(g, 'DANGER', w * 0.66, h * 0.22, w * 0.5, h * 0.2, { color: '#1a1a1a' });
    fit(g, 'HIGH', w * 0.66, h * 0.44, w * 0.5, h * 0.18, { color: '#1a1a1a' });
    fit(g, 'VOLTAGE', w / 2, h * 0.76, w * 0.84, h * 0.22, { color: '#1a1a1a' });
    weather(g, w, h, r);
  },
  auth: sign('#f2efe6', '#1f3a6a', [['AUTHORIZED', '#1f3a6a'], ['PERSONNEL ONLY', '#1f3a6a']], { band: ['#1f3a6a', 0.0] }),
  bridgeout: (g, w, h, r) => {
    plate(g, w, h, '#f07a1a', '#1a1a1a');
    fit(g, 'BRIDGE', w / 2, h * 0.34, w * 0.8, h * 0.3, { color: '#1a1a1a' });
    fit(g, 'OUT', w / 2, h * 0.68, w * 0.8, h * 0.34, { color: '#1a1a1a' });
    weather(g, w, h, r);
  },
  detour: (g, w, h, r) => {
    plate(g, w, h, '#f07a1a', '#1a1a1a');
    fit(g, 'DETOUR', w * 0.4, h * 0.32, w * 0.6, h * 0.3, { color: '#1a1a1a' });
    fit(g, 'DAM ROAD', w * 0.4, h * 0.7, w * 0.6, h * 0.28, { color: '#1a1a1a' });
    arrow(g, w * 0.83, h * 0.5, w * 0.24, '#1a1a1a', 1);
    weather(g, w, h, r);
  },
  hwy: (g, w, h, r) => {
    plate(g, w, h, '#1f6a3a', '#e8efe8', { r: 16 });
    fit(g, 'BLACKWATER', w * 0.42, h * 0.3, w * 0.62, h * 0.2, { color: '#f2f2ea', font: COND });
    fit(g, '3', w * 0.85, h * 0.3, w * 0.12, h * 0.2, { color: '#f2f2ea', font: COND });
    fit(g, 'HARLAN', w * 0.42, h * 0.56, w * 0.62, h * 0.2, { color: '#f2f2ea', font: COND });
    fit(g, '41', w * 0.85, h * 0.56, w * 0.14, h * 0.2, { color: '#f2f2ea', font: COND });
    fit(g, 'CHECKPOINT DELTA', w * 0.42, h * 0.8, w * 0.62, h * 0.17, { color: '#f2f2ea', font: COND });
    fit(g, '67', w * 0.85, h * 0.8, w * 0.14, h * 0.17, { color: '#f2f2ea', font: COND });
    weather(g, w, h, r, 0.8);
  },
  damroad: (g, w, h, r) => {
    plate(g, w, h, '#6b4a2c', '#f0e6c8', { r: 12 });
    fit(g, 'BLACKWATER DAM', w * 0.42, h * 0.38, w * 0.7, h * 0.34, { color: '#f0e6c8', font: SERIF });
    fit(g, 'VISITOR CENTER CLOSED', w * 0.42, h * 0.72, w * 0.7, h * 0.2, { color: '#e0d0a8', font: COND });
    arrow(g, w * 0.88, h * 0.5, w * 0.16, '#f0e6c8', 1);
    weather(g, w, h, r);
  },
  powerhouse: relief('POWERHOUSE', '#d8d2c2', { track: 16 }),
  gen1: genNumber(1), gen2: genNumber(2), gen3: genNumber(3), gen4: genNumber(4),
  control: sign('#2f3a36', '#e8e2d0', ['CONTROL ROOM'], { font: DECO }),
  nosmoke: (g, w, h, r) => {
    plate(g, w, h, '#f2efe6', '#1a1a1a');
    g.strokeStyle = '#c8161a'; g.lineWidth = 9;
    g.beginPath(); g.arc(w * 0.28, h * 0.5, h * 0.3, 0, 6.3); g.stroke();
    g.fillStyle = '#1a1a1a'; g.fillRect(w * 0.14, h * 0.46, w * 0.22, h * 0.08);
    g.strokeStyle = '#c8161a'; g.beginPath(); g.moveTo(w * 0.16, h * 0.28); g.lineTo(w * 0.4, h * 0.72); g.stroke();
    fit(g, 'NO', w * 0.72, h * 0.34, w * 0.4, h * 0.26, { color: '#c8161a' });
    fit(g, 'SMOKING', w * 0.72, h * 0.66, w * 0.44, h * 0.22, { color: '#1a1a1a' });
    weather(g, w, h, r, 0.7);
  },
  hardhat: sign('#1f4f9a', '#f2f2ea', ['HARD HAT', 'AREA']),
  stairs: (g, w, h, r) => {
    plate(g, w, h, '#2f3a36', '#e8e2d0');
    fit(g, 'STAIRS TO CREST', w * 0.44, h * 0.5, w * 0.66, h * 0.44, { color: '#e8e2d0', font: DECO });
    g.save(); g.translate(w * 0.87, h * 0.5); g.rotate(-Math.PI / 2); arrow(g, 0, 0, h * 0.62, '#e8e2d0'); g.restore();
    weather(g, w, h, r);
  },
  deep: sign('#f2efe6', '#1a1a1a', [['CAUTION', '#f2efe6', 1.1], ['DEEP WATER', '#1a1a1a'], ['STRONG CURRENTS', '#1a1a1a', 0.8]], { band: ['#e8b21a', 0.36] }),
  gauge_level: (g, w, h, r) => {
    g.fillStyle = '#f2efe6';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i <= 24; i++) {
      const y = (i / 24) * h;
      g.fillStyle = i % 2 ? '#1a1a1a' : '#c8161a';
      g.fillRect(0, y, i % 4 === 0 ? w * 0.55 : w * 0.3, 4);
      if (i % 4 === 0) fit(g, String(520 - i * 2), w * 0.78, y + 14, w * 0.4, 22, { color: '#1a1a1a', font: COND });
    }
    weather(g, w, h, r, 1.6);
  },
  mimic: (g, w, h, r) => {
    g.fillStyle = '#56615c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    // reservoir, dam, penstocks, four units, the spillway, the switchyard
    g.fillStyle = '#2f6a9a'; g.fillRect(20, 40, 200, 90);
    g.fillStyle = '#d8d2c2'; g.fillRect(220, 30, 26, 150);
    g.lineWidth = 6; g.strokeStyle = '#2f6a9a';
    for (let k = 0; k < 4; k++) {
      g.beginPath(); g.moveTo(246, 60 + k * 12); g.lineTo(330 + k * 130, 150); g.stroke();
      g.strokeStyle = '#d8d2c2'; g.lineWidth = 3;
      g.beginPath(); g.arc(360 + k * 130, 160, 26, 0, 6.3); g.stroke();
      g.fillStyle = '#1a1a1a'; fit(g, 'G' + (k + 1), 360 + k * 130, 160, 34, 20, { color: '#f2efe6' });
      g.lineWidth = 6; g.strokeStyle = '#2f6a9a';
    }
    g.fillStyle = '#f2efe6';
    fit(g, 'BLACKWATER HYDROELECTRIC  ·  STATION DIAGRAM', w * 0.62, 22, w * 0.7, 20, { color: '#f2efe6', font: COND });
    g.strokeStyle = '#e8b21a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(360, 190); g.lineTo(360, 225); g.lineTo(880, 225); g.lineTo(880, 190); g.stroke();
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(360 + k * 130, 186); g.lineTo(360 + k * 130, 225); g.stroke(); }
    // indicator lamps
    for (let k = 0; k < 18; k++) {
      const x = 60 + k * 52, y = h - 22;
      g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(x, y, 9, 0, 6.3); g.fill();
      g.fillStyle = r() < 0.4 ? '#ff4a3a' : r() < 0.6 ? '#4aff6a' : '#444';
      g.beginPath(); g.arc(x, y, 6, 0, 6.3); g.fill();
    }
    weather(g, w, h, r, 0.8, { drips: false });
  },
  gauges: (g, w, h, r) => {
    g.fillStyle = '#4a524e';
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) {
      const cx = 64 + k * 128, cy = h / 2;
      g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(cx, cy, 54, 0, 6.3); g.fill();
      g.fillStyle = '#efeadc'; g.beginPath(); g.arc(cx, cy, 48, 0, 6.3); g.fill();
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 2;
      for (let t = 0; t <= 10; t++) { const a = Math.PI * 0.75 + (t / 10) * Math.PI * 1.5; g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46); g.stroke(); }
      g.strokeStyle = '#c8161a'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, 43, Math.PI * 1.95, Math.PI * 2.25); g.stroke();
      const v = Math.PI * 0.75 + (0.2 + r() * 0.8) * Math.PI * 1.5;
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(v) * 38, cy + Math.sin(v) * 38); g.stroke();
    }
    weather(g, w, h, r, 0.6, { drips: false });
  },
  chart: (g, w, h, r) => {
    g.fillStyle = '#f2ede0';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,60,60,0.35)';
    for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#2a3a8a'; g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < w; x += 3) { const y = h * 0.7 - (x / w) ** 2 * h * 0.55 + Math.sin(x * 0.3) * 3 + r() * 2; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  },
  mapdam: (g, w, h, r) => {
    g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8fb2c8'; g.fillRect(0, 0, w, h * 0.3);
    g.strokeStyle = '#4a7aa0'; g.lineWidth = 34;
    g.beginPath(); g.moveTo(w * 0.52, h * 0.3); g.lineTo(w * 0.5, h * 0.7); g.quadraticCurveTo(w * 0.52, h * 0.86, w, h * 0.84); g.stroke();
    g.fillStyle = '#6a6a66'; g.fillRect(w * 0.3, h * 0.29, w * 0.4, 12);
    g.strokeStyle = '#a0522d'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, h * 0.84); g.lineTo(w * 0.3, h * 0.78); g.lineTo(w * 0.45, h * 0.74); g.stroke();
    g.strokeStyle = '#c8161a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(w * 0.44, h * 0.68); g.lineTo(w * 0.56, h * 0.8); g.moveTo(w * 0.56, h * 0.68); g.lineTo(w * 0.44, h * 0.8); g.stroke();
    g.setLineDash([10, 8]); g.strokeStyle = '#c8161a';
    g.beginPath(); g.moveTo(w * 0.1, h * 0.82); g.lineTo(w * 0.33, h * 0.5); g.lineTo(w * 0.33, h * 0.33); g.lineTo(w * 0.7, h * 0.33); g.lineTo(w * 0.7, h * 0.55); g.lineTo(w * 0.95, h * 0.62); g.stroke();
    g.setLineDash([]);
    for (const [x, y, c] of [[0.33, 0.5, '#c8161a'], [0.7, 0.4, '#1a6a3a'], [0.95, 0.62, '#1a3a8a']]) { g.fillStyle = c; g.beginPath(); g.arc(w * x, h * y, 8, 0, 6.3); g.fill(); }
    fit(g, 'DEPOT', w * 0.88, h * 0.55, 90, 20, { color: '#1a3a8a', font: HAND });
    fit(g, 'BRIDGE GONE', w * 0.5, h * 0.62, 160, 22, { color: '#c8161a', font: HAND });
    fit(g, 'BLACKWATER RESERVOIR', w * 0.5, h * 0.12, w * 0.6, 26, { color: '#2a4a6a', font: SERIF });
    weather(g, w, h, r, 0.6, { drips: false });
  },
  notices: (g, w, h, r) => {
    g.fillStyle = '#9a7a4a'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) {
      const x = 12 + r() * (w - 110), y = 10 + r() * (h - 110), pw = 70 + r() * 40, ph = 80 + r() * 30;
      g.save(); g.translate(x + pw / 2, y + ph / 2); g.rotate((r() - 0.5) * 0.2);
      g.fillStyle = ['#f2efe6', '#f8f0c8', '#e8f0f8', '#f8e0e0'][k % 4]; g.fillRect(-pw / 2, -ph / 2, pw, ph);
      g.fillStyle = 'rgba(40,40,40,0.6)';
      for (let l = 0; l < 7; l++) g.fillRect(-pw / 2 + 8, -ph / 2 + 12 + l * 10, pw * (0.4 + r() * 0.45), 3);
      g.fillStyle = '#c8161a'; g.beginPath(); g.arc(0, -ph / 2 + 5, 4, 0, 6.3); g.fill();
      g.restore();
    }
  },
  welcome: (g, w, h, r) => {
    plate(g, w, h, '#2f4a3a', '#e8e2d0', { r: 20 });
    fit(g, 'WELCOME TO', w / 2, h * 0.24, w * 0.5, h * 0.14, { color: '#e8e2d0', font: SERIF });
    fit(g, 'BLACKWATER', w / 2, h * 0.5, w * 0.8, h * 0.3, { color: '#f2ead0', font: SERIF });
    fit(g, 'POP. 1,204  ·  EST. 1871', w / 2, h * 0.78, w * 0.62, h * 0.12, { color: '#e8e2d0', font: SERIF });
    weather(g, w, h, r);
  },
  depot: (g, w, h, r) => {
    plate(g, w, h, '#2f3c34', '#c8b880', { r: 8 });
    fit(g, 'BLACKWATER DEPOT', w / 2, h * 0.42, w * 0.88, h * 0.46, { color: '#f0e6c0', font: SERIF, track: 6 });
    fit(g, 'HARLAN & WESTERN RAILWAY', w / 2, h * 0.8, w * 0.6, h * 0.16, { color: '#c8b880', font: SERIF });
    weather(g, w, h, r);
  },
  penstock: sign('#e8e4d8', '#1a1a1a', ['PENSTOCK 3  ·  DO NOT ENTER'], { max: 30, border: null }),
  breaker: sign('#1a1a1a', '#f2c21a', [['MAIN BREAKER', '#f2c21a'], ['UNIT 1-4  ·  13.8 kV', '#f2efe6', 0.7]]),
  evac: (g, w, h, r) => {
    plate(g, w, h, '#f2efe6', '#1a6a3a');
    g.fillStyle = '#1a6a3a'; g.fillRect(8, 8, w - 16, h * 0.24);
    fit(g, 'EVACUATION ROUTE', w / 2, 8 + h * 0.12, w * 0.8, h * 0.16, { color: '#fff' });
    g.strokeStyle = '#333'; g.lineWidth = 3; g.strokeRect(30, h * 0.36, w - 60, h * 0.52);
    g.strokeStyle = '#1a6a3a'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(w * 0.7, h * 0.8); g.lineTo(w * 0.3, h * 0.8); g.lineTo(w * 0.3, h * 0.45); g.stroke();
    g.fillStyle = '#c8161a'; g.beginPath(); g.arc(w * 0.7, h * 0.8, 8, 0, 6.3); g.fill();
    weather(g, w, h, r, 0.5, { drips: false });
  },
  radio: sign('#3a3e3a', '#e8e2d0', [['RADIO', '#e8e2d0'], ['CH 9  ·  147.3 MHz', '#f2c21a', 0.7]], { font: DECO }),
  // ---- rail yard
  yardname: relief('HARLAN RAIL YARD', '#d8d2c2', { track: 14, font: FONT }),
  shed: sign('#6a2a22', '#f0e6c8', ['ENGINE SHED  No. 2'], { font: SERIF }),
  signalbox: sign('#f0e6c8', '#1a1a1a', [['HARLAN JUNCTION', '#1a1a1a'], ['SIGNAL BOX  4', '#6a2a22', 0.8]], { font: SERIF }),
  lever: sign('#1a1a1a', '#f2efe6', ['1  2  3  4  5  6  7  8'], { font: COND, border: null }),
  overhead: (g, w, h, r) => {
    plate(g, w, h, '#f2c21a', '#1a1a1a');
    g.fillStyle = '#1a1a1a';
    g.beginPath(); g.moveTo(w * 0.12, h * 0.1); g.lineTo(w * 0.28, h * 0.1); g.lineTo(w * 0.2, h * 0.36); g.lineTo(w * 0.3, h * 0.36); g.lineTo(w * 0.12, h * 0.64); g.lineTo(w * 0.17, h * 0.44); g.lineTo(w * 0.08, h * 0.44); g.closePath(); g.fill();
    fit(g, 'DANGER', w * 0.64, h * 0.2, w * 0.58, h * 0.2, { color: '#1a1a1a' });
    fit(g, 'OVERHEAD LINES', w * 0.64, h * 0.44, w * 0.6, h * 0.16, { color: '#1a1a1a' });
    fit(g, '25 000 VOLTS  ·  KEEP OFF WAGONS', w / 2, h * 0.8, w * 0.86, h * 0.13, { color: '#1a1a1a', font: COND });
    weather(g, w, h, r);
  },
  track: (g, w, h, r) => { plate(g, w, h, '#1a1a1a', '#f2efe6'); fit(g, '7', w / 2, h / 2, w * 0.6, h * 0.7, { color: '#f2efe6' }); weather(g, w, h, r); },
  cont0: containerLogo('MAERSKLINE', '#4a86b8', '#f2f2ee', 'MRKU 441903 7  22G1'),
  cont1: containerLogo('HAPAG', '#c8622a', '#f2f2ee', 'HLXU 887212 3  45G1'),
  cont2: containerLogo('EVERGRN', '#2f6a3a', '#f2f2ee', 'EGSU 310448 1  22G1'),
  cont3: containerLogo('TRITON', '#8a8d90', '#1a1a1a', 'TRLU 552190 9  42G1'),
  wagon: (g, w, h, r) => { g.clearRect(0, 0, w, h); fit(g, 'H&W  30217', w * 0.3, h * 0.35, w * 0.55, h * 0.4, { color: '#f2efe6', font: COND }); fit(g, 'LD LMT 145000  LT WT 52100', w * 0.3, h * 0.78, w * 0.55, h * 0.18, { color: '#e0dcd0', font: MONO, weight: 'normal' }); fit(g, 'HARLAN & WESTERN', w * 0.78, h * 0.5, w * 0.4, h * 0.3, { color: '#f2efe6', font: SERIF }); weather(g, w, h, r, 0.8, { drips: false }); },
  loco: sign('#1a1a1a', '#e8b21a', ['HW 4417'], { font: SERIF }),
  delta: (g, w, h, r) => {
    plate(g, w, h, '#1f6a3a', '#e8efe8', { r: 16 });
    fit(g, 'CHECKPOINT DELTA', w * 0.42, h * 0.32, w * 0.64, h * 0.22, { color: '#f2f2ea', font: COND });
    fit(g, '12', w * 0.86, h * 0.32, w * 0.14, h * 0.22, { color: '#f2f2ea', font: COND });
    fit(g, 'MILITARY TRAFFIC ONLY', w * 0.5, h * 0.72, w * 0.76, h * 0.18, { color: '#f2c21a', font: COND });
    weather(g, w, h, r, 0.8);
  },
  speed15: (g, w, h, r) => { plate(g, w, h, '#f2efe6', '#1a1a1a'); fit(g, '15', w / 2, h / 2, w * 0.7, h * 0.6, { color: '#1a1a1a' }); weather(g, w, h, r, 0.7); },
  whistle: (g, w, h, r) => { plate(g, w, h, '#f2efe6', '#1a1a1a'); fit(g, 'W', w / 2, h / 2, w * 0.7, h * 0.6, { color: '#1a1a1a' }); weather(g, w, h, r, 0.7); },
  trespass: sign('#f2efe6', '#1a1a1a', [['NO TRESPASSING', '#c8161a'], ['RAILROAD PROPERTY', '#1a1a1a'], ['VIOLATORS WILL BE PROSECUTED', '#1a1a1a', 0.6]]),
  bridgemp: sign('#1a1a1a', '#f2efe6', ['BLACKWATER RIVER  ·  MP 212.4'], { font: COND }),
  diagram: (g, w, h, r) => {
    g.fillStyle = '#1e2a26'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8e2d0'; g.lineWidth = 4;
    for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(20, 50 + k * 40); g.lineTo(w - 20, 50 + k * 40); g.stroke(); }
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(120 + k * 150, 50 + k * 40); g.lineTo(200 + k * 150, 90 + k * 40); g.stroke(); }
    for (let k = 0; k < 16; k++) { g.fillStyle = r() < 0.5 ? '#ff4a3a' : '#e8e2d0'; g.beginPath(); g.arc(40 + r() * (w - 80), 50 + Math.floor(r() * 5) * 40, 6, 0, 6.3); g.fill(); }
    fit(g, 'HARLAN JCT  ·  TRACK DIAGRAM', w / 2, 20, w * 0.6, 22, { color: '#e8e2d0', font: COND });
    weather(g, w, h, r, 0.5, { drips: false });
  },
  timetable: (g, w, h, r) => {
    g.fillStyle = '#f2ede0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1a1a';
    fit(g, 'WORKING TIMETABLE  ·  NOV', w / 2, 18, w * 0.8, 20, { color: '#1a1a1a', font: SERIF });
    g.font = `12px ${MONO}`; g.textAlign = 'left';
    for (let l = 0; l < 14; l++) { g.fillText(`${String(4 + l).padStart(2, '0')}:${l % 2 ? '15' : '40'}  ${['FRT 212', 'ENG LT', 'MIL 7', 'PAX 31', 'FRT 219'][l % 5]}  ${l % 3 ? 'ON TIME' : 'CANCELLED'}`, 16, 44 + l * 15); }
    g.strokeStyle = '#c8161a'; g.lineWidth = 3; g.beginPath(); g.moveTo(10, h * 0.2); g.lineTo(w - 10, h * 0.9); g.stroke();
  },
  // ---- airbase
  basename: (g, w, h, r) => {
    plate(g, w, h, '#2f3a2a', '#d8cfa0', { r: 10 });
    fit(g, 'FORT HARLAN ARMY AIRFIELD', w / 2, h * 0.38, w * 0.88, h * 0.34, { color: '#f0e6c0', font: FONT, track: 3 });
    fit(g, '4TH AVIATION REGIMENT  ·  "ALWAYS OVERHEAD"', w / 2, h * 0.74, w * 0.7, h * 0.16, { color: '#d8cfa0', font: COND });
    weather(g, w, h, r);
  },
  restricted: (g, w, h, r) => {
    plate(g, w, h, '#f2efe6', '#c8161a');
    g.fillStyle = '#c8161a'; g.fillRect(10, 10, w - 20, h * 0.22);
    fit(g, 'WARNING', w / 2, 10 + h * 0.11, w * 0.6, h * 0.16, { color: '#fff' });
    fit(g, 'RESTRICTED AREA', w / 2, h * 0.38, w * 0.86, h * 0.13, { color: '#1a1a1a' });
    fit(g, 'IT IS UNLAWFUL TO ENTER THIS AREA', w / 2, h * 0.53, w * 0.86, h * 0.08, { color: '#1a1a1a', font: COND });
    fit(g, 'WITHOUT PERMISSION OF THE COMMANDER', w / 2, h * 0.63, w * 0.86, h * 0.08, { color: '#1a1a1a', font: COND });
    fit(g, 'USE OF DEADLY FORCE AUTHORIZED', w / 2, h * 0.82, w * 0.86, h * 0.11, { color: '#c8161a' });
    weather(g, w, h, r);
  },
  hangar1: (g, w, h, r) => { g.clearRect(0, 0, w, h); stencil(g, '1', w / 2, h / 2, w * 0.6, h * 0.9, '#e8e2d0'); weather(g, w, h, r, 0.8, { drips: false }); },
  hangar2: (g, w, h, r) => { g.clearRect(0, 0, w, h); stencil(g, '2', w / 2, h / 2, w * 0.6, h * 0.9, '#e8e2d0'); weather(g, w, h, r, 0.8, { drips: false }); },
  hangar3: (g, w, h, r) => { g.clearRect(0, 0, w, h); stencil(g, '3', w / 2, h / 2, w * 0.6, h * 0.9, '#e8e2d0'); weather(g, w, h, r, 0.8, { drips: false }); },
  rwy27: (g, w, h, r) => { g.clearRect(0, 0, w, h); fit(g, '27', w / 2, h / 2, w * 0.9, h * 0.9, { color: 'rgba(240,240,236,0.95)', font: COND }); g.save(); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`; g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 3); } g.restore(); },
  taxi: (g, w, h, r) => {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c21a'; g.fillRect(w * 0.06, h * 0.12, w * 0.3, h * 0.76);
    fit(g, 'A', w * 0.21, h / 2, w * 0.2, h * 0.6, { color: '#1a1a1a' });
    arrow(g, w * 0.5, h / 2, w * 0.18, '#f2c21a', -1);
    fit(g, 'B  HANGARS', w * 0.78, h / 2, w * 0.36, h * 0.5, { color: '#f2c21a' });
    weather(g, w, h, r, 0.5, { drips: false });
  },
  hold: (g, w, h, r) => { g.fillStyle = '#b8161a'; g.fillRect(0, 0, w, h); fit(g, '27 - 9', w / 2, h / 2, w * 0.8, h * 0.62, { color: '#f2efe6' }); weather(g, w, h, r, 0.5, { drips: false }); },
  armory: sign('#3a4028', '#e8e2c8', [['ARMORY', '#e8e2c8'], ['BLDG 114  ·  SIGN IN', '#d8c880', 0.6]]),
  mess: sign('#3a4028', '#e8e2c8', [['DINING FACILITY', '#e8e2c8'], ['BLDG 120', '#d8c880', 0.6]]),
  tower: sign('#3a4028', '#e8e2c8', [['AIR TRAFFIC CONTROL', '#e8e2c8'], ['AUTHORIZED ENTRY ONLY', '#d8c880', 0.6]]),
  barracks: sign('#3a4028', '#e8e2c8', [['BARRACKS  B', '#e8e2c8'], ['4-4 AVN REGT', '#d8c880', 0.6]]),
  motorpool: sign('#3a4028', '#e8e2c8', ['MOTOR POOL']),
  crashfire: sign('#b8161a', '#f2efe6', [['CRASH  FIRE  RESCUE', '#f2efe6'], ['STATION 2', '#f2d84a', 0.6]]),
  atc: sign('#2a3438', '#e8e2c8', [['FORT HARLAN TOWER', '#e8e2c8'], ['AIR TRAFFIC CONTROL', '#d8c880', 0.6]]),
  rwy09: (g, w, h, r) => { g.clearRect(0, 0, w, h); fit(g, '9', w / 2, h / 2, w * 0.9, h * 0.9, { color: 'rgba(240,240,236,0.95)', font: COND }); g.save(); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`; g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 3); } g.restore(); },
  insignia: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#1a2a4a'; g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w - 12, h * 0.3); g.lineTo(w - 30, h * 0.8); g.lineTo(w / 2, h - 8); g.lineTo(30, h * 0.8); g.lineTo(12, h * 0.3); g.closePath(); g.fill();
    g.strokeStyle = '#e8b21a'; g.lineWidth = 8; g.stroke();
    g.fillStyle = '#e8b21a';
    g.beginPath(); g.moveTo(w * 0.5, h * 0.22); g.lineTo(w * 0.8, h * 0.5); g.lineTo(w * 0.5, h * 0.42); g.lineTo(w * 0.2, h * 0.5); g.closePath(); g.fill();
    fit(g, 'ALWAYS OVERHEAD', w / 2, h * 0.68, w * 0.62, h * 0.1, { color: '#e8b21a', font: COND });
    weather(g, w, h, r, 0.5, { drips: false });
  },
  usarmy: (g, w, h, r) => { g.clearRect(0, 0, w, h); stencil(g, 'U.S. ARMY', w / 2, h / 2, w * 0.92, h * 0.8, '#1a1a1a', { track: 6 }); },
  tail: (g, w, h, r) => { g.clearRect(0, 0, w, h); fit(g, 'U.S. ARMY  07-34421', w / 2, h / 2, w * 0.95, h * 0.6, { color: '#1a1a1a', font: FONT }); },
  fuel: sign('#f2efe6', '#c8161a', [['JP-8  FLAMMABLE', '#c8161a'], ['NO SMOKING WITHIN 50 FEET', '#1a1a1a', 0.7], ['FUEL POINT 3', '#1a1a1a', 0.7]]),
  quarantine: (g, w, h, r) => {
    g.fillStyle = '#e8e2d0'; g.fillRect(0, 0, w, h);
    stripes(g, 0, 0, w, h * 0.14, '#f2c21a', '#1a1a1a', 18);
    stripes(g, 0, h * 0.86, w, h * 0.14, '#f2c21a', '#1a1a1a', 18);
    fit(g, 'QUARANTINE  ·  SCREENING POINT', w / 2, h * 0.42, w * 0.9, h * 0.34, { color: '#c8161a' });
    fit(g, 'ALL PERSONNEL REPORT FOR INSPECTION', w / 2, h * 0.7, w * 0.8, h * 0.14, { color: '#1a1a1a', font: COND });
    weather(g, w, h, r, 1.3);
  },
  sandbag: (g, w, h, r) => { g.fillStyle = '#8a7a55'; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '40,30,20' : '200,190,160'},0.12)`; g.fillRect(r() * w, r() * h, 2, 1); } },
  briefing: (g, w, h, r) => {
    g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a3a8a'; g.lineWidth = 3;
    g.strokeRect(40, 40, w * 0.5, h * 0.6);
    g.beginPath(); g.moveTo(40, 40 + h * 0.3); g.lineTo(40 + w * 0.5, 40 + h * 0.3); g.stroke();
    g.fillStyle = '#c8161a';
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(60 + k * 45, 60 + h * 0.3, 6, 0, 6.3); g.fill(); }
    fit(g, 'RWY 27  FLARE PATH', 40 + w * 0.25, 28, w * 0.5, 22, { color: '#1a3a8a', font: HAND });
    g.font = `16px ${HAND}`; g.fillStyle = '#1a1a1a'; g.textAlign = 'left';
    ['0200 DROP - C130 "DUSTOFF 6"', 'LIGHT FLARES AT 500 FT INTERVALS', 'HOLD THE TOWER', 'NO ONE LEFT BEHIND', '- OKAFOR'].forEach((t, i) => g.fillText(t, w * 0.62, 80 + i * 40));
    weather(g, w, h, r, 0.3, { drips: false });
  },
  // ---- shared clutter
  poster_a: (g, w, h, r) => { g.fillStyle = '#1d3a5a'; g.fillRect(0, 0, w, h); fit(g, 'SAFETY', w / 2, h * 0.2, w * 0.8, h * 0.14, { color: '#f2e6c8' }); fit(g, 'FIRST', w / 2, h * 0.36, w * 0.8, h * 0.14, { color: '#f2c21a' }); g.fillStyle = '#f2e6c8'; g.beginPath(); g.arc(w / 2, h * 0.66, w * 0.24, 0, 6.3); g.fill(); fit(g, '1,204 DAYS WITHOUT AN ACCIDENT', w / 2, h * 0.93, w * 0.9, h * 0.06, { color: '#f2e6c8', font: COND }); weather(g, w, h, r, 1.2); },
  poster_b: (g, w, h, r) => { g.fillStyle = '#8a1d1d'; g.fillRect(0, 0, w, h); fit(g, 'EVACUATE', w / 2, h * 0.2, w * 0.86, h * 0.16, { color: '#f2e6c8' }); fit(g, 'LISTEN FOR THE SIREN', w / 2, h * 0.4, w * 0.86, h * 0.08, { color: '#f2e6c8', font: COND }); fit(g, 'GO TO HIGH GROUND', w / 2, h * 0.52, w * 0.86, h * 0.08, { color: '#f2e6c8', font: COND }); arrow(g, w / 2, h * 0.75, w * 0.5, '#f2e6c8'); weather(g, w, h, r, 1.3); },
  poster_c: (g, w, h, r) => { g.fillStyle = '#d8cfb8'; g.fillRect(0, 0, w, h); fit(g, 'MISSING', w / 2, h * 0.12, w * 0.86, h * 0.14, { color: '#1a1a1a' }); g.fillStyle = '#6a6a6a'; g.fillRect(w * 0.2, h * 0.24, w * 0.6, h * 0.42); fit(g, 'EMMA  AGE 7', w / 2, h * 0.76, w * 0.8, h * 0.08, { color: '#1a1a1a' }); fit(g, 'LAST SEEN BLACKWATER SCHOOL', w / 2, h * 0.88, w * 0.9, h * 0.05, { color: '#1a1a1a', font: COND }); weather(g, w, h, r, 1.4); },
  calendar: (g, w, h, r) => { g.fillStyle = '#f2efe6'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a7a9a'; g.fillRect(0, 0, w, h * 0.4); fit(g, 'OCTOBER', w / 2, h * 0.47, w * 0.7, h * 0.07, { color: '#1a1a1a' }); for (let k = 0; k < 35; k++) { g.strokeStyle = '#aaa'; g.strokeRect(8 + (k % 7) * ((w - 16) / 7), h * 0.52 + Math.floor(k / 7) * (h * 0.09), (w - 16) / 7, h * 0.09); if (k > 3 && k < 17) { g.strokeStyle = '#c8161a'; g.beginPath(); g.moveTo(8 + (k % 7) * ((w - 16) / 7), h * 0.52 + Math.floor(k / 7) * (h * 0.09)); g.lineTo(8 + (k % 7 + 1) * ((w - 16) / 7), h * 0.52 + (Math.floor(k / 7) + 1) * (h * 0.09)); g.stroke(); } } },
  clipboard: (g, w, h) => { g.fillStyle = '#8a6a44'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2efe6'; g.fillRect(8, 22, w - 16, h - 30); g.fillStyle = '#9a9ca0'; g.fillRect(w * 0.3, 6, w * 0.4, 20); g.fillStyle = 'rgba(40,40,40,0.6)'; for (let l = 0; l < 10; l++) g.fillRect(16, 34 + l * 13, (w - 40) * (0.5 + ((l * 37) % 10) / 20), 3); },
  paper: (g, w, h) => { g.fillStyle = '#f2efe6'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(40,40,40,0.5)'; for (let l = 0; l < 6; l++) g.fillRect(6, 8 + l * 9, w - 16, 2); },
  exitdoor: sign('#1a6a3a', '#f2f2ea', ['EMERGENCY EXIT'], { border: null }),
  firstaid: (g, w, h, r) => { plate(g, w, h, '#1a8a4a', null); g.fillStyle = '#fff'; g.fillRect(w * 0.4, h * 0.18, w * 0.2, h * 0.64); g.fillRect(w * 0.18, h * 0.4, w * 0.64, h * 0.2); weather(g, w, h, r, 0.5); },
  fireext: (g, w, h, r) => { plate(g, w, h, '#c8161a', null); fit(g, 'FIRE', w / 2, h * 0.26, w * 0.8, h * 0.2, { color: '#fff' }); fit(g, 'EXTINGUISHER', w / 2, h * 0.5, w * 0.84, h * 0.12, { color: '#fff' }); arrow(g, w / 2, h * 0.76, w * 0.46, '#fff'); weather(g, w, h, r, 0.5); },
  hazard: (g, w, h) => stripes(g, 0, 0, w, h, '#f2c21a', '#1a1a1a', 20),
  chevron: (g, w, h) => stripes(g, 0, 0, w, h, '#f2efe6', '#c8161a', 20),
  ammo: (g, w, h) => {
    g.clearRect(0, 0, w, h);
    fit(g, 'CTG 5.56MM BALL M855', w / 2, h * 0.3, w * 0.9, h * 0.3, { color: '#e8c84a', font: COND });
    fit(g, '840 ROUNDS  ·  LOT WCC-0917', w / 2, h * 0.7, w * 0.8, h * 0.22, { color: '#e8c84a', font: COND });
  },
  // ---- emissive (screens, lamps)
  e_crt1: crt(1), e_crt2: crt(2), e_crt3: crt(3),
  e_exit: (g, w, h) => { g.fillStyle = '#062a12'; g.fillRect(0, 0, w, h); fit(g, 'EXIT', w * 0.42, h / 2, w * 0.5, h * 0.7, { color: '#4aff7a' }); arrow(g, w * 0.82, h / 2, w * 0.22, '#4aff7a'); },
  e_lamps: (g, w, h, r) => { g.fillStyle = '#080808'; g.fillRect(0, 0, w, h); for (let k = 0; k < 16; k++) { const c = r() < 0.45 ? '#ff4030' : r() < 0.7 ? '#40ff60' : '#ffc030'; g.fillStyle = c; g.beginPath(); g.arc(16 + k * 30.8, h / 2, 10, 0, 6.3); g.fill(); } },
  e_scope: (g, w, h) => { g.fillStyle = '#021208'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(80,255,120,0.4)'; for (let k = 1; k < 5; k++) { g.beginPath(); g.arc(w / 2, h / 2, k * w * 0.11, 0, 6.3); g.stroke(); } g.strokeStyle = 'rgba(80,255,120,0.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w * 0.9, h * 0.28); g.stroke(); for (let k = 0; k < 7; k++) { g.fillStyle = '#6aff8a'; g.beginPath(); g.arc(w * (0.2 + ((k * 37) % 60) / 100), h * (0.2 + ((k * 53) % 60) / 100), 3, 0, 6.3); g.fill(); } },
  e_panel: (g, w, h, r) => { g.fillStyle = '#0a0c0e'; g.fillRect(0, 0, w, h); for (let k = 0; k < 24; k++) { g.fillStyle = ['#ff4030', '#40ff60', '#ffc030', '#40a0ff'][Math.floor(r() * 4)]; g.fillRect(12 + (k % 12) * 41, 20 + Math.floor(k / 12) * 56, 28, 18); } },
  // ---- blended decals
  d_blood1: (g, w, h, r) => splat(g, w, h, r),
  d_blood2: (g, w, h, r) => splat(g, w, h, r, { runs: true, cy: 0.3 }),
  d_hand: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(90,8,6,0.85)';
    g.beginPath(); g.ellipse(w * 0.5, h * 0.62, w * 0.2, h * 0.22, 0, 0, 6.3); g.fill();
    for (let k = 0; k < 5; k++) { const a = -2.4 + k * 0.42; g.beginPath(); g.ellipse(w * 0.5 + Math.cos(a) * w * 0.3, h * 0.6 + Math.sin(a) * h * 0.34, w * 0.06, h * 0.13, a + 1.57, 0, 6.3); g.fill(); }
    for (let k = 0; k < 3; k++) g.fillRect(w * (0.38 + k * 0.1), h * 0.75, 3, h * (0.1 + r() * 0.2));
  },
  d_drag: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 5; k++) {
      const y = h * (0.3 + k * 0.1);
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(80,6,4,0.9)');
      grd.addColorStop(1, 'rgba(80,6,4,0)');
      g.fillStyle = grd;
      g.fillRect(0, y + (r() - 0.5) * 6, w * (0.6 + r() * 0.4), 3 + r() * 6);
    }
  },
  d_streak: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 16; k++) {
      const x = r() * w, l = h * (0.3 + r() * 0.7);
      const grd = g.createLinearGradient(0, 0, 0, l);
      grd.addColorStop(0, `rgba(20,24,22,${0.3 + r() * 0.35})`);
      grd.addColorStop(1, 'rgba(20,24,22,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 2 + r() * 10, l);
    }
  },
  d_moss: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 400; k++) {
      const x = r() * w, y = h * (1 - Math.pow(r(), 2.2));
      g.fillStyle = `rgba(${40 + r() * 30},${70 + r() * 40},${30 + r() * 20},${0.12 + r() * 0.3})`;
      g.beginPath(); g.arc(x, y, 2 + r() * 8, 0, 6.3); g.fill();
    }
  },
  d_graf1: (g, w, h, r) => { g.clearRect(0, 0, w, h); spray(g, 'DEPOT = SAFE', w / 2, h * 0.45, w * 0.9, h * 0.6, '#d8261a', r, { tilt: -0.04 }); },
  d_graf2: (g, w, h, r) => { g.clearRect(0, 0, w, h); spray(g, 'DONT OPEN', w / 2, h * 0.45, w * 0.9, h * 0.6, '#f2f2ea', r, { tilt: 0.03 }); },
  d_graf3: (g, w, h, r) => { g.clearRect(0, 0, w, h); spray(g, 'RADIO CH 9', w / 2, h * 0.45, w * 0.9, h * 0.6, '#1a1a1a', r, { tilt: -0.02 }); },
  d_graf4: (g, w, h, r) => { g.clearRect(0, 0, w, h); spray(g, 'X', w * 0.3, h * 0.45, w * 0.4, h * 0.8, '#f24a1a', r, {}); arrow(g, w * 0.72, h * 0.48, w * 0.4, 'rgba(242,74,26,0.9)'); },
  d_soot: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h * 0.8, 4, w / 2, h * 0.6, w * 0.6);
    grd.addColorStop(0, 'rgba(8,6,4,0.9)');
    grd.addColorStop(1, 'rgba(8,6,4,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    void r;
  },
  d_rust: (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) {
      const x = w * (0.2 + r() * 0.6), l = h * (0.3 + r() * 0.7);
      const grd = g.createLinearGradient(0, 0, 0, l);
      grd.addColorStop(0, `rgba(120,58,24,${0.5 + r() * 0.3})`);
      grd.addColorStop(1, 'rgba(120,58,24,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 2 + r() * 8, l);
    }
  },
};

function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = AW;
  c.height = AH;
  const g = c.getContext('2d');
  if (!cells) cells = pack();
  let seed = 101;
  for (const [name, box] of Object.entries(cells)) {
    const [x0, y0, x1, y1] = box;
    const w = x1 - x0, h = y1 - y0;
    g.save();
    g.beginPath();
    g.rect(x0, y0, w, h);
    g.clip();
    g.translate(x0, y0);
    try { if (PAINT[name]) PAINT[name](g, w, h, rng(seed += 13)); } catch (err) { /* a missing font or canvas feature is not fatal */ }
    g.restore();
  }
  return c;
}

/** The atlas as a texture (new texture per call, one shared canvas). */
export function makeC3Texture(anisotropy = 8) {
  if (!canvas) canvas = paintAtlas();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Every painted cell has a painter (tests). */
export function c3CellsPainted() {
  return Object.keys(C3_CELLS).filter((k) => !PAINT[k]);
}
