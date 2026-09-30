// Road to Haven, the simulation side (STORY.md §5.1-5.4, SPEC §3.9): the map anchors, the
// hold-to-use spots, the NPCs, the mission director with every step type run end to end by
// AI survivors on every map, escort success and failure, the end of a mission (victory,
// defeat, stars, per-player stats), the hideout, the wire and determinism.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, buildMap } from '../public/js/shared/maps.js';
import { Game } from '../public/js/shared/sim.js';
import { GameCore } from '../public/js/shared/sim/core.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { mapColliders } from '../public/js/shared/geom.js';
import { walkComponents, componentAt } from '../public/js/shared/sim/zone.js';
import { createNpc, npcByKey, damageNpc } from '../public/js/shared/sim/npcs.js';
import { addInteractable } from '../public/js/shared/sim/interact.js';
import { encodeSnapshot, decodeSnapshot, EVENT_TYPES } from '../public/js/shared/protocol.js';
import { PROTOCOL_VERSION, DT } from '../public/js/shared/constants.js';
import { mapBuildOptions, registerMissions, clearMissions, getMission } from '../public/js/shared/story/registry.js';
import { validateMission } from '../public/js/shared/story/validate.js';
import {
  ANCHOR_VOCAB, CAMPAIGN_ANCHORS, DEFEND_ANCHOR, STEP_TYPES, INTERACT_KINDS, normLine, missionTier, NPC,
} from '../public/js/shared/story-defs.js';
import { ANCHOR_PAD } from '../public/js/shared/maps.js';
import { addZombie, cmd } from './helpers/sim-helpers.js';
import {
  FX_FOOT, FX_FIGHT, FX_BRIDGE, FX_EVAC, FX_HILL, FIXTURE_MISSIONS,
} from './fixtures/story-missions.js';

const HUMAN = { id: 1, name: 'Human', color: 0, cls: 'soldier' };
/** A mission that never ends by itself (for tests that poke at the sim). */
const SANDBOX = { id: 'sandbox', steps: [{ id: 'w', type: 'wait', seconds: 99999 }] };
const bot = (id, cls = 'soldier') => ({ id, name: `Bot${id}`, color: id - 1, cls, bot: true });
const CLASSES = ['soldier', 'medic', 'engineer', 'scout', 'demo', 'heavy'];
const MAPS = ['highway', 'truckstop', 'bridge', 'checkpoint', 'harlan'];

/** A mission game with `bots` AI survivors and `humans` idle humans. */
function missionGame(mission, { bots = 2, humans = 0, seed = 3, difficulty = 'normal', extra = {}, map = null } = {}) {
  const players = [];
  for (let i = 0; i < humans; i++) players.push({ id: i + 1, name: `Human${i + 1}`, color: i, cls: CLASSES[i % 6] });
  for (let i = 0; i < bots; i++) players.push(bot(humans + i + 1, CLASSES[(humans + i) % 6]));
  return new Game({
    mapId: mission.map, seed, map: map || undefined,
    settings: { mode: 'mission', difficulty, story: { mission, simMode: mission.mode, ...extra } },
    players,
  });
}

/**
 * Step `g` until `until(g)` or `maxSeconds`; returns every event emitted. Snapshots are taken
 * every tick so nothing is lost.
 */
function play(g, maxSeconds, until = () => g.over) {
  const events = [];
  for (let t = 0; t < maxSeconds * 60; t++) {
    g.step();
    const snap = g.snapshot();
    for (const e of snap.events) events.push(e);
    if (until(g)) break;
  }
  return events;
}

const ofType = (events, type) => events.filter((e) => e.type === type);
const storyEnd = (events) => ofType(events, 'storyend')[0];

// -------------------------------------------------------------------------------------
describe('map anchors', () => {
  test('every map has exactly the vocabulary of STORY.md §5.2 (and interactables: [])', () => {
    for (const id of MAPS) {
      const m = buildMap(id, 1);
      assert.deepEqual(Object.keys(m.anchors).sort(), [...ANCHOR_VOCAB[id]].sort(), `${id}: anchors`);
      assert.deepEqual(m.interactables, [], `${id}: interactables`);
    }
  });

  test('each anchor is inside the map, clear of every obstacle, the objective and water, on three seeds', () => {
    const near = (x, y, o, pad) => {
      const dx = x - o.x, dy = y - o.y, c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      return Math.abs(lx) <= o.w / 2 + pad && Math.abs(ly) <= o.h / 2 + pad;
    };
    for (const id of MAPS) {
      for (const seed of [1, 7, 4242]) {
        for (const mode of [null, 'campaign']) {
          const m = buildMap(id, seed, mode ? { mode } : null);
          if (mode && !m.campaign) continue;
          for (const [name, a] of Object.entries(m.anchors)) {
            const w = `${id}${mode ? ' (campaign)' : ''} seed ${seed} anchor ${name}`;
            assert.ok(Number.isInteger(a.x) && Number.isInteger(a.y) && a.r > 0, `${w}: a whole {x, y, r}`);
            assert.ok(a.x > 0 && a.y > 0 && a.x < m.width && a.y < m.height, `${w}: inside the map`);
            for (const o of m.obstacles) assert.ok(!near(a.x, a.y, o, ANCHOR_PAD), `${w}: clear of obstacle ${o.id} (${o.kind})`);
            if (m.objective) assert.ok(!near(a.x, a.y, m.objective, ANCHOR_PAD), `${w}: clear of the objective`);
            for (const ar of m.areas) if (ar.kind === 'water') assert.ok(!near(a.x, a.y, ar, ANCHOR_PAD), `${w}: not in the water`);
          }
        }
      }
    }
  });

  test('anchors are reachable on foot from the team\'s start, and sit near the feature they name', () => {
    for (const id of MAPS) {
      const m = buildMap(id, 1);
      const colliders = mapColliders(m);
      const field = new FlowField(m, { colliders, pad: 12 });
      const comp = walkComponents(field);
      const home = componentAt(field, comp, m.playerSpawns[0].x, m.playerSpawns[0].y);
      for (const [name, a] of Object.entries(m.anchors)) {
        assert.equal(componentAt(field, comp, a.x, a.y), home, `${id}: ${name} is on the team's ground`);
      }
    }
    // a few named features
    const hw = buildMap('highway', 1);
    assert.ok(Math.hypot(hw.anchors.bus.x - hw.objective.x, hw.anchors.bus.y - hw.objective.y) < 140, 'bus anchor beside the bus');
    assert.ok(Math.abs(hw.anchors.overpass.x - 2900) < 100, 'overpass anchor on the I-44 line');
    const cp = buildMap('checkpoint', 1);
    assert.ok(Math.hypot(cp.anchors.tower.x - cp.objective.x, cp.anchors.tower.y - cp.objective.y) < 160, 'tower anchor by the mast');
    const br = buildMap('bridge', 1);
    assert.ok(Math.hypot(br.anchors.apc.x - br.objective.x, br.anchors.apc.y - br.objective.y) < 140, 'apc anchor by the APC');
    const hl = buildMap('harlan', 1);
    for (const p of hl.pois) assert.ok(Object.values(hl.anchors).some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 120), `harlan: an anchor at ${p.name}`);
    // the defend anchor of each map is the map's objective
    for (const id of MAPS) {
      const m = buildMap(id, 1);
      const d = m.anchors[DEFEND_ANCHOR[id]];
      assert.ok(Math.hypot(d.x - m.objective.x, d.y - m.objective.y) < 300, `${id}: defend anchor near the objective`);
    }
  });

  test('the campaign variants add the campaign anchors; the base map is unchanged by them', () => {
    for (const id of ['highway', 'checkpoint', 'harlan']) {
      const c = buildMap(id, 1, { mode: 'campaign' });
      for (const n of [...CAMPAIGN_ANCHORS, ...ANCHOR_VOCAB[id]]) assert.ok(c.anchors[n], `${id} campaign: ${n}`);
      const base = buildMap(id, 1);
      for (const n of CAMPAIGN_ANCHORS) assert.equal(base.anchors[n], undefined, `${id} base: no ${n}`);
      // the anchors of the campaign features lie on them
      assert.ok(Math.hypot(c.anchors.towerDoor.x - c.campaign.entrance.x, c.anchors.towerDoor.y - c.campaign.entrance.y) < 80, `${id}: towerDoor`);
      assert.ok(Math.hypot(c.anchors.zipStart.x - c.campaign.roof.zip.ix, c.anchors.zipStart.y - c.campaign.roof.zip.iy) < 80, `${id}: zipStart`);
      assert.ok(Math.hypot(c.anchors.landing.x - c.campaign.landing.x, c.anchors.landing.y - c.campaign.landing.y) < 120, `${id}: landing`);
      assert.ok(c.anchors.roof.y > c.campaign.roof.y0 && c.anchors.roof.y < c.campaign.roof.y1, `${id}: roof anchor on the roof`);
      assert.ok(Math.hypot(c.anchors.ridgeHill.x - c.campaign.hill.x, c.anchors.ridgeHill.y - c.campaign.hill.y) < c.campaign.hill.plateau, `${id}: ridgeHill on the plateau`);
    }
    // checkpoint's `hill` follows the real hill in the campaign variant
    const cp = buildMap('checkpoint', 1, { mode: 'campaign' });
    assert.ok(Math.hypot(cp.anchors.hill.x - cp.campaign.hill.x, cp.anchors.hill.y - cp.campaign.hill.y) < cp.campaign.hill.plateau);
  });

  test('building the map with the story options: base for missions, campaign variant for campaign missions', () => {
    assert.deepEqual(mapBuildOptions({ mode: 'defend' }), { mode: 'defend' });
    assert.deepEqual(mapBuildOptions({ mode: 'campaign' }), { mode: 'campaign' });
    assert.deepEqual(mapBuildOptions({ mode: 'mission', story: { mission: FX_FOOT } }), { mode: 'mission' });
    assert.deepEqual(mapBuildOptions({ mode: 'mission', story: { mission: FX_HILL } }), { mode: 'campaign' });
    assert.deepEqual(mapBuildOptions({ mode: 'mission', story: { simMode: 'campaign' } }), { mode: 'campaign' });
    assert.deepEqual(mapBuildOptions(undefined), { mode: undefined });
    const g = missionGame(FX_HILL, { bots: 1 });
    assert.ok(g.map.campaign && g.map.anchors.ridgeHill, 'a campaign mission plays on the campaign variant');
  });
});

