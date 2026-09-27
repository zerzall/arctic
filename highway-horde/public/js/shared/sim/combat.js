// Combat rules: damage and kills, every weapon kind, throwables, explosions,
// projectiles, ground hazards, sentry turrets and barricade upkeep.

import {
  DT, PLAYER_RADIUS, THROW_SPEED, TURRET,
} from '../constants.js';
import { THROWABLES } from '../weapons.js';
import { ZOMBIES } from '../zombies.js';
import { DROP_CHANCE, CRATE_DROP_CHANCE } from '../items.js';
import { angleDiff, turnTowards } from '../math.js';
import { rayCircle, MASK_SOLID } from '../geom.js';
import { damagePlayer, rollDrop, spawnPickup, COOLDOWN_EPS } from './players.js';

/** Largest zombie radius: pad for spatial ray/radius queries. */
export const MAX_ZOMBIE_RADIUS = Math.max(...Object.values(ZOMBIES).map((z) => z.radius));
/** Shot events start this far in front of the shooter (clients predict shots the same way). */
export const MUZZLE = 22;
export const MAX_RAYS_PER_EVENT = 40;
const MAX_KNOCK = 700;
const FF_MULT = 0.25;
const EXPLOSION_PLAYER_MULT = 0.35;
const EXPLOSION_EDGE = 0.3;
const EXPLOSION_KNOCK = 420;
const FRAG_DRAG = 1.6;
const MOLOTOV_DRAG = 0.8;
const MOLOTOV_LIFE = 0.9;
const BURN_AFTER_FIRE = 1.5;
const MAX_PROJECTILES = 600;

// Turret "gun": numbers from TURRET, handling like a rifle.
const TURRET_GUN = {
  damage: TURRET.damage, pellets: 1, spread: 0.035, range: TURRET.range, pierce: 1,
  falloff: 1, knockback: 30,
};

// Scratch storage for sorted hits along one ray (no allocation per shot).
const hitT = new Float64Array(1024);
const hitO = new Array(1024);

// -------------------------------------------------------------------------------------
// Damage

/** Apply a knockback impulse (px/s) to a zombie, scaled by its mass. */
export function knockZombie(z, nx, ny, impulse) {
  const k = impulse * (1 - z.mass);
  if (k <= 0) return;
  z.kvx += nx * k;
  z.kvy += ny * k;
  const m2 = z.kvx * z.kvx + z.kvy * z.kvy;
  if (m2 > MAX_KNOCK * MAX_KNOCK) {
    const s = MAX_KNOCK / Math.sqrt(m2);
    z.kvx *= s;
    z.kvy *= s;
  }
}

/**
 * Damage a zombie; credits damage/kills to player `by` (0 = nobody).
 * @returns {boolean} true if this killed it
 */
export function damageZombie(game, z, amount, by, gib = false) {
  if (z.dead || !(amount > 0)) return false;
  const dealt = amount < z.hp ? amount : Math.max(0, z.hp);
  z.hp -= amount;
  if (by) {
    const p = game.getPlayer(by);
    if (p) p.damage += dealt;
    z.lastBy = by;
  }
  z.hurtT = 0.12;
  if (z.hp <= 0) {
    killZombie(game, z, by, gib);
    return true;
  }
  return false;
}

/** Set a zombie on fire (refreshes duration, keeps the stronger burn). */
export function igniteZombie(z, dps, duration, by) {
  if (z.dead) return;
  if (z.burnT <= 0 || dps >= z.burnDps) z.burnDps = dps;
  if (duration > z.burnT) z.burnT = duration;
  if (by) z.burnBy = by;
}

/** Kill a zombie: event, kill credit and cash, drops, and the bloater burst. */
export function killZombie(game, z, by, gib) {
  if (z.dead) return;
  z.dead = true;
  z.hp = 0;
  game.emit({
    type: 'zdie', id: z.id, ztype: z.type, x: Math.round(z.x), y: Math.round(z.y), angle: z.angle,
    by: by || 0, gib: !!gib,
  });
  if (by) {
    const p = game.getPlayer(by);
    if (p) {
      p.kills++;
      const cash = Math.round(z.def.cash * game.diff.cash * (p.perks.cashMult || 1) * (z.elite ? 2 : 1));
      p.cash += cash;
      p.earned += cash;
    }
  }
  if (z.boss) {
    // A boss always leaves a crate and some supplies behind.
    rollDrop(game, z.x, z.y, 0, 1);
    spawnPickup(game, 'ammo', z.x - 30, z.y);
    spawnPickup(game, 'health', z.x + 30, z.y);
    spawnPickup(game, 'armor', z.x, z.y + 30);
  } else {
    rollDrop(game, z.x, z.y, DROP_CHANCE * (z.elite ? 3 : 1), CRATE_DROP_CHANCE * (z.elite ? 5 : 1));
  }
  if (z.type === 'bloater') {
    const sp = z.def.special;
    explode(game, z.x, z.y, sp.deathRadius, 0, null, 'bloater', {
      zombieDmg: sp.zombieDamage,
      playerDmg: sp.deathDamage * game.diff.damage,
      structDmg: sp.deathDamage * game.diff.damage,
      credit: by || 0,
    });
  }
}

