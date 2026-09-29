// Seeded random numbers for the simulation (docs/SPEC.md §4.6): mulberry32, no global state.
// The World, the map generator and the bots each own a stream, so replays are reproducible in
// Node and in every browser. Only bit operations and Math.imul are used, which are exact.

/**
 * @param {number} seed any number; it is coerced to an unsigned 32-bit integer
 * @returns {{ next(): number, int(n: number): number, pick<T>(arr: T[]): T, shuffle<T>(arr: T[]): T[] }}
 */
export function makeRng(seed) {
  let a = seed >>> 0;

  /** Float in [0, 1). */
  function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in 0..n-1. */
  function int(n) {
    return Math.floor(next() * n);
  }

  function pick(arr) {
    return arr[int(arr.length)];
  }

  /** In-place Fisher-Yates from the end; returns the same array. */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  return { next, int, pick, shuffle };
}
