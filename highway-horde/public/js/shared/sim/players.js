// Player rules: input queue, movement, weapon handling, melee, throwables,
// deployables, downed/revive/respawn, pickups, the shop, and the snapshot view.

import {
  DT, PLAYER_RADIUS, STAMINA_MAX, START_CASH, WEAPON_SLOTS, ARMOR_MAX, ARMOR_ABSORB, BLEEDOUT_TIME,
  REVIVE_TIME, REVIVE_RADIUS, REVIVE_HP, SELF_REVIVE_DELAY, RESPAWN_HP, REVIVE_BONUS,
  INTERACT_RADIUS, PICKUP_RADIUS, PICKUP_LIFETIME, SUPPLY_RADIUS, MELEE_RANGE, MELEE_ARC,
  MELEE_DAMAGE, MELEE_KNOCKBACK, MELEE_COOLDOWN, FRAG_MAX, MOLOTOV_MAX, THROW_COOLDOWN,
  TURRET, BARRICADE, DOWNED_HIT_BLEED, DOWNED_HIT_BLEED_RATE, DOWNED_HIT_BLEED_BANK, WAVE_CLEAR_BONUS,
} from '../constants.js';
import { WEAPONS, crateWeaponPool } from '../weapons.js';
import { CLASSES, perksFor } from '../classes.js';
import { ITEMS, isBuyable, isWeaponId, isItemId, ammoPrice, DROP_TABLE } from '../items.js';
import { angleDiff } from '../math.js';
import { makeObb, circleOverlapsObb, MASK_MOVE } from '../geom.js';
import { stepPlayerMovement, settleVertical } from '../movement.js';
import { resetVertical } from '../jump.js';
import { RIDE_TICKS } from '../campaign.js';
import { clearEdges, mergeEdges } from './core.js';
import { weaponOf, applyProfileToPlayer, giveStoryKit } from './profile-mods.js';
import {
  fireWeaponShot, damageZombie, knockZombie, throwProjectile, rebuildBarricades, MAX_ZOMBIE_RADIUS,
} from './combat.js';

/** Most InputCmds a player's queue holds (SPEC §3.3). */
export const MAX_QUEUE = 6;
/**
 * Backlog drain (SPEC §3.3): when a player's queue never ran below DRAIN_MIN cmds for
 * DRAIN_WINDOW ticks in a row, one extra cmd is dropped, so a burst of late inputs
 * doesn't add latency for the rest of the match.
 */
const DRAIN_WINDOW = 20;
const DRAIN_MIN = 2;
const MELEE_ANIM = 0.25;
/** Weapon switch: no shot for this long (clients mirror it for shot prediction). */
export const SWITCH_DELAY = 0.15;
const MAX_PICKUPS = 80;
const PLAYER_KB_DECAY = 7;
// Float residue (1/30 - 2/60 is not exactly 0) must not cost a whole tick per shot.
export const COOLDOWN_EPS = 1e-6;

const DEFAULT_CMD = {
  seq: 0, moveX: 0, moveY: 0, angle: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false,
  slot: -1, cycle: 0, jump: false,
};

/** Build a fresh player record for { id, name, color, cls }. */
export function createPlayer(game, info) {
  const cls = CLASSES[info.cls] ? info.cls : 'soldier';
  const perks = perksFor(cls);
  const p = {
    id: info.id | 0,
    name: String(info.name || 'Survivor'),
    color: info.color | 0,
    cls,
    perks,
    x: 0, y: 0, angle: 0, vx: 0, vy: 0, kbx: 0, kby: 0,
    state: 'alive',
    hp: perks.maxHp, maxHp: perks.maxHp, armor: perks.startArmor,
    stamina: STAMINA_MAX, sprintLock: false, sprinting: false,
    zq: 0, vzq: 0, jumpCd: 0, climbT: 0, climbTo: -1, z: 0,
    // campaign: zip-line ride ticks left / frozen on the cable / escaped down the line / horde-front exposure
    riding: 0, frozen: false, escaped: false, fogT: 0, rideX: 0, rideY: 0, rideZ: 0,
    speedMult: perks.speedMult, moveMult: 1, staminaMult: perks.staminaMult,
    slot: 1, lastSlot: 0,
    slots: [null, null, null], mag: [0, 0, 0], res: [0, 0, 0],
    reloadT: 0, reloadTotal: 0, reloadSlot: -1,
    cooldown: 0, spin: 0, lastFireTick: -1000, meleeT: 0, meleeCd: 0, throwCd: 0, burstLeft: 0, prevFire: false,
    emptyLatch: false, freeMag: WEAPONS.pistol.mag, prevSlot: 1,
    cash: START_CASH, kills: 0, damage: 0, revives: 0, downs: 0, earned: 0,
    frags: perks.startFrags, molotovs: perks.startMolotovs,
    turrets: perks.startTurrets, barricades: 0, selfRevive: false,
    bleedout: 0, hitBleed: 0, downT: 0, revive: 0, reviver: 0, respawn: false, ready: false, lastSeq: 0,
    queue: [], qMin: MAX_QUEUE, qWin: 0, cmd: { ...DEFAULT_CMD }, prevInteract: false,
    dotAcc: 0, dotT: 0, dotX: 0, dotY: 0,
  };
  giveStarterKit(p);
  // Story mode (STORY.md): perks, weapon tiers and the loadout of the survivor's profile.
  if (info.story) applyProfileToPlayer(game, p, info.story);
  return p;
}

function giveStarterKit(p) {
  if (p.story) {
    giveStoryKit(p);
    return;
  }
  setSlot(p, 0, 'pistol');
  const cw = CLASSES[p.cls].startWeapon;
  setSlot(p, 1, cw && WEAPONS[cw] ? cw : null);
  p.slot = p.slots[1] ? 1 : 0;
  p.lastSlot = 0;
}

