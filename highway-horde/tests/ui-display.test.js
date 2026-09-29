// Graphics & display settings without a browser: prefs validation for the graphics panel,
// the resolution-aware UI scale, the settings object handed to the renderer, presets and
// the stats readout.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadPrefs, savePrefs, validateSettings, defaultClientSettings, DEFAULT_CLIENT_SETTINGS,
  FOV_MAX, RENDER_SCALES, UI_SCALES, GORE_MODES,
} from '../public/js/ui/storage.js';
import { autoUiScale, uiScaleFor, UI_AUTO_MAX } from '../public/js/ui/uiscale.js';
import {
  rendererSettings, applyPreset, presetMatches, GRAPHICS_PRESETS, PRESET_KEYS, statsLine, renderScaleLabel,
} from '../public/js/ui/gfx.js';
import { segValue } from '../public/js/ui/menus.js';

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

function memStore() {
  const mem = new Map();
  return { mem, getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
}

function withCoarse(coarse, fn) {
  const had = 'matchMedia' in globalThis;
  const old = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: coarse && q === '(pointer: coarse)' });
  try {
    return fn();
  } finally {
    if (had) globalThis.matchMedia = old;
    else delete globalThis.matchMedia;
  }
}

// ---- prefs --------------------------------------------------------------------------------

test('graphics defaults: ultra everywhere, auto resolution on desktops, 1 on phones, every effect on', () => {
  const desk = withCoarse(false, () => defaultClientSettings());
  const phone = withCoarse(true, () => defaultClientSettings());
  for (const s of [desk, phone]) {
    assert.equal(s.quality, 'ultra');
    assert.equal(s.bloom, true);
    assert.equal(s.ao, true);
    assert.equal(s.antialias, 'smaa');
    assert.equal(s.filmGrain, true);
    assert.equal(s.vignette, true);
    assert.equal(s.uiScale, 'auto');
    assert.equal(s.hudSafeArea, '16:9');
    assert.equal(s.fullscreenOnStart, false);
    assert.equal(s.rawMouse, true);
  }
  assert.equal(desk.renderScale, 'auto');
  assert.equal(phone.renderScale, 'auto', 'phones: Ultra with dynamic resolution so it stays playable');
  // Node has no matchMedia: the desktop defaults, which is what DEFAULT_CLIENT_SETTINGS holds.
  assert.deepEqual(defaultClientSettings(), DEFAULT_CLIENT_SETTINGS);
  assert.equal(FOV_MAX, 120, 'ultrawide players get up to 120°');
});

test('graphics prefs: every stored value is validated, garbage falls back to the default', () => {
  const junk = {
    quality: 'epic', renderScale: 7, bloom: 'yes', ao: 1, antialias: 'msaa', filmGrain: null, vignette: {},
    uiScale: 3, hudSafeArea: '21:9', fullscreenOnStart: 'true', rawMouse: 0, fov: 500,
  };
  const s = withCoarse(false, () => validateSettings(junk));
  assert.equal(s.quality, 'ultra');
  assert.equal(s.renderScale, 'auto');
  assert.equal(s.bloom, true);
  assert.equal(s.ao, true);
  assert.equal(s.antialias, 'smaa');
  assert.equal(s.filmGrain, true);
  assert.equal(s.vignette, true);
  assert.equal(s.uiScale, 'auto');
  assert.equal(s.hudSafeArea, '16:9');
  assert.equal(s.fullscreenOnStart, false);
  assert.equal(s.rawMouse, true);
  assert.equal(s.fov, FOV_MAX);
  // Out-of-range numbers are garbage too (not silently clamped to something unexpected).
  assert.equal(validateSettings({ renderScale: 0.2 }).renderScale, 'auto');
  assert.equal(validateSettings({ renderScale: Number.NaN }).renderScale, 'auto');
  assert.equal(validateSettings({ uiScale: 0.5 }).uiScale, 'auto');
  assert.equal(withCoarse(true, () => validateSettings({ renderScale: 'max' })).renderScale, 'auto', 'a phone falls back to its own default');
  // Every value the UI offers survives a save/load.
  for (const v of RENDER_SCALES) assert.equal(validateSettings({ renderScale: v }).renderScale, v);
  for (const v of UI_SCALES) assert.equal(validateSettings({ uiScale: v }).uiScale, v);
  for (const v of ['smaa', 'fxaa', 'off']) assert.equal(validateSettings({ antialias: v }).antialias, v);
  assert.equal(validateSettings({ hudSafeArea: 'full' }).hudSafeArea, 'full');
  assert.equal(validateSettings(null).quality, 'ultra');
});

