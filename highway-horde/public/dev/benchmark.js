// Benchmark page (SPEC §7.5.3): a fixed camera fly-through of the highway map at night for N seconds
// (default 20) with three bots and the horde, at the graphics settings of the game (prefs in
// localStorage) or the ones picked on the page. It prints the average frame rate, the 1 % and 0.1 % lows,
// the frame-time percentiles and (when the browser has a GPU timer) the GPU frame time, plus the card, the
// screen and the tier, in a block to copy and send back.
//
// URL params: q=cinematic|ultra|high|low, scale=auto|0.5..2, msaa=0|2|4|8, secs=<n>, timing=1 (per-pass GPU
// timings), auto=1 (start at once; the result is in window.__benchResult), fixed=1 (fixed 60 Hz sim ticks per
// frame instead of wall-clock: deterministic runs on slow software GL), warm=<s> (warm-up seconds, default 3).
// window.__bench: run(opts) → Promise<result>, path(t) → { x, y, yaw, pitch }, result.

import { createRenderer3D, isWebGLAvailable } from '../js/render3d/renderer3d.js';
import { CLASS_IDS } from '../js/shared/classes.js';
import { validateSettings, defaultClientSettings, isCoarsePointer } from '../js/ui/storage.js';
import { rendererSettings, applyDetectedTier } from '../js/ui/gfx.js';
import { probeGpu, recommendedTier, gpuLabel } from '../js/ui/gpu.js';
import { measureRefresh } from '../js/ui/display.js';
import { summarizeFrames, pathAt, f1, f2 } from './bench-stats.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const canvas = $('game');
const idle = { moveX: 0, moveY: 0, angle: 0, fire: false, melee: false, sprint: false, interact: false, reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0 };

// ---- the page -------------------------------------------------------------------------------------------------

let gpu = null, refreshHz = 60, baseSettings = null, running = false, lastResult = null;

function storedSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem('highway-horde:prefs:v1') || 'null'); } catch { raw = null; }
  const fresh = !raw || !raw.settings;
  const s = validateSettings(fresh ? undefined : raw.settings);
  // a profile that never picked a quality gets the card's default, as the game does on first run
  if (gpu) applyDetectedTier(s, recommendedTier(gpu, { coarse: isCoarsePointer() }));
  return { s, fresh };
}

function describeBrowser() {
  const ua = navigator.userAgent;
  const m = /(Edg|Chrome|Firefox|Safari)\/([\d.]+)/.exec(ua);
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : /Android/.test(ua) ? 'Android' : 'unknown OS';
  return `${m ? `${m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2].split('.')[0]}` : 'browser'} on ${os}`;
}

function refreshInfo() {
  const dpr = window.devicePixelRatio || 1;
  $('info').textContent = `${gpu ? gpuLabel(gpu, { coarse: false }) || gpu.raw || 'unknown GPU' : 'probing the GPU…'} · screen ${screen.width}×${screen.height} at ${dpr}× · ${refreshHz} Hz${baseSettings ? ` · game settings: ${baseSettings.quality}, resolution ${baseSettings.renderScale === 'auto' ? 'Auto' : Math.round(baseSettings.renderScale * 100) + '%'}` : ''}`;
}

/**
 * Run the benchmark.
 * @param {{ quality?: string, scale?: string|number, msaa?: number, secs?: number, warm?: number, timing?: boolean, fixed?: boolean }} o
 */
