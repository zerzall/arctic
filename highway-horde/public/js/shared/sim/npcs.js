// NPCs (STORY.md §5.3): survivors who are not players. They stand in the hideout and chat,
// walk a route, follow the team and cover it with a pistol (helpers), or are escorted along
// a route by the team. Zombies attack the ones that are out in the open (escort / follow),
// a downed NPC bleeds out unless a survivor revives it, and an escort NPC that dies loses
// the mission (sim/story.js decides).
//
// States (snapshot `state`): idle | talk | walk | follow | escort | down. `mode` is what the
// NPC does when nothing else is going on (idle | walk | follow | escort); `talk` and `down`
// overlay it.
//
// Navigation reuses the bots' A* grid (bots.js BotNav) for legs the straight line cannot
// walk. Everything here is deterministic (no rng), cheap per NPC, and does nothing at all
// in a game without NPCs.

import { DT, REVIVE_RADIUS } from '../constants.js';
import { MASK_MOVE } from '../geom.js';
import { CLASSES, CLASS_IDS } from '../classes.js';
import {
  NPC, NPC_STATES, NPC_ACCESSORIES, NPC_HAIR_STYLES, TALK_RANGE, npcDefaults,
} from '../story-defs.js';
import { angleDiff, turnTowards } from '../math.js';
import { fireHitscan } from './combat.js';
import { BotNav } from './bots.js';

/** Most NPCs a game (and a snapshot) carries. */
export const MAX_NPCS = 12;
const PATH_MAX = 96;
const HEX = /^#[0-9a-fA-F]{6}$/;
const TURN = 7;
const ARRIVE = 46;
/** The helpers' pistol (shaped like combat.js TURRET_GUN). */
const HELPER_GUN = {
  damage: NPC.shootDamage, pellets: 1, spread: 0.06, range: NPC.shootRange, pierce: 1, falloff: 0.7, knockback: 40,
};

/** A look with every field valid: { cls, skin, hair, hairStyle, outfit: [1..3 hex], accessory, scale }. */
export function normLook(look, key = '') {
  const base = npcDefaults(key).look;
  const l = look && typeof look === 'object' ? look : {};
  const cls = CLASS_IDS.includes(l.cls) ? l.cls : base.cls;
  const outfit = Array.isArray(l.outfit) ? l.outfit.filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 3) : [];
  const scale = Number.isFinite(l.scale) ? Math.max(0.5, Math.min(1.3, l.scale)) : (base.scale || 1);
  return {
    cls,
    skin: typeof l.skin === 'string' && HEX.test(l.skin) ? l.skin.toLowerCase() : base.skin,
    hair: typeof l.hair === 'string' && HEX.test(l.hair) ? l.hair.toLowerCase() : base.hair,
    outfit: outfit.length ? outfit.map((c) => c.toLowerCase()) : (l.cls && !look.outfit ? [CLASSES[cls].look.outfit] : base.outfit.slice()),
    hairStyle: NPC_HAIR_STYLES.includes(l.hairStyle) ? l.hairStyle : (base.hairStyle && !l.cls ? base.hairStyle : 'default'),
    accessory: NPC_ACCESSORIES.includes(l.accessory) ? l.accessory : base.accessory || 'none',
    scale: Math.round(scale * 100) / 100,
  };
}

/**
 * Add an NPC. `def`: { key, name?, look?, x, y, angle?, mode?: 'idle'|'walk'|'follow'|'escort', route?: [{x,y}],
 * hp?, invulnerable?, critical?, loop?, speed? }. Missing name / look come from the cast (story-defs.js CAST).
 * @returns {object|null} the NPC (null when the game already holds MAX_NPCS)
 */