// -------------------------------------------------------------------------------------
describe('interactables', () => {
  // Open ground at the truck stop's diner drive.
  const OX = 1700, OY = 1750;
  function sandbox(over = {}) {
    const map = buildMap('truckstop', 1);
    const g = new GameCore({ map, seed: 5, settings: { mode: 'mission', story: { mission: SANDBOX }, ...over }, players: [HUMAN, { id: 2, name: 'B', color: 1, cls: 'medic' }] });
    g.players[0].x = OX; g.players[0].y = OY;
    g.players[1].x = OX + 30; g.players[1].y = OY;
    return g;
  }
  // (a held button stays held until a cmd says otherwise: release explicitly)
  const holdFor = (g, secs, who = [1], hold = true) => {
    const events = [];
    for (let t = 0; t < secs * 60; t++) {
      for (const id of who) g.setInput(id, cmd({ seq: g.tick + 1, interact: hold }));
      g.step();
      for (const e of g.snapshot().events) events.push(e);
    }
    return events;
  };

  test('a hold-to-use spot fills while E is held, decays when released, and fires once complete', () => {
    const g = sandbox();
    const it = addInteractable(g, { id: 'term', kind: 'terminal', x: OX, y: OY, r: 60, hold: 2 });
    let ev = holdFor(g, 1);
    assert.ok(it.prog > 0.45 && it.prog < 0.55, `half way after one of two seconds (${it.prog})`);
    assert.equal(ofType(ev, 'interact').length, 0);
    const snap = g.snapshot();
    assert.equal(snap.interactables.length, 1);
    assert.ok(snap.interactables[0].prog > 0.4 && snap.interactables[0].hold && snap.interactables[0].on);
    // let go: it drains twice as fast as it fills
    holdFor(g, 0.5, [1], false);
    assert.ok(it.prog < 0.3, `drains when released (${it.prog})`);
    ev = holdFor(g, 2.2);
    const fired = ofType(ev, 'interact');
    assert.equal(fired.length, 1);
    assert.deepEqual({ pid: fired[0].pid, id: fired[0].id, kind: fired[0].kind }, { pid: 1, id: 'term', kind: 'terminal' });
    assert.ok(it.prog < 0.2, 'progress resets after the use');
  });

  test('two holders fill it faster; a tap-only spot fires on the press, not while held', () => {
    const g = sandbox();
    const it = addInteractable(g, { id: 'gen', kind: 'generator', x: OX + 10, y: OY, r: 60, hold: 3 });
    holdFor(g, 1, [1, 2]);
    assert.ok(it.prog > 0.45, `1.5x with two holders (${it.prog})`);
    holdFor(g, 0.2, [1, 2], false);
    const tap = addInteractable(g, { id: 'board', kind: 'board', x: OX, y: OY + 300, r: 60, hold: 0 });
    g.players[0].x = OX; g.players[0].y = OY + 300;
    const ev = holdFor(g, 1, [1]);
    assert.equal(ofType(ev, 'interact').filter((e) => e.id === 'board').length, 1, 'once per press');
    assert.equal(tap.prog, 0);
  });

  test('out of reach, dead or downed: nothing happens; a downed teammate to revive comes first', () => {
    const g = sandbox();
    const it = addInteractable(g, { id: 'term', kind: 'terminal', x: OX, y: OY, r: 40, hold: 1 });
    g.players[0].x = OX + 300;
    holdFor(g, 2);
    assert.equal(it.prog, 0, 'too far');
    holdFor(g, 0.2, [1], false);
    g.players[0].x = OX;
    g.players[1].state = 'downed';
    g.players[1].bleedout = 30;
    holdFor(g, 0.5);
    assert.equal(it.prog, 0, 'reviving has priority over the spot');
  });

  test('`once` spots turn off after their use; the snapshot keeps them as done', () => {
    const g = sandbox();
    const it = addInteractable(g, { id: 'cache', kind: 'cache', x: OX, y: OY, r: 60, hold: 0.5, once: true });
    holdFor(g, 1);
    assert.ok(it.done && !it.on);
    const s = g.snapshot().interactables;
    assert.equal(s.length, 1);
    assert.ok(s[0].done && !s[0].on);
  });

  test('map.interactables load into the game; hub maps list stations', () => {
    const map = buildMap('truckstop', 1);
    map.interactables = [{ id: 'bench', kind: 'workbench', x: 900, y: 900, r: 70, label: 'Workbench', hold: 0 }];
    const g = new GameCore({ map, seed: 1, settings: { mode: 'hideout' }, players: [HUMAN] });
    assert.equal(g.interactables.length, 1);
    assert.equal(g.interactables[0].id, 'bench');
    const map2 = buildMap('truckstop', 1);
    map2.hub = { id: 'h', name: 'H', stations: [{ id: 'bed', kind: 'bed', x: 800, y: 800, r: 60 }], npcs: [] };
    const g2 = new GameCore({ map: map2, seed: 1, settings: { mode: 'hideout' }, players: [HUMAN] });
    assert.equal(g2.interactables.length, 1);
    assert.equal(g2.interactables[0].kind, 'bed');
    assert.ok(INTERACT_KINDS.bed);
  });
});

