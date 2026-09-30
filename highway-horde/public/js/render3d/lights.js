// Lighting of the first-person view (WORLD, SPEC §7.5). Every light is created once —
// adding or removing lights at runtime would recompile every shader — and reused:
//   - a dim moonlight (DirectionalLight) and a HemisphereLight tuned per map.ambient; on
//     'high'/'ultra' the moon casts soft shadows of the static world from a shadow map
//     that follows the camera and is re-rendered only when the camera has travelled far
//     (static casters never move, so it costs a pass every few seconds, not every frame);
//     'cinematic' swaps it for a two-cascade sun light (sunlight.js: 4096² per cascade, a
//     9 mm-texel near cascade around the player, a far one out to the fog) with a denser
//     shadow filter,
//   - the local player's flashlight (SpotLight at the camera; shadow map on 'high'/'ultra',
//     4096² on 'cinematic'),
//   - a fixed pool of PointLights (20 on 'cinematic', 12 on 'ultra', 8 on 'high', 4 on 'low'; on
//     'cinematic' at night the first three cast the shadow of the STATIC world: they are handed the
//     nearest map lights (lamps, fires: fixed position and radius) and their cube maps are redrawn,
//     one per frame, only when a slot changes hands). Each frame the pool is handed
//     to the most relevant sources near the camera: the map's lamps and fires, steady()
//     registrations from sub-systems (burning zombies, hazards, turrets...) and flash()
//     transients (muzzle flashes, explosions). Pool slots fade in and out so lights never
//     pop, except flashes, which are allowed to appear at once (they are flashes).
//
// Intensity convention for flash()/steady(): 1 ≈ a street lamp at its radius, 2–4 a muzzle
// flash or an explosion. `radius` is the reach in world units (the light is cut there).

import * as THREE from 'three';
import { dayAmbientFor } from './daylight.js';
import { terrainOf } from '../shared/terrain.js';
import { normTier, tierAtLeast, tierRow } from './tier.js';
import { HHSunLight } from './sunlight.js';
import { nearestSection } from '../shared/level.js';

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
const FLASH_I = 900;
/** By day, the share of its light a fixture under a roof keeps (street lamps keep lampK). */
const INTERIOR_DAY_K = 0.15;

/** Point lights in the pool per tier. */
export const LIGHT_POOL = { cinematic: 20, ultra: 12, high: 8, low: 4 };
/** Flashlight shadow map size (px) per tier. */
export const FLASH_MAP = { cinematic: 4096, ultra: 2048, high: 1024, low: 1024 };
/** Sun / moon shadow map size (px; per cascade on 'cinematic') per tier. */
export const SUN_MAP = { cinematic: 4096, ultra: 2048, high: 1024, low: 1024 };
/** Pool lights that cast a (static) shadow: the nearest street lamps and fires, Cinematic at night. */
export const LAMP_SHADOWS = { cinematic: 3, ultra: 0, high: 0, low: 0 };
/** Half-extent (units) of the single sun / moon map that follows the camera (not used by the cinematic cascades). */
export const SUN_SPAN = { cinematic: 1300, ultra: 1300, high: 1000, low: 1000 };

// Shadow filter. three's PCF takes 5 taps of a rotated Vogel disc; on a 4096-px map (the
// cinematic flashlight, the cinematic sun atlas) a 12-tap disc with a footprint that is
// isotropic in texels (the sun atlas is two tiles wide, which made three's disc twice as
// wide as tall) gives a smooth, sharper penumbra. The branch is on the map size, a uniform:
// the 2048 maps of the other tiers keep the original 5 taps.
const PCF_TAPS = `shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;`;
(function patchShadowFilter() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (!chunk || chunk.includes('hhShadowTaps')) return;
  // find the original 5-tap text with a whitespace-tolerant regex (the chunk is tab-indented)
  const esc = PCF_TAPS.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const re = new RegExp(esc);
  if (!re.test(chunk)) return;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(re, `// hhShadowTaps
				if ( shadowMapSize.x > 3000.0 ) {
					vec2 hhRadius = shadowRadius * texelSize;
					shadow = 0.0;
					for ( int i = 0; i < 12; i ++ ) shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, 12, phi ) * hhRadius, shadowCoord.z ) );
					shadow *= ( 1.0 / 12.0 );
				} else {
					${PCF_TAPS}
				}`);
}());

