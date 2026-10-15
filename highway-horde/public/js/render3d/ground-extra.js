// Extra ground detail of the first-person view (WORLD, SPEC §7.5), painted into the ground
// tiles' canvases after the flat map layer: tyre tracks polished into every traffic lane,
// oil drips down the lane centres, painted lane arrows and STOP words in front of the stop
// lines (worn away in patches), storm drains along the road edges, ruts in long dirt tracks
// and drifts of fallen leaves under the broadleaf trees. All of it is planned once from the
// map (deterministic, in world units) and painted per tile clipped to the tile's rect.

import { seededRng } from './world-geo.js';

const LANE_KINDS = new Set(['white', 'yellow', 'yellow_double', 'white_dashed']);

const overlaps = (a0, a1, b0, b1) => a1 > b0 && b1 > a0;

/** Axis-aligned asphalt strips with their lane centre lines. */
function planLanes(map) {
  const roads = map.areas.filter((a) => a.kind === 'asphalt' && !(a.a));
  const lanes = [];
  const drains = [];
  const rng = seededRng((map.seed | 0) * 13 + 5);
  for (const a of roads) {
    const horiz = a.w >= a.h;
    const len = horiz ? a.w : a.h, wid = horiz ? a.h : a.w;
    if (len < wid * 2.2 || wid < 50) continue;
    const c = horiz ? a.y : a.x;
    const lo = c - wid / 2, hi = c + wid / 2;
    const a0 = (horiz ? a.x : a.y) - len / 2, a1 = a0 + len;
    const bounds = [lo, hi];
    for (const l of map.lines) {
      if (!LANE_KINDS.has(l.kind)) continue;
      const lh = Math.abs(l.y2 - l.y1) < 1e-3, lv = Math.abs(l.x2 - l.x1) < 1e-3;
      if (horiz && lh && l.y1 > lo + 8 && l.y1 < hi - 8 && overlaps(Math.min(l.x1, l.x2), Math.max(l.x1, l.x2), a0, a1)) bounds.push(l.y1);
      if (!horiz && lv && l.x1 > lo + 8 && l.x1 < hi - 8 && overlaps(Math.min(l.y1, l.y2), Math.max(l.y1, l.y2), a0, a1)) bounds.push(l.x1);
    }
    bounds.sort((p, q) => p - q);
    const merged = [];
    for (const b of bounds) if (!merged.length || b - merged[merged.length - 1] > 14) merged.push(b);
    for (let i = 0; i + 1 < merged.length; i++) {
      const gap = merged[i + 1] - merged[i];
      if (gap < 34 || gap > 130) continue;
      lanes.push({ horiz, c: (merged[i] + merged[i + 1]) / 2, a0, a1, wid: gap, seed: Math.floor(rng.next() * 1e6) });
    }
    // storm drains along both edges, every ~260 units
    for (const side of [-1, 1]) {
      for (let p = a0 + 120 + rng.range(0, 200); p < a1 - 80; p += 230 + rng.range(0, 90)) {
        const across = side < 0 ? lo + 6 : hi - 6;
        const x = horiz ? p : across, y = horiz ? across : p;
        // not where another road crosses
        if (roads.some((r) => r !== a && Math.abs(x - r.x) < r.w / 2 + 12 && Math.abs(y - r.y) < r.h / 2 + 12)) continue;
        drains.push({ x, y, horiz });
      }
    }
  }
  return { lanes, drains, roads };
}

/** A lane arrow (and STOP word) 40 units before each stop line, on the side away from the junction. */
function planMarkings(map, roads) {
  const marks = [];
  for (const l of map.lines) {
    if (l.kind !== 'stop') continue;
    const horiz = Math.abs(l.y2 - l.y1) < 1e-3;
    const mx = (l.x1 + l.x2) / 2, my = (l.y1 + l.y2) / 2;
    const inRoad = (x, y) => roads.some((r) => Math.abs(x - r.x) < r.w / 2 && Math.abs(y - r.y) < r.h / 2 && Math.max(r.w, r.h) < 1e9);
    // the junction side: the one where a road wider than this one lies close by
    let dir = 0;
    for (const s of [-1, 1]) {
      const px = horiz ? mx : mx + s * 110, py = horiz ? my + s * 110 : my;
      if (roads.some((r) => Math.abs(px - r.x) < r.w / 2 && Math.abs(py - r.y) < r.h / 2 && (horiz ? r.w > r.h : r.h > r.w))) dir = s;
    }
    if (!dir) continue;
    const ax = horiz ? 0 : -dir, ay = horiz ? -dir : 0;   // away from the junction
    void inRoad;
    marks.push({ x: mx + ax * 34, y: my + ay * 34, ang: Math.atan2(-ay, -ax), stop: true });
    marks.push({ x: mx + ax * 92, y: my + ay * 92, ang: Math.atan2(-ay, -ax), arrow: true });
  }
  return marks;
}

