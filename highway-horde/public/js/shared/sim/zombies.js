// Zombie rules: wave spawning, targeting, flow-field steering with a swarm feel,
// separation, attacks, and every special (bloater burst lives in combat.killZombie,
// spitter acid, screamer buff, brute charge, boss slam).

import {
  DT, PLAYER_RADIUS, TURRET, HP_GROWTH_PER_WAVE, SPEED_GROWTH_PER_WAVE, SPEED_GROWTH_CAP,
} from '../constants.js';
import { ZOMBIES, ZOMBIE_IDS } from '../zombies.js';
import { distToObb, closestPointOnObb, MASK_MOVE } from '../geom.js';
import { MASK_HEAVY } from '../movement.js';
import { turnTowards, TAU } from '../math.js';
import { damagePlayer } from './players.js';
import { OBJECTIVE_BIAS, OBJECTIVE_BIAS_BIG } from './core.js';
import {
  damageZombie, damageTurret, damageBarricade, damageObjective, lobAcid, MAX_ZOMBIE_RADIUS,
} from './combat.js';

/** Zombie behaviour modes (z.mode). */
export const MODE_NORMAL = 0;
export const MODE_CHARGE = 1;
export const MODE_WINDUP = 2;
export const MODE_STUN = 3;

const TK_NONE = 0, TK_PLAYER = 1, TK_TURRET = 2, TK_OBJECTIVE = 3;
const SK_BARRICADE = 4;

const DIRECT_RANGE = 200;       // steer straight at the target inside this range (with a clear line)
const RETARGET = 0.25;
const DOWNED_BIAS = 80;         // standing players are preferred over downed ones this much
const TURRET_BIAS = 30;
const SEP_SPEED = 150;          // px/s of push at full overlap
const SEP_HARD = 0.3;           // share of deep overlap corrected positionally per tick
const KNOCK_DECAY = 9;
const BURN_SPEED = 1.15;
const TURN_RATE = 9;
const ELITE_CHANCE = 0.02;
const ELITE_FROM_WAVE = 4;
const STUCK_TELEPORT_AFTER = 12;
const STUCK_FAR = 650;
const BIG_RADIUS = 20;          // zombies this big are heavies: over low cover, wide-gap field
/**
 * Collision radius of heavies against the world. The boss is drawn and fights at 44 px
 * but squeezes between cars like a brute, or no route on a busy highway would fit it.
 */
export const HEAVY_BODY_RADIUS = 28;

const SPAWN_TYPES = ZOMBIE_IDS.filter((t) => t !== 'boss');
const nearBuf = [];
const flowOut = { x: 0, y: 0 };
const pt = { x: 0, y: 0 };

// -------------------------------------------------------------------------------------
// Spawning

/** Queue this wave's zombies (game.waveTotal) and arm the first spawn. */
export function startWaveSpawns(game) {
  game.spawnQueue = game.waveTotal;
  game.spawnTimer = 2;
}

/** Mid-wave spawning: groups at spawn rectangles (respecting maxAlive) and the bosses. */
export function updateSpawning(game) {
  const rng = game.rng;
  if (game.bossQueue > 0) {
    game.bossTimer -= DT;
    if (game.bossTimer <= 0) {
      const n = game.bossQueue;
      game.bossQueue = 0;
      for (let i = 0; i < n; i++) {
        const rect = pickSpawnRect(game);
        const p = spawnPoint(game, rect, HEAVY_BODY_RADIUS, MASK_HEAVY);
        const z = spawnZombie(game, 'boss', p.x, p.y);
        game.emit({ type: 'bossspawn', id: z.id, x: Math.round(z.x), y: Math.round(z.y) });
      }
    }
  }
  if (game.spawnQueue <= 0) return;
  game.spawnTimer -= DT;
  if (game.spawnTimer > 0) return;
  let alive = 0;
  for (const z of game.zombies) if (!z.dead) alive++;
  const room = game.diff.maxAlive - alive;
  if (room <= 0) {
    game.spawnTimer = 0.5;
    return;
  }
  const w = game.wave;
  const group = Math.min(game.spawnQueue, room, rng.int(3, 5 + Math.floor(w / 3)));
  const rect = pickSpawnRect(game);
  for (let i = 0; i < group; i++) {
    const type = pickType(game, w);
    const def = ZOMBIES[type];
    const heavy = def.radius >= BIG_RADIUS;
    const p = spawnPoint(game, rect, heavy ? Math.min(def.radius, HEAVY_BODY_RADIUS) : def.radius, heavy ? MASK_HEAVY : MASK_MOVE);
    const elite = w >= ELITE_FROM_WAVE && rng.chance(ELITE_CHANCE);
    spawnZombie(game, type, p.x, p.y, elite);
  }
  game.spawnQueue -= group;
  const crowd = (1 + 0.6 * (game.wavePlayers - 1)) * game.diff.count;
  const base = Math.max(1.2, Math.min(3.6, 3.6 - 0.12 * (w - 1)));
  game.spawnTimer = (base / Math.sqrt(Math.max(1, crowd))) * rng.range(0.75, 1.25);
}

