// Text and picture atlas of the set dressing (world-dress.js, world-veh.js liveries): road
// signs, spray-painted messages, missing-person posters, newspaper front pages,
// billboards, bus-stop ads, vending-machine fronts, box and crate stencils, vehicle
// liveries and the flat stains (skid marks, puddles, mud, leaves, chalk outlines). Painted
// once per page on a canvas at start-up, nothing is loaded from files. Cells are packed
// by a fixed shelf packer, so a cell's uv rect never depends on what the browser can draw.
//
//   dressUV(name) → [u0, v0, u1, v1]   (texture flipY = true, like world-tex.js atlasUV)
//   makeDressTexture() → THREE.CanvasTexture (new texture per renderer, shared canvas)

import * as THREE from 'three';
import { createRng } from '../render/util.js';

const AW = 2048, AH = 2048;
const FONT = '"Arial Black","Helvetica Neue",Arial,"DejaVu Sans","Liberation Sans",sans-serif';
const HAND = '"Marker Felt","Comic Sans MS","Segoe Print","DejaVu Sans",sans-serif';

// ---- painting helpers -----------------------------------------------------------------------

/** Text fitted into (w, h) (never larger than `max` px), centred at (x, y). */
function fit(g, str, x, y, w, h, o = {}) {
  const font = o.font || FONT;
  const weight = o.weight || 'bold';
  let size = Math.min(o.max || 999, h);
  g.font = `${o.italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
  const m = g.measureText(str).width;
  if (m > w) { size = Math.max(4, size * (w / m)); g.font = `${o.italic ? 'italic ' : ''}${weight} ${size}px ${font}`; }
  g.textAlign = o.align || 'center';
  g.textBaseline = 'middle';
  if (o.stroke) { g.lineWidth = o.strokeW || Math.max(1, size * 0.08); g.strokeStyle = o.stroke; g.lineJoin = 'round'; g.strokeText(str, x, y); }
  g.fillStyle = o.color || '#fff';
  g.fillText(str, x, y);
  return size;
}

/** Lines of text stacked in (x, y, w, h). */
function stack(g, lines, x, y, w, h, o = {}) {
  const gap = o.gap ?? 0.12;
  const each = h / lines.length;
  lines.forEach((ln, i) => {
    const s = typeof ln === 'string' ? { t: ln } : ln;
    fit(g, s.t, x, y - h / 2 + each * (i + 0.5), w, each * (1 - gap), { ...o, ...s });
  });
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

function poly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

function ngon(g, cx, cy, r, n, rot = 0) {
  poly(g, Array.from({ length: n }, (_, i) => [cx + Math.cos(rot + (i / n) * Math.PI * 2) * r, cy + Math.sin(rot + (i / n) * Math.PI * 2) * r]));
}

/** Weathering: speckle, scratches and a grime gradient over a painted rect. */
function weather(g, w, h, rng, amount = 1) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 90 * amount; i++) {
    g.fillStyle = `rgba(${rng.chance(0.5) ? '30,24,16' : '210,200,180'},${rng.range(0.03, 0.14)})`;
    g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 4), rng.range(1, 3));
  }
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(20,14,8,${0.28 * amount})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1;
  for (let i = 0; i < 6 * amount; i++) {
    g.beginPath();
    const x = rng.range(0, w), y = rng.range(0, h);
    g.moveTo(x, y);
    g.lineTo(x + rng.range(-20, 20), y + rng.range(-8, 8));
    g.stroke();
  }
  g.restore();
}

/** Spray-painted text: jittered letters, soft edge, drips. */
function spray(g, str, x, y, w, h, color, rng, o = {}) {
  const size = Math.min(h, o.max || 999);
  g.save();
  g.font = `bold ${size}px ${o.font || FONT}`;
  let total = g.measureText(str).width;
  let k = 1;
  if (total > w) { k = w / total; g.font = `bold ${size * k}px ${o.font || FONT}`; total = w; }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let cx = x - total / 2;
  const drips = [];
  for (const ch of str) {
    const cw = g.measureText(ch).width;
    g.save();
    g.translate(cx + cw / 2, y + rng.range(-0.05, 0.05) * size * k);
    g.rotate(rng.range(-0.07, 0.07) + (o.tilt || 0));
    g.shadowColor = color;
    g.shadowBlur = size * k * 0.06;
    g.fillStyle = color;
    g.fillText(ch, -cw / 2, 0);
    g.restore();
    if (ch !== ' ' && rng.chance(0.28)) drips.push([cx + cw * rng.range(0.25, 0.75), y + size * k * 0.3, rng.range(size * k * 0.12, size * k * 0.5)]);
    cx += cw;
  }
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (const [dx, dy, len] of drips) {
    g.lineWidth = Math.max(1.2, size * k * 0.03);
    g.beginPath();
    g.moveTo(dx, dy);
    g.lineTo(dx + rng.range(-0.6, 0.6), dy + len);
    g.stroke();
    g.beginPath();
    g.arc(dx, dy + len, g.lineWidth * 0.9, 0, 6.3);
    g.fillStyle = color;
    g.fill();
  }
  g.restore();
}

// ---- the cells ---------------------------------------------------------------------------------

const RED = '#b5171c', WHITE = '#f1efe6', YEL = '#f2b81c', GREEN = '#0d6b3c', BLUE = '#1358a8', ORANGE = '#f0781c', BLACK = '#151515';

function signBoard(g, w, h, bg, border, r = 8, bw = 5) {
  rrect(g, 1, 1, w - 2, h - 2, r); g.fillStyle = bg; g.fill();
  if (border) { rrect(g, bw + 1, bw + 1, w - bw * 2 - 2, h - bw * 2 - 2, Math.max(2, r - 3)); g.strokeStyle = border; g.lineWidth = Math.max(2, bw * 0.7); g.stroke(); }
}

const PEOPLE = [
  ['TOMMY REED', '9 yrs · brown hair', 'blue hoodie, red sneakers', '555-0134'],
  ['ANNA KOWALSKI', '34 yrs · nurse', 'last seen Mill Road', '555-0177'],
  ['DAVE & LUCY', 'grey pickup, plate 4KR', 'left for the shelter', '555-0102'],
  ['MAYA BROOKS', '16 yrs · glasses', 'green jacket, backpack', '555-0163'],
  ['GRANDPA JOE', '78 yrs · confused', 'wandered off, wears cap', '555-0149'],
  ['THE HALLORANS', 'family of four', 'blue minivan, County Rd 12', '555-0118'],
];

const HEADLINES = [
  ['THE HARLAN COURIER', 'OUTBREAK', 'SPREADS', 'Hospitals overwhelmed'],
  ['DAILY RECORD', 'STAY', 'INDOORS', 'Governor declares emergency'],
  ['COUNTY TIMES', 'ARMY ON', 'HIGHWAY 9', 'Roads closed statewide'],
  ['THE MORNING NEWS', 'CITY UNDER', 'SIEGE', 'Thousands flee north'],
  ['EVENING STAR', 'CURFEW', 'TONIGHT', 'Lock your doors at dusk'],
  ['HARLAN COURIER', 'NO CURE', 'FOUND', 'Doctors: "Do not approach"'],
];

const BILLBOARDS = [
  { bg: '#c8281e', fg: '#fff2b8', a: "JOE'S", b: '24 HR DINER', c: 'EAT HERE · NEXT EXIT' },
  { bg: '#1c3f74', fg: '#ffe98a', a: 'MOTEL', b: 'VACANCY', c: 'COLOUR TV · POOL · $39' },
  { bg: '#2a2a2e', fg: '#f4c542', a: 'HURT? CALL', b: '555-0134', c: 'INJURY LAWYERS · NO FEE' },
  { bg: '#2f7a3a', fg: '#fff', a: 'HARLAN COUNTY', b: 'FAIR', c: 'SEPT 12 - 15 · RIDES · PIE' },
  { bg: '#d62a2a', fg: '#ffffff', a: 'FIZZ-UP', b: 'ICE COLD', c: 'TASTE THE BUBBLES' },
  { bg: '#e8b020', fg: '#3a1a08', a: 'BUCKLEY', b: 'BURGERS', c: '2 FOR 1 · DRIVE THRU' },
  { bg: '#0f5a4c', fg: '#eafff4', a: 'NEXT EXIT', b: 'GAS FOOD', c: 'LODGING · 2 MILES' },
  { bg: '#5b3b8c', fg: '#ffe6ff', a: 'SUNNY DAYS', b: 'RV PARK', c: 'FULL HOOKUPS · PETS OK' },
];

const ADS = [
  { bg: '#101830', fg: '#f6d27a', a: 'LUNA', b: 'PARFUM', c: 'the scent of night' },
  { bg: '#b81822', fg: '#fff', a: 'FIZZ-UP', b: 'COLA', c: 'ice cold. always.' },
  { bg: '#1a1a1a', fg: '#e23a2a', a: 'DEAD SEASON', b: 'PART III', c: 'in cinemas now' },
  { bg: '#2c6a4a', fg: '#fff', a: 'FIRST', b: 'COUNTY BANK', c: 'your money is safe' },
];

const VEND = [
  { bg: '#c91d24', top: 'FIZZ-UP', rows: ['#e34a3a', '#f0b020', '#4a9ad4', '#8ac04a'], can: true },
  { bg: '#1c4f9a', top: 'SNACKS', rows: ['#f0b020', '#e05a2a', '#7ac04a', '#c04a90'], can: false },
  { bg: '#3a2a20', top: 'HOT COFFEE', rows: ['#b8865a', '#e8d8b0', '#7a5a3a', '#d0a070'], can: false },
];

/** [name, w, h, painter(g, w, h, rng)] in packing order. */
const CELLS = [];
const cell = (name, w, h, paint) => CELLS.push([name, w, h, paint]);

// -- regulatory / warning road signs (transparent outside the shape)
cell('stop', 128, 128, (g, w, h) => {
  ngon(g, 64, 64, 62, 8, Math.PI / 8); g.fillStyle = WHITE; g.fill();
  ngon(g, 64, 64, 56, 8, Math.PI / 8); g.fillStyle = RED; g.fill();
  fit(g, 'STOP', 64, 66, 96, 46, { color: WHITE });
});
cell('yield', 128, 128, (g) => {
  poly(g, [[4, 10], [124, 10], [64, 120]]); g.fillStyle = WHITE; g.fill();
  poly(g, [[16, 20], [112, 20], [64, 104]]); g.fillStyle = 'transparent';
  g.strokeStyle = RED; g.lineWidth = 12; g.lineJoin = 'round'; g.stroke();
  fit(g, 'YIELD', 64, 34, 64, 18, { color: RED });
});
for (const [n, lim] of [['speed25', 25], ['speed45', 45], ['speed65', 65]]) {
  cell(n, 96, 128, (g) => {
    signBoard(g, 96, 128, WHITE, BLACK, 6, 5);
    stack(g, [{ t: 'SPEED', max: 26 }, { t: 'LIMIT', max: 26 }, { t: String(lim), max: 64 }], 48, 64, 78, 108, { color: BLACK });
  });
}
cell('oneway', 192, 64, (g) => {
  signBoard(g, 192, 64, BLACK, WHITE, 6, 4);
  poly(g, [[16, 26], [110, 26], [110, 14], [140, 32], [110, 50], [110, 38], [16, 38]]); g.fillStyle = WHITE; g.fill();
  fit(g, 'ONE', 164, 24, 34, 18, { color: WHITE });
  fit(g, 'WAY', 164, 44, 34, 18, { color: WHITE });
});
cell('dne', 128, 128, (g) => {
  g.beginPath(); g.arc(64, 64, 60, 0, 6.3); g.fillStyle = WHITE; g.fill();
  g.beginPath(); g.arc(64, 64, 54, 0, 6.3); g.fillStyle = RED; g.fill();
  g.fillStyle = WHITE; g.fillRect(20, 52, 88, 24);
  stack(g, [{ t: 'DO NOT', max: 14, color: RED }], 64, 58, 80, 12);
  fit(g, 'ENTER', 64, 70, 80, 12, { color: RED });
});
cell('nopark', 96, 128, (g) => {
  signBoard(g, 96, 128, WHITE, RED, 6, 5);
  stack(g, [{ t: 'NO', max: 30, color: RED }, { t: 'PARKING', max: 20, color: RED }, { t: 'ANY TIME', max: 15, color: BLACK }, { t: 'TOW AWAY', max: 14, color: BLACK }], 48, 64, 76, 108);
});
cell('ped', 128, 128, (g) => {
  poly(g, [[64, 2], [126, 64], [64, 126], [2, 64]]); g.fillStyle = '#c8e21c'; g.fill();
  poly(g, [[64, 12], [116, 64], [64, 116], [12, 64]]); g.strokeStyle = BLACK; g.lineWidth = 4; g.stroke();
  g.fillStyle = BLACK; g.beginPath(); g.arc(64, 34, 8, 0, 6.3); g.fill();
  g.strokeStyle = BLACK; g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); g.moveTo(64, 44); g.lineTo(60, 72); g.moveTo(60, 72); g.lineTo(48, 96); g.moveTo(60, 72); g.lineTo(76, 96); g.moveTo(62, 52); g.lineTo(80, 64); g.moveTo(62, 52); g.lineTo(46, 62); g.stroke();
});
cell('school', 128, 128, (g) => {
  poly(g, [[10, 8], [118, 8], [118, 78], [64, 122], [10, 78]]); g.fillStyle = '#c8e21c'; g.fill();
  poly(g, [[18, 16], [110, 16], [110, 74], [64, 112], [18, 74]]); g.strokeStyle = BLACK; g.lineWidth = 4; g.stroke();
  g.fillStyle = BLACK;
  for (const [x, s] of [[46, 1], [82, 0.85]]) {
    g.beginPath(); g.arc(x, 42, 7 * s, 0, 6.3); g.fill();
    g.lineWidth = 7 * s; g.strokeStyle = BLACK; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, 50); g.lineTo(x, 72 * (s > 0.9 ? 1 : 0.95)); g.moveTo(x, 72); g.lineTo(x - 9, 92); g.moveTo(x, 72); g.lineTo(x + 9, 92); g.stroke();
  }
});
cell('deer', 128, 128, (g) => {
  poly(g, [[64, 2], [126, 64], [64, 126], [2, 64]]); g.fillStyle = YEL; g.fill();
  poly(g, [[64, 12], [116, 64], [64, 116], [12, 64]]); g.strokeStyle = BLACK; g.lineWidth = 4; g.stroke();
  g.fillStyle = BLACK; g.strokeStyle = BLACK; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.ellipse(62, 68, 22, 11, 0, 0, 6.3); g.fill();
  g.beginPath(); g.moveTo(44, 74); g.lineTo(42, 92); g.moveTo(54, 76); g.lineTo(54, 94); g.moveTo(70, 76); g.lineTo(72, 94); g.moveTo(80, 74); g.lineTo(84, 92); g.stroke();
  g.beginPath(); g.moveTo(80, 62); g.lineTo(90, 44); g.stroke(); g.beginPath(); g.arc(93, 42, 6, 0, 6.3); g.fill();
  g.lineWidth = 3; g.beginPath(); g.moveTo(93, 36); g.lineTo(88, 26); g.moveTo(93, 36); g.lineTo(100, 26); g.moveTo(90, 32); g.lineTo(84, 24); g.stroke();
});
cell('curve', 128, 128, (g) => {
  poly(g, [[64, 2], [126, 64], [64, 126], [2, 64]]); g.fillStyle = YEL; g.fill();
  poly(g, [[64, 12], [116, 64], [64, 116], [12, 64]]); g.strokeStyle = BLACK; g.lineWidth = 4; g.stroke();
  g.strokeStyle = BLACK; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(56, 96); g.quadraticCurveTo(56, 64, 78, 50); g.stroke();
  poly(g, [[70, 38], [92, 48], [76, 62]]); g.fillStyle = BLACK; g.fill();
});
cell('work', 128, 128, (g) => {
  poly(g, [[64, 2], [126, 64], [64, 126], [2, 64]]); g.fillStyle = ORANGE; g.fill();
  poly(g, [[64, 12], [116, 64], [64, 116], [12, 64]]); g.strokeStyle = BLACK; g.lineWidth = 4; g.stroke();
  stack(g, [{ t: 'ROAD', max: 20 }, { t: 'WORK', max: 20 }, { t: 'AHEAD', max: 16 }], 64, 66, 66, 56, { color: BLACK });
});
cell('rrx', 192, 128, (g) => {
  g.save(); g.translate(96, 64);
  for (const a of [0.55, -0.55]) { g.save(); g.rotate(a); g.fillStyle = WHITE; rrect(g, -86, -14, 172, 28, 4); g.fill(); g.strokeStyle = BLACK; g.lineWidth = 2; g.stroke(); g.restore(); }
  g.restore();
  fit(g, 'RAILROAD', 96, 62, 70, 12, { color: BLACK });
  fit(g, 'CROSSING', 96, 76, 70, 12, { color: BLACK });
});
cell('closed', 192, 64, (g) => {
  signBoard(g, 192, 64, ORANGE, BLACK, 6, 4);
  fit(g, 'ROAD CLOSED', 96, 33, 168, 34, { color: BLACK });
});
cell('detour', 192, 64, (g) => {
  signBoard(g, 192, 64, ORANGE, BLACK, 6, 4);
  fit(g, 'DETOUR', 76, 33, 118, 34, { color: BLACK });
  poly(g, [[144, 28], [166, 28], [166, 18], [186, 34], [166, 50], [166, 40], [144, 40]]); g.fillStyle = BLACK; g.fill();
});
cell('hospital', 96, 128, (g) => {
  signBoard(g, 96, 128, BLUE, WHITE, 6, 5);
  fit(g, 'H', 48, 50, 60, 70, { color: WHITE });
  fit(g, 'HOSPITAL', 48, 104, 76, 16, { color: WHITE });
});
cell('parking', 96, 128, (g) => {
  signBoard(g, 96, 128, BLUE, WHITE, 6, 5);
  fit(g, 'P', 48, 56, 60, 84, { color: WHITE });
  fit(g, 'PARKING', 48, 108, 76, 16, { color: WHITE });
});
cell('busstop', 96, 128, (g) => {
  signBoard(g, 96, 128, '#1c5fae', WHITE, 6, 4);
  g.fillStyle = WHITE; rrect(g, 16, 14, 64, 36, 6); g.fill();
  g.fillStyle = '#1c5fae'; g.fillRect(24, 22, 48, 14); g.beginPath(); g.arc(30, 46, 5, 0, 6.3); g.arc(66, 46, 5, 0, 6.3); g.fill();
  stack(g, [{ t: 'BUS', max: 30 }, { t: 'STOP', max: 30 }], 48, 90, 70, 60, { color: WHITE });
});
cell('exit', 384, 128, (g, w, h) => {
  signBoard(g, w, h, GREEN, WHITE, 8, 6);
  fit(g, 'EXIT 44', 100, 34, 170, 40, { color: WHITE, align: 'center' });
  fit(g, 'HARLAN  12', 220, 84, 250, 30, { color: WHITE });
  fit(g, 'MILL ROAD', 220, 112, 200, 16, { color: WHITE, weight: 'normal' });
  poly(g, [[320, 24], [356, 24], [338, 54]]); g.fillStyle = WHITE; g.fill();
  g.fillStyle = YEL; g.fillRect(16, 10, 44, 10);
});
cell('shield', 128, 128, (g) => {
  poly(g, [[64, 4], [116, 16], [116, 74], [64, 124], [12, 74], [12, 16]]); g.fillStyle = WHITE; g.fill();
  poly(g, [[64, 12], [108, 22], [108, 72], [64, 114], [20, 72], [20, 22]]); g.fillStyle = BLUE; g.fill();
  poly(g, [[64, 12], [108, 22], [108, 40], [20, 40], [20, 22]]); g.fillStyle = RED; g.fill();
  fit(g, 'I-44', 64, 74, 62, 32, { color: WHITE });
});
cell('mile', 64, 96, (g) => {
  signBoard(g, 64, 96, GREEN, WHITE, 5, 3);
  fit(g, 'MILE', 32, 22, 48, 16, { color: WHITE }); fit(g, '61', 32, 60, 48, 44, { color: WHITE });
});
const STREETS = ['MILL RD', 'COUNTY RD 12', 'MAIN ST', 'OAK AVE'];
STREETS.forEach((s, i) => cell('street' + i, 256, 48, (g, w, h) => {
  signBoard(g, w, h, i % 2 ? '#124f9c' : GREEN, WHITE, 6, 3);
  fit(g, s, w / 2, h / 2 + 1, w - 26, h - 16, { color: WHITE });
}));

// -- apocalypse messages
const SPRAY = [
  ['p_god', 'GOD HELP US', '#b3140f', '#d8d2c0'],
  ['p_turn', 'TURN BACK', '#151515', '#d8d0b8'],
  ['p_stay', 'STAY OUT', '#c41818', '#c8c2ae'],
  ['p_dead', 'DEAD INSIDE', '#111', '#d8d0b0'],
  ['p_end', 'THE END IS NEAR', '#a01010', '#cfc8b4'],
  ['p_none', 'NO SURVIVORS', '#c62a1c', '#26262a'],
  ['p_safe', 'SAFE ZONE >>', '#1a1a1a', '#e3d34a'],
  ['p_loot', 'LOOTERS WILL BE SHOT', '#151515', '#dcd4b8'],
  ['p_run', 'RUN', '#c01818', '#3a3a3e'],
  ['p_help', 'HELP', '#d81c14', '#e0dccf'],
  ['p_theyre', "THEY'RE COMING", '#c8c02a', '#20242a'],
  ['p_nofood', 'NO FOOD NO GAS', '#151515', '#cfc6a6'],
];
for (const [n, t, fg, bg] of SPRAY) {
  cell(n, 256, 96, (g, w, h, rng) => {
    // a scrap of plywood / sheet metal / painted wall with the message sprayed on
    g.fillStyle = bg; rrect(g, 1, 1, w - 2, h - 2, 4); g.fill();
    for (let i = 0; i < 22; i++) { g.fillStyle = `rgba(${rng.chance(0.5) ? '40,30,20' : '255,255,240'},${rng.range(0.03, 0.09)})`; g.fillRect(0, rng.range(0, h), w, rng.range(1, 6)); }
    spray(g, t, w / 2, h / 2, w - 20, h * 0.66, fg, rng, { tilt: rng.range(-0.04, 0.04) });
    weather(g, w, h, rng, 0.8);
  });
}
// the same messages straight on the wall (transparent background, for graffiti on buildings)
for (const [n, t, fg] of [['w_god', 'GOD HELP US', '#c41a12'], ['w_turn', 'TURN BACK', '#e8e2d0'], ['w_out', 'STAY OUT', '#d81c14'], ['w_dead', 'DEAD INSIDE', '#101010'], ['w_run', 'RUN', '#d81c14'], ['w_over', "IT'S OVER", '#e6e0cc']]) {
  cell(n, 256, 96, (g, w, h, rng) => { spray(g, t, w / 2, h / 2, w - 16, h * 0.7, fg, rng, { tilt: rng.range(-0.05, 0.05) }); });
}
for (const [n, marks] of [['x0', ['0', '0']], ['x1', ['1', '2']], ['x2', ['3', '1']]]) {
  cell(n, 128, 128, (g, w, h, rng) => {
    g.strokeStyle = '#d8560c'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(22, 22); g.lineTo(106, 106); g.moveTo(106, 22); g.lineTo(22, 106); g.stroke();
    g.fillStyle = '#d8560c'; g.font = `bold 24px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(marks[0], 64, 18); g.fillText(marks[1], 64, 112); g.fillText('D', 14, 64); g.fillText('S', 114, 64);
    void rng;
  });
}
cell('skull', 128, 128, (g, w, h, rng) => {
  g.fillStyle = '#e8e2d0';
  g.beginPath(); g.ellipse(64, 54, 38, 40, 0, 0, 6.3); g.fill();
  g.fillRect(44, 80, 40, 26);
  g.fillStyle = '#101010'; g.beginPath(); g.ellipse(48, 56, 10, 12, 0, 0, 6.3); g.ellipse(80, 56, 10, 12, 0, 0, 6.3); g.fill();
  poly(g, [[64, 68], [58, 82], [70, 82]]); g.fill();
  for (let x = 48; x < 84; x += 8) g.fillRect(x, 92, 3, 14);
  weather(g, w, h, rng, 0.4);
});
cell('biohaz', 128, 128, (g) => {
  g.fillStyle = '#f0c020'; ngon(g, 64, 64, 62, 6, 0); g.fill();
  g.strokeStyle = BLACK; g.lineWidth = 7;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(64 + Math.cos(k * 2.094 - 1.57) * 22, 64 + Math.sin(k * 2.094 - 1.57) * 22, 20, 0, 6.3); g.stroke(); }
  g.fillStyle = '#f0c020'; g.beginPath(); g.arc(64, 64, 9, 0, 6.3); g.fill();
  g.beginPath(); g.arc(64, 64, 6, 0, 6.3); g.strokeStyle = BLACK; g.lineWidth = 4; g.stroke();
});
cell('quar', 512, 96, (g, w, h, rng) => {
  g.fillStyle = '#e8c21c'; g.fillRect(0, 0, w, h);
  g.fillStyle = BLACK; for (let x = -h; x < w; x += 46) { poly(g, [[x, 0], [x + 22, 0], [x + 22 + h, h], [x + h, h]]); g.fill(); }
  g.fillStyle = '#e8c21c'; g.fillRect(24, 16, w - 48, h - 32);
  fit(g, 'QUARANTINE  -  DO NOT CROSS', w / 2, h / 2, w - 80, h - 40, { color: BLACK });
  weather(g, w, h, rng, 0.7);
});
cell('tape', 256, 32, (g, w, h) => {
  g.fillStyle = '#f0c820'; g.fillRect(0, 0, w, h);
  fit(g, 'POLICE LINE DO NOT CROSS   POLICE LINE DO NOT CROSS', w / 2, h / 2 + 1, w - 6, h - 12, { color: BLACK });
});
cell('zone', 256, 128, (g, w, h, rng) => {
  signBoard(g, w, h, '#a8231a', WHITE, 6, 5);
  stack(g, [{ t: 'RESTRICTED', max: 34 }, { t: 'AREA', max: 34 }, { t: 'AUTHORISED PERSONNEL ONLY', max: 13, weight: 'normal' }], w / 2, h / 2, w - 34, h - 22, { color: WHITE });
  weather(g, w, h, rng, 0.7);
});
cell('redcross', 128, 128, (g) => {
  g.fillStyle = WHITE; g.fillRect(2, 2, 124, 124);
  g.fillStyle = '#c8161c'; g.fillRect(50, 20, 28, 88); g.fillRect(20, 50, 88, 28);
});
cell('cross_banner', 256, 96, (g, w, h) => {
  g.fillStyle = WHITE; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c8161c'; g.fillRect(14, 30, 48, 14); g.fillRect(31, 13, 14, 48);
  fit(g, 'FIELD HOSPITAL', 158, 34, 160, 30, { color: '#c8161c' });
  fit(g, 'TRIAGE · ENTER HERE', 158, 70, 160, 18, { color: BLACK, weight: 'normal' });
});

