// Player input (SPEC §7.2): keyboard + mouse, standard-mapping gamepads and touch, merged
// into one InputState per animation frame.
//
// Held fields (fire, melee, sprint, interact, scoreboard) reflect the button right now.
// Edge fields (reload, frag, ..., shop, chat, ready, pause) count presses since the last
// sample() and are true in exactly one sample. Gameplay fields are neutral while the input
// is disabled (menus, chat, shop), but the UI edges keep working so Esc/B/Tab can close
// whatever is open. Key presses aimed at text fields never reach the game at all.
//
// View 'fps' (first person, SPEC §7.5): sample() also reports lookDX/lookDY — mouse
// movement under pointer lock, touch look-pad drags and the gamepad right stick (as an
// equivalent delta per frame), in CSS px since the last sample. Clicking the canvas
// requests pointer lock (that click doesn't fire); the owner hears about lock changes
// through opts.onLockChange. View 'topdown' keeps the cursor aim of §7.2 unchanged.

import { createTouchControls, isTouchDevice } from './touch.js';
import { isTypingTarget } from './dom.js';
import { padLookDelta, TOUCH_LOOK_GAIN } from './look.js';

/** Keyboard layout (KeyboardEvent.code, so WASD works on AZERTY/Dvorak too). */
const KEY_UP = ['KeyW', 'ArrowUp'];
const KEY_DOWN = ['KeyS', 'ArrowDown'];
const KEY_LEFT = ['KeyA', 'ArrowLeft'];
const KEY_RIGHT = ['KeyD', 'ArrowRight'];
const HELD_KEYS = {
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact',
  KeyV: 'melee',
  Tab: 'scoreboard',
};
const EDGE_KEYS = {
  KeyR: 'reload', KeyG: 'frag', KeyF: 'molotov', KeyT: 'turret', KeyC: 'barricade', KeyQ: 'lastWeapon',
  KeyB: 'shop', Enter: 'chat', NumpadEnter: 'chat', Space: 'ready', Escape: 'pause',
};
const SLOT_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };
/** Keys whose browser default (scrolling, focus moves) must not happen during play. */
const PREVENT = new Set([
  'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyF', 'KeyG', 'Quote', 'Slash',
]);

const GAMEPLAY_EDGES = ['reload', 'frag', 'molotov', 'turret', 'barricade', 'lastWeapon'];
const UI_EDGES = ['shop', 'chat', 'ready', 'pause'];
const NAV_EDGES = ['up', 'down', 'left', 'right', 'accept', 'back', 'tabPrev', 'tabNext'];

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping).
const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
const STICK_DEAD = 0.22;
const TRIGGER_ON = 0.35;
/** Screen distance of the pad/touch aim point from the player, px (scaled by stick). */
const AIM_MIN = 150;
const AIM_MAX = 270;
/** Seconds without aiming after which the character faces where it walks. */
const AIM_IDLE = 0.45;
const WHEEL_PX_PER_STEP = 60;
/** A pointer-locked mousemove bigger than this (px) is a browser glitch, not a flick. */
const LOOK_GLITCH_PX = 400;

function deadzone(x, y) {
  const m = Math.hypot(x, y);
  if (m < STICK_DEAD) return { x: 0, y: 0, m: 0 };
  const k = Math.min(1, (m - STICK_DEAD) / (1 - STICK_DEAD)) / m;
  return { x: x * k, y: y * k, m: Math.min(1, m * k) };
}

function newEdges(names) {
  const o = {};
  for (const n of names) o[n] = 0;
  return o;
}

/**
 * Create the input system bound to the game canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {HTMLElement} [opts.touchRoot] where the touch controls are mounted (default: canvas parent)
 * @param {boolean} [opts.forceTouch] show touch controls regardless of the device
 * @param {'fps'|'topdown'} [opts.view] 'fps' = first-person look (default 'topdown')
 * @param {Function} [opts.onLockChange] (locked: boolean) after pointer lock is gained/lost
 * @param {boolean} [opts.rawMouse] ask for raw (unaccelerated) locked movement (default true)
 * @returns {{ sample: Function, setEnabled: Function, setAnchor: Function, cursor: {x: number, y: number},
 *   mode: string, destroy: Function, releaseAll: Function, touch: object|null, view: string,
 *   locked: boolean, requestLock: Function, exitLock: Function, addLook: Function }}
 */
