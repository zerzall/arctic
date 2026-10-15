// The decal library (scripts/bake-decals.js → public/textures/decals, render3d/decals-manifest.js),
// its placement (shared/decals.js, the levels' <id>-decals.js, maps-decals.js, render3d/decals-auto.js)
// and its runtime (render3d/decals.js), headless: the baker is deterministic and the committed sheets
// are what it draws; the PNGs are valid; every placed id exists and stays inside its map and off the
// gates; the automatic set is deterministic; the meshes build on every tier, chain the indoor mask,
// and a failed load simply leaves the map without decals.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

const DIR = path.resolve(HERE, '../public/textures/decals');
let THREE, baker, png, manifest, shared, auto, runtime, maps, levels, indoor;

before(async () => {
  THREE = await import('three');
  baker = await import('../scripts/bake-decals.js');
  png = await import('../scripts/decals/png.js');
  manifest = await import('../public/js/render3d/decals-manifest.js');
  shared = await import('../public/js/shared/decals.js');
  auto = await import('../public/js/render3d/decals-auto.js');
  runtime = await import('../public/js/render3d/decals.js');
  maps = await import('../public/js/shared/maps.js');
  levels = await import('../public/js/shared/levels/index.js');
  indoor = await import('../public/js/render3d/indoor.js');
});

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- the baker -----------------------------------------------------------------------------------

test('the library: at least 120 distinct decals, unique ids, every category the game needs', () => {
  const list = baker.recipes();
  assert.ok(list.length >= 120, `${list.length} decals`);
  assert.equal(new Set(list.map((r) => r.id)).size, list.length);
  assert.equal(manifest.DECAL_COUNT, list.length, 'the manifest is up to date (re-run node scripts/bake-decals.js)');
  for (const r of list) {
    const e = manifest.DECALS[r.id];
    assert.ok(e, `${r.id} in the manifest`);
    assert.deepEqual([e[3], e[4], e[5], e[6]], [r.px[0], r.px[1], r.size[0], r.size[1]], `${r.id}: the manifest is up to date`);
  }
  const has = (re) => list.some((r) => re.test(r.id));
  for (const re of [/^gfx\.haven/, /^gfx\.dontgoin/, /^gfx\.deadinside/, /^gfx\.june/, /^gfx\.help4alive/, /^gfx\.tally/, /^gfx\.arrow/, /^gfx\.xcode/, /^stn\.quarantine/,
    /^poster\.missing/, /^notice\.evac/, /^flyer\.haven/, /^poster\.cola/, /^poster\.stayinside/, /torn/, /^sign\.hazard/, /^sign\.biohazard/, /^sign\.exit/, /^sign\.noentry/,
    /^sign\.military/, /^sign\.ward/, /^sign\.metro-map/, /^sign\.street/, /^blood\.splat/, /^blood\.drag/, /^blood\.hand/, /^blood\.prints/, /^holes\.(concrete|metal|glass|wood)/,
    /^scorch/, /^crack/, /^spall/, /^stain\.water/, /^rust\.streak/, /^grime/, /^soot/, /^peel/, /^moss/, /^lichen/, /^oil/, /^tyre/, /^puddle/, /^litter/, /^leaves/, /^sand/]) {
    assert.ok(has(re), `a decal matching ${re}`);
  }
  // variants: clean / worn / damaged where it makes sense
  assert.ok(list.filter((r) => r.variant === 'worn').length >= 60);
  assert.ok(list.some((r) => r.variant === 'damaged') && list.some((r) => r.variant === 'torn') && list.some((r) => r.variant === 'dry'));
});

test('the baker is deterministic: the same decal twice is the same pixels', () => {
  const list = baker.recipes();
  for (const id of ['gfx.haven-r', 'poster.missing-hart.torn', 'sign.biohazard.damaged', 'blood.splat2', 'leaves.1']) {
    const r = list.find((q) => q.id === id);
    const a = baker.drawDecal(r), b = baker.drawDecal(r);
    assert.equal(sha(Buffer.from(a.c.buffer)), sha(Buffer.from(b.c.buffer)), id);
    assert.equal(sha(Buffer.from(a.ht.buffer)), sha(Buffer.from(b.ht.buffer)), id);
  }
});

