// Story levels in the engine (JOURNEY.md §4): validateLevel (the level agents' check of a
// built level), the flow field patch a gate opening needs, and the runtime helpers of
// shared/level.js. The level mission itself (gates, sections, actions ...) is
// tests/level-engine-sim.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../public/js/shared/maps.js';
import { LEVEL_IDS, LEVEL_SPECS } from '../public/js/shared/levels/index.js';
import { validateLevel } from '../public/js/shared/levels/kit.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import {
  levelGates, setGateColliders, syncGateColliders, sectionAt, nearestSection, levelSupplies, wayForward, gateIndex,
  checkpointsOf, isLevel,
} from '../public/js/shared/level.js';

/** A deep copy of a built map (validateLevel's negative cases edit it). */
function copyMap(m) {
  return JSON.parse(JSON.stringify(m));
}

test('every placeholder level passes validateLevel', () => {
  for (const id of LEVEL_IDS) {
    const map = buildMap(id, 7);
    assert.deepEqual(validateLevel(map, LEVEL_SPECS[id]), [], id);
    // (the SPEC is optional: the gates' sections are worked out from where they stand)
    assert.deepEqual(validateLevel(map), [], `${id} without its SPEC`);
  }
});

test('validateLevel catches a gate that does not block, a blocked spot, a lost checkpoint and a spawn in an earlier room', () => {
  const base = buildMap('millroad', 7);
  // a gate whose piece leaves a gap beside it
  let m = copyMap(base);
  const g = m.obstacles[m.gates[1].obstacles[0]];
  g.h = 120;
  let out = validateLevel(m, LEVEL_SPECS.millroad);
  assert.ok(out.some((s) => s.includes('"trailer_gate" does not block')), out.join('\n'));
  // an anchor and a checkpoint inside a wall
  m = copyMap(base);
  const wall = m.obstacles.find((o) => o.kind === 'wall' && !o.gate && o.h > 400);
  m.anchors.jam_wreck = { x: wall.x, y: wall.y, r: 100 };
  m.checkpoints.push({ section: 'jam', x: wall.x, y: wall.y });
  out = validateLevel(m, LEVEL_SPECS.millroad);
  assert.ok(out.some((s) => s.startsWith('anchor "jam_wreck" stands inside a wall')), out.join('\n'));
  assert.ok(out.some((s) => s.startsWith('a checkpoint of "jam"') && s.includes('stands inside')), out.join('\n'));
  // a checkpoint walled in
  m = copyMap(base);
  const cp = m.checkpoints.find((c) => c.section === 'corn');
  for (const [dx, dy, w, h] of [[-60, 0, 20, 140], [60, 0, 20, 140], [0, -60, 140, 20], [0, 60, 140, 20]]) {
    m.obstacles.push({ id: m.obstacles.length, kind: 'wall', x: cp.x + dx, y: cp.y + dy, w, h, a: 0, solid: true, color: '#777777' });
  }
  out = validateLevel(m, LEVEL_SPECS.millroad);
  assert.ok(out.some((s) => s.includes('of "corn"') && s.includes('cannot be reached')), out.join('\n'));
  // a zombie spawn of a later section inside a roofed room of an earlier one
  m = copyMap(base);
  const sp = m.zombieSpawns.find((z) => z.section === 'trailers');
  m.roofs.push({ x: sp.x, y: sp.y, w: 400, h: 400, a: 0, height: 150, kind: 'plain', section: 'jam', dark: 0.75 });
  out = validateLevel(m, LEVEL_SPECS.millroad);
  assert.ok(out.some((s) => s.includes('of "trailers" lies inside a roofed room of "jam"')), out.join('\n'));
  // not a level at all
  assert.deepEqual(validateLevel(buildMap('highway', 1)), ['map.kind is not "level"']);
});

