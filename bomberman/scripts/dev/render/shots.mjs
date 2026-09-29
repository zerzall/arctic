// Renderer contact-sheet tool (developer tooling, not part of the game).
//
//   node scripts/dev/render/shots.mjs [--out DIR] [--scenes battle,start,chain,blocks,...] [--themes meadow,lava] [--sizes 1080p,phone] [--seed 7] [--set key=value ...]
//
// Serves the repo, opens scripts/dev/render/harness.html in headless Chromium (Playwright), lets the harness drive a real World through the
// real Renderer and writes one PNG per shot. LOOK at them (Read tool / image viewer) and iterate on client/js/render.js.
//   --scenes   names from harness.js `scenes` (default battle); "list" prints them.
//   --sizes    presets below, or WxH@dpr (e.g. 800x600@1).
//   --set      extra scene options as JSON-ish key=value, e.g. --set n=4 --set mode=teams --set quality=1 --set reduced=true
// Output goes to --out, else $RENDER_OUT, else <tmpdir>/blast-party-render.
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
const MOUNTS = [['/__render/', here], ['/js/', path.join(repo, 'client/js')], ['/shared/', path.join(repo, 'shared')]];

/** Preset container sizes: css width x height and the (already capped) device pixel ratio main.js would pass. */
export const SIZES = {
  '1080p': [1920, 1080, 1],
  desk: [1280, 800, 1],
  phone: [390, 844, 2],
  small: [360, 640, 2],
  phoneL: [844, 390, 2],
  ipad: [1024, 768, 2],
  square: [800, 800, 1],
  tv4k: [3840, 2160, 1],
};

export function serve() {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const mount = MOUNTS.find(([prefix]) => pathname.startsWith(prefix));
    const file = mount && path.join(mount[1], pathname.slice(mount[0].length));
    try {
      if (pathname === '/') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(await fs.readFile(path.join(here, 'harness.html'))); return; }
      if (!file || !file.startsWith(mount[1] + path.sep)) throw new Error('outside mounts');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function parseSize(name) {
  if (SIZES[name]) return SIZES[name];
  const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(name);
  if (!m) throw new Error(`unknown size ${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
}

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
}

function parseArgs(argv) {
  const opts = { out: process.env.RENDER_OUT ?? path.join(os.tmpdir(), 'blast-party-render'), scenes: ['battle'], themes: ['meadow'], sizes: ['desk'], seed: 7, set: {} };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, ''), val = argv[i + 1];
    if (key === 'scenes' || key === 'themes' || key === 'sizes') opts[key] = val.split(',');
    else if (key === 'out') opts.out = val;
    else if (key === 'seed') opts.seed = Number(val);
    else if (key === 'set') { const [k, ...rest] = val.split('='); opts.set[k] = parseValue(rest.join('=')); }
    else throw new Error(`unknown option --${key}`);
  }
  return opts;
}

export async function openHarness(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser ${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[browser pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.harnessReady, null, { timeout: 15000 });
  return page;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2));
  await fs.mkdir(opts.out, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await openHarness(browser, server.address().port);
    if (opts.scenes[0] === 'list') { console.log(await page.evaluate(() => window.harness.scenes())); process.exit(0); }
    for (const scene of opts.scenes) {
      for (const theme of opts.themes) {
        for (const sizeName of opts.sizes) {
          const [w, h, dpr] = parseSize(sizeName);
          const params = { theme, seed: opts.seed, css: [w, h], dpr, ...opts.set };
          const result = await page.evaluate(([s, p]) => window.harness.scene(s, p), [scene, params]);
          if (result.info) console.log(`  ${scene}: ${result.info}`);
          for (const shot of result.shots) {
            const file = path.join(opts.out, `${shot.name}-${theme}-${sizeName}.png`);
            await fs.writeFile(file, Buffer.from(shot.data.split(',')[1], 'base64'));
            console.log(`wrote ${file}`);
          }
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}