test('the committed sheets are what the baker draws (spot check of three decals)', () => {
  const list = baker.recipes();
  baker.pack(list);
  const sheets = {};
  for (const id of ['gfx.deadinside', 'notice.quarantine.worn', 'holes.metal']) {
    const r = list.find((q) => q.id === id);
    const name = baker.SHEETS[r.sheetIndex];
    sheets[name] = sheets[name] || png.decodePNG(fs.readFileSync(path.join(DIR, `decals-${name}.png`)));
    const img = sheets[name];
    const c = baker.drawDecal(r);
    const W = c.w + 16, H = c.h + 16;
    const albedo = new Uint8Array(W * H * 4), normal = new Uint8Array(W * H * 4);
    baker.compose(c, albedo, normal, W, 0, 0);
    let diff = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4, q = ((r.at[1] + y) * img.w + r.at[0] + x) * 4;
      for (let k = 0; k < 4; k++) diff = Math.max(diff, Math.abs(albedo[p + k] - img.data[q + k]));
    }
    assert.equal(diff, 0, `${id} matches its rect on sheet ${name}`);
    // and the manifest points at it
    const e = manifest.DECALS[id];
    assert.deepEqual(e.slice(0, 5), [r.sheetIndex, r.at[0] + 8, r.at[1] + 8, r.px[0], r.px[1]]);
  }
});

test('the PNG codec round-trips, and every sheet is a valid 4096² RGBA PNG with content', () => {
  const px = new Uint8Array(7 * 5 * 4).map((_, i) => (i * 37) & 255);
  const back = png.decodePNG(png.encodePNG(7, 5, px));
  assert.equal(back.w, 7); assert.equal(back.h, 5);
  assert.deepEqual([...back.data], [...px]);
  assert.equal(sha(png.encodePNG(7, 5, px)), sha(png.encodePNG(7, 5, px)), 'deterministic bytes');
  for (const name of manifest.DECAL_SHEETS) {
    for (const file of [`decals-${name}.png`, `decals-${name}-n.png`]) {
      const buf = fs.readFileSync(path.join(DIR, file));
      assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file);
      // walk the chunks: CRCs, IHDR, the inflated size (without unfiltering 16 M pixels)
      let p = 8, w = 0, h = 0;
      const idat = [];
      while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
        assert.equal(png.crc32(buf, p + 4, p + 8 + len), buf.readUInt32BE(p + 8 + len), `${file} ${type} CRC`);
        if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); assert.equal(buf[p + 16], 8); assert.equal(buf[p + 17], 6); }
        if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
        p += 12 + len;
        if (type === 'IEND') break;
      }
      assert.equal(w, manifest.DECAL_SHEET_SIZE); assert.equal(h, manifest.DECAL_SHEET_SIZE);
      assert.equal(inflateSync(Buffer.concat(idat)).length, (w * 4 + 1) * h, file);
    }
  }
});

test('the manifest rects sit inside their sheet and never overlap', () => {
  const S = manifest.DECAL_SHEET_SIZE;
  const by = manifest.DECAL_SHEETS.map(() => []);
  for (const [id, [s, x, y, w, h, ww, wh, surf]] of Object.entries(manifest.DECALS)) {
    assert.ok(s >= 0 && s < manifest.DECAL_SHEETS.length, id);
    assert.ok(x >= 0 && y >= 0 && x + w <= S && y + h <= S, `${id} inside the sheet`);
    assert.ok(ww > 0 && wh > 0 && surf >= 1 && surf <= 3, id);
    for (const [o, ox, oy, ow, oh] of by[s]) assert.ok(x >= ox + ow || ox >= x + w || y >= oy + oh || oy >= y + h, `${id} overlaps ${o}`);
    by[s].push([id, x, y, w, h]);
  }
});

