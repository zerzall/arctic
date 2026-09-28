import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, SOUND_IDS, renderSound, soundRate } from '../public/js/audio/sounds.js';
import { peak, rms, loopify, filter, makeBuf } from '../public/js/audio/synth.js';
import { createAudio, MAX_VOICES, orientedPan, rearShade } from '../public/js/audio/audio.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { ZOMBIE_IDS } from '../public/js/shared/zombies.js';
import { MockAudioContext } from './fixtures/audio-mock-context.js';

const SR = 8000; // low rate keeps the full-bank bakes in these tests fast

function engine(extra = {}) {
  const ctx = new MockAudioContext(SR);
  const audio = createAudio({ context: ctx, manual: true, syncBake: true, clock: () => ctx.currentTime, ...extra });
  return { ctx, audio, eng: audio.debug.engine };
}

function player(id, x, y, extra = {}) {
  return {
    id, x, y, angle: 0, state: 'alive', hp: 100, maxHp: 100, armor: 0, stamina: 100, sprinting: false,
    slot: 0, slots: ['pistol', null, null], ammo: [[12, -1], [0, 0], [0, 0]], reloading: 0, spin: 0, firing: false,
    meleeing: 0, bleedout: 0, ...extra,
  };
}

function view(extra = {}) {
  return {
    tick: 1, phase: 'wave', wave: 3, totalWaves: 15, timer: 0, remaining: 40, bossHp: -1, objective: null,
    players: [player(1, 0, 0)], zombies: [], projectiles: [], pickups: [], turrets: [], barricades: [], hazards: [],
    events: [], ...extra,
  };
}

test('every sound renders finite, normalised, non-silent audio', () => {
  for (const id of SOUND_IDS) {
    const def = SOUNDS[id];
    for (let v = 0; v < (def.v || 1); v++) {
      const b = renderSound(id, 22050, v);
      assert.ok(b.length > 10, `${id}#${v} is empty`);
      for (let i = 0; i < b.length; i++) if (!Number.isFinite(b[i])) assert.fail(`${id}#${v} has a non-finite sample`);
      const p = peak(b);
      assert.ok(p <= 0.9 + 1e-6, `${id}#${v} peak ${p}`);
      assert.ok(p > 0.3, `${id}#${v} too quiet (${p})`);
      assert.ok(b.length / soundRate(id, 22050) < 9, `${id}#${v} too long`);
    }
  }
});

test('rendering is deterministic per (id, variant) and variants differ', () => {
  const a = renderSound('rifle', 16000, 1);
  const b = renderSound('rifle', 16000, 1);
  assert.deepEqual(a, b);
  const c = renderSound('rifle', 16000, 2);
  assert.notDeepEqual(a.subarray(0, 200), c.subarray(0, 200));
});

test('gunshots are front-loaded: loud attack, decaying tail', () => {
  for (const id of ['pistol', 'magnum', 'shotgun', 'smg', 'rifle', 'rifle_heavy', 'sniper', 'lmg', 'minigun']) {
    const b = renderSound(id, 22050, 0);
    const head = rms(b, 0, Math.floor(22050 * 0.03));
    const tail = rms(b, Math.floor(b.length * 0.7));
    assert.ok(head > 0.08, `${id} attack rms ${head}`);
    assert.ok(head > tail * 3, `${id} should decay (${head} vs ${tail})`);
  }
});

test('every weapon sound and zombie type has a voice', () => {
  // The flamethrower is a pure loop (flame_loop + flame_start); everything else a one-shot.
  for (const w of Object.values(WEAPONS)) assert.ok(SOUNDS[w.sound] || SOUNDS[w.sound + '_loop'], `missing weapon sound ${w.sound}`);
  for (const z of ZOMBIE_IDS) assert.ok(SOUNDS['groan_' + z], `missing groan for ${z}`);
});

