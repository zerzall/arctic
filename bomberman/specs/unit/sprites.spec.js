// sprites.js under Node with a fake canvas: API shape, atlas packing limits, time-sliced builds, sharing and disposal.
// (The pixels themselves are judged by eye with scripts/dev/art/sheet.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_COLORS, THEMES, ITEM_KINDS, CURSE_KINDS, EMOTES } from '../../shared/constants.js';
import * as S from '../../client/js/sprites.js';

/** A 2D context that accepts every call; gradients get addColorStop. Counts fills so tests can see that drawing happened. */
function makeContext(canvas) {
  const target = { canvas, fills: 0 };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'fill' || prop === 'stroke' || prop === 'drawImage' || prop === 'fillRect') t[prop] = () => { t.fills++; };
      else if (typeof prop === 'string' && prop.startsWith('create')) t[prop] = () => ({ addColorStop() {} });
      else t[prop] = () => {};
      return t[prop];
    },
  });
}

function fakeCanvas(w, h) {
  const c = { width: w, height: h, ctx: null, getContext() { return (c.ctx ??= makeContext(c)); }, toDataURL() { return `data:image/png;base64,${this.width}x${this.height}`; } };
  return c;
}

/** Every sprite of a set: what is reachable as properties plus everything behind the accessor methods. */
function collectSprites(set) {
  const out = new Set(), seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.img && 'ax' in v && 'ay' in v) { out.add(v); return; }
    if (v.canvas) return;   // the backdrop is a standalone canvas
    for (const k of Object.keys(v)) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d.get && typeof v[k] !== 'function') walk(v[k]); }
  };
  walk(set);
  for (let c = 0; c < PLAYER_COLORS.length; c++) {
    walk(set.character(c));
    for (let phase = 0; phase < S.BOMB_PULSE.length; phase++) for (const hot of [false, true]) walk(set.bomb(c, phase, hot));
  }
  for (let phase = 0; phase < S.BOMB_PULSE.length; phase++) for (const hot of [false, true]) walk(set.bomb(-1, phase, hot));
  for (let mask = 0; mask < 16; mask++) for (let f = 0; f < S.FLAME_FRAMES; f++) walk(set.flame(mask, f));
  for (const kind of ITEM_KINDS) { walk(set.item(kind)); walk(set.itemGlow(kind)); }
  for (let e = 0; e < EMOTES.length + S.EXTRA_EMOTE_ICONS.length; e++) walk(set.emote(e));
  return [...out];
}

const build = (opts) => S.buildSpriteSet({ createCanvas: fakeCanvas, ...opts });

test('vocabulary matches the shared constants', () => {
  assert.deepEqual([...S.COLOR_NAMES], PLAYER_COLORS.map((c) => c.name));
  assert.deepEqual([...S.ACCESSORIES], PLAYER_COLORS.map((c) => c.accessory));
  assert.deepEqual(Object.keys(S.THEME_PALETTES).sort(), [...THEMES].sort());
  for (const name of THEMES) {
    const p = S.THEME_PALETTES[name];
    for (const key of ['floorA', 'floorB', 'wallTop', 'blockTop', 'accent', 'glow', 'backdrop', 'frame', 'dust']) assert.match(p[key], /^#[0-9a-f]{6}$/i, `${name}.${key}`);
    assert.equal(p.sky.length, 2);
    assert.ok(p.ambient.kind && p.ambient.colors.length >= 3);
  }
  for (const name of [...ITEM_KINDS, ...CURSE_KINDS, 'crown', 'star']) assert.ok(S.ICON_NAMES.includes(name), `icon ${name}`);
  assert.equal(S.EMOTE_ICONS.length, EMOTES.length);
  for (const name of [...S.EMOTE_ICONS, ...S.EXTRA_EMOTE_ICONS]) assert.ok(S.ICON_NAMES.includes(name), `emote icon ${name}`);
});

test('importing and building need no DOM', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(S.iconDataURL('bomb', 32), '');
  assert.equal(S.avatarDataURL(0, 32), '');
});

