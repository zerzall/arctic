// Generation of the world's procedural surface layers (world-surf.js has the overview): the layer
// table, the per-layer shading parameters, the tileable noise, every layer's recipe and the packing
// into RGBA8 texels. Pure JavaScript with no three.js import, so the cinematic 512² set can be
// generated in a worker (world-surf-worker.js) as well as in time slices on the main thread.

/** Layer ids (the third component of the `aDet` vertex attribute). 0 = no detail. */
export const DET = Object.freeze({
  none: 0, brick: 1, concrete: 2, siding: 3, corrugated: 4, panel: 5, char: 6, wood: 7, fabric: 8,
  bark: 9, rubber: 10, shingle: 11, hesco: 12, stucco: 13, rock: 14, glass: 15, asphalt: 16,
  slab: 17, grass: 18, gravel: 19, rust: 20, plastic: 21, dirt: 22,
  // (macro: raw noise fields for the world-space weathering, not a surface)
  macro: 23, plaster: 24, tile: 25, metalroof: 26, paver: 27, cracked: 28, strata: 29, crackmacro: 30, sand: 31,
  // interior surfaces of the story levels (JOURNEY.md §6)
  linoleum: 32, carpet: 33, drywall: 34, ceiltile: 35, wallpaper: 36, terrazzo: 37,
});
const LAYERS = 38;
/** Number of surface layers; the colour / height slice of layer L is L + DET_LAYERS. */
export const DET_LAYERS = LAYERS;
const NAMES = [];
for (const [k, v] of Object.entries(DET)) if (NAMES[v] === undefined) NAMES[v] = k;

/**
 * World units covered by one repeat of each layer (1 unit ≈ 3 cm): brick courses ≈ 9 cm,
 * corrugation ≈ 7 cm, asphalt stones ≈ 1 cm at 8 texels per unit.
 */
export const DET_TILE = new Float32Array(LAYERS);
Object.entries({
  none: 64, brick: 48, concrete: 96, siding: 64, corrugated: 36, panel: 48, char: 40, wood: 40, fabric: 14,
  bark: 36, rubber: 18, shingle: 56, hesco: 30, stucco: 40, rock: 60, glass: 44, asphalt: 30,
  slab: 128, grass: 40, gravel: 26, rust: 44, plastic: 20, dirt: 44,
  macro: 256, plaster: 64, tile: 40, metalroof: 64, paver: 64, cracked: 90, strata: 70, crackmacro: 240, sand: 44,
  // sheet vinyl with a welded seam every 2.4 m, 3 x 3 carpet tiles of 50 cm, drywall with a taped joint
  // every 1.2 m, 2 x 2 ceiling tiles of 60 cm in their grid, three strips of wallpaper, terrazzo panels
  linoleum: 80, carpet: 50, drywall: 80, ceiltile: 40, wallpaper: 48, terrazzo: 40,
}).forEach(([k, v]) => { DET_TILE[DET[k]] = v; });

// Per layer: parallax depth (world units; 0 = flat, no parallax), strength of the fine grain
// added near the eye (0..1) and the weathering class the world material reads:
// 0 other, 1 masonry, 2 metal, 3 wood, 4 rock, 5 soft (ground, bark, rubber, cloth, glass), 6 interior
const LAYER_DEF = {
  none: [0, 0, 0], brick: [0.55, 0.7, 1], concrete: [0.12, 1, 1], siding: [0.55, 0.3, 3], corrugated: [0.45, 0.2, 2],
  panel: [0, 0.15, 0], char: [0.3, 0.8, 0], wood: [0.3, 0.5, 3], fabric: [0.06, 0.3, 5], bark: [1.1, 0.7, 5],
  rubber: [0.45, 0.3, 5], shingle: [0.55, 0.8, 0], hesco: [0.5, 0.6, 0], stucco: [0.25, 0.9, 1], rock: [0.9, 0.9, 4],
  glass: [0, 0, 5], asphalt: [0.2, 1, 5], slab: [0.12, 1, 1], grass: [0.2, 0.6, 5], gravel: [0.55, 0.8, 5],
  rust: [0.1, 0.7, 2], plastic: [0.1, 0.1, 0], dirt: [0.3, 1, 5], macro: [0, 0, 0], plaster: [0.12, 0.7, 1],
  tile: [1.2, 0.6, 0], metalroof: [0.35, 0.3, 2], paver: [0.35, 0.9, 1], cracked: [0.55, 0.9, 5], strata: [1.1, 0.9, 4],
  crackmacro: [0, 0, 5], sand: [0.18, 0.8, 5],
  linoleum: [0.02, 0.2, 6], carpet: [0.12, 0.2, 6], drywall: [0.03, 0.35, 6], ceiltile: [0.4, 0.3, 6], wallpaper: [0.06, 0.3, 6], terrazzo: [0.02, 0.2, 6],
};

// Layers made of discrete elements (bricks, slabs, shingles, tiles): cells across u and v, the shift of
// every other row (running bond) and how much each element's tone may vary. The material hashes each
// element's position in the world, so the same brick never comes back tile after tile.
// Organic layers (no elements) instead blend in a second, rotated and larger copy of their own albedo
// and roughness (a negative amount): a wall of concrete or a rock face stops repeating every tile.
const LAYER_CELLS = {
  brick: [5, 16, 0.5, 0.2], paver: [4, 4, 0, 0.14], shingle: [8, 10, 0.5, 0.14], tile: [8, 8, 0, 0.16], slab: [1, 1, 0, 0.12],
  metalroof: [4, 1, 0, 0.07], carpet: [3, 3, 0, 0.07], ceiltile: [2, 2, 0, 0.05], terrazzo: [1, 1, 0, 0.04],
  concrete: [0, 0, 0, -0.8], stucco: [0, 0, 0, -0.7], plaster: [0, 0, 0, -0.6], rock: [0, 0, 0, -0.9], dirt: [0, 0, 0, -0.7],
  sand: [0, 0, 0, -0.6], char: [0, 0, 0, -0.6], rust: [0, 0, 0, -0.5], grass: [0, 0, 0, -0.6], cracked: [0, 0, 0, -0.5],
  drywall: [0, 0, 0, -0.5], strata: [0, 0, 0, -0.4], bark: [0, 0, 0, -0.4],
};

// A shift (in tiles) that maps each layer's structure onto itself: whole bricks, boards, planks, ribs,
// panels and threads across; an even number of courses up where every other course is offset (and
// threads that keep the weave's parity); anything on organic layers; none where one element fills
// the tile (slabs, terrazzo panels, the vinyl's seams) or a single feature would show twice (the
// star in cracked glass, the centre of a tyre's tread). The material blends in a copy of the layer
// moved by it over patches of the world, so the same peel, stain or knot does not come back tile
// after tile while the joints still line up.
const ANY = [0.43, 0.29];
const LAYER_SHIFT = {
  brick: [2 / 5, 2 / 16], concrete: ANY, siding: [0.37, 5 / 12], corrugated: [5 / 14, 1 / 2], panel: ANY, char: ANY,
  wood: [0.41, 2 / 6], fabric: [10 / 48, 14 / 48], bark: ANY, rubber: [7 / 24, 0], shingle: [3 / 8, 2 / 10],
  hesco: [3 / 10, 4 / 10], stucco: ANY, rock: ANY, asphalt: ANY, grass: ANY, gravel: ANY, rust: ANY, plastic: ANY,
  dirt: ANY, plaster: ANY, tile: [3 / 8, 3 / 8], metalroof: [2 / 4, 2 / 6], paver: [1 / 4, 2 / 4], cracked: ANY,
  strata: ANY, sand: ANY, carpet: [1 / 3, 1 / 3], drywall: [2 / 4, 2 / 6], ceiltile: [1 / 2, 1 / 2], wallpaper: [1 / 3, 1 / 6],
};

/** Per-layer self-mapping shift, 2 floats per layer (u, v in tiles; 0, 0 = the layer is never shifted). */
export const DET_SHIFT = new Float32Array(LAYERS * 2);
for (let i = 0; i < LAYERS; i++) {
  const d = LAYER_SHIFT[NAMES[i]];
  if (d) DET_SHIFT.set(d, i * 2);
}

/**
 * Per-layer element grid, 4 floats per layer: cells along u and v, the shift of odd rows, the
 * tone amplitude (0 = no elements; negative = an organic layer's second-scale blend amount).
 */
export const DET_CELLS = new Float32Array(LAYERS * 4);
for (let i = 0; i < LAYERS; i++) {
  const d = LAYER_CELLS[NAMES[i]];
  if (d) DET_CELLS.set(d, i * 4);
}

/**
 * Per-layer shading parameters, 4 floats per layer: parallax depth in texture units (depth /
 * tile), near-eye grain strength, normal variance lost in the mips (filled in when the layers
 * are generated; the material raises the roughness by it where the layer is minified) and the
 * weathering class. The array object is shared: a uniform can hold it directly.
 */
export const DET_PARAMS = new Float32Array(LAYERS * 4);
for (let i = 0; i < LAYERS; i++) {
  const d = LAYER_DEF[NAMES[i]] || [0, 0, 0];
  DET_PARAMS[i * 4] = d[0] / DET_TILE[i];
  DET_PARAMS[i * 4 + 1] = d[1];
  DET_PARAMS[i * 4 + 3] = d[2];
}

// ---- tileable noise on an N×N grid (generators: they yield every few rows, so a time-sliced
// caller can spread a 512² generation over frames) --------------------------------------------

function rngOf(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of (a, b, c) → [0, 1): per-element ids and per-texel white noise. */
function ih(a, b, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Run `fn(y)` for every row, yielding every `every` rows. The work sits in a plain function:
 * V8 optimizes a function called many times, but never a hot loop in a generator's own body.
 */
function* eachRow(N, fn, every = 8) {
  for (let y = 0; y < N; y++) {
    fn(y);
    if (y % every === every - 1) yield;
  }
}

/** Add `amp` × value noise with `cu` × `cv` lattice cells over the tile (tileable, 0..1) into out. */
function* vnoiseAdd(N, out, cu, cv, seed, amp) {
  const r = rngOf(seed);
  const lat = new Float32Array(cu * cv);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const xa = new Int32Array(N), xb = new Int32Array(N), sx = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const fx = (x / N) * cu, x0 = Math.floor(fx), t = fx - x0;
    xa[x] = x0 % cu; xb[x] = (x0 + 1) % cu; sx[x] = t * t * (3 - 2 * t);
  }
  yield* eachRow(N, (y) => {
    const fy = (y / N) * cv, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % cv) * cu, yb = ((y0 + 1) % cv) * cu, o = y * N;
    for (let x = 0; x < N; x++) {
      const s = sx[x];
      const p = lat[ya + xa[x]], q = lat[ya + xb[x]];
      const top = p + (q - p) * s;
      const u = lat[yb + xa[x]], w = lat[yb + xb[x]];
      out[o + x] += (top + (u + (w - u) * s - top) * sy) * amp;
    }
  }, 16);
}

/** Fractal value noise, normalised to 0..1. `cu`, `cv` = base cells (anisotropic allowed). */
function* fbm(N, cu, cv, oct, seed, gain = 0.5) {
  const out = new Float32Array(N * N);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    yield* vnoiseAdd(N, out, Math.min(N, cu << o), Math.min(N, cv << o), seed + o * 101, amp);
    tot += amp;
    amp *= gain;
  }
  scale(out, 1 / tot);
  return out;
}

/** Worley noise: distance to the nearest / second nearest feature point (in cell units) and its cell id. */
function* worley(N, cells, seed, jitter = 0.9) {
  const r = rngOf(seed);
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells);
  for (let i = 0; i < px.length; i++) { px[i] = 0.5 + (r() - 0.5) * jitter; py[i] = 0.5 + (r() - 0.5) * jitter; }
  // (a random id per cell: the old multiplicative hash of the cell index ran in diagonal bands)
  const cid = new Float32Array(cells * cells);
  for (let i = 0; i < cid.length; i++) cid[i] = r();
  const f1 = new Float32Array(N * N), f2 = new Float32Array(N * N), id = new Float32Array(N * N);
  yield* eachRow(N, (y) => {
    const gy = (y / N) * cells, cy = Math.floor(gy);
    for (let x = 0; x < N; x++) {
      const gx = (x / N) * cells, cx = Math.floor(gx);
      let d1 = 81, d2 = 81, best = 0;
      for (let j = -1; j <= 1; j++) {
        const iy = (cy + j + cells) % cells, dyc = cy + j - gy;
        for (let i = -1; i <= 1; i++) {
          const ix = (cx + i + cells) % cells, k = iy * cells + ix;
          const dx = cx + i + px[k] - gx, dy = dyc + py[k];
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
        }
      }
      const o = y * N + x;
      f1[o] = Math.sqrt(d1); f2[o] = Math.sqrt(d2); id[o] = cid[best];
    }
  });
  return { f1, f2, id };
}

function scale(a, k) { for (let i = 0; i < a.length; i++) a[i] *= k; }

