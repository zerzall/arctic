// Evac Run (settings.mode 'zone', SPEC §3.7): the moving safe zone, its map (Harlan County)
// and the points of interest on every map, the blight, the shrink, spawns, bots, the wire
// format, the lobby rules and the host tick on the big map.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/shared/sim.js';
import { MAP_LIST, buildMap } from '../public/js/shared/maps.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import {
  ZONE, MODE_LIST, MODE_IDS, STANDARD_MODES, mapModes, fixModeCombo, moveTime, fogDps, shrinkCircle, insideZone, nearSupply, zoneName,
} from '../public/js/shared/zone.js';
import { zoneSequence, walkComponents, componentAt, nearestPoi } from '../public/js/shared/sim/zone.js';
import { encodeSnapshot, decodeSnapshot, EVENT_TYPES } from '../public/js/shared/protocol.js';
import { interpolateSnapshots } from '../public/js/net/interpolation.js';
import { mergeSettings } from '../public/js/net/lobby-rules.js';
import { loadPrefs, savePrefs } from '../public/js/ui/storage.js';
import { DEFAULT_SETTINGS, NAV_REBUILD_INTERVAL, TICK_RATE, PLAYER_RADIUS, SUPPLY_RADIUS } from '../public/js/shared/constants.js';
import { cmd, addZombie, godMode } from './helpers/sim-helpers.js';

const DT = 1 / 60;
const maps = new Map();
function getMap(id, seed = 1) {
  const k = `${id}:${seed}`;
  if (!maps.has(k)) maps.set(k, buildMap(id, seed));
  return maps.get(k);
}

