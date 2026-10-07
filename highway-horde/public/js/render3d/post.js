// Post-processing chain of the first-person view (WORLD, SPEC §7.5). The world is drawn
// into a linear HDR (half-float) target and finished here:
//
//   world (RenderPass into the HDR target, with a depth texture)
//   → ambient occlusion (GTAO at half resolution, normals rebuilt from that depth: no
//     second geometry pass; 'high'/'ultra' only). It runs BEFORE the viewmodel so the gun
//     is never darkened by the wall behind it.
//   → atmosphere + wet-ground reflections (post-atmos.js: ground mist and the light pool
//     scattering in the air, screen-space reflections on puddles, wet asphalt and water;
//     'high'/'ultra' only, `volumetrics` / `reflections`)
//   → viewmodel (own scene/camera, depth cleared: never clips into walls, still gets
//     bloom, grading and anti-aliasing)
//   → bloom (UnrealBloomPass on the HDR energy above ~1.2 with a soft knee from ~0.75:
//     lamps, fire, muzzle flashes, neon, glowing eyes, tracers — lit walls stay below it)
//   → grade (ACES + sRGB, i.e. what OutputPass does, fused with the colour grade —
//     contrast / saturation / lift-gamma-gain, vignette, film grain, dither — so the 4K
//     frame is read and written once instead of twice)
//   → SMAA or FXAA (on the display-referred image, as both expect)
//   → upscale + light sharpening to the canvas when the render scale is below 1.
//
// The canvas stays at the tier's pixel-ratio cap; only the composer's internal targets
// follow the render scale (dynamic resolution), so a scale change never touches the page
// layout and the last pass does the upscale.
//
// 'cinematic' (post-cine.js, post-bloom.js, each switch a graphics setting): the world is
// drawn into a multisampled target first (MSAA 2x/4x/8x) and resolved into the chain; the AO
// runs at full resolution; contact shadows toward the sun, camera motion blur and (hurt / downed)
// depth of field are extra passes; the bloom is a 7-level dual-filter chain with lens dirt; the
// grade adds a chromatic fringe; and when the frame is supersampled the last pass shrinks it
// with a Catmull-Rom filter instead of a bilinear tap. Below Cinematic none of these exist.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { AtmosPass } from './post-atmos.js';
import { tierAtLeast } from './tier.js';
import { MsaaWorldPass, ContactShadowPass, DepthCopyPass, MotionBlurPass, DofPass } from './post-cine.js';
import { HHBloomPass } from './post-bloom.js';

const DIST_N = 4;

/** Highest render scale: 2 = supersampling at twice the native resolution per axis. */
export const RENDER_SCALE_LIMIT = 2;

/**
 * Pixels the world pass may cover per tier (supersampling stops short of exhausting GPU memory):
 * 16 million, i.e. 4K x 1.4^2; Cinematic 36 million = 4K x 1.5^2 x 2 ("Auto" up to 200% at 1080p, 150% at 4K).
 */
export const PIXEL_BUDGET = Object.freeze({ cinematic: 36e6, ultra: 16e6, high: 16e6, low: 16e6 });

/** Settings the chain understands, with their defaults (SPEC §7.5 graphics settings). */
export const POST_DEFAULTS = Object.freeze({
  renderScale: 'auto', bloom: true, ao: true, antialias: 'smaa', filmGrain: true, vignette: true,
  volumetrics: true, reflections: true,
  // display calibration (multipliers around 1) and the per-pass GPU timing of the stats overlay
  brightness: 1, contrast: 1, saturation: 1, timing: false,
});

/**
 * What the Cinematic extras do when the settings do not say (a caller that predates them, a sandbox
 * without params): the Cinematic preset of ui/storage.js. Motion blur is a matter of taste: off.
 */
export const CINEMATIC_DEFAULTS = Object.freeze({
  msaa: 4, shadowsHigh: true, contactShadows: true, aoFull: true, fxHigh: true, motionBlur: false, dof: true, lensFx: true, lightShadows: true,
});

/**
 * Normalise a settings object to the post contract (unknown / invalid values → defaults).
 * @param {object} [s]
 * @returns {{renderScale: 'auto'|number, bloom: boolean, ao: boolean, antialias: 'smaa'|'fxaa'|'off', filmGrain: boolean, vignette: boolean, volumetrics: boolean, reflections: boolean, msaa: number|undefined, brightness: number, contrast: number, saturation: number, timing: boolean}}
 *   (the Cinematic extras are undefined when the caller did not pass them: CINEMATIC_DEFAULTS)
 */
export function normPostSettings(s) {
  const o = s || {};
  let rs = o.renderScale;
  if (rs !== 'auto') {
    rs = Number(rs);
    rs = Number.isFinite(rs) && rs > 0 ? Math.max(0.5, Math.min(RENDER_SCALE_LIMIT, rs)) : 'auto';
  }
  const aa = o.antialias === 'fxaa' || o.antialias === 'off' || o.antialias === 'smaa' ? o.antialias : 'smaa';
  return {
    renderScale: rs,
    bloom: o.bloom !== false,
    ao: o.ao !== false,
    antialias: aa,
    filmGrain: o.filmGrain !== false,
    vignette: o.vignette !== false,
    volumetrics: o.volumetrics !== false,
    reflections: o.reflections !== false,
    msaa: o.msaa === undefined ? undefined : [0, 2, 4, 8].includes(Number(o.msaa)) ? Number(o.msaa) : 0,
    shadowsHigh: xb(o.shadowsHigh),
    contactShadows: xb(o.contactShadows),
    aoFull: xb(o.aoFull),
    fxHigh: xb(o.fxHigh),
    motionBlur: xb(o.motionBlur),
    dof: xb(o.dof),
    lensFx: xb(o.lensFx),
    lightShadows: xb(o.lightShadows),
    brightness: calib(o.brightness),
    contrast: calib(o.contrast),
    saturation: calib(o.saturation),
    timing: o.timing === true,
  };
}
/** An optional boolean: undefined stays undefined (the tier's default decides). */
const xb = (v) => (v === undefined ? undefined : v === true);
/** A calibration multiplier: 0.7 .. 1.3, else 1. */
const calib = (v) => (Number.isFinite(v) ? Math.max(0.7, Math.min(1.3, v)) : 1);

/**
 * The night colour grade per map (the day grade lives in daylight.js): the default night look
 * (cool shadows, warm highlights) nudged toward each place's light — the truck stop's sodium
 * lamps, the bridge's cold mist, the checkpoint's sickly floodlights, Harlan's amber dusk.
 */
