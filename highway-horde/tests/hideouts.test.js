// The three story hideouts (SPEC §3.9, STORY.md §5.2): deterministic hub maps with stations,
// NPC idle spots, a party spawn ring by the campfire, the upgrade-slot seam (every tier of every
// upgrade), hand placed dressing, the shooting range in the sim, the ambience/score hooks and the
// renderer's model registry. The pictures (day + night, upgrades none/max) are checked visually in
// the Playwright sandbox (public/dev/fps-sandbox.html), not here.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { MAP_LIST, buildMap } from '../public/js/shared/maps.js';
import {
  HIDEOUT_IDS, HIDEOUT_LIST, STATION_KINDS, UPGRADE_KINDS, UPGRADE_MAX_TIER, HUB_PROP_KINDS, isHideout, isHideoutId,
  normalizeUpgrades, applyHideoutUpgrades, buildHideoutUpgrade, hideoutUpgradeSet, hideoutDressItems,
} from '../public/js/shared/maps-hideouts.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import { buildDress, DRESS_KINDS } from '../public/js/shared/dress.js';
import { mapModes } from '../public/js/shared/zone.js';
import { isRangeTarget, DUMMY_HP } from '../public/js/shared/sim/range.js';
import { hubSpots, createAudio } from '../public/js/audio/audio.js';
import { HUB_SOUNDS } from '../public/js/audio/sounds-hideout.js';
import { SOUNDS, renderSound } from '../public/js/audio/sounds.js';
import { MUSIC_STATES, buildPhrase } from '../public/js/audio/music.js';
import { createRng } from '../public/js/shared/rng.js';
import { makeGame, place, run, cmd } from './helpers/sim-helpers.js';
import { MockAudioContext } from './fixtures/audio-mock-context.js';

// three.js from the vendored copy (the renderer modules import it by its bare name)
const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

const HEX = /^#[0-9a-f]{6}$/i;
const SEEDS = [1, 42];
const cache = new Map();
const getMap = (id, seed = 1) => {
  const key = `${id}:${seed}`;
  if (!cache.has(key)) cache.set(key, buildMap(id, seed));
  return cache.get(key);
};

// ---- geometry helpers (oriented rectangles: centre + full size + angle) -----------------------------

function inRect(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}

function corners(r) {
  const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
  const out = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * r.w / 2, ly = sy * r.h / 2;
    out.push([r.x + lx * c - ly * s, r.y + lx * s + ly * c]);
  }
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (...v) => v.every((n) => Number.isFinite(n));

/** Props drawn along a path (string lights, bunting: `pts` [x, y, height]; rails: x1..y2) instead of at a point. */
const pathLike = (p) => Array.isArray(p.pts) || Number.isFinite(p.x1);
function checkProp(p, m, what, slack = 0) {
  if (Array.isArray(p.pts)) {
    assert.ok(p.pts.length >= 2, `${what}: ${p.t} needs two points`);
    for (const q of p.pts) assert.ok(q.length === 3 && finite(...q) && q[0] >= -slack && q[1] >= -slack && q[0] <= m.width + slack && q[1] <= m.height + slack && q[2] > 0, `${what}: ${p.t} point ${q}`);
  } else if (Number.isFinite(p.x1)) {
    assert.ok(finite(p.x1, p.y1, p.x2, p.y2), `${what}: ${p.t}`);
  } else {
    assert.ok(finite(p.x, p.y) && (p.a === undefined || Number.isFinite(p.a)), `${what}: ${p.t}`);
    assert.ok(p.x > -slack && p.y > -slack && p.x < m.width + slack && p.y < m.height + slack, `${what}: ${p.t} at ${p.x},${p.y} off the map`);
  }
}

/** A flow field toward the party spawn: what can be walked to from the campfire. */
function fieldFor(m) {
  const f = new FlowField(m, { pad: 3 });
  f.update([{ x: m.hub.spawn.x, y: m.hub.spawn.y }]);
  return f;
}

// ---- registry ----------------------------------------------------------------------------------

