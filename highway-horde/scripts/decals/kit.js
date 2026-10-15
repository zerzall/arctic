// Drawing helpers of the decal baker: lettering in several hands, spray paint with overspray and
// drips, paper (fibres, wrinkles, tape, photocopy grain), metal plates (embossed rims, screws, rust),
// the wear and damage passes that make clean / worn / damaged variants, and the shared marks
// (bullet holes by material, blood). All of it on raster.js masks.

import { Mask, rngOf, fbm, vnoise, ridge, hash2, hex, mix3, mul3, clamp01, smoothstep, lerp } from './raster.js';
import { layout, densify, stencilize, measure } from './font.js';

export { hex, mix3, mul3, fbm, vnoise, ridge, hash2, clamp01, smoothstep, lerp, measure };

// ---- colours -------------------------------------------------------------------------------
export const C = {
  ink: hex('#17161a'), paper: hex('#ece6d6'), newsprint: hex('#d9d2bf'), yellowed: hex('#d8c99c'),
  white: hex('#f2f0ea'), black: hex('#101012'), red: hex('#b3141b'), sprayRed: hex('#c0121a'), darkRed: hex('#6a0b0e'),
  blood: hex('#6a0707'), bloodWet: hex('#7a0a0a'), bloodDry: hex('#3a0806'),
  yellow: hex('#f2c315'), orange: hex('#e8641a'), green: hex('#0f7a3c'), signGreen: hex('#0d6b3a'), blue: hex('#1f4f9a'),
  hospBlue: hex('#1b5aa6'), grey: hex('#7c7c78'), rust: hex('#8a4a22'), rustDark: hex('#4f2712'), soot: hex('#141210'),
  moss: hex('#4f6a24'), lichen: hex('#b9b98a'), olive: hex('#4a5232'), tape: hex('#e9e2c4'),
};

// ---- lettering -------------------------------------------------------------------------------

/**
 * A string as a coverage mask. style: 'sign' (bold even strokes), 'thin', 'stencil' (bridged),
 * 'spray' (wobbling, tapered), 'marker' (thin, fast, slanted), 'chalk', 'block' (heavy).
 * opts: as font.layout plus weight (stroke width / cap height), rng.
 */
export function textMask(c, str, x, y, size, style = 'sign', opts = {}) {
  const m = opts.into || c.mask();
  const rng = opts.rng || rngOf(hash2(str.length, size | 0, 7) * 1e9);
  const W = {
    sign: 0.17, thin: 0.1, stencil: 0.24, spray: 0.17, marker: 0.085, chalk: 0.1, block: 0.26, condensed: 0.15,
  };
  const weight = opts.weight ?? W[style] ?? 0.16;
  const wpx = Math.max(1, size * weight);
  const lo = { ...opts, rng };
  if (style === 'condensed') lo.squash = opts.squash ?? 0.72;
  if (style === 'block' || style === 'stencil') lo.gap = opts.gap ?? 1.5;
  if (style === 'marker') { lo.slant = opts.slant ?? 0.16; lo.vary = opts.vary ?? 0.12; lo.wave = opts.wave ?? size * 0.03; }
  if (style === 'spray') { lo.vary = opts.vary ?? 0.1; lo.wave = opts.wave ?? size * 0.04; lo.slant = opts.slant ?? 0.05; }
  // pad so the stroke width does not change where the text sits
  // (raw: the skeleton exactly at (x, y, size) whatever the weight: outlines of the same letters)
  const strokes = opts.raw ? layout(str, x, y, size, lo) : layout(str, x + (opts.align ? 0 : wpx / 2), y + wpx / 2, Math.max(1, size - wpx), lo);
  if (style === 'stencil') {
    for (const pts of stencilize(strokes, wpx * 0.28, wpx)) m.strokeButt(pts, wpx);
    return m;
  }
  const seed = rng.seed();
  for (const s of strokes) {
    let pts = s.pts;
    if (style === 'spray' || style === 'marker' || style === 'chalk') {
      pts = densify(pts, Math.max(2, size * 0.06));
      const amp = style === 'spray' ? size * 0.025 : style === 'chalk' ? size * 0.015 : size * 0.012;
      pts = pts.map(([px, py], i) => [px + (vnoise(i * 0.35, s.gi * 3.1, seed) - 0.5) * 2 * amp, py + (vnoise(i * 0.35 + 9.1, s.gi * 3.1, seed) - 0.5) * 2 * amp]);
      const taper = style === 'spray'
        ? (t) => wpx * (0.75 + 0.35 * Math.sin(Math.min(1, t * 6) * Math.PI / 2) * (t > 0.85 ? 1 - (t - 0.85) * 3 : 1))
        : style === 'marker' ? (t) => wpx * (t < 0.08 ? 0.7 + t * 3.7 : t > 0.9 ? 1 - (t - 0.9) * 4 : 1) : wpx;
      m.stroke(pts, taper);
    } else {
      m.stroke(pts, wpx);
    }
  }
  if (style === 'chalk') m.mulBy((px, py) => 0.45 + 0.55 * smoothstep(0.35, 0.6, fbm(px * 0.35, py * 0.35, 2, seed)));
  return m;
}