test('missing effect toggles follow the preset of the stored quality', () => {
  // A player who picked Low before the graphics panel existed keeps a light setup.
  const low = validateSettings({ quality: 'low' });
  assert.equal(low.bloom, false);
  assert.equal(low.ao, false);
  assert.equal(low.antialias, 'fxaa');
  assert.equal(low.filmGrain, false);
  assert.equal(low.vignette, true);
  assert.equal(low.volumetrics, false);
  assert.equal(low.reflections, false);
  // Stored values still win, and junk falls back to the preset, not to Ultra.
  const mixed = validateSettings({ quality: 'low', renderScale: 'auto', bloom: true, ao: 'x' });
  assert.equal(mixed.bloom, true);
  assert.equal(mixed.ao, false);
  const high = validateSettings({ quality: 'high', renderScale: 1 });
  assert.equal(high.ao, false);
  assert.equal(high.bloom, true);
  assert.equal(high.volumetrics, true, 'High keeps the cheap quarter-resolution mist');
  assert.equal(high.reflections, false, 'screen-space reflections are an Ultra default');
  const ultra = validateSettings({ quality: 'ultra', renderScale: 1, volumetrics: 'x', reflections: false });
  assert.equal(ultra.volumetrics, true);
  assert.equal(ultra.reflections, false);
});

test('gore setting: on by default at every quality, validated, stored and passed to the renderer', () => {
  for (const q of ['ultra', 'high', 'low']) assert.equal(validateSettings({ quality: q, renderScale: 1 }).gore, 'on', `${q}: gore on`);
  assert.equal(DEFAULT_CLIENT_SETTINGS.gore, 'on');
  assert.deepEqual(GORE_MODES, ['on', 'low', 'off']);
  for (const v of GORE_MODES) assert.equal(validateSettings({ gore: v }).gore, v);
  for (const junk of ['ON', 'none', '', 0, 1, true, null, {}, [], 'red']) assert.equal(validateSettings({ gore: junk }).gore, 'on', `junk ${JSON.stringify(junk)} falls back to on`);
  // the choice is independent of the graphics preset
  assert.equal(validateSettings({ quality: 'low', gore: 'off' }).gore, 'off');
  // survives a save / load
  const store = memStore();
  withStorage(store, () => {
    const p = loadPrefs();
    p.settings.gore = 'off';
    savePrefs(p);
    assert.equal(loadPrefs().settings.gore, 'off');
  });
  // and rides along in the renderer's per-frame settings
  const s = withCoarse(false, () => defaultClientSettings());
  s.gore = 'low';
  assert.equal(rendererSettings(s, {}).gore, 'low');
  s.gore = 'bogus';
  assert.equal(rendererSettings(s, {}).gore, 'on');
  // presets do not own it (choosing a preset never changes the gore level)
  assert.ok(!PRESET_KEYS.includes('gore'));
});

