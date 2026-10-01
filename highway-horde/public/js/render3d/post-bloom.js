// The Cinematic bloom (SPEC §7.5.3): a 7-level dual-filter chain instead of the stock pass' five
// separable Gaussian mips.
//
//   1. the first downsample reads the FULL-resolution frame with 13 taps, applies the soft-knee
//      threshold per tap and weighs the groups by 1 / (1 + luma) (Karis average), so a single hot pixel
//      cannot flicker the whole glow and small lights keep a crisp core;
//   2. six more 13-tap downsamples (down to 1/128 of the frame);
//   3. an upsample chain: each level's image, weighted and tinted, plus the 3x3-tent-filtered result of
//      the smaller levels, so the wide skirt is smooth without a big kernel anywhere;
//   4. an additive composite with a screen-fixed lens-dirt mask that catches the wide glow.
//
// The public fields mirror UnrealBloomPass (strength, threshold, knee, bloomTintColors) so post.js
// drives either one. The targets exist only while the pass is `active` (the Cinematic tier).

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function shader(frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, ...extra });
}

export const BLOOM_LEVELS = 7;
/** Weight of each level of the chain (level 0 = half resolution): a tight core and a wide soft skirt. */
export const BLOOM_WEIGHTS = [1.0, 0.93, 0.83, 0.73, 0.6, 0.41, 0.24];

const DOWN_FRAG = `
precision highp float;
uniform sampler2D tInput;
uniform vec2 uTexel;                       // texel size of the INPUT
uniform float uThreshold, uKnee, uFirst;
varying vec2 vUv;
vec3 prefilter(vec3 c) {
  if (uFirst < 0.5) return c;
  float v = max(max(c.r, c.g), c.b);
  float soft = clamp(v - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * max(uKnee, 1e-4));
  float contrib = max(soft, v - uThreshold) / max(v, 1e-4);
  return min(c * contrib, vec3(24.0));
}
vec3 S(vec2 o) { return prefilter(max(texture2D(tInput, vUv + o * uTexel).rgb, 0.0)); }
float kw(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  // 13 taps (Jimenez, "Next generation post processing in Call of Duty: Advanced Warfare")
  vec3 a = S(vec2(-2.0, -2.0)), b = S(vec2(0.0, -2.0)), c = S(vec2(2.0, -2.0));
  vec3 d = S(vec2(-1.0, -1.0)), e = S(vec2(1.0, -1.0));
  vec3 f = S(vec2(-2.0, 0.0)), g = S(vec2(0.0, 0.0)), h = S(vec2(2.0, 0.0));
  vec3 i = S(vec2(-1.0, 1.0)), j = S(vec2(1.0, 1.0));
  vec3 k = S(vec2(-2.0, 2.0)), l = S(vec2(0.0, 2.0)), m = S(vec2(2.0, 2.0));
  vec3 g0 = (d + e + i + j) * 0.25, g1 = (a + b + f + g) * 0.25, g2 = (b + c + g + h) * 0.25, g3 = (f + g + k + l) * 0.25, g4 = (g + h + l + m) * 0.25;
  vec3 r;
  if (uFirst > 0.5) {
    float w0 = kw(g0) * 0.5, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.125;
    r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    r = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }
  gl_FragColor = vec4(r, 1.0);
}`;

const TENT = (tex, uv, t) => `(
    ${tex}(${uv}) * 4.0
    + (${tex}(${uv} + vec2(${t}.x, 0.0)) + ${tex}(${uv} - vec2(${t}.x, 0.0)) + ${tex}(${uv} + vec2(0.0, ${t}.y)) + ${tex}(${uv} - vec2(0.0, ${t}.y))) * 2.0
    + (${tex}(${uv} + ${t}) + ${tex}(${uv} - ${t}) + ${tex}(${uv} + vec2(${t}.x, -${t}.y)) + ${tex}(${uv} + vec2(-${t}.x, ${t}.y)))
  ) * (1.0 / 16.0)`;

const UP_FRAG = `
precision highp float;
uniform sampler2D tOwn, tLow;             // this level's downsampled image, and the (smaller) result so far
uniform vec2 uLowTexel;
uniform vec3 uTint;
uniform float uWeight, uHasLow;
varying vec2 vUv;
vec3 low(vec2 uv) { return texture2D(tLow, uv).rgb; }
void main() {
  vec3 own = texture2D(tOwn, vUv).rgb * uWeight * uTint;
  vec3 lo = vec3(0.0);
  if (uHasLow > 0.5) lo = ${TENT('low', 'vUv', 'uLowTexel')};
  gl_FragColor = vec4(own + lo, 1.0);
}`;

const ADD_FRAG = `
precision highp float;
uniform sampler2D tBloom, tDirt;
uniform vec2 uTexel;
uniform float uStrength, uDirt, uAspect;
varying vec2 vUv;
vec3 bl(vec2 uv) { return texture2D(tBloom, uv).rgb; }
void main() {
  vec3 b = ${TENT('bl', 'vUv', 'uTexel')};
  // lens dirt: a screen-fixed smudge mask that catches the wide glow
  float dirt = 1.0 + uDirt * texture2D(tDirt, vUv * vec2(uAspect / 1.7777778, 1.0)).r;
  gl_FragColor = vec4(b * uStrength * dirt, 1.0);
}`;