/** Fit text into a box: the largest cap height (≤ maxSize) whose width fits `w`. */
export function fitSize(str, w, maxSize, gap = 1.1, squash = 1) {
  const u = measure(str, gap) * squash;
  return Math.min(maxSize, u > 0 ? (w / u) * 6 : maxSize);
}

/** Fill text: paint it in a colour (helper for printed matter). */
export function print(c, str, x, y, size, col, opts = {}) {
  const m = textMask(c, str, x, y, size, opts.style || 'sign', opts);
  c.paint(m, col, opts.alpha ?? 1, { rough: opts.rough });
  if (opts.emboss) c.lift(m, opts.emboss);
  return m;
}

/** Pseudo body text: lines of small random words in a box. */
export function para(c, x, y, w, size, lines, col, rng, opts = {}) {
  const lh = size * (opts.leading ?? 1.75);
  const m = c.mask();
  for (let l = 0; l < lines; l++) {
    let cx = x;
    const end = l === lines - 1 && !opts.full ? x + w * rng.range(0.35, 0.8) : x + w;
    while (cx < end - size * 2) {
      const n = rng.int(2, 7);
      let word = '';
      for (let k = 0; k < n; k++) word += 'ETAOINSRHLDCUMWFGYPB'[Math.floor(rng.next() * 20)];
      const ww = measure(word, 1.1) * size / 6;
      if (cx + ww > end) break;
      textMask(c, word, cx, y + l * lh, size, 'thin', { into: m, rng, weight: opts.weight ?? 0.14 });
      cx += ww + size * 0.9;
    }
  }
  c.paint(m, col, opts.alpha ?? 0.9);
  return m;
}

// ---- spray paint -----------------------------------------------------------------------------

/**
 * Paint a mask as spray paint: a soft-edged core with a speckled overspray halo and runs. opts:
 * soft (edge blur px), over (overspray strength), drips (count), dripLen (fraction of the
 * canvas height), alpha, rng, rough.
 */
export function spray(c, m, col, opts = {}) {
  const rng = opts.rng || rngOf(7);
  const seed = rng.seed();
  const soft = opts.soft ?? 1.2;
  const core = m.clone().blur(soft);
  // the paint is a little patchy where the can moved fast
  const alpha = opts.alpha ?? 0.95;
  const over = opts.over ?? 0.32;
  if (over > 0) {
    const halo = m.clone().blur(opts.haloR ?? Math.max(3, soft * 4));
    halo.mulBy((x, y) => (hash2(x, y, seed) > 0.45 ? 1 : 0.25) * (0.5 + 0.5 * fbm(x * 0.05, y * 0.05, 2, seed)));
    halo.cut(core);
    c.paint(halo, col, over * alpha, { rough: 0.7 });
  }
  c.paint(core, col, (x, y) => alpha * (0.82 + 0.18 * fbm(x * 0.03, y * 0.03, 3, seed + 3)), { rough: opts.rough ?? 0.55 });
  const nd = opts.drips ?? 0;
  if (nd > 0) drips(c, m, col, nd, { ...opts, rng, alpha });
  return core;
}

/** Paint runs: from the bottom edges of a mask, thin streams that run down and end in a bead. */
export function drips(c, m, col, n, opts = {}) {
  const rng = opts.rng || rngOf(9);
  const { w, h } = m;
  const cand = [];
  for (let x = 2; x < w - 2; x += 3) {
    for (let y = h - 3; y > 1; y--) {
      if (m.d[y * w + x] > 0.6) { if (m.d[(y + 2) * w + x] < 0.2) cand.push([x, y]); break; }
    }
  }
  if (!cand.length) return;
  const dm = c.mask();
  const len = opts.dripLen ?? 0.25;
  const width = opts.dripW ?? Math.max(1.5, w * 0.006);
  for (let i = 0; i < n; i++) {
    const [x, y] = rng.pick(cand);
    const L = Math.min(h - 4 - y, rng.range(0.2, 1) * len * h);
    if (L < 4) continue;
    const pts = [];
    const sway = rng.range(-1, 1);
    for (let k = 0; k <= 12; k++) pts.push([x + Math.sin(k * 0.7) * 0.6 + sway * k * 0.05, y + (L * k) / 12]);
    dm.stroke(pts, (t) => width * (1 - t * 0.35));
    dm.circle(x + sway * 0.6, y + L, width * rng.range(0.6, 0.95));
  }
  c.paint(dm.blur(0.6), col, opts.alpha ?? 0.9, { rough: opts.rough ?? 0.5 });
}

// ---- paper -----------------------------------------------------------------------------------

