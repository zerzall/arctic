// Top-down zombie art. Each type has its own silhouette so a crowd reads at a glance:
// walker (arms out, shuffling), runner (lean, pumping arms), crawler (long and low),
// bloater (swollen belly), spitter (acid sacs, drooling jaw), screamer (pale, black
// hair), brute (huge lopsided shoulders), boss (spined hulk). Proportions follow a real
// top-down human: wide shoulder capsule, small head on top, arms reaching forward.

import { ZOMBIES, ZOMBIE_IDS } from '../shared/zombies.js';
import { createRng, mix, shade, rgba, vivid, fillCircle, fillEllipse, roundRectPath } from './util.js';

const TAU = Math.PI * 2;
const OUT = 'rgba(8,6,6,0.75)';

/** Skin nudged brighter/greener so zombies read against dark ground at night. */
export function zombieSkin(type) {
  const def = ZOMBIES[type] || ZOMBIES.walker;
  return vivid(def.look.skin, 0.2, 0.1);
}

/** Clothes greyed and dirtied: nobody has done laundry since the outbreak. */
export function zombieCloth(type, variant) {
  const def = ZOMBIES[type] || ZOMBIES.walker;
  const c = def.look.clothes[variant % def.look.clothes.length];
  return shade(mix(c, '#45443d', 0.38), -0.08);
}

/**
 * Paint one zombie facing +x centred at the origin (radius from zombies.js).
 * @param {number} ph animation phase in radians
 * @param {boolean} corpse lying dead: arms splayed, head lolled, colours dulled
 */
export function drawZombieShape(g, type, variant, ph, corpse = false) {
  const def = ZOMBIES[type] || ZOMBIES.walker;
  const r = def.radius;
  let skin = zombieSkin(type);
  let cloth = zombieCloth(type, variant);
  if (corpse) {
    skin = mix(skin, '#2a2a24', 0.35);
    cloth = mix(cloth, '#161616', 0.35);
  }
  const rng = createRng(ZOMBIE_IDS.indexOf(type) * 97 + variant * 13 + 1);
  const hair = rng.pick(['#1b120c', '#3a2616', '#262626', '#4a3a2c', '#5a4632']);
  const sw = Math.sin(ph), cw = Math.cos(ph);
  const Z = { g, r, skin, cloth, rng, hair };

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // contact shadow: separates the body from the ground in any light
  const ao = g.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.35);
  ao.addColorStop(0, 'rgba(0,0,0,0.45)');
  ao.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ao;
  g.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);

  if (corpse) {
    drawCorpse(Z, type);
    g.restore();
    return;
  }
  if (type !== 'crawler' && type !== 'boss') g.rotate(sw * (type === 'runner' ? 0.09 : 0.06));
  switch (type) {
    case 'runner': runner(Z, sw); break;
    case 'crawler': crawler(Z, sw, cw); break;
    case 'bloater': bloater(Z, sw); break;
    case 'spitter': spitter(Z, sw); break;
    case 'screamer': screamer(Z, sw); break;
    case 'brute': brute(Z, sw); break;
    case 'boss': boss(Z, sw); break;
    default: walker(Z, sw, cw);
  }
  g.restore();
}

// ---- parts --------------------------------------------------------------------------------

function feet(Z, x, spread, stride, len, w) {
  const c = shade(Z.cloth, -0.5);
  fillEllipse(Z.g, x + stride, -spread, len, w, c);
  fillEllipse(Z.g, x - stride, spread, len, w, c);
}

