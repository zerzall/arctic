// Sheet 'paint': graffiti. Survivor messages in spray paint (HAVEN →, DON'T GO IN, DEAD INSIDE, JUNE
// WAS HERE, HELP 4 ALIVE ...), tags and throw-ups of the old street crews, tally marks, arrows, X marks
// and search codes on cleared doors, and the army's stencils (QUARANTINE ZONE, MILITARY ZONE, NO
// ENTRY, DECON). Clean and worn (faded, flaked) variants.

import { textMask, spray, drips, fitSize, C, hex, mix3, mul3, fbm, hash2, smoothstep, clamp01, weather, age, arrowPoly, biohazard } from './kit.js';
import { measure } from './font.js';

const S = 'paint';

/** A spray-painted message centred in the canvas (one or two lines). */
function message(c, rng, lines, col, o = {}) {
  const { w, h } = c;
  const n = lines.length;
  const lh = (h * (o.fill ?? 0.78)) / n;
  const all = c.mask();
  lines.forEach((str, i) => {
    const size = Math.min(lh * 0.82, fitSize(str, w * 0.86, lh * 0.82, 1.1));
    const y = (h - lh * n) / 2 + i * lh + (lh - size) / 2 + (o.drop ? -h * 0.06 : 0);
    textMask(c, str, w / 2 + rng.range(-w, w) * 0.015, y, size, o.style || 'spray', { align: 'center', rng, into: all, slant: o.slant, weight: o.weight });
  });
  if (o.under) {
    const y = h * 0.5 + lh * n * 0.42 + (o.drop ? -h * 0.06 : 0);
    all.stroke([[w * 0.12, y + rng.range(-4, 4)], [w * 0.5, y + rng.range(2, 8)], [w * 0.86, y - rng.range(2, 10)]], (t) => lh * 0.07 * (1 - t * 0.6));
  }
  all.warp(Math.max(1, w / 450), 0.03, rng.seed());
  spray(c, all, col, { rng, drips: o.drips ?? 6, dripLen: o.dripLen ?? 0.22, soft: o.soft ?? Math.max(1, w / 700), over: o.over ?? 0.3, alpha: o.alpha ?? 0.95 });
  return all;
}

const finish = (c, rng, v) => { if (v === 'worn') { weather(c, 0.55, rng, 0.006); age(c, 2, rng, { kind: 'paint' }); c.fade(0.85); } };

/** Bubble letters: drop shadow, outline, fill, highlight. */
function throwUp(c, rng, str, fillCol, lineCol, o = {}) {
  const { w, h } = c;
  const size = fitSize(str, w * 0.7, h * 0.52, 1.6);
  const x = w / 2, y = (h - size) / 2;
  const L = { align: 'center', rng, raw: true, gap: 1.6, slant: o.slant ?? 0.12, wave: size * 0.05 };
  const fat = textMask(c, str, x, y, size, 'sign', { ...L, weight: 0.36 }).blur(size * 0.05).thresh(0.4, 0.1).warp(size * 0.03, 0.01, rng.seed());
  const outline = textMask(c, str, x, y, size, 'sign', { ...L, weight: 0.52 }).blur(size * 0.05).thresh(0.35, 0.1).warp(size * 0.03, 0.01, rng.seed());
  const off = Math.round(size * 0.07);
  const shadow = outline.shifted(off, off);
  spray(c, shadow, o.shadow || mul3(lineCol, 0.5), { rng, over: 0.15, soft: 1.5 });
  spray(c, outline, lineCol, { rng, over: 0.25, soft: 1.2 });
  // the fill: a two-tone fade
  const fillFn = (px, py) => mix3(fillCol, o.fill2 || mul3(fillCol, 0.72), clamp01((py - y) / size + (fbm(px * 0.01, py * 0.01, 2, 3) - 0.5) * 0.4));
  c.paint(fat.clone().blur(1), fillFn, 0.97, { rough: 0.5 });
  // highlight on the upper-left of each letter
  const k = Math.round(size * 0.06);
  const band = fat.clone().cut(fat.shifted(-k, -k).grow(-2)).min(fat.shifted(k * 0.5 | 0, k * 0.5 | 0));
  c.paint(band.blur(1.5), [1, 1, 1], 0.55);
  // a few shine flecks
  for (let i = 0; i < str.length; i++) {
    if (!rng.chance(0.6)) continue;
    const sx = x - (measure(str, 1.6) * size / 6) / 2 + (i + 0.25) * (measure(str, 1.6) * size / 6) / str.length;
    const m = c.mask().capsule(sx, y + size * 0.2, sx + size * 0.1, y + size * 0.12, size * 0.022);
    c.paint(m.min(fat).blur(0.8), [1, 1, 1], 0.75);
  }
  if (o.drips) drips(c, outline, lineCol, o.drips, { rng, dripLen: 0.2 });
}