test('loops are seamless (no jump at the wrap point)', () => {
  const sr = 22050;
  for (const id of SOUND_IDS.filter((k) => SOUNDS[k].loop)) {
    const b = renderSound(id, sr, 0);
    let maxStep = 0;
    for (let i = 1; i < b.length; i++) maxStep = Math.max(maxStep, Math.abs(b[i] - b[i - 1]));
    const wrap = Math.abs(b[0] - b[b.length - 1]);
    assert.ok(wrap <= maxStep * 1.05 + 1e-3, `${id} seam ${wrap} vs max step ${maxStep}`);
  }
  // loopify itself: a ramp becomes continuous across the wrap.
  const ramp = new Float32Array(1000).map((_, i) => i / 1000);
  const l = loopify(ramp, 1000, 0.1);
  assert.ok(Math.abs(l[0] - l[l.length - 1]) < 0.02);
});

test('biquad lowpass attenuates high frequencies', () => {
  const sr = 8000;
  const hi = makeBuf(sr, 0.5);
  for (let i = 0; i < hi.length; i++) hi[i] = Math.sin(2 * Math.PI * 3000 * i / sr);
  filter(hi, sr, 'lowpass', 300);
  assert.ok(rms(hi, 400) < 0.02);
});

test('createAudio is a silent no-op without WebAudio (Node) and before unlock', async () => {
  const audio = createAudio();
  assert.doesNotThrow(() => {
    audio.addEvents([{ type: 'shot', pid: 1, weapon: 'pistol', x: 0, y: 0, rays: [] }], { x: 0, y: 0, localId: 1 });
    audio.update(view(), { localId: 1, dt: 1 / 60 });
    audio.ui('click');
    audio.setVolume({ master: 0.5, sfx: 2, music: -1 });
    audio.setMuted(true);
    audio.addEvents(null);
    audio.update(null);
  });
  assert.equal(await audio.unlock(), false);
  assert.equal(await audio.unlock(), false);
  assert.equal(audio.stats().state, 'locked');
});

test('unlock is idempotent and builds the graph once', async () => {
  const { ctx, audio } = engine();
  assert.equal(await audio.unlock(), true);
  const gains = ctx.nodes.gain;
  await audio.unlock();
  await audio.unlock();
  assert.equal(ctx.nodes.gain, gains);
  assert.equal(audio.stats().baked, audio.stats().total);
});

test('voice count never exceeds the cap; important sounds steal, trivial ones drop', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  for (let i = 0; i < 200; i++) eng.play('flesh', { local: true, lim: null });
  assert.equal(audio.stats().voices, MAX_VOICES);
  const stolen = audio.stats().stolen;
  assert.ok(eng.play('expl_frag', { local: true }), 'explosion must steal a slot');
  assert.equal(audio.stats().stolen, stolen + 1);
  assert.ok(audio.stats().voices <= MAX_VOICES);
  // Fill with loud own shots, then a distant groan cannot get in.
  for (let i = 0; i < 40; i++) eng.play('rifle', { local: true, prio: 90, lim: null });
  const dropped = audio.stats().dropped;
  assert.equal(eng.play('groan_walker', { x: 300, y: 0, lim: null }), false);
  assert.equal(audio.stats().dropped, dropped + 1);
  assert.ok(ctx.playing().length <= MAX_VOICES + 2); // stolen voices fade for 10 ms
});

test('rate limits cap groups of cheap sounds', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  let ok = 0;
  for (let i = 0; i < 20; i++) if (eng.play('groan_walker', { x: 10, y: 0 })) ok++;
  assert.equal(ok, 1, 'minimum gap within one instant');
  for (let i = 0; i < 20; i++) {
    ctx.currentTime += 0.13;
    eng.play('groan_runner', { x: 10, y: 0 });
  }
  let groans = 0;
  for (const s of eng.slots) if (s.end > ctx.currentTime && s.group === 'groan') groans++;
  assert.ok(groans <= 5, `groan group capped (${groans})`);
});

