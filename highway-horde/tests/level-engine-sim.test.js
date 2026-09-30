// Story levels in the simulation (JOURNEY.md §4, SPEC §3.11): gates (colliders, the flow field,
// the zombies waiting behind them, shutting on someone), sections (area events, reach by
// section, spawns from the sections ahead, culling), checkpoints (respawns, late joiners),
// the defend point at an anchor, every scripted action, the wire, determinism and the cost.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../public/js/shared/maps.js';
import { Game } from '../public/js/shared/sim.js';
import { GameCore } from '../public/js/shared/sim/core.js';
import { encodeSnapshot, decodeSnapshot, EVENT_TYPES } from '../public/js/shared/protocol.js';
import { validateMission } from '../public/js/shared/story/validate.js';
import { LEVEL_ACTION_TYPES } from '../public/js/shared/story-defs.js';
import { IMPORTANT_EVENTS } from '../public/js/net/event-rules.js';
import {
  levelGates, sectionAt, checkpointsOf, sectionIndex, isLevel,
} from '../public/js/shared/level.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import { syncGateColliders } from '../public/js/shared/level.js';
import { DEFEND_HP } from '../public/js/shared/sim/level.js';
import { addZombie } from './helpers/sim-helpers.js';
import { LEVEL_TEST_MISSION } from './fixtures/level-mission.js';

const HUMAN = { id: 1, name: 'Human', color: 0, cls: 'soldier' };
const bot = (id) => ({ id, name: `Bot${id}`, color: id - 1, cls: ['soldier', 'medic', 'engineer', 'scout', 'demo'][id % 5], bot: true });
/** A level mission that never ends by itself (tests poke at the sim). */
const WAIT = (extra = {}) => ({ id: 'lv_wait', map: 'millroad', mode: 'free', steps: [{ id: 'w', type: 'wait', seconds: 99999, pressure: false, ...extra }] });

function levelGame(mission, { players = [HUMAN], seed = 3, map = null } = {}) {
  return new Game({
    mapId: mission.map, seed, map: map || undefined,
    settings: { mode: 'mission', difficulty: 'normal', story: { mission } },
    players,
  });
}

function play(g, seconds, until = () => g.over) {
  const events = [];
  for (let t = 0; t < seconds * 60; t++) {
    g.step();
    for (const e of g.snapshot().events) events.push(e);
    if (until(g)) break;
  }
  return events;
}

const ofType = (events, type) => events.filter((e) => e.type === type);
/** Keep the survivors alive whatever happens (tests about other things). */
function god(g) {
  for (const p of g.players) if (p.state === 'alive') p.hp = p.maxHp;
}

