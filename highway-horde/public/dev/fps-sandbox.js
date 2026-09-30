// First-person sandbox (WORLD dev tool): runs the REAL simulation (shared/sim.js) on a real
// map with AI bot teammates and renders it with createRenderer3D. You play slot 1 with
// keyboard + mouse (pointer lock), or watch a scripted flythrough (?tour=1).
//
// URL params: map (highway|truckstop|bridge|checkpoint|harlan), seed, quality=cinematic|ultra|high|low (or q=), bots=N (0..5),
// time=day|night (time of day, default night), tour=1, paused=1 (render only on __fps.step), view=<name> (a fixed named viewpoint, see viewpoints()), fixed=1 (60 Hz dt for
// reproducible screenshots), wave=1 (skip the prep phase), fov, zombies=0 (no waves), clean=1,
// graphics settings (SPEC §7.5): scale=auto|0.5..2, bloom=0, ao=0, aa=smaa|fxaa|off, grain=0, vignette=0,
// vol=0 (no mist / light scattering), refl=0 (no wet-ground reflections), gore=on|low|off,
// Cinematic extras (default: the Cinematic preset's; ignored on the other tiers): msaa=0|2|4|8, shadows=0|1 (4096 cascades),
// contact=0|1, aofull=0|1, fxhigh=0|1, mb=0|1 (motion blur), dof=0|1, lens=0|1, lightshadows=0|1,
// display calibration: bright=<0.7..1.3>, contrast=<..>, sat=<..>; timing=1 (per-pass GPU timings in the readout),
// gallery=<kind,kind,...>|all (set-dressing review: the map is emptied and the props stand in a row at x=1000, gv=<variants each>;
// set the camera with __fps.setView({ x: 1000 + d, y, z: -28, yaw: Math.PI, pitch: -0.2 }), z lowers the eye).
// window.__fps exposes hooks for Playwright: setView(name | {x, y, yaw, pitch}), views,
// stats(), step(n), recreate(mapId), renderer, game.

import { createRenderer3D, isWebGLAvailable } from '../js/render3d/renderer3d.js';
import { CLASS_IDS } from '../js/shared/classes.js';
import { MAP_LIST } from '../js/shared/maps.js';
import { DRESS_KINDS } from '../js/shared/dress.js';
import { terrainHeight } from '../js/shared/terrain.js';
import { routePointExt } from '../js/shared/campaign.js';
import { GRAPHICS_PRESETS } from '../js/ui/storage.js';
import { TIERS } from '../js/render3d/tier.js';

