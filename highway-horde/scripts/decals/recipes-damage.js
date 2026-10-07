// Sheet 'damage': what the outbreak and the years did to the surfaces. Blood (splatter, sprays with
// runs, handprints, drag marks, footprint trails, pools; fresh and dried), bullet-hole clusters in
// concrete, metal, glass and wood, scorch marks, cracks, spalled concrete with its rebar showing,
// water stains, rust streaks, grime at the foot of walls, soot, peeling paint, moss and lichen, oil
// stains, tyre marks, puddle rims, and the clutter on the floors (paper litter, leaves, sand drifts,
// broken glass).

import {
  bulletHole, bloodSplat, paper, para, print, C, hex, mix3, mul3, fbm, vnoise, ridge, hash2, smoothstep, clamp01, lerp,
} from './kit.js';

const S = 'damage';

// ---- helpers -------------------------------------------------------------------------------------

/** Blood colour of a variant: fresh is wet and glossy, dry is brown, matte and patchy. */
function bloodOf(v) {
  return v === 'dry' ? { col: hex('#3b120b'), rough: 0.7, alpha: 0.85 } : { col: C.blood, rough: 0.18, alpha: 0.96 };
}

/** A random-walk crack: main line with branches. Returns [[pts, width]...]. */
function crackPaths(rng, x, y, ang, len, width, depth = 0) {
  const out = [];
  const pts = [[x, y]];
  let a = ang, px = x, py = y;
  const steps = Math.max(4, Math.round(len / 9));
  for (let i = 0; i < steps; i++) {
    a += rng.range(-0.45, 0.45);
    a = ang + (a - ang) * 0.8;
    px += Math.cos(a) * len / steps;
    py += Math.sin(a) * len / steps;
    pts.push([px, py]);
    if (depth < 2 && rng.chance(0.12)) out.push(...crackPaths(rng, px, py, a + rng.range(0.5, 1.1) * (rng.chance(0.5) ? 1 : -1), len * rng.range(0.25, 0.5), width * 0.6, depth + 1));
  }
  out.unshift([pts, width]);
  return out;
}

function drawCracks(c, rng, paths, o = {}) {
  const m = c.mask(), edge = c.mask();
  for (const [pts, wd] of paths) {
    m.stroke(pts, (t) => Math.max(0.7, wd * (1 - t * 0.85)));
    edge.stroke(pts, (t) => Math.max(1.5, wd * 2.6 * (1 - t * 0.8)));
  }
  edge.cut(m).blur(1);
  c.paint(edge, o.edgeCol || [0.78, 0.76, 0.72], 0.35, { rough: 0.95 });
  c.paint(m, o.col || [0.09, 0.085, 0.08], 0.9, { rough: 0.95 });
  c.lift(m.clone().blur(0.8), -(o.depth ?? 2.4));
  c.lift(edge, 0.5);
  return m;
}

/** A soft vertical run: a mask whose coverage falls from y0 downward (streak lines in it). */
function runMask(c, rng, x0, x1, y0, len, o = {}) {
  const seed = rng.seed();
  const m = c.mask();
  const { w, h } = c;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, y0 + len); y++) {
    const t = (y - y0) / len;
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
      const cx = (x - x0) / (x1 - x0);
      const side = smoothstep(0, 0.25, cx) * smoothstep(1, 0.75, cx);
      const streak = 0.45 + 0.55 * vnoise(x * (o.streakF ?? 0.18), t * 1.5, seed);
      const fall = (1 - t) ** (o.pow ?? 1.4) * (0.7 + 0.3 * fbm(x * 0.05, y * 0.01, 2, seed + 1));
      m.d[y * w + x] = clamp01(side * streak * fall * (o.k ?? 1));
    }
  }
  return m;
}

const leafCols = ['#8a4a1a', '#a8621c', '#c28a2a', '#6b3a18', '#7a6a2a', '#5a3a1a', '#b4471c', '#9a7a3a'];

/** One leaf (oak-ish, maple-ish or long) at (x, y), size s, angle a. Paints with a soft shadow. */
function leaf(c, rng, x, y, s, a, kind) {
  const m = c.mask();
  const ca = Math.cos(a), sa = Math.sin(a);
  const P = (u, v) => [x + (u * ca - v * sa) * s, y + (u * sa + v * ca) * s];
  if (kind === 0) {
    // elliptic with a point
    const pts = [];
    for (let k = 0; k <= 20; k++) { const t = (k / 20) * Math.PI * 2; const r = 0.5 + 0.08 * Math.sin(t * 7); pts.push(P(Math.cos(t) * r, Math.sin(t) * r * 0.42)); }
    m.poly(pts);
  } else if (kind === 1) {
    // maple: five lobes
    const pts = [];
    for (let k = 0; k < 30; k++) { const t = (k / 30) * Math.PI * 2; const r = 0.28 + 0.24 * Math.max(0, Math.cos(t * 2.5)) ** 0.6 + (k % 3 === 0 ? 0.05 : 0); pts.push(P(Math.cos(t) * r, Math.sin(t) * r)); }
    m.poly(pts);
  } else {
    const pts = [];
    for (let k = 0; k <= 16; k++) { const t = (k / 16) * Math.PI * 2; pts.push(P(Math.cos(t) * 0.55, Math.sin(t) * 0.16)); }
    m.poly(pts);
  }
  m.capsule(...P(-0.5, 0), ...P(-0.85, 0.05), s * 0.025);
  const shadow = m.shifted(2, 3).blur(2.5);
  c.paint(shadow, [0.05, 0.04, 0.03], 0.35);
  const col = hex(rng.pick(leafCols));
  const seed = rng.seed();
  c.paint(m, (px, py) => mul3(col, 0.75 + 0.45 * fbm(px * 0.08, py * 0.08, 2, seed)), 1, { rough: 0.8 });
  const vein = c.mask().capsule(...P(-0.5, 0), ...P(0.45, 0), Math.max(0.5, s * 0.02));
  c.multiply(vein.min(m), [0.6, 0.5, 0.4], 0.7);
  c.lift(m.clone().blur(1), 1.5);
  // the leaf curls: edges up
  c.lift(m.clone().cut(m.clone().grow(-2)), 1.2);
}

// ---- register ------------------------------------------------------------------------------------

