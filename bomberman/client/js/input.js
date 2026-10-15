// input.js - keyboard, touch and gamepad turned into ONE intent (docs/SPEC.md 8.4, 8.6):
//
//   const input = new Input({ canvas, touchRoot });        // touchRoot = #touch; the touch controls are built inside it
//   input.onEmote((n) => ...); input.onMenu(...); input.onMute(...); input.onWheel(...);
//   input.setActive(true)                                    // on entering the game screen (false on every other screen)
//   input.enableTouch(true)                                  // touch layout on: joystick, BOMB, special and emote buttons
//   every frame:   game.setIntent(input.getIntent())         // { d: 0..4, bomb: bool, special: bool }
//   hasGlove changes:  input.setHasGlove(bool)               // shows/hides the special button
//   hand setting:      input.setHand('left' | 'right')       // swaps joystick and BOMB
//   hidden tab / leaving the room:  input.releaseAll() / input.destroy()
//   while a menu or dialog is open over the game: input.setActive(false), so Enter / Space / arrows keep working in it
//
// getIntent() returns ONE reused object and consumes the taps: `bomb` and `special` are true for exactly one call per press, however many
// frames the press lasted, so a tap becomes one cmd (ClientGame latches it again until its tick). `d` is the current direction.
//
// KEYBOARD matches on `e.code` (never `e.key`: AZERTY, Shift and Android's `Unidentified` break it); `keyCode` is used only when `code`
// is empty (old TV browsers). Directions: the LAST PRESSED AXIS wins when two axes are held, opposite keys on one axis cancel, and two
// keys for the same direction (ArrowUp + KeyW) count as one. While the input is active every mapped key is preventDefault-ed so Space
// never scrolls or clicks a focused button, and the focused element is blurred on activation. Everything is released on blur,
// visibilitychange, pagehide and contextmenu. A keyup is ALWAYS honoured (even with Ctrl held), so a key can never stick.
//
// TOUCH: a floating joystick appears where the thumb lands in the joystick zone (45 % of the width on the joystick side, starting 28 px in
// from the SCREEN edge so iOS' back gesture stays free - #touch sits inside .app, which already pads the safe area, so the offsets here
// are max(0, 28px - inset) - and never reaching into the centre 60 % of the arena when the controls overlay it). It has a
// dead zone, hysteresis (engage at 18 px, release at 10 px; switching axis needs 35 % more travel on the new one), and follows the
// thumb when it is dragged beyond its ring. Pointer Events with capture, tracked per pointerId, so a second finger on BOMB never disturbs
// the stick. pointercancel, lostpointercapture, touchcancel, blur and visibilitychange release the stick and drop latched taps.
// The buttons are real <button>s (a TV remote can focus them; a click with detail 0 is their keyboard activation). BOMB vibrates for 10 ms
// where the browser can. contextmenu, selectstart, gesturestart and touchmove are cancelled while active so nothing zooms or selects.
//
// GAMEPAD is polled by getIntent() (main.js calls it every frame): first connected pad; buttons 0/1 bomb, 2/3 special, 9 menu, 12-15 D-pad;
// left stick engages at |v| > 0.5 and releases at < 0.35. Bomb/special/menu are edge-triggered.
//
// On a short landscape screen (8 players' chips fill the side margins) the emote button leaves the cluster: the HUD has its own.
//
// This file injects its own <style id="bp-input-style"> and owns everything inside #touch (style.css never styles .bp-touch*).
// All DOM access goes through the objects passed in (document, window, navigator), so the whole thing runs in Node against fakes.

const ZONE_INSET_PX = 28;
const ZONE_MIN_PX = 96;
const ZONE_FRACTION = 0.45;
const ARENA_ASPECT = 15 / 13;
const STICK_ENGAGE_PX = 18;
const STICK_RELEASE_PX = 10;
const STICK_RADIUS_PX = 56;
const AXIS_SWITCH = 1.35;
const PAD_ENGAGE = 0.5;
const PAD_RELEASE = 0.35;
const COMPACT_HEIGHT_PX = 250;
const VIBRATE_MS = 10;
const STYLE_ID = 'bp-input-style';

