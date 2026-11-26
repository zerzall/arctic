// Fine detail for the class portraits (render/portrait.js) on canvases big enough to show it (a 4K
// display, a sharpened lobby): skin pores, cheek warmth, a lit forehead and a shaded jaw, irises
// with a limbal ring and catchlights, lids with creases, brows drawn hair by hair, a modelled nose
// and lips, stubble and hair strands as individual strokes, fabric weave, stitching and MOLLE
// webbing on the vest, and a rim light, a vignette and a little film grain over the whole card.
// Everything is seeded by the class, so a portrait is the same every time it is drawn. The 100 x 100
// design space of portrait.js is used throughout (the context is already scaled to it), except
// `fineFinish`, which works in canvas pixels.

import { mix, shade, rgba, fillCircle, fillEllipse } from './util.js';
import { createRng, hashString } from '../shared/rng.js';

const HAIR = { soldier: '#2a1d14', medic: '#6b4a2a', engineer: '#1a1210', scout: '#3a2616', demo: '#8a4a22', heavy: '#1a1210' };
const IRIS = { soldier: '#5a4630', medic: '#4a6a8a', engineer: '#3a2a1a', scout: '#5a7a4a', demo: '#4a7a8a', heavy: '#6a4a2a' };

const rngFor = (cls, salt) => createRng(hashString(`portrait:${cls}:${salt}`));

/** The head outline of portrait.js as a path. */
function headPath(g) {
  g.beginPath();
  g.moveTo(33, 40);
  g.bezierCurveTo(33, 22, 67, 22, 67, 40);
  g.bezierCurveTo(67, 54, 60, 63, 50, 64);
  g.bezierCurveTo(40, 63, 33, 54, 33, 40);
  g.closePath();
}

