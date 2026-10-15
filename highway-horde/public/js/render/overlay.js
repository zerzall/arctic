// Screen-space overlays drawn on top of the lit world, in CSS pixels: name tags and hp
// bars over teammates, revive/bleedout rings, crate hints, zombie hp bars, off-screen
// arrows for teammates and the objective, the local damage vignette and the crosshair.

import { WEAPONS } from '../shared/weapons.js';
import { BLEEDOUT_TIME, INTERACT_RADIUS } from '../shared/constants.js';
import { fillRoundRect, rgba } from './util.js';

const TAU = Math.PI * 2;
const CORNERS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const FONT = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_SMALL = '700 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function createOverlay() {
  function bar(ctx, x, y, w, h, frac, color, back = 'rgba(0,0,0,0.6)') {
    ctx.fillStyle = back;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  }

  function ringProgress(ctx, x, y, r, frac, color, width) {
    ctx.lineWidth = width + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, Math.min(1, frac)));
    ctx.stroke();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx transform: CSS px (dpr applied by caller)
   * @param {object} s frame state from the renderer
   */
  function draw(ctx, s) {
    const { cssW, cssH, view, localId, time, toScreen } = s;
    const players = view ? view.players : [];
    const tmp = s.tmp;
    ctx.lineCap = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // zombie hp bars (bosses, brutes, elites and recently hit ones)
    const zb = s.zombieBars;
    for (let i = 0; i < zb.count; i++) {
      const z = view.zombies[zb.idx[i]];
      toScreen(z.x, z.y, tmp);
      const r = zb.r[i] * s.zoom;
      const big = z.type === 'boss' || z.type === 'brute';
      const w = big ? Math.min(110, r * 1.9) : Math.max(18, Math.min(40, r * 1.5));
      ctx.globalAlpha = zb.alpha[i];
      bar(ctx, tmp.x - w / 2, tmp.y - r - (big ? 14 : 9), w, big ? 4 : 2.5, z.hp, zb.elite[i] ? '#ff5a3a' : z.type === 'boss' ? '#c060ff' : '#d8403a');
    }
    ctx.globalAlpha = 1;

    // teammates: names, hp, revive + bleedout
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const info = s.info(p.id);
      toScreen(p.x, p.y, tmp);
      const sx = tmp.x, sy = tmp.y;
      if (sx < -60 || sy < -60 || sx > cssW + 60 || sy > cssH + 60) continue;
      const isLocal = p.id === localId;
      if (p.state === 'downed') {
        const frac = Math.max(0, p.bleedout / BLEEDOUT_TIME);
        const pulse = 0.6 + 0.4 * Math.sin(time * 6);
        ringProgress(ctx, sx, sy, 26 * s.zoomUi, frac, rgba('#ff4040', 0.55 + 0.45 * pulse), 3);
        ctx.font = FONT_SMALL;
        ctx.fillStyle = '#ffdddd';
        ctx.fillText(Math.ceil(p.bleedout) + 's', sx, sy + 36 * s.zoomUi);
        if (!isLocal && p.revive <= 0 && !p.reviver) {
          ctx.fillStyle = rgba('#ffffff', 0.6 + 0.4 * pulse);
          ctx.fillText('REVIVE', sx, sy - 40 * s.zoomUi);
        }
      }
      if (p.revive > 0) {
        ringProgress(ctx, sx, sy, 32 * s.zoomUi, p.revive, '#7dff9a', 4);
      }
      if (!isLocal && s.showNames && p.state !== 'dead') {
        const y = sy - 30 * s.zoomUi - 8;
        ctx.font = FONT;
        const name = info.name;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(name, sx, y - 7);
        ctx.fillStyle = info.color;
        ctx.fillText(name, sx, y - 7);
        const hpf = p.maxHp ? p.hp / p.maxHp : 0;
        bar(ctx, sx - 20, y + 2, 40, 4, hpf, hpf > 0.5 ? '#6ee06e' : hpf > 0.25 ? '#ffc040' : '#ff4a3a');
        if (p.armor > 0) bar(ctx, sx - 20, y + 8, 40, 2, p.armor / 100, '#6ab8ff', 'rgba(0,0,0,0.4)');
      }
      if (p.state === 'dead' && s.showNames && !isLocal) {
        ctx.font = FONT_SMALL;
        ctx.fillStyle = 'rgba(220,220,220,0.7)';
        ctx.fillText(info.name + (p.respawn ? ' · respawns next wave' : ''), sx, sy - 24);
      }
    }

    // crate hint rings near the local player
    const me = s.local;
    if (me && me.state === 'alive' && view) {
      for (const pk of view.pickups) {
        if (pk.kind !== 'crate') continue;
        const d = Math.hypot(pk.x - me.x, pk.y - me.y);
        if (d > INTERACT_RADIUS + 90) continue;
        toScreen(pk.x, pk.y, tmp);
        const inRange = d <= INTERACT_RADIUS;
        const pulse = 0.5 + 0.5 * Math.sin(time * 5);
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(inRange ? '#ffe08a' : '#ffffff', inRange ? 0.6 + 0.4 * pulse : 0.35);
        ctx.beginPath();
        ctx.arc(tmp.x, tmp.y, (26 + pulse * 3) * s.zoomUi, 0, TAU);
        ctx.stroke();
        const bx = tmp.x, by = tmp.y - 38 * s.zoomUi;
        fillRoundRect(ctx, bx - 10, by - 10, 20, 20, 4, inRange ? '#ffe08a' : 'rgba(255,255,255,0.5)');
        ctx.fillStyle = '#1a1a1a';
        ctx.font = '800 12px system-ui, sans-serif';
        ctx.fillText('E', bx, by + 0.5);
        const w = WEAPONS[pk.weapon];
        if (w && inRange) {
          ctx.font = FONT;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.strokeText(w.name, bx, by - 18);
          ctx.fillStyle = '#ffe9b0';
          ctx.fillText(w.name, bx, by - 18);
        }
      }
    }

    // off-screen arrows: teammates and the objective
    const margin = 28;
    const cx = cssW / 2, cy = cssH / 2;
    const arrow = (wx, wy, color, label, icon) => {
      toScreen(wx, wy, tmp);
      if (tmp.x > margin && tmp.y > margin && tmp.x < cssW - margin && tmp.y < cssH - margin) return;
      const dx = tmp.x - cx, dy = tmp.y - cy;
      const a = Math.atan2(dy, dx);
      const kx = (cssW / 2 - margin) / Math.max(1e-6, Math.abs(dx));
      const ky = (cssH / 2 - margin) / Math.max(1e-6, Math.abs(dy));
      const k = Math.min(kx, ky);
      const ax = cx + dx * k, ay = cy + dy * k;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(-8, -11); ctx.lineTo(-4, 0); ctx.lineTo(-8, 11); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(11, 0); ctx.lineTo(-6, -8); ctx.lineTo(-3, 0); ctx.lineTo(-6, 8); ctx.closePath();
      ctx.fill();
      ctx.restore();
      const lx = ax - Math.cos(a) * 22, ly = ay - Math.sin(a) * 22;
      ctx.font = FONT_SMALL;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const text = icon || label;
      ctx.strokeText(text, lx, ly);
      ctx.fillStyle = color;
      ctx.fillText(text, lx, ly);
    };
    if (view) {
      for (const p of players) {
        if (p.id === localId || p.state === 'dead') continue;
        const info = s.info(p.id);
        arrow(p.x, p.y, p.state === 'downed' ? '#ff5a4a' : info.color, info.name.slice(0, 8), p.state === 'downed' ? '✚ ' + info.name.slice(0, 6) : null);
      }
      if (s.objective && view.objective) {
        const hp = view.objective.maxHp ? view.objective.hp / view.objective.maxHp : 1;
        arrow(s.objective.x, s.objective.y, hp < 0.35 ? '#ff6a4a' : '#ffd24a', null, '★ ' + Math.round(hp * 100) + '%');
      }
    }

    // damage vignette + low-hp pulse for the local player
    if (me && me.state !== 'dead') {
      const hpf = me.maxHp ? me.hp / me.maxHp : 1;
      let a = s.damagePulse * 0.55;
      if (hpf < 0.35 || me.state === 'downed') {
        const beat = Math.pow(Math.max(0, Math.sin(time * (me.state === 'downed' ? 3.2 : 4.2))), 6);
        a += (me.state === 'downed' ? 0.45 : (0.35 - hpf) * 1.3) * (0.55 + 0.45 * beat);
      }
      if (a > 0.01) {
        ctx.globalAlpha = Math.min(0.9, a);
        ctx.fillStyle = getRedVignette(ctx, cssW, cssH);
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.globalAlpha = 1;
      }
    }

    drawCrosshair(ctx, s);
  }

  let redV = null, redKey = '';
  function getRedVignette(ctx, w, h) {
    const key = w + 'x' + h;
    if (redV && redKey === key) return redV;
    const r = Math.hypot(w, h) / 2;
    const grad = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
    grad.addColorStop(0, 'rgba(120,0,0,0)');
    grad.addColorStop(0.7, 'rgba(150,0,0,0.45)');
    grad.addColorStop(1, 'rgba(90,0,0,0.95)');
    redV = grad;
    redKey = key;
    return grad;
  }

  function drawCrosshair(ctx, s) {
    const c = s.cursor;
    if (!c) return;
    const me = s.local;
    const x = c.x, y = c.y;
    if (!me || me.state === 'dead') {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, TAU);
      ctx.fill();
      return;
    }
    const wid = me.slots ? me.slots[me.slot] : null;
    const w = WEAPONS[wid];
    const spread = w ? w.spread : 0.05;
    // gap follows the real spread cone at the cursor distance, plus recoil bloom
    const distPx = s.cursorDist;
    const gap = Math.max(5, Math.min(90, Math.tan(spread) * distPx + 4 + s.bloom * 10));
    const len = 7;
    const col = me.reloading > 0 ? '#ffc86a' : '#ffffff';
    ctx.lineCap = 'butt';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? col : 'rgba(0,0,0,0.7)';
      ctx.lineWidth = pass ? 2 : 4;
      ctx.beginPath();
      ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
      ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
      ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.fillRect(x - 1, y - 1, 2, 2);
    // reload arc
    if (me.reloading > 0) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, gap + len + 7, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = '#ffc86a';
      ctx.beginPath();
      ctx.arc(x, y, gap + len + 7, -Math.PI / 2, -Math.PI / 2 + TAU * me.reloading);
      ctx.stroke();
    } else if (me.ammo && me.ammo[me.slot] && w && w.mag > 0) {
      // low-magazine warning
      const mag = me.ammo[me.slot][0];
      if (mag <= Math.max(1, Math.floor(w.mag * 0.25))) {
        ctx.font = FONT_SMALL;
        ctx.textAlign = 'center';
        ctx.fillStyle = mag === 0 ? '#ff5a4a' : '#ffc86a';
        ctx.fillText(mag === 0 ? 'RELOAD' : String(mag), x, y + gap + len + 12);
      }
    }
    // hit marker (and red kill marker)
    const hm = Math.max(s.hitMarker, s.killMarker);
    if (hm > 0.02) {
      const kill = s.killMarker > 0.02;
      const r0 = 6 + (1 - hm) * 3, r1 = r0 + 7;
      ctx.globalAlpha = Math.min(1, hm * 1.5);
      ctx.strokeStyle = kill ? '#ff4a3a' : '#ffffff';
      ctx.lineWidth = kill ? 2.6 : 2;
      ctx.beginPath();
      for (const [sx, sy] of CORNERS) {
        ctx.moveTo(x + sx * r0 * 0.7, y + sy * r0 * 0.7);
        ctx.lineTo(x + sx * r1 * 0.7, y + sy * r1 * 0.7);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  return { draw };
}
