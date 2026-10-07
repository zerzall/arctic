// The viewmodel's lighting (viewmodel.js): the first-person gun lives in its own scene in camera
// space, so the world's lights are mirrored into it every frame (the scene's onBeforeRender),
// turned by the inverse of the camera's rotation:
//   - the world's reflection probe (scene.environment, a PMREM of the map) as the gun's
//     environment map, rotated the same way: real sky and street reflections in the metal;
//   - the sun / moon: the world's directional light, shaded by what stands between the eye and
//     the sun (a ray through the map's obstacles, every few frames) and by a roof overhead;
//   - the hemisphere light (sky / ground colours of the map and time of day);
//   - the nearest, brightest pool lights (fires, street lamps, muzzle flashes, explosions) as
//     real point lights at their places round the eye;
//   - at night the flashlight's bounce off whatever it lights ahead, and a soft studio key / rim
//     so the silhouette still reads in the dark;
//   - under a roof (the indoor light mask, indoor.js) the sky's share drops like the world's.
// The light count never changes (intensity 0 for an unused one: SPEC §7.5 GPU rules).

import * as THREE from 'three';
import { tierAtLeast } from './tier.js';

/** Pool lights mirrored per tier. */
const POOL_N = { low: 1, high: 2, ultra: 3, cinematic: 4 };
/** Eye height (SPEC §7.5 canonical heights). */
const EYE = 52;

/**
 * @param {object} ctx renderer ctx (scene, camera, map, amb, lightRig, indoorAt, heightOf, quality)
 * @param {THREE.Scene} scene the viewmodel scene
 */