function pickType(game, w) {
  let total = 0;
  for (const t of SPAWN_TYPES) total += Math.max(0, ZOMBIES[t].weight(w));
  let r = game.rng.next() * total;
  for (const t of SPAWN_TYPES) {
    r -= Math.max(0, ZOMBIES[t].weight(w));
    if (r < 0) return t;
  }
  return 'walker';
}

/** A spawn rectangle, preferring ones farther than 700 px from every living player. */
export function pickSpawnRect(game) {
  const rects = game.map.zombieSpawns;
  const far = [];
  for (const r of rects) {
    let ok = true;
    for (const p of game.players) {
      if (p.state === 'dead') continue;
      if (Math.hypot(p.x - r.x, p.y - r.y) < 700) {
        ok = false;
        break;
      }
    }
    if (ok) far.push(r);
  }
  return game.rng.pick(far.length ? far : rects);
}

function spawnPoint(game, rect, r, mask = MASK_MOVE) {
  const rng = game.rng;
  for (let i = 0; i < 12; i++) {
    const x = rect.x + rng.range(-rect.w / 2, rect.w / 2);
    const y = rect.y + rng.range(-rect.h / 2, rect.h / 2);
    if (game.world.isCircleFree(x, y, r, false, mask)) return { x, y };
  }
  const p = { x: rect.x, y: rect.y };
  game.world.resolveCircle(p, r, mask);
  return p;
}

/**
 * Create a zombie of `type` at (x, y) scaled for the current wave and difficulty.
 * @returns {object} the zombie
 */
export function spawnZombie(game, type, x, y, elite = false) {
  const def = ZOMBIES[type];
  const rng = game.rng;
  const w = Math.max(1, game.wave);
  const boss = type === 'boss';
  const players = Math.max(1, game.players.length);
  const hp = def.hp * (1 + HP_GROWTH_PER_WAVE * (w - 1)) * game.diff.hp
    * (elite ? 1.6 : 1) * (boss ? 0.6 + 0.4 * players : 1);
  const speedScale = Math.min(SPEED_GROWTH_CAP, 1 + SPEED_GROWTH_PER_WAVE * (w - 1));
  const speed = rng.range(def.speed[0], def.speed[1]) * speedScale * (elite ? 1.2 : 1);
  const sp = def.special;
  const heavy = def.radius >= BIG_RADIUS;
  const z = {
    id: game.ids.zombie.alloc(), type, def, x, y,
    heavy, body: heavy ? Math.min(def.radius, HEAVY_BODY_RADIUS) : def.radius, mask: heavy ? MASK_HEAVY : MASK_MOVE,
    angle: Math.atan2(game.map.height / 2 - y, game.map.width / 2 - x),
    hp, maxHp: hp, radius: def.radius, speed, damage: def.damage * game.diff.damage,
    mass: def.mass, elite: !!elite, boss, dead: false,
    kvx: 0, kvy: 0, vx: 0, vy: 0,
    attackCd: rng.range(0, 0.4), swingT: 0, swingKind: 0, swingRef: null,
    tgtKind: TK_NONE, tgt: null, tgtX: x, tgtY: y, tgtGap: Infinity, tgtDist: Infinity, tgtLos: false,
    retargetT: 0,
    burnT: 0, burnDps: 0, burnBy: 0, buffT: 0,
    specialCd: sp && sp.cooldown ? sp.cooldown * rng.range(0.3, 0.8) : 0,
    mode: MODE_NORMAL, modeT: 0, cdx: 0, cdy: 0, chargeHits: [],
    flank: rng.range(-1, 1), phase: rng.range(0, TAU), wobble: rng.range(0.5, 1.3),
    stuckT: 0, progT: rng.range(0, 1), lastProg: Infinity, unstickT: 0, udx: 0, udy: 0,
    bumpB: null, bumpT: 0, hurtT: 0, flashT: 0, lastBy: 0, touched: 0, holding: false,
  };
  game.zombies.push(z);
  return z;
}

