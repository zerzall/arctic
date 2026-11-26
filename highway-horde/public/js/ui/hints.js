// Contextual onboarding hints (SPEC §7.3): a short key hint that appears only while it is relevant
// ("Hold E to revive" next to a downed teammate, "B — buy menu" in the buy time, "E — zip line" at the
// campaign gantry), at most MAX_SHOWS times per player and then never again. A hint counts as shown
// once it has been up for MIN_VISIBLE_S; doing the thing it teaches (`learn`) retires it at once.
// The counts live in localStorage (every access wrapped: private windows and blocked storage just
// mean the hints come back each session). Pure logic around an injected store, unit-tested in
// tests/onboarding.test.js; hud.js draws the pill.

export const HINTS_KEY = 'highway-horde:hints:v1';
/** How many separate times a player sees each hint. */
export const MAX_SHOWS = 3;
/** A hint must stay up this long (s) to count as one showing. */
export const MIN_VISIBLE_S = 1.2;
/** A single showing fades after this long (s) even while the situation lasts. */
export const MAX_VISIBLE_S = 7;

export const HINT_IDS = Object.freeze(['revive', 'buy', 'zip']);

/** localStorage when it works, else null. */
function defaultStore() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ getItem: Function, setItem: Function }|null} [store] default: localStorage
 */
export function createHints(store = defaultStore()) {
  let counts = {};
  try {
    const raw = store ? store.getItem(HINTS_KEY) : null;
    const o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') for (const id of HINT_IDS) if (Number.isFinite(o[id])) counts[id] = Math.max(0, Math.floor(o[id]));
  } catch {
    counts = {};
  }
  function save() {
    try {
      if (store) store.setItem(HINTS_KEY, JSON.stringify(counts));
    } catch {
      // storage is full or blocked: the counts just last for this session
    }
  }
  // the hint on screen: { id, t (s it has been up), counted }; `spent`: ids whose showing ran out while
  // their situation goes on (they stay off until it has ended once)
  let cur = null;
  const spent = new Set();
  const retired = new Set();

  const api = {
    /** How many showings `id` has had. */
    count(id) {
      return counts[id] | 0;
    },
    /** May `id` still be shown (not shown MAX_SHOWS times, not learned)? */
    available(id) {
      return HINT_IDS.includes(id) && !retired.has(id) && (counts[id] | 0) < MAX_SHOWS;
    },
    /**
     * Per-frame: the hint ids whose situation holds right now (`wanted`, in priority order) and the
     * frame time. Returns the id to draw, or ''. One hint at a time; a showing ends when its
     * situation does, or after MAX_VISIBLE_S (it then stays off until the situation has ended once).
     */
    update(wanted, dt) {
      for (const id of [...spent]) if (!wanted.includes(id)) spent.delete(id);
      if (cur) {
        if (!wanted.includes(cur.id) || retired.has(cur.id)) {
          cur = null;
        } else {
          cur.t += dt;
          if (cur.t >= MIN_VISIBLE_S && !cur.counted) {
            cur.counted = true;
            counts[cur.id] = (counts[cur.id] | 0) + 1;
            save();
          }
          if (cur.t >= MAX_VISIBLE_S) {
            spent.add(cur.id);
            cur = null;
          }
        }
      }
      if (!cur) {
        for (const id of wanted) {
          if (api.available(id) && !spent.has(id)) {
            cur = { id, t: 0, counted: false };
            break;
          }
        }
      }
      return cur ? cur.id : '';
    },
    /** The player did what `id` teaches: it never shows again. */
    learn(id) {
      if (!HINT_IDS.includes(id)) return;
      retired.add(id);
      if ((counts[id] | 0) < MAX_SHOWS) {
        counts[id] = MAX_SHOWS;
        save();
      }
      if (cur && cur.id === id) cur = null;
    },
  };
  return api;
}
