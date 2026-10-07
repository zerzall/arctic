// The baked gun materials and skins (SPEC §7.5 "Gun materials and skins"): the baker is
// deterministic and writes valid PNGs of the right sizes, every gun has a material for every
// part, the skins are complete and travel in the roster, and the renderer keeps a fallback
// for when the textures are not there. (The renderer itself imports three.js: its source is
// inspected, the browser e2e runs it.)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeSet, sets, OUT_DIR, WEAR_SIZE } from '../scripts/bake-guns.js';
import { encodePNG, decodePNG } from '../scripts/guns/png.js';
import { FAMILY_RECIPES } from '../scripts/guns/recipes-base.js';
import { SKIN_RECIPES } from '../scripts/guns/recipes-skins.js';
import {
  GUN_FAMILIES, FAMILY_LAYER, WEAPON_FINISH, GUN_CLASS, familyFor, gripFamilyFor, finishOf, GUN_SKINS, GUN_SKIN_IDS,
  DEFAULT_SKIN, SKIN_PATTERNS, PATTERN_TILE, SKIN_SIZE, sanitizeSkin, familyGroup, GUN_WEAR_FILE,
} from '../public/js/shared/gun-finish.js';
import { WEAPONS, WEAPON_IDS } from '../public/js/shared/weapons.js';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { FakeGame } from './fixtures/net-fake-game.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R3D = join(ROOT, 'public', 'js', 'render3d');
const read = (f) => readFileSync(join(R3D, f), 'utf8');

describe('baker', () => {
  test('every family, skin pattern and the wear overlay has a recipe and a set', () => {
    for (const f of GUN_FAMILIES) assert.equal(typeof FAMILY_RECIPES[f.id], 'function', f.id);
    for (const p of SKIN_PATTERNS) assert.equal(typeof SKIN_RECIPES[p], 'function', p);
    const names = sets().map((s) => s.name);
    assert.equal(new Set(names).size, names.length, 'set names are unique');
    assert.equal(names.length, GUN_FAMILIES.length + SKIN_PATTERNS.length + 1);
    assert.ok(names.includes(GUN_WEAR_FILE));
  });

  test('deterministic: the same set bakes to the same bytes, different sets differ', () => {
    const pick = ['parkerized', 'walnut', 'poly_grip', 'skin_damascus', 'skin_blood', GUN_WEAR_FILE];
    const byName = Object.fromEntries(sets().map((s) => [s.name, s]));
    const seen = new Set();
    for (const name of pick) {
      const a = bakeSet(byName[name], 64).files, b = bakeSet(byName[name], 64).files;
      assert.deepEqual(Object.keys(a), Object.keys(b));
      for (const k of Object.keys(a)) {
        assert.ok(a[k].equals(b[k]), `${k} rebakes identically`);
        const h = a[k].toString('base64');
        assert.ok(!seen.has(h), `${k} differs from the other sets`);
        seen.add(h);
      }
    }
  });

  test('the PNG writer round-trips every channel count', () => {
    for (const ch of [1, 2, 3, 4]) {
      const w = 13, hgt = 7, px = new Uint8Array(w * hgt * ch);
      for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 3) * 11) & 255;
      const d = decodePNG(encodePNG(w, hgt, ch, px));
      assert.equal(d.w, w); assert.equal(d.h, hgt); assert.equal(d.ch, ch);
      assert.deepEqual(Array.from(d.data), Array.from(px));
    }
  });

  test('a small bake has sane channels: normals point out, roughness and AO in range', () => {
    const set = sets().find((s) => s.name === 'anod_black');
    const { maps } = bakeSet(set, 64);
    let zMin = 255, aoMin = 255;
    for (let i = 0; i < 64 * 64; i++) {
      zMin = Math.min(zMin, maps.nrm[i * 3 + 2]);
      aoMin = Math.min(aoMin, maps.orm[i * 3]);
    }
    assert.ok(zMin > 128, 'normal z > 0 everywhere');
    assert.ok(aoMin > 64, 'AO never black');
  });
});

