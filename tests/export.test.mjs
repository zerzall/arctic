/**
 * End-to-end tests for the parts of the editor that produce PDF bytes.
 *
 * These import the very modules the app ships, build documents through the same
 * code path as "Save", and then read the result back with pdf-lib and pdf.js.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PDFDocument, StandardFonts, rgb, degrees } from '../src/renderer/vendor/pdf-lib.esm.min.js';
import { buildPdf, extractPages, isStructurallyUnchanged } from '../src/renderer/js/export.js';
import { toPdfPoint, viewSize, normRotation, annotBounds, resizeAnnot } from '../src/renderer/js/geometry.js';
import { wrapLines, sanitizeForStandardFont } from '../src/renderer/js/textlayout.js';

/* --------------------------- fixtures & helpers -------------------------- */

/** A source PDF whose pages are individually identifiable by their text. */
async function makeSource(labels, { size = [400, 600], rotate = 0 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const page = doc.addPage(size);
    if (rotate) page.setRotation(degrees(rotate));
    page.drawText(label, { x: 40, y: 500, size: 24, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

function pageSpec(overrides = {}) {
  return {
    src: 'main',
    index: 0,
    rotate: 0,
    baseW: 400,
    baseH: 600,
    cropX: 0,
    cropY: 0,
    annots: [],
    ...overrides,
  };
}

async function pageTexts(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: new URL(
      '../node_modules/pdfjs-dist/standard_fonts/',
      import.meta.url
    ).href,
  });
  const doc = await task.promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out.push(content.items.map((it) => it.str).join(''));
  }
  await task.destroy();
  return out;
}

/* ------------------------------- geometry -------------------------------- */

test('normRotation snaps to the four legal values', () => {
  assert.equal(normRotation(0), 0);
  assert.equal(normRotation(90), 90);
  assert.equal(normRotation(-90), 270);
  assert.equal(normRotation(450), 90);
  assert.equal(normRotation(undefined), 0);
});

test('viewSize swaps the axes for quarter turns', () => {
  const p = { baseW: 400, baseH: 600, rotate: 0 };
  assert.deepEqual(viewSize(p), { w: 400, h: 600 });
  assert.deepEqual(viewSize({ ...p, rotate: 90 }), { w: 600, h: 400 });
  assert.deepEqual(viewSize({ ...p, rotate: 180 }), { w: 400, h: 600 });
  assert.deepEqual(viewSize({ ...p, rotate: 270 }), { w: 600, h: 400 });
});

test('view space maps to PDF space for every rotation', () => {
  const base = { baseW: 400, baseH: 600, cropX: 0, cropY: 0 };

  // Unrotated: the view origin is the top-left, PDF's is the bottom-left.
  assert.deepEqual(toPdfPoint({ ...base, rotate: 0 }, 0, 0), { x: 0, y: 600 });
  assert.deepEqual(toPdfPoint({ ...base, rotate: 0 }, 400, 600), { x: 400, y: 0 });

  // Quarter turn clockwise: the view is 600x400 and the top-left of the screen
  // is the bottom-left corner of the unrotated page.
  assert.deepEqual(toPdfPoint({ ...base, rotate: 90 }, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(toPdfPoint({ ...base, rotate: 90 }, 600, 400), { x: 400, y: 600 });

  assert.deepEqual(toPdfPoint({ ...base, rotate: 180 }, 0, 0), { x: 400, y: 0 });
  assert.deepEqual(toPdfPoint({ ...base, rotate: 270 }, 0, 0), { x: 400, y: 600 });
});

test('the crop box origin offsets every mapped point', () => {
  const p = { baseW: 100, baseH: 200, cropX: 10, cropY: 20, rotate: 0 };
  assert.deepEqual(toPdfPoint(p, 0, 0), { x: 10, y: 220 });
});

test('mapped points always stay inside the page box', () => {
  const base = { baseW: 400, baseH: 600, cropX: 0, cropY: 0 };
  for (const rotate of [0, 90, 180, 270]) {
    const { w, h } = viewSize({ ...base, rotate });
    for (const [vx, vy] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 3]]) {
      const p = toPdfPoint({ ...base, rotate }, vx, vy);
      assert.ok(p.x >= -0.001 && p.x <= 400.001, `x ${p.x} at ${rotate}deg`);
      assert.ok(p.y >= -0.001 && p.y <= 600.001, `y ${p.y} at ${rotate}deg`);
    }
  }
});

test('resizing a box annotation scales it into the new bounds', () => {
  const annot = { type: 'rect', x: 10, y: 10, w: 100, h: 50, lineWidth: 1 };
  const from = annotBounds(annot);
  resizeAnnot(annot, from, { x: 10, y: 10, w: 200, h: 50 });
  assert.equal(annot.w, 200);
  assert.equal(annot.x, 10);
});

test('resizing a freehand stroke moves each point', () => {
  const annot = { type: 'draw', points: [[0, 0], [10, 10]], lineWidth: 0 };
  const from = annotBounds(annot);
  resizeAnnot(annot, from, { x: 0, y: 0, w: 20, h: 20 });
  assert.deepEqual(annot.points[1], [20, 20]);
});

/* ------------------------------ text layout ------------------------------ */

test('wrapLines respects the box width', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrapLines('the quick brown fox jumps over the lazy dog', font, 12, 100);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(font.widthOfTextAtSize(line, 12) <= 100.5, `"${line}" is too wide`);
  }
});