/** Damage a barricade; breaks it at 0 hp. */
export function damageBarricade(game, b, amount) {
  if (b.dead) return;
  b.hp -= amount;
  if (b.hp <= 0) {
    b.dead = true;
    game.barricadesDirty = true;
    game.emit({ type: 'destroyed', kind: 'barricade', id: b.id, x: Math.round(b.x), y: Math.round(b.y) });
  }
}

/** Damage a turret; destroys it at 0 hp. */
export function damageTurret(game, t, amount) {
  if (t.dead) return;
  t.hp -= amount;
  if (t.hp <= 0) {
    t.dead = true;
    game.emit({ type: 'destroyed', kind: 'turret', id: t.id, x: Math.round(t.x), y: Math.round(t.y) });
  }
}

/** Damage the objective (raw), with 'objhit' events at most 4 per second. */
export function damageObjective(game, amount, x, y) {
  const o = game.objective;
  if (!o || o.hp <= 0) return;
  o.hp = Math.max(0, o.hp - amount);
  if (game.objHitCd <= 0) {
    game.objHitCd = 0.25;
    game.emit({ type: 'objhit', x: Math.round(x), y: Math.round(y) });
  }
}

/**
 * Explosion at (x, y). Damage falls off linearly to 30% at the edge and is blocked by
 * solid obstacles (ray from the centre).
 * @param {object|null} owner player who caused it (perks + credit), or null
 * @param {object} [opt] overrides for non-player blasts: { zombieDmg, playerDmg,
 *   structDmg, credit }
 */
export function explode(game, x, y, r, dmg, owner, kind, opt = null) {
  game.emit({ type: 'explosion', x: Math.round(x), y: Math.round(y), r, kind });
  const credit = opt ? opt.credit : owner ? owner.id : 0;
  const zDmg = opt ? opt.zombieDmg : dmg * (owner ? owner.perks.explosiveMult || 1 : 1);
  const pDmg = opt ? opt.playerDmg : dmg * EXPLOSION_PLAYER_MULT;
  const world = game.world;
  const list = game.tmpC;
  const n = game.zgrid.queryRadius(x, y, r + MAX_ZOMBIE_RADIUS, list);
  // Copy first: kills (bloater chains) may re-enter explode and reuse the scratch list.
  const hits = list.slice(0, n);
  for (const z of hits) {
    if (z.dead) continue;
    const dx = z.x - x, dy = z.y - y;
    const dc = Math.sqrt(dx * dx + dy * dy);
    const d = Math.max(0, dc - z.radius);
    if (d > r) continue;
    if (dc > 1 && !world.lineOfSight(x, y, z.x, z.y)) continue;
    const f = 1 - (1 - EXPLOSION_EDGE) * Math.min(1, d / r);
    if (dc > 1e-3) knockZombie(z, dx / dc, dy / dc, EXPLOSION_KNOCK * f);
    damageZombie(game, z, zDmg * f, credit, true);
  }
  if (pDmg > 0) {
    for (const q of game.players) {
      if (q.state === 'dead') continue;
      if (owner && q === owner && owner.perks.selfExplosionImmune) continue;
      const dx = q.x - x, dy = q.y - y;
      const dc = Math.sqrt(dx * dx + dy * dy);
      const d = Math.max(0, dc - PLAYER_RADIUS);
      if (d > r) continue;
      if (dc > 1 && !world.lineOfSight(x, y, q.x, q.y)) continue;
      const f = 1 - (1 - EXPLOSION_EDGE) * Math.min(1, d / r);
      damagePlayer(game, q, pDmg * f, x, y);
    }
  }
  if (opt && opt.structDmg > 0) {
    for (const t of game.turrets) {
      if (t.dead) continue;
      const d = Math.max(0, Math.hypot(t.x - x, t.y - y) - TURRET.radius);
      if (d <= r) damageTurret(game, t, opt.structDmg * (1 - (1 - EXPLOSION_EDGE) * (d / r)));
    }
    for (const b of game.barricades) {
      if (b.dead) continue;
      const d = Math.max(0, Math.hypot(b.x - x, b.y - y) - 20);
      if (d <= r) damageBarricade(game, b, opt.structDmg * (1 - (1 - EXPLOSION_EDGE) * Math.min(1, d / r)));
    }
  }
}

// -------------------------------------------------------------------------------------
// Firing

