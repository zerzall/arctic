import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHttpHandler, safePath, SECURITY_HEADERS } from '../../server/http.js';

// A throwaway site: client/ and shared/ trees in a temp dir, served by the real handler on port 0.
const tmp = mkdtempSync(join(tmpdir(), 'bp-http-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const client = join(tmp, 'client');
const shared = join(tmp, 'shared');
const outside = join(tmp, 'outside');
for (const dir of [client, join(client, 'js'), join(client, 'css'), join(client, 'icons'), shared, outside]) mkdirSync(dir, { recursive: true });
const BIG = `${'export const answer = 42; // padding so gzip pays off\n'.repeat(40)}`;
const files = {
  'client/index.html': '<!doctype html><title>Blast Party</title><script type="module" src="/js/main.js"></script>' + ' '.repeat(300),
  'client/js/main.js': BIG,
  'client/js/tiny.js': 'export {};',
  'client/css/style.css': 'body{color:red}\n'.repeat(60),
  'client/manifest.webmanifest': JSON.stringify({ name: 'Blast Party', pad: 'x'.repeat(400) }),
  'client/data.json': JSON.stringify({ a: 'b'.repeat(400) }),
  'client/icons/icon.svg': `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(100)}</svg>`,
  'client/icons/icon-192.png': 'not really a png',
  'client/font.woff2': 'wOF2 pretend font',
  'client/notes.txt': 'not whitelisted',
  'client/.env': 'SECRET=1',
  'client/js/.hidden.js': 'secret',
  'shared/world.js': BIG,
  'shared/data.json': '{}',
  'outside/secret.js': 'export const secret = 1;',
};
for (const [rel, body] of Object.entries(files)) writeFileSync(join(tmp, rel), body);
symlinkSync(join(outside, 'secret.js'), join(client, 'js', 'link.js'));

let draining = false;
const server = http.createServer(createHttpHandler({
  clientRoot: client, sharedRoot: shared, stats: () => ({ v: '1.0.0', rooms: 0 }), isDraining: () => draining,
}));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

// `path` is sent verbatim (http.request(url) would normalise %2e%2e away before it reached the server).
const get = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers, agent: false }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});

/** Sends raw bytes (for request targets http.request would normalise) and returns the first response head + body. */
const raw = (text) => new Promise((resolve, reject) => {
  const socket = net.connect(server.address().port, '127.0.0.1', () => socket.write(text));
  let data = '';
  socket.on('data', (d) => { data += d; });
  socket.on('end', () => resolve(data));
  socket.on('error', reject);
  setTimeout(() => { socket.destroy(); resolve(data); }, 1500).unref();
});

// ---- safePath -------------------------------------------------------------------------------------

test('safePath: decodes, strips the query, and refuses ..  backslashes NUL dot-segments and non-origin-form targets', () => {
  assert.equal(safePath('/js/main.js?v=3#x'), '/js/main.js');
  assert.equal(safePath('/a%20b/c.js'), '/a b/c.js');
  for (const bad of ['/../etc/passwd', '/%2e%2e/etc', '/%2E%2E/etc', '/a/..%2fb', '/a%5cb', '/a\\b', '/a%00b', '/.env', '/js/.hidden', '/.git/config',
    '/./x', '/%2e/x', '/a..b', '/%zz', '/%c0%af', 'http://evil/x', '*', '', 'js/main.js']) {
    assert.equal(safePath(bad), null, bad);
  }
  assert.equal(safePath('/%252e%252e/x'), '/%2e%2e/x', 'double encoding decodes once: it is just an odd file name');
});

// ---- Routing table -----------------------------------------------------------------------------------

test('routes: / and /index.html serve client/index.html; /r/CODE serves the same bytes with no-cache', async () => {
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(index.body.toString(), files['client/index.html']);
  assert.equal((await get('/index.html')).body.toString(), files['client/index.html']);
  for (const path of ['/r/KQXZ', '/r/kqxz', '/r/KQXZ/', '/r/AbCd?x=1']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.body.toString(), files['client/index.html']);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  }
});

