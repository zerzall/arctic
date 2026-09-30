import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { buildSingle, cspFor, sha256Base64, inertScript, DEFAULT_OUT } from '../../scripts/build-single.mjs';

// The single-file download (scripts/build-single.mjs): built into a temp folder by the real script, then read as text.
// "No external URL" is checked on the whole file, so the only http(s) strings allowed are XML namespace identifiers, which the browser
// never fetches, and an example address in the localhost hint that ui.js prints (also a plain string).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SIZE_CEILING = 520 * 1024;
const GZIP_CEILING = 175 * 1024;
const INERT_URLS = new Set([
  'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/2000/xmlns/', 'http://www.w3.org/1999/xhtml',
]);

let dir;
let html;
let files;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'bp-single-'));
  const out = join(dir, 'nested', 'blast-party.html');
  const stdout = execFileSync(process.execPath, [join(ROOT, 'scripts/build-single.mjs'), '--out', out], { encoding: 'utf8', timeout: 60000 });
  assert.match(stdout, /blast-party\.html/);
  files = readdirSync(join(dir, 'nested'));
  html = readFileSync(out, 'utf8');
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** The inline scripts in document order: [{ attrs, code }]. */
const scriptsOf = (text) => [...text.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1].trim(), code: m[2] }));

describe('single file: what the build produces', () => {
  it('is exactly one file', () => {
    assert.deepEqual(files, ['blast-party.html']);
  });

  it('is a complete HTML document with the game skeleton', () => {
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>Blast Party<\/title>/);
    for (const id of ['app', 'game', 'arena', 'hud', 'touch', 'overlays', 'sr-live', 'boot']) assert.ok(html.includes(`id="${id}"`), `#${id}`);
  });

  it('stays under the size ceilings', () => {
    assert.ok(Buffer.byteLength(html) < SIZE_CEILING, `${Buffer.byteLength(html)} bytes`);
    assert.ok(gzipSync(html, { level: 9 }).length < GZIP_CEILING);
  });

  it('has no <script src>, no <link> that points anywhere but a data: URI, no manifest, no apple-touch icon, no @import', () => {
    assert.ok(!/<script[^>]*\ssrc\s*=/i.test(html), '<script src>');
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    for (const link of links) {
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(link)?.[1] ?? '';
      assert.ok(href.startsWith('data:'), `link with href ${href.slice(0, 40)}`);
      assert.ok(!/manifest|apple-touch|stylesheet/i.test(link), link.slice(0, 80));
    }
    assert.equal(links.length, 1, 'only the data: URI favicon');
    assert.match(links[0], /rel="icon"[^>]*href="data:image\/png;base64,/);
    assert.ok(!/@import/i.test(html));
    assert.ok(!/type="module"/i.test(html), 'no module scripts');
    assert.ok(!/<(?:img|iframe|video|audio|source|object|embed)\b[^>]*\ssrc\s*=\s*"(?!data:)/i.test(html));
  });

  it('contains no external URL of any kind', () => {
    const found = [...html.matchAll(/(?:https?|wss?|ftp):\/\/[^\s"'`<>)\\]*/gi)].map((m) => m[0]);
    const bad = found.filter((u) => !INERT_URLS.has(u.replace(/\/$/, '')) && !/^http:\/\/192\.168\.x\.x/.test(u));
    assert.deepEqual(bad, []);
    assert.ok(!/\burl\(\s*["']?(?!data:|#)/i.test(html), 'a CSS url() that is not a data: URI or a fragment');
    assert.ok(!/["'(=]\s*\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(html.replace(/\/\/[^\n]*/g, '')), 'a protocol-relative URL');
  });

  it('sets __BP_SINGLE__ in an inline classic script BEFORE everything else, then boot.js, the bundle, and legacy.js behind nomodule', () => {
    const scripts = scriptsOf(html);
    assert.equal(scripts.length, 4);
    assert.equal(scripts[0].attrs, '');
    assert.equal(scripts[0].code, 'window.__BP_SINGLE__=true');
    assert.match(scripts[1].code, /__bpReady/);
    assert.match(scripts[1].code, /WATCHDOG_MS = 8000/);
    assert.equal(scripts[2].attrs, '');
    assert.match(scripts[2].code, /__bpReady\s*=\s*!?0|__bpReady\s*=\s*true/);
    assert.equal(scripts[3].attrs, 'nomodule');
    assert.match(scripts[3].code, /could not start/);
    assert.ok(html.indexOf('__BP_SINGLE__=true') < html.indexOf('<style>') || html.indexOf('__BP_SINGLE__=true') < html.indexOf(scripts[1].code));
  });

  it('every inline script parses as a classic script (so it runs from file:// with no module loader)', () => {
    for (const { code } of scriptsOf(html)) new Script(code);
  });

  it('bundles the lazy parts: Room (Practice and hosting), p2p.js, the STUN servers, the code prefix; and no real dynamic import() is left', () => {
    const bundle = scriptsOf(html)[2].code;
    assert.ok(bundle.includes('stun:stun.l.google.com:19302') && bundle.includes('stun:stun.cloudflare.com:3478'));
    assert.ok(bundle.includes('BP1-'));
    assert.ok(bundle.includes('room_open'), 'shared/room.js is in the file');
    assert.ok(bundle.includes('practice mode failed to load'));
    assert.ok(!/(?<![\w$.])import\s*\(/.test(bundle), 'a dynamic import() would need a second file');
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(bundle), 'no eval: the CSP forbids it');
  });

  it('pins the page down with a Content-Security-Policy: no network, no eval, only the four known inline scripts, workers only from blob:', () => {
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
    assert.ok(meta, 'CSP meta');
    const CSP = meta[1];
    const hashes = scriptsOf(html).map((s) => sha256Base64(s.code));
    assert.equal(hashes.length, 4);
    assert.equal(CSP, cspFor(hashes), 'script-src carries the hash of each inline script, so an injected script would not run');
    const scriptSrc = /script-src ([^;]*)/.exec(CSP)[1];
    assert.ok(!/unsafe-inline/.test(scriptSrc), 'no blanket permission for inline scripts');
    assert.match(CSP, /default-src 'none'/);
    assert.match(CSP, /connect-src 'none'/);
    assert.match(CSP, /worker-src blob:/);
    assert.ok(!/unsafe-eval/.test(CSP));
    assert.ok(!/https?:/.test(CSP));
  });

  it('builds the same bytes from a CRLF checkout (line endings are normalised on read)', async () => {
    const copy = join(dir, 'crlf');
    for (const sub of ['client', 'shared']) {
      cpSync(join(ROOT, sub), join(copy, sub), { recursive: true });
    }
    const crlf = (folder) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) crlf(path);
        else if (/\.(?:js|css|html)$/.test(entry.name)) writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
      }
    };
    crlf(copy);
    const out = join(dir, 'crlf-out.html');
    await buildSingle({ out, root: copy });
    assert.equal(readFileSync(out, 'utf8'), html);
  });

  it('inlines the stylesheet and does not leave the served-build paths behind', () => {
    assert.match(html, /<style>[\s\S]{20000,}<\/style>/);
    for (const ref of ['/css/style.css', '/js/main.js', '/js/boot.js', '/js/legacy.js', '/manifest.webmanifest', '/icons/']) assert.ok(!html.includes(ref), ref);
  });

  it('keeps <noscript> and the boot watchdog element', () => {
    assert.match(html, /<div id="boot" role="status">Loading Blast Party\.\.\.<\/div>/);
    assert.match(html, /<noscript>/);
  });

  it('inertScript makes script text safe to inline', () => {
    assert.equal(inertScript('a</script>b</SCRIPT>c<!--d'), 'a<\\/script>b<\\/SCRIPT>c<\\!--d');
    for (const { code } of scriptsOf(html)) assert.ok(!/<\/script/i.test(code) && !code.includes('<!--'));
  });
});

describe('single file: the committed download is current', () => {
  it('download/blast-party.html equals a fresh build of the sources (run `npm run build:single` when this fails)', () => {
    assert.ok(existsSync(DEFAULT_OUT), 'download/blast-party.html is missing: run `npm run build:single`');
    assert.equal(readFileSync(DEFAULT_OUT, 'utf8') === html, true, 'download/blast-party.html is stale: run `npm run build:single`');
  });
});
