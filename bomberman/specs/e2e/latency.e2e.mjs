// Play over a slow, jittery network (docs/SPEC.md 5.2, 5.3): a relay adds ~120 ms of round trip (+-40 ms of jitter) between the browser and
// the real server. The local blastie must still answer a key press at once (client-side prediction), the prediction must stay
// honest against the server's copy (small corrections, no teleports), and the other fighters must move smoothly.
import * as H from '../helpers/e2e-harness.js';

export const name = 'latency: ~120 ms round trip with jitter, prediction and interpolation in a real browser';

export default async function latency({ base, browser, playwright, server, ok }) {
  const problems = [];
  const relay = await H.startLatencyRelay({ target: server.port, delayMs: 60, jitterMs: 20 });
  const p = await H.openPlayer({ browser, playwright, base, label: 'slow', problems });
  await p.page.evaluate((port) => { window.__ws.port = port; }, relay.port);
  await H.createRoom(p, 'Slowpoke');
  for (const level of ['normal', 'hard', 'normal']) await H.addBot(p, level);
  await H.pick(p, 'Round time', '4:00');
  await H.startMatch(p);
  await p.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'the round live over the slow link', timeout: 20000 });
  await H.sleep(2500);                          // let the pings settle the RTT estimate
  const rtt = (await p.probe()).rtt;
  ok('the relay gives a round trip of roughly 100-200 ms', rtt > 90 && rtt < 220, `${rtt.toFixed(0)} ms`);

  // Responsiveness: a key press moves the blastie on screen long before the server could have answered.
  let quick = null;
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    const a = (await p.probe()).view.me;
    if (!a.alive) break;
    await p.page.keyboard.down(key);
    await H.sleep(90);
    const b = (await p.probe()).view.me;
    await p.page.keyboard.up(key);
    await H.sleep(500);
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.15) { quick = { key, d: Math.hypot(b.x - a.x, b.y - a.y) }; break; }
  }
  ok('a key press moves the blastie within 90 ms although the server is ~120 ms away', !!quick, quick ? `${quick.key}: ${quick.d.toFixed(2)} tiles in 90 ms` : 'no arrow moved it');

  // A bomb appears instantly (ghost bomb) and is confirmed by the server a moment later without a flicker in the count.
  const before = await p.probe();
  await p.page.keyboard.press('Space');
  await H.sleep(60);
  const ghosted = await p.probe();
  ok('a bomb shows at once as a ghost, before the server has confirmed it', ghosted.view.ghosts + ghosted.view.bombs > before.view.bombs + before.view.ghosts && ghosted.view.ghosts >= 1 || !ghosted.view.me.alive);
  await H.sleep(600);
  const confirmed = await p.probe();
  ok('and the ghost gives way to the server\'s bomb', confirmed.view.ghosts === 0 || !confirmed.view.me.alive, `${confirmed.view.ghosts} ghosts left`);

  // Random play for 25 s: prediction against the server's copy, and smooth movement of the others.
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  let held = null;
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const next = keys[Math.floor(Math.random() * 4)];
    if (held) await p.page.keyboard.up(held);
    held = next;
    await p.page.keyboard.down(held);
    if (Math.random() < 0.3) await p.page.keyboard.press('Space');
    await H.sleep(120 + Math.random() * 280);
    const pr = await p.probe();
    if (pr.view && pr.view.state === 1) samples.push(pr.view.players.map((q) => [q.id, q.x, q.y, q.alive]));
  }
  if (held) await p.page.keyboard.up(held);
  const end = await p.probe();
  console.log(`  prediction: ${end.stats.corrections} corrections, worst ${end.stats.maxError.toFixed(3)} tiles, syncs ${end.stats.syncs}, rtt ${end.rtt.toFixed(0)} ms`);
  ok('the prediction never missed the server by a whole tile over 25 s of random play', end.stats.maxError < 1, `worst ${end.stats.maxError.toFixed(3)} tiles`);
  // Interpolation: consecutive samples of a live bot never jump more than a couple of tiles (a teleport would show as a jump).
  let jumps = 0;
  for (let i = 1; i < samples.length; i++) {
    for (const [id, x, y, alive] of samples[i]) {
      const prev = samples[i - 1].find((q) => q[0] === id);
      if (prev && prev[3] && alive && Math.hypot(x - prev[1], y - prev[2]) > 3.5) jumps++;
    }
  }
  ok('nobody teleports on screen (interpolation is smooth)', jumps === 0, `${jumps} jumps of more than 3.5 tiles between samples`);
  ok('the renderer recorded no errors', end.render.errors.length === 0, end.render.errors.join(' | '));
  ok('no console errors, warnings or uncaught exceptions', problems.length === 0, problems.slice(0, 3).join(' | '));
  await p.close();
  await relay.close();
}