/** Arm from shoulder (x0,y0) to hand (x1,y1): sleeve then bare rotting forearm. */
function arm(Z, x0, y0, x1, y1, w, sleeve, handR, claws) {
  const { g, skin, cloth } = Z;
  g.strokeStyle = OUT;
  g.lineWidth = w + 1.8;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  const mx = x0 + (x1 - x0) * sleeve, my = y0 + (y1 - y0) * sleeve;
  g.strokeStyle = shade(skin, -0.05);
  g.lineWidth = w;
  g.beginPath(); g.moveTo(mx, my); g.lineTo(x1, y1); g.stroke();
  // highlight along the top of the forearm
  g.strokeStyle = rgba(shade(skin, 0.3), 0.5);
  g.lineWidth = w * 0.3;
  g.beginPath(); g.moveTo(mx, my - w * 0.15); g.lineTo(x1, y1 - w * 0.15); g.stroke();
  if (sleeve > 0) {
    g.strokeStyle = shade(cloth, -0.05);
    g.lineWidth = w + 0.8;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(mx, my); g.stroke();
  }
  fillCircle(g, x1, y1, handR + 0.9, OUT);
  fillCircle(g, x1, y1, handR, shade(skin, -0.15));
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.strokeStyle = claws ? '#ece6d0' : shade(skin, -0.3);
  g.lineWidth = Math.max(0.8, handR * (claws ? 0.3 : 0.35));
  g.beginPath();
  for (let k = -1; k <= 1; k++) {
    const ca = a + k * 0.42;
    g.moveTo(x1 + Math.cos(ca) * handR * 0.7, y1 + Math.sin(ca) * handR * 0.7);
    g.lineTo(x1 + Math.cos(ca) * handR * (claws ? 2.0 : 1.5), y1 + Math.sin(ca) * handR * (claws ? 2.0 : 1.5));
  }
  g.stroke();
}

/** Shoulder capsule with cloth shading, rips and blood streaks. */
function torso(Z, x0, x1, hw, col, opts = {}) {
  const { g, r, rng, skin } = Z;
  const rad = Math.min((x1 - x0) / 2, hw) * 0.95;
  g.beginPath();
  roundRectPath(g, x0 - 1.2, -hw - 1.2, x1 - x0 + 2.4, hw * 2 + 2.4, rad + 1.2);
  g.fillStyle = OUT;
  g.fill();
  g.beginPath();
  roundRectPath(g, x0, -hw, x1 - x0, hw * 2, rad);
  const gy = g.createLinearGradient(0, -hw, 0, hw);
  gy.addColorStop(0, shade(col, -0.35));
  gy.addColorStop(0.3, shade(col, 0.06));
  gy.addColorStop(0.5, shade(col, 0.16));
  gy.addColorStop(0.7, shade(col, 0.06));
  gy.addColorStop(1, shade(col, -0.35));
  g.fillStyle = gy;
  g.fill();
  g.save();
  g.clip();
  // back of the shoulders falls into shadow
  const gx = g.createLinearGradient(x0, 0, x1, 0);
  gx.addColorStop(0, 'rgba(0,0,0,0.35)');
  gx.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.fillStyle = gx;
  g.fillRect(x0, -hw, x1 - x0, hw * 2);
  // rip showing grey skin underneath
  if (opts.rip !== false) {
    const rx = x0 + (x1 - x0) * rng.range(0.2, 0.6), ry = rng.range(-hw * 0.7, hw * 0.7);
    g.fillStyle = shade(skin, -0.25);
    g.beginPath();
    g.moveTo(rx - r * 0.18, ry);
    g.lineTo(rx - r * 0.05, ry - r * 0.14);
    g.lineTo(rx + r * 0.16, ry - r * 0.06);
    g.lineTo(rx + r * 0.1, ry + r * 0.12);
    g.lineTo(rx - r * 0.08, ry + r * 0.1);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(60,10,10,0.6)';
    g.lineWidth = 0.7;
    g.stroke();
  }
  // dried blood soaked in around the collar, a couple of thin drips running back
  const cy = rng.range(-hw * 0.3, hw * 0.3);
  const bg = g.createRadialGradient(x1, cy, 0, x1, cy, (x1 - x0) * 0.8);
  bg.addColorStop(0, 'rgba(70,6,6,0.6)');
  bg.addColorStop(1, 'rgba(70,6,6,0)');
  g.fillStyle = bg;
  g.fillRect(x0, -hw, x1 - x0, hw * 2);
  g.strokeStyle = 'rgba(60,6,6,0.55)';
  for (let i = 0; i < 2; i++) {
    const y = cy + rng.range(-hw * 0.4, hw * 0.4);
    g.lineWidth = r * rng.range(0.04, 0.08);
    g.beginPath();
    g.moveTo(x1 - r * 0.15, y);
    g.quadraticCurveTo(x1 - (x1 - x0) * 0.4, y + rng.range(-2, 2), x1 - (x1 - x0) * rng.range(0.5, 0.8), y + rng.range(-3, 3));
    g.stroke();
  }
  // grime
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(20,15,10,0.18)';
    fillEllipse(g, rng.range(x0, x1), rng.range(-hw, hw), r * rng.range(0.1, 0.25), r * rng.range(0.06, 0.15), null, rng.range(0, 3));
  }
  g.restore();
}