export function nightGradeFor(map) {
  const base = { contrast: 1.08, saturation: 0.92, lift: [0.006, 0.010, 0.020], gamma: [1, 1, 1.02], gain: [1.02, 1.0, 0.97], vignette: 0.32, grain: 0.038, bloom: 0.5, bloomThreshold: 1.2 };
  const id = map && map.id;
  // a story hideout brings its own night grade (map.look.night.grade)
  if (map && map.look && map.look.night && map.look.night.grade) return { ...base, ...map.look.night.grade };
  const tweak = {
    highway: { saturation: 0.95, lift: [0.005, 0.009, 0.022], gain: [1.03, 1.0, 0.96] },
    truckstop: { saturation: 0.98, lift: [0.010, 0.010, 0.016], gain: [1.05, 1.0, 0.93], gamma: [1, 1, 1.0] },
    bridge: { saturation: 0.86, contrast: 1.1, lift: [0.004, 0.011, 0.026], gain: [0.99, 1.0, 1.02], vignette: 0.36 },
    checkpoint: { saturation: 0.9, lift: [0.006, 0.014, 0.014], gain: [1.0, 1.03, 0.96], gamma: [1, 1.01, 1.0] },
    harlan: { saturation: 1.0, contrast: 1.06, lift: [0.010, 0.008, 0.014], gain: [1.06, 1.0, 0.92], gamma: [1.0, 1.0, 1.0], vignette: 0.3 },
  }[id];
  return tweak ? { ...base, ...tweak } : base;
}

// ---- passes -------------------------------------------------------------------------

/**
 * Screen-space AO from the world pass' depth texture (GTAO + Poisson denoise at half
 * resolution), multiplied straight into the frame (no copy, no swap).
 */