/**
 * A sheet of paper. Returns its mask. o: color, rot, rng, wrinkle (0..1), edge (raggedness px),
 * tape (corner pieces), pins.
 */
export function paper(c, cx, cy, pw, ph, o = {}) {
  const rng = o.rng || rngOf(11);
  const seed = rng.seed();
  const rot = o.rot || 0;
  const m = c.mask().rect(cx, cy, pw, ph, 1.2, rot);
  if (o.edge) m.warp(o.edge, 0.09, seed);
  const base = o.color || C.paper;
  const shade = (x, y) => {
    const n = fbm(x * 0.012, y * 0.012, 3, seed);
    const f = hash2(x, y, seed) * 0.04;
    return mul3(base, 0.93 + n * 0.1 - f);
  };
  c.paint(m, shade, 1, { rough: 0.92 });
  const wr = o.wrinkle ?? 0.5;
  if (wr > 0) {
    const s = 0.012 * (o.scale || 1);
    c.lift(m, (x, y) => (ridge(x * s, y * s, 3, seed + 5) * 4 + fbm(x * s * 3, y * s * 3, 2, seed) * 1.5) * wr);
  }
  // a sheet stands a little off the wall
  c.lift(m.clone().blur(2), 1.5);
  return m;
}

/** Translucent tape strips at the corners of a rect (top-left, top-right...). */
export function tape(c, cx, cy, pw, ph, rot, rng, which = [0, 1], col = C.tape) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (const k of which) {
    const [sx, sy] = corners[k];
    const lx = sx * pw / 2, ly = sy * ph / 2;
    const x = cx + lx * cr - ly * sr, y = cy + lx * sr + ly * cr;
    const tw = Math.max(pw, ph) * 0.2, th = tw * 0.32;
    const m = c.mask().rect(x, y, tw, th, 0.5, rot + sx * sy * -0.75 + rng.range(-0.25, 0.25));
    m.warp(0.8, 0.3, rng.seed());
    c.paint(m, col, 0.62, { rough: 0.3 });
    c.lift(m, 0.8);
  }
}

/** Map a rect's pixels through fn(rgb, x, y) → rgb (keeps alpha). */
export function regionMap(c, x0, y0, x1, y1, fn) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(c.w, Math.ceil(x1)); y1 = Math.min(c.h, Math.ceil(y1));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const j = (y * c.w + x) * 4, a = c.c[j + 3];
    if (a <= 1e-5) continue;
    const r = fn([c.c[j] / a, c.c[j + 1] / a, c.c[j + 2] / a], x, y);
    c.c[j] = r[0] * a; c.c[j + 1] = r[1] * a; c.c[j + 2] = r[2] * a;
  }
}

/**
 * A photocopied portrait in the rect (x, y, w, h): background, shoulders, head, hair, features,
 * then contrast and grain. o: hair (0 dark .. 1 fair), long (hair), child, smile, rng.
 */
