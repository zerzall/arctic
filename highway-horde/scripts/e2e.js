#!/usr/bin/env node
// End-to-end browser tests: `npm run e2e`.
//
// Starts server/relay-server.js (static files + WebSocket relay) and a local PeerJS
// signalling server, then drives headless Chromium through whole games:
//
//   a  solo         title → class → Play Solo → Start → a scripted player fights wave 1
//   b  relay-mp     3 players over the relay: invite link, roster, chat, settings, start,
//                   movement replication + prediction, shots/kills, a player leaving,
//                   back to the lobby and a second game (teardown / no doubled loops)
//   c  late-join    joining a running relay game during prep (alive) and mid-wave (dead)
//   d  p2p          host + client over PeerJS (local signalling), snapshots, movement,
//                   host closes → client sees the disconnect
//   e  phone        390x844 touch device: layout, touch controls, left stick moves
//
// Every scenario runs in fresh browser contexts; any console error or page error fails it
// (Google Fonts requests are answered locally so they never error). Screenshots land in
// e2e-output/ (gitignored). Exit code 1 on any failure.
//
// Env: E2E_ONLY=a,c (scenario letters or names), E2E_PORT / E2E_PEER_PORT (default: free
// ports), E2E_HEADED=1 (visible browser), E2E_SLOWMO=ms.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PeerServer } from 'peer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e-output');
const VIEWPORT = { width: 1280, height: 720 };
const SCENARIO_TIMEOUT = 150e3;
const PEER_PATH = '/peerjs';

// ---- small helpers -------------------------------------------------------------------------

class Failure extends Error {}

function expect(cond, msg) {
  if (!cond) throw new Failure(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort(preferred) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', (err) => (preferred ? resolve(freePort(0)) : reject(err)));
    srv.listen(preferred || 0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function log(...a) {
  console.log(...a);
}

// ---- servers -------------------------------------------------------------------------------

async function startRelay(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server/relay-server.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const onData = (d) => {
      output += d;
      if (/open http:\/\/localhost:\d+/.test(output)) resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => reject(new Error(`relay-server exited (${code}): ${output}`)));
    setTimeout(() => reject(new Error(`relay-server did not start: ${output}`)), 10e3);
  });
  await ready;
  return {
    url: `http://localhost:${port}/`,
    get output() {
      return output;
    },
    stop() {
      return new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
      });
    },
  };
}

function startPeerServer(port) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PeerServer did not start')), 10e3);
    // host undefined: Node's default (dual-stack where IPv6 exists; peer's own '::' fails without it).
    const app = PeerServer({ host: undefined, port, path: PEER_PATH, key: 'peerjs', allow_discovery: false }, (server) => {
      clearTimeout(timer);
      resolve({
        port,
        // The signalling websockets keep server.close() waiting: don't wait for them.
        stop: () => Promise.race([
          new Promise((r) => {
            server.close(() => r());
            server.closeAllConnections?.();
          }),
          sleep(1000),
        ]),
      });
    });
    app.on('error', reject);
  });
}

// ---- browser players -----------------------------------------------------------------------

/**
 * One scenario: its players (each in a fresh context), the errors they logged, cleanup.
 */
class Scenario {
  constructor(browser, id, name, env) {
    this.browser = browser;
    this.id = id;
    this.name = name;
    this.env = env;
    this.players = [];
    this.errors = [];
    this.warnings = [];
  }

  /**
   * @param {string} tag label in error messages and screenshots
   * @param {object} [opts] { p2p: true (local PeerJS config, api/info → relay:false),
   *   context: extra newContext options }
   */
  async player(tag, opts = {}) {
    const ctx = await this.browser.newContext({ viewport: VIEWPORT, ...opts.context });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: this.env.relay.url.replace(/\/$/, '') });
    // Fonts would need the internet (and a CA headless Chromium may not trust).
    await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    if (opts.p2p) {
      const cfg = {
        peer: { host: 'localhost', port: this.env.peer.port, path: PEER_PATH, secure: false, key: 'peerjs', config: { iceServers: [] } },
      };
      await ctx.route(/\/config\.js(\?|$)/, (route) => route.fulfill({
        status: 200, contentType: 'text/javascript', body: `window.HH_CONFIG = ${JSON.stringify(cfg)};\n`,
      }));
      await ctx.route(/\/api\/info(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"relay":false}' }));
    }
    const page = await ctx.newPage();
    const pl = { tag, ctx, page, keys: new Set(), mouseDown: false, closed: false };
    page.on('console', (m) => {
      const text = `[${tag}] console.${m.type()}: ${m.text()}`;
      if (m.type() === 'error') this.errors.push(text);
      else if (m.type() === 'warning') this.warnings.push(text);
    });
    page.on('pageerror', (e) => this.errors.push(`[${tag}] pageerror: ${e.stack || e.message}`));
    page.on('crash', () => this.errors.push(`[${tag}] page crashed`));
    page.on('response', (r) => {
      if (r.status() >= 400) this.errors.push(`[${tag}] HTTP ${r.status()} ${r.url()}`);
    });
    page.on('requestfailed', (r) => {
      const f = r.failure();
      // Aborted by navigation/close is not an error.
      if (f && !/ERR_ABORTED/.test(f.errorText) && !pl.closed) this.errors.push(`[${tag}] request failed ${r.url()}: ${f.errorText}`);
    });
    this.players.push(pl);
    return pl;
  }

  /** Close a player's tab the way a user does (unload handlers run), then its context. */
  async close(pl) {
    pl.closed = true;
    await pl.page.close({ runBeforeUnload: true });
    await pl.page.waitForEvent('close', { timeout: 5000 }).catch(() => {});
    await pl.ctx.close();
  }

  async screenshots(suffix) {
    for (const pl of this.players) {
      if (pl.closed) continue;
      try {
        await pl.page.screenshot({ path: path.join(OUT, `${this.id}-${this.name}-${pl.tag}${suffix}.png`), timeout: 5000 });
      } catch {
        // page may be gone
      }
    }
  }

  async dispose() {
    for (const pl of this.players) {
      if (!pl.closed) {
        pl.closed = true;
        await pl.ctx.close().catch(() => {});
      }
    }
  }
}

