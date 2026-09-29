// First-person sandbox (WORLD dev tool): runs the REAL simulation (shared/sim.js) on a real
// map with AI bot teammates and renders it with createRenderer3D. You play slot 1 with
// keyboard + mouse (pointer lock), or watch a scripted flythrough (?tour=1).
//
// URL params: map (highway|truckstop|bridge|checkpoint|harlan), seed, quality=ultra|high|low, bots=N (0..5),
// tour=1, paused=1 (render only on __fps.step), view=<name> (a fixed named viewpoint, see viewpoints()), fixed=1 (60 Hz dt for
// reproducible screenshots), wave=1 (skip the prep phase), fov, zombies=0 (no waves), clean=1,
// graphics settings (SPEC §7.5): scale=auto|0.5..1, bloom=0, ao=0, aa=smaa|fxaa|off, grain=0, vignette=0.
// window.__fps exposes hooks for Playwright: setView(name | {x, y, yaw, pitch}), views,
// stats(), step(n), recreate(mapId), renderer, game.

import { createRenderer3D, isWebGLAvailable } from '../js/render3d/renderer3d.js';
import { CLASS_IDS } from '../js/shared/classes.js';
import { MAP_LIST } from '../js/shared/maps.js';

const params = new URLSearchParams(location.search);
const opt = {
  map: MAP_LIST.some((m) => m.id === params.get('map')) ? params.get('map') : 'highway',
  seed: Number(params.get('seed') || 1234),
  quality: ['low', 'ultra'].includes(params.get('quality')) ? params.get('quality') : 'high',
  bots: Math.max(0, Math.min(5, Number(params.get('bots') ?? 3))),
  tour: params.get('tour') === '1',
  view: params.get('view') || null,
  fixed: params.get('fixed') === '1',
  wave: params.get('wave') === '1',
  fov: Number(params.get('fov') || 80),
  zombies: params.get('zombies') !== '0',
  // paused=1: no animation loop, frames only via __fps.step() (screenshots on software GL)
  paused: params.get('paused') === '1',
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
};

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
function viewpoints(map) {
  const ob = map.objective, sp = map.supply;
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
  game = new Game({ mapId, seed: opt.seed, players, settings: { difficulty: 'normal', waves: 15, objective: true, friendlyFire: false } });
  roster = players.map((p) => ({ ...p, ready: true, ping: 0, host: p.id === 1 }));
  if (opt.wave && opt.zombies) for (let t = 0; t < 60 * 30 && game.phase === 'prep'; t++) game.step();
  snap = game.snapshot();
  const me = snap.players.find((p) => p.id === 1);
  yaw = me ? me.angle : 0;
  pitch = 0;
  const t0 = performance.now();
  renderer = createRenderer3D(canvas, { map: game.map, quality });
  console.log(`[fps-sandbox] ${mapId}: renderer created in ${(performance.now() - t0).toFixed(0)} ms`);
  window.__fps.views = viewpoints(game.map);
  if (opt.view) setView(opt.view);
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
  quality = quality === 'ultra' ? 'high' : quality === 'high' ? 'low' : 'ultra';
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
      ...idle, ...edge, seq: ++seq,
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
    view = { ...snap, players: snap.players.map((p) => (p.id === 1 ? { ...p, x: cam.x, y: cam.y, angle: cam.yaw, state: 'alive' } : p)) };
    look = { yaw: cam.yaw, pitch: cam.pitch || 0 };
  }
  renderer.addEvents(snap.events, { localId: 1 });
  renderer.render(view, { localId: 1, roster, now: nowS, dt, look, settings: gfx });
  statT += dt;
  if (statT > 0.25) {
    statT = 0;
    const s = renderer.stats;
    const me = snap.players.find((p) => p.id === 1);
    $stats.textContent = `${game.map.name} · ${quality} · ${s.fps} fps · js ${s.jsMs.toFixed(2)} ms · scale ${s.renderScale}${s.gpuMs !== undefined ? ` · gpu ${s.gpuMs} ms` : ''}\n`
      + `draw calls ${s.drawCalls} (world ${s.sceneCalls ?? '-'}) · tris ${(s.triangles / 1000).toFixed(1)}k · static ${(s.staticTriangles / 1000).toFixed(1)}k · lights ${s.lights}\n`
      + `phase ${snap.phase} wave ${snap.wave} · zombies ${snap.zombies.length} · you ${me ? `${Math.round(me.x)},${Math.round(me.y)} ${me.state}` : '-'}`;
  }
}

let gameMod = null;
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
    step(n = 1) { for (let i = 0; i < n; i++) step(1 / 60, (performance.now() / 1000)); },
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
