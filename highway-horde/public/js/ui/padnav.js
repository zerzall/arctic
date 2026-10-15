// Gamepad navigation for overlays (pause menu, end screen, dialogs): the D-pad moves
// focus between the visible controls, A activates, left/right nudge sliders.

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [role="radio"]:not([aria-disabled="true"])';

function visible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && !el.closest('[hidden]');
}

/**
 * Apply one frame of gamepad menu edges to `root`.
 * @param {HTMLElement} root the open overlay or dialog
 * @param {{up, down, left, right, accept, back}} nav edges from input.sample().nav
 * @returns {boolean} whether something was handled
 */
export function padNavigate(root, nav) {
  if (!root || !nav) return false;
  const items = Array.from(root.querySelectorAll(FOCUSABLE)).filter(visible);
  if (!items.length) return false;
  const active = document.activeElement;
  let i = items.indexOf(active);
  if (active && active.type === 'range' && (nav.left || nav.right)) {
    const step = (Number(active.step) || 1) * 5;
    active.value = String(Number(active.value) + (nav.right ? step : -step));
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const back = nav.up || nav.left;
  const fwd = nav.down || nav.right;
  if (back || fwd) {
    i = i < 0 ? 0 : (i + (fwd ? 1 : -1) + items.length) % items.length;
    items[i].focus({ preventScroll: false });
    return true;
  }
  if (nav.accept) {
    const target = i >= 0 ? items[i] : items[0];
    if (target.type === 'range') return false;
    target.click();
    return true;
  }
  return false;
}
