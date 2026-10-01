// The shader patches of the world and ground materials (render3d/world-mat.js, ground.js) in plain
// Node, no GL: every chunk they hook must still exist in the vendored three.js (an upgrade that renames
// one would silently drop the detail layers), the patched programs must read both slices of the layer
// array and the per-layer tables, and the parallax quality must follow the tier.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

let THREE, mat, surf, ground;

before(async () => {
  THREE = await import('three');
  surf = await import('../public/js/render3d/world-surf.js');
  mat = await import('../public/js/render3d/world-mat.js');
  ground = await import('../public/js/render3d/ground.js');
});

/** Run a material's onBeforeCompile on three's own standard program, as the renderer would. */
function compile(m, lib = 'standard') {
  const src = THREE.ShaderLib[lib];
  const sh = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  m.onBeforeCompile(sh);
  return sh;
}

/** The hooked includes still exist in three's shader source (else the patch is a silent no-op). */
test('the chunks the patches hook exist in the vendored three.js', () => {
  const frag = THREE.ShaderLib.standard.fragmentShader, vert = THREE.ShaderLib.standard.vertexShader;
  for (const inc of ['common', 'color_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_maps', 'lights_fragment_begin', 'emissivemap_fragment', 'map_fragment']) {
    assert.ok(frag.includes(`#include <${inc}>`), inc);
  }
  for (const inc of ['common', 'begin_vertex', 'worldpos_vertex']) assert.ok(vert.includes(`#include <${inc}>`), inc);
  const lights = THREE.ShaderChunk.lights_fragment_begin;
  assert.ok(lights.includes('getDirectionalLightInfo( directionalLight, directLight );'));
  assert.ok(lights.includes('getSunLightInfo( sunLight, directLight );'));
});

test('world materials: both slices, the tables, parallax and the relief shadow are in the program', () => {
  const detail = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * surf.DET_LAYERS * 2), 4, 4, surf.DET_LAYERS * 2);
  const mats = mat.createWorldMaterials({ detail, atlas: null, chain: null, leaves: null });
  for (const key of ['std', 'paint', 'glass']) {
    const sh = compile(mats.hi[key], key === 'paint' ? 'physical' : 'standard');
    const f = sh.fragmentShader;
    assert.ok(f.includes(`uniform vec4 uDetP[${surf.DET_LAYERS}]`), key + ' per-layer parameters');
    assert.ok(f.includes(`uniform vec4 uDetG[${surf.DET_LAYERS}]`), key + ' element grids');
    assert.ok(f.includes(`hhL + ${surf.DET_LAYERS}.0`), key + ' reads the colour / height slice');
    assert.ok(f.includes('textureGrad(uDetail'), key + ' parallax samples');
    assert.equal((f.match(/hhSelfShadow\( directLight\.direction \)/g) || []).length, 2, key + ' relief shadow on the sun and directional lights');
    assert.ok(!/#include <lights_fragment_begin>/.test(f), key + ' light loop replaced');
    assert.equal(sh.uniforms.uDetP.value, surf.DET_PARAMS);
    assert.equal(sh.uniforms.uDetG.value, surf.DET_CELLS);
    assert.equal(sh.uniforms.uDetQ, mat.DETAIL_TIER);
    assert.ok(sh.vertexShader.includes('vDet = aDet;'));
    if (key === 'glass') assert.ok(f.includes('hhRoomCol'), 'glass keeps its rooms');
    else assert.ok(f.includes('float foot = wall'), key + ' weathering (splash dirt at the foot of walls)');
  }
  mats.dispose();
});

test('other modules\' patches survive: the light chunk is read at compile time, an earlier onBeforeCompile is chained', () => {
  // (indoor.js patches lights_fragment_begin in place and wraps the materials' onBeforeCompile)
  const C = THREE.ShaderChunk, orig = C.lights_fragment_begin;
  C.lights_fragment_begin = '// patched-later\n' + orig.replace('getSunLightInfo( sunLight, directLight );', 'getSunLightInfo( sunLight, directLight );\n\t\t// sun-later');
  try {
    const m = new THREE.MeshStandardMaterial();
    let ran = 0;
    m.onBeforeCompile = (sh) => { ran++; sh.fragmentShader = '// before\n' + sh.fragmentShader; };
    m.customProgramCacheKey = () => 'theirs';
    mat.patchDetail(m, { uDetail: { value: null }, uDetN: { value: 1 } }, 'mine');
    const f = compile(m).fragmentShader;
    assert.equal(ran, 1, 'the earlier patch ran');
    assert.ok(f.startsWith('// before\n'), 'and its change was kept');
    assert.ok(f.includes('// patched-later') && f.includes('// sun-later'), 'the chunk as patched after world-mat.js loaded');
    assert.equal((f.match(/hhSelfShadow\( directLight\.direction \)/g) || []).length, 2, 'relief shadow still applied');
    assert.equal(m.customProgramCacheKey(), 'theirs|mine');
    m.dispose();
  } finally {
    C.lights_fragment_begin = orig;
  }
});

test('parallax quality follows the tier: none on low and high, ultra short, cinematic long with shadows', () => {
  const q = (t) => { mat.setDetailTier(t); return mat.DETAIL_TIER.value.toArray(); };
  assert.equal(q('low')[0], 0);
  assert.equal(q('high')[0], 0);
  const u = q('ultra'), c = q('cinematic');
  assert.equal(u[0], 1);
  assert.equal(c[0], 2);
  assert.ok(c[2] > u[2] && c[3] > u[3], 'cinematic marches more steps, farther');
  assert.equal(q('bogus')[0], 0, 'an unknown tier reads as high');
  mat.setDetailTier('high');
});

test('ground material: layers with their colour slice, height-blended, puddles in the low spots', () => {
  const uniforms = { detailMap: { value: null }, wetness: { value: 1 }, uDetail: { value: null }, uMask: { value: null }, uMaskRect: { value: new THREE.Vector4() }, uTime: { value: 0 }, uRain: { value: 0 }, uDesert: { value: 0 } };
  const m = ground.makeGroundMaterial(new THREE.Texture(), uniforms);
  const sh = compile(m);
  const f = sh.fragmentShader;
  assert.ok(f.includes(`layer + ${surf.DET_LAYERS}.0`), 'colour / height slice');
  assert.ok(f.includes('gCc = (cA * bA + cC * bC + cG * bG + cL * bL) / bs;'), 'height blend');
  assert.ok(f.includes('gDamp'), 'damp rims');
  assert.ok(sh.vertexShader.includes('vGroundXZ = '), 'world position');
  for (const k of Object.keys(uniforms)) assert.equal(sh.uniforms[k], uniforms[k], k);
  m.dispose();
});