test('positional audio: distance culling, attenuation, pan; own shots centred and full', async () => {
  const { audio, eng } = engine();
  await audio.unlock();
  audio.addEvents([], { x: 0, y: 0, localId: 1 });
  assert.equal(eng.play('pistol', { x: 5000, y: 0 }), false, 'far away is inaudible');
  const sp = {};
  assert.ok(eng.spatial(400, 0, 1, sp));
  const near = sp.att;
  assert.ok(sp.pan > 0.3);
  eng.spatial(-1200, 0, 1, sp);
  assert.ok(sp.att < near && sp.pan < -0.8 && sp.lp < 5000);
  assert.equal(eng.spatial(1700, 0, 1, sp), false);
  assert.ok(eng.spatial(1700, 0, 2.2, sp), 'explosions carry further');
  audio.addEvents([{ type: 'shot', pid: 1, turret: 0, weapon: 'rifle', x: 900, y: 0, angle: 0, rays: [] }], { x: 900, y: 0, localId: 1 });
  const s = eng.slots.find((q) => q.group === 'rifle');
  assert.ok(s, 'own shot played');
  assert.equal(s.gainVal >= SOUNDS.rifle.g * 0.9, true);
  assert.equal(s.pan.pan.value, 0);
});

test('every event type (and junk) is handled without throwing', async () => {
  const { ctx, audio } = engine();
  await audio.unlock();
  audio.update(view({ players: [player(1, 0, 0), player(2, 200, 50)] }), { localId: 1, dt: 1 / 60 });
  const events = [
    { type: 'shot', pid: 2, turret: 0, weapon: 'shotgun', x: 200, y: 50, angle: 0, rays: [{ x: 400, y: 50, hit: 1 }, { x: 420, y: 60, hit: 2 }, { x: 900, y: 0, hit: 0 }] },
    { type: 'shot', pid: 0, turret: 3, weapon: 'rifle', x: 100, y: 100, angle: 0, rays: [] },
    { type: 'chain', pid: 1, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 90, y: 30 }, { x: 150, y: 20 }] },
    { type: 'melee', pid: 1, x: 0, y: 0, angle: 0, hits: 2 },
    { type: 'zdie', id: 5, ztype: 'brute', x: 100, y: 0, angle: 0, by: 1, gib: false },
    { type: 'zdie', id: 6, ztype: 'walker', x: 100, y: 0, angle: 0, by: 1, gib: true },
    { type: 'zdie', id: 7, ztype: 'boss', x: 3000, y: 0, angle: 0, by: 1, gib: true },
    { type: 'zattack', id: 5, ztype: 'boss', x: 50, y: 0, angle: 0 },
    { type: 'spit', id: 4, x: 300, y: 0, angle: 0 },
    { type: 'scream', id: 4, x: 300, y: 0 },
    { type: 'charge', id: 4, x: 300, y: 0, angle: 0 },
    { type: 'slam', id: 4, x: 300, y: 0, r: 190 },
    { type: 'explosion', x: 300, y: 0, r: 150, kind: 'frag' },
    { type: 'explosion', x: 300, y: 0, r: 180, kind: 'rocket' },
    { type: 'explosion', x: 300, y: 0, r: 115, kind: 'bloater' },
    { type: 'explosion', x: 300, y: 0, r: 130, kind: 'grenade' },
    { type: 'explosion', x: 300, y: 0, r: 130, kind: 'mystery' },
    { type: 'ignite', x: 100, y: 0, r: 110 },
    { type: 'pdamage', pid: 1, amount: 10, x: 5, y: 0 },
    { type: 'pdamage', pid: 2, amount: 10, x: 5, y: 0 },
    { type: 'down', pid: 2 }, { type: 'revived', pid: 2, by: 1 }, { type: 'died', pid: 2 }, { type: 'respawn', pid: 1 },
    { type: 'pickup', pid: 1, kind: 'cash', x: 0, y: 0, weapon: null },
    { type: 'pickup', pid: 2, kind: 'crate', x: 0, y: 0, weapon: 'lmg' },
    { type: 'buy', pid: 1, item: 'ammo' }, { type: 'buyfail', pid: 1, item: 'turret', reason: 'cash' },
    { type: 'reload', pid: 1, weapon: 'shotgun' }, { type: 'reload', pid: 2, weapon: 'unknown_gun' },
    { type: 'switch', pid: 1, weapon: 'pistol' }, { type: 'empty', pid: 1 },
    { type: 'throw', pid: 1, kind: 'frag' }, { type: 'throw', pid: 2, kind: 'molotov' },
    { type: 'place', pid: 1, kind: 'turret', x: 50, y: 0 }, { type: 'place', pid: 1, kind: 'barricade', x: 50, y: 0 },
    { type: 'destroyed', kind: 'turret', id: 1, x: 50, y: 0 }, { type: 'destroyed', kind: 'barricade', id: 2, x: 50, y: 0 },
    { type: 'objhit', x: 2500, y: 0 }, { type: 'wave', wave: 5, boss: true }, { type: 'bossspawn', id: 9, x: 1000, y: 0 },
    { type: 'waveclear', wave: 5, bonus: 250 }, { type: 'drop', x: 500, y: 500 }, { type: 'gameover', reason: 'wiped' },
    { type: 'victory' }, { type: 'totally_new_event', foo: 1 },
    null, 42, {}, { type: 'shot' }, { type: 'shot', weapon: 'rifle', rays: 'nope' }, { type: 'zdie' }, { type: 'explosion' },
    { type: 'chain', points: null }, { type: 'reload' }, { type: 'down', pid: 99 },
  ];
  assert.doesNotThrow(() => audio.addEvents(events, { x: 0, y: 0, localId: 1 }));
  assert.equal(audio.stats().errors, 0);
  assert.ok(audio.stats().played > 20);
  // Junk positional events (no coordinates) must not have been played centred.
  const before = audio.stats().played;
  audio.addEvents([{ type: 'zdie', ztype: 'walker' }, { type: 'explosion', kind: 'rocket', x: NaN, y: 0 }], { localId: 1 });
  assert.equal(audio.stats().played, before);
  assert.ok(audio.stats().voices <= MAX_VOICES);
  ctx.currentTime += 5;
  assert.doesNotThrow(() => audio.addEvents('garbage'));
  for (const name of ['click', 'hover', 'buy', 'deny', 'chat', 'join', 'leave', 'wave', 'waveclear', 'gameover', 'victory', 'countdown', 'ready', 'nope']) {
    assert.doesNotThrow(() => audio.ui(name));
  }
  assert.equal(audio.stats().errors, 0);
});

