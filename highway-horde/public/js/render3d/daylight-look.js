// The numbers behind each map's daylight (SPEC §7.5.1), plain data with no three.js so the
// unit tests can check them. daylight.js turns them into the atmosphere object the renderer
// reads. A map without an entry here (a new map that just declares `time: 'day'`) gets
// `DEFAULT`, tinted a little by its own `ambient.tint` in daylight.js.

/**
 * Per-map look. Angles in degrees: `az` is the sun's bearing in the ground plane (0 = +x,
 * 90 = +y of the sim), `el` its height above the horizon.
 *   haze / horizon / zenith  sky and fog colours (sRGB hex)
 *   fog                      exp² fog density (aerial perspective), per world unit
 *   cover                    cloud cover 0..1 (0.5 = scattered fair-weather clouds)
 *   sunI / hemi              sun and sky-fill intensity; exposure: tone-mapping exposure
 *   heat                     0..1 horizon shimmer / warm haze (desert, tarmac)
 *   ridge                    colour of the distant mountains before the haze
 *   wet                      wetness of hard ground (0 dry .. 1 wet); puddles stay smaller
 */
export const DEFAULT = {
  az: 235, el: 34, haze: '#b3c6d8', horizon: '#cbdaea', zenith: '#2a6ac2', fog: 0.00023, cover: 0.42,
  sunColor: '#fff0d4', sunI: 4.4, hemiSky: '#b0c8ee', hemiGround: '#6f6244', hemi: 0.85, exposure: 1.0,
  heat: 0.2, ridge: '#6d7f8f', wet: 0.28, mist: 0.6,
};

export const PRESETS = {
  // sunny hazy highway: tarmac heat, a pale warm haze along the road
  highway: { az: 215, el: 33, haze: '#bfcbd4', horizon: '#d6e0e8', zenith: '#2f70c4', fog: 0.00026, cover: 0.4, heat: 0.55, ridge: '#72808a', wet: 0.12, sunColor: '#fff0d0', mist: 0.7 },
  // desert noon-ish: bleached sky, dusty warm haze, high hard sun
  truckstop: { az: 250, el: 42, haze: '#e6d6b4', horizon: '#efe0bd', zenith: '#3a86cc', fog: 0.00025, cover: 0.16, heat: 0.9, ridge: '#a4805a', wet: 0.06, sunColor: '#fff2d2', sunI: 3.9, hemiGround: '#a58a5a', hemiSky: '#e2dccb', mist: 0.35 },
  // river valley: cool blue haze, glinting water
  bridge: { az: 200, el: 30, haze: '#bccfdc', horizon: '#d0e0ec', zenith: '#3479cc', fog: 0.00029, cover: 0.5, heat: 0.1, ridge: '#5d7488', wet: 0.3, sunColor: '#fff1dc', mist: 0.9 },
  // checkpoint: fair but grey-ish, more cloud, softer light
  checkpoint: { az: 240, el: 36, haze: '#c1cbd0', horizon: '#d3dce2', zenith: '#4a7eb8', fog: 0.00034, cover: 0.68, heat: 0.15, ridge: '#68757b', wet: 0.14, sunColor: '#fff1dc', sunI: 3.3, mist: 0.6 },
  // farm country: deep blue sky, cumulus, green haze at the horizon
  harlan: { az: 225, el: 36, haze: '#c5d6d3', horizon: '#d4e4e6', zenith: '#3479cf', fog: 0.00022, cover: 0.5, heat: 0.2, ridge: '#5f7d6e', wet: 0.2, sunColor: '#fff0d2', hemiGround: '#6f7c48', mist: 0.55 },
};

/** The merged look of a map id (preset over DEFAULT). */
export function dayLookFor(mapId) {
  return { ...DEFAULT, ...(PRESETS[mapId] || {}) };
}

/** Unit vector toward the sun (x, up, z of the 3D scene) for a bearing / elevation in degrees. */
export function sunDirection(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}
