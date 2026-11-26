// The Campaign in the classic top-down view (SPEC §3.8 / §7.1): the terrain (the hill as a
// shaded dome with contour rings, the annex plateaus with a cliff edge), the stage's circle as
// an amber ring (green and dashed once the zip line is live), the horde front as a churning red
// wall over the route, the zip cable with its pulse, the stage's supply point with its beacon,
// and an edge arrow to the circle. Also the lobby thumbnail extras.

import { routePointExt } from '../shared/campaign.js';
import { terrainOf } from '../shared/terrain.js';

const AMBER = '#ffd166';
const GREEN = '#6dff9a';
const PX_PER_M = 32;
const TAU = Math.PI * 2;

/**
 * @param {object} map MapDef with `campaign` (else every call is a no-op)
 */
export function createCampaign2D(map) {
  const cfg = map.campaign;
  const terr = cfg ? terrainOf(map) : null;
  const _p = { x: 0, y: 0, a: 0 };

  /** The terrain under the ground's decals and the obstacles: dome shading, contours, cliffs. */
  function drawTerrain(ctx, rect) {
    if (!cfg || !terr || terr.flat) return;
    ctx.save();
    for (const hl of terr.spec.hills || []) {
      if (hl.x + hl.r < rect.x0 || hl.x - hl.r > rect.x1 || hl.y + hl.r < rect.y0 || hl.y - hl.r > rect.y1) continue;
      // a soft dome: lighter toward the top, darker at the foot
      const grad = ctx.createRadialGradient(hl.x, hl.y, hl.plateau * 0.4, hl.x, hl.y, hl.r);
      grad.addColorStop(0, 'rgba(255,240,190,0.22)');
      grad.addColorStop(0.5, 'rgba(255,240,190,0.09)');
      grad.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(hl.x, hl.y, hl.r, 0, TAU);
      ctx.fill();
      // contour rings every quarter of the height
      ctx.strokeStyle = 'rgba(30,25,10,0.22)';
      ctx.lineWidth = 1.5;
      for (const f of [0.25, 0.5, 0.75]) {
        ctx.beginPath();
        ctx.arc(hl.x, hl.y, hl.plateau + (hl.r - hl.plateau) * (1 - f), 0, TAU);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,240,190,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hl.x, hl.y, hl.plateau, 0, TAU);
      ctx.stroke();
    }
    // plateaus: a light drop shadow band outside the edge, the cliff line on it
    for (const pl of terr.spec.plateaus || []) {
      if (pl.x1 < rect.x0 || pl.x0 > rect.x1 || pl.y1 < rect.y0 || pl.y0 > rect.y1) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(pl.x0 - 14, pl.y0 - 14, pl.x1 - pl.x0 + 28, pl.y1 - pl.y0 + 28);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(pl.x0, pl.y0, pl.x1 - pl.x0, pl.y1 - pl.y0);
    }
    ctx.restore();
  }

  /**
   * World-space pass (after the lighting, so it reads at night).
   * @param {CanvasRenderingContext2D} ctx world transform set
   * @param {object} view snapshot
   * @param {{x0, y0, x1, y1}} rect visible world rect
   * @param {number} time seconds
   * @param {number} k device px per world px
   */
  function drawWorld(ctx, view, rect, time, k) {
    const c = view && view.campaign;
    if (!cfg || !c) return;
    const px = 1 / Math.max(1e-3, k);
    ctx.save();
    // the horde front: a dust-red wall across the street with a glowing edge
    if (c.front > -1e8 && c.stage === 2) {
      routePointExt(cfg.route, c.front, _p);
      const a = _p.a, nx = -Math.sin(a), ny = Math.cos(a);
      const fx = _p.x, fy = _p.y;
      const half = 520;
      // the region behind it, tinted
      ctx.fillStyle = 'rgba(170,30,20,0.2)';
      ctx.beginPath();
      const back = 2600;
      ctx.moveTo(fx + nx * half, fy + ny * half);
      ctx.lineTo(fx - nx * half, fy - ny * half);
      ctx.lineTo(fx - nx * half - Math.cos(a) * back, fy - ny * half - Math.sin(a) * back);
      ctx.lineTo(fx + nx * half - Math.cos(a) * back, fy + ny * half - Math.sin(a) * back);
      ctx.closePath();
      ctx.fill();
      for (const [w, al] of [[26, 0.16], [10, 0.4], [3, 0.95]]) {
        ctx.lineWidth = w * px;
        ctx.strokeStyle = '#ff4a3a';
        ctx.globalAlpha = al * (0.8 + 0.2 * Math.sin(time * 5));
        ctx.beginPath();
        ctx.moveTo(fx + nx * half, fy + ny * half);
        ctx.lineTo(fx - nx * half, fy - ny * half);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // the zip cable, once the roof is the stage
    if (c.stage === 4) {
      const z = cfg.roof.zip, l = cfg.landing.end;
      ctx.strokeStyle = c.zip ? GREEN : 'rgba(230,235,240,0.6)';
      ctx.lineWidth = 2 * px;
      ctx.globalAlpha = c.zip ? 0.8 : 0.5;
      ctx.beginPath();
      ctx.moveTo(z.x, z.y);
      ctx.lineTo(l.x, l.y);
      ctx.stroke();
      if (c.zip) {
        for (let i = 0; i < 3; i++) {
          const e = (time * 0.35 + i / 3) % 1;
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = '#e8fff0';
          ctx.beginPath();
          ctx.arc(z.x + (l.x - z.x) * e, z.y + (l.y - z.y) * e, 4 * px * 2, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    // the circle of the stage
    if (c.r > 0) {
      const live = c.stage === 4 && c.zip;
      const col = live ? GREEN : AMBER;
      const dashed = live || (c.stage === 1 && c.sub === 0);
      for (const [w, a] of [[16, 0.16], [7, 0.32], [2.5, 0.95]]) {
        ctx.lineWidth = w * px;
        ctx.strokeStyle = col;
        ctx.globalAlpha = a * (0.8 + 0.2 * Math.sin(time * 4));
        if (dashed) {
          ctx.setLineDash([26 * px, 16 * px]);
          ctx.lineDashOffset = -time * 40 * px;
        } else {
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // the stage's supply point: a crate with a pulsing beacon
    if (c.sx >= rect.x0 - 80 && c.sx <= rect.x1 + 80 && c.sy >= rect.y0 - 80 && c.sy <= rect.y1 + 80) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      ctx.globalAlpha = 0.35 + 0.3 * pulse;
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, 34 + 10 * pulse, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.translate(c.sx, c.sy);
      ctx.fillStyle = '#4b5320';
      ctx.fillRect(-10, -10, 20, 20);
      ctx.fillStyle = GREEN;
      ctx.fillRect(-2, -8, 4, 16);
      ctx.fillRect(-8, -2, 16, 4);
    }
    ctx.restore();
  }

  /**
   * Screen-space pass: an edge arrow to the stage's circle when it is off screen.
   * @param {CanvasRenderingContext2D} ctx CSS-px transform set
   */
  function drawScreen(ctx, view, local, toScreen, tmp, cssW, cssH, time) {
    const c = view && view.campaign;
    if (!cfg || !c || !local || local.state === 'dead' || local.esc || local.ride > 0) return;
    if (c.stage === 1 && c.sub === 0) return;
    const out = Math.max(0, Math.hypot(c.x - local.x, c.y - local.y) - c.r);
    if (out <= 0) return;
    toScreen(c.x, c.y, tmp);
    const cx = cssW / 2, cy = cssH / 2;
    const mx = Math.min(cssW * 0.3, 90), myB = Math.min(cssH * 0.3, 150), myT = Math.min(cssH * 0.36, 235);
    const onScreen = tmp.x > mx && tmp.x < cssW - mx && tmp.y > myT && tmp.y < cssH - myB;
    if (onScreen) return;
    const ang = Math.atan2(tmp.y - cy, tmp.x - cx);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const room = dy < 0 ? cy - myT : cssH - myB - cy;
    const s = Math.min((cssW / 2 - mx) / Math.max(1e-6, Math.abs(dx)), Math.max(0, room) / Math.max(1e-6, Math.abs(dy)));
    const ax = cx + dx * s, ay = cy + dy * s;
    const live = c.stage === 4 && c.zip;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(time * 6);
    ctx.fillStyle = live ? GREEN : AMBER;
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
    const name = live ? 'Zip line' : c.stage === 2 ? 'Tower' : c.stage === 3 ? 'Stairs' : c.stage === 4 ? 'Roof' : 'Hill';
    const label = `${name} · ${Math.round(out / PX_PER_M)} m`;
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

  return { drawTerrain, drawWorld, drawScreen };
}

/**
 * Lobby thumbnail extra: the hill, the route, the tower and the zip line of a campaign map.
 * @param {CanvasRenderingContext2D} g world transform set (s = world → px scale)
 */
export function drawCampaignPreview(g, map, s) {
  const cfg = map.campaign;
  if (!cfg) return;
  const hl = cfg.hill;
  const grad = g.createRadialGradient(hl.x, hl.y, hl.plateau * 0.4, hl.x, hl.y, hl.r);
  grad.addColorStop(0, 'rgba(255,240,190,0.3)');
  grad.addColorStop(1, 'rgba(255,240,190,0.04)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(hl.x, hl.y, hl.r, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(255,209,102,0.9)';
  g.lineWidth = Math.max(4, 2 / s);
  g.setLineDash([Math.max(24, 8 / s), Math.max(16, 6 / s)]);
  g.beginPath();
  cfg.route.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = AMBER;
  g.beginPath();
  g.arc(hl.x, hl.y, Math.max(12, 4 / s), 0, TAU);
  g.fill();
  const z = cfg.roof.zip, l = cfg.landing.end;
  g.strokeStyle = 'rgba(109,255,154,0.9)';
  g.lineWidth = Math.max(3, 1.6 / s);
  g.beginPath();
  g.moveTo(z.x, z.y);
  g.lineTo(l.x, l.y);
  g.stroke();
  g.fillStyle = GREEN;
  g.beginPath();
  g.arc(l.x, l.y, Math.max(10, 3.4 / s), 0, TAU);
  g.fill();
}
