// The Cinematic tier and the display settings on the UI side (no browser): prefs validation of the new
// quality and its extras, presets, the "quality was never picked" rule behind the first-run GPU
// default, the renderer's settings object and the stats readout.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadPrefs, savePrefs, validateSettings, defaultClientSettings, QUALITIES, MSAA_MODES, FPS_CAPS, GRAPHICS_PRESETS, CALIB_MIN, CALIB_MAX,
} from '../public/js/ui/storage.js';
import {
  rendererSettings, applyPreset, presetMatches, applyDetectedTier, PRESET_KEYS, statsLine,
} from '../public/js/ui/gfx.js';
import { segValue } from '../public/js/ui/menus.js';

const CINE_KEYS = ['msaa', 'shadowsHigh', 'contactShadows', 'aoFull', 'fxHigh', 'motionBlur', 'dof', 'lensFx', 'lightShadows'];

function withStorage(store, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const old = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: old, configurable: true, writable: true });
    else delete globalThis.localStorage;
  }
}
function memStore(initial) {
  const mem = new Map(initial ? [['highway-horde:prefs:v1', JSON.stringify(initial)]] : []);
  return { mem, getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
}

test('Cinematic is a quality: first in the list, with a preset of its own', () => {
  assert.deepEqual(QUALITIES, ['cinematic', 'ultra', 'high', 'low']);
  assert.deepEqual(MSAA_MODES, [0, 2, 4, 8]);
  assert.deepEqual(FPS_CAPS, ['off', 60, 120, 144]);
  const c = GRAPHICS_PRESETS.cinematic;
  // Cinematic = everything Ultra does plus the extras (motion blur stays off: taste)
  for (const k of ['bloom', 'ao', 'filmGrain', 'vignette', 'volumetrics', 'reflections']) assert.equal(c[k], GRAPHICS_PRESETS.ultra[k], k);
  assert.equal(c.antialias, 'smaa');
  assert.equal(c.msaa, 4);
  for (const k of CINE_KEYS.filter((x) => x !== 'msaa' && x !== 'motionBlur')) assert.equal(c[k], true, k);
  assert.equal(c.motionBlur, false);
  // every other preset holds the extras off, so switching down never leaves one on
  for (const q of ['ultra', 'high', 'low']) {
    assert.equal(GRAPHICS_PRESETS[q].msaa, 0);
    for (const k of CINE_KEYS.filter((x) => x !== 'msaa')) assert.equal(GRAPHICS_PRESETS[q][k], false, `${q}.${k}`);
  }
  for (const q of QUALITIES) for (const k of PRESET_KEYS) assert.ok(k in GRAPHICS_PRESETS[q], `${q}.${k}`);
  for (const k of CINE_KEYS) assert.ok(PRESET_KEYS.includes(k), `${k} is part of a preset (a change makes it Custom)`);
});

test('prefs validation: the extras follow the preset of the quality when missing, garbage falls back', () => {
  const cine = validateSettings({ quality: 'cinematic', renderScale: 'auto' });
  assert.equal(cine.quality, 'cinematic');
  for (const k of CINE_KEYS) assert.equal(cine[k], GRAPHICS_PRESETS.cinematic[k], k);
  const ultra = validateSettings({ quality: 'ultra', renderScale: 'auto' });
  for (const k of CINE_KEYS) assert.equal(ultra[k], GRAPHICS_PRESETS.ultra[k], k);
  const custom = validateSettings({ quality: 'cinematic', renderScale: 'auto', msaa: 8, motionBlur: true, dof: false });
  assert.equal(custom.msaa, 8);
  assert.equal(custom.motionBlur, true);
  assert.equal(custom.dof, false);
  assert.equal(custom.contactShadows, true, 'the rest still follows the preset');
  const junk = validateSettings({ quality: 'cinematic', msaa: 3, shadowsHigh: 'yes', dof: 1, fpsCap: 90, displayBrightness: 'bright', displayContrast: 9, displaySaturation: 0 });
  assert.equal(junk.msaa, 4, 'not a sample count: the preset\'s');
  assert.equal(junk.shadowsHigh, true);
  assert.equal(junk.dof, true);
  assert.equal(junk.fpsCap, 'off');
  assert.equal(junk.displayBrightness, 1);
  assert.equal(junk.displayContrast, CALIB_MAX);
  assert.equal(junk.displaySaturation, CALIB_MIN);
  for (const cap of FPS_CAPS) assert.equal(validateSettings({ fpsCap: cap }).fpsCap, cap);
  const d = defaultClientSettings();
  assert.equal(d.fpsCap, 'off');
  assert.equal(d.displayBrightness, 1);
  assert.equal(d.displayContrast, 1);
  assert.equal(d.displaySaturation, 1);
  assert.equal(d.quality, 'ultra', 'the stored default stays Ultra: the GPU probe decides in the browser');
  assert.equal(d.qualityPicked, false);
});

test('a quality counts as picked only when the player made the choice', () => {
  const picked = (s) => validateSettings(s).qualityPicked;
  assert.equal(picked({}), false, 'a new profile');
  assert.equal(picked({ quality: 'ultra', renderScale: 'auto' }), false, 'the old default, saved with every profile');
  assert.equal(picked({ quality: 'high', renderScale: 'auto' }), true, 'someone changed it');
  assert.equal(picked({ quality: 'low', renderScale: 1 }), true);
  assert.equal(picked({ quality: 'cinematic', renderScale: 'auto' }), true);
  assert.equal(picked({ quality: 'ultra', qualityPicked: true }), true, 'the flag wins');
  assert.equal(picked({ quality: 'low', qualityPicked: false }), false, 'a detected default that was saved');
  const legacy = validateSettings({ quality: 'high' });           // a build before the graphics panel saved 'high' for everyone
  assert.equal(legacy.quality, 'ultra');
  assert.equal(legacy.qualityPicked, false);
  assert.equal(picked({ quality: 'epic' }), false, 'garbage is not a choice');
});

test('presets mark the quality as picked, the detection does not', () => {
  const s = defaultClientSettings();
  applyPreset(s, 'cinematic');
  assert.equal(s.quality, 'cinematic');
  assert.equal(s.qualityPicked, true);
  for (const k of PRESET_KEYS) assert.equal(s[k], GRAPHICS_PRESETS.cinematic[k], k);
  assert.equal(presetMatches(s), true);
  s.msaa = 2;
  assert.equal(presetMatches(s), false, 'a change to an extra makes it custom');
  const t = defaultClientSettings();
  applyPreset(t, 'cinematic', { picked: false });
  assert.equal(t.qualityPicked, false);
});

test('first-run GPU default: raises a never-picked quality, never touches a chosen one', () => {
  const fresh = defaultClientSettings();
  assert.equal(applyDetectedTier(fresh, 'cinematic'), true);
  assert.equal(fresh.quality, 'cinematic');
  assert.equal(fresh.qualityPicked, false, 'still a default: a later probe may refine it');
  for (const k of PRESET_KEYS) assert.equal(fresh[k], GRAPHICS_PRESETS.cinematic[k], k);
  assert.equal(applyDetectedTier(fresh, 'cinematic'), false, 'nothing to change');
  // a chosen quality stays, whatever the GPU says
  for (const q of QUALITIES) {
    const s = defaultClientSettings();
    applyPreset(s, q);
    assert.equal(applyDetectedTier(s, 'cinematic'), false, q);
    assert.equal(s.quality, q);
  }
  // effect toggles changed without picking a preset: the tier moves, the toggles stay, the extras arrive
  const tweaked = defaultClientSettings();
  tweaked.bloom = false;
  tweaked.filmGrain = false;
  assert.equal(applyDetectedTier(tweaked, 'cinematic'), true);
  assert.equal(tweaked.quality, 'cinematic');
  assert.equal(tweaked.bloom, false);
  assert.equal(tweaked.filmGrain, false);
  assert.equal(tweaked.msaa, 4);
  assert.equal(tweaked.contactShadows, true);
  // nothing recommended: nothing changes
  const same = defaultClientSettings();
  assert.equal(applyDetectedTier(same, null), false);
  assert.equal(applyDetectedTier(same, 'bogus'), false);
  assert.equal(same.quality, 'ultra');
  // a saved profile round-trips the decision
  withStorage(memStore(), () => {
    const prefs = loadPrefs();
    assert.equal(prefs.settings.qualityPicked, false);
    applyDetectedTier(prefs.settings, 'cinematic');
    savePrefs(prefs);
    const again = loadPrefs();
    assert.equal(again.settings.quality, 'cinematic');
    assert.equal(again.settings.qualityPicked, false);
    assert.equal(again.settings.msaa, 4);
  });
  // an old profile with the default Ultra saved: upgraded; one that chose High: left alone
  withStorage(memStore({ settings: { quality: 'ultra', renderScale: 'auto' } }), () => {
    const p = loadPrefs();
    assert.equal(applyDetectedTier(p.settings, 'cinematic'), true);
  });
  withStorage(memStore({ settings: { quality: 'high', renderScale: 'auto' } }), () => {
    const p = loadPrefs();
    assert.equal(applyDetectedTier(p.settings, 'cinematic'), false);
    assert.equal(p.settings.quality, 'high');
  });
});

test('the renderer\'s settings carry the extras and the calibration', () => {
  const s = defaultClientSettings();
  applyPreset(s, 'cinematic');
  s.displayBrightness = 1.1;
  s.displayContrast = 0.9;
  s.displaySaturation = 1.2;
  s.showStats = true;
  const out = rendererSettings(s, { crosshair: true });
  assert.equal(out.msaa, 4);
  for (const k of ['shadowsHigh', 'contactShadows', 'aoFull', 'fxHigh', 'dof', 'lensFx', 'lightShadows']) assert.equal(out[k], true, k);
  assert.equal(out.motionBlur, false);
  assert.equal(out.brightness, 1.1);
  assert.equal(out.contrast, 0.9);
  assert.equal(out.saturation, 1.2);
  assert.equal(out.timing, true, 'the stats overlay asks for per-pass GPU timings');
  // hand-edited garbage still produces a valid shape
  const odd = rendererSettings({ msaa: 5, brightness: 9, displayBrightness: 'x', displayContrast: 3, showStats: 'yes' });
  assert.equal(odd.msaa, 0);
  assert.equal(odd.brightness, 1);
  assert.equal(odd.contrast, CALIB_MAX);
  assert.equal(odd.timing, false);
});

test('the stats readout names the tier, the resolution, MSAA, the refresh rate and the passes', () => {
  const r = { renderScale: 1.5, gpuMs: 7.25, tier: 'cinematic', width: 5760, height: 3240, msaa: 4, refreshHz: 144 };
  assert.equal(statsLine({ fps: 143.6, renderStats: r, isHost: true }), '144 FPS · RES 150% · GPU 7.3 ms · HOST\nCINEMATIC · 5760×3240 · MSAA 4× · 144 Hz');
  const withPasses = { ...r, passMs: { world: 3.14, ao: 1.02, bloom: 0.01, atmos: 2.6 } };
  const lines = statsLine({ fps: 100, renderStats: withPasses, isHost: true }).split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[2], 'world 3.1 · ao 1.0 · atmos 2.6 ms', 'passes under 0.05 ms are left out');
  assert.equal(statsLine({ fps: 60, renderStats: { renderScale: 1, tier: 'high', width: 1920, height: 1080, msaa: 0 }, isHost: true }).split('\n')[1], 'HIGH · 1920×1080');
});

test('the new segmented controls parse', () => {
  assert.equal(segValue('4'), 4);
  assert.equal(segValue('0'), 0);
  assert.equal(segValue('off'), 'off');
  assert.equal(segValue('120'), 120);
});