/** Remove dead zombies from the live array (after the tick's AI ran). */
export function removeDeadZombies(game) {
  const zs = game.zombies;
  let w = 0;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (z.dead) {
      game.ids.zombie.free(z.id);
      continue;
    }
    zs[w++] = z;
  }
  zs.length = w;
}

// -------------------------------------------------------------------------------------
// Targeting

function chooseTarget(game, z) {
  let kind = TK_NONE, ref = null, best = Infinity;
  if (game.objective && game.objective.hp > 0 && game.objObb) {
    best = distToObb(game.objObb, z.x, z.y) + (z.radius >= BIG_RADIUS ? OBJECTIVE_BIAS_BIG : OBJECTIVE_BIAS);
    kind = TK_OBJECTIVE;
  }
  for (const p of game.players) {
    if (p.state === 'dead') continue;
    let d = Math.hypot(p.x - z.x, p.y - z.y) - PLAYER_RADIUS;
    if (p.state === 'downed') d += DOWNED_BIAS;
    if (d < best) {
      best = d;
      kind = TK_PLAYER;
      ref = p;
    }
  }
  for (const t of game.turrets) {
    if (t.dead) continue;
    const d = Math.hypot(t.x - z.x, t.y - z.y) - TURRET.radius + TURRET_BIAS;
    if (d < best) {
      best = d;
      kind = TK_TURRET;
      ref = t;
    }
  }
  z.tgtKind = kind;
  z.tgt = ref;
  refreshTarget(game, z);
  z.tgtLos = false;
  if (kind !== TK_NONE && z.tgtDist < DIRECT_RANGE + 60) {
    // Aim the check at a point just short of the target so the target's own
    // collider (the objective) doesn't count as blocking.
    const dx = z.x - z.tgtX, dy = z.y - z.tgtY;
    const d = Math.hypot(dx, dy) || 1;
    const back = kind === TK_OBJECTIVE ? z.radius * 0.5 + 3 : 0;
    z.tgtLos = game.world.lineOfMovement(z.x, z.y, z.tgtX + (dx / d) * back, z.tgtY + (dy / d) * back, z.body * 0.5, z.mask);
  }
}

/** Update the target point, centre distance and surface gap for the current target. */
function refreshTarget(game, z) {
  switch (z.tgtKind) {
    case TK_PLAYER:
    case TK_TURRET: {
      const t = z.tgt;
      z.tgtX = t.x;
      z.tgtY = t.y;
      const d = Math.hypot(t.x - z.x, t.y - z.y);
      z.tgtDist = d;
      z.tgtGap = d - z.radius - (z.tgtKind === TK_PLAYER ? PLAYER_RADIUS : TURRET.radius);
      break;
    }
    case TK_OBJECTIVE: {
      closestPointOnObb(game.objObb, z.x, z.y, pt);
      z.tgtX = pt.x;
      z.tgtY = pt.y;
      const d = Math.hypot(pt.x - z.x, pt.y - z.y);
      z.tgtDist = d;
      z.tgtGap = d - z.radius;
      break;
    }
    default:
      z.tgtDist = Infinity;
      z.tgtGap = Infinity;
  }
}