const params = new URLSearchParams(location.search);
const opt = {
  map: MAP_LIST.some((m) => m.id === params.get('map')) ? params.get('map') : 'highway',
  // mode=campaign: the campaign variant of the map (hill, tower, floors, roof, zip line; SPEC §3.8)
  mode: params.get('mode') === 'campaign' ? 'campaign' : params.get('mode') === 'zone' ? 'zone' : 'defend',
  seed: Number(params.get('seed') || 1234),
  quality: TIERS.includes(params.get('quality') || params.get('q')) ? (params.get('quality') || params.get('q')) : 'high',
  bots: Math.max(0, Math.min(5, Number(params.get('bots') ?? 3))),
  tour: params.get('tour') === '1',
  view: params.get('view') || null,
  fixed: params.get('fixed') === '1',
  wave: params.get('wave') === '1',
  fov: Number(params.get('fov') || 80),
  zombies: params.get('zombies') !== '0',
  // paused=1: no animation loop, frames only via __fps.step() (screenshots on software GL)
  paused: params.get('paused') === '1',
  time: params.get('time') === 'day' ? 'day' : 'night',
};
if (params.get('clean') === '1') document.body.classList.add('clean');
// graphics settings passed to render() every frame (the object is reused, like ui/match.js)
const gfx = {
  screenShake: true, showNames: true, fov: opt.fov, lighting: true,
  renderScale: params.get('scale') && params.get('scale') !== 'auto' ? Number(params.get('scale')) : 'auto',
  bloom: params.get('bloom') !== '0',
  ao: params.get('ao') !== '0',
  antialias: ['smaa', 'fxaa', 'off'].includes(params.get('aa')) ? params.get('aa') : 'smaa',
  filmGrain: params.get('grain') !== '0',
  vignette: params.get('vignette') !== '0',
  volumetrics: params.get('vol') !== '0',
  reflections: params.get('refl') !== '0',
  gore: ['on', 'low', 'off'].includes(params.get('gore')) ? params.get('gore') : 'on',
};
// the Cinematic extras follow the preset of the tier in use unless a param says otherwise
{
  const P = GRAPHICS_PRESETS[opt.quality] || GRAPHICS_PRESETS.ultra;
  const flag = (name, dflt) => (params.get(name) === null ? dflt : params.get(name) === '1');
  gfx.msaa = params.get('msaa') === null ? P.msaa : Number(params.get('msaa'));
  gfx.shadowsHigh = flag('shadows', P.shadowsHigh);
  gfx.contactShadows = flag('contact', P.contactShadows);
  gfx.aoFull = flag('aofull', P.aoFull);
  gfx.fxHigh = flag('fxhigh', P.fxHigh);
  gfx.motionBlur = flag('mb', P.motionBlur);
  gfx.dof = flag('dof', P.dof);
  gfx.lensFx = flag('lens', P.lensFx);
  gfx.lightShadows = flag('lightshadows', P.lightShadows);
  gfx.brightness = Number(params.get('bright') || 1);
  gfx.contrast = Number(params.get('contrast') || 1);
  gfx.saturation = Number(params.get('sat') || 1);
  gfx.timing = params.get('timing') === '1';
}

const canvas = document.getElementById('game');
const $stats = document.getElementById('stats');
const idle = { moveX: 0, moveY: 0, angle: 0, fire: false, melee: false, sprint: false, interact: false, reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0 };

let game = null, renderer = null, snap = null, roster = [];
let yaw = 0, pitch = 0;
let fixedView = null;       // { x, y, yaw, pitch } ghost camera for screenshots
let tourT = 0;
const keys = new Set();
let mouse = 0, seq = 0, edge = {};
let quality = opt.quality;

/**
 * Named viewpoints for a map: at the objective, at the supply station, down the main road,
 * at the map edge, plus per-map spots (bridge deck, river bank, checkpoint compound).
 */