const UP = 1;
const RIGHT = 2;
const DOWN = 3;
const LEFT = 4;

const DIR_CODES = {
  ArrowUp: UP, KeyW: UP, ArrowRight: RIGHT, KeyD: RIGHT, ArrowDown: DOWN, KeyS: DOWN, ArrowLeft: LEFT, KeyA: LEFT,
};
const BOMB_CODES = new Set(['Space', 'Enter', 'NumpadEnter', 'KeyJ', 'Numpad0']);
const SPECIAL_CODES = new Set(['KeyE', 'KeyK', 'ShiftLeft', 'ShiftRight']);
const EMOTE_CODES = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5 };
// `keyCode` for browsers that give no `code` (old TV browsers); 10009 is Tizen's back key, 461 is webOS'.
const KEYCODE_TO_CODE = {
  37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 87: 'KeyW', 65: 'KeyA', 83: 'KeyS', 68: 'KeyD',
  13: 'Enter', 32: 'Space', 69: 'KeyE', 16: 'ShiftLeft', 27: 'Escape', 10009: 'Escape', 461: 'Escape',
};

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const isEditable = (t) => !!t && (EDITABLE_TAGS.has(t.tagName) || t.isContentEditable === true);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const STYLE = `
.bp-touch{position:absolute;inset:0;overflow:visible;pointer-events:none;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  --bp-edge:max(0px,calc(28px - env(safe-area-inset-right)));--bp-edge-l:max(0px,calc(28px - env(safe-area-inset-left)));--bp-bomb:clamp(88px,22vmin,128px);--bp-zone-w:45%}
.bp-touch[hidden]{display:none}
.bp-zone{position:absolute;top:0;bottom:0;left:var(--bp-edge-l);width:var(--bp-zone-w);pointer-events:auto;touch-action:none}
.bp-touch[data-hand="left"] .bp-zone{left:auto;right:var(--bp-edge)}
.bp-hint{position:absolute;left:calc(var(--bp-edge-l) + var(--bp-zone-w) / 2 - 52px);bottom:28px;width:104px;height:104px;border-radius:50%;
  border:3px dashed rgba(255,255,255,.22);box-sizing:border-box;transition:opacity .15s;opacity:1}
.bp-touch[data-hand="left"] .bp-hint{left:auto;right:calc(var(--bp-edge) + var(--bp-zone-w) / 2 - 52px)}
.bp-hint::after{content:"";position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.14)}
.bp-touch.bp-stick-on .bp-hint{opacity:0}
.bp-stick{position:absolute;left:0;top:0;width:0;height:0;opacity:0;transition:opacity .1s}
.bp-stick.bp-on{opacity:1}
.bp-ring{position:absolute;left:-62px;top:-62px;width:124px;height:124px;box-sizing:border-box;border-radius:50%;border:3px solid rgba(255,255,255,.3);
  background:radial-gradient(circle,rgba(255,255,255,.12),rgba(255,255,255,.03) 70%);box-shadow:0 0 0 1px rgba(0,0,0,.28),inset 0 0 18px rgba(255,255,255,.08)}
.bp-knob{position:absolute;left:-29px;top:-29px;width:58px;height:58px;border-radius:50%;background:radial-gradient(circle at 34% 28%,#fff,#dcd6ff 58%,#a99cf0);
  opacity:.9;box-shadow:0 5px 14px rgba(0,0,0,.45);transform:translate(var(--bp-kx,0px),var(--bp-ky,0px))}
.bp-cluster{position:absolute;right:var(--bp-edge);bottom:20px;display:flex;flex-direction:column;align-items:flex-end;gap:12px;pointer-events:none}
.bp-touch[data-hand="left"] .bp-cluster{right:auto;left:var(--bp-edge-l);align-items:flex-start}
.bp-row{display:flex;flex-direction:row;align-items:flex-end;gap:14px}
.bp-touch[data-hand="left"] .bp-row{flex-direction:row-reverse}
.bp-touch[data-layout="stack"] .bp-row,.bp-touch[data-layout="stack"][data-hand="left"] .bp-row{flex-direction:column;align-items:inherit;gap:12px}
.bp-touch[data-layout="stack"] .bp-cluster{align-items:flex-end}
.bp-touch[data-layout="stack"][data-hand="left"] .bp-cluster{align-items:flex-start}
.bp-touch[data-layout="stack"] .bp-row{align-items:center}
.bp-touch[data-layout="compact"] .bp-cluster{flex-direction:row;align-items:flex-end}
.bp-touch[data-layout="compact"][data-hand="left"] .bp-cluster{flex-direction:row-reverse;justify-content:flex-end}
.bp-btn{position:relative;display:grid;place-items:center;margin:0;padding:0;border:0;border-radius:50%;color:#fff;cursor:pointer;pointer-events:auto;touch-action:none;
  -webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;transition:transform .06s,box-shadow .06s,filter .06s}
.bp-btn[hidden]{display:none}
.bp-btn svg{width:58%;height:58%;pointer-events:none;overflow:visible}
.bp-btn:focus-visible{outline:3px solid #ffd23f;outline-offset:3px}
.bp-bomb{width:var(--bp-bomb);height:var(--bp-bomb);background:radial-gradient(circle at 34% 26%,#ffb27e,#ff4d5e 52%,#bf1f3a);
  box-shadow:0 8px 0 #7a1230,0 14px 22px rgba(0,0,0,.5),inset 0 3px 7px rgba(255,255,255,.4)}
.bp-bomb.bp-down{transform:translateY(6px) scale(.97);box-shadow:0 2px 0 #7a1230,0 6px 12px rgba(0,0,0,.5),inset 0 3px 7px rgba(255,255,255,.3);filter:brightness(1.08)}
.bp-special{width:clamp(60px,15vmin,84px);height:clamp(60px,15vmin,84px);background:radial-gradient(circle at 34% 26%,#9fe8ff,#3d8bff 55%,#2350b8);
  box-shadow:0 6px 0 #17346f,0 10px 16px rgba(0,0,0,.45),inset 0 2px 5px rgba(255,255,255,.4)}
.bp-special.bp-down{transform:translateY(4px) scale(.97);box-shadow:0 2px 0 #17346f,0 4px 8px rgba(0,0,0,.45),inset 0 2px 5px rgba(255,255,255,.3)}
.bp-emote{width:52px;height:52px;background:radial-gradient(circle at 34% 26%,#ffe98a,#ffb020 60%,#c77c00);box-shadow:0 4px 0 #7a4b00,0 8px 12px rgba(0,0,0,.4),inset 0 2px 4px rgba(255,255,255,.45)}
.bp-emote.bp-down{transform:translateY(3px) scale(.96);box-shadow:0 1px 0 #7a4b00,0 3px 6px rgba(0,0,0,.4)}
@media (max-height:480px){.bp-touch[data-layout="stack"] .bp-emote{display:none}}
@media (prefers-reduced-motion:reduce){.bp-stick,.bp-hint,.bp-btn{transition:none}}
`;