function targetValid(game, z) {
  switch (z.tgtKind) {
    case TK_PLAYER: return z.tgt.state !== 'dead' && game.players.includes(z.tgt);
    case TK_TURRET: return !z.tgt.dead;
    case TK_OBJECTIVE: return !!game.objective && game.objective.hp > 0;
    default: return false;
  }
}

// -------------------------------------------------------------------------------------
// Per-tick AI

/** Run every live zombie's AI, movement, attacks and specials for one tick. */
export function updateZombies(game) {
  const zs = game.zombies;
  for (let i = 0, n = zs.length; i < n; i++) {
    const z = zs[i];
    if (!z.dead) updateZombie(game, z);
  }
}

function updateZombie(game, z) {
  if (z.attackCd > 0) z.attackCd -= DT;
  if (z.specialCd > 0) z.specialCd -= DT;
  if (z.buffT > 0) z.buffT -= DT;
  if (z.hurtT > 0) z.hurtT -= DT;
  if (z.bumpT > 0) z.bumpT -= DT;
  if (z.flashT > 0) z.flashT -= DT;
  if (z.unstickT > 0) z.unstickT -= DT;
  if (z.burnT > 0) {
    z.burnT -= DT;
    damageZombie(game, z, z.burnDps * DT, z.burnBy, false);
    if (z.dead) return;
  }
  z.retargetT -= DT;
  if (z.retargetT <= 0 || !targetValid(game, z)) {
    chooseTarget(game, z);
    z.retargetT = RETARGET + ((z.id * 7) % 5) * 0.01;
  } else {
    refreshTarget(game, z);
  }
  switch (z.mode) {
    case MODE_CHARGE: stepCharge(game, z); break;
    case MODE_WINDUP: stepWindup(game, z); break;
    case MODE_STUN:
      z.modeT -= DT;
      if (z.modeT <= 0) z.mode = MODE_NORMAL;
      moveZombie(game, z, 0, 0, false);
      break;
    default: stepNormal(game, z); break;
  }
}