/** Head seen from above: skull, hair mass on the back, ears, a wound. */
function head(Z, x, y, hr, opts = {}) {
  const { g, skin, hair, rng } = Z;
  fillCircle(g, x, y, hr + 1.1, OUT);
  // ears
  fillEllipse(g, x - hr * 0.05, y - hr * 0.95, hr * 0.22, hr * 0.16, shade(skin, -0.15));
  fillEllipse(g, x - hr * 0.05, y + hr * 0.95, hr * 0.22, hr * 0.16, shade(skin, -0.15));
  const gr = g.createRadialGradient(x + hr * 0.2, y - hr * 0.25, hr * 0.1, x, y, hr);
  gr.addColorStop(0, shade(skin, 0.3));
  gr.addColorStop(1, shade(skin, -0.28));
  fillCircle(g, x, y, hr, gr);
  const hc = opts.hair === undefined ? hair : opts.hair;
  if (hc) {
    // ragged hair on the back of the skull, patchy
    g.fillStyle = hc;
    g.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * 0.45 + (i / n) * Math.PI * 1.1;
      const rr = hr * (i % 2 ? 0.92 : 1.02);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.quadraticCurveTo(x + hr * 0.1, y, x + Math.cos(Math.PI * 0.45) * hr, y + Math.sin(Math.PI * 0.45) * hr);
    g.fill();
    fillEllipse(g, x - hr * 0.45, y + hr * 0.2 * (rng.next() - 0.5), hr * 0.18, hr * 0.14, shade(skin, -0.12));
  }
  // wound
  g.strokeStyle = 'rgba(100,10,10,0.85)';
  g.lineWidth = Math.max(0.7, hr * 0.16);
  g.beginPath();
  g.moveTo(x + hr * 0.05, y - hr * 0.55);
  g.lineTo(x + hr * 0.45, y - hr * 0.1);
  g.stroke();
  if (opts.eyes !== false) {
    const er = Math.max(0.7, hr * 0.15);
    fillCircle(g, x + hr * 0.66, y - hr * 0.36, er, '#200000');
    fillCircle(g, x + hr * 0.66, y + hr * 0.36, er, '#200000');
  }
}

// ---- types --------------------------------------------------------------------------------

function walker(Z, sw, cw) {
  const { r } = Z;
  feet(Z, -r * 0.25, r * 0.36, sw * r * 0.28, r * 0.34, r * 0.2);
  arm(Z, r * 0.05, -r * 0.72, r * (1.28 + sw * 0.13), -r * (0.42 + cw * 0.05), r * 0.27, 0.42, r * 0.17);
  arm(Z, r * 0.05, r * 0.72, r * (1.28 - sw * 0.13), r * (0.42 - cw * 0.05), r * 0.27, 0.42, r * 0.17);
  torso(Z, -r * 0.42, r * 0.36, r * 0.92, Z.cloth);
  head(Z, r * 0.12, sw * 0.6, r * 0.36);
}

