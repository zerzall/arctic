// Autopilot for the renderer harness (developer tooling, not part of the game).
//
// The real bot brain belongs to another engineer, so the harness carries a tiny stand-in that is just clever enough to make
// a World produce what the renderer must draw: fighters that wander, bomb crates and each other, run from blasts, and now and
// then blunder into one. It only uses the public World state and the shared pure helpers, like a client or a bot would.

import { makeEnv, computeBlast } from '../../../shared/world.js';
import { makeRng } from '../../../shared/rng.js';
import { GRID_W, GRID_H, DIR_DX, DIR_DY } from '../../../shared/constants.js';

const DIRS = [1, 2, 3, 4];

export class AutoPilot {
  /**
   * @param {import('../../../shared/world.js').World} world
   * @param {{ seed?: number, reckless?: number, bombRate?: number }} [opts]
   *   reckless = chance per decision to ignore danger; bombRate = chance per eligible tick to drop a bomb.
   */
  constructor(world, { seed = 1, reckless = 0.01, bombRate = 0.07 } = {}) {
    this.world = world;
    this.rng = makeRng(seed);
    this.reckless = reckless;
    this.bombRate = bombRate;
    this.seq = new Map();
    this.plan = new Map();     // id -> { d, until }
    this.danger = new Set();
    this.dangerTick = -1;
  }

  /** Tiles that a bomb on the board will burn (chains included, one bomb at a time) or that already burn. */
  refreshDanger() {
    const w = this.world;
    if (this.dangerTick === w.tickNo) return;
    this.dangerTick = w.tickNo;
    const set = this.danger;
    set.clear();
    for (const f of w.flames) set.add(f.ty * GRID_W + f.tx);
    for (const b of w.bombs) {
      if (b.fly) continue;
      for (const [tx, ty] of computeBlast(w.grid, w.bombs, b).tiles) set.add(ty * GRID_W + tx);
    }
    for (const f of w.falling) if (f.ticksLeft < 60) set.add(f.ty * GRID_W + f.tx);
  }

  /** The cmd for fighter `id` this tick. */
  think(id) {
    const w = this.world, p = w.player(id);
    const s = (this.seq.get(id) ?? 0) + 1;
    this.seq.set(id, s);
    const idle = { s, d: 0, b: 0, x: 0 };
    if (!p || !p.alive) return idle;
    this.refreshDanger();
    const env = makeEnv(w.grid, w.bombs);
    const tx = Math.floor(p.x), ty = Math.floor(p.y), here = ty * GRID_W + tx;
    const free = (x, y) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && !env.isSolid(x, y, p);
    let d, bomb = 0;

    if (this.danger.has(here) && this.rng.next() > this.reckless) {
      d = this.flee(p, tx, ty, free);
    } else {
      const plan = this.plan.get(id);
      if (plan && plan.until > w.tickNo && free(tx + DIR_DX[plan.d], ty + DIR_DY[plan.d]) && !this.danger.has((ty + DIR_DY[plan.d]) * GRID_W + tx + DIR_DX[plan.d])) d = plan.d;
      else {
        const options = DIRS.filter((c) => free(tx + DIR_DX[c], ty + DIR_DY[c]) && !this.danger.has((ty + DIR_DY[c]) * GRID_W + tx + DIR_DX[c]));
        d = options.length ? options[this.rng.int(options.length)] : 0;
        this.plan.set(id, { d, until: w.tickNo + 6 + this.rng.int(30) });
      }
      const nearCrate = DIRS.some((c) => w.grid[(ty + DIR_DY[c]) * GRID_W + tx + DIR_DX[c]] === '+');
      const nearFoe = w.players.some((o) => o.alive && o.id !== id && Math.abs(o.x - p.x) + Math.abs(o.y - p.y) < 3.2);
      if ((nearCrate || nearFoe) && this.rng.next() < this.bombRate && this.hasExit(p, tx, ty, free)) bomb = 1;
    }
    return { s, d, b: bomb, x: p.glove && this.rng.next() < 0.02 ? 1 : 0 };
  }

  /** Would fleeing be possible after a bomb here? A crude check: some free neighbour beyond the blast line exists within 3 steps. */
  hasExit(p, tx, ty, free) {
    const reach = new Set([ty * GRID_W + tx]);
    let frontier = [[tx, ty]];
    for (let step = 0; step < 3; step++) {
      const next = [];
      for (const [x, y] of frontier) {
        for (const c of DIRS) {
          const nx = x + DIR_DX[c], ny = y + DIR_DY[c];
          if (!reach.has(ny * GRID_W + nx) && free(nx, ny)) { reach.add(ny * GRID_W + nx); next.push([nx, ny]); }
        }
      }
      frontier = next;
    }
    for (const k of reach) {
      const x = k % GRID_W, y = Math.floor(k / GRID_W);
      if (x !== tx && y !== ty && !this.danger.has(k)) return true;
    }
    return false;
  }

  /** BFS to the nearest tile that is not in danger; returns the first step's direction. */
  flee(p, tx, ty, free) {
    const start = ty * GRID_W + tx, prev = new Map([[start, -1]]);
    let frontier = [start];
    while (frontier.length) {
      const next = [];
      for (const k of frontier) {
        const x = k % GRID_W, y = Math.floor(k / GRID_W);
        if (k !== start && !this.danger.has(k)) {
          let at = k;
          while (prev.get(at) !== start) at = prev.get(at);
          const ax = at % GRID_W, ay = Math.floor(at / GRID_W);
          return ax > tx ? 2 : ax < tx ? 4 : ay > ty ? 3 : 1;
        }
        for (const c of DIRS) {
          const nx = x + DIR_DX[c], ny = y + DIR_DY[c], nk = ny * GRID_W + nx;
          if (!prev.has(nk) && free(nx, ny)) { prev.set(nk, k); next.push(nk); }
        }
      }
      frontier = next;
    }
    return 0;
  }
}
