// Top-down art of the Campaign's obstacle kinds (SPEC §2 / §3.8): the hill's palisade and
// watchtowers, the tower's roof, and the interiors (walls, desks, cabinets, counters, columns,
// stairs, air handlers, the roof's parapet, the radio mast). Same frame as obstacles.js: the
// obstacle centred on the origin, length along +x (o.w), width along y (o.h).

import { shade, rgba, fillRoundRect, fillCircle } from './util.js';

const KINDS = new Set(['palisade', 'watchtower', 'tower', 'iwall', 'desk', 'cabinet', 'counter', 'ipillar', 'stairs', 'hvac', 'parapet', 'rim', 'mast']);

/** True for the kinds this file draws. */
export function isCampaignKind(kind) {
  return KINDS.has(kind);
}

/**
 * Paint a campaign obstacle. Returns false when `o.kind` is not one of them.
 * @param {CanvasRenderingContext2D} g
 * @param {object} o obstacle
 * @param {object} rng seeded stream (createRng)
 */
export function drawCampaignObstacle(g, o, rng) {
  const L = o.w, W = o.h, c = o.color;
  switch (o.kind) {
    case 'palisade': palisade(g, L, W, c || '#6b4f32', rng); return true;
    case 'watchtower': watchtower(g, L, W, c || '#5a4630'); return true;
    case 'tower': towerRoof(g, L, W, c || '#5d6c7a'); return true;
    case 'iwall': iwall(g, L, W, c || '#8d949b'); return true;
    case 'desk': desk(g, L, W, c || '#7a6a55', rng); return true;
    case 'cabinet': cabinet(g, L, W, c || '#6a7078'); return true;
    case 'counter': counter(g, L, W, c || '#8a7a66'); return true;
    case 'ipillar': ipillar(g, L, W, c || '#b0b5ba'); return true;
    case 'stairs': stairs(g, L, W, c || '#9aa0a6'); return true;
    case 'hvac': hvac(g, L, W, c || '#8a9096'); return true;
    case 'parapet': parapet(g, L, W, c || '#a8adb2'); return true;
    case 'rim': return true;              // an invisible edge: the drop is the terrain's
    case 'mast': mast(g, L, W, c || '#b8bdc2'); return true;
    default: return false;
  }
}

/** Sharpened logs standing side by side. */
function palisade(g, L, W, color, rng) {
  const n = Math.max(2, Math.round(L / (W * 0.8)));
  const step = L / n;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-L / 2 + 1, -W / 2 + 1.5, L, W);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + step * (i + 0.5);
    g.fillStyle = shade(color, -0.1 + rng.next() * 0.25);
    g.beginPath();
    g.ellipse(x, 0, step * 0.5 - 0.6, W / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 0.7;
    g.stroke();
    g.fillStyle = rgba(shade(color, 0.35), 0.5);
    fillCircle(g, x - step * 0.12, -W * 0.15, step * 0.14);
  }
  // the lashing rail along the top
  g.strokeStyle = '#3b2c1c';
  g.lineWidth = Math.max(1.4, W * 0.16);
  g.beginPath();
  g.moveTo(-L / 2, 0);
  g.lineTo(L / 2, 0);
  g.stroke();
}

