#!/usr/bin/env node
// `npm run share`: starts the game server and puts it on the internet through a free tunnel, so anybody with the link
// can play. docs/SPEC.md section 11 has the contract; this file follows it step by step.
//
//   1. Start `node server/index.js` (PORT, TRUST_PROXY=1) and wait for GET /healthz.
//   2. Try the tunnel tools that are installed, in order: cloudflared, then ssh to localhost.run. Each prints its public
//      URL somewhere in its output; cloudflared gets one retry over HTTP/2 because QUIC (UDP 7844) is blocked on many networks.
//   3. Poll <url>/healthz through the tunnel and print the banner (URL, QR code, how to invite) only when it answers 200:
//      tunnels print the URL well before it works.
//   4. Keep everything running until Ctrl-C, then stop both child processes.
//
// Failure handling, all of it ends in a message that says what to do next:
//   - PORT is invalid, or already taken (checked before spawning, so a server running elsewhere is never mistaken for ours)
//   - the server exits or does not answer /healthz in 10 s (its last output lines are shown)
//   - no tunnel tool is installed (per-OS install hints + same-Wi-Fi URLs; the server stays up for the local network)
//   - a tunnel prints no URL, exits, or never becomes reachable (the next tool is tried; then the same-Wi-Fi fallback)
//   - the tunnel dies later ("the public link is dead"; free tunnel URLs change on every start, so there is no auto-restart)
//   - the server dies later (everything is stopped and the exit code is 1)
//
// Spec readings worth knowing:
//   - "nothing connects within 15 s" for the cloudflared retry is measured as "the public /healthz answers 200": that is
//     what connecting means to a player, and it does not depend on cloudflared's log wording.
//   - The reachability probe uses Node's fetch, which ignores HTTP(S)_PROXY. Behind a proxy-only network the probe fails
//     even when a phone could open the link, so the tunnel is reported as unusable. Better than a banner that lies.
//   - A URL in the tool output can be an API endpoint rather than the tunnel (an error quoting https://api.trycloudflare.com,
//     the localhost.run banner mentioning https://admin.localhost.run); those hosts are ignored.
//
// Everything with side effects is injectable (see createShare's options) so specs/unit/share.spec.js runs the whole
// flow against fake child processes; the pure helpers are exported for the same reason.

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 3000;

/** Every wait in the flow, in ms. Specs shrink them through the `timing` option. */
export const TIMING = Object.freeze({
  serverReadyMs: 10_000, // the game server must answer /healthz within this
  serverPollMs: 200,
  firstTryMs: 15_000, // cloudflared over QUIC gets this long to become reachable before the HTTP/2 retry
  urlWaitMs: 30_000, // a tunnel tool must print its URL within this
  reachableMs: 60_000, // ... and the URL must answer /healthz within this
  reachablePollMs: 1_500,
  requestMs: 4_000, // one /healthz request
  stopMs: 4_000, // a child gets this long to obey SIGTERM before SIGKILL
  settleMs: 300, // an exit is only reported as unexpected this long after it happened (see onUnexpectedExit)
});

/**
 * The tunnel tools in order of preference. `attempts(port)` lists the command lines to try with one tool; `quick`
 * marks an attempt that only gets `TIMING.firstTryMs` before the next one starts.
 */
