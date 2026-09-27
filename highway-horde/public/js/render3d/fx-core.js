// Shared GPU-friendly effect primitives for the ACTORS sub-systems. One instance per
// renderer ctx (looked up with acquireFx(ctx) so zombies, items, players and effects all
// feed the same pools): simulated particles (billboards or ground-flat quads, additive
// or alpha-blended, optional ground bounce), streak particles and beams (camera-facing
// ribbons: tracers, sparks, tesla arcs, rail beams), and immediate-mode glows that a
// module re-submits every frame (pickup halos, status lights, rocket exhausts).
//
// Three draw calls in total. Buffers are written once per rendered frame from a
// THREE.LOD's update() hook, which three.js calls while projecting the scene — i.e.
// after every sub-system's update() and before the attribute upload — so the order in
// which renderer3d updates the sub-systems never matters.

import * as THREE from 'three';
import { makeCanvas } from './actor-kit.js';

// particle flags
export const F_ADD = 1, F_FLAT = 2, F_STREAK = 4, F_BOUNCE = 8, F_FIRE = 16, F_FLICKER = 32, F_SHRINK = 64, F_SPIN = 128;
// atlas frames (4 x 4)
export const FR = {
  GLOW: 0, DOT: 1, SMOKE: 2, SMOKE2: 3, FLAME: 4, STAR: 5, RING: 6, CHUNK: 7,
  FLASH: 8, MIST: 9, SQUARE: 10, SHARD: 11, SOFTRING: 12, BOLT: 13, CROSS: 14, BUBBLE: 15,
};

const QUALITY = {
  ultra: { particles: 4200, beams: 480 },
  high: { particles: 2600, beams: 320 },
  low: { particles: 1000, beams: 160 },
};

const registry = new WeakMap();

/**
 * Shared fx pools for this ctx (created on first use, reference counted).
 * @returns {ReturnType<typeof createFx>}
 */
export function acquireFx(ctx) {
  let fx = registry.get(ctx);
  if (!fx) {
    fx = createFx(ctx);
    registry.set(ctx, fx);
  }
  fx.refs++;
  return fx;
}

/** Drop one reference; the pools are disposed with the last one. */
export function releaseFx(ctx) {
  const fx = registry.get(ctx);
  if (!fx) return;
  if (--fx.refs <= 0) {
    fx.dispose();
    registry.delete(ctx);
  }
}

// ---------------------------------------------------------------------------------------
// procedural sprite atlas

let atlasTex = null;

/** Free the shared sprite atlas' GPU copies (renderer3d.destroy; it re-uploads on reuse). */
export function releaseFxAtlas() {
  if (atlasTex) atlasTex.dispose();
}

function atlas() {
  if (atlasTex) return atlasTex;
  const S = 64, c = makeCanvas(S * 4, S * 4), g = c.getContext('2d');
  const cell = (i, fn) => {
    g.save();
    g.translate((i % 4) * S + S / 2, Math.floor(i / 4) * S + S / 2);
    g.beginPath();
    g.rect(-S / 2, -S / 2, S, S);
    g.clip();
    fn(S / 2);
    g.restore();
  };
  const radial = (r, stops) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [t, a] of stops) gr.addColorStop(t, `rgba(255,255,255,${a})`);
    g.fillStyle = gr;
    g.fillRect(-r, -r, r * 2, r * 2);
  };
  // deterministic noise for smoke puffs
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  cell(FR.GLOW, (r) => radial(r, [[0, 1], [0.25, 0.55], [0.6, 0.12], [1, 0]]));
  cell(FR.DOT, (r) => radial(r, [[0, 1], [0.35, 0.9], [0.55, 0.2], [1, 0]]));
  for (const fr of [FR.SMOKE, FR.SMOKE2]) {
    cell(fr, (r) => {
      for (let k = 0; k < 14; k++) {
        const a = rnd() * Math.PI * 2, d = rnd() * r * 0.45, rr = r * (0.25 + rnd() * 0.3);
        const gr = g.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, rr);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(-r, -r, r * 2, r * 2);
      }
    });
  }
  cell(FR.FLAME, (r) => {
    // teardrop flame: bright core, tapering tip upward
    g.scale(1, 1);
    const gr = g.createRadialGradient(0, r * 0.3, 0, 0, r * 0.2, r * 0.8);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -r * 0.95);
    g.quadraticCurveTo(r * 0.75, r * 0.1, r * 0.5, r * 0.6);
    g.quadraticCurveTo(0, r * 1.05, -r * 0.5, r * 0.6);
    g.quadraticCurveTo(-r * 0.75, r * 0.1, 0, -r * 0.95);
    g.fill();
  });
  cell(FR.STAR, (r) => {
    radial(r * 0.55, [[0, 1], [0.5, 0.5], [1, 0]]);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 6; k++) {
      g.save();
      g.rotate((k / 6) * Math.PI * 2 + (k % 2) * 0.2);
      const L = r * (k % 2 ? 0.7 : 0.98);
      const gr = g.createLinearGradient(0, 0, L, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, -r * 0.09); g.lineTo(L, 0); g.lineTo(0, r * 0.09);
      g.fill();
      g.restore();
    }
  });
  cell(FR.RING, (r) => radial(r, [[0, 0], [0.72, 0], [0.84, 1], [0.92, 0.4], [1, 0]]));
  cell(FR.CHUNK, (r) => {
    g.fillStyle = '#fff';
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2, d = r * (0.55 + rnd() * 0.3);
      if (k === 0) g.moveTo(Math.cos(a) * d, Math.sin(a) * d); else g.lineTo(Math.cos(a) * d, Math.sin(a) * d);
    }
    g.fill();
  });
  cell(FR.FLASH, (r) => {
    // side-on muzzle flash: long bright cone with a hot base
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const gr = g.createLinearGradient(-r, 0, r, 0);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      const w = r * (0.35 - k * 0.1);
      g.beginPath();
      g.moveTo(-r, -w); g.quadraticCurveTo(r * 0.2, -w * 0.9, r, 0); g.quadraticCurveTo(r * 0.2, w * 0.9, -r, w);
      g.fill();
    }
  });
  cell(FR.MIST, (r) => {
    for (let k = 0; k < 18; k++) {
      const a = rnd() * Math.PI * 2, d = rnd() * r * 0.6, rr = r * (0.08 + rnd() * 0.18);
      g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`;
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, Math.PI * 2);
      g.fill();
    }
  });
  cell(FR.SQUARE, (r) => { g.fillStyle = '#fff'; g.fillRect(-r * 0.6, -r * 0.45, r * 1.2, r * 0.9); });
  cell(FR.SHARD, (r) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(-r * 0.2, -r * 0.8); g.lineTo(r * 0.5, r * 0.1); g.lineTo(-r * 0.1, r * 0.8); g.lineTo(-r * 0.45, 0);
    g.fill();
  });
  cell(FR.SOFTRING, (r) => radial(r, [[0, 0], [0.45, 0.05], [0.75, 0.6], [0.9, 0.25], [1, 0]]));
  cell(FR.BOLT, (r) => {
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-r, 0);
    for (let k = 1; k <= 8; k++) g.lineTo(-r + (k / 8) * r * 2, (rnd() - 0.5) * r * 0.7);
    g.stroke();
  });
  cell(FR.CROSS, (r) => {
    radial(r, [[0, 0.8], [0.4, 0.3], [1, 0]]);
    g.fillStyle = '#fff';
    g.fillRect(-r * 0.12, -r * 0.7, r * 0.24, r * 1.4);
    g.fillRect(-r * 0.7, -r * 0.12, r * 1.4, r * 0.24);
  });
  cell(FR.BUBBLE, (r) => {
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = r * 0.14;
    g.beginPath();
    g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fill();
  });
  atlasTex = new THREE.CanvasTexture(c);
  atlasTex.generateMipmaps = true;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  return atlasTex;
}

// ---------------------------------------------------------------------------------------
// shaders

const FOG_FACTOR = /* glsl */`
float hhFog() {
  float f = 0.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      f = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
  return f;
}
`;

const PART_VERT = /* glsl */`
attribute vec4 iPos;    // xyz, rotation
attribute vec4 iCol;    // rgb, alpha
attribute vec4 iSize;   // width, height, frame, flat
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_vertex>
void main() {
  vec2 c = position.xy;          // -0.5..0.5 quad corner
  float cr = cos(iPos.w), sr = sin(iPos.w);
  vec2 q = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * iSize.xy;
  vec4 mvPosition;
  if (iSize.w > 0.5) {
    // lying flat on the ground (rings, glows, puddles)
    mvPosition = modelViewMatrix * vec4(iPos.x + q.x, iPos.y, iPos.z + q.y, 1.0);
  } else {
    mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);
    mvPosition.xy += q;
  }
  gl_Position = projectionMatrix * mvPosition;
  float fr = iSize.z;
  vUv = (vec2(mod(fr, 4.0), 3.0 - floor(fr / 4.0)) + (c + 0.5)) * 0.25;
  vCol = iCol;
  #include <fog_vertex>
}
`;

const PART_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_fragment>
${FOG_FACTOR}
void main() {
  float a = texture2D(uMap, vUv).a * vCol.a;
  if (a < 0.003) discard;
  float f = hhFog();
  vec3 rgb = vCol.rgb;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(rgb * a * (1.0 - f * 0.8), 1.0);
  } else {
    #ifdef USE_FOG
      rgb = mix(rgb, fogColor, f);
    #endif
    gl_FragColor = vec4(rgb, a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BEAM_VERT = /* glsl */`
attribute vec4 iA;      // start xyz, width at start
attribute vec4 iB;      // end xyz, width at end
attribute vec4 iCol;    // rgb, alpha
attribute vec4 iParam;  // core (0..1), fade-in length (u), fade-out length (u), unused
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
#include <fog_pars_vertex>
void main() {
  float u = position.x + 0.5;    // along
  float v = position.y * 2.0;    // across -1..1
  vec4 a = modelViewMatrix * vec4(iA.xyz, 1.0);
  vec4 b = modelViewMatrix * vec4(iB.xyz, 1.0);
  vec3 p = mix(a.xyz, b.xyz, u);
  vec3 axis = b.xyz - a.xyz;
  vec3 side = cross(axis, p);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = mix(iA.w, iB.w, u);
  // keep beams at least ~1.2 px wide so far tracers never shimmer away
  float minW = -p.z * 0.0022;
  p += side * v * 0.5 * max(w, minW);
  vec4 mvPosition = vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = vec2(u, v);
  vCol = iCol;
  vParam = iParam;
  #include <fog_vertex>
}
`;

const BEAM_FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vParam;
#include <fog_pars_fragment>
${FOG_FACTOR}
void main() {
  float v = abs(vUv.y);
  float glow = exp(-v * v * 5.0) * (1.0 - v);
  float core = smoothstep(0.35, 0.0, v) * vParam.x;
  float along = 1.0;
  if (vParam.y > 0.0) along *= smoothstep(0.0, vParam.y, vUv.x);
  if (vParam.z > 0.0) along *= smoothstep(1.0, 1.0 - vParam.z, vUv.x);
  float a = (glow + core) * along * vCol.a;
  vec3 rgb = mix(vCol.rgb, vec3(1.0), core * 0.6) * a;
  gl_FragColor = vec4(rgb * (1.0 - hhFog() * 0.8), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function quadGeometry(count, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const out = {};
  for (const name of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out[name] = a;
  }
  g.instanceCount = 0;
  return { geometry: g, attrs: out };
}

function fxMaterial(vert, frag, additive, extra = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, extra]);
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ---------------------------------------------------------------------------------------

function createFx(ctx) {
  const q = QUALITY[ctx.quality] || QUALITY.high;
  // Buffers sized for the biggest tier so setQuality can switch without reallocating.
  const CAP = QUALITY.ultra.particles, BCAP = QUALITY.ultra.beams;
  let cap = q.particles, bcap = q.beams;
  const R = ctx.rng || Math.random;

  // ---- particle state (structure of arrays, swap-remove compaction) ----
  const px = new Float32Array(CAP), py = new Float32Array(CAP), pz = new Float32Array(CAP);
  const vx = new Float32Array(CAP), vy = new Float32Array(CAP), vz = new Float32Array(CAP);
  const age = new Float32Array(CAP), life = new Float32Array(CAP);
  const s0 = new Float32Array(CAP), s1 = new Float32Array(CAP), stretch = new Float32Array(CAP);
  const cr = new Float32Array(CAP), cg = new Float32Array(CAP), cb = new Float32Array(CAP), ca = new Float32Array(CAP);
  const rot = new Float32Array(CAP), vrot = new Float32Array(CAP), grav = new Float32Array(CAP), drag = new Float32Array(CAP);
  const frame = new Uint8Array(CAP), flags = new Uint16Array(CAP);
  let n = 0;

  // immediate-mode (per frame) glows and beams
  const G_CAP = 400;
  const gl = new Float32Array(G_CAP * 12);
  let gn = 0;
  const bm = new Float32Array(BCAP * 16);
  let bn = 0;

  // ---- GPU side ----
  const map = atlas();
  const addQ = quadGeometry(CAP + G_CAP, ['iPos', 'iCol', 'iSize']);
  const nrmQ = quadGeometry(CAP, ['iPos', 'iCol', 'iSize']);
  const beamQ = quadGeometry(BCAP, ['iA', 'iB', 'iCol', 'iParam']);
  const addMat = fxMaterial(PART_VERT, PART_FRAG, true, { uMap: { value: map }, uAdditive: { value: 1 } });
  const nrmMat = fxMaterial(PART_VERT, PART_FRAG, false, { uMap: { value: map }, uAdditive: { value: 0 } });
  const beamMat = fxMaterial(BEAM_VERT, BEAM_FRAG, true);
  addMat.uniforms.uMap.value = map;
  nrmMat.uniforms.uMap.value = map;
  const addMesh = new THREE.Mesh(addQ.geometry, addMat);
  const nrmMesh = new THREE.Mesh(nrmQ.geometry, nrmMat);
  const beamMesh = new THREE.Mesh(beamQ.geometry, beamMat);
  for (const m of [addMesh, nrmMesh, beamMesh]) {
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
  }
  // draw smoke first, then additive light on top of it
  nrmMesh.renderOrder = 10;
  addMesh.renderOrder = 11;
  beamMesh.renderOrder = 12;
  const root = new THREE.LOD();
  root.name = 'fx-core';
  root.add(nrmMesh, addMesh, beamMesh);
  root.update = () => flush();     // called by three.js while projecting the scene
  ctx.scene.add(root);

  let pendingDt = 0, lastNow = -1, flushedNow = -2;
  let camX = 0, camH = 52, camZ = 0;

  /** Register the frame (idempotent per frame.now); every user calls it first. */
  function begin(frame) {
    if (frame.now === lastNow) return;
    lastNow = frame.now;
    pendingDt = Math.min(0.1, Math.max(0, frame.dt || 0));
    const c = ctx.camera.position;
    camX = c.x; camH = c.y; camZ = c.z;
  }

  /**
   * Spawn one particle. Position in three.js space: (x, h, y) = sim (x, y) at height h.
   * @returns {number} index or -1 when the pool is full
   */
  function spawn(x, h, y, vxs, vhs, vys, lifeS, size0, size1, color, alpha, fr, fl, g = 0, dr = 0) {
    if (n >= cap) return -1;
    const i = n++;
    px[i] = x; py[i] = h; pz[i] = y;
    vx[i] = vxs; vy[i] = vhs; vz[i] = vys;
    age[i] = 0; life[i] = Math.max(0.01, lifeS);
    s0[i] = size0; s1[i] = size1; stretch[i] = 1;
    cr[i] = color.r; cg[i] = color.g; cb[i] = color.b; ca[i] = alpha;
    rot[i] = R() * Math.PI * 2; vrot[i] = (fl & F_SPIN) ? (R() - 0.5) * 6 : (R() - 0.5) * 0.8;
    grav[i] = g; drag[i] = dr;
    frame[i] = fr; flags[i] = fl;
    return i;
  }

  function step(dt) {
    let i = 0;
    while (i < n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        const j = --n;
        if (i !== j) {
          px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
          age[i] = age[j]; life[i] = life[j]; s0[i] = s0[j]; s1[i] = s1[j]; stretch[i] = stretch[j];
          cr[i] = cr[j]; cg[i] = cg[j]; cb[i] = cb[j]; ca[i] = ca[j]; rot[i] = rot[j]; vrot[i] = vrot[j];
          grav[i] = grav[j]; drag[i] = drag[j]; frame[i] = frame[j]; flags[i] = flags[j];
        }
        continue;
      }
      const k = drag[i] > 0 ? Math.exp(-drag[i] * dt) : 1;
      vx[i] *= k; vz[i] *= k; vy[i] = vy[i] * k - grav[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      rot[i] += vrot[i] * dt;
      if (py[i] < 0.6 && (flags[i] & F_BOUNCE)) {
        py[i] = 0.6;
        if (vy[i] < 0) vy[i] *= -0.35;
        vx[i] *= 0.55; vz[i] *= 0.55; vrot[i] *= 0.5;
        if (Math.abs(vy[i]) < 20) { vy[i] = 0; grav[i] = 0; drag[i] = Math.max(drag[i], 6); }
      }
      i++;
    }
  }

  function flush() {
    if (flushedNow === lastNow) return;
    flushedNow = lastNow;
    if (pendingDt > 0) step(pendingDt);
    pendingDt = 0;
    const aP = addQ.attrs.iPos.array, aC = addQ.attrs.iCol.array, aS = addQ.attrs.iSize.array;
    const nP = nrmQ.attrs.iPos.array, nC = nrmQ.attrs.iCol.array, nS = nrmQ.attrs.iSize.array;
    let na = 0, nn = 0;
    bn = Math.min(bn, bcap);
    for (let i = 0; i < n; i++) {
      const t = age[i] / life[i];
      const f = flags[i];
      // quick fade-in, then fade out over the life
      let a = ca[i] * Math.min(1, age[i] * 30) * (1 - t);
      if (f & F_FLICKER) a *= 0.7 + R() * 0.3;
      let r = cr[i], g = cg[i], b = cb[i];
      if (f & F_FIRE) {
        // white-yellow core → orange → deep red as the tongue rises and cools
        const u = Math.min(1, t * 1.6);
        r = 1.6 - u * 0.4; g = 1.1 - u * 0.85; b = 0.45 - u * 0.44;
        r *= cr[i]; g *= cg[i]; b *= cb[i];
        a *= 1 - t * 0.4;
      }
      const size = s0[i] + (s1[i] - s0[i]) * t;
      if (f & F_STREAK) {
        if (bn >= bcap) continue;
        // sparks: a short ribbon along the velocity
        const L = stretch[i] * 0.028;
        const o = bn++ * 16;
        bm[o] = px[i]; bm[o + 1] = py[i]; bm[o + 2] = pz[i]; bm[o + 3] = size;
        bm[o + 4] = px[i] - vx[i] * L; bm[o + 5] = py[i] - vy[i] * L; bm[o + 6] = pz[i] - vz[i] * L; bm[o + 7] = size * 0.3;
        bm[o + 8] = r; bm[o + 9] = g; bm[o + 10] = b; bm[o + 11] = a;
        bm[o + 12] = 0.8; bm[o + 13] = 0; bm[o + 14] = 0.5; bm[o + 15] = 0;
        continue;
      }
      let P, C, S, o;
      if (f & F_ADD) { P = aP; C = aC; S = aS; o = na++ * 4; } else { P = nP; C = nC; S = nS; o = nn++ * 4; }
      P[o] = px[i]; P[o + 1] = py[i]; P[o + 2] = pz[i]; P[o + 3] = rot[i];
      C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = a;
      S[o] = size; S[o + 1] = size * stretch[i]; S[o + 2] = frame[i]; S[o + 3] = (f & F_FLAT) ? 1 : 0;
    }
    for (let k = 0; k < gn; k++) {
      const s = k * 12, o = na++ * 4;
      aP[o] = gl[s]; aP[o + 1] = gl[s + 1]; aP[o + 2] = gl[s + 2]; aP[o + 3] = gl[s + 3];
      aC[o] = gl[s + 4]; aC[o + 1] = gl[s + 5]; aC[o + 2] = gl[s + 6]; aC[o + 3] = gl[s + 7];
      aS[o] = gl[s + 8]; aS[o + 1] = gl[s + 9]; aS[o + 2] = gl[s + 10]; aS[o + 3] = gl[s + 11];
    }
    gn = 0;
    const bA = beamQ.attrs.iA.array, bB = beamQ.attrs.iB.array, bC = beamQ.attrs.iCol.array, bPa = beamQ.attrs.iParam.array;
    for (let k = 0; k < bn; k++) {
      const s = k * 16, o = k * 4;
      bA[o] = bm[s]; bA[o + 1] = bm[s + 1]; bA[o + 2] = bm[s + 2]; bA[o + 3] = bm[s + 3];
      bB[o] = bm[s + 4]; bB[o + 1] = bm[s + 5]; bB[o + 2] = bm[s + 6]; bB[o + 3] = bm[s + 7];
      bC[o] = bm[s + 8]; bC[o + 1] = bm[s + 9]; bC[o + 2] = bm[s + 10]; bC[o + 3] = bm[s + 11];
      bPa[o] = bm[s + 12]; bPa[o + 1] = bm[s + 13]; bPa[o + 2] = bm[s + 14]; bPa[o + 3] = bm[s + 15];
    }
    upload(addQ, na);
    upload(nrmQ, nn);
    upload(beamQ, bn);
    // children are projected after this hook, so hiding empty pools saves their draw
    addMesh.visible = na > 0;
    nrmMesh.visible = nn > 0;
    beamMesh.visible = bn > 0;
    stats.particles = n;
    stats.beams = bn;
    bn = 0;
  }

  function upload(qd, count) {
    qd.geometry.instanceCount = count;
    for (const k in qd.attrs) {
      const a = qd.attrs[k];
      a.clearUpdateRanges();
      if (count > 0) {
        a.addUpdateRange(0, count * 4);
        a.needsUpdate = true;
      }
    }
  }

  /** Immediate additive sprite for this frame only (re-submit every frame). */
  function glow(x, h, y, size, color, alpha, fr = FR.GLOW, flat = false, rotation = 0, stretchY = 1) {
    if (gn >= G_CAP) return;
    const o = gn++ * 12;
    gl[o] = x; gl[o + 1] = h; gl[o + 2] = y; gl[o + 3] = rotation;
    gl[o + 4] = color.r; gl[o + 5] = color.g; gl[o + 6] = color.b; gl[o + 7] = alpha;
    gl[o + 8] = size; gl[o + 9] = size * stretchY; gl[o + 10] = fr; gl[o + 11] = flat ? 1 : 0;
  }

  /**
   * Immediate additive ribbon from (ax, ah, ay) to (bx, bh, by) for this frame only.
   * @param {number} core 0..1 white-hot core strength
   */
  function beam(ax, ah, ay, bx, bh, by, w0, w1, color, alpha, core = 0.6, fadeIn = 0, fadeOut = 0) {
    if (bn >= bcap) return;
    const o = bn++ * 16;
    bm[o] = ax; bm[o + 1] = ah; bm[o + 2] = ay; bm[o + 3] = w0;
    bm[o + 4] = bx; bm[o + 5] = bh; bm[o + 6] = by; bm[o + 7] = w1;
    bm[o + 8] = color.r; bm[o + 9] = color.g; bm[o + 10] = color.b; bm[o + 11] = alpha;
    bm[o + 12] = core; bm[o + 13] = fadeIn; bm[o + 14] = fadeOut; bm[o + 15] = 0;
  }

  const stats = { particles: 0, beams: 0 };

  return {
    refs: 0,
    stats,
    begin,
    spawn,
    glow,
    beam,
    rng: R,
    /** Fraction of the particle pool in use (ambient emitters back off when high). */
    load: () => n / cap,
    /** Distance² from the camera in the ground plane. */
    camDist2: (x, y) => (x - camX) * (x - camX) + (y - camZ) * (y - camZ),
    get camHeight() { return camH; },
    /** Multiply the last spawned particle's height by `k` (stretched sprites: flames). */
    stretchLast: (i, k) => { if (i >= 0) stretch[i] = k; },
    setQuality(qn) {
      const qq = QUALITY[qn] || QUALITY.high;
      cap = qq.particles;
      bcap = qq.beams;
      if (n > cap) n = cap;
    },
    dispose() {
      root.removeFromParent();
      addQ.geometry.dispose(); nrmQ.geometry.dispose(); beamQ.geometry.dispose();
      addMat.dispose(); nrmMat.dispose(); beamMat.dispose();
    },
  };
}
