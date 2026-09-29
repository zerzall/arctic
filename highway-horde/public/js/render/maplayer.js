// Static map layers. The ground (areas, road paint, flat decor, baked shadows) is
// painted once into chunked offscreen canvases whose resolution is picked from a texel
// budget, so memory stays bounded on the biggest maps. Things that stand above the
// entities (tree canopies, lamp heads, flags) and animated bits (water shimmer) are
// drawn live from small cached sprites.

import { paintDress2D } from './dress2d.js';
import {
  makeCanvas, releaseCanvas, createRng, mix, fillCircle, fillEllipse, blobPath,
  fillRoundRect, hash01,
} from './util.js';
import { groundTile, AREA_COLORS, waterShimmerTile, bloodSplats } from './textures.js';
import { drawObstacle } from './obstacles.js';

const CHUNK = 512;
const NATURAL = new Set(['grass', 'dirt', 'gravel', 'sand']);
// Shadow cast offset per obstacle kind (world px): taller things throw longer shadows.
const SHADOW = {
  building: 16, booth: 10, container: 9, tent: 8, semi: 9, bus: 9, tanker: 9, truck: 8, van: 8,
  suv: 7, pickup: 6, car: 6, hesco: 6, pump: 6, rock: 4, pillar: 12, barrier: 3, sandbags: 3,
  guardrail: 2, wall: 3, tree: 0, pier: 12, ramp: 10,
};
const SUN_X = 0.55, SUN_Y = 0.8;   // moonlight comes from the top-left

/**
 * Pre-computed geometry for a map (paths per area etc.), shared by chunk baking and
 * the lobby preview.
 */
export function prepareMap(map) {
  const seed = map.seed | 0;
  const areas = map.areas.map((a, i) => {
    const natural = NATURAL.has(a.kind);
    const path = areaPath(a, natural, createRng((seed * 31 + i * 977 + 5) >>> 0));
    const ext = Math.hypot(a.w, a.h) / 2 + 14;
    return { def: a, path, natural, x0: a.x - ext, y0: a.y - ext, x1: a.x + ext, y1: a.y + ext };
  });
  const colors = {};
  for (const k of Object.keys(AREA_COLORS)) colors[k] = AREA_COLORS[k];
  colors.grass = mix(AREA_COLORS.grass, map.ground, 0.35);
  colors.dirt = mix(AREA_COLORS.dirt, map.ground, 0.2);
  colors.sand = mix(AREA_COLORS.sand, map.ground, 0.15);
  return { map, seed, areas, colors };
}