/** A procedural lens-dirt mask: smudges, a few streaks and dust specks (red channel, mostly dark). */
export function makeDirtTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  let seed = 90210;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S, y = rnd() * S, r = 14 + rnd() * 70, a = 0.05 + rnd() * 0.16;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    g.lineWidth = 1 + rnd() * 4;
    g.beginPath();
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 40 + rnd() * 120;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 10, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < 220; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 2.2;
    g.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export class HHBloomPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.strength = 0.5;
    this.threshold = 1.2;
    this.knee = 0.45;
    this.dirt = 0;
    this.bloomTintColors = Array.from({ length: BLOOM_LEVELS }, () => new THREE.Vector3(1, 1, 1));
    this.w = 2; this.h = 2;
    this.active = false;
    this.down = [];
    this.up = [];
    this.downMat = shader(DOWN_FRAG, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.2 }, uKnee: { value: 0.45 }, uFirst: { value: 1 } });
    this.upMat = shader(UP_FRAG, { tOwn: { value: null }, tLow: { value: null }, uLowTexel: { value: new THREE.Vector2() }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uWeight: { value: 1 }, uHasLow: { value: 0 } });
    this.dirtTex = null;
    this.addMat = shader(ADD_FRAG, { tBloom: { value: null }, tDirt: { value: null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 0.5 }, uDirt: { value: 0 }, uAspect: { value: 16 / 9 } }, {
      blending: THREE.AdditiveBlending, transparent: true,
    });
    this.quad = new FullScreenQuad(this.downMat);
  }

  /** Allocate (or free) the level targets: only the Cinematic tier keeps this pass alive. */
  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    this._resize();
  }

  setSize(w, h) {
    this.w = Math.max(2, Math.round(w));
    this.h = Math.max(2, Math.round(h));
    this._resize();
  }

  _resize() {
    const mk = (x, y) => {
      const t = new THREE.WebGLRenderTarget(x, y, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      t.texture.generateMipmaps = false;
      return t;
    };
    if (!this.active) {
      for (const t of [...this.down, ...this.up]) t.dispose();
      this.down = []; this.up = [];
      return;
    }
    let x = Math.max(1, Math.round(this.w / 2)), y = Math.max(1, Math.round(this.h / 2));
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      if (!this.down[i]) { this.down[i] = mk(x, y); this.up[i] = mk(x, y); } else { this.down[i].setSize(x, y); this.up[i].setSize(x, y); }
      x = Math.max(1, Math.round(x / 2)); y = Math.max(1, Math.round(y / 2));
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.active || !this.down.length) return;
    const q = this.quad;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    try {
      // 1) threshold + first downsample from the full-resolution frame, then the rest of the chain
      const du = this.downMat.uniforms;
      du.uThreshold.value = this.threshold;
      du.uKnee.value = this.knee;
      q.material = this.downMat;
      let src = readBuffer.texture, sw = this.w, sh = this.h;
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        du.tInput.value = src;
        du.uTexel.value.set(1 / sw, 1 / sh);
        du.uFirst.value = i === 0 ? 1 : 0;
        renderer.setRenderTarget(this.down[i]);
        q.render(renderer);
        src = this.down[i].texture;
        sw = this.down[i].width; sh = this.down[i].height;
      }
      // 2) upsample: each level's weighted image plus the tent-filtered result of the smaller ones
      const uu = this.upMat.uniforms;
      q.material = this.upMat;
      for (let i = BLOOM_LEVELS - 1; i >= 0; i--) {
        uu.tOwn.value = this.down[i].texture;
        uu.uWeight.value = BLOOM_WEIGHTS[i];
        uu.uTint.value.copy(this.bloomTintColors[i]);
        uu.uHasLow.value = i === BLOOM_LEVELS - 1 ? 0 : 1;
        if (i < BLOOM_LEVELS - 1) {
          uu.tLow.value = this.up[i + 1].texture;
          uu.uLowTexel.value.set(1 / this.up[i + 1].width, 1 / this.up[i + 1].height);
        }
        renderer.setRenderTarget(this.up[i]);
        q.render(renderer);
      }
      // 3) add to the frame
      if (!this.dirtTex && this.dirt > 0) this.dirtTex = makeDirtTexture();
      const au = this.addMat.uniforms;
      au.tBloom.value = this.up[0].texture;
      au.tDirt.value = this.dirtTex;
      au.uTexel.value.set(1 / this.up[0].width, 1 / this.up[0].height);
      au.uStrength.value = 3 * this.strength;      // (as the stock pass: 3 x strength x level factor)
      au.uDirt.value = this.dirtTex ? this.dirt : 0;
      au.uAspect.value = this.w / this.h;
      q.material = this.addMat;
      renderer.setRenderTarget(readBuffer);
      q.render(renderer);
    } finally {
      renderer.autoClear = ac;
    }
  }

  dispose() {
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = []; this.up = [];
    this.downMat.dispose(); this.upMat.dispose(); this.addMat.dispose();
    this.dirtTex?.dispose();
    this.quad.dispose();
  }
}
