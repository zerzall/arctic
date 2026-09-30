// Shared plumbing of the browser specs (docs/SPEC.md section 10): a real server in a child process, real headless Chromium
// contexts (desktop, phone with touch), and small helpers to drive the real UI and to read the client's state.
//
// Everything a spec learns about the client comes from two places: the DOM (what a player sees) and `window.__bp.probe()`, the plain
// data snapshot main.js publishes when the page is opened with `?debug=1`. The probe cannot change the game.
//
// A plain module of specs/helpers (SPEC 10.1), imported by specs/e2e/*.e2e.mjs; `node --test` never picks it up (SPEC 1.1).

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { launchChromium } from './pw.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SHOTS = process.env.E2E_SHOTS ?? join(tmpdir(), 'blast-party-e2e');
mkdirSync(SHOTS, { recursive: true });

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- The server ---------------------------------------------------------------------------------------

/** `node server/index.js` with PORT set, as a user would run it. Resolves when /healthz answers. */
export async function startServer({ port, env = {} } = {}) {
  const chosen = port ?? 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(chosen), HOST: '0.0.0.0', LOG_LEVEL: 'warn', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(String(d)));
  child.stderr.on('data', (d) => lines.push(String(d)));
  const url = `http://localhost:${chosen}`;
  const up = async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`${url}/healthz`);
        if (res.ok) return true;
      } catch { /* not yet */ }
      await sleep(100);
    }
    return false;
  };
  if (!(await up())) {
    child.kill('SIGKILL');
    throw new Error(`the server did not start on port ${chosen}:\n${lines.join('')}`);
  }
  return {
    url,
    port: chosen,
    log: () => lines.join(''),
    stats: async () => (await fetch(`${url}/api/stats`)).json(),
    /** Graceful stop (SIGTERM), like a deploy; resolves with the exit code. */
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve(child.exitCode);
      child.once('exit', (code) => resolve(code));
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }),
    kill: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGKILL');
    }),
  };
}

// ---- The browser ---------------------------------------------------------------------------------------

/**
 * The browser resolves *.test to this machine, so a spec can open the game at http://blast-party.test:PORT: a name that is not loopback
 * and a plain-http (insecure) page, like a phone on the Wi-Fi. The server must then be started with ALLOWED_ORIGINS for that address
 * (the WebSocket goes to localhost, see WS_HOOK), which is how a real deployment behind a rewriting tunnel is configured too.
 */
export const INSECURE_HOST = 'blast-party.test';

export async function openBrowser() {
  const { browser, playwright, reason } = await launchChromium({ args: [`--host-resolver-rules=MAP *.test 127.0.0.1`] });
  return { browser, playwright, reason };
}