for (const theme of THEMES) {
  test(`a ${theme} set has the whole documented shape at tile 64`, () => {
    const set = build({ tile: 64, theme });
    assert.equal(set.ready, true);
    assert.equal(set.theme, theme);
    assert.equal(set.palette, S.THEME_PALETTES[theme]);
    for (const [tx, ty] of [[0, 0], [1, 1], [7, 6], [14, 12], [3, 9]]) {
      for (const sp of [set.floorAt(tx, ty), set.hardWallAt(tx, ty), set.softBlockAt(tx, ty), set.borderAt(tx, ty)]) assert.ok(sp.img && sp.w > 0 && sp.h > 0);
    }
    assert.equal(set.floorAt(4, 4), set.floorAt(4, 4), 'variant choice is deterministic');
    assert.equal(set.floor.length, 2);
    for (const list of [set.hardWall, set.softBlock, set.border, set.debris, set.dust]) assert.ok(list.length >= 2);
    assert.ok(set.suddenWall.img && set.blockShadow.img);
    assert.equal(set.backdrop.size, S.BACKDROP_TILES * 64);
    for (let c = 0; c < PLAYER_COLORS.length; c++) {
      const ch = set.character(c);
      for (const key of ['idle', 'blink', 'flash']) assert.equal(ch[key].length, 4, key);
      assert.equal(ch.walk.length, 4);
      for (const frames of ch.walk) assert.equal(frames.length, S.WALK_FRAMES);
      assert.ok(S.WALK_FRAMES >= 4);
      assert.equal(ch.cheer.length, 4);
      assert.ok(ch.death.length >= 4);
      assert.equal(ch.ghost.length, 2);
      assert.equal(ch.blink[0], ch.idle[0], 'the back view has no eyes to blink');
    }
    for (let mask = 0; mask < 16; mask++) for (let f = 0; f < S.FLAME_FRAMES; f++) assert.ok(set.flame(mask, f).img);
    for (let owner = -1; owner < 8; owner++) for (let phase = 0; phase < S.BOMB_PULSE.length; phase++) for (const hot of [false, true]) assert.ok(set.bomb(owner, phase, hot).img);
    for (const kind of ITEM_KINDS) { assert.ok(set.item(kind).img); assert.ok(set.itemGlow(kind).img); }
    for (let e = 0; e < EMOTES.length + S.EXTRA_EMOTE_ICONS.length; e++) assert.ok(set.emote(e).img);
    assert.equal(set.shield.length, S.SHIELD_FRAMES);
    assert.equal(set.spawnShield.length, S.SHIELD_FRAMES);
    assert.equal(set.curseAura.length, S.CURSE_AURA_FRAMES);
    assert.equal(set.teamRing.length, 2);
    for (const key of ['shadow', 'dot', 'glowWarm', 'glowCool', 'flameGlow', 'spark', 'ember', 'twinkle', 'skull', 'ring', 'star', 'warning', 'hazard']) assert.ok(set.fx[key].img, key);
    assert.equal(set.fx.smoke.length, 3);
    assert.equal(set.fx.darkSmoke.length, 3);
    assert.equal(set.fx.confetti.length, 6);
    set.dispose();
  });
}

for (const tile of [24, 48, 96]) {
  test(`atlas pages stay within 2048 x 2048 and sprites never overlap at tile ${tile}`, () => {
    const set = build({ tile, theme: 'meadow' });
    const sprites = collectSprites(set);
    assert.ok(sprites.length > 500, `found ${sprites.length} sprites`);
    const pages = new Map();
    for (const sp of sprites) {
      assert.ok(sp.x >= 0 && sp.y >= 0 && sp.x + sp.w <= sp.img.width && sp.y + sp.h <= sp.img.height, 'inside its page');
      assert.ok(sp.ax >= 0 && sp.ax <= sp.w && sp.ay >= 0 && sp.ay <= sp.h, 'anchor inside the sprite');
      (pages.get(sp.img) ?? pages.set(sp.img, []).get(sp.img)).push(sp);
    }
    for (const [img, list] of pages) {
      assert.ok(img.width <= 2048 && img.height <= 2048, `page ${img.width}x${img.height}`);
      list.sort((a, b) => a.x - b.x);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length && list[j].x < list[i].x + list[i].w; j++) {
          const a = list[i], b = list[j];
          assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, 'sprites share pixels');
        }
      }
    }
    assert.ok(set.pixels < (tile === 96 ? 12e6 : 6e6), `${set.pixels} px allocated`);
    set.dispose();
  });
}