// -- posters, newspapers
PEOPLE.forEach((p, i) => cell('miss' + i, 128, 192, (g, w, h, rng) => {
  g.fillStyle = ['#efe9d6', '#f2f0e6', '#e8e2c8'][i % 3]; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b01818'; g.fillRect(0, 0, w, 32);
  fit(g, 'MISSING', w / 2, 17, w - 14, 24, { color: '#fff' });
  // photo
  g.fillStyle = '#9a9a92'; g.fillRect(24, 40, 80, 64);
  g.fillStyle = '#5a5850'; g.beginPath(); g.arc(64, 68, 15, 0, 6.3); g.fill(); g.beginPath(); g.ellipse(64, 108, 30, 22, 0, Math.PI, 0); g.fill();
  fit(g, p[0], w / 2, 118, w - 12, 15, { color: BLACK });
  fit(g, p[1], w / 2, 133, w - 12, 11, { color: '#222', weight: 'normal' });
  fit(g, p[2], w / 2, 146, w - 12, 11, { color: '#222', weight: 'normal' });
  fit(g, 'CALL ' + p[3], w / 2, 170, w - 12, 15, { color: '#b01818' });
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 6; k++) g.fillRect(rng.range(0, w), h - 6, 3, 6);
  weather(g, w, h, rng, 1.2);
}));
HEADLINES.forEach((hd, i) => cell('news' + i, 128, 96, (g, w, h, rng) => {
  g.fillStyle = '#d9d3c0'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1a1a1a'; fit(g, hd[0], w / 2, 9, w - 8, 11, { color: '#1a1a1a', font: '"Times New Roman",Georgia,serif' });
  g.fillRect(4, 17, w - 8, 1.5);
  stack(g, [{ t: hd[1], max: 26 }, { t: hd[2], max: 26 }], w / 2, 39, w - 10, 40, { color: '#111', font: '"Times New Roman",Georgia,serif', gap: 0.04 });
  g.fillStyle = '#8c887a'; g.fillRect(6, 62, 52, 22);
  g.fillStyle = 'rgba(30,30,30,0.7)';
  for (let y = 62; y < 88; y += 4) { g.fillRect(62, y, 60, 1.5); }
  fit(g, hd[3], w / 2, 90, w - 8, 8, { color: '#333', weight: 'normal' });
  weather(g, w, h, rng, 1.5);
}));
BILLBOARDS.forEach((b, i) => cell('bb' + i, 384, 144, (g, w, h, rng) => {
  g.fillStyle = b.bg; g.fillRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = b.fg; g.globalAlpha = 0.16; g.beginPath(); g.arc(w * 0.84, h * 0.4, h * 0.42, 0, 6.3); g.fill(); g.globalAlpha = 1;
  fit(g, b.a, w * 0.5, 34, w - 40, 42, { color: b.fg, stroke: 'rgba(0,0,0,0.5)' });
  fit(g, b.b, w * 0.5, 82, w - 40, 54, { color: '#fff', stroke: 'rgba(0,0,0,0.55)' });
  fit(g, b.c, w * 0.5, 126, w - 40, 18, { color: b.fg, weight: 'normal' });
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 5; g.strokeRect(5, 5, w - 10, h - 10);
  weather(g, w, h, rng, 1.6);
}));
ADS.forEach((a, i) => cell('ad' + i, 192, 288, (g, w, h, rng) => {
  g.fillStyle = a.bg; g.fillRect(0, 0, w, h);
  const gr = g.createRadialGradient(w / 2, h * 0.4, 8, w / 2, h * 0.4, w * 0.9); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = a.fg; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(w / 2, h * 0.42, 34, 62, 0, 0, 6.3); g.fill(); g.globalAlpha = 1;
  fit(g, a.a, w / 2, h * 0.14, w - 24, 34, { color: a.fg });
  fit(g, a.b, w / 2, h * 0.76, w - 24, 34, { color: '#fff' });
  fit(g, a.c, w / 2, h * 0.9, w - 24, 16, { color: a.fg, weight: 'normal', italic: true });
  weather(g, w, h, rng, 1.2);
}));
VEND.forEach((v, i) => cell('vend' + i, 96, 192, (g, w, h, rng) => {
  g.fillStyle = v.bg; g.fillRect(0, 0, w, h);
  fit(g, v.top, w / 2, 14, w - 10, 18, { color: '#fff' });
  g.fillStyle = '#0c0f12'; g.fillRect(8, 30, w - 30, 110);
  v.rows.forEach((c, r) => {
    for (let k = 0; k < 4; k++) {
      g.fillStyle = c;
      if (v.can) { rrect(g, 12 + k * 15, 34 + r * 26, 11, 20, 3); g.fill(); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(14 + k * 15, 36 + r * 26, 2, 16); }
      else { g.fillRect(12 + k * 15, 36 + r * 26, 12, 17); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(12 + k * 15, 36 + r * 26, 12, 4); }
    }
  });
  g.fillStyle = '#1a1c1e'; g.fillRect(w - 20, 30, 14, 60);
  g.fillStyle = '#8a8e92'; for (let k = 0; k < 6; k++) g.fillRect(w - 18, 34 + k * 9, 10, 5);
  g.fillStyle = '#050607'; g.fillRect(12, h - 42, w - 24, 24);
  fit(g, 'PUSH', w / 2, h - 30, 40, 10, { color: '#5a5e62' });
  weather(g, w, h, rng, 1.2);
}));

