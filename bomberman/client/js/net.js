// net.js - the two connections main.js can talk to, behind one interface (docs/SPEC.md 5.4, 8.1, 8.1a):
//
//   WebSocketConnection  a WebSocket that reconnects, keeps itself alive and copes with sleeping servers and backgrounded tabs
//   LoopbackConnection   a Room running inside the page for "Practice vs bots" (no server, no reconnect, no pings)
//
// Both are used the same way:
//
//   conn.onopen = () => conn.send(hello)   // create / join. A WebSocketConnection fires it again after EVERY reconnect: send the
//                                          // token join there. Cmds must wait for `joined` (game.pauseSending() on drop, setSeq() on joined).
//   conn.onmessage = (msg) => ...          // parsed JSON, one call per server frame
//   conn.onclose = (info) => ...           // the end: { code, reason, fatal, gaveUp, replaced, byUser }; a WebSocketConnection only
//                                          // reports it once it has stopped trying (see below)
//   conn.send(obj)  ->  boolean            // false when nothing was sent (not open, or not joined yet); never throws
//   conn.close()                           // leave: the socket closes, onclose fires (byUser: true), nothing reconnects
//   conn.readyState                        // 0 connecting, 1 open, 3 closed (2 is never used)
//
// WebSocketConnection (SPEC 5.4)
//   * URL: wsUrl() derives ws:// or wss:// from the page. Every attempt is bounded by an 8 s connect timer; the next attempt waits
//     0.5, 1, 2, 3, 3, ... s. The give-up budget is 120 s when no room was ever joined on this page load or the last close was the
//     server saying `closed` / codes 1012 and 1001 (a restart or a sleeping free host), 60 s otherwise. Then onclose({ gaveUp: true });
//     retry() starts over with a fresh budget.
//   * onstatus({ kind, waking, elapsedMs, secondsLeft, attempt }) (also readable as conn.status) fires on every change and once a second while not open:
//     kind 'open' | 'connecting' (never joined yet) | 'reconnecting' (was joined) | 'failed'. `waking` turns true after 3 s without an
//     open: main.js then shows "Waking up the server..." with elapsedMs, otherwise "Reconnecting (secondsLeft)".
//   * Liveness: ANY inbound frame counts as life. A ping goes out every 2 s (its `ts` is performance.now(); ClientGame.onPong turns the
//     pong into an RTT) and the link is declared dead, closed and re-established when now - max(lastRx, lastVisibleAt) > 8 s. The check runs
//     in a 1 s timer and whenever main.js calls checkLiveness() from its rAF loop; it is skipped while the tab is hidden.
//   * Backgrounding: the socket stays open while hidden. On visible / pageshow(persisted) / online the connection calls resume() itself:
//     backoff and budget restart, a dropped link reconnects at once, an open one is pinged and dropped if no pong arrives in 2.5 s.
//   * Server-initiated ends: an `error` other than `closed` that arrives before `joined` on a socket (version, no_room, full, locked,
//     busy, kicked, rate_limited, bad_msg), a `kicked` message, and close code 4001 (`replaced`: another socket took the token over, so
//     reconnecting would start a tug of war) are final: the message is delivered, then onclose({ fatal: true, reason }) fires and nothing
//     reconnects. After `joined`, errors such as rate_limited or not_host are ordinary messages.
//   * Keep-warm: once joined, GET /healthz every 4 minutes so a host that sleeps on idle HTTP traffic keeps seeing some.
//
// Everything environmental (WebSocket class, clock, timers, document, window, fetch) is injectable through the options object, which is how
// net.spec.js runs the whole thing on a fake clock in Node. Importing this file touches no global.
//
// LoopbackConnection imports shared/room.js lazily (dynamic import) so the normal, online path never loads it; onopen fires once it has.

const CONNECT_TIMEOUT_MS = 8000;
const BACKOFF_MS = [500, 1000, 2000, 3000];
const BUDGET_FIRST_MS = 120000;
const BUDGET_JOINED_MS = 60000;
const PING_EVERY_MS = 2000;
const DEAD_AFTER_MS = 8000;
const RESUME_PONG_MS = 2500;
const WAKING_AFTER_MS = 3000;
const KEEP_WARM_MS = 240000;
const WATCH_MS = 1000;
const CLOSE_REPLACED = 4001;
const CLOSE_RESTART = 1012;
const CLOSE_GOING_AWAY = 1001;