/** A timber tower seen from above: platform, roof, railing, ladder. */
function watchtower(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = 'rgba(0,0,0,0.32)';
  g.fillRect(-hl + 4, -hw + 5, L, W);
  g.fillStyle = shade(color, -0.25);
  g.fillRect(-hl, -hw, L, W);
  // planks
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.8;
  g.beginPath();
  for (let x = -hl + 8; x < hl; x += 8) { g.moveTo(x, -hw); g.lineTo(x, hw); }
  g.stroke();
  // roof, a pyramid
  const rc = shade(color, 0.05);
  g.fillStyle = rc;
  g.beginPath();
  g.moveTo(-hl * 0.85, -hw * 0.85);
  g.lineTo(hl * 0.85, -hw * 0.85);
  g.lineTo(hl * 0.85, hw * 0.85);
  g.lineTo(-hl * 0.85, hw * 0.85);
  g.closePath();
  g.fill();
  g.strokeStyle = shade(color, -0.45);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-hl * 0.85, -hw * 0.85); g.lineTo(0, 0); g.lineTo(hl * 0.85, -hw * 0.85);
  g.moveTo(-hl * 0.85, hw * 0.85); g.lineTo(0, 0); g.lineTo(hl * 0.85, hw * 0.85);
  g.stroke();
  g.strokeStyle = shade(color, -0.5);
  g.lineWidth = 2;
  g.strokeRect(-hl + 1, -hw + 1, L - 2, W - 2);
  g.fillStyle = shade(color, 0.3);
  fillCircle(g, 0, 0, Math.min(hl, hw) * 0.14);
}

/** The tower's roof: a flat slab, glass strips, the plant on top. */
function towerRoof(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(-hl + 6, -hw + 8, L, W);
  g.fillStyle = shade(color, -0.3);
  g.fillRect(-hl, -hw, L, W);
  g.fillStyle = shade(color, 0.05);
  g.fillRect(-hl + 5, -hw + 5, L - 10, W - 10);
  // curtain-wall bands on the edges
  g.fillStyle = 'rgba(140,190,220,0.35)';
  g.fillRect(-hl + 5, -hw + 5, L - 10, 4);
  g.fillRect(-hl + 5, hw - 9, L - 10, 4);
  // rooftop plant
  for (let i = 0; i < 4; i++) {
    const x = -hl * 0.5 + i * (L * 0.22), y = ((i * 37) % 3 - 1) * W * 0.22;
    fillRoundRect(g, x - 12, y - 9, 24, 18, 2, shade(color, 0.25));
    g.fillStyle = 'rgba(0,0,0,0.35)';
    fillCircle(g, x, y, 5);
  }
  // an H marks the helipad
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(hl * 0.4, 0, Math.min(hl, hw) * 0.34, 0, Math.PI * 2);
  g.stroke();
}

/** An interior partition: a thick wall with a glass-and-plaster look. */
function iwall(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = shade(color, -0.3);
  g.fillRect(-hl, -hw, L, W);
  g.fillStyle = shade(color, 0.12);
  g.fillRect(-hl + 0.8, -hw + 0.8, L - 1.6, W - 1.6);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.7;
  g.strokeRect(-hl + 0.4, -hw + 0.4, L - 0.8, W - 0.8);
}

/** An office desk: a top, a monitor and a chair. */
function desk(g, L, W, color, rng) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-hl + 1.5, -hw + 2, L, W);
  fillRoundRect(g, -hl, -hw, L, W, 2, shade(color, -0.2));
  fillRoundRect(g, -hl + 1.2, -hw + 1.2, L - 2.4, W - 2.4, 1.5, color);
  g.fillStyle = '#20262c';
  g.fillRect(hl * 0.1, -hw * 0.45, hl * 0.4, hw * 0.9 * 0.5);
  g.fillStyle = '#4b90b8';
  g.fillRect(hl * 0.13, -hw * 0.38, hl * 0.34, hw * 0.35);
  g.fillStyle = rgba('#e8e2d0', 0.7);
  g.fillRect(-hl * 0.6 + rng.next() * 4, hw * 0.1, hl * 0.3, hw * 0.3);
}

/** A filing cabinet or shelving unit. */
function cabinet(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  fillRoundRect(g, -hl, -hw, L, W, 1.5, shade(color, -0.3));
  fillRoundRect(g, -hl + 1, -hw + 1, L - 2, W - 2, 1, color);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.8;
  const n = Math.max(2, Math.round(L / 14));
  g.beginPath();
  for (let i = 1; i < n; i++) { const x = -hl + (L * i) / n; g.moveTo(x, -hw + 1); g.lineTo(x, hw - 1); }
  g.stroke();
}