class DepthAOPass extends Pass {
  constructor(scene, camera) {
    super();
    this.needsSwap = false;
    this.camera = camera;
    // GTAOPass builds its own normal/depth target when constructed without a G-buffer; it is
    // never rendered to here (setGBuffer below switches to the composer's depth texture and
    // normals reconstructed from it), so it never allocates GPU memory.
    this.gtao = new GTAOPass(scene, camera, 2, 2);
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.scale = 0.5;
    this.full = false;
    this.w = 2; this.h = 2;
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: null }, intensity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tAO; uniform float intensity; varying vec2 vUv;
        void main() {
          float ao = texture2D(tAO, vUv).r;
          gl_FragColor = vec4(vec3(mix(1.0, ao, intensity)), 1.0);
        }`,
      // multiply: dst = src * dst
      blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      blendEquation: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true,
    });
    this.quad = new FullScreenQuad(this.blend);
    this.depth = null;
  }

  /** `full`: Cinematic's full-resolution AO with more samples and a wider, three-ring bilateral denoise. */
  configure(q, full = false) {
    const ultra = tierAtLeast(q, 'ultra');
    this.full = !!full && tierAtLeast(q, 'cinematic');
    // units: 1 world unit ≈ 3 cm, so radius 20 ≈ 0.6 m of contact shadow
    // (contact shadow polish: a touch tighter and stronger where two surfaces meet, ultra a little more)
    this.gtao.updateGtaoMaterial({ radius: ultra ? 18 : 20, distanceExponent: 1.7, thickness: 12, scale: ultra ? 1.28 : 1.18, samples: this.full ? 24 : ultra ? 16 : 10, distanceFallOff: 1 });
    // (the denoise radius is in AO pixels: twice as many at full resolution for the same footprint)
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: this.full ? 13 : ultra ? 8 : 6, rings: this.full ? 3 : 2, samples: this.full ? 16 : ultra ? 12 : 8 });
    this.blend.uniforms.intensity.value = ultra ? 0.92 : 0.85;
    this._fit();
  }

  /** Full resolution, but never more than a 4K frame's worth of AO pixels (above that the frame is supersampled anyway). */
  _fit() {
    const scale = this.full ? Math.min(1, Math.sqrt(8.9e6 / Math.max(1, this.w * this.h))) : 0.5;
    if (Math.abs(scale - this.scale) > 1e-6) {
      this.scale = scale;
      this.gtao.setSize(Math.max(1, Math.round(this.w * this.scale)), Math.max(1, Math.round(this.h * this.scale)));
    }
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.scale = -1;         // (forces the resize below)
    this._fit();
  }

  render(renderer, writeBuffer, readBuffer) {
    const g = this.gtao, cam = this.camera;
    const depth = readBuffer.depthTexture;
    if (!depth) return;
    if (this.depth !== depth) { g.setGBuffer(depth); this.depth = depth; }
    const u = g.gtaoMaterial.uniforms;
    u.cameraNear.value = cam.near;
    u.cameraFar.value = cam.far;
    u.cameraProjectionMatrix.value.copy(cam.projectionMatrix);
    u.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
    u.cameraWorldMatrix.value.copy(cam.matrixWorld);
    g._renderPass(renderer, g.gtaoMaterial, g.gtaoRenderTarget, 0xffffff, 1.0);
    g.pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(cam.projectionMatrixInverse);
    g._renderPass(renderer, g.pdMaterial, g.pdRenderTarget, 0xffffff, 1.0);
    this.blend.uniforms.tAO.value = g.pdRenderTarget.texture;
    renderer.setRenderTarget(readBuffer);
    const ac = renderer.autoClear;
    renderer.autoClear = false;   // multiply over the frame, never clear it
    this.quad.render(renderer);
    renderer.autoClear = ac;
  }

  dispose() {
    this.gtao.dispose();
    // GTAOPass.dispose() leaves these two
    this.gtao.gtaoMaterial.dispose();
    this.gtao.blendMaterial.dispose();
    this.blend.dispose();
    this.quad.dispose();
  }
}

/** The first-person viewmodel drawn over the world inside the chain (depth cleared). */
class ViewmodelPass extends Pass {
  constructor(getVm) {
    super();
    this.needsSwap = false;
    this.getVm = getVm;
    this.frame = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    const vm = this.getVm();
    if (!vm) return;
    const ac = renderer.autoClear;
    renderer.setRenderTarget(readBuffer);
    renderer.autoClear = false;
    try {
      if (typeof vm.render === 'function') {
        vm.render(renderer, this.frame);
      } else if (vm.scene && vm.camera) {
        renderer.clearDepth();
        renderer.render(vm.scene, vm.camera);
      }
    } finally {
      renderer.autoClear = ac;
    }
  }
}

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    toneMappingExposure: { value: 1 },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.32 },
    uContrast: { value: 1.08 },
    uSaturation: { value: 0.92 },
    uLift: { value: new THREE.Vector3(0.006, 0.010, 0.020) },
    uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.02) },
    uGain: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
    uAspect: { value: 16 / 9 },
    uHurt: { value: 0 },
    // Cinematic: radial colour fringe (0 = off); display calibration: contrast and saturation multipliers
    uCA: { value: 0 },
    uUContrast: { value: 1 },
    uUSat: { value: 1 },
    // heat shimmer / shockwave sources (screen uv + radius in heights + strength | kind, age 0..1)
    uDist: { value: Array.from({ length: DIST_N }, () => new THREE.Vector4()) },
    uDistB: { value: Array.from({ length: DIST_N }, () => new THREE.Vector4()) },
    uDistN: { value: 0 },
    // lens flare: the sun / moon in screen uv, strength (0 = off), tint
    uFlare: { value: new THREE.Vector3(0.5, 0.5, 0) },
    uFlareCol: { value: new THREE.Vector3(1, 0.9, 0.7) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uContrast, uSaturation, uAspect, uHurt, uCA, uUContrast, uUSat;
    uniform vec3 uLift, uGamma, uGain;
    uniform vec4 uDist[${DIST_N}];
    uniform vec4 uDistB[${DIST_N}];
    uniform int uDistN;
    uniform vec3 uFlare, uFlareCol;
    // the material is toneMapped: false, so three's prefix never adds these (it always
    // adds colorspace_pars_fragment, whose sRGBTransferOETF is used below)
    #include <tonemapping_pars_fragment>
    varying vec2 vUv;
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float maxc(vec3 v) { return max(v.r, max(v.g, v.b)); }
    // heat shimmer (kind 0: a slow wobble over a fire) and shockwaves (kind 1: a ring of
    // refraction racing outward), as a uv offset
    vec2 distortion(vec2 uv) {
      vec2 off = vec2(0.0);
      for (int i = 0; i < ${DIST_N}; i++) {
        if (i >= uDistN) break;
        vec4 d = uDist[i];
        vec4 b = uDistB[i];
        vec2 v = (uv - d.xy) * vec2(uAspect, 1.0);
        float l = length(v);
        if (b.x < 0.5) {
          float f = smoothstep(d.z, d.z * 0.15, l) * d.w;
          off += vec2(sin(uv.y * 70.0 + uTime * 9.0) + 0.6 * sin(uv.y * 130.0 - uTime * 13.0), cos(uv.x * 60.0 + uTime * 7.0)) * 0.0028 * f;
        } else {
          float rr = d.z * b.y;
          float w = d.z * 0.16 + 0.006;
          float band = exp(-pow((l - rr) / w, 2.0));
          off += (v / max(l, 1e-4)) * band * d.w * 0.03 * (1.0 - b.y) / vec2(uAspect, 1.0);
        }
      }
      return off;
    }
    // lens flare of the sun / moon: streak, halo ring and ghosts along the line through the
    // screen centre; visible only where the HDR disc itself is (a wall or a cloud in front hides it)
    vec3 lensFlare(vec2 uv) {
      vec2 sp = uFlare.xy;
      vec2 o = vec2(0.005 / uAspect, 0.005);
      float lum = (maxc(texture2D(tDiffuse, sp).rgb) + maxc(texture2D(tDiffuse, sp + o).rgb) + maxc(texture2D(tDiffuse, sp - o).rgb)
        + maxc(texture2D(tDiffuse, sp + vec2(o.x, -o.y)).rgb) + maxc(texture2D(tDiffuse, sp + vec2(-o.x, o.y)).rgb)) * 0.2;
      float vis = smoothstep(1.6, 6.0, lum);
      float edge = smoothstep(0.0, 0.14, min(min(sp.x, 1.0 - sp.x), min(sp.y, 1.0 - sp.y)));
      vec2 dd = (uv - sp) * vec2(uAspect, 1.0);
      vec3 fl = uFlareCol * exp(-abs(dd.y) * 110.0) * exp(-abs(dd.x) * 3.2) * 0.55;
      fl += uFlareCol * exp(-pow((length(dd) - 0.2) / 0.022, 2.0)) * 0.22;
      vec2 axis = vec2(0.5) - sp;
      for (int k = 1; k <= 4; k++) {
        vec2 gp = sp + axis * (float(k) * 0.55 - 0.1);
        vec2 gd = (uv - gp) * vec2(uAspect, 1.0);
        float r = 0.02 + 0.011 * float(k);
        float g = length(gd);
        vec3 tint = mix(uFlareCol, vec3(0.5, 0.8, 1.0), float(k) * 0.2);
        fl += tint * (smoothstep(r, r * 0.2, g) * 0.16 + exp(-pow((g - r) / (r * 0.3), 2.0)) * 0.4) * (0.7 / float(k));
      }
      return fl * uFlare.z * vis * edge;
    }
    void main() {
      vec2 uv = vUv;
      if (uDistN > 0) uv += distortion(vUv);
      vec4 src = texture2D(tDiffuse, uv);
      vec3 c = max(src.rgb, 0.0);
      if (uFlare.z > 0.001) c += lensFlare(vUv);
      // hurt: the edges of the view split into colour fringes and drain of colour (only
      // while the local player is hurt: a uniform branch, free otherwise)
      float hurtDesat = 0.0;
      if (uHurt > 0.002 || uCA > 0.0) {
        vec2 dc = vUv - 0.5;
        vec2 off = dc * dot(dc, dc) * (uHurt * 0.05 + uCA);
        c.r = max(texture2D(tDiffuse, uv + off).r, 0.0);
        c.b = max(texture2D(tDiffuse, uv - off).b, 0.0);
        // the colour drains from the whole view as health runs out, most at the edges
        hurtDesat = uHurt * (0.14 + 0.28 * smoothstep(0.05, 0.5, length(dc)));
      }
      c = ACESFilmicToneMapping(c);
      c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
      // grade in display space: saturation, contrast around a low (night) pivot,
      // then lift (cool shadows) / gamma / gain (warm highlights)
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation * (1.0 - hurtDesat));
      c = max((c - 0.32) * uContrast + 0.32, 0.0);
      c = c * uGain + uLift * (1.0 - c);
      c = pow(max(c, 0.0), 1.0 / uGamma);
      // display calibration (Settings > Display): contrast around mid grey, colour
      if (uUContrast != 1.0) c = max((c - 0.5) * uUContrast + 0.5, 0.0);
      if (uUSat != 1.0) c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uUSat);
      // vignette: an ellipse matched to the frame, darkening the corners
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0) / sqrt(uAspect * uAspect + 1.0) * 2.0;
      c *= 1.0 - uVignette * smoothstep(0.35, 1.05, dot(d, d));
      // film grain: animated, stronger in the mid-darks, invisible in highlights
      float n = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 173.0) + hash12(gl_FragCoord.yx * 1.37 + fract(uTime * 3.17) * 91.0) - 1.0;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      c += n * uGrain * (1.0 - smoothstep(0.1, 0.85, lum)) * (0.35 + lum);
      // 8-bit dither (triangular, +-1 level): the dark sky / fog gradients band without it
      c += (hash12(gl_FragCoord.xy * 0.71 + 3.1) + hash12(gl_FragCoord.yx * 0.93 + 7.7) - 1.0) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

const UPSCALE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.35 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharp;
    varying vec2 vUv;
    void main() {
      // contrast-adaptive sharpening (CAS-like) on the bilinear upscale: restores edge
      // crispness lost to a lower internal resolution without ringing on hard edges
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 mn = min(c, min(min(n, s), min(e, w)));
      vec3 mx = max(c, max(max(n, s), max(e, w)));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
      vec3 wgt = -amp * uSharp * 0.2;
      vec3 outc = (c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);
      gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
    }`,
};

