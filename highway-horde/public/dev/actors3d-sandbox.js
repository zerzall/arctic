// ACTORS sandbox: drives zombies3d / players3d / items3d / effects3d / viewmodel / overlay
// against fixture scenes. Uses WORLD's createRenderer3D when it exists (and ?ctx=stub is
// not given); otherwise builds a minimal ctx itself (SPEC §7.5 ctx contract) so the actor
// sub-systems can be developed and screenshot on their own.
//
// URL: ?mode=lineup|horde|team|guns|fx  &yaw= &pitch= &x= &y= &weapon=  &q=low  &shot=1 (hide HUD)
//      &time=<s> (fast-forward the fixture before the first frame)  &ctx=stub

import * as THREE from 'three';
import { createFixtureMap, createFixtureScene } from './render-fixtures.js';
import { ZOMBIE_IDS, ZFLAG, ZOMBIES } from '../js/shared/zombies.js';
import { WEAPONS, WEAPON_IDS } from '../js/shared/weapons.js';
import { CLASS_IDS } from '../js/shared/classes.js';
import { PICKUP_KINDS } from '../js/shared/items.js';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const statsEl = document.getElementById('stats');
if (qs.get('shot')) document.body.classList.add('shot');
let mode = qs.get('mode') || 'lineup';
document.getElementById('mode').value = mode;
let quality = qs.get('q') === 'low' ? 'low' : 'high';

const map = createFixtureMap('bus');

async function tryImport(path) {
  try { return await import(path); } catch (err) { console.warn('sandbox: missing', path, err.message); return null; }
}

// ---------------------------------------------------------------------------------------
// stub ctx (until/unless WORLD's renderer3d is used)