const ICON_BOMB = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="29" cy="40" r="20" fill="#1c1533"/><circle cx="29" cy="40" r="19" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2"/>'
  + '<ellipse cx="21" cy="32" rx="6" ry="4" fill="#fff" fill-opacity=".55" transform="rotate(-32 21 32)"/><path d="M40 22C44 13 50 14 54 9" fill="none" stroke="#f5d9a0" stroke-width="4" stroke-linecap="round"/>'
  + '<circle cx="55" cy="8" r="6" fill="#ffd23f"/><circle cx="55" cy="8" r="3" fill="#fff"/></svg>';
const ICON_THROW = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 50C12 22 38 10 56 24" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>'
  + '<path d="M44 12L58 24L40 30" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="50" r="7" fill="#1c1533" stroke="#fff" stroke-opacity=".6" stroke-width="2"/></svg>';
const ICON_EMOTE = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="#fff" stroke-width="5"/><circle cx="23" cy="26" r="4" fill="#fff"/><circle cx="41" cy="26" r="4" fill="#fff"/>'
  + '<path d="M20 38C25 48 39 48 44 38" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>';

export class Input {
  /**
   * @param {{ canvas?: object, touchRoot?: object, document?: object, window?: object, navigator?: object, ResizeObserver?: Function }} opts
   *   the last four are test seams; they default to the browser globals
   */
  constructor({ canvas = null, touchRoot = null, document: doc = globalThis.document, window: win = globalThis.window, navigator: nav = globalThis.navigator, ResizeObserver: RO = globalThis.ResizeObserver } = {}) {
    this._canvas = canvas;
    this._root = touchRoot;
    this._doc = doc;
    this._win = win;
    this._nav = nav;

    this._active = false;
    this._touchOn = false;
    this._hasGlove = false;
    this._hand = doc && doc.documentElement && doc.documentElement.dataset && doc.documentElement.dataset.hand === 'left' ? 'left' : 'right';

    this._heldCodes = new Set();
    this._heldDir = [0, 0, 0, 0, 0];         // how many held keys mean each direction (ArrowUp and KeyW are both "up")
    this._axisStamp = { v: 0, h: 0 };        // when each axis was last pressed: the later one wins
    this._stamp = 0;
    this._tapBomb = false;
    this._tapSpecial = false;
    this._stick = { id: null, ox: 0, oy: 0, dir: 0 };
    this._pad = { dir: 0, bomb: false, special: false, start: false };
    this._btnPointers = new Map();           // pointerId -> the button that captured it
    this._intent = { d: 0, bomb: false, special: false };
    this._handlers = { emote: null, menu: null, mute: null, wheel: null };

    this._listeners = [];                    // [target, type, fn, options] for destroy()
    this._dom = null;
    this._styleEl = null;
    this._ro = null;

    this._listenGlobal();
    if (touchRoot && doc && typeof doc.createElement === 'function') this._buildTouch(RO);
  }