/** page.waitForFunction with a readable failure. */
async function waitFor(pl, fn, arg, what, timeout = 15e3) {
  try {
    return await (await pl.page.waitForFunction(fn, arg, { timeout, polling: 50 })).jsonValue();
  } catch (err) {
    if (/Timeout/.test(err.message)) throw new Failure(`[${pl.tag}] timed out after ${timeout / 1000}s waiting for ${what}`);
    throw err;
  }
}

async function visible(pl, sel) {
  return pl.page.locator(sel).first().isVisible();
}

async function titleSetup(pl, { name, cls, color }) {
  const { page } = pl;
  await page.goto(pl.url);
  await waitFor(pl, () => !document.querySelector('#app').classList.contains('booting') && !document.querySelector('#screen-title').hidden, null, 'the title screen');
  if (name !== undefined) await page.fill('#name-input', name);
  if (cls) await page.click(`.class-card[data-cls="${cls}"]`);
  if (color !== undefined) await page.click(`#color-swatches .swatch[data-color="${color}"]`);
}

/**
 * Touch HUD layout: HUD panels and touch buttons that overlap each other or leave the
 * screen (the resting stick rings are only hints and may sit under things).
 */
function touchLayoutProblems(pl) {
  return pl.page.evaluate(() => {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const boxes = [];
    const sels = ['.hud-vitals', '.cash-wrap', '.hud-wave', '.hud-objective', '.minimap', '.hud-weapon', '.hud-top-centre > *', '.hud-bottom-centre > *', '.touch-btn'];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        boxes.push({ name: el.dataset.id ? `button ${el.dataset.id}` : sel, r });
      }
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i].r;
      if (a.left < -1 || a.top < -1 || a.right > innerWidth + 1 || a.bottom > innerHeight + 1) out.push(`${boxes[i].name} is off screen`);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) out.push(`${boxes[i].name} overlaps ${boxes[j].name} (${ox.toFixed(0)}x${oy.toFixed(0)} px)`);
      }
    }
    return out;
  });
}

/** Snapshot of the in-game state as the page renders it. */
function readState(pl) {
  return pl.page.evaluate(() => {
    const H = window.__HH;
    const v = H && H.getView && H.getView();
    if (!v || !H.session) return null;
    const me = v.players.find((p) => p.id === H.session.localId) || null;
    return {
      tick: v.tick, phase: v.phase, wave: v.wave, zombies: v.zombies.length, players: v.players.map((p) => ({ id: p.id, x: p.x, y: p.y, state: p.state, kills: p.kills })),
      me: me && { id: me.id, x: me.x, y: me.y, state: me.state, kills: me.kills, cash: me.cash, hp: me.hp, respawn: me.respawn },
    };
  });
}

// ---- scripted player -----------------------------------------------------------------------

async function setKeys(pl, want) {
  for (const k of [...pl.keys]) {
    if (!want.has(k)) {
      await pl.page.keyboard.up(k);
      pl.keys.delete(k);
    }
  }
  for (const k of want) {
    if (!pl.keys.has(k)) {
      await pl.page.keyboard.down(k);
      pl.keys.add(k);
    }
  }
}

async function releaseAll(pl) {
  await setKeys(pl, new Set());
  if (pl.mouseDown) {
    await pl.page.mouse.up();
    pl.mouseDown = false;
  }
}

/**
 * One decision of the bot: aim at the nearest zombie (worldToScreen), hold the mouse to
 * fire, walk away from zombies that get close (and back toward home when idle), reload
 * between fights. @returns the state it saw
 */