function campaignViewpoints(map) {
  const c = map.campaign;
  const hg = (x, y) => terrainHeight(map, x, y);
  const at = (name, x, y, tx, ty, pitch = -0.04, z = null) => ({ name, x, y, z: z == null ? hg(x, y) : z, yaw: Math.atan2(ty - y, tx - x), pitch });
  const h = c.hill, t = c.tower;
  const v = [];
  const gx = Math.cos(h.gate), gy = Math.sin(h.gate);
  v.push(at('hill', h.x - gx * 60, h.y - gy * 60, h.x + gx * 400, h.y + gy * 400, -0.02));
  v.push(at('hill-top', h.x + gx * 120, h.y + gy * 120, h.x - gx * 500, h.y - gy * 500, -0.02));
  v.push(at('hill-gate', h.x - gx * 150, h.y - gy * 150, h.x + gx * 500, h.y + gy * 500, -0.05));
  v.push(at('hill-slope', h.x + gx * 700, h.y + gy * 700, h.x, h.y, 0.02));
  v.push(at('hill-far', h.x + gx * 1500, h.y + gy * 1500 + 260, h.x, h.y, 0.02, hg(h.x + gx * 1500, h.y + gy * 1500 + 260) + 20));
  const r = c.route;
  // the horde front (stage=2&front=<px>): looking back at it from a little ahead
  const fs = Number(params.get('front') ?? 900), fp = routePointExt(r, fs + 700, {}), fq = routePointExt(r, fs - 200, {});
  v.push(at('front', fp.x, fp.y, fq.x, fq.y, 0.0));
  const a0 = r[Math.min(1, r.length - 1)];
  v.push(at('breakout', a0[0], a0[1], r[r.length - 1][0], r[r.length - 1][1], 0.0));
  const fa = Math.cos(t.a), fb = Math.sin(t.a);
  v.push(at('tower-far', t.x + fa * 900 - fb * 300, t.y + fb * 900 + fa * 300, t.x, t.y, 0.42));
  v.push(at('tower-door', t.x + fa * 380, t.y + fb * 380, t.x, t.y, 0.3));
  v.push(at('street', t.x + fa * 900, t.y + fb * 900, t.x, t.y, 0.02));
  for (const f of c.floors) {
    v.push(at('floor-' + f.n, f.arrive[0].x, f.arrive[0].y, f.stairs.x, f.stairs.y, 0.0, f.base));
    v.push(at('floor-' + f.n + '-back', f.stairs.x - 100, f.stairs.y, f.arrive[0].x, f.arrive[0].y, 0.0, f.base));
  }
  const rf = c.roof;
  v.push(at('roof', rf.arrive[0].x, rf.arrive[0].y, rf.pad.x + 300, rf.pad.y, 0.0, rf.base));
  v.push(at('roof-pad', rf.pad.x - 260, rf.pad.y, rf.pad.x + 260, rf.pad.y, -0.05, rf.base));
  v.push(at('roof-edge', rf.zip.ix, rf.zip.iy - 120, rf.zip.x, rf.zip.y + 600, -0.12, rf.base));
  v.push(at('zip', rf.zip.ix, rf.zip.iy, rf.zip.x, rf.zip.y + 800, -0.1, rf.base));
  v.push(at('zip-ride', rf.zip.x, rf.zip.y + 300, c.landing.end.x, c.landing.end.y, -0.16, rf.zip.z - 200));
  v.push(at('landing', c.landing.slots[0].x, c.landing.slots[0].y, rf.zip.x, rf.zip.y, 0.12, c.landing.base));
  return v;
}

/** Dev only: put a campaign game in a later stage (what the e2e test does through the host's game). */
function jumpStage(st) {
  const c = game.campaign, g = game;
  const clear = () => { for (const z of g.zombies) z.dead = true; g.spawnQueue = 0; g.bossQueue = 0; };
  if (st === '2') {
    g.wave = c.plan.breakout - 1;
    g.phase = 'intermission';
    g.timer = 0;
    for (let i = 0; i < 5; i++) g.step();
    clear();
    const f = params.get('front');
    if (f !== null) c.front = Number(f);
  } else if (st.startsWith('3.')) {
    c.stage = 3;
    c.floor = Number(st.slice(2)) - 1;
    clear();
    c.moveUp();
  } else if (st.startsWith('4')) {
    c.stage = 3;
    c.floor = c.cfg.floors.length;
    clear();
    c.moveUp();
    g.wave = c.plan.roof - 1;
    g.phase = 'intermission';
    g.timer = 0;
    for (let i = 0; i < 5; i++) g.step();
    clear();
    if (st === '4zip') {
      c.kills = c.quota - 1;
      c.onKill();
    }
  }
}

