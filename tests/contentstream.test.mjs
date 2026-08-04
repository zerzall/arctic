/**
 * Tests for content-stream surgery - actually removing text from a page.
 *
 * The tokeniser has to be right about some genuinely awkward syntax (escaped
 * parentheses, inline image binary), and the deletion has to refuse whenever it
 * cannot be certain, because the failure mode is a damaged document.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PDFDocument, StandardFonts, rgb } from '../src/renderer/vendor/pdf-lib.esm.min.js';
import {
  tokenize,
  operations,
  showOperations,
  isSafeToDelete,
  removeRanges,
  alignOpsToItems,
  planDeletion,
  applyDeletion,
  fingerprint,
} from '../src/renderer/js/contentstream.js';
import { readPageContent, writePageContent } from '../src/renderer/js/pagestream.js';

const bytesOf = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const textOf = (b) => String.fromCharCode(...b);

/* ------------------------------- tokenising ------------------------------ */

test('operands are grouped with their operator', () => {
  const ops = operations(tokenize(bytesOf('1 0 0 1 40 250 Tm (hi) Tj')));
  assert.deepEqual(ops.map((o) => o.operator), ['Tm', 'Tj']);
  assert.equal(ops[0].operands.length, 6);
});

test('literal strings keep their escapes', () => {
  const shows = showOperations(operations(tokenize(bytesOf('(a\\(b\\)c) Tj'))));
  assert.equal(shows[0].text, 'a(b)c');
});

test('octal escapes decode', () => {
  const shows = showOperations(operations(tokenize(bytesOf('(\\101\\102) Tj'))));
  assert.equal(shows[0].text, 'AB');
});

test('nested parentheses do not end the string early', () => {
  const shows = showOperations(operations(tokenize(bytesOf('(outer (inner) done) Tj'))));
  assert.equal(shows[0].text, 'outer (inner) done');
});

test('hex strings decode', () => {
  const shows = showOperations(operations(tokenize(bytesOf('<48656C6C6F> Tj'))));
  assert.equal(shows[0].text, 'Hello');
});

test('a TJ array is joined into one run of text', () => {
  const shows = showOperations(operations(tokenize(bytesOf('[(Hel) -20 (lo) -15 ( world)] TJ'))));
  assert.equal(shows.length, 1);
  assert.equal(shows[0].text, 'Hello world');
});

test('comments are ignored', () => {
  const ops = operations(tokenize(bytesOf('% a comment (not) Tj\n(real) Tj')));
  assert.equal(ops.length, 1);
  assert.equal(showOperations(ops)[0].text, 'real');
});

test('inline image data is not mistaken for operators', () => {
  // The binary payload deliberately contains bytes that spell "Tj".
  const stream = 'BI /W 2 /H 2 ID \x00Tj(\xff\xfe EI\n(after) Tj';
  const shows = showOperations(operations(tokenize(bytesOf(stream))));
  assert.equal(shows.length, 1, 'only the real Tj is found');
  assert.equal(shows[0].text, 'after');
});

test('the quote operators count as showing text', () => {
  const shows = showOperations(operations(tokenize(bytesOf("(a) ' 1 2 (b) \""))));
  assert.deepEqual(shows.map((s) => s.text), ['a', 'b']);
});

test('a stream of nothing but junk does not hang the tokeniser', () => {
  const ops = operations(tokenize(bytesOf('>>> ] } ) ( unterminated')));
  assert.ok(Array.isArray(ops));
});

/* -------------------------------- safety --------------------------------- */

test('deleting is refused when surviving text would slide into the gap', () => {
  // Two Tj in a row: dropping the first moves the second.
  const ops = operations(tokenize(bytesOf('BT (one) Tj (two) Tj ET')));
  const shows = showOperations(ops);
  assert.equal(isSafeToDelete(ops, new Set([shows[0].opIndex])), false);
});

test('deleting is allowed when the next text repositions itself', () => {
  const ops = operations(tokenize(bytesOf('BT (one) Tj 0 -14 Td (two) Tj ET')));
  const shows = showOperations(ops);
  assert.equal(isSafeToDelete(ops, new Set([shows[0].opIndex])), true);
});

test('deleting a whole line group is allowed', () => {
  const ops = operations(tokenize(bytesOf('BT (one) Tj (two) Tj ET')));
  const shows = showOperations(ops);
  assert.equal(
    isSafeToDelete(ops, new Set([shows[0].opIndex, shows[1].opIndex])),
    true
  );
});

test('removeRanges cuts exactly the requested bytes', () => {
  const out = removeRanges(bytesOf('AAA BBB CCC'), [{ start: 4, end: 7 }]);
  assert.equal(textOf(out).replace(/\n/g, ''), 'AAA  CCC');
});

/* ------------------------------- alignment ------------------------------- */

const show = (text) => ({ text });