export function createNpc(game, def) {
  if (game.npcs.length >= MAX_NPCS) return null;
  const key = String(def.key || def.id || 'survivor').slice(0, 14);
  const dflt = npcDefaults(key);
  let id = 1;
  const used = new Set(game.npcs.map((n) => n.id));
  while (used.has(id)) id++;
  const players = Math.max(1, game.players.length);
  const maxHp = Math.round((Number(def.hp) > 0 ? Number(def.hp) : NPC.hp) * (1 + 0.15 * (players - 1)));
  const n = {
    id, key,
    name: String(def.name || dflt.name).slice(0, 18),
    look: normLook(def.look || dflt.look, key),
    x: Number(def.x) || 0, y: Number(def.y) || 0, z: 0,
    angle: Number(def.angle) || 0,
    radius: NPC.radius,
    mode: ['idle', 'walk', 'follow', 'escort'].includes(def.mode) ? def.mode : 'idle',
    down: false, dead: false,
    hp: maxHp, maxHp,
    invulnerable: !!def.invulnerable,
    critical: !!def.critical,
    route: Array.isArray(def.route) ? def.route.map((p) => ({ x: p.x, y: p.y })) : null,
    routeI: 0, loop: !!def.loop, arrived: false, waiting: false,
    speed: Number(def.speed) > 0 ? Number(def.speed) : NPC.speed,
    home: { x: Number(def.x) || 0, y: Number(def.y) || 0, angle: Number(def.angle) || 0 },
    talkT: 0, talkWith: 0,
    bleed: 0, revive: 0, reviverTick: -10,
    hurtT: 99, shootCd: 0.5, aimT: 0, target: null, retargetT: 0,
    vx: 0, vy: 0, stepPh: 0,
    path: new Int32Array(PATH_MAX), pathLen: 0, pathI: 0, pathGX: NaN, pathGY: NaN, pathT: -10, stuckT: 0, lx: 0, ly: 0,
    label: def.label || '',
  };
  n.z = game.world.terrainH(n.x, n.y);
  game.world.resolveCircle(n, n.radius, MASK_MOVE, n.z);
  game.npcs.push(n);
  return n;
}

/** The NPC with cast key `key` (or null). */
export function npcByKey(game, key) {
  for (const n of game.npcs) if (n.key === key) return n;
  return null;
}

/** Remove an NPC from the game. */
export function removeNpc(game, n) {
  const i = game.npcs.indexOf(n);
  if (i >= 0) game.npcs.splice(i, 1);
  for (const z of game.zombies) if (z.tgtKind === 5 && z.tgt === n) z.retargetT = 0;
}

/** The snapshot state name of an NPC. */
export function npcState(n) {
  if (n.down) return 'down';
  if (n.talkT > 0) return 'talk';
  if (n.mode === 'walk') return 'walk';
  if (n.mode === 'follow') return 'follow';
  if (n.mode === 'escort') return n.arrived || n.waiting ? 'idle' : 'escort';
  return 'idle';
}

/** True for NPCs the zombies go after: standing and out in the open. */
export function npcTargetable(n) {
  return !n.down && !n.invulnerable && (n.mode === 'escort' || n.mode === 'follow');
}

function nearestSurvivor(game, x, y) {
  let best = null, bd = Infinity;
  for (const p of game.players) {
    if (p.state === 'dead' || p.escaped) continue;
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best ? { p: best, d: Math.sqrt(bd) } : null;
}

function ensureNav(game) {
  if (!game.botNav) game.botNav = new BotNav(game);
  return game.botNav;
}

/** Steer toward (gx, gy) at `speed`: straight when the line is clear, else along an A* path. Returns the distance left. */
function walkTo(game, n, gx, gy, speed, stopAt = 0) {
  const world = game.world;
  const dist = Math.hypot(gx - n.x, gy - n.y);
  if (dist <= stopAt) {
    n.vx = n.vy = 0;
    return dist;
  }
  let tx = gx, ty = gy;
  if (dist > 40 && !world.lineOfMovement(n.x, n.y, gx, gy, n.radius - 2, MASK_MOVE, n.z)) {
    const nav = ensureNav(game);
    const stale = Math.hypot(gx - n.pathGX, gy - n.pathGY) > 60;
    if (n.pathLen === 0 || n.pathI >= n.pathLen || stale || (n.stuckT > 1.2 && game.time - n.pathT > 1)) {
      if (game.time - n.pathT > 0.5 || stale) {
        n.pathT = game.time;
        n.pathLen = nav.find(n.x, n.y, gx, gy, n.path);
        n.pathI = 0;
        n.pathGX = gx;
        n.pathGY = gy;
        n.stuckT = 0;
      }
    }
    // skip path cells already behind us (a later one in a clear line)
    while (n.pathI + 1 < n.pathLen) {
      const cx = nav.cellX(n.path[n.pathI + 1]), cy = nav.cellY(n.path[n.pathI + 1]);
      if (Math.hypot(cx - n.x, cy - n.y) < 34 || (Math.hypot(cx - n.x, cy - n.y) < 130 && world.lineOfMovement(n.x, n.y, cx, cy, n.radius - 2, MASK_MOVE, n.z))) n.pathI++;
      else break;
    }
    if (n.pathI < n.pathLen) {
      const c = n.path[n.pathI];
      tx = nav.cellX(c);
      ty = nav.cellY(c);
      if (Math.hypot(tx - n.x, ty - n.y) < 22) n.pathI++;
    }
  } else {
    n.pathLen = 0;
  }
  const dx = tx - n.x, dy = ty - n.y;
  const d = Math.hypot(dx, dy) || 1;
  const step = Math.min(speed * DT, dist);
  moveNpc(game, n, (dx / d) * step, (dy / d) * step);
  n.angle = turnTowards(n.angle, Math.atan2(dy, dx), TURN * DT);
  return dist;
}

function moveNpc(game, n, dx, dy) {
  const ox = n.x, oy = n.y;
  game.world.moveCircle(n, n.radius, dx, dy, MASK_MOVE, n.z);
  const th = game.world.terrainH(n.x, n.y);
  n.z = th;
  n.vx = (n.x - ox) / DT;
  n.vy = (n.y - oy) / DT;
  // stuck: asked to move but barely did
  if (dx * dx + dy * dy > 0.04 && n.vx * n.vx + n.vy * n.vy < 100) n.stuckT += DT;
  else n.stuckT = Math.max(0, n.stuckT - DT * 2);
}

/** Every NPC, one tick (after the players and before the zombies). */
export function updateNpcs(game) {
  const list = game.npcs;
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    n.hurtT += DT;
    if (n.talkT > 0) n.talkT -= DT;
    if (n.dead) continue;
    if (n.down) {
      updateDown(game, n);
      continue;
    }
    if (n.hp < n.maxHp && n.hurtT > 5) n.hp = Math.min(n.maxHp, n.hp + NPC.regen * DT);
    if (game.over) {
      n.vx = n.vy = 0;
      continue;
    }
    if (n.talkT > 0) {
      const who = game.getPlayer(n.talkWith);
      if (who) n.angle = turnTowards(n.angle, Math.atan2(who.y - n.y, who.x - n.x), TURN * DT);
      n.vx = n.vy = 0;
      continue;
    }
    switch (n.mode) {
      case 'escort': stepEscort(game, n); break;
      case 'follow': stepFollow(game, n); break;
      case 'walk': stepWalk(game, n); break;
      default: stepIdle(game, n); break;
    }
    if (n.mode === 'follow') helperFire(game, n);
    n.stepPh += Math.hypot(n.vx, n.vy) * DT / 18;
  }
}

