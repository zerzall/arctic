// The loading screen (#loading in index.html): a full-screen cover with the game's name, a moving
// bar, what is going on and a gameplay tip, so the player can tell the game is alive while the page
// is busy. It is visible from the first paint (plain HTML/CSS, no script needed) until the title
// screen is up, and again while a match or hideout is built (building the 3D world blocks the page
// for a moment: the bar is a CSS animation, which keeps moving while the page itself is busy).
// It never takes clicks (pointer-events: none), so it cannot get in the way of anything.
//
// Background work after the build (the baked texture library, render3d/world-surf-bake.js) registers
// a load task: the screen shows its progress (a line and a filling bar) and stays up until every
// task is done, or for a while at most — after that the game shows and the work finishes behind it.

import { TIPS } from '../shared/story/dialogue/misc.js';

const FADE_MS = 350;
/** How long the screen waits for load tasks once the match is drawing (ms). */
export const TASK_WAIT_MS = 15000;
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
  renderTasks();
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

// ---- load tasks ---------------------------------------------------------------------------------

const tasks = new Map();
let taskSeq = 0;

/** The progress line and bar of the running tasks (created on demand inside #loading). */
function renderTasks() {
  const e = el();
  if (!e) return;
  let row = e.querySelector('.loading-task');
  if (!tasks.size) { if (row) row.hidden = true; return; }
  if (!row) {
    row = document.createElement('div');
    row.className = 'loading-task';
    row.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0.35rem;margin:0.2rem 0 0;';
    const label = document.createElement('p');
    label.className = 'loading-task-text';
    label.style.cssText = 'margin:0;font-size:0.95rem;color:#c9d1d9;letter-spacing:0.06em;text-transform:uppercase;';
    const bar = document.createElement('div');
    bar.style.cssText = 'width:min(30rem,70vw);height:0.35rem;background:#1a1e23;border:1px solid #2b3138;overflow:hidden;';
    const fill = document.createElement('div');
    fill.className = 'loading-task-fill';
    fill.style.cssText = 'height:100%;width:0;background:#ffc400;transition:width 0.25s ease;';
    bar.appendChild(fill);
    row.append(label, bar);
    const anchor = e.querySelector('.loading-sub') || e.querySelector('.loading-text');
    if (anchor && anchor.parentNode === e) anchor.after(row); else e.appendChild(row);
  }
  row.hidden = false;
  let f = 0, text = '';
  for (const t of tasks.values()) { f += t.frac; text = t.text || t.label; }
  f /= tasks.size;
  row.querySelector('.loading-task-text').textContent = text;
  row.querySelector('.loading-task-fill').style.width = `${Math.round(f * 100)}%`;
}

/**
 * Register background work the loading screen should show and wait for.
 * @param {string} label what is loading ("Loading textures…")
 * @returns {{ progress(frac: number, text?: string): void, done(): void }}
 */
export function beginLoadTask(label) {
  const id = ++taskSeq;
  tasks.set(id, { label, text: label, frac: 0 });
  renderTasks();
  return {
    progress(frac, text) {
      const t = tasks.get(id);
      if (!t) return;
      t.frac = Math.max(0, Math.min(1, frac));
      if (text) t.text = text;
      renderTasks();
    },
    done() {
      if (tasks.delete(id)) renderTasks();
    },
  };
}

/** How many load tasks are running. */
export function loadTasksPending() { return tasks.size; }

/**
 * Keep the loading screen up until the game has drawn a few frames of the new match (the first
 * frames compile shaders and can hitch) and the load tasks are done (TASK_WAIT_MS at most once the
 * frames are in), then fade it out. Gives up after `maxMs`.
 * @param {() => number} frames current frame count of the match (0 while it is not running)
 * @param {number} [need] frames to wait for
 * @param {number} [maxMs]
 */
export function hideWhenDrawn(frames, need = 4, maxMs = 25000) {
  const t0 = Date.now();
  let drawnAt = 0;
  const tick = () => {
    let n = 0;
    try { n = frames() || 0; } catch { n = 0; }
    if (n >= need && !drawnAt) drawnAt = Date.now();
    const tasksOk = !tasks.size || (drawnAt && Date.now() - drawnAt > TASK_WAIT_MS);
    if ((drawnAt && tasksOk) || Date.now() - t0 > maxMs + (tasks.size ? TASK_WAIT_MS : 0)) hideLoading();
    else setTimeout(tick, 100);
  };
  tick();
}