// Supersampled frames (internal resolution above the canvas) are shrunk back with a Catmull-Rom
// filter (nine bilinear taps): a plain bilinear tap from 1.5x is an uneven box that aliases; this keeps
// edges crisp without ringing. Cinematic only, as the last pass.
const DOWNSAMPLE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 size = 1.0 / uTexel;
      vec2 pos = vUv * size;
      vec2 c = floor(pos - 0.5) + 0.5;
      vec2 f = pos - c;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
      vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
      vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2;
      vec2 t12 = w2 / w12;
      vec2 p0 = (c - 1.0) * uTexel, p3 = (c + 2.0) * uTexel, p12 = (c + t12) * uTexel;
      vec3 r = vec3(0.0);
      r += texture2D(tDiffuse, vec2(p0.x, p0.y)).rgb * w0.x * w0.y;
      r += texture2D(tDiffuse, vec2(p12.x, p0.y)).rgb * w12.x * w0.y;
      r += texture2D(tDiffuse, vec2(p3.x, p0.y)).rgb * w3.x * w0.y;
      r += texture2D(tDiffuse, vec2(p0.x, p12.y)).rgb * w0.x * w12.y;
      r += texture2D(tDiffuse, vec2(p12.x, p12.y)).rgb * w12.x * w12.y;
      r += texture2D(tDiffuse, vec2(p3.x, p12.y)).rgb * w3.x * w12.y;
      r += texture2D(tDiffuse, vec2(p0.x, p3.y)).rgb * w0.x * w3.y;
      r += texture2D(tDiffuse, vec2(p12.x, p3.y)).rgb * w12.x * w3.y;
      r += texture2D(tDiffuse, vec2(p3.x, p3.y)).rgb * w3.x * w3.y;
      gl_FragColor = vec4(clamp(r, 0.0, 1.0), 1.0);
    }`,
};

// ---- chain ---------------------------------------------------------------------------

/**
 * Build the post chain.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ scene: THREE.Scene, camera: THREE.Camera, getViewmodel: () => object|null, quality: string, getAtmos?: () => object|null }} o
 *   getAtmos: sources of the atmosphere pass (post-atmos.js AtmosPass)
 * @returns {object} { render(dt, frame), setSize(cssW, cssH, prFull, prInner) (canvas at prFull,
 *   internal targets at prInner), configure(settings, quality), warm(), target (the world
 *   render target), readBuffer, passes, sceneInfo (world pass calls / triangles), dispose() }
 */
export function createPost(renderer, { scene, camera, getViewmodel, quality, getAtmos, look, getFx, flareDir, flareStrength, flareColor, gpuTimer = null }) {
  const ext = renderer.extensions;
  // HDR needs a renderable float target; without one (rare mobile GPUs) fall back to 8-bit
  // and lower the bloom threshold so lights still glow
  const hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.type = THREE.UnsignedIntType;
  const target = new THREE.WebGLRenderTarget(1, 1, { type, depthTexture, stencilBuffer: false });
  target.texture.name = 'hh-post.rt1';
  const composer = new EffectComposer(renderer, target);
  composer.renderTarget2.texture.name = 'hh-post.rt2';

  // The depth texture of this frame's world pass (`depth`) and, when motion blur / depth of field are on,
  // a copy of the view distances in a plain R16F target (`lin`): a pass that swaps the buffers leaves the
  // next read buffer without depth and writes into the one whose depth attachment holds it, and a
  // texture attached to the bound framebuffer cannot be sampled.
  const chain = { depth: null, lin: null };
  const worldPass = new RenderPass(scene, camera);
  const msaaPass = new MsaaWorldPass(scene, camera, hdr);
  // draw calls / triangles of the world pass alone (shadow maps included), for r.stats
  const sceneInfo = { calls: 0, triangles: 0 };
  for (const wp of [worldPass, msaaPass]) {
    const base = wp.render.bind(wp);
    wp.render = (renderer2, w, r, dt, mask) => {
      const i = renderer2.info.render, c0 = i.calls, t0 = i.triangles;
      base(renderer2, w, r, dt, mask);
      sceneInfo.calls = i.calls - c0;
      sceneInfo.triangles = i.triangles - t0;
      chain.depth = r.depthTexture;
    };
  }
  const aoPass = new DepthAOPass(scene, camera);
  const contactPass = new ContactShadowPass(camera);
  const atmosPass = new AtmosPass(camera, getAtmos || null, hdr);
  const linPass = new DepthCopyPass(camera, chain);
  const mbPass = new MotionBlurPass(camera, chain);
  const dofPass = new DofPass(camera, chain);
  const vmPass = new ViewmodelPass(getViewmodel);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, hdr ? 1.2 : 0.72);
  // Soft-knee high pass: only the energy ABOVE the threshold blooms. The stock pass let a
  // pixel through whole once it crossed the threshold, so a flashlit wall at 1.6 bloomed as
  // hard as a lamp lens at 5 and the flashlight's hotspot turned into a glare.
  bloomPass.materialHighPassFilter.fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float v = max(max(texel.r, texel.g), texel.b);
      float knee = max(smoothWidth, 1e-4);
      float soft = clamp(v - luminosityThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      float contrib = max(soft, v - luminosityThreshold) / max(v, 1e-4);
      gl_FragColor = vec4(min(texel.rgb * contrib, vec3(24.0)), 1.0);
    }`;
  bloomPass.materialHighPassFilter.needsUpdate = true;
  bloomPass.highPassUniforms.smoothWidth.value = 0.45;
  // Bloom shaping: a tight bright core with a wide soft skirt whose outer mips lean warm by day
  // and cool at night (the stock weights [1, .8, .6, .4, .2] all tint white)
  bloomPass.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.86, 0.66, 0.5, 0.3];
  const warmSkirt = look && look.saturation > 1;
  bloomPass.bloomTintColors[3].set(...(warmSkirt ? [1.0, 0.93, 0.84] : [0.86, 0.93, 1.0]));
  bloomPass.bloomTintColors[4].set(...(warmSkirt ? [1.0, 0.9, 0.78] : [0.78, 0.88, 1.0]));
  bloomPass.baseSetSize = bloomPass.setSize;
  bloomPass.lowRes = false;
  // 'low' starts the bloom mips at quarter instead of half resolution: 4x fewer pixels
  bloomPass.setSize = function setSize(w, h) {
    const k = this.off ? 0 : this.lowRes ? 0.5 : 1;
    this.baseSetSize(Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k)));
  };
  const hhBloom = new HHBloomPass();
  const gradePass = new ShaderPass(GRADE_SHADER);
  gradePass.material.toneMapped = false;
  const smaaPass = new SMAAPass();
  const fxaaPass = new FXAAPass();
  const downPass = new ShaderPass(DOWNSAMPLE_SHADER);
  const upscalePass = new ShaderPass(UPSCALE_SHADER);
  const ORDER = [worldPass, msaaPass, aoPass, contactPass, atmosPass, linPass, mbPass, dofPass, vmPass, bloomPass, hhBloom, gradePass, smaaPass, fxaaPass, downPass, upscalePass];
  const NAMES = ['world', 'world', 'ao', 'contact', 'atmos', 'depth', 'motion', 'dof', 'viewmodel', 'bloom', 'bloom', 'grade', 'smaa', 'fxaa', 'resolve', 'upscale'];
  for (const p of ORDER) composer.addPass(p);
  // per-pass GPU timing (stats overlay): a query around each pass while `timing` is on
  let timing = false;
  ORDER.forEach((pass, i) => {
    const base = pass.render.bind(pass);
    pass.render = (...a) => {
      if (!timing || !gpuTimer) return base(...a);
      gpuTimer.begin(NAMES[i]);
      try { return base(...a); } finally { gpuTimer.end(); }
    };
  });
  downPass.enabled = false;
  if (look) {
    const gu = gradePass.uniforms;
    gu.uContrast.value = look.contrast;
    gu.uSaturation.value = look.saturation;
    gu.uLift.value.set(...look.lift);
    gu.uGamma.value.set(...look.gamma);
    gu.uGain.value.set(...look.gain);
    bloomPass.threshold = look.bloomThreshold;
  }

  let q = quality;
  let cur = null;
  // hurt effect state: low health plus a pulse on every hp drop
  let lastHp = NaN, hurtPulse = 0, hurt = 0;
  let cssW = 1, cssH = 1, prFull = 1, prInner = 1;
  let time = 0;
  let cine = false;                 // the Cinematic tier's passes are in play
  let ex = {};                      // the Cinematic extras in effect (all off below Cinematic)
  let msaaWant = 0, msaaN = 0;      // requested / actual MSAA samples
  let bright = 1;
  let curSettings = null;

  /** MSAA samples that fit: the request, cut when the multisampled target would be huge (4K x 2.0 x 8). */
  function msaaFit() {
    const px = Math.max(1, Math.floor(cssW * prInner)) * Math.max(1, Math.floor(cssH * prInner));
    let n = MsaaWorldPass.clamp(renderer, msaaWant);
    while (n > 0 && px * n > 90e6) n = n > 4 ? 4 : n > 2 ? 2 : 0;
    return n;
  }
  function applyMsaa() {
    const n = cine ? msaaFit() : 0;
    msaaN = n;
    if (n > 0) msaaPass.setSamples(n);
    msaaPass.enabled = n > 0;
    worldPass.enabled = n === 0;
    msaaPass.setCoverage(n > 0);
    if (n === 0) msaaPass._free();
  }
  function syncResolve(inner, full) {
    upscalePass.enabled = inner < full - 1e-3;
    downPass.enabled = cine && inner > full + 1e-3;
  }

  function setSize(w, h, full, inner) {
    cssW = w; cssH = h; prFull = full; prInner = inner;
    // whole pixels: the composer multiplies size by pixel ratio as is (337.5-texel targets)
    const iw = Math.max(1, Math.floor(w * inner)), ih = Math.max(1, Math.floor(h * inner));
    composer.setPixelRatio(1);
    composer.setSize(iw, ih);
    upscalePass.uniforms.uTexel.value.set(1 / iw, 1 / ih);
    downPass.uniforms.uTexel.value.set(1 / iw, 1 / ih);
    gradePass.uniforms.uAspect.value = w / Math.max(1, h);
    syncResolve(inner, full);
    if (cine && msaaWant > 0 && msaaFit() !== msaaN) applyMsaa();
  }

  /**
   * Apply normalised post settings for a quality tier (cheap to call every frame: it only
   * touches passes when something changed).
   */
  function configure(s, quality) {
    const isCine = tierAtLeast(quality, 'cinematic');
    const pick = (k) => (s[k] === undefined ? CINEMATIC_DEFAULTS[k] : s[k]);
    const eff = isCine ? {
      msaa: pick('msaa'), shadowsHigh: pick('shadowsHigh'), contactShadows: pick('contactShadows'), aoFull: pick('aoFull'), fxHigh: pick('fxHigh'),
      motionBlur: pick('motionBlur'), dof: pick('dof'), lensFx: pick('lensFx'), lightShadows: pick('lightShadows'),
    } : { msaa: 0, shadowsHigh: false, contactShadows: false, aoFull: false, fxHigh: false, motionBlur: false, dof: false, lensFx: false, lightShadows: false };
    const key = `${quality}|${s.bloom}|${s.ao}|${s.antialias}|${s.filmGrain}|${s.vignette}|${s.volumetrics}|${s.reflections}|${s.brightness}|${s.contrast}|${s.saturation}|${s.timing}|${Object.values(eff).join(',')}`;
    if (cur === key) return false;
    const tierChanged = !cur || cur.split('|')[0] !== quality;
    const aoChanged = !curSettings || curSettings.aoFull !== eff.aoFull;
    cur = key;
    q = quality;
    cine = isCine;
    ex = eff;
    curSettings = eff;
    const low = q === 'low';
    aoPass.enabled = !low && s.ao;
    if (tierChanged || aoChanged) aoPass.configure(q, eff.aoFull);
    atmosPass.configure(q, s.volumetrics, s.reflections, eff.fxHigh);
    // ---- bloom: the stock Gaussian mips, or the Cinematic dual-filter chain
    bloomPass.enabled = s.bloom && !cine;
    if (bloomPass.off !== cine) {
      // (the stock chain's eleven targets are not kept while the Cinematic bloom is in use)
      bloomPass.off = cine;
      bloomPass.setSize(Math.max(1, Math.floor(cssW * prInner)), Math.max(1, Math.floor(cssH * prInner)));
    }
    hhBloom.setActive(cine && s.bloom);
    hhBloom.enabled = cine && s.bloom;
    const wantLowBloom = low;
    if (bloomPass.lowRes !== wantLowBloom) {
      bloomPass.lowRes = wantLowBloom;
      bloomPass.setSize(Math.max(1, Math.floor(cssW * prInner)), Math.max(1, Math.floor(cssH * prInner)));
    }
    // (by day the grade is brighter and the bloom subtler: `look` from daylight.js)
    bloomPass.strength = look ? look.bloom * (low ? 0.85 : 1) : low ? 0.42 : 0.5;
    bloomPass.radius = low ? 0.35 : 0.5;
    hhBloom.strength = look ? look.bloom : 0.5;
    hhBloom.threshold = look ? look.bloomThreshold : hdr ? 1.2 : 0.72;
    hhBloom.dirt = eff.lensFx ? 0.6 : 0;
    // (the skirt's tint: levels 3-4 like the stock 4th mip, 5-6 like its 5th)
    const t = bloomPass.bloomTintColors;
    hhBloom.bloomTintColors.forEach((v, i) => v.copy(t[i < 3 ? 0 : i < 5 ? 3 : 4]));
    // 'low' never pays for SMAA's three passes: FXAA instead (or nothing)
    const aa = s.antialias === 'off' ? 'off' : low ? 'fxaa' : s.antialias;
    smaaPass.enabled = aa === 'smaa';
    fxaaPass.enabled = aa === 'fxaa';
    gradePass.uniforms.uGrain.value = s.filmGrain ? (look ? look.grain : 0.04) : 0;
    gradePass.uniforms.uVignette.value = s.vignette ? (look ? look.vignette : 0.34) : 0;
    gradePass.uniforms.uCA.value = eff.lensFx ? 0.006 : 0;
    gradePass.uniforms.uUContrast.value = s.contrast;
    gradePass.uniforms.uUSat.value = s.saturation;
    bright = s.brightness;
    // ---- cinematic passes
    contactPass.enabled = eff.contactShadows;
    mbPass.enabled = eff.motionBlur;
    dofPass.enabled = false;             // per frame: only while hurt or downed
    linPass.enabled = eff.motionBlur;
    if (!eff.motionBlur && !eff.dof) linPass.free();
    msaaWant = eff.msaa;
    applyMsaa();
    syncResolve(prInner, prFull);
    timing = !!s.timing && !!gpuTimer;
    if (gpuTimer && gpuTimer.setPerPass) gpuTimer.setPerPass(timing);
    return true;
  }

  function hurtLevel(dt, local) {
    hurtPulse *= Math.exp(-(dt || 0) * 2.6);
    if (!local || local.state === 'dead' || q === 'low') { lastHp = NaN; hurtPulse = 0; return 0; }
    const max = local.maxHp || 100;
    const hp = Math.max(0, Math.min(max, Number(local.hp) || 0));
    if (hp < lastHp) hurtPulse = Math.min(1, hurtPulse + (lastHp - hp) / (max * 0.25));
    lastHp = hp;
    const low = local.state === 'downed' ? 1 : Math.max(0, (0.35 - hp / max) / 0.35);
    return Math.min(1, low * 0.7 + hurtPulse * 0.8);
  }

  // heat / shockwave sources and the sun's flare, projected to the screen each frame
  const _v = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  function updateScreenFx() {
    const gu = gradePass.uniforms;
    let n = 0;
    const fx = getFx ? getFx() : null;
    if (fx && fx.distortions && fx.distortions.length) {
      const fov = Math.tan(camera.fov * Math.PI / 360);
      const list = fx.distortions;
      camera.getWorldDirection(_fwd);
      for (let i = 0; i < list.length && n < DIST_N; i++) {
        const e = list[i];
        _v.set(e.x, e.h, e.y).sub(camera.position);
        const depth = _v.dot(_fwd);
        if (depth < 20 || depth > 3000) continue;
        const rUv = e.r / (2 * depth * fov);
        if (rUv < 0.01) continue;
        _v.set(e.x, e.h, e.y).project(camera);
        if (Math.abs(_v.x) > 1.6 || Math.abs(_v.y) > 1.6) continue;
        const age = e.age / e.life;
        const fade = e.kind ? 1 : Math.min(1, age * 6) * Math.min(1, (1 - age) * 3);
        gu.uDist.value[n].set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, Math.min(0.9, rUv), e.k * fade);
        gu.uDistB.value[n].set(e.kind, age, 0, 0);
        n++;
      }
    }
    gu.uDistN.value = n;
    // lens flare
    let fs = 0;
    if (flareDir && flareStrength > 0 && q !== 'low') {
      camera.getWorldDirection(_fwd);
      if (_fwd.dot(flareDir) > 0.05) {
        _v.copy(flareDir).multiplyScalar(2000).add(camera.position).project(camera);
        if (_v.z < 1 && Math.abs(_v.x) < 1.3 && Math.abs(_v.y) < 1.3) {
          gu.uFlare.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, flareStrength);
          if (flareColor) gu.uFlareCol.value.set(flareColor[0], flareColor[1], flareColor[2]);
          fs = flareStrength;
        }
      }
    }
    if (fs === 0) gu.uFlare.value.z = 0;
  }

  function render(dt, frame) {
    time += dt || 0;
    gradePass.uniforms.uTime.value = time % 1000;
    hurt = hurtLevel(dt, frame && frame.local);
    gradePass.uniforms.uHurt.value = hurt;
    updateScreenFx();
    gradePass.uniforms.toneMappingExposure.value = renderer.toneMappingExposure * bright;
    vmPass.frame = frame;
    if (cine) {
      mbPass.track(dt);
      // contact shadows follow the sun / moon: the sun is strong enough to matter, the moon only a little
      if (contactPass.enabled) {
        const src = getAtmos ? getAtmos() : null;
        const sunDir = src && src.sunDir;
        contactPass.setLight(sunDir || _fwd.set(0, 1, 0), src && src.ambient && src.ambient.time === 'day' ? 0.5 : 0.2);
      }
      // depth of field only while hurt or downed: the world softens as the vision fails
      if (ex.dof) {
        const st = Math.min(1, Math.max(0, (hurt - 0.06) * 1.25));
        dofPass.strength = st * 0.85;
        dofPass.enabled = st > 0.02;
      }
      linPass.enabled = mbPass.enabled || dofPass.enabled;
    }
    composer.render(dt);
    if (cine) mbPass.commit();
  }

  /**
   * Compile every pass' program now (called at creation, with the world compiled). The
   * last pass draws to the canvas (sRGB output: a program of its own), and which pass is
   * last depends on the settings, so each candidate is drawn last once: otherwise the
   * first real frame compiled SMAA's screen variant (a multi-second stall on software GL).
   */
  function warm() {
    const all = [worldPass, msaaPass, vmPass, aoPass, contactPass, linPass, mbPass, dofPass, bloomPass, hhBloom, smaaPass, fxaaPass, upscalePass, downPass];
    const saved = all.map((p) => p.enabled);
    const savedAtmos = [atmosPass.enabled, atmosPass.vol, atmosPass.ssr];
    const savedTiming = timing;
    timing = false;
    try {
      aoPass.enabled = !!aoPass.gtao;
      bloomPass.enabled = !cine;
      hhBloom.enabled = cine && hhBloom.active;
      if (cine) {
        contactPass.enabled = linPass.enabled = mbPass.enabled = dofPass.enabled = true;
        contactPass.strength = 0.5;
        dofPass.strength = 0.5;
      }
      // every atmosphere program (the targets stay 1x1 unless the settings want them)
      atmosPass.enabled = atmosPass.vol = atmosPass.ssr = true;
      // [smaa, fxaa, upscale]: upscale last (both AA passes into targets), SMAA last, FXAA last, grade last
      let first = true;
      for (const [sm, fx, up] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]]) {
        smaaPass.enabled = sm;
        fxaaPass.enabled = fx;
        upscalePass.enabled = up;
        downPass.enabled = false;
        composer.render(0);
        // the scene passes only need compiling once
        if (first) {
          for (const p of [worldPass, msaaPass, vmPass, aoPass, contactPass, linPass, mbPass, dofPass, bloomPass, hhBloom, atmosPass]) p.enabled = false;
          first = false;
        }
      }
      if (cine) { downPass.enabled = true; smaaPass.enabled = true; fxaaPass.enabled = false; upscalePass.enabled = false; composer.render(0); }
    } finally {
      all.forEach((p, i) => { p.enabled = saved[i]; });
      [atmosPass.enabled, atmosPass.vol, atmosPass.ssr] = savedAtmos;
      timing = savedTiming;
    }
    mbPass.havePrev = false;
    if (!ex.motionBlur && !ex.dof) linPass.free();
  }

  return {
    hdr,
    target,
    composer,
    passes: { world: worldPass, msaa: msaaPass, ao: aoPass, contact: contactPass, atmos: atmosPass, depth: linPass, motion: mbPass, dof: dofPass, viewmodel: vmPass, bloom: bloomPass, hhBloom, grade: gradePass, smaa: smaaPass, fxaa: fxaaPass, resolve: downPass, upscale: upscalePass },
    render,
    setSize,
    configure,
    warm,
    /** MSAA samples in use (0 = none). */
    get msaa() { return msaaN; },
    /** The Cinematic extras in effect. */
    get extras() { return ex; },
    /** The buffer the world pass draws into this frame (for program warm-up). */
    get readBuffer() { return composer.readBuffer; },
    get size() { return { cssW, cssH, full: prFull, inner: prInner }; },
    /** Per-pass GPU timing on (needs a GPU timer). */
    get timing() { return timing; },
    /** Draw calls / triangles of the last world pass. */
    sceneInfo,
    dispose() {
      for (const p of composer.passes) {
        try { p.dispose(); } catch { /* a pass without GPU state */ }
      }
      composer.dispose();
      depthTexture.dispose();
      if (composer.renderTarget2.depthTexture) composer.renderTarget2.depthTexture.dispose();
    },
  };
}