test('tile-sized terrain sprites are exactly one tile wide', () => {
  for (const tile of [24, 37, 64, 96]) {
    const set = build({ tile, theme: 'candy' });
    assert.equal(set.floorAt(2, 3).w, tile);
    assert.equal(set.floorAt(2, 3).h, tile);
    assert.equal(set.hardWallAt(2, 2).w, tile);
    assert.equal(set.hardWallAt(2, 2).ax, 0);
    assert.ok(set.hardWallAt(2, 2).ay > 0 && set.hardWallAt(2, 2).ay < tile, 'the top face reaches above the tile');
    set.dispose();
  }
});

test('a build can be pumped in small slices and is transparent until done', () => {
  const b = S.startSpriteBuild({ tile: 32, theme: 'night', createCanvas: fakeCanvas });
  assert.equal(b.set.ready, false);
  let calls = 0;
  while (!b.pump(0)) { calls++; assert.ok(calls < 5000); }
  assert.ok(calls > 20, 'a zero budget still makes progress one sprite at a time');
  assert.equal(b.set.ready, true);
  assert.equal(b.pump(0), true);
  b.set.dispose();
});

test('dispose releases every canvas and is idempotent', () => {
  const made = [];
  const track = (w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; };
  const set = S.buildSpriteSet({ tile: 40, theme: 'frost', createCanvas: track });
  assert.ok(made.length > 3 && set.pixels > 0);
  set.dispose();
  set.dispose();
  assert.ok(made.every((c) => c.width === 0 && c.height === 0), 'iOS canvas budget: zero the size');
  assert.equal(set.pixels, 0);
});

test('themes at one tile size share the theme-independent sprites and free them with the last set', () => {
  globalThis.document = { createElement: () => fakeCanvas(1, 1) };
  try {
    const a = S.buildSpriteSet({ tile: 30, theme: 'meadow', dpr: 1 });
    const b = S.buildSpriteSet({ tile: 30, theme: 'lava', dpr: 1 });
    assert.equal(a.character(3), b.character(3));
    assert.notEqual(a.hardWallAt(2, 2), b.hardWallAt(2, 2));
    const other = S.buildSpriteSet({ tile: 31, theme: 'meadow', dpr: 1 });
    assert.notEqual(other.character(3), a.character(3), 'a different tile size is a different set');
    const page = a.character(3).idle[0].img;
    a.dispose();
    assert.ok(page.width > 0, 'still used by the other set');
    b.dispose();
    assert.equal(page.width, 0, 'freed with the last user');
    other.dispose();
  } finally {
    delete globalThis.document;
  }
});

test('data URL helpers cache and reject unknown names', () => {
  let made = 0;
  globalThis.document = { createElement: () => { made++; return fakeCanvas(1, 1); } };
  try {
    const url = S.iconDataURL('skull', 28);
    assert.match(url, /^data:image\/png/);
    const n = made;
    assert.equal(S.iconDataURL('skull', 28), url);
    assert.equal(made, n, 'second call is served from the cache');
    assert.equal(S.iconDataURL('nope', 28), '');
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', undefined, null, 5]) assert.equal(S.iconDataURL(name, 28), '', String(name));
    for (const index of ['length', 'map', '__proto__', '1', 1.5, NaN, null, undefined, -1, 8]) assert.equal(S.avatarDataURL(index, 28), '', String(index));
    assert.match(S.avatarDataURL(5, 40), /^data:image\/png/);
    assert.equal(S.avatarDataURL(9, 40), '');
    for (const name of S.ICON_NAMES) assert.match(S.iconDataURL(name, 24), /^data:/, name);
    for (let i = 0; i < 8; i++) assert.match(S.avatarDataURL(i, 24), /^data:/);
  } finally {
    delete globalThis.document;
  }
});

test('bad options are rejected early', () => {
  assert.throws(() => build({ tile: 4, theme: 'meadow' }), RangeError);
  assert.throws(() => build({ tile: NaN, theme: 'meadow' }), RangeError);
  assert.throws(() => build({ tile: 64, theme: 'moon' }), RangeError);
  assert.throws(() => build({ tile: 100000, theme: 'meadow' }), RangeError, 'a runaway tile size must not allocate canvases of that size');
  assert.throws(() => build({ tile: '64', theme: 'meadow' }), RangeError);
});