describe('gates', () => {
  test('a shut gate holds the zombies of the next section; open, they pour through', () => {
    const g = levelGame(WAIT());
    assert.ok(g.level && isLevel(g.map));
    const p = g.players[0];
    const gate = levelGates(g.map)[0];
    // the survivor stands 300 px before the gate; three walkers wait 300 px behind it
    p.x = gate.x - 300;
    p.y = gate.y;
    const zs = [0, 1, 2].map((k) => addZombie(g, 'walker', gate.x + 300, gate.y - 60 + k * 60));
    let events = play(g, 6, () => false);
    god(g);
    for (const z of zs) assert.ok(!z.dead && z.x > gate.x, `walker ${z.id} stays behind the shut gate (x ${z.x.toFixed(0)})`);
    assert.ok(!g.flow.reachable(zs[0].x, zs[0].y), 'no path from behind the gate');
    // a bullet stops at the gate, and so does the survivor
    assert.ok(g.world.raycastSolid(gate.x - 100, gate.y, 1, 0, 200) >= 0);
    assert.ok(!g.world.isCircleFree(gate.x, gate.y, 16));
    const t0 = performance.now();
    assert.equal(g.level.setGate('gas_shutter', true), true);
    const ms = performance.now() - t0;
    assert.equal(g.level.setGate('gas_shutter', true), false, 'opening an open gate is a no-op');
    assert.ok(g.world.raycastSolid(gate.x - 100, gate.y, 1, 0, 200) < 0, 'shots fly through an open gate');
    assert.ok(g.world.isCircleFree(gate.x, gate.y, 16), 'survivors walk through');
    assert.ok(g.flow.reachable(zs[0].x, zs[0].y) && g.flowBig.reachable(zs[0].x, zs[0].y), 'both zombie fields path through');
    events = play(g, 12, () => zs.every((z) => z.dead || z.x < gate.x - 60));
    assert.ok(zs.every((z) => z.dead || z.x < gate.x - 60), `the walkers came through: ${zs.map((z) => z.x.toFixed(0)).join(', ')}`);
    const snap = g.snapshot();
    assert.deepEqual(snap.level.gates.map((q) => q.open), [true, false, false, false]);
    assert.ok(snap.level.gates[0].t > 0);
    void events;
    assert.ok(ms < 80, `opening a gate (patch + both fields) took ${ms.toFixed(1)} ms`);
  });

  test('a gate event goes out; shutting it on someone pushes them out of it; bullets stop again', () => {
    const g = levelGame(WAIT());
    const gate = levelGates(g.map)[1];
    g.level.setGate(1, true);
    const ev = ofType(g.snapshot().events, 'gate');
    assert.deepEqual(ev.map((e) => [e.id, e.open]), [['trailer_gate', true]]);
    const p = g.players[0];
    p.x = gate.x;
    p.y = gate.y;
    const z = addZombie(g, 'walker', gate.x + 2, gate.y + 40);
    g.level.setGate('trailer_gate', false);
    assert.ok(g.world.isCircleFree(p.x, p.y, 15.5), `the survivor was pushed out (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
    assert.ok(g.world.isCircleFree(z.x, z.y, z.body - 0.5), 'so was the zombie');
    assert.ok(g.world.raycastSolid(gate.x - 100, gate.y, 1, 0, 200) >= 0);
    assert.deepEqual(ofType(g.snapshot().events, 'gate').map((e) => e.open), [false]);
  });

  test('the bots\' walk graph follows the gates', () => {
    const g = levelGame(WAIT(), { players: [HUMAN, bot(2)] });
    play(g, 0.5, () => false);
    assert.ok(g.botNav, 'the bots built their graph');
    const gate = levelGates(g.map)[0];
    const n = [];
    const path = new Int32Array(768);
    const len = () => g.botNav.find(gate.x - 200, gate.y, gate.x + 400, gate.y, path);
    n.push(len());
    const endX = g.botNav.cellX(path[n[0] - 1]);
    assert.ok(endX < gate.x, 'no way through the shut gate');
    g.level.setGate(0, true);
    n.push(len());
    assert.ok(g.botNav.cellX(path[n[1] - 1]) > gate.x + 300, 'the path goes through once it is open');
  });
});

describe('sections, spawns and checkpoints', () => {
  test('an NPC whose anchor the level lacks stands at the checkpoint instead of stopping the game', () => {
    const g = levelGame({ ...WAIT(), npcs: [{ id: 'mara', at: 'no_such_anchor' }] });
    let n = null;
    assert.doesNotThrow(() => { g.step(); n = g.npcs.find((q) => q.key === 'mara'); });
    assert.ok(n, 'the NPC exists');
    const cp = checkpointsOf(g.map, g.level.section)[0];
    assert.ok(Math.hypot(n.x - cp.x, n.y - cp.y) < 220, `near the checkpoint (${n.x}, ${n.y})`);
    // a step that brings one in later, the same
    assert.ok(g.story.spawnNpcDef({ id: 'deke', at: 'nowhere' }));
  });

  test('the first entry of each section sends an area event; reach { section } finishes', () => {
    const m = {
      id: 'lv_reach', map: 'millroad', mode: 'free',
      steps: [
        { id: 'r', type: 'reach', section: 'gasstation', pressure: false, onStart: [{ type: 'gate', id: 'gas_shutter' }] },
        { id: 'w', type: 'wait', seconds: 9999, pressure: false },
      ],
    };
    const g = levelGame(m, { players: [HUMAN, { ...HUMAN, id: 2, name: 'Two' }] });
    let ev = play(g, 0.5, () => false);
    assert.deepEqual(ofType(ev, 'area').map((e) => [e.id, e.name, e.i]), [['jam', 'The Jam', 0]]);
    const step = g.story.steps[0];
    assert.equal(step.state, 'active');
    assert.equal(step.text, 'Get to Mill Road Gas');
    const mark = g.snapshot().story.marks[0];
    assert.equal(mark.kind, 'reach', 'the gate is open: the marker is the section ahead');
    // one survivor walks in (who: 'any' by default)
    const cp = checkpointsOf(g.map, 1)[0];
    g.players[0].x = cp.x + 40;
    g.players[0].y = cp.y;
    ev = play(g, 1, () => false);
    assert.equal(step.state, 'done');
    assert.deepEqual(ofType(ev, 'area').map((e) => e.id), ['gasstation']);
    assert.equal(g.level.section, 1);
    assert.equal(g.level.checkpoint, 1);
    // walking back does not lower it, and a section is announced once
    g.players[0].x = 400;
    ev = play(g, 1, () => false);
    assert.equal(g.level.section, 1);
    g.players[0].x = cp.x + 40;
    ev = play(g, 1, () => false);
    assert.equal(ofType(ev, 'area').length, 0);
  });

  test('reach { section, who: all } waits for everyone; the marker points at a shut gate first', () => {
    const m = { id: 'lv_all', map: 'millroad', mode: 'free', steps: [{ id: 'r', type: 'reach', section: 'gasstation', who: 'all', pressure: false }] };
    const g = levelGame(m, { players: [HUMAN, { ...HUMAN, id: 2, name: 'Two' }] });
    play(g, 0.2, () => false);
    const mk = g.snapshot().story.marks[0];
    assert.equal(mk.kind, 'exit', 'a shut gate on the way is the marker');
    const gate = levelGates(g.map)[0];
    assert.ok(Math.abs(mk.x - gate.x) < 2 && Math.abs(mk.y - gate.y) < 2);
    g.level.setGate(0, true);
    const cp = checkpointsOf(g.map, 1)[0];
    g.players[0].x = cp.x;
    g.players[0].y = cp.y;
    play(g, 1, () => false);
    assert.equal(g.story.steps[0].state, 'active', 'one of two is not enough');
    g.players[1].x = cp.x + 50;
    g.players[1].y = cp.y;
    play(g, 1, () => g.over);
    assert.equal(g.over, 'victory');
  });

  test('zombies come from the spawns of the current and the next section; pressure.section overrides', () => {
    const g = levelGame(WAIT({ pressure: { waves: 2, pace: 3 } }));
    god(g);
    const seen = new Set();
    const where = () => {
      for (const z of g.zombies) {
        if (seen.has(z)) continue;
        seen.add(z);
      }
    };
    const secOf = new Map();
    for (let t = 0; t < 60 * 30; t++) {
      g.step();
      god(g);
      for (const z of g.zombies) if (!secOf.has(z.id + ':' + z.maxHp)) secOf.set(z.id + ':' + z.maxHp, sectionAt(g.map, z.x, z.y));
    }
    where();
    const secs = [...secOf.values()];
    assert.ok(secs.length >= 6, `zombies came (${secs.length})`);
    assert.ok(secs.every((s) => s === 0 || s === 1), `only from the jam and the gas station: ${JSON.stringify(secs)}`);
    assert.ok(secs.includes(0), 'most from the current section');
    // the checkpoint action moves the party on: the spawns follow
    g.level.setGate(0, true);
    g.level.setGate(1, true);
    g.level.setCheckpoint('trailers');
    assert.equal(g.level.section, 2);
    const rects = g.level.spawnRects().rects;
    assert.ok(rects.length && rects.every((r) => r.section === 'trailers' || r.section === 'corn'), JSON.stringify(rects.map((r) => r.section)));
    // pressure.section: that section only
    const m2 = WAIT({ pressure: { waves: 1, pace: 2, section: 'corn' } });
    const g2 = levelGame(m2);
    assert.equal(g2.story.sectionHint(), sectionIndex(g2.map, 'corn'));
    assert.ok(g2.story.spawnRects().rects.every((r) => r.section === 'corn'));
  });

  test('a rect behind a shut gate weighs less, and none is used once enough zombies wait there', () => {
    const g = levelGame(WAIT());
    const own = (q) => g.map.zombieSpawns.find((z) => z.x === q.x && z.y === q.y).weight;
    const r = g.level.spawnRects().rects;
    const cur = r.filter((q) => q.section === 'jam'), next = r.filter((q) => q.section === 'gasstation');
    assert.ok(cur.length && next.length);
    assert.ok(cur.every((q) => q.weight === own(q)), 'the current section: their own weights');
    assert.ok(next.every((q) => q.weight < own(q)), 'behind the shut shutter: lighter');
    g.level.penned = 100;
    g.level._rects = null;
    assert.ok(g.level.spawnRects().rects.every((q) => q.section === 'jam'), 'full: none behind the gate');
    g.level.setGate(0, true);
    g.level.penned = 0;
    const open = g.level.spawnRects().rects.filter((q) => q.section === 'gasstation');
    assert.ok(open.length && open.every((q) => q.weight === own(q)), 'open: as likely as the rest');
  });

  test('zombies left more than a section behind, far from everyone, are culled quietly', () => {
    const g = levelGame(WAIT());
    for (let i = 0; i < 4; i++) g.level.setGate(i, true);
    const back = addZombie(g, 'walker', 500, 500);
    const near = addZombie(g, 'walker', 3700, 600);
    g.level.setCheckpoint('corn');
    const cp = checkpointsOf(g.map, 3)[0];
    g.players[0].x = cp.x;
    g.players[0].y = cp.y;
    const ev = play(g, 1.2, () => false);
    assert.ok(back.dead && back.culled, 'the one in the jam is gone');
    assert.ok(!near.culled, 'one a section behind stays');
    assert.equal(ofType(ev, 'zdie').filter((e) => e.id === back.id).length, 0, 'no death event');
    assert.equal(g.level.stats.culled, 1);
  });

  test('respawns and late joiners appear at a checkpoint of the checkpoint section', () => {
    const m = { ...WAIT(), respawn: 1 };
    const g = levelGame(m, { players: [HUMAN, { ...HUMAN, id: 2, name: 'Two' }] });
    g.level.setGate(0, true);
    g.level.setCheckpoint('gasstation');
    const cps = checkpointsOf(g.map, 1);
    const near = (p) => cps.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 180);
    const a = g.players[0];
    a.x = cps[0].x + 200;
    a.y = cps[0].y;
    const b = g.players[1];
    b.state = 'dead';
    b.hp = 0;
    play(g, 2, () => b.state === 'alive');
    assert.equal(b.state, 'alive');
    assert.ok(near(b), `respawned at a gas station checkpoint (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`);
    const c = g.addPlayer({ id: 3, name: 'Late', color: 2, cls: 'medic' });
    assert.equal(c.state, 'alive');
    assert.ok(near(c), `the late joiner too (${c.x.toFixed(0)}, ${c.y.toFixed(0)})`);
  });
});

describe('defend at an anchor', () => {
  test('a defend point: hp, the snapshot, the marker, zombies attack it, losing it fails the mission', () => {
    const m = { id: 'lv_def', map: 'millroad', mode: 'free', steps: [{ id: 'd', type: 'defend', target: 'gas_tow', seconds: 300, pressure: false }] };
    const g = levelGame(m);
    g.step();
    const a = g.map.anchors.gas_tow;
    assert.ok(g.objective, 'an objective is up');
    assert.equal(g.objective.maxHp, DEFEND_HP);
    const snap = g.snapshot();
    assert.deepEqual(snap.objective, { hp: DEFEND_HP, maxHp: DEFEND_HP });
    assert.equal(snap.level.defend, 'Gas tow');
    assert.ok(snap.story.marks.some((q) => q.kind === 'defend' && q.x === Math.round(a.x) && q.y === Math.round(a.y)));
    assert.match(snap.story.steps[0].text, /Defend gas tow/);
    // the zombies go for it (the survivor is far away, behind a shut gate)
    const zs = [0, 1, 2, 3].map((k) => addZombie(g, 'walker', a.x + 90 * Math.cos(k * 1.6), a.y + 90 * Math.sin(k * 1.6)));
    play(g, 8, () => false);
    assert.ok(g.objective.hp < DEFEND_HP, `the walkers chew on it (${g.objective.hp})`);
    void zs;
    g.objective.hp = 0;
    const ev = play(g, 1);
    assert.equal(g.over, 'objective');
    const end = ofType(ev, 'storyend')[0];
    assert.equal(end.result, 'defeat');
    assert.equal(end.reason, 'objective');
  });

  test('the defend point goes when its step ends', () => {
    const m = { id: 'lv_def2', map: 'millroad', mode: 'free', steps: [{ id: 'd', type: 'defend', target: 'jam_wreck', seconds: 10, pressure: false }, { id: 'w', type: 'wait', seconds: 999, pressure: false }] };
    const g = levelGame(m);
    play(g, 11, () => false);
    assert.equal(g.objective, null);
    assert.equal(g.level.defend, null);
    assert.equal(g.snapshot().level.defend, '');
  });
});

describe('scripted actions', () => {
  test('every action, with delays, in order; events for the clients, lasting state in the snapshot', () => {
    const m = {
      id: 'lv_acts', map: 'millroad', mode: 'free',
      steps: [{
        id: 'w', type: 'wait', seconds: 999, pressure: false,
        onStart: [
          { type: 'title', text: 'MILL ROAD', sub: 'Dawn' },
          { type: 'music', state: 'battle', delay: 0.5 },
          { type: 'gate', id: 'gas_shutter', delay: 1 },
          { type: 'lights', section: 'jam', on: false, delay: 1 },
          { type: 'checkpoint', section: 'gasstation', delay: 1.5 },
          { type: 'shake', k: 0.7, delay: 2 },
          { type: 'horde', at: 'jam_wreck', count: 8, zombie: 'runner', delay: 2 },
          { type: 'horde', section: 'gasstation', count: 4, delay: 2.5 },
          { type: 'explode', at: 'jam_semi', r: 260, damage: 5000, delay: 3 },
          { type: 'gate', id: 'gas_shutter', open: false, delay: 4 },
          { type: 'lights', section: 'jam', on: true, delay: 4 },
        ],
      }],
    };
    assert.deepEqual([...new Set(m.steps[0].onStart.map((a) => a.type))].sort(), [...LEVEL_ACTION_TYPES].sort(), 'the test covers every action');
    const g = levelGame(m);
    const p = g.players[0];
    const semi = g.map.anchors.jam_semi;
    p.x = semi.x + 120;
    p.y = semi.y;
    const hp0 = p.hp;
    const ev = [];
    const at = [];
    for (let t = 0; t < 60 * 5; t++) {
      g.step();
      if (t === 60 * 3 + 2) {
        // just after the blast: the survivor was shoved, not hurt
        assert.ok(Math.hypot(p.kbx, p.kby) > 0 || Math.hypot(p.x - semi.x - 120, p.y - semi.y) > 4, 'shoved by the blast');
        assert.equal(p.hp, hp0, 'no damage from a scripted blast');
      }
      if (t === 60 * 2 + 30) at.push({ gate: g.level.isOpen(0), dark: g.level.dark, cp: g.level.checkpoint, snap: g.snapshot() });
      for (const e of g.snapshot().events) ev.push({ ...e, t });
    }
    const kinds = ev.filter((e) => ['title', 'music', 'gate', 'lights', 'checkpoint', 'shake', 'horde', 'explosion'].includes(e.type));
    assert.deepEqual(kinds.map((e) => e.type), ['title', 'music', 'gate', 'lights', 'checkpoint', 'area', 'shake', 'horde', 'horde', 'explosion', 'gate', 'lights']
      .filter((k) => k !== 'area'));
    const tOf = (type, n = 0) => ofType(ev, type)[n].t;
    assert.equal(tOf('title'), 0);
    assert.ok(Math.abs(tOf('music') - 30) <= 1 && Math.abs(tOf('gate') - 60) <= 1 && Math.abs(tOf('explosion') - 180) <= 1, 'the delays');
    assert.deepEqual(ofType(ev, 'title')[0], { type: 'title', text: 'MILL ROAD', sub: 'Dawn', t: 0 });
    assert.equal(ofType(ev, 'music')[0].state, 'battle');
    assert.equal(ofType(ev, 'shake')[0].k, 0.7);
    // the lasting state, as the snapshot of 2.5 s showed it
    assert.equal(at[0].gate, true);
    assert.equal(at[0].dark, 1);
    assert.equal(at[0].cp, 1);
    assert.equal(at[0].snap.level.dark, 1);
    assert.equal(at[0].snap.level.checkpoint, 1);
    assert.equal(at[0].snap.level.section, 1, 'a checkpoint further on becomes the current section');
    // the hordes: 8 runners at the wreck (x 0.5 for one survivor = 4), 4 from the gas station (2)
    const hordes = ofType(ev, 'horde');
    assert.equal(hordes[0].n, 4);
    assert.equal(hordes[1].n, 2);
    const wreck = g.map.anchors.jam_wreck;
    assert.ok(Math.hypot(hordes[0].x - wreck.x, hordes[0].y - wreck.y) < 150, 'out of the wreck');
    assert.equal(sectionAt(g.map, hordes[1].x, hordes[1].y), 1, 'out of the gas station');
    // the blast killed what stood near it
    assert.ok(ofType(ev, 'zdie').length >= 1, 'the blast killed zombies');
    const ex = ofType(ev, 'explosion')[0];
    assert.equal(ex.r, 260);
    // shut and lit again at the end
    assert.equal(g.level.isOpen(0), false);
    assert.equal(g.level.dark, 0);
  });

  test('actions on a map that is not a level: title, music, shake, horde and explode work, gate / lights / checkpoint do nothing', () => {
    const m = {
      id: 'hw_acts', map: 'highway', mode: 'free',
      steps: [{
        id: 'w', type: 'wait', seconds: 999, pressure: false,
        onStart: [{ type: 'gate', id: 'x' }, { type: 'lights', section: 'x', on: false }, { type: 'checkpoint', section: 'x' }, { type: 'title', text: 'HIGHWAY 9' }, { type: 'horde', at: 'bus', count: 4 }],
      }],
    };
    const g = levelGame(m);
    assert.equal(g.level, null);
    const ev = play(g, 0.5, () => false);
    assert.deepEqual(ofType(ev, 'title').map((e) => e.text), ['HIGHWAY 9']);
    assert.equal(ofType(ev, 'horde').length, 1);
    assert.equal(g.snapshot().level, null);
  });
});

describe('the wire and determinism', () => {
  test('the level block and the level events round-trip', () => {
    const g = levelGame(WAIT());
    g.level.setGate(0, true);
    for (let t = 0; t < 30; t++) g.step();
    g.level.setLights('gasstation', false);
    g.level.setLights('corn', false);
    g.level.setCheckpoint('gasstation');
    g.story.enableObjective('gas_tow', 'The tow truck');
    const snap = g.snapshot();
    snap.events.push(
      { type: 'title', text: 'SAINT MERCY: EMERGENCY', sub: 'Chapter 2' }, { type: 'music', state: 'tension' },
      { type: 'shake', k: 0.4, x: 100, y: 200, r: 1800 }, { type: 'horde', x: 1000, y: 500, n: 12 },
    );
    const back = decodeSnapshot(encodeSnapshot(snap));
    assert.deepEqual(back.level, snap.level);
    assert.equal(back.level.gates[0].t, snap.level.gates[0].t);
    assert.equal(back.level.dark, (1 << 1) | (1 << 3));
    assert.equal(back.level.defend, 'The tow truck');
    assert.deepEqual(back.objective, snap.objective);
    for (const type of ['gate', 'area', 'lights', 'checkpoint', 'title', 'music', 'shake', 'horde']) {
      assert.ok(EVENT_TYPES.includes(type), `${type} has a binary schema`);
      assert.ok(IMPORTANT_EVENTS.has(type), `${type} is echoed`);
      const a = snap.events.filter((e) => e.type === type), b = back.events.filter((e) => e.type === type);
      assert.ok(a.length >= 1, `${type} was emitted`);
      assert.deepEqual(b, a, `${type} round-trips`);
    }
    // a map that is not a level carries no block
    const hw = new Game({ mapId: 'highway', seed: 1, players: [HUMAN], settings: {} });
    assert.equal(decodeSnapshot(encodeSnapshot(hw.snapshot())).level, null);
  });

  test('a client\'s prediction world follows the snapshot\'s gates', () => {
    const map = buildMap('millroad', 3);
    const world = createCollisionWorld(map);
    const gate = levelGates(map)[2];
    assert.ok(!world.isCircleFree(gate.x, gate.y, 10));
    assert.equal(syncGateColliders(world, map, [{ open: false }, { open: false }, { open: true }, { open: false }]), true);
    assert.ok(world.isCircleFree(gate.x, gate.y, 10));
    assert.equal(syncGateColliders(world, map, [{ open: false }, { open: false }, { open: true }, { open: false }]), false);
  });

  test('the test mission validates and a bot crew plays it through two gates, deterministically', () => {
    const v = validateMission(LEVEL_TEST_MISSION);
    assert.deepEqual(v.errors, [], v.errors.join('\n'));
    const run = () => {
      const g = levelGame(LEVEL_TEST_MISSION, { players: [bot(1), bot(2), bot(3)], seed: 11 });
      const ev = play(g, 150);
      return { g, ev, snap: JSON.stringify(g.snapshot()) };
    };
    const a = run(), b = run();
    assert.equal(a.snap, b.snap, 'identical runs');
    assert.equal(a.g.over, 'victory', `the crew got through (${a.g.over}, ${a.g.story.steps.map((s) => s.id + ':' + s.state).join(' ')})`);
    assert.deepEqual(ofType(a.ev, 'gate').map((e) => [e.id, e.open]), [['gas_shutter', true], ['trailer_gate', true]]);
    assert.deepEqual(ofType(a.ev, 'area').map((e) => e.id), ['jam', 'gasstation', 'trailers']);
    const end = ofType(a.ev, 'storyend')[0];
    assert.equal(end.result, 'victory');
  });
});

describe('cost', () => {
  /** A 12000 x 4000 level of rooms and streets: seven sections, six gates, spawns in every section. */
  function bigLevel() {
    const W = 12000, H = 4000, n = 7, SW = W / n;
    const map = {
      id: 'bench_level', name: 'Bench', kind: 'level', width: W, height: H, seed: 1,
      ambient: { darkness: 0.6, tint: '#334455' }, ground: '#333333', areas: [], lines: [], obstacles: [], decor: [], lights: [], fires: [],
      playerSpawns: [], zombieSpawns: [], objective: null, supply: null, overpass: null, pois: [], anchors: {}, interactables: [],
      sections: [], gates: [], checkpoints: [], roofs: [],
    };
    const ob = (x, y, w, h, extra = {}) => {
      const o = { id: map.obstacles.length, kind: 'wall', x, y, w, h, a: 0, color: '#777777', solid: true, wrecked: false, roof: null, ...extra };
      map.obstacles.push(o);
      return o;
    };
    for (let i = 0; i < n; i++) {
      const x0 = i * SW, cx = x0 + SW / 2;
      map.sections.push({ id: `s${i}`, name: `Section ${i}`, x: cx, y: H / 2, w: SW, h: H, i });
      // a grid of rooms (4 x 3) with doorways, around a street down the middle
      for (let rx = 0; rx < 3; rx++) {
        for (let ry = 0; ry < 4; ry++) {
          const x = x0 + 160 + rx * (SW - 320) / 2.2, y = 250 + ry * 950;
          if (ry === 2) continue;
          ob(x, y, 420, 14);
          ob(x, y + 360, 160, 14);
          ob(x + 330, y + 360, 160, 14);
          ob(x - 8, y + 180, 14, 360);
          ob(x + 420, y + 180, 14, 360);
        }
      }
      for (let k = 0; k < 10; k++) ob(x0 + 200 + (k * 137) % (SW - 400), 1900 + (k % 3) * 70, 100, 44, { kind: 'car', solid: false });
      map.checkpoints.push({ section: `s${i}`, x: x0 + 150, y: H / 2 + 120 }, { section: `s${i}`, x: x0 + 150, y: H / 2 - 160 });
      map.zombieSpawns.push({ x: x0 + SW - 200, y: 150, w: 200, h: 120, section: `s${i}` }, { x: x0 + SW - 200, y: H - 150, w: 200, h: 120, section: `s${i}` });
      if (i < n - 1) {
        const wx = x0 + SW;
        ob(wx, (H / 2 - 150) / 2, 40, H / 2 - 150);
        ob(wx, H - (H / 2 - 150) / 2, 40, H / 2 - 150);
        const gt = ob(wx, H / 2, 40, 300, { gate: `g${i}`, gateKind: 'shutter' });
        map.gates.push({ id: `g${i}`, kind: 'shutter', obstacles: [gt.id], label: '' });
      }
    }
    for (let k = 0; k < 6; k++) map.playerSpawns.push({ x: 150 + (k % 2) * 60, y: H / 2 - 60 + Math.floor(k / 2) * 60 });
    map.anchors.start = { x: 200, y: H / 2, r: 150 };
    return map;
  }

  test('a 12000 x 4000 level at the zombie cap: the step and a gate opening stay cheap', () => {
    const map = bigLevel();
    const players = [bot(1), bot(2), bot(3), bot(4), bot(5), bot(6)];
    const g = new GameCore({ map, seed: 9, settings: { mode: 'mission', difficulty: 'normal', story: { mission: { id: 'bench', steps: [{ id: 'w', type: 'wait', seconds: 9999, pressure: false }] } } }, players });
    // open half the route; the cap of zombies all over it
    for (let i = 0; i < 3; i++) g.level.setGate(i, true);
    const rng = g.rng;
    let placed = 0;
    while (placed < g.diff.maxAlive) {
      const x = rng.range(100, 7000), y = rng.range(100, 3900);
      if (!g.world.isCircleFree(x, y, 18)) continue;
      addZombie(g, placed % 9 === 0 ? 'runner' : 'walker', x, y);
      placed++;
    }
    for (const z of g.zombies) z.hp = z.maxHp = 1e9;
    for (let t = 0; t < 60; t++) g.step();
    const t0 = performance.now();
    const N = 300;
    for (let t = 0; t < N; t++) {
      g.step();
      for (const p of g.players) if (p.state !== 'alive') { p.state = 'alive'; p.hp = p.maxHp; }
      if (t % 10 === 0) g.snapshot();
    }
    const avg = (performance.now() - t0) / N;
    const t1 = performance.now();
    g.level.setGate(3, true);
    const gateMs = performance.now() - t1;
    // (under 4 ms / 30 ms on a quiet machine; the margins cover six agents sharing one)
    assert.ok(avg < 9, `sim step ${avg.toFixed(2)} ms with ${g.zombies.length} zombies on 12000 x 4000`);
    assert.ok(gateMs < 70, `a gate opening took ${gateMs.toFixed(1)} ms`);
    console.log(`# level cost: step ${avg.toFixed(2)} ms avg (${g.zombies.length} zombies, 6 bots, 12000 x 4000), gate opening ${gateMs.toFixed(1)} ms`);
  });
});