function areaPath(a, natural, rng) {
  const p = new Path2D();
  const c = Math.cos(a.a || 0), s = Math.sin(a.a || 0);
  const hw = a.w / 2, hh = a.h / 2;
  if (!natural) {
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    pts.forEach(([x, y], i) => {
      const px = a.x + x * c - y * s, py = a.y + x * s + y * c;
      if (i === 0) p.moveTo(px, py); else p.lineTo(px, py);
    });
    p.closePath();
    return p;
  }
  // Organic outline: a superellipse (rounded rectangle) with a wobbly edge.
  const per = 2 * (a.w + a.h);
  const n = Math.max(16, Math.min(90, Math.round(per / 14)));
  const k1 = rng.int(3, 6), k2 = rng.int(7, 13), p1 = rng.next() * 6.28, p2 = rng.next() * 6.28;
  const amp = Math.min(10, Math.min(a.w, a.h) * 0.12);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    let x = hw * Math.sign(ct) * Math.pow(Math.abs(ct), 0.5);
    let y = hh * Math.sign(st) * Math.pow(Math.abs(st), 0.5);
    const j = Math.sin(t * k1 + p1) * amp * 0.6 + Math.sin(t * k2 + p2) * amp * 0.4 + (rng.next() - 0.5) * amp * 0.5;
    const l = Math.hypot(x, y) || 1;
    x += (x / l) * j;
    y += (y / l) * j;
    const px = a.x + x * c - y * s, py = a.y + x * s + y * c;
    if (i === 0) p.moveTo(px, py); else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

/**
 * Paint every flat map element intersecting the world rect into `g`, whose transform
 * must already map world coordinates. Used for chunks and previews.
 * @param {object} prep prepareMap() result
 * @param {{x0,y0,x1,y1}} rect world rect to cover
 * @param {number} detail 1 = full, 0 = preview (skips tiny decor)
 */
export function paintGround(g, prep, rect, detail = 1) {
  const { map, areas, colors, seed } = prep;
  const pats = {};
  const pat = (kind) => {
    if (!pats[kind]) {
      const base = kind === 'ground' ? map.ground : colors[kind];
      pats[kind] = g.createPattern(groundTile(kind, base), 'repeat');
    }
    return pats[kind];
  };
  g.fillStyle = pat('ground');
  g.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);

  // areas, in order
  for (const A of areas) {
    if (A.x1 < rect.x0 || A.x0 > rect.x1 || A.y1 < rect.y0 || A.y0 > rect.y1) continue;
    const k = A.def.kind;
    if (k === 'water') {
      g.strokeStyle = 'rgba(40,32,22,0.7)';
      g.lineWidth = 18;
      g.stroke(A.path);
      g.strokeStyle = 'rgba(30,25,18,0.9)';
      g.lineWidth = 8;
      g.stroke(A.path);
      g.fillStyle = pat('water');
      g.fill(A.path);
      continue;
    }
    const p = pat(k in colors ? k : 'dirt');
    if (A.natural) {
      g.save();
      g.globalAlpha = 0.3;
      g.strokeStyle = p;
      g.lineWidth = 14;
      g.stroke(A.path);
      g.globalAlpha = 0.6;
      g.lineWidth = 6;
      g.stroke(A.path);
      g.restore();
      g.fillStyle = p;
      g.fill(A.path);
    } else {
      // hard surfaces: a darker worn rim so roads sit into the verge
      g.strokeStyle = 'rgba(20,18,15,0.35)';
      g.lineWidth = 8;
      g.stroke(A.path);
      g.fillStyle = p;
      g.fill(A.path);
      g.strokeStyle = k === 'asphalt' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.2)';
      g.lineWidth = 2;
      g.stroke(A.path);
    }
  }
  // water depth shading: darker toward the middle
  for (const A of areas) {
    if (A.def.kind !== 'water') continue;
    if (A.x1 < rect.x0 || A.x0 > rect.x1 || A.y1 < rect.y0 || A.y0 > rect.y1) continue;
    const a = A.def;
    g.save();
    g.clip(A.path);
    g.translate(a.x, a.y);
    g.rotate(a.a || 0);
    const horiz = a.w < a.h;
    const grad = horiz ? g.createLinearGradient(-a.w / 2, 0, a.w / 2, 0) : g.createLinearGradient(0, -a.h / 2, 0, a.h / 2);
    grad.addColorStop(0, 'rgba(60,70,50,0.35)');
    grad.addColorStop(0.12, 'rgba(0,10,15,0)');
    grad.addColorStop(0.5, 'rgba(0,8,14,0.35)');
    grad.addColorStop(0.88, 'rgba(0,10,15,0)');
    grad.addColorStop(1, 'rgba(60,70,50,0.35)');
    g.fillStyle = grad;
    g.fillRect(-a.w / 2, -a.h / 2, a.w, a.h);
    g.restore();
  }

  // road paint
  for (const ln of map.lines) {
    const m = (ln.w || 3) * 3 + 30;
    if (Math.max(ln.x1, ln.x2) + m < rect.x0 || Math.min(ln.x1, ln.x2) - m > rect.x1) continue;
    if (Math.max(ln.y1, ln.y2) + m < rect.y0 || Math.min(ln.y1, ln.y2) - m > rect.y1) continue;
    paintLine(g, ln, seed);
  }

  // flat decor
  const decor = map.decor;
  for (let i = 0; i < decor.length; i++) {
    const d = decor[i];
    const s = d.s || 1;
    const m = 140 * s;
    if (d.x + m < rect.x0 || d.x - m > rect.x1 || d.y + m < rect.y0 || d.y - m > rect.y1) continue;
    if (detail < 1 && (d.kind === 'grass_tuft' || d.kind === 'paper' || d.kind === 'debris')) continue;
    paintDecor(g, d, createRng((seed * 131 + i * 7919 + 3) >>> 0));
  }

  // set dressing (the classic view attaches it as prep.dress; the 3D ground never does)
  if (prep.dress) paintDress2D(g, prep.dress, rect);

  // soft shadows of everything that stands up
  for (const o of map.obstacles) {
    const off = SHADOW[o.kind] ?? 6;
    const ext = Math.hypot(o.w, o.h) / 2 + off * 2 + 10;
    if (o.x + ext < rect.x0 || o.x - ext > rect.x1 || o.y + ext < rect.y0 || o.y - ext > rect.y1) continue;
    if (o.kind === 'tree') continue;
    softRectShadow(g, o.x, o.y, o.w, o.h, o.a, off);
  }
  const ob = map.objective;
  if (ob) softRectShadow(g, ob.x, ob.y, ob.w, ob.h, ob.a || 0, ob.kind === 'diner' ? 16 : ob.kind === 'radio' ? 22 : 9);
  // canopy shadows
  for (const d of decor) {
    if (d.kind !== 'tree_canopy') continue;
    const R = canopyRadius(d);
    const ox = d.x + R * 0.28 * SUN_X, oy = d.y + R * 0.28 * SUN_Y;
    if (ox + R < rect.x0 || ox - R > rect.x1 || oy + R < rect.y0 || oy - R > rect.y1) continue;
    const grad = g.createRadialGradient(ox, oy, R * 0.3, ox, oy, R * 1.05);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(ox - R * 1.1, oy - R * 1.1, R * 2.2, R * 2.2);
  }
}