export const TUNNELS = [
  {
    name: 'cloudflared',
    command: 'cloudflared',
    urlPattern: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
    ignoredSubdomains: ['api'], // error lines quote https://api.trycloudflare.com/tunnel
    attempts: (port) => {
      const base = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
      return [
        { label: 'cloudflared', args: base, quick: true },
        { label: 'cloudflared over HTTP/2', args: [...base, '--protocol', 'http2'], quick: false },
      ];
    },
  },
  {
    name: 'localhost.run',
    command: 'ssh',
    urlPattern: /https:\/\/[a-z0-9-]+\.(?:lhr\.life|localhost\.run)/i,
    ignoredSubdomains: ['admin', 'docs', 'www'], // the banner links to https://localhost.run/... and admin pages
    attempts: (port) => [
      {
        label: 'localhost.run',
        args: [
          '-T',
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'ServerAliveInterval=20',
          '-o', 'ServerAliveCountMax=3',
          '-o', 'ExitOnForwardFailure=yes',
          '-R', `80:127.0.0.1:${port}`,
          'nokey@localhost.run',
        ],
        quick: false,
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------

/** Removes terminal colour codes and hyperlinks, which some tools emit even into a pipe. */
export function stripAnsi(text) {
  return text.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g, '');
}

/**
 * Finds the public URL in a tunnel tool's output.
 * @param {string} text stdout and stderr merged; the tools disagree on which stream carries the URL
 * @param {RegExp} urlPattern matches the URL and nothing after it
 * @param {string[]} [ignoredSubdomains] hosts of the tool's own pages, which match the pattern but are not the tunnel
 * @returns {string | null} the first tunnel URL, lower-cased, or null
 */
export function extractTunnelUrl(text, urlPattern, ignoredSubdomains = []) {
  const global = new RegExp(urlPattern.source, urlPattern.flags.includes('g') ? urlPattern.flags : `${urlPattern.flags}g`);
  for (const [match] of stripAnsi(text).matchAll(global)) {
    const url = match.toLowerCase();
    const subdomain = url.slice('https://'.length).split('.')[0];
    if (!ignoredSubdomains.includes(subdomain)) return url;
  }
  return null;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `<baseUrl>/healthz` until it answers 200.
 * @param {string} baseUrl
 * @param {object} options
 * @param {number} options.timeoutMs give up after this long (one last request is made at the deadline)
 * @param {number} options.intervalMs pause between requests
 * @param {number} [options.requestMs] per-request timeout
 * @param {() => boolean} [options.shouldStop] checked before every request; true ends the wait ("the process died")
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @returns {Promise<{ ok: boolean, tries: number, reason?: string }>} `reason` = what the last try saw, when not ok
 */
export async function waitForHealth(baseUrl, options) {
  const { timeoutMs, intervalMs, requestMs = TIMING.requestMs, shouldStop = () => false, fetchImpl = globalThis.fetch, now = Date.now, sleep = defaultSleep } = options;
  const url = new URL('/healthz', baseUrl).href;
  const deadline = now() + timeoutMs;
  let reason = 'no answer';
  let tries = 0;
  for (;;) {
    if (shouldStop()) return { ok: false, tries, reason: 'stopped' };
    tries++;
    try {
      // `manual`: a redirect is somebody else's page (a captive portal, an interstitial), not our /healthz.
      const response = await fetchImpl(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(requestMs) });
      await response.body?.cancel?.();
      if (response.status === 200) return { ok: true, tries };
      reason = `HTTP ${response.status}`;
    } catch (error) {
      reason = error?.cause?.code ?? error?.name ?? 'error';
    }
    const left = deadline - now();
    if (left <= 0) return { ok: false, tries, reason };
    await sleep(Math.min(intervalMs, left));
  }
}

/**
 * Draws a QR matrix with half-block characters, two module rows per text row.
 * @param {boolean[][]} matrix true = dark module, without a quiet zone
 * @param {{ quiet?: number, ansi?: boolean }} [options] `quiet`: light border in modules. `ansi`: paint black on white with
 *   colour codes, which is right on any terminal theme. Without it the code is drawn "light on dark" (filled = light),
 *   which is right on the usual dark terminal and, at worst, an inverted code that phone cameras still read.
 * @returns {string[]} one string per text row, all the same width
 */
export function qrLines(matrix, { quiet = 2, ansi = true } = {}) {
  const size = matrix.length;
  const total = size + quiet * 2;
  const dark = (row, col) => row >= quiet && col >= quiet && row < quiet + size && col < quiet + size && matrix[row - quiet][col - quiet];
  const ink = ansi ? dark : (row, col) => !dark(row, col);
  const glyphs = [' ', '▄', '▀', '█']; // none, bottom half (▄), top half (▀), both (█)
  const lines = [];
  for (let row = 0; row < total; row += 2) {
    let line = '';
    for (let col = 0; col < total; col++) line += glyphs[(ink(row, col) ? 2 : 0) + (ink(row + 1, col) ? 1 : 0)];
    lines.push(ansi ? `\u001b[30;47m${line}\u001b[0m` : line);
  }
  return lines;
}

/**
 * The block printed once the public link works.
 * @param {{ url: string, qr?: boolean[][] | null, color?: boolean, lan?: string[] }} model
 * @returns {string}
 */
export function renderBanner({ url, qr = null, color = false, lan = [] }) {
  const style = (code) => (text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const bold = style('1;96');
  const dim = style('2');
  const title = 'BLAST PARTY is online! Open this link on any device:';
  const inner = Math.max(title.length, url.length + 6) + 4;
  const row = (text = '', paint = (s) => s) => `  ║${' '.repeat(Math.floor((inner - text.length) / 2))}${paint(text)}${' '.repeat(Math.ceil((inner - text.length) / 2))}║`;
  const lines = [
    '',
    `  ╔${'═'.repeat(inner)}╗`,
    row(),
    row(title),
    row(),
    row(url, bold),
    row(),
    `  ╚${'═'.repeat(inner)}╝`,
    '',
  ];
  if (qr) lines.push(...qrLines(qr, { ansi: color }).map((line) => `  ${line}`), '', '  Scan the code with a phone camera to open the game.');
  lines.push(
    '  Start a room, then share the invite link the lobby shows',
    `  (${url}/r/XXXX).`,
    '',
    dim('  The link changes every time you run this.'),
    dim('  Keep this window open while you play; press Ctrl-C to stop.'),
  );
  if (lan.length) lines.push(dim(`  Same Wi-Fi? These work without the internet: ${lan.join('  ')}`));
  lines.push('');
  return lines.join('\n');
}

/** http URLs other devices on the same network can use: every non-internal IPv4 address. */
export function lanUrls(port, interfaces = os.networkInterfaces()) {
  const urls = [];
  for (const addresses of Object.values(interfaces)) {
    for (const { address, family, internal } of addresses ?? []) {
      // Node 18.0-18.3 reported the family as the number 4; link-local (169.254.x.x) addresses are never reachable.
      if ((family === 'IPv4' || family === 4) && !internal && !address.startsWith('169.254.')) urls.push(`http://${address}:${port}`);
    }
  }
  return urls;
}

/** What to install when no tunnel tool is found, for the given `process.platform`. */
export function installHints(platform) {
  const cloudflared = {
    darwin: ['macOS:          brew install cloudflared'],
    win32: ['Windows:        winget install Cloudflare.cloudflared'],
    linux: [
      'Debian/Ubuntu:  download the .deb (amd64, or arm64 on a Raspberry Pi) from',
      '                https://github.com/cloudflare/cloudflared/releases/latest',
      '                then run: sudo dpkg -i cloudflared-linux-amd64.deb',
      'Other Linux:    the same page has binaries and .rpm packages',
    ],
  };
  const ssh = {
    darwin: ['macOS:          ssh is already installed'],
    win32: ['Windows 10/11:  Settings > Apps > Optional features > "OpenSSH Client"'],
    linux: ['Debian/Ubuntu:  sudo apt install openssh-client'],
  };
  const known = platform in cloudflared ? [platform] : Object.keys(cloudflared);
  return [
    'No tunnel tool found. To play over the internet, install one of these,',
    'then run `npm run share` again:',
    '',
    '  cloudflared (free, no account, recommended)',
    ...known.flatMap((system) => cloudflared[system].map((line) => `    ${line}`)),
    '',
    '  or an SSH client (free, no account; the link then comes from localhost.run)',
    ...known.flatMap((system) => ssh[system].map((line) => `    ${line}`)),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------------------------

/** A failure whose message is meant to be shown to the person running the command, without a stack trace. */
export class ShareError extends Error {}

const OUTPUT_KEEP = 16_384; // characters of a child's output kept for URL scanning and for error messages

const raceTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, null);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const isPortInUse = (port, host) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) => resolve(error.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen({ port, host, exclusive: true });
  });

const loadQrModule = () => import('../shared/qr.js');

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ShareError(`PORT must be a number between 1 and 65535 (got "${value}").`);
  return port;
}

const portBusyMessage = (port) =>
  [
    `Port ${port} is already in use, probably by another copy of the game server.`,
    'Stop that one, or pick another port:',
    `  macOS / Linux:  PORT=${port + 1} npm run share`,
    `  PowerShell:     $env:PORT=${port + 1}; npm run share`,
  ].join('\n');

/**
 * Starts the whole flow and returns at once with a controller; nothing throws synchronously.
 * @param {object} [options] every entry is a test seam with a real default
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.platform]
 * @param {string} [options.cwd] directory of the game (where server/index.js lives)
 * @param {string} [options.serverEntry]
 * @param {{ write(text: string): void, isTTY?: boolean }} [options.out]
 * @param {typeof nodeSpawn} [options.spawn]
 * @param {typeof nodeSpawnSync} [options.spawnSync]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {Partial<typeof TIMING>} [options.timing]
 * @param {typeof TUNNELS} [options.tunnels]
 * @param {() => Promise<{ qrMatrix(text: string): boolean[][] | null }>} [options.loadQr]
 * @param {(port: number, host: string) => Promise<boolean>} [options.portInUse]
 * @param {() => Record<string, os.NetworkInterfaceInfo[]>} [options.interfaces]
 * @returns {{
 *   ready: Promise<{ port: number, publicUrl: string | null, lan: string[] }>,
 *   done: Promise<number>,
 *   close(): Promise<void>,
 *   killNow(): void,
 * }} `ready` settles when the banner (or the reason there is none) has been printed and rejects with ShareError when
 *   nothing can run; `done` resolves with the exit code once everything has stopped; `close()` stops gracefully;
 *   `killNow()` is the synchronous last resort for a process 'exit' handler.
 */
export function createShare(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    cwd = ROOT,
    serverEntry = join(cwd, 'server', 'index.js'),
    out = process.stdout,
    spawn = nodeSpawn,
    spawnSync = nodeSpawnSync,
    fetchImpl = globalThis.fetch,
    tunnels = TUNNELS,
    loadQr = loadQrModule,
    portInUse = isPortInUse,
    interfaces = os.networkInterfaces,
  } = options;
  const timing = { ...TIMING, ...options.timing };
  const color = Boolean(out.isTTY) && !env.NO_COLOR;
  const paint = (code) => (text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const [dim, red, bold] = [paint('2'), paint('1;31'), paint('1')];
  const say = (text = '') => out.write(`${text}\n`);

  const children = new Set(); // every child process we started and have not seen exit
  let closing = false;
  let closed = null;
  let exitCode = 0;
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });

  /** Starts a child with piped output and tracks it. `tunnel` makes it look for a public URL in that output. */
  function launch(command, args, spawnOptions, tunnel = null) {
    // A tunnel keeps stdin open (never written to): ssh reads its session from it, and an immediate EOF could end the
    // session, and with it the forwarding, before the link is used.
    const child = spawn(command, args, { stdio: [tunnel ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, ...spawnOptions });
    child.stdin?.on?.('error', () => {});
    const proc = { child, output: '', url: null, running: true };
    let urlFound;
    proc.urlFound = new Promise((resolve) => {
      urlFound = resolve;
    });
    const feed = (chunk) => {
      proc.output = (proc.output + chunk).slice(-OUTPUT_KEEP);
      if (tunnel && !proc.url) {
        proc.url = extractTunnelUrl(proc.output, tunnel.urlPattern, tunnel.ignoredSubdomains);
        if (proc.url) urlFound(proc.url);
      }
    };
    // The pipes must always be drained: a child that fills a 64 KB pipe nobody reads blocks on its next log line.
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding?.('utf8');
      stream?.on('data', feed);
      stream?.on('error', () => {});
    }
    proc.exited = new Promise((resolve) => {
      // `on`, not `once`: a later failed kill() emits 'error' again, and an event without a listener would crash us.
      child.on('error', (error) => {
        if (child.pid !== undefined) return; // kill() failing lands here too; only a failed spawn ends the process
        proc.running = false;
        resolve({ error });
      });
      child.once('exit', (code, signal) => {
        proc.running = false;
        resolve({ code, signal });
      });
    });
    proc.exited.then(() => children.delete(proc));
    children.add(proc);
    return proc;
  }

  /**
   * Calls `report` when `proc` ends although nobody asked it to. A Ctrl-C reaches the children and this process at the
   * same moment, so the exit is judged a beat later, when `closing` has been set by our own signal handler.
   */
  function onUnexpectedExit(proc, report) {
    proc.exited.then((info) =>
      setTimeout(() => {
        if (!closing) report(info);
      }, timing.settleMs),
    );
  }

  const describeExit = ({ error, code, signal }) =>
    error ? `it could not start (${error.code ?? error.message})` : signal ? `it was stopped by ${signal}` : `it exited with code ${code}`;

  // The end of a process's output for an error message: no stack frames (they bury the one line that says what went
  // wrong) and no log timestamps (cloudflared prefixes every line with one).
  const tailOf = (proc, count) =>
    stripAnsi(proc.output)
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s+/, ''))
      .filter((line) => line && !line.startsWith('at '))
      .slice(-count);

  function showTail(proc, heading, count = 4) {
    const lines = tailOf(proc, count);
    if (!lines.length) return;
    say(dim(`  ${heading}`));
    for (const line of lines) say(dim(`    ${line}`));
  }

  function signalProc(proc, signal) {
    try {
      proc.child.kill(signal);
    } catch {
      // already gone
    }
    // A Windows child tree (cloudflared, ssh) does not always die with its parent handle.
    if (platform === 'win32' && proc.child.pid) spawnSync('taskkill', ['/pid', String(proc.child.pid), '/t', '/f'], { stdio: 'ignore' });
  }

  async function stop(proc) {
    if (!proc.running) return;
    signalProc(proc, 'SIGTERM');
    const force = setTimeout(() => signalProc(proc, 'SIGKILL'), timing.stopMs);
    await proc.exited;
    clearTimeout(force);
  }

  function close() {
    closing = true;
    closed ??= Promise.all([...children].map(stop)).then(() => finish(exitCode));
    return closed;
  }

  function killNow() {
    for (const proc of children) if (proc.running) signalProc(proc, 'SIGKILL');
  }

  const installed = (command) => spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true }).error?.code !== 'ENOENT';

  /** Waits for the tool's URL and then for that URL to answer. Resolves { ok: true } or { ok: false, problem }. */
  async function bringOnline(proc, attempt) {
    const started = Date.now();
    const budget = attempt.quick ? timing.firstTryMs : Infinity;
    const urlWait = Math.min(timing.urlWaitMs, budget);
    const url = await raceTimeout(Promise.race([proc.urlFound, proc.exited.then(() => null)]), urlWait);
    if (!url) {
      return { ok: false, problem: proc.running ? `it printed no link within ${Math.round(urlWait / 1000)} seconds` : describeExit(await proc.exited) };
    }
    say(dim('Link created; waiting for it to come online (up to a minute)...'));
    const health = await waitForHealth(url, {
      timeoutMs: attempt.quick ? Math.max(0, budget - (Date.now() - started)) : timing.reachableMs,
      intervalMs: timing.reachablePollMs,
      requestMs: timing.requestMs,
      shouldStop: () => closing || !proc.running,
      fetchImpl,
    });
    if (health.ok) return { ok: true };
    return { ok: false, problem: proc.running ? `the link never came online (last answer: ${health.reason})` : describeExit(await proc.exited) };
  }

  /** Runs one tool until its public URL answers, retrying per `tool.attempts`. Returns { url, proc } or null. */
  async function connect(tool, port) {
    const attempts = tool.attempts(port);
    for (const [index, attempt] of attempts.entries()) {
      if (closing) return null;
      say(dim(`Opening a public link with ${attempt.label}...`));
      const proc = launch(tool.command, attempt.args, {}, tool);
      const result = await bringOnline(proc, attempt);
      if (result.ok) return { url: proc.url, proc };
      await stop(proc);
      if (closing) return null;
      say(`${attempt.label} did not work: ${result.problem}.`);
      showTail(proc, 'Its last output:');
      if (index < attempts.length - 1) say(dim(attempt.quick ? 'Trying again over HTTP/2 (UDP is blocked on many networks)...' : 'Trying once more...'));
    }
    return null;
  }

  async function announce(url, lan) {
    let qr = null;
    try {
      qr = (await loadQr()).qrMatrix(url);
    } catch (error) {
      // A missing shared/qr.js is a valid setup (the QR is optional); anything else deserves a hint, not a crash.
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') say(dim(`(No QR code: ${error?.message ?? error})`));
    }
    say(renderBanner({ url, qr, color, lan }));
  }

  function sameNetworkOnly(lan) {
    if (lan.length) {
      say('Players on the same Wi-Fi can still join at:');
      for (const url of lan) say(`  ${bold(url)}`);
      say(dim('  (On plain http there is no copy button: select the invite link and copy it.)'));
    }
    say(dim('The game server keeps running. Press Ctrl-C to stop it.'));
  }

  async function start() {
    const port = parsePort(env.PORT);
    if (await portInUse(port, env.HOST || '0.0.0.0')) throw new ShareError(portBusyMessage(port));
    if (closing) throw new ShareError('Stopped.');

    say(dim(`Starting the game server on port ${port}...`));
    const server = launch(process.execPath, [serverEntry], { cwd, env: { ...env, PORT: String(port), TRUST_PROXY: '1' } });
    const local = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(local, {
      timeoutMs: timing.serverReadyMs,
      intervalMs: timing.serverPollMs,
      requestMs: timing.requestMs,
      shouldStop: () => closing || !server.running,
      fetchImpl,
    });
    if (!health.ok) {
      if (closing) throw new ShareError('Stopped.');
      const tail = tailOf(server, 10);
      let why = server.running
        ? `The game server did not answer ${local}/healthz within ${Math.round(timing.serverReadyMs / 1000)} seconds.`
        : `The game server stopped right after it started (${describeExit(await server.exited)}).`;
      if (/EADDRINUSE|address already in use/i.test(server.output)) why = portBusyMessage(port);
      else if (/Cannot find (?:module|package)/.test(server.output)) why += '\nA file or dependency is missing: run `npm install` in the bomberman folder, then try again.';
      throw new ShareError([why, ...(tail.length ? ['Its last output:', ...tail.map((line) => `  ${line}`)] : [])].join('\n'));
    }
    say(`Game server is running on ${local}`);
    onUnexpectedExit(server, (info) => {
      exitCode = 1;
      say(red(`The game server stopped unexpectedly (${describeExit(info)}).`));
      showTail(server, 'Its last output:', 8);
      close();
    });

    const lan = lanUrls(port, interfaces());
    const present = tunnels.filter((tool) => installed(tool.command));
    if (!present.length) {
      say();
      for (const line of installHints(platform)) say(line);
      say();
      sameNetworkOnly(lan);
      return { port, publicUrl: null, lan };
    }

    const missing = tunnels.filter((tool) => !present.includes(tool)).map((tool) => tool.command);
    if (missing.length) say(dim(`Not installed, skipped: ${missing.join(', ')}.`));
    for (const tool of present) {
      const link = await connect(tool, port);
      if (closing) throw new ShareError('Stopped.');
      if (!link) continue;
      onUnexpectedExit(link.proc, () => say(red('Tunnel closed: the public link is dead. Press Ctrl-C and run again.')));
      await announce(link.url, lan);
      return { port, publicUrl: link.url, lan };
    }
    say();
    say(red('Could not open a public link (see above).'));
    sameNetworkOnly(lan);
    return { port, publicUrl: null, lan };
  }

  const ready = start().catch(async (error) => {
    if (!closing) exitCode = 1;
    await close();
    throw error;
  });
  ready.catch(() => {}); // the caller decides how to show a failure; never an unhandled rejection
  return { ready, done, close, killNow };
}

// ---------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const share = createShare();
  let signalled = false;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (signalled) {
        share.killNow(); // a second Ctrl-C means "now"
        process.exit(1);
      }
      signalled = true;
      process.stdout.write('\nStopping...\n');
      share.close();
    });
  }
  process.on('exit', share.killNow);

  try {
    await share.ready;
  } catch (error) {
    if (!signalled) console.error(error instanceof ShareError ? `\n${error.message}\n` : error);
  }
  process.exit(await share.done);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
