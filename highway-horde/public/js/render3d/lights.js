// Lighting of the first-person view (WORLD, SPEC §7.5). Every light is created once —
// adding or removing lights at runtime would recompile every shader — and reused:
//   - a dim moonlight (DirectionalLight) and a HemisphereLight tuned per map.ambient,
//   - the local player's flashlight (SpotLight at the camera; shadow map on 'high'),
//   - a fixed pool of PointLights (8 on 'high', 4 on 'low'). Each frame the pool is handed
//     to the most relevant sources near the camera: the map's lamps and fires, steady()
//     registrations from sub-systems (burning zombies, hazards, turrets...) and flash()
//     transients (muzzle flashes, explosions). Pool slots fade in and out so lights never
//     pop, except flashes, which are allowed to appear at once (they are flashes).
//
// Intensity convention for flash()/steady(): 1 ≈ a street lamp at its radius, 2–4 a muzzle
// flash or an explosion. `radius` is the reach in world units (the light is cut there).

import * as THREE from 'three';

// flame light height above its base: well up in the flames, so a wreck's own flanks and a
// tanker's end cap under the fire are lit at a grazing angle instead of blown out white
const FIRE_H = 62;
const LAMP_H = 214;         // lamp light height (just under the 230 lamp head)
// Pool lights use decay 0: brightness follows only three.js' smooth range window
// (1 - (d/r)^4)^2, so a lamp 214 up and a fire 30 from a wreck both read as pools of
// light instead of the fire blowing out everything near it. E0 = irradiance of intensity 1.
const E0 = 5.5;
const FADE_IN = 3.5, FADE_OUT = 7;  // per second
const MAX_FLASHES = 40;

/**
 * @param {object} o { scene, camera, map, quality, heightAt?(x, y) base height of fires }
 */