function setSlot(p, i, id) {
  p.slots[i] = id;
  if (id) {
    const w = weaponOf(p, id);
    p.mag[i] = w.mag;
    p.res[i] = w.reserve;
  } else {
    p.mag[i] = 0;
    p.res[i] = 0;
  }
}

/** A clear player spawn point, preferring index i. */
export function spawnPointFor(game, i) {
  // Evac Run: late joiners and respawns come back inside the safe zone.
  if (game.zone && game.started) return game.zone.spawnPoint(i);
  // Campaign: respawns and late joiners come back where the team is in the current stage.
  if (game.campaign && game.started) return game.campaign.spawnPoint(i);
  const sp = game.map.playerSpawns;
  if (!sp || !sp.length) return { x: game.map.width / 2, y: game.map.height / 2 };
  for (let k = 0; k < sp.length; k++) {
    const s = sp[(i + k) % sp.length];
    let taken = false;
    for (const p of game.players) {
      if (p.state !== 'dead' && Math.abs(p.x - s.x) < PLAYER_RADIUS * 2 && Math.abs(p.y - s.y) < PLAYER_RADIUS * 2) {
        taken = true;
        break;
      }
    }
    if (!taken) return s;
  }
  return sp[i % sp.length];
}

// -------------------------------------------------------------------------------------
// Input queue (SPEC §3.3)

/**
 * Queue one (already copied) InputCmd for p. The queue never holds more than MAX_QUEUE:
 * the oldest is dropped, its presses OR-ed into the next one.
 */
export function queueCmd(p, c) {
  const q = p.queue;
  while (q.length >= MAX_QUEUE) mergeEdges(q.length > 1 ? q[1] : c, q.shift());
  q.push(c);
}

function nextCmd(p) {
  const q = p.queue;
  while (q.length > MAX_QUEUE) mergeEdges(q[1], q.shift());
  if (q.length < p.qMin) p.qMin = q.length;
  if (++p.qWin >= DRAIN_WINDOW) {
    if (p.qMin >= DRAIN_MIN) mergeEdges(q[1], q.shift());
    p.qWin = 0;
    p.qMin = MAX_QUEUE;
  }
  if (q.length) {
    const c = q.shift();
    p.cmd = c;
    p.lastSeq = c.seq;
    return c;
  }
  // Starved: repeat the last command without its one-shot presses.
  return clearEdges(p.cmd);
}

// -------------------------------------------------------------------------------------
// Per-tick player update

/**
 * The weapon the player fires right now: { id, slot } (slot -1 = free downed pistol).
 * Downed players use a pistol-category gun in slot 0 while it has any ammo left, else
 * the free infinite pistol. Needs { state, slots, slot } plus the ammo as either
 * { mag, res } arrays (sim, client weapon state) or snapshot `ammo` pairs, so clients
 * use it for shot prediction too; without ammo info slot 0 counts as loaded.
 */
export function activeWeapon(p) {
  if (p.state === 'downed') {
    const s0 = p.slots[0];
    if (s0 && WEAPONS[s0].category === 'pistol' && !slot0Dry(p)) return { id: s0, slot: 0 };
    return { id: 'pistol', slot: -1 };
  }
  const id = p.slots[p.slot];
  return { id, slot: id ? p.slot : -1 };
}

/** True if slot 0's magazine and reserve are both empty. */
function slot0Dry(p) {
  if (p.mag && p.res) return p.mag[0] <= 0 && p.res[0] === 0;
  const a = p.ammo && p.ammo[0];
  return !!a && a[0] <= 0 && a[1] === 0;
}

/** Apply one InputCmd per player: movement, weapons, melee, throwables, deployables, crates. */
export function updatePlayers(game) {
  for (const p of game.players) {
    const cmd = nextCmd(p);
    // A little negative carry keeps fractional fire rates exact; never more than a
    // tick's worth, so nothing can bank a burst while dead or unarmed.
    p.cooldown -= DT;
    if (p.cooldown < -DT) p.cooldown = -DT;
    if (p.meleeCd > 0) p.meleeCd -= DT;
    if (p.throwCd > 0) p.throwCd -= DT;
    if (p.meleeT > 0) p.meleeT -= DT;
    if (p.state === 'dead') {
      p.sprinting = false;
      p.prevInteract = cmd.interact;
      continue;
    }
    p.angle = cmd.angle;
    const alive = p.state === 'alive' && !p.escaped;
    if (alive) handleSwitch(game, p, cmd);
    const aw = activeWeapon(p);
    p.moveMult = alive && aw.id ? WEAPONS[aw.id].moveMult : 1;
    const ox = p.x, oy = p.y;
    stepPlayerMovement(p, cmd, DT, game.world);
    // Knockback impulses (brute charge, boss slam) are applied after normal movement.
    if (p.kbx !== 0 || p.kby !== 0) {
      game.world.moveCircle(p, PLAYER_RADIUS, p.kbx * DT, p.kby * DT, MASK_MOVE, p.z);
      const k = Math.exp(-PLAYER_KB_DECAY * DT);
      p.kbx *= k;
      p.kby *= k;
      if (Math.abs(p.kbx) < 2 && Math.abs(p.kby) < 2) {
        p.kbx = 0;
        p.kby = 0;
      }
    }
    p.vx = (p.x - ox) / DT;
    p.vy = (p.y - oy) / DT;

    // Downed players reload too (the dead never get here).
    if (cmd.reload) startReload(game, p);
    if (!p.escaped) handleFire(game, p, cmd, aw);
    // Game over / victory are terminal: no melee, throws, building or crates either.
    if (alive && !game.over) {
      if (cmd.melee && p.meleeCd <= 0) doMelee(game, p);
      if (cmd.frag && p.frags > 0 && p.throwCd <= 0) {
        p.frags--;
        p.throwCd = THROW_COOLDOWN;
        throwProjectile(game, p, 'frag');
      }
      if (cmd.molotov && p.molotovs > 0 && p.throwCd <= 0) {
        p.molotovs--;
        p.throwCd = THROW_COOLDOWN;
        throwProjectile(game, p, 'molotov');
      }
      if (cmd.turret) placeTurret(game, p);
      if (cmd.barricade) placeBarricade(game, p);
      if (cmd.interact && !p.prevInteract) {
        if (!(game.campaign && game.campaign.tryZip(p))) tryTakeCrate(game, p);
      }
    }
    p.prevInteract = cmd.interact;
  }
}

