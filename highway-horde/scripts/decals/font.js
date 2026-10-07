// A single-stroke vector font for the decal baker: capitals, digits, arrows and punctuation drawn as
// polylines on a 6-unit cap height (y down, baseline at 6). The same skeleton renders as a sign face
// (even, round-capped strokes), a stencil (bridged strokes, square-ish), a spray-can hand (wobbling,
// tapering strokes) or a marker hand (thin, quick, slanted).

const D = Math.PI / 180;
function arc(cx, cy, rx, ry, a0, a1, n = 0) {
  const steps = n || Math.max(6, Math.ceil(Math.abs(a1 - a0) / 12));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (a0 + (a1 - a0) * (i / steps)) * D;
    out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return out;
}

// glyph: [advance, strokes]
const G = {
  A: [4, [[[0, 6], [2, 0], [4, 6]], [[0.7, 4], [3.3, 4]]]],
  B: [4, [[[0, 0], [0, 6]], [[0, 0], [2.4, 0], ...arc(2.4, 1.5, 1.4, 1.5, -90, 90), [0, 3]], [[0, 3], [2.5, 3], ...arc(2.5, 4.5, 1.5, 1.5, -90, 90), [0, 6]]]],
  C: [4, [arc(2.1, 3, 2, 3, -40, -320)]],
  D: [4, [[[0, 0], [0, 6]], [[0, 0], [1.6, 0], ...arc(1.6, 3, 2.4, 3, -90, 90), [0, 6]]]],
  E: [3.6, [[[3.6, 0], [0, 0], [0, 6], [3.6, 6]], [[0, 3], [3, 3]]]],
  F: [3.5, [[[3.5, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]]],
  G: [4.2, [[...arc(2.1, 3, 2.1, 3, -40, -360), [2.4, 3]], [[4.2, 3], [4.2, 5.4]]]],
  H: [4, [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]]],
  I: [0.6, [[[0.3, 0], [0.3, 6]]]],
  J: [3.4, [[[3.4, 0], [3.4, 4.3], ...arc(1.8, 4.3, 1.6, 1.7, 0, 160)]]],
  K: [4, [[[0, 0], [0, 6]], [[3.9, 0], [0, 3.9]], [[1.4, 2.6], [4, 6]]]],
  L: [3.5, [[[0, 0], [0, 6], [3.5, 6]]]],
  M: [4.8, [[[0, 6], [0, 0], [2.4, 4], [4.8, 0], [4.8, 6]]]],
  N: [4, [[[0, 6], [0, 0], [4, 6], [4, 0]]]],
  O: [4.4, [arc(2.2, 3, 2.2, 3, 0, 360, 36)]],
  P: [3.9, [[[0, 6], [0, 0], [2.3, 0], ...arc(2.3, 1.6, 1.6, 1.6, -90, 90), [0, 3.2]]]],
  Q: [4.4, [arc(2.2, 3, 2.2, 3, 0, 360, 36), [[2.7, 4.4], [4.5, 6.4]]]],
  R: [4, [[[0, 6], [0, 0], [2.3, 0], ...arc(2.3, 1.6, 1.6, 1.6, -90, 90), [0, 3.2]], [[2.1, 3.2], [4, 6]]]],
  S: [3.9, [[...arc(1.95, 1.5, 1.85, 1.5, -15, -270), ...arc(1.95, 4.5, 1.95, 1.5, -90, 160)]]],
  T: [4, [[[0, 0], [4, 0]], [[2, 0], [2, 6]]]],
  U: [4, [[[0, 0], [0, 4], ...arc(2, 4, 2, 2, 180, 0), [4, 0]]]],
  V: [4.2, [[[0, 0], [2.1, 6], [4.2, 0]]]],
  W: [5.4, [[[0, 0], [1.35, 6], [2.7, 1.6], [4.05, 6], [5.4, 0]]]],
  X: [4, [[[0, 0], [4, 6]], [[4, 0], [0, 6]]]],
  Y: [4, [[[0, 0], [2, 3.2], [4, 0]], [[2, 3.2], [2, 6]]]],
  Z: [4, [[[0, 0], [4, 0], [0, 6], [4, 6]]]],
  0: [3.8, [arc(1.9, 3, 1.9, 3, 0, 360, 32)]],
  1: [2.4, [[[0, 1.2], [1.8, 0], [1.8, 6]]]],
  2: [3.8, [[...arc(1.9, 1.8, 1.85, 1.8, -165, 20), [0, 6], [3.8, 6]]]],
  3: [3.8, [[...arc(1.9, 1.5, 1.75, 1.5, -160, 90), ...arc(1.9, 4.5, 1.9, 1.5, -90, 160)]]],
  4: [4, [[[3, 6], [3, 0], [0, 4.2], [4, 4.2]]]],
  5: [3.8, [[[3.6, 0], [0.5, 0], [0.3, 2.8], ...arc(1.95, 4.1, 1.9, 1.9, -140, 150)]]],
  6: [3.8, [[[3.4, 0.3], [2.3, 0], [1.1, 0.5], [0.3, 1.8], [0.05, 3.4], [0.05, 4.1]], arc(1.95, 4.1, 1.9, 1.9, 0, 360, 28)]],
  7: [3.8, [[[0, 0], [3.8, 0], [1.4, 6]]]],
  8: [3.8, [arc(1.9, 1.5, 1.6, 1.5, 0, 360, 24), arc(1.9, 4.5, 1.9, 1.5, 0, 360, 28)]],
  9: [3.8, [arc(1.9, 1.9, 1.9, 1.9, 0, 360, 28), [[3.8, 1.9], [3.8, 2.9], [3.5, 4.6], [2.7, 5.7], [1.5, 6], [0.5, 5.6]]]],
  '.': [0.6, [[[0.3, 5.8], [0.3, 6]]]],
  '·': [0.6, [[[0.3, 3.1], [0.3, 3.3]]]],
  ',': [0.8, [[[0.5, 5.6], [0.5, 6], [0.1, 6.9]]]],
  '!': [0.6, [[[0.3, 0], [0.3, 4.2]], [[0.3, 5.8], [0.3, 6]]]],
  '?': [3.4, [[...arc(1.7, 1.6, 1.7, 1.6, -170, 70), [1.8, 3.6], [1.8, 4.3]], [[1.8, 5.8], [1.8, 6]]]],
  '-': [2.4, [[[0, 3.3], [2.4, 3.3]]]],
  ':': [0.6, [[[0.3, 1.8], [0.3, 2]], [[0.3, 5.8], [0.3, 6]]]],
  "'": [1.4, [[[0.7, 0], [0.6, 1.6]]]],
  '"': [1.6, [[[0.3, 0], [0.3, 1.6]], [[1.3, 0], [1.3, 1.6]]]],
  '/': [3, [[[0, 6.3], [3, -0.3]]]],
  '+': [3.6, [[[0, 3], [3.6, 3]], [[1.8, 1.2], [1.8, 4.8]]]],
  '=': [3.4, [[[0, 2.2], [3.4, 2.2]], [[0, 4], [3.4, 4]]]],
  '#': [4, [[[1.3, 0.5], [0.8, 5.5]], [[3.2, 0.5], [2.7, 5.5]], [[0.1, 2], [4, 2]], [[0, 4], [3.9, 4]]]],
  '(': [1.6, [arc(3.2, 3, 3.0, 3.3, -152, -208)]],
  ')': [1.6, [arc(-1.6, 3, 3.0, 3.3, -28, 28)]],
  '%': [4, [arc(0.9, 1.1, 0.9, 1.1, 0, 360, 16), arc(3.1, 4.9, 0.9, 1.1, 0, 360, 16), [[3.6, 0], [0.4, 6]]]],
  '&': [4.2, [[[4.2, 6], [1, 2], ...arc(1.7, 1.2, 1, 1.2, 160, -160).reverse(), [2.6, 1.6], [0.4, 3.9], ...arc(1.7, 4.6, 1.4, 1.4, 180, 70).slice(1), [3.8, 3.4]]]],
  '*': [3, [[[1.5, 0.3], [1.5, 3.3]], [[0.2, 1], [2.8, 2.6]], [[2.8, 1], [0.2, 2.6]]]],
  '>': [5.6, [[[0, 3], [5.3, 3]], [[3, 0.6], [5.6, 3], [3, 5.4]]]],   // → (arrow right)
  '<': [5.6, [[[5.6, 3], [0.3, 3]], [[2.6, 0.6], [0, 3], [2.6, 5.4]]]],     // ← (arrow left)
  '^': [3.6, [[[1.8, 6], [1.8, 0.4]], [[0, 2.2], [1.8, 0.2], [3.6, 2.2]]]],   // ↑
  '_': [3.6, [[[1.8, 0], [1.8, 5.6]], [[0, 3.8], [1.8, 5.8], [3.6, 3.8]]]],   // ↓
  '|': [0.6, [[[0.3, -0.4], [0.3, 6.4]]]],
  ' ': [2.4, []],
};
// (the arrow keys: write '>' for →, '<' for ←, '^' for ↑ and '_' for ↓)
const ALIAS = { '→': '>', '←': '<', '↑': '^', '↓': '_' };

