import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
  createShare, extractTunnelUrl, installHints, lanUrls, qrLines, renderBanner, ShareError, stripAnsi, TUNNELS, waitForHealth,
} from '../../scripts/share.js';
import { crc32, encodePng, renderIcon } from '../../scripts/make-icons.mjs';

// scripts/share.js (`npm run share`) and the app icons of scripts/make-icons.mjs, both owned by the ops role.
// share.js is tested three ways: its pure helpers against realistic tool output, the orchestration against fake child
// processes (every failure branch of docs/SPEC.md section 11), and one smoke test with real child processes.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ---- Realistic tool output ---------------------------------------------------------------------------------------

// What `cloudflared tunnel --url ...` writes to STDERR (the URL is in the box; nothing useful is on stdout).
const CLOUDFLARED_OK = `2026-09-29T18:01:12Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee. If you intend to use Tunnels in production you should use a pre-created named tunnel by following: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps
2026-09-29T18:01:12Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-09-29T18:01:15Z INF +--------------------------------------------------------------------------------------------+
2026-09-29T18:01:15Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-09-29T18:01:15Z INF |  https://wooden-purple-lamp-crest.trycloudflare.com                                        |
2026-09-29T18:01:15Z INF +--------------------------------------------------------------------------------------------+
2026-09-29T18:01:15Z INF Cannot determine default configuration path. No file [config.yml config.yaml] in [~/.cloudflared ~/.cloudflare-warp ~/cloudflare-warp]
2026-09-29T18:01:15Z INF Version 2024.6.1
2026-09-29T18:01:15Z INF Settings: map[ha-connections:1 no-autoupdate:true protocol:quic url:http://127.0.0.1:3000]
2026-09-29T18:01:15Z INF Initial protocol quic
2026-09-29T18:01:15Z INF Starting metrics server on 127.0.0.1:20241/metrics
2026-09-29T18:01:16Z INF Registered tunnel connection connIndex=0 connection=8a4f2c1e-77d0-4c41-9d0e-52b1a0b3c9aa event=0 ip=198.41.192.77 location=fra06 protocol=quic
`;

// The quick-tunnel API is down: the only trycloudflare URL in the output is the endpoint, not a tunnel.
const CLOUDFLARED_API_DOWN = `2026-09-29T18:03:00Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-09-29T18:03:10Z ERR Error unmarshaling QuickTunnel response: error="invalid character '<' looking for beginning of value" status_code="429 Too Many Requests"
failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host
`;

// `ssh -R 80:... nokey@localhost.run`: the URL is in a sentence on stdout, next to documentation links.
const LOCALHOST_RUN = `Warning: Permanently added 'localhost.run' (RSA) to the list of known hosts.

===============================================================================
Welcome to localhost.run!

Follow @localhost_run on Twitter to hear about new features and get support.
Read the docs on https://localhost.run/docs/ for more information.

** your connection id is 4e9c9a5b-9d91-4c72-8f5e-1a2b3c4d5e6f, please mention it if you send me a message about an issue. **

authenticated as anonymous user
6a1f0bd3b8d2b4.lhr.life tunneled with tls termination, https://6a1f0bd3b8d2b4.lhr.life
create an account and add your key for a longer lasting domain name.  see https://localhost.run/docs/forever-free/ for more information.
Open your tunnel address on your phone with this QR:
`;

const tunnel = (name) => TUNNELS.find((t) => t.name === name);

describe('extractTunnelUrl', () => {
  test('finds the trycloudflare URL inside the stderr box', () => {
    const { urlPattern, ignoredSubdomains } = tunnel('cloudflared');
    assert.equal(extractTunnelUrl(CLOUDFLARED_OK, urlPattern, ignoredSubdomains), 'https://wooden-purple-lamp-crest.trycloudflare.com');
  });

  test('finds the lhr.life URL and ignores the documentation links around it', () => {
    const { urlPattern, ignoredSubdomains } = tunnel('localhost.run');
    assert.equal(extractTunnelUrl(LOCALHOST_RUN, urlPattern, ignoredSubdomains), 'https://6a1f0bd3b8d2b4.lhr.life');
  });

  test('older localhost.run domains and upper-case output are accepted and normalised', () => {
    const { urlPattern, ignoredSubdomains } = tunnel('localhost.run');
    assert.equal(extractTunnelUrl('Connect to HTTPS://ABC123DEF.LOCALHOST.RUN now', urlPattern, ignoredSubdomains), 'https://abc123def.localhost.run');
  });

  test('the tool\'s own hosts are not tunnels', () => {
    const cf = tunnel('cloudflared');
    assert.equal(extractTunnelUrl(CLOUDFLARED_API_DOWN, cf.urlPattern, cf.ignoredSubdomains), null);
    const lr = tunnel('localhost.run');
    assert.equal(extractTunnelUrl('see https://admin.localhost.run/ and https://docs.localhost.run', lr.urlPattern, lr.ignoredSubdomains), null);
    // ... but a real URL after the API one still wins
    assert.equal(
      extractTunnelUrl(`${CLOUDFLARED_API_DOWN}${CLOUDFLARED_OK}`, cf.urlPattern, cf.ignoredSubdomains),
      'https://wooden-purple-lamp-crest.trycloudflare.com',
    );
  });

  test('ignores colour codes and returns null when there is no URL yet', () => {
    const { urlPattern } = tunnel('cloudflared');
    assert.equal(extractTunnelUrl('\u001b[1;32mhttps://\u001b[0mnope', urlPattern), null);
    assert.equal(extractTunnelUrl('\u001b[92mhttps://calm-river.trycloudflare.com\u001b[0m', urlPattern), 'https://calm-river.trycloudflare.com');
    assert.equal(extractTunnelUrl('', urlPattern), null);
    assert.equal(extractTunnelUrl('2026 INF Requesting new quick Tunnel on trycloudflare.com...', urlPattern), null);
  });

  test('does not mutate a global or sticky pattern it is given', () => {
    const pattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
    assert.equal(extractTunnelUrl(CLOUDFLARED_OK, pattern), 'https://wooden-purple-lamp-crest.trycloudflare.com');
    assert.equal(extractTunnelUrl(CLOUDFLARED_OK, pattern), 'https://wooden-purple-lamp-crest.trycloudflare.com');
    assert.equal(pattern.lastIndex, 0);
  });

  test('stripAnsi removes CSI and OSC-8 sequences only', () => {
    assert.equal(stripAnsi('\u001b[30;47m▀▄\u001b[0m ok'), '▀▄ ok');
    assert.equal(stripAnsi('\u001b]8;;https://x.test\u0007link\u001b]8;;\u0007'), 'link');
  });
});

