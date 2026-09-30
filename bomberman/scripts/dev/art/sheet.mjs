// Art contact-sheet renderer (developer tooling, not part of the game).
//
//   node scripts/dev/art/sheet.mjs [--out DIR] [--only a,b] [--themes meadow,lava] [--tile 64] [--dpr 1] [--crop x,y,w,h]
//
// Output goes to --out, else $ART_OUT, else <tmpdir>/blast-party-art. Sheets (see sheets.js): arena (every theme as a mock
// board), open, chars-walk, chars-states, zoom, walkstrip, props, pops, icons, themes, sizes. --crop cuts a region out of
// each sheet at full resolution, e.g. `--only arena --themes lava --tile 96 --crop 100,100,900,700`.
//
// Serves the repo over a tiny static server, opens scripts/dev/art/sheet.html in headless
// Chromium (Playwright), lets sheets.js draw every contact sheet into a canvas and writes each one
// as a PNG. Look at the PNGs (Read tool / image viewer); iterate on client/js/sprites.js until the
// art is right. Also prints the sprite-set build time and canvas memory of the arena sheets.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8' };
// URL prefix -> directory. sheet.html and sheets.js live next to this file; the game code is served exactly as in production.
const MOUNTS = [['/__art/', here], ['/js/', path.join(repo, 'client/js')], ['/shared/', path.join(repo, 'shared')]];

function parseArgs(argv) {
  const opts = { crop: null, out: process.env.ART_OUT ?? path.join(os.tmpdir(), 'blast-party-art'), only: null, themes: null, tile: 64, dpr: 1 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, ''), val = argv[i + 1];
    if (key === 'only' || key === 'themes') opts[key] = val.split(',');
    else if (key === 'tile' || key === 'dpr') opts[key] = Number(val);
    else if (key === 'out') opts.out = val;
    else if (key === 'crop') opts.crop = val.split(',').map(Number);
    else throw new Error(`unknown option --${key}`);
  }
  return opts;
}

function serve() {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const mount = MOUNTS.find(([prefix]) => pathname.startsWith(prefix));
    const file = mount && path.join(mount[1], pathname.slice(mount[0].length));
    try {
      if (!file || !file.startsWith(mount[1] + path.sep)) throw new Error('outside mounts');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const opts = parseArgs(process.argv.slice(2));
await fs.mkdir(opts.out, { recursive: true });
const server = await serve();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser ${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[browser pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/__art/sheet.html`);
  await page.waitForFunction(() => window.artSheets);
  const names = await page.evaluate(() => window.artSheets.names);
  for (const name of names) {
    if (opts.only && !opts.only.includes(name)) continue;
    const result = await page.evaluate(([n, p]) => window.artSheets.render(n, p), [name, { tile: opts.tile, dpr: opts.dpr, themes: opts.themes, crop: opts.crop }]);
    for (const shot of result.shots) {
      const file = path.join(opts.out, `${shot.name}.png`);
      await fs.writeFile(file, Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
      console.log(`wrote ${file}`);
    }
    if (result.info) console.log(`  ${name}: ${result.info}`);
  }
} finally {
  await browser.close();
  server.close();
}
