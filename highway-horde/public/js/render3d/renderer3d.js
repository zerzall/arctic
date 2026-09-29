// First-person 3D renderer (SPEC §7.5) — the public API, same shape as the top-down
// renderer (§7.1) so ui/match.js can use either. Owns the WebGLRenderer, scene, camera rig,
// fog, light pool (lights.js), static world (world.js → ground.js) and the 2D overlay
// canvas, and drives the sub-systems (zombies, players, items, effects, viewmodel,
// overlay) through the shared read-only `ctx`.
//
// Frame order: settings → camera rig → sub-systems (they may register lights/decals) →
// world → light pool → post chain (post.js: world pass into an HDR target → AO → viewmodel
// pass (depth cleared, own scene/camera) → bloom → grade/tone map → AA → upscale) →
// dynamic resolution → stats. render() never throws: failures are caught and logged a few
// times, and a post chain that fails falls back to drawing the world straight to the canvas.
//
// Graphics settings (render(view, { settings })), applied live and cheap when unchanged:
//   quality 'ultra'|'high'|'low', renderScale 'auto'|0.5..1 (fraction of the tier's
//   pixel-ratio cap; 'auto' = dynamic resolution), bloom, ao (ignored on 'low'),
//   antialias 'smaa'|'fxaa'|'off' ('low' uses FXAA), filmGrain, vignette, volumetrics
//   (ground mist + light scattering) and reflections (wet ground / water SSR), both
//   ignored on 'low'.

import * as THREE from 'three';
import { createWorld, obstacleHeight, objectiveHeight, fireBaseHeight } from './world.js';
import { createLights, ambientFor } from './lights.js';
import { WEAPONS } from '../shared/weapons.js';
import * as zombiesMod from './zombies3d.js';
import * as playersMod from './players3d.js';
import * as itemsMod from './items3d.js';
import * as effectsMod from './effects3d.js';
import * as viewmodelMod from './viewmodel.js';
import * as overlayMod from './overlay.js';
import * as zoneMod from './zone3d.js';
import { releaseSharedGuns } from './actor-guns.js';
import { releaseFxAtlas } from './fx-core.js';
import { createPost, createDynRes, createGpuTimer, normPostSettings } from './post.js';

const EYE = 52;
const EYE_DOWNED = 16;
// Jump landing dip: a damped spring (units, 1/s², 1/s) kicked downward on touch-down.
const LAND_KICK = 85;
const LAND_K = 170;
const LAND_C = 19;
const NEAR = 2;
const MAX_LOGS = 5;

/**
 * True when this browser can run the 3D view (three.js r186 needs WebGL2).
 * @returns {boolean}
 */
