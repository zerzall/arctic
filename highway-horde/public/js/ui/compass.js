// First-person compass strip (top centre of the HUD): a heading tape with N/E/S/W and the
// intercardinals, the numeric heading under a centre notch, and markers for the objective
// (yellow diamond + distance), the supply station (green +) and teammates (their colour;
// downed ones blink red). A marker outside the visible arc sticks to the nearer edge with
// an arrow, so "which way is the bus?" always has an answer. In an Evac Run the safe zone
// takes the objective's place: a big teal ring marker with the distance to its edge, and
// the supply drop gets its own green +. In a story mission (opts.story) the current objective's
// markers (view.story.marks) are coloured diamonds with the distance to the nearest one. In Horde
// Elimination (opts.horde) there is no objective; the entrances of the surge on its way are red
// triangles.
//
// Drawn into a small canvas; skipped when nothing it shows changed (heading, markers).

import { PLAYER_COLORS } from '../shared/constants.js';
import { HS_BREATHER, HS_SURGE, hordeLanes } from '../shared/horde.js';
import { angleDelta, headingDeg } from './look.js';
import { currentUiScale } from './uiscale.js';
import { markColor } from './storymarks.js';

/** Half of the visible arc (radians): the strip spans ±75°. */
const HALF_ARC = (75 * Math.PI) / 180;
const LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** World px per metre for the distance readout (SPEC §7.5: 1 unit ≈ 1/32 m). */
const PX_PER_M = 32;

/**
 * @param {HTMLCanvasElement} canvas sized by CSS
 * @param {object} map MapDef (objective, supply)
 */
