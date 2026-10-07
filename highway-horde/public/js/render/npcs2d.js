// Story NPCs in the classic top-down view (STORY.md §5.3, SPEC §7.1): a survivor seen from
// above painted from the NPC's `look` (shirt, skin, hair, accessory) with a walk cycle, a
// gesturing arm while it talks, a slumped body when down, and the name tag / prompt above it.

import { CAST, TALK_RANGE } from '../shared/story-defs.js';
import { fillCircle, fillEllipse, shade } from './util.js';

const TAU = Math.PI * 2;
const HEX = /^#[0-9a-f]{6}$/i;

function col(c, d) {
  return typeof c === 'string' && HEX.test(c) ? c : d;
}
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Colours of a look: { skin, hair, top, legs, accent }. */
function paletteOf(look) {
  const o = look && Array.isArray(look.outfit) ? look.outfit : [];
  const top = col(o[0], '#6a6a50');
  return { skin: col(look && look.skin, '#d0a078'), hair: col(look && look.hair, '#3a2a1c'), top, legs: col(o[1], top), accent: col(o[2], col(o[1], top)) };
}

/** A hat / hair / back item from above. Facing +x, head at the origin. */
function drawHead(g, look, pal, o) {
  const acc = look && look.accessory;
  const hair = look && look.hairStyle;
  // hair
  fillCircle(g, -0.6, 0, 6.6, shade(pal.hair, -0.1));
  if (hair === 'bun') fillCircle(g, -6.4, 0, 3.2, pal.hair);
  else if (hair === 'ponytail') {
    g.strokeStyle = pal.hair; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(-12, Math.sin(o.walk) * 1.5 * o.move); g.stroke();
  } else if (hair === 'pigtails') {
    fillCircle(g, -1, -7, 2.6, pal.hair);
    fillCircle(g, -1, 7, 2.6, pal.hair);
  } else if (hair === 'braid') {
    g.strokeStyle = pal.hair; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(-13, Math.sin(o.walk) * 2 * o.move); g.stroke();
  } else if (hair === 'curly' || hair === 'curls') {
    for (let k = 0; k < 6; k++) fillCircle(g, Math.cos((k / 6) * TAU) * 4.6 - 0.6, Math.sin((k / 6) * TAU) * 4.6, 2.6, pal.hair);
  } else if (hair === 'bald-beard') {
    fillCircle(g, 0, 0, 6.2, pal.skin);
    fillEllipse(g, 4, 0, 3.4, 4.6, pal.hair);
  }
  switch (acc) {
    case 'cap': case 'trucker-cap': case 'captain-cap':
      fillCircle(g, -0.4, 0, 6.8, acc === 'captain-cap' ? '#f2f2f0' : pal.top);
      fillEllipse(g, 6.2, 0, 3.4, 5.2, acc === 'captain-cap' ? '#15161c' : pal.accent);
      break;
    case 'beanie':
      fillCircle(g, -0.4, 0, 6.9, pal.top);
      fillCircle(g, -0.4, 0, 2, pal.accent);
      break;
    case 'hat': case 'top-hat':
      fillCircle(g, 0, 0, acc === 'top-hat' ? 7.4 : 9.4, acc === 'top-hat' ? '#141418' : '#5a4a34');
      fillCircle(g, 0, 0, acc === 'top-hat' ? 4.2 : 5, acc === 'top-hat' ? '#26262e' : '#6a5a40');
      break;
    case 'beret':
      fillEllipse(g, -0.6, 0.6, 7.6, 6.6, '#3b4424');
      break;
    case 'headset':
      g.strokeStyle = '#2a2c30'; g.lineWidth = 1.8;
      g.beginPath(); g.arc(-0.6, 0, 6.8, Math.PI * 0.5, Math.PI * 1.5, true); g.stroke();
      fillCircle(g, -0.6, -7, 2.2, '#2a2c30');
      fillCircle(g, -0.6, 7, 2.2, '#2a2c30');
      g.beginPath(); g.moveTo(-0.6, 7); g.lineTo(4, 5); g.stroke();
      break;
    case 'bandage':
      g.strokeStyle = '#efeee8'; g.lineWidth = 2.2;
      g.beginPath(); g.arc(0, 0, 6.2, 0, TAU); g.stroke();
      break;
    case 'glasses':
      g.strokeStyle = '#15161a'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(5.6, -3.2); g.lineTo(5.6, 3.2); g.stroke();
      break;
    default:
      break;
  }
}

/** Something on the back / hips, seen from above (drawn before the shoulders). */
function drawBack(g, look, pal) {
  switch (look && look.accessory) {
    case 'backpack': fillEllipse(g, -9, 0, 4.4, 8, shade(pal.accent, -0.15)); break;
    case 'radio-pack': fillEllipse(g, -9, 0, 4.2, 7.4, '#3b4424'); g.strokeStyle = '#202020'; g.lineWidth = 1; g.beginPath(); g.moveTo(-10, -3); g.lineTo(-17, -6); g.stroke(); break;
    case 'map-satchel': fillEllipse(g, -2, 10.5, 5, 3.6, '#7a5a34'); break;
    case 'wrench-belt': fillEllipse(g, 0, 0, 9.4, 13.8, '#3a2a1c'); break;
    default: break;
  }
}