// Scratch arrays by size and name, reused by every layer of a generation (one generation per size
// runs at a time: makeDetailArrayAsync shares a pending one). `zero` clears it first.
const POOL = new Map();
function scratch(N, name, zero = false) {
  const key = N + ':' + name;
  let a = POOL.get(key);
  if (!a) { a = new Float32Array(N * N); POOL.set(key, a); } else if (zero) a.fill(0);
  return a;
}

/** Box blur with wrap-around, radius `rad` texels, separable (`passes` > 1 for a softer kernel). */
function* blur(N, src, rad, passes = 1) {
  let a = src, out = null;
  const tmp = scratch(N, 'blurT'), inv = 1 / (2 * rad + 1), W = N - 1;   // (N is a power of two)
  for (let p = 0; p < passes; p++) {
    const from = a, to = out = scratch(N, p & 1 ? 'blurB' : 'blurA');
    yield* eachRow(N, (y) => {
      const o = y * N;
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += from[o + ((k + N) & W)];
      for (let x = 0; x < N; x++) {
        tmp[o + x] = s * inv;
        s += from[o + ((x + rad + 1) & W)] - from[o + ((x - rad + N) & W)];
      }
    }, 32);
    yield* eachRow(N, (x) => {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += tmp[((k + N) & W) * N + x];
      for (let y = 0; y < N; y++) {
        to[y * N + x] = s * inv;
        s += tmp[((y + rad + 1) & W) * N + x] - tmp[((y - rad + N) & W) * N + x];
      }
    }, 32);
    a = out;
  }
  return out;
}

/** Runs of a mask down the surface (decreasing rows): rust and water trails under their source. */
function* trailDown(N, src, decay) {
  const out = scratch(N, 'trail');
  yield* eachRow(N, (x) => {
    let run = 0;
    // twice round the tile, so a run that starts near the top wraps into the bottom rows
    for (let k = 2 * N - 1; k >= 0; k--) {
      const y = k % N, o = y * N + x;
      run = Math.max(run * decay, src[o]);
      if (k < N) out[o] = run;
    }
  }, 32);
  return out;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);
const hyp = (x, y) => Math.sqrt(x * x + y * y);
/** v wrapped into 0..n (a float modulo without fmod). */
const wrap = (v, n) => v - Math.floor(v / n) * n;
// Table sine / cosine and a polynomial atan2: the libm calls were the hottest part of the recipes
const SIN_N = 4096, SIN_T = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN_T[i] = Math.sin((i / SIN_N) * Math.PI * 2);
function fsin(x) {
  const t = x * (SIN_N / (Math.PI * 2)), f = Math.floor(t), k = f & (SIN_N - 1), w = t - f;
  return SIN_T[k] + (SIN_T[k + 1] - SIN_T[k]) * w;
}
const fcos = (x) => fsin(x + Math.PI / 2);
function fatan2(y, x) {
  const ax = Math.abs(x), ay = Math.abs(y), mx = ax > ay ? ax : ay, mn = ax > ay ? ay : ax;
  const q = mn / (mx || 1), q2 = q * q;
  let r = ((-0.0464964749 * q2 + 0.15931422) * q2 - 0.327622764) * q2 * q + q;
  if (ay > ax) r = Math.PI / 2 - r;
  if (x < 0) r = Math.PI - r;
  return y < 0 ? -r : r;
}

/**
 * A wandering hairline crack: where a mid-scale noise crosses its middle (shifted per caller by
 * `k`), roughened by the fine noise. Voronoi edges read as straight stitched lines at this size.
 */
function crackLine(F, i, k, w) {
  return smooth(w, 0, Math.abs(F.f16[(i + k * 40503) & F.M] - 0.5) + Math.abs(F.f64[i] - 0.5) * 0.06);
}

/**
 * Crevice grime: darker, rougher and browner where the height lies below its neighbourhood
 * (mortar joints, cracks, between stones), a touch lighter on the worn high points.
 */
function* grime(c, amt, rad, opt = {}) {
  const { N, h, a, r, co, ds } = c;
  const gain = opt.gain ?? 5, warm = opt.warm ?? 0.03, wear = opt.wear ?? 0.25, rough = opt.rough ?? 0.5;
  const bl = yield* blur(N, h, Math.max(1, Math.round(rad * c.s)), 2);
  yield* eachRow(N, (y) => {
    for (let i = y * N, e = i + N; i < e; i++) {
      const cav = (h[i] - bl[i]) * gain;
      if (cav < 0) {
        const k = cav < -1 ? 1 : -cav;
        a[i] -= k * amt; r[i] += k * amt * rough; co[i] += k * warm; ds[i] += k * 0.12;
      } else {
        a[i] += (cav > 1 ? 1 : cav) * amt * wear;
      }
    }
  }, 16);
}

// ---- layers ---------------------------------------------------------------------------------

/**
 * Each recipe fills, per texel, h (height 0..1), a (albedo brightness, 0.5 neutral), r
 * (roughness, 0.5 neutral), co / cg (hue shifts, 0 neutral, ±0.5) and ds (desaturation 0..1)
 * and returns the normal strength (height units per texel at 256²). Recipes are generators
 * that yield every few rows. Sizes in texels are written for 256² and scaled by c.s.
 */