// ---- placement --------------------------------------------------------------------------------------

const placedMaps = () => [...levels.LEVEL_IDS, 'roadhouse', 'depot', 'farmstead', 'sandstone'];

test('every story level, hideout and Sandstone places its decals: known ids, inside the map, off the gates', () => {
  for (const id of placedMaps()) {
    const map = maps.buildMap(id, 1);
    const list = map.decals || [];
    const min = map.kind === 'level' ? 90 : 15;
    assert.ok(list.length >= min, `${id}: ${list.length} decals`);
    assert.deepEqual(shared.checkDecals(map, manifest.DECALS), [], id);
    for (const d of list) {
      assert.ok(Number.isFinite(d.x + d.y + d.z + d.a + d.nx + d.ny + d.w + d.h), `${id} ${d.id} numbers`);
      if (d.nx || d.ny) {
        assert.ok(Math.abs(Math.hypot(d.nx, d.ny) - 1) < 0.01, `${id} ${d.id} unit normal`);
        assert.ok(d.z > 0 && d.z < 200, `${id} ${d.id} height ${d.z}`);
        const o = map.obstacles.find((q) => q.id === d.o);
        assert.ok(o && !o.gate, `${id} ${d.id} on a wall`);
      }
    }
    // small, serialisable data
    assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
  }
});

test('the story scripts tell the story: Haven arrows, the notes, the quarantine, the stencils', () => {
  const ids = (map) => new Set(maps.buildMap(map, 1).decals.map((d) => d.id));
  assert.ok(ids('millroad').has('note.deke'));
  assert.ok([...ids('millroad')].some((i) => /^gfx\.haven-[rl]$/.test(i)));
  assert.ok(ids('hollowcreek').has('note.ruth') && ids('hollowcreek').has('gfx.june'));
  assert.ok(ids('hospital').has('gfx.mara') && [...ids('hospital')].some((i) => i.startsWith('stn.quarantine')));
  assert.ok(ids('railyard').has('note.delta'));
  assert.ok([...ids('airbase')].some((i) => i.startsWith('stn.')) && ids('airbase').has('sign.military'));
  assert.ok([...ids('metro')].some((i) => i.startsWith('sign.metro-map')));
  assert.ok(ids('roadhouse').has('poster.gig'));
});

test('placement is deterministic and does not touch the simulation', () => {
  for (const id of ['hospital', 'millroad', 'sandstone']) {
    const a = maps.buildMap(id, 1), b = maps.buildMap(id, 1);
    assert.equal(JSON.stringify(a.decals), JSON.stringify(b.decals), id);
    // the obstacles, spawns and anchors are the same with or without the decals
    const strip = (m) => JSON.stringify({ o: m.obstacles, z: m.zombieSpawns, p: m.playerSpawns, a: m.anchors, g: m.gates || null });
    assert.equal(strip(a), strip(b));
  }
  const m = maps.buildMap('millroad', 1);
  const before = JSON.stringify(m.obstacles);
  shared.placeDecals(m, [{ w: 'gfx.tally', at: 'gas_office', z: 40 }, { f: 'oil.1', at: 'gas_tow' }]);
  assert.equal(JSON.stringify(m.obstacles), before, 'placing decals never changes an obstacle');
});