/** A reception counter / long bench. */
function counter(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-hl + 2, -hw + 2.5, L, W);
  fillRoundRect(g, -hl, -hw, L, W, 3, shade(color, -0.3));
  fillRoundRect(g, -hl + 1.5, -hw + 1.5, L - 3, W - 3, 2.5, color);
  g.fillStyle = rgba(shade(color, 0.4), 0.5);
  g.fillRect(-hl + 4, -hw + 3, L - 8, 2);
}

/** A structural column. */
function ipillar(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-hl + 2, -hw + 2.5, L, W);
  g.fillStyle = shade(color, -0.25);
  g.fillRect(-hl, -hw, L, W);
  g.fillStyle = shade(color, 0.15);
  g.fillRect(-hl + 1.5, -hw + 1.5, L - 3, W - 3);
}

/** A flight of stairs seen from above: treads, an arrow up. */
function stairs(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = shade(color, -0.35);
  g.fillRect(-hl, -hw, L, W);
  const n = Math.max(4, Math.round(L / 9));
  for (let i = 0; i < n; i++) {
    g.fillStyle = shade(color, -0.1 + (i / n) * 0.3);
    g.fillRect(-hl + (L * i) / n + 0.4, -hw + 1, L / n - 0.8, W - 2);
  }
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-hl * 0.6, 0);
  g.lineTo(hl * 0.35, 0);
  g.stroke();
  g.beginPath();
  g.moveTo(hl * 0.6, 0);
  g.lineTo(hl * 0.3, -hw * 0.45);
  g.lineTo(hl * 0.3, hw * 0.45);
  g.closePath();
  g.fill();
}

/** A rooftop air handler: a box with two fan grilles. */
function hvac(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = 'rgba(0,0,0,0.32)';
  g.fillRect(-hl + 3, -hw + 4, L, W);
  fillRoundRect(g, -hl, -hw, L, W, 2, shade(color, -0.3));
  fillRoundRect(g, -hl + 1.5, -hw + 1.5, L - 3, W - 3, 1.5, color);
  const r = Math.min(hl * 0.42, hw * 0.7);
  for (const s of [-1, 1]) {
    g.fillStyle = '#30363c';
    fillCircle(g, s * hl * 0.5, 0, r);
    g.strokeStyle = 'rgba(200,205,210,0.6)';
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(s * hl * 0.5, 0, r * 0.55, 0, Math.PI * 2);
    g.moveTo(s * hl * 0.5 - r, 0); g.lineTo(s * hl * 0.5 + r, 0);
    g.moveTo(s * hl * 0.5, -r); g.lineTo(s * hl * 0.5, r);
    g.stroke();
  }
}

/** The roof's edge wall. */
function parapet(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = shade(color, -0.35);
  g.fillRect(-hl, -hw, L, W);
  g.fillStyle = shade(color, 0.12);
  g.fillRect(-hl, -hw + 1, L, Math.max(1, W - 2));
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.7;
  g.beginPath();
  for (let x = -hl + 24; x < hl; x += 24) { g.moveTo(x, -hw); g.lineTo(x, hw); }
  g.stroke();
}

/** A radio mast's foot: a cabinet with the lattice legs. */
function mast(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  fillRoundRect(g, -hl, -hw, L, W, 2, shade(color, -0.3));
  fillRoundRect(g, -hl + 1.5, -hw + 1.5, L - 3, W - 3, 1.5, color);
  g.strokeStyle = '#7c848c';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-hl * 0.7, -hw * 0.7); g.lineTo(hl * 0.7, hw * 0.7);
  g.moveTo(hl * 0.7, -hw * 0.7); g.lineTo(-hl * 0.7, hw * 0.7);
  g.stroke();
  g.fillStyle = '#e04a3a';
  fillCircle(g, 0, 0, Math.min(hl, hw) * 0.16);
}