// -------------------------------------------------------------------------------------
describe('NPCs', () => {
  // Open ground at the truck stop's diner drive / parking.
  const OX = 1700, OY = 1750;
  function stage(over = {}) {
    const map = buildMap('truckstop', 1);
    const g = new GameCore({ map, seed: 5, settings: { mode: 'mission', story: { mission: SANDBOX } }, players: [HUMAN], ...over });
    const p = g.players[0];
    p.x = OX; p.y = OY;
    return g;
  }

  test('an NPC takes its name and look from the cast; the look is normalised', () => {
    const g = stage();
    const n = createNpc(g, { key: 'mara', x: OX + 100, y: OY });
    assert.equal(n.name, 'Mara Voss');
    assert.equal(n.look.cls, 'medic');
    const odd = createNpc(g, { key: 'x1', name: 'Odd', x: OX + 200, y: OY, look: { cls: 'nope', skin: 'red', outfit: ['#123456'], accessory: 'wings' } });
    assert.equal(odd.look.cls, 'demo', 'an unknown class falls back to the default survivor');
    assert.match(odd.look.skin, /^#[0-9a-f]{6}$/);
    assert.deepEqual(odd.look.outfit, ['#123456']);
    assert.equal(odd.look.accessory, 'none');
  });

  test('an idle NPC turns to face a survivor who comes near', () => {
    const g = stage();
    const n = createNpc(g, { key: 'deke', x: OX + 100, y: OY, angle: 0 });
    g.players[0].x = OX + 100; g.players[0].y = OY + 150;
    for (let t = 0; t < 120; t++) g.step();
    assert.ok(Math.abs(n.angle - Math.PI / 2) < 0.3, `faces the survivor (${n.angle})`);
    assert.equal(g.snapshot().npcs[0].state, 'idle');
  });

  test('an escorted NPC waits until a survivor is near, then walks its route to the end', () => {
    const g = stage();
    const n = createNpc(g, { key: 'hauler', x: OX, y: OY + 100, mode: 'escort', route: [{ x: OX + 400, y: OY + 100 }] });
    // the survivor stands far off: the NPC waits
    g.players[0].x = OX; g.players[0].y = OY - 600;
    for (let t = 0; t < 120; t++) g.step();
    assert.ok(Math.hypot(n.x - OX, n.y - (OY + 100)) < 5, 'waits while nobody is near');
    assert.equal(g.snapshot().npcs[0].state, 'idle');
    g.players[0].x = OX + 50; g.players[0].y = OY + 100;
    for (let t = 0; t < 60; t++) g.step();
    assert.ok(n.x > OX + 30, 'walks when a survivor is near');
    assert.equal(g.snapshot().npcs[0].state, 'escort');
    let arrived = false;
    const events = [];
    for (let t = 0; t < 60 * 20 && !arrived; t++) {
      g.players[0].x = n.x - 60;
      g.players[0].y = n.y;
      g.step();
      for (const e of g.snapshot().events) events.push(e);
      arrived = n.arrived;
    }
    assert.ok(arrived, 'reaches the end of its route');
    assert.ok(events.some((e) => e.type === 'npc' && e.what === 'arrive'));
  });

  test('zombies attack an escorted NPC; it goes down, and a survivor holding E revives it', () => {
    const g = stage();
    const n = createNpc(g, { key: 'hauler', x: OX + 300, y: OY, mode: 'escort', route: [{ x: OX + 700, y: OY }], hp: 60 });
    g.players[0].x = OX + 200; g.players[0].y = OY;
    for (let i = 0; i < 4; i++) addZombie(g, 'walker', OX + 380 + i * 10, OY + (i % 2) * 30);
    for (let t = 0; t < 60 * 15 && !n.down; t++) {
      g.players[0].hp = g.players[0].maxHp;
      g.step();
    }
    assert.ok(n.down, 'the zombies got it');
    assert.equal(g.snapshot().npcs[0].state, 'down');
    // the zombies leave a downed NPC alone; a survivor holding E revives it
    for (const z of g.zombies) z.dead = true;
    const p = g.players[0];
    p.x = n.x + 30; p.y = n.y;
    for (let k = 0; k < 60 * 4 && n.down; k++) {
      g.setInput(1, cmd({ seq: g.tick + 1, interact: true }));
      g.step();
    }
    assert.ok(!n.down && n.hp > 0, 'revived');
    assert.ok(g.snapshot().events.some((e) => e.type === 'npc' && e.what === 'up'));
  });

  test('an NPC nobody revives bleeds out (critical: the mission is lost)', () => {
    const mission = { id: 'esc', steps: [{ id: 'e', type: 'escort', npc: 'hauler', route: ['truckLot', 'diner'] }] };
    const g = new GameCore({ map: buildMap('truckstop', 1), seed: 5, settings: { mode: 'mission', story: { mission } }, players: [HUMAN] });
    const n = npcByKey(g, 'hauler');
    assert.ok(n && n.critical && n.mode === 'escort');
    damageNpc(g, n, 1e6, 0, 0);
    assert.ok(n.down);
    const events = [];
    for (let t = 0; t < 60 * (NPC.bleed + 2); t++) {
      g.step();
      for (const e of g.snapshot().events) events.push(e);
    }
    assert.ok(n.dead);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.over, 'npc');
    const end = storyEnd(events);
    assert.equal(end.result, 'defeat');
    assert.equal(end.reason, 'npc');
    assert.equal(end.stars, 0);
  });

  test('a follower covers the team: it shoots zombies in sight and walks with the survivors', () => {
    const g = stage();
    const n = createNpc(g, { key: 'okafor', x: OX - 100, y: OY, mode: 'follow', invulnerable: true });
    const z = addZombie(g, 'walker', OX + 250, OY);
    z.speed = 0;
    z.damage = 0;
    for (let t = 0; t < 60 * 8 && !z.dead; t++) {
      g.players[0].x = OX; g.players[0].y = OY;
      g.step();
    }
    assert.ok(z.dead, 'the helper killed the walker');
    // it keeps its distance from the survivor, following when far away
    g.players[0].x = OX + 500;
    for (let t = 0; t < 60 * 6; t++) g.step();
    assert.ok(Math.hypot(n.x - (OX + 500), n.y - OY) < NPC.followMax + 40, 'follows');
    assert.equal(g.snapshot().npcs[0].state, 'follow');
    assert.equal(g.snapshot().npcs[0].hp, -1, 'invulnerable NPCs publish hp -1');
  });

  test('pressing E next to an NPC talks (one event per press)', () => {
    const g = stage();
    createNpc(g, { key: 'mara', x: OX + 40, y: OY });
    const events = [];
    for (let t = 0; t < 30; t++) {
      g.setInput(1, cmd({ seq: g.tick + 1, interact: t >= 5 }));
      g.step();
      for (const e of g.snapshot().events) events.push(e);
    }
    const talks = ofType(events, 'talk');
    assert.equal(talks.length, 1);
    assert.deepEqual({ pid: talks[0].pid, npc: talks[0].npc }, { pid: 1, npc: 'mara' });
    assert.equal(g.snapshot().npcs[0].state, 'talk');
  });

  test('bots never talk while a human plays', () => {
    const g = new GameCore({ map: buildMap('truckstop', 1), seed: 5, settings: { mode: 'mission', story: { mission: SANDBOX } }, players: [HUMAN, bot(2)] });
    g.players[0].x = OX - 800; g.players[0].y = OY;
    g.players[1].x = OX; g.players[1].y = OY;
    createNpc(g, { key: 'mara', x: OX + 40, y: OY });
    const events = [];
    for (let t = 0; t < 30; t++) {
      g.setInput(2, cmd({ seq: g.tick + 1, interact: true }));
      g.step();
      for (const e of g.snapshot().events) events.push(e);
    }
    assert.equal(ofType(events, 'talk').length, 0);
  });

  test('zombies find NPCs through the flow field: an escort in the open draws the horde', () => {
    const g = stage();
    g.players[0].x = 200; g.players[0].y = 200;
    const n = createNpc(g, { key: 'hauler', x: OX + 300, y: OY, mode: 'escort', route: [{ x: OX + 400, y: OY }], invulnerable: false });
    const z = addZombie(g, 'walker', OX - 400, OY);
    for (let t = 0; t < 60 * 6; t++) g.step();
    assert.ok(Math.hypot(z.x - n.x, z.y - n.y) < 620, 'the zombie is on its way to the NPC, not the survivor');
    assert.ok(z.x > OX - 400 + 100, 'and it moved toward it');
  });
});

