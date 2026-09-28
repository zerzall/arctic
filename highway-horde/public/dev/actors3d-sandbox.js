// ACTORS sandbox: drives zombies3d / players3d / items3d / effects3d / viewmodel / overlay
// against fixture scenes. Uses WORLD's createRenderer3D when it exists (and ?ctx=stub is
// not given); otherwise builds a minimal ctx itself (SPEC §7.5 ctx contract) so the actor
// sub-systems can be developed and screenshot on their own.
//
// URL: ?mode=lineup|horde|team|guns|fx|closeup  &yaw= &pitch= &x= &y= &weapon=  &q=ultra|high|low
//      &shot=1 (hide HUD)  &zombies=N (horde size)  &studio=1 (stub: inspection lighting)
//      closeup: &types=walker,runner &dist= &spacing= &anim=walk|idle|attack|burn|die|hit &face=
//      &time=<s> (fast-forward the fixture before the first frame)  &ctx=stub

import * as THREE from 'three';
import { createFixtureMap, createFixtureScene } from './render-fixtures.js';
import { ZOMBIE_IDS, ZFLAG, ZOMBIES } from '../js/shared/zombies.js';
import { WEAPONS, WEAPON_IDS } from '../js/shared/weapons.js';
import { CLASS_IDS } from '../js/shared/classes.js';
import { PICKUP_KINDS } from '../js/shared/items.js';
import { jumpHeight } from '../js/shared/jump.js';
import { JUMP_TIME } from '../js/shared/constants.js';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const statsEl = document.getElementById('stats');
if (qs.get('shot')) document.body.classList.add('shot');
let mode = qs.get('mode') || 'lineup';
document.getElementById('mode').value = mode;
let quality = qs.get('q') === 'low' || qs.get('q') === 'ultra' ? qs.get('q') : 'high';

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
  const studio = !!qs.get('studio');
  scene.add(new THREE.HemisphereLight('#5a6a90', '#2a2a20', studio ? 1.1 : 1.4));
  const moon = new THREE.DirectionalLight('#9ab0e0', studio ? 1.6 : 0.5);
  moon.position.set(-600, 900, -400);
  scene.add(moon);
  if (studio) {
    // inspection lighting: a warm key from behind the camera and a cool rim from behind
    const keyL = new THREE.DirectionalLight('#ffe6cc', 2.4);
    keyL.position.set(map.objective.x + 600, 700, map.objective.y + 1400);
    keyL.target.position.set(map.objective.x, 0, map.objective.y);
    scene.add(keyL, keyL.target);
    const rimL = new THREE.DirectionalLight('#8fb0ff', 1.6);
    rimL.position.set(map.objective.x - 300, 500, map.objective.y - 1400);
    rimL.target.position.set(map.objective.x, 0, map.objective.y);
    scene.add(rimL, rimL.target);
    scene.background = new THREE.Color('#1a2130');
    scene.fog.density = 0.0004;
  }
  const flashlight = new THREE.SpotLight('#fff2d8', studio ? 0 : 2.2, 1100, 0.55, 0.55, 0);
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