function createStubRenderer() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a1020');
  scene.fog = new THREE.FogExp2('#0d1626', 0.0011);
  const camera = new THREE.PerspectiveCamera(70, 1, 2, 6000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  scene.add(new THREE.HemisphereLight('#5a6a90', '#2a2a20', 1.4));
  const moon = new THREE.DirectionalLight('#9ab0e0', 0.5);
  moon.position.set(-600, 900, -400);
  scene.add(moon);
  const flashlight = new THREE.SpotLight('#fff2d8', 2.2, 1100, 0.55, 0.55, 0);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.camera.near = 10;
  flashlight.shadow.camera.far = 900;
  camera.add(flashlight);
  flashlight.position.set(8, -6, 0);
  flashlight.target.position.set(0, -20, -200);
  camera.add(flashlight.target);
  // ground: asphalt + verges
  const groundMat = new THREE.MeshLambertMaterial({ color: '#2a2c2e' });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.height), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.width / 2, 0, map.height / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(Math.max(map.width, map.height), 60, '#3a3d42', '#303336');
  grid.position.set(map.width / 2, 0.3, map.height / 2);
  scene.add(grid);
  // a few blocks so occlusion/fog read in screenshots
  const boxMat = new THREE.MeshLambertMaterial({ color: '#555b63' });
  for (const o of map.obstacles.slice(0, 30)) {
    const h = o.solid ? 60 : 26;
    const b = new THREE.Mesh(new THREE.BoxGeometry(o.w, h, o.h), boxMat);
    b.position.set(o.x, h / 2, o.y);
    b.rotation.y = -o.a;
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  }
  // light pool
  const pool = [];
  for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight('#ffffff', 0, 300, 1.6);
    scene.add(l);
    pool.push(l);
  }
  const flashes = [], steadies = new Map();
  const lights = {
    flash(x, y, h, color, intensity, radius, life) { flashes.push({ x, y, h, color, intensity, radius, life, age: 0 }); if (flashes.length > 40) flashes.shift(); },
    steady(key, x, y, h, color, intensity, radius) { steadies.set(key, { x, y, h, color, intensity, radius }); },
  };
  function updateLights(dt) {
    const srcs = [];
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.age += dt;
      if (f.age > f.life) { flashes.splice(i, 1); continue; }
      srcs.push({ ...f, k: 1 - f.age / f.life });
    }
    for (const s of steadies.values()) srcs.push({ ...s, k: 1 });
    steadies.clear();
    const cx = camera.position.x, cz = camera.position.z;
    srcs.sort((a, b) => ((a.x - cx) ** 2 + (a.y - cz) ** 2) - ((b.x - cx) ** 2 + (b.y - cz) ** 2));
    for (let i = 0; i < pool.length; i++) {
      const s = srcs[i], l = pool[i];
      if (!s) { l.intensity = 0; continue; }
      l.position.set(s.x, s.h, s.y);
      l.color.set(s.color);
      l.distance = s.radius * 1.3;
      l.intensity = s.intensity * s.k * 2.5;
      l.decay = 0;
    }
  }
  // ground decals: small flat discs (pooled)
  const decalGeo = new THREE.CircleGeometry(1, 12);
  decalGeo.rotateX(-Math.PI / 2);
  const decalCols = { blood: '#4a0808', scorch: '#0c0b0a', acid: '#3a6a10', oil: '#060606', gore: '#5a0a0a' };
  const decals = [];
  const ground2 = {
    decal(kind, x, y, r, angle, alpha) {
      const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ color: decalCols[kind] || '#400', transparent: true, opacity: 0.8 * (alpha ?? 1), depthWrite: false }));
      m.position.set(x, 0.5 + decals.length * 0.001, y);
      m.scale.set(r * 1.4, 1, r);
      m.rotation.y = -(angle || 0);
      scene.add(m);
      decals.push(m);
      if (decals.length > 200) { const d = decals.shift(); d.removeFromParent(); d.material.dispose(); }
    },
  };
  // overlay canvas
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none';
  canvas.after(overlayCanvas);
  const overlay = overlayCanvas.getContext('2d');
  const _v = new THREE.Vector3();
  let cssW = 1, cssH = 1;
  const ctx = {
    THREE, scene, camera, map, quality, overlay,
    lights, ground: ground2,
    project(x, y, h) {
      _v.set(x, h, y).project(camera);
      return { x: (_v.x * 0.5 + 0.5) * cssW, y: (-_v.y * 0.5 + 0.5) * cssH, visible: _v.z < 1 && _v.z > -1 };
    },
    shake: (a) => { shakeAmt = Math.max(shakeAmt, a); },
    heightOf: () => 44,
    rng: Math.random,
  };
  let shakeAmt = 0;
  function resize() {
    cssW = window.innerWidth; cssH = window.innerHeight;
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    overlayCanvas.width = cssW * dpr; overlayCanvas.height = cssH * dpr;
    overlay.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
  const subs = [];
  let viewmodel = null;
  return {
    ctx, renderer,
    stub: true,
    attach(sub, isVm) { if (isVm) viewmodel = sub; subs.push(sub); },
    render(view, o) {
      const loc = o.local;
      const eye = loc ? (loc.state === 'downed' ? 16 : 52) : 52;
      camera.position.set(o.camX, eye, o.camY);
      camera.rotation.set(o.pitch, -o.yaw - Math.PI / 2, 0, 'YXZ');
      if (shakeAmt > 0) {
        camera.rotation.x += (Math.random() - 0.5) * shakeAmt * 0.05;
        camera.rotation.y += (Math.random() - 0.5) * shakeAmt * 0.05;
        shakeAmt = Math.max(0, shakeAmt - o.dt * 2.5);
      }
      camera.updateMatrixWorld();
      const frame = { dt: o.dt, now: o.now, localId: o.localId, roster: o.roster, local: loc, camX: o.camX, camY: o.camY, yaw: o.yaw, pitch: o.pitch, settings: o.settings };
      overlay.save(); overlay.setTransform(1, 0, 0, 1, 0, 0); overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height); overlay.restore();
      const t0 = performance.now();
      for (const s of subs) s.update(view, frame);
      updateLights(o.dt);
      const t1 = performance.now();
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.clear();
      renderer.render(scene, camera);
      if (viewmodel && viewmodel.scene) {
        renderer.clearDepth();
        renderer.render(viewmodel.scene, viewmodel.camera);
      }
      return { jsMs: t1 - t0, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    },
    addEvents(events, opts) { for (const s of subs) if (s.addEvents) s.addEvents(events, opts); },
    setQuality(q) { for (const s of subs) if (s.setQuality) s.setQuality(q); },
  };
}