export function glyph(ch) {
  const c = ALIAS[ch] || ch.toUpperCase();
  return G[c] || G['?'];
}

/** Width of a string in font units (gap = letter spacing). */
export function measure(str, gap = 1.1) {
  let w = 0;
  for (const ch of str) w += glyph(ch)[0] + gap;
  return Math.max(0, w - gap);
}

/**
 * Lay out a string as polylines in pixel space. size = cap height in pixels; (x, y) = the top-left
 * of the line (or its centre with align 'center'). opts: gap, slant (shear, + leans right), jitter
 * (pixels, per point), rng (for jitter), rot (radians about the anchor), squash (x scale), wave
 * (baseline wave, pixels), stencil (true: break the strokes with bridges).
 * Returns [{ pts, glyph index }].
 */
export function layout(str, x, y, size, opts = {}) {
  const k = size / 6;
  const gap = opts.gap ?? 1.1;
  const sx = opts.squash ?? 1;
  const total = measure(str, gap) * k * sx;
  let ox = opts.align === 'center' ? x - total / 2 : opts.align === 'right' ? x - total : x;
  const oy = opts.valign === 'middle' ? y - size / 2 : y;
  const out = [];
  const rng = opts.rng;
  const jit = opts.jitter || 0;
  const slant = opts.slant || 0;
  const rot = opts.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
  const cx = opts.align === 'center' ? x : ox, cy = opts.valign === 'middle' ? y : oy;
  let gi = 0;
  for (const ch of str) {
    const [adv, strokes] = glyph(ch);
    const gs = opts.vary && rng ? 1 + (rng.next() - 0.5) * opts.vary : 1;
    const gy = opts.wave ? Math.sin(gi * 1.3 + (opts.phase || 0)) * opts.wave : 0;
    for (const s of strokes) {
      const pts = s.map(([u, v]) => {
        let px = ox + (u * sx + (6 - v) * slant) * k * gs;
        let py = oy + gy + (v * gs - (gs - 1) * 6) * k;
        if (jit && rng) { px += (rng.next() - 0.5) * 2 * jit; py += (rng.next() - 0.5) * 2 * jit; }
        if (rot) { const dx = px - cx, dy = py - cy; px = cx + dx * cr - dy * sr; py = cy + dx * sr + dy * cr; }
        return [px, py];
      });
      out.push({ pts, gi, ch });
    }
    ox += (adv + gap) * k * sx * gs;
    gi++;
  }
  return out;
}

