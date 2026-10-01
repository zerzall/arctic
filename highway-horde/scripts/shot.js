#!/usr/bin/env node
// Screenshots of the first-person sandbox (public/dev/fps-sandbox.html) for reviewing art: serves
// public/ itself on a free port, opens the sandbox in headless Chromium, sets each view and saves a PNG.
//
//   node scripts/shot.js <out-dir> <sandbox query> <view> [<view> ...]
//   node scripts/shot.js shots "map=millroad&q=high&time=day&zombies=0" sec:jam sec:gasstation a:gas_tow
//   node scripts/shot.js shots "map=hospital&q=ultra" '{"x":2400,"y":900,"yaw":0,"pitch":-0.1}'
//
// A view is a named viewpoint of the sandbox (levels: sec:<id>, sec:<id>:b, a:<anchor>) or a JSON
// {x, y, yaw, pitch, z?}. The query always gets bots=0&fixed=1&paused=1&clean=1 unless it sets them.
// Files are named <map>-<view>.png. Console errors and warnings of the page are printed.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

const [outDir, query = '', ...views] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node scripts/shot.js <out-dir> <sandbox query> <view> [<view> ...]');
  process.exit(2);
}
const q = new URLSearchParams(query);
for (const [k, v] of [['bots', '0'], ['fixed', '1'], ['paused', '1'], ['clean', '1']]) if (!q.has(k)) q.set(k, v);
const mapId = q.get('map') || 'highway';

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
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
try {
  await page.goto(`http://127.0.0.1:${port}/dev/fps-sandbox.html?${q}`, { waitUntil: 'load' });
  // (software GL: a big level takes minutes to build and up to a minute a frame; SHOT_TIMEOUT in ms overrides)
  const limit = Number(process.env.SHOT_TIMEOUT || 600000);
  await page.waitForFunction(() => window.__fps && window.__fps.renderer, null, { timeout: limit });
  for (const v of views.length ? views : [null]) {
    const view = v && v.startsWith('{') ? JSON.parse(v) : v;
    if (view) await page.evaluate((x) => window.__fps.setView(x), view);
    await page.evaluate(() => window.__fps.step && window.__fps.step(3));
    await page.waitForTimeout(600);
    const name = `${mapId}-${(v ? (typeof view === 'string' ? view : `${Math.round(view.x)}_${Math.round(view.y)}`) : 'start').replace(/[^a-z0-9_-]+/gi, '_')}.png`;
    await page.screenshot({ path: join(outDir, name), timeout: limit });
    console.log('wrote', join(outDir, name));
  }
} finally {
  if (logs.length) console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
  server.close();
}
