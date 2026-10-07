// Gun materials lab (dev tool): the real gun models (actor-guns.js) in the real gun material
// (gun-mat.js, the baked textures of gun-tex.js) laid out in a grid and lit by a preset, for
// reviewing the material families and the skins without building a map.
//
// URL params:
//   q=low|high|ultra|cinematic   tier (low: the procedural atlas; guntex=0 also keeps it: the look before the bake)
//   light=day|night|indoor       the lighting preset (sun + sky probe / moon + flashlight + fire / lamps in a room)
//   guns=rifle,pistol,... | all  the guns in the grid (default: a handful)
//   skin=<id> | lineup           the skin on every gun, or one gun (weapon=<id>) in every skin
//   weapon=<id>                  the gun of a skin lineup
//   cols=N, zoom=<k>, yaw=<rad>, pitch=<rad>   layout and view; clean=1 hides the readout
// window.__lab: { ready (textures in and a frame drawn), stats() }.

import * as THREE from 'three';
import { WEAPON_IDS, WEAPONS } from '../js/shared/weapons.js';
import { GUN_SKINS, sanitizeSkin } from '../js/shared/gun-finish.js';
import { gunObject, gunModel, gunMaterials, createGunMaterial, setGunDetail, setGunTier, setGunMaterialModel, upgradeGunAtlas } from '../js/render3d/actor-guns.js';
import { gunTexStats } from '../js/render3d/gun-tex.js';
import { TIERS, tierAtLeast } from '../js/render3d/tier.js';

const P = new URLSearchParams(location.search);
const q = TIERS.includes(P.get('q')) ? P.get('q') : 'ultra';
const light = ['day', 'night', 'indoor'].includes(P.get('light')) ? P.get('light') : 'day';
const lineup = P.get('skin') === 'lineup';
const skinAll = lineup ? null : sanitizeSkin(P.get('skin'));
let guns = (P.get('guns') || 'rifle,pistol,shotgun,magnum,sniper,lmg').split(',').filter((g) => WEAPONS[g]);
if (P.get('guns') === 'all') guns = WEAPON_IDS.slice();
const weapon = WEAPONS[P.get('weapon')] ? P.get('weapon') : 'rifle';
const items = lineup ? GUN_SKINS.map((s) => ({ id: weapon, skin: s.id, label: s.name })) : guns.map((id) => ({ id, skin: skinAll, label: WEAPONS[id].name }));
const cols = Number(P.get('cols')) || (items.length <= 3 ? items.length : items.length <= 8 ? 2 : items.length <= 12 ? 3 : 4);
if (P.get('clean') === '1') document.body.classList.add('clean');

const canvas = document.getElementById('c');
const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = light === 'day' ? 1.05 : 1.2;

const high = q !== 'low';
setGunDetail(high, q === 'cinematic');
setGunTier(q, { maxAniso: renderer.capabilities.getMaxAnisotropy() });
if (q === 'cinematic') upgradeGunAtlas().catch(() => {});

// ---- the probe: a little world rendered into a PMREM ----
function envScene() {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uTop, uHor, uGround; varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 c = y > 0.0 ? mix(uHor, uTop, pow(y, 0.6)) : mix(uHor * 0.6, uGround, pow(-y, 0.4)); gl_FragColor = vec4(c, 1.0); }',
  }));
  const U = sky.material.uniforms;
  s.add(sky);
  const blob = (x, y, z, r, col, k) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k) }));
    m.position.set(x, y, z);
    s.add(m);
  };
  const box = (x, y, z, w, h, d, col, k) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k) }));
    m.position.set(x, y, z);
    s.add(m);
  };
  if (light === 'day') {
    U.uTop.value.set('#3f6fb8'); U.uHor.value.set('#c9d8e8'); U.uGround.value.set('#5a5040');
    blob(-40, 55, 60, 5, '#fff6e0', 30);
    box(40, 6, -40, 30, 20, 8, '#8a8070', 1.2); box(-50, 4, -30, 20, 12, 6, '#6a7078', 1.0);
  } else if (light === 'night') {
    U.uTop.value.set('#05070d'); U.uHor.value.set('#1a1d26'); U.uGround.value.set('#08080a');
    blob(30, 10, 50, 4, '#ff9a3a', 6); blob(-60, 25, -20, 2, '#ffd9a0', 8); blob(10, 30, -70, 2, '#d8e4ff', 5);
  } else {
    U.uTop.value.set('#2a2622'); U.uHor.value.set('#3a342c'); U.uGround.value.set('#1c1916');
    for (let i = -1; i <= 1; i++) box(i * 30, 45, 0, 12, 1, 40, '#fff0d8', 6);
    box(0, 20, -60, 40, 25, 1, '#cfe0ff', 3);
  }
  return s;
}
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(envScene(), 0, 0.5, 300, { size: 256 }).texture;

