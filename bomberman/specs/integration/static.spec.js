import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname, posix, relative, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { startServer } from '../../server/index.js';
import { SECURITY_HEADERS } from '../../server/http.js';
import { WsClient } from '../helpers/ws-client.js';

// The real client/ and shared/ trees served by the real server: the invite link works, every asset the page references
// is reachable with the right type, nothing outside the two roots is reachable, and the headers are on.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

let app;
before(async () => { app = await startServer({ port: 0, log: () => {} }); });
after(() => app.close());

// `path` goes on the wire verbatim (fetch() would normalise %2e%2e away).
const get = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: app.port, path, method, headers, agent: false }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});

const filesUnder = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? filesUnder(full) : [full];
});
const urlOf = (file, base) => `/${relative(join(ROOT, base), file).split(sep).join('/')}`;

describe('static: the real trees', () => {
  it('GET /r/KQXZ returns index.html, and every URL it references starts with "/" and is served with the right MIME', async () => {
    const page = await get('/r/KQXZ');
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-type'], MIME['.html']);
    assert.equal(page.body.toString(), readFileSync(join(ROOT, 'client/index.html'), 'utf8'));
    const html = page.body.toString();
    const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"#]*)"/gi)].map((m) => m[1]).filter((u) => u && !/^(?:https?:|data:|mailto:)/.test(u));
    assert.ok(refs.length >= 5, `found ${refs.length} references`);
    const problems = [];
    for (const ref of refs) {
      if (!ref.startsWith('/')) { problems.push(`${ref}: not root-absolute`); continue; }
      const res = await get(ref);
      if (res.status !== 200) problems.push(`${ref}: HTTP ${res.status}`);
      else if (res.headers['content-type'] !== MIME[extname(ref)]) problems.push(`${ref}: ${res.headers['content-type']}`);
    }
    assert.deepEqual(problems, []);
  });

  it('the ES module graph from /js/main.js resolves entirely: every import is served as JavaScript, shared/ modules included', async () => {
    const seen = new Set();
    const problems = [];
    const queue = ['/js/main.js'];
    while (queue.length) {
      const url = queue.pop();
      if (seen.has(url)) continue;
      seen.add(url);
      const res = await get(url, { headers: { 'accept-encoding': 'gzip' } });
      if (res.status !== 200) { problems.push(`${url}: HTTP ${res.status}`); continue; }
      if (res.headers['content-type'] !== MIME['.js']) problems.push(`${url}: ${res.headers['content-type']}`);
      const source = (res.headers['content-encoding'] === 'gzip' ? gunzipSync(res.body) : res.body).toString();
      for (const m of source.matchAll(/(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+[^'"();]*?\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g)) {
        if (!m[2].startsWith('.')) { problems.push(`${url}: non-relative import ${m[2]}`); continue; }
        queue.push(posix.normalize(posix.join(posix.dirname(url), m[2])));
      }
    }
    assert.deepEqual(problems, []);
    assert.ok(seen.has('/shared/world.js') && seen.has('/shared/protocol.js'), 'the isomorphic modules come from /shared/');
  });

  it('every file of client/ and shared/ is served byte for byte (also gzip-decoded) with its MIME type and an ETag', async () => {
    const served = [
      ...filesUnder(join(ROOT, 'client')).map((f) => [f, urlOf(f, 'client')]),
      ...filesUnder(join(ROOT, 'shared')).map((f) => [f, `/shared${urlOf(f, 'shared')}`]),
    ].filter(([f]) => extname(f) in MIME);
    assert.ok(served.length > 20, `${served.length} files`);
    for (const [file, url] of served) {
      const res = await get(url, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(res.status, 200, url);
      assert.equal(res.headers['content-type'], MIME[extname(file)], url);
      assert.match(res.headers.etag, /^W\//, url);
      const body = res.headers['content-encoding'] === 'gzip' ? gunzipSync(res.body) : res.body;
      assert.ok(body.equals(readFileSync(file)), `${url} differs from ${file}`);
    }
  });

  it('CSS url() references are root-absolute and resolvable', async () => {
    const css = await get('/css/style.css');
    assert.equal(css.status, 200);
    const urls = [...css.body.toString().matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
    for (const u of urls) {
      assert.ok(u.startsWith('/'), `${u} is not root-absolute`);
      assert.equal((await get(u)).status, 200, u);
    }
  });

  it('nothing outside client/ and shared/ is reachable: source, config, dependencies, docs, specs, dotfiles, traversal', async () => {
    const forbidden = ['/package.json', '/package-lock.json', '/server/index.js', '/server/http.js', '/docs/SPEC.md', '/specs/unit/room.spec.js', '/node_modules/ws/package.json',
      '/scripts/share.js', '/Dockerfile', '/fly.toml', '/js/../../package.json', '/shared/../package.json'];
    for (const path of forbidden) {
      const res = await get(path);
      assert.ok([400, 404].includes(res.status), `${path} -> ${res.status}`);
      assert.doesNotMatch(res.body.toString(), /arctic-bomberman|startServer|BLAST PARTY/);
    }
    const attempts = ['/../package.json', '/%2e%2e/package.json', '/%2E%2e/%2e%2E/etc/passwd', '/..%2fpackage.json', '/%2e%2e%2fpackage.json', '/js/..%5c..%5cpackage.json',
      '/js\\..\\..\\package.json', '/index.html%00.png', '/%00', '/.git/HEAD', '/.gitignore', '/js/.env', '/shared/%2e%2e/package.json', '/....//package.json', '/%252e%252e/package.json'];
    for (const path of attempts) {
      const res = await get(path);
      assert.ok([400, 404].includes(res.status), `${path} -> ${res.status}`);
      assert.doesNotMatch(res.body.toString(), /arctic-bomberman|root:|\[core\]/);
    }
    assert.equal((await get('/%2e%2e/package.json')).status, 400);
    assert.equal((await get('/.git/HEAD')).status, 400);
  });

  it('methods, HEAD, Range and conditional requests on a real file', async () => {
    const path = '/shared/world.js';
    const full = await get(path);
    const head = await get(path, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-length'], String(full.body.length));
    assert.equal(head.headers.etag, full.headers.etag);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const res = await get(path, { method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.allow, 'GET, HEAD');
    }
    const ranged = await get(path, { headers: { range: 'bytes=0-99' } });
    assert.equal(ranged.status, 200);
    assert.ok(ranged.body.equals(full.body));
    assert.equal(ranged.headers['accept-ranges'], 'none');
    assert.equal((await get(path, { headers: { 'if-none-match': full.headers.etag } })).status, 304);
    assert.equal((await get(path, { method: 'HEAD', headers: { 'if-none-match': full.headers.etag } })).status, 304);
  });

  it('CSP and friends are on every kind of response', async () => {
    const paths = ['/', '/r/ABCD', '/js/main.js', '/shared/world.js', '/healthz', '/api/stats', '/favicon.ico', '/nope', '/r/x', '/api/nope', '/%2e%2e/x'];
    for (const path of paths) {
      const res = await get(path);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers[k.toLowerCase()], v, `${path} ${k}`);
    }
    const csp = (await get('/')).headers['content-security-policy'];
    assert.match(csp, /^default-src 'self'; script-src 'self'; /);
    assert.match(csp, /connect-src 'self' ws: wss:/);
    assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
    assert.equal((await get('/')).headers['strict-transport-security'], undefined);
  });

  it('routes: /healthz, /favicon.ico, /api/stats (no room codes ever), unknown paths are 404 and never index.html', async () => {
    assert.deepEqual([(await get('/healthz')).status, (await get('/healthz')).body.toString()], [200, 'ok']);
    const icon = await get('/favicon.ico');
    assert.deepEqual([icon.status, icon.body.length], [204, 0]);
    const host = await WsClient.create(app.port, 'Mom');
    const res = await get('/api/stats');
    const stats = JSON.parse(res.body);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(stats).sort(), ['conns', 'droppedTicks', 'heapMB', 'humans', 'loopLagMs', 'maxRooms', 'players', 'rooms', 'rssMB', 'tickMs', 'upS', 'v']);
    assert.deepEqual([stats.rooms, stats.players, stats.humans, stats.conns, stats.maxRooms, stats.v], [1, 1, 1, 1, 200, '1.0.0']);
    assert.deepEqual(Object.keys(stats.tickMs), ['avg', 'p99', 'max']);
    assert.ok(stats.loopLagMs.p99 < 45, `an idle event loop reports its lag, not the 50 ms sampling interval (${stats.loopLagMs.p99})`);
    assert.ok(!res.body.toString().includes(host.code));
    host.ws.terminate();
    for (const path of ['/nope', '/r/ab', '/r/ABCDE', '/js/', '/index', '/manifest.json']) {
      const r = await get(path);
      assert.equal(r.status, 404, path);
      assert.doesNotMatch(r.body.toString(), /<html|Blast Party/i);
    }
    const existing = existsSync(join(ROOT, 'client/manifest.webmanifest'));
    assert.equal((await get('/manifest.webmanifest')).status, existing ? 200 : 404);
  });

  it('an oversized request line is refused by the HTTP hardening (431), a normal request afterwards still works', async () => {
    const res = await get(`/${'a'.repeat(9000)}`);
    assert.equal(res.status, 431);
    assert.equal((await get('/healthz')).status, 200);
  });
});