// -- box, crate and bin labels
cell('box_frag', 128, 128, (g, w, h, rng) => {
  g.fillStyle = '#b48a56'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(210,190,140,0.75)'; g.fillRect(w / 2 - 9, 0, 18, h);
  fit(g, 'FRAGILE', w / 2, 30, 100, 22, { color: '#8c1414' });
  g.strokeStyle = '#333'; g.lineWidth = 3; g.beginPath(); g.moveTo(34, 100); g.lineTo(34, 62); g.lineTo(20, 76); g.moveTo(34, 62); g.lineTo(48, 76); g.moveTo(94, 100); g.lineTo(94, 62); g.lineTo(80, 76); g.moveTo(94, 62); g.lineTo(108, 76); g.stroke();
  fit(g, 'THIS SIDE UP', w / 2, 116, 90, 9, { color: '#333', weight: 'normal' });
  weather(g, w, h, rng, 1);
});
cell('box_plain', 128, 128, (g, w, h, rng) => {
  g.fillStyle = '#a98552'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(214,194,146,0.8)'; g.fillRect(w / 2 - 9, 0, 18, h);
  g.fillStyle = '#f0ece0'; g.fillRect(74, 78, 40, 30);
  g.fillStyle = '#222'; for (let k = 0; k < 5; k++) g.fillRect(78, 82 + k * 5, 30, 2);
  weather(g, w, h, rng, 1);
});
for (const [n, t, bg, fg] of [['st_ammo', 'AMMO', '#4a5424', '#e2d36a'], ['st_med', 'MEDICAL', '#dcd8cc', '#b81818'], ['st_mre', 'RATIONS', '#4d5a34', '#e6dfb0'], ['st_fuel', 'FUEL', '#8a2a1e', '#f4e6b8'], ['st_food', 'CANNED FOOD', '#8a6a3a', '#2a1a0a'], ['st_water', 'WATER', '#2a5a8a', '#eaf4ff']]) {
  cell(n, 128, 64, (g, w, h, rng) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    fit(g, t, w / 2, h / 2, w - 16, h - 22, { color: fg, font: '"Courier New",monospace' });
    g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10);
    weather(g, w, h, rng, 1);
  });
}
cell('haz_diamond', 96, 96, (g) => {
  poly(g, [[48, 3], [93, 48], [48, 93], [3, 48]]); g.fillStyle = '#f2c420'; g.fill();
  g.strokeStyle = BLACK; g.lineWidth = 3; g.stroke();
  fit(g, '!', 48, 46, 40, 56, { color: BLACK });
});
cell('bin_label', 128, 64, (g, w, h) => {
  fit(g, 'CITY', w / 2, 16, 100, 22, { color: '#e8e8e0' });
  fit(g, 'SANITATION', w / 2, 40, 116, 22, { color: '#e8e8e0' });
  fit(g, 'NO DUMPING', w / 2, 58, 90, 9, { color: '#e8e8e0', weight: 'normal' });
});
cell('phone_sign', 128, 48, (g, w, h) => {
  g.fillStyle = '#f4f4ee'; g.fillRect(0, 0, w, h);
  fit(g, 'PHONE', w / 2, h / 2, w - 20, h - 12, { color: '#1a3f9a' });
});
cell('mail', 96, 40, (g, w, h) => { fit(g, 'U.S. MAIL', w / 2, h / 2, w - 8, h - 8, { color: '#e8e8e0' }); });
cell('numbers', 96, 32, (g, w, h) => { fit(g, '1432', w / 2, h / 2, w - 10, h - 6, { color: '#e8e8e0' }); });
cell('atm', 96, 64, (g, w, h) => {
  g.fillStyle = '#123'; g.fillRect(0, 0, w, h);
  fit(g, 'CASH', w / 2, 20, w - 12, 24, { color: '#ffd84a' });
  fit(g, 'OUT OF ORDER', w / 2, 46, w - 12, 14, { color: '#ff5a4a', weight: 'normal' });
});
cell('pump_out', 96, 64, (g, w, h) => {
  g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
  fit(g, 'NO GAS', w / 2, h / 2, w - 12, h - 20, { color: '#f22' });
});