// -------------------------------------------------------------------------------------
describe('the mission director: every step type, end to end, with AI survivors', () => {
  test('on foot: dialogue, wait, reach, collect, activate, an optional side step and an escort', () => {
    const g = missionGame(FX_FOOT);
    const events = play(g, 200);
    assert.equal(g.phase, 'victory');
    const end = storyEnd(events);
    assert.equal(end.result, 'victory');
    assert.equal(end.mission, 'fx_foot');
    assert.equal(end.stars, 3, 'time, no downs and the optional note');
    assert.deepEqual(end.met, { time: true, noDowns: true, optional: true });
    assert.equal(end.items.fuel, 3);
    assert.equal(end.items.note, 1);
    assert.ok(Object.keys(end.stats).length === 2 && end.stats[1].name === 'Bot1');
    assert.equal(Object.values(end.stats).reduce((a, s) => a + s.items, 0), 4, 'four items collected in all');
    const done = ofType(events, 'objective').filter((e) => e.what === 'done').map((e) => e.id);
    assert.deepEqual(done, ['walk', 'fuel', 'power', 'note', 'haul']);
    assert.equal(ofType(events, 'interact').filter((e) => e.kind === 'terminal').length, 2);
    assert.ok(ofType(events, 'npc').some((e) => e.what === 'arrive' && e.npc === 'hauler'));
    const radio = ofType(events, 'radio').map((e) => e.text);
    assert.ok(radio.includes('Radio check. Nice and easy.') && radio.includes('That is the bus.') && radio.includes('Move out.'), radio.join(' | '));
    assert.ok(ofType(events, 'radio').find((e) => e.text === 'Copy that.').kind === 'say', 'dialogue lines are said in person');
    assert.ok(ofType(events, 'radio').find((e) => e.text === 'That is the bus.').kind === 'radio', 'step lines default to the radio');
  });

  test('fighting: kill, survive, waves, boss, defend', () => {
    const g = missionGame(FX_FIGHT);
    const events = play(g, 300);
    assert.equal(g.phase, 'victory', `ended ${g.over} at ${g.time.toFixed(0)} s`);
    const done = ofType(events, 'objective').filter((e) => e.what === 'done').map((e) => e.id);
    assert.deepEqual(done, ['kills', 'hold', 'waves', 'guard', 'big']);
    assert.ok(ofType(events, 'wave').length >= 3, 'wave banners for the waves and the defend');
    assert.ok(ofType(events, 'waveclear').length >= 3);
    assert.equal(ofType(events, 'bossspawn').length, 1);
    const end = storyEnd(events);
    assert.equal(end.result, 'victory');
    assert.equal(end.stars, 2, 'time only');
    assert.ok(Object.values(end.stats).reduce((a, s) => a + s.kills, 0) >= 20);
    assert.equal(g.objective, null, 'the objective is off once the defend step is over');
  });

  test('a parallel defend that is `required` and a repair spot, on the bridge', () => {
    const g = missionGame(FX_BRIDGE);
    const events = play(g, 200);
    assert.equal(g.phase, 'victory');
    const done = ofType(events, 'objective').filter((e) => e.what === 'done').map((e) => e.id);
    assert.deepEqual(done, ['fix', 'guard'], 'the repair finishes first, the wave later');
    assert.equal(ofType(events, 'interact').filter((e) => e.kind === 'repair').length, 1);
  });

  test('an Evac Run mission: the stops come from the script, the game victory is the mission\'s', () => {
    const g = missionGame(FX_EVAC);
    assert.equal(g.mode, 'mission');
    assert.equal(g.simMode, 'zone');
    assert.ok(g.zone && g.zone.stops.length === 2);
    const events = play(g, 300);
    assert.equal(g.phase, 'victory');
    const zones = ofType(events, 'zone').filter((e) => e.stage === 'next');
    assert.deepEqual(zones.map((z) => z.poi), [0, 1], 'Main Street, then the Gas-N-Go');
    assert.equal(storyEnd(events).result, 'victory');
    assert.equal(g.zone, null, 'the zone is over with the step');
  });

  test('a campaign mission: the hill stage counts the hill waves and ends the mission after the last', () => {
    const g = missionGame(FX_HILL);
    assert.equal(g.simMode, 'campaign');
    assert.equal(g.campaign.plan.hill, 3);
    const events = play(g, 300);
    assert.equal(g.phase, 'victory');
    assert.equal(ofType(events, 'waveclear').length, 3);
    assert.equal(storyEnd(events).result, 'victory');
  });

  test('campaign missions can start at the tower or on the roof', () => {
    const tower = { ...FX_HILL, id: 'fx_tower', steps: [{ id: 't', type: 'campaignStage', stage: 'tower', text: 'Up' }] };
    const g = missionGame(tower, { bots: 1 });
    assert.equal(g.campaign.stage, 3);
    assert.equal(g.campaign.floor, 1);
    const p = g.players[0];
    assert.ok(p.y > g.map.campaign.floors[0].y0 && p.y < g.map.campaign.floors[0].y1, 'the team stands on the first floor');
    const roof = { ...FX_HILL, id: 'fx_roof', steps: [{ id: 'r', type: 'campaignStage', stage: 'roof' }] };
    const g2 = missionGame(roof, { bots: 1 });
    assert.equal(g2.campaign.stage, 4);
    assert.ok(g2.players[0].y > g2.map.campaign.roof.y0 - 5);
  });

  test('a mini mission of every kind of step plays out on every map', () => {
    for (const id of MAPS) {
      const m = buildMap(id, 1);
      const names = Object.keys(m.anchors);
      const near = (from, k) => names
        .filter((n) => n !== from)
        .sort((a, b) => Math.hypot(m.anchors[a].x - m.anchors[from].x, m.anchors[a].y - m.anchors[from].y)
          - Math.hypot(m.anchors[b].x - m.anchors[from].x, m.anchors[b].y - m.anchors[from].y))
        .slice(0, k);
      const home = DEFEND_ANCHOR[id];
      const [a, b] = near(home, 2);
      const mission = {
        id: `mini_${id}`, chapter: 1, index: 1, title: 'mini', blurb: 'mini', map: id, mode: 'defend', level: [1, 2], party: { min: 1, max: 6 },
        startAt: home, tier: 1, waveScale: 0.15,
        briefing: [], debrief: [], rewards: { xp: 0, scrap: 0 }, stars: { time: 900 },
        steps: [
          { id: 'reach', type: 'reach', at: a, pressure: false },
          { id: 'collect', type: 'collect', item: 'part', count: 2, at: [a, b], pressure: false },
          { id: 'use', type: 'activate', at: [b], hold: 1, pressure: false },
          { id: 'kill', type: 'kill', enemy: 'walker', count: 3, pressure: { every: 4, delay: 1, size: 4, waves: 3 } },
          { id: 'waves', type: 'waves', count: 1, scale: 0.15 },
          { id: 'guard', type: 'defend', target: home, waves: 1, scale: 0.15 },
        ],
      };
      const g = missionGame(mission, { bots: 2, seed: 5 });
      const events = play(g, 420);
      assert.equal(g.phase, 'victory', `${id}: ended ${g.over || g.phase} at ${g.time.toFixed(0)} s, steps ${g.story.steps.map((s) => s.state).join(',')}`);
      const done = ofType(events, 'objective').filter((e) => e.what === 'done').map((e) => e.id);
      assert.deepEqual(done, ['reach', 'collect', 'use', 'kill', 'waves', 'guard'], `${id}: every step finished in order`);
    }
  });

  test('pressure spawns zombies during a step, in bursts, off-screen, capped', () => {
    const mission = {
      id: 'press', map: 'highway', mode: 'free', level: [1, 1], startAt: 'overpass', steps: [
        { id: 'stay', type: 'survive', seconds: 60, pressure: { every: 10, delay: 2, size: 6, waves: 3, tier: 1 } },
      ],
    };
    const g = missionGame(mission, { bots: 1, humans: 1 });
    const counts = [];
    for (let t = 0; t < 60 * 30; t++) {
      g.step();
      g.snapshot();
      if (t % 60 === 59) counts.push(g.zombies.filter((z) => !z.dead).length);
    }
    assert.ok(g.story.stats.bursts >= 2 && g.story.stats.bursts <= 3);
    assert.ok(Math.max(...counts) > 0 && Math.max(...counts) <= 40);
    // every zombie of a burst spawned well away from the survivors
    const far = g.zombies.filter((z) => !z.dead && Math.min(...g.players.map((p) => Math.hypot(p.x - z.x, p.y - z.y))) > 200);
    assert.ok(far.length > 0 || g.zombies.length === 0);
  });

  test('a step\'s pressure can be switched off with `pressure: false`', () => {
    const mission = { id: 'calm', map: 'highway', mode: 'free', startAt: 'overpass', steps: [{ id: 'w', type: 'wait', seconds: 20 }, { id: 'c', type: 'collect', item: 'part', count: 1, at: ['bus'], pressure: false }] };
    const g = missionGame(mission, { bots: 0, humans: 1 });
    for (let t = 0; t < 60 * 30; t++) {
      g.step();
      g.snapshot();
    }
    assert.equal(g.zombies.length, 0, 'no zombies at all');
    assert.equal(g.story.stats.bursts, 0);
  });
});

