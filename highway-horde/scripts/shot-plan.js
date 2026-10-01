#!/usr/bin/env node
// Scripted screenshots of the first-person sandbox (a sibling of scripts/shot.js for reviews that
// need the game to do something between shots: open a gate, cut the lights, step a few frames).
//
//   node scripts/shot-plan.js <out-dir> <sandbox query> '<plan JSON>'
//
// The plan is a list of steps, each one of:
//   { "view": "<name>" | { x, y, yaw, pitch } }     set the camera
//   { "gate": "<id>", "open": true }                  open (or shut) a gate of the level now
//   { "lights": "<section>", "on": false }            cut (or restore) a section's lights
//   { "step": <frames>, "dt": <s> }                   advance that many frames (of dt seconds, 1/60 by default)
//   { "shot": "<name>" }                              save <out-dir>/<map>-<name>.png
// The query always gets bots=0&fixed=1&paused=1&clean=1 unless it sets them.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const [outDir, query = '', planJson = '[]'] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node scripts/shot-plan.js <out-dir> <sandbox query> <plan JSON>');
  process.exit(2);
}
const plan = JSON.parse(planJson);
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
  await page.waitForFunction(() => window.__fps && window.__fps.renderer, null, { timeout: 180000 });
  for (const s of plan) {
    if (s.view !== undefined) await page.evaluate((v) => window.__fps.setView(v), s.view);
    if (s.gate !== undefined) console.log('gate', s.gate, await page.evaluate(([id, open]) => window.__fps.gate(id, open), [s.gate, s.open !== false]));
    if (s.lights !== undefined) await page.evaluate(([sec, on]) => window.__fps.lights(sec, on), [s.lights, !!s.on]);
    if (s.step) await page.evaluate(([n, dt]) => window.__fps.step(n, dt), [s.step, s.dt || 1 / 60]);
    if (s.shot) {
      await page.evaluate(() => window.__fps.step(1));
      await page.waitForTimeout(300);
      const name = `${mapId}-${s.shot.replace(/[^a-z0-9_-]+/gi, '_')}.png`;
      // (software GL on a busy machine: a 720p frame can take minutes)
      await page.screenshot({ path: join(outDir, name), timeout: Number(process.env.SHOT_TIMEOUT || 400000) });
      console.log('wrote', join(outDir, name));
    }
  }
  const st = await page.evaluate(() => { const s = window.__fps.stats(); return { draw: s.drawCalls, tris: s.triangles, world: s.world && s.world.buildMs }; });
  console.log('stats', JSON.stringify(st));
} finally {
  if (logs.length) console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
  server.close();
}