export function createVmLighting(ctx, scene) {
  const amb = ctx.amb || { time: 'night' };
  const day = amb.time === 'day';
  const rig = ctx.lightRig || null;

  const hemi = new THREE.HemisphereLight('#9aaad0', '#3a3028', 1.0);
  const sun = new THREE.DirectionalLight('#ffffff', 0);
  const key = new THREE.DirectionalLight('#ffe8cc', 0);
  const rim = new THREE.DirectionalLight('#9cc0ff', 0);
  const bounce = new THREE.DirectionalLight('#ffe2c0', 0);
  key.position.set(-3, 6, 4);
  rim.position.set(4, 3, -8);
  bounce.position.set(0.15, -0.35, -1);
  scene.add(hemi, sun, key, rim, bounce);
  const nPool = POOL_N[ctx.quality] ?? POOL_N.high;
  const pool = [];
  for (let i = 0; i < POOL_N.cinematic; i++) {
    const p = new THREE.PointLight('#ffffff', 0, 1, 1.5);
    scene.add(p);
    pool.push(p);
  }

  const _qi = new THREE.Quaternion(), _v = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();
  const envRotation = new THREE.Euler();
  let sunVis = 1, sunT = 0, under = 0, frameNo = 0;
  const state = { envIntensity: 1, under: 0, sunVis: 1 };

  /** 0..1: how much of the sun reaches the eye (1 = clear sky). A 2D ray through the obstacles. */
  function sunVisibility(dir) {
    const map = ctx.map;
    if (!map || !map.obstacles || dir.y <= 0.02) return dir.y > 0.02 ? 1 : 0;
    const cam = ctx.camera.position;
    const hx = dir.x, hy = dir.z, hl = Math.hypot(hx, hy);
    if (hl < 1e-3) return 1;
    const ux = hx / hl, uy = hy / hl, tanE = dir.y / hl;
    const x0 = cam.x, y0 = cam.z, eye = cam.y;
    const tMax = Math.max(0, (420 - eye) / Math.max(0.05, tanE));
    for (const o of map.obstacles) {
      // quick reject: the obstacle's bounding circle against the ray segment
      const r = 0.5 * Math.hypot(o.w, o.h);
      const ox = o.x - x0, oy = o.y - y0;
      const along = ox * ux + oy * uy;
      if (along < -r || along > tMax + r) continue;
      if (Math.abs(ox * uy - oy * ux) > r) continue;
      let h = 0;
      try { h = ctx.heightOf ? ctx.heightOf(o.kind, o) : 60; } catch { h = 60; }
      if (!(h > eye - 4)) continue;
      // slab test in the rectangle's frame
      const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
      const px = -ox * c - oy * s, py = ox * s - oy * c;          // ray origin in rect frame
      const dx = ux * c + uy * s, dy = -ux * s + uy * c;
      let t0 = 0, t1 = tMax;
      const slab = (p, d, e) => {
        if (Math.abs(d) < 1e-6) return Math.abs(p) <= e;
        let a = (-e - p) / d, b = (e - p) / d;
        if (a > b) { const t = a; a = b; b = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        return t0 <= t1;
      };
      if (!slab(px, dx, o.w / 2) || !slab(py, dy, o.h / 2)) continue;
      if (eye + t0 * tanE < h) return 0;
    }
    return 1;
  }

  /** Mirror the world's lights into camera space (call right before the viewmodel is drawn). */
  function update() {
    frameNo++;
    const cam = ctx.camera;
    _qi.copy(cam.quaternion).invert();
    envRotation.setFromQuaternion(_qi);
    const eye = cam.position;
    // indoors: the indoor mask under the eye (story levels, Sandstone's tunnels)
    let u = 0;
    try { u = ctx.indoorAt ? ctx.indoorAt(eye.x, eye.z, eye.y) || 0 : 0; } catch { u = 0; }
    under += (u - under) * 0.15;
    const sky = 1 - under;
    // hemisphere: the world's colours and strength, "up" turned into camera space
    if (rig && rig.hemi) {
      hemi.color.copy(rig.hemi.color);
      hemi.groundColor.copy(rig.hemi.groundColor);
      hemi.intensity = rig.hemi.intensity * (day ? 0.55 : 0.9) * (0.35 + 0.65 * sky);
    } else hemi.intensity = 1.0 * (0.4 + 0.6 * sky);
    hemi.position.copy(_v.set(0, 1, 0).applyQuaternion(_qi));
    // sun / moon
    const moon = rig && rig.moon;
    const dir = rig && rig.sunDir ? rig.sunDir : _v.set(-0.45, 0.62, -0.64).normalize();
    if (frameNo % 6 === 1 || sunT === 0) { sunT = 1; sunVis += (sunVisibility(dir) - sunVis) * (frameNo < 3 ? 1 : 0.5); }
    if (moon) {
      sun.color.copy(moon.color);
      sun.intensity = moon.intensity * (day ? 0.95 : 1.4) * sunVis * (1 - under * 0.92);
    }
    sun.position.copy(dir).applyQuaternion(_qi);
    // night studio: a soft key and rim so the gun's outline reads in the dark; less indoors and by day
    const night = day ? 0 : 1;
    key.intensity = (day ? 0.25 : 1.45) * (0.55 + 0.45 * sky);
    rim.intensity = (day ? 0.2 : 1.1) * (0.6 + 0.4 * sky);
    // the flashlight's bounce from what it lights ahead (night, torch on)
    const torch = rig && rig.flashlight ? Math.min(1, rig.flashlight.intensity / 40) : 0;
    bounce.intensity = night * torch * 0.9;
    // pool lights: the strongest contributions at the eye, at their world places in camera space
    const lights = rig && rig.poolLights ? rig.poolLights : null;
    const best = [];
    if (lights) {
      for (const L of lights) {
        if (!L || !(L.intensity > 0)) continue;
        const dx = L.position.x - eye.x, dy = L.position.y - eye.y, dz = L.position.z - eye.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L.distance > 0 && d > L.distance) continue;
        const fall = L.distance > 0 ? Math.pow(Math.max(0, 1 - Math.pow(d / L.distance, 4)), 2) : 1;
        const w = L.intensity * fall / Math.max(1, Math.pow(d, L.decay || 1.5));
        if (w <= 1e-4) continue;
        best.push({ L, w, dx, dy, dz });
      }
      best.sort((a, b) => b.w - a.w);
    }
    for (let i = 0; i < pool.length; i++) {
      const P = pool[i], b = i < nPool ? best[i] : null;
      if (!b) { P.intensity = 0; continue; }
      P.position.set(b.dx, b.dy, b.dz).applyQuaternion(_qi);
      P.color.copy(b.L.color);
      P.intensity = b.L.intensity;
      P.distance = b.L.distance;
      P.decay = b.L.decay;
    }
    state.envIntensity = (day ? 0.9 : 1.15) * (0.18 + 0.82 * sky);
    state.under = under;
    state.sunVis = sunVis;
    state.envRotation = envRotation;
  }

  return {
    update,
    state,
    envRotation,
    /** The world's reflection probe when it is a PMREM (else null: the studio texture stays). */
    worldEnv() {
      const e = ctx.scene && ctx.scene.environment;
      return e && e.mapping === THREE.CubeUVReflectionMapping ? e : null;
    },
    dispose() {
      for (const l of [hemi, sun, key, rim, bounce, ...pool]) { l.removeFromParent(); if (l.dispose) l.dispose(); }
    },
    lights: { hemi, sun, key, rim, bounce, pool },
    tierHasPool: tierAtLeast(ctx.quality, 'high'),
  };
}
