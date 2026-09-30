// The written campaign (shared/story/missions.js) against the mission executor (sim/story.js +
// shared/story/validate.js): every story mission and side job validates against the real maps' anchors
// (the story levels' sections and gates included), starts, speaks and plays its first steps headless
// with AI survivors, and (with FULL_MISSIONS=1) is played to the end by four bots.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../public/js/shared/maps.js';
import { Game } from '../public/js/shared/sim.js';
import { validateMission } from '../public/js/shared/story/validate.js';
import { clearMissions, getMission, allMissions, missionOf } from '../public/js/shared/story/registry.js';
import { MISSIONS, STORY_MISSIONS, SIDE_JOBS } from '../public/js/shared/story/missions.js';
import { LEVEL_SPECS } from '../public/js/shared/levels/index.js';

const CLASSES = ['soldier', 'medic', 'engineer', 'scout', 'demo', 'heavy'];
const FULL = process.env.FULL_MISSIONS === '1';

function botGame(m, n, seed = 5, extra = {}) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: i + 1, name: 'Bot' + (i + 1), color: i, cls: CLASSES[i % 6], bot: true });
  return new Game({ mapId: m.map, seed, settings: { mode: 'mission', time: m.time, story: { mission: m, simMode: m.mode, ...extra } }, players });
}

describe('the written campaign: twelve story missions and twelve side jobs', () => {
  test('every one passes the validator against the real maps (campaign variants and the story levels included)', () => {
    assert.equal(STORY_MISSIONS.length, 12);
    assert.equal(SIDE_JOBS.length, 12);
    assert.equal(MISSIONS.length, 24);
    const maps = (id, o) => buildMap(id, 1, o || undefined);
    for (const m of MISSIONS) {
      const r = validateMission(m, { maps });
      assert.deepEqual(r.errors, [], `${m.id}: ${r.errors.join('; ')}`);
      assert.deepEqual(r.warnings, [], `${m.id}: ${r.warnings.join('; ')}`);
    }
  });

  test('the built story levels carry every section, anchor and gate the level missions name', () => {
    for (const m of STORY_MISSIONS.filter((x) => LEVEL_SPECS[x.map])) {
      const map = buildMap(m.map, 1);
      const sections = new Set((map.sections || []).map((s) => s.id));
      const gates = new Set((map.gates || []).map((g) => g.id));
      const named = JSON.stringify(m);
      for (const s of LEVEL_SPECS[m.map].sections) assert.ok(sections.has(s.id), `${m.id}: section ${s.id} is built`);
      for (const g of LEVEL_SPECS[m.map].gates) {
        assert.ok(gates.has(g.id), `${m.id}: gate ${g.id} is built`);
        assert.ok(named.includes(`"id":"${g.id}"`), `${m.id}: opens gate ${g.id}`);
      }
      for (const a of Object.values(LEVEL_SPECS[m.map].anchors).flat()) assert.ok(map.anchors[a], `${m.id}: anchor ${a} is built`);
    }
  });

  test('a session starts one by its id (settings.story.nodeId): the registry serves the story and the side jobs', () => {
    clearMissions();
    for (const m of MISSIONS) assert.equal(getMission(m.id), m);
    assert.equal(allMissions().length, MISSIONS.length);
    const g = new Game({ mapId: 'truckstop', seed: 3, settings: { mode: 'mission', story: { nodeId: 'sj_radio' } }, players: [{ id: 1, name: 'A', color: 0, cls: 'soldier' }] });
    assert.equal(g.story.missionId, 'sj_radio');
    assert.equal(g.story.steps.length, SIDE_JOBS.find((m) => m.id === 'sj_radio').steps.length);
    const lv = new Game({ mapId: 'millroad', seed: 3, settings: { mode: 'mission', story: { nodeId: 'm1_2' } }, players: [{ id: 1, name: 'A', color: 0, cls: 'soldier' }] });
    assert.equal(lv.story.missionId, 'm1_2');
    assert.equal(missionOf({ story: { nodeId: 'm1_2' } }).map, 'millroad');
    const c = new Game({ mapId: 'harlan', seed: 3, settings: { mode: 'mission', story: { nodeId: 'm6_1' } }, players: [{ id: 1, name: 'A', color: 0, cls: 'soldier' }] });
    assert.ok(c.campaign, 'a campaign mission runs on the campaign director');
  });

  test('each one starts, speaks and plays its first 40 s with three AI survivors without trouble', () => {
    for (const m of MISSIONS) {
      const g = botGame(m, 3);
      const started = [];
      for (let t = 0; t < 40 * 60; t++) {
        g.step();
        if (t % 3 === 0) {
          for (const e of g.snapshot().events) if (e.type === 'objective' && e.what === 'start') started.push(e.id);
        }
        if (g.over) break;
      }
      assert.ok(started.length > 0 || m.steps[0].type === 'wait' || m.steps[0].type === 'dialogue', `${m.id}: an objective starts`);
      assert.ok(g.players.some((p) => p.state !== 'dead'), `${m.id}: nobody has been wiped out in 40 s`);
      assert.notEqual(g.story.steps.some((s) => s.type === 'custom'), true, `${m.id}: every step type is implemented`);
      assert.ok(Number.isFinite(g.players[0].x), `${m.id}: sane positions`);
    }
  });

  test('a bonus never blocks: the notes and side steps are all live from the step they name', () => {
    for (const m of MISSIONS) {
      if (!m.bonus || !m.bonus.length) continue;
      const g = botGame(m, 2);
      assert.equal(g.story.bonusSteps.length, m.bonus.length, m.id);
    }
  });

  test('FULL_MISSIONS=1: four bots play every classic-map mission to its end (the finale and the story levels need people and agent E\'s engine)', { skip: FULL ? false : 'set FULL_MISSIONS=1 (a few minutes)' }, () => {
    for (const m of MISSIONS) {
      if (m.id === 'm6_2' || LEVEL_SPECS[m.map]) continue;
      const g = botGame(m, 4);
      let end = null;
      for (let t = 0; t < 1500 * 60; t++) {
        g.step();
        if (t % 3 === 0) for (const e of g.snapshot().events) if (e.type === 'storyend') end = e;
        if (g.over) break;
      }
      for (const e of g.snapshot().events) if (e.type === 'storyend') end = e;
      assert.ok(end, `${m.id}: the mission ended`);
      assert.equal(end.result, 'victory', `${m.id}: ${end.reason} at ${g.time.toFixed(0)} s`);
    }
  });
});