async function botTick(pl, opts = {}) {
  const s = await pl.page.evaluate((range) => {
    const H = window.__HH;
    const v = H && H.getView && H.getView();
    if (!v || !H.session || !H.renderer) return null;
    const me = v.players.find((p) => p.id === H.session.localId);
    if (!me) return null;
    let best = null, bd = Infinity, ax = 0, ay = 0;
    for (const z of v.zombies) {
      const dx = z.x - me.x, dy = z.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d < bd) {
        bd = d;
        best = z;
      }
      if (d < 240 && d > 1) {
        ax -= (dx / d) * (240 - d);
        ay -= (dy / d) * (240 - d);
      }
    }
    const sp = best && bd < range ? H.renderer.worldToScreen(best.x, best.y) : null;
    const am = me.ammo[me.slot] || [0, 0];
    return {
      sp, ax, ay, dist: bd, x: me.x, y: me.y, state: me.state, phase: v.phase, wave: v.wave, kills: me.kills,
      cash: me.cash, zombies: v.zombies.length, mag: am[0], reserve: am[1], reloading: me.reloading,
    };
  }, opts.range || 900);
  if (!s) return null;
  const { width, height } = pl.page.viewportSize();
  const want = new Set();
  if (opts.move !== false && s.state !== 'dead') {
    let mx = s.ax, my = s.ay;
    if (Math.hypot(mx, my) < 1 && pl.home) {
      // Nothing close: drift back home so the bot doesn't wander into a corner.
      const hx = pl.home.x - s.x, hy = pl.home.y - s.y;
      if (Math.hypot(hx, hy) > 120) {
        mx = hx;
        my = hy;
      }
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      if (mx / len > 0.38) want.add('d');
      if (mx / len < -0.38) want.add('a');
      if (my / len > 0.38) want.add('s');
      if (my / len < -0.38) want.add('w');
    }
  }
  await setKeys(pl, want);
  if (s.sp && opts.fire !== false) {
    const x = Math.max(8, Math.min(width - 8, s.sp.x));
    const y = Math.max(8, Math.min(height - 8, s.sp.y));
    await pl.page.mouse.move(x, y);
    if (!pl.mouseDown) {
      await pl.page.mouse.down();
      pl.mouseDown = true;
    }
  } else {
    if (pl.mouseDown) {
      await pl.page.mouse.up();
      pl.mouseDown = false;
    }
    if (s.mag === 0 || (s.reserve !== 0 && !s.reloading && s.zombies === 0 && s.mag < 4)) await pl.page.keyboard.press('r');
  }
  return s;
}

/** Run the bots of `pls` for up to `ms`, stopping early once until(states) is true. */
async function runBots(pls, ms, until, opts) {
  const t0 = Date.now();
  let last = [];
  while (Date.now() - t0 < ms) {
    last = [];
    for (const pl of pls) last.push(await botTick(pl, opts));
    if (until && until(last)) break;
    await sleep(60);
  }
  for (const pl of pls) await releaseAll(pl);
  return last;
}

/** rAF callbacks vs session.update() calls over ~1 s: 1.0 unless a stale loop survived. */
function measureLoop(pl) {
  return pl.page.evaluate(() => new Promise((resolve) => {
    const s = window.__HH.session;
    const orig = s.update;
    let calls = 0;
    s.update = function update(...a) {
      calls++;
      return orig.apply(this, a);
    };
    let frames = 0;
    const t0 = performance.now();
    const f = () => {
      frames++;
      if (performance.now() - t0 < 1000) {
        requestAnimationFrame(f);
      } else {
        delete s.update;
        resolve({ calls, frames, ratio: calls / Math.max(1, frames) });
      }
    };
    requestAnimationFrame(f);
  }));
}

/** Count what a host session hands to the presentation layer, per player id. */
function hookHostEvents(pl) {
  return pl.page.evaluate(() => {
    const s = window.__HH.session;
    const c = { shots: {}, zdie: {} };
    window.__e2eHost = c;
    if (!s.__e2eHooked) {
      const orig = s.drainEvents.bind(s);
      s.drainEvents = () => {
        const ev = orig();
        for (const e of ev) {
          if (e.type === 'shot' && e.pid) window.__e2eHost.shots[e.pid] = (window.__e2eHost.shots[e.pid] || 0) + 1;
          if (e.type === 'zdie' && e.by) window.__e2eHost.zdie[e.by] = (window.__e2eHost.zdie[e.by] || 0) + 1;
        }
        return ev;
      };
      s.__e2eHooked = true;
    }
  });
}

/**
 * Where the local player should end up after holding a direction for `ticks` ticks,
 * simulated with the shared movement code against the running map.
 */
function expectedWalk(pl, from, dir, ticks) {
  return pl.page.evaluate(async ({ from: f, dir: d, ticks: n }) => {
    const [{ createCollisionWorld, stepPlayerMovement }, { perksFor }, { WEAPONS }, { DT }] = await Promise.all([
      import('/js/shared/movement.js'), import('/js/shared/classes.js'), import('/js/shared/weapons.js'), import('/js/shared/constants.js'),
    ]);
    const H = window.__HH;
    const v = H.getView();
    const me = v.players.find((p) => p.id === H.session.localId);
    const r = H.session.roster.find((q) => q.id === H.session.localId);
    const perks = perksFor(r.cls);
    const w = WEAPONS[me.slots[me.slot]];
    const world = createCollisionWorld(H.session.getMap());
    world.setBarricades(v.barricades || []);
    const p = {
      x: f.x, y: f.y, state: 'alive', stamina: me.stamina, sprintLock: false, speedMult: perks.speedMult,
      moveMult: w ? w.moveMult : 1, staminaMult: perks.staminaMult,
    };
    const cmd = { moveX: d.x, moveY: d.y, sprint: false };
    for (let i = 0; i < n; i++) stepPlayerMovement(p, cmd, DT, world);
    return { x: p.x, y: p.y };
  }, { from, dir, ticks });
}

// ---- scenarios -------------------------------------------------------------------------------