export function createInput(canvas, opts = {}) {
  const win = canvas.ownerDocument.defaultView || window;
  const doc = canvas.ownerDocument;
  const keys = new Set();
  const mouse = { left: false, right: false };
  const edges = newEdges([...GAMEPLAY_EDGES, ...UI_EDGES]);
  const nav = newEdges(NAV_EDGES);
  let slot = -1;
  let cycle = 0;
  let wheelAcc = 0;
  let enabled = true;
  let destroyed = false;
  const cursor = { x: 0, y: 0 };
  const anchor = { x: 0, y: 0, set: false };
  let mode = 'kbm';
  let lastMouse = { x: -1, y: -1 };

  // gamepad state
  let padPrev = [];
  let padIndex = -1;
  let padSprintToggle = false;
  let aimAngle = 0;
  let aimDist = AIM_MIN;
  let aimIdle = 99;
  let lastSampleAt = 0;

  // first-person look
  let view = opts.view === 'fps' ? 'fps' : 'topdown';
  let lookDX = 0, lookDY = 0;
  let locked = false;
  let skipLookMove = false;
  // Raw mouse input (pointer lock without OS acceleration): the rawMouse setting asks for
  // it, and it is dropped for good once the platform refuses (e.g. Linux, Firefox).
  let rawWanted = opts.rawMouse !== false;
  let unadjusted = true;
  const padLook = { dx: 0, dy: 0 };

  const listeners = [];
  function on(target, type, fn, o) {
    target.addEventListener(type, fn, o);
    listeners.push(() => target.removeEventListener(type, fn, o));
  }

  function canvasPoint(clientX, clientY, out) {
    const r = canvas.getBoundingClientRect();
    out.x = clientX - r.left;
    out.y = clientY - r.top;
    return out;
  }

  function centre() {
    const r = canvas.getBoundingClientRect();
    return { x: anchor.set ? anchor.x : r.width / 2, y: anchor.set ? anchor.y : r.height / 2 };
  }

  // ---- keyboard ---------------------------------------------------------------------

  function onKeyDown(e) {
    if (destroyed) return;
    if (isTypingTarget(e.target)) return;
    const code = e.code;
    // A focused button in an overlay owns Enter/Space (activates it), not the game.
    const t = e.target;
    const onControl = t && t !== doc.body && t !== canvas && t.closest && t.closest('button, a, [role="button"], input, select');
    if (onControl && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) return;
    if (enabled && PREVENT.has(code)) e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    mode = 'kbm';
    keys.add(code);
    if (e.repeat) return;
    const edge = EDGE_KEYS[code];
    if (edge) edges[edge]++;
    if (code in SLOT_KEYS) slot = SLOT_KEYS[code];
  }

  function onKeyUp(e) {
    // Never filtered: a key released inside the chat box must still stop the player.
    keys.delete(e.code);
    if (e.key === 'Meta') keys.clear(); // macOS swallows keyups while Cmd is held
  }

  // ---- mouse --------------------------------------------------------------------------

  function onMouseDown(e) {
    if (destroyed) return;
    const fromTouch = !!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);
    mode = 'kbm';
    canvasPoint(e.clientX, e.clientY, cursor);
    // First person without the lock: this click captures the mouse; it doesn't shoot.
    // (A tap's compatibility mousedown never asks: phones look with the touch pad.)
    if (view === 'fps' && !locked && enabled && lockSupported() && !fromTouch) {
      requestLock();
      return;
    }
    if (e.button === 0) mouse.left = true;
    else if (e.button === 2) mouse.right = true;
    else if (e.button === 1) {
      edges.lastWeapon++;
      e.preventDefault();
    }
  }

  function onMouseUp(e) {
    if (e.button === 0) mouse.left = false;
    else if (e.button === 2) mouse.right = false;
  }

  function onMouseMove(e) {
    if (destroyed) return;
    // Ignore the synthetic mousemove some browsers fire after touches.
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    if (Math.abs(e.clientX - lastMouse.x) + Math.abs(e.clientY - lastMouse.y) > 2) mode = 'kbm';
    lastMouse = { x: e.clientX, y: e.clientY };
    if (view === 'fps' && locked) {
      // The first event after locking can carry the jump to the lock position.
      if (skipLookMove) {
        skipLookMove = false;
        return;
      }
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) > LOOK_GLITCH_PX || Math.abs(my) > LOOK_GLITCH_PX) return;
      if (mx || my) mode = 'kbm';
      if (enabled) {
        lookDX += mx;
        lookDY += my;
      }
      return;
    }
    canvasPoint(e.clientX, e.clientY, cursor);
  }

  // ---- pointer lock (first person) --------------------------------------------------

  function lockSupported() {
    return typeof canvas.requestPointerLock === 'function';
  }

  function requestLock() {
    if (destroyed || locked || !lockSupported()) return;
    const plain = () => {
      try {
        const q = canvas.requestPointerLock();
        if (q && typeof q.catch === 'function') q.catch(() => {});
      } catch {
        // no user activation / not allowed right now: the next click tries again
      }
    };
    if (!unadjusted || !rawWanted) {
      plain();
      return;
    }
    let p = null;
    try {
      p = canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      unadjusted = false;
      plain();
      return;
    }
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        // Raw input isn't available on every platform (e.g. Linux): lock without it.
        if (err && err.name === 'NotSupportedError') {
          unadjusted = false;
          plain();
        }
      });
    }
  }

  function exitLock() {
    if (locked && doc.exitPointerLock) {
      try {
        doc.exitPointerLock();
      } catch {
        // already released
      }
    }
  }

  function onLockChange() {
    const now = doc.pointerLockElement === canvas;
    if (now === locked) return;
    locked = now;
    skipLookMove = now;
    lookDX = lookDY = 0;
    if (!now) {
      // Esc released the lock: nobody keeps firing or running into the horde.
      mouse.left = mouse.right = false;
    }
    if (opts.onLockChange) opts.onLockChange(now);
  }

  function onWheel(e) {
    e.preventDefault();
    if (!enabled) return;
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    wheelAcc += px;
    // Trackpads produce many tiny deltas; one notch of a mouse wheel is ~100 px.
    while (wheelAcc >= WHEEL_PX_PER_STEP) {
      cycle++;
      wheelAcc -= WHEEL_PX_PER_STEP;
    }
    while (wheelAcc <= -WHEEL_PX_PER_STEP) {
      cycle--;
      wheelAcc += WHEEL_PX_PER_STEP;
    }
    // A single small notch should still count.
    if (cycle === 0 && Math.abs(px) >= 4 && Math.abs(px) < WHEEL_PX_PER_STEP && e.deltaMode !== 0) {
      cycle = Math.sign(px);
      wheelAcc = 0;
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function releaseAll() {
    keys.clear();
    mouse.left = mouse.right = false;
    padSprintToggle = false;
    if (touch) touch.reset();
  }

  function onVisibility() {
    if (doc.visibilityState !== 'visible') releaseAll();
  }

  on(win, 'keydown', onKeyDown);
  on(win, 'keyup', onKeyUp);
  on(canvas, 'mousedown', onMouseDown);
  on(win, 'mouseup', onMouseUp);
  on(win, 'mousemove', onMouseMove);
  on(canvas, 'wheel', onWheel, { passive: false });
  on(canvas, 'contextmenu', onContextMenu);
  on(win, 'blur', releaseAll);
  on(doc, 'visibilitychange', onVisibility);
  on(doc, 'pointerlockchange', onLockChange);

  // ---- touch --------------------------------------------------------------------------

  let touch = null;
  function ensureTouch() {
    if (touch || destroyed) return;
    touch = createTouchControls(opts.touchRoot || canvas.parentElement);
    touch.setLookMode(view === 'fps');
    mode = 'touch';
  }
  if (opts.forceTouch || isTouchDevice()) ensureTouch();
  // A touchscreen laptop may report a fine pointer; show the controls on the first touch.
  on(win, 'touchstart', () => {
    ensureTouch();
    mode = 'touch';
  }, { passive: true });

  // ---- gamepad ------------------------------------------------------------------------

  function readPad() {
    if (!navigator.getGamepads) return null;
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    if (!pads) return null;
    if (padIndex >= 0 && pads[padIndex] && pads[padIndex].connected) return pads[padIndex];
    for (const p of pads) {
      if (p && p.connected && p.buttons.length >= 16) {
        padIndex = p.index;
        padPrev = [];
        return p;
      }
    }
    return null;
  }

  function btn(p, i) {
    const b = p.buttons[i];
    if (!b) return false;
    return i === PAD.LT || i === PAD.RT ? b.value > TRIGGER_ON || (b.pressed && b.value === 0) : b.pressed;
  }

  // ---- sample -------------------------------------------------------------------------

  function anyKey(list) {
    for (const k of list) if (keys.has(k)) return true;
    return false;
  }

  function sample() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = lastSampleAt ? Math.min(0.25, now - lastSampleAt) : 0;
    lastSampleAt = now;

    let moveX = (anyKey(KEY_RIGHT) ? 1 : 0) - (anyKey(KEY_LEFT) ? 1 : 0);
    let moveY = (anyKey(KEY_DOWN) ? 1 : 0) - (anyKey(KEY_UP) ? 1 : 0);
    let fire = mouse.left;
    let melee = mouse.right || keys.has('KeyV');
    let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    let interact = keys.has('KeyE');
    let scoreboard = keys.has('Tab');
    let aimX = cursor.x, aimY = cursor.y;
    let aiming = false;

    // gamepad
    const p = readPad();
    if (p) {
      const cur = [];
      for (let i = 0; i < p.buttons.length; i++) cur[i] = btn(p, i);
      const pressed = (i) => cur[i] && !padPrev[i];
      const ls = deadzone(p.axes[0] || 0, p.axes[1] || 0);
      const rs = deadzone(p.axes[2] || 0, p.axes[3] || 0);
      let active = ls.m > 0 || rs.m > 0;
      for (let i = 0; i < cur.length; i++) if (cur[i]) active = true;
      if (active) mode = 'pad';
      if (mode === 'pad') {
        if (ls.m > 0) {
          moveX = ls.x;
          moveY = ls.y;
        }
        if (pressed(PAD.L3)) padSprintToggle = !padSprintToggle;
        if (ls.m < 0.3) padSprintToggle = false;
        if (padSprintToggle) sprint = true;
        if (view === 'fps') {
          if (rs.m > 0) {
            padLookDelta(rs.x, rs.y, dt, padLook);
            lookDX += padLook.dx;
            lookDY += padLook.dy;
          }
        } else if (rs.m > 0) {
          aimAngle = Math.atan2(rs.y, rs.x);
          aimDist = AIM_MIN + (AIM_MAX - AIM_MIN) * rs.m;
          aiming = true;
        }
        if (cur[PAD.RT]) fire = true;
        if (cur[PAD.LT] || cur[PAD.RB]) melee = true;
        if (cur[PAD.A]) interact = true;
        if (cur[PAD.BACK]) scoreboard = true;
        if (pressed(PAD.X)) edges.reload++;
        if (pressed(PAD.Y)) cycle++;
        if (pressed(PAD.LB)) edges.frag++;
        if (pressed(PAD.B)) edges.molotov++;
        if (pressed(PAD.UP)) edges.turret++;
        if (pressed(PAD.DOWN)) edges.barricade++;
        if (pressed(PAD.RIGHT)) edges.lastWeapon++;
        if (pressed(PAD.LEFT)) edges.ready++;
        if (pressed(PAD.R3)) edges.shop++;
        if (pressed(PAD.START)) edges.pause++;
      }
      // Menu navigation edges are reported regardless of mode (the shop reads them).
      if (pressed(PAD.UP)) nav.up++;
      if (pressed(PAD.DOWN)) nav.down++;
      if (pressed(PAD.LEFT)) nav.left++;
      if (pressed(PAD.RIGHT)) nav.right++;
      if (pressed(PAD.A)) nav.accept++;
      if (pressed(PAD.B)) nav.back++;
      if (pressed(PAD.LB)) nav.tabPrev++;
      if (pressed(PAD.RB)) nav.tabNext++;
      padPrev = cur;
    }

    // touch
    if (touch) {
      const t = touch.read();
      // (a look drag counts even when its last event is older than the activity window:
      // at low frame rates a whole swipe fits between two samples)
      if (t.active || t.lookDX || t.lookDY) mode = 'touch';
      if (mode === 'touch') {
        if (t.moveM > 0) {
          moveX = t.moveX;
          moveY = t.moveY;
        }
        if (t.moveM > 0.96) sprint = true;
        if (t.lookDX || t.lookDY) {
          lookDX += t.lookDX * TOUCH_LOOK_GAIN;
          lookDY += t.lookDY * TOUCH_LOOK_GAIN;
        }
        if (t.aimM > 0) {
          aimAngle = Math.atan2(t.aimY, t.aimX);
          aimDist = AIM_MIN + (AIM_MAX - AIM_MIN) * t.aimM;
          aiming = true;
        }
        if (t.fire) fire = true;
        if (t.melee) melee = true;
        if (t.interact) interact = true;
        if (t.scoreboard) scoreboard = true;
        for (const k of Object.keys(t.edges)) {
          const n = t.edges[k];
          if (!n) continue;
          if (k === 'cycle') cycle += n;
          else if (k in edges) edges[k] += n;
        }
      }
    }

    // pad/touch aim point: projected in front of the player so the crosshair follows the stick
    // (top-down only: in first person the camera is the aim)
    if (mode !== 'kbm' && view !== 'fps') {
      if (aiming) {
        aimIdle = 0;
      } else {
        aimIdle += dt;
        if (aimIdle > AIM_IDLE && Math.hypot(moveX, moveY) > 0.3) {
          aimAngle = Math.atan2(moveY, moveX);
          aimDist = AIM_MIN;
        }
      }
      const c = centre();
      aimX = c.x + Math.cos(aimAngle) * aimDist;
      aimY = c.y + Math.sin(aimAngle) * aimDist;
      cursor.x = aimX;
      cursor.y = aimY;
    }

    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    const out = {
      moveX: 0, moveY: 0, aimScreenX: aimX, aimScreenY: aimY,
      fire: false, melee: false, sprint: false, interact: false,
      reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false,
      slot: -1, cycle: 0,
      shop: edges.shop > 0, scoreboard, chat: edges.chat > 0, ready: edges.ready > 0, pause: edges.pause > 0,
      mode,
      nav: null,
      lookDX: 0, lookDY: 0,
    };
    if (enabled) {
      out.lookDX = lookDX;
      out.lookDY = lookDY;
      out.moveX = moveX;
      out.moveY = moveY;
      out.fire = fire;
      out.melee = melee;
      out.sprint = sprint;
      out.interact = interact;
      for (const e of GAMEPLAY_EDGES) out[e] = edges[e] > 0;
      out.slot = slot;
      out.cycle = Math.sign(cycle);
    }
    let anyNav = false;
    for (const n of NAV_EDGES) if (nav[n]) anyNav = true;
    if (anyNav) {
      out.nav = {};
      for (const n of NAV_EDGES) out.nav[n] = nav[n] > 0;
    }
    for (const e of GAMEPLAY_EDGES) edges[e] = 0;
    for (const e of UI_EDGES) edges[e] = 0;
    for (const n of NAV_EDGES) nav[n] = 0;
    slot = -1;
    cycle = 0;
    lookDX = 0;
    lookDY = 0;
    return out;
  }

  const api = {
    sample,
    /** false while typing in chat / a menu is open: gameplay fields go neutral. */
    setEnabled(b) {
      const nb = !!b;
      if (nb === enabled) return;
      enabled = nb;
      // Presses made while a menu was open must not fire when it closes.
      for (const e of GAMEPLAY_EDGES) edges[e] = 0;
      slot = -1;
      cycle = 0;
      wheelAcc = 0;
      lookDX = lookDY = 0;
      mouse.left = mouse.right = false;
      if (touch) touch.setEnabled(nb);
    },
    get enabled() {
      return enabled;
    },
    /** Screen position of the local player; pad/touch aim is projected from it. */
    setAnchor(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      anchor.x = x;
      anchor.y = y;
      anchor.set = true;
    },
    cursor,
    get mode() {
      return mode;
    },
    get touch() {
      return touch;
    },
    releaseAll,
    /** 'fps' | 'topdown' */
    get view() {
      return view;
    },
    setView(v) {
      view = v === 'fps' ? 'fps' : 'topdown';
      if (touch) touch.setLookMode(view === 'fps');
      if (view !== 'fps') exitLock();
    },
    /** True while the canvas holds the pointer lock. */
    get locked() {
      return locked;
    },
    /** Whether this browser can lock the pointer at all. */
    get lockSupported() {
      return lockSupported();
    },
    /** Ask for pointer lock (needs a recent user gesture; failures are silent). */
    requestLock,
    /** Raw (unaccelerated) mouse input on the next lock, where the platform offers it. */
    setRawMouse(b) {
      rawWanted = b !== false;
    },
    /** False once the platform refused raw mouse input. */
    get rawMouseSupported() {
      return unadjusted;
    },
    exitLock,
    /**
     * Feed a look delta as if the mouse moved (CSS px). Test/debug hook behind
     * window.__HH.look (headless browsers can't produce pointer-locked movement).
     */
    addLook(dx, dy) {
      if (!enabled) return;
      if (Number.isFinite(dx)) lookDX += dx;
      if (Number.isFinite(dy)) lookDY += dy;
    },
    destroy() {
      if (destroyed) return;
      exitLock();
      destroyed = true;
      for (const off of listeners) off();
      listeners.length = 0;
      if (touch) touch.destroy();
      touch = null;
      keys.clear();
    },
  };
  return api;
}