// ---------------------------------------------------------------------------------------
// fixture scenes

const TAU = Math.PI * 2;
const cx = map.objective.x, cy = map.objective.y + map.objective.h / 2 + 110;

function lineupScene() {
  // every type walking toward the camera on a treadmill, flags on the second row
  const zombies = [];
  let id = 1;
  const types = ZOMBIE_IDS;
  types.forEach((t, k) => {
    zombies.push({ id: id++, type: t, x: 0, y: 0, angle: 0, hp: 1, flags: 0, _lane: k, _row: 0 });
  });
  const flagRow = [
    ['walker', ZFLAG.BURNING], ['runner', ZFLAG.ATTACKING], ['brute', ZFLAG.CHARGING], ['walker', ZFLAG.BUFFED],
    ['spitter', ZFLAG.ELITE], ['screamer', 0], ['bloater', ZFLAG.BUFFED | ZFLAG.BURNING], ['crawler', ZFLAG.BURNING | ZFLAG.ELITE],
  ];
  flagRow.forEach(([t, f], k) => zombies.push({ id: id++, type: t, x: 0, y: 0, angle: 0, hp: 1, flags: f, _lane: k, _row: 1 }));
  let time = 0;
  const local = fixturePlayer(1, 'soldier', 'rifle');
  local.x = cx; local.y = cy + 330;
  const home = { x: local.x, y: local.y };
  return {
    localId: 1,
    roster: [{ id: 1, name: 'You', color: 0, cls: 'soldier' }],
    local,
    yaw: -Math.PI / 2,
    step(dt) {
      time += dt;
      const events = [];
      for (const z of zombies) {
        const lane = (z._lane - 3.5) * (z._row ? 50 : 62);
        const sp = ZOMBIES[z.type].speed[0] * 0.5;
        const len = 160;
        const d = ((time * sp + z._lane * 23) % len);
        z.x = home.x + lane;
        z.y = home.y - (z._row ? 170 : 330) - (len - d) * 0.25;
        z.angle = Math.PI / 2;
        if (z.type === 'screamer' && z._row === 1 && Math.floor(time * 60) % 180 === 0) events.push({ type: 'scream', id: z.id, x: z.x, y: z.y });
        if (z.flags & ZFLAG.ATTACKING && Math.floor(time * 60) % 50 === 0) events.push({ type: 'zattack', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: z.angle });
        if (z.type === 'boss' && z._row === 1 && Math.floor(time * 60) % 200 === 100) events.push({ type: 'slam', id: z.id, x: z.x, y: z.y, r: 190 });
      }
      return { view: baseView([local], zombies), events };
    },
  };
}

function fixturePlayer(id, cls, weapon) {
  return {
    id, x: cx, y: cy, angle: -Math.PI / 2, state: 'alive', hp: 80, maxHp: 100, armor: 20, stamina: 100, sprinting: false,
    slot: 1, slots: ['pistol', weapon, null], ammo: [[12, -1], [20, 100], [0, 0]], reloading: 0, spin: 0, firing: false, meleeing: 0,
    cash: 500, kills: 0, damage: 0, revives: 0, downs: 0, frags: 2, molotovs: 1, turrets: 0, barricades: 0, selfRevive: false,
    bleedout: 0, revive: 0, reviver: 0, respawn: false, ready: false, lastSeq: 0,
  };
}

