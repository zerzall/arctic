// Daytime sky dome (WORLD, SPEC §7.5.1): the day counterpart of world-fx.js' night sky. A
// procedural gradient (deep blue overhead, pale haze at the horizon that matches the scene's
// fog colour), an HDR sun disc with a warm glow around it, thin drifting clouds (a high
// wispy layer and a fair-weather cumulus layer, lit from the sun's side, greyer underneath)
// and two distant mountain ridges re-tinted with the haze. Follows the camera; drawn first,
// without depth. Same interface as the night dome: a mesh with `userData.updateGlow`.

import * as THREE from 'three';

const NOISE = /* glsl */`
uniform float uTime;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

/**
 * @param {object} amb dayAmbientFor() result
 * @param {number} radius dome radius
 * @param {object} fx shared fx uniforms (uTime, ...)
 */
export function makeDaySky(amb, radius, fx) {
  const uniforms = {
    ...fx,
    uHorizon: { value: amb.horizon.clone() },
    uZenith: { value: amb.zenith.clone() },
    uFogCol: { value: amb.fog.clone() },
    uSunDir: { value: amb.sunDir.clone() },
    uSunColor: { value: amb.moon.clone() },
    uRidge: { value: amb.ridge.clone() },
    uCover: { value: amb.cover },
    uHeat: { value: amb.heat },
    uWarm: { value: amb.warm || 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: NOISE + `
      uniform vec3 uHorizon, uZenith, uFogCol, uSunDir, uSunColor, uRidge;
      uniform float uCover, uHeat, uWarm;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sd = max(dot(d, uSunDir), 0.0);
        // sky gradient: rises fast off the horizon (a long pale band), then deepens overhead
        float t = pow(clamp(h, 0.0, 1.0), 0.5);
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.92, t));
        // the sky is brighter and warmer toward the sun, and washed out low down
        col = mix(col, uHorizon * 1.05, exp(-max(h, 0.0) * 9.0) * 0.55);
        col += uSunColor * (pow(sd, 5.0) * 0.16 + pow(sd, 32.0) * 0.32 + pow(sd, 400.0) * 0.9);
        // golden hour (uWarm): the low sun paints the horizon band gold and rose, strongest on its own side
        if (uWarm > 0.0) {
          float az = pow(max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0), 2.0);
          vec3 gold = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.62, 0.42), smoothstep(0.0, 0.35, h));
          col = mix(col, gold * 1.05, uWarm * exp(-max(h, 0.0) * 5.5) * (0.28 + 0.72 * az));
          col += vec3(1.0, 0.55, 0.25) * uWarm * pow(sd, 3.0) * 0.55;
          col = mix(col, col * vec3(1.06, 0.92, 0.82), uWarm * 0.6);
        }
        // sun disc: HDR, well above the bloom knee so the bloom draws its halo
        float disc = smoothstep(0.99962, 0.99978, sd);
        // clouds: projected onto a plane so they compress toward the horizon
        vec2 cp = d.xz / (h + 0.22);
        float drift = uTime * 0.004;
        float lowC = fbm(cp * 0.85 + vec2(drift * 3.0, drift));
        float detail = fbm(cp * 2.6 + vec2(-drift * 2.0, drift * 1.5) + 7.3);
        float dens = smoothstep(1.02 - uCover * 0.62, 1.12 - uCover * 0.5, lowC * 0.82 + detail * 0.38);
        dens *= smoothstep(-0.02, 0.16, h);
        // high, thin cirrus streaks
        float hi = fbm(vec2(cp.x * 0.5 + drift * 5.0, cp.y * 2.6) + 3.1);
        float cirrus = smoothstep(0.5, 0.8, hi) * 0.4 * smoothstep(0.05, 0.4, h) * (1.0 - dens);
        // lit from the sun's side: the edge nearer the sun is bright, the belly greyer-blue
        float toSun = fbm(cp * 0.85 + vec2(drift * 3.0, drift) + uSunDir.xz * 0.35);
        float lit = clamp(0.6 + (lowC - toSun) * 3.2, 0.0, 1.0);
        vec3 cloudLit = mix(vec3(1.02, 1.0, 0.97), vec3(1.25, 0.78, 0.5), uWarm) * (0.95 + 0.35 * pow(sd, 6.0));
        vec3 cloudShade = mix(uHorizon, uZenith, 0.45) * mix(vec3(0.78), vec3(0.86, 0.66, 0.66), uWarm);
        vec3 cloud = mix(cloudShade, cloudLit, lit * (1.0 - 0.45 * dens * detail));
        // silver lining where thin cloud crosses the sun
        cloud += uSunColor * pow(sd, 12.0) * (1.0 - dens) * 0.5;
        col = mix(col, cloud, clamp(dens * 0.94 + cirrus * 0.55, 0.0, 1.0));
        col = mix(col, uSunColor * 14.0, disc * (1.0 - dens * 0.9));
        // distant mountains: two ridges dissolving into the haze
        vec2 ac = normalize(d.xz + 1e-5);
        float r1 = 0.032 + 0.07 * fbm(ac * 2.1 + 3.7) + 0.01 * vnoise(ac * 23.0);
        float r2 = 0.014 + 0.05 * fbm(ac * 4.3 + 11.2) + 0.006 * vnoise(ac * 41.0);
        float m1 = smoothstep(r1 + 0.0012, r1 - 0.0012, h);
        float m2 = smoothstep(r2 + 0.0012, r2 - 0.0012, h);
        float sunSide = pow(max(dot(ac, normalize(uSunDir.xz + 1e-5)), 0.0), 2.0);
        vec3 far = mix(uRidge, uHorizon, 0.62 + 0.12 * (1.0 - sunSide));
        vec3 near = mix(uRidge, uHorizon, 0.34 + 0.12 * (1.0 - sunSide));
        // snow-ish light on the upper edge of the nearer ridge, fading into the haze low down
        near *= 0.86 + 0.3 * smoothstep(r1 - 0.05, r1, h);
        col = mix(col, far, m1 * 0.94);
        col = mix(col, near, m2 * 0.94);
        // heat shimmer band and the haze at the very horizon: exactly the fog colour there
        col = mix(col, uFogCol, exp(-abs(h) * (14.0 - 6.0 * uHeat)) * (0.55 + 0.35 * uHeat));
        float below = smoothstep(0.0, -0.06, h);
        col = mix(col, uFogCol, below);
        gl_FragColor = vec4(col, 1.0);
      ` + '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  mesh.userData.updateGlow = () => {};
  return mesh;
}
