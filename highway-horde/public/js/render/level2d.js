// A story level in the top-down view (JOURNEY.md §4): its gates, roofs and lights.
//
//   Gates    a shut gate is drawn like any obstacle, ringed with hazard stripes so it reads as
//            a way that will open; opening, its pieces fade over GATE_ANIM_TIME in a cloud of
//            dust; an open gate is not drawn at all (the way is free). Shutting fades them in.
//   Roofs    `map.roofs` cover their rooms with a roof of the kind's colour, translucent over
//            the rest of the level and faded out over the room the local player stands in (or
//            is looking into through its door), so a fight indoors stays visible.
//   Lights   a section whose lights are out (`lights` action, view.level.dark) loses its lamps.
// Everything is a no-op off a level.

import { levelGates, nearestSection, GATE_ANIM_TIME } from '../shared/level.js';
import { clamp } from '../shared/math.js';

/** Roof colours by kind (render3d/roofs3d.js uses the same). */
const ROOF_COLOR = {
  plain: '#3d3a36', office: '#4a4744', hospital: '#55534f', mall: '#5b5853',
  metro: '#4a4843', industrial: '#646763', house: '#5a3e32',
};
/** Opacity of a roof seen from outside, and over the local player's own room. */
const ROOF_ALPHA = 0.86;
const ROOF_INSIDE = 0.08;

/** Point in an oriented rect grown by `pad`. */
function inRect(r, x, y, pad = 0) {
  const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
  const dx = x - r.x, dy = y - r.y;
  return Math.abs(dx * c + dy * s) <= r.w / 2 + pad && Math.abs(-dx * s + dy * c) <= r.h / 2 + pad;
}

/**
 * @param {object} map the match map
 * @param {object} [deps] { effects } (render/effects.js: dust of a moving gate)
 * @returns {null | {
 *   gateAlpha(i: number, view): number,
 *   lightOff(x: number, y: number, view): boolean,
 *   drawGates(ctx, view, viewRect, time): void,
 *   drawRoofs(ctx, view, viewRect, local, dt): void,
 *   tick(view, dt): void,
 *   addEvents(events, camX, camY, shake(amount)): void,
 * }} null off a level
 */
