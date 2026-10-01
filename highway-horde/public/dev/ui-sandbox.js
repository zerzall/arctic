// UI sandbox: boots the real UI (js/ui/app.js) with the mock session from
// ui-mock-session.js, the real renderer/audio when they load (stubs otherwise), and the
// real index.html markup. Query flags:
//   ?scene=NAME   jump to a scene on load (see SCENES)
//   ?touch=1      force the touch controls
//   ?clean=1      hide the dev panel (screenshots)
//   ?join=CODE    exercise the invite-link path (XXXXX = room not found)
// window.__SANDBOX = { app, mock, goto(scene) } for Playwright.

import { startApp } from '../js/ui/app.js';
import { MAP_LIST, buildMap } from '../js/shared/maps.js';
import {
  createMockApi, createStubRenderer, createStubAudio, stubPortrait, stubMapPreview,
} from './ui-mock-session.js';

const params = new URLSearchParams(location.search);

async function loadOptional(path) {
  try {
    return await import(path);
  } catch (err) {
    console.warn(`[sandbox] ${path} unavailable, using a stub:`, err.message);
    return null;
  }
}

async function mountMarkup() {
  const res = await fetch('../index.html', { cache: 'no-store' });
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const app = doc.getElementById('app');
  document.body.replaceChildren(document.adoptNode(app));
}

const SCENES = [
  'title', 'join', 'join-error', 'connecting', 'settings', 'howto',
  'lobby-host', 'lobby-client', 'lobby-solo',
  'prep', 'wave', 'boss', 'intermission', 'downed', 'dead', 'auto',
  'victory', 'gameover', 'client-victory', 'disconnected',
];

function until(fn, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      let v;
      try {
        v = fn();
      } catch {
        v = null;
      }
      if (v) return resolve(v);
      if (performance.now() - t0 > timeout) return reject(new Error('sandbox: timed out'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function main() {
  await mountMarkup();
  const R = await loadOptional('../js/render/renderer.js');
  const A = await loadOptional('../js/audio/audio.js');
  const mock = createMockApi({ buildMap });
  mock.delay = Number(params.get('delay') || 120);
  const app = startApp({
    hostGame: mock.hostGame,
    joinGame: mock.joinGame,
    getServerInfo: mock.getServerInfo,
    createRenderer: (R && R.createRenderer) || createStubRenderer,
    renderMapPreview: (R && R.renderMapPreview) || stubMapPreview,
    renderClassPortrait: (R && R.renderClassPortrait) || stubPortrait,
    createAudio: (A && A.createAudio) || createStubAudio,
    MAP_LIST,
    buildMap,
    forceTouch: params.get('touch') === '1',
    search: params.has('join') ? `?join=${params.get('join')}` : '',
  });

  function closeAll() {
    for (const el of document.querySelectorAll('.modal')) if (app.modals.isOpen(el)) app.modals.close(el, 'sandbox');
  }

  async function ensureSession(kind) {
    const s0 = app.session;
    const kindOf = (s) => (s.transport === 'local' ? 'solo' : s.isHost ? 'host' : 'client');
    if (s0 && kindOf(s0) === kind) return s0;
    if (app.session) app.leave();
    closeAll();
    if (kind === 'client') app.doJoin('HWY42');
    else if (kind === 'solo') app.host('local');
    else app.host('auto');
    const s = await until(() => app.session);
    if (kind === 'host') s._fillRoster();
    return s;
  }

  async function ensureMatch(kind = 'host') {
    const s = await ensureSession(kind);
    if (!app.match) {
      if (s.isHost) s.start();
      else s._hostStarts();
    }
    await until(() => app.match);
    return s;
  }

  async function goto(scene) {
    closeAll();
    switch (scene) {
      case 'title':
        if (app.session) app.leave();
        break;
      case 'join':
        if (app.session) app.leave();
        app.join.open('');
        break;
      case 'join-error':
        if (app.session) app.leave();
        app.doJoin('XXXXX');
        await until(() => !document.getElementById('dlg-error').hidden);
        break;
      case 'connecting':
        if (app.session) app.leave();
        mock.delay = 60000;
        app.doJoin('ABCDE');
        break;
      case 'settings':
        app.settingsDialog.open();
        break;
      case 'howto':
        app.howTo.open();
        break;
      case 'lobby-host':
        await ensureSession('host');
        if (app.match) app.session.returnToLobby();
        break;
      case 'lobby-client':
        await ensureSession('client');
        break;
      case 'lobby-solo':
        if (app.session) app.leave();
        await ensureSession('solo');
        break;
      case 'client-victory': {
        const s = await ensureMatch('client');
        s.setScene('victory');
        break;
      }
      case 'disconnected': {
        const s = await ensureMatch('client');
        s._disconnect('Host left the game');
        break;
      }
      default: {
        if (!SCENES.includes(scene)) throw new Error(`unknown scene ${scene}`);
        const s = await ensureMatch('host');
        s.setScene(scene);
      }
    }
    return scene;
  }

  window.__SANDBOX = { app, mock, goto, until, SCENES };

  if (params.get('clean') !== '1') {
    const body = document.createElement('div');
    body.className = 'dev-body';
    for (const s of SCENES) {
      const b = document.createElement('button');
      b.textContent = s;
      b.addEventListener('click', () => goto(s).catch((e) => console.warn(e)));
      body.appendChild(b);
    }
    const extra = document.createElement('button');
    extra.textContent = 'all events';
    extra.addEventListener('click', () => mock.current && mock.current.fireAllEvents());
    body.appendChild(extra);
    const panel = document.createElement('div');
    panel.className = 'dev-panel';
    const title = document.createElement('h4');
    title.textContent = 'UI sandbox scenes ▾';
    title.style.cursor = 'pointer';
    title.addEventListener('click', () => panel.classList.toggle('min'));
    panel.append(title, body);
    document.body.appendChild(panel);
  }

  const start = params.get('scene');
  if (start) await goto(start);
  document.documentElement.dataset.sandboxReady = '1';
}

main().catch((err) => {
  console.error('[sandbox] failed to start', err);
});