function handleSwitch(game, p, cmd) {
  let target = -1;
  if (cmd.slot >= 0 && cmd.slot < WEAPON_SLOTS && p.slots[cmd.slot] && cmd.slot !== p.slot) {
    target = cmd.slot;
  } else if (cmd.cycle) {
    for (let k = 1; k < WEAPON_SLOTS; k++) {
      const s = (p.slot + cmd.cycle * k + WEAPON_SLOTS * 2) % WEAPON_SLOTS;
      if (p.slots[s]) {
        target = s;
        break;
      }
    }
  } else if (cmd.lastWeapon && p.lastSlot !== p.slot && p.slots[p.lastSlot]) {
    target = p.lastSlot;
  }
  if (target >= 0 && target !== p.slot) switchSlot(game, p, target);
}

function switchSlot(game, p, s) {
  p.lastSlot = p.slot;
  p.slot = s;
  p.reloadT = 0;
  p.reloadSlot = -1;
  p.spin = 0;
  p.burstLeft = 0;
  if (p.cooldown < SWITCH_DELAY) p.cooldown = SWITCH_DELAY;
  game.emit({ type: 'switch', pid: p.id, weapon: p.slots[s] });
}

/** Begin reloading the active weapon if it can take ammo. */
function startReload(game, p) {
  if (p.reloadT > 0) return false;
  const aw = activeWeapon(p);
  if (!aw.id) return false;
  const w = weaponOf(p, aw.id);
  const mag = aw.slot < 0 ? p.freeMag : p.mag[aw.slot];
  const res = aw.slot < 0 ? -1 : p.res[aw.slot];
  if (mag >= w.mag || res === 0) return false;
  // (per-round reloads: this is the time for one round; finishReload starts the next)
  p.reloadTotal = w.reload * (p.perks.reloadMult || 1);
  p.reloadT = p.reloadTotal;
  p.reloadSlot = aw.slot;
  p.burstLeft = 0;
  game.emit({ type: 'reload', pid: p.id, weapon: aw.id, time: p.reloadTotal });
  return true;
}

function finishReload(game, p, aw) {
  const w = weaponOf(p, aw.id);
  if (aw.slot < 0) {
    p.freeMag = w.mag;
  } else {
    const need = w.mag - p.mag[aw.slot];
    const res = p.res[aw.slot];
    let take = res < 0 ? need : Math.min(need, res);
    if (w.reloadOne) take = Math.min(take, 1);
    p.mag[aw.slot] += take;
    if (res >= 0) p.res[aw.slot] = res - take;
  }
  p.reloadT = 0;
  p.reloadSlot = -1;
  // Round by round: keep loading until full (a trigger pull stops it, see handleFire).
  if (w.reloadOne && aw.slot >= 0) startReload(game, p);
}

function handleFire(game, p, cmd, aw) {
  if (!aw.id) {
    p.spin = 0;
    p.burstLeft = 0;
    p.prevFire = !!cmd.fire;
    return;
  }
  const w = weaponOf(p, aw.id);
  if (p.reloadT > 0) {
    if (p.reloadSlot !== aw.slot) {
      p.reloadT = 0;
      p.reloadSlot = -1;
    } else {
      p.reloadT -= DT;
      if (p.reloadT <= 0) finishReload(game, p, aw);
    }
  }
  // Game over / victory are terminal: nobody fires any more (client prediction agrees).
  const trigger = cmd.fire && !game.over;
  const pulled = trigger && !p.prevFire;
  p.prevFire = trigger;
  if (!w.burst || game.over) p.burstLeft = 0;
  // A burst, once started, finishes without the trigger.
  const fire = trigger || p.burstLeft > 0;
  if (w.spinup) {
    if (fire) p.spin = Math.min(1, p.spin + DT / w.spinup);
    else p.spin = Math.max(0, p.spin - DT / (w.spinup * 0.6));
  } else {
    p.spin = 0;
  }
  if (!fire) {
    p.emptyLatch = false;
    if (p.cooldown < 0) p.cooldown = 0;
    return;
  }
  if (p.reloadT > 0) {
    // A fresh trigger pull stops a round-by-round reload once a round is in.
    const loaded = aw.slot < 0 ? p.freeMag : p.mag[aw.slot];
    if (w.reloadOne && pulled && loaded > 0) {
      p.reloadT = 0;
      p.reloadSlot = -1;
    } else {
      if (p.cooldown < 0) p.cooldown = 0;
      return;
    }
  }
  let mag = aw.slot < 0 ? p.freeMag : p.mag[aw.slot];
  if (mag <= 0) {
    p.burstLeft = 0;
    if (!p.emptyLatch) {
      p.emptyLatch = true;
      game.emit({ type: 'empty', pid: p.id });
    }
    startReload(game, p);
    if (p.cooldown < 0) p.cooldown = 0;
    return;
  }
  if (w.spinup && p.spin < 1) {
    if (p.cooldown < 0) p.cooldown = 0;
    return;
  }
  let shots = 0;
  while (p.cooldown <= COOLDOWN_EPS && mag > 0 && shots < 4) {
    if (w.burst) {
      // a new burst only on the trigger; `burstDelay` after its last round
      if (p.burstLeft <= 0) {
        if (!trigger) break;
        p.burstLeft = w.burst;
      }
      p.burstLeft--;
    }
    fireWeaponShot(game, p, aw.id, w);
    mag--;
    p.cooldown += w.burst && p.burstLeft === 0 ? w.burstDelay : 1 / w.rate;
    shots++;
  }
  if (mag <= 0) p.burstLeft = 0;
  if (aw.slot < 0) p.freeMag = mag;
  else p.mag[aw.slot] = mag;
  if (shots) p.lastFireTick = game.tick;
}