function baseView(players, zombies, extra = {}) {
  return {
    tick: 0, phase: 'wave', wave: 5, totalWaves: 15, timer: 0, remaining: zombies.length, bossHp: -1,
    objective: { hp: 4000, maxHp: 5000 }, readyCount: 0,
    players, zombies, projectiles: [], pickups: [], turrets: [], barricades: [], hazards: [], events: [],
    ...extra,
  };
}

function hordeScene(opts) {
  const f = createFixtureScene(map, { zombies: opts.zombies ?? 250, seed: 7, localFires: opts.localFires ?? true });
  return {
    localId: 1,
    roster: f.roster,
    local: f.local,
    yaw: opts.yaw ?? -Math.PI / 2,
    step(dt, aim) {
      const r = f.step(dt, aim);
      return r;
    },
  };
}

// ---------------------------------------------------------------------------------------

let R = null;
const subs = {};
let scene = null;
let yaw = parseFloat(qs.get('yaw') || 'NaN');
let pitch = parseFloat(qs.get('pitch') || '0');
let weaponIdx = Math.max(0, WEAPON_IDS.indexOf(qs.get('weapon') || 'rifle'));
let paused = false;
let now = 0;

function buildScene() {
  if (mode === 'lineup') scene = lineupScene();
  else if (mode === 'team') scene = hordeScene({ zombies: 40, yaw: Math.PI / 2 });
  else if (mode === 'guns') scene = hordeScene({ zombies: 60, localFires: false });
  else if (mode === 'fx') scene = hordeScene({ zombies: 60 });
  else scene = hordeScene({ zombies: 250 });
  if (!Number.isFinite(yaw)) yaw = scene.yaw;
}

async function main() {
  const useStub = qs.get('ctx') === 'stub';
  const r3 = useStub ? null : await tryImport('../js/render3d/renderer3d.js');
  if (r3 && r3.createRenderer3D) {
    const r = r3.createRenderer3D(canvas, { map, quality });
    R = {
      real: r,
      stub: false,
      render(view, o) {
        const t0 = performance.now();
        r.render(view, { localId: o.localId, roster: o.roster, now: o.now, dt: o.dt, look: { yaw: o.yaw, pitch: o.pitch }, settings: o.settings });
        const t1 = performance.now();
        const st = r.stats || {};
        return { jsMs: st.frameMs ?? st.jsMs ?? (t1 - t0), calls: st.calls ?? st.drawCalls, tris: st.triangles ?? st.tris, raw: st };
      },
      addEvents: (ev, o) => r.addEvents(ev, o),
      setQuality: (q) => r.setQuality(q),
    };
    const names = { zombies3d: 'zombies', players3d: 'players', items3d: 'items', effects3d: 'effects', viewmodel: 'viewmodel', overlay: 'overlay' };
    for (const s of (r.debug && r.debug.subs) || []) subs[names[s.__name] || s.__name] = s;
  } else {
    R = createStubRenderer();
    const ctx = R.ctx;
    ctx.quality = quality;
    const mods = [
      ['zombies', '../js/render3d/zombies3d.js', 'createZombies3D'],
      ['players', '../js/render3d/players3d.js', 'createPlayers3D'],
      ['items', '../js/render3d/items3d.js', 'createItems3D'],
      ['effects', '../js/render3d/effects3d.js', 'createEffects3D'],
      ['viewmodel', '../js/render3d/viewmodel.js', 'createViewmodel'],
      ['overlay', '../js/render3d/overlay.js', 'createOverlay3D'],
    ];
    for (const [key, path, fn] of mods) {
      const m = await tryImport(path);
      if (m && m[fn]) {
        subs[key] = m[fn](ctx);
        R.attach(subs[key], key === 'viewmodel');
      }
    }
  }
  buildScene();
  scene.local.x += parseFloat(qs.get('dx') || '0');
  scene.local.y += parseFloat(qs.get('dy') || '0');
  const t = parseFloat(qs.get('time') || '0');
  for (let k = 0; k < t * 30; k++) {
    const res = scene.step(1 / 30, null);
    now += 1 / 30;
    if (res.events.length) R.addEvents(res.events, { localId: scene.localId });
  }
  window.__SB = {
    R, subs, stats: {}, setMode, ready: true, frames: 0,
    setWeapon(id) { weaponIdx = Math.max(0, WEAPON_IDS.indexOf(id)); },
    setLook(y, p) { yaw = y; pitch = p; },
    local: () => scene.local,
    fire(on) { if (on) keys.add('f'); else keys.delete('f'); },
    events(list) { R.addEvents(list, { localId: scene.localId }); },
  };
  requestAnimationFrame(loop);
}