// ---- dynamic resolution ------------------------------------------------------------------

/**
 * Dynamic resolution controller: measures real frame time over ~1 s windows and steps
 * the render scale between 0.5 and `maxScale` (1 by default; desktops pass 1.5, Cinematic 2, so a
 * GPU with headroom renders above the native resolution, i.e. supersamples) to hold the target
 * frame rate: `targetFps`, 97 % of the display's refresh rate (58.2 on 60 Hz, 139.7 on 144 Hz;
 * ui/display.js measures the rate). All thresholds are shares of the refresh rate R = targetFps / 0.97,
 * so at 60 Hz they are the classic 55 / 57 / 58.5 fps and an 11 ms GPU-time headroom.
 *  - Below 0.917 R (55 at 60 Hz) it steps down, sized from the shortfall (pixels ∝ scale²).
 *  - With vsync, frame rates move in jumps (60 → 30): a step can show no gain until the
 *    next one crosses a vsync boundary, so no-gain steps are allowed to continue; only
 *    three in a row mean the frame is CPU-bound — then the scale goes back to where it
 *    was and further tries back off (6 s, 12 s, ... 60 s).
 *  - Above 0.975 R for a few windows (one with a GPU timer showing headroom: GPU time under
 *    two thirds of the frame) it steps up one notch; an up-step taken back right away is undone
 *    by exactly one notch and the next up-step waits twice as long (no oscillation, no
 *    reallocation every second).
 * @param {number} [maxScale]
 * @param {number} [targetFps] default 58.2 (97 % of 60 Hz)
 */
