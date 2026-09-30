// Cross-engine determinism (docs/SPEC.md 0.5, 10): the same scripted 5000-tick match (4 scripted players plus 4 bots on the real
// World and BotBrain) runs in Node (V8) and in headless Chromium (V8 in a browser, served by the real server from /shared/) and must
// yield the same SHA-256 over the concatenated JSON snapshots. The script uses integer arithmetic only, so any difference is the sim's.
import { createHash } from 'node:crypto';
import { World } from '../../shared/world.js';
import { BotBrain } from '../../shared/bots.js';

export const name = 'determinism: a 5000-tick scripted match hashes the same in Node and in Chromium';

const TICKS = 5000;

/**
 * Runs the match (rounds follow each other like the Room's) and returns { sha, bytes, ticks, rounds, state, alive, events }. Written to be serialised into the page (it may not close over
 * anything): everything comes in through `env` = { World, BotBrain, sha256(text) -> hex }.
 */
async function playScripted(env, ticks) {
  const { World: W, BotBrain: Brain, sha256 } = env;
  const fighters = Array.from({ length: 8 }, (_, i) => ({ id: i, name: `F${i}`, color: i, team: i % 2, isBot: i >= 4, lastSeq: 0 }));
  const build = (round) => new W({ seed: 424242 + round * 7919, fighters, mode: 'ffa', layout: round % 2 ? 'classic' : 'open', blocks: 'normal', items: 'many', theme: 'meadow', roundTime: 60, suddenDeath: true });
  let round = 1;
  let world = build(round);
  let brains = null;
  const makeBrains = () => new Map(fighters.filter((f) => f.isBot).map((f) => [f.id, new Brain({ level: ['easy', 'normal', 'hard', 'normal'][f.id - 4], seed: 1000 * round + f.id })]));
  brains = makeBrains();
  let lcg = 12345;
  const rand = (n) => { lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0; return (lcg >>> 8) % n; };
  const dirs = new Array(8).fill(0);
  const seqs = new Array(8).fill(0);
  let text = '';
  let cursor = 0;
  let events = 0;
  let overHold = 0;
  for (let t = 1; t <= ticks; t++) {
    if (world.state === 3 && ++overHold >= 120) {          // like the Room: a short hold at OVER, then the next round
      overHold = 0;
      round++;
      world = build(round);
      brains = makeBrains();
      cursor = 0;
    }
    for (const f of fighters) {
      const p = world.player(f.id);
      let cmd;
      if (f.isBot) {
        if (world.state === 1 && p.alive) cmd = brains.get(f.id).think(world, f.id);
        cmd = { s: ++seqs[f.id], d: cmd ? cmd.d : 0, b: cmd ? cmd.b : 0, x: cmd ? cmd.x : 0 };
      } else {
        if (rand(12) === 0) dirs[f.id] = rand(5);
        cmd = { s: ++seqs[f.id], d: dirs[f.id], b: rand(40) === 0 ? 1 : 0, x: rand(60) === 0 ? 1 : 0 };
      }
      world.applyCmd(f.id, cmd);
    }
    world.tick();
    const snap = world.snapshot({ grid: world.gridVer !== 0 && t % 60 === 0, evFrom: cursor });
    events += snap.e.length;
    cursor = world.evCount;
    world.trimEvents(cursor);
    text += JSON.stringify(snap);
  }
  return { sha: await sha256(text), bytes: text.length, ticks, rounds: round, state: world.state, alive: world.players.filter((p) => p.alive).length, events };
}

export default async function determinism({ base, browser, ok }) {
  const nodeRun = await playScripted({ World, BotBrain, sha256: async (s) => createHash('sha256').update(s).digest('hex') }, TICKS);
  console.log(`  node:     ${nodeRun.sha}  (${nodeRun.bytes} bytes, ${nodeRun.ticks} ticks in ${nodeRun.rounds} rounds, ${nodeRun.events} events)`);

  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${base}/`);      // an origin for the module imports (localhost is a secure context, so crypto.subtle exists)
  // (evaluated as an expression through the browser's debugging protocol: the page's CSP forbids eval, but not this)
  const expression = `(async () => {
    const [{ World }, { BotBrain }] = await Promise.all([import('/shared/world.js'), import('/shared/bots.js')]);
    const sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map((b) => b.toString(16).padStart(2, '0')).join('');
    return (${playScripted.toString()})({ World, BotBrain, sha256 }, ${TICKS});
  })()`;
  const browserRun = await page.evaluate(expression);
  console.log(`  chromium: ${browserRun.sha}  (${browserRun.bytes} bytes, ${browserRun.ticks} ticks in ${browserRun.rounds} rounds, ${browserRun.events} events)`);

  ok('the scripted match ran the full 5000 ticks over several rounds with real action', nodeRun.ticks === TICKS && nodeRun.rounds >= 2 && nodeRun.events > 300 && nodeRun.bytes > 1000000, `${nodeRun.ticks} ticks, ${nodeRun.rounds} rounds, ${nodeRun.events} events`);
  ok('Node and Chromium produce the same SHA-256 of the concatenated snapshots', nodeRun.sha === browserRun.sha, `${nodeRun.sha.slice(0, 16)} vs ${browserRun.sha.slice(0, 16)}`);
  ok('no console problems in the page', problems.length === 0, problems.join(' | '));
  await context.close();
}