test('routes: any other /r/* is 404, and unknown paths never fall back to index.html', async () => {
  for (const path of ['/r/', '/r/ABC', '/r/ABCDE', '/r/AB1D', '/r/ABCD/extra', '/r/ABCD//', '/r/%41%42%43%44x', '/nope', '/nope/deeper', '/js', '/js/', '/index.htm', '/healthz/']) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.body.toString(), /Blast Party/, path);
  }
});

test('routes: /healthz is 200 ok (no-store) and 503 {"status":"draining"} while shutting down; HEAD works', async () => {
  const ok = await get('/healthz');
  assert.deepEqual([ok.status, ok.body.toString(), ok.headers['cache-control']], [200, 'ok', 'no-store']);
  const head = await get('/healthz', { method: 'HEAD' });
  assert.deepEqual([head.status, head.body.length, head.headers['content-length']], [200, 0, '2']);
  draining = true;
  try {
    const res = await get('/healthz');
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.body), { status: 'draining' });
    assert.equal(res.headers['content-type'], 'application/json');
    assert.equal((await get('/')).status, 200, 'static files are still served while draining');
  } finally {
    draining = false;
  }
});

test('routes: /api/stats is JSON, no-store, HEAD-able; any other /api/* is 404', async () => {
  const res = await get('/api/stats');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { v: '1.0.0', rooms: 0 });
  const head = await get('/api/stats', { method: 'HEAD' });
  assert.deepEqual([head.status, head.body.length, head.headers['cache-control']], [200, 0, 'no-store']);
  assert.equal((await get('/api/other')).status, 404);
  assert.equal((await get('/api/')).status, 404);
  assert.equal((await get('/api/stats/x')).status, 404);
});

test('routes: /favicon.ico is 204 with an empty body', async () => {
  const res = await get('/favicon.ico');
  assert.deepEqual([res.status, res.body.length], [204, 0]);
});

test('routes: /shared/ serves only *.js from shared/, everything else comes from client/', async () => {
  assert.equal((await get('/shared/world.js')).body.toString(), BIG);
  assert.equal((await get('/shared/data.json')).status, 404, 'shared/ is JavaScript only');
  assert.equal((await get('/shared/nope.js')).status, 404);
  assert.equal((await get('/js/main.js')).body.toString(), BIG);
  assert.equal((await get('/shared')).status, 404);
  assert.equal((await get('/js/world.js')).status, 404, 'client/js does not shadow or mirror shared/');
});

test('static: whitelisted extensions only, no dotfiles, no directory listings, symlinks cannot leave the root', async () => {
  assert.equal((await get('/notes.txt')).status, 404);
  assert.equal((await get('/js/link.js')).status, 404, 'a symlink to a file outside the root');
  assert.equal((await get('/js/tiny.js')).status, 200);
  assert.equal((await get('/css')).status, 404);
  assert.equal((await get('/css/')).status, 404);
  assert.equal((await get('/icons/')).status, 404);
  assert.equal((await get('/.env')).status, 400);
  assert.equal((await get('/js/.hidden.js')).status, 400);
});

// ---- Traversal ---------------------------------------------------------------------------------------------

