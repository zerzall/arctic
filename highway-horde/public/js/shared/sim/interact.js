// Interactables (STORY.md §5.2): hold-to-use spots. They come from the map
// (`map.interactables`, the hideout's stations) and from the mission director (terminals,
// generators, the APC to repair ...). A survivor standing at one with `interact` held fills
// its progress ring; several holders fill it faster; when nobody holds it drains. A tap-only
// spot (hold 0) fires on the press. Completion emits `{ type: 'interact', pid, id, kind }`.
//
// The same button talks to NPCs (sim/npcs.js talk) and revives a downed NPC; a downed
// teammate within revive range always wins over any of them.

import { DT, PLAYER_RADIUS, REVIVE_RADIUS } from '../constants.js';
import { INTERACT_KINDS, interactKind, holdSpeed, INTERACT_REACH } from '../story-defs.js';
import { talkTo, reviveNpcs } from './npcs.js';

/** Most interactables a snapshot carries. */
export const MAX_INTERACTABLES = 32;

/**
 * Register an interactable. `def`: { id (string, optional), kind, x, y, r, label, hold, once, on }.
 * @returns {object} the live record (numeric `num` 1.. is its snapshot id)
 */
export function addInteractable(game, def) {
  const kind = interactKind(def.kind);
  const hold = def.hold !== undefined ? Math.max(0, Number(def.hold) || 0) : INTERACT_KINDS[kind].hold;
  const it = {
    num: game.interactables.length + 1,
    id: def.id !== undefined && def.id !== null ? String(def.id) : '',
    kind,
    x: Number(def.x) || 0,
    y: Number(def.y) || 0,
    r: Math.max(20, Number(def.r) || 60),
    label: def.label ? String(def.label) : '',
    hold,
    once: !!def.once,
    on: def.on !== false,
    done: false,
    prog: 0,
    user: 0,
    holders: 0,
    step: def.step || null,
  };
  game.interactables.push(it);
  return it;
}

/** Load the map's static interactables (the hideout's stations) into the game. */
export function loadMapInteractables(game) {
  const list = game.map.interactables;
  if (Array.isArray(list)) for (const d of list) addInteractable(game, d);
}

/** The live interactable with string id `id` (or null). */
export function findInteractable(game, id) {
  for (const it of game.interactables) if (it.id === id) return it;
  return null;
}

/**
 * Advance every interactable one tick (after the players moved) and run the talk / revive
 * interactions of NPCs.
 */
export function updateInteractables(game) {
  const list = game.interactables;
  const npcs = game.npcs;
  if (!list.length && !npcs.length) return;
  for (let i = 0; i < list.length; i++) list[i].holders = 0;
  for (const p of game.players) {
    const cmd = p.cmd;
    const held = !!cmd.interact && p.state === 'alive' && !p.escaped && !p.frozen && !game.over;
    const press = held && !p.iuHeld;
    p.iuHeld = held;
    if (!held) continue;
    // reviving a downed teammate has priority over everything else on this button
    let reviving = false;
    for (const q of game.players) {
      if (q !== p && q.state === 'downed' && (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) <= REVIVE_RADIUS * REVIVE_RADIUS) {
        reviving = true;
        break;
      }
    }
    if (reviving) continue;
    // a downed NPC next to you is revived by holding; a living one is talked to on the press
    if (npcs.length && reviveNpcs(game, p)) continue;
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it.on || it.done) continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d > it.r + PLAYER_RADIUS + INTERACT_REACH * 0.4 || d >= bd) continue;
      best = it;
      bd = d;
    }
    if (npcs.length && press && talkTo(game, p, best ? bd : Infinity)) continue;
    if (!best) continue;
    best.holders++;
    best.user = p.id;
    if (best.hold <= 0) {
      if (press) fire(game, best, p);
    } else {
      best.pressBy = p.id;
    }
  }
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it.on || it.done || it.hold <= 0) continue;
    if (it.holders > 0) {
      it.prog += (holdSpeed(it.holders) * DT) / it.hold;
      if (it.prog >= 1) {
        it.prog = 0;
        fire(game, it, game.getPlayer(it.user) || game.players[0]);
      }
    } else if (it.prog > 0) {
      it.prog = Math.max(0, it.prog - (2 * DT) / it.hold);
      if (it.prog === 0) it.user = 0;
    }
  }
}

function fire(game, it, p) {
  it.prog = 0;
  if (it.once) {
    it.done = true;
    it.on = false;
  }
  game.emit({ type: 'interact', pid: p ? p.id : 0, id: it.id || String(it.num), kind: it.kind });
  if (game.story) game.story.onInteract(it, p);
}

/** Snapshot.interactables: the visible ones (on, or activated) with their hold progress. */
export function interactablesSnapshot(game) {
  const out = [];
  const list = game.interactables;
  for (let i = 0; i < list.length && out.length < MAX_INTERACTABLES; i++) {
    const it = list[i];
    if (!it.on && !it.done) continue;
    out.push({
      id: it.num, kind: it.kind, x: it.x, y: it.y, r: it.r,
      hold: it.hold > 0, on: it.on && !it.done, done: it.done,
      prog: it.prog > 0 ? Math.min(1, it.prog) : 0, user: it.prog > 0 ? it.user : 0,
    });
  }
  return out;
}