test('alignment succeeds when the sequences correspond', () => {
  const result = alignOpsToItems([show('Hello'), show('world')], [{ str: 'Hello' }, { str: 'world' }]);
  assert.equal(result.aligned, true);
  assert.equal(result.confidence, 1);
  assert.equal(result.showForItem.get(1), 1);
});

test('alignment maps around items the reader reports as blank', () => {
  const result = alignOpsToItems(
    [show('Hello'), show('world')],
    [{ str: 'Hello' }, { str: '  ' }, { str: 'world' }]
  );
  assert.equal(result.aligned, true);
  assert.equal(result.showForItem.get(2), 1, 'the third item is the second operation');
});

test('alignment fails when the counts differ (text hidden in an XObject)', () => {
  const result = alignOpsToItems([show('Hello')], [{ str: 'Hello' }, { str: 'extra' }]);
  assert.equal(result.aligned, false);
});

test('alignment fails for glyph-index operands (a CID font)', () => {
  const result = alignOpsToItems([show('')], [{ str: 'abc' }]);
  assert.equal(result.aligned, false);
  assert.equal(result.confidence, 0);
});

test('a fingerprint changes when the text does', () => {
  assert.notEqual(fingerprint([show('a'), show('b')]), fingerprint([show('a'), show('c')]));
  assert.equal(fingerprint([show('a')]), fingerprint([show('a')]));
});

/* ------------------------------ the real thing --------------------------- */

async function threeLinePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  ['Keep this line', 'DELETE this line', 'Keep this too'].forEach((t, i) =>
    page.drawText(t, { x: 40, y: 250 - i * 30, size: 12, font, color: rgb(0, 0, 0) })
  );
  return doc.save();
}

async function readText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
  const doc = await task.promise;
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  const out = items.map((i) => i.str);
  await task.destroy();
  return out;
}

test('a line is genuinely removed from the file, not covered', async () => {
  const bytes = await threeLinePdf();
  const items = (await readText(bytes)).map((str) => ({ str }));

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(0);
  const content = readPageContent(doc, page);
  assert.ok(content && content.length > 0);

  const target = items.findIndex((i) => /DELETE/.test(i.str));
  const plan = planDeletion(content, items, [target]);
  assert.equal(plan.ok, true, plan.reason);

  const applied = applyDeletion(content, plan.ordinals, plan.fingerprint);
  assert.equal(applied.ok, true, applied.reason);
  writePageContent(doc, page, applied.bytes);

  const after = await readText(await doc.save());
  assert.deepEqual(
    after.map((s) => s.trim()).filter(Boolean),
    ['Keep this line', 'Keep this too']
  );
});

test('a stale plan is refused rather than applied to the wrong operations', async () => {
  const bytes = await threeLinePdf();
  const items = (await readText(bytes)).map((str) => ({ str }));
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const content = readPageContent(doc, doc.getPage(0));

  const plan = planDeletion(content, items, [1]);
  const result = applyDeletion(content, plan.ordinals, 'not-the-right-fingerprint');
  assert.equal(result.ok, false);
  assert.match(result.reason, /changed/);
});

test('an ordinal past the end of the stream is refused', async () => {
  const bytes = await threeLinePdf();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const content = readPageContent(doc, doc.getPage(0));
  const result = applyDeletion(content, [99], '');
  assert.equal(result.ok, false);
});

test('planning fails cleanly when the reader and the stream disagree', () => {
  const stream = bytesOf('BT (only one) Tj ET');
  const plan = planDeletion(stream, [{ str: 'only one' }, { str: 'phantom' }], [0]);
  assert.equal(plan.ok, false);
  assert.ok(plan.reason);
});

test('the rest of the page survives the surgery', async () => {
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.Helvetica);
  const page = src.addPage([400, 300]);
  page.drawRectangle({ x: 10, y: 10, width: 80, height: 40, color: rgb(1, 0, 0) });
  page.drawText('gone', { x: 40, y: 250, size: 12, font });
  page.drawRectangle({ x: 200, y: 10, width: 80, height: 40, color: rgb(0, 0, 1) });
  const bytes = await src.save();

  const items = (await readText(bytes)).map((str) => ({ str }));
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const p = doc.getPage(0);
  const content = readPageContent(doc, p);
  const plan = planDeletion(content, items, [0]);
  assert.equal(plan.ok, true, plan.reason);
  const applied = applyDeletion(content, plan.ordinals, plan.fingerprint);
  writePageContent(doc, p, applied.bytes);

  const after = textOf(applied.bytes);
  assert.equal((await readText(await doc.save())).join('').trim(), '');
  // Both rectangles are still drawn.
  assert.equal((after.match(/ re|l\n/g) || []).length > 0 || after.includes('f'), true);
  assert.match(after, /1 0 0 rg/);
  assert.match(after, /0 0 1 rg/);
});