function setMode(m) {
  mode = m;
  yaw = NaN;
  buildScene();
}

// input
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === 'p') paused = !paused;
  if (/^[1-9]$/.test(e.key)) weaponIdx = (parseInt(e.key, 10) - 1) % WEAPON_IDS.length;
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw += (e.clientX - drag.x) * 0.004;
  pitch = Math.max(-1.35, Math.min(1.35, pitch - (e.clientY - drag.y) * 0.004));
  drag = { x: e.clientX, y: e.clientY };
});
document.getElementById('mode').addEventListener('change', (e) => setMode(e.target.value));
document.getElementById('quality').addEventListener('click', (e) => {
  quality = quality === 'high' ? 'low' : 'high';
  e.target.textContent = 'quality: ' + quality;
  R.setQuality(quality);
});
document.getElementById('weapon').addEventListener('click', () => { weaponIdx = (weaponIdx + 1) % WEAPON_IDS.length; });
document.getElementById('pause').addEventListener('click', () => { paused = !paused; });

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fps = 0;
const jsHist = [];
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  const step = qs.get('fixed') ? 1 / 60 : dt;
  if (!paused) now += step;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const loc = scene.local;
  // WASD in look space
  const fw = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0), st = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  if (fw || st) {
    loc.x += (Math.cos(yaw) * fw + Math.cos(yaw + Math.PI / 2) * st) * 190 * step;
    loc.y += (Math.sin(yaw) * fw + Math.sin(yaw + Math.PI / 2) * st) * 190 * step;
  }
  // viewmodel cycling / weapon choice for the local record
  let wid = WEAPON_IDS[weaponIdx];
  if (mode === 'guns') wid = WEAPON_IDS[Math.floor(now / 2.5) % WEAPON_IDS.length];
  loc.slots[1] = wid;
  loc.slot = 1;
  const res = paused ? { view: lastView, events: [] } : scene.step(step, yaw);
  lastView = res.view;
  loc.angle = yaw;
  loc.spin = wid === 'minigun' ? 1 : 0;
  const events = res.events.slice();
  if (!paused && (mode === 'guns' || keys.has('f'))) fakeOwnShot(events, loc, wid, step);
  if (!paused && mode === 'fx') fxShowcase(events, loc, step);
  if (events.length) R.addEvents(events, { localId: scene.localId });
  const r = R.render(res.view, {
    localId: scene.localId, roster: scene.roster, now, dt: step, yaw, pitch, local: loc, camX: loc.x, camY: loc.y,
    settings: { screenShake: true, showNames: true, fov: 80, lighting: true },
  });
  jsHist.push(r.jsMs);
  if (jsHist.length > 120) jsHist.shift();
  const jsAvg = jsHist.reduce((a, b) => a + b, 0) / jsHist.length;
  const s = { fps: +fps.toFixed(1), jsMs: +jsAvg.toFixed(2), calls: r.calls, tris: r.tris, stub: !!R.stub, zombies: res.view.zombies.length };
  if (subs.zombies && subs.zombies.stats) Object.assign(s, subs.zombies.stats);
  if (window.__SB) { window.__SB.stats = s; window.__SB.frames++; window.__SB.raw = r.raw; }
  statsEl.textContent = `${mode} · ${s.fps} fps · js ${s.jsMs} ms · ${s.calls} calls · ${s.tris} tris · ${s.zombies} zombies${R.stub ? ' · stub ctx' : ''}`;
  requestAnimationFrame(loop);
}
let lastView = null;