function stepNormal(game, z) {
  const def = z.def, sp = def.special;
  const type = z.type;
  const hasTarget = z.tgtKind !== TK_NONE;
  const inReach = hasTarget && z.tgtGap <= def.attackRange;
  const targetsMobile = z.tgtKind === TK_PLAYER || z.tgtKind === TK_TURRET;

  // Specials that take over this tick.
  if (type === 'brute' && z.specialCd <= 0 && targetsMobile && z.tgtLos && z.tgtDist < sp.triggerRange && z.tgtGap > 4) {
    startCharge(game, z);
    return;
  }
  if (type === 'boss' && z.specialCd <= 0 && hasTarget && z.tgtGap < sp.radius * 0.8) {
    z.mode = MODE_WINDUP;
    z.modeT = sp.windup;
    return;
  }
  if (type === 'screamer' && z.specialCd <= 0 && hasTarget && z.tgtDist < 520) scream(game, z);

  let dirX = 0, dirY = 0, move = 1;
  let decided = false;
  z.holding = false;
  if (type === 'spitter' && z.tgtKind === TK_PLAYER) {
    const d = z.tgtDist;
    if (z.specialCd <= 0 && d <= sp.range && game.world.lineOfSight(z.x, z.y, z.tgtX, z.tgtY)) spit(game, z);
    if (d < sp.keepAway * 0.8 && z.tgtLos) {
      // Too close: back off while facing the target.
      dirX = (z.x - z.tgtX) / (d || 1);
      dirY = (z.y - z.tgtY) / (d || 1);
      move = 0.8;
      decided = true;
    } else if (d < sp.keepAway && z.tgtLos) {
      // In the sweet spot: sidestep slowly.
      dirX = -(z.tgtY - z.y) / (d || 1) * Math.sign(z.flank || 1);
      dirY = (z.tgtX - z.x) / (d || 1) * Math.sign(z.flank || 1);
      move = 0.3;
      decided = true;
      z.holding = true;
    }
  }

  if (!decided && !inReach && hasTarget) {
    if (z.tgtLos && z.tgtDist < DIRECT_RANGE) {
      const d = z.tgtDist || 1;
      const tx = (z.tgtX - z.x) / d, ty = (z.tgtY - z.y) / d;
      // Approach at a per-zombie slant so the crowd wraps around the target.
      const lat = z.flank * Math.max(0, Math.min(1, (d - 40) / 160)) * 0.9;
      dirX = tx - ty * lat;
      dirY = ty + tx * lat;
    } else {
      const ok = sampleFlow(game, z, flowOut);
      if (ok) {
        dirX = flowOut.x;
        dirY = flowOut.y;
      } else {
        const d = z.tgtDist || 1;
        dirX = (z.tgtX - z.x) / d;
        dirY = (z.tgtY - z.y) / d;
      }
      // Gentle weave so followers of the same field don't march in lockstep.
      const wv = (z.heavy ? 0.08 : 0.22) * Math.sin(game.time * z.wobble + z.phase);
      const ox = dirX;
      dirX -= dirY * wv;
      dirY += ox * wv;
    }
    decided = true;
  }
  if (z.unstickT > 0 && decided && !inReach) {
    dirX = dirX * 0.3 + z.udx;
    dirY = dirY * 0.3 + z.udy;
  }
  const l = Math.hypot(dirX, dirY);
  if (l > 1e-6) {
    dirX /= l;
    dirY /= l;
  } else {
    move = 0;
  }
  if (inReach) move = 0;
  const speed = z.speed * (z.buffT > 0 ? ZOMBIES.screamer.special.speedBuff : 1) * (z.burnT > 0 ? BURN_SPEED : 1) * move;
  moveZombie(game, z, dirX * speed, dirY * speed, true);

  // Facing: the target while fighting, else the way we're walking.
  if (hasTarget && (inReach || z.holding || z.tgtDist < 60)) {
    z.angle = turnTowards(z.angle, Math.atan2(z.tgtY - z.y, z.tgtX - z.x), TURN_RATE * DT);
  } else if (z.vx * z.vx + z.vy * z.vy > 25) {
    z.angle = turnTowards(z.angle, Math.atan2(z.vy, z.vx), TURN_RATE * DT);
  }

  attackLogic(game, z, inReach);
  stuckCheck(game, z, inReach, dirX, dirY);
}

/**
 * Integrate one zombie: desired velocity + separation + knockback, then collide with
 * the world, players and turrets.
 */
function moveZombie(game, z, vx, vy, separate) {
  let sx = 0, sy = 0, cx = 0, cy = 0;
  if (separate) {
    const n = game.zgrid.queryRadius(z.x, z.y, z.radius + MAX_ZOMBIE_RADIUS + 1, nearBuf);
    for (let i = 0; i < n; i++) {
      const o = nearBuf[i];
      if (o === z || o.dead) continue;
      let dx = z.x - o.x, dy = z.y - o.y;
      const minD = z.radius + o.radius + 1;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-3) {
        // Perfectly stacked: split them apart deterministically by id.
        const a = (z.id * 2.399963) % TAU;
        dx = Math.cos(a);
        dy = Math.sin(a);
        d = 1;
      } else {
        dx /= d;
        dy /= d;
      }
      // Heavier neighbours push harder; the boss is not shoved by the small fry.
      if (z.mass >= 1 && o.mass < 1) continue;
      const wgt = (2 * (o.mass + 0.15)) / (z.mass + o.mass + 0.3);
      const over = (minD - d) / minD;
      sx += dx * over * wgt;
      sy += dy * over * wgt;
      if (over > 0.25) {
        cx += dx * (minD - d) * SEP_HARD * wgt * 0.5;
        cy += dy * (minD - d) * SEP_HARD * wgt * 0.5;
      }
    }
  }
  const kx = z.kvx, ky = z.kvy;
  if (kx !== 0 || ky !== 0) {
    const k = Math.exp(-KNOCK_DECAY * DT);
    z.kvx *= k;
    z.kvy *= k;
    if (z.kvx * z.kvx + z.kvy * z.kvy < 4) {
      z.kvx = 0;
      z.kvy = 0;
    }
  }
  const mvx = vx + sx * SEP_SPEED + kx, mvy = vy + sy * SEP_SPEED + ky;
  const ox = z.x, oy = z.y;
  const world = game.world;
  z.touched = world.moveCircle(z, z.body, mvx * DT + cx, mvy * DT + cy, z.mask);
  if (world.touchedBarricade >= 0) {
    const b = game.barricades[world.touchedBarricade];
    if (b && !b.dead) {
      z.bumpB = b;
      z.bumpT = 0.5;
    }
  }
  z.pushNX = world.pushNX;
  z.pushNY = world.pushNY;
  // Walkers stop at the player's edge; they never shove players.
  let pushed = false;
  for (const p of game.players) {
    if (p.state === 'dead') continue;
    pushed = pushOutOf(z, p.x, p.y, PLAYER_RADIUS) || pushed;
  }
  for (const t of game.turrets) {
    if (t.dead) continue;
    pushed = pushOutOf(z, t.x, t.y, TURRET.radius) || pushed;
  }
  if (pushed) world.resolveCircle(z, z.body, z.mask);
  z.vx = (z.x - ox) / DT;
  z.vy = (z.y - oy) / DT;
}