function stepIdle(game, n) {
  n.vx = n.vy = 0;
  const s = nearestSurvivor(game, n.x, n.y);
  if (s && s.d < 320) n.angle = turnTowards(n.angle, Math.atan2(s.p.y - n.y, s.p.x - n.x), 2.2 * DT);
  else n.angle = turnTowards(n.angle, n.home.angle, 1.4 * DT);
}

function stepWalk(game, n) {
  const r = n.route;
  if (!r || !r.length) {
    stepIdle(game, n);
    return;
  }
  const wp = r[n.routeI % r.length];
  const left = walkTo(game, n, wp.x, wp.y, n.speed, 0);
  if (left < ARRIVE) {
    n.routeI++;
    if (n.routeI >= r.length && !n.loop) {
      n.mode = 'idle';
      n.arrived = true;
      n.home.x = n.x;
      n.home.y = n.y;
    }
  }
}

function stepEscort(game, n) {
  const r = n.route;
  if (n.arrived || !r || n.routeI >= r.length) {
    if (!n.arrived) {
      n.arrived = true;
      game.emit({ type: 'npc', what: 'arrive', npc: n.key, id: n.id });
    }
    stepIdle(game, n);
    return;
  }
  const s = nearestSurvivor(game, n.x, n.y);
  const near = s && s.d <= NPC.waitDist;
  n.waiting = !near;
  if (!near) {
    stepIdle(game, n);
    return;
  }
  const wp = r[n.routeI];
  const left = walkTo(game, n, wp.x, wp.y, n.speed, 0);
  if (left < ARRIVE) {
    n.routeI++;
    n.pathLen = 0;
    if (n.routeI >= r.length) {
      n.arrived = true;
      game.emit({ type: 'npc', what: 'arrive', npc: n.key, id: n.id });
    }
  }
}

function stepFollow(game, n) {
  const s = nearestSurvivor(game, n.x, n.y);
  if (!s) {
    stepIdle(game, n);
    return;
  }
  const p = s.p;
  if (s.d > NPC.followMax) {
    walkTo(game, n, p.x, p.y, NPC.followSpeed, NPC.followMin);
  } else {
    n.vx = n.vy = 0;
    if (!n.target) n.angle = turnTowards(n.angle, Math.atan2(p.y - n.y, p.x - n.x), 2 * DT);
  }
}

