// Developer tooling (not a spec): prints a round as ASCII frames so a bot's decisions can be read, not guessed.
//
//   node scripts/dev/bots/replay.mjs --seed 123456 --levels hard,hard,hard,hard --from 900 --to 960 --every 3
//   node scripts/dev/bots/replay.mjs --seed 123456 --levels hard,hard,hard,hard --die self --before 90 --every 6 [--who 2] [--nth 1]
//
// `--seed` is the exact round seed that arena.mjs prints with `--list self`; the other options must match the arena run that found it
// (--mode --layout --blocks --items --roundTime --no-sd). Frames show the world right after the bots' cmds of that tick were applied.
//
// Cells are two characters: `##` wall, `++` soft block, `XX` sudden-death wall, `@n` fighter n, `**` flame, `Bn` bomb of owner n
// (`Fn` flying), `i?` item (b bomb, f flame, s speed, k kick, g glove, h shield, u skull), `!!` free tile that a flame or a landing
// reaches within the next 60 ticks. A fighter shown as `@n` may stand on a bomb; the bomb list below says.

import { pathToFileURL } from 'node:url';
import { playRound } from './arena.mjs';
import { DangerMap } from '../../../shared/bots.js';

const W = 15;
const H = 13;
const ITEM_CHAR = { bomb: 'b', flame: 'f', speed: 's', kick: 'k', glove: 'g', shield: 'h', skull: 'u' };

export function renderFrame(world, brains = [], { danger = true } = {}) {
  const dm = danger ? new DangerMap().build(world) : null;
  const cells = [];
  for (let ty = 0; ty < H; ty++) {
    const row = [];
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      const g = world.grid[i];
      let c = g === '#' ? '##' : g === '+' ? '++' : g === 'X' ? 'XX' : ' .';
      if (g === '.' && dm && dm.hits(i, world.tickNo + 1, world.tickNo + 60)) c = '!!';
      const it = world.items.find((o) => o.tx === tx && o.ty === ty);
      if (it) c = `i${ITEM_CHAR[it.kind]}`;
      const b = world.bombs.find((o) => o.tx === tx && o.ty === ty);
      if (b) c = `${b.fly ? 'F' : 'B'}${b.owner < 0 ? '?' : b.owner}`;
      if (world.flames.some((f) => f.tx === tx && f.ty === ty)) c = '**';
      const p = world.players.find((o) => o.alive && Math.floor(o.x) === tx && Math.floor(o.y) === ty);
      if (p) c = `@${p.id}`;
      row.push(c);
    }
    cells.push(row.join(''));
  }
  const lines = [`tick ${world.tickNo}  state ${world.state}  timeLeft ${world.timeLeft}${world.suddenDeath ? '  SUDDEN DEATH' : ''}`];
  cells.forEach((r, ty) => lines.push(`${String(ty).padStart(2)} ${r}`));
  for (const p of world.players) {
    const br = brains[p.id];
    const tag = p.alive ? '' : ` DEAD@${p.deathTick}`;
    lines.push(`  bot ${p.id} ${br?.level ?? ''} at (${p.x.toFixed(2)},${p.y.toFixed(2)}) tile ${Math.floor(p.x)},${Math.floor(p.y)} bombs ${p.bombsMax} range ${p.range} spd ${p.speedLv}${p.kick ? ' kick' : ''}${p.glove ? ' glove' : ''}${p.curse ? ` curse=${p.curse}` : ''}`
      + `${p.shield || p.spawnShield ? ` shield=${Math.max(p.shield, p.spawnShield)}` : ''}${tag}${br ? ` | ${br.status} goal=${br.goal.kind}@${br.goal.tile >= 0 ? `${br.goal.tile % W},${Math.floor(br.goal.tile / W)}` : '-'} path=${Array.from(br.path.slice(0, Math.min(br.pathLen, 8))).map((t) => `${t % W},${Math.floor(t / W)}`).join('>')}` : ''}`);
  }
  for (const b of world.bombs) {
    lines.push(`  bomb#${b.id} owner ${b.owner} at ${b.tx},${b.ty} fuse ${b.fuse} (boom tick ${world.tickNo + b.fuse}) range ${b.range}${b.dir ? ` sliding ${b.dir}` : ''}${b.fly ? ` flying ${b.fly.left}` : ''} pass [${b.pass}]`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    opts[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = parseArgs(process.argv.slice(2));
  const levels = (o.levels ?? 'hard,hard,hard,hard').split(',');
  const every = Number(o.every ?? 3);
  const cfg = {
    seed: Number(o.seed), levels, mode: o.mode ?? 'ffa', layout: o.layout ?? 'classic', blocks: o.blocks ?? 'normal', items: o.items ?? 'normal',
    roundTime: Number(o.roundTime ?? 120), suddenDeath: !o['no-sd'],
  };
  if (o.die) {
    const before = Number(o.before ?? 90);
    const ring = [];
    let shown = 0;
    const nth = Number(o.nth ?? 1);
    let seen = 0;
    playRound({
      ...cfg,
      onTick: ({ world, brains }) => {
        ring.push({ tick: world.tickNo, text: renderFrame(world, brains) });
        if (ring.length > before + 1) ring.shift();
      },
      onEvents: (events, { world, brains }) => {
        for (const ev of events) {
          if (ev[0] !== 'death') continue;
          const [, victim, killer] = ev;
          const cause = killer === victim ? 'self' : killer < 0 ? 'sd' : 'enemy';
          if (cause !== o.die || (o.who !== undefined && Number(o.who) !== victim)) continue;
          if (++seen !== nth || shown) continue;
          shown++;
          console.log(`=== bot ${victim} (${levels[victim]}) died (${cause}) at tick ${world.tickNo}, showing the ${before} ticks before ===`);
          ring.forEach((f, k) => { if ((ring.length - 1 - k) % every === 0) console.log(`${f.text}\n`); });
          console.log(renderFrame(world, brains));
        }
      },
    });
    if (!shown) console.log(`no ${o.die} death #${nth} in this round`);
  } else {
    const from = Number(o.from ?? 0);
    const to = Number(o.to ?? from + 60);
    playRound({
      ...cfg,
      onTick: ({ world, brains }) => {
        if (world.tickNo >= from && world.tickNo <= to && (world.tickNo - from) % every === 0) console.log(`${renderFrame(world, brains)}\n`);
      },
    });
  }
}