function softRectShadow(g, x, y, w, h, a, off) {
  g.save();
  g.translate(x + off * SUN_X, y + off * SUN_Y);
  g.rotate(a || 0);
  for (let i = 3; i >= 0; i--) {
    const grow = i * 3 + 1;
    g.fillStyle = `rgba(0,0,0,${0.13 + (3 - i) * 0.035})`;
    g.beginPath();
    const rw = w + grow * 2, rh = h + grow * 2, r = Math.min(rw, rh) * 0.3;
    g.moveTo(-rw / 2 + r, -rh / 2);
    g.arcTo(rw / 2, -rh / 2, rw / 2, rh / 2, r);
    g.arcTo(rw / 2, rh / 2, -rw / 2, rh / 2, r);
    g.arcTo(-rw / 2, rh / 2, -rw / 2, -rh / 2, r);
    g.arcTo(-rw / 2, -rh / 2, rw / 2, -rh / 2, r);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function paintLine(g, ln, seed) {
  const dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const w = ln.w || 3;
  const white = 'rgba(225,225,212,0.78)';
  const yellow = 'rgba(222,170,40,0.82)';
  g.save();
  g.lineCap = 'butt';
  const stroke = (color, off, dash) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.setLineDash(dash || []);
    g.beginPath();
    g.moveTo(ln.x1 + nx * off, ln.y1 + ny * off);
    g.lineTo(ln.x2 + nx * off, ln.y2 + ny * off);
    g.stroke();
  };
  switch (ln.kind) {
    case 'white': case 'parking': stroke(white, 0); break;
    case 'white_dashed': stroke(white, 0, [42, 48]); break;
    case 'yellow': stroke(yellow, 0); break;
    case 'yellow_double': stroke(yellow, -w * 0.9); stroke(yellow, w * 0.9); break;
    case 'stop': stroke('rgba(230,230,220,0.85)', 0); break;
    case 'crosswalk': {
      g.fillStyle = 'rgba(228,228,215,0.8)';
      const bar = 9, gap = 11;
      for (let t = gap / 2; t < len - bar; t += bar + gap) {
        const cx = ln.x1 + ux * (t + bar / 2), cy = ln.y1 + uy * (t + bar / 2);
        g.save();
        g.translate(cx, cy);
        g.rotate(Math.atan2(uy, ux));
        g.fillRect(-bar / 2, -w / 2, bar, w);
        g.restore();
      }
      break;
    }
    default: stroke(white, 0);
  }
  g.setLineDash([]);
  // wear: asphalt-coloured flecks over the paint
  const rng = createRng((seed + Math.round(ln.x1 * 3 + ln.y1 * 7 + ln.x2 * 11)) >>> 0);
  const n = Math.min(400, Math.floor(len / 5));
  g.fillStyle = 'rgba(45,46,48,0.55)';
  for (let i = 0; i < n; i++) {
    const t = rng.next() * len, o = (rng.next() - 0.5) * w * (ln.kind === 'crosswalk' ? 1 : 2.4);
    g.fillRect(ln.x1 + ux * t + nx * o, ln.y1 + uy * t + ny * o, 1 + rng.next() * 2.5, 1 + rng.next() * 1.5);
  }
  g.restore();
}

/** Canopy radius in world px for a 'tree_canopy' decor. */
export function canopyRadius(d) {
  return 40 * (d.s || 1);
}

function paintDecor(g, d, rng) {
  const s = d.s || 1;
  g.save();
  g.translate(d.x, d.y);
  g.rotate(d.a || 0);
  switch (d.kind) {
    case 'grass_tuft': {
      g.lineCap = 'round';
      const n = 7 + rng.int(0, 7);
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2, l = (5 + rng.next() * 7) * s;
        g.strokeStyle = rng.chance(0.5) ? 'rgba(120,150,70,0.7)' : 'rgba(70,95,45,0.8)';
        if (rng.chance(0.2)) g.strokeStyle = 'rgba(160,150,90,0.7)';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(Math.cos(a) * l * 0.5 + 1, Math.sin(a) * l * 0.5, Math.cos(a) * l, Math.sin(a) * l);
        g.stroke();
      }
      break;
    }
    case 'bush': {
      const R = 14 * s;
      fillEllipse(g, R * 0.25, R * 0.35, R * 1.05, R * 0.95, 'rgba(0,0,0,0.35)');
      const lobes = 5 + rng.int(0, 3);
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2 + rng.next() * 0.5, r = R * (0.45 + rng.next() * 0.35);
        const x = Math.cos(a) * R * 0.45, y = Math.sin(a) * R * 0.45;
        const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
        grad.addColorStop(0, '#5c7a3a');
        grad.addColorStop(1, '#223317');
        fillCircle(g, x, y, r, grad);
      }
      for (let i = 0; i < 10; i++) fillCircle(g, (rng.next() - 0.5) * R * 1.3, (rng.next() - 0.5) * R * 1.3, 1.2, 'rgba(140,170,90,0.45)');
      break;
    }
    case 'rock': {
      const r = 6 * s;
      fillEllipse(g, r * 0.3, r * 0.4, r, r * 0.8, 'rgba(0,0,0,0.4)');
      blobPath(g, 0, 0, r, rng, 7, 0.4);
      const grad = g.createLinearGradient(-r, -r, r, r);
      grad.addColorStop(0, '#8e8a80');
      grad.addColorStop(1, '#46433d');
      g.fillStyle = grad;
      g.fill();
      break;
    }
    case 'cone': {
      const r = 6 * s;
      if (rng.chance(0.3)) {
        // knocked over
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(-r, -r * 0.4 + 1, r * 2.4, r * 0.9);
        g.fillStyle = '#e8641c';
        g.beginPath();
        g.moveTo(-r, -r * 0.7); g.lineTo(r * 1.4, 0); g.lineTo(-r, r * 0.7); g.closePath();
        g.fill();
        g.fillStyle = '#eee';
        g.fillRect(-r * 0.2, -r * 0.4, r * 0.4, r * 0.8);
        g.fillStyle = '#222';
        g.fillRect(-r * 1.3, -r * 0.9, r * 0.35, r * 1.8);
      } else {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(-r + 1.5, -r + 2, r * 2, r * 2);
        g.fillStyle = '#b8480f';
        g.fillRect(-r, -r, r * 2, r * 2);
        fillCircle(g, 0, 0, r * 0.75, '#f07020');
        g.strokeStyle = '#f2f2f2';
        g.lineWidth = r * 0.22;
        g.beginPath();
        g.arc(0, 0, r * 0.45, 0, Math.PI * 2);
        g.stroke();
        fillCircle(g, 0, 0, r * 0.18, '#ffae60');
      }
      break;
    }
    case 'debris': {
      const R = 16 * s;
      for (let i = 0; i < 10; i++) {
        const x = (rng.next() - 0.5) * R * 2, y = (rng.next() - 0.5) * R * 2;
        const t = rng.next();
        g.save();
        g.translate(x, y);
        g.rotate(rng.next() * 6.28);
        if (t < 0.35) {
          g.fillStyle = rng.pick(['#5d5f61', '#7a6a55', '#3d3f41', '#6b3a2a']);
          g.fillRect(-3, -2, 5 + rng.next() * 5, 3 + rng.next() * 3);
        } else if (t < 0.7) {
          g.fillStyle = 'rgba(190,215,225,0.55)';
          g.fillRect(0, 0, 1.5, 1.5);
          g.fillRect(2, 1, 1, 1);
        } else {
          g.fillStyle = rng.pick(['#2a2a2a', '#4a3a2a']);
          blobPath(g, 0, 0, 2 + rng.next() * 2, rng, 5, 0.5);
          g.fill();
        }
        g.restore();
      }
      break;
    }
    case 'tire': {
      const r = 8 * s;
      fillCircle(g, 1.5, 2, r, 'rgba(0,0,0,0.35)');
      fillCircle(g, 0, 0, r, '#141414');
      g.strokeStyle = '#2c2c2c';
      g.lineWidth = 1;
      g.setLineDash([2, 2]);
      g.beginPath();
      g.arc(0, 0, r - 1.2, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      fillCircle(g, 0, 0, r * 0.45, '#3a3a3a');
      fillCircle(g, 0, 0, r * 0.2, '#1a1a1a');
      break;
    }
    case 'crack': {
      g.strokeStyle = 'rgba(8,8,8,0.55)';
      g.lineCap = 'round';
      const branch = (x, y, a, len, w, depth) => {
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, y);
        const steps = 4;
        for (let i = 0; i < steps; i++) {
          a += (rng.next() - 0.5) * 0.8;
          x += Math.cos(a) * len / steps;
          y += Math.sin(a) * len / steps;
          g.lineTo(x, y);
          if (depth > 0 && rng.chance(0.3)) {
            const px = x, py = y;
            g.stroke();
            branch(px, py, a + (rng.chance(0.5) ? 0.9 : -0.9), len * 0.45, w * 0.6, depth - 1);
            g.lineWidth = w;
            g.beginPath();
            g.moveTo(px, py);
          }
        }
        g.stroke();
      };
      branch(-30 * s, 0, 0, 60 * s, 1.6, 2);
      break;
    }
    case 'oil': {
      // soft overlapping pools with a faint rainbow sheen, never a hard-edged hole
      const R = 16 * s;
      for (let i = 0; i < 4; i++) {
        const x = (rng.next() - 0.5) * R * 0.9, y = (rng.next() - 0.5) * R * 0.7;
        const rr = R * (0.45 + rng.next() * 0.45);
        const grad = g.createRadialGradient(x, y, rr * 0.2, x, y, rr);
        grad.addColorStop(0, 'rgba(8,8,10,0.42)');
        grad.addColorStop(0.75, 'rgba(8,8,10,0.28)');
        grad.addColorStop(1, 'rgba(8,8,10,0)');
        g.fillStyle = grad;
        g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
      const sheen = g.createRadialGradient(-R * 0.15, -R * 0.1, 0, 0, 0, R * 0.7);
      sheen.addColorStop(0, 'rgba(110,70,150,0.12)');
      sheen.addColorStop(0.5, 'rgba(40,130,140,0.08)');
      sheen.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sheen;
      g.fillRect(-R, -R, R * 2, R * 2);
      break;
    }
    case 'blood_old': {
      const spr = bloodSplats('dark');
      const img = spr[rng.int(0, spr.length - 1)];
      const size = 60 * s;
      g.globalAlpha = 0.85;
      g.drawImage(img, -size / 2, -size / 2, size, size);
      break;
    }
    case 'paper': {
      for (let i = 0; i < 3; i++) {
        g.save();
        g.translate((rng.next() - 0.5) * 14 * s, (rng.next() - 0.5) * 14 * s);
        g.rotate(rng.next() * 6.28);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(-2.5, -3, 6, 8);
        g.fillStyle = rng.pick(['#a8a498', '#9a947c', '#b2aea4']);
        g.fillRect(-3, -4, 6, 8);
        g.fillStyle = 'rgba(60,60,60,0.35)';
        g.fillRect(-2, -2.5, 4, 0.6);
        g.fillRect(-2, -1, 4, 0.6);
        g.restore();
      }
      break;
    }
    case 'skid': {
      const L = 90 * s;
      g.strokeStyle = 'rgba(8,8,8,0.35)';
      g.lineCap = 'round';
      const bend = (rng.next() - 0.5) * 18;
      for (const off of [-8, 8]) {
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-L / 2, off);
        g.quadraticCurveTo(0, off + bend, L / 2, off + bend * 0.3);
        g.stroke();
      }
      break;
    }
    case 'manhole': {
      const r = 11 * s;
      fillCircle(g, 0, 0, r + 2, '#2a2a2a');
      fillCircle(g, 0, 0, r, '#4a4844');
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = -r + 3; k < r; k += 4) { g.moveTo(k, -Math.sqrt(r * r - k * k)); g.lineTo(k, Math.sqrt(r * r - k * k)); }
      g.stroke();
      break;
    }
    case 'lamp_post': {
      // pole foot; the arm and head overhang is drawn live above entities
      fillCircle(g, -16, 0, 4.5, '#2a2c2e');
      fillCircle(g, -16, 0, 2.6, '#5a5e62');
      break;
    }
    case 'sign': {
      const L = 44 * s;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(-L / 2 + 4, 4, L, 8);
      fillCircle(g, -L * 0.35, 3, 2, '#555');
      fillCircle(g, L * 0.35, 3, 2, '#555');
      g.fillStyle = '#1f5e38';
      g.fillRect(-L / 2, -3, L, 7);
      g.strokeStyle = '#e8e8e8';
      g.lineWidth = 1;
      g.strokeRect(-L / 2 + 1, -2, L - 2, 5);
      break;
    }
    case 'flag': {
      fillCircle(g, 0, 0, 3, '#2a2a2a');
      break;
    }
    case 'signal': case 'pylon': {
      // pole feet; the mast arm / sign board overhang is drawn live above entities
      fillCircle(g, 1.5, 2, 5, 'rgba(0,0,0,0.35)');
      if (d.kind === 'pylon') for (const x of [-14 * s, 14 * s]) fillCircle(g, x, 0, 2.6, '#5a5e62');
      else { fillCircle(g, 0, 0, 5, '#2a2c2e'); fillCircle(g, 0, 0, 3.2, '#6e757b'); }
      break;
    }
    case 'rubble': {
      const R = 22 * s;
      fillEllipse(g, 2, 3, R, R * 0.8, 'rgba(0,0,0,0.25)');
      for (let i = 0; i < 16; i++) {
        const x = (rng.next() - 0.5) * R * 1.7, y = (rng.next() - 0.5) * R * 1.5;
        const r = 2 + rng.next() * 5;
        blobPath(g, x, y, r, rng, 5, 0.5);
        g.fillStyle = rng.pick(['#7a766e', '#5f5b54', '#8d887d', '#6b5a48']);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 0.6;
        g.stroke();
      }
      break;
    }
    default:
      break;
  }
  g.restore();
}