function closeupScene() {
  // a few zombies close to the camera for inspection
  //   &types=walker,runner  &dist=110  &anim=walk|idle|attack|burn|die|hit  &flags=<ZFLAG bits>  &face=<angle offset>
  const list = (qs.get('types') || 'walker,runner,crawler,bloater').split(',').filter((t) => ZOMBIES[t]);
  const dist = parseFloat(qs.get('dist') || '110');
  const anim = qs.get('anim') || 'walk';
  const face = parseFloat(qs.get('face') || '0');
  const flags0 = parseInt(qs.get('flags') || '0', 10) | (anim === 'burn' ? ZFLAG.BURNING : 0) | (anim === 'attack' ? ZFLAG.ATTACKING : 0);
  const local = fixturePlayer(1, 'soldier', 'rifle');
  local.x = cx; local.y = cy + 330;
  const spacing = parseFloat(qs.get('spacing') || '40');
  let id = 100;
  const zombies = list.map((t, k) => ({ id: id++ * 7 + k, type: t, x: local.x + (k - (list.length - 1) / 2) * spacing * (t === 'boss' ? 2 : t === 'brute' ? 1.4 : 1),
    y: local.y - dist * (t === 'boss' ? 1.7 : 1), angle: Math.PI / 2 + face, hp: 1, flags: flags0, _spd: anim === 'idle' || anim === 'attack' ? 0 : ZOMBIES[t].speed[0] }));
  let time = 0, dieT = 0;
  return {
    localId: 1, roster: [{ id: 1, name: 'You', color: 0, cls: 'soldier' }], local, yaw: -Math.PI / 2,
    step(dt) {
      time += dt;
      const events = [];
      if (anim === 'attack' && Math.floor(time / 1.1) !== Math.floor((time - dt) / 1.1)) {
        for (const z of zombies) events.push({ type: 'zattack', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: z.angle });
      }
      if (anim === 'hit' && Math.floor(time / 0.7) !== Math.floor((time - dt) / 0.7)) {
        events.push({ type: 'shot', pid: 1, turret: 0, weapon: 'rifle', x: local.x, y: local.y, angle: -Math.PI / 2, rays: zombies.map((z) => ({ x: z.x, y: z.y, hit: 1 })) });
      }
      if (anim === 'die') {
        dieT += dt;
        if (dieT > 2.5) {
          dieT = 0;
          for (const z of zombies) {
            events.push({ type: 'zdie', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: z.angle, by: 1, gib: false });
            z.id += 1000;
          }
        }
      }
      return { view: baseView([local], anim === 'die' && dieT > 0.02 && dieT < 2.5 ? [] : zombies), events };
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

function teamScene() {
  // every class in a row (walking, firing, sprinting, reloading, downed, dead) with every
  // item kind laid out in front of them
  const local = fixturePlayer(1, 'soldier', 'rifle');
  local.x = 1850; local.y = 1200;
  const home = { x: local.x, y: local.y };
  const weapons = ['rifle', 'uzi', 'shotgun', 'magnum', 'sawedoff', 'minigun'];
  const players = [local];
  CLASS_IDS.forEach((cls, k) => {
    const p = fixturePlayer(k + 2, cls, weapons[k]);
    p._k = k;
    players.push(p);
  });
  const roster = players.map((p, k) => ({ id: p.id, name: ['You', 'Hawk', 'Doc', 'Sparks', 'Swift', 'Boom', 'Tank'][k], color: k % 6, cls: k ? CLASS_IDS[k - 1] : 'soldier' }));
  const pickups = PICKUP_KINDS.map((kind, i) => ({ id: i + 1, kind, x: home.x - 150 + i * 60, y: home.y - 110, weapon: kind === 'crate' ? 'rocket' : null }));
  const turrets = [
    { id: 1, owner: 3, x: home.x - 250, y: home.y - 190, angle: -Math.PI / 2, hp: 0.9, ammo: 0.7, firing: false },
    { id: 2, owner: 3, x: home.x + 250, y: home.y - 190, angle: -Math.PI / 2, hp: 0.3, ammo: 0.1, firing: false },
  ];
  const barricades = [
    { id: 1, owner: 3, x: home.x - 130, y: home.y - 420, angle: 0, hp: 1 },
    { id: 2, owner: 3, x: home.x, y: home.y - 420, angle: 0, hp: 0.55 },
    { id: 3, owner: 2, x: home.x + 130, y: home.y - 420, angle: 0, hp: 0.2 },
  ];
  const hazards = [
    { id: 1, kind: 'fire', x: home.x - 330, y: home.y - 330, r: 110, life: 0.8 },
    { id: 2, kind: 'acid', x: home.x + 330, y: home.y - 330, r: 60, life: 0.9 },
  ];
  let time = 0;
  const projectiles = [];
  let nextP = 1;
  return {
    localId: 1, roster, local, yaw: -Math.PI / 2,
    step(dt) {
      time += dt;
      const events = [];
      players.forEach((p) => {
        if (p === local) return;
        const k = p._k;
        p.x = home.x + (k - 2.5) * 70;
        p.y = home.y - 260 + Math.sin(time * 0.8 + k) * 20;
        p.angle = (k % 2 ? -Math.PI / 2 : Math.PI / 2) + Math.sin(time * 0.5 + k) * 0.3;
        p.state = k === 4 ? 'downed' : k === 5 && (time % 8) > 4 ? 'dead' : 'alive';
        p.sprinting = k === 2;
        // the sprinter hops (jump height + tucked legs), with a short pause on the ground
        p.z = k === 2 ? jumpHeight(time % (JUMP_TIME + 0.25)) : 0;
        p.reloading = k === 3 ? (time % 2) / 2 : 0;
        p.bleedout = k === 4 ? 30 - (time % 30) : 0;
        p.revive = k === 4 ? (time % 3) / 3 : 0;
        p.hp = 20 + ((time * 10 + k * 17) % 80);
        p.spin = p.slots[1] === 'minigun' ? 1 : 0;
        p.meleeing = k === 1 && (time % 3) < 0.4 ? (time % 3) / 0.4 : 0;
        if (k === 0 && Math.floor(time * 10) !== Math.floor((time - dt) * 10)) {
          const a = p.angle;
          events.push({ type: 'shot', pid: p.id, turret: 0, weapon: 'rifle', x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22, angle: a,
            rays: [{ x: p.x + Math.cos(a) * 500, y: p.y + Math.sin(a) * 500, hit: 2 }] });
        }
      });
      // projectiles of every kind flying across
      if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) {
        const kinds = ['bolt', 'grenade', 'rocket', 'flame', 'frag', 'molotov', 'acid'];
        kinds.forEach((kind, i) => projectiles.push({ id: nextP++, kind, x: home.x - 400, y: home.y - 150 - i * 30, angle: 0, _v: kind === 'frag' || kind === 'molotov' ? 200 : 300 }));
      }
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const pr = projectiles[i];
        pr.x += Math.cos(pr.angle) * pr._v * dt;
        if (pr.x > home.x + 400) projectiles.splice(i, 1);
      }
      turrets[0].angle = -Math.PI / 2 + Math.sin(time) * 0.6;
      turrets[0].firing = (time % 1) < 0.5;
      if (turrets[0].firing && Math.floor(time * 8) !== Math.floor((time - dt) * 8)) {
        const t = turrets[0];
        events.push({ type: 'shot', pid: 0, turret: 1, weapon: 'rifle', x: t.x + Math.cos(t.angle) * 22, y: t.y + Math.sin(t.angle) * 22, angle: t.angle, rays: [{ x: t.x + Math.cos(t.angle) * 400, y: t.y + Math.sin(t.angle) * 400, hit: 0 }] });
      }
      return { view: baseView(players, [], { pickups, turrets, barricades, hazards, projectiles }), events };
    },
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
  else if (mode === 'team') scene = teamScene();
  else if (mode === 'guns') scene = hordeScene({ zombies: 60, localFires: false });
  else if (mode === 'fx') scene = teamScene();
  else if (mode === 'closeup') scene = closeupScene();
  else scene = hordeScene({ zombies: qs.get('zombies') !== null ? parseInt(qs.get('zombies'), 10) : 250 });
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
    wrapTiming(subs);
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
    wrapTiming(subs);
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
    fxManual: false,
    pause(v) { paused = v; },
    /** Fire showcase event #k at distance d in front of the camera. */
    fxAt(k, d = 300, side = 0) {
      const loc = scene.local;
      const x = loc.x + Math.cos(yaw) * d + Math.cos(yaw + Math.PI / 2) * side, y = loc.y + Math.sin(yaw) * d + Math.sin(yaw + Math.PI / 2) * side;
      const list = [
        { type: 'explosion', x, y, r: 150, kind: 'frag' },
        { type: 'chain', pid: 1, points: [{ x: loc.x, y: loc.y }, { x: x - 60, y: y + 30 }, { x, y: y - 20 }, { x: x + 80, y: y + 10 }, { x: x + 40, y: y + 90 }] },
        { type: 'shot', pid: 1, turret: 0, weapon: 'railgun', x: loc.x + Math.cos(yaw) * 22, y: loc.y + Math.sin(yaw) * 22, angle: yaw, rays: [{ x: x + Math.cos(yaw) * 600, y: y + Math.sin(yaw) * 600, hit: 1 }] },
        { type: 'ignite', x, y, r: 110 },
        { type: 'slam', id: 99, x, y, r: 190 },
        { type: 'explosion', x, y, r: 180, kind: 'rocket' },
        { type: 'drop', x, y },
        { type: 'explosion', x, y, r: 115, kind: 'bloater' },
        { type: 'destroyed', kind: 'turret', id: 3, x, y },
        { type: 'pickup', pid: 1, kind: 'health', x, y, weapon: null },
        { type: 'scream', id: 98, x, y },
        { type: 'zdie', id: 4242, ztype: 'brute', x, y, angle: yaw + Math.PI, by: 1, gib: true },
        { type: 'zdie', id: 4243, ztype: 'walker', x, y, angle: yaw + Math.PI, by: 1, gib: false },
        { type: 'shot', pid: 2, turret: 0, weapon: 'shotgun', x: x - 200, y: y + 100, angle: -0.4, rays: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ x: x + 40 + k * 8, y: y - 40 + k * 12, hit: k % 3 === 0 ? 1 : 2 })) },
        { type: 'shot', pid: 1, turret: 0, weapon: 'shotgun', x: loc.x + Math.cos(yaw) * 22, y: loc.y + Math.sin(yaw) * 22, angle: yaw, predicted: true, rays: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ x: x + (k - 3.5) * 14, y: y + (k % 3) * 10, hit: k % 3 === 0 ? 1 : 2 })) },
        { type: 'pdamage', pid: 1, amount: 25, x: loc.x + Math.cos(yaw + 2) * 50, y: loc.y + Math.sin(yaw + 2) * 50 },
      ];
      const e = list[k % list.length];
      R.addEvents([e], { localId: scene.localId });
      return e.type + (e.kind ? ':' + e.kind : '') + (e.weapon ? ':' + e.weapon : '');
    },
  };
  requestAnimationFrame(loop);
}