// The flashlight's beam profile (the only SpotLight in the scene). three's spot is a flat
// disc with a smoothstep rim in cosine space — close to a wall it read as a hard-edged
// white plate that washed the texture out. A real torch has a hot centre and a soft spill
// that fades in angle, and its irradiance stops climbing inside ~1.5 m (the reflector is
// not a point): the profile below is that, patched once into three's light chunk (every
// lit material, every tier; one acos per fragment for the one spot light).
const SPOT_ATT = 'float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );';
const SPOT_DIST = 'light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );';
if (THREE.ShaderChunk.lights_pars_begin.includes(SPOT_ATT) && THREE.ShaderChunk.lights_pars_begin.includes(SPOT_DIST)) {
  THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin
    .replace(SPOT_ATT, `float hhSx = acos( clamp( angleCos, -1.0, 1.0 ) ) / max( acos( spotLight.coneCos ), 1e-3 );
		float hhSq = max( 1.0 - hhSx * hhSx, 0.0 );
		float spotAttenuation = hhSx < 1.0 ? 0.6 * hhSq * hhSq + 0.4 * exp( -hhSx * hhSx * 9.0 ) : 0.0;`)
    .replace(SPOT_DIST, 'light.color *= getDistanceAttenuation( max( lightDistance, 64.0 ), spotLight.distance, spotLight.decay );');
}

