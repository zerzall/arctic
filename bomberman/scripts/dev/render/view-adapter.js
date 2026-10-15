// World -> View adapter for the renderer harness (developer tooling, not part of the game).
//
// The real ClientGame turns wire snapshots into a preallocated View (docs/SPEC.md Appendix A.2). The harness has no network,
// so this module does the same mapping straight from World.snapshot(): it decodes the array-encoded rows through the shared
// index maps P / PF / B exactly like ClientGame must, refills ONE View in place (arrays trimmed to their exact length), and
// applies no interpolation, so a frame is the true state of a 60 Hz tick.
//
// Runs in Node and in the browser (relative import of the shared protocol tables).

import { P, PF, B } from '../../../shared/protocol.js';

/** A fresh View with the exact shape of Appendix A.2 (no `mode`: the spec's View has none, the renderer is told through setPlayers()). */
export function createView() {
  return {
    w: 15, h: 13, grid: '', state: 0, countdown: 0, timeLeft: 0, suddenDeath: false, me: -1, theme: 'meadow',
    players: [], bombs: [], flames: [], items: [], falling: [], ghostBombs: [],
  };
}

function trim(arr, n) {
  if (arr.length > n) arr.length = n;
}

/**
 * Refill `view` from a snapshot object.
 * @param {object} view from createView()
 * @param {object} snap world.snapshot({ grid: true })
 * @param {{theme:string, players:{id:number,name:string,color:number,team:number,isBot:boolean}[]}} round the `round` message (players in snapshot order)
 * @param {number} me local fighter id (-1 for a spectator)
 */
export function fillView(view, snap, round, me) {
  view.grid = snap.g ?? view.grid;
  view.state = snap.st; view.countdown = snap.cd; view.timeLeft = snap.r; view.suddenDeath = !!snap.sd;
  view.me = me; view.theme = round.theme;

  const ps = view.players;
  for (let i = 0; i < snap.p.length; i++) {
    const row = snap.p[i], info = round.players[i], fl = row[P.FL];
    const o = ps[i] ?? (ps[i] = {});
    o.id = row[P.ID]; o.x = row[P.X]; o.y = row[P.Y]; o.facing = row[P.F];
    o.moving = !!(fl & PF.MOVING); o.alive = !!(fl & PF.ALIVE); o.kick = !!(fl & PF.KICK); o.glove = !!(fl & PF.GLOVE);
    o.shield = row[P.SH]; o.spawnShield = row[P.SS]; o.curse = row[P.CU] || null; o.curseTicks = row[P.CT];
    o.deadT = row[P.DT]; o.bombsMax = row[P.BM]; o.range = row[P.RG]; o.speedLv = row[P.SP];
    o.isMe = o.id === me;
    o.name = info.name; o.color = info.color; o.team = info.team; o.isBot = info.isBot;
  }
  trim(ps, snap.p.length);

  const bs = view.bombs;
  for (let i = 0; i < snap.b.length; i++) {
    const row = snap.b[i], fly = row[B.FL];
    const o = bs[i] ?? (bs[i] = {});
    o.id = row[B.I]; o.owner = row[B.O]; o.x = row[B.X]; o.y = row[B.Y]; o.tx = row[B.TX]; o.ty = row[B.TY];
    o.fuse = row[B.FU]; o.range = row[B.RG]; o.dir = row[B.D]; o.pass = row[B.PS];
    o.fly = fly ? { fx: fly[0], fy: fly[1], tx: fly[2], ty: fly[3], left: fly[4], total: fly[5] } : null;
  }
  trim(bs, snap.b.length);

  const fs = view.flames;
  for (let i = 0; i < snap.f.length; i++) {
    const row = snap.f[i], o = fs[i] ?? (fs[i] = {});
    o.x = row[0] + 0.5; o.y = row[1] + 0.5; o.mask = row[2]; o.ticksLeft = row[3];
  }
  trim(fs, snap.f.length);

  const its = view.items;
  for (let i = 0; i < snap.i.length; i++) {
    const row = snap.i[i], o = its[i] ?? (its[i] = {});
    o.id = row[0]; o.x = row[1] + 0.5; o.y = row[2] + 0.5; o.kind = row[3]; o.born = snap.k - row[4];
  }
  trim(its, snap.i.length);

  const fl = view.falling;
  for (let i = 0; i < snap.fall.length; i++) {
    const row = snap.fall[i], o = fl[i] ?? (fl[i] = {});
    o.tx = row[0]; o.ty = row[1]; o.ticksLeft = row[2];
  }
  trim(fl, snap.fall.length);
  return view;
}

/** The `round` message the Room would send for this World (only the parts the renderer reads). */
export function roundFor(world, mode = 'ffa') {
  return {
    theme: world.theme, mode, w: world.W, h: world.H,
    players: world.players.map((p) => ({ id: p.id, name: p.name, color: p.color, team: p.team, slot: p.slot, isBot: p.isBot, x: p.x, y: p.y })),
  };
}
