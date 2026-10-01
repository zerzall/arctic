// Top-down vector art for every static thing on the map: vehicles, barriers, buildings,
// the objective and the supply station. Each draw function paints the object centred on
// the origin in its own frame (length along +x = obstacle.w, width along y = obstacle.h,
// the front of vehicles facing +x). The renderer caches the static ones as sprites.

import {
  createRng, mix, shade, rgba, roundRectPath, fillRoundRect, fillCircle, fillEllipse, blobPath,
} from './util.js';
import { drawCampaignObstacle } from './obstacles-campaign.js';
import { drawHubObstacle } from './obstacles-hideout.js';

const GLASS = '#18222b';
const TYRE = '#0e0e0f';

/** Extra margin (world px) a sprite needs around an obstacle's rectangle. */
export function obstaclePad(o) {
  switch (o.kind) {
    case 'tent': return 10;
    case 'tree': return 6;
    case 'silo': return 8;
    case 'grave': return 28;
    case 'car': case 'suv': case 'pickup': case 'van': return 5;
    default: return 4;
  }
}

/**
 * Paint obstacle `o` centred at the origin, unrotated.
 * @param {CanvasRenderingContext2D} g
 * @param {object} o Obstacle (SPEC §2)
 * @param {number} seed per-map seed so wreck details are stable across clients
 */
export function drawObstacle(g, o, seed = 0) {
  const rng = createRng((seed * 7919 + (o.id | 0) * 104729 + 17) >>> 0);
  // a story hideout's hero obstacles (fire ring, log seats, couch, tables) have their own art
  if (o.prop && drawHubObstacle(g, o, rng)) return;
  const L = o.w, W = o.h;
  switch (o.kind) {
    case 'car': case 'suv': case 'pickup': case 'van': case 'truck':
      drawVehicle(g, o.kind, L, W, o.color, o.wrecked, rng); break;
    case 'semi':
      if (L <= 100) drawSemiCab(g, L, W, o.color, o.wrecked, rng);
      else drawTrailer(g, L, W, o.color, o.wrecked, rng);
      break;
    case 'bus': drawBusBody(g, L, W, o.color, o.wrecked, rng, false); break;
    case 'tanker': drawTanker(g, L, W, o.color, o.wrecked, rng); break;
    case 'barrier': drawJersey(g, L, W, o.color, rng); break;
    case 'sandbags': drawSandbags(g, L, W, o.color, rng); break;
    case 'building': drawBuilding(g, L, W, o.color, o.roof, rng); break;
    case 'wall': drawWall(g, L, W, o.color, rng); break;
    case 'container': drawContainer(g, L, W, o.color, rng); break;
    case 'pump': drawPump(g, L, W, o.color, rng); break;
    case 'tree': drawTrunk(g, L, W, o.color, rng); break;
    case 'rock': drawRock(g, L, W, o.color, rng); break;
    case 'hesco': drawHesco(g, L, W, o.color, rng); break;
    case 'tent': drawTent(g, L, W, o.color, o.roof, rng); break;
    case 'booth': drawBooth(g, L, W, o.color, o.roof, rng); break;
    case 'guardrail': drawGuardrail(g, L, W, o.color); break;
    case 'pillar': drawPillar(g, L, W, o.color); break;
    case 'pier': drawPier(g, L, W, o.color); break;
    case 'ramp': drawRamp(g, L, W, o.color, o.solid); break;
    case 'silo': drawSilo(g, L, W, o.color, rng); break;
    case 'grave': drawGrave(g, L, W, o.color, rng); break;
    default:
      // (the Campaign's kinds live in obstacles-campaign.js)
      if (!drawCampaignObstacle(g, o, rng)) fillRoundRect(g, -L / 2, -W / 2, L, W, 3, o.color || '#777');
  }
}

// ---- vehicles ------------------------------------------------------------------------------

/** Paint gradient across the width so the body reads as curved sheet metal. */
function bodyGrad(g, W, color, x0 = 0) {
  const grad = g.createLinearGradient(x0, -W / 2, x0, W / 2);
  grad.addColorStop(0, shade(color, -0.45));
  grad.addColorStop(0.18, shade(color, -0.05));
  grad.addColorStop(0.5, shade(color, 0.14));
  grad.addColorStop(0.82, shade(color, -0.05));
  grad.addColorStop(1, shade(color, -0.45));
  return grad;
}

function glassGrad(g, x0, x1, broken) {
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  if (broken) {
    grad.addColorStop(0, '#0b0c0d');
    grad.addColorStop(1, '#16181a');
  } else {
    grad.addColorStop(0, '#0f171e');
    grad.addColorStop(0.55, '#2a3a47');
    grad.addColorStop(1, '#101820');
  }
  return grad;
}

function wheels(g, L, W, xs, len, thick) {
  g.fillStyle = TYRE;
  for (const x of xs) {
    fillRoundRect(g, x - len / 2, -W / 2 - 1.5, len, thick, 2);
    fillRoundRect(g, x - len / 2, W / 2 + 1.5 - thick, len, thick, 2);
  }
}

function shatter(g, x0, y0, w, h, rng) {
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.strokeStyle = 'rgba(200,215,225,0.45)';
  g.lineWidth = 0.6;
  const cx = x0 + w * rng.range(0.3, 0.7), cy = y0 + h * rng.range(0.3, 0.7);
  g.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = rng.next() * Math.PI * 2, l = Math.max(w, h) * rng.range(0.3, 0.8);
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
  }
  g.stroke();
  g.fillStyle = 'rgba(210,225,235,0.35)';
  for (let i = 0; i < 10; i++) g.fillRect(x0 + rng.next() * w, y0 + rng.next() * h, 1, 1);
  g.restore();
}