export function portrait(c, x, y, w, h, o = {}) {
  const rng = o.rng || rngOf(5);
  const seed = rng.seed();
  const bgm = c.mask().rect(x + w / 2, y + h / 2, w, h, 0);
  c.paint(bgm, (px, py) => { const t = (py - y) / h; return mix3([0.72, 0.72, 0.7], [0.5, 0.5, 0.5], t * 0.8 + fbm(px * 0.02, py * 0.02, 2, seed) * 0.2); });
  const cx = x + w * (0.5 + rng.range(-0.04, 0.04));
  const headR = w * (o.child ? 0.25 : 0.21);
  const hy = y + h * (o.child ? 0.45 : 0.41);
  const clip = (mm) => mm.min(bgm);
  // shoulders / shirt
  const sh = clip(c.mask().ellipse(cx, y + h * 1.04, w * 0.5, h * 0.36));
  c.paint(sh, (px) => mix3([0.3, 0.3, 0.32], [0.18, 0.18, 0.2], (px - x) / w));
  const collar = clip(c.mask().poly([[cx - w * 0.12, y + h * 0.7], [cx, y + h * 0.84], [cx + w * 0.12, y + h * 0.7]]));
  c.paint(collar, [0.8, 0.8, 0.78], 0.8);
  // neck
  c.paint(clip(c.mask().rect(cx, hy + headR * 1.1, headR * 0.75, headR * 0.9, 3)), [0.55, 0.53, 0.5]);
  // hair behind
  const hairTone = lerp(0.12, 0.62, o.hair ?? rng.next() * 0.6);
  if (o.long) c.paint(clip(c.mask().ellipse(cx, hy + headR * 0.55, headR * 1.22, headR * 1.55)), [hairTone, hairTone * 0.95, hairTone * 0.9]);
  // face with side light
  const face = clip(c.mask().ellipse(cx, hy, headR * 0.86, headR * 1.12));
  c.paint(face, (px, py) => { const l = 0.78 - ((px - cx) / headR) * 0.18 + ((py - hy) / headR) * -0.05; return [l, l * 0.97, l * 0.93]; });
  // hair on top
  const hm = c.mask().ellipse(cx, hy - headR * 0.5, headR * 0.98, headR * 0.72);
  hm.cut(c.mask().ellipse(cx + headR * 0.1, hy + headR * 0.05, headR * 0.82, headR * 0.7));
  c.paint(clip(hm), [hairTone, hairTone * 0.95, hairTone * 0.9]);
  // eyes, brows, nose, mouth
  const ey = hy - headR * 0.05, ex = headR * 0.36;
  const feat = c.mask();
  for (const s of [-1, 1]) {
    feat.ellipse(cx + s * ex, ey, headR * 0.12, headR * 0.065);
    feat.capsule(cx + s * ex - headR * 0.16, ey - headR * 0.2, cx + s * ex + headR * 0.14, ey - headR * 0.22, headR * 0.035);
  }
  feat.capsule(cx + headR * 0.04, ey + headR * 0.1, cx + headR * 0.08, ey + headR * 0.36, headR * 0.03);
  const my = hy + headR * 0.6;
  if (o.smile ?? true) feat.stroke([[cx - headR * 0.22, my - headR * 0.02], [cx, my + headR * 0.04], [cx + headR * 0.22, my - headR * 0.02]], headR * 0.05);
  else feat.capsule(cx - headR * 0.2, my, cx + headR * 0.2, my, headR * 0.03);
  c.paint(clip(feat), [0.2, 0.18, 0.17], 0.75);
  // shadow side of the face, under the chin, eye sockets
  const shade = clip(c.mask().ellipse(cx + headR * 0.55, hy + headR * 0.1, headR * 0.5, headR * 1.0).min(face).blur(headR * 0.25));
  c.multiply(shade, [0.6, 0.6, 0.6], 0.8);
  const chin = clip(c.mask().ellipse(cx, hy + headR * 1.18, headR * 0.7, headR * 0.25).blur(headR * 0.15));
  c.multiply(chin, [0.5, 0.5, 0.5], 0.8);
  // a soft photo: blur what was drawn
  blurRegion(c, x, y, x + w, y + h, Math.max(1, w * 0.012));
  // photocopy: contrast, toner grain and banding
  regionMap(c, x, y, x + w, y + h, (rgb, px, py) => {
    let l = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
    l = clamp01((l - 0.5) * (o.contrast ?? 1.9) + 0.55 + (hash2(px, py, seed) - 0.5) * 0.22 + (vnoise(0, py * 0.15, seed) - 0.5) * 0.08);
    return mix3(C.ink, o.paperCol || C.paper, l);
  });
}

/** Box-blur the colour of a rect (alpha kept). */
export function blurRegion(c, x0, y0, x1, y1, r) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(c.w, Math.ceil(x1)); y1 = Math.min(c.h, Math.ceil(y1));
  const w = x1 - x0, h = y1 - y0;
  for (let ch = 0; ch < 3; ch++) {
    const m = new Mask(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = ((y + y0) * c.w + x + x0) * 4; m.d[y * w + x] = c.c[j + 3] > 1e-4 ? c.c[j + ch] / c.c[j + 3] : 0; }
    m.blur(r);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = ((y + y0) * c.w + x + x0) * 4; c.c[j + ch] = m.d[y * w + x] * c.c[j + 3]; }
  }
}

// ---- metal plates ---------------------------------------------------------------------------

/**
 * A sign plate (stamped steel / aluminium): rounded rect, rolled rim, screw holes, brushed
 * finish. Returns { m, inner } where inner is the printable rect [x0, y0, x1, y1].
 */
export function plate(c, cx, cy, pw, ph, col, o = {}) {
  const rng = o.rng || rngOf(13);
  const seed = rng.seed();
  const r = o.radius ?? Math.min(pw, ph) * 0.08;
  const m = c.mask().rect(cx, cy, pw, ph, r, o.rot || 0);
  c.paint(m, (x, y) => mul3(col, 0.96 + fbm(x * 0.004, y * 0.2, 2, seed) * 0.06 + (hash2(x, y, seed) - 0.5) * 0.02), 1, { rough: o.rough ?? 0.45 });
  c.lift(m.clone().blur(1.5), 3);
  if (o.rim !== false) {
    const inset = Math.min(pw, ph) * (o.rimInset ?? 0.045);
    const rim = c.mask().rect(cx, cy, pw - inset * 2, ph - inset * 2, Math.max(1, r - inset), o.rot || 0);
    rim.cut(c.mask().rect(cx, cy, pw - inset * 2 - Math.max(2, inset * 0.55) * 2, ph - inset * 2 - Math.max(2, inset * 0.55) * 2, Math.max(1, r - inset * 1.5), o.rot || 0));
    if (o.rimCol) c.paint(rim, o.rimCol, 1);
    c.lift(rim.blur(0.8), 2.2);
  }
  if (o.screws !== false) {
    const sx = pw / 2 - Math.min(pw, ph) * 0.09, sy = ph / 2 - Math.min(pw, ph) * 0.09;
    const pts = o.screws === 2 ? [[-sx, 0], [sx, 0]] : [[-sx, -sy], [sx, -sy], [sx, sy], [-sx, sy]];
    for (const [dx, dy] of pts) screw(c, cx + dx, cy + dy, Math.max(2.5, Math.min(pw, ph) * 0.022));
  }
  const pad = Math.min(pw, ph) * 0.1;
  return { m, inner: [cx - pw / 2 + pad, cy - ph / 2 + pad, cx + pw / 2 - pad, cy + ph / 2 - pad] };
}

