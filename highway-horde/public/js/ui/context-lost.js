// The graphics context was lost (render3d/renderer3d.js dispatches 'hh:webglcontextlost' on window):
// the OS reclaimed the GPU memory (phones under memory pressure) or the driver reset. The 3D view
// cannot come back with its streamed textures, so a message with a Reload button covers the page
// instead of leaving a frozen picture (SPEC §7.5.3).

let shown = null;

/** Show the "graphics stopped" message (once; idempotent). → the overlay element. */
export function showContextLost(doc = document) {
  if (shown && shown.isConnected) return shown;
  const box = doc.createElement('div');
  box.className = 'hh-context-lost';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-live', 'assertive');
  Object.assign(box.style, {
    position: 'fixed', inset: '0', zIndex: '10000', display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: '1rem', padding: '1.5rem', textAlign: 'center', background: 'rgba(8, 9, 12, 0.92)', color: '#e8e6e1',
    font: '1rem/1.4 system-ui, sans-serif',
  });
  const h = doc.createElement('h2');
  h.textContent = 'The graphics stopped';
  h.style.margin = '0';
  const p = doc.createElement('p');
  p.style.margin = '0';
  p.style.maxWidth = '28rem';
  p.textContent = 'Your browser took the 3D view\'s graphics memory back (this happens on phones when memory runs low). Reload to play on; on a phone, the Low graphics preset uses the least memory.';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary btn-big';
  btn.textContent = 'Reload';
  btn.addEventListener('click', () => location.reload());
  box.append(h, p, btn);
  doc.body.appendChild(box);
  try { btn.focus(); } catch { /* (not focusable yet) */ }
  try { if (doc.pointerLockElement && doc.exitPointerLock) doc.exitPointerLock(); } catch { /* (no lock) */ }
  shown = box;
  return box;
}

/** Listen for the renderer's event (ui/main.js). */
export function installContextLostHandler(win = window) {
  win.addEventListener('hh:webglcontextlost', () => showContextLost(win.document));
}