function doMelee(game, p) {
  p.meleeCd = MELEE_COOLDOWN;
  p.meleeT = MELEE_ANIM;
  const mult = p.perks.meleeMult || 1;
  const reach = MELEE_RANGE + MAX_ZOMBIE_RADIUS;
  const list = game.tmpB;
  const n = game.zgrid.queryRadius(p.x, p.y, reach, list);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const z = list[i];
    if (z.dead) continue;
    const dx = z.x - p.x, dy = z.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > MELEE_RANGE + z.radius) continue;
    const close = d < z.radius + PLAYER_RADIUS + 4;
    if (!close && Math.abs(angleDiff(p.angle, Math.atan2(dy, dx))) > MELEE_ARC / 2 + Math.atan2(z.radius, d)) continue;
    if (!close && !game.world.lineOfSight(p.x, p.y, z.x, z.y, Math.max(p.z, z.z))) continue;
    const nx = d > 1e-6 ? dx / d : Math.cos(p.angle), ny = d > 1e-6 ? dy / d : Math.sin(p.angle);
    knockZombie(z, nx, ny, MELEE_KNOCKBACK * mult);
    damageZombie(game, z, MELEE_DAMAGE * mult, p.id, false);
    hits++;
  }
  game.emit({ type: 'melee', pid: p.id, x: Math.round(p.x), y: Math.round(p.y), angle: p.angle, hits });
}

// -------------------------------------------------------------------------------------
// Deployables

/**
 * Where a deployable may go, best first: BARRICADE.placeDistance straight ahead, then
 * other distances and small turns, ordered by how far each is from that spot (fixed
 * order, so placement stays deterministic). Each entry is [distance, angle offset].
 */
const PLACE_CANDIDATES = (() => {
  const d0 = BARRICADE.placeDistance;
  const list = [];
  for (const d of [d0, 40, 70, 30, 90]) {
    for (const a of [0, 0.3, -0.3, 0.6, -0.6]) {
      list.push([d, a, Math.hypot(d * Math.cos(a) - d0, d * Math.sin(a))]);
    }
  }
  list.sort((u, v) => u[2] - v[2]);
  return list.map(([d, a]) => [d, a]);
})();

function canPlaceTurretAt(game, p, x, y) {
  if (!game.world.isCircleFree(x, y, TURRET.radius) || !game.world.lineOfSight(p.x, p.y, x, y)) return false;
  for (const t of game.turrets) {
    if (!t.dead && Math.hypot(t.x - x, t.y - y) < TURRET.radius * 2 + 4) return false;
  }
  return true;
}

function canPlaceBarricadeAt(game, p, x, y, ob) {
  if (!game.world.isObbFree(ob) || !game.world.lineOfSight(p.x, p.y, x, y)) return false;
  for (const q of game.players) {
    if (q.state !== 'dead' && circleOverlapsObb(ob, q.x, q.y, PLAYER_RADIUS + 1)) return false;
  }
  for (const t of game.turrets) {
    if (!t.dead && circleOverlapsObb(ob, t.x, t.y, TURRET.radius)) return false;
  }
  return true;
}

/**
 * The spot where p would place a 'turret' or 'barricade' aiming at `angle`: the first
 * free candidate in front (see PLACE_CANDIDATES), in line of sight of the player.
 * @returns {{x: number, y: number, a: number}|null} a = facing (turret) / wall angle (barricade)
 */
export function findPlacement(game, p, kind, angle = p.angle) {
  for (const [d, off] of PLACE_CANDIDATES) {
    const a = angle + off;
    const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    if (kind === 'turret') {
      if (canPlaceTurretAt(game, p, x, y)) return { x, y, a: angle };
    } else {
      const wa = a + Math.PI / 2;
      if (canPlaceBarricadeAt(game, p, x, y, makeObb(x, y, BARRICADE.width, BARRICADE.height, wa))) return { x, y, a: wa };
    }
  }
  return null;
}

function placeTurret(game, p) {
  if (p.turrets <= 0) return;
  const spot = findPlacement(game, p, 'turret');
  if (!spot) {
    game.emit({ type: 'placefail', pid: p.id, kind: 'turret' });
    return;
  }
  const { x, y } = spot;
  p.turrets--;
  const t = {
    id: game.ids.turret.alloc(), owner: p.id, x, y, angle: p.angle,
    hp: TURRET.hp, maxHp: TURRET.hp, ammo: TURRET.ammo, maxAmmo: TURRET.ammo,
    cooldown: 0, target: null, retargetT: 0, firingT: 0, dead: false,
  };
  game.turrets.push(t);
  game.emit({ type: 'place', pid: p.id, kind: 'turret', x: Math.round(x), y: Math.round(y) });
}

function placeBarricade(game, p) {
  if (p.barricades <= 0) return;
  const spot = findPlacement(game, p, 'barricade');
  if (!spot) {
    game.emit({ type: 'placefail', pid: p.id, kind: 'barricade' });
    return;
  }
  const { x, y, a } = spot;
  p.barricades--;
  game.barricades.push({
    id: game.ids.barricade.alloc(), owner: p.id, x, y, a, hp: BARRICADE.hp, maxHp: BARRICADE.hp, dead: false,
  });
  rebuildBarricades(game);
  game.emit({ type: 'place', pid: p.id, kind: 'barricade', x: Math.round(x), y: Math.round(y) });
}

