// Renderer frame-cost benchmark (developer tooling, not part of the game).
//
//   node scripts/dev/render/perf.mjs [--size 1080p] [--throttle 4] [--frames 300] [--quality 2] [--set key=value ...]
//
// Plays a large chain reaction with eight fighters through the real Renderer in headless Chromium, with the CPU throttled through
// the DevTools protocol (default 4x), and prints the per-frame cost, driven by requestAnimationFrame like the game loop:
// `js` = handleEvents + render (recording the frame), `interval` = time between frames (what the player gets, raster included).
// Headless Chromium rasterises in software, so the numbers are pessimistic for real devices.
import { createRequire } from 'node:module';
import { serve, openHarness, SIZES } from './shots.mjs';

const require = createRequire('/opt/node22/lib/node_modules/');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
const { chromium } = require('playwright');

const args = { size: '1080p', throttle: 4, frames: 300, quality: 2, set: {}, theme: 'meadow' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, ''), val = process.argv[i + 1];
  if (key === 'set') { const [k, ...rest] = val.split('='); args.set[k] = Number.isNaN(Number(rest.join('='))) ? rest.join('=') : Number(rest.join('=')); }
  else args[key] = Number.isNaN(Number(val)) ? val : Number(val);
}

const server = await serve();
const browser = await chromium.launch({ args: ['--no-sandbox', ...(process.env.CHROMIUM_ARGS ? process.env.CHROMIUM_ARGS.split(' ') : [])] });
try {
  const page = await openHarness(browser, server.address().port);
  const client = await page.context().newCDPSession(page);
  if (args.throttle > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: args.throttle });
  const [w, h, dpr] = SIZES[args.size] ?? args.size.split(/[x@]/).map(Number);
  // CPU seconds per browser process (renderer, GPU/raster): a steady cost measure that vsync quantisation and throttling cannot blur.
  const sys = await browser.newBrowserCDPSession();
  const procs = async () => { const out = {}; for (const p of (await sys.send('SystemInfo.getProcessInfo')).processInfo) out[p.type] = (out[p.type] ?? 0) + p.cpuTime; return out; };
  const before = await procs();
  const r = await page.evaluate((o) => window.harness.perf(o), { css: [w, h], dpr, frames: args.frames, quality: args.quality, theme: args.theme, ...args.set });
  const after = await procs();
  const perFrame = (t) => (((after[t] ?? 0) - (before[t] ?? 0)) * 1000) / (r.frames + 24);
  const f = (s) => `mean ${s.mean.toFixed(2)}  p50 ${s.p50.toFixed(2)}  p95 ${s.p95.toFixed(2)}  max ${s.max.toFixed(2)} ms`;
  console.log(`${args.size} tile ${r.tile}px dpr ${r.dpr.toFixed(2)} canvas ${r.canvas.join('x')}  throttle ${args.throttle}x  quality ${args.quality}`);
  console.log(`  js   ${f(r.js)}`);
  console.log(`  interval ${f(r.interval)}`);
  if (r.full) console.log(`  flushed ${f(r.full)}`);
  if (r.profile) console.log('  ms/frame by section:', JSON.stringify(r.profile));
  console.log(`  CPU per frame (all frames incl. warm-up, ms): renderer ${perFrame('renderer').toFixed(2)}  gpu/raster ${perFrame('gpu').toFixed(2)}  browser ${perFrame('browser').toFixed(2)}`);
  console.log(`  peak flame tiles ${r.flamesPeak}, peak particles ${r.particlesMax}`);
} finally {
  await browser.close();
  server.close();
}
