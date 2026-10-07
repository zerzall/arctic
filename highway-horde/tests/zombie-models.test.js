// The zombies read as dead people, not dolls (render3d/actor-zmodels.js, actor-zlook.js,
// actor-zmat.js): human proportions (a head a seventh and a half of the body, shoulders no
// wider than a person's), a wasted torso, the types still unmistakable, the budgets per
// tier, and the corpse material compiled in for zombies only (the survivors' shader is
// untouched). Plain Node: three.js is resolved from the vendored copy through a loader hook.

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

let zm, consts, rigmat, THREE, look, zmat;
const TYPES = ['walker', 'runner', 'crawler', 'bloater', 'spitter', 'screamer', 'brute', 'boss'];

before(async () => {
  THREE = await import('three');
  zm = await import('../public/js/render3d/actor-zmodels.js');
  consts = await import('../public/js/render3d/actor-consts.js');
  rigmat = await import('../public/js/render3d/actor-rigmat.js');
  look = await import('../public/js/render3d/actor-zlook.js');
  zmat = await import('../public/js/render3d/actor-zmat.js');
});

/** Extents of the always-drawn vertices (no option groups) carried by a set of bones. */
function extents(a, bones = null, filter = null) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const n = a.position.length / 3;
  for (let i = 0; i < n; i++) {
    if (a.aExt[i * 2] !== 0) continue;
    if (bones && !bones.includes(a.aBones[i * 2])) continue;
    if (filter && !filter(i)) continue;
    for (let d = 0; d < 3; d++) { const v = a.position[i * 3 + d]; if (v < lo[d]) lo[d] = v; if (v > hi[d]) hi[d] = v; }
  }
  return { lo, hi, size: hi.map((v, d) => v - lo[d]) };
}

test('adult proportions: the head is about a seventh and a half of the body, not a doll\'s', () => {
  const B = consts.B;
  for (const type of ['walker', 'runner', 'spitter', 'screamer']) {
    const a = zm.buildZombie(type, 0, 0).arrays();
    const body = extents(a);
    const head = extents(a, [B.HEAD, B.JAW], (i) => a.aInfo[i * 4 + 2] === consts.MAT.SKIN);
    const ratio = head.size[1] / body.hi[1];
    assert.ok(ratio > 0.12 && ratio < 0.155, `${type}: head ${head.size[1].toFixed(2)} of ${body.hi[1].toFixed(2)} (${ratio.toFixed(3)})`);
    assert.ok(head.size[2] / body.hi[1] < 0.115, `${type}: head width ${head.size[2].toFixed(2)}`);
    // shoulders: the arms' outer edge no wider than a person's (about a quarter of the height)
    const arms = extents(a, [B.UARM_L, B.UARM_R]);
    const width = arms.hi[2] - arms.lo[2];
    assert.ok(width / body.hi[1] > 0.22 && width / body.hi[1] < 0.31, `${type}: shoulders ${width.toFixed(2)} (${(width / body.hi[1]).toFixed(3)})`);
  }
});

test('wasted bodies: a walker is gaunt (narrow waist, thin limbs), a runner fresher and fuller, the brute a hulk', () => {
  const P = (t) => zm.zombieParams(t);
  const w = P('walker'), r = P('runner'), b = P('brute'), bl = P('bloater');
  assert.ok(w.gaunt >= 1 && r.gaunt < 0.5, 'gaunt walker, fresh runner');
  assert.ok(r.armR > w.armR && r.thighR > w.thighR, 'the runner has more flesh on it');
  assert.ok(b.armR > w.armR * 1.8 && b.bulk * b.upper > 1.5, 'the brute is huge');
  assert.ok(bl.thighR > w.thighR * 1.5, 'the bloater is swollen');
  // a limb is a third of the old doll's thickness per unit height: upper arm at most 11 cm across (1 unit = 3 cm)
  assert.ok(w.armR * 2 * 3 < 11 && w.thighR * 2 * 3 < 16, `limbs ${w.armR} ${w.thighR}`);
});

test('the types stay unmistakable in silhouette', () => {
  const size = (t) => extents(zm.buildZombie(t, 1, 0).arrays()).size;
  const walker = size('walker'), bloater = size('bloater'), brute = size('brute'), crawler = size('crawler'), screamer = size('screamer');
  assert.ok(bloater[0] > walker[0] * 1.5, 'the bloater\'s belly sticks out');
  assert.ok(brute[2] > walker[2] * 1.4, 'the brute is broad');
  assert.ok(screamer[2] < walker[2], 'the screamer is thin');
  // the crawler has no shins or feet: nothing under the knee but the bone stump
  const c = zm.buildZombie('crawler', 0, 0).arrays();
  const B = consts.B;
  assert.equal(extents(c, [B.FOOT_L, B.FOOT_R]).size[1], -Infinity, 'no feet on the crawler');
  assert.ok(crawler[1] > 40);
});