export function screw(c, x, y, r) {
  const m = c.mask().circle(x, y, r);
  c.paint(m, [0.62, 0.62, 0.6], 1, { rough: 0.35 });
  c.lift(m.clone().blur(0.8), 1.6);
  const slot = c.mask().capsule(x - r * 0.65, y - r * 0.2, x + r * 0.65, y + r * 0.2, r * 0.16);
  c.paint(slot, [0.2, 0.2, 0.2]);
  c.lift(slot, -1.2);
  const ring = c.mask().circle(x, y, r * 1.35).cut(c.mask().circle(x, y, r));
  c.paint(ring.blur(0.7), [0.25, 0.18, 0.12], 0.45);
}

// ---- marks -----------------------------------------------------------------------------------

/**
 * A bullet hole. kind: 'concrete' (spalled crater, grey dust ring), 'metal' (punched hole,
 * bright rim, paint chipped in a ring), 'glass' (hole, radial and ring cracks), 'wood' (splintered
 * hole, pale torn fibres), 'plaster'.
 */
export function bulletHole(c, x, y, r, kind, rng) {
  const seed = rng.seed();
  if (kind === 'glass') {
    const cr = c.mask();
    const n = rng.int(7, 12);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const L = r * rng.range(3, 9);
      const pts = [[x, y]];
      let px = x, py = y, aa = a;
      for (let k = 1; k <= 6; k++) { aa += rng.range(-0.2, 0.2); px += Math.cos(aa) * L / 6; py += Math.sin(aa) * L / 6; pts.push([px, py]); }
      cr.stroke(pts, (t) => Math.max(0.7, r * 0.14 * (1 - t)));
    }
    for (let ring = 1; ring <= 2; ring++) {
      const rr = r * (1.6 + ring * 1.7);
      const pts = [];
      for (let k = 0; k <= 20; k++) { const a = (k / 20) * Math.PI * 2; const q = rr * (0.8 + hash2(k, ring, seed) * 0.4); pts.push([x + Math.cos(a) * q, y + Math.sin(a) * q]); }
      for (let k = 0; k < 20; k += 1) if (hash2(k, ring + 9, seed) > 0.45) cr.stroke([pts[k], pts[k + 1]], 0.9);
    }
    c.paint(cr, [0.92, 0.95, 0.97], 0.75, { rough: 0.1 });
    const frost = c.mask().circle(x, y, r * 1.6).blur(r * 0.5);
    c.paint(frost, [0.85, 0.88, 0.9], 0.55, { rough: 0.2 });
    const hole = c.mask().circle(x, y, r * 0.6).warp(r * 0.15, 0.4, seed);
    c.paint(hole, [0.03, 0.03, 0.03], 0.95);
    c.lift(cr, -0.8);
    return;
  }
  if (kind === 'metal') {
    const chip = c.mask().circle(x, y, r * 2.1).warp(r * 0.4, 0.25, seed);
    c.paint(chip, [0.62, 0.62, 0.6], 0.9, { rough: 0.3 });     // bare steel where the paint flaked
    const dent = c.mask().circle(x, y, r * 1.5).blur(r * 0.4);
    c.lift(dent, -r * 0.5);
    const rim = c.mask().circle(x, y, r * 1.12);
    c.paint(rim, [0.78, 0.76, 0.72], 1, { rough: 0.25 });
    c.lift(rim.clone().blur(0.8), r * 0.25);
    const hole = c.mask().circle(x, y, r * 0.78);
    c.paint(hole, [0.02, 0.02, 0.02], 1);
    c.lift(hole, -r * 0.8);
    const scorch = c.mask().circle(x, y, r * 2.8).blur(r * 0.9).cut(chip);
    c.paint(scorch, [0.15, 0.12, 0.1], 0.35);
    return;
  }
  if (kind === 'wood') {
    const spl = c.mask();
    const n = rng.int(6, 11);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const along = Math.abs(Math.sin(a)) < 0.6 ? 2.2 : 1;   // splinters run along the grain (x)
      const L = r * rng.range(1.2, 2.6) * along;
      spl.stroke([[x, y], [x + Math.cos(a) * L, y + Math.sin(a) * L * 0.45]], (t) => r * 0.5 * (1 - t) + 0.6);
    }
    c.paint(spl, [0.82, 0.68, 0.48], 0.95, { rough: 0.9 });
    c.lift(spl, 1.2);
    const hole = c.mask().ellipse(x, y, r * 0.95, r * 0.75, 0).warp(r * 0.25, 0.35, seed);
    c.paint(hole, [0.06, 0.04, 0.03], 1);
    c.lift(hole, -r);
    return;
  }
  // concrete / plaster / brick: a spalled crater
  const sp = c.mask().circle(x, y, r * 2.2).warp(r * 0.7, 0.18, seed).thresh(0.5, 0.15);
  // the broken face is paler than the weathered surface, but the wall's own colour shows through
  c.paint(sp, (px, py) => { const v = 0.58 + fbm(px * 0.25, py * 0.25, 2, seed) * 0.16; return [v, v * 0.97, v * 0.93]; }, 0.55, { rough: 0.95 });
  const rimShade = sp.clone().cut(sp.clone().grow(-2));
  c.paint(rimShade, [0.18, 0.17, 0.16], 0.35);
  c.lift(sp.clone().blur(1), -r * 0.45);
  const dust = c.mask().circle(x, y, r * 3.4).blur(r * 1.2).cut(sp);
  c.paint(dust, [0.7, 0.68, 0.64], 0.12);
  const inner = c.mask().circle(x, y, r * 1.15).warp(r * 0.3, 0.35, seed + 1);
  c.paint(inner, [0.32, 0.31, 0.3], 0.95);
  c.lift(inner.clone().blur(0.7), -r * 0.5);
  const hole = c.mask().circle(x, y, r * 0.55);
  c.paint(hole, [0.05, 0.05, 0.05], 1);
  c.lift(hole, -r * 0.7);
  // hairline cracks
  const cr = c.mask();
  for (let i = 0, n = rng.int(2, 5); i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    let px = x, py = y, aa = a;
    const pts = [[px, py]];
    for (let k = 0; k < 5; k++) { aa += rng.range(-0.5, 0.5); px += Math.cos(aa) * r * 0.9; py += Math.sin(aa) * r * 0.9; pts.push([px, py]); }
    cr.stroke(pts, (t) => Math.max(0.6, r * 0.18 * (1 - t)));
  }
  c.paint(cr, [0.2, 0.2, 0.2], 0.7);
  c.lift(cr, -0.8);
}