/** Recorded for every page: console errors and warnings, uncaught exceptions, failed requests. A spec asserts the list is empty. */
function trackProblems(page, label, problems) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${label}] console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label}] uncaught: ${e.message}`));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(why)) problems.push(`[${label}] request failed: ${r.url()} ${why}`);
  });
}

// Wraps WebSocket so a spec can cut the connection (and keep it cut) without touching the game's code.
// It also sends a socket meant for a *.test name to localhost: this sandbox's Chromium refuses WebSocket handshakes to any other
// name than localhost/127.0.0.1 before they leave the machine (plain page loads are fine), and a real home network has no such rule.
const WS_HOOK = `(() => {
  const Native = window.WebSocket;
  const sockets = [];
  window.__ws = { sockets, blocked: false, opened: 0, port: 0 };
  const local = (url) => {
    try {
      const u = new URL(url, location.href);
      if (u.hostname.endsWith('.test')) u.hostname = 'localhost';
      if (window.__ws.port) u.port = String(window.__ws.port);        // a spec routes this page's sockets through a latency relay
      return u.href;
    } catch { return url; }
  };
  window.WebSocket = class extends Native {
    constructor(url, protocols) {
      if (window.__ws.blocked) { super('ws://127.0.0.1:1/blocked'); return; }
      super(local(url), protocols);
      window.__ws.opened++;
      sockets.push(this);
    }
  };
})();`;

/**
 * A player: a browser context with one page on the game, already past the title screen loader.
 * @param {object} o { browser, playwright, base, label, phone (bool), viewport, path, problems }
 */
export async function openPlayer({ browser, playwright, base, label, phone = false, viewport, path = '/', problems, small = false, device: custom = null }) {
  const device = custom ? { ...custom } : phone
    ? (small
      ? { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: playwright.devices['Pixel 5'].userAgent }
      : playwright.devices['Pixel 5'])
    : { viewport: viewport ?? { width: 1280, height: 720 }, deviceScaleFactor: 1 };
  const context = await browser.newContext({ ...device, permissions: [] });
  await context.addInitScript(WS_HOOK);
  const page = await context.newPage();
  const mine = problems ?? [];
  trackProblems(page, label, mine);
  await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}debug=1`);
  await page.waitForFunction(() => window.__bpReady === true, null, { timeout: 20000 });
  const p = {
    label, context, page, phone, problems: mine, base,
    probe: () => page.evaluate(() => window.__bp.probe()),
    /** Waits until fn(probe) is truthy; returns the probe. */
    until: async (fn, { timeout = 20000, what = 'condition' } = {}) => {
      const t0 = Date.now();
      let last = null;
      for (;;) {
        last = await p.probe().catch(() => null);
        if (last && fn(last)) return last;
        if (Date.now() - t0 > timeout) throw new Error(`[${label}] timed out waiting for ${what}; last probe: ${JSON.stringify(last)?.slice(0, 900)}`);
        await sleep(100);
      }
    },
    /** A screenshot once the finite CSS animations (pop-ins, dropping letters) have played out. */
    shot: async (name, { settle = true } = {}) => {
      if (settle) {
        await page.evaluate(() => Promise.race([
          Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]));
      }
      const file = join(SHOTS, `${name}.png`);
      await page.screenshot({ path: file });
      return file;
    },
    close: () => context.close(),
  };
  return p;
}

// ---- A slow network ----------------------------------------------------------------------------------------

/**
 * A WebSocket relay between a page and the real server that delays every frame in both directions by `delayMs` +- `jitterMs` (in order,
 * like TCP). Point a page at it with `page.evaluate((p) => { window.__ws.port = p; }, relay.port)` before it connects.
 */
export async function startLatencyRelay({ target, delayMs = 50, jitterMs = 15 }) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
  await new Promise((resolve) => wss.once('listening', resolve));
  const pipe = (from, to) => {
    let last = 0;
    from.on('message', (data, isBinary) => {
      const at = Math.max(last, Date.now() + delayMs + (Math.random() * 2 - 1) * jitterMs);
      last = at;
      const deliver = () => {
        if (to.readyState === WebSocket.CONNECTING) setTimeout(deliver, 5);      // the upstream socket is still opening: keep the order, wait
        else if (to.readyState === WebSocket.OPEN) to.send(data, { binary: isBinary });
      };
      setTimeout(deliver, Math.max(0, at - Date.now()));
    });
    from.on('close', (code) => setTimeout(() => { try { to.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000); } catch { /* gone */ } }, delayMs));
    from.on('error', () => {});
  };
  wss.on('connection', (client, req) => {
    const upstream = new WebSocket(`ws://localhost:${target}/ws`, { origin: req.headers.origin });
    upstream.on('error', () => client.close());
    pipe(client, upstream);
    pipe(upstream, client);
  });
  return { port: wss.address().port, close: () => new Promise((resolve) => { for (const c of wss.clients) c.terminate(); wss.close(() => resolve()); }) };
}

// ---- Driving the UI --------------------------------------------------------------------------------------

export async function typeName(p, name) {
  const input = p.page.locator('#name-input');
  await input.fill(name);
}

