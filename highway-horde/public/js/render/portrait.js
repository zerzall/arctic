// Front-facing survivor portraits for the lobby class picker and the HUD. Drawn in a
// 100x100 design space scaled to the canvas, so any size works.

import { CLASSES } from '../shared/classes.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { mix, shade, rgba, fillCircle, fillEllipse, fillRoundRect } from './util.js';
import { classSkin, drawWeapon } from './actors.js';

const HAIR = { soldier: '#2a1d14', medic: '#6b4a2a', engineer: '#1a1210', scout: '#3a2616', demo: '#8a4a22', heavy: '#1a1210' };

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} classId
 * @param {number} colorIndex 0..5
 */
export function renderClassPortrait(canvas, classId, colorIndex) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cls = CLASSES[classId] ? classId : 'soldier';
  const C = CLASSES[cls];
  const look = C.look;
  const pc = PLAYER_COLORS[((colorIndex | 0) % 6 + 6) % 6];
  const skin = classSkin(cls);
  const outfit = look.outfit, vest = look.vest;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const s = Math.min(W, H) / 100;
  g.setTransform(s, 0, 0, s, (W - 100 * s) / 2, (H - 100 * s) / 2);

  // backdrop: dark with a glow in the player's colour and faint scan lines
  const bg = g.createRadialGradient(50, 58, 5, 50, 55, 75);
  bg.addColorStop(0, mix(pc, '#0e1116', 0.55));
  bg.addColorStop(0.55, mix(pc, '#0e1116', 0.85));
  bg.addColorStop(1, '#0a0c0f');
  g.fillStyle = bg;
  g.fillRect(0, 0, 100, 100);
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < 100; y += 3) g.fillRect(0, y, 100, 1);

  // class weapon slung behind the shoulder
  g.save();
  g.translate(64, 88);
  g.rotate(-1.05);
  g.scale(1.25, 1.25);
  g.globalAlpha = 0.95;
  drawWeapon(g, C.startWeapon, 0, 0);
  g.restore();
  g.globalAlpha = 1;

  // torso
  g.beginPath();
  g.moveTo(8, 100);
  g.bezierCurveTo(10, 80, 22, 72, 36, 70);
  g.lineTo(64, 70);
  g.bezierCurveTo(78, 72, 90, 80, 92, 100);
  g.closePath();
  const tg = g.createLinearGradient(0, 70, 0, 100);
  tg.addColorStop(0, shade(outfit, 0.15));
  tg.addColorStop(1, shade(outfit, -0.35));
  g.fillStyle = tg;
  g.fill();
  // collar
  g.fillStyle = shade(outfit, -0.25);
  g.beginPath();
  g.moveTo(38, 70); g.lineTo(50, 82); g.lineTo(62, 70); g.lineTo(58, 68); g.lineTo(50, 76); g.lineTo(42, 68);
  g.closePath();
  g.fill();
  // vest
  g.beginPath();
  g.moveTo(26, 100); g.lineTo(28, 80); g.lineTo(40, 73); g.lineTo(50, 84); g.lineTo(60, 73); g.lineTo(72, 80); g.lineTo(74, 100);
  g.closePath();
  const vg = g.createLinearGradient(26, 0, 74, 0);
  vg.addColorStop(0, shade(vest, -0.3));
  vg.addColorStop(0.5, shade(vest, 0.15));
  vg.addColorStop(1, shade(vest, -0.3));
  g.fillStyle = vg;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 0.8;
  g.stroke();
  // shoulder patches in player colour
  fillEllipse(g, 17, 83, 7, 4.5, pc, -0.5);
  fillEllipse(g, 83, 83, 7, 4.5, pc, 0.5);

  // class details on the vest
  switch (cls) {
    case 'medic':
      fillRoundRect(g, 43, 88, 14, 10, 2, '#f2f2f2');
      g.fillStyle = '#c62828';
      g.fillRect(48.5, 89.5, 3, 7);
      g.fillRect(46.5, 91.5, 7, 3);
      break;
    case 'engineer':
      g.strokeStyle = '#b0b4b8';
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(34, 96); g.lineTo(42, 84); g.stroke();
      fillCircle(g, 42.5, 83.5, 2.6, '#b0b4b8');
      fillCircle(g, 42.5, 83.5, 1.1, shade(vest, -0.2));
      g.fillStyle = '#ffd54f';
      g.fillRect(56, 88, 12, 3);
      break;
    case 'demo':
      for (const x of [34, 42, 58, 66]) {
        fillCircle(g, x, 91, 3.6, '#4b5a2a');
        g.fillStyle = '#999';
        g.fillRect(x - 1, 86.5, 2, 2.5);
      }
      break;
    case 'heavy':
      fillRoundRect(g, 36, 86, 28, 14, 2, shade(vest, 0.1));
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.strokeRect(36, 86, 28, 14);
      break;
    case 'scout':
      g.fillStyle = mix(pc, '#222', 0.2);
      g.beginPath();
      g.moveTo(36, 70); g.quadraticCurveTo(50, 80, 64, 70); g.lineTo(62, 76); g.quadraticCurveTo(50, 84, 38, 76);
      g.closePath();
      g.fill();
      break;
    default:
      // dog tags
      g.strokeStyle = '#999';
      g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(45, 72); g.lineTo(50, 86); g.lineTo(55, 72); g.stroke();
      fillRoundRect(g, 48, 85, 4, 6, 1, '#c8c8c8');
  }

  // neck
  fillRoundRect(g, 43, 58, 14, 15, 4, shade(skin, -0.2));
  // ears
  fillEllipse(g, 32.5, 46, 3.2, 5, shade(skin, -0.12));
  fillEllipse(g, 67.5, 46, 3.2, 5, shade(skin, -0.12));
  // head
  const hg = g.createRadialGradient(46, 38, 3, 50, 45, 22);
  hg.addColorStop(0, shade(skin, 0.18));
  hg.addColorStop(1, shade(skin, -0.25));
  g.fillStyle = hg;
  g.beginPath();
  g.moveTo(33, 40);
  g.bezierCurveTo(33, 22, 67, 22, 67, 40);
  g.bezierCurveTo(67, 54, 60, 63, 50, 64);
  g.bezierCurveTo(40, 63, 33, 54, 33, 40);
  g.fill();
  // hair (under the hat)
  g.fillStyle = HAIR[cls];
  if (look.hat === 'none') {
    g.globalAlpha = 0.55;
    g.beginPath(); g.moveTo(33.5, 38); g.bezierCurveTo(34, 24, 66, 24, 66.5, 38); g.bezierCurveTo(60, 31, 40, 31, 33.5, 38); g.fill();
    g.globalAlpha = 1;
  } else {
    g.beginPath(); g.moveTo(33, 42); g.bezierCurveTo(33, 28, 67, 28, 67, 42); g.lineTo(64, 36); g.lineTo(36, 36); g.closePath(); g.fill();
  }
  // brows, eyes, nose, mouth — grim and tired
  g.strokeStyle = shade(HAIR[cls], 0.1);
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(39, 40); g.lineTo(46, 41.5);
  g.moveTo(61, 40); g.lineTo(54, 41.5);
  g.stroke();
  fillEllipse(g, 43, 45, 3, 1.8, '#f0ece4');
  fillEllipse(g, 57, 45, 3, 1.8, '#f0ece4');
  fillCircle(g, 43.4, 45.2, 1.3, '#2a2016');
  fillCircle(g, 56.6, 45.2, 1.3, '#2a2016');
  g.strokeStyle = rgba(shade(skin, -0.45), 0.8);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(50, 45); g.lineTo(48.5, 52); g.lineTo(51.5, 52.5);
  g.moveTo(45, 57.5); g.quadraticCurveTo(50, 56.5, 55, 57.5);
  g.stroke();
  // tired eye shadows
  g.fillStyle = rgba(shade(skin, -0.5), 0.25);
  fillEllipse(g, 43, 47.8, 3.5, 1.2);
  fillEllipse(g, 57, 47.8, 3.5, 1.2);
  if (cls === 'soldier' || cls === 'heavy' || cls === 'demo') {
    // stubble
    g.fillStyle = rgba('#1a1410', 0.18);
    g.beginPath();
    g.moveTo(37, 50); g.bezierCurveTo(38, 60, 44, 64, 50, 64); g.bezierCurveTo(56, 64, 62, 60, 63, 50);
    g.bezierCurveTo(58, 56, 42, 56, 37, 50);
    g.fill();
  }
  if (cls === 'heavy') {
    g.strokeStyle = rgba('#5a2a20', 0.8);
    g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(59, 36); g.lineTo(62, 50); g.stroke();
  }
  // dirt & a bloody scratch: they have been at this a while
  g.fillStyle = 'rgba(40,25,15,0.25)';
  fillEllipse(g, 38, 52, 3, 2);
  g.strokeStyle = 'rgba(140,20,20,0.7)';
  g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(60, 50); g.lineTo(63, 53); g.stroke();

  drawHatFront(g, look.hat, pc, outfit);

  // frame
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = rgba(pc, 0.7);
  g.lineWidth = Math.max(1, s * 1.2);
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
}