/** Fire one shot of player p's weapon `id` (ammo/cooldown are handled by the caller). */
export function fireWeaponShot(game, p, id, w) {
  const a = p.angle;
  switch (w.kind) {
    case 'hitscan':
      fireHitscan(game, p.id, p.id, 0, id, w, p.x, p.y, a, p.perks.damageMult || 1, p.id, p);
      break;
    case 'rail':
      fireRail(game, p, id, w);
      break;
    case 'chain':
      fireChain(game, p, id, w);
      break;
    case 'flame':
    case 'projectile':
      fireProjectile(game, p, id, w);
      break;
    default:
      break;
  }
}

function falloffMult(t, w) {
  const start = w.range * 0.4;
  if (t <= start || w.falloff >= 1) return 1;
  const k = Math.min(1, (t - start) / (w.range - start));
  return 1 - (1 - w.falloff) * k;
}

/**
 * Hitscan rays (players and turrets). Each ray stops at the first solid obstacle and
 * damages up to `pierce` zombies along it, nearest first.
 * @param {*} key shooter key for merging 'shot' events
 * @param {number} pid shooter id for the event (0 for turrets)
 * @param {number} turretId turret id for the event (0 for players)
 * @param {number} credit player credited with damage/kills
 * @param {object|null} shooter player object (friendly fire exclusion), or null
 */
export function fireHitscan(game, key, pid, turretId, weaponId, w, x, y, angle, dmgMult, credit, shooter) {
  const ev = game.shotEvent(key, pid, turretId, weaponId, x + Math.cos(angle) * MUZZLE, y + Math.sin(angle) * MUZZLE, angle);
  const world = game.world, rng = game.rng;
  const ff = !!game.settings.friendlyFire && !!shooter;
  const cand = game.tmpA;
  const pellets = w.pellets || 1;
  for (let k = 0; k < pellets; k++) {
    const a = w.spread > 0 ? angle + rng.range(-w.spread, w.spread) : angle;
    const dx = Math.cos(a), dy = Math.sin(a);
    let maxT = w.range;
    const tw = world.raycastSolid(x, y, dx, dy, maxT);
    if (tw >= 0) maxT = tw;
    const pierce = Math.min(w.pierce || 1, hitT.length);
    let nh = 0;
    const n = game.zgrid.queryRay(x, y, dx, dy, maxT, MAX_ZOMBIE_RADIUS, cand);
    for (let i = 0; i < n; i++) {
      const z = cand[i];
      if (z.dead) continue;
      const t = rayCircle(x, y, dx, dy, z.x, z.y, z.radius, maxT);
      if (t < 0) continue;
      nh = insertHit(nh, pierce, t, z);
    }
    if (ff) {
      for (const q of game.players) {
        if (q === shooter || q.state !== 'alive') continue;
        const t = rayCircle(x, y, dx, dy, q.x, q.y, PLAYER_RADIUS, maxT);
        if (t >= 0) nh = insertHit(nh, pierce, t, q);
      }
    }
    for (let i = 0; i < nh; i++) {
      const o = hitO[i];
      const dmg = w.damage * falloffMult(hitT[i], w) * dmgMult;
      if (o.def) {
        knockZombie(o, dx, dy, w.knockback);
        damageZombie(game, o, dmg, credit, false);
      } else {
        damagePlayer(game, o, dmg * FF_MULT, x, y, true);
      }
      hitO[i] = null;
    }
    let endT = w.range, hit = 0;
    if (nh >= pierce) {
      endT = hitT[nh - 1];
      hit = 1;
    } else if (tw >= 0) {
      endT = tw;
      hit = 2;
    }
    if (ev.rays.length < MAX_RAYS_PER_EVENT) {
      ev.rays.push({ x: Math.round((x + dx * endT) * 10) / 10, y: Math.round((y + dy * endT) * 10) / 10, hit });
    }
  }
}

/** Insert (t, o) into the sorted scratch hit list, keeping at most `cap` nearest. */
function insertHit(n, cap, t, o) {
  if (n >= cap && t >= hitT[n - 1]) return n;
  let i = n < cap ? n : n - 1;
  while (i > 0 && hitT[i - 1] > t) {
    hitT[i] = hitT[i - 1];
    hitO[i] = hitO[i - 1];
    i--;
  }
  hitT[i] = t;
  hitO[i] = o;
  return n < cap ? n + 1 : n;
}

