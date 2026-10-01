// Headless bots for simulation tests: they read the Game's internal state directly and
// produce InputCmds like a reasonable human would: keep distance from the nearest
// zombie while staying near the objective, shoot what they can see, reload, revive
// teammates, and gear up in the shop between waves.

import { WEAPONS } from '../../public/js/shared/weapons.js';
import { PLAYER_RADIUS, REVIVE_RADIUS } from '../../public/js/shared/constants.js';
import { FlowField } from '../../public/js/shared/flowfield.js';

// Navigation fields shared by every bot of one game: toward the objective ring, and
// toward the zombies near it (refreshed a few times per second).
const navCache = new WeakMap();
function navFor(game, anchor) {
  let nav = navCache.get(game);
  if (!nav) {
    const toAnchor = new FlowField(game.map, { pad: 12 });
    const toZombies = new FlowField(game.map, { pad: 12 });
    const target = game.map.objective && anchor.x === game.map.objective.x && anchor.y === game.map.objective.y
      ? game.map.objective : anchor;
    toAnchor.update([target]);
    nav = { toAnchor, toZombies, zTick: -1000, zCount: 0 };
    navCache.set(game, nav);
  }
  if (game.tick - nav.zTick >= 20) {
    nav.zTick = game.tick;
    const zs = [];
    for (const z of game.zombies) if (!z.dead && Math.hypot(z.x - anchor.x, z.y - anchor.y) < 1100) zs.push(z);
    nav.zCount = zs.length;
    if (zs.length) nav.toZombies.update(zs);
  }
  return nav;
}

const SHOP_GUNS = ['rifle', 'dmr', 'auto_shotgun', 'lmg', 'minigun'];

/**
 * @param {object} game Game/GameCore
 * @param {number} pid player id to drive
 * @param {object} [opts] { anchor: {x, y}, keepAway, shop: bool, frags: bool }
 */