/** The torch's lens cookie: a soft hot centre, faint ring artefacts, a little dust. */
function makeFlashCookie() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2 + 3, S / 2 - 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.45, '#f2ece0');
  gr.addColorStop(0.8, '#cfc8bc');
  gr.addColorStop(1, '#a8a196');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(70,60,50,0.10)';
  for (const r of [0.34, 0.58, 0.8]) { g.lineWidth = 2.5; g.beginPath(); g.arc(S / 2, S / 2, r * S / 2, 0, Math.PI * 2); g.stroke(); }
  // filament: a brighter warm smear off-centre
  g.fillStyle = 'rgba(255,240,205,0.22)';
  g.beginPath(); g.ellipse(S / 2 + 4, S / 2 - 3, 7, 14, 0.5, 0, Math.PI * 2); g.fill();
  let seed = 31;
  for (let i = 0; i < 26; i++) {
    seed = (seed * 16807) % 2147483647;
    const a = (seed / 2147483647) * Math.PI * 2;
    seed = (seed * 16807) % 2147483647;
    const d = Math.sqrt(seed / 2147483647) * S * 0.46;
    g.fillStyle = 'rgba(40,36,30,0.13)';
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0.8 + (i % 4) * 0.7, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {object} o { scene, camera, map, quality, heightAt?(x, y) base height of fires, time: 'night'|'day' }
 *   By day the "moon" is the sun (same directional light and shadow map, warm and strong),
 *   the flashlight is off and the street lamps are (nearly) dark.
 */
export function createLights({ scene, camera, map, quality, fireBase, time: timeOfDay }) {
  const amb = ambientFor(map, timeOfDay);
  const day = amb.time === 'day';
  const group = new THREE.Group();
  group.name = 'lights';
  scene.add(group);

  const hemi = new THREE.HemisphereLight(amb.sky, amb.ground, amb.hemi);
  group.add(hemi);
  let tier = normTier(quality);
  let high = tier !== 'low';
  let cine = tierAtLeast(tier, 'cinematic');
  // The cinematic sun is a two-cascade light (sunlight.js); every other tier keeps the single
  // DirectionalLight. A tier switched up to 'cinematic' mid-game swaps the light once (one
  // recompile); switched back down it stays a cascaded light with 2048 px maps.
  let cascaded = cine;
  const MOON_DIR = (amb.sunDir ? amb.sunDir.clone() : new THREE.Vector3(-0.45, 0.62, -0.64)).normalize();
  function makeMoon() {
    if (cascaded) {
      const m = new HHSunLight(amb.moon, amb.moonI);
      m.position.copy(MOON_DIR);
      m.updateMatrixWorld();
      return m;
    }
    const m = new THREE.DirectionalLight(amb.moon, amb.moonI);
    m.position.copy(MOON_DIR).multiplyScalar(1000);
    m.target.position.set(0, 0, 0);
    return m;
  }
  let moon = makeMoon();
  group.add(moon);
  if (moon.target) group.add(moon.target);
  const moonShadow = { cx: NaN, cy: 0, cz: NaN, span: 1000, k: 0 };
  // cinematic extras the settings can switch (renderer3d applySettings → setOptions)
  const opts = { shadowsHigh: true, lightShadows: true };

  // flashlight: warm-white, a slightly soft cone, from just right of and below the eye
  // decay a little over 1: bright enough to read zombies at 400+, without the hot spot on
  // a wall 100 away blowing out (and blooming) the middle of the screen
  // (the cone is a little wider than the lit disc used to be: the patched profile above
  // fades the spill out gradually instead of cutting it at a rim)
  const flash = new THREE.SpotLight('#fff1dc', 0, 1500, 0.5, 0.72, 1.12);
  flash.target = new THREE.Object3D();
  group.add(flash, flash.target);
  // The lens of a torch is not clean: a cookie (three.js applies a spot light's map only while
  // it casts shadows, so 'high' / 'ultra') gives the beam a faint filament hot spot, a ring
  // or two from the reflector and specks of dust; it also stays soft, never a hard disc.
  const cookie = makeFlashCookie();
  flash.map = null;
  const sunMapSize = () => (cine && !opts.shadowsHigh ? SUN_MAP.ultra : tierRow(SUN_MAP, tier));
  const flashMapSize = () => (cine && !opts.shadowsHigh ? FLASH_MAP.ultra : tierRow(FLASH_MAP, tier));
  const dropMap = (shadow) => {
    if (shadow.map) {
      shadow.map.depthTexture?.dispose();
      shadow.map.dispose();
      shadow.map = null;
    }
  };
  const setShadows = () => {
    // (no flashlight by day: its shadow pass over the actors would draw nothing)
    flash.castShadow = high && !day;
    flash.map = flash.castShadow ? cookie : null;
    const size = flashMapSize();
    if (flash.shadow.mapSize.x !== size) dropMap(flash.shadow);
    flash.shadow.mapSize.set(size, size);
    flash.shadow.camera.near = 6;
    flash.shadow.camera.far = 900;
    flash.shadow.bias = -0.0006;
    flash.shadow.normalBias = size > 3000 ? 0.45 : 0.6;
    // soft edges (PCF over a rotated Vogel disc): wider on the larger maps, in texels (the
    // 4096 map of 'cinematic' takes 12 taps: a smooth penumbra that is also narrower in world units)
    flash.shadow.radius = size > 3000 ? 5 : tier === 'ultra' ? 3.5 : 2.5;
  };
  function setMoonShadow() {
    const on = tier !== 'low';
    moon.castShadow = on;
    moon.shadow.autoUpdate = false;
    const size = sunMapSize();
    if (moon.shadow.mapSize.x !== size) dropMap(moon.shadow);
    moon.shadow.mapSize.set(size, size);
    if (cascaded) {
      const sh = moon.shadow;
      // the far cascade reaches as far as the fog lets you see (thick night fog: less)
      const seen = Math.sqrt(-Math.log(0.03)) / Math.max(1e-5, amb.fogDensity);
      sh.depths = [size >= 4096 ? 320 : 380, Math.max(900, Math.min(2200, seen))];
      sh.drift = [110, 260];
      sh.bias = -0.0003;
      sh.normalBias = size >= 4096 ? 0.9 : 1.3;
      // texels, isotropic: the near cascade (~9 mm texels) stays crisp, the far one softens with distance
      sh.radius = size >= 4096 ? 3 : 2;
      moonShadow.span = sh.fit()[0];
    } else {
      const S = tierRow(SUN_SPAN, tier);
      moonShadow.span = S;
      const c = moon.shadow.camera;
      c.left = -S; c.right = S; c.top = S; c.bottom = -S;
      c.near = 10; c.far = 5200;
      c.updateProjectionMatrix();
      moon.shadow.bias = -0.0005;
      moon.shadow.normalBias = 1.6;
      moon.shadow.radius = tier === 'ultra' ? 3 : 2;
    }
    moonShadow.cx = NaN;   // re-render at the next opportunity
  }
  setShadows();
  setMoonShadow();

  // ---- sources ----------------------------------------------------------------------
  const colors = new Map();
  const color = (hex) => {
    let c = colors.get(hex);
    if (!c) { c = new THREE.Color(hex); colors.set(hex, c); }
    return c;
  };
  // map lights; a lamp_post decor at the same spot sets the height of the light
  const lamps = map.decor.filter((d) => d.kind === 'lamp_post');
  // (campaign maps: lights stand on the terrain; an explicit height is absolute)
  const terr = terrainOf(map);
  const ground = (x, y) => (terr.flat ? 0 : terr.height(x, y));
  const mapSources = map.lights.map((l, i) => {
    // a light with its own height (fixtures under an overpass) shines down like a lamp
    let h = Number.isFinite(l.h) ? l.h : 70 + ground(l.x, l.y), isLamp = Number.isFinite(l.h);
    for (const d of lamps) {
      if (Math.abs(d.x - l.x) < 4 && Math.abs(d.y - l.y) < 4) { h = LAMP_H * (d.s || 1) + ground(l.x, l.y); isLamp = true; break; }
    }
    const fire = !isLamp && l.flicker >= 0.5;
    if (fire) h = (fireBase ? fireBase(l.x, l.y) : 0) + FIRE_H;
    return {
      key: 'map' + i, x: l.x, y: l.y, h, color: color(l.color),
      // lamps reach the ground at `r` from their foot; the cut-off is the slant distance
      // fires sit right against wrecks: at 1.1 a pale tanker cap 30 units away blew out white
      intensity: (fire ? 0.8 : isLamp ? 1.6 : 0.9) * (Number.isFinite(l.k) ? l.k : 1), lamp: isLamp,
      radius: isLamp ? Math.hypot(l.r, h) * 1.05 : l.r * (fire ? 1.25 : 1.1),
      flicker: l.flicker || 0, seed: i * 1.7, index: i, flash: false, life: 0, age: 0, isMap: true,
    };
  });
  const mapLevel = new Float32Array(mapSources.length);
  // Story levels (JOURNEY.md §4.3): every map light knows its section, so a power cut (`lights`
  // action) switches that section's lights off; a light under a roof is an interior fixture and
  // stays on by day (street lamps go out in the daylight, a hospital corridor's tubes do not).
  if (map.kind === 'level') {
    for (const s of mapSources) {
      s.section = nearestSection(map, s.x, s.y);
      s.interior = (map.roofs || []).some((r) => {
        const c = Math.cos(r.a || 0), sn = Math.sin(r.a || 0), dx = s.x - r.x, dy = s.y - r.y;
        return Math.abs(dx * c + dy * sn) <= r.w / 2 && Math.abs(-dx * sn + dy * c) <= r.h / 2;
      });
    }
  }
  /** Sections whose map lights are out (bit i = section i). */
  let darkBits = 0;

  const steadyMap = new Map();
  let frameNo = 0;
  const flashes = [];
  let flashSeq = 0;

  // ---- pool ----------------------------------------------------------------------------
  const pool = [];
  const poolLights = [];
  // per pool slot: 1 = a street lamp under its shade (the atmosphere pass keeps its haze below it)
  let poolKinds = new Float32Array(0);
  // shadow-casting slots (0..K-1): the nearest map lights, static shadows (see the header)
  let K = 0;
  let slotKey = [];
  let dirty = [];
  let casterPts = [];
  const lampCount = () => (cine && opts.lightShadows && !day ? tierRow(LAMP_SHADOWS, tier) : 0);
  function buildPool(n) {
    for (const s of pool) { group.remove(s.light); dropMap(s.light.shadow); s.light.dispose(); }
    for (const c of casterPts) shadowScene.remove(c);
    casterPts = [];
    pool.length = 0;
    poolLights.length = 0;
    K = Math.min(lampCount(), n);
    slotKey = new Array(K).fill(null);
    dirty = new Array(K).fill(true);
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 300, 0);
      light.castShadow = i < K;
      if (i < K) {
        const sh = light.shadow;
        sh.mapSize.set(1024, 1024);
        sh.autoUpdate = false;
        sh.camera.near = 4;
        sh.bias = -0.0008;
        sh.normalBias = 1.2;
        sh.radius = 3;
        // the same shadow object drives the caster in the shadow-only scene (like the sun's)
        const c = new THREE.PointLight('#ffffff', 0, 300, 0);
        c.castShadow = true;
        c.shadow = sh;
        shadowScene.add(c);
        casterPts.push(c);
      }
      group.add(light);
      pool.push({ light, src: null, level: 0 });
      poolLights.push(light);
    }
    poolKinds = new Float32Array(n);
  }

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
    const on = f.flashlight !== false && !day;
    // Off = zero intensity, never visible = false: hiding the light changes the scene's
    // spot-light count, which recompiled every lit material (a hitch of ~12 programs) the
    // moment the player died and again on respawn.
    // a torch is never perfectly steady: a slight flutter, and now and then a brief dip
    const dipPh = time % 13.7;
    const dip = dipPh < 0.16 ? 0.14 * Math.pow(Math.sin(dipPh / 0.16 * Math.PI * 3), 2) : 0;
    const flick = 0.985 + 0.015 * Math.sin(time * 31.7 + 1) * Math.sin(time * 11.3) - dip;
    flash.intensity = on ? FLASH_I * flick : 0;
    const cp = camera.position;
    const rx = -_fwd.z, rz = _fwd.x;   // right = forward × up
    const rl = Math.hypot(rx, rz) || 1;
    flash.position.set(cp.x + (rx / rl) * 7, cp.y - 7, cp.z + (rz / rl) * 7);
    // the hand holding it sways a little (the beam drifts a few units at 200 out)
    const swx = Math.sin(time * 1.3) * 1.7 + Math.sin(time * 2.9) * 0.6, swy = Math.cos(time * 1.7) * 1.1 + Math.sin(time * 3.7) * 0.4;
    flash.target.position.set(cp.x + _fwd.x * 200 + (rx / rl) * swx, cp.y + _fwd.y * 200 - 4 + swy, cp.z + _fwd.z * 200 + (rz / rl) * swx);
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
    for (const s of mapSources) if (!(darkBits && s.section >= 0 && (darkBits & (1 << s.section)))) consider(s);
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
      // the shadow slots (0..K-1) are for map lights (their static shadow maps fit them), the rest for everything
      if (K > 0 && s.isMap) for (let k = 0; k < K; k++) if (!pool[k].src) { free = pool[k]; break; }
      if (!free) for (let k = K; k < pool.length; k++) if (!pool[k].src) { free = pool[k]; break; }
      if (!free && s.flash) {
        // steal the weakest non-flash slot for a flash
        let worst = null;
        for (let k = K; k < pool.length; k++) { const p = pool[k]; if (!p.src.flash && (!worst || p.src.score < worst.src.score)) worst = p; }
        if (worst && worst.src.score < s.score) { worst.src.slot = null; worst.src = null; worst.level = 0; free = worst; }
      }
      if (!free) continue;
      free.src = s;
      free.level = s.flash ? 1 : 0;
      s.slot = free;
    }

    // a shadow slot that changed hands needs its cube map redrawn (updateLampShadows)
    for (let i = 0; i < K; i++) {
      const src = pool[i].src, key = src ? src.key : null;
      if (key !== slotKey[i]) {
        slotKey[i] = key;
        if (src) {
          dirty[i] = true;
          pool[i].light.position.set(src.x, src.h, src.y);
          pool[i].light.distance = src.radius;
        }
      }
    }

    mapLevel.fill(0);
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      const s = p.src, L = p.light;
      poolKinds[i] = s && s.lamp ? 1 : 0;
      if (!s || p.level <= 0) { L.intensity = 0; continue; }
      let k = p.level * flickerOf(s);
      if (s.flash) {
        const u = s.age / s.life;
        k = (1 - u) * (1 - u);
      }
      L.position.set(s.x, s.h, s.y);
      L.color.copy(s.color);
      L.distance = s.radius;
      // (by day an interior fixture keeps a little of its light: the room reads dim, not black, and
      // still darker than the street outside)
      L.intensity = s.intensity * E0 * k * (day ? (s.flash ? amb.flashK : s.interior ? INTERIOR_DAY_K : s.lamp ? amb.lampK : amb.fireK) : 1);
      if (s.index !== undefined) mapLevel[s.index] = p.level;
    }
  }

  // The moon's map holds the static world only (actors move; they keep their flashlight
  // shadows). It is drawn by rendering a small shadow-only scene: a caster light SHARING
  // the moon's LightShadow (same map, same matrix) and proxy meshes that reuse the static
  // meshes' geometry and materials (no extra GPU buffers), seen by a camera that sees
  // nothing — so only the shadow pass draws. (WebGLShadowMap can't be driven outside
  // renderer.render(), and toggling castShadow in the main scene would put the statics
  // into the flashlight's map too.)
  const shadowScene = new THREE.Scene();
  shadowScene.name = 'moon-shadow';
  function makeCaster() {
    const c = cascaded ? new HHSunLight('#ffffff', 0) : new THREE.DirectionalLight('#ffffff', 0);
    c.castShadow = true;
    c.shadow = moon.shadow;
    if (cascaded) { c.position.copy(MOON_DIR); c.updateMatrixWorld(); }
    shadowScene.add(c);
    if (c.target) shadowScene.add(c.target);
    return c;
  }
  let casterLight = makeCaster();
  buildPool(tierRow(LIGHT_POOL, tier));
  const blindCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1);
  blindCam.position.set(0, -1e6, 0);
  blindCam.lookAt(0, -2e6, 0);
  blindCam.updateMatrixWorld();
  let blindRT = null;
  let proxies = null;
  const _mf = new THREE.Vector3();
  /**
   * Re-render the moon's shadow map when the camera has moved far from its centre.
   * @param {THREE.Mesh[]} casters the static world meshes (built into proxies once)
   * @returns {boolean} whether the map was re-rendered this frame
   */
  function updateMoonShadow(renderer, scene, casters) {
    if (!casters || !casters.length) return false;
    updateLampShadows(renderer, casters);
    if (!moon.castShadow) return false;
    if (cascaded) return updateCascades(renderer, casters);
    const S = moonShadow.span;
    camera.getWorldDirection(_mf);
    const l = Math.hypot(_mf.x, _mf.z) || 1;
    const tx = camera.position.x + (_mf.x / l) * S * 0.3, tz = camera.position.z + (_mf.z / l) * S * 0.3;
    if (Math.hypot(tx - moonShadow.cx, tz - moonShadow.cz) < S * 0.32) return false;
    ensureProxies(casters);
    const snap = S / 8;
    moonShadow.cx = Math.round(tx / snap) * snap;
    moonShadow.cz = Math.round(tz / snap) * snap;
    for (const L of [moon, casterLight]) {
      L.target.position.set(moonShadow.cx, 0, moonShadow.cz);
      L.position.copy(MOON_DIR).multiplyScalar(2600).add(L.target.position);
      L.target.updateMatrixWorld();
      L.updateMatrixWorld();
    }
    drawShadowScene(renderer);
    return true;
  }

  /**
   * The static world's shadow for the shadow-casting pool slots: a slot that changed hands gets its
   * cube map redrawn (the first time, all of them, so no lit draw samples a missing map); one per frame after.
   */
  function updateLampShadows(renderer, casters) {
    if (K <= 0) return;
    ensureProxies(casters);
    let did = 0;
    const all = dirty.every(Boolean);
    for (let i = 0; i < K; i++) {
      if (!dirty[i]) continue;
      const src = pool[i].src;
      const L = pool[i].light, c = casterPts[i];
      // an empty slot is drawn once too (from the map's middle): the shader needs a map to sample
      const x = src ? src.x : map.width / 2, h = src ? src.h : 100, y = src ? src.y : map.height / 2, r = src ? src.radius : 300;
      L.position.set(x, h, y);
      L.distance = r;
      c.position.set(x, h, y);
      c.distance = r;
      c.updateMatrixWorld();
      L.updateMatrixWorld();
      c.shadow.needsUpdate = true;
      dirty[i] = false;
      did++;
      if (!all) break;
    }
    if (did) drawShadowScene(renderer, false);
  }

  function ensureProxies(casters) {
    if (proxies) return;
    proxies = casters.map((m) => {
      const p = new THREE.Mesh(m.geometry, m.material);
      p.castShadow = true;
      p.receiveShadow = false;
      p.matrixAutoUpdate = false;
      p.matrix.copy(m.matrixWorld);
      shadowScene.add(p);
      return p;
    });
  }

  function drawShadowScene(renderer, sun = true) {
    if (!blindRT) blindRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const prev = renderer.getRenderTarget();
    if (sun) moon.shadow.needsUpdate = true;
    try {
      renderer.setRenderTarget(blindRT);
      renderer.render(shadowScene, blindCam);
    } finally {
      renderer.setRenderTarget(prev);
    }
  }

  /**
   * Cinematic sun: two cascades centred on the camera (sunlight.js). Rotation-invariant, so the
   * map stays valid while the player turns; it is redrawn when the camera has walked `drift[0]`
   * units, or the field of view changed the fit.
   */
  function updateCascades(renderer, casters) {
    const sh = moon.shadow, cp = camera.position;
    const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tw = th * camera.aspect;
    const k = Math.min(3.4, Math.sqrt(1 + th * th + tw * tw));
    const moved = Math.hypot(cp.x - moonShadow.cx, cp.y - moonShadow.cy, cp.z - moonShadow.cz);
    if (Number.isFinite(moonShadow.cx) && moved < sh.drift[0] * 0.85 && Math.abs(k - moonShadow.k) < 0.12 * k) return false;
    ensureProxies(casters);
    moonShadow.cx = cp.x; moonShadow.cy = cp.y; moonShadow.cz = cp.z; moonShadow.k = k;
    sh.k = k;
    sh.center.copy(cp);
    moonShadow.span = sh.fit()[0];
    moon.updateMatrixWorld();
    casterLight.updateMatrixWorld();
    drawShadowScene(renderer);
    return true;
  }

  /** Swap the plain DirectionalLight for the cascaded sun light (a tier raised to 'cinematic' mid-game). */
  function swapToCascaded() {
    const old = moon;
    group.remove(old);
    if (old.target) group.remove(old.target);
    dropMap(old.shadow);
    old.dispose();
    cascaded = true;
    moon = makeMoon();
    group.add(moon);
    shadowScene.remove(casterLight);
    if (casterLight.target) shadowScene.remove(casterLight.target);
    casterLight = makeCaster();
  }

  return {
    hemi, flashlight: flash, ambient: amb,
    /** The sun / moon light (a DirectionalLight, or the two-cascade sun of 'cinematic'). */
    get moon() { return moon; },
    /** Unit vector from the scene toward the sun / moon (contact shadows, shafts). */
    get sunDir() { return MOON_DIR; },
    /** Sun shadow description for the atmosphere pass (light shafts): null when there is no cascaded map yet. */
    get sun() { return cascaded && moon.castShadow ? { light: moon, shadow: moon.shadow, dir: MOON_DIR } : null; },
    updateMoonShadow,
    /** The pool's PointLights (read-only: rain streaks are lit by them). */
    poolLights,
    /** Per pool slot, 1 when it holds a street lamp (read-only; rebuilt with the pool). */
    get poolKinds() { return poolKinds; },
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
      const nt = normTier(q);
      if (nt === tier) return;
      tier = nt;
      high = tier !== 'low';
      cine = tierAtLeast(tier, 'cinematic');
      if (cine && !cascaded) swapToCascaded();
      for (const s of mapSources) s.slot = null;
      for (const s of steadyMap.values()) s.slot = null;
      for (const s of flashes) s.slot = null;
      buildPool(tierRow(LIGHT_POOL, tier));
      setShadows();
      setMoonShadow();
    },
    /** Cinematic extras from the graphics settings: { shadowsHigh } (4096 px cascades and flashlight map), { lightShadows } (shadow-casting lamps). */
    setOptions(o) {
      if (!o) return;
      if (o.lightShadows !== undefined && !!o.lightShadows !== opts.lightShadows) {
        opts.lightShadows = !!o.lightShadows;
        if (cine) {
          for (const src of mapSources) src.slot = null;
          for (const src of steadyMap.values()) src.slot = null;
          for (const src of flashes) src.slot = null;
          buildPool(tierRow(LIGHT_POOL, tier));
        }
      }
      if (o.shadowsHigh === undefined || !!o.shadowsHigh === opts.shadowsHigh) return;
      opts.shadowsHigh = !!o.shadowsHigh;
      if (cine) { setShadows(); setMoonShadow(); }
    },
    get activeCount() { return pool.filter((p) => p.src && p.level > 0).length; },
    /**
     * Story levels: the sections whose map lights are cut (bit i = section i; the `lights`
     * action). Their lights leave the pool (fading out) and report level 0.
     */
    setDark(bits) {
      darkBits = bits >>> 0;
    },
    /** True when map light `i` is out (its section's lights are cut). */
    isDark(i) {
      const s = mapSources[i];
      return !!(s && darkBits && s.section >= 0 && (darkBits & (1 << s.section)));
    },
    dispose() {
      for (const p of pool) dropMap(p.light.shadow);
      dropMap(flash.shadow);
      cookie.dispose();
      dropMap(moon.shadow);
      blindRT?.dispose();
      shadowScene.clear();
      proxies = null;
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
export function ambientFor(map, time) {
  if (time === 'day') return dayAmbientFor(map);
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
  const out = {
    time: 'night',
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
  // a story hideout tunes its own night (map.look.night: colours as '#rrggbb', numbers as they are)
  const ov = map.look && map.look.night;
  if (ov) {
    for (const k of ['fog', 'horizon', 'zenith', 'sky', 'ground', 'moon']) if (typeof ov[k] === 'string') out[k] = new THREE.Color(ov[k]);
    for (const k of ['fogDensity', 'hemi', 'moonI']) if (Number.isFinite(ov[k])) out[k] = ov[k];
  }
  return out;
}
