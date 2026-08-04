/**
 * Tests for moving pictures that are already in a PDF.
 *
 * A placement is just a matrix, so most of the risk is in the algebra: getting
 * the concatenation order backwards puts a picture somewhere plausible but
 * wrong, which no assertion about "did it move" would catch.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PDFDocument, rgb } from '../src/renderer/vendor/pdf-lib.esm.min.js';
import {
  tokenize,
  operations,
  imagePlacements,
  placementBounds,
  imageFingerprint,
  applyImageTransforms,
  matMul,
  matApply,
  matInvert,
  isAxisAligned,
  replaceRanges,
  IDENTITY,
} from '../src/renderer/js/contentstream.js';
import { readPageContent, writePageContent, imageXObjectNames } from '../src/renderer/js/pagestream.js';
import { fromPdfPoint, toPdfPoint, rectFromPdf } from '../src/renderer/js/geometry.js';

const bytesOf = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const textOf = (b) => String.fromCharCode(...b);
const anyImage = () => true;

/* -------------------------------- matrices ------------------------------- */

test('matrix multiplication follows the PDF convention', () => {
  // Scale then translate: a point at the unit square's corner lands at e,f.
  const scale = [2, 0, 0, 3, 0, 0];
  const translate = [1, 0, 0, 1, 10, 20];
  const combined = matMul(scale, translate);
  assert.deepEqual(matApply(combined, 1, 1), { x: 12, y: 23 });
});

test('the identity leaves a point alone', () => {
  assert.deepEqual(matApply(IDENTITY, 7, 9), { x: 7, y: 9 });
});

test('inverting a matrix undoes it', () => {
  const m = [2, 0, 0, 3, 10, 20];
  const inverse = matInvert(m);
  const round = matMul(m, inverse);
  round.forEach((v, i) => assert.ok(Math.abs(v - IDENTITY[i]) < 1e-9));
});

test('a degenerate matrix cannot be inverted', () => {
  assert.equal(matInvert([0, 0, 0, 0, 0, 0]), null);
});

test('rotation and skew are recognised', () => {
  assert.equal(isAxisAligned([100, 0, 0, 50, 0, 0]), true);
  assert.equal(isAxisAligned([0, 100, -50, 0, 0, 0]), false);
});

/* ------------------------------- placements ------------------------------ */

test('a placement is found with the matrix that positions it', () => {
  const stream = 'q 100 0 0 50 40 700 cm /Im0 Do Q';
  const found = imagePlacements(operations(tokenize(bytesOf(stream))), anyImage);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].matrix, [100, 0, 0, 50, 40, 700]);
  assert.deepEqual(placementBounds(found[0].matrix), { x: 40, y: 700, w: 100, h: 50 });
});

test('nested transforms compose', () => {
  const stream = 'q 2 0 0 2 10 10 cm q 50 0 0 25 5 5 cm /Im0 Do Q Q';
  const found = imagePlacements(operations(tokenize(bytesOf(stream))), anyImage);
  // The inner cm is concatenated onto the outer one.
  assert.deepEqual(placementBounds(found[0].matrix), { x: 20, y: 20, w: 100, h: 50 });
});

test('a restore undoes a transform for the next picture', () => {
  const stream = 'q 100 0 0 100 0 500 cm /Im0 Do Q q 60 0 0 60 200 100 cm /Im1 Do Q';
  const found = imagePlacements(operations(tokenize(bytesOf(stream))), anyImage);
  assert.equal(found.length, 2);
  assert.deepEqual(placementBounds(found[1].matrix), { x: 200, y: 100, w: 60, h: 60 });
});

test('form XObjects are not offered as pictures', () => {
  const stream = 'q 10 0 0 10 0 0 cm /Form1 Do Q q 20 0 0 20 0 0 cm /Im0 Do Q';
  const found = imagePlacements(operations(tokenize(bytesOf(stream))), (n) => n === 'Im0');
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Im0');
});

test('an unbalanced restore does not throw', () => {
  const found = imagePlacements(operations(tokenize(bytesOf('Q Q 5 0 0 5 0 0 cm /Im0 Do'))), anyImage);
  assert.equal(found.length, 1);
});

