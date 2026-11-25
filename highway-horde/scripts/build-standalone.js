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
// Every texture file goes in too (public/textures/: the world library, the guns, the zombies, the
// decals), as its download copy (scripts/compress-textures.js: compressed.json lists them; a PNG
// whose copy is stale or missing goes in itself) in a script element of its own, placed after the
// game's code, plus the library's manifest and the copies' index as JSON elements. The browser
// parses them as raw text (nothing runs, no script heap): the menu is up while the rest of the file
// is still being read, and render3d/tex-files.js turns one element at a time into a Blob (a data:
// URL fetch, no giant string built in script) through window.__HH_TEX, then drops the element's
// text. HH_NO_TEXTURES=1 builds without them (the game then keeps the procedural layers).

import { build } from 'esbuild';
import { readFileSync, mkdirSync, readdirSync, existsSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
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
// the texture files' store: script elements holding the manifest, the index and every file (see above)
const TEX_DIR = process.env.HH_TEX_DIR ? resolve(process.env.HH_TEX_DIR) : join(PUB, 'textures');
const texOn = !process.env.HH_NO_TEXTURES && existsSync(TEX_DIR);
const texManifest = texOn && existsSync(join(TEX_DIR, 'manifest.json')) ? JSON.parse(readFileSync(join(TEX_DIR, 'manifest.json'), 'utf8')) : null;

/** Every PNG under the texture folder ('set/albedo.png'). */
function listPNGs(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listPNGs(p, base));
    else if (name.endsWith('.png')) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}
/**
 * What goes in: the copies of every PNG whose entry in compressed.json is fresh (its SHA-1 matches,
 * its files are there), else the PNG; and the index of the copies that went in.
 */
function texturePlan() {
  const ixPath = join(TEX_DIR, 'compressed.json');
  const ix = existsSync(ixPath) ? JSON.parse(readFileSync(ixPath, 'utf8')) : { files: {} };
  const files = [], index = { version: ix.version || 1, files: {} };
  const stale = [];
  for (const rel of listPNGs(TEX_DIR)) {
    const e = ix.files && ix.files[rel];
    const all = e ? [e.file, ...(e.variants || []).map((v) => v.file)] : [];
    const fresh = e && all.every((f) => existsSync(join(TEX_DIR, f))) && createHash('sha1').update(readFileSync(join(TEX_DIR, rel))).digest('hex') === e.sha1;
    if (fresh) {
      files.push(...all);
      index.files[rel] = { file: e.file, ...(e.la ? { la: true } : {}), ...(e.variants ? { variants: e.variants.map((v) => ({ size: v.size, file: v.file })) } : {}) };
    } else {
      files.push(rel);
      if (e) stale.push(rel);
    }
  }
  if (stale.length) console.warn(`textures: ${stale.length} download copies are stale (${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ', …' : ''}): their PNGs go in instead — run npm run textures:compress`);
  return { files, index };
}
const texPlan = texOn ? texturePlan() : null;
const MIME_OF = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
export const TEX_STORE = `window.__HH_TEX = (function () {
  var cache = {};
  function ready() {
    return document.readyState !== 'loading' ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r, { once: true }); });
  }
  function json(id) {
    return ready().then(function () { var e = document.getElementById(id); return e ? JSON.parse(e.textContent) : null; });
  }
  return {
    manifest: function () { return json('hh-tex-manifest'); },
    index: function () { return json('hh-tex-index'); },
    take: function (p) {
      if (document.readyState === 'loading') return null;
      var e = document.querySelector('script[data-hh-tex="' + p + '"]');
      if (!e || !e.textContent) return null;
      var t = { b64: e.textContent, type: e.getAttribute('data-type') };
      if (!cache[p]) {
        cache[p] = fetch('data:' + t.type + ';base64,' + t.b64).then(function (r) { return r.blob(); });
        cache[p].catch(function () { delete cache[p]; });
      }
      e.textContent = '';
      return t;
    },
    blob: function (p) {
      if (cache[p]) return cache[p];
      cache[p] = ready().then(function () {
        var e = document.querySelector('script[data-hh-tex="' + p + '"]');
        if (!e) throw new Error('textures: ' + p + ' is not in this file');
        return fetch('data:' + e.getAttribute('data-type') + ';base64,' + e.textContent).then(function (r) { return r.blob(); }).then(function (b) { e.textContent = ''; return b; });
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
let texBytes = 0;
if (texOn) {
  const json = (id, o) => put(`<script type="application/json" id="${id}">${JSON.stringify(o).replace(/<\//g, '<\\/')}</script>\n`);
  if (texManifest) json('hh-tex-manifest', texManifest);
  json('hh-tex-index', texPlan.index);
  for (const f of texPlan.files) {
    const buf = readFileSync(join(TEX_DIR, f));
    texBytes += buf.length;
    put(`<script type="application/x-hh-tex" data-hh-tex="${f}" data-type="${MIME_OF[f.split('.').pop()] || 'application/octet-stream'}">`);
    put(buf.toString('base64'));
    put('</script>\n');
  }
}
put(html.slice(at));
closeSync(fd);
console.log(`wrote ${OUT} (${(bytes / 1e6).toFixed(1)} MB${texOn ? `, ${texPlan.files.length} texture files embedded: ${(texBytes / 1e6).toFixed(1)} MB` : ''})`);