test('budgets: triangles per type and LOD on every tier (dozens on screen at 4K)', () => {
  const MAX = { '-1': [62000, 4000, 1000], 0: [22000, 4000, 1000], 1: [12000, 4000, 1000], 2: [10000, 3200, 1000] };
  for (const type of TYPES) {
    for (const tier of [-1, 0, 1, 2]) {
      for (let L = 0; L < 3; L++) {
        const n = zm.buildZombie(type, L, tier).I.length / 3;
        assert.ok(n <= MAX[tier][L], `${type} tier ${tier} LOD ${L}: ${n} triangles`);
      }
    }
  }
});

test('near models carry torn strips and relief; the low tier and far models stay plain', () => {
  const P = consts.PART;
  const count = (a, part) => { let k = 0; for (let i = 0; i < a.aExt.length; i += 2) if (a.aExt[i + 1] === part) k++; return k; };
  const ultra = zm.buildZombie('walker', 0, 0).arrays(), low = zm.buildZombie('walker', 0, 2).arrays(), mid = zm.buildZombie('walker', 1, 0).arrays();
  assert.ok(count(ultra, P.TATTER) > 0 && count(ultra, P.LTATTER) > 0 && count(ultra, P.TROUSER) > 0, 'ultra near: strips and a trouser shell');
  assert.equal(count(low, P.TATTER) + count(low, P.LTATTER) + count(low, P.TROUSER), 0, 'low: none');
  assert.equal(count(mid, P.TATTER), 0, 'mid range: none');
  assert.ok(count(ultra, P.TORSO) > 0 && count(ultra, P.HEAD) > 0 && count(ultra, P.LIMB) > 0, 'skin regions tagged for the corpse shading');
});

test('models build the same way every time and stay finite', () => {
  for (const type of TYPES) {
    const a = zm.buildZombie(type, 0, 0).arrays(), b = zm.buildZombie(type, 0, 0).arrays();
    assert.equal(a.index.length, b.index.length);
    for (let i = 0; i < a.position.length; i += 13) assert.equal(a.position[i], b.position[i]);
    for (const k of ['position', 'normal', 'aInfo', 'aExt']) for (const v of a[k]) assert.ok(Number.isFinite(v), `${type} ${k}`);
  }
});

function compile(opts) {
  const shared = { uRigTex: { value: null }, uDetail: { value: null }, uDetail2: { value: null }, uNrm: { value: null }, uTime: { value: 0 }, uCin: { value: 0 } };
  const r = rigmat.makeMaterials(shared, opts);
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  r.material.onBeforeCompile(sh);
  const d = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  r.depth.onBeforeCompile(d);
  return { ...sh, depth: d.vertexShader, key: r.material.customProgramCacheKey(), dkey: r.depth.customProgramCacheKey() };
}

test('the corpse material is the zombies\' alone: survivors keep their shader and program', () => {
  const surv = compile({ rim: '#b8d0ff', rimStrength: 0.34 });
  const zomb = compile({ rim: '#8ea4c8', rimStrength: 0.2, zombie: { body: [32.4, 38.4, 45, 1], body2: [1.25, 52.5, 2.9, 1], day: { value: 1 } } });
  assert.notEqual(surv.key, zomb.key);
  assert.notEqual(surv.dkey, zomb.dkey);
  for (const id of ['uBody', 'zRelief', 'zSpec', 'rigShadowPos']) {
    assert.ok(!surv.fragmentShader.includes(id) && !surv.depth.includes(id) && !surv.vertexShader.includes(id), `survivor shader has no ${id}`);
  }
  assert.ok(zomb.fragmentShader.includes('zRelief') && zomb.fragmentShader.includes('material.specularColorBlended *= zSpec'));
  assert.ok(zomb.depth.includes('rigShadowPos'), 'zombie shadows follow the garment cuts');
  // every chunk found its anchor (a missing include would leave the three.js line in place)
  for (const inc of ['#include <roughnessmap_fragment>', '#include <normal_fragment_maps>', '#include <metalnessmap_fragment>']) {
    assert.ok(!zomb.fragmentShader.includes(inc) && !surv.fragmentShader.includes(inc), inc);
  }
  // balanced braces in every zombie chunk (a cheap syntax check without a GL context; three's own
  // chunks open functions inside #ifdef branches, so the whole program cannot be counted)
  for (const [name, src] of Object.entries(zmat)) {
    let depth = 0;
    for (const ch of src) { if (ch === '{') depth++; else if (ch === '}') depth--; assert.ok(depth >= 0, name); }
    assert.equal(depth, 0, name);
  }
});

