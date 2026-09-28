// Procedural surface detail of the static world (WORLD, SPEC §7.5): one mipmapped texture
// array of tileable 256² layers (brick, stained concrete, siding, corrugated metal, char,
// wood, canvas, bark, tyre rubber, shingles, HESCO mesh, rock, cracked glass, and the
// ground's asphalt aggregate, concrete slabs, grass and gravel). Every lit world material
// samples it through a per-vertex (u, v, layer) attribute, so a merged bucket carries many
// surfaces in one draw call. Texel layout: R, G = tangent-space normal (x, y), B = roughness
// modifier (0.5 = none), A = albedo modifier (0.5 = none, multiplied by 2).
//
// The texel data is generated once per page (a few hundred ms is too much to repeat per
// game) and kept on the CPU; each renderer makes its own GPU texture from it.

import * as THREE from 'three';

const N = 256;

/** Layer ids (the third component of the `aDet` vertex attribute). 0 = no detail. */
export const DET = Object.freeze({
  none: 0, brick: 1, concrete: 2, siding: 3, corrugated: 4, panel: 5, char: 6, wood: 7, fabric: 8,
  bark: 9, rubber: 10, shingle: 11, hesco: 12, stucco: 13, rock: 14, glass: 15, asphalt: 16,
  slab: 17, grass: 18, gravel: 19, rust: 20, plastic: 21, dirt: 22,
});
const LAYERS = 23;

/**
 * World units covered by one repeat of each layer (1 unit ≈ 3 cm): brick courses ≈ 9 cm,
 * corrugation ≈ 7 cm, asphalt stones ≈ 1 cm at 8 texels per unit.
 */
export const DET_TILE = new Float32Array(LAYERS);
Object.entries({
  none: 64, brick: 48, concrete: 96, siding: 64, corrugated: 36, panel: 48, char: 40, wood: 40, fabric: 14,
  bark: 36, rubber: 18, shingle: 56, hesco: 30, stucco: 40, rock: 60, glass: 44, asphalt: 30,
  slab: 128, grass: 40, gravel: 26, rust: 44, plastic: 20, dirt: 44,
}).forEach(([k, v]) => { DET_TILE[DET[k]] = v; });

// ---- tileable noise on the N×N grid --------------------------------------------------------

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

/** Value noise with `cu` × `cv` lattice cells over the tile (tileable), 0..1. */
function vnoise(cu, cv, seed) {
  const r = rngOf(seed);
  const lat = new Float32Array(cu * cv);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * cv, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % cv) * cu, yb = ((y0 + 1) % cv) * cu;
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cu, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % cu, xb = (x0 + 1) % cu;
      const a = lat[ya + xa], b = lat[ya + xb], c = lat[yb + xa], d = lat[yb + xb];
      out[y * N + x] = a + (b - a) * sx + (c + (d - c) * sx - a - (b - a) * sx) * sy;
    }
  }
  return out;
}