function fireRail(game, p, id, w) {
  const x = p.x, y = p.y, a = p.angle;
  const ev = game.shotEvent(p.id, p.id, 0, id, x + Math.cos(a) * MUZZLE, y + Math.sin(a) * MUZZLE, a);
  const dx = Math.cos(a), dy = Math.sin(a);
  let maxT = w.range;
  const tw = game.world.raycastSolid(x, y, dx, dy, maxT);
  if (tw >= 0) maxT = tw;
  const cand = game.tmpA;
  const n = game.zgrid.queryRay(x, y, dx, dy, maxT, MAX_ZOMBIE_RADIUS, cand);
  let nh = 0;
  const cap = Math.min(w.pierce, hitT.length);
  for (let i = 0; i < n; i++) {
    const z = cand[i];
    if (z.dead) continue;
    const t = rayCircle(x, y, dx, dy, z.x, z.y, z.radius, maxT);
    if (t >= 0) nh = insertHit(nh, cap, t, z);
  }
  const dmg = w.damage * (p.perks.damageMult || 1);
  const targets = hitO.slice(0, nh);
  for (let i = 0; i < nh; i++) hitO[i] = null;
  for (const z of targets) {
    knockZombie(z, dx, dy, w.knockback);
    damageZombie(game, z, dmg, p.id, true);
  }
  if (ev.rays.length < MAX_RAYS_PER_EVENT) {
    ev.rays.push({ x: Math.round((x + dx * maxT) * 10) / 10, y: Math.round((y + dy * maxT) * 10) / 10, hit: tw >= 0 ? 2 : 0 });
  }
}

function fireChain(game, p, id, w) {
  const x = p.x, y = p.y;
  const a = w.spread > 0 ? p.angle + game.rng.range(-w.spread, w.spread) : p.angle;
  const mx = x + Math.cos(p.angle) * MUZZLE, my = y + Math.sin(p.angle) * MUZZLE;
  game.shotEvent(p.id, p.id, 0, id, mx, my, p.angle);
  const dx = Math.cos(a), dy = Math.sin(a);
  let maxT = w.range;
  const tw = game.world.raycastSolid(x, y, dx, dy, maxT);
  if (tw >= 0) maxT = tw;
  const cand = game.tmpA;
  const n = game.zgrid.queryRay(x, y, dx, dy, maxT, MAX_ZOMBIE_RADIUS, cand);
  let first = null, bestT = Infinity;
  for (let i = 0; i < n; i++) {
    const z = cand[i];
    if (z.dead) continue;
    const t = rayCircle(x, y, dx, dy, z.x, z.y, z.radius, maxT);
    if (t >= 0 && t < bestT) {
      bestT = t;
      first = z;
    }
  }
  const points = [{ x: Math.round(mx), y: Math.round(my) }];
  if (!first) {
    points.push({ x: Math.round(x + dx * maxT), y: Math.round(y + dy * maxT) });
    game.emit({ type: 'chain', pid: p.id, points });
    return;
  }
  const dmg = w.damage * (p.perks.damageMult || 1);
  const hit = [first];
  let last = first;
  points.push({ x: Math.round(first.x), y: Math.round(first.y) });
  const lx = first.x, ly = first.y;
  knockZombie(first, dx, dy, w.knockback);
  damageZombie(game, first, dmg, p.id, false);
  const near = game.tmpB;
  for (let c = 0; c < (w.chains || 0); c++) {
    const cx = c === 0 ? lx : last.x, cy = c === 0 ? ly : last.y;
    const m = game.zgrid.queryRadius(cx, cy, w.chainRange, near);
    let best = null, bd = Infinity;
    for (let i = 0; i < m; i++) {
      const z = near[i];
      if (z.dead || hit.includes(z)) continue;
      const d = (z.x - cx) * (z.x - cx) + (z.y - cy) * (z.y - cy);
      if (d < bd && game.world.lineOfSight(cx, cy, z.x, z.y)) {
        bd = d;
        best = z;
      }
    }
    if (!best) break;
    hit.push(best);
    points.push({ x: Math.round(best.x), y: Math.round(best.y) });
    damageZombie(game, best, dmg, p.id, false);
    last = best;
  }
  game.emit({ type: 'chain', pid: p.id, points });
}

function fireProjectile(game, p, id, w) {
  const spec = w.projectile;
  const a = w.spread > 0 ? p.angle + game.rng.range(-w.spread, w.spread) : p.angle;
  game.shotEvent(p.id, p.id, 0, id, p.x + Math.cos(p.angle) * MUZZLE, p.y + Math.sin(p.angle) * MUZZLE, p.angle);
  const speed = spec.kind === 'flame' ? spec.speed * game.rng.range(0.85, 1.1) : spec.speed;
  // Spawn at the muzzle unless a wall is closer, so point-blank shots still connect.
  let sx = p.x, sy = p.y;
  const dx = Math.cos(a), dy = Math.sin(a);
  const tw = game.world.raycastSolid(p.x, p.y, dx, dy, MUZZLE);
  const off = tw >= 0 ? Math.max(0, tw - 2) : 12;
  sx += dx * off;
  sy += dy * off;
  addProjectile(game, {
    kind: spec.kind, x: sx, y: sy, vx: dx * speed, vy: dy * speed, angle: a,
    life: spec.life, maxLife: spec.life, radius: spec.radius, owner: p.id, weapon: id,
    damage: w.damage * (spec.kind === 'bolt' ? p.perks.damageMult || 1 : 1),
    pierce: w.pierce || 1, knockback: w.knockback || 0,
    explodeRadius: spec.explodeRadius || 0, explodeDamage: spec.explodeDamage || 0,
    burn: w.burn || null,
  });
}

