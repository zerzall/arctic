// GPU detection (ui/gpu.js): the renderer strings browsers report, cleaned up and matched against
// a conservative table. Cinematic is recommended only for cards known to hold it; mid-range
// discrete cards get Ultra; integrated, mobile, software and unrecognised strings get no
// recommendation (the existing default stays).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGpuName, classifyGpu, recommendedTier, gpuLabel, detectMobile } from '../public/js/ui/gpu.js';
import { applyDetectedTier } from '../public/js/ui/gfx.js';
import { DEFAULT_CLIENT_SETTINGS } from '../public/js/ui/storage.js';

const angle = (vendor, renderer, backend = 'D3D11') => `ANGLE (${vendor}, ${renderer} Direct3D11 vs_5_0 ps_5_0, ${backend})`;

test('renderer strings are cleaned to a readable name', () => {
  const cases = [
    [angle('NVIDIA', 'NVIDIA GeForce RTX 4070 Ti SUPER'), 'NVIDIA GeForce RTX 4070 Ti SUPER'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 4070 Ti SUPER'],
    ['ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon RX 7900 XTX'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'Apple M2 Pro'],
    ['ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 535.54)', 'NVIDIA GeForce RTX 3080'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel Arc A770 Graphics'],
    ['NVIDIA GeForce RTX 3060/PCIe/SSE2', 'NVIDIA GeForce RTX 3060'],
    ['AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49, 5.19.0)', 'AMD Radeon RX 6700 XT'],
    ['NVIDIA GeForce GTX 980, or similar', 'NVIDIA GeForce GTX 980'],
    ['', ''],
    [null, ''],
  ];
  for (const [raw, want] of cases) assert.equal(cleanGpuName(raw), want, String(raw));
});

/** [renderer string or name, class, tier] */
const TABLE = [
  // NVIDIA RTX 50 / 40 / 30 / 20
  [angle('NVIDIA', 'NVIDIA GeForce RTX 4070 Ti SUPER'), 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 5090', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 5070', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 4090', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 4080 SUPER', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 4060', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 4060 Ti', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 4050 Laptop GPU', 'mid', 'ultra'],
  ['NVIDIA GeForce RTX 4070 Laptop GPU', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 3090', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 3060', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 3060 Laptop GPU', 'mid', 'ultra'],
  ['NVIDIA GeForce RTX 3070 Ti Laptop GPU', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 3050', 'mid', 'ultra'],
  ['NVIDIA GeForce RTX 2080 Ti', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 2070 SUPER', 'high', 'cinematic'],
  ['NVIDIA GeForce RTX 2060', 'mid', 'ultra'],
  ['NVIDIA GeForce RTX 2070 with Max-Q Design', 'mid', 'ultra'],
  ['NVIDIA RTX A5000', 'high', 'cinematic'],
  ['NVIDIA RTX A2000', 'mid', 'ultra'],
  ['NVIDIA TITAN RTX', 'high', 'cinematic'],
  // NVIDIA GTX
  ['NVIDIA GeForce GTX 1080 Ti', 'high', 'cinematic'],
  ['NVIDIA GeForce GTX 1080', 'high', 'cinematic'],
  ['NVIDIA GeForce GTX 1070', 'mid', 'ultra'],
  ['NVIDIA GeForce GTX 1660 SUPER', 'mid', 'ultra'],
  ['NVIDIA GeForce GTX 1650', 'mid', 'ultra'],
  ['NVIDIA GeForce GTX 960', 'unknown', null],
  // AMD
  ['AMD Radeon RX 7900 XTX', 'high', 'cinematic'],
  ['AMD Radeon RX 7800 XT', 'high', 'cinematic'],
  ['AMD Radeon RX 7700 XT', 'high', 'cinematic'],
  ['AMD Radeon RX 7600 XT', 'high', 'cinematic'],
  ['AMD Radeon RX 7600', 'mid', 'ultra'],
  ['AMD Radeon RX 6950 XT', 'high', 'cinematic'],
  ['AMD Radeon RX 6800 XT', 'high', 'cinematic'],
  ['AMD Radeon RX 6700 XT', 'high', 'cinematic'],
  ['AMD Radeon RX 6800M', 'high', 'cinematic'],
  ['AMD Radeon RX 6700M', 'mid', 'ultra'],
  ['AMD Radeon RX 6650 XT', 'mid', 'ultra'],
  ['AMD Radeon RX 6600', 'mid', 'ultra'],
  ['AMD Radeon RX 5700 XT', 'mid', 'ultra'],
  ['AMD Radeon RX 9070 XT', 'high', 'cinematic'],
  ['AMD Radeon RX 9060 XT', 'high', 'cinematic'],
  ['AMD Radeon(TM) Graphics', 'integrated', null],
  ['AMD Radeon 780M Graphics', 'integrated', null],
  // Apple
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'high', 'cinematic'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)', 'high', 'cinematic'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Ultra, Unspecified Version)', 'high', 'cinematic'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)', 'high', 'cinematic'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)', 'high', 'cinematic'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'mid', 'ultra'],
  ['Apple GPU', 'unknown', null],
  // Intel
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high', 'cinematic'],
  ['Intel(R) Arc(TM) B580 Graphics', 'high', 'cinematic'],
  ['Intel(R) Arc(TM) A380 Graphics', 'mid', 'ultra'],
  ['Intel(R) Arc(TM) Graphics', 'integrated', null],
  ['ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', null],
  ['Intel(R) Iris(R) Xe Graphics', 'integrated', null],
  // phones, software and junk
  ['Adreno (TM) 730', 'integrated', null],
  ['Mali-G78', 'integrated', null],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software', null],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software', null],
  ['Microsoft Basic Render Driver', 'software', null],
  ['', 'unknown', null],
  ['Some Future GPU 9000', 'unknown', null],
];

test('the GPU table: strong cards get Cinematic, mid-range Ultra, the rest no recommendation', () => {
  for (const [raw, cls, tier] of TABLE) {
    const g = classifyGpu(raw);
    assert.equal(g.class, cls, `${raw} -> class ${g.class}`);
    assert.equal(g.tier, tier, `${raw} -> tier ${g.tier}`);
  }
});

test('the recommendation: never for phones, only Cinematic / Ultra otherwise', () => {
  const rtx = classifyGpu(angle('NVIDIA', 'NVIDIA GeForce RTX 4070 Ti SUPER'));
  assert.equal(rtx.name, 'NVIDIA GeForce RTX 4070 Ti SUPER');
  assert.equal(rtx.vendor, 'NVIDIA');
  assert.equal(recommendedTier(rtx), 'cinematic');
  assert.equal(recommendedTier(rtx, { coarse: true }), null, 'a touch device keeps the existing default');
  assert.equal(recommendedTier(classifyGpu('NVIDIA GeForce RTX 2060')), 'ultra');
  assert.equal(recommendedTier(classifyGpu('Intel(R) UHD Graphics 630')), null);
  assert.equal(recommendedTier(null), null);
  assert.equal(recommendedTier({ tier: 'low' }), null, 'only tiers above the default are ever recommended');
});

test('the Settings line names the card and the recommendation', () => {
  const g = classifyGpu(angle('NVIDIA', 'NVIDIA GeForce RTX 4070 Ti SUPER'));
  assert.equal(gpuLabel(g), 'NVIDIA GeForce RTX 4070 Ti SUPER — Cinematic recommended');
  assert.equal(gpuLabel(g, { coarse: true }), 'NVIDIA GeForce RTX 4070 Ti SUPER');
  assert.equal(gpuLabel(classifyGpu('NVIDIA GeForce RTX 2060')), 'NVIDIA GeForce RTX 2060 — Ultra recommended');
  assert.equal(gpuLabel(classifyGpu('Intel(R) UHD Graphics 630')), 'Intel UHD Graphics 630');
  assert.match(gpuLabel(classifyGpu('llvmpipe (LLVM 15.0.7, 256 bits)')), /software rendering/);
  assert.equal(gpuLabel(null), '');
  assert.equal(gpuLabel(classifyGpu('')), '');
});

// ---- phones and tablets (the memory of a phone's tab: SPEC §7.5.3) ----

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
};

test('phones and tablets are detected: iOS, iPadOS posing as a Mac, Android, small touch screens', () => {
  const iphone = detectMobile({ ua: UA.iphone, maxTouchPoints: 5, coarse: true, screenW: 440, screenH: 956, gpu: 'Apple GPU' });
  assert.deepEqual([iphone.mobile, iphone.ios], [true, true]);
  // iPadOS Safari in desktop mode: a Mac user agent with several touch points
  const ipad = detectMobile({ ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5, coarse: true, screenW: 1032, screenH: 1376 });
  assert.deepEqual([ipad.mobile, ipad.ios], [true, true]);
  assert.equal(detectMobile({ ua: UA.android, maxTouchPoints: 5, coarse: true, screenW: 412, screenH: 915 }).mobile, true);
  // an unknown user agent on a small touch-first screen
  assert.equal(detectMobile({ ua: 'SomeBrowser/1.0', maxTouchPoints: 5, coarse: true, screenW: 400, screenH: 800 }).mobile, true);
  // the Apple GPU string on a touch device with a non-iOS user agent (a site-specific UA override)
  assert.equal(detectMobile({ ua: 'SomeBrowser/1.0', maxTouchPoints: 5, coarse: false, screenW: 1920, screenH: 1080, gpu: 'Apple GPU' }).mobile, true);
});

test('desktops are not phones: Safari on a Mac, a desktop with a touch screen, big touch displays', () => {
  // macOS Safari also reports "Apple GPU" but has no touch points
  assert.equal(detectMobile({ ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 0, coarse: false, screenW: 1512, screenH: 982, gpu: 'Apple GPU' }).mobile, false);
  assert.equal(detectMobile({ ua: UA.winChrome, maxTouchPoints: 0, coarse: false, screenW: 2560, screenH: 1440 }).mobile, false);
  // a touch laptop whose primary pointer is the trackpad
  assert.equal(detectMobile({ ua: UA.winChrome, maxTouchPoints: 10, coarse: false, screenW: 1920, screenH: 1080 }).mobile, false);
  // a big touch-first display
  assert.equal(detectMobile({ ua: UA.linuxChrome, maxTouchPoints: 10, coarse: true, screenW: 3840, screenH: 2160 }).mobile, false);
  assert.equal(detectMobile({}).mobile, false);
});

test('phones and tablets start on Low; desktop recommendations are unchanged', () => {
  const apple = classifyGpu('Apple GPU');
  assert.equal(apple.tier, null, 'Safari hides the model: no recommendation from the table');
  assert.equal(recommendedTier(apple, { coarse: true, mobile: true }), 'low');
  assert.equal(recommendedTier(classifyGpu('Adreno (TM) 750'), { coarse: true, mobile: true }), 'low');
  // even a strong GPU name on a tablet (an M-series iPad through a Chromium browser) starts on Low
  assert.equal(recommendedTier(classifyGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)'), { mobile: true }), 'low');
  // desktops: exactly as before
  assert.equal(recommendedTier(classifyGpu(angle('NVIDIA', 'NVIDIA GeForce RTX 4070 Ti SUPER')), { coarse: false, mobile: false }), 'cinematic');
  assert.equal(recommendedTier(classifyGpu('NVIDIA GeForce RTX 2060'), { mobile: false }), 'ultra');
  assert.equal(recommendedTier(classifyGpu('Apple GPU'), { mobile: false }), null, 'Safari on a Mac keeps the default');
  assert.equal(recommendedTier(classifyGpu('Intel(R) UHD Graphics 630'), { mobile: false }), null);
});

test('a first-run phone profile moves to Low; a quality the player picked stays (with a warning)', () => {
  const s = { ...DEFAULT_CLIENT_SETTINGS, keys: { ...DEFAULT_CLIENT_SETTINGS.keys } };
  assert.equal(s.quality, 'ultra');
  assert.equal(applyDetectedTier(s, recommendedTier(classifyGpu('Apple GPU'), { coarse: true, mobile: true })), true);
  assert.equal(s.quality, 'low');
  assert.equal(s.qualityPicked, false, 'the detection does not count as a pick');
  const picked = { ...DEFAULT_CLIENT_SETTINGS, quality: 'high', qualityPicked: true };
  assert.equal(applyDetectedTier(picked, 'low'), false);
  assert.equal(picked.quality, 'high');
  const g = classifyGpu('Apple GPU');
  assert.match(gpuLabel(g, { coarse: true, mobile: true, quality: 'low' }), /Low recommended/);
  assert.match(gpuLabel(g, { coarse: true, mobile: true, quality: 'high' }), /more memory/);
});
