// Frame-time statistics of the benchmark page (pure, unit-tested in tests/display.test.js).

/**
 * Percentile (0..100) of an ascending list, linear between ranks.
 * @param {number[]} sorted
 * @param {number} p
 */
export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const r = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(r), hi = Math.ceil(r);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (r - lo);
}

/** Mean of the slowest `share` (0..1) of the frame times (at least one frame). */
function meanWorst(desc, share) {
  const n = Math.max(1, Math.ceil(desc.length * share));
  let s = 0;
  for (let i = 0; i < n; i++) s += desc[i];
  return s / n;
}

/**
 * Summarise a run.
 * @param {number[]} frameMs frame times in milliseconds (time between two presented frames)
 * @param {number[]} [gpuMs] GPU frame times when the browser reports them
 * @returns {object|null} null for an empty run
 */
export function summarizeFrames(frameMs, gpuMs = []) {
  const xs = frameMs.filter((v) => Number.isFinite(v) && v > 0);
  if (!xs.length) return null;
  const total = xs.reduce((a, b) => a + b, 0);
  const asc = [...xs].sort((a, b) => a - b);
  const desc = [...asc].reverse();
  const fps = (ms) => 1000 / ms;
  const out = {
    frames: xs.length,
    seconds: total / 1000,
    avgFps: (xs.length / total) * 1000,
    // "1% low" = the average frame rate of the slowest 1 % of frames (0.1 %: the slowest 0.1 %)
    low1Fps: fps(meanWorst(desc, 0.01)),
    low01Fps: fps(meanWorst(desc, 0.001)),
    minFps: fps(asc[asc.length - 1]),
    maxFps: fps(asc[0]),
    avgMs: total / xs.length,
    p50Ms: percentile(asc, 50),
    p95Ms: percentile(asc, 95),
    p99Ms: percentile(asc, 99),
    maxMs: asc[asc.length - 1],
    // frames slower than 1.5 display periods at the median rate: visible stutters
    stutters: 0,
  };
  const limit = out.p50Ms * 1.5;
  out.stutters = xs.filter((v) => v > limit).length;
  const g = gpuMs.filter((v) => Number.isFinite(v) && v > 0);
  if (g.length) {
    const ga = [...g].sort((a, b) => a - b);
    out.gpuAvgMs = g.reduce((a, b) => a + b, 0) / g.length;
    out.gpuP99Ms = percentile(ga, 99);
    out.gpuMaxMs = ga[ga.length - 1];
  }
  return out;
}

/** Number formatting for the result block. */
export const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
export const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

// ---- the fly-through --------------------------------------------------------------------------------------

const OBJ = { x: 3800, y: 1235 };                     // the school bus
const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, k) => a + (b - a) * k;
const P_RUN = 5, P_ORBIT = 8, P_OUT = 7;               // seconds of the three legs (the path repeats every 20 s)

/**
 * Camera at path time `s` (seconds, repeating every 20): a run in along the road toward the bus (looking
 * down the road), an arc around its north side looking in (the horde and the bots are here), then back west
 * along the road while the view sweeps from the bus over the wrecks and the overpass to the far end
 * of the road. It ends where it began.
 */
export function pathAt(s) {
  s = ((s % 20) + 20) % 20;
  if (s < P_RUN) {
    const k = smooth(s / P_RUN);
    return { x: lerp(2500, 3400, k), y: lerp(1085, 1235, k), yaw: 0.0, pitch: -0.03 };
  }
  if (s < P_RUN + P_ORBIT) {
    const k = smooth((s - P_RUN) / P_ORBIT);
    const phi = Math.PI + k * Math.PI;                 // west of the bus, north of it, east of it
    const x = OBJ.x + Math.cos(phi) * 400, y = OBJ.y + Math.sin(phi) * 200;
    return { x, y, yaw: Math.atan2(OBJ.y - y, OBJ.x - x), pitch: -0.03 + 0.05 * Math.sin(k * Math.PI) };
  }
  const k = smooth((s - P_RUN - P_ORBIT) / P_OUT);
  return { x: lerp(4200, 2500, k), y: lerp(1235, 1085, k), yaw: Math.PI + k * Math.PI, pitch: -0.03 + 0.06 * Math.sin(k * Math.PI) };
}
