#!/usr/bin/env node
// Builds the whole game into ONE html file: `npm run standalone` → dist/Highway-Horde.html.
//
// Browsers refuse to load module scripts from a page opened straight off the disk
// (file://), so a downloaded copy of public/ shows the menu with dead buttons. This file
// inlines everything instead (CSS, PeerJS, config.js and every game module plus three.js,
// bundled into one classic script), so it runs on a double-click, with no server.
//
// What still differs from the hosted game: invite links point at the file on your own
// disk, so friends join with the room code; and the audio bake worker (a separate module
// file) is unavailable, so the sounds bake on the main thread (bank.js falls back itself).

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const OUT = join(ROOT, 'dist', 'Highway-Horde.html');

// index.html's import map, for esbuild.
const importMap = {
  name: 'import-map',
  setup(b) {
    b.onResolve({ filter: /^three(\/addons\/.*)?$/ }, (args) => ({
      path: args.path === 'three'
        ? join(PUB, 'vendor/three/three.module.js')
        : join(PUB, 'vendor/three', args.path.slice('three/'.length)),
    }));
  },
};

const res = await build({
  entryPoints: [join(PUB, 'js/ui/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  write: false,
  plugins: [importMap],
  logOverride: { 'empty-import-meta': 'silent' },
});

// Keep "</script" inside the code from closing the inline <script> element.
const inline = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

let html = readFileSync(join(PUB, 'index.html'), 'utf8');
const css = readFileSync(join(PUB, 'css/game.css'), 'utf8') + '\n' + readFileSync(join(PUB, 'css/story.css'), 'utf8');
const scripts = [
  'window.__HH_ONEFILE = true;',
  readFileSync(join(PUB, 'vendor/peerjs.min.js'), 'utf8'),
  readFileSync(join(PUB, 'config.js'), 'utf8'),
  res.outputFiles[0].text,
];

// ---- embedded asset files (the decal sheets) ----------------------------------------------
// Files under public/<dir> become data: URLs in window.__HH_FILES['<dir>/<name>'], which the
// renderer reads before it would fetch the file next to the game (render3d/decals.js decalFileURL).
function embedFiles(dir, pattern) {
  const files = {};
  let bytes = 0;
  for (const name of readdirSync(join(PUB, dir)).sort()) {
    if (!pattern.test(name)) continue;
    const buf = readFileSync(join(PUB, dir, name));
    bytes += buf.length;
    files[`${dir}/${name}`] = `data:image/png;base64,${buf.toString('base64')}`;
  }
  console.log(`embedding ${Object.keys(files).length} files of ${dir} (${(bytes / 1e6).toFixed(1)} MB)`);
  return `window.__HH_FILES = Object.assign(window.__HH_FILES || {}, ${JSON.stringify(files)});`;
}
scripts.splice(1, 0, embedFiles('textures/decals', /\.png$/));

const swap = (from, to) => {
  if (!from.test(html)) throw new Error(`index.html no longer contains ${from}`);
  html = html.replace(from, () => to);
};
swap(/<link rel="stylesheet" href="css\/game\.css">\s*<link rel="stylesheet" href="css\/story\.css">/, `<style>\n${css.replace(/<\/(style)/gi, '<\\/$1')}\n</style>`);
swap(/\s*<!--[^>]*three\.js[^>]*-->\s*<script type="importmap">[\s\S]*?<\/script>/, '');
swap(/\s*<script src="vendor\/peerjs\.min\.js" defer><\/script>/, '');
swap(/\s*<script src="config\.js" defer><\/script>/, '');
swap(/\s*<script type="module" src="js\/ui\/main\.js"><\/script>/, '');
// Classic scripts at the end of <body>: the DOM is parsed by then, as with the deferred
// originals, and they run in the same order.
swap(/<\/body>/, `${scripts.map((s) => `<script>\n${inline(s)}\n</script>`).join('\n')}\n</body>`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1e6).toFixed(1)} MB)`);