// -------------------------------------------------------------------------------------
// Downed / revive / support

/** Knock a player down (hp reached 0). */
export function downPlayer(game, p) {
  if (p.state !== 'alive') return;
  p.state = 'downed';
  p.hp = 0;
  p.bleedout = BLEEDOUT_TIME * (p.perks.bleedoutMult || 1);
  p.hitBleed = 0;
  p.downT = 0;
  p.revive = 0;
  p.reviver = 0;
  p.downs++;
  p.reloadT = 0;
  p.reloadSlot = -1;
  p.spin = 0;
  p.burstLeft = 0;
  p.sprinting = false;
  p.prevSlot = p.slot;
  if (p.slots[0] && WEAPONS[p.slots[0]].category === 'pistol') p.slot = 0;
  game.emit({ type: 'down', pid: p.id });
}

/** Bring a downed player back up. by = reviver id (0 = wave clear, own id = kit). */
export function revivePlayer(game, p, by) {
  if (p.state !== 'downed') return;
  p.state = 'alive';
  p.hp = Math.min(p.maxHp, REVIVE_HP + (p.perks.reviveHpBonus || 0));
  p.bleedout = 0;
  p.downT = 0;
  p.revive = 0;
  p.reviver = 0;
  p.reloadT = 0;
  p.reloadSlot = -1;
  if (p.slots[p.prevSlot]) p.slot = p.prevSlot;
  game.emit({ type: 'revived', pid: p.id, by });
}

function killPlayer(game, p) {
  p.state = 'dead';
  p.hp = 0;
  p.bleedout = 0;
  p.revive = 0;
  p.reviver = 0;
  p.respawn = true;
  p.sprinting = false;
  // A corpse stays on the roof it died on; one killed mid-jump comes down.
  settleVertical(p, game.world);
  p.kbx = 0;
  p.kby = 0;
  // The dead lose their loadout; respawn restores the starter guns.
  for (let i = 0; i < WEAPON_SLOTS; i++) setSlot(p, i, null);
  p.frags = 0;
  p.molotovs = 0;
  game.emit({ type: 'died', pid: p.id });
}

/** Respawn a dead player at a player spawn (wave clear). */
export function respawnPlayer(game, p, i) {
  const sp = spawnPointFor(game, i);
  p.x = sp.x;
  p.y = sp.y;
  p.state = 'alive';
  p.hp = Math.min(p.maxHp, RESPAWN_HP);
  p.armor = Math.max(p.armor, p.perks.startArmor);
  p.stamina = STAMINA_MAX;
  p.sprintLock = false;
  resetVertical(p, game.world.terrainQ(p.x, p.y));
  p.respawn = false;
  p.bleedout = 0;
  p.revive = 0;
  p.reviver = 0;
  p.kbx = 0;
  p.kby = 0;
  p.reloadT = 0;
  p.reloadSlot = -1;
  p.freeMag = WEAPONS.pistol.mag;
  if (!p.slots.some(Boolean)) giveStarterKit(p);
  if (!p.slots[p.slot]) p.slot = p.slots.findIndex(Boolean);
  game.emit({ type: 'respawn', pid: p.id });
}

/** Damage a player (armour absorbs its share). opts: { ff, dot } */
export function damagePlayer(game, p, amount, fromX, fromY, ff = false, dot = false) {
  if (!(amount > 0) || p.state === 'dead' || p.escaped) return;
  if (p.state === 'downed') {
    if (ff) return;
    p.hitBleed = Math.min(DOWNED_HIT_BLEED_BANK, p.hitBleed + amount * DOWNED_HIT_BLEED);
    if (!dot) game.emit({ type: 'pdamage', pid: p.id, amount: Math.round(amount), x: Math.round(fromX), y: Math.round(fromY) });
    return;
  }
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, amount * ARMOR_ABSORB);
    p.armor -= absorbed;
    amount -= absorbed;
  }
  p.hp -= amount;
  if (ff && p.hp < 1) p.hp = 1;
  if (dot) {
    // Damage over time is reported in chunks so acid doesn't flood the event stream.
    p.dotAcc += amount;
    p.dotX = fromX;
    p.dotY = fromY;
  } else {
    game.emit({ type: 'pdamage', pid: p.id, amount: Math.round(amount * 10) / 10, x: Math.round(fromX), y: Math.round(fromY) });
  }
  if (p.hp <= 0) downPlayer(game, p);
}

/** Bleedout, revives, self-revive kits, medic aura, DoT reporting. */
export function updateDowned(game) {
  const players = game.players;
  for (const p of players) {
    if (p.dotAcc > 0) {
      p.dotT -= DT;
      if (p.dotT <= 0) {
        game.emit({ type: 'pdamage', pid: p.id, amount: Math.round(p.dotAcc * 10) / 10, x: Math.round(p.dotX), y: Math.round(p.dotY) });
        p.dotAcc = 0;
        p.dotT = 0.4;
      }
    }
    if (p.state !== 'downed') continue;
    p.downT += DT;
    if (p.selfRevive && p.downT >= SELF_REVIVE_DELAY * (p.perks.reviveDelayMult || 1)) {
      p.selfRevive = false;
      revivePlayer(game, p, p.id);
      continue;
    }
    if (p.hitBleed > 0) {
      const d = Math.min(p.hitBleed, DOWNED_HIT_BLEED_RATE * DT);
      p.hitBleed -= d;
      p.bleedout -= d;
    }
    // Keep the current reviver while they keep holding; otherwise take the nearest.
    let rv = null;
    if (p.reviver) {
      const cur = game.getPlayer(p.reviver);
      if (cur && canRevive(cur, p)) rv = cur;
    }
    if (!rv) {
      let best = Infinity;
      for (const q of players) {
        if (q === p || !canRevive(q, p)) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < best) {
          best = d;
          rv = q;
        }
      }
    }
    if (rv) {
      if (p.reviver !== rv.id) p.revive = 0;
      p.reviver = rv.id;
      p.revive += (DT * (rv.perks.reviveSpeed || 1)) / REVIVE_TIME;
      if (p.revive >= 1) {
        rv.revives++;
        rv.cash += REVIVE_BONUS;
        rv.earned += REVIVE_BONUS;
        revivePlayer(game, p, rv.id);
      }
      continue;
    }
    p.revive = 0;
    p.reviver = 0;
    p.bleedout -= DT;
    if (p.bleedout <= 0) killPlayer(game, p);
  }
  // Medic aura: the strongest aura in range heals, auras don't stack.
  let anyMedic = false;
  for (const m of players) if (m.state === 'alive' && m.perks.healAura > 0) { anyMedic = true; break; }
  if (!anyMedic) return;
  for (const p of players) {
    if (p.state !== 'alive' || p.hp >= p.maxHp) continue;
    let rate = 0;
    for (const m of players) {
      if (m.state !== 'alive' || !(m.perks.healAura > 0)) continue;
      if (Math.hypot(m.x - p.x, m.y - p.y) <= m.perks.healRadius && m.perks.healAura > rate) rate = m.perks.healAura;
    }
    if (rate > 0) p.hp = Math.min(p.maxHp, p.hp + rate * DT);
  }
}

