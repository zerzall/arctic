#!/usr/bin/env node
// Builds download/blast-party.html: the whole game as ONE self-contained file that opens by double-click (file://), no server.
//
//   npm run build:single                 -> download/blast-party.html
//   node scripts/build-single.mjs --out /some/where.html [--no-minify] [--readable]
//
// What goes in (all inline; the file makes no request of any kind):
//   * client/index.html as the page skeleton, without the manifest / apple-touch / stylesheet / script links,
//   * client/css/style.css, minified, in one <style>,
//   * a classic <script>window.__BP_SINGLE__=true</script> (main.js and ui.js read it: the title screen offers Practice / Host / Join
//     instead of Create / Join-by-room-code, and net-facing code skips everything that needs a server),
//   * boot.js and legacy.js as they are (classic ES5 scripts; legacy.js stays behind `nomodule`, boot.js keeps its watchdog),
//   * client/js/main.js bundled with esbuild into one IIFE. shared/room.js (Practice and hosting) and client/js/p2p.js are reached through
//     dynamic import() in the source; esbuild turns those into lazy initialisers inside the same file, so they only run when needed,
//   * a 32 px favicon as a data: URI.
// A Content-Security-Policy <meta> pins that down: no network, no eval, workers only from blob:.
//
// Exports buildSingle() for specs/unit/single-file.spec.js.

import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_OUT = join(ROOT, 'download', 'blast-party.html');

const readAt = (root, rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n?/g, '\n');       // (a CRLF checkout must build the same bytes)

// Everything the page may do, and nothing else. `blob:` is the ticker worker (p2p.js); `data:` is the favicon and CSS images.
// script-src lists the hash of each inline script (see cspFor): an injected <script> or onerror= handler would not run.
export const cspFor = (scriptHashes) => `default-src 'none'; script-src ${scriptHashes.map((h) => `'sha256-${h}'`).join(' ')}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; `
  + "worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const sha256Base64 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');

/** Text between `<script>` tags must never contain `</script` or `<!--` (it would end the element early or start a comment). */
export function inertScript(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

function replaceOnce(html, pattern, replacement, what) {
  if (!pattern.test(html)) throw new Error(`build-single: client/index.html no longer contains ${what}; update scripts/build-single.mjs`);
  return html.replace(pattern, () => replacement);
}

/**
 * @param {{ out?: string, minify?: boolean, keepNames?: boolean, root?: string }} [opts] root: the project folder to build from (the specs use a CRLF copy); keepNames: leave identifiers readable (13 % bigger raw, 8 % gzipped)
 * @returns {Promise<{ out: string, bytes: number, gzip: number, parts: Record<string, number> }>}
 */
export async function buildSingle({ out = DEFAULT_OUT, minify = true, keepNames = false, root = ROOT } = {}) {
  const read = (rel) => readAt(root, rel);
  let html = read('client/index.html');

  // ---- The page skeleton: drop every link that would need a server or a manifest.
  html = replaceOnce(html, /<link rel="manifest"[^>]*>\s*/, '', 'the manifest link');
  html = replaceOnce(html, /<link rel="apple-touch-icon"[^>]*>\s*/, '', 'the apple-touch-icon link');
  html = replaceOnce(html, /<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" href="data:image/png;base64,${readFileSync(join(root, 'client/icons/favicon-32.png')).toString('base64')}">`, 'the icon link');
  html = replaceOnce(html, /<meta name="description" content="[^"]*">/, '<meta name="description" content="Blast Party: a bomb-dropping battle for 2 to 8 players. This single file plays offline against bots, and with friends over a direct connection.">', 'the description meta');
  html = replaceOnce(html, /<meta property="og:description" content="[^"]*">/, '', 'the og:description meta');
  html = replaceOnce(html, /<meta charset="utf-8">/, `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="__CSP__">`, 'the charset meta');

  // ---- CSS
  const cssSource = read('client/css/style.css');
  const css = minify ? (await transform(cssSource, { loader: 'css', minify: true, legalComments: 'none' })).code : cssSource;
  html = replaceOnce(html, /<link rel="stylesheet" href="\/css\/style\.css">/, `<style>\n${css.trim()}\n</style>`, 'the stylesheet link');

  // ---- Scripts
  const bundle = await build({
    entryPoints: [join(root, 'client/js/main.js')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2020', 'chrome90', 'firefox100', 'safari16'],
    minifyWhitespace: minify,
    minifySyntax: minify,
    minifyIdentifiers: minify && !keepNames,
    keepNames: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const bundled = inertScript(bundle.outputFiles[0].text).trim();
  const boot = inertScript(read('client/js/boot.js')).trim();
  const legacy = inertScript(read('client/js/legacy.js')).trim();

  const inline = ['window.__BP_SINGLE__=true', `\n${boot}\n`, `\n${bundled}\n`, `\n${legacy}\n`];        // (the exact text between the tags is what the CSP hashes)
  const scripts = `<script>${inline[0]}</script>\n<script>${inline[1]}</script>\n<script>${inline[2]}</script>\n<script nomodule>${inline[3]}</script>`;
  const tags = /<script src="\/js\/boot\.js"><\/script>\s*<script type="module" src="\/js\/main\.js"><\/script>\s*<script nomodule src="\/js\/legacy\.js"><\/script>/;
  html = replaceOnce(html, tags, scripts, 'the three script tags');

  html = replaceOnce(html, /__CSP__/, cspFor(inline.map(sha256Base64)), 'the CSP placeholder');
  const bare = inline.reduce((text, body) => text.replace(body, ''), html);          // (the page without the four known bodies: nothing else may be a script)
  if ((bare.match(/<script\b/g) ?? []).length !== inline.length) throw new Error('build-single: a script the CSP hashes do not cover');

  const outFile = resolve(out);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  const bytes = Buffer.byteLength(html);
  return {
    out: outFile,
    bytes,
    gzip: gzipSync(html, { level: 9 }).length,
    parts: { html: bytes - Buffer.byteLength(css) - Buffer.byteLength(bundled) - Buffer.byteLength(boot) - Buffer.byteLength(legacy), css: Buffer.byteLength(css), js: Buffer.byteLength(bundled), boot: Buffer.byteLength(boot) + Buffer.byteLength(legacy) },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const started = Date.now();
  const res = await buildSingle({ out: at >= 0 ? args[at + 1] : DEFAULT_OUT, minify: !args.includes('--no-minify'), keepNames: args.includes('--readable') });
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`${res.out}\n  ${kb(res.bytes)} (${kb(res.gzip)} gzipped) in ${Date.now() - started} ms; html ${kb(res.parts.html)}, css ${kb(res.parts.css)}, js ${kb(res.parts.js)}, boot ${kb(res.parts.boot)}`);
}