/** a. Solo game with a scripted player. */
async function scenarioSolo(sc) {
  const pl = await sc.player('solo');
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Soloist', cls: 'soldier' });
  expect(await pl.page.inputValue('#name-input') === 'Soloist', 'name field did not keep the typed name');
  await pl.page.click('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  expect(await visible(pl, '#btn-start'), 'solo lobby has no visible Start button');
  expect((await pl.page.textContent('#lobby-transport')).includes('Solo'), 'solo lobby does not say Solo');
  await pl.page.click('#btn-start');
  await waitFor(pl, () => !document.querySelector('#screen-game').hidden && window.__HH.getView() !== null, null, 'the game screen');
  const first = await readState(pl);
  expect(first.phase === 'prep', `game should start in prep, got ${first.phase}`);
  expect(first.me && first.me.state === 'alive', 'local player missing or not alive at start');
  const roster = await pl.page.evaluate(() => window.__HH.session.roster);
  expect(roster.length === 1 && roster[0].name === 'Soloist' && roster[0].cls === 'soldier', `roster should hold the chosen profile: ${JSON.stringify(roster)}`);
  const cash0 = first.me.cash;
  pl.home = { x: first.me.x, y: first.me.y };

  await pl.page.keyboard.press('Space'); // ready: skip the prep timer
  await waitFor(pl, () => window.__HH.getView() && window.__HH.getView().phase === 'wave', null, 'phase prep → wave after Space', 5000);
  const phases = new Set(['prep']);
  let maxZombies = 0, kills = 0, cash = cash0, st = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 40e3) {
    st = await botTick(pl);
    if (st) {
      phases.add(st.phase);
      maxZombies = Math.max(maxZombies, st.zombies);
      kills = st.kills;
      cash = st.cash;
    }
    await sleep(60);
  }
  await releaseAll(pl);
  const hudWave = (await pl.page.textContent('#hud .wave-num')).trim();
  const hudCash = (await pl.page.textContent('#hud .cash')).trim();
  await sc.screenshots('');
  log(`    solo: phases ${[...phases].join('→')}, max zombies ${maxZombies}, kills ${kills}, cash ${cash0} → ${cash}, HUD wave "${hudWave}", HUD cash "${hudCash}", state ${st && st.state}`);
  expect(phases.has('wave'), 'never reached the wave phase');
  expect(maxZombies > 0, 'no zombies ever appeared');
  expect(kills > 0, 'the scripted player killed nothing in 40 s');
  expect(cash > cash0, `cash did not increase (${cash0} → ${cash})`);
  const v = await readState(pl);
  expect(hudWave === String(v.wave >= 1 ? v.wave : 1), `HUD wave "${hudWave}" does not match the view's wave ${v.wave}`);
  expect(hudCash.replace(/[^0-9]/g, '') !== '' && Number(hudCash.replace(/[^0-9]/g, '')) > cash0, `HUD cash "${hudCash}" did not increase from ${cash0}`);
}

async function hostOnline(sc, tag, profile, opts = {}) {
  const pl = await sc.player(tag, opts);
  pl.url = sc.env.relay.url;
  await titleSetup(pl, profile);
  await waitFor(pl, () => !/Checking/.test(document.querySelector('#server-status').textContent), null, 'the server status line');
  const status = await pl.page.textContent('#server-status');
  if (opts.p2p) expect(/peer-to-peer/.test(status), `title should offer p2p, says "${status}"`);
  else expect(/Relay server online/.test(status), `title should report the relay, says "${status}"`);
  await pl.page.click('#btn-host');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden && /^[A-Z2-9]{5}$/.test(document.querySelector('#room-code').textContent.trim()), null, 'a room code in the lobby', 20e3);
  const code = (await pl.page.textContent('#room-code')).trim();
  await pl.page.click('#copy-link');
  const invite = await pl.page.evaluate(() => navigator.clipboard.readText());
  const info = await pl.page.evaluate(() => ({ transport: window.__HH.session.transport, inviteUrl: window.__HH.session.inviteUrl }));
  expect(invite === info.inviteUrl, `copied invite link "${invite}" differs from the session's "${info.inviteUrl}"`);
  const u = new URL(invite);
  expect(u.searchParams.get('join') === code, `invite link ${invite} does not carry the code ${code}`);
  if (opts.p2p) {
    expect(info.transport === 'p2p' && !u.searchParams.has('via'), `expected a p2p room, got ${info.transport} / ${invite}`);
    expect(/peer-to-peer/.test(await pl.page.textContent('#lobby-transport')), 'lobby should say peer-to-peer');
  } else {
    expect(info.transport === 'relay' && u.searchParams.get('via') === 'relay', `expected a relay room, got ${info.transport} / ${invite}`);
    expect(/relay/.test(await pl.page.textContent('#lobby-transport')), 'lobby should say relay');
  }
  return { host: pl, code, invite };
}

async function joinByLink(sc, tag, invite, opts = {}) {
  const pl = await sc.player(tag, opts);
  pl.url = invite;
  await pl.page.goto(invite);
  return pl;
}

async function rosterDom(pl) {
  return pl.page.$$eval('#roster .roster-row', (rows) => rows.map((r) => ({
    name: r.querySelector('.roster-name').textContent, color: getComputedStyle(r.querySelector('.roster-name')).color,
  })));
}

async function waitInGame(pl, nPlayers, what) {
  await waitFor(pl, (n) => {
    const H = window.__HH;
    const v = H.getView && H.getView();
    return !document.querySelector('#screen-game').hidden && !!v && v.players.length === n && v.players.some((p) => p.id === H.session.localId);
  }, nPlayers, what || `the game screen with ${nPlayers} players`, 20e3);
}