/** After the head is filled: pores, warmth, light and shade on the skin, inner ears, neck tendons. */
export function fineHead(g, cls, skin) {
  const r = rngFor(cls, 'skin');
  g.save();
  headPath(g);
  g.clip();
  // pores and freckles
  for (let i = 0; i < 420; i++) {
    const x = r.range(33, 67), y = r.range(24, 64);
    g.fillStyle = rgba(shade(skin, -0.5), r.range(0.05, 0.2));
    g.fillRect(x, y, r.range(0.18, 0.4), r.range(0.18, 0.4));
  }
  for (let i = 0; i < 140; i++) {
    g.fillStyle = rgba(shade(skin, 0.35), r.range(0.05, 0.14));
    g.fillRect(r.range(33, 67), r.range(24, 64), 0.3, 0.3);
  }
  // a lit forehead, warm cheeks
  let gr = g.createRadialGradient(47, 32, 1, 47, 32, 11);
  gr.addColorStop(0, 'rgba(255,255,255,0.16)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(33, 22, 34, 20);
  for (const x of [39.5, 60.5]) {
    gr = g.createRadialGradient(x, 52, 0.5, x, 52, 7.5);
    gr.addColorStop(0, 'rgba(190,80,70,0.2)');
    gr.addColorStop(1, 'rgba(190,80,70,0)');
    g.fillStyle = gr; g.fillRect(x - 8, 44, 16, 16);
  }
  // the light comes from the upper left: the far side of the face turns into shade
  gr = g.createLinearGradient(50, 0, 67, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(10,5,0,0.34)');
  g.fillStyle = gr; g.fillRect(50, 22, 18, 44);
  // under the brow ridge and along the jaw
  gr = g.createLinearGradient(0, 55, 0, 65);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(10,5,0,0.3)');
  g.fillStyle = gr; g.fillRect(33, 55, 34, 10);
  g.restore();
  // ears: the inner curl
  g.fillStyle = rgba(shade(skin, -0.42), 0.55);
  fillEllipse(g, 32.9, 46.4, 1.4, 3, undefined, 0.15);
  fillEllipse(g, 67.1, 46.4, 1.4, 3, undefined, -0.15);
  // the neck: tendons and the shadow of the jaw
  g.strokeStyle = rgba(shade(skin, -0.5), 0.22);
  g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(45, 62); g.lineTo(47, 72); g.moveTo(55, 62); g.lineTo(53, 72); g.stroke();
  const ng = g.createLinearGradient(0, 62, 0, 70);
  ng.addColorStop(0, 'rgba(0,0,0,0.4)');
  ng.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ng; g.fillRect(43, 62, 14, 8);
}

/** After the flat features: eyes, brows, nose, lips, stubble and hair strands. */
export function fineFace(g, cls, skin, look) {
  const r = rngFor(cls, 'face');
  const hair = HAIR[cls] || '#2a1d14';
  const lidC = rgba(shade(skin, -0.68), 0.95);
  // eyes
  for (const sx of [-1, 1]) {
    const cx = 50 + sx * 7, cy = 45;
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, 3.1, 1.85, 0, 0, Math.PI * 2);
    g.clip();
    fillCircle(g, cx + sx * 0.1, cy + 0.2, 1.55, IRIS[cls] || '#5a4630');
    let gr = g.createRadialGradient(cx - 0.4, cy - 0.4, 0.1, cx, cy, 1.6);
    gr.addColorStop(0, 'rgba(255,255,255,0.28)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = gr; g.fillRect(cx - 2, cy - 2, 4, 4);
    fillCircle(g, cx + sx * 0.1, cy + 0.2, 0.66, '#050403');
    // the lid's shadow on the eyeball
    gr = g.createLinearGradient(0, cy - 1.9, 0, cy + 0.2);
    gr.addColorStop(0, 'rgba(20,10,5,0.55)');
    gr.addColorStop(1, 'rgba(20,10,5,0)');
    g.fillStyle = gr; g.fillRect(cx - 3.2, cy - 2, 6.4, 2.2);
    g.restore();
    fillCircle(g, cx - 0.55, cy - 0.5, 0.36, 'rgba(255,255,255,0.95)');
    fillCircle(g, cx + 0.55, cy + 0.55, 0.16, 'rgba(255,255,255,0.6)');
    g.lineCap = 'round';
    g.strokeStyle = lidC;
    g.lineWidth = 0.55;
    g.beginPath(); g.moveTo(cx - 3.2, cy + 0.3); g.quadraticCurveTo(cx, cy - 3, cx + 3.2, cy + 0.3); g.stroke();
    g.strokeStyle = rgba(shade(skin, -0.45), 0.5);
    g.lineWidth = 0.3;
    g.beginPath(); g.moveTo(cx - 3, cy - 1.2); g.quadraticCurveTo(cx, cy - 4, cx + 3, cy - 1.2); g.stroke();
    g.strokeStyle = rgba(shade(skin, -0.5), 0.35);
    g.beginPath(); g.moveTo(cx - 2.8, cy + 1.2); g.quadraticCurveTo(cx, cy + 2.3, cx + 2.8, cy + 1.2); g.stroke();
    g.strokeStyle = rgba('#0c0806', 0.8);
    g.lineWidth = 0.22;
    for (let k = 0; k < 6; k++) {
      const t = -2.6 + k * 1.05;
      g.beginPath(); g.moveTo(cx + t, cy - 1.3 + Math.abs(t) * 0.18); g.lineTo(cx + t + sx * 0.5, cy - 2.3 + Math.abs(t) * 0.2); g.stroke();
    }
    fillCircle(g, cx - sx * 2.9, cy + 0.35, 0.42, 'rgba(208,138,128,0.85)');
  }
  // brows, hair by hair
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 20; k++) {
      const t = k / 19;
      const x = 50 + sx * (11 - t * 7), y = 40 + t * 1.5 - Math.sin(t * Math.PI) * 0.9;
      g.strokeStyle = rgba(shade(hair, r.range(-0.12, 0.2)), r.range(0.5, 0.9));
      g.lineWidth = 0.3;
      g.beginPath(); g.moveTo(x, y + 0.6); g.lineTo(x + sx * r.range(0.5, 1.5) * -1, y - r.range(0.4, 1.1)); g.stroke();
    }
  }
  // the nose
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.15)';
  g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(49.4, 44); g.lineTo(49.1, 51); g.stroke();
  fillCircle(g, 50, 51.4, 1, 'rgba(255,255,255,0.13)');
  g.fillStyle = 'rgba(30,14,8,0.6)';
  fillEllipse(g, 48.7, 52.5, 0.95, 0.5, undefined, 0.2);
  fillEllipse(g, 51.3, 52.5, 0.95, 0.5, undefined, -0.2);
  g.strokeStyle = rgba(shade(skin, -0.5), 0.2);
  g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(52, 46); g.quadraticCurveTo(53, 50, 51.9, 52.2); g.stroke();
  g.lineWidth = 0.3;
  g.beginPath(); g.moveTo(49.2, 53.6); g.lineTo(48.8, 55.6); g.moveTo(50.8, 53.6); g.lineTo(51.2, 55.6); g.stroke();
  // the lips
  g.fillStyle = rgba(mix(skin, '#8a3a3a', 0.5), 0.85);
  g.beginPath();
  g.moveTo(45.1, 57.5); g.quadraticCurveTo(47.4, 55.6, 50, 56.4); g.quadraticCurveTo(52.6, 55.6, 54.9, 57.5); g.quadraticCurveTo(50, 57, 45.1, 57.5);
  g.fill();
  g.fillStyle = rgba(mix(skin, '#a85a52', 0.5), 0.8);
  g.beginPath();
  g.moveTo(45.7, 57.7); g.quadraticCurveTo(50, 61, 54.3, 57.7); g.quadraticCurveTo(50, 57.4, 45.7, 57.7);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.2)';
  fillEllipse(g, 50, 59.1, 1.9, 0.45);
  // stubble
  if (cls === 'soldier' || cls === 'heavy' || cls === 'demo') {
    for (let i = 0; i < 620; i++) {
      const x = r.range(35, 65), y = r.range(49, 64);
      const dx = (x - 50) / 16, dy = (y - 47) / 18;
      if (dx * dx + dy * dy > 0.98 || (y < 54 && Math.abs(x - 50) < 8)) continue;
      if (y > 56.5 && y < 60 && Math.abs(x - 50) < 5.2) continue;     // not on the lips
      g.fillStyle = rgba('#14100c', r.range(0.16, 0.42));
      g.fillRect(x, y, 0.26, 0.34);
    }
  }
  // hair as strands
  for (let i = 0; i < 110; i++) {
    const t = r.range(0.12, Math.PI - 0.12);
    const x = 50 + Math.cos(t) * r.range(12, 17), y = 41 - Math.sin(t) * r.range(9, 16);
    g.strokeStyle = rgba(shade(hair, r.range(-0.25, 0.3)), r.range(0.3, 0.8));
    g.lineWidth = 0.28;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(t) * 1.5, y - 1, x + Math.cos(t) * 2.4 + r.range(-0.6, 0.6), y + r.range(1.5, 3.2));
    g.stroke();
  }
  // grime
  for (let i = 0; i < 3; i++) {
    const x = r.range(36, 64), y = r.range(38, 60);
    const gr = g.createRadialGradient(x, y, 0.2, x, y, r.range(2, 4));
    gr.addColorStop(0, 'rgba(40,25,15,0.22)');
    gr.addColorStop(1, 'rgba(40,25,15,0)');
    g.fillStyle = gr; g.fillRect(x - 5, y - 5, 10, 10);
  }
  void look;
}