test('traversal: %2e%2e, .., backslashes, NUL and dotfiles are all 400, and nothing outside the roots is ever served', async () => {
  const attempts = ['/../package.json', '/%2e%2e/package.json', '/%2E%2E/%2E%2E/etc/passwd', '/js/..%2f..%2foutside/secret.js', '/js/%2e%2e/%2e%2e/outside/secret.js',
    '/..%5coutside%5csecret.js', '/js/..\\..\\outside\\secret.js', '/js/main.js%00.png', '/%00', '/.env', '/.git/HEAD', '/js/./main.js', '/shared/../client/index.html',
    '/shared/%2e%2e/outside/secret.js', '/js/....//....//outside/secret.js', '/%zz', '/%e0%a4%a', '/js/%c0%ae%c0%ae/x'];
  for (const path of attempts) {
    const res = await get(path);
    assert.equal(res.status, 400, `${path} -> ${res.status}`);
    assert.doesNotMatch(res.body.toString(), /secret|SECRET|root:/);
  }
  const absolute = await raw(`GET http://evil.example/index.html HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
  assert.match(absolute, /^HTTP\/1\.1 400 /);
  const star = await raw('GET * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  assert.match(star, /^HTTP\/1\.1 400 /);
});

// ---- Methods, HEAD, Range -----------------------------------------------------------------------------------

test('methods: only GET and HEAD; everything else is 405 with Allow', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE']) {
    const res = await get('/', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.allow, 'GET, HEAD');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers[k.toLowerCase()], v, `${method} ${k}`);
  }
  assert.equal((await get('/api/stats', { method: 'POST' })).status, 405);
});

test('HEAD: same status and headers as GET, no body', async () => {
  const getRes = await get('/js/main.js', { headers: { 'accept-encoding': 'gzip' } });
  const head = await get('/js/main.js', { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  for (const h of ['content-type', 'content-length', 'etag', 'cache-control', 'content-encoding', 'vary', 'content-security-policy']) {
    assert.equal(head.headers[h], getRes.headers[h], h);
  }
  const missing = await get('/nope', { method: 'HEAD' });
  assert.deepEqual([missing.status, missing.body.length], [404, 0]);
});

test('Range: not supported, so the full 200 is returned and Accept-Ranges says none', async () => {
  const res = await get('/js/main.js', { headers: { range: 'bytes=0-9' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), BIG);
  assert.equal(res.headers['accept-ranges'], 'none');
  assert.equal(res.headers['content-range'], undefined);
  assert.equal((await get('/js/main.js', { headers: { range: 'bytes=999999-' } })).status, 200);
  assert.equal((await get('/js/main.js', { headers: { range: 'garbage' } })).status, 200);
});

// ---- Headers ---------------------------------------------------------------------------------------------------------

test('headers: the CSP set is on every response: 200, 204, 304, 400, 404, 405, 503 and /api/*', async () => {
  draining = true;
  const drain = await get('/healthz');
  draining = false;
  const etag = (await get('/js/main.js')).headers.etag;
  const responses = [
    await get('/'), await get('/favicon.ico'), await get('/js/main.js', { headers: { 'if-none-match': etag } }), await get('/%2e%2e/x'), await get('/nope'),
    await get('/', { method: 'POST' }), drain, await get('/api/stats'), await get('/api/nope'), await get('/healthz'),
  ];
  assert.deepEqual(responses.map((r) => r.status), [200, 204, 304, 400, 404, 405, 503, 200, 404, 200]);
  for (const res of responses) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers[k.toLowerCase()], v, `${res.status} ${k}`);
    assert.equal(res.headers['strict-transport-security'], undefined, 'HSTS needs a trusted proxy that says https');
  }
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "connect-src 'self' ws: wss:",
    "media-src 'self' blob: data:", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'"]) {
    assert.ok(csp.split('; ').includes(directive), directive);
  }
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
  assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(SECURITY_HEADERS['Permissions-Policy'], 'camera=(), microphone=(), geolocation=(), gamepad=(self), screen-wake-lock=(self)');
});

test('headers: HSTS only when a trusted proxy reports https', async () => {
  const serve = async (trustProxy) => {
    const s = http.createServer(createHttpHandler({ clientRoot: client, sharedRoot: shared, stats: () => ({}), isDraining: () => false, trustProxy }));
    await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
    const res = await new Promise((resolve) => http.get(`http://127.0.0.1:${s.address().port}/healthz`, { headers: { 'x-forwarded-proto': 'https' }, agent: false }, (r) => { r.resume(); resolve(r); }));
    const plain = await new Promise((resolve) => http.get(`http://127.0.0.1:${s.address().port}/healthz`, { headers: { 'x-forwarded-proto': 'http' }, agent: false }, (r) => { r.resume(); resolve(r); }));
    await new Promise((resolve) => { s.close(resolve); s.closeAllConnections(); });
    return [res.headers['strict-transport-security'], plain.headers['strict-transport-security']];
  };
  assert.deepEqual(await serve(0), [undefined, undefined]);
  assert.deepEqual(await serve(1), ['max-age=15552000', undefined]);
});

test('MIME: the table of the spec, text types with charset, nosniff everywhere', async () => {
  const expect = {
    '/js/main.js': 'text/javascript; charset=utf-8', '/css/style.css': 'text/css; charset=utf-8', '/index.html': 'text/html; charset=utf-8',
    '/data.json': 'application/json', '/manifest.webmanifest': 'application/manifest+json', '/icons/icon.svg': 'image/svg+xml',
    '/icons/icon-192.png': 'image/png', '/font.woff2': 'font/woff2', '/shared/world.js': 'text/javascript; charset=utf-8',
  };
  for (const [path, type] of Object.entries(expect)) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers['content-type'], type, path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
});