/** b. Three players over the relay. */
async function scenarioRelay(sc) {
  const { host, invite } = await hostOnline(sc, 'host', { name: 'Hosty', cls: 'engineer', color: 2 });
  // Both friends kept the default colour 0 and random names: the host keeps them apart.
  const c1 = await joinByLink(sc, 'client1', invite);
  const c2 = await joinByLink(sc, 'client2', invite);
  const all = [host, c1, c2];
  for (const pl of all) {
    await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden && document.querySelectorAll('#roster .roster-row').length === 3, null, 'a lobby roster of 3');
  }
  for (const pl of all) {
    const rows = await rosterDom(pl);
    expect(new Set(rows.map((r) => r.name)).size === 3, `[${pl.tag}] roster names are not distinct: ${JSON.stringify(rows)}`);
    expect(new Set(rows.map((r) => r.color)).size === 3, `[${pl.tag}] roster colours are not distinct: ${JSON.stringify(rows)}`);
  }
  const ids = {
    c1: await c1.page.evaluate(() => window.__HH.session.localId),
    c2: await c2.page.evaluate(() => window.__HH.session.localId),
  };
  expect(ids.c1 > 1 && ids.c2 > 1 && ids.c1 !== ids.c2, `bad client ids ${JSON.stringify(ids)}`);

  // chat from client 1 reaches everyone
  await c1.page.fill('#lobby-chat-input', 'hello from the e2e test');
  await c1.page.press('#lobby-chat-input', 'Enter');
  for (const pl of all) await waitFor(pl, () => /hello from the e2e test/.test(document.querySelector('#lobby-chat-log').textContent), null, 'the lobby chat message');

  // host changes the mission; clients see it (and can't change it)
  await host.page.click('.map-card[data-map="truckstop"]');
  await host.page.click('#opt-difficulty .seg-btn[data-value="hard"]');
  for (const pl of [c1, c2]) {
    await waitFor(pl, () => document.querySelector('.map-card[data-map="truckstop"]').getAttribute('aria-checked') === 'true'
      && document.querySelector('#opt-difficulty .seg-btn[data-value="hard"]').getAttribute('aria-checked') === 'true', null, 'the host\'s map/difficulty change');
    const s = await pl.page.evaluate(() => window.__HH.session.settings);
    expect(s.mapId === 'truckstop' && s.difficulty === 'hard', `[${pl.tag}] settings ${JSON.stringify(s)}`);
    expect(!(await visible(pl, '#btn-start')), `[${pl.tag}] a client sees the Start button`);
  }
  await c1.page.click('.map-card[data-map="bridge"]', { force: true });
  await sleep(300);
  expect(await host.page.evaluate(() => window.__HH.session.settings.mapId) === 'truckstop', 'a client changed the map');

  // ready up, start
  await c1.page.click('#btn-ready');
  await c2.page.click('#btn-ready');
  await waitFor(host, () => window.__HH.session.roster.filter((r) => r.ready).length === 2, null, 'both clients ready');
  await host.page.click('#btn-start');
  for (const pl of all) await waitInGame(pl, 3);
  for (const pl of all) {
    const m = await measureLoop(pl);
    expect(m.ratio > 0.75 && m.ratio < 1.3, `[${pl.tag}] game loop ran ${m.calls} updates in ${m.frames} frames`);
  }
  for (const pl of [c1, c2]) {
    const st = await pl.page.evaluate(() => ({ ...window.__HH.session.stats }));
    expect(st.snapshotsPerSec >= 15 && st.snapshotsPerSec <= 25, `[${pl.tag}] receives ${st.snapshotsPerSec} snapshots/s over the relay`);
  }

  // movement: client 1 holds D; the host (and client 2) see it; prediction agrees
  const before = await c1.page.evaluate(() => window.__HH.session.getPredictedLocal());
  const hostBefore = (await readState(host)).players.find((p) => p.id === ids.c1);
  const c2Before = (await readState(c2)).players.find((p) => p.id === ids.c1);
  const tDown = Date.now();
  await c1.page.keyboard.down('d');
  await sleep(1500);
  await c1.page.keyboard.up('d');
  const held = (Date.now() - tDown) / 1000;
  const settled = async (pl) => {
    let prev = null;
    for (let i = 0; i < 30; i++) {
      const p = (await readState(pl)).players.find((q) => q.id === ids.c1);
      if (prev && Math.abs(p.x - prev.x) < 0.01 && Math.abs(p.y - prev.y) < 0.01) return p;
      prev = p;
      await sleep(150);
    }
    return prev;
  };
  const hostAfter = await settled(host);
  const c2After = await settled(c2);
  await sleep(300);
  const after = await c1.page.evaluate(() => window.__HH.session.getPredictedLocal());
  const exp = await expectedWalk(c1, before, { x: 1, y: 0 }, Math.round(held * 60));
  const expDx = exp.x - before.x;
  const hostDx = hostAfter.x - hostBefore.x;
  const c2Dx = c2After.x - c2Before.x;
  const predDx = after.x - before.x;
  log(`    movement: held ${held.toFixed(2)} s, expected dx ${expDx.toFixed(1)}, host ${hostDx.toFixed(1)}, client2 ${c2Dx.toFixed(1)}, predicted ${predDx.toFixed(1)} (pred vs host ${(after.x - hostAfter.x).toFixed(2)}, ${(after.y - hostAfter.y).toFixed(2)})`);
  expect(expDx > 100, `test setup: the path to the right is blocked (expected dx ${expDx})`);
  expect(Math.abs(hostDx - expDx) < Math.max(25, expDx * 0.12), `host saw client 1 move ${hostDx.toFixed(1)} px, expected ≈ ${expDx.toFixed(1)}`);
  expect(Math.abs(c2Dx - hostDx) < 2, `client 2 saw ${c2Dx.toFixed(1)} px vs host ${hostDx.toFixed(1)}`);
  expect(Math.abs(after.x - hostAfter.x) < 3 && Math.abs(after.y - hostAfter.y) < 3,
    `client 1's prediction (${after.x.toFixed(1)}, ${after.y.toFixed(1)}) disagrees with the host (${hostAfter.x.toFixed(1)}, ${hostAfter.y.toFixed(1)})`);

  // clients fight wave 1; the host sees their shots and kills
  await hookHostEvents(host);
  for (const pl of all) await pl.page.keyboard.press('Space');
  await waitFor(host, () => window.__HH.getView().phase === 'wave', null, 'wave 1 after everyone pressed ready', 8000);
  for (const pl of [c1, c2]) pl.home = (await readState(pl)).me;
  const creditOk = async () => host.page.evaluate((i) => {
    const c = window.__e2eHost;
    const v = window.__HH.getView();
    const k = (id) => (v.players.find((p) => p.id === id) || { kills: 0 }).kills;
    return { shots1: c.shots[i.c1] || 0, shots2: c.shots[i.c2] || 0, kills1: k(i.c1), kills2: k(i.c2), zdie1: c.zdie[i.c1] || 0, zdie2: c.zdie[i.c2] || 0 };
  }, ids);
  let credit = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 45e3) {
    await runBots([c1, c2], 1500, null);
    credit = await creditOk();
    if (credit.shots1 > 0 && credit.shots2 > 0 && credit.kills1 > 0 && credit.kills2 > 0) break;
  }
  log(`    combat credit on the host: ${JSON.stringify(credit)}`);
  expect(credit.shots1 > 0 && credit.shots2 > 0, `host saw no shots from a client: ${JSON.stringify(credit)}`);
  expect(credit.kills1 > 0 && credit.kills2 > 0, `a client's kills were never credited on the host: ${JSON.stringify(credit)}`);
  expect(credit.zdie1 > 0 && credit.zdie2 > 0, `no 'zdie' events credited to the clients: ${JSON.stringify(credit)}`);
  await sc.screenshots('-game1');

  // client 2 leaves
  const c2Name = await c2.page.evaluate(() => window.__HH.session.roster.find((r) => r.id === window.__HH.session.localId).name);
  await sc.close(c2);
  await waitFor(host, () => window.__HH.session.roster.length === 2 && window.__HH.getView().players.length === 2, null, 'the host roster to drop to 2');
  await waitFor(c1, () => window.__HH.session.roster.length === 2, null, 'client 1\'s roster to drop to 2');
  for (const pl of [host, c1]) {
    await waitFor(pl, (n) => [...document.querySelectorAll('#hud .chat-line.system')].some((l) => l.textContent === `${n} left the game`), c2Name, `the system chat line "${c2Name} left the game"`);
  }

  // back to the lobby (the pause menu has no such button: the session API it is)
  expect(await host.page.evaluate(() => window.__HH.session.returnToLobby()) === true, 'returnToLobby() refused');
  for (const pl of [host, c1]) {
    await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden && document.querySelector('#screen-game').hidden && !window.__HH.session.inGame, null, 'the lobby after returnToLobby');
  }

  // a second game (client 1 is not ready: the host confirms)
  await host.page.click('#btn-start');
  await waitFor(host, () => !document.querySelector('#dlg-confirm').hidden, null, 'the "start without everyone" dialog');
  await host.page.click('#confirm-yes');
  for (const pl of [host, c1]) await waitInGame(pl, 2, 'the second game with 2 players');
  for (const pl of [host, c1]) {
    const m = await measureLoop(pl);
    log(`    second game loop [${pl.tag}]: ${m.calls} updates / ${m.frames} frames`);
    expect(m.ratio > 0.75 && m.ratio < 1.3, `[${pl.tag}] second game runs ${m.calls} updates in ${m.frames} frames (a stale loop survived?)`);
    const canvases = await pl.page.evaluate(() => document.querySelectorAll('canvas#game-canvas').length + document.querySelectorAll('.touch-layer, .hud-chat').length);
    expect(canvases <= 2, `[${pl.tag}] duplicated game DOM after the second start (${canvases})`);
  }
  await hookHostEvents(host);
  const t1 = await readState(c1);
  // Prep: no zombies yet, so just shoot into the air for a moment.
  await c1.page.mouse.move(VIEWPORT.width / 2 + 200, VIEWPORT.height / 2 + 20);
  await c1.page.mouse.down();
  await sleep(1500);
  await c1.page.mouse.up();
  await sleep(1000);
  const t2 = await readState(c1);
  expect(t2.tick > t1.tick + 120, `second game does not advance on the client (${t1.tick} → ${t2.tick})`);
  const shots = await host.page.evaluate((i) => window.__e2eHost.shots[i] || 0, ids.c1);
  expect(shots > 0, 'second game: the host saw no shots from client 1');
  await sc.screenshots('-game2');
}