function drawHatFront(g, hat, pc, outfit) {
  switch (hat) {
    case 'helmet': {
      const hg = g.createLinearGradient(0, 16, 0, 40);
      hg.addColorStop(0, shade(outfit, 0.3));
      hg.addColorStop(1, shade(outfit, -0.3));
      g.fillStyle = hg;
      g.beginPath();
      g.moveTo(29, 38); g.bezierCurveTo(28, 14, 72, 14, 71, 38); g.lineTo(29, 38);
      g.fill();
      g.fillStyle = shade(outfit, -0.4);
      g.fillRect(28, 35.5, 44, 3.5);
      g.fillStyle = pc;
      g.fillRect(34, 28, 32, 3);
      // goggles on the helmet
      fillRoundRect(g, 38, 21, 24, 7, 3, '#222');
      fillEllipse(g, 44, 24.5, 4, 2.5, '#6fa0c8');
      fillEllipse(g, 56, 24.5, 4, 2.5, '#6fa0c8');
      break;
    }
    case 'cap': {
      g.fillStyle = '#f2f2f2';
      g.beginPath();
      g.moveTo(32, 37); g.bezierCurveTo(31, 18, 69, 18, 68, 37); g.closePath();
      g.fill();
      g.fillStyle = pc;
      fillEllipse(g, 50, 37.5, 20, 4, pc);
      g.fillStyle = '#c62828';
      g.fillRect(48, 23, 4, 11);
      g.fillRect(44.5, 26.5, 11, 4);
      break;
    }
    case 'hardhat': {
      const hg = g.createLinearGradient(0, 14, 0, 38);
      hg.addColorStop(0, '#ffe082');
      hg.addColorStop(1, '#e09a00');
      g.fillStyle = hg;
      g.beginPath();
      g.moveTo(30, 36); g.bezierCurveTo(29, 13, 71, 13, 70, 36); g.closePath();
      g.fill();
      fillRoundRect(g, 25, 34, 50, 4.5, 2, '#d08a00');
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(48, 16, 4, 18);
      fillCircle(g, 50, 26, 4, '#fff6c0');
      fillCircle(g, 50, 26, 2.2, '#ffffff');
      fillCircle(g, 62, 30, 2.4, pc);
      break;
    }
    case 'bandana': {
      g.fillStyle = pc;
      g.beginPath();
      g.moveTo(32, 38); g.bezierCurveTo(31, 19, 69, 19, 68, 38); g.bezierCurveTo(60, 34, 40, 34, 32, 38);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.3)';
      for (const [x, y] of [[40, 28], [50, 25], [60, 28], [45, 32], [56, 32]]) fillCircle(g, x, y, 1.1);
      g.strokeStyle = shade(pc, -0.3);
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(67, 34); g.lineTo(76, 42); g.moveTo(67, 34); g.lineTo(74, 46);
      g.stroke();
      break;
    }
    case 'beanie': {
      const hg = g.createLinearGradient(0, 12, 0, 38);
      hg.addColorStop(0, '#3a3a3a');
      hg.addColorStop(1, '#171717');
      g.fillStyle = hg;
      g.beginPath();
      g.moveTo(31, 38); g.bezierCurveTo(30, 14, 70, 14, 69, 38); g.closePath();
      g.fill();
      fillRoundRect(g, 30, 32, 40, 7, 3, '#222');
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 34; x < 68; x += 3) { g.moveTo(x, 20); g.lineTo(x, 38); }
      g.stroke();
      g.fillStyle = pc;
      g.fillRect(30, 33.5, 40, 2);
      fillCircle(g, 50, 15, 4.5, pc);
      break;
    }
    default: {
      // ear defenders over a buzz cut
      g.strokeStyle = '#222';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(31, 44); g.bezierCurveTo(31, 18, 69, 18, 69, 44);
      g.stroke();
      fillRoundRect(g, 26, 38, 9, 14, 3, pc);
      fillRoundRect(g, 65, 38, 9, 14, 3, pc);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(27, 43, 7, 2);
      g.fillRect(66, 43, 7, 2);
    }
  }
}