test('wave event and ui("wave") share one siren', async () => {
  const { audio, eng } = engine();
  await audio.unlock();
  audio.addEvents([{ type: 'wave', wave: 2, boss: false }], { x: 0, y: 0, localId: 1 });
  audio.ui('wave');
  assert.equal(eng.slots.filter((s) => s.group === 'st_wave' && s.end > 0).length, 1);
});

test('switching weapons cancels the pending reload sounds', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  audio.addEvents([{ type: 'reload', pid: 1, weapon: 'lmg' }], { x: 0, y: 0, localId: 1 });
  const pending = () => eng.slots.filter((s) => s.reloadPid === 1 && s.start > ctx.currentTime && s.end > ctx.currentTime).length;
  assert.ok(pending() >= 2);
  ctx.currentTime += 0.2;
  audio.addEvents([{ type: 'switch', pid: 1, weapon: 'pistol' }], { x: 0, y: 0, localId: 1 });
  assert.equal(pending(), 0);
});

test('loops follow the snapshot: minigun spin/fire, flamethrower, horde, fire, heartbeat', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  // Loops linger for a short grace period after they stop being wanted.
  const step = (v, dt = 0.2) => {
    ctx.currentTime += dt;
    audio.update(v, { localId: 1, dt });
  };
  const mini = player(1, 0, 0, { slot: 2, slots: ['pistol', null, 'minigun'], spin: 0.5 });
  step(view({ players: [mini] }));
  assert.ok(eng.loops.has('spin1'));
  assert.ok(!eng.loops.has('mfire1'));
  step(view({ players: [{ ...mini, spin: 1, firing: true }] }));
  assert.ok(eng.loops.has('mfire1'));
  step(view({ players: [{ ...mini, spin: 0, firing: false }] }));
  assert.ok(!eng.loops.has('spin1') && !eng.loops.has('mfire1'));

  const flamer = player(2, 300, 0, { slots: ['flamethrower', null, null], firing: true });
  step(view({ players: [player(1, 0, 0), flamer] }));
  assert.ok(eng.loops.has('flame2'));

  const zombies = [];
  for (let i = 0; i < 60; i++) zombies.push({ id: i, type: 'walker', x: 100 + i * 5, y: 40, angle: 0, hp: 1, flags: i < 3 ? 1 : 0 });
  step(view({ zombies, hazards: [{ id: 1, kind: 'fire', x: 100, y: 0, r: 110, life: 0.8 }, { id: 2, kind: 'acid', x: -100, y: 0, r: 60, life: 0.5 }] }));
  assert.ok(eng.loops.has('hordeFar') && eng.loops.has('hordeNear') && eng.loops.has('fire') && eng.loops.has('acid'));
  assert.ok(eng.loops.get('hordeFar').pan.pan.value > 0, 'horde to the right pans right');
  step(view());
  assert.equal(eng.loops.size, 0);

  const before = audio.stats().played;
  for (let i = 0; i < 120; i++) step(view({ players: [player(1, 0, 0, { hp: 12 })] }), 1 / 60);
  const beats = eng.slots.filter((s) => s.group === 'heartbeat').length;
  assert.ok(audio.stats().played - before >= 2 && beats >= 1, 'heartbeat at low hp');
  assert.ok(eng.muffleTarget < eng.maxLp);
  // Never more loops than the cap, however many flamethrowers there are.
  const many = [];
  for (let i = 1; i <= 40; i++) many.push(player(i, i * 10, 0, { slots: ['flamethrower', null, null], firing: true }));
  step(view({ players: many }));
  assert.ok(eng.loops.size <= 12);
});