function bots(n, skill = 1) {
  const cls = ['medic', 'soldier', 'engineer', 'heavy', 'scout', 'demo'];
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Bot${i + 1}`, color: i, cls: cls[i % cls.length], bot: true, botSkill: skill }));
}

function zoneGame({ mapId = 'harlan', seed = 11, players = bots(4), waves = 15, difficulty = 'normal' } = {}) {
  return new Game({ mapId, seed, settings: { difficulty, waves, mode: 'zone' }, players });
}

/** Step until `until(g)` or `max` ticks, draining snapshots; returns the events seen. */
function run(g, max, until = null, each = null) {
  const events = [];
  for (let t = 0; t < max; t++) {
    if (each) each(g, t);
    g.step();
    if (t % 3 === 0) events.push(...g.snapshot().events);
    if (until && until(g)) break;
  }
  events.push(...g.snapshot().events);
  return events;
}

/** Jump straight into a locked wave at the current zone (no zombies spawned by the test). */
function startWave(g) {
  g.timer = 0;
  for (const p of g.players) p.ready = true;
  // Everyone in: the ready vote may start the wave early.
  const c = g.zone.circle;
  g.players.forEach((p, i) => {
    const sp = g.zone.spawnPoint(i);
    p.x = sp.x;
    p.y = sp.y;
  });
  g.step();
  assert.equal(g.phase, 'wave');
  assert.ok(c.r > 0);
}

// ---------------------------------------------------------------------------------------
describe('modes and maps', () => {
  test('three modes, defend first (the default); Harlan County is an Evac Run / campaign map', () => {
    assert.deepEqual(MODE_IDS, ['defend', 'zone', 'campaign']);
    assert.equal(DEFAULT_SETTINGS.mode, 'defend');
    for (const m of MODE_LIST) assert.ok(m.name && m.description.length > 20);
    const harlan = MAP_LIST.find((m) => m.id === 'harlan');
    assert.ok(harlan, 'the new map is listed');
    assert.deepEqual(mapModes(harlan), ['zone', 'campaign']);
    for (const m of MAP_LIST) {
      if (m.id === 'harlan') continue;
      const ext = ['highway', 'checkpoint'].includes(m.id);
      assert.deepEqual(mapModes(m), ext ? MODE_IDS : STANDARD_MODES, `${m.id} plays ${ext ? 'all three' : 'both standard modes'}`);
    }
    assert.deepEqual(getMap('harlan').modes, ['zone', 'campaign']);
  });

  test('every map has points of interest the zone can use', () => {
    for (const { id } of MAP_LIST) {
      const m = getMap(id);
      assert.ok(m.pois.length >= (id === 'harlan' ? 10 : 5), `${id}: ${m.pois.length} POIs`);
      const names = new Set();
      for (const p of m.pois) {
        assert.equal(typeof p.name, 'string');
        assert.ok(p.name.length > 2 && p.name.length <= 24, `${id}: name "${p.name}"`);
        assert.ok(!names.has(p.name), `${id}: duplicate POI ${p.name}`);
        names.add(p.name);
        for (const k of ['x', 'y', 'r']) assert.ok(Number.isFinite(p[k]), `${id} ${p.name}.${k}`);
        assert.ok(p.x > 100 && p.y > 100 && p.x < m.width - 100 && p.y < m.height - 100, `${id} ${p.name} inside the map`);
        assert.ok(p.r >= 300 && p.r <= 800, `${id} ${p.name} radius ${p.r}`);
      }
      // the POIs are fixed layout: the seed changes only the dressing
      assert.deepEqual(buildMap(id, 99).pois, m.pois);
    }
  });

  test('Harlan County: a big square map with ten distinct places', () => {
    const m = getMap('harlan');
    assert.ok(m.width >= 6000 && m.width <= 8000 && m.height === m.width, `${m.width} x ${m.height}`);
    assert.equal(m.pois.length, 10);
    // spread out: every place is far from the others, and the farthest pairs are far apart
    for (const p of m.pois) {
      const d = m.pois.filter((q) => q !== p).map((q) => Math.hypot(q.x - p.x, q.y - p.y));
      assert.ok(Math.min(...d) >= 1400, `${p.name} crowds its neighbour (${Math.min(...d).toFixed(0)} px)`);
      assert.ok(d.some((x) => x >= ZONE.pick.near && x <= ZONE.pick.far), `${p.name} has a next zone at a good distance`);
    }
    const kinds = new Set(m.obstacles.map((o) => o.kind));
    for (const k of ['building', 'silo', 'grave', 'hesco', 'tent', 'bus', 'pump', 'pier', 'ramp', 'tree', 'rock', 'container']) assert.ok(kinds.has(k), `has ${k}`);
    assert.ok(m.overpass && m.overpass.decks.filter((d) => d.kind === 'ramp').length === 4, 'the I-70 interchange');
    assert.ok(m.areas.some((a) => a.kind === 'water'), 'the lake');
    assert.ok(m.obstacles.length <= 900, `obstacles ${m.obstacles.length}`);
    assert.ok(m.lights.length >= 30 && m.fires.length >= 5);
    const world = createCollisionWorld(m);
    for (const p of m.playerSpawns) assert.ok(world.isCircleFree(p.x, p.y, PLAYER_RADIUS + 2, false), `spawn ${p.x},${p.y}`);
    assert.equal(nearestPoi(m.pois, m.playerSpawns[0].x, m.playerSpawns[0].y), 0, 'the team starts on Main Street');
  });

  test('every POI is reachable from every other through the zombie flow field (every map)', () => {
    for (const { id } of MAP_LIST) {
      const m = getMap(id, 42);
      const world = createCollisionWorld(m);
      const field = new FlowField(m, { colliders: world.colliders, pad: 3 });
      const comp = walkComponents(field);
      const main = componentAt(field, comp, m.playerSpawns[0].x, m.playerSpawns[0].y);
      for (const p of m.pois) assert.equal(componentAt(field, comp, p.x, p.y), main, `${id}: ${p.name} is cut off`);
      // and the real field built toward one POI leads there from all the others
      for (const src of [m.pois[0], m.pois[m.pois.length - 1]]) {
        field.update([{ x: src.x, y: src.y }]);
        const out = { x: 0, y: 0 };
        for (const p of m.pois) {
          assert.ok(field.reachable(p.x, p.y) || field.distanceAt(p.x, p.y) < Infinity, `${id}: ${p.name} → ${src.name}`);
          assert.ok(field.sample(p.x, p.y, out), `${id}: a way from ${p.name}`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------
describe('the zone sequence', () => {
  test('deterministic per (map, seed), never the same POI twice in a row, at a good distance', () => {
    for (const { id } of MAP_LIST) {
      const m = getMap(id);
      const a = zoneSequence(m, 1234, 0, 40), b = zoneSequence(m, 1234, 0, 40);
      assert.deepEqual(a, b, `${id}: same seed, same order`);
      assert.notDeepEqual(zoneSequence(m, 99, 0, 40), a, `${id}: another seed, another order`);
      let prev = 0;
      for (const i of a) {
        assert.ok(Number.isInteger(i) && i >= 0 && i < m.pois.length);
        assert.notEqual(i, prev, `${id}: repeated ${m.pois[i].name}`);
        prev = i;
      }
      assert.ok(new Set(a).size >= Math.min(5, m.pois.length - 1), `${id}: the zone gets around (${new Set(a).size} places)`);
      const seq = [0, ...a];
      for (let i = 2; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 2], `${id}: straight back to ${m.pois[seq[i]].name}`);
    }
    // Harlan County: every hop is within the preferred distance band
    const m = getMap('harlan');
    let prev = 0;
    for (const i of zoneSequence(m, 7, 0, 60)) {
      const d = Math.hypot(m.pois[i].x - m.pois[prev].x, m.pois[i].y - m.pois[prev].y);
      assert.ok(d >= ZONE.pick.near && d <= ZONE.pick.far, `hop ${m.pois[prev].name} → ${m.pois[i].name}: ${d.toFixed(0)} px`);
      prev = i;
    }
    // A small map (Truck Stop: no POI that far): the zone still hops to the farther half
    const ts = getMap('truckstop');
    prev = 0;
    for (const i of zoneSequence(ts, 7, 0, 60)) {
      const from = ts.pois[prev];
      const ds = ts.pois.map((p) => Math.hypot(p.x - from.x, p.y - from.y)).filter((d) => d > 0).sort((x, y) => y - x);
      const d = Math.hypot(ts.pois[i].x - from.x, ts.pois[i].y - from.y);
      assert.ok(d >= ds[Math.ceil(ds.length / 2) - 1], `truckstop hop ${from.name} → ${ts.pois[i].name}: ${d.toFixed(0)} px`);
      prev = i;
    }
  });

  test('the game follows the sequence: announced at game start and after every clear', () => {
    const g = zoneGame({ seed: 5, waves: 4 });
    const seq = zoneSequence(g.map, g.seed, 0, 5);
    const first = g.snapshot();
    const ev = first.events.find((e) => e.type === 'zone');
    assert.deepEqual({ stage: ev.stage, poi: ev.poi }, { stage: 'next', poi: seq[0] });
    assert.equal(first.zone.poi, seq[0]);
    assert.equal(first.zone.stage, 0);
    assert.equal(first.phase, 'prep');
    assert.equal(first.objective, null, 'no objective in an Evac Run');
    const d = Math.hypot(g.map.pois[seq[0]].x - g.map.pois[0].x, g.map.pois[seq[0]].y - g.map.pois[0].y);
    assert.equal(g.timer, moveTime(d, true), 'the prep phase is the move to the first zone');
    const seen = [first.zone.poi];
    const events = run(g, 60 * 60 * 20, (gg) => gg.over || seen.length >= 4, (gg) => {
      // clear waves at once: kill everything, keep everyone in the circle
      for (const z of gg.zombies) z.hp = 0, z.dead = true;
      gg.spawnQueue = 0;
      gg.bossQueue = 0;
      godMode(gg);
      if (gg.phase === 'intermission' && gg.zone.poi !== seen[seen.length - 1]) seen.push(gg.zone.poi);
    });
    assert.deepEqual(seen, seq.slice(0, seen.length));
    assert.ok(events.filter((e) => e.type === 'zone' && e.stage === 'next').length >= 3);
  });

  test('move time scales with the distance (and prep adds time to shop)', () => {
    assert.equal(moveTime(0), ZONE.move.min);
    assert.equal(moveTime(1e6), ZONE.move.max);
    assert.ok(moveTime(4000) > moveTime(3000));
    assert.equal(moveTime(4000, true), moveTime(4000) + ZONE.move.prepExtra);
    const t = moveTime(4000);
    assert.ok(t >= 25 && t <= 45, `4000 px: ${t} s`);
  });
});

// ---------------------------------------------------------------------------------------
describe('the circle, the shrink and the blight', () => {
  test('the wave locks the circle, it holds, then shrinks inside itself', () => {
    const g = zoneGame({ seed: 3, players: bots(1) });
    g.bots.length = 0;   // a still survivor
    const p = g.players[0];
    startWave(g);
    const c0 = { ...g.zone.circle };
    const lock = g.snapshot().events.find((e) => e.type === 'zone' && e.stage === 'lock');
    assert.ok(lock, 'lock event');
    let shrinkEv = null, t = 0;
    for (; t < (ZONE.hold + ZONE.shrink + 3) * 60; t++) {
      godMode(g);
      g.zombies.forEach((z) => { z.dead = true; });
      g.spawnQueue = 1;   // keep the wave going
      const c = g.zone.circle;
      p.x = c.x;
      p.y = c.y;
      g.step();
      const ev = g.snapshot().events.find((e) => e.type === 'zone' && e.stage === 'shrink');
      if (ev) shrinkEv = { ev, t };
      if (t < ZONE.hold * 60 - 2) assert.equal(g.zone.circle.r, c0.r, 'holds its size');
    }
    assert.ok(shrinkEv, 'shrink event');
    assert.ok(Math.abs(shrinkEv.t / 60 - ZONE.hold) < 0.1, `shrink starts after ${ZONE.hold} s (${(shrinkEv.t / 60).toFixed(2)})`);
    const z = g.zone.circle;
    assert.equal(g.zone.stage, 3, 'final');
    assert.ok(Math.abs(z.r - Math.round(c0.r * ZONE.shrinkTo)) <= 1, `radius ${z.r}`);
    assert.ok(Math.hypot(z.x - c0.x, z.y - c0.y) + z.r <= c0.r + 1, 'the new circle lies inside the old one');
    // the eased path: halfway through the shrink the radius is halfway
    const mid = shrinkCircle({ x: 0, y: 0, r: 100 }, { x: 10, y: 0, r: 50 }, ZONE.shrink / 2);
    assert.ok(Math.abs(mid.r - 75) < 1e-9 && Math.abs(mid.x - 5) < 1e-9);
  });

  test('outside the circle: escalating damage that armour does not stop; inside: none', () => {
    const g = zoneGame({ seed: 8, players: bots(2) });
    g.bots.length = 0;
    startWave(g);
    const [b, a] = g.players;   // (b is the medic: its aura must not heal a)
    const c = g.zone.circle;
    a.armor = 100;
    const out = { x: c.x + c.r + 150, y: c.y };
    const world = g.world;
    for (let d = 150; d < 1200 && !world.isCircleFree(out.x, out.y, 20, true); d += 40) out.x = c.x + c.r + d;
    const hp0 = a.hp;
    const losses = [];
    for (let s = 0; s < 6; s++) {
      const before = a.hp;
      for (let t = 0; t < 60; t++) {
        a.x = out.x; a.y = out.y;
        const sp = g.zone.spawnPoint(1);
        b.x = sp.x; b.y = sp.y;
        b.hp = b.maxHp;
        g.zombies.forEach((z) => { z.dead = true; });
        g.spawnQueue = 1;
        g.step();
      }
      losses.push(before - a.hp);
    }
    assert.equal(a.armor, 100, 'armour does not help against the blight');
    assert.equal(b.hp, b.maxHp, 'no damage inside');
    for (let i = 1; i < losses.length; i++) assert.ok(losses[i] > losses[i - 1], `escalates: ${losses.map((x) => x.toFixed(1)).join(', ')}`);
    assert.ok(Math.abs(losses[0] - (fogDps(0, 1) + fogDps(1, 1)) / 2) < 1, `first second ≈ ${fogDps(0.5, 1).toFixed(1)} hp`);
    assert.ok(hp0 - a.hp < a.maxHp, 'not dead after 6 s');
    const ev = g.snapshot().events.filter((e) => e.type === 'pdamage' && e.pid === a.id);
    assert.ok(ev.length >= 5, 'reported in chunks like acid');
    assert.ok(fogDps(100, 1) === ZONE.fog.max, 'capped');
    assert.ok(fogDps(0, 10) > fogDps(0, 1), 'later waves hurt more');
  });

  test('downed in the blight: bleeds out faster, never instantly, and the fog stops at the edge', () => {
    const g = zoneGame({ seed: 8, players: bots(2) });
    g.bots.length = 0;
    startWave(g);
    const [a, b] = g.players;
    const c = g.zone.circle;
    a.x = c.x + c.r + 200;
    a.y = c.y;
    g.world.resolveCircle(a, PLAYER_RADIUS);
    a.hp = 1;
    let t = 0;
    while (a.state === 'alive' && t++ < 600) {
      g.zombies.forEach((z) => { z.dead = true; });
      g.spawnQueue = 1;
      const sp = g.zone.spawnPoint(1);
      b.x = sp.x; b.y = sp.y;
      g.step();
    }
    assert.equal(a.state, 'downed');
    const bleed0 = a.bleedout;
    for (let i = 0; i < 120; i++) {
      g.zombies.forEach((z) => { z.dead = true; });
      g.spawnQueue = 1;
      g.step();
    }
    assert.equal(a.state, 'downed', 'still downed after 2 s');
    const lost = bleed0 - a.bleedout;
    assert.ok(Math.abs(lost - 2 * (1 + ZONE.fog.downedBleed)) < 0.1, `bleeds ${lost.toFixed(2)} s in 2 s`);
    assert.ok(insideZone({ x: 0, y: 0, r: 10 }, 5, 5) && !insideZone({ x: 0, y: 0, r: 10 }, 20, 0));
  });

  test('no blight between waves: the move is safe from the fog', () => {
    const g = zoneGame({ seed: 2, players: bots(1) });
    g.bots.length = 0;
    const p = g.players[0];
    const hp = p.hp;
    for (let t = 0; t < 600; t++) {
      g.zombies.forEach((z) => { z.dead = true; });
      g.step();
    }
    assert.equal(g.phase, 'prep');
    assert.ok(!insideZone(g.snapshot().zone, p.x, p.y), 'still far from the announced zone');
    assert.equal(p.hp, hp);
  });
});

// ---------------------------------------------------------------------------------------
describe('spawns, supply drops and respawns', () => {
  test('wave zombies spawn on open, connected ground in a ring around every Harlan POI', () => {
    const g = zoneGame({ seed: 4, players: bots(1) });
    g.bots.length = 0;
    const m = g.map;
    const comp = walkComponents(g.flow);
    const main = componentAt(g.flow, comp, m.pois[0].x, m.pois[0].y);
    m.pois.forEach((poi, i) => {
      g.zone.poi = i;
      Object.assign(g.zone.circle, { x: poi.x, y: poi.y, r: poi.r });
      Object.assign(g.zone.target, { x: poi.x, y: poi.y, r: poi.r });
      g.zone.stage = 1;
      const sr = g.zone.spawnRects();
      assert.ok(sr && sr.rects.length >= 10, `${poi.name}: ${sr ? sr.rects.length : 0} spawn boxes`);
      const angles = new Set();
      for (const r of sr.rects) {
        const d = Math.hypot(r.x - poi.x, r.y - poi.y);
        assert.ok(d >= poi.r + ZONE.spawn.ring[0] - 1 && d <= poi.r + ZONE.spawn.ring[1] + 1, `${poi.name}: box at ${d.toFixed(0)} px`);
        assert.ok(r.x - r.w / 2 > 0 && r.y - r.h / 2 > 0 && r.x + r.w / 2 < m.width && r.y + r.h / 2 < m.height);
        assert.ok(g.world.isCircleFree(r.x, r.y, r.w / 2, false), `${poi.name}: box in an obstacle`);
        assert.equal(componentAt(g.flow, comp, r.x, r.y), main, `${poi.name}: box cut off`);
        angles.add(Math.round(Math.atan2(r.y - poi.y, r.x - poi.x) * 2));
      }
      assert.ok(angles.size >= 6, `${poi.name}: they come from all around`);
    });
  });

  test('zombies spawned around a Harlan zone reach the survivors in its centre', () => {
    const g = zoneGame({ seed: 6, players: bots(1) });
    g.bots.length = 0;
    startWave(g);
    g.spawnQueue = 0;
    const p = g.players[0];
    const c = g.zone.circle;
    const sr = g.zone.spawnRects().rects;
    const zs = sr.filter((_, i) => i % 3 === 0).map((r, i) => {
      const z = addZombie(g, ['walker', 'runner', 'brute'][i % 3], r.x, r.y);
      z.speed = 110;
      z.specialCd = 1e9;
      return z;
    });
    const reached = new Set();
    for (let t = 0; t < 60 * 50 && reached.size < zs.length; t++) {
      p.hp = p.maxHp;
      const sp = g.zone.spawnPoint(0);
      p.x = sp.x; p.y = sp.y;
      g.spawnQueue = 1;
      g.step();
      for (const z of zs) if (Math.hypot(z.x - p.x, z.y - p.y) < 200) reached.add(z);
    }
    assert.equal(reached.size, zs.length, `${zs.length - reached.size} of ${zs.length} never arrived at ${zoneName(g.map, g.snapshot().zone)} (${c.x},${c.y})`);
  });

  test('a supply drop with loot waits in every new zone; its shop works mid-wave', () => {
    const g = zoneGame({ seed: 12, players: bots(2) });
    g.bots.length = 0;
    const s = g.snapshot();
    const z = s.zone;
    assert.ok(Math.hypot(z.sx - z.x, z.sy - z.y) <= z.r * 0.5, 'the drop is near the centre');
    assert.ok(g.world.isCircleFree(z.sx, z.sy, 30, false), 'on open ground');
    assert.ok(s.events.some((e) => e.type === 'drop' && Math.abs(e.x - z.sx) < 1 && Math.abs(e.y - z.sy) < 1), 'drop event');
    const loot = g.pickups.filter((k) => Math.hypot(k.x - z.sx, k.y - z.sy) < 120);
    assert.ok(loot.some((k) => k.kind === 'crate' && k.weapon), 'a weapon crate');
    assert.ok(loot.some((k) => k.kind === 'ammo') && loot.some((k) => k.kind === 'health'), 'ammo and first aid');
    assert.ok(loot.every((k) => k.life > g.timer), 'the loot outlasts the move');
    startWave(g);
    const [a] = g.players;
    a.cash = 5000;
    a.res[1] = 0;
    a.x = z.sx + SUPPLY_RADIUS * 0.5;
    a.y = z.sy;
    g.command(a.id, { type: 'buy', item: 'ammo' });
    assert.ok(g.snapshot().events.some((e) => e.type === 'buy' && e.pid === a.id), 'bought at the drop');
    assert.ok(nearSupply(g.map, z, a.x, a.y, SUPPLY_RADIUS));
    a.x = z.x + z.r + 500;
    a.res[1] = 0;
    g.command(a.id, { type: 'buy', item: 'ammo' });
    assert.ok(g.snapshot().events.some((e) => e.type === 'buyfail' && e.reason === 'closed'), 'not out in the fields');
  });

  test('late joiners and the respawned come back inside the zone', () => {
    const g = zoneGame({ seed: 9, players: bots(1) });
    g.bots.length = 0;
    const late = g.addPlayer({ id: 7, name: 'Late', color: 3, cls: 'scout' });
    assert.equal(late.state, 'alive');
    assert.ok(insideZone(g.zone.circle, late.x, late.y), 'a prep joiner starts in the announced zone');
    startWave(g);
    const mid = g.addPlayer({ id: 8, name: 'Mid', color: 4, cls: 'medic' });
    assert.equal(mid.state, 'dead');
    const c = { ...g.zone.circle };
    g.spawnQueue = 0;
    g.zombies.forEach((z) => { z.dead = true; });
    for (const p of g.players) if (p.state === 'alive') { const sp = g.zone.spawnPoint(0); p.x = sp.x; p.y = sp.y; }
    run(g, 5, (gg) => gg.phase === 'intermission');
    assert.equal(g.phase, 'intermission');
    assert.equal(mid.state, 'alive');
    assert.ok(Math.hypot(mid.x - c.x, mid.y - c.y) <= c.r, 'respawned in the cleared zone');
  });

  test('harassers find the team on the move', () => {
    const g = zoneGame({ seed: 14, players: bots(3) });
    g.bots.length = 0;
    let spawned = 0;
    for (let t = 0; t < g.timer * 60 - 30; t++) {
      godMode(g);
      g.step();
      spawned = Math.max(spawned, g.zombies.length);
    }
    assert.equal(g.phase, 'prep');
    assert.ok(spawned >= ZONE.harass.group[0], `${spawned} harassers`);
    for (const z of g.zombies) {
      const near = Math.min(...g.players.map((p) => Math.hypot(p.x - z.x, p.y - z.y)));
      assert.ok(near < 2000, 'they come for the team');
    }
  });

  test('a zombie stuck out in the blight re-enters, so the wave cannot stall on it', () => {
    const g = zoneGame({ mapId: 'truckstop', seed: 5, players: [{ id: 1, name: 'P', color: 0, cls: 'soldier' }] });
    startWave(g);
    const c = g.zone.circle, me = g.players[0];
    // an open spot out in the blight, 330-600 px from the survivor (inside the usual 650 px)
    let spot = null;
    for (let i = 0; i < 72 && !spot; i++) {
      const a = (i / 72) * Math.PI * 2;
      for (const d of [c.r + 120, c.r + 220, c.r + 320]) {
        const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
        const pd = Math.hypot(x - me.x, y - me.y);
        if (pd > 330 && pd < 600 && g.world.isCircleFree(x, y, 16, true)) {
          spot = { x, y };
          break;
        }
      }
    }
    assert.ok(spot, 'test setup: an open spot in the blight');
    const z = addZombie(g, 'walker', spot.x, spot.y);
    z.speed = 0.01; // stuck fast (no progress, as if wedged)
    for (let t = 0; t < 60 * 14 && Math.hypot(z.x - spot.x, z.y - spot.y) < 1; t++) {
      godMode(g);
      g.step();
    }
    assert.ok(!z.dead, 'test setup: the zombie is still there');
    assert.ok(Math.hypot(z.x - spot.x, z.y - spot.y) > 50, 'the stuck zombie re-entered from a spawn box');
  });
});

// ---------------------------------------------------------------------------------------
describe('the wire and the lobby', () => {
  test('zone state and events survive the snapshot round trip', () => {
    const g = zoneGame({ seed: 21, players: bots(2) });
    run(g, 200);
    startWave(g);
    run(g, (ZONE.hold + 5) * 60);
    const snap = g.snapshot();
    snap.events = [{ type: 'zone', stage: 'shrink', poi: 7, x: 5760, y: 5660, r: 360, time: 22 },
      { type: 'zone', stage: 'next', poi: 2, x: 5950, y: 1420, r: 700, time: 60 }];
    const z = snap.zone;
    const d = decodeSnapshot(encodeSnapshot(snap));
    for (const k of ['stage', 'poi', 'from']) assert.equal(d.zone[k], z[k], k);
    for (const k of ['x', 'y', 'r', 'nx', 'ny', 'nr', 'sx', 'sy']) assert.ok(Math.abs(d.zone[k] - z[k]) <= 0.25, `${k}: ${d.zone[k]} vs ${z[k]}`);
    for (const k of ['t', 'total']) assert.ok(Math.abs(d.zone[k] - z[k]) <= 0.01, k);
    assert.deepEqual(d.events, snap.events);
    assert.ok(EVENT_TYPES.includes('zone'), 'binary event schema');
    const bytes = encodeSnapshot(snap).byteLength - encodeSnapshot({ ...snap, zone: null }).byteLength;
    assert.ok(bytes <= 26, `zone block ${bytes} bytes`);
    // defend games carry no zone
    const plain = decodeSnapshot(encodeSnapshot({ ...snap, zone: null }));
    assert.equal(plain.zone, null);
    // clients glide the shrinking circle between snapshots
    const a = { ...d, zone: { ...d.zone, r: 400, t: 10 } }, b = { ...d, zone: { ...d.zone, r: 380, t: 9.9 } };
    const v = interpolateSnapshots(a, b, 0.5);
    assert.ok(Math.abs(v.zone.r - 390) < 1e-9 && Math.abs(v.zone.t - 9.95) < 1e-9);
    assert.equal(interpolateSnapshots(a, { ...b, zone: null }, 0.5).zone, null);
  });

  test('lobby settings: mode validated, incompatible map/mode picks resolved cleanly', () => {
    let s = mergeSettings(DEFAULT_SETTINGS, {});
    assert.equal(s.mode, 'defend');
    s = mergeSettings(s, { mode: 'zone' });
    assert.deepEqual([s.mapId, s.mode], ['highway', 'zone'], 'Evac Run on the highway');
    s = mergeSettings(s, { mode: 'battle-royale' });
    assert.equal(s.mode, 'zone', 'unknown modes are ignored');
    s = mergeSettings({ ...DEFAULT_SETTINGS }, { mapId: 'harlan' });
    assert.deepEqual([s.mapId, s.mode], ['harlan', 'zone'], 'picking Harlan County switches to Evac Run');
    s = mergeSettings(s, { mode: 'defend' });
    assert.equal(s.mode, 'defend');
    assert.notEqual(s.mapId, 'harlan', 'picking Defend leaves Harlan County for a defend map');
    assert.ok(mapModes(s.mapId).includes('defend'));
    s = mergeSettings(s, { mapId: 'harlan', mode: 'defend' });
    assert.deepEqual([s.mapId, s.mode], ['harlan', 'zone'], 'both at once: the map wins');
    assert.deepEqual(fixModeCombo('nowhere', 'nothing'), { mapId: MAP_LIST[0].id, mode: 'defend' });
    // the sim agrees whatever it is given
    const g = new Game({ mapId: 'harlan', seed: 1, settings: { mode: 'defend' }, players: bots(1) });
    assert.equal(g.mode, 'zone');
    assert.ok(g.zone && !g.objective);
    const h = new Game({ mapId: 'bridge', seed: 1, settings: {}, players: bots(1) });
    assert.equal(h.mode, 'defend');
    assert.equal(h.zone, null);
    assert.equal(h.snapshot().zone, null);
  });

  test('prefs remember the mode and drop nonsense', () => {
    const mem = new Map();
    const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const old = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
    try {
      const p = loadPrefs();
      assert.equal(p.lobby.mode, 'defend');
      p.lobby.mode = 'zone';
      p.lobby.mapId = 'harlan';
      savePrefs(p);
      const q = loadPrefs();
      assert.equal(q.lobby.mode, 'zone');
      assert.equal(q.lobby.mapId, 'harlan');
      mem.set([...mem.keys()][0], JSON.stringify({ lobby: { mode: 'pvp', mapId: 'harlan' } }));
      assert.equal(loadPrefs().lobby.mode, 'defend');
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', { value: old, configurable: true, writable: true });
      else delete globalThis.localStorage;
    }
  });
});

// ---------------------------------------------------------------------------------------
describe('bots in the Evac Run', () => {
  test('Harlan County: four bots reach every zone in time and clear waves 1-3', () => {
    const g = zoneGame({ seed: 31, waves: 3 });
    const late = [];
    let prev = g.phase;
    run(g, 60 * 60 * 12, (gg) => gg.over, (gg) => {
      if (gg.phase === 'wave' && prev !== 'wave') {
        // the wave just started: the move is over, everyone standing must be in the circle
        for (const p of gg.players) {
          if (p.state === 'alive' && !insideZone(gg.zone.circle, p.x, p.y)) late.push(`${p.name} wave ${gg.wave} ${Math.round(Math.hypot(p.x - gg.zone.circle.x, p.y - gg.zone.circle.y) - gg.zone.circle.r)} px out`);
        }
      }
      prev = gg.phase;
    });
    console.log(`# harlan bots: ${g.phase} after ${(g.time / 60).toFixed(1)} min, kills ${g.players.map((p) => p.kills).join('/')}`);
    assert.deepEqual(late, []);
    assert.equal(g.phase, 'victory', `ended ${g.phase}/${g.over} on wave ${g.wave}`);
  });

  test('Evac Run on an existing map (the truck stop): bots move between its spots and win', () => {
    const g = zoneGame({ mapId: 'truckstop', seed: 3, waves: 3 });
    const pois = new Set();
    run(g, 60 * 60 * 10, (gg) => gg.over, (gg) => pois.add(gg.zone.poi));
    assert.ok(pois.size >= 3, `${pois.size} zones`);
    assert.equal(g.phase, 'victory', `ended ${g.phase}/${g.over} on wave ${g.wave}`);
  });

  test('deterministic: the same seed plays the same zone game', () => {
    const play = () => {
      const g = zoneGame({ seed: 77, waves: 2, players: bots(3) });
      run(g, 60 * 90);
      const s = g.snapshot();
      return JSON.stringify([s.zone, s.players.map((p) => [p.x, p.y, p.hp, p.kills]), s.zombies.length]);
    };
    assert.equal(play(), play());
  });
});

