// The utility keys (SPEC §7.2): throwables (frag, molotov) share one key, G, and buildables
// (turret, barricade) another, T. A TAP uses the selected item; HOLDING the key past HOLD_S
// switches the selection to the other item of the group (the HUD shows the pick, see
// hud.js `.equip-group`), and the release that ends such a hold uses nothing. If the selected item is
// out and the other is not, a tap uses the other one.
//
// Pure state, no DOM and no clock of its own (callers pass `now` in seconds), so it is unit-tested
// (tests/onboarding.test.js). input.js owns one and turns the results into the sim's usual
// frag / molotov / turret / barricade edges, so the wire format does not change.

/** The groups: key kind → items, the first being the initial selection. */
export const GADGET_GROUPS = Object.freeze({
  throw: Object.freeze(['frag', 'molotov']),
  build: Object.freeze(['turret', 'barricade']),
});
/** Held this long (s), the key switches the selection instead of using it. */
export const GADGET_HOLD_S = 0.28;
/** How long (s) the HUD keeps the small picker open after a switch. */
export const PICKER_SHOW_S = 1.4;

export function createGadgets() {
  const sel = { throw: 'frag', build: 'turret' };
  const counts = { frag: 1, molotov: 1, turret: 1, barricade: 1 };
  const down = { throw: -1, build: -1 };
  const switched = { throw: false, build: false };
  const pickerUntil = { throw: 0, build: 0 };

  function other(kind) {
    const g = GADGET_GROUPS[kind];
    return g[0] === sel[kind] ? g[1] : g[0];
  }

  /** The item a tap uses now: the selection, or the other one when only that one is in stock. */
  function resolve(kind) {
    const s = sel[kind];
    if ((counts[s] | 0) > 0) return s;
    const o = other(kind);
    return (counts[o] | 0) > 0 ? o : s;
  }

  const api = {
    /** Current selection { throw, build } (item ids). */
    get selected() {
      return { throw: sel.throw, build: sel.build };
    },
    /** Inventory counts, as the HUD / sim show them ({ frag, molotov, turret, barricade }). */
    setCounts(c) {
      if (!c) return;
      for (const k of Object.keys(counts)) if (Number.isFinite(c[k])) counts[k] = c[k];
    },
    /** Select an item directly (touch buttons, tests). Returns the group kind or null. */
    select(item, now = 0) {
      for (const kind of Object.keys(GADGET_GROUPS)) {
        if (GADGET_GROUPS[kind].includes(item)) {
          sel[kind] = item;
          pickerUntil[kind] = now + PICKER_SHOW_S;
          return kind;
        }
      }
      return null;
    },
    /** The key (or pad button) of `kind` went down. */
    press(kind, now) {
      if (!(kind in down) || down[kind] >= 0) return;
      down[kind] = now;
      switched[kind] = false;
    },
    /** Call every frame: a key held past GADGET_HOLD_S switches the selection once. Returns the kinds that switched. */
    tick(now) {
      let out = null;
      for (const kind of Object.keys(down)) {
        if (down[kind] >= 0 && !switched[kind] && now - down[kind] >= GADGET_HOLD_S) {
          switched[kind] = true;
          sel[kind] = other(kind);
          pickerUntil[kind] = now + PICKER_SHOW_S;
          (out || (out = [])).push(kind);
        }
      }
      return out;
    },
    /** The key of `kind` came up: the item to use (a tap), or null (it was a hold, or never went down). */
    release(kind, now) {
      if (!(kind in down) || down[kind] < 0) return null;
      const held = now - down[kind];
      const wasSwitched = switched[kind];
      down[kind] = -1;
      switched[kind] = false;
      if (wasSwitched) return null;
      if (held >= GADGET_HOLD_S) {
        // (a hold released before the next tick() is still the switch it was)
        sel[kind] = other(kind);
        pickerUntil[kind] = now + PICKER_SHOW_S;
        return null;
      }
      const item = resolve(kind);
      sel[kind] = item;
      return item;
    },
    /** Forget held keys (window blur, menu opened): nothing is used. */
    cancel() {
      for (const kind of Object.keys(down)) {
        down[kind] = -1;
        switched[kind] = false;
      }
    },
    /** Is the HUD picker of `kind` open at `now`? */
    pickerOpen(kind, now) {
      return now < pickerUntil[kind];
    },
  };
  return api;
}