describe('waitForHealth', () => {
  // A clock that only moves when the code sleeps, so nothing here takes real time.
  function fakeTime() {
    const time = { t: 1000, sleeps: [] };
    time.now = () => time.t;
    time.sleep = async (ms) => {
      time.sleeps.push(ms);
      time.t += ms;
    };
    return time;
  }
  const reply = (status) => ({ status, body: { cancel: () => {} } });

  test('returns as soon as /healthz answers 200 and counts the tries', async () => {
    const time = fakeTime();
    const answers = [reply(530), Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), reply(200)];
    const urls = [];
    const fetchImpl = async (url, init) => {
      urls.push([url, init.redirect, init.cache]);
      return answers.shift();
    };
    const result = await waitForHealth('https://x.trycloudflare.com', { fetchImpl, timeoutMs: 60_000, intervalMs: 1500, now: time.now, sleep: time.sleep });
    assert.deepEqual(result, { ok: true, tries: 3 });
    assert.deepEqual(time.sleeps, [1500, 1500]);
    assert.deepEqual(urls[0], ['https://x.trycloudflare.com/healthz', 'manual', 'no-store']);
  });

  test('gives up at the deadline (after one last try) and says what it saw', async () => {
    const time = fakeTime();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return reply(530);
    };
    const result = await waitForHealth('https://x.test', { fetchImpl, timeoutMs: 4000, intervalMs: 1500, now: time.now, sleep: time.sleep });
    assert.deepEqual(result, { ok: false, tries: 4, reason: 'HTTP 530' });
    assert.equal(calls, 4); // t = 0, 1500, 3000 and a shortened final sleep to exactly 4000
    assert.deepEqual(time.sleeps, [1500, 1500, 1000]);
  });

  test('a redirect, a 204 or a 503 is not healthy; only 200 is', async () => {
    for (const status of [204, 301, 302, 404, 503]) {
      const time = fakeTime();
      const result = await waitForHealth('https://x.test', { fetchImpl: async () => reply(status), timeoutMs: 10, intervalMs: 5, now: time.now, sleep: time.sleep });
      assert.equal(result.ok, false, String(status));
      assert.equal(result.reason, `HTTP ${status}`);
    }
  });

  test('reports the network error code, and the request carries a timeout signal', async () => {
    const time = fakeTime();
    let signal;
    const fetchImpl = async (url, init) => {
      signal = init.signal;
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    const result = await waitForHealth('https://x.test', { fetchImpl, timeoutMs: 1, intervalMs: 1, now: time.now, sleep: time.sleep });
    assert.equal(result.reason, 'ECONNREFUSED');
    assert.ok(signal instanceof AbortSignal);
  });

  test('shouldStop ends the wait before any request is made', async () => {
    const fetchImpl = async () => assert.fail('must not be called');
    const result = await waitForHealth('https://x.test', { fetchImpl, timeoutMs: 1000, intervalMs: 10, shouldStop: () => true });
    assert.deepEqual(result, { ok: false, tries: 0, reason: 'stopped' });
  });

  test('cancels the response body so the socket is released', async () => {
    let cancelled = 0;
    await waitForHealth('https://x.test', { fetchImpl: async () => ({ status: 200, body: { cancel: () => cancelled++ } }), timeoutMs: 1, intervalMs: 1 });
    assert.equal(cancelled, 1);
  });
});