/** Densify a polyline so no segment is longer than `step` pixels (for wobble and taper). */
export function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 1; j <= n; j++) out.push([ax + (bx - ax) * (j / n), ay + (by - ay) * (j / n)]);
  }
  return out;
}

/**
 * Stencil bridges (for butt-capped strokes of width `w`): a stroke whose end meets another stroke
 * of the same letter stops short of it by `g`, and closed loops get two bridges (top and bottom).
 * Returns new polylines.
 */
export function stencilize(strokes, g, w) {
  const out = [];
  const near = (p, s) => {
    for (const o of strokes) {
      if (o === s || o.gi !== s.gi) continue;
      for (let i = 1; i < o.pts.length; i++) if (segDist(p, o.pts[i - 1], o.pts[i]) < w * 0.75) return true;
    }
    return false;
  };
  for (const s of strokes) {
    const pts = s.pts;
    const closed = pts.length > 8 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3;
    if (closed) {
      let top = 0, bot = 0;
      pts.forEach((p, i) => { if (p[1] < pts[top][1]) top = i; if (p[1] > pts[bot][1]) bot = i; });
      const ring = pts.slice(0, -1);
      const cutAt = [top, bot].sort((a, b) => a - b);
      const pieces = [ring.slice(cutAt[0], cutAt[1] + 1), ring.slice(cutAt[1]).concat(ring.slice(0, cutAt[0] + 1))];
      for (const p of pieces) out.push(trim(p, g / 2));
      continue;
    }
    const a = near(pts[0], s), b = near(pts[pts.length - 1], s);
    out.push(trim(pts, w / 2 + g, a, b));
  }
  return out.filter((p) => p.length >= 2);
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

function trim(pts, d, start = true, end = true) {
  let p = pts.slice();
  const cut = (arr) => {
    let left = d;
    while (arr.length >= 2 && left > 0) {
      const [ax, ay] = arr[0], [bx, by] = arr[1];
      const l = Math.hypot(bx - ax, by - ay);
      if (l <= left) { arr.shift(); left -= l; continue; }
      arr[0] = [ax + (bx - ax) * (left / l), ay + (by - ay) * (left / l)];
      left = 0;
    }
    return arr;
  };
  if (start) p = cut(p);
  if (end) p = cut(p.reverse()).reverse();
  return p;
}
