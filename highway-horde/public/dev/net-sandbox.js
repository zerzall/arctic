// Dev page for the netcode: host/join through the real Session API, drive a scripted
// input, and show the roster, the view and the wire statistics. End-to-end tests read
// window.__net.

import { hostGame, joinGame, getServerInfo } from '../js/net/session.js';
import { CLASS_IDS } from '../js/shared/classes.js';
import { PLAYER_COLORS } from '../js/shared/constants.js';

const $ = (id) => document.getElementById(id);
const state = {
  session: null,
  view: null,
  events: 0,
  eventTypes: {},
  log: [],
  snapshotBytes: [],
};
window.__net = state;

for (const c of CLASS_IDS) $('cls').add(new Option(c, c));
const q = new URLSearchParams(location.search);
if (q.get('name')) $('name').value = q.get('name');

function log(msg) {
  state.log.push(msg);
  if (state.log.length > 200) state.log.shift();
  $('log').textContent = state.log.slice(-40).join('\n');
}

function profile() {
  return { name: $('name').value, cls: $('cls').value, color: Number($('color').value) || 0 };
}

function attach(session) {
  state.session = session;
  session.on('roster', (r) => {
    $('roster').textContent = JSON.stringify(r, null, 1);
  });
  session.on('settings', (s) => log(`settings ${JSON.stringify(s)}`));
  session.on('chat', (m) => log(`${m.system ? '*' : m.name + ':'} ${m.text}`));
  session.on('notice', (n) => log(`notice: ${n.text}`));
  session.on('start', (s) => log(`start ${s.mapId} seed ${s.seed}`));
  session.on('lobby', () => log('back in lobby'));
  session.on('disconnected', (d) => {
    log(`disconnected: ${d.reason}`);
    $('status').textContent = `disconnected: ${d.reason}`;
  });
  if (!session.isHost) {
    // Measure what actually arrives on the wire.
    session.net.on('message', (ch, data) => {
      if (ch === 'state') {
        state.snapshotBytes.push(data.byteLength);
        if (state.snapshotBytes.length > 400) state.snapshotBytes.shift();
      }
    });
  }
  $('roster').textContent = JSON.stringify(session.roster, null, 1);
  $('status').textContent = `${session.isHost ? 'hosting' : 'joined'} ${session.code || '(local)'} via ${session.transport}`;
  log(`${session.isHost ? 'hosting' : 'joined'} code=${session.code} transport=${session.transport}`);
}

async function run(label, fn) {
  $('status').textContent = `${label}…`;
  try {
    attach(await fn());
  } catch (err) {
    $('status').textContent = `error: ${err.message}`;
    log(`error: ${err.message}`);
    state.error = err.message;
  }
}

$('host').onclick = () => run('hosting', () => hostGame({ ...profile(), transport: $('transport').value }));
$('join').onclick = () => run('joining', () => joinGame({ ...profile(), code: $('code').value, via: $('via').value || undefined }));
$('leave').onclick = () => {
  if (state.session) state.session.leave();
  state.session = null;
  $('status').textContent = 'left';
};
$('start').onclick = () => state.session && state.session.start();
$('lobby').onclick = () => state.session && state.session.returnToLobby();
$('send').onclick = () => {
  if (state.session) state.session.sendChat($('chat').value);
  $('chat').value = '';
};

let last = performance.now();
let frame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  frame++;
  const s = state.session;
  // `paused` imitates a hidden tab: no update() calls at all.
  if (!s || s.left || state.paused) return;
  const t = now / 1000;
  const walk = $('walk').checked;
  const input = walk
    ? { moveX: Math.cos(t), moveY: Math.sin(t), fire: true, reload: frame % 300 === 0, slot: -1, cycle: 0 }
    : null;
  s.update(dt, input, t * 2);
  if (!s.inGame) return;
  const view = s.getView(t);
  const events = s.drainEvents();
  state.events += events.length;
  for (const e of events) state.eventTypes[e.type] = (state.eventTypes[e.type] || 0) + 1;
  state.view = view;
  if (frame % 15 === 0) show(view);
  draw(s, view);
}
requestAnimationFrame(loop);

function show(view) {
  const s = state.session;
  const me = s.getPredictedLocal();
  const sizes = state.snapshotBytes;
  const avg = sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0;
  $('info').textContent = JSON.stringify({
    code: s.code, transport: s.transport, localId: s.localId, isHost: s.isHost, inGame: s.inGame,
    invite: s.inviteUrl, stats: s.stats, avgSnapshotBytes: avg, maxSnapshotBytes: sizes.length ? Math.max(...sizes) : 0,
    events: state.events, local: me && { x: Math.round(me.x), y: Math.round(me.y) },
  }, null, 1);
  $('view').textContent = view ? JSON.stringify({
    tick: view.tick, phase: view.phase, wave: view.wave, timer: Math.round(view.timer * 10) / 10,
    remaining: view.remaining, players: view.players.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), state: p.state, hp: p.hp, lastSeq: p.lastSeq })),
    zombies: view.zombies.length, projectiles: view.projectiles.length, eventTypes: state.eventTypes,
  }, null, 1) : 'null';
}

function draw(s, view) {
  const map = s.getMap();
  const cv = $('map');
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  if (!map || !view) return;
  const k = Math.min(cv.width / map.width, cv.height / map.height);
  g.fillStyle = '#20262d';
  for (const o of map.obstacles) g.fillRect((o.x - o.w / 2) * k, (o.y - o.h / 2) * k, o.w * k, o.h * k);
  g.fillStyle = '#6fa05a';
  for (const z of view.zombies) g.fillRect(z.x * k - 1, z.y * k - 1, 2, 2);
  g.fillStyle = '#ffcc66';
  for (const p of view.projectiles) g.fillRect(p.x * k - 1, p.y * k - 1, 3, 3);
  for (const p of view.players) {
    const r = s.roster.find((e) => e.id === p.id);
    g.fillStyle = PLAYER_COLORS[r ? r.color : 0];
    g.beginPath();
    g.arc(p.x * k, p.y * k, 4, 0, Math.PI * 2);
    g.fill();
  }
}

// This page lives in /dev/, so the relay's page-relative defaults (api/info, relay) would
// point into /dev/. Ask the server root instead and pin the relay URL when it exists.
(async () => {
  if (!window.HH_CONFIG.relayUrl) {
    try {
      const res = await fetch('../api/info', { cache: 'no-store' });
      const info = res.ok ? await res.json() : null;
      if (info && info.relay) {
        const url = new URL('../relay', location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        window.HH_CONFIG.relayUrl = url.href;
      }
    } catch {
      // Static hosting: p2p only.
    }
  }
  log(`server info: ${JSON.stringify(await getServerInfo())}`);
})();