describe('qrLines', () => {
  // Reads half-block text back into modules, independent of how qrLines built it.
  function decode(lines, { ansi }) {
    const rows = [];
    for (const line of lines) {
      const chars = [...stripAnsi(line)];
      const top = chars.map((c) => c === '▀' || c === '█');
      const bottom = chars.map((c) => c === '▄' || c === '█');
      rows.push(ansi ? top : top.map((v) => !v), ansi ? bottom : bottom.map((v) => !v)); // plain mode paints the LIGHT modules
    }
    return rows;
  }
  const finder = [ // a 5x5 test pattern with a lone module in the corner, so orientation mistakes show
    [true, true, true, true, true],
    [true, false, false, false, true],
    [true, false, true, false, true],
    [true, false, false, false, true],
    [true, true, true, true, false],
  ];

  test('draws two module rows per text line with ▀ ▄ █ (exact output for a hand-computed matrix)', () => {
    const matrix = [[true, false], [true, true]];
    // top+bottom dark, then only the bottom dark
    assert.deepEqual(qrLines(matrix, { quiet: 0, ansi: true }), ['\u001b[30;47m█▄\u001b[0m']);
    // plain mode paints the light modules instead: neither is light in column 0, only the top one is in column 1
    assert.deepEqual(qrLines(matrix, { quiet: 0, ansi: false }), [' ▀']);
    // an odd number of module rows is padded with a light row
    const checker = [[true, false, true], [false, true, false], [true, false, true]];
    assert.deepEqual(qrLines(checker, { quiet: 0, ansi: true }).map(stripAnsi), ['▀▄▀', '▀ ▀']);
    assert.deepEqual(qrLines(checker, { quiet: 0, ansi: false }), ['▄▀▄', '▄█▄']);
  });

  test('the quiet zone is 2 modules by default, so lines are size+4 wide and (size+4)/2 tall', () => {
    const lines = qrLines(finder, { ansi: false });
    assert.equal(lines.length, Math.ceil((5 + 4) / 2));
    assert.ok(lines.every((line) => [...line].length === 9));
    assert.match(lines.join(''), /^[ ▀▄█]+$/);
    assert.equal(lines[0], '█'.repeat(9), 'the first line is all quiet zone (light, so filled in plain mode)');
  });

  test('round-trips the matrix in both colour modes (quiet zone light, odd row count padded light)', () => {
    for (const ansi of [true, false]) {
      const modules = decode(qrLines(finder, { ansi }), { ansi });
      const expected = (row, col) => row >= 2 && col >= 2 && row < 7 && col < 7 && finder[row - 2][col - 2];
      for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) assert.equal(Boolean(modules[row][col]), Boolean(expected(row, col)), `ansi=${ansi} ${row},${col}`);
    }
  });

  test('ansi mode paints black on white per line and resets; plain mode has no escape codes', () => {
    const [first] = qrLines(finder, { ansi: true });
    assert.ok(first.startsWith('\u001b[30;47m') && first.endsWith('\u001b[0m'));
    assert.ok(qrLines(finder, { ansi: false }).every((line) => !line.includes('\u001b')));
  });

  test('quiet zone width is configurable', () => {
    assert.equal([...qrLines(finder, { quiet: 4, ansi: false })[0]].length, 13);
    assert.equal([...qrLines(finder, { quiet: 0, ansi: false })[0]].length, 5);
  });

  test('renders what shared/qr.js produces for a tunnel URL, when that module exists', async (t) => {
    let qr;
    try {
      qr = await import('../../shared/qr.js');
    } catch {
      return t.skip('shared/qr.js is not implemented');
    }
    const matrix = qr.qrMatrix('https://wooden-purple-lamp-crest.trycloudflare.com');
    assert.ok(matrix, 'a tunnel URL must fit the QR');
    const lines = qrLines(matrix);
    assert.equal(lines.length, Math.ceil((matrix.length + 4) / 2));
    assert.ok(lines.length <= 24, 'must fit a default 80x24 terminal together with the text around it');
  });
});

describe('renderBanner', () => {
  const url = 'https://wooden-purple-lamp-crest.trycloudflare.com';
  const qr = [[true, false, true], [false, true, false], [true, false, true]];

  test('shows the URL in a frame, the invite hint with the room-code placeholder, and no QR when there is none', () => {
    const text = renderBanner({ url });
    assert.match(text, /║ +https:\/\/wooden-purple-lamp-crest\.trycloudflare\.com +║/);
    assert.match(text, new RegExp(`share the invite link the lobby shows\\s+\\(${url}/r/XXXX\\)`));
    assert.ok(!/[▀▄█]/.test(text), 'the QR block is omitted');
    assert.ok(!text.includes('\u001b'), 'no colour codes unless asked for');
  });

  test('the frame is rectangular however long the URL is', () => {
    const framed = renderBanner({ url: 'https://a-very-long-name-with-many-words-in-it-indeed.trycloudflare.com' }).split('\n').filter((l) => /^ {2}[╔║╚]/.test(l));
    assert.equal(framed.length, 7);
    assert.equal(new Set(framed.map((l) => [...l].length)).size, 1);
  });

  test('includes the QR block between the frame and the invite text when a matrix is given', () => {
    const text = renderBanner({ url, qr });
    assert.ok(/[▀▄█]/.test(text));
    assert.ok(text.indexOf('╚') < text.search(/[▀▄█]/) && text.search(/[▀▄█]/) < text.indexOf('/r/XXXX'));
    assert.match(text, /Scan the code/);
  });

  test('colour mode bolds the URL and paints the QR black on white; plain mode does neither', () => {
    const colored = renderBanner({ url, qr, color: true });
    assert.ok(colored.includes('\u001b[30;47m') && colored.includes(`\u001b[1;96m${url}\u001b[0m`));
    assert.ok(!renderBanner({ url, qr, color: false }).includes('\u001b'));
  });

  test('lists same-Wi-Fi addresses when given', () => {
    assert.match(renderBanner({ url, lan: ['http://192.168.1.20:3000', 'http://10.0.0.5:3000'] }), /Same Wi-Fi\?.*192\.168\.1\.20:3000.*10\.0\.0\.5:3000/);
    assert.ok(!renderBanner({ url }).includes('Same Wi-Fi'));
  });
});

describe('lanUrls and installHints', () => {
  test('lanUrls keeps external IPv4 addresses only', () => {
    const interfaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: 'fe80::1', family: 'IPv6', internal: false }, { address: '192.168.1.20', family: 'IPv4', internal: false }],
      wlan0: [{ address: '10.0.0.5', family: 4, internal: false }, { address: '169.254.9.9', family: 'IPv4', internal: false }],
      down: undefined,
    };
    assert.deepEqual(lanUrls(3000, interfaces), ['http://192.168.1.20:3000', 'http://10.0.0.5:3000']);
    assert.deepEqual(lanUrls(3000, {}), []);
  });

  test('install hints name the right package manager for each OS and always offer the ssh option', () => {
    const mac = installHints('darwin').join('\n');
    assert.match(mac, /brew install cloudflared/);
    assert.match(mac, /ssh is already installed/);
    assert.ok(!/winget/.test(mac));
    const win = installHints('win32').join('\n');
    assert.match(win, /winget install Cloudflare\.Cloudflared/i);
    assert.match(win, /OpenSSH Client/);
    const linux = installHints('linux').join('\n');
    assert.match(linux, /github\.com\/cloudflare\/cloudflared\/releases/);
    assert.match(linux, /\.deb/);
    assert.match(linux, /openssh-client/);
    const other = installHints('freebsd').join('\n');
    assert.ok(/brew install cloudflared/.test(other) && /winget/.test(other) && /\.deb/.test(other), 'an unknown OS gets every hint');
  });
});

