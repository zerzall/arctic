// LIVE renderer harness runner (developer tooling, not part of the game).
//
//   node scripts/dev/render/live.mjs [--size 1080p] [--seconds 30] [--shots 6] [--theme meadow] [--n 6] [--seed 7] [--out DIR]
//                                    [--perf] [--frames 300] [--throttle 4] [--strip death|boom|... [--skip N]] [--set key=value ...]
//
// Plays a Practice match through the REAL pipeline (Room + autopilot bots -> ClientGame -> Renderer, see live.js) in headless Chromium.
// Default: runs `seconds` of virtual time, writes `shots` evenly spaced pictures and reports renderer errors and stats.
// With --perf it measures the frame cost of the whole client loop under requestAnimationFrame (optionally CPU-throttled through CDP).
// With --strip CODE it plays until the first event with that code (--skip N: the N+1th) and films the place it happened, frame by frame.
// Output goes to --out, else $RENDER_OUT, else <tmpdir>/blast-party-render.
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, SIZES } from './shots.mjs';

const require = createRequire('/opt/node22/lib/node_modules/');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
const { chromium } = require('playwright');

const parseValue = (v) => (v === 'true' ? true : v === 'false' ? false : v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v);

function parseArgs(argv) {
  const opts = { size: '1080p', seconds: 30, shots: 6, out: process.env.RENDER_OUT ?? path.join(os.tmpdir(), 'blast-party-render'), perf: false, frames: 300, throttle: 1, strip: '', skip: 0, set: {} };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'perf') { opts.perf = true; continue; }
    const val = argv[++i];
    if (key === 'set') { const [k, ...rest] = val.split('='); opts.set[k] = parseValue(rest.join('=')); } else if (key in opts) opts[key] = typeof opts[key] === 'number' ? Number(val) : val;
    else opts.set[key] = parseValue(val);
  }
  return opts;
}

function parseSize(name) {
  if (SIZES[name]) return SIZES[name];
  const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(name);
  if (!m) throw new Error(`unknown size ${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
}

const opts = parseArgs(process.argv.slice(2));
await fs.mkdir(opts.out, { recursive: true });
const server = await serve();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser ${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[browser pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/__render/live.html`);
  await page.waitForFunction(() => window.liveReady, null, { timeout: 15000 });
  if (opts.throttle > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
  const [w, h, dpr] = parseSize(opts.size);
  const start = await page.evaluate((o) => window.live.start(o), { css: [w, h], dpr, ...opts.set });
  console.log(`started: tile ${start.tile}px, theme ${start.theme}, errors ${start.errors.length}`);
  if (opts.strip) {
    const data = await page.evaluate((o) => window.live.strip(o), { until: opts.strip, skip: opts.skip, size: [4, 4], frames: 10, every: 4 });
    if (!data) throw new Error(`no ${opts.strip} event within 20000 frames`);
    const file = path.join(opts.out, `strip-${opts.strip}${opts.skip || ''}-${opts.set.theme ?? 'meadow'}-${opts.size}.png`);
    await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`wrote ${file}`);
  } else if (opts.perf) {
    const r = await page.evaluate((o) => window.live.perf(o), { frames: opts.frames });
    const f = (s) => `mean ${s.mean.toFixed(2)}  p50 ${s.p50.toFixed(2)}  p95 ${s.p95.toFixed(2)}  max ${s.max.toFixed(2)} ms`;
    console.log(`${opts.size} throttle ${opts.throttle}x`);
    console.log(`  whole client loop ${f(r.total)}`);
    console.log(`  frame interval    ${f(r.interval)}`);
    console.log(`  peak flame tiles ${r.flamesPeak}, peak particles ${r.particlesMax}, renderer errors ${r.info.errors.length}`);
  } else {
    const frames = Math.round(opts.seconds * 60), every = Math.max(1, Math.floor(frames / opts.shots));
    let info;
    for (let f = 0; f < frames; f += every) {
      info = await page.evaluate((n) => window.live.run(n), every);
      const data = await page.evaluate(() => window.live.shot());
      const file = path.join(opts.out, `live-${String(Math.round(f / 60)).padStart(3, '0')}s-${opts.set.theme ?? 'meadow'}-${opts.size}.png`);
      await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
      console.log(`wrote ${file}  (round ${info.rounds}, tick ${info.tick}, particles ${info.stats.particles}, render ${info.stats.renderMs.toFixed(2)} ms)`);
    }
    console.log(`errors: ${JSON.stringify(info.errors)}`);
  }
} finally {
  await browser.close();
  server.close();
}