export function isWebGLAvailable() {
  try {
    if (typeof window === 'undefined' || !window.WebGL2RenderingContext) return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ok = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/**
 * three.js camera FOV (vertical degrees) for the settings' field of view. The setting is
 * the shooter convention: horizontal degrees measured on a 4:3 frame ("Hor+": wider screens
 * see more at the sides, never less at the top). Read as a vertical angle, the default 80
 * was a 113° horizontal fisheye at 16:9 that shrank cars, zombies and teammates.
 * Screens narrower than 4:3 (a phone held upright) keep that horizontal angle instead,
 * capped at 100° vertical, so portrait isn't a zoomed-in keyhole.
 * @param {number} setting 60..110 (default 80 → 64.4° vertical at 4:3 and wider)
 * @param {number} [aspect] width / height
 * @returns {number}
 */
export function verticalFov(setting, aspect = 16 / 9) {
  const h = Math.max(60, Math.min(110, Number(setting) || 80)) * Math.PI / 180;
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(4 / 3, aspect) : 4 / 3;
  const v = Math.min(100, 2 * Math.atan(Math.tan(h / 2) / a) * 180 / Math.PI);
  return Math.round(v * 100) / 100;
}

/** The first `create*` function a sub-system module exports (tolerant of naming). */
function factoryOf(mod) {
  if (!mod) return null;
  for (const k of Object.keys(mod)) if (k.startsWith('create') && typeof mod[k] === 'function') return mod[k];
  return typeof mod.default === 'function' ? mod.default : null;
}

/** 'ultra' | 'high' | 'low' (anything unknown is 'high'). */
function normQuality(v) {
  return v === 'low' || v === 'ultra' ? v : 'high';
}

/**
 * Create the first-person renderer on `canvas`.
 * @param {HTMLCanvasElement} canvas
 * @param {{ map: object, quality?: 'ultra'|'high'|'low', mode?: 'defend'|'zone' }} opts
 *   mode 'zone' (Evac Run) builds the safe-zone wall and markers (zone3d.js)
 */
export function createRenderer3D(canvas, { map, quality = 'high', mode = 'defend' } = {}) {
  const tCreate = performance.now();
  let q = normQuality(quality);
  // No MSAA on the canvas: the world is drawn into the post chain's HDR target and only a
  // full-screen quad reaches the canvas (SMAA / FXAA do the anti-aliasing).
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance',
  });
  const glMs = performance.now() - tCreate;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.autoClear = true;
  // The canvas may carry a context from an earlier game: three.js caches GL state (e.g.
  // UNPACK_FLIP_Y), so start from known defaults (and leave them again in destroy()).
  renderer.resetState();

  const amb = ambientFor(map);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(amb.fog.getHex(), amb.fogDensity);
  scene.background = amb.fog.clone();
  const far = Math.hypot(map.width, map.height) + 1400;
  const camera = new THREE.PerspectiveCamera(verticalFov(80), 16 / 9, NEAR, far);
  camera.rotation.order = 'YXZ';
  const spawn = map.playerSpawns && map.playerSpawns[0] || { x: map.width / 2, y: map.height / 2 };
  camera.position.set(spawn.x, EYE, spawn.y);
  scene.add(camera);

  // ---- overlay canvas: a sibling right after the WebGL canvas, same box, no input ----
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.className = 'hh-overlay3d';
  overlayCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(overlayCanvas.style, { pointerEvents: 'none', position: 'absolute', left: '0px', top: '0px' });
  canvas.parentNode?.insertBefore(overlayCanvas, canvas.nextSibling);
  const overlay = overlayCanvas.getContext('2d');

  // ---- light pool + ctx ----
  const lights = createLights({ scene, camera, map, quality: q, fireBase: (x, y) => fireBaseHeight(map, x, y) });
  let trauma = 0;
  let cssW = 1, cssH = 1, dpr = 1;
  // prFull = the tier's pixel-ratio cap (canvas), prInner = prFull × renderScale (world pass)
  let prFull = 1, prInner = 1, renderScale = 1;
  const _p = new THREE.Vector3();

  function project(x, y, h = 0) {
    _p.set(x, h, y).applyMatrix4(camera.matrixWorldInverse);
    const behind = _p.z > -NEAR * 0.5;
    _p.applyMatrix4(camera.projectionMatrix);
    let sx = (_p.x * 0.5 + 0.5) * cssW, sy = (-_p.y * 0.5 + 0.5) * cssH;
    if (behind) { sx = cssW - sx; sy = cssH - sy; }   // mirrored, so off-screen arrows point the right way
    const visible = !behind && _p.x >= -1 && _p.x <= 1 && _p.y >= -1 && _p.y <= 1;
    return { x: sx, y: sy, visible };
  }

  const rng = () => Math.random();
  rng.next = rng;
  rng.range = (a, b) => a + (b - a) * Math.random();
  rng.chance = (p) => Math.random() < p;
  rng.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const ctx = {
    THREE, scene, camera, map, quality: q, mode,
    overlay,
    lights: { flash: lights.flash, steady: lights.steady },
    ground: { decal() {} },
    project,
    shake(amount) {
      if (Number.isFinite(amount)) trauma = Math.min(1, trauma + Math.max(0, amount));
    },
    heightOf(kind, o) {
      if (o && map.objective && o === map.objective) return objectiveHeight(o);
      return obstacleHeight(kind, o);
    },
    rng,
  };

  const tWorld = performance.now();
  // drawing-buffer height of the world pass (points and halos are sized in its pixels)
  const world = createWorld(ctx, { renderer, lights, pixelHeight: () => Math.max(1, Math.floor(cssH * prInner)) });
  const worldMs = performance.now() - tWorld;
  ctx.ground.decal = world.ground.decal;

  // ---- sub-systems ----
  let errors = 0;
  const logErr = (where, err) => {
    if (errors++ < MAX_LOGS) console.error(`[renderer3d] ${where}:`, err);
  };
  const subs = [];
  const subMs = {};
  let vm = null;
  for (const [name, mod] of [['zombies3d', zombiesMod], ['players3d', playersMod], ['items3d', itemsMod], ['effects3d', effectsMod], ['viewmodel', viewmodelMod], ['zone3d', zoneMod], ['overlay', overlayMod]]) {
    const make = factoryOf(mod);
    if (!make) continue;
    try {
      const tSub = performance.now();
      const sys = make(ctx);
      subMs[name] = Math.round(performance.now() - tSub);
      if (!sys) continue;
      sys.__name = name;
      if (name === 'viewmodel') vm = sys;
      subs.push(sys);
    } catch (err) {
      logErr('create ' + name, err);
    }
  }

  // ---- camera rig state ----
  const rig = {
    x: camera.position.x, y: camera.position.z, eye: EYE, yaw: 0, pitch: 0, roll: 0,
    lastX: NaN, lastY: NaN, speed: 0, bob: 0, kick: 0, mode: 'fps', chaseId: 0,
    cx: camera.position.x, cy: EYE, cz: camera.position.z, orbit: 0, time: 0,
    lastZ: 0, lastAir: false, air: 0, land: 0, landV: 0, climb: 0,
  };
  let lastSettings = { screenShake: true, fov: 80 };
  let localId = 0;
  let fov = verticalFov(80);
  let destroyed = false;

  const _look = new THREE.Vector3();
  function updateCamera(view, local, look, settings, dt) {
    rig.time += dt;
    const shakeOn = settings.screenShake !== false;
    trauma = Math.max(0, trauma - dt * 1.4);
    rig.kick *= Math.exp(-dt * 11);
    const alive = local && local.state !== 'dead';
    if (alive) {
      // --- first person ---
      if (rig.mode !== 'fps') { rig.lastX = NaN; rig.mode = 'fps'; rig.lastZ = 0; rig.lastAir = false; rig.land = rig.landV = 0; }
      const downed = local.state === 'downed';
      // jump: the eye rides the feet height (on a roof too); touch-down kicks a short dip
      // (a smaller one at the end of a climb), walk bob fades in the air and on the way up
      const z = local.z > 0 ? local.z : 0;
      const climbing = local.climbT > 0;
      const airborne = climbing || (local.vzq !== undefined ? local.vzq !== 0 : z > 0);
      if (rig.lastAir && !airborne) rig.landV -= rig.climb > 0.3 ? LAND_KICK * 0.45 : LAND_KICK;
      rig.lastAir = airborne;
      rig.lastZ = z;
      rig.air += ((airborne ? 1 : 0) - rig.air) * (1 - Math.exp(-dt * 12));
      // climbing: the view dips toward the ledge and rolls a little as the body swings over
      rig.climb += ((climbing ? 1 : 0) - rig.climb) * (1 - Math.exp(-dt * (climbing ? 14 : 7)));
      for (let left = Math.min(dt, 0.1); left > 1e-6;) {
        const h = Math.min(left, 1 / 120);
        rig.landV += (-LAND_K * rig.land - LAND_C * rig.landV) * h;
        rig.land += rig.landV * h;
        left -= h;
      }
      const dx = local.x - rig.lastX, dy = local.y - rig.lastY;
      const moved = Number.isFinite(dx) ? Math.hypot(dx, dy) : 0;
      rig.lastX = local.x; rig.lastY = local.y;
      const inst = dt > 0 && moved < 60 ? moved / dt : 0;
      rig.speed += (inst - rig.speed) * (1 - Math.exp(-dt * 10));
      const sp = Math.min(1.6, rig.speed / 190);
      rig.bob += dt * rig.speed * (local.sprinting ? 0.05 : 0.056);
      const targetEye = downed ? EYE_DOWNED : EYE;
      rig.eye += (targetEye - rig.eye) * (1 - Math.exp(-dt * 6));
      const amp = (downed ? 0.6 : (local.sprinting ? 2.3 : 1.4) * Math.min(1, sp)) * (1 - rig.air);
      const bobY = Math.abs(Math.sin(rig.bob)) * amp - amp * 0.5;
      const bobX = Math.cos(rig.bob) * amp * 0.45;
      const yaw = look.yaw, pitch = look.pitch;
      const rx = Math.cos(yaw + Math.PI / 2), ry = Math.sin(yaw + Math.PI / 2);
      camera.position.set(local.x + rx * bobX, rig.eye + bobY + z + rig.land, local.y + ry * bobX);
      const rollT = downed ? 0.22 + Math.sin(rig.time * 0.7) * 0.03 : Math.cos(rig.bob) * 0.006 * sp;
      rig.roll += (rollT - rig.roll) * (1 - Math.exp(-dt * 5));
      camera.rotation.set(pitch + rig.kick - rig.climb * 0.1, -yaw - Math.PI / 2, rig.roll + rig.climb * 0.035);
      rig.cx = camera.position.x; rig.cy = camera.position.y; rig.cz = camera.position.z;
      rig.yaw = yaw; rig.pitch = pitch;
    } else {
      // --- spectating: chase a living teammate, else orbit the objective ---
      const players = view ? view.players : [];
      let target = players.find((p) => p.id === rig.chaseId && p.state !== 'dead');
      if (!target) target = players.find((p) => p.id !== localId && p.state === 'alive') || players.find((p) => p.id !== localId && p.state === 'downed');
      let tx, ty, th, lx, ly, lh;
      if (target) {
        if (rig.mode !== 'chase' || rig.chaseId !== target.id) rig.mode = 'chase';
        rig.chaseId = target.id;
        const a = target.angle || 0;
        const tz = target.z > 0 ? target.z : 0;
        tx = target.x - Math.cos(a) * 150; ty = target.y - Math.sin(a) * 150; th = 96 + tz * 0.5;
        lx = target.x + Math.cos(a) * 60; ly = target.y + Math.sin(a) * 60; lh = 40 + tz;
      } else {
        rig.mode = 'orbit';
        rig.orbit += dt * 0.08;
        const o = map.objective || { x: map.width / 2, y: map.height / 2 };
        tx = o.x + Math.cos(rig.orbit) * 560; ty = o.y + Math.sin(rig.orbit) * 560; th = 330;
        lx = o.x; ly = o.y; lh = 40;
      }
      const k = 1 - Math.exp(-dt * 3.5);
      rig.cx += (tx - rig.cx) * k; rig.cy += (th - rig.cy) * k; rig.cz += (ty - rig.cz) * k;
      camera.position.set(rig.cx, rig.cy, rig.cz);
      _look.set(lx, lh, ly);
      camera.lookAt(_look);
      rig.yaw = Math.atan2(ly - rig.cz, lx - rig.cx);
      rig.pitch = camera.rotation.x;
      rig.roll = 0;
    }
    if (shakeOn && trauma > 0) {
      const t2 = trauma * trauma, t = rig.time * 31;
      camera.rotation.x += t2 * 0.035 * (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.3 + 1) * 0.4);
      camera.rotation.y += t2 * 0.035 * (Math.sin(t * 0.9 + 2) * 0.6 + Math.sin(t * 2.1) * 0.4);
      camera.rotation.z += t2 * 0.02 * Math.sin(t * 1.7 + 4);
    }
    const f = verticalFov(settings.fov, camera.aspect);
    if (f !== fov || camera.fov !== f) { fov = f; camera.fov = f; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  // ---- post chain + dynamic resolution ----
  let post = null;
  try {
    // the atmosphere pass reads the light pool, the flashlight and the ground's wet mask
    const atmosSrc = { lights: lights.poolLights, kinds: lights.poolKinds, flashlight: lights.flashlight, ambient: amb, ground: world.ground, fogDensity: amb.fogDensity };
    post = createPost(renderer, { scene, camera, getViewmodel: () => vm, quality: q, getAtmos: () => { atmosSrc.lights = lights.poolLights; atmosSrc.kinds = lights.poolKinds; return atmosSrc; } });
  } catch (err) {
    logErr('post chain', err);
    post = null;
  }
  const dyn = createDynRes();
  let gpuTimer = null;
  try { gpuTimer = createGpuTimer(renderer.getContext()); } catch { gpuTimer = null; }
  let postSet = normPostSettings(null);
  // raw values of the last settings seen: re-normalised only when one of them changes
  const rawSet = { quality: undefined, renderScale: undefined, bloom: undefined, ao: undefined, antialias: undefined, filmGrain: undefined, vignette: undefined, volumetrics: undefined, reflections: undefined };
  let postErrors = 0;

  // ---- sizing ----
  /** The tier's pixel-ratio cap (the canvas' resolution; renderScale is a fraction of it). */
  function pixelRatio() {
    const d = window.devicePixelRatio || 1;
    // Ultra renders at the screen's native resolution (phones are ~3x): sharp, and hot.
    if (q === 'ultra') return Math.min(d, 3);
    return q === 'high' ? Math.min(d, 2) : Math.min(d, 1) * 0.75;
  }
  /** Re-size the post chain's internal targets for the current render scale. */
  function applyScale() {
    prInner = prFull * renderScale;
    if (post) post.setSize(cssW, cssH, prFull, prInner);
  }
  function resize() {
    if (destroyed) return;
    cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    prFull = pixelRatio();
    // without the post chain the canvas itself is the render target: scale it instead
    renderer.setPixelRatio(post ? prFull : prFull * renderScale);
    renderer.setSize(cssW, cssH, false);
    applyScale();
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    if (vm && vm.camera && vm.camera.isPerspectiveCamera) {
      vm.camera.aspect = cssW / cssH;
      vm.camera.updateProjectionMatrix();
    }
    dpr = window.devicePixelRatio || 1;
    overlayCanvas.width = Math.round(cssW * dpr);
    overlayCanvas.height = Math.round(cssH * dpr);
    const cs = getComputedStyle(canvas);
    overlayCanvas.style.position = cs.position === 'fixed' ? 'fixed' : 'absolute';
    overlayCanvas.style.left = canvas.offsetLeft + 'px';
    overlayCanvas.style.top = canvas.offsetTop + 'px';
    overlayCanvas.style.width = cssW + 'px';
    overlayCanvas.style.height = cssH + 'px';
    if (cs.zIndex && cs.zIndex !== 'auto') overlayCanvas.style.zIndex = cs.zIndex;
  }
  resize();

  // Shader warm-up. Programs compile the first time a material is drawn: a boss, a molotov,
  // the first ejected casing or a shadow depth variant each cost a compile mid-fight (13 of
  // 36 programs were first built during play, 10-100 ms each on a real GPU). Compile every
  // material now, and draw one frame with the shadow casters unculled so the depth variants
  // exist too. Objects a sub-system creates later mostly share these programs (same
  // material parameters → same program).
  // Programs depend on the render target (tone mapping / output colour space), so compile
  // them against the post chain's HDR target, the one they are drawn into.
  const tWarm = performance.now();
  try {
    if (post) renderer.setRenderTarget(post.readBuffer);
    renderer.compile(scene, camera);
    if (vm && vm.scene && vm.camera) renderer.compile(vm.scene, vm.camera);
    // the moon's map (static casters, their depth programs) is drawn here, not mid-game
    if (lights.updateMoonShadow) lights.updateMoonShadow(renderer, scene, world.moonCasters);
    const unculled = [];
    scene.traverse((o) => { if (o.castShadow && o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
    renderer.render(scene, camera);
    for (const o of unculled) o.frustumCulled = true;
    renderer.setRenderTarget(null);
    if (post) {
      post.configure(postSet, q);
      post.warm();
    }
  } catch (err) {
    renderer.setRenderTarget(null);
    logErr('warm-up', err);
  }
  const warmMs = performance.now() - tWarm;
  const createMs = { total: Math.round(performance.now() - tCreate), gl: Math.round(glMs), world: Math.round(worldMs), warm: Math.round(warmMs), subs: subMs };

  // ---- stats ----
  // jsMs = whole render() call; updateMs = scene updates (sub-systems, world, lights);
  // submitMs = three.js render calls (draw submission; includes driver time on software GL)
  // renderScale = fraction of the tier's pixel-ratio cap in use; gpuMs only where the
  // browser exposes GPU timer queries (EXT_disjoint_timer_query_webgl2)
  const stats = { drawCalls: 0, triangles: 0, jsMs: 0, updateMs: 0, submitMs: 0, fps: 0, lights: 0, staticTriangles: 0, frames: 0, renderScale: 1, pixelRatio: 1, post: !!post };
  let fpsAcc = 0, fpsN = 0, jsAvg = 0, updAvg = 0, subAvg = 0;

  function render(view, opts = {}) {
    if (destroyed) return;
    const t0 = performance.now();
    try {
      localId = opts.localId || 0;
      const dt = Math.max(0, Math.min(0.1, Number(opts.dt) || 0));
      const settings = opts.settings || lastSettings;
      lastSettings = settings;
      applySettings(settings);
      if ((canvas.clientWidth && canvas.clientWidth !== cssW) || (canvas.clientHeight && canvas.clientHeight !== cssH)) resize();
      const local = view && view.players ? view.players.find((p) => p.id === localId) || null : null;
      const look = opts.look || { yaw: local ? local.angle : rig.yaw, pitch: 0 };
      updateCamera(view, local, { yaw: Number(look.yaw) || 0, pitch: Math.max(-1.35, Math.min(1.35, Number(look.pitch) || 0)) }, settings, dt);

      overlay.setTransform(1, 0, 0, 1, 0, 0);
      overlay.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      overlay.setTransform(dpr, 0, 0, dpr, 0, 0);

      const frame = {
        dt, now: Number(opts.now) || 0, localId, roster: opts.roster || [], local,
        camX: camera.position.x, camY: camera.position.z, yaw: rig.yaw, pitch: rig.pitch, settings,
      };
      if (view) {
        for (const s of subs) {
          try { s.update(view, frame); } catch (err) { logErr('update ' + s.__name, err); }
        }
      }
      world.update(view, frame);
      lights.update({
        dt, camX: frame.camX, camY: frame.camY,
        flashlight: !!local && local.state !== 'dead',
        lightingBoost: settings.lighting === false ? 2.2 : 1,
      });

      const t1 = performance.now();
      renderer.info.reset();
      if (lights.updateMoonShadow) {
        try { lights.updateMoonShadow(renderer, scene, world.moonCasters); } catch (err) { logErr('moon shadow', err); }
      }
      drawFrame(frame, dt);
      const t2 = performance.now();
      if (postSet.renderScale === 'auto') {
        const ns = dyn.tick(t2, gpuTimer ? gpuTimer.ms : undefined);
        if (ns !== null && ns !== renderScale) { renderScale = ns; resize(); }
      }
      updAvg += (t1 - t0 - updAvg) * 0.1;
      subAvg += (t2 - t1 - subAvg) * 0.1;
      stats.updateMs = Math.round(updAvg * 100) / 100;
      stats.submitMs = Math.round(subAvg * 100) / 100;

      const info = renderer.info.render;
      stats.drawCalls = info.calls;
      stats.triangles = info.triangles;
      stats.lights = lights.activeCount;
      stats.staticTriangles = world.stats.staticTriangles;
      if (post) { stats.sceneCalls = post.sceneInfo.calls; stats.sceneTriangles = post.sceneInfo.triangles; }
      stats.renderScale = Math.round(renderScale * 100) / 100;
      stats.pixelRatio = Math.round(prInner * 1000) / 1000;
      stats.post = !!post;
      if (gpuTimer && Number.isFinite(gpuTimer.ms)) stats.gpuMs = Math.round(gpuTimer.ms * 100) / 100;
      stats.frames++;
      if (dt > 0) {
        fpsAcc += dt; fpsN++;
        if (fpsAcc >= 0.5) { stats.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
      }
    } catch (err) {
      logErr('render', err);
    }
    const ms = performance.now() - t0;
    jsAvg += (ms - jsAvg) * 0.1;
    stats.jsMs = Math.round(jsAvg * 100) / 100;
  }

  /** Draw the frame: through the post chain, or straight to the canvas without one. */
  function drawFrame(frame, dt) {
    if (post) {
      try {
        if (gpuTimer) gpuTimer.begin();
        post.render(dt, frame);
        if (gpuTimer) gpuTimer.end();
        return;
      } catch (err) {
        if (gpuTimer) gpuTimer.end();
        logErr('post chain', err);
        renderer.setRenderTarget(null);
        renderer.autoClear = true;
        // a chain that keeps failing is dropped for good: the world still draws
        if (++postErrors >= 3) {
          try { post.dispose(); } catch { /* already broken */ }
          post = null;
          resize();
        }
      }
    }
    renderer.render(scene, camera);
    if (vm) renderViewmodel(frame);
  }

  /**
   * Apply the graphics settings carried by render()'s settings (SPEC §7.5 contract):
   * compares the raw values first, so an unchanged settings object costs a few compares.
   */
  function applySettings(s) {
    if (!s) return;
    if (s.quality !== rawSet.quality) {
      rawSet.quality = s.quality;
      if (s.quality === 'low' || s.quality === 'high' || s.quality === 'ultra') api.setQuality(s.quality);
    }
    if (s.renderScale === rawSet.renderScale && s.bloom === rawSet.bloom && s.ao === rawSet.ao && s.antialias === rawSet.antialias
      && s.filmGrain === rawSet.filmGrain && s.vignette === rawSet.vignette
      && s.volumetrics === rawSet.volumetrics && s.reflections === rawSet.reflections) return;
    rawSet.renderScale = s.renderScale; rawSet.bloom = s.bloom; rawSet.ao = s.ao; rawSet.antialias = s.antialias;
    rawSet.filmGrain = s.filmGrain; rawSet.vignette = s.vignette;
    rawSet.volumetrics = s.volumetrics; rawSet.reflections = s.reflections;
    const prev = postSet.renderScale;
    postSet = normPostSettings(s);
    if (post) post.configure(postSet, q);
    if (postSet.renderScale !== prev) {
      const target = postSet.renderScale === 'auto' ? renderScale : postSet.renderScale;
      if (postSet.renderScale === 'auto') dyn.reset(renderScale);
      if (target !== renderScale) { renderScale = target; resize(); }
    }
  }

  function renderViewmodel(frame) {
    try {
      if (typeof vm.render === 'function') {
        vm.render(renderer, frame);
      } else if (vm.scene && vm.camera) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(vm.scene, vm.camera);
        renderer.autoClear = true;
      }
    } catch (err) {
      renderer.autoClear = true;
      logErr('viewmodel pass', err);
    }
  }

  function addEvents(events, opts = {}) {
    if (destroyed || !events || !events.length) return;
    // sub-systems may assume well-formed events; drop junk without allocating normally
    for (let i = 0; i < events.length; i++) {
      if (!events[i] || typeof events[i] !== 'object') { events = events.filter((e) => e && typeof e === 'object'); break; }
    }
    const lid = opts.localId ?? localId;
    try {
      for (const e of events) {
        // recoil kick on our own shots (predicted ones included, echoes never)
        if (e && e.type === 'shot' && e.pid === lid && lid && !e.echo) {
          const w = WEAPONS[e.weapon];
          const r = w ? w.recoil || 0.1 : 0.1;
          rig.kick = Math.min(0.09, rig.kick + r * 0.05 * (lastSettings.screenShake === false ? 0.5 : 1));
        }
      }
    } catch (err) {
      logErr('addEvents', err);
    }
    for (const s of subs) {
      if (typeof s.addEvents !== 'function') continue;
      try { s.addEvents(events, opts); } catch (err) { logErr('addEvents ' + s.__name, err); }
    }
  }

  const _ray = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _hit = new THREE.Vector3();

  const api = {
    mode: 'fps',
    render,
    addEvents,
    /** Ground point under a screen point (CSS px); along the view when it misses the ground. */
    screenToWorld(sx, sy) {
      _ndc.set((sx / cssW) * 2 - 1, -(sy / cssH) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      if (_ray.ray.intersectPlane(_plane, _hit) && _hit.distanceTo(camera.position) < far) return { x: _hit.x, y: _hit.z };
      const d = _ray.ray.direction;
      const l = Math.hypot(d.x, d.z) || 1;
      return { x: camera.position.x + (d.x / l) * 1000, y: camera.position.z + (d.z / l) * 1000 };
    },
    /** World point (sim x, y, height h) → overlay CSS px. */
    worldToScreen(x, y, h = 0) {
      return project(x, y, h);
    },
    getCamera() {
      return { x: camera.position.x, y: camera.position.z, yaw: rig.yaw };
    },
    resize,
    setQuality(nq) {
      const n = normQuality(nq);
      if (n === q) return;
      q = n;
      ctx.quality = n;
      lights.setQuality(n);
      for (const s of subs) {
        if (typeof s.setQuality !== 'function') continue;
        try { s.setQuality(n); } catch (err) { logErr('setQuality ' + s.__name, err); }
      }
      try { world.setQuality(n); } catch (err) { logErr('setQuality world', err); }
      if (post) post.configure(postSet, n);
      // a new tier has a new pixel-ratio cap: let dynamic resolution start over from full
      if (postSet.renderScale === 'auto') { renderScale = 1; dyn.reset(1); }
      resize();
    },
    get stats() { return stats; },
    /** Internals for dev tools / tests (not part of the SPEC API). */
    get debug() { return { renderer, scene, camera, world, lights, subs, ctx, createMs, post, settings: postSet }; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // three.js keeps one module-level DFG lookup texture for every MeshStandardMaterial;
      // each renderer that uploaded it hangs a dispose listener on it, which kept every
      // finished game's WebGLRenderer (and through it its scene) reachable. Find it while
      // the materials still carry their uniforms and dispose it at the end (it re-uploads).
      let dfgLut = null;
      scene.traverse((o) => {
        const m = o.material;
        if (dfgLut || !m || !m.isMeshStandardMaterial) return;
        const u = renderer.properties.get(m).uniforms;
        if (u && u.dfgLUT && u.dfgLUT.value && u.dfgLUT.value.isTexture) dfgLut = u.dfgLUT.value;
      });
      for (const s of subs) {
        try { s.dispose(); } catch (err) { logErr('dispose ' + s.__name, err); }
      }
      subs.length = 0;
      try { world.dispose(); } catch (err) { logErr('dispose world', err); }
      try { lights.dispose(); } catch (err) { logErr('dispose lights', err); }
      try { if (post) post.dispose(); } catch (err) { logErr('dispose post', err); }
      post = null;
      try { if (gpuTimer) gpuTimer.dispose(); } catch (err) { logErr('dispose gpu timer', err); }
      // anything a sub-system left behind (the viewmodel's own scene included)
      const seen = new Set();
      const leftovers = (o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          m.dispose();
        }
      };
      scene.traverse(leftovers);
      if (vm && vm.scene) { vm.scene.traverse(leftovers); vm.scene.clear(); }
      // module-level caches shared by every renderer: drop this renderer's GPU copies (and
      // its dispose listeners, which otherwise keep the whole renderer reachable)
      try {
        releaseSharedGuns();
        releaseFxAtlas();
        if (dfgLut) dfgLut.dispose();
      } catch (err) {
        logErr('release shared', err);
      }
      scene.clear();
      renderer.renderLists.dispose();
      renderer.resetState();
      renderer.dispose();
      overlayCanvas.remove();
    },
  };
  return api;
}
