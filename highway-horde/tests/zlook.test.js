// Zombie looks (render3d/actor-zlook.js): every client must draw the same person for the
// same sim id, and a horde must not be a row of clones. Pure JS — no three.js involved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zombieLook, packLook, optionWords, optionsForType } from '../public/js/render3d/actor-zlook.js';
import { OPTS, optBit, TEX_W, T_OPT, T_WND1, T_SKIN, T_VAR1, T_VAR3, T_COL3 } from '../public/js/render3d/actor-consts.js';
import { ZOMBIE_IDS } from '../public/js/shared/zombies.js';

const sig = (l) => JSON.stringify([l.arch, l.skin, l.top, l.bottom, l.hairCol, [...l.opts].sort(), l.wounds, l.gait, l.eyeCol, l.hemTop, l.legHem, l.missing]);

test('same id, same look on every client', () => {
  for (const t of ZOMBIE_IDS) {
    for (const id of [1, 2, 77, 4096, 65535]) {
      assert.equal(sig(zombieLook(t, id)), sig(zombieLook(t, id)), `${t} ${id}`);
    }
  }
});

test('a horde is varied: distinct people, several archetypes, all sorts of headwear', () => {
  const seen = new Set(), arch = new Set(), hats = new Set(), hair = new Set();
  const N = 400;
  for (let id = 1; id <= N; id++) {
    const l = zombieLook('walker', id);
    seen.add(sig(l));
    arch.add(l.arch);
    hats.add(l.hat || 'none');
    hair.add(l.hairStyle || 'bald');
  }
  assert.ok(seen.size > N * 0.98, `distinct looks ${seen.size}/${N}`);
  assert.ok(arch.size >= 15, `archetypes ${arch.size}`);
  assert.ok(hats.size >= 6, `hats ${hats.size}`);
  assert.ok(hair.size >= 6, `hair styles ${hair.size}`);
  for (const t of ZOMBIE_IDS) {
    const kinds = new Set();
    for (let id = 1; id <= 200; id++) kinds.add(zombieLook(t, id).arch);
    if (t !== 'boss') assert.ok(kinds.size >= 4, `${t} archetypes ${kinds.size}`);
  }
});

test('skin tones span light to dark and stay in gamut', () => {
  let lo = 9, hi = 0;
  for (let id = 1; id <= 300; id++) {
    const l = zombieLook('walker', id);
    const y = l.skin[0] * 0.2126 + l.skin[1] * 0.7152 + l.skin[2] * 0.0722;
    lo = Math.min(lo, y); hi = Math.max(hi, y);
    for (const c of l.skin) assert.ok(c >= 0 && c <= 1);
    assert.ok(l.rot >= 0 && l.rot <= 1);
  }
  assert.ok(hi / lo > 1.8, `luminance range ${lo}..${hi}`);
});

test('every option a look asks for exists in its type model', () => {
  for (const t of ZOMBIE_IDS) {
    const allowed = optionsForType(t);
    for (let id = 1; id <= 300; id++) {
      for (const o of zombieLook(t, id).opts) {
        assert.ok(optBit(o) >= 0, `unknown option ${o}`);
        assert.ok(allowed.has(o), `${t} look uses ${o} but the model does not carry it`);
      }
    }
  }
});

test('option words: at most 3 x 24 bits, packed round trip', () => {
  assert.ok(OPTS.length <= 72);
  const w = optionWords(new Set(['hat_cap', 'shoe', 'skirt', 'chains']));
  for (const x of w) assert.ok(x >= 0 && x < (1 << 24));
  const bits = [];
  for (const name of ['hat_cap', 'shoe', 'skirt', 'chains']) bits.push(optBit(name));
  for (const b of bits) assert.ok((w[(b / 24) | 0] >> (b % 24)) & 1, `bit ${b}`);
});

test('packLook fills the rig row with finite numbers and decodes back', () => {
  const stage = new Float32Array(TEX_W * 4 * 4);
  for (let id = 1; id <= 60; id++) {
    const l = zombieLook(ZOMBIE_IDS[id % ZOMBIE_IDS.length], id);
    stage.fill(0);
    packLook(l, stage, TEX_W * 4, null);
    for (let i = 0; i < stage.length; i++) assert.ok(Number.isFinite(stage[i]));
    // the first row stays untouched
    for (let i = 0; i < TEX_W * 4; i++) assert.equal(stage[i], 0);
    const o = TEX_W * 4;
    const w = stage[o + T_WND1 * 4 + 3];
    if (l.wounds[0]) {
      const type = Math.floor(w / 8), r = w - type * 8;
      assert.equal(type, l.wounds[0].type);
      assert.ok(Math.abs(r - l.wounds[0].r) < 1e-4);
    }
    assert.ok(Math.abs(stage[o + T_SKIN * 4 + 3] - l.rot) < 1e-5);
    assert.equal(stage[o + T_VAR1 * 4 + 3], l.topPat);
    assert.ok(stage[o + T_OPT * 4] >= 0);
    assert.ok(stage[o + T_COL3 * 4] >= 0);
    assert.ok(stage[o + T_VAR3 * 4 + 2] >= 0 && stage[o + T_VAR3 * 4 + 2] < 13);
  }
});

test('garment cuts stay inside the body', () => {
  for (let id = 1; id <= 300; id++) {
    const l = zombieLook('walker', id);
    assert.ok(l.hemTop >= 10 && l.hemTop <= 100, `hem ${l.hemTop}`);
    assert.ok(l.sleeveEnd === 0 || (l.sleeveEnd >= 30 && l.sleeveEnd <= 100), `sleeve ${l.sleeveEnd}`);
    assert.ok(l.legHem === -1 || (l.legHem >= 5 && l.legHem <= 100), `leg ${l.legHem}`);
    for (const w of l.wounds) {
      assert.ok(w.y > 3 && w.y < 56 && Math.abs(w.z) < 12 && w.r > 1);
    }
  }
});
