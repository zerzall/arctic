// Contact-sheet maker (developer tooling, not part of the game): puts several PNGs side by side in one picture, so a theme or size
// matrix can be judged in a single look.
//
//   node scripts/dev/render/montage.mjs --out sheet.png [--cols 3] [--width 1600] [--label] a.png b.png c.png ...
//
// --width is the width of the finished sheet in pixels (each cell is scaled to fit its column, aspect ratio kept); --label prints each
// file name (without extension) in the corner of its cell. Headless Chromium does the compositing, so no image library is needed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
const { chromium } = require('playwright');

const opts = { out: 'montage.png', cols: 3, width: 1600, label: false, files: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--label') opts.label = true;
  else if (argv[i] === '--out') opts.out = argv[++i];
  else if (argv[i] === '--cols') opts.cols = Number(argv[++i]);
  else if (argv[i] === '--width') opts.width = Number(argv[++i]);
  else opts.files.push(argv[i]);
}
if (opts.files.length === 0) throw new Error('usage: montage.mjs --out sheet.png [--cols n] [--width px] [--label] images...');

const images = await Promise.all(opts.files.map(async (f) => ({ name: path.basename(f, path.extname(f)), url: `data:image/png;base64,${(await fs.readFile(f)).toString('base64')}` })));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const png = await page.evaluate(async ({ images, cols, width, label }) => {
    const loaded = await Promise.all(images.map((im) => new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve({ el, name: im.name });
      el.onerror = () => reject(new Error(`cannot load ${im.name}`));
      el.src = im.url;
    })));
    const gap = 6, cellW = Math.floor((width - gap * (cols + 1)) / cols);
    const rows = Math.ceil(loaded.length / cols), rowH = [];
    for (let r = 0; r < rows; r++) {
      let h = 0;
      for (let c = 0; c < cols && r * cols + c < loaded.length; c++) { const { el } = loaded[r * cols + c]; h = Math.max(h, Math.round((el.height * cellW) / el.width)); }
      rowH.push(h);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = rowH.reduce((a, b) => a + b + gap, gap);
    const g = canvas.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingQuality = 'high';
    let y = gap;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols && r * cols + c < loaded.length; c++) {
        const { el, name } = loaded[r * cols + c], h = Math.round((el.height * cellW) / el.width), x = gap + c * (cellW + gap);
        g.drawImage(el, x, y, cellW, h);
        if (label) {
          g.font = '600 14px monospace'; g.lineWidth = 4; g.strokeStyle = '#000'; g.fillStyle = '#fff';
          g.strokeText(name, x + 6, y + 16); g.fillText(name, x + 6, y + 16);
        }
      }
      y += rowH[r] + gap;
    }
    return canvas.toDataURL('image/png');
  }, { images, cols: opts.cols, width: opts.width, label: opts.label });
  await fs.writeFile(opts.out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`wrote ${opts.out}`);
} finally {
  await browser.close();
}
