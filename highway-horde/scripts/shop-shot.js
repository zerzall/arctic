#!/usr/bin/env node
// Screenshots of the buy menu: serves public/ itself on a free port, opens the buy menu lab
// (public/dev/shop-lab.html: the real menu, a made-up player between waves), presses the
// given keys and saves a PNG per view.
//
//   node scripts/shop-shot.js <out-dir> "<view>" ["<view>" ...]
//   node scripts/shop-shot.js shots "name=rifles&keys=KeyB,Digit4" "name=phone&keys=KeyB,Digit3&w=390&h=844&touch=1"
//
// A view: name= (file name), keys= (comma-separated KeyboardEvent codes, pressed in order),
// w= / h= (viewport, default 1600 x 900), touch=1 (the touch layout), wave= / cash= / sec=
// (passed to the lab). Console errors of the page are printed.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

const [outDir, ...views] = process.argv.slice(2);
if (!outDir || !views.length) {
  console.error('usage: node scripts/shop-shot.js <out-dir> "<view>" ["<view>" ...]');
  process.exit(2);
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const logs = [];
try {
  let n = 0;
  for (const v of views) {
    const q = new URLSearchParams(v);
    const name = q.get('name') || `shop-${++n}`;
    const touch = q.get('touch') === '1';
    const page = await browser.newPage({ viewport: { width: Number(q.get('w') || 1600), height: Number(q.get('h') || 900) }, hasTouch: touch, isMobile: touch });
    page.on('console', (m) => { if (m.type() === 'error') logs.push(`${name} error: ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`${name} pageerror: ${e.message}`));
    const lab = new URLSearchParams();
    for (const k of ['wave', 'cash', 'sec', 'touch']) if (q.has(k)) lab.set(k, q.get(k));
    await page.goto(`http://127.0.0.1:${port}/dev/shop-lab.html?${lab}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 120000 });
    await page.waitForTimeout(800);
    for (const key of (q.get('keys') || '').split(',').filter(Boolean)) {
      if (key.startsWith('tap:')) await page.tap(key.slice(4));
      else await page.keyboard.press(key);
      await page.waitForTimeout(350);
    }
    // the gun pictures are drawn from the 3D models once three.js has loaded
    await page.waitForTimeout(Number(q.get('wait') || 4000));
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
    await page.close();
  }
} finally {
  if (logs.length) console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
  server.close();
}
