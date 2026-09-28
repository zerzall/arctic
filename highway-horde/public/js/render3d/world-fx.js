// Animated / atmospheric pieces of the static world (WORLD): night sky dome, permanent
// fires (flames, embers, smoke), lamp halos, light shafts, the fake far light pools on the
// ground and the objective marker. Each is ONE draw call with a small custom shader that
// animates on the GPU from a shared `uTime` uniform, so there is no per-frame CPU work
// beyond a few uniform writes. Additive pieces fade with the scene's exp² fog.

import * as THREE from 'three';

/** Uniforms shared by every world effect shader. */
export function createFxUniforms() {
  return {
    uTime: { value: 0 },
    uFog: { value: 0.001 },
    uFogColor: { value: new THREE.Color('#000000') },
    uPx: { value: 500 },          // pixels per world unit at distance 1 (points sizing)
  };
}

const COMMON = /* glsl */`
uniform float uTime;
uniform float uFog;
uniform vec3 uFogColor;
uniform float uPx;
float fogVis(float d) { return exp(-uFog * uFog * d * d); }
float h11(float n) { return fract(sin(n) * 43758.5453123); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

const TONE = `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

function additive(uniforms, vertexShader, fragmentShader, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...extra,
  });
}

// ---- sky ----------------------------------------------------------------------------------

/**
 * Night sky dome: gradient, two drifting cloud layers (silver-lined around the moon, lit
 * orange from below toward the burning wrecks), a star field and an HDR moon (its disc is
 * far above the bloom threshold, so the bloom pass draws its halo). Follows the camera;
 * drawn first, without depth, so it never clips anything.
 * @param {Array<{x, y, r}>} [fires] burning spots: their glow tints the clouds above them
 */