/** A marker / spray tag: slanted, connected, with a flourish. */
function tag(c, rng, str, col, o = {}) {
  const { w, h } = c;
  const size = fitSize(str, w * 0.72, h * 0.55, 0.3);
  const m = textMask(c, str, w / 2, h * 0.5 - size * 0.55, size, o.style || 'marker', { align: 'center', rng, gap: 0.3, slant: o.slant ?? 0.32, weight: o.weight ?? 0.11, vary: 0.3, wave: size * 0.08 });
  // the swoosh under it, ending in an arrow or a star
  const y0 = h * 0.5 + size * 0.55;
  const pts = [];
  for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push([w * (0.14 + t * 0.74), y0 + Math.sin(t * Math.PI * 1.2 + 0.4) * size * 0.12 - t * size * 0.1]); }
  m.stroke(pts, (t) => size * (o.weight ?? 0.11) * (1 - t * 0.7));
  const [ex, ey] = pts[pts.length - 1];
  if (o.crown) {
    const cx = w * 0.3, cy = h * 0.5 - size * 0.75;
    m.stroke([[cx - size * 0.25, cy + size * 0.15], [cx - size * 0.28, cy - size * 0.15], [cx - size * 0.1, cy], [cx, cy - size * 0.22], [cx + size * 0.1, cy], [cx + size * 0.28, cy - size * 0.15], [cx + size * 0.25, cy + size * 0.15], [cx - size * 0.25, cy + size * 0.15]], size * 0.05);
  } else {
    m.stroke([[ex - size * 0.18, ey - size * 0.12], [ex, ey], [ex - size * 0.14, ey + size * 0.15]], size * 0.07);
  }
  for (let i = 0; i < 3; i++) m.circle(w * rng.range(0.15, 0.85), h * rng.range(0.15, 0.3), size * 0.035);
  if (o.outline) {
    const out = m.clone().blur(size * 0.05).thresh(0.08, 0.05);
    spray(c, out, o.outline, { rng, over: 0.2, soft: 1 });
  }
  spray(c, m, col, { rng, over: o.over ?? 0.12, soft: 0.8, drips: o.drips ?? 2, dripLen: 0.15, alpha: 0.96 });
}

