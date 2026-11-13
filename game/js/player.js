/* Rainbow Rails — player
 * RR.player: the runner. Six skins are modelled from primitives into a rigid rig (body/hips -> spine ->
 * neck/head, shoulders -> elbows, hips -> knees). Each pivot is ONE merged, vertex-coloured mesh drawn
 * with a single shared Phong material that also carries: a canvas atlas (face expressions switched by a
 * UV-offset uniform, hoverboard deck graphics), per-vertex glow (blooms), a sneaker glow channel, an
 * invulnerability flash and a world-tinted rim light. Procedural animation blends damped pose weights
 * (idle, run, air, roll, board stances, jetpack flight, death) plus overlays (stumble, magnet, wave,
 * celebrate). Rolls and flips spin around the torso centre and a ground clamp keeps every part above the
 * surface. Extras: hoverboards (4 decks), jetpack (tanks, additive flame cones, pooled smoke), magnet
 * (horseshoe + field rings) and a blob shadow. Nothing is allocated per frame.
 */
(function (RR) {
  'use strict';
  if (!RR) return;

  // ------------------------------------------------------------------ catalogue (shop data, read by ui/game)
  const SKINS = [
    { id: 'nova', name: 'Nova', price: 0, blurb: 'Pink hoodie, blue cap, zero fear.', colors: ['#ff4f9a', '#3fa7ff', '#ffd2b8'] },
    { id: 'juno', name: 'Juno', price: 1500, blurb: 'Teal bomber, big afro puffs and a bassline in her head.', colors: ['#2fc9b0', '#7c5cff', '#9a623f'] },
    { id: 'kai', name: 'Kai', price: 3000, blurb: 'Surfer at heart: aloha shirt, board shorts, sunnies up.', colors: ['#ff8a3d', '#ffc233', '#d08e62'] },
    { id: 'pixel', name: 'Pixel', price: 5000, blurb: 'Retro gamer with voxel hair, 8-bit shades and a console backpack.', colors: ['#55d66b', '#ff3fd2', '#f0c7a2'] },
    { id: 'frosty', name: 'Frosty', price: 7500, blurb: 'Puffer jacket, pom-pom beanie and a scarf that never stops waving.', colors: ['#8fcaff', '#ffffff', '#ffdfcf'], unlock: { type: 'world', value: 4, text: 'or reach Frost Peaks' } },
    { id: 'neonace', name: 'Neon Ace', price: 12000, blurb: 'Glow-strip techwear, a light-up mohawk and a visor from the future.', colors: ['#7c5cff', '#39f0ff', '#6e4630'], unlock: { type: 'level', value: 15, text: 'or reach mission level 15' } }
  ];
  const BOARDS = [
    { id: 'classic', name: 'Classic', price: 0, blurb: 'The board that started it all.', colors: ['#ff4f9a', '#ffc233'] },
    { id: 'wave', name: 'Wave', price: 1000, blurb: 'Surfboard nose, ocean swirl, teal thrusters.', colors: ['#3fa7ff', '#3dd9c1'] },
    { id: 'candy', name: 'Candy', price: 2500, blurb: 'Scalloped candy-stripe deck with sprinkles on top.', colors: ['#ff6fb5', '#fff3e6'] },
    { id: 'circuit', name: 'Circuit', price: 5000, blurb: 'Glowing traces and a hex-cut deck.', colors: ['#241958', '#39f0ff'] }
  ];

  if (typeof THREE === 'undefined') {
    const nop = () => {};
    RR.register('player', { SKINS, BOARDS, group: null, init: nop, reset: nop, update: nop, setQuality: nop, setSkin: nop, setBoard: nop });
    return;
  }

  const C = RR.C, PI = Math.PI, TAU = PI * 2, D2R = PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ALB = 0.86; // albedo scale so lit colours keep their hue (lighting peaks near 1.0 for albedo 0.85)

  // ------------------------------------------------------------------ rig dimensions (metres)
  const HIP_Y = 0.9, HIP_X = 0.105, HIP_DY = -0.03, THIGH = 0.4, SHIN = 0.4;
  const SPINE_Y = 0.06, SH_Y = 0.4, SH_X = 0.215, NECK_Y = 0.47, HEAD_Y = 0.18, HEAD_R = 0.215;
  const UPARM = 0.27, HAND_Y = 0.29;
  const SPIN_STAND = HIP_Y + 0.24, BALL_Y = 0.5; // flip/roll pivot height (torso centre) standing / tucked
  const BOARD_H = 0.34; // deck top above the surface
  const HEAD_S = [1, 1.02, 0.97];

  // ------------------------------------------------------------------ skin styles
  const STY = {
    nova: {
      skin: 0xffd2b8, hair: 0x4b2a7a, hairStyle: 'pony', hat: 'cap', hatCol: 0x3fa7ff, hatCol2: 0x2468c8, logo: 0xffc233,
      ears: 'phones', earCol: 0xf7f4ff, earCol2: 0xff4f9a,
      top: 'hoodie', topCol: 0xff4f9a, topCol2: 0xe3377f, trim: 0xffffff, sleeve: 'long', cuff: 0xffffff,
      pants: 'shorts', pantsCol: 0x4a78d8, legCol: 0x2d2150, sock: 0xffffff,
      shoe: 'sneaker', shoeCol: 0xffffff, shoeCol2: 0xff4f9a, soleCol: 0xf2eeff, stripe: 0x3fa7ff, lace: 0xffffff,
      pack: 'pack', packCol: 0xffc233, packCol2: 0x7c5cff, strap: 0x3b2d73, can: 0x39d0ff, swing: 'pony'
    },
    juno: {
      skin: 0x9a623f, hair: 0x2c1a14, hairStyle: 'puffs', earrings: 0xffc233,
      top: 'bomber', topCol: 0x2fc9b0, topCol2: 0x7c5cff, trim: 0xffc233, sleeve: 'long', cuff: 0x7c5cff, neckphones: [0x7c5cff, 0xffc233],
      pants: 'track', pantsCol: 0x6b4fe0, stripeCol: 0xffffff, sock: 0xffffff,
      shoe: 'hightop', shoeCol: 0xf6f2ff, shoeCol2: 0x7c5cff, soleCol: 0xffffff, stripe: 0xffc233, lace: 0x7c5cff,
      pack: 'mini', packCol: 0x7c5cff, packCol2: 0xffc233, strap: 0x2a1d55, can: 0xff5fa2, swing: null
    },
    kai: {
      skin: 0xd08e62, hair: 0xf0c04a, hairStyle: 'surfer', hat: 'band', hatCol: 0xff5a5f, shades: 'up',
      top: 'aloha', topCol: 0xff8a3d, topCol2: 0xfff4e4, flowers: [0xffffff, 0xffd84d, 0x3dd9c1], sleeve: 'short', cuff: 0xff8a3d,
      pants: 'board', pantsCol: 0x1fb8d6, pantsCol2: 0xffc233, sock: 0xffffff, bracelet: 0x3dd9c1,
      shoe: 'sneaker', shoeCol: 0xffd84d, shoeCol2: 0xff5a5f, soleCol: 0xffffff, stripe: 0x1fb8d6, lace: 0xffffff,
      pack: 'surf', packCol: 0xffc233, packCol2: 0x1fb8d6, strap: 0x6b3f22, can: 0x7cff6b, swing: 'locks'
    },
    pixel: {
      skin: 0xf0c7a2, hair: 0x2b2257, hairHi: 0xff3fd2, hairStyle: 'voxel', shades: 'pixel', headset: 0xff3fd2,
      top: 'hoodie', topCol: 0x55d66b, topCol2: 0x3aa653, trim: 0x2b2257, sleeve: 'long', cuff: 0x2b2257, heart: 0xff3b5c,
      pants: 'cargo', pantsCol: 0x4d4a63, pocketCol: 0x5d5a75, sock: 0xff3fd2, wristband: 0xff3fd2,
      shoe: 'chunky', shoeCol: 0xffffff, shoeCol2: 0xff3fd2, soleCol: 0x39c8ff, stripe: 0xffe14d, lace: 0x2b2257,
      pack: 'console', packCol: 0xcfccdc, packCol2: 0x55d66b, strap: 0x2b2257, swing: null
    },
    frosty: {
      skin: 0xffdfcf, hair: 0xf3d99a, hairStyle: 'tufts', hat: 'beanie', hatCol: 0xf2f6ff, hatCol2: 0x5aa9ff, goggles: 0xff9a3c,
      ears: 'muffs', earCol: 0xffffff, earCol2: 0x9fd3ff,
      top: 'puffer', topCol: 0x8fcaff, topCol2: 0x6aa6ea, trim: 0xffffff, scarf: 0xff3b5c, scarf2: 0xffffff, sleeve: 'puffy', cuff: 0x6aa6ea, hand: 0xff3b5c,
      pants: 'snow', pantsCol: 0x33549a, sock: 0xffffff,
      shoe: 'boot', shoeCol: 0xc0834f, shoeCol2: 0xffffff, soleCol: 0x3b3a4c, stripe: 0xff3b5c, lace: 0x5b3a26,
      pack: 'winter', packCol: 0xff3b5c, packCol2: 0xffffff, strap: 0x2a3f73, can: 0x5aa9ff, swing: 'scarf'
    },
    neonace: {
      skin: 0x6e4630, hair: 0x1a1226, hairStyle: 'mohawk', mohawk: [0x39f0ff, 0xff3fd2], shades: 'visor', visor: 0x39f0ff,
      top: 'tech', topCol: 0x3a2470, topCol2: 0x1f1440, glowA: 0x39f0ff, glowB: 0xff3fd2, sleeve: 'long', cuff: 0x1f1440, hand: 0x241a3e,
      pants: 'tech', pantsCol: 0x271a4c, sock: 0x39f0ff,
      shoe: 'tech', shoeCol: 0x2c2150, shoeCol2: 0x39f0ff, soleCol: 0x171125, stripe: 0x39f0ff, lace: 0xff3fd2, glowSole: 1,
      pack: 'tech', packCol: 0x2c2150, packCol2: 0x39f0ff, strap: 0x171125, swing: 'tails'
    }
  };
  const BST = {
    classic: { shape: 'stadium', rail: 0xffc233, glow: 0xff5fb0, thr: 0xffb347, hover: 0xff6fc0 },
    wave: { shape: 'surf', rail: 0xffffff, glow: 0x3dd9ff, thr: 0x5ef2ff, hover: 0x3dc8ff },
    candy: { shape: 'scallop', rail: 0xff6fb5, glow: 0xff9ad0, thr: 0xffe14d, hover: 0xff8ad0 },
    circuit: { shape: 'hex', rail: 0x39f0ff, glow: 0x39f0ff, thr: 0xff3fd2, hover: 0x39e0ff }
  };

  // ------------------------------------------------------------------ face atlas layout
  const FACE = { neutral: 0, blink: 1, surprised: 2, happy: 3, dizzy: 4, focused: 5, wink: 6 };
  const FACE_LIST = ['neutral', 'blink', 'surprised', 'happy', 'dizzy', 'focused', 'wink'];
  const NO_UV = [0.875, 0.625]; // centre of the empty (transparent) cell 7 -> pure vertex colour
  const YAW_TEX = 75 * D2R, PIT_TEX = 60 * D2R; // angular half-extent of a face cell

  // ------------------------------------------------------------------ shared state
  let inited = false, scene = null, renderer = null, camera = null, quality = RR.QUALITY ? RR.QUALITY.high : { shadows: true, particles: 1 };
  let atlas = null, mat = null, blobMat = null, hoverMat = null, fieldMat = null, flameMat = null, smokeMat = null;
  const U = {
    uFaceOff: { value: new THREE.Vector2(0, 0) },
    uGlow: { value: 1 },
    uShoe: { value: 0 },
    uShoeCol: { value: new THREE.Color(0x4dff7a) },
    uFlash: { value: 0 },
    uRimCol: { value: new THREE.Color(0xffffff) },
    uRim: { value: 0.3 }
  };
  const EMPTY = new THREE.BufferGeometry();
  const skinCache = {}, boardCache = {};
  let curSkin = null, curBoard = null, pendingSkin = 'nova', pendingBoard = 'classic';

  // ------------------------------------------------------------------ geometry helpers
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3();
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const NOOPT = {};

  function smoothNormals(g, crease) {
    const p = g.attributes.position.array, n = p.length / 3;
    const fn = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 3) {
      const a = i * 3;
      const ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2];
      const vx = p[a + 6] - p[a], vy = p[a + 7] - p[a + 1], vz = p[a + 8] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-12) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 0; nz = 0; }
      for (let k = 0; k < 3; k++) { fn[a + k * 3] = nx; fn[a + k * 3 + 1] = ny; fn[a + k * 3 + 2] = nz; }
    }
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.round(p[i * 3] * 5e4) + ',' + Math.round(p[i * 3 + 1] * 5e4) + ',' + Math.round(p[i * 3 + 2] * 5e4);
      let b = buckets.get(key); if (!b) buckets.set(key, (b = [])); b.push(i);
    }
    const out = new Float32Array(n * 3), ct = Math.cos(crease * D2R);
    buckets.forEach((b) => {
      for (let q = 0; q < b.length; q++) {
        const i = b[q]; let sx = 0, sy = 0, sz = 0;
        for (let r = 0; r < b.length; r++) {
          const j = b[r];
          const d = fn[i * 3] * fn[j * 3] + fn[i * 3 + 1] * fn[j * 3 + 1] + fn[i * 3 + 2] * fn[j * 3 + 2];
          if (d >= ct) { sx += fn[j * 3]; sy += fn[j * 3 + 1]; sz += fn[j * 3 + 2]; }
        }
        const l = Math.hypot(sx, sy, sz);
        if (l > 1e-9) { out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l; } else out[i * 3 + 1] = 1;
      }
    });
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }

  // Kit: bakes primitives into one non-indexed geometry with position, normal, color, uv and aFx
  // (x: glow amount, y: sneaker-glow weight, z: face flag).
  class Kit {
    constructor() { this.parts = []; }
    add(geo, color, pos, rot, scl, o) {
      o = o || NOOPT;
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      geo.dispose();
      const n = g.attributes.position.count, p = g.attributes.position.array;
      const col = new Float32Array(n * 3);
      _c1.set(color);
      let y0 = Infinity, y1 = -Infinity;
      if (o.grad) for (let i = 0; i < n; i++) { const y = p[i * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const base = o.glow ? 1 : ALB;
      for (let i = 0; i < n; i++) {
        let k = base;
        if (o.grad) { const t = y1 > y0 ? (p[i * 3 + 1] - y0) / (y1 - y0) : 0.5; k *= o.grad[0] + (o.grad[1] - o.grad[0]) * t; }
        col[i * 3] = _c1.r * k; col[i * 3 + 1] = _c1.g * k; col[i * 3 + 2] = _c1.b * k;
      }
      _e4.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, (rot && rot[3]) || 'XYZ');
      _q4.setFromEuler(_e4);
      if (typeof scl === 'number') _s4.set(scl, scl, scl); else if (scl) _s4.set(scl[0], scl[1], scl[2]); else _s4.set(1, 1, 1);
      _m4.compose(_p4.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _q4, _s4);
      g.applyMatrix4(_m4);
      if (o.crease) smoothNormals(g, o.crease);
      else if (o.flat || !g.attributes.normal) g.computeVertexNormals();
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (!o.keepUv || !g.attributes.uv) {
        const uv = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { uv[i * 2] = NO_UV[0]; uv[i * 2 + 1] = NO_UV[1]; }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      const fx = new Float32Array(n * 3);
      const gl = o.glow || 0, sh = o.shoe || 0, fc = o.face ? 1 : 0;
      for (let i = 0; i < n; i++) { fx[i * 3] = gl; fx[i * 3 + 1] = sh; fx[i * 3 + 2] = fc; }
      g.setAttribute('aFx', new THREE.BufferAttribute(fx, 3));
      this.parts.push(g);
      return this;
    }
    build() {
      let n = 0;
      for (let i = 0; i < this.parts.length; i++) n += this.parts[i].attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2), fx = new Float32Array(n * 3);
      let o3 = 0, o2 = 0;
      for (let i = 0; i < this.parts.length; i++) {
        const g = this.parts[i], c = g.attributes.position.count;
        pos.set(g.attributes.position.array, o3); nor.set(g.attributes.normal.array, o3); col.set(g.attributes.color.array, o3);
        fx.set(g.attributes.aFx.array, o3); uv.set(g.attributes.uv.array, o2);
        o3 += c * 3; o2 += c * 2;
        g.dispose();
      }
      this.parts.length = 0;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('aFx', new THREE.BufferAttribute(fx, 3));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      geo.userData.samples = hullSamples(pos, n);
      return geo;
    }
  }

  // Support points for the ground clamp: the extreme vertex in each of 96 directions (a convex-hull
  // approximation), so the lowest point of the part is found in any orientation.
  const HULL_DIRS = (() => {
    const d = [], N = 96, ga = PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * ga; d.push(Math.cos(a) * r, y, Math.sin(a) * r); }
    return d;
  })();
  function hullSamples(pos, n) {
    const pick = new Set();
    for (let k = 0; k < HULL_DIRS.length; k += 3) {
      const dx = HULL_DIRS[k], dy = HULL_DIRS[k + 1], dz = HULL_DIRS[k + 2];
      let best = -Infinity, bi = 0;
      for (let i = 0; i < n; i++) { const v = pos[i * 3] * dx + pos[i * 3 + 1] * dy + pos[i * 3 + 2] * dz; if (v > best) { best = v; bi = i; } }
      pick.add(bi);
    }
    const out = new Float32Array(pick.size * 3); let j = 0;
    pick.forEach((i) => { out[j++] = pos[i * 3]; out[j++] = pos[i * 3 + 1]; out[j++] = pos[i * 3 + 2]; });
    return out;
  }

  const G = {
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    cyl: (rt, rb, h, seg, open) => new THREE.CylinderGeometry(rt, rb, h, seg || 10, 1, !!open),
    sph: (r, w, h) => new THREE.SphereGeometry(r, w || 10, h || 7),
    ico: (r, d) => new THREE.IcosahedronGeometry(r, d || 0),
    cone: (r, h, seg) => new THREE.ConeGeometry(r, h, seg || 8),
    torus: (R, t, rs, ts, arc) => new THREE.TorusGeometry(R, t, rs || 6, ts || 20, arc === undefined ? TAU : arc),
    lathe: (pts, seg, a0, al) => new THREE.LatheGeometry(pts.map((q) => V2(q[0], q[1])), seg || 16, a0 || 0, al === undefined ? TAU : al),
    tube: (pts, r, seg, rs) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2]))), seg || 12, r, rs || 5, false),
    hemi: (r, w, h, cover) => new THREE.SphereGeometry(r, w || 16, h || 8, 0, TAU, 0, cover || PI / 2)
  };
  // Rounded box (w x h, depth d along z) from an extruded rounded rectangle.
  function rbox(w, h, d, r, seg) {
    const b = Math.min(r, d * 0.45), W = Math.max(0.002, w - 2 * b), H = Math.max(0.002, h - 2 * b);
    const rc = Math.max(0.0005, Math.min(r - b, W / 2 - 0.0005, H / 2 - 0.0005));
    const s = new THREE.Shape(), x0 = -W / 2, y0 = -H / 2;
    s.moveTo(x0 + rc, y0); s.lineTo(x0 + W - rc, y0); s.quadraticCurveTo(x0 + W, y0, x0 + W, y0 + rc);
    s.lineTo(x0 + W, y0 + H - rc); s.quadraticCurveTo(x0 + W, y0 + H, x0 + W - rc, y0 + H);
    s.lineTo(x0 + rc, y0 + H); s.quadraticCurveTo(x0, y0 + H, x0, y0 + H - rc);
    s.lineTo(x0, y0 + rc); s.quadraticCurveTo(x0, y0, x0 + rc, y0);
    const dd = Math.max(0.001, d - 2 * b);
    const g = new THREE.ExtrudeGeometry(s, { depth: dd, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: seg || 1, curveSegments: 2, steps: 1 });
    g.translate(0, 0, -dd / 2);
    return g;
  }
  // Side-profile extrusion: shape (x = z forward/back, y = up) extruded across x, centred.
  function extrudeSide(shape, depth, bevel, bevelSeg, curveSeg) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSeg || 1, curveSegments: curveSeg || 3, steps: 1 });
    g.rotateY(-PI / 2); // shape x -> world z, extrusion -> world -x
    g.translate(depth / 2, 0, 0);
    return g;
  }
  // Point on the torso lathe surface (for decals such as flowers and strips).
  function torsoR(prof, y) {
    for (let i = 1; i < prof.length; i++) {
      const a = prof[i - 1], b = prof[i];
      if ((y >= a[1] && y <= b[1]) || (y <= a[1] && y >= b[1])) { const t = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * t; }
    }
    return prof[prof.length - 2][0];
  }

  // Face cap: a spherical patch over the front of the head with angular UVs into face cell 0.
  function faceCap(r) {
    const YAW = 68 * D2R, P0 = -52 * D2R, P1 = 42 * D2R, NW = 12, NH = 9;
    const vp = [], vu = [];
    for (let j = 0; j <= NH; j++) for (let i = 0; i <= NW; i++) {
      const yaw = -YAW + (2 * YAW * i) / NW, pit = P0 + ((P1 - P0) * j) / NH;
      vp.push([r * Math.cos(pit) * Math.sin(yaw), r * Math.sin(pit), -r * Math.cos(pit) * Math.cos(yaw)]);
      vu.push([(0.5 - yaw / (2 * YAW_TEX)) * 0.25, 0.75 + (0.5 + pit / (2 * PIT_TEX)) * 0.25]);
    }
    const pos = [], nor = [], uv = [];
    const put = (k) => { const q = vp[k]; pos.push(q[0], q[1], q[2]); nor.push(q[0] / r, q[1] / r, q[2] / r); uv.push(vu[k][0], vu[k][1]); };
    for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
      const a = j * (NW + 1) + i, b = a + 1, c = a + NW + 2, d = a + NW + 1;
      // outward winding (checked: normal of (a, b, c) points away from the centre)
      put(a); put(c); put(b); put(a); put(d); put(c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    fixWinding(g);
    return g;
  }
  // Make every triangle's winding agree with its vertex normals (outward).
  function fixWinding(g) {
    const p = g.attributes.position.array, nn = g.attributes.normal.array, uv = g.attributes.uv ? g.attributes.uv.array : null;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * nn[i] + cy * nn[i + 1] + cz * nn[i + 2] < 0) {
        for (let k = 0; k < 3; k++) { let t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; t = nn[i + 3 + k]; nn[i + 3 + k] = nn[i + 6 + k]; nn[i + 6 + k] = t; }
        if (uv) { const j = (i / 9) * 6; for (let k = 0; k < 2; k++) { const t = uv[j + 2 + k]; uv[j + 2 + k] = uv[j + 4 + k]; uv[j + 4 + k] = t; } }
      }
    }
  }
  const shade = (hex, k) => { _c2.set(hex); return ((clamp(_c2.r * k, 0, 1) * 255) << 16) | ((clamp(_c2.g * k, 0, 1) * 255) << 8) | (clamp(_c2.b * k, 0, 1) * 255); };

  // ------------------------------------------------------------------ canvas atlas (faces + decks)
  const INK = '#2a1a44', MOUTH = '#8e1f48', TONGUE = '#ff7d9c';
  function eyeOpen(x, cx, cy, sx, sy, irisK, outer) {
    x.save();
    x.beginPath(); x.ellipse(cx, cy, sx, sy, 0, 0, TAU); x.fillStyle = '#ffffff'; x.fill(); x.clip();
    const g = x.createLinearGradient(0, cy - sy, 0, cy + sy); g.addColorStop(0, '#2d2170'); g.addColorStop(1, '#7658d8');
    x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy + sy * 0.1, sx * 0.78 * irisK, sy * 0.72 * irisK, 0, 0, TAU); x.fill();
    x.fillStyle = '#120a26'; x.beginPath(); x.ellipse(cx, cy + sy * 0.14, sx * 0.4 * irisK, sy * 0.4 * irisK, 0, 0, TAU); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(cx - sx * 0.28, cy - sy * 0.26, sx * 0.3, 0, TAU); x.fill();
    x.beginPath(); x.arc(cx + sx * 0.3, cy + sy * 0.34, sx * 0.14, 0, TAU); x.fill();
    x.restore();
    x.strokeStyle = INK; x.lineCap = 'round';
    x.lineWidth = 1.6; x.beginPath(); x.ellipse(cx, cy, sx, sy, 0, 0, TAU); x.stroke();
    x.lineWidth = 3.4; x.beginPath(); x.ellipse(cx, cy, sx + 0.6, sy + 0.6, 0, PI * 1.1, PI * 1.9); x.stroke();
    // lash flick at the outer corner
    x.lineWidth = 2.6; x.beginPath(); x.moveTo(cx + outer * sx * 0.82, cy - sy * 0.62); x.lineTo(cx + outer * (sx + 4), cy - sy * 0.95); x.stroke();
  }
  function eyeArc(x, cx, cy, sx, up) { // closed eye: up = true -> happy ^ ; false -> relaxed blink
    x.strokeStyle = INK; x.lineWidth = 3.6; x.lineCap = 'round';
    x.beginPath();
    if (up) { x.moveTo(cx - sx, cy + 3); x.quadraticCurveTo(cx, cy - 10, cx + sx, cy + 3); }
    else { x.moveTo(cx - sx, cy + 1); x.quadraticCurveTo(cx, cy + 8, cx + sx, cy + 1); }
    x.stroke();
  }
  function brow(x, cx, cy, w, tilt, lift) {
    x.strokeStyle = INK; x.lineWidth = 4.2; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx - w, cy + tilt); x.quadraticCurveTo(cx, cy - lift, cx + w, cy - tilt); x.stroke();
  }
  function blush(x, cx, cy) {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, 11);
    g.addColorStop(0, 'rgba(255,105,150,0.55)'); g.addColorStop(1, 'rgba(255,105,150,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, 12, 8, 0, 0, TAU); x.fill();
  }
  function drawFace(x, kind) {
    const cx = 64, ex = 21, ey = 68, by = 52, my = 95;
    blush(x, cx - 33, 84); blush(x, cx + 33, 84);
    const L = cx - ex, R = cx + ex; // canvas left eye = character's right eye
    x.lineCap = 'round'; x.lineJoin = 'round';
    switch (kind) {
      case 'neutral':
        eyeOpen(x, L, ey, 9.5, 12, 1, -1); eyeOpen(x, R, ey, 9.5, 12, 1, 1);
        brow(x, L, by, 8, 1, 3); brow(x, R, by, 8, -1, 3);
        x.strokeStyle = INK; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 8, my - 1); x.quadraticCurveTo(cx, my + 6, cx + 8, my - 1); x.stroke();
        break;
      case 'blink':
        eyeArc(x, L, ey + 2, 9, false); eyeArc(x, R, ey + 2, 9, false);
        brow(x, L, by + 1, 8, 1, 2); brow(x, R, by + 1, 8, -1, 2);
        x.strokeStyle = INK; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 8, my - 1); x.quadraticCurveTo(cx, my + 6, cx + 8, my - 1); x.stroke();
        break;
      case 'surprised':
        eyeOpen(x, L, ey - 1, 10.5, 13.5, 0.62, -1); eyeOpen(x, R, ey - 1, 10.5, 13.5, 0.62, 1);
        brow(x, L, by - 7, 8, 2, 5); brow(x, R, by - 7, 8, -2, 5);
        x.fillStyle = MOUTH; x.strokeStyle = INK; x.lineWidth = 2.4;
        x.beginPath(); x.ellipse(cx, my + 3, 6.5, 8, 0, 0, TAU); x.fill(); x.stroke();
        x.fillStyle = TONGUE; x.beginPath(); x.ellipse(cx, my + 7.5, 4, 2.6, 0, 0, TAU); x.fill();
        break;
      case 'happy':
      case 'wink': {
        if (kind === 'happy') { eyeArc(x, L, ey, 9.5, true); eyeArc(x, R, ey, 9.5, true); }
        else { eyeOpen(x, L, ey, 9.5, 12, 1, -1); eyeArc(x, R, ey, 9.5, true); }
        brow(x, L, by - 4, 8, 1, 4); brow(x, R, by - 4, 8, -1, 4);
        x.save();
        x.beginPath(); x.moveTo(cx - 14, my - 4); x.quadraticCurveTo(cx, my - 1, cx + 14, my - 4); x.quadraticCurveTo(cx + 12, my + 14, cx, my + 15); x.quadraticCurveTo(cx - 12, my + 14, cx - 14, my - 4); x.closePath();
        x.fillStyle = MOUTH; x.fill(); x.clip();
        x.fillStyle = '#ffffff'; x.fillRect(cx - 16, my - 8, 32, 7.5);
        x.fillStyle = TONGUE; x.beginPath(); x.ellipse(cx + (kind === 'wink' ? 3 : 0), my + 13, 8, 6, 0, 0, TAU); x.fill();
        x.restore();
        x.strokeStyle = INK; x.lineWidth = 2.4;
        x.beginPath(); x.moveTo(cx - 14, my - 4); x.quadraticCurveTo(cx, my - 1, cx + 14, my - 4); x.quadraticCurveTo(cx + 12, my + 14, cx, my + 15); x.quadraticCurveTo(cx - 12, my + 14, cx - 14, my - 4); x.closePath(); x.stroke();
        break;
      }
      case 'dizzy': {
        x.strokeStyle = INK; x.lineWidth = 3.4;
        for (const e of [L, R]) { x.beginPath(); x.moveTo(e - 7, ey - 7); x.lineTo(e + 7, ey + 7); x.moveTo(e + 7, ey - 7); x.lineTo(e - 7, ey + 7); x.stroke(); }
        brow(x, L, by - 2, 8, -3, 1); brow(x, R, by - 2, 8, 3, 1);
        x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 12, my + 2);
        for (let i = 1; i <= 6; i++) x.lineTo(cx - 12 + i * 4, my + 2 + (i % 2 ? -3 : 3));
        x.stroke();
        break;
      }
      case 'focused': {
        eyeOpen(x, L, ey, 9.5, 12, 1, -1); eyeOpen(x, R, ey, 9.5, 12, 1, 1);
        // heavy upper lids (erase the top of the eyes back to skin)
        x.save(); x.globalCompositeOperation = 'destination-out';
        x.beginPath(); x.moveTo(L - 13, ey - 16); x.lineTo(L + 13, ey - 16); x.lineTo(L + 13, ey - 3); x.lineTo(L - 13, ey - 5); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(R - 13, ey - 16); x.lineTo(R + 13, ey - 16); x.lineTo(R + 13, ey - 5); x.lineTo(R - 13, ey - 3); x.closePath(); x.fill();
        x.restore();
        x.strokeStyle = INK; x.lineWidth = 3.4;
        x.beginPath(); x.moveTo(L - 10, ey - 4.6); x.lineTo(L + 10, ey - 3.2); x.stroke();
        x.beginPath(); x.moveTo(R - 10, ey - 3.2); x.lineTo(R + 10, ey - 4.6); x.stroke();
        brow(x, L, by + 2, 8.5, -3, 1); brow(x, R, by + 2, 8.5, 3, 1);
        x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 8, my); x.quadraticCurveTo(cx + 2, my + 3, cx + 9, my - 3); x.stroke();
        break;
      }
      default: break;
    }
  }
  function star(x, cx, cy, r1, r2, n) {
    x.beginPath();
    for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = -PI / 2 + (i * PI) / n; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    x.closePath();
  }
  function drawDeck(x, id) {
    const W = 512, H = 64;
    const rng = RR.makeRng(id.length * 977 + 13);
    if (id === 'classic') {
      const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#ff3f8e'); g.addColorStop(0.5, '#ff7ab8'); g.addColorStop(1, '#ff3f8e');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      const rb = ['#ff5a5f', '#ffa24d', '#ffd84d', '#5ee07a', '#3fa7ff', '#9b6bff'];
      for (let i = 0; i < rb.length; i++) {
        const x0 = 200 + i * 15; x.fillStyle = rb[i];
        x.beginPath(); x.moveTo(x0 + 24, 0); x.lineTo(x0, 32); x.lineTo(x0 + 24, 64); x.lineTo(x0 + 39, 64); x.lineTo(x0 + 15, 32); x.lineTo(x0 + 39, 0); x.closePath(); x.fill();
      }
      x.fillStyle = '#ffc233'; x.fillRect(0, 4, W, 4); x.fillRect(0, 56, W, 4);
      star(x, 88, 32, 17, 7, 5); x.fillStyle = '#ffffff'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#ffc233'; x.stroke();
      x.fillStyle = 'rgba(120,20,70,0.35)';
      for (let i = 0; i < 26; i++) { x.beginPath(); x.arc(360 + rng.range(0, 110), rng.range(14, 50), rng.range(2, 4), 0, TAU); x.fill(); }
    } else if (id === 'wave') {
      const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#1a5fd0'); g.addColorStop(1, '#2fd0c0');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = '#ffd84d'; x.beginPath(); x.arc(78, 32, 17, 0, TAU); x.fill();
      x.strokeStyle = '#ffd84d'; x.lineWidth = 3;
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; x.beginPath(); x.moveTo(78 + Math.cos(a) * 21, 32 + Math.sin(a) * 21); x.lineTo(78 + Math.cos(a) * 27, 32 + Math.sin(a) * 27); x.stroke(); }
      x.strokeStyle = '#ffffff'; x.lineWidth = 4; x.lineCap = 'round';
      for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
        const x0 = 150 + i * 56 + row * 28, y0 = 22 + row * 22;
        x.beginPath(); x.moveTo(x0, y0 + 6); x.quadraticCurveTo(x0 + 14, y0 - 10, x0 + 28, y0 + 2); x.quadraticCurveTo(x0 + 22, y0 + 8, x0 + 16, y0 + 3); x.stroke();
      }
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(0, 3, W, 3); x.fillRect(0, 58, W, 3);
    } else if (id === 'candy') {
      x.fillStyle = '#fff1e4'; x.fillRect(0, 0, W, H);
      x.save(); x.fillStyle = '#ff6fb5';
      for (let i = -4; i < 30; i++) { x.beginPath(); x.moveTo(i * 24, 64); x.lineTo(i * 24 + 12, 64); x.lineTo(i * 24 + 44, 0); x.lineTo(i * 24 + 32, 0); x.closePath(); x.fill(); }
      x.restore();
      x.fillStyle = '#fff1e4'; x.beginPath(); x.arc(256, 32, 24, 0, TAU); x.fill();
      x.strokeStyle = '#ff3f8e'; x.lineWidth = 4; x.beginPath();
      for (let a = 0; a < TAU * 2.6; a += 0.2) { const r = 2 + a * 3.2; x.lineTo(256 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
      x.stroke();
      const sp = ['#5ee0c8', '#ffd84d', '#a87bff', '#7fd6ff', '#ffffff', '#ff8a5b'];
      for (let i = 0; i < 70; i++) {
        const px = rng.range(8, 504), py = rng.range(8, 56);
        if (Math.hypot(px - 256, py - 32) < 28) continue;
        x.save(); x.translate(px, py); x.rotate(rng.range(0, PI)); x.fillStyle = sp[i % sp.length]; RR.roundRect(x, -4, -1.6, 8, 3.2, 1.6); x.fill(); x.restore();
      }
    } else {
      x.fillStyle = '#1b1446'; x.fillRect(0, 0, W, H);
      x.strokeStyle = 'rgba(80,70,160,0.5)'; x.lineWidth = 1;
      for (let i = 0; i < W; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
      x.strokeStyle = '#39f0ff'; x.fillStyle = '#39f0ff'; x.lineWidth = 3; x.lineJoin = 'miter';
      for (let i = 0; i < 12; i++) {
        let px = rng.range(10, 500), py = rng.chance(0.5) ? rng.range(8, 20) : rng.range(44, 56);
        x.beginPath(); x.moveTo(px, py);
        for (let s = 0; s < 3; s++) { if (s % 2) py = clamp(py + rng.range(-20, 20), 8, 56); else px = clamp(px + rng.range(-60, 60), 8, 504); x.lineTo(px, py); }
        x.stroke(); x.beginPath(); x.arc(px, py, 4, 0, TAU); x.fill();
      }
      x.fillStyle = '#ff3fd2'; RR.roundRect(x, 226, 16, 60, 32, 6); x.fill();
      x.fillStyle = '#1b1446'; RR.roundRect(x, 234, 22, 44, 20, 4); x.fill();
      x.fillStyle = '#ff3fd2'; for (let i = 0; i < 6; i++) { x.fillRect(232 + i * 9, 10, 3, 6); x.fillRect(232 + i * 9, 48, 3, 6); }
      x.fillStyle = '#39f0ff'; x.fillRect(0, 3, W, 3); x.fillRect(0, 58, W, 3);
    }
  }
  function buildAtlas() {
    return RR.canvasTex(512, 512, (x) => {
      x.clearRect(0, 0, 512, 512);
      FACE_LIST.forEach((f, i) => { x.save(); x.translate((i % 4) * 128, ((i / 4) | 0) * 128); drawFace(x, f); x.restore(); });
      BOARDS.forEach((b, i) => { x.save(); x.translate(0, 256 + i * 64); drawDeck(x, b.id); x.restore(); });
    });
  }
  function radialTex(stops) {
    return RR.canvasTex(64, 64, (x) => {
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    });
  }

  // ------------------------------------------------------------------ materials
  function buildMaterials() {
    const m = new THREE.MeshPhongMaterial({ vertexColors: true, map: atlas, shininess: 22, specular: 0x1c1c22 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'attribute vec3 aFx;\nuniform vec2 uFaceOff;\nvarying vec2 vFx;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vUv += aFx.z * uFaceOff;\n  vFx = aFx.xy;');
      sh.fragmentShader = 'uniform float uGlow;\nuniform float uShoe;\nuniform vec3 uShoeCol;\nuniform float uFlash;\nuniform vec3 uRimCol;\nuniform float uRim;\nvarying vec2 vFx;\n' +
        sh.fragmentShader
          .replace('#include <map_fragment>', '')
          .replace('#include <color_fragment>', '#include <color_fragment>\n  vec4 texelColor = texture2D( map, vUv );\n  diffuseColor.rgb = mix( diffuseColor.rgb, texelColor.rgb * ' + ALB.toFixed(3) + ', texelColor.a );')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * ( vFx.x * uGlow + uFlash ) + uShoeCol * ( vFx.y * uShoe );')
          .replace('#include <output_fragment>', '  float rimK = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );\n  outgoingLight += uRimCol * ( uRim * rimK * rimK * rimK );\n#include <output_fragment>');
    };
    m.customProgramCacheKey = () => 'rr-player-v1';
    mat = m;
    blobMat = new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,255,255,0.95)'], [0.4, 'rgba(255,255,255,0.62)'], [0.75, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]), color: 0x160c2a, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: true });
    const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
    hoverMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff6fc0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    fieldMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.85, fog: false, toneMapped: false });
    flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLen: { value: 0.6 }, uBoost: { value: 1 }, uAlpha: { value: 1 }, uA: { value: new THREE.Color(0xffe070) }, uB: { value: new THREE.Color(0xff7a1a) }, uC: { value: new THREE.Color(0xff2a5a) } },
      vertexShader: [
        'attribute float aCore;', 'uniform float uTime;', 'uniform float uLen;', 'varying float vT;', 'varying float vCore;', 'varying float vEdge;',
        'void main() {',
        '  vec3 p = position;',
        '  float t = clamp(-p.y, 0.0, 1.0);',
        '  float fl = 1.0 + 0.16 * sin(uTime * 43.0 + aCore * 1.7 + p.x * 30.0) + 0.08 * sin(uTime * 71.0);',
        '  p.y *= uLen * fl;',
        '  p.xz *= 1.0 + 0.1 * sin(uTime * 57.0 + t * 8.0);',
        '  vT = t; vCore = aCore;',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  vec3 n = normalize(normalMatrix * normal);',
        '  vEdge = abs(dot(n, normalize(-mv.xyz)));',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uBoost;', 'uniform float uAlpha;', 'uniform float uTime;', 'uniform vec3 uA;', 'uniform vec3 uB;', 'uniform vec3 uC;',
        'varying float vT;', 'varying float vCore;', 'varying float vEdge;',
        'void main() {',
        '  vec3 c = mix(uA, uB, smoothstep(0.0, 0.35, vT));',
        '  c = mix(c, uC, smoothstep(0.35, 0.9, vT));',
        '  c = mix(c, vec3(1.0, 0.98, 0.9), vCore * (1.0 - smoothstep(0.0, 0.5, vT)));',
        '  float a = clamp(pow(1.0 - vT, 1.1) * (0.35 + 0.8 * vEdge) * uAlpha * (0.8 + 0.4 * vCore), 0.0, 1.0);',
        '  a *= 0.85 + 0.15 * sin(uTime * 90.0 + vT * 25.0);',
        '  float add = clamp(vCore + (1.0 - vEdge) * 0.5, 0.0, 1.0);',
        '  gl_FragColor = vec4(c * uBoost * a, a * mix(0.8, 0.12, add));', // premultiplied: hot core adds light, outer flame tints
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor
    });
    smokeMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uMaxPx: { value: 80 }, uCol: { value: new THREE.Color(0xffffff) } },
      vertexShader: [
        'attribute float aAlpha;', 'attribute float aSize;', 'uniform float uScale;', 'uniform float uMaxPx;', 'varying float vA;',
        'void main() {',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float d = max(0.1, -mv.z);',
        '  gl_PointSize = min(aSize * uScale / d, uMaxPx);',
        '  vA = aAlpha * smoothstep(4.0, 7.0, d);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uCol;', 'varying float vA;',
        'void main() {',
        '  vec2 c = gl_PointCoord - 0.5;',
        '  float r = length(c) * 2.0;',
        '  float a = (1.0 - smoothstep(0.3, 1.0, r)) * vA;',
        '  if (a < 0.01) discard;',
        '  gl_FragColor = vec4(uCol * (0.84 + 0.3 * (0.5 - c.y)), a);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false
    });
  }

  // ------------------------------------------------------------------ character modelling
  // HEAD (neck pivot space; head centre at y = HEAD_Y)
  function hairShell(k, st, r, cover, tilt, col) {
    const g = G.hemi(Math.max(r, HEAD_R * 1.035), 16, 8, cover);
    g.rotateX(tilt); // tilt first, then the head's squash (so the shell stays concentric with the skull)
    k.add(g, col || st.hair, [0, HEAD_Y + 0.004, 0.004], null, HEAD_S, { grad: [0.72, 1.12] });
  }
  function buildHead(st) {
    const k = new Kit(), hy = HEAD_Y, R = HEAD_R;
    k.add(G.cyl(0.056, 0.064, 0.2, 12, true), st.skin, [0, 0.03, 0.012], null, null, { grad: [0.72, 1] });
    k.add(G.sph(R, 16, 12), st.skin, [0, hy, 0], null, HEAD_S);
    k.add(faceCap(R * 1.006), st.skin, [0, hy, 0], null, HEAD_S, { face: 1, keepUv: 1 });
    k.add(G.sph(0.024, 6, 4), shade(st.skin, 0.97), [0, hy - 0.056, -R * 0.965], null, [1, 0.8, 0.8]);
    if (!st.ears) for (let s = -1; s <= 1; s += 2) k.add(G.sph(0.046, 6, 5), shade(st.skin, 0.93), [s * R * 0.975, hy - 0.018, 0.014], null, [0.42, 1, 0.72]);
    const hs = st.hairStyle;
    if (hs === 'pony') {
      hairShell(k, st, R * 1.035, 1.85, 0.62);
      for (let s = -1; s <= 1; s += 2) k.add(G.ico(0.07, 1), st.hair, [s * 0.172, hy - 0.005, -0.1], [0.2, s * 0.5, s * 0.25], [0.5, 1.25, 0.62], { crease: 42, grad: [0.8, 1.1] });
    } else if (hs === 'puffs') {
      hairShell(k, st, R * 1.04, 1.8, 0.52);
      for (let s = -1; s <= 1; s += 2) {
        k.add(G.ico(0.122, 1), st.hair, [s * 0.118, hy + 0.2, 0.025], [0.3, s * 0.5, 0], [1, 0.94, 1], { grad: [0.72, 1.12], crease: 60 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + s;
          k.add(G.ico(0.058, 0), shade(st.hair, 1.1), [s * 0.118 + Math.cos(a) * 0.088, hy + 0.21 + Math.sin(a * 1.7) * 0.05, 0.025 + Math.sin(a) * 0.088], [a, a * 2, 0], null, { crease: 50 });
        }
        k.add(G.torus(0.07, 0.016, 3, 12), st.topCol2 || 0x7c5cff, [s * 0.108, hy + 0.125, 0.02], [PI / 2 + 0.1, 0, s * 0.45]);
      }
      if (st.earrings) for (let s = -1; s <= 1; s += 2) k.add(G.torus(0.028, 0.006, 3, 10), st.earrings, [s * R * 0.99, hy - 0.08, 0.012], [0, PI / 2, 0], null, { glow: 0.15 });
    } else if (hs === 'surfer') {
      hairShell(k, st, R * 1.045, 1.9, 0.48);
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = -2.0 + (4.0 * i) / (n - 1); // around the back (a = 0 is straight back, -z is the face)
        const ca = Math.sin(a), sa = Math.cos(a); // x, z
        k.add(G.ico(0.05, 0), i % 2 ? st.hair : shade(st.hair, 1.12), [ca * 0.19, hy - 0.06 - (Math.abs(a) < 1 ? 0.035 : 0), sa * 0.19], [sa * 0.35, a, -ca * 0.35, 'YXZ'], [0.7, 2.1, 0.6], { crease: 50, grad: [0.75, 1.12] });
      }
      k.add(G.ico(0.075, 1), shade(st.hair, 1.08), [-0.05, hy + 0.15, -0.165], [0.3, 0.6, 1.25], [0.55, 1.6, 0.5], { crease: 40 });
      k.add(G.ico(0.065, 1), st.hair, [0.075, hy + 0.155, -0.155], [0.3, -0.4, -1.05], [0.55, 1.4, 0.5], { crease: 40 });
    } else if (hs === 'voxel') {
      const cube = 0.066;
      for (let j = 0; j < 5; j++) {
        const pit = 12 + j * 19;
        const ring = Math.max(1, Math.round(13 * Math.cos(pit * D2R)));
        for (let i = 0; i < ring; i++) {
          const yaw = (i / ring) * 360 + (j % 2) * 12;
          const yawR = yaw * D2R, pr = pit * D2R;
          const dz = Math.cos(yawR) * Math.cos(pr); // +1 = back
          if (dz < -0.25 && pit < 50) continue; // keep the face clear
          const rr = R + 0.012;
          const px = Math.sin(yawR) * Math.cos(pr) * rr, py = Math.sin(pr) * rr, pz = dz * rr;
          const hi = (i + j * 3) % 11 === 0;
          k.add(G.box(cube, cube, cube), hi ? st.hairHi : (i + j) % 3 ? st.hair : shade(st.hair, 1.25), [px, hy + py, pz], [pr * 0.8, yawR, 0, 'YXZ'], null, { flat: 1 });
        }
      }
      for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
        const yawR = (-0.9 + i * 0.6) * (j === 1 ? 1.1 : 1), pr = (-8 - j * 16) * D2R, rr = R + 0.01;
        k.add(G.box(cube, cube, cube), j === 0 ? shade(st.hair, 1.2) : st.hair, [Math.sin(yawR) * Math.cos(pr) * rr, hy + Math.sin(pr) * rr, Math.cos(yawR) * Math.cos(pr) * rr], [0, yawR, 0], null, { flat: 1 });
      }
      for (let i = 0; i < 4; i++) k.add(G.box(0.06, 0.1 + (i % 2) * 0.04, 0.06), i === 1 ? st.hairHi : st.hair, [-0.09 + i * 0.06, hy + R + 0.03, 0.02 - (i % 2) * 0.04], [0.2 - i * 0.05, 0, (i - 1.5) * 0.25], null, { flat: 1 });
    } else if (hs === 'tufts') {
      hairShell(k, st, R * 1.03, 1.95, 0.3);
      for (let i = 0; i < 4; i++) k.add(G.ico(0.045, 0), shade(st.hair, i % 2 ? 1.08 : 1), [-0.1 + i * 0.066, hy + 0.045 - Math.abs(i - 1.5) * 0.01, -0.205 + Math.abs(i - 1.5) * 0.014], [0.4, 0, (i - 1.5) * 0.4], [0.9, 1.3, 0.6], { crease: 50 });
      for (let s = -1; s <= 1; s += 2) k.add(G.ico(0.055, 0), st.hair, [s * 0.18, hy - 0.03, -0.07], [0, 0, s * 0.3], [0.55, 1.5, 0.7], { crease: 50 });
    } else if (hs === 'mohawk') {
      hairShell(k, st, R * 1.012, 1.85, 0.5);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = (-50 + (i * 175) / (n - 1)) * D2R; // polar angle from the top, front (-) to back (+)
        const dy = Math.cos(a), dz = Math.sin(a);
        _c1.set(st.mohawk[0]).lerp(_c2.set(st.mohawk[1]), i / (n - 1));
        const hgt = 0.2 - Math.abs(i - 2) * 0.014;
        k.add(G.cone(0.05, hgt, 4), _c1.getHex(), [0, hy + dy * (R + hgt * 0.3), dz * (R + hgt * 0.3)], [a, 0, 0], [0.42, 1, 1.5], { flat: 1, glow: 0.6 });
      }
    }
    // hats
    if (st.hat === 'cap') {
      k.add(G.hemi(R * 1.08, 16, 6), st.hatCol, [0, hy + 0.045, 0.005], [0.12, 0, 0], [1, 0.8, 1.04], { grad: [0.85, 1.1] });
      k.add(new THREE.CylinderGeometry(0.15, 0.15, 0.024, 14, 1, false, PI / 2, PI), st.hatCol2, [0, hy + 0.068, -0.13], [-0.26, 0, 0], [1.08, 1, 1.3]);
      k.add(G.sph(0.022, 6, 4), st.hatCol2, [0, hy + 0.045 + R * 1.08 * 0.8 * 0.99, 0.03]);
      k.add(G.cyl(0.045, 0.045, 0.012, 8), st.logo, [0, hy + 0.165, -0.172], [-0.86, 0, 0], null, { glow: 0.12 });
    } else if (st.hat === 'beanie') {
      k.add(G.hemi(R * 1.07, 16, 7, 1.72), st.hatCol, [0, hy + 0.005, 0.01], [0.1, 0, 0], [1, 1.08, 1.03], { grad: [0.84, 1.08] });
      k.add(G.cyl(R * 1.15, R * 1.16, 0.08, 18, true), st.hatCol2, [0, hy + 0.05, 0.01], [0.1, 0, 0], [1, 1, 1.02]);
      k.add(G.cyl(R * 1.168, R * 1.17, 0.02, 18, true), st.hatCol, [0, hy + 0.05, 0.01], [0.1, 0, 0], [1, 1, 1.02]);
      k.add(G.ico(0.08, 1), st.hatCol2, [0, hy + 0.3, 0.035], null, null, { crease: 55 });
      if (st.goggles) {
        k.add(G.torus(R * 1.1, 0.014, 3, 20), 0x2a2a3a, [0, hy + 0.13, 0.01], [PI / 2 + 0.42, 0, 0], [1, 0.99, 1]);
        k.add(G.box(0.21, 0.075, 0.045), 0x2e2c40, [0, hy + 0.18, -0.162], [-0.62, 0, 0]);
        k.add(rbox(0.185, 0.056, 0.03, 0.024), st.goggles, [0, hy + 0.184, -0.185], [-0.62, 0, 0], null, { crease: 40, glow: 0.18 });
      }
    } else if (st.hat === 'band') {
      k.add(G.torus(R * 1.055, 0.022, 4, 22), st.hatCol, [0, hy + 0.085, 0.01], [PI / 2 + 0.38, 0, 0], [1, 1.0, 1]);
      k.add(G.box(0.05, 0.06, 0.03), st.hatCol, [0.03, hy + 0.02, 0.23], [0.3, 0, 0.3]); // knot
      k.add(G.box(0.04, 0.12, 0.015), st.hatCol, [0.05, hy - 0.04, 0.24], [0.2, 0, 0.5]);
    }
    // ear gear
    if (st.ears === 'phones') {
      k.add(G.torus(R * 1.13, 0.017, 4, 14, PI), st.earCol, [0, hy + 0.01, 0.015], [0.08, 0, 0]);
      for (let s = -1; s <= 1; s += 2) {
        k.add(G.cyl(0.074, 0.074, 0.05, 12), st.earCol2, [s * (R + 0.028), hy - 0.01, 0.015], [0, 0, PI / 2]);
        k.add(G.torus(0.06, 0.017, 3, 10), 0x2d2150, [s * (R + 0.006), hy - 0.01, 0.015], [0, PI / 2, 0]);
        k.add(G.cyl(0.05, 0.05, 0.012, 10), st.earCol, [s * (R + 0.055), hy - 0.01, 0.015], [0, 0, PI / 2], null, { glow: 0.2 });
      }
    } else if (st.ears === 'muffs') {
      k.add(G.torus(R * 1.2, 0.015, 4, 14, PI), st.earCol2, [0, hy + 0.01, 0.03], [0.15, 0, 0]);
      for (let s = -1; s <= 1; s += 2) k.add(G.ico(0.078, 1), st.earCol, [s * (R + 0.03), hy - 0.015, 0.02], null, [0.72, 1, 1], { crease: 55 });
    }
    if (st.headset) {
      k.add(G.torus(R * 1.1, 0.02, 4, 14, PI), st.headset, [0, hy + 0.02, 0.0], [-0.05, 0, 0]);
      k.add(G.cyl(0.07, 0.07, 0.055, 12), st.hair, [-(R + 0.025), hy - 0.01, 0], [0, 0, PI / 2]);
      k.add(G.cyl(0.05, 0.05, 0.012, 10), st.headset, [-(R + 0.055), hy - 0.01, 0], [0, 0, PI / 2], null, { glow: 0.3 });
      k.add(G.cyl(0.07, 0.07, 0.04, 12), st.headset, [R + 0.02, hy - 0.01, 0], [0, 0, PI / 2]);
      k.add(G.tube([[-(R + 0.05), hy - 0.04, -0.03], [-(R + 0.02), hy - 0.1, -0.13], [-0.12, hy - 0.12, -0.2], [-0.05, hy - 0.11, -0.225]], 0.009, 10, 4), 0x2b2257);
      k.add(G.sph(0.022, 8, 6), 0x7cff6b, [-0.045, hy - 0.11, -0.228], null, null, { glow: 0.6 });
    }
    // eyewear
    if (st.shades === 'up') {
      for (let s = -1; s <= 1; s += 2) k.add(G.cyl(0.036, 0.036, 0.014, 9), 0x1d2233, [s * 0.052, hy + 0.2, -0.105], [-1.0 + PI / 2, 0, s * 0.05], [1.15, 1, 0.85]);
      k.add(G.box(0.03, 0.012, 0.012), 0x1d2233, [0, hy + 0.205, -0.1], [-1.0, 0, 0]);
      for (let s = -1; s <= 1; s += 2) k.add(G.box(0.1, 0.008, 0.008), 0xffffff, [s * 0.055, hy + 0.21, -0.118], [-1.0, 0, s * 0.3], null, { glow: 0.2 });
    } else if (st.shades === 'pixel') {
      for (let s = -1; s <= 1; s += 2) {
        const yaw = s * 24 * D2R, pr = -3 * D2R, rr = R + 0.012;
        k.add(G.box(0.084, 0.062, 0.022), 0x0c0a14, [Math.sin(yaw) * rr * Math.cos(pr), hy + Math.sin(pr) * rr, -Math.cos(yaw) * rr * Math.cos(pr)], [0, -yaw, 0], null, { flat: 1 });
        k.add(G.box(0.018, 0.018, 0.01), 0xffffff, [Math.sin(yaw - s * 0.05) * (rr + 0.012), hy + 0.012, -Math.cos(yaw - s * 0.05) * (rr + 0.012)], [0, -yaw, 0], null, { flat: 1, glow: 0.3 });
      }
      k.add(G.box(0.06, 0.02, 0.02), 0x0c0a14, [0, hy + 0.01, -R - 0.004], null, null, { flat: 1 });
      for (let s = -1; s <= 1; s += 2) k.add(G.box(0.012, 0.018, 0.2), 0x0c0a14, [s * (R - 0.004), hy + 0.01, -0.08], [0, s * 0.18, 0]);
    } else if (st.shades === 'visor') {
      k.add(new THREE.CylinderGeometry(R * 1.075, R * 1.075, 0.072, 26, 1, true, PI - 1.3, 2.6), st.visor, [0, hy - 0.004, 0], null, HEAD_S, { glow: 0.95 });
      k.add(new THREE.CylinderGeometry(R * 1.09, R * 1.09, 0.014, 26, 1, true, PI - 1.36, 2.72), 0x1a1030, [0, hy + 0.037, 0], null, HEAD_S);
      k.add(new THREE.CylinderGeometry(R * 1.09, R * 1.09, 0.014, 26, 1, true, PI - 1.36, 2.72), 0x1a1030, [0, hy - 0.045, 0], null, HEAD_S);
      for (let s = -1; s <= 1; s += 2) {
        k.add(G.cyl(0.05, 0.05, 0.03, 12), 0x241a3e, [s * (R + 0.012), hy - 0.01, 0.01], [0, 0, PI / 2]);
        k.add(G.torus(0.035, 0.008, 3, 12), st.mohawk[1], [s * (R + 0.028), hy - 0.01, 0.01], [0, PI / 2, 0], null, { glow: 0.9 });
      }
    }
    return k.build();
  }

  // TORSO (spine space: y from -0.15 to 0.5, chest front at -z)
  const PROF = [[0.0, -0.15], [0.155, -0.15], [0.178, -0.1], [0.186, 0.02], [0.198, 0.16], [0.206, 0.27], [0.198, 0.35], [0.17, 0.41], [0.115, 0.455], [0.07, 0.49], [0.0, 0.5]];
  const TZ = 0.74; // torso depth squash
  function onTorso(y, phi, out, r) { // point on the torso surface (+ r outward); phi 0 = back (+z), PI = front
    const rr = torsoR(PROF, y) + (r || 0);
    out[0] = Math.sin(phi) * rr; out[1] = y; out[2] = Math.cos(phi) * rr * TZ;
    return out;
  }
  const _tp = [0, 0, 0];
  function buildTorso(st) {
    const k = new Kit(), top = st.top;
    const puff = top === 'puffer' ? 1.08 : 1;
    k.add(G.lathe(PROF, 16), top === 'aloha' ? st.topCol2 : st.topCol, [0, 0, 0], null, [puff, 1, TZ * puff], { grad: [0.8, 1.06] });
    // neck base / collar skin
    k.add(G.cyl(0.066, 0.072, 0.08, 12), st.skin, [0, 0.49, 0.01], null, null, { grad: [0.7, 0.9] });
    if (top === 'hoodie') {
      k.add(G.torus(0.168, 0.024, 4, 16), shade(st.topCol, 0.84), [0, -0.128, 0], [PI / 2, 0, 0], [1, TZ, 1]);
      k.add(G.sph(0.19, 12, 8), st.topCol2, [0, 0.43, 0.11], [0.5, 0, 0], [1, 0.5, 0.76], { grad: [0.78, 1.02] });
      k.add(G.torus(0.105, 0.03, 4, 12), shade(st.topCol, 0.94), [0, 0.47, 0.025], [PI / 2 + 0.28, 0, 0], [1.1, 1, 1]);
      k.add(rbox(0.23, 0.115, 0.03, 0.022), st.topCol2, [0, 0.03, -0.132], [0.06, 0, 0], null, { crease: 40 });
      k.add(G.box(0.2, 0.01, 0.01), shade(st.topCol2, 0.8), [0, 0.087, -0.146]);
      for (let s = -1; s <= 1; s += 2) {
        k.add(G.cyl(0.008, 0.008, 0.13, 4, true), st.trim, [s * 0.036, 0.37, -0.148], [0.12, 0, 0]);
        k.add(G.cyl(0.013, 0.011, 0.024, 5), st.trim, [s * 0.036, 0.3, -0.155]);
      }
      if (st.heart) { // pixel heart print on the chest
        const H = ['01010', '11111', '11111', '01110', '00100'];
        for (let r = 0; r < H.length; r++) for (let c = 0; c < 5; c++) if (H[r][c] === '1') k.add(G.box(0.022, 0.022, 0.012), st.heart, [0.075 + (c - 2) * 0.022, 0.25 - r * 0.022, -0.152 - (r > 2 ? 0.003 : 0)], null, null, { flat: 1, glow: 0.1 });
      }
    } else if (top === 'bomber') {
      k.add(G.torus(0.17, 0.028, 4, 16), st.topCol2, [0, -0.125, 0], [PI / 2, 0, 0], [1, TZ, 1]);
      for (let i = 0; i < 2; i++) k.add(G.torus(0.172, 0.006, 3, 16), 0xffffff, [0, -0.108 - i * 0.034, 0], [PI / 2, 0, 0], [1, TZ, 1]);
      k.add(G.torus(0.1, 0.03, 5, 14), st.topCol2, [0, 0.462, 0.012], [PI / 2 + 0.2, 0, 0], [1.12, 1, 1]);
      k.add(G.box(0.012, 0.52, 0.01), st.trim, [0, 0.17, -0.155], [0.03, 0, 0]);
      k.add(G.cyl(0.036, 0.036, 0.01, 14), st.trim, [-0.1, 0.3, -0.145], [PI / 2 - 0.1, 0, 0], null, { glow: 0.12 });
      k.add(G.cyl(0.024, 0.024, 0.012, 5), 0xff5fa2, [-0.1, 0.3, -0.151], [PI / 2 - 0.1, 0, 0]);
      if (st.neckphones) {
        k.add(G.torus(0.118, 0.017, 4, 12, PI), st.neckphones[0], [0, 0.45, 0.0], [PI / 2 + 0.25, 0, 0]);
        for (let s = -1; s <= 1; s += 2) {
          k.add(G.cyl(0.06, 0.06, 0.045, 12), st.neckphones[0], [s * 0.118, 0.44, -0.04], [0.5, 0, s * 0.55]);
          k.add(G.cyl(0.042, 0.042, 0.01, 10), st.neckphones[1], [s * 0.135, 0.455, -0.05], [0.5, 0, s * 0.55], null, { glow: 0.25 });
        }
      }
    } else if (top === 'aloha') {
      k.add(G.lathe(PROF.slice(1, 9), 20, PI + 0.42, TAU - 0.84), st.topCol, [0, 0, 0], null, [1.05, 1, TZ * 1.07], { grad: [0.85, 1.05] });
      const fl = st.flowers;
      const spots = [[0.05, 0.3], [0.28, -0.35], [0.12, 0.9], [0.34, 1.4], [-0.02, 1.9], [0.22, 2.3], [0.08, -1.1], [0.3, -1.6], [0.14, -2.1], [-0.05, -0.6], [0.33, 0.55], [-0.06, 1.2]];
      for (let i = 0; i < spots.length; i++) {
        onTorso(spots[i][0], spots[i][1], _tp, 0.012);
        _tp[0] *= 1.05; _tp[2] *= 1.07;
        k.add(G.cyl(0.032, 0.032, 0.01, 5), fl[i % fl.length], [_tp[0], _tp[1], _tp[2]], [PI / 2, spots[i][1], 0, 'YXZ']);
      }
      for (let s = -1; s <= 1; s += 2) k.add(G.box(0.1, 0.012, 0.07), st.topCol, [s * 0.08, 0.44, -0.08], [0.5, s * 0.55, s * 0.3]);
      k.add(G.torus(0.1, 0.006, 3, 14), 0xfff2d6, [0, 0.44, -0.02], [PI / 2 + 0.55, 0, 0]);
      for (let i = -1; i <= 1; i++) k.add(G.sph(0.016, 6, 5), i ? 0xffffff : 0x3dd9c1, [i * 0.04, 0.39 - Math.abs(i) * 0.008, -0.115]);
    } else if (top === 'puffer') {
      for (let i = 0; i < 4; i++) {
        const y = -0.1 + i * 0.13;
        k.add(G.torus(torsoR(PROF, y) * puff * 1.0, 0.03, 3, 16), i % 2 ? st.topCol : st.topCol2, [0, y, 0], [PI / 2, 0, 0], [1, TZ * 1.02, 1]);
      }
      k.add(G.torus(0.125, 0.05, 5, 12), st.trim, [0, 0.47, 0.012], [PI / 2 + 0.15, 0, 0], [1.1, 1, 1], { flat: 1 });
      k.add(G.box(0.014, 0.5, 0.012), 0xd8e2f0, [0, 0.16, -0.166]);
      k.add(G.torus(0.105, 0.04, 5, 14), st.scarf, [0, 0.505, 0.01], [PI / 2 + 0.1, 0, 0], [1.1, 1, 1]);
      k.add(G.torus(0.107, 0.012, 3, 16), st.scarf2, [0, 0.505, 0.01], [PI / 2 + 0.1, 0, 0], [1.13, 1, 1]);
    } else if (top === 'tech') {
      k.add(G.torus(0.168, 0.02, 6, 24), st.topCol2, [0, -0.13, 0], [PI / 2, 0, 0], [1, TZ, 1]);
      k.add(G.cyl(0.1, 0.125, 0.11, 18, true), st.topCol2, [0, 0.49, 0.01]);
      k.add(G.torus(0.1, 0.008, 5, 20), st.glowA, [0, 0.545, 0.01], [PI / 2, 0, 0], null, { glow: 1 });
      for (let s = -1; s <= 1; s += 2) {
        k.add(G.box(0.012, 0.3, 0.012), st.glowA, [s * 0.075, 0.2, -0.153], [0.06, 0, s * 0.38], null, { glow: 1 });
        k.add(rbox(0.13, 0.03, 0.16, 0.012), st.topCol2, [s * 0.16, 0.42, 0.0], [0, 0, s * -0.42], null, { crease: 40 });
        k.add(G.box(0.1, 0.008, 0.008), st.glowB, [s * 0.18, 0.415, -0.078], [0, 0, s * -0.42], null, { glow: 1 });
      }
      k.add(G.cyl(0.03, 0.03, 0.01, 6), st.glowB, [0, 0.13, -0.148], [PI / 2 - 0.05, 0, 0], null, { glow: 1 });
      k.add(G.box(0.012, 0.44, 0.01), st.glowA, [0, 0.14, 0.157], [-0.05, 0, 0], null, { glow: 1 });
    }
    buildPack(k, st);
    return k.build();
  }
  function straps(k, st, zBack) {
    for (let s = -1; s <= 1; s += 2) {
      k.add(G.tube([[s * 0.1, 0.33, zBack], [s * 0.118, 0.435, 0.09], [s * 0.125, 0.455, -0.01], [s * 0.12, 0.39, -0.125], [s * 0.112, 0.24, -0.158], [s * 0.105, 0.1, -0.152]], 0.017, 10, 4), st.strap);
      k.add(G.box(0.045, 0.02, 0.012), 0xd8dbe6, [s * 0.108, 0.2, -0.162]);
    }
  }
  function sprayCan(k, col, x, y, z, rz) {
    k.add(G.cyl(0.035, 0.035, 0.15, 9), col, [x, y, z], [0, 0, rz], null, { grad: [0.8, 1.1] });
    k.add(G.cyl(0.0355, 0.0355, 0.035, 9, true), 0xffffff, [x, y + 0.005, z], [0, 0, rz]);
    const cx = x - Math.sin(rz) * 0.09, cy = y + Math.cos(rz) * 0.09;
    k.add(G.cyl(0.026, 0.034, 0.03, 9), 0xe8e8f0, [cx, cy, z], [0, 0, rz]);
    k.add(G.cyl(0.009, 0.009, 0.02, 5), 0x333344, [x - Math.sin(rz) * 0.113, y + Math.cos(rz) * 0.113, z], [0, 0, rz]);
  }
  function buildPack(k, st) {
    const p = st.pack, pc = st.packCol, pc2 = st.packCol2;
    if (p === 'pack') {
      k.add(rbox(0.3, 0.34, 0.13, 0.05), pc, [0, 0.2, 0.2], null, null, { grad: [0.78, 1.06], crease: 45 });
      k.add(rbox(0.23, 0.15, 0.06, 0.035), pc2, [0, 0.115, 0.285], null, null, { crease: 45, grad: [0.85, 1.05] });
      k.add(G.box(0.19, 0.012, 0.012), 0xffffff, [0, 0.188, 0.316]);
      k.add(G.box(0.025, 0.03, 0.012), 0xffffff, [0.07, 0.175, 0.318]);
      k.add(G.torus(0.045, 0.012, 3, 6, PI), st.strap, [0, 0.366, 0.2]);
      straps(k, st, 0.17);
      k.add(G.box(0.05, 0.1, 0.1), shade(pc2, 0.9), [0.165, 0.12, 0.2]);
      sprayCan(k, st.can, 0.172, 0.2, 0.2, -0.2);
      k.add(G.torus(0.018, 0.005, 3, 6), 0xd8dbe6, [-0.12, 0.05, 0.3], [0, PI / 2, 0]);
      k.add(G.ico(0.025, 0), 0x7cff6b, [-0.12, 0.012, 0.3], null, null, { flat: 1, glow: 0.35 });
    } else if (p === 'mini') {
      k.add(G.sph(0.14, 12, 9), pc, [0, 0.2, 0.2], null, [1, 1.12, 0.62], { grad: [0.78, 1.06] });
      k.add(G.sph(0.09, 10, 7), pc2, [0, 0.14, 0.27], null, [1, 0.85, 0.45]);
      k.add(G.torus(0.045, 0.012, 6, 12, PI), st.strap, [0, 0.35, 0.2]);
      straps(k, st, 0.16);
      sprayCan(k, st.can, 0.16, 0.18, 0.2, -0.25);
    } else if (p === 'surf') {
      k.add(G.cyl(0.11, 0.115, 0.28, 12), pc, [0, 0.19, 0.24], null, [1, 1, 0.7], { grad: [0.78, 1.06] });
      k.add(G.torus(0.1, 0.03, 4, 12), shade(pc, 0.9), [0, 0.34, 0.24], [PI / 2, 0, 0], [1, 0.7, 1]);
      k.add(G.box(0.04, 0.06, 0.02), 0x2a2a3a, [0, 0.36, 0.32]);
      k.add(G.sph(1, 12, 7), 0xff5a5f, [0.03, 0.2, 0.33], [0, 0, 0.42], [0.085, 0.36, 0.02], { grad: [0.85, 1.05] });
      k.add(G.box(0.02, 0.62, 0.008), 0xffffff, [0.03, 0.2, 0.352], [0, 0, 0.42]);
      k.add(G.box(0.008, 0.05, 0.05), 0x2a2a3a, [0.12, 0.0, 0.36], [0, 0, 0.42]);
      straps(k, st, 0.18);
      sprayCan(k, st.can, -0.17, 0.16, 0.22, 0.25);
    } else if (p === 'console') {
      k.add(rbox(0.3, 0.36, 0.1, 0.045), pc, [0, 0.2, 0.2], null, null, { grad: [0.8, 1.05], crease: 45 });
      k.add(rbox(0.22, 0.14, 0.02, 0.012), 0x3a3850, [0, 0.27, 0.25], null, null, { crease: 40 });
      k.add(G.box(0.18, 0.105, 0.008), pc2, [0, 0.27, 0.262], null, null, { glow: 0.5 });
      for (let i = 0; i < 3; i++) k.add(G.box(0.03, 0.03, 0.006), 0x1c3a20, [-0.05 + i * 0.05, 0.27 + (i % 2) * 0.02, 0.267], null, null, { glow: 0.3 });
      k.add(G.box(0.07, 0.022, 0.02), 0x2b2257, [-0.07, 0.13, 0.255]);
      k.add(G.box(0.022, 0.07, 0.02), 0x2b2257, [-0.07, 0.13, 0.255]);
      k.add(G.cyl(0.02, 0.02, 0.016, 10), 0xff3b5c, [0.06, 0.12, 0.254], [PI / 2, 0, 0]);
      k.add(G.cyl(0.02, 0.02, 0.016, 10), 0xff3fd2, [0.1, 0.15, 0.254], [PI / 2, 0, 0]);
      straps(k, st, 0.16);
    } else if (p === 'winter') {
      k.add(rbox(0.29, 0.32, 0.13, 0.05), pc, [0, 0.19, 0.205], null, null, { grad: [0.78, 1.06], crease: 45 });
      for (let i = 0; i < 3; i++) k.add(G.box(0.1, 0.014, 0.01), pc2, [0, 0.17, 0.274], [0, 0, (i * PI) / 3]);
      k.add(G.cyl(0.055, 0.055, 0.3, 10), 0x5aa9ff, [0, 0.39, 0.2], [0, 0, PI / 2], null, { grad: [0.8, 1.05] });
      for (let s = -1; s <= 1; s += 2) k.add(G.cyl(0.057, 0.057, 0.02, 10, true), 0x2a3f73, [s * 0.09, 0.39, 0.2], [0, 0, PI / 2]);
      straps(k, st, 0.17);
      sprayCan(k, st.can, 0.17, 0.18, 0.2, -0.2);
    } else if (p === 'tech') {
      k.add(rbox(0.26, 0.3, 0.1, 0.03), pc, [0, 0.2, 0.2], null, null, { grad: [0.8, 1.05], crease: 40 });
      k.add(G.torus(0.06, 0.012, 6, 20), pc2, [0, 0.21, 0.255], null, null, { glow: 1 });
      k.add(G.cyl(0.035, 0.035, 0.012, 16), st.glowB || 0xff3fd2, [0, 0.21, 0.252], [PI / 2, 0, 0], null, { glow: 1 });
      for (let s = -1; s <= 1; s += 2) {
        k.add(G.box(0.02, 0.2, 0.1), shade(pc, 0.8), [s * 0.14, 0.26, 0.24], [0.3, 0, s * -0.3]);
        k.add(G.box(0.022, 0.16, 0.012), pc2, [s * 0.15, 0.25, 0.29], [0.3, 0, s * -0.3], null, { glow: 1 });
      }
      straps(k, st, 0.16);
    }
  }

  // HIPS (body space; hip joints at y = HIP_DY)
  function buildHips(st) {
    const k = new Kit();
    k.add(G.sph(0.168, 14, 8), st.pantsCol, [0, -0.05, 0], null, [1, 0.75, 0.82], { grad: [0.8, 1] });
    if (st.pants === 'board') {
      k.add(G.cyl(0.172, 0.174, 0.05, 18), st.pantsCol2, [0, -0.005, 0], null, [1, 1, 0.82]);
      for (let s = -1; s <= 1; s += 2) k.add(G.cyl(0.006, 0.006, 0.09, 4), 0xffffff, [s * 0.025, -0.05, -0.143], [0, 0, s * 0.15]);
    } else if (st.pants === 'tech') {
      k.add(G.cyl(0.172, 0.174, 0.03, 18), st.glowB || 0xff3fd2, [0, -0.01, 0], null, [1, 1, 0.82], { glow: 0.9 });
    } else if (st.pants === 'cargo' || st.pants === 'snow') {
      k.add(G.cyl(0.171, 0.173, 0.035, 18), 0x2a2838, [0, -0.005, 0], null, [1, 1, 0.82]);
      k.add(G.box(0.05, 0.035, 0.02), 0xd8dbe6, [0, -0.005, -0.142]);
    }
    return k.build();
  }

  // LEGS
  function buildThigh(st, side) {
    const k = new Kit(), p = st.pants;
    const col = st.pantsCol;
    k.add(G.sph(0.09, 6, 4), col, [0, -0.005, 0]);
    let kneeCol = col;
    if (p === 'shorts') {
      k.add(G.cyl(0.102, 0.097, 0.21, 12, true), col, [0, -0.095, 0], null, null, { grad: [0.85, 1.02] });
      k.add(G.torus(0.096, 0.014, 3, 12), shade(col, 1.15), [0, -0.2, 0], [PI / 2, 0, 0]);
      k.add(G.cyl(0.08, 0.068, 0.21, 10, true), st.legCol, [0, -0.3, 0]);
      kneeCol = st.legCol;
    } else if (p === 'board') {
      k.add(G.cyl(0.108, 0.112, 0.33, 14), col, [0, -0.155, 0], null, null, { grad: [0.85, 1.02] });
      k.add(G.cyl(0.113, 0.114, 0.05, 14, true), st.pantsCol2, [0, -0.3, 0]);
      k.add(G.cyl(0.004, 0.004, 0.2, 3), 0xffffff, [side * 0.108, -0.14, 0]);
      k.add(G.cyl(0.068, 0.062, 0.1, 12), st.skin, [0, -0.35, 0]);
      kneeCol = st.skin;
    } else {
      const fat = p === 'snow' ? 1.12 : 1;
      k.add(G.cyl(0.089 * fat, 0.073 * fat, 0.41, 12, true), col, [0, -0.2, 0], null, null, { grad: [0.85, 1.02] });
      if (p === 'track') k.add(G.box(0.014, 0.4, 0.02), st.stripeCol, [side * 0.082, -0.2, 0], [0, 0, side * -0.04]);
      if (p === 'cargo') k.add(rbox(0.035, 0.1, 0.09, 0.012), st.pocketCol, [side * 0.088, -0.2, 0], [0, 0, side * -0.04], null, { crease: 40 });
      if (p === 'snow') k.add(G.torus(0.078, 0.012, 5, 14), shade(col, 0.8), [0, -0.3, 0], [PI / 2, 0, 0]);
      if (p === 'tech') k.add(G.box(0.01, 0.36, 0.012), st.glowA || 0x39f0ff, [side * 0.084, -0.2, 0.0], [0, 0, side * -0.04], null, { glow: 1 });
    }
    k.add(G.sph(0.073, 8, 5), kneeCol, [0, -THIGH, 0]);
    return k.build();
  }
  function shoeUpper(tall) {
    const s = new THREE.Shape();
    s.moveTo(0.068, 0.03);
    s.splineThru([V2(0.083, 0.075), V2(0.074, 0.122 + tall), V2(0.045, 0.15 + tall), V2(0.005, 0.148 + tall), V2(-0.035, 0.135 + tall * 0.5), V2(-0.085, 0.106), V2(-0.145, 0.082), V2(-0.185, 0.058), V2(-0.196, 0.036)]);
    s.lineTo(0.068, 0.03);
    return extrudeSide(s, 0.068, 0.018, 1, 2);
  }
  function soleShape(h, z0, z1) {
    const s = new THREE.Shape();
    s.moveTo(z0 + 0.02, 0); s.lineTo(z1 - 0.025, 0); s.quadraticCurveTo(z1, 0, z1, h * 0.55); s.lineTo(z1 - 0.003, h);
    s.lineTo(z0 + 0.008, h); s.quadraticCurveTo(z0 - 0.008, h * 0.7, z0, h * 0.3); s.quadraticCurveTo(z0 + 0.006, 0, z0 + 0.02, 0);
    return s;
  }
  function addShoe(k, st, side) {
    const Y = -SHIN - 0.1, kind = st.shoe;
    const tall = kind === 'hightop' ? 0.05 : kind === 'boot' ? 0.03 : 0;
    const sh = kind === 'chunky' ? 0.06 : kind === 'boot' ? 0.05 : 0.042;
    k.add(shoeUpper(tall), st.shoeCol, [0, Y + (sh - 0.042) * 0.8, 0], null, null, { shoe: 0.3, crease: 48, grad: [0.86, 1.05] });
    k.add(extrudeSide(soleShape(sh, -0.212, 0.098), 0.086, 0.012, 1, 3), st.soleCol, [0, Y, 0], null, null, { shoe: 0.55, crease: 48, glow: st.glowSole ? 0.5 : 0 });
    const s2 = new THREE.Shape(), a = sh * 0.36, b = sh * 0.64;
    s2.moveTo(-0.222, a); s2.lineTo(0.106, a); s2.lineTo(0.106, b); s2.lineTo(-0.224, b); s2.closePath();
    k.add(extrudeSide(s2, 0.104, 0.005, 1, 1), st.stripe, [0, Y, 0], null, null, { shoe: 1, glow: st.glowSole ? 1 : 0 });
    const lift = (sh - 0.042) * 0.8;
    k.add(new THREE.SphereGeometry(0.058, 8, 3, 0, TAU, 0, PI / 2), st.shoeCol2, [0, Y + sh - 0.004, -0.152], null, [0.95, 0.72 + lift * 2, 1.05], { shoe: 0.4 });
    k.add(G.box(0.05, 0.065 + tall, 0.03), st.shoeCol2, [0, Y + 0.125 + lift + tall * 0.5, 0.083], [0.12, 0, 0], null, { shoe: 0.4 });
    for (let i = 0; i < 3; i++) k.add(G.box(0.072, 0.011, 0.016), st.lace, [0, Y + 0.13 + lift - i * 0.013, -0.035 - i * 0.03], [-0.5, 0, 0]);
    k.add(G.torus(0.062, 0.008, 3, 6, 2.0), st.shoeCol2, [side * 0.056, Y + 0.075 + lift, -0.03], [0, PI / 2, 2.4], [1, 1, 0.6], { shoe: 0.8 });
    if (kind === 'hightop') {
      k.add(G.cyl(0.066, 0.07, 0.07, 10, true), st.shoeCol2, [0, Y + 0.19, 0.012], null, null, { shoe: 0.3 });
      k.add(G.cyl(0.03, 0.03, 0.01, 12), st.stripe, [side * 0.07, Y + 0.17, 0.02], [0, 0, PI / 2], null, { shoe: 1 });
    } else if (kind === 'boot') {
      k.add(G.cyl(0.07, 0.068, 0.13, 10, true), st.shoeCol, [0, Y + 0.2, 0.006], null, null, { shoe: 0.3 });
      k.add(G.torus(0.068, 0.03, 4, 10), st.shoeCol2, [0, Y + 0.27, 0.006], [PI / 2, 0, 0], null, { flat: 1 });
    } else if (kind === 'chunky') {
      k.add(G.box(0.12, 0.014, 0.12), st.shoeCol2, [0, Y + sh + 0.004, 0.03], null, null, { shoe: 0.6 });
    } else if (kind === 'tech') {
      k.add(G.sph(0.016, 8, 6), st.lace, [0, Y + 0.09, 0.1], null, null, { glow: 1 });
    }
  }
  function buildShin(st, side) {
    const k = new Kit(), p = st.pants;
    const bare = p === 'board';
    const col = bare ? st.skin : p === 'shorts' ? st.legCol : st.pantsCol;
    const fat = p === 'snow' ? 1.12 : 1;
    k.add(G.cyl(0.066 * fat, 0.053 * fat, 0.36, 10, true), col, [0, -0.18, 0], null, null, { grad: [0.85, 1.02] });
    if (!bare && p !== 'shorts' && p !== 'snow') k.add(G.torus(0.056 * fat, 0.012, 4, 12), shade(col, 0.85), [0, -0.34, 0], [PI / 2, 0, 0]);
    if (p === 'track') k.add(G.box(0.012, 0.32, 0.018), st.stripeCol, [side * 0.06, -0.17, 0], [0, 0, side * 0.035]);
    if (p === 'tech') {
      k.add(G.box(0.1, 0.12, 0.035), 0x3b2d6b, [0, -0.07, -0.058], [-0.08, 0, 0]);
      k.add(G.box(0.06, 0.01, 0.01), st.glowA || 0x39f0ff, [0, -0.07, -0.08], null, null, { glow: 1 });
      k.add(G.box(0.01, 0.28, 0.012), st.glowA || 0x39f0ff, [side * 0.062, -0.2, 0], [0, 0, side * 0.04], null, { glow: 1 });
    }
    if (p === 'snow') k.add(G.cyl(0.066, 0.064, 0.05, 12), shade(st.pantsCol, 0.8), [0, -0.33, 0]);
    k.add(G.cyl(0.057, 0.058, 0.07, 10, true), st.sock, [0, -SHIN + 0.025, 0]);
    addShoe(k, st, side);
    return k.build();
  }

  // ARMS
  function buildUpperArm(st, side) {
    const k = new Kit(), sl = st.top === 'aloha' ? st.topCol : st.topCol;
    const puffy = st.sleeve === 'puffy' ? 1.12 : 1;
    k.add(G.sph(0.076 * puffy, 9, 6), sl, [0, 0, 0]);
    if (st.sleeve === 'short') {
      k.add(G.cyl(0.074, 0.07, 0.14, 12), sl, [0, -0.065, 0], null, null, { grad: [0.85, 1] });
      k.add(G.cyl(0.071, 0.071, 0.02, 12, true), shade(sl, 0.85), [0, -0.13, 0]);
      k.add(G.cyl(0.054, 0.05, 0.16, 12), st.skin, [0, -0.19, 0]);
      k.add(G.sph(0.05, 8, 5), st.skin, [0, -UPARM, 0]);
    } else {
      k.add(G.cyl(0.064 * puffy, 0.057 * puffy, 0.27, 10, true), sl, [0, -0.135, 0], null, null, { grad: [0.82, 1.02] });
      k.add(G.sph(0.058 * puffy, 8, 5), sl, [0, -UPARM, 0]);
      if (st.top === 'bomber') k.add(G.cyl(0.0655, 0.0645, 0.03, 12, true), st.topCol2, [0, -0.08, 0]);
      if (st.sleeve === 'puffy') k.add(G.torus(0.066, 0.02, 3, 12), st.topCol2, [0, -0.14, 0], [PI / 2, 0, 0]);
      if (st.top === 'tech') k.add(G.box(0.01, 0.24, 0.01), st.glowA, [side * 0.062, -0.13, 0], [0, 0, side * -0.03], null, { glow: 1 });
    }
    return k.build();
  }
  function buildForearm(st, side) {
    const k = new Kit(), sl = st.topCol;
    const hand = st.hand || st.skin;
    const puffy = st.sleeve === 'puffy' ? 1.12 : 1;
    if (st.sleeve === 'short') {
      k.add(G.cyl(0.05, 0.042, 0.22, 12), st.skin, [0, -0.11, 0]);
      if (st.bracelet) k.add(G.torus(0.044, 0.01, 5, 12), st.bracelet, [0, -0.2, 0], [PI / 2, 0, 0]);
    } else {
      k.add(G.cyl(0.057 * puffy, 0.05 * puffy, 0.19, 10, true), sl, [0, -0.095, 0], null, null, { grad: [0.85, 1] });
      k.add(G.cyl(0.054 * puffy, 0.054 * puffy, 0.04, 12), st.cuff, [0, -0.2, 0]);
      k.add(G.cyl(0.037, 0.041, 0.06, 8, true), st.hand ? hand : st.skin, [0, -0.235, 0]);
      if (st.top === 'tech') k.add(G.torus(0.055, 0.007, 4, 14), st.glowA, [0, -0.19, 0], [PI / 2, 0, 0], null, { glow: 1 });
    }
    if (st.wristband) k.add(G.cyl(0.046, 0.046, 0.035, 12), st.wristband, [0, -0.225, 0]);
    k.add(G.sph(0.062, 8, 6), hand, [0, -HAND_Y, -0.004], null, [0.86, 1.1, 0.96]);
    k.add(G.sph(0.026, 6, 4), hand, [-side * 0.02, -0.268, -0.046], [0.3, 0, 0], [1, 1.35, 1]);
    if (st.sleeve === 'puffy') k.add(G.torus(0.056, 0.016, 3, 12), st.topCol2, [0, -0.1, 0], [PI / 2, 0, 0]);
    return k.build();
  }

  // SWING (secondary motion part: pivot origin, hangs along -y)
  function buildSwing(st) {
    const k = new Kit();
    if (st.swing === 'pony') {
      k.add(G.torus(0.04, 0.014, 3, 8), st.earCol2 || 0xff4f9a, [0, -0.005, 0.01], [0.3, 0, 0]);
      const chain = [[0, -0.025, 0.035, 0.072], [0, -0.11, 0.075, 0.066], [0, -0.2, 0.085, 0.054], [0, -0.28, 0.072, 0.038]];
      for (let i = 0; i < chain.length; i++) { const c = chain[i]; k.add(G.ico(c[3], 1), i % 2 ? st.hair : shade(st.hair, 1.12), [c[0], c[1], c[2]], [i * 0.4, i * 0.7, 0], [1, 1.25, 0.9], { crease: 42 }); }
    } else if (st.swing === 'locks') {
      for (let i = 0; i < 5; i++) k.add(G.ico(0.05, 0), i % 2 ? st.hair : shade(st.hair, 1.1), [-0.08 + i * 0.04, -0.06 - (i % 2) * 0.02, 0.02], [0.2, i, (i - 2) * 0.18, 'ZXY'], [0.75, 2.1, 0.7], { crease: 50, grad: [0.8, 1.1] });
    } else if (st.swing === 'scarf') {
      k.add(G.box(0.1, 0.3, 0.026), st.scarf, [0, -0.15, 0], null, null, { grad: [0.85, 1.02] });
      for (let i = 0; i < 2; i++) k.add(G.box(0.104, 0.024, 0.03), st.scarf2, [0, -0.1 - i * 0.1, 0]);
      for (let i = 0; i < 5; i++) k.add(G.box(0.012, 0.045, 0.012), st.scarf, [-0.04 + i * 0.02, -0.32, 0]);
    } else if (st.swing === 'tails') {
      for (let s = -1; s <= 1; s += 2) {
        k.add(G.box(0.15, 0.36, 0.02), st.topCol, [s * 0.082, -0.18, 0], [0, 0, s * 0.07], null, { grad: [0.8, 1.02] });
        k.add(G.box(0.012, 0.35, 0.026), st.glowA, [s * 0.16, -0.18, 0], [0, 0, s * 0.07], null, { glow: 1 });
        k.add(G.box(0.15, 0.012, 0.026), st.glowB, [s * 0.095, -0.36, 0], [0, 0, s * 0.07], null, { glow: 1 });
      }
    }
    return k.parts.length ? k.build() : null;
  }
  const SWING_AT = { pony: ['neck', 0, HEAD_Y + 0.085, 0.205], locks: ['neck', 0, HEAD_Y - 0.03, 0.19], scarf: ['spine', -0.075, 0.47, 0.095], tails: ['spine', 0, -0.1, 0.13] };

  function buildSkin(id) {
    const st = STY[id] || STY.nova;
    const t0 = performance.now();
    const s = {
      id, st,
      hips: buildHips(st), torso: buildTorso(st), head: buildHead(st),
      upL: buildUpperArm(st, -1), upR: buildUpperArm(st, 1), foL: buildForearm(st, -1), foR: buildForearm(st, 1),
      thL: buildThigh(st, -1), thR: buildThigh(st, 1), shL: buildShin(st, -1), shR: buildShin(st, 1),
      swing: st.swing ? buildSwing(st) : null, swingAt: st.swing ? SWING_AT[st.swing] : null
    };
    s.ms = performance.now() - t0;
    return s;
  }

  // ------------------------------------------------------------------ hoverboards
  function deckShape(kind) {
    const s = new THREE.Shape();
    if (kind === 'stadium') {
      const L = 0.76, W = 0.25, r = 0.2;
      s.moveTo(-L + r, -W); s.lineTo(L - r, -W); s.quadraticCurveTo(L + 0.01, -W, L, 0); s.quadraticCurveTo(L + 0.01, W, L - r, W);
      s.lineTo(-L + r, W); s.quadraticCurveTo(-L - 0.01, W, -L, 0); s.quadraticCurveTo(-L - 0.01, -W, -L + r, -W);
    } else if (kind === 'surf') {
      s.moveTo(-0.84, 0);
      s.splineThru([V2(-0.6, -0.17), V2(-0.25, -0.26), V2(0.2, -0.25), V2(0.55, -0.19), V2(0.74, -0.08)]);
      s.quadraticCurveTo(0.78, 0, 0.74, 0.08);
      s.splineThru([V2(0.55, 0.19), V2(0.2, 0.25), V2(-0.25, 0.26), V2(-0.6, 0.17), V2(-0.84, 0)]);
    } else if (kind === 'scallop') {
      const L = 0.72, W = 0.27, pts = [];
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; const x = Math.cos(a), y = Math.sin(a); const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.55), sy = Math.sign(y) * Math.pow(Math.abs(y), 0.55); const wob = 1 + 0.035 * Math.sin(a * 16); pts.push(V2(sx * L * wob, sy * W * wob)); }
      s.setFromPoints(pts);
    } else {
      const L = 0.78, W = 0.25, c = 0.15;
      s.moveTo(-L, -W + c); s.lineTo(-L + c, -W); s.lineTo(L - c, -W); s.lineTo(L, -W + c); s.lineTo(L, W - c); s.lineTo(L - c, W); s.lineTo(-L + c, W); s.lineTo(-L, W - c); s.closePath();
    }
    return s;
  }
  function deckGeo(kind, row) {
    const shape = deckShape(kind);
    let g = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 5, steps: 1 });
    _m4.set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1); // shape x -> z (length), shape y -> x, extrusion -> y
    g.applyMatrix4(_m4);
    g.translate(0, -0.055, 0);
    if (g.index) g = g.toNonIndexed();
    g.computeBoundingBox();
    const bb = g.boundingBox, p = g.attributes.position.array, n = p.length / 3;
    g.computeVertexNormals();
    const nr = g.attributes.normal.array;
    const uv = new Float32Array(n * 2);
    const vTop = 1 - (256 + row * 64 + 3) / 512, vBot = 1 - (256 + row * 64 + 61) / 512;
    for (let i = 0; i < n; i++) {
      if (nr[i * 3 + 1] > 0.95 && p[i * 3 + 1] > -0.003) {
        uv[i * 2] = 0.005 + 0.99 * (p[i * 3 + 2] - bb.min.z) / (bb.max.z - bb.min.z);
        uv[i * 2 + 1] = vTop + (vBot - vTop) * (p[i * 3] - bb.min.x) / (bb.max.x - bb.min.x);
      } else { uv[i * 2] = NO_UV[0]; uv[i * 2 + 1] = NO_UV[1]; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    for (let i = 0; i < n; i++) { const z = Math.abs(p[i * 3 + 2]); if (z > 0.42) p[i * 3 + 1] += 1.1 * (z - 0.42) * (z - 0.42); }
    smoothNormals(g, 35);
    return g;
  }
  function buildBoard(id) {
    const bs = BST[id] || BST.classic, row = Math.max(0, BOARDS.findIndex((b) => b.id === id));
    const k = new Kit();
    k.add(deckGeo(bs.shape, row), bs.rail, null, null, null, { keepUv: 1 });
    k.add(G.box(0.07, 0.014, 0.9), bs.glow, [0, -0.083, 0], null, null, { glow: 1 });
    for (let s = -1; s <= 1; s += 2) {
      k.add(G.cyl(0.11, 0.125, 0.03, 12), 0x2a2340, [0, -0.083, s * 0.4]);
      k.add(G.torus(0.1, 0.012, 3, 16), bs.glow, [0, -0.1, s * 0.4], [PI / 2, 0, 0], null, { glow: 1 });
      k.add(G.cyl(0.04, 0.046, 0.16, 10), 0xb9c2d6, [s * 0.13, -0.058, 0.6], [PI / 2, 0, 0], null, { grad: [0.8, 1.05] });
      k.add(G.cyl(0.031, 0.031, 0.01, 10), bs.thr, [s * 0.13, -0.058, 0.683], [PI / 2, 0, 0], null, { glow: 1 });
      k.add(G.sph(0.018, 8, 6), 0xffffff, [s * 0.1, -0.03, -0.66], null, null, { glow: 1 });
    }
    return { geo: k.build(), bs };
  }

  // ------------------------------------------------------------------ jetpack, magnet, fx meshes
  function buildJetpack() {
    const k = new Kit(), red = 0xff5a4f, yel = 0xffc233, metal = 0xbfc6d8, dark = 0x3a3550;
    for (let s = -1; s <= 1; s += 2) {
      const x = s * 0.18, z = 0.28;
      k.add(G.cyl(0.08, 0.08, 0.3, 14), red, [x, 0.21, z], null, null, { grad: [0.78, 1.06] });
      k.add(G.hemi(0.08, 14, 4), red, [x, 0.36, z]);
      k.add(G.torus(0.081, 0.011, 3, 14), metal, [x, 0.3, z], [PI / 2, 0, 0]);
      k.add(G.torus(0.081, 0.011, 3, 14), metal, [x, 0.12, z], [PI / 2, 0, 0]);
      k.add(G.cyl(0.0815, 0.0815, 0.035, 14, true), yel, [x, 0.21, z]);
      k.add(G.cyl(0.08, 0.06, 0.04, 12), dark, [x, 0.04, z]);
      k.add(G.cyl(0.05, 0.068, 0.07, 12, true), metal, [x, -0.01, z]);
      k.add(G.cyl(0.047, 0.047, 0.008, 10), 0xffb347, [x, 0.0, z], null, null, { glow: 1 });
      k.add(G.box(0.012, 0.16, 0.1), yel, [x + s * 0.085, 0.12, z + 0.02], [0, 0, s * -0.12]);
    }
    k.add(rbox(0.32, 0.07, 0.07, 0.02), dark, [0, 0.33, 0.28], null, null, { crease: 40 });
    k.add(rbox(0.16, 0.18, 0.1, 0.03), yel, [0, 0.17, 0.33], null, null, { crease: 40, grad: [0.85, 1.05] });
    k.add(G.cyl(0.03, 0.03, 0.012, 12), 0x39f0ff, [0, 0.2, 0.385], [PI / 2, 0, 0], null, { glow: 1 });
    for (let i = 0; i < 3; i++) k.add(G.box(0.022, 0.12, 0.012), dark, [-0.04 + i * 0.04, 0.12, 0.382], [0, 0, 0.5]);
    return k.build();
  }
  const NOZ = [[-0.18, -0.045, 0.28], [0.18, -0.045, 0.28]];
  function buildFlames() {
    const list = [];
    for (let i = 0; i < 2; i++) {
      for (let c = 0; c < 2; c++) {
        let g = new THREE.CylinderGeometry(c ? 0.036 : 0.07, 0.006, c ? 0.6 : 1, 10, 4, true);
        g.translate(NOZ[i][0], -(c ? 0.3 : 0.5), NOZ[i][2]);
        g = g.toNonIndexed();
        const n = g.attributes.position.count, a = new Float32Array(n).fill(c);
        g.setAttribute('aCore', new THREE.BufferAttribute(a, 1));
        list.push(g);
      }
    }
    let n = 0; list.forEach((g) => (n += g.attributes.position.count));
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), core = new Float32Array(n);
    let o = 0;
    list.forEach((g) => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); core.set(g.attributes.aCore.array, o); o += g.attributes.position.count; g.dispose(); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('aCore', new THREE.BufferAttribute(core, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.6, 0.28), 1.4);
    return geo;
  }
  function buildMagnet() {
    const k = new Kit(), R = 0.1;
    // U opens toward -y (away from the fist), lying in the forearm's x-y plane
    k.add(G.torus(R, 0.03, 6, 12, PI), 0xff3b4f, [0, -HAND_Y - 0.02 - R, -0.01], [0, 0, 0], null, { grad: [0.8, 1.1] });
    for (let s = -1; s <= 1; s += 2) {
      k.add(G.cyl(0.03, 0.03, 0.08, 10), 0xff3b4f, [s * R, -HAND_Y - 0.02 - R - 0.04, -0.01]);
      k.add(G.cyl(0.031, 0.031, 0.05, 10), 0xe8ecf5, [s * R, -HAND_Y - 0.02 - R - 0.105, -0.01], null, null, { glow: 0.6 });
    }
    return k.build();
  }
  function buildField() {
    // two dashed rings + a ring of sparks spinning around the runner (only the dash triangles are kept)
    const pos = [], col = [];
    const cA = new THREE.Color(0xff3b6b), cB = new THREE.Color(0x3fb4ff), cW = new THREE.Color(0xffffff);
    const addRing = (R, t, tiltX, tiltZ, y, dashes, ca, cb) => {
      let g = new THREE.TorusGeometry(R, t, 4, 96);
      g.rotateX(PI / 2 + tiltX); g.rotateZ(tiltZ); g.translate(0, y, 0);
      g = g.toNonIndexed();
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 9) {
        const cxp = (p[i] + p[i + 3] + p[i + 6]) / 3, czp = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
        const a = (Math.atan2(czp, cxp) + PI) / TAU, seg = a * dashes, f = seg - Math.floor(seg);
        if (f > 0.66) continue;
        _c1.copy(Math.floor(seg) % 2 ? ca : cb).lerp(cW, 0.35 * Math.sin((f / 0.66) * PI));
        for (let v = 0; v < 3; v++) { pos.push(p[i + v * 3], p[i + v * 3 + 1], p[i + v * 3 + 2]); col.push(_c1.r, _c1.g, _c1.b); }
      }
      g.dispose();
    };
    addRing(0.82, 0.024, 0.2, 0.06, -0.1, 12, cA, cB);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      let g = new THREE.OctahedronGeometry(0.04, 0);
      g.translate(Math.cos(a) * 0.92, -0.2 + 0.15 * Math.sin(a * 3), Math.sin(a) * 0.92);
      g = g.index ? g.toNonIndexed() : g;
      const p = g.attributes.position.array; const c = i % 2 ? cA : cB;
      for (let v = 0; v < p.length; v += 3) { pos.push(p[v], p[v + 1], p[v + 2]); col.push(c.r, c.g, c.b); }
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  // ------------------------------------------------------------------ rig objects
  let group, root, spinO, body, spineO, neckO, shLO, shRO, elLO, elRO, hipLO, hipRO, knLO, knRO, swingO;
  let mHips, mTorso, mHead, mUpL, mUpR, mFoL, mFoR, mThL, mThR, mShL, mShR, mSwing;
  let charMeshes = [];
  let boardRoot, mBoard, mHover, mJet, mFlames, mMagnet, mField, mBlob, smoke;
  const anchors = {};
  function obj(parent, x, y, z) { const o = new THREE.Object3D(); o.position.set(x || 0, y || 0, z || 0); parent.add(o); return o; }
  function mesh(parent, geo, m, shadow) { const me = new THREE.Mesh(geo || EMPTY, m || mat); me.castShadow = !!shadow; me.receiveShadow = false; parent.add(me); return me; }

  function buildRig() {
    group = new THREE.Group(); group.name = 'player';
    root = obj(group); root.rotation.order = 'YXZ';
    spinO = obj(root, 0, SPIN_STAND, 0);
    body = obj(spinO, 0, HIP_Y - SPIN_STAND, 0);
    spineO = obj(body, 0, SPINE_Y, 0);
    neckO = obj(spineO, 0, NECK_Y, 0);
    shLO = obj(spineO, -SH_X, SH_Y, 0); shRO = obj(spineO, SH_X, SH_Y, 0);
    elLO = obj(shLO, 0, -UPARM, 0); elRO = obj(shRO, 0, -UPARM, 0);
    hipLO = obj(body, -HIP_X, HIP_DY, 0); hipRO = obj(body, HIP_X, HIP_DY, 0);
    knLO = obj(hipLO, 0, -THIGH, 0); knRO = obj(hipRO, 0, -THIGH, 0);
    swingO = obj(neckO, 0, 0, 0);
    mHips = mesh(body); mTorso = mesh(spineO); mHead = mesh(neckO);
    mUpL = mesh(shLO); mUpR = mesh(shRO); mFoL = mesh(elLO); mFoR = mesh(elRO);
    mThL = mesh(hipLO); mThR = mesh(hipRO); mShL = mesh(knLO); mShR = mesh(knRO);
    mSwing = mesh(swingO);
    charMeshes = [mHips, mTorso, mHead, mUpL, mUpR, mFoL, mFoR, mThL, mThR, mShL, mShR, mSwing];
    // jetpack + flames on the spine
    mJet = mesh(spineO, buildJetpack()); mJet.visible = false;
    mFlames = new THREE.Mesh(buildFlames(), flameMat); mFlames.renderOrder = 11; mFlames.visible = false; spineO.add(mFlames);
    anchors.nozzleL = obj(spineO, NOZ[0][0], NOZ[0][1] - 0.2, NOZ[0][2]);
    anchors.nozzleR = obj(spineO, NOZ[1][0], NOZ[1][1] - 0.2, NOZ[1][2]);
    // magnet in the right hand + field rings
    mMagnet = mesh(elRO, buildMagnet()); mMagnet.visible = false;
    mField = new THREE.Mesh(buildField(), fieldMat); mField.renderOrder = 11; mField.visible = false; mField.position.y = 1.05; root.add(mField);
    anchors.handL = obj(elLO, 0, -HAND_Y, 0); anchors.handR = obj(elRO, 0, -HAND_Y, 0);
    anchors.footL = obj(knLO, 0, -SHIN - 0.08, -0.05); anchors.footR = obj(knRO, 0, -SHIN - 0.08, -0.05);
    anchors.head = obj(neckO, 0, HEAD_Y, 0);
    // hoverboard
    boardRoot = obj(group, 0, BOARD_H, 0); boardRoot.visible = false;
    mBoard = mesh(boardRoot);
    const hg = new THREE.PlaneGeometry(0.95, 1.9); hg.rotateX(-PI / 2);
    mHover = new THREE.Mesh(hg, hoverMat); mHover.position.y = -0.26; mHover.renderOrder = 10; boardRoot.add(mHover);
    anchors.board = boardRoot;
    // blob shadow
    const bg = new THREE.PlaneGeometry(1.25, 1.25); bg.rotateX(-PI / 2);
    mBlob = new THREE.Mesh(bg, blobMat); mBlob.renderOrder = 2; group.add(mBlob);
    // smoke (world space)
    smoke = buildSmoke();
    scene.add(group);
    scene.add(smoke);
  }

  // ------------------------------------------------------------------ smoke pool
  const SMOKE_N = 36;
  const sPos = new Float32Array(SMOKE_N * 3), sAlpha = new Float32Array(SMOKE_N), sSize = new Float32Array(SMOKE_N);
  const sVel = new Float32Array(SMOKE_N * 3), sAge = new Float32Array(SMOKE_N), sLife = new Float32Array(SMOKE_N), sS0 = new Float32Array(SMOKE_N), sS1 = new Float32Array(SMOKE_N);
  let sNext = 0, sEmitAcc = 0, sLive = 0, smokeCap = SMOKE_N;
  function buildSmoke() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage));
    const p = new THREE.Points(g, smokeMat);
    p.frustumCulled = false; p.renderOrder = 12; p.visible = false;
    return p;
  }
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
  function emitSmoke(anchor) {
    if (sLive >= smokeCap) return;
    anchor.getWorldPosition(_v1);
    const i = sNext; sNext = (sNext + 1) % smokeCap;
    sPos[i * 3] = _v1.x + (Math.random() - 0.5) * 0.08; sPos[i * 3 + 1] = _v1.y; sPos[i * 3 + 2] = _v1.z + (Math.random() - 0.5) * 0.08;
    sVel[i * 3] = (Math.random() - 0.5) * 1.2; sVel[i * 3 + 1] = -2.2 - Math.random() * 1.5; sVel[i * 3 + 2] = (Math.random() - 0.3) * 1.2;
    sAge[i] = 0; sLife[i] = 0.42 + Math.random() * 0.25; sS0[i] = 0.22; sS1[i] = 0.75 + Math.random() * 0.35;
  }
  function updateSmoke(dt, emitting) {
    if (emitting) {
      sEmitAcc += dt * 34;
      while (sEmitAcc >= 1) { sEmitAcc -= 1; emitSmoke((sNext & 1) ? anchors.nozzleL : anchors.nozzleR); }
    } else sEmitAcc = 0;
    sLive = 0;
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < SMOKE_N; i++) {
      if (sLife[i] <= 0) { sAlpha[i] = 0; sSize[i] = 0; continue; }
      sAge[i] += dt;
      const t = sAge[i] / sLife[i];
      if (t >= 1 || i >= smokeCap) { sLife[i] = 0; sAlpha[i] = 0; sSize[i] = 0; continue; }
      sLive++;
      sPos[i * 3] += sVel[i * 3] * dt; sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt; sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
      sVel[i * 3] *= drag; sVel[i * 3 + 1] = sVel[i * 3 + 1] * drag + 1.5 * dt; sVel[i * 3 + 2] *= drag;
      sAlpha[i] = 0.5 * Math.pow(1 - t, 1.3) * Math.min(1, t * 8);
      sSize[i] = sS0[i] + (sS1[i] - sS0[i]) * Math.sqrt(t);
    }
    const g = smoke.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    smoke.visible = sLive > 0;
  }
  function clearSmoke() { sLife.fill(0); sAlpha.fill(0); sSize.fill(0); sLive = 0; sEmitAcc = 0; sNext = 0; if (smoke) smoke.visible = false; }

  // ------------------------------------------------------------------ skins / boards
  function applySkin(id) {
    if (!STY[id]) id = 'nova';
    let s = skinCache[id];
    if (!s) s = skinCache[id] = buildSkin(id);
    curSkin = s;
    mHips.geometry = s.hips; mTorso.geometry = s.torso; mHead.geometry = s.head;
    mUpL.geometry = s.upL; mUpR.geometry = s.upR; mFoL.geometry = s.foL; mFoR.geometry = s.foR;
    mThL.geometry = s.thL; mThR.geometry = s.thR; mShL.geometry = s.shL; mShR.geometry = s.shR;
    if (s.swing) {
      const at = s.swingAt, parent = at[0] === 'spine' ? spineO : neckO;
      parent.add(swingO); swingO.position.set(at[1], at[2], at[3]);
      mSwing.geometry = s.swing; mSwing.visible = true;
    } else { mSwing.geometry = EMPTY; mSwing.visible = false; }
    A.swingX = -0.4; A.swingVX = 0; A.swingZ = 0; A.swingVZ = 0;
  }
  function applyBoard(id) {
    if (!BST[id]) id = 'classic';
    let b = boardCache[id];
    if (!b) b = boardCache[id] = buildBoard(id);
    curBoard = b;
    mBoard.geometry = b.geo;
    hoverMat.color.set(b.bs.hover);
  }

  // ------------------------------------------------------------------ animation state
  const NCH = 32;
  const BY = 0, BZ = 1, BRX = 2, BRY = 3, BRZ = 4, SRX = 5, SRY = 6, SRZ = 7, NRX = 8, NRY = 9, NRZ = 10,
    ALX = 11, ALY = 12, ALZ = 13, EL = 14, ARX = 15, ARY = 16, ARZ = 17, ER = 18,
    LLX = 19, LLY = 20, LLZ = 21, KL = 22, LRX = 23, LRY = 24, LRZ = 25, KR = 26, PLANT = 27, BOB = 28;
  const P_IDLE = 0, P_RUN = 1, P_AIR = 2, P_BALL = 3, P_BOARD = 4, P_BAIR = 5, P_BCROUCH = 6, P_JET = 7, P_DEATH = 8, NP = 9;
  const POSES = []; for (let i = 0; i < NP; i++) POSES.push(new Float32Array(NCH));
  const W = new Float32Array(NP), WT = new Float32Array(NP), OUT = new Float32Array(NCH);
  W[P_IDLE] = 1;
  const A = { // animation scalars
    t: 0, ph: 0, wasGrounded: true, wasRolling: false, jumpVy0: 1, flipping: false, boardSpin: false, lead: 1, airVy: 0,
    spin: 0, yawSpin: 0, rollBase: 0, flipBase: 0, yawBase: 0, sq: 0, sqV: 0, landK: 0, landImpact: 0, bank: 0, lean: 0,
    swingX: -0.4, swingVX: 0, swingZ: 0, swingVZ: 0,
    lookYaw: 0, lookPitch: 0, lookT: 2, lookTargetY: 0, lookTargetP: 0, waveT: 0, waveIn: 5, waveW: 0,
    blinkIn: 3, blinkT: 0, happyT: 0, winkT: 0, face: -1,
    deathK: 0, deadLatch: false, recover: false,
    boardW: 0, jetW: 0, magW: 0, shoeW: 0, trackLift: 0, groundY: 0, liftSleeper: 0,
    jetY01: 0, jetRise: 0, celebW: 0, stumbleW: 0, flash: 0, prevState: 'title'
  };
  // spins run toward -z (forward); a new spin continues from the current orientation, a finished one
  // settles forward to the next whole turn (then resets to 0, the same orientation)
  function spinBase(a) { return a > -0.3 ? 0 : Math.floor(a / TAU) * TAU; }
  function settleTurn(a) { const tr = a / TAU, fl = Math.floor(tr); return (tr - fl > 0.9 ? fl + 1 : fl) * TAU; }
  function setFace(i) {
    if (A.face === i) return;
    A.face = i;
    U.uFaceOff.value.set((i % 4) * 0.25, -((i / 4) | 0) * 0.25);
  }

  function zero(P) { P.fill(0); }
  function poseIdle(P, t) {
    zero(P);
    const b = Math.sin(t * 2.1);
    P[PLANT] = 1; P[BY] = HIP_Y;
    P[BRY] = 0.07 * Math.sin(t * 0.33); P[BRZ] = 0.025 + 0.012 * Math.sin(t * 0.7);
    P[SRX] = 0.02 + 0.018 * b; P[SRY] = 0.05 * Math.sin(t * 0.41); P[SRZ] = -0.015;
    P[NRX] = A.lookPitch + 0.012 * b; P[NRY] = A.lookYaw - P[SRY] - P[BRY]; P[NRZ] = -0.03 * A.lookYaw;
    P[ALX] = -0.12 + 0.02 * b; P[ALZ] = -0.14; P[EL] = 1.9; P[ALY] = -0.55; // thumb hooked in the backpack strap
    P[ARX] = 0.05; P[ARZ] = 0.17 + 0.02 * b; P[ER] = 0.32; P[ARY] = 0.25;
    P[LLX] = 0.1; P[LLZ] = -0.1; P[KL] = -0.24; P[LLY] = -0.3;
    P[LRX] = -0.04; P[LRZ] = 0.07; P[KR] = -0.02; P[LRY] = 0.12;
    P[BRZ] += 0.02;
    P[BOB] = 0.004 * b;
  }
  function poseRun(P, ph, sp) {
    zero(P);
    const s = Math.sin(ph), c = Math.cos(ph), k = clamp((sp - 20) / 30, 0, 1);
    P[PLANT] = 1; P[BY] = HIP_Y;
    const amp = 0.78 + 0.12 * k;
    P[LLX] = 0.22 + amp * s; P[LRX] = 0.22 - amp * s;
    const kn = (q) => -(0.24 + 0.26 * Math.pow(Math.max(0, -Math.cos(q)), 2) + 1.5 * Math.pow(Math.max(0, Math.cos(q + 0.6)), 1.3));
    P[KL] = kn(ph); P[KR] = kn(ph + PI);
    P[LLZ] = -0.04; P[LRZ] = 0.04;
    P[ALX] = -0.9 * s; P[ARX] = 0.9 * s;
    P[EL] = 1.25 + 0.35 * Math.max(0, -s); P[ER] = 1.25 + 0.35 * Math.max(0, s);
    P[ALZ] = -0.14; P[ARZ] = 0.14; P[ALY] = -0.22; P[ARY] = 0.22;
    P[BRX] = -0.1 - 0.06 * k; P[BRY] = -0.07 * s; P[BRZ] = 0.03 * s;
    P[SRX] = -0.16 - 0.05 * k; P[SRY] = 0.15 * s; P[SRZ] = -0.02 * s;
    P[NRX] = 0.26 + 0.08 * k; P[NRY] = -0.08 * s; P[NRZ] = -0.02 * s;
    P[BOB] = 0.035 * Math.max(0, -Math.cos(2 * ph)) - 0.01;
    void c;
  }
  function poseAir(P, u, lead) {
    zero(P);
    const r = sstep(-0.35, 0.65, u); // 1 rising, 0 falling
    P[PLANT] = 0; P[BY] = HIP_Y;
    const fl = lead > 0, h1 = 0.55 + 0.65 * r, k1 = -(0.5 + 1.3 * r), h2 = 0.1 + 0.1 * r, k2 = -(0.35 + 0.95 * r);
    P[LLX] = fl ? h1 : h2; P[KL] = fl ? k1 : k2; P[LRX] = fl ? h2 : h1; P[KR] = fl ? k2 : k1;
    P[LLZ] = -0.08; P[LRZ] = 0.08;
    P[ALZ] = -(1.25 + 0.95 * r); P[ARZ] = 1.25 + 0.95 * r; P[ALX] = 0.25 + 0.35 * r; P[ARX] = 0.25 + 0.35 * r;
    P[EL] = 0.45; P[ER] = 0.45;
    P[BRX] = -0.06 - 0.06 * (1 - r); P[SRX] = -0.05 - 0.12 * (1 - r); P[NRX] = 0.12 + 0.1 * (1 - r);
  }
  function poseBall(P) {
    zero(P);
    P[PLANT] = 0; P[BY] = BALL_Y - 0.1; P[BZ] = 0.16;
    P[BRX] = -0.25; P[SRX] = -0.65; P[NRX] = -0.45;
    P[LLX] = 2.05; P[LRX] = 2.05; P[KL] = -2.45; P[KR] = -2.45; P[LLZ] = -0.1; P[LRZ] = 0.1;
    P[ALX] = 1.05; P[ARX] = 1.05; P[EL] = 1.75; P[ER] = 1.75; P[ALZ] = -0.22; P[ARZ] = 0.22; P[ALY] = 0.3; P[ARY] = -0.3;
  }
  function poseBoard(P, t, lv) {
    zero(P);
    const sw = Math.sin(t * 2.3);
    P[PLANT] = 1; P[BY] = HIP_Y;
    P[BRY] = -1.12 + 0.05 * sw; P[BRX] = -0.08; P[BRZ] = 0.05 * lv;
    P[SRY] = 0.55; P[SRX] = -0.22; P[SRZ] = 0.04 * sw;
    P[NRY] = 0.5; P[NRX] = 0.25;
    P[LLX] = 0.5; P[KL] = -0.95; P[LLZ] = -0.34; P[LRX] = 0.42; P[KR] = -0.85; P[LRZ] = 0.36;
    P[ALZ] = -1.05 - 0.15 * sw - 0.3 * lv; P[ALX] = 0.45; P[EL] = 0.55;
    P[ARZ] = 0.95 - 0.15 * sw - 0.3 * lv; P[ARX] = -0.25; P[ER] = 0.65;
    P[BOB] = 0.012 * sw;
  }
  function poseBoardAir(P, t, u) {
    poseBoard(P, t, 0);
    const r = sstep(-0.35, 0.65, u);
    P[KL] -= 0.5 * r; P[KR] -= 0.5 * r; P[LLX] += 0.35 * r; P[LRX] += 0.35 * r;
    P[ALZ] -= 0.4 * r; P[ARZ] += 0.2; P[ARX] += 0.9 * r; P[ER] += 0.4 * r;
  }
  function poseBoardCrouch(P, t) {
    poseBoard(P, t, 0);
    P[KL] = -1.95; P[KR] = -1.85; P[LLX] = 1.35; P[LRX] = 1.25; P[SRX] = -0.55; P[NRX] = 0.45;
    P[ARX] = 0.9; P[ER] = 0.9; P[ARZ] = 0.5; P[ALZ] = -0.8;
  }
  function poseJet(P, t) {
    zero(P);
    const a = Math.sin(t * 2.3), b = Math.sin(t * 1.7 + 1);
    P[PLANT] = 0; P[BY] = HIP_Y;
    P[BRX] = -0.38 + 0.04 * b; P[BRZ] = 0.04 * a;
    P[SRX] = -0.08; P[NRX] = 0.42; P[NRY] = 0.12 * b;
    P[LLX] = -0.12 + 0.12 * a; P[KL] = -0.55 - 0.18 * a; P[LRX] = 0.12 - 0.12 * a; P[KR] = -0.85 + 0.18 * a;
    P[LLZ] = -0.08; P[LRZ] = 0.08;
    P[ALX] = 0.45; P[ALZ] = -0.42; P[EL] = 1.95; P[ALY] = -0.25;
    P[ARX] = 0.45; P[ARZ] = 0.42; P[ER] = 1.95; P[ARY] = 0.25;
  }
  function poseDeath(P, k) {
    zero(P);
    const f = sstep(0, 0.5, k);
    P[PLANT] = 0; P[BY] = HIP_Y;
    P[ALZ] = -0.6 - 0.9 * f; P[ALX] = 0.3 + 0.9 * f; P[EL] = 0.5;
    P[ARZ] = 0.6 + 0.8 * f; P[ARX] = 0.2 + 1.2 * f; P[ER] = 0.8;
    P[LLX] = -0.25 * f; P[KL] = -0.4 - 0.5 * f; P[LRX] = 0.25; P[KR] = -0.15; P[LLZ] = -0.14; P[LRZ] = 0.16;
    P[SRX] = 0.28 * f; P[NRX] = 0.3 * f; P[NRY] = 0.35 * f;
  }

  // foot plant: hips height that puts the lowest sole point on the surface
  function legDrop(a, b, z) {
    const th = a + b;
    const heel = -0.5 * Math.cos(th) - 0.075 * Math.sin(th);
    const toe = -0.49 * Math.cos(th) + 0.215 * Math.sin(th);
    return -(HIP_DY + (-THIGH * Math.cos(a) + Math.min(heel, toe)) * Math.cos(z));
  }

  // ground below the player (for the blob shadow, sleeper lift and clamp) — reads obstacle records, no allocation
  function groundBelow(pose) {
    if (pose.grounded) return pose.y || 0;
    let g = 0;
    const list = RR.obstacles && RR.obstacles.list;
    if (list && list.length) {
      const px = pose.x || 0, pz = pose.z || 0, py = pose.y || 0;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r || (r.type !== 'train' && r.type !== 'ramp')) continue;
        if (Math.abs((r.x || 0) - px) > 1.1 || pz > r.zF || pz < r.zB) continue;
        let top = r.top || C.TRAIN_H;
        if (r.type === 'ramp') top *= clamp((r.zF - pz) / Math.max(0.01, r.zF - r.zB), 0, 1);
        if (top <= py + 0.05 && top > g) g = top;
      }
    }
    return g;
  }

  // ground clamp: raise the root so no sampled vertex dips below the surface
  const clampList = [];
  function groundClamp(floorWorld) {
    let minY = Infinity;
    for (let m = 0; m < clampList.length; m++) {
      const me = clampList[m];
      if (!me.visible) continue;
      const s = me.geometry.userData.samples; if (!s) continue;
      const e = me.matrixWorld.elements;
      for (let i = 0; i < s.length; i += 3) { const y = e[1] * s[i] + e[5] * s[i + 1] + e[9] * s[i + 2] + e[13]; if (y < minY) minY = y; }
    }
    if (minY < floorWorld) { root.position.y += floorWorld - minY; root.updateMatrixWorld(true); return floorWorld - minY; }
    return 0;
  }

  // ------------------------------------------------------------------ events (faces)
  function onHappy(d) { A.happyT = Math.max(A.happyT, typeof d === 'number' ? d : 1.2); }
  function hookEvents() {
    RR.on('pickup', () => onHappy(1.3));
    RR.on('mission-done', () => onHappy(1.6));
    RR.on('level-up', () => onHappy(1.8));
    RR.on('new-best', () => onHappy(1.6));
    RR.on('near-miss', () => { A.winkT = 0.7; });
    RR.on('board-on', () => onHappy(0.9));
    RR.on('revive', () => { A.recover = true; });
  }

  // ------------------------------------------------------------------ update
  function update(dt, pose) {
    if (!inited || !pose) return;
    dt = clamp(dt || 0, 0, 0.1);
    const st = pose.state || 'run';
    group.position.set(pose.x || 0, pose.y || 0, pose.z || 0);
    const dead = st === 'dying' || st === 'revive' || st === 'over';
    if (dead) { A.deadLatch = true; A.deathK = Math.max(A.deathK, pose.deathT || 0); A.recover = false; }
    else if (A.deadLatch) { A.deadLatch = false; A.recover = true; A.deathK = 0; }
    if (st === 'run') A.recover = false;
    // pause: freeze everything unless we are getting back up after a revive
    if (st === 'paused' && !A.recover) { A.prevState = st; return; }
    A.t += dt;
    const t = A.t;
    const speed = pose.speed || 0;
    const title = st === 'title' || (st === 'paused' && A.recover);
    const running = st === 'run';

    // --- takeoff / landing
    const grounded = !!pose.grounded || !running;
    const jet = running && !!pose.jetpack;
    const board = !!pose.board && !jet && !dead;
    const rolling = running && !!pose.rolling && !jet;
    if (running && !jet) {
      if (A.wasGrounded && !grounded) {
        A.jumpVy0 = Math.max(1, pose.vy || 0);
        const sup = (pose.vy || 0) > 20 || !!pose.superJump;
        A.flipping = sup && !board && (pose.vy || 0) > 5;
        A.boardSpin = sup && board;
        A.flipBase = spinBase(A.spin); A.yawBase = spinBase(A.yawSpin);
        A.lead = Math.sin(A.ph) > 0 ? 1 : -1;
        if ((pose.vy || 0) > 5) A.sqV += 2.4;
      }
      if (!A.wasGrounded && grounded) {
        A.landImpact = clamp(-A.airVy / 26, 0.15, 1);
        A.sqV -= 3.6 * A.landImpact; A.landK = 1;
        A.flipping = false; A.boardSpin = false;
      }
    }
    if (!grounded) A.airVy = pose.vy || 0;
    A.wasGrounded = grounded;
    const flipP = clamp((A.jumpVy0 - (pose.vy || 0)) / (2 * A.jumpVy0), 0, 1.3);
    if (rolling && !A.wasRolling) A.rollBase = spinBase(A.spin);
    A.wasRolling = rolling;

    // --- timers
    A.ph += dt * TAU * (running ? 1.55 + speed * 0.036 : 0.9);
    if (A.ph > TAU * 1000) A.ph -= TAU * 1000;
    A.landK = Math.max(0, A.landK - dt * 4.5);
    A.happyT = Math.max(0, A.happyT - dt); A.winkT = Math.max(0, A.winkT - dt);
    A.blinkIn -= dt; if (A.blinkIn <= 0) { A.blinkT = 0.13; A.blinkIn = 3 + Math.random() * 1.2; }
    A.blinkT = Math.max(0, A.blinkT - dt);
    if (title) {
      A.lookT -= dt;
      if (A.lookT <= 0) { A.lookT = 1.6 + Math.random() * 2.4; const r = Math.random(); A.lookTargetY = r < 0.35 ? 0 : (Math.random() - 0.5) * 1.3; A.lookTargetP = (Math.random() - 0.4) * 0.25; }
      A.waveIn -= dt;
      if (A.waveIn <= 0 && A.waveT <= 0) { A.waveT = 2.1; A.waveIn = 6 + Math.random() * 4; }
    }
    A.waveT = Math.max(0, A.waveT - dt);
    const waving = title && A.waveT > 0;
    A.lookYaw = damp(A.lookYaw, waving ? 0 : A.lookTargetY, 3.2, dt);
    A.lookPitch = damp(A.lookPitch, waving ? -0.05 : A.lookTargetP, 3.2, dt);
    A.waveW = damp(A.waveW, waving && A.waveT > 0.25 ? 1 : 0, 7, dt);

    // --- pose targets
    WT.fill(0);
    let lam = 13;
    if (dead) { WT[P_DEATH] = 1; lam = 18; }
    else if (title) WT[P_IDLE] = 1;
    else if (!running) WT[P_IDLE] = 1;
    else if (jet) { WT[P_JET] = 1; lam = 8; }
    else if (board) {
      if (rolling) WT[P_BCROUCH] = 1;
      else if (!grounded) WT[P_BAIR] = 1;
      else WT[P_BOARD] = 1;
    } else if (rolling) { WT[(pose.rollT || 0) < 0.86 ? P_BALL : P_RUN] = 1; lam = 24; }
    else if (!grounded) {
      if (A.flipping && flipP > 0.03 && flipP < 0.7) { WT[P_BALL] = 1; lam = 20; } else WT[P_AIR] = 1;
    } else WT[P_RUN] = 1;
    let sum = 0;
    for (let i = 0; i < NP; i++) { W[i] = damp(W[i], WT[i], lam, dt); if (W[i] < 1e-4) W[i] = 0; sum += W[i]; }
    if (sum < 1e-6) { W[P_IDLE] = 1; sum = 1; }

    // --- compute the needed poses and blend
    const u = clamp((pose.vy || 0) / 16, -1, 1);
    if (W[P_IDLE]) poseIdle(POSES[P_IDLE], t);
    if (W[P_RUN]) poseRun(POSES[P_RUN], A.ph, speed);
    if (W[P_AIR]) poseAir(POSES[P_AIR], u, A.lead);
    if (W[P_BALL]) poseBall(POSES[P_BALL]);
    if (W[P_BOARD]) poseBoard(POSES[P_BOARD], t, pose.laneVel || 0);
    if (W[P_BAIR]) poseBoardAir(POSES[P_BAIR], t, u);
    if (W[P_BCROUCH]) poseBoardCrouch(POSES[P_BCROUCH], t);
    if (W[P_JET]) poseJet(POSES[P_JET], t);
    if (W[P_DEATH]) poseDeath(POSES[P_DEATH], A.deathK);
    OUT.fill(0);
    for (let p = 0; p < NP; p++) {
      const w = W[p] / sum; if (!w) continue;
      const P = POSES[p];
      for (let c = 0; c < NCH; c++) OUT[c] += P[c] * w;
    }

    // --- overlays
    const lv = running ? pose.laneVel || 0 : 0;
    A.bank = damp(A.bank, -0.26 * lv, 10, dt);
    OUT[BRY] += -0.2 * lv * (1 - W[P_BALL] / sum);
    OUT[NRY] += 0.14 * lv;
    // stumble flail
    A.stumbleW = damp(A.stumbleW, running && (pose.stumbleT || 0) > 0.02 ? 1 : 0, 16, dt);
    if (A.stumbleW > 0.01) {
      const w = A.stumbleW, f = t * 21;
      OUT[ALX] += 1.3 * Math.sin(f) * w; OUT[ALZ] -= 0.9 * w; OUT[EL] -= 0.6 * w;
      OUT[ARX] += 1.3 * Math.sin(f + 2.1) * w; OUT[ARZ] += 0.9 * w; OUT[ER] -= 0.6 * w;
      OUT[SRX] += 0.32 * w; OUT[NRX] -= 0.1 * w; OUT[NRZ] += 0.15 * Math.sin(t * 17) * w; OUT[BRZ] += 0.1 * Math.sin(t * 13) * w;
    }
    // magnet in the right hand
    A.magW = damp(A.magW, running && pose.magnet && !dead ? 1 : 0, 8, dt);
    if (A.magW > 0.01) {
      const w = A.magW * (1 - W[P_BALL] / sum);
      OUT[ARX] += (1.25 + 0.06 * Math.sin(t * 9) - OUT[ARX]) * w; OUT[ARZ] += (0.22 - OUT[ARZ]) * w; OUT[ARY] += (0 - OUT[ARY]) * w; OUT[ER] += (0.35 - OUT[ER]) * w;
    }
    // celebrate: left fist pump
    A.celebW = damp(A.celebW, pose.celebrate && !dead ? 1 : 0, 8, dt);
    if (A.celebW > 0.01) {
      const w = A.celebW;
      OUT[ALZ] += (-2.5 - OUT[ALZ]) * w; OUT[ALX] += (0.3 - OUT[ALX]) * w; OUT[EL] += (1.2 + 0.5 * Math.sin(t * 12) - OUT[EL]) * w;
    }
    // title wave (right arm)
    if (A.waveW > 0.01) {
      const w = A.waveW;
      OUT[ARZ] += (2.55 - OUT[ARZ]) * w; OUT[ARX] += (0.25 - OUT[ARX]) * w; OUT[ARY] += (-0.4 - OUT[ARY]) * w; OUT[ER] += (0.55 + 0.45 * Math.sin(t * 11) - OUT[ER]) * w;
      OUT[SRZ] += -0.05 * w;
    }
    // landing dip
    const dip = A.landK > 0 ? Math.sin(PI * (1 - A.landK)) * 0.45 * A.landImpact : 0;
    OUT[KL] -= dip; OUT[KR] -= dip; OUT[LLX] += dip * 0.5; OUT[LRX] += dip * 0.5; OUT[SRX] -= dip * 0.35;

    // --- hips height (foot plant) and spin
    const dropL = legDrop(OUT[BRX] + OUT[LLX], OUT[KL], OUT[LLZ]), dropR = legDrop(OUT[BRX] + OUT[LRX], OUT[KR], OUT[LRZ]);
    const plantH = Math.max(dropL, dropR);
    const hipsY = OUT[BY] + (plantH - OUT[BY]) * OUT[PLANT] + OUT[BOB];
    let spinT;
    if (rolling && !board) spinT = A.rollBase - TAU * sstep(0.1, 0.84, pose.rollT || 0);
    else if (A.flipping && !grounded) spinT = A.flipBase - TAU * sstep(0.05, 0.72, flipP);
    else spinT = settleTurn(A.spin);
    A.spin = damp(A.spin, spinT, 26, dt);
    if (!rolling && !(A.flipping && !grounded) && Math.abs(A.spin - spinT) < 0.01) A.spin = 0;
    let yawT = 0;
    if (A.boardSpin && !grounded) yawT = A.yawBase - TAU * sstep(0.05, 0.75, flipP); else yawT = settleTurn(A.yawSpin);
    A.yawSpin = damp(A.yawSpin, yawT, 20, dt);
    if (!(A.boardSpin && !grounded) && Math.abs(A.yawSpin - yawT) < 0.01) A.yawSpin = 0;

    // --- surface / lift
    const gy = groundBelow(pose);
    A.groundY = gy;
    const surf = RR.track && RR.track.SURF ? RR.track.SURF.SLEEPER_Y || 0 : 0;
    const onTrack = Math.abs(pose.x || 0) < 4.2 ? 1 : 0;
    A.liftSleeper = damp(A.liftSleeper, surf * onTrack * (1 - sstep(0.05, 0.6, gy)) * (jet ? 0 : 1), 12, dt);
    A.boardW = damp(A.boardW, board ? 1 : 0, board ? 9 : 12, dt);
    const bw = A.boardW < 0.002 ? 0 : A.boardW;
    const bob = bw ? 0.03 * Math.sin(t * 3.1) + 0.012 * Math.sin(t * 7.3) : 0;
    const boardLift = (BOARD_H + bob) * sstep(0, 0.6, bw);

    // --- squash spring (sub-stepped)
    let rem = dt;
    while (rem > 1e-6) { const h = Math.min(rem, 1 / 120); rem -= h; A.sqV += (-320 * A.sq - 17 * A.sqV) * h; A.sq += A.sqV * h; }
    A.sq = clamp(A.sq, -0.3, 0.3);
    const sy = 1 + A.sq, sxz = 1 / Math.sqrt(sy);

    // --- apply to the rig
    const wd = W[P_DEATH] / sum;
    const dk = A.deathK;
    const fall = sstep(0, 0.42, dk), slide = 1 - Math.pow(1 - clamp(dk / 0.55, 0, 1), 3);
    const hop = 0.45 * Math.sin(PI * clamp(dk / 0.42, 0, 1)) + 0.06 * Math.sin(PI * clamp((dk - 0.42) / 0.22, 0, 1));
    root.position.set(0, A.liftSleeper + boardLift + hop * wd, 0.95 * slide * wd);
    root.rotation.set(1.42 * fall * wd, A.yawSpin, A.bank * (1 - wd));
    root.scale.set(sxz, sy, sxz);
    const ballW = W[P_BALL] / sum;
    const spinY = SPIN_STAND + (BALL_Y - SPIN_STAND) * ballW;
    spinO.position.y = spinY; spinO.rotation.x = A.spin;
    body.position.set(0, hipsY - spinY, OUT[BZ]);
    body.rotation.set(OUT[BRX], OUT[BRY], OUT[BRZ]);
    spineO.rotation.set(OUT[SRX], OUT[SRY], OUT[SRZ]);
    neckO.rotation.set(OUT[NRX], OUT[NRY], OUT[NRZ]);
    shLO.rotation.set(OUT[ALX], OUT[ALY], OUT[ALZ]); elLO.rotation.x = OUT[EL];
    shRO.rotation.set(OUT[ARX], OUT[ARY], OUT[ARZ]); elRO.rotation.x = OUT[ER];
    hipLO.rotation.set(OUT[LLX], OUT[LLY], OUT[LLZ]); knLO.rotation.x = OUT[KL];
    hipRO.rotation.set(OUT[LRX], OUT[LRY], OUT[LRZ]); knRO.rotation.x = OUT[KR];

    // secondary motion (hair / scarf / coat tails)
    if (mSwing.visible) {
      const tx = clamp(-(0.25 + speed * 0.014) + (running && !grounded ? (pose.vy || 0) * 0.018 : 0) + 0.1 * Math.sin(2 * A.ph) * W[P_RUN] / sum - (jet ? 0.5 : 0), -1.6, 0.05);
      const tz = clamp(-lv * 0.5 + 0.08 * Math.sin(A.ph) * W[P_RUN] / sum, -0.8, 0.8);
      let r2 = dt;
      while (r2 > 1e-6) { const h = Math.min(r2, 1 / 120); r2 -= h; A.swingVX += (120 * (tx - A.swingX) - 9 * A.swingVX) * h; A.swingX += A.swingVX * h; A.swingVZ += (120 * (tz - A.swingZ) - 9 * A.swingVZ) * h; A.swingZ += A.swingVZ * h; }
      swingO.rotation.set(A.swingX, 0, A.swingZ);
    }

    // --- accessories
    A.jetW = damp(A.jetW, jet ? 1 : 0, jet ? 10 : 7, dt);
    const jw = A.jetW < 0.01 ? 0 : A.jetW;
    mJet.visible = jw > 0;
    if (jw) mJet.scale.setScalar(0.5 + 0.5 * sstep(0, 1, jw));
    const y01 = clamp(pose.jetpackY01 || 0, 0, 1);
    A.jetRise = damp(A.jetRise, dt > 0 ? clamp((y01 - A.jetY01) / dt, -2, 2) : 0, 8, dt);
    A.jetY01 = y01;
    mFlames.visible = jet && jw > 0.3;
    if (mFlames.visible) {
      const fu = flameMat.uniforms;
      fu.uTime.value = t; fu.uLen.value = 0.78 + 0.35 * clamp(A.jetRise, 0, 2) - 0.2 * clamp(-A.jetRise, 0, 2) + 0.08 * Math.sin(t * 5);
      fu.uAlpha.value = clamp((jw - 0.3) / 0.4, 0, 1);
    }
    boardRoot.visible = bw > 0;
    if (bw) {
      const bs = sstep(0, 1, bw);
      boardRoot.position.set(0, A.liftSleeper + boardLift, root.position.z);
      boardRoot.rotation.set(clamp(-(pose.vy || 0) * 0.012, -0.25, 0.25) * (grounded ? 0 : 1) + 0.03 * Math.sin(t * 2.2), A.yawSpin, A.bank * 1.25 + 0.03 * Math.sin(t * 1.7));
      boardRoot.scale.setScalar(0.3 + 0.7 * bs);
      mHover.material.opacity = (0.55 + 0.2 * Math.sin(t * 9)) * bs * (grounded ? 1 : 0.6);
    }
    mMagnet.visible = A.magW > 0.02;
    if (mMagnet.visible) mMagnet.scale.setScalar(A.magW);
    mField.visible = A.magW > 0.02;
    if (mField.visible) { mField.rotation.set(0.15 * Math.sin(t * 1.3), t * 2.4, 0.1 * Math.cos(t * 1.1)); fieldMat.opacity = 0.9 * A.magW * (0.8 + 0.2 * Math.sin(t * 6)); mField.scale.setScalar(0.9 + 0.1 * A.magW); }

    // --- world matrices, ground clamp, blob
    group.updateMatrixWorld(true);
    const floorLocal = (jet ? -99 : gy - (pose.y || 0)) + A.liftSleeper + (bw ? boardLift * 0.98 : 0);
    if (!jet) groundClamp((pose.y || 0) + floorLocal + 0.004);
    const hAbove = Math.max(0, (pose.y || 0) - gy);
    const shadowsOn = !!(quality && quality.shadows);
    mBlob.position.set(0, gy - (pose.y || 0) + A.liftSleeper + 0.012, root.position.z * 0.8);
    mBlob.scale.setScalar((1 + hAbove * 0.12) * (bw ? 1.25 : 1) * (1 + 0.25 * W[P_DEATH] / sum));
    blobMat.opacity = (shadowsOn ? 0.45 : 0.95) * clamp(1 - hAbove / 5, 0, 1) * (jet ? 0.4 : 1);
    mBlob.visible = blobMat.opacity > 0.02;

    // --- smoke
    updateSmoke(dt, jet && jw > 0.5);

    // --- uniforms: glow boost, rim, shoes, flash, face
    const boost = RR.mats && RR.mats.glow ? Math.max(1, RR.mats.glow.color.r) : 1;
    U.uGlow.value = boost;
    flameMat.uniforms.uBoost.value = boost * 1.15;
    fieldMat.color.setScalar(boost);
    hoverMat.color.set(curBoard ? curBoard.bs.hover : 0xff6fc0).multiplyScalar(boost);
    const at = RR.atmo;
    if (at && at.hemiSky) {
      const g01 = clamp((at.glow || 0) / 1.4, 0, 1);
      U.uRimCol.value.copy(at.hemiSky).lerp(at.cap || at.hemiSky, 0.55 * g01);
      U.uRim.value = 0.22 + 0.3 * g01;
      smokeMat.uniforms.uCol.value.copy(at.cloud || U.uRimCol.value).lerp(_c2.setRGB(1, 1, 1), 0.55);
    }
    A.shoeW = damp(A.shoeW, running && pose.sneakers && !dead ? 1 : 0, 7, dt);
    U.uShoe.value = A.shoeW * (0.75 + 0.35 * Math.sin(t * 9)) * boost;
    A.flash = running && pose.invulnerable ? (Math.sin(t * TAU * 7) > 0 ? 0.55 : 0.04) : damp(A.flash, 0, 20, dt);
    U.uFlash.value = A.flash;
    if (smoke.visible && camera && renderer) {
      const h = renderer.domElement.height || 540;
      smokeMat.uniforms.uScale.value = h / (2 * Math.tan((camera.fov * D2R) / 2));
      smokeMat.uniforms.uMaxPx.value = h * 0.09;
    }
    let face = FACE.neutral;
    if (dead) face = A.deathK < 0.35 ? FACE.surprised : FACE.dizzy;
    else if (A.stumbleW > 0.3) face = FACE.surprised;
    else if (A.winkT > 0) face = FACE.wink;
    else if (A.happyT > 0 || A.celebW > 0.3 || (title && A.waveW > 0.2) || jet || (A.flipping && !grounded)) face = FACE.happy;
    else if (A.blinkT > 0) face = FACE.blink;
    else if (running && (speed > 38 || W[P_BALL] / sum > 0.5)) face = FACE.focused;
    setFace(face);
    A.prevState = st;
  }

  // ------------------------------------------------------------------ lifecycle
  function init(ctx) {
    if (inited) return;
    scene = ctx.scene; renderer = ctx.renderer; camera = ctx.camera; quality = ctx.quality || quality;
    RR.getMats();
    atlas = buildAtlas();
    buildMaterials();
    buildRig();
    clampList.length = 0;
    for (let i = 0; i < charMeshes.length; i++) clampList.push(charMeshes[i]);
    inited = true;
    applySkin(pendingSkin); applyBoard(pendingBoard);
    setQuality(quality);
    hookEvents();
    setFace(FACE.neutral);
    api.group = group;
  }
  function reset(pz) {
    if (!inited) return;
    group.position.set(0, 0, pz || 0);
    W.fill(0); W[P_IDLE] = 1;
    A.spin = 0; A.yawSpin = 0; A.sq = 0; A.sqV = 0; A.landK = 0; A.bank = 0; A.flipping = false; A.boardSpin = false;
    A.wasGrounded = true; A.wasRolling = false; A.deathK = 0; A.deadLatch = false; A.recover = false;
    A.boardW = 0; A.jetW = 0; A.magW = 0; A.shoeW = 0; A.stumbleW = 0; A.celebW = 0; A.flash = 0; A.liftSleeper = 0;
    A.swingX = -0.4; A.swingVX = 0; A.swingZ = 0; A.swingVZ = 0;
    clearSmoke();
  }
  function setQuality(q) {
    quality = q || quality;
    if (!inited) return;
    const sh = !!quality.shadows;
    for (let i = 0; i < charMeshes.length; i++) charMeshes[i].castShadow = sh;
    mBoard.castShadow = sh; mJet.castShadow = sh; mMagnet.castShadow = sh;
    smokeCap = Math.max(10, Math.min(SMOKE_N, Math.round(SMOKE_N * Math.max(0.35, quality.particles || 1))));
    clearSmoke();
  }
  function setSkin(id) {
    pendingSkin = STY[id] ? id : 'nova';
    if (inited) applySkin(pendingSkin);
    return pendingSkin;
  }
  function setBoard(id) {
    pendingBoard = BST[id] ? id : 'classic';
    if (inited) applyBoard(pendingBoard);
    return pendingBoard;
  }
  const _av = new THREE.Vector3();
  function anchor(name, out) {
    const o = anchors[name]; out = out || _av;
    if (!o) return null;
    return o.getWorldPosition(out);
  }

  const api = {
    SKINS, BOARDS, group: null,
    init, reset, update, setQuality, setSkin, setBoard,
    anchor, // anchor('handL'|'handR'|'footL'|'footR'|'nozzleL'|'nozzleR'|'head'|'board', outVec3) -> world position
    get skin() { return curSkin ? curSkin.id : pendingSkin; },
    get board() { return pendingBoard; },
    _debug: { A, W, OUT, charMeshes: () => charMeshes, clampList, skinCache, boardCache, face: () => A.face, groundClamp }
  };
  RR.register('player', api);
})(window.RR);