// ---- chunked ground layer ------------------------------------------------------------------

/**
 * Chunked, lazily baked ground layer.
 * @param {object} prep prepareMap() result
 * @param {number} texelBudget max texels for the whole layer (memory cap)
 * @param {number} maxScale texels per world px upper bound
 */
export function createGroundLayer(prep, texelBudget, maxScale) {
  const { map } = prep;
  const scale = Math.min(maxScale, Math.sqrt(texelBudget / (map.width * map.height)));
  const PAD = 2;
  const cols = Math.ceil(map.width / CHUNK), rows = Math.ceil(map.height / CHUNK);
  const chunks = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) chunks.push({ c, r, canvas: null });
  let pending = chunks.length;

  function bake(ch) {
    const x0 = ch.c * CHUNK, y0 = ch.r * CHUNK;
    const px = Math.ceil(CHUNK * scale) + PAD * 2;
    const cv = makeCanvas(px, px);
    const g = cv.getContext('2d');
    g.setTransform(scale, 0, 0, scale, PAD - x0 * scale, PAD - y0 * scale);
    const m = PAD / scale + 1;
    paintGround(g, prep, { x0: x0 - m, y0: y0 - m, x1: x0 + CHUNK + m, y1: y0 + CHUNK + m }, 1);
    ch.canvas = cv;
    pending--;
  }

  return {
    scale,
    /** Bake every chunk touching the rect right now (first frame / teleports). */
    bakeRect(x0, y0, x1, y1) {
      const c0 = Math.max(0, Math.floor(x0 / CHUNK)), c1 = Math.min(cols - 1, Math.floor(x1 / CHUNK));
      const r0 = Math.max(0, Math.floor(y0 / CHUNK)), r1 = Math.min(rows - 1, Math.floor(y1 / CHUNK));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const ch = chunks[r * cols + c];
        if (!ch.canvas) bake(ch);
      }
    },
    /** Bake at most one pending chunk, nearest to (cx, cy) first. Spreads the cost. */
    bakeIdle(cx, cy) {
      if (!pending) return;
      let best = null, bd = Infinity;
      for (const ch of chunks) {
        if (ch.canvas) continue;
        const d = Math.abs((ch.c + 0.5) * CHUNK - cx) + Math.abs((ch.r + 0.5) * CHUNK - cy);
        if (d < bd) { bd = d; best = ch; }
      }
      if (best) bake(best);
    },
    get pending() { return pending; },
    draw(ctx, x0, y0, x1, y1) {
      const c0 = Math.max(0, Math.floor(x0 / CHUNK)), c1 = Math.min(cols - 1, Math.floor(x1 / CHUNK));
      const r0 = Math.max(0, Math.floor(y0 / CHUNK)), r1 = Math.min(rows - 1, Math.floor(y1 / CHUNK));
      const src = CHUNK * scale;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const ch = chunks[r * cols + c];
          if (!ch.canvas) bake(ch);
          // Overdraw by half a world pixel so antialiased chunk edges never show seams.
          ctx.drawImage(ch.canvas, PAD, PAD, src + 0.5 * scale, src + 0.5 * scale, c * CHUNK, r * CHUNK, CHUNK + 0.5, CHUNK + 0.5);
        }
      }
    },
    destroy() {
      for (const ch of chunks) { releaseCanvas(ch.canvas); ch.canvas = null; }
    },
  };
}