function runner(Z, sw) {
  const { r } = Z;
  feet(Z, -r * 0.35, r * 0.32, sw * r * 0.55, r * 0.34, r * 0.19);
  arm(Z, r * 0.02, -r * 0.7, r * (0.15 - sw * 0.7), -r * 0.88, r * 0.28, 0.5, r * 0.17);
  arm(Z, r * 0.02, r * 0.7, r * (0.15 + sw * 0.7), r * 0.88, r * 0.28, 0.5, r * 0.17);
  torso(Z, -r * 0.38, r * 0.38, r * 0.82, Z.cloth);
  head(Z, r * 0.42, 0, r * 0.37);
}

function crawler(Z, sw, cw) {
  const { g, r, cloth } = Z;
  // legs dragging behind with a smear
  g.strokeStyle = 'rgba(70,10,10,0.35)';
  g.lineWidth = r * 0.5;
  g.beginPath(); g.moveTo(-r * 0.6, 0); g.lineTo(-r * 1.5, cw * r * 0.1); g.stroke();
  g.strokeStyle = shade(cloth, -0.45);
  g.lineWidth = r * 0.3;
  g.beginPath();
  g.moveTo(-r * 0.6, -r * 0.18); g.lineTo(-r * 1.35, -r * 0.3 + cw * r * 0.08);
  g.moveTo(-r * 0.6, r * 0.18); g.lineTo(-r * 1.3, r * 0.38 - cw * r * 0.08);
  g.stroke();
  arm(Z, r * 0.35, -r * 0.5, r * (1.05 + sw * 0.35), -r * 0.95, r * 0.28, 0.3, r * 0.18, true);
  arm(Z, r * 0.35, r * 0.5, r * (1.05 - sw * 0.35), r * 0.95, r * 0.28, 0.3, r * 0.18, true);
  torso(Z, -r * 0.85, r * 0.55, r * 0.6, cloth);
  head(Z, r * 0.78, 0, r * 0.38);
}

function bloater(Z, sw) {
  const { g, r, skin, rng, cloth } = Z;
  feet(Z, -r * 0.15, r * 0.42, sw * r * 0.12, r * 0.28, r * 0.2);
  arm(Z, r * 0.35, -r * 0.78, r * (0.95 + sw * 0.08), -r * 0.62, r * 0.26, 0.2, r * 0.16);
  arm(Z, r * 0.35, r * 0.78, r * (0.95 - sw * 0.08), r * 0.62, r * 0.26, 0.2, r * 0.16);
  const R = r * 0.93;
  fillCircle(g, 0, 0, R + 1.3, OUT);
  const gr = g.createRadialGradient(r * 0.15, -r * 0.2, r * 0.05, 0, 0, R);
  gr.addColorStop(0, mix(skin, '#c8c070', 0.35));
  gr.addColorStop(0.6, shade(skin, -0.1));
  gr.addColorStop(1, shade(skin, -0.45));
  fillCircle(g, 0, 0, R, gr);
  g.save();
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.clip();
  // mottled rot
  for (let i = 0; i < 9; i++) {
    g.fillStyle = rgba(rng.pick(['#4a5a20', '#5a3a3a', '#3a4a2a']), 0.35);
    fillEllipse(g, rng.range(-R, R) * 0.8, rng.range(-R, R) * 0.8, r * rng.range(0.1, 0.3), r * rng.range(0.08, 0.2), null, rng.range(0, 3));
  }
  // veins
  g.strokeStyle = 'rgba(70,30,60,0.55)';
  g.lineWidth = 0.9;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    let a = rng.next() * TAU, x = Math.cos(a) * r * 0.25, y = Math.sin(a) * r * 0.25;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      a += (rng.next() - 0.5) * 1.1;
      x += Math.cos(a) * r * 0.17; y += Math.sin(a) * r * 0.17;
      g.lineTo(x, y);
    }
  }
  g.stroke();
  // torn shirt over the back
  g.fillStyle = rgba(cloth, 0.95);
  g.beginPath();
  g.moveTo(-R, -R * 0.6);
  for (let i = 0; i <= 8; i++) g.lineTo(-R * 0.45 + (i % 2) * r * 0.12, -R * 0.75 + i * R * 0.19);
  g.lineTo(-R, R * 0.6);
  g.closePath();
  g.fill();
  g.restore();
  // a few fat pustules, off-centre so the belly reads as swollen flesh, not a pattern
  for (let i = 0; i < 4; i++) {
    const a = rng.next() * TAU, d = r * (0.25 + rng.next() * 0.5);
    const pr = r * (0.07 + rng.next() * 0.08);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    fillCircle(g, x, y, pr + 0.8, 'rgba(50,35,10,0.55)');
    const pg = g.createRadialGradient(x - pr * 0.3, y - pr * 0.3, 0, x, y, pr);
    pg.addColorStop(0, '#e8e4a0');
    pg.addColorStop(0.5, '#a8a040');
    pg.addColorStop(1, '#6a6a20');
    fillCircle(g, x, y, pr, pg);
  }
  head(Z, r * 0.72, 0, r * 0.26, { hair: null });
}

