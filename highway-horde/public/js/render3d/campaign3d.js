// Highway Horde (the campaign) in the first-person view, one dynamic sub-system:
//   - the objective: a ground ring and a light column over the stage's circle (hill top, tower
//     door, the floor's stairs, the zip gantry), lifted onto the terrain
//   - the horde front (stage 2): a rolling wall of dust and a red glow across the street,
//     advancing along the route; standing behind it thickens the fog to a brown haze
//   - a beacon over the tower during the breakout
//   - the zip line: a pulse running down the cable once it is live, a trolley over each rider
//   - an on-screen marker for the objective (name + distance, pinned to the edge with an arrow)
// Built at creation when the map carries a campaign (`map.campaign`); every piece is one draw
// call. On any other map it does nothing.

import * as THREE from 'three';
import { routePointExt, SUB, STAGE_SHORT } from '../shared/campaign.js';

const PX_PER_M = 32;
const BEAM_H = 900;
const FRONT_W = 1500;
const FRONT_H = 520;
const RING = new THREE.Color(1.0, 0.8, 0.35);
const GO = new THREE.Color(0.4, 1.0, 0.6);
const DUST_FOG = new THREE.Color('#6c5540');

const NOISE = /* glsl */`
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
`;
const TONE = `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

function additive(uniforms, vertexShader, fragmentShader) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });
}

const VS = /* glsl */`
varying vec3 vW; varying vec2 vUv; varying float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vUv = uv;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/** The horde front's foot: a red-hot glow along the ground and a hot rim, thin near the eye. */
const FRONT_FS = /* glsl */`
uniform float uTime, uAlpha, uFog;
varying vec3 vW; varying vec2 vUv; varying float vDepth;
${NOISE}
void main() {
  float x = vUv.x * ${FRONT_W.toFixed(1)};
  float y = vUv.y;
  float n = vnoise(vec2(x / 60.0, y * 5.0 - uTime * 1.1));
  float glow = exp(-y * 9.0) * (0.55 + 0.6 * n);
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  float a = glow * edge;
  a *= mix(0.1, 1.0, smoothstep(60.0, 500.0, length(vW.xz - cameraPosition.xz)));
  a *= exp(-uFog * uFog * vDepth * vDepth * 0.05) * uAlpha;
  gl_FragColor = vec4(vec3(1.5, 0.4, 0.16), clamp(a, 0.0, 1.0) * 0.8);
  ${TONE}
}`;

/** The dust wall of the horde front: churning brown dust that hides what is coming (normal blending). */
const DUST_FS = /* glsl */`
uniform float uTime, uAlpha, uFog;
uniform vec3 uFogColor;
varying vec3 vW; varying vec2 vUv; varying float vDepth;
${NOISE}
void main() {
  float x = vUv.x * ${FRONT_W.toFixed(1)};
  float y = vUv.y;
  float n = vnoise(vec2(x / 140.0, y * 2.6 - uTime * 0.6)) * 0.55 + vnoise(vec2(x / 44.0, y * 7.0 - uTime * 1.5)) * 0.45;
  float body = smoothstep(0.0, 0.1, y) * pow(1.0 - y, 0.9);
  float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  float a = (0.25 + 0.7 * n) * body * edge;
  a *= mix(0.05, 1.0, smoothstep(80.0, 600.0, length(vW.xz - cameraPosition.xz)));
  a *= exp(-uFog * uFog * vDepth * vDepth * 0.03) * uAlpha;
  vec3 col = mix(vec3(0.24, 0.17, 0.12), vec3(0.5, 0.36, 0.26), n);
  col = mix(col, uFogColor * 1.5, 0.45);       // lit like the air around it (day or night)
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  ${TONE}
}`;

/** A light column: bright core, fading upward. */
const BEAM_FS = /* glsl */`
uniform float uTime, uAlpha, uFog;
uniform vec3 uColor;
varying vec3 vW; varying vec2 vUv; varying float vDepth;
${NOISE}
void main() {
  float flick = 0.8 + 0.2 * vnoise(vec2(vW.y / 90.0 - uTime * 1.5, 0.5));
  float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4) * flick * uAlpha;
  a *= exp(-uFog * uFog * vDepth * vDepth * 0.08);
  // a column seen from beside it is a soft shaft; standing in it, it must not blind you
  a *= 0.06 + 0.94 * smoothstep(120.0, 900.0, length(vW.xz - cameraPosition.xz));
  gl_FragColor = vec4(uColor * 1.8, clamp(a, 0.0, 1.0) * 0.32);
  ${TONE}
}`;

