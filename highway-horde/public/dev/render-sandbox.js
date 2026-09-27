// Render sandbox: drives the real renderer with the fixture scene (or a real map from
// shared/maps.js when available) full-screen, with an FPS counter and toggles.
// URL params: map, quality=high|low, lighting=0|1, spam=0|1, zombies=N, objective=bus|diner|apc|radio,
// seed, gallery=1, fixed=1 (fixed 60 Hz dt for reproducible screenshots), pause=1.
// window.__sandbox exposes hooks for Playwright.

import { createRenderer, renderMapPreview, renderClassPortrait } from '../js/render/renderer.js';
import { createFixtureMap, createFixtureScene } from './render-fixtures.js';
import { CLASS_IDS, CLASSES } from '../js/shared/classes.js';
import { PLAYER_COLORS, BARRICADE } from '../js/shared/constants.js';
import { ZOMBIE_IDS, ZOMBIES } from '../js/shared/zombies.js';
import { WEAPON_IDS, WEAPONS, PROJECTILE_KINDS } from '../js/shared/weapons.js';
import { PICKUP_KINDS } from '../js/shared/items.js';
import {
  drawZombieShape, drawSurvivor, drawDownedSurvivor, drawDeadSurvivor, drawTurret, drawBarricade, drawPickup,
  drawProjectileBody,
} from '../js/render/actors.js';
import { drawObstacle, drawObjectiveBase, drawObjectiveLive } from '../js/render/obstacles.js';

const params = new URLSearchParams(location.search);
const opt = {
  map: params.get('map') || 'fixture',
  quality: params.get('quality') === 'low' ? 'low' : 'high',
  lighting: params.get('lighting') !== '0',
  spam: params.get('spam') === '1',
  names: params.get('names') !== '0',
  shake: params.get('shake') !== '0',
  zombies: Number(params.get('zombies') || 250),
  objective: params.get('objective') || 'bus',
  seed: Number(params.get('seed') || 1234),
  fixed: params.get('fixed') === '1',
  paused: params.get('pause') === '1',
};

const REAL_MAPS = ['highway', 'truckstop', 'bridge', 'checkpoint'];

async function loadMaps() {
  try {
    const mod = await import('../js/shared/maps.js');
    return mod;
  } catch (err) {
    console.warn('shared/maps.js not available yet, using the fixture map', err);
    return null;
  }
}

async function getMap(id, mapsMod) {
  if (id !== 'fixture' && mapsMod) {
    try {
      return mapsMod.buildMap(id, opt.seed);
    } catch (err) {
      console.warn('buildMap failed, using fixture', err);
    }
  }
  return createFixtureMap(opt.objective);
}

async function gallery(mapsMod) {
  document.body.classList.add('gallery');
  const previews = document.getElementById('previews');
  const list = mapsMod ? REAL_MAPS.map((id) => ({ id, map: mapsMod.buildMap(id, opt.seed) })) : [];
  list.unshift({ id: 'fixture', map: createFixtureMap('bus') });
  for (const { id, map } of list) {
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = 360; c.height = 240;
    c.dataset.map = id;
    const t0 = performance.now();
    renderMapPreview(c, map);
    const ms = performance.now() - t0;
    const cap = document.createElement('figcaption');
    cap.textContent = `${map.name} (${ms.toFixed(0)} ms)`;
    fig.append(c, cap);
    previews.append(fig);
  }
  const portraits = document.getElementById('portraits');
  for (const cls of CLASS_IDS) {
    for (let ci = 0; ci < PLAYER_COLORS.length; ci++) {
      const fig = document.createElement('figure');
      const c = document.createElement('canvas');
      c.width = 112; c.height = 112;
      renderClassPortrait(c, cls, ci);
      const cap = document.createElement('figcaption');
      cap.textContent = `${cls}/${ci}`;
      fig.append(c, cap);
      portraits.append(fig);
    }
  }
  // tiny HUD-size portraits too, to check they survive downscaling
  for (const cls of CLASS_IDS) {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    renderClassPortrait(c, cls, 0);
    portraits.append(c);
  }
  sheets();
  window.__sandbox = { ready: true, gallery: true };
}

