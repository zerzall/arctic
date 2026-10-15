// Fullscreen for PC players (title screen, pause menu and settings all toggle it).
//
// Pointer lock and fullscreen share the Esc key. Browsers release the mouse and leave
// fullscreen on the same press, which throws a player out of fullscreen every time they
// open the pause menu. Where the Keyboard Lock API exists (Chromium desktop) we claim Esc
// while fullscreen: a press then reaches the game (pause menu, mouse released) and holding
// Esc still leaves fullscreen — the browser shows that hint itself. Elsewhere the
// browser's own behaviour applies.

/** @returns {boolean} whether this page can go fullscreen at all (iPhone Safari can't) */
export function fullscreenSupported(doc = document) {
  const el = doc.documentElement;
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
    && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

/** @returns {boolean} */
export function isFullscreen(doc = document) {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

function lockEscape() {
  const kb = navigator.keyboard;
  if (!kb || typeof kb.lock !== 'function') return;
  try {
    const p = kb.lock(['Escape']);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // not allowed here: the browser's default Esc handling stays
  }
}

function unlockEscape() {
  const kb = navigator.keyboard;
  if (kb && typeof kb.unlock === 'function') {
    try {
      kb.unlock();
    } catch {
      // nothing locked
    }
  }
}

/**
 * Enter fullscreen (needs a user gesture). Resolves true on success, false otherwise —
 * never rejects, so callers can fire and forget.
 * @returns {Promise<boolean>}
 */
export async function enterFullscreen(doc = document) {
  if (isFullscreen(doc)) return true;
  if (!fullscreenSupported(doc)) return false;
  const el = doc.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else el.webkitRequestFullscreen();
  } catch {
    return false;
  }
  lockEscape();
  return isFullscreen(doc);
}

/** @returns {Promise<boolean>} true when fullscreen was left (or wasn't on) */
export async function exitFullscreen(doc = document) {
  unlockEscape();
  if (!isFullscreen(doc)) return true;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  } catch {
    return false;
  }
  return !isFullscreen(doc);
}

/** @returns {Promise<boolean>} whether the page is fullscreen afterwards */
export async function toggleFullscreen(doc = document) {
  if (isFullscreen(doc)) {
    await exitFullscreen(doc);
    return isFullscreen(doc);
  }
  return enterFullscreen(doc);
}

/**
 * Call fn(isFullscreen) whenever fullscreen changes (also releases the Esc key lock when
 * the browser left fullscreen by itself). @returns a function that removes the listener
 */
export function onFullscreenChange(fn, doc = document) {
  const handler = () => {
    const on = isFullscreen(doc);
    if (!on) unlockEscape();
    fn(on);
  };
  doc.addEventListener('fullscreenchange', handler);
  doc.addEventListener('webkitfullscreenchange', handler);
  return () => {
    doc.removeEventListener('fullscreenchange', handler);
    doc.removeEventListener('webkitfullscreenchange', handler);
  };
}