function viewpoints(map, zone) {
  if (map.campaign) return campaignViewpoints(map);
  // (an Evac Run map has no objective: its first point of interest stands in)
  const ob = map.objective || (map.pois && map.pois[0]) || { x: map.width / 2, y: map.height / 2 }, sp = map.supply || ob;
  const at = (name, x, y, tx, ty, pitch = -0.04) => ({ name, x, y, yaw: Math.atan2(ty - y, tx - x), pitch });
  const v = [];
  // a clear spot 300..460 from the objective (not inside or hugging an obstacle)
  const wet = (x, y) => map.areas.some((a) => a.kind === 'water' && Math.abs(x - a.x) < a.w / 2 + 40 && Math.abs(y - a.y) < a.h / 2 + 40);
  const clear = (x, y, pad) => !wet(x, y) && map.obstacles.every((o) => {
    const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0), dx = x - o.x, dy = y - o.y;
    return Math.abs(dx * c + dy * s) > o.w / 2 + pad || Math.abs(-dx * s + dy * c) > o.h / 2 + pad;
  });
  let best = null;
  for (let r = 320; r <= 480 && !best; r += 40) {
    for (let k = 0; k < 24; k++) {
      const a = Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const x = ob.x + Math.cos(a) * r, y = ob.y + Math.sin(a) * r;
      if (clear(x, y, 70)) { best = { x, y }; break; }
    }
  }
  best = best || map.playerSpawns[0];
  v.push(at('objective', best.x, best.y, ob.x, ob.y));
  // the supply station seen from a clear spot 180..300 away, looking at it
  let sv = null;
  for (let r = 180; r <= 300 && !sv; r += 40) {
    for (let k = 0; k < 16; k++) {
      const a = Math.atan2(sp.y - ob.y, sp.x - ob.x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
      const x = sp.x + Math.cos(a) * r, y = sp.y + Math.sin(a) * r;
      if (clear(x, y, 50)) { sv = { x, y }; break; }
    }
  }
  sv = sv || { x: sp.x + (sp.x - ob.x) * 0.4, y: sp.y + (sp.y - ob.y) * 0.4 + 30 };
  v.push(at('supply', sv.x, sv.y, sp.x, sp.y, -0.08));
  // longest road area
  let road = null;
  for (const a of map.areas) if (a.kind === 'asphalt' && (!road || Math.max(a.w, a.h) > Math.max(road.w, road.h))) road = a;
  if (road) {
    const horiz = road.w >= road.h;
    const L = Math.max(road.w, road.h);
    const x0 = horiz ? road.x - L * 0.3 : road.x, y0 = horiz ? road.y : road.y - L * 0.3;
    v.push(at('road', x0, y0 + (horiz ? road.h * 0.15 : 0), horiz ? road.x + L : road.x, horiz ? road.y : road.y + L));
    v.push(at('road-back', horiz ? road.x + L * 0.35 : road.x, horiz ? road.y - road.h * 0.2 : road.y + L * 0.35, horiz ? road.x - L : road.x, horiz ? road.y : road.y - L));
  }
  if (zone) {
    // Evac Run: the safe-zone wall from outside and from inside the circle
    const edge = (k) => ({ x: zone.x + Math.cos(0.6) * (zone.r + k), y: zone.y + Math.sin(0.6) * (zone.r + k) });
    const o = edge(300), i = edge(-260);
    v.push(at('zone-out', o.x, o.y, zone.x, zone.y, 0.04));
    v.push(at('zone-in', i.x, i.y, zone.x + Math.cos(0.6) * (zone.r + 400), zone.y + Math.sin(0.6) * (zone.r + 400), 0.03));
  }
  v.push(at('edge', map.width * 0.5, 120, map.width * 0.5, -600, 0.05));
  v.push(at('overview', ob.x - 900, ob.y + 500, ob.x, ob.y, -0.12));
  if (map.id === 'bridge') {
    v.push(at('bridge', 1500, 960, 2600, 1000));
    v.push(at('river', 1470, 560, 2100, 300, -0.1));
  }
  if (map.id === 'checkpoint') {
    v.push(at('compound', 1300, 1250, 1600, 1600));
    v.push(at('gate', 1500, 700, 1500, 1500));
  }
  if (map.id === 'truckstop') v.push(at('forecourt', 700, 1600, 1000, 1350));
  if (map.id === 'highway') {
    v.push(at('pileup', 3000, 1080, 3500, 980));
    v.push(at('overpass', 3480, 1180, 2900, 1180, 0.12));
    v.push(at('underpass', 2900, 1000, 2300, 1000, 0.05));
    v.push(at('ramp', 1800, 1330, 2750, 1150, 0.05));
    v.push(at('junction', 1330, 1060, 700, 1180, 0.02));
    v.push(at('longroad', 6200, 1000, 3000, 1000));
  }
  return v;
}