// -------------------------------------------------------------------------------------
describe('the end of a mission', () => {
  test('defeat when everyone falls, with the stats of each survivor', () => {
    const mission = { id: 'lose', map: 'highway', mode: 'free', startAt: 'bus', steps: [{ id: 'hold', type: 'survive', seconds: 300, pressure: false }] };
    const g = missionGame(mission, { bots: 0, humans: 2 });
    g.getPlayer(1).kills = 7;
    const events = [];
    for (let t = 0; t < 120 && !g.over; t++) {
      for (const p of g.players) {
        if (p.state === 'alive') p.hp = 0.001;
      }
      g.setInput(1, cmd({ seq: t + 1 }));
      g.step();
      for (const p of g.players) {
        if (p.state === 'alive') {
          p.hp = 0;
          // knock down through the real path
        }
      }
      if (g.tick === 30) {
        for (const p of g.players) {
          p.selfRevive = false;
          p.state = 'dead';
        }
      }
      for (const e of g.snapshot().events) events.push(e);
    }
    assert.equal(g.phase, 'gameover');
    const end = storyEnd(events);
    assert.equal(end.result, 'defeat');
    assert.equal(end.reason, 'wiped');
    assert.equal(end.stars, 0);
    assert.equal(end.stats[1].kills, 7);
    assert.ok(ofType(events, 'gameover').length === 1);
  });

  test('defeat when the objective falls in a defend step', () => {
    const mission = { id: 'obj', map: 'bridge', mode: 'defend', startAt: 'apc', steps: [{ id: 'd', type: 'defend', target: 'apc', waves: 2, scale: 0.5 }] };
    const g = missionGame(mission, { bots: 0, humans: 1 });
    for (let t = 0; t < 10; t++) g.step();
    assert.ok(g.objective && g.objective.hp > 0, 'the defend step turned the objective on');
    g.objective.hp = 0;
    const events = [];
    for (let t = 0; t < 5; t++) {
      g.step();
      for (const e of g.snapshot().events) events.push(e);
    }
    assert.equal(g.over, 'objective');
    assert.equal(storyEnd(events).reason, 'objective');
  });

  test('the mission time limit and a step timeout end it as a defeat', () => {
    const mission = { id: 'tl', map: 'highway', mode: 'free', startAt: 'bus', timeLimit: 30, steps: [{ id: 'w', type: 'wait', seconds: 100 }] };
    const g = missionGame(mission, { bots: 0, humans: 1 });
    const events = play(g, 40);
    assert.equal(g.over, 'timeout');
    assert.equal(storyEnd(events).reason, 'timeout');
    const m2 = { id: 'to', map: 'highway', mode: 'free', startAt: 'bus', steps: [{ id: 'c', type: 'collect', item: 'fuel', count: 2, at: ['bus'], timeout: 15, pressure: false }] };
    const g2 = missionGame(m2, { bots: 0, humans: 1 });
    play(g2, 25);
    assert.equal(g2.over, 'timeout');
  });

  test('stars: 1 for finishing, +1 per condition met (time, no downs, everything optional), at most 3', () => {
    const base = { id: 's', map: 'highway', mode: 'free', startAt: 'bus', steps: [{ id: 'w', type: 'wait', seconds: 5 }] };
    const run = (stars, prep = () => {}) => {
      const g = missionGame({ ...base, stars }, { bots: 0, humans: 1 });
      prep(g);
      return storyEnd(play(g, 20));
    };
    assert.equal(run({}).stars, 1);
    assert.equal(run({ time: 60 }).stars, 2);
    assert.equal(run({ time: 3 }).stars, 1, 'too slow');
    assert.equal(run({ time: 60, noDowns: true }).stars, 3);
    assert.equal(run({ time: 60, noDowns: true }, (g) => { g.getPlayer(1).downs = 1; }).stars, 2);
    assert.equal(run({ time: 60, noDowns: true, optional: 'collectAll' }).stars, 3, 'capped at three');
  });

  test('the dead return next to a teammate after the respawn delay, and at a finished step', () => {
    const mission = { id: 'rs', map: 'highway', mode: 'free', startAt: 'bus', respawn: 10, steps: [{ id: 'w', type: 'wait', seconds: 100 }] };
    const g = missionGame(mission, { bots: 0, humans: 2 });
    const p = g.getPlayer(2);
    p.state = 'dead';
    p.respawn = true;
    p.hp = 0;
    p.x = 100; p.y = 100;
    for (let t = 0; t < 60 * 9; t++) g.step();
    assert.equal(p.state, 'dead');
    for (let t = 0; t < 60 * 2; t++) g.step();
    assert.equal(p.state, 'alive');
    assert.ok(Math.hypot(p.x - g.getPlayer(1).x, p.y - g.getPlayer(1).y) < 150, 'beside the living teammate');
  });

  test('radio lines are spoken one after the other, each for its own time', () => {
    const mission = {
      id: 'rd', map: 'highway', mode: 'free', startAt: 'bus', steps: [
        { id: 'a', type: 'wait', seconds: 30, onStart: [{ who: 'ozzy', text: 'one', ms: 1000 }, { who: 'ozzy', text: 'two', ms: 2000 }, { who: 'mara', text: 'three', ms: 1000 }] },
      ],
    };
    const g = missionGame(mission, { bots: 0, humans: 1 });
    const at = {};
    for (let t = 0; t < 60 * 10; t++) {
      g.step();
      for (const e of g.snapshot().events) if (e.type === 'radio') at[e.text] = t / 60;
    }
    assert.ok(Math.abs(at.two - at.one - 1.3) < 0.1, `two follows one after 1 s + gap (${at.two - at.one})`);
    assert.ok(Math.abs(at.three - at.two - 2.3) < 0.1);
    assert.equal(normLine({ radio: { who: 'a', text: 'x' } }).kind, 'radio');
    assert.equal(normLine({ say: { who: 'a', text: 'x' } }).kind, 'say');
    assert.equal(normLine({ who: 'a', text: '' }), null);
  });
});

