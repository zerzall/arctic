// Small DOM helpers shared by the UI modules. The HUD runs every animation frame, so the
// setters below remember what they last wrote and skip the DOM when nothing changed —
// writing the same textContent or style every frame still costs style recalculation.

/** querySelector shorthand. */
export function $(sel, root = document) {
  return root.querySelector(sel);
}

/** querySelectorAll as an array. */
export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/**
 * Create an element.
 * @param {string} tag tag name with optional classes and an id: 'div.a.b', 'div.a#main'
 * @param {object} [attrs] attributes; `text` sets textContent, `on<event>` adds a listener,
 *   `dataset` merges data-*, `style` merges inline styles, false/null values are skipped
 * @param {Array|Node|string} [children]
 */
export function h(tag, attrs, children) {
  let id = '';
  if (tag.includes('#')) {
    // 'div.a#main.b': the id may sit anywhere after the tag name
    tag = tag.replace(/#([^.#]+)/, (_, v) => {
      id = v;
      return '';
    });
  }
  const parts = tag.split('.');
  const el = document.createElement(parts[0] || 'div');
  if (id) el.id = id;
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') {
        // Custom properties (--x) only work through setProperty.
        for (const sk of Object.keys(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
          else el.style[sk] = v[sk];
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  if (children !== undefined && children !== null) append(el, children);
  return el;
}

function append(el, children) {
  if (Array.isArray(children)) {
    for (const c of children) if (c !== null && c !== undefined && c !== false) append(el, c);
  } else if (children instanceof Node) {
    el.appendChild(children);
  } else {
    el.appendChild(document.createTextNode(String(children)));
  }
}

/** Set textContent only when it differs from what this helper last wrote. */
export function setText(el, value) {
  const v = value === null || value === undefined ? '' : String(value);
  if (el._hhText === v) return;
  el._hhText = v;
  el.textContent = v;
}

/** Set one inline style property only when it changed. */
export function setStyle(el, prop, value) {
  const key = '_hhS_' + prop;
  if (el[key] === value) return;
  el[key] = value;
  el.style.setProperty(prop, value);
}

/** Toggle a class only when its state changed. */
export function setClass(el, cls, on) {
  const key = '_hhC_' + cls;
  const b = !!on;
  if (el[key] === b) return;
  el[key] = b;
  el.classList.toggle(cls, b);
}

/** Show/hide via the hidden attribute, only touching the DOM on change. */
export function setShown(el, shown) {
  const b = !!shown;
  if (el._hhShown === b) return;
  el._hhShown = b;
  el.hidden = !b;
}

/** Set an attribute only when it changed. */
export function setAttr(el, name, value) {
  const key = '_hhA_' + name;
  const v = value === null || value === undefined ? null : String(value);
  if (el[key] === v) return;
  el[key] = v;
  if (v === null) el.removeAttribute(name);
  else el.setAttribute(name, v);
}

/**
 * Collects teardown callbacks so a screen or a match can release every listener, timer
 * and animation frame it created in one call.
 */
export function createScope() {
  const fns = [];
  return {
    /** addEventListener that is removed on dispose(). */
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      fns.push(() => target.removeEventListener(type, fn, opts));
      return fn;
    },
    /** Subscribe to an emitter-style object (on/off). */
    sub(emitter, type, fn) {
      emitter.on(type, fn);
      fns.push(() => emitter.off(type, fn));
      return fn;
    },
    timeout(fn, ms) {
      const id = setTimeout(fn, ms);
      fns.push(() => clearTimeout(id));
      return id;
    },
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      fns.push(() => clearInterval(id));
      return id;
    },
    add(fn) {
      fns.push(fn);
    },
    dispose() {
      while (fns.length) {
        const fn = fns.pop();
        try {
          fn();
        } catch (err) {
          console.error('[ui] teardown failed', err);
        }
      }
    },
  };
}

/** $1,234 */
export function formatCash(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return '$' + v.toLocaleString('en-US');
}

/** 1234 → "1.2k" for compact tables. */
export function formatShort(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(v) >= 1e4) return Math.round(v / 1e3) + 'k';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

/** Copy text to the clipboard, falling back to a hidden textarea for http:// pages. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' }, readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Whether the event target is a place where the user types (chat, name field...). */
export function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (t.type || 'text').toLowerCase();
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(type);
}

/**
 * Size a canvas's backing store to its CSS box × devicePixelRatio, so portraits and map
 * previews stay sharp on HiDPI screens and when the UI scale makes the box bigger. A canvas
 * that isn't laid out (hidden screen) keeps its size. Reads layout: call it when drawing,
 * not every frame.
 * @param {HTMLCanvasElement} canvas
 * @param {number} [maxDpr] cap on the pixel ratio (memory)
 * @returns {boolean} whether the backing size changed (the drawing was cleared)
 */
export function fitCanvas(canvas, maxDpr = 3) {
  const r = canvas.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  const dpr = Math.min(maxDpr, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const w = Math.max(1, Math.round(r.width * dpr));
  const hh = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width === w && canvas.height === hh) return false;
  canvas.width = w;
  canvas.height = hh;
  return true;
}
