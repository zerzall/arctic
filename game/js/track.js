/* Rainbow Rails — track
 * RR.track: streamed terrain (50 m chunks aligned to multiples of 50, exactly flat for |x| < 18, seeded
 * rolling hills beyond that grow with distance from the track), per-world ground materials (world-position
 * UVs: near-track strip textures, detail textures, gravel; neon grid, frost glints, wet sand), the three
 * tracks (ballast bed, instanced per-world sleepers + tie plates, extruded metallic rails), low trackside
 * dressing (curbs, cable troughs, fences, dwarf/mast signals, km posts, city level crossings) and one
 * animated water mesh (Palm Coast sea, Candy chocolate river, Neon canal, Frost frozen lakes).
 * Everything is built once and recycled: chunk buffers are rewritten in place, dressing lives in
 * InstancedMesh blocks, chunk rebuilds are time-sliced (TRACK_BUDGET_MS per frame).
 */
(function (RR) {
  'use strict';
  if (!RR || typeof THREE === 'undefined') return;
  const C = RR.C;

  // ------------------------------------------------------------------ layout constants
  const CH = 50; // chunk length (chunks are aligned to multiples of 50 -> never straddle a world boundary)
  const DZ = 2.5; // terrain row spacing
  const NRQ = 20, NRV = 21; // quads / vertex rows per chunk along z
  const FLAT = C.TERRAIN_FLAT; // 18
  const TUN = C.TUNNEL_HALF; // 60
  const S_SLEEP = CH / 64; // sleeper spacing (64 per chunk per track)
  const num = (v, d) => (typeof v === 'number' ? v : d);
  const GAUGE = num(C.RAIL_GAUGE_HALF, 0.6); // rail offset from the lane centre
  const Y_BAL = num(C.BALLAST_Y, 0.05), Y_SLP = num(C.SLEEPER_Y, 0.14), Y_RAIL = num(C.RAIL_Y, 0.28), Y_XING = 0.14; // rail top = Y_SLP + 0.14
  const ORIGIN_STEP = 3000; // shader origin shift (multiple of every texture period, 1000 and 250)
  const SEA_L = -0.7, RIV_L = -0.9, CAN_L = -1.4, CAN_BED = -3.2, LAKE_L = -0.7;
  const TRACK_BUDGET_MS = 2.0;
  const READY = 5; // chunk build stages: 0 heights, 1 vertices, 2 water, 3 dressing, 4 finalize, 5 ready
  const MAX_CHUNKS = 40, WSLOTS = 24;
  const RAIL_SEG = 25, RAIL_SLABS = 76; // rail slab length (m) and slab count (1900 m >= widest coverage window)
  const RAIL_BEHIND_CAM = 30; // rails end at most this far behind the camera when it looks ahead
  const STREET_HALF = 5; // city level crossings: street half width (z)

  // terrain columns (x); symmetric; dense near the track and around the water edges
  const XPOS = [4.3, 4.75, 11.4, 18, 19.2, 20.4, 21.6, 22.8, 24, 25.3, 26.2, 26.8, 28, 29.5,
    31, 33, 35, 37, 39, 41.2, 41.8, 43.5, 46, 49, 52.5, 56.5, 61, 66, 72, 79, 87, 96, 106, 118, 132, 148, 166, 187,
    211, 238, 268, 302, 340, 383, 431, 485, 545, 605];
  const XS = [];
  for (let i = XPOS.length - 1; i >= 0; i--) XS.push(-XPOS[i]);
  for (let i = 0; i < XPOS.length; i++) XS.push(XPOS[i]);
  const NC = XS.length, XMAX = XPOS[XPOS.length - 1];
  const XSF = new Float64Array(XS.map((v) => Math.fround(v)));

  // ------------------------------------------------------------------ per-world tuning (keyed by kind)
  const hex3 = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  // Vertex palettes (albedo <= ~0.85 so the sky's lighting keeps the hue).
  const PAL_BY_KIND = {
    city: { ballast: 0x8c7089, grassA: 0x78a04b, grassB: 0x8fb45a, top: 0xa6bf68, dry: 0xb3a45f, cliff: 0xa4675a, low: 0x6b9245 },
    beach: { ballast: 0xbda07e, sandA: 0xd9c08c, sandB: 0xcdb27d, wet: 0xa68a5e, grass: 0x92b85a, top: 0x6ea452, cliff: 0xc58e5c, under: 0xb09670 },
    candy: { ballast: 0xb08ccb, flatA: 0xd986b3, flatB: 0xc4679d, hills: [0xd986b3, 0x82ceb0, 0xe1cb74, 0xb59be2, 0xe9a07e, 0xd986b3], cap: 0xe4d6e8, strata: [0xd4a060, 0xe6d6bc, 0xc0466f, 0x6e3b22], choc: 0xc39463 },
    neon: { ballast: 0x33285e, flatA: 0x1d1539, flatB: 0x241a44, hillA: 0x221750, hillB: 0x35226e, cliff: 0x150d2e, wall: 0x3a3266 },
    snow: { ballast: 0x93a6c4, flatA: 0xccd8e9, flatB: 0xc1cfe3, shade: 0xa7bcdb, high: 0xd7e1ef, cliff: 0x6c7d97, ice: 0x9cc3e0 }
  };
  // Ground material settings. dTile: fine detail tile (m); dAmt: fine / macro / accent strength;
  // acc: accent colours (flowers, shells, sprinkles); feat: streets, wash, neon grid, glints; sheen: sky reflection.
  const STY_BY_KIND = {
    city: { spec: 0x0f0f0f, shin: 8, dTile: 3, dAmt: [0.5, 0.45, 0.95], acc: [0xf29aaa, 0xf4cf86, 0xeae59a, 0xbeb0f4], feat: [1, 0, 0, 0], sheen: 0, sleeper: 0x4f3b4c, grid: 0x000000 },
    beach: { spec: 0x121212, shin: 12, dTile: 4, dAmt: [0.42, 0.4, 0.85], acc: [0xf2ece4, 0xe8b4a4, 0xd8d0c2, 0xa89682], feat: [0, 1, 0, 0], sheen: 0, sleeper: 0x6e5038, grid: 0x000000 },
    candy: { spec: 0x2a2226, shin: 24, dTile: 3, dAmt: [0.34, 0.4, 1.0], acc: [0xff5a9e, 0x5ad8c4, 0xffd040, 0x9f84ff], feat: [0, 0, 0, 0], sheen: 0, sleeper: 0xb982c4, grid: 0x000000 },
    neon: { spec: 0x5a4c80, shin: 44, dTile: 4, dAmt: [0.55, 0.5, 0.0], acc: [0x39f0ff, 0xff3fd2, 0xffe14d, 0x7cff6b], feat: [0, 0, 1, 0], sheen: 0.42, sleeper: 0x2c2344, grid: 0xff3fd2 },
    snow: { spec: 0x1c2026, shin: 18, dTile: 5, dAmt: [0.3, 0.36, 0.0], acc: [0xffffff, 0xffffff, 0xffffff, 0xffffff], feat: [0, 0, 0, 1], sheen: 0.06, sleeper: 0x5e4c42, grid: 0x000000 }
  };
  // Dressing tints per kind.
  const DRESS_BY_KIND = {
    city: { curb: [[0.86, 0.84, 0.87], [0.78, 0.76, 0.8]], trough: [0.7, 0.68, 0.73], sleeper: [0.62, 0.47, 0.56], style: 'wood' },
    beach: { curb: [[0.86, 0.79, 0.64], [0.8, 0.72, 0.58]], trough: [0.8, 0.74, 0.63], sleeper: [0.78, 0.6, 0.44], style: 'wood' },
    candy: { curb: [[0.96, 0.55, 0.74], [0.93, 0.9, 0.93], [0.55, 0.86, 0.76], [0.93, 0.9, 0.93]], trough: [0.84, 0.7, 0.88], sleeper: null, style: 'candy' },
    neon: { curb: [[0.2, 0.16, 0.34], [0.18, 0.14, 0.3]], trough: [0.2, 0.17, 0.33], sleeper: [0.44, 0.42, 0.56], style: 'concrete' },
    snow: { curb: [[0.85, 0.9, 0.98], [0.8, 0.86, 0.96]], trough: [0.8, 0.86, 0.95], sleeper: [0.92, 0.94, 0.98], style: 'frost' }
  };
  const CANDY_SLEEPER_TINTS = [[1, 0.74, 0.86], [0.72, 1, 0.9], [1, 0.95, 0.68], [0.86, 0.76, 1]];
  const RAIL_TINT_BY_KIND = { city: 0xe2e0f0, beach: 0xf0f4f8, candy: 0xffffff, neon: 0x8ff6ff, snow: 0xe6eeff };

  const WORLDS = RR.WORLDS;
  const NW = WORLDS.length;
  const PAL = [], STY = [], DRESS = [];
  for (let i = 0; i < NW; i++) {
    const w = WORLDS[i], k = w.kind;
    const src = PAL_BY_KIND[k] || PAL_BY_KIND.city, p = { kind: k };
    Object.keys(src).forEach((key) => { const v = src[key]; p[key] = Array.isArray(v) ? v.map(hex3) : hex3(v); });
    PAL.push(p);
    STY.push(STY_BY_KIND[k] || STY_BY_KIND.city);
    DRESS.push(DRESS_BY_KIND[k] || DRESS_BY_KIND.city);
  }
  const kindOf = (wi) => WORLDS[wi].kind;

  // ------------------------------------------------------------------ small maths
  const sstep = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function hashU(a, b) { // deterministic [0,1) from two ints
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Seeded 2D gradient noise (range ~[-1, 1]) and fbm.
  function makeNoise(seed) {
    const r = RR.makeRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (r.next() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const gx = new Float64Array(256), gy = new Float64Array(256);
    for (let i = 0; i < 256; i++) { const a = r.next() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    return function (x, y) {
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const xf = x - x0, yf = y - y0;
      const X = x0 & 255, Y = y0 & 255;
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      const aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]], ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
      const n00 = gx[aa] * xf + gy[aa] * yf, n10 = gx[ba] * (xf - 1) + gy[ba] * yf;
      const n01 = gx[ab] * xf + gy[ab] * (yf - 1), n11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
      const a0 = n00 + u * (n10 - n00), a1 = n01 + u * (n11 - n01);
      return (a0 + v * (a1 - a0)) * 1.42;
    };
  }
  const NZ = makeNoise(20260926);
  function fbm(x, y, oct) {
    let s = 0, a = 0.5, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * NZ(x, y); n += a;
      const tx = x * 1.6 - y * 1.2 + 17.1; y = x * 1.2 + y * 1.6 - 9.3; x = tx; // rotate + scale 2
      a *= 0.5;
    }
    return s / n;
  }
  function ridged(x, y, oct) {
    let s = 0, a = 0.5, n = 0, w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(NZ(x, y)); v *= v; v *= w; w = clamp01(v * 1.6);
      s += a * v; n += a;
      const tx = x * 1.6 - y * 1.2 + 7.7; y = x * 1.2 + y * 1.6 + 3.9; x = tx;
      a *= 0.5;
    }
    return s / n;
  }

  // ------------------------------------------------------------------ height function
  // OUT carries side results of the last height evaluation (no allocation).
  const OUT = { wet: 0, canal: 0 };
  const push = (h, L) => { const d = h - L; if (d >= 0.6 || d <= -0.6) return h; return d >= 0 ? L + 0.3 + d * 0.5 : L - 0.3 + d * 0.5; };
  const seaShore = (z) => 23.2 + 1.6 * NZ(z * 0.011, 3.7) + 0.7 * NZ(z * 0.037, 8.1);
  const riverCx = (rel, z) => 36 + 3.5 * Math.sin(z / 120 + 1.3) + 170 * (Math.pow(1 - sstep(62, 300, rel), 2) + Math.pow(1 - sstep(938, 700, rel), 2));
  const RIV_HW = 8.5;
  const lakeTmp = { cx: 0, cz: 0, rx: 0, rz: 0 }, lakePatch = { cx: 0, cz: 0, rx: 0, rz: 0 };
  function lakeParams(k, i, o) {
    const zs = -k * C.WORLD_LEN;
    o.cz = zs - (i === 0 ? 300 : 700) + (hashU(k, 11 + i) - 0.5) * 40;
    o.cx = -(96 + hashU(k, 23 + i) * 24);
    o.rx = 50 + hashU(k, 37 + i) * 12;
    o.rz = 100 + hashU(k, 51 + i) * 24;
    return o;
  }

  function landH(kind, x, z, ax) {
    const nearE = sstep(FLAT, 46, ax);
    switch (kind) {
      case 'beach': {
        const n = fbm(x * 0.03 + 3.1, z * 0.03, 3);
        const f = fbm(x * 0.0062 - 5.3, z * 0.0062 + 2.2, 4);
        return nearE * 3.2 * Math.pow(clamp01(0.5 + 0.55 * n), 1.3) + sstep(60, 330, ax) * 58 * sstep(0.1, 0.95, 0.5 + 0.6 * f);
      }
      case 'candy': {
        const n = fbm(x * 0.019 + 1.7, z * 0.019 - 4.4, 3);
        const f = fbm(x * 0.0085 + 7.3, z * 0.0085 + 1.1, 3);
        return nearE * 3.6 * sstep(-0.15, 0.5, n) + sstep(46, 300, ax) * 46 * Math.pow(sstep(-0.25, 0.55, f), 0.85);
      }
      case 'neon': {
        const n = fbm(x * 0.02, z * 0.02 + 5.5, 2);
        const f = fbm(x * 0.0055 + 2.9, z * 0.0055 - 7.7, 4);
        return nearE * 0.6 * (0.5 + 0.5 * n) + sstep(70, 360, ax) * 30 * Math.pow(clamp01(0.5 + 0.6 * f), 1.5);
      }
      case 'snow': {
        const n = fbm(x * 0.024 - 2.2, z * 0.024 + 6.1, 3);
        const f = ridged(x * 0.0052 + 4.4, z * 0.0052 - 1.9, 5);
        return nearE * 4.2 * (0.5 + 0.5 * n) + sstep(36, 320, ax) * 105 * Math.pow(f, 1.7);
      }
      default: { // city
        const n = fbm(x * 0.021 + 9.1, z * 0.021, 3);
        const f = fbm(x * 0.0065 + 11.3, z * 0.0065 - 4.1, 4);
        return nearE * 1.5 * (0.55 + 0.45 * n) + sstep(42, 300, ax) * 30 * Math.pow(clamp01(0.5 + 0.55 * f), 1.6);
      }
    }
  }

  // Height of world instance k (absolute count) at (x, z), including its water carving. Sets OUT.
  function worldH(k, x, z, ax) {
    const wi = k % NW, kind = kindOf(wi);
    OUT.wet = 0; OUT.canal = 0;
    let h = landH(kind, x, z, ax);
    const rel = -z - k * C.WORLD_LEN;
    if (kind === 'beach' && x < 0) {
      const E = sstep(60, 175, rel) * sstep(940, 825, rel);
      if (E > 0) {
        const shore = seaShore(z);
        let p;
        if (ax < shore) { const s = (ax - FLAT) / (shore - FLAT); p = SEA_L * s * s; }
        else { const d = ax - shore; p = SEA_L - 0.55 * Math.min(d, 5) - 0.12 * Math.max(d - 5, 0) - 11 * sstep(15, 220, d); }
        h = push(h + (p - h) * E, SEA_L);
        OUT.wet = E * (1 - sstep(0.4, 4.6, shore - ax)) * (ax < shore + 1 ? 1 : 0);
      }
    } else if (kind === 'candy' && x > 0) {
      const E = sstep(62, 150, rel) * sstep(938, 850, rel);
      if (E > 0) {
        const cx = riverCx(rel, z), t = Math.abs(x - cx) / RIV_HW;
        h *= 1 - E * (1 - sstep(1.6, 4.2, t)) * 0.92; // low river valley: visible from the track
        if (t < 1.8) {
          const p = t < 1 ? RIV_L - 2.4 * (1 - t * t) : RIV_L + (h - RIV_L) * sstep(1, 1.8, t);
          h = push(h + (p - h) * E * sstep(FLAT, FLAT + 3, ax), RIV_L); // never below 0 at the flat-zone edge
          OUT.wet = E * (1 - sstep(1.0, 1.4, t));
        }
      }
    } else if (kind === 'neon' && x < 0) {
      const E = sstep(70, 100, rel) * sstep(930, 900, rel);
      if (E > 0 && ax < 46) {
        let p;
        if (ax <= 26.2) p = 0;
        else if (ax < 26.8) p = CAN_BED * (ax - 26.2) / 0.6;
        else if (ax <= 41.2) p = CAN_BED;
        else if (ax < 41.8) p = CAN_BED * (1 - (ax - 41.2) / 0.6);
        else p = h * sstep(41.8, 46, ax);
        h = push(h + (p - h) * E, CAN_L);
        OUT.canal = E;
      }
    } else if (kind === 'snow' && x < 0) {
      for (let i = 0; i < 2; i++) {
        const L = lakeParams(k, i, lakeTmp);
        const dx = (x - L.cx) / L.rx, dz = (z - L.cz) / L.rz;
        const r = Math.sqrt(dx * dx + dz * dz);
        if (r >= 2.2) continue;
        const basin = h * (0.3 + 0.7 * sstep(1.0, 2.2, r));
        const p = r < 1 ? LAKE_L - 2.6 * (1 - r * r) : r < 1.3 ? LAKE_L + (basin - LAKE_L) * sstep(1, 1.3, r) : basin;
        const ramp = sstep(FLAT, 24, ax);
        h = push(h + (p - h) * ramp, LAKE_L);
        OUT.wet = ramp * (1 - sstep(1.0, 1.18, r));
        break;
      }
    }
    return h;
  }

  // Continuous terrain function (blends neighbouring worlds across the tunnel span). Sets OUT.
  function Hc(x, z) {
    const ax = Math.abs(x);
    if (ax < FLAT) { OUT.wet = 0; OUT.canal = 0; return 0; }
    const nb = RR.nearestBoundaryK(z);
    const dzb = z + nb * C.WORLD_LEN; // > 0: before the boundary (world nb-1)
    if (dzb < TUN && dzb > -TUN) {
      const t = sstep(TUN, -TUN, dzb);
      const hA = worldH(nb - 1, x, z, ax), wA = OUT.wet, cA = OUT.canal;
      const hB = worldH(nb, x, z, ax);
      OUT.wet = lerp(wA, OUT.wet, t); OUT.canal = lerp(cA, OUT.canal, t);
      return lerp(hA, hB, t);
    }
    return worldH(Math.floor(Math.max(0, -z) / C.WORLD_LEN), x, z, ax);
  }
  const Hv = (x, z) => Math.fround(Hc(x, z)); // vertex height as stored in the float32 buffers

  function streetAt(z, pad) {
    const k = Math.floor(Math.max(0, -z) / C.WORLD_LEN);
    if (kindOf(k % NW) !== 'city') return false;
    const rel = (((-z - k * C.WORLD_LEN) % 250) + 250) % 250;
    return Math.abs(rel - 125) <= STREET_HALF + (pad || 0);
  }

  // ------------------------------------------------------------------ vertex colours
  function mixTo(o, c, t) { if (t <= 0) return; if (t > 1) t = 1; o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t; }
  function setC(o, c, m) { o[0] = c[0] * m; o[1] = c[1] * m; o[2] = c[2] * m; }
  const _hc = [0, 0, 0];
  function colourWorld(wi, x, z, ax, h, g, wet, canal, o) {
    const P = PAL[wi];
    const n1 = NZ(x * 0.043 + 0.5, z * 0.043), n2 = NZ(x * 0.011 + 17.3, z * 0.011 - 3.1);
    if (ax < 4.8) { setC(o, P.ballast, 1 + n1 * 0.05); return; }
    const hill = sstep(FLAT - 0.5, 26, ax);
    switch (P.kind) {
      case 'beach': {
        setC(o, P.sandA, 1); mixTo(o, P.sandB, clamp01(0.5 + n1));
        if (x > 0) {
          mixTo(o, P.grass, hill * sstep(1.5, 3.0, h) * sstep(-0.35, 0.25, n2 + 0.15));
          mixTo(o, P.top, sstep(10, 28, h));
          mixTo(o, P.cliff, sstep(0.6, 1.15, g) * sstep(3, 8, h));
        } else {
          mixTo(o, P.under, sstep(-0.3, -1.4, h));
          mixTo(o, P.cliff, sstep(0.7, 1.2, g) * sstep(2, 6, h));
        }
        mixTo(o, P.wet, wet * 0.9);
        break;
      }
      case 'candy': {
        setC(o, P.flatA, 1); mixTo(o, P.flatB, clamp01(0.45 + n1 * 0.9));
        { // large soft patches of other frosting colours
          const n3 = NZ(x * 0.018 - 7.7, z * 0.018 + 2.9), t3 = clamp01(NZ(x * 0.007 + 1.3, z * 0.007 - 8.1) * 0.5 + 0.5) * 4.999;
          mixTo(o, P.hills[(t3 | 0) + 1 > 5 ? 5 : (t3 | 0) + 1], sstep(0.15, 0.55, n3) * 0.55);
        }
        if (hill > 0) {
          const t = clamp01(n2 * 0.5 + 0.5) * 4.999, i0 = t | 0, f = sstep(0.3, 0.7, t - i0);
          const H0 = P.hills[i0], H1 = P.hills[i0 + 1];
          _hc[0] = H0[0] + (H1[0] - H0[0]) * f; _hc[1] = H0[1] + (H1[1] - H0[1]) * f; _hc[2] = H0[2] + (H1[2] - H0[2]) * f;
          mixTo(o, _hc, hill * sstep(0.8, 3.5, h));
          const band = P.strata[((Math.floor(h / 1.35) % 4) + 4) % 4];
          mixTo(o, band, sstep(0.75, 1.2, g));
          mixTo(o, P.cap, sstep(20, 30, h) * (1 - sstep(0.9, 1.3, g)));
        }
        mixTo(o, P.choc, wet * 0.95);
        break;
      }
      case 'neon': {
        setC(o, P.flatA, 1); mixTo(o, P.flatB, clamp01(0.5 + n1));
        if (hill > 0) { mixTo(o, P.hillA, hill); mixTo(o, P.hillB, sstep(2, 26, h)); mixTo(o, P.cliff, sstep(0.8, 1.3, g)); }
        if (canal > 0 && ax > 25.8 && ax < 42.2) mixTo(o, P.wall, canal);
        break;
      }
      case 'snow': {
        setC(o, P.flatA, 1); mixTo(o, P.flatB, clamp01(0.5 + n1));
        if (hill > 0) {
          mixTo(o, P.shade, hill * clamp01(0.55 - n2 * 0.6) * (1 - sstep(4, 30, h)));
          mixTo(o, P.high, sstep(18, 60, h));
          mixTo(o, P.cliff, sstep(0.85, 1.35, g));
        }
        mixTo(o, P.ice, wet);
        break;
      }
      default: { // city
        setC(o, P.grassA, 1); mixTo(o, P.grassB, clamp01(0.5 + n1 * 0.9));
        if (hill > 0) {
          mixTo(o, P.top, sstep(3, 26, h) * 0.8);
          mixTo(o, P.dry, sstep(0.2, 0.7, n2) * 0.55 * hill);
          mixTo(o, P.low, sstep(0.1, -0.5, n2) * 0.5 * hill);
          mixTo(o, P.cliff, sstep(0.6, 1.1, g));
        }
      }
    }
  }
  const _cA = [0, 0, 0], _cB = [0, 0, 0];
  function colourAt(x, z, ax, h, g, wet, canal, o) {
    const nb = RR.nearestBoundaryK(z), dzb = z + nb * C.WORLD_LEN;
    if (dzb < TUN && dzb > -TUN) {
      const t = sstep(TUN, -TUN, dzb);
      colourWorld((nb - 1) % NW, x, z, ax, h, g, wet, canal, _cA);
      colourWorld(nb % NW, x, z, ax, h, g, wet, canal, _cB);
      o[0] = lerp(_cA[0], _cB[0], t); o[1] = lerp(_cA[1], _cB[1], t); o[2] = lerp(_cA[2], _cB[2], t);
      return;
    }
    colourWorld(RR.worldIndexAt(z), x, z, ax, h, g, wet, canal, o);
  }

  // ------------------------------------------------------------------ canvas textures
  function tex(w, h, draw, wrapS, wrapT) {
    const t = RR.canvasTex(w, h, draw, false);
    t.wrapS = wrapS || THREE.RepeatWrapping; t.wrapT = wrapT || THREE.RepeatWrapping;
    return t;
  }
  function tnoise(x, y, P, s) { // periodic value noise
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hashU(x0 + s * 131, y0), b = hashU(x1 + s * 131, y0), c = hashU(x0 + s * 131, y1), d = hashU(x1 + s * 131, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function tfbm(x, y, P, oct, s) {
    let t = 0, a = 0.5, n = 0;
    for (let i = 0; i < oct; i++) { t += a * tnoise(x, y, P, s + i * 17); n += a; x *= 2; y *= 2; P *= 2; a *= 0.5; }
    return t / n;
  }
  // draw fn at every wrapped copy that can touch the tile
  function wrapDraw(W, H, x, y, r, fn) {
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const px = x + ox * W, py = y + oy * H;
      if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
      fn(px, py);
    }
  }
  const css = (r, g, b, a) => 'rgba(' + ((r * 255) | 0) + ',' + ((g * 255) | 0) + ',' + ((b * 255) | 0) + ',' + (a === undefined ? 1 : a) + ')';

  function makeGravelTex() {
    return tex(256, 256, (g, W, H) => {
      const r = RR.makeRng(77);
      g.fillStyle = '#3b3a3d'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 1500; i++) {
        const x = r.next() * W, y = r.next() * H, rad = 2.6 + r.next() * 5.2, rot = r.next() * 6.28;
        const l = 0.42 + r.next() * 0.5, warm = (r.next() - 0.5) * 0.14;
        const n = 5 + ((r.next() * 3) | 0), pts = [];
        for (let k = 0; k < n; k++) { const a = rot + (k / n) * 6.283, rr = rad * (0.68 + r.next() * 0.42); pts.push(Math.cos(a) * rr, Math.sin(a) * rr * 0.85); }
        wrapDraw(W, H, x, y, rad + 2, (px, py) => {
          g.beginPath(); for (let k = 0; k < n; k++) { const X = px + pts[k * 2], Y = py + pts[k * 2 + 1]; if (k) g.lineTo(X, Y); else g.moveTo(X, Y); } g.closePath();
          g.fillStyle = css(l * 0.55, l * 0.55, l * 0.55); g.fill();
          g.save(); g.translate(px - rad * 0.12, py - rad * 0.15); g.scale(0.78, 0.78);
          g.beginPath(); for (let k = 0; k < n; k++) { const X = pts[k * 2], Y = pts[k * 2 + 1]; if (k) g.lineTo(X, Y); else g.moveTo(X, Y); } g.closePath();
          g.fillStyle = css(clamp01(l + warm), l, clamp01(l - warm)); g.fill(); g.restore();
          g.fillStyle = css(1, 1, 1, 0.22 * l); g.beginPath(); g.arc(px - rad * 0.3, py - rad * 0.35, rad * 0.28, 0, 6.283); g.fill();
        });
      }
    });
  }

  // Channel-packed detail texture: R fine luminance, G accent mask (one mark per 8 px cell, fully inside it, so
  // the shader can colour marks per cell), B macro noise. Computed per pixel into one ImageData (no readbacks).
  function makeDetailTex(kind, seed) {
    const S = 256, CELL = 8, N = S / CELL;
    const r = RR.makeRng(seed);
    const mk = new Float32Array(N * N * 4); // per cell: type, angle, offset x, offset y
    for (let i = 0; i < N * N; i++) {
      const q = r.next();
      mk[i * 4] = kind === 'candy' && q < 0.42 ? 1 : kind === 'city' && q < 0.07 ? 2 : kind === 'beach' && q < 0.05 ? 3 : 0;
      mk[i * 4 + 1] = r.next() * Math.PI; mk[i * 4 + 2] = (r.next() - 0.5) * 1.2; mk[i * 4 + 3] = (r.next() - 0.5) * 1.2;
    }
    return tex(S, S, (g) => {
      const img = g.createImageData(S, S), d = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, w = y / S, hh = hashU(x + seed * 7, y);
        let v;
        if (kind === 'beach') { // wind ripples + grain
          const warp = tfbm(u * 4, w * 4, 4, 2, seed) * 2.2;
          v = 0.5 + 0.26 * Math.sin((u * 9 + w * 2 + warp) * 6.2832) + (hh - 0.5) * 0.36;
        } else if (kind === 'candy') { // swirled frosting
          v = 0.5 + 0.22 * Math.sin(tfbm(u * 4, w * 4, 4, 3, seed) * 22) + (hh - 0.5) * 0.12;
        } else if (kind === 'neon') { // asphalt grain + aggregate specks
          v = 0.5 + (hh - 0.5) * 0.5 + (tfbm(u * 8, w * 8, 8, 2, seed) - 0.5) * 0.4 + (hh > 0.985 ? 0.3 : hh < 0.015 ? -0.3 : 0);
        } else if (kind === 'snow') { // soft wind ripples in snow
          const warp = tfbm(u * 3, w * 3, 3, 2, seed) * 1.6;
          v = 0.5 + 0.16 * Math.sin((u * 3 + w * 6 + warp) * 6.2832) + (hh - 0.5) * 0.14;
        } else { // city grass: blade-scale streaky noise
          v = 0.5 + (hh - 0.5) * 0.34 + (tnoise(u * 64, w * 64, 64, seed) - 0.5) * 0.42 + (tfbm(u * 16, w * 16, 16, 2, seed) - 0.5) * 0.4;
        }
        // accent mark
        const cx = (x / CELL) | 0, cy = (y / CELL) | 0, ci = (cy * N + cx) * 4, t = mk[ci];
        let gm = 0;
        if (t > 0) {
          const px = x + 0.5 - cx * CELL - CELL / 2 - mk[ci + 2], py = y + 0.5 - cy * CELL - CELL / 2 - mk[ci + 3];
          if (t === 1) { // sprinkle capsule
            const ca = Math.cos(mk[ci + 1]), sa = Math.sin(mk[ci + 1]);
            const a = Math.max(Math.abs(px * ca + py * sa) - 2.3, 0), b = -px * sa + py * ca;
            gm = clamp01(1.5 - Math.sqrt(a * a + b * b) * 1.1);
          } else if (t === 2) { // five-petal flower
            let m = 0;
            for (let k = 0; k < 5; k++) { const an = mk[ci + 1] + k * 1.2566, dx = px - Math.cos(an) * 1.4, dy = py - Math.sin(an) * 1.4; m = Math.max(m, clamp01(1.6 - Math.sqrt(dx * dx + dy * dy) * 1.2)); }
            gm = m;
          } else { // shell / pebble
            const ca = Math.cos(mk[ci + 1]), sa = Math.sin(mk[ci + 1]), a = (px * ca + py * sa) / 2.3, b = (-px * sa + py * ca) / 1.4;
            gm = clamp01((1 - Math.sqrt(a * a + b * b)) * 3);
          }
        }
        const o = (y * S + x) * 4;
        d[o] = clamp01(v) * 255; d[o + 1] = gm * 255; d[o + 2] = tfbm(u * 4, w * 4, 4, 4, seed + 99) * 255; d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }

  // Near-track strip texture: u = |x| from 4.5 m to 24 m (clamped), v = z (repeats every 5 m). Alpha = coverage.
  const STRIP_X0 = 4.5, STRIP_W = 19.5, STRIP_L = 5;
  function makeStripTex(kind) {
    const W = 1024, H = 256, PPM = W / STRIP_W;
    const X = (m) => (m - STRIP_X0) * PPM;
    return tex(W, H, (g) => {
      const r = RR.makeRng(kind.length * 977 + 5);
      g.clearRect(0, 0, W, H);
      const band = (a, b, col) => { g.fillStyle = col; g.fillRect(X(a), 0, X(b) - X(a), H); };
      const speck = (a, b, n, cols, rad) => {
        for (let i = 0; i < n; i++) {
          const x = X(a) + r.next() * (X(b) - X(a)), y = r.next() * H, rr = rad * (0.5 + r.next());
          g.fillStyle = cols[(r.next() * cols.length) | 0];
          wrapDraw(1e9, H, x, y, rr, (px, py) => { g.beginPath(); g.arc(px, py, rr, 0, 6.283); g.fill(); });
        }
      };
      const gravelBand = (a, b, base, cols) => { band(a, b, base); speck(a, b, (X(b) - X(a)) * 3, cols, 1.6); };
      if (kind === 'city') {
        band(4.5, 5.4, '#a49da9'); speck(4.5, 5.4, 300, ['#8f8894', '#b7b0bb'], 1.2);
        gravelBand(5.4, 6.0, '#665c68', ['#7d7480', '#554c58', '#8e8590']);
        gravelBand(6.0, 6.45, '#6f6a60', ['#5f7a45', '#7a7468', '#58703e']);
        band(6.45, 6.7, '#b0a9b1');
        // basket-weave pavers 6.7 .. 11.2 (blocks of 16 px, bricks 16 x 8)
        band(6.7, 11.2, '#6e4038');
        const pc = ['#c47863', '#b56a58', '#cf8468', '#a95e50', '#bd7a5e'];
        for (let by = 0; by < H; by += 16) for (let bx = X(6.7); bx < X(11.2) - 1; bx += 16) {
          const o = ((bx / 16) | 0) + by / 16 & 1;
          for (let k = 0; k < 2; k++) {
            g.fillStyle = pc[(r.next() * pc.length) | 0];
            if (o) g.fillRect(bx + 0.8, by + k * 8 + 0.8, Math.min(16, X(11.2) - bx) - 1.6, 6.4);
            else g.fillRect(bx + k * 8 + 0.8, by + 0.8, 6.4, 14.4);
          }
        }
        speck(6.7, 11.2, 900, ['rgba(60,30,30,0.25)', 'rgba(255,230,210,0.18)'], 1.1);
        band(11.2, 11.58, '#bcb5bf');
        for (let y = 0; y < H; y += 51.2) { g.fillStyle = '#8d8691'; g.fillRect(X(11.2), y, X(11.58) - X(11.2), 1.5); }
      } else if (kind === 'beach') {
        gravelBand(4.5, 6.45, '#b49a78', ['#d8c6a8', '#9c8466', '#efe4d2', '#c4ae8c']);
        band(6.45, 6.72, '#cdb68a');
        // boardwalk 6.72 .. 9.5 : planks across (constant v), 28 per 256 px
        band(6.72, 9.5, '#4e3c2c');
        const wc = ['#a88a64', '#b39570', '#9c7e5a', '#ad8f68', '#98785a'];
        const ph = H / 28;
        for (let i = 0; i < 28; i++) {
          g.fillStyle = wc[(r.next() * wc.length) | 0]; g.fillRect(X(6.78), i * ph + 0.7, X(9.44) - X(6.78), ph - 1.4);
          g.fillStyle = 'rgba(70,50,30,0.35)';
          for (let k = 0; k < 3; k++) g.fillRect(X(6.78), i * ph + 1 + r.next() * (ph - 2), X(9.44) - X(6.78), 0.6);
          g.fillStyle = '#5a4a3a'; [6.95, 8.1, 9.28].forEach((m) => { g.fillRect(X(m) - 1, i * ph + ph * 0.5 - 1, 2, 2); });
        }
        band(6.72, 6.8, '#7d6246'); band(9.42, 9.5, '#7d6246');
        g.fillStyle = 'rgba(217,192,140,0.9)'; g.fillRect(X(9.5), 0, X(9.9) - X(9.5), H);
        g.fillStyle = 'rgba(217,192,140,0.45)'; g.fillRect(X(9.9), 0, X(10.3) - X(9.9), H);
      } else if (kind === 'candy') {
        gravelBand(4.5, 6.45, '#b690cf', ['#f2e6f2', '#ff8fc0', '#8ee2cc', '#ffe08a', '#c9a8ee']);
        band(6.45, 6.6, '#d9c4e6');
        // chocolate bar tiles 6.6 .. 9.8 : 4 x 6 tiles
        const tw = (X(9.8) - X(6.6)) / 4, th = H / 6;
        band(6.6, 9.8, '#3a1d0e');
        for (let ty = 0; ty < 6; ty++) for (let tx = 0; tx < 4; tx++) {
          const x0 = X(6.6) + tx * tw, y0 = ty * th, m = 3;
          g.fillStyle = '#6e3c22'; g.fillRect(x0 + 2, y0 + 2, tw - 4, th - 4);
          g.fillStyle = '#8a5030'; g.fillRect(x0 + 2, y0 + 2, tw - 4, m); g.fillRect(x0 + 2, y0 + 2, m, th - 4);
          g.fillStyle = '#4a2412'; g.fillRect(x0 + 2, y0 + th - 2 - m, tw - 4, m); g.fillRect(x0 + tw - 2 - m, y0 + 2, m, th - 4);
          g.fillStyle = '#633620'; g.fillRect(x0 + 2 + m * 2.2, y0 + 2 + m * 2.2, tw - 4 - m * 4.4, th - 4 - m * 4.4);
        }
        // icing piping beads
        band(9.8, 10.25, '#e89ac0');
        for (let i = 0; i < 24; i++) {
          const y = (i + 0.5) * (H / 24), x = X(10.02);
          g.fillStyle = '#ecd8e8'; g.beginPath(); g.arc(x, y, 5.6, 0, 6.283); g.fill();
          g.fillStyle = '#fff6fb'; g.beginPath(); g.arc(x - 1.6, y - 1.8, 2.2, 0, 6.283); g.fill();
          g.fillStyle = 'rgba(160,80,130,0.35)'; g.beginPath(); g.arc(x + 1.5, y + 2.2, 3, 0, 3.14); g.fill();
        }
      } else if (kind === 'neon') {
        gravelBand(4.5, 6.45, '#2a2048', ['#3a2e62', '#1c1434', '#4a3a78']);
        band(6.45, 12.0, '#1b1431');
        speck(6.45, 12.0, 2600, ['#261d42', '#130d24', '#2e2450'], 1.0);
        for (let i = 0; i < 10; i++) { // wet patches
          const x = X(7 + r.next() * 4.5), y = r.next() * H;
          wrapDraw(1e9, H, x, y, 60, (px, py) => { const gr = g.createRadialGradient(px, py, 2, px, py, 30 + r.next() * 30); gr.addColorStop(0, 'rgba(10,6,24,0.55)'); gr.addColorStop(1, 'rgba(10,6,24,0)'); g.fillStyle = gr; g.fillRect(px - 60, py - 60, 120, 120); });
        }
        band(12.0, 12.35, '#2c2350');
      } else if (kind === 'snow') {
        gravelBand(4.5, 6.45, '#8b98b2', ['#d6e0ee', '#6f7d98', '#e4ecf6', '#a9b6cc']);
        { // wind-blown snow drifts over the gravel (noise-shaped, denser toward the fence); built off-canvas, no readback
          const x0 = Math.floor(X(4.5)), x1 = Math.ceil(X(6.45)), wd = x1 - x0;
          const cv = document.createElement('canvas'); cv.width = wd; cv.height = H;
          const cg = cv.getContext('2d'), img = cg.createImageData(wd, H), d = img.data;
          for (let y = 0; y < H; y++) for (let x = 0; x < wd; x++) {
            const n = tfbm(x / 32, y / 32, 8, 3, 61) + (x / wd) * 0.22 - 0.1, o = (y * wd + x) * 4;
            d[o] = 212; d[o + 1] = 224; d[o + 2] = 240; d[o + 3] = sstep(0.5, 0.56, n) * 255;
          }
          cg.putImageData(img, 0, 0);
          g.drawImage(cv, x0, 0);
        }
        band(6.5, 9.2, '#bccbe0');
        speck(6.5, 9.2, 700, ['#aebdd4', '#c9d6e8', '#a4b4cc'], 1.4);
        for (let i = 0; i < 18; i++) { // footprints
          const y = (i + 0.5) * (H / 18), x = X(7.6 + (i & 1) * 0.35);
          g.fillStyle = 'rgba(140,160,196,0.55)'; g.beginPath(); g.ellipse(x, y, 4.2, 7, 0, 0, 6.283); g.fill();
        }
        g.fillStyle = 'rgba(150,168,200,0.6)'; g.fillRect(X(8.55), 0, 3, H); g.fillRect(X(8.95), 0, 3, H);
        g.fillStyle = 'rgba(203,214,232,0.55)'; g.fillRect(X(9.2), 0, X(9.6) - X(9.2), H);
      }
    }, THREE.ClampToEdgeWrapping, THREE.RepeatWrapping);
  }

  function makeWaterNormalTex() {
    return tex(256, 256, (g, W, H) => {
      const S = 256, hgt = new Float32Array(S * S);
      const waves = [];
      const r = RR.makeRng(4242);
      for (let i = 0; i < 12; i++) {
        let kx = Math.round((r.next() - 0.5) * 14), ky = Math.round((r.next() - 0.5) * 14);
        if (!kx && !ky) kx = 3;
        waves.push([kx, ky, r.next() * 6.283, 1 / Math.sqrt(kx * kx + ky * ky)]);
      }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let v = 0;
        for (const w of waves) v += Math.sin((w[0] * x + w[1] * y) / S * 6.2832 + w[2]) * w[3];
        v += (tfbm(x / S * 8, y / S * 8, 8, 3, 5) - 0.5) * 0.9;
        hgt[y * S + x] = v;
      }
      const img = g.createImageData(S, S), d = img.data, k = 3.2;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = hgt[y * S + ((x + 1) & 255)] - hgt[y * S + ((x - 1) & 255)];
        const dy = hgt[((y + 1) & 255) * S + x] - hgt[((y - 1) & 255) * S + x];
        let nx = -dx * k, ny = -dy * k, nz = 1; const l = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
        const o = (y * S + x) * 4; d[o] = (nx * 0.5 + 0.5) * 255; d[o + 1] = (ny * 0.5 + 0.5) * 255; d[o + 2] = (nz * 0.5 + 0.5) * 255; d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }
  // R: foam noise, G: ice cracks (tileable Voronoi edges), B: swirl noise
  function makeWaterNoiseTex() {
    return tex(256, 256, (g) => {
      const S = 256, r = RR.makeRng(9091), P = [];
      for (let i = 0; i < 22; i++) P.push(r.next() * S, r.next() * S);
      const img = g.createImageData(S, S), d = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let f1 = 1e9, f2 = 1e9;
        for (let i = 0; i < P.length; i += 2) {
          let dx = Math.abs(x - P[i]), dy = Math.abs(y - P[i + 1]); if (dx > S / 2) dx = S - dx; if (dy > S / 2) dy = S - dy;
          const dd = Math.sqrt(dx * dx + dy * dy); if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
        }
        const warp = (tnoise(x / S * 16, y / S * 16, 16, 3) - 0.5) * 2.4;
        const crack = 1 - sstep(0.4, 2.6, f2 - f1 + warp);
        const foam = tfbm(x / S * 8, y / S * 8, 8, 4, 12);
        const sw = tfbm(x / S * 4 + tnoise(x / S * 4, y / S * 4, 4, 8) * 1.5, y / S * 4, 4, 4, 21);
        const o = (y * S + x) * 4; d[o] = foam * 255; d[o + 1] = crack * 255; d[o + 2] = sw * 255; d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }

  function makeSleeperTex(style) {
    return tex(128, 32, (g, W, H) => {
      const r = RR.makeRng(style.length * 31 + 2);
      if (style === 'candy') {
        g.fillStyle = '#e9e4ea'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#e0406e';
        for (let i = -4; i < 20; i++) { g.beginPath(); g.moveTo(i * 8, 0); g.lineTo(i * 8 + 4, 0); g.lineTo(i * 8 + 4 + 12, H); g.lineTo(i * 8 + 12, H); g.closePath(); g.fill(); }
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, H * 0.3, W, 3);
        return;
      }
      if (style === 'concrete') {
        g.fillStyle = '#b5b0bd'; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 500; i++) { const l = 0.55 + r.next() * 0.35; g.fillStyle = css(l, l, l * 1.05, 0.6); g.fillRect(r.next() * W, r.next() * H, 1, 1); }
        g.fillStyle = 'rgba(40,36,50,0.35)'; g.fillRect(0, 0, W, 1); g.fillRect(0, H - 1, W, 1);
        return;
      }
      // wood (city, beach: neutral, tinted per world; frost: brown, untinted); the rightmost 12 px stay white for snow caps
      g.fillStyle = style === 'frost' ? '#8a6448' : '#b9a38e'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 26; i++) {
        const y = r.next() * H, l = 0.45 + r.next() * 0.3;
        g.strokeStyle = css(l * 0.8, l * 0.66, l * 0.55, 0.55); g.lineWidth = 0.6 + r.next();
        g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin(x * 0.07 + i) * 1.2); g.stroke();
      }
      for (let i = 0; i < 3; i++) { const x = 10 + r.next() * (W - 36), y = 6 + r.next() * (H - 12); g.fillStyle = 'rgba(90,60,40,0.55)'; g.beginPath(); g.ellipse(x, y, 3.5, 2, 0, 0, 6.283); g.fill(); }
      g.fillStyle = 'rgba(60,40,30,0.4)'; g.fillRect(0, 0, W, 1); g.fillRect(0, H - 1, W, 1);
      g.fillStyle = '#f4f7fb'; g.fillRect(W - 12, 0, 12, H);
    });
  }

  // km posts: 10 x 10 cells of 100 x 50 px ("k.h"), right 24 px = plain post colour
  let boardTex = null;
  function drawBoards(g, W, H) {
    g.fillStyle = '#cfd2d8'; g.fillRect(0, 0, W, H);
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
      const x = i * 100, y = j * 50;
      g.fillStyle = '#1d1d24'; g.fillRect(x + 1, y + 1, 98, 48);
      g.fillStyle = '#f1efe6'; g.fillRect(x + 5, y + 5, 90, 40);
      g.fillStyle = '#16161c';
      g.font = '34px ' + RR.FONT_DISPLAY; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(j + '.' + i, x + 50, y + 27);
    }
    g.fillStyle = '#cfd2d8'; g.fillRect(1000, 0, 24, H);
  }

  // ------------------------------------------------------------------ GLSL
  const GLSL_COMMON = [
    'uniform vec3 uOrigin; uniform float uOriginK; uniform float uTime; uniform float uGlow; uniform float uTunnelK;',
    'uniform vec3 uSkyTop; uniform vec3 uSkyMid; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol;',
    'float rrHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'float rrTunnel(vec3 wp) {',
    '  float kl = floor(-wp.z * 0.001 + 0.5);',
    '  float dz = abs(wp.z + kl * 1000.0);',
    '  return step(0.5, kl + uOriginK) * (1.0 - smoothstep(55.5, 60.0, dz)) * (1.0 - smoothstep(6.8, 8.2, abs(wp.x)));',
    '}',
    'vec3 rrSky(float y) { vec3 c = mix(uHorizon, uSkyMid, smoothstep(0.0, 0.3, y)); return mix(c, uSkyTop, smoothstep(0.3, 0.95, y)); }'
  ].join('\n');

  const TERRAIN_VS_DECL = [
    'attribute vec2 aExtra; varying vec2 vExtra; varying vec3 vWPos; varying vec3 vRRN; uniform vec2 uRise; uniform vec3 uOrigin;'
  ].join('\n');
  const TERRAIN_VS_BODY = [
    '#include <begin_vertex>',
    '{',
    '  vec4 rrW = modelMatrix * vec4(transformed, 1.0);',
    '  float rrD = -(viewMatrix * rrW).z;',
    '  if (transformed.y > 0.0) transformed.y *= 1.0 - smoothstep(uRise.x, uRise.y, rrD);',
    '  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz - uOrigin;',
    '  vExtra = aExtra;',
    '  vRRN = normalize(transformedNormal);',
    '}'
  ].join('\n');
  const TERRAIN_FS_DECL = [
    GLSL_COMMON,
    'uniform sampler2D uStrip; uniform sampler2D uDetail; uniform sampler2D uGravel;',
    'uniform vec2 uDScale; uniform vec3 uDAmt; uniform vec3 uAcc0; uniform vec3 uAcc1; uniform vec3 uAcc2; uniform vec3 uAcc3;',
    'uniform vec4 uFeat; uniform float uSheen; uniform vec3 uSleeperCol; uniform vec3 uGridCol;',
    'varying vec3 vWPos; varying vec2 vExtra; varying vec3 vRRN;',
    'float rrPulse(float x, float w, float fw) {',
    '  fw = max(fw, 1e-4); float a = 0.5 - 0.5 * w;',
    '  float x0 = x - 0.5 * fw, x1 = x + 0.5 * fw;',
    '  float i0 = floor(x0) * w + clamp(fract(x0) - a, 0.0, w);',
    '  float i1 = floor(x1) * w + clamp(fract(x1) - a, 0.0, w);',
    '  return (i1 - i0) / fw;',
    '}',
    'float rrLine(float d, float w) { float fw = max(fwidth(d), 1e-4); float ww = max(w, fw); return (1.0 - smoothstep(ww * 0.5, ww * 0.5 + fw, abs(d))) * min(w / ww, 1.0); }',
    'float rrGrid(vec2 p) { vec2 fw = max(fwidth(p), vec2(1e-4)); vec2 g = abs(fract(p - 0.5) - 0.5) / fw; float l = 1.0 - min(min(g.x, g.y), 1.0); return l * (1.0 - smoothstep(0.25, 0.6, max(fw.x, fw.y))); }'
  ].join('\n');
  const TERRAIN_FS_COLOR = [
    '#include <color_fragment>',
    'vec3 rrEmis = vec3(0.0);',
    'float rrWet = vExtra.x;',
    'vec3 wp = vWPos;',
    'float ax = abs(wp.x);',
    'float kl = floor(-wp.z * 0.001 + 0.5);',
    'float dzb = mix(1e4, abs(wp.z + kl * 1000.0), step(0.5, kl + uOriginK));',
    'float zoneF = smoothstep(42.0, 62.0, dzb);',
    'float zoneG = smoothstep(45.0, 140.0, dzb);',
    'float bal = 1.0 - smoothstep(4.45, 4.8, ax);',
    'float off = 1.0 - bal;',
    'float vd = length(vViewPosition);',
    'vec3 base = diffuseColor.rgb;',
    'vec3 col = base;',
    // city level crossings
    'float relS = mod(-wp.z, 250.0);',
    'float dzs = abs(relS - 125.0);',
    'float street = uFeat.x * (1.0 - smoothstep(4.98, 5.04, dzs)) * (1.0 - smoothstep(60.0, 85.0, ax)) * zoneF;',
    // detail
    'vec2 duv = wp.xz * uDScale.x;',
    'vec4 d1 = texture2D(uDetail, duv);',
    '#ifdef RR_LOW',
    'float macro = d1.b;',
    '#else',
    'float macro = texture2D(uDetail, wp.xz * uDScale.y + vec2(0.37, 0.61)).b;',
    '#endif',
    'col *= mix(1.0, 0.68 + 0.64 * d1.r, uDAmt.x * off);',
    'col *= mix(1.0, 0.76 + 0.48 * macro, uDAmt.y * off);',
    'vec2 cellI = mod(floor(duv * 32.0), 32.0);',
    'float hc = rrHash(cellI + 3.1);',
    'vec3 acc = hc < 0.25 ? uAcc0 : hc < 0.5 ? uAcc1 : hc < 0.75 ? uAcc2 : uAcc3;',
    'col = mix(col, acc, d1.g * uDAmt.z * off * zoneF * (1.0 - street) * (1.0 - smoothstep(60.0, 120.0, vd)));',
    // city lawns: mowing stripes parallel to the track
    'if (uFeat.x > 0.0) { float mow = smoothstep(0.42, 0.58, abs(fract(ax / 5.0) - 0.5) * 2.0); col *= 1.0 + (mow - 0.5) * 0.08 * off * zoneF * step(11.6, ax) * (1.0 - smoothstep(45.0, 70.0, ax)) * (1.0 - smoothstep(70.0, 140.0, vd)); }',
    // ballast: gravel, oily centres, far sleeper stripes
    'vec3 gv = texture2D(uGravel, wp.xz * 0.8).rgb;',
    'float dl = min(abs(ax - 2.6), ax);',
    'vec3 bcol = base * (0.46 + 0.86 * gv);',
    'bcol *= 1.0 - 0.24 * (1.0 - smoothstep(0.28, 0.7, dl));',
    'float slz = -wp.z / 0.78125;',
    'float sw = rrPulse(slz, 0.3328, fwidth(slz)) * (1.0 - smoothstep(1.0, 1.08, dl)) * (1.0 - street);',
    'bcol = mix(bcol, uSleeperCol * (0.75 + 0.35 * gv.r), sw);',
    'col = mix(col, bcol, bal);',
    // strip overlay (sidewalks, boardwalks, chocolate tiles ...)
    'float su = (ax - 4.5) / 19.5;',
    'vec4 st = texture2D(uStrip, vec2(su, -wp.z * 0.2));',
    'float sa = st.a * zoneF * step(0.0, su) * (1.0 - street);',
    'col = mix(col, st.rgb * (0.9 + 0.2 * macro), sa);',
    // street surface + markings
    'if (street > 0.0) {',
    '  vec3 asph = vec3(0.21, 0.2, 0.24) * (0.82 + 0.36 * d1.r) * (0.9 + 0.2 * macro);',
    '  float mk = rrLine(dzs, 0.14) * step(0.5, fract(ax / 3.0)) * step(7.4, ax);',
    '  vec3 sc = mix(asph, vec3(0.86, 0.7, 0.26), mk);',
    '  float zeb = step(7.0, ax) * (1.0 - step(10.6, ax)) * step(dzs, 4.2) * step(0.5, fract(dzs / 0.9));',
    '  float edge = rrLine(dzs - 4.65, 0.12) * step(4.8, ax);',
    '  float stopL = rrLine(ax - 11.2, 0.35) * step(dzs, 4.3);',
    '  sc = mix(sc, vec3(0.84, 0.84, 0.82), max(max(zeb, edge), stopL));',
    '  vec3 xing = vec3(0.34, 0.32, 0.36) * (0.8 + 0.4 * d1.r);',
    '  xing *= 1.0 - 0.45 * rrLine(fract(dzs / 1.25) - 0.5, 0.04);',
    '  xing = mix(xing, vec3(0.1, 0.1, 0.11), rrLine(abs(dl - 0.6) - 0.09, 0.05));',
    '  sc = mix(sc, xing, 1.0 - smoothstep(4.3, 4.6, ax));',
    '  col = mix(col, sc, street);',
    '}',
    // wet sand: darker + travelling wash foam
    'if (uFeat.y > 0.0 && rrWet > 0.01) {',
    '  float p = 0.58 + 0.38 * sin(uTime * 1.05 + wp.z * 0.0418879);',
    '  float fresh = smoothstep(p - 0.03, p + 0.03, rrWet);',
    '  col *= 1.0 - 0.1 * fresh * uFeat.y;',
    '  float foamL = (1.0 - smoothstep(0.0, 0.05, abs(rrWet - p))) * step(0.1, rrWet) * (0.55 + 0.45 * d1.r);',
    '  col = mix(col, vec3(0.86, 0.9, 0.9), foamL * 0.85 * uFeat.y);',
    '  rrWet *= 0.5 + 0.5 * fresh;',
    '}',
    'diffuseColor.rgb = col;',
    // neon: glowing grid on the plain + edge lines + canal edges
    'if (uFeat.z > 0.0) {',
    '  float g1 = rrGrid(wp.xz * 0.25) * (1.0 - smoothstep(50.0, 230.0, vd)) * step(12.4, ax);',
    '  float g2 = rrGrid(wp.xz / 24.0) * (1.0 - smoothstep(180.0, 470.0, vd)) * step(12.4, ax);',
    '  float e1 = rrLine(ax - 6.62, 0.06);',
    '  float e2 = rrLine(ax - 11.9, 0.08) * step(0.45, fract(-wp.z / 3.0));',
    '  float cn = vExtra.y * step(wp.x, 0.0) * (rrLine(ax - 26.15, 0.08) + rrLine(ax - 41.85, 0.08));',
    '  rrEmis += (uGridCol * max(g1 * 0.85, g2 * 0.7) * zoneG + (vec3(0.22, 0.94, 1.0) * (e1 + cn) + uGridCol * e2) * zoneF) * uGlow * uFeat.z * (1.0 - street);',
    '}',
    // frost: view-dependent glints on snow
    '#ifndef RR_LOW',
    'if (uFeat.w > 0.0) {',
    '  float gh = rrHash(floor(wp.xz * 13.0) + floor((cameraPosition.xz - uOrigin.xz) * 0.16) * 0.731);',
    '  float glint = step(0.994, gh) * (1.0 - smoothstep(10.0, 50.0, vd)) * off * zoneF * smoothstep(0.62, 0.78, base.g);',
    '  rrEmis += vec3(1.0, 0.98, 0.92) * glint * 1.35 * uGlow * uFeat.w;',
    '}',
    'if (uSheen > 0.0 || rrWet > 0.0) {',
    '  vec3 Vw = normalize(cameraPosition - uOrigin - wp);',
    '  float fres = pow(1.0 - clamp(Vw.y, 0.0, 1.0), 4.0);',
    '  rrEmis += rrSky(Vw.y) * fres * (uSheen * off * (1.0 - street) + rrWet * 0.3 * uFeat.y);',
    '}',
    '#endif'
  ].join('\n');
  // faceted near the track, smooth far away (long thin far triangles would streak when flat-shaded)
  const TERRAIN_FS_NORMAL = ['#include <normal_fragment_begin>', 'normal = normalize(mix(normal, normalize(vRRN), smoothstep(45.0, 170.0, vd) * 0.9));', 'geometryNormal = normal;'].join('\n');
  const TERRAIN_FS_SPEC = ['#include <specularmap_fragment>', 'specularStrength = 1.0 + rrWet * 4.0 * uFeat.y;'].join('\n');
  const SHADE_FS = [ // tunnel shade + custom emissive (inserted before the outgoing light sum)
    '#include <aomap_fragment>',
    '{',
    '  float tsh = rrTunnel(vWPos) * uTunnelK;',
    '  reflectedLight.directDiffuse *= 1.0 - tsh;',
    '  reflectedLight.directSpecular *= 1.0 - tsh;',
    '  reflectedLight.indirectDiffuse *= 1.0 - 0.5 * tsh;',
    '  totalEmissiveRadiance += rrEmis * (1.0 - 0.85 * tsh);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------ module state
  let inited = false, scene = null, camera = null, renderer = null, quality = RR.QUALITY.high;
  const root = new THREE.Group(); root.name = 'track';
  // shared uniforms (same objects referenced by every material)
  const SU = {
    uOrigin: { value: new THREE.Vector3() }, uOriginK: { value: 0 }, uTime: { value: 0 }, uGlow: { value: 1 }, uTunnelK: { value: 0.62 },
    uSkyTop: { value: new THREE.Color(0x4f86d6) }, uSkyMid: { value: new THREE.Color(0x9cc3ee) }, uHorizon: { value: new THREE.Color(0xeaf4ff) },
    uSunDir: { value: new THREE.Vector3(-0.3, 0.2, -0.9).normalize() }, uSunCol: { value: new THREE.Color(0xffffff) },
    uRise: { value: new THREE.Vector2(500, 560) }
  };
  let terrainMats = [], sleeperMats = {}, railMat = null, waterMat = null, boardMat = null;
  let TEX = {};
  let railMesh = null, railIdxPerSlab = 0;
  const stats = { buildMs: 0, maxStepMs: 0, lastFrameMs: 0, builds: 0, chunks: 0, queue: 0, stageMax: [0, 0, 0, 0, 0, 0], streamMax: 0, railSlabs: 0 };

  function commonUniforms(target) { Object.keys(SU).forEach((k) => (target[k] = SU[k])); return target; }

  function makeTerrainMat(wi) {
    const s = STY[wi], kind = kindOf(wi);
    const m = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, specular: s.spec, shininess: s.shin });
    const a = s.acc.map((h) => new THREE.Color(h));
    m.userData.u = commonUniforms({
      uStrip: { value: TEX.strip[kind] }, uDetail: { value: TEX.detail[kind] }, uGravel: { value: TEX.gravel },
      uDScale: { value: new THREE.Vector2(1 / s.dTile, 1 / 37.5) }, uDAmt: { value: new THREE.Vector3(s.dAmt[0], s.dAmt[1], s.dAmt[2]) },
      uAcc0: { value: a[0] }, uAcc1: { value: a[1] }, uAcc2: { value: a[2] }, uAcc3: { value: a[3] },
      uFeat: { value: new THREE.Vector4(s.feat[0], s.feat[1], s.feat[2], s.feat[3]) }, uSheen: { value: s.sheen },
      uSleeperCol: { value: new THREE.Color(s.sleeper) }, uGridCol: { value: new THREE.Color(s.grid) }
    });
    m.onBeforeCompile = terrainCompile;
    m.customProgramCacheKey = terrainKey;
    return m;
  }
  function terrainKey() { return 'rr-terrain-' + (quality.name === 'low' ? 'L' : 'H'); }
  function terrainCompile(shader) {
    Object.assign(shader.uniforms, this.userData.u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_VS_DECL)
      .replace('#include <begin_vertex>', TERRAIN_VS_BODY);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_FS_DECL)
      .replace('#include <color_fragment>', TERRAIN_FS_COLOR)
      .replace('#include <specularmap_fragment>', TERRAIN_FS_SPEC)
      .replace('#include <normal_fragment_begin>', TERRAIN_FS_NORMAL)
      .replace('#include <aomap_fragment>', SHADE_FS);
    if (quality.name === 'low') fs = '#define RR_LOW 1\n' + fs;
    shader.fragmentShader = fs;
  }

  // Lambert/Phong patch that only adds world position + tunnel shade (sleepers, plates).
  const SIMPLE_VS_DECL = 'varying vec3 vWPos; uniform vec3 uOrigin;';
  const SIMPLE_VS_BODY = [
    '#include <begin_vertex>',
    '{ vec4 rrP = vec4(transformed, 1.0);',
    '#ifdef USE_INSTANCING',
    '  rrP = instanceMatrix * rrP;',
    '#endif',
    '  vWPos = (modelMatrix * rrP).xyz - uOrigin; }'
  ].join('\n');
  function simpleCompile(shader) {
    commonUniforms(shader.uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + SIMPLE_VS_DECL).replace('#include <begin_vertex>', SIMPLE_VS_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nvarying vec3 vWPos;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 rrEmis = vec3(0.0);')
      .replace('#include <aomap_fragment>', SHADE_FS);
  }

  // Rails: polished steel (Phong). The running surface mirrors the sky (Fresnel-weighted, slightly desaturated like
  // steel) with long polish bands and sparse speed streaks that are anchored in the world, so they stream past;
  // a low sun ahead lights the rail heads up. Web and foot are dark oiled steel (candy: striped; neon: cyan glow).
  // Every varying is bounded: aTop is per face and clamped, the view vector is normalised with a floor.
  const RAIL_FS = [
    '#include <color_fragment>',
    'vec3 rrEmis = vec3(0.0);',
    'vec3 wp = vWPos;',
    'float wk = max(floor(-wp.z * 0.001) + uOriginK, 0.0);',
    'float wi = mod(wk, ' + NW.toFixed(1) + ');',
    'vec3 tint = wi < 0.5 ? uRT0 : wi < 1.5 ? uRT1 : wi < 2.5 ? uRT2 : wi < 3.5 ? uRT3 : uRT4;',
    'float top = clamp(vTop, 0.0, 1.0);',
    'float run = top * top * top;', // 1 running surface, 0.51 chamfers, 0.09 head sides, 0 web/foot
    'float isCandy = 1.0 - step(0.5, abs(wi - uCandyIdx)), isNeon = 1.0 - step(0.5, abs(wi - uNeonIdx));',
    'diffuseColor.rgb *= tint * (1.0 - 0.6 * run);', // a mirror-polished head has little diffuse
    'if (isCandy > 0.5 && top < 0.9) { float cs = step(0.5, fract(wp.z * 1.3 + wp.y * 4.0)); diffuseColor.rgb = mix(vec3(0.86, 0.84, 0.86), vec3(0.86, 0.2, 0.36), cs) * (0.55 + 0.45 * top); }',
    'vec3 Vr = cameraPosition - uOrigin - wp; Vr *= inversesqrt(max(dot(Vr, Vr), 1e-6));',
    'float vy = clamp(Vr.y, 0.0, 1.0);',
    'float fres = pow(1.0 - vy, 4.0);',
    'float vd = length(vViewPosition);',
    'vec3 env = rrSky(vy);', // mirror of the view ray about the running surface: the sky at the same elevation
    'env = mix(env, vec3(dot(env, vec3(0.3333))), 0.4);',
    'float band = 0.8 + 0.2 * sin(wp.z * 0.9 + 1.7 * sin(wp.z * 0.137));',
    'vec3 Rr = vec3(-Vr.x, Vr.y, -Vr.z);', // reflect(-V, up)
    'vec3 steel = run * (0.4 * tint + env * (0.3 + 0.4 * fres)) * band * (1.0 - 0.3 * isNeon);',
    'steel += uSunCol * pow(max(dot(Rr, uSunDir), 0.0), 40.0) * run * 0.5;',
    'float head = smoothstep(0.3, 0.5, top);',
    'steel += (uHorizon * 0.5 + tint * 0.08) * head * (1.0 - run) * 0.25;', // head sides / chamfers: soft horizon sheen
    'rrEmis += min(steel, vec3(0.68));', // continuous lines stay under the bloom threshold (bloom beads 1-2 px lines)
    // speed streaks: ~25 % of 4 m cells carry a 0.3-1.1 m highlight on the running surface (fades out by 90 m)
    'float sf = fract(wp.z * 0.25);',
    'float sh = rrHash(vec2(floor(wp.z * 0.25) + 0.37, floor(wp.x * 1.3 + 50.0) * 1.37));',
    'float sl = 0.08 + 0.2 * fract(sh * 7.3);',
    'float streak = step(0.75, sh) * smoothstep(0.0, 0.03, sf) * (1.0 - smoothstep(sl - 0.03, sl, sf));',
    'rrEmis += vec3(1.0) * streak * run * 0.7 * (1.0 - smoothstep(25.0, 90.0, vd));',
    'rrEmis += vec3(0.25, 0.95, 1.0) * isNeon * (0.55 * (1.0 - smoothstep(0.3, 0.5, top)) + 0.1 * run);'
  ].join('\n');
  function railCompile(shader) {
    commonUniforms(shader.uniforms);
    const U = this.userData.u; Object.assign(shader.uniforms, U);
    // local = world - mesh offset; uRailZ = mesh z - origin z (computed in double precision on the CPU)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform float uRailZ; attribute float aTop; varying float vTop;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = vec3(transformed.xy, transformed.z + uRailZ);\nvTop = clamp(aTop, 0.0, 1.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nvarying vec3 vWPos; varying float vTop; uniform vec3 uRT0; uniform vec3 uRT1; uniform vec3 uRT2; uniform vec3 uRT3; uniform vec3 uRT4; uniform float uCandyIdx; uniform float uNeonIdx;')
      .replace('#include <color_fragment>', RAIL_FS)
      .replace('#include <aomap_fragment>', SHADE_FS);
  }

  // Water: one ShaderMaterial for sea (0), chocolate river (1), frozen lake (2), neon canal (3).
  const WATER_VS = [
    '#include <common>',
    '#include <fog_pars_vertex>',
    'attribute vec3 aW;',
    'uniform vec3 uOrigin; uniform float uTime; uniform float uWaves;',
    'varying vec3 vWPos; varying vec3 vN; varying vec3 vW;',
    'void gw(vec2 d, float L, float A, float Q, vec2 xz, inout vec3 p, inout vec3 n) {',
    '  float k = 6.2831853 / L; float c = sqrt(9.8 / k); float f = k * (dot(d, xz) - c * uTime);',
    '  float cf = cos(f), sf = sin(f);',
    '  p.x += Q * A * d.x * cf; p.z += Q * A * d.y * cf; p.y += A * sf;',
    '  n.x -= d.x * k * A * cf; n.z -= d.y * k * A * cf; n.y -= Q * k * A * sf;',
    '}',
    'void main() {',
    '  vec3 p = position;',
    '  vec3 lp = p - uOrigin;',
    '  float kind = aW.z;',
    '  float sea = 1.0 - min(abs(kind), 1.0), choc = 1.0 - min(abs(kind - 1.0), 1.0), canal = 1.0 - min(abs(kind - 3.0), 1.0);',
    '  float amp = uWaves * (sea + choc * 0.16 + canal * 0.1) * smoothstep(0.3, 3.5, aW.x) * (1.0 - smoothstep(50.0, 90.0, aW.y));',
    '  vec3 n = vec3(0.0, 1.0, 0.0);',
    '  if (amp > 0.001) {',
    '    vec3 q = vec3(0.0);',
    // wave directions/lengths chosen so d.y * 3000 / L is an integer (origin shifts are seamless)
    '    vec2 d0 = sea > 0.5 ? vec2(0.936750, 0.35) : vec2(0.198997, 0.98);',
    '    gw(d0, 21.0, 0.22 * amp, 0.7, lp.xz, q, n);',
    '    gw(vec2(0.8, -0.6), 12.5, 0.1 * amp, 0.6, lp.xz, q, n);',
    '    gw(vec2(0.6, 0.8), 7.5, 0.05 * amp, 0.5, lp.xz, q, n);',
    '    p += q;',
    '  }',
    '  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  vWPos = (modelMatrix * vec4(p, 1.0)).xyz - uOrigin;',
    '  vN = normalize(n); vW = aW;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');
  const WATER_FS = [
    '#include <common>',
    '#include <fog_pars_fragment>',
    GLSL_COMMON,
    'uniform sampler2D uNrm; uniform sampler2D uNoise;',
    'varying vec3 vWPos; varying vec3 vN; varying vec3 vW;',
    'void main() {',
    '  vec3 wp = vWPos;',
    '  float kind = vW.z; float depth = vW.x; float shore = vW.y;',
    '  float sea = 1.0 - min(abs(kind), 1.0), choc = 1.0 - min(abs(kind - 1.0), 1.0), ice = 1.0 - min(abs(kind - 2.0), 1.0), canal = 1.0 - min(abs(kind - 3.0), 1.0);',
    '  vec2 flow = vec2(0.0, uTime * 0.9) * choc;',
    '  vec2 uv1 = (wp.xz + flow) * (0.052 - choc * 0.022) + vec2(uTime * 0.016, uTime * 0.011) * (1.0 - ice - choc);',
    '  vec3 t1 = texture2D(uNrm, uv1).xyz * 2.0 - 1.0;',
    '#ifdef RR_LOW',
    '  vec3 t2 = vec3(0.0);',
    '#else',
    '  vec2 uv2 = (wp.xz + flow * 1.3) * 0.14 + vec2(-uTime * 0.021, uTime * 0.017) * (1.0 - ice);',
    '  vec3 t2 = texture2D(uNrm, uv2).xyz * 2.0 - 1.0;',
    '#endif',
    '  float bump = sea * 0.5 + choc * 0.35 + ice * 0.05 + canal * 0.3;',
    '  vec3 N = normalize(vN + vec3(t1.x + t2.x, 0.0, t1.y + t2.y) * bump);',
    '  vec3 V = normalize(cameraPosition - uOrigin - wp);',
    '  float NdV = max(dot(N, V), 0.0);',
    '  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);',
    '  vec3 R = reflect(-V, N);',
    '  vec3 sky = rrSky(max(R.y, 0.0));',
    '  vec4 nz = texture2D(uNoise, (wp.xz + flow * 0.6) * 0.035);',
    '  vec4 nz2 = texture2D(uNoise, wp.xz * 0.011 + vec2(0.3, 0.7));',
    // body colours
    '  vec3 seaC = mix(vec3(0.24, 0.82, 0.78), vec3(0.05, 0.4, 0.7), smoothstep(0.4, 7.0, depth));',
    '  seaC = mix(seaC, vec3(0.03, 0.26, 0.55), smoothstep(8.0, 14.0, depth));',
    '  vec3 chocC = mix(vec3(0.5, 0.27, 0.13), vec3(0.24, 0.11, 0.05), smoothstep(0.32, 0.72, nz.b));',
    '  chocC = mix(chocC, vec3(0.8, 0.62, 0.44), smoothstep(0.74, 0.86, nz.b) * 0.75);',
    '  vec3 iceC = mix(vec3(0.7, 0.84, 0.92), vec3(0.52, 0.72, 0.88), smoothstep(0.35, 0.7, nz2.b));',
    '  iceC = mix(iceC, vec3(0.9, 0.95, 1.0), (1.0 - smoothstep(0.0, 3.5, shore)) * 0.7);',
    '  iceC = mix(iceC, vec3(0.95, 0.98, 1.0), nz.g * 0.75);',
    '  iceC = mix(iceC, vec3(0.34, 0.5, 0.66), texture2D(uNoise, wp.xz * 0.09).g * 0.35);',
    '  vec3 canC = mix(vec3(0.07, 0.04, 0.17), vec3(0.03, 0.02, 0.09), smoothstep(0.5, 2.0, depth));',
    '  vec3 body = seaC * sea + chocC * choc + iceC * ice + canC * canal;',
    '  float reflK = sea * 0.5 + choc * 0.3 + ice * 0.4 + canal * 0.9;',
    '  vec3 col = mix(body, sky, min(F, 0.8) * reflK);',
    // neon reflections in the canal
    '  if (canal > 0.0) {',
    '    float lane = floor((wp.z + t1.y * 2.0) / 10.0);',
    '    float hs = rrHash(vec2(lane, 7.0));',
    '    vec3 nc = hs < 0.33 ? vec3(1.0, 0.25, 0.82) : hs < 0.66 ? vec3(0.22, 0.94, 1.0) : vec3(1.0, 0.88, 0.3);',
    '    float streak = smoothstep(0.55, 0.95, sin((wp.z + t1.x * 3.0) * 1.2566371 + hs * 20.0)) * step(0.35, hs);',
    '    col += nc * streak * (0.35 + 0.65 * F) * 1.1 * uGlow;',
    '    col += vec3(1.0, 0.25, 0.82) * pow(max(dot(R, normalize(vec3(-0.15, 0.06, -1.0))), 0.0), 30.0) * 0.8 * uGlow;',
    '    col += vec3(0.22, 0.94, 1.0) * (1.0 - smoothstep(0.0, 0.6, shore)) * 0.5 * uGlow;',
    '  }',
    // sun glitter
    '  float sd = max(dot(R, uSunDir), 0.0);',
    '  col += uSunCol * (pow(sd, 220.0) * 3.2 + pow(sd, 18.0) * 0.12) * uGlow * (sea + canal * 0.2 + ice * 0.35);',
    '  col += uSunCol * (pow(sd, 50.0) * 0.9 + pow(max(dot(N, normalize(V + vec3(0.0, 1.0, 0.0))), 0.0), 60.0) * 0.35) * choc * uGlow;',
    // ice sparkles
    '  float sp = step(0.992, rrHash(floor(wp.xz * 7.0) + floor((cameraPosition.xz - uOrigin.xz) * 0.2) * 0.37));',
    '  col += vec3(1.0) * sp * ice * 1.2 * uGlow * (1.0 - smoothstep(15.0, 60.0, length(cameraPosition - uOrigin - wp)));',
    // sea foam: shoreline band + travelling wash lines
    '  float foam = (1.0 - smoothstep(0.0, 1.8, shore)) * (0.5 + 0.5 * nz.r);',
    '  float wl = sin(shore * 1.7 - uTime * 1.5 + nz.r * 2.5);',
    '  foam += smoothstep(0.86, 0.99, wl) * (1.0 - smoothstep(1.0, 8.0, shore)) * (0.35 + 0.65 * nz.r);',
    '  foam += smoothstep(0.72, 0.9, nz2.r) * smoothstep(0.1, 0.35, max(vN.y < 0.999 ? 1.0 - vN.y : 0.0, 0.0) * 40.0) * 0.3;',
    '  col = mix(col, vec3(0.93, 0.97, 0.98), clamp(foam, 0.0, 1.0) * 0.9 * sea);',
    '  col = mix(col, vec3(0.62, 0.42, 0.28), (1.0 - smoothstep(0.0, 1.2, shore)) * 0.5 * choc);',
    '  float tsh = rrTunnel(wp) * uTunnelK;',
    '  col *= 1.0 - 0.6 * tsh;',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  function makeWaterMat() {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    commonUniforms(u);
    u.uWaves = { value: 1 }; u.uNrm = { value: TEX.wnrm }; u.uNoise = { value: TEX.wnoise };
    const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true, lights: false });
    m.extensions = { derivatives: true };
    return m;
  }

  // ------------------------------------------------------------------ instanced blocks
  const _zero16 = new Float32Array(16); _zero16[15] = 1;
  // Instanced blocks: B instances per block, blocks stay dense (a freed hole is filled by moving the last
  // block into it and updating its owner's field), so mesh.count never covers stale blocks.
  class Blocks {
    constructor(name, geo, mat, B, maxBlocks) {
      this.B = B; this.max = maxBlocks;
      const m = (this.mesh = new THREE.InstancedMesh(geo, mat, B * maxBlocks));
      m.name = 'track-' + name;
      m.frustumCulled = false; m.count = 0; m.visible = false; m.matrixAutoUpdate = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.m = m.instanceMatrix.array;
      for (let i = 0; i < B * maxBlocks; i++) this.m.set(_zero16, i * 16);
      // Always carry instanceColor: r128 does not switch programs on instancingColor, so every InstancedMesh
      // sharing RR.mats.prop / RR.mats.glow must agree on having it.
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(B * maxBlocks * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.c = m.instanceColor.array;
      this.extra = null; // optional extra per-instance attribute { attr, size }
      this.own = new Array(maxBlocks).fill(null); this.key = new Array(maxBlocks).fill(null);
      this.top = -1; this.lo = 1e9; this.hi = -1; this.hidden = false;
      root.add(m);
    }
    alloc(owner, key) {
      if (this.top + 1 >= this.max) return -1;
      const b = ++this.top;
      this.own[b] = owner; this.key[b] = key;
      this.clear(b);
      return b;
    }
    free(b) {
      if (b < 0 || b > this.top) return;
      const last = this.top, B = this.B;
      if (b !== last) { // move the last block into the hole
        this.m.copyWithin(b * B * 16, last * B * 16, (last + 1) * B * 16);
        this.c.copyWithin(b * B * 3, last * B * 3, (last + 1) * B * 3);
        if (this.extra) { const a = this.extra.attr.array, n = this.extra.size; a.copyWithin(b * B * n, last * B * n, (last + 1) * B * n); this.extra.attr.needsUpdate = true; }
        const o = this.own[last], k = this.key[last];
        if (o) o[k] = b;
        this.own[b] = o; this.key[b] = k;
        this.dirty(b * B, b * B + B - 1);
      }
      this.own[last] = null; this.key[last] = null;
      this.clear(last);
      this.top = last - 1;
    }
    clear(b) { const s = b * this.B; for (let i = s; i < s + this.B; i++) { this.m.set(_zero16, i * 16); this.c[i * 3] = this.c[i * 3 + 1] = this.c[i * 3 + 2] = 1; } this.dirty(s, s + this.B - 1); }
    dirty(a, b) { if (a < this.lo) this.lo = a; if (b > this.hi) this.hi = b; }
    set(b, j, x, y, z, ry, sx, sy, sz, rx, rz) {
      const i = b * this.B + j, o = i * 16, e = this.m;
      const a = Math.cos(rx || 0), bb = Math.sin(rx || 0), c = Math.cos(ry || 0), d = Math.sin(ry || 0), ee = Math.cos(rz || 0), f = Math.sin(rz || 0);
      const ae = a * ee, af = a * f, be = bb * ee, bf = bb * f;
      sx = sx === undefined ? 1 : sx; sy = sy === undefined ? sx : sy; sz = sz === undefined ? sx : sz;
      e[o] = c * ee * sx; e[o + 1] = (af + be * d) * sx; e[o + 2] = (bf - ae * d) * sx; e[o + 3] = 0;
      e[o + 4] = -c * f * sy; e[o + 5] = (ae - bf * d) * sy; e[o + 6] = (be + af * d) * sy; e[o + 7] = 0;
      e[o + 8] = d * sz; e[o + 9] = -bb * c * sz; e[o + 10] = a * c * sz; e[o + 11] = 0;
      e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
      this.dirty(i, i);
    }
    color(b, j, r, g, bl) { const i = b * this.B + j; this.c[i * 3] = r; this.c[i * 3 + 1] = g; this.c[i * 3 + 2] = bl; this.dirty(i, i); }
    commit() {
      const m = this.mesh;
      m.count = (this.top + 1) * this.B; m.visible = this.top >= 0 && !this.hidden;
      if (this.hi < 0) return;
      const im = m.instanceMatrix; im.updateRange.offset = this.lo * 16; im.updateRange.count = (this.hi - this.lo + 1) * 16; im.needsUpdate = true;
      const ic = m.instanceColor; ic.updateRange.offset = this.lo * 3; ic.updateRange.count = (this.hi - this.lo + 1) * 3; ic.needsUpdate = true;
      this.lo = 1e9; this.hi = -1;
    }
  }

  // ------------------------------------------------------------------ prototypes
  const G = RR.G;
  function solidOf(p) { const b = p.build(); if (b.glow) b.glow.dispose(); return b.solid; }
  function withUV(geo, u, v) { const uv = geo.attributes.uv; if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v); return geo; }
  function boxNB(w, h, d) { // box without its bottom face (-y), which is never seen
    const g = new THREE.BoxGeometry(w, h, d), src = g.index.array, keep = [];
    for (let i = 0; i < src.length; i++) if (i < 18 || i >= 24) keep.push(src[i]);
    g.setIndex(keep); g.clearGroups();
    return g;
  }
  function boxAt(p, w, h, d, col, x, y, z, rot) { p.add(boxNB(w, h, d), col, [x, y, z], rot); }

  function buildSleeperGeo(style) {
    const p = new RR.Prop();
    if (style === 'candy') {
      p.add(new THREE.CylinderGeometry(0.072, 0.072, 2.14, 8, 1, false), 0xffffff, [0, 0.068, 0], [0, 0, Math.PI / 2]);
    } else if (style === 'concrete') {
      p.add(boxNB(2.2, 0.08, 0.27), 0xffffff, [0, 0.07, 0]);
      p.add(boxNB(2.1, 0.03, 0.22), 0xf2f2f6, [0, 0.125, 0]);
    } else {
      if (style === 'frost') p.add(boxNB(2.1, 0.11, 0.24), 0xffffff, [0, 0.085, 0]);
      else { p.add(boxNB(2.1, 0.095, 0.24), 0xffffff, [0, 0.0775, 0]); p.add(boxNB(2.06, 0.015, 0.2), 0xf6f0ea, [0, 0.1325, 0]); }
      if (style === 'frost') {
        p.add(withUV(boxNB(0.8, 0.03, 0.22), 0.97, 0.5), 0xffffff, [0, 0.155, 0]);
        p.add(withUV(boxNB(0.26, 0.03, 0.22), 0.97, 0.5), 0xffffff, [-0.92, 0.155, 0]);
        p.add(withUV(boxNB(0.26, 0.03, 0.22), 0.97, 0.5), 0xffffff, [0.92, 0.155, 0]);
      }
    }
    return solidOf(p);
  }
  function buildPlateGeo() {
    const p = new RR.Prop();
    [-GAUGE, GAUGE].forEach((x) => {
      boxAt(p, 0.36, 0.016, 0.2, 0x4a4652, x, Y_SLP + 0.008, 0);
      boxAt(p, 0.05, 0.034, 0.08, 0xc8862e, x + (x < 0 ? -0.115 : 0.115), Y_SLP + 0.03, 0);
    });
    return solidOf(p);
  }
  function buildCurbGeo() {
    const p = new RR.Prop();
    boxAt(p, 0.3, 0.22, 2.46, 0xffffff, 0, 0.11, 0);
    boxAt(p, 0.24, 0.04, 2.46, 0xf4f4f4, 0, 0.24, 0);
    return solidOf(p);
  }
  function buildCurbGlowGeo() { const p = new RR.Prop(); boxAt(p, 0.035, 0.02, 2.4, 0xffffff, 0, 0.265, 0); return solidOf(p); }
  function buildTroughGeo() {
    const p = new RR.Prop();
    boxAt(p, 0.4, 0.18, 4.96, 0xe6e2e8, 0, 0.09, 0);
    for (let i = 0; i < 5; i++) boxAt(p, 0.44, 0.03, 0.96, 0xffffff, 0, 0.195, -2 + i);
    return solidOf(p);
  }
  function buildFenceGeo(kind) {
    const p = new RR.Prop();
    const P = 2.5; // post at the +z end
    if (kind === 'beach') {
      p.add(G.cyl(0.07, 0.085, 0.95, 6), 0x9a7654, [0, 0.475, P]);
      p.add(G.cone(0.09, 0.08, 6), 0x7e6044, [0, 0.99, P]);
      const a = Math.atan2(0.16, 2.5);
      p.add(G.box(0.035, 0.035, 2.52), 0xd9c49a, [0, 0.74, 1.25], [-a, 0, 0]);
      p.add(G.box(0.035, 0.035, 2.52), 0xd9c49a, [0, 0.74, -1.25], [a, 0, 0]);
    } else if (kind === 'candy') {
      for (let i = 0; i < 4; i++) p.add(new THREE.CylinderGeometry(0.065, 0.065, 0.22, 6, 1, true), i & 1 ? 0xe0406a : 0xf2eef2, [0, 0.11 + i * 0.22, P]);
      p.add(G.sph(0.1, 6, 4), 0xff7ab8, [0, 0.98, P]);
      p.add(G.box(0.05, 0.05, 5), 0x7fdcc0, [0, 0.74, 0]);
      p.add(G.box(0.04, 0.04, 5), 0xf2eef2, [0, 0.4, 0]);
    } else if (kind === 'neon') {
      boxAt(p, 0.09, 0.9, 0.09, 0x2a2050, 0, 0.45, P);
      boxAt(p, 0.16, 0.05, 0.16, 0x1c1638, 0, 0.025, P);
      boxAt(p, 0.06, 0.06, 5, 0x2a2050, 0, 0.86, 0);
    } else if (kind === 'snow') {
      boxAt(p, 0.08, 1.0, 0.08, 0x7a5a44, 0, 0.5, P);
      boxAt(p, 0.03, 0.1, 5, 0x8e6c52, 0, 0.3, 0);
      boxAt(p, 0.03, 0.1, 5, 0x8e6c52, 0, 0.58, 0);
      boxAt(p, 0.03, 0.1, 5, 0x8e6c52, 0, 0.86, 0);
      boxAt(p, 0.07, 0.04, 5, 0xe8f0fa, 0, 0.93, 0);
      boxAt(p, 0.13, 0.05, 0.13, 0xeef4fb, 0, 1.02, P);
    } else { // city railing
      boxAt(p, 0.07, 1.05, 0.07, 0x7c8598, 0, 0.525, P);
      boxAt(p, 0.16, 0.03, 0.16, 0x656d80, 0, 0.015, P);
      boxAt(p, 0.06, 0.05, 5, 0x8c95a8, 0, 1.02, 0);
      boxAt(p, 0.035, 0.035, 5, 0x8c95a8, 0, 0.55, 0);
      boxAt(p, 0.035, 0.035, 5, 0x8c95a8, 0, 0.14, 0);
    }
    return solidOf(p);
  }
  function buildFenceGlowGeo() {
    const p = new RR.Prop();
    boxAt(p, 0.035, 0.035, 4.9, 0xffffff, 0, 0.905, 0);
    boxAt(p, 0.1, 0.03, 0.1, 0xffffff, 0, 0.915, 2.5);
    return solidOf(p);
  }
  function buildDwarfGeo() {
    const p = new RR.Prop();
    boxAt(p, 0.34, 0.08, 0.3, 0xa8a4a8, 0, 0.04, 0);
    boxAt(p, 0.24, 0.52, 0.18, 0x24242c, 0, 0.34, 0);
    boxAt(p, 0.28, 0.04, 0.24, 0x2e2e36, 0, 0.62, 0);
    [0.47, 0.25].forEach((y) => {
      p.add(G.cyl(0.07, 0.07, 0.03, 10), 0x121216, [0, y, 0.09], [Math.PI / 2, 0, 0]);
      boxAt(p, 0.15, 0.02, 0.07, 0x18181e, 0, y + 0.08, 0.12);
    });
    boxAt(p, 0.2, 0.08, 0.02, 0xf2d24a, 0, 0.14, 0.095);
    return solidOf(p);
  }
  function buildMastGeo() {
    const p = new RR.Prop();
    boxAt(p, 0.5, 0.25, 0.5, 0xa8a4a8, 0, 0.125, 0);
    p.add(G.cyl(0.065, 0.075, 4.6, 8), 0x9098a8, [0, 2.55, -0.02]);
    boxAt(p, 0.24, 0.36, 0.18, 0x6c7488, 0, 1.25, 0.06);
    boxAt(p, 0.52, 1.22, 0.03, 0xf2f2f2, 0, 4.36, -0.13);
    boxAt(p, 0.44, 1.12, 0.02, 0x1a1a1f, 0, 4.36, -0.112);
    boxAt(p, 0.3, 0.98, 0.2, 0x1c1c22, 0, 4.36, 0);
    [4.72, 4.42, 4.12].forEach((y) => {
      p.add(G.cyl(0.085, 0.085, 0.02, 10), 0x0e0e12, [0, y, 0.1], [Math.PI / 2, 0, 0]);
      boxAt(p, 0.22, 0.025, 0.13, 0x16161c, 0, y + 0.11, 0.16);
    });
    boxAt(p, 0.08, 0.12, 0.3, 0x9098a8, 0, 3.74, -0.05);
    return solidOf(p);
  }
  function buildCrossbuckGeo() {
    const p = new RR.Prop();
    boxAt(p, 0.34, 0.2, 0.34, 0xa8a4a8, 0, 0.1, 0);
    p.add(G.cyl(0.06, 0.06, 3.3, 8), 0xe8e8ec, [0, 1.75, 0]);
    [0.6, 1.0, 1.4].forEach((y) => p.add(G.cyl(0.063, 0.063, 0.14, 8), 0x22222a, [0, y, 0]));
    [0.62, -0.62].forEach((a) => {
      boxAt(p, 1.31, 0.28, 0.02, 0xc8202e, 0, 3.0, -0.03, [0, 0, a]);
      boxAt(p, 1.25, 0.22, 0.03, 0xf4f4f4, 0, 3.0, -0.01, [0, 0, a]);
    });
    boxAt(p, 0.95, 0.09, 0.08, 0x22222a, 0, 2.28, 0);
    [-0.36, 0.36].forEach((x) => {
      p.add(G.cyl(0.13, 0.13, 0.06, 12), 0x111114, [x, 2.28, 0.05], [Math.PI / 2, 0, 0]);
      p.add(G.cyl(0.15, 0.15, 0.02, 12, 1), 0x2a2a30, [x, 2.28, 0.02], [Math.PI / 2, 0, 0]);
    });
    return solidOf(p);
  }
  function buildLampGeo() { const p = new RR.Prop(); p.add(new THREE.CircleGeometry(0.058, 10), 0xffffff); return solidOf(p); }
  function buildBoardGeo() {
    const post = G.box(0.06, 0.96, 0.06); post.translate(0, 0.48, 0); withUV(post, -1, -1);
    const board = G.box(0.42, 0.21, 0.025); board.translate(0, 1.05, 0);
    const uv = board.attributes.uv; // BoxGeometry face order: px nx py ny pz nz (4 vertices each); keep UVs on +z only
    for (let i = 0; i < uv.count; i++) if (i < 16 || i >= 20) uv.setXY(i, -1, -1);
    const p = new RR.Prop(); p.add(post, 0xffffff); p.add(board, 0xffffff);
    return solidOf(p);
  }

  // Rails: RAIL_SLABS slabs of RAIL_SEG metres (all 6 rails per slab, slab-major so a draw range selects a
  // contiguous run of slabs). Local z runs from 0 (near end of slab 0) toward -z; placeRails() snaps the mesh to
  // a multiple of RAIL_SEG and draws only the slabs between just behind the camera and the far streaming edge.
  // Short slabs matter: a 1.5 km quad crossing the near plane gets clipped / depth-interpolated badly (rails won
  // the depth test against the hero, trains and obstacles, and extrapolated varyings gave specks and streaks).
  // The base (on the sleepers), the downward-facing head undersides (the camera is always above the rails) and the
  // end caps are never visible and are omitted. Per face: flat normal, aTop
  // (1 running surface, 0.8 chamfers, 0.45 head sides, 0 web/foot) and a vertex colour.
  function buildRailGeo() {
    const fw = 0.075, ft = 0.018, ww = 0.018, hw = 0.038, hb = 0.092, ht = 0.14, ch = 0.012;
    const pr = [[-fw, 0], [fw, 0], [fw, ft * 0.6], [ww * 1.7, ft], [ww, ft + 0.014], [ww, hb - 0.012], [hw, hb], [hw, ht - ch], [hw - ch, ht],
      [-hw + ch, ht], [-hw, ht - ch], [-hw, hb], [-ww, hb - 0.012], [-ww, ft + 0.014], [-ww * 1.7, ft], [-fw, ft * 0.6]]; // counter-clockwise
    const faces = [];
    for (let e = 1; e < pr.length; e++) { // edge 0 is the base (faces down onto the sleepers)
      const a = pr[e], b = pr[(e + 1) % pr.length];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]); const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl; // outward normal
      if (ny < -0.5) continue; // head underside
      const ym = Math.max(a[1], b[1]);
      const t = ym > ht - 0.001 && ny > 0.9 ? 1 : ym > ht - ch - 0.001 && ny > 0.3 ? 0.8 : ym > hb - 0.001 && Math.abs(nx) > 0.5 ? 0.45 : 0;
      faces.push({ a, b, nx, ny, t });
    }
    const xs = [];
    C.LANES.forEach((l) => { xs.push(l - GAUGE, l + GAUGE); });
    const vps = xs.length * faces.length * 4, nv = vps * RAIL_SLABS;
    if (nv > 65535) throw new Error('track: rail vertex count ' + nv);
    railIdxPerSlab = xs.length * faces.length * 6;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), top = new Float32Array(nv);
    const idx = new Uint16Array(railIdxPerSlab * RAIL_SLABS);
    let v = 0, o = 0;
    for (let s = 0; s < RAIL_SLABS; s++) {
      const z0 = -s * RAIL_SEG, z1 = -(s + 1) * RAIL_SEG;
      for (let r = 0; r < xs.length; r++) {
        for (let f = 0; f < faces.length; f++) {
          const F = faces[f], c = F.t > 0.9 ? 1 : F.t > 0.6 ? 0.85 : F.t > 0.4 ? 0.68 : 0.5; // web / foot: oiled steel
          const cg = c * (F.t > 0.4 ? 0.98 : 0.93), cb = c * (F.t > 0.4 ? 0.99 : 0.88);
          // A0, B0, A1, B1
          const P4 = [[F.a, z0], [F.b, z0], [F.a, z1], [F.b, z1]];
          for (let q = 0; q < 4; q++) {
            const p = P4[q][0], k = v + q;
            pos[k * 3] = p[0] + xs[r]; pos[k * 3 + 1] = p[1] + Y_SLP; pos[k * 3 + 2] = P4[q][1];
            nor[k * 3] = F.nx; nor[k * 3 + 1] = F.ny; nor[k * 3 + 2] = 0;
            col[k * 3] = c; col[k * 3 + 1] = cg; col[k * 3 + 2] = cb;
            top[k] = F.t;
          }
          idx[o++] = v; idx[o++] = v + 3; idx[o++] = v + 1; // (A0, B1, B0)
          idx[o++] = v; idx[o++] = v + 2; idx[o++] = v + 3; // (A0, A1, B1)
          v += 4;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, -RAIL_SLABS * RAIL_SEG / 2), RAIL_SLABS * RAIL_SEG / 2 + 5);
    return geo;
  }
  // Show the rail slabs covering [zNear, zFar]: ahead to the terrain streaming edge; behind, at most
  // RAIL_BEHIND_CAM past the camera (or as far back as the terrain when the camera looks backward).
  function placeRails(pz) {
    if (!railMesh) return;
    let zNear;
    if (covBack) zNear = pz + covBehind;
    else {
      const cz = camera ? RR.clamp(camera.position.z, pz - 20, pz + 20) : pz + 10;
      zNear = Math.max(pz, cz) + RAIL_BEHIND_CAM;
    }
    const zFar = pz - covAhead;
    const k0 = Math.ceil(-zNear / RAIL_SEG), k1 = Math.floor(-zFar / RAIL_SEG);
    const n = Math.max(0, Math.min(RAIL_SLABS, k1 - k0));
    railMesh.position.z = -k0 * RAIL_SEG;
    railMesh.geometry.setDrawRange(0, n * railIdxPerSlab);
    railMat.userData.u.uRailZ.value = railMesh.position.z - SU.uOrigin.value.z; // exact (both are multiples of 25)
    stats.railSlabs = n;
  }

  // ------------------------------------------------------------------ pools
  let P_ = null; // instanced block pools
  let sharedIndex = null;
  const chunks = []; // pool of chunk objects
  let active = []; // active chunk refs
  const queue = []; // chunks waiting to be (re)built, nearest first
  let water = null;

  function makeChunk(slot) {
    const nv = NC * NRV;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), ext = new Float32Array(nv * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aExtra', new THREE.BufferAttribute(ext, 2));
    geo.setIndex(sharedIndex);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -CH / 2), 660);
    const mesh = new THREE.Mesh(geo, terrainMats[0]);
    mesh.name = 'track-terrain';
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    return {
      slot, c: 0, k: 0, wi: 0, z0: 0, live: false, stage: -1, row: 0, geo, mesh, pos, nor, col, ext,
      hgt: new Float32Array(NC * (NRV + 2)), wet: new Float32Array(NC * NRV), can: new Float32Array(NC * NRV),
      near: false, plates: false, bSleep: -1, sleepPool: null, bPlate: -1,
      bCurb: -1, bCurbGlow: -1, bTrough: -1, bFence: -1, fencePool: null, bFenceGlow: -1, bDwarf: -1, bMast: -1, bXing: -1, bLamp: -1, bBoard: -1,
      mastZ: 0, mastSide: 1, mastRed: false, xingZ: 0, hasXing: false, lampPhase: -1, wSlot: -1, maxH: 0
    };
  }

  function buildPools() {
    const mats = RR.getMats();
    const mk = (name, geo, mat, B, maxB) => new Blocks(name, geo, mat, B, maxB);
    P_ = {
      sleep: {
        wood: mk('sleeper-wood', buildSleeperGeo('wood'), sleeperMats.wood, 192, 14, true),
        concrete: mk('sleeper-concrete', buildSleeperGeo('concrete'), sleeperMats.concrete, 192, 14, true),
        candy: mk('sleeper-candy', buildSleeperGeo('candy'), sleeperMats.candy, 192, 14, true),
        frost: mk('sleeper-frost', buildSleeperGeo('frost'), sleeperMats.frost, 192, 14, true)
      },
      plate: mk('plates', buildPlateGeo(), sleeperMats.plain, 192, 6, false),
      curb: mk('curbs', buildCurbGeo(), mats.prop, 40, MAX_CHUNKS, true),
      curbGlow: mk('curb-glow', buildCurbGlowGeo(), mats.glow, 40, MAX_CHUNKS, true),
      trough: mk('troughs', buildTroughGeo(), mats.prop, 10, MAX_CHUNKS, true),
      fence: {},
      fenceGlow: mk('fence-glow', buildFenceGlowGeo(), mats.glow, 20, MAX_CHUNKS, true),
      dwarf: mk('signal-dwarf', buildDwarfGeo(), mats.prop, 1, MAX_CHUNKS, false),
      mast: mk('signal-mast', buildMastGeo(), mats.prop, 1, MAX_CHUNKS, false),
      xing: mk('crossbucks', buildCrossbuckGeo(), mats.prop, 2, MAX_CHUNKS, false),
      lamp: mk('lamps', buildLampGeo(), mats.glow, 6, MAX_CHUNKS, true),
      board: mk('km-posts', buildBoardGeo(), boardMat, 1, MAX_CHUNKS, false)
    };
    ['city', 'beach', 'candy', 'neon', 'snow'].forEach((k) => { P_.fence[k] = mk('fence-' + k, buildFenceGeo(k), mats.prop, 20, MAX_CHUNKS, false); });
    // ground-level track pieces catch the player / train / obstacle shadows
    [P_.sleep.wood, P_.sleep.concrete, P_.sleep.candy, P_.sleep.frost, P_.plate, P_.curb, P_.trough].forEach((b) => (b.mesh.receiveShadow = true));
    P_.fenceList = Object.keys(P_.fence).map((k) => P_.fence[k]);
    // km post cell attribute
    const bm = P_.board.mesh;
    bm.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHUNKS * 2), 2));
    bm.geometry.attributes.aCell.setUsage(THREE.DynamicDrawUsage);
    P_.board.extra = { attr: bm.geometry.attributes.aCell, size: 2 };
  }

  function buildSharedIndex() {
    const idx = new Uint16Array(NRQ * (NC - 1) * 6);
    let o = 0;
    for (let j = 0; j < NRQ; j++) for (let i = 0; i < NC - 1; i++) {
      const a = j * NC + i, b = a + 1, c = a + NC, d = c + 1;
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = b; idx[o++] = d; idx[o++] = c;
    }
    sharedIndex = new THREE.BufferAttribute(idx, 1);
  }

  // ------------------------------------------------------------------ water mesh
  const NWX = 17, NWZ = NRV, WV = NWX * NWZ, WI = (NWX - 1) * (NWZ - 1) * 6;
  const SEA_XS = [-605, -470, -340, -240, -170, -120, -88, -66, -52, -43, -36, -31, -27.5, -25, -23, -21, -19.2];
  function buildWater() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(WSLOTS * WV * 3), aw = new Float32Array(WSLOTS * WV * 3);
    for (let i = 0; i < WSLOTS * WV; i++) pos[i * 3 + 1] = -1000;
    const idx = new Uint16Array(WSLOTS * WI);
    let o = 0;
    for (let s = 0; s < WSLOTS; s++) for (let j = 0; j < NWZ - 1; j++) for (let i = 0; i < NWX - 1; i++) {
      const a = s * WV + j * NWX + i, b = a + 1, c = a + NWX, d = c + 1;
      idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = b; idx[o++] = d; idx[o++] = c;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aW', new THREE.BufferAttribute(aw, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, waterMat);
    mesh.name = 'track-water';
    mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
    root.add(mesh);
    water = { geo, mesh, pos, aw, used: new Uint8Array(WSLOTS), top: -1, lo: 1e9, hi: -1 };
  }
  function waterAlloc() {
    for (let s = 0; s < WSLOTS; s++) if (!water.used[s]) { water.used[s] = 1; if (s > water.top) water.top = s; return s; }
    return -1;
  }
  function waterFree(s) {
    if (s < 0 || !water.used[s]) return;
    water.used[s] = 0;
    for (let i = s * WV; i < (s + 1) * WV; i++) { water.pos[i * 3] = 0; water.pos[i * 3 + 1] = -1000; water.pos[i * 3 + 2] = 0; }
    waterDirty(s);
    while (water.top >= 0 && !water.used[water.top]) water.top--;
  }
  function waterDirty(s) { if (s < water.lo) water.lo = s; if (s > water.hi) water.hi = s; }
  function waterCommit() {
    water.geo.setDrawRange(0, (water.top + 1) * WI);
    water.mesh.visible = water.top >= 0;
    if (water.hi < 0) return;
    const P = water.geo.attributes.position, A = water.geo.attributes.aW;
    P.updateRange.offset = water.lo * WV * 3; P.updateRange.count = (water.hi - water.lo + 1) * WV * 3; P.needsUpdate = true;
    A.updateRange.offset = water.lo * WV * 3; A.updateRange.count = (water.hi - water.lo + 1) * WV * 3; A.needsUpdate = true;
    water.lo = 1e9; water.hi = -1;
  }

  // Which water body (if any) chunk ch carries; returns kind code or -1.
  function chunkWaterKind(ch) {
    const kind = kindOf(ch.wi), rel0 = -ch.z0 - ch.k * C.WORLD_LEN, rel1 = rel0 + CH;
    if (kind === 'beach') return rel1 > 60 && rel0 < 940 ? 0 : -1;
    if (kind === 'candy') return rel1 > 62 && rel0 < 938 ? 1 : -1;
    if (kind === 'neon') return rel1 > 70 && rel0 < 930 ? 3 : -1;
    if (kind === 'snow') {
      for (let i = 0; i < 2; i++) { const L = lakeParams(ch.k, i, lakeTmp); if (ch.z0 - CH < L.cz + L.rz * 1.05 && ch.z0 > L.cz - L.rz * 1.05) return 2; }
    }
    return -1;
  }
  function waterStep(ch, deadline) {
    if (ch.wRow === 0) {
      ch.wKind = chunkWaterKind(ch);
      if (ch.wKind < 0) return true;
      ch.wSlot = waterAlloc();
      if (ch.wSlot < 0) return true;
    } else if (ch.wKind < 0 || ch.wSlot < 0) return true;
    const wk = ch.wKind, s = ch.wSlot;
    const pos = water.pos, aw = water.aw;
    const level = wk === 0 ? SEA_L : wk === 1 ? RIV_L : wk === 2 ? LAKE_L : CAN_L;
    let lake = null;
    if (wk === 2) for (let i = 0; i < 2; i++) { const L = lakeParams(ch.k, i, lakePatch); if (ch.z0 - CH < L.cz + L.rz * 1.05 && ch.z0 > L.cz - L.rz * 1.05) { lake = L; break; } }
    for (let j = ch.wRow; j < NWZ; j++) {
      const z = ch.z0 - j * DZ, rel = -z - ch.k * C.WORLD_LEN;
      const shoreX = wk === 0 ? seaShore(z) : 0, cx = wk === 1 ? riverCx(rel, z) : 0;
      for (let i = 0; i < NWX; i++) {
        let x, sd;
        if (wk === 0) { x = SEA_XS[i]; sd = -x - shoreX; }
        else if (wk === 1) { x = cx + (i / (NWX - 1) - 0.5) * 2 * RIV_HW * 1.9; sd = RIV_HW - Math.abs(x - cx); }
        else if (wk === 3) { x = -42.4 + (i / (NWX - 1)) * 16.8; const ax = -x; sd = Math.min(ax - 26.5, 41.5 - ax); }
        else { x = lake.cx + (i / (NWX - 1) - 0.5) * 2 * lake.rx * 1.08; const dx = (x - lake.cx) / lake.rx, dz = (z - lake.cz) / lake.rz; sd = (1 - Math.sqrt(dx * dx + dz * dz)) * Math.min(lake.rx, lake.rz); }
        const v = s * WV + j * NWX + i;
        const hgt = Hc(x, z);
        pos[v * 3] = x; pos[v * 3 + 1] = level; pos[v * 3 + 2] = z;
        aw[v * 3] = level - hgt; aw[v * 3 + 1] = sd; aw[v * 3 + 2] = wk;
      }
      ch.wRow = j + 1;
      if (j < NWZ - 1 && performance.now() > deadline) { waterDirty(s); return false; }
    }
    waterDirty(s);
    return true;
  }

  // ------------------------------------------------------------------ chunk building
  const _col = [0, 0, 0];
  function chunkStart(ch, c) {
    ch.c = c; ch.z0 = -c * CH;
    const zc = ch.z0 - CH / 2;
    ch.k = Math.floor(Math.max(0, -zc) / C.WORLD_LEN);
    ch.wi = ch.k % NW;
    ch.live = true; ch.stage = 0; ch.row = 0; ch.maxH = 0; ch.wRow = 0; ch.wKind = -1;
    ch.mesh.visible = false;
    ch.mesh.position.set(0, 0, ch.z0); ch.mesh.updateMatrix(); ch.mesh.updateMatrixWorld(true);
  }
  function streetRowRaised(ch, z) {
    if (kindOf(ch.wi) !== 'city') return false;
    return streetAt(z, 0.01);
  }
  // one build step; returns true when the chunk is complete
  function buildStep(ch, deadline) {
    while (ch.stage === 0) { // heights incl. halo rows (r = 0 .. NRV + 1)
      const r = ch.row, z = ch.z0 - (r - 1) * DZ;
      const inside = r >= 1 && r <= NRV;
      for (let i = 0; i < NC; i++) {
        const h = Hv(XSF[i], z);
        ch.hgt[r * NC + i] = h;
        if (inside) { const v = (r - 1) * NC + i; ch.wet[v] = OUT.wet; ch.can[v] = OUT.canal; if (h > ch.maxH) ch.maxH = h; }
      }
      ch.row++;
      if (ch.row >= NRV + 2) { ch.stage = 1; ch.row = 0; }
      if (performance.now() > deadline) return false;
    }
    while (ch.stage === 1) { // vertices, normals, colours
      const j = ch.row, r = j + 1, z = ch.z0 - j * DZ, zl = -j * DZ;
      const raised = streetRowRaised(ch, z);
      for (let i = 0; i < NC; i++) {
        const v = j * NC + i, x = XSF[i], ax = Math.abs(x);
        const h = ch.hgt[r * NC + i];
        const il = i > 0 ? i - 1 : i, ir = i < NC - 1 ? i + 1 : i;
        const dhdx = (ch.hgt[r * NC + ir] - ch.hgt[r * NC + il]) / (XSF[ir] - XSF[il]);
        const dhdz = (ch.hgt[(r - 1) * NC + i] - ch.hgt[(r + 1) * NC + i]) / (2 * DZ);
        let nx = -dhdx, ny = 1, nz = -dhdz; const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= nl; ny *= nl; nz *= nl;
        const g = Math.sqrt(dhdx * dhdx + dhdz * dhdz);
        const y = ax < 4.5 ? (raised ? Y_XING : Y_BAL) : h;
        ch.pos[v * 3] = x; ch.pos[v * 3 + 1] = y; ch.pos[v * 3 + 2] = zl;
        ch.nor[v * 3] = nx; ch.nor[v * 3 + 1] = ny; ch.nor[v * 3 + 2] = nz;
        colourAt(x, z, ax, h, g, ch.wet[v], ch.can[v], _col);
        ch.col[v * 3] = _col[0]; ch.col[v * 3 + 1] = _col[1]; ch.col[v * 3 + 2] = _col[2];
        ch.ext[v * 2] = ch.wet[v]; ch.ext[v * 2 + 1] = ch.can[v];
      }
      ch.row++;
      if (ch.row >= NRV) ch.stage = 2;
      if (performance.now() > deadline) return false;
    }
    if (ch.stage === 2) { // water patch (rows, sliced)
      if (!waterStep(ch, deadline)) return false;
      ch.stage = 3;
      if (performance.now() > deadline) return false;
    }
    if (ch.stage === 3) { // dressing
      writeDressing(ch);
      ch.stage = 4;
      if (performance.now() > deadline) return false;
    }
    if (ch.stage === 4) { // finalize
      const A = ch.geo.attributes;
      A.position.needsUpdate = true; A.normal.needsUpdate = true; A.color.needsUpdate = true; A.aExtra.needsUpdate = true;
      ch.geo.boundingSphere.center.set(0, ch.maxH * 0.5, -CH / 2);
      ch.geo.boundingSphere.radius = Math.sqrt(XMAX * XMAX + 25 * 25 + ch.maxH * ch.maxH * 0.25) + 2;
      ch.mesh.material = terrainMats[ch.wi];
      ch.mesh.visible = true;
      ch.stage = READY;
      stats.builds++;
    }
    return true;
  }

  // ------------------------------------------------------------------ dressing
  const inTun = (z, pad) => RR.inTunnel(z, pad);
  function writeDressing(ch) {
    const kind = kindOf(ch.wi), D = DRESS[ch.wi], z0 = ch.z0;
    // curbs (2.5 m blocks, both sides)
    const cb = (ch.bCurb = P_.curb.alloc(ch, 'bCurb'));
    const glow = kind === 'neon';
    const gb = glow ? (ch.bCurbGlow = P_.curbGlow.alloc(ch, 'bCurbGlow')) : -1;
    for (let s = 0; s < 20; s++) {
      const zc = z0 - (s + 0.5) * 2.5;
      if (inTun(zc, 3) || streetAt(zc, 1.3)) continue;
      const cc = D.curb[(((-zc / 2.5) | 0) % D.curb.length + D.curb.length) % D.curb.length];
      for (let side = 0; side < 2; side++) {
        const sx = side ? 1 : -1, j = s * 2 + side;
        if (cb >= 0) { P_.curb.set(cb, j, sx * 5.15, 0, zc, 0); P_.curb.color(cb, j, cc[0], cc[1], cc[2]); }
        if (gb >= 0) { P_.curbGlow.set(gb, j, sx * 5.03, 0, zc, 0); if (sx < 0) P_.curbGlow.color(gb, j, 0.22, 0.94, 1.0); else P_.curbGlow.color(gb, j, 1.0, 0.25, 0.82); }
      }
    }
    // cable troughs (left side, 5 m)
    const tb = (ch.bTrough = P_.trough.alloc(ch, 'bTrough'));
    for (let s = 0; s < 10 && tb >= 0; s++) {
      const zc = z0 - (s + 0.5) * 5;
      if (inTun(zc, 4) || streetAt(zc, 2.6)) continue;
      P_.trough.set(tb, s, -5.65, 0, zc, 0); P_.trough.color(tb, s, D.trough[0], D.trough[1], D.trough[2]);
    }
    // fences (5 m segments, both sides)
    const fp = P_.fence[kind] || P_.fence.city;
    const fb = (ch.bFence = fp.alloc(ch, 'bFence')); ch.fencePool = fp;
    const fg = glow ? (ch.bFenceGlow = P_.fenceGlow.alloc(ch, 'bFenceGlow')) : -1;
    for (let s = 0; s < 10 && fb >= 0; s++) {
      const zc = z0 - (s + 0.5) * 5;
      if (inTun(zc, 8) || streetAt(zc, 2.8)) continue;
      for (let side = 0; side < 2; side++) {
        const sx = side ? 1 : -1, j = s * 2 + side;
        fp.set(fb, j, sx * 6.3, 0, zc, side ? Math.PI : 0);
        if (fg >= 0) { P_.fenceGlow.set(fg, j, sx * 6.3, 0, zc, side ? Math.PI : 0); const m = ((-zc / 5) | 0) & 1; if (m) P_.fenceGlow.color(fg, j, 1.0, 0.25, 0.82); else P_.fenceGlow.color(fg, j, 0.22, 0.94, 1.0); }
      }
    }
    // signals, km posts, level crossings
    ch.bLamp = P_.lamp.alloc(ch, 'bLamp');
    const lb = ch.bLamp;
    let lj = 0;
    for (let m = Math.ceil(-z0 / 100); m * 100 < -z0 + CH; m++) { // km post at z = -m*100 (right) and dwarf signal at z = -m*100 - 50 (left)
      const zb = -m * 100;
      if (zb <= z0 && zb > z0 - CH && zb < -40 && !inTun(zb, 10) && !streetAt(zb, 3)) {
        const b = (ch.bBoard = P_.board.alloc(ch, 'bBoard'));
        if (b >= 0) {
          P_.board.set(b, 0, 6.05, 0, zb, 0);
          const hm = ((m % 100) + 100) % 100, cellX = (hm % 10) * 100 / 1024, cellY = 1 - (((hm / 10) | 0) + 1) * 50 / 512;
          const A = P_.board.mesh.geometry.attributes.aCell; A.setXY(b, cellX, cellY); A.needsUpdate = true;
        }
      }
    }
    for (let m = Math.ceil((-z0 - 50) / 100); m * 100 + 50 < -z0 + CH; m++) {
      const zd = -m * 100 - 50;
      if (zd <= z0 && zd > z0 - CH && zd < -60 && !inTun(zd, 10) && !streetAt(zd, 3)) {
        const b = (ch.bDwarf = P_.dwarf.alloc(ch, 'bDwarf'));
        if (b >= 0) {
          P_.dwarf.set(b, 0, -6.05, 0, zd, 0);
          const green = hashU(m, 5) < 0.7;
          if (lb >= 0 && lj < 6) { P_.lamp.set(lb, lj, -6.05, green ? 0.47 : 0.25, zd + 0.118, 0); if (green) P_.lamp.color(lb, lj, 0.3, 1.0, 0.45); else P_.lamp.color(lb, lj, 1.0, 0.72, 0.2); lj++; }
        }
      }
    }
    // tall signal masts every 200 m (offset 20 m), alternating sides
    for (let m = Math.ceil((-z0 - 20) / 200); m * 200 + 20 < -z0 + CH; m++) {
      const zm = -m * 200 - 20;
      if (zm <= z0 && zm > z0 - CH && zm < -150 && !inTun(zm, 50) && !streetAt(zm, 12)) {
        const b = (ch.bMast = P_.mast.alloc(ch, 'bMast'));
        if (b >= 0) {
          const sx = m & 1 ? -1 : 1;
          P_.mast.set(b, 0, sx * 6.8, 0, zm, 0);
          ch.mastZ = zm; ch.mastSide = sx; ch.mastRed = false; ch.mastLamp = lj;
          if (lb >= 0 && lj < 6) { P_.lamp.set(lb, lj, sx * 6.8, 4.72, zm + 0.124, 0, 1.3); P_.lamp.color(lb, lj, 0.3, 1.0, 0.45); lj++; }
        }
      }
    }
    // city level crossing (street band centred mid-chunk)
    ch.hasXing = false;
    if (kind === 'city') {
      const rel0 = -z0 - ch.k * C.WORLD_LEN, relC = 125 + 250 * Math.ceil((rel0 - 125) / 250);
      const zc = -(ch.k * C.WORLD_LEN + relC);
      if (relC >= rel0 && relC < rel0 + CH) {
        const b = (ch.bXing = P_.xing.alloc(ch, 'bXing'));
        if (b >= 0) {
          ch.hasXing = true; ch.xingZ = zc; ch.xingLamp = lj;
          P_.xing.set(b, 0, 7.2, 0, zc + STREET_HALF + 1.3, 0.75);
          P_.xing.set(b, 1, -7.2, 0, zc + STREET_HALF + 1.3, -0.75);
          for (let s = 0; s < 2; s++) {
            const sx = s ? -1 : 1, ry = s ? -0.75 : 0.75, cz = Math.cos(ry), sz = Math.sin(ry);
            for (let q = 0; q < 2; q++) {
              const lx = q ? 0.36 : -0.36, lz = 0.096;
              if (lb >= 0 && lj < 6) { P_.lamp.set(lb, lj, sx * 7.2 + lx * cz + lz * sz, 2.28, zc + STREET_HALF + 1.3 - lx * sz + lz * cz, ry, 1.8); P_.lamp.color(lb, lj, 0.2, 0.04, 0.04); lj++; }
            }
          }
          ch.lampPhase = -1;
        }
      }
    }
  }

  function writeSleepers(ch) {
    const D = DRESS[ch.wi], pool = P_.sleep[D.style] || P_.sleep.wood;
    const b = pool.alloc(ch, 'bSleep');
    if (b < 0) return;
    ch.bSleep = b; ch.sleepPool = pool; ch.near = true;
    for (let i = 0; i < 64; i++) {
      const z = ch.z0 - (i + 0.5) * S_SLEEP;
      if (streetAt(z, 0.2)) continue;
      for (let t = 0; t < 3; t++) {
        const h1 = hashU(ch.c * 64 + i, t + 1), h2 = hashU(ch.c * 64 + i, t + 7);
        const j = i * 3 + t;
        pool.set(b, j, C.LANES[t], 0, z + (h1 - 0.5) * 0.03, (h2 - 0.5) * 0.02);
        let tc = D.sleeper;
        if (!tc) tc = CANDY_SLEEPER_TINTS[(i + t * 2 + ch.c * 3) & 3];
        const v = 0.92 + h1 * 0.16;
        pool.color(b, j, tc[0] * v, tc[1] * v, tc[2] * v);
      }
    }
  }
  function writePlates(ch) {
    const b = P_.plate.alloc(ch, 'bPlate');
    if (b < 0) return;
    ch.bPlate = b; ch.plates = true;
    for (let i = 0; i < 64; i++) {
      const z = ch.z0 - (i + 0.5) * S_SLEEP;
      if (streetAt(z, 0.2)) continue;
      for (let t = 0; t < 3; t++) {
        const h1 = hashU(ch.c * 64 + i, t + 1);
        P_.plate.set(b, i * 3 + t, C.LANES[t], 0, z + (h1 - 0.5) * 0.03, 0);
      }
    }
  }

  function releaseChunk(ch) {
    ch.live = false; ch.stage = -1; ch.mesh.visible = false;
    if (ch.sleepPool) ch.sleepPool.free(ch.bSleep); ch.bSleep = -1; ch.sleepPool = null; ch.near = false;
    P_.plate.free(ch.bPlate); ch.bPlate = -1; ch.plates = false;
    P_.curb.free(ch.bCurb); ch.bCurb = -1;
    P_.curbGlow.free(ch.bCurbGlow); ch.bCurbGlow = -1;
    P_.trough.free(ch.bTrough); ch.bTrough = -1;
    if (ch.fencePool) ch.fencePool.free(ch.bFence); ch.bFence = -1; ch.fencePool = null;
    P_.fenceGlow.free(ch.bFenceGlow); ch.bFenceGlow = -1;
    P_.dwarf.free(ch.bDwarf); ch.bDwarf = -1;
    P_.mast.free(ch.bMast); ch.bMast = -1;
    P_.xing.free(ch.bXing); ch.bXing = -1; ch.hasXing = false;
    P_.lamp.free(ch.bLamp); ch.bLamp = -1;
    P_.board.free(ch.bBoard); ch.bBoard = -1;
    waterFree(ch.wSlot); ch.wSlot = -1;
    const qi = queue.indexOf(ch); if (qi >= 0) removeAt(queue, qi);
  }
  function removeAt(arr, i) { for (let k = i + 1; k < arr.length; k++) arr[k - 1] = arr[k]; arr.length--; } // splice without the result array

  function commitAll() {
    const S = P_.sleep;
    S.wood.commit(); S.concrete.commit(); S.candy.commit(); S.frost.commit();
    P_.plate.commit(); P_.curb.commit(); P_.curbGlow.commit(); P_.trough.commit(); P_.fenceGlow.commit();
    P_.dwarf.commit(); P_.mast.commit(); P_.xing.commit(); P_.lamp.commit(); P_.board.commit();
    for (let i = 0; i < P_.fenceList.length; i++) P_.fenceList[i].commit();
    waterCommit();
  }

  // ------------------------------------------------------------------ streaming
  const _fwd = new THREE.Vector3();
  let covAhead = 560, covBehind = 60, covBack = false;
  const range = { near: 115, plates: 36 };
  function coverage(pz, titleReset, atReset) {
    const fogFar = scene && scene.fog && scene.fog.far ? scene.fog.far : C.FOG_FAR;
    covAhead = Math.min(900, Math.max(C.SPAWN_AHEAD, fogFar) + 40);
    let back = false;
    if (titleReset) back = true;
    else if (camera) { camera.getWorldDirection(_fwd); back = _fwd.z > -0.35 || (!atReset && camera.position.z < pz - 1); }
    covBehind = back ? Math.min(covAhead, fogFar + 40) : C.DESPAWN_BEHIND + 20;
    covBack = back;
    SU.uRise.value.set(fogFar * 0.97, fogFar + 45);
  }
  function findChunk(c) { for (let i = 0; i < active.length; i++) if (active[i].c === c) return active[i]; return null; }
  function acquire() { for (let i = 0; i < chunks.length; i++) if (!chunks[i].live) return chunks[i]; return null; }

  function stream(pz, sync) {
    const cMin = Math.floor(-(pz + covBehind) / CH), cMax = Math.floor(-(pz - covAhead) / CH);
    // release
    for (let i = active.length - 1; i >= 0; i--) {
      const ch = active[i];
      if (ch.c < cMin || ch.c > cMax) { releaseChunk(ch); removeAt(active, i); }
    }
    // acquire missing (nearest first)
    const cPl = Math.floor(-pz / CH);
    for (let d = 0; d <= Math.max(cMax - cPl, cPl - cMin); d++) {
      for (let s = 0; s < 2; s++) {
        const c = s ? cPl - d : cPl + d;
        if (s && d === 0) continue;
        if (c < cMin || c > cMax || findChunk(c)) continue;
        const ch = acquire();
        if (!ch) continue;
        chunkStart(ch, c);
        active.push(ch);
        if (sync) buildStep(ch, Infinity); else queue.push(ch);
      }
    }
    // near-range sleepers / plates (at most one block written per frame unless syncing)
    let writes = sync ? 1e9 : 1;
    for (let i = 0; i < active.length; i++) {
      const ch = active[i];
      if (ch.stage !== READY) continue;
      const zN = ch.z0, zF = ch.z0 - CH;
      const back = covBehind > 100;
      const wantNear = zF < pz + (back ? range.near : 25) && zN > pz - range.near;
      if (wantNear && !ch.near) { if (writes-- > 0) writeSleepers(ch); }
      else if (!wantNear && ch.near) { ch.sleepPool.free(ch.bSleep); ch.bSleep = -1; ch.sleepPool = null; ch.near = false; }
      const wantPl = range.plates > 0 && zF < pz + (back ? range.plates : 10) && zN > pz - range.plates;
      if (wantPl && !ch.plates) { if (writes-- > 0) writePlates(ch); }
      else if (!wantPl && ch.plates) { P_.plate.free(ch.bPlate); ch.bPlate = -1; ch.plates = false; }
    }
  }

  function processQueue(budgetMs) {
    const t0 = performance.now(), deadline = t0 + budgetMs;
    while (queue.length) {
      const ch = queue[0];
      const s0 = performance.now(), st = ch.stage;
      const done = buildStep(ch, deadline);
      const dt = performance.now() - s0;
      if (dt > stats.maxStepMs) stats.maxStepMs = dt;
      if (dt > stats.stageMax[st]) stats.stageMax[st] = dt;
      if (done) queue.shift();
      if (performance.now() >= deadline) break;
    }
    stats.buildMs = performance.now() - t0;
  }

  // ------------------------------------------------------------------ signal animation
  function animateSignals(frame) {
    const pz = frame.pz, t = frame.t || 0;
    for (let i = 0; i < active.length; i++) {
      const ch = active[i];
      if (ch.stage !== READY || ch.bLamp < 0) continue;
      if (ch.bMast >= 0 && !ch.mastRed && pz < ch.mastZ - 1) { // passed: the block signal behind the runner turns red
        ch.mastRed = true;
        P_.lamp.set(ch.bLamp, ch.mastLamp, ch.mastSide * 6.8, 4.12, ch.mastZ + 0.124, 0, 1.3);
        P_.lamp.color(ch.bLamp, ch.mastLamp, 1.0, 0.16, 0.12);
      }
      if (ch.hasXing && ch.xingZ < pz + 30 && ch.xingZ > pz - 320) {
        const ph = Math.floor(t * 2.4) & 1;
        if (ph !== ch.lampPhase) {
          ch.lampPhase = ph;
          for (let q = 0; q < 4; q++) {
            const on = (q & 1) === ph;
            P_.lamp.color(ch.bLamp, ch.xingLamp + q, on ? 1.0 : 0.22, on ? 0.12 : 0.03, on ? 0.08 : 0.03);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ per-frame uniforms
  function updateUniforms(frame) {
    SU.uTime.value = frame.t || 0;
    SU.uGlow.value = RR.mats && RR.mats.glow ? Math.max(1, RR.mats.glow.color.r) : 1;
    const A = RR.atmo;
    if (A) { SU.uSkyTop.value.copy(A.skyTop); SU.uSkyMid.value.copy(A.skyMid); SU.uHorizon.value.copy(A.horizon); SU.uSunCol.value.copy(A.sun); }
    if (RR.sky && RR.sky.sunDir && RR.sky.sunDir.lengthSq() > 0.5) SU.uSunDir.value.copy(RR.sky.sunDir);
    setOrigin(frame.pz);
  }
  function setOrigin(pz) {
    const oz = pz < 0 ? Math.round(pz / ORIGIN_STEP) * ORIGIN_STEP : 0;
    SU.uOrigin.value.set(0, 0, oz);
    SU.uOriginK.value = -oz / C.WORLD_LEN;
  }

  // ------------------------------------------------------------------ lifecycle
  function init(ctx) {
    if (inited) return;
    scene = ctx.scene; camera = ctx.camera; renderer = ctx.renderer; quality = ctx.quality || RR.quality || RR.QUALITY.high;
    RR.getMats();
    const t0 = performance.now();
    // textures (built once, per world kind)
    const tm = (stats.texMs = {}), tt = (name, fn) => { const a = performance.now(); const r = fn(); tm[name] = +(performance.now() - a).toFixed(1); return r; };
    TEX.gravel = tt('gravel', makeGravelTex);
    TEX.strip = {}; TEX.detail = {};
    const kinds = []; WORLDS.forEach((w) => { if (kinds.indexOf(w.kind) < 0) kinds.push(w.kind); });
    kinds.forEach((k, i) => { TEX.strip[k] = tt('strip-' + k, () => makeStripTex(k)); TEX.detail[k] = tt('detail-' + k, () => makeDetailTex(k, 101 + i * 37)); });
    TEX.wnrm = tt('wnrm', makeWaterNormalTex); TEX.wnoise = tt('wnoise', makeWaterNoiseTex);
    TEX.sleeper = { wood: makeSleeperTex('wood'), frost: makeSleeperTex('frost'), concrete: makeSleeperTex('concrete'), candy: makeSleeperTex('candy') };
    boardTex = TEX.board = tex(1024, 512, drawBoards, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping);
    try {
      if (document.fonts && document.fonts.load) document.fonts.load('34px "Lilita One"').then(() => { drawBoards(boardTex.image.getContext('2d'), 1024, 512); boardTex.needsUpdate = true; }).catch(() => {});
    } catch (e) { /* fonts API unavailable */ }
    // materials (built once, per world)
    terrainMats = [];
    for (let i = 0; i < NW; i++) terrainMats.push(makeTerrainMat(i));
    const sm = (map) => { const m = new THREE.MeshLambertMaterial({ map: map || null, vertexColors: true }); m.onBeforeCompile = simpleCompile; m.customProgramCacheKey = () => 'rr-simple' + (map ? 'M' : ''); return m; };
    sleeperMats = { wood: sm(TEX.sleeper.wood), frost: sm(TEX.sleeper.frost), concrete: sm(TEX.sleeper.concrete), candy: sm(TEX.sleeper.candy), plain: sm(null) };
    railMat = new THREE.MeshPhongMaterial({ vertexColors: true, color: 0x80808a, specular: 0x9a9aa0, shininess: 80 });
    railMat.userData.u = {};
    for (let i = 0; i < 5; i++) { const k = WORLDS[i % NW].kind; railMat.userData.u['uRT' + i] = { value: new THREE.Color(RAIL_TINT_BY_KIND[k] || 0xffffff) }; }
    railMat.userData.u.uCandyIdx = { value: WORLDS.findIndex((w) => w.kind === 'candy') };
    railMat.userData.u.uNeonIdx = { value: WORLDS.findIndex((w) => w.kind === 'neon') };
    railMat.userData.u.uRailZ = { value: 0 };
    railMat.onBeforeCompile = railCompile; railMat.customProgramCacheKey = () => 'rr-rail';
    waterMat = makeWaterMat();
    boardMat = new THREE.MeshLambertMaterial({ map: boardTex, vertexColors: true });
    boardMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_UV\nvUv = uv.x < -0.5 ? vec2(0.99, 0.5) : aCell + uv * vec2(0.09765625, 0.09765625);\n#endif');
    };
    boardMat.customProgramCacheKey = () => 'rr-board';
    // geometry + pools
    buildSharedIndex();
    for (let i = 0; i < MAX_CHUNKS; i++) chunks.push(makeChunk(i));
    buildPools();
    buildWater();
    railMesh = new THREE.Mesh(buildRailGeo(), railMat);
    railMesh.name = 'track-rails';
    railMesh.receiveShadow = true;
    railMesh.frustumCulled = false; // always in view; the draw range limits it to the visible window
    root.add(railMesh);
    scene.add(root);
    stats.initMs = performance.now() - t0;
    inited = true;
    setQuality(quality);
  }

  function reset(pz) {
    if (!inited) return;
    pz = pz || 0;
    for (let i = 0; i < active.length; i++) releaseChunk(active[i]);
    active.length = 0; queue.length = 0;
    setOrigin(pz);
    coverage(pz, false, true);
    const t0 = performance.now();
    stream(pz, true);
    stream(pz, true); // second pass writes near-range sleepers for the freshly built chunks
    commitAll();
    stats.resetMs = performance.now() - t0;
    placeRails(pz);
  }

  function update(dt, frame) {
    if (!inited || !frame) return;
    const t0 = performance.now();
    const pz = frame.pz;
    updateUniforms(frame);
    coverage(pz, false);
    const s0 = performance.now();
    stream(pz, false);
    const sd = performance.now() - s0; if (sd > stats.streamMax) stats.streamMax = sd;
    processQueue(TRACK_BUDGET_MS);
    animateSignals(frame);
    commitAll();
    placeRails(pz);
    stats.chunks = active.length; stats.queue = queue.length;
    stats.lastFrameMs = performance.now() - t0;
  }

  function setQuality(q) {
    if (!q) return;
    const prevLow = quality && quality.name === 'low';
    quality = q;
    if (!inited) return;
    const low = q.name === 'low';
    range.near = low ? 80 : 115; range.plates = low ? 0 : 36;
    if (P_) { P_.trough.hidden = low; P_.plate.hidden = low; }
    waterMat.uniforms.uWaves.value = low ? 0 : 1;
    if (low) waterMat.defines.RR_LOW = 1; else delete waterMat.defines.RR_LOW;
    if (prevLow !== low) { waterMat.needsUpdate = true; terrainMats.forEach((m) => (m.needsUpdate = true)); }
  }

  // ------------------------------------------------------------------ public queries
  // Exact rendered terrain height (triangle interpolation of the chunk grid). 0 inside |x| < 18.
  function heightAt(x, z) {
    const ax = Math.abs(x);
    if (!(ax >= FLAT)) return 0;
    if (ax >= XMAX) return Hv(x < 0 ? -XMAX : XMAX, z);
    // column
    let lo = 0, hi = NC - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (XSF[m] <= x) lo = m; else hi = m; }
    const i = lo;
    const fx = (x - XSF[i]) / (XSF[i + 1] - XSF[i]);
    // row (global rows at z = -m * DZ)
    const rz = -z / DZ, m = Math.floor(rz), fz = rz - m;
    const zA = -m * DZ, zB = -(m + 1) * DZ;
    let h00, h10, h01, h11;
    const c = Math.floor(-zA / CH + 1e-9), ch = findChunk(c);
    const j = m - c * NRQ;
    if (ch && ch.stage >= 1 && j >= 0 && j < NRQ) {
      const r = j + 1;
      h00 = ch.hgt[r * NC + i]; h10 = ch.hgt[r * NC + i + 1]; h01 = ch.hgt[(r + 1) * NC + i]; h11 = ch.hgt[(r + 1) * NC + i + 1];
    } else {
      h00 = Hv(XSF[i], zA); h10 = Hv(XSF[i + 1], zA); h01 = Hv(XSF[i], zB); h11 = Hv(XSF[i + 1], zB);
    }
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  // Water surface level at (x, z) if there is visible water there, else null.
  function waterAt(x, z) {
    const k = Math.floor(Math.max(0, -z) / C.WORLD_LEN), kind = kindOf(k % NW), rel = -z - k * C.WORLD_LEN;
    let level = null;
    if (kind === 'beach' && x < -FLAT && rel > 60 && rel < 940) level = SEA_L;
    else if (kind === 'candy' && x > FLAT && rel > 62 && rel < 938) level = RIV_L;
    else if (kind === 'neon' && x < -FLAT && rel > 70 && rel < 930) level = CAN_L;
    else if (kind === 'snow' && x < -FLAT) level = LAKE_L;
    if (level === null) return null;
    return heightAt(x, z) < level - 0.01 ? level : null;
  }

  // True when a tall trackside item (signal mast, crossbuck) stands within r metres of (x, z).
  function reservedAt(x, z, r) {
    r = r || 0;
    const ax = Math.abs(x);
    if (ax > 8.2 + r) return false;
    const zm = Math.round((-z - 20) / 200) * 200 + 20; // masts at -m*200 - 20
    if (Math.abs(-z - zm) < 1.2 + r && ax > 6.2 - r) return true;
    return streetAt(z, 2.5 + r) && ax > 6.2 - r;
  }

  const api = {
    init, reset, update, setQuality, heightAt, waterAt,
    streetAt: (z, pad) => streetAt(z, pad || 0),
    reservedAt,
    setTunnelShade: (v) => { SU.uTunnelK.value = RR.clamp(v, 0, 1); },
    SURF: { BALLAST_Y: Y_BAL, SLEEPER_Y: Y_SLP, RAIL_Y: Y_RAIL, GAUGE, RAIL_X: C.LANES.map((l) => [l - GAUGE, l + GAUGE]), SLEEPER_SPACING: S_SLEEP },
    WATER_LEVELS: { sea: SEA_L, river: RIV_L, canal: CAN_L, lake: LAKE_L },
    stats,
    info() { return { texMs: stats.texMs, chunks: active.length, queue: queue.length, buildMs: stats.buildMs, maxStepMs: stats.maxStepMs, stageMax: stats.stageMax.map((v) => +v.toFixed(2)), streamMax: +stats.streamMax.toFixed(2), lastFrameMs: stats.lastFrameMs, initMs: stats.initMs, resetMs: stats.resetMs, builds: stats.builds, railSlabs: stats.railSlabs }; },
    group: root
  };
  RR.register('track', api);
})(window.RR);