export function createDynRes(maxScale = 1, targetFps = 58.2) {
  const MAX = Math.max(1, Math.min(RENDER_SCALE_LIMIT, maxScale));
  let R = Math.max(20, targetFps / 0.97);        // the display's refresh rate this aims at
  let scale = 1;
  let winMs = 0, winN = 0, winGpu = 0, winGpuN = 0;
  const winDt = [];     // frame times of the current window (median: one hitch doesn't count)
  let good = 0, cooldown = 2.5, backoff = 6;
  let probe = null;     // { fps } measured before the last down-step
  let noGain = 0, anchor = 1;
  let lastUp = -1e9, upWait = 3, win = 0;
  let last = 0, slow = 0;
  const QUANT = 0.05;
  const quant = (v) => Math.max(0.5, Math.min(MAX, Math.round(v / QUANT) * QUANT));
  return {
    get scale() { return scale; },
    /** Frame rate this controller aims at (97 % of the refresh rate). */
    get target() { return R * 0.97; },
    /** The display's refresh rate changed (measured late): re-aim, keep the scale. */
    setTarget(fps) { R = Math.max(20, fps / 0.97); },
    reset(s = scale) {
      scale = quant(s); winMs = 0; winN = 0; winGpu = 0; winGpuN = 0; winDt.length = 0; good = 0; probe = null;
      noGain = 0; anchor = scale; cooldown = 2; last = 0; upWait = 3; lastUp = -1e9; slow = 0;
    },
    /**
     * Feed one frame. Returns the new scale when it changed, else null.
     * @param {number} now performance.now()
     * @param {number|undefined} gpuMs last measured GPU frame time
     */
    tick(now, gpuMs) {
      const dt = last ? now - last : 0;
      last = now;
      if (!(dt > 0)) return null;                      // first frame
      if (dt > 2000) {
        // one long gap is a hidden tab or a hitch; a run of them is a GPU far too slow
        // for the window logic below (it never fills a window): step down hard
        if (++slow >= 3 && scale > 0.5) {
          slow = 0;
          scale = quant(scale - 0.25);
          cooldown = 0.6;
          return scale;
        }
        return null;
      }
      slow = 0;
      if (cooldown > 0) { cooldown -= dt / 1000; return null; }
      winMs += dt; winN++;
      if (winDt.length < 512) winDt.push(dt);
      if (Number.isFinite(gpuMs)) { winGpu += gpuMs; winGpuN++; }
      if (winMs < 1000 || winN < 3) return null;
      winDt.sort((a, b) => a - b);
      const fps = 1000 / winDt[winDt.length >> 1];
      const gpu = winGpuN ? winGpu / winGpuN : NaN;
      const timed = Number.isFinite(gpu);
      winMs = 0; winN = 0; winGpu = 0; winGpuN = 0; winDt.length = 0;
      win++;
      const low = R * 0.917, okFps = R * 0.95, upFps = R * 0.975, headroom = (1000 / R) * 0.66;
      if (probe) {
        if (fps >= probe.fps * 1.04 || fps >= okFps) noGain = 0;
        else noGain++;
        probe = null;
      }
      let next = scale;
      if (noGain >= 3) {
        // three steps bought nothing: not GPU-bound. Back to where we were, try later.
        next = anchor;
        noGain = 0;
        cooldown = backoff;
        backoff = Math.min(60, backoff * 2);
        good = 0;
      } else if (fps < low && scale > 0.5) {
        good = 0;
        if (noGain === 0) anchor = scale;
        if (win - lastUp <= 2) {
          // the last up-step was one too far: undo exactly that, wait longer next time
          upWait = Math.min(64, upWait * 2);
          next = scale - QUANT;
        } else {
          const want = scale * Math.sqrt(Math.max(0.25, fps / R));
          next = Math.max(scale - 0.1, Math.min(scale - QUANT, want));
        }
        probe = { fps };
      } else if (scale < MAX && (timed ? gpu < headroom && fps > okFps : fps >= upFps)) {
        good++;
        if (good >= (timed ? 1 : upWait)) { next = scale + QUANT; good = 0; lastUp = win; }
      } else {
        good = 0;
        if (fps >= low) backoff = Math.max(6, backoff * 0.9);
      }
      // long stable stretches earn back quicker up-steps
      if (win - lastUp > 0 && (win - lastUp) % 30 === 0 && upWait > 3) upWait = Math.max(3, upWait / 2);
      next = quant(next);
      if (next === scale) return null;
      scale = next;
      cooldown = Math.max(cooldown, 0.6);   // let the reallocation settle before measuring again
      return scale;
    },
  };
}