test('theme names are matched exactly: Object.prototype keys and near misses are unknown themes', () => {
  const made = [];
  const track = (w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; };
  for (const theme of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'random', 'Meadow', '', null, 5, ['meadow']]) {
    assert.throws(() => S.buildSpriteSet({ tile: 16, theme, createCanvas: track }), RangeError, String(theme));
  }
  assert.equal(made.length, 0, 'nothing is allocated for a rejected theme');
});

test('a build that fails half way gives back the shared sprites it had pinned', () => {
  globalThis.document = { createElement: () => fakeCanvas(1, 1) };
  try {
    const a = S.buildSpriteSet({ tile: 26, theme: 'meadow' });
    const page = a.character(0).idle[0].img;
    // fail while the terrain of the second set is being laid out: its canvas factory is the document, so break that
    globalThis.document = { createElement: () => { throw new Error('canvas memory exhausted'); } };
    assert.throws(() => S.startSpriteBuild({ tile: 26, theme: 'lava' }), /canvas memory exhausted/);
    globalThis.document = { createElement: () => fakeCanvas(1, 1) };
    a.dispose();
    assert.equal(page.width, 0, 'the failed build did not keep the shared actor sprites alive');
  } finally {
    delete globalThis.document;
  }
});

test('tileHash is stable and spreads neighbouring tiles', () => {
  assert.equal(S.tileHash(3, 4), S.tileHash(3, 4));
  const seen = new Set();
  for (let ty = 0; ty < 13; ty++) for (let tx = 0; tx < 15; tx++) seen.add(S.tileHash(tx, ty) % 4);
  assert.equal(seen.size, 4);
});

test('walkFrame cycles through every frame and wraps in both directions', () => {
  const seen = new Set();
  for (let d = 0; d < S.WALK_TILES_PER_CYCLE; d += 0.01) seen.add(S.walkFrame(d));
  assert.equal(seen.size, S.WALK_FRAMES);
  assert.equal(S.walkFrame(0), 0);
  assert.equal(S.walkFrame(S.WALK_TILES_PER_CYCLE * 3), 0);
  for (const d of [-0.01, -5.3, 123.456]) assert.ok(S.walkFrame(d) >= 0 && S.walkFrame(d) < S.WALK_FRAMES);
});

test('a fractional tile size is rounded so tile-sized sprites never leave seams', () => {
  const set = build({ tile: 37.6, theme: 'lava' });
  assert.equal(set.tile, 38);
  assert.equal(set.floorAt(1, 1).w, 38);
  set.dispose();
});

test('disposing in the middle of a time-sliced build still releases the temporary layer canvases', () => {
  for (const pumps of [1, 4, 40, 150]) {
    const made = [];
    const track = (w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; };
    const b = S.startSpriteBuild({ tile: 48, theme: 'lava', createCanvas: track });
    for (let i = 0; i < pumps && !b.pump(0); i++);
    b.set.dispose();
    assert.ok(made.length > 20);
    assert.ok(made.every((c) => c.width === 0 && c.height === 0), `${made.filter((c) => c.width > 0).length} canvases leaked after ${pumps} pumps`);
    assert.equal(b.pump(0), true, 'pumping a disposed build is a no-op');
  }
});

test('two builds of one tile size can be pumped alternately while one of them is abandoned', () => {
  globalThis.document = { createElement: () => fakeCanvas(1, 1) };
  try {
    const a = S.startSpriteBuild({ tile: 22, theme: 'meadow' });
    const b = S.startSpriteBuild({ tile: 22, theme: 'frost' });
    let guard = 0;
    for (let i = 0; !(a.set.ready && b.set.ready) && guard++ < 5000; i++) {
      a.pump(0);
      if (i === 25) a.set.dispose();
      b.pump(0);
    }
    assert.equal(b.set.ready, true);
    assert.ok(b.set.character(0).idle[0].img.width > 0, 'the shared actors survive the abandoned build');
    b.set.dispose();
  } finally {
    delete globalThis.document;
  }
});