test('wrapLines keeps explicit newlines', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  assert.deepEqual(wrapLines('a\nb\n\nc', font, 12, 0), ['a', 'b', '', 'c']);
});

test('a word wider than the box is split rather than dropped', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrapLines('supercalifragilisticexpialidocious', font, 14, 60);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), 'supercalifragilisticexpialidocious');
});

test('characters outside WinAnsi are replaced, not thrown', () => {
  const { text, dropped } = sanitizeForStandardFont('café “quoted” — 你好');
  assert.equal(dropped, 2);
  assert.ok(text.includes('café'));
  assert.ok(text.includes('"quoted"'));
  assert.ok(text.endsWith('??'));
});

/* -------------------------------- writing -------------------------------- */

test('an untouched document is edited in place, not rebuilt', async () => {
  const src = await makeSource(['ALPHA', 'BETA']);
  const model = {
    sources: { main: src },
    pages: [pageSpec({ index: 0 }), pageSpec({ index: 1 })],
    originalPageCount: 2,
  };
  assert.equal(isStructurallyUnchanged(model), true);
  const { bytes, rebuilt } = await buildPdf(model);
  assert.equal(rebuilt, false);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(out.getPageCount(), 2);
});

test('reordering and deleting pages rebuilds the document in the new order', async () => {
  const src = await makeSource(['ALPHA', 'BETA', 'GAMMA']);
  const model = {
    sources: { main: src },
    originalPageCount: 3,
    pages: [pageSpec({ index: 2 }), pageSpec({ index: 0 })],
  };
  assert.equal(isStructurallyUnchanged(model), false);
  const { bytes, rebuilt } = await buildPdf(model);
  assert.equal(rebuilt, true);

  const texts = await pageTexts(bytes);
  assert.equal(texts.length, 2);
  assert.match(texts[0], /GAMMA/);
  assert.match(texts[1], /ALPHA/);
});

test('the same source page can be used more than once', async () => {
  const src = await makeSource(['ALPHA', 'BETA']);
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 2,
    pages: [pageSpec({ index: 1 }), pageSpec({ index: 1 }), pageSpec({ index: 0 })],
  });
  const texts = await pageTexts(bytes);
  assert.deepEqual(texts.map((t) => t.trim()), ['BETA', 'BETA', 'ALPHA']);
});

test('pages from a second document are merged in', async () => {
  const a = await makeSource(['ALPHA']);
  const b = await makeSource(['OTHER']);
  const { bytes } = await buildPdf({
    sources: { main: a, s1: b },
    originalPageCount: 1,
    pages: [pageSpec({ index: 0 }), pageSpec({ src: 's1', index: 0 })],
  });
  const texts = await pageTexts(bytes);
  assert.match(texts[0], /ALPHA/);
  assert.match(texts[1], /OTHER/);
});