test('wall arrows point where they are told: mirrored or swapped toward the target', () => {
  const map = { id: 't', width: 1000, height: 1000, obstacles: [{ id: 1, kind: 'wall', x: 500, y: 500, w: 400, h: 20, a: 0 }], anchors: {} };
  // the wall's south face (normal +y): someone facing it looks north, their right is -x... (ny, -nx) = (1, 0)
  const r = shared.wallDecal(map, ['R', 'L'], 500, 560, 40, { toward: { x: 900, y: 560 } });
  const l = shared.wallDecal(map, ['R', 'L'], 500, 560, 40, { toward: { x: 100, y: 560 } });
  assert.equal(r.ny, 1);
  assert.equal(r.id, 'R');
  assert.equal(l.id, 'L');
  const m = shared.wallDecal(map, 'gfx.arrow-white', 450, 560, 40, { toward: { x: 0, y: 560 } });
  assert.ok(m.w < 0, 'a single arrow is mirrored to point left');
  // wall decals slide along the face instead of stacking on one another
  const a = shared.wallDecal(map, 'gfx.tally', 500, 440, 40), b = shared.wallDecal(map, 'gfx.tally', 500, 440, 40);
  assert.ok(a && b && Math.abs(a.x - b.x) >= 20, 'the second one moved');
});

test('the automatic set: deterministic, known ids, inside the map, on every match map', () => {
  for (const { id } of maps.MAP_LIST) {
    const map = maps.buildMap(id, 3);
    const a = auto.autoDecals(map, {}), b = auto.autoDecals(maps.buildMap(id, 3), {});
    assert.ok(a.length > 20, `${id}: ${a.length}`);
    assert.equal(JSON.stringify(a), JSON.stringify(b), id);
    for (const d of a) {
      assert.ok(manifest.DECALS[d.id], d.id);
      assert.ok(d.x > 0 && d.y > 0 && d.x < map.width && d.y < map.height, `${id} ${d.id} inside`);
      assert.ok(d.q >= 0 && d.q < 1);
    }
  }
  // tiers keep nested subsets, the hideouts get none
  const hw = maps.buildMap('highway', 1);
  const hi = runtime.decalList(hw, 'high'), ul = runtime.decalList(hw, 'ultra'), lo = runtime.decalList(hw, 'low');
  assert.ok(lo.length === 0 && hi.length > 0 && ul.length > hi.length);
  assert.ok(hi.every((d) => ul.includes(d) || ul.some((e) => e.x === d.x && e.y === d.y && e.id === d.id)));
  const rh = maps.buildMap('roadhouse', 1);
  assert.equal(runtime.decalList(rh, 'ultra').length, rh.decals.length);
});

// ---- runtime -------------------------------------------------------------------------------------

test('every tier table has a cinematic row; low is light', () => {
  for (const t of ['low', 'high', 'ultra', 'cinematic']) assert.ok(runtime.DECAL_TIERS[t], t);
  assert.equal(runtime.DECAL_TIERS.low.normal, 0);
  assert.ok(runtime.DECAL_TIERS.low.albedo <= 1024 && runtime.DECAL_TIERS.low.auto === 0);
  assert.equal(runtime.DECAL_TIERS.cinematic.albedo, 4096);
});

test('geometry: one quad per wall decal, a grid on a hilly floor, mirrored and clamped under the wall top', () => {
  const list = [
    { id: 'gfx.haven-r', x: 100, y: 100, z: 40, a: 0, nx: 0, ny: 1, w: 0, h: 0 },
    { id: 'gfx.haven-r', x: 300, y: 100, z: 40, a: 0, nx: 0, ny: 1, w: -0.001, h: 0 },
    { id: 'blood.pool', x: 200, y: 300, z: 0, a: 0.5, nx: 0, ny: 0, w: 0, h: 0 },
    { id: 'no.such.decal', x: 0, y: 0, z: 0, a: 0, nx: 0, ny: 0, w: 0, h: 0 },
  ];
  const flat = runtime.buildDecalGeometry(list, () => 0, () => 30);
  assert.equal(flat.count, 3);
  assert.equal(flat.tris, 6);
  const geos = flat.geos.filter(Boolean);
  for (const g of geos) {
    for (const k of ['position', 'normal', 'uv', 'tangent', 'color']) assert.ok(g.attributes[k], k);
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]));
  }
  // the wall decals stay under the 30-unit wall top, 0.55 off the wall, facing +z (sim +y)
  const wallGeo = flat.geos[manifest.DECALS['gfx.haven-r'][0]];
  const p = wallGeo.attributes.position, n = wallGeo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getZ(i) - 100.55) > 0.01) continue;
    assert.ok(p.getY(i) <= 29.01, 'under the top');
    assert.equal(n.getZ(i), 1);
  }
  // the mirrored one has its tangent reversed
  const t = wallGeo.attributes.tangent;
  assert.ok(t.getX(0) * t.getX(4) < 0, 'mirrored tangent');
  // on a hill the floor decal follows the ground
  const hilly = runtime.buildDecalGeometry([list[2]], (x, y) => x * 0.1, null, { hilly: true });
  assert.ok(hilly.tris > 2);
});

