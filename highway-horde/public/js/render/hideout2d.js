// A story hideout in the classic top-down view (SPEC §3.9): glowing station rings with a small
// icon and label, the upgrade slots with their tier pips, the range's target stands (the sim's
// dummies are drawn as targets instead of zombies) with the damage numbers floating up from every
// hit. The 3D view has the real props; this is the same information at a glance. Nothing here
// is created on a normal map.

import { isRangeTarget } from '../shared/sim/range.js';
import { STATION_COLORS, UPGRADE_COLORS as UP_COLORS } from '../shared/maps-hideouts.js';

const TAU = Math.PI * 2;

/** The icon of a station: a few strokes inside a circle of radius 1 (unit space, y down). */
function icon(g, kind) {
  g.beginPath();
  switch (kind) {
    case 'board':      // a pin
      g.arc(0, -0.25, 0.42, 0, TAU); g.moveTo(0, 0.15); g.lineTo(0, 0.85); break;
    case 'workbench':  // a wrench
      g.moveTo(-0.6, 0.6); g.lineTo(0.25, -0.25); g.moveTo(0.05, -0.55); g.arc(0.3, -0.5, 0.3, Math.PI, TAU * 0.85); break;
    case 'armory':     // a crosshair
      g.arc(0, 0, 0.55, 0, TAU); g.moveTo(-0.85, 0); g.lineTo(-0.3, 0); g.moveTo(0.3, 0); g.lineTo(0.85, 0);
      g.moveTo(0, -0.85); g.lineTo(0, -0.3); g.moveTo(0, 0.3); g.lineTo(0, 0.85); break;
    case 'infirmary':  // a cross
      g.moveTo(-0.6, 0); g.lineTo(0.6, 0); g.moveTo(0, -0.6); g.lineTo(0, 0.6); break;
    case 'upgrades':   // an arrow up
      g.moveTo(0, 0.7); g.lineTo(0, -0.7); g.moveTo(-0.45, -0.25); g.lineTo(0, -0.75); g.lineTo(0.45, -0.25); break;
    case 'bed':        // a crescent
      g.arc(0, 0, 0.6, 0.6, TAU - 0.6); g.arc(0.3, -0.05, 0.5, TAU - 0.9, 0.9, true); break;
    case 'range':      // a target
      g.arc(0, 0, 0.7, 0, TAU); g.moveTo(0.35, 0); g.arc(0, 0, 0.35, 0, TAU); break;
    default:           // a flame
      g.moveTo(0, 0.7); g.bezierCurveTo(-0.7, 0.5, -0.5, -0.1, -0.1, -0.7); g.bezierCurveTo(0.05, -0.2, 0.15, -0.1, 0.25, -0.3);
      g.bezierCurveTo(0.7, 0.1, 0.6, 0.5, 0, 0.7);
  }
  g.stroke();
}

/**
 * @param {object} map hideout MapDef
 */
