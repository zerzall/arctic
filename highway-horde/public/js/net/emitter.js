// Tiny event emitter shared by the transports and the session. A listener that throws
// must not take the network loop down with it, so errors are reported and swallowed.

export class Emitter {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} fn
   * @returns {Function} fn (handy for a later off())
   */
  on(event, fn) {
    let list = this._listeners.get(event);
    if (!list) {
      list = [];
      this._listeners.set(event, list);
    }
    list.push(fn);
    return fn;
  }

  /** Unsubscribe a listener added with on(). */
  off(event, fn) {
    const list = this._listeners.get(event);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** Subscribe for a single call. */
  once(event, fn) {
    const wrap = (...args) => {
      this.off(event, wrap);
      fn(...args);
    };
    return this.on(event, wrap);
  }

  /** Number of listeners for an event. */
  listenerCount(event) {
    const list = this._listeners.get(event);
    return list ? list.length : 0;
  }

  /** Call every listener of `event` with the given arguments. */
  emit(event, ...args) {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return false;
    // Copy so listeners may unsubscribe while being called.
    for (const fn of list.slice()) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[net] '${event}' listener failed:`, err);
      }
    }
    return true;
  }

  /** Drop every listener. */
  removeAllListeners() {
    this._listeners.clear();
  }
}