export function makeSky(amb, radius, fx, fires = []) {
  // the biggest fires, merged when close: at most 4 glow sources
  const clusters = [];
  for (const f of [...fires].sort((a, b) => b.r - a.r)) {
    const c = clusters.find((k) => Math.hypot(k.x - f.x, k.y - f.y) < 500);
    if (c) c.r += f.r * 0.5;
    else if (clusters.length < 4) clusters.push({ x: f.x, y: f.y, r: f.r });
  }
  const uniforms = {
    ...fx,
    uHorizon: { value: amb.horizon.clone() },
    uZenith: { value: amb.zenith.clone() },
    uMoonDir: { value: new THREE.Vector3(-0.45, 0.42, -0.64).normalize() },
    uMoonColor: { value: new THREE.Color('#dfe8ff') },
    uCloud: { value: amb.fog.clone().lerp(new THREE.Color('#000000'), 0.3) },
    uGlow: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: COMMON + `
      uniform vec3 uHorizon, uZenith, uMoonDir, uMoonColor, uCloud;
      uniform vec4 uGlow[4];
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, smoothstep(-0.03, 0.55, h));
        col += uHorizon * 0.4 * exp(-abs(h) * 16.0);
        float md = dot(d, uMoonDir);
        // fire glow toward the burning wrecks: horizon band and cloud bellies
        vec3 fireGlow = vec3(0.0);
        vec2 dh = normalize(d.xz + 1e-5);
        for (int i = 0; i < 4; i++) {
          float k = pow(max(dot(dh, uGlow[i].xy), 0.0), 6.0) * uGlow[i].z;
          fireGlow += vec3(1.0, 0.36, 0.08) * k * exp(-max(h, 0.0) * uGlow[i].w);
        }
        col += fireGlow * 0.14;
        // stars: one candidate per cell of a 3D grid over the direction, a few coloured
        vec3 p = d * 300.0;
        vec3 c = floor(p);
        float r = h21(c.xy + c.z * 17.13);
        float star = 0.0;
        vec3 starCol = vec3(0.85, 0.9, 1.0);
        if (r > 0.965) {
          vec3 o = vec3(h21(c.yz), h21(c.zx), h21(c.xy + 3.1)) * 0.6 + 0.2;
          float dd = length(fract(p) - o);
          float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 5.0) + r * 80.0);
          float mag = pow((r - 0.965) / 0.035, 2.5);
          star = smoothstep(0.14, 0.0, dd) * (0.35 + mag * 2.6) * tw * smoothstep(0.02, 0.3, h);
          starCol = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), h21(c.zy));
        }
        // two cloud layers drifting at different speeds
        vec2 cp = d.xz / (h + 0.25);
        float cl1 = fbm(cp * 1.3 + vec2(uTime * 0.006, uTime * 0.002));
        float cl2 = fbm(cp * 3.1 + vec2(-uTime * 0.004, uTime * 0.005) + 7.3);
        float cover = smoothstep(0.46, 0.8, cl1 * 0.75 + cl2 * 0.35) * smoothstep(-0.05, 0.22, h);
        float thin = smoothstep(0.5, 0.95, cl1) ;
        float moonLit = pow(max(md, 0.0), 10.0);
        // silver lining: thin cloud edges near the moon light up
        vec3 cloud = uCloud * (0.8 + 0.4 * cl2) + uMoonColor * (0.07 * moonLit + 0.35 * moonLit * (1.0 - thin) * cover);
        cloud += fireGlow * (0.55 + 0.45 * (1.0 - thin)) * 0.38;
        col += starCol * star * (1.0 - cover);
        // moon: HDR disc with maria, a tight corona and a wide faint glow
        float disc = smoothstep(0.99955, 0.99968, md);
        vec3 mdir = normalize(d - uMoonDir * md);
        float maria = fbm(mdir.xy * 60.0 + mdir.z * 31.0) ;
        vec3 moon = uMoonColor * (5.5 - smoothstep(0.45, 0.7, maria) * 1.6);
        col += uMoonColor * (pow(max(md, 0.0), 2200.0) * 1.1 + pow(max(md, 0.0), 160.0) * 0.14 + pow(max(md, 0.0), 14.0) * 0.035);
        col = mix(col, moon, disc * (1.0 - cover * 0.85));
        col = mix(col, cloud, cover * 0.92);
        gl_FragColor = vec4(col, 1.0);
      ` + TONE + '}',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  /** Point the glow at the fire clusters as seen from (x, y) (cheap: 4 vectors). */
  mesh.userData.updateGlow = (x, y) => {
    for (let i = 0; i < 4; i++) {
      const g = uniforms.uGlow.value[i];
      const c = clusters[i];
      if (!c) { g.set(0, 0, 0, 1); continue; }
      const dx = c.x - x, dy = c.y - y, dist = Math.hypot(dx, dy) || 1;
      // near fires light the clouds right above: wide, climbing; far ones only the horizon
      g.set(dx / dist, dy / dist, Math.min(1.6, (c.r * 18) / (dist + 300)), 2 + dist / 260);
    }
  };
  mesh.userData.updateGlow(0, 0);
  return mesh;
}

// ---- fire ---------------------------------------------------------------------------------

/**
 * Flames for permanent fires: two camera-facing (upright) billboards per fire, shaded with
 * scrolling noise. Billboards rather than crossed quads: seen edge-on, crossed quads left
 * a dark slit, and three of them stacked additively saturated into a white disc.
 * @param {Array<{x, y, base, r}>} fires
 */
export function makeFlames(fires, fx) {
  const pos = [], corner = [], uv = [], seed = [];
  fires.forEach((f, i) => {
    for (let k = 0; k < 2; k++) {
      // the back sheet is wider and a little shorter: a body of fire, not a paper cut-out
      const w = f.r * (k ? 2.5 : 1.9), h = f.r * (k ? 2.7 : 3.2);
      const y0 = f.base - f.r * 0.15, y1 = f.base + h;
      const q = [[-1, y0, 0, 0], [1, y0, 1, 0], [1, y1, 1, 1], [-1, y0, 0, 0], [1, y1, 1, 1], [-1, y1, 0, 1]];
      for (const [cx, y, u, v] of q) {
        pos.push(f.x, y, f.y);
        // pulled toward the camera: a fire burns on a wreck, and a sheet through its middle
        // was clipped by the body into a glowing disc (a tanker's end cap) instead of
        // reading as flames in front of it
        corner.push(cx * w / 2, k ? -f.r * 0.2 : -f.r * 0.75);
        uv.push(u, v);
        seed.push(i * 1.37 + k * 0.53);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  const mat = additive(fx, `
    attribute float aSeed; attribute vec2 aCorner;
    varying vec2 vUv; varying float vSeed; varying float vDepth;
    void main() {
      vUv = uv; vSeed = aSeed;
      // upright billboard: spread the corners across the view, pushed back by aCorner.y
      vec3 toCam = cameraPosition - position;
      vec2 d = normalize(toCam.xz + vec2(1e-4, 0.0));
      vec3 right = vec3(d.y, 0.0, -d.x);
      vec3 p = position + right * aCorner.x - vec3(d.x, 0.0, d.y) * aCorner.y;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`, COMMON + `
    varying vec2 vUv; varying float vSeed; varying float vDepth;
    void main() {
      float t = uTime + vSeed * 13.0;
      float x = (vUv.x - 0.5) * 2.0;
      float y = vUv.y;
      x += (vnoise(vec2(y * 3.0 - t * 1.7, vSeed)) - 0.5) * 0.55 * y;
      float n = fbm(vec2(vUv.x * 3.2 + vSeed * 5.0, y * 2.4 - t * 2.6));
      // teardrop: narrow at the base, widest low down, licking to a point
      float width = ((1.0 - y) * 0.95 + 0.05) * smoothstep(-0.35, 0.22, y);
      float body = 1.0 - smoothstep(0.3 * width, width, abs(x));
      float f = body * (1.2 - y * 1.1) - n * 0.8 + 0.2;
      f = clamp(f, 0.0, 1.0);
      // the base fades in: it sits in the wreck, and a saturated blob there read as a
      // glowing ball stuck to the body instead of flames licking up from it
      f *= smoothstep(0.0, 0.3, y);
      vec3 col = mix(vec3(0.75, 0.1, 0.01), vec3(1.0, 0.42, 0.07), smoothstep(0.12, 0.55, f));
      col = mix(col, vec3(1.0, 0.75, 0.4), smoothstep(0.85, 1.0, f));
      float a = smoothstep(0.02, 0.45, f) * fogVis(vDepth);
      gl_FragColor = vec4(col * 0.7, a * 0.7);
    ` + TONE + '}', { side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'fire-flames';
  mesh.frustumCulled = false;   // corners are spread in the vertex shader
  mesh.renderOrder = 10;
  return mesh;
}

/** Glowing embers rising from fires (GPU animated points). */
export function makeEmbers(fires, fx) {
  const pos = [], seed = [], rad = [];
  fires.forEach((f, i) => {
    const n = Math.round(8 + f.r * 0.6);
    for (let k = 0; k < n; k++) {
      pos.push(f.x + (Math.random() - 0.5) * f.r, f.base + f.r * 0.3, f.y + (Math.random() - 0.5) * f.r);
      seed.push(Math.random());
      rad.push(f.r);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(rad, 1));
  const mat = additive(fx, COMMON + `
    attribute float aSeed; attribute float aR;
    varying float vA;
    void main() {
      float ph = fract(uTime * (0.25 + 0.25 * fract(aSeed * 7.3)) + aSeed);
      vec3 p = position;
      p.y += ph * aR * 7.0;
      p.x += sin(ph * 5.0 + aSeed * 30.0) * aR * 0.5 * ph + ph * ph * aR * 1.4;
      p.z += cos(ph * 4.0 + aSeed * 21.0) * aR * 0.5 * ph;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = clamp(uPx * 2.2 / -mv.z, 1.0, 6.0);
      vA = (1.0 - ph) * fogVis(-mv.z) * (0.6 + 0.4 * sin(uTime * 20.0 + aSeed * 50.0));
      gl_Position = projectionMatrix * mv;
    }`, `
    varying float vA;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.1, r) * vA;
      gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * 2.0, a);
    ` + TONE + '}');
  const pts = new THREE.Points(g, mat);
  pts.name = 'fire-embers';
  pts.frustumCulled = false;
  return pts;
}

/** Smoke columns over the bigger fires (alpha blended, lit orange at the base). */
export function makeSmoke(fires, fx) {
  const pos = [], seed = [], rad = [];
  for (const f of fires) {
    const n = f.r > 16 ? 14 : 6;
    for (let k = 0; k < n; k++) {
      pos.push(f.x, f.base + f.r, f.y);
      seed.push(k / n + Math.random() * 0.05);
      rad.push(f.r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(rad, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: fx,
    vertexShader: COMMON + `
      attribute float aSeed; attribute float aR;
      varying float vA; varying vec3 vCol; varying float vRot;
      void main() {
        float ph = fract(uTime * 0.055 * (0.85 + 0.3 * fract(aSeed * 13.1)) + aSeed);
        vec3 p = position;
        p.y += ph * (aR * 9.0 + 160.0);
        p.x += ph * ph * (aR * 5.0 + 60.0) + sin(aSeed * 40.0) * aR * 0.4;
        p.z += cos(aSeed * 31.0) * aR * 0.4 * ph;
        float size = aR * 1.3 + ph * (aR * 5.0 + 40.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uPx * size / -mv.z, 1.0, 420.0);
        float v = fogVis(-mv.z);
        vA = smoothstep(0.0, 0.1, ph) * (1.0 - ph) * 0.55;
        vCol = mix(vec3(0.42, 0.2, 0.07), vec3(0.075, 0.07, 0.068), smoothstep(0.0, 0.3, ph));
        vCol = mix(uFogColor, vCol, v);
        vRot = aSeed * 6.28;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: COMMON + `
      varying float vA; varying vec3 vCol; varying float vRot;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q);
        float n = vnoise(q * 5.0 + vRot * 3.0);
        float a = smoothstep(0.5, 0.15, r + (n - 0.5) * 0.25) * vA;
        gl_FragColor = vec4(vCol, a);
      ` + TONE + '}',
    transparent: true, depthWrite: false, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'fire-smoke';
  pts.frustumCulled = false;
  pts.renderOrder = 12;
  return pts;
}

// ---- lamp glow ------------------------------------------------------------------------------

/**
 * Soft halos around lamp heads and fires (additive points). flicker > 0 follows the fire
 * flicker; blink > 0 blinks (radio mast beacons). base (optional): the height the glow sits
 * on — it fades out above that line instead of being cut there by the ground's depth.
 * @param {Array<{x, y, h, color, size, flicker, blink, strength, base}>} list
 */
export function makeHalos(list, fx) {
  const pos = [], col = [], size = [], fl = [];
  const c = new THREE.Color();
  for (const l of list) {
    pos.push(l.x, l.h, l.y);
    c.set(l.color).multiplyScalar(l.strength ?? 1);
    col.push(c.r, c.g, c.b);
    size.push(l.size);
    fl.push(l.flicker || 0, l.blink || 0, Number.isFinite(l.base) ? l.base : -1e5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aFx', new THREE.Float32BufferAttribute(fl, 3));
  const mat = additive(fx, COMMON + `
    attribute vec3 aColor; attribute float aSize; attribute vec3 aFx;
    varying vec3 vCol;
    varying float vCut;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float k = 1.0;
      if (aFx.x > 0.0) k *= 1.0 - aFx.x * 0.5 * (0.5 + 0.5 * sin(uTime * 11.0 + position.x) * sin(uTime * 7.0 + position.z));
      if (aFx.y > 0.0) {
        // same phase as world-mat's blink material (per 48-unit neighbourhood)
        float ph = fract(sin(dot(floor(position.xz / 48.0), vec2(12.9898, 78.233))) * 43758.5453);
        k *= step(0.5, fract(uTime * (0.75 + ph * 0.5) + ph));
      }
      gl_PointSize = clamp(uPx * aSize / -mv.z, 0.0, 600.0);
      vCol = aColor * k * fogVis(-mv.z * 0.8);
      gl_Position = projectionMatrix * mv;
      // A sprite is flat at its centre's depth: the ground in front of a fire's glow cut it
      // along a hard horizontal line. Where that line falls (in sprite half-sizes below the
      // centre) lets the fragment fade the glow out just above it.
      vCut = 1e3;   // no base (lamps): nothing to fade
      if (aFx.z > -1e4) {
        vec4 gb = projectionMatrix * modelViewMatrix * vec4(position.x, aFx.z, position.z, 1.0);
        float halfNdc = gl_PointSize * projectionMatrix[1][1] / max(2.0 * uPx, 1e-3);
        if (gb.w > 1e-3 && gl_Position.w > 1e-3) vCut = (gl_Position.y / gl_Position.w - gb.y / gb.w) / max(halfNdc, 1e-4);
      }
    }`, `
    varying vec3 vCol;
    varying float vCut;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float a = exp(-r * r * 5.0) * 0.8 + exp(-r * r * 40.0) * 0.9;
      // sprite y: +1 top, -1 bottom; the base line sits at -vCut
      float py = 1.0 - gl_PointCoord.y * 2.0;
      a *= smoothstep(-vCut, -vCut + 0.45, py);
      gl_FragColor = vec4(vCol, a);
    ` + TONE + '}');
  const pts = new THREE.Points(g, mat);
  pts.name = 'halos';
  pts.frustumCulled = false;
  pts.renderOrder = 11;
  return pts;
}

/**
 * Faint volumetric light cones under street lamps.
 * @param {Array<{x, y, h, color, radius, strength}>} list
 */
export function makeShafts(list, fx) {
  const tpl = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).toNonIndexed();
  const tp = tpl.attributes.position.array, tn = tpl.attributes.normal.array;
  const pos = [], nor = [], col = [], hh = [], ctr = [];
  const c = new THREE.Color();
  for (const l of list) {
    c.set(l.color).multiplyScalar(l.strength ?? 1);
    for (let i = 0; i < tp.length / 3; i++) {
      ctr.push(l.x, l.y, l.radius);
      const top = tp[i * 3 + 1] > 0;
      const r = top ? 7 : l.radius;
      pos.push(l.x + tp[i * 3] * r, top ? l.h : 0, l.y + tp[i * 3 + 2] * r);
      nor.push(tn[i * 3], 0, tn[i * 3 + 2]);
      col.push(c.r, c.g, c.b);
      hh.push(top ? 0 : 1);
    }
  }
  tpl.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(ctr, 3));
  const mat = additive(fx, `
    attribute vec3 aColor; attribute float aH; attribute vec3 aCenter;
    varying vec3 vCol; varying float vH; varying vec3 vN; varying vec3 vV; varying float vDepth;
    void main() {
      // standing in (or next to) a shaft, its far wall faced the eye across the whole view
      // as a flat grey band: the cone only reads from outside, so fade it as we walk in
      float inside = length(cameraPosition.xz - aCenter.xy) / max(1.0, aCenter.z);
      vCol = aColor * smoothstep(0.85, 1.6, inside); vH = aH;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`, COMMON + `
    varying vec3 vCol; varying float vH; varying vec3 vN; varying vec3 vV; varying float vDepth;
    void main() {
      float facing = abs(dot(normalize(vN), normalize(vV)));
      float a = pow(1.0 - vH, 1.4) * 0.8 + 0.08;
      a *= facing * facing * 0.09;
      a *= smoothstep(0.0, 60.0, vDepth) * fogVis(vDepth);
      gl_FragColor = vec4(vCol, a);
    ` + TONE + '}', { side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'light-shafts';
  mesh.renderOrder = 9;
  return mesh;
}

/**
 * Additive light pools painted on the ground for every map light, scaled per light by
 * `setLevels` so they stand in for lamps the fixed light pool does not cover right now.
 * @param {Array<{x, y, r, color, flicker, strength, base}>} list
 */
export function makePools(list, fx) {
  const pos = [], uv = [], col = [], lvl = [], fl = [];
  const c = new THREE.Color();
  for (const l of list) {
    c.set(l.color).multiplyScalar(l.strength);
    const r = l.r, y = (l.base || 0) + 0.35;
    const q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const [u, v] of q) {
      pos.push(l.x + u * r, y, l.y + v * r);
      uv.push(u, v);
      col.push(c.r, c.g, c.b);
      lvl.push(1);
      fl.push(l.flicker || 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  const levelAttr = new THREE.Float32BufferAttribute(lvl, 1);
  levelAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aLevel', levelAttr);
  g.setAttribute('aFlicker', new THREE.Float32BufferAttribute(fl, 1));
  const mat = additive(fx, COMMON + `
    attribute vec3 aColor; attribute float aLevel; attribute float aFlicker;
    varying vec3 vCol; varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float k = 1.0 - aFlicker * 0.4 * (0.5 + 0.5 * sin(uTime * 11.3 + position.x * 0.1) * sin(uTime * 6.1 + position.z));
      vCol = aColor * aLevel * k * fogVis(-mv.z);
      gl_Position = projectionMatrix * mv;
    }`, `
    varying vec3 vCol; varying vec2 vUv;
    void main() {
      float r = length(vUv);
      float a = pow(max(0.0, 1.0 - r), 2.2);
      gl_FragColor = vec4(vCol, a);
    ` + TONE + '}', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'light-pools';
  mesh.renderOrder = 5;
  return {
    mesh,
    /** levels[i] = 0..1 how much fake pool light i shows (1 - real light level). */
    setLevels(levels) {
      const a = levelAttr.array;
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const v = levels[i];
        if (Math.abs(a[i * 6] - v) > 0.004) {
          for (let k = 0; k < 6; k++) a[i * 6 + k] = v;
          changed = true;
        }
      }
      if (changed) levelAttr.needsUpdate = true;
    },
  };
}

/** A soft pulsing ring on the ground around the objective. */
export function makeMarker(obj, fx) {
  const r0 = Math.hypot(obj.w, obj.h) / 2 + 26, r1 = r0 + 16;
  const g = new THREE.RingGeometry(r0, r1, 72, 1);
  g.rotateX(-Math.PI / 2);
  g.rotateY(-(obj.a || 0));
  g.translate(obj.x, 0.5, obj.y);
  const mat = additive({ ...fx, uR0: { value: r0 }, uR1: { value: r1 }, uC: { value: new THREE.Vector2(obj.x, obj.y) } }, `
    varying vec3 vW; varying float vDepth;
    void main() {
      vW = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`, COMMON + `
    uniform float uR0, uR1; uniform vec2 uC;
    varying vec3 vW; varying float vDepth;
    void main() {
      vec2 d = vW.xz - uC;
      float r = (length(d) - uR0) / (uR1 - uR0);
      float band = smoothstep(0.0, 0.5, r) * smoothstep(1.0, 0.5, r);
      float ang = atan(d.y, d.x);
      float dash = 0.6 + 0.4 * step(0.5, fract(ang * 6.0 / 3.14159 + uTime * 0.08));
      float pulse = 0.55 + 0.45 * sin(uTime * 1.8);
      gl_FragColor = vec4(vec3(0.45, 0.85, 1.0), band * dash * pulse * 0.32 * fogVis(vDepth));
    ` + TONE + '}', { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'objective-marker';
  mesh.renderOrder = 6;
  return mesh;
}

// ---- rain ---------------------------------------------------------------------------------------

const RAIN_LIGHTS = 12;

/**
 * Light rain ('ultra'): streaks in a box that wraps around the camera (world-anchored
 * columns, so nothing swims when turning), falling and slanting in the wind, lit only by
 * what lights them in reality — the pool lights near them and the flashlight cone — so
 * they read as rain in the lamp light and vanish in the dark. One draw call.
 * @param {number} count streaks
 */
export function makeRain(fx, count = 5000) {
  const pos = [], seed = [], corner = [];
  let s = 12345;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < count; i++) {
    const a = rnd(), b = rnd(), c = rnd(), d = rnd();
    for (const [cx, cy] of [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]]) {
      pos.push(0, 0, 0);
      seed.push(a, b, c, d);
      corner.push(cx, cy);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  const uniforms = {
    ...fx,
    uBox: { value: new THREE.Vector3(420, 260, 420) },
    uLightPos: { value: Array.from({ length: RAIN_LIGHTS }, () => new THREE.Vector4()) },
    uLightCol: { value: Array.from({ length: RAIN_LIGHTS }, () => new THREE.Vector3()) },
    uFlash: { value: new THREE.Vector4(0, 0, -1, 0) },
    uFlashPos: { value: new THREE.Vector3() },
    uStrength: { value: 1 },
  };
  const mat = additive(uniforms, COMMON + `
    uniform vec3 uBox;
    uniform vec4 uLightPos[${RAIN_LIGHTS}];
    uniform vec3 uLightCol[${RAIN_LIGHTS}];
    uniform vec4 uFlash;
    uniform vec3 uFlashPos;
    attribute vec4 aSeed;
    attribute vec2 aCorner;
    varying vec3 vCol;
    varying float vA;
    varying float vX;
    void main() {
      vec3 cam = cameraPosition;
      // columns anchored in the world, wrapped into the box around the camera
      vec2 xz = cam.xz + (fract(aSeed.xz - cam.xz / uBox.xz) - 0.5) * uBox.xz;
      float speed = 560.0 + aSeed.w * 160.0;
      float y = cam.y + (fract(aSeed.y - uTime * speed / uBox.y) - 0.45) * uBox.y;
      vec3 base = vec3(xz.x, y, xz.y);
      vec3 fall = normalize(vec3(0.12, -1.0, 0.05));
      vec3 toCam = normalize(cam - base);
      vec3 right = normalize(cross(fall, toCam));
      float len = 9.0 + aSeed.w * 6.0;
      vec3 p = base + right * aCorner.x * 0.22 - fall * aCorner.y * len;
      // light: pool lights nearby + the flashlight cone
      vec3 L = vec3(0.0);
      for (int i = 0; i < ${RAIN_LIGHTS}; i++) {
        vec3 d = uLightPos[i].xyz - base;
        float r = max(uLightPos[i].w, 1.0);
        float k = clamp(1.0 - dot(d, d) / (r * r), 0.0, 1.0);
        L += uLightCol[i] * k * k;
      }
      vec3 fd = base - uFlashPos;
      float fl = length(fd);
      float cone = smoothstep(0.86, 0.97, dot(fd / max(fl, 1e-3), uFlash.xyz));
      L += vec3(1.0, 0.95, 0.85) * cone * uFlash.w * clamp(1.0 - fl / 520.0, 0.0, 1.0);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float dist = -mv.z;
      vCol = L * 0.16;
      vA = smoothstep(6.0, 22.0, dist) * (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, dist)) * fogVis(dist);
      vX = aCorner.x;
      gl_Position = projectionMatrix * mv;
    }`, `
    varying vec3 vCol;
    varying float vA;
    varying float vX;
    uniform float uStrength;
    void main() {
      float a = (1.0 - vX * vX) * vA * uStrength;
      gl_FragColor = vec4(vCol * a, a);
    ` + TONE + '}');
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 13;
  const _f = new THREE.Vector3();
  return {
    mesh,
    /**
     * @param {THREE.PointLight[]} pool the light pool (positions, colours, intensities)
     * @param {THREE.SpotLight} flash the flashlight
     */
    update(pool, flash, camera) {
      const P = uniforms.uLightPos.value, C = uniforms.uLightCol.value;
      for (let i = 0; i < RAIN_LIGHTS; i++) {
        const l = pool[i];
        if (!l || l.intensity <= 0) { P[i].set(0, -1e5, 0, 1); C[i].set(0, 0, 0); continue; }
        P[i].set(l.position.x, l.position.y, l.position.z, l.distance || 300);
        C[i].copy(l.color).multiplyScalar(Math.min(4, l.intensity / 5.5));
      }
      camera.getWorldDirection(_f);
      uniforms.uFlash.value.set(_f.x, _f.y, _f.z, flash && flash.intensity > 0 ? 1.4 : 0);
      uniforms.uFlashPos.value.copy(flash ? flash.position : camera.position);
    },
    setStrength(v) { uniforms.uStrength.value = v; },
  };
}
