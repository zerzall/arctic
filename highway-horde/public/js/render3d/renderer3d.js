// First-person 3D renderer (SPEC §7.5) — the public API, same shape as the top-down
// renderer (§7.1) so ui/match.js can use either. Owns the WebGLRenderer, scene, camera rig,
// fog, light pool (lights.js), static world (world.js → ground.js) and the 2D overlay
// canvas, and drives the sub-systems (zombies, players, items, effects, viewmodel,
// overlay) through the shared read-only `ctx`.
//
// Frame order: camera rig → sub-systems (they may register lights/decals) → world →
// light pool → world pass → viewmodel pass (depth cleared, own scene/camera) → stats.
// render() never throws: failures are caught and logged a few times.

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

const EYE = 52;
const EYE_DOWNED = 16;
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

/** The first `create*` function a sub-system module exports (tolerant of naming). */
function factoryOf(mod) {
  if (!mod) return null;
  for (const k of Object.keys(mod)) if (k.startsWith('create') && typeof mod[k] === 'function') return mod[k];
  return typeof mod.default === 'function' ? mod.default : null;
}

/**
 * Create the first-person renderer on `canvas`.
 * @param {HTMLCanvasElement} canvas
 * @param {{ map: object, quality?: 'high'|'low' }} opts
 */
export function createRenderer3D(canvas, { map, quality = 'high' } = {}) {
  let q = quality === 'low' ? 'low' : 'high';
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: q === 'high', alpha: false, stencil: false, powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.autoClear = true;

  const amb = ambientFor(map);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(amb.fog.getHex(), amb.fogDensity);
  scene.background = amb.fog.clone();
  const far = Math.hypot(map.width, map.height) + 1400;
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, NEAR, far);
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
    THREE, scene, camera, map, quality: q,
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

  const world = createWorld(ctx, { renderer, lights });
  ctx.ground.decal = world.ground.decal;

  // ---- sub-systems ----
  let errors = 0;
  const logErr = (where, err) => {
    if (errors++ < MAX_LOGS) console.error(`[renderer3d] ${where}:`, err);
  };
  const subs = [];
  let vm = null;
  for (const [name, mod] of [['zombies3d', zombiesMod], ['players3d', playersMod], ['items3d', itemsMod], ['effects3d', effectsMod], ['viewmodel', viewmodelMod], ['overlay', overlayMod]]) {
    const make = factoryOf(mod);
    if (!make) continue;
    try {
      const sys = make(ctx);
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
  };
  let lastSettings = { screenShake: true, fov: 80 };
  let localId = 0;
  let fov = 80;
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
      if (rig.mode !== 'fps') { rig.lastX = NaN; rig.mode = 'fps'; }
      const downed = local.state === 'downed';
      const dx = local.x - rig.lastX, dy = local.y - rig.lastY;
      const moved = Number.isFinite(dx) ? Math.hypot(dx, dy) : 0;
      rig.lastX = local.x; rig.lastY = local.y;
      const inst = dt > 0 && moved < 60 ? moved / dt : 0;
      rig.speed += (inst - rig.speed) * (1 - Math.exp(-dt * 10));
      const sp = Math.min(1.6, rig.speed / 190);
      rig.bob += dt * rig.speed * (local.sprinting ? 0.05 : 0.056);
      const targetEye = downed ? EYE_DOWNED : EYE;
      rig.eye += (targetEye - rig.eye) * (1 - Math.exp(-dt * 6));
      const amp = downed ? 0.6 : (local.sprinting ? 2.3 : 1.4) * Math.min(1, sp);
      const bobY = Math.abs(Math.sin(rig.bob)) * amp - amp * 0.5;
      const bobX = Math.cos(rig.bob) * amp * 0.45;
      const yaw = look.yaw, pitch = look.pitch;
      const rx = Math.cos(yaw + Math.PI / 2), ry = Math.sin(yaw + Math.PI / 2);
      camera.position.set(local.x + rx * bobX, rig.eye + bobY, local.y + ry * bobX);
      const rollT = downed ? 0.22 + Math.sin(rig.time * 0.7) * 0.03 : Math.cos(rig.bob) * 0.006 * sp;
      rig.roll += (rollT - rig.roll) * (1 - Math.exp(-dt * 5));
      camera.rotation.set(pitch + rig.kick, -yaw - Math.PI / 2, rig.roll);
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
        tx = target.x - Math.cos(a) * 150; ty = target.y - Math.sin(a) * 150; th = 96;
        lx = target.x + Math.cos(a) * 60; ly = target.y + Math.sin(a) * 60; lh = 40;
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
    const f = Math.max(60, Math.min(110, Number(settings.fov) || 80));
    if (f !== fov || camera.fov !== f) { fov = f; camera.fov = f; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  // ---- sizing ----
  function pixelRatio() {
    const d = window.devicePixelRatio || 1;
    return q === 'high' ? Math.min(d, 1.5) : Math.min(d, 1) * 0.75;
  }
  function resize() {
    if (destroyed) return;
    cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(cssW, cssH, false);
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

  // ---- stats ----
  // jsMs = whole render() call; updateMs = scene updates (sub-systems, world, lights);
  // submitMs = three.js render calls (draw submission; includes driver time on software GL)
  const stats = { drawCalls: 0, triangles: 0, jsMs: 0, updateMs: 0, submitMs: 0, fps: 0, lights: 0, staticTriangles: 0, frames: 0 };
  let fpsAcc = 0, fpsN = 0, jsAvg = 0, updAvg = 0, subAvg = 0;

  function render(view, opts = {}) {
    if (destroyed) return;
    const t0 = performance.now();
    try {
      localId = opts.localId || 0;
      const dt = Math.max(0, Math.min(0.1, Number(opts.dt) || 0));
      const settings = opts.settings || lastSettings;
      lastSettings = settings;
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
      renderer.render(scene, camera);
      if (vm) renderViewmodel(frame);
      const t2 = performance.now();
      updAvg += (t1 - t0 - updAvg) * 0.1;
      subAvg += (t2 - t1 - subAvg) * 0.1;
      stats.updateMs = Math.round(updAvg * 100) / 100;
      stats.submitMs = Math.round(subAvg * 100) / 100;

      const info = renderer.info.render;
      stats.drawCalls = info.calls;
      stats.triangles = info.triangles;
      stats.lights = lights.activeCount;
      stats.staticTriangles = world.stats.staticTriangles;
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
      const n = nq === 'low' ? 'low' : 'high';
      if (n === q) return;
      q = n;
      ctx.quality = n;
      lights.setQuality(n);
      for (const s of subs) {
        if (typeof s.setQuality !== 'function') continue;
        try { s.setQuality(n); } catch (err) { logErr('setQuality ' + s.__name, err); }
      }
      resize();
    },
    get stats() { return stats; },
    /** Internals for dev tools / tests (not part of the SPEC API). */
    get debug() { return { renderer, scene, camera, world, lights, subs, ctx }; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const s of subs) {
        try { s.dispose(); } catch (err) { logErr('dispose ' + s.__name, err); }
      }
      subs.length = 0;
      try { world.dispose(); } catch (err) { logErr('dispose world', err); }
      try { lights.dispose(); } catch (err) { logErr('dispose lights', err); }
      // anything a sub-system left behind
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
          m.dispose();
        }
      });
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      overlayCanvas.remove();
    },
  };
  return api;
}
