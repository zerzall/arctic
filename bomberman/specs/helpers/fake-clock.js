// A fake clock with fake timers (docs/SPEC.md §10.1). Rooms take `now`, `setTimer` and `clearTimer` from it, so a spec
// can move time by hand and see exactly which timers are still armed.
//
//   const clock = new FakeClock();
//   clock.advance(1000);            // fires due timers in order, then now() === 1000
//   clock.now()  clock.setTimer(fn, ms)  clock.clearTimer(h)  clock.pending
//
// The methods are arrow properties, so `{ now: clock.now }` works without binding.

export class FakeClock {
  constructor(start = 0) {
    this.ms = start;
    this._timers = new Map();
    this._nextHandle = 1;
    this.now = () => this.ms;
    this.setTimer = (fn, delay) => {
      const handle = { id: this._nextHandle++, unref() { return this; } };
      this._timers.set(handle, { fn, due: this.ms + Math.max(0, delay) });
      return handle;
    };
    this.clearTimer = (handle) => { this._timers.delete(handle); };
  }

  /** Number of armed timers. */
  get pending() {
    return this._timers.size;
  }

  /** Moves time forward, running every timer that falls due on the way (earliest first, ties in creation order). */
  advance(delta) {
    const target = this.ms + delta;
    for (;;) {
      let next = null;
      for (const [handle, t] of this._timers) if (t.due <= target && (next === null || t.due < next[1].due)) next = [handle, t];
      if (next === null) break;
      this._timers.delete(next[0]);
      this.ms = Math.max(this.ms, next[1].due);
      next[1].fn();
    }
    this.ms = target;
  }
}

export const makeClock = (start = 0) => new FakeClock(start);