/** c. Joining a running relay game: during prep (alive) and mid-wave (spectating). */
async function scenarioLateJoin(sc) {
  const { host, invite } = await hostOnline(sc, 'host', { name: 'Anchor', cls: 'heavy' });
  await host.page.click('#btn-start');
  await waitInGame(host, 1);
  expect((await readState(host)).phase === 'prep', 'host game should be in prep');

  const early = await joinByLink(sc, 'prepjoin', invite);
  await waitInGame(early, 2, 'the prep joiner in the game screen');
  const e = await readState(early);
  expect(e.me.state === 'alive', `a prep joiner should be alive, is ${e.me.state}`);
  expect(e.players.some((p) => p.id === 1), 'the prep joiner does not see the host');
  expect(await visible(early, '#hud'), 'the prep joiner has no HUD');
  await waitFor(host, () => window.__HH.getView().players.length === 2, null, 'the host to see the prep joiner');

  await host.page.keyboard.press('Space');
  await early.page.keyboard.press('Space');
  await waitFor(host, () => window.__HH.getView().phase === 'wave', null, 'wave 1', 8000);
  const late = await joinByLink(sc, 'wavejoin', invite);
  await waitInGame(late, 3, 'the mid-wave joiner in the game screen');
  const l = await readState(late);
  expect(l.me.state === 'dead' && l.me.respawn === true, `a mid-wave joiner should spectate until the wave ends, is ${l.me.state} (respawn ${l.me.respawn})`);
  expect(l.players.some((p) => p.id === 1 && p.state === 'alive'), 'the mid-wave joiner does not see the living host');
  const t1 = l.tick;
  await waitFor(late, (t) => window.__HH.getView().tick > t + 60, t1, 'the spectator view to advance');
  await sc.screenshots('');
}