test('graphics prefs round-trip; old builds\' unpicked "high" moves up to the new default', () => {
  const store = memStore();
  withStorage(store, () => {
    const p = loadPrefs();
    Object.assign(p.settings, {
      quality: 'high', renderScale: 0.7, bloom: false, ao: false, antialias: 'off', filmGrain: false, vignette: false,
      uiScale: 1.25, hudSafeArea: 'full', fullscreenOnStart: true, rawMouse: false, fov: 115,
    });
    savePrefs(p);
    const q = loadPrefs().settings;
    assert.equal(q.quality, 'high', 'a player who picked High (the file has renderScale) keeps it');
    assert.equal(q.renderScale, 0.7);
    assert.equal(q.bloom, false);
    assert.equal(q.antialias, 'off');
    assert.equal(q.uiScale, 1.25);
    assert.equal(q.hudSafeArea, 'full');
    assert.equal(q.fullscreenOnStart, true);
    assert.equal(q.rawMouse, false);
    assert.equal(q.fov, 115);
    // Prefs written before the graphics panel: 'high' was the saved desktop default.
    const key = [...store.mem.keys()][0];
    store.mem.set(key, JSON.stringify({ settings: { quality: 'high', master: 0.4 } }));
    const old = loadPrefs().settings;
    assert.equal(old.quality, 'ultra');
    assert.equal(old.master, 0.4);
    store.mem.set(key, JSON.stringify({ settings: { quality: 'low' } }));
    assert.equal(loadPrefs().settings.quality, 'low', 'an old Low choice is kept');
  });
});

// ---- UI scale ------------------------------------------------------------------------------

test('UI scale: 1× up to a windowed 1080p, grows with the height, holds on ultrawide', () => {
  assert.equal(autoUiScale(1280, 720), 1);
  assert.equal(autoUiScale(1366, 768), 1);
  assert.equal(autoUiScale(1920, 969), 1, 'windowed 1080p');
  assert.equal(autoUiScale(1920, 1080), 1.08, 'fullscreen 1080p');
  assert.equal(autoUiScale(2560, 1440), 1.44);
  assert.equal(autoUiScale(3840, 2160), 2.16, '4K at devicePixelRatio 1');
  assert.equal(autoUiScale(3440, 1440), 1.44, 'ultrawide: height decides, not width');
  assert.equal(autoUiScale(5120, 1440), 1.44, 'super ultrawide');
  assert.equal(autoUiScale(1440, 2560), 1.2, 'portrait monitor: the width caps it');
  assert.equal(autoUiScale(7680, 4320), UI_AUTO_MAX);
  assert.equal(autoUiScale(390, 844, true), 1, 'phones keep their touch layout');
  assert.equal(autoUiScale(2732, 2048, true), 1, 'tablets too');
  assert.equal(autoUiScale(0, 0), 1);
  assert.equal(autoUiScale(Number.NaN, 900), 1);
});

test('UI size multiplies the automatic scale; enlarging never squeezes the layout', () => {
  assert.equal(uiScaleFor(2560, 1440, 'auto'), 1.44);
  assert.equal(uiScaleFor(2560, 1440, 1.25), 1.8);
  assert.equal(uiScaleFor(2560, 1440, 0.75), 1.08);
  assert.equal(uiScaleFor(1280, 720, 0.75), 0.75, 'shrinking works on small windows too');
  // 150% on a 1280x720 window would leave 853x480 px of layout: capped at 1024x600 worth.
  assert.equal(uiScaleFor(1280, 720, 1.5), 1.2);
  assert.equal(uiScaleFor(390, 844, 1.5, true), 1, 'no room to grow on a phone');
  assert.equal(uiScaleFor(1920, 1080, 'junk'), 1.08, 'unknown settings act as auto');
  assert.equal(uiScaleFor(3840, 2160, 9), 3.24, 'the multiplier is clamped to 150%');
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160]]) {
    for (const m of ['auto', ...UI_SCALES]) {
      const s = uiScaleFor(w, h, m);
      assert.ok(Number.isFinite(s) && s >= 0.75, `${w}x${h} ${m} → ${s}`);
      if (typeof m === 'number' && m > 1) assert.ok(w / s >= 1023 && h / s >= 599, `${w}x${h} ${m}: layout room ${w / s}x${h / s}`);
    }
  }
});

// ---- renderer settings -----------------------------------------------------------------------

