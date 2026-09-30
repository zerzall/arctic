// Story levels in the audio engine (JOURNEY.md §4.3): a `music` action holds the score in a state
// for a while whatever the fight says, then lets the intensity lead again; a gate that opens is
// heard where it stands, with its kind's sound; the other level events make a sound.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../public/js/audio/audio.js';
import { buildMap } from '../public/js/shared/maps.js';
import { levelGates } from '../public/js/shared/level.js';
import { MockAudioContext } from './fixtures/audio-mock-context.js';

const SR = 8000;
const player = { id: 1, x: 0, y: 0, angle: 0, state: 'alive', hp: 100, maxHp: 100, armor: 0, stamina: 100, slot: 0,
  slots: ['pistol', null, null], ammo: [[12, -1], [0, 0], [0, 0]], reloading: 0, spin: 0, firing: false, meleeing: 0, bleedout: 0 };
const calmView = () => ({ tick: 1, phase: 'intermission', wave: 1, totalWaves: 1, timer: 999, remaining: 0, bossHp: -1,
  players: [player], zombies: [], projectiles: [], pickups: [], turrets: [], barricades: [], hazards: [], events: [] });

async function run(script) {
  const ctx = new MockAudioContext(SR);
  const audio = createAudio({ context: ctx, manual: true, syncBake: true, clock: () => ctx.currentTime, musicSeed: 4 });
  await audio.unlock();
  return script(ctx, audio, audio.debug.engine);
}

test('a music action holds the score in its state, then the fight leads again', async () => {
  await run((ctx, audio, eng) => {
    const states = [];
    for (let f = 0; f < 20 * 100; f++) {
      const t = f / 20;
      ctx.currentTime = t;
      if (f === 20 * 10) audio.addEvents([{ type: 'music', state: 'battle' }], { x: 0, y: 0, localId: 1 });
      audio.update(calmView(), { localId: 1, dt: 0.05 });
      states.push([t, audio.stats().musicState]);
    }
    const at = (t) => states.find(([x]) => x >= t)[1];
    assert.equal(at(8), 'calm', 'calm before');
    assert.equal(at(20), 'battle', 'held in battle with nobody around');
    assert.equal(eng.music.held, null, 'the hold has run out by the end');
    assert.notEqual(states[states.length - 1][1], 'battle', 'back to what the fight asks for');
    // unknown states are ignored (the intensity keeps leading)
    audio.addEvents([{ type: 'music', state: 'nonsense' }], { localId: 1 });
    assert.equal(eng.music.held, null);
  });
});

test('gates, lights, checkpoints and hordes are heard; gates where they stand', async () => {
  await run((ctx, audio, eng) => {
    const map = buildMap('millroad', 3);
    audio.setMap(map);
    const g = levelGates(map)[0];
    ctx.currentTime = 1;
    audio.update(calmView(), { localId: 1, dt: 0.05 });
    const before = ctx.sources.length;
    audio.addEvents([{ type: 'gate', id: g.id, open: true }], { x: g.x - 300, y: g.y, localId: 1 });
    assert.ok(ctx.sources.length > before, 'the gate opening makes a sound');
    const n1 = ctx.sources.length;
    audio.addEvents([{ type: 'gate', id: g.id, open: false }], { x: g.x - 300, y: g.y, localId: 1 });
    assert.ok(ctx.sources.length > n1, 'shutting too');
    const n2 = ctx.sources.length;
    audio.addEvents([{ type: 'gate', id: 'no_such_gate', open: true }], { localId: 1 });
    assert.equal(ctx.sources.length, n2, 'an unknown gate is silent');
    audio.addEvents([{ type: 'lights', section: 'x', on: false }, { type: 'checkpoint', section: 'x' }, { type: 'horde', x: g.x, y: g.y, n: 12 }], { x: g.x, y: g.y, localId: 1 });
    assert.ok(ctx.sources.length > n2, 'lights, checkpoint and horde sounds');
    // off a level nothing knows the gate
    audio.setMap(buildMap('highway', 1));
    const n3 = ctx.sources.length;
    audio.addEvents([{ type: 'gate', id: g.id, open: true }], { localId: 1 });
    assert.equal(ctx.sources.length, n3);
    assert.equal(eng.gates, null);
  });
});