test('a blank page is inserted at its requested size', async () => {
  const src = await makeSource(['ALPHA']);
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [pageSpec({ index: 0 }), pageSpec({ src: null, index: -1, baseW: 300, baseH: 300 })],
  });
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(out.getPageCount(), 2);
  const { width, height } = out.getPage(1).getSize();
  assert.equal(Math.round(width), 300);
  assert.equal(Math.round(height), 300);
});

test('page rotation is written to the output', async () => {
  const src = await makeSource(['ALPHA']);
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [pageSpec({ rotate: 270 })],
  });
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(out.getPage(0).getRotation().angle, 270);
});

test('text annotations end up on the page as real text', async () => {
  const src = await makeSource(['ALPHA']);
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [
      pageSpec({
        annots: [
          {
            id: 't1',
            type: 'text',
            x: 20,
            y: 20,
            w: 300,
            h: 60,
            text: 'Reviewed and approved',
            fontSize: 14,
            font: 'Helvetica',
            color: '#111111',
          },
        ],
      }),
    ],
  });
  const texts = await pageTexts(bytes);
  assert.match(texts[0], /Reviewed and approved/);
});

test('a text annotation on a rotated page lands inside the page box', async () => {
  const src = await makeSource(['ALPHA']);
  const { bytes, warnings } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [
      pageSpec({
        rotate: 90,
        annots: [
          {
            id: 't1',
            type: 'text',
            x: 10,
            y: 10,
            w: 200,
            h: 40,
            text: 'Rotated note',
            fontSize: 12,
            font: 'Helvetica',
            color: '#000000',
          },
        ],
      }),
    ],
  });
  assert.deepEqual(warnings, []);
  const texts = await pageTexts(bytes);
  assert.match(texts[0], /Rotated note/);
});

test('every shape type survives a round trip', async () => {
  const src = await makeSource(['ALPHA']);
  const png = await makeTinyPng();
  const { bytes, warnings } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    images: { img1: { bytes: png, mime: 'image/png' } },
    pages: [
      pageSpec({
        annots: [
          { id: '1', type: 'highlight', x: 10, y: 10, w: 80, h: 14, color: '#ffe14d', opacity: 0.4 },
          { id: '2', type: 'rect', x: 10, y: 40, w: 80, h: 40, color: '#e03131', lineWidth: 2, fill: '#ffffff' },
          { id: '3', type: 'ellipse', x: 100, y: 40, w: 60, h: 40, color: '#2ecc71', lineWidth: 1.5 },
          { id: '4', type: 'line', x1: 10, y1: 100, x2: 120, y2: 140, color: '#4c8dff', lineWidth: 3 },
          { id: '5', type: 'arrow', x1: 10, y1: 160, x2: 120, y2: 200, color: '#4c8dff', lineWidth: 2 },
          { id: '6', type: 'draw', points: [[10, 220], [40, 240], [80, 210]], color: '#000000', lineWidth: 2 },
          { id: '7', type: 'image', imgId: 'img1', x: 150, y: 220, w: 60, h: 60 },
          { id: '8', type: 'whiteout', x: 200, y: 300, w: 90, h: 30, fill: '#ffffff', lineWidth: 0 },
          { id: '9', type: 'blackout', x: 200, y: 340, w: 90, h: 30, fill: '#000000', lineWidth: 0 },
        ],
      }),
    ],
  });
  assert.deepEqual(warnings, []);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(out.getPageCount(), 1);
  assert.ok(bytes.length > 1000);
});

test('hidden annotations are not written', async () => {
  const src = await makeSource(['ALPHA']);
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [
      pageSpec({
        annots: [
          { id: 'x', type: 'text', x: 10, y: 10, w: 200, h: 30, text: 'SECRET', fontSize: 12, hidden: true },
        ],
      }),
    ],
  });
  const texts = await pageTexts(bytes);
  assert.doesNotMatch(texts[0], /SECRET/);
});