test('music follows the phase: calm → wave → boss → game over', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  const run = (v, secs) => {
    for (let t = 0; t < secs; t += 0.05) {
      ctx.currentTime += 0.05;
      audio.update(v, { localId: 1, dt: 0.05 });
    }
  };
  run(view({ phase: 'intermission', timer: 20 }), 3);
  const calm = eng.music.intensity;
  const zombies = [];
  for (let i = 0; i < 50; i++) zombies.push({ id: i, type: 'walker', x: 200, y: i, angle: 0, hp: 1, flags: 0 });
  run(view({ zombies }), 4);
  assert.ok(eng.music.intensity > calm + 0.3, 'ramps up in a wave');
  run(view({ zombies, bossHp: 0.8 }), 3);
  assert.equal(eng.musicBoss, true);
  run(view({ phase: 'gameover' }), 1);
  assert.equal(eng.musicMode, 'gameover');
  assert.ok(ctx.nodes.oscillator >= 5, 'drone running');
});

test('volume and mute apply squared gains to the buses', async () => {
  const { audio, eng } = engine();
  audio.setVolume({ master: 0.5, music: 0 });
  await audio.unlock();
  assert.ok(Math.abs(eng.master.gain.value - 0.25) < 1e-9);
  assert.equal(eng.musicDry.gain.value, 0);
  audio.setMuted(true);
  assert.equal(eng.master.gain.value, 0);
  audio.setMuted(false);
  audio.setVolume({ sfx: 0.5, master: 7 });
  assert.equal(eng.master.gain.value, 1);
  assert.ok(Math.abs(eng.sfxDry.gain.value - 0.25) < 1e-9);
});

test('a stale backlog (tab back from background) only replays state changes', async () => {
  const { audio, eng } = engine();
  await audio.unlock();
  const backlog = [];
  for (let i = 0; i < 400; i++) backlog.push({ type: 'shot', pid: 2, turret: 0, weapon: 'rifle', x: 10, y: 0, angle: 0, rays: [] });
  backlog.push({ type: 'waveclear', wave: 3, bonus: 250 });
  audio.addEvents(backlog, { x: 0, y: 0, localId: 1 });
  assert.equal(eng.slots.filter((s) => s.group === 'rifle').length, 0);
  assert.equal(eng.slots.filter((s) => s.group === 'st_waveclear').length, 1);
});