/** Blood splat around (x, y): a lumpy core, satellite drops, and streaks thrown out along `dir`. */
export function bloodSplat(c, x, y, r, rng, o = {}) {
  const seed = rng.seed();
  const m = c.mask();
  // an organic core: overlapping blobs, softened and warped
  for (let k = 0, n = rng.int(5, 9); k < n; k++) {
    const a = rng.range(0, Math.PI * 2), d = r * rng.range(0, 0.55);
    m.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rng.range(0.35, 0.7));
  }
  m.blur(r * 0.15).thresh(0.45, 0.1).warp(r * 0.18, 0.06, seed);
  const dir = o.dir ?? rng.range(0, Math.PI * 2);
  const spread = o.spread ?? Math.PI * 2;
  const reach = o.reach ?? 3;
  for (let i = 0, n = o.drops ?? rng.int(18, 40); i < n; i++) {
    const a = dir + rng.range(-spread / 2, spread / 2);
    const d = r * rng.range(0.9, reach);
    const f = 1 - (d / r - 0.9) / Math.max(0.1, reach - 0.9);
    const s = Math.max(0.9, r * rng.range(0.03, 0.12) * (0.4 + f));
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    // drops that flew far land elongated, with a tail pointing back at the source
    if (d > r * 1.3 && rng.chance(0.55)) {
      const tl = s * rng.range(2, 4.5);
      m.capsule(px - Math.cos(a) * tl, py - Math.sin(a) * tl, px, py, s * 0.35, s, 1);
    }
    m.circle(px, py, s);
  }
  // fingers of the splash running out of the core
  for (let i = 0, n = rng.int(4, 9); i < n; i++) {
    const a = dir + rng.range(-spread / 2, spread / 2);
    const L = r * rng.range(1.1, 1.7);
    m.capsule(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, x + Math.cos(a) * L, y + Math.sin(a) * L, r * 0.16, r * 0.07);
  }
  const col = o.col || C.blood;
  c.paint(m, (px, py) => mix3(mul3(col, 1.15), mul3(col, 0.55), fbm(px * 0.04, py * 0.04, 3, seed)), o.alpha ?? 0.95, { rough: o.rough ?? 0.25 });
  // the edges dry darker, a thin raised film
  const edge = m.clone().blur(Math.max(1, r * 0.05));
  edge.map((px, py, v) => (v > 0.05 && v < 0.85 ? 1 - Math.abs(v - 0.45) * 2 : 0));
  c.multiply(edge, [0.55, 0.4, 0.4], 0.6);
  c.lift(m.clone().blur(1.2), 0.8);
  return m;
}