function setup(mapId) {
  if (renderer) { renderer.destroy(); renderer = null; }
  const { Game } = gameMod;
  const players = [{ id: 1, name: 'You', color: 0, cls: 'soldier' }];
  for (let i = 0; i < opt.bots; i++) players.push({ id: i + 2, name: ['Doc', 'Sparks', 'Swift', 'Boom', 'Tank'][i], color: i + 1, cls: CLASS_IDS[(i + 1) % CLASS_IDS.length], bot: true });
  game = new Game({ mapId, seed: opt.seed, players, settings: { difficulty: 'normal', waves: 15, objective: true, friendlyFire: false, time: opt.time, mode: opt.mode } });
  roster = players.map((p) => ({ ...p, ready: true, ping: 0, host: p.id === 1 }));
  if (opt.wave && opt.zombies) for (let t = 0; t < 60 * 30 && game.phase === 'prep'; t++) game.step();
  snap = game.snapshot();
  const me = snap.players.find((p) => p.id === 1);
  yaw = me ? me.angle : 0;
  pitch = 0;
  // stage=2 | 3.1 | 3.2 | 3.3 | 4 | 4zip (campaign): jump the director to that stage; front=<px>: put the horde front there
  if (params.get('stage') && game.campaign) jumpStage(params.get('stage'));
  // ambient=<darkness>,<tint>: review a map in brighter light (a dev tool; e.g. ambient=0.05,%239fc8ff)
  if (params.get('ambient')) {
    const [dk, tint] = params.get('ambient').split(',');
    game.map.ambient = { darkness: Number(dk), tint: tint || game.map.ambient.tint };
  }
  // gallery=<kind,kind,...>|all: the map is emptied and the listed set-dressing props stand in a
  // row (facing +x) at x = 1000, for reviewing models: view {x: 1000 + d, yaw: PI} (URL gd=<d>)
  if (params.get('gallery')) galleryMap(game.map, params.get('gallery'));
  const t0 = performance.now();
  renderer = createRenderer3D(canvas, { map: game.map, quality, time: opt.time, mode: game.mode });
  console.log(`[fps-sandbox] ${mapId}: renderer created in ${(performance.now() - t0).toFixed(0)} ms`);
  window.__fps.views = viewpoints(game.map, snap && snap.zone);
  if (opt.view) setView(opt.view);
}

function galleryMap(map, spec) {
  if (spec.startsWith('veh:')) {
    // veh:car@7,suv@34,van@7,...: road vehicles (kind@obstacle id: the id picks the job and the damage) in a row, front toward +x
    const SIZE = { car: [84, 42], suv: [92, 46], pickup: [100, 46], van: [104, 50], truck: [136, 56], bus: [250, 62] };
    map.obstacles = []; map.decor = []; map.fires = []; map.lights = []; map.overpass = null; map.lines = [];
    map.areas = [{ kind: 'concrete', x: 1000, y: 1000, w: 1800, h: 4000, a: 0 }];
    let x = 300;
    for (const part of spec.slice(4).split(',')) {
      const [kind, idStr] = part.split('@');
      const wr = idStr && idStr.endsWith('w');
      const [w, h] = SIZE[kind] || SIZE.car;
      x += w / 2 + 24;
      map.obstacles.push({ id: parseInt(idStr, 10) || 0, kind, x, y: 1000, w, h, a: 0, color: kind === 'truck' ? '#b01818' : (params.get('vcolor') || '#5b5f63'), solid: true, wrecked: !!wr, roof: null });
      x += w / 2 + 24;
    }
    map.dressItems = [];
    window.__galleryVeh = true;
    return;
  }
  const kinds = spec === 'all' ? Object.keys(DRESS_KINDS) : spec.split(',');
  map.obstacles = []; map.decor = []; map.fires = []; map.lights = []; map.overpass = null; map.lines = [];
  map.areas = [{ kind: 'concrete', x: 1000, y: 1000, w: 1800, h: 4000, a: 0 }];
  const items = [];
  let y = 300;
  const first = y;
  for (const k of kinds) {
    const def = DRESS_KINDS[k];
    if (!def) { console.warn('gallery: unknown kind', k); continue; }
    const step = Math.max(34, def[0] * 2 + 10);
    const isLine = (def[2] || '').includes('l');
    const n = Number(params.get('gv') || 1);
    for (let i = 0; i < n; i++) {
      const yy = y + step / 2;
      const it = { k, x: 1000, y: yy, a: 0, s: 1, v: 1234 + i * 977 + k.length * 31, q: 0 };
      if (isLine) { it.w = 120; it.x2 = 1000; it.y2 = yy + 120; it.a = Math.PI / 2; y += 120; }
      items.push(it);
      y += step;
    }
  }
  map.dressItems = items;
  window.__galleryCenter = { x: 1000, y: (first + y) / 2, w: y - first };
}

