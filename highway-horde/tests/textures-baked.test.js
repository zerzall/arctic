// The baked texture library (scripts/bake-textures.js → public/textures/, render3d/world-surf-bake.js)
// in plain Node, no GL: the PNG codec, the baker's determinism and range, the committed library's
// files, the mapping of every surface id to a set (with each map's theme), the VRAM policy per tier,
// the loader falling back to the procedural layers, and the one-file build embedding the files.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = pathToFileURL(path.join(ROOT, 'public/vendor/three') + path.sep).href;

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

let png, baker, recipes, sets, bake, gen, maps, levels, hideouts;
const LIB = path.join(ROOT, 'public/textures');
// (read now: a test's skip is decided when it is declared)
const manifest = existsSync(path.join(LIB, 'manifest.json')) ? JSON.parse(readFileSync(path.join(LIB, 'manifest.json'), 'utf8')) : null;

before(async () => {
  png = await import('../scripts/bake/png.js');
  baker = await import('../scripts/bake-textures.js');
  recipes = await import('../scripts/bake/materials/index.js');
  sets = await import('../public/js/render3d/world-surf-sets.js');
  bake = await import('../public/js/render3d/world-surf-bake.js');
  gen = await import('../public/js/render3d/world-surf-gen.js');
  maps = await import('../public/js/shared/maps.js');
  levels = await import('../public/js/shared/levels/index.js');
  hideouts = await import('../public/js/shared/maps-hideouts.js');
});