test('shared/level.js: gates, sections, supplies and the way forward', () => {
  const map = buildMap('millroad', 7);
  assert.ok(isLevel(map) && !isLevel(buildMap('highway', 1)));
  const gates = levelGates(map);
  assert.equal(gates.length, map.gates.length);
  assert.deepEqual(gates.map((g) => [g.from, g.to]), [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.equal(gateIndex(map, 'corn_fence'), 2);
  assert.equal(gateIndex(map, 'nope'), -1);
  // sections: the one further along wins where two rectangles overlap
  for (let i = 0; i < map.sections.length; i++) {
    const s = map.sections[i];
    assert.equal(sectionAt(map, s.x, s.y), i);
    assert.equal(checkpointsOf(map, i).length, 2);
  }
  assert.equal(sectionAt(map, -50, -50), -1);
  assert.equal(nearestSection(map, map.width + 400, map.sections[4].y), 4);
  // the way forward: the shut gate, then (once it is open) the next section's checkpoint
  let w = wayForward(map, 0, [false, false, false, false]);
  assert.equal(w.kind, 'gate');
  assert.equal(w.gate.id, 'gas_shutter');
  w = wayForward(map, 0, [{ open: true }, false, false, false]);
  assert.equal(w.kind, 'section');
  assert.equal(w.section, 1);
  assert.equal(wayForward(map, 4, [true, true, true, true]), null);
  // supply crates: any obstacle tagged prop 'supply'
  assert.deepEqual(levelSupplies(map), []);
  const m2 = copyMap(map);
  m2.obstacles.push({ id: m2.obstacles.length, kind: 'container', x: 900, y: 700, w: 40, h: 30, a: 0, solid: false, prop: 'supply' });
  assert.deepEqual(levelSupplies(m2).map((s) => [s.x, s.y]), [[900, 700]]);
});

test('a gate collider switches off and on in a collision world', () => {
  const map = buildMap('millroad', 7);
  const world = createCollisionWorld(map);
  const g = levelGates(map)[0];
  const o = g.obs[0];
  assert.ok(!world.isCircleFree(o.x, o.y, 10));
  assert.ok(world.raycastSolid(o.x - 100, o.y, 1, 0, 200) >= 0);
  assert.equal(setGateColliders(world, map, 0, true), true);
  assert.equal(setGateColliders(world, map, 0, true), false);
  assert.ok(world.isCircleFree(o.x, o.y, 10));
  assert.ok(world.raycastSolid(o.x - 100, o.y, 1, 0, 200) < 0);
  assert.equal(syncGateColliders(world, map, [{ open: false }, false, false, false]), true);
  assert.ok(!world.isCircleFree(o.x, o.y, 10));
});

test('FlowField.patchRegion: the field paths through a gate once its colliders are off', () => {
  const map = buildMap('millroad', 7);
  const world = createCollisionWorld(map);
  const field = new FlowField(map, { colliders: world.colliders, pad: 3 });
  const shared = field.edges;
  const tgt = checkpointsOf(map, 0)[0];
  const far = checkpointsOf(map, 1)[0];
  field.update([tgt]);
  assert.ok(!field.reachable(far.x, far.y), 'behind the shut gate');
  const g = levelGates(map)[0];
  setGateColliders(world, map, 0, true);
  const t0 = performance.now();
  field.patchRegion(g.x0, g.y0, g.x1, g.y1);
  field.update([tgt]);
  const ms = performance.now() - t0;
  assert.ok(field.reachable(far.x, far.y), 'through the open gate');
  assert.notEqual(field.edges, shared, 'the shared static graph was copied, not written');
  // the patched graph is the one a fresh build over the open gate makes
  const fresh = new FlowField(map, { colliders: world.colliders, pad: 3 });
  assert.deepEqual(Array.from(field.edges), Array.from(fresh.edges));
  assert.deepEqual(Array.from(field.blocked), Array.from(fresh.blocked));
  assert.deepEqual(Array.from(field.escape), Array.from(fresh.escape));
  // and shut again: back to the first graph
  setGateColliders(world, map, 0, false);
  field.patchRegion(g.x0, g.y0, g.x1, g.y1);
  assert.deepEqual(Array.from(field.edges), Array.from(shared));
  field.update([tgt]);
  assert.ok(!field.reachable(far.x, far.y));
  assert.ok(ms < 200, `patch + update took ${ms.toFixed(1)} ms`);
});
