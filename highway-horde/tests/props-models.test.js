// The photo-scanned prop models (public/models/, scripts/fetch-models.js, render3d/props3d.js) and the
// foliage cards (public/textures/foliage/, scripts/bake-foliage.js): files only (Node built-ins; render3d
// needs three, so the modules are read as text where their names matter).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'public', 'models');
const TEX = path.join(ROOT, 'public', 'textures');
const man = existsSync(path.join(MODELS, 'props.json')) ? JSON.parse(readFileSync(path.join(MODELS, 'props.json'), 'utf8')) : null;
const fol = existsSync(path.join(TEX, 'foliage', 'foliage.json')) ? JSON.parse(readFileSync(path.join(TEX, 'foliage', 'foliage.json'), 'utf8')) : null;

/** width, height, colour type of a PNG (IHDR). */
function pngInfo(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 12, 16), 'IHDR', file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], type: b[25] };
}

test('prop models: every level indexes its own vertices inside props.bin, layers in range, LOD 1 lighter than LOD 0', { skip: !man && 'no model library' }, () => {
  const bin = readFileSync(path.join(MODELS, 'props.bin'));
  assert.equal(bin.length, man.bytes);
  const names = Object.keys(man.models);
  assert.ok(names.length >= 18, `${names.length} models`);
  for (const [name, m] of Object.entries(man.models)) {
    assert.equal(m.lods.length, 2, name);
    assert.ok(m.layers >= 1 && m.layer0 + m.layers <= man.layers.length, `${name}: layers`);
    assert.ok(m.size.every((v) => v > 0.02 && v < 4), `${name}: size ${m.size} m`);
    assert.ok(m.lods[1].tris < m.lods[0].tris && m.lods[0].tris <= m.srcTris, `${name}: ${m.lods.map((l) => l.tris)} of ${m.srcTris}`);
    assert.ok(m.lods[0].tris <= 4000, `${name}: LOD 0 ${m.lods[0].tris} triangles`);
    for (const L of m.lods) {
      for (const k of ['pos', 'nor', 'uv', 'layer', 'idx']) assert.ok(L[k] >= 0 && L[k] < bin.length, `${name}.${k}`);
      assert.equal(L.pos % 4, 0); assert.equal(L.uv % 4, 0); assert.equal(L.idx % (L.index32 ? 4 : 2), 0);
      const idx = L.index32 ? new Uint32Array(bin.buffer, bin.byteOffset + L.idx, L.tris * 3) : new Uint16Array(bin.buffer, bin.byteOffset + L.idx, L.tris * 3);
      let maxI = 0;
      for (const v of idx) maxI = Math.max(maxI, v);
      assert.ok(maxI < L.verts, `${name}: index ${maxI} of ${L.verts} vertices`);
      const lay = new Uint8Array(bin.buffer, bin.byteOffset + L.layer, L.verts);
      for (const v of lay) assert.ok(v < m.layers, `${name}: layer ${v}`);
      const pos = new Float32Array(bin.buffer, bin.byteOffset + L.pos, L.verts * 3);
      for (let i = 0; i < pos.length; i += 3) {
        assert.ok(Number.isFinite(pos[i]) && Number.isFinite(pos[i + 1]) && Number.isFinite(pos[i + 2]), `${name}: finite`);
        assert.ok(pos[i + 1] > -0.01 && pos[i + 1] <= m.size[1] + 0.01, `${name}: stands on y = 0`);
      }
    }
  }
});