// ---- Orchestration with fake child processes ---------------------------------------------------------------------

class FakeStream extends EventEmitter {
  setEncoding() {}
}

/** A child_process stand-in: scripted output, exit on kill (unless it ignores SIGTERM). */
class FakeProcess extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.signals = [];
    this.exited = false;
    this.ignoreSigterm = false;
  }

  kill(signal = 'SIGTERM') {
    this.signals.push(signal);
    if (signal === 'SIGKILL' || !this.ignoreSigterm) setImmediate(() => this.exit(null, signal));
    return true;
  }

  exit(code = 0, signal = null) {
    if (this.exited) return;
    this.exited = true;
    this.emit('exit', code, signal);
  }

  print(text, stream = 'stderr') {
    this[stream].emit('data', text);
  }
}

const FAST = { serverReadyMs: 400, serverPollMs: 5, firstTryMs: 120, urlWaitMs: 120, reachableMs: 200, reachablePollMs: 5, requestMs: 100, stopMs: 60, settleMs: 5 };

/**
 * Wires createShare to fake spawn/spawnSync/fetch. `scripts` maps 'server' | 'cloudflared' | 'ssh' to a function run
 * (asynchronously, so the listeners exist) with (proc, args) when that command is spawned; `answer(url)` returns the
 * HTTP status the fake network gives a /healthz request (a thrown Error is a network failure).
 */
function harness({ installed = ['cloudflared', 'ssh'], scripts = {}, answer = () => 200, share = {}, platform = 'linux' } = {}) {
  const events = []; // one shared timeline of output and requests, to assert "banner AFTER the 200"
  const spawned = [];
  const sync = [];
  const requests = [];
  let nextPid = 100;
  const out = {
    isTTY: false,
    write: (text) => events.push({ type: 'out', text }),
    get text() {
      return events.filter((e) => e.type === 'out').map((e) => e.text).join('');
    },
  };
  const spawn = (command, args, options) => {
    const name = command === process.execPath ? 'server' : command;
    const proc = new FakeProcess(nextPid++);
    spawned.push({ name, command, args, options, proc });
    setImmediate(() => scripts[name]?.(proc, args, options));
    return proc;
  };
  const spawnSync = (command, args) => {
    sync.push([command, args]);
    if (args[0] === '--version' && !installed.includes(command)) return { error: Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' }) };
    return { status: 0 };
  };
  const fetchImpl = async (url) => {
    const result = answer(new URL(url));
    requests.push(url);
    events.push({ type: 'fetch', url, result });
    if (result instanceof Error) throw result;
    return { status: result, body: { cancel: () => {} } };
  };
  const created = createShare({
    env: { PORT: '3000' },
    platform,
    cwd: '/game',
    spawn,
    spawnSync,
    fetchImpl,
    out,
    timing: FAST,
    loadQr: async () => ({ qrMatrix: () => [[true, false], [false, true]] }),
    portInUse: async () => false,
    interfaces: () => ({ eth0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] }),
    ...share,
  });
  const by = (name) => spawned.filter((s) => s.name === name);
  return { ...created, events, spawned, sync, requests, out, by };
}

const serverUp = { server: () => {} };
const isLocal = (url) => url.hostname === '127.0.0.1';
const cloudflaredOk = (proc) => {
  proc.print(CLOUDFLARED_OK.slice(0, 700));
  setImmediate(() => proc.print(CLOUDFLARED_OK.slice(700)));
};

