// On-screen controls for phones and tablets: two floating virtual sticks (left half moves,
// right half aims and fires once pushed past FIRE_AT) plus action buttons. Pointer
// events with capture, so each finger stays bound to the control it started on.
//
// Look mode (first-person view, SPEC §7.5): the right half becomes a look pad — dragging a
// thumb there turns the camera (deltas in CSS px, consumed by read()) and the aim stick is
// hidden; a big FIRE button fires while held, and dragging a thumb that holds FIRE turns
// the camera too, so you can track a target while shooting.

import { h } from './dom.js';

const STICK_RADIUS = 56;
const FIRE_AT = 0.55;

/**
 * Buttons: [id, label, kind, cluster] — kind 'edge' fires once per tap, 'hold' is held,
 * 'toggle' flips. Clusters are laid out by CSS per orientation. JUMP is held (hold to keep
 * hopping) and also reports its taps, so a quick one between two samples still jumps.
 */
const BUTTONS = [
  ['pause', '❚❚', 'edge', 'util'],
  ['scoreboard', 'SCORES', 'toggle', 'util'],
  ['chat', 'CHAT', 'edge', 'util'],
  ['shop', 'SHOP', 'edge', 'util'],
  ['frag', 'FRAG', 'edge', 'gear'],
  ['molotov', 'MOLO', 'edge', 'gear'],
  ['turret', 'TURRET', 'edge', 'gear'],
  ['barricade', 'WALL', 'edge', 'gear'],
  ['melee', 'SHOVE', 'hold', 'main'],
  ['cycle', 'SWAP', 'edge', 'main'],
  ['reload', 'RELOAD', 'edge', 'main'],
  ['interact', 'USE', 'hold', 'main'],
  ['jump', 'JUMP', 'hold', 'jump'],
  ['ready', 'READY', 'edge', 'solo'],
  ['fire', 'FIRE', 'hold', 'fire'],
];

/** True on phones/tablets (coarse primary pointer or touch-only devices). */
export function isTouchDevice() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  } catch {
    // ignore
  }
  return (navigator.maxTouchPoints || 0) > 0 && !(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
}

function createStick(zone, side) {
  const knob = h('div.stick-knob');
  const base = h('div.stick-base', { 'aria-hidden': 'true' }, knob);
  zone.appendChild(base);
  const s = { id: -1, ox: 0, oy: 0, x: 0, y: 0, m: 0, base, knob, side };
  return s;
}

/**
 * Mount touch controls inside `root`.
 * @param {HTMLElement} root
 * @returns {{ read: Function, reset: Function, setEnabled: Function, destroy: Function, el: HTMLElement }}
 */
