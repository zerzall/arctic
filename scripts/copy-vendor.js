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
];

// Directories pdf.js needs at runtime for CJK documents and for PDFs that rely
// on the 14 standard fonts without embedding them.
const DIRS = [
  ['pdfjs-dist/cmaps', 'cmaps'],
  ['pdfjs-dist/standard_fonts', 'standard_fonts'],
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
    fs.copyFileSync(resolveDep(src), path.join(vendor, dest));
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
    JSON.stringify({ 'pdfjs-dist': pkg('pdfjs-dist'), 'pdf-lib': pkg('pdf-lib') }, null, 2)
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
