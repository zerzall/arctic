// HUD minimap: the map's static layout is painted once into an offscreen canvas; each
// refresh only blits it and draws dots for zombies, pickups, teammates and the local
// player's arrow. Redrawn at MINIMAP_HZ rather than every frame.
//
// Radar mode (first-person view): a zoomed window centred on the player that turns with
// the camera, so up is always where you look. A north marker rides the rim, and the
// objective, supply station and teammates beyond the window are pinned to the rim so
// you can always turn toward them.
//
// Evac Run (opts.zone): no objective or edge spawns; the safe circle (and the smaller one
// it shrinks to) is drawn over the map, the blight outside it tinted, and the zone's centre
// and supply drop pinned to the radar's rim like the objective.
//
// The Campaign (opts.campaign): no objective or edge spawns; the hill, the stage's circle, the
// horde front (a red band over the route behind it), the zip cable and the stage's supply
// point are drawn over the map (drawCampaign).

import { PLAYER_COLORS } from '../shared/constants.js';
import { routePointExt, pathLen } from '../shared/campaign.js';
import { currentUiScale } from './uiscale.js';

const MINIMAP_HZ = 20;
const AREA_COLORS = {
  asphalt: '#2a2d31', concrete: '#383b3e', grass: '#1c2819', dirt: '#302619',
  gravel: '#33312c', sand: '#463e2e', water: '#10304a',
};
/** Radar mode: world px from the player to the nearer edge of the window. */
const RADAR_RANGE = 900;
const TALL = new Set(['building', 'wall', 'container', 'semi', 'bus', 'tanker', 'truck', 'booth', 'pillar', 'hesco', 'pier', 'ramp', 'silo', 'tower', 'watchtower', 'palisade', 'iwall', 'mast']);
/** North-up mode: maps wider than this (width / height) scroll with the player instead of shrinking to a strip. */
const SCROLL_ASPECT = 2.6;

function rotRect(g, x, y, w, h, a) {
  g.save();
  g.translate(x, y);
  if (a) g.rotate(a);
  g.fillRect(-w / 2, -h / 2, w, h);
  g.restore();
}

/**
 * @param {HTMLCanvasElement} canvas the visible minimap canvas (sized by CSS)
 * @param {object} map MapDef
 * @param {{radar?: boolean}} [opts] radar: rotating player-centred window (first person)
 */
