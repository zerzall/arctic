// The loading screen (#loading in index.html): a full-screen cover with the game's name, a moving
// bar, what is going on and a gameplay tip, so the player can tell the game is alive while the page
// is busy. It is visible from the first paint (plain HTML/CSS, no script needed) until the title
// screen is up, and again while a match or hideout is built (building the 3D world blocks the page
// for a moment: the bar is a CSS animation, which keeps moving while the page itself is busy).
// It never takes clicks (pointer-events: none), so it cannot get in the way of anything.

import { TIPS } from '../shared/story/dialogue/misc.js';

const FADE_MS = 350;
let hideTimer = null;

function el() {
  return typeof document !== 'undefined' ? document.getElementById('loading') : null;
}

/** A random gameplay tip (empty when none are available). */
export function randomTip() {
  return Array.isArray(TIPS) && TIPS.length ? TIPS[Math.floor(Math.random() * TIPS.length)] : '';
}

/**
 * Show the loading screen.
 * @param {string} text what is happening ("Building the world…")
 * @param {string} [sub] a second line (the map's name)
 * @param {string} [tip] a gameplay tip ('' for none)
 */
export function showLoading(text, sub = '', tip = '') {
  const e = el();
  if (!e) return;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  const set = (sel, v) => { const n = e.querySelector(sel); if (n) { n.textContent = v; n.hidden = !v; } };
  set('.loading-text', text);
  set('.loading-sub', sub);
  set('.loading-tip', tip ? `TIP — ${tip}` : '');
  // restart the "still working…" line's delay (CSS animation) for this load
  e.classList.remove('run', 'fade');
  e.hidden = false;
  void e.offsetWidth;
  e.classList.add('run');
}

/** Fade the loading screen out. */
export function hideLoading() {
  const e = el();
  if (!e || e.hidden) return;
  e.classList.add('fade');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { e.hidden = true; e.classList.remove('fade', 'run'); hideTimer = null; }, FADE_MS);
}

/** Is the loading screen up? */
export function isLoading() {
  const e = el();
  return !!e && !e.hidden;
}

/**
 * Keep the loading screen up until the game has drawn a few frames of the new match (the first
 * frames compile shaders and can hitch), then fade it out. Gives up after `maxMs`.
 * @param {() => number} frames current frame count of the match (0 while it is not running)
 * @param {number} [need] frames to wait for
 * @param {number} [maxMs]
 */
export function hideWhenDrawn(frames, need = 4, maxMs = 25000) {
  const t0 = Date.now();
  const tick = () => {
    let n = 0;
    try { n = frames() || 0; } catch { n = 0; }
    if (n >= need || Date.now() - t0 > maxMs) hideLoading();
    else setTimeout(tick, 100);
  };
  tick();
}