const RECIPES = {
  *none(c) { c.h.fill(0.5); return 0; },

  *brick(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    const rows = 16, perRow = 5, rh = N / rows, bl = N / perRow;
    // per brick: tone, burn and hue (a table: the hashes are the hot part of this recipe)
    const T1 = new Float32Array(rows * perRow), T2 = new Float32Array(rows * perRow), T3 = new Float32Array(rows * perRow), T4 = new Float32Array(rows * perRow);
    for (let k = 0; k < rows * perRow; k++) {
      const row = Math.floor(k / perRow), col = k % perRow;
      T1[k] = ih(row, col, 7); T2[k] = ih(row, col, 8); T3[k] = ih(row, col, 9); T4[k] = ih(row, col, 10);
    }
    yield* eachRow(N, (y) => {
      const row = Math.floor(y / rh), fy = y - row * rh;
      // running bond, laid by hand: each course a little off the half-brick
      const off = (row & 1) * 0.5 * bl;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const xx = wrap(x + off, N), col = Math.floor(xx / bl), fx = xx - col * bl;
        const b = row * perRow + (col < perRow ? col : perRow - 1), id = T1[b], id2 = T2[b];
        // chipped arrises: worley bites near the edges, and the edge itself wanders
        const bite = F.w32.id[i] < 0.4 ? Math.max(0, 0.3 - F.w32.f1[i] - (F.f64[i] - 0.5) * 0.3) * (6 + 8 * F.w32.id[i]) * s : 0;
        const edge = Math.min(fy - 0.4 * s, rh - 1 - fy, fx * 0.9, (bl - 1 - fx) * 0.9) - (F.f64[i] - 0.5) * 1.4 * s - bite;
        const m = smooth(0.3 * s, 1.6 * s, edge);   // 0 = mortar joint, 1 = brick face
        const face = 0.8 + ((fx / bl) - 0.5) * (id - 0.5) * 0.12 + ((fy / rh) - 0.5) * (id2 - 0.5) * 0.1
          + (F.f32[i] - 0.5) * 0.08 + (F.f64[i] - 0.5) * 0.06 + (F.n[(i + 1 * 40503) & F.M] - 0.5) * 0.03
          - (F.w64.f1[i] < 0.12 && F.w64.id[i] < 0.5 ? (0.12 - F.w64.f1[i]) * 1.2 : 0) + smooth(0, 3 * s, edge) * 0.05;
        const mortar = 0.16 + (F.f64[i] - 0.5) * 0.06 + (F.n[(i + 2 * 40503) & F.M] - 0.5) * 0.08 - smooth(1.5 * s, 0, Math.abs(fy - rh * 0.02)) * 0.02;
        h[i] = mortar + (face - mortar) * m;
        // per brick: tone, a few over-burnt ones, a few pale ones; iron specks; salt bloom
        const burnt = id2 < 0.08 ? 1 : 0, pale = id2 > 0.93 ? 1 : 0;
        const bloom = smooth(0.6, 0.78, F.f4[i] * 0.55 + F.streak[i] * 0.45) * (0.4 + 0.6 * smooth(0.4, 0.7, F.f16[i]));
        const fa = 0.5 + (id - 0.5) * 0.16 - burnt * 0.14 + pale * 0.08 + (F.f16[i] - 0.5) * 0.12 + (F.f64[i] - 0.5) * 0.07
          - (F.n[(i + 3 * 40503) & F.M] < 0.025 ? 0.12 : 0);
        const ma = 0.64 + (F.f64[i] - 0.5) * 0.1 + (F.n[(i + 4 * 40503) & F.M] - 0.5) * 0.08;
        a[i] = ma + (fa - ma) * m + bloom * 0.1;
        co[i] = m * ((T3[b] - 0.5) * 0.12 - burnt * 0.05 + pale * 0.04) + (1 - m) * 0.02;
        cg[i] = m * ((T4[b] - 0.5) * 0.04 + pale * 0.02);
        ds[i] = (1 - m) * 0.82 + bloom * 0.45;
        r[i] = 0.6 + ((F.f16[i] - 0.5) * 0.18 + (id - 0.5) * 0.1 - burnt * 0.1) * m + (1 - m) * 0.25;
      }
    });
    yield* grime(c, 0.1, 3, { gain: 3 });
    return 2.6;
  },

  *concrete(c) {
    const { N, F, h, a, r, co, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const x = i - y * N;
        // bug holes (air pockets) small and large, a fine sand grain, cement mottle and trowelled patches
        const pit = F.w64.id[i] < 0.28 ? smooth(0.16, 0.04, F.w64.f1[i]) : 0;
        const big = F.w32.id[i] < 0.07 ? smooth(0.2, 0.08, F.w32.f1[i]) : 0;
        const mott = F.f4[i] * 0.55 + F.f16[i] * 0.45;
        const trowel = smooth(0.55, 0.7, F.f8[i]);
        const crack = crackLine(F, i, 1, 0.015) * smooth(0.56, 0.64, F.f4[(i + 2 * 40503) & F.M]);
        const agg = F.n[(i + 5 * 40503) & F.M];
        h[i] = 0.55 + (F.f64[i] - 0.5) * 0.2 * (1 - trowel * 0.6) + (F.f32[i] - 0.5) * 0.08 + (agg - 0.5) * 0.05 * (1 - trowel)
          - pit * 0.3 - big * 0.4 - crack * 0.25;
        a[i] = 0.5 + (mott - 0.5) * 0.32 + (F.f64[i] - 0.5) * 0.07 - smooth(0.58, 0.82, F.streak[i]) * 0.12 - pit * 0.14 - big * 0.2
          + (agg > 0.97 ? 0.08 : agg < 0.03 ? -0.08 : 0) + trowel * 0.03 - crack * 0.18;
        co[i] = (F.f8[i] - 0.5) * 0.05 + (F.f32[i] - 0.5) * 0.02;
        ds[i] = 0.25;
        r[i] = 0.64 + (F.f16[i] - 0.5) * 0.16 - trowel * 0.14 + pit * 0.12;
      }
    });
    yield* grime(c, 0.08, 4, { gain: 4 });
    return 1.3;
  },

  *siding(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    const boards = 12, bh = N / boards;
    yield* eachRow(N, (y) => {
      const b = Math.floor(y / bh), fy = (y - b * bh) / bh;   // fy = 0 at the board's butt (bottom) edge
      const joint = ih(b, 21) * N;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        // lap boards: thick at the butt edge, tapering up under the next board
        const lap = 0.9 - fy * 0.55 - smooth(1.2 * s / bh, 0, fy) * 0.12 + smooth(1 - 1.5 * s / bh, 1, fy) * 0.04;
        const grain = (F.grain[i] - 0.5) * 0.05;
        const peelM = F.f4[i] * 0.78 + F.f8[i] * 0.12 + F.f64[i] * 0.1;
        const peel = smooth(0.652, 0.66, peelM), rim = smooth(0.635, 0.652, peelM) - peel;
        const jd = Math.abs(wrap(x - joint + N * 0.5, N) - N * 0.5);
        const butt = smooth(1.2 * s, 0.2 * s, jd);
        const nail = (Math.abs(((x + b * 13 * s) % (N / 8)) - N / 16) < 1.1 * s && Math.abs(fy - 0.16) < 1.1 * s / bh) ? 1 : 0;
        h[i] = lap + grain * (0.4 + peel) + rim * 0.04 - peel * 0.03 - butt * 0.25 + nail * 0.05;
        const tone = (ih(b, 5) - 0.5) * 0.05;
        const shade = smooth(0.8, 1, fy) * 0.08;   // under the lap above: less light, more dirt
        a[i] = 0.5 + tone + (F.f32[i] - 0.5) * 0.05 - shade - smooth(0.6, 0.85, F.streak[i]) * 0.1 - butt * 0.2 - nail * 0.08
          + rim * 0.07 - peel * (0.08 - grain * 1.5);
        co[i] = peel * 0.07 + nail * 0.1;
        cg[i] = peel * -0.01;
        ds[i] = peel * 0.8 + shade * 1.5;
        r[i] = 0.52 + (F.f8[i] - 0.5) * 0.12 + peel * 0.34 + shade;
      }
    });
    return 2.4;
  },

  *corrugated(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    const ribs = 14, rowsF = 2;
    // fasteners in the valleys, two rows per tile; rust bleeds down from them
    const src = scratch(N, 'src');
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const fyr = fract(y / N * rowsF + 0.12), fxr = fract(x / N * ribs + 0.25);
        const d = Math.hypot((fxr - 0.5) * N / ribs, (fyr - 0.5) * N / rowsF) / s;
        src[i] = (d < 2.4 ? 1 : 0) * (ih(Math.floor(x / N * ribs), Math.floor(y / N * rowsF), 3) < 0.7 ? 1 : 0);
      }
    }, 16);
    const run = yield* trailDown(N, src, 1 - 0.018 / c.s);
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const rib = 0.5 + 0.5 * fsin((x / N) * Math.PI * 2 * ribs);
        const dent = F.w8.id[i] < 0.3 ? smooth(0.5, 0.1, F.w8.f1[i]) * 0.08 : 0;
        const rust = smooth(0.62, 0.82, F.f8[i] * 0.55 + F.streak[i] * 0.3 + F.f64[i] * 0.15);
        const runK = run[i] * (0.5 + 0.5 * F.f64[i]) * (0.7 + 0.3 * (1 - rib));
        const white = smooth(0.62, 0.78, F.f16[i]) * (1 - rust);
        const spangle = (F.w32.id[i] - 0.5);
        const screw = src[i];
        h[i] = rib * 0.85 - dent + (F.f64[i] - 0.5) * 0.04 * (rust + runK) + screw * 0.15 + (F.n[(i + 6 * 40503) & F.M] - 0.5) * 0.02 * rust;
        a[i] = 0.5 + spangle * 0.06 * (1 - rust) + (F.streak[i] - 0.5) * 0.12 + (rib - 0.5) * 0.03 - rust * 0.12 - runK * 0.1 + white * 0.1 - screw * 0.12;
        co[i] = rust * 0.2 + runK * 0.16 + screw * 0.06;
        cg[i] = rust * 0.02;
        ds[i] = white * 0.5 + screw * 0.4;
        r[i] = 0.42 + spangle * 0.12 + rust * 0.42 + runK * 0.25 + white * 0.25;
      }
    });
    return 2.2;
  },

  *panel(c) {
    const { N, F, h, a, r, co, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const x = i - y * N;
        // orange peel, scratches to bare metal, chips down to the primer, dust, smudged gloss, soft dents
        const scratch = F.scr[i];
        const chip = F.w64.id[i] < 0.05 ? smooth(0.2, 0.1, F.w64.f1[i]) : 0;
        const dust = smooth(0.6, 0.8, F.f4[i] * 0.7 + F.f16[i] * 0.3);
        const dent = F.w8.id[i] < 0.25 ? smooth(0.45, 0.05, F.w8.f1[i]) : 0;
        h[i] = 0.5 + (F.f64[i] - 0.5) * 0.05 + (F.n[(i + 7 * 40503) & F.M] - 0.5) * 0.02 - scratch * 0.05 - chip * 0.08 - dent * 0.06;
        a[i] = 0.5 + (F.f8[i] - 0.5) * 0.04 + scratch * 0.03 + chip * 0.05 + dust * 0.06;
        ds[i] = scratch * 0.35 + chip * 0.9 + dust * 0.3;
        co[i] = chip * 0.03 + dust * 0.02;
        r[i] = 0.46 + (F.f16[i] - 0.5) * 0.2 + scratch * 0.06 + chip * 0.25 + dust * 0.2;
      }
    });
    return 0.35;
  },

  *char(c) {
    const { N, F, h, a, r, co, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        // burnt: soot-black, a fine crackle of charred plates where it burnt deepest, blisters, grey
        // ash lying in patches, rust (on metal) or brown char showing through where it flaked
        const deep = smooth(0.46, 0.6, F.f8[i] * 0.7 + F.f64[i] * 0.3);
        const e = F.w32.f2[i] - F.w32.f1[i] + (F.f64[i] - 0.5) * 0.06;
        const crack = smooth(0.09, 0.01, e) * deep;
        const block = smooth(0.02, 0.3, e) * deep;
        const blister = F.w64.id[i] < 0.3 ? smooth(0.32, 0.08, F.w64.f1[i] + (F.f32[i] - 0.5) * 0.2) * (1 - deep) : 0;
        const ash = smooth(0.58, 0.74, F.f16[i] * 0.6 + F.f64[i] * 0.4) * (0.4 + 0.6 * block);
        const rust = smooth(0.6, 0.76, F.f4[i] * 0.7 + F.f32[i] * 0.3) * (1 - deep * 0.6);
        h[i] = 0.4 + block * 0.18 * (0.7 + 0.3 * F.w32.id[i]) - crack * 0.16 + blister * 0.1 + (F.f64[i] - 0.5) * 0.1 + (F.f32[i] - 0.5) * 0.06;
        a[i] = 0.36 + ash * 0.26 + rust * 0.12 + (F.f64[i] - 0.5) * 0.08 - crack * 0.1 + (F.f16[i] - 0.5) * 0.08 - blister * 0.03;
        co[i] = rust * 0.14 * (1 - ash);
        ds[i] = ash * 0.9 + (1 - rust) * 0.4;
        r[i] = 0.9 - rust * 0.08 - blister * 0.12;
      }
    });
    return 1.3;
  },

  *wood(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // planks along u: flat-sawn grain (long gently arching growth rings, earlywood light, latewood
    // dark), fibres and pores, a knot in some planks, butt joints with nails, a few weathered grey
    const planks = 6, ph = N / planks;
    yield* eachRow(N, (y) => {
      const p = Math.floor(y / ph), fy = y - p * ph;
      const hp = ih(p, 3), weather = ih(p, 4) < 0.14 ? 1 : 0;
      const joint = ih(p, 5) * N, rings = 5 + ih(p, 11) * 5;
      const kx = ih(p, 6) * N, ky = ph * (0.3 + 0.4 * ih(p, 7)), kr = (2.5 + 3 * ih(p, 8)) * s, hasK = ih(p, 9) < 0.5;
      const pc = (ih(p, 10) - 0.5) * 0.08;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const gap = smooth(0.4 * s, 1.5 * s, Math.min(fy, ph - 1 - fy));
        const dx = wrap(x - kx + N * 0.5, N) - N * 0.5, dy = fy - ky;
        const kd = hasK ? hyp(dx * 0.3, dy) / kr : 9;
        const bend = kd < 4 ? Math.exp(-kd * kd * 0.5) * 1.2 : 0;
        const phase = (fy / ph) * rings + F.f4[i] * 1.6 + F.f8[i] * 0.35 + hp * 7 + bend * (dy < 0 ? -1 : 1);
        const saw = phase - Math.floor(phase);
        const ring = 0.5 + 0.5 * fcos(phase * Math.PI * 2);
        const r2 = ring * ring, r4 = r2 * r2, late = r4 * r4;
        const early = smooth(0.15, 0.85, saw);
        const fibre = F.grain[i];
        const pore = F.n[((y * N + (x >> 2)) + 7 * 40503) & F.M] > 0.93 ? 1 : 0;
        const knot = hasK ? smooth(1.0, 0.45, kd) : 0;
        const jd = Math.abs(wrap(x - joint + N * 0.5, N) - N * 0.5);
        const butt = smooth(1.1 * s, 0.2 * s, jd);
        const nail = (Math.abs(jd - 3 * s) < 1.1 * s && (Math.abs(fy - ph * 0.25) < 1.1 * s || Math.abs(fy - ph * 0.75) < 1.1 * s)) ? 1 : 0;
        const crack = smooth(0.05, 0.0, Math.abs(F.grain[i] - 0.5)) * smooth(0.6, 0.72, F.f16[i]) * 0.7;
        h[i] = 0.25 + gap * 0.7 * (0.9 + (fibre - 0.5) * 0.1 - late * 0.06 - pore * 0.04) - butt * 0.3 - knot * 0.05 - crack * 0.14 + nail * 0.05;
        a[i] = 0.5 + (hp - 0.5) * 0.14 - late * 0.09 + early * 0.05 + (fibre - 0.5) * 0.16 - pore * 0.05 - (1 - gap) * 0.24 - knot * 0.2
          - butt * 0.2 - nail * 0.18 + weather * 0.03 - crack * 0.12;
        co[i] = pc + late * 0.03 + knot * 0.04 + nail * 0.08 - weather * 0.02;
        cg[i] = -late * 0.01;
        ds[i] = weather * 0.35 + (1 - gap) * 0.2;
        r[i] = 0.62 + (fibre - 0.5) * 0.14 + late * 0.06 + weather * 0.12 + pore * 0.05;
      }
    });
    yield* grime(c, 0.06, 2, { gain: 3 });
    return 2.0;
  },

  *fabric(c) {
    const { N, F, h, a, r, co, ds } = c;
    const T = 48;
    yield* eachRow(N, (y) => {
      const pv = (y / N) * T, iv = Math.floor(pv), fv = pv - iv;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const pu = (x / N) * T, iu = Math.floor(pu), fu = pu - iu;
        // plain weave: warp (along v) and weft (along u) threads over and under each other; slubs
        const over = ((iu + iv) & 1) === 0;
        const tw = 0.85 + 0.3 * ih(iu, 11), tf = 0.85 + 0.3 * ih(iv, 12);
        const warp = fsin(Math.PI * fu) * (0.55 + 0.45 * fsin(Math.PI * fv)) * tw;
        const weft = fsin(Math.PI * fv) * (0.55 + 0.45 * fsin(Math.PI * fu)) * tf;
        const t = over ? warp : weft;
        const stain = F.f4[i] * 0.8 + F.f8[i] * 0.2;
        const wet = smooth(0.62, 0.7, stain);
        h[i] = 0.3 + t * 0.55 + (F.f64[i] - 0.5) * 0.1;
        a[i] = 0.5 + (over ? 0.02 : -0.02) + (t - 0.6) * 0.12 + (F.f4[i] - 0.5) * 0.16 - wet * 0.08 - smooth(0.6, 0.8, F.f16[i]) * 0.08;
        co[i] = wet * 0.04;
        ds[i] = smooth(0.55, 0.75, F.f4[i]) * 0.2;
        r[i] = 0.84 - (t - 0.5) * 0.06;
      }
    });
    return 1.4;
  },

  *bark(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    const idx2 = (x, y) => ((y % N) * N) + ((x * 2) % N);   // worley squeezed across: plates run up the trunk
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x, j = idx2(x, y);
        const ridge = 1 - Math.abs(F.barkN[i] - 0.5) * 2;
        const fiss = smooth(0.72, 0.95, ridge);
        const plateE = F.w16.f2[j] - F.w16.f1[j];
        const split = smooth(0.08, 0.02, plateE) * (1 - fiss);
        const flake = (F.w16.id[j] - 0.5) * 0.12;
        const moss = fiss * smooth(0.55, 0.7, F.f4[i]);
        const lichen = F.w32.id[i] < 0.06 ? smooth(0.3, 0.18, F.w32.f1[i]) * (1 - fiss) * smooth(0.45, 0.6, F.f16[i]) : 0;
        const cork = (F.f32[i] - 0.5) * 0.14 + (F.n[(i + 9 * 40503) & F.M] - 0.5) * 0.05;
        h[i] = 0.2 + (1 - fiss) * (0.6 + flake + (1 - ridge) * 0.12) - split * 0.25 + (F.f64[i] - 0.5) * 0.1 + cork;
        a[i] = 0.52 - fiss * 0.28 + (F.f16[i] - 0.5) * 0.1 + (F.f4[i] - 0.5) * 0.08 + flake * 0.35 - split * 0.14 + lichen * 0.14 + moss * 0.05 + cork * 0.3;
        co[i] = (F.f8[i] - 0.5) * 0.06 - moss * 0.06 - lichen * 0.02;
        cg[i] = moss * 0.14 + lichen * 0.05;
        ds[i] = lichen * 0.55;
        r[i] = 0.82 + fiss * 0.08 - lichen * 0.05;
      }
    });
    return 3;
  },

  *rubber(c) {
    const { N, s, F, h, a, r, co, ds } = c;
    // cylindrical mapping on tyres: u runs around the tread, v across it
    yield* eachRow(N, (y) => {
      const fv = y / N;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const fu = x / N;
        const gv = Math.abs(fract(fv * 4) - 0.5);
        const groove = smooth(0.09, 0.06, gv);
        const sp = Math.abs(fract(fu * 24 + fract(fv * 4) * 0.6) - 0.5);
        const sipe = smooth(0.1, 0.07, sp) * (1 - groove);
        const blockEdge = smooth(0.14, 0.09, Math.min(gv, sp + 0.03));
        const centre = 1 - Math.abs(fv - 0.5) * 2;
        const mud = (groove + sipe * 0.6) * smooth(0.45, 0.6, F.f8[i] * 0.7 + F.f64[i] * 0.3);
        h[i] = 0.78 - groove * 0.55 - sipe * 0.35 - blockEdge * 0.05 + (F.f64[i] - 0.5) * 0.05 + mud * 0.2;
        a[i] = 0.48 - groove * 0.05 + (F.f8[i] - 0.5) * 0.08 + mud * 0.28 + (F.n[(i + 13 * 40503) & F.M] - 0.5) * 0.04 + centre * 0.02;
        co[i] = mud * 0.16;
        ds[i] = 0.3 - mud * 0.2;
        r[i] = 0.74 - (1 - groove) * centre * 0.12 + mud * 0.2;
      }
    });
    void s;
    return 2.4;
  },

  *shingle(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    const rows = 10, rh = N / rows, tabs = 8, tw = N / tabs;
    yield* eachRow(N, (y) => {
      const row = Math.floor(y / rh), fy = (y - row * rh) / rh;   // 0 at the butt edge (downslope)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const xx = (x + (row & 1) * tw * 0.5) % N, t = Math.floor(xx / tw), fx = (xx - t * tw) / tw;
        const slot = smooth(0.05, 0.02, Math.min(fx, 1 - fx)) * smooth(0.75, 0.6, fy);
        const missing = ih(row, t, 14) < 0.035 ? smooth(0.62, 0.55, fy) : 0;
        const g = F.n[(i + 15 * 40503) & F.M];
        const loss = smooth(0.64, 0.72, F.f8[i] * 0.6 + F.f32[i] * 0.4);
        const algae = smooth(0.58, 0.8, F.streak[i]) * (0.4 + 0.6 * F.f16[i]);
        const lichen = F.w32.id[i] < 0.06 ? smooth(0.3, 0.2, F.w32.f1[i]) : 0;
        h[i] = 0.9 - fy * 0.4 - slot * 0.35 - missing * 0.3 + (g - 0.5) * 0.08 * (1 - loss) + (F.f64[i] - 0.5) * 0.05 + lichen * 0.05;
        const tone = (ih(row, t, 16) - 0.5) * 0.16;
        a[i] = 0.5 + tone + (g - 0.5) * 0.18 * (1 - loss * 0.7) - smooth(0.12, 0, fy) * 0.1 - slot * 0.2 - missing * 0.12
          - loss * 0.08 - algae * 0.12 + lichen * 0.2 + (F.f64[i] - 0.5) * 0.06;
        co[i] = (F.n[(i + 17 * 40503) & F.M] - 0.5) * 0.06 + (ih(row, t, 18) - 0.5) * 0.04;
        cg[i] = (F.n[(i + 19 * 40503) & F.M] - 0.5) * 0.03 + algae * 0.02 + lichen * 0.06;
        ds[i] = lichen * 0.6 + algae * 0.3;
        r[i] = 0.84 - loss * 0.08;
      }
    });
    void s;
    return 2.2;
  },

  *hesco(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    const cells = 10, cw = N / cells;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const gx = Math.min(x % cw, cw - (x % cw)), gy = Math.min(y % cw, cw - (y % cw));
        const wx = smooth(1.3 * s, 0.2 * s, gx), wy = smooth(1.3 * s, 0.2 * s, gy);
        const wire = Math.max(wx, wy);
        const weld = wx * wy;
        // non-woven geotextile pressed out between the wires, dusty, stained with the fill
        const bulge = fsin(((x % cw) / cw) * Math.PI) * fsin(((y % cw) / cw) * Math.PI);
        const felt = (F.f64[i] - 0.5) * 0.12 + (F.n[(i + 20 * 40503) & F.M] - 0.5) * 0.08;
        const stain = smooth(0.55, 0.8, F.streak[i] * 0.6 + F.f8[i] * 0.4);
        h[i] = 0.3 + bulge * 0.14 + felt + (F.f16[i] - 0.5) * 0.1 + wire * (0.45 + 0.15 * Math.max(fcos(gx / (1.3 * s) * 1.5), 0));
        a[i] = 0.47 + (F.f8[i] - 0.5) * 0.2 + felt * 0.5 - stain * 0.12 + wire * 0.08 - weld * 0.08 - (1 - bulge) * 0.05 * (1 - wire);
        co[i] = stain * 0.05 + weld * 0.12 * smooth(0.4, 0.6, F.f16[i]);
        cg[i] = 0;
        ds[i] = wire * 0.85;
        r[i] = wire > 0.5 ? 0.38 + weld * 0.3 : 0.86;
      }
    });
    return 2.6;
  },

  *stucco(c) {
    const { N, F, h, a, r, co, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        // knock-down render: lumps of thrown-on mortar, their tops trowelled flat in places; hairline cracks
        const lump = F.f32[i] * 0.5 + smooth(0.45, 0.05, F.w64.f1[i]) * 0.35 + F.f64[i] * 0.15;
        const flat = 0.52 + (F.f8[i] - 0.5) * 0.1;
        const hh = Math.min(lump, flat);
        const crack = crackLine(F, i, 13, 0.014) * smooth(0.52, 0.6, F.f8[(i + 6 * 40503) & F.M]);
        h[i] = 0.2 + hh * 0.8 - crack * 0.15;
        const flatK = lump > flat ? 1 : 0;
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.18 - smooth(0.58, 0.85, F.streak[i]) * 0.12 + (F.f64[i] - 0.5) * 0.05 + flatK * 0.03 - crack * 0.15;
        co[i] = (F.f16[i] - 0.5) * 0.03;
        ds[i] = 0.05;
        r[i] = 0.72 - flatK * 0.08 + (F.f16[i] - 0.5) * 0.08;
      }
    });
    yield* grime(c, 0.1, 2, { gain: 4 });
    return 1.2;
  },

  *rock(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const crack = smooth(0.018, 0.0, Math.abs(F.f16[i] - 0.5) + Math.abs(F.f64[i] - 0.5) * 0.06) * smooth(0.5, 0.62, F.f8[i]);
        const ridged = 1 - Math.abs(F.f16[i] - 0.5) * 2;
        const grainT = (F.w64.id[i] - 0.5);
        const lichen = smooth(0.6, 0.75, F.f4[i] * 0.4 + F.f32[i] * 0.3 + (F.w32.id[i] < 0.3 ? 0.3 : 0)) * smooth(0.35, 0.2, F.w32.f1[i] * 0.6 + 0.2);
        const iron = smooth(0.6, 0.85, F.streak[i]) * 0.8;
        const speck = F.n[(i + 14 * 40503) & F.M];
        h[i] = 0.5 + (F.f8[i] - 0.5) * 0.6 + (F.f32[i] - 0.5) * 0.25 + ridged * 0.1 + (F.f64[i] - 0.5) * 0.1 + (speck - 0.5) * 0.04 - crack * 0.35;
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.24 + grainT * 0.1 + (speck > 0.9 ? 0.1 : speck < 0.08 ? -0.12 : 0) + (F.f8[i] - 0.5) * 0.08 - crack * 0.2 + lichen * 0.22 + (F.f64[i] - 0.5) * 0.06;
        co[i] = iron * 0.07 + (F.w16.id[i] - 0.5) * 0.04 - lichen * 0.02;
        cg[i] = lichen * 0.06 + iron * 0.01;
        ds[i] = lichen * 0.5 + 0.1;
        r[i] = 0.74 + (F.f32[i] - 0.5) * 0.12 + lichen * 0.1 - grainT * 0.1;
      }
    });
    yield* grime(c, 0.1, 4, { gain: 2 });
    return 2.4;
  },

  *glass(c) {
    const { N, F, h, a, r, ds } = c;
    // shattered pane: shards (worley cells) at slightly different angles, bright crack lines, a film of grime
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const edge = F.w8.f2[i] - F.w8.f1[i];
        const crack = smooth(0.05, 0.0, edge);
        const cx = x / N - 0.35, cy = y / N - 0.4;
        const ang = fatan2(cy, cx);
        const radial = smooth(0.06, 0.0, Math.abs(fsin(ang * 9 + F.f4[i] * 3))) * smooth(0.45, 0.05, hyp(cx, cy));
        const film = smooth(0.5, 0.8, F.f4[i] * 0.6 + F.f16[i] * 0.4);
        const smudge = smooth(0.55, 0.75, F.f8[i]);
        const cr = Math.max(crack, radial);
        h[i] = 0.5 + (F.w8.id[i] - 0.5) * 0.9 * (1 - crack);
        a[i] = 0.5 + cr * 0.35 + film * 0.06 + F.scr[i] * 0.06;
        ds[i] = film * 0.6;
        r[i] = 0.46 + cr * 0.4 + film * 0.28 + smudge * 0.12 + F.scr[i] * 0.1;
      }
    });
    return 1.2;
  },

  *asphalt(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const x = i - y * N;
        // angular aggregate of two sizes set in the binder, worn flat on top by the traffic; stones of
        // different rock (grey, pale quartzite, rusty), some polished; tar bleeding up in patches
        const eL = F.w32.f2[i] - F.w32.f1[i], eM = F.w64.f2[i] - F.w64.f1[i];
        const big = F.w32.id[i] < 0.62 ? smooth(0.03, 0.22, eL) : 0;
        const med = F.w64.id[i] < 0.7 ? smooth(0.04, 0.24, eM) : 0;
        const useBig = big > med * 0.8;
        const stone = useBig ? big : med;
        const sid = useBig ? F.w32.id[i] / 0.62 : F.w64.id[i] / 0.7;
        const sand = F.n[(i + 21 * 40503) & F.M];
        const bleed = smooth(0.68, 0.76, F.f16[i] * 0.75 + F.f64[i] * 0.25);
        const binder = 0.3 + (sand - 0.5) * 0.08 + (F.f64[i] - 0.5) * 0.06;
        const tilt = ((F.w32.f1[i] - 0.3) * (sid - 0.5)) * 0.2;
        const top = 0.36 + stone * (useBig ? 0.3 : 0.24) + tilt * stone;
        h[i] = Math.max(binder, top) - bleed * 0.05;
        const st = smooth(0.1, 0.5, stone);
        const light = sid > 0.84 ? 0.2 : sid < 0.18 ? -0.07 : (sid - 0.5) * 0.16;
        a[i] = 0.44 + (sand - 0.5) * 0.06 * (1 - st) + st * (0.05 + light) + (F.f16[i] - 0.5) * 0.08 - bleed * 0.1 * (1 - st);
        co[i] = st * (sid > 0.6 && sid < 0.72 ? 0.07 : (sid - 0.5) * 0.04);
        cg[i] = st * (sid > 0.3 && sid < 0.4 ? 0.02 : 0);
        ds[i] = st * (sid > 0.84 ? 0.5 : 0.15);
        r[i] = 0.72 - st * 0.12 * (sid > 0.5 ? 1 : 0.4) - bleed * 0.3 * (1 - st) + (sand - 0.5) * 0.06;
      }
    });
    yield* grime(c, 0.08, 2, { gain: 3, rough: 0.3 });
    return 1.4;
  },

  *slab(c) {
    const { N, s, F, h, a, r, co, ds } = c;
    // one poured slab per tile: sealed joints at the edges, broom finish across, spalls, cracks, oil and rust
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const jx = Math.min(x, N - 1 - x), jy = Math.min(y, N - 1 - y), jd = Math.min(jx, jy);
        const joint = smooth(2.2 * s, 0.6 * s, jd);
        const spall = smooth(6 * s, 2 * s, jd) * (F.w32.id[i] < 0.3 ? smooth(0.35, 0.15, F.w32.f1[i]) : 0);
        const broom = F.broom[i];
        const crack = crackLine(F, i, 3, 0.016) * smooth(0.55, 0.62, F.f8[(i + 5 * 40503) & F.M]) * smooth(4 * s, 10 * s, jd);
        const oil = smooth(0.62, 0.76, F.f8[i] * 0.6 + F.f32[i] * 0.4) * (F.w8.id[i] > 0.6 ? 1 : 0.3);
        const agg = F.n[(i + 22 * 40503) & F.M];
        // the broom grooves stay faint: under a low fire light stronger ones read as wood grain
        h[i] = 0.56 - joint * 0.45 - spall * 0.25 + (broom - 0.5) * 0.035 + (F.f64[i] - 0.5) * 0.06 + (agg - 0.5) * 0.03 - crack * 0.2;
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.2 + (F.f16[i] - 0.5) * 0.08 - joint * 0.3 - oil * 0.16 + (F.f64[i] - 0.5) * 0.06
          + (agg > 0.97 ? 0.07 : 0) - spall * 0.06 - crack * 0.14;
        co[i] = (F.f8[i] - 0.5) * 0.04 + oil * -0.01 + joint * -0.02;
        ds[i] = 0.25 + joint * 0.5;
        r[i] = 0.62 + (broom - 0.5) * 0.05 - oil * 0.24 - joint * 0.2 + spall * 0.1 + (F.f16[i] - 0.5) * 0.1;
      }
    });
    return 1.6;
  },

  *grass(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        // blades (strokes along v) in clumps of their own shade, dry straw among them, soil in the gaps
        const blades = F.blades[i];
        const stroke = ih(x, Math.floor(y / (3 * c.s)), 23);
        const clump = smooth(0.55, 0.1, F.w16.f1[i]);
        const cid = F.w16.id[i];
        const gapK = smooth(0.42, 0.28, blades * 0.6 + clump * 0.25 + F.f16[i] * 0.15);
        const straw = stroke > 0.88 ? 1 : 0;
        h[i] = 0.25 + blades * 0.45 + clump * 0.15 + (stroke - 0.5) * 0.12 - gapK * 0.1;
        a[i] = 0.5 + (blades - 0.5) * 0.3 + (F.f4[i] - 0.5) * 0.06 + (F.f16[i] - 0.5) * 0.08 + (stroke - 0.5) * 0.12 + straw * 0.12 - gapK * 0.18;
        co[i] = (cid - 0.5) * 0.06 + straw * 0.12 + gapK * 0.1;
        cg[i] = (cid - 0.5) * 0.05 - straw * 0.08 - gapK * 0.12;
        ds[i] = straw * 0.3;
        r[i] = 0.78 + gapK * 0.1;
      }
    });
    return 2.2;
  },

  *gravel(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const x = i - y * N;
        // pebbles of three sizes (the larger lie on top), each of its own rock; fines between
        const d1 = F.w16.f1[i] / 0.44, d2 = F.w32.f1[i] / 0.4, d3 = F.w64.f1[i] / 0.38;
        const p1 = d1 < 1 ? Math.sqrt(1 - d1 * d1) : 0, p2 = d2 < 1 ? Math.sqrt(1 - d2 * d2) : 0, p3 = d3 < 1 ? Math.sqrt(1 - d3 * d3) : 0;
        const t1 = 0.35 + p1 * 0.6, t2 = 0.3 + p2 * 0.45, t3 = 0.25 + p3 * 0.3;
        let top = 0.22 + (F.n[(i + 24 * 40503) & F.M] - 0.5) * 0.06, sid = -1, cover = 0;
        if (p3 > 0 && t3 > top) { top = t3; sid = F.w64.id[i]; cover = p3; }
        if (p2 > 0 && t2 > top) { top = t2; sid = F.w32.id[i]; cover = p2; }
        if (p1 > 0 && t1 > top) { top = t1; sid = F.w16.id[i]; cover = p1; }
        h[i] = top + (F.f64[i] - 0.5) * 0.04;
        const st = smooth(0.0, 0.25, cover);
        const white = sid > 0.86 ? 1 : 0, dark = sid >= 0 && sid < 0.14 ? 1 : 0, rusty = sid > 0.5 && sid < 0.6 ? 1 : 0;
        a[i] = 0.5 + st * ((sid - 0.5) * 0.24 + white * 0.2 - dark * 0.18 + cover * 0.06) - (1 - st) * 0.14 + (F.f16[i] - 0.5) * 0.06;
        co[i] = st * (rusty * 0.08 + (sid - 0.5) * 0.03) + (1 - st) * 0.03;
        cg[i] = st * (sid > 0.3 && sid < 0.36 ? 0.03 : 0);
        ds[i] = st * (white * 0.6 + 0.1);
        r[i] = 0.7 + (1 - st) * 0.18 - st * cover * 0.12 * (sid > 0.6 ? 1 : 0.3);
      }
    });
    yield* grime(c, 0.12, 2, { gain: 3 });
    return 2.8;
  },

  *rust(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    const m = scratch(N, 'mask');
    yield* eachRow(N, (y) => { for (let i = y * N, e = i + N; i < e; i++) m[i] = smooth(0.46, 0.62, F.f8[i] * 0.65 + F.f32[i] * 0.25 + F.f64[i] * 0.1); });
    const run = yield* trailDown(N, m, 1 - 0.012 / c.s);
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const x = i - y * N;
        // paint lifting round patches of scaly rust, pitted, bleeding in runs down the surface
        const rust = m[i];
        const v = F.f8[i] * 0.65 + F.f32[i] * 0.25 + F.f64[i] * 0.1;
        const rim = smooth(0.43, 0.46, v) - rust;
        const pit = rust * (F.w64.id[i] < 0.5 ? smooth(0.25, 0.05, F.w64.f1[i]) : 0);
        const runK = Math.max(0, run[i] - rust) * (0.4 + 0.6 * F.streak[i]);
        const deep = F.f16[i];
        h[i] = 0.55 + rust * ((F.f64[i] - 0.5) * 0.3 + (F.n[(i + 25 * 40503) & F.M] - 0.5) * 0.12 - 0.08) + rim * 0.06 - pit * 0.12;
        a[i] = 0.5 - rust * (0.06 + deep * 0.14) + rim * 0.06 - runK * 0.1 + (F.streak[i] - 0.5) * 0.08 - pit * 0.06;
        co[i] = rust * (0.1 + (1 - deep) * 0.08) + runK * 0.1;
        cg[i] = rust * 0.01;
        ds[i] = rim * 0.3;
        r[i] = 0.44 + rust * 0.42 + runK * 0.2 + (F.f16[i] - 0.5) * 0.08;
      }
    });
    return 1.4;
  },

  *plastic(c) {
    const { N, F, h, a, r, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        // crumpled bin bag / tarp: soft folds of two sizes, ridged where the sheet doubles over, a few
        // pale stretch marks along the ridges, dust in the hollows; glossy
        const fold = 1 - Math.abs(F.f8[i] - 0.5) * 2;
        const fold2 = 1 - Math.abs(F.f32[(i + 21 * 40503) & F.M] - 0.5) * 2;
        const ridge = smooth(0.82, 0.97, fold) * 0.7 + smooth(0.85, 0.98, fold2) * 0.3;
        const dust = smooth(0.6, 0.8, F.f4[i]) * (1 - fold * 0.6);
        h[i] = 0.3 + fold * 0.4 + fold2 * 0.14 + (F.f64[i] - 0.5) * 0.04;
        a[i] = 0.5 + (fold - 0.5) * 0.06 + ridge * 0.06 + dust * 0.06;
        ds[i] = ridge * 0.35 + dust * 0.3;
        r[i] = 0.3 + (1 - fold) * 0.1 + ridge * 0.08 + dust * 0.3;
      }
    });
    return 1.4;
  },

  *dirt(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const x = i - y * N;
        // clods, small stones, crumbs, twigs and damp patches; soil a little redder or greyer in places
        // (a few irregular clods: worley cells frayed by noise, not a field of even bumps)
        const clod = F.w32.id[i] < 0.3 ? smooth(0.42, 0.18, F.w32.f1[i] + (F.f64[i] - 0.5) * 0.35) : 0;
        const stone = F.w64.id[i] < 0.1 ? smooth(0.3, 0.16, F.w64.f1[i] + (F.f64[i] - 0.5) * 0.15) : 0;
        const damp = smooth(0.58, 0.7, F.f8[i] * 0.7 + F.f32[i] * 0.3);
        const crumb = F.n[(i + 26 * 40503) & F.M];
        const twig = F.scr[i] > 0 && F.w16.id[i] < 0.4 ? 1 : 0;
        const ridged = 1 - Math.abs(F.f16[i] - 0.5) * 2;
        h[i] = 0.4 + clod * 0.22 + (F.f32[i] - 0.5) * 0.3 + (F.f64[i] - 0.5) * 0.22 + ridged * 0.08 + stone * 0.2 + (crumb - 0.5) * 0.1 - damp * 0.04;
        a[i] = 0.5 + (F.f8[i] - 0.5) * 0.08 + (F.f32[i] - 0.5) * 0.1 + (F.w32.id[i] - 0.5) * 0.08 * clod + (F.f64[i] - 0.5) * 0.08 + stone * 0.18 - damp * 0.14
          + (crumb > 0.96 ? 0.08 : 0) - twig * 0.14;
        co[i] = (F.f16[i] - 0.5) * 0.05 - stone * 0.03 + twig * 0.03;
        cg[i] = (F.f16[i] - 0.5) * 0.03;
        ds[i] = stone * 0.5;
        r[i] = 0.84 - damp * 0.2 + (F.f16[i] - 0.5) * 0.08;
      }
    });
    yield* grime(c, 0.08, 3, { gain: 2 });
    return 2.4;
  },

  *macro(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    // not a surface: raw tileable fields for the world-space weathering (world-mat.js, ground.js).
    // First slice: R broad, G mid, B vertical drips and streaks, A blotches. Second slice: R, G = a
    // fine isotropic grain's normal, B = its albedo, A = cells (stains, damp patches).
    const drip = scratch(N, 'drip', true);
    const rs = rngOf(313);
    // a run of grime from a ledge or a sill: sharp at the top, fading and thinning downward
    yield* eachRow(90, (k) => {
      const x0 = rs() * N, y0 = rs() * N, len = (0.12 + rs() * 0.45) * N, w = (0.6 + rs() * 2.2) * c.s, v = 0.5 + rs() * 0.5;
      for (let d = 0; d < len; d++) {
        const t = d / len, xw = x0 + fsin(d * 0.05 + k) * 1.2 * c.s, ww = w * (1 - t * 0.6);
        for (let dx = -Math.ceil(ww); dx <= Math.ceil(ww); dx++) {
          const xi = ((Math.floor(xw + dx) % N) + N) % N, yi = ((Math.floor(y0 - d) % N) + N) % N;
          const o = yi * N + xi, val = v * (1 - t) * smooth(ww + 0.5, ww - 0.5, Math.abs(dx));
          if (val > drip[o]) drip[o] = val;
        }
      }
    });
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        h[i] = F.f4[i]; a[i] = F.f8[i]; r[i] = Math.max(F.streak[i] * 0.8, drip[i]); co[i] = F.f16[i];
        cg[i] = F.w16.id[i] * 0.5 + F.f32[i] * 0.5;
        ds[i] = 0;
      }
    });
    return 0;
  },

  *plaster(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        // painted plaster: a trowelled undulation, hairline cracks, paint peeled off in patches with a
        // lifted rim, and tide-marked water stains
        const m = F.f4[i] * 0.78 + F.f8[i] * 0.12 + F.f64[i] * 0.1;
        const peel = smooth(0.645, 0.652, m);
        const rim = smooth(0.632, 0.645, m) - peel;
        const crack = smooth(0.014, 0.0, Math.abs(F.f16[i] - 0.5) + Math.abs(F.f64[i] - 0.5) * 0.08) * smooth(0.52, 0.62, F.f8[i]) * smooth(0.45, 0.6, F.w8.id[i]);
        const st = F.f4[i] * 0.6 + F.f16[i] * 0.4;
        const tide = smooth(0.61, 0.625, st) - smooth(0.63, 0.66, st);
        const stain = smooth(0.62, 0.7, st);
        h[i] = 0.55 + (F.f8[i] - 0.5) * 0.06 - peel * 0.18 + rim * 0.1 - crack * 0.25 + (F.f64[i] - 0.5) * 0.05;
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.1 - peel * 0.03 + rim * 0.06 - crack * 0.18 - smooth(0.6, 0.85, F.streak[i]) * 0.1
          + (F.f64[i] - 0.5) * 0.04 - tide * 0.12 - stain * 0.05;
        co[i] = peel * 0.05 + tide * 0.08 + stain * 0.03;
        cg[i] = tide * 0.01;
        ds[i] = peel * 0.85 + stain * 0.1;
        r[i] = 0.62 + peel * 0.22 + (F.f16[i] - 0.5) * 0.08 + crack * 0.1;
      }
    });
    return 1.4;
  },

  *tile(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    // barrel clay roof tiles in columns, each row lying over the top of the row below (fy = 0 at the lower end)
    const cols = 8, rows = 8, cw = N / cols, rh = N / rows;
    yield* eachRow(N, (y) => {
      const row = Math.floor(y / rh), fy = (y - row * rh) / rh;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const col = Math.floor(x / cw), fx = (x - col * cw) / cw;
        const curve = fsin(fx * Math.PI);
        const id = ih(col, row, 27);
        const lichen = F.w16.id[i] < 0.035 ? smooth(0.4, 0.22, F.w16.f1[i]) * curve * smooth(0.4, 0.55, F.f64[i]) : 0;
        const moss = smooth(0.2, 0.0, fy) * (1 - curve) * smooth(0.45, 0.6, F.f4[i]);
        const chip = id < 0.1 ? smooth(0.1, 0.02, fy) * smooth(0.3, 0.6, F.f64[i]) : 0;
        h[i] = 0.2 + curve * (0.45 + 0.15 * (1 - fy)) + (1 - fy) * 0.25 + (F.f64[i] - 0.5) * 0.05 - chip * 0.3 + lichen * 0.04 + moss * 0.05;
        a[i] = 0.5 + (id - 0.5) * 0.24 + (F.f16[i] - 0.5) * 0.12 - (1 - curve) * 0.14 - smooth(0.85, 1, fy) * 0.18
          - smooth(0.62, 0.82, F.f8[i]) * 0.12 + lichen * 0.24 - moss * 0.08 + (F.n[(i + 28 * 40503) & F.M] - 0.5) * 0.04;
        co[i] = (ih(col, row, 29) - 0.5) * 0.12 - moss * 0.08;
        cg[i] = lichen * 0.06 + moss * 0.14;
        ds[i] = lichen * 0.6;
        r[i] = 0.7 + (F.f8[i] - 0.5) * 0.12 + lichen * 0.1 - (id > 0.8 ? 0.12 : 0);
      }
    });
    return 2.8;
  },

  *metalroof(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // standing-seam metal: raised seams every panel, screws along them; rust blooms at the screws
    // and runs down the pans; a chalky fade in the sun and a slight oil-canning in each pan
    const pw = N / 4;
    const src = scratch(N, 'src');
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const sx = x % pw, sy = y % (N / 6);
        const d = hyp(Math.min(sx, pw - sx) - 5 * s, sy - N / 12) / s;
        src[y * N + x] = d < 1.6 ? 1 : (d < 4 ? 0.5 * smooth(0.4, 0.8, F.f16[y * N + x]) : 0);
      }
    }, 16);
    const run = yield* trailDown(N, src, 1 - 0.01 / c.s);
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const sx = x % pw, seam = smooth(5.5 * s, 0.6 * s, Math.min(sx, pw - sx));
        const can = fsin((sx / pw) * Math.PI) * (F.f8[i] - 0.5) * 0.12;
        const rust = smooth(0.58, 0.8, F.f8[i] * 0.45 + F.streak[i] * 0.35 + F.f64[i] * 0.2 + seam * 0.1);
        const runK = run[i] * (0.5 + 0.5 * F.f64[i]);
        const chalk = smooth(0.4, 0.8, F.f4[i]);
        const screw = src[i] >= 1 ? 1 : 0;
        h[i] = 0.4 + seam * 0.55 + can + (F.f16[i] - 0.5) * 0.04 - rust * 0.04 + screw * 0.08;
        a[i] = 0.5 - rust * 0.16 - runK * 0.12 + (F.streak[i] - 0.5) * 0.14 - seam * 0.04 + (F.f64[i] - 0.5) * 0.05 + chalk * 0.06 - screw * 0.1;
        co[i] = rust * 0.18 + runK * 0.15;
        cg[i] = rust * 0.01;
        ds[i] = chalk * 0.25;
        r[i] = 0.4 + rust * 0.42 + runK * 0.2 + chalk * 0.18 + (F.f16[i] - 0.5) * 0.08;
      }
    });
    return 1.8;
  },

  *paver(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // sidewalk slabs (4 x 4 per tile), each heaved a little out of true: chipped corners, a few
    // cracked, gum spots, stains, moss and weeds in the joints
    const S4 = N / 4;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const sxi = Math.floor(x / S4), syi = Math.floor(y / S4), lx = x - sxi * S4, ly = y - syi * S4;
        const jx = Math.min(lx, S4 - 1 - lx), jy = Math.min(ly, S4 - 1 - ly), jd = Math.min(jx, jy);
        const id = ih(sxi, syi, 30);
        const corner = hyp(Math.min(lx, S4 - lx), Math.min(ly, S4 - ly));
        const chip = ih(sxi, syi, 31) < 0.3 ? smooth(4 * s, 2.5 * s, corner + (F.f64[i] - 0.5) * 2 * s) : 0;
        const joint = Math.max(smooth(2.6 * s, 0.7 * s, jd), chip);
        const heave = ((lx / S4) - 0.5) * (ih(sxi, syi, 32) - 0.5) * 0.14 + ((ly / S4) - 0.5) * (ih(sxi, syi, 33) - 0.5) * 0.14 + (id - 0.5) * 0.08;
        const crack = id < 0.22 ? crackLine(F, i, 4, 0.02) * smooth(2 * s, 5 * s, jd) : 0;
        const gum = F.w64.id[i] < 0.012 ? smooth(0.3, 0.2, F.w64.f1[i]) : 0;
        const weed = joint * smooth(0.6, 0.72, F.f8[i] * 0.6 + F.f64[i] * 0.4);
        h[i] = 0.6 + heave - joint * 0.45 + (F.f64[i] - 0.5) * 0.06 + (F.f16[i] - 0.5) * 0.04 - crack * 0.2 + gum * 0.04 + (F.n[(i + 34 * 40503) & F.M] - 0.5) * 0.03;
        a[i] = 0.5 + (id - 0.5) * 0.18 + (F.f4[i] - 0.5) * 0.12 - joint * 0.26 - smooth(0.6, 0.8, F.f8[i]) * 0.1 + (F.f64[i] - 0.5) * 0.06
          - crack * 0.14 - gum * 0.2 + weed * 0.04;
        co[i] = (ih(sxi, syi, 35) - 0.5) * 0.04 - weed * 0.08;
        cg[i] = weed * 0.18;
        ds[i] = 0.2 + joint * 0.2 - weed * 0.2 + gum * 0.5;
        r[i] = 0.64 + (F.f16[i] - 0.5) * 0.12 + joint * 0.1 - gum * 0.2;
      }
    });
    return 1.9;
  },

  *cracked(c) {
    const { N, F, h, a, r, co, ds } = c;
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        // dry earth: plates curling up at their rims, split by dark cracks, dust on the tops
        const edge = F.w16.f2[i] - F.w16.f1[i];
        const crack = smooth(0.13, 0.02, edge);
        const curl = smooth(0.32, 0.1, edge) * (1 - crack);
        const plate = F.w16.id[i];
        h[i] = 0.42 + smooth(0.02, 0.35, edge) * (0.26 + 0.12 * plate) + curl * 0.08 - crack * 0.24 + (F.f64[i] - 0.5) * 0.07 + (F.f32[i] - 0.5) * 0.1;
        a[i] = 0.5 + (plate - 0.5) * 0.12 - crack * 0.34 + (F.f4[i] - 0.5) * 0.05 + curl * 0.07 + (F.f64[i] - 0.5) * 0.06;
        co[i] = (plate - 0.5) * 0.04 + crack * 0.04;
        ds[i] = curl * 0.15;
        r[i] = 0.86 - crack * 0.1;
      }
    });
    return 3.0;
  },

  *strata(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    // sedimentary rock: horizontal beds of alternating hardness and colour, wavy, soft beds weathered
    // back, split by vertical joints, iron-stained below the joints
    const bands = 12, bh = N / bands;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const yy = y + (F.f8[i] - 0.5) * 26 * c.s + (F.f32[i] - 0.5) * 6 * c.s;
        const yn = wrap(yy, N) / bh;
        const b = Math.floor(yn), fb = yn - b;
        const hb = ih(b, 41), hard = hb > 0.45 ? 1 : 0;
        const joint = smooth(0.04, 0.0, Math.abs(F.w8.f2[i] - F.w8.f1[i])) * (ih(b, Math.floor(x / (20 * c.s)), 42) > 0.6 ? 1 : 0);
        const lamina = 0.5 + 0.5 * fsin(yn * Math.PI * 2 * 3.3 + F.f16[i] * 4);
        h[i] = 0.3 + hb * 0.35 + fb * 0.15 * (hard ? 1 : 0.3) - (fb < 0.1 ? 0.12 : 0) + (F.f64[i] - 0.5) * 0.12 - joint * 0.25 + (1 - hard) * lamina * 0.06;
        a[i] = 0.5 + (hb - 0.5) * 0.34 + (F.f16[i] - 0.5) * 0.12 - (fb < 0.1 ? 0.1 : 0) - joint * 0.14 + (F.f4[i] - 0.5) * 0.06 + lamina * 0.04 * (1 - hard);
        co[i] = (ih(b, 43) - 0.5) * 0.12 + smooth(0.6, 0.85, F.streak[i]) * 0.06;
        cg[i] = (ih(b, 44) - 0.5) * 0.03;
        ds[i] = hard * 0.1;
        r[i] = 0.72 + (hb - 0.5) * 0.2;
      }
    });
    yield* grime(c, 0.08, 3, { gain: 2 });
    return 2.6;
  },

  *crackmacro(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // a slab of old road at a large scale: cracks with ravelled rims, tar-sealed cracks, seams,
    // patches of newer and older asphalt, oil stains
    const idx = (x, y) => (((Math.floor(y) % N) + N) % N) * N + (((Math.floor(x) % N) + N) % N);
    const crk = scratch(N, 'k1', true), seal = scratch(N, 'k2', true), tar = scratch(N, 'k3', true), oil = scratch(N, 'k4', true), patch = scratch(N, 'k5', true), edge = scratch(N, 'k6', true);
    const rs = rngOf(4711);
    const dot = (arr, x, y, w, v) => {
      for (let j = -w; j <= w; j++) for (let k = -w; k <= w; k++) {
        const d = hyp(j, k);
        if (d <= w + 0.5) { const o = idx(x + k, y + j); arr[o] = Math.max(arr[o], v * (1 - d / (w + 1))); }
      }
    };
    const crack = (arr, x, y, ang, len, w, depth) => {
      for (let st = 0; st < len; st++) {
        dot(arr, x, y, w, 1);
        ang += (rs() - 0.5) * 0.5;
        x += fcos(ang) * s; y += fsin(ang) * s;
        if (depth > 0 && rs() < 0.035) crack(arr, x, y, ang + (rs() < 0.5 ? -1 : 1) * (0.5 + rs() * 0.8), Math.floor(len * (0.3 + rs() * 0.4)), Math.max(0, w - 1), depth - 1);
      }
    };
    const ws = Math.round(s);
    // (every crack, patch row and blotch is its own step: at 512² a batch of them ran past a frame's slice)
    yield* eachRow(16, () => crack(crk, rs() * N, rs() * N, rs() * Math.PI * 2, (50 + rs() * 110) * s, rs() < 0.35 ? ws : ws - 1, 2), 1);
    // crack sealing: black tar squiggles over some old cracks
    yield* eachRow(5, () => crack(seal, rs() * N, rs() * N, rs() * Math.PI * 2, (60 + rs() * 90) * s, ws + 1, 1), 1);
    // alligator cracking: a tight net in two wheel-path-like patches
    for (const [cx, cy] of [[70, 190], [190, 60]]) {
      const y0 = Math.round(-28 * s);
      yield* eachRow(Math.round(56 * s) + 1, (row) => {
        const y = y0 + row;
        for (let x = -34 * s; x <= 34 * s; x++) {
          const o = idx(cx * s + x, cy * s + y);
          const e = F.w32.f2[o] - F.w32.f1[o];
          const fall = 1 - Math.min(1, hyp(x / (34 * s), y / (28 * s)));
          if (e < 0.06 && fall > 0.25 + F.f16[o] * 0.4) crk[o] = Math.max(crk[o], 0.8);
        }
      }, 16);
    }
    // tar-filled seams: one straight joint each way, slightly wandering
    yield* eachRow(N, (x) => { const wy = (62 + fsin(x / N * Math.PI * 6) * 1.6) * s; dot(tar, x, wy, ws, 1); dot(tar, x, wy + 3 * s, ws - 1, 0.6); }, 64);
    yield* eachRow(N, (y) => { const wx = (168 + fsin(y / N * Math.PI * 4 + 1) * 1.8) * s; dot(tar, wx, y, ws, 1); }, 64);
    // patches: rectangles of newer / older asphalt with a tarred edge
    for (const [px, py, pw, ph, tone] of [[20, 120, 64, 34, 0.09], [176, 196, 52, 40, -0.07], [120, 20, 40, 26, 0.06]]) {
      yield* eachRow(ph * s, (row) => {
        const y = py * s + row;
        for (let x = px * s; x < (px + pw) * s; x++) {
          const o = idx(x, y);
          patch[o] = tone;
          if (x < (px + 2) * s || x >= (px + pw - 2) * s || y < (py + 2) * s || y >= (py + ph - 2) * s) edge[o] = 1;
        }
      }, 16);
    }
    // oil drips: dark, glossy blotches
    yield* eachRow(7, () => {
      const ox = rs() * N, oy = rs() * N, rad = (6 + rs() * 12) * s;
      for (let y = -rad * 1.6; y <= rad * 1.6; y++) for (let x = -rad * 1.6; x <= rad * 1.6; x++) {
        const o = idx(ox + x, oy + y);
        const d = hyp(x, y) / rad + (F.f16[o] - 0.5) * 0.9;
        if (d < 1) oil[o] = Math.max(oil[o], 1 - d);
      }
    }, 1);
    // ravelled rims: the aggregate loosened along each crack
    const rim = yield* blur(N, crk, Math.max(1, Math.round(2 * s)), 1);
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const worn = (F.f4[i] - 0.5) * 0.1 + (F.f16[i] - 0.5) * 0.06;
        const rv = Math.max(0, rim[i] * 2.2 - crk[i]) * smooth(0.4, 0.6, F.f64[i]);
        const sl = seal[i] * (1 - crk[i] * 0.3);
        h[i] = 0.5 - crk[i] * 0.42 - tar[i] * 0.14 + edge[i] * 0.05 + (F.f64[i] - 0.5) * 0.04 - rv * 0.08 + sl * 0.06;
        a[i] = 0.5 + worn + patch[i] - crk[i] * 0.38 - tar[i] * 0.3 - oil[i] * 0.24 - edge[i] * 0.12 + rv * 0.05 - sl * 0.34;
        co[i] = oil[i] * 0.01 + (patch[i] > 0 ? 0.01 : 0);
        cg[i] = 0;
        ds[i] = rv * 0.2 + patch[i] * 1.5;
        r[i] = 0.55 + crk[i] * 0.35 - tar[i] * 0.2 - oil[i] * 0.32 + (patch[i] !== 0 ? 0.06 : 0) - sl * 0.3 + rv * 0.1;
      }
    });
    return 1.6;
  },

  *sand(c) {
    const { N, F, h, a, r, co, cg, ds } = c;
    // wind ripples, wandering slightly, with a grain of mixed minerals and the odd pebble
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const ph = ((x * 3 + y) / N) * Math.PI * 2 * 3 + (F.f8[i] - 0.5) * 7 + (F.f32[i] - 0.5) * 1.6;
        const rip = 0.5 + 0.5 * fsin(ph);
        const g = F.n[(i + 36 * 40503) & F.M];
        const peb = F.w64.id[i] < 0.03 ? smooth(0.28, 0.12, F.w64.f1[i]) : 0;
        h[i] = 0.45 + rip * 0.35 + (F.f64[i] - 0.5) * 0.12 + (g - 0.5) * 0.04 + peb * 0.2;
        a[i] = 0.5 + (rip - 0.5) * 0.1 + (F.f4[i] - 0.5) * 0.05 + (F.f16[i] - 0.5) * 0.06 + (F.f64[i] - 0.5) * 0.07 + (g > 0.94 ? 0.1 : g < 0.05 ? -0.14 : 0) - peb * 0.1;
        co[i] = (g > 0.9 && g < 0.94 ? 0.06 : 0) + (F.f16[i] - 0.5) * 0.04;
        cg[i] = 0;
        ds[i] = g < 0.05 ? 0.5 : peb * 0.5;
        r[i] = 0.88 + (rip - 0.5) * 0.04;
      }
    });
    return 1.5;
  },

  // ---- interiors (JOURNEY.md §6) ----

  *linoleum(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // hospital sheet vinyl: a fine marbled chip in two tones, heat-welded seams (along the roll and
    // across it), grey heel scuffs, the polish worn dull along the walking lanes, the floor's slight wave
    const scuff = scratch(N, 'drip', true);
    const rs = rngOf(2718);
    for (let k = 0; k < 28; k++) {
      // a heel mark: a short curved stroke, darkest in the middle
      let x = rs() * N, y = rs() * N, ang = rs() * Math.PI * 2;
      const len = (5 + rs() * 16) * s, bend = (rs() - 0.5) * 0.14, v = 0.3 + rs() * 0.7;
      for (let d = 0; d < len; d++) {
        const t = d / len, w = fsin(t * Math.PI);
        const o = ((Math.floor(y) % N + N) % N) * N + ((Math.floor(x) % N + N) % N);
        scuff[o] = Math.max(scuff[o], v * w);
        ang += bend; x += fcos(ang) * 0.8; y += fsin(ang) * 0.8;
      }
    }
    yield;
    const sc = yield* blur(N, scuff, Math.max(1, Math.round(0.8 * s)), 1);
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const seam = Math.max(smooth(1.1 * s, 0.3 * s, Math.min(y, N - 1 - y)), smooth(1.1 * s, 0.3 * s, Math.abs(x - N * 0.5)) * 0.8);
        // chips: flecks stretched along the roll (the worley cells squeezed across), light and dark
        const j = y * N + ((x * 3) & (N - 1));
        const chip = F.w64.f1[j] < 0.3 ? (F.w64.id[j] < 0.28 ? -1 : F.w64.id[j] > 0.74 ? 1 : 0) * smooth(0.3, 0.22, F.w64.f1[j]) : 0;
        const g = F.n[(i + 32 * 40503) & F.M];
        const marble = (F.f16[i] - 0.5) * 0.07 + (F.f64[i] - 0.5) * 0.04 + (g > 0.93 ? 0.05 : g < 0.07 ? -0.05 : 0);
        const lane = smooth(0.45, 0.7, F.f4[i]);
        const scK = Math.min(1, sc[i] * 2.4);
        h[i] = 0.5 + (F.f4[i] - 0.5) * 0.08 + (F.f8[i] - 0.5) * 0.03 - seam * 0.1 + scK * 0.015 + chip * 0.005;
        a[i] = 0.5 + marble + chip * 0.09 - seam * 0.08 - scK * 0.2 - lane * 0.025;
        co[i] = chip * 0.02 + lane * 0.008 + (g > 0.97 ? 0.05 : 0);
        cg[i] = -chip * 0.012 + (g < 0.03 ? 0.04 : 0);
        ds[i] = scK * 0.55 + seam * 0.25;
        r[i] = 0.3 + lane * 0.2 + (F.f16[i] - 0.5) * 0.08 + scK * 0.1 + seam * 0.15 + (F.n[(i + 37 * 40503) & F.M] - 0.5) * 0.04;
      }
    });
    return 0.7;
  },

  *carpet(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // commercial carpet tiles (3 x 3 per tile), laid quarter-turned: each tile's striated pile runs
    // across its neighbours' and catches the light differently; a tweed of coloured flecks, the seams,
    // a worn lane, the odd stain
    const T3 = N / 3;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const tx = Math.floor(x / T3), ty = Math.floor(y / T3), lx = x - tx * T3, ly = y - ty * T3;
        const turn = (tx + ty) & 1;
        const seam = smooth(0.9 * s, 0.2 * s, Math.min(lx, T3 - 1 - lx, ly, T3 - 1 - ly));
        // the striated pattern of the pile along the tile's direction (the grain field, transposed on a turn)
        const stri = turn ? F.grain[x * N + y] : F.grain[i];
        const g = F.n[(i + 33 * 40503) & F.M], g2 = F.n[(i + 34 * 40503) & F.M];
        const fleck = g > 0.9 ? 1 : g < 0.1 ? -1 : 0;
        const stainV = F.f4[(i + 11 * 40503) & F.M] * 0.8 + F.f16[i] * 0.2;
        const stain = smooth(0.655, 0.68, stainV);
        const wear = smooth(0.5, 0.75, F.f4[i]);
        h[i] = 0.5 + (g - 0.5) * 0.3 + (stri - 0.5) * 0.25 * (1 - wear * 0.5) - seam * 0.35;
        a[i] = 0.5 + (turn ? 0.035 : -0.035) + (stri - 0.5) * 0.12 + fleck * 0.1 - seam * 0.12 - stain * 0.1 + wear * 0.05 + (F.f16[i] - 0.5) * 0.05;
        co[i] = (fleck !== 0 ? (g2 - 0.5) * 0.22 : 0) + stain * 0.05;
        cg[i] = fleck !== 0 ? (F.n[(i + 35 * 40503) & F.M] - 0.5) * 0.16 : 0;
        ds[i] = wear * 0.15;
        r[i] = 0.93 + (g - 0.5) * 0.04;
      }
    });
    return 1.3;
  },

  *drywall(c) {
    const { N, s, F, h, a, r, co, ds } = c;
    // painted drywall: a roller's stipple over everything, the taped joints (every 1.2 m) feathered
    // smooth, screw pops in rows along the studs, dings and a patched spot with a different sheen
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const stip = (F.f64[i] - 0.5) * 0.6 + (F.n[(i + 41 * 40503) & F.M] - 0.5) * 0.3 + smooth(0.34, 0.1, F.w64.f1[i]) * 0.35 * (F.w64.id[i] < 0.5 ? 1 : -0.7);
        const jd = Math.min(Math.abs(x - N * 0.25), Math.abs(x - N * 0.75));
        const tape = smooth(10 * s, 3 * s, jd);
        const pop = (Math.abs(((x + N / 16) % (N / 8)) - N / 16) < 1.2 * s && Math.abs(((y + N / 12) % (N / 6)) - N / 12) < 1.2 * s) && ih(Math.floor(x / (N / 8)), Math.floor(y / (N / 6)), 42) < 0.4 ? 1 : 0;
        const ding = F.w32.id[i] < 0.04 ? smooth(0.25, 0.1, F.w32.f1[i]) : 0;
        const patchV = F.f8[i] * 0.7 + F.f16[i] * 0.3;
        const patch = smooth(0.66, 0.68, patchV);
        const sm = Math.max(tape * 0.6, patch);
        h[i] = 0.5 + stip * 0.08 * (1 - sm) + (F.f8[i] - 0.5) * 0.04 + tape * 0.03 + pop * 0.12 - ding * 0.15;
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.04 + stip * 0.02 + (patch * 0.03) - ding * 0.08 + pop * 0.03 - smooth(0.62, 0.85, F.streak[i]) * 0.03;
        co[i] = patch * 0.01;
        ds[i] = 0;
        r[i] = 0.6 + stip * 0.06 - sm * 0.1 + (F.f16[i] - 0.5) * 0.04;
      }
    });
    return 1.3;
  },

  *ceiltile(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // acoustic ceiling: 2 x 2 fissured mineral-fibre tiles lying in a painted T-bar grid; a brown water
    // stain with a tide mark on the odd tile, a sagging tile, pinholes everywhere
    const T2 = N / 2;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const txi = Math.floor(x / T2), tyi = Math.floor(y / T2), lx = x - txi * T2, ly = y - tyi * T2, tid = ih(txi, tyi, 43);
        const gd = Math.min(lx, T2 - lx, ly, T2 - ly);
        const grid = smooth(2.8 * s, 2.0 * s, gd);
        const bevel = smooth(4.5 * s, 2.8 * s, gd) * (1 - grid);
        const fiss = smooth(0.03, 0.0, Math.abs(F.f32[i] - 0.5) + (F.f64[i] - 0.5) * 0.05) * smooth(0.35, 0.55, F.f16[i]);
        const g = F.n[(i + 44 * 40503) & F.M];
        const pin = g > 0.955 ? 1 : 0;
        // a stain on some tiles: a blotch around a point of the tile, ringed by its tide mark
        const sx = (ih(txi, tyi, 45) * 0.6 + 0.2) * T2, sy = (ih(txi, tyi, 46) * 0.6 + 0.2) * T2, sr = (0.2 + 0.25 * ih(txi, tyi, 47)) * T2;
        const sd = tid < 0.2 ? hyp(lx - sx, ly - sy) / sr + (F.f16[i] - 0.5) * 0.7 : 9;
        const stain = smooth(1.0, 0.6, sd) * (1 - grid);
        const tide = (smooth(0.86, 0.96, sd) - smooth(0.98, 1.08, sd)) * (1 - grid);
        const sag = tid > 0.85 ? fsin((lx / T2) * Math.PI) * fsin((ly / T2) * Math.PI) * 0.12 : 0;
        h[i] = grid * 0.95 + (1 - grid) * (0.45 - bevel * 0.1 - fiss * 0.1 - pin * 0.14 + (g - 0.5) * 0.03 + (F.f64[i] - 0.5) * 0.05 - sag);
        a[i] = 0.5 + grid * 0.04 - fiss * 0.09 - pin * 0.14 - bevel * 0.04 - stain * 0.07 - tide * 0.14 + (tid - 0.5) * 0.03 + (F.f64[i] - 0.5) * 0.03;
        co[i] = stain * 0.08 + tide * 0.12;
        cg[i] = stain * 0.015;
        ds[i] = grid * 0.6;
        r[i] = grid * 0.35 + (1 - grid) * 0.92;
      }
    });
    return 1.6;
  },

  *wallpaper(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // three strips of faded patterned paper: a stripe and a lozenge-and-flower motif in a second tone,
    // the seams between the strips a little open, sun-faded patches, water stains, and paper torn off in
    // patches (mostly from the seams) down to the grey plaster, its edge lifted
    const strips = 3, sw = N / strips;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const st = Math.floor(x / sw), lx = x - st * sw;
        const sd = Math.min(lx, sw - 1 - lx);
        const seam = smooth(0.9 * s, 0.1 * s, sd);
        const stripe = smooth(0.46, 0.5, Math.abs(fract(lx / sw * 4) - 0.5)) * 0.6;
        // the motif: a lozenge lattice with a four-petal flower in each cell
        const cu = fract(((lx + sw / 8) / sw) * 4), cv = fract((y / N) * 6);
        const du = Math.abs(cu - 0.5), dv = Math.abs(cv - 0.5);
        const loz = smooth(0.06, 0.02, Math.abs(du + dv * 0.67 - 0.42));
        const petal = smooth(0.2, 0.15, hyp(du, dv * 0.67) - 0.05 * fcos(fatan2(dv, du) * 4));
        const pat = Math.max(loz, stripe);
        const fade = smooth(0.4, 0.75, F.f4[i] * 0.7 + F.f16[i] * 0.3);
        const pv = F.f4[(i + 3 * 40503) & F.M] * 0.62 + F.f16[i] * 0.16 + F.f64[i] * 0.1 + smooth(8 * s, 0, sd) * 0.1;
        const peel = smooth(0.66, 0.668, pv);
        const lift = smooth(0.645, 0.66, pv) - peel;
        const tv = F.f16[i] * 0.6 + F.streak[i] * 0.4;
        const tide = smooth(0.62, 0.635, tv) - smooth(0.64, 0.67, tv);
        const damp = smooth(0.63, 0.7, tv);
        const contrast = 1 - fade * 0.6;
        h[i] = 0.55 + pat * 0.015 + (F.f64[i] - 0.5) * 0.03 - seam * 0.08 + lift * 0.14 - peel * 0.2 + peel * (F.f32[i] - 0.5) * 0.12;
        const pa = 0.5 - pat * 0.12 * contrast - petal * 0.08 * contrast + fade * 0.06 - seam * 0.06 - tide * 0.14 - damp * 0.05 + lift * 0.05 + (F.f64[i] - 0.5) * 0.03;
        a[i] = pa * (1 - peel) + (0.62 + (F.f16[i] - 0.5) * 0.1) * peel;
        co[i] = (pat * 0.05 * contrast + petal * 0.1 * contrast + tide * 0.08 + damp * 0.04) * (1 - peel) + peel * 0.02;
        cg[i] = (-pat * 0.03 - petal * 0.06) * contrast * (1 - peel);
        ds[i] = fade * 0.3 * (1 - peel) + peel * 0.9;
        r[i] = 0.78 + peel * 0.12 - lift * 0.05;
      }
    });
    return 1.0;
  },

  *terrazzo(c) {
    const { N, s, F, h, a, r, co, cg, ds } = c;
    // mall terrazzo: marble chips of several stones set in a cement matrix, ground and polished flat,
    // brass divider strips at the panel edges, dull scuffed lanes and the odd hairline crack
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const jd = Math.min(x, N - 1 - x, y, N - 1 - y);
        const strip = smooth(1.0 * s, 0.4 * s, jd);
        // chips: shrunken voronoi cells (angular, like crushed marble), large and small
        const eL = F.w32.f2[i] - F.w32.f1[i], eS = F.w64.f2[i] - F.w64.f1[i];
        const big = F.w32.id[i] < 0.55 ? smooth(0.08, 0.14, eL) : 0;
        const small = smooth(0.1, 0.17, eS) * (F.w64.id[i] < 0.7 ? 1 : 0);
        const chip = Math.max(big, small * (1 - big));
        const cid = big > small ? F.w32.id[i] : F.w64.id[i];
        const kind = Math.floor(cid * 97) % 6;   // white, grey, black, rust, green, cream
        const ca = [0.22, 0.02, -0.26, -0.04, -0.06, 0.14][kind] + (fract(cid * 31.7) - 0.5) * 0.08;
        const cco = [0, 0, 0, 0.14, -0.04, 0.05][kind], ccg = [0, 0, 0, -0.04, 0.08, 0.01][kind], cds = [0.9, 0.9, 0.9, 0.1, 0.2, 0.5][kind];
        const lane = smooth(0.5, 0.75, F.f4[i]);
        const crack = crackLine(F, i, 37, 0.01) * smooth(0.58, 0.64, F.f8[(i + 8 * 40503) & F.M]);
        const matrix = (F.n[(i + 45 * 40503) & F.M] - 0.5) * 0.04 + (F.f16[i] - 0.5) * 0.05;
        h[i] = 0.5 + (F.f8[i] - 0.5) * 0.03 + chip * 0.004 - crack * 0.1 + strip * 0.02;
        a[i] = 0.5 + matrix * (1 - chip) + chip * ca + strip * 0.1 - crack * 0.1;
        co[i] = chip * cco + strip * 0.18;
        cg[i] = chip * ccg + strip * 0.04;
        ds[i] = chip * cds + strip * -0.3;
        r[i] = 0.22 + lane * 0.2 + (F.f16[i] - 0.5) * 0.06 - chip * 0.04 + crack * 0.2 - strip * 0.06;
      }
    });
    return 1.4;
  },
};