test('the renderer gets the graphics settings every frame, in the agreed shape', () => {
  const s = withCoarse(false, () => defaultClientSettings());
  const out = rendererSettings(s, { crosshair: true });
  assert.deepEqual(out, {
    crosshair: true, screenShake: true, showNames: true, lighting: true, fov: 80,
    renderScale: 'auto', bloom: true, ao: true, antialias: 'smaa', filmGrain: true, vignette: true,
    volumetrics: true, reflections: true, gore: 'on',
  });
  // Reuses the object it is given (the match loop passes the same one every frame).
  s.renderScale = 0.85;
  s.bloom = false;
  s.antialias = 'fxaa';
  s.fov = 120;
  s.screenShake = false;
  const again = rendererSettings(s, out);
  assert.equal(again, out);
  assert.equal(out.renderScale, 0.85);
  assert.equal(out.bloom, false);
  assert.equal(out.antialias, 'fxaa');
  assert.equal(out.fov, 120);
  assert.equal(out.screenShake, false);
  assert.equal(out.crosshair, true, 'crosshair is left to the match loop');
  // Defensive against unvalidated input: always a valid shape.
  const odd = rendererSettings({ renderScale: 'x', antialias: 'msaa', fov: 'wide' });
  assert.equal(odd.renderScale, 'auto');
  assert.equal(odd.antialias, 'smaa');
  assert.equal(odd.fov, 80);
  assert.equal(rendererSettings({ renderScale: 0.1 }).renderScale, 0.5);
});

test('presets set quality and effects; resolution is its own control; tweaks read as custom', () => {
  const s = withCoarse(false, () => defaultClientSettings());
  assert.equal(presetMatches(s), true, 'the defaults are the Ultra preset');
  s.renderScale = 0.7;
  applyPreset(s, 'low');
  assert.equal(s.quality, 'low');
  for (const k of PRESET_KEYS) assert.equal(s[k], GRAPHICS_PRESETS.low[k], k);
  assert.equal(s.renderScale, 0.7, 'a preset leaves the resolution alone');
  assert.equal(presetMatches(s), true);
  s.bloom = true;
  assert.equal(presetMatches(s), false, 'a tweak makes it custom');
  applyPreset(s, 'nonsense');
  assert.equal(s.quality, 'ultra');
  for (const q of ['ultra', 'high', 'low']) {
    for (const k of PRESET_KEYS) assert.ok(k in GRAPHICS_PRESETS[q], `${q}.${k}`);
  }
  assert.equal(GRAPHICS_PRESETS.ultra.ao, true);
  assert.equal(GRAPHICS_PRESETS.low.bloom, false);
  assert.equal(GRAPHICS_PRESETS.ultra.reflections, true);
  assert.equal(GRAPHICS_PRESETS.low.volumetrics, false);
});

test('stats readout: FPS, the renderer\'s resolution scale and GPU time, then network', () => {
  assert.equal(statsLine({ fps: 59.6, renderStats: { renderScale: 0.85, gpuMs: 7.25 }, ping: 31.4 }), '60 FPS · RES 85% · GPU 7.3 ms · PING 31 ms');
  assert.equal(statsLine({ fps: 144, renderStats: { renderScale: 1 }, isHost: true }), '144 FPS · RES 100% · HOST');
  assert.equal(statsLine({ fps: 60, renderStats: null, ping: 20, snapshotsPerSec: 20 }), '60 FPS · PING 20 ms · 20 snap/s');
  assert.equal(statsLine({ fps: 60, renderStats: { fps: 60 }, isHost: true }), '60 FPS · HOST', 'no renderScale reported yet');
  assert.equal(renderScaleLabel('auto'), 'Auto');
  assert.equal(renderScaleLabel(0.85), '85%');
});

test('settings segmented controls parse their values', () => {
  assert.equal(segValue('auto'), 'auto');
  assert.equal(segValue('0.85'), 0.85);
  assert.equal(segValue('1'), 1);
  assert.equal(segValue('16:9'), '16:9');
  assert.equal(segValue('smaa'), 'smaa');
});
