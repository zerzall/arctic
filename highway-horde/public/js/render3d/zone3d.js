// Evac Run in the first-person view (SPEC §3.7 / §7.5), one sub-system:
//   - the safe zone's wall: a tall translucent teal curtain on the circle, streaks rising
//     through it, a bright seam on the ground; it fades out near the camera (walking through
//     it never blinds you) and ignores most of the fog, so it reads from across the map
//   - the smaller circle it will shrink to, as a low white curtain
//   - the blight: a violet haze lying on the ground outside the circle during a wave
//   - a light column over the announced zone while the team is on the move, and a green one
//     over the supply drop (with the crate itself, lit by the pool)
//   - standing outside while the blight is live: the fog thickens and turns violet (the HUD
//     adds the violet screen edge)
//   - an on-screen marker for the zone (name + distance, pinned to the screen edge with an
//     arrow when it is off screen) and a small SUPPLY tag over the drop
// Built at creation when ctx.mode is 'zone' (so the warm-up compiles its programs); every
// piece is one draw call. In a defend game it does nothing.

import * as THREE from 'three';
import { zoneEdgeDist, zoneName } from '../shared/zone.js';

const WALL_H = 560;
const NEXT_H = 170;
const HAZE_OUT = 1500;
const BEAM_H = 1700;
const PX_PER_M = 32;
const TEAL = new THREE.Color(0.3, 0.95, 0.85);
const WHITE = new THREE.Color(1, 1, 1);
const BLIGHT_FOG = new THREE.Color('#4a2248');

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

