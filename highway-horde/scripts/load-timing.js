#!/usr/bin/env node
// Load timings in headless Chromium: how long the game takes to show its title, to put the player
// into a first-person solo game, and to finish streaming its textures, for the served build
// (server/relay-server.js on a free port) and the one-file build (dist/Highway-Horde.html).
//
//   node scripts/load-timing.js                       served title + highway + sandstone, one-file title
//   node scripts/load-timing.js --only title,highway  a subset (title, highway, sandstone, onefile, onefile-game)
//   node scripts/load-timing.js --runs 3              repeat each and report the median
//   node scripts/load-timing.js --onefile path.html   another one-file build
//   node scripts/load-timing.js --warm                also time a second launch in the same profile (caches)
//   node scripts/load-timing.js --json out.json       also write the raw numbers
//   node scripts/load-timing.js --root ../old        serve another checkout of highway-horde/ (before / after)
//
// The games are played at quality 'ultra' (the default tier) with `?guntex=1`, so the gun textures
// load as they do on a real graphics card (a software rasterizer otherwise leaves them off).
// Columns: title = page load → title screen up; game = Start click → first-person game shown (the
// loading screen gone); tex = Start click → every texture set in (world library, zombies, guns);
// MB = bytes the page received; heap = JS heap in use at the end (MB).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const ONLY = (opt('--only', 'title,highway,sandstone,onefile') || '').split(',').filter(Boolean);
const RUNS = Number(opt('--runs', 1));
const ONEFILE = path.resolve(opt('--onefile', path.join(ROOT, 'dist', 'Highway-Horde.html')));
const WARM = flag('--warm');
const JSON_OUT = opt('--json', null);
const SERVE = path.resolve(opt('--root', ROOT));
const LIMIT = Number(process.env.TIMING_LIMIT || 300e3);
const PREFS_KEY = 'highway-horde:prefs:v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(SERVE, 'server/relay-server.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url + 'api/info'); if (r.ok) break; } catch { /* not yet */ }
    await sleep(100);
  }
  return { url, stop: () => child.kill('SIGTERM') };
}

async function newContext(browser, lobby) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript(({ key, lobby }) => {
    try {
      const p = JSON.parse(localStorage.getItem(key) || '{}') || {};
      p.name = p.name || 'Timer';
      p.seenHowTo = true;
      p.settings = { ...(p.settings || {}), view: 'fps', quality: 'ultra', qualityPicked: true };
      if (lobby) p.lobby = { ...(p.lobby || {}), ...lobby };
      localStorage.setItem(key, JSON.stringify(p));
    } catch { /* no storage */ }
  }, { key: PREFS_KEY, lobby });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  return ctx;
}

/** A page with byte counting and the console's errors collected. */
async function openPage(ctx) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  const m = { bytes: 0, errors: [] };
  cdp.on('Network.loadingFinished', (e) => { m.bytes += e.encodedDataLength || 0; });
  // (data: URLs and blob reads are not network traffic: the one-file build counts its file size)
  page.on('pageerror', (e) => m.errors.push(e.message));
  page.on('console', (c) => { if (c.type() === 'error') m.errors.push(c.text()); });
  const heap = async () => {
    const r = await cdp.send('Performance.getMetrics');
    const v = r.metrics.find((x) => x.name === 'JSHeapUsedSize');
    return v ? v.value / 1e6 : NaN;
  };
  return { page, m, heap };
}

const titleUp = () => !document.querySelector('#app').classList.contains('booting') && !document.querySelector('#screen-title').hidden;

async function timeTitle(browser, url, { warm = false } = {}) {
  const ctx = await newContext(browser);
  try {
    const { page, m, heap } = await openPage(ctx);
    let t0 = Date.now();
    await page.goto(url, { waitUntil: 'commit', timeout: LIMIT });
    await page.waitForFunction(titleUp, null, { timeout: LIMIT, polling: 50 });
    const out = { title: (Date.now() - t0) / 1000, mb: m.bytes / 1e6, heap: await heap(), errors: m.errors };
    if (warm) {
      m.bytes = 0;
      t0 = Date.now();
      await page.reload({ waitUntil: 'commit', timeout: LIMIT });
      await page.waitForFunction(titleUp, null, { timeout: LIMIT, polling: 50 });
      out.warmTitle = (Date.now() - t0) / 1000;
      out.warmMb = m.bytes / 1e6;
    }
    return out;
  } finally {
    await ctx.close();
  }
}

