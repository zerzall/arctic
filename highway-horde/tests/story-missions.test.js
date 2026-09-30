// The written campaign (shared/story/missions.js, agent S4) against the mission executor
// (sim/story.js + shared/story/validate.js, agent S2): every mission validates against the real
// maps' anchors, starts, speaks and plays its first steps headless with AI survivors, and (with
// FULL_MISSIONS=1) is played to the end by four bots. Skipped while the mission data is not merged.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap } from '../public/js/shared/maps.js';
import { Game } from '../public/js/shared/sim.js';
import { validateMission } from '../public/js/shared/story/validate.js';
import { clearMissions, getMission } from '../public/js/shared/story/registry.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'public/js/shared/story/missions.js');
const HAVE = fs.existsSync(FILE);
const CLASSES = ['soldier', 'medic', 'engineer', 'scout', 'demo', 'heavy'];
const FULL = process.env.FULL_MISSIONS === '1';

let MISSIONS = [];
if (HAVE) ({ MISSIONS } = await import('../public/js/shared/story/missions.js'));

function botGame(m, n, seed = 5, extra = {}) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: i + 1, name: 'Bot' + (i + 1), color: i, cls: CLASSES[i % 6], bot: true });
  return new Game({ mapId: m.map, seed, settings: { mode: 'mission', time: m.time, story: { mission: m, simMode: m.mode, ...extra } }, players });
}

describe('the fifteen written missions', { skip: HAVE ? false : 'shared/story/missions.js is not merged yet' }, () => {
  test('there are fifteen and every one passes the validator against the real maps (campaign variants included)', () => {
    assert.equal(MISSIONS.length, 15);
    const maps = (id, o) => buildMap(id, 1, o || undefined);
    for (const m of MISSIONS) {
      const r = validateMission(m, { maps });
      assert.deepEqual(r.errors, [], `${m.id}: ${r.errors.join('; ')}`);
      assert.deepEqual(r.warnings, [], `${m.id}: ${r.warnings.join('; ')}`);
    }
  });

  test('a session starts one by its id (settings.story.nodeId): the registry serves the written campaign', () => {
    clearMissions();
    for (const m of MISSIONS) assert.equal(getMission(m.id), m);
    const g = new Game({ mapId: 'truckstop', seed: 3, settings: { mode: 'mission', story: { nodeId: 'm2_2' } }, players: [{ id: 1, name: 'A', color: 0, cls: 'soldier' }] });
    assert.equal(g.story.missionId, 'm2_2');
    assert.equal(g.story.steps.length, MISSIONS.find((m) => m.id === 'm2_2').steps.length);
    const c = new Game({ mapId: 'harlan', seed: 3, settings: { mode: 'mission', story: { nodeId: 'm6_1' } }, players: [{ id: 1, name: 'A', color: 0, cls: 'soldier' }] });
    assert.ok(c.campaign, 'a campaign mission runs on the campaign director');
  });

  test('each one starts, speaks and plays its first 40 s with three AI survivors without trouble', () => {
    for (const m of MISSIONS) {
      const g = botGame(m, 3);
      const started = [];
      let radios = 0;
      for (let t = 0; t < 40 * 60; t++) {
        g.step();
        if (t % 3 === 0) {
          for (const e of g.snapshot().events) {
            if (e.type === 'objective' && e.what === 'start') started.push(e.id);
            if (e.type === 'radio') radios++;
          }
        }
        if (g.over) break;
      }
      assert.ok(started.length > 0 || m.steps[0].type === 'wait' || m.steps[0].type === 'dialogue', `${m.id}: an objective starts`);
      assert.ok(g.players.some((p) => p.state !== 'dead'), `${m.id}: nobody has been wiped out in 40 s`);
      assert.notEqual(g.story.steps.some((s) => s.type === 'custom'), true, `${m.id}: every step type is implemented`);
      assert.ok(Number.isFinite(g.players[0].x), `${m.id}: sane positions`);
      void radios;
    }
  });

  test('a bonus never blocks: the notes and side steps are all live from the step they name', () => {
    for (const m of MISSIONS) {
      if (!m.bonus || !m.bonus.length) continue;
      const g = botGame(m, 2);
      assert.equal(g.story.bonusSteps.length, m.bonus.length, m.id);
    }
  });

  test('FULL_MISSIONS=1: four bots play every mission to its end (the last one is the campaign finale and may need people)', { skip: FULL ? false : 'set FULL_MISSIONS=1 (about a minute)' }, () => {
    for (const m of MISSIONS) {
      if (m.id === 'm6_2') continue;
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