/** `ws://host/ws`, or `wss://` on an https page. The host includes the port. */
export function wsUrl(loc = globalThis.location) {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`;
}

/** A handler that throws must not take the connection's own bookkeeping down with it. */
function call(fn, arg) {
  if (typeof fn !== 'function') return;
  try {
    fn(arg);
  } catch (e) {
    console.error(e);
  }
}

export class WebSocketConnection {
  /**
   * @param {string} [url] defaults to wsUrl()
   * @param {{ WebSocket?: Function, now?: () => number, setTimer?: Function, clearTimer?: Function, document?: object, window?: object,
   *           fetch?: Function, healthUrl?: string }} [opts] every environment seam; defaults are the browser globals
   */
  constructor(url, opts = {}) {
    const g = globalThis;
    this.url = url ?? wsUrl();
    this._WebSocket = opts.WebSocket ?? g.WebSocket;
    this._now = opts.now ?? (() => g.performance.now());
    this._setTimer = opts.setTimer ?? ((fn, ms) => g.setTimeout(fn, ms));
    this._clearTimer = opts.clearTimer ?? ((h) => g.clearTimeout(h));
    this._doc = opts.document ?? g.document ?? null;
    this._win = opts.window ?? g.window ?? null;
    this._fetch = opts.fetch ?? (typeof g.fetch === 'function' ? g.fetch.bind(g) : null);
    this._healthUrl = opts.healthUrl ?? '/healthz';

    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onstatus = null;

    this._state = 'connecting';              // connecting | open | waiting (between attempts) | closed
    this._sock = null;
    this._gen = 0;                           // bumped whenever a socket is abandoned: a timer armed for an older one recognises itself as stale
    this._joinedOnSock = false;
    this._everJoined = false;
    this._lastCloseSoft = false;
    this._gaveUp = false;
    this._fatal = null;
    this._attempt = 0;
    this._outageStart = this._now();         // start of the current stretch without a working link (the first connect is one)
    this._lastRx = this._outageStart;
    this._lastVisibleAt = this._outageStart;
    this._lastPingAt = -Infinity;
    this._connectTimer = null;
    this._retryTimer = null;
    this._pongTimer = null;
    this._watchTimer = null;
    this._warmTimer = null;
    this._listening = false;

    this._onVisibility = () => { if (!this._hidden()) this.resume(); };
    this._onPageShow = (e) => { if (e && e.persisted) this.resume(); };
    this._onOnline = () => this.resume();

    this._listen();
    this._watch();
    this._connect();
  }

  /** 1 while a socket is open, 3 once the connection has ended for good, 0 in between (connecting or waiting to retry). */
  get readyState() {
    return this._state === 'open' ? 1 : this._state === 'closed' ? 3 : 0;
  }

  /**
   * Sends one message as JSON. Returns false (and drops it) when there is no open socket, and also for anything but create / join / ping
   * until `joined` has arrived on this socket: a cmd sent before it would still carry the number from before the outage, ahead of what
   * the server has (see ClientGame.setSeq), which the server would accept and then use to ignore every correctly numbered cmd.
   */
  send(obj) {
    if (this._state !== 'open') return false;
    if (!this._joinedOnSock && obj.t !== 'create' && obj.t !== 'join' && obj.t !== 'ping') return false;
    try {
      this._sock.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  /** Leaves for good: closes the socket, stops every timer, and reports onclose({ byUser: true }). */
  close(code = 1000, reason = 'left') {
    if (this._state === 'closed') return;
    this._finish({ code, reason, fatal: false, gaveUp: false, replaced: false, byUser: true });
  }

  /** After onclose({ gaveUp: true }): the "Try again" button. Starts over with a fresh budget. */
  retry() {
    if (this._state !== 'closed' || !this._gaveUp) return false;
    this._gaveUp = false;
    this._fatal = null;
    this._attempt = 0;
    this._outageStart = this._now();
    this._listen();
    this._watch();
    this._connect();
    return true;
  }

  /**
   * The device is back (tab visible, page restored, network online): forget the backoff and the budget, reconnect at once if the link is
   * gone, and check an apparently open one with a ping. Idempotent; the connection also calls it by itself on the browser events.
   */
  resume() {
    if (this._state === 'closed') return;
    const now = this._now();
    this._lastVisibleAt = now;
    this._attempt = 0;
    if (this._state === 'open') {
      this._outageStart = null;
      this._sendPing();
      this._clearTimer(this._pongTimer);
      const gen = this._gen;
      this._pongTimer = this._setTimer(() => { if (gen === this._gen && this._state === 'open') this._dropLink(); }, RESUME_PONG_MS);
      return;
    }
    this._outageStart = now;
    this._abandon();
    this._connect();
  }

  /** For main.js's rAF loop: declares a silent link dead. Cheap; does nothing while hidden. */
  checkLiveness() {
    if (this._state !== 'open' || this._hidden()) return;
    if (this._now() - Math.max(this._lastRx, this._lastVisibleAt) > DEAD_AFTER_MS) this._dropLink();
  }

  // ---- Attempts -----------------------------------------------------------------------------------

  _connect() {
    this._clearTimer(this._retryTimer);
    this._retryTimer = null;
    const gen = ++this._gen;
    this._state = 'connecting';
    this._joinedOnSock = false;
    let sock;
    try {
      sock = new this._WebSocket(this.url);
    } catch {
      this._attemptFailed();
      return;
    }
    this._sock = sock;
    sock.onopen = () => this._onSockOpen();
    sock.onmessage = (ev) => this._onSockMessage(ev.data);
    sock.onclose = (ev) => this._onSockClose(ev);
    sock.onerror = () => {};                 // browsers give no detail; the close event that follows says everything there is
    this._connectTimer = this._setTimer(() => {
      if (gen === this._gen && this._state === 'connecting') {
        this._abandon();
        this._attemptFailed();
      }
    }, CONNECT_TIMEOUT_MS);
    this._emitStatus();
  }

  /** Stops caring about the current socket (its handlers are detached, so late events never arrive) and closes it. */
  _abandon(code, reason) {
    this._gen++;
    this._clearTimer(this._connectTimer);
    this._clearTimer(this._pongTimer);
    this._connectTimer = this._pongTimer = null;
    const sock = this._sock;
    this._sock = null;
    if (sock === null) return;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try {
      if (code === undefined) sock.close();
      else sock.close(code, reason);
    } catch { /* already closed */ }
  }

  /** An established link that stopped answering, or a socket that is gone: reconnect with the normal backoff. */
  _dropLink() {
    this._abandon();
    this._lastCloseSoft = false;
    this._attemptFailed();
  }

  _budgetMs() {
    return this._everJoined && !this._lastCloseSoft ? BUDGET_JOINED_MS : BUDGET_FIRST_MS;
  }

  /** Called whenever an attempt or the open link ends without a final verdict: wait, or give up when the budget is spent. */
  _attemptFailed() {
    const now = this._now();
    if (this._outageStart === null) this._outageStart = now;
    const delay = BACKOFF_MS[Math.min(this._attempt, BACKOFF_MS.length - 1)];
    this._attempt++;
    if (now + delay - this._outageStart > this._budgetMs()) {
      this._gaveUp = true;
      this._finish({ code: 0, reason: 'unreachable', fatal: false, gaveUp: true, replaced: false, byUser: false });
      return;
    }
    this._state = 'waiting';
    this._retryTimer = this._setTimer(() => this._connect(), delay);
    this._emitStatus();
  }

  /** The end: no more reconnects. Reports once. */
  _finish(info) {
    if (this._state === 'closed') return;
    this._state = 'closed';
    this._abandon(info.byUser ? info.code : undefined, info.reason);
    this._clearTimer(this._retryTimer);
    this._clearTimer(this._watchTimer);
    this._clearTimer(this._warmTimer);
    this._retryTimer = this._watchTimer = this._warmTimer = null;
    this._unlisten();
    this._emitStatus();
    call(this.onclose, info);
  }

  // ---- Socket events ------------------------------------------------------------------------------

  _onSockOpen() {
    this._clearTimer(this._connectTimer);
    this._connectTimer = null;
    this._state = 'open';
    this._attempt = 0;
    this._outageStart = null;
    this._lastCloseSoft = false;
    this._lastRx = this._lastVisibleAt = this._now();
    this._emitStatus();
    call(this.onopen);                        // (the first ping waits for the heartbeat, so it can never precede the create/join)
  }

  _onSockMessage(data) {
    this._lastRx = this._now();
    if (typeof data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg === null || typeof msg !== 'object') return;
    if (msg.t === 'pong') {
      this._clearTimer(this._pongTimer);
      this._pongTimer = null;
    } else if (msg.t === 'joined') {
      this._everJoined = true;
      this._joinedOnSock = true;
      this._keepWarm();
    } else if (msg.t === 'kicked') {
      this._fatal = 'kicked';
    } else if (msg.t === 'error') {
      if (msg.code === 'closed') this._lastCloseSoft = true;
      else if (!this._joinedOnSock) this._fatal = String(msg.code);
    }
    call(this.onmessage, msg);
    if (this._fatal !== null && this._state !== 'closed') {
      this._finish({ code: 1000, reason: this._fatal, fatal: true, gaveUp: false, replaced: false, byUser: false });
    }
  }

  _onSockClose(ev) {
    const code = ev && Number.isInteger(ev.code) ? ev.code : 1006;
    this._abandon();
    if (code === CLOSE_REPLACED) {
      this._finish({ code, reason: 'replaced', fatal: true, gaveUp: false, replaced: true, byUser: false });
      return;
    }
    this._lastCloseSoft = this._lastCloseSoft || code === CLOSE_RESTART || code === CLOSE_GOING_AWAY;
    this._attemptFailed();
  }

  // ---- Timers and browser events -------------------------------------------------------------------

  _hidden() {
    return !!(this._doc && this._doc.hidden);
  }

  _sendPing() {
    const now = this._now();
    this._lastPingAt = now;
    this.send({ t: 'ping', ts: now });
  }

  /** The 1 s heartbeat: pings, the liveness check, and the status refresh that drives the elapsed-seconds counter. */
  _watch() {
    this._clearTimer(this._watchTimer);
    this._watchTimer = this._setTimer(() => {
      if (this._state === 'closed') return;
      if (this._state === 'open') {
        this.checkLiveness();
        if (this._state === 'open' && !this._hidden() && this._now() - this._lastPingAt >= PING_EVERY_MS - 1) this._sendPing();
      } else {
        this._emitStatus();
      }
      if (this._state !== 'closed') this._watch();
    }, WATCH_MS);
  }

  _keepWarm() {
    if (this._warmTimer !== null || this._fetch === null) return;
    const beat = () => {
      try {
        const pending = this._fetch(this._healthUrl, { cache: 'no-store' });
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch { /* offline: the next beat tries again */ }
      this._warmTimer = this._setTimer(beat, KEEP_WARM_MS);
    };
    this._warmTimer = this._setTimer(beat, KEEP_WARM_MS);
  }

  _listen() {
    if (this._listening) return;
    this._listening = true;
    if (this._doc) this._doc.addEventListener('visibilitychange', this._onVisibility);
    if (this._win) {
      this._win.addEventListener('pageshow', this._onPageShow);
      this._win.addEventListener('online', this._onOnline);
    }
  }

  _unlisten() {
    if (!this._listening) return;
    this._listening = false;
    if (this._doc) this._doc.removeEventListener('visibilitychange', this._onVisibility);
    if (this._win) {
      this._win.removeEventListener('pageshow', this._onPageShow);
      this._win.removeEventListener('online', this._onOnline);
    }
  }

  /** The connection state as main.js should show it (also delivered to onstatus on every change). */
  get status() {
    const outage = this._outageStart === null ? 0 : this._now() - this._outageStart;
    const open = this._state === 'open';
    return {
      kind: open ? 'open' : this._state === 'closed' ? (this._gaveUp ? 'failed' : 'closed') : this._everJoined ? 'reconnecting' : 'connecting',
      waking: !open && this._state !== 'closed' && outage >= WAKING_AFTER_MS,
      elapsedMs: outage,
      secondsLeft: open ? 0 : Math.max(0, Math.ceil((this._budgetMs() - outage) / 1000)),
      attempt: this._attempt,
    };
  }

  _emitStatus() {
    if (typeof this.onstatus === 'function') call(this.onstatus, this.status);
  }
}

function cryptoSeed() {
  const c = globalThis.crypto;
  return c && c.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0] : (Math.random() * 4294967296) >>> 0;
}

/**
 * Practice mode: a Room running in this page behind the WebSocketConnection interface (SPEC 8.1a). It is pump-driven and pausable,
 * because a hidden tab stops requestAnimationFrame and throttles timers: main.js calls pump(now) at the top of every frame and
 * pause() / resume(now) when the tab hides and shows. The Room's clock is `virtualMs`, so pausing freezes every one of its timers.
 * It never calls room.startLoop(), and messages are delivered by drain() - outside Room code - never from inside Room.step().
 */
export class LoopbackConnection {
  /**
   * @param {{ loadRoom?: () => Promise<{ Room: Function }>, seed?: number }} [opts] test seams: the Room module and the Room's seed
   */
  constructor({ loadRoom = () => import('../../shared/room.js'), seed = cryptoSeed() } = {}) {
    this.virtualMs = 0;
    this.paused = false;
    this.last = null;                        // real time of the last accounted frame; set by the first pump
    this.outbox = [];
    this.room = null;
    this.pid = null;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this._draining = false;
    this._closeNotified = false;
    this._leaving = false;
    this.conn = {
      send: (str) => {
        if (this.readyState === 3) return;
        this.outbox.push(str);
        queueMicrotask(() => this.drain());
      },
      close: (reason) => queueMicrotask(() => this._notifyClose({ code: 1000, reason, byUser: this._leaving })),
    };
    Promise.resolve().then(() => loadRoom()).then(({ Room }) => {
      if (this.readyState === 3) return;
      this.room = new Room({ code: 'LOCAL', local: true, now: () => this.virtualMs, seed });
      this.readyState = 1;
      call(this.onopen);
    }).catch((e) => {
      console.error(e);
      this.readyState = 3;
      this._notifyClose({ code: 1011, reason: 'practice mode failed to load', byUser: false });
    });
  }

  /** `create` (or `join`) enters the Room; everything else is a frame from the joined fighter. Returns false when not open. */
  send(obj) {
    if (this.readyState !== 1 || this.room === null || obj === null || typeof obj !== 'object') return false;
    if (this.pid === null && obj.t !== 'create' && obj.t !== 'join') return false;       // (a fighter has not joined yet: nothing to say)
    if (obj.t === 'create' || obj.t === 'join') {
      const res = this.room.join(this.conn, { name: obj.name, color: obj.color, token: obj.token });
      if (res && res.ok) {
        this.pid = res.id;
      } else {                                               // (cannot happen in a fresh Room, but a refusal must not hang the UI)
        const code = res && res.error ? res.error : 'closed';
        this.outbox.push(JSON.stringify({ t: 'error', code, msg: code }));
        queueMicrotask(() => {
          this.drain();
          this.close();
        });
      }
    } else {
      this.room.receive(this.pid, JSON.stringify(obj), this.conn);
    }
    return true;
  }

  /** Called from main.js frame() BEFORE game.update(realNow): runs the Room's ticks that real time has earned (at most 5 per call). */
  pump(realNow) {
    if (this.paused || this.room === null) {
      this.last = realNow;
      return;
    }
    if (this.last === null) this.last = realNow;
    const tick = 1000 / 60;
    const n = Math.min(5, Math.floor((realNow - this.last) / tick + 1e-9));   // (+1e-9: frames exactly one tick apart must step once, not 0 then 2)
    if (realNow - this.last > 100) this.last = realNow;      // a long stall is dropped, not caught up
    else this.last += n * tick;
    for (let i = 0; i < n; i++) {
      this.virtualMs += tick;
      try {
        this.room.step();
      } catch (e) {
        console.error(e);
      }
    }
    this.drain();                                            // deliver AFTER the Room finished stepping
  }

  /** Hands the Room's queued output to onmessage, in order. Re-entrant calls (a handler that pumps) fold into the running loop. */
  drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      while (this.outbox.length > 0) {
        const text = this.outbox.shift();
        try {
          call(this.onmessage, JSON.parse(text));
        } catch (e) {
          console.error(e);
        }
      }
    } finally {
      this._draining = false;
    }
  }

  pause() {
    this.paused = true;
  }

  resume(realNow) {
    this.last = realNow;
    this.paused = false;
  }

  /** Leave: the Room is closed, nothing more is delivered, onclose fires once (byUser: true). */
  close() {
    if (this.readyState === 3) return;
    const room = this.room;
    this._leaving = true;
    this.readyState = 3;                                     // from here conn.send() drops the Room's farewell `error closed`
    this.room = null;
    this.outbox.length = 0;
    try {
      if (room) room.close();
    } catch (e) {
      console.error(e);
    }
    queueMicrotask(() => this._notifyClose({ code: 1000, reason: 'left', byUser: true }));
  }

  _notifyClose(info) {
    if (this._closeNotified) return;
    this._closeNotified = true;
    this.readyState = 3;
    call(this.onclose, info);
  }
}