export function createTouchControls(root) {
  const zoneL = h('div.touch-zone.touch-zone-left');
  const zoneR = h('div.touch-zone.touch-zone-right');
  const clusters = {
    util: h('div.tc.tc-util'),
    gear: h('div.tc.tc-gear'),
    main: h('div.tc.tc-main'),
    jump: h('div.tc.tc-jump'),
    solo: h('div.tc.tc-solo'),
    fire: h('div.tc.tc-fire'),
  };
  const btnWrap = h('div.touch-buttons', null, Object.values(clusters));
  const el = h('div.touch-layer', { 'aria-hidden': 'true' }, [zoneL, zoneR, btnWrap]);
  const move = createStick(zoneL, 'left');
  const aim = createStick(zoneR, 'right');

  const held = { interact: false, melee: false, scoreboard: false, fire: false, jump: false };
  // look mode: accumulated drag (CSS px) since the last read(), and the look pointer
  let lookMode = false;
  let lookDX = 0, lookDY = 0;
  const lookPtr = { id: -1, x: 0, y: 0 };
  const firePtr = { id: -1, x: 0, y: 0 };
  const edges = {};
  const buttonEls = {};
  const listeners = [];
  let enabled = true;
  let activeUntil = 0;

  function on(target, type, fn, o) {
    target.addEventListener(type, fn, o);
    listeners.push(() => target.removeEventListener(type, fn, o));
  }

  for (const [id, label, kind, cluster] of BUTTONS) {
    const b = h('div.touch-btn', { dataset: { id }, class: `touch-btn-${id}` }, h('span', { text: label }));
    buttonEls[id] = b;
    clusters[cluster].appendChild(b);
    edges[id] = 0;
    let pointer = -1;
    on(b, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activeUntil = performance.now() + 500;
      pointer = e.pointerId;
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        // capture is best-effort
      }
      b.classList.add('pressed');
      if (id === 'fire') {
        firePtr.id = e.pointerId;
        firePtr.x = e.clientX;
        firePtr.y = e.clientY;
      }
      if (kind === 'edge' || id === 'jump') edges[id]++;
      if (kind === 'hold') held[id] = true;
      else if (kind === 'toggle') held[id] = !held[id];
      if (kind === 'toggle') b.classList.toggle('on', held[id]);
      if (navigator.vibrate) {
        try {
          navigator.vibrate(8);
        } catch {
          // not allowed before a user gesture on some browsers
        }
      }
    });
    if (id === 'fire') {
      on(b, 'pointermove', (e) => {
        if (e.pointerId !== firePtr.id || !lookMode) return;
        e.preventDefault();
        activeUntil = performance.now() + 500;
        lookDX += e.clientX - firePtr.x;
        lookDY += e.clientY - firePtr.y;
        firePtr.x = e.clientX;
        firePtr.y = e.clientY;
      });
    }
    const up = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = -1;
      if (id === 'fire') firePtr.id = -1;
      b.classList.remove('pressed');
      if (kind === 'hold') held[id] = false;
    };
    on(b, 'pointerup', up);
    on(b, 'pointercancel', up);
    on(b, 'lostpointercapture', up);
  }

  function place(s, e) {
    const r = s.base.parentElement.getBoundingClientRect();
    s.ox = e.clientX - r.left;
    s.oy = e.clientY - r.top;
    s.base.style.transform = `translate(${s.ox - STICK_RADIUS}px, ${s.oy - STICK_RADIUS}px)`;
    s.base.classList.add('active');
  }

  function drag(s, e) {
    const r = s.base.parentElement.getBoundingClientRect();
    let dx = e.clientX - r.left - s.ox;
    let dy = e.clientY - r.top - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) {
      // Let the stick follow a thumb that slides far off, so direction changes stay quick.
      const over = d - STICK_RADIUS;
      s.ox += (dx / d) * over;
      s.oy += (dy / d) * over;
      s.base.style.transform = `translate(${s.ox - STICK_RADIUS}px, ${s.oy - STICK_RADIUS}px)`;
      dx = (dx / d) * STICK_RADIUS;
      dy = (dy / d) * STICK_RADIUS;
    }
    const m = Math.hypot(dx, dy) / STICK_RADIUS;
    const dead = 0.12;
    if (m < dead) {
      s.x = s.y = s.m = 0;
    } else {
      const k = (m - dead) / (1 - dead);
      s.x = (dx / (m * STICK_RADIUS)) * k;
      s.y = (dy / (m * STICK_RADIUS)) * k;
      s.m = k;
    }
    s.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (s === aim) s.base.classList.toggle('firing', s.m > FIRE_AT);
  }

  function release(s) {
    s.id = -1;
    s.x = s.y = s.m = 0;
    s.knob.style.transform = '';
    s.base.style.transform = '';
    s.base.classList.remove('active', 'firing');
  }

  function bindZone(zone, s) {
    on(zone, 'pointerdown', (e) => {
      if (s.id !== -1 || (lookMode && s === aim)) return;
      e.preventDefault();
      activeUntil = performance.now() + 500;
      s.id = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      place(s, e);
      drag(s, e);
    });
    on(zone, 'pointermove', (e) => {
      if (e.pointerId !== s.id) return;
      e.preventDefault();
      activeUntil = performance.now() + 500;
      drag(s, e);
    });
    const end = (e) => {
      if (e.pointerId === s.id) release(s);
    };
    on(zone, 'pointerup', end);
    on(zone, 'pointercancel', end);
    on(zone, 'lostpointercapture', end);
  }
  bindZone(zoneL, move);
  bindZone(zoneR, aim);

  // Look pad: the right zone in look mode. Registered after the stick handlers, which
  // ignore the events while look mode is on (see bindZone's guard).
  on(zoneR, 'pointerdown', (e) => {
    if (!lookMode || lookPtr.id !== -1) return;
    e.preventDefault();
    activeUntil = performance.now() + 500;
    lookPtr.id = e.pointerId;
    lookPtr.x = e.clientX;
    lookPtr.y = e.clientY;
    try {
      zoneR.setPointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
  });
  on(zoneR, 'pointermove', (e) => {
    if (!lookMode || e.pointerId !== lookPtr.id) return;
    e.preventDefault();
    activeUntil = performance.now() + 500;
    lookDX += e.clientX - lookPtr.x;
    lookDY += e.clientY - lookPtr.y;
    lookPtr.x = e.clientX;
    lookPtr.y = e.clientY;
  });
  const lookEnd = (e) => {
    if (e.pointerId === lookPtr.id) lookPtr.id = -1;
  };
  on(zoneR, 'pointerup', lookEnd);
  on(zoneR, 'pointercancel', lookEnd);
  on(zoneR, 'lostpointercapture', lookEnd);
  on(el, 'contextmenu', (e) => e.preventDefault());

  buttonEls.fire.hidden = true;
  root.appendChild(el);
  // Lets CSS tell touch play apart from a narrow desktop window.
  document.body.classList.add('touch-ui');

  return {
    el,
    /** Current touch state; edge counters are consumed. */
    read() {
      const out = {
        active: move.id !== -1 || aim.id !== -1 || performance.now() < activeUntil,
        moveX: move.x, moveY: move.y, moveM: move.m,
        aimX: aim.x, aimY: aim.y, aimM: aim.m,
        fire: lookMode ? held.fire : aim.m > FIRE_AT,
        interact: held.interact, melee: held.melee, scoreboard: held.scoreboard, jump: held.jump,
        lookDX, lookDY,
        edges: {},
      };
      if (lookPtr.id !== -1 || firePtr.id !== -1) out.active = true;
      lookDX = 0;
      lookDY = 0;
      for (const k of Object.keys(edges)) {
        out.edges[k] = edges[k];
        edges[k] = 0;
      }
      return out;
    },
    reset() {
      release(move);
      release(aim);
      held.interact = held.melee = held.fire = held.jump = false;
      lookPtr.id = firePtr.id = -1;
      lookDX = lookDY = 0;
      for (const b of Object.values(buttonEls)) b.classList.remove('pressed');
    },
    setEnabled(b) {
      enabled = !!b;
      el.classList.toggle('disabled', !enabled);
      if (!enabled) {
        release(move);
        release(aim);
        held.interact = held.melee = held.fire = held.jump = false;
        lookPtr.id = firePtr.id = -1;
        lookDX = lookDY = 0;
        buttonEls.fire.classList.remove('pressed');
        buttonEls.jump.classList.remove('pressed');
      }
    },
    /**
     * First-person look mode: right half = look pad (aim stick hidden), FIRE button shown.
     * @param {boolean} onOff
     */
    setLookMode(onOff) {
      lookMode = !!onOff;
      el.classList.toggle('look-mode', lookMode);
      buttonEls.fire.hidden = !lookMode;
      release(aim);
      lookPtr.id = firePtr.id = -1;
      held.fire = false;
      lookDX = lookDY = 0;
    },
    get lookMode() {
      return lookMode;
    },
    /** Show/hide individual buttons (e.g. READY only between waves). */
    showButton(id, shown) {
      const b = buttonEls[id];
      if (b && b.hidden === !!shown) b.hidden = !shown;
    },
    /** Reflect a held toggle that was changed from elsewhere (scoreboard closed by a tap). */
    setToggle(id, on) {
      if (id in held) held[id] = !!on;
      const b = buttonEls[id];
      if (b) b.classList.toggle('on', !!on);
    },
    destroy() {
      for (const off of listeners) off();
      listeners.length = 0;
      el.remove();
      document.body.classList.remove('touch-ui');
    },
  };
}