/** The ground ring: a soft band with dashes marching around it. */
const RING_FS = /* glsl */`
uniform float uTime, uAlpha, uFog, uR;
uniform vec3 uColor;
varying vec3 vW; varying vec2 vUv; varying float vDepth;
void main() {
  float t = vUv.x;                              // 0 at the inner edge, 1 at the outer
  float band = smoothstep(0.0, 0.2, t) * smoothstep(1.0, 0.8, t);
  float ang = vUv.y * 6.2831853;
  float dash = 0.55 + 0.45 * smoothstep(-0.2, 0.4, sin(ang * 36.0 - uTime * 1.5));
  float a = band * dash * uAlpha;
  a *= exp(-uFog * uFog * vDepth * vDepth * 0.1);
  gl_FragColor = vec4(uColor * 1.8, clamp(a, 0.0, 1.0) * 0.6);
  ${TONE}
}`;

function ringGeometry() {
  // a flat annulus: uv.x across the band (0 inner .. 1 outer), uv.y around
  const seg = 96;
  const pos = new Float32Array((seg + 1) * 2 * 3), uv = new Float32Array((seg + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pos.set([c * 0.9, 0, s * 0.9, c * 1.0, 0, s * 1.0], i * 6);
    uv.set([0, i / seg, 1, i / seg], i * 4);
    if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createCampaign3D(ctx) {
  const { scene, map, overlay } = ctx;
  const cfg = map && map.campaign;
  if (!cfg) return null;
  const gy = ctx.groundY || (() => 0);
  const root = new THREE.Group();
  root.name = 'campaign';
  scene.add(root);
  const disposables = [];
  const fogDensity0 = scene.fog ? scene.fog.density : 0.0006;
  const fogColor0 = scene.fog ? scene.fog.color.clone() : new THREE.Color();

  // ---- the objective ring and column ----
  const ringGeo = ringGeometry();
  disposables.push(ringGeo);
  const ringMat = additive({
    uTime: { value: 0 }, uAlpha: { value: 0 }, uFog: { value: fogDensity0 }, uR: { value: 100 }, uColor: { value: RING.clone() },
  }, VS, RING_FS);
  disposables.push(ringMat);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.frustumCulled = false;
  ring.renderOrder = 7;
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  beamGeo.translate(0, 0.5, 0);
  disposables.push(beamGeo);
  const beamMat = additive({ uTime: { value: 0 }, uAlpha: { value: 0 }, uFog: { value: fogDensity0 }, uColor: { value: RING.clone() } }, VS, BEAM_FS);
  disposables.push(beamMat);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beam.renderOrder = 8;
  root.add(ring, beam);

  // ---- the tower beacon (the breakout's goal, seen from the hill) ----
  const t = cfg.tower;
  const beaconMat = additive({ uTime: { value: 0 }, uAlpha: { value: 0 }, uFog: { value: fogDensity0 }, uColor: { value: new THREE.Color(0.5, 0.85, 1.0) } }, VS, BEAM_FS);
  disposables.push(beaconMat);
  const beacon = new THREE.Mesh(beamGeo, beaconMat);
  beacon.frustumCulled = false;
  beacon.scale.set(14, 900, 14);
  const towerTop = (cfg.roof ? cfg.roof.base : 440);
  beacon.position.set(t.x, towerTop + gy(t.x, t.y), t.y);
  beacon.visible = false;
  root.add(beacon);

  // ---- the horde front: a dust wall across the street ----
  const frontGeo = new THREE.PlaneGeometry(FRONT_W, FRONT_H, 1, 1);
  frontGeo.translate(0, FRONT_H / 2, 0);
  disposables.push(frontGeo);
  const frontMat = additive({ uTime: { value: 0 }, uAlpha: { value: 1 }, uFog: { value: fogDensity0 } }, VS, FRONT_FS);
  disposables.push(frontMat);
  const front = new THREE.Mesh(frontGeo, frontMat);
  front.frustumCulled = false;
  front.renderOrder = 8;
  front.visible = false;
  root.add(front);
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uFog: { value: fogDensity0 }, uFogColor: { value: fogColor0.clone() } },
    vertexShader: VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  disposables.push(dustMat);
  const dust = new THREE.Mesh(frontGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 6;
  dust.visible = false;
  root.add(dust);

  // ---- the zip line: a pulse on the cable, and a trolley over each rider ----
  const pulseGeo = new THREE.SphereGeometry(5, 10, 6);
  const pulseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 3.0), fog: false, toneMapped: false });
  const trolleyGeo = new THREE.BoxGeometry(9, 6, 16);
  const trolleyMat = new THREE.MeshStandardMaterial({ color: '#3a4048', roughness: 0.4, metalness: 0.8 });
  disposables.push(pulseGeo, pulseMat, trolleyGeo, trolleyMat);
  const pulses = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(pulseGeo, pulseMat);
    m.visible = false;
    root.add(m);
    return m;
  });
  const trolleys = [];
  const zipA = cfg.roof && cfg.roof.zip, zipB = cfg.landing && cfg.landing.end;

  let time = 0;
  let dustK = 0;
  const _pt = { x: 0, y: 0, a: 0 };

  function update(view, frame) {
    const c = view && view.campaign;
    if (!c || view.phase === 'gameover' || view.phase === 'victory') {
      root.visible = false;
      relaxFog(frame.dt);
      return;
    }
    root.visible = true;
    const dt = frame.dt || 0.016;
    time += dt;
    const fogD = scene.fog ? scene.fog.density : fogDensity0;

    // the objective: hidden while a wave is being fought on the hill (the hill IS the objective)
    const showObj = c.stage > 1 || c.sub !== SUB.FIGHT;
    const live = c.stage === 4 && c.zip;
    ring.visible = beam.visible = showObj && c.r > 0;
    if (ring.visible) {
      const y0 = gy(c.x, c.y);
      ring.position.set(c.x, y0 + 2, c.y);
      ring.scale.set(c.r, 1, c.r);
      beam.position.set(c.x, y0, c.y);
      beam.scale.set(10, BEAM_H, 10);
      const col = live ? GO : RING;
      ringMat.uniforms.uColor.value.copy(col);
      beamMat.uniforms.uColor.value.copy(col);
      ringMat.uniforms.uTime.value = beamMat.uniforms.uTime.value = time;
      ringMat.uniforms.uFog.value = beamMat.uniforms.uFog.value = fogD;
      ringMat.uniforms.uAlpha.value = 0.75 + 0.25 * Math.sin(time * 3);
      // no column when you stand inside the circle: it is for finding it from afar
      const dc = Math.hypot(frame.camX - c.x, frame.camY - c.y);
      const k = Math.max(0, Math.min(1, (dc - c.r * 0.7) / (c.r * 0.8)));
      beamMat.uniforms.uAlpha.value = (0.55 + 0.2 * Math.sin(time * 2)) * k;
      beam.visible = k > 0.01;
    }

    // the tower beacon during the breakout
    beacon.visible = c.stage === 2;
    if (beacon.visible) {
      beaconMat.uniforms.uTime.value = time;
      beaconMat.uniforms.uFog.value = fogD;
      beaconMat.uniforms.uAlpha.value = 0.6 + 0.2 * Math.sin(time * 2.4);
    }

    // the horde front
    const hasFront = c.stage === 2 && c.front > -1e8 && cfg.route;
    front.visible = dust.visible = !!hasFront;
    let behind = false;
    if (hasFront) {
      routePointExt(cfg.route, c.front, _pt);
      front.position.set(_pt.x, gy(_pt.x, _pt.y), _pt.y);
      // the plane faces along the route: its normal (local +z) is the travel direction
      front.rotation.set(0, Math.PI / 2 - _pt.a, 0);
      dust.position.copy(front.position);
      dust.rotation.copy(front.rotation);
      frontMat.uniforms.uTime.value = dustMat.uniforms.uTime.value = time;
      frontMat.uniforms.uFog.value = dustMat.uniforms.uFog.value = fogD;
      const local = frame.local;
      if (local && local.state !== 'dead') {
        const dx = local.x - _pt.x, dy = local.y - _pt.y;
        behind = dx * Math.cos(_pt.a) + dy * Math.sin(_pt.a) < 0;
      }
    }
    dustK += ((behind ? 1 : 0) - dustK) * Math.min(1, dt * 2);
    applyFog();

    // the zip line
    for (let i = 0; i < pulses.length; i++) {
      const on = !!(live && zipA && zipB);
      pulses[i].visible = on;
      if (!on) continue;
      const e = (time * 0.35 + i / pulses.length) % 1;
      pulses[i].position.set(zipA.x + (zipB.x - zipA.x) * e, zipA.z + (zipB.z - zipA.z) * e + gy(zipA.x, zipA.y), zipA.y + (zipB.y - zipA.y) * e);
    }
    syncTrolleys(view);
    drawOverlay(view, c, frame, live);
  }

  function syncTrolleys(view) {
    const riders = [];
    for (const p of view.players || []) if (p.ride > 0) riders.push(p);
    while (trolleys.length < riders.length) {
      const m = new THREE.Mesh(trolleyGeo, trolleyMat);
      m.castShadow = true;
      root.add(m);
      trolleys.push(m);
    }
    for (let i = 0; i < trolleys.length; i++) {
      const m = trolleys[i], p = riders[i];
      m.visible = !!p;
      if (!p) continue;
      const hang = 66;
      m.position.set(p.x, (p.z || 0) + hang + 18, p.y);
      if (zipA && zipB) m.rotation.y = Math.atan2(zipB.x - zipA.x, zipB.y - zipA.y);
    }
  }

  function applyFog() {
    if (!scene.fog) return;
    scene.fog.color.copy(fogColor0).lerp(DUST_FOG, 0.5 * dustK);
    scene.fog.density = fogDensity0 * (1 + 1.4 * dustK);
  }

  function relaxFog(dt) {
    if (dustK <= 0) return;
    dustK = Math.max(0, dustK - (dt || 0.016) * 2);
    applyFog();
  }

  // ---- overlay: the objective marker ----
  function drawOverlay(view, c, frame, live) {
    if (!overlay) return;
    const local = frame.local;
    if (!local || local.state === 'dead' || local.esc || local.ride > 0) return;
    if (!(c.stage > 1 || c.sub !== SUB.FIGHT) || !(c.r > 0)) return;
    const W = overlay.canvas.width / (window.devicePixelRatio || 1), H = overlay.canvas.height / (window.devicePixelRatio || 1);
    const dist = Math.max(0, Math.hypot(c.x - local.x, c.y - local.y) - c.r);
    if (dist < 1 && c.stage !== 4) return;
    const p = ctx.project(c.x, c.y, (c.stage === 4 ? 190 : 90) + gy(c.x, c.y));
    let label;
    if (live) label = 'ZIP LINE';
    else if (c.stage === 2) label = 'TOWER';
    else if (c.stage === 3) label = 'STAIRS';
    else if (c.stage === 4) label = 'GANTRY';
    else label = (STAGE_SHORT && STAGE_SHORT[c.stage]) || 'OBJECTIVE';
    marker(p, W, H, `${label}  ${Math.round(dist / PX_PER_M)} m`, live ? '#6dff9a' : '#ffd166');
  }

  function marker(p, W, H, label, col) {
    const mx = Math.min(W * 0.3, 90), my = Math.min(H * 0.3, 150);
    let x = p.x, y = p.y, off = false, ang = 0;
    if (!p.visible || x < mx || x > W - mx || y < my || y > H - my) {
      off = true;
      const cx = W / 2, cy = H / 2;
      ang = Math.atan2(y - cy, x - cx);
      if (!p.visible) ang += Math.PI;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const s = Math.min((W / 2 - mx) / Math.max(1e-6, Math.abs(dx)), (H / 2 - my) / Math.max(1e-6, Math.abs(dy)));
      x = cx + dx * s;
      y = cy + dy * s;
    }
    overlay.save();
    overlay.translate(x, y);
    overlay.globalAlpha = 0.9;
    overlay.lineWidth = 5;
    overlay.strokeStyle = 'rgba(0,0,0,0.55)';
    overlay.beginPath();
    overlay.arc(0, 0, 11, 0, Math.PI * 2);
    overlay.stroke();
    overlay.lineWidth = 2.5;
    overlay.strokeStyle = col;
    overlay.beginPath();
    overlay.arc(0, 0, 11, 0, Math.PI * 2);
    overlay.stroke();
    overlay.fillStyle = col;
    overlay.beginPath();
    overlay.arc(0, 0, 3.5, 0, Math.PI * 2);
    overlay.fill();
    if (off) {
      overlay.save();
      overlay.rotate(ang);
      overlay.beginPath();
      overlay.moveTo(26, 0);
      overlay.lineTo(15, -8);
      overlay.lineTo(15, 8);
      overlay.closePath();
      overlay.fill();
      overlay.restore();
    }
    overlay.font = '700 14px "Barlow Condensed", system-ui, sans-serif';
    const tw = overlay.measureText(label).width;
    const lx = Math.max(-x + 8 + tw / 2, Math.min(W - x - 8 - tw / 2, 0));
    overlay.textAlign = 'center';
    overlay.textBaseline = 'top';
    overlay.lineWidth = 3;
    overlay.strokeStyle = 'rgba(0,0,0,0.85)';
    const ly = y > H - 90 ? -34 : 18;
    overlay.strokeText(label, lx, ly);
    overlay.fillStyle = '#fff6e0';
    overlay.fillText(label, lx, ly);
    overlay.restore();
  }

  function dispose() {
    if (scene.fog) {
      scene.fog.color.copy(fogColor0);
      scene.fog.density = fogDensity0;
    }
    scene.remove(root);
    for (const d of disposables) d.dispose();
  }

  return { update, dispose };
}