export async function createRoom(p, name) {
  await typeName(p, name);
  await p.page.getByRole('button', { name: /Create room/ }).click();
  const s = await p.until((x) => x.screen === 'lobby' && x.code.length === 4, { what: 'the lobby after Create room' });
  return s.code;
}

/** Opens /r/CODE, types a name, joins. `screen` is where the player should land: the lobby, or 'game' when a match is already running. */
export async function joinByLink(p, code, name, { screen = 'lobby' } = {}) {
  await p.page.goto(`${p.base}/r/${code}?debug=1`);
  await p.page.waitForFunction(() => window.__bpReady === true);
  await typeName(p, name);
  await p.page.getByRole('button', { name: 'Join', exact: true }).click();
  await p.until((x) => x.screen === screen && x.code === code, { what: `the ${screen} screen after Join` });
}

export async function pick(p, groupName, optionName) {
  await p.page.getByRole('radiogroup', { name: groupName }).getByRole('radio', { name: optionName, exact: true }).click();
}

export async function addBot(p, level) {
  await p.page.getByRole('button', { name: new RegExp(`Add ${level} bot`) }).click();
}

export async function startMatch(p) {
  await p.page.getByRole('button', { name: /Start match/ }).click();
}

/** The canvas as pixels: how many distinct colours it holds, its mean brightness, and how much of it is not the darkest tone. */
export async function canvasStats(p) {
  return p.page.evaluate(() => {
    const canvas = document.getElementById('arena');
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return { w, h, colours: 0, mean: 0, lit: 0 };
    // Read a copy: reading the game's own canvas repeatedly earns a console warning about willReadFrequently.
    const copy = document.createElement('canvas');
    copy.width = w;
    copy.height = h;
    const g = copy.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 0, 0);
    const data = g.getImageData(0, 0, w, h).data;
    const seen = new Set();
    let sum = 0;
    let lit = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      const l = (r + g + b) / 3;
      sum += l;
      if (l > 40) lit++;
      n++;
    }
    return { w, h, colours: seen.size, mean: sum / n, lit: lit / n };
  });
}

/** One finger on the phone: press at (x, y), drag by (dx, dy) over `ms`, hold for `hold`, lift. Uses CDP (Playwright only has tap). */
export async function touchDrag(p, cdp, x, y, dx, dy, { ms = 120, hold = 400 } = {}) {
  const at = (px, py) => [{ x: px, y: py, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(x, y) });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x + (dx * i) / steps, y + (dy * i) / steps) });
    await sleep(ms / steps);
  }
  await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/**
 * Holds each arrow in turn until the local blastie really moves (the spawn corner is random, so some arrows point into a wall).
 * @returns {Promise<{key: string, from: object, to: object} | null>}
 */
export async function nudge(p, { ms = 400, min = 0.6, keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'] } = {}) {
  for (const key of keys) {
    const a = (await p.probe()).view?.me;
    if (!a || !a.alive) return null;
    await p.page.keyboard.down(key);
    await sleep(ms);
    await p.page.keyboard.up(key);
    const b = (await p.probe()).view?.me;
    if (b && Math.hypot(b.x - a.x, b.y - a.y) > min) return { key, from: a, to: b };
  }
  return null;
}

/** A fighter of the given id as another client sees it (probe.view.players). */
export const fighter = (probe, id) => probe.view?.players.find((q) => q.id === id) ?? null;

export function writeReport(name, data) {
  writeFileSync(join(SHOTS, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// ---- Assertions -------------------------------------------------------------------------------------------

/** A tiny assertion recorder: scenarios call ok(name, condition, detail) and the runner prints a table. */
export function makeChecks() {
  const results = [];
  const ok = (name, condition, detail = '') => {
    results.push({ name, pass: !!condition, detail: String(detail) });
    console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail && !condition ? `  -> ${detail}` : detail ? `  (${detail})` : ''}`);
    return !!condition;
  };
  return { results, ok };
}