  // ---- Public API -----------------------------------------------------------------------------------

  onEmote(fn) { this._handlers.emote = fn; }
  onMenu(fn) { this._handlers.menu = fn; }
  onMute(fn) { this._handlers.mute = fn; }
  onWheel(fn) { this._handlers.wheel = fn; }

  /** The glove is what the special button throws with: shown only while the fighter owns one (keys and pad work regardless). */
  setHasGlove(has) {
    this._hasGlove = !!has;
    if (this._dom) this._dom.special.hidden = !this._hasGlove;
    this.layout();
  }

  /** Game screen on: capture keys, poll the pad, show the touch controls. Off: release everything and let the page have its keys back. */
  setActive(active) {
    active = !!active;
    if (active === this._active) return;
    this._active = active;
    if (active) {
      const focused = this._doc && this._doc.activeElement;
      if (focused && typeof focused.blur === 'function') focused.blur();     // a focused button must not receive Space / Enter
      this._pollPad(true);                                                   // the pad button that started the match is still down: not a tap
    } else {
      this.releaseAll();
    }
    this._showTouch();
  }

  get active() {
    return this._active;
  }

  /** Touch layout on or off (main.js follows the device's primary pointer). */
  enableTouch(on) {
    on = !!on;
    if (on === this._touchOn) return;
    this._touchOn = on;
    if (!on) this._releaseStick();
    this._showTouch();
  }

  /** 'left' swaps the joystick and BOMB sides (Settings > Controls side). */
  setHand(hand) {
    this._hand = hand === 'left' ? 'left' : 'right';
    if (this._dom) this._dom.wrap.setAttribute('data-hand', this._hand);
    this.layout();
  }

  /** Nothing is held, nothing is latched: the state after blur, a hidden tab, or leaving the game screen. */
  releaseAll() {
    this._pad.dir = 0;
    this._pad.bomb = this._pad.special = this._pad.start = false;
    this._heldCodes.clear();
    this._heldDir.fill(0);
    this._axisStamp.v = this._axisStamp.h = 0;
    this._tapBomb = this._tapSpecial = false;
    this._releaseStick();
    if (this._dom) for (const b of [this._dom.bomb, this._dom.special, this._dom.emote]) this._unpress(b);
    this._btnPointers.clear();
  }