/** Fabric weave, stitching and webbing on the torso and vest (drawn before the neck and head). */
export function fineBody(g, cls, outfit, vest) {
  // weave, clipped to the whole torso
  g.save();
  g.beginPath();
  g.moveTo(8, 100); g.bezierCurveTo(10, 80, 22, 72, 36, 70); g.lineTo(64, 70); g.bezierCurveTo(78, 72, 90, 80, 92, 100);
  g.closePath();
  g.clip();
  g.lineWidth = 0.22;
  for (let k = -100; k < 100; k += 1.15) {
    g.strokeStyle = 'rgba(0,0,0,0.07)';
    g.beginPath(); g.moveTo(k, 70); g.lineTo(k + 32, 102); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    g.beginPath(); g.moveTo(k + 0.55, 70); g.lineTo(k - 32 + 0.55, 102); g.stroke();
  }
  g.restore();
  // the vest: stitched edges, a zip, seams, MOLLE loops
  g.save();
  g.setLineDash([1.1, 0.9]);
  g.strokeStyle = rgba(shade(vest, 0.4), 0.5);
  g.lineWidth = 0.35;
  g.beginPath(); g.moveTo(30.5, 100); g.lineTo(32, 82); g.moveTo(69.5, 100); g.lineTo(68, 82); g.moveTo(40, 75.5); g.lineTo(50, 86); g.lineTo(60, 75.5); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = rgba(shade(vest, -0.5), 0.5);
  g.lineWidth = 0.4;
  g.beginPath(); g.moveTo(50, 86); g.lineTo(50, 100); g.stroke();
  g.setLineDash([0.4, 0.5]);
  g.strokeStyle = rgba(shade(vest, 0.5), 0.6);
  g.beginPath(); g.moveTo(49.3, 86); g.lineTo(49.3, 100); g.moveTo(50.7, 86); g.lineTo(50.7, 100); g.stroke();
  g.restore();
  if (cls === 'soldier' || cls === 'heavy' || cls === 'demo' || cls === 'scout') {
    g.fillStyle = rgba(shade(vest, -0.45), 0.55);
    for (const y of [89.5, 93, 96.5]) for (let x = 30; x < 70; x += 4.6) {
      if (Math.abs(x - 50) < 2.6) continue;
      g.fillRect(x, y, 3.4, 0.7);
    }
  }
  // stitched border of the shoulder patches
  g.save();
  g.setLineDash([0.9, 0.7]);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 0.3;
  for (const [x, rot] of [[17, -0.5], [83, 0.5]]) {
    g.beginPath(); g.ellipse(x, 83, 6.1, 3.7, rot, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
  void outfit;
}

/** Over the whole card, in canvas pixels: rim light, vignette and grain. */
export function fineFinish(g, W, H, cls, pc) {
  const r = rngFor(cls, 'finish');
  let gr = g.createLinearGradient(W * 0.62, 0, W, 0);
  gr.addColorStop(0, rgba(mix(pc, '#ffffff', 0.5), 0));
  gr.addColorStop(1, rgba(mix(pc, '#ffffff', 0.5), 0.2));
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  gr = g.createRadialGradient(W / 2, H * 0.52, H * 0.3, W / 2, H * 0.52, H * 0.78);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  const n = Math.min(9000, Math.floor((W * H) / 36));
  for (let i = 0; i < n; i++) {
    g.fillStyle = r.chance(0.5) ? `rgba(255,255,255,${r.range(0.02, 0.06).toFixed(3)})` : `rgba(0,0,0,${r.range(0.03, 0.08).toFixed(3)})`;
    g.fillRect(r.range(0, W), r.range(0, H), 1, 1);
  }
}