test('three hideouts are registered for the story, not for the lobby', () => {
  assert.deepEqual([...HIDEOUT_IDS], ['roadhouse', 'depot', 'farmstead']);
  assert.deepEqual(HIDEOUT_LIST.map((h) => h.id), [...HIDEOUT_IDS]);
  assert.deepEqual(HIDEOUT_LIST.map((h) => h.name), ['The Roadhouse', 'Blackwater Depot', 'Harlan Farmstead']);
  assert.deepEqual(HIDEOUT_LIST.map((h) => h.chapters), [[1, 2], [3, 4], [5, 6]]);
  for (const id of HIDEOUT_IDS) {
    assert.ok(!MAP_LIST.some((m) => m.id === id), `${id} must not be in the lobby's MAP_LIST`);
    assert.ok(isHideoutId(id) && isHideout(id) && isHideout(getMap(id)));
  }
  assert.equal(MAP_LIST.length, 5, 'the lobby still offers the five maps');
  assert.ok(!isHideoutId('highway') && !isHideout(getMap('highway')) && !isHideout(null));
  assert.equal(getMap('highway').hub, undefined, 'a battlefield has no hub');
  assert.deepEqual(mapModes(getMap('roadhouse')), ['hideout']);
});

// ---- the maps --------------------------------------------------------------------------------------

