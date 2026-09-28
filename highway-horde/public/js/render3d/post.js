// Post-processing chain of the first-person view (WORLD, SPEC §7.5). The world is drawn
// into a linear HDR (half-float) target and finished here:
//
//   world (RenderPass into the HDR target, with a depth texture)
//   → ambient occlusion (GTAO at half resolution, normals rebuilt from that depth: no
//     second geometry pass; 'high'/'ultra' only). It runs BEFORE the viewmodel so the gun
//     is never darkened by the wall behind it.
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

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

/** Settings the chain understands, with their defaults (SPEC §7.5 graphics settings). */
export const POST_DEFAULTS = Object.freeze({
  renderScale: 'auto', bloom: true, ao: true, antialias: 'smaa', filmGrain: true, vignette: true,
});

/**
 * Normalise a settings object to the post contract (unknown / invalid values → defaults).
 * @param {object} [s]
 * @returns {{renderScale: 'auto'|number, bloom: boolean, ao: boolean, antialias: 'smaa'|'fxaa'|'off', filmGrain: boolean, vignette: boolean}}
 */
export function normPostSettings(s) {
  const o = s || {};
  let rs = o.renderScale;
  if (rs !== 'auto') {
    rs = Number(rs);
    rs = Number.isFinite(rs) && rs > 0 ? Math.max(0.5, Math.min(1, rs)) : 'auto';
  }
  const aa = o.antialias === 'fxaa' || o.antialias === 'off' || o.antialias === 'smaa' ? o.antialias : 'smaa';
  return {
    renderScale: rs,
    bloom: o.bloom !== false,
    ao: o.ao !== false,
    antialias: aa,
    filmGrain: o.filmGrain !== false,
    vignette: o.vignette !== false,
  };
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

  configure(q) {
    const ultra = q === 'ultra';
    // units: 1 world unit ≈ 3 cm, so radius 20 ≈ 0.6 m of contact shadow
    this.gtao.updateGtaoMaterial({ radius: 20, distanceExponent: 1.6, thickness: 12, scale: 1.15, samples: ultra ? 16 : 10, distanceFallOff: 1 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: ultra ? 8 : 6, rings: 2, samples: ultra ? 12 : 8 });
    this.blend.uniforms.intensity.value = 0.85;
  }

  setSize(w, h) {
    this.gtao.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
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
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uContrast, uSaturation, uAspect;
    uniform vec3 uLift, uGamma, uGain;
    // the material is toneMapped: false, so three's prefix never adds these (it always
    // adds colorspace_pars_fragment, whose sRGBTransferOETF is used below)
    #include <tonemapping_pars_fragment>
    varying vec2 vUv;
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = max(src.rgb, 0.0);
      c = ACESFilmicToneMapping(c);
      c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
      // grade in display space: saturation, contrast around a low (night) pivot,
      // then lift (cool shadows) / gamma / gain (warm highlights)
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = max((c - 0.32) * uContrast + 0.32, 0.0);
      c = c * uGain + uLift * (1.0 - c);
      c = pow(max(c, 0.0), 1.0 / uGamma);
      // vignette: an ellipse matched to the frame, darkening the corners
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0) / sqrt(uAspect * uAspect + 1.0) * 2.0;
      c *= 1.0 - uVignette * smoothstep(0.35, 1.05, dot(d, d));
      // film grain: animated, stronger in the mid-darks, invisible in highlights
      float n = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 173.0) + hash12(gl_FragCoord.yx * 1.37 + fract(uTime * 3.17) * 91.0) - 1.0;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      c += n * uGrain * (1.0 - smoothstep(0.1, 0.85, lum)) * (0.35 + lum);
      // 8-bit dither: the dark sky / fog gradients band without it
      c += (hash12(gl_FragCoord.xy * 0.71 + 3.1) - 0.5) / 255.0;
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

// ---- chain ---------------------------------------------------------------------------

/**
 * Build the post chain.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ scene: THREE.Scene, camera: THREE.Camera, getViewmodel: () => object|null, quality: string }} o
 * @returns {object} { render(dt, frame), setSize(cssW, cssH, prFull, prInner) (canvas at prFull,
 *   internal targets at prInner), configure(settings, quality), warm(), target (the world
 *   render target), readBuffer, passes, sceneInfo (world pass calls / triangles), dispose() }
 */