// own shots: a predicted shot event every weapon cooldown (like the client session)
let ownCool = 0, ownSeq = 0;
function fakeOwnShot(events, loc, wid, dt) {
  const w = WEAPONS[wid];
  ownCool -= dt;
  const reloading = loc.reloading > 0;
  if (reloading) {
    loc.reloading = Math.min(1, loc.reloading + dt / w.reload);
    if (loc.reloading >= 1) { loc.reloading = 0; loc.ammo[1][0] = w.mag; }
    return;
  }
  if (ownCool > 0) return;
  ownCool = 1 / Math.min(w.rate, 14);
  if (loc.ammo[1][0] <= 0) {
    loc.reloading = 0.001;
    events.push({ type: 'reload', pid: loc.id, weapon: wid, time: w.reload });
    return;
  }
  loc.ammo[1][0] = Math.max(0, (loc.ammo[1][0] || w.mag) - 1);
  loc.firing = true;
  const mx = loc.x + Math.cos(yaw) * 22, my = loc.y + Math.sin(yaw) * 22;
  const ev = { type: 'shot', pid: loc.id, turret: 0, weapon: wid, x: mx, y: my, angle: yaw, rays: [], predicted: ++ownSeq > 0 };
  if (w.kind === 'hitscan' || w.kind === 'rail') {
    for (let k = 0; k < w.pellets; k++) {
      const a = yaw + (Math.random() - 0.5) * 2 * w.spread;
      const d = w.kind === 'rail' ? 1400 : 300 + Math.random() * 500;
      ev.rays.push({ x: mx + Math.cos(a) * d, y: my + Math.sin(a) * d, hit: Math.random() < 0.4 ? 1 : 2 });
    }
  } else if (w.kind === 'chain') {
    const pts = [{ x: mx, y: my }];
    for (let k = 1; k < 5; k++) pts.push({ x: mx + Math.cos(yaw) * 120 * k + (Math.random() - 0.5) * 90, y: my + Math.sin(yaw) * 120 * k + (Math.random() - 0.5) * 90 });
    events.push({ type: 'chain', pid: loc.id, points: pts });
  }
  events.push(ev);
}

// effect showcase: a rotating program of events in front of the camera
let fxT = 0, fxK = 0;
function fxShowcase(events, loc, dt) {
  fxT -= dt;
  if (fxT > 0) return;
  fxT = 0.9;
  const d = 260 + (fxK % 3) * 60;
  const x = loc.x + Math.cos(yaw) * d + (((fxK * 37) % 5) - 2) * 50, y = loc.y + Math.sin(yaw) * d;
  const list = [
    { type: 'explosion', x, y, r: 150, kind: 'frag' },
    { type: 'chain', pid: 2, points: [{ x: x - 150, y }, { x: x - 60, y: y + 30 }, { x, y: y - 20 }, { x: x + 80, y: y + 10 }] },
    { type: 'shot', pid: 2, turret: 0, weapon: 'railgun', x: x - 300, y: y + 60, angle: 0, rays: [{ x: x + 400, y: y - 60, hit: 1 }] },
    { type: 'ignite', x, y, r: 110 },
    { type: 'slam', id: 99, x, y, r: 190 },
    { type: 'explosion', x, y, r: 180, kind: 'rocket' },
    { type: 'drop', x, y },
    { type: 'explosion', x, y, r: 115, kind: 'bloater' },
    { type: 'destroyed', kind: 'turret', id: 3, x, y },
    { type: 'pickup', pid: 1, kind: 'health', x, y, weapon: null },
    { type: 'scream', id: 98, x, y },
  ];
  events.push(list[fxK % list.length]);
  fxK++;
}

main();