for (const id of HIDEOUT_IDS) {
  test(`${id}: builds identically for a seed, the layout does not depend on it`, () => {
    const a = buildMap(id, 7), b = buildMap(id, 7);
    assert.deepEqual(a, b, 'same (id, seed) → same map');
    const c = buildMap(id, 8);
    // hand made: every part of the hub is the same for every seed (only the small scatter moves)
    assert.deepEqual(c.hub, a.hub);
    assert.deepEqual(c.obstacles, a.obstacles);
    assert.deepEqual(c.lights, a.lights);
    assert.deepEqual(c.playerSpawns, a.playerSpawns);
    assert.deepEqual(hideoutDressItems(a).slice(0, a.hub.dress.length), hideoutDressItems(c).slice(0, c.hub.dress.length).map((d, i) => ({ ...d, v: hideoutDressItems(a)[i].v })));
  });

  for (const seed of SEEDS) {
    test(`${id} seed ${seed}: schema, bounds and budgets`, () => {
      const m = getMap(id, seed);
      const meta = HIDEOUT_LIST.find((h) => h.id === id);
      assert.equal(m.id, id);
      assert.equal(m.name, meta.name);
      assert.equal(m.kind, 'hideout');
      assert.equal(m.seed, seed);
      assert.equal(m.width, 2200);
      assert.equal(m.height, 1600);
      assert.match(m.ground, HEX);
      assert.ok(m.ambient && m.ambient.darkness >= 0.3 && m.ambient.darkness <= 0.75);
      assert.equal(m.zombieSpawns.length, 0, 'a hideout has no spawn zones');
      m.obstacles.forEach((o, i) => {
        assert.equal(o.id, i, 'obstacle id = index');
        assert.ok(finite(o.x, o.y, o.w, o.h, o.a) && o.w > 0 && o.h > 0, `obstacle ${i}`);
        assert.match(o.color, HEX);
        for (const [x, y] of corners(o)) assert.ok(x >= -0.5 && y >= -0.5 && x <= m.width + 0.5 && y <= m.height + 0.5, `obstacle ${i} (${o.kind}) out of the map`);
      });
      assert.ok(m.obstacles.length >= 30 && m.obstacles.length <= 200, `obstacles: ${m.obstacles.length}`);
      for (const a of m.areas) for (const [x, y] of corners(a)) assert.ok(x >= -1 && y >= -1 && x <= m.width + 1 && y <= m.height + 1, `area ${a.kind} out of the map`);
      for (const l of m.lights) {
        assert.ok(finite(l.x, l.y, l.r) && l.r > 0 && l.x >= 0 && l.y >= 0 && l.x <= m.width && l.y <= m.height, 'light');
        assert.match(l.color, HEX);
        assert.ok(l.flicker >= 0 && l.flicker <= 1);
      }
      assert.ok(m.lights.length >= 6 && m.lights.length <= 40, `lights: ${m.lights.length}`);
      assert.ok(m.fires.length >= 1, 'a fire burns');
      for (const f of m.fires) assert.ok(finite(f.x, f.y, f.r) && f.x > 0 && f.y > 0 && f.x < m.width && f.y < m.height);
      assert.ok(m.decor.length >= 40, `lived-in ground: ${m.decor.length} decor`);
      // the safe boundary: a walled/fenced yard the hub's bounds describe, inside the world
      const b = m.hub.bounds;
      assert.ok(b.x0 >= 60 && b.y0 >= 60 && b.x1 <= m.width - 60 && b.y1 <= m.height - 60 && b.x1 - b.x0 >= 1500 && b.y1 - b.y0 >= 1000, 'bounds');
      // the gate-less perimeter really is closed: nothing walks out of the yard
      const world = createCollisionWorld(m);
      const f = fieldFor(m);
      for (const [x, y] of [[b.x0 - 60, m.height / 2], [b.x1 + 60, m.height / 2], [m.width / 2, b.y0 - 60], [m.width / 2, b.y1 + 60]]) {
        assert.ok(!f.reachable(x, y) || !world.isCircleFree(x, y, 14, false), `the yard is open at ${x},${y}`);
      }
    });

    test(`${id} seed ${seed}: party spawns are free, reachable and around the campfire`, () => {
      const m = getMap(id, seed);
      const hub = m.hub;
      const world = createCollisionWorld(m);
      const f = fieldFor(m);
      assert.ok(m.playerSpawns.length >= 6, `${m.playerSpawns.length} spawns`);
      assert.ok(hub.spawn && finite(hub.spawn.x, hub.spawn.y, hub.spawn.r));
      const fire = hub.stations.find((s) => s.kind === 'campfire');
      assert.ok(dist(hub.spawn, fire) < 40, 'the ring is centred on the campfire');
      const water = m.areas.filter((a) => a.kind === 'water');
      for (const p of m.playerSpawns) {
        assert.ok(dist(p, hub.spawn) <= hub.spawn.r + 1 && dist(p, hub.spawn) > 100, 'on the ring, not in the fire');
        assert.ok(world.isCircleFree(p.x, p.y, 14, false), `spawn ${p.x},${p.y} is blocked`);
        assert.ok(f.reachable(p.x, p.y), `spawn ${p.x},${p.y} is cut off`);
        for (const o of m.obstacles) assert.ok(!inRect(o, p.x, p.y, 12), `spawn ${p.x},${p.y} inside ${o.kind} #${o.id}`);
        for (const w of water) assert.ok(!inRect(w, p.x, p.y, 12), 'spawn in the water');
      }
      for (let i = 0; i < m.playerSpawns.length; i++) {
        for (let j = i + 1; j < m.playerSpawns.length; j++) assert.ok(dist(m.playerSpawns[i], m.playerSpawns[j]) > 30, 'spawns stack');
      }
    });

    test(`${id} seed ${seed}: stations and NPC spots are unique, in bounds and reachable`, () => {
      const m = getMap(id, seed);
      const hub = m.hub;
      const world = createCollisionWorld(m);
      const f = fieldFor(m);
      // every station kind exactly once, with a matching interactable
      assert.deepEqual(hub.stations.map((s) => s.kind).sort(), [...STATION_KINDS].sort());
      assert.equal(new Set(hub.stations.map((s) => s.id)).size, hub.stations.length, 'station ids are unique');
      assert.equal(m.interactables.length, hub.stations.length);
      for (const s of hub.stations) {
        assert.ok(finite(s.x, s.y, s.r) && s.r >= 40 && s.r <= 200, `${s.id} radius`);
        assert.ok(typeof s.label === 'string' && s.label.length > 1);
        const it = m.interactables.find((i) => i.id === s.id);
        assert.ok(it, `${s.id} has an interactable`);
        assert.deepEqual([it.kind, it.x, it.y, it.r, it.hold], [s.kind, s.x, s.y, s.r, 0]);
        assert.ok(s.x > hub.bounds.x0 && s.x < hub.bounds.x1 && s.y > hub.bounds.y0 && s.y < hub.bounds.y1, `${s.id} outside the yard`);
        // a player can stand within the prompt range of it
        let reach = false;
        for (let k = 0; k < 24 && !reach; k++) {
          const ang = (k / 24) * Math.PI * 2;
          const x = s.x + Math.cos(ang) * s.r * 0.85, y = s.y + Math.sin(ang) * s.r * 0.85;
          reach = f.reachable(x, y) && world.isCircleFree(x, y, 14, false);
        }
        assert.ok(reach, `station ${s.id} (${s.kind}) cannot be reached`);
      }
      for (let i = 0; i < hub.stations.length; i++) {
        for (let j = i + 1; j < hub.stations.length; j++) assert.ok(dist(hub.stations[i], hub.stations[j]) >= 60, `stations ${hub.stations[i].id}/${hub.stations[j].id} on top of each other`);
      }
      // NPC idle spots: the cast, one of them on watch, one working at the bench, some by the fire
      assert.equal(new Set(hub.npcs.map((n) => n.id)).size, hub.npcs.length, 'npc ids are unique');
      assert.ok(hub.npcs.length >= 4);
      for (const n of hub.npcs) {
        assert.ok(finite(n.x, n.y, n.angle) && typeof n.role === 'string' && typeof n.name === 'string' && n.pose, `${n.id}`);
        assert.ok(n.x > hub.bounds.x0 && n.x < hub.bounds.x1 && n.y > hub.bounds.y0 && n.y < hub.bounds.y1, `${n.id} outside the yard`);
        for (const o of m.obstacles) if (o.solid) assert.ok(!inRect(o, n.x, n.y, -2), `${n.id} stands inside solid ${o.kind} #${o.id}`);
        // on foot (or on a seat / behind a counter within a step of open ground), unless up on a lookout
        if (!(n.z > 0)) {
          let near = f.reachable(n.x, n.y);
          for (let k = 0; k < 16 && !near; k++) near = f.reachable(n.x + Math.cos(k / 16 * 6.283) * 44, n.y + Math.sin(k / 16 * 6.283) * 44);
          assert.ok(near, `${n.id} at ${n.x},${n.y} is cut off`);
        }
      }
      for (let i = 0; i < hub.npcs.length; i++) {
        for (let j = i + 1; j < hub.npcs.length; j++) assert.ok(dist(hub.npcs[i], hub.npcs[j]) >= 24, `npcs ${hub.npcs[i].id}/${hub.npcs[j].id} share a spot`);
      }
      assert.ok(hub.npcs.some((n) => n.pose === 'sit'), 'someone sits by the fire');
      assert.ok(hub.npcs.some((n) => n.pose === 'watch'), 'someone keeps watch');
      assert.ok(hub.npcs.some((n) => n.pose === 'work'), 'someone works at the bench');
      const bench = hub.stations.find((s) => s.kind === 'workbench');
      const camp = hub.stations.find((s) => s.kind === 'campfire');
      assert.ok(hub.npcs.some((n) => n.pose === 'work' && dist(n, bench) < 260), 'the mechanic is at the workbench');
      assert.ok(hub.npcs.some((n) => n.pose === 'sit' && dist(n, camp) < 260), 'the kid sits at the fire');
    });

    test(`${id} seed ${seed}: hand placed dressing stays clear of obstacles and water`, () => {
      const m = getMap(id, seed);
      const items = buildDress(m);
      assert.ok(items.length >= 100, `${items.length} dress items`);
      assert.deepEqual(items, hideoutDressItems(m), 'buildDress hands a hideout to its own dressing');
      const water = m.areas.filter((a) => a.kind === 'water');
      const fire = m.hub.stations.find((s) => s.kind === 'campfire');
      const hand = m.hub.dress.length;
      items.forEach((it, i) => {
        assert.ok(DRESS_KINDS[it.k], `unknown dress kind ${it.k}`);
        assert.ok(finite(it.x, it.y, it.a, it.s) && it.s > 0 && it.x > 0 && it.y > 0 && it.x < m.width && it.y < m.height);
        assert.ok(it.q >= 0 && it.q <= 1);
        // hand placed items may lean on furniture; nothing sits in a solid wall, and the scatter keeps clear of everything
        for (const o of m.obstacles) {
          if (i >= hand || o.solid) assert.ok(!inRect(o, it.x, it.y, i >= hand ? 0 : -3), `${it.k} at ${it.x},${it.y} inside ${o.kind} #${o.id}`);
        }
        if (i >= hand) {
          for (const w of water) assert.ok(!inRect(w, it.x, it.y, 0), `${it.k} in the pond`);
          assert.ok(dist(it, fire) > 30, `${it.k} in the fire`);
        }
      });
    });
  }

  test(`${id}: every prop kind the hub uses has a model, every position is valid`, () => {
    const m = getMap(id);
    const kinds = new Set(HUB_PROP_KINDS);
    for (const p of m.hub.props) {
      assert.ok(kinds.has(p.t), `unknown prop kind ${p.t}`);
      checkProp(p, m, id);
    }
    for (const o of m.obstacles) if (o.prop && !o.prop.startsWith('slot:')) assert.ok(kinds.has(o.prop), `obstacle prop ${o.prop}`);
    // unique anchors: the same free prop is never stacked on the very same spot
    const seen = new Set();
    for (const p of m.hub.props) {
      if (pathLike(p)) continue;
      const key = `${p.t}:${Math.round(p.x)}:${Math.round(p.y)}`;
      assert.ok(!seen.has(key), `duplicate ${key}`);
      seen.add(key);
    }
  });
}

