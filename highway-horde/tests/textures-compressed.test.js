// The texture files' download copies (scripts/compress-textures.js → public/textures/compressed.json,
// read by render3d/tex-files.js; the one-file build embeds them, scripts/build-standalone.js): every
// PNG has an up-to-date copy (a re-baked or replaced PNG needs `npm run textures:compress`), the
// lossy ones keep their quality floor, the loaders pick the smallest copy a tier needs, and the
// one-file build ships a stale copy's PNG instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LIB = path.join(ROOT, 'public', 'textures');
const index = JSON.parse(readFileSync(path.join(LIB, 'compressed.json'), 'utf8'));

function pngs(dir, base = dir) {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...pngs(p, base));
    else if (n.endsWith('.png')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

test('every PNG under public/textures has an up-to-date download copy (else: npm run textures:compress)', () => {
  const stale = [];
  for (const rel of pngs(LIB)) {
    const e = index.files[rel];
    const sha = createHash('sha1').update(readFileSync(path.join(LIB, rel))).digest('hex');
    if (!e || e.sha1 !== sha) { stale.push(rel); continue; }
    for (const f of [e.file, ...(e.variants || []).map((v) => v.file)]) assert.ok(existsSync(path.join(LIB, f)), `${rel}: ${f} is missing`);
  }
  assert.deepEqual(stale, [], `${stale.length} PNGs changed since their copies were made: run npm run textures:compress`);
  for (const k of Object.keys(index.files)) assert.ok(existsSync(path.join(LIB, k)), `an entry without its PNG: ${k}`);
});

test('the copies are smaller, lossy ones keep their quality, the rules are applied by role', async () => {
  const ct = await import('../scripts/compress-textures.js');
  let png = 0, out = 0;
  for (const [rel, e] of Object.entries(index.files)) {
    const size = statSync(path.join(LIB, rel)).size;
    png += size; out += e.bytes;
    assert.ok(e.bytes <= size, rel);
    if (e.file.endsWith('.jpg')) {
      const role = ct.ROLE[ct.roleOf(rel)];
      assert.ok(role, `${rel}: a JPEG copy of an exact map`);
      assert.ok(e.psnr >= role.floor, `${rel}: PSNR ${e.psnr}`);
    }
    // masks and anything unknown stay lossless; so does anything with alpha (WebP lossless)
    if (ct.roleOf(rel) === 'exact') assert.ok(!e.file.endsWith('.jpg'), `${rel} must stay exact`);
  }
  assert.ok(out < png * 0.75, `the copies are ${(out / 1e6).toFixed(0)} MB of ${(png / 1e6).toFixed(0)} MB`);
  assert.equal(ct.roleOf('grass/albedo.png'), 'color');
  assert.equal(ct.roleOf('decals/decals-a.png'), 'color');
  assert.equal(ct.roleOf('decals/decals-a-n.png'), 'normal');
  assert.equal(ct.roleOf('guns/blued_orm.png'), 'data');
  assert.equal(ct.roleOf('zombies/scalp-pack.png'), 'data');
  assert.equal(ct.roleOf('grass/mask.png'), 'exact');
  assert.equal(ct.roleOf('guns/wear.png'), 'exact');
  const px = new Uint8Array([0, 0, 0, 4, 8, 8, 8, 4, 4, 4, 4, 4, 8, 8, 8, 4]);
  assert.deepEqual([...ct.halve(px, 2, 2, 4)], [5, 5, 5, 4], 'a 2 × 2 box per channel, alpha never weights the colour');
});

test('pickFile: the smallest copy at least the size asked for, the PNG without an entry', async () => {
  const tf = await import('../public/js/render3d/tex-files.js');
  const ix = { files: {
    'a/albedo.png': { file: 'a/albedo.jpg', variants: [{ size: 1024, file: 'a/albedo@1024.jpg' }, { size: 2048, file: 'a/albedo@2048.jpg' }] },
    'z/n.png': { file: 'z/n.jpg', la: true },
    'k/mask.png': { file: 'k/mask.png' },
  } };
  assert.deepEqual(tf.pickFile(ix, 'a/albedo.png'), { file: 'a/albedo.jpg', png: false, la: false });
  assert.equal(tf.pickFile(ix, 'a/albedo.png', 512).file, 'a/albedo@1024.jpg');
  assert.equal(tf.pickFile(ix, 'a/albedo.png', 1024).file, 'a/albedo@1024.jpg');
  assert.equal(tf.pickFile(ix, 'a/albedo.png', 2000).file, 'a/albedo@2048.jpg');
  assert.equal(tf.pickFile(ix, 'a/albedo.png', 4096).file, 'a/albedo.jpg');
  assert.deepEqual(tf.pickFile(ix, 'z/n.png'), { file: 'z/n.jpg', png: false, la: true });
  assert.deepEqual(tf.pickFile(ix, 'k/mask.png'), { file: 'k/mask.png', png: true, la: false });
  assert.deepEqual(tf.pickFile(null, 'q/x.png', 512), { file: 'q/x.png', png: true, la: false });
  assert.deepEqual(tf.pickFile(ix, 'q/x.png'), { file: 'q/x.png', png: true, la: false });
  assert.equal(tf.mimeOf('a/b.jpg'), 'image/jpeg');
  assert.equal(tf.mimeOf('a/b@1024.webp'), 'image/webp');
  // the library's own index: the decals' normal sheets have their 2048² copies (ultra's size)
  assert.match(tf.pickFile(index, 'decals/decals-a-n.png', 2048).file, /decals-a-n@2048\.webp$/);
});

test('the texture queue: later sets wait for the world library (at most QUEUE_MAX_WAIT)', async () => {
  const tf = await import('../public/js/render3d/tex-files.js');
  let open = false;
  const q0 = tf.textureQueue().then(() => { open = true; });
  await q0;
  assert.ok(open, 'nothing held: open at once');
  let release;
  tf.holdTextureQueue(new Promise((r) => { release = r; }));
  let after = false;
  const q = tf.textureQueue().then(() => { after = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(after, false, 'held while the library loads');
  release();
  await q;
  assert.equal(after, true);
});

// (the build needs esbuild, a dev dependency of highway-horde: the repository root's own test run,
// which does not install it, skips this one)
let esbuildOk = true;
try { createRequire(import.meta.url).resolve('esbuild'); } catch { esbuildOk = false; }

test('the one-file build embeds the fresh copies (and their index), a stale copy\'s PNG instead', { skip: !esbuildOk && 'esbuild is not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hh-onefile-'));
  try {
    const lib = path.join(dir, 'textures');
    mkdirSync(path.join(lib, 's'), { recursive: true });
    const a = Buffer.from('fake png A'), b = Buffer.from('fake png B'), aj = Buffer.from('fake jpeg of A');
    writeFileSync(path.join(lib, 's', 'albedo.png'), a);
    writeFileSync(path.join(lib, 's', 'albedo.jpg'), aj);
    writeFileSync(path.join(lib, 's', 'normal.png'), b);
    writeFileSync(path.join(lib, 's', 'normal.jpg'), Buffer.from('an old copy'));
    const sha = (x) => createHash('sha1').update(x).digest('hex');
    writeFileSync(path.join(lib, 'compressed.json'), JSON.stringify({ version: 1, files: {
      's/albedo.png': { file: 's/albedo.jpg', sha1: sha(a), bytes: aj.length },
      's/normal.png': { file: 's/normal.jpg', sha1: sha(Buffer.from('the PNG it was made from')), bytes: 11 },
    } }));
    const out = path.join(dir, 'one.html');
    const log = execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-standalone.js')], { env: { ...process.env, HH_TEX_DIR: lib, HH_ONEFILE_OUT: out }, stdio: 'pipe' }).toString();
    const html = readFileSync(out, 'utf8');
    const el = (p) => html.match(new RegExp(`<script type="application/x-hh-tex" data-hh-tex="${p}" data-type="([^"]+)">([A-Za-z0-9+/=]*)</script>`));
    const j = el('s/albedo.jpg');
    assert.ok(j && j[1] === 'image/jpeg' && Buffer.from(j[2], 'base64').equals(aj), 'the fresh copy');
    assert.ok(!el('s/albedo.png'), 'not its PNG');
    const n = el('s/normal.png');
    assert.ok(n && Buffer.from(n[2], 'base64').equals(b), 'the stale copy\'s PNG');
    assert.ok(!el('s/normal.jpg'), 'not the stale copy');
    const ix = JSON.parse(html.match(/<script type="application\/json" id="hh-tex-index">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(ix.files, { 's/albedo.png': { file: 's/albedo.jpg' } });
    assert.ok(!html.includes('__HH_FILES'), 'no texture data in the game\'s script');
    assert.ok(html.indexOf('window.__HH_ONEFILE') < html.indexOf('data-hh-tex='), 'textures after the code');
    assert.match(log + '', /wrote/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
