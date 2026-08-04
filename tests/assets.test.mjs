/**
 * Tests for the side assets pdf.js needs at runtime.
 *
 * These exist because of a real bug: the WebAssembly image codecs were never
 * vendored, so every scanned PDF - anything out of a copier, which is a large
 * share of real documents - opened to a completely blank page while reporting
 * no error at all. Nothing else in the suite would have caught it, because the
 * failure is in an asset path rather than in any code.
 *
 * They deliberately check the wiring rather than decoding: Node's fetch cannot
 * read file:// URLs, so the codecs themselves can only be exercised in the app.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ASSET_URLS, WORKER_URL, documentOptions } from '../src/renderer/js/pdfjsopts.js';

const vendorPath = (url) => fileURLToPath(url);

/* ------------------------------ the assets ------------------------------- */

test('the pdf.js worker is vendored', () => {
  assert.ok(existsSync(vendorPath(WORKER_URL)), 'pdf.worker.min.mjs is missing');
});

test('the WebAssembly image codecs are vendored', () => {
  // jbig2 also carries the CCITT fax decoder, which is what scanners emit.
  for (const file of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm']) {
    const path = vendorPath(ASSET_URLS.wasmUrl + file);
    assert.ok(existsSync(path), `${file} is missing - scanned PDFs would render blank`);
    assert.ok(statSync(path).size > 1000, `${file} looks truncated`);
  }
});

test('the no-WebAssembly fallbacks are vendored too', () => {
  for (const file of ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) {
    assert.ok(existsSync(vendorPath(ASSET_URLS.wasmUrl + file)), `${file} is missing`);
  }
});

test('the character maps and standard fonts are vendored', () => {
  assert.ok(existsSync(vendorPath(ASSET_URLS.cMapUrl + '78-EUC-H.bcmap')), 'cmaps are missing');
  assert.ok(
    existsSync(vendorPath(ASSET_URLS.standardFontDataUrl + 'FoxitFixed.pfb')),
    'standard fonts are missing'
  );
});

/* ------------------------------ the wiring ------------------------------- */

test('every asset URL is passed to pdf.js when a document is opened', () => {
  const opts = documentOptions(new Uint8Array([1, 2, 3]));
  for (const key of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl']) {
    assert.ok(opts[key], `${key} is not passed to getDocument`);
    assert.match(opts[key], /\/vendor\//, `${key} does not point at the vendored assets`);
  }
  assert.equal(opts.cMapPacked, true);
});

test('directory URLs keep the trailing slash pdf.js concatenates onto', () => {
  for (const key of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl']) {
    assert.match(ASSET_URLS[key], /\/$/, `${key} must end with a slash`);
  }
});

test('the password and data are passed through', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const opts = documentOptions(bytes, 'hunter2');
  assert.equal(opts.data, bytes);
  assert.equal(opts.password, 'hunter2');
  assert.equal(opts.isEvalSupported, false);
});

/* ---------------------------- shipped in the app -------------------------- */

test('the packaged build includes the vendored assets', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const files = pkg.build.files;
  assert.ok(files.includes('src/**/*'), 'the renderer tree must be packaged');
  // Only source maps are excluded; an exclusion broad enough to drop .wasm
  // would put the blank-page bug straight back.
  for (const rule of files.filter((f) => f.startsWith('!'))) {
    assert.ok(/\.map$/.test(rule), `unexpected exclusion "${rule}" could drop runtime assets`);
  }
});

test('the app serves .wasm with the MIME type WebAssembly requires', () => {
  const main = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
  assert.match(main, /'\.wasm':\s*'application\/wasm'/);
});
