// Browser side of sheet.mjs: draws contact sheets of the sprite factory into canvases.
// Each sheet is a function ({ tile, dpr, themes }) -> { shots: [{ name, dataUrl }], info? } (crop is applied afterwards).
import * as S from '/js/sprites.js';
import { generateMap } from '/shared/mapgen.js';
import { makeRng } from '/shared/rng.js';

const THEMES = ['meadow', 'frost', 'lava', 'candy', 'night'];
const KINDS = ['bomb', 'flame', 'speed', 'kick', 'glove', 'shield', 'skull'];
const SPAWNS = [[1, 1], [13, 11], [13, 1], [1, 11], [7, 1], [7, 11], [1, 6], [13, 6]];

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const load = (url) => new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.src = url; });

function timed(fn) {
  const t0 = performance.now();
  const value = fn();
  return [value, performance.now() - t0];
}

const shot = (name, c) => ({ name, dataUrl: c.toDataURL() });

/** Replace a shot by the [x, y, w, h] part of it (device pixels) to inspect details at full resolution. */
async function cropShot({ name, dataUrl }, [x, y, w, h]) {
  const out = canvas(w, h);
  out.getContext('2d').drawImage(await load(dataUrl), x, y, w, h, 0, 0, w, h);
  return shot(`${name}-crop`, out);
}

const pick = (themes) => (themes && themes.length ? themes : THEMES);

/** A real generated board (shared/mapgen.js) so the art is judged on what players will see. */
function mockGrid(layout) {
  const { grid } = generateMap({ layout, blocks: 'normal', items: 'normal', numFighters: 8, rng: makeRng(7) });
  return { W: 15, H: 13, cells: [...grid] };
}

/** A mock frame of play following the draw order documented in sprites.js. */
function drawArena(set, { layout = 'classic' } = {}) {
  const T = set.tile, { W, H, cells } = mockGrid(layout);
  const margin = Math.round(T * 1.4);
  const c = canvas(W * T + margin * 2, H * T + margin * 2);
  const g = c.getContext('2d');
  g.fillStyle = g.createPattern(set.backdrop.canvas, 'repeat'); g.fillRect(0, 0, c.width, c.height);
  g.translate(margin, margin);
  const at = (tx, ty) => cells[ty * W + tx];
  const isBorder = (tx, ty) => tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1;
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) S.drawSprite(g, set.floorAt(tx, ty), tx * T, ty * T);
  for (let ty = 1; ty < H - 1; ty++) for (let tx = 1; tx < W - 1; tx++) if (at(tx, ty) !== '.' && at(tx + 1, ty) === '.') S.drawSprite(g, set.blockShadow, tx * T, ty * T);

  const flames = new Map();
  const addFlame = (tx, ty, mask) => flames.set(`${tx},${ty}`, (flames.get(`${tx},${ty}`) ?? 0) | mask);
  addFlame(5, 5, 15); addFlame(5, 4, 5); addFlame(5, 3, 4); addFlame(5, 6, 5); addFlame(5, 7, 1);
  addFlame(4, 5, 10); addFlame(3, 5, 2); addFlame(6, 5, 10); addFlame(7, 5, 8);
  addFlame(9, 9, 6); addFlame(10, 9, 8); addFlame(9, 10, 1); addFlame(11, 3, 0);
  for (const [key, mask] of flames) {
    const [tx, ty] = key.split(',').map(Number);
    S.drawSprite(g, set.flame(mask, (tx + ty) % S.FLAME_FRAMES), (tx + 0.5) * T, (ty + 0.5) * T);
  }

  const items = [];   // y-sorted by bottom edge; the border is scenery and goes first
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const ch = at(tx, ty);
      if (ch === '.') continue;
      const sprite = ch === '+' ? set.softBlockAt(tx, ty) : isBorder(tx, ty) ? set.borderAt(tx, ty) : set.hardWallAt(tx, ty);
      items.push({ y: isBorder(tx, ty) ? -1 : ty + 1, draw: () => S.drawSprite(g, sprite, tx * T, ty * T) });
    }
  }
  const shadow = (x, y, k = 1) => S.drawSprite(g, set.fx.shadow, x * T, y * T, k, k);
  const char = (ci, facing, kind, frame, x, y, extra) => {
    const ch = set.character(ci);
    items.push({ y: y + 0.4, draw: () => {
      shadow(x, y + 0.36, 0.9);
      if (extra?.ring !== undefined) S.drawSprite(g, set.teamRing[extra.ring], x * T, (y + 0.34) * T);
      const sprite = kind === 'walk' ? ch.walk[facing][frame] : kind === 'ghost' ? ch.ghost[frame] : ch[kind][kind === 'cheer' || kind === 'death' ? frame : facing];
      S.drawSprite(g, sprite, x * T, (kind === 'ghost' ? y - 0.3 : y) * T);
      if (extra?.shield) S.drawSprite(g, set.shield[1], x * T, y * T);
      if (extra?.aura) S.drawSprite(g, set.curseAura[2], x * T, y * T);
      if (extra?.emote !== undefined) S.drawSprite(g, set.emote(extra.emote), x * T, (y - 0.42) * T);
    } });
  };
  const bomb = (x, y, ci, phase, hot) => items.push({ y: y + 0.3, draw: () => { shadow(x, y + 0.34, 0.9); S.drawSprite(g, set.bomb(ci, phase, hot), x * T, y * T); } });
  const item = (x, y, kind) => items.push({ y: y + 0.1, draw: () => { S.drawSprite(g, set.itemGlow(kind), x * T, y * T); shadow(x, y + 0.3, 0.6); S.drawSprite(g, set.item(kind), x * T, (y - 0.06) * T); } });
  bomb(5.5, 5.5, 0, 1, false); bomb(2.5, 5.5, 1, 0, false); bomb(9.5, 7.5, 2, 2, true); bomb(11.5, 5.5, -1, 3, false);
  KINDS.forEach((k, i) => item(3.5 + i, 6.5 + (i % 2) * 2, k));
  SPAWNS.forEach(([sx, sy], ci) => {
    const extra = ci === 4 ? { shield: true, ring: 0 } : ci === 5 ? { aura: true, ring: 1 } : ci === 6 ? { emote: 4 } : undefined;
    char(ci, [2, 2, 2, 0, 2, 0, 1, 3][ci], ci % 2 ? 'walk' : 'idle', ci % 6, sx + 0.5, sy + 0.5, extra);
  });
  char(3, 1, 'flash', 0, 9.5, 11.5); char(0, 2, 'ghost', 0, 12.5, 9.5); char(6, 2, 'cheer', 2, 8.5, 3.5); char(1, 2, 'death', 2, 4.5, 9.5);
  items.push({ y: 2, draw: () => { S.drawSprite(g, set.suddenWall, 3 * T, 8 * T); S.drawSprite(g, set.fx.warning, 7.5 * T, 9.5 * T); } });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
  return c;
}