describe('createShare: the happy path', () => {
  test('starts the server, opens cloudflared, prints the banner only after the public /healthz answered 200, and stops both children', async () => {
    let publicTries = 0;
    const h = harness({
      scripts: { ...serverUp, cloudflared: cloudflaredOk },
      answer: (url) => (isLocal(url) ? 200 : ++publicTries < 3 ? 530 : 200),
    });
    const result = await h.ready;
    assert.deepEqual(result, { port: 3000, publicUrl: 'https://wooden-purple-lamp-crest.trycloudflare.com', lan: ['http://192.168.1.20:3000'] });

    const [server] = h.by('server');
    assert.equal(server.command, process.execPath);
    assert.deepEqual(server.args, ['/game/server/index.js']);
    assert.equal(server.options.env.PORT, '3000');
    assert.equal(server.options.env.TRUST_PROXY, '1');
    assert.equal(server.options.cwd, '/game');

    const [cf] = h.by('cloudflared');
    assert.deepEqual(cf.args, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3000']);
    assert.deepEqual(h.sync.filter(([, args]) => args[0] === '--version').map(([command]) => command), ['cloudflared', 'ssh']);

    const publicRequests = h.events.filter((e) => e.type === 'fetch' && !isLocal(new URL(e.url)));
    assert.deepEqual(publicRequests.map((e) => e.result), [530, 530, 200]);
    assert.ok(publicRequests.every((e) => e.url === 'https://wooden-purple-lamp-crest.trycloudflare.com/healthz'));
    const last200 = h.events.indexOf(publicRequests.at(-1));
    const banner = h.events.findIndex((e) => e.type === 'out' && e.text.includes('BLAST PARTY is online'));
    assert.ok(banner > last200 && last200 > 0, 'the banner must come after the 200');
    assert.match(h.out.text, /https:\/\/wooden-purple-lamp-crest\.trycloudflare\.com\/r\/XXXX/);
    assert.match(h.out.text, /[▀▄█]/, 'the QR is drawn');

    await h.close();
    assert.equal(await h.done, 0);
    assert.deepEqual(server.proc.signals, ['SIGTERM']);
    assert.deepEqual(cf.proc.signals, ['SIGTERM']);
    assert.ok(!h.out.text.includes('Tunnel closed'), 'stopping on purpose is not a dead tunnel');
    assert.ok(!h.out.text.includes('stopped unexpectedly'));
  });

  test('a URL split across two output chunks is still found', async () => {
    const h = harness({
      scripts: { ...serverUp, cloudflared: (proc) => {
        proc.print('INF |  https://wooden-purp');
        setImmediate(() => proc.print('le-lamp-crest.trycloudflare.com   |\n'));
      } },
    });
    assert.equal((await h.ready).publicUrl, 'https://wooden-purple-lamp-crest.trycloudflare.com');
    await h.close();
  });

  test('output on stdout counts too (the tools disagree on the stream)', async () => {
    const h = harness({ scripts: { ...serverUp, cloudflared: (proc) => proc.print(CLOUDFLARED_OK, 'stdout') } });
    assert.equal((await h.ready).publicUrl, 'https://wooden-purple-lamp-crest.trycloudflare.com');
    await h.close();
  });

  test('without shared/qr.js the banner has no QR and no complaint; a broken qr.js is mentioned but does not stop the banner', async () => {
    const missing = Object.assign(new Error("Cannot find module '../shared/qr.js'"), { code: 'ERR_MODULE_NOT_FOUND' });
    const h1 = harness({ scripts: { ...serverUp, cloudflared: cloudflaredOk }, share: { loadQr: async () => { throw missing; } } });
    await h1.ready;
    assert.ok(!/[▀▄█]/.test(h1.out.text) && !h1.out.text.includes('No QR'));
    assert.match(h1.out.text, /BLAST PARTY is online/);
    await h1.close();

    const h2 = harness({ scripts: { ...serverUp, cloudflared: cloudflaredOk }, share: { loadQr: async () => { throw new SyntaxError('Unexpected token'); } } });
    await h2.ready;
    assert.match(h2.out.text, /No QR code: Unexpected token/);
    assert.match(h2.out.text, /BLAST PARTY is online/);
    await h2.close();

    const h3 = harness({ scripts: { ...serverUp, cloudflared: cloudflaredOk }, share: { loadQr: async () => ({ qrMatrix: () => null }) } });
    await h3.ready;
    assert.ok(!/[▀▄█]/.test(h3.out.text), 'text too long for the QR: no block');
    await h3.close();
  });

  test('uses colour on a TTY unless NO_COLOR is set, and never on a pipe', async () => {
    const run = async (isTTY, env) => {
      const written = [];
      const h = harness({ scripts: { ...serverUp, cloudflared: cloudflaredOk }, share: { out: { isTTY, write: (text) => written.push(text) }, env } });
      await h.ready;
      await h.close();
      return written.join('');
    };
    assert.ok((await run(true, { PORT: '3000' })).includes('\u001b[30;47m'), 'QR painted black on white');
    assert.ok(!(await run(true, { PORT: '3000', NO_COLOR: '1' })).includes('\u001b'));
    assert.ok(!(await run(false, { PORT: '3000' })).includes('\u001b'));
  });
})

describe('createShare: tunnel fallbacks', () => {
  test('cloudflared that connects nothing over QUIC is retried once with --protocol http2 and the second link is used', async () => {
    let starts = 0;
    const h = harness({
      scripts: {
        ...serverUp,
        cloudflared: (proc) => {
          starts++;
          proc.print(`INF |  https://${starts === 1 ? 'quic-stuck-one' : 'http2-works-two'}.trycloudflare.com  |\n`);
        },
      },
      answer: (url) => (isLocal(url) || url.hostname.startsWith('http2') ? 200 : 530),
    });
    const result = await h.ready;
    assert.equal(result.publicUrl, 'https://http2-works-two.trycloudflare.com');
    const [first, second] = h.by('cloudflared');
    assert.ok(!first.args.includes('--protocol'));
    assert.deepEqual(second.args, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3000', '--protocol', 'http2']);
    assert.deepEqual(first.proc.signals, ['SIGTERM'], 'the stuck tunnel is stopped before the retry');
    assert.match(h.out.text, /HTTP\/2/);
    assert.ok(!h.out.text.includes('quic-stuck-one.trycloudflare.com/r/'), 'the dead link is never offered as an invite');
    await h.close();
  });

  test('the first cloudflared attempt gets the short budget (15 s in production), not the long reachability one (60 s)', async () => {
    const spawnedAt = [];
    const h = harness({
      scripts: {
        ...serverUp,
        cloudflared: (proc) => {
          spawnedAt.push(Date.now());
          proc.print(`INF |  https://try-${spawnedAt.length}.trycloudflare.com  |\n`);
        },
      },
      answer: (url) => (isLocal(url) || url.hostname === 'try-2.trycloudflare.com' ? 200 : 530),
      share: { timing: { ...FAST, firstTryMs: 60, reachableMs: 5000 } },
    });
    await h.ready;
    const gap = spawnedAt[1] - spawnedAt[0];
    assert.ok(gap >= 50 && gap < 1000, `the retry started ${gap} ms after the first attempt`);
    await h.close();
  });

  test('without cloudflared the ssh tunnel to localhost.run is used with the exact command line', async () => {
    const h = harness({ installed: ['ssh'], scripts: { ...serverUp, ssh: (proc) => proc.print(LOCALHOST_RUN, 'stdout') } });
    const result = await h.ready;
    assert.equal(result.publicUrl, 'https://6a1f0bd3b8d2b4.lhr.life');
    assert.equal(h.by('cloudflared').length, 0);
    assert.deepEqual(h.by('ssh')[0].args, [
      '-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
      '-o', 'ExitOnForwardFailure=yes', '-R', '80:127.0.0.1:3000', 'nokey@localhost.run',
    ]);
    assert.match(h.out.text, /Not installed, skipped: cloudflared/);
    await h.close();
  });

  test('cloudflared that never yields a link falls through to ssh', async () => {
    const h = harness({
      scripts: { ...serverUp, cloudflared: (proc) => proc.print(CLOUDFLARED_API_DOWN), ssh: (proc) => proc.print(LOCALHOST_RUN, 'stdout') },
    });
    const result = await h.ready;
    assert.equal(result.publicUrl, 'https://6a1f0bd3b8d2b4.lhr.life');
    assert.equal(h.by('cloudflared').length, 2, 'both cloudflared attempts were made first');
    assert.match(h.out.text, /cloudflared did not work: it printed no link within/);
    assert.match(h.out.text, /no such host/, 'the tool\'s own last words are shown');
    await h.close();
  });

  test('a tool that cannot be started at all (spawn error) is treated as a failed attempt', async () => {
    const h = harness({
      scripts: {
        ...serverUp,
        cloudflared: (proc) => {
          proc.pid = undefined;
          proc.emit('error', Object.assign(new Error('spawn cloudflared EACCES'), { code: 'EACCES' }));
        },
        ssh: (proc) => proc.print(LOCALHOST_RUN, 'stdout'),
      },
    });
    assert.equal((await h.ready).publicUrl, 'https://6a1f0bd3b8d2b4.lhr.life');
    assert.match(h.out.text, /it could not start \(EACCES\)/);
    await h.close();
  });

  test('a tool that exits with an error is reported with its exit code', async () => {
    const h = harness({
      installed: ['cloudflared'],
      scripts: { ...serverUp, cloudflared: (proc) => { proc.print('2026-09-29T18:03:10Z ERR bad flag\n'); proc.exit(2); } },
    });
    const result = await h.ready;
    assert.equal(result.publicUrl, null);
    assert.match(h.out.text, /cloudflared did not work: it exited with code 2/);
    assert.match(h.out.text, /^ {4}ERR bad flag$/m, 'the tool\'s last words are shown without their log timestamp');
    await h.close();
  });

  test('when every tool fails the server keeps running and the same-Wi-Fi addresses are printed', async () => {
    const h = harness({ scripts: { ...serverUp, cloudflared: () => {}, ssh: () => {} } });
    const result = await h.ready;
    assert.deepEqual(result, { port: 3000, publicUrl: null, lan: ['http://192.168.1.20:3000'] });
    assert.match(h.out.text, /Could not open a public link/);
    assert.match(h.out.text, /http:\/\/192\.168\.1\.20:3000/);
    assert.deepEqual(h.by('server')[0].proc.signals, [], 'the server is left alone');
    assert.ok(h.by('cloudflared').every((s) => s.proc.signals.includes('SIGTERM')) && h.by('ssh').every((s) => s.proc.signals.includes('SIGTERM')));
    await h.close();
    assert.equal(await h.done, 0);
  });

  test('no tunnel tool installed: per-OS hints, LAN URLs, nothing spawned but the server', async () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const h = harness({ installed: [], scripts: serverUp, platform });
      const result = await h.ready;
      assert.equal(result.publicUrl, null);
      assert.deepEqual(h.spawned.map((s) => s.name), ['server']);
      assert.match(h.out.text, /No tunnel tool found/);
      assert.match(h.out.text, platform === 'darwin' ? /brew install cloudflared/ : platform === 'win32' ? /winget install/ : /\.deb/);
      assert.match(h.out.text, /Players on the same Wi-Fi can still join at:\n {2}http:\/\/192\.168\.1\.20:3000/);
      await h.close();
    }
  });
});