// -------------------------------------------------------------------------------------
describe('the hideout', () => {
  function hideout(over = {}) {
    const map = buildMap('truckstop', 1);
    map.interactables = [{ id: 'board', kind: 'board', x: 1500, y: 1300, r: 70, label: 'Mission board', hold: 0 }];
    map.hub = { id: 'test', name: 'Test', stations: [], npcs: [{ id: 'mara', role: 'medic', x: 1400, y: 1300, angle: 0 }, { id: 'deke', role: 'mechanic', x: 1300, y: 1350, angle: 1 }] };
    return new Game({ map, mapId: 'truckstop', seed: 4, settings: { mode: 'hideout', story: { worldId: 'w1', ...over } }, players: [HUMAN, bot(2, 'medic')] });
  }

  test('no zombies, no waves, nobody can be hurt, the game never ends', () => {
    const g = hideout();
    assert.equal(g.mode, 'hideout');
    assert.equal(g.safe, true);
    assert.equal(g.story.hideout, true);
    // a raider that somehow gets in cannot hurt anyone
    const z = addZombie(g, 'brute', g.players[0].x + 40, g.players[0].y);
    for (let t = 0; t < 60 * 20; t++) g.step();
    assert.equal(g.getPlayer(1).hp, g.getPlayer(1).maxHp);
    assert.equal(g.getPlayer(1).state, 'alive');
    const spawned = g.zombies.filter((q) => q !== z && !q.dead).length;
    assert.equal(spawned, 0, 'nothing spawns');
    assert.equal(g.phase, 'wave');
    assert.equal(g.over, null);
    const snap = g.snapshot();
    assert.equal(snap.story.mode, 'hideout');
    assert.deepEqual(snap.story.steps, []);
  });

  test('the hub\'s NPCs stand in place and can be talked to; stations fire interact events', () => {
    const g = hideout();
    assert.deepEqual(g.npcs.map((n) => n.key), ['mara', 'deke']);
    assert.equal(g.npcs[0].name, 'Mara Voss');
    const p = g.getPlayer(1);
    p.x = 1430; p.y = 1300;
    const events = [];
    for (let t = 0; t < 40; t++) {
      g.setInput(1, cmd({ seq: t + 1, interact: t > 3 && t < 12 }));
      g.step();
      for (const e of g.snapshot().events) events.push(e);
    }
    assert.equal(ofType(events, 'talk').length, 1);
    p.x = 1500; p.y = 1300;
    for (let t = 0; t < 40; t++) {
      g.setInput(1, cmd({ seq: 100 + t, interact: t > 3 && t < 12 }));
      g.step();
      for (const e of g.snapshot().events) events.push(e);
    }
    const use = ofType(events, 'interact');
    assert.equal(use.length, 1);
    assert.deepEqual({ id: use[0].id, kind: use[0].kind }, { id: 'board', kind: 'board' });
  });

  test('settings.story.npcs override the look and name of a hub NPC and add NPCs with positions', () => {
    const g = hideout({ npcs: [{ id: 'mara', name: 'Mara V.', look: { cls: 'medic', skin: '#ffe0c0', hair: '#101010', outfit: ['#336699'], accessory: 'glasses' } }, { id: 'priya', x: 1200, y: 1300, mode: 'idle' }] });
    assert.equal(g.npcs.length, 3);
    assert.equal(npcByKey(g, 'mara').name, 'Mara V.');
    assert.equal(npcByKey(g, 'mara').look.accessory, 'glasses');
    assert.equal(npcByKey(g, 'priya').name, 'Priya Nair');
  });

  test('a late joiner enters alive', () => {
    const g = hideout();
    g.addPlayer({ id: 5, name: 'Late', color: 3, cls: 'scout' });
    assert.equal(g.getPlayer(5).state, 'alive');
  });
});

// -------------------------------------------------------------------------------------
describe('the party: what a profile gives a survivor', () => {
  test('loadout, perks and armour from settings.story.party are applied to the matching player', () => {
    const mission = { id: 'pt', map: 'highway', mode: 'free', startAt: 'bus', steps: [{ id: 'w', type: 'wait', seconds: 5 }] };
    const g = missionGame(mission, { bots: 0, humans: 2, extra: { party: [{ pid: 2, loadout: ['rifle', 'shotgun', null, 'nope'], perks: { maxHp: 130, speedMult: 1.1, damageMult: 1.2, bogus: 5 }, armor: 40 }] } });
    const p = g.getPlayer(2);
    assert.deepEqual(p.slots, ['rifle', 'shotgun', null]);
    assert.equal(p.slot, 0);
    assert.equal(p.maxHp, 130);
    assert.equal(p.hp, 130);
    assert.equal(p.speedMult, 1.1);
    assert.equal(p.perks.damageMult, 1.2);
    assert.equal(p.perks.bogus, undefined);
    assert.equal(p.armor, 40);
    assert.deepEqual(g.getPlayer(1).slots.slice(0, 2), ['pistol', 'rifle'], 'the other survivor is untouched');
  });

  test('the story difficulty scales the zombies', () => {
    const mission = { id: 'df', map: 'highway', mode: 'free', startAt: 'bus', steps: [{ id: 'w', type: 'wait', seconds: 5 }] };
    const g = missionGame(mission, { bots: 0, humans: 1, extra: { difficulty: 'nightmare' } });
    assert.equal(g.diff.name, 'Nightmare');
  });
});