function pushOutOf(z, x, y, r) {
  const dx = z.x - x, dy = z.y - y;
  const minD = z.radius + r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-3) {
    z.x += minD;
    return true;
  }
  z.x = x + (dx / d) * minD;
  z.y = y + (dy / d) * minD;
  return true;
}

/**
 * The flow field sized for this zombie. If no route at all fits the heavies (every
 * way in is too tight), they fall back to the walkers' field.
 */
function fieldFor(game, z) {
  if (z.heavy && game.flowBig.hasPath) return game.flowBig;
  return game.flow;
}

function sampleFlow(game, z, out) {
  return fieldFor(game, z).sample(z.x, z.y, out);
}

// -------------------------------------------------------------------------------------
// Attacks

function attackLogic(game, z, inReach) {
  if (z.swingT > 0) {
    z.swingT -= DT;
    if (z.swingT <= 0) resolveSwing(game, z);
    return;
  }
  if (z.attackCd > 0) return;
  let kind = 0, ref = null;
  if (inReach) {
    kind = z.tgtKind;
    ref = z.tgt;
  } else if (z.bumpT > 0 && z.bumpB && !z.bumpB.dead) {
    kind = SK_BARRICADE;
    ref = z.bumpB;
  } else {
    return;
  }
  const rate = z.def.attackRate;
  z.swingT = Math.min(0.35, 0.6 / rate);
  z.swingKind = kind;
  z.swingRef = ref;
  z.attackCd = 1 / rate;
  if (kind === SK_BARRICADE) z.angle = Math.atan2(ref.y - z.y, ref.x - z.x);
  game.emit({ type: 'zattack', id: z.id, ztype: z.type, x: Math.round(z.x), y: Math.round(z.y), angle: z.angle });
}

function resolveSwing(game, z) {
  const reach = z.def.attackRange + 12;
  const ref = z.swingRef;
  z.swingRef = null;
  switch (z.swingKind) {
    case TK_PLAYER:
      if (ref.state !== 'dead' && Math.hypot(ref.x - z.x, ref.y - z.y) - z.radius - PLAYER_RADIUS <= reach) {
        damagePlayer(game, ref, z.damage, z.x, z.y);
      }
      break;
    case TK_TURRET:
      if (!ref.dead && Math.hypot(ref.x - z.x, ref.y - z.y) - z.radius - TURRET.radius <= reach) damageTurret(game, ref, z.damage);
      break;
    case TK_OBJECTIVE:
      if (game.objObb && distToObb(game.objObb, z.x, z.y) - z.radius <= reach) {
        closestPointOnObb(game.objObb, z.x, z.y, pt);
        damageObjective(game, z.damage, pt.x, pt.y);
      }
      break;
    case SK_BARRICADE:
      if (!ref.dead) damageBarricade(game, ref, z.damage);
      break;
    default:
      break;
  }
}

