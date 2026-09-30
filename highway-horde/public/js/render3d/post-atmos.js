// Atmosphere and wet-ground reflections of the first-person view (WORLD, SPEC §7.5), one
// post pass between the ambient occlusion and the viewmodel (the gun is never fogged or
// reflected). Both parts work from the world pass' HDR colour and depth only:
//
//   volumetrics  low-lying ground mist (analytic height-fog integral, drifting in patches)
//                and the light pool scattering in the air: every pool light (lamps, fires,
//                muzzle flashes, explosions) is integrated in closed form along the view ray
//                up to the depth there, so lamps hang in a glowing haze, silhouettes stand
//                out against it and a lamp's light is cut under its shade. 'ultra' also
//                marches the local flashlight's beam through the haze. Half resolution on
//                'ultra', quarter on 'high' (and no beam); off on 'low'.
//   reflections  screen-space reflections on the wet ground and the water: the reflected ray
//                is marched through the depth buffer; puddles (the ground shader's own puddle
//                mask, rebuilt from the world position) and water are mirrors, wet asphalt
//                gets a vertical streak blur like a real wet road. Rays that escape to the
//                sky pick up the brightest sky pixels they crossed (lamp halos, the moon,
//                flames over the skyline). Half resolution, 28 steps on 'ultra'; quarter,
//                16 steps on 'high'; off on 'low'.
//
// A full-resolution composite then upsamples both with depth-aware (joint bilateral)
// weights and writes colour × transmittance + in-scatter + reflection into the other
// buffer (the pass swaps). Draw calls: 2–3.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { tierAtLeast } from './tier.js';

export const ATMOS_LIGHTS = 12;

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// shared: depth → view / world position
const DEPTH_PARS = `
#include <packing>
uniform highp sampler2D tDepth;
uniform float uNear, uFar;
uniform mat4 uProjInv, uCamWorld;
float hhViewZ(float d) { return perspectiveDepthToViewZ(d, uNear, uFar); }
vec3 hhViewPos(vec2 uv, float d) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
float hhHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hhIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hhNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hhHash(i), hhHash(i + vec2(1, 0)), f.x), mix(hhHash(i + vec2(0, 1)), hhHash(i + vec2(1, 1)), f.x), f.y);
}
`;

