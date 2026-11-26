// The Road to Haven story layer of the classic top-down view (STORY.md §5, SPEC §7.1):
//   drawGround   story items on the ground (fuel cans, parts, notes ...) and the hold-to-use
//                devices (a small housing with a lamp, a ring that fills while somebody holds E)
//   drawWorld    (after the lighting: additive) soft glows and rings for the objective markers
//   drawScreen   the marker icons with distances, pinned to the screen edge with an arrow when
//                off screen; the NPCs' name tags and prompts (npcs2d.js)

import { itemInfo, MARKER_COLORS } from '../shared/story-defs.js';
import { createNpcs2D } from './npcs2d.js';
import { fillCircle, fillEllipse, rgba } from './util.js';

const TAU = Math.PI * 2;
const PX_PER_M = 32;
const STATIONS = new Set(['board', 'workbench', 'armory', 'infirmary', 'upgrades', 'bed', 'range', 'campfire']);

/** One item icon lying on the ground (size ~ 10-14 px), centred at the origin. */
function drawItem(g, info, t) {
  const c = info.color;
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  switch (info.shape) {
    case 'can':
      fillCircle(g, 0, 0, 5.6, c);
      g.stroke();
      fillCircle(g, 1.5, -1.5, 2, '#222');
      break;
    case 'box':
    case 'case':
      g.fillStyle = c;
      g.fillRect(-7, -5.2, 14, 10.4);
      g.strokeRect(-7, -5.2, 14, 10.4);
      g.fillStyle = info.mark || '#444';
      g.fillRect(-1, -4, 2, 8);
      g.fillRect(-4, -1, 8, 2);
      break;
    case 'part':
      g.fillStyle = '#1c3a34';
      g.fillRect(-6, -4, 12, 8);
      g.strokeRect(-6, -4, 12, 8);
      g.fillStyle = c;
      g.fillRect(-2, -2.4, 4, 4.8);
      break;
    case 'note':
      g.save();
      g.rotate(0.3);
      g.fillStyle = '#f4ecd0';
      g.fillRect(-5, -6.5, 10, 13);
      g.strokeRect(-5, -6.5, 10, 13);
      g.fillStyle = '#4a4a4a';
      for (let k = -4; k <= 3; k += 3) g.fillRect(-3.4, k, 6.8, 1);
      g.restore();
      break;
    case 'sack':
      fillEllipse(g, 0, 1, 6.6, 5.6, c);
      g.stroke();
      fillCircle(g, 0, -4.5, 2.2, c);
      break;
    case 'tape':
      g.fillStyle = '#4a4a52';
      g.fillRect(-6, -4, 12, 8);
      g.strokeRect(-6, -4, 12, 8);
      fillCircle(g, -2.4, 0, 1.8, '#d0d0d0');
      fillCircle(g, 2.4, 0, 1.8, '#d0d0d0');
      break;
    case 'tag':
      fillEllipse(g, 0, 0, 4.4, 3, c);
      g.stroke();
      break;
    case 'pump':
      fillCircle(g, 0, 0, 6, c);
      g.stroke();
      fillCircle(g, 0, 0, 2.6, '#556');
      break;
    default:
      g.fillStyle = c;
      g.fillRect(-6, -5, 12, 10);
      g.strokeRect(-6, -5, 12, 10);
  }
  void t;
}

/** A device housing seen from above with its lamp. */
function drawDevice(g, it, lamp) {
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  const hull = (w, h, c) => {
    g.fillStyle = c;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeRect(-w / 2, -h / 2, w, h);
  };
  switch (it.kind) {
    case 'generator': hull(26, 16, '#b8901e'); fillCircle(g, -7, 0, 3.6, '#22252a'); break;
    case 'terminal': hull(14, 16, '#3a3f46'); g.fillStyle = lamp; g.fillRect(-2, -6, 3, 12); break;
    case 'beacon': fillCircle(g, 0, 0, 5, '#22252a'); break;
    case 'repair': hull(18, 10, '#a33228'); break;
    case 'radio': hull(16, 10, '#4a5238'); g.strokeStyle = '#22252a'; g.beginPath(); g.moveTo(-4, -3); g.lineTo(-10, -9); g.stroke(); break;
    case 'switch': hull(8, 14, '#3a3f46'); break;
    case 'valve': fillCircle(g, 0, 0, 7, '#b84a2a'); fillCircle(g, 0, 0, 3.4, '#6a6f75'); break;
    case 'winch': hull(22, 14, '#555a60'); fillCircle(g, 0, 0, 5, '#c8b060'); break;
    case 'pump': fillCircle(g, 0, 0, 7, '#3a78a0'); break;
    case 'cache': hull(20, 14, '#6a5a38'); break;
    case 'door': hull(6, 26, '#22252a'); break;
    default: fillCircle(g, 0, 0, 4, '#3a3f46');
  }
  fillCircle(g, 0, it.kind === 'terminal' ? 0 : -1, 2.2, lamp);
}