/** d. Host + client over PeerJS with the local signalling server. */
async function scenarioP2P(sc) {
  const { host, invite } = await hostOnline(sc, 'host', { name: 'PeerHost', cls: 'medic' }, { p2p: true });
  const cli = await joinByLink(sc, 'client', invite, { p2p: true });
  for (const pl of [host, cli]) {
    await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden && document.querySelectorAll('#roster .roster-row').length === 2, null, 'a p2p lobby of 2', 25e3);
  }
  expect(await cli.page.evaluate(() => window.__HH.session.transport) === 'p2p', 'client is not on p2p');
  await host.page.click('#btn-start');
  await waitFor(host, () => !document.querySelector('#dlg-confirm').hidden, null, 'the "start without everyone" dialog');
  await host.page.click('#confirm-yes');
  for (const pl of [host, cli]) await waitInGame(pl, 2);

  const t1 = (await readState(cli)).tick;
  await sleep(2500);
  const t2 = (await readState(cli)).tick;
  const stats = await cli.page.evaluate(() => ({ ...window.__HH.session.stats }));
  log(`    p2p: client view tick ${t1} → ${t2} in 2.5 s, stats ${JSON.stringify(stats)}`);
  expect(t2 - t1 > 100, `client view barely advanced (${t1} → ${t2})`);
  expect(stats.snapshotsPerSec >= 15 && stats.snapshotsPerSec <= 25, `client receives ${stats.snapshotsPerSec} snapshots/s`);

  const id = await cli.page.evaluate(() => window.__HH.session.localId);
  const hb = (await readState(host)).players.find((p) => p.id === id);
  await cli.page.keyboard.down('d');
  await sleep(1000);
  await cli.page.keyboard.up('d');
  await waitFor(host, ({ i, x }) => {
    const p = window.__HH.getView().players.find((q) => q.id === i);
    return p && p.x > x + 100;
  }, { i: id, x: hb.x }, 'the host to see the p2p client move right');
  await sc.screenshots('');

  const tClose = Date.now();
  await sc.close(host);
  await waitFor(cli, () => !document.querySelector('#dlg-error').hidden, null, 'the client\'s disconnected dialog', 5000);
  const closeSecs = (Date.now() - tClose) / 1000;
  const title = await cli.page.textContent('#error-title');
  const text = await cli.page.textContent('#error-text');
  log(`    p2p: ${closeSecs.toFixed(1)} s after the host closed: "${title}: ${text}"`);
  expect(/Disconnected/.test(title), `unexpected dialog "${title}"`);
  // The host's page said goodbye on its way out (pagehide → leave → 'bye').
  expect(text === 'The host left the game.', `unexpected disconnect message "${text}"`);
  expect(await cli.page.evaluate(() => window.__HH.session === null), 'the client session was not torn down');
  await cli.page.click('#error-ok');
  await waitFor(cli, () => !document.querySelector('#screen-title').hidden && document.querySelector('#screen-game').hidden, null, 'the title screen after the disconnect');
}

