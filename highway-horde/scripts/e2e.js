#!/usr/bin/env node
// End-to-end browser tests: `npm run e2e`.
//
// Starts server/relay-server.js (static files + WebSocket relay) and a local PeerJS
// signalling server, then drives headless Chromium through whole games:
//
//   a  solo         title → class → Play Solo → Start → N readies up, Space jumps, a
//                   scripted player fights wave 1
//   b  relay-mp     3 players over the relay: invite link, roster, chat, settings, start,
//                   movement replication + prediction, shots/kills, a player leaving,
//                   back to the lobby and a second game (teardown / no doubled loops)
//   c  late-join    joining a running relay game during prep (alive) and mid-wave (dead)
//   d  p2p          host + client over PeerJS (local signalling), snapshots, movement,
//                   host closes → client sees the disconnect
//   e  phone        390x844 touch device: layout, touch controls, left stick moves
//   f  bots         solo lobby + Add Bot (BOT tags, ✕ removes one), the human readies,
//                   the bots ready up after them, fight wave 1 and score kills
//   g  fps-solo     first-person view (three.js): pointer lock, W walks along the view,
//                   Space jumps (the camera rises and comes back down), W + Space into the
//                   nearest car / van / container climbs onto its roof (the player stays
//                   up there, the camera rides at eye height above it), losing the lock
//                   opens the pause menu, turn toward the nearest zombie with the view data
//                   and kill it, End Game + a second game (no leaks)
//   h  fps-relay    2 players over the relay in first person: each one's camera sees the
//                   other, the client's W moves it along ITS yaw on the host, and the host
//                   sees the client jump
//   i  zone         Evac Run: the lobby's Mode row and the Evac Run-only Harlan County
//                   card keep map and mode compatible, two bots; the zone is announced
//                   (panel), the player walks toward it, and once the wave locks the circle
//                   the player outside gets the warning and loses health to the blight
//                   (top-down); then a first-person game shows the zone wall, compass, panel
//   j  day          the lobby's Time row (Night default, Day, persisted in the prefs), a
//                   first-person solo game by day (sun on, flashlight off) and a top-down one
//   k  campaign     the Campaign mode: lobby (Mode row, CAMPAIGN badges, previews, plays by day),
//                   the stages driven through the host's game (hill, breakout, floor, roof,
//                   zip line, escape, "Escaped" end screen), then first person: hill, tower
//                   floor and roof
//   l  story-loop   Road to Haven, the engine side: Story → New campaign (solo, one bot) → the first road
//                   briefing → Deploy → the real mission m1_1 (story HUD) ended through the director's
//                   storyend → the debrief (stars, XP bar, level-up, perk point spent) → the next
//                   briefing; then the saves: reload, the campaign is listed, Export a file, Delete,
//                   Import it back, Continue resumes it; then a crafted save at the Roadhouse: the
//                   arrival scene, every station panel, the board, a briefing backed out of
//
//   m  story        Road to Haven: a small mission started through the session's createGame
//                   hook, two bots: objective tracker, an NPC (Mara) with her talk prompt and
//                   the radio strip, fuel cans and an optional note picked up, a hold-to-use
//                   device with its ring, "Mission complete"; then first person: the NPC's
//                   model with accessory and hair, the items and markers in the 3D scene
//
// Scenarios a–f play the classic top-down view (the view pref is forced to 'topdown' in
// localStorage before every page load); g and h play first person at quality 'low', i both.
// First-person test hooks (window.__HH, set by ui/match.js):
//   __HH.look(dx, dy)  turn the camera as if the mouse moved dx/dy CSS px under pointer
//                      lock (headless Chromium can lock the pointer but its synthetic mouse
//                      moves carry no locked movement); 0.0022 rad/px at sensitivity 1
//   __HH.getLook()     { yaw, pitch, ready, locked, view, frames } — the UI's camera angles
//                      (frames: game frames run so far; look input is applied once per frame)
//   __HH.view          'fps' | 'topdown' — the view the running match uses
// Software WebGL (SwiftShader) renders only a few frames per second here, so the
// first-person checks are written to hold at low frame rates.
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
import { LEVEL_TEST_MISSION } from '../tests/fixtures/level-mission.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e-output');
const VIEWPORT = { width: 1280, height: 720 };
const SCENARIO_TIMEOUT = 150e3;
const PEER_PATH = '/peerjs';
/** First person runs on software WebGL here: a smaller window keeps the frames coming. */
const FPS_VIEWPORT = { width: 960, height: 540 };
/** Radians per px fed to __HH.look (ui/look.js LOOK_RAD_PER_PX at sensitivity 1). */
const LOOK_RAD_PER_PX = 0.0022;
/** Screenshot timeout for first-person pages (a frame can take seconds on software WebGL). */
const FPS_SHOT_MS = 20e3;
const PREFS_KEY = 'highway-horde:prefs:v1';
/** Console warnings from software WebGL itself, not from the game. */
const GL_NOISE = /GPU stall|GL Driver Message|SwiftShader|swiftshader|GroupMarkerNotSet/;

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
   *   context: extra newContext options, view: 'topdown' (default) | 'fps', quality }
   */
  async player(tag, opts = {}) {
    const ctx = await this.browser.newContext({ viewport: VIEWPORT, ...opts.context });
    // The view preference is forced before every load (the rest of the prefs persist).
    await ctx.addInitScript(({ key, view, quality }) => {
      try {
        const p = JSON.parse(localStorage.getItem(key) || '{}') || {};
        p.settings = { ...(p.settings || {}), view };
        if (quality) p.settings.quality = quality;
        localStorage.setItem(key, JSON.stringify(p));
      } catch {
        // about:blank and friends have no storage
      }
    }, { key: PREFS_KEY, view: opts.view || 'topdown', quality: opts.quality || null });
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
      else if (m.type() === 'warning' && !GL_NOISE.test(m.text())) this.warnings.push(text);
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

  /** @param {number} [timeout] ms per page (software WebGL pages need longer for a frame) */
  async screenshots(suffix, timeout = 5000) {
    for (const pl of this.players) {
      if (pl.closed) continue;
      try {
        await pl.page.screenshot({ path: path.join(OUT, `${this.id}-${this.name}-${pl.tag}${suffix}.png`), timeout });
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

/**
 * Hold Space until the local player is seen in the air (and, with `camera`, the 3D camera
 * above the eye height), then let go and wait for the landing. The height comes from the
 * session's own view (fresh on every call); software WebGL draws only a few frames per
 * second, so the camera is sampled whenever one was drawn while Space is held (holding it
 * hops again after each landing, so nearly every frame is in the air).
 * @returns {Promise<{ z: number, cam: number }>} the highest z / camera height seen
 */
async function jump(pl, { camera = false } = {}) {
  await pl.page.evaluate(() => {
    window.__e2eJump = { z: 0, cam: 0 };
  });
  await pl.page.keyboard.down('Space');
  let top;
  try {
    top = await waitFor(pl, (cam) => {
      const H = window.__HH;
      const v = H.session.getView();
      const me = v && v.players.find((p) => p.id === H.session.localId);
      const J = window.__e2eJump;
      if (me) J.z = Math.max(J.z, me.z || 0);
      if (cam && H.renderer && H.renderer.debug) J.cam = Math.max(J.cam, H.renderer.debug.camera.position.y);
      return J.z > 20 && (!cam || J.cam > 52 + 20) ? J : false;
    }, camera, camera ? 'Space to lift the player and the camera' : 'Space to lift the player', 30e3);
  } finally {
    await pl.page.keyboard.up('Space');
  }
  await waitFor(pl, () => {
    const H = window.__HH;
    const v = H.session.getView();
    const me = v && v.players.find((p) => p.id === H.session.localId);
    return me && me.z === 0;
  }, null, 'the landing after the jump', 15e3);
  return top;
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

  await pl.page.keyboard.press('KeyN'); // ready: skip the prep timer
  await waitFor(pl, () => window.__HH.getView() && window.__HH.getView().phase === 'wave', null, 'phase prep → wave after N (ready)', 5000);
  // Space jumps (it used to ready up): up in the air, then back on the ground.
  const hop = await jump(pl);
  log(`    solo jump: peak ${hop.z.toFixed(1)} units, landed`);
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

/** f. Play Solo with an AI squad: bots added in the lobby fight for an idle human. */
async function scenarioBots(sc) {
  const pl = await sc.player('squad');
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Leader', cls: 'soldier' });
  await pl.page.click('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  expect(await visible(pl, '#btn-add-bot'), 'the solo lobby has no Add Bot button');
  for (let i = 0; i < 3; i++) await pl.page.click('#btn-add-bot');
  await waitFor(pl, () => document.querySelectorAll('#roster .roster-row').length === 4, null, 'four roster rows');
  const tags = await pl.page.$$eval('#roster .roster-row', (rows) => rows.map((r) => !r.querySelector('.roster-bot').hidden));
  expect(JSON.stringify(tags) === '[false,true,true,true]', `BOT tags on the bot rows only: ${JSON.stringify(tags)}`);
  await pl.page.locator('#roster .roster-row').nth(3).locator('.roster-kick').click();
  await waitFor(pl, () => document.querySelectorAll('#roster .roster-row').length === 3, null, 'the ✕ to remove a bot');
  const roster = await pl.page.evaluate(() => window.__HH.session.roster);
  const botIds = roster.filter((r) => r.bot).map((r) => r.id);
  expect(botIds.length === 2 && roster.every((r) => r.bot ? r.ready : r.name === 'Leader'), `roster: ${JSON.stringify(roster)}`);
  expect(new Set(roster.map((r) => r.color)).size === 3 && new Set(roster.map((r) => r.cls)).size === 3, `bots should take free colours and classes: ${JSON.stringify(roster)}`);
  await pl.page.click('#btn-start');
  await waitFor(pl, () => !document.querySelector('#screen-game').hidden && window.__HH.getView() && window.__HH.getView().players.length === 3, null, 'the game with three survivors');
  await pl.page.keyboard.press('KeyN'); // the human readies; the bots follow
  await waitFor(pl, () => window.__HH.getView().phase === 'wave', null, 'the wave (bots ready after the human)', 8000);
  // The human stands still; the squad has to do the killing.
  const kills = await waitFor(pl, (ids) => {
    const v = window.__HH.getView();
    const k = v.players.filter((p) => ids.includes(p.id)).map((p) => p.kills);
    return k.every((n) => n > 0) ? k : false;
  }, botIds, 'both bots to kill zombies', 60e3);
  await sc.screenshots('');
  log(`    bots: kills ${kills.join(', ')} for an idle human`);
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
  for (const pl of all) await pl.page.keyboard.press('KeyN');
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
    // Both bots aim at the nearest zombie, so the one standing nearer the spawns can take every kill
    // (CI once saw 0 against 19). The point is that each client's kills reach the host, so after 15 s
    // a client still without a kill gets the zombies to itself.
    let fighters = [c1, c2];
    if (credit && Date.now() - t0 > 15e3) {
      if (credit.kills1 > 0 && credit.kills2 === 0) fighters = [c2];
      else if (credit.kills2 > 0 && credit.kills1 === 0) fighters = [c1];
    }
    await runBots(fighters, 1500, null);
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

  // back to the lobby through the host's pause menu: End Game → confirm. A client's pause
  // menu has no End Game, and both show the room code with an invite-link button.
  await c1.page.keyboard.press('Escape');
  await waitFor(c1, () => !document.querySelector('#pause').hidden, null, 'the client pause menu');
  const cPause = await c1.page.evaluate(() => ({
    end: !document.querySelector('#pause-end').hidden, invite: !document.querySelector('#pause-invite').hidden,
    code: document.querySelector('#pause-code').textContent, want: window.__HH.session.code,
  }));
  expect(!cPause.end, 'a client\'s pause menu offers End Game');
  expect(cPause.invite && cPause.code === cPause.want, `client pause menu invite: ${JSON.stringify(cPause)}`);
  await c1.page.keyboard.press('Escape');
  await host.page.keyboard.press('Escape');
  await waitFor(host, () => !document.querySelector('#pause').hidden && !document.querySelector('#pause-end').hidden, null, 'the host pause menu with End Game');
  await host.page.click('#pause-end');
  await waitFor(host, () => !document.querySelector('#dlg-confirm').hidden, null, 'the End Game confirmation');
  const confirmTitle = await host.page.textContent('#confirm-title');
  expect(confirmTitle === 'Return everyone to the lobby?', `End Game confirmation reads "${confirmTitle}"`);
  await host.page.click('#confirm-yes');
  for (const pl of [host, c1]) {
    await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden && document.querySelector('#screen-game').hidden && !window.__HH.session.inGame, null, 'the lobby after End Game');
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

  await host.page.keyboard.press('KeyN');
  await early.page.keyboard.press('KeyN');
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

  // SHOP opens on the touch, and the tap's trailing click must not buy the card that
  // appears under the finger.
  await pl.page.evaluate(() => {
    const s = window.__HH.session;
    window.__e2eBuys = 0;
    const orig = s.buy.bind(s);
    s.buy = (id) => {
      window.__e2eBuys++;
      return orig(id);
    };
  });
  await pl.page.tap('.touch-btn-shop');
  const shopShown = () => {
    const b = document.querySelector('#shop-root .shop-backdrop');
    return !!b && !b.hidden;
  };
  await waitFor(pl, shopShown, null, 'the shop after tapping SHOP');
  await sleep(700);
  expect(await pl.page.evaluate(() => window.__e2eBuys) === 0, 'tapping SHOP bought the item under the finger');
  await pl.page.tap('#shop-root .shop-close');
  await waitFor(pl, () => document.querySelector('#shop-root .shop-backdrop').hidden, null, 'the shop to close');

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

// ---- first person --------------------------------------------------------------------------

/** Signed smallest angle b - a. */
function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Wait for a first-person game: view non-null, the UI's look initialised, the 3D renderer up. */
async function waitFpsGame(pl, nPlayers, what) {
  await waitFor(pl, (n) => {
    const H = window.__HH;
    const v = H.getView && H.getView();
    const L = H.getLook && H.getLook();
    return !document.querySelector('#screen-game').hidden && !!v && v.players.length === n
      && v.players.some((p) => p.id === H.session.localId) && !!L && L.ready;
  }, nPlayers, what || `the first-person game with ${nPlayers} players`, 60e3);
  const info = await pl.page.evaluate(() => ({
    view: window.__HH.view, mode: window.__HH.renderer && window.__HH.renderer.mode,
    overlays: document.querySelectorAll('.hh-overlay3d').length,
    hudView: document.querySelector('#hud').dataset.view,
    compass: !!document.querySelector('.hud-compass') && !document.querySelector('.hud-compass').hidden,
  }));
  expect(info.view === 'fps' && info.mode === 'fps', `[${pl.tag}] expected the first-person renderer, got view ${info.view} / mode ${info.mode}`);
  expect(info.overlays === 1, `[${pl.tag}] ${info.overlays} 3D overlay canvases (expected 1)`);
  expect(info.hudView === 'fps' && info.compass, `[${pl.tag}] first-person HUD missing (view ${info.hudView}, compass ${info.compass})`);
}

/**
 * Turn the local camera to `yaw` (and level it) through the __HH.look test hook. Without
 * `wait` it feeds at most one correction per game frame (a second one before the frame
 * applies the first would overshoot).
 */
async function turnTo(pl, yaw, { wait = true } = {}) {
  await pl.page.evaluate(({ target, k }) => {
    const H = window.__HH;
    const L = H.getLook();
    if (window.__e2eLookFrame === L.frames) return;
    window.__e2eLookFrame = L.frames;
    const d = Math.atan2(Math.sin(target - L.yaw), Math.cos(target - L.yaw));
    // +dy looks down: dy = pitch / k levels the camera
    H.look(d / k, L.pitch / k);
  }, { target: yaw, k: LOOK_RAD_PER_PX });
  if (!wait) return;
  await waitFor(pl, (t) => {
    const L = window.__HH.getLook();
    return Math.abs(Math.atan2(Math.sin(t - L.yaw), Math.cos(t - L.yaw))) < 0.02 && Math.abs(L.pitch) < 0.02;
  }, yaw, `the camera to turn to ${yaw.toFixed(2)} rad`, 20e3);
}

/**
 * The most open of 16 headings from the local player's predicted position: simulated with
 * the shared movement code for `ticks` ticks. @returns {{ yaw, dist, from }}
 */
function freeHeading(pl, ticks) {
  return pl.page.evaluate(async (n) => {
    const [{ createCollisionWorld, stepPlayerMovement }, { DT }] = await Promise.all([
      import('/js/shared/movement.js'), import('/js/shared/constants.js'),
    ]);
    const H = window.__HH;
    const v = H.getView();
    const me = v.players.find((p) => p.id === H.session.localId);
    const from = H.session.getPredictedLocal() || me;
    const world = createCollisionWorld(H.session.getMap());
    world.setBarricades(v.barricades || []);
    let best = null;
    for (let i = 0; i < 16; i++) {
      const yaw = -Math.PI + (i / 16) * Math.PI * 2;
      const p = { x: from.x, y: from.y, state: 'alive', stamina: 100, sprintLock: false, speedMult: 1, moveMult: 1 };
      const cmd = { moveX: Math.cos(yaw), moveY: Math.sin(yaw), sprint: false };
      for (let t = 0; t < n; t++) stepPlayerMovement(p, cmd, DT, world);
      // straightness matters as much as distance: sliding along a wall bends the path
      const dx = p.x - from.x, dy = p.y - from.y;
      const along = dx * Math.cos(yaw) + dy * Math.sin(yaw);
      if (!best || along > best.dist) best = { yaw, dist: along, from: { x: from.x, y: from.y } };
    }
    return best;
  }, ticks);
}

/** Where `pid` is in `pl`'s view once it stops moving (net interpolation settles). */
async function settledPos(pl, pid) {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const p = (await readState(pl)).players.find((q) => q.id === pid);
    if (prev && Math.abs(p.x - prev.x) < 0.05 && Math.abs(p.y - prev.y) < 0.05) return p;
    prev = p;
    await sleep(200);
  }
  return prev;
}

/**
 * Hold W until `observer` sees `pid` about `dist` px from where it started (at a few
 * frames per second a fixed hold time says little about how long W was sampled as held);
 * returns start/end/yaw as `observer` saw them.
 */
async function walkForward(pl, observer, pid, dist) {
  const yaw = (await pl.page.evaluate(() => window.__HH.getLook())).yaw;
  const a = await settledPos(observer, pid);
  await pl.page.keyboard.down('w');
  const t0 = Date.now();
  while (Date.now() - t0 < 12e3) {
    const p = (await readState(observer)).players.find((q) => q.id === pid);
    if (Math.hypot(p.x - a.x, p.y - a.y) >= dist) break;
    await sleep(60);
  }
  await pl.page.keyboard.up('w');
  const b = await settledPos(observer, pid);
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const along = d > 0 ? (dx * Math.cos(yaw) + dy * Math.sin(yaw)) / d : 0;
  return { a, b, d, along, yaw };
}

/**
 * Walk into the nearest car / van / container with a clear run to it and climb onto it:
 * hold W and Space facing it until the climb starts (let go at once, so the player
 * doesn't walk off the far side), then check the local player stands on its roof and the
 * first-person camera rose with it. @returns {{ kind, top, z, cam, dist }}
 */
async function climbOnto(pl) {
  const pickTarget = () => pl.page.evaluate(async () => {
    const [{ createCollisionWorld, mantleSpot }, { closestPointOnObb, MASK_MOVE }] = await Promise.all([
      import('/js/shared/movement.js'), import('/js/shared/geom.js'),
    ]);
    const H = window.__HH;
    const v = H.getView();
    const me = H.session.getPredictedLocal() || v.players.find((p) => p.id === H.session.localId);
    const world = createCollisionWorld(H.session.getMap());
    world.setBarricades(v.barricades || []);
    let best = null;
    const cp = { x: 0, y: 0 }, spot = { x: 0, y: 0 };
    for (const c of world.colliders) {
      if (!c.stand || c.top > 88 || c.top < 36) continue;
      closestPointOnObb(c, me.x, me.y, cp);
      const d = Math.hypot(cp.x - me.x, cp.y - me.y);
      if (d < 30 || d > 900 || (best && d >= best.dist)) continue;
      // a clear run up to it, and room on top
      const k = (d - 24) / d;
      if (!world.lineOfMovement(me.x, me.y, me.x + (cp.x - me.x) * k, me.y + (cp.y - me.y) * k, 17, MASK_MOVE)) continue;
      mantleSpot(c, cp.x, cp.y, 18, spot);
      if (world.circleBlockedAt(spot.x, spot.y, 16, c.top)) continue;
      best = { ci: c.ci, kind: c.ref.kind, top: c.top, x: c.x, y: c.y, dist: d, yaw: Math.atan2(c.y - me.y, c.x - me.x) };
    }
    return best;
  });
  // Up to three tries: a zombie that shoves the player off the line, or a slow frame, costs one try,
  // not the whole scenario (each try picks the nearest climbable thing afresh).
  let target = null;
  let started = false;
  for (let attempt = 0; attempt < 3 && !started; attempt++) {
    target = await pickTarget();
    expect(target, 'test setup: no car, van or container within reach of a clear run');
    await turnTo(pl, target.yaw);
    await setKeys(pl, new Set(['w', 'Space']));
    try {
      started = await waitFor(pl, () => {
        const H = window.__HH;
        const p = H.session.getPredictedLocal();
        const v = H.session.getView();
        const me = v && v.players.find((q) => q.id === H.session.localId);
        return (me && me.climbT > 0) || (p && p.climbT > 0) ? true : false;
      }, null, `a climb onto the ${target.kind} ${target.dist.toFixed(0)} px ahead`, 9e3);
    } catch (err) {
      if (attempt === 2) throw err;
    } finally {
      await releaseAll(pl);
    }
  }
  expect(started, 'no climb');
  const up = await waitFor(pl, () => {
    const H = window.__HH;
    const v = H.session.getView();
    const me = v && v.players.find((q) => q.id === H.session.localId);
    return me && !(me.climbT > 0) && me.vzq === 0 ? { z: me.z } : false;
  }, null, 'the end of the climb', 10e3);
  // a few frames later the camera has settled at eye height above the roof
  await sleep(600);
  const cam = await pl.page.evaluate(() => {
    const H = window.__HH;
    const v = H.session.getView();
    const me = v.players.find((q) => q.id === H.session.localId);
    return { z: me.z, cam: H.renderer && H.renderer.debug ? H.renderer.debug.camera.position.y : 0 };
  });
  return { kind: target.kind, top: target.top, z: up.z, zNow: cam.z, cam: cam.cam, dist: target.dist };
}

/** g. Solo in first person. */
async function scenarioFpsSolo(sc) {
  const pl = await sc.player('fps', { view: 'fps', quality: 'low', context: { viewport: FPS_VIEWPORT } });
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Pointman', cls: 'soldier' });
  await pl.page.click('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  // (building the 3D world blocks the page, longer on a busy machine: don't wait on the click)
  await pl.page.evaluate(() => setTimeout(() => document.querySelector('#btn-start').click(), 0));
  await waitFpsGame(pl, 1);
  const me0 = (await readState(pl)).me;
  const look0 = await pl.page.evaluate(() => window.__HH.getLook());
  const angle0 = await pl.page.evaluate(() => window.__HH.getView().players[0].angle);
  expect(Math.abs(angleDiff(look0.yaw, angle0)) < 0.05, `initial yaw ${look0.yaw.toFixed(2)} should be the snapshot angle ${angle0.toFixed(2)}`);

  // Pointer lock: the Start click may already have captured the mouse; else click the game.
  const { width, height } = FPS_VIEWPORT;
  // (a busy page may answer the raw-input lock request only after the click's user
  // activation expired, so the fallback lock is refused: like a player, click again)
  for (let attempt = 0; ; attempt++) {
    if (!(await pl.page.evaluate(() => window.__HH.getLook().locked))) await pl.page.mouse.click(width / 2, height / 2);
    try {
      await waitFor(pl, () => window.__HH.getLook().locked, null, 'pointer lock after clicking the game', 8000);
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
  await sc.screenshots('-start', FPS_SHOT_MS);
  // Ready now: wave 1 spawns far out and walks in while we test walking and the pause menu.
  await pl.page.keyboard.press('KeyN');
  await waitFor(pl, () => window.__HH.getView().phase === 'wave', null, 'wave 1 after N (ready)', 10e3);

  // W walks along the facing direction (turned to the most open heading first).
  const free = await freeHeading(pl, 150);
  expect(free.dist > 250, `test setup: no open heading around the spawn (${free.dist.toFixed(0)} px)`);
  await turnTo(pl, free.yaw);
  const w = await walkForward(pl, pl, me0.id, 110);
  log(`    fps walk: yaw ${w.yaw.toFixed(2)}, moved ${w.d.toFixed(1)} px, along the view ${(w.along * 100).toFixed(1)} %`);
  expect(w.d > 90, `W barely moved the player (${w.d.toFixed(1)} px)`);
  expect(w.along > 0.95, `W moved the player off the view direction (cos ${w.along.toFixed(3)})`);

  // Space jumps: the local player leaves the ground and the first-person camera rises with it.
  const jumpT0 = Date.now();
  const hop = await jump(pl, { camera: true });
  log(`    fps jump: peak ${hop.z.toFixed(1)} units, camera up to ${hop.cam.toFixed(1)} (eye 52), landed (${((Date.now() - jumpT0) / 1000).toFixed(1)} s)`);

  // Space into a car (van, container): the player climbs onto its roof and the camera rises.
  const climbT0 = Date.now();
  const cl = await climbOnto(pl);
  log(`    fps climb: onto a ${cl.kind} ${cl.dist.toFixed(0)} px away, feet at ${cl.z.toFixed(1)} (top ${cl.top.toFixed(1)}), camera at ${cl.cam.toFixed(1)} (${((Date.now() - climbT0) / 1000).toFixed(1)} s)`);
  expect(Math.abs(cl.z - cl.top) < 0.01, `the climb should end on the roof (z ${cl.z.toFixed(2)}, top ${cl.top.toFixed(2)})`);
  expect(Math.abs(cl.zNow - cl.top) < 0.01, `the player should stay on the roof (z ${cl.zNow.toFixed(2)})`);
  expect(cl.cam > 52 + cl.top - 8, `the camera should ride on the roof (${cl.cam.toFixed(1)} for a ${cl.top.toFixed(0)} roof)`);
  await sc.screenshots('-climb', FPS_SHOT_MS);

  // Losing the pointer lock (Esc, alt-tab) opens the pause menu; resuming captures it again.
  await pl.page.evaluate(() => document.exitPointerLock());
  await waitFor(pl, () => !document.querySelector('#pause').hidden, null, 'the pause menu after the pointer lock was lost', 8000);
  const resume = (await pl.page.textContent('#pause-resume')).trim();
  expect(/click to resume/i.test(resume), `pause menu should say "Click to Resume", says "${resume}"`);
  await pl.page.click('#pause-resume');
  await waitFor(pl, () => document.querySelector('#pause').hidden && window.__HH.getLook().locked, null, 'the lock back after Click to Resume', 8000);

  // Fight: turn toward the nearest zombie using the view data, hold the trigger.
  let kills = 0, aimed = 0, seen = 0, maxZ = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 90e3) {
    const t = await pl.page.evaluate(() => {
      const H = window.__HH;
      const v = H.getView();
      const me = v.players.find((p) => p.id === H.session.localId);
      const at = H.session.getPredictedLocal() || me;
      let best = null, bd = Infinity;
      for (const z of v.zombies) {
        const d = Math.hypot(z.x - at.x, z.y - at.y);
        if (d < bd) {
          bd = d;
          best = z;
        }
      }
      const L = H.getLook();
      // is the target where the camera looks? (projected by the 3D renderer)
      const sp = best ? H.renderer.worldToScreen(best.x, best.y, 30) : null;
      return {
        kills: me.kills, n: v.zombies.length, dist: bd, yaw: L.yaw,
        want: best ? Math.atan2(best.y - at.y, best.x - at.x) : null,
        onScreen: !!(sp && sp.visible), locked: L.locked,
      };
    });
    kills = t.kills;
    maxZ = Math.max(maxZ, t.n);
    if (kills >= 1) break;
    const want = new Set();
    if (t.want !== null) {
      const facing = Math.abs(angleDiff(t.yaw, t.want)) < 0.1;
      if (facing) {
        aimed++;
        if (t.onScreen) seen++;
      }
      await turnTo(pl, t.want, { wait: false });
      // Wave 1 spawns far away: walk at the nearest zombie (W, we face it) until in range.
      if (facing && t.dist > 650) {
        want.add('w');
        want.add('Shift');
      }
      if (t.dist < 1050 && !pl.mouseDown) {
        if (!t.locked) await pl.page.mouse.click(width / 2, height / 2);
        await pl.page.mouse.down();
        pl.mouseDown = true;
      }
    } else if (pl.mouseDown) {
      await pl.page.mouse.up();
      pl.mouseDown = false;
    }
    await setKeys(pl, want);
    await sleep(150);
  }
  await releaseAll(pl);
  await sc.screenshots('-fight', FPS_SHOT_MS);
  log(`    fps fight: kills ${kills}, max zombies ${maxZ}, aimed ${aimed}× (target on screen ${seen}×)`);
  expect(maxZ > 0, 'no zombies ever appeared');
  expect(kills > 0, 'turning toward zombies and firing killed nothing in 90 s');
  expect(aimed === 0 || seen / aimed > 0.8, `the zombie we aimed at was on screen only ${seen}/${aimed} times`);

  // End Game → lobby → a second game: the old renderer, overlay and loop are gone.
  await pl.page.evaluate(() => document.exitPointerLock());
  await waitFor(pl, () => !document.querySelector('#pause').hidden, null, 'the pause menu', 8000);
  await pl.page.click('#pause-end');
  await pl.page.click('#confirm-yes');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the lobby after End Game', 15e3);
  const gone = await pl.page.evaluate(() => ({ overlays: document.querySelectorAll('.hh-overlay3d').length, renderer: window.__HH.renderer }));
  expect(gone.overlays === 0 && !gone.renderer, `the first-person renderer outlived its game: ${JSON.stringify(gone)}`);
  await pl.page.click('#btn-start');
  await waitFpsGame(pl, 1, 'the second first-person game');
  const m = await measureLoop(pl);
  // (software WebGL may manage a single frame in the 1 s window: judge only real samples)
  expect(m.frames < 3 || (m.ratio > 0.5 && m.ratio < 1.5), `second game loop ran ${m.calls} updates in ${m.frames} frames`);
  await sc.screenshots('-second', FPS_SHOT_MS);
}

/** h. Two players over the relay, both in first person. */
async function scenarioFpsRelay(sc) {
  const opts = { view: 'fps', quality: 'low', context: { viewport: FPS_VIEWPORT } };
  const { host, invite } = await hostOnline(sc, 'fps-host', { name: 'Alpha', cls: 'soldier', color: 0 }, opts);
  const client = await joinByLink(sc, 'fps-client', invite, opts);
  for (const pl of [host, client]) {
    await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden && document.querySelectorAll('#roster .roster-row').length === 2, null, 'a lobby roster of 2', 20e3);
  }
  await client.page.click('#btn-ready');
  await waitFor(host, () => window.__HH.session.roster.filter((r) => r.ready).length === 1, null, 'the client ready');
  await host.page.evaluate(() => setTimeout(() => document.querySelector('#btn-start').click(), 0));
  for (const pl of [host, client]) await waitFpsGame(pl, 2);
  const ids = {
    host: await host.page.evaluate(() => window.__HH.session.localId),
    client: await client.page.evaluate(() => window.__HH.session.localId),
  };

  // Each camera turned toward the other survivor has them in view.
  const sees = async (pl, other) => {
    const st = await readState(pl);
    const me = st.me, o = st.players.find((p) => p.id === other);
    await turnTo(pl, Math.atan2(o.y - me.y, o.x - me.x));
    await sleep(500);
    return pl.page.evaluate((id) => {
      const H = window.__HH;
      const p = H.getView().players.find((q) => q.id === id);
      const s = H.renderer.worldToScreen(p.x, p.y, 40);
      return { ...s, w: innerWidth, h: innerHeight };
    }, other);
  };
  const hs = await sees(host, ids.client);
  const cs = await sees(client, ids.host);
  await sc.screenshots('-facing', FPS_SHOT_MS);
  log(`    fps relay: host sees the client at (${hs.x.toFixed(0)}, ${hs.y.toFixed(0)}) visible ${hs.visible}; client sees the host at (${cs.x.toFixed(0)}, ${cs.y.toFixed(0)}) visible ${cs.visible}`);
  expect(hs.visible && Math.abs(hs.x - hs.w / 2) < hs.w * 0.2, `the client isn't in the middle of the host's view: ${JSON.stringify(hs)}`);
  expect(cs.visible && Math.abs(cs.x - cs.w / 2) < cs.w * 0.2, `the host isn't in the middle of the client's view: ${JSON.stringify(cs)}`);

  // The client turns to an open heading; the host sees its angle, then its W walk along it.
  const free = await freeHeading(client, 150);
  expect(free.dist > 250, `test setup: no open heading around the client (${free.dist.toFixed(0)} px)`);
  await turnTo(client, free.yaw);
  await waitFor(host, ({ id, yaw }) => {
    const p = window.__HH.getView().players.find((q) => q.id === id);
    return Math.abs(Math.atan2(Math.sin(yaw - p.angle), Math.cos(yaw - p.angle))) < 0.05;
  }, { id: ids.client, yaw: free.yaw }, 'the host to see the client\'s new facing', 15e3);
  const w = await walkForward(client, host, ids.client, 110);
  // Prediction and host must agree once both have every input. "Settled" on the host is two equal
  // readings 200 ms apart, which a gap in its snapshots can fake while the client's last moves are
  // still on the way, so compare until they agree (or give up after a few seconds).
  let pred = null, hostPos = w.b, off = Infinity;
  for (let t0 = Date.now(); Date.now() - t0 < 6e3;) {
    pred = await client.page.evaluate(() => window.__HH.session.getPredictedLocal());
    hostPos = (await readState(host)).players.find((q) => q.id === ids.client);
    off = Math.hypot(pred.x - hostPos.x, pred.y - hostPos.y);
    if (off < 4) break;
    await sleep(200);
  }
  log(`    fps relay walk: client yaw ${w.yaw.toFixed(2)}, host saw it move ${w.d.toFixed(1)} px, along its view ${(w.along * 100).toFixed(1)} %, prediction off by ${off.toFixed(1)} px`);
  expect(w.d > 90, `the host saw the client move only ${w.d.toFixed(1)} px`);
  expect(w.along > 0.95, `the client's W moved it off its own view direction on the host (cos ${w.along.toFixed(3)})`);
  expect(off < 4, `client prediction disagrees with the host after the walk (${off.toFixed(1)} px)`);
  await sc.screenshots('-walked', FPS_SHOT_MS);

  // The client jumps: its own view shows it at once, the host's view of it follows.
  await host.page.evaluate(() => {
    window.__e2eMateZ = 0;
    window.__e2eMateTimer = setInterval(() => {
      // the host's own session view (fresh on every call; the page may draw only a few frames a second)
      const H = window.__HH;
      const v = H.session && H.session.getView();
      for (const p of (v ? v.players : [])) if (p.id !== H.session.localId) window.__e2eMateZ = Math.max(window.__e2eMateZ, p.z || 0);
    }, 16);
  });
  const hop = await jump(client);
  const seen = await waitFor(host, () => (window.__e2eMateZ > 10 ? window.__e2eMateZ : false), null, 'the host to see the client jump', 10e3);
  await host.page.evaluate(() => clearInterval(window.__e2eMateTimer));
  log(`    fps relay jump: client peak ${hop.z.toFixed(1)}, the host saw it ${seen.toFixed(1)} units up`);
}

/**
 * i. Evac Run. Top-down (software WebGL draws the big map at well under a frame per second
 * here, and a host that renders that rarely feeds its own survivor idle input): the lobby's
 * Mode row and the Evac Run-only Harlan County card, two bots, the announcement (zone panel,
 * banner), the player walks toward the zone, and once the wave locks the circle the player
 * outside gets the warning and loses health to the blight. Then a first-person game on
 * Harlan County checks the 3D zone wall, the compass and the zone panel.
 */
async function scenarioZone(sc) {
  const pl = await sc.player('zone');
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Runner', cls: 'scout' });
  await pl.page.click('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  const settings = () => pl.page.evaluate(() => ({ ...window.__HH.session.settings }));
  // The Mode row: Evac Run plays on the highway too; Harlan County only plays Evac Run.
  expect((await settings()).mode === 'defend', 'the lobby should start in Defend');
  await pl.page.click('#opt-mode .seg-btn[data-value="zone"]');
  await waitFor(pl, () => window.__HH.session.settings.mode === 'zone', null, 'Evac Run picked');
  expect((await settings()).mapId === 'highway', 'Evac Run should keep the highway');
  const objDisabled = await pl.page.$$eval('#opt-objective .seg-btn', (bs) => bs.every((b) => b.getAttribute('aria-disabled') === 'true'));
  expect(objDisabled, 'the objective toggle should be disabled in Evac Run');
  await pl.page.click('#opt-mode .seg-btn[data-value="defend"]');
  await waitFor(pl, () => window.__HH.session.settings.mode === 'defend', null, 'Defend picked again');
  await pl.page.click('.map-card[data-map="harlan"]');
  await waitFor(pl, () => window.__HH.session.settings.mapId === 'harlan', null, 'Harlan County picked');
  expect((await settings()).mode === 'zone', 'picking Harlan County should switch to Evac Run');
  const tag = await pl.page.textContent('.map-card[data-map="harlan"] .map-modes');
  expect(/evac run . campaign only/i.test(tag), `the Harlan County card should say it plays Evac Run and Campaign only ("${tag}")`);
  await pl.page.click('#opt-mode .seg-btn[data-value="defend"]');
  await waitFor(pl, () => window.__HH.session.settings.mode === 'defend', null, 'Defend on Harlan County');
  expect((await settings()).mapId !== 'harlan', 'Defend should leave Harlan County for a defend map');
  await pl.page.click('.map-card[data-map="harlan"]');
  await waitFor(pl, () => window.__HH.session.settings.mapId === 'harlan' && window.__HH.session.settings.mode === 'zone', null, 'Harlan County in Evac Run');
  for (let i = 0; i < 2; i++) await pl.page.click('#btn-add-bot');
  await waitFor(pl, () => document.querySelectorAll('#roster .roster-row').length === 3, null, 'three roster rows');
  await sc.screenshots('-lobby');
  await pl.page.click('#btn-start');
  await waitFor(pl, () => !document.querySelector('#screen-game').hidden && window.__HH.getView() && window.__HH.getView().players.length === 3, null, 'the Evac Run', 60e3);

  // The announcement: a zone in the snapshot, the zone panel naming it.
  const z0 = await pl.page.evaluate(() => {
    const H = window.__HH;
    const v = H.getView();
    return { zone: v.zone, name: v.zone ? H.session.getMap().pois[v.zone.poi].name : '', phase: v.phase, objective: v.objective };
  });
  expect(z0.zone && z0.zone.stage === 0 && z0.phase === 'prep', `a zone should be announced in prep: ${JSON.stringify(z0.zone)}`);
  expect(z0.objective === null, 'Evac Run has no objective to defend');
  const panel = await waitFor(pl, () => {
    const el = document.querySelector('#hud .hud-zone');
    return el && !el.hidden && el.textContent.length > 10 ? el.textContent : false;
  }, null, 'the zone panel', 20e3);
  expect(panel.toUpperCase().includes(z0.name.toUpperCase()), `the zone panel should name ${z0.name}: "${panel}"`);
  expect(/MOVE TO/i.test(panel) && /LOCKS IN/i.test(panel), `the zone panel should say where to go and when: "${panel}"`);
  log(`    zone: announced ${z0.name} (r ${z0.zone.r}), panel "${panel.replace(/\s+/g, ' ').trim()}"`);
  // Keep the bots alive for the rest of the test (the host runs the sim in this page).
  await pl.page.evaluate(() => {
    const g = window.__HH.session.game;
    window.__e2eGod = setInterval(() => { for (const p of g.players) if (p.bot) p.hp = p.maxHp; }, 200);
  });

  // Walk toward the zone: the WASD combination that gets closest in 10 s of walking
  // (simulated with the shared movement code), held down.
  const edge = () => pl.page.evaluate(() => {
    const H = window.__HH;
    const z = H.getView().zone;
    const me = H.session.getPredictedLocal() || H.getView().players.find((p) => p.id === H.session.localId);
    return Math.hypot(me.x - z.x, me.y - z.y) - z.r;
  });
  const combos = [['d'], ['d', 's'], ['s'], ['a', 's'], ['a'], ['a', 'w'], ['w'], ['d', 'w']];
  const best = await pl.page.evaluate(async ({ combos, n }) => {
    const [{ createCollisionWorld, stepPlayerMovement }, { DT }] = await Promise.all([
      import('/js/shared/movement.js'), import('/js/shared/constants.js'),
    ]);
    const H = window.__HH;
    const z = H.getView().zone;
    const from = H.session.getPredictedLocal();
    const world = createCollisionWorld(H.session.getMap());
    let pick = null;
    combos.forEach((keys, i) => {
      const mx = (keys.includes('d') ? 1 : 0) - (keys.includes('a') ? 1 : 0), my = (keys.includes('s') ? 1 : 0) - (keys.includes('w') ? 1 : 0);
      const l = Math.hypot(mx, my);
      const p = { x: from.x, y: from.y, state: 'alive', stamina: 100, sprintLock: false, speedMult: 1, moveMult: 1 };
      const cmd = { moveX: mx / l, moveY: my / l, sprint: false };
      for (let t = 0; t < n; t++) stepPlayerMovement(p, cmd, DT, world);
      const gain = Math.hypot(from.x - z.x, from.y - z.y) - Math.hypot(p.x - z.x, p.y - z.y);
      if (!pick || gain > pick.gain) pick = { i, gain };
    });
    return pick;
  }, { combos, n: 600 });
  expect(best.gain > 250, `test setup: no way toward the zone from the start (${best.gain.toFixed(0)} px)`);
  const e0 = await edge();
  await setKeys(pl, new Set(combos[best.i]));
  const tw = Date.now();
  let e1 = e0;
  while (Date.now() - tw < 25e3) {
    e1 = await edge();
    if (e0 - e1 > 300) break;
    await sleep(150);
  }
  await releaseAll(pl);
  log(`    zone walk (${combos[best.i].join('+')}): ${e0.toFixed(0)} → ${e1.toFixed(0)} px from the zone's edge`);
  expect(e0 - e1 > 200, `walking toward the zone barely closed in (${e0.toFixed(0)} → ${e1.toFixed(0)} px)`);
  await sc.screenshots('-move');

  // The wave locks the circle: the player, still outside, is warned and hurt by the blight.
  await pl.page.evaluate(() => { window.__HH.session.game.timer = 0; });
  await waitFor(pl, () => {
    const v = window.__HH.getView();
    return v.phase === 'wave' && v.zone && v.zone.stage >= 1;
  }, null, 'the wave to lock the zone', 20e3);
  const hurt = await waitFor(pl, () => {
    const H = window.__HH;
    const g = H.session.game;
    const warn = document.querySelector('#hud .zone-warn');
    const me = g.getPlayer(H.session.localId);
    return warn && !warn.hidden && g.zone.stats.fog > 3 ? { fog: g.zone.stats.fog, hp: me.hp, state: me.state, text: warn.textContent } : false;
  }, null, 'the outside warning and blight damage', 30e3);
  log(`    zone blight: ${hurt.fog.toFixed(1)} hp taken outside, hp ${Math.round(hurt.hp)} (${hurt.state}), warning "${hurt.text.replace(/\s+/g, ' ').trim()}"`);
  expect(/OUTSIDE THE SAFE ZONE/i.test(hurt.text), `the warning should say so: "${hurt.text}"`);
  await sc.screenshots('-blight');
  await pl.page.evaluate(() => clearInterval(window.__e2eGod));
  await sc.close(pl);

  // First person on Harlan County: the zone wall in the scene, the compass, the panel.
  const fp = await sc.player('zone-fps', { view: 'fps', quality: 'low', context: { viewport: FPS_VIEWPORT } });
  fp.url = sc.env.relay.url;
  await titleSetup(fp, { name: 'Pointman', cls: 'soldier' });
  await fp.page.click('#btn-solo');
  await waitFor(fp, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  await fp.page.click('.map-card[data-map="harlan"]');
  await waitFor(fp, () => window.__HH.session.settings.mode === 'zone', null, 'Harlan County in Evac Run');
  // (building the big map's 3D world blocks the page for a while: don't wait on the click)
  await fp.page.evaluate(() => setTimeout(() => document.querySelector('#btn-start').click(), 0));
  await waitFor(fp, () => {
    const H = window.__HH;
    const L = H.getLook && H.getLook();
    return !document.querySelector('#screen-game').hidden && !!(H.getView && H.getView()) && !!L && L.ready && L.frames >= 3;
  }, null, 'the first-person Evac Run', 180e3);
  const fps = await fp.page.evaluate(() => {
    const H = window.__HH;
    const scene = H.renderer.debug && H.renderer.debug.scene;
    const wall = scene && scene.getObjectByName('zone-wall');
    const zone = scene && scene.getObjectByName('zone');
    const panelEl = document.querySelector('#hud .hud-zone');
    return {
      view: H.view, wall: !!wall, shown: !!zone && zone.visible, r: wall ? wall.scale.x : 0, zoneR: H.getView().zone.r,
      compass: !!document.querySelector('.hud-compass') && !document.querySelector('.hud-compass').hidden,
      panel: panelEl && !panelEl.hidden ? panelEl.textContent : '', calls: H.renderer.stats.drawCalls,
    };
  });
  log(`    zone fps: wall ${fps.wall} (r ${fps.r}), ${fps.calls} draw calls, panel "${fps.panel.replace(/\s+/g, ' ').trim()}"`);
  expect(fps.view === 'fps', `expected the first-person view, got ${fps.view}`);
  expect(fps.wall && fps.shown && Math.abs(fps.r - fps.zoneR) < 1, `the zone wall should stand on the announced circle: ${JSON.stringify(fps)}`);
  expect(fps.compass, 'no compass in the first-person HUD');
  expect(/MOVE TO/i.test(fps.panel), `the first-person zone panel: "${fps.panel}"`);
  await sc.screenshots('-fps', FPS_SHOT_MS);
}

/**
 * j: time of day. The lobby's Time row (Night default, Day), the choice persisted in the
 * prefs, then a first-person solo game by day (no console errors, the day atmosphere in
 * the scene: sun on, flashlight off) and a classic top-down game by day.
 */
async function scenarioDay(sc) {
  const pl = await sc.player('day', { view: 'fps', quality: 'low', context: { viewport: FPS_VIEWPORT } });
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Sunny', cls: 'soldier' });
  await pl.page.click('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  const settings = () => pl.page.evaluate(() => ({ ...window.__HH.session.settings }));
  expect((await settings()).time === 'night', 'the lobby should start at Night');
  const labels = await pl.page.$$eval('#opt-time .seg-btn', (bs) => bs.map((b) => b.textContent.trim()));
  expect(labels.join() === 'Night,Day', `the Time row should offer Night and Day: ${labels}`);
  expect((await pl.page.$eval('#opt-time .seg-btn[data-value="night"]', (b) => b.getAttribute('aria-checked'))) === 'true', 'Night should be selected first');
  await pl.page.click('#opt-time .seg-btn[data-value="day"]');
  await waitFor(pl, () => window.__HH.session.settings.time === 'day', null, 'Day picked');
  expect((await pl.page.$eval('#opt-time .seg-btn[data-value="day"]', (b) => b.getAttribute('aria-checked'))) === 'true', 'Day should show as selected');
  const saved = await pl.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).lobby.time, PREFS_KEY);
  expect(saved === 'day', `the choice should be saved in the prefs (${saved})`);
  await pl.page.click('#opt-time .seg-btn[data-value="night"]');
  await waitFor(pl, () => window.__HH.session.settings.time === 'night', null, 'Night picked again');
  await pl.page.click('#opt-time .seg-btn[data-value="day"]');
  await waitFor(pl, () => window.__HH.session.settings.time === 'day', null, 'Day picked again');
  await pl.page.click('.map-card[data-map="checkpoint"]');
  await waitFor(pl, () => window.__HH.session.settings.mapId === 'checkpoint', null, 'Checkpoint Delta picked');
  expect((await settings()).time === 'day', 'the time should survive a map change');
  await sc.screenshots('-lobby');
  await pl.page.evaluate(() => setTimeout(() => document.querySelector('#btn-start').click(), 0));
  await waitFor(pl, () => {
    const H = window.__HH;
    const L = H.getLook && H.getLook();
    return !document.querySelector('#screen-game').hidden && !!(H.getView && H.getView()) && !!L && L.ready && L.frames >= 3;
  }, null, 'the first-person day game', 180e3);
  const info = await pl.page.evaluate(() => {
    const H = window.__HH;
    const d = H.renderer.debug;
    const sc3 = d && d.scene;
    return {
      view: H.view, time: d && d.ctx.time, fog: sc3 && sc3.fog && sc3.fog.color.getHexString(),
      flash: d && d.lights.flashlight.intensity, sun: d && d.lights.moon.intensity, game: H.session.game.settings.time,
    };
  });
  log(`    day fps: view ${info.view}, time ${info.time}, fog #${info.fog}, sun ${info.sun}, flashlight ${info.flash}`);
  expect(info.view === 'fps' && info.time === 'day' && info.game === 'day', `the game should render the day: ${JSON.stringify(info)}`);
  expect(info.flash === 0, 'the flashlight should be off by day');
  expect(info.sun > 2, 'the sun should be bright');
  await sc.screenshots('-fps', FPS_SHOT_MS);
  await sc.close(pl);

  // The same choice in the classic top-down view
  const td = await sc.player('day-td');
  td.url = sc.env.relay.url;
  await titleSetup(td, { name: 'Sunny', cls: 'medic' });
  await td.page.click('#btn-solo');
  await waitFor(td, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby (top-down)');
  await td.page.click('#opt-time .seg-btn[data-value="day"]');
  await waitFor(td, () => window.__HH.session.settings.time === 'day', null, 'Day picked (top-down)');
  await td.page.click('#btn-start');
  await waitFor(td, () => !document.querySelector('#screen-game').hidden && !!window.__HH.getView() && window.__HH.getView().players.length >= 1, null, 'the top-down day game', 60e3);
  await sleep(1500);
  await sc.screenshots('-topdown');
}

/**
 * The Campaign (SPEC §3.8): the lobby (mode row, CAMPAIGN badges, previews), the stages on the
 * classic view driven through the host's game (hill, breakout, floor, roof, zip line, escape,
 * the "Escaped" end screen), then the first-person view of the tower interior and the roof.
 */
async function scenarioCampaign(sc) {
  const pl = await sc.player('campaign');
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Climber', cls: 'soldier' });
  await pl.page.click('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  const settings = () => pl.page.evaluate(() => ({ ...window.__HH.session.settings }));
  // The Mode row: three modes; Campaign plays on the highway, Checkpoint Delta and Harlan County.
  const modes = await pl.page.$$eval('#opt-mode .seg-btn', (bs) => bs.map((b) => b.dataset.value));
  expect(modes.join() === 'defend,zone,campaign', `the mode row should list defend, zone, campaign (got ${modes.join()})`);
  await pl.page.click('#opt-mode .seg-btn[data-value="campaign"]');
  await waitFor(pl, () => window.__HH.session.settings.mode === 'campaign', null, 'Campaign picked');
  expect((await settings()).mapId === 'highway', 'Campaign should keep the highway');
  const objDisabled = await pl.page.$$eval('#opt-objective .seg-btn', (bs) => bs.every((b) => b.getAttribute('aria-disabled') === 'true'));
  expect(objDisabled, 'the objective toggle should be disabled in the Campaign');
  const badges = await pl.page.$$eval('.map-card', (cs) => cs.map((c) => [c.dataset.map, !!c.querySelector('.map-badge')]));
  expect(badges.filter(([, b]) => b).map(([m]) => m).sort().join() === 'checkpoint,harlan,highway', `CAMPAIGN badges on the three extended maps only: ${JSON.stringify(badges)}`);
  await pl.page.click('.map-card[data-map="truckstop"]');
  await waitFor(pl, () => window.__HH.session.settings.mapId === 'truckstop', null, 'the truck stop picked');
  expect((await settings()).mode !== 'campaign', 'a map without the extension should leave the Campaign');
  await pl.page.click('#opt-mode .seg-btn[data-value="campaign"]');
  await waitFor(pl, () => window.__HH.session.settings.mode === 'campaign', null, 'Campaign picked again');
  expect((await settings()).mapId !== 'truckstop', 'Campaign should move off the truck stop');
  await pl.page.click('.map-card[data-map="checkpoint"]');
  await waitFor(pl, () => window.__HH.session.settings.mapId === 'checkpoint' && window.__HH.session.settings.mode === 'campaign', null, 'Checkpoint Delta in the Campaign');
  await sleep(1200);
  await sc.screenshots('-lobby');
  for (let i = 0; i < 2; i++) await pl.page.click('#btn-add-bot');
  await waitFor(pl, () => document.querySelectorAll('#roster .roster-row').length === 3, null, 'three roster rows');
  await pl.page.click('#btn-start');
  await waitFor(pl, () => !document.querySelector('#screen-game').hidden && window.__HH.getView() && window.__HH.getView().players.length === 3, null, 'the Campaign game', 60e3);

  // Stage 1: the hill. The HUD names it, the snapshot carries the block, the team starts up the hill.
  const s1 = await waitFor(pl, () => {
    const H = window.__HH;
    const v = H.getView();
    const el = document.querySelector('#hud .hud-camp');
    return v && v.campaign && el && !el.hidden && el.textContent.length > 8 ? { c: v.campaign, text: el.textContent, z: v.players.map((p) => p.z), total: v.totalWaves } : false;
  }, null, 'the campaign panel', 20e3);
  expect(s1.c.stage === 1, `the game should start on the hill (stage ${s1.c.stage})`);
  expect(/HILLTOP/i.test(s1.text), `the panel should name the hilltop: "${s1.text}"`);
  expect(s1.z.every((z) => z > 60), `the team should start up on the hill (heights ${s1.z.map((z) => Math.round(z)).join(',')})`);
  log(`    campaign: hill, panel "${s1.text.replace(/\s+/g, ' ').trim()}", ${s1.total} waves in all`);
  await pl.page.evaluate(() => {
    const g = window.__HH.session.game;
    window.__e2eGod = setInterval(() => { for (const p of g.players) p.hp = p.maxHp; }, 200);
  });
  await pl.page.evaluate(() => { window.__HH.session.game.timer = 0; });
  await waitFor(pl, () => window.__HH.getView().phase === 'wave' && window.__HH.getView().zombies.length > 3, null, 'a hill wave with zombies', 40e3);
  await sc.screenshots('-hill', 1500);

  // Stage 2: the breakout. The horde front appears behind the team.
  await pl.page.evaluate(() => {
    const g = window.__HH.session.game, c = g.campaign;
    for (const z of g.zombies) z.dead = true;
    g.spawnQueue = 0;
    g.bossQueue = 0;
    g.wave = c.plan.breakout - 1;
    g.phase = 'intermission';
    g.timer = 0;
  });
  const s2 = await waitFor(pl, () => {
    const v = window.__HH.getView();
    const el = document.querySelector('#hud .hud-camp');
    return v.campaign && v.campaign.stage === 2 && v.campaign.front > -1e8 && el ? { c: v.campaign, text: el.textContent } : false;
  }, null, 'the breakout with a horde front', 20e3);
  expect(/BREAKOUT/i.test(s2.text) || /TOWER/i.test(s2.text), `the panel should name the breakout: "${s2.text}"`);
  await sleep(2500);
  await sc.screenshots('-breakout', 1500);
  // The team reaches the tower door: the ascent starts on floor 1 with a title card.
  await pl.page.evaluate(() => {
    const g = window.__HH.session.game, e = g.map.campaign.entrance;
    for (const p of g.players) { p.x = e.x; p.y = e.y; }
  });
  const s3 = await waitFor(pl, () => {
    const v = window.__HH.getView();
    const card = document.querySelector('#hud .camp-card');
    return v.campaign && v.campaign.stage === 3 && v.campaign.floor === 1 ? { c: v.campaign, card: card && !card.hidden ? card.textContent : '' } : false;
  }, null, 'floor 1', 20e3);
  expect(/FLOOR 1/i.test(s3.card), `a title card for floor 1: "${s3.card}"`);
  log(`    campaign: at the door -> ${s3.card.replace(/\s+/g, ' ').trim()}`);
  await sleep(1500);
  await sc.screenshots('-floor1', 1500);

  // Up the stairs to the roof.
  await pl.page.evaluate(() => {
    const g = window.__HH.session.game, c = g.campaign;
    for (const z of g.zombies) z.dead = true;
    g.spawnQueue = 0;
    c.moveUp();
    c.moveUp();
    c.moveUp();
    g.wave = c.plan.roof - 1;
    g.timer = 0;
  });
  const s4 = await waitFor(pl, () => {
    const v = window.__HH.getView();
    return v.campaign && v.campaign.stage === 4 && v.phase === 'wave' ? { c: v.campaign, text: document.querySelector('#hud .hud-camp').textContent } : false;
  }, null, 'the roof', 30e3);
  expect(/ROOFTOP/i.test(s4.text), `the panel should name the rooftop: "${s4.text}"`);
  log(`    campaign: roof, quota ${s4.c.quota}, panel "${s4.text.replace(/\s+/g, ' ').trim()}"`);
  // The quota wakes the zip line; ride it.
  await pl.page.evaluate(() => {
    const g = window.__HH.session.game, c = g.campaign;
    c.kills = c.quota - 1;
    c.onKill();
    const z = g.map.campaign.roof.zip;
    for (const p of g.players) { p.x = z.ix + (p.id - 1) * 12; p.y = z.iy; }
  });
  await waitFor(pl, () => { const v = window.__HH.getView(); return v.campaign && v.campaign.zip === 1; }, null, 'the zip line live', 10e3);
  const banner = await waitFor(pl, () => {
    const b = document.querySelector('#hud .hud-banner');
    return b && !b.hidden && /ZIP LINE/i.test(b.textContent) ? b.textContent : false;
  }, null, 'the zip line banner', 10e3);
  log(`    campaign: zip line online, banner "${banner.replace(/\s+/g, ' ').trim()}"`);
  const prompt = await waitFor(pl, () => {
    const el = document.querySelector('#hud .hud-prompt');
    return el && !el.hidden && /zip line/i.test(el.textContent) ? el.textContent : false;
  }, null, 'the ride prompt', 10e3);
  expect(/zip line/i.test(prompt), `a prompt to ride: "${prompt}"`);
  // (held, not tapped: on a slow machine a tap can fall between two frames and never be seen)
  await pl.page.keyboard.press('e', { delay: 500 });
  await waitFor(pl, () => { const v = window.__HH.getView(); const me = v.players.find((p) => p.id === window.__HH.session.localId); return me.ride > 0; }, null, 'the local player riding', 20e3);
  await sleep(1500);
  await sc.screenshots('-zip', 1500);
  // The bots ride too.
  await pl.page.evaluate(() => {
    const g = window.__HH.session.game;
    for (const p of g.players) if (p.bot && !p.escaped && !(p.riding > 0)) g.campaign.tryZip(p);
  });
  await waitFor(pl, () => window.__HH.getView().phase === 'victory', null, 'victory once everyone escaped', 40e3);
  const end = await waitFor(pl, () => {
    const el = document.querySelector('#endscreen');
    return el && !el.hidden ? { title: document.querySelector('#end-title').textContent, sub: document.querySelector('#end-sub').textContent } : false;
  }, null, 'the end screen', 20e3);
  expect(/escaped/i.test(end.title), `the end screen should say Escaped: "${end.title}"`);
  log(`    campaign: victory "${end.title}" / "${end.sub}"`);
  await sc.screenshots('-victory');
  await pl.page.evaluate(() => clearInterval(window.__e2eGod));
  await sc.close(pl);

  // First person: the campaign sub-system in the scene, the tower's interior, the roof.
  const fp = await sc.player('campaign-fps', { view: 'fps', quality: 'low', context: { viewport: FPS_VIEWPORT } });
  fp.url = sc.env.relay.url;
  await titleSetup(fp, { name: 'Pointman', cls: 'soldier' });
  await fp.page.click('#btn-solo');
  await waitFor(fp, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  await fp.page.click('#opt-mode .seg-btn[data-value="campaign"]');
  await fp.page.click('.map-card[data-map="checkpoint"]');
  await waitFor(fp, () => window.__HH.session.settings.mapId === 'checkpoint' && window.__HH.session.settings.mode === 'campaign', null, 'Checkpoint Delta in the Campaign');
  // (building the big map's 3D world blocks the page for a while: don't wait on the click)
  await fp.page.evaluate(() => setTimeout(() => document.querySelector('#btn-start').click(), 0));
  await waitFor(fp, () => {
    const H = window.__HH;
    const L = H.getLook && H.getLook();
    return !document.querySelector('#screen-game').hidden && !!(H.getView && H.getView()) && !!L && L.ready && L.frames >= 3;
  }, null, 'the first-person Campaign', 180e3);
  const f1 = await fp.page.evaluate(() => {
    const H = window.__HH;
    const scene = H.renderer.debug && H.renderer.debug.scene;
    return {
      view: H.view, group: !!(scene && scene.getObjectByName('campaign')), calls: H.renderer.stats.drawCalls,
      panel: (document.querySelector('#hud .hud-camp') || {}).textContent || '', z: H.getView().players.map((p) => Math.round(p.z)),
    };
  });
  log(`    campaign fps: hill, ${f1.calls} draw calls, campaign group ${f1.group}, z ${f1.z.join()}`);
  expect(f1.view === 'fps' && f1.group, `the first-person view should carry the campaign group: ${JSON.stringify(f1)}`);
  expect(/HILLTOP/i.test(f1.panel), `the first-person panel: "${f1.panel}"`);
  await sc.screenshots('-fps-hill', FPS_SHOT_MS);
  await fp.page.evaluate(() => {
    const g = window.__HH.session.game, c = g.campaign;
    c.stage = 3;
    c.floor = 0;
    c.moveUp();
  });
  await waitFor(fp, () => { const v = window.__HH.getView(); return v.campaign && v.campaign.floor === 1; }, null, 'floor 1 in first person', 20e3);
  await sleep(2500);
  await sc.screenshots('-fps-floor', FPS_SHOT_MS);
  await fp.page.evaluate(() => {
    const c = window.__HH.session.game.campaign;
    c.moveUp();
    c.moveUp();
    c.moveUp();
  });
  await waitFor(fp, () => { const v = window.__HH.getView(); return v.campaign && v.campaign.stage === 4; }, null, 'the roof in first person', 20e3);
  await sleep(2500);
  const f2 = await fp.page.evaluate(() => ({ calls: window.__HH.renderer.stats.drawCalls, z: window.__HH.getView().players.map((p) => Math.round(p.z)) }));
  log(`    campaign fps: roof, ${f2.calls} draw calls, z ${f2.z.join()}`);
  expect(f2.z[0] > 300, `standing on the roof (z ${f2.z[0]})`);
  await sc.screenshots('-fps-roof', FPS_SHOT_MS);
}

/**
 * l. Story: the persistent campaign, one whole loop and its saves. Works with the stub content
 * (a hideout on the Roadhouse map, missions with a timer) and with the real campaign (a road
 * mission first, no hideout): the mission is won by the clock when it has one, else forced
 * through the host's own result path.
 */
async function scenarioStoryLoop(sc) {
  const pl = await sc.player('story');
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Wanderer', cls: 'soldier' });
  const { page } = pl;
  const story = (fn, arg) => page.evaluate(fn, arg);
  const stage = () => story(() => (window.__HH_STORY ? window.__HH_STORY.stage : null));
  const skipScenes = async () => {
    for (let i = 0; i < 12 && await story(() => !!(window.__HH_STORY && window.__HH_STORY.dialogueOpen)); i++) {
      await story(() => window.__HH_STORY.skipScene());
      await sleep(250);
    }
  };

  // ---- the menu, a new campaign
  expect(await visible(pl, '#btn-story'), 'the title has no Story button');
  await page.click('#btn-story');
  await waitFor(pl, () => !document.querySelector('#screen-story').hidden, null, 'the Story screen');
  expect(await visible(pl, '#story-wrap [data-act="new"]'), 'the Story screen has no New campaign button');
  expect((await page.textContent('#story-wrap')).includes('No campaign yet'), 'a fresh browser should have no campaign');
  await page.click('#story-wrap [data-act="new"]');
  await waitFor(pl, () => !document.querySelector('#dlg-campaign').hidden, null, 'the new-campaign dialog');
  await page.fill('#nc-name', 'The E2E Crew');
  await page.click('#dlg-campaign [data-act="solo"]');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the story lobby');
  expect(await visible(pl, '#story-lobby-panel'), 'the story lobby panel is not visible');
  expect(await page.inputValue('#story-lobby-panel .st-crew-input') === 'The E2E Crew', 'the story lobby should show the crew name');
  // an AI survivor joins the crew (it fights the mission with the survivor)
  await page.click('#btn-add-bot');
  await waitFor(pl, () => document.querySelectorAll('#roster .roster-row').length === 2, null, 'a bot in the roster');
  await sc.screenshots('-lobby');
  await page.click('#btn-start');
  await waitFor(pl, () => !document.querySelector('#screen-game').hidden && window.__HH && window.__HH.getView() && window.__HH_STORY, null, 'the story game screen');

  // ---- the first stage: a hideout to walk (stub), or a briefing right away (road)
  await waitFor(pl, () => ['hideout', 'briefing'].includes(window.__HH_STORY.stage), null, 'the first stage');
  await sleep(900);
  await skipScenes();
  const first = await stage();
  log(`    story: first stage "${first}"`);
  if (first === 'hideout') {
    // the stations: every panel opens and closes
    for (const kind of ['workbench', 'armory', 'infirmary', 'upgrades', 'perks', 'board']) {
      await story((k) => window.__HH_STORY.open(k), kind);
      await waitFor(pl, (k) => window.__HH_STORY.panel === k, kind, `the ${kind} panel`, 5000);
      expect(await visible(pl, '.st-panel-layer'), `${kind} panel is not visible`);
      await story(() => window.__HH_STORY.close());
      await waitFor(pl, () => window.__HH_STORY.panel === null, null, 'the panel closing', 5000);
    }
    await story(() => window.__HH_STORY.open('board'));
    await waitFor(pl, () => window.__HH_STORY.panel === 'board', null, 'the mission board', 5000);
    await sc.screenshots('-board');
    await page.click('.st-panel-layer [data-act="brief"]');
    await waitFor(pl, () => window.__HH_STORY.stage === 'briefing', null, 'the briefing', 8000);
    await sleep(500);
    await skipScenes();
  }
  expect(await visible(pl, '.st-brief'), 'the briefing screen is not visible');
  const missionId = await story(() => window.__HH_STORY.session.story.missionId);
  expect(!!missionId, 'no mission is being briefed');
  expect(await visible(pl, '.st-brief [data-act="deploy"]'), 'the host has no Deploy button');
  await sc.screenshots('-briefing');

  // ---- deploy, win
  await page.click('.st-brief [data-act="deploy"]');
  await waitFor(pl, () => window.__HH_STORY.stage === 'mission', null, 'the mission stage', 10e3);
  // the mission runs for real (the story HUD lists its step); a mission with a clock (the stub content) wins
  // itself, any other is ended the way the director ends it when the last step is done
  await waitFor(pl, () => !!document.querySelector('.hud-story:not([hidden]) .story-row') || window.__HH_STORY.stage === 'debrief', null, 'the objective tracker', 12e3);
  const live = await story(() => window.__HH.getView());
  expect(live && live.players.length === 2 && live.players.some((p) => p.id !== 1), 'the bot should be in the mission');
  await sc.screenshots('-mission');
  await sleep(2500);
  const debriefed = await page.waitForFunction(() => window.__HH_STORY.stage === 'debrief', null, { timeout: 8e3, polling: 100 }).then(() => true, () => false);
  if (!debriefed) {
    const ended = await story(() => {
      const g = window.__HH.session.game;
      if (g && g.story && g.story.onEnd) {
        g.story.onEnd('victory');
        return true;
      }
      const st = window.__HH_STORY.session.story;
      st._finish(st._synth('victory'));
      return false;
    });
    log(`    story: mission ended through ${ended ? 'the director (storyend)' : 'the host result path'}`);
    await waitFor(pl, () => window.__HH_STORY.stage === 'debrief', null, 'the debrief', 8000);
  }
  await waitFor(pl, () => !!document.querySelector('.st-debrief:not([hidden]) .st-result-row.me'), null, 'the result screen', 8000);
  // the XP bar fills and rolls into a level-up
  await waitFor(pl, () => {
    const el = document.querySelector('.st-debrief .st-result-row.me .st-xp-gain');
    return !!el && /\+[1-9][0-9,]* XP/.test(el.textContent);
  }, null, 'the XP counter running', 8000);
  await sleep(3800);
  await skipScenes();
  const res = await story(() => {
    const d = window.__HH_STORY.session.story.debrief;
    const p = window.__HH_STORY.session.story.profile;
    return {
      result: d.result, stars: d.stars, xp: p.xp, level: p.level, points: p.perkPoints, scrap: p.scrap,
      lvlBadge: document.querySelector('.st-debrief .st-result-row.me .st-lvl-badge').textContent, next: d.next,
    };
  });
  log(`    story: won ${missionId}: ${res.stars} stars, xp ${res.xp}, level ${res.level}, ${res.points} perk points, scrap ${res.scrap}, next ${JSON.stringify(res.next)}`);
  expect(res.result === 'victory', `the mission should be won, got ${res.result}`);
  expect(res.stars >= 1 && res.xp > 0 && res.level >= 2 && res.points >= 1, `a win should give XP and a level: ${JSON.stringify(res)}`);
  expect(res.lvlBadge === `LV ${res.level}`, `the animated level badge should end on LV ${res.level}, got ${res.lvlBadge}`);
  await sc.screenshots('-debrief');

  // ---- spend the perk point from the debrief
  await page.click('.st-debrief [data-act="perks"]');
  await waitFor(pl, () => window.__HH_STORY.panel === 'perks', null, 'the perk tree', 5000);
  await page.click('.st-panel-layer [data-act="perk"][data-perk="steady"]');
  await waitFor(pl, (p) => window.__HH_STORY.session.story.profile.perkPoints === p - 1 && window.__HH_STORY.session.story.profile.perks.steady === 1, res.points, 'the perk being bought', 5000);
  await story(() => window.__HH_STORY.close());
  await waitFor(pl, () => window.__HH_STORY.panel === null, null, 'the perk tree closing', 5000);

  // ---- on to the next stage
  await page.click('.st-debrief [data-act="back"]');
  await waitFor(pl, () => window.__HH_STORY.stage !== 'debrief' && !!window.__HH.getView(), null, 'the next stage', 10e3);
  await sleep(700);
  await skipScenes();
  const after = await story(() => {
    const st = window.__HH_STORY.session.story;
    return { stage: st.stage, done: Object.keys(st.world.progress.completed), day: st.world.day, perks: st.profile.perks };
  });
  log(`    story: next stage "${after.stage}", completed ${after.done.join()}, day ${after.day}`);
  expect(after.done.includes(missionId), `the world should record ${missionId} as completed`);
  expect(after.day > 41, `each mission moves the day on (day ${after.day})`);
  expect(after.perks.steady === 1, 'the bought perk should be on the profile');
  expect(['hideout', 'briefing'].includes(after.stage), `after the debrief the crew is in the hideout or a briefing, not "${after.stage}"`);
  await sc.screenshots('-after');

  // ---- saves: reload, the campaign is listed with its progress
  await page.reload();
  await waitFor(pl, () => !document.querySelector('#app').classList.contains('booting') && !document.querySelector('#screen-title').hidden, null, 'the title after a reload');
  await page.click('#btn-story');
  await waitFor(pl, () => !!document.querySelector('#story-wrap .st-world'), null, 'the saved campaign');
  const card = (await page.textContent('#story-wrap .st-world')).replace(/\s+/g, ' ');
  expect(card.includes('The E2E Crew'), `the campaign card should carry the crew name: ${card}`);
  expect(/missions\s*1\s*\//i.test(card), `the campaign card should show 1 mission done: ${card}`);
  expect((await page.textContent('#story-wrap .st-survivor')).includes('Wanderer'), 'the survivor card should show the profile');
  await sc.screenshots('-saves');

  // export → delete → import
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#story-wrap .st-world [data-act="export"]')]);
  const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(file.format === 'highway-horde-save', `the export should be a save file, got ${file.format}`);
  const exported = Object.values(file.worlds || {});
  expect(exported.length === 1 && exported[0].progress.completed[missionId], 'the export should hold the campaign with its progress');
  expect(file.profile && file.profile.perks.steady === 1, 'the export should hold the survivor');
  const saved = path.join(OUT, 'story-export.json');
  await dl.saveAs(saved);
  await page.click('#story-wrap .st-world [data-act="delete"]');
  await waitFor(pl, () => !document.querySelector('#dlg-confirm').hidden, null, 'the delete confirmation');
  await page.click('#confirm-yes');
  await waitFor(pl, () => !document.querySelector('#story-wrap .st-world'), null, 'the campaign being deleted');
  await page.setInputFiles('#screen-story input[type="file"]', saved);
  await waitFor(pl, () => !!document.querySelector('#story-wrap .st-world'), null, 'the imported campaign', 8000);
  expect((await page.textContent('#story-wrap .st-world')).includes('The E2E Crew'), 'the imported campaign should be back');

  // Continue resumes it where it was
  await page.click('#story-wrap .st-world [data-act="continue"]');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the lobby of the resumed campaign');
  await page.click('#btn-start');
  await waitFor(pl, () => !document.querySelector('#screen-game').hidden && window.__HH_STORY && ['hideout', 'briefing'].includes(window.__HH_STORY.stage), null, 'the resumed campaign', 15e3);
  const resumed = await story(() => ({ done: Object.keys(window.__HH_STORY.session.story.world.progress.completed), perk: window.__HH_STORY.session.story.profile.perks.steady }));
  expect(resumed.done.includes(missionId) && resumed.perk === 1, `the resumed campaign keeps its progress: ${JSON.stringify(resumed)}`);
  log(`    story: saves ok (export ${(fs.statSync(saved).size / 1024).toFixed(1)} KB), resumed with ${resumed.done.join()} done`);

  // ---- the hideout: a save that has cleared the road chapter (three missions) arrives at the
  // Roadhouse: the arrival scene, every station panel, the board listing the next missions
  await page.evaluate(async () => {
    const W = await import('/js/shared/story/world.js');
    const S = await import('/js/shared/story/save.js');
    let w = W.createWorld({ name: 'Roadhouse Crew' });
    w = W.changeWorld(w, (d) => {
      for (const id of ['m1_1', 'm1_2', 'm1_3']) d.progress.completed[id] = { stars: 2, time: 300 };
      d.progress.flags.road_open = true;
      d.day = 44;
    });
    S.saveWorld(w);
  });
  await page.reload();
  await waitFor(pl, () => !document.querySelector('#app').classList.contains('booting') && !document.querySelector('#screen-title').hidden, null, 'the title after the second reload');
  await page.click('#btn-story');
  await waitFor(pl, () => [...document.querySelectorAll('#story-wrap .st-world')].some((e) => e.textContent.includes('Roadhouse Crew')), null, 'the crafted campaign card');
  await page.click('#story-wrap .st-world:has-text("Roadhouse Crew") [data-act="continue"]');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the lobby of the crafted campaign');
  await page.click('#btn-start');
  await waitFor(pl, () => window.__HH_STORY && window.__HH_STORY.stage === 'hideout' && !!window.__HH.getView(), null, 'the roadhouse', 15e3);
  await waitFor(pl, () => window.__HH_STORY.dialogueOpen, null, 'the arrival scene', 8000);
  const arrival = await story(() => window.__HH_STORY.session.story.stageInfo.arrival);
  expect(arrival && arrival.hideout === 'roadhouse' && arrival.flag === 'seen_arrival_roadhouse', `the arrival should be pending: ${JSON.stringify(arrival)}`);
  await sc.screenshots('-arrival');
  await skipScenes();
  await waitFor(pl, () => window.__HH_STORY.session.story.world.progress.flags.seen_arrival_roadhouse === true, null, 'the arrival being recorded', 5000);
  for (const kind of ['workbench', 'armory', 'infirmary', 'upgrades', 'perks', 'board']) {
    await story((k) => window.__HH_STORY.open(k), kind);
    await waitFor(pl, (k) => window.__HH_STORY.panel === k, kind, `the ${kind} panel`, 5000);
    expect(await visible(pl, '.st-panel-layer'), `${kind} panel is not visible`);
    if (kind === 'board') {
      const rows = await page.$$eval('.st-panel-layer .st-mission-row', (els) => els.length);
      expect(rows >= 8, `the board should list the campaign's missions, has ${rows}`);
      await sc.screenshots('-roadhouse-board');
      await page.click('.st-panel-layer [data-act="brief"]');
      await waitFor(pl, () => window.__HH_STORY.stage === 'briefing', null, 'a hub mission being briefed', 8000);
      await skipScenes();
      expect(await visible(pl, '.st-brief [data-act="cancel"]'), 'a hub mission can be backed out of');
      await page.click('.st-brief [data-act="cancel"]');
      await waitFor(pl, () => window.__HH_STORY.stage === 'hideout', null, 'back in the hideout', 8000);
    } else {
      await story(() => window.__HH_STORY.close());
      await waitFor(pl, () => window.__HH_STORY.panel === null, null, 'the panel closing', 5000);
    }
  }
  log('    story: roadhouse ok (arrival scene, every panel, the board, a briefing backed out of)');
}

/**
 * The story missions (STORY.md §5, SPEC §3.9): a small mission started through the session's
 * createGame hook (the engine's story screen does that for real), played on the classic view
 * with two bots: the tracker and the radio strip, an NPC with its prompt, story items picked up,
 * a hold-to-use device with its ring, an optional note, the end screen; then the same mission in
 * first person (NPC model with its accessory, items, device and markers in the 3D scene).
 */
const E2E_MISSION = {
  id: 'e2e_field', chapter: 1, index: 1, title: 'Field Test', blurb: 'A test.', map: 'highway', time: 'night', mode: 'free',
  level: [1, 1], party: { min: 1, max: 6 }, startAt: 'overpass',
  npcs: [{ id: 'mara', at: 'overpass' }],
  briefing: [{ who: 'mara', text: 'Ready?' }], debrief: [{ who: 'mara', text: 'Done.' }], rewards: { xp: 1, scrap: 1 },
  stars: { time: 900, noDowns: true },
  steps: [
    { id: 'talk', type: 'dialogue', npc: 'mara', talk: true, text: 'Talk to Mara', lines: [{ who: 'mara', text: 'Take three fuel cans to the bus.', ms: 2500 }] },
    { id: 'cans', type: 'collect', item: 'fuel', count: 3, at: ['bus'], scatter: 140, text: 'Collect the fuel cans', pressure: false, onStart: [{ type: 'radio', who: 'deke', text: 'Red cans. Look in the trunks.', ms: 2500 }] },
    { id: 'wire', type: 'activate', at: ['bus'], hold: 4, text: 'Wire the horn (hold E)', pressure: false },
    { id: 'home', type: 'reach', at: 'overpass', hold: 1, who: 'any', text: 'Get back to the overpass', pressure: false },
  ],
  bonus: [{ id: 'note', type: 'collect', item: 'note', note: 'n01', count: 1, at: ['bus'], scatter: 140, text: 'Find the note (optional)' }],
};

/** Solo lobby → `bots` bots → the mission through the session hook → Start. */
async function startMission(pl, mission, bots) {
  await pl.page.click('#btn-solo');
  await waitFor(pl, () => !document.querySelector('#screen-lobby').hidden, null, 'the solo lobby');
  for (let i = 0; i < bots; i++) await pl.page.click('#btn-add-bot');
  await waitFor(pl, (n) => document.querySelectorAll('#roster .roster-row').length === n + 1, bots, 'the roster');
  await pl.page.evaluate(async (m) => {
    const s = window.__HH.session;
    const { Game } = await import('/js/shared/sim.js');
    const story = { mission: m, simMode: m.mode, title: m.title };
    s.hooks.createGame = (opts) => new Game({ ...opts, mapId: m.map, settings: { ...opts.settings, mode: 'mission', time: m.time, story } });
    Object.assign(s.settings, { mapId: m.map, mode: 'mission', time: m.time, story });
    window.__e2eStory = { events: [] };
    const orig = s.drainEvents.bind(s);
    s.drainEvents = () => {
      const ev = orig();
      for (const e of ev) if (['objective', 'radio', 'item', 'talk', 'interact', 'storyend', 'npc', 'gate', 'area', 'title', 'checkpoint', 'lights', 'horde'].includes(e.type)) window.__e2eStory.events.push(e);
      return ev;
    };
  }, mission);
  await pl.page.evaluate(() => setTimeout(() => document.querySelector('#btn-start').click(), 0));
}

const storyEvents = (pl, type) => pl.page.evaluate((t) => window.__e2eStory.events.filter((e) => e.type === t), type);
const teleport = (pl, x, y) => pl.page.evaluate(({ x, y }) => {
  const s = window.__HH.session;
  const p = s.game.getPlayer(s.localId);
  p.x = x;
  p.y = y;
}, { x, y });

async function scenarioStory(sc) {
  const pl = await sc.player('story');
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Courier', cls: 'soldier' });
  await startMission(pl, E2E_MISSION, 2);
  await waitFor(pl, () => {
    const H = window.__HH;
    const v = H.getView && H.getView();
    return !document.querySelector('#screen-game').hidden && !!v && v.players.length === 3 && !!v.story;
  }, null, 'the mission game', 60e3);
  // (the bots would do the errands before the scripted player gets to them: they only fight and follow here)
  await pl.page.evaluate(() => { window.__HH.session.game.story.botGoal = () => null; });

  // The tracker names the first objective; the NPC is there with its state.
  const t0 = await waitFor(pl, () => {
    const el = document.querySelector('#hud .hud-story');
    const rows = [...document.querySelectorAll('#hud .story-row')].map((r) => r.textContent);
    return el && !el.hidden && rows.length ? rows : false;
  }, null, 'the objective tracker', 20e3);
  expect(/talk to mara/i.test(t0.join(' ')), `the tracker should name the first objective: ${JSON.stringify(t0)}`);
  const view0 = await pl.page.evaluate(() => {
    const v = window.__HH.getView();
    return { npcs: v.npcs.map((n) => ({ key: n.key, name: n.name, state: n.state, acc: n.look.accessory, cls: n.look.cls })), mode: v.story.mode, marks: v.story.marks.map((m) => m.kind) };
  });
  expect(view0.npcs.length === 1 && view0.npcs[0].key === 'mara' && view0.npcs[0].name === 'Mara Voss', `Mara should be in the view: ${JSON.stringify(view0.npcs)}`);
  expect(view0.mode === 'mission' && view0.marks.includes('npc'), `the talk step marks the NPC: ${JSON.stringify(view0)}`);
  log(`    story: tracker "${t0[0].replace(/\s+/g, ' ').trim()}", NPC ${view0.npcs[0].name} (${view0.npcs[0].cls}, ${view0.npcs[0].acc})`);

  // Walk up to her: the prompt, E, her words on the radio strip.
  await teleport(pl, ...(await pl.page.evaluate(() => { const n = window.__HH.getView().npcs[0]; return [n.x - 40, n.y]; })));
  const prompt = await waitFor(pl, () => {
    const el = document.querySelector('#hud .hud-prompt');
    return el && !el.hidden && /mara/i.test(el.textContent) ? el.textContent : false;
  }, null, 'the talk prompt', 15e3);
  await sc.screenshots('-talk-prompt');
  // (a tap is only seen when a game frame falls inside it: hold E for a moment)
  await pl.page.keyboard.down('e');
  await sleep(350);
  await pl.page.keyboard.up('e');
  const radio = await waitFor(pl, () => {
    const el = document.querySelector('#hud .hud-radio');
    return el && !el.hidden && /fuel cans/i.test(el.textContent) ? el.textContent : false;
  }, null, 'the radio strip with Mara\'s words', 20e3);
  expect(/mara/i.test(radio), `the strip names the speaker: "${radio}"`);
  log(`    story: prompt "${prompt.replace(/\s+/g, ' ').trim()}", radio "${radio.replace(/\s+/g, ' ').trim()}"`);
  await sc.screenshots('-radio');
  expect((await storyEvents(pl, 'talk')).length >= 1, 'a talk event should have fired');

  // Fuel cans: three items on the map; stand on each.
  await waitFor(pl, () => window.__HH.getView().story.items.filter((i) => i.item === 'fuel').length === 3, null, 'three fuel cans on the ground', 20e3);
  const cans0 = await waitFor(pl, () => {
    const rows = [...document.querySelectorAll('#hud .story-row')].map((r) => r.textContent);
    return rows.find((r) => /fuel cans/i.test(r)) || false;
  }, null, 'the collect row', 10e3);
  expect(/0\s*\/\s*3/.test(cans0), `the collect row should count 0/3: "${cans0}"`);
  for (let k = 1; k <= 3; k++) {
    const spot = await pl.page.evaluate(() => { const it = window.__HH.getView().story.items.find((i) => i.item === 'fuel'); return it ? [it.x, it.y] : null; });
    if (!spot) break;
    await teleport(pl, spot[0], spot[1]);
    await waitFor(pl, (kk) => {
      const rows = [...document.querySelectorAll('#hud .story-row')].map((r) => r.textContent);
      const done = window.__e2eStory.events.filter((e) => e.type === 'item' && e.item === 'fuel').length;
      return done >= kk || rows.some((r) => /fuel cans/i.test(r) && new RegExp(`${kk}\\s*/\\s*3`).test(r)) ? true : false;
    }, k, `fuel can ${k} picked up`, 15e3);
    if (k === 1) await sc.screenshots('-items');
  }
  const items = await storyEvents(pl, 'item');
  expect(items.filter((e) => e.item === 'fuel').length >= 3, `three fuel pickups should have been announced: ${JSON.stringify(items)}`);
  // the optional note: found with the optional row
  const optRow = await pl.page.evaluate(() => [...document.querySelectorAll('#hud .story-row')].map((r) => r.textContent).find((r) => /note/i.test(r)) || '');
  log(`    story: fuel collected; optional row "${optRow.replace(/\s+/g, ' ').trim()}"`);
  const noteSpot = await pl.page.evaluate(() => { const it = window.__HH.getView().story.items.find((i) => i.item === 'note'); return it ? [it.x, it.y] : null; });
  if (noteSpot) {
    await teleport(pl, noteSpot[0], noteSpot[1]);
    await waitFor(pl, () => window.__e2eStory.events.some((e) => e.type === 'item' && e.item === 'note' && e.note === 'n01'), null, 'the note picked up (with its id)', 15e3);
  }

  // The device: a hold-to-use spot with a ring that fills while E is held.
  const dev = await waitFor(pl, () => {
    const v = window.__HH.getView();
    const it = v.interactables.find((q) => q.on && !q.done);
    return it ? { x: it.x, y: it.y, kind: it.kind } : false;
  }, null, 'the device', 20e3);
  await teleport(pl, dev.x - 18, dev.y);
  await waitFor(pl, () => {
    const el = document.querySelector('#hud .hud-prompt');
    return el && !el.hidden && /wire the horn/i.test(el.textContent) ? true : false;
  }, null, 'the device prompt', 15e3);
  await pl.page.keyboard.down('e');
  const ring = await waitFor(pl, () => {
    const v = window.__HH.getView();
    const it = v.interactables[0];
    const r = document.querySelector('#hud .hud-prompt .story-ring');
    return it && it.prog > 0.15 && r && !r.hidden ? { prog: it.prog, user: it.user } : false;
  }, null, 'the hold ring filling', 20e3);
  await sc.screenshots('-hold');
  expect(ring.user === (await pl.page.evaluate(() => window.__HH.session.localId)), `the ring is held by the local player: ${JSON.stringify(ring)}`);
  await waitFor(pl, () => window.__e2eStory.events.some((e) => e.type === 'interact'), null, 'the hold to finish', 20e3);
  await pl.page.keyboard.up('e');
  log(`    story: device (${dev.kind}) used, ring reached ${ring.prog.toFixed(2)} on the way`);

  // Back to the overpass: the mission ends.
  // (the interact event and the next step's marker reach the view in different frames: wait for the marker)
  const home = await waitFor(pl, () => {
    const m = window.__HH.getView().story.marks.find((q) => q.kind === 'reach');
    return m ? [m.x, m.y] : false;
  }, null, 'the last step marks the place to reach', 10e3);
  await teleport(pl, home[0], home[1]);
  await waitFor(pl, () => window.__HH.getView().phase === 'victory', null, 'victory', 60e3);
  const end = await waitFor(pl, () => {
    const el = document.querySelector('#endscreen');
    return el && !el.hidden ? { title: document.querySelector('#end-title').textContent, sub: document.querySelector('#end-sub').textContent } : false;
  }, null, 'the end screen', 20e3);
  expect(/mission complete/i.test(end.title), `the end screen should say the mission is complete: "${end.title}"`);
  const fin = (await storyEvents(pl, 'storyend'))[0];
  expect(fin && fin.result === 'victory' && fin.stars >= 1 && fin.mission === 'e2e_field', `a storyend event: ${JSON.stringify(fin)}`);
  log(`    story: "${end.title}" — ${fin.stars} star(s), ${fin.time}s, items ${JSON.stringify(fin.items)}`);
  await sc.screenshots('-victory');
  await sc.close(pl);

  // First person: the NPC model with its accessory, the items, the device, the markers.
  const fp = await sc.player('story-fps', { view: 'fps', quality: 'low', context: { viewport: FPS_VIEWPORT } });
  fp.url = sc.env.relay.url;
  await titleSetup(fp, { name: 'Pointman', cls: 'soldier' });
  // (in the open, at the west crossroads)
  await startMission(fp, { ...E2E_MISSION, startAt: 'crossroadsW', npcs: [{ id: 'mara', at: 'crossroadsW' }] }, 1);
  await waitFpsGame(fp, 2, 'the first-person mission');
  await waitFor(fp, () => window.__HH.getView().npcs.length === 1, null, 'the NPC in the first-person view', 30e3);
  // a row of the cast beside Mara (the hideout's residents): hats, hair, packs, an apron
  const at = await fp.page.evaluate(() => { const n = window.__HH.getView().npcs[0]; return [n.x, n.y]; });
  await fp.page.evaluate(async ([ax, ay]) => {
    const { createNpc } = await import('/js/shared/sim/npcs.js');
    const g = window.__HH.session.game;
    ['deke', 'ozzy', 'june', 'roz', 'quill'].forEach((key, i) => createNpc(g, { key, x: ax + 24 * (i % 2), y: ay + (i - 2) * 46, angle: Math.PI }));
  }, at);
  await waitFor(fp, () => window.__HH.getView().npcs.length === 6, null, 'the cast in the view', 15e3);
  // stand 190 px west of them, looking east
  await teleport(fp, at[0] - 190, at[1]);
  await turnTo(fp, 0);
  await sleep(2500);
  const scene = await waitFor(fp, () => {
    const d = window.__HH.renderer.debug;
    const sc3 = d && d.scene;
    const npcs = sc3 && sc3.getObjectByName('npcs3d');
    const story = sc3 && sc3.getObjectByName('story3d');
    if (!npcs || !story) return false;
    const rig = npcs.children.filter((c) => c.isMesh && c.visible && c.geometry && c.geometry.instanceCount > 0).length;
    const dress = npcs.children.filter((c) => c.isMesh && !c.geometry.isInstancedBufferGeometry && c.visible).length;
    return { rig, dress, items: story.children.length };
  }, null, 'the NPC and story groups in the 3D scene', 60e3);
  log(`    story fps: NPC rig meshes ${scene.rig}, accessory / hair meshes ${scene.dress}, story group children ${scene.items}`);
  expect(scene.rig >= 1, `Mara's body should be in the scene: ${JSON.stringify(scene)}`);
  expect(scene.dress >= 6, `the cast's hats, hair and accessories should be in the scene: ${JSON.stringify(scene)}`);
  await sc.screenshots('-fps-npc', FPS_SHOT_MS);
  // close up on two of them: Deke (cap, tool belt) and Ozzy (headset, curly hair)
  for (const [i, tag] of [[0, 'deke'], [1, 'ozzy']]) {
    await teleport(fp, at[0] + 24 * (i % 2) - 78, at[1] + (i - 2) * 46);
    await turnTo(fp, 0);
    await sleep(1800);
    await sc.screenshots(`-fps-close-${tag}`, FPS_SHOT_MS);
  }
  // an item and its marker
  const can = await fp.page.evaluate(() => { const it = window.__HH.getView().story.items.find((i) => i.item === 'fuel'); return it ? [it.x, it.y] : null; });
  if (can) {
    await teleport(fp, can[0] - 160, can[1]);
    await turnTo(fp, 0);
    await sleep(2500);
    await sc.screenshots('-fps-item', FPS_SHOT_MS);
  }
}

/**
 * n: a story level (JOURNEY.md §4) played by bots: the test mission on Mill Road. Three bots
 * hotwire the semi (the first gate opens), take the gas station (a section reach), hold the tow
 * truck (a defend point), and the second gate opens behind a blast and a power cut. The scripted
 * player rides along with them (kept alive); the HUD shows the location card of every section,
 * the gate toasts and the defend point's name; then a first-person client looks at the gates.
 */
async function scenarioLevel(sc) {
  const pl = await sc.player('level');
  pl.url = sc.env.relay.url;
  await titleSetup(pl, { name: 'Pathfinder', cls: 'soldier' });
  await startMission(pl, LEVEL_TEST_MISSION, 3);
  await waitFor(pl, () => {
    const v = window.__HH.getView && window.__HH.getView();
    return !document.querySelector('#screen-game').hidden && !!v && v.players.length === 4 && !!v.level;
  }, null, 'the level mission game', 60e3);
  const card = await waitFor(pl, () => {
    const el = document.querySelector('#hud .level-card');
    return el && !el.hidden && el.textContent ? el.textContent : false;
  }, null, 'the location card', 20e3);
  expect(/jam|mission/i.test(card), `the first card names the level's first section or the mission's title: "${card}"`);
  log(`    level: card "${card.replace(/\s+/g, ' ').trim()}"`);
  await sc.screenshots('-card');
  // The scripted player rides with the crew (a few px behind the lead bot, kept alive).
  const ride = () => pl.page.evaluate(() => {
    const s = window.__HH.session;
    const g = s.game;
    const me = g.getPlayer(s.localId);
    if (!me || me.state !== 'alive') return null;
    me.hp = me.maxHp;
    const b = g.players.filter((p) => p.bot && p.state === 'alive').sort((p, q) => q.x - p.x)[0];
    if (b && Math.hypot(b.x - me.x, b.y - me.y) > 260) {
      me.x = b.x - 60;
      me.y = b.y;
      if (!g.world.unstick(me, 16, 0)) g.world.resolveCircle(me, 16);
    }
    return g.level ? g.level.section : null;
  });
  const levelEvents = (type) => pl.page.evaluate((t) => window.__e2eStory.events.filter((e) => e.type === t), type);
  const until = async (fn, what, ms) => {
    const t0 = Date.now();
    for (;;) {
      await ride();
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Failure(`timed out waiting for ${what}`);
      await sleep(700);
    }
  };
  // 1) the first gate: the bots hotwire the semi
  await until(async () => (await levelEvents('gate')).some((e) => e.id === 'gas_shutter' && e.open), 'the first gate to open', 150e3);
  const toast = await waitFor(pl, () => [...document.querySelectorAll('#hud .toast')].map((t) => t.textContent).find((t) => /open/i.test(t)) || false, null, 'the gate toast', 10e3);
  log(`    level: first gate open ("${toast}")`);
  await sc.screenshots('-gate-open');
  // 2) the gas station: a new card, then the defend point with its name on the bar
  await until(async () => (await levelEvents('area')).some((e) => e.id === 'gasstation'), 'the crew to reach the gas station', 120e3);
  const card2 = await waitFor(pl, () => {
    const el = document.querySelector('#hud .level-card');
    return el && !el.hidden && /gas/i.test(el.textContent) ? el.textContent : false;
  }, null, 'the gas station card', 15e3);
  log(`    level: card "${card2.replace(/\s+/g, ' ').trim()}"`);
  const defend = await until(() => pl.page.evaluate(() => {
    const v = window.__HH.getView();
    const name = document.querySelector('#hud .obj-name');
    return v.level && v.level.defend && v.objective ? { defend: v.level.defend, bar: name ? name.textContent : '' } : false;
  }), 'the defend point', 60e3);
  expect(defend.bar === defend.defend, `the objective bar names the defend point: ${JSON.stringify(defend)}`);
  log(`    level: defending "${defend.defend}"`);
  await sc.screenshots('-defend');
  // 3) the second gate, after the checkpoint, the blast and the power cut
  await until(async () => (await levelEvents('gate')).some((e) => e.id === 'trailer_gate' && e.open), 'the second gate to open', 150e3);
  const [cps, lights] = [await levelEvents('checkpoint'), await levelEvents('lights')];
  expect(cps.length >= 1 && lights.some((e) => !e.on), `a checkpoint and a power cut before the second gate: ${JSON.stringify({ cps, lights })}`);
  const st = await pl.page.evaluate(() => { const v = window.__HH.getView(); return { gates: v.level.gates.map((g) => g.open), dark: v.level.dark, section: v.level.section }; });
  expect(st.gates[0] && st.gates[1] && st.dark !== 0, `both gates open, a section dark: ${JSON.stringify(st)}`);
  log(`    level: second gate open, level state ${JSON.stringify(st)}`);
  await sc.screenshots('-gate2');
  const win = await until(() => pl.page.evaluate(() => window.__HH.getView().phase === 'victory'), 'victory', 120e3).catch(() => false);
  log(`    level: ${win ? 'mission complete' : 'still going (the bots got through both gates)'}`);
  await sc.close(pl);

  // First person: the gates as models (one shut, one opening), the level's own card
  const fp = await sc.player('level-fps', { view: 'fps', quality: 'low', context: { viewport: FPS_VIEWPORT } });
  fp.url = sc.env.relay.url;
  await titleSetup(fp, { name: 'Pointman', cls: 'soldier' });
  await startMission(fp, { ...LEVEL_TEST_MISSION, steps: [{ id: 'w', type: 'wait', seconds: 600, pressure: false, text: 'Look around' }] }, 0);
  await waitFpsGame(fp, 1, 'the first-person level');
  const gate = await fp.page.evaluate(async () => {
    const { levelGates } = await import('/js/shared/level.js');
    const g = levelGates(window.__HH.session.game.map)[0];
    return { id: g.id, x: g.x, y: g.y, x0: g.x0 };
  });
  await teleport(fp, gate.x0 - 260, gate.y);
  await turnTo(fp, 0);
  await sleep(2500);
  const g3 = await waitFor(fp, () => {
    const d = window.__HH.renderer.debug;
    const grp = d && d.scene && d.scene.getObjectByName('gates3d');
    return grp ? { pieces: grp.children.length } : false;
  }, null, 'the gates group in the 3D scene', 60e3);
  expect(g3.pieces >= 2, `the gate models are in the scene: ${JSON.stringify(g3)}`);
  await sc.screenshots('-fps-gate-shut', FPS_SHOT_MS);
  await fp.page.evaluate((id) => window.__HH.session.game.level.setGate(id, true), gate.id);
  await sleep(600);
  await sc.screenshots('-fps-gate-opening', FPS_SHOT_MS);
  await sleep(2000);
  const open = await fp.page.evaluate(() => window.__HH.getView().level.gates[0].open);
  expect(open, 'the gate is open in the view');
  await sc.screenshots('-fps-gate-open', FPS_SHOT_MS);
  log(`    level fps: ${g3.pieces} gate models; the first gate opened in view`);
}

const SCENARIOS = [
  ['a', 'solo', scenarioSolo],
  ['b', 'relay-mp', scenarioRelay],
  ['c', 'late-join', scenarioLateJoin],
  ['d', 'p2p', scenarioP2P],
  ['e', 'phone', scenarioPhone],
  ['f', 'bots', scenarioBots],
  ['g', 'fps-solo', scenarioFpsSolo, 330e3],
  ['h', 'fps-relay', scenarioFpsRelay, 200e3],
  ['i', 'zone', scenarioZone, 360e3],
  ['j', 'day', scenarioDay, 300e3],
  ['k', 'campaign', scenarioCampaign, 420e3],
  ['l', 'story-loop', scenarioStoryLoop, 200e3],
  ['m', 'story', scenarioStory, 300e3],
  ['n', 'level', scenarioLevel, 600e3],
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
    // SwiftShader is headless Chromium's WebGL; opting in explicitly silences its deprecation notice.
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
  });
  const results = [];
  try {
    for (const [id, name, run, limit = SCENARIO_TIMEOUT] of picked) {
      const sc = new Scenario(browser, id, name, env);
      const started = Date.now();
      let error = null;
      let timer;
      try {
        await Promise.race([
          run(sc),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Failure(`scenario timed out after ${limit / 1000}s`)), limit);
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