describe('the baked files', () => {
  const files = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.endsWith('.png')) : [];
  test('every file of every set is there (and nothing else)', () => {
    const want = new Set();
    for (const f of GUN_FAMILIES) for (const m of ['albedo', 'normal', 'orm']) want.add(`${f.id}_${m}.png`);
    for (const p of SKIN_PATTERNS) for (const m of ['albedo', 'normal', 'orm']) want.add(`skin_${p}_${m}.png`);
    want.add(`${GUN_WEAR_FILE}.png`);
    for (const w of want) assert.ok(files.includes(w), `${w} baked`);
    for (const f of files) assert.ok(want.has(f), `${f} belongs to a set`);
  });

  test('valid PNGs of the right size and layout (CRCs checked by the decoder)', () => {
    const size = (f) => {
      if (f === `${GUN_WEAR_FILE}.png`) return WEAR_SIZE;
      if (f.startsWith('skin_')) return SKIN_SIZE;
      return GUN_FAMILIES.find((x) => f.startsWith(x.id + '_')).size;
    };
    for (const f of files) {
      const d = decodePNG(readFileSync(join(OUT_DIR, f)));
      assert.equal(d.w, size(f), f);
      assert.equal(d.h, size(f), f);
      const ch = f === `${GUN_WEAR_FILE}.png` || (f.startsWith('skin_') && f.endsWith('_albedo.png')) ? 4 : 3;
      assert.equal(d.ch, ch, `${f}: ${ch} channels`);
    }
  });

  test('main families are 2048², small parts and skins 1024²', () => {
    for (const f of GUN_FAMILIES) assert.ok(f.size === 2048 || (f.size === 1024 && ['grip', 'metal', 'coating'].includes(f.group)), f.id);
    assert.ok(GUN_FAMILIES.filter((f) => f.size === 2048).length >= 12);
  });
});