/** Throw a frag or a molotov from player p toward its aim. */
export function throwProjectile(game, p, kind) {
  const a = p.angle;
  const dx = Math.cos(a), dy = Math.sin(a);
  const tw = game.world.raycastSolid(p.x, p.y, dx, dy, 20);
  const off = tw >= 0 ? Math.max(0, tw - 6) : 14;
  const vx = dx * THROW_SPEED + p.vx * 0.3, vy = dy * THROW_SPEED + p.vy * 0.3;
  const base = {
    kind, x: p.x + dx * off, y: p.y + dy * off, vx, vy, angle: a, radius: 5, owner: p.id, weapon: null,
    damage: 0, pierce: 0, knockback: 0, explodeRadius: 0, explodeDamage: 0, burn: null,
  };
  if (kind === 'frag') {
    const f = THROWABLES.frag;
    base.life = f.fuse;
    base.maxLife = f.fuse;
    base.explodeRadius = f.explodeRadius;
    base.explodeDamage = f.explodeDamage;
    base.bounce = f.bounce;
  } else {
    base.life = MOLOTOV_LIFE;
    base.maxLife = MOLOTOV_LIFE;
  }
  addProjectile(game, base);
  game.emit({ type: 'throw', pid: p.id, kind });
}

/** Spitter acid glob lobbed from (x, y) to land at (tx, ty). */
export function lobAcid(game, z, tx, ty) {
  const sp = z.def.special;
  const dx = tx - z.x, dy = ty - z.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const life = d / sp.speed;
  addProjectile(game, {
    kind: 'acid', x: z.x, y: z.y, vx: (dx / d) * sp.speed, vy: (dy / d) * sp.speed, angle: Math.atan2(dy, dx),
    life, maxLife: life, radius: 6, owner: 0, weapon: null, damage: z.damage, pierce: 0, knockback: 0,
    explodeRadius: 0, explodeDamage: 0, burn: null, tx, ty,
    poolRadius: sp.poolRadius, poolDps: sp.poolDps * game.diff.damage, poolDuration: sp.poolDuration,
  });
}

function addProjectile(game, pr) {
  if (game.projectiles.length >= MAX_PROJECTILES) return null;
  pr.id = game.ids.projectile.alloc();
  pr.dead = false;
  pr.hits = null;
  game.projectiles.push(pr);
  return pr;
}

// -------------------------------------------------------------------------------------
// Projectiles

/** Move every projectile one tick (bolts, grenades, rockets, flames, frags, molotovs, acid). */
export function updateProjectiles(game) {
  const list = game.projectiles;
  for (let i = 0; i < list.length; i++) {
    const pr = list[i];
    if (pr.dead) continue;
    switch (pr.kind) {
      case 'frag': stepFrag(game, pr); break;
      case 'molotov': stepMolotov(game, pr); break;
      case 'acid': stepAcid(game, pr); break;
      case 'flame': stepFlame(game, pr); break;
      default: stepShot(game, pr); break;
    }
  }
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const pr = list[i];
    if (pr.dead) {
      game.ids.projectile.free(pr.id);
      continue;
    }
    list[w++] = pr;
  }
  list.length = w;
}