const VOL_FRAG = `
precision highp float;
${DEPTH_PARS}
uniform vec4 uLPos[${ATMOS_LIGHTS}];   // xyz, radius (0 = off)
uniform vec4 uLCol[${ATMOS_LIGHTS}];   // rgb × intensity, kind (1 = lamp under a shade)
uniform vec3 uCamPos;
uniform vec3 uMistCol;
uniform float uMist, uMistH, uScatter, uMistScatter, uFog, uSkyDist, uTime;
uniform vec3 uFlashPos, uFlashDir, uFlashCol;
uniform vec4 uFlash;                    // cos outer, cos inner, range, steps (0 = no beam)
varying vec2 vUv;

// integral of the lamp's window (1 - d²/R²)² over u (offset from the closest point)
float hhWin(float u, float a, float k) {
  float u2 = u * u;
  return u * (a * a - (2.0 / 3.0) * a * k * u2 + 0.2 * k * k * u2 * u2);
}
float hhMistAt(float y) { return exp(-max(y, 0.0) / uMistH); }

void main() {
  float depth = texture2D(tDepth, vUv).x;
  bool sky = depth >= 0.999999;
  vec3 vp = hhViewPos(vUv, sky ? 0.5 : depth);
  vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
  vec3 O = uCamPos;
  vec3 D = wp - O;
  float S = length(D);
  D /= max(S, 1e-4);
  if (sky) S = uSkyDist;
  S = min(S, uSkyDist);
  vec3 P = O + D * S;

  // ---- ground mist: density m0 * exp(-y / H), integrated along the ray ----
  // drifting patches: the density at the far end of the ray (where most of it is seen)
  float drift = uTime * 6.0;
  vec2 nq = (sky ? O.xz + D.xz * 700.0 : P.xz) / 520.0 + vec2(drift, drift * 0.6) / 520.0;
  float patchy = 0.45 + 1.1 * (hhNoise(nq) * 0.65 + hhNoise(nq * 2.7 + 5.2) * 0.35);
  float y0 = O.y, dy = D.y;
  float tau;
  if (abs(dy) < 1e-3) tau = hhMistAt(y0) * S;
  else tau = uMistH / dy * (hhMistAt(y0) - hhMistAt(y0 + dy * S));
  tau = max(tau, 0.0) * uMist * patchy;
  float T = exp(-tau);
  vec3 L = uMistCol * (1.0 - T);

  // ---- the light pool scattering in the air (closed form per light) ----
  for (int i = 0; i < ${ATMOS_LIGHTS}; i++) {
    vec4 lp = uLPos[i];
    if (lp.w <= 0.0) continue;
    vec3 oc = lp.xyz - O;
    float t0 = dot(oc, D);
    float h2 = max(dot(oc, oc) - t0 * t0, 0.0);
    float R2 = lp.w * lp.w;
    if (h2 >= R2) continue;
    float c = sqrt(R2 - h2);
    float a = max(0.0, t0 - c), b = min(S, t0 + c);
    if (b <= a) continue;
    float u1 = a - t0, u2 = b - t0;
    float wa = 1.0 - h2 / R2, wk = 1.0 / R2;
    float broad = hhWin(u2, wa, wk) - hhWin(u1, wa, wk);
    // a tighter core (Lorentzian) for the glow right around the source
    float E = lp.w * 0.09;
    float q = sqrt(h2 + E * E);
    float core = E * E * (atan(u2 / q) - atan(u1 / q)) / q;
    float tc = clamp(t0, a, b);
    float yc = O.y + D.y * tc;
    float k = broad * 0.55 + core * 1.7;
    // a street lamp shines down from under its shade: no haze above it
    if (uLCol[i].w > 0.5) k *= smoothstep(lp.y + 6.0, lp.y - 50.0, yc);
    float dens = uScatter + uMistScatter * hhMistAt(yc) * patchy;
    float fogT = exp(-uFog * uFog * tc * tc);
    L += uLCol[i].rgb * min(k * dens * fogT, 0.45);
  }

  // ---- the flashlight's beam ('ultra'): a short dithered march through the cone ----
  if (uFlash.w > 0.5) {
    float end = min(S, uFlash.z);
    float n = uFlash.w;
    float jit = hhIgn(gl_FragCoord.xy + fract(uTime * 7.0) * 61.0);
    float acc = 0.0;
    float dt = end / n;
    for (int s = 0; s < 16; s++) {
      if (float(s) >= n) break;
      float t = (float(s) + jit) * dt;
      vec3 p = O + D * t;
      vec3 v = p - uFlashPos;
      float dl = length(v);
      float cone = smoothstep(uFlash.x, uFlash.y, dot(v / max(dl, 1e-3), uFlashDir));
      float att = 1.0 / max(pow(dl, 1.12), 60.0);
      float win = 1.0 - pow(min(dl / uFlash.z, 1.0), 4.0);
      acc += cone * att * win * win * (uScatter + uMistScatter * hhMistAt(p.y) * patchy) * exp(-uFog * uFog * t * t);
    }
    L += uFlashCol * acc * dt * 0.4;
  }
  gl_FragColor = vec4(L, T);
}`;