test('the corpse material leaves three\'s light loop to it (an indoor light mask can wrap it)', () => {
  const zomb = compile({ zombie: { body: [32.4, 38.4, 45, 1], body2: [1.25, 52.5, 2.9, 1], day: { value: 1 } } });
  // the light loop, its end and the fog stay includes, resolved when the program is built, so
  // patches to those chunks (the roofs' sun and sky mask) reach the zombies too
  for (const inc of ['#include <common>', '#include <lights_fragment_begin>', '#include <lights_fragment_end>', '#include <fog_fragment>', '#include <lights_physical_fragment>']) {
    assert.ok(zomb.fragmentShader.includes(inc), inc);
  }
  // the extra light terms (wrapped "subsurface", the cloth's fuzz) scale with the light's colour
  assert.ok(/directLight\.color \* saturate\( dotNL/.test(zomb.fragmentShader) && /directLight\.color \* \( wrapNL/.test(zomb.fragmentShader));
  // the physical pars chunk is read when compiling (not copied at load): a patch made later shows
  const shared = { uRigTex: { value: null }, uDetail: { value: null }, uDetail2: { value: null }, uNrm: { value: null }, uTime: { value: 0 }, uCin: { value: 0 } };
  const r = rigmat.makeMaterials(shared, { zombie: { body: [32.4, 38.4, 45, 1], body2: [1.25, 52.5, 2.9, 1] } });
  const old = THREE.ShaderChunk.lights_physical_pars_fragment;
  // (a wrapper that chains the material's own onBeforeCompile, the way indoor.js does)
  const prev = r.material.onBeforeCompile;
  r.material.onBeforeCompile = function (sh, gl) { prev.call(this, sh, gl); sh.fragmentShader = '#define WRAPPED\n' + sh.fragmentShader; };
  try {
    THREE.ShaderChunk.lights_physical_pars_fragment = old + '\n// patched later\n';
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    r.material.onBeforeCompile(sh);
    assert.ok(sh.fragmentShader.startsWith('#define WRAPPED') && sh.fragmentShader.includes('// patched later') && sh.fragmentShader.includes('zRelief'));
  } finally {
    THREE.ShaderChunk.lights_physical_pars_fragment = old;
  }
});

test('looks: dim milky eyes, necklines, a lost shoe now and then, noses on most', () => {
  let lost = 0, noses = 0, necks = new Set();
  for (let id = 1; id <= 400; id++) {
    const l = look.zombieLook('walker', id);
    assert.ok(l.eyeGlow < 0.6, `walker ${id} eyes glow ${l.eyeGlow}`);
    if (l.shoeLost) { lost++; assert.ok(l.shoe); }
    if (l.opts.has('nose')) noses++;
    necks.add(l.neck);
  }
  assert.ok(lost > 20 && lost < 90, `lost shoes ${lost}`);
  assert.ok(noses > 250 && noses < 380, `noses ${noses}`);
  assert.ok(necks.size >= 4, `necklines ${[...necks]}`);
  assert.ok(look.zombieLook('boss', 1).eyeGlow > 1, 'the boss still burns');
});

test('the story places change who the dead were (map id seam)', () => {
  const tally = (theme, names) => { let k = 0; for (let id = 1; id <= 400; id++) if (names.includes(look.zombieLook('walker', id, theme).arch)) k++; return k; };
  const hosp = ['patient', 'scrubs', 'labcoat', 'emt'];
  assert.ok(tally('hospital', hosp) > tally('', hosp) * 2, 'patients and staff at the hospital');
  assert.ok(tally('airbase', ['soldier']) > tally('', ['soldier']) * 3, 'soldiers at the airbase');
  assert.ok(tally('mall', ['shopper', 'summer', 'sundress']) > tally('', ['shopper', 'summer', 'sundress']) * 1.8, 'shoppers at the mall');
  assert.ok(tally('railyard', ['worker', 'mechanic', 'overalls']) > tally('', ['worker', 'mechanic', 'overalls']) * 2, 'workers at the rail yard');
  // the seam is deterministic like the rest of the look
  assert.equal(JSON.stringify(look.zombieLook('walker', 42, 'mall').top), JSON.stringify(look.zombieLook('walker', 42, 'mall').top));
});

test('packLook carries the neckline and the lost shoe to the shader', () => {
  const stage = new Float32Array(consts.TEX_W * 4);
  for (let id = 1; id <= 200; id++) {
    const l = look.zombieLook('walker', id);
    stage.fill(0);
    look.packLook(l, stage, 0, null);
    assert.equal(stage[consts.T_COL5 * 4 + 3], l.neck || 0);
    // (bit 0 the lost shoe, above it the baked face and fabrics: actor-zlook ztexCode)
    const w = stage[consts.T_COL4 * 4 + 3];
    assert.equal(w % 2, l.shoeLost ? 1 : 0);
    assert.equal(Math.floor(w / 2), look.ztexCode(l));
  }
});