test('crate and floor variants do not repeat with a period of four tiles', () => {
  // The old product hash made the variant a function of (tx % 4, ty % 4): a visible wallpaper of star crates.
  const variants = new Map();
  for (let ty = 0; ty < 13; ty++) for (let tx = 0; tx < 15; tx++) {
    const key = `${tx % 4},${ty % 4}`;
    (variants.get(key) ?? variants.set(key, new Set()).get(key)).add(S.tileHash(tx, ty) % 4);
  }
  assert.ok([...variants.values()].filter((v) => v.size >= 2).length >= 12, 'variants depend on more than the low bits of the tile');
  const counts = [0, 0, 0, 0];
  for (let ty = 0; ty < 13; ty++) for (let tx = 0; tx < 15; tx++) counts[S.tileHash(tx, ty) % 4]++;
  assert.ok(counts.every((n) => n > 25 && n < 75), `variants are roughly balanced: ${counts}`);
  assert.equal(S.tileHash(-3, -7), S.tileHash(-3, -7));
  assert.ok(Number.isInteger(S.tileHash(NaN, 1.5)) && S.tileHash(NaN, 1.5) >= 0);
});

test('animation counters and stray indices never make an accessor return undefined', () => {
  const set = build({ tile: 32, theme: 'night' });
  for (const phase of [0, 3, 4, 7, -1, 1.5, NaN, 1e9]) for (const hot of [false, true, undefined]) assert.ok(set.bomb(2, phase, hot).img, `bomb phase ${phase}`);
  for (const owner of [-1, 8, 9, 99, NaN, 2.5]) assert.ok(set.bomb(owner, 0).img, `bomb owner ${owner}`);
  assert.equal(set.bomb(-1, 0), set.bomb(99, 0), 'unknown owners are orphans');
  for (const frame of [0, 3, 4, 9, -1, NaN]) for (const mask of [0, 5, 15, 16, 31, -1]) assert.ok(set.flame(mask, frame).img, `flame ${mask}/${frame}`);
  for (const frame of [0, 2, 3, 10, -4, NaN]) assert.ok(set.softPopAt(4, 5, frame).img, `pop frame ${frame}`);
  assert.equal(set.softPopAt(4, 5, 99), set.softPopAt(4, 5, S.SOFT_POP_FRAMES - 1), 'a finished pop stays on its last frame');
  for (const [tx, ty] of [[-1, -1], [NaN, 0], [1e9, 2.5]]) assert.ok(set.floorAt(tx, ty).img && set.hardWallAt(tx, ty).img && set.softBlockAt(tx, ty).img && set.borderAt(tx, ty).img);
  set.dispose();
});

test('walkFrame survives non-finite distances', () => {
  for (const d of [NaN, Infinity, -Infinity, undefined]) assert.equal(S.walkFrame(d), 0);
});

test('DOM helper sizes are sanitised before a canvas is allocated', () => {
  const made = [];
  globalThis.document = { createElement: () => { const c = fakeCanvas(1, 1); made.push(c); return c; } };
  try {
    assert.match(S.iconDataURL('flame', NaN), /32x32$/, 'NaN falls back to the default size');
    assert.match(S.iconDataURL('flame', 1e9), /1024x1024$/, 'a runaway size is capped');
    assert.match(S.iconDataURL('flame', -20), /32x32$/);
    assert.match(S.iconDataURL('flame', 20.4), /20x20$/);
    assert.equal(S.iconDataURL('flame', 20.4), S.iconDataURL('flame', 20), 'fractional sizes share the cache entry');
    assert.match(S.avatarDataURL(2, 0), /32x32$/);
    assert.ok(made.length >= 4 && made.every((c) => c.width === 0), 'canvases are released after use');
  } finally {
    delete globalThis.document;
  }
});

test('cells are large enough for glows and outlines that used to be cut off (design-unit margins at tile 100)', () => {
  const set = build({ tile: 100, theme: 'meadow' });
  const half = (sp) => Math.min(sp.ax, sp.w - sp.ax, sp.ay, sp.h - sp.ay);
  assert.ok(half(set.shield[0]) >= 63, 'shield bubble outline reaches 59');
  assert.ok(set.curseAura[0].w - set.curseAura[0].ax >= 70 && set.curseAura[0].h - set.curseAura[0].ay >= 52, 'orbiting skulls reach 67 x 50');
  assert.ok(set.teamRing[0].h - set.teamRing[0].ay >= 32 && set.teamRing[0].ay >= 32, 'the soft ring glow is 29.5 tall');
  assert.ok(set.bomb(0, 2, true).h - set.bomb(0, 2, true).ay >= 58, 'the hot glow reaches 55 below the anchor');
  assert.ok(set.character(0).idle[2].h - set.character(0).idle[2].ay >= 49, 'soles plus outline reach 45');
  set.dispose();
});