// ---- canopies, lamps, flags (live, above entities) -------------------------------------------

const canopyVariants = new Map();

/** Cached canopy sprite variant (world radius 40 → `spriteScale` texels per px). */
function canopySprite(variant, spriteScale) {
  const key = variant + ':' + spriteScale;
  let c = canopyVariants.get(key);
  if (c) return c;
  const R = 40;
  const size = Math.ceil((R * 2 + 12) * spriteScale);
  c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.setTransform(spriteScale, 0, 0, spriteScale, size / 2, size / 2);
  const rng = createRng(1000 + variant * 7);
  const hue = rng.pick([['#1e3316', '#4f7033'], ['#1d3019', '#5a7a3a'], ['#243417', '#6b7a35'], ['#1a2e1c', '#44703f']]);
  // dark body lobes
  const lobes = 9 + rng.int(0, 4);
  const blobs = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rng.next() * 0.4;
    const d = R * (0.35 + rng.next() * 0.3);
    blobs.push([Math.cos(a) * d, Math.sin(a) * d, R * (0.38 + rng.next() * 0.22)]);
  }
  blobs.push([0, 0, R * 0.6]);
  for (const [x, y, r] of blobs) fillCircle(g, x, y, r + 1.5, 'rgba(8,14,6,0.9)');
  for (const [x, y, r] of blobs) {
    const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
    grad.addColorStop(0, hue[1]);
    grad.addColorStop(1, hue[0]);
    fillCircle(g, x, y, r, grad);
  }
  // leaf speckle, brighter toward the moonlit side
  for (let i = 0; i < 260; i++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * R * 0.95;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const lit = (-x - y) / (R * 1.4);
    g.fillStyle = lit > 0.1 && rng.chance(0.6) ? 'rgba(150,185,100,0.28)' : 'rgba(5,12,4,0.3)';
    fillCircle(g, x, y, 1 + rng.next() * 1.8);
  }
  canopyVariants.set(key, c);
  return c;
}