// -- vehicle liveries
cell('v_police', 256, 48, (g, w, h) => {
  fit(g, 'POLICE', w * 0.52, h / 2, w * 0.7, h - 6, { color: '#f2f2f2', stroke: 'rgba(0,0,0,0.35)' });
  g.fillStyle = '#2a58c8'; g.fillRect(0, h - 7, w, 6);
});
cell('v_star', 64, 64, (g) => {
  g.fillStyle = '#e6c84a'; g.strokeStyle = '#8a7020'; g.lineWidth = 2;
  poly(g, Array.from({ length: 10 }, (_, i) => [32 + Math.cos(-1.57 + i * 0.628) * (i % 2 ? 13 : 29), 32 + Math.sin(-1.57 + i * 0.628) * (i % 2 ? 13 : 29)])); g.fill(); g.stroke();
});
cell('v_taxi', 128, 40, (g, w, h) => { g.fillStyle = '#f4f0e0'; g.fillRect(0, 0, w, h); fit(g, 'TAXI', w / 2, h / 2 + 1, w - 20, h - 8, { color: BLACK }); });
cell('v_taxi_side', 256, 40, (g, w, h) => {
  g.fillStyle = BLACK; for (let x = 0; x < w; x += 28) { g.fillRect(x, 0, 14, 8); g.fillRect(x + 14, 8, 14, 8); }
  fit(g, 'YELLOW CAB CO.  555-0100', w / 2, 28, w - 12, 18, { color: BLACK, weight: 'bold' });
});
cell('v_amb', 256, 48, (g, w, h) => {
  g.fillStyle = '#c81c22'; g.fillRect(0, 0, w, 10);
  fit(g, 'AMBULANCE', w / 2, 30, w - 20, 26, { color: '#c81c22' });
});
cell('v_amb_r', 256, 48, (g, w, h) => {
  g.save(); g.translate(w, 0); g.scale(-1, 1);
  fit(g, 'AMBULANCE', w / 2, 30, w - 20, 26, { color: '#c81c22' });
  g.restore();
});
cell('v_fire', 256, 48, (g, w, h) => {
  fit(g, 'HARLAN FIRE DEPT', w / 2, h / 2, w - 16, h - 12, { color: '#f4e6a8', stroke: 'rgba(80,0,0,0.6)' });
});
cell('v_bus', 256, 40, (g, w, h) => { fit(g, 'HARLAN COUNTY SCHOOL BUS', w / 2, h / 2, w - 10, h - 12, { color: '#141414', weight: 'normal' }); });
cell('v_bus_big', 192, 48, (g, w, h) => { fit(g, 'SCHOOL BUS', w / 2, h / 2, w - 12, h - 8, { color: '#141414' }); });
cell('v_news', 128, 48, (g, w, h) => {
  g.fillStyle = '#c81818'; g.fillRect(0, 0, w, h);
  fit(g, 'NEWS 9', w / 2, h / 2 + 1, w - 14, h - 10, { color: '#fff' });
});
cell('v_swift', 256, 64, (g, w, h) => {
  g.fillStyle = '#6a3a1a'; g.fillRect(0, 0, w, h);
  fit(g, 'SWIFT PARCEL', w / 2, 24, w - 20, 32, { color: '#f4d030' });
  fit(g, 'we deliver. always.', w / 2, 52, w - 30, 14, { color: '#e8d8b0', weight: 'normal', italic: true });
});
cell('v_bread', 256, 64, (g, w, h) => {
  g.fillStyle = '#eae2c6'; g.fillRect(0, 0, w, h);
  fit(g, "MAMA JO'S BREAD", w / 2, 24, w - 20, 32, { color: '#a01818' });
  fit(g, 'fresh every morning', w / 2, 52, w - 30, 14, { color: '#333', weight: 'normal', italic: true });
});
cell('v_plumb', 256, 64, (g, w, h) => {
  g.fillStyle = '#1e4f9a'; g.fillRect(0, 0, w, h);
  fit(g, 'ACE PLUMBING', w / 2, 24, w - 20, 32, { color: '#fff' });
  fit(g, '24 HR · 555-0177', w / 2, 52, w - 30, 14, { color: '#ffe680', weight: 'normal' });
});
cell('v_tow', 128, 40, (g, w, h) => { fit(g, 'TOW 24/7', w / 2, h / 2, w - 12, h - 8, { color: '#111' }); });
cell('v_cross', 64, 64, (g) => {
  g.fillStyle = '#1a55b8';
  for (let k = 0; k < 3; k++) { g.save(); g.translate(32, 32); g.rotate(k * 1.047); g.fillRect(-4, -28, 8, 56); g.restore(); }
});
cell('v_num', 96, 40, (g, w, h) => { fit(g, 'E-17', w / 2, h / 2, w - 12, h - 8, { color: '#f4f4ee' }); });