function soot(g, L, W, rng, amount = 1) {
  // keep burn marks on the bodywork
  g.save();
  g.beginPath();
  roundRectPath(g, -L / 2, -W / 2, L, W, Math.min(W * 0.3, 8));
  g.clip();
  for (let i = 0; i < 6 * amount; i++) {
    const x = rng.range(-L * 0.45, L * 0.45), y = rng.range(-W * 0.35, W * 0.35);
    const r = rng.range(W * 0.25, W * 0.6);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(8,6,5,0.55)');
    grad.addColorStop(1, 'rgba(8,6,5,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // rust bloom along panel edges, small and irregular
  for (let i = 0; i < 3 * amount; i++) {
    g.fillStyle = rgba(rng.pick(['#5a2e16', '#6b3a1c', '#3e2412']), 0.45);
    const x = rng.range(-L * 0.45, L * 0.45), y = rng.pick([-1, 1]) * rng.range(W * 0.25, W * 0.45);
    blobPath(g, x, y, rng.range(1.5, 3.5), rng, 7, 0.6);
    g.fill();
  }
  g.restore();
}

function lights(g, L, W, wrecked, frontInset = 2) {
  if (wrecked) return;
  g.fillStyle = '#f4ecd0';
  fillRoundRect(g, L / 2 - frontInset - 2.5, -W / 2 + 3, 3, W * 0.2, 1);
  fillRoundRect(g, L / 2 - frontInset - 2.5, W / 2 - 3 - W * 0.2, 3, W * 0.2, 1);
  g.fillStyle = '#9b1a14';
  fillRoundRect(g, -L / 2 + 0.5, -W / 2 + 3, 2.5, W * 0.18, 1);
  fillRoundRect(g, -L / 2 + 0.5, W / 2 - 3 - W * 0.18, 2.5, W * 0.18, 1);
}

function drawVehicle(g, kind, L, W, color, wrecked, rng) {
  const hl = L / 2, hw = W / 2;
  const wheelLen = L * 0.15;
  const wx = kind === 'truck' ? [L * 0.3, -L * 0.15, -L * 0.33] : [L * 0.3, -L * 0.3];
  wheels(g, L, W, wx, wheelLen, 5);
  // mirrors
  g.fillStyle = shade(color, -0.3);
  const mx = kind === 'van' || kind === 'truck' ? hl - L * 0.2 : L * 0.12;
  fillRoundRect(g, mx - 2, -hw - 3, 4, 4, 1);
  fillRoundRect(g, mx - 2, hw - 1, 4, 4, 1);

  // body
  g.beginPath();
  roundRectPath(g, -hl, -hw, L, W, Math.min(W * 0.3, 10));
  g.fillStyle = bodyGrad(g, W, color);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1.2;
  g.stroke();

  // layout: [windscreen x0, x1], [roof x0, x1], rear window
  let ws0, ws1, rf0, rf1, rw0, rw1;
  switch (kind) {
    case 'suv': ws0 = L * 0.12; ws1 = L * 0.26; rf0 = -L * 0.42; rf1 = L * 0.12; rw0 = -L * 0.47; rw1 = -L * 0.42; break;
    case 'van': ws0 = L * 0.26; ws1 = L * 0.38; rf0 = -L * 0.48; rf1 = L * 0.26; rw0 = 0; rw1 = 0; break;
    case 'pickup': ws0 = L * 0.1; ws1 = L * 0.23; rf0 = -L * 0.08; rf1 = L * 0.1; rw0 = -L * 0.12; rw1 = -L * 0.08; break;
    case 'truck': ws0 = L * 0.3; ws1 = L * 0.38; rf0 = L * 0.12; rf1 = L * 0.3; rw0 = 0; rw1 = 0; break;
    default: ws0 = L * 0.06; ws1 = L * 0.21; rf0 = -L * 0.24; rf1 = L * 0.06; rw0 = -L * 0.34; rw1 = -L * 0.24;
  }
  const gw = hw * 0.78;
  // hood creases
  g.strokeStyle = rgba(shade(color, -0.4), 0.6);
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(ws1 + 3, -hw * 0.35); g.lineTo(hl - 4, -hw * 0.3);
  g.moveTo(ws1 + 3, hw * 0.35); g.lineTo(hl - 4, hw * 0.3);
  g.stroke();

  // windscreen (trapezoid, wider at the base)
  g.beginPath();
  g.moveTo(ws1, -gw); g.lineTo(ws1, gw); g.lineTo(ws0, gw * 0.92); g.lineTo(ws0, -gw * 0.92);
  g.closePath();
  g.fillStyle = glassGrad(g, ws0, ws1, wrecked);
  g.fill();
  if (wrecked) shatter(g, ws0, -gw, ws1 - ws0, gw * 2, rng);
  else {
    g.fillStyle = 'rgba(190,215,235,0.16)';
    g.beginPath();
    g.moveTo(ws1 - 1, -gw * 0.7); g.lineTo(ws1 - 1, -gw * 0.3); g.lineTo(ws0 + 2, gw * 0.1); g.lineTo(ws0 + 2, -gw * 0.3);
    g.fill();
  }
  // side glass strips
  g.fillStyle = wrecked ? '#0c0c0c' : '#15202a';
  g.fillRect(rf0 - (kind === 'pickup' ? 0 : 1), -hw + 2.2, rf1 - rf0 + 1, 2.2);
  g.fillRect(rf0 - (kind === 'pickup' ? 0 : 1), hw - 4.4, rf1 - rf0 + 1, 2.2);

  // roof
  g.beginPath();
  roundRectPath(g, rf0, -hw * 0.74, rf1 - rf0, hw * 1.48, 4);
  const rg = g.createLinearGradient(0, -hw, 0, hw);
  rg.addColorStop(0, shade(color, -0.12));
  rg.addColorStop(0.5, shade(color, wrecked ? -0.05 : 0.22));
  rg.addColorStop(1, shade(color, -0.12));
  g.fillStyle = rg;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.8;
  g.stroke();
  if (kind === 'suv' && !wrecked) {
    g.strokeStyle = 'rgba(20,20,20,0.7)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(rf0 + 4, -hw * 0.55); g.lineTo(rf1 - 4, -hw * 0.55);
    g.moveTo(rf0 + 4, hw * 0.55); g.lineTo(rf1 - 4, hw * 0.55);
    g.stroke();
  }
  if (kind === 'van') {
    g.strokeStyle = rgba(shade(color, -0.35), 0.5);
    g.lineWidth = 1;
    g.beginPath();
    for (let x = rf0 + 12; x < rf1 - 6; x += 14) { g.moveTo(x, -hw * 0.6); g.lineTo(x, hw * 0.6); }
    g.stroke();
  }
  if (rw1 > rw0) {
    g.fillStyle = glassGrad(g, rw0, rw1, wrecked);
    g.fillRect(rw0, -gw * 0.85, rw1 - rw0, gw * 1.7);
    if (wrecked) shatter(g, rw0, -gw * 0.85, rw1 - rw0, gw * 1.7, rng);
  }

  if (kind === 'pickup') {
    // open bed
    const b0 = -hl + 3, b1 = -L * 0.14;
    fillRoundRect(g, b0, -hw + 3.5, b1 - b0, W - 7, 2, shade(color, -0.55));
    g.strokeStyle = rgba(shade(color, -0.7), 0.8);
    g.lineWidth = 0.8;
    g.beginPath();
    for (let y = -hw + 7; y < hw - 5; y += 5) { g.moveTo(b0 + 1, y); g.lineTo(b1 - 1, y); }
    g.stroke();
    if (rng.chance(0.6)) {
      const bx = rng.range(b0 + 6, b1 - 14);
      fillRoundRect(g, bx, -hw * 0.3, 11, 10, 1.5, rng.pick(['#6b5a3a', '#3b4a3a', '#555']));
    }
  }
  if (kind === 'truck') {
    // canvas-covered cargo bed
    const c0 = -hl + 2, c1 = L * 0.08;
    g.beginPath();
    roundRectPath(g, c0, -hw + 1, c1 - c0, W - 2, 4);
    const tg = g.createLinearGradient(0, -hw, 0, hw);
    const tarp = wrecked ? '#2a2620' : mix(color, '#6b6a4a', 0.3);
    tg.addColorStop(0, shade(tarp, -0.35));
    tg.addColorStop(0.5, shade(tarp, 0.12));
    tg.addColorStop(1, shade(tarp, -0.35));
    g.fillStyle = tg;
    g.fill();
    g.strokeStyle = rgba(shade(tarp, -0.5), 0.8);
    g.lineWidth = 1.4;
    g.beginPath();
    for (let x = c0 + 12; x < c1 - 4; x += 16) { g.moveTo(x, -hw + 2); g.lineTo(x, hw - 2); }
    g.stroke();
    if (wrecked) {
      // burnt through canvas shows the rib frame
      g.fillStyle = 'rgba(5,5,5,0.8)';
      blobPath(g, (c0 + c1) / 2, 0, W * 0.35, rng, 10, 0.5);
      g.fill();
    }
  }
  lights(g, L, W, wrecked);
  if (wrecked) soot(g, L, W, rng);
  else {
    // small dirt/grime so vehicles do not look factory fresh
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(30,25,20,0.12)';
      blobPath(g, rng.range(-hl, hl), rng.range(-hw, hw), rng.range(3, 7), rng, 7, 0.5);
      g.fill();
    }
  }
}

function drawSemiCab(g, L, W, color, wrecked, rng) {
  const hl = L / 2, hw = W / 2;
  wheels(g, L, W, [L * 0.28, -L * 0.28], L * 0.22, 6);
  // fuel tanks along the sides
  g.fillStyle = wrecked ? '#2b2b2b' : '#9da3a8';
  fillRoundRect(g, -L * 0.1, -hw - 2, L * 0.3, 4, 2);
  fillRoundRect(g, -L * 0.1, hw - 2, L * 0.3, 4, 2);
  g.beginPath();
  roundRectPath(g, -hl, -hw + 2, L, W - 4, 5);
  g.fillStyle = bodyGrad(g, W - 4, color);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1.2;
  g.stroke();
  // hood with grille
  g.fillStyle = shade(color, -0.1);
  fillRoundRect(g, L * 0.2, -hw * 0.62, hl - L * 0.2 - 1, hw * 1.24, 3);
  g.fillStyle = wrecked ? '#222' : '#c9cdd0';
  g.fillRect(hl - 3, -hw * 0.5, 2.5, hw);
  // windscreen
  g.fillStyle = glassGrad(g, L * 0.08, L * 0.2, wrecked);
  g.fillRect(L * 0.08, -hw * 0.78, L * 0.12, hw * 1.56);
  if (wrecked) shatter(g, L * 0.08, -hw * 0.78, L * 0.12, hw * 1.56, rng);
  // sleeper roof with air deflector
  const rg = g.createLinearGradient(-hl, 0, L * 0.08, 0);
  rg.addColorStop(0, shade(color, -0.2));
  rg.addColorStop(1, shade(color, 0.2));
  g.fillStyle = rg;
  fillRoundRect(g, -hl + 2, -hw * 0.8, L * 0.58, hw * 1.6, 5);
  // exhaust stacks
  g.fillStyle = wrecked ? '#1b1b1b' : '#b8bec2';
  fillCircle(g, L * 0.06, -hw + 3, 2.6);
  fillCircle(g, L * 0.06, hw - 3, 2.6);
  fillCircle(g, L * 0.06, -hw + 3, 1.2, '#111');
  fillCircle(g, L * 0.06, hw - 3, 1.2, '#111');
  lights(g, L, W, wrecked, 1);
  if (wrecked) soot(g, L, W, rng, 0.8);
}

function drawTrailer(g, L, W, color, wrecked, rng) {
  const hl = L / 2, hw = W / 2;
  wheels(g, L, W, [-L * 0.34, -L * 0.42], L * 0.06, 5);
  g.beginPath();
  roundRectPath(g, -hl, -hw, L, W, 2);
  const grad = g.createLinearGradient(0, -hw, 0, hw);
  grad.addColorStop(0, shade(color, -0.35));
  grad.addColorStop(0.1, shade(color, -0.02));
  grad.addColorStop(0.5, shade(color, 0.1));
  grad.addColorStop(0.9, shade(color, -0.02));
  grad.addColorStop(1, shade(color, -0.35));
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1.2;
  g.stroke();
  // roof bows
  g.strokeStyle = rgba(shade(color, -0.3), 0.55);
  g.lineWidth = 1;
  g.beginPath();
  for (let x = -hl + 10; x < hl - 4; x += 12) { g.moveTo(x, -hw + 2); g.lineTo(x, hw - 2); }
  g.stroke();
  // rear door seam
  g.fillStyle = rgba(shade(color, -0.5), 0.9);
  g.fillRect(-hl + 1, -hw + 1, 3, W - 2);
  // company stripe
  if (!wrecked && rng.chance(0.6)) {
    g.fillStyle = rgba(rng.pick(['#b3261e', '#1e5aa8', '#2e7d32', '#f9a825']), 0.7);
    g.fillRect(-hl + 8, -hw + 3, L - 20, 4);
    g.fillRect(-hl + 8, hw - 7, L - 20, 4);
  }
  // grime streaks
  for (let i = 0; i < 10; i++) {
    g.fillStyle = 'rgba(20,18,15,0.1)';
    g.fillRect(rng.range(-hl, hl), -hw, rng.range(3, 12), W);
  }
  if (wrecked) {
    // roof burnt through in the middle: dark interior with the bows still showing
    const x0 = rng.range(-hl * 0.6, 0), len = rng.range(L * 0.3, L * 0.5);
    g.save();
    g.beginPath();
    g.rect(-hl + 3, -hw + 3, L - 6, W - 6);
    g.clip();
    g.fillStyle = 'rgba(8,6,5,0.92)';
    g.save();
    g.translate(x0 + len / 2, 0);
    g.scale(1, (W * 0.42) / (len / 2));
    blobPath(g, 0, 0, len / 2, rng, 14, 0.25);
    g.restore();
    g.fill();
    g.strokeStyle = 'rgba(90,70,55,0.7)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let x = x0; x < x0 + len; x += 12) { g.moveTo(x, -hw + 4); g.lineTo(x, hw - 4); }
    g.stroke();
    g.restore();
    soot(g, L, W, rng, 1.2);
  }
}

/** Long bus body; `school` adds the black rub rails and roof hatches of a school bus. */
export function drawBusBody(g, L, W, color, wrecked, rng, school) {
  const hl = L / 2, hw = W / 2;
  wheels(g, L, W, [L * 0.33, -L * 0.25, -L * 0.33], L * 0.06, 5);
  g.beginPath();
  roundRectPath(g, -hl, -hw, L, W, 7);
  g.fillStyle = bodyGrad(g, W, color);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1.4;
  g.stroke();
  // window bands along both sides (seen past the roof edge)
  const w0 = -hl + 10, w1 = hl - 30;
  g.fillStyle = wrecked ? '#0b0b0b' : '#18232c';
  g.fillRect(w0, -hw + 2.5, w1 - w0, 5);
  g.fillRect(w0, hw - 7.5, w1 - w0, 5);
  g.fillStyle = rgba(shade(color, -0.35), 1);
  for (let x = w0; x <= w1; x += 16) {
    g.fillRect(x, -hw + 2.5, 1.5, 5);
    g.fillRect(x, hw - 7.5, 1.5, 5);
  }
  // hood + windscreen
  g.fillStyle = glassGrad(g, hl - 26, hl - 14, wrecked);
  g.fillRect(hl - 27, -hw + 4, 11, W - 8);
  if (wrecked) shatter(g, hl - 27, -hw + 4, 11, W - 8, rng);
  g.fillStyle = shade(color, -0.08);
  fillRoundRect(g, hl - 15, -hw + 6, 13, W - 12, 3);
  // roof
  const rg = g.createLinearGradient(0, -hw, 0, hw);
  rg.addColorStop(0, shade(color, -0.1));
  rg.addColorStop(0.5, shade(color, wrecked ? -0.05 : 0.18));
  rg.addColorStop(1, shade(color, -0.1));
  g.fillStyle = rg;
  fillRoundRect(g, -hl + 4, -hw + 8, L - 32, W - 16, 5);
  if (school) {
    g.fillStyle = '#141414';
    g.fillRect(-hl + 4, -hw + 8, L - 32, 2);
    g.fillRect(-hl + 4, hw - 10, L - 32, 2);
  }
  // roof hatches
  g.fillStyle = rgba(shade(color, -0.3), 0.9);
  fillRoundRect(g, -L * 0.42, -7, 13, 14, 2);
  fillRoundRect(g, L * 0.18, -7, 13, 14, 2);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.8;
  g.beginPath();
  for (let x = -hl + 12; x < hl - 32; x += 10) { g.moveTo(x, -hw + 11); g.lineTo(x, -hw + 13); g.moveTo(x, hw - 13); g.lineTo(x, hw - 11); }
  g.stroke();
  lights(g, L, W, wrecked);
  if (wrecked) soot(g, L, W, rng, 1.6);
}

function drawTanker(g, L, W, color, wrecked, rng) {
  const hl = L / 2, hw = W / 2;
  const cabL = 54;
  wheels(g, L, W, [hl - 14, -hl + 18, -hl + 34, hl - cabL - 20], 12, 5);
  // cab at the front
  g.save();
  g.translate(hl - cabL / 2, 0);
  g.beginPath();
  roundRectPath(g, -cabL / 2, -hw + 3, cabL, W - 6, 5);
  const cabColor = wrecked ? '#2b241f' : '#8a2f2a';
  g.fillStyle = bodyGrad(g, W - 6, cabColor);
  g.fill();
  g.fillStyle = glassGrad(g, -4, 6, wrecked);
  g.fillRect(-2, -hw * 0.72, 9, hw * 1.44);
  g.fillStyle = shade(cabColor, 0.15);
  fillRoundRect(g, -cabL / 2 + 3, -hw * 0.72, cabL * 0.45, hw * 1.44, 4);
  g.restore();
  // cylindrical tank
  const t0 = -hl, t1 = hl - cabL - 4;
  g.beginPath();
  roundRectPath(g, t0, -hw, t1 - t0, W, hw * 0.9);
  const tg = g.createLinearGradient(0, -hw, 0, hw);
  tg.addColorStop(0, shade(color, -0.55));
  tg.addColorStop(0.28, shade(color, 0.05));
  tg.addColorStop(0.42, shade(color, 0.45));
  tg.addColorStop(0.55, shade(color, 0.1));
  tg.addColorStop(1, shade(color, -0.6));
  g.fillStyle = tg;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1.2;
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  for (let x = t0 + 30; x < t1 - 10; x += 36) { g.moveTo(x, -hw + 1); g.lineTo(x, hw - 1); }
  g.stroke();
  // catwalk + hatches
  g.fillStyle = 'rgba(40,40,40,0.8)';
  g.fillRect(t0 + 20, -3, t1 - t0 - 40, 6);
  for (let x = t0 + 40; x < t1 - 30; x += 50) fillCircle(g, x, 0, 5, shade(color, -0.25));
  // hazard diamond
  g.save();
  g.translate(t0 + 18, -hw * 0.55);
  g.rotate(Math.PI / 4);
  g.fillStyle = wrecked ? '#4a3a1a' : '#e0a21b';
  g.fillRect(-4, -4, 8, 8);
  g.restore();
  if (wrecked) soot(g, L, W, rng, 1.8);
}

// ---- barriers, walls ------------------------------------------------------------------------

function drawJersey(g, L, W, color, rng) {
  const hl = L / 2, hw = W / 2;
  const seg = Math.max(1, Math.round(L / 48));
  const sl = L / seg;
  for (let i = 0; i < seg; i++) {
    const x0 = -hl + i * sl;
    g.beginPath();
    roundRectPath(g, x0 + 0.6, -hw, sl - 1.2, W, 2.5);
    const grad = g.createLinearGradient(0, -hw, 0, hw);
    grad.addColorStop(0, shade(color, -0.45));
    grad.addColorStop(0.35, shade(color, 0.05));
    grad.addColorStop(0.5, shade(color, 0.3));
    grad.addColorStop(0.65, shade(color, 0.05));
    grad.addColorStop(1, shade(color, -0.45));
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.8;
    g.stroke();
    // chips + reflector
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x0 + rng.range(4, sl - 8), -hw + 1, 3, rng.range(1, 3));
    if (i % 2 === 0) {
      g.fillStyle = '#c8b020';
      g.fillRect(x0 + sl / 2 - 2, -1, 4, 2);
    }
  }
}

