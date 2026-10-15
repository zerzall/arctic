// Top-down art of the hideouts' hero obstacles (SPEC §3.10): the fire ring and its log seats, a
// couch, the mission table, the workbench, the range bench, hay bales, the painted boards. The
// classic view's counterpart of render3d/world-hideout*.js: only the obstacles the map marks
// with a `prop` are drawn here; every other obstacle keeps the default art of obstacles.js.
// Same frame as obstacles.js: the obstacle centred on the origin, length along +x (o.w), width along y (o.h).

import { shade, rgba, fillRoundRect, fillCircle } from './util.js';

const TAU = Math.PI * 2;

/**
 * Paint a hideout obstacle. Returns false when `o.prop` is not one of the kinds drawn here.
 * @param {CanvasRenderingContext2D} g
 * @param {object} o obstacle
 * @param {object} rng seeded stream (createRng)
 */
export function drawHubObstacle(g, o, rng) {
  const L = o.w, W = o.h, c = o.color;
  switch (o.prop) {
    case 'campring': campRing(g, L, W, rng); return true;
    case 'logseat': logSeat(g, L, W, c || '#6b4a2c', rng); return true;
    case 'couch': couch(g, L, W, c || '#6a3f34'); return true;
    case 'maptable': mapTable(g, L, W, c || '#7a5a3a'); return true;
    case 'workbench': workbench(g, L, W, c || '#7a5a3a', rng); return true;
    case 'rangebench': rangeBench(g, L, W, c || '#6a5236'); return true;
    case 'haybale': hayBale(g, L, W, c || '#c9a24a', rng); return true;
    case 'signboard': signBoard(g, L, W, c || '#5c4326'); return true;
    default: return false;
  }
}

/** A ring of stones round a bed of ash and embers. */
function campRing(g, L, W, rng) {
  const r = Math.min(L, W) / 2;
  fillCircle(g, 1.5, 2, r + 3, 'rgba(0,0,0,0.3)');
  fillCircle(g, 0, 0, r, '#26201a');
  fillCircle(g, 0, 0, r * 0.7, '#3a2a1e');
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.next() * 0.2;
    const rr = r - 3 + rng.next() * 2;
    const sz = 5.5 + rng.next() * 3;
    g.fillStyle = shade('#8a8378', -0.2 + rng.next() * 0.35);
    g.beginPath();
    g.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, sz, sz * 0.78, a, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.8;
    g.stroke();
  }
  // a few charred logs and glowing embers
  g.strokeStyle = '#17110c';
  g.lineWidth = 4;
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    g.beginPath();
    g.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
    g.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
    g.stroke();
  }
  for (let i = 0; i < 6; i++) fillCircle(g, (rng.next() - 0.5) * r, (rng.next() - 0.5) * r, 1.2 + rng.next(), rgba('#ff8a2a', 0.8));
}

/** A log to sit on: bark, a cut end and a couple of knots. */
function logSeat(g, L, W, color, rng) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(1, 2, L / 2, W / 2 + 1.5, 0, 0, TAU);
  g.fill();
  const grad = g.createLinearGradient(0, -W / 2, 0, W / 2);
  grad.addColorStop(0, shade(color, 0.22));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, shade(color, -0.4));
  fillRoundRect(g, -L / 2, -W / 2, L, W, W * 0.45, grad);
  g.strokeStyle = 'rgba(20,12,6,0.6)';
  g.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    const y = -W * 0.32 + i * W * 0.21;
    g.beginPath();
    g.moveTo(-L * 0.42, y + (rng.next() - 0.5) * 2);
    g.lineTo(L * 0.42, y + (rng.next() - 0.5) * 2);
    g.stroke();
  }
  fillCircle(g, L / 2 - W * 0.32, 0, W * 0.34, shade('#c9a06a', -0.1));
  g.strokeStyle = 'rgba(90,60,30,0.7)';
  g.lineWidth = 0.7;
  for (const k of [0.12, 0.22]) {
    g.beginPath();
    g.arc(L / 2 - W * 0.32, 0, W * k, 0, TAU);
    g.stroke();
  }
}

/** A sofa seen from above: back, arms and three cushions. */
function couch(g, L, W, color) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  fillRoundRect(g, -L / 2 + 1, -W / 2 + 2, L, W, 5);
  fillRoundRect(g, -L / 2, -W / 2, L, W, 5, shade(color, -0.25));
  fillRoundRect(g, -L / 2 + 3, -W / 2 + W * 0.3, L - 6, W * 0.66, 4, color);
  const n = 3, cw = (L - 16) / n;
  for (let i = 0; i < n; i++) fillRoundRect(g, -L / 2 + 8 + i * cw + 0.5, -W / 2 + W * 0.34, cw - 1, W * 0.56, 3, shade(color, 0.14));
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 0.7;
  g.strokeRect(-L / 2 + 0.5, -W / 2 + 0.5, L - 1, W - 1);
}

