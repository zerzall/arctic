// Station actions (STORY.md §5.5): everything a survivor can do at the workbench, the
// armory, the upgrade board, the infirmary and the perk tree, as pure functions over the
// player's profile and the crew's world. The host session applies them to the profiles it
// holds (a client only ever sends { a, ...args }); the UI shows the same checks up front.
//
//   applyAction({ profile, world, actor:{ isHost }, chapter }, act) →
//     { ok: true, profile, world, note? } | { ok: false, reason }
//
// `profile` and `world` in the result are the new versions (the same objects when nothing
// changed). Nothing here touches storage or the network.

import { DIFFICULTY_IDS } from '../constants.js';
import { buyPerk, resetPerks, PERK_RESET_COST } from './perks.js';
import {
  upgradeWeapon, buyWeapon, setLoadout, upgradeHideout, hideoutEffects, KIT_ITEMS, isKitItem, MAX_TIER,
} from './upgrades.js';
import { changeWorld, MAX_STASH, MAX_FLAGS } from './world.js';
import { cleanText } from './profile.js';
import { contentFlags } from './content.js';

/** Action ids a client may send. */
export const ACTIONS = ['loadout', 'tier', 'buygun', 'perk', 'reset', 'hideout', 'donate', 'kit', 'buykit', 'talk', 'flag', 'diff', 'rename', 'daylight'];

/** Flags a player may set from the client: conversations heard and scenes seen (plus the ones dialogue topics set). */
const CLIENT_FLAG = /^(talked|seen)_[a-z0-9_]{1,32}$/;

/** Most scrap moved into the stash in one action. */
export const MAX_DONATION = 1000;

function fail(reason) {
  return { ok: false, reason };
}

/**
 * Apply one action.
 * @param {{ profile: object, world: object, actor?: { isHost?: boolean }, chapter?: number, now?: number }} state
 * @param {{ a: string }} act the message (untrusted)
 */