function drawSandbags(g, L, W, color, rng) {
  const hw = W / 2;
  const rows = W > 26 ? 3 : 2;
  const bagW = 16, bagH = W / rows;
  for (let r = 0; r < rows; r++) {
    const y = -hw + bagH * (r + 0.5);
    const off = r % 2 ? bagW / 2 : 0;
    for (let x = -L / 2 + off - bagW / 2; x < L / 2; x += bagW) {
      const cx = Math.max(-L / 2 + bagW * 0.45, Math.min(L / 2 - bagW * 0.45, x + bagW / 2));
      const c = mix(color, rng.chance(0.5) ? '#a8986a' : '#6a5a3a', rng.next() * 0.35);
      fillEllipse(g, cx + 0.8, y + 1, bagW * 0.52, bagH * 0.55, 'rgba(0,0,0,0.35)');
      const grad = g.createRadialGradient(cx - 2, y - 2, 1, cx, y, bagW * 0.6);
      grad.addColorStop(0, shade(c, 0.25));
      grad.addColorStop(1, shade(c, -0.3));
      fillEllipse(g, cx, y, bagW * 0.5, bagH * 0.52, grad);
      g.strokeStyle = 'rgba(30,25,15,0.4)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(cx - bagW * 0.3, y);
      g.lineTo(cx + bagW * 0.3, y);
      g.stroke();
    }
  }
}