function canRevive(q, p) {
  return q.state === 'alive' && q.cmd.interact && Math.hypot(q.x - p.x, q.y - p.y) <= REVIVE_RADIUS;
}

// -------------------------------------------------------------------------------------
// Pickups

/** Spawn a pickup; kind from PICKUP_KINDS, weapon for crates. */
export function spawnPickup(game, kind, x, y, weapon = null, life = PICKUP_LIFETIME) {
  if (game.pickups.length >= MAX_PICKUPS) {
    // Drop the oldest non-crate to make room.
    const i = game.pickups.findIndex((k) => k.kind !== 'crate');
    if (i < 0) return null;
    game.ids.pickup.free(game.pickups[i].id);
    game.pickups.splice(i, 1);
  }
  const k = { id: game.ids.pickup.alloc(), kind, x, y, weapon, life };
  game.pickups.push(k);
  return k;
}

/** Roll the drop table for a kill at (x, y). */
export function rollDrop(game, x, y, chance, crateChance) {
  const rng = game.rng;
  if (rng.chance(chance)) {
    const e = rng.weighted(DROP_TABLE);
    spawnPickup(game, e.kind, x, y);
  }
  if (rng.chance(crateChance)) {
    const pool = crateWeaponPool(Math.max(1, game.wave));
    spawnPickup(game, 'crate', x + 6, y + 6, rng.pick(pool));
  }
}

/** Drop the wave-clear weapon crate near the supply station. */
export function dropCrate(game) {
  const s = game.map.supply || { x: game.map.width / 2, y: game.map.height / 2 };
  const rng = game.rng;
  let x = s.x, y = s.y;
  for (let i = 0; i < 12; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(50, 110);
    const cx = s.x + Math.cos(a) * d, cy = s.y + Math.sin(a) * d;
    if (game.world.isCircleFree(cx, cy, 18)) {
      x = cx;
      y = cy;
      break;
    }
  }
  const pool = crateWeaponPool(Math.max(1, game.wave));
  spawnPickup(game, 'crate', x, y, rng.pick(pool), PICKUP_LIFETIME * 2);
  game.emit({ type: 'drop', x: Math.round(x), y: Math.round(y) });
}

function fragMax(p) {
  return FRAG_MAX + (p.perks.extraFrags || 0);
}

function wantsPickup(p, kind) {
  switch (kind) {
    case 'ammo':
      for (let i = 0; i < WEAPON_SLOTS; i++) {
        const id = p.slots[i];
        if (id && weaponOf(p, id).reserve >= 0 && p.res[i] < weaponOf(p, id).reserve) return true;
      }
      return false;
    case 'health': return p.hp < p.maxHp;
    case 'armor': return p.armor < ARMOR_MAX;
    case 'frag': return p.frags < fragMax(p);
    case 'cash': return true;
    default: return false;
  }
}

function applyPickup(game, p, k) {
  switch (k.kind) {
    case 'ammo':
      for (let i = 0; i < WEAPON_SLOTS; i++) {
        const id = p.slots[i];
        if (!id || weaponOf(p, id).reserve < 0) continue;
        const max = weaponOf(p, id).reserve;
        p.res[i] = Math.min(max, p.res[i] + Math.ceil(max * 0.35));
      }
      break;
    case 'health': p.hp = Math.min(p.maxHp, p.hp + 35); break;
    case 'armor': p.armor = Math.min(ARMOR_MAX, p.armor + 25); break;
    case 'frag': p.frags = Math.min(fragMax(p), p.frags + 1); break;
    case 'cash': {
      const amt = game.rng.int(5, 15) * 10;
      p.cash += amt;
      p.earned += amt;
      break;
    }
    default: break;
  }
}

/** Age pickups and auto-collect the ones a nearby living player can use. */
export function updatePickups(game) {
  const list = game.pickups;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    k.life -= DT;
    let taken = k.life <= 0;
    if (!taken && k.kind !== 'crate') {
      for (const p of game.players) {
        if (p.state !== 'alive' || p.escaped) continue;
        const dx = p.x - k.x, dy = p.y - k.y;
        if (dx * dx + dy * dy > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        if (!wantsPickup(p, k.kind)) continue;
        applyPickup(game, p, k);
        game.emit({ type: 'pickup', pid: p.id, kind: k.kind, x: Math.round(k.x), y: Math.round(k.y), weapon: null });
        taken = true;
        break;
      }
    }
    if (taken || k.taken) {
      game.ids.pickup.free(k.id);
      continue;
    }
    list[w++] = k;
  }
  list.length = w;
}