const SSR_FRAG = `
precision highp float;
${DEPTH_PARS}
uniform sampler2D tColor;
uniform sampler2D tDetail;      // ground.js detail map (puddle noise)
uniform sampler2D tMask;        // ground surface mask
uniform vec4 uMaskRect;
uniform float uWet, uTime, uSteps, uMaxDist, uWaterY, uRain, uCap;
uniform mat4 uProj, uView;
varying vec2 vUv;

vec2 hhProject(vec3 v) {
  vec4 c = uProj * vec4(v, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

void main() {
  gl_FragColor = vec4(0.0);
  float depth = texture2D(tDepth, vUv).x;
  vec3 vp = hhViewPos(vUv, min(depth, 0.9999));
  vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
  // derivatives before any early exit (uniform control flow)
  vec3 nw = cross(dFdy(wp), dFdx(wp));
  if (depth >= 0.999999) return;
  if (wp.y > 2.5 || wp.y < uWaterY - 4.0) return;
  // only flat, upward-facing ground (the flanks of kerbs and cars' bottoms are skipped)
  if (abs(nw.y) < 0.94 * length(nw)) return;
  bool water = wp.y < uWaterY + 3.0;
  float strength, rough;
  if (water) {
    // a little vertical smear: the ripples stretch the lamps into streaks (and hide the
    // dotted look of escaping rays sampling small halos at discrete steps)
    strength = 1.0; rough = 0.35;
  } else {
    if (wp.y < -3.0) return;   // river banks
    vec4 mk = texture2D(tMask, (wp.xz - uMaskRect.xy) / uMaskRect.zw);
    float wL = max(0.0, 1.0 - mk.r - mk.g - mk.b);
    vec4 gN = texture2D(tDetail, wp.xz / 820.0 + vec2(0.37, 0.61));
    vec4 gF = texture2D(tDetail, wp.xz / 90.0);
    float gP = smoothstep(0.575, 0.66, gN.g * 0.85 + gF.g * 0.15);
    float puddle = gP * (mk.r + mk.g * 0.6 + wL * 0.08) * uWet;
    float hard = clamp(mk.r + mk.g * 0.7, 0.0, 1.0) * uWet;
    strength = puddle * 1.1 + hard * 0.62 * (1.0 - puddle);
    rough = mix(1.0, 0.04, smoothstep(0.1, 0.8, puddle));
  }
  if (strength < 0.03) return;
  // ripples: wind on the river, rain on the puddles
  vec2 rq = wp.xz * (water ? 0.035 : 0.12) + uTime * vec2(0.3, 0.21);
  vec2 rip = vec2(hhNoise(rq) - 0.5, hhNoise(rq + 7.3) - 0.5) * (water ? 0.05 : 0.02 * uRain);
  vec3 nV = normalize((uView * vec4(rip.x, 1.0, rip.y, 0.0)).xyz);
  vec3 V = normalize(vp);
  vec3 R = reflect(V, nV);
  float cosT = max(dot(-V, nV), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

  vec3 start = vp + nV * 0.6;
  float jit = hhIgn(gl_FragCoord.xy + fract(uTime * 3.0) * 37.0);
  float tPrev = 0.0;
  bool hit = false;
  vec2 hitUv = vec2(0.0);
  vec3 skyMax = vec3(0.0);
  float n = uSteps;
  for (int i = 1; i <= 32; i++) {
    if (float(i) > n) break;
    float f = (float(i) - 0.5 + jit) / n;
    float t = uMaxDist * f * f;
    vec3 p = start + R * t;
    if (p.z > -uNear) break;
    vec2 suv = hhProject(p);
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float sd = texture2D(tDepth, suv).x;
    if (sd >= 0.999999) {
      // sky: remember the brightest thing crossed (a lamp halo, the moon, flames)
      skyMax = max(skyMax, texture2D(tColor, suv).rgb);
      tPrev = t;
      continue;
    }
    float sz = hhViewZ(sd);
    float dz = sz - p.z;              // > 0: the ray is behind the surface there
    float thick = max(10.0, (t - tPrev) * 2.0 + t * 0.02);
    if (dz > 0.0 && dz < thick) {
      // refine between the last point in front and this one
      float lo = tPrev, hi = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (lo + hi);
        vec3 pm = start + R * m;
        vec2 mu = hhProject(pm);
        float mz = hhViewZ(texture2D(tDepth, mu).x);
        if (mz - pm.z > 0.0) hi = m; else lo = m;
      }
      hitUv = hhProject(start + R * hi);
      hit = true;
      break;
    }
    tPrev = t;
  }
  vec3 col;
  float fade = 1.0;
  if (hit) {
    col = texture2D(tColor, hitUv).rgb;
    vec2 e = min(hitUv, 1.0 - hitUv);
    fade = smoothstep(0.0, 0.06, e.x) * smoothstep(0.0, 0.08, e.y);
  } else {
    col = skyMax;
  }
  // HDR caps: a lamp lens mirrored in a puddle blooms, but never into a white sheet
  col = min(col, vec3(uCap));
  gl_FragColor = vec4(col * F * strength * fade, rough);
}`;

