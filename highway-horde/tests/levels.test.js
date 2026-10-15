// The story levels (JOURNEY.md): long routes of sections joined by gates. Every level builds, keeps
// the names of its SPEC (the contract the missions and the engine are written against), stays out of
// the lobby, and is deterministic. The level-by-level checks of layout and art live with each level.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, buildMap } from '../public/js/shared/maps.js';
import { LEVEL_LIST, LEVEL_IDS, LEVEL_SPECS, isLevelId } from '../public/js/shared/levels/index.js';
import { checkLevelSpec, GATE_KINDS, ROOF_KINDS } from '../public/js/shared/levels/kit.js';

test('nine levels, in campaign order, none of them in the lobby', () => {
  assert.equal(LEVEL_IDS.length, 9);
  for (const id of LEVEL_IDS) {
    assert.ok(isLevelId(id));
    assert.ok(!MAP_LIST.some((m) => m.id === id), `${id} must not be offered by the lobby`);
  }
  for (let i = 1; i < LEVEL_LIST.length; i++) assert.ok(LEVEL_LIST[i].chapter >= LEVEL_LIST[i - 1].chapter);
  assert.ok(!isLevelId('highway'));
});

test('every level builds and keeps its SPEC', () => {
  for (const id of LEVEL_IDS) {
    const map = buildMap(id, 7);
    assert.equal(map.kind, 'level', id);
    assert.deepEqual(checkLevelSpec(map, LEVEL_SPECS[id]), [], id);
    // gates: solid obstacles tagged with their gate, of a known kind
    for (const g of map.gates) {
      assert.ok(GATE_KINDS.includes(g.kind), `${id}/${g.id}`);
      assert.ok(g.obstacles.length > 0, `${id}/${g.id}`);
      for (const oid of g.obstacles) {
        const o = map.obstacles.find((e) => e.id === oid);
        assert.ok(o && o.solid && o.gate === g.id && o.gateKind === g.kind, `${id}/${g.id}`);
      }
    }
    for (const r of map.roofs) assert.ok(ROOF_KINDS.includes(r.kind), `${id} roof kind ${r.kind}`);
    // every anchor, checkpoint and spawn is inside the world
    const inside = (x, y) => x >= 0 && y >= 0 && x <= map.width && y <= map.height;
    for (const [name, a] of Object.entries(map.anchors)) assert.ok(inside(a.x, a.y), `${id} anchor ${name}`);
    for (const c of map.checkpoints) assert.ok(inside(c.x, c.y), `${id} checkpoint`);
    for (const p of map.playerSpawns) assert.ok(inside(p.x, p.y), `${id} player spawn`);
    // the spec's sections are in travel order and each has the spawns of its section
    assert.deepEqual(map.sections.map((s) => s.id), LEVEL_SPECS[id].sections.map((s) => s.id));
  }
});

test('levels are deterministic for a seed', () => {
  for (const id of LEVEL_IDS) {
    const a = JSON.stringify(buildMap(id, 3));
    const b = JSON.stringify(buildMap(id, 3));
    assert.equal(a, b, id);
  }
});