export function createLights({ scene, camera, map, quality, fireBase }) {
  const amb = ambientFor(map);
  const group = new THREE.Group();
  group.name = 'lights';
  scene.add(group);

  const hemi = new THREE.HemisphereLight(amb.sky, amb.ground, amb.hemi);
  group.add(hemi);
  const moon = new THREE.DirectionalLight(amb.moon, amb.moonI);
  moon.position.set(-0.45, 0.62, -0.64).multiplyScalar(1000);
  moon.target.position.set(0, 0, 0);
  group.add(moon, moon.target);

  // flashlight: warm-white, a slightly soft cone, from just right of and below the eye
  const flash = new THREE.SpotLight('#fff1dc', 0, 1500, 0.44, 0.6, 1);
  flash.target = new THREE.Object3D();
  group.add(flash, flash.target);
  let high = quality !== 'low';
  const setShadows = () => {
    flash.castShadow = high;
    flash.shadow.mapSize.set(512, 512);
    flash.shadow.camera.near = 6;
    flash.shadow.camera.far = 900;
    flash.shadow.bias = -0.0006;
    flash.shadow.normalBias = 0.6;
    flash.shadow.radius = 2;
  };
  setShadows();

  // ---- sources ----------------------------------------------------------------------
  const colors = new Map();
  const color = (hex) => {
    let c = colors.get(hex);
    if (!c) { c = new THREE.Color(hex); colors.set(hex, c); }
    return c;
  };
  // map lights; a lamp_post decor at the same spot sets the height of the light
  const lamps = map.decor.filter((d) => d.kind === 'lamp_post');
  const mapSources = map.lights.map((l, i) => {
    let h = 70, isLamp = false;
    for (const d of lamps) {
      if (Math.abs(d.x - l.x) < 4 && Math.abs(d.y - l.y) < 4) { h = LAMP_H * (d.s || 1); isLamp = true; break; }
    }
    const fire = !isLamp && l.flicker >= 0.5;
    if (fire) h = (fireBase ? fireBase(l.x, l.y) : 0) + FIRE_H;
    return {
      key: 'map' + i, x: l.x, y: l.y, h, color: color(l.color),
      // lamps reach the ground at `r` from their foot; the cut-off is the slant distance
      // fires sit right against wrecks: at 1.1 a pale tanker cap 30 units away blew out white
      intensity: fire ? 0.8 : isLamp ? 1.6 : 0.9,
      radius: isLamp ? Math.hypot(l.r, h) * 1.05 : l.r * (fire ? 1.25 : 1.1),
      flicker: l.flicker || 0, seed: i * 1.7, index: i, flash: false, life: 0, age: 0,
    };
  });
  const mapLevel = new Float32Array(mapSources.length);

  const steadyMap = new Map();
  let frameNo = 0;
  const flashes = [];
  let flashSeq = 0;

  // ---- pool ----------------------------------------------------------------------------
  const pool = [];
  function buildPool(n) {
    for (const s of pool) group.remove(s.light);
    pool.length = 0;
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 300, 0);
      light.castShadow = false;
      group.add(light);
      pool.push({ light, src: null, level: 0 });
    }
  }
  buildPool(high ? 8 : 4);

  const cands = [];
  const _fwd = new THREE.Vector3();
  let time = 0;

  function score(s, fx, fy) {
    const dx = s.x - fx, dy = s.y - fy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > s.radius + 1500) return 0;
    let sc = (s.intensity * s.radius) / (d + s.radius * 0.35 + 60);
    if (s.flash) sc *= 1.5 * (1 - s.age / s.life);
    return sc;
  }

  function flickerOf(s) {
    if (!s.flicker) return 1;
    const t = time, p = s.seed;
    const n = Math.sin(t * 11.3 + p) * 0.45 + Math.sin(t * 17.9 + p * 2.1) * 0.35 + Math.sin(t * 5.1 + p * 3.3) * 0.2;
    return 1 - s.flicker * 0.45 * (0.5 + 0.5 * n);
  }

  /**
   * Per-frame update: flashlight, then pool assignment.
   * @param {object} f { dt, camX, camY, flashlight: bool, lightingBoost: number }
   */
  function update(f) {
    const dt = Math.min(0.1, f.dt || 0.016);
    time += dt;
    frameNo++;

    // flashlight from the camera
    camera.getWorldDirection(_fwd);
    const on = f.flashlight !== false;
    // Off = zero intensity, never visible = false: hiding the light changes the scene's
    // spot-light count, which recompiled every lit material (a hitch of ~12 programs) the
    // moment the player died and again on respawn.
    flash.intensity = on ? 1150 : 0;
    const cp = camera.position;
    const rx = -_fwd.z, rz = _fwd.x;   // right = forward × up
    const rl = Math.hypot(rx, rz) || 1;
    flash.position.set(cp.x + (rx / rl) * 7, cp.y - 7, cp.z + (rz / rl) * 7);
    flash.target.position.set(cp.x + _fwd.x * 200, cp.y + _fwd.y * 200 - 4, cp.z + _fwd.z * 200);
    flash.target.updateMatrixWorld();

    const boost = f.lightingBoost || 1;
    hemi.intensity = amb.hemi * boost;
    moon.intensity = amb.moonI * Math.min(2, boost);

    // age transients
    for (let i = flashes.length - 1; i >= 0; i--) {
      const s = flashes[i];
      s.age += dt;
      if (s.age >= s.life) flashes.splice(i, 1);
    }
    for (const [k, s] of steadyMap) if (s.stamp < frameNo - 1) steadyMap.delete(k);

    // candidates, scored from a point a little ahead of the camera
    const fx = f.camX + _fwd.x * 140, fy = f.camY + _fwd.z * 140;
    cands.length = 0;
    for (const p of pool) if (p.src) p.src.want = false;
    const consider = (s) => {
      const sc = score(s, fx, fy);
      if (sc <= 0) return;
      s.score = sc * (s.slot ? 1.3 : 1);   // hysteresis: keep what is already lit
      cands.push(s);
    };
    for (const s of mapSources) consider(s);
    for (const s of steadyMap.values()) consider(s);
    for (const s of flashes) consider(s);
    cands.sort((a, b) => b.score - a.score);
    const want = Math.min(pool.length, cands.length);
    for (let i = 0; i < cands.length; i++) cands[i].want = i < want;

    // release / fade slots whose source fell out of the top set (or vanished)
    for (const p of pool) {
      const s = p.src;
      const alive = s && (s.flash ? s.age < s.life : s.key.startsWith('map') || steadyMap.get(s.key) === s);
      if (s && alive && s.want) {
        p.level = s.flash ? 1 : Math.min(1, p.level + dt * FADE_IN);
      } else if (s) {
        p.level = s.flash && !alive ? 0 : Math.max(0, p.level - dt * FADE_OUT);
        if (p.level <= 0) { s.slot = null; p.src = null; }
      }
    }
    // hand free slots to wanted sources without one (flashes first: they're short)
    for (let i = 0; i < want; i++) {
      const s = cands[i];
      if (s.slot) continue;
      let free = null;
      for (const p of pool) if (!p.src) { free = p; break; }
      if (!free && s.flash) {
        // steal the weakest non-flash slot for a flash
        let worst = null;
        for (const p of pool) if (!p.src.flash && (!worst || p.src.score < worst.src.score)) worst = p;
        if (worst && worst.src.score < s.score) { worst.src.slot = null; worst.src = null; worst.level = 0; free = worst; }
      }
      if (!free) continue;
      free.src = s;
      free.level = s.flash ? 1 : 0;
      s.slot = free;
    }

    mapLevel.fill(0);
    for (const p of pool) {
      const s = p.src, L = p.light;
      if (!s || p.level <= 0) { L.intensity = 0; continue; }
      let k = p.level * flickerOf(s);
      if (s.flash) {
        const u = s.age / s.life;
        k = (1 - u) * (1 - u);
      }
      L.position.set(s.x, s.h, s.y);
      L.color.copy(s.color);
      L.distance = s.radius;
      L.intensity = s.intensity * E0 * k;
      if (s.index !== undefined) mapLevel[s.index] = p.level;
    }
  }

  return {
    hemi, moon, flashlight: flash, ambient: amb,
    /** Real-light level 0..1 of map light i this frame (fake light pools fill the rest). */
    mapLevel,
    mapSources,
    /**
     * Transient light (muzzle flash, explosion): fades out over `life` seconds.
     * @param {number} x @param {number} y @param {number} h height
     * @param {string} colorHex @param {number} intensity 1 ≈ street lamp @param {number} radius
     * @param {number} life seconds
     */
    flash(x, y, h, colorHex, intensity, radius, life) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (flashes.length >= MAX_FLASHES) {
        const old = flashes.shift();
        if (old.slot) { old.slot.src = null; old.slot.level = 0; old.slot = null; }
      }
      flashes.push({
        key: 'f' + (++flashSeq), x, y, h: h || 40, color: color(colorHex || '#ffcc88'), intensity: intensity || 2,
        radius: radius || 250, life: Math.max(0.03, life || 0.1), age: 0, flash: true, flicker: 0, slot: null,
      });
    },
    /** Persistent source for this frame; call every frame while it exists. */
    steady(key, x, y, h, colorHex, intensity, radius) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      let s = steadyMap.get(key);
      if (!s) {
        s = { key, flash: false, flicker: 0, slot: null, seed: steadyMap.size * 2.3 };
        steadyMap.set(key, s);
      }
      s.x = x; s.y = y; s.h = h || 40; s.color = color(colorHex || '#ffcc88');
      s.intensity = intensity || 1; s.radius = radius || 220; s.stamp = frameNo;
    },
    update,
    setQuality(q) {
      const nh = q !== 'low';
      if (nh === high) return;
      high = nh;
      for (const s of mapSources) s.slot = null;
      for (const s of steadyMap.values()) s.slot = null;
      for (const s of flashes) s.slot = null;
      buildPool(high ? 8 : 4);
      setShadows();
    },
    get activeCount() { return pool.filter((p) => p.src && p.level > 0).length; },
    dispose() {
      flash.shadow.map?.dispose();
      flash.dispose();
      moon.dispose();
      hemi.dispose();
      for (const p of pool) p.light.dispose();
      scene.remove(group);
    },
  };
}