const sheets = {
  // every theme as a full mock arena
  arena({ tile, dpr, themes }) {
    const shots = [];
    let info = '';
    for (const theme of pick(themes)) {
      const [set, ms] = timed(() => S.buildSpriteSet({ tile, theme, dpr }));
      shots.push(shot(`arena-${theme}-t${tile}`, drawArena(set)));
      info += `${theme} build ${ms.toFixed(0)}ms, ${(set.pixels / 1e6).toFixed(2)} Mpx; `;
      set.dispose();
    }
    return { shots, info };
  },

  // the open layout, for the record
  open({ tile, themes }) {
    const set = S.buildSpriteSet({ tile, theme: pick(themes)[0], dpr: 1 });
    const result = { shots: [shot(`arena-open-t${tile}`, drawArena(set, { layout: 'open' }))] };
    set.dispose();
    return result;
  },

  // every walk frame of every colour and view
  'chars-walk'({ tile }) {
    const [set, ms] = timed(() => S.buildSpriteSet({ tile, theme: 'meadow', dpr: 1 }));
    const cw = Math.round(tile * 1.3), ch = Math.round(tile * 1.6);
    const c = canvas(4 * S.WALK_FRAMES * cw, 8 * ch);
    const g = c.getContext('2d');
    g.fillStyle = '#3b5f3a'; g.fillRect(0, 0, c.width, c.height);
    for (let ci = 0; ci < 8; ci++) for (let f = 0; f < 4; f++) for (let i = 0; i < S.WALK_FRAMES; i++) {
      S.drawSprite(g, set.character(ci).walk[f][i], (f * S.WALK_FRAMES + i) * cw + cw / 2, ci * ch + Math.round(tile * 1.08));
    }
    return { shots: [shot(`chars-walk-t${tile}`, c)], info: `build ${ms.toFixed(0)} ms, ${(set.pixels / 1e6).toFixed(2)} Mpx` };
  },

  // idle, blink, cheer, death spin, hurt flash and ghost of every colour
  'chars-states'({ tile }) {
    const set = S.buildSpriteSet({ tile, theme: 'meadow', dpr: 1 });
    const cw = Math.round(tile * 1.3), ch = Math.round(tile * 1.6);
    const c = canvas(24 * cw, 8 * ch);
    const g = c.getContext('2d');
    g.fillStyle = '#3b5f3a'; g.fillRect(0, 0, c.width, c.height);
    for (let ci = 0; ci < 8; ci++) {
      const a = set.character(ci);
      [...a.idle, ...a.blink, ...a.cheer, ...a.death, ...a.flash, ...a.ghost].forEach((sp, k) => S.drawSprite(g, sp, k * cw + cw / 2, ci * ch + Math.round(tile * 1.08)));
    }
    return { shots: [shot(`chars-states-t${tile}`, c)] };
  },

  // a close look at a few colours: idle in all facings plus walk frames of each view
  zoom({ tile }) {
    const set = S.buildSpriteSet({ tile, theme: 'meadow', dpr: 1 });
    const cw = Math.round(tile * 1.3), ch = Math.round(tile * 1.5);
    const colors = [0, 1, 3, 4];
    const c = canvas(10 * cw, colors.length * ch);
    const g = c.getContext('2d');
    g.fillStyle = '#5f9a58'; g.fillRect(0, 0, c.width, c.height);
    colors.forEach((ci, row) => {
      const a = set.character(ci);
      [...a.idle, a.walk[2][0], a.walk[2][1], a.walk[1][0], a.walk[1][1], a.walk[0][1], a.walk[3][1]]
        .forEach((sp, k) => S.drawSprite(g, sp, k * cw + cw / 2, row * ch + Math.round(tile * 1.02)));
    });
    return { shots: [shot(`zoom-t${tile}`, c)] };
  },

  // walk cycles of two colours: down, right, up (left is the mirror)
  walkstrip({ tile }) {
    const set = S.buildSpriteSet({ tile, theme: 'meadow', dpr: 1 });
    const cw = Math.round(tile * 1.05), ch = Math.round(tile * 1.4);
    const c = canvas(S.WALK_FRAMES * cw, 6 * ch);
    const g = c.getContext('2d');
    g.fillStyle = '#5f9a58'; g.fillRect(0, 0, c.width, c.height);
    [2, 1, 0].forEach((facing, r) => [1, 5].forEach((ci, k) => {
      for (let i = 0; i < S.WALK_FRAMES; i++) S.drawSprite(g, set.character(ci).walk[facing][i], i * cw + cw / 2, (r * 2 + k) * ch + Math.round(tile * 0.93));
    }));
    return { shots: [shot(`walkstrip-t${tile}`, c)] };
  },

  // bombs, flames, items, bubbles, auras, rings, emotes and particle textures
  props({ tile }) {
    const set = S.buildSpriteSet({ tile, theme: 'meadow', dpr: 1 });
    const cell = Math.round(tile * 1.5);
    const c = canvas(cell * 18, cell * 11);
    const g = c.getContext('2d');
    g.fillStyle = '#6a7a52'; g.fillRect(0, 0, c.width, c.height / 2);
    g.fillStyle = '#26203e'; g.fillRect(0, c.height / 2, c.width, c.height / 2);
    for (let ci = -1; ci < 8; ci++) for (let ph = 0; ph < S.BOMB_PULSE.length; ph++) {
      S.drawSprite(g, set.bomb(ci, ph, false), (ci + 1) * cell * 2 + ph * cell / 2 + cell / 2, cell * 0.6);
    }
    for (let ph = 0; ph < S.BOMB_PULSE.length; ph++) S.drawSprite(g, set.bomb(0, ph, true), 16 * cell + ph * cell / 2, cell * 1.6);
    for (let mask = 0; mask < 16; mask++) for (let f = 0; f < S.FLAME_FRAMES; f++) {
      S.drawSprite(g, set.flame(mask, f), (mask + 0.5) * cell * 1.12, (1.8 + f) * cell + cell * 0.6);
    }
    KINDS.forEach((k, i) => { S.drawSprite(g, set.itemGlow(k), (i + 0.5) * cell, cell * 6.6); S.drawSprite(g, set.item(k), (i + 0.5) * cell, cell * 6.6); });
    set.shield.forEach((sp, i) => S.drawSprite(g, sp, (8.5 + i) * cell, cell * 6.6));
    set.spawnShield.forEach((sp, i) => S.drawSprite(g, sp, (12.5 + i) * cell, cell * 6.6));
    set.curseAura.forEach((sp, i) => S.drawSprite(g, sp, (i + 0.5) * cell, cell * 7.9));
    set.teamRing.forEach((sp, i) => S.drawSprite(g, sp, (9 + i) * cell, cell * 7.9));
    for (let i = 0; i < 12; i++) S.drawSprite(g, set.emote(i), (i + 0.5) * cell, cell * 9.6);
    const fx = set.fx;
    [fx.dot, fx.glowWarm, fx.glowCool, fx.spark, ...fx.smoke, fx.ring, fx.star, ...fx.confetti, fx.warning, fx.shadow, ...set.dust]
      .forEach((sp, i) => S.drawSprite(g, sp, (i + 0.5) * cell * 0.85, cell * 10.5));
    return { shots: [shot(`props-t${tile}`, c)] };
  },

  // every crate intact and bursting, three frames, plus debris
  pops({ tile, themes }) {
    const list = pick(themes);
    const cellW = Math.round(tile * 1.7), cellH = Math.round(tile * 2);
    const c = canvas(cellW * 20, cellH * list.length);
    const g = c.getContext('2d');
    list.forEach((theme, row) => {
      const set = S.buildSpriteSet({ tile, theme, dpr: 1 });
      g.fillStyle = set.palette.floorA; g.fillRect(0, row * cellH, c.width, cellH);
      for (let v = 0; v < 2; v++) {
        const x0 = v * cellW * 10, y = row * cellH + tile * 0.9;
        S.drawSprite(g, set.softBlock[v], x0 + cellW * 0.6, y);
        for (let f = 0; f < S.SOFT_POP_FRAMES; f++) S.drawSprite(g, set.softPop[v][f], x0 + cellW * (1.6 + f * 1.3), y);
        S.drawSprite(g, set.debris[v], x0 + cellW * 6, y);
      }
      set.dispose();
    });
    return { shots: [shot(`pops-t${tile}`, c)] };
  },

  // DOM icons and avatars at a few sizes
  async icons() {
    const size = 96, names = S.ICON_NAMES;
    const rows = Math.ceil(names.length / 10);
    const c = canvas(10 * (size + 16), rows * (size + 16) + 2 * size + 90);
    const g = c.getContext('2d');
    g.fillStyle = '#5b6f8f'; g.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < names.length; k++) g.drawImage(await load(S.iconDataURL(names[k], size)), (k % 10) * (size + 16) + 8, Math.floor(k / 10) * (size + 16) + 8);
    const y0 = rows * (size + 16);
    for (let ci = 0; ci < 8; ci++) {
      g.drawImage(await load(S.avatarDataURL(ci, size)), ci * (size + 16) + 8, y0);
      g.drawImage(await load(S.avatarDataURL(ci, 32)), ci * (size + 16) + 8, y0 + size + 4);
    }
    for (let k = 0; k < names.length; k++) g.drawImage(await load(S.iconDataURL(names[k], 24)), k * 30 + 8, y0 + size + 44);
    return { shots: [shot('icons', c)] };
  },

  // terrain catalogue: every floor / pillar / crate / border variant per theme
  themes({ tile, themes }) {
    const shots = [];
    for (const theme of pick(themes)) {
      const set = S.buildSpriteSet({ tile, theme, dpr: 1 });
      const cell = Math.round(tile * 1.08), rowH = Math.round(tile * 1.7);
      const c = canvas(cell * 14 + 8, rowH * 3 + 8);
      const g = c.getContext('2d');
      g.fillStyle = set.palette.sky[0]; g.fillRect(0, 0, c.width, c.height);
      let x = 4;
      const put = (sp, y) => { S.drawSprite(g, sp, x, y); x += cell; };
      for (const parity of [0, 1]) for (const sp of set.floor[parity]) put(sp, 8);
      x = 4;
      for (const sp of [...set.hardWall, ...set.softBlock, ...set.border, set.suddenWall]) put(sp, rowH + 4 + tile * 0.4);
      x = 4;
      for (const sp of set.debris) { S.drawSprite(g, sp, x + tile * 0.3, rowH * 2 + tile * 0.4); x += cell; }
      for (const col of [set.palette.floorA, set.palette.floorB, set.palette.wallTop, set.palette.blockTop, set.palette.accent, set.palette.glow]) {
        g.fillStyle = col; g.fillRect(x, rowH * 2 + 8, tile * 0.5, tile * 0.5); x += tile * 0.6;
      }
      g.drawImage(set.backdrop.canvas, 0, 0, tile * 4, tile * 4, cell * 8, rowH * 2, tile * 1.6, tile * 1.6);
      shots.push(shot(`themes-${theme}-t${tile}`, c));
      set.dispose();
    }
    return { shots };
  },

  // the same board at the tile sizes of a 1x, 2x and 3x screen (24 css px per tile) and a TV
  sizes({ themes }) {
    const shots = [];
    for (const [tile, dpr] of [[24, 1], [48, 2], [72, 3], [96, 2]]) {
      const set = S.buildSpriteSet({ tile, theme: pick(themes)[0], dpr });
      shots.push(shot(`sizes-${set.theme}-t${tile}-dpr${dpr}`, drawArena(set)));
      set.dispose();
    }
    return { shots };
  },
};

window.artSheets = {
  names: Object.keys(sheets),
  async render(name, params) {
    const result = await sheets[name](params);
    if (params.crop) result.shots = await Promise.all(result.shots.map((s) => cropShot(s, params.crop)));
    return result;
  },
};