test('document metadata is written', async () => {
  const src = await makeSource(['ALPHA']);
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [pageSpec()],
    meta: {
      title: 'Quarterly report',
      author: 'A. Editor',
      subject: 'Numbers',
      keywords: 'one, two',
    },
  });
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(out.getTitle(), 'Quarterly report');
  assert.equal(out.getAuthor(), 'A. Editor');
  assert.equal(out.getSubject(), 'Numbers');
  assert.match(out.getProducer() || '', /Arctic/);
});

/* --------------------------------- forms --------------------------------- */

async function makeFormSource() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const form = doc.getForm();
  const name = form.createTextField('applicant.name');
  name.addToPage(page, { x: 40, y: 500, width: 200, height: 20 });
  const agree = form.createCheckBox('applicant.agree');
  agree.addToPage(page, { x: 40, y: 460, width: 14, height: 14 });
  return doc.save();
}

test('form values are applied and can stay interactive', async () => {
  const src = await makeFormSource();
  const { bytes, rebuilt } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [pageSpec()],
    formValues: { 'applicant.name': 'Ada Lovelace', 'applicant.agree': true },
  });
  assert.equal(rebuilt, false);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = out.getForm();
  assert.equal(form.getTextField('applicant.name').getText(), 'Ada Lovelace');
  assert.equal(form.getCheckBox('applicant.agree').isChecked(), true);
});

test('flattening removes the interactive fields but keeps the value visible', async () => {
  const src = await makeFormSource();
  const { bytes } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [pageSpec()],
    formValues: { 'applicant.name': 'Ada Lovelace' },
    flattenForms: true,
  });
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(out.getForm().getFields().length, 0);
  const texts = await pageTexts(bytes);
  assert.match(texts[0], /Ada Lovelace/);
});

test('reordering a form document bakes the values in and warns about it', async () => {
  const src = await makeFormSource();
  const second = await makeSource(['SECOND']);
  const { bytes, warnings, rebuilt } = await buildPdf({
    sources: { main: src, s1: second },
    originalPageCount: 1,
    pages: [pageSpec({ src: 's1', index: 0 }), pageSpec()],
    formValues: { 'applicant.name': 'Grace Hopper' },
  });
  assert.equal(rebuilt, true);
  assert.ok(warnings.some((w) => /flatten/i.test(w)));
  const texts = await pageTexts(bytes);
  assert.match(texts[1], /Grace Hopper/);
});

/* ------------------------------- extraction ------------------------------- */

test('extractPages writes only the requested pages, in order', async () => {
  const src = await makeSource(['ALPHA', 'BETA', 'GAMMA']);
  const model = {
    sources: { main: src },
    originalPageCount: 3,
    pages: [pageSpec({ index: 0 }), pageSpec({ index: 1 }), pageSpec({ index: 2 })],
  };
  const { bytes } = await extractPages(model, [2, 0]);
  const texts = await pageTexts(bytes);
  assert.deepEqual(texts.map((t) => t.trim()), ['GAMMA', 'ALPHA']);
});

test('an out-of-range page index is skipped with a warning instead of crashing', async () => {
  const src = await makeSource(['ALPHA']);
  const { bytes, warnings } = await buildPdf({
    sources: { main: src },
    originalPageCount: 1,
    pages: [pageSpec({ index: 0 }), pageSpec({ src: 'missing', index: 5 })],
  });
  assert.ok(warnings.length >= 1);
  const out = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(out.getPageCount(), 2);
});

/* --------------------------------- helper -------------------------------- */

/** A 4x4 red PNG, written by hand so the tests need no fixtures on disk. */
async function makeTinyPng() {
  const { deflateSync } = await import('node:zlib');
  const size = 4;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 4);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 4;
      raw[at] = 220;
      raw[at + 1] = 60;
      raw[at + 2] = 60;
      raw[at + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