describe('createShare: what happens later', () => {
  test('a tunnel that dies after the banner says so, once, and leaves the server running', async () => {
    const h = harness({ scripts: { ...serverUp, cloudflared: cloudflaredOk } });
    await h.ready;
    h.by('cloudflared')[0].proc.exit(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(h.out.text.split('Tunnel closed: the public link is dead. Press Ctrl-C and run again.').length - 1, 1);
    assert.deepEqual(h.by('server')[0].proc.signals, []);
    await h.close();
    assert.equal(await h.done, 0);
  });

  test('a server that crashes later takes everything down with exit code 1 and shows its last words', async () => {
    const h = harness({ scripts: { ...serverUp, cloudflared: cloudflaredOk } });
    await h.ready;
    const server = h.by('server')[0].proc;
    server.print('{"lvl":"error","ev":"room_error"}\nboom\n', 'stdout');
    server.exit(3);
    assert.equal(await h.done, 1);
    assert.match(h.out.text, /The game server stopped unexpectedly \(it exited with code 3\)/);
    assert.match(h.out.text, /boom/);
    assert.deepEqual(h.by('cloudflared')[0].proc.signals, ['SIGTERM']);
  });

  test('a child that ignores SIGTERM is killed after the grace period', async () => {
    const h = harness({ scripts: { ...serverUp, cloudflared: (proc) => { proc.ignoreSigterm = true; cloudflaredOk(proc); } } });
    await h.ready;
    await h.close();
    assert.deepEqual(h.by('cloudflared')[0].proc.signals, ['SIGTERM', 'SIGKILL']);
  });

  test('killNow is a synchronous SIGKILL of everything still alive', async () => {
    const h = harness({ scripts: { ...serverUp, cloudflared: cloudflaredOk } });
    await h.ready;
    h.killNow();
    assert.deepEqual(h.by('server')[0].proc.signals, ['SIGKILL']);
    assert.deepEqual(h.by('cloudflared')[0].proc.signals, ['SIGKILL']);
    await h.close(); // the two exits above must not be reported as crashes
  });

  test('on Windows the whole process tree is taken down with taskkill', async () => {
    const h = harness({ platform: 'win32', scripts: { ...serverUp, cloudflared: cloudflaredOk } });
    await h.ready;
    const { proc } = h.by('cloudflared')[0];
    await h.close();
    assert.ok(h.sync.some(([command, args]) => command === 'taskkill' && args.join(' ') === `/pid ${proc.pid} /t /f`));
  });

  test('close() during startup stops everything and rejects ready quietly', async () => {
    const h = harness({ scripts: { ...serverUp, cloudflared: (proc) => proc.print('INF |  https://never-up.trycloudflare.com  |\n') }, answer: (url) => (isLocal(url) ? 200 : 530) });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await h.close();
    await assert.rejects(h.ready, ShareError);
    assert.equal(await h.done, 0, 'a requested stop is not a failure');
    assert.ok(h.spawned.every((s) => s.proc.signals.includes('SIGTERM')));
  });
});

describe('createShare: the server does not start', () => {
  test('an invalid PORT is explained before anything is spawned', async () => {
    for (const PORT of ['abc', '0', '70000', '3.5', '-1']) {
      const h = harness({ share: { env: { PORT } } });
      await assert.rejects(h.ready, (error) => error instanceof ShareError && error.message.includes(`"${PORT}"`));
      assert.equal(h.spawned.length, 0);
      assert.equal(await h.done, 1);
    }
  });

  test('PORT defaults to 3000', async () => {
    const h = harness({ scripts: serverUp, installed: [], share: { env: {} } });
    assert.equal((await h.ready).port, 3000);
    await h.close();
  });

  test('a port that is already taken is caught up front, with the way out for both shells', async () => {
    const h = harness({ share: { portInUse: async (port, host) => port === 3000 && host === '0.0.0.0' } });
    await assert.rejects(h.ready, (error) => error instanceof ShareError && /Port 3000 is already in use/.test(error.message) && /PORT=3001 npm run share/.test(error.message) && /\$env:PORT=3001/.test(error.message));
    assert.equal(h.spawned.length, 0);
    assert.equal(await h.done, 1);
  });

  test('the port check looks where the server will bind (HOST)', async () => {
    let seen;
    const h = harness({ scripts: serverUp, installed: [], share: { env: { PORT: '3000', HOST: '127.0.0.1' }, portInUse: async (port, host) => { seen = host; return false; } } });
    await h.ready;
    assert.equal(seen, '127.0.0.1');
    await h.close();
  });

  test('a server that dies at once is reported with its output; EADDRINUSE and missing modules get their own advice', async () => {
    // The dead server never listened, so the fake network refuses connections just like a real one would.
    const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const crash = (text) => harness({ scripts: { server: (proc) => { proc.print(text); proc.exit(1); } }, answer: refused });

    const generic = crash('SyntaxError: Unexpected token }\n    at wrapSafe (node:internal/modules/cjs/loader:1469:18)\n');
    await assert.rejects(generic.ready, (error) => error instanceof ShareError && /stopped right after it started \(it exited with code 1\)/.test(error.message) && /SyntaxError/.test(error.message) && !/wrapSafe/.test(error.message));
    assert.equal(await generic.done, 1);

    const busy = crash('Error: listen EADDRINUSE: address already in use 0.0.0.0:3000\n');
    await assert.rejects(busy.ready, (error) => /Port 3000 is already in use/.test(error.message));

    const missing = crash("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ws' imported from /game/server/ws.js\n");
    await assert.rejects(missing.ready, (error) => /run `npm install`/.test(error.message) && /Cannot find package 'ws'/.test(error.message));
  });

  test('a server that never answers /healthz is given up on after serverReadyMs and stopped', async () => {
    const h = harness({ scripts: serverUp, answer: () => new TypeError('fetch failed') });
    await assert.rejects(h.ready, (error) => /did not answer http:\/\/127\.0\.0\.1:3000\/healthz within/.test(error.message));
    assert.deepEqual(h.by('server')[0].proc.signals, ['SIGTERM']);
    assert.equal(await h.done, 1);
  });

  test('a server that dies while /healthz is still refused does not wait out the timeout', async () => {
    const h = harness({ scripts: { server: (proc) => setTimeout(() => proc.exit(1), 20) }, answer: () => new TypeError('fetch failed'), share: { timing: { ...FAST, serverReadyMs: 5000 } } });
    const started = Date.now();
    await assert.rejects(h.ready, ShareError);
    assert.ok(Date.now() - started < 2000);
  });
});

// ---- Real child processes ----------------------------------------------------------------------------------------

describe('createShare with real child processes', { skip: process.platform === 'win32' && 'needs POSIX executable scripts' }, () => {
  test('spawns a stub server and a stub cloudflared from PATH, prints the banner, and leaves no process behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-spec-'));
    const savedPath = process.env.PATH;
    try {
      const pidFile = (name) => join(dir, `${name}.pid`);
      writeFileSync(join(dir, 'server.mjs'), `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidFile('server'))}, String(process.pid));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`);
      writeFileSync(join(dir, 'cloudflared'), `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
if (process.argv[2] === '--version') process.exit(0);
writeFileSync(${JSON.stringify(pidFile('cloudflared'))}, String(process.pid));
console.error('INF |  https://real-process-check.trycloudflare.com  |');
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`);
      chmodSync(join(dir, 'cloudflared'), 0o755);
      process.env.PATH = `${dir}${delimiter}${savedPath}`;

      const chunks = [];
      const share = createShare({
        env: { ...process.env, PORT: '3000' },
        cwd: dir,
        serverEntry: join(dir, 'server.mjs'),
        out: { isTTY: false, write: (text) => chunks.push(text) },
        fetchImpl: async () => ({ status: 200, body: null }),
        portInUse: async () => false,
        loadQr: async () => ({ qrMatrix: () => null }),
        timing: { ...FAST, serverReadyMs: 5000, urlWaitMs: 5000, firstTryMs: 5000, reachableMs: 5000, stopMs: 3000, settleMs: 5 },
      });
      const result = await share.ready;
      assert.equal(result.publicUrl, 'https://real-process-check.trycloudflare.com');
      assert.match(chunks.join(''), /BLAST PARTY is online/);

      const pids = [];
      for (const name of ['server', 'cloudflared']) {
        for (let waited = 0; !existsSync(pidFile(name)); waited += 20) {
          assert.ok(waited < 5000, `${name} never started`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        pids.push(Number(readFileSync(pidFile(name), 'utf8')));
      }
      assert.ok(pids.every((pid) => Number.isInteger(pid) && pid > 0));
      pids.forEach((pid) => process.kill(pid, 0)); // both alive: kill(pid, 0) throws when not
      await share.close();
      assert.equal(await share.done, 0);
      for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    } finally {
      process.env.PATH = savedPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- App icons (scripts/make-icons.mjs, client/icons) ------------------------------------------------------------

/** A small PNG decoder for 8-bit RGB/RGBA: verifies every chunk CRC, inflates, and undoes the scanline filters. */
function decodePng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  let offset = 8;
  let header = null;
  const idat = [];
  const types = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    assert.equal(buffer.readUInt32BE(offset + 8 + length), crc32(buffer.subarray(offset + 4, offset + 8 + length)), `CRC of ${type}`);
    types.push(type);
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  assert.equal(types[0], 'IHDR');
  assert.equal(types.at(-1), 'IEND');
  assert.equal(header.depth, 8);
  assert.equal(header.interlace, 0);
  const bpp = header.colorType === 6 ? 4 : 3;
  assert.ok(header.colorType === 6 || header.colorType === 2);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * bpp;
  assert.equal(raw.length, (stride + 1) * header.height);
  const pixels = new Uint8Array(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const type = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i];
      const left = i >= bpp ? pixels[y * stride + i - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= bpp ? pixels[(y - 1) * stride + i - bpp] : 0;
      const p = left + up - upLeft;
      const paeth = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      const predicted = [0, left, up, (left + up) >> 1, paeth[0] <= paeth[1] && paeth[0] <= paeth[2] ? left : paeth[1] <= paeth[2] ? up : upLeft][type];
      pixels[y * stride + i] = (value + predicted) & 0xff;
    }
  }
  const at = (x, y) => Array.from(pixels.subarray((y * header.width + x) * bpp, (y * header.width + x + 1) * bpp));
  return { ...header, bpp, pixels, at };
}

describe('the PNG encoder', () => {
  test('crc32 matches the standard check value', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });

  test('round-trips RGBA and opaque RGB images, whichever scanline filters it picks', () => {
    const width = 37;
    const height = 23;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) rgba.set([x * 6, y * 10, (x * y) & 255, y % 2 ? 255 : x * 3], (y * width + x) * 4); // gradients (Sub/Up/Paeth) and noise
    }
    const image = decodePng(encodePng({ width, height, rgba }));
    assert.deepEqual([image.width, image.height, image.colorType], [37, 23, 6]);
    assert.deepEqual(Array.from(image.pixels), Array.from(rgba));

    const opaque = decodePng(encodePng({ width, height, rgba, opaque: true }));
    assert.equal(opaque.colorType, 2);
    for (const [x, y] of [[0, 0], [36, 22], [10, 5]]) assert.deepEqual(opaque.at(x, y), Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)));
  });
});

