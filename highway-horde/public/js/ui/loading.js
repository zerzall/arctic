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
//
// While a match is built the bar is determinate and names its stage (LOAD_STAGES: Loading map →
// Building world → Compiling shaders → Textures → Audio). The stages are driven by the real steps:
// the map the session already holds, the synchronous world build, the first frames drawn (where the
// shaders compile), the texture load tasks (render3d/world.js; window.__hhTexLoad lists the streamed
// sets) and the audio bank's bake progress. Before the first stage is reported (the page's own boot)
// the old moving stripe plays.

import { TIPS } from '../shared/story/dialogue/misc.js';

const FADE_MS = 350;
/** How long the screen waits for load tasks once the match is drawing (ms). */
export const TASK_WAIT_MS = 15000;
let hideTimer = null;

/**
 * The stages of building a match, in order, with their share of the bar (weights are rough
 * wall-clock shares of a typical first start; the bar only needs to be monotonic and honest).
 */
export const LOAD_STAGES = Object.freeze([
  Object.freeze({ id: 'map', label: 'Loading map', w: 1 }),
  Object.freeze({ id: 'world', label: 'Building world', w: 4 }),
  Object.freeze({ id: 'shaders', label: 'Compiling shaders', w: 3 }),
  Object.freeze({ id: 'textures', label: 'Textures', w: 4 }),
  Object.freeze({ id: 'audio', label: 'Audio', w: 1 }),
]);

/**
 * Overall progress 0..1 while `stageId` is `frac` done: the stages before it count in full.
 * An unknown stage is 0; a fraction outside 0..1 is clamped.
 */
export function loadProgress(stageId, frac = 0) {
  const total = LOAD_STAGES.reduce((a, st) => a + st.w, 0);
  let done = 0;
  for (const st of LOAD_STAGES) {
    if (st.id === stageId) {
      const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
      return (done + st.w * f) / total;
    }
    done += st.w;
  }
  return 0;
}

let stage = null; // { id, frac }

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
  e.classList.remove('run', 'fade', 'det');
  stage = null;
  e.hidden = false;
  void e.offsetWidth;
  e.classList.add('run');
  renderTasks();
}

/**
 * Report where the build of a match is: the stage (LOAD_STAGES id) and how far through it (0..1). Switches
 * the bar to its determinate form; the bar never moves backwards while one loading screen is up.
 */
export function setLoadStage(id, frac = 0, text = '') {
  const e = el();
  if (!e || e.hidden) return;
  const idx = LOAD_STAGES.findIndex((st) => st.id === id);
  if (idx < 0) return;
  const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
  if (stage) {
    const prev = LOAD_STAGES.findIndex((st) => st.id === stage.id);
    if (idx < prev || (idx === prev && f < stage.frac)) return;
  }
  stage = { id, frac: f };
  renderStages(e, idx, text);
}

/** The stage the loading screen reports now ({ id, frac, progress }), or null before the first report. */
export function currentLoadStage() {
  return stage ? { id: stage.id, frac: stage.frac, progress: loadProgress(stage.id, stage.frac) } : null;
}

function renderStages(e, idx, text) {
  e.classList.add('det');
  let box = e.querySelector('.loading-stages');
  if (!box) {
    box = document.createElement('ol');
    box.className = 'loading-stages';
    for (const st of LOAD_STAGES) {
      const li = document.createElement('li');
      li.dataset.stage = st.id;
      li.textContent = st.label;
      box.appendChild(li);
    }
    const bar = e.querySelector('.loading-bar');
    if (bar && bar.parentNode === e) bar.after(box); else e.appendChild(box);
  }
  const fill = e.querySelector('.loading-fill');
  const p = loadProgress(stage.id, stage.frac);
  if (fill) fill.style.width = `${(p * 100).toFixed(1)}%`;
  e.querySelectorAll('.loading-bar').forEach((b) => b.setAttribute('aria-valuenow', String(Math.round(p * 100))));
  const kids = box.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].classList.toggle('done', i < idx);
    kids[i].classList.toggle('now', i === idx);
  }
  const label = e.querySelector('.loading-text');
  if (label) label.textContent = `${text || LOAD_STAGES[idx].label}… ${Math.round(p * 100)}%`;
}

/** Fade the loading screen out. */
export function hideLoading() {
  const e = el();
  if (!e || e.hidden) return;
  e.classList.add('fade');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { e.hidden = true; e.classList.remove('fade', 'run'); hideTimer = null; }, FADE_MS);
}

/** Does the loading screen cover the game (up and not fading out)? Nothing behind it needs drawing. */
export function loadingCoverUp() {
  const e = el();
  return !!e && !e.hidden && !e.classList.contains('fade');
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

/** Audio gets this long (ms) to finish baking before the game shows regardless. */
export const AUDIO_WAIT_MS = 1500;

/** Progress 0..1 of the streamed texture work: the registered load tasks, else window.__hhTexLoad's flag. */
function textureFrac() {
  if (tasks.size) {
    let f = 0;
    for (const t of tasks.values()) f += t.frac;
    return f / tasks.size;
  }
  // no registered task: the streamed sets the renderer reports (window.__hhTexLoad, render3d/renderer3d.js)
  try {
    const t = typeof window !== 'undefined' && window.__hhTexLoad ? window.__hhTexLoad() : null;
    if (t) {
      const sets = [t.world, t.decals, t.zombies, t.guns].filter((x) => x && x !== 'off');
      if (sets.length) return sets.filter((x) => x !== 'loading').length / sets.length;
    }
  } catch {
    // the renderer is gone: nothing left to wait for
  }
  return 1;
}

/**
 * Keep the loading screen up until the game has drawn a few frames of the new match (the first
 * frames compile shaders and can hitch) and the load tasks are done (TASK_WAIT_MS at most once the
 * frames are in), then fade it out. Gives up after `maxMs`. The bar follows along: shaders = frames
 * drawn, textures = the load tasks, audio = `audio()`'s bake progress (waited for AUDIO_WAIT_MS at most).
 * @param {() => number} frames current frame count of the match (0 while it is not running)
 * @param {number} [need] frames to wait for
 * @param {number} [maxMs]
 * @param {() => ({ done: number, total: number }|null)} [audio] the audio bank's bake progress
 */
export function hideWhenDrawn(frames, need = 4, maxMs = 25000, audio = null) {
  const t0 = Date.now();
  let drawnAt = 0;
  let audioAt = 0;
  const tick = () => {
    let n = 0;
    try { n = frames() || 0; } catch { n = 0; }
    if (n >= need && !drawnAt) drawnAt = Date.now();
    const tasksOk = !tasks.size || (drawnAt && Date.now() - drawnAt > TASK_WAIT_MS);
    const timedOut = Date.now() - t0 > maxMs + (tasks.size ? TASK_WAIT_MS : 0);
    let audioOk = true;
    if (!drawnAt) {
      setLoadStage('shaders', n / need);
    } else if (tasks.size) {
      setLoadStage('textures', textureFrac());
    } else {
      setLoadStage('textures', textureFrac());
      let a = null;
      try { a = audio ? audio() : null; } catch { a = null; }
      if (a && a.total > 0 && a.done < a.total) {
        if (!audioAt) audioAt = Date.now();
        audioOk = Date.now() - audioAt > AUDIO_WAIT_MS;
        setLoadStage('audio', a.done / a.total);
      } else {
        setLoadStage('audio', 1);
      }
    }
    if ((drawnAt && tasksOk && audioOk) || timedOut) hideLoading();
    else setTimeout(tick, 100);
  };
  tick();
}
