// The small animated life of the set dressing (WORLD): crows perched on lamp posts, wrecks
// and trees that take off when you come close (and a few circling over the action),
// fireflies over the grass and water at night, butterflies over the flowers by day, and
// leaves, newspapers and plastic bags tumbling along the ground in the wind. Each system is
// one draw call; the swarms animate on the GPU from the shared world time, the birds are one
// InstancedMesh whose matrices are updated on the CPU (a few dozen of them, and only the
// ones that moved).

import * as THREE from 'three';
import { hash01 } from './world-geo.js';
import { normTier, tierAtLeast } from './tier.js';

const TONE = `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

const COMMON = /* glsl */`
uniform float uTime;
uniform float uFog;
uniform vec3 uFogColor;
uniform float uPx;
float fogVis(float d) { return exp(-uFog * uFog * d * d); }
float h11(float n) { return fract(sin(n) * 43758.5453123); }
`;

function shader(uniforms, vertexShader, fragmentShader, extra = {}) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, fog: false, ...extra });
}

// (cinematic reads as ultra, with 1.6x the small life: fireflies / butterflies, litter)
const perTier = (t, ultra, high, low) => (tierAtLeast(t, 'ultra') ? ultra : t === 'low' ? low : high);
const cineK = (t) => (t === 'cinematic' ? 1.6 : 1);

export function createLife(ctx, deps, items, getTier) {
  const { map } = ctx;
  const { root, fx, gy } = deps;
  const day = !!deps.day;
  const own = [];        // meshes to remove on dispose
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  let tier = getTier();
  const uni = { uTime: fx.uTime, uFog: fx.uFog, uFogColor: fx.uFogColor, uPx: fx.uPx };

  // ---- fireflies (night) and butterflies (day): swarms anchored to the vegetation ---------------
  const swarmKinds = new Set(['reeds', 'tallgrass', 'flowers', 'shrub', 'fern', 'lily', 'mushrooms', 'log']);
  const anchors = items.filter((it) => swarmKinds.has(it.k)).sort((a, b) => a.q - b.q);
  let swarm = null;
  function buildSwarm() {
    if (swarm) { root.remove(swarm); swarm.geometry.dispose(); swarm = null; }
    const n = Math.round(perTier(tier, day ? 110 : 150, day ? 60 : 80, 0) * cineK(tier));
    if (!n || !anchors.length) return;
    const per = day ? 2 : 3;
    const pos = [], seed = [];
    for (let a = 0; a < Math.min(anchors.length, Math.ceil(n / per)); a++) {
      const it = anchors[a];
      for (let k = 0; k < per; k++) {
        pos.push(it.x, gy(it.x, it.y) + (it.k === 'reeds' ? 20 : 10), it.y);
        seed.push(hash01(a * 7 + k * 131 + 5));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    let mat;
    if (!day) {
      // fireflies: a soft green-yellow dot that wanders in a few-unit loop and pulses on and off
      mat = shader(uni, COMMON + `
        attribute float aSeed;
        varying float vA;
        void main() {
          float t = uTime;
          vec3 p = position;
          float r = 16.0 + 26.0 * aSeed;
          p.x += sin(t * (0.35 + aSeed * 0.4) + aSeed * 40.0) * r + sin(t * 0.9 + aSeed * 7.0) * 5.0;
          p.z += cos(t * (0.3 + aSeed * 0.35) + aSeed * 33.0) * r;
          p.y += sin(t * 0.6 + aSeed * 19.0) * 8.0 + 6.0 * aSeed;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float blink = pow(0.5 + 0.5 * sin(t * (1.1 + aSeed * 1.4) + aSeed * 60.0), 5.0);
          vA = blink * fogVis(-mv.z) * smoothstep(3.0, 30.0, -mv.z);
          gl_PointSize = clamp(uPx * 3.2 / -mv.z, 2.0, 9.0);
          gl_Position = projectionMatrix * mv;
        }`, `
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, r) * vA;
          gl_FragColor = vec4(vec3(0.75, 1.0, 0.25) * 3.0, a);
        ` + TONE + '}', { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    } else {
      // butterflies: a pair of wings flapping about a wandering centre, tinted per insect
      mat = shader(uni, COMMON + `
        attribute float aSeed;
        varying float vC;
        varying float vF;
        void main() {
          float t = uTime;
          vec3 p = position;
          float ph = t * (0.25 + aSeed * 0.3) + aSeed * 50.0;
          float r = 30.0 + 40.0 * aSeed;
          p.x += cos(ph) * r; p.z += sin(ph * 1.3) * r;
          p.y += sin(t * 0.8 + aSeed * 9.0) * 6.0 + 4.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float flap = abs(sin(t * (14.0 + aSeed * 6.0) + aSeed * 30.0));
          vC = aSeed;
          vF = fogVis(-mv.z) * smoothstep(3.0, 20.0, -mv.z);
          gl_PointSize = clamp(uPx * (5.0 + 4.0 * flap) / -mv.z, 2.0, 14.0);
          gl_Position = projectionMatrix * mv;
        }`, `
        varying float vC;
        varying float vF;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float wing = smoothstep(0.5, 0.2, abs(q.x) * 1.5 + abs(q.y) * 1.0) * step(0.06, abs(q.x));
          vec3 col = mix(vec3(0.95, 0.55, 0.1), vec3(0.95, 0.9, 0.95), step(0.5, fract(vC * 7.0)));
          col = mix(col, vec3(0.3, 0.5, 0.95), step(0.85, fract(vC * 13.0)));
          gl_FragColor = vec4(col * 0.9, wing * vF);
        ` + TONE + '}', { transparent: true, depthWrite: false });
    }
    swarm = new THREE.Points(g, mat);
    swarm.name = day ? 'butterflies' : 'fireflies';
    swarm.frustumCulled = false;
    root.add(swarm);
  }

  // ---- leaves, newspapers and bags in the wind ---------------------------------------------------
  let litter = null;
  const litterU = { ...uni, uCam: { value: new THREE.Vector2() }, uLight: { value: day ? 1 : 0.32 }, uWind: { value: new THREE.Vector2(0.92, 0.39) }, uGround: { value: 0 } };
  function buildLitter() {
    if (litter) { root.remove(litter); litter.geometry.dispose(); litter = null; }
    const n = Math.round(perTier(tier, 110, 60, 24) * cineK(tier));
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const seed = new Float32Array(n), kind = new Float32Array(n);
    for (let i = 0; i < n; i++) { seed[i] = hash01(i * 17 + 3); kind[i] = hash01(i * 31 + 9); }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
    g.instanceCount = n;
    const mat = shader(litterU, COMMON + `
      uniform vec2 uCam; uniform vec2 uWind; uniform float uGround;
      attribute float aSeed; attribute float aKind;
      varying vec3 vCol; varying float vF; varying vec2 vUv;
      void main() {
        const float S = 900.0;
        float sp = 18.0 + 40.0 * aSeed;
        vec2 home = vec2(h11(aSeed * 91.0), h11(aSeed * 37.0 + 5.0)) * S;
        vec2 p = home + uWind * sp * uTime + vec2(sin(uTime * 0.7 + aSeed * 30.0), cos(uTime * 0.6 + aSeed * 20.0)) * 14.0;
        // wrap around the camera: every piece lives in a S-wide box that follows it
        vec2 w = uCam - vec2(S * 0.5);
        p = w + mod(p - w, S);
        float hop = abs(sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 40.0));
        float y = uGround + 0.8 + hop * (2.0 + 9.0 * aSeed);
        float ang = uTime * (3.0 + aSeed * 6.0) + aSeed * 50.0;
        float sz = aKind < 0.62 ? 5.0 : aKind < 0.82 ? 8.0 : 6.5;
        vec3 loc = vec3(position.x * sz, 0.0, position.y * sz);
        float c = cos(ang), s = sin(ang);
        loc = vec3(loc.x * c - loc.z * s, loc.y, loc.x * s + loc.z * c);
        // tumble: tilt the sheet about the wind axis
        float tilt = sin(uTime * (2.0 + aSeed * 2.0) + aSeed * 11.0) * 0.9 + 0.4;
        loc = vec3(loc.x, loc.z * sin(tilt), loc.z * cos(tilt));
        vec3 wp = vec3(p.x, y, p.y) + loc;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vec3 leaf = mix(vec3(0.42, 0.2, 0.06), vec3(0.55, 0.42, 0.1), h11(aSeed * 5.0));
        vCol = aKind < 0.62 ? leaf : aKind < 0.82 ? vec3(0.72, 0.7, 0.62) : vec3(0.85, 0.85, 0.82);
        float edge = length(p - uCam) / (S * 0.5);
        vF = fogVis(-mv.z) * (1.0 - smoothstep(0.75, 1.0, edge)) * smoothstep(4.0, 24.0, -mv.z);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`, `
      uniform float uLight;
      varying vec3 vCol; varying float vF; varying vec2 vUv;
      void main() {
        vec2 q = vUv - 0.5;
        float a = smoothstep(0.5, 0.36, length(q * vec2(1.0, 1.5))) * vF;
        gl_FragColor = vec4(vCol * uLight, a);
      ` + TONE + '}', { transparent: true, depthWrite: false, side: THREE.DoubleSide });
    litter = new THREE.Mesh(g, mat);
    litter.name = 'wind-litter';
    litter.frustumCulled = false;
    root.add(litter);
  }

  // ---- crows -----------------------------------------------------------------------------------------
  let birds = null;
  const birdList = [];
  const dummy = new THREE.Object3D();
  const perches = items.filter((it) => it.k === 'perch').sort((a, b) => a.q - b.q);
  const hub = map.objective || map.supply || { x: map.width / 2, y: map.height / 2 };
  function crowGeometry() {
    // a small crow: body, head, beak, tail and two wings (aWing = 1 on the wing vertices, folded when perched)
    const parts = [];
    const add = (g, x, y, z, sx, sy, sz, wing) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
      g = g.index ? g.toNonIndexed() : g;
      g.applyMatrix4(m);
      g.setAttribute('aWing', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(wing), 1));
      parts.push(g);
    };
    add(new THREE.SphereGeometry(1, 8, 6), 0, 0, 0, 6.2, 2.8, 2.6, 0);            // body
    add(new THREE.SphereGeometry(1, 7, 5), 5.6, 1.6, 0, 2.1, 1.9, 1.7, 0);         // head
    add(new THREE.ConeGeometry(0.7, 3.4, 5).rotateZ(-Math.PI / 2), 8.4, 1.4, 0, 1, 1, 1, 0);   // beak
    add(new THREE.BoxGeometry(6, 0.35, 3), -8, 0.3, 0, 1, 1, 1, 0);                // tail
    for (const s of [-1, 1]) {
      const w = new THREE.BoxGeometry(5.2, 0.3, 8);
      w.translate(0, 0, s * 4.2);
      add(w, -0.4, 1.0, 0, 1, 1, 1, 1);
    }
    let n = 0;
    for (const p of parts) n += p.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), wg = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array, o * 3);
      nor.set(p.attributes.normal.array, o * 3);
      wg.set(p.attributes.aWing.array, o);
      o += p.attributes.position.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aWing', new THREE.BufferAttribute(wg, 1));
    return g;
  }
  let birdMat = null;
  function buildBirds() {
    if (birds) { root.remove(birds); birds.dispose(); birds = null; }
    birdList.length = 0;
    const nPerch = perTier(tier, 22, 14, 8), nCircle = perTier(tier, 6, 4, 2);
    const geo = crowGeometry();
    const phase = new Float32Array(nPerch + nCircle), fly = new Float32Array(nPerch + nCircle);
    for (let i = 0; i < nPerch && i < perches.length; i++) {
      const p = perches[i];
      birdList.push({ mode: 'perch', x: p.x, y: p.y, h: gy(p.x, p.y) + p.v + 3, yaw: hash01(i * 13 + 1) * 6.28, t: 0, wait: 0, vx: 0, vy: 0, vh: 0, i });
    }
    for (let i = 0; i < nCircle; i++) {
      birdList.push({ mode: 'circle', cx: hub.x + (hash01(i * 5 + 2) - 0.5) * 500, cy: hub.y + (hash01(i * 7 + 4) - 0.5) * 500, r: 260 + hash01(i * 3) * 260, alt: 230 + hash01(i * 11) * 90, ph: hash01(i * 19) * 6.28, dir: i % 2 ? 1 : -1, x: 0, y: 0, h: 0, yaw: 0, i: birdList.length });
    }
    for (let i = 0; i < birdList.length; i++) { phase[i] = hash01(i * 23 + 7) * 6.28; fly[i] = birdList[i].mode === 'circle' ? 1 : 0; }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aFly', new THREE.InstancedBufferAttribute(fly, 1));
    if (!birdMat) {
      birdMat = track(new THREE.MeshStandardMaterial({ color: '#15151a', roughness: 0.55, metalness: 0.1, envMapIntensity: 0.9 }));
      birdMat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = fx.uTime;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aWing; attribute float aPhase; attribute float aFly;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            if (aWing > 0.5) {
              float flap = sin(uTime * 15.0 + aPhase);
              float k = abs(position.z);
              // flying: the wings beat up and down from the shoulder; perched: folded against the body
              transformed.y += aFly * flap * k * 0.75 + (1.0 - aFly) * (-k * 0.15);
              transformed.z *= aFly + (1.0 - aFly) * 0.28;
            }`);
      };
      birdMat.customProgramCacheKey = () => 'hh-crow-v1';
    }
    birds = new THREE.InstancedMesh(geo, birdMat, Math.max(1, birdList.length));
    birds.name = 'crows';
    birds.frustumCulled = false;
    birds.count = birdList.length;
    birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(birds);
    birdsDirty = true;
  }
  let birdsDirty = true;
  const scare = 200;

  function setMatrix(i, b, scale = 1) {
    dummy.position.set(b.x, b.h, b.y);
    dummy.rotation.set(0, -b.yaw, b.mode === 'fly' ? Math.sin(b.t * 6) * 0.25 : 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    birds.setMatrixAt(i, dummy.matrix);
  }

  function updateBirds(dt, cx, cy) {
    if (!birds) return;
    const flyAttr = birds.geometry.getAttribute('aFly');
    let flyDirty = false;
    for (let i = 0; i < birdList.length; i++) {
      const b = birdList[i];
      if (b.mode === 'circle') {
        b.ph += dt * 0.16 * b.dir;
        const nx = b.cx + Math.cos(b.ph) * b.r, ny = b.cy + Math.sin(b.ph) * b.r;
        b.yaw = Math.atan2(ny - b.y, nx - b.x) || b.yaw;
        b.x = nx; b.y = ny; b.h = b.alt + Math.sin(b.ph * 3 + b.i) * 14;
        b.t += dt;
        dummy.position.set(b.x, b.h, b.y);
        dummy.rotation.set(0, -b.yaw, Math.sin(b.t * 0.5) * 0.35 * b.dir);
        dummy.scale.setScalar(1.3);
        dummy.updateMatrix();
        birds.setMatrixAt(i, dummy.matrix);
        birdsDirty = true;
        continue;
      }
      const dx = b.x - cx, dy = b.y - cy;
      if (b.mode === 'perch') {
        if (dx * dx + dy * dy < scare * scare) {
          // take off away from the player, climbing
          const d = Math.hypot(dx, dy) || 1;
          b.mode = 'fly'; b.t = 0;
          b.vx = (dx / d) * (34 + hash01(b.i * 3) * 20) + (hash01(b.i * 5) - 0.5) * 20;
          b.vy = (dy / d) * (34 + hash01(b.i * 3) * 20) + (hash01(b.i * 7) - 0.5) * 20;
          b.vh = 26 + hash01(b.i * 9) * 16;
          b.yaw = Math.atan2(b.vy, b.vx);
          flyAttr.setX(i, 1);
          flyDirty = true;
        }
      } else if (b.mode === 'fly') {
        b.t += dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt;
        b.vh *= 1 - dt * 0.15;
        setMatrix(i, b);
        birdsDirty = true;
        if (b.t > 9) { b.mode = 'gone'; b.wait = 0; dummy.scale.setScalar(0.0001); dummy.updateMatrix(); birds.setMatrixAt(i, dummy.matrix); }
      } else if (b.mode === 'gone') {
        b.wait += dt;
        // a bird comes back to its perch once nobody is near for a while
        if (b.wait > 45 && dx * dx + dy * dy > 700 * 700 && b.home) {
          b.mode = 'perch'; b.x = b.home.x; b.y = b.home.y; b.h = b.home.h; b.t = 0;
          flyAttr.setX(i, 0); flyDirty = true;
          setMatrix(i, b); birdsDirty = true;
        }
      }
    }
    if (flyDirty) flyAttr.needsUpdate = true;
    if (birdsDirty) { birds.instanceMatrix.needsUpdate = true; birdsDirty = false; }
  }
  function placePerched() {
    if (!birds) return;
    for (let i = 0; i < birdList.length; i++) {
      const b = birdList[i];
      if (b.mode === 'perch') { b.home = { x: b.x, y: b.y, h: b.h }; setMatrix(i, b); }
    }
    birds.instanceMatrix.needsUpdate = true;
  }

  function buildAll() {
    buildSwarm();
    buildLitter();
    buildBirds();
    placePerched();
  }
  buildAll();

  return {
    update(view, frame) {
      const cx = frame.camX ?? 0, cy = frame.camY ?? 0;
      const dt = Math.min(0.1, frame.dt || 0.016);
      litterU.uCam.value.set(cx, cy);
      litterU.uGround.value = gy(cx, cy);
      updateBirds(dt, cx, cy);
    },
    setQuality(q) {
      const nt = normTier(q);
      if (nt === tier) return;
      tier = nt;
      buildAll();
    },
    get stats() { return { birds: birdList.length, swarm: swarm ? swarm.geometry.attributes.position.count : 0 }; },
    dispose() {
      for (const o of [swarm, litter, birds]) if (o) { root.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== birdMat) o.material.dispose(); if (o.dispose) o.dispose(); }
      for (const d of disposables) d.dispose && d.dispose();
      void own;
    },
  };
}