const COMP_FRAG = `
precision highp float;
${DEPTH_PARS}
uniform sampler2D tColor, tVol, tSsr;
uniform vec2 uVolSize, uSsrSize;
uniform float uVolOn, uSsrOn, uStreak, uWaterY;
varying vec2 vUv;

void main() {
  vec4 c = texture2D(tColor, vUv);
  float d0 = texture2D(tDepth, vUv).x;
  float z0 = -hhViewZ(d0);
  vec3 add = vec3(0.0);
  float T = 1.0;
  if (uVolOn > 0.5) {
    // joint bilateral upsample: the 4 low-res neighbours, weighted by depth likeness
    vec2 p = vUv * uVolSize - 0.5;
    vec2 f = fract(p);
    vec2 base = (floor(p) + 0.5) / uVolSize;
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
      vec2 uv = base + o / uVolSize;
      float zk = -hhViewZ(texture2D(tDepth, uv).x);
      float bil = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
      float w = bil * (1.0 / (1e-3 + abs(zk - z0) / max(z0, 1.0) * 24.0)) + 1e-5;
      acc += texture2D(tVol, uv) * w;
      wsum += w;
    }
    acc /= wsum;
    T = acc.a;
    add = acc.rgb;
  }
  if (uSsrOn > 0.5) {
    vec3 wp = (uCamWorld * vec4(hhViewPos(vUv, d0), 1.0)).xyz;
    if (d0 < 0.999999 && wp.y < 3.0 && wp.y > uWaterY - 5.0) {
      vec4 s = texture2D(tSsr, vUv);
      float rough = s.a;
      vec3 r = s.rgb;
      if (rough > 0.12) {
        // wet asphalt: the reflection smears into vertical streaks (dithered taps)
        float rad = uStreak * rough;
        float j = hhIgn(gl_FragCoord.xy) - 0.5;
        vec3 sum = r;
        float ws = 1.0;
        for (int k = 1; k <= 4; k++) {
          float o = (float(k) + j * 0.9) / 4.0;
          float w = exp(-o * o * 2.2);
          sum += (texture2D(tSsr, vUv + vec2(0.0, o * rad)).rgb + texture2D(tSsr, vUv - vec2(0.0, o * rad)).rgb) * w;
          ws += 2.0 * w;
        }
        r = sum / ws;
      }
      add += r * T;
    }
  }
  gl_FragColor = vec4(c.rgb * T + add, c.a);
}`;

function mat(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false,
  });
}

function rt(type) {
  const t = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  t.texture.generateMipmaps = false;
  return t;
}

/**
 * The atmosphere + reflections pass. `getSources()` returns { lights (pool PointLights),
 * kinds (Float32Array, 1 = lamp), flashlight (SpotLight), ambient (lights.js ambientFor),
 * ground (ground.js: uniforms, mask), fogDensity } or null.
 */
