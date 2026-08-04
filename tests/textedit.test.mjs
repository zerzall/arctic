/**
 * Tests for recognising and replacing text that is already on a page.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PDFDocument, StandardFonts, rgb } from '../src/renderer/vendor/pdf-lib.esm.min.js';
import { buildPdf } from '../src/renderer/js/export.js';
import {
  mapToStandardFont,
  groupRuns,
  annotYForBaseline,
  baselineForAnnotY,
  buildReplacement,
  pickColors,
  runAt,
} from '../src/renderer/js/textedit.js';
import { layoutTextAnnot } from '../src/renderer/js/textlayout.js';

/* ------------------------------ font mapping ----------------------------- */

test('embedded font names map onto the closest built-in font', () => {
  assert.deepEqual(mapToStandardFont('ABCDEF+Helvetica'), {
    font: 'Helvetica',
    bold: false,
    italic: false,
  });
  assert.deepEqual(mapToStandardFont('Arial-BoldMT'), {
    font: 'Helvetica',
    bold: true,
    italic: false,
  });
  assert.deepEqual(mapToStandardFont('TimesNewRomanPS-BoldItalicMT'), {
    font: 'Times',
    bold: true,
    italic: true,
  });
  assert.deepEqual(mapToStandardFont('CourierNewPS-ItalicMT'), {
    font: 'Courier',
    bold: false,
    italic: true,
  });
  assert.equal(mapToStandardFont('Calibri-Light').font, 'Helvetica');
  assert.equal(mapToStandardFont('Georgia').font, 'Times');
});

test('the subset prefix does not fool the bold/italic detection', () => {
  // "ABCDEF+" is a subset tag, not a style hint.
  assert.equal(mapToStandardFont('BOLDXX+Helvetica').bold, false);
});

test('the generic family decides when the name says nothing', () => {
  assert.equal(mapToStandardFont('XYZ123', 'serif').font, 'Times');
  assert.equal(mapToStandardFont('XYZ123', 'monospace').font, 'Courier');
  assert.equal(mapToStandardFont('', undefined).font, 'Helvetica');
});

/* -------------------------------- grouping ------------------------------- */

const item = (str, x, y, width, over = {}) => ({
  str,
  x,
  y,
  width,
  size: 12,
  angle: 0,
  fontKey: 'f1',
  ...over,
});

test('items on one baseline become a single editable line', () => {
  const runs = groupRuns([
    item('Hello ', 50, 100, 34),
    item('world', 84, 100, 30),
  ]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, 'Hello world');
  assert.equal(runs[0].x, 50);
  assert.equal(Math.round(runs[0].w), 64);
});

test('a wide gap keeps table columns separately editable', () => {
  const runs = groupRuns([item('Item', 50, 100, 30), item('42.00', 300, 100, 30)]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((r) => r.text), ['Item', '42.00']);
});

test('a missing space between items is restored', () => {
  // Items whose strings carry no space but which are drawn a space apart.
  const runs = groupRuns([item('Total', 50, 100, 30), item('42.00', 84, 100, 28)]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, 'Total 42.00');
});

test('different baselines are different lines', () => {
  const runs = groupRuns([item('first', 50, 100, 30), item('second', 50, 120, 30)]);
  assert.equal(runs.length, 2);
});

test('a different font or size breaks the run', () => {
  const runs = groupRuns([
    item('normal ', 50, 100, 34),
    item('BIG', 84, 100, 30, { size: 24 }),
  ]);
  assert.equal(runs.length, 2);
});

test('rotated and empty items are ignored', () => {
  const runs = groupRuns([
    item('sideways', 50, 100, 30, { angle: 1.57 }),
    item('   ', 50, 200, 10),
    item('keep', 50, 300, 20),
  ]);
  assert.deepEqual(runs.map((r) => r.text), ['keep']);
});

test('a run box brackets its baseline', () => {
  const [run] = groupRuns([item('text', 50, 100, 30)]);
  assert.ok(run.y < 100, 'box starts above the baseline');
  assert.ok(run.y + run.h > 100, 'box extends below the baseline');
});

/* ------------------------------- baselines ------------------------------- */

test('baseline placement round-trips', () => {
  const y = annotYForBaseline(400, 13);
  assert.ok(Math.abs(baselineForAnnotY(y, 13) - 400) < 1e-9);
});

test('a replacement draws its first line on the original baseline', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const run = { text: 'Original', x: 72, y: 90, w: 100, h: 14, baseline: 100, size: 12 };
  const { text } = buildReplacement(run, mapToStandardFont('Helvetica'), {
    background: '#ffffff',
    text: '#000000',
  }, 'p1');

  const { baselines } = layoutTextAnnot(text, font);
  assert.ok(Math.abs(baselines[0] - run.baseline) < 1e-6);
});

