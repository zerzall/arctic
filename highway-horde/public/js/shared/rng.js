// Seeded pseudo-random numbers (mulberry32). Deterministic, so the host and every
// client build exactly the same map from the same (mapId, seed).

export function createRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** Float in [0, 1). */
    next,
    /** Float in [lo, hi). */
    range(lo, hi) {
      return lo + (hi - lo) * next();
    },
    /** Integer in [lo, hi] inclusive. */
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    /** True with probability p. */
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    /** Pick from [{weight, ...}] or [[item, weight]] by weight. */
    weighted(entries, weightOf = (e) => e.weight) {
      let total = 0;
      for (const e of entries) total += Math.max(0, weightOf(e));
      if (total <= 0) return entries[0];
      let r = next() * total;
      for (const e of entries) {
        r -= Math.max(0, weightOf(e));
        if (r < 0) return e;
      }
      return entries[entries.length - 1];
    },
    /** Gaussian-ish in (-1, 1), peaked at 0. */
    centered() {
      return (next() + next() + next()) / 1.5 - 1;
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    /** Current internal state, so a stream can be resumed. */
    get state() {
      return s;
    },
  };
}

/** Hash a string to a 32-bit seed. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