/** A trestle table with the mission map spread over it, pinned at the corners, a lamp and a mug. */
function mapTable(g, L, W, color) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-L / 2 + 1.5, -W / 2 + 2, L, W);
  fillRoundRect(g, -L / 2, -W / 2, L, W, 2, color);
  g.strokeStyle = shade(color, -0.45);
  g.lineWidth = 1;
  g.strokeRect(-L / 2 + 0.5, -W / 2 + 0.5, L - 1, W - 1);
  const pw = L - 22, ph = W - 14;
  fillRoundRect(g, -pw / 2, -ph / 2, pw, ph, 1.5, '#d9c9a0');
  g.strokeStyle = 'rgba(70,90,110,0.55)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-pw / 2 + 6, ph / 2 - 6);
  g.bezierCurveTo(-pw * 0.2, -ph * 0.1, pw * 0.05, ph * 0.3, pw / 2 - 6, -ph / 2 + 7);
  g.stroke();
  g.setLineDash([3, 3]);
  g.strokeStyle = 'rgba(160,50,40,0.75)';
  g.beginPath();
  g.moveTo(-pw / 2 + 8, -ph / 4);
  g.lineTo(pw / 4, ph / 4);
  g.stroke();
  g.setLineDash([]);
  for (const [x, y] of [[-pw * 0.3, -ph * 0.15], [pw * 0.1, ph * 0.18], [pw * 0.34, -ph * 0.28]]) fillCircle(g, x, y, 2.4, '#d43a2c');
  fillCircle(g, L / 2 - 9, -W / 2 + 8, 3.2, '#e8e2d0');
}

/** A workbench: planks, a vise, a couple of tools and a coffee can. */
function workbench(g, L, W, color, rng) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-L / 2 + 1.5, -W / 2 + 2, L, W);
  fillRoundRect(g, -L / 2, -W / 2, L, W, 2, color);
  g.strokeStyle = shade(color, -0.4);
  g.lineWidth = 0.9;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(-L / 2, -W / 2 + (W * i) / 4);
    g.lineTo(L / 2, -W / 2 + (W * i) / 4);
    g.stroke();
  }
  fillRoundRect(g, -L / 2 + 6, -W / 2 + 4, 12, 9, 1.5, '#4a5058');
  fillRoundRect(g, -L / 2 + 20, -W / 2 + W * 0.45, 26, 4, 1.5, '#8a8f95');
  fillRoundRect(g, L * 0.1, -W * 0.15, 20, 5, 1.5, '#a8382a');
  fillCircle(g, L / 2 - 12, -W / 2 + 10, 5, '#3a3f45');
  for (let i = 0; i < 6; i++) fillCircle(g, -L / 2 + 8 + rng.next() * (L - 16), -W / 2 + 4 + rng.next() * (W - 8), 0.9, '#c2c6ca');
}

/** The range's firing bench: a long plank with sandbag rests. */
function rangeBench(g, L, W, color) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-L / 2 + 1.5, -W / 2 + 2, L, W);
  fillRoundRect(g, -L / 2, -W / 2, L, W, 2, color);
  g.strokeStyle = shade(color, -0.4);
  g.lineWidth = 0.9;
  g.strokeRect(-L / 2 + 0.5, -W / 2 + 0.5, L - 1, W - 1);
  for (const f of [0.2, 0.5, 0.8]) fillRoundRect(g, -L / 2 + L * f - 9, -W * 0.32, 18, W * 0.64, 4, '#9a8a62');
}

/** A round bale seen from above: coils of straw. */
function hayBale(g, L, W, color, rng) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  fillRoundRect(g, -L / 2 + 1.5, -W / 2 + 2, L, W, W * 0.3);
  fillRoundRect(g, -L / 2, -W / 2, L, W, W * 0.3, color);
  g.strokeStyle = shade(color, -0.3);
  g.lineWidth = 0.8;
  for (let i = 1; i < 6; i++) {
    const x = -L / 2 + (L * i) / 6;
    g.beginPath();
    g.moveTo(x, -W / 2 + 1.5);
    g.lineTo(x + (rng.next() - 0.5) * 2, W / 2 - 1.5);
    g.stroke();
  }
  g.strokeStyle = '#5a4a2a';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-L * 0.16, -W / 2);
  g.lineTo(-L * 0.16, W / 2);
  g.moveTo(L * 0.16, -W / 2);
  g.lineTo(L * 0.16, W / 2);
  g.stroke();
}

/** A painted board on posts: a plank face with a lighter lettering stripe. */
function signBoard(g, L, W, color) {
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-L / 2 + 1.5, -W / 2 + 2, L, W);
  fillRoundRect(g, -L / 2, -W / 2, L, W, 1.5, color);
  g.fillStyle = rgba('#f2e6c4', 0.85);
  g.fillRect(-L / 2 + 4, -W * 0.18, L - 8, W * 0.36);
  g.strokeStyle = shade(color, -0.5);
  g.lineWidth = 0.9;
  g.strokeRect(-L / 2 + 0.5, -W / 2 + 0.5, L - 1, W - 1);
}