test('the fingerprint notices a picture that moved', () => {
  const a = imagePlacements(operations(tokenize(bytesOf('q 10 0 0 10 0 0 cm /Im0 Do Q'))), anyImage);
  const b = imagePlacements(operations(tokenize(bytesOf('q 10 0 0 10 5 0 cm /Im0 Do Q'))), anyImage);
  assert.notEqual(imageFingerprint(a), imageFingerprint(b));
});

/* ------------------------------- rewriting ------------------------------- */

test('replaceRanges swaps the requested bytes', () => {
  const out = replaceRanges(bytesOf('AAA BBB CCC'), [{ start: 4, end: 7, text: 'XY' }]);
  assert.match(textOf(out), /AAA\s+XY\s+CCC/);
});

/** Where does the unit square end up after a stream is rewritten? */
function placedBounds(streamText, edits) {
  const bytes = bytesOf(streamText);
  const before = imagePlacements(operations(tokenize(bytes)), anyImage);
  const result = applyImageTransforms(bytes, edits, anyImage, imageFingerprint(before));
  assert.equal(result.ok, true, result.reason);
  const after = imagePlacements(operations(tokenize(result.bytes)), anyImage);
  return { bounds: placementBounds(after[0].matrix), text: textOf(result.bytes) };
}

test('a picture moves by exactly the requested amount', () => {
  const { bounds } = placedBounds('q 100 0 0 50 40 700 cm /Im0 Do Q', [
    { ordinal: 0, transform: [1, 0, 0, 1, 25, -30] },
  ]);
  assert.ok(Math.abs(bounds.x - 65) < 1e-6, `x was ${bounds.x}`);
  assert.ok(Math.abs(bounds.y - 670) < 1e-6, `y was ${bounds.y}`);
  assert.ok(Math.abs(bounds.w - 100) < 1e-6, 'width is unchanged');
  assert.ok(Math.abs(bounds.h - 50) < 1e-6, 'height is unchanged');
});

test('a picture resizes about the requested origin', () => {
  // Double the width, keeping the lower-left corner where it was.
  const { bounds } = placedBounds('q 100 0 0 50 40 700 cm /Im0 Do Q', [
    { ordinal: 0, transform: [2, 0, 0, 1, -40, 0] },
  ]);
  assert.ok(Math.abs(bounds.x - 40) < 1e-6, `x was ${bounds.x}`);
  assert.ok(Math.abs(bounds.w - 200) < 1e-6, `width was ${bounds.w}`);
  assert.ok(Math.abs(bounds.h - 50) < 1e-6, 'height is unchanged');
});

test('moving one picture leaves the others alone', () => {
  const stream = 'q 50 0 0 50 0 0 cm /Im0 Do Q q 60 0 0 60 200 100 cm /Im1 Do Q';
  const bytes = bytesOf(stream);
  const before = imagePlacements(operations(tokenize(bytes)), anyImage);
  const result = applyImageTransforms(
    bytes,
    [{ ordinal: 1, transform: [1, 0, 0, 1, 10, 10] }],
    anyImage,
    imageFingerprint(before)
  );
  assert.equal(result.ok, true, result.reason);
  const after = imagePlacements(operations(tokenize(result.bytes)), anyImage);
  assert.deepEqual(placementBounds(after[0].matrix), { x: 0, y: 0, w: 50, h: 50 });

  const moved = placementBounds(after[1].matrix);
  for (const [key, want] of Object.entries({ x: 210, y: 110, w: 60, h: 60 })) {
    assert.ok(Math.abs(moved[key] - want) < 1e-6, `${key} was ${moved[key]}, wanted ${want}`);
  }
});

test('the wrapper restores the transform so later drawing is unaffected', () => {
  const { text } = placedBounds('q 100 0 0 50 40 700 cm /Im0 Do Q', [
    { ordinal: 0, transform: [1, 0, 0, 1, 25, 0] },
  ]);
  const wrapped = text.slice(text.indexOf('q 1 0 0 1'));
  assert.match(wrapped, /q [^Q]*cm \/Im0 Do Q/, 'the inserted transform is inside q...Q');
});