export function createPost(renderer, { scene, camera, getViewmodel, quality }) {
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

  const worldPass = new RenderPass(scene, camera);
  // draw calls / triangles of the world pass alone (shadow maps included), for r.stats
  const sceneInfo = { calls: 0, triangles: 0 };
  const baseWorldRender = worldPass.render.bind(worldPass);
  worldPass.render = (renderer2, w, r, dt, mask) => {
    const i = renderer2.info.render, c0 = i.calls, t0 = i.triangles;
    baseWorldRender(renderer2, w, r, dt, mask);
    sceneInfo.calls = i.calls - c0;
    sceneInfo.triangles = i.triangles - t0;
  };
  const aoPass = new DepthAOPass(scene, camera);
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
  bloomPass.baseSetSize = bloomPass.setSize;
  bloomPass.lowRes = false;
  // 'low' starts the bloom mips at quarter instead of half resolution: 4x fewer pixels
  bloomPass.setSize = function setSize(w, h) {
    const k = this.lowRes ? 0.5 : 1;
    this.baseSetSize(Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k)));
  };
  const gradePass = new ShaderPass(GRADE_SHADER);
  gradePass.material.toneMapped = false;
  const smaaPass = new SMAAPass();
  const fxaaPass = new FXAAPass();
  const upscalePass = new ShaderPass(UPSCALE_SHADER);
  for (const p of [worldPass, aoPass, vmPass, bloomPass, gradePass, smaaPass, fxaaPass, upscalePass]) composer.addPass(p);

  let q = quality;
  let cur = null;
  let cssW = 1, cssH = 1, prFull = 1, prInner = 1;
  let time = 0;

  function setSize(w, h, full, inner) {
    cssW = w; cssH = h; prFull = full; prInner = inner;
    // whole pixels: the composer multiplies size by pixel ratio as is (337.5-texel targets)
    const iw = Math.max(1, Math.floor(w * inner)), ih = Math.max(1, Math.floor(h * inner));
    composer.setPixelRatio(1);
    composer.setSize(iw, ih);
    upscalePass.uniforms.uTexel.value.set(1 / iw, 1 / ih);
    gradePass.uniforms.uAspect.value = w / Math.max(1, h);
    upscalePass.enabled = inner < full - 1e-3;
  }

  /**
   * Apply normalised post settings for a quality tier (cheap to call every frame: it only
   * touches passes when something changed).
   */
  function configure(s, quality) {
    const key = `${quality}|${s.bloom}|${s.ao}|${s.antialias}|${s.filmGrain}|${s.vignette}`;
    if (cur === key) return false;
    const tierChanged = !cur || cur.split('|')[0] !== quality;
    cur = key;
    q = quality;
    const low = q === 'low';
    aoPass.enabled = !low && s.ao;
    if (tierChanged) aoPass.configure(q);
    bloomPass.enabled = s.bloom;
    const wantLowBloom = low;
    if (bloomPass.lowRes !== wantLowBloom) {
      bloomPass.lowRes = wantLowBloom;
      bloomPass.setSize(Math.max(1, Math.floor(cssW * prInner)), Math.max(1, Math.floor(cssH * prInner)));
    }
    bloomPass.strength = low ? 0.42 : 0.5;
    bloomPass.radius = low ? 0.35 : 0.5;
    // 'low' never pays for SMAA's three passes: FXAA instead (or nothing)
    const aa = s.antialias === 'off' ? 'off' : low ? 'fxaa' : s.antialias;
    smaaPass.enabled = aa === 'smaa';
    fxaaPass.enabled = aa === 'fxaa';
    gradePass.uniforms.uGrain.value = s.filmGrain ? 0.04 : 0;
    gradePass.uniforms.uVignette.value = s.vignette ? 0.34 : 0;
    return true;
  }

  function render(dt, frame) {
    time += dt || 0;
    gradePass.uniforms.uTime.value = time % 1000;
    gradePass.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    vmPass.frame = frame;
    composer.render(dt);
  }

  /**
   * Compile every pass' program now (called at creation, with the world compiled). The
   * last pass draws to the canvas (sRGB output: a program of its own), and which pass is
   * last depends on the settings, so each candidate is drawn last once: otherwise the
   * first real frame compiled SMAA's screen variant (a multi-second stall on software GL).
   */
  function warm() {
    const saved = [worldPass.enabled, vmPass.enabled, aoPass.enabled, bloomPass.enabled, smaaPass.enabled, fxaaPass.enabled, upscalePass.enabled];
    try {
      aoPass.enabled = !!aoPass.gtao;
      bloomPass.enabled = true;
      // [smaa, fxaa, upscale]: upscale last (both AA passes into targets), SMAA last, FXAA last, grade last
      let first = true;
      for (const [sm, fx, up] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]]) {
        smaaPass.enabled = sm;
        fxaaPass.enabled = fx;
        upscalePass.enabled = up;
        composer.render(0);
        // the scene passes only need compiling once
        if (first) { worldPass.enabled = false; vmPass.enabled = false; aoPass.enabled = false; bloomPass.enabled = false; first = false; }
      }
    } finally {
      [worldPass.enabled, vmPass.enabled, aoPass.enabled, bloomPass.enabled, smaaPass.enabled, fxaaPass.enabled, upscalePass.enabled] = saved;
    }
  }

  return {
    hdr,
    target,
    composer,
    passes: { world: worldPass, ao: aoPass, viewmodel: vmPass, bloom: bloomPass, grade: gradePass, smaa: smaaPass, fxaa: fxaaPass, upscale: upscalePass },
    render,
    setSize,
    configure,
    warm,
    /** The buffer the world pass draws into this frame (for program warm-up). */
    get readBuffer() { return composer.readBuffer; },
    get size() { return { cssW, cssH, full: prFull, inner: prInner }; },
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
 * the render scale between 0.5 and 1 to hold ~58–60 fps.
 *  - Below 55 fps it steps down, sized from the shortfall (pixels ∝ scale²).
 *  - With vsync, frame rates move in jumps (60 → 30): a step can show no gain until the
 *    next one crosses a vsync boundary, so no-gain steps are allowed to continue; only
 *    three in a row mean the frame is CPU-bound — then the scale goes back to where it
 *    was and further tries back off (6 s, 12 s, ... 60 s).
 *  - Above 58.5 fps for a few windows (one with a GPU timer showing headroom) it steps up
 *    one notch; an up-step taken back right away is undone by exactly one notch and the
 *    next up-step waits twice as long (no oscillation, no reallocation every second).
 */
export function createDynRes() {
  let scale = 1;
  let winMs = 0, winN = 0, winGpu = 0, winGpuN = 0;
  const winDt = [];     // frame times of the current window (median: one hitch doesn't count)
  let good = 0, cooldown = 2.5, backoff = 6;
  let probe = null;     // { fps } measured before the last down-step
  let noGain = 0, anchor = 1;
  let lastUp = -1e9, upWait = 3, win = 0;
  let last = 0, slow = 0;
  const QUANT = 0.05;
  const quant = (v) => Math.max(0.5, Math.min(1, Math.round(v / QUANT) * QUANT));
  return {
    get scale() { return scale; },
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
      if (probe) {
        if (fps >= probe.fps * 1.04 || fps >= 57) noGain = 0;
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
      } else if (fps < 55 && scale > 0.5) {
        good = 0;
        if (noGain === 0) anchor = scale;
        if (win - lastUp <= 2) {
          // the last up-step was one too far: undo exactly that, wait longer next time
          upWait = Math.min(64, upWait * 2);
          next = scale - QUANT;
        } else {
          const want = scale * Math.sqrt(Math.max(0.25, fps / 60));
          next = Math.max(scale - 0.1, Math.min(scale - QUANT, want));
        }
        probe = { fps };
      } else if (scale < 1 && (timed ? gpu < 11 && fps > 57 : fps >= 58.5)) {
        good++;
        if (good >= (timed ? 1 : upWait)) { next = scale + QUANT; good = 0; lastUp = win; }
      } else {
        good = 0;
        if (fps >= 55) backoff = Math.max(6, backoff * 0.9);
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
 * GPU frame time through EXT_disjoint_timer_query_webgl2 (null when unavailable).
 * begin()/end() bracket the frame; `ms` is the latest resolved measurement.
 */
export function createGpuTimer(gl) {
  let ext = null;
  try { ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch { ext = null; }
  if (!ext) return null;
  const pending = [];
  let active = null;
  let ms;
  let broken = false;
  return {
    get ms() { return ms; },
    begin() {
      if (broken || active || pending.length >= 4) return;
      try {
        active = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
      } catch { broken = true; active = null; }
    },
    end() {
      if (!active) return;
      try { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); } catch { broken = true; }
      active = null;
      try {
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        while (pending.length) {
          const qq = pending[0];
          if (!gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) break;
          pending.shift();
          if (!disjoint) {
            const v = gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6;
            ms = ms === undefined ? v : ms + (v - ms) * 0.2;
          }
          gl.deleteQuery(qq);
        }
      } catch { broken = true; }
    },
    dispose() {
      try {
        if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
        for (const qq of pending) gl.deleteQuery(qq);
        if (active) gl.deleteQuery(active);
      } catch { /* context lost */ }
      pending.length = 0;
      active = null;
    },
  };
}
