/* Rainbow Rails — obstacles (js/obstacles.js)
 *
 * Turns RR.director chunks into pooled, instanced 3D objects and answers the collision queries of game.js.
 *   - Every visual is an instance in a small set of InstancedMeshes ("layers"): no geometry, material or texture is
 *     created after init. A record's visual ("vis") is a list of parts = (layer, slot, local transform).
 *     Layers are packed densely (swap-remove), so every layer is one draw call whatever the number of objects.
 *   - Trains: ExtrudeGeometry body (large-radius roof, tumblehome) + chamfered cab nose + continuous anti-slip roof
 *     walkway (top exactly TRAIN_H), bogies, underframe, bellows, roof kits (off the walkway), glowing lamps.
 *     Livery atlas (8 liveries + 2 warning liveries for oncoming trains) with graffiti tags; glass reflects the sky.
 *   - Hurdle / bar / block: one hazard language (yellow-black chevrons, blinking lamps) with a skin per world.
 *     Hit shapes are identical in every world (RR.C constants).
 *   - Coins: 2 InstancedMeshes (near / far LOD) of a lathed coin, spun in the vertex shader, matcap gold + glints.
 *   - Pickups: 3D icon in a fresnel bubble with a light pillar.
 *   - Oncoming trains are positioned from the player's z (RR.director.moverZ): speed depends only on distance, so the
 *     meeting point is exact at any frame rate and probe() sweeps the train's own motion between two sim steps.
 * Hot-path queries (probe, laneBlocked, collect, passed, markNear) allocate nothing and reuse their result objects.
 */