function drawWall(g, L, W, color, rng) {
  const hl = L / 2, hw = W / 2;
  if (W <= 8) {
    // wooden fence: rails with posts
    g.fillStyle = shade(color, -0.2);
    g.fillRect(-hl, -hw, L, W);
    g.fillStyle = shade(color, 0.15);
    g.fillRect(-hl, -hw + 1, L, W * 0.35);
    g.fillStyle = shade(color, -0.45);
    for (let x = -hl; x <= hl; x += 32) fillRoundRect(g, Math.min(x, hl - 5), -hw - 1.5, 5, W + 3, 1);
    for (let i = 0; i < L / 60; i++) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(rng.range(-hl, hl), -hw, rng.range(3, 9), W);
    }
    return;
  }
  // masonry wall: top coping with block joints
  const grad = g.createLinearGradient(0, -hw, 0, hw);
  grad.addColorStop(0, shade(color, -0.3));
  grad.addColorStop(0.5, shade(color, 0.15));
  grad.addColorStop(1, shade(color, -0.3));
  g.fillStyle = grad;
  g.fillRect(-hl, -hw, L, W);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.8;
  g.beginPath();
  for (let x = -hl + 20; x < hl; x += 20) { g.moveTo(x, -hw); g.lineTo(x, hw); }
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.strokeRect(-hl, -hw, L, W);
}

function drawGuardrail(g, L, W, color) {
  const hl = L / 2, hw = W / 2;
  // posts
  g.fillStyle = '#3a3c3e';
  for (let x = -hl + 6; x < hl; x += 38) g.fillRect(x - 2.5, -hw - 1, 5, W + 2);
  // w-beam
  const grad = g.createLinearGradient(0, -hw, 0, hw);
  grad.addColorStop(0, shade(color, -0.4));
  grad.addColorStop(0.3, shade(color, 0.35));
  grad.addColorStop(0.5, shade(color, -0.15));
  grad.addColorStop(0.7, shade(color, 0.3));
  grad.addColorStop(1, shade(color, -0.4));
  g.fillStyle = grad;
  g.fillRect(-hl, -hw * 0.6, L, W * 1.2 - W * 0.0);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 0.6;
  g.strokeRect(-hl, -hw * 0.6, L, W * 1.2);
}

function drawPillar(g, L, W, color) {
  const grad = g.createLinearGradient(-L / 2, -W / 2, L / 2, W / 2);
  grad.addColorStop(0, shade(color, 0.25));
  grad.addColorStop(1, shade(color, -0.35));
  g.fillStyle = grad;
  g.fillRect(-L / 2, -W / 2, L, W);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1;
  g.strokeRect(-L / 2, -W / 2, L, W);
}

/** Overpass column seen from above: a square concrete shaft (the deck is drawn over it). */
function drawPier(g, L, W, color) {
  const grad = g.createLinearGradient(-L / 2, -W / 2, L / 2, W / 2);
  grad.addColorStop(0, shade(color, 0.3));
  grad.addColorStop(1, shade(color, -0.4));
  fillRoundRect(g, -L / 2, -W / 2, L, W, 5, grad);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1.2;
  g.beginPath();
  roundRectPath(g, -L / 2, -W / 2, L, W, 5);
  g.stroke();
  // yellow-black hazard band on the faces the traffic sees
  g.fillStyle = '#d8b43a';
  for (const s of [-1, 1]) g.fillRect(s > 0 ? L / 2 - 3 : -L / 2, -W / 2 + 4, 3, W - 8);
}

