// Daytime atmosphere of the first-person view (SPEC §7.5.1): the numbers behind the day
// variant of every map, in the same shape lights.js' night `ambientFor` returns so the
// light pool, the sky, the fog, the post chain and the world read one object:
//   { time, darkness, fog, fogDensity, horizon, zenith, sky, ground, hemi, moon, moonI, ... }
// plus the day-only fields (`sunDir`, cloud, haze, lamp / fire scaling, wetness, exposure and
// grade). The "moon" light of the lights module is the sun by day (same shadow machinery).
//
// The per-map numbers live in daylight-look.js; a map without an entry there (a new map that
// just declares `time: 'day'`) gets the default look tinted a little by its `ambient.tint`.

import * as THREE from 'three';
import { PRESETS, dayLookFor, sunDirection } from './daylight-look.js';

/**
 * Day atmosphere for `map` (MapDef).
 * @returns {object} see the file header; colours are THREE.Color (linear)
 */
export function dayAmbientFor(map) {
  const p = dayLookFor(map.id);
  const tint = new THREE.Color((map.ambient && map.ambient.tint) || '#2c4a7a');
  const fog = new THREE.Color(p.haze);
  // a map with no preset takes a hint of its own colour so it doesn't look generic
  if (!PRESETS[map.id]) fog.lerp(tint, 0.08);
  const sunDir = new THREE.Vector3(...sunDirection(p.az, p.el)).normalize();
  return {
    time: 'day',
    darkness: 0.08,
    fog,
    fogDensity: p.fog,
    horizon: new THREE.Color(p.horizon),
    zenith: new THREE.Color(p.zenith),
    sky: new THREE.Color(p.hemiSky),
    ground: new THREE.Color(p.hemiGround),
    hemi: p.hemi,
    moon: new THREE.Color(p.sunColor),
    moonI: p.sunI,
    sunDir,
    ridge: new THREE.Color(p.ridge),
    cover: p.cover,
    heat: p.heat,
    mist: p.mist,
    wet: p.wet,
    exposure: p.exposure,
    // post grade: brighter, a touch more colour, a light vignette, no night grain, subtle bloom
    grade: { contrast: 1.05, saturation: 1.08, lift: [0.0, 0.002, 0.006], gamma: [1, 1, 1], gain: [1.03, 1.0, 0.965], vignette: 0.2, grain: 0.02, bloom: 0.2, bloomThreshold: 1.6 },
    // street lamps are off by day (a faint bulb glow), fires and flashes still light their surroundings
    lampK: 0.06,
    fireK: 0.3,
    flashK: 0.8,
  };
}
