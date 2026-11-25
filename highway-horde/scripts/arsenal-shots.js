#!/usr/bin/env node
// First-person screenshots of the arsenal in the real game (public/dev/fps-sandbox.html):
// a gun held in the hands, and scripted fights — the real simulation with the local player
// placed at a viewpoint, a weapon given, zombies spawned in front and the trigger held
// (__fps.hold), frames rendered through the moments worth seeing. Serves public/ itself.
//
//   node scripts/arsenal-shots.js <out-dir> "<sandbox query>" <scene> [<scene> ...]
//   node scripts/arsenal-shots.js shots "map=truckstop&q=high&time=day&zombies=0&waittex=1&guntex=1" gun:ak:side fight:hollowstar
//
// Scenes: gun:<weapon>[:<pose>] (pose none|side|inspect|close, at the 'objective' view),
// fight:hollowstar (charging, the shot, the pull, the collapse), fight:chainsaw (cutting
// a pack), fight:sawblade (blades through a line of zombies). JPEG (quality 90) unless
// SHOT_TYPE=png. The query always gets bots=0&fixed=1&paused=1&clean=1.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const TYPE = process.env.SHOT_TYPE === 'png' ? 'png' : 'jpeg';
const EXT = TYPE === 'png' ? 'png' : 'jpg';

const [outDir, query = '', ...scenes] = process.argv.slice(2);
if (!outDir || !scenes.length) {
  console.error('usage: node scripts/arsenal-shots.js <out-dir> "<sandbox query>" <scene> [<scene> ...]');
  process.exit(2);
}
const q = new URLSearchParams(query);
for (const [k, v] of [['bots', '0'], ['fixed', '1'], ['paused', '1'], ['clean', '1']]) if (!q.has(k)) q.set(k, v);
const mapId = q.get('map') || 'highway';

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`error: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

const limit = Number(process.env.SHOT_TIMEOUT || 900000);
async function snap(name) {
  const file = join(outDir, `${name}.${EXT}`);
  await page.screenshot({ path: file, type: TYPE, ...(TYPE === 'jpeg' ? { quality: 90 } : {}), timeout: limit });
  console.log('wrote', file);
}

/**
 * In the page: put the local player at the 'objective' view with `weapon` (a full magazine),
 * zombies at [forward, side, type, hp] offsets in front, the prep phase held so the sim runs
 * without waves.
 */
async function setupFight(weapon, zombies, pitch = -0.06) {
  await page.evaluate(async ({ weapon, zombies, pitch }) => {
    const F = window.__fps;
    const pl = await import('/js/shared/sim/players.js');
    const zm = await import('/js/shared/sim/zombies.js');
    const { WEAPONS } = await import('/js/shared/weapons.js');
    F.setView(null);
    globalThis.__HH_VM_POSE = null;
    F.hold({});
    const g = F.game;
    g.timer = 1e6;
    for (const z of g.zombies) z.dead = true;
    zm.removeDeadZombies(g);
    g.projectiles.length = 0;
    const v = F.views.find((x) => x.name === 'objective');
    const p = g.getPlayer(1);
    p.x = v.x; p.y = v.y; p.angle = v.yaw;
    if (p.cmd) p.cmd.angle = v.yaw;
    p.hp = p.maxHp;
    p.slots = ['pistol', null, null];
    p.slot = pl.giveWeapon(g, p, weapon);
    p.mag[p.slot] = WEAPONS[weapon].mag;
    p.reloadT = 0;
    p.cooldown = 0;
    F.look(v.yaw, pitch);
    const ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
    for (const [fw, side, type, hp] of zombies) {
      const z = zm.spawnZombie(g, type, v.x + ca * fw - sa * side, v.y + sa * fw + ca * side);
      if (z && hp) { z.hp = z.maxHp = hp; }
      if (z) z.angle = v.yaw + Math.PI;
    }
    F.advance(1);
  }, { weapon, zombies, pitch });
}

const step = (n) => page.evaluate((k) => window.__fps.step(k), n);
const advance = (n) => page.evaluate((k) => window.__fps.advance(k), n);
const hold = (o) => page.evaluate((x) => window.__fps.hold(x), o);

const FIGHTS = {
  // the Hollow Star: the charge glowing up, the shot, the core dragging the pack in, the collapse
  async hollowstar(name) {
    const pack = [];
    for (let k = 0; k < 14; k++) pack.push([170 + (k % 5) * 40, ((k * 37) % 200) - 100, k % 4 === 0 ? 'runner' : 'walker', 0]);
    await setupFight('hollowstar', pack);
    // (the new gun comes up first: the switch's lower / raise plays out on rendered frames)
    await step(30);
    await hold({ fire: true });
    await step(30);
    await snap(`${name}-charging`);
    // render until the shot has left the emitter
    for (let i = 0; i < 20; i++) {
      await step(1);
      const out = await page.evaluate(() => window.__fps.game.projectiles.some((p) => p.kind === 'singularity' && !p.dead));
      if (out) break;
    }
    await step(3);
    await snap(`${name}-fire`);
    await hold({ fire: false });
    await advance(10);
    await step(5);
    await snap(`${name}-pull`);
    // up to the last ticks of its life, then render the collapse
    for (let i = 0; i < 200; i++) {
      const life = await page.evaluate(() => {
        const p = window.__fps.game.projectiles.find((x) => x.kind === 'singularity' && !x.dead);
        return p ? p.life : -1;
      });
      if (life < 0 || life < 4 / 60) break;
      await advance(1);
    }
    await step(9);
    await snap(`${name}-collapse`);
  },
  // the chainsaw cutting into a pack that walked up to it
  async chainsaw(name) {
    await setupFight('chainsaw', [[78, -10, 'walker', 1500], [96, 30, 'walker', 1500], [120, -42, 'runner', 1500], [140, 50, 'walker', 1500], [190, 0, 'brute', 6000]], -0.14);
    await step(30);
    await hold({ fire: true });
    await step(24);
    await snap(`${name}-cutting`);
    await step(18);
    await snap(`${name}-gore`);
    await hold({ fire: false });
  },
  // saw blades through a line of zombies, off the walls
  async sawblade(name) {
    const line = [];
    for (let k = 0; k < 8; k++) line.push([150 + k * 38, (k % 2 ? 1 : -1) * 18, 'walker', 400]);
    await setupFight('sawblade', line, -0.05);
    await step(30);
    await hold({ fire: true });
    await step(4);
    await snap(`${name}-launch`);
    await step(12);
    await snap(`${name}-slice`);
    await step(22);
    await snap(`${name}-volley`);
    await hold({ fire: false });
  },
};

try {
  await page.goto(`http://127.0.0.1:${port}/dev/fps-sandbox.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fps && window.__fps.renderer, null, { timeout: limit });
  await page.waitForFunction(() => !window.__hhTextures || window.__hhTextures.state !== 'loading', null, { timeout: limit });
  await page.waitForFunction(() => !window.__hhTexLoad || window.__hhTexLoad().done, null, { timeout: limit });
  for (const scene of scenes) {
    const [kind, a, b] = scene.split(':');
    if (kind === 'gun') {
      await page.evaluate(({ id, pose }) => window.__fps.setView(`objective@weapon=${id}&pose=${pose}`), { id: a, pose: b || 'none' });
      await step(3);
      await page.waitForTimeout(300);
      await snap(`${mapId}-${a}${b ? '-' + b : ''}`);
    } else if (kind === 'fight' && FIGHTS[a]) {
      await FIGHTS[a](`${mapId}-${a}`);
    } else console.warn('unknown scene', scene);
  }
} finally {
  if (logs.length) console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
  server.close();
}