function spitter(Z, sw) {
  const { g, r } = Z;
  feet(Z, -r * 0.3, r * 0.34, sw * r * 0.25, r * 0.32, r * 0.19);
  arm(Z, r * 0.02, -r * 0.7, r * (0.85 + sw * 0.1), -r * 0.72, r * 0.25, 0.45, r * 0.16);
  arm(Z, r * 0.02, r * 0.7, r * (0.85 - sw * 0.1), r * 0.72, r * 0.25, 0.45, r * 0.16);
  torso(Z, -r * 0.48, r * 0.3, r * 0.88, Z.cloth);
  // swollen acid sacs on the neck (their glow is added in the emissive pass)
  for (const s of [-1, 1]) {
    fillCircle(g, r * 0.3, s * r * 0.3, r * 0.25, OUT);
    const gr = g.createRadialGradient(r * 0.27, s * r * 0.3 - r * 0.06, 0, r * 0.3, s * r * 0.3, r * 0.24);
    gr.addColorStop(0, '#e8ff9a');
    gr.addColorStop(0.5, '#8fd13a');
    gr.addColorStop(1, '#4a7a18');
    fillCircle(g, r * 0.3, s * r * 0.3, r * 0.23, gr);
  }
  head(Z, r * 0.55, 0, r * 0.35);
  // gaping jaw dripping acid
  fillEllipse(g, r * 0.84, 0, r * 0.12, r * 0.18, '#142205');
  fillCircle(g, r * 1.06, sw * r * 0.1, r * 0.1, '#a6ff3a');
  fillCircle(g, r * 1.22, -sw * r * 0.07, r * 0.07, '#b8ff5a');
  fillCircle(g, r * 1.0, r * 0.16, r * 0.05, '#c8ff70');
}

function screamer(Z, sw) {
  const { g, r, rng } = Z;
  feet(Z, -r * 0.3, r * 0.3, sw * r * 0.25, r * 0.3, r * 0.17);
  // arms hang back along the gaunt body
  arm(Z, -r * 0.02, -r * 0.66, -r * (0.6 + sw * 0.12), -r * 0.9, r * 0.22, 0.45, r * 0.14);
  arm(Z, -r * 0.02, r * 0.66, -r * (0.6 - sw * 0.12), r * 0.9, r * 0.22, 0.45, r * 0.14);
  torso(Z, -r * 0.42, r * 0.3, r * 0.76, Z.cloth, { rip: false });
  // long black hair spilling over the shoulders
  g.fillStyle = '#0e0e0e';
  g.beginPath();
  g.moveTo(r * 0.45, -r * 0.3);
  g.bezierCurveTo(r * 0.1, -r * 0.62, -r * 0.35, -r * 0.55 + sw, -r * 0.62, -r * 0.4);
  g.lineTo(-r * 0.7, -r * 0.1);
  g.lineTo(-r * 0.66, r * 0.15);
  g.lineTo(-r * 0.62, r * 0.4);
  g.bezierCurveTo(-r * 0.35, r * 0.55 - sw, r * 0.1, r * 0.62, r * 0.45, r * 0.3);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(80,80,80,0.5)';
  g.lineWidth = 0.7;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const y = (i / 5 - 0.5) * r * 0.8;
    g.moveTo(r * 0.2, y * 0.6);
    g.quadraticCurveTo(-r * 0.2, y * 1.1 + rng.range(-1, 1), -r * 0.6, y * 1.2);
  }
  g.stroke();
  head(Z, r * 0.32, 0, r * 0.38, { hair: '#0e0e0e' });
  // screaming mouth
  fillEllipse(g, r * 0.62, 0, r * 0.1, r * 0.15, '#050505');
}