(function (RR) {
  'use strict';
  if (!RR || !RR.C) return;
  const C = RR.C;
  const LANES = C.LANES, TRAIN_H = C.TRAIN_H, HD = C.HALF_D, HW = C.HALF_W;
  const PI = Math.PI, TAU = PI * 2;

  // ------------------------------------------------------------------ tuning
  const T = {
    CAR_GAP: 0.5, // gap between two cars (bellows)
    NOSE_BT: 0.34, NOSE_D: 0.7, NOSE_LEAN: 0.22, // cab nose: bevel depth, straight part, windscreen lean
    WALK_W: 1.2, WALK_Y0: 2.86, // roof walkway (top is TRAIN_H)
    GEN_CALLS: 2, // director.next() calls per frame
    RESET_CALLS: 600,
    POP_T: 0.4, POOF_T: 0.26, POP_DIST: 430, POOF_DIST: 160, POOF_FX_DIST: 90,
    COIN_CAP: 1024, COIN_NEAR: 95, COIN_HIDE: 2, // coins are hidden once z > pz + COIN_HIDE
    MAG_SPEED: 30, MAG_AHEAD: 26, MAG_BACK: 2,
    SKY_SPACING: 2.4,
    PICK_CAP: 12
  };
  const NOSE_L = T.NOSE_BT + T.NOSE_D; // visible nose length
  const WALK_FRONT = T.NOSE_BT + T.NOSE_LEAN + 0.02; // the roof reaches full height this far behind zF
  const KIND_COLOR = { magnet: 0xff4a5a, sneakers: 0x3dff8a, double: 0xb07bff, jetpack: 0xffa028, board: 0x33d6ff };
  const KINDS = ['magnet', 'sneakers', 'double', 'jetpack', 'board'];
  const WORLD_KINDS = ['city', 'beach', 'candy', 'neon', 'snow'];

  // ------------------------------------------------------------------ small helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash = (a) => { let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  const worldAt = (z) => (RR.worldIndexAt ? RR.worldIndexAt(z) : 0);
  const FONT = RR.FONT_DISPLAY || 'sans-serif';
  let warnedOverflow = false, warnedDirector = false;

  // ------------------------------------------------------------------ records (live obstacle list)
  const list = []; // live records (contract)
  const recPool = [];
  let nextId = 1;
  function newRec() {
    return recPool.pop() || { id: 0, type: '', lane: 0, x: 0, zF: 0, zB: 0, top: 0, bottom: 0, vz: 0, cars: 0, passed: false, nearCand: false,
      chunk: 0, meetZ: 0, len: 0, ramped: false, world: 0, livery: 0, ghost: false, vis: null, _i: -1, _pa: NaN, _fa: 0, _pb: NaN, _fb: 0 };
  }
  function addRec(r) { r._i = list.length; list.push(r); }
  function removeRec(r) {
    const i = r._i; if (i < 0 || list[i] !== r) return;
    const last = list.pop();
    if (last !== r) { list[i] = last; last._i = i; }
    r._i = -1;
  }

  // Oncoming trains: front z as a function of the player's z, i.e. meetZ - vz * (time the runner needs from pz to
  // meetZ). Speed depends only on distance (RR.speedAt), so this is exact at any frame rate. Same Simpson rule as
  // RR.director.moverZ (verified equal in the tests). Results are written into the record (no boxed double returns)
  // with a 2-entry memo: probe asks for pzPrev, then pz; the next step's pzPrev is this step's pz.
  function syncMover(r, pz) {
    if (r._pa === pz) { r.zF = r._fa; r.zB = r._fa - r.len; return; }
    if (r._pb === pz) { r.zF = r._fb; r.zB = r._fb - r.len; return; }
    const d0 = -pz, d1 = -r.meetZ;
    let t = 0;
    if (d0 !== d1) {
      const n = Math.max(2, 2 * Math.ceil(Math.abs(d1 - d0) / 60)), h = (d1 - d0) / n;
      const B = C.BASE_SPEED, K = C.MAX_SPEED - C.BASE_SPEED;
      let acc = 1 / (B + K * (1 - Math.exp(-Math.max(0, d0) / 2800))) + 1 / (B + K * (1 - Math.exp(-Math.max(0, d1) / 2800)));
      for (let i = 1; i < n; i++) acc += (i & 1 ? 4 : 2) / (B + K * (1 - Math.exp(-Math.max(0, d0 + i * h) / 2800)));
      t = (acc * h) / 3;
    }
    const f = r.meetZ - r.vz * t;
    r._pb = r._pa; r._fb = r._fa; r._pa = pz; r._fa = f;
    r.zF = f; r.zB = f - r.len;
  }

  // ------------------------------------------------------------------ coins (SoA, swap-remove)
  const CCAP = T.COIN_CAP;
  const cx = new Float32Array(CCAP), cy = new Float32Array(CCAP), cz = new Float32Array(CCAP);
  const cmag = new Uint8Array(CCAP), csky = new Uint8Array(CCAP), cchunk = new Int32Array(CCAP);
  let nCoins = 0;
  function addCoin(x, y, z, chunk, sky) {
    if (nCoins >= CCAP) return -1;
    const i = nCoins++;
    cx[i] = x; cy[i] = y; cz[i] = z; cmag[i] = 0; csky[i] = sky ? 1 : 0; cchunk[i] = chunk | 0;
    return i;
  }
  function removeCoin(i) {
    const l = --nCoins;
    if (i !== l) { cx[i] = cx[l]; cy[i] = cy[l]; cz[i] = cz[l]; cmag[i] = cmag[l]; csky[i] = csky[l]; cchunk[i] = cchunk[l]; }
  }

  // ------------------------------------------------------------------ pickups
  const picks = []; const pickPool = [];
  function newPick() { return pickPool.pop() || { kind: '', lane: 0, x: 0, y: 0, z: 0, chunk: 0, vis: null, ph: 0 }; }

  // result objects (reused). Arrays are emptied with pop(): truncating via .length = 0 drops V8's backing store and the
  // next push would allocate again; pop() keeps the capacity, so steady-state queries allocate nothing.
  const PR = { rampH: -0.5, ramp: null, train: null, hits: [] };
  const COL = { coins: 0, pickups: [] };
  const passedOut = [];
  const empty = (a) => { while (a.length) a.pop(); };
  [PR.hits, COL.pickups, passedOut].forEach((a) => { for (let i = 0; i < 48; i++) a.push(null); empty(a); });
  const SV = new Float64Array(2); // [0] pz of the last collect() call, [1] runner x at that call (typed: no boxing)
  SV[0] = NaN;

  // ================================================================== rendering state (built in init)
  let ready = false, ctx = null, scene = null, root = null, quality = RR.quality || null;
  let time = 0, inReset = false;
  const layers = []; // Layer objects
  const L = {}; // named layer indices
  const U = {}; // shared uniforms
  let livAtlas = null, hzAtlas = null, coinTex = null;
  let matBody = null, matProp = null, matCoin = null;
  const fxMats = [];

  // ------------------------------------------------------------------ canvas atlases
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const rr = (g, x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fontReady = () => { try { return !!(document.fonts && document.fonts.check && document.fonts.check('40px "Lilita One"')); } catch (e) { return false; } };

  // ---- livery atlas: 1024 x 2048. Rows 0..9 (128 px each) = car sides; slots (128 px) from y 1280: cabs 0..9, ends 10..19.
  const LV = { W: 1024, H: 2048, ROW: 128, SLOT_Y: 1280 };
  const MOD_PX = LV.W / 3; // one 4.5 m module
  const LIVERIES = [
    { base: '#d9e1ec', band: '#12a99c', band2: '#0b6f67', stripe: '#ffcf33', door: '#c3ceda', tags: 2 },
    { base: '#5fd1c1', band: '#ff6f91', band2: '#c9456c', stripe: '#ffffff', door: '#86ddd1', tags: 2 },
    { base: '#4ea6f2', band: '#1c2a6b', band2: '#131c4a', stripe: '#ff5fa2', door: '#7cbcf5', tags: 3 },
    { base: '#7ccc55', band: '#1d6f46', band2: '#134f31', stripe: '#fff1a8', door: '#9bd87b', tags: 2 },
    { base: '#8e62f0', band: '#ffc93d', band2: '#d69a12', stripe: '#ffffff', door: '#a887f3', tags: 2 },
    { base: '#1f8fa3', band: '#ffb38a', band2: '#e0845a', stripe: '#ffffff', door: '#4aa7b8', tags: 3 },
    { base: '#f26aa8', band: '#472a88', band2: '#301b61', stripe: '#9ff3ff', door: '#f58fbf', tags: 2 },
    { base: '#c7d0dc', band: '#3a6fd5', band2: '#284f9e', stripe: '#ff5fa2', door: '#dbe2ea', tags: 3 },
    { base: '#dd2f2b', band: '#ffcc1a', band2: '#1b1b22', stripe: '#ffffff', door: '#e8504c', tags: 0, warn: true },
    { base: '#f5b90f', band: '#dd2f2b', band2: '#1b1b22', stripe: '#1b1b22', door: '#f7cb4a', tags: 0, warn: true }
  ];
  const N_LIV = 8, WARN_LIV = 8;
  const TAG_WORDS = ['RAD', 'WOW', 'ZOOM', 'YO!', 'POP', 'BOOM', 'RUSH', 'FLY', 'JAZZ', 'NOVA', 'KAI', 'JUNO', 'SURF', 'COOL', 'GO!', 'VIBE', 'ACE', 'ZAP', 'WHOA', 'HYPE'];
  const TAG_PALS = [
    ['#ff4fa3', '#ffc2e0', '#2a0f4f', '#6a2a99'], ['#35d2ff', '#c4f5ff', '#0d2a5c', '#1f4f99'], ['#7dff6b', '#e4ffd6', '#0f3d1f', '#227a3f'],
    ['#ffd23f', '#fff5c0', '#4a1d00', '#9a4300'], ['#b07bff', '#eadcff', '#1e0b44', '#43208a'], ['#ff7a3d', '#ffd6bd', '#3d0f00', '#8a2f0a'],
    ['#ff3b5c', '#ffc0cb', '#330010', '#7a0f2a'], ['#3dffd2', '#d6fff5', '#003d33', '#0a6b5a']
  ];

  function star(g, x, y, r1, r2, n, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) { const r = i & 1 ? r2 : r1, a = rot + (i * PI) / n; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.closePath();
  }
  function heart(g, x, y, s) {
    g.beginPath(); g.moveTo(x, y + s * 0.35);
    g.bezierCurveTo(x - s * 0.9, y - s * 0.3, x - s * 0.35, y - s * 0.95, x, y - s * 0.4);
    g.bezierCurveTo(x + s * 0.35, y - s * 0.95, x + s * 0.9, y - s * 0.3, x, y + s * 0.35);
    g.closePath();
  }
  // bubble-letter graffiti tag with 3D extrusion, double outline, gradient fill, shine and drips
  function drawTag(g, word, x, y, size, rot, pal, rng) {
    const tw = Math.ceil(size * (word.length * 0.78 + 1.4)), th = Math.ceil(size * 2.1);
    const c = cv(tw, th), t = c.getContext('2d'), F = cv(tw, th), f = F.getContext('2d');
    const ox = tw / 2, oy = th / 2;
    [t, f].forEach((q) => { q.font = size + 'px ' + FONT; q.textAlign = 'center'; q.textBaseline = 'middle'; q.lineJoin = 'round'; q.lineCap = 'round'; });
    const dep = Math.max(3, Math.round(size * 0.1));
    t.strokeStyle = pal[2]; t.lineWidth = size * 0.3;
    for (let i = dep; i >= 0; i--) t.strokeText(word, ox + i * 0.9, oy + i);
    t.fillStyle = pal[3];
    for (let i = dep; i >= 1; i--) t.fillText(word, ox + i * 0.9, oy + i);
    t.strokeStyle = '#ffffff'; t.lineWidth = size * 0.13; t.strokeText(word, ox, oy);
    // fill + shine (clipped to the letters) on F
    const gr = f.createLinearGradient(0, oy - size * 0.45, 0, oy + size * 0.45);
    gr.addColorStop(0, pal[1]); gr.addColorStop(0.45, pal[0]); gr.addColorStop(1, pal[0]);
    f.fillStyle = gr; f.fillText(word, ox, oy);
    f.globalCompositeOperation = 'source-atop';
    const w = f.measureText(word).width;
    let acc = ox - w / 2;
    for (let i = 0; i < word.length; i++) {
      const cw = f.measureText(word[i]).width;
      f.fillStyle = 'rgba(255,255,255,0.85)';
      f.save(); f.translate(acc + cw * 0.3, oy - size * 0.2); f.rotate(-0.5);
      f.beginPath(); f.ellipse(0, 0, size * 0.06, size * 0.15, 0, 0, TAU); f.fill(); f.restore();
      f.fillStyle = 'rgba(0,0,0,0.18)'; f.fillRect(acc, oy + size * 0.12, cw, size * 0.4);
      acc += cw;
    }
    f.globalCompositeOperation = 'source-over';
    t.drawImage(F, 0, 0);
    // drips
    const nd = 2 + ((rng.next() * 3) | 0);
    for (let i = 0; i < nd; i++) {
      const dx = ox - w * 0.42 + rng.next() * w * 0.84, len = size * (0.15 + rng.next() * 0.45);
      t.strokeStyle = pal[2]; t.lineWidth = size * 0.1; t.beginPath(); t.moveTo(dx, oy + size * 0.28); t.lineTo(dx, oy + size * 0.28 + len); t.stroke();
      t.strokeStyle = pal[0]; t.lineWidth = size * 0.055; t.beginPath(); t.moveTo(dx, oy + size * 0.24); t.lineTo(dx, oy + size * 0.28 + len); t.stroke();
      t.fillStyle = pal[0]; t.beginPath(); t.arc(dx, oy + size * 0.3 + len, size * 0.05, 0, TAU); t.fill();
    }
    g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(c, -ox, -oy); g.restore();
  }
  function doodle(g, x, y, s, kind, col, rng) {
    g.save(); g.lineJoin = 'round'; g.strokeStyle = '#1b1030'; g.lineWidth = Math.max(2, s * 0.14); g.fillStyle = col;
    if (kind === 0) { star(g, x, y, s, s * 0.45, 5, -PI / 2); g.stroke(); g.fill(); }
    else if (kind === 1) { heart(g, x, y, s); g.stroke(); g.fill(); }
    else if (kind === 2) { // crown
      g.beginPath(); g.moveTo(x - s, y + s * 0.5); g.lineTo(x - s, y - s * 0.4); g.lineTo(x - s * 0.5, y); g.lineTo(x, y - s * 0.7); g.lineTo(x + s * 0.5, y); g.lineTo(x + s, y - s * 0.4); g.lineTo(x + s, y + s * 0.5); g.closePath(); g.stroke(); g.fill();
    } else if (kind === 3) { // arrow
      g.beginPath(); g.moveTo(x - s, y - s * 0.2); g.lineTo(x + s * 0.2, y - s * 0.2); g.lineTo(x + s * 0.2, y - s * 0.6); g.lineTo(x + s, y); g.lineTo(x + s * 0.2, y + s * 0.6); g.lineTo(x + s * 0.2, y + s * 0.2); g.lineTo(x - s, y + s * 0.2); g.closePath(); g.stroke(); g.fill();
    } else { // spray dots
      for (let i = 0; i < 14; i++) { g.fillStyle = col; g.beginPath(); g.arc(x + (rng.next() - 0.5) * s * 2, y + (rng.next() - 0.5) * s * 1.2, s * 0.08 + rng.next() * s * 0.08, 0, TAU); g.fill(); }
    }
    g.restore();
  }

  // metres (car side) -> row pixel (vSide 1 at the row top): windows etc. are authored in pixels of the 128 px row
  function paintSideRow(g, r, Lv, rng) {
    const y0 = r * LV.ROW, W = LV.W, M = MOD_PX;
    g.save(); g.beginPath(); g.rect(0, y0, W, LV.ROW); g.clip();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = Lv.base; g.fillRect(0, y0, W, LV.ROW);
    let gr = g.createLinearGradient(0, y0, 0, y0 + LV.ROW);
    gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = gr; g.fillRect(0, y0, W, LV.ROW);
    g.fillStyle = Lv.band2; g.fillRect(0, y0, W, 8);
    g.fillStyle = Lv.stripe; g.fillRect(0, y0 + 9, W, 3);
    g.fillStyle = Lv.band; g.fillRect(0, y0 + 84, W, 33);
    g.fillStyle = Lv.stripe; g.fillRect(0, y0 + 79, W, 3); g.fillRect(0, y0 + 117, W, 2);
    if (Lv.warn) { // hazard stripes along the lower band
      g.save(); g.beginPath(); g.rect(0, y0 + 86, W, 29); g.clip(); g.fillStyle = Lv.band2;
      for (let x = -40; x < W + 40; x += 28) { g.beginPath(); g.moveTo(x, y0 + 115); g.lineTo(x + 14, y0 + 115); g.lineTo(x + 43, y0 + 86); g.lineTo(x + 29, y0 + 86); g.closePath(); g.fill(); }
      g.restore();
    }
    g.fillStyle = '#25252d'; g.fillRect(0, y0 + 120, W, 8);
    // doors (behind graffiti)
    for (let m = 0; m < 3; m++) {
      const dx = m * M + M / 2 - 48;
      g.fillStyle = Lv.door; rr(g, dx, y0 + 16, 96, 104, 5); g.fill();
    }
    // graffiti
    const big = [];
    if (Lv.tags) {
      const nt = Lv.tags;
      for (let i = 0; i < nt; i++) {
        const word = TAG_WORDS[(rng.next() * TAG_WORDS.length) | 0], pal = TAG_PALS[(rng.next() * TAG_PALS.length) | 0];
        const x = 90 + ((i + 0.15 + rng.next() * 0.7) / nt) * (W - 180);
        if (i === 1 || (nt === 2 && i === 0 && r % 2)) big.push([word, x, pal]); // drawn over the glass below
        else drawTag(g, word, x, y0 + 82 + rng.next() * 10, 52 + rng.next() * 18, -0.12 + rng.next() * 0.18, pal, rng);
      }
      for (let i = 0; i < 5; i++) doodle(g, 30 + rng.next() * (W - 60), y0 + 96 + rng.next() * 18, 7 + rng.next() * 7, (rng.next() * 5) | 0, TAG_PALS[(rng.next() * TAG_PALS.length) | 0][0], rng);
    }
    // glass: punch windows and door windows (alpha 0 = glass for the shader)
    g.globalCompositeOperation = 'destination-out';
    for (let m = 0; m < 3; m++) {
      const x0 = m * M, dx = x0 + M / 2 - 48;
      rr(g, x0 + 15, y0 + 22, M / 2 - 76, 48, 9); g.fill();
      rr(g, dx + 110, y0 + 22, M / 2 - 76, 48, 9); g.fill();
      rr(g, dx + 9, y0 + 25, 32, 42, 6); g.fill();
      rr(g, dx + 55, y0 + 25, 32, 42, 6); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#1b1c24'; g.lineWidth = 3;
    for (let m = 0; m < 3; m++) {
      const x0 = m * M, dx = x0 + M / 2 - 48;
      rr(g, x0 + 15, y0 + 22, M / 2 - 76, 48, 9); g.stroke();
      rr(g, dx + 110, y0 + 22, M / 2 - 76, 48, 9); g.stroke();
      rr(g, dx + 9, y0 + 25, 32, 42, 6); g.stroke();
      rr(g, dx + 55, y0 + 25, 32, 42, 6); g.stroke();
      g.lineWidth = 2.5; rr(g, dx, y0 + 16, 96, 104, 5); g.stroke();
      g.beginPath(); g.moveTo(dx + 48, y0 + 16); g.lineTo(dx + 48, y0 + 120); g.stroke();
      g.lineWidth = 3;
      // module seams + rivets
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x0, y0 + 12, 2, 108);
      g.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 6; k++) g.fillRect(x0 + 5, y0 + 18 + k * 17, 2, 2);
      // car number + tiny logo
      g.fillStyle = Lv.warn ? '#ffffff' : '#1d2030'; g.font = '11px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText((m === 1 ? 'RR ' : '') + (100 + ((rng.next() * 899) | 0)), x0 + 18, y0 + 80);
    }
    for (let i = 0; i < big.length; i++) drawTag(g, big[i][0], big[i][1], y0 + 64 + rng.next() * 12, 76 + rng.next() * 14, -0.1 + rng.next() * 0.14, big[i][2], rng);
    if (!Lv.warn) { // rainbow stripe logo on the middle module lower band
      const lx = M * 1.5 - 150, cols = ['#ff5a5f', '#ffb13d', '#ffe14d', '#5fe07a', '#3fb6ff', '#8e6bff'];
      for (let k = 0; k < 6; k++) { g.fillStyle = cols[k]; g.fillRect(lx - 30 + k * 5, y0 + 88, 4, 25); }
    }
    gr = g.createLinearGradient(0, y0 + 96, 0, y0 + 128);
    gr.addColorStop(0, 'rgba(40,30,20,0)'); gr.addColorStop(1, 'rgba(40,30,20,0.28)');
    g.fillStyle = gr; g.fillRect(0, y0 + 96, W, 32);
    g.restore();
  }
  // cab / end slots: x in [-1.1, 1.1] m, y in [0.72, 2.94] m mapped to 128 px (uv from ExtrudeGeometry caps)
  function slotXY(s) { return [(s % 8) * 128, LV.SLOT_Y + Math.floor(s / 8) * 128]; }
  function paintCab(g, r, Lv) {
    const [sx, sy] = slotXY(r), X = (x) => sx + ((x + 1.1) / 2.2) * 128, Y = (y) => sy + ((2.94 - y) / 2.22) * 128;
    g.save(); g.beginPath(); g.rect(sx, sy, 128, 128); g.clip();
    g.fillStyle = Lv.base; g.fillRect(sx, sy, 128, 128);
    const gr = g.createLinearGradient(0, sy, 0, sy + 128); gr.addColorStop(0, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = gr; g.fillRect(sx, sy, 128, 128);
    g.fillStyle = Lv.band; g.fillRect(sx, Y(1.3), 128, Y(0.92) - Y(1.3));
    g.fillStyle = Lv.stripe; g.fillRect(sx, Y(1.34), 128, 2);
    if (Lv.warn) { // big chevrons on the nose
      g.save(); g.beginPath(); g.rect(sx, Y(1.62), 128, Y(0.9) - Y(1.62)); g.clip();
      for (let i = -3; i < 8; i++) { g.fillStyle = i & 1 ? '#1b1b22' : '#ffcc1a'; const cx0 = X(0), yy = Y(1.62) + i * 10; g.beginPath(); g.moveTo(sx, yy); g.lineTo(cx0, yy + 22); g.lineTo(sx + 128, yy); g.lineTo(sx + 128, yy + 10); g.lineTo(cx0, yy + 32); g.lineTo(sx, yy + 10); g.closePath(); g.fill(); }
      g.restore();
    }
    // windscreen (glass)
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(X(-0.78), Y(1.74)); g.lineTo(X(0.78), Y(1.74)); g.lineTo(X(0.7), Y(2.56)); g.lineTo(X(-0.7), Y(2.56)); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#17181f'; g.lineWidth = 4; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(X(-0.78), Y(1.74)); g.lineTo(X(0.78), Y(1.74)); g.lineTo(X(0.7), Y(2.56)); g.lineTo(X(-0.7), Y(2.56)); g.closePath(); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(X(0), Y(1.74)); g.lineTo(X(0), Y(2.56)); g.stroke();
    // wiper
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(-0.4), Y(1.77)); g.lineTo(X(-0.62), Y(2.2)); g.stroke();
    // destination board
    g.fillStyle = '#17181f'; g.fillRect(X(-0.55), Y(2.74), X(0.55) - X(-0.55), Y(2.6) - Y(2.74));
    g.fillStyle = '#ffb627'; g.font = '8px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(Lv.warn ? '! ! EXPRESS ! !' : 'RAINBOW LINE', X(0), (Y(2.74) + Y(2.6)) / 2 + 0.5);
    // headlight housings
    g.fillStyle = '#1d1e26';
    rr(g, X(-0.88), Y(1.16), X(-0.48) - X(-0.88), Y(0.88) - Y(1.16), 5); g.fill();
    rr(g, X(0.48), Y(1.16), X(0.88) - X(0.48), Y(0.88) - Y(1.16), 5); g.fill();
    if (!Lv.warn) { // rainbow logo + number
      const cols = ['#ff5a5f', '#ffb13d', '#ffe14d', '#5fe07a', '#3fb6ff', '#8e6bff'];
      for (let k = 0; k < 6; k++) { g.strokeStyle = cols[k]; g.lineWidth = 2.2; g.beginPath(); g.arc(X(0), Y(1.4), 16 - k * 2.2, PI, TAU); g.stroke(); }
      g.fillStyle = '#1d2030'; g.font = '12px ' + FONT; g.fillText('0' + (r + 1), X(0), Y(1.12));
    } else { g.fillStyle = '#1b1b22'; g.font = '16px ' + FONT; g.fillText('!', X(0), Y(1.25)); }
    g.fillStyle = '#2a2b33'; g.fillRect(sx, Y(0.88), 128, 128);
    g.fillStyle = '#ffcc1a'; for (let i = 0; i < 8; i++) g.fillRect(sx + 4 + i * 16, Y(0.84), 8, 3);
    g.restore();
  }
  function paintEnd(g, r, Lv) {
    const [sx, sy] = slotXY(10 + r), X = (x) => sx + ((x + 1.1) / 2.2) * 128, Y = (y) => sy + ((2.94 - y) / 2.22) * 128;
    g.save(); g.beginPath(); g.rect(sx, sy, 128, 128); g.clip();
    g.fillStyle = Lv.base; g.fillRect(sx, sy, 128, 128);
    g.fillStyle = Lv.band; g.fillRect(sx, Y(1.3), 128, Y(0.92) - Y(1.3));
    g.fillStyle = '#3a3c46'; rr(g, X(-0.42), Y(2.46), X(0.42) - X(-0.42), Y(0.8) - Y(2.46), 4); g.fill();
    g.globalCompositeOperation = 'destination-out'; rr(g, X(-0.28), Y(2.3), X(0.28) - X(-0.28), Y(1.72) - Y(2.3), 4); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#17181f'; g.lineWidth = 2; rr(g, X(-0.28), Y(2.3), X(0.28) - X(-0.28), Y(1.72) - Y(2.3), 4); g.stroke();
    g.fillStyle = '#9aa0ad'; g.fillRect(X(-0.62), Y(2.2), 3, 40); g.fillRect(X(0.6), Y(2.2), 3, 40);
    g.fillStyle = '#2a2b33'; g.fillRect(sx, Y(0.84), 128, 128);
    g.restore();
  }
  function paintLiveries(g) {
    g.clearRect(0, 0, LV.W, LV.H);
    const rng = RR.makeRng(0x7a11);
    for (let r = 0; r < LIVERIES.length; r++) paintSideRow(g, r, LIVERIES[r], rng);
    for (let r = 0; r < LIVERIES.length; r++) { paintCab(g, r, LIVERIES[r]); paintEnd(g, r, LIVERIES[r]); }
  }

  // ---- hazard atlas: 1024 x 1024, regions [x, y, w, h] in pixels
  const HZ_W = 1024, HZ_H = 1024;
  const HZ = {
    WHITE: [0, 0, 16, 16], CHEV: [16, 0, 256, 64], CHEVB: [272, 0, 256, 64], OW: [528, 0, 256, 64], RW: [784, 0, 240, 64],
    LOW: [0, 64, 256, 228], TIKISIGN: [256, 64, 256, 228], FROSTSIGN: [512, 64, 256, 140], BUOYSIGN: [512, 204, 256, 116], CONC: [768, 64, 176, 256], CRATE: [944, 64, 80, 112],
    CHOC: [0, 320, 176, 256], NEONP: [176, 320, 176, 256], ICE: [352, 320, 176, 256], TIKI: [528, 320, 96, 256],
    BARK: [624, 320, 128, 128], RINGS: [752, 320, 128, 128], LICO: [880, 320, 144, 32], LOLLI: [880, 352, 128, 128],
    ARROW: [624, 448, 128, 128], NEONSIGN: [752, 448, 128, 64], WAFER: [880, 480, 128, 96],
    DECK0: [0, 576, 128, 256], DECK1: [128, 576, 128, 256], DECK2: [256, 576, 128, 256], DECK3: [384, 576, 128, 256], DECK4: [512, 576, 128, 256],
    CANDYSIGN: [640, 576, 256, 140]
  };
  const HZUV = {};
  Object.keys(HZ).forEach((k) => { const r = HZ[k]; HZUV[k] = [(r[0] + 1) / HZ_W, 1 - (r[1] + r[3] - 1) / HZ_H, (r[0] + r[2] - 1) / HZ_W, 1 - (r[1] + 1) / HZ_H]; });
  const WHITE_UV = [(HZ.WHITE[0] + 8) / HZ_W, 1 - (HZ.WHITE[1] + 8) / HZ_H];

  function stripes(g, r, c1, c2, w, slope) {
    const [x, y, W, H] = r;
    g.save(); g.beginPath(); g.rect(x, y, W, H); g.clip();
    g.fillStyle = c1; g.fillRect(x, y, W, H); g.fillStyle = c2;
    for (let s = -H * 2; s < W + H * 2; s += w * 2) { g.beginPath(); g.moveTo(x + s, y + H); g.lineTo(x + s + w, y + H); g.lineTo(x + s + w + H * slope, y); g.lineTo(x + s + H * slope, y); g.closePath(); g.fill(); }
    g.restore();
  }
  function noise(g, r, n, a, rng, col) {
    const [x, y, W, H] = r;
    for (let i = 0; i < n; i++) { g.fillStyle = col || (rng.next() < 0.5 ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,255,255,' + a + ')'); g.fillRect(x + rng.next() * W, y + rng.next() * H, 1 + rng.next() * 2.5, 1 + rng.next() * 2.5); }
  }
  function txt(g, s, x, y, size, fill, stroke, lw) {
    g.font = size + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || size * 0.18; g.strokeText(s, x, y); }
    g.fillStyle = fill; g.fillText(s, x, y);
  }
  function hzBorder(g, r, lw, col) { const [x, y, W, H] = r; g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(x + lw / 2, y + lw / 2, W - lw, H - lw); }
  function paintHazard(g) {
    const rng = RR.makeRng(0x4a2d);
    g.clearRect(0, 0, HZ_W, HZ_H);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
    stripes(g, HZ.CHEV, '#f7c21b', '#1c1c21', 16, 1);
    { // CHEVB: yellow with black upward chevrons
      const [x, y, W, H] = HZ.CHEVB; g.fillStyle = '#f7c21b'; g.fillRect(x, y, W, H); g.fillStyle = '#1c1c21';
      for (let k = 0; k < 6; k++) { const cx0 = x + 22 + k * 43; g.beginPath(); g.moveTo(cx0 - 16, y + 50); g.lineTo(cx0, y + 20); g.lineTo(cx0 + 16, y + 50); g.lineTo(cx0 + 8, y + 50); g.lineTo(cx0, y + 34); g.lineTo(cx0 - 8, y + 50); g.closePath(); g.fill(); }
    }
    stripes(g, HZ.OW, '#f2f2ee', '#ff6a14', 22, 1);
    { const [x, y, W, H] = HZ.OW; const gr = g.createLinearGradient(0, y, 0, y + H); gr.addColorStop(0, 'rgba(255,255,255,0.3)'); gr.addColorStop(0.4, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.15)'); g.fillStyle = gr; g.fillRect(x, y, W, H); }
    stripes(g, HZ.RW, '#fbf6f4', '#e2262e', 14, 1.6);
    { // LOW CLEARANCE sign
      const r = HZ.LOW, [x, y, W, H] = r;
      g.fillStyle = '#ffc81a'; g.fillRect(x, y, W, H);
      stripes(g, [x, y + H - 34, W, 34], '#f7c21b', '#1c1c21', 14, 1);
      stripes(g, [x, y, W, 20], '#f7c21b', '#1c1c21', 14, 1);
      hzBorder(g, r, 8, '#1c1c21');
      txt(g, 'LOW', x + W / 2, y + 58, 58, '#1c1c21');
      txt(g, 'CLEARANCE', x + W / 2, y + 100, 25, '#1c1c21');
      g.fillStyle = '#1c1c21'; g.fillRect(x + 40, y + 124, W - 80, 7);
      g.beginPath(); g.moveTo(x + W / 2 - 26, y + 140); g.lineTo(x + W / 2 + 26, y + 140); g.lineTo(x + W / 2, y + 180); g.closePath(); g.fill();
      g.fillStyle = '#e2262e'; g.beginPath(); g.arc(x + 30, y + 160, 10, 0, TAU); g.fill(); g.beginPath(); g.arc(x + W - 30, y + 160, 10, 0, TAU); g.fill();
    }
    { // tiki sign: woven straw, "DUCK!"
      const r = HZ.TIKISIGN, [x, y, W, H] = r;
      g.fillStyle = '#d9b36c'; g.fillRect(x, y, W, H);
      for (let i = 0; i < W; i += 10) { g.fillStyle = (i / 10) & 1 ? 'rgba(120,80,30,0.25)' : 'rgba(255,240,200,0.2)'; g.fillRect(x + i, y, 5, H); }
      for (let j = 0; j < H; j += 10) { g.fillStyle = (j / 10) & 1 ? 'rgba(120,80,30,0.18)' : 'rgba(255,240,200,0.14)'; g.fillRect(x, y + j, W, 5); }
      hzBorder(g, r, 12, '#6b3f1d');
      stripes(g, [x + 12, y + H - 40, W - 24, 28], '#f7c21b', '#1c1c21', 12, 1);
      txt(g, 'DUCK!', x + W / 2, y + 74, 62, '#ff5a2a', '#3a1c08', 12);
      g.strokeStyle = '#1fa5b8'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath();
      for (let i = 0; i <= 40; i++) { const px = x + 36 + i * ((W - 72) / 40), py = y + 140 + Math.sin(i * 0.55) * 9; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke();
      [[x + 26, y + 26], [x + W - 26, y + 26]].forEach(([hx, hy]) => { g.fillStyle = '#ff4f8a'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(hx + Math.cos(k * 1.256) * 8, hy + Math.sin(k * 1.256) * 8, 7, 0, TAU); g.fill(); } g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(hx, hy, 5, 0, TAU); g.fill(); });
    }
    { // frost sign: wooden, snow on top, "LOW!"
      const r = HZ.FROSTSIGN, [x, y, W, H] = r;
      for (let j = 0; j < 4; j++) { g.fillStyle = j & 1 ? '#8a5a32' : '#9a6a3c'; g.fillRect(x, y + j * (H / 4), W, H / 4); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + (j + 1) * (H / 4) - 2, W, 2); }
      stripes(g, [x + 10, y + H - 30, W - 20, 20], '#f7c21b', '#1c1c21', 12, 1);
      txt(g, 'LOW!', x + W / 2, y + 64, 54, '#eaf6ff', '#1b3a66', 10);
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + W, y);
      for (let i = W; i >= 0; i -= 16) g.lineTo(x + i, y + 10 + (((i / 16) | 0) % 2) * 6 + rng.next() * 4);
      g.closePath(); g.fill();
    }
    { // concrete barrier face
      const r = HZ.CONC, [x, y, W, H] = r;
      g.fillStyle = '#b9b3aa'; g.fillRect(x, y, W, H); noise(g, r, 900, 0.08, rng);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let j = 1; j < 4; j++) g.fillRect(x, y + j * (H / 4), W, 2);
      stripes(g, [x + 14, y + 66, W - 28, 96], '#f7c21b', '#1c1c21', 16, 1);
      hzBorder(g, [x + 14, y + 66, W - 28, 96], 4, '#1c1c21');
      txt(g, 'ROAD', x + W / 2, y + 26, 26, '#1c1c21');
      txt(g, 'CLOSED', x + W / 2, y + 50, 22, '#1c1c21');
      g.fillStyle = '#e2262e'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + 26 + k * ((W - 52) / 4), y + 184, 7, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(40,36,30,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 30, y + H); g.lineTo(x + 44, y + 220); g.lineTo(x + 38, y + 200); g.stroke();
      const gr = g.createLinearGradient(0, y + H - 50, 0, y + H); gr.addColorStop(0, 'rgba(60,50,40,0)'); gr.addColorStop(1, 'rgba(60,50,40,0.35)'); g.fillStyle = gr; g.fillRect(x, y + H - 50, W, 50);
    }
    { // crate
      const r = HZ.CRATE, [x, y, W, H] = r;
      g.fillStyle = '#b77c42'; g.fillRect(x, y, W, H);
      for (let j = 0; j < 5; j++) { g.fillStyle = j & 1 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'; g.fillRect(x, y + j * (H / 5), W, H / 5); g.fillStyle = 'rgba(60,30,10,0.4)'; g.fillRect(x, y + j * (H / 5), W, 1.5); }
      g.strokeStyle = '#7a4a22'; g.lineWidth = 9; g.strokeRect(x + 4.5, y + 4.5, W - 9, H - 9);
      g.beginPath(); g.moveTo(x + 8, y + H - 8); g.lineTo(x + W - 8, y + 8); g.stroke();
      txt(g, 'SURF', x + W / 2, y + H / 2 + 22, 16, '#2b1a0c');
    }
    { // chocolate bar
      const r = HZ.CHOC, [x, y, W, H] = r;
      g.fillStyle = '#5a321c'; g.fillRect(x, y, W, H);
      const cw = (W - 12) / 3, ch = (H * 0.72 - 12) / 4;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
        const px = x + 6 + i * cw, py = y + 6 + j * ch;
        g.fillStyle = '#6e3f23'; g.fillRect(px + 3, py + 3, cw - 6, ch - 6);
        g.fillStyle = 'rgba(255,220,180,0.18)'; g.fillRect(px + 3, py + 3, cw - 6, 4); g.fillRect(px + 3, py + 3, 4, ch - 6);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px + 3, py + ch - 7, cw - 6, 4);
      }
      const wy = y + H * 0.72; g.fillStyle = '#d8232e'; g.fillRect(x, wy, W, H - (wy - y));
      stripes(g, [x, wy - 2, W, 16], '#f7c21b', '#1c1c21', 10, 1);
      g.fillStyle = '#ffd23f'; g.fillRect(x, y + H - 6, W, 6);
      txt(g, 'CHOCO', x + W / 2, wy + 42, 30, '#ffe9a8', '#6a0c12', 6);
    }
    { // neon panel
      const r = HZ.NEONP, [x, y, W, H] = r;
      g.fillStyle = '#0d0a26'; g.fillRect(x, y, W, H);
      g.strokeStyle = 'rgba(57,240,255,0.35)'; g.lineWidth = 1; for (let i = 0; i <= W; i += 16) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i, y + H); g.stroke(); } for (let j = 0; j <= H; j += 16) { g.beginPath(); g.moveTo(x, y + j); g.lineTo(x + W, y + j); g.stroke(); }
      g.strokeStyle = '#ff3fd2'; g.lineWidth = 6; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x + W / 2, y + 60); g.lineTo(x + W / 2 + 52, y + 150); g.lineTo(x + W / 2 - 52, y + 150); g.closePath(); g.stroke();
      txt(g, '!', x + W / 2, y + 122, 50, '#ff3fd2');
      txt(g, 'NO ENTRY', x + W / 2, y + 190, 22, '#39f0ff');
      stripes(g, [x + 8, y + H - 26, W - 16, 16], '#f7c21b', '#1c1c21', 10, 1);
    }
    { // ice block with a frozen hazard sign inside
      const r = HZ.ICE, [x, y, W, H] = r;
      const gr = g.createLinearGradient(x, y, x + W, y + H); gr.addColorStop(0, '#d6f4ff'); gr.addColorStop(0.5, '#a6dcf7'); gr.addColorStop(1, '#79bde9'); g.fillStyle = gr; g.fillRect(x, y, W, H);
      g.globalAlpha = 0.5; stripes(g, [x + 24, y + 80, W - 48, 90], '#f7c21b', '#1c1c21', 14, 1); g.globalAlpha = 1;
      g.fillStyle = 'rgba(214,244,255,0.35)'; g.fillRect(x + 24, y + 80, W - 48, 90);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5;
      for (let k = 0; k < 7; k++) { let px = x + rng.next() * W, py = y + rng.next() * H; g.beginPath(); g.moveTo(px, py); for (let s = 0; s < 4; s++) { px += (rng.next() - 0.5) * 50; py += (rng.next() - 0.5) * 50; g.lineTo(px, py); } g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.6)'; for (let k = 0; k < 30; k++) { g.beginPath(); g.arc(x + rng.next() * W, y + rng.next() * H, 1 + rng.next() * 2.5, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x + 10, y + 10); g.lineTo(x + 50, y + 10); g.lineTo(x + 10, y + 80); g.closePath(); g.fill();
    }
    { // tiki post wrap
      const r = HZ.TIKI, [x, y, W, H] = r;
      g.fillStyle = '#8a5a2e'; g.fillRect(x, y, W, H); noise(g, r, 300, 0.1, rng);
      for (let f = 0; f < 3; f++) {
        const fy = y + 12 + f * 82, cxm = x + W / 2;
        g.fillStyle = '#5e3a1a'; g.fillRect(x, fy, W, 70);
        g.fillStyle = '#f2e3c2'; g.beginPath(); g.arc(cxm - 14, fy + 22, 9, 0, TAU); g.arc(cxm + 14, fy + 22, 9, 0, TAU); g.fill();
        g.fillStyle = '#1a1008'; g.beginPath(); g.arc(cxm - 14, fy + 22, 4, 0, TAU); g.arc(cxm + 14, fy + 22, 4, 0, TAU); g.fill();
        g.fillStyle = f === 1 ? '#1fa5b8' : '#e2472e'; g.fillRect(cxm - 20, fy + 40, 40, 16);
        g.fillStyle = '#f2e3c2'; for (let k = 0; k < 5; k++) g.fillRect(cxm - 17 + k * 7, fy + 42, 4, 12);
        g.fillStyle = '#c9892f'; g.fillRect(x, fy + 64, W, 5);
      }
    }
    { // bark
      const r = HZ.BARK, [x, y, W, H] = r;
      g.fillStyle = '#6e4a2e'; g.fillRect(x, y, W, H);
      for (let i = 0; i < 26; i++) { g.fillStyle = rng.next() < 0.5 ? 'rgba(40,24,12,0.5)' : 'rgba(150,110,70,0.35)'; g.fillRect(x + rng.next() * W, y, 2 + rng.next() * 4, H); }
      noise(g, r, 300, 0.12, rng);
    }
    { // tree rings
      const r = HZ.RINGS, [x, y, W, H] = r;
      g.fillStyle = '#6e4a2e'; g.fillRect(x, y, W, H);
      for (let k = 9; k >= 0; k--) { g.fillStyle = k & 1 ? '#e2c290' : '#d2ad76'; g.beginPath(); g.arc(x + W / 2, y + H / 2, (W / 2 - 6) * (k + 1) / 10, 0, TAU); g.fill(); }
    }
    stripes(g, HZ.LICO, '#1a0c10', '#c01a2a', 9, 1.2);
    { // lollipop swirl
      const r = HZ.LOLLI, [x, y, W, H] = r, cxm = x + W / 2, cym = y + H / 2;
      g.fillStyle = '#ffffff'; g.fillRect(x, y, W, H);
      const cols = ['#ff4f9a', '#ffffff', '#35d2c8', '#ffffff'];
      for (let a = 0; a < 4; a++) { g.fillStyle = cols[a]; g.beginPath(); g.moveTo(cxm, cym); for (let t = 0; t <= 1; t += 0.02) { const ang = a * PI / 2 + t * 5, rad = t * (W / 2); g.lineTo(cxm + Math.cos(ang) * rad, cym + Math.sin(ang) * rad); } for (let t = 1; t >= 0; t -= 0.02) { const ang = a * PI / 2 + 0.7 + t * 5, rad = t * (W / 2); g.lineTo(cxm + Math.cos(ang) * rad, cym + Math.sin(ang) * rad); } g.closePath(); g.fill(); }
    }
    { // ramp base arrows (black on yellow)
      const r = HZ.ARROW, [x, y, W, H] = r;
      g.fillStyle = '#f7c21b'; g.fillRect(x, y, W, H); g.fillStyle = '#1c1c21';
      for (let k = 0; k < 3; k++) { const yy = y + 20 + k * 38; g.beginPath(); g.moveTo(x + 14, yy + 30); g.lineTo(x + W / 2, yy); g.lineTo(x + W - 14, yy + 30); g.lineTo(x + W - 34, yy + 30); g.lineTo(x + W / 2, yy + 14); g.lineTo(x + 34, yy + 30); g.closePath(); g.fill(); }
    }
    { const r = HZ.NEONSIGN, [x, y, W, H] = r; g.fillStyle = '#12082c'; g.fillRect(x, y, W, H); txt(g, 'LASER', x + W / 2, y + H / 2, 30, '#ff3fd2', '#ffffff', 2); hzBorder(g, r, 4, '#39f0ff'); }
    { // wafer
      const r = HZ.WAFER, [x, y, W, H] = r;
      g.fillStyle = '#e2b26e'; g.fillRect(x, y, W, H);
      g.strokeStyle = '#b8823e'; g.lineWidth = 3; for (let i = -H; i < W + H; i += 14) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i + H, y + H); g.stroke(); g.beginPath(); g.moveTo(x + i + H, y); g.lineTo(x + i, y + H); g.stroke(); }
    }
    // ramp decks (u across the ramp, v along it; planks run across)
    const deck = (r, a, b, gap, arrow, extra) => {
      const [x, y, W, H] = r; const n = 22, ph = H / n;
      for (let j = 0; j < n; j++) { g.fillStyle = j & 1 ? a : b; g.fillRect(x, y + j * ph, W, ph); g.fillStyle = gap; g.fillRect(x, y + j * ph, W, 1.5); noise(g, [x, y + j * ph, W, ph], 30, 0.08, rng); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 10, y + j * ph + ph / 2, 2, 2); g.fillRect(x + W - 12, y + j * ph + ph / 2, 2, 2); }
      if (extra) extra(x, y, W, H);
      g.fillStyle = arrow; for (let k = 0; k < 2; k++) { const yy = y + 50 + k * 90; g.beginPath(); g.moveTo(x + 30, yy + 34); g.lineTo(x + W / 2, yy); g.lineTo(x + W - 30, yy + 34); g.lineTo(x + W - 46, yy + 34); g.lineTo(x + W / 2, yy + 16); g.lineTo(x + 46, yy + 34); g.closePath(); g.fill(); }
      stripes(g, [x, y, 8, H], '#f7c21b', '#1c1c21', 10, 1); stripes(g, [x + W - 8, y, 8, H], '#f7c21b', '#1c1c21', 10, 1);
    };
    deck(HZ.DECK0, '#8a5e3c', '#7c5334', '#3a2414', 'rgba(255,255,255,0.8)');
    deck(HZ.DECK1, '#d7bf95', '#cdb386', '#8a7250', 'rgba(20,160,190,0.85)');
    deck(HZ.DECK2, '#e5b672', '#dcaa64', '#a8742f', 'rgba(255,90,160,0.9)', (x, y, W, H) => { g.strokeStyle = 'rgba(160,110,50,0.5)'; g.lineWidth = 2; for (let i = -H; i < W + H; i += 16) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i + H, y + H); g.stroke(); g.beginPath(); g.moveTo(x + i + H, y); g.lineTo(x + i, y + H); g.stroke(); } });
    deck(HZ.DECK3, '#2a2f45', '#23283b', '#0c0e18', 'rgba(255,63,210,0.95)', (x, y, W, H) => { g.strokeStyle = 'rgba(57,240,255,0.5)'; g.lineWidth = 2; for (let i = 0; i < W; i += 12) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i, y + H); g.stroke(); } });
    deck(HZ.DECK4, '#8c7a6a', '#81705f', '#433428', 'rgba(230,40,60,0.9)', (x, y, W, H) => { g.fillStyle = 'rgba(255,255,255,0.9)'; for (let j = 0; j < H; j += 8) { g.fillRect(x + 8, y + j, 10 + rng.next() * 16, 8); g.fillRect(x + W - 18 - rng.next() * 16, y + j, 26, 8); } });
    { // candy sign
      const r = HZ.CANDYSIGN, [x, y, W, H] = r;
      g.fillStyle = '#ff8ac4'; rr(g, x + 4, y + 4, W - 8, H - 8, 26); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 8; rr(g, x + 10, y + 10, W - 20, H - 20, 20); g.stroke();
      txt(g, 'DUCK!', x + W / 2, y + 60, 54, '#ffffff', '#b0206a', 10);
      stripes(g, [x + 24, y + H - 40, W - 48, 20], '#f7c21b', '#1c1c21', 12, 1);
    }
    { // buoy sign
      const r = HZ.BUOYSIGN, [x, y, W, H] = r;
      g.fillStyle = '#ffffff'; g.fillRect(x, y, W, H); hzBorder(g, r, 10, '#e2262e');
      txt(g, 'JUMP!', x + W / 2, y + 52, 50, '#1c7fd6', '#0b2a55', 6);
      stripes(g, [x + 16, y + H - 34, W - 32, 18], '#f7c21b', '#1c1c21', 12, 1);
    }
  }

  // coin matcap + embossed star
  function paintMatcap(g, w) {
    g.fillStyle = '#5c3306'; g.fillRect(0, 0, w, w);
    let gr = g.createRadialGradient(w * 0.44, w * 0.4, 0, w * 0.5, w * 0.5, w * 0.52);
    gr.addColorStop(0, '#fff7c9'); gr.addColorStop(0.2, '#ffe36a'); gr.addColorStop(0.5, '#f6b72a'); gr.addColorStop(0.78, '#c77a12'); gr.addColorStop(1, '#6a3a06');
    g.fillStyle = gr; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, TAU); g.fill();
    gr = g.createRadialGradient(w * 0.72, w * 0.74, 0, w * 0.72, w * 0.74, w * 0.25); gr.addColorStop(0, 'rgba(255,190,90,0.7)'); gr.addColorStop(1, 'rgba(255,190,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w);
    gr = g.createRadialGradient(w * 0.34, w * 0.28, 0, w * 0.34, w * 0.28, w * 0.13); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }
  function paintStar(g, w) {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
    g.fillStyle = '#fff'; star(g, w / 2, w / 2 + w * 0.02, w * 0.3, w * 0.125, 5, -PI / 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = w * 0.025; g.beginPath(); g.arc(w / 2, w / 2, w * 0.4, 0, TAU); g.stroke();
  }
  function makeTex(canvas, repeat) {
    const t = new THREE.CanvasTexture(canvas);
    t.anisotropy = RR.maxAniso || 4;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function buildAtlases() {
    const lc = cv(LV.W, LV.H); paintLiveries(lc.getContext('2d'));
    livAtlas = { canvas: lc, tex: makeTex(lc) };
    const hc = cv(HZ_W, HZ_H); paintHazard(hc.getContext('2d'));
    hzAtlas = { canvas: hc, tex: makeTex(hc) };
    const mc = cv(128, 128); paintMatcap(mc.getContext('2d'), 128);
    const sc = cv(128, 128); paintStar(sc.getContext('2d'), 128);
    coinTex = { matcap: makeTex(mc), star: makeTex(sc) };
    const redraw = () => {
      try {
        paintLiveries(lc.getContext('2d')); livAtlas.tex.needsUpdate = true;
        paintHazard(hc.getContext('2d')); hzAtlas.tex.needsUpdate = true;
      } catch (e) { /* keep the fallback-font version */ }
    };
    if (!fontReady()) {
      try { if (document.fonts && document.fonts.load) document.fonts.load('40px "Lilita One"').then(() => { if (fontReady()) redraw(); }, () => {}); } catch (e) { /* no font API */ }
    }
  }

  // ------------------------------------------------------------------ geometry kit (merge primitives: position, normal, color, uv)
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
  const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  class Kit {
    constructor() { this.parts = []; }
    // o: { uv: 'REGION' | faces: { pz: 'REGION', ... } (box only) | ao: bool | flipV }
    add(geo, color, pos, rot, scale, o) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      geo.dispose();
      _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, (rot && rot[3]) || 'XYZ');
      _q.setFromEuler(_e);
      if (typeof scale === 'number') _s.set(scale, scale, scale); else _s.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
      _m.compose(_p.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _q, _s);
      g.applyMatrix4(_m);
      const n = g.attributes.position.count, P = g.attributes.position.array;
      if (!g.attributes.normal) g.computeVertexNormals();
      const uvIn = g.attributes.uv ? g.attributes.uv.array : null, uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        let reg = null;
        if (o && o.faces) reg = o.faces[FACES[(i / 6) | 0]] || null;
        else if (o && o.uv) reg = o.uv;
        if (o && o.raw && uvIn) { uv[i * 2] = uvIn[i * 2]; uv[i * 2 + 1] = uvIn[i * 2 + 1] + (o.vShift || 0); }
        else if (reg && uvIn) {
          const R = HZUV[reg]; let u = uvIn[i * 2], v = uvIn[i * 2 + 1];
          if (o.flipV) v = 1 - v; if (o.swap) { const t = u; u = v; v = t; }
          uv[i * 2] = R[0] + (R[2] - R[0]) * u; uv[i * 2 + 1] = R[1] + (R[3] - R[1]) * v;
        } else { uv[i * 2] = WHITE_UV[0]; uv[i * 2 + 1] = WHITE_UV[1]; }
      }
      const col = new Float32Array(n * 3);
      if (o && o.keepColor && g.attributes.color) { col.set(g.attributes.color.array); this.parts.push({ pos: P, nor: g.attributes.normal.array, col, uv: o.keepUv && uvIn ? Float32Array.from(uvIn) : uv }); return this; }
      let y0 = Infinity, y1 = -Infinity;
      if (Array.isArray(color)) { for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; } _c.set(color[0]); _c2.set(color[1]); }
      else _c.set(color === undefined ? 0xffffff : color);
      for (let i = 0; i < n; i++) {
        let r = _c.r, gg = _c.g, b = _c.b;
        if (Array.isArray(color)) { const t = y1 > y0 ? (P[i * 3 + 1] - y0) / (y1 - y0) : 0; r = _c2.r + (_c.r - _c2.r) * t; gg = _c2.g + (_c.g - _c2.g) * t; b = _c2.b + (_c.b - _c2.b) * t; }
        if (o && o.ao) { const k = 0.66 + 0.34 * sstep(0, 1.0, P[i * 3 + 1]); r *= k; gg *= k; b *= k; }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      }
      this.parts.push({ pos: P, nor: g.attributes.normal.array, col, uv });
      return this;
    }
    empty() { return !this.parts.length; }
    build() {
      let n = 0; this.parts.forEach((p) => (n += p.pos.length / 3));
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let o = 0, ou = 0;
      this.parts.forEach((p) => { pos.set(p.pos, o); nor.set(p.nor, o); col.set(p.col, o); uv.set(p.uv, ou); o += p.pos.length; ou += p.uv.length; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.computeBoundingSphere();
      return g;
    }
  }
  const G = {
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    cyl: (rt, rb, h, s, open) => new THREE.CylinderGeometry(rt, rb, h, s || 10, 1, !!open),
    sph: (r, ws, hs, ps, pl, ts, tl) => new THREE.SphereGeometry(r, ws || 10, hs || 8, ps, pl, ts, tl),
    cone: (r, h, s) => new THREE.ConeGeometry(r, h, s || 8),
    tor: (R, t, rs, ts, arc) => new THREE.TorusGeometry(R, t, rs || 8, ts || 16, arc),
    ico: (r, d) => new THREE.IcosahedronGeometry(r, d || 0)
  };
  function withColor(g, hex) { // white vertex colours (FX geometry)
    const n = g.attributes.position.count, c = new Float32Array(n * 3); _c.set(hex === undefined ? 0xffffff : hex);
    for (let i = 0; i < n; i++) { c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }

  // ------------------------------------------------------------------ train body (ExtrudeGeometry)
  // Cross-section: flat underside at 0.72, slight tumblehome (widest 1.10 at y 1.35), large-radius superellipse roof to 2.94.
  const CT = (function contour() {
    const R = [[0, 0.72], [0.62, 0.72], [0.98, 0.72], [1.06, 0.8]];
    for (let i = 0; i <= 8; i++) { const y = 0.86 + ((2.24 - 0.86) * i) / 8; R.push([1.1 - 0.045 * Math.pow((y - 1.35) / 0.95, 2), y]); }
    const sideEnd = R.length; // first roof point index
    const n = 2.5, A = 1.056, B = 0.64, Y0 = 2.3;
    for (let i = 0; i <= 14; i++) { const t = (i / 14) * (PI / 2); R.push([A * Math.pow(Math.cos(t), 2 / n), Y0 + B * Math.pow(Math.sin(t), 2 / n)]); }
    R[R.length - 1][0] = 0;
    // v along the side (0 at the bottom corner, 1 at the roof start), < 0 underside, > 1 roof
    const s = [0]; for (let i = 1; i < R.length; i++) s.push(s[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]));
    const s0 = s[3], s1 = s[sideEnd], v = R.map((p, i) => (s[i] - s0) / (s1 - s0));
    // full CCW contour: right half up, left half (mirrored) down
    const pts = [], vs = [];
    for (let i = 0; i < R.length; i++) { pts.push(R[i]); vs.push(v[i]); }
    for (let i = R.length - 2; i >= 1; i--) { pts.push([-R[i][0], R[i][1]]); vs.push(v[i]); }
    // smooth outward normals per contour point
    const N = pts.length, nx = [], ny = [];
    for (let i = 0; i < N; i++) {
      const a = pts[(i - 1 + N) % N], b = pts[i], c = pts[(i + 1) % N];
      let x1 = b[1] - a[1], y1 = -(b[0] - a[0]), x2 = c[1] - b[1], y2 = -(c[0] - b[0]);
      const l1 = Math.hypot(x1, y1) || 1, l2 = Math.hypot(x2, y2) || 1; x1 /= l1; y1 /= l1; x2 /= l2; y2 /= l2;
      const x = x1 + x2, y = y1 + y2, l = Math.hypot(x, y) || 1; nx.push(x / l); ny.push(y / l);
    }
    return { pts, vs, nx, ny };
  })();
  function nearestCT(x, y) { let bi = 0, bd = 1e9; for (let i = 0; i < CT.pts.length; i++) { const d = (CT.pts[i][0] - x) ** 2 + (CT.pts[i][1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
  const CT_UV = {
    generateTopUV(geometry, V, a, b, c) { return [a, b, c].map((i) => new THREE.Vector2((V[i * 3] + 1.1) / 2.2, (V[i * 3 + 1] - 0.72) / 2.22)); },
    generateSideWallUV(geometry, V, a, b, c, d) { return [a, b, c, d].map((i) => new THREE.Vector2(0, CT.vs[nearestCT(V[i * 3], V[i * 3 + 1])])); }
  };
  // post-process an extruded body: per-vertex kind + smooth side normals (bevel faces keep their tilt)
  function finishBody(g, kindOf) {
    g.computeVertexNormals(); // flat (non-indexed)
    const P = g.attributes.position.array, Nn = g.attributes.normal.array, n = P.length / 3, kind = new Float32Array(n);
    for (let t = 0; t < n; t += 3) {
      const nz = Nn[t * 3 + 2], k = kindOf(nz, P[t * 3 + 2]);
      for (let j = 0; j < 3; j++) {
        const i = t + j; kind[i] = k;
        if (Math.abs(nz) < 0.985) { // side wall or bevel: smooth around the contour, keep the bevel tilt
          const ci = nearestCT(P[i * 3], P[i * 3 + 1]), fz = Nn[i * 3 + 2], fx = Nn[i * 3], fy = Nn[i * 3 + 1];
          if (fx * CT.nx[ci] + fy * CT.ny[ci] > 0.35 * Math.sqrt(1 - fz * fz)) {
            const h = Math.sqrt(Math.max(0, 1 - fz * fz));
            Nn[i * 3] = CT.nx[ci] * h; Nn[i * 3 + 1] = CT.ny[ci] * h; Nn[i * 3 + 2] = fz;
          }
        }
      }
    }
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    g.computeBoundingSphere();
    return g;
  }
  function makeShape() { const s = new THREE.Shape(); CT.pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]))); s.closePath(); return s; }
  function buildBodyGeo() { // unit length, front at z = 0, rear at z = -1
    const g = new THREE.ExtrudeGeometry(makeShape(), { depth: 1, steps: 1, bevelEnabled: false, UVGenerator: CT_UV });
    g.translate(0, 0, -1);
    return finishBody(g, (nz) => (Math.abs(nz) > 0.9 ? 1 : 0));
  }
  function buildNoseGeo() { // chamfered cab: front (cab face) at z = 0, full section from -NOSE_BT to -NOSE_L, back bevel hidden in the body
    const bt = T.NOSE_BT, bs = 0.17;
    const g = new THREE.ExtrudeGeometry(makeShape(), { depth: T.NOSE_D, steps: 1, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelOffset: -bs, bevelSegments: 3, UVGenerator: CT_UV });
    g.translate(0, 0, -(T.NOSE_D + bt));
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) if (P[i + 2] > -bt + 1e-3) P[i + 2] -= T.NOSE_LEAN * sstep(1.4, 2.9, P[i + 1]);
    g.attributes.position.needsUpdate = true;
    return finishBody(g, (nz, z) => (nz > 0.9 ? 2 : nz < -0.9 ? 1 : 3));
  }
  function buildWalkGeo() { // unit length walkway plate: top exactly at TRAIN_H
    const g = new THREE.BoxGeometry(T.WALK_W, TRAIN_H - T.WALK_Y0, 1).toNonIndexed();
    g.translate(0, (TRAIN_H + T.WALK_Y0) / 2, -0.5);
    const n = g.attributes.position.count, kind = new Float32Array(n);
    for (let i = 0; i < n; i++) kind[i] = ((i / 6) | 0) === 2 ? 4 : 5;
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    return g;
  }

  // ------------------------------------------------------------------ train props
  function buildBogie() {
    const k = new Kit(), frame = 0x2d2f38, wheel = 0x9aa2b2, spring = 0xe0a030, dark = 0x1b1c22;
    [-0.78, 0.78].forEach((x) => {
      k.add(G.box(0.1, 0.22, 2.3), frame, [x, 0.6, 0]);
      k.add(G.box(0.12, 0.1, 0.5), dark, [x, 0.46, 0]);
      [-0.3, 0.3].forEach((z) => k.add(G.cyl(0.07, 0.07, 0.2, 6), spring, [x, 0.76, z]));
      [-0.75, 0.75].forEach((z) => k.add(G.box(0.14, 0.14, 0.2), dark, [x, 0.58, z]));
    });
    [-0.75, 0.75].forEach((z) => {
      [-0.6, 0.6].forEach((x) => {
        k.add(G.cyl(0.3, 0.33, 0.12, 12), wheel, [x, 0.58, z], [0, 0, x > 0 ? PI / 2 : -PI / 2]);
        k.add(G.cyl(0.1, 0.1, 0.13, 6), frame, [x + (x > 0 ? 0.06 : -0.06), 0.58, z], [0, 0, PI / 2]);
      });
      k.add(G.box(1.3, 0.08, 0.08), dark, [0, 0.58, z]);
    });
    k.add(G.box(1.5, 0.12, 0.5), frame, [0, 0.72, 0]);
    return k.build();
  }
  function buildUnder() { // unit length (z in [-1, 0]), scaled per car: skirts between the bogies + equipment boxes
    const k = new Kit(), skirt = 0x3a3d48, box = 0x24262e, trim = 0x8a90a0;
    [-1, 1].forEach((s) => { k.add(G.box(0.05, 0.3, 0.34), skirt, [s * 0.99, 0.58, -0.5]); k.add(G.box(0.052, 0.03, 0.34), trim, [s * 0.995, 0.7, -0.5]); });
    k.add(G.box(1.3, 0.26, 0.18), box, [0, 0.58, -0.4]);
    k.add(G.box(1.0, 0.22, 0.12), box, [0.1, 0.6, -0.6]);
    k.add(G.box(1.7, 0.08, 0.98), 0x1e2026, [0, 0.69, -0.5]);
    return k.build();
  }
  function buildBellows() {
    const k = new Kit(), rub = 0x2a2c33, rub2 = 0x3a3d46;
    for (let i = 0; i < 5; i++) k.add(G.box(1.5 - (i & 1) * 0.08, 2.05 - (i & 1) * 0.08, 0.1), i & 1 ? rub2 : rub, [0, 1.78, -0.2 + i * 0.1]);
    k.add(G.box(0.2, 0.16, 0.9), 0x55596a, [0, 0.62, 0]);
    return k.build();
  }
  function buildRoofA() { // AC unit + vents on the right roof shoulder (x in [0.64, 1.0]); rotate by PI for the left side
    const k = new Kit(), body = 0xc9ced8, dark = 0x3a3e4a, fan = 0x23252c;
    k.add(G.box(0.34, 0.42, 1.5), [body, 0x9aa0ac], [0.82, 2.72, 0]);
    k.add(G.box(0.36, 0.04, 1.52), 0xe0e4ec, [0.82, 2.95, 0]);
    [-0.4, 0.3].forEach((z) => { k.add(G.cyl(0.13, 0.13, 0.03, 12), fan, [0.82, 2.975, z]); k.add(G.box(0.24, 0.035, 0.03), 0x9aa0ac, [0.82, 2.99, z]); });
    for (let i = 0; i < 6; i++) k.add(G.box(0.02, 0.2, 0.08), dark, [0.992, 2.72, -0.6 + i * 0.24]);
    [-1.2, 1.1].forEach((z) => { k.add(G.cyl(0.06, 0.09, 0.14, 8), 0x8a90a0, [0.8, 2.83, z]); k.add(G.cyl(0.11, 0.11, 0.04, 8), 0xb0b6c2, [0.8, 2.92, z]); });
    return k.build();
  }
  function buildRoofB() { // folded pantograph on the right shoulder
    const k = new Kit(), ins = 0xe8e0d0, metal = 0x6a707e, dark = 0x2e3038;
    [-0.5, 0.5].forEach((z) => { k.add(G.cyl(0.05, 0.06, 0.2, 8), ins, [0.8, 2.83, z]); k.add(G.cyl(0.07, 0.07, 0.03, 8), ins, [0.8, 2.88, z]); k.add(G.cyl(0.07, 0.07, 0.03, 8), ins, [0.8, 2.8, z]); });
    k.add(G.box(0.3, 0.06, 1.3), dark, [0.8, 2.96, 0]);
    k.add(G.box(0.03, 0.03, 1.1), metal, [0.72, 3.05, -0.05], [0.12, 0, 0]);
    k.add(G.box(0.03, 0.03, 1.1), metal, [0.88, 3.05, -0.05], [0.12, 0, 0]);
    k.add(G.box(0.03, 0.03, 0.9), metal, [0.8, 3.1, 0.2], [-0.2, 0, 0]);
    k.add(G.box(0.34, 0.05, 0.08), 0x9aa0ac, [0.8, 3.13, -0.55]);
    k.add(G.cyl(0.04, 0.04, 0.9, 6), 0x2a2c33, [0.8, 2.9, 0.95], [PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) k.add(G.box(0.2, 0.06, 0.2), metal, [0.8, 2.86, -1.2 + i * 0.25]);
    return k.build();
  }

  // ------------------------------------------------------------------ FX geometries
  function buildConeGeo() { const g = new THREE.CylinderGeometry(0.9, 2.7, 16, 18, 1, true); g.rotateX(-PI / 2); g.translate(0, 0, 8); return withColor(g); }
  function buildPoolGeo() { const g = new THREE.PlaneGeometry(2.8, 22); g.rotateX(-PI / 2); g.translate(0, 0, 11); return withColor(g); }
  function buildPillarGeo() { const g = new THREE.CylinderGeometry(0.16, 0.34, 30, 14, 1, true); g.translate(0, 15, 0); return withColor(g); }
  function buildBlobGeo() { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-PI / 2); return withColor(g); }

  // ------------------------------------------------------------------ obstacle skins (5 worlds x hurdle / bar / block) and ramps
  // Each returns { solid: Kit, glow: Kit|null (FX steady), laser: Kit|null (FX additive), lamps: [[x,y,z,color,mode,size,halo]], blob: [w, d] }
  const HAZ_Y = 0xf7c21b, HAZ_K = 0x1c1c21, LAMP_RED = 0xff2a2a, LAMP_AMB = 0xffa412;
  function variant() { return { solid: new Kit(), glow: new Kit(), laser: new Kit(), lamps: [], blob: [2.6, 1.2] }; }
  const lampHousing = (k, x, y, z) => { k.add(G.cyl(0.07, 0.08, 0.1, 8), HAZ_K, [x, y - 0.06, z]); };

  function buildHurdle(w) {
    const V = variant(), k = V.solid;
    if (w === 'city') { // construction A-frame barricade
      k.add(G.box(2.2, 0.26, 0.05), 0xffffff, [0, 0.92, 0.03], null, null, { faces: { pz: 'OW', nz: 'OW' } });
      k.add(G.box(2.2, 0.2, 0.05), 0xffffff, [0, 0.56, 0.03], null, null, { faces: { pz: 'CHEV', nz: 'CHEV' } });
      [-1.0, 1.0].forEach((x) => {
        k.add(G.box(0.08, 1.12, 0.06), 0xe6e8ee, [x, 0.53, 0.14], [-0.28, 0, 0], null, { ao: true });
        k.add(G.box(0.08, 1.12, 0.06), 0xe6e8ee, [x, 0.53, -0.14], [0.28, 0, 0], null, { ao: true });
        k.add(G.box(0.14, 0.05, 0.8), 0x33353d, [x, 0.03, 0]);
        k.add(G.sph(0.2, 8, 6), 0xc8a878, [x, 0.08, 0.3], null, [1, 0.45, 0.8], { ao: true });
        k.add(G.sph(0.2, 8, 6), 0xbd9c6a, [x, 0.08, -0.3], null, [1, 0.45, 0.8], { ao: true });
        lampHousing(k, x, 1.14, 0.03);
      });
      V.lamps.push([-1.0, 1.15, 0.03, LAMP_AMB, 2, 0.075, 0.9], [1.0, 1.15, 0.03, LAMP_AMB, 2, 0.075, 0.9]);
    } else if (w === 'beach') { // buoy rope between wooden posts
      [-1.02, 1.02].forEach((x) => {
        k.add(G.cyl(0.1, 0.12, 1.04, 9), 0x9a6a3c, [x, 0.52, 0], null, null, { ao: true });
        k.add(G.cyl(0.13, 0.13, 0.06, 9), 0x6b4424, [x, 0.7, 0]);
        k.add(G.cyl(0.13, 0.13, 0.06, 9), 0x6b4424, [x, 0.3, 0]);
        lampHousing(k, x, 1.1, 0);
      });
      const rope = (y0, sag, r) => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-1.0, y0, 0), new THREE.Vector3(0, y0 - sag * 2, 0), new THREE.Vector3(1.0, y0, 0)), 20, r, 5, false);
      k.add(rope(0.94, 0.07, 0.03), 0xe8dcc0, [0, 0, 0]);
      k.add(rope(0.5, 0.05, 0.025), 0xe8dcc0, [0, 0, 0]);
      for (let i = 0; i < 7; i++) {
        const x = -0.78 + i * 0.26, y = 0.94 - 0.14 * (1 - (x / 1.0) ** 2);
        k.add(G.sph(0.12, 10, 8), i & 1 ? 0xf2f2f2 : 0xe8322e, [x, y, 0], null, [1.25, 0.95, 0.95]);
      }
      for (let i = 0; i < 5; i++) { const x = -0.6 + i * 0.3, y = 0.5 - 0.1 * (1 - (x / 1.0) ** 2); k.add(G.sph(0.09, 8, 6), i & 1 ? 0xffc21a : 0x1c9fe0, [x, y, 0], null, [1.3, 0.9, 0.9]); }
      k.add(G.box(0.78, 0.3, 0.04), 0xffffff, [0, 0.72, 0.04], null, null, { faces: { pz: 'BUOYSIGN', nz: 'BUOYSIGN' } });
      V.lamps.push([-1.02, 1.11, 0, LAMP_AMB, 2, 0.075, 0.9], [1.02, 1.11, 0, LAMP_AMB, 2, 0.075, 0.9]);
    } else if (w === 'candy') { // candy-cane fence
      const canes = [-0.96, -0.32, 0.32, 0.96];
      canes.forEach((x, i) => {
        k.add(G.cyl(0.07, 0.07, 0.86, 10), 0xffffff, [x, 0.43, 0], null, null, { uv: 'RW' });
        k.add(G.tor(0.13, 0.07, 8, 12, PI), 0xffffff, [x + (i < 2 ? 0.13 : -0.13), 0.86, 0], [0, 0, 0], null, { uv: 'RW' });
      });
      [0.5, 0.82].forEach((y) => k.add(G.cyl(0.055, 0.055, 2.1, 10), 0xffffff, [0, y, 0.02], [0, 0, PI / 2], null, { uv: 'RW' }));
      [[-0.64, 0xff5fa2], [0, 0x5ee0c8], [0.64, 0xffd84d]].forEach(([x, c]) => k.add(G.sph(0.13, 10, 8), c, [x, 0.95, 0], null, [1, 0.8, 1]));
      k.add(G.box(0.3, 0.12, 0.7), 0xff8ac4, [-0.96, 0.06, 0], null, null, { ao: true });
      k.add(G.box(0.3, 0.12, 0.7), 0x8ad8ff, [0.96, 0.06, 0], null, null, { ao: true });
      V.lamps.push([-0.64, 1.1, 0, LAMP_AMB, 2, 0.07, 0.85], [0.64, 1.1, 0, LAMP_AMB, 2, 0.07, 0.85]);
    } else if (w === 'neon') { // laser gate
      [-1.05, 1.05].forEach((x) => {
        k.add(G.box(0.2, 1.1, 0.24), 0x1c1a33, [x, 0.55, 0], null, null, { ao: true });
        k.add(G.box(0.3, 0.1, 0.36), 0x2a2848, [x, 0.05, 0]);
        k.add(G.box(0.26, 0.14, 0.28), 0x2e2c4e, [x, 1.1, 0]);
        V.glow.add(G.box(0.04, 0.9, 0.25), 0x39f0ff, [x + (x < 0 ? 0.1 : -0.1), 0.55, 0]);
        [0.3, 0.62, 0.94].forEach((y) => V.glow.add(G.cyl(0.05, 0.05, 0.05, 8), 0xff3fd2, [x + (x < 0 ? 0.11 : -0.11), y, 0], [0, 0, PI / 2]));
      });
      [0.3, 0.62, 0.94].forEach((y) => V.laser.add(G.cyl(0.03, 0.03, 1.94, 6, true), 0xffffff, [0, y, 0], [0, 0, PI / 2], null, { raw: true }));
      V.laser.add(new THREE.PlaneGeometry(1.94, 0.86), 0xffffff, [0, 0.62, 0], null, null, { raw: true, vShift: 2 });
      V.lamps.push([-1.05, 1.2, 0, LAMP_RED, 2, 0.06, 0.8], [1.05, 1.2, 0, LAMP_RED, 2, 0.06, 0.8]);
    } else { // snow log with a snow cap and chevron markers
      k.add(G.cyl(0.4, 0.42, 2.02, 12), 0xffffff, [0, 0.44, 0], [0, 0, PI / 2], null, { uv: 'BARK' });
      [-1.01, 1.01].forEach((x) => k.add(G.cyl(0.36, 0.36, 0.02, 12), 0xffffff, [x, 0.44, 0], [0, 0, PI / 2], null, { uv: 'RINGS' }));
      k.add(G.sph(1, 14, 8, 0, TAU, 0, PI / 2), 0xf6fbff, [0, 0.8, 0], null, [1.02, 0.25, 0.34]);
      for (let i = 0; i < 6; i++) k.add(G.cone(0.035, 0.18, 6), 0xcfeeff, [-0.8 + i * 0.32, 0.36, 0.38], [PI, 0, 0]);
      [-1.12, 1.12].forEach((x) => { k.add(G.box(0.1, 1.06, 0.1), 0xffffff, [x, 0.53, 0], null, null, { faces: { pz: 'CHEV', nz: 'CHEV', px: 'CHEV', nx: 'CHEV' }, swap: true }); lampHousing(k, x, 1.13, 0); });
      k.add(G.sph(0.3, 8, 6), 0xf2f8ff, [-0.7, 0.05, 0.25], null, [1.2, 0.35, 0.8]);
      k.add(G.sph(0.3, 8, 6), 0xf2f8ff, [0.6, 0.05, -0.25], null, [1.3, 0.3, 0.8]);
      V.lamps.push([-1.12, 1.14, 0, LAMP_AMB, 2, 0.07, 0.85], [1.12, 1.14, 0, LAMP_AMB, 2, 0.07, 0.85]);
    }
    return V;
  }
  function buildBar(w) { // the sign / gantry fills y 1.42 .. 3.4
    const V = variant(), k = V.solid, B = C.BAR_BOTTOM, TOP = C.BAR_TOP;
    V.blob = [2.8, 0.8];
    if (w === 'city') { // LOW CLEARANCE gantry
      [-1.14, 1.14].forEach((x) => {
        k.add(G.box(0.14, 1.0, 0.14), 0xffffff, [x, 0.5, 0], null, null, { faces: { pz: 'CHEV', nz: 'CHEV', px: 'CHEV', nx: 'CHEV' }, swap: true });
        k.add(G.box(0.14, 2.6, 0.14), 0x6d7383, [x, 2.3, 0]);
        k.add(G.box(0.3, 0.06, 0.3), 0x3a3d48, [x, 0.03, 0]);
      });
      k.add(G.box(2.44, 0.18, 0.18), 0x6d7383, [0, TOP + 0.09, 0]);
      k.add(G.box(2.12, TOP - 0.1 - B, 0.06), 0xffffff, [0, (B + TOP - 0.1) / 2, 0.02], null, null, { faces: { pz: 'LOW', nz: 'LOW' } });
      k.add(G.box(2.18, 0.05, 0.08), HAZ_K, [0, B + 0.025, 0.02]);
      [-0.7, 0.7].forEach((x) => k.add(G.box(0.05, 0.12, 0.05), 0x3a3d48, [x, TOP - 0.05, 0]));
      V.lamps.push([-0.86, B + 0.14, 0.08, LAMP_RED, 2, 0.07, 0.9], [0.86, B + 0.14, 0.08, LAMP_RED, 2, 0.07, 0.9]);
    } else if (w === 'beach') { // tiki beam with a hanging woven sign
      [-1.14, 1.14].forEach((x) => {
        k.add(G.cyl(0.15, 0.17, TOP + 0.3, 10), 0xffffff, [x, (TOP + 0.3) / 2, 0], null, null, { uv: 'TIKI' });
        k.add(G.cone(0.22, 0.3, 8), 0x7a4f25, [x, TOP + 0.45, 0]);
        lampHousing(k, x, TOP + 0.65, 0);
      });
      k.add(G.cyl(0.11, 0.11, 2.6, 10), 0xc8a45a, [0, TOP + 0.05, 0], [0, 0, PI / 2]);
      for (let i = 0; i < 6; i++) k.add(G.cyl(0.118, 0.118, 0.04, 10), 0x8a6a2e, [-1.0 + i * 0.4, TOP + 0.05, 0], [0, 0, PI / 2]);
      k.add(G.box(2.06, TOP - 0.16 - B, 0.06), 0xffffff, [0, (B + TOP - 0.16) / 2, 0.02], null, null, { faces: { pz: 'TIKISIGN', nz: 'TIKISIGN' } });
      [-0.8, 0.8].forEach((x) => k.add(G.cyl(0.02, 0.02, 0.2, 4), 0xe8dcc0, [x, TOP - 0.06, 0.02]));
      for (let i = 0; i < 11; i++) k.add(G.cone(0.1, 0.3, 4), i & 1 ? 0x3fa34d : 0x2e8a3e, [-1.0 + i * 0.2, TOP - 0.1, 0.07], [PI, 0, 0.2 * ((i % 3) - 1)]);
      V.lamps.push([-1.14, TOP + 0.66, 0, LAMP_AMB, 2, 0.08, 1.0], [1.14, TOP + 0.66, 0, LAMP_AMB, 2, 0.08, 1.0], [0, B + 0.12, 0.08, LAMP_RED, 2, 0.06, 0.7]);
    } else if (w === 'candy') { // licorice ropes with gummy bears between lollipop posts
      [-1.14, 1.14].forEach((x) => {
        k.add(G.cyl(0.06, 0.06, TOP + 0.1, 8), 0xf8f4f0, [x, (TOP + 0.1) / 2, 0], null, null, { ao: true });
        k.add(G.cyl(0.4, 0.4, 0.1, 18), 0xffffff, [x, TOP + 0.35, 0], [PI / 2, 0, 0], null, { uv: 'LOLLI' });
      });
      const nR = 7, dy = (TOP - B - 0.15) / (nR - 1);
      for (let i = 0; i < nR; i++) k.add(G.cyl(0.075, 0.075, 2.3, 8), 0xffffff, [0, B + 0.075 + i * dy, 0], [0, 0, PI / 2], null, { uv: 'LICO' });
      const bear = (x, y, c) => {
        k.add(G.sph(0.13, 8, 6), c, [x, y + 0.13, 0.1], null, [1, 1.15, 0.8]);
        k.add(G.sph(0.1, 8, 6), c, [x, y + 0.34, 0.1]);
        [-0.07, 0.07].forEach((ex) => k.add(G.sph(0.04, 6, 4), c, [x + ex, y + 0.43, 0.1]));
        [-0.1, 0.1].forEach((ex) => k.add(G.sph(0.045, 6, 4), c, [x + ex, y + 0.2, 0.16]));
      };
      bear(-0.55, B + 0.075 + dy * 0.9, 0xff4f6a); bear(0.3, B + 0.075 + dy * 2.9, 0x5ee07a); bear(-0.1, B + 0.075 + dy * 4.9, 0xffc23d); bear(0.7, B + 0.075 + dy * 0.9, 0x7a8cff);
      k.add(G.box(1.0, 0.36, 0.05), 0xffffff, [0, TOP + 0.06, 0.03], null, null, { faces: { pz: 'CANDYSIGN', nz: 'CANDYSIGN' } });
      V.lamps.push([-1.02, B + 0.07, 0.12, LAMP_RED, 2, 0.06, 0.8], [1.02, B + 0.07, 0.12, LAMP_RED, 2, 0.06, 0.8]);
    } else if (w === 'neon') { // stacked laser bar with an energy field
      [-1.13, 1.13].forEach((x) => {
        k.add(G.box(0.22, TOP + 0.2, 0.26), 0x1c1a33, [x, (TOP + 0.2) / 2, 0], null, null, { ao: true });
        k.add(G.box(0.34, 0.1, 0.38), 0x2a2848, [x, 0.05, 0]);
        V.glow.add(G.box(0.04, TOP - 0.2, 0.27), 0x39f0ff, [x + (x < 0 ? 0.11 : -0.11), TOP / 2 + 0.1, 0]);
      });
      k.add(G.box(2.5, 0.2, 0.3), 0x1c1a33, [0, TOP + 0.2, 0]);
      V.glow.add(G.box(2.3, 0.04, 0.31), 0xff3fd2, [0, TOP + 0.14, 0]);
      k.add(G.box(0.9, 0.3, 0.06), 0xffffff, [0, TOP + 0.2, 0.16], null, null, { faces: { pz: 'NEONSIGN', nz: 'NEONSIGN' } });
      const nB = 7;
      for (let i = 0; i < nB; i++) {
        const y = B + 0.05 + (i * (TOP - B - 0.1)) / (nB - 1);
        V.laser.add(G.cyl(0.03, 0.03, 2.04, 6, true), 0xffffff, [0, y, 0], [0, 0, PI / 2], null, { raw: true });
        [-1, 1].forEach((s) => V.glow.add(G.cyl(0.05, 0.05, 0.06, 8), 0xff3fd2, [s * 1.01, y, 0], [0, 0, PI / 2]));
      }
      V.laser.add(new THREE.PlaneGeometry(2.04, TOP - B), 0xffffff, [0, (TOP + B) / 2, 0], null, null, { raw: true, vShift: 2 });
      V.lamps.push([-1.13, TOP + 0.36, 0, LAMP_RED, 1, 0.07, 0.9], [1.13, TOP + 0.36, 0, LAMP_RED, 1, 0.07, 0.9]);
    } else { // icicle beam with a hanging snowy sign
      [-1.14, 1.14].forEach((x) => {
        k.add(G.cyl(0.12, 0.14, TOP + 0.2, 9), 0xffffff, [x, (TOP + 0.2) / 2, 0], null, null, { uv: 'BARK' });
        k.add(G.sph(0.2, 8, 6), 0xf6fbff, [x, TOP + 0.24, 0], null, [1, 0.5, 1]);
        k.add(G.sph(0.3, 8, 6), 0xf2f8ff, [x, 0.04, 0], null, [1, 0.3, 1]);
      });
      k.add(G.cyl(0.17, 0.17, 2.5, 10), 0xffffff, [0, TOP - 0.1, 0], [0, 0, PI / 2], null, { uv: 'BARK' });
      k.add(G.sph(1, 14, 6, 0, TAU, 0, PI / 2), 0xf6fbff, [0, TOP + 0.02, 0], null, [1.26, 0.14, 0.22]);
      const nI = 17;
      for (let i = 0; i < nI; i++) {
        const x = -1.02 + (i * 2.04) / (nI - 1), len = i % 4 === 1 ? TOP - 0.24 - B : 0.5 + ((i * 37) % 11) / 11 * (TOP - 0.3 - B - 0.5);
        k.add(G.cone(0.075, len, 6), i & 1 ? 0xbfe8ff : 0xdff4ff, [x, TOP - 0.24 - len / 2, (i & 1 ? 0.06 : -0.04)], [PI, 0, 0]);
      }
      k.add(G.box(1.26, 0.72, 0.06), 0xffffff, [0, B + 0.36, 0.1], null, null, { faces: { pz: 'FROSTSIGN', nz: 'FROSTSIGN' } });
      [-0.5, 0.5].forEach((x) => k.add(G.cyl(0.015, 0.015, TOP - 0.3 - (B + 0.72), 4), 0xcfd6e0, [x, (TOP - 0.3 + B + 0.72) / 2, 0.1]));
      V.lamps.push([-0.66, B + 0.08, 0.16, LAMP_AMB, 2, 0.06, 0.8], [0.66, B + 0.08, 0.16, LAMP_AMB, 2, 0.06, 0.8]);
    }
    return V;
  }
  function buildBlock(w) { // 3.2 tall wall, 0.6 deep
    const V = variant(), k = V.solid, H = C.BLOCK_TOP;
    V.blob = [2.9, 1.6];
    if (w === 'city') { // concrete barrier with a chevron panel
      k.add(G.box(2.2, H - 0.95, 0.44), 0xc4beb5, [0, 0.8 + (H - 0.95) / 2, 0], null, null, { faces: { pz: 'CONC', nz: 'CONC' } });
      const prof = new THREE.Shape(); prof.moveTo(-0.34, 0); prof.lineTo(0.34, 0); prof.lineTo(0.3, 0.12); prof.lineTo(0.22, 0.3); prof.lineTo(0.22, 0.85); prof.lineTo(-0.22, 0.85); prof.lineTo(-0.22, 0.3); prof.lineTo(-0.3, 0.12); prof.closePath();
      const jg = new THREE.ExtrudeGeometry(prof, { depth: 2.2, bevelEnabled: false }); jg.rotateY(PI / 2); jg.translate(-1.1, 0, 0);
      k.add(jg, 0xb4aea5, [0, 0, 0], null, null, { ao: true });
      k.add(G.box(2.26, 0.12, 0.5), 0xa8a39a, [0, H - 0.09, 0]);
      k.add(G.box(2.3, 0.07, 0.52), HAZ_K, [0, H - 0.035, 0]);
      [-0.95, 0.95].forEach((x) => lampHousing(k, x, H + 0.08, 0.1));
      V.lamps.push([-0.95, H + 0.1, 0.1, LAMP_RED, 2, 0.08, 1.0], [0.95, H + 0.1, 0.1, LAMP_RED, 2, 0.08, 1.0]);
    } else if (w === 'beach') { // stacked surf crates
      [[-0.55, 0.78], [0.55, 0.78], [-0.55, 2.34], [0.55, 2.34]].forEach(([x, y], i) => k.add(G.box(1.08, 1.54, 0.56), 0xffffff, [x, y, (i & 1) * 0.02], [0, (i - 1.5) * 0.02, 0], null, { faces: { pz: 'CRATE', nz: 'CRATE', px: 'CRATE', nx: 'CRATE', py: 'CRATE', ny: 'CRATE' }, ao: true }));
      k.add(G.box(2.24, 0.1, 0.6), 0x7a4a22, [0, H - 0.05, 0]);
      k.add(G.box(2.22, 0.3, 0.04), 0xffffff, [0, 1.56, 0.31], null, null, { faces: { pz: 'CHEV', nz: 'CHEV' } });
      k.add(G.tor(0.3, 0.08, 8, 18), 0xffffff, [0.55, 2.4, 0.34], null, null, { uv: 'RW' });
      k.add(G.box(0.05, 3.1, 0.05), 0xe8dcc0, [-0.02, 1.6, 0.3]);
      V.lamps.push([-0.95, H + 0.08, 0.1, LAMP_RED, 2, 0.08, 1.0], [0.95, H + 0.08, 0.1, LAMP_RED, 2, 0.08, 1.0]);
      [-0.95, 0.95].forEach((x) => lampHousing(k, x, H + 0.06, 0.1));
    } else if (w === 'candy') { // chocolate bar wall with frosting
      k.add(G.box(2.2, H - 0.2, 0.46), 0xffffff, [0, (H - 0.2) / 2, 0], null, null, { faces: { pz: 'CHOC', nz: 'CHOC' } });
      k.add(G.box(2.24, 0.24, 0.52), 0xff8ac4, [0, H - 0.12, 0]);
      for (let i = 0; i < 9; i++) { const x = -0.96 + i * 0.24, l = 0.12 + ((i * 7) % 5) * 0.06; k.add(G.cyl(0.05, 0.05, l, 6), 0xff8ac4, [x, H - 0.24 - l / 2, 0.25]); k.add(G.sph(0.055, 6, 4), 0xff8ac4, [x, H - 0.24 - l, 0.25]); }
      const spr = [0xff4f6a, 0x5ee0c8, 0xffd84d, 0x7a8cff, 0xffffff];
      for (let i = 0; i < 22; i++) k.add(G.box(0.1, 0.03, 0.03), spr[i % 5], [-1.0 + ((i * 53) % 100) / 50, H + 0.01, -0.2 + ((i * 29) % 40) / 100], [0, (i * 1.3) % 3, 0]);
      V.lamps.push([-0.95, H + 0.1, 0.1, LAMP_RED, 2, 0.085, 1.0], [0.95, H + 0.1, 0.1, LAMP_RED, 2, 0.085, 1.0]);
    } else if (w === 'neon') { // holo barrier frame
      [-1.02, 1.02].forEach((x) => { k.add(G.box(0.18, H, 0.5), 0x1c1a33, [x, H / 2, 0], null, null, { ao: true }); V.glow.add(G.box(0.03, H - 0.3, 0.51), 0x39f0ff, [x + (x < 0 ? 0.09 : -0.09), H / 2, 0]); });
      k.add(G.box(2.22, 0.2, 0.5), 0x1c1a33, [0, H - 0.1, 0]);
      k.add(G.box(2.22, 0.24, 0.5), 0x1c1a33, [0, 0.12, 0]);
      V.glow.add(G.box(2.0, 0.035, 0.51), 0xff3fd2, [0, H - 0.2, 0]);
      V.glow.add(G.box(2.0, 0.035, 0.51), 0xff3fd2, [0, 0.25, 0]);
      k.add(G.box(1.86, H - 0.44, 0.12), 0xffffff, [0, H / 2 + 0.02, 0], null, null, { faces: { pz: 'NEONP', nz: 'NEONP' } });
      V.laser.add(new THREE.PlaneGeometry(1.86, H - 0.44), 0xffffff, [0, H / 2 + 0.02, 0.07], null, null, { raw: true });
      V.lamps.push([-1.02, H + 0.08, 0, LAMP_RED, 1, 0.08, 1.0], [1.02, H + 0.08, 0, LAMP_RED, 1, 0.08, 1.0]);
    } else { // ice block with a snow cap
      k.add(G.box(2.16, H - 0.18, 0.56), 0xffffff, [0, (H - 0.18) / 2, 0], null, null, { faces: { pz: 'ICE', nz: 'ICE' } });
      k.add(G.box(2.2, H - 0.3, 0.5), 0xa6dcf7, [0, (H - 0.3) / 2, 0]);
      for (let i = 0; i < 7; i++) k.add(G.sph(0.24, 8, 5), 0xf6fbff, [-0.9 + i * 0.3, H - 0.14, ((i * 13) % 5) * 0.04 - 0.08], null, [1.1, 0.55, 1.2]);
      k.add(G.ico(0.34, 0), 0xbfe8ff, [-0.9, 0.2, 0.3], [0.3, 0.5, 0]);
      k.add(G.ico(0.26, 0), 0xd6f4ff, [0.85, 0.16, 0.32], [0.1, 0.9, 0.3]);
      V.lamps.push([-0.95, H + 0.1, 0.12, LAMP_RED, 2, 0.08, 1.0], [0.95, H + 0.1, 0.12, LAMP_RED, 2, 0.08, 1.0]);
    }
    return V;
  }
  // Ramp: foot at local z = 0 (height 0), top at z = -RAMP_L (height TRAIN_H), plus a flat bridge plate to the roof walkway.
  function buildRamp(wi) {
    const V = variant(), k = V.solid, RL = C.RAMP_L, H = TRAIN_H, th = 0.12;
    V.blob = [2.8, RL + 0.5];
    const ang = Math.atan2(H, RL), slen = Math.hypot(H, RL), ny = Math.cos(ang), nz = Math.sin(ang);
    const style = [
      { rail: 0xf7c21b, post: 0x6d7383, leg: 0x6d7383, side: 0x6b4a2e },
      { rail: 0x1fc2c9, post: 0xe8dcc0, leg: 0x9a6a3c, side: 0xb89a6a },
      { rail: 0xff6fb5, post: 0xffffff, leg: 0x6e3f23, side: 0xd29a52 },
      { rail: 0x2a2848, post: 0x1c1a33, leg: 0x1c1a33, side: 0x1c1a33 },
      { rail: 0xe8322e, post: 0x8a5a32, leg: 0x6e4a2e, side: 0x8a7a6a }
    ][wi];
    // deck: top surface through (z 0, y 0) and (z -RL, y H)
    k.add(G.box(2.0, th, slen), 0xffffff, [0, H / 2 - ny * th / 2, -RL / 2 - nz * th / 2], [ang, 0, 0], null, { faces: { py: 'DECK' + wi } });
    // bridge plate onto the roof walkway (top at TRAIN_H) and a support lip resting on the nose
    k.add(G.box(T.WALK_W, 0.08, WALK_FRONT), 0x4a4e5a, [0, H - 0.04, -RL - WALK_FRONT / 2]);
    k.add(G.box(2.0, 0.3, 0.14), style.side, [0, H - 0.2, -RL + 0.02]);
    // side curbs + handrails
    [-1.0, 1.0].forEach((x) => {
      k.add(G.box(0.08, 0.16, slen), 0xffffff, [x, H / 2 + ny * 0.06, -RL / 2 + nz * 0.06], [ang, 0, 0], null, { faces: { px: 'CHEV', nx: 'CHEV' }, swap: true });
      for (let i = 0; i < 4; i++) { const z = -1.2 - i * 1.8, y = (H * -z) / RL; k.add(G.box(0.05, 0.5, 0.05), style.post, [x, y + 0.25, z]); }
      k.add(G.box(0.06, 0.06, slen * 0.8), style.rail, [x, H * 0.55 + 0.5, -RL * 0.55], [ang, 0, 0]);
    });
    // A-frame supports down to the ballast
    [-2.2, -4.6, -6.6].forEach((z) => {
      const yTop = (H * -z) / RL - th / ny - 0.02;
      if (yTop < 0.2) return;
      [-0.85, 0.85].forEach((x) => { const dx = -x * 0.55, len = Math.hypot(dx, yTop); k.add(G.box(0.1, len, 0.1), style.leg, [x + dx / 2, yTop / 2, z], [0, 0, Math.atan2(dx, yTop) * -1], null, { ao: true }); });
      k.add(G.box(1.5, 0.08, 0.08), style.leg, [0, yTop * 0.45, z]);
      k.add(G.box(0.9, 0.1, 0.12), style.leg, [0, yTop - 0.05, z]);
    });
    // chevron mat at the foot
    k.add(G.box(2.0, 0.04, 0.9), 0xffffff, [0, 0.3, 0.45], null, null, { faces: { py: 'ARROW' } });
    [-1.05, 1.05].forEach((x) => { k.add(G.box(0.12, 0.5, 0.12), 0xffffff, [x, 0.25, 0.7], null, null, { faces: { pz: 'CHEV', nz: 'CHEV', px: 'CHEV', nx: 'CHEV' }, swap: true }); lampHousing(k, x, 0.57, 0.7); });
    V.lamps.push([-1.05, 0.58, 0.7, LAMP_AMB, 2, 0.06, 0.7], [1.05, 0.58, 0.7, LAMP_AMB, 2, 0.06, 0.7]);
    if (wi === 3) [-1.0, 1.0].forEach((x) => V.glow.add(G.box(0.03, 0.03, slen), 0x39f0ff, [x, H / 2 + ny * 0.15, -RL / 2 + nz * 0.15], [ang, 0, 0]));
    return V;
  }

  // ------------------------------------------------------------------ coins and pickups geometry
  function buildCoinGeo(seg) {
    const R = 0.36, pts = [[0, 0.03], [0.25, 0.03], [0.27, 0.05], [0.325, 0.05], [0.36, 0.028], [0.36, -0.028], [0.325, -0.05], [0.27, -0.05], [0.25, -0.03], [0, -0.03]];
    const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg);
    g.rotateX(PI / 2); // axis along z: the coin faces the runner, spins about y in the shader
    const P = g.attributes.position.array, uv = g.attributes.uv.array;
    for (let i = 0, n = P.length / 3; i < n; i++) { uv[i * 2] = P[i * 3] / (2 * R) + 0.5; uv[i * 2 + 1] = P[i * 3 + 1] / (2 * R) + 0.5; }
    g.attributes.uv.needsUpdate = true;
    return g;
  }
  function buildIcon(kind) {
    const k = new Kit();
    if (kind === 'magnet') {
      k.add(G.tor(0.26, 0.1, 10, 20, PI), 0xe8323e, [0, 0.02, 0]);
      [-0.26, 0.26].forEach((x) => { k.add(G.cyl(0.1, 0.1, 0.22, 12), 0xe8323e, [x, -0.09, 0]); k.add(G.cyl(0.102, 0.102, 0.14, 12), 0xe6ebf2, [x, -0.27, 0]); });
    } else if (kind === 'sneakers') { // high-top sneaker, side profile (toe toward +x)
      const up = new THREE.Shape();
      up.moveTo(-0.36, -0.1); up.lineTo(0.36, -0.1); up.quadraticCurveTo(0.46, -0.08, 0.44, 0.02); up.quadraticCurveTo(0.4, 0.1, 0.2, 0.12);
      up.lineTo(0.02, 0.2); up.lineTo(-0.06, 0.4); up.lineTo(-0.34, 0.42); up.quadraticCurveTo(-0.42, 0.3, -0.4, 0.08); up.closePath();
      const ug = new THREE.ExtrudeGeometry(up, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 2 }); ug.translate(0, 0.02, -0.12);
      k.add(ug, 0x2fd67a, [0, 0, 0]);
      const so = new THREE.Shape(); so.moveTo(-0.42, -0.18); so.lineTo(0.42, -0.18); so.quadraticCurveTo(0.52, -0.16, 0.5, -0.04); so.lineTo(-0.44, -0.04); so.closePath();
      const sg = new THREE.ExtrudeGeometry(so, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }); sg.translate(0, 0, -0.15);
      k.add(sg, 0xf8f8f8, [0, 0, 0]);
      k.add(G.box(0.9, 0.035, 0.34), 0xff4fa3, [0.03, -0.155, 0]);
      k.add(G.sph(0.14, 10, 6, 0, TAU, 0, PI / 2), 0xf8f8f8, [0.33, -0.05, 0], [0, 0, 0], [1.1, 0.8, 1.05]);
      [1, -1].forEach((sd) => {
        k.add(G.box(0.46, 0.07, 0.02), 0xffe14d, [-0.04, 0.08, 0.17 * sd], [0, 0, 0.42]);
        k.add(G.box(0.3, 0.05, 0.02), 0xff4fa3, [-0.08, 0.0, 0.17 * sd], [0, 0, 0.3]);
        k.add(G.cyl(0.035, 0.035, 0.02, 8), 0xffffff, [-0.28, 0.3, 0.17 * sd], [PI / 2, 0, 0]);
      });
      for (let i = 0; i < 4; i++) k.add(G.box(0.035, 0.022, 0.3), 0xffffff, [0.14 - i * 0.07, 0.15 + i * 0.05, 0], [0, 0, -0.5]);
      k.add(G.box(0.12, 0.1, 0.24), 0xf8f8f8, [-0.22, 0.46, 0], [0, 0, 0.2]);
    } else if (kind === 'double') {
      k.add(G.cyl(0.36, 0.36, 0.1, 22), 0x8e5cf7, [0, 0, 0], [PI / 2, 0, 0]);
      k.add(G.tor(0.36, 0.04, 6, 24), 0xffd23f, [0, 0, 0]);
      const two = new THREE.Shape();
      two.moveTo(-0.12, 0.08); two.quadraticCurveTo(-0.12, 0.2, 0, 0.2); two.quadraticCurveTo(0.12, 0.2, 0.12, 0.08); two.quadraticCurveTo(0.12, 0.0, 0.02, -0.07); two.lineTo(-0.03, -0.11); two.lineTo(0.13, -0.11); two.lineTo(0.13, -0.19); two.lineTo(-0.14, -0.19); two.lineTo(-0.14, -0.12); two.lineTo(0.0, 0.0); two.quadraticCurveTo(0.05, 0.05, 0.05, 0.09); two.quadraticCurveTo(0.05, 0.13, 0, 0.13); two.quadraticCurveTo(-0.05, 0.13, -0.05, 0.08); two.closePath();
      [1, -1].forEach((sd) => {
        const tg = new THREE.ExtrudeGeometry(two, { depth: 0.04, bevelEnabled: false }); if (sd < 0) tg.rotateY(PI);
        k.add(tg, 0xffe14d, [-0.07 * sd, 0, 0.05 * sd]);
        k.add(G.box(0.03, 0.14, 0.04), 0xffe14d, [0.14 * sd, -0.08, 0.07 * sd], [0, 0, 0.785]);
        k.add(G.box(0.03, 0.14, 0.04), 0xffe14d, [0.14 * sd, -0.08, 0.07 * sd], [0, 0, -0.785]);
      });
    } else if (kind === 'jetpack') {
      [-0.14, 0.14].forEach((x) => {
        k.add(G.cyl(0.12, 0.12, 0.44, 12), 0xe6ebf2, [x, 0.02, 0]);
        k.add(G.sph(0.12, 12, 6, 0, TAU, 0, PI / 2), 0xe8323e, [x, 0.24, 0]);
        k.add(G.cone(0.08, 0.12, 10), 0x3a3d48, [x, -0.26, 0], [PI, 0, 0]);
        k.add(G.cone(0.07, 0.24, 8), 0xffa028, [x, -0.44, 0], [PI, 0, 0]);
        k.add(G.box(0.25, 0.04, 0.26), 0xffd23f, [x, 0.1, 0]);
      });
      k.add(G.box(0.18, 0.38, 0.1), 0x3a3d48, [0, 0.02, -0.1]);
    } else { // hoverboard, tilted so its deck art faces the runner
      const b = new Kit();
      const s = new THREE.Shape(); s.moveTo(-0.4, -0.16); s.lineTo(0.4, -0.16); s.absarc(0.4, 0, 0.16, -PI / 2, PI / 2, false); s.lineTo(-0.4, 0.16); s.absarc(-0.4, 0, 0.16, PI / 2, PI * 1.5, false);
      const bg = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2 }); bg.translate(0, 0, -0.025);
      b.add(bg, 0x33d6ff, [0, 0, 0]);
      b.add(G.box(0.86, 0.1, 0.02), 0xff4fa3, [0, 0, 0.045]);
      b.add(G.box(0.6, 0.05, 0.022), 0xffe14d, [0, 0.1, 0.045]);
      b.add(G.box(0.6, 0.05, 0.022), 0xffffff, [0, -0.1, 0.045]);
      [-0.36, 0.36].forEach((x) => { b.add(G.cyl(0.1, 0.12, 0.06, 12), 0xff4fa3, [x, 0, -0.06], [PI / 2, 0, 0]); b.add(G.cyl(0.07, 0.07, 0.065, 12), 0x9ff3ff, [x, 0, -0.07], [PI / 2, 0, 0]); });
      const g = b.build(); g.rotateX(-0.35); g.rotateZ(0.3); g.scale(1.1, 1.1, 1.1);
      k.add(g, 0xffffff, [0, 0, 0], null, null, { keepColor: true, keepUv: true });
    }
    return k.build();
  }

  // ------------------------------------------------------------------ shaders
  // Extra distance fade folded into the fog, so anything spawned at the far end blends into the horizon.
  const FOG_FS = [
    '#ifdef USE_FOG',
    '  #ifdef FOG_EXP2',
    '    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );',
    '  #else',
    '    float fogFactor = smoothstep( fogNear, fogFar, fogDepth );',
    '  #endif',
    '  fogFactor = max( fogFactor, smoothstep( 470.0, 515.0, fogDepth ) );',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    '  if ( fogDepth > 495.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) < smoothstep( 495.0, 540.0, fogDepth ) ) discard;',
    '#endif'
  ].join('\n');
  function makeBodyMat() {
    const m = new THREE.MeshPhongMaterial({ map: livAtlas.tex, shininess: 42, specular: 0x2c2c30 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uSkyTop: U.skyTop, uHor: U.hor, uGnd: U.gnd, uLit: U.lit, uNight: U.night, uRoof: U.roof });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aTex;\nattribute float aKind;\nvarying vec4 vAt;\nvarying float vKind;')
        .replace('#include <uv_vertex>', [
          '#include <uv_vertex>',
          'vKind = aKind;',
          'if ( aKind < 0.5 ) {',
          '  float along = -position.z;',
          '  float uu = aTex.y + ( position.x >= 0.0 ? along : 1.0 - along ) * aTex.z;',
          '  vAt = vec4( uu, aTex.x, uv.y, along * aTex.w );',
          '} else if ( aKind < 2.5 ) {',
          '  float s = aKind < 1.5 ? aTex.x + 10.0 : aTex.x;',
          '  float sx = mod( s, 8.0 ), sy = floor( s / 8.0 );',
          '  vec2 px = vec2( sx * 128.0 + 2.0 + uv.x * 124.0, 1280.0 + sy * 128.0 + 2.0 + ( 1.0 - uv.y ) * 124.0 );',
          '  vAt = vec4( px.x / 1024.0, 1.0 - px.y / 2048.0, uv.y, 0.0 );',
          '} else if ( aKind < 3.5 ) {',
          '  vAt = vec4( 0.004, aTex.x, uv.y, 0.0 );',
          '} else {',
          '  vec4 wp = modelMatrix * instanceMatrix * vec4( position, 1.0 );',
          '  vAt = vec4( position.x, wp.z, position.y, 0.0 );',
          '}'
        ].join('\n'));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkyTop; uniform vec3 uHor; uniform vec3 uGnd; uniform vec3 uLit; uniform float uNight; uniform vec3 uRoof;\nvarying vec4 vAt;\nvarying float vKind;')
        .replace('#include <map_fragment>', [
          'vec4 texelColor = vec4( 1.0 );',
          'float glass = 0.0; float sideV = 0.5;',
          'if ( vKind < 0.5 || ( vKind > 2.5 && vKind < 3.5 ) ) {',
          '  if ( vKind < 0.5 && vAt.z > 1.0 ) {',
          '    float f = abs( fract( vAt.w * 1.25 ) - 0.5 );',
          '    float rib = smoothstep( 0.43, 0.47, f );',
          '    texelColor.rgb = uRoof * ( 1.0 - 0.2 * rib ) * ( 0.92 + 0.08 * clamp( vAt.z - 1.0, 0.0, 1.0 ) );',
          '  } else {',
          '    float vs = clamp( vAt.z, 0.0, 1.0 ); sideV = vs;',
          '    vec2 tuv = vec2( vAt.x, 1.0 - ( vAt.y * 128.0 + 1.5 + ( 1.0 - vs ) * 125.0 ) / 2048.0 );',
          '    texelColor = texture2D( map, tuv );',
          '    glass = 1.0 - smoothstep( 0.3, 0.75, texelColor.a );',
          '  }',
          '} else if ( vKind < 2.5 ) {',
          '  texelColor = texture2D( map, vAt.xy ); sideV = vAt.z;',
          '  glass = 1.0 - smoothstep( 0.3, 0.75, texelColor.a );',
          '} else if ( vKind < 4.5 ) {',
          '  vec2 p = vec2( vAt.x, vAt.y ) * 6.0;',
          '  vec2 q = vec2( p.x + p.y, p.x - p.y ) * 0.7071;',
          '  vec2 cell = floor( q ); vec2 fq = fract( q ) - 0.5;',
          '  if ( mod( cell.x + cell.y, 2.0 ) > 0.5 ) fq = fq.yx;',
          '  float stud = smoothstep( 0.2, 0.1, abs( fq.x ) ) * smoothstep( 0.42, 0.32, abs( fq.y ) );',
          '  vec3 plate = mix( vec3( 0.34, 0.35, 0.40 ), vec3( 0.58, 0.60, 0.66 ), stud );',
          '  float edge = step( 0.47, abs( vAt.x ) );',
          '  float st = step( 0.5, fract( ( vAt.y + vAt.x ) * 1.6 ) );',
          '  texelColor.rgb = mix( plate, mix( vec3( 0.93, 0.74, 0.1 ), vec3( 0.12, 0.12, 0.14 ), st ), edge );',
          '} else {',
          '  texelColor.rgb = mix( vec3( 0.42, 0.43, 0.48 ), vec3( 0.93, 0.74, 0.1 ), step( 2.975, vAt.z ) );',
          '}',
          'texelColor.a = 1.0;',
          'diffuseColor *= texelColor;'
        ].join('\n'))
        .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', [
          'if ( glass > 0.001 ) {',
          '  vec3 nW = inverseTransformDirection( normal, viewMatrix );',
          '  vec3 eW = inverseTransformDirection( normalize( vViewPosition ), viewMatrix );',
          '  vec3 rW = reflect( -eW, nW );',
          '  vec3 sky = mix( uHor, uSkyTop, smoothstep( -0.05, 0.6, rW.y ) );',
          '  sky = mix( sky, uGnd, smoothstep( -0.05, -0.45, rW.y ) );',
          '  float sc = vKind < 0.5 ? vAt.w : vAt.x * 9.0;',
          '  float streak = smoothstep( 0.1, 0.0, abs( fract( ( sc + sideV * 1.4 ) * 0.55 ) - 0.5 ) - 0.36 );',
          '  float tw = smoothstep( 0.42, 0.86, sideV );',
          '  vec3 gc = mix( vec3( 0.06, 0.07, 0.12 ), sky, 0.16 + 0.6 * tw ) + vec3( 0.22 * streak * ( 0.4 + tw ) );',
          '  gc = mix( gc, uLit * ( 0.8 + 0.2 * sideV ), uNight );',
          '  outgoingLight = mix( outgoingLight, gc, glass );',
          '}',
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );'
        ].join('\n'))
        .replace('#include <fog_fragment>', FOG_FS);
    };
    m.customProgramCacheKey = () => 'rr-obstacles-body-v2';
    return m;
  }
  function makePropMat() {
    const m = new THREE.MeshPhongMaterial({ map: hzAtlas.tex, vertexColors: true, shininess: 26, specular: 0x1c1c1c });
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', FOG_FS); };
    m.customProgramCacheKey = () => 'rr-obstacles-prop-v2';
    return m;
  }
  const FX_VS = [
    'uniform float uMode; uniform float uTime;',
    'attribute vec2 aLamp;',
    'varying vec2 vUv; varying vec3 vCol; varying float vBlink; varying vec3 vN; varying vec3 vV; varying float vDepth;',
    'void main() {',
    '  vUv = uv;',
    '  vec3 col = vec3( 1.0 );',
    '  #ifdef USE_INSTANCING_COLOR',
    '  col = instanceColor;',
    '  #endif',
    '  #ifdef USE_COLOR',
    '  col *= color;',
    '  #endif',
    '  vCol = col;',
    '  float m = aLamp.x, ph = aLamp.y, b = 1.0;',
    '  if ( m > 0.5 && m < 1.5 ) b = 0.12 + 0.88 * step( 0.25, sin( uTime * 7.5 + ph ) );',
    '  else if ( m > 1.5 && m < 2.5 ) { float s = 0.5 + 0.5 * sin( uTime * 4.4 + ph ); b = 0.22 + 0.78 * s * s * s; }',
    '  else if ( m > 3.5 ) b = 0.45 + 0.08 * sin( uTime * 3.0 + ph );',
    '  else if ( m > 2.5 ) b = 0.88 + 0.12 * sin( uTime * 23.0 + ph ) * sin( uTime * 7.0 + ph * 2.0 );',
    '  vBlink = b;',
    '  vec4 mv;',
    '  if ( abs( uMode - 1.0 ) < 0.1 ) {',
    '    vec4 c = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );',
    '    float s = length( instanceMatrix[ 0 ].xyz );',
    '    mv = c; mv.xy += position.xz * vec2( s, -s ); mv.xyz += normalize( -c.xyz ) * ( m > 3.5 ? -0.9 : min( 0.45, s * 0.4 ) );',
    '  } else {',
    '    mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );',
    '  }',
    '  vN = normalize( normalMatrix * ( mat3( instanceMatrix ) * normal ) );',
    '  vV = -mv.xyz; vDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  const FX_FS = [
    'uniform float uMode; uniform float uTime; uniform float uBoost; uniform float uFogK; uniform float uAlpha;',
    'uniform vec3 uFogCol; uniform float uFogN; uniform float uFogF;',
    'varying vec2 vUv; varying vec3 vCol; varying float vBlink; varying vec3 vN; varying vec3 vV; varying float vDepth;',
    'void main() {',
    '  float fog = max( smoothstep( uFogN, uFogF, vDepth ), smoothstep( 470.0, 515.0, vDepth ) ) * uFogK;',
    '  float far = 1.0 - smoothstep( 440.0, 510.0, vDepth );',
    '  vec3 n = normalize( vN ), v = normalize( vV );',
    '  float facing = abs( dot( n, v ) );',
    '  int mode = int( uMode + 0.5 );',
    '  vec3 c = vec3( 0.0 );',
    '  if ( mode == 0 ) {',
    '    if ( vDepth > 495.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) < smoothstep( 495.0, 540.0, vDepth ) ) discard;',
    '    c = vCol * uBoost * ( 0.25 + 0.75 * vBlink );',
    '    gl_FragColor = vec4( mix( c, uFogCol, fog ), 1.0 );',
    '    return;',
    '  }',
    '  if ( mode == 7 ) {',
    '    float d = length( ( vUv - 0.5 ) * 2.0 );',
    '    float a = ( 1.0 - smoothstep( 0.15, 1.0, d ) ) * uAlpha * ( 1.0 - fog );',
    '    gl_FragColor = vec4( 0.0, 0.0, 0.0, a );',
    '    return;',
    '  }',
    '  if ( mode == 1 ) {',
    '    float d = length( ( vUv - 0.5 ) * 2.0 );',
    '    float a = pow( max( 0.0, 1.0 - d ), 2.4 ) * 0.75 + pow( max( 0.0, 1.0 - d ), 10.0 ) * 0.9;',
    '    c = vCol * a * vBlink * uBoost;',
    '  } else if ( mode == 2 ) {',
    '    c = vCol * pow( vUv.y, 1.7 ) * pow( facing, 1.4 ) * 0.42 * uBoost;',
    '  } else if ( mode == 3 ) {',
    '    vec2 e = vec2( ( vUv.x - 0.5 ) * 2.0, ( 1.0 - vUv.y ) * 1.25 - 0.1 );',
    '    float d = length( e );',
    '    c = vCol * pow( max( 0.0, 1.0 - d ), 1.8 ) * 0.5 * uBoost;',
    '  } else if ( mode == 4 ) {',
    '    float bands = 0.7 + 0.3 * sin( vUv.y * 90.0 - uTime * 6.0 );',
    '    float nearF = smoothstep( 7.0, 30.0, vDepth );',
    '    c = vCol * ( pow( facing, 2.2 ) * pow( 1.0 - vUv.y, 2.6 ) * bands * 0.32 + pow( 1.0 - vUv.y, 30.0 ) * 0.35 ) * nearF * uBoost;',
    '  } else if ( mode == 5 ) {',
    '    if ( vUv.y > 1.5 ) {',
    '      float sl = 0.5 + 0.5 * sin( ( vUv.y - 2.0 ) * 60.0 - uTime * 7.0 );',
    '      c = vCol * ( 0.06 + 0.07 * sl ) * uBoost;',
    '    } else {',
    '      float flick = 0.85 + 0.15 * sin( uTime * 37.0 + vUv.x * 13.0 );',
    '      c = vCol * ( 0.35 + 1.4 * pow( facing, 3.0 ) ) * flick * uBoost;',
    '    }',
    '  } else if ( mode == 8 ) {',
    '    float s = 0.5 + 0.5 * sin( vUv.y * 90.0 - uTime * 9.0 );',
    '    float hx = abs( fract( vUv.x * 9.0 + 0.5 * floor( vUv.y * 12.0 ) ) - 0.5 );',
    '    vec2 q = vec2( ( vUv.x - 0.5 ) * 1.86, ( vUv.y - 0.53 ) * 2.76 );',
    '    float tri = max( abs( q.x ) * 0.866 + q.y * 0.5, -q.y ) - 0.32;',
    '    float edge = smoothstep( 0.05, 0.015, abs( tri ) );',
    '    float bang = step( abs( q.x ), 0.045 ) * ( step( -0.04, q.y ) * step( q.y, 0.3 ) + step( abs( q.y + 0.15 ), 0.05 ) );',
    '    float pulse = 0.65 + 0.35 * sin( uTime * 5.0 );',
    '    c = ( vCol * ( 0.05 + 0.08 * s + 0.1 * smoothstep( 0.42, 0.5, hx ) ) + vec3( 1.0, 0.85, 0.2 ) * ( edge + bang ) * 0.9 * pulse ) * uBoost;',
    '  } else {',
    '    float rim = pow( 1.0 - facing, 2.2 );',
    '    float sw = 0.5 + 0.5 * sin( vUv.x * 18.85 + vUv.y * 9.0 + uTime * 2.0 );',
    '    vec3 rb = 0.5 + 0.5 * cos( 6.2832 * ( vUv.y * 0.8 + uTime * 0.15 + vec3( 0.0, 0.33, 0.67 ) ) );',
    '    c = ( vCol * ( 0.05 + rim * 1.15 ) + rb * rim * 0.4 * sw ) * uBoost;',
    '  }',
    '  gl_FragColor = vec4( c * ( 1.0 - fog ) * far, 1.0 );',
    '}'
  ].join('\n');
  const FX_MODE = { glow: 0, halo: 1, cone: 2, pool: 3, pillar: 4, laser: 5, bubble: 6, blob: 7, sheet: 8 };
  function makeFxMat(mode, opts) {
    const o = opts || {};
    const m = new THREE.ShaderMaterial({
      uniforms: { uMode: { value: FX_MODE[mode] }, uTime: U.time, uBoost: U.boost, uFogK: { value: o.fogK === undefined ? 1 : o.fogK }, uAlpha: { value: o.alpha === undefined ? 1 : o.alpha }, uFogCol: U.fogCol, uFogN: U.fogN, uFogF: U.fogF },
      vertexShader: FX_VS, fragmentShader: FX_FS, vertexColors: true, side: THREE.DoubleSide, fog: false, lights: false,
      transparent: mode !== 'glow', depthWrite: mode === 'glow',
      blending: mode === 'glow' ? THREE.NormalBlending : mode === 'blob' ? THREE.NormalBlending : THREE.AdditiveBlending
    });
    if (mode === 'blob') { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    fxMats.push(m);
    return m;
  }
  const COIN_VS = [
    'uniform float uTime;',
    'varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vGl; varying float vDepth;',
    'void main() {',
    '  vec3 t = instanceMatrix[ 3 ].xyz;',
    '  float ph = t.x * 1.3 + t.z * 0.61 + t.y * 0.7;',
    '  float a = uTime * 3.4 + ph;',
    '  float c = cos( a ), s = sin( a );',
    '  vec3 p = vec3( c * position.x + s * position.z, position.y, -s * position.x + c * position.z );',
    '  vec3 nn = vec3( c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z );',
    '  vec4 mv = modelViewMatrix * instanceMatrix * vec4( p, 1.0 );',
    '  vN = normalize( normalMatrix * ( mat3( instanceMatrix ) * nn ) );',
    '  vV = -mv.xyz; vUv = uv; vDepth = -mv.z;',
    '  vGl = fract( uTime * 0.21 + fract( ph * 0.1731 ) ) / 0.1;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  const COIN_FS = [
    'uniform sampler2D uMatcap; uniform sampler2D uStar; uniform float uBoost; uniform vec3 uFogCol; uniform float uFogN; uniform float uFogF;',
    'varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying float vGl; varying float vDepth;',
    'void main() {',
    '  vec3 n = normalize( vN ); vec3 v = normalize( vV );',
    '  vec3 x = normalize( vec3( v.z, 0.0, -v.x ) ); vec3 y = cross( v, x );',
    '  vec2 muv = vec2( dot( x, n ), dot( y, n ) ) * 0.495 + 0.5;',
    '  vec3 col = texture2D( uMatcap, muv ).rgb;',
    '  float st = texture2D( uStar, vUv ).r;',
    '  float se = texture2D( uStar, vUv + vec2( 0.014, -0.014 ) ).r;',
    '  col *= 0.84 + 0.3 * st;',
    '  col += vec3( 1.0, 0.9, 0.6 ) * clamp( st - se, 0.0, 1.0 ) * 0.45;',
    '  col -= vec3( 0.25, 0.18, 0.05 ) * clamp( se - st, 0.0, 1.0 );',
    '  if ( vGl < 1.0 ) {',
    '    float band = smoothstep( 0.16, 0.0, abs( ( vUv.x + vUv.y ) - ( vGl * 2.6 - 0.3 ) ) );',
    '    col += vec3( 1.0, 0.96, 0.8 ) * band * 1.3 * uBoost;',
    '  }',
    '  float fog = max( smoothstep( uFogN, uFogF, vDepth ), smoothstep( 470.0, 515.0, vDepth ) );',
    '  if ( vDepth > 495.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) < smoothstep( 495.0, 540.0, vDepth ) ) discard;',
    '  gl_FragColor = vec4( mix( col, uFogCol, fog ), 1.0 );',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------ layers (instanced, dense)
  class Layer {
    constructor(name, geo, mat, cap, o) {
      o = o || {};
      this.name = name; this.cap = cap; this.n = 0; this.on = true; this.shadow = !!o.shadow; this.recv = !!o.recv;
      this.exSize = o.extra ? o.extraSize : 0;
      if (this.exSize) {
        this.ex = new Float32Array(cap * this.exSize);
        this.exAttr = new THREE.InstancedBufferAttribute(this.ex, this.exSize); this.exAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(o.extra, this.exAttr);
      }
      const m = (this.mesh = new THREE.InstancedMesh(geo, mat, cap));
      m.name = 'obstacles-' + name; m.frustumCulled = false; m.count = 0; m.matrixAutoUpdate = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      if (o.order !== undefined) m.renderOrder = o.order;
      this.mat = m.instanceMatrix.array; this.col = m.instanceColor.array;
      this.own = new Array(cap).fill(null); this.pidx = new Int32Array(cap);
      this.dm = this.dc = this.de = false;
      this.lo = cap; this.hi = -1; // dirty slot range (partial buffer uploads)
      root.add(m);
    }
    mark(s) { if (s < this.lo) this.lo = s; if (s > this.hi) this.hi = s; }
    alloc(vis, k) {
      if (this.n >= this.cap) { if (!warnedOverflow) { warnedOverflow = true; console.warn('[obstacles] layer full: ' + this.name); } return -1; }
      const s = this.n++; this.own[s] = vis; this.pidx[s] = k;
      this.col[s * 3] = this.col[s * 3 + 1] = this.col[s * 3 + 2] = 1; this.dc = true; this.mark(s);
      if (this.exSize) { for (let j = 0; j < this.exSize; j++) this.ex[s * this.exSize + j] = 0; this.de = true; }
      return s;
    }
    free(s) {
      const last = --this.n;
      if (s !== last) {
        this.mat.copyWithin(s * 16, last * 16, last * 16 + 16);
        this.col.copyWithin(s * 3, last * 3, last * 3 + 3);
        if (this.exSize) this.ex.copyWithin(s * this.exSize, last * this.exSize, (last + 1) * this.exSize);
        const ov = this.own[last], ok = this.pidx[last];
        this.own[s] = ov; this.pidx[s] = ok; ov.slot[ok] = s;
        this.dm = this.dc = true; if (this.exSize) this.de = true;
        this.mark(s);
      }
      this.own[last] = null;
    }

    flush() {
      const m = this.mesh;
      m.count = this.n;
      m.visible = this.on && this.n > 0;
      m.castShadow = this.shadow && !!(quality && quality.shadows);
      m.receiveShadow = this.recv && !!(quality && quality.shadows);
      if (this.hi >= this.lo) { // upload only the slots touched since the last flush
        if (this.dm) range(m.instanceMatrix, this.lo, this.hi, 16);
        if (this.dc) range(m.instanceColor, this.lo, this.hi, 3);
        if (this.de) range(this.exAttr, this.lo, this.hi, this.exSize);
      }
      this.dm = this.dc = this.de = false; this.lo = this.cap; this.hi = -1;
    }
  }
  // Partial upload of an instanced attribute. three resets updateRange.count to -1 once it has uploaded, so a positive
  // count is a range still pending from an earlier flush this frame: merge with it instead of overwriting it.
  function range(a, lo, hi, size) {
    const r = a.updateRange; let s0 = lo * size, s1 = (hi + 1) * size;
    if (r.count > 0) { if (r.offset < s0) s0 = r.offset; if (r.offset + r.count > s1) s1 = r.offset + r.count; }
    r.offset = s0; r.count = s1 - s0; a.needsUpdate = true;
  }
  function addLayer(key, geo, mat, cap, o) { const l = new Layer(key, geo, mat, cap, o); layers.push(l); return layers.length - 1; }

  // ------------------------------------------------------------------ visuals (a vis = parts in layers, with local transforms)
  const MAXP = 150;
  class Vis {
    constructor() { this.n = 0; this.lay = new Int16Array(MAXP); this.slot = new Int32Array(MAXP); this.loc = new Float32Array(MAXP * 8); this.x = 0; this.y = 0; this.z = 0; this.k = 1; this.anim = 0; this.animT = 0; this.inAnim = false; this.rec = null; this.pick = null; }
  }
  const visPool = [];
  const animList = []; // vis being scaled in / poofed out
  function getVis(x, y, z) { const v = visPool.pop() || new Vis(); v.n = 0; v.x = x; v.y = y; v.z = z; v.k = 1; v.anim = 0; v.animT = 0; v.rec = null; v.pick = null; return v; }
  function part(v, li, lx, ly, lz, sx, sy, sz, ry) {
    if (li < 0 || v.n >= MAXP) return -1;
    const k = v.n, s = layers[li].alloc(v, k);
    if (s < 0) return -1;
    v.n++; v.lay[k] = li; v.slot[k] = s;
    const o = k * 8, L8 = v.loc; L8[o] = lx; L8[o + 1] = ly; L8[o + 2] = lz; L8[o + 3] = sx; L8[o + 4] = sy; L8[o + 5] = sz; L8[o + 6] = ry || 0; L8[o + 7] = 0;
    writePart(v, k);
    return k;
  }
  function writePart(v, k) {
    const Ly = layers[v.lay[k]], s = v.slot[k], o = k * 8, loc = v.loc, K = v.k < 1e-3 ? 1e-3 : v.k;
    const sx = loc[o + 3] * K, sy = loc[o + 4] * K, sz = loc[o + 5] * K, ry = loc[o + 6];
    const c = ry ? Math.cos(ry) : 1, sn = ry ? Math.sin(ry) : 0;
    const a = Ly.mat, i = s * 16;
    a[i] = c * sx; a[i + 1] = 0; a[i + 2] = -sn * sx; a[i + 3] = 0;
    a[i + 4] = 0; a[i + 5] = sy; a[i + 6] = 0; a[i + 7] = 0;
    a[i + 8] = sn * sz; a[i + 9] = 0; a[i + 10] = c * sz; a[i + 11] = 0;
    a[i + 12] = v.x + loc[o] * K; a[i + 13] = v.y + loc[o + 1] * K; a[i + 14] = v.z + loc[o + 2] * K; a[i + 15] = 1;
    Ly.dm = true; Ly.mark(s);
  }
  function writeVis(v) { for (let k = 0; k < v.n; k++) writePart(v, k); }
  function partColor(v, k, hex) { if (k < 0) return; const Ly = layers[v.lay[k]], s = v.slot[k]; _c.set(hex); Ly.col[s * 3] = _c.r; Ly.col[s * 3 + 1] = _c.g; Ly.col[s * 3 + 2] = _c.b; Ly.dc = true; Ly.mark(s); }
  function partExtra(v, k, a, b, c, d) {
    if (k < 0) return; const Ly = layers[v.lay[k]], s = v.slot[k], n = Ly.exSize; if (!n) return;
    const e = Ly.ex, i = s * n; e[i] = a; if (n > 1) e[i + 1] = b; if (n > 2) e[i + 2] = c; if (n > 3) e[i + 3] = d; Ly.de = true; Ly.mark(s);
  }
  function freeVis(v) {
    for (let k = 0; k < v.n; k++) layers[v.lay[k]].free(v.slot[k]);
    v.n = 0; v.rec = null; v.pick = null; v.anim = 0;
    visPool.push(v);
  }
  function startAnim(v, kind) { // kind 1 = pop in, 2 = poof out
    if (!v.inAnim) { v.inAnim = true; animList.push(v); } // a pooled vis can still be listed from its previous life
    v.anim = kind; v.animT = 0; v.k = kind === 1 ? 0.001 : 1;
    writeVis(v);
  }
  function lamp(v, x, y, z, color, mode, size, halo, phase) {
    const k = part(v, L.lamp, x, y, z, size, size, size, 0);
    partColor(v, k, color); partExtra(v, k, mode, phase);
    if (halo > 0) { const h = part(v, L.halo, x, y, z, halo, halo, halo, 0); partColor(v, h, color); partExtra(v, h, mode, phase); }
  }

  // ------------------------------------------------------------------ variant tables (filled in init)
  const VAR = { hurdle: [], bar: [], block: [], ramp: [] };
  function registerVariant(type, wi, V) {
    const e = { solid: -1, glow: -1, laser: -1, lamps: V.lamps, blob: V.blob };
    const cap = type === 'ramp' ? 20 : 44;
    e.solid = addLayer(type + '-' + WORLD_KINDS[wi], V.solid.build(), matProp, cap, { shadow: true, recv: true });
    if (!V.glow.empty()) e.glow = addLayer(type + '-glow-' + WORLD_KINDS[wi], V.glow.build(), makeFxMat('glow'), cap, { extra: 'aLamp', extraSize: 2 });
    if (!V.laser.empty()) {
      const lg = V.laser.build();
      if (type === 'block') e.laser = addLayer(type + '-field-' + WORLD_KINDS[wi], lg, makeFxMat('sheet'), cap, { extra: 'aLamp', extraSize: 2, order: 5 });
      else e.laser = addLayer(type + '-laser-' + WORLD_KINDS[wi], lg, makeFxMat('laser'), cap, { extra: 'aLamp', extraSize: 2, order: 5 });
    }
    VAR[type][wi] = e;
  }

  // ------------------------------------------------------------------ spawning
  let rs = 1;
  const rnd = () => hash(rs++);
  function spawnItem(it, chunkId, pz) {
    const r = newRec();
    r.id = nextId++; r.type = it.type; r.lane = it.lane | 0; r.x = LANES[r.lane];
    r.zF = it.zF; r.zB = it.zB; r.vz = it.vz || 0; r.cars = it.cars || 0; r.passed = false; r.nearCand = false; r.ghost = false;
    r.chunk = chunkId | 0; r.meetZ = it.meetZ || 0; r.len = it.len || it.zF - it.zB; r.ramped = !!it.ramped; r.vis = null;
    r._pa = NaN; r._pb = NaN;
    if (r.type === 'hurdle') { r.top = C.HURDLE_TOP; r.bottom = 0; }
    else if (r.type === 'bar') { r.top = C.BAR_TOP; r.bottom = C.BAR_BOTTOM; }
    else if (r.type === 'block') { r.top = C.BLOCK_TOP; r.bottom = 0; }
    else { r.top = TRAIN_H; r.bottom = 0; }
    if (r.vz) syncMover(r, pz);
    r.world = worldAt(r.type === 'train' || r.type === 'ramp' ? r.zF : (r.zF + r.zB) / 2);
    addRec(r);
    if (ready) buildVisFor(r, pz);
    return r;
  }
  function buildVisFor(r, pz) {
    let v;
    if (r.type === 'train') v = buildTrainVis(r);
    else if (r.type === 'ramp') v = buildVariantVis(r, VAR.ramp[r.world], r.zF);
    else v = buildVariantVis(r, VAR[r.type][r.world], (r.zF + r.zB) / 2);
    r.vis = v; v.rec = r;
    if (!inReset && r.zF < pz - 1 && r.zF > pz - T.POP_DIST) startAnim(v, 1);
  }
  function buildVariantVis(r, e, z) {
    const v = getVis(r.x, 0, z);
    if (!e) return v;
    part(v, e.solid, 0, 0, 0, 1, 1, 1, 0);
    if (e.glow >= 0) part(v, e.glow, 0, 0, 0, 1, 1, 1, 0);
    if (e.laser >= 0) { const k = part(v, e.laser, 0, 0, 0, 1, 1, 1, 0); partColor(v, k, r.type === 'block' ? 0xff3fd2 : r.type === 'bar' ? 0xff2fb8 : 0xff3355); }
    const ph = r.id * 1.618;
    for (let i = 0; i < e.lamps.length; i++) { const l = e.lamps[i]; lamp(v, l[0], l[1], l[2], l[3], l[4], l[5], l[6], ph + (i & 1) * PI); }
    part(v, L.blob, 0, 0.31, r.type === 'ramp' ? -C.RAMP_L / 2 : 0, e.blob[0], 1, e.blob[1], 0);
    return v;
  }
  function buildTrainVis(r) {
    const v = getVis(r.x, 0, r.zF), len = r.len; rs = (r.id * 7919) | 0;
    let cars = Math.max(1, Math.min(16, r.cars || Math.round(len / 11)));
    while (cars > 1 && (len - T.CAR_GAP * (cars - 1)) / cars < 6) cars--;
    const carLen = (len - T.CAR_GAP * (cars - 1)) / cars;
    const liv = r.vz ? WARN_LIV + (r.id & 1) : (rnd() * N_LIV) | 0;
    r.livery = liv;
    for (let c = 0; c < cars; c++) {
      const f = -c * (carLen + T.CAR_GAP), rear = f - carLen;
      let bf = f, bl = carLen;
      if (c === 0) { const k = part(v, L.nose, 0, 0, 0, 1, 1, 1, 0); partExtra(v, k, liv, 0, 0, 0); bf = f - NOSE_L; bl = carLen - NOSE_L; }
      const M = Math.max(1, Math.min(3, Math.round(bl / 4.5)));
      const uStart = M >= 3 ? 0 : ((rnd() * (4 - M)) | 0) / 3;
      const kb = part(v, L.body, 0, 0, bf, 1, 1, bl, 0); partExtra(v, kb, liv, uStart, M / 3, bl);
      part(v, L.under, 0, 0, f, 1, 1, carLen, 0);
      part(v, L.bogie, 0, 0, f - 2.0, 1, 1, 1, 0);
      part(v, L.bogie, 0, 0, rear + 2.0, 1, 1, 1, 0);
      const side = rnd() < 0.5 ? 0 : PI;
      if (c === 0 && cars > 1) part(v, L.roofB, 0, 0, f - carLen * 0.62, 1, 1, 1, side);
      else part(v, L.roofA, 0, 0, f - carLen * 0.62, 1, 1, 1, side);
      if (carLen > 9.5) part(v, L.roofA, 0, 0, f - carLen * 0.2 - (c === 0 ? 0.6 : 0), 1, 1, 1, PI - side);
      if (c < cars - 1) part(v, L.bellows, 0, 0, rear - T.CAR_GAP / 2, 1, 1, 1, 0);
    }
    part(v, L.walk, 0, 0, -WALK_FRONT, 1, 1, len - WALK_FRONT - 0.03, 0);
    const ph = r.id * 2.3;
    if (r.vz) {
      lamp(v, -0.68, 1.02, 0.05, 0xffffff, 3, 0.13, 2.4, ph); lamp(v, 0.68, 1.02, 0.05, 0xffffff, 3, 0.13, 2.4, ph + 1);
      lamp(v, -0.74, 2.88, -0.75, 0xff2020, 1, 0.13, 2.1, ph); lamp(v, 0.74, 2.88, -0.75, 0xffb000, 1, 0.13, 2.1, ph + PI);
      const kc = part(v, L.cone, 0, 1.02, 0.1, 1, 1, 1, 0); partColor(v, kc, 0xfff1c8);
      const kp = part(v, L.pool, 0, 0.33, 0.2, 1, 1, 1, 0); partColor(v, kp, 0xffe8b0);
    } else {
      lamp(v, -0.68, 1.02, 0.04, 0xfff0c8, 0, 0.11, 1.0, ph); lamp(v, 0.68, 1.02, 0.04, 0xfff0c8, 0, 0.11, 1.0, ph);
    }
    lamp(v, -0.5, 2.5, -0.13, 0xffb347, 0, 0.05, 0, 0); lamp(v, 0.5, 2.5, -0.13, 0xffb347, 0, 0.05, 0, 0);
    lamp(v, -0.72, 1.0, -len - 0.02, 0xff2828, 0, 0.07, 0.6, 0); lamp(v, 0.72, 1.0, -len - 0.02, 0xff2828, 0, 0.07, 0.6, 0);
    part(v, L.blob, 0, 0.31, -len / 2, 3.1, 1, len + 1.4, 0);
    return v;
  }
  function spawnPickup(kind, lane, y, z, chunk, pz) {
    const p = newPick();
    p.kind = KIND_COLOR[kind] !== undefined ? kind : 'magnet'; p.lane = lane; p.x = LANES[lane] !== undefined ? LANES[lane] : 0; p.y = y; p.z = z; p.chunk = chunk | 0; p.ph = hash(z * 10) * TAU; p.vis = null;
    picks.push(p);
    if (ready) {
      const v = getVis(p.x, p.y, p.z), col = KIND_COLOR[p.kind];
      v.pick = p; p.vis = v;
      part(v, L.icon[KINDS.indexOf(p.kind)], 0, 0, 0, 1, 1, 1, 0);
      partColor(v, part(v, L.bubble, 0, 0, 0, 1, 1, 1, 0), col);
      partColor(v, part(v, L.pillar, 0, -p.y + 0.02, 0, 1, 1, 1, 0), col);
      const kh = part(v, L.halo, 0, 0, 0, 2.6, 2.6, 2.6, 0); partColor(v, kh, col); partExtra(v, kh, 4, p.ph);
      if (!inReset && z < pz - 1 && z > pz - T.POP_DIST) startAnim(v, 1);
    }
    return p;
  }
  function removePick(i, poof) {
    const p = picks[i], l = picks.pop();
    if (i < picks.length) picks[i] = l;
    if (p.vis) { if (poof) { p.vis.pick = null; startAnim(p.vis, 2); } else freeVis(p.vis); }
    p.vis = null; pickPool.push(p);
  }
  function instantiate(ch, pz) {
    const items = ch.items || [];
    for (let i = 0; i < items.length; i++) spawnItem(items[i], ch.id, pz);
    const coins = ch.coins || [];
    for (let i = 0; i < coins.length; i++) { const c = coins[i]; addCoin(LANES[c.lane] !== undefined ? LANES[c.lane] : 0, c.y, c.z, ch.id, false); }
    const pk = ch.pickups || [];
    for (let i = 0; i < pk.length; i++) spawnPickup(pk[i].kind, pk[i].lane, pk[i].y, pk[i].z, ch.id, pz);
  }
  function generate(pz, maxCalls) {
    const d = RR.director;
    if (!d || typeof d.next !== 'function') return 0;
    const target = pz - C.SPAWN_AHEAD - 60;
    let calls = 0;
    while (d.frontier > target && calls < maxCalls) {
      calls++;
      let ch = null;
      try { ch = RR.director.next(); } catch (e) { if (!warnedDirector) { warnedDirector = true; console.error('[obstacles] director.next failed', e); } break; }
      if (ch) instantiate(ch, pz);
    }
    return calls;
  }
  function releaseRec(r, poof) {
    removeRec(r);
    if (r.vis) { const v = r.vis; r.vis = null; if (poof) { v.rec = null; startAnim(v, 2); } else freeVis(v); }
    recPool.push(r);
  }
  function clearAll() {
    for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; r._i = -1; if (r.vis) { freeVis(r.vis); r.vis = null; } recPool.push(r); }
    list.length = 0;
    while (picks.length) removePick(picks.length - 1, false);
    for (let i = 0; i < animList.length; i++) { const v = animList[i]; v.inAnim = false; if (v.anim === 2) { v.anim = 0; freeVis(v); } else v.anim = 0; }
    animList.length = 0;
    nCoins = 0;
    empty(passedOut);
    SV[0] = NaN;
  }

  // ================================================================== queries (hot path: no allocation)
  function probe(px, pzPrev, pz) {
    PR.rampH = -1; PR.ramp = null; PR.train = null;
    const hits = PR.hits; empty(hits);
    const lo = pz - HD, hi = pzPrev + HD;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (Math.abs(r.x - px) >= HW) continue;
      if (r.type === 'ramp') {
        if (pz <= r.zF && pz >= r.zB) { const h = (TRAIN_H * (r.zF - pz)) / (r.zF - r.zB); if (h > PR.rampH) { PR.rampH = h; PR.ramp = r; } }
        continue;
      }
      let sweptB = r.zB;
      if (r.vz) { syncMover(r, pzPrev); sweptB = r.zB; syncMover(r, pz); } // the train's own motion is part of the sweep
      if (r.type === 'train' && r.zB < pz + HD && r.zF > pz - HD) PR.train = r;
      if (sweptB < hi && r.zF > lo) hits.push(r);
    }
    return PR;
  }
  function laneBlocked(lane, py, pz) {
    const x = LANES[lane]; if (x === undefined) return false;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (Math.abs(r.x - x) >= HW) continue;
      if (r.type === 'ramp') { if (pz <= r.zF && pz >= r.zB) { const h = (TRAIN_H * (r.zF - pz)) / (r.zF - r.zB); if (h > py + 1.0) return true; } continue; }
      if (r.type !== 'train' && r.type !== 'block') continue;
      if (r.vz) syncMover(r, pz);
      if (r.zB < pz + HD && r.zF > pz - HD) {
        if (r.type === 'train' && py < C.TRAIN_KILL_Y) return true;
        if (r.type === 'block' && py < C.BLOCK_TOP) return true;
      }
    }
    return false;
  }
  function burst(kind, x, y, z) { const fx = RR.fx; if (fx && fx.burst) { try { fx.burst(kind, x, y, z); } catch (e) { /* fx is optional */ } } }
  function collect(px, py, pz, magnet, dt) {
    COL.coins = 0; empty(COL.pickups);
    const prev = SV[0] === SV[0] && Math.abs(SV[0] - pz) < 6 ? SV[0] : pz;
    SV[0] = pz; SV[1] = px;
    const zLo = pz - 0.7, zHi = prev + 0.7, yLo = py - 0.45, yHi = py + 2.25;
    const carry = pz - prev, step = T.MAG_SPEED * (dt > 0 ? dt : 1 / 120), ty = py + 1.1;
    for (let i = 0; i < nCoins;) {
      if (magnet && !cmag[i] && cz[i] < pz + T.MAG_BACK && cz[i] > pz - T.MAG_AHEAD) cmag[i] = 1;
      let got = false;
      if (cmag[i]) {
        cz[i] += carry; // magnetised coins travel with the runner and home in at MAG_SPEED
        const dx = px - cx[i], dy = ty - cy[i], dz = pz - 0.2 - cz[i], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= step + 0.55) got = true;
        else { const k = step / d; cx[i] += dx * k; cy[i] += dy * k; cz[i] += dz * k; }
      } else if (cz[i] > zLo && cz[i] < zHi && Math.abs(cx[i] - px) < 0.95 && cy[i] > yLo && cy[i] < yHi) got = true;
      if (got) { COL.coins++; burst('coin', cx[i], cy[i], cz[i]); removeCoin(i); continue; }
      i++;
    }
    for (let i = 0; i < picks.length;) {
      const p = picks[i];
      if (p.z > pz - 0.9 && p.z < prev + 0.9 && Math.abs(p.x - px) < 1.1 && p.y > py - 0.6 && p.y < py + 2.4) {
        COL.pickups.push(p.kind); burst('pickup', p.x, p.y, p.z);
        removePick(i, false);
        continue;
      }
      i++;
    }
    return COL;
  }
  function passed(pz) {
    empty(passedOut);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.passed) continue;
      if (r.vz) syncMover(r, pz);
      if (r.zB > pz + HD) { r.passed = true; passedOut.push(r); }
    }
    return passedOut;
  }
  function markNear(fromLane, pz, speed) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.lane !== fromLane || r.passed || (r.type !== 'train' && r.type !== 'block')) continue;
      if (r.vz) syncMover(r, pz);
      const ttc = (pz - r.zF) / ((speed || 1) + (r.vz || 0));
      if (ttc > 0 && ttc < 0.45) r.nearCand = true;
    }
  }
  function spawnSkyCoins(z0, z1) {
    if (!(z0 > z1)) return 0;
    const y = C.JETPACK_Y + 1;
    let best = 1, bd = 1e9;
    for (let l = 0; l < 3; l++) { const d = Math.abs(LANES[l] - SV[1]); if (d < bd) { bd = d; best = l; } }
    let lane = best, next = z0 - (45 + hash(z0) * 25), n = 0, shift = 0, from = lane;
    const SH = 12; // metres to glide between lanes
    for (let z = z0; z > z1; z -= T.SKY_SPACING) {
      if (z < next && shift <= 0) { from = lane; lane = lane === 1 ? (hash(z * 3.1) < 0.5 ? 0 : 2) : 1; shift = SH; next = z - (45 + hash(z * 7.3) * 25); }
      let x = LANES[lane];
      if (shift > 0) { const t = 1 - shift / SH, e = t * t * (3 - 2 * t); x = LANES[from] + (LANES[lane] - LANES[from]) * e; shift -= T.SKY_SPACING; }
      if (addCoin(x, y, z, 0, true) >= 0) n++;
    }
    return n;
  }
  function clearAhead(pz, metres) {
    const m = Math.max(60, +metres || 0);
    let dropped = null;
    const d = RR.director;
    if (d && d.clearAhead) { try { const res = d.clearAhead(pz, metres); dropped = res && res.dropped; } catch (e) { console.error('[obstacles] director.clearAhead failed', e); } }
    const isDropped = (id) => { if (!dropped || !id) return false; for (let i = 0; i < dropped.length; i++) if (dropped[i] === id) return true; return false; };
    const lo = pz - m, hi = pz + 2;
    let fxN = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.vz) syncMover(r, pz);
      const inRange = r.zB < hi && r.zF > lo;
      if (!inRange && !isDropped(r.chunk)) continue;
      const az = r.type === 'train' || r.type === 'ramp' ? r.zF : (r.zF + r.zB) / 2, dist = pz - az;
      const near = dist > -40 && dist < T.POOF_DIST;
      if (near && fxN < 10 && dist < T.POOF_FX_DIST && dist > -5) { fxN++; burst('poof', r.x, 1.0, Math.min(az, pz - 2)); }
      releaseRec(r, near && ready);
    }
    for (let i = 0; i < nCoins;) { if (!csky[i] && (isDropped(cchunk[i]) || (cz[i] < hi && cz[i] > lo))) { removeCoin(i); continue; } i++; }
    for (let i = picks.length - 1; i >= 0; i--) { const p = picks[i]; if (isDropped(p.chunk) || (p.z < hi && p.z > lo)) removePick(i, ready && pz - p.z < T.POOF_DIST); }
  }

  // ================================================================== lifecycle
  function init(c) {
    ctx = c || ctx; if (!ctx || !ctx.scene) return;
    scene = ctx.scene; quality = ctx.quality || RR.quality;
    if (ready) return;
    root = new THREE.Group(); root.name = 'obstacles'; scene.add(root);
    U.time = { value: 0 }; U.boost = { value: 1 }; U.fogCol = { value: new THREE.Color(0xffffff) }; U.fogN = { value: 1e5 }; U.fogF = { value: 1e5 + 1 };
    U.skyTop = { value: new THREE.Color(0x4f86d6) }; U.hor = { value: new THREE.Color(0xeaf4ff) }; U.gnd = { value: new THREE.Color(0x6b5a70) };
    U.lit = { value: new THREE.Color(1.0, 0.86, 0.55) }; U.night = { value: 0 }; U.roof = { value: new THREE.Color(0.72, 0.74, 0.8) };
    buildAtlases();
    matBody = makeBodyMat(); matProp = makePropMat();
    matCoin = new THREE.ShaderMaterial({ uniforms: { uTime: U.time, uBoost: U.boost, uMatcap: { value: coinTex.matcap }, uStar: { value: coinTex.star }, uFogCol: U.fogCol, uFogN: U.fogN, uFogF: U.fogF }, vertexShader: COIN_VS, fragmentShader: COIN_FS, fog: false, lights: false });
    // trains
    L.body = addLayer('train-body', buildBodyGeo(), matBody, 200, { shadow: true, recv: true, extra: 'aTex', extraSize: 4 });
    L.nose = addLayer('train-nose', buildNoseGeo(), matBody, 72, { shadow: true, recv: true, extra: 'aTex', extraSize: 4 });
    L.walk = addLayer('train-walkway', buildWalkGeo(), matBody, 72, { shadow: true, recv: true, extra: 'aTex', extraSize: 4 });
    L.under = addLayer('train-under', buildUnder(), matProp, 200, {});
    L.bogie = addLayer('train-bogie', buildBogie(), matProp, 400, {});
    L.bellows = addLayer('train-bellows', buildBellows(), matProp, 160, { shadow: true });
    L.roofA = addLayer('train-roof-ac', buildRoofA(), matProp, 320, { shadow: true });
    L.roofB = addLayer('train-roof-panto', buildRoofB(), matProp, 72, { shadow: true });
    // lamps and FX
    L.lamp = addLayer('lamps', withColor(new THREE.SphereGeometry(1, 8, 6)), makeFxMat('glow'), 900, { extra: 'aLamp', extraSize: 2 });
    L.halo = addLayer('halos', withColor(new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2)), makeFxMat('halo'), 700, { extra: 'aLamp', extraSize: 2, order: 6 });
    L.cone = addLayer('headlight-cones', buildConeGeo(), makeFxMat('cone'), 24, { extra: 'aLamp', extraSize: 2, order: 4 });
    L.pool = addLayer('headlight-pools', buildPoolGeo(), makeFxMat('pool'), 24, { extra: 'aLamp', extraSize: 2, order: 3 });
    L.blob = addLayer('blob-shadows', buildBlobGeo(), makeFxMat('blob', { alpha: 0.5 }), 260, { extra: 'aLamp', extraSize: 2, order: 1 });
    // obstacle skins + ramps per world
    for (let wi = 0; wi < 5; wi++) {
      const w = WORLD_KINDS[wi];
      registerVariant('hurdle', wi, buildHurdle(w));
      registerVariant('bar', wi, buildBar(w));
      registerVariant('block', wi, buildBlock(w));
      registerVariant('ramp', wi, buildRamp(wi));
    }
    // pickups
    const matIcon = new THREE.MeshPhongMaterial({ map: hzAtlas.tex, vertexColors: true, shininess: 70, specular: 0x444444 });
    matIcon.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.42;')
        .replace('#include <fog_fragment>', FOG_FS);
    };
    matIcon.customProgramCacheKey = () => 'rr-obstacles-icon-v2';
    L.icon = KINDS.map((k) => addLayer('pickup-' + k, buildIcon(k), matIcon, T.PICK_CAP, {}));
    L.bubble = addLayer('pickup-bubbles', withColor(new THREE.SphereGeometry(0.74, 24, 16)), makeFxMat('bubble'), T.PICK_CAP * 5, { extra: 'aLamp', extraSize: 2, order: 7 });
    L.pillar = addLayer('pickup-pillars', buildPillarGeo(), makeFxMat('pillar', { fogK: 0.7 }), T.PICK_CAP * 5, { extra: 'aLamp', extraSize: 2, order: 5 });
    // coins: near (detailed) and far LOD, rebuilt from the SoA every frame
    coinNear = new THREE.InstancedMesh(buildCoinGeo(16), matCoin, CCAP);
    coinFar = new THREE.InstancedMesh(buildCoinGeo(8), matCoin, CCAP);
    [coinNear, coinFar].forEach((m, i) => { m.name = i ? 'obstacles-coins-far' : 'obstacles-coins'; m.frustumCulled = false; m.count = 0; m.matrixAutoUpdate = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); });
    // pre-allocate pooled visuals / records so streaming never allocates them during play
    for (let i = 0; i < 200; i++) visPool.push(new Vis());
    for (let i = 0; i < 240; i++) recPool.push(newRec());
    for (let i = 0; i < T.PICK_CAP; i++) pickPool.push(newPick());
    ready = true;
    setQuality(quality);
    // records created before init (e.g. tests) get their visuals now
    for (let i = 0; i < list.length; i++) if (!list[i].vis) buildVisFor(list[i], 0);
  }
  let coinNear = null, coinFar = null;

  function reset(pz) {
    pz = +pz || 0;
    clearAll();
    const d = RR.director;
    if (d && typeof d.reset === 'function') { try { RR.director.reset(pz); } catch (e) { console.error('[obstacles] director.reset failed', e); } }
    inReset = true;
    try { generate(pz, T.RESET_CALLS); } finally { inReset = false; }
    SV[1] = 0;
    if (ready) { syncVisuals(pz, 0); flushAll(); }
  }
  function setQuality(q) {
    quality = q || quality;
    if (!ready) return;
    const sh = !!(quality && quality.shadows);
    layers[L.blob].on = !sh;
    flushAll();
  }
  function flushAll() { for (let i = 0; i < layers.length; i++) layers[i].flush(); }

  // per-frame visual sync: movers follow the runner's z, pickups bob, coins are rebuilt
  function syncVisuals(pz, dt) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r.vz) continue;
      syncMover(r, pz);
      if (r.vis) { r.vis.z = r.zF; writeVis(r.vis); }
    }
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i], v = p.vis; if (!v) continue;
      v.y = p.y + Math.sin(time * 2.6 + p.ph) * 0.12;
      v.loc[6] = time * 2.2 + p.ph; // icon spin
      if (v.n > 1) v.loc[8 + 6] = -time * 0.8;
      if (v.n > 2) v.loc[16 + 1] = -v.y + 0.02; // pillar stays on the ground
      writeVis(v);
    }
    // coins
    const mN = coinNear.instanceMatrix.array, mF = coinFar.instanceMatrix.array;
    let nN = 0, nF = 0;
    for (let i = 0; i < nCoins; i++) {
      const d = pz - cz[i];
      const a = d < T.COIN_NEAR ? mN : mF, o = (d < T.COIN_NEAR ? nN++ : nF++) * 16;
      a[o] = 1; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = 1; a[o + 11] = 0; a[o + 12] = cx[i]; a[o + 13] = cy[i]; a[o + 14] = cz[i]; a[o + 15] = 1;
    }
    coinNear.count = nN; coinFar.count = nF;
    coinNear.visible = nN > 0; coinFar.visible = nF > 0;
    if (nN) { const r = coinNear.instanceMatrix.updateRange; r.offset = 0; r.count = nN * 16; coinNear.instanceMatrix.needsUpdate = true; }
    if (nF) { const r = coinFar.instanceMatrix.updateRange; r.offset = 0; r.count = nF * 16; coinFar.instanceMatrix.needsUpdate = true; }
    void dt;
  }
  function update(dt, frame) {
    if (!ready) return;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    const pz = frame && typeof frame.pz === 'number' ? frame.pz : 0;
    time = frame && typeof frame.t === 'number' ? frame.t : time + dt;
    U.time.value = time;
    U.boost.value = RR.mats && RR.mats.glow ? Math.max(1, RR.mats.glow.color.r) : 1;
    const fog = scene && scene.fog;
    if (fog && fog.isFog) { U.fogCol.value.copy(fog.color); U.fogN.value = fog.near; U.fogF.value = fog.far; }
    else if (fog && fog.isFogExp2) { U.fogCol.value.copy(fog.color); U.fogN.value = 0; U.fogF.value = 2.5 / Math.max(1e-4, fog.density); }
    else { U.fogN.value = 1e5; U.fogF.value = 1e5 + 1; }
    const A = RR.atmo;
    if (A && A.skyTop) {
      U.skyTop.value.copy(A.skyTop); U.hor.value.copy(A.horizon); U.gnd.value.copy(A.hemiGround).multiplyScalar(0.8);
      U.night.value = sstep(0.3, 0.95, A.stars || 0);
      U.lit.value.setRGB(1.0, 0.82, 0.5).multiplyScalar(0.9 * U.boost.value);
    }
    // stream in new content
    generate(pz, T.GEN_CALLS);
    // despawn behind the runner
    const behind = pz + C.DESPAWN_BEHIND;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.vz) syncMover(r, pz);
      if (r.zB > behind) releaseRec(r, false);
    }
    for (let i = picks.length - 1; i >= 0; i--) if (picks[i].z > pz + T.COIN_HIDE) removePick(i, false);
    for (let i = 0; i < nCoins;) { if (cz[i] > pz + T.COIN_HIDE && !cmag[i]) { removeCoin(i); continue; } i++; }
    // oncoming trains swallow coins in their path (never drive through a coin line)
    for (let j = 0; j < list.length; j++) {
      const r = list[j]; if (!r.vz) continue;
      for (let i = 0; i < nCoins;) { if (!csky[i] && Math.abs(cx[i] - r.x) < 1.2 && cz[i] < r.zF + 0.5 && cz[i] > r.zB - 0.5 && cy[i] < TRAIN_H + 1.5) { removeCoin(i); continue; } i++; }
    }
    syncVisuals(pz, dt);
    // pop-in / poof animations
    for (let i = animList.length - 1; i >= 0; i--) {
      const v = animList[i];
      v.animT += dt;
      if (v.anim === 1) {
        const t = Math.min(1, v.animT / T.POP_T), s = 1.70158;
        v.k = t >= 1 ? 1 : Math.max(0.001, 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2));
        if (v.rec && v.rec.vz) v.z = v.rec.zF;
        writeVis(v);
        if (t >= 1) { v.anim = 0; v.inAnim = false; animList[i] = animList[animList.length - 1]; animList.pop(); }
      } else if (v.anim === 2) {
        const t = Math.min(1, v.animT / T.POOF_T);
        v.k = Math.max(0.001, 1 - t * t);
        writeVis(v);
        if (t >= 1) { v.inAnim = false; animList[i] = animList[animList.length - 1]; animList.pop(); v.anim = 0; freeVis(v); }
      } else { v.inAnim = false; animList[i] = animList[animList.length - 1]; animList.pop(); }
    }
    flushAll();
  }

  // ================================================================== debug / tests
  function debugAll() {
    const counts = {}, triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    let tris = 0, shadowCasters = 0;
    layers.forEach((l) => { counts[l.name] = l.n; if (l.mesh.visible) { tris += l.n * triCount(l.mesh.geometry); if (l.mesh.castShadow) shadowCasters++; } });
    if (coinNear) tris += coinNear.count * triCount(coinNear.geometry) + coinFar.count * triCount(coinFar.geometry);
    if (coinNear) { counts['coins-near'] = coinNear.count; counts['coins-far'] = coinFar.count; }
    const coins = [];
    for (let i = 0; i < nCoins && i < 3000; i++) coins.push({ x: cx[i], y: cy[i], z: cz[i], sky: !!csky[i], mag: !!cmag[i], chunk: cchunk[i] });
    return {
      ready, frontier: RR.director ? RR.director.frontier : null,
      records: list.map((r) => ({ id: r.id, type: r.type, lane: r.lane, x: r.x, zF: r.zF, zB: r.zB, top: r.top, bottom: r.bottom, vz: r.vz, cars: r.cars, passed: r.passed, nearCand: r.nearCand, chunk: r.chunk, world: r.world, livery: r.livery, meetZ: r.meetZ, len: r.len, ramped: r.ramped, parts: r.vis ? r.vis.n : 0 })),
      coins, nCoins,
      pickups: picks.map((p) => ({ kind: p.kind, lane: p.lane, x: p.x, y: p.y, z: p.z, chunk: p.chunk })),
      layers: counts, anims: animList.length, tris: Math.round(tris), shadowCasters,
      layerTris: layers.filter((l) => l.mesh.visible).map((l) => [l.name, l.n, triCount(l.mesh.geometry)]),
      drawLayers: layers.filter((l) => l.mesh.visible).length + (coinNear && coinNear.visible ? 1 : 0) + (coinFar && coinFar.visible ? 1 : 0)
    };
  }
  const api = {
    init, reset, update, setQuality,
    list, probe, laneBlocked, collect, spawnSkyCoins, clearAhead, markNear, passed, debugAll,
    // test hooks (not for game code): place synthetic content without the director
    _test: {
      add(spec, pz) { inReset = !spec.pop; try { return spawnItem({ type: spec.type, lane: spec.lane, zF: spec.zF, zB: spec.zB, vz: spec.vz || 0, cars: spec.cars || 0, meetZ: spec.meetZ, len: spec.len, ramped: spec.ramped }, spec.chunk || 0, pz === undefined ? 0 : pz); } finally { inReset = false; } },
      coin(lane, y, z) { return addCoin(LANES[lane], y, z, 0, false); },
      pickup(kind, lane, y, z) { inReset = true; try { return spawnPickup(kind, lane, y, z, 0, 0); } finally { inReset = false; } },
      clear() { clearAll(); },
      flush() { if (ready) flushAll(); },
      sync(pz) { if (ready) { syncVisuals(pz, 0); flushAll(); } },
      T, VAR, layers: () => layers, moverFront(r, pz) { syncMover(r, pz); return r.zF; }
    }
  };
  RR.register('obstacles', api);
})(window.RR);