/** Bolts, launcher grenades, rockets. */
function stepShot(game, pr) {
  const speed = Math.hypot(pr.vx, pr.vy);
  const dx = pr.vx / speed, dy = pr.vy / speed;
  const step = speed * DT;
  pr.life -= DT;
  const tw = game.world.raycastSolid(pr.x, pr.y, dx, dy, step);
  const wallT = tw >= 0 ? tw : Infinity;
  const maxT = Math.min(step, wallT);
  const cand = game.tmpA;
  const n = game.zgrid.queryRay(pr.x, pr.y, dx, dy, maxT, MAX_ZOMBIE_RADIUS + pr.radius, cand);
  let nh = 0;
  const cap = Math.min(64, hitT.length);
  for (let i = 0; i < n; i++) {
    const z = cand[i];
    if (z.dead || (pr.hits && pr.hits.includes(z.id))) continue;
    const t = rayCircle(pr.x, pr.y, dx, dy, z.x, z.y, z.radius + pr.radius, maxT);
    if (t >= 0) nh = insertHit(nh, cap, t, z);
  }
  const owner = game.getPlayer(pr.owner);
  const targets = hitO.slice(0, nh);
  const ts = Array.from(hitT.subarray(0, nh));
  for (let i = 0; i < nh; i++) hitO[i] = null;
  for (let i = 0; i < targets.length; i++) {
    const z = targets[i];
    if (pr.kind === 'bolt') {
      if (!pr.hits) pr.hits = [];
      pr.hits.push(z.id);
      knockZombie(z, dx, dy, pr.knockback);
      damageZombie(game, z, pr.damage, pr.owner, false);
      if (pr.hits.length >= pr.pierce) {
        pr.x += dx * ts[i];
        pr.y += dy * ts[i];
        pr.dead = true;
        return;
      }
    } else {
      // Grenade/rocket: direct hit damage, then the blast.
      const t = ts[i];
      damageZombie(game, z, pr.damage, pr.owner, true);
      pr.x += dx * Math.max(0, t - 2);
      pr.y += dy * Math.max(0, t - 2);
      pr.dead = true;
      explode(game, pr.x, pr.y, pr.explodeRadius, pr.explodeDamage, owner, pr.kind === 'rocket' ? 'rocket' : 'grenade');
      return;
    }
  }
  if (wallT <= step) {
    pr.x += dx * Math.max(0, wallT - 3);
    pr.y += dy * Math.max(0, wallT - 3);
    pr.dead = true;
    if (pr.explodeRadius > 0) explode(game, pr.x, pr.y, pr.explodeRadius, pr.explodeDamage, owner, pr.kind === 'rocket' ? 'rocket' : 'grenade');
    return;
  }
  pr.x += dx * step;
  pr.y += dy * step;
  if (pr.life <= 0 || outOfMap(game, pr)) {
    pr.dead = true;
    if (pr.explodeRadius > 0) explode(game, pr.x, pr.y, pr.explodeRadius, pr.explodeDamage, owner, pr.kind === 'rocket' ? 'rocket' : 'grenade');
  }
}

function stepFlame(game, pr) {
  pr.life -= DT;
  const speed = Math.hypot(pr.vx, pr.vy);
  if (speed < 1e-6) {
    pr.dead = true;
    return;
  }
  const dx = pr.vx / speed, dy = pr.vy / speed;
  const step = speed * DT;
  const tw = game.world.raycastSolid(pr.x, pr.y, dx, dy, step);
  const adv = tw >= 0 ? Math.max(0, tw - 2) : step;
  pr.x += dx * adv;
  pr.y += dy * adv;
  // The flame puff grows as it travels; each puff burns each zombie once.
  const r = pr.radius * (0.6 + 0.8 * (1 - pr.life / pr.maxLife));
  const list = game.tmpA;
  const n = game.zgrid.queryRadius(pr.x, pr.y, r + MAX_ZOMBIE_RADIUS, list);
  for (let i = 0; i < n; i++) {
    const z = list[i];
    if (z.dead) continue;
    const ddx = z.x - pr.x, ddy = z.y - pr.y;
    const rr = r + z.radius;
    if (ddx * ddx + ddy * ddy > rr * rr) continue;
    if (!pr.hits) pr.hits = [];
    else if (pr.hits.includes(z.id)) continue;
    pr.hits.push(z.id);
    if (pr.burn) igniteZombie(z, pr.burn.dps, pr.burn.duration, pr.owner);
    damageZombie(game, z, pr.damage, pr.owner, false);
  }
  if (game.settings.friendlyFire) {
    for (const q of game.players) {
      if (q.id === pr.owner || q.state !== 'alive') continue;
      if (Math.hypot(q.x - pr.x, q.y - pr.y) < r + PLAYER_RADIUS) {
        if (!pr.hits) pr.hits = [];
        const key = -q.id;
        if (pr.hits.includes(key)) continue;
        pr.hits.push(key);
        damagePlayer(game, q, pr.damage * FF_MULT, pr.x, pr.y, true);
      }
    }
  }
  pr.vx *= 0.985;
  pr.vy *= 0.985;
  if (tw >= 0 || pr.life <= 0) pr.dead = true;
}

function stepFrag(game, pr) {
  pr.life -= DT;
  const drag = Math.exp(-FRAG_DRAG * DT);
  pr.vx *= drag;
  pr.vy *= drag;
  moveBouncing(game, pr, pr.bounce);
  const sp = Math.hypot(pr.vx, pr.vy);
  if (sp > 20) pr.angle += sp * DT * 0.05;
  if (pr.life <= 0) {
    pr.dead = true;
    explode(game, pr.x, pr.y, pr.explodeRadius, pr.explodeDamage, game.getPlayer(pr.owner), 'frag');
  }
}