// -------------------------------------------------------------------------------------
// Specials

function scream(game, z) {
  const sp = z.def.special;
  z.specialCd = sp.cooldown;
  z.flashT = 0.4;
  const n = game.zgrid.queryRadius(z.x, z.y, sp.radius, nearBuf);
  for (let i = 0; i < n; i++) {
    const o = nearBuf[i];
    if (o.dead || o === z) continue;
    o.buffT = sp.duration;
  }
  game.emit({ type: 'scream', id: z.id, x: Math.round(z.x), y: Math.round(z.y) });
}

function spit(game, z) {
  const sp = z.def.special;
  const p = z.tgt;
  const t = z.tgtDist / sp.speed;
  const rng = game.rng;
  // Lead the target a little, with some scatter.
  const tx = p.x + (p.vx || 0) * t * 0.6 + rng.range(-24, 24);
  const ty = p.y + (p.vy || 0) * t * 0.6 + rng.range(-24, 24);
  lobAcid(game, z, tx, ty);
  z.specialCd = sp.cooldown * rng.range(0.85, 1.15);
  z.flashT = 0.3;
  const a = Math.atan2(ty - z.y, tx - z.x);
  z.angle = a;
  game.emit({ type: 'spit', id: z.id, x: Math.round(z.x), y: Math.round(z.y), angle: a });
}

function startCharge(game, z) {
  const d = z.tgtDist || 1;
  z.mode = MODE_CHARGE;
  z.modeT = z.def.special.duration;
  z.cdx = (z.tgtX - z.x) / d;
  z.cdy = (z.tgtY - z.y) / d;
  z.angle = Math.atan2(z.cdy, z.cdx);
  z.chargeHits.length = 0;
  z.swingT = 0;
  game.emit({ type: 'charge', id: z.id, x: Math.round(z.x), y: Math.round(z.y), angle: z.angle });
}

function endCharge(z, stun) {
  z.mode = stun > 0 ? MODE_STUN : MODE_NORMAL;
  z.modeT = stun;
  z.specialCd = z.def.special.cooldown;
}

function stepCharge(game, z) {
  const sp = z.def.special;
  const v = sp.chargeSpeed * (z.burnT > 0 ? BURN_SPEED : 1);
  moveZombie(game, z, z.cdx * v, z.cdy * v, false);
  z.angle = Math.atan2(z.cdy, z.cdx);
  const dmg = sp.chargeDamage * game.diff.damage;
  for (const p of game.players) {
    if (p.state === 'dead' || z.chargeHits.includes(p.id)) continue;
    const dx = p.x - z.x, dy = p.y - z.y;
    const d = Math.hypot(dx, dy);
    if (d > z.radius + PLAYER_RADIUS + 6) continue;
    z.chargeHits.push(p.id);
    damagePlayer(game, p, dmg, z.x, z.y);
    // Thrown forward and to the side the player was on.
    let nx = z.cdx * 0.75 + (d > 1e-3 ? dx / d : 0) * 0.65;
    let ny = z.cdy * 0.75 + (d > 1e-3 ? dy / d : 0) * 0.65;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    p.kbx += nx * sp.knockback;
    p.kby += ny * sp.knockback;
  }
  // Shove small zombies out of the way.
  const n = game.zgrid.queryRadius(z.x, z.y, z.radius + 20, nearBuf);
  for (let i = 0; i < n; i++) {
    const o = nearBuf[i];
    if (o === z || o.dead || o.mass >= z.mass) continue;
    const dx = o.x - z.x, dy = o.y - z.y;
    const d = Math.hypot(dx, dy) || 1;
    const side = dx * -z.cdy + dy * z.cdx >= 0 ? 1 : -1;
    const k = 260 * (1 - o.mass);
    o.kvx += -z.cdy * side * k * DT * 6 + (dx / d) * 20;
    o.kvy += z.cdx * side * k * DT * 6 + (dy / d) * 20;
  }
  for (const t of game.turrets) {
    if (t.dead) continue;
    if (Math.hypot(t.x - z.x, t.y - z.y) <= z.radius + TURRET.radius + 4) {
      damageTurret(game, t, dmg * 2);
      endCharge(z, 0.5);
      return;
    }
  }
  if (z.bumpT > 0.45 && z.bumpB && !z.bumpB.dead) {
    damageBarricade(game, z.bumpB, dmg * 3);
    endCharge(z, 0.6);
    return;
  }
  // Slammed into a wall head-on.
  if (z.touched && (z.pushNX * z.cdx + z.pushNY * z.cdy) < -0.6) {
    endCharge(z, 0.8);
    return;
  }
  z.modeT -= DT;
  if (z.modeT <= 0) endCharge(z, 0);
}