async function run(o = {}) {
  if (running) throw new Error('already running');
  running = true;
  const panel = $('panel');
  panel.classList.add('running');
  const { Game } = await import('../js/shared/sim.js');
  const secs = Math.max(2, Number(o.secs) || 20);
  const warm = o.warm !== undefined ? Number(o.warm) : 3;

  // ---- settings: the game's, then the page's overrides
  const s = { ...baseSettings };
  if (o.quality) {
    s.quality = o.quality;
    // the extras follow the tier's preset unless the page sets them
    const P = (await import('../js/ui/storage.js')).GRAPHICS_PRESETS[o.quality];
    Object.assign(s, P);
  }
  if (o.scale !== undefined && o.scale !== '') s.renderScale = o.scale === 'auto' ? 'auto' : Number(o.scale);
  if (o.msaa !== undefined && o.msaa !== '') s.msaa = Number(o.msaa);
  s.showStats = !!o.timing;
  const gfx = rendererSettings(s, { crosshair: false });
  gfx.timing = !!o.timing;

  // ---- the game: Highway 9 Pileup at night, three bots, the horde running
  const players = [{ id: 1, name: 'You', color: 0, cls: 'soldier' }];
  for (let i = 0; i < 3; i++) players.push({ id: i + 2, name: ['Doc', 'Sparks', 'Swift'][i], color: i + 1, cls: CLASS_IDS[(i + 1) % CLASS_IDS.length], bot: true });
  const game = new Game({ mapId: 'highway', seed: 1234, players, settings: { difficulty: 'normal', waves: 15, objective: true, friendlyFire: false, time: 'night', mode: 'defend' } });
  for (let t = 0; t < 60 * 30 && game.phase === 'prep'; t++) game.step();
  const roster = players.map((p) => ({ ...p, ready: true, ping: 0, host: p.id === 1 }));

  $('info').textContent = 'Building the world…';
  await new Promise((r) => requestAnimationFrame(() => r()));
  const t0 = performance.now();
  const renderer = createRenderer3D(canvas, { map: game.map, quality: s.quality, time: 'night', mode: game.mode, refreshHz });
  const createMs = performance.now() - t0;
  let seq = 0;

  // ---- the loop
  const frameMs = [], gpuMs = [], scales = [], calls = [], tris = [], jsMs = [], passSum = {};
  let passN = 0;
  const hud = $('hud'), bar = $('bar');
  let acc = 0, last = 0, started = 0, recStart = 0, frame = 0;
  const fixed = !!o.fixed;
  const result = await new Promise((resolve) => {
    const tick = (now) => {
      if (!started) { started = now; last = now; }
      const dtMs = now - last;
      last = now;
      const dt = fixed ? 1 / 60 : Math.min(0.1, dtMs / 1000);
      const elapsed = fixed ? frame / 60 : (now - started) / 1000;
      frame++;
      // sim ticks at 60 Hz of wall-clock time: the same world at the same moment whatever the frame rate
      acc += dt;
      let n = 0;
      while (acc >= 1 / 60 && n++ < 8) {
        acc -= 1 / 60;
        game.setInput(1, { ...idle, seq: ++seq, angle: 0 });
        game.step();
        // the run must stay a fight: nobody stays down, the bus stands
        for (const p of game.players) if (p.state === 'alive' || p.state === 'downed') { p.hp = p.maxHp; p.state = 'alive'; }
        const ob = game.objective;
        if (ob && Number.isFinite(ob.maxHp)) ob.hp = ob.maxHp;
      }
      const snap = game.snapshot();
      const rec = elapsed >= warm;
      if (rec && !recStart) recStart = elapsed;
      const cam = pathAt(rec ? elapsed - warm : 0);
      const view = { ...snap, players: snap.players.map((p) => (p.id === 1 ? { ...p, x: cam.x, y: cam.y, z: 0, angle: cam.yaw, state: 'alive', vzq: 0, climbT: 0 } : p)) };
      renderer.addEvents(snap.events, { localId: 1 });
      renderer.render(view, { localId: 1, roster, now: now / 1000, dt, look: { yaw: cam.yaw, pitch: cam.pitch }, settings: gfx });
      const st = renderer.stats;
      if (rec) {
        if (frame > 1) frameMs.push(fixed ? dtMs : dtMs);
        if (Number.isFinite(st.gpuMs)) gpuMs.push(st.gpuMs);
        scales.push(st.renderScale); calls.push(st.drawCalls); tris.push(st.triangles); jsMs.push(st.jsMs);
        if (st.passMs) { passN++; for (const [k, v] of Object.entries(st.passMs)) passSum[k] = (passSum[k] || 0) + v; }
      }
      const done = rec ? Math.min(1, (elapsed - warm) / secs) : 0;
      bar.style.width = `${done * 100}%`;
      hud.textContent = rec
        ? `${st.tier} · ${st.width}×${st.height} · ${Math.round(1000 / Math.max(0.001, dtMs))} fps\n${(elapsed - warm).toFixed(1)} / ${secs} s`
        : `warming up… ${elapsed.toFixed(1)} / ${warm} s`;
      if (rec && elapsed - warm >= secs) { resolve({ st, s }); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const final = result.st;
  const stats = summarizeFrames(frameMs, gpuMs);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const out = {
    map: 'highway', time: 'night', secs, seed: 1234,
    gpu: gpu ? { raw: gpu.raw, name: gpu.name, class: gpu.class } : null,
    browser: describeBrowser(),
    screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio || 1, canvas: [canvas.width, canvas.height], refreshHz },
    settings: { quality: s.quality, renderScale: s.renderScale, msaa: s.msaa, antialias: s.antialias, ao: s.ao, volumetrics: s.volumetrics, reflections: s.reflections },
    internal: { width: final.width, height: final.height, renderScaleAvg: avg(scales), msaa: final.msaa },
    createMs: Math.round(createMs),
    stats,
    scene: { drawCalls: avg(calls), triangles: avg(tris), jsMs: avg(jsMs), staticTriangles: final.staticTriangles },
    passMs: passN ? Object.fromEntries(Object.entries(passSum).map(([k, v]) => [k, v / passN])) : null,
  };
  try { renderer.destroy(); } catch { /* the page is done with it */ }
  running = false;
  panel.classList.remove('running');
  hud.textContent = '';
  bar.style.width = '0';
  lastResult = out;
  window.__benchResult = out;
  show(out);
  return out;
}

/** The block the owner sends back. */
export function formatResult(r) {
  const st = r.stats;
  if (!st) return 'no frames were recorded';
  const scale = r.settings.renderScale === 'auto' ? `Auto (avg ${Math.round(r.internal.renderScaleAvg * 100)}%)` : `${Math.round(r.settings.renderScale * 100)}%`;
  const lines = [
    `Highway Horde benchmark — Highway 9 Pileup (night), ${r.secs} s fly-through, 3 bots + horde`,
    `GPU: ${r.gpu ? r.gpu.name || r.gpu.raw : 'unknown'}${r.gpu && r.gpu.raw && r.gpu.raw !== r.gpu.name ? `   [${r.gpu.raw}]` : ''}`,
    `Browser: ${r.browser}`,
    `Screen: ${r.screen.width}×${r.screen.height} at ${r.screen.dpr}× (canvas ${r.screen.canvas[0]}×${r.screen.canvas[1]}), ${r.screen.refreshHz} Hz`,
    `Settings: ${r.settings.quality}, resolution ${scale} → drawn at ${r.internal.width}×${r.internal.height}, MSAA ${r.internal.msaa ? r.internal.msaa + '×' : 'off'}, AA ${r.settings.antialias}`,
    `Result: avg ${f1(st.avgFps)} fps | 1% low ${f1(st.low1Fps)} | 0.1% low ${f1(st.low01Fps)} | min ${f1(st.minFps)} | max ${f1(st.maxFps)}   (${st.frames} frames)`,
    `Frame time: avg ${f2(st.avgMs)} ms | median ${f2(st.p50Ms)} | 95th ${f2(st.p95Ms)} | 99th ${f2(st.p99Ms)} | worst ${f2(st.maxMs)} | stutters ${st.stutters}`,
  ];
  if (Number.isFinite(st.gpuAvgMs)) lines.push(`GPU time: avg ${f2(st.gpuAvgMs)} ms | 99th ${f2(st.gpuP99Ms)} | worst ${f2(st.gpuMaxMs)}   (headroom shows when the frame rate is capped by v-sync)`);
  lines.push(`Scene: ${Math.round(r.scene.drawCalls)} draw calls, ${(r.scene.triangles / 1e6).toFixed(2)} M triangles, JS ${f2(r.scene.jsMs)} ms, world built in ${(r.createMs / 1000).toFixed(1)} s`);
  if (r.passMs) lines.push(`Passes (GPU ms): ${Object.entries(r.passMs).filter(([, v]) => v >= 0.05).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | ')}`);
  return lines.join('\n');
}

function show(r) {
  const out = $('out');
  out.textContent = formatResult(r);
  out.hidden = false;
  $('copy').disabled = false;
  $('go').disabled = false;
  $('go').textContent = 'Run again';
  refreshInfo();
}

async function main() {
  if (!isWebGLAvailable()) {
    $('info').textContent = 'WebGL2 is not available in this browser.';
    $('go').disabled = true;
    return;
  }
  gpu = probeGpu();
  baseSettings = storedSettings().s;
  measureRefresh({ onDone(hz) { if (hz) refreshHz = hz; refreshInfo(); } });
  refreshInfo();
  for (const k of ['q', 'scale', 'msaa', 'secs']) {
    const v = params.get(k);
    if (!v || !$(k)) continue;
    // (a length the page does not list is added: automation runs short ones)
    if (![...$(k).options].some((op) => op.value === v || op.textContent === v)) $(k).add(new Option(v, v));
    $(k).value = v;
  }
  $('go').onclick = () => {
    $('go').disabled = true;
    run({
      quality: $('q').value, scale: $('scale').value, msaa: $('msaa').value, secs: Number($('secs').value),
      timing: params.get('timing') === '1', warm: params.get('warm') ?? undefined, fixed: params.get('fixed') === '1',
    }).catch((err) => { running = false; $('panel').classList.remove('running'); $('info').textContent = `Failed: ${err && err.message ? err.message : err}`; $('go').disabled = false; });
  };
  $('fs').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('out').textContent + '\n\n' + JSON.stringify(lastResult)); $('copy').textContent = 'Copied'; } catch { $('out').focus(); }
  };
  window.__bench = { run, path: pathAt, get result() { return lastResult; }, format: formatResult, get gpu() { return gpu; } };
  if (params.get('auto') === '1') $('go').click();
}
main();