function setView(v) {
  if (!v) { fixedView = null; return; }
  if (typeof v === 'string') {
    const f = window.__fps.views.find((x) => x.name === v);
    if (!f) { console.warn('unknown view', v); return; }
    v = f;
  }
  fixedView = { ...v };
  yaw = v.yaw; pitch = v.pitch || 0;
}

function tourView(t) {
  const views = window.__fps.views;
  const seg = 7;
  const i = Math.floor(t / seg) % views.length, j = (i + 1) % views.length;
  const u = (t % seg) / seg;
  const e = u * u * (3 - 2 * u);
  const a = views[i], b = views[j];
  let dy = b.yaw - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, yaw: a.yaw + dy * e, pitch: (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * e };
}

// ---- input ----
canvas.addEventListener('click', () => { if (!opt.tour && !fixedView) canvas.requestPointerLock?.(); });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw += e.movementX * 0.0022;
  pitch = Math.max(-1.35, Math.min(1.35, pitch - e.movementY * 0.0022));
});
addEventListener('mousedown', (e) => { mouse |= 1 << e.button; });
addEventListener('mouseup', (e) => { mouse &= ~(1 << e.button); });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyG') edge.frag = true;
  if (e.code === 'KeyF') edge.molotov = true;
  if (e.code === 'KeyR') edge.reload = true;
  if (e.code === 'KeyT') edge.turret = true;
  if (e.code === 'KeyC') edge.barricade = true;
  if (e.code.startsWith('Digit')) edge.slot = Number(e.code.slice(5)) - 1;
  if (e.code === 'KeyQ') toggleQuality();
  if (e.code === 'KeyY') opt.tour = !opt.tour;
  if (e.code === 'KeyH') document.body.classList.toggle('clean');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => renderer && renderer.resize());
document.getElementById('quality').onclick = toggleQuality;
document.getElementById('tour').onclick = () => { opt.tour = !opt.tour; };
document.getElementById('clean').onclick = () => document.body.classList.toggle('clean');
const mapSel = document.getElementById('map');
mapSel.value = opt.map;
mapSel.onchange = () => { opt.map = mapSel.value; setup(opt.map); };

function toggleQuality() {
  quality = quality === 'cinematic' ? 'ultra' : quality === 'ultra' ? 'high' : quality === 'high' ? 'low' : 'cinematic';
  Object.assign(gfx, Object.fromEntries(['msaa', 'shadowsHigh', 'contactShadows', 'aoFull', 'fxHigh', 'dof', 'lensFx', 'lightShadows'].map((k) => [k, GRAPHICS_PRESETS[quality][k]])));
  renderer.setQuality(quality);
}

// ---- loop ----
let acc = 0, last = performance.now(), tick = 0, statT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (opt.paused) { last = now; return; }
  const dt = opt.fixed ? 1 / 60 : Math.min(0.1, (now - last) / 1000);
  last = now;
  step(dt, now / 1000);
}