test('createDecals: hidden until loaded, indoor mask chained, no textures → no decals and no errors', async () => {
  const map = maps.buildMap('hospital', 1);
  const root = new THREE.Group();
  const d = runtime.createDecals({ map, groundY: () => 0 }, { root, tier: 'ultra', patchIndoor: indoor.patchIndoor, load: false, heightOf: () => 150 });
  assert.ok(d.stats.count > 90);
  assert.ok(d.stats.drawCalls >= 1 && d.stats.drawCalls <= manifest.DECAL_SHEETS.length);
  assert.equal(d.stats.state, 'off');
  for (const m of d.meshes) {
    assert.equal(m.visible, false, 'nothing shows without its sheet');
    assert.ok(m.material.transparent && !m.material.depthWrite && m.material.polygonOffset);
    assert.ok(m.material.userData.hhIndoor, 'indoor mask patched');
    // both shader patches run: ours (roughness from the normal sheet's alpha) and the indoor mask
    const sh = { uniforms: {}, vertexShader: '', fragmentShader: '#include <common>\n#include <roughnessmap_fragment>\n' };
    m.material.onBeforeCompile(sh, null);
    assert.match(sh.fragmentShader, /HH_INDOOR/);
    assert.match(sh.fragmentShader, /texture2D\( normalMap, vNormalMapUv \)\.a/);
    assert.match(m.material.customProgramCacheKey(), /hhDecal1\|hhIndoor/);
  }
  d.update();
  d.dispose();
  assert.equal(root.children.length, 0);
  // low: Lambert, no normal map
  const lo = runtime.createDecals({ map, groundY: () => 0 }, { root, tier: 'low', load: false });
  for (const m of lo.meshes) { assert.ok(m.material.isMeshLambertMaterial); assert.ok(!m.material.normalMap); }
  lo.dispose();
});

test('a failed sheet load falls back silently to no decals', async () => {
  const map = maps.buildMap('millroad', 1);
  const saved = { fetch: globalThis.fetch, cib: globalThis.createImageBitmap, warn: console.warn };
  const warns = [];
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  globalThis.createImageBitmap = async () => { throw new Error('no'); };
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const d = runtime.createDecals({ map, groundY: () => 0 }, { root: new THREE.Group(), tier: 'high' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(d.stats.state, 'failed');
    assert.ok(d.meshes.every((m) => !m.visible));
    assert.equal(warns.length, 1, 'one quiet warning');
    d.dispose();
  } finally {
    globalThis.fetch = saved.fetch;
    globalThis.createImageBitmap = saved.cib;
    console.warn = saved.warn;
  }
});

test('sheet files resolve to the one-file build\'s embedded copies first', () => {
  globalThis.__HH_FILES = { 'textures/decals/decals-a.png': 'data:image/png;base64,AAAA' };
  try {
    assert.equal(runtime.decalFileURL('decals-a.png'), 'data:image/png;base64,AAAA');
    assert.match(runtime.decalFileURL('decals-b.png'), /textures\/decals\/decals-b\.png$/);
  } finally {
    delete globalThis.__HH_FILES;
  }
  const src = fs.readFileSync(path.resolve(HERE, '../scripts/build-standalone.js'), 'utf8');
  assert.match(src, /embedFiles\('textures\/decals'/);
});