  /**
   * The intent for this frame. The returned object is reused; read it before calling again. `bomb` / `special` are true once per press.
   * @returns {{ d: number, bomb: boolean, special: boolean }}
   */
  getIntent() {
    const out = this._intent;
    if (!this._active) {
      out.d = 0;
      out.bomb = out.special = false;
      return out;
    }
    this._pollPad();
    out.d = (this._touchOn ? this._stick.dir : 0) || this._keyDir() || this._pad.dir;
    out.bomb = this._tapBomb;
    out.special = this._tapSpecial;
    this._tapBomb = this._tapSpecial = false;
    return out;
  }

  /**
   * Measures the controls' surroundings and sizes the joystick zone and the button cluster to fit. Runs by itself on resize and
   * orientation changes; call it after the layout changed for any other reason.
   */
  layout() {
    if (!this._dom || !this._root || typeof this._root.getBoundingClientRect !== 'function') return;
    const root = this._root.getBoundingClientRect();
    // (the window decides: a portrait phone's strip under the arena is often wider than it is tall)
    const win = this._win;
    const landscape = win && win.innerWidth > 0 ? win.innerWidth > win.innerHeight : root.width > root.height;
    this._dom.wrap.setAttribute('data-layout', landscape ? 'stack' : root.height < COMPACT_HEIGHT_PX ? 'compact' : 'row');

    let zone = root.width * ZONE_FRACTION - ZONE_INSET_PX;
    const arena = this._arenaRect();
    if (arena !== null && arena.bottom > root.top && arena.top < root.bottom) {
      // The controls overlay the arena (landscape): the stick must not reach into the middle 60 % of the play field.
      const margin = this._hand === 'left'
        ? root.right - (arena.right - arena.width * 0.2) - ZONE_INSET_PX
        : arena.left + arena.width * 0.2 - root.left - ZONE_INSET_PX;
      zone = Math.min(zone, margin);
    }
    this._dom.wrap.style.setProperty('--bp-zone-w', `${Math.round(Math.max(ZONE_MIN_PX, zone))}px`);
  }

  destroy() {
    this.releaseAll();
    this._active = false;
    for (const [target, type, fn, options] of this._listeners) target.removeEventListener(type, fn, options);
    this._listeners.length = 0;
    if (this._ro) this._ro.disconnect();
    if (this._dom) this._dom.wrap.remove();
    if (this._styleEl) this._styleEl.remove();
    this._dom = this._styleEl = this._ro = null;
  }

  // ---- Wiring ---------------------------------------------------------------------------------------