/**
 * A piece of ramp embankment (+x climbs toward the deck): the ramp's road surface between
 * its retaining walls, lighter as it rises, with the parapets along both edges.
 */
function drawRamp(g, L, W, color, solid) {
  const grad = g.createLinearGradient(-L / 2, 0, L / 2, 0);
  grad.addColorStop(0, solid ? '#34363a' : '#2e3033');
  grad.addColorStop(1, solid ? '#3e4044' : '#34363a');
  g.fillStyle = grad;
  g.fillRect(-L / 2, -W / 2, L, W);
  g.fillStyle = shade(color, 0.12);
  for (const s of [-1, 1]) g.fillRect(-L / 2, s > 0 ? W / 2 - 8 : -W / 2, L, 8);
  g.fillStyle = 'rgba(225,225,212,0.6)';
  for (const s of [-1, 1]) g.fillRect(-L / 2, s * (W / 2 - 20) - 1.5, L, 3);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1;
  g.strokeRect(-L / 2, -W / 2, L, W);
}

function drawHesco(g, L, W, color, rng) {
  const cells = Math.max(1, Math.round(L / W));
  const cw = L / cells;
  for (let i = 0; i < cells; i++) {
    const x0 = -L / 2 + i * cw;
    // dirt fill
    const c = mix(color, '#6b5a3a', rng.next() * 0.3);
    g.fillStyle = shade(c, -0.1);
    g.fillRect(x0 + 1, -W / 2 + 1, cw - 2, W - 2);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = rng.chance(0.5) ? rgba(shade(c, 0.25), 0.5) : 'rgba(0,0,0,0.2)';
      fillCircle(g, x0 + 3 + rng.next() * (cw - 6), -W / 2 + 3 + rng.next() * (W - 6), 0.8 + rng.next() * 1.6);
    }
    // geotextile rim + wire mesh
    g.strokeStyle = '#cbbd9a';
    g.lineWidth = 2.2;
    g.strokeRect(x0 + 1.5, -W / 2 + 1.5, cw - 3, W - 3);
    g.strokeStyle = 'rgba(40,40,40,0.55)';
    g.lineWidth = 0.6;
    g.beginPath();
    for (let x = x0 + 5; x < x0 + cw; x += 6) { g.moveTo(x, -W / 2 + 1); g.lineTo(x, W / 2 - 1); }
    for (let y = -W / 2 + 5; y < W / 2; y += 6) { g.moveTo(x0 + 1, y); g.lineTo(x0 + cw - 1, y); }
    g.stroke();
  }
}

// ---- buildings & structures -----------------------------------------------------------------

function drawBuilding(g, L, W, color, roof, rng) {
  const hl = L / 2, hw = W / 2;
  const wall = 5;
  g.fillStyle = shade(color, -0.25);
  g.fillRect(-hl, -hw, L, W);
  // roof
  const rc = roof || '#4e4a45';
  g.fillStyle = rc;
  g.fillRect(-hl + wall, -hw + wall, L - wall * 2, W - wall * 2);
  // weathered noise on the roof
  for (let i = 0; i < (L * W) / 90; i++) {
    g.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)';
    g.fillRect(rng.range(-hl + wall, hl - wall - 3), rng.range(-hw + wall, hw - wall - 3), rng.range(1, 4), rng.range(1, 4));
  }
  // membrane seams
  g.strokeStyle = rgba(shade(rc, -0.35), 0.5);
  g.lineWidth = 1;
  g.beginPath();
  for (let x = -hl + wall + 30; x < hl - wall; x += 30) { g.moveTo(x, -hw + wall); g.lineTo(x, hw - wall); }
  g.stroke();
  // water stains
  for (let i = 0; i < 3; i++) {
    g.fillStyle = 'rgba(0,0,0,0.09)';
    blobPath(g, rng.range(-hl * 0.7, hl * 0.7), rng.range(-hw * 0.6, hw * 0.6), rng.range(8, 24), rng, 11, 0.5);
    g.fill();
  }
  // parapet throws a soft shadow onto the roof (moon from the top-left)
  const ps = g.createLinearGradient(-hl + wall, -hw + wall, -hl + wall + 14, -hw + wall + 14);
  ps.addColorStop(0, 'rgba(0,0,0,0.35)');
  ps.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ps;
  g.fillRect(-hl + wall, -hw + wall, L - wall * 2, 14);
  g.fillRect(-hl + wall, -hw + wall, 14, W - wall * 2);
  // parapet: lit inner edge
  g.strokeStyle = shade(color, 0.2);
  g.lineWidth = 1.2;
  g.strokeRect(-hl + wall - 0.6, -hw + wall - 0.6, L - wall * 2 + 1.2, W - wall * 2 + 1.2);
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = 1.5;
  g.strokeRect(-hl + 0.75, -hw + 0.75, L - 1.5, W - 1.5);
  // rooftop kit: AC units, vents, skylights
  const n = Math.max(1, Math.floor((L * W) / 9000));
  for (let i = 0; i < n; i++) {
    const t = rng.next();
    const x = rng.range(-hl + 22, hl - 22), y = rng.range(-hw + 20, hw - 20);
    if (t < 0.45) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x - 10, y - 8, 22, 18);
      fillRoundRect(g, x - 11, y - 10, 22, 18, 2, '#8d9296');
      fillCircle(g, x, y - 1, 6, '#3a3e41');
      g.strokeStyle = '#6d7276';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x - 6, y - 1); g.lineTo(x + 6, y - 1);
      g.moveTo(x, y - 7); g.lineTo(x, y + 5);
      g.stroke();
    } else if (t < 0.75) {
      fillCircle(g, x + 1, y + 1, 4, 'rgba(0,0,0,0.35)');
      fillCircle(g, x, y, 4, '#6c6f71');
      fillCircle(g, x, y, 2, '#2a2c2d');
    } else {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x - 12, y - 7, 26, 16);
      const gg = g.createLinearGradient(x - 13, y - 8, x + 13, y + 8);
      gg.addColorStop(0, '#1f2b33');
      gg.addColorStop(0.5, '#3c5260');
      gg.addColorStop(1, '#1a232a');
      g.fillStyle = gg;
      g.fillRect(x - 13, y - 8, 26, 16);
      g.strokeStyle = '#777';
      g.lineWidth = 1;
      g.strokeRect(x - 13, y - 8, 26, 16);
    }
  }
}

function drawContainer(g, L, W, color, rng) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = shade(color, -0.1);
  g.fillRect(-hl, -hw, L, W);
  // corrugation across the roof
  for (let x = -hl + 3; x < hl - 3; x += 4) {
    g.fillStyle = (Math.round((x + hl) / 4) % 2) ? shade(color, 0.12) : shade(color, -0.22);
    g.fillRect(x, -hw + 2, 2, W - 4);
  }
  // door end bars
  g.fillStyle = shade(color, -0.45);
  g.fillRect(-hl, -hw, 3, W);
  // corner castings
  g.fillStyle = '#2a2a2a';
  for (const [x, y] of [[-hl, -hw], [hl - 4, -hw], [-hl, hw - 4], [hl - 4, hw - 4]]) g.fillRect(x, y, 4, 4);
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1;
  g.strokeRect(-hl + 0.5, -hw + 0.5, L - 1, W - 1);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = rgba('#6b3a1c', 0.35);
    blobPath(g, rng.range(-hl, hl), rng.range(-hw, hw), rng.range(2, 6), rng, 7, 0.5);
    g.fill();
  }
}