test('caching: weak ETag + no-cache; If-None-Match (also W/ form and *) gives 304 without a body', async () => {
  const first = await get('/js/main.js');
  assert.match(first.headers.etag, /^W\/"[\w-]+"$/);
  assert.equal(first.headers['cache-control'], 'no-cache');
  const etag = first.headers.etag;
  for (const inm of [etag, etag.slice(2), `"other", ${etag}`, '*']) {
    const res = await get('/js/main.js', { headers: { 'if-none-match': inm } });
    assert.equal(res.status, 304, inm);
    assert.equal(res.body.length, 0);
    assert.equal(res.headers.etag, etag);
    assert.equal(res.headers['cache-control'], 'no-cache');
  }
  assert.equal((await get('/js/main.js', { headers: { 'if-none-match': 'W/"nope"' } })).status, 200);
  assert.equal((await get('/js/main.js', { method: 'HEAD', headers: { 'if-none-match': etag } })).status, 304);
});

test('caching: an edited file is served fresh (cache keyed by mtime and size), with a new ETag', async () => {
  const file = join(client, 'js', 'live.js');
  writeFileSync(file, 'export const v = 1;');
  const one = await get('/js/live.js');
  writeFileSync(file, 'export const v = 22222;');
  const t = new Date(Date.now() + 5000);
  utimesSync(file, t, t);
  const two = await get('/js/live.js');
  assert.equal(two.body.toString(), 'export const v = 22222;');
  assert.notEqual(one.headers.etag, two.headers.etag);
});

test('gzip: text over 256 bytes is compressed when accepted; Vary always; identity otherwise; q=0 is honoured', async () => {
  const gz = await get('/js/main.js', { headers: { 'accept-encoding': 'br, gzip;q=0.8, deflate' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gz.headers.vary, 'Accept-Encoding');
  assert.equal(gunzipSync(gz.body).toString(), BIG);
  assert.equal(Number(gz.headers['content-length']), gz.body.length);
  assert.ok(gz.body.length < BIG.length / 4);

  const plain = await get('/js/main.js');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers.vary, 'Accept-Encoding', 'caches must key on Accept-Encoding even for identity responses');
  assert.equal(plain.body.toString(), BIG);
  assert.equal(plain.headers.etag, gz.headers.etag);

  for (const enc of ['gzip;q=0', 'identity', 'br', '']) assert.equal((await get('/js/main.js', { headers: { 'accept-encoding': enc } })).headers['content-encoding'], undefined, enc);
  assert.equal((await get('/js/tiny.js', { headers: { 'accept-encoding': 'gzip' } })).headers['content-encoding'], undefined, 'not worth compressing');
  const png = await get('/icons/icon-192.png', { headers: { 'accept-encoding': 'gzip' } });
  assert.deepEqual([png.headers['content-encoding'], png.headers.vary], [undefined, undefined]);
  for (const path of ['/css/style.css', '/index.html', '/manifest.webmanifest', '/data.json', '/icons/icon.svg']) {
    const res = await get(path, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.headers['content-encoding'], 'gzip', path);
    assert.equal(gunzipSync(res.body).toString(), files[`client${path}`], path);
  }
});

test('robustness: concurrent requests, a client that hangs up mid-response and odd targets leave the handler healthy', async () => {
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => get(i % 2 ? '/js/main.js' : '/shared/world.js', { headers: { 'accept-encoding': 'gzip' } })));
  assert.ok(results.every((r) => r.status === 200));
  await raw('GET /js/main.js HTTP/1.1\r\nHost: x\r\n\r\n').then(() => {});
  const abrupt = net.connect(server.address().port, '127.0.0.1', () => { abrupt.write('GET /js/main.js HTTP/1.1\r\nHost: x\r\n\r\n'); abrupt.destroy(); });
  await new Promise((resolve) => abrupt.on('close', resolve));
  assert.equal((await get('/healthz')).status, 200);
  assert.equal((await get(`/${'a'.repeat(4000)}.js`)).status, 404);
  assert.equal((await get('/%E2%82%AC.js')).status, 404);
});
