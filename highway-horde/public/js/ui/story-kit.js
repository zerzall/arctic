// Small building blocks shared by the story UI: texts for refusals, pips, chips, the XP bar,
// a weapon icon and the cast portraits. Browser only (it draws on canvases).

import { h } from './dom.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { drawWeapon } from '../render/actors.js';
import { castOf } from '../shared/story/content.js';
import { xpBar } from '../shared/story/progression.js';

/** What the host's refusals mean to a person. */
export const REASONS = {
  scrap: 'Not enough scrap.',
  parts: 'Not enough parts.',
  points: 'No perk points to spend.',
  level: 'Your level is too low for that rank.',
  max: 'Already at the top.',
  unowned: 'You do not own that gun.',
  owned: 'You already own that.',
  locked: 'Not available yet.',
  chapter: 'That needs a later chapter.',
  host: 'Only the host can do that.',
  busy: 'Not right now.',
  empty: 'The stash is empty.',
  full: 'The stash is full.',
  nothing: 'Nothing to do.',
  duplicate: 'A gun can only be carried once.',
  unknown: 'That is not possible.',
  invalid: 'That did not work.',
  error: 'Something went wrong.',
};

export function reasonText(reason) {
  return REASONS[reason] || REASONS.invalid;
}

/** ●●●○○ style pips. */
export function pips(n, max, cls = '') {
  const el = h(`span.st-pips${cls ? `.${cls}` : ''}`, { 'aria-label': `${n} of ${max}`, role: 'img' });
  for (let i = 0; i < max; i++) el.appendChild(h(`i${i < n ? '.on' : ''}`));
  return el;
}

/** A labelled number ("SCRAP 120"). */
export function chip(label, value, tone = '') {
  return h(`span.st-chip${tone ? `.${tone}` : ''}`, null, [h('span.st-chip-label', { text: label }), h('span.st-chip-value', { text: String(value) })]);
}

/** The level/XP strip of a profile. */
export function xpStrip(profile, opts = {}) {
  const b = xpBar(profile);
  const fill = h('i.st-xp-fill', { style: { width: `${Math.round(b.frac * 100)}%` } });
  const el = h('div.st-xp', null, [
    h('span.st-xp-level', { text: `LV ${b.level}` }),
    h('span.st-xp-track', null, fill),
    opts.numbers === false ? null : h('span.st-xp-num', { text: b.maxed ? 'MAX' : `${b.into} / ${b.span}` }),
  ]);
  return { el, fill, bar: b };
}

/** Draw a gun sprite centred on a canvas (the top-down sprites of render/actors.js). */
export function drawWeaponIcon(canvas, weaponId, tint = null) {
  const w = WEAPONS[weaponId];
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!w) return;
  const len = w.sprite.len + 6;
  const s = Math.min((W * 0.86) / len, (H * 0.7) / Math.max(10, w.sprite.width + 6));
  g.setTransform(s, 0, 0, s, (W - len * s) / 2 + 3 * s, H / 2);
  if (tint) {
    g.shadowColor = tint;
    g.shadowBlur = 6;
  }
  drawWeapon(g, weaponId, 0, 0);
}

/** A canvas with a gun icon (device-pixel sized by CSS via fitCanvas-free fixed backing store). */
export function weaponIcon(weaponId, size = 96, tint = null) {
  const c = h('canvas.st-gun', { width: size * 2, height: Math.round(size * 0.7) * 2, 'aria-hidden': 'true' });
  drawWeaponIcon(c, weaponId, tint);
  return c;
}

/** Colour index of the standard palette nearest to a cast colour (for the class portrait). */
function colourIndexFor(id) {
  let n = 0;
  for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % PLAYER_COLORS.length;
}

/** The radio-set card of "The Warden" (no face, a waveform). */
function drawRadioCard(canvas, color) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#12161a');
  bg.addColorStop(1, '#07090b');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  // the set
  const bx = W * 0.14, by = H * 0.28, bw = W * 0.72, bh = H * 0.5;
  g.fillStyle = '#20252b';
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = Math.max(1, W / 90);
  g.beginPath();
  g.roundRect(bx, by, bw, bh, W * 0.04);
  g.fill();
  g.stroke();
  // dial + speaker
  g.fillStyle = '#0a0c0f';
  g.beginPath();
  g.roundRect(bx + bw * 0.08, by + bh * 0.14, bw * 0.55, bh * 0.34, W * 0.02);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, W / 60);
  g.beginPath();
  const y0 = by + bh * 0.31;
  for (let i = 0; i <= 40; i++) {
    const x = bx + bw * 0.1 + (bw * 0.51 * i) / 40;
    const a = Math.sin(i * 0.9) * Math.sin(i * 0.23 + 1) * bh * 0.12;
    if (i === 0) g.moveTo(x, y0 + a);
    else g.lineTo(x, y0 + a);
  }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    g.beginPath();
    g.arc(bx + bw * (0.74 + c * 0.06), by + bh * (0.2 + r * 0.14), W * 0.008, 0, Math.PI * 2);
    g.fill();
  }
  // antenna + signal arcs
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = Math.max(1, W / 80);
  g.beginPath();
  g.moveTo(bx + bw * 0.9, by);
  g.lineTo(bx + bw * 1.05, H * 0.06);
  g.stroke();
  g.strokeStyle = color;
  g.globalAlpha = 0.6;
  for (let i = 1; i <= 3; i++) {
    g.beginPath();
    g.arc(bx + bw * 1.05, H * 0.06, W * 0.07 * i, Math.PI * 0.05, Math.PI * 0.5);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.font = `700 ${Math.round(H * 0.07)}px 'Barlow Condensed', sans-serif`;
  g.textAlign = 'center';
  g.fillText('ON AIR', W / 2, H * 0.93);
}

/**
 * Draw a cast member's portrait card. `deps.renderClassPortrait` draws the class card
 * the character is built on; the radio voice gets a set with a waveform.
 * @param {HTMLCanvasElement} canvas
 * @param {string} who cast id
 * @param {{ renderClassPortrait?: Function }} deps
 */
export function drawCastPortrait(canvas, who, deps) {
  const c = castOf(who);
  if (c.portrait === 'radio') {
    drawRadioCard(canvas, c.color);
    return c;
  }
  try {
    if (deps && typeof deps.renderClassPortrait === 'function') deps.renderClassPortrait(canvas, c.portrait, colourIndexFor(c.id));
  } catch {
    // portraits are decorative
  }
  return c;
}

/** Format "12,345". */
export function num(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}