/** Move a small projectile, reflecting off shot-blocking obstacles and the map edge. */
function moveBouncing(game, pr, bounce) {
  let remaining = Math.hypot(pr.vx, pr.vy) * DT;
  for (let iter = 0; iter < 3 && remaining > 1e-3; iter++) {
    const sp = Math.hypot(pr.vx, pr.vy);
    if (sp < 1e-6) break;
    const dx = pr.vx / sp, dy = pr.vy / sp;
    const idx = game.world.index;
    const t = idx.raycast(pr.x, pr.y, dx, dy, remaining + pr.radius, MASK_SOLID, 0);
    if (t < 0) {
      pr.x += dx * remaining;
      pr.y += dy * remaining;
      break;
    }
    const adv = Math.max(0, t - pr.radius);
    pr.x += dx * adv;
    pr.y += dy * adv;
    remaining -= adv;
    const nx = idx.hit.nx, ny = idx.hit.ny;
    const vn = pr.vx * nx + pr.vy * ny;
    if (vn < 0) {
      pr.vx -= (1 + bounce) * vn * nx;
      pr.vy -= (1 + bounce) * vn * ny;
      pr.vx *= 0.85;
      pr.vy *= 0.85;
    }
    if (t === 0) {
      // Started inside something: nudge out along the normal.
      pr.x += nx * 2;
      pr.y += ny * 2;
      break;
    }
  }
  const W = game.map.width, H = game.map.height;
  if (pr.x < pr.radius) { pr.x = pr.radius; pr.vx = Math.abs(pr.vx) * bounce; }
  if (pr.x > W - pr.radius) { pr.x = W - pr.radius; pr.vx = -Math.abs(pr.vx) * bounce; }
  if (pr.y < pr.radius) { pr.y = pr.radius; pr.vy = Math.abs(pr.vy) * bounce; }
  if (pr.y > H - pr.radius) { pr.y = H - pr.radius; pr.vy = -Math.abs(pr.vy) * bounce; }
}

function stepMolotov(game, pr) {
  pr.life -= DT;
  const drag = Math.exp(-MOLOTOV_DRAG * DT);
  pr.vx *= drag;
  pr.vy *= drag;
  const sp = Math.hypot(pr.vx, pr.vy);
  const dx = pr.vx / sp, dy = pr.vy / sp;
  const step = sp * DT;
  pr.angle += DT * 12;
  const tw = game.world.raycastSolid(pr.x, pr.y, dx, dy, step + pr.radius);
  let shatter = false;
  let adv = step;
  if (tw >= 0) {
    adv = Math.max(0, tw - pr.radius - 2);
    shatter = true;
  }
  // First zombie in the way.
  const cand = game.tmpA;
  const n = game.zgrid.queryRay(pr.x, pr.y, dx, dy, adv, MAX_ZOMBIE_RADIUS + pr.radius, cand);
  let bestT = Infinity;
  for (let i = 0; i < n; i++) {
    const z = cand[i];
    if (z.dead) continue;
    const t = rayCircle(pr.x, pr.y, dx, dy, z.x, z.y, z.radius + pr.radius, adv);
    if (t >= 0 && t < bestT) bestT = t;
  }
  if (bestT < Infinity) {
    adv = bestT;
    shatter = true;
  }
  pr.x += dx * adv;
  pr.y += dy * adv;
  if (outOfMap(game, pr)) {
    pr.x = Math.max(4, Math.min(game.map.width - 4, pr.x));
    pr.y = Math.max(4, Math.min(game.map.height - 4, pr.y));
    shatter = true;
  }
  if (shatter || pr.life <= 0) {
    pr.dead = true;
    const m = THROWABLES.molotov;
    addHazard(game, 'fire', pr.x, pr.y, m.fireRadius, m.fireDuration, m.fireDps, pr.owner);
    game.emit({ type: 'ignite', x: Math.round(pr.x), y: Math.round(pr.y), r: m.fireRadius });
  }
}

function stepAcid(game, pr) {
  pr.life -= DT;
  if (pr.life > 0) {
    pr.x += pr.vx * DT;
    pr.y += pr.vy * DT;
    return;
  }
  pr.x = pr.tx;
  pr.y = pr.ty;
  pr.dead = true;
  addHazard(game, 'acid', pr.x, pr.y, pr.poolRadius, pr.poolDuration, pr.poolDps, 0);
  // Direct splash on landing.
  for (const q of game.players) {
    if (q.state === 'dead') continue;
    if (Math.hypot(q.x - pr.x, q.y - pr.y) <= pr.poolRadius * 0.6 + PLAYER_RADIUS) {
      damagePlayer(game, q, pr.damage, pr.x, pr.y);
    }
  }
}

function outOfMap(game, pr) {
  return pr.x < 0 || pr.y < 0 || pr.x > game.map.width || pr.y > game.map.height;
}

// -------------------------------------------------------------------------------------
// Hazards