/**
 * @returns {{ draw(ctx, view, rect, time, dt), drawTags(ctx, view, local, toScreen, tmp, W, H, time, marks) }}
 */
export function createNpcs2D() {
  const anim = new Map();

  function stateOf(n, dt) {
    let a = anim.get(n.id);
    if (!a) {
      a = { x: n.x, y: n.y, ang: n.angle || 0, walk: n.id * 1.7, move: 0, talk: 0, seen: 0 };
      anim.set(n.id, a);
    }
    const dx = n.x - a.x, dy = n.y - a.y;
    const d = Math.hypot(dx, dy);
    const v = dt > 0 ? Math.min(1, d / dt / 90) : 0;
    a.move += (v - a.move) * Math.min(1, dt * 8);
    a.walk += a.move * dt * 11;
    const want = d > 0.4 && a.move > 0.15 ? Math.atan2(dy, dx) : (n.angle || 0);
    a.ang += angleDiff(a.ang, want) * Math.min(1, dt * 9);
    a.talk += ((n.state === 'talk' ? 1 : 0) - a.talk) * Math.min(1, dt * 6);
    a.x = n.x;
    a.y = n.y;
    return a;
  }

  function draw(g, view, rect, time, dt) {
    const list = view && view.npcs;
    if (!list || !list.length) return;
    for (const n of list) {
      if (n.x < rect.x0 - 60 || n.x > rect.x1 + 60 || n.y < rect.y0 - 60 || n.y > rect.y1 + 60) continue;
      const look = n.look || {};
      const pal = paletteOf(look);
      const a = stateOf(n, dt);
      const sc = Number.isFinite(look.scale) && look.scale > 0 ? look.scale : 1;
      g.save();
      g.translate(n.x, n.y);
      const cast = CAST[n.key];
      // a soft ring in the cast colour so the residents read as friends
      g.strokeStyle = (cast && cast.color) || '#fde68a';
      g.globalAlpha = 0.5;
      g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(0, 0, 20 * sc, 20 * sc, 0, 0, TAU); g.stroke();
      g.globalAlpha = 1;
      fillEllipse(g, 2, 3, 14 * sc, 14 * sc, 'rgba(0,0,0,0.35)');
      g.rotate(a.ang);
      g.scale(sc, sc);
      if (n.state === 'down') {
        // slumped: the body across the ground, one arm up
        g.globalAlpha = 0.5 + 0.5 * (Math.sin(time * 6) > 0 ? 1 : 0.6);
        fillEllipse(g, 0, 0, 12, 8, pal.top);
        fillCircle(g, 9, 0, 5.4, pal.skin);
        fillCircle(g, 9, -1, 4.6, shade(pal.hair, -0.05));
        g.strokeStyle = pal.skin; g.lineWidth = 3; g.lineCap = 'round';
        g.beginPath(); g.moveTo(3, -6); g.lineTo(8 + Math.sin(time * 4) * 2, -13); g.stroke();
        g.globalAlpha = 1;
        g.restore();
        continue;
      }
      const sw = Math.sin(a.walk) * a.move;
      // feet
      fillEllipse(g, -2 + sw * 6, -5.5, 4.6, 3, '#1b1b1b');
      fillEllipse(g, -2 - sw * 6, 5.5, 4.6, 3, '#1b1b1b');
      drawBack(g, look, pal);
      // shoulders
      fillEllipse(g, 0, 0, 9.5, 14.5, 'rgba(0,0,0,0.6)');
      const grad = g.createLinearGradient(0, -14, 0, 14);
      grad.addColorStop(0, shade(pal.top, -0.3));
      grad.addColorStop(0.5, shade(pal.top, 0.12));
      grad.addColorStop(1, shade(pal.top, -0.3));
      fillEllipse(g, 0, 0, 8.5, 13.5, grad);
      if (look.accessory === 'apron') fillEllipse(g, 2, 0, 5, 8, shade(pal.accent, 0.1));
      if (look.accessory === 'stethoscope') { g.strokeStyle = '#c8ccd0'; g.lineWidth = 1.2; g.beginPath(); g.arc(3, 0, 5, -1.2, 1.2); g.stroke(); }
      if (look.accessory === 'scarf' || look.accessory === 'bandana') fillEllipse(g, 3, 0, 3.2, 7.4, look.accessory === 'scarf' ? pal.accent : '#a8322a');
      // arms: swinging at a walk, one gesturing while it talks
      g.lineCap = 'round';
      const arm = (side, swing, gesture) => {
        const sy = side * 11.5;
        const hx = 3 + swing * 6 + gesture * 9, hy = side * (10.5 + gesture * -3);
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 6;
        g.beginPath(); g.moveTo(0, sy); g.lineTo(hx, hy); g.stroke();
        g.strokeStyle = pal.top; g.lineWidth = 4.6;
        g.beginPath(); g.moveTo(0, sy); g.lineTo((hx) / 2, (sy + hy) / 2); g.stroke();
        g.strokeStyle = pal.skin; g.lineWidth = 4;
        g.beginPath(); g.moveTo(hx / 2, (sy + hy) / 2); g.lineTo(hx, hy); g.stroke();
        fillCircle(g, hx, hy, 2.5, shade(pal.skin, -0.1));
      };
      const beat = Math.sin(time * 5 + n.id) * 0.5 + 0.5;
      arm(1, -sw, a.talk * (0.5 + beat * 0.5));
      arm(-1, sw, a.talk * 0.25);
      // head
      fillCircle(g, 1, 0, 7.6, 'rgba(0,0,0,0.65)');
      const hg = g.createRadialGradient(3, -2, 1, 1, 0, 7.2);
      hg.addColorStop(0, shade(pal.skin, 0.25));
      hg.addColorStop(1, shade(pal.skin, -0.2));
      fillCircle(g, 1, 0, 6.9, hg);
      g.translate(1, 0);
      drawHead(g, look, pal, a);
      g.restore();
    }
    // forget the ones that left
    if (anim.size > 40) {
      const alive = new Set(list.map((n) => n.id));
      for (const id of anim.keys()) if (!alive.has(id)) anim.delete(id);
    }
  }

  /** Name tags and the talk prompt over the NPCs (screen space). */
  function drawTags(g, view, local, toScreen, tmp, W, H, time, marks, ui = 1) {
    const list = view && view.npcs;
    if (!list || !list.length) return;
    g.save();
    g.textAlign = 'center';
    for (const n of list) {
      toScreen(n.x, n.y, tmp);
      if (tmp.x < -60 || tmp.x > W + 60 || tmp.y < -60 || tmp.y > H + 60) continue;
      const cast = CAST[n.key];
      const name = n.name || (cast && cast.name) || n.key;
      const down = n.state === 'down';
      const sc = Number.isFinite(n.look && n.look.scale) && n.look.scale > 0 ? n.look.scale : 1;
      const wx = tmp.x, wy = tmp.y;
      g.save();
      g.translate(wx, wy);
      g.scale(ui, ui);
      const y = -30 * sc;
      g.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      const tw = g.measureText(name).width;
      const pw = tw + 26, ph = 17;
      g.fillStyle = 'rgba(8,10,14,0.66)';
      g.beginPath();
      g.roundRect(0 - pw / 2, y - ph, pw, ph, ph / 2);
      g.fill();
      g.fillStyle = (cast && cast.color) || '#fde68a';
      g.beginPath(); g.arc(0 - pw / 2 + 9, y - ph / 2, 4.5, 0, TAU); g.fill();
      g.textAlign = 'left';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(name, 0 - pw / 2 + 17, y - 4.5);
      g.fillStyle = '#f7f3e6';
      g.fillText(name, 0 - pw / 2 + 17, y - 4.5);
      g.textAlign = 'center';
      if (n.hp >= 0 && (n.hp < 0.995 || n.state === 'escort' || down)) {
        const f = Math.max(0, Math.min(1, n.hp));
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(0 - 23, y + 3, 46, 6);
        g.fillStyle = f > 0.5 ? '#7dff9a' : f > 0.25 ? '#ffd54f' : '#ff5252';
        g.fillRect(0 - 22, y + 4, 44 * f, 4);
      }
      let waits = false;
      for (const m of marks || []) if (m.kind === 'npc' && Math.hypot(m.x - n.x, m.y - n.y) < 40) waits = true;
      if (waits) {
        g.font = '800 20px system-ui, sans-serif';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.8)';
        const by = y - ph - 4 + Math.sin(time * 5) * 2;
        g.strokeText('!', 0, by);
        g.fillStyle = '#ffd24a';
        g.fillText('!', 0, by);
      }
      if (local && local.state === 'alive' && n.state !== 'follow' && Math.hypot(local.x - n.x, local.y - n.y) <= TALK_RANGE * 1.25) {
        const label = down ? 'Hold E · Revive' : 'E · Talk';
        g.font = '700 11px system-ui, sans-serif';
        const lw = g.measureText(label).width + 14;
        g.fillStyle = down ? 'rgba(120,20,20,0.85)' : 'rgba(255,214,90,0.92)';
        g.beginPath(); g.roundRect(0 - lw / 2, y + 12, lw, 16, 8); g.fill();
        g.fillStyle = down ? '#fff1f1' : '#1c1608';
        g.fillText(label, 0, y + 24);
      }
      g.restore();
    }
    g.restore();
  }

  return { draw, drawTags };
}