test('each hideout has its own look: roadhouse and depot at night, the farmstead at golden hour', () => {
  assert.equal(getMap('roadhouse').hub.defaultTime, 'night');
  assert.equal(getMap('depot').hub.defaultTime, 'night');
  assert.equal(getMap('farmstead').hub.defaultTime, 'day');
  const look = getMap('farmstead').hub.look;
  assert.ok(look && look.day && look.day.warm >= 1, 'a warm grade override for the sunset');
  for (const id of HIDEOUT_IDS) {
    const hub = getMap(id).hub;
    assert.ok(hub.range && hub.range.targets.length >= 3, `${id}: range targets`);
    assert.ok(getMap(id).interactables.some((i) => i.kind === 'range'));
  }
});

// ---- upgrades: the slot seam ----------------------------------------------------------------------

test('normalizeUpgrades cleans the story settings', () => {
  const z = normalizeUpgrades(null);
  assert.deepEqual(Object.keys(z).sort(), [...UPGRADE_KINDS].sort());
  assert.ok(Object.values(z).every((v) => v === 0));
  assert.deepEqual(normalizeUpgrades({ generator: 2, watchtower: 9, infirmary: -3, armory: 1.7, radio: 3, medbay: 1, junk: 5, garden: 'x', palisade: NaN }),
    { generator: 2, watchtower: 3, infirmary: 1, armory: 1, radiomast: 3, garden: 0, palisade: 0 });
  assert.equal(UPGRADE_MAX_TIER, 3);
  assert.deepEqual([...UPGRADE_KINDS], ['generator', 'watchtower', 'infirmary', 'armory', 'radiomast', 'garden', 'palisade']);
  const m = buildMap('roadhouse', 3);
  assert.equal(m.hub.upgrades.generator, 0, 'nothing is built at the start');
  applyHideoutUpgrades(m, { generator: 2, garden: 3 });
  assert.equal(m.hub.upgrades.generator, 2);
  assert.equal(m.hub.upgrades.garden, 3);
  assert.equal(m.hub.upgrades.palisade, 0);
});