export function createHideout2D(map) {
  const hub = map.hub;
  const hits = [];      // floating damage numbers { x, y, dmg, t, big }

  function isDummy(z) {
    return isRangeTarget(map, z.x, z.y);
  }

  /** The snapshot without the range's dummy zombies (drawn here as target stands). */
  function strip(view) {
    if (!view || !view.zombies || !view.zombies.length || !hub.range) return view;
    let any = false;
    for (let i = 0; i < view.zombies.length; i++) if (isDummy(view.zombies[i])) { any = true; break; }
    return any ? { ...view, zombies: view.zombies.filter((z) => !isDummy(z)) } : view;
  }

  /** Feed GameEvents: `rangehit` makes a number float up from the target. */
  function addEvents(events, time) {
    for (const e of events) {
      if (e && e.type === 'rangehit' && Number.isFinite(e.x) && Number.isFinite(e.y)) {
        hits.push({ x: e.x, y: e.y, dmg: e.dmg, t: time, big: !!e.big, dist: e.dist });
        if (hits.length > 24) hits.shift();
      }
    }
  }

  function target(ctx, t, time, flash, px) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.a || 0);
    // the stand and the plywood silhouette, seen from above: a thin board with a base
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-2.5, -13, 5, 26);
    ctx.fillStyle = flash > 0 ? '#ffd9a0' : '#c8b48a';
    ctx.fillRect(-2, -12, 4, 24);
    ctx.strokeStyle = '#4a3a22';
    ctx.lineWidth = px * 1.1;
    ctx.strokeRect(-2, -12, 4, 24);
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(-7, -3, 6, 6);
    ctx.restore();
    ctx.fillStyle = 'rgba(236,229,210,0.85)';
    ctx.beginPath();
    ctx.arc(t.x, t.y, 2.2, 0, TAU);
    ctx.fill();
  }

  /**
   * World-space pass, after the lighting (so it reads at night).
   * @param {CanvasRenderingContext2D} ctx world transform set
   * @param {object} view snapshot
   * @param {{x0, y0, x1, y1}} rect visible world rect
   * @param {number} time seconds
   * @param {number} k device px per world px
   */
  function drawWorld(ctx, view, rect, time, k) {
    const px = 1 / Math.max(1e-3, k);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // the upgrade slots: a dashed footprint while unbuilt, a soft disc and the tier pips once built
    const tiers = hub.upgrades || {};
    for (const slot of Object.values(hub.upgradeSlots)) {
      if (slot.x < rect.x0 - 200 || slot.x > rect.x1 + 200 || slot.y < rect.y0 - 200 || slot.y > rect.y1 + 200) continue;
      const tier = tiers[slot.kind] | 0;
      const col = UP_COLORS[slot.kind] || '#ffffff';
      const r = Math.min(56, slot.r * 0.5);
      if (slot.kind !== 'palisade') {
        ctx.globalAlpha = tier > 0 ? 0.2 : 0.1;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = tier > 0 ? 0.75 : 0.4;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6 * px * 1.5;
        ctx.setLineDash(tier > 0 ? [] : [7 * px * 1.5, 6 * px * 1.5]);
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const py = slot.kind === 'palisade' ? slot.y - 26 : slot.y - r - 9;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(slot.x + (i - 1) * 9, py, 3, 0, TAU);
        ctx.fillStyle = i < tier ? col : 'rgba(0,0,0,0.5)';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = px * 1.2;
        ctx.stroke();
      }
    }
    // the stations: a pulsing ring, an icon, the label
    for (const s of hub.stations) {
      if (s.x < rect.x0 - 200 || s.x > rect.x1 + 200 || s.y < rect.y0 - 200 || s.y > rect.y1 + 200) continue;
      const col = STATION_COLORS[s.kind] || '#ffffff';
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + s.x * 0.01);
      const r = Math.min(34, s.r * 0.36);
      ctx.globalAlpha = 0.16 + 0.1 * pulse;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 8 * pulse, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(14,12,10,0.78)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.62, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5 * px * 1.5;
      ctx.stroke();
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(r * 0.4, r * 0.4);
      ctx.lineWidth = (1.6 * px * 1.5) / (r * 0.4);
      ctx.strokeStyle = col;
      icon(ctx, s.kind);
      ctx.restore();
      ctx.globalAlpha = 0.92;
      ctx.font = `700 ${Math.round(11 * px * 1.5 * 100) / 100}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3 * px * 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(s.label, s.x, s.y + r * 0.62 + 4 * px * 1.5);
      ctx.fillStyle = '#f4ead2';
      ctx.fillText(s.label, s.x, s.y + r * 0.62 + 4 * px * 1.5);
    }
    // the range: target stands, and the damage numbers of the hits
    if (hub.range) {
      ctx.globalAlpha = 1;
      const flash = new Map();
      for (const h of hits) if (time - h.t < 0.18) flash.set(`${Math.round(h.x)},${Math.round(h.y)}`, 1);
      for (const t of hub.range.targets) target(ctx, t, time, flash.get(`${Math.round(t.x)},${Math.round(t.y)}`) || 0, px);
    }
    ctx.globalAlpha = 1;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      const age = time - h.t;
      if (age > 1.3) { hits.splice(i, 1); continue; }
      const a = age < 0.9 ? 1 : 1 - (age - 0.9) / 0.4;
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round((h.big ? 17 : 13) * px * 1.5 * 100) / 100}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const y = h.y - 16 - age * 34;
      const txt = String(Math.round(h.dmg));
      ctx.lineWidth = 3 * px * 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(txt, h.x, y);
      ctx.fillStyle = h.big ? '#ffd45a' : '#fff4e0';
      ctx.fillText(txt, h.x, y);
    }
    ctx.restore();
  }

  return { strip, addEvents, drawWorld };
}