/** Fractal value noise, normalised to 0..1. `cu`, `cv` = base cells (anisotropic allowed). */
function fbm(cu, cv, oct, seed, gain = 0.5) {
  const out = new Float32Array(N * N);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = vnoise(Math.min(N, cu << o), Math.min(N, cv << o), seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

/** Worley noise: distance to the nearest / second nearest feature point (in cell units) and its cell id. */
function worley(cells, seed, jitter = 0.9) {
  const r = rngOf(seed);
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells);
  for (let i = 0; i < px.length; i++) { px[i] = 0.5 + (r() - 0.5) * jitter; py[i] = 0.5 + (r() - 0.5) * jitter; }
  const f1 = new Float32Array(N * N), f2 = new Float32Array(N * N), id = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const gy = (y / N) * cells, cy = Math.floor(gy);
    for (let x = 0; x < N; x++) {
      const gx = (x / N) * cells, cx = Math.floor(gx);
      let d1 = 9, d2 = 9, best = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const ix = (cx + i + cells) % cells, iy = (cy + j + cells) % cells, k = iy * cells + ix;
          const dx = cx + i + px[k] - gx, dy = cy + j + py[k] - gy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
        }
      }
      const o = y * N + x;
      f1[o] = d1; f2[o] = d2; id[o] = ((best * 2654435761) >>> 0) / 4294967296;
    }
  }
  return { f1, f2, id };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash2 = (a, b) => ((Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0) / 4294967296;

// ---- layers ---------------------------------------------------------------------------------

/**
 * Each recipe fills h (height 0..1), a (albedo, 0.5 neutral), r (roughness, 0.5 neutral) and
 * returns the normal strength (height units per texel).
 */
function recipes(F) {
  const idx = (x, y) => (((y % N) + N) % N) * N + (((x % N) + N) % N);
  return {
    none(h, a, r) { h.fill(0.5); a.fill(0.5); r.fill(0.5); return 0; },

    brick(h, a, r) {
      const rows = 16, perRow = 5, rh = N / rows, bl = N / perRow;
      for (let y = 0; y < N; y++) {
        const row = Math.floor(y / rh), fy = y - row * rh;
        const off = (row % 2) * bl * 0.5;
        for (let x = 0; x < N; x++) {
          const xx = (x + off) % N, col = Math.floor(xx / bl), fx = xx - col * bl;
          const edge = Math.min(fy, rh - 1 - fy, fx * 0.9, (bl - 1 - fx) * 0.9);
          const m = smooth(0.6, 2.2, edge);           // 0 = mortar joint, 1 = brick face
          const i = y * N + x;
          const tone = hash2(row, col) - 0.5;
          h[i] = 0.25 + 0.75 * m + (F.f16[i] - 0.5) * 0.12 * m - F.w32.f1[i] * 0.06 * m;
          a[i] = m > 0.5 ? 0.5 + tone * 0.22 + (F.f64[i] - 0.5) * 0.1 - (F.w32.f1[i] < 0.12 ? 0.08 : 0) : 0.6 + (F.f64[i] - 0.5) * 0.08;
          r[i] = m > 0.5 ? 0.5 + (F.f16[i] - 0.5) * 0.2 : 0.75;
        }
      }
      return 3.2;
    },

    concrete(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const pit = F.w64.f1[i] < 0.11 ? 1 - F.w64.f1[i] / 0.11 : 0;
        // vertical rain streaks (anisotropic noise) + broad water stains
        const streak = F.streak[i];
        h[i] = 0.5 + (F.f64[i] - 0.5) * 0.3 - pit * 0.3 * (F.w64.id[i] < 0.4 ? 1 : 0);
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.3 - smooth(0.55, 0.8, streak) * 0.16 + (F.f64[i] - 0.5) * 0.1 - pit * 0.12;
        r[i] = 0.55 + (F.f8[i] - 0.5) * 0.3;
      }
      return 0.9;
    },

    siding(h, a, r) {
      const boards = 12, bh = N / boards;
      for (let y = 0; y < N; y++) {
        const b = Math.floor(y / bh), fy = (y - b * bh) / bh;
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          // lap boards: each slopes out toward its bottom edge, a shadow gap under it
          const lap = fy < 0.1 ? fy / 0.1 * 0.2 : 0.2 + (fy - 0.1) * 0.8;
          h[i] = lap + (F.f64[i] - 0.5) * 0.04;
          a[i] = 0.5 + (hash2(b, 7) - 0.5) * 0.08 + (F.streak[i] - 0.5) * 0.18 - (fy < 0.12 ? 0.14 : 0) + (F.f32[i] - 0.5) * 0.06;
          r[i] = 0.55 + (F.f8[i] - 0.5) * 0.2;
        }
      }
      return 2.6;
    },

    corrugated(h, a, r) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const rib = 0.5 + 0.5 * Math.sin((x / N) * Math.PI * 2 * 14);
          const rust = smooth(0.58, 0.8, F.f8[i] * 0.6 + F.streak[i] * 0.4);
          h[i] = rib * 0.9 + (F.f64[i] - 0.5) * 0.05 * rust;
          a[i] = 0.5 - rust * 0.16 + (F.streak[i] - 0.5) * 0.14 + (rib - 0.5) * 0.04;
          r[i] = 0.45 + rust * 0.4;
        }
      }
      return 2.2;
    },

    panel(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const scratch = F.scr[i];
        h[i] = 0.5 + (F.f64[i] - 0.5) * 0.05 - scratch * 0.04;
        a[i] = 0.5 + (F.f8[i] - 0.5) * 0.05 + scratch * 0.025 - smooth(0.62, 0.8, F.f4[i]) * 0.08;
        r[i] = 0.5 + (F.f16[i] - 0.5) * 0.12 + scratch * 0.12 + smooth(0.6, 0.8, F.f4[i]) * 0.22;
      }
      return 0.25;
    },

    char(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const blister = smooth(0.3, 0.0, F.w64.f1[i]) * (F.w64.id[i] < 0.5 ? 1 : 0);
        const flake = smooth(0.5, 0.6, F.f16[i] * 0.7 + F.f64[i] * 0.3);
        h[i] = 0.5 + blister * 0.18 - flake * 0.15 + (F.f64[i] - 0.5) * 0.12;
        // soot black, ash grey and rust brown patches (the vertex colour is a dark rust)
        a[i] = 0.3 + flake * 0.22 + smooth(0.5, 0.8, F.f4[i]) * 0.1 + (F.f64[i] - 0.5) * 0.12 - blister * 0.06;
        r[i] = 0.88 - flake * 0.12;
      }
      return 1.1;
    },

    wood(h, a, r) {
      const planks = 6, ph = N / planks;
      for (let y = 0; y < N; y++) {
        const p = Math.floor(y / ph), fy = y - p * ph;
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const gap = smooth(0.5, 1.6, Math.min(fy, ph - 1 - fy));
          const grain = F.grain[idx(x + p * 37, y)];
          h[i] = 0.3 + gap * 0.7 * (0.85 + grain * 0.15);
          a[i] = 0.5 + (hash2(p, 3) - 0.5) * 0.2 + (grain - 0.5) * 0.26 - (1 - gap) * 0.2;
          r[i] = 0.6 + (grain - 0.5) * 0.2;
        }
      }
      return 2.2;
    },

    fabric(h, a, r) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const wu = Math.sin((x / N) * Math.PI * 2 * 48), wv = Math.sin((y / N) * Math.PI * 2 * 48);
          const weave = (wu * (wv > 0 ? 1 : -1)) * 0.5 + 0.5;
          h[i] = 0.35 + weave * 0.4 + (F.f16[i] - 0.5) * 0.3;
          a[i] = 0.5 + (F.f4[i] - 0.5) * 0.22 + (weave - 0.5) * 0.06 - smooth(0.6, 0.8, F.f8[i]) * 0.1;
          r[i] = 0.7;
        }
      }
      return 1.2;
    },

    bark(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const ridge = 1 - Math.abs(F.barkN[i] - 0.5) * 2;
        const fiss = smooth(0.55, 0.9, ridge);
        h[i] = 0.2 + (1 - fiss) * 0.7 + (F.f64[i] - 0.5) * 0.15;
        a[i] = 0.52 - fiss * 0.34 + (F.f16[i] - 0.5) * 0.16 + (F.f4[i] - 0.5) * 0.12;
        r[i] = 0.8;
      }
      return 3;
    },

    rubber(h, a, r) {
      // cylindrical mapping on tyres: u runs around the tread, v across it
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const fv = y / N, fu = x / N;
          const groove = Math.abs(((fv * 4) % 1) - 0.5) < 0.07 ? 1 : 0;
          const sipe = Math.abs((((fu * 24) + (fv * 4 % 1) * 0.6) % 1) - 0.5) < 0.08 ? 1 : 0;
          h[i] = 0.75 - groove * 0.5 - sipe * 0.35 + (F.f64[i] - 0.5) * 0.06;
          a[i] = 0.5 - groove * 0.06 + (F.f8[i] - 0.5) * 0.1;
          r[i] = 0.7 - (1 - groove) * 0.05;
        }
      }
      return 2.4;
    },

    shingle(h, a, r) {
      const rows = 10, rh = N / rows, tabs = 8, tw = N / tabs;
      for (let y = 0; y < N; y++) {
        const row = Math.floor(y / rh), fy = (y - row * rh) / rh;
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const xx = (x + (row % 2) * tw * 0.5) % N, t = Math.floor(xx / tw), fx = (xx - t * tw) / tw;
          const slot = fx < 0.04 || fx > 0.96 ? 1 : 0;
          h[i] = 0.3 + fy * 0.6 - slot * 0.25 + (F.w64.f1[i] < 0.15 ? 0.06 : 0);
          a[i] = 0.5 + (hash2(row, t) - 0.5) * 0.18 + (F.f64[i] - 0.5) * 0.14 - (fy > 0.92 ? 0.12 : 0) - smooth(0.6, 0.85, F.f4[i]) * 0.12;
          r[i] = 0.8;
        }
      }
      return 2.4;
    },

    hesco(h, a, r) {
      const cells = 10, cw = N / cells;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const gx = Math.min(x % cw, cw - (x % cw)), gy = Math.min(y % cw, cw - (y % cw));
          const wire = Math.max(smooth(1.1, 0.3, gx), smooth(1.1, 0.3, gy));
          // geotextile pressed flat behind thin galvanised wire, dusty and stained
          const bulge = Math.sin(((x % cw) / cw) * Math.PI) * Math.sin(((y % cw) / cw) * Math.PI);
          h[i] = 0.3 + bulge * 0.1 + wire * 0.4 + (F.f64[i] - 0.5) * 0.12 + (F.f16[i] - 0.5) * 0.1;
          a[i] = 0.47 + (F.f8[i] - 0.5) * 0.22 + (F.f64[i] - 0.5) * 0.08 - wire * 0.12 - smooth(0.6, 0.85, F.streak[i]) * 0.1;
          r[i] = wire > 0.5 ? 0.4 : 0.85;
        }
      }
      return 2.8;
    },

    stucco(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        h[i] = 0.5 + (F.f64[i] - 0.5) * 0.45 - (F.w64.f1[i] < 0.12 ? 0.12 : 0);
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.2 - smooth(0.58, 0.85, F.streak[i]) * 0.14 + (F.f64[i] - 0.5) * 0.06;
        r[i] = 0.65;
      }
      return 0.7;
    },

    rock(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const crack = smooth(0.08, 0.0, F.w16.f2[i] - F.w16.f1[i]);
        h[i] = 0.5 + (F.f8[i] - 0.5) * 0.7 + (F.f32[i] - 0.5) * 0.3 - crack * 0.35;
        a[i] = 0.5 + (F.f4[i] - 0.5) * 0.26 + (F.w16.id[i] - 0.5) * 0.08 - crack * 0.14 + (F.f64[i] - 0.5) * 0.08;
        r[i] = 0.75;
      }
      return 2.4;
    },

    glass(h, a, r) {
      // shattered pane: shards (worley cells) at slightly different angles, bright crack lines
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const edge = F.w8.f2[i] - F.w8.f1[i];
          const crack = smooth(0.05, 0.0, edge);
          const cx = x / N - 0.35, cy = y / N - 0.4;
          const ang = Math.atan2(cy, cx);
          const radial = smooth(0.06, 0.0, Math.abs(Math.sin(ang * 9 + F.f4[i] * 3))) * smooth(0.45, 0.05, Math.hypot(cx, cy));
          h[i] = 0.5 + (F.w8.id[i] - 0.5) * 0.9 * (1 - crack);
          a[i] = 0.5 + Math.max(crack, radial) * 0.35;
          r[i] = 0.5 + Math.max(crack, radial) * 0.4;
        }
      }
      return 1.2;
    },

    asphalt(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        // aggregate: small stones proud of the binder, some polished (lighter, smoother)
        const stone = smooth(0.42, 0.18, F.w64.f1[i]);
        const pick = F.w64.id[i];
        const tar = smooth(0.1, 0.0, F.w64.f2[i] - F.w64.f1[i]);
        h[i] = 0.35 + stone * 0.45 * (0.6 + pick * 0.4) - tar * 0.2 + (F.f64[i] - 0.5) * 0.08;
        a[i] = 0.47 + stone * (pick - 0.4) * 0.34 + (F.f16[i] - 0.5) * 0.1 - tar * 0.06;
        r[i] = 0.55 - stone * pick * 0.2 + tar * 0.1;
      }
      return 2.4;
    },

    slab(h, a, r) {
      // one poured slab per tile: joints at the edges, broom finish across, oil and wear
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const jx = Math.min(x, N - 1 - x), jy = Math.min(y, N - 1 - y);
          const joint = smooth(2.2, 0.6, Math.min(jx, jy));
          const broom = F.broom[i];
          // the broom grooves stay faint: under a low fire light stronger ones read as wood grain
          h[i] = 0.55 - joint * 0.45 + (broom - 0.5) * 0.035 + (F.f64[i] - 0.5) * 0.07;
          a[i] = 0.5 + (F.f4[i] - 0.5) * 0.2 - joint * 0.22 - smooth(0.62, 0.82, F.f8[i]) * 0.14 + (F.f64[i] - 0.5) * 0.06;
          r[i] = 0.55 + (broom - 0.5) * 0.05 - smooth(0.62, 0.82, F.f8[i]) * 0.15;
        }
      }
      return 1.8;
    },

    grass(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const blades = F.blades[i];
        h[i] = 0.3 + blades * 0.5 + (F.f16[i] - 0.5) * 0.3;
        a[i] = 0.5 + (blades - 0.5) * 0.3 + (F.f4[i] - 0.5) * 0.3 + (F.f16[i] - 0.5) * 0.12;
        r[i] = 0.75;
      }
      return 2.2;
    },

    gravel(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const peb = smooth(0.55, 0.05, F.w16.f1[i]);
        const small = smooth(0.4, 0.1, F.w64.f1[i]) * 0.5;
        h[i] = 0.25 + Math.max(peb, small) * 0.7 + (F.f64[i] - 0.5) * 0.08;
        a[i] = 0.5 + (F.w16.id[i] - 0.5) * 0.3 * peb + (F.w64.id[i] - 0.5) * 0.14 * small - (1 - peb) * 0.06;
        r[i] = 0.72;
      }
      return 3;
    },

    rust(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const rust = smooth(0.45, 0.7, F.f8[i] * 0.7 + F.f32[i] * 0.3);
        h[i] = 0.5 + rust * (F.f64[i] - 0.5) * 0.5 - rust * 0.1;
        a[i] = 0.5 - rust * 0.18 + (F.streak[i] - 0.5) * 0.12 + (F.f64[i] - 0.5) * 0.08 * rust;
        r[i] = 0.4 + rust * 0.45;
      }
      return 1.1;
    },

    plastic(h, a, r) {
      // crumpled bin-bag / tarp plastic: soft folds, shiny
      for (let i = 0; i < N * N; i++) {
        const fold = 1 - Math.abs(F.f8[i] - 0.5) * 2;
        h[i] = 0.5 + fold * 0.4 + (F.f16[i] - 0.5) * 0.3;
        a[i] = 0.5 + (fold - 0.5) * 0.1;
        r[i] = 0.3 + (1 - fold) * 0.2;
      }
      return 1.3;
    },

    dirt(h, a, r) {
      for (let i = 0; i < N * N; i++) {
        const clod = smooth(0.5, 0.15, F.w32.f1[i]);
        h[i] = 0.4 + clod * 0.3 + (F.f32[i] - 0.5) * 0.4 + (F.f64[i] - 0.5) * 0.2;
        a[i] = 0.5 + (F.f8[i] - 0.5) * 0.24 + (F.w32.id[i] - 0.5) * 0.08 * clod + (F.f64[i] - 0.5) * 0.08;
        r[i] = 0.8;
      }
      return 2.6;
    },
  };
}