for (const id of HIDEOUT_IDS) {
  test(`${id}: every tier of every upgrade builds valid content inside the hub`, () => {
    const m = getMap(id);
    const hub = m.hub;
    const kinds = new Set(HUB_PROP_KINDS);
    assert.deepEqual(Object.keys(hub.upgradeSlots).sort(), [...UPGRADE_KINDS].sort(), 'a slot for every upgrade');
    const slots = [];
    for (const kind of UPGRADE_KINDS) {
      const slot = hub.upgradeSlots[kind];
      assert.ok(finite(slot.x, slot.y, slot.a, slot.r) && slot.r > 20, `${kind} slot`);
      assert.equal(slot.maxTier, UPGRADE_MAX_TIER);
      assert.ok(typeof slot.label === 'string' && slot.label.length > 2);
      assert.equal(slot.tiers.length, UPGRADE_MAX_TIER + 1, 'the site and three tiers');
      // the footprint collides at every tier: it is in the base map, not in the tiers
      // (the palisade's is the perimeter, the depot's watchtower stands on the water tower's legs, the farm's armory in the barn)
      const fp = m.obstacles.find((o) => o.prop === `slot:${kind}`) || m.obstacles.find((o) => dist(o, slot) <= slot.r);
      assert.ok(fp, `${kind}: a footprint obstacle in the base map`);
      slots.push(slot);
      for (let t = 0; t <= UPGRADE_MAX_TIER; t++) {
        const u = buildHideoutUpgrade(kind, t, hub);
        assert.equal(u.kind, kind);
        assert.equal(u.tier, t);
        assert.deepEqual(u.slot, { x: slot.x, y: slot.y, a: slot.a, r: slot.r });
        assert.ok(u.props.length >= 1, `${kind} tier ${t} draws something`);
        for (const p of u.props) {
          assert.ok(kinds.has(p.t), `${kind}/${t}: unknown prop ${p.t}`);
          checkProp(p, m, `${kind}/${t}`);
          if (p.t === 'up_' + kind) assert.equal(p.tier, t);
          const at = pathLike(p) ? (p.pts ? { x: p.pts[0][0], y: p.pts[0][1] } : { x: p.x1, y: p.y1 }) : p;
          assert.ok(at.x >= hub.bounds.x0 - 60 && at.x <= hub.bounds.x1 + 60 && at.y >= hub.bounds.y0 - 60 && at.y <= hub.bounds.y1 + 60, `${kind}/${t}: ${p.t} at ${at.x},${at.y} outside the hub`);
        }
        for (const l of u.lights) {
          assert.ok(finite(l.x, l.y, l.r) && l.r > 0 && l.x > 0 && l.y > 0 && l.x < m.width && l.y < m.height, `${kind}/${t}: light`);
          assert.match(l.color, HEX);
        }
        for (const f of u.fires) assert.ok(finite(f.x, f.y, f.r) && f.x > 0 && f.y > 0 && f.x < m.width && f.y < m.height, `${kind}/${t}: fire`);
        // a fresh copy each time: callers may edit it
        u.props[0].x = -1;
        assert.notEqual(buildHideoutUpgrade(kind, t, hub).props[0].x, -1, 'copies');
      }
      // the model of the slot is a real, tiered prop kind and grows: tier 3 draws at least as much as the site
      const site = buildHideoutUpgrade(kind, 0, hub), top = buildHideoutUpgrade(kind, 3, hub);
      assert.ok(top.props.length + top.lights.length >= site.props.length, `${kind} grows`);
    }
    // slots do not sit on top of one another
    // (the palisade is the fence line all round: its slot is the whole yard)
    const spots = slots.filter((s) => s.kind !== 'palisade');
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) assert.ok(dist(spots[i], spots[j]) >= (spots[i].r + spots[j].r) * 0.5, `slots ${spots[i].kind}/${spots[j].kind} overlap`);
    }
    assert.throws(() => buildHideoutUpgrade('moat', 1, hub));
    assert.equal(buildHideoutUpgrade('garden', 99, hub).tier, 3, 'tier clamps');
  });

  test(`${id}: the upgrade set merges the built tiers (the site shows only for unbuilt slots)`, () => {
    const m = buildMap(id, 1);
    const none = hideoutUpgradeSet(m, null);
    for (const k of UPGRADE_KINDS) assert.ok(none.props.some((p) => p.up === k && p.tier === 0), `${k}: the site`);
    assert.ok(none.props.every((p) => p.tier === 0));
    const max = hideoutUpgradeSet(m, Object.fromEntries(UPGRADE_KINDS.map((k) => [k, 3])));
    assert.ok(max.props.every((p) => p.tier >= 1 && p.tier <= 3));
    for (const k of UPGRADE_KINDS) {
      for (let t = 1; t <= 3; t++) assert.ok(max.props.some((p) => p.up === k && p.tier === t), `${k}: tier ${t} present at max`);
    }
    assert.ok(max.props.length > none.props.length);
    assert.ok(max.lights.length > none.lights.length, 'built upgrades light the hub');
    const some = hideoutUpgradeSet(m, { generator: 1, palisade: 2 });
    assert.ok(some.props.some((p) => p.up === 'generator' && p.tier === 1) && !some.props.some((p) => p.up === 'generator' && p.tier === 0));
    assert.ok(some.props.some((p) => p.up === 'palisade' && p.tier === 2) && some.props.some((p) => p.up === 'palisade' && p.tier === 1));
    assert.ok(some.props.some((p) => p.up === 'garden' && p.tier === 0), 'the unbuilt ones still show their site');
    // reading map.hub.upgrades as the default
    applyHideoutUpgrades(m, { generator: 3 });
    assert.equal(hideoutUpgradeSet(m).upgrades.generator, 3);
  });
}

