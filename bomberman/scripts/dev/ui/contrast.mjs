// Text contrast audit (developer tooling, not part of the game).
//
//   node scripts/dev/ui/contrast.mjs [--only a,b] [--viewport 390x844]
//
// SPEC 8.3 asks for a contrast of at least 4.5:1 for body text and 3:1 for large text. Gradients, translucent panels and sprites
// make that impossible to compute from CSS alone, so this measures what is really on screen: for every scene it lists the visible
// text elements, hides all text, takes a screenshot, and compares each element's text colour with the pixels that were behind it
// (worst of a grid of samples). Inactive things (dimmed away players, disabled buttons, decorative logo) are skipped.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../../specs/helpers/pw.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const MOUNTS = [['/__ui/', here], ['/shared/', path.join(repo, 'shared')], ['/', path.join(repo, 'client')]];

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const only = opt('only', '') ? opt('only').split(',') : null;
const [width, height] = opt('viewport', '390x844').split('x').map(Number);

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const [prefix, dir] = MOUNTS.find(([p]) => pathname.startsWith(p));
  try {
    const body = await fs.readFile(path.join(dir, pathname.slice(prefix.length)));
    res.writeHead(200, { 'content-type': MIME[path.extname(pathname)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const { browser, reason } = await launchChromium();
if (!browser) {
  console.log(`SKIP: ${reason}`);
  server.close();
  process.exit(0);
}

let failures = 0;
try {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 900, hasTouch: width < 900, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/__ui/gallery.html`);
  await page.waitForFunction(() => document.documentElement.dataset.galleryReady === '1');
  const names = (await page.evaluate(() => window.gallery.names)).filter((n) => !only || only.includes(n));

  for (const name of names) {
    await page.evaluate((n) => window.gallery.show(n), name);
    // 1. The lines of text on screen with their colours: only text that is really on top (not under a dialog, the sticky bar or a
    //    toast) counts, and only the pixels of the glyph boxes themselves are sampled. Inactive things are left out.
    await page.addStyleTag({ content: '.roundend, .hud-layer, .hud-top, .hud-strip, .hud-feed { pointer-events: auto !important; }' });   // click-through overlays must still count as covering text
    const items = await page.evaluate(() => {
      const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
      const out = [];
      for (const n of document.querySelectorAll('body *')) {
        if (n.closest('.sr-only, svg, canvas, .confetti, .logo, .backdrop, [aria-disabled="true"], .is-disabled, .is-away, [data-state="out"], .player-empty, .hud-count, .hud-banner, #bp-debug')) continue;
        let opacity = 1;
        let hidden = false;
        for (let e = n; e; e = e.parentElement) {
          const st = getComputedStyle(e);
          opacity *= Number(st.opacity);
          if (st.display === 'none' || st.visibility === 'hidden') hidden = true;
        }
        if (hidden || opacity < 0.95) continue;   // faded in/out or deliberately dimmed
        const s = getComputedStyle(n);
        if (s.color === 'rgba(0, 0, 0, 0)') continue;
        const points = [];
        for (const t of [...n.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim())) {
          const range = document.createRange();
          range.selectNodeContents(t);
          for (const r of range.getClientRects()) {
            if (r.width < 2 || r.height < 2) continue;
            for (let iy = 0; iy < 2; iy++) {
              for (let ix = 0; ix < 8; ix++) {
                const x = r.left + ((ix + 0.5) / 8) * r.width;
                const y = r.top + ((iy + 0.5) / 2) * r.height;
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
                const top = document.elementFromPoint(x, y);
                if (top && n.contains(top)) points.push({ x: Math.round(x), y: Math.round(y) });
              }
            }
          }
        }
        if (points.length < 4) continue;
        out.push({ label: `${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/)[0]}` : ''} "${n.textContent.trim().slice(0, 22)}"`, points, fg: parse(s.color), size: parseFloat(s.fontSize), weight: Number(s.fontWeight) });
      }
      return out;
    });
    // 2. The same screen without any text: the pixels that were behind it.
    await page.addStyleTag({ content: '.confetti { display: none !important; } *, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' });
    await page.waitForTimeout(150);
    const shot = (await page.screenshot()).toString('base64');
    const worst = await page.evaluate(async ({ shot, items }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const lum = ({ r, g: gg, b }) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
      return items.map((it) => {
        let min = Infinity;
        for (const { x, y } of it.points) {
          const [r, gg, b] = g.getImageData(x, y, 1, 1).data;
          const fg = { r: it.fg.r * it.fg.a + r * (1 - it.fg.a), g: it.fg.g * it.fg.a + gg * (1 - it.fg.a), b: it.fg.b * it.fg.a + b * (1 - it.fg.a) };
          const l1 = lum(fg);
          const l2 = lum({ r, g: gg, b });
          min = Math.min(min, (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
        }
        return { label: it.label, size: it.size, weight: it.weight, ratio: min, fg: `rgb(${Math.round(it.fg.r)},${Math.round(it.fg.g)},${Math.round(it.fg.b)})` };
      });
    }, { shot, items });
    const bad = worst.filter((w) => {
      const large = w.size >= 24 || (w.size >= 18.66 && w.weight >= 700);
      return w.ratio < (large ? 3 : 4.5);
    });
    failures += bad.length;
    console.log(`${bad.length ? 'LOW ' : 'ok  '} ${name} ${width}x${height} (${worst.length} texts, lowest ${Math.min(...worst.map((w) => w.ratio)).toFixed(2)}:1)`);
    for (const b of bad) console.log(`     ${b.ratio.toFixed(2)}:1  ${b.label}  ${b.size}px/${b.weight}  text ${b.fg}`);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.galleryReady === '1');
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `${failures} text(s) below the required contrast` : 'all measured text meets the contrast requirement');
process.exit(failures ? 1 : 0);