function brute(Z, sw) {
  const { g, r } = Z;
  feet(Z, -r * 0.35, r * 0.42, sw * r * 0.2, r * 0.3, r * 0.2);
  arm(Z, r * 0.05, -r * 0.78, r * (0.95 + sw * 0.1), -r * 0.66, r * 0.28, 0.3, r * 0.19, true);
  // grotesquely swollen right arm
  arm(Z, -r * 0.02, r * 0.8, r * (1.0 - sw * 0.1), r * 0.82, r * 0.44, 0.22, r * 0.3, true);
  torso(Z, -r * 0.5, r * 0.4, r * 0.98, mix(Z.cloth, Z.skin, 0.25));
  // shirt burst open over the swollen shoulder: bare, veined muscle
  g.save();
  g.beginPath();
  roundRectPath(g, -r * 0.5, -r * 0.98, r * 0.9, r * 1.96, r * 0.45);
  g.clip();
  const mg = g.createRadialGradient(-r * 0.05, r * 0.55, 0, -r * 0.05, r * 0.55, r * 0.55);
  mg.addColorStop(0, shade(Z.skin, 0.05));
  mg.addColorStop(0.7, shade(Z.skin, -0.25));
  mg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mg;
  g.fillRect(-r * 0.6, 0, r * 1.2, r);
  g.strokeStyle = 'rgba(70,30,50,0.45)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(-r * 0.3, r * 0.4); g.lineTo(-r * 0.05, r * 0.55); g.lineTo(r * 0.15, r * 0.5);
  g.moveTo(-r * 0.05, r * 0.55); g.lineTo(-r * 0.1, r * 0.8);
  g.stroke();
  g.restore();
  // bone spurs through the back
  g.fillStyle = '#e6dfc8';
  g.strokeStyle = OUT;
  g.lineWidth = 0.8;
  for (const [x, y, a] of [[-r * 0.3, -r * 0.62, -2.3], [-r * 0.45, -r * 0.2, -2.9], [-r * 0.42, r * 0.3, 2.8], [-r * 0.3, r * 0.68, 2.3]]) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -r * 0.07); g.lineTo(r * 0.3, 0); g.lineTo(0, r * 0.07);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  head(Z, r * 0.22, -r * 0.05, r * 0.26, { hair: null });
}

