/**
 * Tests for recognising text on scanned pages.
 *
 * The recogniser itself is a browser bundle and cannot run here, so these cover
 * the two halves either side of it: the geometry that turns pixel boxes into
 * page coordinates, and the invisible text layer that makes the saved file
 * searchable. Both are where a mistake would be silent - a text layer that is
 * present but misplaced looks fine until someone selects a word.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '../src/renderer/vendor/pdf-lib.esm.min.js';
import { buildPdf } from '../src/renderer/js/export.js';
import { boxToView, usableWords, wordsAsItems, MIN_CONFIDENCE } from '../src/renderer/js/ocrdata.js';
import { groupRuns } from '../src/renderer/js/textedit.js';
import { vendorUrl } from '../src/renderer/js/pdfjsopts.js';

/* ------------------------------- geometry -------------------------------- */

test('a pixel box becomes a box in points', () => {
  // 300 dpi: 300/72 pixels per point.
  const scale = 300 / 72;
  const box = boxToView({ x0: 300, y0: 600, x1: 600, y1: 675 }, scale);
  assert.equal(box.x, 72);
  assert.equal(box.y, 144);
  assert.equal(box.w, 72);
  assert.equal(box.h, 18);
});

test('low-confidence speckle is dropped', () => {
  const words = [
    { text: 'real', w: 10, h: 5, confidence: 95 },
    { text: 'noise', w: 10, h: 5, confidence: MIN_CONFIDENCE - 1 },
    { text: '   ', w: 10, h: 5, confidence: 99 },
    { text: 'zero-size', w: 0, h: 5, confidence: 99 },
  ];
  assert.deepEqual(usableWords(words).map((w) => w.text), ['real']);
});

test('a word with no confidence reported is kept', () => {
  assert.equal(usableWords([{ text: 'x', w: 1, h: 1 }]).length, 1);
});

test('words become items anchored on their baseline', () => {
  const [item] = wordsAsItems([{ text: 'Total', x: 72, y: 100, w: 30, h: 12 }]);
  assert.equal(item.str, 'Total');
  assert.equal(item.x, 72);
  assert.equal(item.y, 112, 'baseline sits at the bottom of the box');
  assert.equal(item.size, 12);
  assert.equal(item.fontKey, 'ocr');
  assert.equal(item.srcIndex, undefined, 'recognised text has no drawing operator');
});

test('recognised words group into lines like any other text', () => {
  const words = [
    { text: 'Total', x: 72, y: 100, w: 30, h: 12 },
    { text: 'due', x: 106, y: 100, w: 20, h: 12 },
    { text: '42.00', x: 300, y: 100, w: 30, h: 12 }, // far away: its own run
    { text: 'Next', x: 72, y: 130, w: 25, h: 12 }, // next line
  ];
  const runs = groupRuns(wordsAsItems(words));
  assert.equal(runs.length, 3);
  assert.equal(runs[0].text, 'Total due');
});

/* --------------------------- the vendored engine -------------------------- */

test('the recognition engine and language data are vendored', () => {
  const files = [
    'tesseract/tesseract.esm.min.js',
    'tesseract/worker.min.js',
    'tesseract/tesseract-core-lstm.wasm.js',
    'tesseract/tesseract-core-simd-lstm.wasm.js',
    'tesseract/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tessdata/eng.traineddata.gz',
  ];
  for (const file of files) {
    const path = fileURLToPath(vendorUrl(file));
    assert.ok(existsSync(path), `${file} is missing - OCR would need the network`);
    assert.ok(statSync(path).size > 1000, `${file} looks truncated`);
  }
});

/* -------------------------- the invisible text layer ---------------------- */

/** A page that is just a picture, the way a scan is. */
async function scannedPage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.97, 0.97, 0.97) });
  return doc.save();
}

function specWith(ocr) {
  return {
    src: 'main',
    index: 0,
    rotate: 0,
    baseW: 612,
    baseH: 792,
    cropX: 0,
    cropY: 0,
    annots: [],
    ocr,
  };
}

async function readBack(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
  const doc = await task.promise;
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  const out = items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
  await task.destroy();
  return out;
}

test('recognised words are written so the scan becomes searchable', async () => {
  const src = await scannedPage();
  const { bytes, warnings } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [
      specWith({
        words: [
          { text: 'Invoice', x: 72, y: 100, w: 50, h: 14 },
          { text: '5725293680', x: 130, y: 100, w: 80, h: 14 },
        ],
      }),
    ],
  });
  assert.deepEqual(warnings, []);

  const items = await readBack(bytes);
  const words = items.map((i) => i.str).join(' ');
  assert.match(words, /Invoice/);
  assert.match(words, /5725293680/);
});

test('the invisible text sits where the picture of it is', async () => {
  const src = await scannedPage();
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [specWith({ words: [{ text: 'Account', x: 72, y: 100, w: 50, h: 14 }] })],
  });

  const [item] = (await readBack(bytes)).filter((i) => /Account/.test(i.str));
  assert.ok(item, 'the word is in the text layer');
  // View y=100..114 on a 792pt page: the baseline sits near the box's bottom.
  const expectedBaseline = 792 - (100 + 14 * 0.82);
  assert.ok(Math.abs(item.y - expectedBaseline) < 0.5, `baseline was ${item.y}`);
  assert.ok(Math.abs(item.x - 72) < 0.5, `x was ${item.x}`);
});

test('the text layer is invisible, not merely small', async () => {
  const src = await scannedPage();
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [specWith({ words: [{ text: 'Hidden', x: 10, y: 10, w: 40, h: 12 }] })],
  });
  const { readPageContent } = await import('../src/renderer/js/pagestream.js');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const content = new TextDecoder('latin1').decode(readPageContent(doc, doc.getPage(0)));
  // Text rendering mode 3 is "neither fill nor stroke": drawn but not shown.
  assert.match(content, /\b3 Tr\b/);
});

test('a page with no recognised words is left alone', async () => {
  const src = await scannedPage();
  const { bytes, warnings } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [specWith({ words: [] })],
  });
  assert.deepEqual(warnings, []);
  assert.equal((await readBack(bytes)).filter((i) => i.str.trim()).length, 0);
});

test('a word the built-in font cannot encode is reported, not silently dropped', async () => {
  const src = await scannedPage();
  const { warnings } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [specWith({ words: [{ text: '你好', x: 10, y: 10, w: 40, h: 12 }] })],
  });
  // The characters fall outside WinAnsi; the writer says so rather than
  // pretending the page is searchable for them.
  assert.ok(warnings.length >= 1);
});

test('recognised text survives a page rotation', async () => {
  const src = await scannedPage();
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [{ ...specWith({ words: [{ text: 'Sideways', x: 50, y: 60, w: 60, h: 14 }] }), rotate: 90 }],
  });
  const items = await readBack(bytes);
  assert.ok(items.some((i) => /Sideways/.test(i.str)), 'the word is still there');
});