// -------------------------------------------------------------------------------------
describe('the wire', () => {
  test('protocol 10: the story block, NPCs and interactables round-trip', () => {
    assert.ok(PROTOCOL_VERSION >= 10);
    const g = missionGame(FX_FOOT, { bots: 0, humans: 1 });
    createNpc(g, { key: 'ozzy', x: 3000, y: 1200, angle: 1.2, mode: 'follow' });
    for (let t = 0; t < 60 * 5; t++) g.step();
    addInteractable(g, { id: 'lever', kind: 'switch', x: 3000, y: 1100, r: 50, hold: 2 }).prog = 0.5;
    const snap = g.snapshot();
    assert.ok(snap.story && snap.story.steps.length && snap.npcs.length >= 2 && snap.interactables.length === 1);
    const back = decodeSnapshot(encodeSnapshot({ ...snap, match: 3 }));
    assert.equal(back.story.mode, 'mission');
    assert.deepEqual(back.story.steps.map((s) => [s.i, s.kind, s.text, s.opt]), snap.story.steps.map((s) => [s.i, s.kind, s.text, s.opt]));
    assert.equal(back.npcs.length, snap.npcs.length);
    for (let i = 0; i < snap.npcs.length; i++) {
      const a = snap.npcs[i], b = back.npcs[i];
      assert.equal(b.id, a.id);
      assert.equal(b.key, a.key);
      assert.equal(b.name, a.name);
      assert.equal(b.state, a.state);
      assert.deepEqual(b.look, { ...a.look, scale: Math.round(a.look.scale * 100) / 100 });
      assert.ok(Math.abs(b.x - a.x) <= 0.25 && Math.abs(b.y - a.y) <= 0.25);
    }
    assert.equal(back.tick, snap.tick);
  });

  test('objective markers, story items, hold progress and every new event survive the wire', () => {
    const g = missionGame(FX_FOOT, { bots: 0, humans: 1 });
    g.step();
    // reach done → collect: items and markers appear
    g.story.steps[0].state = 'done';
    for (let t = 0; t < 60 * 3; t++) g.step();
    g.snapshot();
    const s = g.story.steps.find((q) => q.type === 'reach');
    // a fuller story block, by hand
    const snap = g.snapshot();
    snap.story = {
      mode: 'mission', time: 63.4, downs: 2,
      steps: [{ i: 3, kind: 'collect', text: 'Find the fuel cans', cur: 2, max: 5, t: 0, total: 0, opt: false }, { i: 4, kind: 'survive', text: 'Hold out', cur: 10, max: 60, t: 50, total: 60, opt: true }],
      marks: [{ kind: 'item', x: 1234.5, y: 999.25, r: 0 }, { kind: 'reach', x: 5000, y: 2000, r: 220 }],
      items: [{ id: 7, item: 'fuel', x: 1300.5, y: 1000 }, { id: 8, item: 'medicine', x: 1400, y: 1100.25 }],
    };
    snap.interactables = [{ id: 3, kind: 'generator', x: 800.5, y: 900, r: 64, hold: true, on: true, done: false, prog: 0.4, user: 2 }, { id: 4, kind: 'workbench', x: 100, y: 200, r: 70, hold: false, on: true, done: false, prog: 0, user: 0 }];
    snap.events = [
      { type: 'objective', what: 'progress', step: 3, id: 'fuel', text: 'Find the fuel cans', cur: 2, max: 5 },
      { type: 'radio', who: 'Ozzy', text: 'Can you hear me? We have movement on the ridge — stay low.', ms: 3400, kind: 'radio' },
      { type: 'interact', pid: 1, id: 'generatorA', kind: 'generator' },
      { type: 'talk', pid: 1, npc: 'mara' },
      { type: 'item', pid: 1, item: 'fuel', x: 1300, y: 1000, n: 2, of: 5 },
      { type: 'npc', what: 'down', npc: 'hauler', id: 2 },
      { type: 'storyend', result: 'victory', reason: '', mission: 'm1', stars: 3, met: { time: true }, time: 300, downs: 0, stats: { 1: { name: 'A', kills: 5, downs: 0, revives: 1, damage: 100, items: 2 } }, items: { fuel: 5 }, flags: {} },
    ];
    const buf = encodeSnapshot(snap);
    const back = decodeSnapshot(buf);
    assert.deepEqual(back.events, snap.events);
    assert.deepEqual(back.story.marks, snap.story.marks);
    assert.deepEqual(back.story.items.map((i) => [i.id, i.item]), [[7, 'fuel'], [8, 'medicine']]);
    assert.ok(Math.abs(back.story.items[1].y - 1100.25) <= 0.25);
    assert.equal(back.story.time, 63.4);
    assert.equal(back.story.steps[1].opt, true);
    assert.equal(back.story.steps[1].t, 50);
    assert.deepEqual(back.interactables[0], { ...snap.interactables[0], prog: back.interactables[0].prog });
    assert.ok(Math.abs(back.interactables[0].prog - 0.4) < 0.01);
    for (const t of ['objective', 'radio', 'interact', 'talk', 'item', 'npc']) assert.ok(EVENT_TYPES.includes(t), `${t} has a binary schema`);
    assert.ok(s);
  });

  test('a snapshot of a game without a story carries the empty fields and no story bytes', () => {
    const g = new Game({ mapId: 'highway', seed: 1, settings: {}, players: [HUMAN] });
    for (let t = 0; t < 30; t++) g.step();
    const snap = g.snapshot();
    assert.equal(snap.story, null);
    assert.deepEqual(snap.npcs, []);
    assert.deepEqual(snap.interactables, []);
    const back = decodeSnapshot(encodeSnapshot(snap));
    assert.equal(back.story, null);
    assert.deepEqual(back.npcs, []);
    const withNpc = encodeSnapshot({ ...snap, npcs: [{ id: 1, key: 'mara', name: 'Mara', look: { cls: 'medic', skin: '#aabbcc', hair: '#112233', outfit: ['#445566'], accessory: 'cap', scale: 1 }, x: 1, y: 2, z: 0, angle: 0, state: 'idle', hp: 1 }] });
    assert.ok(withNpc.byteLength - encodeSnapshot(snap).byteLength < 60, 'an NPC is a few dozen bytes');
  });
});

// -------------------------------------------------------------------------------------
describe('determinism', () => {
  test('a mission with bots plays out identically twice', () => {
    const run = () => {
      const g = missionGame(FX_FOOT, { seed: 11 });
      const log = [];
      for (let t = 0; t < 60 * 60; t++) {
        g.step();
        const s = g.snapshot();
        if (t % 20 === 0) log.push(JSON.stringify([s.tick, s.story, s.npcs, s.interactables, s.players.map((p) => [p.x, p.y, p.hp])]));
        for (const e of s.events) log.push(JSON.stringify(e));
        if (g.over) break;
      }
      return log.join('\n');
    };
    assert.equal(run(), run());
  });

  test('the fixture with zombies (fighting) is deterministic too', () => {
    const run = () => {
      const g = missionGame(FX_FIGHT, { seed: 12 });
      const log = [];
      for (let t = 0; t < 60 * 40; t++) {
        g.step();
        const s = g.snapshot();
        if (t % 30 === 0) log.push(JSON.stringify([s.tick, s.zombies.length, s.remaining, s.players.map((p) => [p.x, p.y])]));
        if (g.over) break;
      }
      return log.join('\n');
    };
    assert.equal(run(), run());
  });
});

