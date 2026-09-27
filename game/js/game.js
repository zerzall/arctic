/* Rainbow Rails — game
 * Boot, renderer/scene/camera, the fixed-step main loop, state machine, input, physics and collisions,
 * power-ups, hoverboard, revive, scoring and combos, missions, stats, shop transactions, the quality
 * governor, the camera, and the window.__RR debug hook used by automated tests.
 */
(function (RR) {
  'use strict';
  const C = RR.C;
  const LANES = C.LANES;
  const STEP = C.FIXED_DT;
  const MAX_STEPS = 12;
  const clamp = RR.clamp;

  const game = (RR.game = RR.game || {});

  // ------------------------------------------------------------------ catalogue
  const DEFAULT_SKINS = [{ id: 'nova', name: 'Nova', price: 0, blurb: 'Pink hoodie, blue cap, zero fear.' }];
  const DEFAULT_BOARDS = [{ id: 'classic', name: 'Classic', price: 0, blurb: 'The board that started it all.' }];
  const UPGRADE_COSTS = [400, 1000, 2500, 6000, 12000];
  const UPGRADES = [
    { kind: 'magnet', name: 'Coin Magnet', blurb: 'Pulls in every coin nearby.', durations: [10, 12, 14, 16, 18, 20], costs: UPGRADE_COSTS },
    { kind: 'sneakers', name: 'Super Sneakers', blurb: 'Jump high enough to land on trains.', durations: [10, 12, 14, 16, 18, 20], costs: UPGRADE_COSTS },
    { kind: 'double', name: 'Double Score', blurb: 'Every point counts twice.', durations: [12, 14, 16, 18, 20, 22], costs: UPGRADE_COSTS },
    { kind: 'jetpack', name: 'Jetpack', blurb: 'Fly over everything and grab the sky coins.', durations: [6, 7, 8, 9, 10, 11], costs: UPGRADE_COSTS }
  ];
  const ITEMS = [
    { id: 'board1', name: 'Hoverboard', blurb: 'Survives one crash. Double-tap or press B to ride.', price: 250, qty: 1 },
    { id: 'board5', name: 'Hoverboard ×5', blurb: 'Five boards, one fifth off.', price: 1000, qty: 5 },
    { id: 'headstart', name: 'Head Start', blurb: 'Rocket through the first 500 m. Press H at the start of a run.', price: 1500, qty: 1 },
    { id: 'token', name: 'Revive Token', blurb: 'Keep running after a crash, free of charge.', price: 800, qty: 1 }
  ];
  const POWER_KINDS = ['magnet', 'sneakers', 'double', 'jetpack'];

  // ------------------------------------------------------------------ missions
  // scope: 'run' = best within one run, 'total' = accumulates across runs, 'best' = single highest value
  const MISSIONS = [
    { id: 'coins-run', t: 'Collect {n} coins in one run', stat: 'coins', scope: 'run', n: [100, 200, 350, 500, 800, 1200] },
    { id: 'coins-total', t: 'Collect {n} coins', stat: 'coins', scope: 'total', n: [300, 800, 1500, 3000, 5000, 8000] },
    { id: 'dist-run', t: 'Run {n} m in one run', stat: 'dist', scope: 'run', n: [500, 1000, 1500, 2500, 3500, 5000] },
    { id: 'score-run', t: 'Score {n} in one run', stat: 'score', scope: 'run', n: [2000, 5000, 10000, 20000, 40000, 80000] },
    { id: 'jumps', t: 'Jump {n} times', stat: 'jumps', scope: 'total', n: [20, 50, 100, 150, 250, 400] },
    { id: 'rolls-run', t: 'Roll {n} times in one run', stat: 'rolls', scope: 'run', n: [5, 10, 15, 25, 35, 50] },
    { id: 'lanes-run', t: 'Change lanes {n} times in one run', stat: 'lanes', scope: 'run', n: [20, 40, 60, 90, 120, 160] },
    { id: 'near-run', t: 'Pull off {n} near misses in one run', stat: 'nearMiss', scope: 'run', n: [3, 6, 10, 15, 20, 30] },
    { id: 'combo', t: 'Reach a ×{n} combo', stat: 'combo', scope: 'best', n: [3, 5, 8, 12, 16, 20] },
    { id: 'roof-run', t: 'Run {n} m on train roofs in one run', stat: 'roofM', scope: 'run', n: [100, 250, 500, 800, 1200, 2000] },
    { id: 'ramps', t: 'Ride up {n} ramps', stat: 'ramps', scope: 'total', n: [5, 10, 20, 35, 50, 80] },
    { id: 'pickups', t: 'Pick up {n} power-ups', stat: 'pickups', scope: 'total', n: [3, 6, 10, 15, 20, 30] },
    { id: 'magnet-run', t: 'Collect {n} coins with a magnet in one run', stat: 'magnetCoins', scope: 'run', n: [30, 60, 100, 150, 220, 300] },
    { id: 'jet-total', t: 'Fly {n} m with a jetpack', stat: 'jetpackM', scope: 'total', n: [200, 500, 1000, 2000, 3500, 5000], needs: 'jetpack' },
    { id: 'board-save', t: 'Get saved by a hoverboard {n} times', t1: 'Get saved by a hoverboard once', stat: 'boardSaves', scope: 'total', n: [1, 2, 3, 4, 5, 6] },
    { id: 'world', t: 'Reach {world}', stat: 'worldCount', scope: 'best', n: [1, 2, 3, 4, 5, 7] },
    { id: 'movers', t: 'Dodge {n} oncoming trains', stat: 'moverDodges', scope: 'total', n: [3, 6, 10, 15, 25, 40] },
    { id: 'hurdles-run', t: 'Clear {n} barriers in one run', stat: 'hurdles', scope: 'run', n: [10, 20, 35, 50, 70, 100] }
  ];
  const band = () => Math.min(5, Math.floor((save().missionLevel - 1) / 2));
  const missionText = (def, target) => (target === 1 && def.t1 ? def.t1 : def.t).replace('{n}', target.toLocaleString()).replace('{world}', RR.WORLDS[target % RR.WORLDS.length].name + (target >= RR.WORLDS.length ? ' again' : ''));

  const CAUSES = {
    train: 'Flattened by a train.',
    oncoming: 'Met an oncoming train head-on.',
    hurdle: 'Tripped over a barrier.',
    bar: 'Clotheslined by a low sign.',
    block: 'Ran into a barrier wall.',
    stumble: 'Two scrapes in a row.'
  };

  // ------------------------------------------------------------------ state
  const save = () => RR.store.data;
  let renderer, scene, camera, ctx, canvas, app;
  let tier = RR.QUALITY.high, tierName = 'high', pixelRatio = 1, maxPixelRatio = 1;
  let state = 'boot'; // title | run | paused | countdown | dying | revive | over
  let rafId = 0, frozen = false, lastT = 0, acc = 0, timeScale = 1, T = 0;
  const S = {}; // run simulation state (see resetRun)
  const view = { px: 0, py: 0, pz: 0 }; // interpolated for rendering
  const prev = { px: 0, py: 0, pz: 0 };
  let god = false, autopilot = false, wouldDie = 0;
  let countdownT = 0, countdownN = 0, reviveT = 0, dyingT = 0;
  let previewSkin = null, previewBoard = null;
  let reduceMotion = false, isTouch = false;
  const frame = {
    t: 0, dt: 0, state: 'title', pz: 0, px: 0, py: 0, speed: 0, dist: 0, world: 0, worldCount: 0, inTunnel: false, camera: null,
    player: { lane: 1, grounded: true, rolling: false, jetpack: false, board: false, sneakers: false, magnet: false, double: false, invulnerable: false }
  };
  const pose = {
    x: 0, y: 0, z: 0, laneVel: 0, grounded: true, vy: 0, rolling: false, rollT: 0, jetpack: false, jetpackY01: 0, board: false,
    sneakers: false, magnet: false, invulnerable: false, speed: 0, state: 'title', deathT: 0, stumbleT: 0, landT: 0, celebrate: false
  };
  const hudData = { score: 0, coins: 0, mult: 1, dist: 0, world: 0, powers: [], boards: 0, boardActive: false, combo: { n: 0, left: 0, dur: 1 }, bestDist: 0, headStart: false };
  const powerHud = POWER_KINDS.map((kind) => ({ kind, left: 0, dur: 1 }));
  const boardHud = { kind: 'board', left: 0, dur: 30 };

  function resetRun(opts) {
    Object.assign(S, {
      opts: opts || {},
      pz: 0, pzPrev: 0, px: 0, py: 0, vy: 0, lane: 1, grounded: true, coyote: 0, jumpBuf: 0, rollT: 0, onRamp: false,
      onRoof: false, roofRec: null, superJump: false, speed: C.BASE_SPEED, dist: 0, runT: 0,
      score: 0, coins: 0, combo: 0, comboT: 0, comboDur: 2.5, lastStumble: -10, stumbleT: 0, landT: 0, invulnT: 0,
      power: { magnet: 0, sneakers: 0, double: 0, jetpack: 0 }, powerDur: { magnet: 1, sneakers: 1, double: 1, jetpack: 1 },
      jet: { phase: 'off', t: 0, y01: 0, cleared: false }, board: false, boardT: 0,
      world: 0, worldCount: 0, worldsCleared: 0, inTunnel: false, revives: 0, deathCause: '', deathT: 0,
      run: { coins: 0, dist: 0, score: 0, jumps: 0, rolls: 0, lanes: 0, nearMiss: 0, combo: 0, roofM: 0, ramps: 0, pickups: 0, magnetCoins: 0, jetpackM: 0, boardSaves: 0, worldCount: 0, moverDodges: 0, hurdles: 0 },
      missionsDone: [], levelUp: false, newBest: false, bestDistFlashed: false,
      tutorial: null, autoQueue: [], headStartOffered: false, celebrateT: 0, distMark: 0, roofAcc: 0, facing: Math.PI,
      airT: 0, jumpedSinceRoof: false, laneHold: null, coinStreak: 0, coinStreakT: 0, stringAwarded: false
    });
  }
  resetRun();

  // ------------------------------------------------------------------ helpers
  const mods = () => RR.MODULE_ORDER.filter((n) => RR[n] && n !== 'ui' && n !== 'audio').map((n) => RR[n]);
  const moduleErrors = {};
  function safe(name, fn) {
    try { return fn(); } catch (e) {
      moduleErrors[name] = (moduleErrors[name] || 0) + 1;
      if (moduleErrors[name] <= 3) console.error('[RR] ' + name + ' failed', e);
      return undefined;
    }
  }
  function callAll(method, ...args) {
    RR.MODULE_ORDER.forEach((n) => {
      if (n === 'ui' || n === 'audio' || n === 'director') return;
      const m = RR[n];
      if (m && typeof m[method] === 'function') safe(n + '.' + method, () => m[method](...args));
    });
  }
  const fx = (kind, x, y, z) => { if (RR.fx && RR.fx.burst) safe('fx.burst', () => RR.fx.burst(kind, x, y, z)); };
  const ui = (method, ...a) => { if (RR.ui && typeof RR.ui[method] === 'function') return safe('ui.' + method, () => RR.ui[method](...a)); };
  const multiplier = () => (save().missionLevel + S.worldsCleared) * (S.power.double > 0 ? 2 : 1);
  function persist() { RR.store.save(); }
  function stat(key, delta) { const st = save().stats; st[key] = (st[key] || 0) + delta; }
  function statMax(key, v) { const st = save().stats; if (!(st[key] >= v)) st[key] = v; }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // ------------------------------------------------------------------ missions
  function pickMissionSet(prevIds) {
    const b = band(), level = save().missionLevel, sd = save();
    let pool = MISSIONS.filter((d) => !prevIds.includes(d.id) && (!d.needs || (sd.stats.seenJetpack || 0) > 0 || sd.upgrades.jetpack > 0));
    if (pool.length < 3) pool = MISSIONS.slice();
    RR.shuffle(pool);
    const set = [];
    const take = (pred) => { const d = pool.find((p) => !set.includes(p) && pred(p)); if (d) set.push(d); };
    take((d) => d.scope === 'run');
    take((d) => d.scope !== 'run');
    while (set.length < 3) { const before = set.length; take(() => true); if (set.length === before) break; }
    void level;
    return set.map((d) => {
      let target = d.n[b];
      if (d.id === 'world') target = Math.max(target, (sd.stats.bestWorld || 0) + 1);
      return { id: d.id, target, have: 0, done: false };
    });
  }
  function ensureMissions() {
    const sd = save();
    if (!sd.missions || !Array.isArray(sd.missions.set) || sd.missions.set.length !== 3) sd.missions = { set: pickMissionSet([]), prevIds: [] };
    refreshMissionView();
  }
  function missionReward(m) { return 50 * (band() + 1) + (m ? 0 : 0); }
  function refreshMissionView() {
    const sd = save();
    game.missions = {
      level: sd.missionLevel,
      list: sd.missions.set.map((m) => {
        const def = MISSIONS.find((d) => d.id === m.id) || MISSIONS[0];
        return { id: m.id, text: missionText(def, m.target), have: Math.min(m.have, m.target), target: m.target, done: m.done, reward: missionReward(m), scope: def.scope };
      }),
      skipCost: 300 * (band() + 1),
      levelReward: 200 * (sd.missionLevel + 1),
      nextBoardLevel: Math.ceil((sd.missionLevel + 1) / 3) * 3
    };
  }
  function missionTrack(statName, value, mode) {
    // mode: 'add' (value is a delta for total scope and run counter already updated), 'set' (value is the new run/best value)
    const sd = save();
    let changed = false;
    sd.missions.set.forEach((m) => {
      if (m.done) return;
      const def = MISSIONS.find((d) => d.id === m.id);
      if (!def || def.stat !== statName) return;
      const before = m.have;
      if (def.scope === 'total') m.have += mode === 'add' ? value : 0;
      else m.have = Math.max(m.have, mode === 'set' ? value : S.run[statName] || 0);
      if (def.scope === 'total' && mode === 'set') m.have = Math.max(m.have, 0);
      if (m.have !== before) changed = true;
      const q = (x) => Math.floor((x / m.target) * 4);
      if (!m.done && m.have >= m.target) completeMission(m, def);
      else if (q(m.have) > q(before) && q(m.have) > 0) RR.emit('mission-progress', { mission: m });
    });
    if (changed) refreshMissionView();
  }
  function completeMission(m, def) {
    const sd = save();
    m.done = true; m.have = m.target;
    const reward = missionReward(m);
    sd.bank += reward;
    S.missionsDone.push({ text: missionText(def, m.target), reward });
    RR.emit('mission-done', { mission: { id: m.id, text: missionText(def, m.target), reward } });
    ui('toast', 'Mission complete: ' + missionText(def, m.target) + ' · +' + reward + ' coins', 'mission');
    if (sd.missions.set.every((x) => x.done)) {
      sd.missionLevel = Math.min(30, sd.missionLevel + 1);
      const lvReward = 200 * sd.missionLevel;
      sd.bank += lvReward;
      if (sd.missionLevel % 3 === 0) sd.boards += 1;
      S.levelUp = { level: sd.missionLevel, reward: lvReward, board: sd.missionLevel % 3 === 0 };
      RR.emit('level-up', { level: sd.missionLevel });
      ui('toast', 'Level ' + sd.missionLevel + '! Multiplier ×' + sd.missionLevel + ' · +' + lvReward + ' coins', 'level');
      sd.missions = { set: pickMissionSet(sd.missions.set.map((x) => x.id)), prevIds: sd.missions.set.map((x) => x.id) };
    }
    persist();
    refreshMissionView();
    RR.emit('missions-update');
  }
  function runStat(key, delta) {
    S.run[key] = (S.run[key] || 0) + delta;
    stat(key, delta);
    const def = MISSIONS.find((d) => d.stat === key);
    if (def) missionTrack(key, delta, 'add');
  }
  function runStatSet(key, value) {
    if (value <= (S.run[key] || 0)) return;
    S.run[key] = value;
    missionTrack(key, value, 'set');
  }

  // ------------------------------------------------------------------ shop
  function buildShop() {
    game.SHOP = {
      skins: (RR.player && RR.player.SKINS) || DEFAULT_SKINS,
      boards: (RR.player && RR.player.BOARDS) || DEFAULT_BOARDS,
      upgrades: UPGRADES,
      items: ITEMS
    };
    game.stats = save().stats;
  }
  function unlockMet(item) {
    const u = item.unlock; if (!u) return false;
    if (u.type === 'world') return (save().stats.bestWorld || 0) >= u.value;
    if (u.type === 'level') return save().missionLevel >= u.value;
    return false;
  }
  function spend(price) {
    const sd = save();
    if (price > sd.bank) { ui('toast', 'You need ' + (price - sd.bank).toLocaleString() + ' more coins.', 'warn'); return false; }
    sd.bank -= price; return true;
  }
  function shopChanged(msg) { persist(); game.stats = save().stats; RR.emit('shop-update'); if (msg) ui('toast', msg, 'shop'); }
  function applySkin(id) { if (RR.player && RR.player.setSkin) safe('player.setSkin', () => RR.player.setSkin(id)); }
  function applyBoard(id) { if (RR.player && RR.player.setBoard) safe('player.setBoard', () => RR.player.setBoard(id)); }
  function onSkinSelect(d) {
    const sd = save(), id = d && d.id; if (!id) return;
    previewSkin = id; applySkin(id);
    if (sd.owned.includes(id) && sd.skin !== id) { sd.skin = id; shopChanged(); }
  }
  function onSkinBuy(d) {
    const sd = save(), item = game.SHOP.skins.find((s) => s.id === (d && d.id)); if (!item) return;
    if (!sd.owned.includes(item.id)) {
      if (!unlockMet(item) && !spend(item.price)) return;
      sd.owned.push(item.id);
    }
    sd.skin = item.id; previewSkin = item.id; applySkin(item.id);
    shopChanged(item.name + ' is ready to run.');
  }
  function onBoardSelect(d) {
    const sd = save(), id = d && d.id; if (!id) return;
    previewBoard = id; applyBoard(id);
    if (sd.ownedBoards.includes(id) && sd.board !== id) { sd.board = id; shopChanged(); }
  }
  function onBoardBuy(d) {
    const sd = save(), item = game.SHOP.boards.find((s) => s.id === (d && d.id)); if (!item) return;
    if (!sd.ownedBoards.includes(item.id)) { if (!spend(item.price)) return; sd.ownedBoards.push(item.id); }
    sd.board = item.id; previewBoard = item.id; applyBoard(item.id);
    shopChanged(item.name + ' board equipped.');
  }
  function onUpgradeBuy(d) {
    const sd = save(), up = UPGRADES.find((u) => u.kind === (d && d.kind)); if (!up) return;
    const lv = sd.upgrades[up.kind] || 0; if (lv >= 5) return;
    if (!spend(up.costs[lv])) return;
    sd.upgrades[up.kind] = lv + 1;
    shopChanged(up.name + ' upgraded to level ' + (lv + 1) + ' (' + up.durations[lv + 1] + ' s).');
  }
  function onItemBuy(d) {
    const sd = save(), it = ITEMS.find((i) => i.id === (d && d.id)); if (!it) return;
    if (!spend(it.price)) return;
    if (it.id === 'board1' || it.id === 'board5') sd.boards += it.qty;
    else if (it.id === 'headstart') sd.headStarts += it.qty;
    else if (it.id === 'token') sd.tokens += it.qty;
    shopChanged(it.name + ' added.');
  }
  function restorePreview() {
    const sd = save();
    if (previewSkin && previewSkin !== sd.skin) applySkin(sd.skin);
    if (previewBoard && previewBoard !== sd.board) applyBoard(sd.board);
    previewSkin = previewBoard = null;
  }

  // ------------------------------------------------------------------ quality
  function detectTier() {
    let name = '';
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      }
    } catch (e) { /* detection is best-effort */ }
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(name)) return 'low';
    if (mobile) return /Mali-[GT]?[4-7]\d\b|Adreno \(TM\) [3-5]\d\d|PowerVR/i.test(name) ? 'low' : 'medium';
    if (/Intel/i.test(name) && !/Iris|Arc/i.test(name)) return 'medium';
    if ((navigator.hardwareConcurrency || 8) <= 2) return 'low';
    return 'high';
  }
  function setTier(name, fromGovernor) {
    const q = RR.QUALITY[name]; if (!q) return;
    const changed = tierName !== name;
    tier = q; tierName = name; RR.quality = q;
    if (!renderer) return;
    maxPixelRatio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    // A governor drop keeps the already-reduced resolution instead of jumping back up.
    pixelRatio = fromGovernor ? Math.min(pixelRatio, maxPixelRatio) : maxPixelRatio;
    renderer.setPixelRatio(pixelRatio);
    const shadowsWas = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = name === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (shadowsWas !== q.shadows) scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    ctx.quality = q;
    callAll('setQuality', q);
    resize();
    if (changed) safe('compile', () => renderer.compile(scene, camera)); // new variants now, not at first sight later
    if (changed) RR.emit('quality-change', { tier: name, auto: !!fromGovernor });
  }
  // Governor (Auto quality only): dynamic resolution first, then at most one tier drop per run, applied at a
  // safe moment (tunnel, pause, game over). The display's own frame interval is estimated from the fastest
  // recent frames, so a device capped at 30 Hz (battery saver) is not mistaken for an overloaded one.
  const gov = { sum: 0, n: 0, windowT: 0, slow: 0, fast: 0, runT: 0, dropped: false, pending: null };
  const rafDeltas = new Float32Array(120); let rafIdx = 0, rafCount = 0;
  const sortBuf = new Float32Array(120);
  function noteRafDelta(dt) { if (dt > 0 && dt < 0.25) { rafDeltas[rafIdx] = dt; rafIdx = (rafIdx + 1) % rafDeltas.length; rafCount = Math.min(rafCount + 1, rafDeltas.length); } }
  function refreshInterval() {
    if (rafCount < 20) return 1 / 60;
    for (let i = 0; i < rafCount; i++) sortBuf[i] = rafDeltas[i];
    const a = sortBuf.subarray(0, rafCount); a.sort();
    return RR.clamp(a[Math.floor(rafCount * 0.1)], 1 / 144, 1 / 30);
  }
  function resetGovernor() { gov.sum = gov.n = gov.windowT = gov.slow = gov.fast = gov.runT = 0; gov.dropped = false; }
  function governor(dt) {
    if (state !== 'run' || save().settings.quality !== 'auto') { gov.sum = gov.n = gov.windowT = 0; return; }
    gov.runT += dt; if (gov.runT < 3) return;
    gov.sum += dt; gov.n++; gov.windowT += dt;
    if (gov.windowT < 2) return;
    const avg = gov.sum / gov.n; gov.sum = gov.n = gov.windowT = 0;
    const refresh = refreshInterval();
    if (avg > Math.max(0.024, refresh * 1.35)) {
      gov.slow++; gov.fast = 0;
      if (pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
      else if (gov.slow >= 2 && tierName !== 'low' && !gov.dropped && !gov.pending) { gov.slow = 0; gov.pending = tierName === 'high' ? 'medium' : 'low'; }
    } else if (avg < refresh * 1.12) {
      gov.fast++; gov.slow = 0;
      if (gov.fast >= 5 && pixelRatio < maxPixelRatio) { gov.fast = 0; pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
    } else { gov.slow = 0; gov.fast = 0; }
  }
  function applyPendingTier() {
    if (!gov.pending) return;
    const next = gov.pending; gov.pending = null; gov.dropped = true;
    if (save().settings.quality === 'auto' && next !== tierName) setTier(next, true);
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    app = document.getElementById('app') || document.body;
    canvas = document.getElementById('c');
    if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'c'; app.appendChild(canvas); }
    const sd = save();
    buildShop();
    ensureMissions();
    game.lastRun = null;
    if (RR.ui && RR.ui.init) safe('ui.init', () => RR.ui.init());
    if (!window.THREE) { ui('fatal', 'The 3D engine could not load. Check your connection and reload the page.'); return; }
    tierName = sd.settings.quality === 'auto' ? detectTier() : sd.settings.quality;
    if (!RR.QUALITY[tierName]) tierName = 'high';
    tier = RR.QUALITY[tierName]; RR.quality = tier;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !tier.post, powerPreference: 'high-performance', alpha: false, stencil: false });
    } catch (e) {
      ui('fatal', 'Rainbow Rails needs WebGL. Turn on hardware acceleration in your browser settings and reload.');
      return;
    }
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.info.autoReset = false;
    renderer.shadowMap.enabled = tier.shadows;
    renderer.shadowMap.type = tierName === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    maxPixelRatio = Math.min(window.devicePixelRatio || 1, tier.pixelRatio); pixelRatio = maxPixelRatio;
    renderer.setPixelRatio(pixelRatio);
    RR.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    RR.getMats();
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 60, C.FOG_FAR);
    camera = new THREE.PerspectiveCamera(60, 1, C.CAMERA_NEAR, C.CAMERA_FAR);
    camera.position.set(0, 3, -7);
    frame.camera = camera;
    ctx = { renderer, scene, camera, quality: tier };
    RR.atmoSet(0);
    reduceMotion = computeReducedMotion();
    isTouch = (navigator.maxTouchPoints || 0) > 0 && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    game.ctx = ctx;

    wrapDirector();
    callAll('init', ctx);
    applySkin(sd.skin); applyBoard(sd.board);
    resize();
    bindInput();
    bindUi();
    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); persist(); } });
    window.addEventListener('blur', () => pause());
    window.addEventListener('pagehide', persist);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); contextLost = true; pause();
      ui('toast', 'Restoring graphics…', 'info');
      lostTimer = setTimeout(() => { if (contextLost) ui('fatal', 'The graphics card stopped responding. Reload the page to keep playing.'); }, 6000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      contextLost = false; clearTimeout(lostTimer);
      if (RR.fx && RR.fx.setQuality) safe('fx.restore', () => RR.fx.setQuality(tier));
      safe('compile', () => renderer.compile(scene, camera));
      ui('toast', 'Graphics restored', 'info');
    });
    // Build and warm every world one step per frame so the loading screen keeps animating.
    const spots = [-400, -1400, -2400, -3400, -4400, -1000];
    let i = 0;
    const stepBoot = () => {
      if (i < spots.length) { prewarmSpot(spots[i++]); requestAnimationFrame(stepBoot); return; }
      frame.state = 'title';
      toTitle(true);
      safe('compile', () => renderer.compile(scene, camera));
      rafId = requestAnimationFrame(loop);
    };
    safe('compile', () => renderer.compile(scene, camera));
    requestAnimationFrame(stepBoot);
  }
  let contextLost = false, lostTimer = 0;

  // Warm one world behind the loading screen: build it around the camera, then render a 1x1-pixel frame so
  // its textures upload and any remaining programs compile now instead of at first sight during a run.
  function prewarmSpot(z) {
    safe('prewarm', () => {
      resetModules(z);
      camera.position.set(0, 5.3, z + 9); camera.lookAt(0, 1, z - 8); camera.updateMatrixWorld();
      frame.pz = z; frame.px = 0; frame.py = 0; frame.world = RR.worldIndexAt(z); frame.inTunnel = RR.inTunnel(z); frame.camera = camera; frame.dt = 1 / 60; frame.state = 'run';
      RR.MODULE_ORDER.forEach((n) => { const m = RR[n]; if (m && n !== 'ui' && n !== 'audio' && n !== 'director' && n !== 'player' && typeof m.update === 'function') safe(n + '.prewarm', () => m.update(1 / 60, frame)); });
      const vp = renderer.getViewport(new THREE.Vector4());
      renderer.setViewport(0, 0, 1, 1);
      renderer.render(scene, camera);
      renderer.setViewport(vp);
    });
  }

  // The director is consumed by obstacles.js; we observe its chunks for the tutorial and the autopilot.
  function wrapDirector() {
    const d = RR.director; if (!d || d.__wrapped || typeof d.next !== 'function') return;
    const orig = d.next.bind(d);
    d.next = function () {
      const c = orig.apply(null, arguments);
      if (c) onChunk(c);
      return c;
    };
    d.__wrapped = true;
  }
  function onChunk(c) {
    if (c.path && c.path.length) {
      const p0 = c.path[0];
      if (p0 && typeof p0.lane === 'number') S.autoQueue.push({ z: p0.z + 2, lane: p0.lane, action: 'goto' }); // entry lane (matters after a reset/clearAhead)
      for (const p of c.path) if (p.action && p.action !== 'none') S.autoQueue.push(p);
    }
    if (c.tutorial && S.tutorial) S.tutorial.steps.push(Object.assign({ done: false, shown: false }, c.tutorial));
  }

  // ------------------------------------------------------------------ world reset / flow
  function resetModules(pz) {
    RR.atmoSet(RR.worldIndexAt(pz));
    callAll('reset', pz);
  }
  function toTitle(first) {
    restorePreview();
    leavePause();
    state = 'title';
    resetRun();
    S.opts = {};
    S.directorOpts = { seed: (Math.random() * 4294967296) >>> 0, tutorial: false }; // never show the last run's (tutorial) layout
    pendingWorldToast = -1;
    timeScale = 1;
    applyPendingTier();
    resetModules(0);
    snapView();
    frame.state = 'title';
    if (RR.audio) safe('audio.title', () => RR.audio.setWorld && RR.audio.setWorld(0));
    ui('show', 'title', { first: !!first });
  }
  function startRun(opts) {
    opts = opts || {};
    restorePreview();
    leavePause();
    applyPendingTier();
    resetGovernor();
    pendingWorldToast = -1;
    if (camera && camera.view && camera.view.enabled) camera.clearViewOffset();
    const sd = save();
    const tutorial = opts.tutorial !== undefined ? opts.tutorial : !sd.tutorialDone;
    resetRun(opts);
    S.tutorial = tutorial ? { steps: [], idx: 0 } : null;
    const seed = opts.seed !== undefined ? opts.seed : opts.daily ? hashStr('rr-daily-' + today()) : (Math.random() * 4294967296) >>> 0;
    S.seed = seed;
    if (RR.director && RR.director.reset) S.directorOpts = { seed, tutorial };
    state = 'run';
    timeScale = 1; acc = 0;
    applyDirectorOpts();
    resetModules(0);
    snapView();
    camIntro = 0;
    sd.runs = (sd.runs || 0) + 1; stat('runs', 1);
    if (opts.daily) { if (sd.daily.day !== today()) sd.daily = { day: today(), best: 0 }; }
    persist();
    ui('show', 'run');
    RR.emit('run-start', { daily: !!opts.daily, tutorial });
    if (RR.audio && RR.audio.setWorld) safe('audio.world', () => RR.audio.setWorld(0));
    if (sd.headStarts > 0 && !tutorial) { S.headStartOffered = true; ui('hint', 'headstart', 4000); }
    else if (sd.boards > 0 && !(sd.hintsSeen || {}).board && !tutorial) { sd.hintsSeen.board = 1; ui('hint', isTouch ? 'Double-tap to ride a hoverboard' : 'Press B to ride a hoverboard', 3500); }
  }
  // obstacles.reset(pz) resets the director itself; make sure it uses this run's seed and tutorial flag.
  function applyDirectorOpts() {
    const d = RR.director; if (!d || !d.reset || d.__optsWrapped) return;
    const orig = d.reset.bind(d);
    d.reset = function (z0, o) { return orig(z0, Object.assign({}, S.directorOpts || {}, o || {})); };
    d.__optsWrapped = true;
  }
  let audioPaused = false;
  function leavePause() {
    if (!audioPaused) return;
    audioPaused = false;
    if (RR.audio && RR.audio.resumeAll) safe('audio.resume', () => RR.audio.resumeAll());
  }
  function pause() {
    if (state !== 'run' && state !== 'countdown') return;
    state = 'paused';
    persist();
    applyPendingTier();
    ui('show', 'pause', { dist: S.dist, world: S.world, score: Math.floor(S.score), coins: S.coins, mult: multiplier() });
    audioPaused = true;
    if (RR.audio && RR.audio.pauseAll) safe('audio.pause', () => RR.audio.pauseAll());
    RR.emit('pause');
  }
  function resume() {
    if (state !== 'paused' || contextLost) return;
    beginCountdown();
    leavePause();
    RR.emit('resume');
  }
  function beginCountdown() {
    state = 'countdown'; countdownT = 0; countdownN = 3;
    ui('show', 'countdown', { n: 3 });
    RR.emit('countdown', { n: 3 });
  }
  // Persist a finished (or quit) run: bests, daily best, history, stats.
  function recordRun() {
    const sd = save();
    const score = Math.floor(S.score), dist = Math.floor(S.dist);
    const newBest = score > sd.best;
    if (newBest) sd.best = score;
    if (dist > sd.bestDist) sd.bestDist = dist;
    if (S.opts.daily && score > (sd.daily.best || 0)) sd.daily = { day: today(), best: score };
    statMax('bestDist', dist); statMax('bestCoins', S.run.coins); statMax('bestScore', score);
    stat('deaths_' + (S.deathCause || 'unknown'), 1);
    sd.history = [{ score, dist, coins: S.run.coins, world: S.world, cause: S.deathCause, date: today(), daily: !!S.opts.daily }].concat(sd.history || []).slice(0, 10);
    runStatSet('score', score);
    runStatSet('dist', dist);
    persist();
    return { score, dist, newBest };
  }
  function endRunToOver() {
    const sd = save();
    state = 'over';
    applyPendingTier();
    const { score, dist, newBest } = recordRun();
    if (newBest) S.celebrateT = 2;
    game.lastRun = {
      score, dist, coins: S.run.coins, cause: CAUSES[S.deathCause] || 'Wiped out.', causeId: S.deathCause, world: S.world,
      worldName: RR.WORLDS[S.world].name, newBest, missionsDone: S.missionsDone.slice(), levelUp: S.levelUp, bank: sd.bank, best: sd.best,
      daily: !!S.opts.daily, bestCombo: S.run.combo, mult: multiplier()
    };
    game.stats = sd.stats;
    ui('show', 'over', game.lastRun);
    RR.emit('run-end', { score, dist, coins: S.run.coins, cause: S.deathCause });
    if (newBest) RR.emit('new-best');
  }

  // ------------------------------------------------------------------ input
  const input = [];
  function queue(kind) { if (state === 'run') input.push(kind); }
  let keyHintShown = false;
  function bindInput() {
    window.addEventListener('keydown', (e) => {
      const k = e.key;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      firstGesture();
      if (typing) return;
      if (state === 'run') {
        if (e.repeat && k !== 'p' && k !== 'P') { if (/^Arrow|^[wasdWASD ]$/.test(k)) e.preventDefault(); return; }
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); queue('left'); }
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); queue('right'); }
        else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { e.preventDefault(); queue('jump'); }
        else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); queue('roll'); }
        else if (k === 'b' || k === 'B' || k === 'Shift') { queue('board'); }
        else if (k === 'h' || k === 'H') { queue('headstart'); }
        else if (k === 'p' || k === 'P' || k === 'Escape') { e.preventDefault(); if (!e.repeat) pause(); }
        void keyHintShown;
        return;
      }
      if (e.repeat) return;
      if (state === 'countdown' && (k === 'p' || k === 'P' || k === 'Escape')) { e.preventDefault(); pause(); return; }
      if (state === 'paused' && (k === 'p' || k === 'P' || k === 'Escape')) { e.preventDefault(); resume(); return; }
      if (state === 'revive') {
        if (k === 'Enter') { e.preventDefault(); acceptRevive(); } else if (k === 'Escape') { e.preventDefault(); declineRevive(); }
        return;
      }
      if ((state === 'title' || state === 'over') && (k === ' ' || k === 'Enter') && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); startRun(); }
    });

    // Swipes: fire as soon as the drag passes the threshold. One action per direction per gesture: continuing
    // the same drag never repeats it, but a real zig-zag (a new direction) fires the new action.
    let tp = null, lastTap = 0, lastTapX = 0, lastTapY = 0;
    const target = app;
    const thresh = () => Math.max(18, 0.04 * Math.min(window.innerWidth, window.innerHeight)) * (save().settings.swipe === 'high' ? 0.6 : 1);
    target.addEventListener('pointerdown', (e) => {
      firstGesture();
      if (state !== 'run' || (e.target.closest && e.target.closest('button, a, input, select, .panel, .hud-btn'))) return;
      if (tp && tp.id !== e.pointerId) return;
      tp = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, t: performance.now(), last: null };
    }, { passive: true });
    target.addEventListener('pointermove', (e) => {
      if (!tp || e.pointerId !== tp.id || state !== 'run') return;
      const dx = e.clientX - tp.x, dy = e.clientY - tp.y, ax = Math.abs(dx), ay = Math.abs(dy), th = thresh();
      if (Math.max(ax, ay) < th) return;
      let act = null;
      if (ax >= ay * 1.2) act = dx > 0 ? 'right' : 'left';
      else if (ay >= ax * 1.2) act = dy < 0 ? 'jump' : 'roll';
      else return;
      if (act !== tp.last) { queue(act); tp.last = act; }
      tp.moved = true; tp.x = e.clientX; tp.y = e.clientY;
    }, { passive: true });
    const end = (e) => {
      if (!tp || e.pointerId !== tp.id) return;
      const now = performance.now();
      if (!tp.moved && Math.hypot(e.clientX - tp.x0, e.clientY - tp.y0) < 14 && now - tp.t < 300) {
        if (now - lastTap < 280 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40) { queue(S.headStartOffered && S.runT < 6 && save().headStarts > 0 ? 'headstart' : 'board'); lastTap = 0; }
        else { lastTap = now; lastTapX = e.clientX; lastTapY = e.clientY; }
      }
      tp = null;
    };
    target.addEventListener('pointerup', end, { passive: true });
    target.addEventListener('pointercancel', () => { tp = null; }, { passive: true });
  }
  let gestured = false;
  function firstGesture() {
    if (gestured) return; gestured = true;
    if (RR.audio && RR.audio.init) safe('audio.init', () => {
      RR.audio.init();
      RR.audio.setSound && RR.audio.setSound(!!save().settings.sound);
      RR.audio.setMusic && RR.audio.setMusic(!!save().settings.sound && !!save().settings.music); // Sound is the master switch
      RR.audio.setWorld && RR.audio.setWorld(state === 'run' ? S.world : 0);
    });
  }
  function bindUi() {
    RR.on('ui:start', () => { firstGesture(); startRun(); });
    RR.on('ui:daily', () => { firstGesture(); startRun({ daily: true, tutorial: false }); });
    RR.on('ui:restart', () => { firstGesture(); startRun({ tutorial: false }); });
    RR.on('ui:pause', pause);
    RR.on('ui:resume', resume);
    RR.on('ui:quit', () => {
      if (state !== 'paused' && state !== 'over' && state !== 'revive') return;
      if (state === 'paused' && S.dist > 1) { S.deathCause = 'quit'; recordRun(); } // a quit run still counts for bests and history
      if (state === 'revive') endRunToOver();
      toTitle();
    });
    RR.on('ui:revive', acceptRevive);
    RR.on('ui:decline-revive', declineRevive);
    RR.on('ui:board', () => { if (state === 'run') queue(S.headStartOffered && S.runT < 6 && save().headStarts > 0 ? 'headstart' : 'board'); });
    RR.on('ui:input', (d) => { if (d && d.action) queue(d.action); });
    RR.on('ui:skin-select', onSkinSelect);
    RR.on('ui:skin-buy', onSkinBuy);
    RR.on('ui:board-select', onBoardSelect);
    RR.on('ui:board-buy', onBoardBuy);
    RR.on('ui:upgrade-buy', onUpgradeBuy);
    RR.on('ui:item-buy', onItemBuy);
    RR.on('ui:skip-mission', (d) => {
      const sd = save(), i = d && d.i, m = sd.missions.set[i]; if (!m || m.done) return;
      const cost = 300 * (band() + 1); if (!spend(cost)) return;
      const next = pickMissionSet(sd.missions.set.map((x) => x.id)).find((x) => !sd.missions.set.some((y) => y.id === x.id));
      if (next) sd.missions.set[i] = next;
      persist(); refreshMissionView(); RR.emit('missions-update'); RR.emit('shop-update');
    });
    RR.on('ui:setting', (d) => {
      if (!d || !d.key) return;
      const s = save().settings; s[d.key] = d.value; persist();
      if (d.key === 'quality') setTier(d.value === 'auto' ? detectTier() : d.value);
      if (d.key === 'sound' || d.key === 'music') {
        firstGesture();
        if (RR.audio) safe('audio.setting', () => { RR.audio.setSound && RR.audio.setSound(!!s.sound); RR.audio.setMusic && RR.audio.setMusic(!!s.sound && !!s.music); });
      }
      if (d.key === 'reducedMotion') reduceMotion = computeReducedMotion();
      RR.emit('shop-update');
    });
    RR.on('ui:reset-progress', () => {
      RR.store.reset();
      ensureMissions(); buildShop();
      applySkin(save().skin); applyBoard(save().board);
      setTier(detectTier());
      RR.emit('shop-update'); RR.emit('missions-update');
      toTitle();
    });
    RR.on('ui:replay-tutorial', () => { save().tutorialDone = false; persist(); firstGesture(); startRun({ tutorial: true }); });
    RR.on('mission-done', () => { S.celebrateT = 1.4; });
    RR.on('level-up', () => { S.celebrateT = 2; });
    RR.on('ui:screen', (d) => { if (d && d.name !== 'shop') restorePreview(); });
  }
  function computeReducedMotion() {
    const pref = save().settings.reducedMotion;
    if (pref === 'on' || pref === true) return true;
    if (pref === 'off' || pref === false) return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ------------------------------------------------------------------ actions (applied inside the fixed step)
  function doJump() {
    const sneakers = S.power.sneakers > 0;
    S.vy = sneakers ? C.SUPER_JUMP_V : C.JUMP_V;
    S.superJump = sneakers;
    S.grounded = false; S.coyote = 0; S.jumpBuf = 0; S.rollT = 0; S.onRamp = false;
    S.jumpedSinceRoof = true;
    runStat('jumps', 1);
    markLate('hurdle');
    RR.emit('jump', { super: sneakers });
    tutorialAction('jump');
  }
  // A jump or roll made at the last moment before an in-lane hurdle/bar is a 'late' stunt once it is cleared.
  function markLate(type) {
    const O = RR.obstacles; if (!O || !O.list) return;
    for (const r of O.list) {
      if (r.type !== type || r.passed || Math.abs(r.x - S.px) > C.HALF_W) continue;
      const ttc = (S.pz - r.zF) / Math.max(1, S.speed);
      if (ttc > 0 && ttc < 0.25) r.lateCand = true;
    }
  }
  function applyInput(kind) {
    switch (kind) {
      case 'left': case 'right': {
        const dir = kind === 'left' ? -1 : 1, nl = clamp(S.lane + dir, 0, 2);
        if (nl === S.lane) return;
        const jet = S.jet.phase !== 'off';
        if (!jet && RR.obstacles && RR.obstacles.laneBlocked && RR.obstacles.laneBlocked(nl, S.py, S.pz)) {
          if (!S.laneHold) S.laneHold = { kind, t: 0.12 }; // retry for a moment before scraping
          return;
        }
        S.laneHold = null;
        if (RR.obstacles && RR.obstacles.markNear) safe('obstacles.markNear', () => RR.obstacles.markNear(S.lane, S.pz, S.speed));
        S.lane = nl;
        runStat('lanes', 1);
        RR.emit('lane', { dir });
        tutorialAction(kind);
        break;
      }
      case 'jump':
        if (S.jet.phase !== 'off') return;
        if (S.grounded || S.coyote > 0) doJump(); else S.jumpBuf = C.JUMP_BUFFER;
        break;
      case 'roll':
        if (S.jet.phase !== 'off') return;
        if (!S.grounded) S.vy = Math.min(S.vy, -32);
        S.rollT = C.ROLL_T; S.jumpBuf = 0;
        markLate('bar');
        runStat('rolls', 1);
        RR.emit('roll');
        tutorialAction('roll');
        break;
      case 'board': {
        const sd = save();
        if (S.jet.phase !== 'off' && S.jet.headStart) return; // the rocket button was just used for a Head Start
        if (S.board || sd.boards <= 0) { if (sd.boards <= 0 && !S.board) ui('toast', 'No hoverboards left. Get more in the shop.', 'warn'); return; }
        sd.boards--; S.board = true; S.boardT = 30;
        stat('boardsUsed', 1); persist();
        RR.emit('board-on');
        fx('sparkle', S.px, S.py + 0.3, S.pz);
        break;
      }
      case 'headstart': {
        const sd = save();
        if (!(sd.headStarts > 0) || S.runT > 6 || S.jet.phase !== 'off' || S.tutorial) return;
        sd.headStarts--; persist();
        S.headStartOffered = false;
        ui('clearHint');
        startJetpack(Math.max(8, 500 / Math.max(S.speed, C.BASE_SPEED)), true);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ power-ups
  function durationFor(kind) {
    const up = UPGRADES.find((u) => u.kind === kind);
    return up ? up.durations[clamp(save().upgrades[kind] || 0, 0, 5)] : 10;
  }
  function givePower(kind) {
    if (kind === 'board') {
      save().boards += 1; persist();
      ui('toast', '+1 hoverboard', 'pickup');
      RR.emit('pickup', { kind });
      return;
    }
    stat('seenJetpack', kind === 'jetpack' ? 1 : 0);
    if (kind === 'jetpack') { startJetpack(durationFor('jetpack'), false); RR.emit('pickup', { kind }); return; }
    const dur = durationFor(kind);
    S.power[kind] = dur; S.powerDur[kind] = dur;
    RR.emit('pickup', { kind });
    if (kind === 'magnet') tutorialAction('magnet');
  }
  function startJetpack(dur, headStart) {
    S.power.jetpack = dur; S.powerDur.jetpack = dur;
    S.jet.phase = 'up'; S.jet.t = 0; S.jet.cleared = false; S.jet.headStart = headStart; S.jet.y0 = S.py; S.jet.y01 = 0;
    S.rollT = 0; S.grounded = false; S.vy = 0;
    // Sky coins along the flight, stopping short of the next tunnel.
    let z1 = S.pz - S.speed * dur * 0.95;
    const k = Math.floor(-S.pz / C.WORLD_LEN) + 1;
    const tunnelStart = -k * C.WORLD_LEN + C.TUNNEL_HALF + S.speed * 2;
    if (z1 < tunnelStart && S.pz > tunnelStart) z1 = tunnelStart;
    if (RR.obstacles && RR.obstacles.spawnSkyCoins && S.pz - 25 > z1) safe('obstacles.spawnSkyCoins', () => RR.obstacles.spawnSkyCoins(S.pz - 25, z1));
    RR.emit('jetpack-start', { headStart: !!headStart });
    fx('pickup', S.px, S.py + 1, S.pz);
  }
  function updateJetpack(h) {
    const J = S.jet;
    if (J.phase === 'off') return;
    J.t += h;
    if (J.phase === 'up') {
      J.y01 = Math.min(1, J.y01 + h / 0.5);
      if (J.y01 >= 1) J.phase = 'fly';
    }
    if (J.phase === 'fly' || J.phase === 'up') {
      S.power.jetpack -= h;
      J.flightM = (J.flightM || 0) + S.speed * h; stat('jetpackM', S.speed * h);
      // End early before a tunnel so the flight never meets a tunnel roof.
      const tunnelAhead = RR.inTunnel(S.pz - S.speed * 1.8, 0);
      if (!J.cleared && (S.power.jetpack <= 1.2 || tunnelAhead)) {
        J.cleared = true;
        if (RR.obstacles && RR.obstacles.clearAhead) safe('obstacles.clearAhead', () => RR.obstacles.clearAhead(S.pz, 1.6 * S.speed + 60));
        S.autoQueue.length = 0;
        if (tunnelAhead) S.power.jetpack = Math.min(S.power.jetpack, 1.2);
      }
      if (S.power.jetpack <= 0.6) J.phase = 'down';
    }
    if (J.phase === 'down') {
      J.y01 = Math.max(0, J.y01 - h / 0.6);
      S.power.jetpack = Math.max(0, S.power.jetpack - h);
      if (J.y01 <= 0) {
        J.phase = 'off'; S.power.jetpack = 0; S.py = 0; S.vy = 0; S.grounded = true; S.invulnT = Math.max(S.invulnT, 1);
        S.run.jetpackM += J.flightM || 0; missionTrack('jetpackM', Math.round(J.flightM || 0), 'add'); J.flightM = 0;
        RR.emit('jetpack-end'); RR.emit('power-end', { kind: 'jetpack' });
      }
    }
    const e = J.y01 * J.y01 * (3 - 2 * J.y01);
    S.py = J.phase === 'up' ? J.y0 + (C.JETPACK_Y - J.y0) * e : C.JETPACK_Y * e;
  }

  // ------------------------------------------------------------------ combo / stunts
  const STUNT_POINTS = { near: 50, whoosh: 40, roofhop: 40, ramp: 20, late: 25, string: 20 };
  function stunt(kind) {
    const pts0 = STUNT_POINTS[kind] || 20;
    S.combo++; S.comboDur = S.combo >= 10 ? 2.6 : 3.5; S.comboT = S.comboDur;
    const pts = pts0 * S.combo * multiplier();
    S.score += pts;
    stat('stunts', 1);
    if (S.combo > S.run.combo) { runStatSet('combo', S.combo); statMax('bestCombo', S.combo); }
    RR.emit('stunt', { kind, points: pts });
    if (S.combo >= 2) RR.emit('combo', { n: S.combo });
    const bonus = S.combo === 10 ? 25 : S.combo === 20 ? 75 : S.combo === 30 ? 150 : 0;
    if (bonus) { save().bank += bonus; ui('toast', '×' + S.combo + ' combo! +' + bonus + ' coins', 'combo'); }
  }
  function endCombo() {
    if (S.combo >= 2) RR.emit('combo-end', { n: S.combo });
    S.combo = 0; S.comboT = 0;
  }

  // ------------------------------------------------------------------ crash / stumble / revive
  function stumble() {
    if (S.runT - S.lastStumble < 0.35) return; // one contact is one scrape
    S.stumbleT = 0.45;
    shake(0.35);
    endCombo();
    RR.emit('stumble');
    if (!(save().hintsSeen || {}).stumble) { save().hintsSeen.stumble = 1; ui('hint', 'Careful: two scrapes in a row and you are out', 2500); }
    if (S.runT - S.lastStumble < 2.5) { crash('stumble', null); return; }
    S.lastStumble = S.runT;
  }
  function crash(cause, rec) {
    if (S.invulnT > 0 || S.jet.phase !== 'off') return;
    if (S.tutorial && !save().tutorialDone && S.tutorial.steps.some((s) => !s.done)) { tutorialRewind(); return; }
    if (god) { wouldDie++; S.invulnT = 0.4; return; }
    if (S.board) {
      S.board = false; S.boardT = 0; S.invulnT = 1.5;
      endCombo();
      runStat('boardSaves', 1);
      if (rec) rec.ghost = true;
      if (RR.obstacles && RR.obstacles.clearAhead) safe('obstacles.clearAhead', () => RR.obstacles.clearAhead(S.pz + 6, 30));
      S.autoQueue.length = 0;
      shake(0.5);
      fx('board-break', S.px, S.py + 0.4, S.pz);
      RR.emit('board-break');
      return;
    }
    void rec;
    state = 'dying'; dyingT = 0; S.deathT = 0; S.deathCause = cause;
    endCombo();
    shake(0.8);
    fx('crash', S.px, S.py + 1.1, S.pz - 0.5);
    if (RR.fx && RR.fx.flash) safe('fx.flash', () => RR.fx.flash('#ffffff', 120));
    if (RR.fx && RR.fx.setGrade) safe('fx.grade', () => RR.fx.setGrade({ saturation: 0.35, vignette: 0.55 }));
    RR.emit('crash', { cause });
  }
  function reviveCost() { return 300 * Math.pow(2, S.revives); }
  function afterDying() {
    const sd = save();
    const canPay = sd.tokens > 0 || sd.bank >= reviveCost();
    if (S.revives < 2 && canPay && !S.opts.noRevive) {
      state = 'revive'; reviveT = 5;
      ui('show', 'revive', { cost: reviveCost(), tokens: sd.tokens, bank: sd.bank, seconds: 5 });
    } else endRunToOver();
  }
  function acceptRevive() {
    if (state !== 'revive') return;
    const sd = save();
    if (sd.tokens > 0) sd.tokens--; else if (sd.bank >= reviveCost()) sd.bank -= reviveCost(); else return;
    S.revives++; stat('revives', 1); persist();
    if (RR.obstacles && RR.obstacles.clearAhead) safe('obstacles.clearAhead', () => RR.obstacles.clearAhead(S.pz + 5, 60 + 1.5 * S.speed));
    S.autoQueue.length = 0;
    S.py = 0; S.vy = 0; S.grounded = true; S.rollT = 0; S.onRamp = false; S.invulnT = 2.0; S.lastStumble = -10; S.deathT = 0;
    S.px = LANES[S.lane];
    snapView();
    if (RR.fx && RR.fx.setGrade) safe('fx.grade', () => RR.fx.setGrade({ saturation: 1, vignette: 0.3 }));
    RR.emit('revive');
    beginCountdown();
  }
  function declineRevive() { if (state === 'revive') endRunToOver(); }

  // ------------------------------------------------------------------ tutorial
  function tutorialAction(action) {
    const tut = S.tutorial; if (!tut) return;
    const step = tut.steps.find((s) => !s.done && s.shown);
    if (!step) return;
    if ((S.pz - step.zAct) / Math.max(1, S.speed) > 1.3) return; // too early: the obstacle is still far away
    const want = step.action;
    const ok = want === action || (want === 'ramp' && (action === 'left' || action === 'right' || action === 'jump')) || (want === 'coins' && (action === 'left' || action === 'right'));
    if (ok) { step.done = true; timeScale = 1; ui('clearHint'); RR.emit('tutorial-step', { i: step.step }); }
  }
  function updateTutorial(dt) {
    const tut = S.tutorial; if (!tut) return;
    const pending = tut.steps.filter((s) => !s.done);
    if (!pending.length) {
      if (tut.steps.length && !save().tutorialDone && S.dist > 60) {
        const last = tut.steps[tut.steps.length - 1];
        if (last && S.pz < last.zAct - 30) {
          save().tutorialDone = true; persist();
          ui('toast', "You're ready! Now keep running.", 'tutorial');
          tut.idx = 99;
          S.tutorial = null;
        }
      }
      timeScale = RR.damp(timeScale, 1, 6, dt);
      return;
    }
    const step = pending[0];
    const secs = (S.pz - step.zAct) / Math.max(1, S.speed);
    if (!step.shown && secs < 2.2) {
      step.shown = true;
      const h = step.hint;
      ui('hint', h || step.action, 6000, { urgent: false }); // the UI picks keyboard or touch wording from the device in use
    }
    if (step.action === 'coins' || step.action === 'magnet') {
      if (secs < -0.5) { step.done = true; ui('clearHint'); }
      timeScale = RR.damp(timeScale, 1, 6, dt);
      return;
    }
    const target = step.shown && secs < 1.1 && S.jet.phase === 'off' ? 0.22 : 1;
    if (target < 1 && !step.urgent) { step.urgent = true; ui('hint', step.hint || step.action, 6000, { urgent: true }); }
    timeScale = RR.damp(timeScale, target, 8, dt);
    if (secs < -1.5) { step.done = true; ui('clearHint'); }
  }
  function tutorialRewind() {
    S.pz += 30; S.pzPrev = S.pz; S.dist = -S.pz;
    S.py = 0; S.vy = 0; S.grounded = true; S.rollT = 0; S.invulnT = 0.6; S.onRamp = false;
    // Re-arm every step whose obstacle is ahead again after the rewind, so its hint and slow motion return.
    for (const st of S.tutorial.steps) if (st.zAct < S.pz) { st.done = false; st.shown = false; st.urgent = false; }
    timeScale = 1;
    snapView();
    shake(0.3);
    ui('toast', 'Try again', 'tutorial');
    RR.emit('stumble');
  }

  // ------------------------------------------------------------------ autopilot (tests)
  function autopilotStep() {
    const q = S.autoQueue;
    while (q.length && q[0].z > S.pz + 30) q.shift(); // stale entries (e.g. after a warp)
    while (q.length && q[0].z >= S.pz - 0.4) {
      const p = q.shift();
      if (p.action === 'goto') {
        if (p.lane !== S.lane) { applyInput(p.lane < S.lane ? 'left' : 'right'); if (p.lane !== S.lane && Math.abs(p.lane - S.lane) > 0) q.unshift({ z: S.pz - S.speed * 0.3, lane: p.lane, action: 'goto' }); }
        break;
      }
      if (p.action === 'left' || p.action === 'right') {
        if (typeof p.lane === 'number' && p.lane !== S.lane) applyInput(p.lane < S.lane ? 'left' : 'right');
        else if (typeof p.lane !== 'number') applyInput(p.action);
      } else if (p.action === 'jump') applyInput('jump');
      else if (p.action === 'roll') applyInput('roll');
    }
    if (!q.length) reactivePilot();
  }
  function reactivePilot() {
    const O = RR.obstacles; if (!O || !O.list) return;
    const look = S.speed * 0.55;
    let threat = null;
    for (const o of O.list) {
      if (o.lane !== S.lane || o.zF < S.pz - look || o.zB > S.pz) continue;
      if (o.type === 'ramp') continue;
      if (o.type === 'train' && S.py >= C.TRAIN_H - 0.1) continue;
      if (!threat || o.zF > threat.zF) threat = o;
    }
    if (!threat) return;
    const ttc = (S.pz - threat.zF) / (S.speed + (threat.vz || 0));
    if (threat.type === 'hurdle' && ttc < 0.28) applyInput('jump');
    else if (threat.type === 'bar' && ttc < 0.3) applyInput('roll');
    else if (threat.type === 'train' || threat.type === 'block') {
      for (const d of [-1, 1]) {
        const nl = S.lane + d; if (nl < 0 || nl > 2) continue;
        const busy = O.list.some((o) => o.lane === nl && o.type !== 'ramp' && o.zF > S.pz - look * 1.2 && o.zB < S.pz + 2);
        if (!busy) { applyInput(d < 0 ? 'left' : 'right'); break; }
      }
    }
  }

  // ------------------------------------------------------------------ simulation step (fixed 1/120 s)
  function simStep(h) {
    S.runT += h;
    S.pzPrev = S.pz;
    S.speed = RR.speedAt(S.dist);
    S.pz -= S.speed * h;
    S.dist = -S.pz;

    // inputs
    if (autopilot) autopilotStep();
    while (input.length) applyInput(input.shift());
    if (S.laneHold) { // a lane change refused by a train side: retry briefly, then scrape
      const hold = S.laneHold;
      hold.t -= h;
      const nl = clamp(S.lane + (hold.kind === 'left' ? -1 : 1), 0, 2);
      if (nl === S.lane) S.laneHold = null;
      else if (!(RR.obstacles && RR.obstacles.laneBlocked && RR.obstacles.laneBlocked(nl, S.py, S.pz))) { S.laneHold = null; applyInput(hold.kind); }
      else if (hold.t <= 0) { S.laneHold = null; stumble(); if (state !== 'run') return; }
    }

    // lateral
    const tx = LANES[S.lane];
    S.px += (tx - S.px) * (1 - Math.exp(-15 * h));

    // timers
    if (S.rollT > 0) S.rollT = Math.max(0, S.rollT - h);
    if (S.jumpBuf > 0) S.jumpBuf -= h;
    if (S.coyote > 0) S.coyote -= h;
    if (S.invulnT > 0) S.invulnT -= h;
    if (S.stumbleT > 0) S.stumbleT -= h;
    if (S.landT > 0) S.landT -= h;
    if (S.comboT > 0) { S.comboT -= h; if (S.comboT <= 0) endCombo(); }
    for (const k of ['magnet', 'sneakers', 'double']) {
      if (S.power[k] > 0) { S.power[k] -= h; if (S.power[k] <= 0) { S.power[k] = 0; RR.emit('power-end', { kind: k }); } }
    }
    if (S.board) { S.boardT -= h; if (S.boardT <= 0) { S.board = false; RR.emit('power-end', { kind: 'board' }); } }

    const O = RR.obstacles;
    const jet = S.jet.phase !== 'off';
    if (jet) {
      updateJetpack(h);
      S.grounded = false; S.onRamp = false; S.onRoof = false;
    } else {
      // vertical physics with surfaces from the obstacle probe
      const pr = O && O.probe ? O.probe(S.px, S.pzPrev, S.pz) : null;
      let ground = 0, onRampNow = false, roofNow = false;
      if (pr) {
        if (pr.rampH >= 0 && (S.py >= pr.rampH - 1.0 || S.onRamp)) { ground = Math.max(ground, pr.rampH); onRampNow = true; }
        if (pr.train) {
          const handoff = S.onRamp && pr.rampH < 0; // ramp top → roof, whatever the step size
          // the roof supports a runner who is not still rising up past its edge
          if (handoff || (S.py >= C.TRAIN_KILL_Y - 1e-3 && (S.vy <= 0 || S.py >= C.TRAIN_H))) {
            ground = Math.max(ground, C.TRAIN_H); roofNow = true;
            if (handoff) { S.py = Math.max(S.py, C.TRAIN_H); runStat('ramps', 1); stunt('ramp'); if (S.tutorial) tutorialAction('ramp'); }
          }
        }
      }
      const vy0 = S.vy;
      S.py += S.vy * h - 0.5 * C.G * h * h;
      S.vy -= C.G * h;
      if (S.py <= ground) {
        if (!S.grounded) {
          const hard = vy0 < -20;
          if (S.airT > 0.05 || vy0 < -2) { // tiny steps (e.g. between roofs) are not landings
            S.landT = 0.25;
            RR.emit('land', { hard });
            if (hard || vy0 < -12) fx('land', S.px, ground, S.pz);
          }
          // roof hop: a real jump or fall from one train onto a different one
          if (roofNow && pr && pr.train && S.roofRec && pr.train !== S.roofRec && (S.airT >= 0.15 || S.jumpedSinceRoof)) stunt('roofhop');
        }
        S.py = ground; S.vy = 0; S.grounded = true; S.superJump = false; S.airT = 0;
        if (S.jumpBuf > 0) doJump();
      } else if (S.grounded && S.py > ground + 0.05) {
        S.grounded = false; S.coyote = C.COYOTE;
      }
      if (!S.grounded) S.airT += h;
      S.onRamp = onRampNow && S.grounded;
      S.onRoof = roofNow && S.grounded;
      if (S.onRoof && pr) { if (S.roofRec !== pr.train) S.jumpedSinceRoof = false; S.roofRec = pr.train; }
      if (S.onRoof) { S.roofAcc += S.pzPrev - S.pz; if (S.roofAcc >= S.run.roofM + 10) runStatSet('roofM', Math.floor(S.roofAcc)); }

      // collisions (swept)
      if (pr && pr.hits && S.invulnT <= 0) {
        for (let i = 0; i < pr.hits.length; i++) {
          const r = pr.hits[i];
          if (r.ghost) continue;
          if (r.type === 'train') { if (S.py < C.TRAIN_KILL_Y - 1e-3 && !S.onRamp) { crash(r.vz > 0 ? 'oncoming' : 'train', r); break; } }
          else if (r.type === 'hurdle') { if (S.py < C.HURDLE_CLEAR) { crash('hurdle', r); break; } }
          else if (r.type === 'bar') { const head = S.py + (S.rollT > 0 ? C.BODY_ROLL_H : C.BODY_H); if (head > C.BAR_BOTTOM && S.py < C.BAR_TOP) { crash('bar', r); break; } }
          else if (r.type === 'block') { if (S.py < C.BLOCK_TOP) { crash('block', r); break; } }
        }
        if (state !== 'run') return;
      }
    }

    // pickups
    if (O && O.collect) {
      const res = O.collect(S.px, S.py, S.pz, S.power.magnet > 0, h);
      if (res) {
        if (S.coinStreakT > 0) { S.coinStreakT -= h; if (S.coinStreakT <= 0) { S.coinStreak = 0; S.stringAwarded = false; } }
        if (res.coins > 0) {
          S.coinStreak += res.coins; S.coinStreakT = 0.45;
          if (S.coinStreak >= 10 && !S.stringAwarded) { S.stringAwarded = true; stunt('string'); }
          const m = multiplier();
          S.coins += res.coins; S.score += 10 * m * res.coins;
          save().bank += res.coins; save().totalCoins = (save().totalCoins || 0) + res.coins;
          runStat('coins', res.coins);
          if (S.power.magnet > 0) runStat('magnetCoins', res.coins);
          RR.emit('coin', { n: res.coins });
        }
        if (res.pickups && res.pickups.length) {
          for (const kind of res.pickups) { givePower(kind); runStat('pickups', 1); }
        }
      }
    }
    // passed obstacles: near misses, dodges, cleared barriers
    if (O && O.passed) {
      const list = O.passed(S.pz);
      if (list && list.length) {
        for (const r of list) {
          if (r.type === 'hurdle' || r.type === 'bar' || r.type === 'block') { if (r.lane === S.lane) runStat('hurdles', 1); }
          if (r.vz > 0 && r.type === 'train') {
            runStat('moverDodges', 1);
            const dx = Math.abs(S.px - r.x);
            if (dx > 1.6 && dx < 3.4) { stunt('whoosh'); RR.emit('near-miss'); runStat('nearMiss', 1); continue; }
          }
          if (r.lateCand && r.lane === S.lane) { r.lateCand = false; stunt('late'); continue; }
          if (r.nearCand) { stunt('near'); RR.emit('near-miss'); runStat('nearMiss', 1); }
        }
      }
    }

    // score, worlds, tunnels
    S.score += 0.5 * (S.pzPrev - S.pz) * multiplier();
    const wc = Math.floor(S.dist / C.WORLD_LEN);
    const inT = RR.inTunnel(S.pz);
    if (inT !== S.inTunnel) { S.inTunnel = inT; RR.emit(inT ? 'tunnel-enter' : 'tunnel-exit'); if (inT) applyPendingTier(); }
    if (wc > S.worldCount) {
      S.worldCount = wc; S.worldsCleared = wc; S.world = RR.worldIndexAt(S.pz);
      runStatSet('worldCount', wc); statMax('bestWorld', wc);
      stat('worlds', 1);
      RR.emit('world', { index: S.world, count: wc });
      if (RR.audio && RR.audio.setWorld) safe('audio.world', () => RR.audio.setWorld(S.world));
      pendingWorldToast = S.world;
    }
    if (pendingWorldToast >= 0 && !inT) {
      ui('toastWorld', pendingWorldToast); fx('portal', S.px, 2, S.pz - 12); pendingWorldToast = -1;
      if (!S.bestDistFlashed && save().bestDist > 0 && S.dist > save().bestDist) { /* handled below */ }
    }
    if (!S.bestDistFlashed && save().bestDist > 200 && S.dist > save().bestDist) { S.bestDistFlashed = true; ui('toast', 'New best distance!', 'best'); RR.emit('new-best'); }
    if (S.distMark + 50 <= S.dist) { S.distMark += 50; stat('dist', 50); runStatSet('dist', Math.floor(S.dist)); }
    if (Math.floor(S.score) >= S.run.score + 500) runStatSet('score', Math.floor(S.score));
  }
  let pendingWorldToast = -1;
  let facingApplied = 0;

  // ------------------------------------------------------------------ camera
  const cam = { x: 0, y: 5.3, z: 9, lx: 0, ly: 1, lz: -8, fov: 60, kick: 0, trauma: 0, roll: 0 };
  let camIntro = 1;
  let _lookA = null;
  function shake(amount) { if (!reduceMotion) cam.trauma = Math.min(1, cam.trauma + amount); }
  function baseFov() {
    const aspect = camera.aspect || 1.6;
    const hMin = (58 * Math.PI) / 180;
    const v = (2 * Math.atan(Math.tan(hMin / 2) / aspect) * 180) / Math.PI;
    return clamp(Math.max(58, v), 58, 86);
  }
  // Right edge (fraction of the width) of the menu panel on screen, refreshed a few times a second.
  let panelFrac = 0.4, panelCheckT = 0;
  function menuPanelFrac(dt) {
    panelCheckT -= dt;
    if (panelCheckT <= 0) {
      panelCheckT = 0.25;
      const p = document.querySelector('#ui .screen:not([hidden]) .panel');
      const W = window.innerWidth || 1;
      panelFrac = p ? clamp(p.getBoundingClientRect().right / W, 0, 0.85) : 0;
    }
    return panelFrac;
  }
  function updateCamera(dt) {
    const px = view.px, py = view.py, pz = view.pz;
    const portrait = camera.aspect < 0.9;
    // follow target (portrait: closer and lower so the runner and obstacles read at phone size)
    const jet = S.jet.phase !== 'off';
    let fy = (portrait ? 4.4 : 5.3) + (jet ? py * 0.8 : py * 0.6) - (S.rollT > 0 ? 0.35 : 0);
    fy = Math.min(fy, C.OVERHEAD_CLEAR - 1.0); // never into bridge decks, arches or tunnel roofs
    if (frame.inTunnel || RR.inTunnel(pz - 6)) fy = Math.min(fy, 9.2);
    const fz = pz + (portrait ? 7.2 : 9);
    const fx_ = px * 0.55;
    const lx = px * 0.6, ly = (jet ? py * 0.8 : py * 0.55) + (portrait ? 1.4 : 1.0), lz = pz - (portrait ? 12 : 8) - S.speed * 0.08;
    let titleOffset = false;
    if (state === 'title') {
      // The character faces the camera (turned around); behind them the track and world recede toward -z.
      const t = T * 0.16;
      const sheet = window.innerWidth <= 640; // phone layouts put the menu in a bottom sheet
      const shop = RR.ui && RR.ui.screen === 'shop';
      if (sheet) { // hero in the top third, above the sheet
        cam.x = Math.sin(t) * 0.8; cam.y = 2.0 + Math.sin(T * 0.23) * 0.1; cam.z = pz + (shop ? 7.95 : 8.4);
        cam.lx = cam.x * (shop ? 0.58 : 0.46); cam.ly = 0; cam.lz = pz + (shop ? 4.6 : 3.9);
        cam.fov = 64;
      } else { // hero centred in the free area right of the docked panel (view offset below)
        cam.x = Math.sin(t) * 1.4 + 1.0; cam.y = 2.5 + Math.sin(T * 0.23) * 0.2; cam.z = pz + 6.6;
        cam.lx = -2.1; cam.ly = 1.6; cam.lz = pz - 2;
        cam.fov = 52;
        titleOffset = true;
      }
      camIntro = 0;
    } else {
      const k = camIntro < 1 ? RR.smoothstep(0, 1, camIntro) : 1;
      if (camIntro < 1) camIntro = Math.min(1, camIntro + dt / 1.2);
      const lam = k < 1 ? 4 + 6 * k : 8;
      cam.x = RR.damp(cam.x, fx_, lam, dt);
      cam.y = RR.damp(cam.y, fy, k < 1 ? 4 : 6, dt);
      cam.z = k < 1 ? RR.damp(cam.z, fz, 3 + 7 * k, dt) : fz;
      cam.lx = RR.damp(cam.lx, lx, 10, dt);
      cam.ly = RR.damp(cam.ly, ly, 8, dt);
      cam.lz = k < 1 ? RR.damp(cam.lz, lz, 4 + 6 * k, dt) : lz;
      let fov = baseFov() + (S.speed - C.BASE_SPEED) * 0.3 + (jet ? 10 : 0) + cam.kick;
      if (state === 'dying' || state === 'revive') fov -= 4;
      fov = Math.min(fov, portrait ? 96 : 90);
      cam.fov = RR.damp(cam.fov, fov, 3, dt);
    }
    cam.kick = RR.damp(cam.kick, 0, 3, dt);
    cam.trauma = Math.max(0, cam.trauma - dt * 1.5);
    const sh = reduceMotion ? 0 : cam.trauma * cam.trauma;
    const n = (a) => Math.sin(T * 37 + a) * 0.5 + Math.sin(T * 61 + a * 2.1) * 0.5;
    camera.position.set(cam.x + sh * 0.6 * n(1), cam.y + sh * 0.45 * n(2), cam.z);
    if (!_lookA) _lookA = new THREE.Vector3();
    _lookA.set(cam.lx, cam.ly, cam.lz);
    camera.lookAt(_lookA);
    // lean into lane changes
    const lat = state === 'run' ? clamp((LANES[S.lane] - S.px) / 2.6, -1, 1) : 0;
    cam.roll = RR.damp(cam.roll, reduceMotion ? 0 : -lat * 0.05, 8, dt);
    camera.rotateZ(cam.roll + sh * 0.02 * n(3));
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    if (titleOffset) {
      // shift the projection so the hero sits in the middle of the space right of the menu panel
      const W = Math.max(1, app.clientWidth || window.innerWidth), H = Math.max(1, app.clientHeight || window.innerHeight);
      const u = Math.min(0.92, (menuPanelFrac(dt) + 1) / 2);
      if (camera.view && camera.view.enabled) camera.clearViewOffset();
      if (!_proj) _proj = new THREE.Vector3();
      _proj.set(view.px, 0.9, view.pz).project(camera);
      const target = ((_proj.x + 1) / 2 - u) * W;
      titleShift = titleShift === null ? target : RR.damp(titleShift, target, 6, dt);
      camera.setViewOffset(W, H, titleShift, 0, W, H);
    } else if (camera.view && camera.view.enabled) { camera.clearViewOffset(); titleShift = null; }
  }
  let _proj = null, titleShift = null;
  RR.on('pickup', () => { cam.kick = Math.max(cam.kick, 6); });
  RR.on('land', (d) => { if (d && d.hard) { shake(0.15); cam.kick = Math.min(cam.kick, -3); } });

  // ------------------------------------------------------------------ frame
  function snapView() {
    prev.px = view.px = S.px; prev.py = view.py = S.py; prev.pz = view.pz = S.pz;
  }
  function simulate(dt) {
    acc += dt * timeScale;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS && state === 'run') {
      prev.px = S.px; prev.py = S.py; prev.pz = S.pz;
      simStep(STEP);
      acc -= STEP; n++;
    }
    if (n === MAX_STEPS) acc = 0;
    if (state !== 'run') acc = 0;
    const a = clamp(acc / STEP, 0, 1);
    view.px = prev.px + (S.px - prev.px) * a;
    view.py = prev.py + (S.py - prev.py) * a;
    view.pz = prev.pz + (S.pz - prev.pz) * a;
  }
  function doFrame(dtRaw, render) {
    const dt = Math.min(dtRaw, 0.1);
    T += dt;
    switch (state) {
      case 'run': if (!contextLost) { simulate(dtRaw); updateTutorial(dt); governor(dtRaw); } break;
      case 'dying':
        dyingT += dt; S.deathT += dt;
        view.px = S.px; view.py = S.py; view.pz = S.pz;
        if (dyingT > 0.95) afterDying();
        break;
      case 'revive':
        reviveT -= dt;
        if (reviveT <= 0) declineRevive();
        break;
      case 'countdown': {
        countdownT += dt;
        const n = 3 - Math.floor(countdownT / 0.7);
        if (n !== countdownN && n > 0) { countdownN = n; ui('show', 'countdown', { n }); RR.emit('countdown', { n }); }
        if (countdownT >= 2.1) { state = 'run'; ui('show', 'run'); lastT = 0; }
        break;
      }
      case 'title':
        S.pz = 0; S.px = 0; S.py = 0; snapView();
        break;
      default: break;
    }
    // frame object for the modules
    const running = state === 'run';
    frame.t = T; frame.dt = dt;
    frame.state = state === 'countdown' ? 'paused' : state;
    frame.pz = view.pz; frame.px = view.px; frame.py = view.py;
    frame.speed = state === 'title' ? 0 : running ? S.speed : 0;
    frame.dist = -view.pz;
    frame.world = RR.worldIndexAt(view.pz);
    frame.worldCount = Math.floor(frame.dist / C.WORLD_LEN);
    frame.inTunnel = RR.inTunnel(view.pz);
    const P = frame.player;
    P.lane = S.lane; P.grounded = S.grounded; P.rolling = S.rollT > 0; P.jetpack = S.jet.phase !== 'off'; P.board = S.board;
    P.sneakers = S.power.sneakers > 0; P.magnet = S.power.magnet > 0; P.double = S.power.double > 0; P.invulnerable = S.invulnT > 0;
    RR.atmoUpdate(dt, frame.world, frame.inTunnel ? 2.6 : 1.4);
    updateCamera(dt);
    // player pose
    pose.x = view.px; pose.y = view.py; pose.z = view.pz;
    pose.laneVel = clamp((LANES[S.lane] - S.px) / 2.6, -1, 1);
    pose.grounded = S.grounded; pose.vy = S.vy; pose.rolling = S.rollT > 0; pose.rollT = S.rollT > 0 ? 1 - S.rollT / C.ROLL_T : 0;
    pose.jetpack = S.jet.phase !== 'off'; pose.jetpackY01 = S.jet.y01; pose.sneakers = P.sneakers; pose.magnet = P.magnet;
    pose.board = S.board || (state === 'title' && !!previewBoard); // shop preview: stand on the selected board
    pose.invulnerable = P.invulnerable; pose.speed = frame.speed; pose.state = frame.state; pose.deathT = S.deathT;
    pose.stumbleT = Math.max(0, S.stumbleT); pose.landT = Math.max(0, S.landT); pose.superJump = S.superJump;
    pose.celebrate = S.celebrateT > 0; if (S.celebrateT > 0) S.celebrateT -= dt;
    S.facing = state === 'title' ? Math.PI : RR.damp(S.facing, 0, 7, dt);
    // modules
    RR.MODULE_ORDER.forEach((n) => {
      if (n === 'ui' || n === 'director') return;
      const m = RR[n]; if (!m || typeof m.update !== 'function') return;
      if (n === 'player') safe('player.update', () => {
        if (m.group) m.group.rotation.y -= facingApplied; // undo last frame's turn in case the module leaves rotation alone
        m.update(dt, pose);
        facingApplied = S.facing > 1e-3 ? S.facing : 0;
        if (m.group) m.group.rotation.y += facingApplied;
      });
      else if (n === 'audio') safe('audio.update', () => m.update(frame));
      else safe(n + '.update', () => m.update(dt, frame));
    });
    if (running || state === 'dying' || state === 'countdown') updateHud();
    if (render !== false) {
      renderer.info.reset();
      if (RR.fx && RR.fx.render) safe('fx.render', () => RR.fx.render()); else renderer.render(scene, camera);
    }
  }
  function updateHud() {
    const sd = save();
    hudData.score = Math.floor(S.score); hudData.coins = S.coins; hudData.mult = multiplier(); hudData.dist = Math.floor(S.dist);
    hudData.world = S.world;
    hudData.powers.length = 0;
    for (const p of powerHud) { const left = S.power[p.kind]; if (left > 0) { p.left = left; p.dur = S.powerDur[p.kind]; hudData.powers.push(p); } }
    if (S.board) { boardHud.left = S.boardT; hudData.powers.push(boardHud); }
    hudData.boards = sd.boards; hudData.boardActive = S.board;
    hudData.combo.n = S.combo; hudData.combo.left = S.comboT; hudData.combo.dur = S.comboDur;
    hudData.bestDist = sd.bestDist; hudData.headStart = S.headStartOffered && S.runT < 6 && sd.headStarts > 0;
    ui('hud', hudData);
  }
  function loop(tMs) {
    rafId = frozen ? 0 : requestAnimationFrame(loop);
    let dt = lastT ? (tMs - lastT) / 1000 : 1 / 60;
    lastT = tMs;
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, 0.25);
    noteRafDelta(dt);
    doFrame(dt, true);
  }
  function resize() {
    if (!renderer) return;
    const w = Math.max(1, app.clientWidth || window.innerWidth), h = Math.max(1, app.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (RR.fx && RR.fx.resize) safe('fx.resize', () => RR.fx.resize(w, h, renderer.getPixelRatio()));
  }

  // ------------------------------------------------------------------ debug hook
  window.__RR = {
    start(opts) { startRun(Object.assign({ tutorial: false }, opts || {})); return this.info(); },
    freeze(on) {
      frozen = !!on;
      if (!frozen && !rafId) { lastT = 0; rafId = requestAnimationFrame(loop); }
      if (frozen && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      return frozen;
    },
    step(seconds, fps) {
      const f = fps || 60, n = Math.max(1, Math.round((seconds || 0) * f));
      for (let i = 0; i < n; i++) doFrame(1 / f, i === n - 1);
      return this.info();
    },
    warp(metres) {
      if (state !== 'run') startRun({ tutorial: false });
      const d = Math.max(0, metres);
      S.pz = -d; S.pzPrev = S.pz; S.dist = d; S.speed = RR.speedAt(d);
      S.worldCount = Math.floor(d / C.WORLD_LEN); S.worldsCleared = S.worldCount; S.world = RR.worldIndexAt(S.pz);
      S.distMark = Math.floor(d / 50) * 50; S.py = 0; S.vy = 0; S.grounded = true; S.autoQueue.length = 0; S.jet.phase = 'off'; S.jet.y01 = 0;
      S.inTunnel = RR.inTunnel(S.pz);
      if (S.power.jetpack > 0) { S.power.jetpack = 0; RR.emit('jetpack-end'); RR.emit('power-end', { kind: 'jetpack' }); }
      S.onRoof = false; S.onRamp = false; S.roofRec = null; S.laneHold = null; S.rollT = 0; S.airT = 0;
      pendingWorldToast = -1;
      snapView();
      resetModules(S.pz);
      camIntro = 1; cam.kick = 0; cam.trauma = 0;
      cam.x = S.px * 0.55; cam.y = (camera.aspect < 0.9 ? 4.4 : 5.3); cam.z = S.pz + (camera.aspect < 0.9 ? 7.2 : 9);
      cam.lx = S.px * 0.6; cam.ly = camera.aspect < 0.9 ? 1.4 : 1.0; cam.lz = S.pz - 8;
      if (RR.audio && RR.audio.setWorld) safe('audio.world', () => RR.audio.setWorld(S.world));
      doFrame(1 / 60, true);
      return this.info();
    },
    god(on) { god = !!on; return god; },
    autopilot(on) { autopilot = !!on; return autopilot; },
    give(kind) { if (state !== 'run') return false; if (POWER_KINDS.includes(kind) || kind === 'board') { if (kind === 'board') { save().boards++; applyInput('board'); } else givePower(kind); } return true; },
    setQuality(name) { save().settings.quality = name; setTier(name === 'auto' ? detectTier() : name); return tierName; },
    setSkin(id) { applySkin(id); return id; },
    setBoard(id) { applyBoard(id); return id; },
    screen(name, data) { ui('show', name, data); },
    input(kind) { queue(kind); },
    render() { renderer.info.reset(); if (RR.fx && RR.fx.render) RR.fx.render(); else renderer.render(scene, camera); return this.info(); },
    state() { return S; },
    info() {
      const i = renderer ? renderer.info : null;
      return {
        state, dist: Math.round(S.dist * 10) / 10, speed: Math.round(S.speed * 10) / 10, world: S.world, inTunnel: RR.inTunnel(S.pz),
        fps: Math.round(1 / Math.max(1e-3, fpsEma)), drawCalls: i ? i.render.calls : 0, triangles: i ? i.render.triangles : 0,
        geometries: i ? i.memory.geometries : 0, textures: i ? i.memory.textures : 0, programs: i && i.programs ? i.programs.length : 0,
        sceneObjects: scene ? scene.children.length : 0, obstacles: RR.obstacles && RR.obstacles.list ? RR.obstacles.list.length : 0,
        coins: S.coins, score: Math.floor(S.score), quality: tierName, pixelRatio, wouldDie, py: Math.round(S.py * 100) / 100, lane: S.lane,
        jetpack: S.jet.phase, board: S.board, bank: save().bank, moduleErrors: Object.assign({}, moduleErrors)
      };
    }
  };
  let fpsEma = 1 / 60;
  // FPS estimate for info()
  (function trackFps() {
    let last = performance.now();
    const tick = (now) => { fpsEma = fpsEma * 0.9 + Math.min(0.5, (now - last) / 1000) * 0.1; last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })();

  game.start = startRun;
  game.pause = pause;
  game.resume = resume;
  game.state = () => state;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.RR);
