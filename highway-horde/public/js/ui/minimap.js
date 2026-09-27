// HUD minimap: the map's static layout is painted once into an offscreen canvas; each
// refresh only blits it and draws dots for zombies, pickups, teammates and the local
// player's arrow. Redrawn at MINIMAP_HZ rather than every frame.

import { PLAYER_COLORS } from '../shared/constants.js';

const MINIMAP_HZ = 20;
const AREA_COLORS = {
  asphalt: '#2a2d31', concrete: '#383b3e', grass: '#1c2819', dirt: '#302619',
  gravel: '#33312c', sand: '#463e2e', water: '#10304a',
};
const TALL = new Set(['building', 'wall', 'container', 'semi', 'bus', 'tanker', 'truck', 'booth', 'pillar', 'hesco']);

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
 */
export function createMinimap(canvas, map) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  let base = null;
  let acc = 1;
  let pulse = 0;

  function paintBase() {
    base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    const b = base.getContext('2d');
    b.fillStyle = '#0a0c0e';
    b.fillRect(0, 0, W, H);
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
    // zombie spawn zones, faint
    b.fillStyle = 'rgba(210,40,40,0.16)';
    for (const z of map.zombieSpawns || []) b.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
    const ob = map.objective;
    if (ob) {
      b.fillStyle = 'rgba(255,196,0,0.35)';
      rotRect(b, ob.x, ob.y, ob.w, ob.h, ob.a);
      b.strokeStyle = '#ffc400';
      b.lineWidth = 2 / scale * dpr;
      b.save();
      b.translate(ob.x, ob.y);
      if (ob.a) b.rotate(ob.a);
      b.strokeRect(-ob.w / 2, -ob.h / 2, ob.w, ob.h);
      b.restore();
    }
    b.restore();
    // map border
    b.strokeStyle = 'rgba(255,255,255,0.18)';
    b.lineWidth = dpr;
    b.strokeRect(ox + 0.5, oy + 0.5, map.width * scale - 1, map.height * scale - 1);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const cw = Math.max(40, Math.round(r.width)), ch = Math.max(30, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const nw = Math.round(cw * dpr), nh = Math.round(ch * dpr);
    if (nw === W && nh === H && base) return;
    W = canvas.width = nw;
    H = canvas.height = nh;
    scale = Math.min(W / map.width, H / map.height);
    ox = (W - map.width * scale) / 2;
    oy = (H - map.height * scale) / 2;
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
  function update(view, localId, rosterById, dt, localPos) {
    acc += dt;
    pulse += dt;
    if (acc < 1 / MINIMAP_HZ) return;
    acc = 0;
    if (!base || W === 0) resize();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(base, 0, 0);
    if (!view) return;
    const k = scale;
    const X = (x) => ox + x * k;
    const Y = (y) => oy + y * k;
    const u = dpr;

    // supply station
    const s = map.supply;
    if (s) {
      g.fillStyle = '#56d67a';
      const sx = X(s.x), sy = Y(s.y);
      g.fillRect(sx - 1 * u, sy - 4 * u, 2 * u, 8 * u);
      g.fillRect(sx - 4 * u, sy - 1 * u, 8 * u, 2 * u);
    }
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

  return { update, resize };
}