export function createMinimap(canvas, map, opts = {}) {
  const g = canvas.getContext('2d');
  let radar = !!opts.radar;
  const zoneMode = !!opts.zone;
  const campMode = !!opts.campaign && !!map.campaign;
  const cfg = campMode ? map.campaign : null;
  // dpr: backing pixels per CSS px; u: backing pixels per design px (dpr × UI scale), so
  // markers and labels grow with the rem-sized minimap on big screens.
  let W = 0, H = 0, dpr = 1, u = 1, scale = 1, ox = 0, oy = 0;
  let scroll = false;   // north-up on a very long map: a full-height window that follows the player
  let base = null;
  let acc = 1;
  let radarYaw = 0;
  let pulse = 0;

  function paintBase() {
    base = document.createElement('canvas');
    // Radar: the whole map at the zoomed scale (a few hundred px), blitted rotated.
    base.width = radar || scroll ? Math.ceil(map.width * scale + ox * 2) : W;
    base.height = radar || scroll ? Math.ceil(map.height * scale + oy * 2) : H;
    const b = base.getContext('2d');
    b.fillStyle = '#0a0c0e';
    b.fillRect(0, 0, base.width, base.height);
    b.save();
    b.translate(ox, oy);
    b.scale(scale, scale);
    b.fillStyle = map.ground || '#1b1d1a';
    b.fillRect(0, 0, map.width, map.height);
    for (const a of map.areas || []) {
      b.fillStyle = AREA_COLORS[a.kind] || '#2a2d31';
      rotRect(b, a.x, a.y, a.w, a.h, a.a);
    }
    for (const o of map.obstacles || []) {
      b.fillStyle = TALL.has(o.kind) ? '#6d737b' : o.solid ? '#555a61' : '#44484e';
      rotRect(b, o.x, o.y, Math.max(o.w, 14), Math.max(o.h, 14), o.a);
    }
    // overpass decks: a light band over the ground (you can walk under the viaduct)
    const ov = map.overpass;
    if (ov) {
      for (const d of ov.decks) {
        b.strokeStyle = d.kind === 'ramp' ? 'rgba(150,152,148,0.75)' : 'rgba(150,152,148,0.45)';
        b.lineWidth = d.w;
        b.lineCap = 'butt';
        b.beginPath();
        d.pts.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
        b.stroke();
      }
    }
    if (cfg) paintCampaignBase(b);
    // zombie spawn zones, faint
    b.fillStyle = 'rgba(210,40,40,0.16)';
    if (!zoneMode && !campMode) for (const z of map.zombieSpawns || []) b.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    const ob = zoneMode || campMode ? null : map.objective;
    if (ob) {
      b.fillStyle = 'rgba(255,196,0,0.35)';
      rotRect(b, ob.x, ob.y, ob.w, ob.h, ob.a);
      b.strokeStyle = '#ffc400';
      b.lineWidth = 2 / scale * u;
      b.save();
      b.translate(ob.x, ob.y);
      if (ob.a) b.rotate(ob.a);
      b.strokeRect(-ob.w / 2, -ob.h / 2, ob.w, ob.h);
      b.restore();
    }
    b.restore();
    // map border
    b.strokeStyle = 'rgba(255,255,255,0.18)';
    b.lineWidth = u;
    b.strokeRect(ox + 0.5, oy + 0.5, map.width * scale - 1, map.height * scale - 1);
  }

  /** The campaign's fixed layout: the hill (lighter, with its plateau) and the route to the tower. */
  function paintCampaignBase(b) {
    const hl = cfg.hill;
    b.fillStyle = 'rgba(150,170,110,0.16)';
    b.beginPath();
    b.arc(hl.x, hl.y, hl.r, 0, Math.PI * 2);
    b.fill();
    b.fillStyle = 'rgba(190,200,140,0.16)';
    b.beginPath();
    b.arc(hl.x, hl.y, hl.plateau, 0, Math.PI * 2);
    b.fill();
    b.strokeStyle = 'rgba(255,209,102,0.28)';
    b.lineWidth = 3 / scale * u;
    b.setLineDash([16 / scale * u, 12 / scale * u]);
    b.beginPath();
    cfg.route.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
    b.stroke();
    b.setLineDash([]);
    // the zip line, roof to landing pad
    const z = cfg.roof.zip, l = cfg.landing.end;
    b.strokeStyle = 'rgba(109,255,154,0.35)';
    b.lineWidth = 2 / scale * u;
    b.beginPath();
    b.moveTo(z.x, z.y);
    b.lineTo(l.x, l.y);
    b.stroke();
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const cw = Math.max(40, Math.round(r.width)), ch = Math.max(30, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    u = dpr * currentUiScale();
    const nw = Math.round(cw * dpr), nh = Math.round(ch * dpr);
    if (nw === W && nh === H && base) return;
    W = canvas.width = nw;
    H = canvas.height = nh;
    scroll = !radar && map.width / map.height > SCROLL_ASPECT;
    if (radar) {
      scale = Math.min(W, H) / 2 / RADAR_RANGE;
      ox = oy = 0;
    } else if (scroll) {
      scale = H / map.height;
      ox = oy = 0;
    } else {
      scale = Math.min(W / map.width, H / map.height);
      ox = (W - map.width * scale) / 2;
      oy = (H - map.height * scale) / 2;
    }
    paintBase();
    acc = 1;
  }

  /**
   * @param {object|null} view Snapshot
   * @param {number} localId
   * @param {Map<number, object>} rosterById
   * @param {number} dt
   * @param {object|null} localPos predicted {x, y, angle} of the local player
   */
  function update(view, localId, rosterById, dt, localPos, yaw) {
    acc += dt;
    pulse += dt;
    // The radar turns with the camera: redraw whenever the view turned noticeably, else at
    // 30 Hz (a rotated draw of the whole-map layer every frame was most of the HUD's time).
    if (!radar && acc < 1 / MINIMAP_HZ) return;
    if (radar && acc < 1 / 30 && !(Math.abs(Math.atan2(Math.sin((yaw || 0) - radarYaw), Math.cos((yaw || 0) - radarYaw))) > 0.02)) return;
    radarYaw = yaw || 0;
    acc = 0;
    if (!base || W === 0) resize();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (radar) {
      drawRadar(view, localId, rosterById, localPos, yaw);
      return;
    }
    if (scroll) {
      // follow the local player (else the objective) along the map, clamped to its ends
      let cx = localPos && Number.isFinite(localPos.x) ? localPos.x : NaN;
      if (!Number.isFinite(cx) && view) for (const p of view.players || []) if (p.id === localId) cx = p.x;
      if (!Number.isFinite(cx)) cx = map.objective ? map.objective.x : map.width / 2;
      ox = Math.round(Math.max(W - map.width * scale, Math.min(0, W / 2 - cx * scale)));
      g.fillStyle = '#0a0c0e';
      g.fillRect(0, 0, W, H);
    }
    g.drawImage(base, scroll ? ox : 0, 0);
    if (!view) return;
    const k = scale;
    const X = (x) => ox + x * k;
    const Y = (y) => oy + y * k;

    // supply station
    const s = campMode ? null : map.supply;
    if (s) {
      g.fillStyle = '#56d67a';
      const sx = X(s.x), sy = Y(s.y);
      g.fillRect(sx - 1 * u, sy - 4 * u, 2 * u, 8 * u);
      g.fillRect(sx - 4 * u, sy - 1 * u, 8 * u, 2 * u);
    }
    if (view.zone) drawZone(view.zone, X(view.zone.x), Y(view.zone.y), X(view.zone.nx), Y(view.zone.ny), k, false);
    if (campMode && view.campaign) drawCampaign(view.campaign, (x, y) => { _pt.x = X(x); _pt.y = Y(y); return _pt; }, k, false);
    // objective pulse when damaged
    if (view.objective && map.objective && view.objective.hp < view.objective.maxHp * 0.35) {
      const a = 0.35 + 0.35 * Math.sin(pulse * 8);
      g.strokeStyle = `rgba(255,70,50,${a})`;
      g.lineWidth = 2 * u;
      g.beginPath();
      g.arc(X(map.objective.x), Y(map.objective.y), 10 * u, 0, Math.PI * 2);
      g.stroke();
    }
    // pickups (crates stand out)
    for (const p of view.pickups || []) {
      if (p.kind === 'crate') {
        g.fillStyle = '#ffd54f';
        g.fillRect(X(p.x) - 2 * u, Y(p.y) - 2 * u, 4 * u, 4 * u);
      }
    }
    for (const t of view.turrets || []) {
      g.fillStyle = '#90caf9';
      g.fillRect(X(t.x) - 1.5 * u, Y(t.y) - 1.5 * u, 3 * u, 3 * u);
    }
    // zombies
    const zs = view.zombies || [];
    g.fillStyle = '#ff3b30';
    const zr = Math.max(1, 1.2 * u);
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.type === 'boss' || z.type === 'brute') continue;
      g.fillRect(X(z.x) - zr, Y(z.y) - zr, zr * 2, zr * 2);
    }
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.type !== 'boss' && z.type !== 'brute') continue;
      const r = (z.type === 'boss' ? 4.5 : 2.6) * u;
      g.fillStyle = z.type === 'boss' ? '#d500f9' : '#ff6d00';
      g.beginPath();
      g.arc(X(z.x), Y(z.y), r, 0, Math.PI * 2);
      g.fill();
    }
    // teammates
    const blink = Math.sin(pulse * 10) > 0;
    for (const p of view.players || []) {
      if (p.id === localId || p.state === 'dead') continue;
      const r = rosterById.get(p.id);
      const col = PLAYER_COLORS[r ? r.color : 0] || '#fff';
      if (p.state === 'downed' && !blink) continue;
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(X(p.x), Y(p.y), 3.8 * u, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p.state === 'downed' ? '#ff5252' : col;
      g.beginPath();
      g.arc(X(p.x), Y(p.y), 2.7 * u, 0, Math.PI * 2);
      g.fill();
    }
    // local player arrow
    let me = null;
    for (const p of view.players || []) if (p.id === localId) me = p;
    if (me && me.state !== 'dead') {
      const px = localPos ? localPos.x : me.x, py = localPos ? localPos.y : me.y;
      const ang = localPos && Number.isFinite(localPos.angle) ? localPos.angle : me.angle;
      const r = rosterById.get(localId);
      g.save();
      g.translate(X(px), Y(py));
      g.rotate(ang);
      g.beginPath();
      g.moveTo(7 * u, 0);
      g.lineTo(-4.5 * u, 4.5 * u);
      g.lineTo(-2 * u, 0);
      g.lineTo(-4.5 * u, -4.5 * u);
      g.closePath();
      g.fillStyle = '#fff';
      g.strokeStyle = PLAYER_COLORS[r ? r.color : 0] || '#000';
      g.lineWidth = 1.5 * u;
      g.fill();
      g.stroke();
      g.restore();
    }
  }

  // ---- radar (first person) ----------------------------------------------------------------

  function drawRadar(view, localId, rosterById, localPos, yaw) {
    const k = scale;
    const cx = W / 2, cy = H / 2;
    g.fillStyle = '#0a0c0e';
    g.fillRect(0, 0, W, H);
    let me = null;
    if (view) for (const p of view.players || []) if (p.id === localId) me = p;
    // Centre: the local player (predicted), else the camera's subject, else the objective.
    const c = localPos && Number.isFinite(localPos.x) ? localPos : me || map.objective || { x: map.width / 2, y: map.height / 2 };
    const facing = Number.isFinite(yaw) ? yaw : (localPos && Number.isFinite(localPos.angle) ? localPos.angle : me ? me.angle : -Math.PI / 2);
    // World → radar: translate to the player, turn so `facing` points up (-y on screen).
    const rot = -facing - Math.PI / 2;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const rx = (x, y) => cx + ((x - c.x) * cr - (y - c.y) * sr) * k;
    const ry = (x, y) => cy + ((x - c.x) * sr + (y - c.y) * cr) * k;
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    g.translate(-c.x * k, -c.y * k);
    g.drawImage(base, 0, 0);
    g.restore();
    const zn = view && view.zone;
    if (zn) drawZone(zn, rx(zn.x, zn.y), ry(zn.x, zn.y), rx(zn.nx, zn.ny), ry(zn.nx, zn.ny), k, true);
    const cz = campMode && view ? view.campaign : null;
    if (cz) drawCampaign(cz, (x, y) => { _pt.x = rx(x, y); _pt.y = ry(x, y); return _pt; }, k, true);
    const inside = (x, y, m) => x >= m && x <= W - m && y >= m && y <= H - m;
    // Pin a point outside the window to its rim (along the ray from the centre).
    const pin = (x, y, m) => {
      const dx = x - cx, dy = y - cy;
      const sx = dx ? (W / 2 - m) / Math.abs(dx) : Infinity;
      const sy = dy ? (H / 2 - m) / Math.abs(dy) : Infinity;
      const s = Math.min(1, sx, sy);
      return { x: cx + dx * s, y: cy + dy * s };
    };
    if (view) {
      // zombies
      const zs = view.zombies || [];
      const zr = Math.max(1.2, 1.5 * u);
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        const x = rx(z.x, z.y), y = ry(z.x, z.y);
        if (!inside(x, y, 0)) continue;
        const big = z.type === 'boss' || z.type === 'brute';
        if (big) {
          g.fillStyle = z.type === 'boss' ? '#d500f9' : '#ff6d00';
          g.beginPath();
          g.arc(x, y, (z.type === 'boss' ? 5 : 3) * u, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillStyle = '#ff3b30';
          g.fillRect(x - zr, y - zr, zr * 2, zr * 2);
        }
      }
      for (const p of view.pickups || []) {
        if (p.kind !== 'crate') continue;
        const x = rx(p.x, p.y), y = ry(p.x, p.y);
        if (!inside(x, y, 0)) continue;
        g.fillStyle = '#ffd54f';
        g.fillRect(x - 2.5 * u, y - 2.5 * u, 5 * u, 5 * u);
      }
      for (const t of view.turrets || []) {
        const x = rx(t.x, t.y), y = ry(t.x, t.y);
        if (!inside(x, y, 0)) continue;
        g.fillStyle = '#90caf9';
        g.fillRect(x - 2 * u, y - 2 * u, 4 * u, 4 * u);
      }
    }
    // the campaign's circle and supply point, pinned to the rim like the objective
    if (cz) {
      let x = rx(cz.x, cz.y), y = ry(cz.x, cz.y);
      const off = !inside(x, y, 7 * u);
      if (off) ({ x, y } = pin(x, y, 7 * u));
      if (off || Math.hypot(x - cx, y - cy) > cz.r * k) {
        g.strokeStyle = '#000';
        g.lineWidth = 4 * u;
        g.beginPath();
        g.arc(x, y, 5 * u, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = cz.zip ? '#6dff9a' : '#ffd166';
        g.lineWidth = 2.2 * u;
        g.beginPath();
        g.arc(x, y, 5 * u, 0, Math.PI * 2);
        g.stroke();
      }
      let sx = rx(cz.sx, cz.sy), sy = ry(cz.sx, cz.sy);
      if (!inside(sx, sy, 5 * u)) ({ x: sx, y: sy } = pin(sx, sy, 5 * u));
      g.fillStyle = '#56d67a';
      g.fillRect(sx - 1.2 * u, sy - 4.5 * u, 2.4 * u, 9 * u);
      g.fillRect(sx - 4.5 * u, sy - 1.2 * u, 9 * u, 2.4 * u);
    }
    // the safe zone's centre and its supply drop, pinned to the rim like the objective
    if (zn) {
      let x = rx(zn.x, zn.y), y = ry(zn.x, zn.y);
      const off = !inside(x, y, 7 * u);
      if (off) ({ x, y } = pin(x, y, 7 * u));
      if (off || Math.hypot(x - cx, y - cy) > zn.r * k) {
        g.strokeStyle = '#000';
        g.lineWidth = 4 * u;
        g.beginPath();
        g.arc(x, y, 5 * u, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = '#4fe3d0';
        g.lineWidth = 2.2 * u;
        g.beginPath();
        g.arc(x, y, 5 * u, 0, Math.PI * 2);
        g.stroke();
      }
      let sx = rx(zn.sx, zn.sy), sy = ry(zn.sx, zn.sy);
      if (!inside(sx, sy, 5 * u)) ({ x: sx, y: sy } = pin(sx, sy, 5 * u));
      g.fillStyle = '#56d67a';
      g.fillRect(sx - 1.2 * u, sy - 4.5 * u, 2.4 * u, 9 * u);
      g.fillRect(sx - 4.5 * u, sy - 1.2 * u, 9 * u, 2.4 * u);
    }
    // objective + supply: pinned to the rim when out of range
    const ob = zoneMode || campMode ? null : map.objective;
    if (ob) {
      let x = rx(ob.x, ob.y), y = ry(ob.x, ob.y);
      if (!inside(x, y, 6 * u)) ({ x, y } = pin(x, y, 6 * u));
      const hurt = view && view.objective && view.objective.hp < view.objective.maxHp * 0.35;
      g.fillStyle = hurt && Math.sin(pulse * 8) > 0 ? '#ff5b4f' : '#ffc400';
      g.strokeStyle = '#000';
      g.lineWidth = 1.5 * u;
      g.beginPath();
      g.moveTo(x, y - 5 * u);
      g.lineTo(x + 5 * u, y);
      g.lineTo(x, y + 5 * u);
      g.lineTo(x - 5 * u, y);
      g.closePath();
      g.fill();
      g.stroke();
    }
    const s = campMode ? null : map.supply;
    if (s) {
      let x = rx(s.x, s.y), y = ry(s.x, s.y);
      if (!inside(x, y, 5 * u)) ({ x, y } = pin(x, y, 5 * u));
      g.fillStyle = '#56d67a';
      g.fillRect(x - 1.2 * u, y - 4.5 * u, 2.4 * u, 9 * u);
      g.fillRect(x - 4.5 * u, y - 1.2 * u, 9 * u, 2.4 * u);
    }
    // teammates (pinned so you can always find them)
    const blink = Math.sin(pulse * 10) > 0;
    if (view) {
      for (const p of view.players || []) {
        if (p.id === localId || p.state === 'dead') continue;
        if (p.state === 'downed' && !blink) continue;
        const r = rosterById.get(p.id);
        let x = rx(p.x, p.y), y = ry(p.x, p.y);
        if (!inside(x, y, 4 * u)) ({ x, y } = pin(x, y, 4 * u));
        g.fillStyle = '#000';
        g.beginPath();
        g.arc(x, y, 4 * u, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = p.state === 'downed' ? '#ff5252' : PLAYER_COLORS[r ? r.color : 0] || '#fff';
        g.beginPath();
        g.arc(x, y, 2.8 * u, 0, Math.PI * 2);
        g.fill();
      }
    }
    // view cone + the local player's arrow, always pointing up
    if (me && me.state !== 'dead') {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, H * 0.55);
      grad.addColorStop(0, 'rgba(255,255,255,0.16)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, H * 0.55, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
      g.closePath();
      g.fill();
      const r = rosterById.get(localId);
      g.beginPath();
      g.moveTo(cx, cy - 7 * u);
      g.lineTo(cx + 4.5 * u, cy + 4.5 * u);
      g.lineTo(cx, cy + 2 * u);
      g.lineTo(cx - 4.5 * u, cy + 4.5 * u);
      g.closePath();
      g.fillStyle = '#fff';
      g.strokeStyle = PLAYER_COLORS[r ? r.color : 0] || '#000';
      g.lineWidth = 1.5 * u;
      g.fill();
      g.stroke();
    }
    // north marker on the rim: world north is angle -π/2
    const na = -Math.PI / 2 + rot;
    const n = pin(cx + Math.cos(na) * W * 2, cy + Math.sin(na) * W * 2, 8 * u);
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.beginPath();
    g.arc(n.x, n.y, 7 * u, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffc400';
    g.font = `800 ${Math.round(10 * u)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', n.x, n.y + 0.5 * u);
    // frame
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = u;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  const _pt = { x: 0, y: 0 };
  const _rp = { x: 0, y: 0, a: 0 };
  /**
   * Campaign overlay: the stage's circle (pulsing green once the zip line is live), the horde
   * front with a red band over the route behind it, the stage's supply point. `at(x, y)` maps
   * a world point to screen (north-up or the rotated radar); k = screen px per world px.
   */
  function drawCampaign(c, at, k, isRadar) {
    const p0 = at(c.x, c.y);
    const cx0 = p0.x, cy0 = p0.y;
    const r = Math.max(3 * u, c.r * k);
    g.save();
    if (c.front > -1e8 && cfg.route) {
      // the horde: a red band along the route from the start of it to the front
      const total = pathLen(cfg.route);
      const to = Math.min(c.front, total);
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(220,40,30,0.32)';
      g.lineWidth = Math.max(3 * u, 520 * k);
      g.beginPath();
      const n = 24;
      const from = Math.min(0, c.front) - 900;
      for (let i = 0; i <= n; i++) {
        routePointExt(cfg.route, from + ((to - from) * i) / n, _rp);
        const q = at(_rp.x, _rp.y);
        if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y);
      }
      g.stroke();
      routePointExt(cfg.route, c.front, _rp);
      const a = _rp.a;
      const q0 = at(_rp.x - Math.sin(a) * 300, _rp.y + Math.cos(a) * 300);
      const x0 = q0.x, y0 = q0.y;
      const q1 = at(_rp.x + Math.sin(a) * 300, _rp.y - Math.cos(a) * 300);
      g.strokeStyle = '#ff4a3a';
      g.lineWidth = 2.5 * u;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(q1.x, q1.y);
      g.stroke();
    }
    if (c.zip) g.setLineDash([5 * u, 4 * u]);
    g.lineDashOffset = -pulse * 12 * u;
    g.strokeStyle = c.zip ? `rgba(109,255,154,${0.75 + 0.25 * Math.sin(pulse * 5)})` : '#ffd166';
    g.lineWidth = 2 * u;
    g.beginPath();
    g.arc(cx0, cy0, r, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    if (!isRadar) {
      const sp = at(c.sx, c.sy);
      g.fillStyle = '#56d67a';
      g.fillRect(sp.x - 1 * u, sp.y - 4 * u, 2 * u, 8 * u);
      g.fillRect(sp.x - 4 * u, sp.y - 1 * u, 8 * u, 2 * u);
    }
  }

  /**
   * The safe circle at screen (x, y) with world radius z.r (k = screen px per world px), the
   * circle it shrinks to at (nx, ny), and a tint over the blight outside while it is live.
   */
  function drawZone(z, x, y, nx, ny, k, isRadar) {
    const r = Math.max(2, z.r * k);
    if (z.stage > 0) {
      g.save();
      g.beginPath();
      g.rect(0, 0, W, H);
      g.arc(x, y, r, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(150,60,110,0.26)';
      g.fill('evenodd');
      g.restore();
    }
    g.save();
    if (z.stage === 0) {
      // announced: a pulsing dashed ring
      g.setLineDash([5 * u, 4 * u]);
      g.lineDashOffset = -pulse * 12 * u;
      g.strokeStyle = `rgba(79,227,208,${0.75 + 0.25 * Math.sin(pulse * 5)})`;
      g.lineWidth = 2.2 * u;
    } else {
      g.strokeStyle = '#4fe3d0';
      g.lineWidth = 2 * u;
    }
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    if (z.stage >= 1 && (z.nr !== z.r || nx !== x || ny !== y)) {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.2 * u;
      g.beginPath();
      g.arc(nx, ny, Math.max(2, z.nr * k), 0, Math.PI * 2);
      g.stroke();
    }
    if (!isRadar) {
      g.fillStyle = '#56d67a';
      const sx = ox + z.sx * k, sy = oy + z.sy * k;
      g.fillRect(sx - 1 * u, sy - 4 * u, 2 * u, 8 * u);
      g.fillRect(sx - 4 * u, sy - 1 * u, 8 * u, 2 * u);
    }
  }

  return {
    update,
    resize,
    /** Switch between the whole-map view and the rotating radar. */
    setRadar(on) {
      const r = !!on;
      if (r === radar) return;
      radar = r;
      W = H = 0;
      base = null;
      acc = 1;
    },
    get radar() {
      return radar;
    },
  };
}