function drawPump(g, L, W, color, rng) {
  // island + dispenser
  fillRoundRect(g, -L / 2, -W / 2, L, W, 3, '#8d8a80');
  g.strokeStyle = '#e0c020';
  g.lineWidth = 1.5;
  g.strokeRect(-L / 2 + 1, -W / 2 + 1, L - 2, W - 2);
  const dl = Math.min(L * 0.6, 22), dw = Math.min(W * 0.6, 14);
  fillRoundRect(g, -dl / 2, -dw / 2, dl, dw, 2, color);
  g.fillStyle = '#1d2a1d';
  g.fillRect(-dl * 0.3, -dw * 0.25, dl * 0.6, dw * 0.5);
  g.fillStyle = rng.pick(['#c62828', '#1565c0', '#2e7d32']);
  g.fillRect(-dl / 2, -dw / 2, dl, 2.5);
  // hose
  g.strokeStyle = '#111';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(dl / 2 - 2, 0);
  g.quadraticCurveTo(dl / 2 + 6, dw / 2 + 4, dl / 2 - 4, dw / 2 + 2);
  g.stroke();
}

function drawTrunk(g, L, W, color) {
  const r = Math.min(L, W) / 2;
  // roots
  g.strokeStyle = shade(color, -0.2);
  g.lineCap = 'round';
  g.lineWidth = 2.5;
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    g.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
    g.lineTo(Math.cos(a + 0.3) * r * 1.05, Math.sin(a + 0.3) * r * 1.05);
  }
  g.stroke();
  const grad = g.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r * 0.75);
  grad.addColorStop(0, shade(color, 0.3));
  grad.addColorStop(1, shade(color, -0.35));
  fillCircle(g, 0, 0, r * 0.72, grad);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.7;
  g.beginPath();
  g.arc(0, 0, r * 0.4, 0, Math.PI * 2);
  g.stroke();
}

function drawRock(g, L, W, color, rng) {
  const r = Math.min(L, W) / 2;
  const rx = L / 2, ry = W / 2;
  g.save();
  g.scale(rx / r, ry / r);
  blobPath(g, 0, 0, r, rng, 9, 0.35);
  g.restore();
  const grad = g.createLinearGradient(-rx, -ry, rx, ry);
  grad.addColorStop(0, shade(color, 0.35));
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, shade(color, -0.45));
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1;
  g.stroke();
  // facets & moss
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    g.moveTo(rng.range(-rx, rx) * 0.5, rng.range(-ry, ry) * 0.5);
    g.lineTo(rng.range(-rx, rx) * 0.8, rng.range(-ry, ry) * 0.8);
  }
  g.stroke();
  g.fillStyle = 'rgba(70,95,50,0.35)';
  blobPath(g, rng.range(-rx, rx) * 0.4, rng.range(-ry, ry) * 0.4, r * 0.3, rng, 7, 0.5);
  g.fill();
}

/** Grain silo from above: a round domed roof with its ribbing, a ladder cage and a vent. */
function drawSilo(g, L, W, color, rng) {
  const r = Math.min(L, W) / 2;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  fillCircle(g, 3, 4, r + 2);
  const grad = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  grad.addColorStop(0, shade(color, 0.45));
  grad.addColorStop(0.6, color);
  grad.addColorStop(1, shade(color, -0.45));
  g.fillStyle = grad;
  fillCircle(g, 0, 0, r);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, 0, r - 0.5, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = shade(color, -0.3);
  fillCircle(g, 0, 0, r * 0.18);
  g.fillStyle = '#3a3c3e';
  g.fillRect(r * 0.72, -3, r * 0.4, 6);
  if (rng.chance(0.5)) {
    g.fillStyle = 'rgba(120,70,40,0.35)';
    blobPath(g, rng.range(-r, r) * 0.4, rng.range(-r, r) * 0.4, r * 0.35, rng, 7, 0.5);
    g.fill();
  }
}

/** Headstone from above: a slim slab (length along x) with a lichen spot and its shadow. */
function drawGrave(g, L, W, color, rng) {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(-L / 2 + 2, -W / 2 + 3, L, W);
  fillRoundRect(g, -L / 2, -W / 2, L, W, Math.min(4, W / 2), color);
  g.fillStyle = shade(color, 0.3);
  g.fillRect(-L / 2 + 2, -W / 2 + 1, L - 4, 2);
  g.fillStyle = 'rgba(80,100,60,0.4)';
  fillCircle(g, rng.range(-L, L) * 0.25, 0, W * 0.3);
  // the grave mound in front of it
  g.fillStyle = 'rgba(40,34,24,0.35)';
  fillEllipse(g, 0, W / 2 + 14, L * 0.45, 12);
}

function drawTent(g, L, W, color, roof, rng) {
  const hl = L / 2, hw = W / 2;
  const rc = roof || color;
  // guy ropes + pegs
  g.strokeStyle = 'rgba(200,190,160,0.5)';
  g.lineWidth = 0.7;
  g.beginPath();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.moveTo(sx * hl * 0.7, sy * hw);
      g.lineTo(sx * (hl + 6), sy * (hw + 8));
    }
  }
  g.stroke();
  // two roof panels meeting at the ridge (along x)
  const g1 = g.createLinearGradient(0, -hw, 0, 0);
  g1.addColorStop(0, shade(rc, -0.25));
  g1.addColorStop(1, shade(rc, 0.2));
  g.fillStyle = g1;
  g.fillRect(-hl, -hw, L, hw);
  const g2 = g.createLinearGradient(0, 0, 0, hw);
  g2.addColorStop(0, shade(rc, -0.1));
  g2.addColorStop(1, shade(rc, -0.45));
  g.fillStyle = g2;
  g.fillRect(-hl, 0, L, hw);
  g.strokeStyle = shade(rc, -0.5);
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-hl, 0); g.lineTo(hl, 0);
  g.stroke();
  // fabric sag folds
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = -hl + L / 4; x < hl; x += L / 4) { g.moveTo(x, -hw); g.lineTo(x, hw); }
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.strokeRect(-hl, -hw, L, W);
  // red cross on medical-looking tents (random)
  if (rng.chance(0.35)) {
    g.fillStyle = 'rgba(230,230,225,0.8)';
    fillCircle(g, 0, -hw / 2, Math.min(9, hw * 0.35));
    g.fillStyle = '#b71c1c';
    g.fillRect(-1.5, -hw / 2 - 5, 3, 10);
    g.fillRect(-5, -hw / 2 - 1.5, 10, 3);
  }
}

function drawBooth(g, L, W, color, roof) {
  const hl = L / 2, hw = W / 2;
  g.fillStyle = shade(color, -0.2);
  g.fillRect(-hl, -hw, L, W);
  // windows band
  g.fillStyle = '#1b2630';
  g.fillRect(-hl + 2, -hw + 2, L - 4, W - 4);
  const rc = roof || shade(color, -0.2);
  const grad = g.createLinearGradient(-hl, -hw, hl, hw);
  grad.addColorStop(0, shade(rc, 0.2));
  grad.addColorStop(1, shade(rc, -0.3));
  g.fillStyle = grad;
  fillRoundRect(g, -hl + 4, -hw + 4, L - 8, W - 8, 2);
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1;
  g.strokeRect(-hl + 0.5, -hw + 0.5, L - 1, W - 1);
  // boom gate stub
  g.fillStyle = '#c62828';
  g.fillRect(hl, -2, 8, 4);
  g.fillStyle = '#eee';
  g.fillRect(hl + 2, -2, 2, 4);
}

// ---- objective ------------------------------------------------------------------------------

/**
 * Static part of the objective (cached as a sprite by the renderer).
 * @param {object} obj MapDef.objective
 */