test('PNG codec: grey, RGB and RGBA round-trip bit for bit; the same pixels give the same bytes', () => {
  for (const ch of [1, 3, 4]) {
    const w = 37, h = 23, px = new Uint8Array(w * h * ch);
    let s = 7;
    for (let i = 0; i < px.length; i++) { s = (s * 1103515245 + 12345) >>> 0; px[i] = (i % 50 < 25 ? (s >>> 16) : i * 3) & 255; }
    const a = png.encodePNG(px, w, h, ch), b = png.encodePNG(px, w, h, ch);
    assert.ok(a.equals(b), `deterministic (${ch} channels)`);
    assert.deepEqual([...a.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const d = png.decodePNG(a);
    assert.equal(d.width, w); assert.equal(d.height, h); assert.equal(d.channels, ch);
    assert.deepEqual(Buffer.from(d.data), Buffer.from(px));
  }
  // a corrupted chunk is caught by its CRC
  const good = png.encodePNG(new Uint8Array(16 * 16 * 3).fill(90), 16, 16, 3);
  const bad = Buffer.from(good); bad[40] ^= 0xff;
  assert.throws(() => png.decodePNG(bad), /CRC|data/);
});

test('every set the game maps a surface to has a recipe, and every recipe is used', () => {
  const names = recipes.RECIPES.map((r) => r.name);
  assert.equal(new Set(names).size, names.length, 'unique names');
  const need = sets.allSets();
  for (const n of need) assert.ok(names.includes(n), `recipe for ${n}`);
  for (const n of names) assert.ok(need.includes(n), `${n} is drawn by some surface`);
  assert.ok(names.length >= 50, `${names.length} materials`);
  for (const r of recipes.RECIPES) {
    assert.ok(r.det && gen.DET[r.det] != null, `${r.name}: home surface ${r.det}`);
    const t = recipes.recipeTile(r);
    assert.ok(t > 0.2 && t < 10, `${r.name}: tile ${t} m`);
    assert.ok(typeof r.about === 'string' && r.about.length > 20, `${r.name}: described`);
  }
});

test('the baker is deterministic: same seed, same bytes; another seed, other bytes', () => {
  const r = recipes.RECIPES.find((x) => x.name === 'brick_red');
  const a = baker.bakeOne(r, 64, 1, { store: 64, level: 1 });
  const b = baker.bakeOne(r, 64, 1, { store: 64, level: 1 });
  const c = baker.bakeOne(r, 64, 2, { store: 64, level: 1 });
  for (const k of ['albedo', 'normal', 'rah', 'mask']) {
    assert.ok(a.files[k].equals(b.files[k]), `${k} repeats`);
    const d = png.decodePNG(a.files[k]);
    assert.equal(d.width, 64); assert.equal(d.channels, 3);
  }
  assert.ok(!a.files.albedo.equals(c.files.albedo), 'the seed matters');
  // stored below the render size: a box-filtered copy
  const s = baker.bakeOne(r, 64, 1, { store: 32, level: 1 });
  assert.equal(png.decodePNG(s.files.normal).width, 32);
  assert.ok(baker.materialSeed(1, 'a') !== baker.materialSeed(1, 'b'));
});

test('every recipe bakes (small) to sane maps: finite stats, real variation, normals of unit length', () => {
  for (const r of recipes.RECIPES) {
    const o = baker.bakeOne(r, 32, 1, { store: 32, level: 1 });
    const st = o.stats;
    for (const k of ['rough', 'height', 'metal', 'tint']) assert.ok(Number.isFinite(st[k]) && st[k] >= 0 && st[k] <= 1, `${r.name}.${k} = ${st[k]}`);
    for (const v of st.mean) assert.ok(Number.isFinite(v) && v > 0 && v <= 1, `${r.name}: mean colour`);
    const al = o.maps.albedo, nm = o.maps.normal;
    let lo = 255, hi = 0;
    for (let i = 0; i < al.length; i++) { lo = Math.min(lo, al[i]); hi = Math.max(hi, al[i]); }
    assert.ok(hi - lo > 8, `${r.name}: albedo varies (${lo}..${hi})`);
    for (let i = 0; i < nm.length; i += 3 * 7) {
      const x = nm[i] / 127.5 - 1, y = nm[i + 1] / 127.5 - 1, z = nm[i + 2] / 127.5 - 1;
      const l = Math.hypot(x, y, z);
      assert.ok(Math.abs(l - 1) < 0.05 && z > 0, `${r.name}: normal length ${l.toFixed(3)}`);
    }
  }
});

test('the committed library: a manifest entry and four valid PNGs per set', { skip: !manifest && 'no library baked' }, () => {
  assert.equal(manifest.version, baker.MANIFEST_VERSION);
  for (const n of sets.allSets()) {
    const e = manifest.sets[n];
    assert.ok(e, `manifest has ${n}`);
    assert.ok(gen.DET[e.det] != null, `${n}: home surface`);
    assert.ok(e.size >= 256 && (e.size & (e.size - 1)) === 0, `${n}: size ${e.size}`);
    for (const k of ['albedo', 'normal', 'rah', 'mask']) {
      const f = path.join(LIB, e.files[k]);
      assert.ok(existsSync(f), f);
      const buf = readFileSync(f);
      // (IHDR: width, height, 8-bit RGB)
      assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
      assert.equal(buf.readUInt32BE(16), e.size); assert.equal(buf.readUInt32BE(20), e.size);
      assert.equal(buf[24], 8); assert.equal(buf[25], 2);
    }
    for (const v of e.mean) assert.ok(v > 0 && v < 1, `${n}: mean colour`);
    assert.ok(e.rough > 0.05 && e.rough < 1, `${n}: mean roughness ${e.rough}`);
  }
  // one set decoded in full: what the bake wrote
  const one = png.decodePNG(readFileSync(path.join(LIB, manifest.sets.brick_red.files.normal)));
  assert.equal(one.width, manifest.sets.brick_red.size);
});

test('surface mapping: every surface id has a set on every map; the themes swap in the hero sets', () => {
  const ids = [...maps.MAP_LIST.map((m) => m.id), ...levels.LEVEL_IDS, ...hideouts.HIDEOUT_IDS];
  for (const k of Object.keys(sets.THEMES)) assert.ok(ids.includes(k), `theme for a real map: ${k}`);
  for (const [map, theme] of Object.entries(sets.THEMES)) {
    for (const [from, to] of Object.entries(theme)) {
      assert.ok(gen.DET[from] != null && gen.DET[to] != null, `${map}: ${from} → ${to}`);
      assert.equal(sets.setsForMap(map)[gen.DET[from]], sets.SET_OF[to], `${map} draws ${from} with ${sets.SET_OF[to]}`);
    }
  }
  for (const id of ids) {
    const s = sets.setsForMap(id);
    assert.equal(s.length, gen.DET_COUNT);
    for (const [name, det] of Object.entries(gen.DET)) {
      if (sets.NO_SET.includes(name)) assert.equal(s[det], null, `${id}: ${name} has no set`);
      else assert.ok(typeof s[det] === 'string' && recipes.RECIPES.some((r) => r.name === s[det]), `${id}: ${name} → ${s[det]}`);
    }
  }
  // the hero sets: the hospital's tile, the metro's, Sandstone's plaster, shutters and adobe
  assert.equal(sets.setsForMap('hospital')[gen.DET.tile], 'tile_hospital');
  assert.equal(sets.setsForMap('metro')[gen.DET.tile], 'tile_metro');
  assert.equal(sets.setsForMap('sandstone')[gen.DET.wood], 'shutter_blue');
  assert.equal(sets.setsForMap('highway')[gen.DET.tile], 'terracotta');
});

test('slot plan: the sets a map uses plus its ground, one slot each, every used id pointing at its set', () => {
  const used = [gen.DET.brick, gen.DET.tile, gen.DET.panel, gen.DET.linoleum, gen.DET.linohosp, 999, 0];
  const p = sets.planSlots('hospital', used);
  assert.equal(new Set(p.sets).size, p.sets.length, 'no set twice');
  for (const n of sets.GROUND_DETS) assert.ok(p.sets.includes(sets.setsForMap('hospital')[gen.DET[n]]), `ground ${n}`);
  for (const id of used) {
    if (!(id > 0 && id < gen.DET_COUNT)) continue;
    assert.equal(p.sets[p.slotOf[id]], p.setOf[id], `id ${id}`);
  }
  // linoleum and the hospital's own vinyl share one slot there; unused surfaces get none
  assert.equal(p.slotOf[gen.DET.linoleum], p.slotOf[gen.DET.linohosp]);
  assert.equal(p.slotOf[gen.DET.carpet], -1);
  assert.equal(p.slotOf[gen.DET.macro], -1);
});

test('VRAM policy: high ≤ 512² under 400 MB, ultra ≤ 1024², cinematic under 1.5 GB, low none', () => {
  const n = gen.DET_COUNT;   // (every surface at once: more than any map uses)
  assert.equal(bake.bakedSize('low', 30), null);
  const hi = bake.bakedSize('high', n);
  assert.ok(hi <= 512 && bake.bakedBytes(hi, n) < 400e6, `high ${hi}², ${bake.bakedBytes(hi, n) / 1e6} MB`);
  const ul = bake.bakedSize('ultra', n);
  assert.ok(ul <= 1024 && bake.bakedBytes(ul, n) <= 800e6);
  for (const stored of [1024, 2048]) {
    const c = bake.bakedSize('cinematic', n, stored);
    assert.ok(bake.bakedBytes(c, n) < 1.5e9, `cinematic ${c}² ${(bake.bakedBytes(c, n) / 1e9).toFixed(2)} GB`);
  }
  assert.equal(bake.bakedSize('cinematic', 28, 2048), 2048, 'a typical map gets 2048² on cinematic when the library has it');
  assert.equal(bake.bakedSize('ultra', 28, 1024), 1024);
  // 28 sets (the highway) at 1024²: about 313 MB
  assert.ok(Math.abs(bake.bakedBytes(1024, 28) - 313e6) < 2e6);
});

test('the loader falls back: no WebGL 2, no library, a broken file — it rejects and the procedural layers stay', async () => {
  // no renderer / WebGL 1
  await assert.rejects(bake.loadBaked({ renderer: null, mapId: 'highway', usedIds: [], tier: 'ultra' }), /WebGL 2/);
  // a library that cannot be read
  bake.setTextureSource({ manifest: () => Promise.reject(new Error('offline')), blob: () => Promise.reject(new Error('offline')) });
  assert.equal(await bake.libraryManifest(), null);
  const fakeGl = Object.create(globalThis.WebGL2RenderingContext ? globalThis.WebGL2RenderingContext.prototype : Object.prototype);
  globalThis.WebGL2RenderingContext ??= function WebGL2RenderingContext() {};
  Object.setPrototypeOf(fakeGl, globalThis.WebGL2RenderingContext.prototype);
  globalThis.createImageBitmap ??= async () => { throw new Error('no decoder'); };
  const renderer = { getContext: () => fakeGl, resetState() {} };
  await assert.rejects(bake.loadBaked({ renderer, mapId: 'highway', usedIds: [], tier: 'ultra' }), /no library/);
  // a manifest that lacks a set the map needs
  bake.setTextureSource({ manifest: async () => ({ version: 1, sets: { brick_red: {} } }), blob: async () => { throw new Error('x'); } });
  await assert.rejects(bake.loadBaked({ renderer, mapId: 'highway', usedIds: [gen.DET.brick], tier: 'ultra' }), /has no/);
  bake.setTextureSource(null);
  // the uniforms: procedural until a library is set, back to procedural when it is dropped
  const proc = { isTexture: true, name: 'proc' };
  const du = bake.createDetailUniforms(proc);
  const u = du.uniforms;
  assert.equal(u.uDetail.value, proc); assert.equal(u.uDetailC.value, proc); assert.equal(u.uDetBaked.value, 0);
  const tab = u.uDetTab.value.image.data, C = gen.DET_COUNT;
  assert.equal(tab[(2 * C + gen.DET.brickyellow) * 4], gen.DET.brick, 'procedural: a baked-only id reads its base layer');
  assert.equal(tab[(2 * C + gen.DET.brick) * 4 + 1], gen.DET.brick + gen.DET_LAYERS, 'procedural: the colour slice');
  let disposed = 0;
  const plan = sets.planSlots('highway', [gen.DET.brick]);
  const man = { sets: Object.fromEntries(plan.sets.map((n) => [n, { det: 'brick', mean: [0.2, 0.1, 0.05], rough: 0.8, tile: 1.44 }])) };
  du.setBaked({ D: { name: 'D' }, C: { name: 'C' }, plan, manifest: man, info: { layers: plan.sets.length }, dispose: () => { disposed++; } });
  assert.equal(u.uDetBaked.value, 1); assert.equal(u.uDetail.value.name, 'D'); assert.equal(u.uDetailP.value, proc);
  assert.equal(tab[(2 * C + gen.DET.brick) * 4], plan.slotOf[gen.DET.brick], 'baked: the slot');
  assert.ok(Math.abs(tab[(3 * C + gen.DET.brick) * 4] - 0.2) < 1e-6, 'baked: the set\'s mean colour');
  du.clearBaked();
  assert.equal(disposed, 1);
  assert.equal(u.uDetail.value, proc); assert.equal(u.uDetBaked.value, 0);
  du.dispose();
});

test('the one-file build embeds the texture library: its manifest and every file, after the game\'s code', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hh-onefile-'));
  try {
    const lib = path.join(dir, 'textures');
    const files = {};
    const man = { version: 1, sets: {} };
    for (const n of ['brick_red', 'asphalt']) {
      const r = recipes.RECIPES.find((x) => x.name === n);
      const o = baker.bakeOne(r, 32, 1, { store: 32, level: 1 });
      mkdirSync(path.join(lib, n), { recursive: true });
      man.sets[n] = baker.manifestEntry(r, n, o.stats, { a: 1 }, 32, 32);
      for (const [k, b] of Object.entries(o.files)) { writeFileSync(path.join(lib, n, `${k}.png`), b); files[`${n}/${k}.png`] = b; }
    }
    writeFileSync(path.join(lib, 'manifest.json'), JSON.stringify(man));
    const out = path.join(dir, 'one.html');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-standalone.js')], { env: { ...process.env, HH_TEX_DIR: lib, HH_ONEFILE_OUT: out }, stdio: 'pipe' });
    const html = readFileSync(out, 'utf8');
    assert.ok(html.includes('window.__HH_TEX = (function'), 'the store');
    const mm = html.match(/<script type="application\/json" id="hh-tex-manifest">([\s\S]*?)<\/script>/);
    assert.ok(mm, 'the manifest element');
    assert.deepEqual(Object.keys(JSON.parse(mm[1]).sets), ['brick_red', 'asphalt']);
    for (const [p, b] of Object.entries(files)) {
      const m = html.match(new RegExp(`<script type="application/x-hh-tex" data-hh-tex="${p}">([A-Za-z0-9+/=]*)</script>`));
      assert.ok(m, `embedded ${p}`);
      assert.ok(Buffer.from(m[1], 'base64').equals(b), `${p} round-trips`);
    }
    // (the game's code first: the page is up while the texture text is still being parsed)
    assert.ok(html.indexOf('window.__HH_ONEFILE') < html.indexOf('data-hh-tex='), 'textures after the code');
    assert.ok(html.trimEnd().endsWith('</html>'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
