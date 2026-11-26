// The phone profile (render3d/tier.js setPhoneProfile, SPEC §7.5.3): on phones and tablets every
// tier keeps its effects but the streamed texture sets, the decal sheets, the pixel ratio and MSAA
// are capped so a tab stays well inside an iPhone's memory. Off (desktops), every table reads
// exactly as before.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

let tier, bake, zt, gun, decals;
before(async () => {
  tier = await import('../public/js/render3d/tier.js');
  bake = await import('../public/js/render3d/world-surf-bake.js');
  zt = await import('../public/js/render3d/actor-ztex.js');
  gun = await import('../public/js/render3d/gun-tex.js');
  decals = await import('../public/js/render3d/decals.js');
});
after(() => tier.setPhoneProfile(false));

const MB = 1e6;

test('off by default: the desktop tables are untouched', () => {
  assert.equal(tier.phoneProfile(), false);
  assert.equal(bake.bakedSize('ultra', 12, 1024), 1024);
  assert.equal(bake.bakedSize('cinematic', 12, 2048), 2048);
  assert.deepEqual(decals.decalRow('ultra'), decals.DECAL_TIERS.ultra);
  assert.equal(gun.gunTexBudget('ultra') > 100 * MB, true);
  assert.equal(zt.ztexLayout('ultra').groups[0].size, 2048);
  assert.equal(tier.texScale('cinematic'), 2);
});

test('on: every tier but low streams small sets, within a phone budget', () => {
  tier.setPhoneProfile(true);
  try {
    for (const t of ['high', 'ultra', 'cinematic']) {
      const n = bake.bakedSize(t, 16, 2048);
      assert.ok(n <= 512, `${t}: world library at ${n}`);
      assert.ok(bake.bakedBytes(n, 16) <= bake.BAKED_PHONE.budget, `${t}: world library within the phone budget`);
      const lay = zt.ztexLayout(t);
      assert.ok(lay.groups.every((g) => g.size <= 512), `${t}: zombie sets at 512 or less`);
      assert.ok(zt.ztexBytes(lay) < 60 * MB, `${t}: zombie sets ${(zt.ztexBytes(lay) / MB).toFixed(0)} MB`);
      assert.ok(gun.gunTexBudget(t) < 80 * MB, `${t}: gun sets ${(gun.gunTexBudget(t) / MB).toFixed(0)} MB`);
      const d = decals.decalRow(t);
      assert.ok(d.albedo <= 1024 && d.normal === 0, `${t}: decal sheets`);
      assert.ok(tier.PHONE_PIXEL_RATIO[t] <= 1.5, `${t}: pixel ratio cap`);
    }
    // low stays low (nothing streamed)
    assert.equal(bake.bakedSize('low', 16, 1024), null);
    assert.equal(zt.ztexLayout('low'), null);
    assert.equal(gun.gunTexBudget('low'), 0);
    assert.equal(tier.texScale('cinematic'), 1, 'no doubled canvas atlases on a phone');
  } finally {
    tier.setPhoneProfile(false);
  }
});
