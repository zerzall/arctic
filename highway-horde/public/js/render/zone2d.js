// Evac Run in the classic top-down view (SPEC §3.7 / §7.1): the safe circle as a glowing
// teal ring (dashed while it is only announced), the smaller circle it will shrink to, a
// violet haze over the blight outside it during a wave, the supply drop with its green
// beacon, and an arrow at the screen edge pointing to the zone with its name and distance.

import { zoneEdgeDist, zoneName } from '../shared/zone.js';

const TEAL = '#4fe3d0';
const PX_PER_M = 32;
const TAU = Math.PI * 2;

/**
 * @param {object} map MapDef (pois for the names)
 */
export function createZone2D(map) {
  /**
   * World-space pass (after the lighting, so it reads at night).
   * @param {CanvasRenderingContext2D} ctx world transform set
   * @param {object} view snapshot
   * @param {{x0, y0, x1, y1}} rect visible world rect
   * @param {number} time seconds
   * @param {number} k device px per world px
   */
  function drawWorld(ctx, view, rect, time, k) {
    const z = view && view.zone;
    if (!z) return;
    const px = 1 / Math.max(1e-3, k);
    ctx.save();
    // the blight: tinted haze over everything outside the live circle
    if (z.stage > 0) {
      ctx.beginPath();
      ctx.rect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.arc(z.x, z.y, z.r, 0, TAU, true);
      ctx.fillStyle = `rgba(118,44,104,${0.3 + 0.04 * Math.sin(time * 1.7)})`;
      ctx.fill('evenodd');
    }
    // the ring: a soft glow and a bright core
    const dashed = z.stage === 0;
    for (const [w, a] of [[16, 0.18], [7, 0.35], [2.5, 0.95]]) {
      ctx.lineWidth = w * px;
      ctx.strokeStyle = TEAL;
      ctx.globalAlpha = a * (dashed ? 0.75 + 0.25 * Math.sin(time * 4) : 1);
      if (dashed) {
        ctx.setLineDash([26 * px, 16 * px]);
        ctx.lineDashOffset = -time * 40 * px;
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // where it shrinks to
    if (z.stage >= 1 && (Math.abs(z.nr - z.r) > 1 || Math.abs(z.nx - z.x) > 1)) {
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([12 * px, 10 * px]);
      ctx.beginPath();
      ctx.arc(z.nx, z.ny, z.nr, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // supply drop: a crate on a pallet with a pulsing green beacon
    if (z.sx >= rect.x0 - 80 && z.sx <= rect.x1 + 80 && z.sy >= rect.y0 - 80 && z.sy <= rect.y1 + 80) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      ctx.globalAlpha = 0.35 + 0.3 * pulse;
      ctx.strokeStyle = '#6dff9a';
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.arc(z.sx, z.sy, 34 + 10 * pulse, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.translate(z.sx, z.sy);
      ctx.rotate(0.35);
      ctx.fillStyle = '#5a4128';
      ctx.fillRect(-22, -16, 44, 32);
      ctx.fillStyle = '#7a5a32';
      ctx.fillRect(-18, -13, 36, 26);
      ctx.fillStyle = '#4b5320';
      ctx.fillRect(-18, -3, 36, 6);
      ctx.fillStyle = '#6dff9a';
      ctx.fillRect(-2, -10, 4, 20);
      ctx.fillRect(-10, -2, 20, 4);
    }
    ctx.restore();
  }

  /**
   * Screen-space pass: an edge arrow to the zone (off screen, or while outside it).
   * @param {CanvasRenderingContext2D} ctx CSS-px transform set
   */
  function drawScreen(ctx, view, local, toScreen, tmp, cssW, cssH, time) {
    const z = view && view.zone;
    if (!z || !local || local.state === 'dead') return;
    const out = zoneEdgeDist(z, local.x, local.y);
    if (out <= 0) return;
    toScreen(z.x, z.y, tmp);
    const cx = cssW / 2, cy = cssH / 2;
    // stay clear of the HUD: its panels fill the corners and the bottom edge, and the zone
    // panel, the outside warning and the toasts stack up at the top
    const mx = Math.min(cssW * 0.3, 90), myB = Math.min(cssH * 0.3, 150), myT = Math.min(cssH * 0.36, 235);
    const onScreen = tmp.x > mx && tmp.x < cssW - mx && tmp.y > myT && tmp.y < cssH - myB;
    let ax = tmp.x, ay = tmp.y;
    const ang = Math.atan2(tmp.y - cy, tmp.x - cx);
    if (!onScreen) {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const room = dy < 0 ? cy - myT : cssH - myB - cy;
      const s = Math.min((cssW / 2 - mx) / Math.max(1e-6, Math.abs(dx)), Math.max(0, room) / Math.max(1e-6, Math.abs(dy)));
      ax = cx + dx * s;
      ay = cy + dy * s;
    }
    const urgent = z.stage > 0 && view.phase === 'wave';
    ctx.save();
    ctx.translate(ax, ay);
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(time * 6);
    ctx.fillStyle = urgent ? '#ff6b8a' : TEAL;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 2;
    ctx.save();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-8, 12);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-8, -12);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    const label = `${zoneName(map, z) || 'Safe zone'} · ${Math.round(out / PX_PER_M)} m`;
    ctx.font = '700 13px "Barlow Condensed", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ly = ay > cssH / 2 ? -24 : 26;
    const tw = ctx.measureText(label).width;
    const lx = Math.max(-ax + 8 + tw / 2, Math.min(cssW - ax - 8 - tw / 2, 0));
    ctx.lineWidth = 3;
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = '#f3efe6';
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  return { drawWorld, drawScreen };
}

/**
 * Lobby thumbnail extra: every point of interest as a teal ring (Evac Run maps).
 * @param {CanvasRenderingContext2D} g world transform set (s = world → px scale)
 */
export function drawPoiRings(g, map, s) {
  if (!map.pois) return;
  // thin dashed rings (1.5 px on the thumbnail) and a dot on each centre
  for (const p of map.pois) {
    g.strokeStyle = 'rgba(79,227,208,0.75)';
    g.lineWidth = Math.max(3, 1.5 / s);
    g.setLineDash([Math.max(14, 5 / s), Math.max(10, 4 / s)]);
    g.beginPath();
    g.arc(p.x, p.y, p.r, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = TEAL;
    g.beginPath();
    g.arc(p.x, p.y, Math.max(8, 2.2 / s), 0, TAU);
    g.fill();
  }
}