export function applyAction(state, act) {
  const { profile, world } = state;
  const chapter = state.chapter || 1;
  const now = state.now || Date.now();
  if (!act || typeof act !== 'object' || typeof act.a !== 'string') return fail('invalid');
  switch (act.a) {
    case 'loadout': {
      const r = setLoadout(profile, act.loadout);
      return r.ok ? { ok: true, profile: r.profile, world } : fail(r.reason);
    }
    case 'tier': {
      const bench = hideoutEffects(world.hideout.upgrades).bench;
      const r = upgradeWeapon(profile, act.weapon, bench);
      return r.ok ? { ok: true, profile: r.profile, world, note: { weapon: act.weapon, tier: r.tier, cost: r.cost } } : fail(r.reason);
    }
    case 'buygun': {
      const r = buyWeapon(profile, act.weapon, chapter);
      return r.ok ? { ok: true, profile: r.profile, world, note: { weapon: act.weapon, cost: r.cost } } : fail(r.reason);
    }
    case 'perk': {
      const r = buyPerk(profile, act.perk);
      return r.ok ? { ok: true, profile: r.profile, world, note: { perk: act.perk, rank: r.rank } } : fail(r.reason);
    }
    case 'reset': {
      if (!Object.keys(profile.perks).length) return fail('nothing');
      const free = profile.perkReset !== chapter;
      if (!free && (profile.scrap | 0) < PERK_RESET_COST) return fail('scrap');
      const next = resetPerks(profile);
      return {
        ok: true,
        world,
        profile: { ...next, perkReset: chapter, scrap: free ? next.scrap : next.scrap - PERK_RESET_COST },
        note: { free },
      };
    }
    case 'hideout': {
      const r = upgradeHideout(world, act.id, chapter);
      if (!r.ok) return fail(r.reason);
      const w = changeWorld(world, (d) => {
        d.hideout.stash = r.stash;
        d.hideout.upgrades = r.upgrades;
      }, now);
      return { ok: true, profile, world: w, note: { id: act.id, tier: r.tier } };
    }
    case 'donate': {
      const n = Math.floor(Number(act.scrap));
      if (!Number.isFinite(n) || n < 1) return fail('invalid');
      const give = Math.min(n, MAX_DONATION);
      if ((profile.scrap | 0) < give) return fail('scrap');
      if ((world.hideout.stash.scrap | 0) + give > MAX_STASH) return fail('full');
      const w = changeWorld(world, (d) => { d.hideout.stash.scrap += give; }, now);
      return { ok: true, profile: { ...profile, scrap: profile.scrap - give }, world: w, note: { scrap: give } };
    }
    case 'kit': {
      if (!isKitItem(act.item)) return fail('unknown');
      const n = Math.floor(Number(act.n));
      if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 9) return fail('invalid');
      const have = (profile.kit && profile.kit[act.item]) | 0;
      const stock = (world.hideout.stash[act.item] | 0);
      if (n > 0) {
        const take = Math.min(n, KIT_ITEMS[act.item].max - have, stock);
        if (take <= 0) return fail(stock <= 0 ? 'empty' : 'max');
        const w = changeWorld(world, (d) => { d.hideout.stash[act.item] -= take; }, now);
        return { ok: true, profile: { ...profile, kit: { ...profile.kit, [act.item]: have + take } }, world: w, note: { item: act.item, n: take } };
      }
      const put = Math.min(-n, have);
      if (put <= 0) return fail('nothing');
      const kit = { ...profile.kit };
      if (have - put > 0) kit[act.item] = have - put;
      else delete kit[act.item];
      const w = changeWorld(world, (d) => { d.hideout.stash[act.item] = Math.min(MAX_STASH, d.hideout.stash[act.item] + put); }, now);
      return { ok: true, profile: { ...profile, kit }, world: w, note: { item: act.item, n: -put } };
    }
    case 'buykit': {
      if (!isKitItem(act.item)) return fail('unknown');
      const cost = KIT_ITEMS[act.item].scrap;
      if ((profile.scrap | 0) < cost) return fail('scrap');
      if ((world.hideout.stash[act.item] | 0) >= MAX_STASH) return fail('full');
      const w = changeWorld(world, (d) => { d.hideout.stash[act.item] += 1; }, now);
      return { ok: true, profile: { ...profile, scrap: profile.scrap - cost }, world: w, note: { item: act.item, cost } };
    }
    case 'talk':
    case 'flag': {
      let flag = null;
      if (act.a === 'talk') {
        if (typeof act.npc === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(act.npc)) flag = `talked_${act.npc}`;
      } else if (typeof act.flag === 'string' && (CLIENT_FLAG.test(act.flag) || contentFlags().has(act.flag))) {
        flag = act.flag;
      }
      if (!flag) return fail('invalid');
      if (world.progress.flags[flag] || Object.keys(world.progress.flags).length >= MAX_FLAGS) return { ok: true, profile, world };
      return { ok: true, profile, world: changeWorld(world, (d) => { d.progress.flags[flag] = true; }, now) };
    }
    case 'diff': {
      if (!state.actor || !state.actor.isHost) return fail('host');
      if (!DIFFICULTY_IDS.includes(act.difficulty)) return fail('invalid');
      if (act.difficulty === world.difficulty) return { ok: true, profile, world };
      return { ok: true, profile, world: changeWorld(world, (d) => { d.difficulty = act.difficulty; }, now) };
    }
    case 'daylight': {
      // the campaign option "Daylight only" (JOURNEY.md §2.1): every mission and side job plays by day
      if (!state.actor || !state.actor.isHost) return fail('host');
      if (typeof act.on !== 'boolean') return fail('invalid');
      if (!!(world.settings && world.settings.daylight) === act.on) return { ok: true, profile, world };
      return { ok: true, profile, world: changeWorld(world, (d) => { d.settings = { ...(d.settings || {}), daylight: act.on }; }, now) };
    }
    case 'rename': {
      if (!state.actor || !state.actor.isHost) return fail('host');
      const name = cleanText(act.name, 24, '');
      if (!name) return fail('invalid');
      if (name === world.name) return { ok: true, profile, world };
      return { ok: true, profile, world: changeWorld(world, (d) => { d.name = name; }, now) };
    }
    default:
      return fail('unknown');
  }
}

/** Highest tier reachable (re-export for the UI's "max" label). */
export { MAX_TIER };