// ---- generation -----------------------------------------------------------------------------

const cpuCache = new Map();   // size → RGBA8 texel data (both slices of every layer)
/** Generation timings for the dev tools (world-surf.js detailGenBreakdown). */
export const genStats = { ms: 0, fieldsMs: 0, layerMs: {}, slices: 0, maxSliceMs: 0, ms512: 0, maxStepMs: 0, maxStepAt: '' };

/**
 * Generate (once per size) the RGBA8 texel data of every layer, synchronously.
 * @param {number} [n] layer size (256 or 512)
 * @returns {Uint8Array} both slices of every layer, n × n × 4 × 2 DET_LAYERS bytes
 */
export function generateLayers(n = 256) {
  const d = cpuCache.get(n);
  if (d) return d;
  const g = generateSteps(n);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/** The cached texel data of a size, or null. */
export function cachedLayers(n) { return cpuCache.get(n) || null; }
/** Keep texel data generated elsewhere (the worker) as a size's cache. */
export function keepLayers(n, data) { cpuCache.set(n, data); }

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The generation as a generator of n² layers: it yields every few rows of every field and
 * layer (a fraction of a millisecond of work at 512²), so a caller can spread it over frames.
 * All state is local: a synchronous 256² generation may run in between.
 */
export function* generateSteps(n) {
  const cached = cpuCache.get(n);
  if (cached) return cached;
  const N = n, NN = N * N;
  let tWork = 0, tMark = now(), at = 'fields';
  const lap = () => {
    const t = now(), d = t - tMark;
    tWork += d; tMark = t;
    if (n > 256 && d > genStats.maxStepMs) { genStats.maxStepMs = d; genStats.maxStepAt = at; }
  };
  // (time spent paused between slices is not work: `lap` closes a stretch before every yield)
  function* sliced(gen) {
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
      lap();
      yield;
      tMark = now();
    }
  }
  const F = {};
  at = 'noise';
  F.f4 = yield* sliced(fbm(N, 4, 4, 5, 11)); F.f8 = yield* sliced(fbm(N, 8, 8, 4, 23)); F.f16 = yield* sliced(fbm(N, 16, 16, 4, 37));
  F.f32 = yield* sliced(fbm(N, 32, 32, 3, 41)); F.f64 = yield* sliced(fbm(N, 64, 64, 2, 53));
  F.streak = yield* sliced(fbm(N, 24, 2, 4, 61));          // vertical streaks (stretched along v)
  F.grain = yield* sliced(fbm(N, 4, 48, 3, 71));           // wood grain along u
  F.barkN = yield* sliced(fbm(N, 10, 2, 4, 83));
  F.broom = yield* sliced(fbm(N, 2, 128, 2, 97));          // brushed across v
  F.blades = yield* sliced(fbm(N, 96, 12, 2, 109, 0.6));
  at = 'worley';
  F.w8 = yield* sliced(worley(N, 8, 5, 1)); F.w16 = yield* sliced(worley(N, 16, 7)); F.w32 = yield* sliced(worley(N, 32, 9));
  F.w64 = yield* sliced(worley(N, 64, 13));
  // sparse fine scratches for painted metal (and twigs in the dirt)
  at = 'scratches';
  F.scr = scratches(N);
  // per-texel white noise (grain, granules, flecks): recipes read it at index offsets, F.n[(i + k) & F.M]
  F.n = new Float32Array(NN);
  F.M = NN - 1;
  const rw = rngOf(9091);
  yield* sliced(eachRow(N, (y) => { for (let i = y * N, e = i + N; i < e; i++) F.n[i] = rw(); }, 64));
  at = 'alloc';
  lap();
  const fieldsMs = tWork;
  const data = new Uint8Array(NN * 4 * LAYERS * 2);
  const c = {
    N, s: N / 256, F,
    h: new Float32Array(NN), a: new Float32Array(NN), r: new Float32Array(NN),
    co: new Float32Array(NN), cg: new Float32Array(NN), ds: new Float32Array(NN),
  };
  const layerMs = {};
  const variance = new Float32Array(LAYERS);
  for (let id = 0; id < LAYERS; id++) {
    const name = at = NAMES[id];
    const fn = RECIPES[name];
    const t0 = tWork;
    c.h.fill(0.5); c.a.fill(0.5); c.r.fill(0.5); c.co.fill(0); c.cg.fill(0); c.ds.fill(0);
    const k = fn ? yield* sliced(fn(c)) : 0;
    variance[id] = yield* sliced(pack(c, data, id, k, name === 'macro'));
    lap();
    layerMs[name] = Math.round(tWork - t0);
  }
  cpuCache.set(n, data);
  if (n === 256) {
    genStats.ms = Math.round(tWork); genStats.fieldsMs = Math.round(fieldsMs); genStats.layerMs = layerMs;
    // the normal variance each layer loses in its mips (the material turns it into roughness)
    for (let i = 0; i < LAYERS; i++) DET_PARAMS[i * 4 + 2] = variance[i];
  } else genStats.ms512 = Math.round(tWork);
  return data;
}