  _on(target, type, fn, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, options);
    this._listeners.push([target, type, fn, options]);
  }

  _emit(name, arg) {
    const fn = this._handlers[name];
    if (typeof fn !== 'function') return;
    try {
      fn(arg);
    } catch (e) {
      console.error(e);
    }
  }

  _listenGlobal() {
    const doc = this._doc;
    const win = this._win;
    this._on(doc, 'keydown', (e) => this._onKeyDown(e), true);
    this._on(doc, 'keyup', (e) => this._onKeyUp(e), true);
    this._on(win, 'blur', () => this.releaseAll());
    this._on(win, 'pagehide', () => this.releaseAll());
    this._on(doc, 'visibilitychange', () => this.releaseAll());
    this._on(doc, 'contextmenu', (e) => {
      this.releaseAll();
      if (this._active) e.preventDefault();
    });
    this._on(doc, 'selectstart', (e) => { if (this._active) e.preventDefault(); });
    this._on(doc, 'gesturestart', (e) => { if (this._active) e.preventDefault(); });      // Safari's pinch-zoom
    this._on(win, 'resize', () => this.layout());
    this._on(win, 'orientationchange', () => this.layout());
  }

  // ---- Keyboard -------------------------------------------------------------------------------------

  _codeOf(e) {
    return e.code || KEYCODE_TO_CODE[e.keyCode] || '';
  }

  _mapped(code) {
    return code in DIR_CODES || BOMB_CODES.has(code) || SPECIAL_CODES.has(code) || code in EMOTE_CODES || code === 'KeyT' || code === 'KeyM' || code === 'Escape';
  }

  _onKeyDown(e) {
    if (!this._active) return;
    const code = this._codeOf(e);
    if (!code || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (!this._mapped(code)) return;
    e.preventDefault();
    if (e.repeat) return;                    // edge actions fire once per press; directions are state and need no repeats

    const dir = DIR_CODES[code];
    if (dir !== undefined) {
      if (!this._heldCodes.has(code)) {
        this._heldCodes.add(code);
        this._heldDir[dir]++;
        this._axisStamp[dir === UP || dir === DOWN ? 'v' : 'h'] = ++this._stamp;
      }
    } else if (BOMB_CODES.has(code)) {
      this._tapBomb = true;
    } else if (SPECIAL_CODES.has(code)) {
      this._tapSpecial = true;
    } else if (code in EMOTE_CODES) {
      this._emit('emote', EMOTE_CODES[code]);
    } else if (code === 'KeyT') {
      this._emit('wheel');
    } else if (code === 'KeyM') {
      this._emit('mute');
    } else {
      this._emit('menu');
    }
  }

  _onKeyUp(e) {
    const code = this._codeOf(e);
    const dir = DIR_CODES[code];
    if (dir !== undefined && this._heldCodes.delete(code)) this._heldDir[dir]--;
    if (this._active && code && this._mapped(code) && !isEditable(e.target)) e.preventDefault();
  }

  /** Last pressed axis wins; opposite keys on one axis cancel. */
  _keyDir() {
    const h = this._heldDir;
    const v = (h[UP] > 0 ? -1 : 0) + (h[DOWN] > 0 ? 1 : 0);
    const x = (h[RIGHT] > 0 ? 1 : 0) - (h[LEFT] > 0 ? 1 : 0);
    if (v !== 0 && x !== 0) return this._axisStamp.v > this._axisStamp.h ? (v < 0 ? UP : DOWN) : (x > 0 ? RIGHT : LEFT);
    if (v !== 0) return v < 0 ? UP : DOWN;
    if (x !== 0) return x > 0 ? RIGHT : LEFT;
    return 0;
  }

  // ---- Touch ----------------------------------------------------------------------------------------

  _buildTouch(RO) {
    const doc = this._doc;
    if (!(typeof doc.getElementById === 'function' && doc.getElementById(STYLE_ID))) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE;
      (doc.head || doc.documentElement).appendChild(style);
      this._styleEl = style;
    }
    const el = (tag, cls, parent) => {
      const node = doc.createElement(tag);
      node.className = cls;
      if (parent) parent.appendChild(node);
      return node;
    };
    const button = (cls, label, icon, parent) => {
      const b = el('button', `bp-btn ${cls}`, parent);
      b.setAttribute('type', 'button');
      b.setAttribute('aria-label', label);
      b.innerHTML = icon;
      return b;
    };
    const wrap = el('div', 'bp-touch', this._root);
    wrap.setAttribute('data-hand', this._hand);
    wrap.setAttribute('data-layout', 'row');
    wrap.hidden = true;
    const zone = el('div', 'bp-zone', wrap);
    el('div', 'bp-hint', wrap);
    const stick = el('div', 'bp-stick', wrap);
    el('div', 'bp-ring', stick);
    const knob = el('div', 'bp-knob', stick);
    const cluster = el('div', 'bp-cluster', wrap);
    const emote = button('bp-emote', 'Emotes', ICON_EMOTE, cluster);
    const row = el('div', 'bp-row', cluster);
    const special = button('bp-special', 'Throw bomb', ICON_THROW, row);
    special.hidden = !this._hasGlove;
    const bomb = button('bp-bomb', 'Place bomb', ICON_BOMB, row);
    this._dom = { wrap, zone, stick, knob, emote, special, bomb };

    this._on(zone, 'pointerdown', (e) => this._onZoneDown(e));
    this._on(zone, 'pointermove', (e) => this._onZoneMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this._on(zone, type, (e) => { if (e.pointerId === this._stick.id) this._releaseStick(); });
    this._bindButton(bomb, () => {
      this._tapBomb = true;
      try {
        if (this._nav && typeof this._nav.vibrate === 'function') this._nav.vibrate(VIBRATE_MS);
      } catch { /* vibration is a nicety */ }
    });
    this._bindButton(special, () => { this._tapSpecial = true; });
    this._bindButton(emote, () => this._emit('wheel'));
    const stop = (e) => { if (this._active && this._touchOn && e.cancelable) e.preventDefault(); };
    this._on(wrap, 'touchmove', stop, { passive: false });
    if (this._canvas) this._on(this._canvas, 'touchmove', stop, { passive: false });
    this._on(wrap, 'touchcancel', () => this.releaseAll());
    if (typeof RO === 'function') {
      this._ro = new RO(() => this.layout());
      this._ro.observe(this._root);
      if (this._canvas) this._ro.observe(this._canvas);
    }
    this.layout();
  }

  _showTouch() {
    if (!this._dom) return;
    this._dom.wrap.hidden = !(this._active && this._touchOn);
    if (!this._dom.wrap.hidden) this.layout();
  }

  /** The 15 x 13 arena fitted (centred) into the canvas box, or null when there is no canvas to measure. */
  _arenaRect() {
    if (!this._canvas || typeof this._canvas.getBoundingClientRect !== 'function') return null;
    const box = this._canvas.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return null;
    const width = Math.min(box.width, box.height * ARENA_ASPECT);
    const height = width / ARENA_ASPECT;
    const left = box.left + (box.width - width) / 2;
    return { left, right: left + width, top: box.top, bottom: box.top + height, width, height };
  }

  _capture(target, id) {
    try {
      target.setPointerCapture(id);
    } catch { /* a synthetic or already-gone pointer: the events still arrive while it is over the element */ }
  }

  _onZoneDown(e) {
    if (!this._active || !this._touchOn || this._stick.id !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this._capture(this._dom.zone, e.pointerId);
    this._stick.id = e.pointerId;
    this._stick.ox = e.clientX;
    this._stick.oy = e.clientY;
    this._stick.dir = 0;
    this._drawStick(0, 0, true);
  }

  _onZoneMove(e) {
    const s = this._stick;
    if (e.pointerId !== s.id) return;
    let dx = e.clientX - s.ox;
    let dy = e.clientY - s.oy;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_RADIUS_PX) {            // floating: drag the origin along so reversing never needs a long swipe back
      const pull = (dist - STICK_RADIUS_PX) / dist;
      s.ox += dx * pull;
      s.oy += dy * pull;
      dx = e.clientX - s.ox;
      dy = e.clientY - s.oy;
    }
    s.dir = this._stickDir(dx, dy, s.dir);
    this._drawStick(dx, dy, true);
  }

  /** Dead zone, hysteresis on the radius, and a bias towards the axis already in use so a diagonal thumb does not flicker. */
  _stickDir(dx, dy, current) {
    const dist = Math.hypot(dx, dy);
    if (dist < (current === 0 ? STICK_ENGAGE_PX : STICK_RELEASE_PX)) return 0;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let horizontal = ax > ay;
    if (current === LEFT || current === RIGHT) horizontal = ay <= ax * AXIS_SWITCH;
    else if (current === UP || current === DOWN) horizontal = ax > ay * AXIS_SWITCH;
    if (horizontal) return dx > 0 ? RIGHT : LEFT;
    return dy > 0 ? DOWN : UP;
  }

  _releaseStick() {
    const s = this._stick;
    if (s.id !== null && this._dom) {
      try {
        this._dom.zone.releasePointerCapture(s.id);
      } catch { /* already released */ }
    }
    s.id = null;
    s.dir = 0;
    if (this._dom) this._drawStick(0, 0, false);
  }

  _drawStick(dx, dy, on) {
    const d = this._dom;
    if (!d) return;
    const s = this._stick;
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS_PX ? STICK_RADIUS_PX / len : 1;
    const box = this._root.getBoundingClientRect();           // (the controls fill their root, so the root's corner is theirs)
    d.stick.style.transform = `translate(${Math.round(s.ox - box.left)}px,${Math.round(s.oy - box.top)}px)`;
    d.knob.style.setProperty('--bp-kx', `${Math.round(dx * k)}px`);
    d.knob.style.setProperty('--bp-ky', `${Math.round(dy * k)}px`);
    d.stick.classList.toggle('bp-on', on);
    d.wrap.classList.toggle('bp-stick-on', on);
  }

  _bindButton(btn, press) {
    this._on(btn, 'pointerdown', (e) => {
      if (!this._active || !this._touchOn) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      this._capture(btn, e.pointerId);
      this._btnPointers.set(e.pointerId, btn);
      btn.classList.add('bp-down');
      press();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this._on(btn, type, (e) => {
        if (this._btnPointers.get(e.pointerId) !== btn) return;
        this._btnPointers.delete(e.pointerId);
        this._unpress(btn);
      });
    }
    // Keyboard or remote activation of a focused button arrives as a click without a pointer (detail 0); pointer taps are handled above.
    this._on(btn, 'click', (e) => {
      if (this._active && this._touchOn && e.detail === 0) press();
    });
  }

  _unpress(btn) {
    btn.classList.remove('bp-down');
  }

  // ---- Gamepad --------------------------------------------------------------------------------------

  _firstPad() {
    const nav = this._nav;
    if (!nav || typeof nav.getGamepads !== 'function') return null;
    let pads;
    try {
      pads = nav.getGamepads();
    } catch {
      return null;
    }
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected !== false) return pads[i];
    return null;
  }

  /** `silent`: learn which buttons are down without turning them into taps or menu presses. */
  _pollPad(silent = false) {
    const pad = this._firstPad();
    const st = this._pad;
    if (pad === null) {
      st.dir = 0;
      st.bomb = st.special = st.start = false;
      return;
    }
    const pressed = (i) => !!pad.buttons && !!pad.buttons[i] && (pad.buttons[i].pressed === true || pad.buttons[i].value > 0.5);
    const bomb = pressed(0) || pressed(1);
    const special = pressed(2) || pressed(3);
    const start = pressed(9);
    if (!silent) {
      if (bomb && !st.bomb) this._tapBomb = true;
      if (special && !st.special) this._tapSpecial = true;
      if (start && !st.start) this._emit('menu');
    }
    st.bomb = bomb;
    st.special = special;
    st.start = start;

    const pd = (pressed(12) ? -1 : 0) + (pressed(13) ? 1 : 0);
    const px = (pressed(15) ? 1 : 0) - (pressed(14) ? 1 : 0);
    if (pd !== 0 || px !== 0) {              // (two D-pad axes at once: keep the one already in use)
      const vertical = pd !== 0 && (px === 0 || st.dir === UP || st.dir === DOWN);
      st.dir = vertical ? (pd < 0 ? UP : DOWN) : (px > 0 ? RIGHT : LEFT);
      return;
    }
    const ax = pad.axes && pad.axes.length > 0 ? pad.axes[0] : 0;
    const ay = pad.axes && pad.axes.length > 1 ? pad.axes[1] : 0;
    st.dir = this._padStickDir(ax, ay, st.dir);
  }

  /** Dominant axis of the left stick, engaging at 0.5 and letting go below 0.35; it takes the other axis only when that one leads. */
  _padStickDir(ax, ay, current) {
    const mx = Math.abs(ax);
    const my = Math.abs(ay);
    const sameAxisHorizontal = current === LEFT || current === RIGHT;
    const sameAxisVertical = current === UP || current === DOWN;
    if (sameAxisHorizontal && mx >= PAD_RELEASE && mx >= my) return ax > 0 ? RIGHT : LEFT;
    if (sameAxisVertical && my >= PAD_RELEASE && my >= mx) return ay > 0 ? DOWN : UP;
    if (Math.max(mx, my) <= PAD_ENGAGE) return 0;
    return mx > my ? (ax > 0 ? RIGHT : LEFT) : (ay > 0 ? DOWN : UP);
  }
}
