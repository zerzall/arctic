// Resolution-aware UI scale. game.css sizes everything in rem, and <html> gets
// font-size: 16px × --ui-scale, so one number scales the menus and the HUD together.
//
// The automatic scale follows the viewport height (a 1000 px tall window is 1×, a 4K
// screen at devicePixelRatio 1 is ~2.1×) and never goes below 1: small windows keep the
// layout they were designed for, with their own media queries. The width caps it so
// narrow-and-tall windows (portrait monitors) keep enough room for the desktop layout.
// Phones and tablets stay at 1× (their touch layout is laid out in real px).
// The "UI size" setting multiplies the automatic scale; enlarging is capped so the
// layout never gets fewer than ~1024x600 CSS px to work with.

import { UI_SCALE_MIN, UI_SCALE_MAX } from './storage.js';

/** Viewport height (CSS px) that maps to 1× — just under a windowed 1080p browser. */
export const UI_REF_HEIGHT = 1000;
/** Viewport width (CSS px) that maps to 1×: keeps the desktop layout's width. */
export const UI_REF_WIDTH = 1200;
/** Largest automatic scale (8K screens at devicePixelRatio 1). */
export const UI_AUTO_MAX = 3;
/** An enlarged UI must still leave this much layout room (CSS px at scale 1). */
const FIT_W = 1024;
const FIT_H = 600;

let current = 1;

/**
 * Automatic scale for a viewport.
 * @param {number} w viewport width, CSS px
 * @param {number} h viewport height, CSS px
 * @param {boolean} [coarse] phone/tablet (touch layout): always 1
 * @returns {number}
 */
export function autoUiScale(w, h, coarse = false) {
  if (coarse || !(w > 0) || !(h > 0)) return 1;
  const s = Math.min(h / UI_REF_HEIGHT, w / UI_REF_WIDTH);
  return Math.min(UI_AUTO_MAX, Math.max(1, s));
}

/**
 * Effective scale: the automatic one × the "UI size" setting.
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {'auto'|number} setting prefs.settings.uiScale
 * @param {boolean} [coarse]
 * @returns {number} rounded to 0.01
 */
export function uiScaleFor(w, h, setting, coarse = false) {
  const auto = autoUiScale(w, h, coarse);
  const mult = typeof setting === 'number' && Number.isFinite(setting)
    ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, setting)) : 1;
  let s = auto * mult;
  if (mult > 1 && w > 0 && h > 0) {
    // Bigger text, but never so big the desktop layout runs out of room.
    const room = Math.min(w / FIT_W, h / FIT_H);
    s = Math.min(s, Math.max(auto, room));
  }
  return Math.round(s * 100) / 100;
}

/** The scale last applied to the page (1 before the first apply). */
export function currentUiScale() {
  return current;
}

/**
 * Apply the scale for the current viewport to <html>.
 * @param {object} settings prefs.settings (uiScale, hudSafeArea)
 * @param {boolean} [coarse] touch device
 * @returns {{ scale: number, changed: boolean }}
 */
export function applyUiScale(settings, coarse = false) {
  const root = document.documentElement;
  const w = window.innerWidth || root.clientWidth;
  const h = window.innerHeight || root.clientHeight;
  const scale = uiScaleFor(w, h, settings.uiScale, coarse);
  const changed = scale !== current;
  current = scale;
  root.style.setProperty('--ui-scale', String(scale));
  root.dataset.hudSafe = settings.hudSafeArea === 'full' ? 'full' : '16:9';
  return { scale, changed };
}

/** "UI size" label: Auto, or the multiplier as a percentage. */
export function uiScaleLabel(v) {
  return v === 'auto' ? 'Auto' : `${Math.round(v * 100)}%`;
}