/**
 * Night mood per map: fog colour, sky colours and ambient light from map.ambient
 * ({ darkness 0..1, tint }). Darker maps get less ambient and denser fog.
 */
export function ambientFor(map) {
  const a = map.ambient || { darkness: 0.65, tint: '#2c4a7a' };
  const d = Math.max(0, Math.min(1, a.darkness));
  const tint = new THREE.Color(a.tint);
  const fog = new THREE.Color('#05070a').lerp(tint, 0.17 + (1 - d) * 0.2);
  const horizon = fog.clone().lerp(tint, 0.15);
  const zenith = new THREE.Color('#010205').lerp(tint, 0.05);
  const sky = new THREE.Color('#7f93b5').lerp(tint, 0.45);
  // bounce from wet, lamp-lit asphalt: faces turned away from every light (a wreck
  // backlit by its own fire) keep a little value instead of crushing to flat black
  const ground = new THREE.Color('#3a3226').lerp(tint, 0.18);
  return {
    darkness: d,
    fog,
    fogDensity: 0.00085 + d * 0.0006,
    horizon,
    zenith,
    sky,
    ground,
    hemi: 0.65 + (1 - d) * 0.9,
    moon: new THREE.Color('#9fb4d8').lerp(tint, 0.2),
    moonI: 0.25 + (1 - d) * 0.5,
  };
}