export class AtmosPass extends Pass {
  constructor(camera, getSources, hdr) {
    super();
    this.camera = camera;
    this.getSources = getSources;
    this.needsSwap = true;
    this.enabled = false;
    this.vol = false;
    this.ssr = false;
    this.tier = 'high';
    this.time = 0;
    this.w = 1; this.h = 1;
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.volRT = rt(type);
    this.ssrRT = rt(type);
    const depthU = () => ({
      tDepth: { value: null }, uNear: { value: 1 }, uFar: { value: 1000 },
      uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    });
    this.volMat = mat(VOL_FRAG, {
      ...depthU(),
      uLPos: { value: Array.from({ length: ATMOS_LIGHTS }, () => new THREE.Vector4()) },
      uLCol: { value: Array.from({ length: ATMOS_LIGHTS }, () => new THREE.Vector4()) },
      uCamPos: { value: new THREE.Vector3() },
      uMistCol: { value: new THREE.Color() },
      uMist: { value: 0 }, uMistH: { value: 36 }, uScatter: { value: 0 }, uMistScatter: { value: 0 },
      uFog: { value: 0.001 }, uSkyDist: { value: 3000 }, uTime: { value: 0 },
      uFlashPos: { value: new THREE.Vector3() }, uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
      uFlashCol: { value: new THREE.Color() }, uFlash: { value: new THREE.Vector4(0.9, 0.99, 900, 0) },
    });
    this.ssrMat = mat(SSR_FRAG, {
      ...depthU(),
      tColor: { value: null }, tDetail: { value: null }, tMask: { value: null }, uMaskRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uWet: { value: 1 }, uTime: { value: 0 }, uSteps: { value: 28 }, uMaxDist: { value: 2600 }, uWaterY: { value: -16 }, uRain: { value: 0 }, uCap: { value: 12 },
      uProj: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
    });
    this.compMat = mat(COMP_FRAG, {
      ...depthU(),
      tColor: { value: null }, tVol: { value: this.volRT.texture }, tSsr: { value: this.ssrRT.texture },
      uVolSize: { value: new THREE.Vector2(1, 1) }, uSsrSize: { value: new THREE.Vector2(1, 1) },
      uVolOn: { value: 0 }, uSsrOn: { value: 0 }, uStreak: { value: 0.05 }, uWaterY: { value: -16 },
    });
    this.quad = new FullScreenQuad(this.volMat);
    this._c = new THREE.Color();
    this._v = new THREE.Vector3();
  }

  /** Which parts run on this tier with these settings ('low' never runs the pass). */
  configure(tier, volumetrics, reflections) {
    this.tier = tier;
    this.vol = tier !== 'low' && !!volumetrics;
    this.ssr = tier !== 'low' && !!reflections;
    this.enabled = this.vol || this.ssr;
    this.setSize(this.w, this.h);
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    const ultra = tierAtLeast(this.tier, 'ultra');
    const vs = ultra ? 0.5 : 0.25, ss = ultra ? 0.5 : 0.25;
    const vw = Math.max(1, Math.round(w * vs)), vh = Math.max(1, Math.round(h * vs));
    const sw = Math.max(1, Math.round(w * ss)), sh = Math.max(1, Math.round(h * ss));
    // targets only take memory while their part is on
    this.volRT.setSize(this.vol ? vw : 1, this.vol ? vh : 1);
    this.ssrRT.setSize(this.ssr ? sw : 1, this.ssr ? sh : 1);
    this.compMat.uniforms.uVolSize.value.set(vw, vh);
    this.compMat.uniforms.uSsrSize.value.set(sw, sh);
  }

  _depthUniforms(u, depth) {
    const cam = this.camera;
    u.tDepth.value = depth;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
  }