export function createBot(game, pid, opts = {}) {
  const anchor = opts.anchor || (game.map.objective ? { x: game.map.objective.x, y: game.map.objective.y } : { x: game.map.width / 2, y: game.map.height / 2 });
  const keepAway = opts.keepAway ?? 170;
  const guardRadius = opts.guardRadius ?? 150;
  // Each bot guards its own side of the objective.
  const postA = (pid * 2.39996) % (Math.PI * 2);
  const post = { x: anchor.x + Math.cos(postA) * 190, y: anchor.y + Math.sin(postA) * 170 };
  if (!game.world.isCircleFree(post.x, post.y, PLAYER_RADIUS + 4)) game.world.resolveCircle(post, PLAYER_RADIUS + 4);
  let seq = 0;
  let turn = 1;
  let lastPos = null;
  let blockedT = 0;
  const bot = {
    pid,
    /** Next InputCmd for this tick. */
    think() {
      const p = game.getPlayer(pid);
      const cmd = {
        seq: ++seq, moveX: 0, moveY: 0, angle: p ? p.angle : 0, fire: false, melee: false, sprint: false,
        interact: false, reload: false, frag: false, molotov: false, turret: false, barricade: false,
        lastWeapon: false, slot: -1, cycle: 0,
      };
      if (!p || p.state === 'dead') return cmd;
      const world = game.world;
      // Nearest visible zombie and local threat vector.
      let near = null, nd = Infinity, vis = null, vd = Infinity;
      let fx = 0, fy = 0, crowd = 0;
      for (const z of game.zombies) {
        if (z.dead) continue;
        const dx = p.x - z.x, dy = p.y - z.y;
        // Heavies are judged by their reach: keep well clear of slams and charges.
        const d = Math.hypot(dx, dy) - (z.boss ? 150 : z.type === 'brute' ? 60 : 0);
        if (d < nd) { nd = d; near = z; }
        if (d < 320) {
          const w = (z.boss ? 3 : 1) / Math.max(30, d);
          fx += (dx / (d || 1)) * w;
          fy += (dy / (d || 1)) * w;
          if (d < 220) crowd++;
        }
        const dv = Math.hypot(dx, dy);
        if (dv < vd && dv < 1000 && world.lineOfSight(p.x, p.y, z.x, z.y)) { vd = dv; vis = z; }
      }
      // Downed teammate needing help.
      let downed = null, dd = Infinity;
      for (const q of game.players) {
        if (q === p || q.state !== 'downed') continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < dd) { dd = d; downed = q; }
      }
      let mx = 0, my = 0;
      const toA = Math.hypot(post.x - p.x, post.y - p.y);
      const nav = navFor(game, anchor);
      const dir = { x: 0, y: 0 };
      if (downed && (!near || nd > 90 || dd < REVIVE_RADIUS * 0.7)) {
        if (dd > REVIVE_RADIUS * 0.6) {
          mx = downed.x - p.x;
          my = downed.y - p.y;
        }
        cmd.interact = dd <= REVIVE_RADIUS * 0.9;
      } else if (near && nd < keepAway) {
        const fl = Math.hypot(fx, fy) || 1;
        mx = fx / fl;
        my = fy / fl;
        // Don't run far from the anchor: slide around it instead.
        if (toA > guardRadius * 2.5) {
          mx += (post.x - p.x) / toA * 0.8;
          my += (post.y - p.y) / toA * 0.8;
        }
        cmd.sprint = nd < keepAway * 0.6 && p.stamina > 30;
      } else if (!vis && nav.zCount > 0 && nav.toZombies.sample(p.x, p.y, dir)) {
        // Something is out of sight near the objective: go around and engage.
        mx = dir.x;
        my = dir.y;
      } else if (toA > guardRadius) {
        if (world.lineOfMovement(p.x, p.y, post.x, post.y, PLAYER_RADIUS) || !nav.toAnchor.sample(p.x, p.y, dir)) {
          mx = post.x - p.x;
          my = post.y - p.y;
        } else {
          mx = dir.x;
          my = dir.y;
        }
      }
      const ml = Math.hypot(mx, my);
      if (ml > 1e-6) {
        mx /= ml;
        my /= ml;
        // Wall avoidance: if the way ahead is blocked, turn until it's clear.
        for (let k = 0; k < 8; k++) {
          if (world.isCircleFree(p.x + mx * 26, p.y + my * 26, PLAYER_RADIUS)) break;
          const a = Math.atan2(my, mx) + turn * (Math.PI / 4);
          mx = Math.cos(a);
          my = Math.sin(a);
        }
        if (lastPos && Math.hypot(p.x - lastPos.x, p.y - lastPos.y) < 0.5) {
          blockedT++;
          if (blockedT > 30) { turn = -turn; blockedT = 0; }
        } else blockedT = 0;
      }
      lastPos = { x: p.x, y: p.y };
      cmd.moveX = mx;
      cmd.moveY = my;
      // Weapon handling.
      const slotId = p.slots[p.slot];
      const w = slotId ? WEAPONS[slotId] : null;
      const mag = p.mag[p.slot], res = p.res[p.slot];
      if (w && mag === 0 && res === 0) {
        const alt = p.slots.findIndex((id, i) => id && i !== p.slot && (p.mag[i] > 0 || p.res[i] !== 0));
        if (alt >= 0) cmd.slot = alt;
      }
      if (vis) {
        cmd.angle = Math.atan2(vis.y - p.y, vis.x - p.x);
        const range = w ? w.range * 0.9 : 800;
        cmd.fire = vd < range;
      } else if (near) {
        cmd.angle = Math.atan2(near.y - p.y, near.x - p.x);
      }
      if (w && p.reloadT <= 0 && mag < w.mag && (mag === 0 || (mag < w.mag * 0.3 && (!near || nd > 350)))) {
        cmd.reload = true;
        cmd.fire = false;
      }
      if (near && !near.boss && nd < near.radius + PLAYER_RADIUS + 20 && p.meleeCd <= 0) cmd.melee = true;
      if (opts.frags !== false && crowd >= 7 && p.frags > 0 && p.throwCd <= 0 && vis && vd > 120) cmd.frag = true;
      return cmd;
    },
    /** Spend cash between waves (call during prep/intermission). */
    shop() {
      const p = game.getPlayer(pid);
      if (!p || p.state !== 'alive' || opts.shop === false) return;
      const nextWave = game.phase === 'wave' ? game.wave : game.wave + 1;
      // Best gun we can afford that beats what we carry.
      for (let i = SHOP_GUNS.length - 1; i >= 0; i--) {
        const id = SHOP_GUNS[i];
        const w = WEAPONS[id];
        if (w.unlockWave > nextWave || p.slots.includes(id)) continue;
        if (p.cash >= w.price + 300) {
          if (p.slots[2] === null) {
            game.command(pid, { type: 'buy', item: id });
          } else {
            // Replace the weakest non-pistol gun: switch to it first.
            const worst = p.slots.findIndex((sid, k) => k > 0 && sid && WEAPONS[sid].price < w.price);
            if (worst >= 0) {
              p.slot = worst;
              game.command(pid, { type: 'buy', item: id });
            }
          }
          break;
        }
      }
      const lowAmmo = p.slots.some((id, i) => id && WEAPONS[id].reserve > 0 && p.res[i] < WEAPONS[id].reserve * 0.5);
      if (lowAmmo && p.cash >= 300) game.command(pid, { type: 'buy', item: 'ammo' });
      if (p.armor < 50 && p.cash >= 900) game.command(pid, { type: 'buy', item: 'armor' });
      if (p.hp < p.maxHp * 0.6 && p.cash >= 600) game.command(pid, { type: 'buy', item: 'medkit' });
      if (p.frags < 2 && p.cash >= 1200) game.command(pid, { type: 'buy', item: 'frag' });
      game.command(pid, { type: 'ready' });
    },
  };
  return bot;
}

/**
 * Drive a whole team for `ticks` ticks (or until `until(game)` is true).
 * @returns {number} ticks simulated
 */
export function runBots(game, bots, ticks, until = null) {
  let t = 0;
  let lastPhase = game.phase;
  for (; t < ticks; t++) {
    if (game.phase === 'prep' || game.phase === 'intermission') {
      if (lastPhase !== game.phase || t % 60 === 0) for (const b of bots) b.shop();
    }
    lastPhase = game.phase;
    for (const b of bots) game.setInput(b.pid, b.think());
    game.step();
    if (t % 3 === 0) game.snapshot();
    if (until && until(game)) return t + 1;
  }
  return t;
}