export function drawObjectiveBase(g, obj, seed = 0) {
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const L = obj.w, W = obj.h;
  switch (obj.kind) {
    case 'bus': drawBusBody(g, L, W, '#e3a41a', false, rng, true); drawSchoolBusExtras(g, L, W, rng); break;
    case 'diner': drawDiner(g, L, W, rng); break;
    case 'apc': drawApcHull(g, L, W, rng); break;
    case 'radio': drawRadioBase(g, L, W); break;
    default: fillRoundRect(g, -L / 2, -W / 2, L, W, 6, '#886');
  }
}

/** Pad (world px) around the objective's rectangle that its art may use (guy wires etc.). */
export function objectivePad(obj) {
  return obj.kind === 'radio' ? 70 : 10;
}

function drawSchoolBusExtras(g, L, W, rng) {
  const hl = L / 2, hw = W / 2;
  // heads of the trapped kids in the side windows
  const w0 = -hl + 12, w1 = hl - 32;
  for (let x = w0 + 6; x < w1; x += 16) {
    for (const side of [-1, 1]) {
      if (!rng.chance(0.55)) continue;
      const y = side * (hw - 5);
      fillCircle(g, x + rng.range(-2, 2), y, 2.4, rng.pick(['#3a2518', '#1d140e', '#6b4a2a', '#b58b4a']));
    }
  }
  // "SCHOOL BUS" lettering on the roof (readable from above, a nod to roof numbers)
  g.save();
  g.fillStyle = 'rgba(20,20,20,0.85)';
  g.font = 'bold 13px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SCHOOL BUS', -L * 0.12, 0.5);
  g.restore();
  // mattress & bags barricaded on the roof hatch
  fillRoundRect(g, hl * 0.35, -hw + 12, 22, 12, 3, '#6e7f96');
  fillRoundRect(g, -hl * 0.72, hw - 24, 16, 10, 2, '#5d4037');
}

function drawDiner(g, L, W, rng) {
  const hl = L / 2, hw = W / 2;
  // chrome & cream walls
  g.fillStyle = '#b9b3a4';
  g.fillRect(-hl, -hw, L, W);
  g.fillStyle = '#d9d3c4';
  g.fillRect(-hl + 2, -hw + 2, L - 4, W - 4);
  // boarded windows on the wall band
  g.fillStyle = '#6b4a2a';
  for (let x = -hl + 16; x < hl - 20; x += 34) {
    g.fillRect(x, -hw - 1, 22, 5);
    g.fillRect(x, hw - 4, 22, 5);
  }
  // roof: teal with a checker trim
  const wall = 8;
  const rg = g.createLinearGradient(0, -hw, 0, hw);
  rg.addColorStop(0, '#2f6f6a');
  rg.addColorStop(0.5, '#3f8a83');
  rg.addColorStop(1, '#2f6f6a');
  g.fillStyle = rg;
  g.fillRect(-hl + wall, -hw + wall, L - wall * 2, W - wall * 2);
  for (let x = -hl + wall; x < hl - wall; x += 8) {
    g.fillStyle = (Math.round((x + hl) / 8) % 2) ? '#111' : '#eee';
    g.fillRect(x, -hw + wall, 8, 4);
    g.fillRect(x, hw - wall - 4, 8, 4);
  }
  // kitchen vent + AC
  fillRoundRect(g, hl - 60, -hw + 22, 26, 20, 2, '#8d9296');
  fillCircle(g, hl - 47, -hw + 32, 7, '#3a3e41');
  fillCircle(g, -hl + 40, hw - 36, 7, '#5f6366');
  fillCircle(g, -hl + 40, hw - 36, 3.5, '#222');
  // sign board where the neon letters sit (letters glow in the emissive pass)
  fillRoundRect(g, -58, -16, 116, 32, 5, '#2a1f24');
  g.strokeStyle = '#c0c0c0';
  g.lineWidth = 1.5;
  g.strokeRect(-58, -16, 116, 32);
  // sandbag nest on the roof for the defenders
  g.save();
  g.translate(-hl + 58, -hw + 42);
  drawSandbags(g, 44, 14, '#8a7a55', rng);
  g.restore();
}

function drawApcHull(g, L, W, rng) {
  const hl = L / 2, hw = W / 2;
  // eight wheels
  g.fillStyle = TYRE;
  for (let i = 0; i < 4; i++) {
    const x = -hl + 22 + i * ((L - 44) / 3);
    fillRoundRect(g, x - 9, -hw - 3, 18, 8, 3);
    fillRoundRect(g, x - 9, hw - 5, 18, 8, 3);
  }
  const col = '#556b2f';
  // angular hull (chamfered octagon)
  const c = 14;
  g.beginPath();
  g.moveTo(-hl + c, -hw + 2); g.lineTo(hl - c * 1.6, -hw + 2); g.lineTo(hl, -hw + c); g.lineTo(hl, hw - c);
  g.lineTo(hl - c * 1.6, hw - 2); g.lineTo(-hl + c, hw - 2); g.lineTo(-hl, hw - c); g.lineTo(-hl, -hw + c);
  g.closePath();
  g.fillStyle = bodyGrad(g, W, col);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  g.lineWidth = 1.5;
  g.stroke();
  // camo blotches
  g.save();
  g.clip();
  for (let i = 0; i < 14; i++) {
    g.fillStyle = rgba(rng.pick(['#3b4a22', '#6b7a45', '#2e3520']), 0.55);
    blobPath(g, rng.range(-hl, hl), rng.range(-hw, hw), rng.range(6, 14), rng, 8, 0.5);
    g.fill();
  }
  g.restore();
  // glacis plate + panel lines
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(hl - 26, -hw + 6); g.lineTo(hl - 26, hw - 6);
  g.moveTo(-hl + 14, -hw + 8); g.lineTo(-hl + 14, hw - 8);
  g.stroke();
  // rear hatches
  fillRoundRect(g, -hl + 20, -14, 24, 12, 2, shade(col, -0.2));
  fillRoundRect(g, -hl + 20, 2, 24, 12, 2, shade(col, -0.2));
  // stowed gear
  fillRoundRect(g, -hl + 50, hw - 16, 20, 8, 2, '#6b5a3a');
  fillRoundRect(g, 4, -hw + 7, 26, 7, 2, '#3a3a2a');
  // unit markings
  g.fillStyle = 'rgba(230,230,210,0.6)';
  g.font = 'bold 9px sans-serif';
  g.textAlign = 'center';
  g.fillText('U.S.', -hl + 32, hw - 22);
}

function drawRadioBase(g, L, W) {
  const hl = L / 2, hw = W / 2;
  // guy wire anchors out on the ground
  g.strokeStyle = 'rgba(190,190,190,0.45)';
  g.lineWidth = 0.8;
  g.beginPath();
  const anchors = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sy] of anchors) {
    g.moveTo(sx * 6, sy * 6);
    g.lineTo(sx * (hl + 60), sy * (hw + 60));
  }
  g.stroke();
  for (const [sx, sy] of anchors) fillRoundRect(g, sx * (hl + 60) - 4, sy * (hw + 60) - 4, 8, 8, 1, '#777');
  // concrete pad
  fillRoundRect(g, -hl, -hw, L, W, 3, '#7a7870');
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1;
  g.strokeRect(-hl + 0.5, -hw + 0.5, L - 1, W - 1);
  // lattice tower seen from the top: square frame with cross braces tapering inwards
  g.strokeStyle = '#b9bcbf';
  g.lineWidth = 1.6;
  for (let k = 0; k < 4; k++) {
    const s = hl * (0.85 - k * 0.2);
    g.strokeRect(-s, -s, s * 2, s * 2);
  }
  g.lineWidth = 1;
  g.beginPath();
  const s0 = hl * 0.85, s1 = hl * 0.25;
  for (const [sx, sy] of anchors) {
    g.moveTo(sx * s0, sy * s0);
    g.lineTo(sx * s1, sy * s1);
  }
  for (let k = 0; k < 3; k++) {
    const a = hl * (0.85 - k * 0.2), b = hl * (0.65 - k * 0.2);
    g.moveTo(-a, -a); g.lineTo(b, -b);
    g.moveTo(a, -a); g.lineTo(b, b);
    g.moveTo(a, a); g.lineTo(-b, b);
    g.moveTo(-a, a); g.lineTo(-b, -b);
  }
  g.stroke();
  // dishes & antenna mast
  fillCircle(g, -hl * 0.35, hl * 0.1, 7, '#d8d8d2');
  fillCircle(g, -hl * 0.35, hl * 0.1, 3, '#9a9a94');
  fillCircle(g, hl * 0.3, -hl * 0.3, 5, '#d8d8d2');
  fillCircle(g, 0, 0, 4, '#e0e0e0');
  // generator + cable
  fillRoundRect(g, hl - 4, hw - 20, 22, 16, 2, '#5b6150');
  g.strokeStyle = '#111';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(hl - 4, hw - 12);
  g.quadraticCurveTo(hl - 14, hw - 4, hl * 0.4, hw * 0.4);
  g.stroke();
}

