// A short soak with 8 participants (docs/SPEC.md section 10, E2E), in two parts. Both sample the server's own numbers from /api/stats.
//   A. four browsers play with random keys next to four bots for $SOAK_S seconds (default 60) in rounds that restart by themselves.
//      The browsers render on the same few CPU cores as the server, so the server's tick times here include that contention: the
//      criterion is a typical sample (median p99) under 4 ms and no sample over 10 ms, plus nothing dropped and no page errors.
//   B. the same 8 participants on a second server with four raw WebSocket players (no rendering): the SPEC's criterion, worst p99 < 4 ms.
import * as H from '../helpers/e2e-harness.js';
import { WsClient } from '../helpers/ws-client.js';

export const name = 'soak: 4 browsers + 4 bots, random play, server tick time';

const SOAK_S = Number(process.env.SOAK_S ?? 60);
const TICK_P99_LIMIT_MS = 4;
const CONTENDED_MAX_MS = 10;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Random arrows and bomb taps, like eight thumbs mashing buttons, until `stop.now` is set. */
async function mash(p, stop) {
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  let held = null;
  while (!stop.now) {
    try {
      const next = keys[Math.floor(Math.random() * keys.length)];
      if (held) await p.page.keyboard.up(held);
      held = next;
      await p.page.keyboard.down(held);
      if (Math.random() < 0.4) await p.page.keyboard.press('Space');
      if (Math.random() < 0.05) await p.page.keyboard.press(String(1 + Math.floor(Math.random() * 6)));
    } catch { /* the page may be closing */ }
    await H.sleep(150 + Math.random() * 350);
  }
  try { if (held) await p.page.keyboard.up(held); } catch { /* closing */ }
}