// ---------------------------------------------------------------------------------------
describe('host tick on the big map', () => {
  /** Average / worst step() with 250 zombies and 6 bots fighting around the zone. */
  function measure(g, around) {
    const types = ['walker', 'walker', 'walker', 'runner', 'crawler', 'bloater', 'spitter', 'screamer', 'brute'];
    const navTicks = Math.max(1, Math.round(NAV_REBUILD_INTERVAL * TICK_RATE));
    let total = 0, max = 0, k = 0, rebuild = 0, rebuilds = 0;
    for (let t = 0; t < 700; t++) {
      while (g.zombies.filter((z) => !z.dead).length < 250) {
        const a = (k * 2.399) % (Math.PI * 2), d = 500 + ((k * 97) % 700);
        const p = { x: around.x + Math.cos(a) * d, y: around.y + Math.sin(a) * d };
        g.world.resolveCircle(p, 14);
        addZombie(g, types[k % types.length], p.x, p.y);
        k++;
      }
      godMode(g);
      const t0 = performance.now();
      g.step();
      const d = performance.now() - t0;
      if (t >= 100) {
        total += d;
        max = Math.max(max, d);
        if (g.tick % navTicks === 0 || g.tick % navTicks === navTicks >> 1) {
          rebuild += d;
          rebuilds++;
        }
      }
      if (t % 3 === 0) g.snapshot();
    }
    return { avg: total / 600, max, rebuild: rebuild / Math.max(1, rebuilds) };
  }

  test('250 zombies + 6 bots: Harlan County ticks about as fast as the highway', () => {
    const cls = ['soldier', 'medic', 'engineer', 'scout', 'demo', 'heavy'];
    const players = cls.map((c, i) => ({ id: i + 1, name: c, color: i, cls: c, bot: true }));
    const hw = new Game({ mapId: 'highway', seed: 5, settings: { waves: 15 }, players });
    hw.phase = 'intermission'; hw.timer = 1e9; hw.wave = 3;
    const ob = hw.map.objective;
    const a = measure(hw, { x: ob.x, y: ob.y - 400 });
    const hz = zoneGame({ seed: 5, players });
    startWave(hz);
    hz.spawnQueue = 0;
    const c = hz.zone.circle;
    const b = measure(hz, c);
    console.log(`# host tick: highway avg ${a.avg.toFixed(3)} ms (rebuild ticks ${a.rebuild.toFixed(2)}, max ${a.max.toFixed(1)}); harlan avg ${b.avg.toFixed(3)} ms (rebuild ticks ${b.rebuild.toFixed(2)}, max ${b.max.toFixed(1)})`);
    assert.ok(b.avg < 4, `harlan average ${b.avg.toFixed(3)} ms`);
    assert.ok(b.avg < a.avg * 1.6 + 0.3, `harlan ${b.avg.toFixed(3)} ms vs highway ${a.avg.toFixed(3)} ms`);
    assert.ok(b.rebuild < a.rebuild * 1.8 + 0.5, `flow-field rebuild ticks: harlan ${b.rebuild.toFixed(2)} ms vs highway ${a.rebuild.toFixed(2)} ms`);
  });

  test('the zone caps the flow field on the big map; it still leads everyone home', () => {
    const g = zoneGame({ seed: 5, players: bots(1) });
    assert.equal(g.flow.maxDist, ZONE.navRange);
    assert.equal(zoneGame({ mapId: 'bridge', seed: 1, players: bots(1) }).flow.maxDist, Infinity, 'small maps keep the whole field');
    const p = g.players[0];
    const out = { x: 0, y: 0 };
    // from the far corner, beyond the cap, a zombie still gets a heading toward the player
    for (const [x, y] of [[200, 200], [7000, 7000], [7000, 200]]) {
      assert.ok(g.flow.sample(x, y, out), `heading at ${x},${y}`);
      const toward = (out.x * (p.x - x) + out.y * (p.y - y)) / Math.hypot(p.x - x, p.y - y);
      assert.ok(toward > 0, `roughly toward the player from ${x},${y} (${toward.toFixed(2)})`);
    }
  });
});
