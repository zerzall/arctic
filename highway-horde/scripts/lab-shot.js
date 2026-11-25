#!/usr/bin/env node
// Screenshots of the gun materials lab (public/dev/guns-lab.html) for reviewing gun models: serves
// public/ itself on a free port, opens the lab in headless Chromium once per query and saves a PNG.
//
//   node scripts/lab-shot.js <out-dir> <lab query> [<lab query> ...]
//   node scripts/lab-shot.js shots "guns=ak,m4,scout&light=day&q=high" "guns=all&cols=6&clean=1"
//
// Files are named lab-<n>.png in query order, or after a `name=` in the query. W / H set the
// viewport (default 1600 x 900). Console errors and warnings of the page are printed.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const [outDir, ...queries] = process.argv.slice(2);
if (!outDir || !queries.length) {
  console.error('usage: node scripts/lab-shot.js <out-dir> <lab query> [<lab query> ...]');
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
  for (const query of queries) {
    const q = new URLSearchParams(query);
    if (!q.has('clean')) q.set('clean', '1');
    const name = q.get('name') || `lab-${++n}`;
    const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1600), height: Number(process.env.H || 900) } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/dev/guns-lab.html?${q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__lab && window.__lab.ready, null, { timeout: Number(process.env.SHOT_TIMEOUT || 300000) });
    await page.waitForTimeout(300);
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