/**
 * Animated parts of the objective drawn every frame on top of the cached base:
 * survivors, the APC turret, beacons. Emissive bits go through `glow`.
 * @param {number} t seconds
 */
export function drawObjectiveLive(g, obj, t) {
  const L = obj.w, W = obj.h, hl = L / 2, hw = W / 2;
  if (obj.kind === 'bus') {
    // two survivors climbed out of the roof hatches, one waving for help
    survivor(g, -L * 0.42 + 6, 0, t, 0, '#6e4b32', '#3f6fae', true);
    survivor(g, L * 0.18 + 6, 0, t, 1.7, '#e0b394', '#a53d3d', false);
  } else if (obj.kind === 'diner') {
    survivor(g, -hl + 50, -hw + 32, t, 0.4, '#8d5a3b', '#4a5a3a', false, -Math.PI / 2);
    survivor(g, hl - 40, hw - 32, t, 2.1, '#e0b394', '#6b3a5e', true);
  } else if (obj.kind === 'apc') {
    // turret sweeps slowly across the approach
    const ta = Math.sin(t * 0.35) * 1.1;
    g.save();
    g.translate(8, 0);
    g.rotate(ta);
    fillCircle(g, 1, 1, 15, 'rgba(0,0,0,0.35)');
    const grad = g.createRadialGradient(-4, -4, 2, 0, 0, 15);
    grad.addColorStop(0, '#6f8a40');
    grad.addColorStop(1, '#394820');
    fillCircle(g, 0, 0, 14, grad);
    g.fillStyle = '#222';
    g.fillRect(8, -2.2, 42, 4.4);
    g.fillRect(46, -3, 6, 6);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, 14, 0, Math.PI * 2);
    g.stroke();
    // commander in the hatch
    fillCircle(g, -5, 5, 4.5, '#4b5320');
    fillCircle(g, -5, 5, 3, '#2e3520');
    g.restore();
  } else if (obj.kind === 'radio') {
    survivor(g, hl + 12, hw - 4, t, 0.9, '#b9835a', '#2f4858', false, Math.PI * 0.8);
  }
}

/** A small top-down civilian survivor; `wave` animates an arm waving for help. */
function survivor(g, x, y, t, ph, skin, shirt, wave, facing = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(facing + Math.sin(t * 0.7 + ph) * 0.4);
  fillEllipse(g, 0.8, 0.8, 5, 7, 'rgba(0,0,0,0.35)');
  fillEllipse(g, 0, 0, 4.5, 6.5, shirt);
  // arms
  g.strokeStyle = skin;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  const wv = wave ? Math.sin(t * 7 + ph) * 0.6 : 0;
  g.moveTo(0, -5); g.lineTo(6 + Math.cos(wv) * 3, -8 - Math.abs(wv) * 4);
  g.moveTo(0, 5); g.lineTo(5, 6);
  g.stroke();
  fillCircle(g, 0.5, 0, 3.4, skin);
  fillCircle(g, -0.6, 0, 2.6, '#2a1d14');
  g.restore();
}

// ---- supply station -------------------------------------------------------------------------

/** Static supply dump: tarp, crates, ammo boxes, fuel can. Centred, ~110 x 80 px. */
export function drawSupplyBase(g) {
  const rng = createRng(20240);
  // tarp
  g.save();
  g.rotate(0.05);
  fillRoundRect(g, -52, -36, 104, 72, 4, '#2f3a2a');
  g.strokeStyle = '#4a5a3c';
  g.lineWidth = 1.5;
  g.strokeRect(-50, -34, 100, 68);
  g.fillStyle = '#9aa0a0';
  for (const [x, y] of [[-50, -34], [50, -34], [-50, 34], [50, 34]]) fillCircle(g, x, y, 1.6);
  g.restore();
  // wooden crates
  const crate = (x, y, s, a) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(-s / 2 + 2, -s / 2 + 2, s, s);
    const grad = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    grad.addColorStop(0, '#a07a48');
    grad.addColorStop(1, '#6b4a26');
    g.fillStyle = grad;
    g.fillRect(-s / 2, -s / 2, s, s);
    g.strokeStyle = '#4a3218';
    g.lineWidth = 1.5;
    g.strokeRect(-s / 2 + 0.75, -s / 2 + 0.75, s - 1.5, s - 1.5);
    g.beginPath();
    g.moveTo(-s / 2, -s / 2); g.lineTo(s / 2, s / 2);
    g.moveTo(-s / 2, 0); g.lineTo(s / 2, 0);
    g.stroke();
    g.restore();
  };
  crate(-34, -18, 24, 0.1);
  crate(-30, 10, 22, -0.08);
  crate(-8, -22, 18, 0.25);
  // olive ammo cans with yellow stencils
  for (let i = 0; i < 5; i++) {
    const x = 6 + (i % 3) * 14, y = 4 + Math.floor(i / 3) * 18;
    g.save();
    g.translate(x, y);
    g.rotate(rng.range(-0.15, 0.15));
    fillRoundRect(g, -5.5, -8.5, 12, 17, 1.5, 'rgba(0,0,0,0.4)');
    fillRoundRect(g, -6, -9, 12, 17, 1.5, '#4b5320');
    g.fillStyle = '#6b7340';
    g.fillRect(-6, -9, 12, 3);
    g.fillStyle = '#d8c040';
    g.fillRect(-3, 0, 6, 1.5);
    g.restore();
  }
  // red jerry can
  fillRoundRect(g, 30, -26, 12, 16, 2, '#9b1c1c');
  g.fillStyle = '#c62828';
  g.fillRect(32, -24, 8, 2);
  // flag pole base (the flag itself is animated)
  fillCircle(g, 42, 28, 3.2, '#333');
  fillCircle(g, 42, 28, 1.6, '#999');
}

/** Waving flag on the supply pole — drawn every frame. */
export function drawSupplyFlag(g, t) {
  g.save();
  g.translate(42, 28);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  const segs = 8, len = 26;
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    pts.push([u * len, Math.sin(t * 5 - u * 5) * 3 * u]);
  }
  g.fillStyle = '#e66a1e';
  g.beginPath();
  g.moveTo(0, -6);
  for (const [x, y] of pts) g.lineTo(x, y - 6 + Math.sin(t * 5 - x * 0.2) * 0.8);
  for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + 6);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.fillRect(6, -1.2 + Math.sin(t * 5 - 1.5) * 1.2, 10, 2.4);
  g.fillRect(9.8, -5 + Math.sin(t * 5 - 1.5) * 1.2, 2.4, 10);
  fillCircle(g, 0, 0, 2.2, '#bbb');
  g.restore();
}