/** Per-sub-system update time (median of the last 60 frames, ms) → stats.subMs. */
const subSamples = {};
function wrapTiming(list) {
  for (const k in list) {
    const s = list[k];
    if (!s || typeof s.update !== 'function' || s.__timed) continue;
    const u = s.update;
    s.__timed = true;
    subSamples[k] = [];
    s.update = function timed(view, frame) {
      const t0 = performance.now();
      const r = u.call(this, view, frame);
      const a = subSamples[k];
      a.push(performance.now() - t0);
      if (a.length > 60) a.shift();
      return r;
    };
  }
}
function median(a) {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[b.length >> 1];
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
  quality = quality === 'ultra' ? 'high' : quality === 'high' ? 'low' : 'ultra';
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
  const res = paused ? { view: lastView, events: [] } : scene.step(step, yaw);
  lastView = res.view;
  loc.slots[1] = wid;
  loc.slot = 1;
  loc.angle = yaw;
  loc.spin = wid === 'minigun' ? 1 : 0;
  const events = res.events.slice();
  if (!paused && (mode === 'guns' || keys.has('f'))) fakeOwnShot(events, loc, wid, step);
  if (!paused) stepOwnProjectiles(res.view, step);
  if (!paused && mode === 'fx') fxShowcase(events, loc, step);
  if (events.length) R.addEvents(events, { localId: scene.localId });
  const r = R.render(res.view, {
    localId: scene.localId, roster: scene.roster, now, dt: paused ? 0 : step, yaw, pitch, local: loc, camX: loc.x, camY: loc.y,
    // uiScale as the game's UI passes it (≈ viewport height / 1000, 1 at small sizes)
    settings: { screenShake: true, showNames: true, fov: 80, lighting: true, uiScale: parseFloat(qs.get('ui') || '0') || Math.max(1, window.innerHeight / 1000) },
  });
  jsHist.push(r.jsMs);
  if (jsHist.length > 120) jsHist.shift();
  const jsAvg = jsHist.reduce((a, b) => a + b, 0) / jsHist.length;
  const s = { fps: +fps.toFixed(1), jsMs: +jsAvg.toFixed(2), calls: r.calls, tris: r.tris, stub: !!R.stub, zombies: res.view.zombies.length };
  if (subs.zombies && subs.zombies.stats) Object.assign(s, subs.zombies.stats);
  if (window.__SB) {
    s.subMs = {};
    for (const k in subSamples) s.subMs[k] = +median(subSamples[k]).toFixed(2);
    window.__SB.stats = s; window.__SB.frames++; window.__SB.raw = r.raw;
  }
  statsEl.textContent = `${mode} · ${s.fps} fps · js ${s.jsMs} ms · ${s.calls} calls · ${s.tris} tris · ${s.zombies} zombies${R.stub ? ' · stub ctx' : ''}`;
  requestAnimationFrame(loop);
}
let lastView = null;