test('the bomb pulse reuses one sprite for the swell on the way out and on the way back', () => {
  const set = build({ tile: 48, theme: 'meadow' });
  assert.equal(S.BOMB_PULSE[1], S.BOMB_PULSE[3]);
  for (const owner of [-1, 0, 7]) for (const hot of [false, true]) {
    assert.equal(set.bomb(owner, 1, hot), set.bomb(owner, 3, hot));
    assert.notEqual(set.bomb(owner, 0, hot), set.bomb(owner, 1, hot));
  }
  assert.notEqual(set.bomb(0, 1, false), set.bomb(0, 1, true));
  set.dispose();
});

/**
 * A canvas whose pixels are transparent except a block that leaves `m.l`, `m.r`, `m.t`, `m.b` empty pixels around every rectangle read
 * back, and which records the drawImage calls made onto it.
 */
function croppingFactory(m) {
  const made = [];
  const create = (w, h) => {
    const c = { width: w, height: h, copies: [] };
    c.getContext = () => (c.ctx ??= new Proxy({ canvas: c }, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (prop === 'getImageData') {
          return (x, y, rw, rh) => {
            const data = new Uint8ClampedArray(rw * rh * 4);
            for (let j = m.t; j < rh - m.b; j++) for (let i = m.l; i < rw - m.r; i++) data[(j * rw + i) * 4 + 3] = 255;
            return { data, width: rw, height: rh };
          };
        }
        if (prop === 'drawImage') return (...a) => { c.copies.push(a); };
        if (typeof prop === 'string' && prop.startsWith('create')) return () => ({ addColorStop() {} });
        return () => {};
      },
      set(t, prop, v) { t[prop] = v; return true; },
    }));
    made.push(c);
    return c;
  };
  create.made = made;
  return create;
}

test('the actor atlas is compacted: transparent margins are cropped, anchors follow, and only the crop is copied', () => {
  const margins = { l: 1, r: 2, t: 1, b: 2 };
  const plain = S.buildSpriteSet({ tile: 48, theme: 'meadow', createCanvas: fakeCanvas });          // cannot be read back: cells stay whole
  const factory = croppingFactory(margins);
  const cropped = S.buildSpriteSet({ tile: 48, theme: 'meadow', createCanvas: factory });
  for (const [a, b] of [[plain.character(2).walk[1][3], cropped.character(2).walk[1][3]], [plain.flame(5, 1), cropped.flame(5, 1)], [plain.item('bomb'), cropped.item('bomb')],
    [plain.fx.smoke[1], cropped.fx.smoke[1]], [plain.shield[2], cropped.shield[2]], [plain.bomb(0, 2, true), cropped.bomb(0, 2, true)]]) {
    assert.equal(b.w, a.w - margins.l - margins.r);
    assert.equal(b.h, a.h - margins.t - margins.b);
    assert.equal(b.ax, a.ax - margins.l);
    assert.equal(b.ay, a.ay - margins.t);
    assert.ok(b.x + b.w <= b.img.width && b.y + b.h <= b.img.height, 'inside its (new) page');
    assert.ok(b.img.width > 0, 'points at a live page');
  }
  assert.ok(cropped.pixels < plain.pixels * 0.95, `${cropped.pixels} px after cropping vs ${plain.pixels} px before`);
  // the terrain is opaque tiles and is not compacted
  assert.equal(cropped.floorAt(2, 2).w, plain.floorAt(2, 2).w);
  // every copy is a 1:1 blit of the visible rectangle, never a scaled one
  const copies = factory.made.flatMap((c) => c.copies).filter((a) => a.length === 9);
  assert.ok(copies.length > 500);
  assert.ok(copies.every((a) => a[3] === a[7] && a[4] === a[8]));
  cropped.dispose();
  plain.dispose();
  assert.ok(factory.made.every((c) => c.width === 0), 'old and new pages are all released');
});

