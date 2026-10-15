// Developer check: the Room runs unchanged in a real browser (Practice mode) and produces byte-identical frames to Node.
//
//   node scripts/dev/server/browser-room.mjs
//
// Starts the real server (so /shared/*.js is served exactly as in production), opens it in headless Chromium, imports
// /shared/room.js there, drives a scripted 4-fighter match on a virtual clock and compares an FNV-1a hash of every frame
// sent to the human with the same run in Node. The bots are the real BotBrain, so this also proves shared/bots.js decides
// identically in both engines. Prints SKIP when Playwright or Chromium is missing.

import { startServer } from '../../../server/index.js';
import { launchChromium } from '../../../specs/helpers/pw.js';
import { Room } from '../../../shared/room.js';
import { BotBrain } from '../../../shared/bots.js';

const TICKS = 4000;

/** The scenario, written as plain code so the very same source text runs in Node and in the page. */
function scenario(RoomClass, ticks, Brain) {
  const frames = [];
  let virtualMs = 0;
  const room = new RoomClass({
    code: 'LOCAL', local: true, seed: 12345, now: () => virtualMs, botFactory: (o) => new Brain(o), genToken: () => 'f'.repeat(32),
  });
  const conn = { send: (s) => frames.push(s), close: () => {} };
  const { id } = room.join(conn, { name: 'Practice' });
  const say = (msg) => room.receive(id, JSON.stringify(msg), conn);
  say({ t: 'addBot', level: 'easy' });
  say({ t: 'addBot', level: 'normal' });
  say({ t: 'addBot', level: 'hard' });
  say({ t: 'settings', patch: { rounds: 7, roundTime: 60 } });
  say({ t: 'start' });
  let seq = 0;
  for (let i = 0; i < ticks; i++) {
    virtualMs += 1000 / 60;
    say({ t: 'in', c: [[++seq, (i >> 4) % 5, i % 90 === 0 ? 1 : 0, 0]] });
    room.step();
  }
  let hash = 0x811c9dc5;
  for (const f of frames) for (let i = 0; i < f.length; i++) hash = Math.imul(hash ^ f.charCodeAt(i), 0x01000193) >>> 0;
  return { frames: frames.length, hash, phase: room.phase, tick: room.world?.tickNo ?? -1 };
}

const { browser, reason } = await launchChromium();
if (!browser) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}
const app = await startServer({ port: 0, log: () => {} });
try {
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) problems.push(`console: ${m.text()}`); });
  // The page's CSP forbids eval, so the scenario is delivered as a same-origin module instead.
  await page.route('**/dev-scenario.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export ${scenario.toString()}` }));
  await page.goto(`${app.url}/`);
  const inBrowser = await page.evaluate(async (ticks) => {
    const [{ Room: BrowserRoom }, { BotBrain: BrowserBrain }, { scenario: run }] = await Promise.all([
      import('/shared/room.js'), import('/shared/bots.js'), import('/dev-scenario.js'),
    ]);
    return run(BrowserRoom, ticks, BrowserBrain);
  }, TICKS);
  const inNode = scenario(Room, TICKS, BotBrain);
  console.log('browser', inBrowser);
  console.log('node   ', inNode);
  const same = JSON.stringify(inBrowser) === JSON.stringify(inNode);
  if (problems.length) console.log(problems.join('\n'));
  console.log(same && problems.length === 0 ? 'OK: identical frames in Chromium and Node' : 'MISMATCH');
  process.exitCode = same && problems.length === 0 ? 0 : 1;
} finally {
  await browser.close();
  await app.close();
}
