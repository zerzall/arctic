#!/usr/bin/env node
// Screenshots of the UX pass (title, loading bar, lobby descriptions, How to Play tabs, a hint, the gadget
// picker, the phone HUD, the graphics badges) into docs/shots/ux/. Starts the relay server (static files)
// on a free port and drives headless Chromium: `node scripts/ux-shots.js`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'shots', 'ux');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const server = spawn(process.execPath, [path.join(ROOT, 'server/relay-server.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(1200);
const url = `http://localhost:${port}/`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });

async function newPage(viewport, extra = {}, prefs = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.addInitScript((p) => {
    try {
      const key = 'highway-horde:prefs:v1';
      const cur = JSON.parse(localStorage.getItem(key) || '{}') || {};
      cur.settings = { ...(cur.settings || {}), view: 'topdown', ...p.settings };
      cur.seenHowTo = true;
      if (p.name) cur.name = p.name;
      localStorage.setItem(key, JSON.stringify(cur));
    } catch {
      // no storage on about:blank
    }
  }, { settings: prefs.settings || {}, name: prefs.name || 'Rook' });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(url);
  await page.waitForSelector('#screen-title:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
  return { ctx, page };
}

const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), ...opts });

try {
  // ---- title, lobby, loading bar, How to Play, graphics badges (desktop)
  {
    const { ctx, page } = await newPage({ width: 1280, height: 720 });
    await sleep(600);
    await shot(page, 'title.png');

    // How to Play tabs
    await page.click('#btn-howto');
    await page.waitForSelector('#dlg-howto:not([hidden])');
    for (const tab of ['modes', 'controls', 'classes', 'zombies']) {
      await page.click(`#howto-tab-${tab}`);
      await sleep(200);
      await shot(page, `howto-${tab}.png`);
    }
    await page.click('#dlg-howto [data-close]');

    // Settings → Graphics: Cinematic, 150% (MSAA 8x chosen, capped), Advanced open
    await page.click('#btn-settings');
    await page.waitForSelector('#dlg-settings:not([hidden])');
    await page.click('#set-quality [data-value="cinematic"]');
    await page.click('#set-adv-toggle');
    await page.click('#set-msaa [data-value="8"]');
    await page.click('#set-renderscale [data-value="1.5"]');
    await sleep(200);
    await page.locator('#set-pane-graphics').evaluate((el) => { el.scrollTop = 0; });
    await shot(page, 'graphics-badges-top.png');
    await page.locator('#set-msaa').scrollIntoViewIfNeeded();
    await sleep(150);
    await shot(page, 'graphics-badges-msaa.png');
    await page.click('#dlg-settings [data-close]');

    // lobby: the class and mode descriptions
    await page.click('#btn-solo');
    await page.waitForSelector('#screen-lobby:not([hidden])');
    await page.click('#opt-mode [data-value="zone"]').catch(() => {});
    await sleep(500);
    await page.locator('#screen-lobby').evaluate((el) => { el.scrollTop = 0; window.scrollTo(0, 0); });
    await shot(page, 'lobby.png');
    await page.locator('#opt-mode').scrollIntoViewIfNeeded();
    await sleep(200);
    await shot(page, 'lobby-mode.png');

    // the loading bar mid-way (the real module, driven by hand)
    await page.evaluate(async () => {
      const L = await import('/js/ui/loading.js');
      L.showLoading('Building the world…', 'Gas-N-Go', 'Stay near your teammates: downed players bleed out in 30 seconds.');
      L.setLoadStage('map', 1);
      L.setLoadStage('shaders', 0.5);
    });
    await sleep(400);
    await shot(page, 'loading-bar.png');
    await page.evaluate(async () => { (await import('/js/ui/loading.js')).hideLoading(); });
    await ctx.close();
  }

  // ---- in game (top-down, DOM HUD): the buy hint and the gadget picker
  {
    const { ctx, page } = await newPage({ width: 1280, height: 720 });
    await page.click('#btn-solo');
    await page.waitForSelector('#screen-lobby:not([hidden])');
    await page.click('#btn-start');
    await page.waitForFunction(() => !document.querySelector('#screen-game').hidden && window.__HH.getView() !== null, null, { timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.hud-tip[hidden]') && document.querySelector('.hud-tip'), null, { timeout: 20000 });
    await sleep(500);
    await shot(page, 'hint-buy.png');
    // hold G: the throwables picker opens
    await page.keyboard.down('KeyG');
    await sleep(450);
    await shot(page, 'gadget-picker.png');
    await page.keyboard.up('KeyG');
    await sleep(200);
    // the true pause note
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause:not([hidden])');
    await sleep(300);
    await shot(page, 'pause-solo.png');
    await ctx.close();
  }

  // ---- phone: gadget button and tray, situational buttons
  {
    const { ctx, page } = await newPage({ width: 844, height: 390 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await page.tap('#btn-solo');
    await page.waitForSelector('#screen-lobby:not([hidden])');
    await page.locator('#btn-start').scrollIntoViewIfNeeded();
    await page.tap('#btn-start');
    await page.waitForFunction(() => !document.querySelector('#screen-game').hidden && window.__HH.getView() !== null, null, { timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
    await sleep(1500);
    await shot(page, 'phone-hud.png');
    await page.tap('.touch-btn-gadget');
    await sleep(300);
    await shot(page, 'phone-gadget-tray.png');
    await ctx.close();
  }
  console.log(`ux-shots: written to ${path.relative(ROOT, OUT)}/`);
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
