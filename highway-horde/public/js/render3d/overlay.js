// 2D overlay of the first-person view (ACTORS, SPEC §7.5), drawn every frame into
// ctx.overlay (CSS px; renderer3d clears it and sets the DPR transform before the
// sub-systems update): centre crosshair whose gap follows the held gun's spread (+ shot
// bloom, reload arc), hit marker (confirmed hits: echo shots on clients, the host's own
// shots, tesla/melee hits) and kill marker (zdie by the local player), name tags + hp bars
// over teammates (settings.showNames), revive rings + bleedout timers over downed
// teammates, damage-direction arcs from 'pdamage', pointers on a ring around the crosshair
// toward off-screen downed teammates and the objective while it is under attack (the
// compass and radar already show everything else), a pulsing low-hp vignette and a red
// tint while downed. settings.crosshair === false (a menu covers the view) hides the
// crosshair and markers. Everything is sized by `ui` = settings.uiScale (the UI passes it
// every frame: ~1.08 at 1080p, 1.44 at 1440p, 2.16 at 4K, 1 on touch; 1 when absent), so
// on a large PC screen the crosshair, tags and markers keep their on-screen proportions
// instead of shrinking to hairlines; the canvas is drawn at the device pixel ratio, so
// they stay crisp.

import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_COLORS, BLEEDOUT_TIME } from '../shared/constants.js';
import { angleDiff } from './actor-kit.js';

