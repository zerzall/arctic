// Road to Haven on the minimap / radar (SPEC §7.3): the current objective's markers, the
// story items on the ground, NPCs and hold-to-use spots. One drawing routine serves both the
// north-up map and the rotating radar: the caller passes `at(x, y)` (world → canvas px) and,
// for the radar, `pin(pt)` that pulls a point outside the window onto its rim.
//
// Also the shared colours / labels of the story HUD (ui/storyhud.js, ui/compass.js).

import { MARKER_COLORS, itemInfo } from '../shared/story-defs.js';

const TAU = Math.PI * 2;

/** Colour of an objective marker kind. */
export function markColor(kind) {
  return MARKER_COLORS[kind] || MARKER_COLORS.objective;
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {object} view snapshot (story, npcs, interactables)
 * @param {number} u backing px per design px
 * @param {number} pulse seconds (animation)
 * @param {(x: number, y: number) => {x: number, y: number}} at world → canvas px (returns a shared object)
 * @param {((p: {x: number, y: number}, margin: number) => boolean)|null} rim pins a canvas point that is
 *   outside the window to its rim in place and returns true when it had to (radar); null = draw where it is
 * @param {{ inside: (x: number, y: number, m: number) => boolean }} win window test
 */
export function drawStoryMap(g, view, u, pulse, at, rim, win) {
  const st = view && view.story;
  if (!st && !(view && (view.npcs && view.npcs.length || view.interactables && view.interactables.length))) return;
  const P = { x: 0, y: 0 };
  // hold-to-use spots (hideout stations, terminals): small squares with a ring while used
  for (const it of (view.interactables || [])) {
    if (!it.on && !it.done) continue;
    const q = at(it.x, it.y);
    P.x = q.x;
    P.y = q.y;
    if (!win.inside(P.x, P.y, 0)) continue;
    g.fillStyle = it.done ? 'rgba(127,220,90,0.7)' : '#6ee7b7';
    g.strokeStyle = '#000';
    g.lineWidth = 1 * u;
    g.beginPath();
    g.rect(P.x - 2.4 * u, P.y - 2.4 * u, 4.8 * u, 4.8 * u);
    g.fill();
    g.stroke();
    if (it.prog > 0) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.6 * u;
      g.beginPath();
      g.arc(P.x, P.y, 5.4 * u, -Math.PI / 2, -Math.PI / 2 + TAU * it.prog);
      g.stroke();
    }
  }
  // story items
  if (st) {
    for (const it of st.items || []) {
      const q = at(it.x, it.y);
      if (!win.inside(q.x, q.y, 0)) continue;
      g.fillStyle = itemInfo(it.item).color;
      g.strokeStyle = '#000';
      g.lineWidth = 1 * u;
      g.beginPath();
      g.moveTo(q.x, q.y - 3.4 * u);
      g.lineTo(q.x + 3.2 * u, q.y);
      g.lineTo(q.x, q.y + 3.4 * u);
      g.lineTo(q.x - 3.2 * u, q.y);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
  // NPCs
  for (const n of view.npcs || []) {
    const q = at(n.x, n.y);
    P.x = q.x;
    P.y = q.y;
    if (rim) rim(P, 4 * u);
    else if (!win.inside(P.x, P.y, 0)) continue;
    if (n.state === 'down' && Math.sin(pulse * 10) < 0) continue;
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(P.x, P.y, 4 * u, 0, TAU);
    g.fill();
    g.fillStyle = n.state === 'down' ? '#ff5252' : '#fde68a';
    g.beginPath();
    g.arc(P.x, P.y, 2.8 * u, 0, TAU);
    g.fill();
  }
  // objective markers (drawn last, pinned to the rim on the radar)
  if (st) {
    const beat = 0.5 + 0.5 * Math.sin(pulse * 4);
    for (const m of st.marks || []) {
      const q = at(m.x, m.y);
      P.x = q.x;
      P.y = q.y;
      const off = rim ? rim(P, 6.5 * u) : false;
      if (!rim && !win.inside(P.x, P.y, 0)) continue;
      const col = markColor(m.kind);
      if (m.r > 0 && !off) {
        // the area the step names, as a soft ring
        g.strokeStyle = col;
        g.globalAlpha = 0.35 + 0.25 * beat;
        g.lineWidth = 1.6 * u;
        g.setLineDash([5 * u, 4 * u]);
        g.beginPath();
        g.arc(P.x, P.y, Math.max(3 * u, m.r * at.k), 0, TAU);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      g.fillStyle = col;
      g.strokeStyle = '#000';
      g.lineWidth = 1.5 * u;
      const s = (5.2 + beat * 0.8) * u;
      g.beginPath();
      g.moveTo(P.x, P.y - s);
      g.lineTo(P.x + s, P.y);
      g.lineTo(P.x, P.y + s);
      g.lineTo(P.x - s, P.y);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
}