  render(renderer, writeBuffer, readBuffer, deltaTime) {
    const depth = readBuffer.depthTexture;
    if (!depth) return;
    this.time = (this.time + (deltaTime || 0)) % 1000;
    const src = this.getSources ? this.getSources() : null;
    const ultra = tierAtLeast(this.tier, 'ultra');
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    try {
      if (this.vol) {
        const u = this.volMat.uniforms;
        this._depthUniforms(u, depth);
        u.uCamPos.value.copy(this.camera.position);
        u.uTime.value = this.time;
        this._lights(u, src);
        this.quad.material = this.volMat;
        renderer.setRenderTarget(this.volRT);
        this.quad.render(renderer);
      }
      if (this.ssr) {
        const u = this.ssrMat.uniforms;
        this._depthUniforms(u, depth);
        u.tColor.value = readBuffer.texture;
        u.uProj.value.copy(this.camera.projectionMatrix);
        u.uView.value.copy(this.camera.matrixWorldInverse);
        u.uTime.value = this.time;
        // by day the escaping rays pick up the bright sky (and the sun): keep it a reflection, not a mirror flash
        u.uCap.value = src && src.ambient && src.ambient.time === 'day' ? 3.0 : 12;
        u.uSteps.value = ultra ? 28 : 16;
        const g = src && src.ground;
        if (g && g.uniforms) {
          u.tDetail.value = g.uniforms.detailMap.value;
          u.tMask.value = g.uniforms.uMask.value;
          u.uMaskRect.value.copy(g.uniforms.uMaskRect.value);
          // the 'low' Lambert ground has no wet look to reflect on
          u.uWet.value = g.uniforms.wetness.value;
          u.uRain.value = g.uniforms.uRain.value;
        } else {
          u.uWet.value = 0;
        }
        this.quad.material = this.ssrMat;
        renderer.setRenderTarget(this.ssrRT);
        this.quad.render(renderer);
      }
      const c = this.compMat.uniforms;
      this._depthUniforms(c, depth);
      c.tColor.value = readBuffer.texture;
      c.uVolOn.value = this.vol ? 1 : 0;
      c.uSsrOn.value = this.ssr ? 1 : 0;
      this.quad.material = this.compMat;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
    } finally {
      renderer.autoClear = ac;
    }
  }

  /** Light pool, flashlight, mist and fog → the volumetric uniforms. */
  _lights(u, src) {
    const P = u.uLPos.value, C = u.uLCol.value;
    const pool = src && src.lights ? src.lights : [];
    const kinds = src && src.kinds;
    for (let i = 0; i < ATMOS_LIGHTS; i++) {
      const l = pool[i];
      if (!l || !(l.intensity > 0)) { P[i].set(0, -1e5, 0, 0); C[i].set(0, 0, 0, 0); continue; }
      P[i].set(l.position.x, l.position.y, l.position.z, l.distance || 300);
      this._c.copy(l.color).multiplyScalar(l.intensity);
      C[i].set(this._c.r, this._c.g, this._c.b, kinds && kinds[i] ? 1 : 0);
    }
    const amb = src && src.ambient;
    const fog = src && Number.isFinite(src.fogDensity) ? src.fogDensity : 0.001;
    u.uFog.value = fog;
    // darker maps: thicker mist, and the lamps' haze reads stronger against the dark
    const dark = amb ? amb.darkness : 0.65;
    const day = !!amb && amb.time === 'day';
    // by day: a thin, low haze of the horizon colour (heat and dust near the ground), and
    // almost no in-scatter for the few lights still on (they are weak against the sun)
    u.uMist.value = day ? 0.00016 * (amb.mist ?? 0.6) : 0.00045 + dark * 0.0003;
    u.uMistH.value = day ? 55 : 36;
    u.uScatter.value = day ? 2e-6 : 1.2e-5;
    u.uMistScatter.value = day ? 1.2e-5 : 5.5e-5;
    u.uSkyDist.value = Math.min(3200, this.camera.far * 0.9);
    if (amb) {
      if (day) u.uMistCol.value.copy(amb.fog).multiplyScalar(1.02);
      else u.uMistCol.value.copy(amb.fog).lerp(amb.sky, 0.08).multiplyScalar(1.35);
    }
    const fl = src && src.flashlight;
    const beam = tierAtLeast(this.tier, 'ultra') && fl && fl.intensity > 0;
    if (beam) {
      u.uFlashPos.value.copy(fl.position);
      this._v.copy(fl.target.position).sub(fl.position).normalize();
      u.uFlashDir.value.copy(this._v);
      u.uFlashCol.value.copy(fl.color).multiplyScalar(fl.intensity);
      u.uFlash.value.set(Math.cos(fl.angle), Math.cos(fl.angle * (1 - fl.penumbra)), Math.min(fl.distance || 900, 900), 10);
    } else {
      u.uFlash.value.w = 0;
    }
  }

  dispose() {
    this.volRT.dispose();
    this.ssrRT.dispose();
    this.volMat.dispose();
    this.ssrMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}