test('shot prediction: predicted shots play like own shots, echoes are silent', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  audio.update(view({ players: [player(1, 0, 0), player(2, 300, 0)] }), { localId: 1, dt: 1 / 60 });
  const shot = (over) => ({ type: 'shot', pid: 1, turret: 0, weapon: 'rifle', x: 20, y: 0, angle: 0, rays: [{ x: 300, y: 0, hit: 1 }], ...over });
  let before = audio.stats().played;
  audio.addEvents([shot({ echo: true }), shot({ echo: true, weapon: 'shotgun' })], { x: 0, y: 0, localId: 1 });
  assert.equal(audio.stats().played, before, 'echo shots play nothing (no shot, no impact)');
  assert.equal(eng.lastShotT.has(1), false, 'echo does not feed the gun loops');
  audio.addEvents([shot({ predicted: true })], { x: 0, y: 0, localId: 1 });
  const s = eng.slots.find((q) => q.group === 'rifle' && q.end > ctx.currentTime);
  assert.ok(s, 'predicted shot played');
  assert.equal(s.pan.pan.value, 0, 'centred like an own shot');
  assert.ok(s.gainVal >= SOUNDS.rifle.g * 0.9);
  assert.ok(audio.stats().played >= before + 2, 'shot + impact');
  // Other players' shots are never echoes and still play.
  ctx.currentTime += 1;
  before = audio.stats().played;
  audio.addEvents([shot({ pid: 2, x: 300 })], { x: 0, y: 0, localId: 1 });
  assert.ok(audio.stats().played > before);
});

test('shot prediction: the minigun / flamethrower loops run on predicted shots, not echoes', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  const step = (v, dt = 1 / 60) => {
    ctx.currentTime += dt;
    audio.update(v, { localId: 1, dt });
  };
  const mini = player(1, 0, 0, { slot: 2, slots: ['pistol', null, 'minigun'], spin: 1, firing: false });
  step(view({ players: [mini] }));
  assert.ok(eng.loops.has('spin1') && !eng.loops.has('mfire1'));
  audio.addEvents([{ type: 'shot', pid: 1, turret: 0, weapon: 'minigun', x: 0, y: 0, angle: 0, rays: [], echo: true }], { x: 0, y: 0, localId: 1 });
  step(view({ players: [mini] }));
  assert.ok(!eng.loops.has('mfire1'), 'echo does not start the fire loop');
  audio.addEvents([{ type: 'shot', pid: 1, turret: 0, weapon: 'minigun', x: 0, y: 0, angle: 0, rays: [], predicted: true }], { x: 0, y: 0, localId: 1 });
  step(view({ players: [mini] }));
  assert.ok(eng.loops.has('mfire1'), 'predicted shot starts the fire loop');
  for (let i = 0; i < 30; i++) step(view({ players: [{ ...mini, spin: 0.2 }] }));
  assert.ok(!eng.loops.has('mfire1'), 'and it stops with the shots');
  const flamer = player(1, 0, 0, { slots: ['flamethrower', null, null], firing: false });
  audio.addEvents([{ type: 'shot', pid: 1, turret: 0, weapon: 'flamethrower', x: 0, y: 0, angle: 0, rays: [], predicted: true }], { x: 0, y: 0, localId: 1 });
  step(view({ players: [flamer] }));
  assert.ok(eng.loops.has('flame1'));
});

test('chainsaw idles in hand and screams while cutting; cryo hisses; neither plays per-shot sounds', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  const step = (v, dt = 1 / 60) => {
    ctx.currentTime += dt;
    audio.update(v, { localId: 1, dt });
  };
  const saw = player(1, 0, 0, { slot: 1, slots: ['pistol', 'chainsaw', null], firing: false });
  step(view({ players: [saw] }));
  assert.ok(eng.loops.has('sawidle1') && !eng.loops.has('saw1'));
  for (let i = 0; i < 20; i++) step(view({ players: [{ ...saw, firing: true }] }));
  assert.ok(eng.loops.has('saw1'));
  assert.equal(eng.loops.get('saw1').id, 'chainsaw_loop');
  // refuelling stalls the engine; downed (pistol out) it is silent
  for (let i = 0; i < 20; i++) step(view({ players: [{ ...saw, reloading: 0.5 }] }));
  assert.ok(!eng.loops.has('saw1') && !eng.loops.has('sawidle1'));
  const cryo = player(2, 200, 0, { slots: ['cryo', null, null], firing: true });
  step(view({ players: [player(1, 0, 0), cryo] }));
  assert.equal(eng.loops.get('cryo2').id, 'cryo_loop');
  const before = audio.stats().played;
  audio.addEvents([
    { type: 'shot', pid: 2, turret: 0, weapon: 'cryo', x: 200, y: 0, angle: 0, rays: [] },
    { type: 'shot', pid: 2, turret: 0, weapon: 'chainsaw', x: 200, y: 0, angle: 0, rays: [] },
  ], { x: 0, y: 0, localId: 1 });
  assert.equal(audio.stats().played, before, 'loop guns have no one-shot per shot');
  audio.addEvents([{ type: 'shot', pid: 2, turret: 0, weapon: 'chainsaw', x: 200, y: 0, angle: 0, rays: [{ x: 240, y: 0, hit: 1 }, { x: 230, y: 20, hit: 1 }] }], { x: 0, y: 0, localId: 1 });
  assert.equal(audio.stats().played, before + 1, 'one cutting sound for the zombies a sweep cut');
  audio.addEvents([{ type: 'freeze', id: 3, x: 100, y: 0 }], { x: 0, y: 0, localId: 1 });
  assert.equal(audio.stats().played, before + 2, 'a zombie freezing solid');
});