/** Big sprite sheets of every actor/obstacle for art review. */
function sheets() {
  const host = document.getElementById('sheets');
  const sheet = (w, h, title, fn) => {
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.dataset.sheet = title;
    const g = c.getContext('2d');
    g.fillStyle = '#2d2f32';
    g.fillRect(0, 0, w, h);
    fn(g);
    const cap = document.createElement('figcaption');
    cap.textContent = title;
    fig.append(c, cap);
    host.append(fig);
  };
  // zombies: every variant (frame 0), a 4-frame walk strip of variant 0, and the corpse
  sheet(1560, ZOMBIE_IDS.length * 150, 'zombies', (g) => {
    ZOMBIE_IDS.forEach((type, row) => {
      const def = ZOMBIES[type];
      const sc = Math.min(3, 60 / (def.radius * 1.9));
      const cell = 120;
      const put = (col, fn) => {
        g.save();
        g.translate(60 + col * cell, 75 + row * 150);
        g.scale(sc, sc);
        g.rotate(-Math.PI / 2);
        fn();
        g.restore();
      };
      def.look.clothes.forEach((_, v) => put(v, () => drawZombieShape(g, type, v, 0, false)));
      for (let f = 0; f < 4; f++) put(6 + f, () => drawZombieShape(g, type, 0, (f / 4) * Math.PI * 2, false));
      put(11, () => drawZombieShape(g, type, 0, 0, true));
      g.fillStyle = '#ccc';
      g.font = '12px sans-serif';
      g.fillText(type, 8, 16 + row * 150);
    });
  });
  // survivors: each class with its class weapon + every weapon on a soldier, and poses
  sheet(1560, 560, 'survivors', (g) => {
    const put = (x, y, fn, sc = 2.2) => { g.save(); g.translate(x, y); g.scale(sc, sc); g.rotate(-Math.PI / 2); fn(); g.restore(); };
    CLASS_IDS.forEach((cls, i) => {
      put(70 + i * 120, 90, () => drawSurvivor(g, { cls, color: PLAYER_COLORS[i], weapon: CLASSES[cls].startWeapon, spin: 0, walk: 0, move: 0, recoil: 0, melee: 0, reload: 0 }));
    });
    put(70 + 6 * 120, 90, () => drawDownedSurvivor(g, { cls: 'medic', color: PLAYER_COLORS[1], weapon: 'pistol' }));
    put(70 + 7 * 120, 90, () => drawDeadSurvivor(g, { cls: 'heavy', color: PLAYER_COLORS[5] }));
    put(70 + 8 * 120, 90, () => drawSurvivor(g, { cls: 'soldier', color: PLAYER_COLORS[0], weapon: 'rifle', spin: 0, walk: 1, move: 1, recoil: 0, melee: 0.5, reload: 0 }));
    put(70 + 9 * 120, 90, () => drawSurvivor(g, { cls: 'soldier', color: PLAYER_COLORS[0], weapon: 'rifle', spin: 0, walk: 1, move: 1, recoil: 0, melee: 0, reload: 0.5 }));
    WEAPON_IDS.forEach((wid, i) => {
      put(50 + (i % 9) * 170, 250 + Math.floor(i / 9) * 150, () => drawSurvivor(g, { cls: CLASS_IDS[i % 6], color: PLAYER_COLORS[i % 6], weapon: wid, spin: 0.4, walk: 0, move: 0, recoil: 0, melee: 0, reload: 0 }), 1.9);
      g.fillStyle = '#aaa';
      g.font = '11px sans-serif';
      g.fillText(wid, 20 + (i % 9) * 170, 318 + Math.floor(i / 9) * 150);
    });
  });
  // obstacles: every kind, intact and wrecked
  const kinds = [
    ['car', 84, 42, '#6b2d2a'], ['suv', 92, 46, '#2f4858'], ['pickup', 100, 46, '#8a8d8f'], ['van', 104, 50, '#3b4a3a'],
    ['truck', 136, 56, '#4b5320'], ['semi', 60, 56, '#8a2f2a'], ['semi', 240, 62, '#cfcac0'], ['bus', 250, 62, '#3f6a8a'],
    ['tanker', 230, 60, '#b9bcbf'], ['barrier', 96, 14, '#9a9890'], ['sandbags', 90, 24, '#8a7a55'], ['building', 200, 140, '#9a8f7e'],
    ['wall', 160, 6, '#6b5433'], ['wall', 160, 14, '#77736b'], ['container', 120, 50, '#2f5a78'], ['pump', 40, 22, '#c9c4b6'],
    ['tree', 32, 32, '#4a3826'], ['rock', 50, 36, '#6d6a63'], ['hesco', 114, 44, '#a08a62'], ['tent', 110, 70, '#5a6340'],
    ['booth', 50, 40, '#5b6150'], ['guardrail', 160, 8, '#8f979c'], ['pillar', 18, 18, '#8d8a82'],
  ];
  sheet(1560, 1000, 'obstacles', (g) => {
    let x = 20, y = 30, rowH = 0, id = 0;
    for (const [kind, w, h, color] of kinds) {
      for (const wrecked of [false, true]) {
        if (wrecked && !['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker'].includes(kind)) continue;
        const sc = 1.5;
        if (x + w * sc + 20 > 1560) { x = 20; y += rowH + 30; rowH = 0; }
        g.save();
        g.translate(x + (w * sc) / 2, y + (h * sc) / 2);
        g.scale(sc, sc);
        drawObstacle(g, { id: id++, kind, x: 0, y: 0, w, h, a: 0, color, solid: true, wrecked, roof: kind === 'building' ? '#5b5048' : kind === 'container' ? color : kind === 'tent' ? '#6b7449' : kind === 'booth' ? '#44493c' : null }, 5);
        g.restore();
        x += w * sc + 24;
        rowH = Math.max(rowH, h * sc);
      }
    }
    // objectives
    y += rowH + 60;
    x = 40;
    for (const [kind, w, h] of [['bus', 250, 62], ['diner', 260, 160], ['apc', 150, 70], ['radio', 70, 70]]) {
      const ob = { kind, name: kind, x: 0, y: 0, w, h, a: 0, hp: 5000 };
      g.save();
      g.translate(x + w * 0.6, y + h * 0.6);
      g.scale(1.2, 1.2);
      drawObjectiveBase(g, ob, 3);
      drawObjectiveLive(g, ob, 1);
      g.restore();
      x += w * 1.2 + (kind === 'radio' ? 0 : 80);
    }
  });
  // deployables, pickups, projectiles
  sheet(1560, 200, 'items', (g) => {
    let x = 50;
    const put = (fn, sc = 2) => { g.save(); g.translate(x, 100); g.scale(sc, sc); fn(); g.restore(); x += 90; };
    put(() => drawTurret(g, { angle: -0.6, firing: false }, PLAYER_COLORS[2], 0));
    for (const hp of [1, 0.5, 0.2]) { put(() => { g.rotate(0.3); drawBarricade(g, BARRICADE.width, BARRICADE.height, hp, 3); }, 1.2); x += 40; }
    for (const kind of PICKUP_KINDS) put(() => drawPickup(g, kind, WEAPONS.rocket.short));
    for (const kind of PROJECTILE_KINDS) put(() => drawProjectileBody(g, { id: 1, kind, x: 0, y: 0, angle: -0.5 }, 0.3), 3);
  });
}