function tryTakeCrate(game, p) {
  // Reviving has priority over grabbing a crate with the same key.
  for (const q of game.players) {
    if (q !== p && q.state === 'downed' && Math.hypot(q.x - p.x, q.y - p.y) <= REVIVE_RADIUS) return;
  }
  let best = null, bestD = INTERACT_RADIUS;
  for (const k of game.pickups) {
    if (k.kind !== 'crate' || k.taken) continue;
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  }
  if (!best || !best.weapon || !WEAPONS[best.weapon]) return;
  giveWeapon(game, p, best.weapon);
  best.taken = true;
  best.life = 0;
  game.emit({ type: 'pickup', pid: p.id, kind: 'crate', x: Math.round(best.x), y: Math.round(best.y), weapon: best.weapon });
}

/**
 * Give a gun like a purchase: refill if owned, else first free slot, else replace
 * the current slot. The new gun is equipped.
 */
export function giveWeapon(game, p, id) {
  const owned = p.slots.indexOf(id);
  if (owned >= 0) {
    p.mag[owned] = weaponOf(p, id).mag;
    p.res[owned] = weaponOf(p, id).reserve;
    return owned;
  }
  let s = p.slots.indexOf(null);
  if (s < 0) s = p.slot;
  setSlot(p, s, id);
  if (s !== p.slot) {
    p.lastSlot = p.slot;
    p.slot = s;
  }
  p.reloadT = 0;
  p.reloadSlot = -1;
  p.spin = 0;
  p.burstLeft = 0;
  game.emit({ type: 'switch', pid: p.id, weapon: id });
  return s;
}

// -------------------------------------------------------------------------------------
// Shop

function shopOpen(game, p) {
  if (game.phase === 'prep' || game.phase === 'intermission') return true;
  if (game.phase !== 'wave') return false;
  const s = game.map.supply;
  if (s && Math.hypot(p.x - s.x, p.y - s.y) <= SUPPLY_RADIUS) return true;
  // Evac Run: the zone's supply drop is a shop too.
  const z = (game.zone && game.zone.supply) || (game.campaign && game.campaign.supply);
  return !!z && Math.hypot(p.x - z.x, p.y - z.y) <= SUPPLY_RADIUS;
}

/** Wave whose shop stock is on sale: the current wave, or the next one between waves. */
export function shopWave(game) {
  return game.phase === 'wave' ? Math.max(1, game.wave) : game.wave + 1;
}

/** Price the player would pay for `item` right now (guns: refill price when owned). */
export function priceFor(game, p, item) {
  if (isWeaponId(item)) {
    return p.slots.includes(item) ? ammoPrice(item) : WEAPONS[item].price;
  }
  if (item === 'turret') return Math.round(ITEMS.turret.price * (1 - (p.perks.turretDiscount || 0)));
  return isItemId(item) ? ITEMS[item].price : 0;
}

/** Validate and apply command(id, { type: 'buy', item }). */
export function applyBuy(game, p, item) {
  const reason = buyCheck(game, p, item);
  if (reason) {
    game.emit({ type: 'buyfail', pid: p.id, item, reason });
    return false;
  }
  const price = priceFor(game, p, item);
  p.cash -= price;
  if (isWeaponId(item)) {
    giveWeapon(game, p, item);
  } else {
    switch (item) {
      case 'ammo':
        for (let i = 0; i < WEAPON_SLOTS; i++) {
          const id = p.slots[i];
          if (id && weaponOf(p, id).reserve >= 0) p.res[i] = weaponOf(p, id).reserve;
        }
        for (const t of game.turrets) if (t.owner === p.id && !t.dead) t.ammo = t.maxAmmo;
        break;
      case 'armor': p.armor = Math.min(ARMOR_MAX, p.armor + 50); break;
      case 'medkit': p.hp = p.maxHp; break;
      case 'frag': p.frags++; break;
      case 'molotov': p.molotovs++; break;
      case 'barricade': p.barricades++; break;
      case 'turret': p.turrets++; break;
      case 'selfrevive': p.selfRevive = true; break;
      case 'repair':
        game.objective.hp = Math.min(game.objective.maxHp, game.objective.hp + game.objective.maxHp * 0.2);
        break;
      default: break;
    }
  }
  game.emit({ type: 'buy', pid: p.id, item });
  return true;
}

function buyCheck(game, p, item) {
  if (game.phase === 'gameover' || game.phase === 'victory') return 'closed';
  if (!isBuyable(item)) return 'invalid';
  if (p.state !== 'alive' || !shopOpen(game, p)) return 'closed';
  if (isWeaponId(item)) {
    const w = WEAPONS[item];
    if (w.unlockWave > shopWave(game)) return 'invalid';
    const s = p.slots.indexOf(item);
    const mine = weaponOf(p, item);
    if (s >= 0 && p.mag[s] >= mine.mag && (mine.reserve < 0 || p.res[s] >= mine.reserve)) return 'owned';
  } else {
    switch (item) {
      case 'ammo': {
        let need = false;
        for (let i = 0; i < WEAPON_SLOTS; i++) {
          const id = p.slots[i];
          if (id && weaponOf(p, id).reserve >= 0 && p.res[i] < weaponOf(p, id).reserve) need = true;
        }
        for (const t of game.turrets) if (t.owner === p.id && !t.dead && t.ammo < t.maxAmmo) need = true;
        if (!need) return 'max';
        break;
      }
      case 'armor': if (p.armor >= ARMOR_MAX) return 'max'; break;
      case 'medkit': if (p.hp >= p.maxHp) return 'max'; break;
      case 'frag': if (p.frags >= fragMax(p)) return 'max'; break;
      case 'molotov': if (p.molotovs >= MOLOTOV_MAX) return 'max'; break;
      case 'barricade': {
        let placed = 0;
        for (const b of game.barricades) if (b.owner === p.id && !b.dead) placed++;
        if (placed + p.barricades >= BARRICADE.maxPerPlayer) return 'max';
        break;
      }
      case 'turret': {
        let placed = 0;
        for (const t of game.turrets) if (t.owner === p.id && !t.dead) placed++;
        if (placed + p.turrets >= TURRET.maxPerPlayer) return 'max';
        break;
      }
      case 'selfrevive': if (p.selfRevive) return 'owned'; break;
      case 'repair':
        if (!game.objective) return 'invalid';
        if (game.objective.hp >= game.objective.maxHp) return 'max';
        break;
      default: return 'invalid';
    }
  }
  const price = priceFor(game, p, item);
  if (!Number.isFinite(price)) return 'invalid';
  if (p.cash < price) return 'cash';
  return null;
}

