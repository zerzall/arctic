// The story layer's renderers in plain Node (no GL): the first-person NPC and story sub-systems
// (render3d/npcs3d.js, story3d.js) and the top-down ones (render/npcs2d.js, story2d.js) run on real
// snapshots of a mission game against a stub canvas and an offscreen three.js scene, the map
// markers and the NPC accessory / hair vocabulary hold together. What they look like is checked
// in the browser (e2e scenario m).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

/** A canvas 2D context that accepts everything and draws nothing (it counts the calls). */
function fakeContext(canvas) {
  const grad = { addColorStop() {} };
  const store = { canvas, calls: 0 };
  const methods = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 40 }),
  };
  return new Proxy(store, {
    get: (t, p) => {
      if (p in methods) return methods[p];
      if (p in t) return t[p];
      return () => { t.calls++; };
    },
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

let THREE, Game, npcs3d, story3d, npcs2d, story2d, storymarks, defs, npcsSim, addInteractable;

before(async () => {
  globalThis.document = {
    createElement: () => {
      const c = { width: 1, height: 1, style: {} };
      c.getContext = () => fakeContext(c);
      return c;
    },
  };
  THREE = await import('three');
  ({ Game } = await import('../public/js/shared/sim.js'));
  npcs3d = await import('../public/js/render3d/npcs3d.js');
  story3d = await import('../public/js/render3d/story3d.js');
  npcs2d = await import('../public/js/render/npcs2d.js');
  story2d = await import('../public/js/render/story2d.js');
  storymarks = await import('../public/js/ui/storymarks.js');
  defs = await import('../public/js/shared/story-defs.js');
  npcsSim = await import('../public/js/shared/sim/npcs.js');
  ({ addInteractable } = await import('../public/js/shared/sim/interact.js'));
});

/** A game with a mission that has NPCs, items, a device and markers, ticked for a few seconds. */
function storyView() {
  const mission = {
    id: 'render', map: 'highway', mode: 'free', startAt: 'overpass', level: [1, 1],
    npcs: [{ id: 'mara', at: 'overpass' }],
    steps: [
      { id: 'c', type: 'collect', item: 'fuel', count: 2, at: ['bus'], pressure: false },
      { id: 'a', type: 'activate', at: ['bus'], hold: 3, text: 'Hold it', pressure: false },
    ],
    bonus: [{ id: 'n', type: 'collect', item: 'note', note: 'n01', count: 1, at: ['bus'] }],
  };
  const g = new Game({
    mapId: 'highway', seed: 4,
    settings: { mode: 'mission', story: { mission, simMode: 'free' } },
    players: [{ id: 1, name: 'A', color: 0, cls: 'soldier' }],
  });
  for (const key of ['deke', 'ozzy', 'june', 'roz', 'quill', 'wendell']) {
    npcsSim.createNpc(g, { key, x: g.map.anchors.overpass.x + 30 * g.npcs.length, y: g.map.anchors.overpass.y + 40, angle: 3 });
  }
  g.npcs[2].state = 'down';
  const a = g.map.anchors.overpass;
  for (const [id, kind, dx] of [['t1', 'terminal', 90], ['t2', 'generator', 140], ['t3', 'beacon', 190], ['t4', 'repair', 240], ['t5', 'radio', 290], ['t6', 'switch', 340], ['t7', 'valve', 390], ['t8', 'winch', 440], ['t9', 'pump', 490], ['t10', 'cache', 540], ['t11', 'door', 590], ['t12', 'use', 640], ['s1', 'board', 690]]) {
    addInteractable(g, { id, kind, x: a.x + dx, y: a.y - 60, r: 50, hold: kind === 'board' ? 0 : 3 });
  }
  for (let t = 0; t < 120; t++) g.step();
  const view = g.snapshot();
  return { g, view };
}

function frame(g, now) {
  const p = g.getPlayer(1);
  return { now, dt: 1 / 60, camX: p.x, camY: p.y, localId: 1, local: p, settings: { uiScale: 1.4 }, roster: [] };
}

test('every accessory and hair style of the vocabulary builds well-formed parts', () => {
  for (const acc of defs.NPC_ACCESSORIES) {
    for (const part of npcs3d.partsOf({ accessory: acc, hairStyle: 'default' })) {
      assert.ok(['head', 'neck', 'chest', 'hips'].includes(part.bone), `${acc}: bone ${part.bone}`);
      assert.ok(['box', 'ball', 'cyl', 'ring', 'arc'].includes(part.g), `${acc}: shape ${part.g}`);
      assert.ok(part.p.length === 3 && part.s.length === 3 && part.p.every(Number.isFinite) && part.s.every((v) => Number.isFinite(v) && v > 0), `${acc}: numbers`);
    }
  }
  for (const h of defs.NPC_HAIR_STYLES) {
    for (const part of npcs3d.partsOf({ accessory: 'none', hairStyle: h })) assert.ok(part.s.every((v) => v > 0), `${h}: sizes`);
  }
  // the written cast dresses up: every accessory of the cast has parts
  for (const id of ['mara', 'deke', 'ozzy', 'okafor', 'priya', 'june', 'roz', 'quill', 'dutch', 'wendell', 'danny', 'wren']) {
    const look = defs.CAST[id].look;
    assert.ok(npcs3d.partsOf(look).length > 0, `${id} has an accessory or a hair style to draw`);
  }
});

test('the first-person NPC and story sub-systems run on real snapshots and clean up', () => {
  const { g, view } = storyView();
  const scene = new THREE.Scene();
  const overlay = fakeContext({ clientWidth: 960, clientHeight: 540, width: 960, height: 540, style: {} });
  const ctx = {
    THREE, scene, camera: new THREE.PerspectiveCamera(70, 1.6, 2, 5000), quality: 'high', overlay,
    project: (x, y, h) => ({ x: 480 + (x % 300) - 150, y: 270 - h * 0.5, visible: true }),
    groundY: () => 0, lights: { flash() {}, steady() {} },
  };
  const npcs = npcs3d.createNpcs3D(ctx);
  const story = story3d.createStory3D(ctx);
  assert.ok(view.npcs.length >= 7 && view.story.items.length >= 3 && view.interactables.length >= 1, 'the fixture has something to draw');
  for (let f = 0; f < 6; f++) {
    npcs.update(view, frame(g, f / 10));
    story.update(view, frame(g, f / 10));
  }
  const npcRoot = scene.getObjectByName('npcs3d'), storyRoot = scene.getObjectByName('story3d');
  assert.ok(npcRoot.children.length > 7, 'rig meshes and accessory meshes');
  assert.ok(storyRoot.children.length > 10, 'items, devices, markers');
  assert.ok(overlay.calls > 20, 'tags and icons were drawn on the overlay');
  // quality change and removal of everything
  npcs.setQuality('low');
  npcs.update({ ...view, npcs: [] }, frame(g, 2));
  story.update({ ...view, story: { ...view.story, items: [], marks: [] }, interactables: [] }, frame(g, 2));
  npcs.update(view, frame(g, 3));
  npcs.dispose();
  story.dispose();
  assert.equal(scene.getObjectByName('npcs3d'), undefined);
});

test('a game without a story costs the first-person sub-systems nothing', () => {
  const scene = new THREE.Scene();
  const ctx = { THREE, scene, camera: new THREE.PerspectiveCamera(70, 1.6, 2, 5000), quality: 'high', overlay: fakeContext({ width: 9, height: 9, style: {} }), project: () => ({ x: 0, y: 0, visible: false }), groundY: () => 0 };
  const npcs = npcs3d.createNpcs3D(ctx), story = story3d.createStory3D(ctx);
  for (let f = 0; f < 3; f++) {
    npcs.update({ players: [], npcs: [] }, { now: f, dt: 0.016, camX: 0, camY: 0, localId: 1 });
    story.update({ players: [] }, { now: f, dt: 0.016, camX: 0, camY: 0, localId: 1 });
  }
  const r = scene.getObjectByName('npcs3d');
  assert.equal(r.children.length, 0);
  assert.equal(scene.getObjectByName('story3d').visible, false);
  npcs.dispose();
  story.dispose();
});

test('the top-down NPC and story painters run on real snapshots', () => {
  const { g, view } = storyView();
  const ctx = fakeContext({ width: 1280, height: 720, style: {} });
  const st = story2d.createStory2D(g.map);
  const rect = { x0: view.players[0].x - 700, y0: view.players[0].y - 400, x1: view.players[0].x + 700, y1: view.players[0].y + 400 };
  const toScreen = (x, y, out) => { out.x = 640 + (x - view.players[0].x); out.y = 360 + (y - view.players[0].y); return out; };
  const tmp = { x: 0, y: 0 };
  for (let f = 0; f < 4; f++) {
    st.drawGround(ctx, view, rect, f / 10, 1 / 60);
    st.drawWorld(ctx, view, rect, f / 10, 1);
    st.drawScreen(ctx, view, view.players[0], toScreen, tmp, 1280, 720, f / 10);
  }
  assert.ok(ctx.calls > 100, `something was painted (${ctx.calls} calls)`);
  // nothing to draw: nothing happens
  const before = ctx.calls;
  st.drawGround(ctx, { players: view.players }, rect, 0, 1 / 60);
  st.drawWorld(ctx, { players: view.players }, rect, 0, 1);
  assert.equal(ctx.calls, before);
  const np = npcs2d.createNpcs2D();
  np.draw(ctx, view, rect, 1, 1 / 60);
});

test('the map / radar drawing of the story reads a snapshot (items, NPCs, devices, markers)', () => {
  const { view } = storyView();
  const ctx = fakeContext({ width: 200, height: 200, style: {} });
  const P = { x: 0, y: 0 };
  const at = (x, y) => { P.x = 100 + (x - view.players[0].x) * 0.05; P.y = 100 + (y - view.players[0].y) * 0.05; return P; };
  at.k = 0.05;
  const win = { inside: () => true };
  storymarks.drawStoryMap(ctx, view, 2, 1.2, at, null, win);
  storymarks.drawStoryMap(ctx, view, 2, 1.2, at, (p) => { p.x = Math.max(4, Math.min(196, p.x)); return false; }, win);
  assert.ok(ctx.calls > 20);
  assert.equal(storymarks.markColor('use'), defs.MARKER_COLORS.use);
  assert.equal(storymarks.markColor('nope'), defs.MARKER_COLORS.objective);
});