/**
 * @param {object} map MapDef
 */
export function createStory2D(map) {
  const npcs = createNpcs2D();
  void map;

  function drawGround(g, view, rect, time, dt) {
    const st = view && view.story;
    // devices and stations
    for (const it of (view && view.interactables) || []) {
      if (it.x < rect.x0 - 80 || it.x > rect.x1 + 80 || it.y < rect.y0 - 80 || it.y > rect.y1 + 80) continue;
      if (!it.on && !it.done) continue;
      const live = it.on && !it.done;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + it.id);
      const rad = Math.max(22, Math.min(64, it.r * 0.55));
      g.save();
      g.translate(it.x, it.y);
      g.strokeStyle = it.done ? 'rgba(127,220,90,0.55)' : rgba('#6ee7b7', live ? 0.35 + pulse * 0.4 : 0.3);
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, rad, 0, TAU); g.stroke();
      if (it.prog > 0) {
        g.fillStyle = 'rgba(110,231,183,0.18)';
        g.beginPath(); g.arc(0, 0, rad * 0.9 * Math.max(0.02, it.prog), 0, TAU); g.fill();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 3;
        g.beginPath(); g.arc(0, 0, rad + 4, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, it.prog)); g.stroke();
      }
      if (!STATIONS.has(it.kind)) drawDevice(g, it, it.done ? '#5cff8a' : live ? (pulse > 0.5 ? '#ffb03a' : '#c9832a') : '#2a2c30');
      g.restore();
    }
    // items
    if (st && st.items) {
      for (const it of st.items) {
        if (it.x < rect.x0 - 40 || it.x > rect.x1 + 40 || it.y < rect.y0 - 40 || it.y > rect.y1 + 40) continue;
        const info = itemInfo(it.item);
        const pulse = 0.5 + 0.5 * Math.sin(time * 3 + it.id);
        g.save();
        g.translate(it.x, it.y);
        g.strokeStyle = rgba(info.color, 0.35 + pulse * 0.3);
        g.lineWidth = 1.6;
        g.beginPath(); g.arc(0, 0, 13 + pulse * 3, 0, TAU); g.stroke();
        fillEllipse(g, 1.5, 3, 7, 5, 'rgba(0,0,0,0.3)');
        g.rotate(Math.sin(time * 1.4 + it.id) * 0.25);
        drawItem(g, info, time);
        g.restore();
      }
    }
    npcs.draw(g, view, rect, time, dt);
  }

  /** Additive glows over the darkness: marker rings and beacons. */
  function drawWorld(g, view, rect, time, k) {
    const st = view && view.story;
    if (!st || !st.marks || !st.marks.length) return;
    const px = 1 / Math.max(1e-3, k);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const beat = 0.5 + 0.5 * Math.sin(time * 4);
    for (const m of st.marks) {
      if (m.x < rect.x0 - m.r - 80 || m.x > rect.x1 + m.r + 80 || m.y < rect.y0 - m.r - 80 || m.y > rect.y1 + m.r + 80) continue;
      const c = MARKER_COLORS[m.kind] || MARKER_COLORS.objective;
      const glow = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, 46);
      glow.addColorStop(0, rgba(c, 0.5));
      glow.addColorStop(1, rgba(c, 0));
      g.globalAlpha = 0.5 + beat * 0.3;
      g.fillStyle = glow;
      g.fillRect(m.x - 46, m.y - 46, 92, 92);
      if (m.r > 30) {
        g.globalAlpha = 0.45 + beat * 0.25;
        g.strokeStyle = c;
        g.lineWidth = 2.5 * px * 1.4;
        g.setLineDash([16 * px * 1.4, 12 * px * 1.4]);
        g.lineDashOffset = -time * 30 * px;
        g.beginPath(); g.arc(m.x, m.y, m.r, 0, TAU); g.stroke();
        g.setLineDash([]);
      }
    }
    g.restore();
  }

  /** Marker icons (screen space), pinned to the edge with an arrow when off screen; NPC tags. */
  function drawScreen(g, view, local, toScreen, tmp, W, H, time, ui = 1) {
    const st = view && view.story;
    const marks = (st && st.marks) || [];
    npcs.drawTags(g, view, local, toScreen, tmp, W, H, time, marks, ui);
    if (!marks.length || !local || local.state === 'dead') return;
    const mx = Math.min(W * 0.28, 110 * ui), my = Math.min(H * 0.28, 120 * ui);
    const beat = 0.5 + 0.5 * Math.sin(time * 4);
    const nearestOff = new Map();
    const draw = [];
    for (const m of marks) {
      toScreen(m.x, m.y, tmp);
      const d = Math.hypot(m.x - local.x, m.y - local.y);
      const inside = tmp.x >= mx && tmp.x <= W - mx && tmp.y >= my && tmp.y <= H - my;
      if (inside) {
        if (m.kind === 'npc' && d < 500) continue;
        draw.push({ m, x: tmp.x, y: tmp.y, d, off: false, ang: 0 });
      } else {
        const b = nearestOff.get(m.kind);
        if (!b || d < b.d) {
          const cx = W / 2, cy = H / 2;
          const ang = Math.atan2(tmp.y - cy, tmp.x - cx);
          const dx = Math.cos(ang), dy = Math.sin(ang);
          const s = Math.min((W / 2 - mx) / Math.max(1e-6, Math.abs(dx)), (H / 2 - my) / Math.max(1e-6, Math.abs(dy)));
          nearestOff.set(m.kind, { m, x: cx + dx * s, y: cy + dy * s, d, off: true, ang });
        }
      }
    }
    for (const v of nearestOff.values()) draw.push(v);
    g.save();
    g.textAlign = 'center';
    for (const v of draw) {
      const c = MARKER_COLORS[v.m.kind] || MARKER_COLORS.objective;
      const s = v.m.kind === 'item' ? 7 : 9;
      g.save();
      g.translate(v.x, v.y);
      g.scale(ui, ui);
      g.globalAlpha = Math.max(0.4, Math.min(1, v.d / 140));
      g.lineJoin = 'round';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.fillStyle = c;
      const grow = v.m.kind === 'item' ? 1 : 1 + beat * 0.08;
      g.scale(grow, grow);
      g.beginPath();
      switch (v.m.kind) {
        case 'reach': case 'exit': g.arc(0, 0, s * 0.85, 0, TAU); break;
        case 'use': g.rect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4); break;
        case 'escort': case 'npc': g.moveTo(0, -s); g.lineTo(s * 0.9, s * 0.8); g.lineTo(-s * 0.9, s * 0.8); g.closePath(); break;
        case 'defend': g.moveTo(-s * 0.8, -s * 0.7); g.lineTo(s * 0.8, -s * 0.7); g.lineTo(s * 0.8, 0); g.lineTo(0, s); g.lineTo(-s * 0.8, 0); g.closePath(); break;
        default: g.moveTo(0, -s); g.lineTo(s * 0.8, 0); g.lineTo(0, s); g.lineTo(-s * 0.8, 0); g.closePath();
      }
      g.stroke();
      g.fill();
      g.scale(1 / grow, 1 / grow);
      if (v.off) {
        g.rotate(v.ang);
        g.beginPath();
        g.moveTo(s * 2.1, 0); g.lineTo(s * 1.35, -s * 0.65); g.lineTo(s * 1.35, s * 0.65); g.closePath();
        g.stroke();
        g.fill();
        g.rotate(-v.ang);
      }
      g.font = '700 13px "Barlow Condensed", system-ui, sans-serif';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      const label = `${Math.max(0, Math.round(v.d / PX_PER_M))} m`;
      g.textBaseline = 'top';
      g.strokeText(label, 0, s + 3);
      g.fillStyle = '#f4f1e6';
      g.fillText(label, 0, s + 3);
      g.restore();
    }
    g.restore();
  }

  return { drawGround, drawWorld, drawScreen };
}
