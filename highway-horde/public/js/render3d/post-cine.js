// Cinematic-tier passes of the post chain (SPEC §7.5.3). post.js builds them next to the
// standard ones and switches each with its own graphics toggle; below the Cinematic tier none of
// them exists in the frame (disabled passes cost nothing, and their targets are 1x1 or absent).
//
//   MsaaWorldPass     the world drawn into a multisampled HDR target (2x / 4x / 8x), resolved by the GPU and
//                     copied (colour and depth) into the chain's buffer: every geometric edge, alpha-tested
//                     leaf (alpha-to-coverage) and thin wire gets real coverage before SMAA sees it
//   ContactShadowPass a short screen-space march toward the sun / moon from every pixel: the small
//                     shadows where a crate meets the road that a 2 cm shadow map cannot hold
//   DepthCopyPass     the view distance of every pixel in an R16F target: a pass that swaps the chain's
//                     buffers writes into the one whose depth attachment holds the frame's depth, and
//                     WebGL forbids sampling a texture that is attached to the bound framebuffer
//   MotionBlurPass    camera motion blur from depth re-projection (previous view-projection), sky included
//   DofPass           depth of field for the hurt / downed state: focus follows the crosshair (smoothed on
//                     the GPU in a 1x1 target), the far background and the edges of the view soften
//
// All read the frame's depth (never a second geometry pass).

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEPTH_PARS = `
#include <packing>
uniform highp sampler2D tDepth;
uniform float uNear, uFar;
uniform mat4 uProjInv;
float hhViewZ(float d) { return perspectiveDepthToViewZ(d, uNear, uFar); }
vec3 hhViewPos(vec2 uv, float d) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
float hhIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

function shader(frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, ...extra });
}

const depthUniforms = () => ({ tDepth: { value: null }, uNear: { value: 1 }, uFar: { value: 1000 }, uProjInv: { value: new THREE.Matrix4() } });
function setDepthUniforms(u, camera, depth) {
  u.tDepth.value = depth;
  u.uNear.value = camera.near;
  u.uFar.value = camera.far;
  u.uProjInv.value.copy(camera.projectionMatrixInverse);
}

// ---- MSAA world -----------------------------------------------------------------------------------

const COPY_FRAG = `
precision highp float;
uniform sampler2D tColor;
uniform highp sampler2D tDepth;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tColor, vUv);
  gl_FragDepth = texture2D(tDepth, vUv).x;
}`;

/**
 * The world pass with multisampling. The scene is drawn into a private multisampled render target
 * (three.js resolves it into its colour texture and depth texture); a full-screen copy then moves
 * both into the chain's read buffer, so every later pass works on ordinary single-sample targets
 * (nothing else is multisampled: no second resolve per fullscreen pass). Memory is allocated
 * while the pass is enabled and released when it is not.
 */
export class MsaaWorldPass extends Pass {
  constructor(scene, camera, hdr) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.scene = scene;
    this.camera = camera;
    this.hdr = hdr;
    this.samples = 4;
    this.w = 1; this.h = 1;
    this.rt = null;
    this.mat = shader(COPY_FRAG, { tColor: { value: null }, tDepth: { value: null } }, {
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, blending: THREE.NoBlending,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.a2c = [];              // materials switched to alpha-to-coverage
  }

  /** Samples actually used (0 = off): the request clamped to the GPU's limit. */
  static clamp(renderer, want) {
    const max = renderer.capabilities.maxSamples || 4;
    return want > 0 ? Math.min(max, want) : 0;
  }

  setSamples(n) {
    if (n === this.samples) return;
    this.samples = n;
    this._free();
  }

  setSize(w, h) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    if (this.rt) this.rt.setSize(this.w, this.h);
  }

  _free() {
    if (!this.rt) return;
    this.rt.depthTexture?.dispose();
    this.rt.dispose();
    this.rt = null;
  }

  _alloc() {
    const depth = new THREE.DepthTexture(this.w, this.h);
    depth.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, {
      type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: this.samples, depthTexture: depth, stencilBuffer: false,
    });
    this.rt.texture.name = 'hh-post.msaa';
  }

  /** Alpha-tested materials (leaves, fences, lettering) get alpha-to-coverage while MSAA is on. */
  setCoverage(on) {
    if (on) {
      if (this.a2c.length) return;
      const seen = new Set();
      this.scene.traverse((o) => {
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) {
          if (seen.has(m)) continue;
          seen.add(m);
          if (m.alphaTest > 0 && !m.transparent && !m.alphaToCoverage && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) {
            m.alphaToCoverage = true;
            m.needsUpdate = true;
            this.a2c.push(m);
          }
        }
      });
    } else if (this.a2c.length) {
      for (const m of this.a2c) { m.alphaToCoverage = false; m.needsUpdate = true; }
      this.a2c.length = 0;
    }
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.rt) this._alloc();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);          // (autoClear: the background colour, then the frame)
    this.mat.uniforms.tColor.value = this.rt.texture;
    this.mat.uniforms.tDepth.value = this.rt.depthTexture;
    renderer.setRenderTarget(readBuffer);
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    try { this.quad.render(renderer); } finally { renderer.autoClear = ac; }
  }

  dispose() {
    this.setCoverage(false);
    this._free();
    this.mat.dispose();
    this.quad.dispose();
  }
}

// ---- contact shadows -----------------------------------------------------------------------------------

const CONTACT_FRAG = `
precision highp float;
${DEPTH_PARS}
uniform mat4 uProj;
uniform vec3 uLightV;            // view-space direction TOWARD the light
uniform float uLen, uStrength, uThick;
varying vec2 vUv;
#define STEPS 16
void main() {
  gl_FragColor = vec4(1.0);
  float d = texture2D(tDepth, vUv).x;
  vec3 P = hhViewPos(vUv, min(d, 0.9999));
  // (derivatives before any early exit: uniform control flow)
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  if (d >= 0.999999) return;
  float dist = -P.z;
  float fade = 1.0 - smoothstep(260.0, 640.0, dist);
  if (fade <= 0.0) return;
  float facing = dot(N, uLightV);
  if (facing <= 0.04) return;                           // turned away from the light: already dark
  float jit = hhIgn(gl_FragCoord.xy);
  float bias = 0.06 + dist * 0.0009;
  float occ = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jit) / float(STEPS);
    vec3 S = P + N * 0.25 + uLightV * (uLen * (0.06 + t));
    vec4 c = uProj * vec4(S, 1.0);
    if (c.w <= 0.0) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sd = texture2D(tDepth, uv).x;
    if (sd >= 0.999999) continue;
    float dz = hhViewZ(sd) - S.z;                       // > 0: the surface there is in front of the ray
    if (dz > bias && dz < uThick + t * 3.0) { occ = 1.0 - t * 0.55; break; }
  }
  float k = uStrength * occ * fade * smoothstep(0.04, 0.35, facing);
  gl_FragColor = vec4(vec3(1.0 - k), 1.0);
}`;

const MULT_FRAG = `
uniform sampler2D tMask;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vec3(texture2D(tMask, vUv).r), 1.0); }`;

/**
 * Screen-space contact shadows toward the sun / moon. The factor is computed into a small target (the
 * frame's depth cannot be sampled while it is attached to the framebuffer being drawn) and multiplied into
 * the frame like the AO.
 */
export class ContactShadowPass extends Pass {
  constructor(camera) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.camera = camera;
    this.strength = 0.5;
    this.w = 2; this.h = 2;
    this.rt = null;
    this.mat = shader(CONTACT_FRAG, {
      ...depthUniforms(), uProj: { value: new THREE.Matrix4() }, uLightV: { value: new THREE.Vector3(0, 1, 0) },
      uLen: { value: 20 }, uStrength: { value: 0.5 }, uThick: { value: 5 },
    });
    this.mult = shader(MULT_FRAG, { tMask: { value: null } }, {
      blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, transparent: true,
    });
    this.quad = new FullScreenQuad(this.mat);
    this._v = new THREE.Vector3();
  }

  /** dirWorld: unit vector from the scene toward the sun / moon. */
  setLight(dirWorld, strength) {
    this._v.copy(dirWorld).transformDirection(this.camera.matrixWorldInverse);
    this.mat.uniforms.uLightV.value.copy(this._v);
    this.mat.uniforms.uStrength.value = strength;
    this.strength = strength;
  }

  setSize(w, h) {
    this.w = Math.max(2, Math.round(w)); this.h = Math.max(2, Math.round(h));
    if (this.rt) this.rt.setSize(this.w, this.h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer.depthTexture;
    if (!depth || this.strength <= 0.005) return;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.rt.texture.generateMipmaps = false;
    }
    const u = this.mat.uniforms;
    setDepthUniforms(u, this.camera, depth);
    u.uProj.value.copy(this.camera.projectionMatrix);
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    try {
      this.quad.material = this.mat;
      renderer.setRenderTarget(this.rt);
      this.quad.render(renderer);
      this.mult.uniforms.tMask.value = this.rt.texture;
      this.quad.material = this.mult;
      renderer.setRenderTarget(readBuffer);
      this.quad.render(renderer);
    } finally {
      renderer.autoClear = ac;
    }
  }

  dispose() { this.rt?.dispose(); this.mat.dispose(); this.mult.dispose(); this.quad.dispose(); }
}

// ---- view distance copy ---------------------------------------------------------------------------------------

const LIN_FRAG = `
precision highp float;
${DEPTH_PARS}
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  gl_FragColor = vec4(d >= 0.999999 ? uFar : -hhViewZ(d), 0.0, 0.0, 1.0);
}`;

/** Distance along the view axis of every pixel (the far plane for the sky), in an R16F target: `chain.lin`. */
export class DepthCopyPass extends Pass {
  constructor(camera, chain) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.camera = camera;
    this.chain = chain;
    this.w = 2; this.h = 2;
    this.rt = null;
    this.mat = shader(LIN_FRAG, depthUniforms());
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(w, h) {
    this.w = Math.max(2, Math.round(w)); this.h = Math.max(2, Math.round(h));
    if (this.rt) this.rt.setSize(this.w, this.h);
  }

  /** Free the target while nothing uses it. */
  free() {
    if (this.rt) { this.rt.dispose(); this.rt = null; }
    this.chain.lin = null;
  }

  render(renderer) {
    const depth = this.chain.depth;
    if (!depth) return;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(this.w, this.h, {
        type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      });
      this.rt.texture.generateMipmaps = false;
    }
    setDepthUniforms(this.mat.uniforms, this.camera, depth);
    renderer.setRenderTarget(this.rt);
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    try { this.quad.render(renderer); } finally { renderer.autoClear = ac; }
    this.chain.lin = this.rt.texture;
  }

  dispose() { this.free(); this.mat.dispose(); this.quad.dispose(); }
}

// ---- motion blur ------------------------------------------------------------------------------------------

const MB_FRAG = `
precision highp float;
${DEPTH_PARS}
uniform sampler2D tDiffuse, tLin;
uniform mat4 uPrevVP, uVP, uCamWorld;
uniform vec3 uCamPos;
uniform float uScale, uMax;
varying vec2 vUv;
#define TAPS 12
void main() {
  float zv = texture2D(tLin, vUv).x;                        // view distance of the pixel (uFar for the sky)
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 ray = uProjInv * vec4(ndc, 1.0, 1.0);
  vec3 rv = ray.xyz / ray.w;                                // the far-plane point of this pixel, in view space
  vec3 wp = (uCamWorld * vec4(rv * (zv / -rv.z), 1.0)).xyz;
  vec2 cur = ndc, prev;
  if (zv >= uFar * 0.999) {
    // sky: a direction, only the rotation moves it (w = 0 drops the translation)
    vec3 dir = normalize(wp - uCamPos);
    vec4 c0 = uPrevVP * vec4(dir, 0.0);
    prev = c0.xy / c0.w;
  } else {
    vec4 c0 = uPrevVP * vec4(wp, 1.0);
    prev = c0.xy / c0.w;
  }
  vec2 vel = (cur - prev) * 0.5 * uScale;                    // uv units this frame, scaled to the shutter
  float l = length(vel);
  if (l > uMax) vel *= uMax / l;
  if (l < 0.0004) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
  float jit = hhIgn(gl_FragCoord.xy) - 0.5;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    float t = (float(i) + 0.5 + jit) / float(TAPS) - 0.5;   // -0.5 .. 0.5 around the pixel
    sum += texture2D(tDiffuse, vUv + vel * t).rgb;
  }
  gl_FragColor = vec4(sum / float(TAPS), 1.0);
}`;

/**
 * Camera motion blur (no per-object velocity): depth re-projected with last frame's view-projection.
 * `chain.depth` is the depth texture of the frame's world pass (a pass that swaps buffers leaves the
 * next read buffer without depth, so the chain remembers where it is).
 */
export class MotionBlurPass extends Pass {
  constructor(camera, chain) {
    super();
    this.needsSwap = true;
    this.enabled = false;
    this.camera = camera;
    this.chain = chain;
    this.mat = shader(MB_FRAG, {
      ...depthUniforms(), tDiffuse: { value: null }, tLin: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uScale: { value: 1 }, uMax: { value: 0.03 },
    });
    this.quad = new FullScreenQuad(this.mat);
    this.prevVP = new THREE.Matrix4();
    this.curVP = new THREE.Matrix4();
    this.havePrev = false;
    this._pos = new THREE.Vector3();
    this._prevPos = new THREE.Vector3();
    this.shutter = 0.5;         // shutter angle: 0.5 = 180 degrees
    this.dt = 1 / 60;
  }

  /** Call every frame (also while disabled) so the first enabled frame has a previous matrix. */
  track(dt) {
    const cam = this.camera;
    this.curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._pos.setFromMatrixPosition(cam.matrixWorld);
    // a teleport (respawn, spectator switch) must not smear the whole frame
    this.jump = this.havePrev && this._pos.distanceTo(this._prevPos) > 120;
    this.dt = dt > 0 ? dt : this.dt;
  }

  /** Call after the chain rendered: this frame's matrices become "previous". */
  commit() {
    this.prevVP.copy(this.curVP);
    this._prevPos.copy(this._pos);
    this.havePrev = true;
  }

  render(renderer, writeBuffer, readBuffer) {
    const lin = this.chain.lin;
    const u = this.mat.uniforms;
    if (!lin) return;
    if (!this.havePrev || this.jump) {
      // nothing to blur against: pass the frame through
      u.uScale.value = 0;
    } else {
      // blur length = the motion of one shutter interval (1/120 s at 180 degrees, 60 fps look) whatever the frame rate
      u.uScale.value = Math.min(4, (this.shutter / 60) / this.dt);
    }
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.tLin.value = lin;
    u.tDiffuse.value = readBuffer.texture;
    u.uPrevVP.value.copy(this.prevVP);
    u.uVP.value.copy(this.curVP);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uCamPos.value.copy(this._pos);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() { this.mat.dispose(); this.quad.dispose(); }
}

// ---- depth of field ---------------------------------------------------------------------------------------------

const FOCUS_FRAG = `
precision highp float;
${DEPTH_PARS}
uniform sampler2D tPrev, tLin;
uniform float uBlend, uDefault;
varying vec2 vUv;
void main() {
  // the depth under the crosshair (a small cross of taps, the nearest wins: a thin pole still focuses)
  const vec2 O[5] = vec2[5](vec2(0.0), vec2(0.01, 0.0), vec2(-0.01, 0.0), vec2(0.0, 0.012), vec2(0.0, -0.012));
  float z = 1e9;
  for (int i = 0; i < 5; i++) {
    float zz = texture2D(tLin, vec2(0.5) + O[i]).x;
    z = min(z, zz >= uFar * 0.999 ? 1e9 : zz);
  }
  if (z > 1e8) z = uDefault;
  float prev = texture2D(tPrev, vec2(0.5)).x;
  float f = prev < 1.0 ? z : mix(prev, z, uBlend);
  gl_FragColor = vec4(f, 0.0, 0.0, 1.0);
}`;

const DOF_FRAG = `
precision highp float;
${DEPTH_PARS}
uniform sampler2D tDiffuse, tFocus, tLin;
uniform vec2 uTexel;
uniform float uStrength, uAspect, uMaxPx;
varying vec2 vUv;
#define TAPS 20
float coc(float z, float zf, float edge) {
  // far: grows toward the horizon; near: half as strong; the edges of the view soften on top of it
  float f = z > zf ? (1.0 - zf / z) * 1.6 : (zf / max(z, 1.0) - 1.0) * 0.35;
  return clamp(f * uStrength + edge * uStrength * 0.6, 0.0, 1.0);
}
void main() {
  float z = texture2D(tLin, vUv).x;
  float zf = texture2D(tFocus, vec2(0.5)).x;
  vec2 dc = (vUv - 0.5) * vec2(uAspect, 1.0);
  float edge = smoothstep(0.32, 0.95, length(dc));
  float c0 = coc(z, zf, edge);
  vec4 base = texture2D(tDiffuse, vUv);
  if (c0 < 0.01) { gl_FragColor = base; return; }
  float phi = hhIgn(gl_FragCoord.xy) * 6.2831853;
  vec3 sum = base.rgb;
  float ws = 1.0;
  for (int i = 0; i < TAPS; i++) {
    float r = sqrt((float(i) + 0.5) / float(TAPS));
    float a = float(i) * 2.39996323 + phi;
    vec2 off = vec2(cos(a), sin(a)) * r * c0 * uMaxPx * uTexel;
    vec2 uv = vUv + off;
    float sz = texture2D(tLin, uv).x;
    float cs = coc(sz, zf, edge);
    // a tap counts as far as its own blur circle reaches this pixel: a sharp foreground pixel does
    // not bleed into the blurred background behind it
    float w = clamp(cs * uMaxPx / max(r * c0 * uMaxPx, 0.5), 0.0, 1.0);
    sum += texture2D(tDiffuse, uv).rgb * w;
    ws += w;
  }
  gl_FragColor = vec4(sum / ws, 1.0);
}`;

/** Depth of field for the hurt / downed state; focus is smoothed on the GPU in a 1x1 target. */
export class DofPass extends Pass {
  constructor(camera, chain) {
    super();
    this.needsSwap = true;
    this.enabled = false;
    this.camera = camera;
    this.chain = chain;
    this.strength = 0;
    this.focusMat = shader(FOCUS_FRAG, { ...depthUniforms(), tLin: { value: null }, tPrev: { value: null }, uBlend: { value: 0.1 }, uDefault: { value: 900 } });
    this.mat = shader(DOF_FRAG, {
      ...depthUniforms(), tDiffuse: { value: null }, tLin: { value: null }, tFocus: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) },
      uStrength: { value: 0 }, uAspect: { value: 16 / 9 }, uMaxPx: { value: 9 },
    });
    this.quad = new FullScreenQuad(this.focusMat);
    const mk = () => {
      const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      t.texture.generateMipmaps = false;
      return t;
    };
    this.focus = [mk(), mk()];
    this.cur = 0;
    this.dt = 1 / 60;
    this.reset = true;
    this.w = 1; this.h = 1;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.mat.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
    this.mat.uniforms.uAspect.value = w / Math.max(1, h);
    // blur radius in pixels follows the resolution (about 0.55 % of the height at full effect)
    this.mat.uniforms.uMaxPx.value = Math.max(4, h * 0.0085);
  }

  render(renderer, writeBuffer, readBuffer, deltaTime) {
    const lin = this.chain.lin;
    if (!lin) return;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    try {
      // 1) focus distance: last frame's value eased toward what is under the crosshair
      const prev = this.focus[this.cur], next = this.focus[1 - this.cur];
      const fu = this.focusMat.uniforms;
      fu.uFar.value = this.camera.far;
      fu.tLin.value = lin;
      fu.tPrev.value = this.reset ? null : prev.texture;
      fu.uBlend.value = 1 - Math.exp(-(deltaTime || this.dt) * 5);
      this.reset = false;
      this.quad.material = this.focusMat;
      renderer.setRenderTarget(next);
      this.quad.render(renderer);
      this.cur = 1 - this.cur;
      // 2) the blur
      const u = this.mat.uniforms;
      u.uFar.value = this.camera.far;
      u.tLin.value = lin;
      u.tDiffuse.value = readBuffer.texture;
      u.tFocus.value = next.texture;
      u.uStrength.value = this.strength;
      this.quad.material = this.mat;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
    } finally {
      renderer.autoClear = ac;
    }
  }

  dispose() {
    for (const t of this.focus) t.dispose();
    this.focusMat.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}
