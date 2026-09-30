// Blackwater Dam's moving water and weather: the reservoir's surface up at the crest, the spillway's
// water sheet racing down the chute, white water boiling in the basin and under the tailrace, spray and
// mist rising off the foot of the chute, the storm's rain by day (the world's own rain lights only lamp
// light, at night) and lightning. Each piece is one draw call animated on the GPU from a time uniform.

import * as THREE from 'three';
import { makeWaterNormal } from '../world-tex.js';
import { DAM, DAM_Z } from '../../shared/levels/dam.js';
import { chuteFloor } from './dam-set.js';

const NOISE = /* glsl */`
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;
const FOG = /* glsl */`
uniform float uFog;
uniform vec3 uFogColor;
float fogVis(float d) { return exp(-uFog * uFog * d * d); }
`;
const TONE = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

const WATER_Y = -16;

/** Roof rects [x, y, halfW, halfH, height] that keep the day rain out. */
function roofRects(map) {
  return (map.roofs || []).slice(0, 12).map((r) => [r.x, r.y, r.w / 2 + 10, r.h / 2 + 10, r.height || 150]);
}

/**
 * @param {object} ctx renderer ctx
 * @param {object} deps level art deps (root, fx, day, full)
 * @returns {{ update(view, frame), setQuality(q), dispose() }}
 */
export function createDamFx(ctx, deps) {
  const { root, fx, day } = deps;
  let full = deps.full;
  const own = [];
  const add = (m) => { root.add(m); own.push(m); return m; };
  const lit = day ? 1 : 0.22;

  // ---- the reservoir's surface: dark, wind-rippled, reflecting the storm sky
  const wn = makeWaterNormal();
  wn.wrapS = wn.wrapT = THREE.RepeatWrapping;
  const resMat = new THREE.MeshStandardMaterial({
    color: day ? '#243436' : '#05090b', roughness: 0.1, metalness: 0.2, normalMap: wn, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: day ? 0.9 : 0.45,
  });
  const x0 = -3000, x1 = 14500, y0 = -5200, y1 = DAM.crest.y0 - 22;
  const resGeo = new THREE.PlaneGeometry(x1 - x0, y1 - y0, 1, 1);
  resGeo.rotateX(-Math.PI / 2);
  const uv = resGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 300, uv.getY(i) * (y1 - y0) / 300);
  resGeo.translate((x0 + x1) / 2, DAM.reservoir, (y0 + y1) / 2);
  const res = add(new THREE.Mesh(resGeo, resMat));
  res.name = 'dam-reservoir';
  res.receiveShadow = true;

  // ---- the spillway's water sheet: a strip following the chute floor, streaks racing down it
  const uWater = { ...fx, uLit: { value: lit } };
  const sp = DAM.spill;
  const nY = 48, nX = 6;
  const yA = DAM.crest.y1 + 10, yB = DAM.toeY + 70;
  const pos = [], uvs = [];
  for (let j = 0; j <= nY; j++) {
    const y = yA + ((yB - yA) * j) / nY;
    const h = chuteFloor(y) + (y > DAM.toeY ? 8 : 5);
    for (let i = 0; i <= nX; i++) {
      const x = sp.x0 + 2 + ((sp.x1 - sp.x0 - 4) * i) / nX;
      pos.push(x, h, y);
      uvs.push(i / nX, j / nY);
    }
  }
  const idx = [];
  for (let j = 0; j < nY; j++) for (let i = 0; i < nX; i++) {
    const a = j * (nX + 1) + i, b = a + 1, c = a + nX + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const chGeo = new THREE.BufferGeometry();
  chGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  chGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  chGeo.setIndex(idx);
  const chMat = new THREE.ShaderMaterial({
    uniforms: uWater, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv; varying float vD;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: FOG + NOISE + `
      uniform float uTime; uniform float uLit;
      varying vec2 vUv; varying float vD;
      void main() {
        float flow = vUv.y * 14.0 - uTime * 3.4;
        float n = fbm(vec2(vUv.x * 16.0, flow));
        float streak = smoothstep(0.4, 0.8, fbm(vec2(vUv.x * 46.0, vUv.y * 5.0 - uTime * 5.5)));
        // glassy green water over the crest, tearing into white ropes as it accelerates down the chute
        float rope = smoothstep(0.45, 0.85, fbm(vec2(vUv.x * 60.0, vUv.y * 3.0 - uTime * 6.0)));
        float foam = smoothstep(0.3, 0.9, 0.1 + 0.55 * n + 0.35 * streak) * (0.25 + 0.75 * smoothstep(0.02, 0.35, vUv.y));
        foam = clamp(foam + rope * 0.35 * smoothstep(0.1, 0.5, vUv.y) + smoothstep(0.78, 1.0, vUv.y) * 0.55, 0.0, 1.0);
        float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        foam = mix(1.0, foam, edge * 0.8 + 0.2);
        vec3 water = mix(vec3(0.06, 0.13, 0.12), vec3(0.16, 0.26, 0.24), n);
        vec3 col = mix(water, vec3(0.82, 0.87, 0.88), foam) * uLit;
        float a = (0.72 + 0.28 * foam) * fogVis(vD);
        gl_FragColor = vec4(mix(uFogColor, col, fogVis(vD)), a);
      ` + TONE + '}',
  });
  const chute = add(new THREE.Mesh(chGeo, chMat));
  chute.name = 'dam-chute';
  chute.renderOrder = 4;

  // ---- white water in the river below: the basin under the chute, the tailrace outlets, streaks downstream
  const fGeo = new THREE.PlaneGeometry(1300, 1750, 1, 1);
  fGeo.rotateX(-Math.PI / 2);
  fGeo.translate(5300, WATER_Y + 1.2, 1250 + 875);
  const fMat = new THREE.ShaderMaterial({
    uniforms: uWater, transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 vW; varying float vD;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: FOG + NOISE + `
      uniform float uTime; uniform float uLit;
      varying vec3 vW; varying float vD;
      void main() {
        vec2 p = vW.xz;
        // the boil at the chute's foot, spreading south, and the outlets on the hall's west wall
        float fromChute = exp(-max(0.0, p.y - 1300.0) / 260.0) * smoothstep(4740.0, 4860.0, p.x) * (1.0 - smoothstep(5420.0, 5560.0, p.x));
        float fromOutlets = exp(-max(0.0, 5900.0 - p.x) / 170.0) * smoothstep(1420.0, 1520.0, p.y) * (1.0 - smoothstep(1880.0, 1980.0, p.y));
        float downstream = 0.22 * smoothstep(0.55, 0.85, fbm(vec2(p.x / 60.0, p.y / 260.0 - uTime * 0.35)));
        float boil = fbm(p / 40.0 + vec2(uTime * 0.4, -uTime * 1.1)) * 0.6 + fbm(p / 14.0 - vec2(0.0, uTime * 2.2)) * 0.5;
        float f = clamp((fromChute * 1.3 + fromOutlets) * (0.35 + boil) + downstream * boil, 0.0, 1.0);
        vec3 col = vec3(0.86, 0.9, 0.9) * uLit;
        float a = smoothstep(0.12, 0.7, f) * 0.92 * fogVis(vD);
        gl_FragColor = vec4(col, a);
      ` + TONE + '}',
  });
  const foam = add(new THREE.Mesh(fGeo, fMat));
  foam.name = 'dam-foam';
  foam.renderOrder = 3;

  // ---- spray and mist: soft sprites rising off the foot of the chute and the outlets, blown downstream
  let spray = null;
  const makeSpray = (n) => {
    const p = [], sd = [];
    for (let i = 0; i < n; i++) {
      const src = i % 5 === 4 ? 1 : 0;
      p.push(src ? 5880 : sp.x0 + Math.random() * (sp.x1 - sp.x0), 0, src ? 1440 + Math.random() * 460 : DAM.toeY + 30 + Math.random() * 80);
      sd.push(Math.random(), Math.random(), Math.random(), src);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 4));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...fx, uLit: { value: day ? 0.9 : 0.16 } }, transparent: true, depthWrite: false,
      vertexShader: FOG + `
        uniform float uTime; uniform float uPx;
        attribute vec4 aSeed;
        varying float vA;
        void main() {
          float life = 5.0 + aSeed.z * 4.0;
          float t = fract(uTime / life + aSeed.x);
          vec3 p = position;
          float big = aSeed.w > 0.5 ? 0.5 : 1.0;
          p.y = -8.0 + t * (70.0 + aSeed.y * 160.0) * big;
          p.z += t * (180.0 + aSeed.y * 200.0) * big;
          p.x += (t * 90.0 + sin(uTime * 0.7 + aSeed.x * 20.0) * 30.0) * (aSeed.w > 0.5 ? -1.0 : 1.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(uPx * (30.0 + t * 110.0) * big / -mv.z, 0.0, 900.0);
          vA = sin(t * 3.14159) * 0.16 * fogVis(-mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uLit;
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-r * r * 3.5) * vA;
          gl_FragColor = vec4(vec3(0.9, 0.93, 0.95) * uLit, a);
        ` + TONE + '}',
    });
    const pts = new THREE.Points(g, m);
    pts.name = 'dam-spray';
    pts.frustumCulled = false;
    pts.renderOrder = 12;
    return pts;
  };

  // ---- the storm's rain by day: grey streaks lit by the sky, slanting in the wind, kept out of the roofs
  let rain = null;
  const roofs = roofRects(ctx.map);
  const makeDayRain = (n) => {
    const p = [], sd = [], cn = [];
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (const [cx, cy] of [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]]) { p.push(0, 0, 0); sd.push(...s); cn.push(cx, cy); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 4));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(cn, 2));
    const R = new Array(12).fill(0).map((_, i) => roofs[i] ? new THREE.Vector4(roofs[i][0], roofs[i][1], roofs[i][2], roofs[i][3]) : new THREE.Vector4(0, 0, 0, 0));
    const RH = new Array(12).fill(0).map((_, i) => (roofs[i] ? roofs[i][4] : -1e5));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...fx, uRoof: { value: R }, uRoofH: { value: RH }, uBox: { value: new THREE.Vector3(620, 380, 620) } },
      transparent: true, depthWrite: false,
      vertexShader: FOG + `
        uniform float uTime; uniform vec3 uBox; uniform vec4 uRoof[12]; uniform float uRoofH[12];
        attribute vec4 aSeed; attribute vec2 aCorner;
        varying float vA; varying float vX;
        void main() {
          vec3 cam = cameraPosition;
          vec2 xz = cam.xz + (fract(aSeed.xz - cam.xz / uBox.xz) - 0.5) * uBox.xz;
          float speed = 900.0 + aSeed.w * 300.0;
          float y = cam.y + (fract(aSeed.y - uTime * speed / uBox.y) - 0.5) * uBox.y;
          vec3 base = vec3(xz.x, y, xz.y);
          vec3 fall = normalize(vec3(0.34, -1.0, 0.16));
          vec3 toCam = normalize(cam - base);
          vec3 right = normalize(cross(fall, toCam));
          float len = 22.0 + aSeed.w * 16.0;
          vec3 p = base + right * aCorner.x * 0.35 - fall * aCorner.y * len;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vA = smoothstep(8.0, 30.0, dist) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, dist)) * fogVis(dist);
          for (int i = 0; i < 12; i++) {
            vec2 d = abs(base.xz - uRoof[i].xy);
            if (d.x < uRoof[i].z && d.y < uRoof[i].w && base.y < uRoofH[i]) vA = 0.0;
          }
          vX = aCorner.x;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying float vX;
        void main() {
          float a = (1.0 - vX * vX) * vA * 0.32;
          gl_FragColor = vec4(vec3(0.78, 0.82, 0.86), a);
        ` + TONE + '}',
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'dam-rain';
    mesh.frustumCulled = false;
    mesh.renderOrder = 13;
    return mesh;
  };

  // ---- lightning: a jagged bolt in the sky and a flash of light over the canyon
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 4), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(40 * 18), 3));
  const bolt = add(new THREE.Mesh(boltGeo, boltMat));
  bolt.name = 'dam-bolt';
  bolt.frustumCulled = false;
  bolt.visible = false;
  let nextStrike = 6 + Math.random() * 8, strikeT = -1, strikeAt = null;

  function makeBolt(cx, cz) {
    const P = boltGeo.attributes.position.array;
    let x = cx, y = 2600, z = cz;
    let o = 0;
    for (let k = 0; k < 40 && o < P.length - 18; k++) {
      const nx = x + (Math.random() - 0.5) * 180, ny = y - 60 - Math.random() * 60, nz = z + (Math.random() - 0.5) * 180;
      const w = 9 - k * 0.15;
      const quad = [[x - w, y, z], [x + w, y, z], [nx + w, ny, nz], [x - w, y, z], [nx + w, ny, nz], [nx - w, ny, nz]];
      for (const q of quad) { P[o++] = q[0]; P[o++] = q[1]; P[o++] = q[2]; }
      x = nx; y = ny; z = nz;
      if (y < 900) break;
    }
    for (; o < P.length; o++) P[o] = 0;
    boltGeo.attributes.position.needsUpdate = true;
    boltGeo.computeBoundingSphere();
  }

  function setQuality(q) {
    full = q;
    const hi = q !== 'low';
    if (hi && !spray) spray = add(makeSpray(q === 'high' ? 360 : q === 'ultra' ? 800 : 1400));
    if (spray) spray.visible = hi;
    const wantRain = day && (q === 'ultra' || q === 'cinematic');
    if (wantRain && !rain) rain = add(makeDayRain(q === 'cinematic' ? 11000 : 7000));
    if (rain) rain.visible = wantRain;
  }
  setQuality(full);

  let time = 0;
  return {
    update(view, frame) {
      const dt = Math.min(0.1, frame.dt || 0.016);
      time += dt;
      wn.offset.set((time * 0.02) % 1, (time * 0.035) % 1);
      // lightning (a strike every 10-25 s somewhere around the camera)
      nextStrike -= dt;
      const cam = ctx.camera;
      if (nextStrike <= 0 && cam) {
        nextStrike = 10 + Math.random() * 15;
        const a = Math.random() * Math.PI * 2, d = 2500 + Math.random() * 3000;
        strikeAt = [cam.position.x + Math.cos(a) * d, cam.position.z + Math.sin(a) * d];
        makeBolt(strikeAt[0], strikeAt[1]);
        strikeT = 0;
      }
      if (strikeT >= 0) {
        strikeT += dt;
        const k = strikeT < 0.08 ? 1 : strikeT < 0.14 ? 0.2 : strikeT < 0.24 ? 0.85 : Math.max(0, 1 - (strikeT - 0.24) / 0.2);
        bolt.visible = k > 0.02;
        boltMat.opacity = k;
        if (ctx.lights && ctx.lights.steady && k > 0.05 && cam) {
          ctx.lights.steady('dam:lightning', cam.position.x + (strikeAt[0] - cam.position.x) * 0.3, cam.position.z + (strikeAt[1] - cam.position.z) * 0.3, cam.position.y + 900, '#dfe8ff', 14 * k * (day ? 0.7 : 1), 4200);
        }
        if (strikeT > 0.5) { strikeT = -1; bolt.visible = false; }
      }
    },
    setQuality,
    dispose() {
      for (const m of own) { root.remove(m); m.geometry.dispose(); m.material.dispose(); }
      wn.dispose();
    },
  };
}