const scene = new THREE.Scene();
scene.background = new THREE.Color(light === 'day' ? '#9aa8b8' : light === 'night' ? '#06070a' : '#1a1714');
// lights like the viewmodel's rig in each situation (vm-light.js)
if (light === 'day') {
  const sun = new THREE.DirectionalLight('#fff1dc', 3.2); sun.position.set(-0.4, 0.75, 0.55); scene.add(sun);
  scene.add(new THREE.HemisphereLight('#a8c4ee', '#5a5040', 0.7));
} else if (light === 'night') {
  const moon = new THREE.DirectionalLight('#9fb4d8', 0.35); moon.position.set(0.3, 0.8, -0.5); scene.add(moon);
  scene.add(new THREE.HemisphereLight('#2a3550', '#141210', 0.5));
  const key = new THREE.DirectionalLight('#ffe8cc', 1.0); key.position.set(-0.3, 0.6, 0.4); scene.add(key);
  const fire = new THREE.PointLight('#ff8a30', 900, 160, 1.5); fire.position.set(35, 8, 30); scene.add(fire);
  const torch = new THREE.SpotLight('#fff1dc', 2200, 300, 0.6, 0.7, 1.4); torch.position.set(-10, 6, 60); torch.target.position.set(0, 0, 0); scene.add(torch, torch.target);
} else {
  scene.add(new THREE.HemisphereLight('#3a342c', '#1c1916', 0.35));
  for (const x of [-30, 30]) { const l = new THREE.PointLight('#ffd8a8', 2600, 200, 1.6); l.position.set(x, 40, 20); scene.add(l); }
  const win = new THREE.DirectionalLight('#cfe0ff', 0.8); win.position.set(0.2, 0.3, -1); scene.add(win);
}

const atlas = gunMaterials().atlas;
const mats = new Map();
function matFor(skin) {
  const k = skin || 'factory';
  if (!mats.has(k)) mats.set(k, createGunMaterial(atlas, { envMap: env, envIntensity: 1, mark: gunMaterials().mark, cinematic: q === 'cinematic', textured: high, triplanar: tierAtLeast(q, 'ultra'), skin: k }));
  return mats.get(k);
}

// ---- the grid ----
const cellW = 52, cellH = 22;
const rows = Math.ceil(items.length / cols);
const yaw = Number(P.get('yaw') || 0.32), pitch = Number(P.get('pitch') || 0.12);
const tags = [];
items.forEach((it, i) => {
  const model = gunModel(it.id);
  const mat = matFor(it.skin);
  // (one gun at a time per material in the game; here several share one: the last model's soot / holster values)
  setGunMaterialModel(mat, model);
  const g = gunObject(it.id, { material: mat, glowMaterial: gunMaterials().glow });
  const s = Math.min(1.25, 40 / Math.max(10, model.length));
  g.scale.setScalar(s);
  const c = i % cols, r = Math.floor(i / cols);
  const cx = (c - (cols - 1) / 2) * cellW, cy = ((rows - 1) / 2 - r) * cellH;
  g.position.set(cx + model.length * s * 0.3, cy, 0);
  g.rotation.set(0, Math.PI + yaw, 0, 'YXZ');
  g.rotateZ(-pitch * 0.3);
  scene.add(g);
  tags.push({ el: Object.assign(document.createElement('div'), { className: 'tag', textContent: it.label }), at: new THREE.Vector3(cx, cy - cellH * 0.42, 0) });
});
for (const t of tags) document.body.appendChild(t.el);

const aspect = innerWidth / innerHeight;
const camera = new THREE.PerspectiveCamera(24, aspect, 1, 2000);
const span = Math.max(cols * cellW / aspect, rows * cellH) * (Number(P.get('zoom')) || 1);
// (looking at the guns' left side: the side the player sees in first person)
camera.position.set(0, Math.sin(pitch) * span * 2.4, Math.cos(pitch) * span * 2.4);
camera.lookAt(0, 0, 0);

let frames = 0;
function draw() {
  renderer.render(scene, camera);
  frames++;
  for (const t of tags) {
    const p = t.at.clone().project(camera);
    t.el.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
    t.el.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
  }
  const st = gunTexStats();
  hud.textContent = `${q} · ${light} · gun textures ${st.status}${st.mb ? ` ${st.mb} MB` : ''}${st.ms ? ` in ${st.ms} ms` : ''} · calls ${renderer.info.render.calls} · tris ${(renderer.info.render.triangles / 1000).toFixed(1)}k`;
  const loading = high && st.status === 'loading';
  if (!loading && frames > 2) window.__lab.ready = true;
}
window.__lab = { ready: false, stats: () => ({ ...gunTexStats(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }) };
function loop() { draw(); requestAnimationFrame(loop); }
loop();