/** A stencilled word block: a frame, bridged letters, overspray around the cut card. */
function stencil(c, rng, lines, col, o = {}) {
  const { w, h } = c;
  const all = c.mask();
  const n = lines.length;
  const top = o.top ?? 0.12, bottom = o.bottom ?? 0.88;
  const lh = ((bottom - top) * h) / n;
  lines.forEach((str, i) => {
    const size = Math.min(lh * 0.72, fitSize(str, w * 0.84, lh * 0.72, 1.5));
    textMask(c, str, w / 2, top * h + i * lh + (lh - size) / 2, size, 'stencil', { align: 'center', rng, into: all });
  });
  if (o.frame) {
    const fr = c.mask().rect(w / 2, h / 2, w * 0.94, h * 0.9, 2).cut(c.mask().rect(w / 2, h / 2, w * 0.94 - h * 0.06, h * 0.9 - h * 0.06, 2));
    // stencil frames have bridges too
    fr.cut(c.mask().rect(w / 2, h / 2, w * 0.05, h, 0)).cut(c.mask().rect(w / 2, h / 2, w, h * 0.06, 0));
    all.max(fr);
  }
  // the card's overspray: a faint rectangle of mist around the letters
  const card = c.mask().rect(w / 2, h / 2, w * 0.98, h * 0.96, 4).blur(6);
  card.mulBy((x, y) => 0.2 * (hash2(x, y, 5) > 0.55 ? 1 : 0.3) * fbm(x * 0.02, y * 0.02, 2, 9));
  c.paint(card, col, 0.5);
  spray(c, all, col, { rng, over: 0.18, soft: 0.9, drips: o.drips ?? 2, dripLen: 0.1, alpha: 0.94 });
  return all;
}