export function register(R) {
  const BV = ['fresh', 'dry'];
  // ---- blood --------------------------------------------------------------------------------------
  for (let i = 1; i <= 4; i++) {
    R(`blood.splat${i}`, { sheet: S, px: [384, 384], size: [24 + i * 2, 24 + i * 2], surf: 'any', tags: ['blood', 'splat'], variants: BV }, (c, rng, v) => {
      const { w, h } = c;
      const b = bloodOf(v);
      bloodSplat(c, w * rng.range(0.42, 0.58), h * rng.range(0.42, 0.58), w * rng.range(0.12, 0.18), rng, { col: b.col, rough: b.rough, alpha: b.alpha, reach: 2.6, spread: i === 4 ? 1.4 : Math.PI * 2 });
      if (i % 2 === 0) bloodSplat(c, w * rng.range(0.25, 0.75), h * rng.range(0.25, 0.75), w * rng.range(0.04, 0.07), rng, { col: b.col, rough: b.rough, alpha: b.alpha, drops: 10 });
      if (v === 'dry') c.fade((x, y) => 0.65 + 0.35 * fbm(x * 0.03, y * 0.03, 3, 5));
    });
  }
  R('blood.spray', { sheet: S, px: [512, 448], size: [36, 31], surf: 'wall', tags: ['blood', 'spray', 'wall'], variants: BV }, (c, rng, v) => {
    const { w, h } = c;
    const b = bloodOf(v);
    const m = bloodSplat(c, w * 0.32, h * 0.35, w * 0.09, rng, { col: b.col, rough: b.rough, alpha: b.alpha, dir: -0.15, spread: 1.0, reach: 6, drops: 70 });
    // runs down the wall from the heavy part
    const runs = c.mask();
    for (let k = 0; k < 9; k++) {
      const x = w * rng.range(0.22, 0.5), y = h * rng.range(0.32, 0.42), L = h * rng.range(0.15, 0.55);
      runs.stroke([[x, y], [x + rng.range(-2, 2), y + L]], (t) => rng.range(2.5, 4.5) * (1 - t * 0.4));
      runs.circle(x, y + L, 3.5);
    }
    c.paint(runs.min(c.mask().fill().cut(c.mask().rect(w / 2, h - 2, w, 4, 0))), b.col, b.alpha * 0.92, { rough: b.rough });
    void m;
    if (v === 'dry') c.fade((x, y) => 0.7 + 0.3 * fbm(x * 0.03, y * 0.03, 3, 5));
  });
  R('blood.drips', { sheet: S, px: [256, 512], size: [14, 28], surf: 'wall', tags: ['blood', 'wall'], variants: BV }, (c, rng, v) => {
    const { w, h } = c;
    const b = bloodOf(v);
    const smear = c.mask().ellipse(w / 2, h * 0.12, w * 0.4, h * 0.08, rng.range(-0.2, 0.2)).warp(6, 0.05, rng.seed());
    c.paint(smear, b.col, b.alpha * 0.9, { rough: b.rough });
    const runs = c.mask();
    for (let k = 0; k < 7; k++) {
      const x = w * rng.range(0.18, 0.82), L = h * rng.range(0.25, 0.85);
      runs.stroke([[x, h * 0.13], [x + rng.range(-3, 3), h * 0.13 + L]], (t) => rng.range(3, 6) * (1 - t * 0.5));
      runs.circle(x, h * 0.13 + L, rng.range(3, 5));
    }
    c.paint(runs, b.col, b.alpha, { rough: b.rough });
    c.lift(runs, 1);
  });
  const handShape = (c, x, y, s, a, spread = 1) => {
    const m = c.mask();
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (u, v) => [x + (u * ca - v * sa) * s, y + (u * sa + v * ca) * s];
    m.ellipse(...P(0, 0.12), s * 0.36, s * 0.42, a);
    const fingers = [[-0.27, -0.42, -0.36, -0.8], [-0.09, -0.48, -0.12, -0.98], [0.09, -0.48, 0.12, -0.95], [0.26, -0.4, 0.34 * spread, -0.78]];
    for (const [u0, v0, u1, v1] of fingers) m.capsule(...P(u0, v0), ...P(u1, v1), s * 0.075, s * 0.07);
    m.capsule(...P(-0.32, 0.12), ...P(-0.62 * spread, -0.18), s * 0.085, s * 0.075);
    return m;
  };
  R('blood.hand', { sheet: S, px: [192, 256], size: [6, 8], surf: 'wall', tags: ['blood', 'hand', 'wall'], variants: BV }, (c, rng, v) => {
    const { w, h } = c;
    const b = bloodOf(v);
    const seed = rng.seed();
    const m = handShape(c, w / 2, h * 0.58, h * 0.4, rng.range(-0.15, 0.15));
    // uneven transfer: the creases and the middle of the palm print lighter
    m.mulBy((x, y) => 0.45 + 0.55 * smoothstep(0.3, 0.6, fbm(x * 0.08, y * 0.08, 3, seed)));
    c.paint(m, b.col, b.alpha, { rough: b.rough });
  });
  R('blood.hands', { sheet: S, px: [384, 512], size: [18, 24], surf: 'wall', tags: ['blood', 'hand', 'wall', 'story'], variants: BV }, (c, rng, v) => {
    const { w, h } = c;
    const b = bloodOf(v);
    const seed = rng.seed();
    for (let k = 0; k < 5; k++) {
      const x = w * rng.range(0.2, 0.8), y = h * rng.range(0.15, 0.7), s = h * 0.17;
      const m = handShape(c, x, y, s, rng.range(-0.6, 0.6), rng.range(0.8, 1.2));
      // the hand slid down
      if (rng.chance(0.6)) { const sl = m.clone(); for (let d = 4; d < h * 0.18; d += 4) sl.max(m.shifted(0, d | 0).scale(0.7 - d / (h * 0.3))); m.max(sl); }
      m.mulBy((px, py) => 0.4 + 0.6 * smoothstep(0.3, 0.6, fbm(px * 0.06, py * 0.06, 3, seed + k)));
      c.paint(m, b.col, b.alpha * rng.range(0.7, 1), { rough: b.rough });
    }
  });
  R('blood.drag', { sheet: S, px: [256, 1024], size: [18, 74], surf: 'floor', tags: ['blood', 'drag', 'floor', 'trail'], variants: BV }, (c, rng, v) => {
    const { w, h } = c;
    const b = bloodOf(v);
    const seed = rng.seed();
    const m = c.mask();
    m.map((x, y) => {
      const t = y / h;
      const cx = w / 2 + Math.sin(t * 5 + 1) * w * 0.08 + (fbm(t * 4, 0, 2, seed) - 0.5) * w * 0.2;
      const wd = w * (0.18 + 0.12 * fbm(t * 6, 1, 2, seed)) * (1 - t * 0.5);
      const d = Math.abs(x - cx);
      const band = clamp01((wd - d) / 4);
      const streaks = 0.35 + 0.65 * vnoise((x - cx) * 0.35, t * 3, seed + 2);
      return band * streaks * (1 - t) ** 0.6;
    });
    m.blur(1);
    c.paint(m, b.col, b.alpha, { rough: b.rough });
    // the pool it started from, and drops along it
    bloodSplat(c, w / 2, h * 0.06, w * 0.22, rng, { col: b.col, rough: b.rough, alpha: b.alpha, drops: 12, reach: 1.6 });
    for (let k = 0; k < 18; k++) { const y = h * rng.range(0.1, 0.95); c.paint(c.mask().circle(w * rng.range(0.25, 0.75), y, rng.range(1.5, 4)), b.col, b.alpha * (1 - y / h * 0.5)); }
  });
  R('blood.drag-hands', { sheet: S, px: [320, 1024], size: [22, 72], surf: 'floor', tags: ['blood', 'drag', 'floor', 'trail', 'story'], variants: BV }, (c, rng, v) => {
    const { w, h } = c;
    const b = bloodOf(v);
    const seed = rng.seed();
    const m = c.mask();
    m.map((x, y) => {
      const t = y / h;
      const cx = w / 2 + (fbm(t * 3, 0, 2, seed) - 0.5) * w * 0.25;
      const wd = w * (0.12 + 0.08 * fbm(t * 6, 1, 2, seed));
      const band = clamp01((wd - Math.abs(x - cx)) / 3);
      return band * (0.3 + 0.7 * vnoise((x - cx) * 0.3, t * 3, seed + 2)) * (0.4 + 0.6 * (1 - t));
    });
    c.paint(m.blur(1), b.col, b.alpha, { rough: b.rough });
    // clawing hands on either side, pointing back up the trail (someone dragged away)
    for (let k = 0; k < 6; k++) {
      const y = h * (0.12 + k * 0.14), side = k % 2 ? 1 : -1;
      const hm = handShape(c, w / 2 + side * w * 0.3, y, w * 0.2, Math.PI + side * 0.35);
      hm.mulBy((px, py) => 0.35 + 0.65 * smoothstep(0.3, 0.6, fbm(px * 0.08, py * 0.08, 3, seed + k)));
      // fingers dragged: streaks behind them
      const st = c.mask();
      for (let f = 0; f < 4; f++) { const fx = w / 2 + side * w * (0.22 + f * 0.04); st.capsule(fx, y + w * 0.12, fx + rng.range(-2, 2), y + w * 0.12 + h * rng.range(0.03, 0.08), 2, 1); }
      c.paint(hm.max(st.scale(0.7)), b.col, b.alpha * 0.9, { rough: b.rough });
    }
  });
  R('blood.pool', { sheet: S, px: [512, 512], size: [40, 40], surf: 'floor', tags: ['blood', 'pool', 'floor'], variants: BV }, (c, rng, v) => {
    const { w, h } = c;
    const b = bloodOf(v);
    const seed = rng.seed();
    const m = c.mask();
    for (let k = 0; k < 5; k++) m.circle(w * rng.range(0.35, 0.65), h * rng.range(0.35, 0.65), w * rng.range(0.12, 0.24));
    m.blur(14).thresh(0.5, 0.05).warp(8, 0.02, seed);
    c.paint(m, (x, y) => mix3(b.col, mul3(b.col, 0.4), clamp01(fbm(x * 0.01, y * 0.01, 3, seed) * 1.4 - 0.2)), b.alpha, { rough: v === 'dry' ? 0.55 : 0.05 });
    // a dried crust ring at the edge
    const rim = m.clone().cut(m.clone().grow(-4));
    c.paint(rim, hex('#2a0806'), 0.7, { rough: 0.6 });
    c.lift(m.clone().blur(3), 1.2);
    bloodSplat(c, w * 0.7, h * 0.3, w * 0.05, rng, { col: b.col, rough: b.rough, alpha: b.alpha, drops: 8 });
  });
  // footprint trails: a shoe (tread) or bare feet, getting fainter step by step
  for (const [id, bare] of [['blood.prints', false], ['blood.prints-bare', true]]) {
    R(id, { sheet: S, px: [256, 1024], size: [16, 64], surf: 'floor', tags: ['blood', 'footprints', 'floor', 'trail'], variants: BV }, (c, rng, v) => {
      const { w, h } = c;
      const b = bloodOf(v);
      const seed = rng.seed();
      const n = 8;
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? 1 : -1;
        const x = w / 2 + side * w * 0.14 + rng.range(-3, 3), y = h * 0.93 - k * (h * 0.86) / (n - 1);
        const a = rng.range(-0.12, 0.12) + side * 0.06;
        const s = h * 0.085;
        const ca = Math.cos(a), sa = Math.sin(a);
        const P = (u, vv) => [x + (u * ca - vv * sa) * s, y + (u * sa + vv * ca) * s];
        const m = c.mask();
        if (bare) {
          m.ellipse(...P(0, -0.15), s * 0.27, s * 0.42, a).ellipse(...P(side * 0.04, 0.42), s * 0.2, s * 0.22, a);
          for (let t = 0; t < 5; t++) m.circle(...P(-0.2 + t * 0.1 * 1, -0.62 + Math.abs(t - 1) * 0.04), s * (t === 0 ? 0.08 : 0.055));
          m.cut(c.mask().ellipse(...P(-side * 0.18, 0.05), s * 0.09, s * 0.22, a));
        } else {
          m.ellipse(...P(0, -0.2), s * 0.3, s * 0.44, a).ellipse(...P(0, 0.45), s * 0.25, s * 0.26, a);
          // tread: cut chevrons
          const tr = c.mask();
          for (let t = -0.55; t < 0.7; t += 0.13) tr.stroke([P(-0.3, t), P(0, t - 0.06), P(0.3, t)], s * 0.035);
          m.cut(tr, 0.85);
        }
        const fade = 1 - k / (n + 1);
        m.mulBy((px, py) => (0.5 + 0.5 * fbm(px * 0.1, py * 0.1, 2, seed + k)));
        c.paint(m, b.col, b.alpha * fade, { rough: b.rough });
      }
    });
  }

  // ---- bullet holes -------------------------------------------------------------------------------
  const HOLES = [
    ['holes.concrete', 'concrete', 9, 'cluster'], ['holes.concrete-line', 'concrete', 11, 'line'], ['holes.metal', 'metal', 7, 'cluster'], ['holes.metal-line', 'metal', 9, 'line'],
    ['holes.glass', 'glass', 4, 'cluster'], ['holes.glass-one', 'glass', 1, 'cluster'], ['holes.wood', 'wood', 6, 'cluster'], ['holes.plaster', 'plaster', 8, 'cluster'],
  ];
  for (const [id, kind, n, layout] of HOLES) {
    R(id, { sheet: S, px: [384, 384], size: [24, 24], surf: 'wall', tags: ['holes', kind, 'damage'] }, (c, rng) => {
      const { w, h } = c;
      const r = kind === 'glass' ? w * 0.024 : kind === 'wood' ? w * 0.03 : w * 0.026;
      for (let k = 0; k < n; k++) {
        let x, y;
        if (layout === 'line') { const t = k / (n - 1); x = w * (0.1 + t * 0.8) + rng.range(-8, 8); y = h * (0.6 - t * 0.25) + rng.range(-14, 14); } else { const a = rng.range(0, Math.PI * 2), d = rng.range(0, 0.32) * w * (n === 1 ? 0 : 1); x = w / 2 + Math.cos(a) * d; y = h / 2 + Math.sin(a) * d; }
        bulletHole(c, x, y, r * rng.range(0.8, 1.25), kind, rng);
      }
    });
  }

  // ---- fire -------------------------------------------------------------------------------------------
  R('scorch.blast', { sheet: S, px: [512, 512], size: [64, 64], surf: 'any', tags: ['scorch', 'fire', 'damage'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    const m = c.mask().map((x, y) => {
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
      const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const rays = 0.75 + 0.25 * vnoise(a * 5, 0, seed) + 0.2 * vnoise(a * 17, 3, seed);
      return clamp01((rays - r) * 2.2) * (0.75 + 0.25 * fbm(x * 0.02, y * 0.02, 3, seed));
    });
    c.paint(m, (x, y) => mix3([0.06, 0.05, 0.045], [0.18, 0.15, 0.12], fbm(x * 0.03, y * 0.03, 3, seed + 1)), 0.92, { rough: 0.95 });
    const core = c.mask().circle(w / 2, h / 2, w * 0.12).blur(w * 0.05).warp(6, 0.03, seed);
    c.paint(core, [0.02, 0.02, 0.02], 0.9);
    c.lift(core, -3);
    for (let k = 0; k < 30; k++) { const a = rng.range(0, 6.3), d = w * rng.range(0.15, 0.45); c.paint(c.mask().circle(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, rng.range(1.5, 4)), [0.06, 0.05, 0.05], 0.8); }
  });
  R('scorch.small', { sheet: S, px: [384, 384], size: [30, 30], surf: 'any', tags: ['scorch', 'fire', 'damage'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    const m = c.mask().circle(w / 2, h / 2, w * 0.36).blur(w * 0.1).warp(w * 0.06, 0.012, seed);
    m.mulBy((x, y) => 0.7 + 0.3 * fbm(x * 0.05, y * 0.05, 3, seed));
    c.paint(m, [0.07, 0.06, 0.05], 0.88, { rough: 0.95 });
    const rim = c.mask().circle(w / 2, h / 2, w * 0.4).blur(w * 0.04).cut(c.mask().circle(w / 2, h / 2, w * 0.3).blur(w * 0.05));
    c.paint(rim, [0.35, 0.25, 0.16], 0.25);
  });
  R('scorch.wall', { sheet: S, px: [512, 640], size: [44, 55], surf: 'wall', tags: ['scorch', 'soot', 'fire', 'wall'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    // soot climbs from a fire at the foot of the wall: wide and black at the base, wisps up top
    const m = c.mask().map((x, y) => {
      const t = 1 - y / h;
      const cx = w / 2 + (fbm(t * 2, 0, 2, seed) - 0.5) * w * 0.3 * t;
      const wd = w * (0.42 - t * 0.22) * (0.8 + 0.4 * fbm(t * 5, 2, 2, seed));
      const d = Math.abs(x - cx) / wd;
      const tongues = 0.6 + 0.4 * vnoise((x - cx) * 0.03, t * 3 - x * 0.002, seed + 3);
      return clamp01((1 - d) * 1.6) * tongues * (1 - t * 0.85) ** 0.7;
    });
    m.blur(3);
    c.paint(m, [0.05, 0.045, 0.04], 0.9, { rough: 0.95 });
    const char = c.mask().map((x, y) => smoothstep(0.75, 1, y / h) * smoothstep(0.55, 0.0, Math.abs(x / w - 0.5)) * (0.7 + 0.3 * fbm(x * 0.06, y * 0.06, 2, seed)));
    c.paint(char, [0.02, 0.02, 0.02], 0.9);
    c.lift(char, 1);
  });

  // ---- cracks and spalling ------------------------------------------------------------------------
  for (let i = 1; i <= 3; i++) {
    R(`crack.wall${i}`, { sheet: S, px: [512, 512], size: [44, 44], surf: 'wall', tags: ['crack', 'concrete', 'wall', 'damage'] }, (c, rng) => {
      const { w, h } = c;
      const paths = [];
      const n = i === 3 ? 4 : 2;
      for (let k = 0; k < n; k++) {
        const a = i === 3 ? (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3) : rng.range(0.9, 2.2);
        const sx = i === 3 ? w / 2 : w * rng.range(0.3, 0.7), sy = i === 3 ? h / 2 : h * 0.06;
        paths.push(...crackPaths(rng, sx, sy, a, (i === 3 ? 0.42 : 0.85) * h, i === 3 ? 4 : 3.5));
      }
      drawCracks(c, rng, paths);
      if (i === 3) { const sp = c.mask().circle(w / 2, h / 2, w * 0.06).warp(5, 0.1, rng.seed()); c.paint(sp, [0.35, 0.34, 0.32], 0.9); c.lift(sp, -3); }
    });
  }
  for (let i = 1; i <= 2; i++) {
    R(`crack.floor${i}`, { sheet: S, px: [640, 640], size: [70, 70], surf: 'floor', tags: ['crack', 'concrete', 'floor', 'damage'] }, (c, rng) => {
      const { w, h } = c;
      const paths = crackPaths(rng, w * 0.05, h * rng.range(0.3, 0.7), rng.range(-0.3, 0.3), w * 0.95, 5);
      if (i === 2) paths.push(...crackPaths(rng, w * 0.5, h * 0.05, Math.PI / 2 + rng.range(-0.3, 0.3), h * 0.9, 4));
      drawCracks(c, rng, paths, { depth: 3 });
      // weeds in the crack
      const weeds = c.mask();
      for (let k = 0; k < 14; k++) { const [pts] = paths[0]; const [x, y] = pts[Math.floor(rng.next() * pts.length)]; weeds.circle(x + rng.range(-4, 4), y + rng.range(-4, 4), rng.range(2, 6)); }
      weeds.warp(3, 0.2, rng.seed());
      c.paint(weeds, (x, y) => mix3(hex('#3c5a1c'), hex('#6a7f2a'), fbm(x * 0.1, y * 0.1, 2, 4)), 0.9, { rough: 0.9 });
      c.lift(weeds, 2);
    });
  }
  for (let i = 1; i <= 2; i++) {
    R(`spall.concrete${i}`, { sheet: S, px: [384, 384], size: [28, 28], surf: 'wall', tags: ['spall', 'concrete', 'wall', 'damage'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      const hole = c.mask();
      const pts = [];
      for (let k = 0; k < 11; k++) { const a = (k / 11) * Math.PI * 2; const r = w * rng.range(0.22, 0.4); pts.push([w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r * 0.8]); }
      hole.poly(pts).warp(7, 0.05, seed);
      // the broken face: aggregate (pebbles) in grey cement, lower than the wall
      c.paint(hole, (x, y) => { const p = ridge(x * 0.12, y * 0.12, 2, seed); const v = 0.42 + p * 0.18 + hash2(x, y, seed) * 0.05; return [v, v * 0.97, v * 0.93]; }, 1, { rough: 0.98 });
      c.lift(hole.clone().blur(1.5), -6);
      c.lift(hole.clone().mulBy((x, y) => ridge(x * 0.12, y * 0.12, 2, seed)), 2);
      // rebar
      if (i === 1 || rng.chance(0.5)) {
        for (const yy of [0.42, 0.62]) {
          const bar = c.mask().bar(w * 0.18, h * yy, w * 0.82, h * (yy + 0.02), 5);
          bar.min(hole.clone().grow(-2));
          c.paint(bar, (x, y) => mix3(C.rust, C.rustDark, fbm(x * 0.1, y * 0.1, 2, seed)), 1, { rough: 0.9 });
          c.lift(bar, 7);
          const ribs = c.mask();
          for (let x = w * 0.18; x < w * 0.82; x += 9) ribs.bar(x, h * yy - 4, x + 2, h * yy + 6, 1.2);
          c.lift(ribs.min(bar), 1.5);
        }
        // rust bleeding down from the bars
        const run = c.mask().map((x, y) => (y > h * 0.45 ? smoothstep(0.55, 0.9, vnoise(x * 0.2, 0, seed)) * smoothstep(h, h * 0.45, y) * 0.6 : 0)).min(c.mask().rect(w / 2, h * 0.7, w * 0.6, h * 0.6, 0).blur(8));
        c.paint(run, hex('#6a3a1c'), 0.4);
      }
      const rim = hole.clone().grow(4).cut(hole);
      c.paint(rim.blur(1.5), [0.72, 0.7, 0.66], 0.5);
      c.lift(rim, 1);
      // chips around it
      for (let k = 0; k < 10; k++) { const a = rng.range(0, 6.3), d = w * rng.range(0.38, 0.48); const ch = c.mask().circle(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d * 0.8, rng.range(2, 6)).warp(2, 0.3, seed + k); c.paint(ch, [0.45, 0.44, 0.42], 0.9); c.lift(ch, -2); }
    });
  }

  // ---- water, rust, grime, soot -------------------------------------------------------------------
  R('stain.water', { sheet: S, px: [512, 640], size: [44, 55], surf: 'wall', tags: ['stain', 'water', 'wall', 'grime'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    const m = runMask(c, rng, w * 0.05, w * 0.95, 0, h * 0.96, { pow: 0.8, streakF: 0.08 });
    c.paint(m, (x, y) => mix3([0.32, 0.27, 0.2], [0.18, 0.15, 0.11], fbm(x * 0.02, y * 0.02, 2, seed)), 0.55, { rough: 0.7 });
    // tide lines where it dried, near the bottom of the stain
    const tide = c.mask().map((x, y) => {
      const edge = h * (0.6 + 0.25 * fbm(x * 0.008, 0, 3, seed));
      return Math.max(0, 1 - Math.abs(y - edge) / 2.5) * (smoothstep(0, 0.1, x / w) * smoothstep(1, 0.9, x / w));
    });
    c.paint(tide, [0.36, 0.26, 0.14], 0.6);
    c.erase(c.mask().map((x, y) => smoothstep(h * 0.62, h * 0.95, y + (fbm(x * 0.01, 0, 3, seed) - 0.5) * h * 0.3)));
  });
  R('stain.damp', { sheet: S, px: [768, 256], size: [80, 26], surf: 'wall', tags: ['stain', 'water', 'wall', 'grime', 'base'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    // rising damp: a dark band at the foot of the wall with a salty white tide line on top
    const edge = (x) => h * (0.25 + 0.3 * fbm(x * 0.006, 0, 3, seed));
    const m = c.mask().map((x, y) => smoothstep(edge(x) - 6, edge(x) + 20, y) * smoothstep(0, 0.06, x / w) * smoothstep(1, 0.94, x / w));
    c.paint(m, [0.22, 0.19, 0.15], 0.5, { rough: 0.6 });
    const salt = c.mask().map((x, y) => Math.max(0, 1 - Math.abs(y - edge(x)) / 3) * smoothstep(0, 0.06, x / w) * smoothstep(1, 0.94, x / w) * (0.6 + 0.4 * vnoise(x * 0.1, 0, seed)));
    c.paint(salt, [0.82, 0.8, 0.74], 0.55, { rough: 0.95 });
    const bloom = c.mask().map((x, y) => (y < edge(x) && y > edge(x) - 14 ? smoothstep(0.7, 0.9, fbm(x * 0.08, y * 0.08, 2, seed)) : 0));
    c.paint(bloom, [0.85, 0.84, 0.8], 0.4);
  });
  R('stain.rings', { sheet: S, px: [448, 448], size: [40, 40], surf: 'any', tags: ['stain', 'water', 'grime'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    for (let k = 0; k < 4; k++) {
      const r = w * (0.44 - k * 0.09), cx = w / 2 + rng.range(-10, 10), cy = h / 2 + rng.range(-10, 10);
      const ring = c.mask().map((x, y) => { const d = Math.hypot(x - cx, y - cy) + (fbm(x * 0.02, y * 0.02, 3, seed + k) - 0.5) * 30; return Math.max(0, 1 - Math.abs(d - r) / 2.5) * 0.9 + (d < r ? 0.12 : 0); });
      c.paint(ring, [0.38, 0.28, 0.16], 0.5);
    }
  });
  for (let i = 1; i <= 3; i++) {
    R(`rust.streak${i}`, { sheet: S, px: [192, 512], size: [10, 28], surf: 'wall', tags: ['rust', 'streak', 'wall', 'metal'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      const x0 = w * 0.2, x1 = w * 0.8;
      const m = runMask(c, rng, x0, x1, h * 0.04, h * (0.6 + i * 0.12), { pow: 1.2, streakF: 0.3 });
      c.paint(m, (x, y) => mix3(hex('#8a4a1e'), hex('#5a2c12'), fbm(x * 0.05, y * 0.02, 2, seed)), 0.8, { rough: 0.85 });
      // the source: a bolt or a weld seam
      if (i !== 3) { const b = c.mask().circle(w / 2, h * 0.04 + 4, 7); c.paint(b, C.rustDark); c.lift(b.blur(1), 3); }
      else { const sm = c.mask().bar(0, h * 0.04, w, h * 0.04, 3); c.paint(sm, C.rustDark, 0.9); c.lift(sm, 2); }
    });
  }
  for (let i = 1; i <= 3; i++) {
    R(`grime.base${i}`, { sheet: S, px: [1024, 256], size: [100, 25], surf: 'wall', tags: ['grime', 'base', 'wall'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      // dirt splashed up the foot of the wall, darkest at the bottom; drip streaks above
      const m = c.mask().map((x, y) => {
        const t = 1 - y / h;
        const top = 0.45 + 0.35 * fbm(x * 0.004, 0, 3, seed);
        const k = smoothstep(top, 0, t) ** 1.3;
        const ends = smoothstep(0, 0.08, x / w) * smoothstep(1, 0.92, x / w);
        const speck = hash2(x, y, seed) > 0.985 - 0.04 * (1 - t) ? 0.5 : 0;
        return clamp01((k * (0.65 + 0.35 * fbm(x * 0.02, y * 0.03, 3, seed + 1)) + speck * smoothstep(0.7, 0, t)) * ends);
      });
      const col = i === 1 ? [0.16, 0.13, 0.1] : i === 2 ? [0.2, 0.17, 0.12] : [0.12, 0.12, 0.1];
      c.paint(m, col, 0.82, { rough: 0.95 });
      const streaks = c.mask();
      for (let k = 0; k < 30; k++) { const x = w * rng.range(0.05, 0.95), y0 = h * rng.range(0.0, 0.4); streaks.capsule(x, y0, x + rng.range(-2, 2), y0 + h * rng.range(0.2, 0.6), rng.range(0.8, 2.2), 0.5); }
      c.paint(streaks.blur(1.2), col, 0.3);
    });
  }
  R('grime.patch', { sheet: S, px: [512, 512], size: [44, 44], surf: 'any', tags: ['grime', 'dirt'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    const m = c.mask().map((x, y) => {
      const r = Math.hypot(x / w - 0.5, y / h - 0.5) * 2;
      return clamp01((smoothstep(1, 0.3, r) * (fbm(x * 0.012, y * 0.012, 5, seed) * 1.6 - 0.35)));
    });
    c.paint(m, [0.17, 0.14, 0.1], 0.75, { rough: 0.95 });
  });
  for (let i = 1; i <= 2; i++) {
    R(`soot.streak${i}`, { sheet: S, px: [384, 640], size: [30, 50], surf: 'wall', tags: ['soot', 'grime', 'wall', 'fire'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      // soot that poured up out of a window or a vent below the decal: the bottom edge is the opening
      const m = c.mask().map((x, y) => {
        const t = 1 - y / h;
        const spread = 0.32 + t * 0.18;
        const cx = 0.5 + (fbm(t * 2, 0, 2, seed) - 0.5) * 0.25 * t;
        const d = Math.abs(x / w - cx) / spread;
        return clamp01((1 - d) * 1.4) * (0.55 + 0.45 * vnoise(x * 0.02, t * 4 + x * 0.004, seed)) * (1 - t) ** (i === 1 ? 0.8 : 1.3);
      });
      c.paint(m.blur(2), [0.05, 0.045, 0.04], 0.85, { rough: 0.95 });
    });
  }

  // ---- peeling paint ------------------------------------------------------------------------------
  const PEEL = [['peel.white', '#e6e2d6', '#b9b2a1'], ['peel.green', '#8fb39a', '#c8c0aa'], ['peel.blue', '#7f9cb8', '#bdb5a2']];
  for (const [id, paintHex, underHex] of PEEL) {
    R(id, { sheet: S, px: [512, 512], size: [40, 40], surf: 'wall', tags: ['peel', 'paint', 'wall', 'damage'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      const under = hex(underHex), pc = hex(paintHex);
      const region = c.mask().map((x, y) => {
        const r = Math.hypot(x / w - 0.5, (y / h - 0.5) * 1.2) * 2;
        return smoothstep(0.62, 0.66, fbm(x * 0.012, y * 0.012, 5, seed) + (1 - r) * 0.35);
      });
      // exposed plaster: mottled, stained
      c.paint(region, (x, y) => mul3(under, 0.8 + 0.3 * fbm(x * 0.03, y * 0.03, 3, seed + 2)), 1, { rough: 0.95 });
      // the flakes at the edge: paint that lifted and curls, with a shadow under it
      const rim = region.clone().grow(5).cut(region);
      const flakes = rim.clone().mulBy((x, y) => smoothstep(0.45, 0.55, vnoise(x * 0.09, y * 0.09, seed + 4)));
      const shadow = region.clone().cut(region.clone().grow(-4)).mulBy((x, y) => smoothstep(0.4, 0.6, vnoise(x * 0.09, y * 0.09, seed + 4)));
      c.paint(shadow.blur(1.5), [0.12, 0.1, 0.08], 0.6);
      c.paint(flakes, (x, y) => mul3(pc, 0.92 + 0.12 * hash2(x, y, seed)), 1, { rough: 0.6 });
      c.lift(flakes.clone().blur(0.8), 3.5);
      c.lift(region, -1.5);
      // loose islands of paint left inside
      const isl = region.clone().mulBy((x, y) => smoothstep(0.7, 0.74, fbm(x * 0.05, y * 0.05, 3, seed + 6)));
      c.paint(isl, pc, 1, { rough: 0.6 });
      c.lift(isl, 2);
    });
  }

  // ---- living things ---------------------------------------------------------------------------
  for (let i = 1; i <= 2; i++) {
    R(`moss.${i}`, { sheet: S, px: [512, 384], size: [44, 33], surf: 'any', tags: ['moss', 'nature', 'base'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      const m = c.mask().map((x, y) => {
        const base = i === 1 ? smoothstep(0.1, 0.85, y / h) : 1 - Math.hypot(x / w - 0.5, y / h - 0.5) * 1.6;
        const edge = Math.min(x / w, 1 - x / w, y / h, 1 - y / h) * 2;
        return smoothstep(0.62, 0.7, fbm(x * 0.015, y * 0.02, 5, seed) * 0.75 + base * 0.32) * smoothstep(0, 0.25, edge);
      });
      m.mulBy((x, y) => 0.55 + 0.45 * smoothstep(0.35, 0.6, fbm(x * 0.06, y * 0.06, 3, seed + 9)));
      const tuft = (x, y) => fbm(x * 0.15, y * 0.15, 2, seed + 3);
      c.paint(m, (x, y) => mix3(hex('#26341a'), hex('#5e6e2c'), clamp01(tuft(x, y) * 1.3 - 0.15)), 0.95, { rough: 0.95 });
      c.lift(m.clone().blur(2), 3);
      c.lift(m.clone().mulBy(tuft), 2.5);
    });
  }
  for (let i = 1; i <= 2; i++) {
    R(`lichen.${i}`, { sheet: S, px: [384, 384], size: [30, 30], surf: 'any', tags: ['lichen', 'nature'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      for (let k = 0; k < 16; k++) {
        const x = w * rng.range(0.12, 0.88), y = h * rng.range(0.12, 0.88), r = w * rng.range(0.03, 0.09);
        const ro = c.mask().circle(x, y, r).warp(r * 0.25, 0.08, seed + k);
        const col = i === 1 ? mix3(hex('#a9ab7e'), hex('#c8c79a'), rng.next()) : mix3(hex('#c98a2a'), hex('#d8b04a'), rng.next());
        c.paint(ro, (px, py) => mul3(col, 0.8 + 0.3 * fbm(px * 0.15, py * 0.15, 2, seed)), 0.85, { rough: 0.95 });
        const ring = ro.clone().cut(ro.clone().grow(-3));
        c.multiply(ring, [0.8, 0.8, 0.75], 0.6);
        c.lift(ro, 1);
      }
    });
  }

  // ---- floors: oil, tyres, puddles -------------------------------------------------------------
  for (let i = 1; i <= 3; i++) {
    R(`oil.${i}`, { sheet: S, px: [384, 384], size: [26 + i * 4, 26 + i * 4], surf: 'floor', tags: ['oil', 'floor', 'road'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      const m = c.mask();
      for (let k = 0; k < 4 + i * 2; k++) m.circle(w * rng.range(0.32, 0.68), h * rng.range(0.32, 0.68), w * rng.range(0.06, 0.16));
      m.blur(16).thresh(0.4, 0.08).warp(18, 0.012, seed).warp(4, 0.08, seed + 1);
      c.paint(m, (x, y) => mix3([0.03, 0.03, 0.03], [0.1, 0.09, 0.08], fbm(x * 0.02, y * 0.02, 3, seed)), 0.85, { rough: 0.12 });
      // a faint rainbow at the edge
      const rim = m.clone().cut(m.clone().grow(-6));
      c.paint(rim, (x, y) => { const t = fbm(x * 0.05, y * 0.05, 2, seed) * 6; return [0.35 + 0.25 * Math.sin(t), 0.3 + 0.25 * Math.sin(t + 2), 0.35 + 0.25 * Math.sin(t + 4)]; }, 0.25, { rough: 0.05 });
      // drips around it
      for (let k = 0; k < 8; k++) c.paint(c.mask().circle(w * rng.range(0.1, 0.9), h * rng.range(0.1, 0.9), rng.range(2, 6)), [0.04, 0.04, 0.04], 0.8, { rough: 0.15 });
    });
  }
  R('tyre.skid', { sheet: S, px: [256, 1024], size: [26, 130], surf: 'floor', tags: ['tyre', 'skid', 'floor', 'road'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    const m = c.mask().map((x, y) => {
      const t = y / h;
      const bend = Math.sin(t * 2.2) * w * 0.05;
      let v = 0;
      for (const cx of [0.25, 0.75]) {
        const d = Math.abs(x - (cx * w + bend)) / (w * 0.12);
        v = Math.max(v, clamp01((1 - d) * 3));
      }
      const lines = 0.65 + 0.35 * vnoise(x * 0.5, t * 2, seed);
      return v * lines * smoothstep(0, 0.12, t) * smoothstep(1, 0.75, t) ** 0.7;
    });
    c.paint(m, [0.04, 0.04, 0.04], 0.75, { rough: 0.5 });
  });
  R('tyre.tread', { sheet: S, px: [192, 1024], size: [14, 90], surf: 'floor', tags: ['tyre', 'tread', 'floor', 'mud'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    const m = c.mask().map((x, y) => {
      const cx = w / 2 + Math.sin(y / h * 3) * w * 0.06;
      const d = Math.abs(x - cx) / (w * 0.4);
      const band = clamp01((1 - d) * 4);
      // chevron tread blocks
      const u = (x - cx) / (w * 0.4), vv = y / 18 + Math.abs(u) * 0.8;
      const block = (vv - Math.floor(vv)) < 0.55 ? 1 : 0.15;
      return band * block * (0.6 + 0.4 * fbm(x * 0.05, y * 0.02, 3, seed)) * smoothstep(1, 0.6, y / h);
    });
    c.paint(m, [0.2, 0.15, 0.1], 0.85, { rough: 0.95 });
    c.lift(m, 1.5);
  });
  for (let i = 1; i <= 2; i++) {
    R(`puddle.rim${i}`, { sheet: S, px: [512, 512], size: [50, 50], surf: 'floor', tags: ['puddle', 'water', 'floor'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      const m = c.mask();
      for (let k = 0; k < 4; k++) m.circle(w * rng.range(0.35, 0.65), h * rng.range(0.35, 0.65), w * rng.range(0.14, 0.24));
      m.blur(18).thresh(0.5, 0.06).warp(12, 0.015, seed);
      // the wet middle: dark, glossy, nearly mirror
      c.paint(m, [0.06, 0.06, 0.06], i === 1 ? 0.45 : 0.25, { rough: 0.03 });
      c.lift(m.clone().blur(4), -1.5);
      // the dried rim: silt left where the water stood
      const rim = m.clone().grow(10).cut(m.clone().grow(2));
      rim.mulBy((x, y) => 0.5 + 0.5 * fbm(x * 0.05, y * 0.05, 3, seed + 1));
      c.paint(rim, [0.42, 0.36, 0.27], 0.55, { rough: 0.95 });
      const tide = m.clone().grow(12).cut(m.clone().grow(10));
      c.paint(tide, [0.34, 0.28, 0.2], 0.5);
    });
  }

  // ---- clutter ------------------------------------------------------------------------------------
  for (let i = 1; i <= 3; i++) {
    R(`litter.paper${i}`, { sheet: S, px: [512, 512], size: [40, 40], surf: 'floor', tags: ['litter', 'paper', 'floor', 'clutter'] }, (c, rng) => {
      const { w, h } = c;
      const n = 5 + i * 2;
      for (let k = 0; k < n; k++) {
        const x = w * rng.range(0.15, 0.85), y = h * rng.range(0.15, 0.85);
        if (rng.chance(0.25)) {
          // a crumpled ball
          const r = w * rng.range(0.025, 0.045);
          c.paint(c.mask().circle(x + 3, y + 4, r * 1.1).blur(3), [0, 0, 0], 0.35);
          const ball = c.mask().circle(x, y, r).warp(r * 0.25, 0.15, rng.seed());
          c.paint(ball, (px, py) => mul3([0.9, 0.88, 0.84], 0.55 + 0.6 * ridge(px * 0.15, py * 0.15, 2, k)), 1, { rough: 0.9 });
          c.lift(ball.clone().blur(2), 4);
          continue;
        }
        const pw = w * rng.range(0.1, 0.2), ph = pw * rng.range(1.2, 1.5), rot = rng.range(0, Math.PI);
        c.paint(c.mask().rect(x + 2, y + 3, pw, ph, 1, rot).blur(3), [0, 0, 0], 0.3);
        const col = rng.pick([C.paper, C.newsprint, hex('#efe2a6'), C.white, hex('#f3d2d2')]);
        const pm = paper(c, x, y, pw, ph, { rng, color: mul3(col, rng.range(0.8, 1)), rot, wrinkle: 0.9, scale: 3 });
        // print on it: lines across the sheet
        const pr = c.mask();
        const cr = Math.cos(rot), sr = Math.sin(rot);
        for (let l = 0; l < 8; l++) {
          const ly = -ph * 0.38 + l * ph * 0.1;
          const L = pw * rng.range(0.4, 0.8);
          pr.capsule(x + (-pw * 0.38) * cr - ly * sr, y + (-pw * 0.38) * sr + ly * cr, x + (-pw * 0.38 + L) * cr - ly * sr, y + (-pw * 0.38 + L) * sr + ly * cr, 0.8);
        }
        c.paint(pr.min(pm), C.ink, 0.55);
        // dirty, trodden
        c.multiply(pm.clone().mulBy((px, py) => smoothstep(0.5, 0.8, fbm(px * 0.03, py * 0.03, 3, k))), [0.6, 0.55, 0.45], 0.7);
      }
    });
  }
  for (let i = 1; i <= 3; i++) {
    R(`leaves.${i}`, { sheet: S, px: [512, 512], size: [40, 40], surf: 'floor', tags: ['leaves', 'nature', 'floor', 'clutter'] }, (c, rng) => {
      const { w, h } = c;
      const n = 30 + i * 12;
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * w * 0.42;
        leaf(c, rng, w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, w * rng.range(0.05, 0.09), rng.range(0, Math.PI * 2), (k + i) % 3);
      }
    });
  }
  for (let i = 1; i <= 2; i++) {
    R(`sand.drift${i}`, { sheet: S, px: [768, 384], size: [80, 40], surf: 'floor', tags: ['sand', 'floor', 'clutter', 'desert'] }, (c, rng) => {
      const { w, h } = c;
      const seed = rng.seed();
      // banked against a wall along the top edge, thinning out toward the bottom, rippled
      const m = c.mask().map((x, y) => {
        const edge = h * (0.55 + 0.3 * fbm(x * 0.006, 0, 3, seed));
        const k = smoothstep(edge, 0, y) ** 0.8;
        // (thin along the top too: on open ground it never shows a straight edge)
        return clamp01(k * (0.7 + 0.5 * fbm(x * 0.02, y * 0.02, 3, seed + 1))) * smoothstep(0, 0.2, x / w) * smoothstep(1, 0.8, x / w) * smoothstep(0, 0.12 + 0.1 * fbm(x * 0.01, 3, 2, seed), y / h);
      });
      const rip = (x, y) => 0.5 + 0.5 * Math.sin(y * 0.35 + x * 0.04 + fbm(x * 0.01, y * 0.01, 3, seed) * 8);
      c.paint(m, (x, y) => mix3(hex('#b99a6a'), hex('#d8c094'), rip(x, y) * 0.5 + fbm(x * 0.05, y * 0.05, 2, seed) * 0.5), 1, { rough: 0.98 });
      c.lift(m.clone().blur(4), 6);
      c.lift(m.clone().mulBy(rip), 1.2);
    });
  }
  R('glass.shards', { sheet: S, px: [384, 384], size: [26, 26], surf: 'floor', tags: ['glass', 'floor', 'clutter'] }, (c, rng) => {
    const { w, h } = c;
    for (let k = 0; k < 70; k++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * w * 0.44;
      const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d, s = w * rng.range(0.008, 0.04) * (1.2 - d / w);
      const pts = [];
      const nv = rng.int(3, 5), rot = rng.range(0, 6.3);
      for (let v = 0; v < nv; v++) { const t = rot + (v / nv) * Math.PI * 2 + rng.range(-0.4, 0.4); pts.push([x + Math.cos(t) * s * rng.range(0.5, 1.4), y + Math.sin(t) * s * rng.range(0.5, 1.4)]); }
      const m = c.mask().poly(pts);
      c.paint(m, [0.55, 0.62, 0.62], 0.45, { rough: 0.04 });
      const edge = m.clone().cut(m.clone().grow(-1.2));
      c.paint(edge, [0.9, 0.95, 0.95], 0.8, { rough: 0.02 });
      c.lift(m, 1.5);
    }
  });
  R('dust.drift', { sheet: S, px: [768, 256], size: [80, 26], surf: 'floor', tags: ['dust', 'floor', 'clutter', 'base', 'interior'] }, (c, rng) => {
    const { w, h } = c;
    const seed = rng.seed();
    // dust and grit swept against the foot of a wall (top edge), with a few bits in it
    const m = c.mask().map((x, y) => clamp01(smoothstep(h * (0.6 + 0.3 * fbm(x * 0.008, 0, 3, seed)), 0, y) * (0.6 + 0.6 * fbm(x * 0.03, y * 0.03, 3, seed + 1)) * smoothstep(0, 0.08, x / w) * smoothstep(1, 0.92, x / w)));
    c.paint(m, (x, y) => mix3([0.36, 0.33, 0.28], [0.52, 0.48, 0.42], fbm(x * 0.05, y * 0.05, 2, seed)), 0.85, { rough: 0.98 });
    for (let k = 0; k < 40; k++) { const x = w * rng.range(0.05, 0.95), y = h * rng.range(0, 0.5); const g = c.mask().circle(x, y, rng.range(1, 3.5)); c.paint(g, [0.25, 0.23, 0.2], 0.9); c.lift(g, 1.5); }
    c.lift(m.clone().blur(3), 2);
  });
}