function stepWindup(game, z) {
  const sp = z.def.special;
  moveZombie(game, z, 0, 0, true);
  if (z.tgtKind !== TK_NONE) z.angle = turnTowards(z.angle, Math.atan2(z.tgtY - z.y, z.tgtX - z.x), TURN_RATE * DT);
  z.modeT -= DT;
  if (z.modeT > 0) return;
  z.mode = MODE_NORMAL;
  z.specialCd = sp.cooldown;
  const dmg = sp.damage * game.diff.damage;
  game.emit({ type: 'slam', id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: sp.radius });
  for (const p of game.players) {
    if (p.state === 'dead') continue;
    const dx = p.x - z.x, dy = p.y - z.y;
    const d = Math.hypot(dx, dy);
    const gap = Math.max(0, d - PLAYER_RADIUS);
    if (gap > sp.radius) continue;
    const f = 1 - 0.5 * (gap / sp.radius);
    damagePlayer(game, p, dmg * f, z.x, z.y);
    const nx = d > 1e-3 ? dx / d : Math.cos(z.angle), ny = d > 1e-3 ? dy / d : Math.sin(z.angle);
    p.kbx += nx * sp.knockback * f;
    p.kby += ny * sp.knockback * f;
  }
  for (const t of game.turrets) {
    if (!t.dead && Math.hypot(t.x - z.x, t.y - z.y) - TURRET.radius <= sp.radius) damageTurret(game, t, dmg * 2);
  }
  for (const b of game.barricades) {
    if (!b.dead && Math.hypot(b.x - z.x, b.y - z.y) - 20 <= sp.radius) damageBarricade(game, b, dmg * 3);
  }
}

// -------------------------------------------------------------------------------------
// Stuck recovery

function stuckCheck(game, z, inReach, dirX, dirY) {
  z.progT += DT;
  if (z.progT < 1) return;
  z.progT = 0;
  let metric;
  if (z.tgtLos) metric = z.tgtDist;
  else {
    metric = fieldFor(game, z).distanceAt(z.x, z.y);
    if (!(metric < Infinity)) metric = z.tgtDist;
  }
  const busy = inReach || z.holding || z.swingT > 0 || z.bumpT > 0 || z.tgtKind === TK_NONE;
  if (!busy && z.lastProg - metric < z.speed * 0.25) z.stuckT += 1;
  else z.stuckT = Math.max(0, z.stuckT - 2);
  z.lastProg = metric;
  if (z.stuckT >= 3 && z.unstickT <= 0) {
    // Sidestep along the wall for a moment.
    const s = game.rng.chance(0.5) ? 1 : -1;
    z.udx = -dirY * s;
    z.udy = dirX * s;
    z.unstickT = 1.2;
  }
  if (z.stuckT >= STUCK_TELEPORT_AFTER) {
    let far = true;
    for (const p of game.players) {
      if (p.state !== 'dead' && Math.hypot(p.x - z.x, p.y - z.y) < STUCK_FAR) {
        far = false;
        break;
      }
    }
    if (far) {
      // Out of everyone's sight: quietly re-enter from a spawn point.
      const rect = pickSpawnRect(game);
      const p = spawnPoint(game, rect, z.body, z.mask);
      z.x = p.x;
      z.y = p.y;
      z.kvx = 0;
      z.kvy = 0;
      z.lastProg = Infinity;
    }
    z.stuckT = 0;
  }
}