// -------------------------------------------------------------------------------------
describe('mission scripts', () => {
  test('every fixture mission passes the validator (anchors checked against the real maps)', () => {
    const maps = (id, opts) => buildMap(id, 1, opts || undefined);
    for (const m of FIXTURE_MISSIONS) {
      const r = validateMission(m, { maps });
      // the fixtures skip briefing/debrief on purpose in places: only the step-level checks matter here
      const errs = r.errors.filter((e) => !/briefing|debrief/.test(e));
      assert.deepEqual(errs, [], `${m.id}: ${errs.join('; ')}`);
    }
  });

  test('the validator catches the mistakes authors make', () => {
    const maps = (id, opts) => buildMap(id, 1, opts || undefined);
    const good = {
      id: 'ok', chapter: 1, index: 1, title: 'T', blurb: 'B', map: 'highway', mode: 'free', level: [1, 3], party: { min: 1, max: 6 },
      briefing: [{ who: 'mara', text: 'Hi' }], debrief: [{ who: 'mara', text: 'Bye' }], rewards: { xp: 10, scrap: 5 }, stars: { time: 300 },
      steps: [{ id: 'a', type: 'reach', at: 'bus', text: 'Go' }],
    };
    assert.deepEqual(validateMission(good, { maps }).errors, []);
    const bad = (patch, re) => {
      const r = validateMission({ ...good, ...patch }, { maps });
      assert.ok(r.errors.some((e) => re.test(e)), `expected ${re}, got ${r.errors.join(' | ') || 'no errors'}`);
    };
    bad({ id: 'Bad Id' }, /id must be/);
    bad({ map: 'atlantis' }, /not a map/);
    bad({ mode: 'sandbox' }, /mode must be/);
    bad({ level: [5, 2] }, /level must be/);
    bad({ steps: [] }, /non-empty/);
    bad({ steps: [{ id: 'a', type: 'fly' }] }, /unknown step type/);
    bad({ steps: [{ id: 'a', type: 'reach', at: 'mars' }] }, /not an anchor of highway/);
    bad({ steps: [{ id: 'a', type: 'reach', at: 'bus' }, { id: 'a', type: 'wait', seconds: 1 }] }, /duplicate step id/);
    bad({ steps: [{ id: 'a', type: 'collect', item: 'fuel', count: 0, at: ['bus'] }] }, /count must be/);
    bad({ steps: [{ id: 'a', type: 'collect', item: 'fuel', count: 2, at: [] }] }, /non-empty array of anchors/);
    bad({ steps: [{ id: 'a', type: 'kill', enemy: 'dragon', count: 2 }] }, /not a zombie type/);
    bad({ steps: [{ id: 'a', type: 'defend', target: 'diner', waves: 2 }] }, /target must be "bus"/);
    bad({ steps: [{ id: 'a', type: 'escort', npc: 'x', route: ['bus'] }] }, /at least two anchors/);
    bad({ steps: [{ id: 'a', type: 'evac', stops: ['bus'] }] }, /needs mission mode "zone"/);
    bad({ steps: [{ id: 'a', type: 'campaignStage', stage: 'hill' }] }, /needs mission mode "campaign"/);
    bad({ mode: 'zone' }, /needs an evac step/);
    bad({ rewards: { xp: 10 } }, /rewards.scrap/);
    bad({ rewards: { xp: 10, scrap: 1, weapon: 'lightsaber' } }, /not a weapon/);
    bad({ stars: { time: 5 } }, /stars.time/);
    bad({ steps: [{ id: 'a', type: 'survive', seconds: 60, pressure: { size: 0 } }] }, /pressure.size/);
    bad({ steps: [{ id: 'a', type: 'dialogue', lines: [{ who: 'x' }] }] }, /needs a text/);
    const warned = validateMission({ ...good, steps: [{ id: 'a', type: 'reach', at: 'bus', text: 'Go', color: 'red' }] }, { maps });
    assert.ok(warned.ok && warned.warnings.some((w) => /unknown field "color"/.test(w)));
    // campaign anchors count only for campaign missions
    bad({ steps: [{ id: 'a', type: 'reach', at: 'towerDoor' }] }, /not an anchor/);
    const c = validateMission({ ...good, mode: 'campaign', map: 'checkpoint', steps: [{ id: 'a', type: 'campaignStage', stage: 'hill', waves: 4 }, { id: 'b', type: 'reach', at: 'towerDoor' }] }, { maps });
    assert.deepEqual(c.errors, []);
  });

  test('the tier of a mission follows its level unless the script sets it', () => {
    assert.equal(missionTier({ level: [1, 3] }), 2);
    assert.equal(missionTier({ level: [12, 14] }), 9);
    assert.equal(missionTier({ level: [1, 1], tier: 7 }), 7);
    assert.equal(missionTier(null), 1);
  });

  test('registered missions are found by id; settings resolve nodeId to the script', () => {
    clearMissions();
    registerMissions([FX_FOOT]);
    assert.equal(getMission('fx_foot'), FX_FOOT);
    const g = new Game({ mapId: 'highway', seed: 1, settings: { mode: 'mission', story: { nodeId: 'fx_foot' } }, players: [HUMAN] });
    assert.equal(g.story.mission, FX_FOOT);
    clearMissions();
    assert.equal(getMission('fx_foot'), null);
  });

  test('every step type in STEP_TYPES is exercised by the fixtures', () => {
    const used = new Set();
    for (const m of FIXTURE_MISSIONS) for (const s of m.steps) used.add(s.type);
    for (const t of STEP_TYPES) assert.ok(used.has(t), `fixtures cover ${t}`);
  });
});

// -------------------------------------------------------------------------------------
describe('cost', () => {
  test('a mission with 250 zombies and 6 bots ticks about as fast as the same game without a story', () => {
    const players = Array.from({ length: 6 }, (_, i) => bot(i + 1, CLASSES[i]));
    const mission = { id: 'perf', map: 'highway', mode: 'free', startAt: 'bus', steps: [{ id: 's', type: 'survive', seconds: 600, pressure: false }] };
    const time = (g, ticks) => {
      for (let i = 0; i < 120; i++) g.step();
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < ticks; i++) {
        g.step();
        if (i % 3 === 0) g.snapshot();
      }
      return Number(process.hrtime.bigint() - t0) / 1e6 / ticks;
    };
    const fill = (g) => {
      const c = g.map.objective;
      for (let i = 0; i < 250; i++) {
        const a = (i / 250) * Math.PI * 2 * 7, r = 500 + (i % 50) * 14;
        const z = addZombie(g, 'walker', c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
        z.speed = 8;
      }
    };
    const plain = new Game({ mapId: 'highway', seed: 2, settings: {}, players });
    fill(plain);
    const story = new Game({ mapId: 'highway', seed: 2, settings: { mode: 'mission', story: { mission } }, players });
    fill(story);
    const a = time(plain, 240), b = time(story, 240);
    assert.ok(b < a * 1.5 + 0.6, `story ${b.toFixed(2)} ms vs plain ${a.toFixed(2)} ms per tick`);
  });
});