/** Create a ground hazard ('fire' or 'acid') of radius r lasting `life` seconds. */
export function addHazard(game, kind, x, y, r, life, dps, owner) {
  const h = { id: game.ids.hazard.alloc(), kind, x, y, r, life, maxLife: life, dps, owner, dead: false };
  game.hazards.push(h);
  return h;
}

/** Tick fire (ignites zombies) and acid (hurts players) pools; drop expired ones. */
export function updateHazards(game) {
  const list = game.hazards;
  const near = game.tmpA;
  for (const h of list) {
    h.life -= DT;
    if (h.life <= 0) continue;
    if (h.kind === 'fire') {
      const n = game.zgrid.queryRadius(h.x, h.y, h.r + MAX_ZOMBIE_RADIUS * 0.5, near);
      for (let i = 0; i < n; i++) {
        const z = near[i];
        if (z.dead) continue;
        const rr = h.r + z.radius * 0.5;
        if ((z.x - h.x) * (z.x - h.x) + (z.y - h.y) * (z.y - h.y) <= rr * rr) {
          igniteZombie(z, h.dps, BURN_AFTER_FIRE, h.owner);
        }
      }
      if (game.settings.friendlyFire) {
        for (const q of game.players) {
          if (q.state !== 'alive') continue;
          if (Math.hypot(q.x - h.x, q.y - h.y) <= h.r) damagePlayer(game, q, h.dps * FF_MULT * DT, h.x, h.y, true, true);
        }
      }
    } else if (h.kind === 'acid') {
      for (const q of game.players) {
        if (q.state === 'dead') continue;
        if (Math.hypot(q.x - h.x, q.y - h.y) <= h.r + PLAYER_RADIUS * 0.5) {
          damagePlayer(game, q, h.dps * DT, h.x, h.y, false, true);
        }
      }
    }
  }
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (h.life <= 0) {
      game.ids.hazard.free(h.id);
      continue;
    }
    list[w++] = h;
  }
  list.length = w;
}

// -------------------------------------------------------------------------------------
// Turrets & barricades

/** Sentry turrets: keep/acquire the nearest visible zombie, turn, fire; drop destroyed ones. */
export function updateTurrets(game) {
  const list = game.turrets;
  for (const t of list) {
    if (t.dead) continue;
    t.cooldown -= DT;
    if (t.cooldown < -DT) t.cooldown = -DT;
    if (t.firingT > 0) t.firingT -= DT;
    t.retargetT -= DT;
    let z = t.target;
    if (z && (z.dead || Math.hypot(z.x - t.x, z.y - t.y) > TURRET.range + z.radius)) z = t.target = null;
    if (!z || t.retargetT <= 0) {
      t.retargetT = 0.3;
      z = t.target = acquireTarget(game, t);
    }
    if (!z) {
      if (t.cooldown < 0) t.cooldown = 0;
      continue;
    }
    const want = Math.atan2(z.y - t.y, z.x - t.x);
    t.angle = turnTowards(t.angle, want, TURRET.turnRate * DT);
    if (Math.abs(angleDiff(t.angle, want)) > 0.12 || t.ammo <= 0) {
      if (t.cooldown < 0) t.cooldown = 0;
      continue;
    }
    const owner = game.getPlayer(t.owner);
    const mult = owner ? owner.perks.turretDamage || 1 : 1;
    let shots = 0;
    while (t.cooldown <= COOLDOWN_EPS && t.ammo > 0 && shots < 3) {
      fireHitscan(game, 't' + t.id, 0, t.id, 'rifle', TURRET_GUN, t.x, t.y, t.angle, mult, owner ? owner.id : 0, null);
      t.ammo--;
      t.cooldown += 1 / TURRET.rate;
      t.firingT = 0.12;
      shots++;
    }
  }
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.dead) {
      game.ids.turret.free(t.id);
      continue;
    }
    list[w++] = t;
  }
  list.length = w;
}

function acquireTarget(game, t) {
  const near = game.tmpA;
  const n = game.zgrid.queryRadius(t.x, t.y, TURRET.range, near);
  if (!n) return null;
  // Check line of sight nearest-first, but only for the closest few candidates.
  const tried = game.tmpB;
  tried.length = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    let best = null, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const z = near[i];
      if (z.dead || tried.includes(z)) continue;
      const d = (z.x - t.x) * (z.x - t.x) + (z.y - t.y) * (z.y - t.y);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    if (!best) return null;
    if (game.world.lineOfSight(t.x, t.y, best.x, best.y)) return best;
    tried.push(best);
  }
  return null;
}

/** Drop broken barricades and push the live set into collision and navigation. */
export function rebuildBarricades(game) {
  const list = game.barricades;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.dead) {
      game.ids.barricade.free(b.id);
      continue;
    }
    list[w++] = b;
  }
  list.length = w;
  game.world.setBarricades(list);
  game.flow.setBarricades(list);
  game.flowBig.setBarricades(list);
  game.barricadesDirty = false;
}