/** e. Phone: 390x844, touch. */
async function scenarioPhone(sc) {
  const pl = await sc.player('phone', {
    context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  });
  pl.url = sc.env.relay.url;
  await titleSetup(pl, {});
  const layout = await pl.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth }));
  expect(layout.sw <= layout.iw && layout.bw <= layout.iw, `title scrolls horizontally: ${JSON.stringify(layout)}`);
  for (const sel of ['#btn-solo', '#btn-host', '#btn-join', '#name-input']) {
    const box = await pl.page.locator(sel).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= layout.iw + 0.5, `${sel} is outside the phone screen: ${JSON.stringify(box)}`);
  }
  await pl.page.tap('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  const lobbyLayout = await pl.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(lobbyLayout.sw <= lobbyLayout.iw, `lobby scrolls horizontally: ${JSON.stringify(lobbyLayout)}`);
  await pl.page.locator('#btn-start').scrollIntoViewIfNeeded();
  await pl.page.tap('#btn-start');
  await waitInGame(pl, 1);
  await waitFor(pl, () => {
    const l = document.querySelector('.touch-layer');
    return !!l && !l.classList.contains('disabled') && l.getBoundingClientRect().width > 0;
  }, null, 'visible touch controls');
  for (const sel of ['.touch-zone-left', '.touch-zone-right', '.touch-btn-reload', '.touch-btn-pause']) {
    expect(await visible(pl, sel), `touch control ${sel} is not visible`);
  }
  // The HUD measures its columns and stacks the touch rows under them.
  await waitFor(pl, () => getComputedStyle(document.querySelector('#screen-game')).getPropertyValue('--touch-util-top') !== '', null, 'the touch HUD layout pass');
  await sleep(300);
  const portraitProblems = await touchLayoutProblems(pl);
  expect(!portraitProblems.length, `portrait touch HUD: ${portraitProblems.join('; ')}`);
  const before = (await readState(pl)).me;
  // A thumb on the left half, dragged right: the move stick.
  const cdp = await pl.ctx.newCDPSession(pl.page);
  const x0 = 90, y0 = 650;
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
  });
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', x0 + i * 10, y0);
    await sleep(16);
  }
  await sleep(900);
  const mid = (await readState(pl)).me;
  await touch('touchEnd');
  await sleep(300);
  const after = (await readState(pl)).me;
  log(`    phone: player x ${before.x.toFixed(1)} → ${mid.x.toFixed(1)} (stick held) → ${after.x.toFixed(1)}, y ${before.y.toFixed(1)} → ${after.y.toFixed(1)}`);
  expect(after.x - before.x > 80, `the left stick did not move the player right (${before.x.toFixed(1)} → ${after.x.toFixed(1)})`);
  expect(Math.abs(after.y - before.y) < 20, `the left stick moved the player vertically (${before.y.toFixed(1)} → ${after.y.toFixed(1)})`);
  const gameLayout = await pl.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(gameLayout.sw <= gameLayout.iw, `game screen scrolls horizontally: ${JSON.stringify(gameLayout)}`);
  await sc.screenshots('-portrait');

  // Turned sideways: the renderer and the HUD follow, nothing overlaps.
  await pl.page.setViewportSize({ width: 844, height: 390 });
  await waitFor(pl, () => document.querySelector('#game-canvas').getBoundingClientRect().width === 844, null, 'the canvas to follow the rotation');
  await sleep(700);
  const landscapeProblems = await touchLayoutProblems(pl);
  expect(!landscapeProblems.length, `landscape touch HUD: ${landscapeProblems.join('; ')}`);
  const land = await pl.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(land.sw <= land.iw, `landscape game screen scrolls horizontally: ${JSON.stringify(land)}`);
  await sc.screenshots('-landscape');
}

const SCENARIOS = [
  ['a', 'solo', scenarioSolo],
  ['b', 'relay-mp', scenarioRelay],
  ['c', 'late-join', scenarioLateJoin],
  ['d', 'p2p', scenarioP2P],
  ['e', 'phone', scenarioPhone],
];

// ---- main --------------------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f));
  const only = (process.env.E2E_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const picked = SCENARIOS.filter(([id, name]) => !only.length || only.includes(id) || only.includes(name));
  const relay = await startRelay(await freePort(Number(process.env.E2E_PORT) || 0));
  const peer = await startPeerServer(await freePort(Number(process.env.E2E_PEER_PORT) || 0));
  const env = { relay, peer };
  log(`e2e: relay ${relay.url}, PeerJS signalling on :${peer.port}${PEER_PATH}`);
  const browser = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    slowMo: Number(process.env.E2E_SLOWMO) || 0,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const results = [];
  try {
    for (const [id, name, run] of picked) {
      const sc = new Scenario(browser, id, name, env);
      const started = Date.now();
      let error = null;
      let timer;
      try {
        await Promise.race([
          run(sc),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Failure(`scenario timed out after ${SCENARIO_TIMEOUT / 1000}s`)), SCENARIO_TIMEOUT);
          }),
        ]);
        // Let late console errors (teardown, stragglers) surface before judging.
        await sleep(300);
      } catch (err) {
        error = err;
        await sc.screenshots('-FAIL');
      } finally {
        clearTimeout(timer);
      }
      const errs = [...sc.errors];
      await sc.dispose();
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const ok = !error && errs.length === 0;
      results.push({ id, name, ok, secs });
      if (ok) {
        log(`PASS ${id} ${name} (${secs}s)`);
      } else {
        log(`FAIL ${id} ${name} (${secs}s)`);
        if (error) log(`  ${error instanceof Failure ? error.message : error.stack || error}`);
        for (const e of errs.slice(0, 20)) log(`  unexpected: ${e}`);
        if (errs.length > 20) log(`  … and ${errs.length - 20} more errors`);
      }
      for (const w of sc.warnings.slice(0, 10)) log(`  warning: ${w}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await peer.stop().catch(() => {});
    await relay.stop().catch(() => {});
  }
  const failed = results.filter((r) => !r.ok);
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  log(`e2e: ${results.length - failed.length}/${results.length} passed in ${total}s${failed.length ? ` — FAILED: ${failed.map((r) => `${r.id} ${r.name}`).join(', ')}` : ''}`);
  // Exit explicitly: a lingering socket must not keep CI waiting.
  process.exit(failed.length || !results.length ? 1 : 0);
}

main().catch((err) => {
  console.error('e2e: crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