// -------------------------------------------------------------------------------------
// Leaving and rejoining

/** Wave clears so far (each paid WAVE_CLEAR_BONUS to everyone connected). */
export function waveClears(game) {
  return game.phase === 'intermission' || game.phase === 'victory' ? game.wave : Math.max(0, game.wave - 1);
}

/**
 * What a leaving player keeps for a rejoin under the same name: cash, stats and kit.
 * `placedTurrets` / `placedBarricades` (taken off the map) come back as owned units.
 */
export function departRecord(game, p, placedTurrets, placedBarricades) {
  return {
    cash: p.cash, earned: p.earned, kills: p.kills, damage: p.damage, revives: p.revives, downs: p.downs,
    slots: p.slots.slice(), mag: p.mag.slice(), res: p.res.slice(), slot: p.slot,
    frags: p.frags, molotovs: p.molotovs, selfRevive: p.selfRevive, armor: p.armor,
    turrets: p.turrets + placedTurrets, barricades: p.barricades + placedBarricades,
    hp: p.state === 'alive' ? p.hp : 0,
    clears: waveClears(game),
  };
}

/**
 * Give a rejoining player (fresh from createPlayer, state already set) what they left
 * with, plus the clear bonuses paid while they were away.
 */
export function restoreDeparted(game, p, rec) {
  p.cash = rec.cash + Math.max(0, waveClears(game) - rec.clears) * WAVE_CLEAR_BONUS;
  p.earned = rec.earned;
  p.kills = rec.kills;
  p.damage = rec.damage;
  p.revives = rec.revives;
  p.downs = rec.downs;
  for (let i = 0; i < WEAPON_SLOTS; i++) {
    p.slots[i] = rec.slots[i];
    p.mag[i] = rec.mag[i];
    p.res[i] = rec.res[i];
  }
  // Left dead (loadout lost): back with the starter guns, like a respawn.
  if (!p.slots.some(Boolean)) giveStarterKit(p);
  else {
    p.slot = p.slots[rec.slot] ? rec.slot : p.slots.findIndex(Boolean);
    p.lastSlot = p.slot;
  }
  p.frags = rec.frags;
  p.molotovs = rec.molotovs;
  p.turrets = rec.turrets;
  p.barricades = rec.barricades;
  p.selfRevive = rec.selfRevive;
  p.armor = rec.armor;
  if (p.state === 'alive') p.hp = Math.min(p.maxHp, rec.hp > 0 ? rec.hp : RESPAWN_HP);
}

// -------------------------------------------------------------------------------------
// Snapshot

/** The Snapshot.players entry for p (SPEC §4, plus `earned`: total cash earned). */
export function playerSnapshot(game, p) {
  const ammo = [];
  for (let i = 0; i < WEAPON_SLOTS; i++) ammo.push(p.slots[i] ? [p.mag[i], p.res[i]] : [0, 0]);
  return {
    id: p.id, x: p.x, y: p.y, angle: p.angle,
    state: p.state,
    hp: p.state === 'alive' ? Math.max(1, Math.ceil(p.hp)) : 0,
    maxHp: p.maxHp,
    armor: Math.round(p.armor),
    stamina: p.stamina,
    sprinting: p.sprinting,
    slot: p.slot,
    slots: p.slots.slice(),
    ammo,
    reloading: p.reloadT > 0 && p.reloadTotal > 0 ? Math.min(1, Math.max(0.01, 1 - p.reloadT / p.reloadTotal)) : 0,
    spin: p.spin,
    firing: game.tick - p.lastFireTick <= 6,
    meleeing: p.meleeT > 0 ? Math.max(0.01, 1 - p.meleeT / MELEE_ANIM) : 0,
    cash: Math.floor(p.cash),
    kills: p.kills,
    damage: Math.round(p.damage),
    revives: p.revives,
    downs: p.downs,
    earned: Math.floor(p.earned),
    frags: p.frags,
    molotovs: p.molotovs,
    turrets: p.turrets,
    barricades: p.barricades,
    selfRevive: p.selfRevive,
    bleedout: p.state === 'downed' ? Math.max(0, p.bleedout) : 0,
    revive: p.state === 'downed' ? Math.min(1, p.revive) : 0,
    reviver: p.state === 'downed' ? p.reviver : 0,
    respawn: p.state === 'dead' && p.respawn,
    ready: p.ready,
    lastSeq: p.lastSeq,
    sprintLock: p.sprintLock,
    freeMag: p.freeMag,     // the downed player's free pistol (so clients predict it exactly)
    z: p.z,                 // feet height (0 on the ground; jumping, climbing, on top of things)
    // vertical state (shared/jump.js), exact — for prediction
    zq: p.zq,
    vzq: p.vzq,
    jumpCd: p.jumpCd,
    climbT: p.climbT,
    climbTo: p.climbTo,
    // campaign: how far along its zip-line ride (0 = not riding, else 0..1) and escaped down the line
    ride: p.riding > 0 ? Math.max(1 / 255, 1 - p.riding / RIDE_TICKS) : 0,
    esc: !!p.escaped,
  };
}