test('a replacement is paired with a patch that covers the original', () => {
  const run = { text: 'Original', x: 72, y: 90, w: 100, h: 14, baseline: 100, size: 12 };
  const { cover, text } = buildReplacement(run, { font: 'Times', bold: true, italic: false }, {
    background: '#fefefe',
    text: '#202020',
  }, 'pair-1');

  assert.equal(cover.type, 'cover');
  assert.equal(cover.pairId, text.pairId);
  assert.equal(cover.fill, '#fefefe');
  assert.ok(cover.x <= run.x && cover.y <= run.y, 'the patch starts outside the glyphs');
  assert.ok(
    cover.x + cover.w >= run.x + run.w && cover.y + cover.h >= run.y + run.h,
    'the patch ends outside the glyphs'
  );

  assert.equal(text.text, 'Original');
  assert.equal(text.font, 'Times');
  assert.equal(text.bold, true);
  assert.equal(text.color, '#202020');
  assert.equal(text.nowrap, true);
  assert.equal(text.replaced, true);
});

test('replaced text does not reflow, however long it gets', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const run = { text: 'short', x: 72, y: 90, w: 40, h: 14, baseline: 100, size: 12 };
  const { text } = buildReplacement(run, mapToStandardFont('Helvetica'), {
    background: '#ffffff',
    text: '#000000',
  }, 'p1');

  text.text = 'a replacement far longer than the line it stands in for';
  const { lines } = layoutTextAnnot(text, font);
  assert.equal(lines.length, 1);
});

/* ---------------------------- colour sampling ---------------------------- */

function imageOf(pixels) {
  return { data: Uint8ClampedArray.from(pixels.flatMap((p) => [...p, 255])) };
}

test('colours come from the page, not from assuming black on white', () => {
  const paper = [250, 245, 230];
  const ink = [30, 40, 120];
  const ring = imageOf(Array.from({ length: 40 }, () => paper));
  const inside = imageOf([...Array.from({ length: 30 }, () => paper), ...Array.from({ length: 10 }, () => ink)]);

  const colors = pickColors(inside, ring);
  assert.equal(colors.background, '#faf5e6');
  assert.equal(colors.text, '#1e2878');
});

test('sampling survives an empty region without throwing', () => {
  const colors = pickColors(imageOf([]), imageOf([]));
  assert.equal(colors.background, '#ffffff');
  assert.equal(colors.text, '#111111');
});

test('fully transparent pixels are skipped', () => {
  const ring = { data: Uint8ClampedArray.from([0, 0, 0, 0, 255, 255, 255, 255]) };
  assert.equal(pickColors(imageOf([[0, 0, 0]]), ring).background, '#ffffff');
});

/* -------------------------------- hit test ------------------------------- */

test('runAt finds the line under the pointer', () => {
  const runs = [
    { x: 10, y: 10, w: 100, h: 14 },
    { x: 10, y: 40, w: 100, h: 14 },
  ];
  assert.equal(runAt(runs, 50, 15), runs[0]);
  assert.equal(runAt(runs, 50, 45), runs[1]);
  assert.equal(runAt(runs, 50, 100), null);
  assert.equal(runAt(runs, 500, 15), null);
});

/* ------------------------------ written file ----------------------------- */

test('a replaced line is written as new text over a patch', async () => {
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.Helvetica);
  const page = src.addPage([400, 600]);
  page.drawText('Original wording', { x: 72, y: 500, size: 12, font, color: rgb(0, 0, 0) });
  const bytes = await src.save();

  // Mirrors what a click produces: the run sits at view y = 600 - 500 = 100.
  const run = { text: 'Original wording', x: 72, y: 91, w: 90, h: 14, baseline: 100, size: 12 };
  const { cover, text } = buildReplacement(run, mapToStandardFont('Helvetica'), {
    background: '#ffffff',
    text: '#000000',
  }, 'pair-1');
  text.text = 'Corrected wording';

  const out = await buildPdf({
    sources: { main: bytes },
    originalPageCount: 1,
    pages: [
      {
        src: 'main',
        index: 0,
        rotate: 0,
        baseW: 400,
        baseH: 600,
        cropX: 0,
        cropY: 0,
        annots: [{ id: 'c', ...cover }, { id: 't', ...text }],
      },
    ],
  });
  assert.deepEqual(out.warnings, []);

  const reloaded = await PDFDocument.load(out.bytes, { updateMetadata: false });
  assert.equal(reloaded.getPageCount(), 1);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(out.bytes),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
  const doc = await task.promise;
  const content = await (await doc.getPage(1)).getTextContent();

  const replacement = content.items.find((i) => /Corrected wording/.test(i.str));
  assert.ok(replacement, 'the new wording is on the page');
  // Drawn on the very baseline the original occupied.
  assert.ok(Math.abs(replacement.transform[5] - 500) < 0.5, `baseline was ${replacement.transform[5]}`);
  assert.ok(Math.abs(replacement.transform[4] - 72) < 0.5, `x was ${replacement.transform[4]}`);

  // And the honest part: covering is not deleting.
  assert.ok(
    content.items.some((i) => /Original wording/.test(i.str)),
    'the covered original is still in the text layer, as documented'
  );
  await task.destroy();
});
