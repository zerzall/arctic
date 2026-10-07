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
//
// The baked texture library (public/textures/, scripts/bake-textures.js) goes in too: its manifest
// as a JSON script element and every PNG as base64 in a script element of its own, placed after the
// game's code. The browser parses them as raw text (nothing runs), the menu is up while the rest of
// the file is still being read, and render3d/world-surf-bake.js turns one element at a time into a
// Blob (a data: URL fetch, no giant string built in script) through window.__HH_TEX, then drops the
// element's text. HH_NO_TEXTURES=1 builds without them (the game then keeps the procedural layers).

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
// (HH_ONEFILE_OUT and HH_TEX_DIR override the output file and the texture library: the tests use them)
const OUT = process.env.HH_ONEFILE_OUT ? resolve(process.env.HH_ONEFILE_OUT) : join(ROOT, 'dist', 'Highway-Horde.html');

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
// the texture library's store: script elements holding the manifest and every PNG (see above)
const TEX_DIR = process.env.HH_TEX_DIR ? resolve(process.env.HH_TEX_DIR) : join(PUB, 'textures');
const texOn = !process.env.HH_NO_TEXTURES && existsSync(join(TEX_DIR, 'manifest.json'));
const texManifest = texOn ? JSON.parse(readFileSync(join(TEX_DIR, 'manifest.json'), 'utf8')) : null;
const texFiles = texManifest ? Object.values(texManifest.sets).flatMap((e) => Object.values(e.files)) : [];
export const TEX_STORE = `window.__HH_TEX = (function () {
  var cache = {};
  function ready() {
    return document.readyState !== 'loading' ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r, { once: true }); });
  }
  return {
    manifest: function () {
      return ready().then(function () { var e = document.getElementById('hh-tex-manifest'); return e ? JSON.parse(e.textContent) : null; });
    },
    blob: function (p) {
      if (cache[p]) return cache[p];
      cache[p] = ready().then(function () {
        var e = document.querySelector('script[data-hh-tex="' + p + '"]');
        if (!e) throw new Error('textures: ' + p + ' is not in this file');
        return fetch('data:image/png;base64,' + e.textContent).then(function (r) { return r.blob(); }).then(function (b) { e.textContent = ''; return b; });
      });
      cache[p].catch(function () { delete cache[p]; });
      return cache[p];
    }
  };
})();`;
const scripts = [
  'window.__HH_ONEFILE = true;',
  ...(texOn ? [TEX_STORE] : []),
  readFileSync(join(PUB, 'vendor/peerjs.min.js'), 'utf8'),
  readFileSync(join(PUB, 'config.js'), 'utf8'),
  res.outputFiles[0].text,
];

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
// (written in pieces: the textures are streamed in after the page, one element per file, never one
// string of the whole thing)
const tail = '</body>';
const at = html.lastIndexOf(tail);
const fd = openSync(OUT, 'w');
let bytes = 0;
const put = (str) => { const b = Buffer.from(str, 'utf8'); writeSync(fd, b); bytes += b.length; };
put(html.slice(0, at));
if (texOn) {
  put(`<script type="application/json" id="hh-tex-manifest">${JSON.stringify(texManifest).replace(/<\//g, '<\\/')}</script>\n`);
  for (const f of texFiles) {
    const b64 = readFileSync(join(TEX_DIR, f)).toString('base64');
    put(`<script type="application/x-hh-tex" data-hh-tex="${f}">`);
    put(b64);
    put('</script>\n');
  }
}
put(html.slice(at));
closeSync(fd);
console.log(`wrote ${OUT} (${(bytes / 1e6).toFixed(1)} MB${texOn ? `, ${texFiles.length} texture files embedded` : ''})`);