// own shots: a predicted shot event every weapon cooldown (like the client session)
let ownCool = 0, ownSeq = 0;
// own projectiles (flame tongues, rockets, grenades, bolts): the server would put them in
// the snapshot; without them the flamethrower showed only its nozzle jet
const ownProj = [];
let ownProjId = 900000;
function stepOwnProjectiles(view, dt) {
  for (let i = ownProj.length - 1; i >= 0; i--) {
    const p = ownProj[i];
    p._life -= dt;
    p.x += Math.cos(p.angle) * p._v * dt;
    p.y += Math.sin(p.angle) * p._v * dt;
    if (p._life <= 0) ownProj.splice(i, 1);
  }
  if (ownProj.length) view.projectiles = (view.projectiles || []).concat(ownProj);
}
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
  } else if ((w.kind === 'flame' || w.kind === 'cryo' || w.kind === 'projectile') && w.projectile) {
    // the cooldown is capped at 14/s: emit the rest of a fast weapon's projectiles here
    const n = Math.max(1, Math.round(w.rate / Math.min(w.rate, 14)));
    for (let k = 0; k < n; k++) {
      ownProj.push({ id: ownProjId++, kind: w.projectile.kind, x: mx, y: my, angle: yaw + (Math.random() - 0.5) * 2 * w.spread,
        _v: w.projectile.speed * (w.kind === 'flame' ? 1 : 0.6), _life: w.projectile.life || 1 });
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
  if (window.__SB && window.__SB.fxManual) return;
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