export function createLevel2D(map, deps = {}) {
  if (!map || map.kind !== 'level') return null;
  const gates = levelGates(map);
  const gateOf = new Int16Array(map.obstacles.length).fill(-1);
  for (const g of gates) for (const o of g.obs) if (o.id >= 0 && o.id < gateOf.length) gateOf[o.id] = g.i;
  const roofs = (map.roofs || []).filter((r) => r.w > 0 && r.h > 0).map((r) => ({
    r, color: ROOF_COLOR[r.kind] || ROOF_COLOR.plain, alpha: ROOF_ALPHA,
  }));
  const lightSec = new Map();
  const secOf = (x, y) => {
    const k = Math.round(x) * 65536 + Math.round(y);
    let s = lightSec.get(k);
    if (s === undefined) { s = nearestSection(map, x, y); lightSec.set(k, s); }
    return s;
  };

  /** Seconds since gate i last moved (Infinity: never, or no snapshot). */
  function gateAge(g, view) {
    if (!g || !view || !Number.isFinite(view.tick) || !Number.isFinite(g.t) || g.t <= 0) return Infinity;
    return Math.max(0, (view.tick - g.t) / 60);
  }

  /** How opaque obstacle i is drawn: 1 unless it is a piece of a gate that is open or moving. */
  function gateAlpha(i, view) {
    const gi = i < gateOf.length ? gateOf[i] : -1;
    if (gi < 0) return 1;
    const lv = view && view.level;
    const g = lv && lv.gates ? lv.gates[gi] : null;
    if (!g) return 1;
    const u = clamp(gateAge(g, view) / GATE_ANIM_TIME, 0, 1);
    return g.open ? 1 - u : u;
  }

  /** A map light at (x, y) is out: its section's lights are cut. */
  function lightOff(x, y, view) {
    const dark = view && view.level ? view.level.dark >>> 0 : 0;
    if (!dark) return false;
    const s = secOf(x, y);
    return s >= 0 && s < 32 && (dark & (1 << s)) !== 0;
  }

  let stripes = null;
  function stripePattern(ctx) {
    if (stripes) return stripes;
    if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return '#e0a526';
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(16, 16);
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#e8b02a';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(8, 0); g.lineTo(0, 8); g.closePath();
    g.moveTo(16, 0); g.lineTo(16, 8); g.lineTo(8, 16); g.lineTo(0, 16); g.closePath();
    g.fill();
    stripes = ctx.createPattern(c, 'repeat') || '#e0a526';
    return stripes;
  }

  /** Hazard-striped rims on the shut gates in view (world transform set by the caller). */
  function drawGates(ctx, view, viewRect, time) {
    const lv = view && view.level;
    if (!lv || !lv.gates) return;
    for (const g of gates) {
      const s = lv.gates[g.i];
      if (!s) continue;
      const a = s.open ? 1 - clamp(gateAge(s, view) / GATE_ANIM_TIME, 0, 1) : 1;
      if (a <= 0) continue;
      if (g.x1 < viewRect.x0 || g.x0 > viewRect.x1 || g.y1 < viewRect.y0 || g.y0 > viewRect.y1) continue;
      ctx.globalAlpha = a * (0.75 + 0.25 * Math.sin(time * 3 + g.i));
      ctx.strokeStyle = stripePattern(ctx);
      ctx.lineWidth = 5;
      for (const o of g.obs) {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.a || 0);
        ctx.strokeRect(-o.w / 2 - 3, -o.h / 2 - 3, o.w + 6, o.h + 6);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Per frame: the dust of the gates that are moving. */
  function tick(view, dt) {
    const lv = view && view.level;
    if (!lv || !lv.gates || !deps.effects) return;
    for (const g of gates) {
      const s = lv.gates[g.i];
      if (!s || gateAge(s, view) > GATE_ANIM_TIME) continue;
      for (const o of g.obs) deps.effects.emitDust(o.x, o.y, dt, 40, Math.max(14, Math.min(40, Math.max(o.w, o.h) * 0.3)));
    }
  }

  /**
   * The roofs in view, translucent; the room the local player is in (or next to its doorway)
   * fades out. `local` = the followed player or null.
   */
  function drawRoofs(ctx, view, viewRect, local, dt) {
    if (!roofs.length) return;
    const k = 1 - Math.exp(-(dt || 0.016) * 6);
    for (const R of roofs) {
      const r = R.r;
      const inside = !!local && local.state !== 'dead' && inRect(r, local.x, local.y, 24);
      R.alpha += ((inside ? ROOF_INSIDE : ROOF_ALPHA) - R.alpha) * k;
      const ext = Math.max(r.w, r.h) * 0.75;
      if (r.x + ext < viewRect.x0 || r.x - ext > viewRect.x1 || r.y + ext < viewRect.y0 || r.y - ext > viewRect.y1) continue;
      if (R.alpha < 0.02) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.a || 0);
      ctx.globalAlpha = R.alpha;
      ctx.fillStyle = R.color;
      ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      // parapet and a few seams, so it reads as a roof and not a hole in the map
      ctx.globalAlpha = R.alpha * 0.55;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(-r.w / 2 + 1.5, -r.h / 2 + 1.5, r.w - 3, r.h - 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      const along = r.w >= r.h, L = along ? r.w : r.h, D = along ? r.h : r.w;
      for (let t = -L / 2 + 60; t < L / 2 - 20; t += 60) {
        ctx.beginPath();
        if (along) { ctx.moveTo(t, -D / 2 + 4); ctx.lineTo(t, D / 2 - 4); } else { ctx.moveTo(-D / 2 + 4, t); ctx.lineTo(D / 2 - 4, t); }
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** A level's `shake` events shake the camera (by their strength, fading to nothing at their reach). */
  function addEvents(events, camX, camY, shake) {
    for (const e of events) {
      if (!e || e.type !== 'shake') continue;
      const d = Math.hypot((e.x || 0) - camX, (e.y || 0) - camY), r = e.r || 1800;
      if (d < r) shake(clamp(e.k || 0.5, 0, 1) * (1 - d / r) * 0.8);
    }
  }

  return { gateAlpha, lightOff, drawGates, drawRoofs, tick, addEvents };
}