export function register(R) {
  // ---- survivor messages --------------------------------------------------------------------
  const MSG = [
    ['gfx.haven-r', ['HAVEN →'], C.white, { under: false, drips: 7 }, [736, 256], [64, 22]],
    ['gfx.haven-l', ['← HAVEN'], C.white, { drips: 7 }, [736, 256], [64, 22]],
    ['gfx.haven-red', ['HAVEN', 'WEST →'], C.sprayRed, { drips: 9 }, [560, 368], [48, 32]],
    ['gfx.dontgoin', ["DON'T", 'GO IN'], C.sprayRed, { drips: 12, dripLen: 0.3 }, [560, 464], [42, 35]],
    ['gfx.deadinside', ["DON'T OPEN", 'DEAD INSIDE'], C.sprayRed, { drips: 10 }, [736, 464], [56, 35]],
    ['gfx.help4alive', ['HELP', '4 ALIVE'], C.white, { drips: 6, weight: 0.2 }, [736, 560], [80, 60]],
    ['gfx.notsafe', ['NOT SAFE'], C.black, { drips: 8, under: true }, [736, 256], [60, 21]],
    ['gfx.theyhear', ['THEY HEAR', 'YOU'], C.sprayRed, { drips: 6 }, [560, 368], [44, 29]],
    ['gfx.headshots', ['AIM FOR', 'THE HEAD'], C.black, { drips: 5 }, [560, 368], [44, 29]],
    ['gfx.nowayout', ['NO WAY OUT'], C.sprayRed, { drips: 9 }, [736, 224], [60, 19]],
    ['gfx.stayout', ['STAY OUT'], C.white, { drips: 7, under: true }, [736, 256], [56, 19]],
    ['gfx.bitten', ['BITTEN =', 'SHOT'], C.black, { drips: 5 }, [560, 368], [40, 27]],
    ['gfx.repent', ['REPENT', 'THE END IS HERE'], hex('#e8e2d0'), { drips: 8 }, [736, 464], [60, 37]],
    ['gfx.radio', ['RADIO 96.4', 'HAVEN CALLING'], hex('#2a6fd6'), { drips: 5 }, [736, 368], [52, 26]],
    ['gfx.water', ['WATER', 'INSIDE ↓'], hex('#2a6fd6'), { drips: 4 }, [464, 368], [32, 26]],
    ['gfx.mara', ['MARA', 'WE WENT UP'], C.sprayRed, { drips: 6, style: 'marker', weight: 0.12 }, [560, 368], [36, 24]],
    ['gfx.godleft', ['GOD LEFT', 'TOWN'], C.black, { drips: 7 }, [560, 368], [44, 29]],
    ['gfx.doa', ['3 BITTEN', 'INSIDE'], C.sprayRed, { drips: 6 }, [560, 368], [40, 27]],
  ];
  for (const [id, lines, col, o, px, size] of MSG) {
    R(id, { sheet: S, px, size, surf: 'wall', tags: ['graffiti', 'message'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      message(c, rng, lines, col, o);
      finish(c, rng, v);
    });
  }
  // JUNE WAS HERE: a kid's marker, a heart and a little house
  R('gfx.june', { sheet: S, px: [640, 384], size: [36, 21.6], surf: 'wall', tags: ['graffiti', 'message', 'june'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = textMask(c, 'JUNE WAS', w * 0.06, h * 0.12, h * 0.26, 'marker', { rng, slant: 0.04, weight: 0.13, vary: 0.25, wave: 3 });
    textMask(c, 'HERE', w * 0.12, h * 0.48, h * 0.26, 'marker', { rng, into: m, slant: 0.04, weight: 0.13, vary: 0.25, wave: 3 });
    // heart
    const hx = w * 0.72, hy = h * 0.6, s = h * 0.17;
    const heart = [];
    for (let k = 0; k <= 30; k++) { const t = (k / 30) * Math.PI * 2; heart.push([hx + s * 16 * Math.sin(t) ** 3 / 16, hy - s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16]); }
    m.stroke(heart, h * 0.03);
    // a house with a sun
    const bx = w * 0.82, by = h * 0.22;
    m.stroke([[bx - 25, by + 30], [bx - 25, by], [bx, by - 22], [bx + 25, by], [bx + 25, by + 30], [bx - 25, by + 30]], h * 0.022);
    m.circle(bx - 60, by - 15, 9);
    c.paint(m.blur(0.6), hex('#c2398f'), 0.95, { rough: 0.45 });
    finish(c, rng, v);
  });

  // ---- tags and throw-ups --------------------------------------------------------------------
  const TAGS = [
    ['gfx.tag-kraz', 'KRAZ', C.black, { crown: true }],
    ['gfx.tag-soke', 'SOKE', hex('#c8ccd2'), { outline: C.black }],
    ['gfx.tag-vandl', 'VANDL', hex('#2b55c9'), {}],
    ['gfx.tag-rust', 'RUST', C.sprayRed, { style: 'spray', weight: 0.13 }],
    ['gfx.tag-moe', 'MOE 99', C.black, { crown: true, slant: 0.2 }],
    ['gfx.tag-zek', 'ZEK', hex('#1c9a4a'), { outline: hex('#101010') }],
  ];
  for (const [id, str, col, o] of TAGS) {
    R(id, { sheet: S, px: [560, 288], size: [40, 20], surf: 'wall', tags: ['graffiti', 'tag'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      tag(c, rng, str, col, o);
      finish(c, rng, v);
    });
  }
  const THROW = [
    ['gfx.throw-doom', 'DOOM', hex('#d9dde2'), C.black, { fill2: hex('#9aa2ac') }],
    ['gfx.throw-okr', 'OKR', hex('#f05aa0'), hex('#1b2a8a'), { fill2: hex('#ff9fcb'), drips: 4 }],
    ['gfx.throw-skul', 'SKUL', hex('#f2c315'), hex('#141414'), { fill2: hex('#e07a10') }],
  ];
  for (const [id, str, fill, line, o] of THROW) {
    R(id, { sheet: S, px: [736, 368], size: [76, 38], surf: 'wall', tags: ['graffiti', 'throwup'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      throwUp(c, rng, str, fill, line, o);
      finish(c, rng, v);
    });
  }

  // ---- tallies, arrows, X marks ------------------------------------------------------------
  R('gfx.tally', { sheet: S, px: [512, 256], size: [30, 15], surf: 'wall', tags: ['graffiti', 'mark', 'tally'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = c.mask();
    let x = w * 0.06;
    const groups = 5 + (rng.int(0, 2));
    for (let g = 0; g < groups && x < w * 0.88; g++) {
      const n = g === groups - 1 ? rng.int(1, 4) : 5;
      const y0 = h * 0.2 + rng.range(-4, 4), y1 = h * 0.78 + rng.range(-4, 4);
      for (let k = 0; k < Math.min(4, n); k++) m.stroke([[x + k * 13 + rng.range(-2, 2), y0], [x + k * 13 + rng.range(-3, 3), y1]], 4.5);
      if (n === 5) m.stroke([[x - 8, y1 - 8], [x + 52, y0 + 10]], 4.5);
      x += 76;
    }
    c.paint(m.blur(0.5), C.black, 0.9);
    finish(c, rng, v);
  });
  R('gfx.tally-days', { sheet: S, px: [512, 384], size: [26, 20], surf: 'wall', tags: ['graffiti', 'mark', 'tally'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = textMask(c, 'DAYS', w * 0.08, h * 0.06, h * 0.2, 'marker', { rng, weight: 0.12 });
    let x = w * 0.08, y = h * 0.42;
    for (let g = 0; g < 9; g++) {
      for (let k = 0; k < 4; k++) m.stroke([[x + k * 11, y], [x + k * 11 + rng.range(-2, 2), y + h * 0.2]], 3.6);
      m.stroke([[x - 6, y + h * 0.17], [x + 42, y + h * 0.03]], 3.6);
      x += 66;
      if (x > w * 0.84) { x = w * 0.08; y += h * 0.28; }
    }
    c.paint(m.blur(0.4), hex('#2a2620'), 0.85);
    finish(c, rng, v);
  });
  const ARROWS = [
    ['gfx.arrow-white', C.white, 'straight'], ['gfx.arrow-red', C.sprayRed, 'straight'], ['gfx.arrow-bent', C.white, 'bent'], ['gfx.arrow-orange', C.orange, 'straight'],
  ];
  for (const [id, col, kind] of ARROWS) {
    R(id, { sheet: S, px: [480, 240], size: [36, 18], surf: 'any', tags: ['graffiti', 'arrow'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      const { w, h } = c;
      const m = c.mask();
      if (kind === 'bent') {
        m.stroke([[w * 0.08, h * 0.82], [w * 0.5, h * 0.8], [w * 0.62, h * 0.45], [w * 0.8, h * 0.42]], h * 0.13);
        m.poly([[w * 0.74, h * 0.16], [w * 0.95, h * 0.42], [w * 0.74, h * 0.68]]);
      } else {
        const pts = [];
        for (let k = 0; k <= 8; k++) pts.push([w * (0.06 + 0.68 * k / 8), h * 0.5 + Math.sin(k * 0.8) * 3]);
        m.stroke(pts, (t) => h * (0.14 - t * 0.02));
        m.poly([[w * 0.68, h * 0.12], [w * 0.95, h * 0.5], [w * 0.68, h * 0.88]]);
      }
      spray(c, m, col, { rng, drips: 4, dripLen: 0.25, soft: 1.2 });
      finish(c, rng, v);
    });
  }
  R('gfx.x-red', { sheet: S, px: [384, 384], size: [30, 30], surf: 'any', tags: ['graffiti', 'mark', 'x'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = c.mask();
    m.stroke([[w * 0.12, h * 0.1], [w * 0.5, h * 0.52], [w * 0.88, h * 0.9]], (t) => w * (0.085 - t * 0.02));
    m.stroke([[w * 0.86, h * 0.12], [w * 0.48, h * 0.5], [w * 0.14, h * 0.9]], (t) => w * (0.08 - t * 0.02));
    spray(c, m, C.sprayRed, { rng, drips: 7, dripLen: 0.12, soft: 1.3 });
    finish(c, rng, v);
  });
  // the search code on a cleared door: an X with the date (top), team (left), hazards (right) and
  // the count of the dead (bottom), in orange spray
  const CODES = [
    ['gfx.xcode-1', '9/14', 'HV2', 'NONE', '0', C.orange],
    ['gfx.xcode-2', '9/16', 'NG4', 'BIO', '3', C.sprayRed],
    ['gfx.xcode-3', '9/21', 'HV1', 'DOGS', '2 DOA', C.orange],
    ['gfx.xcode-4', '9/12', 'ARMY', 'GAS', '11', hex('#e8e2d0')],
  ];
  for (const [id, top, left, right, bottom, col] of CODES) {
    R(id, { sheet: S, px: [416, 416], size: [32, 32], surf: 'wall', tags: ['graffiti', 'mark', 'xcode'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      const { w, h } = c;
      const m = c.mask();
      m.stroke([[w * 0.1, h * 0.1], [w * 0.9, h * 0.9]], w * 0.035);
      m.stroke([[w * 0.9, h * 0.1], [w * 0.1, h * 0.9]], w * 0.035);
      const s = h * 0.1;
      textMask(c, top, w / 2, h * 0.12, s, 'spray', { align: 'center', rng, into: m });
      textMask(c, bottom, w / 2, h * 0.74, s, 'spray', { align: 'center', rng, into: m });
      textMask(c, left, w * 0.2, h * 0.45, fitSize(left, w * 0.26, s), 'spray', { align: 'center', rng, into: m });
      textMask(c, right, w * 0.8, h * 0.45, fitSize(right, w * 0.26, s), 'spray', { align: 'center', rng, into: m });
      spray(c, m, col, { rng, drips: 4, dripLen: 0.08, soft: 1 });
      finish(c, rng, v);
    });
  }
  // a skull, a red cross (medical help here / dead inside), the safe-house sign (circle, dot), a
  // little house with an arrow (the Haven mark the survivors use)
  R('gfx.skull', { sheet: S, px: [384, 384], size: [26, 26], surf: 'wall', tags: ['graffiti', 'symbol'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = c.mask().ellipse(w / 2, h * 0.4, w * 0.3, h * 0.28).rect(w / 2, h * 0.62, w * 0.32, h * 0.2, 12);
    const cut = c.mask().ellipse(w * 0.39, h * 0.42, w * 0.08, h * 0.09).ellipse(w * 0.61, h * 0.42, w * 0.08, h * 0.09).poly([[w * 0.5, h * 0.5], [w * 0.46, h * 0.58], [w * 0.54, h * 0.58]]);
    for (let k = -2; k <= 2; k++) cut.rect(w / 2 + k * w * 0.06, h * 0.69, w * 0.018, h * 0.12, 1);
    m.cut(cut);
    // crossbones
    const b = c.mask();
    b.capsule(w * 0.15, h * 0.75, w * 0.85, h * 0.95, w * 0.035).capsule(w * 0.85, h * 0.75, w * 0.15, h * 0.95, w * 0.035);
    for (const [x, y] of [[0.15, 0.75], [0.85, 0.95], [0.85, 0.75], [0.15, 0.95]]) b.circle(w * x, h * y, w * 0.05);
    b.cut(c.mask().ellipse(w / 2, h * 0.6, w * 0.2, h * 0.2));
    m.max(b);
    spray(c, m, C.black, { rng, drips: 3, dripLen: 0.1, soft: 1.4 });
    finish(c, rng, v);
  });
  R('gfx.redcross', { sheet: S, px: [384, 384], size: [22, 22], surf: 'wall', tags: ['graffiti', 'symbol', 'medical'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = c.mask().rect(w / 2, h / 2, w * 0.24, h * 0.78, 3).rect(w / 2, h / 2, w * 0.78, h * 0.24, 3);
    spray(c, m, C.sprayRed, { rng, drips: 5, dripLen: 0.12, soft: 1.5 });
    finish(c, rng, v);
  });
  R('gfx.safe-mark', { sheet: S, px: [384, 384], size: [18, 18], surf: 'wall', tags: ['graffiti', 'symbol'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = c.mask();
    const pts = [];
    for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2 + 0.3; pts.push([w / 2 + Math.cos(a) * w * (0.36 + rng.range(-0.01, 0.01)), h / 2 + Math.sin(a) * h * 0.36]); }
    m.stroke(pts, w * 0.05);
    m.circle(w / 2, h / 2, w * 0.07);
    textMask(c, 'OK', w * 0.76, h * 0.78, h * 0.13, 'marker', { rng, into: m });
    c.paint(m.blur(0.5), hex('#e9e4d6'), 0.92);
    finish(c, rng, v);
  });
  R('gfx.haven-mark', { sheet: S, px: [512, 384], size: [26, 20], surf: 'wall', tags: ['graffiti', 'symbol', 'haven'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const m = c.mask();
    const bx = w * 0.28, by = h * 0.55, s = h * 0.28;
    m.stroke([[bx - s, by + s], [bx - s, by - s * 0.2], [bx, by - s * 1.1], [bx + s, by - s * 0.2], [bx + s, by + s], [bx - s, by + s]], w * 0.03);
    m.rect(bx, by + s * 0.55, s * 0.5, s * 0.9, 2);
    m.poly(arrowPoly(w * 0.5, by, w * 0.94, by, h * 0.09, h * 0.3, w * 0.12));
    textMask(c, 'HAVEN', w * 0.5, h * 0.08, h * 0.17, 'spray', { rng, into: m });
    spray(c, m, hex('#3bb24a'), { rng, drips: 4, dripLen: 0.15, soft: 1.1 });
    finish(c, rng, v);
  });

  // ---- army stencils ---------------------------------------------------------------------------
  R('stn.quarantine', { sheet: S, px: [768, 384], size: [70, 35], surf: 'wall', tags: ['stencil', 'military', 'quarantine'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    const bio = biohazard(c, w * 0.15, h * 0.5, h * 0.36);
    c.paint(bio.clone().blur(0.8), hex('#d8451c'), 0.95);
    const all = c.mask();
    const qs = fitSize('QUARANTINE', w * 0.62, h * 0.26, 1.5);
    textMask(c, 'QUARANTINE', w * 0.64, h * 0.5 - qs * 1.15, qs, 'stencil', { align: 'center', rng, into: all });
    textMask(c, 'ZONE', w * 0.64, h * 0.5 + qs * 0.15, qs * 1.1, 'stencil', { align: 'center', rng, into: all });
    spray(c, all, hex('#d8451c'), { rng, over: 0.2, soft: 0.9, drips: 3, dripLen: 0.1 });
    finish(c, rng, v);
  });
  const STN = [
    ['stn.military', ['MILITARY ZONE', 'NO TRESPASSING'], hex('#e9e4d6'), [736, 272], [68, 25], { frame: true }],
    ['stn.noentry', ['NO ENTRY'], hex('#e9e4d6'), [560, 192], [44, 15], {}],
    ['stn.decon', ['DECON →'], hex('#f2c315'), [560, 192], [40, 13], {}],
    ['stn.zone4', ['ZONE 4'], hex('#e9e4d6'), [464, 192], [34, 14], {}],
    ['stn.cleared', ['AREA', 'CLEARED'], hex('#3a3a36'), [464, 272], [34, 20], {}],
    ['stn.hangar2', ['HANGAR 2'], hex('#f2c315'), [736, 192], [84, 21], {}],
    ['stn.b12', ['B-12'], hex('#e9e4d6'), [368, 192], [26, 13], {}],
    ['stn.keepout', ['KEEP OUT', 'BY ORDER OF THE', 'NATIONAL GUARD'], hex('#101012'), [560, 368], [40, 27], { frame: true }],
    ['stn.dead', ['DEAD', 'INSIDE'], hex('#101012'), [464, 272], [34, 20], {}],
    ['stn.track', ['DANGER', 'LIVE TRACK'], hex('#f2c315'), [560, 272], [40, 20], {}],
  ];
  for (const [id, lines, col, px, size, o] of STN) {
    R(id, { sheet: S, px, size, surf: 'wall', tags: ['stencil', 'military'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      stencil(c, rng, lines, col, o);
      finish(c, rng, v);
    });
  }
}