const WALL_VS = /* glsl */`
varying vec3 vW; varying float vH; varying float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vH = uv.y;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/** The curtain: rising streaks, a hex-ish lattice, a bright ground seam; fades up and near the eye. */
const WALL_FS = /* glsl */`
uniform float uTime, uR, uAlpha, uFog, uPulse;
uniform vec2 uC;
uniform vec3 uColor;
varying vec3 vW; varying float vH; varying float vDepth;
${NOISE}
void main() {
  vec2 d = vW.xz - uC;
  float ang = atan(d.y, d.x);
  float s = ang * uR;                      // arc length around the circle
  float y = vW.y;
  float rise = vnoise(vec2(s / 70.0, y / 160.0 - uTime * 0.55));
  float fine = vnoise(vec2(s / 22.0, y / 40.0 - uTime * 1.3));
  float ribs = pow(abs(sin(s / 38.0)), 24.0);
  float bands = pow(abs(sin(y / 22.0 - uTime * 2.0)), 40.0) * 0.6;
  float top = pow(clamp(1.0 - vH, 0.0, 1.0), 1.7);
  float seam = exp(-y / 7.0) * 1.8 + exp(-y / 40.0) * 0.35;
  float a = (0.05 + 0.15 * rise * rise + 0.06 * fine + 0.16 * ribs + bands * top) * top + seam;
  // near the eye the curtain thins out: walking through it never blinds you
  float dc = length(vW.xz - cameraPosition.xz);
  a *= mix(0.1, 1.0, smoothstep(50.0, 520.0, dc));
  // most of the fog is ignored so the wall reads from across the map
  a *= exp(-uFog * uFog * vDepth * vDepth * 0.1);
  a *= uAlpha * uPulse;
  gl_FragColor = vec4(uColor * (1.2 + seam * 1.6), clamp(a, 0.0, 1.0));
  ${TONE}
}`;

/** The blight haze on the ground outside the circle. */
const HAZE_FS = /* glsl */`
uniform float uTime, uR, uAlpha, uFog;
uniform vec2 uC;
varying vec3 vW; varying float vH; varying float vDepth;
${NOISE}
void main() {
  float t = (length(vW.xz - uC) - uR) / ${HAZE_OUT.toFixed(1)};
  if (t < 0.0) discard;
  float n = vnoise(vW.xz / 260.0 + vec2(uTime * 0.05, -uTime * 0.04)) * 0.6 + vnoise(vW.xz / 90.0 - uTime * 0.12) * 0.4;
  float a = smoothstep(0.0, 0.03, t) * exp(-t * 2.2) * (0.35 + 0.65 * n);
  // thin around the eye: a haze in the distance, not a coat of paint on your boots
  a *= mix(0.2, 1.0, smoothstep(40.0, 420.0, length(vW.xz - cameraPosition.xz)));
  a *= exp(-uFog * uFog * vDepth * vDepth * 0.4) * uAlpha;
  gl_FragColor = vec4(vec3(0.46, 0.2, 0.44), clamp(a, 0.0, 1.0) * 0.32);
  ${TONE}
}`;

/** A light column: bright core, soft edge, fading upward. */
const BEAM_FS = /* glsl */`
uniform float uTime, uAlpha, uFog;
uniform vec3 uColor;
varying vec3 vW; varying float vH; varying float vDepth;
${NOISE}
void main() {
  float flick = 0.8 + 0.2 * vnoise(vec2(vW.y / 90.0 - uTime * 1.5, 0.5));
  float a = pow(clamp(1.0 - vH, 0.0, 1.0), 1.4) * flick * uAlpha;
  a *= exp(-uFog * uFog * vDepth * vDepth * 0.08);
  gl_FragColor = vec4(uColor * 2.2, clamp(a, 0.0, 1.0) * 0.5);
  ${TONE}
}`;

/**
 * @param {object} ctx renderer ctx (SPEC §7.5) + `mode`
 */
export function createZone3D(ctx) {
  const { scene, map, overlay } = ctx;
  if (ctx.mode !== 'zone') return null;
  const root = new THREE.Group();
  root.name = 'zone';
  scene.add(root);
  const disposables = [];
  const fogDensity0 = scene.fog ? scene.fog.density : 0.0006;
  const fogColor0 = scene.fog ? scene.fog.color.clone() : new THREE.Color();

  // ---- the wall (and the shrink target) ----
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true);
  cylGeo.translate(0, 0.5, 0);
  disposables.push(cylGeo);
  const wallU = (color, alpha) => ({
    uTime: { value: 0 }, uR: { value: 500 }, uAlpha: { value: alpha }, uFog: { value: fogDensity0 }, uPulse: { value: 1 },
    uC: { value: new THREE.Vector2() }, uColor: { value: color.clone() },
  });
  const wallMat = additive(wallU(TEAL, 1), WALL_VS, WALL_FS);
  const nextMat = additive(wallU(WHITE, 0.55), WALL_VS, WALL_FS);
  disposables.push(wallMat, nextMat);
  const wall = new THREE.Mesh(cylGeo, wallMat);
  wall.name = 'zone-wall';
  wall.frustumCulled = false;
  wall.renderOrder = 8;
  const next = new THREE.Mesh(cylGeo, nextMat);
  next.name = 'zone-next';
  next.frustumCulled = false;
  next.renderOrder = 8;
  root.add(wall, next);

  // ---- the blight haze: a quad around the zone, the circle itself cut out ----
  const hazeGeo = new THREE.PlaneGeometry(2, 2, 1, 1);
  hazeGeo.rotateX(-Math.PI / 2);
  disposables.push(hazeGeo);
  const hazeMat = additive({
    uTime: { value: 0 }, uR: { value: 500 }, uAlpha: { value: 0 }, uFog: { value: fogDensity0 }, uC: { value: new THREE.Vector2() },
  }, WALL_VS, HAZE_FS);
  hazeMat.side = THREE.FrontSide;
  disposables.push(hazeMat);
  const haze = new THREE.Mesh(hazeGeo, hazeMat);
  haze.name = 'zone-haze';
  haze.frustumCulled = false;
  haze.renderOrder = 7;
  root.add(haze);

  // ---- light columns: the announced zone and the supply drop ----
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  beamGeo.translate(0, 0.5, 0);
  disposables.push(beamGeo);
  const beamU = (color) => ({ uTime: { value: 0 }, uAlpha: { value: 0 }, uFog: { value: fogDensity0 }, uColor: { value: color.clone() } });
  const zoneBeamMat = additive(beamU(TEAL), WALL_VS, BEAM_FS);
  const dropBeamMat = additive(beamU(new THREE.Color(0.35, 1, 0.5)), WALL_VS, BEAM_FS);
  disposables.push(zoneBeamMat, dropBeamMat);
  const zoneBeam = new THREE.Mesh(beamGeo, zoneBeamMat);
  zoneBeam.scale.set(16, BEAM_H, 16);
  zoneBeam.frustumCulled = false;
  const dropBeam = new THREE.Mesh(beamGeo, dropBeamMat);
  dropBeam.scale.set(6, 780, 6);
  dropBeam.frustumCulled = false;
  root.add(zoneBeam, dropBeam);

  // ---- the supply drop: a crate on a pallet, straps, a green strobe ----
  const drop = new THREE.Group();
  drop.name = 'zone-drop';
  const crateGeo = new THREE.BoxGeometry(46, 38, 46);
  const palletGeo = new THREE.BoxGeometry(60, 6, 60);
  const strapGeo = new THREE.BoxGeometry(48, 39, 5);
  const strobeGeo = new THREE.SphereGeometry(3.2, 10, 6);
  disposables.push(crateGeo, palletGeo, strapGeo, strobeGeo);
  const crateMat = new THREE.MeshStandardMaterial({ color: '#6b5a3a', roughness: 0.85, metalness: 0.05 });
  const palletMat = new THREE.MeshStandardMaterial({ color: '#5a4128', roughness: 0.95, metalness: 0 });
  const strapMat = new THREE.MeshStandardMaterial({ color: '#2f3a1e', roughness: 0.7, metalness: 0.2 });
  const strobeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.5, 1.2), fog: false, toneMapped: false });
  disposables.push(crateMat, palletMat, strapMat, strobeMat);
  const pallet = new THREE.Mesh(palletGeo, palletMat);
  pallet.position.y = 3;
  const crate = new THREE.Mesh(crateGeo, crateMat);
  crate.position.y = 25;
  const strapA = new THREE.Mesh(strapGeo, strapMat);
  strapA.position.y = 25.5;
  const strapB = strapA.clone();
  strapB.rotation.y = Math.PI / 2;
  const strobe = new THREE.Mesh(strobeGeo, strobeMat);
  strobe.position.y = 48;
  for (const m of [pallet, crate, strapA, strapB]) { m.castShadow = true; m.receiveShadow = true; }
  drop.add(pallet, crate, strapA, strapB, strobe);
  drop.rotation.y = 0.35;
  root.add(drop);

  // start hidden until the first zone arrives
  root.visible = false;
  let time = 0;
  let outK = 0;
  let hidMarker = false;

  function update(view, frame) {
    const z = view && view.zone;
    if (!hidMarker) {
      const m = scene.getObjectByName('objective-marker');
      if (m) m.visible = false;
      hidMarker = true;
    }
    if (!z || view.phase === 'gameover' || view.phase === 'victory') {
      root.visible = false;
      restoreFog(frame.dt);
      return;
    }
    root.visible = true;
    const dt = frame.dt || 0.016;
    time += dt;
    const fogD = scene.fog ? scene.fog.density : fogDensity0;
    const moving = z.stage === 0;
    // wall
    wall.position.set(z.x, 0, z.y);
    wall.scale.set(z.r, WALL_H, z.r);
    const wu = wallMat.uniforms;
    wu.uTime.value = time;
    wu.uR.value = z.r;
    wu.uC.value.set(z.x, z.y);
    wu.uFog.value = fogD;
    wu.uPulse.value = moving ? 0.75 + 0.25 * Math.sin(time * 3) : 1;
    wu.uAlpha.value = moving ? 0.8 : 1;
    // the circle it shrinks to
    const shrinking = z.stage >= 1 && (Math.abs(z.nr - z.r) > 2 || Math.abs(z.nx - z.x) > 2 || Math.abs(z.ny - z.y) > 2);
    next.visible = shrinking;
    if (shrinking) {
      next.position.set(z.nx, 0, z.ny);
      next.scale.set(z.nr, NEXT_H, z.nr);
      const nu = nextMat.uniforms;
      nu.uTime.value = time;
      nu.uR.value = z.nr;
      nu.uC.value.set(z.nx, z.ny);
      nu.uFog.value = fogD;
    }
    // blight haze while the circle is live
    const hu = hazeMat.uniforms;
    const hazeOn = z.stage > 0 && view.phase === 'wave';
    hu.uAlpha.value += ((hazeOn ? 1 : 0) - hu.uAlpha.value) * Math.min(1, dt * 2);
    haze.visible = hu.uAlpha.value > 0.01;
    haze.position.set(z.x, 10, z.y);
    const hs = z.r + HAZE_OUT;
    haze.scale.set(hs, 1, hs);
    hu.uTime.value = time;
    hu.uR.value = z.r;
    hu.uC.value.set(z.x, z.y);
    hu.uFog.value = fogD;
    // light columns
    zoneBeam.visible = moving;
    zoneBeam.position.set(z.x, 0, z.y);
    zoneBeamMat.uniforms.uTime.value = time;
    zoneBeamMat.uniforms.uAlpha.value = 0.7 + 0.2 * Math.sin(time * 2);
    zoneBeamMat.uniforms.uFog.value = fogD;
    dropBeam.position.set(z.sx, 0, z.sy);
    dropBeamMat.uniforms.uTime.value = time;
    dropBeamMat.uniforms.uAlpha.value = 0.55 + 0.25 * Math.sin(time * 4);
    dropBeamMat.uniforms.uFog.value = fogD;
    drop.position.set(z.sx, 0, z.sy);
    strobe.visible = Math.sin(time * 6) > 0.2;
    if (ctx.lights && Math.hypot(z.sx - frame.camX, z.sy - frame.camY) < 1400) ctx.lights.steady('zone:drop', z.sx, z.sy, 70, '#b8ffcf', 0.8, 230);

    // standing in the blight: violet fog closing in, and a vignette
    const local = frame.local;
    const outside = !!local && local.state !== 'dead' && z.stage > 0 && view.phase === 'wave' && zoneEdgeDist(z, local.x, local.y) > 0;
    outK += ((outside ? 1 : 0) - outK) * Math.min(1, dt * 2.5);
    applyFog();
    drawOverlay(view, z, frame);
  }

  function applyFog() {
    if (!scene.fog) return;
    scene.fog.color.copy(fogColor0).lerp(BLIGHT_FOG, 0.45 * outK);
    scene.fog.density = fogDensity0 * (1 + 1.0 * outK);
  }

  function restoreFog(dt) {
    if (outK <= 0) return;
    outK = Math.max(0, outK - (dt || 0.016) * 2.5);
    applyFog();
  }

  // ---- overlay: the zone marker, the SUPPLY tag, the blight vignette ----
  function drawOverlay(view, z, frame) {
    if (!overlay) return;
    const W = overlay.canvas.width / (window.devicePixelRatio || 1), H = overlay.canvas.height / (window.devicePixelRatio || 1);
    const local = frame.local;
    // (the violet screen edge itself is the HUD's, ui/zonehud.js: both views share it)
    if (!local || local.state === 'dead') return;
    const edge = zoneEdgeDist(z, local.x, local.y);
    // the zone marker: while on the move, or whenever outside the circle
    if (z.stage === 0 ? edge > -z.r * 0.4 : edge > -40) {
      const p = ctx.project(z.x, z.y, 90);
      const label = `${zoneName(map, z) || 'Safe zone'}  ${Math.max(0, Math.round(edge / PX_PER_M))} m`;
      marker(p, W, H, label, z.stage > 0 && view.phase === 'wave' && edge > 0);
    }
    // supply tag over the drop when it's near enough to matter
    const dd = Math.hypot(z.sx - local.x, z.sy - local.y);
    if (dd < 1600 && dd > 60) {
      const p = ctx.project(z.sx, z.sy, 70);
      if (p.visible) {
        overlay.save();
        overlay.globalAlpha = Math.min(1, (1600 - dd) / 500);
        overlay.fillStyle = '#6dff9a';
        overlay.strokeStyle = 'rgba(0,0,0,0.8)';
        overlay.lineWidth = 2;
        overlay.fillRect(p.x - 2, p.y - 8, 4, 16);
        overlay.fillRect(p.x - 8, p.y - 2, 16, 4);
        overlay.font = '700 12px "Barlow Condensed", system-ui, sans-serif';
        overlay.textAlign = 'center';
        overlay.textBaseline = 'bottom';
        overlay.strokeText(`SUPPLY ${Math.round(dd / PX_PER_M)} m`, p.x, p.y - 12);
        overlay.fillText(`SUPPLY ${Math.round(dd / PX_PER_M)} m`, p.x, p.y - 12);
        overlay.restore();
      }
    }
  }

  /** Ring icon + label at the projected point, or pinned to the screen edge with an arrow. */
  function marker(p, W, H, label, danger) {
    // pinned inside the HUD's frame (its panels fill the corners and the edges)
    const mx = Math.min(W * 0.3, 90), my = Math.min(H * 0.3, 150);
    let x = p.x, y = p.y, off = false, ang = 0;
    if (!p.visible || x < mx || x > W - mx || y < my || y > H - my) {
      off = true;
      const cx = W / 2, cy = H / 2;
      ang = Math.atan2(y - cy, x - cx);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const s = Math.min((W / 2 - mx) / Math.max(1e-6, Math.abs(dx)), (H / 2 - my) / Math.max(1e-6, Math.abs(dy)));
      x = cx + dx * s;
      y = cy + dy * s;
    }
    const col = danger ? '#ff7aa0' : '#4fe3d0';
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
    // keep the label on screen: near a side edge it hangs inward
    const text = label.toUpperCase();
    const tw = overlay.measureText(text).width;
    const lx = Math.max(-x + 8 + tw / 2, Math.min(W - x - 8 - tw / 2, 0));
    overlay.textAlign = 'center';
    overlay.textBaseline = 'top';
    overlay.lineWidth = 3;
    overlay.strokeStyle = 'rgba(0,0,0,0.85)';
    const ly = y > H - 90 ? -34 : 18;
    overlay.strokeText(text, lx, ly);
    overlay.fillStyle = '#eafffb';
    overlay.fillText(text, lx, ly);
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