/** A helper covers the team: the nearest zombie in sight within range gets a round. */
function helperFire(game, n) {
  n.shootCd -= DT;
  n.retargetT -= DT;
  if (n.retargetT <= 0 || (n.target && n.target.dead)) {
    n.retargetT = 0.3;
    n.target = null;
    const near = game.tmpC;
    const cnt = game.zgrid.queryRadius(n.x, n.y, NPC.shootRange, near);
    let best = null, bd = Infinity;
    for (let i = 0; i < cnt; i++) {
      const z = near[i];
      if (z.dead) continue;
      const d = (z.x - n.x) * (z.x - n.x) + (z.y - n.y) * (z.y - n.y);
      if (d < bd && game.world.lineOfSight(n.x, n.y, z.x, z.y, n.z)) {
        bd = d;
        best = z;
      }
    }
    n.target = best;
  }
  const z = n.target;
  if (!z) return;
  const want = Math.atan2(z.y - n.y, z.x - n.x);
  n.angle = turnTowards(n.angle, want, 9 * DT);
  if (n.shootCd > 0 || Math.abs(angleDiff(n.angle, want)) > 0.2) return;
  n.shootCd = 1 / NPC.shootRate;
  fireHitscan(game, 'n' + n.id, 0, 0, 'pistol', HELPER_GUN, n.x, n.y, n.angle, 1, 0, null);
}

// -------------------------------------------------------------------------------------
// Being hurt, going down, being revived

/** A zombie (or a blast) hurts an NPC. */
export function damageNpc(game, n, amount, fromX, fromY) {
  if (n.dead || n.down || n.invulnerable || !(amount > 0) || game.over) return;
  n.hp -= amount;
  n.hurtT = 0;
  if (n.hp > 0) return;
  n.hp = 0;
  n.down = true;
  n.bleed = NPC.bleed;
  n.revive = 0;
  n.reviverTick = -10;
  n.talkT = 0;
  n.vx = n.vy = 0;
  game.emit({ type: 'npc', what: 'down', npc: n.key, id: n.id });
  if (game.story) game.story.onNpcDown(n);
}

function updateDown(game, n) {
  const reviving = game.tick - n.reviverTick <= 1;
  if (reviving) {
    if (n.revive >= 1) {
      n.down = false;
      n.hp = Math.max(1, n.maxHp * NPC.reviveHp);
      n.revive = 0;
      n.hurtT = 0;
      game.emit({ type: 'npc', what: 'up', npc: n.key, id: n.id });
      if (game.story) game.story.onNpcUp(n);
    }
    return;
  }
  n.revive = Math.max(0, n.revive - DT);
  n.bleed -= DT;
  if (n.bleed <= 0) {
    n.dead = true;
    game.emit({ type: 'npc', what: 'dead', npc: n.key, id: n.id });
    if (game.story) game.story.onNpcDead(n);
  }
}

/**
 * `p` holds interact: revive a downed NPC within reach. Returns true when p is busy with one.
 */
export function reviveNpcs(game, p) {
  for (const n of game.npcs) {
    if (!n.down || n.dead) continue;
    if ((n.x - p.x) * (n.x - p.x) + (n.y - p.y) * (n.y - p.y) > REVIVE_RADIUS * REVIVE_RADIUS) continue;
    n.reviverTick = game.tick;
    n.revive += (DT * (p.perks.reviveSpeed || 1)) / NPC.reviveTime;
    n.reviver = p.id;
    return true;
  }
  return false;
}

/**
 * `p` pressed interact. Talk to the nearest standing NPC within TALK_RANGE unless an
 * interactable is closer. Returns true when a conversation started.
 */
export function talkTo(game, p, otherDist) {
  // (bots do not chat; a game with no human at all lets them, for tests and tools)
  if (p.bot && game.players.some((q) => !q.bot)) return false;
  let best = null, bd = TALK_RANGE;
  for (const n of game.npcs) {
    if (n.down || n.dead) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  if (!best || bd > otherDist) return false;
  best.talkT = 4;
  best.talkWith = p.id;
  game.emit({ type: 'talk', pid: p.id, npc: best.key });
  if (game.story) game.story.onTalk(best, p);
  return true;
}

// -------------------------------------------------------------------------------------
// Snapshot

/** Snapshot.npcs (STORY.md §5.3): { id, key, name, look, x, y, z, angle, state, hp }. hp 0..1, -1 = invulnerable. */
export function npcsSnapshot(game) {
  const out = [];
  for (const n of game.npcs) {
    if (n.dead && n.hp <= 0 && !n.down) continue;
    out.push({
      id: n.id, key: n.key, name: n.name, look: n.look,
      x: n.x, y: n.y, z: n.z, angle: n.angle,
      state: npcState(n), hp: n.invulnerable ? -1 : Math.max(0, Math.min(1, n.hp / n.maxHp)),
    });
  }
  return out;
}

/** State index for the wire. */
export function npcStateIndex(state) {
  const i = NPC_STATES.indexOf(state);
  return i < 0 ? 0 : i;
}