test('reload sounds are timed from the event time (perks), else the weapon table', async () => {
  const { ctx, audio, eng } = engine();
  await audio.unlock();
  const lastStart = (pid) => Math.max(...eng.slots.filter((s) => s.reloadPid === pid && s.end > ctx.currentTime).map((s) => s.start)) - ctx.currentTime;
  audio.addEvents([{ type: 'reload', pid: 1, weapon: 'rifle', time: 1.0 }], { x: 0, y: 0, localId: 1 });
  const fast = lastStart(1);
  assert.ok(Math.abs(fast - 0.86 * 1.0 * 0.95) < 0.02, `rack at ${fast}`);
  ctx.currentTime += 5;
  audio.addEvents([{ type: 'reload', pid: 1, weapon: 'rifle' }], { x: 0, y: 0, localId: 1 });
  const table = lastStart(1);
  assert.ok(Math.abs(table - 0.86 * WEAPONS.rifle.reload * 0.95) < 0.02, `rack at ${table}`);
});

test('setMap: permanent map fires crackle near the listener (the camera centre)', async () => {
  const { ctx, audio, eng } = engine();
  assert.doesNotThrow(() => audio.setMap({ fires: [{ x: 1000, y: 0, r: 28 }] }), 'safe before unlock');
  await audio.unlock();
  const step = (opts, v = view()) => {
    ctx.currentTime += 0.2;
    audio.update(v, { localId: 1, dt: 0.2, ...opts });
  };
  step({});
  assert.ok(!eng.loops.has('fire'), 'far from the fire (player at 0,0)');
  step({ x: 900, y: 0 });
  assert.ok(eng.loops.has('fire'), 'listener next to the burning wreck');
  assert.ok(eng.loops.get('fire').pan.pan.value > 0, 'fire to the right pans right');
  // A dead player spectating a teammate hears around the camera, not their corpse.
  const dead = player(1, 0, 0, { state: 'dead' });
  step({ x: 950, y: 30 }, view({ players: [dead, player(2, 950, 30)] }));
  assert.ok(eng.loops.has('fire'));
  assert.equal(eng.lx, 950);
  step({ x: 0, y: 0 });
  step({ x: 0, y: 0 });
  assert.ok(!eng.loops.has('fire'));
  audio.setMap(null);
  step({ x: 1000, y: 0 });
  step({ x: 1000, y: 0 });
  assert.ok(!eng.loops.has('fire'), 'cleared between games');
  assert.equal(audio.stats().errors, 0);
});