const TAU = Math.PI * 2;
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TAG_H = 74;          // name tag height above a standing teammate's feet (world units)

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createOverlay3D(ctx) {
  const g = ctx.overlay;
  let localId = 0;
  let hitT = 9, killT = 9, hitHeavy = 0, bloom = 0, dmgPulse = 0, now = 0;
  let objHitAt = -99;         // frame.now of the last 'objhit' (the objective pointer shows a while)
  const arcs = [];            // { a (world angle from the player to the source), age, amount }
  let lastLocal = null;
  // UI scale and fonts for the current viewport (see header)
  let ui = 1, FONT = '', FONT_SMALL = '', fontFor = 0;
  function setScale(settings) {
    const k = Number(settings && settings.uiScale);
    ui = Number.isFinite(k) && k > 0 ? Math.max(0.5, Math.min(4, k)) : 1;
    if (ui !== fontFor) {
      fontFor = ui;
      FONT = `600 ${Math.round(12 * ui)}px ${FONT_FAMILY}`;
      FONT_SMALL = `700 ${Math.round(10 * ui)}px ${FONT_FAMILY}`;
    }
  }

  function size() {
    const c = g.canvas;
    const w = c.clientWidth || parseFloat(c.style.width) || c.width;
    const h = c.clientHeight || parseFloat(c.style.height) || c.height;
    return { w, h };
  }

  function addEvents(events, opts) {
    if (opts && opts.localId != null) localId = opts.localId;
    if (!events || !localId) return;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      switch (e.type) {
        case 'shot': {
          if (e.pid !== localId) break;
          const w = WEAPONS[e.weapon];
          if (!e.echo && w) bloom = Math.min(1, bloom + w.recoil * 0.9 + 0.1);
          // predicted hits are guesses: the echo (client) or the plain host event confirms
          if (e.predicted) break;
          const rays = e.rays || [];
          let n = 0;
          for (const r of rays) if (r && r.hit === 1) n++;
          if (n) { hitT = 0; hitHeavy = Math.min(1, n / 4 + (w && w.damage > 80 ? 0.5 : 0)); }
          break;
        }
        case 'chain':
          if (e.pid === localId && (e.points || []).length > 1) { hitT = 0; hitHeavy = 0.3; }
          break;
        case 'melee':
          if (e.pid === localId && e.hits > 0) { hitT = 0; hitHeavy = 0.6; }
          break;
        case 'zdie':
          if (e.by && e.by === localId) killT = 0;
          break;
        case 'objhit':
          objHitAt = now;
          break;
        case 'pdamage':
          if (e.pid === localId) {
            arcs.push({ x: e.x, y: e.y, age: 0, amount: e.amount || 10 });
            if (arcs.length > 8) arcs.shift();
            dmgPulse = Math.min(1, dmgPulse + 0.3 + (e.amount || 0) / 50);
          }
          break;
        default:
          break;
      }
    }
  }

  function update(view, frame) {
    const dt = Math.min(0.1, frame.dt || 0);
    now = frame.now || 0;
    localId = frame.localId || localId;
    const local = frame.local;
    lastLocal = local;
    const { w: W, h: H } = size();
    if (!(W > 0 && H > 0)) return;
    const settings = frame.settings || {};
    setScale(settings);
    const yaw = frame.yaw || 0;
    hitT += dt; killT += dt;
    bloom = Math.max(0, bloom - dt * 2.2);
    dmgPulse = Math.max(0, dmgPulse - dt * 1.6);
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    screenTint(local, W, H);
    teammates(view, frame, W, H, settings, yaw);
    objectiveArrow(view, frame, W, H, yaw);
    damageArcs(local, dt, W, H, yaw);
    if (settings.crosshair !== false) crosshair(local, W, H);
    g.restore();
  }

  // ---- crosshair ------------------------------------------------------------------------
  function crosshair(local, W, H) {
    if (!local || local.state === 'dead') return;
    const cx = W / 2, cy = H / 2;
    let wid = local.slots ? local.slots[local.slot] : null;
    if (local.state === 'downed') wid = 'pistol';
    const w = WEAPONS[wid];
    const fovY = ((ctx.camera && ctx.camera.fov) || 80) * Math.PI / 180;
    const pxPerRad = (H / 2) / Math.tan(fovY / 2);
    const spread = w ? w.spread : 0.05;
    const sprint = local.sprinting ? 1 : 0;
    // The gap follows the gun's real spread, capped: a shotgun's full cone is a ~140 px
    // ring at 1600x900 that frames half the target instead of pointing at it.
    const gap = Math.min(H * 0.075, Math.max(5 * ui, Math.tan(spread) * pxPerRad * 0.9)) + (bloom * 14 + sprint * 10) * ui;
    const len = 7 * ui;
    const alpha = sprint ? 0.35 : 0.95;
    const reloading = local.reloading > 0;
    g.globalAlpha = alpha;
    // dark outline under a white core so it reads on bright fire and dark sky alike
    for (const pass of [0, 1]) {
      g.strokeStyle = pass ? '#ffffff' : 'rgba(0,0,0,0.75)';
      g.lineWidth = (pass ? 2 : 4) * ui;
      g.beginPath();
      if (w && w.category === 'shotgun') {
        // four short arcs: reads as a spread ring without a heavy circle over the target
        for (let q = 0; q < 4; q++) {
          const a0 = q * Math.PI / 2 + Math.PI / 4 - 0.32;
          g.moveTo(cx + Math.cos(a0) * (gap + 2), cy + Math.sin(a0) * (gap + 2));
          g.arc(cx, cy, gap + 2, a0, a0 + 0.64);
        }
      } else {
        g.moveTo(cx - gap - len, cy); g.lineTo(cx - gap, cy);
        g.moveTo(cx + gap, cy); g.lineTo(cx + gap + len, cy);
        g.moveTo(cx, cy + gap); g.lineTo(cx, cy + gap + len);
        if (!(w && w.category === 'sniper')) { g.moveTo(cx, cy - gap - len); g.lineTo(cx, cy - gap); }
      }
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(cx - ui, cy - ui, 2 * ui, 2 * ui);
    if (reloading) {
      const r = gap + len + 8 * ui;
      g.lineWidth = 4 * ui;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
      g.lineWidth = 2.5 * ui;
      g.strokeStyle = '#ffd54f';
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, local.reloading)); g.stroke();
    }
    g.globalAlpha = 1;
    // hit marker: white X; kill marker: bigger red X that punches in
    if (hitT < 0.22) {
      const k = 1 - hitT / 0.22;
      const s = (7 + hitHeavy * 4) * ui, o = gap * 0.5 + 5 * ui;
      g.globalAlpha = k;
      xMark(cx, cy, o, s, '#ffffff', 2.2 * ui);
      g.globalAlpha = 1;
    }
    if (killT < 0.45) {
      const k = 1 - killT / 0.45;
      const pop = 1 + Math.max(0, 0.12 - killT) * 4;
      g.globalAlpha = Math.min(1, k * 1.4);
      xMark(cx, cy, (gap * 0.5 + 8 * ui) * pop, 11 * ui * pop, '#ff3b30', 3.2 * ui);
      g.globalAlpha = 1;
    }
  }

  function xMark(cx, cy, o, s, color, lw) {
    for (const pass of [0, 1]) {
      g.strokeStyle = pass ? color : 'rgba(0,0,0,0.7)';
      g.lineWidth = pass ? lw : lw + 2 * ui;
      g.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        g.moveTo(cx + sx * o, cy + sy * o);
        g.lineTo(cx + sx * (o + s), cy + sy * (o + s));
      }
      g.stroke();
    }
  }

  // ---- teammates ---------------------------------------------------------------------------
  function teammates(view, frame, W, H, settings, yaw) {
    const players = (view && view.players) || [];
    const roster = frame.roster || [];
    const camX = frame.camX, camY = frame.camY;
    g.font = FONT;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (let k = 0; k < players.length; k++) {
      const p = players[k];
      if (p.id === localId || p.state === 'dead') continue;
      const r = roster.find((q) => q.id === p.id);
      const color = PLAYER_COLORS[(r ? r.color : p.id - 1) % PLAYER_COLORS.length] || '#ffffff';
      const name = r ? r.name : 'P' + p.id;
      const dist = Math.hypot(p.x - camX, p.y - camY);
      const downed = p.state === 'downed';
      const s = ctx.project(p.x, p.y, (downed ? 30 : TAG_H) + (p.z > 0 ? p.z : 0));
      if (!s.visible) {
        // only a downed teammate earns a pointer: the compass and radar show the rest
        if (downed) edgeArrow(p.x, p.y, frame, W, H, yaw, color, '✚ ' + name, true);
        continue;
      }
      // fade out far away, and right next to the camera too: a teammate at your shoulder
      // projects their tag to the screen corner, over the HUD panels
      // and toward the left/right edges, where the HUD columns sit (the compass still
      // shows where they are)
      const edge = Math.min(s.x, W - s.x) / W;
      const fade = Math.max(0, Math.min(1, (1700 - dist) / 400, (dist - 70) / 90, (edge - 0.13) / 0.08));
      if (fade <= 0 && !downed) continue;
      g.globalAlpha = downed ? 1 : fade;
      // tag scale: a little larger up close, smaller far off (clamped, so it stays readable)
      const ts = Math.max(0.78, Math.min(1.15, 1.25 - dist / 1600));
      const bw = 44 * ui * ts, bh = 5 * ui * ts;
      const f = Math.max(0, Math.min(1, p.hp / (p.maxHp || 100)));
      if (settings.showNames !== false) {
        // a pill: class badge in the player's colour, then the name
        const cls = r && r.cls ? r.cls : 'soldier';
        g.font = FONT;
        const nw = g.measureText(name).width;
        const bad = 9 * ui * ts;                    // badge radius
        const pw = nw + bad * 2 + 14 * ui * ts, ph = 17 * ui * ts;
        const px = s.x - pw / 2, py = s.y - 11 * ui * ts - ph;
        g.fillStyle = 'rgba(8,10,14,0.66)';
        roundRect(g, px, py, pw, ph, ph / 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.lineWidth = 1 * ui;
        g.stroke();
        classBadge(g, cls, px + ph / 2, py + ph / 2, bad, color);
        g.textAlign = 'left';
        g.lineWidth = 3 * ui;
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.strokeText(name, px + ph / 2 + bad + 4 * ui * ts, py + ph - 4.2 * ui * ts);
        g.fillStyle = '#f4f6f8';
        g.fillText(name, px + ph / 2 + bad + 4 * ui * ts, py + ph - 4.2 * ui * ts);
        g.textAlign = 'center';
      }
      // hp bar: rounded, quartered, green to red; armour as a thin blue strip on top
      g.fillStyle = 'rgba(0,0,0,0.7)';
      roundRect(g, s.x - bw / 2 - ui, s.y - 5 * ui * ts - ui, bw + 2 * ui, bh + 2 * ui, bh / 2 + ui);
      g.fill();
      g.fillStyle = f > 0.5 ? '#7dff9a' : f > 0.25 ? '#ffd54f' : '#ff5252';
      if (f > 0) { roundRect(g, s.x - bw / 2, s.y - 5 * ui * ts, Math.max(bh, bw * f), bh, bh / 2); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.45)';
      for (let q = 1; q < 4; q++) g.fillRect(s.x - bw / 2 + bw * q / 4 - 0.5 * ui, s.y - 5 * ui * ts, ui, bh);
      if (p.armor > 0) {
        g.fillStyle = '#64b5f6';
        g.fillRect(s.x - bw / 2, s.y - 8 * ui * ts, bw * Math.min(1, p.armor / 100), 2 * ui * ts);
      }
      if (downed) reviveRing(p, s.x, s.y + 26 * ui);
      g.globalAlpha = 1;
    }
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /** A round badge in the player's colour with the class emblem (chevron, cross, gear, bolt, bomb, shield). */
  function classBadge(c, cls, x, y, r, color) {
    c.fillStyle = color;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 1.2 * ui;
    c.stroke();
    c.fillStyle = 'rgba(10,12,16,0.92)';
    c.strokeStyle = 'rgba(10,12,16,0.92)';
    c.lineWidth = 1.6 * ui;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const k = r * 0.55;
    c.beginPath();
    if (cls === 'medic') {
      c.rect(x - k * 0.28, y - k, k * 0.56, k * 2); c.rect(x - k, y - k * 0.28, k * 2, k * 0.56); c.fill();
    } else if (cls === 'engineer') {
      c.arc(x, y, k * 0.62, 0, TAU); c.moveTo(x - k, y); c.lineTo(x + k, y); c.moveTo(x, y - k); c.lineTo(x, y + k); c.stroke();
    } else if (cls === 'scout') {
      c.moveTo(x - k, y + k * 0.7); c.lineTo(x, y - k); c.lineTo(x + k, y + k * 0.7); c.lineTo(x, y + k * 0.25); c.closePath(); c.fill();
    } else if (cls === 'demo') {
      c.arc(x - k * 0.1, y + k * 0.15, k * 0.75, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(x + k * 0.4, y - k * 0.5); c.lineTo(x + k * 0.9, y - k); c.stroke();
    } else if (cls === 'heavy') {
      c.moveTo(x - k, y - k); c.lineTo(x + k, y - k); c.lineTo(x + k, y + k * 0.1); c.lineTo(x, y + k); c.lineTo(x - k, y + k * 0.1); c.closePath(); c.fill();
    } else {
      c.moveTo(x - k, y + k * 0.2); c.lineTo(x, y - k * 0.6); c.lineTo(x + k, y + k * 0.2); c.moveTo(x - k, y + k * 0.9); c.lineTo(x, y + k * 0.1); c.lineTo(x + k, y + k * 0.9); c.stroke();
    }
  }

  function reviveRing(p, x, y) {
    const pulse = 0.6 + Math.sin(now * 6) * 0.4;
    const R = 16 * ui;
    g.lineWidth = 4 * ui;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
    // bleedout drains the red ring; revive progress fills green over it
    const bleed = Math.max(0, Math.min(1, (p.bleedout || 0) / BLEEDOUT_TIME));
    g.strokeStyle = `rgba(255,70,60,${0.5 + pulse * 0.5})`;
    g.lineWidth = 3 * ui;
    g.beginPath(); g.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + TAU * bleed); g.stroke();
    if (p.revive > 0) {
      g.strokeStyle = '#7dff9a';
      g.lineWidth = 4 * ui;
      g.beginPath(); g.arc(x, y, R + 5 * ui, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, p.revive)); g.stroke();
    }
    g.fillStyle = '#ff5252';
    g.fillRect(x - 2 * ui, y - 7 * ui, 4 * ui, 14 * ui);
    g.fillRect(x - 7 * ui, y - 2 * ui, 14 * ui, 4 * ui);
    g.font = FONT_SMALL;
    g.textBaseline = 'top';
    g.lineWidth = 3 * ui;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    const txt = p.revive > 0 ? 'REVIVING' : Math.ceil(p.bleedout || 0) + 's';
    g.strokeText(txt, x, y + R + 4 * ui);
    g.fillStyle = p.revive > 0 ? '#7dff9a' : '#ffb4ae';
    g.fillText(txt, x, y + R + 4 * ui);
    g.font = FONT;
    g.textBaseline = 'bottom';
  }

  /**
   * Pointer toward an off-screen world point, on a ring around the crosshair: never at the
   * screen edges, where the HUD panels live, and never at the bottom centre over the gun
   * and the prompts (things behind the player point from the lower sides).
   */
  function edgeArrow(x, y, frame, W, H, yaw, color, label, urgent) {
    const a = Math.atan2(y - frame.camY, x - frame.camX);
    let rel = angleDiff(yaw, a);                 // 0 = straight ahead, +π/2 = to the right
    // squeeze "behind" into the lower sides: ±2.2 rad at most from straight up
    const lim = 2.2;
    if (Math.abs(rel) > lim) rel = Math.sign(rel || 1) * lim;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.3;
    const dx = Math.sin(rel), dy = -Math.cos(rel);
    const px = cx + dx * R * Math.min(1.5, W / H), py = cy + dy * R;
    const pulse = urgent ? 0.75 + Math.sin(now * 8) * 0.25 : 1;
    g.save();
    g.translate(px, py);
    g.rotate(Math.atan2(dy, dx));
    g.globalAlpha = pulse;
    g.scale(ui, ui);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -10); g.lineTo(-4, 0); g.lineTo(-8, 10); g.closePath(); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-6, -7); g.lineTo(-3, 0); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.restore();
    if (label) {
      const d = Math.round(Math.hypot(x - frame.camX, y - frame.camY) / 32);
      g.font = FONT_SMALL;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const lx = px - dx * 24 * ui, ly = py - dy * 20 * ui;
      g.lineWidth = 3 * ui;
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.strokeText(label + ' ' + d + 'm', lx, ly);
      g.fillStyle = color;
      g.globalAlpha = pulse;
      g.fillText(label + ' ' + d + 'm', lx, ly);
      g.globalAlpha = 1;
      g.font = FONT;
      g.textBaseline = 'bottom';
    }
  }

  function objectiveArrow(view, frame, W, H, yaw) {
    const ob = ctx.map && ctx.map.objective;
    if (!ob || !view || !view.objective) return;
    const s = ctx.project(ob.x, ob.y, 60);
    const hp = view.objective.maxHp ? view.objective.hp / view.objective.maxHp : 1;
    const color = hp < 0.3 ? '#ff5252' : '#ffd54f';
    // only while it is being hit (or nearly lost): the compass always shows where it is
    const attacked = now - objHitAt < 4 || hp < 0.3;
    if (!s.visible && attacked) {
      edgeArrow(ob.x, ob.y, frame, W, H, yaw, color, (ob.name || 'Objective') + ' under attack', true);
    }
  }

  // ---- damage feedback ---------------------------------------------------------------------
  function damageArcs(local, dt, W, H, yaw) {
    if (!arcs.length) return;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.22;
    let w = 0;
    for (let k = 0; k < arcs.length; k++) {
      const a = arcs[k];
      a.age += dt;
      if (a.age > 1.2) continue;
      arcs[w++] = a;
      const px = local ? local.x : a.x, py = local ? local.y : a.y;
      const dir = Math.atan2(a.y - py, a.x - px);
      const rel = angleDiff(yaw, dir);
      const k2 = 1 - a.age / 1.2;
      const span = 0.35 + Math.min(0.4, a.amount / 60);
      const ang = rel - Math.PI / 2;           // screen angle (0 = right, -π/2 = up/ahead)
      g.globalAlpha = k2;
      g.lineWidth = 10 * ui;
      g.strokeStyle = 'rgba(40,0,0,0.5)';
      g.beginPath(); g.arc(cx, cy, R, ang - span, ang + span); g.stroke();
      g.lineWidth = 6 * ui;
      g.strokeStyle = '#ff3b30';
      g.beginPath(); g.arc(cx, cy, R, ang - span, ang + span); g.stroke();
      g.globalAlpha = 1;
    }
    arcs.length = w;
  }

  function screenTint(local, W, H) {
    if (!local || local.state === 'dead') return;
    const hp = Math.max(0, Math.min(1, local.hp / (local.maxHp || 100)));
    const downed = local.state === 'downed';
    const low = downed ? 1 : Math.max(0, (0.4 - hp) / 0.4);
    const beat = Math.pow(Math.max(0, Math.sin(now * (downed ? 4 : 5.5))), 6);
    const k = Math.min(1, low * (0.55 + beat * 0.35) + dmgPulse * 0.6);
    if (k > 0.01) {
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
      gr.addColorStop(0, 'rgba(120,0,0,0)');
      gr.addColorStop(1, `rgba(150,0,0,${0.75 * k})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    if (downed) {
      g.fillStyle = 'rgba(110,0,0,0.22)';
      g.fillRect(0, 0, W, H);
    }
  }

  return {
    update,
    addEvents,
    dispose() {},
    /** Test hook. */
    get state() { return { hitT, killT, arcs: arcs.length, bloom, local: !!lastLocal }; },
  };
}

export { createOverlay3D as createOverlay };