describe('material assignment', () => {
  test('every weapon has a finish naming real families', () => {
    for (const id of WEAPON_IDS) {
      const f = WEAPON_FINISH[id];
      assert.ok(f, `${id} has a finish`);
      for (const k of ['steel', 'alloy', 'wood', 'grip', 'colour']) assert.ok(FAMILY_LAYER[f[k]] !== undefined, `${id}.${k} = ${f[k]}`);
      assert.ok(f.poly === 'auto' || FAMILY_LAYER[f.poly] !== undefined, `${id}.poly`);
    }
  });

  test('every part of every gun maps to a family (lenses and markings excepted)', () => {
    const colours = ['#1b1c1e', '#35393e', '#060606', '#8d8d8d', '#c62828', '#5a3b22', '#c9a24a', '#e2541b', '#2f3326', '#8a7350', '#d8d0c0'];
    for (const id of WEAPON_IDS) {
      const sp = WEAPONS[id].sprite;
      for (const [name, cls] of Object.entries(GUN_CLASS)) {
        for (const c of [...colours, sp.color, sp.accent]) {
          const fam = familyFor(cls, c, id);
          if (name === 'LENS' || name === 'MARK') assert.equal(fam, null, `${id} ${name}`);
          else assert.ok(FAMILY_LAYER[fam] !== undefined, `${id} ${name} ${c} → ${fam}`);
        }
      }
    }
  });

  test('the assignment reads the part: wood is wood, rubber is rubber, identity colours stay coloured', () => {
    assert.equal(familyFor(GUN_CLASS.WOOD, '#5a3b22', 'shotgun'), 'walnut');
    assert.equal(familyFor(GUN_CLASS.WOOD, '#c09a6a', 'shotgun'), 'birch');
    assert.equal(familyFor(GUN_CLASS.RUBBER, '#161616', 'rifle'), 'rubber');
    assert.equal(familyFor(GUN_CLASS.STEEL, '#23262b', 'shotgun'), 'blued');
    assert.equal(familyFor(GUN_CLASS.ALLOY, '#2f3326', 'rifle'), 'anod_od');
    assert.equal(familyFor(GUN_CLASS.POLY, '#8a7350', 'crossbow'), 'poly_fde');
    assert.equal(familyFor(GUN_CLASS.PAINT, '#e2541b', 'flare'), 'paint');
    assert.equal(familyFor(GUN_CLASS.STEEL, '#0d47a1', 'tesla'), 'cerakote', 'a vivid colour keeps its hue');
    assert.equal(familyFor(GUN_CLASS.STEEL, '#35393e', 'pistol', 'sight'), 'sight', 'a builder hint wins');
    assert.equal(gripFamilyFor(GUN_CLASS.WOOD, 'magnum'), 'checker');
    assert.equal(gripFamilyFor(GUN_CLASS.POLY, 'pistol'), 'poly_grip');
    assert.ok(finishOf('no-such-gun'), 'a default finish for anything else (turrets, pickups)');
  });

  test('the builders tag sights and knurled turrets, and every vertex carries its family', () => {
    const src = read('actor-guns.js');
    assert.match(src, /fin: 'sight'/);
    assert.match(src, /fin: 'knurl'/);
    assert.match(src, /setAttribute\('aGun', new THREE\.Float32BufferAttribute\(b\.gun, 4\)\)/);
    assert.match(src, /familyFor\(mat, o\.color/);
  });
});

describe('skins', () => {
  test('at least twelve, with the requested ones', () => {
    assert.ok(GUN_SKINS.length >= 12);
    for (const id of ['factory', 'battleworn', 'woodland', 'desert', 'urban', 'arctic', 'tiger', 'carbon', 'damascus', 'gold', 'zombie', 'hazard']) assert.ok(GUN_SKIN_IDS.includes(id), id);
    assert.equal(DEFAULT_SKIN, 'factory');
  });

  test('every skin is complete: pattern baked, tile set, covered groups real, swatch colours', () => {
    const groups = new Set(GUN_FAMILIES.map((f) => f.group));
    for (const s of GUN_SKINS) {
      if (s.pattern) {
        assert.ok(SKIN_PATTERNS.includes(s.pattern), `${s.id}: pattern ${s.pattern}`);
        assert.ok(PATTERN_TILE[s.pattern] > 0);
        assert.ok(s.covers.length > 0, `${s.id} covers something`);
      }
      for (const g of s.covers) assert.ok(groups.has(g), `${s.id}: group ${g}`);
      assert.ok(s.wear > 0 && s.grime > 0 && s.scratch > 0);
      assert.equal(s.swatch.length, 3);
      for (const c of s.swatch) assert.match(c, /^#[0-9a-f]{6}$/);
      assert.ok(s.name && s.desc);
    }
    assert.equal(familyGroup('walnut'), 'wood');
  });

  test('sanitizeSkin falls back to the factory finish', () => {
    assert.equal(sanitizeSkin('gold'), 'gold');
    for (const bad of [undefined, null, '', 'GOLD', 'nope', 7, {}]) assert.equal(sanitizeSkin(bad), 'factory');
  });

  test('the skin rides in the roster: hello, profile changes (in game too), junk sanitised', async () => {
    const hub = createLocalHub({ code: 'ABCDE' });
    const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
    const now = () => 1000;
    const host = await hostGame({ name: 'Bob', color: 0, cls: 'soldier', skin: 'gold', transport: hub.host, hooks: { now, manual: true, createGame: (o) => new FakeGame(o) } });
    const c = await joinGame({ name: 'Ann', color: 1, cls: 'medic', skin: 'tiger', via: hub.connect(), hooks: { now, manual: true } });
    await flush();
    assert.equal(host.roster.find((r) => r.id === 1).skin, 'gold');
    assert.equal(host.roster.find((r) => r.id === c.localId).skin, 'tiger');
    c.setProfile({ skin: 'zombie' });
    await flush();
    assert.equal(host.roster.find((r) => r.id === c.localId).skin, 'zombie');
    c.setProfile({ skin: '<script>' });
    await flush();
    assert.equal(host.roster.find((r) => r.id === c.localId).skin, 'factory');
    host.setProfile({ skin: 'carbon' });
    await flush();
    assert.equal(c.roster.find((r) => r.id === 1).skin, 'carbon', 'the client sees the host\'s');
    const bot = host.addBot();
    assert.ok(GUN_SKIN_IDS.includes(bot.skin), 'bots wear one too');
    c.leave && c.leave();
    host.leave && host.leave();
  });
});

describe('renderer (source)', () => {
  const mat = read('gun-mat.js'), tex = read('gun-tex.js'), vm = read('viewmodel.js'), vml = read('vm-light.js');
  test('fallback: the procedural atlas path stays, a uniform switches to the textures (no recompile)', () => {
    assert.match(mat, /if \(!gTexOn\)/, 'the atlas path');
    assert.match(mat, /uGunTexOn > 0\.5/, 'textures only once loaded');
    assert.match(tex, /uGunTexOn: \{ value: 0 \}/, 'off until the upload');
    assert.match(tex, /function canLoad\(\)/);
    assert.match(tex, /typeof createImageBitmap !== 'function'/, 'no decoder: no textures');
    assert.match(tex, /guntex=0/, 'switchable off for before / after shots');
    assert.match(tex, /catch \(err\)/, 'a failed file leaves the guns on the procedural finish');
    assert.match(tex, /low: null/, "'low' never loads them");
  });

  test('the one-file build embeds the gun textures and the loader reads them', () => {
    const build = readFileSync(join(ROOT, 'scripts', 'build-standalone.js'), 'utf8');
    assert.match(build, /embedFiles\('textures\/guns'/);
    assert.match(tex, /globalThis\.__HH_FILES/);
  });

  test('the indoor mask can chain on (onBeforeCompile set once, stable program key)', () => {
    assert.equal((mat.match(/mat\.onBeforeCompile =/g) || []).length, 1);
    assert.match(mat, /mat\.customProgramCacheKey = \(\) =>/);
  });

  test('every per-tier table has a cinematic row', () => {
    assert.match(tex, /cinematic: \{ family: 2048/);
    assert.match(vml, /cinematic: \d/);
  });

  test('the viewmodel wears the skin and mirrors the world lights', () => {
    assert.match(vm, /setGunMaterialSkin\(gunMat, skin\)/);
    assert.match(vm, /createVmLighting\(ctx, scene\)/);
    assert.match(vml, /envMapRotation|envRotation/);
    assert.match(vml, /poolLights/);
    assert.match(vml, /indoorAt/);
  });
});
