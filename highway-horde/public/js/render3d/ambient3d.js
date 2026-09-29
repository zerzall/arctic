// Ambient life of the first-person view (EFFECTS, SPEC §7.5): things that make a place feel
// lived in without being events — dust and pollen motes drifting in the sunlight (day),
// fireflies over the grass (night), leaves and scraps of paper blown along the ground by a
// slowly turning wind, ash and embers carried downwind from the fires, rain splashes on the
// ground under the night rain ('ultra'), a distant flicker of lightning behind the clouds
// (night, subtle) and birds perched on lamp posts, trees and roofs that burst into the air
// when gunfire starts near them (day).
//
// All of it is cheap: motes, leaves, embers and splashes are particles of the shared pool
// (fx-core.js) spawned in a bubble round the camera at a fixed low rate; fireflies are
// immediate-mode glows; the birds are one small instanced mesh whose wings flap in the
// vertex shader. Counts follow the quality tier (nothing on 'low' except a few leaves).

import * as THREE from 'three';
import { acquireFx, releaseFx, F_ADD, F_BOUNCE, F_SPIN, F_FLICKER, FR } from './fx-core.js';
import { col } from './actor-kit.js';
import { groundIndex, MAT } from './surfaces.js';

const TAU = Math.PI * 2;

const BIRD_VERT = /* glsl */`
attribute vec4 iPos;     // xyz, yaw
attribute vec4 iState;   // flap phase, flap amount 0..1, scale, bank
attribute float aWing;   // 1 on the wing tips
uniform float uTime;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  // perched (flap amount 0): the wings are folded against the body; in flight they beat
  float open = smoothstep(0.0, 0.5, iState.y);
  float flap = sin(iState.x) * iState.y;
  p.z *= mix(0.28, 1.0, open);
  p.y += aWing * ((1.0 - open) * 0.3 + flap * 0.55);
  float bank = iState.w;
  float cb = cos(bank), sb = sin(bank);
  p = vec3(p.x, p.y * cb - p.z * sb, p.y * sb + p.z * cb);
  float cy = cos(iPos.w), sy = sin(iPos.w);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy) * iState.z;
  vec4 mvPosition = modelViewMatrix * vec4(iPos.xyz + p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vShade = 0.6 + 0.4 * aWing;
  #include <fog_vertex>
}`;
const BIRD_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  vec3 c = uColor * vShade;
  #ifdef USE_FOG
    float f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    c = mix(c, fogColor, f);
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function birdGeometry() {
  // nose +x, wings along +-z; tips are flagged for the flap
  const v = [
    0.62, 0, 0, -0.5, 0, 0.13, -0.5, 0, -0.13,                    // body
    0.2, 0, 0.06, -0.38, 0, 0.06, -0.12, 0, 1.0,                  // right wing
    0.2, 0, -0.06, -0.38, 0, -0.06, -0.12, 0, -1.0,               // left wing
    -0.5, 0, 0.1, -0.5, 0, -0.1, -0.86, 0, 0,                     // tail
  ];
  const w = [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
  return g;
}

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createAmbient3D(ctx) {
  const fx = acquireFx(ctx);
  const R = fx.rng;
  const day = ctx.time === 'day';
  let tier = ctx.quality === 'ultra' ? 'ultra' : ctx.quality === 'low' ? 'low' : 'high';
  const gm = groundIndex(ctx);
  const G = ctx.groundY || (() => 0);
  const map = ctx.map;
  let camX = 0, camY = 0, now = 0, wind = 0, windK = 1;
  let acc = { mote: 0, leaf: 0, ember: 0, splash: 0 };
  const amb = ctx.amb;
  const nightK = day ? 1 : 0.5;

  // ---- fires on the map (ember / ash sources) ------------------------------------------------
  const fires = [];
  for (const l of map.lights || []) if (l.flicker >= 0.5 && !Number.isFinite(l.h)) fires.push({ x: l.x, y: l.y });

  // ---- fireflies (night, over grass) --------------------------------------------------------
  const FLY = { ultra: 36, high: 20, low: 0 };
  const flies = [];
  for (let i = 0; i < FLY.ultra; i++) flies.push({ x: 0, y: 0, h: 0, vx: 0, vy: 0, ph: R() * TAU, sp: 0.6 + R() * 0.8, on: false, hue: R() });
  const FLY_C = [col('#c8ff5a'), col('#b8ff7a'), col('#f4ff8a')];

  function placeFly(f) {
    for (let t = 0; t < 8; t++) {
      const a = R() * TAU, d = 90 + R() * 520;
      const x = camX + Math.cos(a) * d, y = camY + Math.sin(a) * d;
      if (x < 0 || y < 0 || x > map.width || y > map.height) continue;
      if (gm(x, y) !== MAT.DIRT) continue;
      f.x = x; f.y = y; f.h = G(x, y) + 8 + R() * 40; f.vx = 0; f.vy = 0; f.on = true;
      return;
    }
    f.on = false;
  }

  // ---- birds (day) ---------------------------------------------------------------------------
  const BIRDS = { ultra: 18, high: 10, low: 0 };
  const perches = [];
  if (day) {
    for (const d of map.decor || []) if (d.kind === 'lamp_post') perches.push({ x: d.x, y: d.y, h: 232 * (d.s || 1) });
    for (const o of map.obstacles || []) {
      if (o.kind === 'building' || o.kind === 'container' || o.kind === 'bus' || o.kind === 'truck' || o.kind === 'tanker') {
        let h = 60;
        try { h = ctx.heightOf(o.kind, o); } catch { h = 60; }
        const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
        const lx = (R() - 0.5) * o.w * 0.8, ly = (R() < 0.5 ? -1 : 1) * o.h * 0.42;
        perches.push({ x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c, h: h + 2 });
      } else if (o.kind === 'tree') perches.push({ x: o.x, y: o.y, h: 120 + R() * 60 });
    }
  }
  const birds = [];
  for (let i = 0; i < BIRDS.ultra; i++) birds.push({ x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, yaw: 0, ph: R() * TAU, fly: 0, t: 0, px: 0, py: 0, ph0: 0, alive: false, sc: 1 });
  const geoB = birdGeometry();
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(BIRDS.ultra * 4), 4);
  const iState = new THREE.InstancedBufferAttribute(new Float32Array(BIRDS.ultra * 4), 4);
  iPos.setUsage(THREE.DynamicDrawUsage); iState.setUsage(THREE.DynamicDrawUsage);
  const bg = new THREE.InstancedBufferGeometry();
  bg.index = null;
  bg.setAttribute('position', geoB.attributes.position);
  bg.setAttribute('aWing', geoB.attributes.aWing);
  bg.setAttribute('iPos', iPos);
  bg.setAttribute('iState', iState);
  bg.instanceCount = 0;
  const bmat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color('#1a1714') } }]),
    vertexShader: BIRD_VERT, fragmentShader: BIRD_FRAG, fog: true, side: THREE.DoubleSide,
  });
  const birdMesh = new THREE.Mesh(bg, bmat);
  birdMesh.frustumCulled = false;
  birdMesh.visible = false;
  birdMesh.name = 'birds';
  // (only in the scene when there can be birds: no program to compile at night or on 'low')
  const syncBirdMesh = () => { if (day && BIRDS[tier] > 0 && perches.length) { if (!birdMesh.parent) ctx.scene.add(birdMesh); } else birdMesh.removeFromParent(); };
  syncBirdMesh();

  function perchBird(b, far) {
    if (!perches.length) { b.alive = false; return; }
    for (let t = 0; t < 12; t++) {
      const p = perches[(R() * perches.length) | 0];
      const d = Math.hypot(p.x - camX, p.y - camY);
      if (far ? d < 600 || d > 1500 : d > 1200) continue;
      b.x = p.x + (R() - 0.5) * 6; b.y = p.y + (R() - 0.5) * 6; b.h = p.h + G(p.x, p.y) + 1.2;
      b.px = b.x; b.py = b.y; b.ph0 = b.h;
      b.fly = 0; b.t = 0; b.alive = true; b.yaw = R() * TAU; b.vx = b.vy = b.vh = 0; b.sc = 10 + R() * 4;
      return;
    }
    b.alive = false;
  }
  function scare(x, y, radius) {
    for (const b of birds) {
      if (!b.alive || b.fly) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d > radius) continue;
      b.fly = 1; b.t = -R() * 0.5;               // (a little stagger: they don't all go at once)
      const a = Math.atan2(b.y - y, b.x - x) + (R() - 0.5) * 1.2;
      const sp = 90 + R() * 70;
      b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.vh = 90 + R() * 60;
      b.yaw = a;
    }
  }

  // ---- lightning (night, far away) ---------------------------------------------------------------
  let nextBolt = 12 + R() * 30, boltT = -1, boltA = 0;
  const BOLT_C = new THREE.Color(1.1, 1.3, 1.8);

  // ---- wind + particles ---------------------------------------------------------------------------
  let windX = 1, windY = 0, windS = 60;
  const LEAF_D = ['#7a8a3a', '#a0803a', '#6a7a30', '#8a5a2a', '#b09a48'].map(col);
  const LEAF_N = ['#2c3320', '#3a3020', '#26301e', '#332a1e'].map(col);
  const PAPER_C = [col('#d8d2c0'), col('#c8c4b0')], PAPER_N = [col('#4a4a48'), col('#3e3e3c')];
  const MOTE_C = [col('#fff4d0'), col('#ffe9a8'), col('#fffbe8')];
  const ASH_C = col('#4a4744');
  const EMBER_C = new THREE.Color('#ffab50').multiplyScalar(3);
  const SPL_C = new THREE.Color('#dfe8f0');

  function update(view, frame) {
    fx.begin(frame);
    const dt = Math.min(0.1, frame.dt || 0);
    now = frame.now || 0;
    camX = frame.camX; camY = frame.camY;
    if (!(dt > 0)) return;
    wind += dt;
    const wa = 0.5 + Math.sin(wind * 0.045) * 0.7 + Math.sin(wind * 0.13) * 0.25;
    windS = 45 + 40 * (0.5 + 0.5 * Math.sin(wind * 0.09 + 1));
    windX = Math.cos(wa); windY = Math.sin(wa);
    const high = tier !== 'low';
    const ultra = tier === 'ultra';
    const load = fx.load();

    // motes: warm specks hanging in the light (day), a few cold ones at night near the lamps' haze
    if (day && high && load < 0.8) {
      acc.mote += dt * (ultra ? 12 : 6);
      while (acc.mote >= 1) {
        acc.mote -= 1;
        const a = R() * TAU, d = 30 + R() * 380;
        const x = camX + Math.cos(a) * d, y = camY + Math.sin(a) * d, h = G(x, y) + 4 + R() * 150;
        fx.spawn(x, h, y, windX * windS * 0.25 + (R() - 0.5) * 10, (R() - 0.4) * 5, windY * windS * 0.25 + (R() - 0.5) * 10, 6 + R() * 5, 0.7 + R() * 0.8, 0.5, MOTE_C[(R() * 3) | 0], 0.32 + R() * 0.25, FR.MOTE, F_ADD | F_FLICKER, 0, 0.05);
      }
    }

    // leaves and paper blown along the ground
    if (load < 0.8) {
      acc.leaf += dt * (ultra ? 1.6 : high ? 1 : 0.4);
      while (acc.leaf >= 1) {
        acc.leaf -= 1;
        // upwind of the camera so they cross the view
        const a = Math.atan2(-windY, -windX) + (R() - 0.5) * 2.2, d = 80 + R() * 340;
        const x = camX + Math.cos(a) * d, y = camY + Math.sin(a) * d;
        if (x < 0 || y < 0 || x > map.width || y > map.height) continue;
        if (gm(x, y) === MAT.WATER) continue;
        const paper = R() < (day ? 0.25 : 0.4);
        const c = paper ? (day ? PAPER_C : PAPER_N)[(R() * 2) | 0] : (day ? LEAF_D : LEAF_N)[(R() * 5) % (day ? 5 : 4) | 0];
        const sp = windS * (0.9 + R() * 0.7);
        fx.spawn(x, G(x, y) + 1 + R() * 34, y, windX * sp, 20 + R() * 40, windY * sp, 7 + R() * 4, paper ? 3.4 : 2.6, paper ? 3.4 : 2.6, c, 1, paper ? FR.PAPER : FR.LEAF, F_BOUNCE | F_SPIN, 55, 0.35);
      }
    }

    // the air above the nearest big fire shimmers with heat (screen-space distortion, post.js)
    if (high && fires.length) {
      let best = -1, bd = 900 * 900;
      for (let i = 0; i < fires.length; i++) {
        const d2 = (fires[i].x - camX) ** 2 + (fires[i].y - camY) ** 2;
        if (d2 < bd) { bd = d2; best = i; }
      }
      if (best >= 0) fx.distortSteady('fire', fires[best].x, G(fires[best].x, fires[best].y) + 75, fires[best].y, 90, 0.55);
    }

    // ash and embers carried downwind from the fires near the camera
    if (high && fires.length && load < 0.85) {
      acc.ember += dt * (ultra ? 14 : 7);
      while (acc.ember >= 1) {
        acc.ember -= 1;
        const f = fires[(R() * fires.length) | 0];
        const d2 = (f.x - camX) ** 2 + (f.y - camY) ** 2;
        if (d2 > 1400 * 1400) continue;
        const bx = f.x + (R() - 0.5) * 24, by = f.y + (R() - 0.5) * 24, h0 = G(f.x, f.y);
        if (R() < 0.55) {
          fx.spawn(bx, h0 + 30 + R() * 30, by, windX * windS * 0.6 + (R() - 0.5) * 20, 30 + R() * 50, windY * windS * 0.6 + (R() - 0.5) * 20, 2 + R() * 2, 1.4 + R(), 0.5, EMBER_C, 1, FR.EMBER, F_ADD | F_FLICKER, -6, 0.3);
        } else {
          fx.spawn(bx, h0 + 40 + R() * 30, by, windX * windS * 0.8 + (R() - 0.5) * 20, 20 + R() * 30, windY * windS * 0.8 + (R() - 0.5) * 20, 3.5 + R() * 3, 1.6, 1.2, ASH_C, 0.75, FR.DOT, F_SPIN, 6, 0.3);
        }
      }
    }

    // rain splashes: faint white flecks popping on the ground around the player under the night rain
    if (ultra && !day && load < 0.8) {
      acc.splash += dt * 45;
      while (acc.splash >= 1) {
        acc.splash -= 1;
        const a = R() * TAU, d = 20 + Math.sqrt(R()) * 330;
        const x = camX + Math.cos(a) * d, y = camY + Math.sin(a) * d;
        if (gm(x, y) === MAT.WATER) continue;
        fx.spawn(x, G(x, y) + 0.8, y, 0, 26 + R() * 30, 0, 0.16 + R() * 0.08, 2.4, 5, SPL_C, 0.16, FR.SPLASH, F_ADD, 500, 0);
      }
    }

    // fireflies
    if (!day && tier !== 'low') {
      const n = FLY[tier];
      for (let i = 0; i < n; i++) {
        const f = flies[i];
        const d2 = (f.x - camX) ** 2 + (f.y - camY) ** 2;
        if (!f.on || d2 > 760 * 760) { placeFly(f); if (!f.on) continue; }
        // wander: a random walk in heading, drifting up and down
        f.ph += dt * f.sp * 3;
        const a = Math.sin(f.ph * 0.7 + i) * 3 + i;
        f.vx += (Math.cos(a) * 16 - f.vx) * Math.min(1, dt * 1.5);
        f.vy += (Math.sin(a) * 16 - f.vy) * Math.min(1, dt * 1.5);
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.h += Math.sin(f.ph * 0.9) * 9 * dt;
        f.h = Math.max(G(f.x, f.y) + 4, f.h);
        const pulse = Math.max(0, Math.sin(f.ph * 1.3 + i * 2.1));
        const glow = 0.15 + pulse * pulse * 0.85;
        const c = FLY_C[i % 3];
        fx.glow(f.x, f.h, f.y, 2.2 + glow * 2.4, tmpC.copy(c).multiplyScalar(2.6 * glow), 0.9, FR.FIREFLY);
      }
    }

    // lightning behind the clouds
    if (!day && high) {
      nextBolt -= dt;
      if (nextBolt <= 0) { nextBolt = 25 + R() * 55; boltT = 0; boltA = R() * TAU; }
      if (boltT >= 0) {
        boltT += dt;
        // two quick pulses
        const p = boltT < 0.09 ? 1 - boltT / 0.09 : boltT > 0.16 && boltT < 0.34 ? (1 - (boltT - 0.16) / 0.18) * 0.75 : 0;
        if (p > 0.01) {
          const bx = camX + Math.cos(boltA) * 3200, by = camY + Math.sin(boltA) * 3200;
          fx.glow(bx, 360, by, 1500, tmpC.copy(BOLT_C).multiplyScalar(0.9 * p), 0.55, FR.GLOW);
          fx.glow(bx, 900, by, 2600, tmpC.copy(BOLT_C).multiplyScalar(0.5 * p), 0.5, FR.GLOW);
          ctx.lights.flash(camX + Math.cos(boltA) * 900, camY + Math.sin(boltA) * 900, 700, '#b4c6ff', 0.3 * p, 3000, 0.06);
        }
        if (boltT > 0.6) boltT = -1;
      }
    }

    // birds
    if (day && BIRDS[tier] > 0 && perches.length) {
      const n = BIRDS[tier];
      let cnt = 0;
      const P = iPos.array, S = iState.array;
      for (let i = 0; i < n; i++) {
        const b = birds[i];
        if (!b.alive) {
          b.t += dt;
          if (b.t >= 0) perchBird(b, true);
          if (!b.alive) { b.t = -4; continue; }
        }
        if (b.fly) {
          b.t += dt;
          if (b.t < 0) { /* crouching before the jump */ } else {
            b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt;
            b.vh += (b.t < 2.5 ? 40 : -6) * dt;
            b.vh = Math.max(-30, Math.min(b.vh, 110));
            const sp = Math.hypot(b.vx, b.vy), tgt = 190;
            const k = 1 + (tgt / Math.max(1, sp) - 1) * Math.min(1, dt * 0.8);
            b.vx *= k; b.vy *= k;
            b.yaw = Math.atan2(b.vy, b.vx);
            // circle a little
            const turn = Math.sin(b.ph + b.t * 0.6) * 0.5 * dt;
            const ca = Math.cos(turn), sa = Math.sin(turn);
            const nvx = b.vx * ca - b.vy * sa, nvy = b.vx * sa + b.vy * ca;
            b.vx = nvx; b.vy = nvy;
            const far = Math.hypot(b.x - camX, b.y - camY) > 1700;
            if (b.h > 700 || far || b.t > 18) { b.alive = false; b.fly = 0; b.t = -6 - R() * 10; continue; }
          }
        } else if (Math.hypot(b.x - camX, b.y - camY) > 1900) {
          perchBird(b, true);
        }
        if (!b.alive) continue;
        if (Math.hypot(b.x - camX, b.y - camY) > 2200) continue;
        const o = cnt * 4;
        const flying = b.fly && b.t >= 0;
        b.ph += dt * (flying ? 22 : 0);
        P[o] = b.x; P[o + 1] = b.h; P[o + 2] = b.y; P[o + 3] = -b.yaw;
        S[o] = b.ph; S[o + 1] = flying ? 1 : 0.0; S[o + 2] = b.sc; S[o + 3] = flying ? Math.sin(b.ph * 0.05 + i) * 0.35 : 0;
        cnt++;
      }
      bg.instanceCount = cnt;
      birdMesh.visible = cnt > 0;
      if (cnt) { iPos.needsUpdate = true; iState.needsUpdate = true; }
    } else {
      birdMesh.visible = false;
    }
  }
  const tmpC = new THREE.Color();

  function addEvents(events) {
    if (!events || !day || !perches.length) return;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (e.type === 'shot' && !e.echo) scare(e.x, e.y, 900);
      else if (e.type === 'explosion') scare(e.x, e.y, 2200);
    }
  }

  // first placement: birds perch right away
  function init() {
    if (day && perches.length) for (let i = 0; i < BIRDS[tier]; i++) perchBird(birds[i], false);
  }
  init();

  return {
    update,
    addEvents,
    setQuality(q) {
      tier = q === 'ultra' ? 'ultra' : q === 'low' ? 'low' : 'high';
      for (const f of flies) f.on = false;
      syncBirdMesh();
      if (day && perches.length) for (let i = 0; i < BIRDS[tier]; i++) if (!birds[i].alive) perchBird(birds[i], false);
    },
    scare,
    dispose() {
      birdMesh.removeFromParent();
      bg.dispose(); geoB.dispose(); bmat.dispose();
      releaseFx(ctx);
    },
    get stats() { return { birds: bg.instanceCount, flies: flies.filter((f) => f.on).length }; },
    /** Test hook: the birds (position, flying, alive). */
    get birds() { return birds; },
  };
}
