/* Rainbow Rails — ui
 * Every DOM screen: title, shop, missions & stats, settings, HUD, pause, revive, countdown,
 * game over, toasts and tutorial hints. The markup lives in index.html; this file fills it from
 * RR.store.data, RR.game (SHOP, missions, stats, lastRun), RR.player (SKINS, BOARDS) and RR.WORLDS.
 * The UI never changes game state: every user intent leaves as a `ui:*` event (see ARCHITECTURE.md).
 * hud() runs every frame, so it only writes to the DOM when a displayed value changes and
 * uses precomputed transform strings for bars (no per-frame allocations beyond changed text).
 */
(function (RR) {
  'use strict';
  if (!RR) return;

  const doc = document;
  const $ = (id) => doc.getElementById(id);
  const WL = (RR.C && RR.C.WORLD_LEN) || 1000;
  const NF = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-US') : null;
  const fmt = (n) => { n = Math.round(+n || 0); return NF ? NF.format(n) : String(n); };
  const fmtM = (m) => fmt(m) + ' m';
  const fmtKm = (m) => { m = +m || 0; return m >= 10000 ? (m / 1000).toFixed(m >= 100000 ? 0 : 1) + ' km' : fmtM(m); };
  const fmtTime = (s) => { s = Math.round(+s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + ' h ' + m + ' min' : m ? m + ' min' : s + ' s'; };
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const nb = (s) => esc(s).replace(/(\d) (m|s|km|coins)\b/g, '$1&nbsp;$2'); // keep "500 m" on one line
  const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
  const humanize = (k) => String(k || '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
  const store = () => (RR.store && RR.store.data) || {};
  const game = () => RR.game || {};
  const worlds = () => RR.WORLDS || [];
  const worldAt = (i) => { const w = worlds(); const n = w.length; return n ? w[(((i | 0) % n) + n) % n] : null; };
  const emit = (name, data) => { if (RR.emit) RR.emit(name, data); };
  const icon = (id, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
  const COIN = '<span class="coin" aria-hidden="true"></span>';
  const now = () => (window.performance ? performance.now() : Date.now());

  // ------------------------------------------------------------------ tables
  const SCREENS = ['title', 'shop', 'missions', 'settings', 'pause', 'revive', 'over'];
  const MENUS = { shop: 1, missions: 1, settings: 1 };
  const HUD_ON = { run: 1, countdown: 1, pause: 1, revive: 1 };
  const POWER = {
    magnet: { label: 'Coin magnet', color: '#ff5d73', icon: 'magnet' },
    sneakers: { label: 'Super sneakers', color: '#4ee39a', icon: 'sneaker' },
    double: { label: 'Double score', color: '#ffc233', icon: 'x2' },
    jetpack: { label: 'Jetpack', color: '#6ec6ff', icon: 'jetpack', low: 'Landing' },
    board: { label: 'Hoverboard', color: '#b98cff', icon: 'board' },
    headstart: { label: 'Head start', color: '#ff9a3c', icon: 'rocket', low: 'Landing' }
  };
  const STUNTS = {
    near: 'Near miss', 'near-miss': 'Near miss', whoosh: 'Whoosh', roofhop: 'Roof hop', 'roof-hop': 'Roof hop',
    ramp: 'Ramp ride', late: 'Last second', 'late-jump': 'Late jump', 'late-roll': 'Late roll', string: 'Coin string', 'coin-string': 'Coin string'
  };
  const CAUSE = {
    train: ['Derailed!', 'Flattened by a train.'],
    oncoming: ['Head-on!', 'Met an oncoming train head-on.'],
    hurdle: ['Tripped up!', 'Tripped over a barrier.'],
    bar: ['Ouch!', 'Clotheslined by a low sign.'],
    block: ['Blocked!', 'Ran into a barrier wall.'],
    stumble: ['Scraped out!', 'Two scrapes in a row.'],
    quit: ['Run over', 'You left the run early.']
  };
  const HIST_CAUSE = { train: 'Hit a train', oncoming: 'Oncoming train', hurdle: 'Tripped', bar: 'Low sign', block: 'Barrier wall', stumble: 'Double scrape', quit: 'Quit' };
  const DEATHS = { train: 'Trains', oncoming: 'Oncoming trains', hurdle: 'Barriers', bar: 'Low signs', block: 'Barrier walls', stumble: 'Double scrapes', quit: 'Quit early', unknown: 'Other' };
  // Lifetime stats shown on the Missions & Stats screen, in this order. [key, label, format]
  const STAT_ROWS = [
    ['dist', 'Distance run', 'km'], ['coins', 'Coins collected', 'n'], ['bestCoins', 'Most coins (run)', 'n'],
    ['bestCombo', 'Best combo', 'x'], ['bestWorld', 'Furthest world', 'world'], ['worlds', 'Worlds entered', 'n'],
    ['jumps', 'Jumps', 'n'], ['rolls', 'Rolls', 'n'], ['lanes', 'Lane changes', 'n'], ['nearMiss', 'Near misses', 'n'],
    ['stunts', 'Stunts', 'n'], ['hurdles', 'Barriers cleared', 'n'], ['moverDodges', 'Trains dodged', 'n'],
    ['ramps', 'Ramps ridden', 'n'], ['roofM', 'Roof running', 'm'], ['pickups', 'Power-ups', 'n'],
    ['magnetCoins', 'Magnet coins', 'n'], ['jetpackM', 'Jetpack flight', 'm'], ['boardsUsed', 'Boards ridden', 'n'],
    ['boardSaves', 'Board saves', 'n'], ['revives', 'Revives', 'n'], ['playSec', 'Time played', 't']
  ];
  const STAT_HIDDEN = /^(seen|hint|runs$|bestScore$|bestDist$|score$|combo$|worldCount$|deaths_)/;
  // Tutorial / contextual hints by action id: { key: keyboard text, touch: touch text }.
  const HINTS = {
    jump: { key: '↑ / Space to jump', touch: 'Swipe up to jump' },
    roll: { key: '↓ to roll under', touch: 'Swipe down to roll under' },
    left: { key: '← to switch lanes', touch: 'Swipe left to switch lanes' },
    right: { key: '→ to switch lanes', touch: 'Swipe right to switch lanes' },
    ramp: { key: 'Run up the ramp onto the roof', touch: 'Run up the ramp onto the roof' },
    coins: { key: 'Follow the coins. They trace a safe line', touch: 'Follow the coins. They trace a safe line' },
    magnet: { key: 'Grab the magnet to pull in coins', touch: 'Grab the magnet to pull in coins' },
    board: { key: 'Press B to ride a hoverboard', touch: 'Double-tap to ride a hoverboard' },
    headstart: { key: 'Press H for a Head Start', touch: 'Tap the board button twice for a Head Start' },
    pause: { key: 'Press P to pause', touch: 'Tap pause to take a breather' }
  };
  // Portrait colours for characters and boards when the catalogue carries none: [main, accent, third].
  const SKIN_PAL = {
    nova: ['#ff4f9a', '#3fa7ff', '#ffd6bd'], juno: ['#3dd9c1', '#7c5cff', '#9a623f'], kai: ['#ff8a5b', '#ffc233', '#d59b76'],
    pixel: ['#7cff6b', '#ff3fd2', '#f3c9a6'], frosty: ['#9fd3ff', '#ffffff', '#ffe3d3'], neonace: ['#7c5cff', '#39f0ff', '#6e4630'],
    ace: ['#7c5cff', '#39f0ff', '#6e4630'], 'neon-ace': ['#7c5cff', '#39f0ff', '#6e4630']
  };
  const BOARD_PAL = { classic: ['#ff4f9a', '#ffc233'], wave: ['#3fa7ff', '#3dd9c1'], candy: ['#ff6fb5', '#fff7ee'], circuit: ['#241958', '#39f0ff'] };
  const FALLBACK_PAL = [['#ff8a5b', '#ffc233'], ['#3dd9c1', '#3fa7ff'], ['#ff6fb5', '#b98cff'], ['#7c5cff', '#39f0ff'], ['#9fd3ff', '#ffffff']];
  const ITEM_ART = {
    board1: { icon: 'board', color: '#b98cff' }, board5: { icon: 'board', color: '#b98cff' },
    headstart: { icon: 'rocket', color: '#ff9a3c' }, token: { icon: 'heart', color: '#ff4f9a' }
  };
  const ITEM_HAVE = { board1: 'boards', board5: 'boards', headstart: 'headStarts', token: 'tokens' };

  // precomputed strings for hot paths
  const SX = []; for (let i = 0; i <= 200; i++) SX.push('scaleX(' + (i / 200).toFixed(3) + ')');
  const RING_C = 50.27; const DASH = []; for (let i = 0; i <= 40; i++) DASH.push((RING_C * (1 - i / 40)).toFixed(2));
  const SECS = []; for (let i = 0; i < 100; i++) SECS.push(i + 's');

  // ------------------------------------------------------------------ state
  const ui = { inited: false, screen: null };
  const E = {}; // cached elements
  let base = 'title'; // screen a menu returns to (title, over or pause)
  const lastData = {}; // last data passed to show(), per screen
  let shopTab = 'skins';
  const preview = { skins: null, boards: null };
  const pending = {}; // settings sent with ui:setting that the store does not show yet
  let inputMode = 'keys';
  let lastTier = '';
  let fatalShown = false;
  let resetArmed = false;

  // HUD caches
  const H = { score: -1, coins: -1, mult: -1, dist: -1, wq: -1, world: -1, boards: -1, boardActive: null, hs: null, comboN: -1, comboQ: -1, stamp: 0, bestAtStart: -1, bestFlashed: false };
  const powerRows = {}; const powerList = [];
  let coinBump = false, comboBump = false;
  let cdTimer = 0, cdShown = false, wtoastTimer = 0, wtoastIdx = -1, wtoastT = 0, hintTimer = 0, hintSrc = null;
  let stuntT = 0, bestFlashT = -1e9;
  const toastPool = []; let toastSeq = 0, lastToastText = '', lastToastT = 0;
  let reviveRaf = 0, reviveEnd = 0, reviveSec = -1, reviveTimedOut = false;
  let anim = null, animRaf = 0;
  let boardPointerT = 0;

  const BACK = {}; // show() marker: re-show a screen without replaying its entrance count-ups

  // ------------------------------------------------------------------ settings helpers
  function getSetting(key) {
    const s = store().settings || {};
    if (Object.prototype.hasOwnProperty.call(pending, key)) {
      if (s[key] === pending[key]) delete pending[key];
      else return pending[key];
    }
    return s[key];
  }
  function setSetting(key, value) {
    pending[key] = value;
    emit('ui:setting', { key, value });
    applySettings();
  }
  function toggleSetting(key) { setSetting(key, !getSetting(key)); }
  const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reducedMotion() {
    const v = getSetting('reducedMotion');
    if (v === 'on' || v === true) return true;
    if (v === 'off' || v === false) return false;
    return !!(mqReduce && mqReduce.matches);
  }
  function applySettings() {
    if (!ui.inited) return;
    const sound = getSetting('sound') !== false, music = getSetting('music') !== false;
    [E.hMute, E.tSound, E.pSound].forEach((b) => { if (b) { b.setAttribute('aria-pressed', sound ? 'true' : 'false'); b.setAttribute('aria-label', sound ? 'Sound on. Press to mute' : 'Sound off. Press to turn on'); } });
    if (E.pMusic) { E.pMusic.setAttribute('aria-pressed', music ? 'true' : 'false'); E.pMusic.setAttribute('aria-label', music ? 'Music on. Press to turn off' : 'Music off. Press to turn on'); }
    const touch = !!getSetting('touchButtons');
    E.hud.classList.toggle('touch', touch);
    E.tpLeft.hidden = !touch; E.tpRight.hidden = !touch;
    doc.documentElement.classList.toggle('rm', reducedMotion());
    if (ui.screen === 'settings') syncSettings();
  }

  // ------------------------------------------------------------------ init
  function init() {
    if (ui.inited) return api;
    ui.inited = true;
    const ids = {
      ui: 'ui', app: 'app', loading: 'loading', fatal: 'fatal', hud: 'hud',
      hScore: 'h-score', hMult: 'h-mult', hCombo: 'h-combo', hComboN: 'h-combo-n', hComboRing: 'h-combo-ring', hStunt: 'h-stunt', hPowers: 'h-powers',
      hWorld: 'h-world', hDist: 'h-dist', hWprog: 'h-wprog', hBestd: 'h-bestd', hCoins: 'h-coins', hPause: 'h-pause', hWtoast: 'h-wtoast',
      hHint: 'h-hint', hToasts: 'h-toasts', hBoard: 'h-board', hBoardN: 'h-board-n', hBoardIc: 'h-board-ic', hBoardKey: 'h-board-key', hMute: 'h-mute',
      tpLeft: 'h-tp-left', tpRight: 'h-tp-right', vignette: 'vignette', countdown: 'countdown', cdN: 'cd-n',
      srLive: 'sr-live', tPlay: 't-play', tDailySub: 't-daily-sub', tBank: 't-bank', tBest: 't-best', tFar: 't-far', tMissions: 't-missions', tLvl: 't-lvl', tMblock: 't-mblock',
      tShopDot: 't-shop-dot', tRouteV: 't-route-v', tRoute: 't-route', tSound: 't-sound',
      sH: 's-h', sBank: 's-bank', sBody: 's-body', mH: 'm-h', mBank: 'm-bank', mBody: 'm-body', setH: 'set-h', setQNote: 'set-q-note',
      setResetA: 'set-reset-a', setResetB: 'set-reset-b', setReset: 'set-reset', setResetNo: 'set-reset-no',
      pH: 'p-h', pSub: 'p-sub', pScore: 'p-score', pCoins: 'p-coins', pDist: 'p-dist', pMissions: 'p-missions', pLvl: 'p-lvl', pMblock: 'p-mblock', pResume: 'p-resume', pSound: 'p-sound', pMusic: 'p-music',
      rRing: 'r-ring', rSec: 'r-sec', rSub: 'r-sub', rYes: 'r-yes', rNo: 'r-no',
      oEyebrow: 'o-eyebrow', oH: 'o-h', oCause: 'o-cause', oScore: 'o-score', oNewbest: 'o-newbest', oBest: 'o-best', oDist: 'o-dist', oCoins: 'o-coins', oBank: 'o-bank',
      oLevel: 'o-level', oMissions: 'o-missions', oLvl: 'o-lvl', oMblock: 'o-mblock', oAgain: 'o-again'
    };
    for (const k in ids) E[k] = $(ids[k]);
    if (!E.ui || !E.hud) { console.error('[RR] ui: index.html markup is missing'); return api; }
    E.scr = {}; SCREENS.forEach((s) => (E.scr[s] = $('scr-' + s)));
    E.coinsChip = E.hCoins.parentNode;
    E.stuntL = E.hStunt.firstElementChild; E.stuntP = E.hStunt.lastElementChild;
    // text nodes the HUD writes into every frame
    const tn = (el, v) => { el.textContent = v; return el.firstChild; };
    E.dScore = makeDigits(E.hScore); E.dCoins = makeDigits(E.hCoins); E.dDist = makeDigits(E.hDist);
    setDigits(E.dScore, '0'); setDigits(E.dCoins, '0'); setDigits(E.dDist, '0');
    E.tMult = tn(E.hMult, '×1');
    E.tWorld = tn(E.hWorld, (worldAt(0) || {}).name || ''); E.tComboN = tn(E.hComboN, '×2'); E.tBoardN = tn(E.hBoardN, '0');
    ['magnet', 'sneakers', 'double', 'jetpack', 'board', 'headstart'].forEach(makePowerRow);
    for (let i = 0; i < 3; i++) {
      const el = doc.createElement('div'); el.className = 'toast'; el.hidden = true;
      el.innerHTML = '<span class="tic"></span><span class="tbody"><b></b><span class="tsub"></span></span>';
      E.hToasts.appendChild(el);
      toastPool.push({ el, ic: el.firstChild, title: el.querySelector('b'), sub: el.querySelector('.tsub'), timer: 0, seq: 0 });
      el.addEventListener('animationend', (e) => { if (e.animationName === 'toast-out') el.hidden = true; });
    }
    setWorldHud(0);

    // events from the page
    E.ui.addEventListener('click', onClick);
    E.ui.addEventListener('change', onChange);
    E.hBoard.addEventListener('pointerdown', (e) => { if (e.button > 0) return; boardPointerT = now(); emit('ui:board'); });
    [E.tpLeft, E.tpRight].forEach((pad) => {
      pad.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('[data-input]'); if (!b) return;
        e.preventDefault();
        b.classList.add('on');
        emit('ui:input', { action: b.dataset.input });
      });
      const off = (e) => { const b = e.target.closest && e.target.closest('[data-input]'); if (b) b.classList.remove('on'); };
      pad.addEventListener('pointerup', off); pad.addEventListener('pointercancel', off); pad.addEventListener('pointerout', off);
      pad.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    // HUD buttons must not keep focus (Space would press them instead of jumping)
    E.hud.addEventListener('pointerup', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });
    E.coinsChip.addEventListener('animationend', () => { coinBump = false; E.coinsChip.classList.remove('bump'); });
    E.hCombo.addEventListener('animationend', () => { comboBump = false; E.hCombo.classList.remove('bump'); });
    E.hBoard.addEventListener('animationend', (e) => { if (e.animationName === 'shake') E.hBoard.classList.remove('shake'); });
    E.hWtoast.addEventListener('animationend', () => { E.hWtoast.hidden = true; E.hWtoast.classList.remove('show'); });
    E.hBestd.addEventListener('animationend', () => { E.hBestd.hidden = true; E.hBestd.classList.remove('show'); });
    E.vignette.addEventListener('animationend', () => E.vignette.classList.remove('show'));
    E.hStunt.addEventListener('animationend', () => E.hStunt.classList.remove('show'));
    const reload = $('fatal-reload'); if (reload) reload.addEventListener('click', () => location.reload());
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', (e) => setInputMode(e.pointerType === 'mouse' ? 'keys' : 'touch'), true);
    if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener('change', applySettings);

    // events from the game
    const on = RR.on || (() => {});
    on('shop-update', () => { applySettings(); refresh(); });
    on('missions-update', refresh);
    on('run-start', resetRunHud);
    on('stunt', (d) => { if (d) stunt(STUNTS[d.kind] || humanize(d.kind), d.points ? '+' + fmt(d.points) : '', 'stunt'); });
    on('combo', (d) => { if (d && d.n >= 2 && !comboBump && ui.screen === 'run') { comboBump = true; E.hCombo.classList.add('bump'); } });
    on('coin', () => { if (!coinBump && ui.screen === 'run') { coinBump = true; E.coinsChip.classList.add('bump'); } });
    on('board-break', () => { stunt('Board saved you!', '', 'save'); E.hBoard.classList.remove('shake'); void E.hBoard.offsetWidth; E.hBoard.classList.add('shake'); });
    on('stumble', () => { if (ui.screen !== 'run') return; E.vignette.classList.remove('show'); void E.vignette.offsetWidth; E.vignette.classList.add('show'); });
    on('crash', () => clearHint());
    on('countdown', (d) => { const n = d && d.n; if (ui.screen === 'countdown' || ui.screen === 'run') countdown(n); else show('countdown', d); });
    on('quality-change', (d) => { lastTier = (d && d.tier) || ''; if (ui.screen === 'settings') syncSettings(); });

    inputMode = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches ? 'touch' : 'keys';
    E.app.classList.add(inputMode === 'touch' ? 'im-touch' : 'im-keys');
    applySettings();
    return api;
  }

  function setInputMode(mode) {
    if (mode === inputMode || !ui.inited) return;
    inputMode = mode;
    E.app.classList.toggle('im-touch', mode === 'touch');
    E.app.classList.toggle('im-keys', mode === 'keys');
    if (hintSrc && !E.hHint.hidden) renderHint(hintSrc);
  }

  // ------------------------------------------------------------------ screens
  function hideLoading() {
    const l = E.loading; if (!l || l.hidden || l.classList.contains('gone')) return;
    l.classList.add('gone');
    setTimeout(() => { l.hidden = true; }, 600);
  }
  function show(name, data) {
    if (!ui.inited) init();
    if (!E.hud || fatalShown) return;
    if (SCREENS.indexOf(name) < 0 && name !== 'run' && name !== 'countdown') { console.warn('[RR] ui.show: unknown screen', name); return; }
    hideLoading();
    const isBack = data === BACK;
    if (isBack) data = undefined;
    const prev = ui.screen;
    const menu = !!MENUS[name];
    if (!menu && name !== 'run' && name !== 'countdown' && name !== 'revive') base = name;
    if (!menu && name === 'run') base = 'title';
    if (data !== undefined && data !== null) lastData[name] = data;
    ui.screen = name;

    if (name !== 'revive') stopRevive();
    if (name !== 'over') stopAnim();
    if (name !== 'settings') disarmReset();

    switch (name) {
      case 'title': renderTitle(); break;
      case 'shop': if (prev !== 'shop') { preview.skins = null; preview.boards = null; } renderShop(); break;
      case 'missions': renderMissions(); break;
      case 'settings': syncSettings(); break;
      case 'pause': renderPause(lastData.pause || {}); break;
      case 'revive': renderRevive(data || lastData.revive || {}); break;
      case 'over': renderOver(data || lastData.over || game().lastRun || {}, isBack); break;
      case 'countdown': countdown(data && data.n !== undefined ? data.n : 3); break;
      case 'run': if (prev === 'countdown' && cdShown) countdown(0); else if (!cdShown) E.countdown.hidden = true; break;
      default: break;
    }

    for (let i = 0; i < SCREENS.length; i++) { const s = SCREENS[i], el = E.scr[s]; if (el) el.hidden = s !== name; }
    const hudOn = !!HUD_ON[name];
    E.hud.hidden = !hudOn;
    const dim = name === 'pause' || name === 'revive';
    E.hud.classList.toggle('dim', dim);
    E.hud.inert = dim;
    if (name !== 'countdown' && name !== 'run') { E.countdown.hidden = true; cdShown = false; }
    if (!hudOn) { clearHint(); hideToasts(); E.hWtoast.hidden = true; }

    // focus: primary action on each screen; nothing inside the UI while running
    const active = doc.activeElement;
    if (name === 'run' || name === 'countdown') { if (active && E.ui.contains(active) && active.blur) active.blur(); }
    else if (inputMode === 'keys' || (active && E.ui.contains(active))) {
      const f = { title: E.tPlay, over: E.oAgain, pause: E.pResume, revive: E.rYes, missions: E.mH, settings: E.setH, shop: $('tab-' + shopTab) }[name];
      if (f && !(active && E.scr[name] && E.scr[name].contains(active))) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
    }
    if (prev !== name) emit('ui:screen', { name });
  }
  function go(name) {
    if (!MENUS[name]) return show(name);
    if (!MENUS[ui.screen] && ui.screen) base = ui.screen === 'run' || ui.screen === 'countdown' || ui.screen === 'revive' ? 'title' : ui.screen;
    show(name);
  }
  function back() {
    const to = base || 'title';
    if (to === 'over') show('over', BACK);
    else show(to);
  }
  // re-render whatever is visible (after shop-update / missions-update)
  function refresh() {
    switch (ui.screen) {
      case 'title': renderTitle(); break;
      case 'shop': renderShop(); break;
      case 'missions': renderMissions(); break;
      case 'settings': syncSettings(); break;
      case 'pause': renderPause(lastData.pause || {}); break;
      case 'over': renderOverMissions(lastData.over || game().lastRun || {}); if (!anim) setText(E.oBank, fmt(store().bank)); break;
      default: break;
    }
  }
  const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };

  // ------------------------------------------------------------------ shared renderers
  function missionState() {
    const m = game().missions;
    if (m && Array.isArray(m.list)) return m;
    return null;
  }
  function missionRows(list, just) {
    return list.map((m) => {
      const target = Math.max(1, +m.target || 1), have = Math.min(target, Math.max(0, +m.have || 0));
      const f = m.done ? 1 : have / target;
      const isJust = just && just.indexOf(m.text) >= 0;
      return '<li class="ms' + (m.done ? ' done' : '') + (isJust ? ' just' : '') + '">' +
        '<span class="ms-dot">' + (m.done ? icon('check') : '') + '</span>' +
        '<span class="ms-text">' + nb(m.text) + '</span>' +
        '<span class="ms-num">' + (m.done ? 'Done' : fmt(have) + '<small> / ' + fmt(target) + '</small>') + '</span>' +
        '<span class="bar"><i style="transform:scaleX(' + f.toFixed(3) + ')"></i></span></li>';
    }).join('');
  }
  function renderMini(listEl, lvlEl, blockEl, just) {
    const m = missionState();
    if (!m) { blockEl.hidden = true; return; }
    blockEl.hidden = false;
    const lvl = m.level || store().missionLevel || 1;
    setText(lvlEl, 'Level ' + lvl + ' · ×' + lvl + ' score');
    listEl.innerHTML = m.list.length ? missionRows(m.list, just) : '<li class="empty">New missions arrive after your next run.</li>';
  }

  // character portrait: hoodie + head + cap, drawn from the skin's colours
  function skinPalette(s) {
    const c = s.colors || s.palette;
    if (Array.isArray(c) && c.length >= 2) return c.map(cssColor);
    if (c && typeof c === 'object') return [cssColor(c.hoodie || c.body || c.main), cssColor(c.cap || c.hat || c.accent), cssColor(c.skin || '#ffd6bd')];
    if (s.color !== undefined) return [cssColor(s.color), cssColor(s.accent !== undefined ? s.accent : '#ffc233'), '#ffd6bd'];
    const p = SKIN_PAL[String(s.id).toLowerCase()];
    if (p) return p;
    const f = FALLBACK_PAL[hash(s.id) % FALLBACK_PAL.length];
    return [f[0], f[1], '#f3c9a6'];
  }
  function cssColor(c) { if (typeof c === 'number') return '#' + ('000000' + (c >>> 0).toString(16)).slice(-6); return c ? String(c) : '#ffffff'; }
  function hash(s) { s = String(s || ''); let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function avatarSVG(s) {
    const p = skinPalette(s), hood = p[0], cap = p[1], skin = p[2] || '#ffd6bd';
    return '<svg viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle cx="32" cy="34" r="27" fill="' + hood + '" opacity=".22"/>' +
      '<path d="M11 64c0-13.5 9.4-21 21-21s21 7.5 21 21z" fill="' + hood + '"/>' +
      '<path d="M22 47c3 4 6.5 6 10 6s7-2 10-6" fill="none" stroke="#1b1340" stroke-opacity=".25" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M28.5 52v6M35.5 52v6" stroke="#fff" stroke-opacity=".75" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="32" cy="30" r="12.5" fill="' + skin + '"/>' +
      '<path d="M19.2 28.2a12.8 12.8 0 0 1 25.6 0z" fill="' + cap + '"/>' +
      '<path d="M41 26.6h8.6a2.1 2.1 0 0 1 0 4.2H41z" fill="' + cap + '"/>' +
      '<path d="M19.2 28.2h25.6" stroke="#1b1340" stroke-opacity=".3" stroke-width="1.6"/>' +
      '<circle cx="27.6" cy="32.6" r="1.7" fill="#1b1340"/><circle cx="35.4" cy="32.6" r="1.7" fill="#1b1340"/>' +
      '<path d="M28.4 36.8q3.6 2.8 7.2 0" fill="none" stroke="#1b1340" stroke-width="1.7" stroke-linecap="round"/></svg>';
  }
  function boardSVG(b) {
    let p = b.colors || b.palette;
    if (Array.isArray(p) && p.length >= 2) p = p.map(cssColor);
    else if (b.color !== undefined) p = [cssColor(b.color), cssColor(b.accent !== undefined ? b.accent : '#ffffff')];
    else p = BOARD_PAL[String(b.id).toLowerCase()] || FALLBACK_PAL[hash(b.id) % FALLBACK_PAL.length];
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-20 32 32)">' +
      '<ellipse cx="32" cy="45" rx="22" ry="3.2" fill="' + p[1] + '" opacity=".35"/>' +
      '<rect x="6" y="24" width="52" height="14" rx="7" fill="' + p[0] + '"/>' +
      '<rect x="12" y="29" width="40" height="4" rx="2" fill="' + p[1] + '"/>' +
      '<rect x="6" y="24" width="52" height="4" rx="2" fill="#fff" opacity=".22"/>' +
      '<circle cx="17" cy="41" r="2.6" fill="' + p[1] + '"/><circle cx="47" cy="41" r="2.6" fill="' + p[1] + '"/></g></svg>';
  }

  // ------------------------------------------------------------------ title
  function renderTitle() {
    const d = store();
    setText(E.tBank, fmt(d.bank));
    setText(E.tBest, fmt(d.best));
    setText(E.tFar, fmtM(d.bestDist));
    const today = todayKey();
    const daily = d.daily || {};
    setText(E.tDailySub, daily.day === today && daily.best > 0 ? 'Best today ' + fmt(daily.best) : 'Same track for all');
    renderMini(E.tMissions, E.tLvl, E.tMblock);
    E.tShopDot.hidden = !canAffordSomething();
    renderRoute();
  }
  function todayKey() { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  function canAffordSomething() {
    const d = store(), shop = game().SHOP, bank = d.bank || 0;
    if (!shop || bank <= 0) return false;
    const owned = d.owned || [], ownedB = d.ownedBoards || [], ups = d.upgrades || {};
    if ((shop.skins || []).some((s) => owned.indexOf(s.id) < 0 && s.price > 0 && s.price <= bank)) return true;
    if ((shop.boards || []).some((b) => ownedB.indexOf(b.id) < 0 && b.price > 0 && b.price <= bank)) return true;
    return (shop.upgrades || []).some((u) => { const lv = ups[u.kind] || 0; return u.costs && lv < u.costs.length && u.costs[lv] <= bank; });
  }
  function renderRoute() {
    const w = worlds(), best = +store().bestDist || 0;
    if (!w.length) return;
    let v = '';
    for (let k = 0; k < w.length; k++) {
      const next = w[(k + 1) % w.length];
      v += '<li class="' + (best >= k * WL ? 'reached' : '') + '" style="--c:' + w[k].cssColor + ';--n:' + next.cssColor + '"><i></i>' +
        '<span>' + esc(w[k].name) + '<small>' + esc(w[k].sub || '') + '</small></span><em>' + fmtM(k * WL) + '</em></li>';
    }
    E.tRouteV.innerHTML = v;
    const span = (w.length - 1) * WL;
    let s = '<div class="rs-head"><b>The route</b><small>' + (best > 0 ? 'Your best run: ' + fmtM(best) + (best >= w.length * WL ? ' (lap ' + (Math.floor(best / (w.length * WL)) + 1) + ')' : '') : 'A new world every ' + fmtM(WL) + ', then the loop repeats') + '</small></div><div class="rs-line"><div class="rs-track"></div>';
    for (let k = 0; k < w.length; k++) {
      s += '<div class="rs-st' + (best >= k * WL ? ' reached' : '') + '" style="left:' + (k / (w.length - 1)) * 100 + '%;--c:' + w[k].cssColor + '"><b>' + esc(w[k].name) + '</b><i></i><em>' + fmtM(k * WL) + '</em></div>';
    }
    if (best > 0) s += '<div class="rs-best" style="left:' + (Math.min(best, span) / span) * 100 + '%" title="Your best run"></div>';
    E.tRoute.innerHTML = s + '</div>';
  }

  // ------------------------------------------------------------------ shop
  function shopData() {
    const shop = game().SHOP || {};
    const P = RR.player || {};
    return { skins: shop.skins || P.SKINS || [], boards: shop.boards || P.BOARDS || [], upgrades: shop.upgrades || [], items: shop.items || [] };
  }
  function setTab(tab, focus) {
    if (!tab || tab === shopTab) { if (focus) { const t = $('tab-' + tab); if (t) t.focus(); } return; }
    shopTab = tab;
    renderShop();
    E.sBody.scrollTop = 0;
    if (focus) { const t = $('tab-' + tab); if (t) t.focus(); }
  }
  function priceFoot(price, bank, act, id, label) {
    if (price <= bank) return '<span class="price">' + COIN + fmt(price) + '</span><button class="btn btn-sm" data-act="' + act + '" data-id="' + esc(id) + '" data-fk="buy:' + esc(id) + '">' + label + '</button>';
    return '<span class="price">' + COIN + fmt(price) + '</span><span class="need">Need ' + fmt(price - bank) + ' more</span>';
  }
  function renderShop() {
    const d = store(), bank = +d.bank || 0, data = shopData();
    setText(E.sBank, fmt(bank));
    ['skins', 'boards', 'upgrades', 'items'].forEach((t) => {
      const b = $('tab-' + t); if (!b) return;
      const on = t === shopTab;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    });
    E.sBody.setAttribute('aria-labelledby', 'tab-' + shopTab);
    // keep focus and scroll across re-renders (a purchase replaces the card's buttons)
    const act = doc.activeElement, fk = act && E.sBody.contains(act) && act.dataset ? act.dataset.fk : null, top = E.sBody.scrollTop;
    let html = '';
    if (shopTab === 'skins') {
      const owned = d.owned || [];
      html = data.skins.map((s) => {
        const isOwned = owned.indexOf(s.id) >= 0 || (!(s.price > 0) && !s.unlock), sel = d.skin === s.id, prev = preview.skins === s.id && !sel;
        const met = !isOwned && unlockMet(s.unlock);
        const unlock = s.unlock && !isOwned ? '<span class="card-note">' + icon(met ? 'check' : 'lock') + ' ' + (met ? 'Unlocked. Claim it for free' : esc(s.unlock.text || ('Or reach ' + (s.unlock.type === 'level' ? 'mission level ' + s.unlock.value : worldName(s.unlock.value))))) + '</span>' : '';
        let foot;
        if (sel) foot = '<span class="pill pill-gold">' + icon('check') + ' Selected</span><span class="state">Running now</span>';
        else if (isOwned) foot = '<span class="state">' + icon('check') + ' Owned</span><button class="btn btn-sm btn-glass" data-act="skin-select" data-id="' + esc(s.id) + '" data-fk="use:' + esc(s.id) + '">Select</button>';
        else if (met) foot = '<span class="pill pill-mint">' + icon('star') + ' Unlocked</span><button class="btn btn-sm" data-act="skin-buy" data-id="' + esc(s.id) + '" data-fk="buy:' + esc(s.id) + '">Claim</button>';
        else foot = priceFoot(+s.price || 0, bank, 'skin-buy', s.id, 'Buy');
        return card('skins', s, avatarSVG(s), foot, unlock, sel, prev, !isOwned, 'skin-select');
      }).join('');
      html = '<div class="cards">' + html + '</div><p class="shop-note">Tap a character to see them on the track. Characters are cosmetic.</p>';
    } else if (shopTab === 'boards') {
      const owned = d.ownedBoards || [];
      html = data.boards.map((b) => {
        const isOwned = owned.indexOf(b.id) >= 0 || !(b.price > 0), sel = d.board === b.id, prev = preview.boards === b.id && !sel;
        let foot;
        if (sel) foot = '<span class="pill pill-gold">' + icon('check') + ' Selected</span><span class="state">' + fmt(d.boards || 0) + ' in stock</span>';
        else if (isOwned) foot = '<span class="state">' + icon('check') + ' Owned</span><button class="btn btn-sm btn-glass" data-act="board-select" data-id="' + esc(b.id) + '" data-fk="use:' + esc(b.id) + '">Select</button>';
        else foot = priceFoot(+b.price || 0, bank, 'board-buy', b.id, 'Buy');
        return card('boards', b, boardSVG(b), foot, '', sel, prev, !isOwned, 'board-select');
      }).join('');
      html = '<div class="cards">' + html + '</div><p class="shop-note">A board design is how your hoverboards look. Buy hoverboards to ride in Items.</p>';
    } else if (shopTab === 'upgrades') {
      const ups = d.upgrades || {};
      html = data.upgrades.map((u) => {
        const P = POWER[u.kind] || { color: '#fff7ee', icon: 'bolt' };
        const costs = u.costs || [], max = costs.length || 5, lv = Math.min(max, ups[u.kind] || 0), durs = u.durations || [], cost = +costs[lv] || 0;
        let pips = ''; for (let i = 0; i < max; i++) pips += '<i' + (i < lv ? ' class="on"' : '') + '></i>';
        const dur = lv < max ? '<span class="dur">' + (durs[lv] || 0) + ' s → <b>' + (durs[lv + 1] || 0) + ' s</b></span>' : '<span class="dur"><b>' + (durs[lv] || 0) + ' s</b> · maxed out</span>';
        const foot = lv >= max ? '<span class="pill pill-mint">' + icon('star') + ' Max level</span><span class="state">Level ' + lv + ' of ' + max + '</span>'
          : '<span class="state">Level ' + lv + ' of ' + max + '</span>' + (cost <= bank
            ? '<button class="btn btn-sm" data-act="upgrade-buy" data-id="' + esc(u.kind) + '" data-fk="buy:' + esc(u.kind) + '" aria-label="Upgrade ' + esc(u.name) + ' for ' + fmt(cost) + ' coins">' + COIN + fmt(cost) + '</button>'
            : '<span class="need">' + COIN + ' ' + fmt(cost) + ' · need ' + fmt(cost - bank) + '</span>');
        return '<article class="card" style="--pc:' + P.color + '"><div class="card-hit" style="cursor:default"><span class="card-art"><span class="power-art">' + icon(P.icon) + '</span></span>' +
          '<span class="card-txt"><span class="card-name">' + esc(u.name) + '</span><span class="card-blurb">' + nb(u.blurb || '') + '</span><span class="pips" aria-label="Level ' + lv + ' of ' + max + '">' + pips + '</span>' + dur + '</span></div>' +
          '<div class="card-foot">' + foot + '</div></article>';
      }).join('');
      html = '<div class="cards">' + html + '</div><p class="shop-note">Upgrades make each power-up last longer when you pick it up on the track.</p>';
    } else {
      html = data.items.map((it) => {
        const A = ITEM_ART[it.id] || { icon: 'star', color: '#ffc233' };
        const key = ITEM_HAVE[it.id], have = key ? +d[key] || 0 : null;
        const qty = +it.qty > 1 ? '<b class="qty">×' + fmt(it.qty) + '</b>' : '';
        let art;
        if (A.icon === 'board') {
          const b = data.boards.filter((x) => x.id === d.board)[0] || data.boards[0] || { id: 'classic' };
          art = '<span class="item-art">' + boardSVG(b) + qty + '</span>';
        } else art = '<span class="power-art item-art" style="--pc:' + A.color + '">' + icon(A.icon) + qty + '</span>';
        return '<article class="card"><div class="card-hit" style="cursor:default"><span class="card-art">' + art + '</span>' +
          '<span class="card-txt"><span class="card-name">' + esc(it.name) + '</span><span class="card-blurb">' + nb(it.blurb || '') + '</span>' +
          (have !== null ? '<span class="card-note">You have ' + fmt(have) + '</span>' : '') + '</span></div>' +
          '<div class="card-foot">' + priceFoot(+it.price || 0, bank, 'item-buy', it.id, 'Buy') + '</div></article>';
      }).join('');
      html = '<div class="cards">' + html + '</div>';
    }
    if (!html || html === '<div class="cards"></div>') html = '<p class="empty">The shop is still stocking its shelves. Come back in a moment.</p>';
    E.sBody.innerHTML = html;
    E.sBody.scrollTop = top;
    if (fk) {
      let el = E.sBody.querySelector('[data-fk="' + cssEsc(fk) + '"]');
      if (!el) el = E.sBody.querySelector('[data-fk="hit:' + cssEsc(fk.split(':').slice(1).join(':')) + '"]');
      if (el) el.focus({ preventScroll: true });
    }
  }
  function unlockMet(u) {
    if (!u) return false;
    const d = store(), st = d.stats || {};
    if (u.type === 'world') return (+st.bestWorld || 0) >= +u.value;
    if (u.type === 'level') return (+d.missionLevel || 1) >= +u.value;
    return false;
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function worldName(v) { const w = worldAt(+v || 0); return w ? w.name : 'a new world'; }
  function card(kind, it, art, foot, note, sel, prev, locked, selectAct) {
    const cls = 'card' + (sel ? ' is-selected' : '') + (prev ? ' is-preview' : '') + (locked ? ' is-locked' : '');
    const tag = prev ? '<span class="pill pill-sky">Previewing</span>' : '';
    return '<article class="' + cls + '"><button class="card-hit" data-act="' + selectAct + '" data-id="' + esc(it.id) + '" data-fk="hit:' + esc(it.id) + '" aria-pressed="' + (sel || prev ? 'true' : 'false') + '" aria-label="' + esc(it.name) + (sel ? ', selected' : locked ? ', preview' : ', select') + '">' +
      '<span class="card-art">' + art + '</span><span class="card-txt"><span class="card-name">' + esc(it.name) + tag + '</span>' +
      '<span class="card-blurb">' + nb(it.blurb || '') + '</span>' + note + '</span></button>' +
      '<div class="card-foot">' + foot + '</div></article>';
  }

  // ------------------------------------------------------------------ missions & stats
  function renderMissions() {
    const d = store(), m = missionState(), st = game().stats || d.stats || {};
    setText(E.mBank, fmt(d.bank));
    let left = '';
    if (m) {
      const lvl = m.level || d.missionLevel || 1, next = lvl + 1, bank = +d.bank || 0;
      const reward = m.levelReward !== undefined ? m.levelReward : 200 * next;
      const extras = [];
      if ((m.nextBoardLevel !== undefined ? m.nextBoardLevel === next : next % 3 === 0)) extras.push('a free hoverboard');
      const unl = shopData().skins.concat(shopData().boards).filter((x) => x.unlock && x.unlock.type === 'level' && +x.unlock.value === next).map((x) => x.name);
      if (unl.length) extras.push(unl.join(' and ') + ' unlocked');
      left += '<div class="level-card"><span class="level-badge"><small>Level</small><b>' + lvl + '</b></span>' +
        '<h3>Score multiplier ×' + lvl + '</h3>' +
        '<p>' + (lvl >= 30 ? 'Top level reached. Missions still pay coins.' : 'Finish all three for <b>' + fmt(reward) + ' coins</b>, level ' + next + ' and a ×' + next + ' multiplier' + (extras.length ? ', plus ' + esc(extras.join(', ')) : '') + '.') + '</p></div>';
      left += '<div class="mfull">' + m.list.map((x, i) => {
        const target = Math.max(1, +x.target || 1), have = Math.min(target, Math.max(0, +x.have || 0)), f = x.done ? 1 : have / target;
        const cost = +m.skipCost || 0;
        const skip = x.done ? '<span class="pill pill-mint">' + icon('check') + ' Done</span>'
          : '<button class="skip" data-act="skip" data-i="' + i + '" data-fk="skip:' + i + '"' + (bank < cost ? ' disabled title="You need ' + fmt(cost - bank) + ' more coins"' : '') + ' aria-label="Skip this mission for ' + fmt(cost) + ' coins">' + icon('skip') + 'Skip ' + COIN + fmt(cost) + '</button>';
        return '<div class="mcard' + (x.done ? ' done' : '') + '"><span class="ms-dot">' + (x.done ? icon('check') : '') + '</span>' +
          '<span class="ms-text">' + nb(x.text) + '</span><span class="reward">+' + COIN + fmt(x.reward) + '</span>' +
          '<span class="bar"><i style="transform:scaleX(' + f.toFixed(3) + ')"></i></span><span class="mfoot">' + skip + '</span>' +
          '<span class="mnum">' + (x.done ? 'Complete' : fmt(have) + ' / ' + fmt(target)) + (x.scope === 'run' ? ' · in one run' : '') + '</span></div>';
      }).join('') + '</div>';
      left += '<p class="muted">Mission rewards go straight to your bank. Skipping swaps a mission for a new one.</p>';
    } else left = '<p class="empty">Missions appear after the game finishes loading.</p>';

    // stats
    const runs = +st.runs || +d.runs || 0;
    let right = '<div class="hero-stats">' +
      '<div><span>Runs</span><b>' + fmt(runs) + '</b></div>' +
      '<div><span>Best score</span><b>' + fmt(Math.max(+st.bestScore || 0, +d.best || 0)) + '</b></div>' +
      '<div><span>Furthest</span><b>' + fmtM(Math.max(+st.bestDist || 0, +d.bestDist || 0)) + '</b></div></div>';
    const rows = [];
    const seen = {};
    STAT_ROWS.forEach((r) => {
      const k = r[0]; seen[k] = 1;
      let v = st[k];
      if (k === 'coins' && v === undefined) v = d.totalCoins;
      if (v === undefined && (k === 'playSec' || k === 'bestWorld')) return;
      rows.push([r[1], statVal(v, r[2])]);
    });
    Object.keys(st).forEach((k) => {
      if (seen[k] || STAT_HIDDEN.test(k)) return;
      const v = st[k];
      if (typeof v === 'number' && isFinite(v)) rows.push([humanize(k), fmt(v)]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) { const sum = Object.keys(v).reduce((a, x) => a + (+v[x] || 0), 0); rows.push([humanize(k), fmt(sum)]); }
    });
    right += '<div class="block"><h3 class="sec-title">Lifetime</h3><dl class="kv">' + rows.map((r) => '<div><dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl></div>';
    // deaths by cause
    const deaths = [];
    Object.keys(st).forEach((k) => { if (k.indexOf('deaths_') === 0 && +st[k] > 0) deaths.push([k.slice(7), +st[k]]); });
    if (st.deaths && typeof st.deaths === 'object') Object.keys(st.deaths).forEach((k) => { if (+st.deaths[k] > 0) deaths.push([k, +st.deaths[k]]); });
    if (deaths.length) {
      deaths.sort((a, b) => b[1] - a[1]);
      const max = deaths[0][1];
      right += '<div class="block"><h3 class="sec-title">How runs ended</h3><ol class="deaths">' + deaths.map((x) => '<li><span>' + esc(DEATHS[x[0]] || humanize(x[0])) + '</span><span class="dbar"><i style="transform:scaleX(' + (x[1] / max).toFixed(3) + ')"></i></span><b>' + fmt(x[1]) + '</b></li>').join('') + '</ol></div>';
    }
    // recent runs
    const hist = Array.isArray(d.history) ? d.history.slice(0, 10) : [];
    right += '<div class="block"><h3 class="sec-title">Recent runs</h3>' + (hist.length ? '<ol class="hist">' + hist.map((h) => {
      const w = worldAt(h.world || 0) || { name: '', cssColor: '#fff' };
      const cause = HIST_CAUSE[h.cause] || (h.cause ? humanize(h.cause) : '');
      return '<li style="--c:' + w.cssColor + '"><i></i><span class="h1">' + esc(w.name) + (h.daily ? '<span class="tag">Daily</span>' : '') + '</span>' +
        '<span class="hs">' + fmt(h.score) + '<small>' + fmtM(h.dist) + '</small></span>' +
        '<span class="h2">' + esc([relDate(h.date), fmt(h.coins) + ' coins', cause].filter(Boolean).join(' · ')) + '</span></li>';
    }).join('') + '</ol>' : '<p class="empty">No runs yet. Your last ten runs show up here.</p>') + '</div>';
    const act = doc.activeElement, fk = act && E.mBody.contains(act) && act.dataset ? act.dataset.fk : null, top = E.mBody.scrollTop;
    E.mBody.innerHTML = '<div class="mcols"><div class="mcol"><h3 class="sec-title">Missions</h3>' + left + '</div><div class="mcol"><h3 class="sec-title">Stats</h3>' + right + '</div></div>';
    E.mBody.scrollTop = top;
    if (fk) { const el = E.mBody.querySelector('[data-fk="' + cssEsc(fk) + '"]'); if (el && !el.disabled) el.focus({ preventScroll: true }); else E.mH.focus({ preventScroll: true }); }
  }
  function statVal(v, f) {
    v = +v || 0;
    switch (f) {
      case 'km': return fmtKm(v);
      case 'm': return fmtM(v);
      case 'x': return '×' + fmt(v);
      case 't': return fmtTime(v);
      case 'world': return esc(worldName(v)) + (v >= worlds().length ? ' (lap ' + (Math.floor(v / worlds().length) + 1) + ')' : '');
      default: return fmt(v);
    }
  }
  function relDate(s) {
    if (!s) return '';
    let d;
    if (typeof s === 'number') d = new Date(s);
    else { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s); }
    if (isNaN(d)) return '';
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((t - d0) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ------------------------------------------------------------------ settings
  function syncSettings() {
    const set = (name, v) => { const el = doc.querySelector('#scr-settings input[name="' + name + '"][value="' + v + '"]'); if (el) el.checked = true; };
    set('quality', getSetting('quality') || 'auto');
    const rm = getSetting('reducedMotion'); set('reducedMotion', rm === true ? 'on' : rm === false ? 'off' : rm || 'auto');
    set('swipe', getSetting('swipe') || 'normal');
    $('set-sound').checked = getSetting('sound') !== false;
    $('set-music').checked = getSetting('music') !== false;
    $('set-touch').checked = !!getSetting('touchButtons');
    const tier = lastTier || (RR.quality && RR.quality.name) || '';
    setText(E.setQNote, getSetting('quality') === 'auto' || !getSetting('quality')
      ? 'Auto picks a level that keeps the game smooth' + (tier ? '. Running on ' + humanize(tier) + ' now.' : '.')
      : 'High adds bloom and soft shadows. Low is lightest on batteries.');
  }
  function disarmReset() {
    resetArmed = false;
    if (E.setResetB) { E.setResetB.hidden = true; E.setResetA.hidden = false; }
  }

  // ------------------------------------------------------------------ pause
  function renderPause(data) {
    const w = worldAt(data.world !== undefined ? data.world : H.world) || { name: '' };
    const dist = data.dist !== undefined ? data.dist : Math.max(0, H.dist);
    setText(E.pSub, fmtM(dist) + ' into ' + w.name);
    setText(E.pScore, fmt(data.score !== undefined ? data.score : Math.max(0, H.score)));
    setText(E.pCoins, fmt(data.coins !== undefined ? data.coins : Math.max(0, H.coins)));
    setText(E.pDist, fmtM(dist));
    renderMini(E.pMissions, E.pLvl, E.pMblock);
  }

  // ------------------------------------------------------------------ revive
  function renderRevive(data) {
    const secs = +data.seconds || +data.time || 5;
    const tokens = +data.tokens || 0, cost = +data.cost || 0, bank = data.bank !== undefined ? +data.bank : +store().bank || 0;
    const useToken = data.useToken !== undefined ? !!data.useToken : tokens > 0;
    if (useToken) {
      E.rYes.innerHTML = icon('heart') + '<span>Use a token</span>';
      setText(E.rSub, 'Revive on the spot with a revive token. You have ' + tokens + ' left.');
    } else {
      E.rYes.innerHTML = COIN + '<span>Revive · ' + fmt(cost) + '</span>';
      setText(E.rSub, 'Revive on the spot and the track ahead gets cleared. Bank: ' + fmt(bank) + ' coins.');
    }
    E.rYes.setAttribute('aria-label', useToken ? 'Revive with a token' : 'Revive for ' + fmt(cost) + ' coins');
    stopRevive();
    reviveTimedOut = false; reviveSec = -1;
    reviveEnd = now() + secs * 1000;
    E.rRing.classList.remove('run'); void E.rRing.getBoundingClientRect();
    E.rRing.style.animationDuration = secs + 's';
    E.rRing.style.setProperty('--ring-t', secs + 's');
    E.rRing.classList.add('run');
    reviveRaf = requestAnimationFrame(reviveTick);
  }
  function reviveTick() {
    reviveRaf = 0;
    if (ui.screen !== 'revive') return;
    const left = reviveEnd - now();
    const s = Math.max(0, Math.ceil(left / 1000));
    if (s !== reviveSec) { reviveSec = s; E.rSec.textContent = String(s); }
    // the game runs its own timer; this is a fallback a little later so the two never race
    if (left < -250) { if (!reviveTimedOut) { reviveTimedOut = true; emit('ui:decline-revive', { timeout: true }); } return; }
    reviveRaf = requestAnimationFrame(reviveTick);
  }
  function stopRevive() { if (reviveRaf) cancelAnimationFrame(reviveRaf); reviveRaf = 0; }

  // ------------------------------------------------------------------ game over
  function renderOver(r, noAnim) {
    const d = store();
    const w = worldAt(r.world || 0);
    const cause = CAUSE[r.causeId] || CAUSE[r.cause] || null;
    setText(E.oEyebrow, (r.daily ? 'Daily run · ' : '') + 'Reached ' + (r.worldName || (w ? w.name : '')));
    setText(E.oH, cause ? cause[0] : 'Wiped out!');
    setText(E.oCause, typeof r.cause === 'string' && !CAUSE[r.cause] ? r.cause : cause ? cause[1] : 'Your run is over.');
    E.oNewbest.hidden = !r.newBest;
    setText(E.oBest, fmt(r.best !== undefined ? r.best : d.best));
    setText(E.oDist, fmtM(r.dist));
    const bank = r.bank !== undefined ? +r.bank : +d.bank || 0, coins = +r.coins || 0, score = +r.score || 0;
    // level-up banner
    const lu = r.levelUp;
    if (lu) {
      const lvl = typeof lu === 'object' ? lu.level : typeof lu === 'number' ? lu : (missionState() || {}).level || d.missionLevel;
      const bits = ['Multiplier ×' + lvl];
      if (typeof lu === 'object' && lu.reward) bits.push('+' + fmt(lu.reward) + ' coins');
      if (typeof lu === 'object' && lu.board) bits.push('+1 hoverboard');
      E.oLevel.innerHTML = '<span class="lv">' + esc(lvl) + '</span><b>Level up!</b><span>' + esc(bits.join(' · ')) + '</span>';
      E.oLevel.hidden = false;
    } else E.oLevel.hidden = true;
    renderOverMissions(r);
    if (noAnim || reducedMotion()) {
      setText(E.oScore, fmt(score)); setText(E.oCoins, fmt(coins)); setText(E.oBank, fmt(bank));
    } else {
      setText(E.oScore, '0'); setText(E.oCoins, '0'); setText(E.oBank, fmt(Math.max(0, bank - coins)));
      startAnim([[E.oScore, 0, score], [E.oCoins, 0, coins], [E.oBank, Math.max(0, bank - coins), bank]], 1100, 250);
    }
  }
  function renderOverMissions(r) {
    const done = Array.isArray(r.missionsDone) ? r.missionsDone : [];
    const doneText = done.map((x) => (typeof x === 'string' ? x : x && x.text) || '');
    const m = missionState();
    renderMini(E.oMissions, E.oLvl, E.oMblock, doneText);
    if (!m) return;
    const current = m.list.map((x) => x.text);
    const extra = done.filter((x, i) => current.indexOf(doneText[i]) < 0);
    if (extra.length) {
      E.oMissions.insertAdjacentHTML('afterbegin', extra.map((x) => '<li class="ms done just"><span class="ms-dot">' + icon('check') + '</span><span class="ms-text">' + nb(typeof x === 'string' ? x : x.text) + '</span><span class="ms-num">' + (x.reward ? '+' + fmt(x.reward) : 'Done') + '</span><span class="bar"><i style="transform:scaleX(1)"></i></span></li>').join(''));
    }
  }
  function startAnim(items, dur, delay) {
    stopAnim();
    anim = { t0: now() + (delay || 0), dur, items };
    animRaf = requestAnimationFrame(tickAnim);
  }
  function tickAnim() {
    animRaf = 0;
    if (!anim) return;
    const f = clamp01((now() - anim.t0) / anim.dur), e = 1 - Math.pow(1 - f, 3);
    for (let i = 0; i < anim.items.length; i++) { const it = anim.items[i]; setText(it[0], fmt(it[1] + (it[2] - it[1]) * e)); }
    if (f < 1) animRaf = requestAnimationFrame(tickAnim); else anim = null;
  }
  function stopAnim() {
    if (animRaf) cancelAnimationFrame(animRaf);
    animRaf = 0;
    if (anim) { for (let i = 0; i < anim.items.length; i++) { const it = anim.items[i]; setText(it[0], fmt(it[2])); } anim = null; }
  }

  // ------------------------------------------------------------------ countdown
  let cdLast = null, cdLastT = 0;
  function countdown(n) {
    const t = now();
    if (n === cdLast && t - cdLastT < 250 && !E.countdown.hidden) return; // show() and the countdown event arrive together
    cdLast = n; cdLastT = t;
    clearTimeout(cdTimer);
    const go = !(n > 0);
    E.cdN.textContent = go ? 'Go!' : String(n);
    E.cdN.classList.toggle('go', go);
    E.cdN.classList.remove('show'); void E.cdN.offsetWidth; E.cdN.classList.add('show');
    E.countdown.hidden = false; cdShown = !go;
    announce(go ? 'Go!' : n === 3 ? 'Resuming in 3' : String(n));
    if (go) cdTimer = setTimeout(() => { E.countdown.hidden = true; }, 700);
  }

  // ------------------------------------------------------------------ HUD
  function makePowerRow(kind) {
    const P = POWER[kind] || { label: humanize(kind), color: '#fff7ee', icon: 'bolt' };
    const el = doc.createElement('div');
    el.className = 'pw k-' + kind; el.hidden = true;
    el.style.setProperty('--pc', P.color);
    el.innerHTML = '<span class="pic">' + icon(P.icon) + '</span><span class="lbl">' + esc(P.label) + '</span><span class="sec">0s</span><span class="pbar"><i></i></span>';
    el.setAttribute('aria-label', P.label);
    E.hPowers.appendChild(el);
    const row = { kind, el, bar: el.querySelector('.pbar i'), lbl: el.querySelector('.lbl').firstChild, sec: el.querySelector('.sec').firstChild, label: P.label, lowLabel: P.low || '', q: -1, s: -1, low: false, hidden: true, stamp: 0 };
    powerRows[kind] = row; powerList.push(row);
    return row;
  }
  // Counters as fixed-width digit cells: only the cells whose character changed are touched.
  function makeDigits(el) { el.textContent = ''; return { el, cells: [], str: null }; }
  function setDigits(D, str) {
    if (str === D.str) return;
    D.str = str;
    const cells = D.cells, n = str.length;
    while (cells.length < n) {
      const sp = doc.createElement('span'); sp.className = 'dg';
      const t = doc.createTextNode(''); sp.appendChild(t); D.el.appendChild(sp);
      cells.push({ sp, t, ch: '', sep: false, on: true });
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (i < n) {
        const ch = str[i];
        if (!c.on) { c.on = true; c.sp.hidden = false; }
        if (ch !== c.ch) {
          c.ch = ch; c.t.nodeValue = ch;
          const sep = ch === ',' || ch === '.';
          if (sep !== c.sep) { c.sep = sep; c.sp.className = sep ? 'dg sep' : 'dg'; }
        }
      } else if (c.on) { c.on = false; c.sp.hidden = true; }
    }
  }
  function setWorldHud(i) {
    const w = worldAt(i); if (!w) return;
    E.tWorld.nodeValue = w.name;
    E.hud.style.setProperty('--wc', w.cssColor);
  }
  function hud(d) {
    if (!ui.inited || !d || !E.hud) return;
    let v = Math.floor(+d.score || 0);
    if (v !== H.score) { H.score = v; setDigits(E.dScore, fmt(v)); }
    v = +d.coins | 0;
    if (v !== H.coins) { H.coins = v; setDigits(E.dCoins, fmt(v)); }
    v = +d.mult || 1;
    if (v !== H.mult) { H.mult = v; E.tMult.nodeValue = '×' + v; }
    const dist = +d.dist || 0;
    v = Math.floor(dist);
    if (v !== H.dist) {
      if (v < H.dist - 20) resetRunHud();
      H.dist = v; setDigits(E.dDist, fmt(v));
      const q = Math.round(((dist % WL) / WL) * 200);
      if (q !== H.wq) { H.wq = q; E.hWprog.style.transform = SX[q]; }
      if (H.bestAtStart < 0 && d.bestDist !== undefined) H.bestAtStart = +d.bestDist || 0;
      if (!H.bestFlashed && H.bestAtStart > 200 && dist > H.bestAtStart) { H.bestFlashed = true; flashBest(); }
    }
    v = d.world | 0;
    if (v !== H.world) { H.world = v; setWorldHud(v); }
    // power-ups
    const list = d.powers;
    const stamp = ++H.stamp;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || !(p.left > 0)) continue;
        const row = powerRows[p.kind] || makePowerRow(p.kind);
        row.stamp = stamp;
        if (row.hidden) { row.hidden = false; row.el.hidden = false; }
        const q = p.dur > 0 ? Math.round(clamp01(p.left / p.dur) * 200) : 0;
        if (q !== row.q) { row.q = q; row.bar.style.transform = SX[q]; }
        const s = Math.ceil(p.left);
        if (s !== row.s) { row.s = s; row.sec.nodeValue = s < 100 ? SECS[s] : s + 's'; }
        const low = p.left < 1.2;
        if (low !== row.low) { row.low = low; row.el.classList.toggle('low', low); if (row.lowLabel) row.lbl.nodeValue = low ? row.lowLabel : row.label; }
      }
    }
    for (let i = 0; i < powerList.length; i++) {
      const r = powerList[i];
      if (!r.hidden && r.stamp !== stamp) { r.hidden = true; r.el.hidden = true; r.q = -1; r.s = -1; if (r.low) { r.low = false; r.el.classList.remove('low'); r.lbl.nodeValue = r.label; } }
    }
    // combo
    const c = d.combo;
    const n = c && c.n >= 2 ? c.n | 0 : 0;
    if (n !== H.comboN) {
      if (!n) E.hCombo.hidden = true;
      else { E.tComboN.nodeValue = '×' + n; E.hCombo.hidden = false; }
      H.comboN = n; H.comboQ = -1;
    }
    if (n) {
      const q = c.dur > 0 ? Math.round(clamp01(c.left / c.dur) * 40) : 0;
      if (q !== H.comboQ) { H.comboQ = q; E.hComboRing.style.strokeDashoffset = DASH[q]; }
    }
    // hoverboard button (becomes a Head Start button while one is offered)
    const hs = !!d.headStart;
    v = hs ? +store().headStarts || 0 : +d.boards | 0;
    const act = !!d.boardActive;
    if (v !== H.boards || act !== H.boardActive || hs !== H.hs) {
      if (hs !== H.hs) {
        E.hBoardIc.firstElementChild.setAttribute('href', hs ? '#i-rocket' : '#i-board');
        E.hBoardKey.textContent = hs ? 'H' : 'B';
        E.hBoard.classList.toggle('hs', hs);
      }
      H.boards = v; H.boardActive = act; H.hs = hs;
      E.tBoardN.nodeValue = String(v);
      E.hBoard.classList.toggle('empty', v === 0 && !act);
      E.hBoard.classList.toggle('active', act && !hs);
      E.hBoard.setAttribute('aria-label', hs ? 'Use a Head Start (' + v + ' left)' : act ? 'Hoverboard active' : 'Ride a hoverboard (' + v + ' left)');
    }
  }
  function resetRunHud() {
    if (!ui.inited) return;
    H.dist = -1; H.wq = -1; H.bestAtStart = -1; H.bestFlashed = false; H.comboN = -1; H.world = -1; bestFlashT = -1e9;
    E.hCombo.hidden = true;
    for (let i = 0; i < powerList.length; i++) { const r = powerList[i]; r.hidden = true; r.el.hidden = true; r.q = -1; r.s = -1; r.low = false; r.el.classList.remove('low'); r.lbl.nodeValue = r.label; }
    E.hStunt.classList.remove('show');
    E.hBestd.hidden = true; E.hWtoast.hidden = true; wtoastIdx = -1;
    hideToasts();
  }
  function flashBest(text) {
    const t = now();
    if (t - bestFlashT < 3000) return; // game.js may also announce it
    bestFlashT = t;
    E.hBestd.textContent = text || 'New best distance!';
    E.hBestd.classList.remove('show'); E.hBestd.hidden = false; void E.hBestd.offsetWidth; E.hBestd.classList.add('show');
  }
  function stunt(label, points, kind) {
    if (!ui.inited) return;
    const t = now();
    // keep a fresh stunt readable for a moment before replacing it
    E.stuntL.textContent = label; E.stuntP.textContent = points || '';
    E.hStunt.className = 'stunt k-' + (kind || 'stunt');
    if (t - stuntT > 16) { void E.hStunt.offsetWidth; }
    E.hStunt.classList.add('show');
    stuntT = t;
  }

  // ------------------------------------------------------------------ toasts & hints
  function toastWorld(index) {
    if (!ui.inited) init();
    const w = worldAt(index); if (!w || !E.hWtoast) return;
    const t = now();
    if (index === wtoastIdx && t - wtoastT < 5000) return;
    wtoastIdx = index; wtoastT = t;
    const el = E.hWtoast;
    el.querySelector('strong').textContent = w.name;
    el.querySelector('span').textContent = w.sub || '';
    el.style.setProperty('--wc', w.cssColor);
    el.classList.remove('show'); el.hidden = false; void el.offsetWidth; el.classList.add('show');
    announce('Now entering ' + w.name + '. ' + (w.sub || ''));
    clearTimeout(wtoastTimer);
    wtoastTimer = setTimeout(() => { el.hidden = true; el.classList.remove('show'); }, 3800);
  }
  const TOAST_ICON = { mission: 'check', level: 'star', best: 'trophy', warn: 'warn', shop: 'bag', reward: 'star', combo: 'bolt', pickup: 'board', tutorial: 'info', info: 'info' };
  function toast(text, kind, sub) {
    if (!ui.inited) init();
    if (!text || !E.hToasts) return;
    kind = kind || 'info';
    text = String(text);
    if (kind === 'stunt') { stunt(text, sub || '', 'stunt'); return; }
    if (kind === 'best' && /distance/i.test(text) && ui.screen === 'run') { flashBest(text); return; }
    const t = now();
    if (text === lastToastText && t - lastToastT < 600) return;
    lastToastText = text; lastToastT = t;
    const hudVisible = !E.hud.hidden;
    // "Title: detail" and "Title · detail" read better as two lines
    let title = text, detail = sub || '';
    if (!detail) {
      const m = /^([^:·]{3,40})[:·]\s+(.+)$/.exec(text);
      if (m) { title = m[1].trim(); detail = m[2].trim(); }
    }
    if (!hudVisible) { menuToast(title, detail, kind); return; } // menus: purchase confirmations etc.
    // reuse a free pooled toast, else the oldest
    let slot = null;
    for (let i = 0; i < toastPool.length; i++) if (toastPool[i].el.hidden) { slot = toastPool[i]; break; }
    if (!slot) { slot = toastPool[0]; for (let i = 1; i < toastPool.length; i++) if (toastPool[i].seq < slot.seq) slot = toastPool[i]; }
    clearTimeout(slot.timer);
    slot.seq = ++toastSeq;
    slot.el.className = 'toast k-' + kind;
    slot.el.style.order = String(slot.seq);
    slot.ic.innerHTML = icon(TOAST_ICON[kind] || 'info');
    slot.title.textContent = title;
    slot.sub.textContent = detail;
    slot.sub.hidden = !detail;
    slot.el.hidden = false; void slot.el.offsetWidth; slot.el.classList.add('show');
    const dur = kind === 'level' ? 3600 : kind === 'warn' ? 2600 : 2900;
    slot.timer = setTimeout(() => { slot.el.classList.remove('show'); slot.el.classList.add('out'); }, dur);
  }
  // A small toast inside menu screens (e.g. purchase confirmations), reusing the HUD pool markup.
  let menuToastEl = null, menuToastTimer = 0;
  function menuToast(title, detail, kind) {
    if (!menuToastEl) {
      menuToastEl = doc.createElement('div');
      menuToastEl.className = 'menu-toast';
      menuToastEl.setAttribute('role', 'status'); menuToastEl.setAttribute('aria-live', 'polite');
      E.ui.appendChild(menuToastEl);
    }
    menuToastEl.innerHTML = '<div class="toast show k-' + esc(kind) + '"><span class="tic">' + icon(TOAST_ICON[kind] || 'info') + '</span><span class="tbody"><b>' + esc(title) + '</b>' + (detail ? '<span class="tsub">' + esc(detail) + '</span>' : '') + '</span></div>';
    menuToastEl.hidden = false;
    clearTimeout(menuToastTimer);
    menuToastTimer = setTimeout(() => { menuToastEl.hidden = true; }, 2600);
  }
  // screen-reader announcements for things drawn in elements that toggle `hidden`
  function announce(text) { if (E.srLive) E.srLive.textContent = text; }
  function hideToasts() {
    for (let i = 0; i < toastPool.length; i++) { clearTimeout(toastPool[i].timer); toastPool[i].el.hidden = true; }
  }
  function hint(text, ms, opts) {
    if (!ui.inited) init();
    if (!E.hHint) return;
    if (text === null || text === undefined || text === '') { clearHint(); return; }
    hintSrc = { text, urgent: !!(opts && opts.urgent) };
    renderHint(hintSrc);
    clearTimeout(hintTimer);
    if (ms > 0) hintTimer = setTimeout(clearHint, ms);
  }
  function renderHint(src) {
    let t = src.text;
    if (typeof t === 'string' && HINTS[t]) t = HINTS[t];
    if (t && typeof t === 'object') t = (inputMode === 'touch' ? t.touch : t.key) || t.key || t.touch || t.text || '';
    t = String(t);
    let h = nb(t)
      .replace(/(←|→|↑|↓)/g, '<kbd>$1</kbd>')
      .replace(/\b(Space|Shift|Enter|Esc)\b/g, '<kbd>$1</kbd>')
      .replace(/\b(Press|press|or|Hit|hit) ([A-Z])\b/g, '$1 <kbd>$2</kbd>')
      .replace(/<\/kbd>\s*\/\s*<kbd>/g, '</kbd> or <kbd>');
    const m = /\bswipe (up|down|left|right)\b/i.exec(t);
    if (m) h = '<span class="swipe d-' + m[1].toLowerCase() + '">' + icon('swipe') + '</span><span>' + h + '</span>';
    else h = '<span>' + h + '</span>';
    E.hHint.innerHTML = h;
    E.hHint.classList.toggle('urgent', !!src.urgent);
    E.hHint.hidden = false;
  }
  function clearHint() {
    if (!ui.inited || !E.hHint) return;
    clearTimeout(hintTimer);
    hintSrc = null;
    E.hHint.hidden = true;
  }
  function fatal(message) {
    const f = $('fatal'); if (!f) { console.error('[RR] fatal:', message); return; }
    fatalShown = true;
    const msg = $('fatal-msg'); if (msg) msg.textContent = message || 'Something went wrong while starting the game. Reload the page to try again.';
    const l = $('loading'); if (l) l.hidden = true;
    const u = $('ui'); if (u) u.hidden = true;
    f.hidden = false;
    const r = $('fatal-reload');
    if (r) { if (!r.__rr) { r.__rr = 1; r.addEventListener('click', () => location.reload()); } try { r.focus({ preventScroll: true }); } catch (e) { r.focus(); } }
  }

  // ------------------------------------------------------------------ input
  function onClick(e) {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el || !E.ui.contains(el) || el.disabled) return;
    const act = el.dataset.act, id = el.dataset.id;
    if (act === 'board') {
      // pointerdown already fired it (no click latency mid-run); keyboard activation arrives as a click
      if (now() - boardPointerT > 600) emit('ui:board');
      return;
    }
    emit('ui:click', { act });
    switch (act) {
      case 'start': emit('ui:start'); break;
      case 'daily': emit('ui:daily'); break;
      case 'nav': if (el.dataset.quit) emit('ui:quit'); go(el.dataset.to); break;
      case 'back': back(); break;
      case 'sound': toggleSetting('sound'); break;
      case 'music': toggleSetting('music'); break;
      case 'pause': emit('ui:pause'); break;
      case 'resume': emit('ui:resume'); break;
      case 'restart': emit('ui:restart'); break;
      case 'quit': emit('ui:quit'); break;
      case 'revive': emit('ui:revive'); break;
      case 'decline': emit('ui:decline-revive'); break;
      case 'tab': setTab(el.dataset.tab); break;
      case 'skin-select': preview.skins = id; emit('ui:skin-select', { id }); if (ui.screen === 'shop') renderShop(); break;
      case 'skin-buy': emit('ui:skin-buy', { id }); break;
      case 'board-select': preview.boards = id; emit('ui:board-select', { id }); if (ui.screen === 'shop') renderShop(); break;
      case 'board-buy': emit('ui:board-buy', { id }); break;
      case 'upgrade-buy': emit('ui:upgrade-buy', { kind: id }); break;
      case 'item-buy': emit('ui:item-buy', { id }); break;
      case 'skip': emit('ui:skip-mission', { i: +el.dataset.i }); break;
      case 'replay': emit('ui:replay-tutorial'); break;
      case 'reset':
        resetArmed = true; E.setResetA.hidden = true; E.setResetB.hidden = false;
        try { E.setResetNo.focus({ preventScroll: false }); } catch (err) { E.setResetNo.focus(); }
        break;
      case 'reset-cancel': disarmReset(); E.setReset.focus(); break;
      case 'reset-confirm':
        if (!resetArmed) break;
        disarmReset();
        for (const k in pending) delete pending[k];
        emit('ui:reset-progress');
        applySettings();
        if (ui.screen === 'settings') syncSettings();
        menuToast('Progress reset', 'A fresh start. Good luck out there.', 'info');
        break;
      default: break;
    }
  }
  function onChange(e) {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || !E.scr.settings.contains(t)) return;
    emit('ui:click', { act: 'setting' });
    if (t.type === 'radio') { if (t.checked) setSetting(t.name, t.value); }
    else if (t.type === 'checkbox' && t.dataset.key) setSetting(t.dataset.key, t.checked);
  }
  // Keys the UI owns. Handled in the capture phase and stopped, so game.js never sees them twice.
  function onKeyDown(e) {
    if (!ui.inited || fatalShown) return;
    const k = e.key;
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return;
    setInputMode('keys');
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = (t && t.tagName) || '';
    const isCtl = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'LABEL';
    const consume = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'm' || k === 'M') { consume(); if (!e.repeat) toggleSetting('sound'); return; }
    if (E.loading && !E.loading.hidden && !E.loading.classList.contains('gone')) return;
    const enter = k === 'Enter', space = k === ' ' || k === 'Spacebar';
    switch (ui.screen) {
      case 'title':
      case 'over':
        if ((enter || space) && !isCtl) { consume(); if (!e.repeat) emit('ui:start'); }
        else if ((enter || space) && isCtl && e.repeat) consume();
        break;
      case 'shop':
      case 'missions':
      case 'settings':
        if (k === 'Escape' || (k === 'Backspace' && tag !== 'INPUT')) { consume(); if (!e.repeat) back(); }
        else if ((enter || space) && !isCtl) consume();
        else if (ui.screen === 'shop' && t && t.getAttribute && t.getAttribute('role') === 'tab' && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End')) {
          consume();
          const order = ['skins', 'boards', 'upgrades', 'items'];
          let i = order.indexOf(shopTab);
          i = k === 'Home' ? 0 : k === 'End' ? order.length - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
          setTab(order[i], true);
        }
        break;
      case 'pause':
        if (k === 'Escape' || k === 'p' || k === 'P') { consume(); if (!e.repeat) emit('ui:resume'); }
        else if ((enter || space) && !isCtl) consume();
        break;
      case 'revive':
        if (enter) { consume(); if (!e.repeat) emit(t === E.rNo ? 'ui:decline-revive' : 'ui:revive'); }
        else if (k === 'Escape') { consume(); if (!e.repeat) emit('ui:decline-revive'); }
        else if (space && !isCtl) consume();
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ boot watchdog
  // If three.js or game.js never arrived, say so instead of leaving the loader spinning.
  window.addEventListener('load', () => {
    if (!window.THREE) { fatal('The 3D engine (three.js) could not load. Check your internet connection and reload the page.'); return; }
    setTimeout(() => {
      if (!RR.game && !ui.screen && !fatalShown) fatal('Some game files did not load. Reload the page. If you opened it from a folder, keep the js folder next to index.html.');
    }, 4000);
  });

  // ------------------------------------------------------------------ API
  const api = {
    init, show, hud, toastWorld, toast, hint, clearHint, fatal,
    back, go,
    get screen() { return ui.screen; },
    inputMode: () => inputMode,
    reducedMotion,
    // lifecycle no-ops so generic module loops can call them safely
    reset() {}, update() {}, setQuality() {}
  };
  if (RR.register) RR.register('ui', api); else RR.ui = api;
})(window.RR);