test('a set can be disposed in the middle of its compaction without leaking a canvas', () => {
  const factory = croppingFactory({ l: 1, r: 1, t: 1, b: 1 });
  const build1 = S.startSpriteBuild({ tile: 32, theme: 'lava', createCanvas: factory });
  let guard = 0;
  while (!build1.set.ready && guard++ < 100000) {
    build1.pump(0);
    if (factory.made.some((c) => c.copies.length > 0)) break;   // some sprites moved, the rest have not
  }
  assert.equal(build1.set.ready, false);
  build1.set.dispose();
  assert.ok(factory.made.every((c) => c.width === 0 && c.height === 0));
});

test('set.pages lists the canvases sprites are drawn from', () => {
  const set = build({ tile: 40, theme: 'night' });
  const pages = set.pages;
  assert.ok(pages.length >= 2 && new Set(pages).size === pages.length);
  for (const sp of collectSprites(set)) assert.ok(pages.includes(sp.img), 'every sprite page is listed');
  assert.ok(pages.includes(set.backdrop.canvas));
  set.dispose();
  assert.deepEqual(set.pages, []);
});

/** A canvas factory whose contexts count save/restore pairs and 1 x 1 reads, and whose fillStyle assignments can be made to throw for chosen canvases. */
function countingFactory() {
  const stats = { saves: 0, restores: 0, tinyReads: 0, throwOn: null, thrown: 0 };
  const create = (w, h) => {
    const c = { width: w, height: h };
    c.getContext = () => (c.ctx ??= new Proxy({ canvas: c }, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (prop === 'save') return () => { stats.saves++; };
        if (prop === 'restore') return () => { stats.restores++; };
        if (prop === 'getImageData') return (x, y, rw, rh) => { if (rw === 1 && rh === 1) stats.tinyReads++; return { data: new Uint8ClampedArray(rw * rh * 4).fill(255), width: rw, height: rh }; };
        if (typeof prop === 'string' && prop.startsWith('create')) return () => ({ addColorStop() {} });
        return () => {};
      },
      set(t, prop, v) { if (stats.throwOn && prop === 'fillStyle' && stats.throwOn(c)) { stats.thrown++; throw new Error('boom'); } t[prop] = v; return true; },
    }));
    return c;
  };
  create.stats = stats;
  return create;
}

test('pages are rasterised regularly while drawing, so one pump slice never pays for a whole page', () => {
  const factory = countingFactory();
  const set = S.buildSpriteSet({ tile: 32, theme: 'meadow', createCanvas: factory });
  assert.ok(factory.stats.tinyReads > 80, `${factory.stats.tinyReads} forced rasterisations`);
  set.dispose();
});

test('a sprite whose drawing throws does not corrupt the sprites after it, and the build still finishes', () => {
  const factory = countingFactory();
  let n = 0;
  factory.stats.throwOn = (canvas) => canvas.width >= 300 && ++n === 400;   // one failure in the vector drawing of an atlas page (not in a scratch layer)
  const b = S.startSpriteBuild({ tile: 32, theme: 'meadow', createCanvas: factory });
  let failures = 0, guard = 0;
  while (guard++ < 10000) {
    try { if (b.pump(0)) break; } catch (err) { assert.equal(err.message, 'boom'); failures++; }
  }
  assert.equal(failures, 1);
  assert.equal(b.set.ready, true);
  assert.equal(factory.stats.saves, factory.stats.restores, 'every save has its restore, even for the sprite that threw');
  b.set.dispose();
});

test('running out of canvases while a set is laid out gives back the pages already allocated', () => {
  for (const failAt of [0, 1, 2]) {   // the actor atlas takes two pages at this size and the terrain one, so each of these fails inside a seal()
    const made = [];
    const scarce = (w, h) => { if (made.length >= failAt) throw new Error('out of canvas memory'); const c = fakeCanvas(w, h); made.push(c); return c; };
    assert.throws(() => S.startSpriteBuild({ tile: 64, theme: 'candy', createCanvas: scarce }), /out of canvas memory/);
    assert.ok(made.every((c) => c.width === 0 && c.height === 0), `${made.filter((c) => c.width > 0).length} of ${made.length} canvases leaked (failing at ${failAt})`);
  }
});
