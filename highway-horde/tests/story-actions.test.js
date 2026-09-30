// Station actions as pure functions (shared/story/actions.js): what a survivor can do at the
// workbench, the armory, the upgrade board, the infirmary and the perk tree, and what is
// refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, ACTIONS, MAX_DONATION } from '../public/js/shared/story/actions.js';
import { createProfile } from '../public/js/shared/story/profile.js';
import { createWorld } from '../public/js/shared/story/world.js';
import { tierCost, KIT_ITEMS, HIDEOUT_UPGRADES } from '../public/js/shared/story/upgrades.js';
import { PERK_RESET_COST } from '../public/js/shared/story/perks.js';
import { xpForLevel } from '../public/js/shared/story/progression.js';
import { setStoryContent, clearStoryContent } from '../public/js/shared/story/content.js';
import { STUB_CONTENT } from '../public/js/shared/story/stub-content.js';

function state(over = {}) {
  const profile = { ...createProfile({ name: 'A', cls: 'soldier' }), scrap: 500, ...over.profile };
  const world = over.world || createWorld({ name: 'W', now: 1 });
  return { profile, world, actor: { isHost: !!over.host }, chapter: over.chapter || 1, now: 50 };
}

test('every action id is listed and unknown ones are refused', () => {
  assert.deepEqual(ACTIONS.slice().sort(), ['buygun', 'buykit', 'diff', 'donate', 'flag', 'hideout', 'kit', 'loadout', 'perk', 'rename', 'reset', 'talk', 'tier']);
  const s = state();
  for (const bad of [null, undefined, 'x', 5, {}, { a: 5 }, { a: 'format' }, { a: '__proto__' }]) {
    const r = applyAction(s, bad);
    assert.equal(r.ok, false);
  }
});

test('the generator discounts weapon upgrades at the workbench', () => {
  const s = state();
  const plain = applyAction(s, { a: 'tier', weapon: 'rifle' });
  assert.equal(plain.note.cost, tierCost('rifle', 1));
  const powered = state({ world: { ...s.world, hideout: { ...s.world.hideout, upgrades: { generator: 3 } } } });
  const cheaper = applyAction(powered, { a: 'tier', weapon: 'rifle' });
  assert.equal(cheaper.note.cost, Math.round(tierCost('rifle', 1) * 0.8));
  assert.equal(cheaper.profile.scrap, 500 - cheaper.note.cost);
});

test('perk reset is free once per chapter, then costs scrap; nothing to reset is refused', () => {
  const base = { xp: xpForLevel(6), perkPoints: 0, perks: { steady: 2, quick: 1 } };
  const s = state({ profile: base });
  assert.equal(applyAction(state(), { a: 'reset' }).reason, 'nothing');
  const first = applyAction(s, { a: 'reset' });
  assert.equal(first.ok, true);
  assert.equal(first.profile.perkPoints, 3);
  assert.equal(first.profile.scrap, 500);
  assert.equal(first.profile.perkReset, 1);
  assert.equal(first.note.free, true);
  const again = applyAction({ ...s, profile: { ...s.profile, perkReset: 1 } }, { a: 'reset' });
  assert.equal(again.profile.scrap, 500 - PERK_RESET_COST);
  assert.equal(again.note.free, false);
  const broke = applyAction({ ...s, profile: { ...s.profile, perkReset: 1, scrap: 5 } }, { a: 'reset' });
  assert.equal(broke.reason, 'scrap');
  // a new chapter makes it free again
  assert.equal(applyAction({ ...s, chapter: 2, profile: { ...s.profile, perkReset: 1 } }, { a: 'reset' }).note.free, true);
});

test('donating: bounded by what you hold and by the stash', () => {
  const s = state();
  const r = applyAction(s, { a: 'donate', scrap: 120 });
  assert.equal(r.profile.scrap, 380);
  assert.equal(r.world.hideout.stash.scrap, s.world.hideout.stash.scrap + 120);
  assert.equal(applyAction(s, { a: 'donate', scrap: 9999 }).reason, 'scrap');
  const rich = state({ profile: { scrap: 99999 } });
  assert.equal(applyAction(rich, { a: 'donate', scrap: 50000 }).world.hideout.stash.scrap, rich.world.hideout.stash.scrap + MAX_DONATION);
  for (const bad of [0, -1, 'x', NaN, null]) assert.equal(applyAction(s, { a: 'donate', scrap: bad }).reason, 'invalid');
  const full = state();
  full.world.hideout.stash.scrap = 9990;
  assert.equal(applyAction(full, { a: 'donate', scrap: 50 }).reason, 'full');
});

