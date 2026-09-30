// HTTP side of the server (docs/SPEC.md §7): the exact routing table, security headers, a small static file server
// and the two ops endpoints. No framework, no fallbacks to index.html for unknown paths.
//
// Routing (first match wins, GET/HEAD only, anything else 405):
//   /  /index.html       client/index.html
//   /r/ABCD[/]           the same index.html bytes (any other /r/... is 404)
//   /healthz             200 "ok", or 503 {"status":"draining"} while shutting down
//   /api/stats           JSON (any other /api/... is 404)
//   /favicon.ico         204
//   /shared/*.js         shared/ (the browser imports the isomorphic modules from here)
//   everything else      client/, whitelisted extensions only
//
// Decisions where the spec is silent:
//  * Range is not supported: a Range request gets the full 200 response with `Accept-Ranges: none` (valid per RFC 9110).
//  * Any path segment that starts with a dot is a dotfile and answers 400, together with "..", backslashes and NUL.
//  * Text types are gzip-compressed once per file version (cached) when the client accepts gzip; they carry
//    `Vary: Accept-Encoding` whether or not this particular response was compressed.

import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, extname, sep } from 'node:path';

const MIME = Object.freeze({
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
});
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.svg']);
const MIN_GZIP_BYTES = 256;

/** Sent on every response, errors and /api/* included. */
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    + "connect-src 'self' ws: wss:; media-src 'self' blob: data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; "
    + "base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), gamepad=(self), screen-wake-lock=(self)',
});
const HSTS = 'max-age=15552000';

const INDEX_ROUTES = new Set(['/', '/index.html']);
const SHARE_CODE_RE = /^\/r\/[A-Za-z]{4}\/?$/;

/** Decodes and validates the request path. Returns null for anything that must answer 400. */
export function safePath(rawUrl) {
  let path = rawUrl;
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  if (!path.startsWith('/')) return null;                        // absolute-form and asterisk-form targets are not served
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('..')) return null;
  if (decoded.split('/').some((segment) => segment.startsWith('.'))) return null;
  return decoded;
}

function acceptsGzip(header) {
  if (typeof header !== 'string') return false;
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (name.trim().toLowerCase() !== 'gzip') continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  }
  return false;
}

/** True when `If-None-Match` names our (weak) tag. */
function tagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  const bare = (t) => t.trim().replace(/^W\//, '');
  return header.trim() === '*' || header.split(',').some((t) => bare(t) === bare(etag));
}

/**
 * @param {object} o
 * @param {string} o.clientRoot absolute path of client/
 * @param {string} o.sharedRoot absolute path of shared/
 * @param {() => object} o.stats payload of /api/stats
 * @param {() => boolean} o.isDraining
 * @param {number} [o.trustProxy] hops; HSTS is only sent behind a trusted proxy that says https
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createHttpHandler({ clientRoot, sharedRoot, stats, isDraining, trustProxy = 0 }) {
  const cache = new Map();                                        // absolute path -> loaded file (bounded by the size of the tree)
  const realRoots = new Map();                                    // root -> realpath, so a symlink inside a root cannot lead out of it

  async function realRoot(root) {
    if (!realRoots.has(root)) realRoots.set(root, await realpath(root));
    return realRoots.get(root);
  }

  async function load(abs, ext, root) {
    const st = await stat(abs);
    if (!st.isFile()) return null;
    const hit = cache.get(abs);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    if (!(await realpath(abs)).startsWith(await realRoot(root) + sep)) return null;
    const body = await readFile(abs);
    let gzip = null;
    if (COMPRESSIBLE.has(ext) && body.length >= MIN_GZIP_BYTES) {
      const packed = gzipSync(body, { level: 9 });
      if (packed.length < body.length) gzip = packed;
    }
    const file = {
      mtimeMs: st.mtimeMs, size: st.size, body, gzip, ext,
      etag: `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
    };
    cache.set(abs, file);
    return file;
  }

  function baseHeaders(req, res) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (trustProxy > 0) {
      const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',').pop().trim().toLowerCase();
      if (proto === 'https') res.setHeader('Strict-Transport-Security', HSTS);
    }
  }

  function send(req, res, status, type, body, extra = {}) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, ...extra });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }

  function fail(req, res, status, extra = {}) {
    const text = { 400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error' }[status];
    send(req, res, status, 'text/plain; charset=utf-8', `${status} ${text}\n`, { 'Cache-Control': 'no-store', ...extra });
  }

  async function serveFile(req, res, abs, ext, root) {
    const file = await load(abs, ext, root).catch((err) => {
      if (['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG', 'EACCES'].includes(err.code)) return null;
      throw err;
    });
    if (!file) return fail(req, res, 404);
    const compressible = COMPRESSIBLE.has(ext);
    const headers = { ETag: file.etag, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'none' };
    if (compressible) headers.Vary = 'Accept-Encoding';
    if (tagMatches(req.headers['if-none-match'], file.etag)) {
      res.writeHead(304, headers);
      return res.end();
    }
    const gzip = file.gzip !== null && acceptsGzip(req.headers['accept-encoding']);
    if (gzip) headers['Content-Encoding'] = 'gzip';
    return send(req, res, 200, MIME[ext], gzip ? file.gzip : file.body, headers);
  }

  async function handle(req, res) {
    baseHeaders(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(req, res, 405, { Allow: 'GET, HEAD' });
    const path = safePath(req.url ?? '');
    if (path === null) return fail(req, res, 400);

    if (INDEX_ROUTES.has(path) || SHARE_CODE_RE.test(path)) return serveFile(req, res, join(clientRoot, 'index.html'), '.html', clientRoot);
    if (path.startsWith('/r/')) return fail(req, res, 404);
    if (path === '/healthz') {
      return isDraining()
        ? send(req, res, 503, 'application/json', '{"status":"draining"}', { 'Cache-Control': 'no-store' })
        : send(req, res, 200, 'text/plain; charset=utf-8', 'ok', { 'Cache-Control': 'no-store' });
    }
    if (path === '/api/stats') return send(req, res, 200, 'application/json', JSON.stringify(stats()), { 'Cache-Control': 'no-store' });
    if (path.startsWith('/api/')) return fail(req, res, 404);
    if (path === '/favicon.ico') {
      res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    }

    const inShared = path.startsWith('/shared/');
    const root = inShared ? sharedRoot : clientRoot;
    const rel = (inShared ? path.slice('/shared/'.length) : path.slice(1)).split('/');
    const ext = extname(rel[rel.length - 1]).toLowerCase();
    if (!Object.hasOwn(MIME, ext) || (inShared && ext !== '.js')) return fail(req, res, 404);
    const abs = join(root, ...rel);
    if (!abs.startsWith(root + sep)) return fail(req, res, 400);
    return serveFile(req, res, abs, ext, root);
  }

  return (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) fail(req, res, 500);
      else res.destroy();
    });
  };
}