/** Long dirt areas get two wheel ruts along them. */
function planRuts(map) {
  const out = [];
  for (const a of map.areas) {
    if (a.kind !== 'dirt' || a.a) continue;
    const horiz = a.w >= a.h;
    const len = horiz ? a.w : a.h, wid = horiz ? a.h : a.w;
    if (len < wid * 4 || len < 300 || wid > 90) continue;
    out.push({ horiz, c: horiz ? a.y : a.x, a0: (horiz ? a.x : a.y) - len / 2, a1: (horiz ? a.x : a.y) + len / 2, wid });
  }
  return out;
}

/** Leaf drifts under the broadleaf canopies (decor 'tree_canopy'; pines are 40% and drop needles). */
function planLeaves(map) {
  const out = [];
  map.decor.forEach((d, i) => {
    if (d.kind !== 'tree_canopy') return;
    const R = 44 * (d.s || 1);
    out.push({ x: d.x, y: d.y, R, seed: i * 7919 + 17 });
  });
  return out;
}

/**
 * Plan the extras of a map once.
 * @returns {{ paint(g, rect, opts), stats }}
 */
export function planGroundExtras(map) {
  const { lanes, drains, roads } = planLanes(map);
  const marks = planMarkings(map, roads);
  const ruts = planRuts(map);
  const leaves = planLeaves(map);

  function paint(g, rect, { detail = 1 } = {}) {
    const inR = (x0, y0, x1, y1) => x1 > rect.x0 && x0 < rect.x1 && y1 > rect.y0 && y0 < rect.y1;
    g.save();
    // ---- tyre tracks, oil drips
    g.lineCap = 'round';
    for (const ln of lanes) {
      const x0 = ln.horiz ? ln.a0 : ln.c - ln.wid / 2, x1 = ln.horiz ? ln.a1 : ln.c + ln.wid / 2;
      const y0 = ln.horiz ? ln.c - ln.wid / 2 : ln.a0, y1 = ln.horiz ? ln.c + ln.wid / 2 : ln.a1;
      if (!inR(x0, y0, x1, y1)) continue;
      const rng = seededRng(ln.seed);
      // the stretch of the lane inside this tile
      const s0 = Math.max(ln.a0, (ln.horiz ? rect.x0 : rect.y0) - 60), s1 = Math.min(ln.a1, (ln.horiz ? rect.x1 : rect.y1) + 60);
      const gauge = Math.min(15, ln.wid * 0.24);
      for (const side of [-1, 1]) {
        // dashes of polished / worn asphalt: long runs with irregular gaps, deterministic per lane
        let p = ln.a0;
        const off = ln.c + side * gauge + rng.range(-1.5, 1.5);
        const wobble = rng.range(0, 6);
        while (p < s1) {
          const run = 90 + rng.next() * 260, gap = 20 + rng.next() * 90;
          if (p + run > s0) {
            g.strokeStyle = `rgba(4,4,6,${(0.07 + rng.next() * 0.09).toFixed(3)})`;
            g.lineWidth = 8 + rng.next() * 5;
            g.beginPath();
            if (ln.horiz) { g.moveTo(p, off); g.lineTo(p + run, off + Math.sin(p * 0.01 + wobble) * 1.5); } else { g.moveTo(off, p); g.lineTo(off + Math.sin(p * 0.01 + wobble) * 1.5, p + run); }
            g.stroke();
            // lighter, polished inner strip
            g.strokeStyle = 'rgba(120,120,128,0.05)';
            g.lineWidth = 3;
            g.beginPath();
            if (ln.horiz) { g.moveTo(p, off); g.lineTo(p + run, off); } else { g.moveTo(off, p); g.lineTo(off, p + run); }
            g.stroke();
          }
          p += run + gap;
        }
      }
      // oil drips down the centre of the lane
      if (detail >= 1) {
        let p = ln.a0 + rng.range(0, 120);
        while (p < s1) {
          const run = 4 + rng.next() * 16;
          if (p + run > s0) {
            g.fillStyle = `rgba(2,2,3,${(0.1 + rng.next() * 0.14).toFixed(3)})`;
            const w = 1.6 + rng.next() * 2.6;
            if (ln.horiz) g.fillRect(p, ln.c + rng.range(-5, 5), run, w); else g.fillRect(ln.c + rng.range(-5, 5), p, w, run);
          }
          p += 40 + rng.next() * 150;
        }
      }
    }
    // ---- storm drains
    for (const d of drains) {
      if (!inR(d.x - 12, d.y - 12, d.x + 12, d.y + 12)) continue;
      g.save();
      g.translate(d.x, d.y);
      if (!d.horiz) g.rotate(Math.PI / 2);
      g.fillStyle = 'rgba(8,8,10,0.9)';
      g.fillRect(-9, -3.4, 18, 6.8);
      g.fillStyle = 'rgba(78,80,84,0.85)';
      for (let k = -7; k <= 7; k += 3.5) g.fillRect(k - 0.6, -3, 1.2, 6);
      g.strokeStyle = 'rgba(50,50,52,0.9)';
      g.lineWidth = 1;
      g.strokeRect(-9.5, -3.9, 19, 7.8);
      g.restore();
    }
    // ---- lane arrows and STOP
    for (const m of marks) {
      if (!inR(m.x - 30, m.y - 30, m.x + 30, m.y + 30)) continue;
      g.save();
      g.translate(m.x, m.y);
      g.rotate(m.ang);
      g.fillStyle = 'rgba(226,224,214,0.82)';
      if (m.arrow) {
        g.beginPath();
        g.moveTo(-15, -2.6); g.lineTo(6, -2.6); g.lineTo(6, -7.5); g.lineTo(19, 0); g.lineTo(6, 7.5); g.lineTo(6, 2.6); g.lineTo(-15, 2.6);
        g.closePath();
        g.fill();
      } else if (m.stop) {
        // the word runs along the road, stretched like a real one seen at a slant
        g.rotate(-Math.PI / 2);
        g.scale(1, 2.3);
        g.font = 'bold 14px Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('STOP', 0, 0);
      }
      // wear: bare asphalt showing through
      g.globalCompositeOperation = 'destination-out';
      const rw = seededRng(Math.floor(m.x * 7 + m.y * 13));
      g.fillStyle = 'rgba(0,0,0,0.5)';
      for (let k = 0; k < 26; k++) g.fillRect(-18 + rw.next() * 38, -9 + rw.next() * 18, 1 + rw.next() * 5, 0.8 + rw.next() * 2.4);
      g.globalCompositeOperation = 'source-over';
      g.restore();
    }
    // ---- ruts in dirt tracks
    for (const r of ruts) {
      const x0 = r.horiz ? r.a0 : r.c - r.wid / 2, x1 = r.horiz ? r.a1 : r.c + r.wid / 2;
      const y0 = r.horiz ? r.c - r.wid / 2 : r.a0, y1 = r.horiz ? r.c + r.wid / 2 : r.a1;
      if (!inR(x0, y0, x1, y1)) continue;
      const rng = seededRng(Math.floor(r.c * 3 + r.a0));
      for (const side of [-1, 1]) {
        g.strokeStyle = 'rgba(16,10,6,0.32)';
        g.lineWidth = 8;
        g.beginPath();
        const off = r.c + side * 15;
        for (let p = r.a0; p <= r.a1; p += 24) {
          const w = Math.sin(p * 0.02 + side * 3) * 3 + Math.sin(p * 0.057) * 1.5;
          if (r.horiz) g.lineTo(p, off + w); else g.lineTo(off + w, p);
        }
        g.stroke();
        g.strokeStyle = 'rgba(70,58,40,0.18)';
        g.lineWidth = 3;
        g.stroke();
        void rng;
      }
    }
    // ---- fallen leaves
    if (detail >= 1) {
      const cols = ['#6b4a1e', '#8a5a1c', '#a06a24', '#5e4a1a', '#7a3e18', '#8c7a2c'];
      for (const t of leaves) {
        if (!inR(t.x - t.R * 1.3, t.y - t.R * 1.3, t.x + t.R * 1.3, t.y + t.R * 1.3)) continue;
        const rng = seededRng(t.seed);
        const n = 46;
        for (let k = 0; k < n; k++) {
          const a = rng.next() * Math.PI * 2, rr = Math.sqrt(rng.next()) * t.R * 1.15;
          g.fillStyle = cols[Math.floor(rng.next() * cols.length)];
          g.globalAlpha = 0.25 + rng.next() * 0.4;
          g.save();
          g.translate(t.x + Math.cos(a) * rr, t.y + Math.sin(a) * rr);
          g.rotate(rng.next() * 6.28);
          g.fillRect(-1.6, -0.8, 3.2, 1.6);
          g.restore();
        }
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }

  return { paint, stats: { lanes: lanes.length, drains: drains.length, marks: marks.length, ruts: ruts.length, leaves: leaves.length } };
}