/** Title → Play Solo → Start → in game → every texture set loaded. */
async function timeGame(browser, url, lobby, { warm = false } = {}) {
  const ctx = await newContext(browser, lobby);
  try {
    const { page, m, heap } = await openPage(ctx);
    const one = async () => {
      m.bytes = 0;
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'commit', timeout: LIMIT });
      await page.waitForFunction(titleUp, null, { timeout: LIMIT, polling: 50 });
      const title = (Date.now() - t0) / 1000;
      await page.click('#btn-solo');
      await page.waitForFunction(() => !document.querySelector('#screen-lobby').hidden, null, { timeout: LIMIT });
      // (renderer3d loads in the background after the title: a real player takes a while to get here)
      await page.waitForFunction(() => !!window.__HH, null, { timeout: LIMIT });
      const t1 = Date.now();
      await page.evaluate(() => setTimeout(() => document.querySelector('#btn-start').click(), 0));
      let dbg = null;
      if (process.env.TIMING_DEBUG) {
        dbg = setInterval(() => page.evaluate(() => ({ game: !document.querySelector('#screen-game').hidden, loading: !document.getElementById('loading').hidden, text: document.querySelector('#loading .loading-task-text')?.textContent, look: window.__HH && window.__HH.getLook && window.__HH.getLook().ready, tex: window.__hhTexLoad && window.__hhTexLoad() }))
          .then((s) => console.log('  ', ((Date.now() - t1) / 1000).toFixed(1), JSON.stringify(s))).catch(() => {}), 5000);
      }
      await page.waitForFunction(() => {
        const L = document.getElementById('loading');
        const H = window.__HH;
        return !document.querySelector('#screen-game').hidden && (!L || L.hidden) && H && H.getLook && H.getLook().ready;
      }, null, { timeout: LIMIT, polling: 50 });
      const game = (Date.now() - t1) / 1000;
      if (process.env.TIMING_DEBUG) console.log('  in game after', game, 's');
      await page.waitForFunction(() => {
        const s = window.__hhTexLoad ? window.__hhTexLoad() : null;
        return s && s.done;
      }, null, { timeout: LIMIT, polling: 100 });
      const tex = (Date.now() - t1) / 1000;
      if (dbg) clearInterval(dbg);
      const state = await page.evaluate(() => window.__hhTexLoad());
      return { title, game, tex, state, mb: m.bytes / 1e6, heap: await heap() };
    };
    const out = await one();
    out.errors = m.errors;
    if (warm) {
      const w = await one();
      out.warmTitle = w.title; out.warmGame = w.game; out.warmTex = w.tex; out.warmMb = w.mb;
    }
    return out;
  } finally {
    await ctx.close();
  }
}

const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : NaN; };
function combine(rows) {
  const out = { ...rows[rows.length - 1] };
  for (const k of ['title', 'game', 'tex', 'mb', 'heap', 'warmTitle', 'warmGame', 'warmTex', 'warmMb']) {
    if (rows.some((r) => r[k] !== undefined)) out[k] = median(rows.map((r) => r[k]));
  }
  return out;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--js-flags=--max-old-space-size=8192'],
});
const server = await startServer();
const results = {};
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
try {
  const jobs = [];
  if (ONLY.includes('title')) jobs.push(['served title', () => timeTitle(browser, server.url, { warm: WARM })]);
  if (ONLY.includes('highway')) jobs.push(['served highway', () => timeGame(browser, server.url + '?guntex=1', { mapId: 'highway', mode: 'defend', time: 'night' }, { warm: WARM })]);
  if (ONLY.includes('sandstone')) jobs.push(['served sandstone', () => timeGame(browser, server.url + '?guntex=1', { mapId: 'sandstone', mode: 'horde', time: 'day' }, { warm: WARM })]);
  if (ONLY.includes('onefile')) {
    if (!fs.existsSync(ONEFILE)) console.log(`(no one-file build at ${ONEFILE}: npm run standalone)`);
    else jobs.push(['one-file title', async () => ({ ...(await timeTitle(browser, pathToFileURL(ONEFILE).href, { warm: WARM })), mb: fs.statSync(ONEFILE).size / 1e6 })]);
  }
  if (ONLY.includes('onefile-game') && fs.existsSync(ONEFILE)) {
    jobs.push(['one-file highway', async () => ({ ...(await timeGame(browser, pathToFileURL(ONEFILE).href + '?guntex=1', { mapId: 'highway', mode: 'defend', time: 'night' }, { warm: WARM })), mb: fs.statSync(ONEFILE).size / 1e6 })]);
  }
  for (const [name, run] of jobs) {
    const rows = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        rows.push(await run());
      } catch (err) {
        console.log(`${name}: ${String(err.message || err).split('\n')[0]}`);
      }
    }
    if (!rows.length) continue;
    const r = combine(rows);
    results[name] = r;
    let line = `${name.padEnd(18)} title ${f(r.title)} s`;
    if (r.game !== undefined) line += ` · game ${f(r.game)} s · tex ${f(r.tex)} s`;
    line += ` · ${f(r.mb, 0)} MB · heap ${f(r.heap, 0)} MB`;
    if (r.warmTitle !== undefined) line += ` · warm: title ${f(r.warmTitle)} s${r.warmGame !== undefined ? `, game ${f(r.warmGame)} s, tex ${f(r.warmTex)} s` : ''}, ${f(r.warmMb, 0)} MB`;
    console.log(line);
    if (r.state) console.log(`${''.padEnd(18)} ${JSON.stringify(r.state)}`);
    if (r.errors && r.errors.length) console.log(`${''.padEnd(18)} errors: ${r.errors.slice(0, 5).join(' | ')}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