export default async function soak({ base, browser, playwright, server, ok }) {
  const problems = [];
  const view = { width: 640, height: 480 };
  const players = [];
  for (const label of ['s1', 's2', 's3', 's4']) players.push(await H.openPlayer({ browser, playwright, base, label, problems, viewport: view }));
  const [host, ...guests] = players;
  const code = await H.createRoom(host, 'Soak 1');
  for (let i = 0; i < guests.length; i++) await H.joinByLink(guests[i], code, `Soak ${i + 2}`);
  for (const level of ['easy', 'normal', 'normal', 'hard']) await H.addBot(host, level);
  await H.pick(host, 'Wins needed to take the match', '7');
  await H.pick(host, 'Round time', '1:00');
  await host.until((x) => x.lobby.players.length === 8, { what: 'eight participants' });
  await H.startMatch(host);
  for (const p of players) await p.until((x) => x.screen === 'game' && x.view && x.view.players.length === 8, { what: `${p.label} in an 8-fighter arena`, timeout: 20000 });

  const stop = { now: false };
  const workers = players.map((p) => mash(p, stop));
  const samples = [];
  const t0 = Date.now();
  let rounds = 1;
  while (Date.now() - t0 < SOAK_S * 1000) {
    await H.sleep(5000);
    const s = await server.stats();
    samples.push({ t: Math.round((Date.now() - t0) / 1000), ...s.tickMs, dropped: s.droppedTicks, lag: s.loopLagMs.p99, rss: s.rssMB });
  }
  // Keep mashing until a second round has started (a round lasts at most a minute plus sudden death), then check it draws.
  const second = await host.until((x) => x.round && x.round.n >= 2 && x.view && x.view.state === 1, { what: 'the second round to be live', timeout: 120000 }).catch(() => null);
  await H.sleep(800);
  const secondCanvas = second ? await H.canvasStats(host) : null;
  stop.now = true;
  await Promise.all(workers);

  const finalStats = await server.stats();
  const probes = await Promise.all(players.map((p) => p.probe()));
  rounds = Math.max(...probes.map((x) => x.round?.n ?? 0));
  const worstP99 = Math.max(...samples.map((s) => s.p99));
  const medianP99 = median(samples.map((s) => s.p99));
  const fps = probes.map((x) => x.render.fps);
  const busy = samples.filter((s) => s.avg > 0);
  console.log(`  A. browsers: ${SOAK_S} s, ${rounds} round(s); server tick ms (rolling 10 s window) per 5 s sample:`);
  for (const s of samples) console.log(`    t=${String(s.t).padStart(3)}s  avg ${s.avg}  p99 ${s.p99}  max ${s.max}  dropped ${s.dropped}  loopLag p99 ${s.lag} ms  rss ${s.rss} MB`);
  console.log(`  final /api/stats tickMs ${JSON.stringify(finalStats.tickMs)}  droppedTicks ${finalStats.droppedTicks}  players ${finalStats.players}  humans ${finalStats.humans}; page fps ${fps.join('/')}`);

  ok(`the server ticked during the soak (${busy.length} busy samples)`, busy.length >= 3);
  ok(`with four rendering browsers on the same cores: median tick p99 under ${TICK_P99_LIMIT_MS} ms, none over ${CONTENDED_MAX_MS} ms`, medianP99 < TICK_P99_LIMIT_MS && worstP99 < CONTENDED_MAX_MS, `median p99 ${medianP99} ms, worst ${worstP99} ms`);
  ok('no ticks were dropped', finalStats.droppedTicks === 0, String(finalStats.droppedTicks));
  ok('event-loop lag stayed small', Math.max(...samples.map((s) => s.lag)) < 50, `${Math.max(...samples.map((s) => s.lag))} ms`);
  ok('all four browsers stayed in the room and kept receiving snapshots', probes.every((x) => x.joined && x.stats.snapshots > SOAK_S * 10), probes.map((x) => x.stats.snapshots).join('/'));
  const worstError = Math.max(...probes.map((x) => x.stats.maxError));
  console.log(`  prediction: worst correction ${worstError.toFixed(3)} tiles, corrections per page ${probes.map((x) => x.stats.corrections).join('/')}, syncs ${probes.map((x) => x.stats.syncs).join('/')}`);
  ok('client prediction never missed by a whole tile (worst correction < 1 tile)', worstError < 1, worstError.toFixed(3));
  ok('the match went on to a second round, and it draws a whole arena again', !!second && secondCanvas.colours > 60 && secondCanvas.lit > 0.35, second ? JSON.stringify(secondCanvas) : `still round ${rounds}`);
  ok('the renderers recorded no errors', probes.every((x) => x.render.errors.length === 0), probes.map((x) => x.render.errors.join(';')).join(' | '));
  ok('no console errors, warnings, uncaught exceptions or failed requests on any page', problems.length === 0, problems.slice(0, 5).join(' | '));
  await Promise.all(players.map((p) => p.close()));

  // ---- B. The same eight participants without browsers: the server on its own
  const quiet = await H.startServer();
  const clients = [await WsClient.create(quiet.port, 'W0')];
  for (let i = 1; i < 4; i++) clients.push(await WsClient.join(quiet.port, clients[0].code, `W${i}`));
  for (const level of ['easy', 'normal', 'normal', 'hard']) clients[0].send({ t: 'addBot', level });
  clients[0].send({ t: 'settings', patch: { rounds: 7, roundTime: 90 } });
  await H.sleep(300);
  clients[0].send({ t: 'start' });
  const drivers = clients.map((c) => {
    let n = 0;
    return setInterval(() => {                 // ~30 frames a second of two cmds each, like a real client
      n++;
      const d = 1 + ((n >> 3) % 4);
      c.send({ t: 'in', c: [[n * 2 - 1, d, n % 20 === 0 ? 1 : 0, 0], [n * 2, d, 0, 0]] });
    }, 33);
  });
  const quietSamples = [];
  const q0 = Date.now();
  while (Date.now() - q0 < Math.max(20, SOAK_S / 2) * 1000) {
    await H.sleep(5000);
    const st = await quiet.stats();
    quietSamples.push({ t: Math.round((Date.now() - q0) / 1000), ...st.tickMs, dropped: st.droppedTicks });
  }
  drivers.forEach(clearInterval);
  const quietFinal = await quiet.stats();
  console.log('  B. server alone, 4 raw WebSocket players + 4 bots:');
  for (const s of quietSamples) console.log(`    t=${String(s.t).padStart(3)}s  avg ${s.avg}  p99 ${s.p99}  max ${s.max}  dropped ${s.dropped}`);
  const settled = quietSamples.slice(2);         // the first window holds the JIT warm-up
  const quietWorst = Math.max(...settled.map((s) => s.p99));
  H.writeReport('soak.json', { soakSeconds: SOAK_S, rounds, samples, quietSamples, finalStats, quietFinal, fps });
  ok(`the server on its own: tick p99 under ${TICK_P99_LIMIT_MS} ms in every settled sample (SPEC 10)`, quietWorst < TICK_P99_LIMIT_MS, `worst p99 ${quietWorst} ms, avg ${quietFinal.tickMs.avg} ms`);
  ok('the server on its own dropped no ticks', quietFinal.droppedTicks === 0, String(quietFinal.droppedTicks));
  for (const c of clients) c.ws.close();
  await quiet.stop();
}