test('prop models: every texture layer is three 512² RGB maps; CC0 sources recorded and credited', { skip: !man && 'no model library' }, () => {
  const credits = readFileSync(path.join(MODELS, 'CREDITS.md'), 'utf8');
  for (const L of man.layers) {
    for (const k of ['albedo', 'normal', 'orm']) {
      const f = path.join(TEX, L.files[k]);
      assert.ok(existsSync(f), f);
      const i = pngInfo(f);
      assert.equal(i.w, man.store); assert.equal(i.h, man.store); assert.equal(i.type, 2);
    }
    assert.equal(L.mean.length, 3);
  }
  for (const [name, m] of Object.entries(man.models)) {
    const s = m.source;
    assert.equal(s.license, 'CC0 1.0', name);
    assert.match(s.url, /^https:\/\/polyhaven\.com\/a\//);
    for (const f of Object.values(s.files)) { assert.match(f.url, /^https:\/\/dl\.polyhaven\.org\//); assert.match(f.md5, /^[0-9a-f]{32}$/); }
    assert.ok(credits.includes('`' + name + '`') && credits.includes(s.url), `${name} credited`);
  }
  // (the budget: the models' maps stay small)
  let bytes = 0;
  const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.png')) bytes += statSync(p).size; } };
  walk(path.join(TEX, 'models'));
  assert.ok(bytes < 40e6, `model maps ${(bytes / 1e6).toFixed(1)} MB of PNG`);
});

test('the set dressing places only models the library has; the converter lists them all', { skip: !man && 'no model library' }, async () => {
  const src = readFileSync(path.join(ROOT, 'public', 'js', 'render3d', 'dress-models.js'), 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/put\((?:r\.chance\([^)]*\) \? )?'([a-z_]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/'(drum_[abc])'/g)) used.add(m[1]);
  for (const m of src.matchAll(/'(trashcan(?:_rust)?|crate_[ab])'/g)) used.add(m[1]);
  assert.ok(used.size >= 15, `${used.size} models placed`);
  for (const n of used) assert.ok(man.models[n], `dress-models.js places ${n}`);
  // every kind it handles is a real set-dressing kind
  const { DRESS_KINDS } = await import('../public/js/shared/dress.js');
  const kinds = [...src.matchAll(/^ {2}([a-z_]+)\(P, put\) \{/gm)].map((m) => m[1]);
  assert.ok(kinds.length >= 18);
  for (const k of kinds) assert.ok(DRESS_KINDS[k], `kind ${k}`);
  // (the converter needs its dev dependencies)
  let fm = null;
  try { createRequire(import.meta.url).resolve('meshoptimizer'); createRequire(import.meta.url).resolve('jpeg-js'); fm = await import('../scripts/fetch-models.js'); } catch { fm = null; }
  if (fm) assert.deepEqual(Object.keys(fm.MODELS).sort(), Object.keys(man.models).sort());
});

test('foliage cards: a 2048 × 1024 RGBA atlas, the cells in the leaf atlas\' grid, CC0 sources', { skip: !fol && 'no foliage cards' }, () => {
  const i = pngInfo(path.join(TEX, 'foliage', 'leaves.png'));
  assert.equal(i.w, fol.width); assert.equal(i.h, fol.height); assert.equal(i.type, 6);
  assert.equal(fol.width, fol.cell * 4); assert.equal(fol.height, fol.cell * 2);
  const tex = readFileSync(path.join(ROOT, 'public', 'js', 'render3d', 'world-tex.js'), 'utf8');
  const cells = tex.slice(tex.indexOf('export const LEAF_CELLS'), tex.indexOf('};', tex.indexOf('export const LEAF_CELLS')));
  const seen = new Set();
  for (const [name, c] of Object.entries(fol.cells)) {
    // the cell's place in the canvas grid matches its rect in LEAF_CELLS (u from the left, v from the bottom)
    const m = cells.match(new RegExp(`${name}: \\[([^\\]]+)\\]`));
    assert.ok(m, `${name} is a leaf cell`);
    const [u0, v0] = m[1].split(',').map(Number);
    assert.equal(c.at[0], Math.round(u0 * 4), `${name} column`);
    assert.equal(c.at[1], 1 - Math.round(v0 * 2), `${name} row`);
    const key = c.at.join(',');
    assert.ok(!seen.has(key)); seen.add(key);
    assert.ok(c.cover > 0.2 && c.cover < 0.9, `${name}: ${c.cover} covered`);
    assert.equal(c.source.license, 'CC0 1.0');
    assert.match(c.source.url, /^https:\/\/polyhaven\.com\/a\//);
  }
  assert.ok(Object.keys(fol.cells).length >= 4);
});
