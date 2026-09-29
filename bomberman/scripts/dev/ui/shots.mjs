// UI screenshot rig (developer tooling, not part of the game).
//
//   node scripts/dev/ui/shots.mjs [--out DIR] [--only a,b] [--viewports 390x844,844x390,1280x720,1920x1080] [--nosprites] [--reduced] [--quiet]
//
// Serves client/, shared/ and scripts/dev/ui/ over a tiny static server, opens gallery.html in headless Chromium, and for every
// scene of gallery.js and every viewport writes <scene>-<W>x<H>.png. It also runs the gallery's layout lint (horizontal
// overflow, clipped text, tap targets under 48 px, HUD pieces overlapping each other or the play field) and prints the findings.
// Phones (390x844, 844x390) are emulated with touch and a device scale factor of 2, so the touch layout of the game screen applies.
// Look at the PNGs (Read tool / image viewer); iterate on client/css/style.css and client/js/ui.js until they are right.
//
// Output goes to --out, else $UI_SHOTS_OUT, else <tmpdir>/blast-party-ui. Exit code 1 when the lint found problems (with --strict).

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../../specs/helpers/pw.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
// URL prefix -> directory, first match wins; everything else is client/, exactly like the production server.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob: data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";   // SPEC 7, verbatim: the UI must run under it
const MOUNTS = [['/__ui/', here], ['/shared/', path.join(repo, 'shared')], ['/', path.join(repo, 'client')]];

function parseArgs(argv) {
  const opts = { out: process.env.UI_SHOTS_OUT ?? path.join(os.tmpdir(), 'blast-party-ui'), only: null, viewports: ['390x844', '844x390', '1280x720', '1920x1080'], nosprites: false, quiet: false, strict: false, reduced: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'nosprites' || key === 'quiet' || key === 'strict' || key === 'reduced') opts[key] = true;
    else if (key === 'out') opts.out = argv[++i];
    else if (key === 'only') opts.only = argv[++i].split(',');
    else if (key === 'viewports') opts.viewports = argv[++i].split(',');
    else throw new Error(`unknown option --${key}`);
  }
  return opts;
}

function serve() {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [prefix, dir] = MOUNTS.find(([p]) => pathname.startsWith(p));
    const file = path.join(dir, pathname.slice(prefix.length));
    try {
      if (!file.startsWith(dir)) throw new Error('outside mounts');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP });
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
const { browser, reason } = await launchChromium();
if (!browser) {
  console.log(`SKIP: ${reason}`);
  server.close();
  process.exit(0);
}

let problems = 0;
try {
  for (const vp of opts.viewports) {
    const [width, height] = vp.split('x').map(Number);
    const phone = width <= 900;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: phone ? 2 : 1,
      isMobile: phone,
      hasTouch: phone,
      reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser ${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => { problems++; console.log(`[browser pageerror] ${e.message}`); });
    if (opts.nosprites) await page.route('**/js/sprites.js', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/__ui/gallery.html${opts.nosprites ? '?nosprites' : ''}`);
    await page.waitForFunction(() => document.documentElement.dataset.galleryReady === '1');
    const names = await page.evaluate(() => window.gallery.names);
    for (const name of names) {
      if (opts.only && !opts.only.includes(name)) continue;
      await page.evaluate((n) => window.gallery.show(n), name);
      const issues = await page.evaluate(() => window.gallery.lint());
      const file = path.join(opts.out, `${name}${opts.nosprites ? '-nosprites' : ''}${opts.reduced ? '-reduced' : ''}-${vp}.png`);
      await page.screenshot({ path: file });
      // Long screens (lobby, results, modals): also capture what is below the fold, a page at a time.
      const pages = await page.evaluate(() => {
        const scroller = document.querySelector('.modal-body') ?? [...document.querySelectorAll('.screen')].find((s) => !s.hidden && s.id !== 'game');
        return scroller ? Math.min(4, Math.ceil(scroller.scrollHeight / scroller.clientHeight - 0.05)) : 1;
      });
      for (let p = 1; p < pages; p++) {
        await page.evaluate((n) => {
          const scroller = document.querySelector('.modal-body') ?? [...document.querySelectorAll('.screen')].find((s) => !s.hidden);
          scroller.scrollTo(0, n * scroller.clientHeight * 0.85);
        }, p);
        await page.waitForTimeout(150);
        await page.screenshot({ path: file.replace(/\.png$/, `-p${p + 1}.png`) });
      }
      problems += issues.length;
      if (!opts.quiet) console.log(`${issues.length ? 'LINT' : 'ok  '} ${name} ${vp}${issues.length ? `\n  - ${issues.slice(0, 12).join('\n  - ')}${issues.length > 12 ? `\n  ... ${issues.length - 12} more` : ''}` : ''}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`screenshots in ${opts.out}; ${problems} lint finding(s)`);
if (opts.strict && problems) process.exit(1);