function boss(Z, sw) {
  const { g, r, rng, skin } = Z;
  feet(Z, -r * 0.3, r * 0.42, sw * r * 0.15, r * 0.28, r * 0.19);
  arm(Z, r * 0.1, -r * 0.8, r * (1.0 + sw * 0.1), -r * 0.6, r * 0.3, 0.2, r * 0.2, true);
  arm(Z, r * 0.1, r * 0.8, r * (1.0 - sw * 0.1), r * 0.6, r * 0.3, 0.2, r * 0.2, true);
  // a third, withered arm sprouting from the shoulder
  arm(Z, -r * 0.1, -r * 0.5, r * (0.35 - sw * 0.1), -r * 1.05, r * 0.14, 0, r * 0.1, true);
  torso(Z, -r * 0.55, r * 0.42, r * 0.96, mix(skin, Z.cloth, 0.3), { rip: false });
  // flayed flank with ribs showing through
  const fg = g.createRadialGradient(-r * 0.05, r * 0.55, 0, -r * 0.05, r * 0.55, r * 0.35);
  fg.addColorStop(0, 'rgba(90,15,20,0.9)');
  fg.addColorStop(1, 'rgba(90,15,20,0)');
  g.fillStyle = fg;
  g.fillRect(-r * 0.45, r * 0.2, r * 0.8, r * 0.75);
  g.strokeStyle = 'rgba(215,205,180,0.75)';
  g.lineWidth = r * 0.03;
  for (let i = 0; i < 3; i++) {
    const x = -r * 0.2 + i * r * 0.12;
    g.beginPath();
    g.moveTo(x, r * 0.38);
    g.quadraticCurveTo(x + r * 0.06, r * 0.55, x, r * 0.72);
    g.stroke();
  }
  // tumours
  for (let i = 0; i < 6; i++) {
    const tr = r * rng.range(0.08, 0.16);
    const x = rng.range(-r * 0.4, r * 0.2), y = rng.range(-r * 0.75, r * 0.2);
    const gr = g.createRadialGradient(x - tr * 0.3, y - tr * 0.3, 0, x, y, tr);
    gr.addColorStop(0, '#c77ac0');
    gr.addColorStop(1, '#3a1438');
    fillCircle(g, x, y, tr, gr);
  }
  // bone spikes erupting from the back and shoulders, irregular so they read as growths
  g.strokeStyle = OUT;
  g.lineWidth = 1;
  const spikes = [[-0.25, -0.72, -2.2, 0.34], [-0.42, -0.35, -2.75, 0.46], [-0.48, 0.05, 3.05, 0.3],
    [-0.4, 0.42, 2.6, 0.5], [-0.12, 0.8, 2.0, 0.26], [0.05, -0.85, -1.8, 0.22]];
  for (const [sx, sy, a, len] of spikes) {
    const x = sx * r, y = sy * r, L = len * r, w = r * 0.08;
    const c = Math.cos(a), s = Math.sin(a);
    const sg = g.createLinearGradient(x, y, x + c * L, y + s * L);
    sg.addColorStop(0, '#6a5a48');
    sg.addColorStop(0.4, '#d8cfb4');
    sg.addColorStop(1, '#f4eedc');
    g.fillStyle = sg;
    g.beginPath();
    g.moveTo(x - s * w, y + c * w);
    g.quadraticCurveTo(x + c * L * 0.6 - s * w * 0.6, y + s * L * 0.6 + c * w * 0.6, x + c * L, y + s * L);
    g.quadraticCurveTo(x + c * L * 0.6 + s * w * 0.6, y + s * L * 0.6 - c * w * 0.6, x + s * w, y - c * w);
    g.closePath();
    g.fill();
    g.stroke();
  }
  head(Z, r * 0.3, 0, r * 0.22, { hair: null });
}

function drawCorpse(Z, type) {
  const { g, r } = Z;
  const big = type === 'bloater';
  feet(Z, -r * 0.8, r * 0.32, 0, r * 0.34, r * 0.2);
  arm(Z, r * 0.05, -r * 0.7, r * 0.4, -r * 1.45, r * 0.27, 0.42, r * 0.16);
  arm(Z, r * 0.05, r * 0.7, -r * 0.3, r * 1.35, r * 0.27, 0.42, r * 0.16);
  if (big) {
    fillCircle(g, 0, 0, r * 0.85, OUT);
    fillCircle(g, 0, 0, r * 0.8, shade(Z.skin, -0.25));
  } else {
    torso(Z, -r * 0.55, r * 0.35, r * 0.88, Z.cloth);
  }
  head(Z, r * 0.62, r * 0.2, r * (big ? 0.26 : 0.35), { eyes: false });
}