export function createCompass(canvas, map, opts = {}) {
  const zoneMode = !!opts.zone;
  const campMode = !!opts.campaign;     // the Campaign: its stage circle and supply point (view.campaign)
  const storyMode = !!opts.story;       // Road to Haven: the objective markers (view.story.marks)
  const hordeMode = !!opts.horde;       // Horde Elimination: the surge's entrances (view.horde.lanes), no objective
  const g = canvas.getContext('2d');
  // dpr: backing pixels per CSS px; u: backing pixels per design px (dpr × UI scale), so
  // labels grow with the rem-sized strip on big screens.
  let W = 0, H = 0, dpr = 1, u = 1;
  let lastKey = '';
  let pulse = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    u = dpr * currentUiScale();
    const w = Math.max(60, Math.round(r.width * dpr)), h = Math.max(20, Math.round(r.height * dpr));
    if (w !== W || h !== H) {
      W = canvas.width = w;
      H = canvas.height = h;
      lastKey = '';
    }
  }

  /** x on the strip for a bearing offset (radians off the facing direction). */
  function xOf(delta) {
    return W / 2 + (delta / HALF_ARC) * (W / 2 - 10 * u);
  }

  function marker(x, y, draw) {
    g.save();
    g.translate(x, y);
    draw();
    g.restore();
  }

  function edgeArrow(x, dir, color) {
    g.fillStyle = color;
    g.beginPath();
    const y = H * 0.36;
    g.moveTo(x + dir * 5 * u, y);
    g.lineTo(x - dir * 2 * u, y - 4.5 * u);
    g.lineTo(x - dir * 2 * u, y + 4.5 * u);
    g.closePath();
    g.fill();
  }

  /**
   * @param {number} yaw facing (sim angle)
   * @param {{x: number, y: number}|null} pos the listener/camera position
   * @param {object|null} view Snapshot (teammates)
   * @param {number} localId
   * @param {Map<number, object>} rosterById
   * @param {number} dt
   */
  function update(yaw, pos, view, localId, rosterById, dt) {
    pulse += dt || 0;
    if (!W) resize();
    if (!W || !Number.isFinite(yaw)) return;
    const blink = Math.sin(pulse * 10) > 0;
    // Build the list of markers first: redraw only when something visible changed.
    const marks = [];
    const add = (x, y, kind, color, label) => {
      if (!pos) return;
      const dx = x - pos.x, dy = y - pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 24) return;
      marks.push({ delta: angleDelta(yaw, Math.atan2(dy, dx)), kind, color, label, d });
    };
    if (map.supply && !campMode) add(map.supply.x, map.supply.y, 'supply', '#56d67a');
    const z = view && (view.zone || (campMode ? view.campaign : null));
    if (z) add(z.sx, z.sy, 'supply', '#56d67a');
    if (view) {
      for (const p of view.players || []) {
        if (p.id === localId || p.state === 'dead') continue;
        if (p.state === 'downed' && !blink) continue;
        const r = rosterById.get(p.id);
        add(p.x, p.y, 'mate', p.state === 'downed' ? '#ff5252' : PLAYER_COLORS[r ? r.color : 0] || '#fff');
      }
    }
    if (map.objective && !zoneMode && !campMode && !storyMode && !hordeMode) add(map.objective.x, map.objective.y, 'objective', '#ffc400');
    // Horde Elimination: the entrances of the surge on its way or on the streets (red triangles)
    const hz = hordeMode && view ? view.horde : null;
    if (hz && hz.lanes && (hz.stage === HS_BREATHER || hz.stage === HS_SURGE)) {
      for (const l of hordeLanes(map)) if (hz.lanes & (1 << l.i)) add(l.x, l.y, 'lane', '#ff5a36');
    }
    if (storyMode && view && view.story) {
      for (const m of view.story.marks || []) {
        if (!pos) break;
        const dx = m.x - pos.x, dy = m.y - pos.y;
        const d = Math.max(0, Math.hypot(dx, dy) - (m.r > 0 ? m.r : 0));
        if (d < 24 && m.r <= 0) continue;
        marks.push({ delta: angleDelta(yaw, Math.atan2(dy, dx)), kind: 'story', color: markColor(m.kind), label: '', d });
      }
    }
    if (z && pos) {
      add(z.x, z.y, 'zone', campMode ? (z.zip ? '#6dff9a' : '#ffd166') : '#4fe3d0');
      const zm = marks[marks.length - 1];
      if (zm && zm.kind === 'zone') zm.d = Math.max(0, Math.hypot(z.x - pos.x, z.y - pos.y) - z.r);
    }
    let key = `${W}:${H}:${yaw.toFixed(3)}`;
    for (const m of marks) key += `|${m.kind}${m.color}${m.delta.toFixed(2)}${Math.round(m.d / PX_PER_M)}`;
    if (key === lastKey) return;
    lastKey = key;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    // ticks every 5°, taller every 15°, labels every 45°
    const tickY = H * 0.62;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const hd = headingDeg(yaw);
    for (let deg = 0; deg < 360; deg += 5) {
      // bearing deg ↦ sim angle deg·π/180 − π/2
      const a = (deg * Math.PI) / 180 - Math.PI / 2;
      const delta = angleDelta(yaw, a);
      if (Math.abs(delta) > HALF_ARC) continue;
      const x = xOf(delta);
      const fade = 1 - Math.pow(Math.abs(delta) / HALF_ARC, 3);
      if (deg % 45 === 0) {
        const lab = LABELS[deg / 45];
        const cardinal = lab.length === 1;
        g.globalAlpha = fade;
        g.font = `${cardinal ? 800 : 700} ${Math.round((cardinal ? 15 : 11.5) * u)}px "Barlow Condensed", system-ui, sans-serif`;
        g.fillStyle = lab === 'N' ? '#ffc400' : cardinal ? '#f3efe6' : '#b9b3a6';
        g.fillText(lab, x, tickY - 3 * u);
      } else {
        const tall = deg % 15 === 0;
        g.globalAlpha = fade * (tall ? 0.8 : 0.45);
        g.fillStyle = '#e8e3d8';
        g.fillRect(Math.round(x - 0.5 * u), tickY - (tall ? 9 : 5) * u, Math.max(1, u), (tall ? 9 : 5) * u);
      }
    }
    g.globalAlpha = 1;
    // markers (objective last so it sits on top)
    for (const m of marks) {
      const out = Math.abs(m.delta) > HALF_ARC;
      const x = out ? xOf(Math.sign(m.delta) * HALF_ARC) : xOf(m.delta);
      if (out) {
        edgeArrow(x, Math.sign(m.delta), m.color);
        continue;
      }
      const y = H * 0.3;
      marker(x, y, () => {
        g.fillStyle = m.color;
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.lineWidth = 1.5 * u;
        if (m.kind === 'objective' || m.kind === 'story') {
          g.beginPath();
          g.moveTo(0, -6 * u);
          g.lineTo(6 * u, 0);
          g.lineTo(0, 6 * u);
          g.lineTo(-6 * u, 0);
          g.closePath();
          g.stroke();
          g.fill();
        } else if (m.kind === 'zone') {
          // safe zone: a teal ring with a dot, bigger than everything else
          g.strokeStyle = 'rgba(0,0,0,0.85)';
          g.lineWidth = 4.5 * u;
          g.beginPath();
          g.arc(0, 0, 7 * u, 0, Math.PI * 2);
          g.stroke();
          g.strokeStyle = m.color;
          g.lineWidth = 2.5 * u;
          g.beginPath();
          g.arc(0, 0, 7 * u, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.arc(0, 0, 2.2 * u, 0, Math.PI * 2);
          g.fill();
        } else if (m.kind === 'lane') {
          // a horde entrance: a red triangle pointing down
          g.beginPath();
          g.moveTo(-5.5 * u, -4.5 * u);
          g.lineTo(5.5 * u, -4.5 * u);
          g.lineTo(0, 5.5 * u);
          g.closePath();
          g.stroke();
          g.fill();
        } else if (m.kind === 'supply') {
          g.strokeRect(-1.5 * u, -5 * u, 3 * u, 10 * u);
          g.strokeRect(-5 * u, -1.5 * u, 10 * u, 3 * u);
          g.fillRect(-1.5 * u, -5 * u, 3 * u, 10 * u);
          g.fillRect(-5 * u, -1.5 * u, 10 * u, 3 * u);
        } else {
          g.beginPath();
          g.arc(0, 0, 4 * u, 0, Math.PI * 2);
          g.stroke();
          g.fill();
        }
      });
    }
    // centre notch + heading readout
    const cx = W / 2;
    g.fillStyle = '#ffc400';
    g.beginPath();
    g.moveTo(cx, H * 0.66);
    g.lineTo(cx - 5 * u, H * 0.66 + 6 * u);
    g.lineTo(cx + 5 * u, H * 0.66 + 6 * u);
    g.closePath();
    g.fill();
    g.font = `700 ${Math.round(11 * u)}px "Barlow Condensed", system-ui, sans-serif`;
    g.fillStyle = '#f3efe6';
    g.textBaseline = 'bottom';
    g.fillText(String(hd).padStart(3, '0'), cx, H - 1 * u);
    // objective (or safe zone) distance, next to its marker when it's roughly ahead
    let obj = marks.find((m) => m.kind === 'zone') || marks.find((m) => m.kind === 'objective');
    if (!obj) {
      for (const m of marks) if (m.kind === 'story' && Math.abs(m.delta) <= HALF_ARC && (!obj || m.d < obj.d)) obj = m;
    }
    if (obj && Math.abs(obj.delta) <= HALF_ARC) {
      const x = xOf(obj.delta);
      g.font = `700 ${Math.round(10.5 * u)}px "Barlow Condensed", system-ui, sans-serif`;
      g.fillStyle = obj.kind === 'zone' ? (campMode ? '#ffe08a' : '#8ff3e6') : obj.kind === 'story' ? obj.color : '#ffd766';
      g.textBaseline = 'middle';
      g.textAlign = x > W - 40 * u ? 'right' : 'left';
      g.fillText(`${Math.round(obj.d / PX_PER_M)}m`, x + (g.textAlign === 'left' ? 9 : -9) * u, H * 0.3);
    }
  }

  return { update, resize };
}