test('first-person panning math: sin of the angle off the facing direction, rear shading', () => {
  const o = {};
  // facing east (yaw 0): a sound to the south (+y) is on the right
  orientedPan(0, 400, 0, o);
  assert.ok(Math.abs(o.pan - 0.85) < 1e-9, `right: ${o.pan}`);
  assert.ok(Math.abs(o.behind) < 1e-9);
  orientedPan(0, -400, 0, o);
  assert.ok(Math.abs(o.pan + 0.85) < 1e-9, `left: ${o.pan}`);
  orientedPan(400, 0, 0, o);
  assert.ok(Math.abs(o.pan) < 1e-9 && o.behind === 0, 'ahead: centred');
  orientedPan(-400, 0, 0, o);
  assert.ok(Math.abs(o.pan) < 1e-9 && Math.abs(o.behind - 1) < 1e-9, 'behind: centred, fully behind');
  // turning the listener turns the image: facing south, the same southern sound is ahead
  orientedPan(0, 400, Math.PI / 2, o);
  assert.ok(Math.abs(o.pan) < 1e-9 && o.behind === 0);
  // facing north, a sound to the east is on the right
  orientedPan(400, 0, -Math.PI / 2, o);
  assert.ok(o.pan > 0.84);
  // 45° off to the right: sin(45°)
  orientedPan(300, 300, 0, o);
  assert.ok(Math.abs(o.pan - Math.SQRT1_2 * 0.85) < 1e-9);
  // right at the listener's feet: not hard-panned
  orientedPan(0, 30, 0, o);
  assert.ok(o.pan > 0 && o.pan < 0.3, `near field ${o.pan}`);
  orientedPan(0, 0, 1, o);
  assert.equal(o.pan, 0);
  // rear shading: nothing in front, quieter and duller behind
  const front = rearShade(0, 20000);
  assert.equal(front.gain, 1);
  assert.equal(front.lp, 20000);
  const back = rearShade(1, 20000);
  assert.ok(back.gain < 0.85 && back.gain >= 0.7, `rear gain ${back.gain}`);
  assert.ok(back.lp <= 4000, `rear lowpass ${back.lp}`);
  const side = rearShade(0.3, 20000);
  assert.ok(side.gain > back.gain && side.lp > back.lp);
});

test('first-person listener: pan follows the yaw, sounds behind are softer and muffled; no yaw = top-down', async () => {
  const { audio, eng } = engine();
  await audio.unlock();
  // top-down (no yaw): screen-relative, a sound above the listener is centred
  audio.addEvents([], { x: 0, y: 0, localId: 1 });
  const sp = {};
  eng.spatial(0, -400, 1, sp);
  assert.ok(Math.abs(sp.pan) < 1e-9, 'top-down: straight up the screen is centred');
  eng.spatial(400, 0, 1, sp);
  const topRight = sp.pan;
  assert.ok(topRight > 0.3);
  // first person facing north (-y): east is right, west is left, north ahead
  audio.addEvents([], { x: 0, y: 0, yaw: -Math.PI / 2, localId: 1 });
  eng.spatial(400, 0, 1, sp);
  assert.ok(sp.pan > 0.8, `east is right: ${sp.pan}`);
  eng.spatial(-400, 0, 1, sp);
  assert.ok(sp.pan < -0.8, `west is left: ${sp.pan}`);
  eng.spatial(0, -400, 1, sp);
  const ahead = { ...sp };
  eng.spatial(0, 400, 1, sp);
  const behind = { ...sp };
  assert.ok(Math.abs(ahead.pan) < 1e-9 && Math.abs(behind.pan) < 1e-9);
  assert.ok(behind.att < ahead.att, 'behind is quieter');
  assert.ok(behind.att > ahead.att * 0.7, 'but only slightly');
  assert.ok(behind.lp < ahead.lp && behind.lp <= 4000, 'and muffled');
  // turning around swaps them
  audio.update(view({ players: [player(1, 0, 0)] }), { localId: 1, dt: 1 / 60, x: 0, y: 0, yaw: Math.PI / 2 });
  eng.spatial(0, 400, 1, sp);
  assert.ok(Math.abs(sp.att - ahead.att) < 1e-9, 'now the southern sound is ahead');
  // a later call without yaw goes back to screen-relative panning
  audio.addEvents([], { x: 0, y: 0, localId: 1 });
  eng.spatial(400, 0, 1, sp);
  assert.equal(sp.pan, topRight);
  // a positional one-shot from the right plays on the right voice pan
  audio.addEvents([{ type: 'zattack', id: 3, ztype: 'walker', x: 0, y: 200, angle: 0 }], { x: 0, y: 0, yaw: 0, localId: 1 });
  const v = eng.slots.find((q) => q.end > 0 && q.pan && q.pan.pan.value > 0.5);
  assert.ok(v, 'a zombie on the right is heard on the right');
});
