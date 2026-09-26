/* Rainbow Rails — core
 * Namespace, constants, maths helpers, persistence, events, world data, the shared
 * atmosphere state, canvas textures and the geometry helpers every other module uses.
 * Loaded first; every other file is an IIFE that reads and extends window.RR.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  RR.VERSION = 2;

  // ------------------------------------------------------------------ constants
  const C = (RR.C = {
    LANES: [-2.6, 0, 2.6],
    LANE_W: 2.6,
    // Track corridor: nothing that is not part of the track may come closer than
    // this to x = 0 below OVERHEAD_CLEAR (bridges, gates and arches span above it).
    CORRIDOR: 6.5,
    OVERHEAD_CLEAR: 11,
    WORLD_LEN: 1000, // metres per world; worlds cycle forever
    SPAWN_AHEAD: 520, // content exists from the player to this far ahead
    DESPAWN_BEHIND: 40, // and is removed once this far behind the player
    TRAIN_H: 3.0, // walkable roof height of every train
    RAMP_L: 7,
    G: 62,
    JUMP_V: 18.5,
    SUPER_JUMP_V: 23.5,
    JETPACK_Y: 7.5, // feet height while flying
    BASE_SPEED: 22,
    MAX_SPEED: 50,
    FIXED_DT: 1 / 120,
    FOG_FAR: 640,
    CAMERA_FAR: 1600,
    SKY_RADIUS: 1100
  });

  // ------------------------------------------------------------------ maths
  const rnd = Math.random;
  RR.rand = (a, b) => a + rnd() * (b - a);
  RR.randInt = (a, b) => Math.floor(a + rnd() * (b - a + 1)); // inclusive
  RR.pick = (arr) => arr[(rnd() * arr.length) | 0];
  RR.chance = (p) => rnd() < p;
  RR.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  RR.lerp = (a, b, t) => a + (b - a) * t;
  RR.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt)); // frame-rate independent smoothing
  RR.smoothstep = (a, b, x) => { const t = RR.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  RR.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
  // Seeded generator (mulberry32) for anything that must repeat, e.g. per-chunk layouts.
  RR.makeRng = (seed) => {
    let s = seed >>> 0;
    const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { next, range: (a, b) => a + next() * (b - a), pick: (arr) => arr[(next() * arr.length) | 0], chance: (p) => next() < p };
  };
  RR.worldIndexAt = (z) => Math.floor(Math.max(0, -z) / C.WORLD_LEN) % RR.WORLDS.length; // z is world z (player runs toward -z)
  RR.worldStartZ = (k) => -k * C.WORLD_LEN; // k = absolute world count (0, 1, 2, ...), not the cycled index

  // ------------------------------------------------------------------ events
  const handlers = {};
  RR.on = (name, fn) => { (handlers[name] || (handlers[name] = [])).push(fn); return () => RR.off(name, fn); };
  RR.off = (name, fn) => { const l = handlers[name]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
  RR.emit = (name, data) => { const l = handlers[name]; if (l) for (const fn of l.slice()) { try { fn(data); } catch (e) { console.error('[RR] handler for ' + name + ' failed', e); } } };

  // ------------------------------------------------------------------ persistence
  const SAVE_KEY = 'rr2-save';
  const DEFAULT_SAVE = () => ({
    v: 2,
    best: 0, // best score
    bestDist: 0, // furthest metres
    bank: 0, // coins available to spend
    totalCoins: 0,
    runs: 0,
    skin: 'nova',
    owned: ['nova'],
    boards: 2, // hoverboards in stock (a board absorbs one crash)
    missions: null, // owned by the mission system in game.js
    missionLevel: 1,
    history: [], // last runs: { score, dist, coins, world }
    settings: { quality: 'auto', sound: true, music: true },
    tutorialDone: false
  });
  function deepMerge(base, over) {
    if (!over || typeof over !== 'object') return base;
    for (const k of Object.keys(over)) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) deepMerge(base[k], over[k]);
      else base[k] = over[k];
    }
    return base;
  }
  RR.store = {
    data: DEFAULT_SAVE(),
    load() {
      try { const raw = localStorage.getItem(SAVE_KEY); if (raw) this.data = deepMerge(DEFAULT_SAVE(), JSON.parse(raw)); } catch (e) { this.data = DEFAULT_SAVE(); }
      return this.data;
    },
    save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* storage unavailable: progress lives for this visit only */ } },
    reset() { this.data = DEFAULT_SAVE(); this.save(); }
  };
  RR.store.load();

  // ------------------------------------------------------------------ worlds (data only)
  // Colour tokens are hex numbers. Modules may add their own per-kind data keyed by `kind`.
  RR.WORLDS = [
    {
      id: 'sunset', kind: 'city', name: 'Sunset Boulevard', sub: 'Golden-hour rooftops and warm windows', cssColor: '#ff8a5b',
      musicKey: 0, wave: 'triangle', night: false,
      skyTop: 0x3d2f8f, skyMid: 0xc85c9c, horizon: 0xffa27a, sun: 0xfff0c8, sunElev: 0.1,
      ground: 0xd98a72, groundAlt: 0xb86a5e, ballast: 0x7d5a7a, sleeper: 0x4e3550, rail: 0xffe3cf,
      mount: 0x8e5f9e, cap: 0xffb6a0, light: 0xffd6ad, hemiSky: 0xffc9b0, hemiGround: 0x6b4a7a, cloud: 0xffc9b5, water: 0x5f7fd0,
      accents: [0xff9aa2, 0xffd6a5, 0xcaffbf, 0x9bf6ff, 0xa0c4ff, 0xbdb2ff, 0xffc6ff, 0xfdffb6],
      stars: 0.1, rainbow: 0.12, glow: 0.8, dirI: 0.95, hemiI: 0.8, bloom: 0.55, particles: 'motes'
    },
    {
      id: 'coast', kind: 'beach', name: 'Palm Coast', sub: 'Ocean on your left, palms on your right', cssColor: '#3dd9c1',
      musicKey: 2, wave: 'triangle', night: false,
      skyTop: 0x1f7fe0, skyMid: 0x6cc3f5, horizon: 0xc7f2ff, sun: 0xffffff, sunElev: 0.35,
      ground: 0xf5d9a0, groundAlt: 0xe8c486, ballast: 0xc7a47a, sleeper: 0x8a6446, rail: 0xf4f4f4,
      mount: 0x2fae8f, cap: 0x9ee6b8, light: 0xffffff, hemiSky: 0xd8f6ff, hemiGround: 0xc9a06a, cloud: 0xffffff, water: 0x1fb8d6,
      accents: [0xff5a5f, 0x3fa7ff, 0xffc233, 0x2ec27e, 0xff7ac6],
      stars: 0, rainbow: 0.38, glow: 0, dirI: 1.0, hemiI: 0.78, bloom: 0.35, particles: 'none'
    },
    {
      id: 'candy', kind: 'candy', name: 'Candy Canyon', sub: 'Lollipop forests and frosted peaks', cssColor: '#ff6fb5',
      musicKey: 5, wave: 'sine', night: false,
      skyTop: 0xff6fb5, skyMid: 0xffa6d4, horizon: 0xffe6f4, sun: 0xfffbe0, sunElev: 0.25,
      ground: 0xffc2e0, groundAlt: 0xffa8d2, ballast: 0xb98ad6, sleeper: 0x8a5fb0, rail: 0xffffff,
      mount: 0xb06ee8, cap: 0xffffff, light: 0xfff0f8, hemiSky: 0xffe0f0, hemiGround: 0xc08ad0, cloud: 0xfff0fa, water: 0x8a4b2a,
      accents: [0xff5fa2, 0x5ee0c8, 0xffd84d, 0xa87bff, 0xff8a5b, 0x7fd6ff],
      stars: 0, rainbow: 0.5, glow: 0, dirI: 0.9, hemiI: 0.85, bloom: 0.45, particles: 'confetti'
    },
    {
      id: 'neon', kind: 'neon', name: 'Neon Night', sub: 'Glow rings and midnight towers', cssColor: '#7c5cff',
      musicKey: -3, wave: 'square', night: true,
      skyTop: 0x05021a, skyMid: 0x2a0b55, horizon: 0x5b1a8e, sun: 0xff5fd2, sunElev: 0.06,
      ground: 0x1d1240, groundAlt: 0x140c30, ballast: 0x2a1d55, sleeper: 0x120a2a, rail: 0x5ef2ff,
      mount: 0x2b1260, cap: 0xff4fd8, light: 0xb3a4ff, hemiSky: 0x7a62d9, hemiGround: 0x1a0f3a, cloud: 0x3a2470, water: 0x1a0f3a,
      accents: [0xff3fd2, 0x39f0ff, 0xffe14d, 0x7cff6b],
      stars: 1, rainbow: 0, glow: 1.4, dirI: 0.55, hemiI: 0.75, bloom: 1.1, particles: 'glow'
    },
    {
      id: 'frost', kind: 'snow', name: 'Frost Peaks', sub: 'Pine valleys under falling snow', cssColor: '#9fd3ff',
      musicKey: -1, wave: 'triangle', night: false,
      skyTop: 0x4f86d6, skyMid: 0x9cc3ee, horizon: 0xeaf4ff, sun: 0xfffdf0, sunElev: 0.2,
      ground: 0xf2f7ff, groundAlt: 0xdde8f7, ballast: 0x8ea3c2, sleeper: 0x5b6c86, rail: 0xdde8ff,
      mount: 0xc9d9ef, cap: 0xffffff, light: 0xffffff, hemiSky: 0xeaf2ff, hemiGround: 0x9fb3cf, cloud: 0xffffff, water: 0xa9d6f5,
      accents: [0xff3b5c, 0x3fa7ff, 0x2fbf71, 0xffc233],
      stars: 0.15, rainbow: 0.2, glow: 0.3, dirI: 0.9, hemiI: 0.8, bloom: 0.4, particles: 'snow'
    }
  ];

  // ------------------------------------------------------------------ atmosphere
  // One shared, smoothly blended copy of the current world's lighting/colour tokens.
  // game.js calls RR.atmoUpdate every frame; sky, lights, fog and far layers read RR.atmo.
  RR.ATMO_COLORS = ['skyTop', 'skyMid', 'horizon', 'sun', 'mount', 'cap', 'light', 'hemiSky', 'hemiGround', 'cloud', 'water'];
  RR.ATMO_SCALARS = ['stars', 'rainbow', 'glow', 'dirI', 'hemiI', 'bloom', 'sunElev'];
  let atmoTargets = null;
  function buildAtmoTargets() {
    atmoTargets = RR.WORLDS.map((w) => {
      const o = {};
      RR.ATMO_COLORS.forEach((k) => (o[k] = new THREE.Color(w[k])));
      RR.ATMO_SCALARS.forEach((k) => (o[k] = w[k]));
      return o;
    });
  }
  RR.atmo = null;
  RR.atmoSet = (index) => {
    if (!atmoTargets) buildAtmoTargets();
    const t = atmoTargets[index];
    if (!RR.atmo) { RR.atmo = { index }; RR.ATMO_COLORS.forEach((k) => (RR.atmo[k] = t[k].clone())); }
    RR.ATMO_COLORS.forEach((k) => RR.atmo[k].copy(t[k]));
    RR.ATMO_SCALARS.forEach((k) => (RR.atmo[k] = t[k]));
    RR.atmo.index = index;
  };
  RR.atmoUpdate = (dt, index, rate) => {
    if (!RR.atmo) RR.atmoSet(index);
    const t = atmoTargets[index], k = 1 - Math.exp(-(rate || 1.2) * dt);
    RR.ATMO_COLORS.forEach((key) => RR.atmo[key].lerp(t[key], k));
    RR.ATMO_SCALARS.forEach((key) => (RR.atmo[key] += (t[key] - RR.atmo[key]) * k));
    RR.atmo.index = index;
  };

  // ------------------------------------------------------------------ quality tiers
  // game.js picks the tier (settings.quality or auto) and calls every module's setQuality(tier).
  RR.QUALITY = {
    high: { name: 'high', pixelRatio: 2, shadows: true, shadowMap: 2048, post: true, bloom: true, density: 1, particles: 1, far: 1 },
    medium: { name: 'medium', pixelRatio: 1.5, shadows: true, shadowMap: 1024, post: true, bloom: true, density: 0.75, particles: 0.6, far: 0.8 },
    low: { name: 'low', pixelRatio: 1, shadows: false, shadowMap: 512, post: false, bloom: false, density: 0.5, particles: 0.35, far: 0.6 }
  };
  RR.quality = RR.QUALITY.high;

  // ------------------------------------------------------------------ canvas textures
  RR.maxAniso = 4; // set from renderer.capabilities in game.js before textures are built
  RR.canvasTex = (w, h, draw, repeat) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = RR.maxAniso;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  RR.roundRect = (x, X, Y, W, H, r) => {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
    x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
  };
  RR.hex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
  RR.FONT_DISPLAY = '"Lilita One", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  RR.FONT_UI = '"Fredoka", "Nunito", "Segoe UI", system-ui, sans-serif';

  // ------------------------------------------------------------------ geometry helpers
  // Prop: bake a low-poly object from primitives into ONE non-indexed, vertex-coloured
  // BufferGeometry ("solid", lit) plus an optional "glow" geometry (unlit, blooms).
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _c = new THREE.Color(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  class Prop {
    constructor() { this.solid = []; this.glow = []; }
    // pos [x,y,z]; rot [x,y,z,(order)]; scale [x,y,z] or number
    add(geo, color, pos, rot, scale, glow) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, (rot && rot[3]) || 'XYZ');
      _q.setFromEuler(_e);
      if (typeof scale === 'number') _s.set(scale, scale, scale); else _s.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
      _m.compose(_p.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _q, _s);
      g.applyMatrix4(_m);
      _c.set(color);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      (glow ? this.glow : this.solid).push(g);
      return this;
    }
    build() { return { solid: RR.mergeGeos(this.solid), glow: RR.mergeGeos(this.glow) }; }
  }
  RR.Prop = Prop;
  // Merge non-indexed geometries that carry position + color (uv kept only if every part has it).
  RR.mergeGeos = (list) => {
    if (!list || !list.length) return null;
    let n = 0; let hasUv = true;
    list.forEach((g) => { n += g.attributes.position.count; if (!g.attributes.uv) hasUv = false; });
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = hasUv ? new Float32Array(n * 2) : null;
    let o = 0, ou = 0;
    list.forEach((g) => {
      pos.set(g.attributes.position.array, o);
      if (g.attributes.color) col.set(g.attributes.color.array, o); else col.fill(1, o, o + g.attributes.position.count * 3);
      if (uv) { uv.set(g.attributes.uv.array, ou); ou += g.attributes.uv.count * 2; }
      o += g.attributes.position.count * 3;
      g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals(); // non-indexed => flat, faceted shading
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  };
  RR.G = {
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    cyl: (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg || 7),
    cone: (r, h, seg) => new THREE.ConeGeometry(r, h, seg || 7),
    ico: (r, d) => new THREE.IcosahedronGeometry(r, d || 0),
    sph: (r, w, h) => new THREE.SphereGeometry(r, w || 8, h || 6),
    torus: (R, t, rs, ts, arc) => new THREE.TorusGeometry(R, t, rs || 6, ts || 24, arc),
    plane: (w, h) => new THREE.PlaneGeometry(w, h)
  };
  // Shared materials for baked props. Created lazily so THREE is ready.
  RR.mats = {};
  RR.getMats = () => {
    if (!RR.mats.prop) {
      RR.mats.prop = new THREE.MeshLambertMaterial({ vertexColors: true });
      RR.mats.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    }
    return RR.mats;
  };

  // InstancedPool: one draw call for every copy of a geometry. Slots are recycled.
  //   const pool = new RR.InstancedPool(geo, mat, 300, scene, { colors: true });
  //   const id = pool.add(x, y, z, rotY, scale);  pool.setColor(id, 0xff8800);  pool.remove(id);  pool.clear();
  // Instances are spread along the whole track, so frustum culling is disabled.
  const _obj = new THREE.Object3D();
  class InstancedPool {
    constructor(geo, mat, capacity, parent, opts) {
      this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
      if (opts && opts.colors) { // per-instance tint, multiplied with vertex colours; must exist before the first render
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      if (opts && opts.castShadow) this.mesh.castShadow = true;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.count = 0;
      this.capacity = capacity;
      this.free = [];
      this.used = 0; // high-water mark
      this.alive = new Uint8Array(capacity);
      this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
      if (parent) parent.add(this.mesh);
    }
    add(x, y, z, ry, s, rx, rz) {
      let id = this.free.length ? this.free.pop() : this.used < this.capacity ? this.used++ : -1;
      if (id < 0) return -1; // full: caller should skip this instance
      this.set(id, x, y, z, ry, s, rx, rz);
      this.alive[id] = 1;
      this.mesh.count = Math.max(this.mesh.count, id + 1);
      return id;
    }
    set(id, x, y, z, ry, s, rx, rz) {
      _obj.position.set(x, y, z);
      _obj.rotation.set(rx || 0, ry || 0, rz || 0);
      if (s === undefined || typeof s === 'number') _obj.scale.setScalar(s === undefined ? 1 : s); else _obj.scale.set(s[0], s[1], s[2]);
      _obj.updateMatrix();
      this.mesh.setMatrixAt(id, _obj.matrix);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    setColor(id, color) { // color: THREE.Color or hex
      if (!this.mesh.instanceColor || id < 0) return;
      this.mesh.setColorAt(id, color && color.isColor ? color : _c.set(color));
      this.mesh.instanceColor.needsUpdate = true;
    }
    remove(id) {
      if (id < 0 || !this.alive[id]) return;
      this.alive[id] = 0;
      this.mesh.setMatrixAt(id, this.zero);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.free.push(id);
    }
    clear() {
      for (let i = 0; i < this.used; i++) { this.alive[i] = 0; this.mesh.setMatrixAt(i, this.zero); }
      this.free.length = 0; this.used = 0; this.mesh.count = 0;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  RR.InstancedPool = InstancedPool;

  // Simple object pool for Object3D-based things (trains, obstacles...).
  class Pool {
    constructor(factory) { this.factory = factory; this.items = []; }
    get() { return this.items.pop() || this.factory(); }
    put(obj) { if (obj.parent) obj.parent.remove(obj); this.items.push(obj); }
  }
  RR.Pool = Pool;

  // Registry so game.js can find modules and call lifecycle hooks in a fixed order.
  RR.modules = [];
  RR.register = (name, mod) => { RR[name] = mod; RR.modules.push({ name, mod }); return mod; };
})();