/** Sparse fine scratches for painted metal (and twigs in the dirt). */
function scratches(N) {
  const out = new Float32Array(N * N);
  const rs = rngOf(777);
  for (let k = 0; k < 90; k++) {
    let x = rs() * N, y = rs() * N;
    const ang = rs() * Math.PI, len = (8 + rs() * 40) * (N / 256);
    for (let st = 0; st < len; st++) {
      out[(Math.floor(y + N) % N) * N + (Math.floor(x + N) % N)] = 0.6 + rs() * 0.4;
      x += Math.cos(ang); y += Math.sin(ang);
    }
  }
  return out;
}

/**
 * Write one layer's two slices: normal (from the height, gain k), roughness and albedo; hue
 * shifts, desaturation and height. The macro layer's fields go in raw. Returns the layer's mean
 * squared normal slope (what the mips average away).
 */
function* pack(c, data, id, k, raw) {
  const { N, h, a, r, co, cg, ds } = c;
  const NN = N * N, base = id * NN * 4, baseC = (id + LAYERS) * NN * 4, W = N - 1;
  if (raw) {
    yield* eachRow(N, (y) => {
      for (let i = y * N, e = i + N; i < e; i++) {
        const o = base + i * 4, p = baseC + i * 4;
        data[o] = q8(h[i]); data[o + 1] = q8(a[i]); data[o + 2] = q8(r[i]); data[o + 3] = q8(co[i]);
        data[p + 3] = q8(cg[i]);
      }
    }, 32);
    // second slice R, G, B: a fine isotropic grain (normal and albedo) for the near-eye detail
    const g = c.h, F = c.F;
    yield* eachRow(N, (y) => {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        // (a soft grain: per-texel white noise here glittered on wet ground under a lamp)
        g[i] = F.f64[i] * 0.6 + F.f32[i] * 0.2 + F.n[(i + 99 * 40503) & F.M] * 0.08 + (F.w64.f1[i] < 0.2 ? 0.2 - F.w64.f1[i] : 0) * 1.2;
      }
    }, 32);
    yield* eachRow(N, (y) => {
      const ym = ((y + N - 1) & W) * N, yp = ((y + 1) & W) * N, yc = y * N;
      for (let x = 0; x < N; x++) {
        const xm = (x + N - 1) & W, xp = (x + 1) & W;
        const nx = -(g[yc + xp] - g[yc + xm]) * 1.6, ny = -(g[yp + x] - g[ym + x]) * 1.6;
        const inv = 127.5 / Math.sqrt(nx * nx + ny * ny + 1);
        const p = baseC + ((yc + x) << 2);
        data[p] = nx * inv + 128; data[p + 1] = ny * inv + 128; data[p + 2] = q8(0.5 + (g[yc + x] - 0.5) * 0.8);
      }
    }, 16);
    return 0;
  }
  const kk = k * 2 * (N / 256);     // (a texel of the 512² layer is half as wide: the same slope needs twice the gain)
  const acc = { v2: 0 };
  // the roughness slice modulates the vertex's roughness: centre it (keeping a third of the layer's
  // own bias), so a rough recipe does not pin every texel at the clamp and lose its variation
  const rShift = (0.5 - meanOf(r)) * 0.7;
  // (one 32-bit store per texel and slice: the texel bytes are R, G, B, A in memory order)
  const d32 = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2), b32 = base >> 2, c32 = baseC >> 2;
  yield* eachRow(N, (y) => {
    const ym = ((y + N - 1) & W) * N, yp = ((y + 1) & W) * N, yc = y * N;
    let v2 = 0;
    for (let x = 0; x < N; x++) {
      const xm = (x + N - 1) & W, xp = (x + 1) & W;
      // normal = normalize(-dh/du, -dh/dv, 1); u along x (columns), v along y (rows)
      const nx = -(h[yc + xp] - h[yc + xm]) * kk;
      const ny = -(h[yp + x] - h[ym + x]) * kk;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = yc + x;
      d32[b32 + i] = (((nx * inv * 127.5 + 128) | 0) | (((ny * inv * 127.5 + 128) | 0) << 8) | (q8(r[i] + rShift) << 16) | (q8(a[i]) << 24)) >>> 0;
      d32[c32 + i] = (q8(co[i] + 0.5) | (q8(cg[i] + 0.5) << 8) | (q8(ds[i]) << 16) | (q8(h[i]) << 24)) >>> 0;
      v2 += (nx * nx + ny * ny) * inv * inv;
    }
    acc.v2 += v2;
  }, 16);
  return acc.v2 / NN;
}

function meanOf(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  return m / a.length;
}

/** 0..1 → a byte (clamped, rounded). */
function q8(v) { return v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }

