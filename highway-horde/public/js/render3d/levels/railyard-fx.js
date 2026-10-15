// The Rail Yard's light and air: by day, dusty sunbeams slanting through the engine shed's windows and roof
// glazing into its gloom; the live locomotive's idling exhaust; heat haze over the ballast is the day look's.
// One draw call each, animated from the shared time uniform.

import * as THREE from 'three';
import { YARD } from '../../shared/levels/railyard.js';

const FOG = /* glsl */`
uniform float uFog;
uniform vec3 uFogColor;
float fogVis(float d) { return exp(-uFog * uFog * d * d); }
`;
const TONE = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

/**
 * Soft additive light beams: each { p: [x, h, y] entry point, d: unit [dx, dh, dy] light direction, len, w }.
 * Two crossed quads per beam, fading across and along it, with drifting dust.
 */
export function makeBeams(list, fx, color = [1.0, 0.86, 0.62], k = 0.16) {
  const pos = [], uv = [];
  const up = new THREE.Vector3();
  for (const b of list) {
    const d = new THREE.Vector3(b.d[0], b.d[1], b.d[2]).normalize();
    const p0 = new THREE.Vector3(b.p[0], b.p[1], b.p[2]);
    const p1 = p0.clone().addScaledVector(d, b.len);
    for (const side of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)]) {
      up.crossVectors(d, side).normalize().multiplyScalar(b.w / 2);
      const a = p0.clone().sub(up), bb = p0.clone().add(up), c = p1.clone().add(up), e = p1.clone().sub(up);
      for (const [q, u, v] of [[a, 0, 0], [bb, 1, 0], [c, 1, 1], [a, 0, 0], [c, 1, 1], [e, 0, 1]]) { pos.push(q.x, q.y, q.z); uv.push(u, v); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...fx, uCol: { value: new THREE.Color(color[0] * k, color[1] * k, color[2] * k) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `
      varying vec2 vUv; varying vec3 vW; varying float vD;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: FOG + `
      uniform float uTime; uniform vec3 uCol;
      varying vec2 vUv; varying vec3 vW; varying float vD;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      void main() {
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float a = smoothstep(0.0, 0.6, across) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        // motes: sparse bright specks drifting through the beam
        vec2 c = floor(vW.xz / 3.0 + vec2(uTime * 0.4, vW.y / 3.0 - uTime * 0.2));
        float mote = step(0.985, h21(c)) * 1.6;
        float n = 0.8 + 0.2 * sin(vW.x * 0.02 + uTime * 0.6) * sin(vW.z * 0.03 - uTime * 0.4);
        gl_FragColor = vec4(uCol * a * (n + mote) * fogVis(vD), 1.0);
      ` + TONE + '}',
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'c3-beams';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}

/** A column of exhaust puffs from a stack at world (x, h, y). */
export function makeExhaust(sources, fx, n = 90) {
  const p = [], sd = [];
  for (const s of sources) for (let i = 0; i < n; i++) { p.push(s.x, s.h, s.y); sd.push(Math.random(), Math.random(), Math.random()); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...fx }, transparent: true, depthWrite: false,
    vertexShader: FOG + `
      uniform float uTime; uniform float uPx;
      attribute vec3 aSeed; varying float vA;
      void main() {
        float t = fract(uTime / 3.5 + aSeed.x);
        vec3 p = position + vec3(t * 60.0 + sin(aSeed.y * 20.0 + uTime) * 6.0, t * 150.0, (aSeed.z - 0.5) * 20.0 * t);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(uPx * (8.0 + t * 50.0) / -mv.z, 0.0, 400.0);
        vA = (1.0 - t) * smoothstep(0.0, 0.08, t) * 0.35 * fogVis(-mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.16, 0.15, 0.14), exp(-r * r * 3.0) * vA);` + TONE + '}',
  });
  const pts = new THREE.Points(g, m);
  pts.name = 'c3-exhaust';
  pts.frustumCulled = false;
  pts.renderOrder = 12;
  return pts;
}

/**
 * @param {object} ctx renderer ctx
 * @param {object} deps level art deps
 * @param {object[]} exhaust sources pushed by the models ({ x, y, h })
 */
export function createYardFx(ctx, deps, exhaust) {
  const { root, fx, day } = deps;
  const own = [];
  const add = (m) => { if (m) { root.add(m); own.push(m); } return m; };
  // sunbeams through the shed's south windows and the south pitch's glazing (by day only)
  const look = (ctx.map.look && ctx.map.look.day) || { az: 150, el: 44 };
  const az = (look.az * Math.PI) / 180, el = (look.el * Math.PI) / 180;
  const d = [-Math.cos(el) * Math.cos(az), -Math.sin(el), -Math.cos(el) * Math.sin(az)];
  const beams = [];
  const S = YARD.shed, f = S.floor;
  if (day && d[2] < 0) {
    const toFloor = (h) => (h - f) / -d[1];
    for (let x = S.x0 + 87; x < S.x1 - 40; x += 160) beams.push({ p: [x, f + 154, S.y1 - 12], d, len: toFloor(f + 154), w: 70 });
    for (let x = S.x0 + 120; x < S.x1 - 80; x += 240) beams.push({ p: [x, f + 330, S.y1 - 12 - (S.y1 - S.y0) * 0.27], d, len: toFloor(f + 330), w: 110 });
  }
  if (beams.length && deps.full !== 'low') add(makeBeams(beams, fx));
  if (exhaust.length && deps.full !== 'low') add(makeExhaust(exhaust, fx));
  return {
    update() {},
    setQuality(q) { for (const m of own) m.visible = q !== 'low'; },
    dispose() { for (const m of own) { root.remove(m); m.geometry.dispose(); m.material.dispose(); } },
  };
}