describe('client/icons', () => {
  const load = (name) => readFileSync(join(ROOT, 'client', 'icons', name));

  test('every icon the manifest and index.html reference exists with the declared size and type', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'client', 'manifest.webmanifest'), 'utf8'));
    assert.ok(manifest.icons.length >= 3);
    for (const icon of manifest.icons) {
      assert.ok(icon.src.startsWith('/icons/'), icon.src);
      const file = load(icon.src.slice('/icons/'.length));
      if (icon.type === 'image/png') {
        const png = decodePng(file);
        assert.equal(`${png.width}x${png.height}`, icon.sizes, icon.src);
      } else {
        assert.equal(icon.type, 'image/svg+xml');
        assert.equal(icon.sizes, 'any');
      }
    }
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
    const html = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
    for (const [, href] of html.matchAll(/href="(\/icons\/[^"]+)"/g)) assert.ok(existsSync(join(ROOT, 'client', href)), href);
  });

  test('icon.svg is a self-contained SVG without scripts or external references (it is served under the app CSP)', () => {
    const svg = load('icon.svg').toString('utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512"/);
    assert.ok(svg.trimEnd().endsWith('</svg>'));
    assert.ok(!/<script|on\w+=|href=|url\(http/i.test(svg));
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    for (const [, id] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(id), `#${id} is defined`);
  });

  test('the apple-touch-icon is 180x180 and fully opaque; the "any" icons have transparent corners; the maskable one is full-bleed', () => {
    const apple = decodePng(load('apple-touch-icon.png'));
    assert.deepEqual([apple.width, apple.height, apple.colorType], [180, 180, 2]);
    for (const size of ['icon-192.png', 'icon-512.png', 'favicon-32.png']) {
      const png = decodePng(load(size));
      assert.equal(png.at(0, 0)[3], 0, `${size} corner is transparent`);
      assert.equal(png.at(png.width >> 1, png.height >> 1)[3], 255, `${size} centre is opaque`);
    }
    const maskable = decodePng(load('icon-maskable-512.png'));
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511]]) assert.equal(maskable.at(x, y)[3], 255);
  });

  test('the committed PNGs are what make-icons.mjs draws (small sizes compared pixel by pixel, within rounding)', () => {
    for (const [name, size, opaque] of [['favicon-32.png', 32, false], ['apple-touch-icon.png', 180, true]]) {
      const committed = decodePng(load(name));
      const fresh = renderIcon(size, opaque ? { rounded: false } : {});
      let worst = 0;
      for (let i = 0; i < size * size; i++) {
        for (let c = 0; c < committed.bpp; c++) worst = Math.max(worst, Math.abs(committed.pixels[i * committed.bpp + c] - fresh[i * 4 + c]));
      }
      assert.ok(worst <= 2, `${name} differs from the script's output by ${worst}: run node scripts/make-icons.mjs`);
    }
  });

  test('the icon is readable at small sizes: a dark bomb body on a much lighter background', () => {
    const png = decodePng(load('icon-192.png'));
    const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const body = luminance(png.at(80, 130)); // inside the bomb
    const backdrop = luminance(png.at(20, 100));
    assert.ok(backdrop - body > 60, `contrast ${Math.round(backdrop - body)}`);
  });
});