// ---- the shooting range in the sim ------------------------------------------------------------------

test('range: dummies stand still, take no damage and report every hit', () => {
  const m = buildMap('roadhouse', 1);
  const g = makeGame({ map: m, settings: { mode: 'hideout' }, sandbox: false });
  assert.equal(g.mode, 'hideout');
  assert.ok(g.range, 'a hideout game has a range');
  const targets = m.hub.range.targets;
  assert.equal(g.zombies.length, targets.length);
  for (const z of g.zombies) assert.ok(z.dummy && isRangeTarget(m, z.x, z.y) && z.hp === DUMMY_HP);
  // no waves in a hideout, whatever the timers say
  for (let i = 0; i < 60 * 40; i++) g.step();
  assert.equal(g.phase, 'prep');
  assert.equal(g.zombies.length, targets.length);
  assert.equal(g.remaining(), 0, 'dummies are not a threat');

  // shoot the first dummy from the firing line
  const t = targets[0];
  const dummy = g.zombies.find((z) => Math.abs(z.x - t.x) < 1 && Math.abs(z.y - t.y) < 1);
  place(g, 1, t.x - 220, t.y, 0);
  const p = g.getPlayer(1);
  p.weapon = p.weapon || 'pistol';
  const events = run(g, 90, (game, tick) => ({ 1: { angle: 0, fire: tick % 8 < 3 } }));
  const hits = events.filter((e) => e.type === 'rangehit');
  assert.ok(hits.length >= 1, 'the shots were reported');
  for (const h of hits) {
    assert.ok(finite(h.x, h.y, h.dmg, h.dist) && h.dmg > 0 && h.by === 1, JSON.stringify(h));
    assert.ok(targets.some((tt) => tt.id === h.tid && Math.abs(tt.x - h.x) <= 1 && Math.abs(tt.y - h.y) <= 1));
  }
  assert.ok(hits.some((h) => h.tid === t.id && h.dist > 150 && h.dist < 260), 'the distance is reported');
  assert.ok(!dummy.dead && dummy.hp === DUMMY_HP, 'the dummy never dies');
  assert.ok(Math.abs(dummy.x - t.x) < 0.01 && Math.abs(dummy.y - t.y) < 0.01, 'and never moves');
  assert.equal(g.zombies.length, targets.length);
  assert.ok(g.getPlayer(1).state === 'alive');
});