// ---- wear and damage ------------------------------------------------------------------------

/**
 * The wear pass over a finished decal. level 1 (worn): sun-faded colour, grime, water tide marks,
 * scuffs and small chips. level 2 (damaged): all of it stronger plus torn-away pieces (paper),
 * bullet holes (metal), dents, heavy rust. o.kind 'paper' | 'metal' | 'paint'.
 */
export function age(c, level, rng, o = {}) {
  if (!level) return;
  const seed = rng.seed();
  const { w, h } = c;
  const kind = o.kind || 'paper';
  const A = c.alphaMask();
  // fading toward a warm grey, more at the top (sun)
  const fadeK = (kind === 'paint' ? 0.45 : 0.3) * level;
  regionMap(c, 0, 0, w, h, (rgb, x, y) => {
    const n = fbm(x * 0.006, y * 0.006, 3, seed);
    const k = clamp01(fadeK * (0.6 + n * 0.8) * (1.1 - (y / h) * 0.4));
    const l = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
    const grey = kind === 'paper' ? [l * 0.95 + 0.06, l * 0.92 + 0.05, l * 0.8 + 0.04] : [l, l * 0.98, l * 0.95];
    return mix3(rgb, grey, k);
  });
  // grime: darker toward the bottom and in noisy patches
  const g = A.clone().mulBy((x, y) => clamp01(smoothstep(0.45, 0.85, fbm(x * 0.01, y * 0.01, 4, seed + 1)) * 0.8 + (y / h) * 0.35 * level));
  c.multiply(g, kind === 'metal' ? [0.45, 0.38, 0.3] : [0.55, 0.48, 0.38], 0.5 * level);
  // tide marks (paper / paint): a few rings of water stain
  if (kind !== 'metal') {
    for (let i = 0; i < level + 1; i++) {
      const tx = rng.range(0.1, 0.9) * w, ty = rng.range(0.3, 1) * h, tr = rng.range(0.15, 0.4) * Math.min(w, h);
      const ring = c.mask().circle(tx, ty, tr).warp(tr * 0.25, 4 / tr, seed + i);
      const inner = ring.clone().blur(tr * 0.06);
      ring.map((x, y, v) => (v > 0.02 && v < 0.98 ? Math.min(1, (1 - Math.abs(v - 0.5) * 2) * 1.6) : v > 0.98 ? 0.18 : 0));
      ring.min(A);
      void inner;
      c.multiply(ring, [0.7, 0.6, 0.45], 0.55);
    }
  }
  // scuffs and scratches
  const sc = c.mask();
  for (let i = 0, n = 6 * level; i < n; i++) {
    const x0 = rng.range(0, w), y0 = rng.range(0, h), a = rng.range(-0.6, 0.6) + (rng.chance(0.5) ? 0 : Math.PI / 2), L = rng.range(0.05, 0.3) * w;
    sc.capsule(x0, y0, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L, rng.range(0.4, 1.2), 0.4);
  }
  sc.min(A);
  if (kind === 'metal') { c.paint(sc, [0.7, 0.7, 0.68], 0.7, { rough: 0.3 }); c.lift(sc, -0.6); } else c.paint(sc, [0.85, 0.83, 0.78], 0.35 * level);
  // chips / flakes / rust
  if (kind === 'metal') {
    const rust = A.clone().mulBy((x, y) => smoothstep(0.68 - 0.05 * level, 0.76 - 0.04 * level, fbm(x * 0.03, y * 0.03, 4, seed + 4)) * (0.6 + 0.4 * hash2(x >> 1, y >> 1, seed)));
    c.paint(rust, (x, y) => mix3(C.rust, C.rustDark, fbm(x * 0.1, y * 0.1, 2, seed)), 0.9, { rough: 0.95 });
    c.lift(rust.clone().blur(1), 1.2);
    const streak = rust.clone().blur(2);
    // rust runs down from the spots
    const run = c.mask();
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; run.d[i] = Math.max(streak.d[i], run.d[i - w] * 0.985 * (0.7 + hash2(x, 0, seed) * 0.3)); }
    run.min(A);
    c.multiply(run, [0.62, 0.42, 0.28], 0.5);
  } else {
    const fq = kind === 'paint' ? 0.07 : 0.03;
    const flake = A.clone().mulBy((x, y) => smoothstep(0.74 - 0.05 * level, 0.78 - 0.05 * level, fbm(x * fq, y * fq, 4, seed + 6)));
    if (kind === 'paint') c.erase(flake, 0.85); else c.paint(flake, [0.85, 0.82, 0.74], 0.6);
  }
  if (level >= 2) {
    if (kind === 'paper') {
      // torn-away pieces from the edges
      const tear = c.mask();
      for (let i = 0, n = rng.int(2, 4); i < n; i++) {
        const side = rng.int(0, 3);
        const t = rng.range(0.1, 0.9);
        const ex = side === 0 ? t * w : side === 1 ? w : side === 2 ? t * w : 0;
        const ey = side === 0 ? 0 : side === 1 ? t * h : side === 2 ? h : t * h;
        const pr = rng.range(0.12, 0.32) * Math.min(w, h);
        const pts = [];
        for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; const q = pr * (0.55 + rng.next() * 0.7); pts.push([ex + Math.cos(a) * q, ey + Math.sin(a) * q * rng.range(0.6, 1.4)]); }
        tear.poly(pts);
      }
      tear.warp(3, 0.15, seed + 8);
      // a white torn rim where the fibres show
      const rim = tear.clone().blur(2).thresh(0.25, 0.12).cut(tear);
      c.paint(rim.min(A), [0.93, 0.91, 0.86], 0.85);
      c.erase(tear);
      // curling edges stand off the wall
      c.lift(rim, 2.5);
    } else if (kind === 'metal') {
      for (let i = 0, n = rng.int(2, 5); i < n; i++) {
        const bx = rng.range(0.15, 0.85) * w, by = rng.range(0.15, 0.85) * h;
        bulletHole(c, bx, by, Math.min(w, h) * rng.range(0.018, 0.028), 'metal', rng);
      }
      const dent = c.mask().ellipse(rng.range(0.2, 0.8) * w, rng.range(0.2, 0.8) * h, w * 0.2, h * 0.12, rng.range(0, 3)).blur(w * 0.06);
      c.lift(dent, -6);
    } else {
      const chip = A.clone().mulBy((x, y) => smoothstep(0.66, 0.7, fbm(x * 0.02, y * 0.02, 4, seed + 12)));
      c.erase(chip, 0.9);
    }
  }
}