function step(dt, nowS) {
  acc += dt;
  while (acc >= 1 / 60) {
    acc -= 1 / 60;
    tick++;
    const mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), my = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    // local WASD → world: forward = (cos yaw, sin yaw), right = (cos(yaw+π/2), sin(yaw+π/2))
    let wx = Math.cos(yaw) * my + Math.cos(yaw + Math.PI / 2) * mx;
    let wy = Math.sin(yaw) * my + Math.sin(yaw + Math.PI / 2) * mx;
    const l = Math.hypot(wx, wy);
    if (l > 1) { wx /= l; wy /= l; }
    const live = !opt.tour && !fixedView;
    game.setInput(1, {
      ...idle, ...edge, ...forced, seq: ++seq,
      moveX: live ? wx : 0, moveY: live ? wy : 0, angle: yaw,
      fire: live && !!(mouse & 1), melee: live && !!(mouse & 4), sprint: keys.has('ShiftLeft'), interact: keys.has('KeyE'),
      slot: edge.slot ?? -1,
    });
    edge = {};
    if (opt.zombies || game.phase === 'prep') game.step();
  }
  snap = game.snapshot();
  let view = snap;
  let look = { yaw, pitch };
  let cam = fixedView;
  if (opt.tour) { tourT += dt; cam = tourView(tourT); }
  if (cam) {
    // ghost camera: the local record is moved to the viewpoint for this render only
    view = { ...snap, players: snap.players.map((p) => (p.id === 1 ? { ...p, x: cam.x, y: cam.y, z: cam.z || 0, angle: cam.yaw, state: 'alive', vzq: 0, climbT: 0, ...(params.get('gallery') ? { slots: [] } : null) } : p)) };
    look = { yaw: cam.yaw, pitch: cam.pitch || 0 };
  }
  renderer.addEvents(snap.events, { localId: 1 });
  renderer.render(view, { localId: 1, roster, now: nowS, dt, look, settings: gfx });
  statT += dt;
  if (statT > 0.25) {
    statT = 0;
    const s = renderer.stats;
    const me = snap.players.find((p) => p.id === 1);
    const res = s.width ? ` · ${s.width}x${s.height}` : '';
    const passes = s.passMs ? `\npasses ${Object.entries(s.passMs).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')} ms` : '';
    $stats.textContent = `${game.map.name} · ${quality}${s.msaa ? ` · MSAA ${s.msaa}x` : ''} · ${s.fps} fps · js ${s.jsMs.toFixed(2)} ms · scale ${s.renderScale}${res}${s.gpuMs !== undefined ? ` · gpu ${s.gpuMs} ms` : ''}${passes}\n`
      + `draw calls ${s.drawCalls} (world ${s.sceneCalls ?? '-'}) · tris ${(s.triangles / 1000).toFixed(1)}k · static ${(s.staticTriangles / 1000).toFixed(1)}k · lights ${s.lights}\n`
      + `phase ${snap.phase} wave ${snap.wave} · zombies ${snap.zombies.length} · you ${me ? `${Math.round(me.x)},${Math.round(me.y)} ${me.state}` : '-'}`;
  }
}

let gameMod = null;
let vnow = 0;       // virtual clock of __fps.step (deterministic screenshots)
let forced = {};    // __fps.hold(): input merged into every tick (scripted fights)
async function main() {
  if (!isWebGLAvailable()) {
    $stats.textContent = 'WebGL2 is not available in this browser.';
    return;
  }
  gameMod = await import('../js/shared/sim.js');
  window.__fps = {
    ready: false,
    views: [],
    setView,
    get renderer() { return renderer; },
    get game() { return game; },
    get snap() { return snap; },
    stats: () => ({ ...renderer.stats, world: renderer.debug.world.stats }),
    /** Advance n frames synchronously at 60 Hz (for deterministic screenshots). */
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { vnow += dt; step(dt, 1000 + vnow); } },
    /** Hold scripted input (fire, slot, angle…) for the local player; hold({}) releases. */
    hold(o) { forced = o || {}; },
    /** Feed synthetic events to the renderer (effects tests / screenshots). */
    events(list) { renderer.addEvents(list, { localId: 1 }); },
    recreate(mapId) { setup(mapId || opt.map); },
    /** Simulate n ticks without rendering (the local player idles; bots play). */
    advance(n = 60) {
      for (let i = 0; i < n; i++) {
        game.setInput(1, { ...idle, seq: ++seq, angle: yaw });
        game.step();
      }
      game.snapshot();
    },
    look(y, p = 0) { yaw = y; pitch = p; },
    /** Graphics settings object handed to render() (mutate it to test live changes). */
    gfx,
    setTour(on) { opt.tour = !!on; tourT = 0; },
  };
  setup(opt.map);
  window.__fps.ready = true;
  requestAnimationFrame(frame);
}
main();