test('range: other modes and maps are untouched', () => {
  for (const mapId of ['highway', 'truckstop']) {
    const g = makeGame({ map: buildMap(mapId, 1), sandbox: true });
    assert.equal(g.range, null);
    assert.equal(g.mode, 'defend');
    assert.equal(g.zombies.length, 0);
  }
  // asking a battlefield for the hideout mode gives its own first mode
  const g = makeGame({ map: buildMap('highway', 1), settings: { mode: 'hideout' }, sandbox: true });
  assert.equal(g.mode, 'defend');
  assert.equal(g.range, null);
  // a hideout map with a non-hideout mode request plays as a hideout (its only mode) with the range
  const h = makeGame({ map: buildMap('depot', 1), settings: { mode: 'defend' }, sandbox: false });
  assert.equal(h.mode, 'hideout');
  assert.ok(h.range);
  assert.ok(!isRangeTarget(buildMap('highway', 1), 100, 100));
});

// ---- audio ------------------------------------------------------------------------------------------

test('ambience: spots per hideout, the bed by time of day, the score turns warm', async () => {
  const spots = (id) => hubSpots(getMap(id)).map((s) => s.id);
  assert.ok(spots('roadhouse').includes('hub_radio') && spots('roadhouse').includes('hub_gen'));
  assert.ok(spots('depot').includes('hub_forge'));
  for (const s of ['hub_coop', 'hub_water', 'hub_windmill']) assert.ok(spots('farmstead').includes(s), s);
  for (const s of hubSpots(getMap('farmstead'))) assert.ok(SOUNDS[s.id] && SOUNDS[s.id].loop, `${s.id} is a loop`);
  assert.ok(Object.keys(HUB_SOUNDS).every((id) => SOUNDS[id] === HUB_SOUNDS[id]), 'registered in the bank');
  for (const id of Object.keys(HUB_SOUNDS)) {
    const b = renderSound(id, 8000, 0);
    let pk = 0;
    for (let i = 0; i < b.length; i++) { assert.ok(Number.isFinite(b[i])); pk = Math.max(pk, Math.abs(b[i])); }
    assert.ok(pk > 0.3 && pk <= 0.9 + 1e-6, `${id} peak ${pk}`);
  }
  const st = MUSIC_STATES.hideout;
  assert.ok(st && st.bar === 12 && st.bpm <= 64, 'a slow waltz');
  const secs = st.phrases.reduce((s, n) => s + buildPhrase('hideout', n, createRng(3)).len * st.tick, 0);
  assert.ok(secs >= 60 && secs <= 130, `${secs.toFixed(0)} s of material`);
  assert.ok(st.phrases.every((n) => !/^(B|K|T)/.test(n)), 'no war drums');

  // a hideout game: the bed loops and the score switches to the hideout state; the fire crackles
  for (const [time, bed] of [['night', 'hub_night'], ['day', 'hub_day']]) {
    const ctx = new MockAudioContext(8000);
    const audio = createAudio({ context: ctx, manual: true, syncBake: true, clock: () => ctx.currentTime });
    await audio.unlock();
    const m = buildMap('farmstead', 1);
    audio.setMap(m, { time });
    const fire = m.hub.stations.find((s) => s.kind === 'campfire');
    const view = {
      tick: 1, phase: 'prep', wave: 0, totalWaves: 0, timer: 20, remaining: 0, bossHp: -1, objective: null,
      players: [{ id: 1, x: fire.x, y: fire.y, angle: 0, state: 'alive', hp: 100, maxHp: 100, slot: 0, slots: ['pistol'], cls: 'soldier' }],
      zombies: [], projectiles: [], pickups: [], turrets: [], barricades: [], hazards: [], events: [],
    };
    for (let f = 0; f < 40; f++) {
      ctx.currentTime = f / 20;
      audio.update(view, { localId: 1, dt: 0.05 });
    }
    const s = audio.stats();
    assert.equal(s.musicMode, 'hideout');
    assert.ok(s.loops >= 2, `${time}: ${s.loops} loops`);
    const wanted = new Set(ctx.sources.filter((x) => x.loop).map((x) => x.buffer));
    assert.ok(wanted.size >= 2, 'bed + fire are playing');
    audio.setMap(null);
  }
});