/** Overall fade of alpha with a noisy pattern (old paint, weathered stain). */
export function weather(c, amount, rng, freq = 0.01) {
  const seed = rng.seed();
  c.fade((x, y) => 1 - amount * smoothstep(0.3, 0.75, fbm(x * freq, y * freq, 4, seed)));
}

/** Arrow polygon from (x0, y0) to (x1, y1), shaft width sw, head width hw, head length hl. */
export function arrowPoly(x0, y0, x1, y1, sw, hw, hl) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const bx = x1 - ux * hl, by = y1 - uy * hl;
  return [
    [x0 + nx * sw / 2, y0 + ny * sw / 2], [bx + nx * sw / 2, by + ny * sw / 2], [bx + nx * hw / 2, by + ny * hw / 2], [x1, y1],
    [bx - nx * hw / 2, by - ny * hw / 2], [bx - nx * sw / 2, by - ny * sw / 2], [x0 - nx * sw / 2, y0 - ny * sw / 2],
  ];
}

/** Regular polygon points. */
export function ngon(cx, cy, r, n, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

/** The biohazard trefoil as a mask, centred at (cx, cy), radius r. */
export function biohazard(c, cx, cy, r) {
  const m = c.mask();
  const R = r * 0.5;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k / 3) * Math.PI * 2;
    const ox = cx + Math.cos(a) * R * 0.95, oy = cy + Math.sin(a) * R * 0.95;
    const lobe = c.mask().circle(ox, oy, R);
    lobe.cut(c.mask().circle(cx + Math.cos(a) * R * 1.25, cy + Math.sin(a) * R * 1.25, R * 0.72));
    m.max(lobe);
  }
  // the ring
  const ring = c.mask().circle(cx, cy, R * 0.98).cut(c.mask().circle(cx, cy, R * 0.8));
  m.max(ring);
  // the hollow centre and the gaps between lobes
  m.cut(c.mask().circle(cx, cy, R * 0.3));
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k / 3) * Math.PI * 2;
    m.cut(c.mask().capsule(cx, cy, cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95, R * 0.07));
  }
  return m;
}

/** A running-man exit pictogram in the box (x, y, s). */
export function runningMan(c, x, y, s) {
  const m = c.mask();
  const w = s * 0.11;
  m.circle(x + s * 0.55, y + s * 0.13, s * 0.1);
  m.stroke([[x + s * 0.5, y + s * 0.28], [x + s * 0.4, y + s * 0.58]], w);   // torso
  m.stroke([[x + s * 0.4, y + s * 0.58], [x + s * 0.6, y + s * 0.75], [x + s * 0.55, y + s * 0.98]], w);   // front leg
  m.stroke([[x + s * 0.4, y + s * 0.58], [x + s * 0.25, y + s * 0.78], [x + s * 0.05, y + s * 0.8]], w);   // back leg
  m.stroke([[x + s * 0.48, y + s * 0.32], [x + s * 0.7, y + s * 0.45], [x + s * 0.85, y + s * 0.36]], w * 0.9);   // arm
  m.stroke([[x + s * 0.48, y + s * 0.32], [x + s * 0.3, y + s * 0.38], [x + s * 0.2, y + s * 0.52]], w * 0.9);
  return m;
}
