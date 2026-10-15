#!/usr/bin/env node
/**
 * Copies the browser builds of pdf.js and pdf-lib out of node_modules and into
 * src/renderer/vendor so the renderer (and the packaged asar) can load them with
 * stable relative paths and no bundler.
 *
 * Runs on `npm install` (postinstall) and before every build.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'src', 'renderer', 'vendor');

const FILES = [
  ['pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib.esm.min.js'],

  // OCR. Tesseract normally fetches its engine and language data from a CDN;
  // everything it needs is vendored instead so recognition works with no
  // network at all, which is the whole point of a desktop editor.
  ['tesseract.js/dist/tesseract.esm.min.js', 'tesseract/tesseract.esm.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  // Only the LSTM engines: that is the one the app asks for, and each of the
  // full builds is another 4.7MB.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/tesseract-core-lstm.wasm.js'],
  [
    'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract/tesseract-core-simd-lstm.wasm.js',
  ],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract/tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  ['@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'tessdata/eng.traineddata.gz'],
];

// Directories pdf.js needs at runtime:
//   cmaps          - CJK documents
//   standard_fonts - PDFs relying on the 14 standard fonts without embedding
//   wasm           - image codecs. Scanned documents are usually CCITT fax or
//                    JBIG2, and pdf.js decodes both in WebAssembly; without
//                    these files every scan renders as a blank page.
const DIRS = [
  ['pdfjs-dist/cmaps', 'cmaps'],
  ['pdfjs-dist/standard_fonts', 'standard_fonts'],
  ['pdfjs-dist/wasm', 'wasm'],
];

function resolveDep(rel) {
  const p = path.join(root, 'node_modules', rel);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Missing ${rel} in node_modules. Run \`npm install\` first.`
    );
  }
  return p;
}

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

function main() {
  fs.mkdirSync(vendor, { recursive: true });

  for (const [src, dest] of FILES) {
    const target = path.join(vendor, dest);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(resolveDep(src), target);
  }
  for (const [src, dest] of DIRS) {
    copyDir(resolveDep(src), path.join(vendor, dest));
  }

  // Record which versions are vendored so the About box can report them.
  const pkg = (name) =>
    JSON.parse(
      fs.readFileSync(
        path.join(root, 'node_modules', name, 'package.json'),
        'utf8'
      )
    ).version;

  fs.writeFileSync(
    path.join(vendor, 'versions.json'),
    JSON.stringify(
      {
        'pdfjs-dist': pkg('pdfjs-dist'),
        'pdf-lib': pkg('pdf-lib'),
        'tesseract.js': pkg('tesseract.js'),
      },
      null,
      2
    )
  );

  console.log('vendor: refreshed src/renderer/vendor');
}

try {
  main();
} catch (err) {
  // Never fail `npm install` outright - the build script re-runs this and will
  // surface the problem at a point where it is actionable.
  console.error('vendor: ' + err.message);
  process.exitCode = process.env.npm_lifecycle_event === 'postinstall' ? 0 : 1;
}