// ---- the renderer's model registry, headless ---------------------------------------------------------

let THREE, hubMod, geoMod;

before(async () => {
  globalThis.document = {
    createElement: () => {
      const c = { width: 1, height: 1, style: {} };
      const grad = { addColorStop() {} };
      const methods = {
        createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        measureText: () => ({ width: 10 }),
      };
      c.getContext = () => new Proxy({ canvas: c }, { get: (t, p) => (p in methods ? methods[p] : p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
      return c;
    },
  };
  THREE = await import('three');
  geoMod = await import('../public/js/render3d/world-geo.js');
  hubMod = await import('../public/js/render3d/world-hideout.js');
});

/** Build a hideout's hero models headless: { tris, geoms, warnings }. */
function buildHubGeometry(map, { upgrades = null, quality = 'high' } = {}) {
  const buckets = {
    std: { det: true }, paint: { det: true }, glass: { det: true }, decal: { uv: true }, glow: { uv: true, ao: false },
    neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false },
    sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true }, ...hubMod.HUB_BUCKETS,
  };
  const newBuilder = () => geoMod.createGeoBuilder({ cell: 1600, buckets });
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  try {
    const ctx = { map, quality };
    const root = new THREE.Group();
    const hideout = hubMod.createHideout(ctx, {
      root, mats: {}, fx: null, halos: [], day: false, aniso: 1, gy: () => 0, tier: quality, newBuilder, matOf: () => new THREE.MeshBasicMaterial(),
    });
    const B = newBuilder();
    let n = 0;
    for (const o of map.obstacles) {
      B.obj(o.x, o.y, o.a || 0, o.id * 31);
      hideout.obstacle(B, o);
      n++;
    }
    if (map.objective) { B.obj(map.objective.x, map.objective.y, map.objective.a || 0, 999); hideout.objective(B, map.objective); }
    hideout.props(B);
    const parts = B.finish();
    let tris = 0;
    for (const { geometry } of parts) tris += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    let upTris = 0, upGeoms = 0;
    if (upgrades) {
      hideout.setUpgrades(upgrades);
      hideout.finish();
      hideout.setUpgrades(upgrades);
      root.children.forEach((c) => { if (c.geometry && c.userData.hubUp) { upGeoms++; upTris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3; } });
    }
    hideout.dispose();
    void n;
    return { tris, geoms: parts.length, upTris, upGeoms, warnings };
  } finally {
    console.warn = warn;
  }
}

test('renderer: a model exists for every prop kind and none throws', () => {
  // (world-hideout.js is the registry: an unknown kind or a throwing model warns and draws nothing)
  for (const id of HIDEOUT_IDS) {
    const r = buildHubGeometry(getMap(id));
    assert.deepEqual(r.warnings, [], `${id}: ${r.warnings.join(' | ')}`);
    assert.ok(r.tris > 20000, `${id}: ${r.tris} triangles of hero models`);
  }
});

test('renderer: every upgrade tier of every hideout builds, within budget', (t) => {
  for (const id of HIDEOUT_IDS) {
    const m = getMap(id);
    const base = buildHubGeometry(m);
    const none = buildHubGeometry(m, { upgrades: {} });
    const max = buildHubGeometry(m, { upgrades: Object.fromEntries(UPGRADE_KINDS.map((k) => [k, 3])) });
    t.diagnostic(`${id}: hero models ${Math.round(base.tris)} tris in ${base.geoms} meshes; upgrade layer ${Math.round(none.upTris)} tris (none) / ${Math.round(max.upTris)} tris in ${max.upGeoms} meshes (max)`);
    assert.deepEqual([...none.warnings, ...max.warnings], [], `${id}: warnings`);
    assert.ok(max.upTris > none.upTris, `${id}: the built hideout draws more than the site (${max.upTris} vs ${none.upTris})`);
    assert.ok(max.upTris < 260000, `${id}: upgrade layer ${max.upTris} triangles`);
    assert.ok(base.tris < 700000, `${id}: hero models ${base.tris} triangles`);
    assert.ok(max.upGeoms <= 30, `${id}: upgrade layer ${max.upGeoms} meshes`);
    // each single tier of each upgrade on its own
    for (const k of UPGRADE_KINDS) {
      for (let t = 1; t <= 3; t++) {
        const r = buildHubGeometry(m, { upgrades: { [k]: t } });
        assert.deepEqual(r.warnings, [], `${id}/${k}/${t}: ${r.warnings.join(' | ')}`);
      }
    }
  }
});