let cpuData = null;

/** Generate (once) the RGBA8 texel data of every layer. */
function generate() {
  if (cpuData) return cpuData;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const F = {
    f4: fbm(4, 4, 5, 11), f8: fbm(8, 8, 4, 23), f16: fbm(16, 16, 4, 37), f32: fbm(32, 32, 3, 41), f64: fbm(64, 64, 2, 53),
    streak: fbm(24, 2, 4, 61),          // vertical streaks (stretched along v)
    grain: fbm(4, 48, 3, 71),           // wood grain along u
    barkN: fbm(10, 2, 4, 83),
    broom: fbm(2, 128, 2, 97),          // brushed across v
    blades: fbm(96, 12, 2, 109, 0.6),
    w8: worley(8, 5, 1), w16: worley(16, 7), w32: worley(32, 9), w64: worley(64, 13),
    scr: null,
  };
  // sparse fine scratches for painted metal
  F.scr = new Float32Array(N * N);
  const rs = rngOf(777);
  for (let k = 0; k < 90; k++) {
    let x = rs() * N, y = rs() * N;
    const ang = rs() * Math.PI, len = 8 + rs() * 40;
    for (let s = 0; s < len; s++) {
      F.scr[(Math.floor(y + N) % N) * N + (Math.floor(x + N) % N)] = 0.6 + rs() * 0.4;
      x += Math.cos(ang); y += Math.sin(ang);
    }
  }
  const R = recipes(F);
  const data = new Uint8Array(N * N * 4 * LAYERS);
  const h = new Float32Array(N * N), a = new Float32Array(N * N), r = new Float32Array(N * N);
  for (const [name, id] of Object.entries(DET)) {
    const fn = R[name];
    if (!fn) continue;
    h.fill(0.5); a.fill(0.5); r.fill(0.5);
    const k = fn(h, a, r);
    const base = id * N * N * 4;
    for (let y = 0; y < N; y++) {
      const ym = ((y + N - 1) % N) * N, yp = ((y + 1) % N) * N, yc = y * N;
      for (let x = 0; x < N; x++) {
        const xm = (x + N - 1) % N, xp = (x + 1) % N;
        // normal = normalize(-dh/du, -dh/dv, 1); u along x (columns), v along y (rows)
        const nx = -(h[yc + xp] - h[yc + xm]) * 0.5 * k * 4;
        const ny = -(h[yp + x] - h[ym + x]) * 0.5 * k * 4;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const o = base + (yc + x) * 4;
        data[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(clamp01(r[yc + x]) * 255);
        data[o + 3] = Math.round(clamp01(a[yc + x]) * 255);
      }
    }
  }
  cpuData = data;
  if (t0) generate.ms = Math.round(performance.now() - t0);
  return data;
}

/**
 * A new GPU texture array with every detail layer (the texel data is shared and cached).
 * @param {number} [anisotropy]
 * @returns {THREE.DataArrayTexture}
 */
export function makeDetailArray(anisotropy = 1) {
  const tex = new THREE.DataArrayTexture(generate(), N, N, LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Milliseconds the one-time generation took (0 once cached). */
export function detailGenMs() { return generate.ms || 0; }