/**
 * State of a traffic signal (map 'signal' decor #i) — the same hash as the 3D view's:
 * 'dark' | 'amber' (flashing) | 'red' (flashing) | 'failing' (flickering red).
 */
export function signalMode(i) {
  const roll = hash01(i * 7 + 3);
  return roll < 0.3 ? 'dark' : roll < 0.65 ? 'amber' : roll < 0.85 ? 'red' : 'failing';
}

/** Overpass deck segments as quads for 2D drawing (the overhead layer, previews, minimap). */
export function overpassQuads(map) {
  const out = [];
  const ov = map.overpass;
  if (!ov) return out;
  for (const d of ov.decks) {
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [x0, y0, z0] = d.pts[i], [x1, y1, z1] = d.pts[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (!(L > 0)) continue;
      const ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy, ny = ux, hw = d.w / 2;
      out.push({
        ramp: d.kind === 'ramp', x0, y0, x1, y1, z0, z1, ux, uy, nx, ny, hw, L, alpha: 0.92,
        pts: [[x0 + nx * hw, y0 + ny * hw], [x1 + nx * hw, y1 + ny * hw], [x1 - nx * hw, y1 - ny * hw], [x0 - nx * hw, y0 - ny * hw]],
        minX: Math.min(x0, x1) - hw, maxX: Math.max(x0, x1) + hw, minY: Math.min(y0, y1) - hw, maxY: Math.max(y0, y1) + hw,
      });
    }
  }
  return out;
}

/**
 * Live overhead layer: tree canopies (fading when a player walks under them), lamp arms,
 * waving flags, traffic signal arms, and the overpass decks (see-through, fading further
 * while a player stands under them) with the wrecks up on them.
 */
export function createOverheadLayer(map) {
  const canopies = [];
  const lamps = [];
  const flags = [];
  const signals = [];
  const pylons = [];
  const decks = overpassQuads(map);
  const deckCars = (map.overpass && map.overpass.vehicles) || [];
  map.decor.forEach((d, i) => {
    if (d.kind === 'signal') {
      const len = 150 * (d.s || 1), heads = Math.max(1, Math.round(len / 72));
      const hx = [];
      for (let k = 0; k < heads; k++) hx.push(len * (heads === 1 ? 0.8 : 0.42 + (0.55 * k) / (heads - 1)));
      signals.push({ x: d.x, y: d.y, a: d.a || 0, len, hx, mode: signalMode(i), ph: hash01(i * 13 + 1) });
    } else if (d.kind === 'pylon') {
      pylons.push({ x: d.x, y: d.y, a: d.a || 0, s: d.s || 1 });
    }
    if (d.kind === 'tree_canopy') {
      canopies.push({ x: d.x, y: d.y, a: d.a || 0, R: canopyRadius(d), variant: Math.floor(hash01(i * 13 + 7) * 6), alpha: 0.96 });
    } else if (d.kind === 'lamp_post') {
      // pair the post with a live light within reach, if the bulb still works
      let lit = null;
      for (const l of map.lights) if (Math.abs(l.x - d.x) < 4 && Math.abs(l.y - d.y) < 4) { lit = l; break; }
      lamps.push({ x: d.x, y: d.y, a: d.a || 0, s: d.s || 1, light: lit });
    } else if (d.kind === 'flag') {
      flags.push({ x: d.x, y: d.y, s: d.s || 1, color: ['#8a1c1c', '#1c3a8a', '#e3e3e3', '#2e5d2e'][Math.floor(hash01(i) * 4)], ph: hash01(i + 3) * 6 });
    }
  });

  return {
    canopies, lamps, flags,
    /**
     * @param {Array} players snapshot players (to fade canopies they stand under)
     */
    drawCanopies(ctx, view, players, dt, spriteScale, k) {
      const damp = 1 - Math.exp(-8 * dt);
      for (const t of canopies) {
        if (t.x + t.R < view.x0 || t.x - t.R > view.x1 || t.y + t.R < view.y0 || t.y - t.R > view.y1) continue;
        let under = false;
        for (let i = 0; i < players.length; i++) {
          const p = players[i];
          if (p.state === 'dead') continue;
          const dx = p.x - t.x, dy = p.y - t.y;
          if (dx * dx + dy * dy < (t.R + 18) * (t.R + 18)) { under = true; break; }
        }
        t.alpha += ((under ? 0.32 : 0.96) - t.alpha) * damp;
        const spr = canopySprite(t.variant, spriteScale);
        const sc = t.R / 40;
        const c = Math.cos(t.a) * sc * k.k / spriteScale, s = Math.sin(t.a) * sc * k.k / spriteScale;
        ctx.globalAlpha = t.alpha;
        ctx.setTransform(c, s, -s, c, k.tx + t.x * k.k, k.ty + t.y * k.k);
        ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
      }
      ctx.globalAlpha = 1;
    },
    drawLampsAndFlags(ctx, view, time) {
      for (const sg of signals) {
        if (sg.x + sg.len < view.x0 || sg.x - sg.len > view.x1 || sg.y + sg.len < view.y0 || sg.y - sg.len > view.y1) continue;
        ctx.save();
        ctx.translate(sg.x, sg.y);
        ctx.rotate(sg.a);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(2, 3);
        ctx.lineTo(sg.len + 2, 3);
        ctx.stroke();
        ctx.strokeStyle = '#6e757b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(sg.len, 0);
        ctx.stroke();
        fillCircle(ctx, 0, 0, 4, '#50565a');
        const on = sg.mode === 'failing' ? Math.sin(time * 23 + sg.ph * 9) > -0.3 : ((time * 0.9 + sg.ph) % 1) < 0.5;
        const lit = sg.mode === 'dark' ? null : sg.mode === 'amber' ? '#ffae1a' : '#ff2a1a';
        for (const x of sg.hx) {
          fillRoundRect(ctx, x - 6.5, -5.5, 13, 11, 2, '#c8b23a');
          fillRoundRect(ctx, x - 5.5, -4.5, 11, 9, 2, '#22251f');
          fillRoundRect(ctx, x - 4, -6.5, 8, 2.5, 1, lit && on ? lit : '#3a3c36');
        }
        ctx.restore();
      }
      for (const p of pylons) {
        if (p.x + 40 < view.x0 || p.x - 40 > view.x1 || p.y + 40 < view.y0 || p.y - 40 > view.y1) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        fillRoundRect(ctx, -25 * p.s, -5, 50 * p.s, 10, 2, '#2c2f33');
        ctx.fillStyle = '#c62828';
        ctx.fillRect(-23 * p.s, -3.5, 46 * p.s, 3);
        ctx.fillStyle = '#ff7a3a';
        ctx.fillRect(-12 * p.s, 1, 24 * p.s, 2);
        ctx.restore();
      }
      for (const l of lamps) {
        if (l.x + 40 < view.x0 || l.x - 40 > view.x1 || l.y + 40 < view.y0 || l.y - 40 > view.y1) continue;
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(l.a);
        ctx.strokeStyle = '#2d3033';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();
        fillRoundRect(ctx, -2, -4, 12, 8, 3, '#3a3d40');
        fillRoundRect(ctx, 0, -2.5, 8, 5, 2, l.light ? '#fff1c8' : '#4a4d50');
        ctx.restore();
      }
      for (const f of flags) {
        if (f.x + 50 < view.x0 || f.x - 50 > view.x1 || f.y + 50 < view.y0 || f.y - 50 > view.y1) continue;
        ctx.save();
        ctx.translate(f.x, f.y);
        const L = 30 * f.s, H = 18 * f.s;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        const segs = 8;
        for (let i = 0; i <= segs; i++) {
          const u = i / segs;
          const y = Math.sin(time * 4 + f.ph - u * 5) * 3 * u - H / 2;
          if (i === 0) ctx.moveTo(u * L, y); else ctx.lineTo(u * L, y);
        }
        for (let i = segs; i >= 0; i--) {
          const u = i / segs;
          ctx.lineTo(u * L, Math.sin(time * 4 + f.ph - u * 5) * 3 * u + H / 2 * (1 - u * 0.15));
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, -H / 2, L * 0.3, H);
        fillCircle(ctx, 0, 0, 2.5, '#aaa');
        ctx.restore();
      }
    },
    /**
     * The overpass decks over everything on the ground: a soft moon shadow, the deck see-
     * through enough that players and zombies under it stay visible (more so while a player
     * stands under it), lane paint, parapets and the wrecks up on it.
     * @param {Array} players snapshot players (a deck fades further when one is under it)
     */
    drawOverpass(ctx, view, players, dt) {
      if (!decks.length) return;
      const damp = 1 - Math.exp(-8 * dt);
      const path = (q, ox = 0, oy = 0) => {
        ctx.beginPath();
        q.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)));
        ctx.closePath();
      };
      const along = (q, off, s0 = 0, s1 = q.L) => {
        ctx.beginPath();
        ctx.moveTo(q.x0 + q.ux * s0 + q.nx * off, q.y0 + q.uy * s0 + q.ny * off);
        ctx.lineTo(q.x0 + q.ux * s1 + q.nx * off, q.y0 + q.uy * s1 + q.ny * off);
        ctx.stroke();
      };
      ctx.save();
      for (const q of decks) {
        if (q.maxX + 40 < view.x0 || q.minX - 40 > view.x1 || q.maxY + 40 < view.y0 || q.minY - 40 > view.y1) {
          continue;
        }
        let under = false;
        if (!q.ramp && players) {
          for (let i = 0; i < players.length && !under; i++) {
            const p = players[i];
            if (p.state === 'dead') continue;
            const dx = p.x - q.x0, dy = p.y - q.y0;
            const s = dx * q.ux + dy * q.uy, o = dx * q.nx + dy * q.ny;
            under = s > -20 && s < q.L + 20 && Math.abs(o) < q.hw + 20;
          }
        }
        q.alpha += ((under ? 0.55 : 0.92) - q.alpha) * damp;
        const A = q.alpha;
        if (!q.ramp) {
          ctx.globalAlpha = 0.3 * A;
          ctx.fillStyle = '#000';
          path(q, SUN_X * 34, SUN_Y * 34);
          ctx.fill();
        }
        ctx.globalAlpha = A * (q.ramp ? 1 : 0.88);
        ctx.fillStyle = '#46484c';
        path(q);
        ctx.fill();
        ctx.lineCap = 'butt';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(225,225,212,0.7)';
        ctx.setLineDash([]);
        along(q, q.hw - 22);
        along(q, -(q.hw - 22));
        if (!q.ramp) {
          ctx.setLineDash([40, 52]);
          along(q, q.hw / 2 - 2);
          along(q, -(q.hw / 2 - 2));
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(222,170,40,0.75)';
          along(q, 3.5);
          along(q, -3.5);
        }
        ctx.strokeStyle = '#a9a498';
        ctx.lineWidth = 8;
        along(q, q.hw - 4);
        along(q, -(q.hw - 4));
      }
      ctx.setLineDash([]);
      for (let i = 0; i < deckCars.length; i++) {
        const v = deckCars[i];
        if (v.x + 140 < view.x0 || v.x - 140 > view.x1 || v.y + 140 < view.y0 || v.y - 140 > view.y1) continue;
        let A = 0.9;
        for (const q of decks) {
          const dx = v.x - q.x0, dy = v.y - q.y0, s = dx * q.ux + dy * q.uy;
          if (s >= 0 && s <= q.L && Math.abs(dx * q.nx + dy * q.ny) <= q.hw + 10) A = q.alpha;
        }
        ctx.globalAlpha = A;
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(v.a);
        drawObstacle(ctx, { ...v, id: 5000 + i }, map.seed | 0);
        ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    },
  };
}

// ---- water ----------------------------------------------------------------------------------

/** Animated shimmer over water areas: the highlight tile scrolled two ways, additive. */
export function createWaterLayer(prep) {
  const waters = prep.areas.filter((a) => a.def.kind === 'water');
  const tile = waters.length ? waterShimmerTile() : null;
  let pat = null, patCtx = null;
  return {
    any: waters.length > 0,
    draw(ctx, view, time) {
      if (!waters.length) return;
      if (patCtx !== ctx) { pat = ctx.createPattern(tile, 'repeat'); patCtx = ctx; }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const A of waters) {
        if (A.x1 < view.x0 || A.x0 > view.x1 || A.y1 < view.y0 || A.y0 > view.y1) continue;
        ctx.save();
        ctx.clip(A.path);
        const x0 = Math.max(A.x0, view.x0), y0 = Math.max(A.y0, view.y0);
        const x1 = Math.min(A.x1, view.x1), y1 = Math.min(A.y1, view.y1);
        ctx.fillStyle = pat;
        for (let layer = 0; layer < 2; layer++) {
          const ox = layer ? (time * 9) % 256 : -(time * 14) % 256;
          const oy = layer ? -(time * 6) % 256 : (time * 4) % 256;
          ctx.globalAlpha = layer ? 0.55 : 0.8;
          ctx.translate(ox, oy);
          ctx.fillRect(x0 - ox, y0 - oy, x1 - x0, y1 - y0);
          ctx.translate(-ox, -oy);
        }
        ctx.restore();
      }
      ctx.restore();
    },
  };
}