// ---- GPU timing ----------------------------------------------------------------------------

/**
 * GPU time through EXT_disjoint_timer_query_webgl2 (null when unavailable). begin(id) / end()
 * bracket one span (queries cannot nest); results arrive a few frames later and are smoothed per id.
 * `ms` is the frame span ('frame') or, in per-pass mode (setPerPass(true), the stats overlay), the sum of the
 * passes; `passes` maps each pass' id to its milliseconds.
 */
export function createGpuTimer(gl) {
  let ext = null;
  try { ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch { ext = null; }
  if (!ext) return null;
  const pending = [];
  let active = null;
  const avg = new Map();
  let perPass = false;
  let broken = false;
  function poll() {
    try {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length) {
        const p = pending[0];
        if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!disjoint) {
          const v = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
          const old = avg.get(p.id);
          avg.set(p.id, old === undefined ? v : old + (v - old) * 0.2);
        }
        gl.deleteQuery(p.q);
      }
    } catch { broken = true; }
  }
  return {
    get ms() {
      if (!perPass) return avg.get('frame');
      let sum, any = false;
      for (const [k, v] of avg) if (k !== 'frame') { sum = (sum || 0) + v; any = true; }
      return any ? sum : undefined;
    },
    /** id -> ms of each pass measured so far (per-pass mode). */
    get passes() {
      const o = {};
      for (const [k, v] of avg) if (k !== 'frame') o[k] = v;
      return o;
    },
    setPerPass(on) {
      if (on === perPass) return;
      perPass = on;
      avg.clear();
    },
    begin(id = 'frame') {
      if (broken || active || pending.length >= 64) return;
      try {
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        active = { q, id };
      } catch { broken = true; active = null; }
    },
    end() {
      if (!active) return;
      try { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); } catch { broken = true; }
      active = null;
      poll();
    },
    dispose() {
      try {
        if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
        for (const p of pending) gl.deleteQuery(p.q);
        if (active) gl.deleteQuery(active.q);
      } catch { /* context lost */ }
      pending.length = 0;
      active = null;
    },
  };
}