/**
 * ?sim=1: drive the renderer with the real simulation (shared/sim.js) — you play slot 1
 * with WASD + mouse (hold to fire, right button melee, G frag, F molotov, R reload),
 * five bots fight alongside. Prep time is fast-forwarded.
 */
async function simMode() {
  const { Game } = await import('../js/shared/sim.js');
  const mapId = REAL_MAPS.includes(opt.map) ? opt.map : 'highway';
  const players = CLASS_IDS.map((cls, i) => ({ id: i + 1, name: ['You', 'Doc', 'Sparks', 'Swift', 'Boom', 'Tank'][i], color: i, cls }));
  const game = new Game({ mapId, seed: opt.seed, players, settings: { difficulty: 'normal', waves: 15, objective: true, friendlyFire: false } });
  const roster = players.map((p) => ({ ...p, ready: false, ping: 0, host: p.id === 1 }));
  const canvas = document.getElementById('game');
  const renderer = createRenderer(canvas, { map: game.map, quality: opt.quality });
  const cursor = { x: innerWidth / 2 + 150, y: innerHeight / 2 };
  const keys = new Set();
  let mouse = 0, seq = 0, edge = {};
  addEventListener('mousemove', (e) => { cursor.x = e.clientX; cursor.y = e.clientY; });
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
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('resize', () => renderer.resize());
  document.getElementById('hud').style.display = 'none';
  const idle = { moveX: 0, moveY: 0, angle: 0, fire: false, melee: false, sprint: false, interact: false, reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0 };
  let snap = game.snapshot();
  const botInput = (p, t) => {
    let best = null, bd = 700 * 700;
    for (const z of snap.zombies) {
      const d = (z.x - p.x) ** 2 + (z.y - p.y) ** 2;
      if (d < bd) { bd = d; best = z; }
    }
    const angle = best ? Math.atan2(best.y - p.y, best.x - p.x) : p.angle;
    return { ...idle, seq: t, moveX: Math.sin(t / 120 + p.id) * 0.4, moveY: Math.cos(t / 150 + p.id) * 0.3, angle, fire: !!best, interact: true };
  };
  // skip most of the prep phase so the first wave arrives quickly
  for (let t = 0; t < 60 * 17; t++) game.step();
  game.snapshot();
  let acc = 0, last = performance.now(), tick = 0;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += opt.fixed ? 1 / 60 : dt;
    const me = snap.players.find((p) => p.id === 1);
    while (acc >= 1 / 60) {
      acc -= 1 / 60;
      tick++;
      for (const p of snap.players) {
        if (p.id === 1) {
          const w = renderer.screenToWorld(cursor.x, cursor.y);
          const mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), my = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
          const l = Math.hypot(mx, my) || 1;
          game.setInput(1, { ...idle, ...edge, seq: ++seq, moveX: mx / l, moveY: my / l, angle: me ? Math.atan2(w.y - me.y, w.x - me.x) : 0, fire: !!(mouse & 1) || params.get('autofire') === '1', melee: !!(mouse & 4), sprint: keys.has('ShiftLeft'), interact: keys.has('KeyE') });
          edge = {};
        } else {
          game.setInput(p.id, botInput(p, tick));
        }
      }
      game.step();
    }
    snap = game.snapshot();
    renderer.addEvents(snap.events, { localId: 1 });
    renderer.render(snap, { localId: 1, roster, now: now / 1000, dt, cursor, settings: { screenShake: opt.shake, showNames: opt.names, lighting: opt.lighting } });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__sandbox = { ready: true, renderer, game, get snap() { return snap; }, setCursor(x, y) { cursor.x = x; cursor.y = y; } };
}