test('a rotated placement can still be moved', () => {
  // 90-degree rotation: a = 0, b = h, c = -w, d = 0.
  const { bounds } = placedBounds('q 0 100 -50 0 300 400 cm /Im0 Do Q', [
    { ordinal: 0, transform: [1, 0, 0, 1, 10, 20] },
  ]);
  assert.ok(Math.abs(bounds.x - 260) < 1e-6, `x was ${bounds.x}`);
  assert.ok(Math.abs(bounds.y - 420) < 1e-6, `y was ${bounds.y}`);
});

test('a stale fingerprint refuses the move', () => {
  const bytes = bytesOf('q 100 0 0 50 40 700 cm /Im0 Do Q');
  const result = applyImageTransforms(
    bytes,
    [{ ordinal: 0, transform: [1, 0, 0, 1, 5, 5] }],
    anyImage,
    'stale'
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /changed/);
});

test('an ordinal that no longer exists refuses the move', () => {
  const bytes = bytesOf('q 100 0 0 50 40 700 cm /Im0 Do Q');
  const before = imagePlacements(operations(tokenize(bytes)), anyImage);
  const result = applyImageTransforms(
    bytes,
    [{ ordinal: 3, transform: IDENTITY }],
    anyImage,
    imageFingerprint(before)
  );
  assert.equal(result.ok, false);
});

/* ------------------------------- view space ------------------------------ */

test('page space and view space round-trip for every rotation', () => {
  const base = { baseW: 400, baseH: 600, cropX: 0, cropY: 0 };
  for (const rotate of [0, 90, 180, 270]) {
    const page = { ...base, rotate };
    for (const [x, y] of [[0, 0], [123, 45], [400, 600]]) {
      const pdf = toPdfPoint(page, x, y);
      const back = fromPdfPoint(page, pdf.x, pdf.y);
      assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9,
        `round trip failed at ${rotate}deg for ${x},${y}`);
    }
  }
});

test('a picture rectangle maps into view space', () => {
  const page = { baseW: 400, baseH: 600, cropX: 0, cropY: 0, rotate: 0 };
  const view = rectFromPdf(page, { x: 40, y: 500, w: 100, h: 50 });
  assert.deepEqual(view, { x: 40, y: 50, w: 100, h: 50 });
});

/* ------------------------------- a real file ----------------------------- */

/** A 4x4 red PNG, so the document contains a genuine image XObject. */
function tinyPng() {
  const { deflateSync } = require('node:zlib');
  const size = 4;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      raw[row + 1 + x * 3] = 220;
      raw[row + 2 + x * 3] = 60;
      raw[row + 3 + x * 3] = 60;
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('a picture in a real document is found and moved', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const png = await doc.embedPng(tinyPng());
  page.drawImage(png, { x: 50, y: 400, width: 120, height: 80 });
  page.drawRectangle({ x: 10, y: 10, width: 30, height: 30, color: rgb(0, 0, 1) });
  const bytes = await doc.save();

  const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
  const target = reloaded.getPage(0);

  const names = imageXObjectNames(reloaded, target);
  assert.equal(names.size, 1, 'the image XObject is identified');

  const content = readPageContent(reloaded, target);
  const placements = imagePlacements(operations(tokenize(content)), (n) => names.has(n));
  assert.equal(placements.length, 1);
  assert.deepEqual(placementBounds(placements[0].matrix), { x: 50, y: 400, w: 120, h: 80 });

  const result = applyImageTransforms(
    content,
    [{ ordinal: 0, transform: [1, 0, 0, 1, 100, -200] }],
    (n) => names.has(n),
    imageFingerprint(placements)
  );
  assert.equal(result.ok, true, result.reason);
  writePageContent(reloaded, target, result.bytes);

  // Read the saved file back and check where the picture ended up.
  const final = await PDFDocument.load(await reloaded.save(), { updateMetadata: false });
  const finalPage = final.getPage(0);
  const finalNames = imageXObjectNames(final, finalPage);
  const finalPlacements = imagePlacements(
    operations(tokenize(readPageContent(final, finalPage))),
    (n) => finalNames.has(n)
  );
  assert.equal(finalPlacements.length, 1);
  const moved = placementBounds(finalPlacements[0].matrix);
  assert.ok(Math.abs(moved.x - 150) < 1e-6, `x was ${moved.x}`);
  assert.ok(Math.abs(moved.y - 200) < 1e-6, `y was ${moved.y}`);
  assert.ok(Math.abs(moved.w - 120) < 1e-6, 'width survived');
});
