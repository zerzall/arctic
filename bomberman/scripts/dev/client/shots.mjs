// Screenshots and scripted touches of the input harness in real Chromium (developer tooling):
//   node scripts/dev/client/shots.mjs [outDir]        (default: <tmpdir>/bp-input-shots)
// Prints what the joystick and the buttons did for real touch events (via CDP, so multi-touch is real) and writes PNGs to look at.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './serve.mjs';

const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const out = process.argv[2] ?? join(tmpdir(), 'bp-input-shots');
mkdirSync(out, { recursive: true });

const SCREENS = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-portrait-small', width: 320, height: 568 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'phone-landscape-small', width: 568, height: 320 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
];

const { server, url } = await serve();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  for (const s of SCREENS) {
    for (const hand of ['right', 'left']) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
      page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
      await page.goto(`${url}/harness.html?hand=${hand}`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${s.name}-${hand}-idle.png` });

      const cdp = await ctx.newCDPSession(page);
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
      const zone = await page.evaluate(() => { const r = document.querySelector('.bp-zone').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
      const sx = zone.l + zone.w * 0.5;
      const sy = zone.t + zone.h * 0.6;
      await touch('touchStart', [[sx, sy, 1]]);
      await touch('touchMove', [[sx + 40, sy - 6, 1]]);
      await page.waitForTimeout(80);
      const right = await page.evaluate(() => window.__input.getIntent().d);
      await touch('touchMove', [[sx + 40, sy - 60, 1]]);
      await page.waitForTimeout(80);
      const up = await page.evaluate(() => window.__input.getIntent().d);
      await page.screenshot({ path: `${out}/${s.name}-${hand}-stick.png` });
      const bomb = await page.evaluate(() => { const r = document.querySelector('.bp-bomb').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await touch('touchStart', [[sx + 40, sy - 60, 1], [bomb[0], bomb[1], 2]]);
      await page.waitForTimeout(80);
      await page.screenshot({ path: `${out}/${s.name}-${hand}-stick-and-bomb.png` });
      const withBomb = await page.evaluate(() => ({ d: window.__input.getIntent().d, seen: { ...window.__seen } }));
      await touch('touchEnd', [[bomb[0], bomb[1], 2]]);
      await touch('touchEnd', []);
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => window.__input.getIntent().d);
      const geometry = await page.evaluate(() => {
        const r = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
        const c = document.getElementById('arena').getBoundingClientRect();
        const w = Math.min(c.width, c.height * 15 / 13);
        const left = c.left + (c.width - w) / 2;
        return { layout: document.querySelector('.bp-touch').dataset.layout, zone: r('.bp-zone'), bomb: r('.bp-bomb'), special: r('.bp-special'), emote: r('.bp-emote'), band: [Math.round(left + w * 0.2), Math.round(left + w * 0.8)] };
      });
      console.log(s.name, hand, JSON.stringify({ right, up, withBombD: withBomb.d, bombs: withBomb.seen.bombs, after, geometry }));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