async function main() {
  const mapsMod = await loadMaps();
  if (params.get('gallery') === '1') return gallery(mapsMod);
  if (params.get('sim') === '1') return simMode();

  const canvas = document.getElementById('game');
  let map = await getMap(opt.map, mapsMod);
  let renderer = createRenderer(canvas, { map, quality: opt.quality });
  let scene = createFixtureScene(map, { zombies: opt.zombies, spam: opt.spam, seed: 7 });
  const cursor = { x: innerWidth / 2 + 200, y: innerHeight / 2 - 60 };
  const keys = new Set();

  const $ = (id) => document.getElementById(id);
  const mapSel = $('map');
  mapSel.value = opt.map;
  const sync = () => {
    $('quality').textContent = 'quality: ' + opt.quality;
    $('quality').setAttribute('aria-pressed', String(opt.quality === 'low'));
    $('lighting').setAttribute('aria-pressed', String(opt.lighting));
    $('spam').setAttribute('aria-pressed', String(opt.spam));
    $('names').setAttribute('aria-pressed', String(opt.names));
    $('shake').setAttribute('aria-pressed', String(opt.shake));
    $('pause').setAttribute('aria-pressed', String(opt.paused));
  };
  const toggleQuality = () => { opt.quality = opt.quality === 'high' ? 'low' : 'high'; renderer.setQuality(opt.quality); sync(); };
  const toggleLighting = () => { opt.lighting = !opt.lighting; sync(); };
  const toggleSpam = () => { opt.spam = !opt.spam; scene.setSpam(opt.spam); sync(); };
  $('quality').onclick = toggleQuality;
  $('lighting').onclick = toggleLighting;
  $('spam').onclick = toggleSpam;
  $('names').onclick = () => { opt.names = !opt.names; sync(); };
  $('shake').onclick = () => { opt.shake = !opt.shake; sync(); };
  $('pause').onclick = () => { opt.paused = !opt.paused; sync(); };
  mapSel.onchange = async () => {
    opt.map = mapSel.value;
    renderer.destroy();
    map = await getMap(opt.map, mapsMod);
    renderer = createRenderer(canvas, { map, quality: opt.quality });
    scene = createFixtureScene(map, { zombies: opt.zombies, spam: opt.spam, seed: 7 });
    api.renderer = renderer;
    api.scene = scene;
    const u = new URL(location.href);
    u.searchParams.set('map', opt.map);
    history.replaceState(null, '', u);
  };
  sync();

  addEventListener('mousemove', (e) => { cursor.x = e.clientX; cursor.y = e.clientY; });
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'SELECT') return;
    keys.add(e.code);
    if (e.code === 'KeyQ') toggleQuality();
    if (e.code === 'KeyL') toggleLighting();
    if (e.code === 'KeyE') toggleSpam();
    if (e.code === 'KeyP') { opt.paused = !opt.paused; sync(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('resize', () => renderer.resize());

  // fps: frames in the last second + mean/worst frame time
  const frameTimes = [];
  let fpsShown = 0, lastFpsUpdate = 0;
  let last = performance.now();
  let measuring = null;

  function frame(now) {
    const t0 = performance.now();
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (opt.fixed) dt = 1 / 60;
    if (!opt.paused) {
      const sp = 260 * dt;
      const mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      if (mx || my) scene.moveLocal(mx * sp, my * sp);
      const me = scene.local;
      const aimW = renderer.screenToWorld(cursor.x, cursor.y);
      const aim = Math.atan2(aimW.y - me.y, aimW.x - me.x);
      const { view, events } = scene.step(dt, aim);
      renderer.addEvents(events, { localId: scene.localId });
      renderer.render(view, {
        localId: scene.localId, roster: scene.roster, now: now / 1000, dt, cursor,
        settings: { screenShake: opt.shake, showNames: opt.names, lighting: opt.lighting },
      });
      api.lastView = view;
    }
    const cost = performance.now() - t0;
    frameTimes.push({ at: now, cost });
    while (frameTimes.length && now - frameTimes[0].at > 1000) frameTimes.shift();
    if (measuring) {
      measuring.frames++;
      measuring.cost += cost;
      measuring.worst = Math.max(measuring.worst, cost);
    }
    if (now - lastFpsUpdate > 250) {
      lastFpsUpdate = now;
      fpsShown = frameTimes.length;
      const avg = frameTimes.reduce((s, f) => s + f.cost, 0) / Math.max(1, frameTimes.length);
      const st = renderer.stats;
      $('fps').textContent = `${fpsShown} fps · ${avg.toFixed(1)} ms/frame`;
      $('stats').textContent = `zombies ${st.visibleZombies} vis · particles ${st.particles} · corpses ${st.corpses} · decal chunks ${st.decalChunks} · ground ${st.groundScale.toFixed(2)}x (${st.groundPending} pending) · sprites ${st.spriteScale}x · dpr ${st.dpr}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const api = {
    ready: true,
    renderer,
    scene,
    lastView: null,
    get fps() { return fpsShown; },
    setCursor(x, y) { cursor.x = x; cursor.y = y; },
    setOptions(o) {
      if ('quality' in o && o.quality !== opt.quality) toggleQuality();
      if ('lighting' in o) opt.lighting = !!o.lighting;
      if ('spam' in o) { opt.spam = !!o.spam; scene.setSpam(opt.spam); }
      if ('names' in o) opt.names = !!o.names;
      if ('shake' in o) opt.shake = !!o.shake;
      if ('paused' in o) opt.paused = !!o.paused;
      sync();
    },
    /** Average fps / frame cost over `seconds` of real rendering. */
    measure(seconds = 5) {
      return new Promise((resolve) => {
        measuring = { frames: 0, cost: 0, worst: 0, t0: performance.now() };
        setTimeout(() => {
          const m = measuring;
          measuring = null;
          const el = (performance.now() - m.t0) / 1000;
          resolve({ fps: m.frames / el, avgFrameMs: m.cost / Math.max(1, m.frames), worstFrameMs: m.worst, frames: m.frames, stats: renderer.stats });
        }, seconds * 1000);
      });
    },
  };
  window.__sandbox = api;
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#f66;background:#000;padding:8px">${String(err && err.stack || err)}</pre>`);
});