// -- flat stains (alpha textures: dark/coloured marks on the road; RGB is tinted by vertex colour)
cell('f_skid', 256, 64, (g, w, h, rng) => {
  for (const cy of [h * 0.3, h * 0.7]) {
    for (let x = 4; x < w - 4; x += 2) {
      const edge = Math.min(x, w - x) / 40;
      const a = Math.min(1, edge) * rng.range(0.55, 0.95);
      g.fillStyle = `rgba(255,255,255,${a})`;
      const wob = Math.sin(x * 0.04 + cy) * 1.2;
      g.fillRect(x, cy + wob - 4.5, 3, 9);
    }
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.15, 0.6)})`; g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 6), rng.range(1, 3)); }
  g.globalCompositeOperation = 'source-over';
});
cell('f_tread', 256, 64, (g, w, h, rng) => {
  for (const cy of [h * 0.3, h * 0.7]) {
    for (let x = 8; x < w - 8; x += 7) {
      const edge = Math.min(x, w - x) / 30;
      g.fillStyle = `rgba(255,255,255,${Math.min(1, edge) * rng.range(0.6, 0.9)})`;
      poly(g, [[x, cy - 9], [x + 3, cy - 9], [x + 8, cy], [x + 3, cy + 9], [x, cy + 9], [x + 5, cy]]); g.fill();
    }
  }
});
cell('f_puddle', 128, 128, (g, w, h, rng) => {
  const pts = Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * 6.283; const r = 44 + Math.sin(a * 3 + 1) * 10 + Math.sin(a * 5) * 6 + rng.range(-3, 3); return [64 + Math.cos(a) * r * 1.1, 64 + Math.sin(a) * r * 0.85]; });
  g.filter = 'blur(4px)';
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  g.filter = 'none';
});
cell('f_mud', 128, 128, (g, w, h, rng) => {
  g.filter = 'blur(2px)';
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, 6.28), d = rng.range(0, 40);
    g.fillStyle = `rgba(255,255,255,${rng.range(0.55, 0.95)})`;
    g.beginPath(); g.ellipse(64 + Math.cos(a) * d, 64 + Math.sin(a) * d * 0.8, rng.range(8, 20), rng.range(6, 14), rng.range(0, 3), 0, 6.3); g.fill();
  }
  g.filter = 'none';
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.7)})`; g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 4), rng.range(1, 3)); }
  g.globalCompositeOperation = 'source-over';
});
cell('f_stain', 128, 128, (g, w, h, rng) => {
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 60);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.1, 0.55)})`; g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 6), rng.range(1, 4)); }
  g.globalCompositeOperation = 'source-over';
});
cell('f_soot', 128, 128, (g, w, h, rng) => {
  for (let i = 0; i < 46; i++) {
    const a = rng.range(0, 6.28), d = Math.sqrt(rng.next()) * 52;
    const gr = g.createRadialGradient(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rng.range(8, 20));
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
});
cell('f_leaves', 128, 128, (g, w, h, rng) => {
  const cols = ['#a8541c', '#c8801c', '#7a8a24', '#8a3a1a', '#b09a2a', '#5a6a20'];
  for (let i = 0; i < 44; i++) {
    g.save(); g.translate(rng.range(8, 120), rng.range(8, 120)); g.rotate(rng.range(0, 6.3));
    g.fillStyle = cols[i % cols.length];
    g.beginPath(); g.moveTo(0, -7); g.quadraticCurveTo(6, -1, 0, 8); g.quadraticCurveTo(-6, -1, 0, -7); g.fill();
    g.strokeStyle = 'rgba(50,30,10,0.6)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(0, -6); g.lineTo(0, 7); g.stroke();
    g.restore();
  }
});
cell('f_paper', 128, 128, (g, w, h, rng) => {
  for (let i = 0; i < 9; i++) {
    g.save(); g.translate(rng.range(14, 114), rng.range(14, 114)); g.rotate(rng.range(0, 6.3));
    g.fillStyle = `rgb(${215 + rng.range(-20, 20)},${210 + rng.range(-20, 15)},${190 + rng.range(-20, 10)})`;
    g.fillRect(-9, -12, 18, 24);
    g.fillStyle = 'rgba(40,40,40,0.5)'; for (let y = -8; y < 9; y += 4) g.fillRect(-6, y, 12, 1);
    g.restore();
  }
});
cell('f_chalk', 128, 256, (g) => {
  g.strokeStyle = 'rgba(245,245,235,0.9)'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.arc(64, 34, 14, 0, 6.3);
  g.moveTo(58, 48); g.lineTo(28, 66); g.lineTo(18, 100); g.lineTo(30, 104); g.lineTo(42, 78); g.lineTo(50, 82);
  g.lineTo(46, 150); g.lineTo(36, 226); g.lineTo(52, 230); g.lineTo(64, 160); g.lineTo(76, 230); g.lineTo(92, 226); g.lineTo(82, 150);
  g.lineTo(78, 82); g.lineTo(86, 78); g.lineTo(98, 104); g.lineTo(110, 100); g.lineTo(100, 66); g.lineTo(70, 48); g.closePath();
  g.stroke();
});
cell('f_blood', 128, 128, (g, w, h, rng) => {
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, 6.28), d = Math.pow(rng.next(), 0.7) * 56;
    g.fillStyle = `rgba(255,255,255,${rng.range(0.5, 1)})`;
    g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rng.range(1, 9) * (1 - d / 70), 0, 6.3); g.fill();
  }
  g.beginPath(); g.ellipse(64, 64, 16, 12, 0.4, 0, 6.3); g.fill();
});
cell('f_glass', 128, 128, (g, w, h, rng) => {
  for (let i = 0; i < 70; i++) {
    g.save(); g.translate(rng.range(6, 122), rng.range(6, 122)); g.rotate(rng.range(0, 6.3));
    g.fillStyle = `rgba(255,255,255,${rng.range(0.5, 1)})`;
    poly(g, [[0, 0], [rng.range(2, 6), rng.range(-1, 2)], [rng.range(0, 3), rng.range(3, 6)]]); g.fill();
    g.restore();
  }
});
cell('f_grass', 128, 128, (g, w, h, rng) => {
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = rng.range(10, 118), y = rng.range(70, 124), l = rng.range(24, 60);
    g.strokeStyle = `rgba(255,255,255,${rng.range(0.6, 1)})`; g.lineWidth = rng.range(1.5, 3);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + rng.range(-8, 8), y - l * 0.6, x + rng.range(-18, 18), y - l); g.stroke();
  }
});
cell('f_ripple', 128, 128, (g) => {
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2;
  for (const r of [16, 30, 44, 58]) { g.globalAlpha = 1 - r / 70; g.beginPath(); g.ellipse(64, 64, r, r * 0.8, 0, 0, 6.3); g.stroke(); }
});
cell('checker', 64, 64, (g, w, h) => {
  g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c8281e';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect(x * 8, y * 8, 8, 8);
});
cell('white', 16, 16, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); });

// ---- packing + canvas ---------------------------------------------------------------------------

const GUTTER = 4;
const RECTS = new Map();
(function pack() {
  const order = CELLS.map((c, i) => [c, i]).sort((a, b) => b[0][2] - a[0][2] || a[1] - b[1]);
  let x = 0, y = 0, rowH = 0;
  for (const [[name, w, h]] of order) {
    if (x + w + GUTTER > AW) { x = 0; y += rowH + GUTTER; rowH = 0; }
    RECTS.set(name, [x, y, x + w, y + h]);
    x += w + GUTTER;
    rowH = Math.max(rowH, h);
  }
  if (y + rowH > AH) throw new Error('dress atlas overflow: ' + (y + rowH));
})();

/** Atlas cell names. */
export const DRESS_CELLS = Object.freeze(CELLS.map((c) => c[0]));

/** UV rect [u0, v0, u1, v1] of a cell (half a texel inset). Unknown names give the white cell. */
export function dressUV(name) {
  const r = RECTS.get(name) || RECTS.get('white');
  const e = 0.75;
  return [(r[0] + e) / AW, 1 - (r[3] - e) / AH, (r[2] - e) / AW, 1 - (r[1] + e) / AH];
}

/** Pixel size [w, h] of a cell (for aspect ratios). */
export function dressSize(name) {
  const r = RECTS.get(name) || RECTS.get('white');
  return [r[2] - r[0], r[3] - r[1]];
}

let canvas = null;
function paintAll() {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = AW;
  canvas.height = AH;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, AW, AH);
  let seed = 1;
  for (const [name, w, h, paint] of CELLS) {
    const [x0, y0] = RECTS.get(name);
    g.save();
    g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.translate(x0, y0);
    try {
      paint(g, w, h, createRng(0xD2E55 + seed++ * 7919));
    } catch (err) {
      console.warn('dress atlas: cell failed', name, err);
    }
    g.restore();
  }
  return canvas;
}

/** The dressing atlas as a texture (new texture per call; the painted canvas is shared). */
export function makeDressTexture(anisotropy = 8) {
  const tex = new THREE.CanvasTexture(paintAll());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = anisotropy;
  return tex;
}