test('supplies: take up to the carry limit and the stock, put back, buy into the stash', () => {
  const s = state();
  s.world.hideout.stash.frag = 10;
  const take = applyAction(s, { a: 'kit', item: 'frag', n: 9 });
  assert.equal(take.profile.kit.frag, KIT_ITEMS.frag.max, 'capped at the carry limit');
  assert.equal(take.world.hideout.stash.frag, 10 - KIT_ITEMS.frag.max);
  assert.equal(applyAction({ ...s, profile: take.profile, world: take.world }, { a: 'kit', item: 'frag', n: 1 }).reason, 'max');
  const back = applyAction({ ...s, profile: take.profile, world: take.world }, { a: 'kit', item: 'frag', n: -2 });
  assert.equal(back.profile.kit.frag, KIT_ITEMS.frag.max - 2);
  assert.equal(back.world.hideout.stash.frag, 10 - KIT_ITEMS.frag.max + 2);
  const all = applyAction({ ...s, profile: back.profile, world: back.world }, { a: 'kit', item: 'frag', n: -9 });
  assert.equal(all.profile.kit.frag, undefined);
  assert.equal(applyAction(s, { a: 'kit', item: 'frag', n: -1 }).reason, 'nothing');
  s.world.hideout.stash.turret = 0;
  assert.equal(applyAction(s, { a: 'kit', item: 'turret', n: 1 }).reason, 'empty');
  assert.equal(applyAction(s, { a: 'kit', item: 'gold', n: 1 }).reason, 'unknown');
  assert.equal(applyAction(s, { a: 'kit', item: 'frag', n: 0 }).reason, 'invalid');
  assert.equal(applyAction(s, { a: 'kit', item: 'frag', n: 100 }).reason, 'invalid');
  const buy = applyAction(s, { a: 'buykit', item: 'turret' });
  assert.equal(buy.profile.scrap, 500 - KIT_ITEMS.turret.scrap);
  assert.equal(buy.world.hideout.stash.turret, 1);
  assert.equal(applyAction(state({ profile: { scrap: 3 } }), { a: 'buykit', item: 'turret' }).reason, 'scrap');
});

test('hideout upgrades spend the stash and bump the world revision', () => {
  const s = state();
  s.world.hideout.stash.scrap = 500;
  s.world.hideout.stash.parts = 5;
  const r = applyAction(s, { a: 'hideout', id: 'infirmary' });
  assert.equal(r.ok, true);
  assert.equal(r.world.hideout.upgrades.infirmary, 1);
  assert.equal(r.world.hideout.stash.scrap, 500 - HIDEOUT_UPGRADES.infirmary.tiers[0].cost.scrap);
  assert.equal(r.world.rev, s.world.rev + 1);
  assert.equal(r.profile, s.profile, 'no profile change');
  assert.equal(applyAction(state(), { a: 'hideout', id: 'infirmary' }).ok, false);
});

test('host-only actions: difficulty and the campaign name', () => {
  const s = state();
  assert.equal(applyAction(s, { a: 'diff', difficulty: 'hard' }).reason, 'host');
  assert.equal(applyAction(s, { a: 'rename', name: 'X' }).reason, 'host');
  const h = state({ host: true });
  assert.equal(applyAction(h, { a: 'diff', difficulty: 'hard' }).world.difficulty, 'hard');
  assert.equal(applyAction(h, { a: 'diff', difficulty: 'godlike' }).reason, 'invalid');
  assert.equal(applyAction(h, { a: 'diff', difficulty: 'normal' }).world, h.world, 'no change, no new revision');
  assert.equal(applyAction(h, { a: 'rename', name: '  The  Reds ' }).world.name, 'The Reds');
  assert.equal(applyAction(h, { a: 'rename', name: '​' }).reason, 'invalid');
});

test('flags: scenes seen and topics heard, only well-formed or known ones', () => {
  const s = state();
  assert.equal(applyAction(s, { a: 'flag', flag: 'seen_arrival_depot' }).world.progress.flags.seen_arrival_depot, true);
  assert.equal(applyAction(s, { a: 'flag', flag: 'seen_epilogue' }).world.progress.flags.seen_epilogue, true);
  assert.equal(applyAction(s, { a: 'flag', flag: 'bus_running' }).reason, 'invalid', 'mission flags come from rewards, not from a client');
  assert.equal(applyAction(s, { a: 'flag', flag: '__proto__' }).reason, 'invalid');
  assert.equal(applyAction(s, { a: 'flag', flag: 5 }).reason, 'invalid');
  const again = applyAction(s, { a: 'flag', flag: 'seen_epilogue' });
  assert.equal(applyAction({ ...s, world: again.world }, { a: 'flag', flag: 'seen_epilogue' }).world, again.world);
  // a dialogue topic's own flags are allowed once the content is installed
  setStoryContent(STUB_CONTENT);
  try {
    assert.equal(applyAction(s, { a: 'flag', flag: 'asked_mara' }).world.progress.flags.asked_mara, true);
  } finally {
    clearStoryContent();
  }
});

test('talking sets a flag once and only for well-formed ids', () => {
  const s = state();
  const r = applyAction(s, { a: 'talk', npc: 'mara' });
  assert.equal(r.world.progress.flags.talked_mara, true);
  assert.equal(applyAction({ ...s, world: r.world }, { a: 'talk', npc: 'mara' }).world, r.world, 'already known: same world');
  assert.equal(applyAction(s, { a: 'talk', npc: 'Mara!' }).reason, 'invalid');
  assert.equal(applyAction(s, { a: 'talk' }).reason, 'invalid');
});
