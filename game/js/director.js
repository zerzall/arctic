/* Rainbow Rails — obstacle director (js/director.js)
 *
 * Pure data: no THREE, no DOM. Generates the run ahead of the player in chunks:
 *   pattern library -> placed at the speed the player will have there -> lane x time grid ->
 *   fairness search from every entry lane (at most ONE search per next() call) ->
 *   coins and a pickup laid on the search's witness path.
 * Ported from the fuzz-verified gameplay prototype (proto/director.js + proto/dp.js) and retuned to the
 * v2 hit shapes in RR.C (bars are roll-only, roof landing needs feet >= TRAIN_KILL_Y while falling ...).
 *
 * Guarantee: from every entry lane of every chunk there is an input sequence with inputs >= 0.30 s apart
 * that survives with +-0.12 s of timing slack (plus 0.25 m / 0.12 m of spare) and ends ready (grounded,
 * settled, not rolling) in one of the chunk's exit lanes; the next chunk is validated from all of those.
 * All randomness comes from RR.makeRng(seed): a run is reproducible from opts.seed.
 */
(function (RR) {
  'use strict';
  if (!RR || !RR.C) return;
  const C = RR.C;
  const speedAt = RR.speedAt;
  const TRAIN_H = C.TRAIN_H, G = C.G, JUMP_V = C.JUMP_V, CAR_L = C.CAR_L, RAMP_L = C.RAMP_L, VZ = C.ONCOMING_VZ, HD = C.HALF_D;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // ------------------------------------------------------------------ fairness model (seconds / metres)
  const FAIR = Object.freeze({
    TAU: 1 / 20, // search tick
    ACT: 0.30, // min time between two inputs on the safe path (human input cadence)
    LANE_BOTH: 0.12, // after a lane input the body counts as being in BOTH lanes this long
    MZ: 0.25, // extra z margin around every hazard
    MY: 0.12, // extra y margin around every hazard
    SLACK: 0.12, // s of input-timing slack: static hazards grow by SLACK x speed in z
    ROOF_LAND: C.TRAIN_KILL_Y + 0.05, // a train body reaches this high; + MY is needed to be above / land on it
    RAMP_STEP: 1.0, // the feet can step onto a ramp surface at most this far above them
    TAIL: 0.65, // empty seconds after a chunk's last row (a forced jump 0.6 s / roll 0.62 s is over)
    LEAD_IN: 60, // nothing within this many metres of the player at run start / after clearAhead
    MAX_REJECT: 6, // after this many failed searches for one chunk a breather is emitted
    MOVER_GAP: C.SPAWN_AHEAD, // an oncoming train is created this far ahead of the player (see moverZ)
    MOVER_MIN_DIST: 400, // no oncoming trains in the first 400 m (of normal generation)
    PICKUP_MIN_DIST: 200, // no pickups in the first 200 m of a run
    PICKUP_SPACING: 260, // metres between two pickups at least
    PICKUP_CHANCE: 0.6,
    JETPACK_MIN_DIST: 300,
    JETPACK_TUNNEL_CLEAR: 400, // no jetpack pickup if a tunnel entrance lies within this many metres ahead
    COIN_SPACING: 2.2
  });
  // Tunnel zones around every world boundary B = -k * WORLD_LEN (k >= 1); the tunnel spans B +- TUNNEL_HALF.
  const ZONE = Object.freeze({
    CALM_OUT: 30, // portal calm: no hazards from 30 m outside a portal ...
    CALM_IN: 20, // ... to 20 m inside it (breathers only)
    TRAIN_ENTRY: 40, // no trains / ramps / oncoming trains from 40 m before the entrance ...
    TRAIN_EXIT: 30, // ... to 30 m after the exit
    MOVER_BEHIND: 40 // an oncoming train keeps going this far past its meeting point before it despawns
  });
  const BODY = C.BODY_H, BODY_ROLL = C.BODY_ROLL_H, MY = FAIR.MY;
  // hazard kinds (bit masks in the grid) and the y-range [lo, hi) the body must not overlap
  const HZ_HURDLE = 1, HZ_BAR = 2, HZ_BLOCK = 4, HZ_TRAIN = 8;
  const HZ_TAIL = 16; // a train's slack-widened rear only (the body is entirely behind the runner): a train hazard,
  // except for a runner who just walked off that very roof in that lane (falls off the real rear, cannot touch it)
  const HZ_LO = new Float64Array([0, C.BAR_BOTTOM, 0, 0]);
  const HZ_HI = new Float64Array([C.HURDLE_CLEAR, C.BAR_TOP, C.BLOCK_TOP, FAIR.ROOF_LAND]);
  const ACTIONS = ['none', 'jump', 'roll', 'left', 'right'];

  // ------------------------------------------------------------------ pattern library
  // Rows are listed nearest-first; one char per lane (left, middle, right). One row = one "beat".
  //  .  empty      h hurdle (jump)    b overhead bar (roll)    k block (change lane)
  //  T  static train (consecutive T rows in a lane = one train)   R ramp onto the T run right after it
  //  M  oncoming train (meets the player on its first row; consecutive M rows = its length in beats)
  // perm: allowed lane permutations ('mirror' = as written or mirrored, 'any' = all 6, 'none')
  // tier: first difficulty tier that may use it; w: base weight; tags: for missions / debugging
  const PATTERNS = [
    // tier 0 — single reads
    { id: 'hurdle', tier: 0, w: 1, perm: 'any', rows: ['.h.'] },
    { id: 'bar', tier: 0, w: 1, perm: 'any', rows: ['.b.'] },
    { id: 'block', tier: 0, w: 0.7, perm: 'any', rows: ['.k.'] },
    { id: 'train-short', tier: 0, w: 1, perm: 'any', rows: ['.T.', '.T.'] },
    { id: 'hurdle-pair', tier: 0, w: 0.8, perm: 'any', rows: ['hh.'] },
    { id: 'hurdle-row', tier: 0, w: 0.6, perm: 'none', rows: ['hhh'] },
    { id: 'bar-row', tier: 0, w: 0.45, perm: 'none', rows: ['bbb'] },
    // tier 1 — two things at once
    { id: 'jump-or-roll', tier: 1, w: 1, perm: 'any', rows: ['h.b'] },
    { id: 'bar-pair', tier: 1, w: 0.8, perm: 'any', rows: ['bb.'] },
    { id: 'twin-trains', tier: 1, w: 1, perm: 'none', rows: ['T.T', 'T.T', 'T.T'] },
    { id: 'ramp-up', tier: 1, w: 1.2, perm: 'any', rows: ['R..', 'T..', 'T..', 'T..'], tags: ['roof'] },
    { id: 'train-hurdle', tier: 1, w: 1, perm: 'any', rows: ['T..', 'Th.', 'T..'] },
    { id: 'stagger', tier: 1, w: 1, perm: 'mirror', rows: ['h..', '.b.', '..h'] },
    { id: 'hurdle-bar', tier: 1, w: 0.8, perm: 'any', rows: ['h..', '...', 'b..'] },
    { id: 'weave', tier: 1, w: 0.8, perm: 'mirror', rows: ['h.b', '...', 'b.h'] },
    { id: 'oncoming', tier: 1, w: 0.7, perm: 'any', rows: ['..M', '..M'], tags: ['mover'] },
    // tier 2 — sequences
    { id: 'corridor', tier: 2, w: 1, perm: 'none', rows: ['T.T', 'ThT', 'T.T', 'TbT', 'T.T'] },
    { id: 'wall-ramp', tier: 2, w: 1, perm: 'mirror', rows: ['...', 'RTT', 'TTT', 'TTT'], tags: ['roof'] },
    { id: 'ramp-pair', tier: 2, w: 0.8, perm: 'none', rows: ['R.R', 'T.T', 'T.T', 'T.T'], tags: ['roof'] },
    { id: 'shift-left', tier: 2, w: 0.9, perm: 'mirror', rows: ['.kk', '...', 'kk.'] },
    { id: 'roof-run', tier: 2, w: 1, perm: 'mirror', rows: ['R.h', 'T..', 'T.b', 'T..', 'T.h'], tags: ['roof'] },
    { id: 'all-act', tier: 2, w: 0.8, perm: 'mirror', rows: ['hbh', '...', 'bhb'] },
    { id: 'steps', tier: 2, w: 0.7, perm: 'mirror', rows: ['h..', 'h.h', '..h'] },
    { id: 'mover-by-train', tier: 2, w: 0.8, perm: 'mirror', rows: ['T.M', 'T.M', 'T..'], tags: ['mover'] },
    // tier 3 — reading ahead
    { id: 'roof-hop', tier: 3, w: 1, perm: 'mirror', rows: ['R..', 'T.h', 'T..', '..b', 'T..', 'T.k'], tags: ['roof'] },
    { id: 'chicane', tier: 3, w: 1, perm: 'mirror', rows: ['T.k', 'T..', '...', '.kT', '..T', 'k.T'] },
    { id: 'mover-corridor', tier: 3, w: 0.9, perm: 'mirror', rows: ['M.T', 'M.T', '..T', '.hT'], tags: ['mover'] },
    { id: 'mover-ramp', tier: 3, w: 0.8, perm: 'mirror', rows: ['R.M', 'T.M', 'T..', 'T..'], tags: ['roof', 'mover'] },
    { id: 'slalom', tier: 3, w: 0.8, perm: 'mirror', rows: ['k..', '.h.', '..k', '.b.', 'k..'] },
    { id: 'triple', tier: 3, w: 0.8, perm: 'none', rows: ['hhh', '...', 'bbb', '...', 'hkh'] },
    // tier 4 — peak
    { id: 'double-mover', tier: 4, w: 0.8, perm: 'none', rows: ['M.M', 'M.M', '.h.', '.b.'], tags: ['mover'] },
    { id: 'gauntlet', tier: 4, w: 1, perm: 'mirror', rows: ['...', 'RTT', 'TTT', 'TTb', 'T.T', 'TkT', 'T.T'], tags: ['roof'] },
    { id: 'zigzag', tier: 4, w: 1, perm: 'mirror', rows: ['T..', 'T.T', '..T', 'T.T', 'T..'] }
  ];
  PATTERNS.forEach((p) => {
    const s = p.rows.join('');
    p.mover = s.indexOf('M') >= 0;
    p.trains = /[TRM]/.test(s);
    p.tunnelSafe = /^[.hb]*$/.test(s); // hurdles / bars only: allowed inside tunnels
    p.tags = p.tags || [];
    Object.freeze(p.rows);
  });
  const NP = PATTERNS.length;
  const PERMS = { none: [[0, 1, 2]], mirror: [[0, 1, 2], [2, 1, 0]], any: [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] };

  // ------------------------------------------------------------------ tutorial (first run)
  // Scripted chunks (validated by the same fairness search), then normal generation from difficulty 0.
  // zAct = z of the thing the action is for (hurdle / bar / train front, ramp foot, first coin, pickup);
  // lane = the lane whose obstacle defines zAct; end = preferred lane of the witness path at the chunk end.
  const TUTORIAL = [
    { id: 'tut-jump', action: 'jump', rows: ['hhh'], lead: 1.4, lane: 1, end: 1, label: 'Jump!', hint: { key: '↑ or Space to jump', touch: 'Swipe up to jump' } },
    { id: 'tut-roll', action: 'roll', rows: ['bbb'], lead: 1.9, lane: 1, end: 1, label: 'Roll!', hint: { key: '↓ or S to roll', touch: 'Swipe down to roll' } },
    { id: 'tut-left', action: 'left', rows: ['.TT', '.TT'], lead: 1.9, lane: 1, end: 0, label: 'Dodge left!', hint: { key: '← or A to move left', touch: 'Swipe left to change lanes' } },
    { id: 'tut-right', action: 'right', rows: ['T.T', 'T.T'], lead: 1.9, lane: 0, end: 1, label: 'Dodge right!', hint: { key: '→ or D to move right', touch: 'Swipe right to change lanes' } },
    { id: 'tut-ramp', action: 'ramp', rows: ['.R.', 'TTT', 'TTT', 'TTT'], lead: 1.9, lane: 1, end: 1, label: 'Ramp!', hint: { key: 'Run up the ramp to ride the roofs', touch: 'Run up the ramp to ride the roofs' } },
    { id: 'tut-coins', action: 'coins', rows: ['...', '...', '...'], lead: 1.3, lane: 1, end: 1, label: 'Coins!', coins: 'trail', hint: { key: 'Grab the coins!', touch: 'Grab the coins!' } },
    { id: 'tut-magnet', action: 'magnet', rows: ['...', '...', '...', '...'], lead: 1.1, lane: 1, end: 1, label: 'Magnet!', coins: 'carpet', pickup: 'magnet', hint: { key: 'Magnets pull in every coin nearby', touch: 'Magnets pull in every coin nearby' } }
  ];
  TUTORIAL.forEach((s) => { Object.freeze(s.rows); Object.freeze(s.hint); });

  // ------------------------------------------------------------------ difficulty
  function difficulty(dEff, dAbs, out) {
    const D = 1 - Math.exp(-Math.max(0, dEff) / 2600); // 0.32 @1 km, 0.54 @2 km, 0.79 @4 km
    const L = C.WORLD_LEN, phase = (((dAbs % L) + L) % L) / L; // position inside the current world
    out.D = D;
    out.tierMax = D < 0.06 ? 0 : D < 0.22 ? 1 : D < 0.45 ? 2 : D < 0.68 ? 3 : 4;
    out.beat = lerp(0.62, 0.40, D); // seconds per pattern row
    out.lead = lerp(0.60, 0.50, D); // empty seconds before a chunk's first row
    out.peak = phase > 0.7 && phase < 0.9;
    out.breatherEvery = 7;
    return out;
  }

  // ------------------------------------------------------------------ arrival time (speed depends only on distance)
  // Seconds the player needs from zFrom to zTo (negative when zTo lies behind zFrom). Simpson on 1/speedAt.
  function timeBetween(zFrom, zTo) {
    const d0 = -zFrom, d1 = -zTo;
    if (d0 === d1) return 0;
    const n = Math.max(2, 2 * Math.ceil(Math.abs(d1 - d0) / 60)), h = (d1 - d0) / n;
    let s = 1 / speedAt(d0) + 1 / speedAt(d1);
    for (let i = 1; i < n; i++) s += (i & 1 ? 4 : 2) / speedAt(d0 + i * h);
    return (s * h) / 3;
  }
  // Front z of an oncoming train (item with vz, meetZ) at the moment the player's feet are at pz.
  function moverZ(item, pz) { return item.meetZ - item.vz * timeBetween(pz, item.meetZ); }
  // Player z at which an oncoming train meeting at meetZ is exactly `gap` metres ahead of the player.
  function moverSpawnPz(meetZ, gap) {
    const v = speedAt(-meetZ);
    let pz = meetZ + (gap * v) / (v + VZ);
    for (let it = 0; it < 5; it++) {
      const g = pz - meetZ + VZ * timeBetween(pz, meetZ) - gap;
      pz -= g / (1 + VZ / speedAt(-pz));
      if (Math.abs(g) < 1e-6) break;
    }
    return pz;
  }

  // ------------------------------------------------------------------ tunnel zones
  // kind 1: no trains / ramps / oncoming trains; 2: portal calm (no hazards at all); 3: tunnel interior (no blocks)
  function zoneHit(zHi, zLo, kind) {
    const L = C.WORLD_LEN, H = C.TUNNEL_HALF;
    const k0 = Math.max(1, Math.floor((-zHi - 200) / L)), k1 = Math.ceil((-zLo + 200) / L);
    for (let k = k0; k <= k1; k++) {
      const B = -k * L;
      if (kind === 1) { if (zHi > B - H - ZONE.TRAIN_EXIT && zLo < B + H + ZONE.TRAIN_ENTRY) return true; }
      else if (kind === 2) {
        if (zHi > B + H - ZONE.CALM_IN && zLo < B + H + ZONE.CALM_OUT) return true;
        if (zHi > B - H - ZONE.CALM_OUT && zLo < B - H + ZONE.CALM_IN) return true;
      } else if (zHi > B - H && zLo < B + H) return true;
    }
    return false;
  }
  // far (most negative) end of the calm windows intersecting [zLo, zHi], or +Infinity
  function calmFarEnd(zHi, zLo) {
    const L = C.WORLD_LEN, H = C.TUNNEL_HALF;
    const k0 = Math.max(1, Math.floor((-zHi - 200) / L)), k1 = Math.ceil((-zLo + 200) / L);
    let e = Infinity;
    for (let k = k0; k <= k1; k++) {
      const B = -k * L;
      if (zHi > B + H - ZONE.CALM_IN && zLo < B + H + ZONE.CALM_OUT) e = Math.min(e, B + H - ZONE.CALM_IN);
      if (zHi > B - H - ZONE.CALM_OUT && zLo < B - H + ZONE.CALM_IN) e = Math.min(e, B - H - ZONE.CALM_OUT);
    }
    return e;
  }
  // true if a jetpack picked up at z could still be flying when a tunnel starts (or z is inside one)
  function jetpackUnsafe(z) {
    if (RR.inTunnel(z, 10)) return true;
    const L = C.WORLD_LEN, H = C.TUNNEL_HALF;
    for (let k = Math.max(1, Math.floor(-z / L)); k <= Math.ceil((-z + FAIR.JETPACK_TUNNEL_CLEAR + H) / L); k++) {
      const zIn = -k * L + H; // tunnel entrance (the end the player reaches first)
      if (zIn <= z && z - zIn < FAIR.JETPACK_TUNNEL_CLEAR) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ lane x time grid (typed arrays, reused)
  // Tick i (1..N) = the player moving from gz[i-1] to gz[i]. Per lane and tick: hazard bits, ramp floor, roof.
  const TAU = FAIR.TAU;
  let GS = 0, gN = 0;
  let gz, gmask, gramp, grampIn, groof, wLaneA, wTrA, wVmA, wRollA, wInpA, wYA, segA, LOWA;
  function ensureTicks(n) {
    if (n < GS - 1) return;
    GS = Math.max(320, n + 64, GS * 2);
    gz = new Float64Array(GS); gmask = new Uint8Array(3 * GS); gramp = new Float64Array(3 * GS);
    grampIn = new Float64Array(3 * GS); groof = new Uint8Array(3 * GS);
    wLaneA = new Int8Array(GS); wTrA = new Int8Array(GS); wVmA = new Int16Array(GS); wRollA = new Int8Array(GS);
    wInpA = new Int8Array(GS); wYA = new Float64Array(GS); segA = new Int32Array(GS + 1); LOWA = new Uint8Array(GS);
  }
  ensureTicks(0);
  function buildTicks(zStart, zEnd) {
    ensureTicks(Math.ceil((zStart - zEnd) / speedAt(-zStart) / TAU) + 4);
    let z = zStart, i = 0;
    gz[0] = z;
    while (z > zEnd) { z -= speedAt(-z) * TAU; gz[++i] = z; }
    gN = i;
    for (let l = 0; l < 3; l++) {
      const o = l * GS, e = o + i + 1;
      gmask.fill(0, o, e); gramp.fill(-1, o, e); grampIn.fill(-1, o, e); groof.fill(0, o, e);
    }
    return i;
  }
  function timeAt(zz) { // grid time at which the player is at zz (linear inside a tick)
    const N = gN;
    if (zz >= gz[0]) return 0;
    if (zz <= gz[N]) return N * TAU;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (gz[m] > zz) lo = m; else hi = m; }
    return (lo + (gz[lo] - zz) / (gz[lo] - gz[hi])) * TAU;
  }
  function buildGrid(items, n, zStart, zEnd) {
    const N = buildTicks(zStart, zEnd), MZ = FAIR.MZ, SL = FAIR.SLACK;
    for (let j = 0; j < n; j++) {
      const o = items[j], base = o.lane * GS;
      if (o.vz) { // oncoming train: overlaps the player during [tMeet - m, tMeet + (len + m) / closing speed]
        const tm = timeAt(o.meetZ), vc = speedAt(-o.meetZ) + o.vz, m = (HD + MZ) / vc + SL;
        const t0 = tm - m, t1 = tm + (o.len + HD + MZ) / vc;
        for (let i = 1; i <= N; i++) if (i * TAU > t0 && (i - 1) * TAU < t1) gmask[base + i] |= HZ_TRAIN;
        continue;
      }
      const sl = SL * speedAt(-o.zF);
      if (o.type === 'ramp') {
        const span = o.zF - o.zB;
        for (let i = 1; i <= N; i++) {
          const lo = gz[i] - HD, hi = gz[i - 1] + HD;
          if (lo >= o.zF) continue;
          if (hi > o.zB) { const h = clamp((TRAIN_H * (o.zF - gz[i])) / span, 0, TRAIN_H); if (h > gramp[base + i]) gramp[base + i] = h; }
          if (hi + sl > o.zB) { const h = clamp((TRAIN_H * (o.zF - gz[i] + sl)) / span, 0, TRAIN_H); if (h > grampIn[base + i]) grampIn[base + i] = h; }
        }
        continue;
      }
      const bit = o.type === 'train' ? HZ_TRAIN : o.type === 'hurdle' ? HZ_HURDLE : o.type === 'bar' ? HZ_BAR : HZ_BLOCK;
      const m = MZ + sl;
      for (let i = 1; i <= N; i++) {
        const lo = gz[i] - HD, hi = gz[i - 1] + HD;
        // a ramped train's front is not widened (the ramp hands the runner over to the roof)
        if (hi > o.zB - m && (o.ramped ? gz[i] < o.zF : lo - m < o.zF)) {
          if (bit === HZ_TRAIN && hi <= o.zB) gmask[base + i] |= HZ_TAIL;
          else gmask[base + i] |= bit;
          if (bit === HZ_TRAIN && lo < o.zF && hi > o.zB) groof[base + i] = 1; // roof only where the body really is
        }
      }
    }
    return N;
  }

  // ------------------------------------------------------------------ fairness search (integer states, no allocation)
  // Vertical modes: 0 ground, 1 up (ramp or roof), then airborne phases with exact parabola heights:
  //   A0[k] jump from the ground, A3[k] jump from a roof, F3[k] walked off a roof end.
  // Conservative simplifications: no slam, no jump / lane change on a ramp, ROOF_LAND + MY to be above a train,
  // a lane change counts in both lanes for LANE_BOTH, rolls last 0.60 s (real 0.62).
  const ACT_T = Math.round(FAIR.ACT / TAU), BOTH = Math.ceil(FAIR.LANE_BOTH / TAU), ROLL = Math.round(C.ROLL_T / TAU);
  function arc(y0, v0) { const a = []; for (let k = 1; k < 200; k++) { const t = k * TAU, y = y0 + v0 * t - 0.5 * G * t * t; a.push(y); if (y < 0) break; } return Float64Array.from(a); }
  const yA0 = arc(0, JUMP_V), yA3 = arc(TRAIN_H, JUMP_V), yF3 = arc(TRAIN_H, 0);
  const oA0 = 2, oA3 = oA0 + yA0.length, oF3 = oA3 + yA3.length, NV = oF3 + yF3.length;
  const NT = 1 + 2 * BOTH, NR = ROLL + 1, NS = 3 * NT * NV * NR;
  const airY = (vm) => (vm >= oF3 ? yF3[vm - oF3] : vm >= oA3 ? yA3[vm - oA3] : yA0[vm - oA0]);
  let dpCur = new Int8Array(NS * 3).fill(-1), dpNxt = new Int8Array(NS * 3).fill(-1);
  let dpAct = new Int32Array(NS), dpNact = new Int32Array(NS);
  const dpIn = new Uint8Array(NS), parOf = new Int32Array(NS), inpOf = new Int8Array(NS);
  let costCur = new Int16Array(NS), costNxt = new Int16Array(NS); // cost of the witness entry's best path to a state
  const W_INPUT = 8; // witness cost of one input (a tick spent up on a ramp or roof earns 1)
  let arena = new Int32Array(3 * 16384);
  const DPR = { ok: 0, exits: 0, wEnd: -1, failTick: 0, work: 0 };

  // walk = running on in the same lane on the ground / a ramp / a roof: the ramp surface is continuous, so the plain
  // ramp height applies; airborne states and lane changes use the ramp as seen with timing slack (grampIn).
  function hitCell(k, y, H, walk, tailOk) {
    let m = gmask[k];
    if (m & HZ_TAIL && !tailOk) m |= HZ_TRAIN;
    if (m) {
      if (m & 1 && y < HZ_HI[0] + MY && y + H > HZ_LO[0] - MY) return true;
      if (m & 2 && y < HZ_HI[1] + MY && y + H > HZ_LO[1] - MY) return true;
      if (m & 4 && y < HZ_HI[2] + MY && y + H > HZ_LO[2] - MY) return true;
      if (m & 8 && y < HZ_HI[3] + MY && y + H > HZ_LO[3] - MY) return true;
    }
    const rin = walk ? gramp[k] : grampIn[k];
    return rin >= 0 && y < rin - FAIR.RAMP_STEP; // inside the ramp body
  }
  let outY = 0;
  function vstep(vm, k) { // successor vertical mode (and outY) after one tick in cell k
    const ramp = gramp[k];
    if (vm === 0) {
      if (ramp >= 0 && ramp <= FAIR.RAMP_STEP) { outY = ramp; return ramp > 0.05 ? 1 : 0; }
      outY = 0; return 0;
    }
    if (vm === 1) {
      if (ramp >= 0) { outY = ramp; return 1; }
      if (groof[k]) { outY = TRAIN_H; return 1; }
      outY = yF3[0]; return oF3; // walked off the end of a roof
    }
    let base, arr;
    if (vm >= oF3) { base = oF3; arr = yF3; } else if (vm >= oA3) { base = oA3; arr = yA3; } else { base = oA0; arr = yA0; }
    const kk = vm - base, yPrev = arr[kk], yN = kk + 1 < arr.length ? arr[kk + 1] : -1;
    let floor = 0;
    if (ramp >= 0 && yPrev >= ramp - FAIR.RAMP_STEP) floor = ramp;
    if (groof[k] && yPrev >= FAIR.ROOF_LAND + MY && TRAIN_H > floor) floor = TRAIN_H;
    if (yN < yPrev && yN <= floor) { outY = floor; return floor > 0.05 ? 1 : 0; }
    outY = yN; return base + kk + 1;
  }
  // One pass for all entry lanes (bitmask). cur[s*3+e] = ticks since the last input on the best path from entry e
  // (capped at ACT_T; -1 = unreachable). Fills DPR and, for entry wE, the witness arrays (ticks 0..N).
  function dpRun(N, entryMask, wE, laneRank) {
    let cur = dpCur, nxt = dpNxt, act = dpAct, nact = dpNact, cc = costCur, cn = costNxt, nAct = 0, arenaN = 0, work = 0;
    for (let e = 0; e < 3; e++) if (entryMask & (1 << e)) { const s = e * NT * NV * NR; cur[s * 3 + e] = ACT_T; act[nAct++] = s; cc[s] = 0; }
    DPR.ok = 0; DPR.exits = 0; DPR.wEnd = -1; DPR.failTick = 0;
    for (let i = 1; i <= N; i++) {
      let nN = 0;
      segA[i] = arenaN;
      for (let a = 0; a < nAct; a++) {
        const s = act[a];
        work++;
        const roll = s % NR, q = (s / NR) | 0, vm = q % NV, q2 = (q / NV) | 0, tr = q2 % NT, lane = (q2 / NT) | 0;
        const sc0 = cur[s * 3], sc1 = cur[s * 3 + 1], sc2 = cur[s * 3 + 2];
        const onRamp = vm === 1 && gramp[lane * GS + i - 1] >= 0;
        const ntr0 = tr > 0 ? (tr > BOTH ? (tr - 1 > BOTH ? tr - 1 : 0) : tr - 1) : 0, nroll0 = roll > 0 ? roll - 1 : 0;
        const canPress = sc0 >= ACT_T || sc1 >= ACT_T || sc2 >= ACT_T;
        for (let inp = 0; inp < 5; inp++) { // 0 none, 1 jump, 2 roll, 3 left, 4 right
          if (inp > 0 && !canPress) break;
          let nl = lane, ntr = ntr0, nroll = nroll0, v2, y;
          if (inp === 1) {
            if (vm === 0) { v2 = oA0; y = yA0[0]; } else if (vm === 1 && !onRamp) { v2 = oA3; y = yA3[0]; } else continue;
            nroll = 0;
          } else {
            if (inp === 2) { if (vm > 1 || roll > 1) continue; nroll = ROLL - 1; }
            else if (inp >= 3) {
              if (tr !== 0 || onRamp || vm >= oF3) continue; // no lane change while dropping off a roof
              nl = inp === 3 ? lane - 1 : lane + 1;
              if (nl < 0 || nl > 2) continue;
              ntr = inp === 4 ? BOTH - 1 : 2 * BOTH - 1;
              if (ntr === BOTH) ntr = 0;
            }
            v2 = vstep(vm, nl * GS + i); y = outY;
            if (inp >= 3 && vm === 1 && v2 >= 2) continue; // no stepping sideways off a roof
          }
          const H = inp === 2 || (roll > 0 && inp !== 1) ? BODY_ROLL : BODY;
          const trNow = inp >= 3 ? (inp === 3 ? 2 * BOTH : BOTH) : tr; // the lane being left still counts
          const offRoof = inp === 0 && tr === 0 && (v2 >= oF3 || (vm >= oF3 && v2 < 2)); // walked off this lane's roof
          if (hitCell(nl * GS + i, y, H, trNow === 0 && vm < 2 && v2 < 2, offRoof)) continue;
          if (trNow > 0) { const from = trNow > BOTH ? nl + 1 : nl - 1; if (from >= 0 && from <= 2 && hitCell(from * GS + i, y, H, false, false)) continue; }
          const ns = ((nl * NT + ntr) * NV + v2) * NR + nroll, b = ns * 3;
          let any = false;
          for (let e = 0; e < 3; e++) {
            const sc = e === 0 ? sc0 : e === 1 ? sc1 : sc2;
            let v;
            if (inp === 0) { if (sc < 0) continue; v = sc + 1 > ACT_T ? ACT_T : sc + 1; }
            else { if (sc < ACT_T) continue; v = 0; }
            if (e === wE) { // witness entry: max since, then lowest cost (inputs cost, roof time pays: no pointless jumps, coins lead onto roofs)
              const c = cc[s] + (inp ? W_INPUT : 0) - (v2 === 1 ? 1 : 0);
              if (nxt[b + e] < v || (nxt[b + e] === v && c < cn[ns])) { nxt[b + e] = v; any = true; parOf[ns] = s; inpOf[ns] = inp; cn[ns] = c; }
            } else if (nxt[b + e] < v) { nxt[b + e] = v; any = true; }
          }
          if (any && !dpIn[ns]) { dpIn[ns] = 1; nact[nN++] = ns; }
        }
      }
      for (let a = 0; a < nAct; a++) { const b = act[a] * 3; cur[b] = cur[b + 1] = cur[b + 2] = -1; }
      if (arenaN + nN * 3 > arena.length) { const na = new Int32Array(Math.max(arena.length * 2, arenaN + nN * 3 + 1024)); na.set(arena.subarray(0, arenaN)); arena = na; }
      for (let a = 0; a < nN; a++) {
        const ns = nact[a];
        dpIn[ns] = 0;
        if (wE >= 0 && nxt[ns * 3 + wE] >= 0) { arena[arenaN++] = ns; arena[arenaN++] = parOf[ns]; arena[arenaN++] = inpOf[ns]; }
      }
      let t = cur; cur = nxt; nxt = t;
      t = act; act = nact; nact = t;
      t = cc; cc = cn; cn = t;
      nAct = nN;
      if (!nAct) { DPR.failTick = i; DPR.work = work; dpCur = cur; dpNxt = nxt; dpAct = act; dpNact = nact; costCur = cc; costNxt = cn; return DPR; }
    }
    segA[N + 1] = arenaN;
    let ok = 0, exits = 0, wEnd = -1, best = 1e9;
    for (let a = 0; a < nAct; a++) {
      const s = act[a], roll = s % NR, q = (s / NR) | 0, vm = q % NV, q2 = (q / NV) | 0, tr = q2 % NT, lane = (q2 / NT) | 0;
      if (vm === 0 && roll === 0 && tr === 0) { // ready: grounded, settled, not rolling ... and allowed to press
        for (let e = 0; e < 3; e++) {
          if (cur[s * 3 + e] < ACT_T) continue;
          ok |= 1 << e; exits |= 1 << lane;
          if (e === wE && cc[s] + laneRank[lane] * 6 < best) { best = cc[s] + laneRank[lane] * 6; wEnd = s; }
        }
      }
      cur[s * 3] = cur[s * 3 + 1] = cur[s * 3 + 2] = -1;
    }
    dpCur = cur; dpNxt = nxt; dpAct = act; dpNact = nact; costCur = cc; costNxt = cn;
    DPR.ok = ok; DPR.exits = exits; DPR.wEnd = wEnd; DPR.work = work;
    if (wEnd >= 0) { // walk the witness back from its end state
      let s = wEnd;
      for (let i = N; i >= 1; i--) {
        const roll = s % NR, q = (s / NR) | 0, vm = q % NV, q2 = (q / NV) | 0, tr = q2 % NT, lane = (q2 / NT) | 0, k = lane * GS + i;
        wLaneA[i] = lane; wTrA[i] = tr; wVmA[i] = vm; wRollA[i] = roll;
        wYA[i] = vm === 0 ? 0 : vm === 1 ? (gramp[k] >= 0 ? gramp[k] : TRAIN_H) : airY(vm);
        let p = -1, inp = 0;
        for (let j = segA[i], je = segA[i + 1]; j < je; j += 3) if (arena[j] === s) { p = arena[j + 1]; inp = arena[j + 2]; break; }
        wInpA[i] = inp;
        if (p < 0) { DPR.wEnd = -1; break; } // cannot happen; keeps the director alive if it ever does
        s = p;
      }
      wLaneA[0] = wE; wTrA[0] = 0; wVmA[0] = 0; wRollA[0] = 0; wYA[0] = 0; wInpA[0] = 0;
    }
    return DPR;
  }

  // ------------------------------------------------------------------ scratch items (reused between candidates)
  const SC = [];
  let SCn = 0;
  function scItem(type, lane, zF, zB, filler) {
    let o = SC[SCn];
    if (!o) o = SC[SCn] = { type: '', lane: 0, zF: 0, zB: 0, vz: 0, len: 0, meetZ: 0, spawnPz: 0, ramped: false, filler: false };
    SCn++;
    o.type = type; o.lane = lane; o.zF = zF; o.zB = zB; o.vz = 0; o.len = zF - zB; o.meetZ = 0; o.spawnPz = 0; o.ramped = false; o.filler = !!filler;
    return o;
  }
  const CG = new Uint8Array(3 * 32);
  const CH = { '.': 46, h: 104, b: 98, k: 107, T: 84, R: 82, M: 77 };
  const FILL = new Int16Array(3 * 48), EMPT = new Int16Array(2 * 96);
  const crLane = new Int8Array(8), crHi = new Float64Array(8), crLo = new Float64Array(8);
  const DF = { D: 0, tierMax: 0, beat: 0.62, lead: 0.6, peak: false, breatherEvery: 7 };
  const W = new Float64Array(NP);
  const TRAIN_BIAS = 1.75;
  const INST = { zS: 0, rowLen: 0, v: 0, zRowsEnd: 0, zEnd: 0 };

  const ELIG = new Int32Array(1024);

  // ------------------------------------------------------------------ the director
  class Director {
    constructor() {
      this.seed = 0; this.seedSet = false; this.tutorialOpt = false; this.lastZ0 = NaN; this.warmed = true;
      this.nextId = 1;
      this.stats = { chunks: 0, checks: 0, rejects: 0, baseRejects: 0, fallbacks: 0, breathers: 0, calm: 0, filled: 0, movers: 0, tutorial: 0, lastMs: 0, maxMs: 0 };
      this.resLane = new Int8Array(64); this.resHi = new Float64Array(64); this.resLo = new Float64Array(64); this.nRes = 0;
      this.recent = new Int16Array(4); this.recentN = 0;
      this.laneRank = new Int8Array(3);
      this.pend = { on: false, pi: 0, perm: null, nf: 0 };
      this.raw = false;
      this.chunks = [];
      this.reset(0);
      this.warmed = false; // the real warm-up happens at the first external reset()
    }

    // z0 = the player's feet z. Content starts at min(z0 - 60, opts.clearUntil). Without opts the previous seed
    // is kept (same z0 => identical content, so a second lifecycle reset(pz) is harmless; a new z0 => no tutorial).
    reset(z0, opts) {
      if (!this.warmed) this.warmUp();
      z0 = +z0 || 0;
      if (opts) {
        this.seed = opts.seed !== undefined && opts.seed !== null ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
        this.tutorialOpt = !!opts.tutorial;
      } else if (!this.seedSet) this.seed = (Math.random() * 4294967296) >>> 0;
      else if (z0 !== this.lastZ0) this.tutorialOpt = false;
      this.seedSet = true;
      this.lastZ0 = z0;
      this.rng = RR.makeRng((this.seed ^ Math.imul(Math.round(-z0) | 0, 0x9e3779b1)) >>> 0);
      const cu = opts && typeof opts.clearUntil === 'number' ? opts.clearUntil : Infinity;
      this.startPz = z0;
      this.z = Math.min(z0 - FAIR.LEAD_IN, cu);
      this.restart();
      this.tut = this.tutorialOpt && z0 > -10 ? 0 : -1; // the tutorial only opens a run (not a warp / mid-run reset)
      this.dOffset = 0;
      this.lastPickupZ = z0 + FAIR.LEAD_IN; // => the first pickup comes >= 200 m after z0
      this.lastMoverZ = this.z;
      this.chunks.length = 0;
    }
    // One-time JIT warm-up (~1.5 km on a throwaway seed, tens of ms, once at the first reset) so the fairness
    // search is already optimised when the run starts streaming chunks during play.
    warmUp() {
      this.warmed = true;
      const keep = { seed: this.seed, seedSet: this.seedSet, tut: this.tutorialOpt, z0: this.lastZ0, id: this.nextId };
      try {
        for (let pass = 0; pass < 2; pass++) {
          this.reset(pass ? -1800 : -300, { seed: 0x5eed + pass, tutorial: !pass });
          for (let n = 0; n < 200 && this.z > this.startPz - 800; n++) this.next();
        }
      } catch (e) { /* never block the game on the warm-up */ }
      this.seed = keep.seed; this.seedSet = keep.seedSet; this.tutorialOpt = keep.tut; this.lastZ0 = keep.z0; this.nextId = keep.id;
      for (const k in this.stats) this.stats[k] = 0;
    }
    restart() { // state shared by reset and clearAhead
      this.entry = 7; this.wLane = 1;
      this.pend.on = false; this.rej = 0;
      this.nRes = 0;
      this.recent.fill(-1); this.recentN = 0;
      this.sinceBreather = 0;
      this.coinAcc = 1.1; this.coinRun = 0; this.coinRunLen = 8; this.coinGap = 0;
    }

    // Forget every chunk that reaches past pz (they overlap [pz - metres, pz] or lie beyond it) and restart
    // generation at pz - max(60, metres) with every lane as a valid entry. Returns { dropped: [chunk ids], from }.
    clearAhead(pz, metres) {
      metres = Math.max(FAIR.LEAD_IN, +metres || 0);
      const dropped = [];
      let first = -1;
      for (let i = 0; i < this.chunks.length; i++) if (this.chunks[i].zEnd < pz) { first = i; break; }
      if (first >= 0) {
        const pre = this.chunks[first].pre;
        this.lastPickupZ = pre.lastPickupZ; this.tut = pre.tut; this.dOffset = pre.dOffset; this.lastMoverZ = pre.lastMoverZ;
        for (let i = first; i < this.chunks.length; i++) dropped.push(this.chunks[i].id);
        this.chunks.length = first;
      }
      this.startPz = pz;
      this.z = pz - metres;
      this.restart();
      if (this.lastMoverZ < this.z) this.lastMoverZ = this.z;
      return { dropped, from: this.z };
    }

    next() {
      if (this.pend.on) return this.check(true);
      if (this.tut >= 0) return this.tutorialChunk();
      const dAbs = -this.z, dEff = Math.max(0, dAbs - this.dOffset);
      difficulty(dEff, dAbs, DF);
      const v = speedAt(dAbs);
      // portal calm: the first row would land in a calm window -> breather through the window
      if (zoneHit(this.z, this.z - (DF.lead + DF.beat) * v, 2)) return this.breather(DF, 1);
      if (this.sinceBreather >= DF.breatherEvery) return this.breather(DF, 0);
      let only = zoneHit(this.z + 0.01, this.z - 0.01, 1); // inside a tunnel's train-free zone: hurdles / bars only
      const rng = this.rng;
      for (let a = 0; a < 12; a++) { // cheap candidate search: placement rules only, no fairness search
        const pi = this.choose(DF, only, dEff);
        if (pi < 0) break;
        const p = PATTERNS[pi], perms = PERMS[p.perm], perm = perms[(rng.next() * perms.length) | 0];
        const want = Math.floor(lerp(0, 3, DF.D) + rng.next());
        const nf = want > 0 ? this.pickFill(p, want, only) : 0;
        const r = this.inst(p.rows, perm, DF.beat, DF.lead, nf);
        if (r === 0) { const pe = this.pend; pe.on = true; pe.pi = pi; pe.perm = perm; pe.nf = nf; return this.check(false); }
        if (r === 1) only = true;
      }
      return this.breather(DF, 0);
    }

    choose(df, only, dEff) {
      // keep oncoming trains >= 1 per km: boost after 450 m without one, near-force after 650 m
      const since = this.lastMoverZ - this.z, moversOk = dEff >= FAIR.MOVER_MIN_DIST && !only;
      const boost = moversOk && since > 450 ? (since > 650 ? 40 : 5) : 1;
      let sum = 0;
      for (let i = 0; i < NP; i++) {
        const p = PATTERNS[i];
        let w = 0;
        if (p.tier <= df.tierMax && (!only || p.tunnelSafe) && (!p.mover || dEff >= FAIR.MOVER_MIN_DIST)) {
          w = p.w * (p.tier === df.tierMax ? (df.peak ? 2.5 : 1.6) : p.tier === df.tierMax - 1 ? 1.2 : 0.6);
          for (let j = 0; j < 4; j++) if (this.recent[j] === i) { w *= 0.08; break; }
          if (p.mover) w *= boost;
          if (p.trains && !p.mover) w *= TRAIN_BIAS; // trains are the signature obstacle
        }
        W[i] = w; sum += w;
      }
      if (sum <= 0) return -1;
      let r = this.rng.next() * sum, last = -1;
      for (let i = 0; i < NP; i++) { if (W[i] <= 0) continue; last = i; r -= W[i]; if (r <= 0) return i; }
      return last;
    }

    // Filler: extra hurdles / bars / blocks on empty cells of the pattern (kept only if still fair).
    pickFill(p, want, safeOnly) {
      const rng = this.rng, rows = p.rows;
      let ne = 0;
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < 3; c++) if (rows[r].charCodeAt(c) === CH['.']) { EMPT[ne * 2] = r; EMPT[ne * 2 + 1] = c; ne++; }
      for (let i = ne - 1; i > 0; i--) {
        const j = (rng.next() * (i + 1)) | 0, r = EMPT[i * 2], c = EMPT[i * 2 + 1];
        EMPT[i * 2] = EMPT[j * 2]; EMPT[i * 2 + 1] = EMPT[j * 2 + 1]; EMPT[j * 2] = r; EMPT[j * 2 + 1] = c;
      }
      const n = Math.min(want, ne, 16);
      for (let f = 0; f < n; f++) {
        const x = rng.next();
        FILL[f * 3] = EMPT[f * 2]; FILL[f * 3 + 1] = EMPT[f * 2 + 1];
        FILL[f * 3 + 2] = safeOnly ? (x < 0.55 ? CH.h : CH.b) : x < 0.4 ? CH.h : x < 0.75 ? CH.b : CH.k;
      }
      return n;
    }

    resConflict(lane, hi, lo) {
      for (let i = 0; i < this.nRes; i++) if (this.resLane[i] === lane && hi > this.resLo[i] && lo < this.resHi[i]) return true;
      return false;
    }
    // 0 fine; 1 violates a tunnel's train-free zone; 2 violates another placement rule
    itemCheck(o) {
      if (this.raw) return 0;
      if (o.vz) {
        if (o.spawnPz > this.startPz) return 2; // would be created inside the visible range right after a reset
        if (zoneHit(o.meetZ + ZONE.MOVER_BEHIND, o.zB, 1)) return 1;
        return this.resConflict(o.lane, o.meetZ + 12, o.zB) ? 2 : 0;
      }
      if (o.type === 'train' || o.type === 'ramp') { if (zoneHit(o.zF, o.zB, 1)) return 1; }
      else if (zoneHit(o.zF, o.zB, 2) || (o.type === 'block' && zoneHit(o.zF, o.zB, 3))) return 2;
      return this.resConflict(o.lane, o.zF, o.zB) ? 2 : 0;
    }

    // Place a pattern (plus nf filler cells from FILL) at this.z into the scratch items. Returns itemCheck code.
    inst(rows, perm, beat, lead, nf) {
      SCn = 0;
      const z0 = this.z, v = speedAt(-z0), zS = z0 - lead * v, rowLen = beat * v, R = rows.length;
      for (let r = 0; r < R; r++) for (let c = 0; c < 3; c++) CG[r * 3 + perm[c]] = rows[r].charCodeAt(c);
      let zLast = zS - R * rowLen, nCR = 0;
      for (let l = 0; l < 3; l++) {
        for (let r = 0; r < R; r++) {
          const ch = CG[r * 3 + l], zc = zS - (r + 0.5) * rowLen;
          if (ch === CH.h) scItem('hurdle', l, zc + 0.12, zc - 0.12);
          else if (ch === CH.b) scItem('bar', l, zc + 0.12, zc - 0.12);
          else if (ch === CH.k) scItem('block', l, zc + 0.3, zc - 0.3);
          else if ((ch === CH.T || ch === CH.M) && (r === 0 || CG[(r - 1) * 3 + l] !== ch)) {
            let r1 = r;
            while (r1 + 1 < R && CG[(r1 + 1) * 3 + l] === ch) r1++;
            const zF = zS - r * rowLen - 0.5;
            if (ch === CH.T) {
              const raw = (r1 - r + 1) * rowLen - 1.0, len = Math.max(2 * CAR_L, Math.floor(raw / CAR_L) * CAR_L);
              const t = scItem('train', l, zF, zF - len);
              if (r > 0 && CG[(r - 1) * 3 + l] === CH.R) { t.ramped = true; scItem('ramp', l, zF + RAMP_L, zF); }
              if (zF - len < zLast) zLast = zF - len;
            } else { // oncoming: footprint of (rows x beat) seconds in the player's time frame
              const vMeet = speedAt(-zF), len = Math.max(2 * CAR_L, Math.round(((r1 - r + 1) * beat * (vMeet + VZ)) / CAR_L) * CAR_L);
              const spz = moverSpawnPz(zF, FAIR.MOVER_GAP), zFs = spz - FAIR.MOVER_GAP;
              const o = scItem('train', l, zFs, zFs - len);
              o.vz = VZ; o.len = len; o.meetZ = zF; o.spawnPz = spz;
            }
          }
        }
      }
      for (let j = 0; j < SCn; j++) {
        const o = SC[j], c = this.itemCheck(o);
        if (c) return c;
        if (o.vz && nCR < 8) { crLane[nCR] = o.lane; crHi[nCR] = o.meetZ + 12; crLo[nCR] = o.zB; nCR++; }
      }
      if (!this.raw) {
        for (let j = 0; j < SCn; j++) { // the pattern's own statics must stay out of its oncoming trains' way
          const o = SC[j];
          if (o.vz) continue;
          for (let c = 0; c < nCR; c++) if (o.lane === crLane[c] && o.zF > crLo[c] && o.zB < crHi[c]) return 2;
        }
      }
      for (let f = 0; f < nf; f++) { // filler cells that break a placement rule are simply left out
        const r = FILL[f * 3], l = perm[FILL[f * 3 + 1]], ch = FILL[f * 3 + 2], zc = zS - (r + 0.5) * rowLen;
        const o = ch === CH.h ? scItem('hurdle', l, zc + 0.12, zc - 0.12, true) : ch === CH.b ? scItem('bar', l, zc + 0.12, zc - 0.12, true) : scItem('block', l, zc + 0.3, zc - 0.3, true);
        let bad = this.itemCheck(o) !== 0;
        for (let c = 0; c < nCR && !bad; c++) if (o.lane === crLane[c] && o.zF > crLo[c] && o.zB < crHi[c]) bad = true;
        if (bad) SCn--;
      }
      INST.zS = zS; INST.rowLen = rowLen; INST.v = v; INST.zRowsEnd = zLast; INST.zEnd = zLast - FAIR.TAIL * v;
      if (!this.raw && zoneHit(z0, INST.zEnd, 3)) { // a chunk overlapping a tunnel carries no trains at all
        for (let j = 0; j < SCn; j++) if (SC[j].type === 'train' || SC[j].type === 'ramp') return 1;
      }
      return 0;
    }

    rankLanes(pref) { // witness end lane preference: pref first, then the middle, then the rest
      const rk = this.laneRank;
      rk[0] = rk[1] = rk[2] = 3;
      rk[pref] = 0;
      if (rk[1] === 3) rk[1] = 1;
      for (let l = 0; l < 3; l++) if (rk[l] === 3) rk[l] = 2;
      return rk;
    }
    // One fairness search for the pending candidate (re-placed first when resumed from an earlier call).
    check(replace) {
      const pe = this.pend, p = PATTERNS[pe.pi], dAbs = -this.z;
      difficulty(Math.max(0, dAbs - this.dOffset), dAbs, DF);
      if (replace) this.inst(p.rows, pe.perm, DF.beat, DF.lead, pe.nf);
      const t0 = now();
      const N = buildGrid(SC, SCn, this.z, INST.zEnd);
      const pref = this.rng.next() < 0.5 ? 1 : (this.rng.next() * 3) | 0;
      const r = dpRun(N, this.entry, this.wLane, this.rankLanes(pref));
      const ms = now() - t0;
      this.stats.checks++; this.stats.lastMs = ms; if (ms > this.stats.maxMs) this.stats.maxMs = ms;
      if ((r.ok & this.entry) === this.entry && r.wEnd >= 0) {
        pe.on = false; this.rej = 0;
        if (pe.nf > 0) this.stats.filled++;
        this.sinceBreather++;
        this.pushRecent(pe.pi);
        return this.commit(p.id, DF.D, N, false, p.tags, null);
      }
      this.stats.rejects++; this.rej++;
      if (pe.nf > 0) pe.nf--; else { pe.on = false; this.stats.baseRejects++; }
      if (this.rej >= FAIR.MAX_REJECT) { pe.on = false; this.rej = 0; this.stats.fallbacks++; return this.breather(DF, 0); }
      return null;
    }

    tutorialChunk() {
      const idx = this.tut, st = TUTORIAL[idx];
      difficulty(0, -this.z, DF);
      this.inst(st.rows, PERMS.none[0], 0.62, st.lead, 0);
      const N = buildGrid(SC, SCn, this.z, INST.zEnd);
      const r = dpRun(N, this.entry, this.wLane, this.rankLanes(st.end));
      this.stats.checks++;
      this.tut = idx + 1 < TUTORIAL.length ? idx + 1 : -1;
      let ch;
      if ((r.ok & this.entry) !== this.entry || r.wEnd < 0) ch = this.breather(DF, 0); // cannot happen (tested)
      else {
        let zAct = this.z - st.lead * speedAt(-this.z);
        for (let j = 0; j < SCn; j++) {
          const o = SC[j];
          if (st.action === 'ramp' ? o.type === 'ramp' : o.lane === st.lane) { zAct = o.zF; break; }
        }
        this.stats.tutorial++;
        ch = this.commit(st.id, 0, N, false, ['tutorial'], st);
        if (st.action === 'coins' && ch.coins.length) zAct = ch.coins[0].z;
        if (st.action === 'magnet' && ch.pickups.length) zAct = ch.pickups[0].z;
        ch.tutorial = { step: idx, total: TUTORIAL.length, last: idx === TUTORIAL.length - 1, action: st.action, label: st.label, hint: { key: st.hint.key, touch: st.hint.touch }, zAct };
      }
      if (this.tut < 0) { this.dOffset = -this.z; this.lastMoverZ = this.z; this.sinceBreather = 0; } // normal play from difficulty 0
      return ch;
    }

    // Empty track (no fairness search needed): straight, a lane weave or a coin arc. mode 1 = portal calm.
    breather(df, mode) {
      const rng = this.rng, v = speedAt(-this.z);
      let zEnd = this.z - (df.lead + df.beat + FAIR.TAIL) * v;
      if (mode === 1) { const e = calmFarEnd(this.z, zEnd); if (e < zEnd) zEnd = e - 0.5; this.stats.calm++; }
      const N = buildTicks(this.z, zEnd);
      const inTunnel = zoneHit(this.z, zEnd, 3), x = rng.next();
      const doArc = mode !== 1 && N >= 30 && x < (inTunnel ? 0.6 : 0.3);
      const doMove = mode !== 1 && !doArc && N >= 16 && x < (inTunnel ? 0.85 : 0.6);
      const ij = doArc ? (N >> 1) - 6 : doMove ? (N >> 1) - ((rng.next() * 4) | 0) : -1;
      let lane = this.wLane, to = lane, tr = 0, air = -1;
      if (doMove) { to = lane === 1 ? (rng.next() < 0.5 ? 0 : 2) : 1; if (this.resConflict(to, this.z, zEnd)) to = lane; }
      wLaneA[0] = lane; wTrA[0] = 0; wVmA[0] = 0; wYA[0] = 0; wInpA[0] = 0; wRollA[0] = 0;
      for (let i = 1; i <= N; i++) {
        let inp = 0;
        if (tr > 0) tr--;
        if (i === ij + 1) {
          if (doArc) { inp = 1; air = 0; } else if (to !== lane) { inp = to < lane ? 3 : 4; lane = to; tr = BOTH - 1; }
        }
        wLaneA[i] = lane; wTrA[i] = tr; wInpA[i] = inp; wRollA[i] = 0;
        if (air >= 0 && air < yA0.length && yA0[air] > 0) { wYA[i] = yA0[air]; wVmA[i] = oA0 + air; air++; }
        else { wYA[i] = 0; wVmA[i] = 0; air = -1; }
      }
      this.sinceBreather = 0; this.stats.breathers++;
      this.pushRecent(-1);
      INST.zEnd = zEnd; SCn = 0;
      return this.commit(doArc ? 'coin-arc' : 'breather', df.D, N, true, doArc ? ['arc'] : [], null);
    }

    pushRecent(pi) { this.recent[this.recentN & 3] = pi; this.recentN++; }

    // Turn the scratch items + witness (ticks 0..N) into a chunk and advance the frontier.
    commit(id, D, N, open, tags, tutStep) {
      const zStart = this.z, zEnd = INST.zEnd, rng = this.rng;
      const pre = { lastPickupZ: this.lastPickupZ, tut: tutStep ? TUTORIAL.indexOf(tutStep) : this.tut, dOffset: this.dOffset, lastMoverZ: this.lastMoverZ };
      const items = [], coins = [], pickups = [], path = [];
      for (let j = 0; j < SCn; j++) {
        const o = SC[j];
        if (o.vz) {
          items.push({ type: 'train', lane: o.lane, zF: o.zF, zB: o.zB, vz: o.vz, cars: Math.max(1, Math.round(o.len / 11)), meetZ: o.meetZ, spawnPz: o.spawnPz, len: o.len });
          this.addRes(o.lane, o.meetZ + 12, o.zB);
          if (o.meetZ < this.lastMoverZ) this.lastMoverZ = o.meetZ;
          this.stats.movers++;
        } else {
          const it = { type: o.type, lane: o.lane, zF: o.zF, zB: o.zB, vz: 0, cars: o.type === 'train' ? Math.max(1, Math.round((o.zF - o.zB) / 11)) : 0 };
          if (o.type === 'train') it.ramped = o.ramped;
          items.push(it);
        }
      }
      items.sort((a, b) => (b.vz ? b.meetZ : b.zF) - (a.vz ? a.meetZ : a.zF));
      // pickup: on a grounded, hazard-free, settled tick of the witness
      let pk = null;
      if (tutStep && tutStep.pickup) {
        const i = Math.min(N - 1, Math.max(2, (N / 5) | 0));
        pk = { kind: tutStep.pickup, lane: wLaneA[i], y: 1.3, z: gz[i] };
      } else if (!tutStep && this.tut < 0 && this.lastPickupZ - zStart > FAIR.PICKUP_SPACING && rng.next() < FAIR.PICKUP_CHANCE) {
        let ne = 0;
        for (let i = 4; i < N - 2 && ne < ELIG.length; i++) {
          const l = wLaneA[i], z = gz[i];
          if (wVmA[i] !== 0 || wRollA[i] || wTrA[i] || wInpA[i] || wInpA[i + 1] || -z < FAIR.PICKUP_MIN_DIST) continue;
          let clear = true;
          for (let k = i - 3; k <= i + 3 && clear; k++) if (k >= 0 && k <= N && gmask[l * GS + k]) clear = false;
          if (clear && !this.resConflict(l, z + 4, z - 4)) ELIG[ne++] = i;
        }
        if (ne) { const i = ELIG[(rng.next() * ne) | 0]; pk = { kind: this.pickKind(gz[i]), lane: wLaneA[i], y: 1.3, z: gz[i] }; }
      }
      if (pk) { pickups.push(pk); this.lastPickupZ = pk.z; }
      // coins along the witness (one every COIN_SPACING m, strings of 6-12 with gaps of 3-6 slots)
      const trail = !!(tutStep && tutStep.coins);
      if (trail) { this.coinRun = 0; this.coinRunLen = 1e9; this.coinGap = 0; }
      for (let i = 0; i <= N; i++) { // coins stay low between two rolls that almost touch
        let low = wRollA[i] > 0 ? 1 : 0;
        if (!low && wVmA[i] === 0) {
          let a = 0, b = 0;
          for (let k = 1; k <= 3; k++) { if (i - k >= 0 && wRollA[i - k] > 0) a = 1; if (i + k <= N && wRollA[i + k] > 0) b = 1; }
          low = a & b;
        }
        LOWA[i] = low;
      }
      const SP = FAIR.COIN_SPACING;
      let acc = this.coinAcc;
      for (let i = 1; i <= N; i++) { // (the last tick overshoots zEnd: coins stop there, the next chunk goes on)
        const z0 = gz[i - 1], full = z0 - gz[i], dz = z0 - (gz[i] < zEnd ? zEnd : gz[i]);
        if (dz <= 0) break;
        let pos = SP - acc;
        while (pos <= dz) {
          const zc = z0 - pos, y = wYA[i - 1] + ((wYA[i] - wYA[i - 1]) * pos) / full;
          this.coinSlot(coins, wLaneA[i], y, zc, wTrA[i] > 0, LOWA[i] > 0, wVmA[i] === 1, pk);
          pos += SP;
        }
        acc = dz - (pos - SP);
      }
      this.coinAcc = acc;
      if (trail) { this.coinRun = 0; this.coinRunLen = 6 + ((rng.next() * 7) | 0); this.coinGap = 3; }
      if (tutStep && tutStep.coins === 'carpet' && pk) { // magnet demo: coins across the other lanes after the pickup
        for (let z = pk.z - 10; z > zEnd + 6; z -= SP) for (let l = 0; l < 3; l++) if (l !== pk.lane) coins.push({ lane: l, y: 1.0, z });
        coins.sort((a, b) => b.z - a.z);
      }
      // witness path: the entry lane, then every input (z = where to press)
      path.push({ z: zStart, lane: wLaneA[0], action: 'none' });
      for (let i = 1; i <= N; i++) if (wInpA[i]) path.push({ z: gz[i - 1], lane: wLaneA[i], action: ACTIONS[wInpA[i]] });
      // advance
      this.wLane = wLaneA[N];
      this.entry = open ? 7 : DPR.exits;
      this.z = zEnd;
      this.pruneRes();
      this.stats.chunks++;
      const chunk = { id: this.nextId++, pattern: id, zStart, zEnd, D, items, coins, pickups, path, tags };
      this.chunks.push({ id: chunk.id, zStart, zEnd, pre });
      if (this.chunks.length > 48) this.chunks.splice(0, this.chunks.length - 32);
      return chunk;
    }
    coinSlot(coins, lane, y, z, moving, rolling, up, pk) {
      if (this.coinGap > 0) { this.coinGap--; return; }
      if (moving) return;
      if (pk && pk.lane === lane && Math.abs(pk.z - z) < 4) return;
      if (this.resConflict(lane, z + 1, z - 1)) return;
      const yy = rolling ? y + 0.55 : up ? y + 1.0 - (0.1 * y) / TRAIN_H : y + 1.0; // roof coins at TRAIN_H + 0.9
      coins.push({ lane, y: yy, z });
      if (++this.coinRun >= this.coinRunLen) { this.coinRun = 0; this.coinRunLen = 6 + ((this.rng.next() * 7) | 0); this.coinGap = 3 + ((this.rng.next() * 4) | 0); }
    }
    pickKind(z) { // weights: magnet 1, sneakers 0.9, double 0.9, jetpack 0.45 (after 300 m, not before a tunnel), board 0.3
      const jet = -z >= FAIR.JETPACK_MIN_DIST && !jetpackUnsafe(z) ? 0.45 : 0;
      let r = this.rng.next() * (1 + 0.9 + 0.9 + jet + 0.3);
      if ((r -= 1) < 0) return 'magnet';
      if ((r -= 0.9) < 0) return 'sneakers';
      if ((r -= 0.9) < 0) return 'double';
      if ((r -= jet) < 0) return 'jetpack';
      return 'board';
    }
    addRes(lane, hi, lo) {
      if (this.nRes >= this.resLane.length) this.pruneRes();
      if (this.nRes >= this.resLane.length) return;
      const i = this.nRes++;
      this.resLane[i] = lane; this.resHi[i] = hi; this.resLo[i] = lo;
    }
    pruneRes() { // reservations entirely behind the frontier can no longer affect new content
      let n = 0;
      for (let i = 0; i < this.nRes; i++) if (this.resLo[i] < this.z) { this.resLane[n] = this.resLane[i]; this.resHi[n] = this.resHi[i]; this.resLo[n] = this.resLo[i]; n++; }
      this.nRes = n;
    }
  }

  // ------------------------------------------------------------------ public API
  // reset(z0, opts)      z0 = the player's feet z; opts = { seed, tutorial, clearUntil }. Content starts at
  //                      min(z0 - 60, clearUntil). The tutorial only opens a run (z0 > -10). Without opts the last seed is
  //                      kept. The first call also warms the JIT (~50-90 ms, once).
  // frontier             z of the far end of committed content (only moves when next() returns a chunk).
  // next() -> chunk|null  at most ONE fairness search per call; null = keep calling (never more than 6 nulls in a row).
  // clearAhead(pz, m)    drops every chunk reaching past pz and restarts at pz - max(60, m) with all lanes valid;
  //                      returns { dropped: [chunk ids], from }. Movers are only placed where their spawn point is still
  //                      ahead of pz (so they are created >= SPAWN_AHEAD away).
  // moverZ(item, pz)     front z of an oncoming train when the player's feet are at pz (speed depends on distance only).
  // chunk = { id, pattern, zStart, zEnd, D, tags, items, coins, pickups, path, tutorial? }
  //   item   { type: 'train'|'ramp'|'hurdle'|'bar'|'block', lane, zF, zB, vz, cars, ramped? (trains),
  //            meetZ, spawnPz, len (oncoming: zF/zB = position when the player is at spawnPz, 520 m ahead) }
  //   coin   { lane, y, z }   pickup { kind: 'magnet'|'sneakers'|'double'|'jetpack'|'board', lane, y, z }
  //   path   [{ z, lane, action }]  decreasing z; first = entry lane ('none'); then every input: press when the feet
  //          reach z; lane = lane after the input
  //   tutorial { step (0-6), total, last, action, label, hint: { key, touch }, zAct }
  const dir = new Director();
  const api = {
    reset: (z0, opts) => dir.reset(z0, opts),
    next: () => dir.next(),
    clearAhead: (pz, metres) => dir.clearAhead(pz, metres),
    moverZ, timeBetween,
    PATTERNS, TUTORIAL, ACTIONS, FAIR, ZONE,
    // internals for the node / browser test tools (not for game code)
    _t: {
      difficulty, zoneHit, jetpackUnsafe, moverSpawnPz, PERMS, dir,
      // validate a pattern (rows, perm) placed at z (no placement rules) from the lanes in entryMask
      validate(rows, perm, z, entryMask, beat, lead) {
        const sz = dir.z, sr = dir.nRes, dAbs = -z, df = difficulty(dAbs, dAbs, {});
        dir.z = z; dir.nRes = 0; dir.raw = true;
        dir.inst(rows, perm || [0, 1, 2], beat || df.beat, lead || df.lead, 0);
        dir.raw = false;
        const items = SC.slice(0, SCn).map((o) => Object.assign({}, o)), zEnd = INST.zEnd;
        const N = buildGrid(SC, SCn, z, zEnd);
        const r = dpRun(N, entryMask === undefined ? 7 : entryMask, -1, dir.rankLanes(1));
        dir.z = sz; dir.nRes = sr;
        return { ok: r.ok, exits: r.exits, failTick: r.failTick, work: r.work, N, zEnd, items };
      }
    }
  };
  Object.defineProperty(api, 'frontier', { get: () => dir.z, enumerable: true });
  Object.defineProperty(api, 'stats', { get: () => dir.stats, enumerable: true });
  Object.defineProperty(api, 'seed', { get: () => dir.seed, enumerable: true });
  RR.register('director', api);
})(window.RR);
