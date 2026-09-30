// Buildings of the static world (WORLD, SPEC §7.5). Each building obstacle becomes one of
// several architectural archetypes, chosen from its size, colours and id:
//   shops       a shop-front row: display windows with interior-mapped shops behind them,
//               painted signs, striped awnings, a cornice, upper storeys of recessed windows
//   apartment   taller brick block: string courses, corner pilasters, fire escape, window
//               air-conditioners, a water tank on the roof
//   house       siding, a porch with columns, shuttered windows, a gable shingle roof with a
//               chimney and dormers
//   shack       a plank hut with a lean-to tin roof
//   barn        red gambrel barn with big X-braced doors, a hayloft door and a cupola
//   church      a nave with tall windows, a belfry over the porch
//   steeple     a bell tower with a spire (an explicit-height building)
//   motel       two storeys around an open walkway with railings and numbered doors
//   industrial  corrugated hall with roll-up doors, a loading dock, a ribbed metal roof
// Walls are skins of quads around real openings (world-arch.js): every window is recessed
// and framed, with a room behind the pane. Plus the diner (the truck stop objective) with
// its glowing neon, and the radio mast.

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { trashBags } from './world-props.js';
import {
  Face, DETAIL, skinBand, windowUnit, doorUnit, awning, signBoard, shutter, cornice, downspout, conduit, railing, balcony,
  fireEscape, acUnit, ventStack, waterTank, antenna, dish, hatch, chimney, roomId,
} from './world-arch.js';

const CHROME = '#c9ced3';

/** Canonical height of a building obstacle (150–260). */
export function buildingHeight(o) {
  // an explicit height (a church tower)
  if (Number.isFinite(o.top)) return o.top;
  const small = Math.max(o.w, o.h) < 170;
  if (small) return 150 + Math.round(hash01(o.id * 7 + 1) * 20);
  const area = Math.min(1, (o.w * o.h) / 60000);
  return Math.round(150 + area * 70 + hash01(o.id * 13 + 5) * 40);
}

const TRIMS = ['#d9d2bf', '#e6e2d6', '#c9c0a8', '#d9d2bf', '#a8a294', '#3a2a1c', '#2f4a3a', '#5a5e62', '#7a2a22'];
const DOORS = ['#2a1e16', '#5a2a1e', '#1f3a4a', '#3a4a2a', '#6a4a22', '#2a2a30', '#7a1f1a'];
const AWNINGS = [['#b3261e', '#eee6d6'], ['#1d4a7a', '#eee6d6'], ['#2f5a3a', '#e8dcc0'], ['#8a5a1e', '#e8dcc0'], ['#5a2a6a', '#eee6d6'], ['#25272a', '#d9d2bf']];
const SHOPFRONTS = ['#5a2a22', '#22344a', '#2f4a3a', '#242424', '#d9d2bf', '#1f4a4a', '#6a4a22'];
const FRAMES = ['#2a2622', '#e8e2d4', '#1d2a3a', '#3a4a3a', '#5a5e62'];

function archetypeOf(o, L, W, H) {
  if (o.arch) return o.arch;   // (a story hideout names its buildings' archetype)
  if (Number.isFinite(o.top) && o.top > 250) return 'steeple';
  const c = new THREE.Color(o.color);
  const big = Math.max(L, W);
  const h = hash01(o.id * 29 + 3);
  if (c.r > 0.12 && c.r > c.g * 3 && big >= 120) return 'barn';
  if (o.color === '#c9c2b2' && big >= 200) return 'church';
  if (big >= 380 && Math.min(L, W) <= 130) return 'motel';
  if (o.roof === '#4f5a60' || (big >= 300 && h < 0.5)) return 'industrial';
  if (big < 170) return big < 125 && h < 0.5 ? 'shack' : 'house';
  if (H >= 205 && big < 300) return 'apartment';
  return 'shops';
}

/** Wall material by archetype: [detail layer, roughness, metalness]. */
function wallSurface(arch, o) {
  const h = hash01(o.id * 29 + 3);
  switch (arch) {
    case 'industrial': return [DET.corrugated, 0.55, 0.5];
    case 'barn': return [DET.siding, 0.9, 0];
    case 'house': case 'shack': return h < 0.55 ? [DET.siding, 0.88, 0] : [DET.plaster, 0.85, 0];
    case 'church': case 'steeple': return [DET.plaster, 0.85, 0];
    case 'motel': return h < 0.5 ? [DET.plaster, 0.85, 0] : [DET.brick, 0.88, 0];
    case 'apartment': return [DET.brick, 0.88, 0];
    default: return h < 0.4 ? [DET.brick, 0.88, 0] : h < 0.7 ? [DET.plaster, 0.85, 0] : [DET.concrete, 0.88, 0];
  }
}

/**
 * A building obstacle.
 * @param {object} B builder (object frame placed)
 * @param {object} o obstacle
 * @param {object} [sign] { cell, color } a neon sign for its roof
 */
export function building(B, o, L, W, sign) {
  const H = buildingHeight(o);
  const arch = archetypeOf(o, L, W, H);
  const ctx = makeCtx(B, o, L, W, H, arch);
  switch (arch) {
    case 'steeple': steepleTower(B, o, ctx); break;
    case 'barn': barn(B, o, ctx); break;
    case 'church': church(B, o, ctx); break;
    case 'house': case 'shack': house(B, o, ctx); break;
    case 'motel': motel(B, o, ctx, sign); break;
    case 'industrial': industrial(B, o, ctx); break;
    default: shopsOrApartment(B, o, ctx, sign);
  }
  // a raised sidewalk apron along the front (paving slabs with a curb lip), and a step out at the back
  if (DETAIL.level >= 1 && (arch === 'shops' || arch === 'apartment' || arch === 'motel' || arch === 'industrial' || arch === 'church')) {
    const fr = arch === 'church' ? (L >= W ? { x: 1, len: W, half: L / 2 } : null) : { x: 0, len: L, half: W / 2 };
    const paving = { surf: [DET.paver, 0.8, 0], noJitter: true };
    if (fr && !fr.x) {
      B.box('std', 0, 1.2, W / 2 + 9.5, L + 12, 2.4, 19, '#8f8b82', null, paving);
      B.box('std', 0, 1.6, W / 2 + 19.6, L + 12, 3.2, 1.6, '#a6a299', null, { surf: [DET.concrete, 0.8, 0], noJitter: true });
    } else if (fr) {
      B.box('std', L / 2 + 9.5, 1.2, 0, 19, 2.4, W + 12, '#8f8b82', null, paving);
    }
  }
  // trash at the back
  if (B.rng.chance(0.7)) trashBags(B, B.rng, 2 + Math.floor(B.rng.next() * 4), L * 0.6, -(W / 2 + 5));
}

// ---- shared context -----------------------------------------------------------------------------------

function makeCtx(B, o, L, W, H, arch) {
  const id = o.id;
  const surf = wallSurface(arch, o);
  const gable = arch === 'house' || arch === 'shack' || arch === 'barn' || arch === 'church';
  const wallH = arch === 'steeple' ? Math.min(H - 110, 230) : gable ? (arch === 'barn' ? Math.min(H - 50, 90) : H - 50) : H;
  const floors = arch === 'barn' || arch === 'shack' ? 1 : arch === 'industrial' ? 1 : arch === 'church' ? 1 : arch === 'house' ? (wallH >= 98 ? 2 : 1) : Math.max(1, Math.floor((wallH - 16) / 46));
  const plinth = arch === 'industrial' ? 6 : 10;
  const trim = TRIMS[Math.floor(hash01(id * 5 + 2) * TRIMS.length)];
  return {
    id, arch, L, W, H, wallH, floors, plinth,
    floorH: arch === 'barn' ? wallH - plinth : arch === 'church' ? wallH - plinth : (wallH - plinth) / floors,
    color: o.color, roofColor: o.roof || '#4e4a45',
    trim: arch === 'industrial' ? '#8a8d90' : trim,
    frame: arch === 'industrial' ? '#3a3e42' : FRAMES[Math.floor(hash01(id * 3 + 9) * FRAMES.length)],
    door: DOORS[Math.floor(hash01(id * 11 + 1) * DOORS.length)],
    awn: AWNINGS[Math.floor(hash01(id * 13 + 4) * AWNINGS.length)],
    shopCol: SHOPFRONTS[Math.floor(hash01(id * 17 + 6) * SHOPFRONTS.length)],
    surf,
    litRate: o.lit !== undefined ? o.lit : arch === 'house' || arch === 'shack' ? 0.28 : 0.17,
    R: 3.8,
  };
}

const wallOpts = (ctx, extra) => ({ noJitter: true, surf: ctx.surf, ...(extra || {}) });

/**
 * The four walls of a box building: skins around openings, windows, doors, trim. Returns
 * { faces, floorY(f) } and leaves the roof to the caller.
 * opts: { win: {w, h, sill, bay, margin}, shopFront (bool), doorFace0 (bool), rooms (type), stringCourses, pilasters, shutters, ac,
 *         cornice (size|0), sideDoors (fn), rearDoor (bool) }
 */
function wallsOf(B, o, ctx, opts) {
  const { L, W, wallH, floors, plinth, floorH, R } = ctx;
  const id = ctx.id;
  const win = opts.win;
  const wo = wallOpts(ctx);
  const wc = ctx.color;
  const floorY = (f) => plinth + f * floorH;
  // the dark core behind the skins
  const D = 5.5;
  B.block('std', 0, 0, 0, L - D * 2, wallH, W - D * 2, '#0c0d0f', null, { surf: [0, 0.95, 0], noJitter: true });
  const faces = [];
  for (let fi = 0; fi < 4; fi++) {
    const F = new Face(B, fi, L, W);
    faces.push(F);
    const len = F.len;
    const margin = win.margin;
    const n = Math.max(1, Math.floor((len - 2 * margin) / win.bay));
    const step = (len - 2 * margin) / n;
    const tAt = (i) => -len / 2 + margin + (i + 0.5) * step;
    const wins = [];
    const doorIdx = fi === 0 && opts.doorFace0 ? Math.floor(n / 2) : fi === 1 && opts.rearDoor ? Math.min(n - 1, 1) : -1;
    const holesByFloor = [];
    for (let fl = 0; fl < floors; fl++) {
      const holes = [];
      const y0 = floorY(fl);
      const yc = y0 + win.sill + win.h / 2;
      if (fl === 0 && fi === 0 && opts.shopFront) {
        shopFront(F, ctx, opts, holes, wins);
        holesByFloor.push(holes);
        continue;
      }
      // an archetype's own openings (motel rooms, a church door...): returns true when it made them all
      if (opts.extra && opts.extra(fi, fl, F, holes, wins, { n, tAt, yc, y0 })) {
        holesByFloor.push(holes);
        continue;
      }
      for (let i = 0; i < n; i++) {
        const t = tAt(i);
        if (fl === 0 && i === doorIdx) {
          const dw = fi === 0 ? 17 : 15, dh = fi === 0 ? 38 : 34;
          holes.push({ t0: t - dw / 2, t1: t + dw / 2, y0: plinth, y1: plinth + dh });
          wins.push({ door: true, t, w: dw, h: dh, y0: plinth, front: fi === 0 });
          continue;
        }
        if (opts.skip && opts.skip(fi, fl, i, n)) continue;
        const roll = hash01(id * 131 + fi * 37 + fl * 11 + i);
        const roll2 = hash01(id * 53 + fi * 19 + fl * 5 + i + 7);
        let state = roll < ctx.litRate ? 'lit' : 'dark';
        if (state === 'dark' && o.lit === undefined) state = roll2 < 0.12 ? 'boarded' : roll2 < 0.2 ? 'broken' : roll2 < 0.23 ? 'blank' : 'dark';
        const ww = win.w * (0.9 + hash01(id + fi * 3 + i) * 0.2);
        holes.push({ t0: t - ww / 2, t1: t + ww / 2, y0: yc - win.h / 2, y1: yc + win.h / 2 });
        wins.push({ t, yc, ww, wh: win.h, state, fl, i, seed: id * 977 + fi * 131 + fl * 17 + i, type: state === 'broken' || state === 'boarded' ? 4 : opts.rooms || 0 });
      }
      holesByFloor.push(holes);
    }
    // the skin, band by band
    skinBand(F, 0, plinth, [], shadeHex(ctx.color, -0.3), { noJitter: true, surf: [DET.concrete, 0.9, 0] });
    for (let fl = 0; fl < floors; fl++) {
      const y0 = floorY(fl), y1 = fl === floors - 1 ? wallH : floorY(fl + 1);
      const holes = holesByFloor[fl].slice().sort((a, b) => a.t0 - b.t0);
      const col = fl === 0 && opts.groundColor ? opts.groundColor : wc;
      skinBand(F, y0, y1, holes, col, wo);
    }
    // openings' units
    for (const w of wins) {
      if (w.unit) { w.unit(F); continue; }
      if (w.door) {
        const rearGlazed = false;
        doorUnit(F, {
          t: w.t, w: w.w, h: w.h, y0: w.y0, R, leaf: w.front ? ctx.door : '#4a4e52', frame: ctx.frame, wall: wc, trim: ctx.trim,
          glazed: rearGlazed, step: w.front, lamp: true, seed: id, room: roomId(0, id),
        });
        continue;
      }
      if (w.shop) continue;
      windowUnit(F, {
        t: w.t, yc: w.yc, ww: w.ww, wh: w.wh, R, state: w.state, room: roomId(w.type, w.seed), k: 1.15 + hash01(w.seed) * 0.5,
        frame: ctx.frame, wall: wc, sill: true, lintel: true, trim: ctx.trim, mullion: win.mullion ?? (hash01(w.seed + 3) < 0.6 ? 1 : 2),
        shutters: opts.shutters ? opts.shutters : null, ac: opts.ac && w.state === 'dark' && hash01(w.seed + 9) < 0.14, seed: w.seed,
      });
    }
    // stringcourses at every floor line
    if (opts.stringCourses && DETAIL.level >= 1) {
      for (let fl = 1; fl < floors; fl++) F.box('std', 0, floorY(fl), 0, len + 1.6, 2.6, 1.3, shadeHex(ctx.color, 0.12), { noJitter: true, surf: [DET.concrete, 0.85, 0] });
    }
    faces.info = faces.info || [];
    faces.info[fi] = { n, step, tAt };
  }
  // corner pilasters
  if (opts.pilasters && DETAIL.level >= 1) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      B.rblock('std', sx * (L / 2 - 3.1), 0, sz * (W / 2 - 3.1), 7.4, wallH, 7.4, 0.5, shadeHex(ctx.color, 0.06), null, { surf: [DET.concrete, 0.86, 0], noJitter: true });
    }
  }
  // cornice
  if (opts.cornice) for (const F of faces) cornice(F, wallH, shadeHex(ctx.color, 0.14), 4.2, opts.cornice);
  return { faces, floorY };
}

/** The ground floor of a shop row's front: display windows, doors, pilasters, signs, awnings. */
function shopFront(F, ctx, opts, holes, wins) {
  const { plinth, floorH, R } = ctx;
  const len = F.len;
  const edge = 9;
  const nu = Math.max(1, Math.floor((len - 2 * edge) / 68));
  const U = (len - 2 * edge) / nu;
  const gTop = plinth + floorH - 15, gBot = plinth + 11;
  const id = ctx.id;
  for (let u = 0; u < nu; u++) {
    const t0 = -len / 2 + edge + u * U;
    const usable = U - 6;
    const dw = 18;
    const gw = (usable - dw - 5) / 2;
    const flip = hash01(id * 7 + u) < 0.5 ? -1 : 1;
    const c0 = t0 + 3;
    // [glass | door | glass] left to right (door off-centre in odd units)
    const g1 = { t: c0 + gw / 2, w: gw }, dr = { t: c0 + gw + 2.5 + dw / 2, w: dw }, g2 = { t: c0 + gw + dw + 5 + gw / 2, w: gw };
    if (flip < 0) { const a = g1.w; g1.w = g2.w; g2.w = a; }
    for (const g of [g1, g2]) {
      holes.push({ t0: g.t - g.w / 2, t1: g.t + g.w / 2, y0: gBot, y1: gTop });
      wins.push({ shop: true });
      const lit = hash01(id * 71 + u * 3 + (g === g1 ? 0 : 1)) < 0.5;
      const state = hash01(id * 19 + u * 5 + (g === g1 ? 1 : 2)) < 0.12 ? 'boarded' : hash01(id * 23 + u) < 0.14 ? 'broken' : lit ? 'lit' : 'dark';
      windowUnit(F, {
        t: g.t, yc: (gBot + gTop) / 2, ww: g.w, wh: gTop - gBot, R, state, room: roomId(state === 'boarded' || state === 'broken' ? 4 : 1, id * 31 + u * 7 + (g === g1 ? 0 : 3)),
        lamp: '#e8f0ff', k: 1.25, frame: ctx.frame, wall: ctx.color, sill: false, lintel: false, trim: ctx.trim, mullion: 2, seed: id * 41 + u * 13 + (g === g1 ? 1 : 2),
      });
      // the bulkhead under the display window
      F.box('std', g.t, plinth + 5.5, -1.6, g.w + 1, 11 - 1, 2.6, ctx.shopCol, { noJitter: true, surf: [DET.panel, 0.55, 0.2] });
    }
    holes.push({ t0: dr.t - dw / 2, t1: dr.t + dw / 2, y0: plinth, y1: plinth + 38 });
    wins.push({ shop: true });
    doorUnit(F, { t: dr.t, w: dw, h: 38, y0: plinth, R, leaf: ctx.door, frame: '#c9ced3', wall: ctx.color, trim: ctx.trim, glazed: true, step: true, lamp: false, seed: id + u, room: roomId(1, id + u * 5) });
    // the sign over the unit and an awning under it
    const cell = 'sign' + Math.floor(hash01(id * 3 + u * 11 + 1) * 24);
    const sw = Math.min(U - 12, 64);
    signBoard(F, t0 + U / 2, plinth + floorH - 5, sw, cell, { frame: shadeHex(ctx.shopCol, -0.2), lamp: DETAIL.level >= 2 });
    if (hash01(id * 5 + u * 3) < 0.7) awning(F, t0 + 5, t0 + U - 5, gTop + 1, 9, ctx.awn[0], ctx.awn[1]);
    else if (DETAIL.level >= 1) shutter(F, t0 + 4, t0 + U - 4, plinth, gTop, id);
    // a neon OPEN in the window of some units
    if (hash01(id * 13 + u * 5) < 0.55) {
      F.rect('neon', g1.t, gTop - 5, -R + 3, 16, 4, '#ffffff', { uv: atlasUV('nsign' + Math.floor(hash01(id + u) * 8)), emissive: 1.6, noAO: true, noJitter: true });
    }
  }
  // pilaster piers between units
  if (DETAIL.level >= 1) {
    for (let u = 0; u <= nu; u++) {
      const t = -len / 2 + edge + u * U;
      F.box('std', t, plinth + floorH / 2 + 2, 0, u === 0 || u === nu ? 8 : 6, floorH - 4, 1.8, shadeHex(ctx.shopCol, 0.05), { noJitter: true, surf: [DET.concrete, 0.86, 0] });
    }
  }
  void opts;
}

// ---- roofs ------------------------------------------------------------------------------------------------------

/** Flat roof with a parapet and coping, plant and clutter on it. */
function flatRoof(B, o, ctx, sign, opts = {}) {
  const r = B.rng;
  const { L, W, wallH } = ctx;
  const lod = DETAIL.level;
  const roofC = ctx.roofColor;
  B.block('std', 0, wallH, 0, L - 2, 1.2, W - 2, roofC, null, { surf: [DET.gravel, 0.92, 0], noJitter: true });
  const ph = opts.parapet ?? 8;
  const S = wallOpts(ctx);
  for (const s of [-1, 1]) {
    B.block('std', 0, wallH, s * (W / 2 - 2), L, ph, 4, shadeHex(ctx.color, -0.06), null, S);
    B.block('std', s * (L / 2 - 2), wallH, 0, 4, ph, W - 4, shadeHex(ctx.color, -0.06), null, S);
    B.box('std', 0, wallH + ph + 0.6, s * (W / 2 - 2), L + 1.4, 1.3, 6, '#8a8a84', null, { surf: [DET.concrete, 0.7, 0.2], noJitter: true });
    B.box('std', s * (L / 2 - 2), wallH + ph + 0.6, 0, 6, 1.3, W + 1.4, '#8a8a84', null, { surf: [DET.concrete, 0.7, 0.2], noJitter: true });
  }
  const nAC = 1 + Math.floor(r.next() * 3);
  for (let i = 0; i < nAC; i++) acUnit(B, r.range(-L * 0.3, L * 0.3), wallH + 1, r.range(-W * 0.25, W * 0.25), r.range(18, 26), r.range(14, 18), r.range(11, 15), r.range(-0.2, 0.2), r.pick(['#8e9294', '#a3a49c', '#7d8286']));
  for (let i = 0; i < 3; i++) ventStack(B, r.range(-L * 0.4, L * 0.4), wallH + 1, r.range(-W * 0.4, W * 0.4), 2, r.range(6, 14));
  if (r.chance(0.55)) B.rblock('std', r.range(-L * 0.3, L * 0.3), wallH + 1, r.range(-W * 0.2, W * 0.2), 26, 20, 26, 0.8, shadeHex(ctx.color, -0.15), null, S);
  if (lod >= 1 && r.chance(0.6)) hatch(B, r.range(-L * 0.3, L * 0.3), wallH + 1, r.range(-W * 0.3, W * 0.3), 16, 12, r.range(-0.3, 0.3));
  if (wallH > 170 && r.chance(0.65)) waterTank(B, r.range(-L * 0.25, L * 0.25), wallH + 1, r.range(-W * 0.2, W * 0.2), 13);
  if (r.chance(0.5)) antenna(B, L * 0.3, wallH + 1, -W * 0.3, r.range(34, 60));
  if (lod >= 1 && r.chance(0.4)) dish(B, -L * 0.3, wallH + 1, W * 0.28, r.range(6, 9), r.range(0, 6));
  // a run of conduit and a cable drum, litter
  if (lod >= 2) {
    B.cyl('std', r.range(-L * 0.3, L * 0.3), wallH + 1, r.range(-W * 0.3, W * 0.3), 5, 4, '#6a4a2a', 10, 1, null, { surf: [DET.wood, 0.85, 0] });
    const px = r.range(-L * 0.35, L * 0.35), pz = r.range(-W * 0.3, W * 0.3);
    B.add('std', T.cyl(6), [px, wallH + 3, pz], [0.8, r.range(30, 60), 0.8], [0, 0, Math.PI / 2], '#5a5e62', { surf: [DET.rust, 0.5, 0.7], map: 'cyl', noJitter: true });
  }
  if (sign) {
    // a neon sign on posts over the roof edge
    for (const x of [-70, 70]) B.block('std', x, wallH + 1, W / 2 - 14, 4, 34, 4, '#333', null, { surf: [DET.rust, 0.6, 0.7] });
    B.box('std', 0, wallH + 60, W / 2 - 14, 200, 52, 5, '#1a0c12', null, { surf: [DET.panel, 0.5, 0.4] });
    B.add('neon', T.plane(), [0, wallH + 60, W / 2 - 11.2], [194, 48, 1], null, '#ffffff', { emissive: 2.4, uv: atlasUV(sign.cell) });
    B.add('neon', T.plane(), [0, wallH + 60, W / 2 - 16.8], [194, 48, 1], [0, Math.PI, 0], '#ffffff', { emissive: 2.2, uv: atlasUV(sign.cell) });
  }
}

/**
 * A gable roof (two slabs with overhangs, a ridge cap, wall gables under them).
 * axis: 'x' ridge along the object's x, 'z' along z. rise: gable height.
 */
function gableRoof(B, ctx, opts) {
  const { L, W, wallH } = ctx;
  const axis = opts.axis || (L >= W ? 'x' : 'z');
  const span = axis === 'x' ? W : L, len = axis === 'x' ? L : W;
  const rise = opts.rise ?? Math.max(30, Math.min(56, span * 0.34));
  const oh = opts.overhang ?? 6, gh = opts.gableOverhang ?? 4;
  const phi = Math.atan2(rise, span / 2);
  const slopeLen = (span / 2 + oh) / Math.cos(phi);
  const th = opts.thickness ?? 1.9;
  const layer = opts.layer ?? DET.shingle;
  const rc = opts.color || ctx.roofColor;
  const roofSurf = { surf: [layer, layer === DET.metalroof ? 0.5 : 0.86, layer === DET.metalroof ? 0.6 : 0], noJitter: true };
  // (u along the ridge, y, v across it) -> the object frame
  const map = (u, y, v) => (axis === 'x' ? [u, y, v] : [v, y, -u]);
  const rotY = axis === 'x' ? 0 : Math.PI / 2;
  const prismRot = axis === 'x' ? Math.PI / 2 : 0;
  for (const sd of [-1, 1]) {
    // slab centre: horizontally halfway between ridge and eave tip, on the slope
    const hx = (span / 2 + oh) / 2;
    const cy = wallH + rise - hx * Math.tan(phi) - th * 0.5 / Math.cos(phi);
    B.add('std', T.box(), map(0, cy, sd * hx), [len + gh * 2, th, slopeLen], new THREE.Euler(sd * phi, rotY, 0, 'YXZ'), rc, roofSurf);
  }
  // ridge cap
  B.add('std', T.box(), map(0, wallH + rise + 0.2, 0), [len + gh * 2 + 1, 2.6, 3.4], [0, rotY, 0], shadeHex(rc, -0.12), { surf: [layer, 0.86, layer === DET.metalroof ? 0.6 : 0], noJitter: true });
  // the wall gables under the slabs: triangular prisms in the wall material
  const pts = [[-span / 2, 0], [span / 2, 0], [0, rise]];
  for (const sd of [-1, 1]) {
    B.add('std', T.profile('gable' + Math.round(span) + ':' + Math.round(rise), pts, 0, 1), map(sd * (len / 2 - 1.1), wallH, 0), [1, 1, 2.2], [0, prismRot, 0], ctx.color, { surf: ctx.surf, noJitter: true });
  }
  // fascia boards along the eaves, and a gutter
  if (DETAIL.level >= 1) {
    for (const sd of [-1, 1]) {
      const ey = wallH + rise - (span / 2 + oh) * Math.tan(phi);
      B.add('std', T.box(), map(0, ey - 1.6, sd * (span / 2 + oh - 0.4)), [len + gh * 2, 3, 1.1], [0, rotY, 0], ctx.trim, { surf: [DET.wood, 0.8, 0], noJitter: true });
      B.add('std', T.cyl(6), map(0, ey - 3.4, sd * (span / 2 + oh + 0.6)), [1, len + gh * 2, 1], new THREE.Euler(0, rotY, Math.PI / 2, 'YXZ'), '#5a5e62', { surf: [DET.rust, 0.5, 0.7], map: 'cyl', noJitter: true });
    }
  }
  return { rise, span, len, axis, map, rotY };
}

// ---- archetypes ----------------------------------------------------------------------------------------------------

function shopsOrApartment(B, o, ctx, sign) {
  const { L, W } = ctx;
  const r = B.rng;
  const apt = ctx.arch === 'apartment';
  const opts = {
    win: { w: 15, h: 22, sill: 12, bay: apt ? 32 : 36, margin: 15 },
    shopFront: !apt && hash01(o.id * 3 + 7) < 0.85,
    doorFace0: true,
    rearDoor: true,
    rooms: 0,
    stringCourses: true,
    pilasters: true,
    cornice: apt ? 1.15 : 1,
    ac: true,
    groundColor: !apt && hash01(o.id * 3 + 7) >= 0.85 ? undefined : undefined,
  };
  const { faces, floorY } = wallsOf(B, o, ctx, opts);
  flatRoof(B, o, ctx, sign);
  // details on the back and sides: drainpipes, graffiti, a fire escape, a conduit run, wall lamps
  const back = faces[1], left = faces[3], right = faces[2];
  downspout(faces[0], -L / 2 + 6, ctx.wallH);
  downspout(faces[0], L / 2 - 6, ctx.wallH);
  downspout(back, L / 2 - 6, ctx.wallH);
  if (ctx.floors >= 2 && (apt || hash01(o.id * 41 + 1) < 0.5)) fireEscape(back, r.range(-L * 0.2, L * 0.2), ctx.floors, floorY);
  if (DETAIL.level >= 1) {
    for (const F of [back, left, right]) {
      if (hash01(o.id * 91 + F.i * 7) < 0.55) {
        const t = (hash01(o.id * 17 + F.i) - 0.5) * F.len * 0.5;
        F.rect('stain', t, 26 + hash01(o.id + F.i * 3) * 10, 0.25, 46, 23, '#ffffff', { uv: atlasUV('gfx' + Math.floor(hash01(o.id * 5 + F.i) * 9)), noAO: true, noJitter: true });
      }
    }
    conduit(back, -L * 0.35, L * 0.1, ctx.wallH - 8);
    // a poster or two at street level
    if (!opts.shopFront || hash01(o.id) < 0.5) faces[0].rect('decal', r.range(-L * 0.4, L * 0.4), 34, 0.35, 16, 24, '#ffffff', { uv: atlasUV('poster' + Math.floor(r.next() * 3)), noAO: true });
  }
  // a wall lamp by the back door
  back.box('glow', back.info ? 0 : 0, 40, 0.5, 3, 4, 2, '#ffd79a', { emissive: 3.2, uv: atlasUV('white'), noAO: true });
}

function industrial(B, o, ctx) {
  const { L, W, wallH } = ctx;
  const r = B.rng;
  const opts = {
    win: { w: 26, h: 10, sill: wallH - 34, bay: 60, margin: 22, mullion: 2 },
    doorFace0: false,
    rearDoor: true,
    rooms: 3,
    skip: (fi, fl, i) => fi === 0 && (i === 1 || i === 3),
    cornice: 0,
    pilasters: false,
    stringCourses: false,
  };
  const { faces } = wallsOf(B, o, ctx, opts);
  // roll-up doors on the front: recessed openings would need holes, so they are fitted on the face
  const F = faces[0];
  const nDoors = Math.max(1, Math.floor(L / 110));
  for (let d = 0; d < nDoors; d++) {
    const t = -L / 2 + (d + 0.5) * (L / nDoors);
    const dw = 44;
    const up = hash01(o.id * 7 + d) * 0.6;
    F.box('std', t, 26, -0.2, dw + 8, 52, 1.8, '#4a4e52', { noJitter: true, surf: [DET.panel, 0.55, 0.5] });
    F.span('decal', t - dw / 2, t + dw / 2, 3, 3 + 46 * (1 - up), 1.7, '#ffffff', { uv: atlasUV('garage'), noAO: true });
    F.box('std', t, 3 + 46 * (1 - up) + 2, 1.2, dw + 4, 3.4, 4.6, '#3a3d40', { noJitter: true, surf: [DET.rust, 0.6, 0.6] });
    // dock bumpers and a wall lamp
    if (DETAIL.level >= 1) {
      for (const sd of [-1, 1]) F.box('std', t + sd * (dw / 2 + 6), 8, 0, 4, 14, 4, '#1b1b1c', { noJitter: true, surf: [DET.rubber, 0.9, 0] });
      F.box('glow', t, 62, 0.5, 5, 3, 2.4, '#fff0d0', { emissive: 3.4, uv: atlasUV('white'), noAO: true });
      F.box('std', t, 64.5, 0, 8, 3, 3, '#2a2c2e', { noJitter: true, surf: [DET.panel, 0.5, 0.5] });
    }
  }
  // metal roof: low gable along the long side, ribbed, with a ridge vent
  const g = gableRoof(B, ctx, { rise: 24, overhang: 3, gableOverhang: 2, layer: DET.metalroof, color: ctx.roofColor });
  if (DETAIL.level >= 1) {
    const rv = ctx.wallH + g.rise;
    B.add('std', T.box(), g.map(0, rv + 3.6, 0), [g.len * 0.8, 3.4, 5], [0, g.rotY, 0], '#555a5e', { surf: [DET.rust, 0.55, 0.6], noJitter: true });
    for (const t of [-0.3, 0.3]) { const vp = g.map(g.len * t, 0, 0); ventStack(B, vp[0], ctx.wallH + g.rise + 4, vp[2], 3.2, 8); }
  }
  // pipes, tanks and stacked pallets around the back
  const back = faces[1];
  downspout(faces[0], -L / 2 + 5, wallH);
  downspout(faces[0], L / 2 - 5, wallH);
  conduit(back, -L * 0.35, L * 0.35, wallH - 10);
  if (DETAIL.level >= 1) {
    for (let i = 0; i < 4; i++) B.block('std', L / 2 + 14 + (i % 2) * 2, 0, -W * 0.2 + i * 3, 20, 5 + (i % 3) * 3, 16, '#6b4a2c', [0, r.range(-0.2, 0.2), 0], { surf: [DET.wood, 0.85, 0] });
    B.cyl('std', -L / 2 - 16, 0, W * 0.15, 11, 34, '#8d8a82', 14, 1, null, { surf: [DET.corrugated, 0.5, 0.7] });
    B.cyl('std', -L / 2 - 16, 34, W * 0.15, 11, 8, '#7a7d80', 14, 0.15, null, { surf: [DET.corrugated, 0.5, 0.7] });
  }
}

function house(B, o, ctx) {
  const { L, W, wallH } = ctx;
  const r = B.rng;
  const shack = ctx.arch === 'shack';
  const opts = {
    win: { w: shack ? 12 : 16, h: shack ? 15 : 22, sill: shack ? 16 : 11, bay: shack ? 30 : 36, margin: 14, mullion: 1 },
    doorFace0: true,
    rearDoor: false,
    rooms: 0,
    shutters: !shack && hash01(o.id * 7 + 2) < 0.6 ? shadeHex(ctx.trim, -0.1) : null,
    pilasters: false,
    stringCourses: false,
    skip: (fi, fl, i, n) => shack && fi > 1 && i % 2 === 0,
  };
  const { faces, floorY } = wallsOf(B, o, ctx, opts);
  // corner boards
  if (DETAIL.level >= 1) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', sx * (L / 2 - 0.9), 0, sz * (W / 2 - 0.9), 2.2, wallH, 2.2, ctx.trim, null, { surf: [DET.wood, 0.85, 0], noJitter: true });
  const roofLayer = shack ? DET.metalroof : hash01(o.id * 3 + 1) < 0.3 ? DET.tile : DET.shingle;
  const g = gableRoof(B, ctx, { layer: roofLayer, rise: shack ? 24 : undefined, overhang: shack ? 4 : 7 });
  // chimney on a gable end
  const chx = g.map(g.len * 0.26, ctx.wallH + g.rise * 0.4, g.span * 0.12);
  if (!shack) chimney(B, chx[0], ctx.wallH + g.rise * 0.25, chx[2], 11, g.rise * 0.9, ctx.color);
  else ventStack(B, chx[0], ctx.wallH + g.rise * 0.5, chx[2], 2.4, 26, '#4a4e52');
  // porch on the front (face 0): slab, columns, a shed roof, steps, railing
  const F = faces[0];
  if (!shack && L >= 110) {
    const pw = Math.min(L * 0.5, 84), pd = 20;
    F.box('std', 0, 2.5, 0, pw, 5, pd, '#8f8b82', { surf: [DET.slab, 0.88, 0] });
    for (const t of [-pw / 2 + 2.5, pw / 2 - 2.5]) F.box('std', t, 5 + 24, pd - 3, 3.6, 48, 3.6, ctx.trim, { noJitter: true, surf: [DET.wood, 0.8, 0] });
    F.box('std', 0, 5 + 49, pd / 2 - 1, pw + 4, 2.6, pd + 2, shadeHex(ctx.roofColor, -0.05), { noJitter: true, surf: [DET.shingle, 0.86, 0] });
    if (DETAIL.level >= 1) {
      railing(F, -pw / 2 + 4, -8, 5, pd - 4, ctx.trim, 11);
      railing(F, 8, pw / 2 - 4, 5, pd - 4, ctx.trim, 11);
      for (let k = 0; k < 3; k++) F.box('std', 0, 1.2 + k * 1.6, pd + k * 3, 24 - k * 2, 1.6, 3.2, '#9a978e', { noJitter: true, surf: [DET.slab, 0.88, 0] });
    }
  }
  // dormer on a big house
  if (!shack && g.span >= 110 && DETAIL.level >= 2) {
    const dp = g.map(g.len * 0.05, ctx.wallH + g.rise * 0.34, g.span * 0.2);
    const s = g.axis === 'x' ? 1 : 0;
    void s;
    B.rblock('std', dp[0], ctx.wallH + g.rise * 0.16, dp[2], g.axis === 'x' ? 22 : 16, 22, g.axis === 'x' ? 16 : 22, 0.6, ctx.color, null, { surf: ctx.surf, noJitter: true });
  }
  downspout(faces[0], L / 2 - 5, wallH);
  // rusty barrel, a woodpile, junk by the shack
  if (shack) {
    B.cyl('std', L / 2 + 10, 0, -W * 0.2, 6, 17, '#5a3a24', 10, 1, null, { surf: [DET.rust, 0.8, 0.6] });
    for (let i = 0; i < 6; i++) B.cyl('std', -L / 2 - 8, i % 2 * 5, -W * 0.15 + (i >> 1) * 4, 2, 24, '#6b5238', 6, 1, [Math.PI / 2, 0, 0], { surf: [DET.bark, 0.9, 0] });
  } else if (DETAIL.level >= 1) {
    // a tree stump, a fence bit, a parked bicycle... a doghouse
    B.rblock('std', -L / 2 - 16, 0, W * 0.15, 14, 12, 12, 0.8, '#6a5238', [0, 0.3, 0], { surf: [DET.wood, 0.88, 0] });
  }
  void floorY; void r;
}

function motel(B, o, ctx, sign) {
  const { L, W, wallH } = ctx;
  const opts = {
    win: { w: 13, h: 18, sill: 14, bay: 40, margin: 22 },
    doorFace0: false,
    rearDoor: false,
    rooms: 0,
    pilasters: true,
    stringCourses: false,
    cornice: 0.8,
    ac: true,
    // the front: a window and a door per room on both storeys
    extra: (fi, fl, F, holes, wins, g) => {
      if (fi !== 0) return false;
      for (let i = 0; i < g.n; i++) {
        const t = g.tAt(i);
        const seed = o.id * 13 + fl * 31 + i;
        const roll = hash01(seed);
        const state = roll < (o.lit !== undefined ? o.lit : 0.22) ? 'lit' : o.lit === undefined && roll < 0.3 ? 'boarded' : 'dark';
        holes.push({ t0: t - 14.5, t1: t - 1.5, y0: g.y0 + 14, y1: g.y0 + 32 });
        holes.push({ t0: t + 3, t1: t + 16, y0: g.y0, y1: g.y0 + 32 });
        wins.push({ unit: (FF) => {
          windowUnit(FF, { t: t - 8, yc: g.y0 + 23, ww: 13, wh: 18, R: ctx.R, state, room: roomId(state === 'boarded' ? 4 : 0, seed), k: 1.2, frame: ctx.frame, wall: ctx.color, sill: true, lintel: false, trim: ctx.trim, mullion: 2, seed });
          doorUnit(FF, { t: t + 9.5, w: 13, h: 32, y0: g.y0, R: ctx.R, leaf: hash01(seed + 3) < 0.5 ? '#6a1f1a' : '#1f3a4a', frame: ctx.frame, wall: ctx.color, trim: ctx.trim, glazed: false, step: fl === 0, lamp: i % 2 === 0, seed, room: roomId(0, seed) });
        } });
      }
      return true;
    },
  };
  const { faces, floorY } = wallsOf(B, o, ctx, opts);
  const F = faces[0];
  // the walkway slab and railing along the upper storey, posts down to the ground, a stair at one end
  if (ctx.floors >= 2) {
    balcony(F, -L / 2 + 8, L / 2 - 8, floorY(1), 15, '#8a877e', '#2c2f32');
    for (let i = 0; i <= 8; i++) F.box('std', -L / 2 + 12 + (i * (L - 24)) / 8, floorY(1) / 2 + 2, 12, 3, floorY(1) - 4, 3, '#4a4d50', { noJitter: true, surf: [DET.rust, 0.55, 0.6] });
    const steps = 12;
    for (let k = 0; k < steps; k++) F.box('std', L / 2 - 14 - k * 1.7, (floorY(1) * (k + 0.5)) / steps, 16, 12, 2, 12, '#8a877e', { noJitter: true, surf: [DET.slab, 0.88, 0] });
  }
  flatRoof(B, o, ctx, sign, { parapet: 6 });
  downspout(F, -L / 2 + 6, wallH);
  downspout(F, L / 2 - 6, wallH);
  if (DETAIL.level >= 1) {
    // an ice machine and a vending machine by the office end
    F.rbox('std', -L / 2 + 30, 18, 0, 16, 36, 10, 0.8, '#b8c4cc', { surf: [DET.panel, 0.4, 0.5] });
    F.rbox('std', -L / 2 + 50, 22, 0, 18, 44, 12, 0.8, '#a51f25', { surf: [DET.panel, 0.4, 0.4] });
    F.box('glow', -L / 2 + 50, 28, 12.2, 12, 20, 0.4, '#ffe6c0', { emissive: 1.4, uv: atlasUV('shop'), noAO: true });
  }
}

function barn(B, o, ctx) {
  const { L, W, wallH } = ctx;
  const r = B.rng;
  const long = L >= W;
  const opts = {
    win: { w: 10, h: 14, sill: 40, bay: 70, margin: 30, mullion: 2 },
    doorFace0: false,
    rearDoor: false,
    rooms: 4,
    skip: () => true,
    pilasters: false,
    stringCourses: false,
  };
  const { faces } = wallsOf(B, o, ctx, opts);
  // big double doors with an X of white braces on the gable end (the short side)
  const endFace = long ? faces[2] : faces[0];
  const dw = Math.min(58, endFace.len * 0.5), dh = Math.min(64, wallH - 14);
  const trim = '#e8e2d4';
  const wood = { noJitter: true, surf: [DET.wood, 0.85, 0] };
  endFace.box('std', 0, 10 + dh / 2, -0.4, dw + 6, dh + 5, 1.4, trim, wood);
  endFace.rect('std', -dw / 4, 10 + dh / 2, 1.2, dw / 2 - 0.6, dh, shadeHex(ctx.color, -0.12), wood);
  endFace.rect('std', dw / 4, 10 + dh / 2, 1.2, dw / 2 - 0.6, dh, shadeHex(ctx.color, -0.12), wood);
  for (const sd of [-1, 1]) {
    const ang = Math.atan2(dh, dw / 2);
    for (const t of [-dw / 4, dw / 4]) endFace.B.add('std', T.box(), endFace.P(t, 10 + dh / 2, 2.0), [Math.hypot(dw / 2, dh) * 0.98, 2.2, 0.8], [0, endFace.frot, sd * ang], trim, wood);
  }
  endFace.box('std', 0, 10 + dh + 4, 0, dw + 6, 2.6, 2, trim, wood);
  // hayloft door above, a steel track for the sliding door
  const g = gableRoof(B, ctx, { layer: DET.metalroof, rise: Math.max(36, (long ? W : L) * 0.42), overhang: 8, gableOverhang: 6, color: mixHex(ctx.roofColor, '#6a3a2a', 0.3) });
  const loft = g.map(g.len / 2 + 0.2, wallH + g.rise * 0.3, 0);
  void loft;
  endFace.B.add('std', T.box(), endFace.P(0, wallH + g.rise * 0.34, 1.6), [16, 18, 1.4], [0, endFace.frot, 0], trim, wood);
  endFace.B.add('std', T.box(), endFace.P(0, wallH + g.rise * 0.34, 2.3), [11, 13, 0.8], [0, endFace.frot, 0], '#1a1512', wood);
  // cupola on the ridge
  B.rblock('std', 0, wallH + g.rise, 0, 12, 12, 12, 0.6, ctx.color, null, { surf: ctx.surf, noJitter: true });
  B.add('std', T.cyl(4, 0.05), [0, wallH + g.rise + 12 + 6, 0], [9.5, 12, 9.5], [0, Math.PI / 4, 0], shadeHex(ctx.roofColor, 0.05), { surf: [DET.metalroof, 0.5, 0.6], map: 'cyl', noJitter: true });
  // weathervane
  B.cyl('std', 0, wallH + g.rise + 22, 0, 0.4, 10, '#2a2a2a', 4, 1, null, { surf: [DET.rust, 0.5, 0.7], noJitter: true });
  // haybale stack and an old tractor tire by the side
  if (DETAIL.level >= 1) {
    for (let i = 0; i < 5; i++) B.rblock('std', -L / 2 - 12 - (i % 2) * 2, (i >> 1) * 8, -W * 0.25 + (i % 2) * 14, 14, 8, 10, 1, '#b39a55', null, { surf: [DET.fabric, 0.95, 0] });
  }
  downspout(endFace, endFace.len / 2 - 4, wallH);
  void r;
}

function church(B, o, ctx) {
  const { L, W, wallH } = ctx;
  const frontFace = L >= W ? 2 : 0;
  const opts = {
    win: { w: 12, h: 34, sill: 16, bay: 44, margin: 26, mullion: 2 },
    doorFace0: false,
    rearDoor: false,
    rooms: 0,
    skip: (fi) => fi === frontFace,
    pilasters: true,
    stringCourses: false,
    cornice: 0.8,
    extra: (fi, fl, F, holes, wins) => {
      if (fi !== frontFace) return false;
      holes.push({ t0: -12, t1: 12, y0: ctx.plinth, y1: ctx.plinth + 42 });
      wins.push({ unit: (FF) => doorUnit(FF, { t: 0, w: 24, h: 42, y0: ctx.plinth, R: 5, leaf: '#5a2a1e', frame: '#2a2622', wall: ctx.color, trim: '#e6e2d6', glazed: false, step: true, lamp: true, seed: o.id, room: 1 }) });
      return true;
    },
  };
  const { faces } = wallsOf(B, o, ctx, opts);
  const g = gableRoof(B, ctx, { layer: DET.shingle, overhang: 5, gableOverhang: 3 });
  const front = faces[frontFace];
  // a rose window in the gable, lit from within
  front.rect('room', 0, wallH + g.rise * 0.38, 0.5, 16, 16, '#ff9a4a', { pane: { id: roomId(4, o.id), w: 16, h: 16 }, emissive: 1.5 });
  for (const [x, y, w, h] of [[0, 8, 17.5, 1.5], [0, -8, 17.5, 1.5], [-8, 0, 1.5, 17.5], [8, 0, 1.5, 17.5], [0, 0, 1.2, 16], [0, 0, 16, 1.2]]) front.box('std', x, wallH + g.rise * 0.38 + y, 0.4, w, h, 1.2, '#e6e2d6', { noJitter: true, surf: [DET.concrete, 0.85, 0] });
  // belfry over the porch
  const bt = front.P(0, wallH, -4);
  B.rblock('std', bt[0], wallH, bt[2], 26, 44, 26, 0.6, ctx.color, null, { surf: ctx.surf, noJitter: true });
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    B.box('std', bt[0] + Math.cos(a) * 13, wallH + 30, bt[2] + Math.sin(a) * 13, s % 2 ? 1.4 : 9, 16, s % 2 ? 9 : 1.4, '#141110', null, { noJitter: true, surf: [DET.wood, 0.8, 0] });
  }
  B.add('std', T.cyl(4, 0.02), [bt[0], wallH + 44 + 24, bt[2]], [19, 48, 19], [0, Math.PI / 4, 0], ctx.roofColor, { surf: [DET.shingle, 0.86, 0], map: 'cyl', noJitter: true });
  // the cross
  B.box('std', bt[0], wallH + 44 + 52, bt[2], 1.8, 12, 1.8, '#d8d4c8', null, { noJitter: true, surf: [0, 0.4, 0.5] });
  B.box('std', bt[0], wallH + 44 + 54, bt[2], 7, 1.8, 1.8, '#d8d4c8', null, { noJitter: true, surf: [0, 0.4, 0.5] });
  downspout(faces[0], L / 2 - 5, wallH);
  // the church sign by the road
  if (DETAIL.level >= 1) signBoard(faces[frontFace === 2 ? 0 : 2], 0, wallH - 12, 56, 'sign23', { frame: '#2a2622', lamp: false });
}

/** A bell tower: a skinned shaft with tall lancet windows and clocks, an open belfry and a spire. */
function steepleTower(B, o, ctx) {
  const { L, W, H, wallH } = ctx;
  const opts = {
    win: { w: 12, h: 30, sill: 12, bay: 100, margin: 22, mullion: 2 },
    doorFace0: true,
    rooms: 4,
    pilasters: true,
    stringCourses: true,
    cornice: 0.9,
  };
  const { faces } = wallsOf(B, o, ctx, opts);
  for (const F of faces) {
    F.rect('std', 0, wallH - 26, 0.4, 22, 22, '#e8e2d0', { noJitter: true, surf: [DET.panel, 0.5, 0.2] });
    F.rect('std', 0, wallH - 24, 0.7, 2, 9, '#14110e', { noJitter: true, surf: [0, 0.6, 0] });
    F.rect('std', 3, wallH - 28, 0.7, 6, 1.6, '#14110e', { noJitter: true, surf: [0, 0.6, 0] });
  }
  // the belfry: open louvres, then the spire
  const bh = 42;
  B.block('std', 0, wallH, 0, L - 10, bh, W - 10, shadeHex(ctx.color, -0.05), null, { surf: ctx.surf, noJitter: true });
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    B.box('std', Math.cos(a) * ((L - 10) / 2 + 0.3), wallH + bh * 0.5, Math.sin(a) * ((W - 10) / 2 + 0.3), s % 2 ? 0.8 : 14, 26, s % 2 ? 14 : 0.8, '#0e0c0b', null, { noJitter: true, surf: [DET.wood, 0.8, 0] });
  }
  B.rblock('std', 0, wallH + bh - 2, 0, L - 4, 4, W - 4, 0.6, '#8a877e', null, { surf: [DET.concrete, 0.86, 0], noJitter: true });
  B.add('std', T.cyl(4, 0.02), [0, wallH + bh + (H - wallH - bh) / 2, 0], [(L - 6) * 0.72, H - wallH - bh, (W - 6) * 0.72], [0, Math.PI / 4, 0], ctx.roofColor, { surf: [DET.metalroof, 0.5, 0.6], map: 'cyl', noJitter: true });
}

// ---- the diner ------------------------------------------------------------------------------------------------------

/** The diner objective: stainless siding, red stripes, lit windows, neon signs. */
export function diner(B, L, W, halos, ob) {
  const H = 96;
  const steel = [DET.corrugated, 0.42, 0.8];
  B.rblock('std', 0, 0, 0, L + 4, 10, W + 4, 1, '#6a5f55', null, { surf: [DET.concrete, 0.9, 0] });
  B.rblock('std', 0, 10, 0, L, H - 10, W, 3, '#c8cdd0', null, { surf: steel });
  for (const sd of [-1, 1]) {
    B.box('std', 0, 24, sd * (W / 2 + 0.6), L, 8, 1, '#a51f25', null, { surf: [DET.panel, 0.35, 0.3] });
    B.box('std', 0, 84, sd * (W / 2 + 0.7), L, 5, 1, CHROME, null, { surf: [0, 0.15, 1] });
  }
  // front windows (+z = sim +y side, where the neon sign light is)
  const n = 5;
  const span = L * 0.8;
  for (let i = 0; i < n; i++) {
    const x = -span / 2 + ((i + 0.5) * span) / n;
    if (i === 2) {
      // the glass door: the lit room behind, dimmer than the windows. In front of its chrome
      // frame (a solid slab behind it): buried behind the slab, the door was a flat mirror
      // that threw the flashlight straight back into the camera as a huge glare.
      B.add('room', T.plane(), [x, 30, W / 2 + 1.05], [24, 44, 1], null, '#ffe2b0', { pane: { id: roomId(5, 5), w: 24, h: 44 }, emissive: 1.0 });
      B.box('std', x, 30, W / 2 + 0.6, 27, 47, 0.8, CHROME, null, { surf: [0, 0.2, 1] });
      continue;
    }
    B.box('std', x, 52, W / 2 + 0.6, span / n - 3, 43, 0.8, CHROME, null, { surf: [0, 0.2, 1] });
    B.add('room', T.plane(), [x, 52, W / 2 + 1.05], [span / n - 6, 40, 1], null, '#fff2d8', { pane: { id: roomId(5, 40 + i), w: span / n - 6, h: 40 }, emissive: 1.2 });
    // chrome mullions and a strip of neon in the window
    B.box('std', x, 52, W / 2 + 1.5, 1.4, 41, 0.6, CHROME, null, { surf: [0, 0.2, 1] });
  }
  for (let i = 0; i < 3; i++) B.add('room', T.plane(), [-L / 4 + (i * L) / 4, 55, -W / 2 - 0.8], [30, 30, 1], [0, Math.PI, 0], '#ffe6c0', { pane: { id: roomId(5, 60 + i), w: 30, h: 30 }, emissive: 1.0 });
  // awning
  B.add('std', T.profile('awning', [[0, 0], [22, -10], [22, -8], [0, 2]], 0.4, span + 20), [0, 80, W / 2], [1, 1, 1], [0, -Math.PI / 2, 0], '#b3261e', { surf: [DET.fabric, 0.8, 0] });
  // roof, parapet, the big neon sign on posts
  B.block('std', 0, H, 0, L - 4, 2, W - 4, '#4a4744', null, { surf: [DET.gravel, 0.9, 0] });
  B.rblock('std', 0, H, W / 2 - 2, L + 2, 8, 4, 0.8, '#c8c0b0', null, { surf: [DET.concrete, 0.8, 0] });
  for (const x of [-60, 60]) B.block('std', x, H + 2, W / 2 - 16, 4, 30, 4, '#333', null, { surf: [DET.rust, 0.6, 0.7] });
  B.box('std', 0, H + 46, W / 2 - 16, 170, 44, 6, '#1a0c12', null, { surf: [DET.panel, 0.5, 0.4] });
  B.add('neon', T.plane(), [0, H + 46, W / 2 - 12.8], [164, 40, 1], null, '#ffffff', { emissive: 2.6, uv: atlasUV('neonDiner') });
  B.add('neon', T.plane(), [0, H + 46, W / 2 - 19.2], [164, 40, 1], [0, Math.PI, 0], '#ffffff', { emissive: 2.4, uv: atlasUV('neonDiner') });
  // "EAT" blade sign on the corner
  B.box('std', L / 2 + 20, 70, W / 2 - 10, 4, 34, 60, '#1a0c12', null, { surf: [DET.panel, 0.5, 0.4] });
  B.add('neon', T.plane(), [L / 2 + 22.2, 70, W / 2 - 10], [56, 30, 1], [0, Math.PI / 2, 0], '#ffffff', { emissive: 2.6, uv: atlasUV('neonEat') });
  B.add('neon', T.plane(), [L / 2 + 17.8, 70, W / 2 - 10], [56, 30, 1], [0, -Math.PI / 2, 0], '#ffffff', { emissive: 2.6, uv: atlasUV('neonEat') });
  acUnit(B, L * 0.2, H + 2, -W * 0.2, 26, 20, 14, 0);
  ventStack(B, -L * 0.3, H + 2, -W * 0.25, 5, 18, '#7a7e82');
  if (DETAIL.level >= 1) {
    // a milk-shake on the sign post... chrome trim: skirt of the diner and rooftop vents
    for (let i = 0; i < 3; i++) B.cyl('std', -L * 0.35 + i * 14, H + 2, W * 0.1, 3, 6, '#9aa0a4', 8, 0.8, null, { surf: [0, 0.3, 0.8] });
    B.box('std', 0, 4, W / 2 + 2.3, L + 4, 3, 1, '#a51f25', null, { surf: [DET.panel, 0.4, 0.3] });
  }
  const c = Math.cos(ob.a || 0), s = Math.sin(ob.a || 0);
  const wx = (lx, lz) => ob.x + lx * c - lz * s, wy = (lx, lz) => ob.y + lx * s + lz * c;
  halos.push({ x: wx(0, W / 2 - 10), y: wy(0, W / 2 - 10), h: H + 46, color: '#ff3d8b', size: 260, strength: 0.35 });
  halos.push({ x: wx(L / 2 + 20, W / 2 - 10), y: wy(L / 2 + 20, W / 2 - 10), h: 70, color: '#ff7a1a', size: 120, strength: 0.3 });
}

function beam(B, bucket, x0, y0, z0, x1, y1, z1, rad, color, surf) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  B.add(bucket, T.cyl(5), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [rad, len, rad], [e.x, e.y, e.z], color, { surf, map: 'cyl' });
}
export { beam };

/** Radio objective: equipment hut and a lattice mast with blinking red beacons. */
export function radio(B, L, W, halos, ob) {
  B.rblock('std', 0, 0, 0, L * 0.9, 58, W * 0.9, 1, '#8d8a80', null, { surf: [DET.concrete, 0.88, 0] });
  B.rblock('std', 0, 58, 0, L * 0.96, 4, W * 0.96, 0.8, '#5d5a52', null, { surf: [DET.panel, 0.6, 0.4] });
  B.add('std', T.plane(), [0, 20, W * 0.45 + 0.4], [14, 38, 1], null, '#39352c', { surf: [DET.rust, 0.7, 0.6] });
  B.box('glow', 0, 44, W * 0.45 + 1, 5, 3, 2, '#ffd9a0', null, { emissive: 4, uv: atlasUV('white') });
  B.box('std', L * 0.3, 30, W * 0.45 + 0.4, 12, 16, 1, '#2a2c2e', null, { surf: [DET.corrugated, 0.5, 0.7] });
  if (DETAIL.level >= 1) {
    // hut details: AC on the roof, a cable ladder up to the mast, a generator exhaust
    acUnit(B, -L * 0.25, 62, W * 0.1, 20, 14, 12, 0.2);
    B.box('std', L * 0.1, 66, 0, 40, 1, 3, '#3a3c3e', null, { surf: [DET.rust, 0.5, 0.7] });
    ventStack(B, L * 0.3, 62, -W * 0.2, 2.4, 12);
  }
  const top = 540;
  const w0 = L * 0.34, w1 = 8;
  const corner = (y) => w0 + (w1 - w0) * ((y - 62) / (top - 62));
  const col = '#9a9ea2';
  const S = [DET.rust, 0.45, 0.85];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, 'std', sx * w0, 62, sz * w0, sx * w1, top, sz * w1, 2, col, S);
  for (let y = 62; y < top - 30; y += 48) {
    const y2 = Math.min(top, y + 48);
    const a = corner(y), b = corner(y2);
    for (const [px, pz, qx, qz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      beam(B, 'std', px * a, y, pz * a, qx * b, y2, qz * b, 0.9, col, S);
      beam(B, 'std', px * a, y, pz * a, qx * a, y, qz * a, 0.9, col, S);
    }
  }
  B.cyl('std', 0, top, 0, 1.5, 60, col, 6, 1, null, { surf: S });
  B.add('std', T.cyl(14, 1), [corner(300) + 6, 300, 0], [14, 4, 14], [0, 0, Math.PI / 2], '#d8d8d0', { surf: [DET.panel, 0.5, 0.3] });
  B.add('std', T.cyl(14, 1), [0, 380, -corner(380) - 5], [10, 3, 10], [Math.PI / 2, 0, 0], '#d8d8d0', { surf: [DET.panel, 0.5, 0.3] });
  const c = Math.cos(ob.a || 0), s = Math.sin(ob.a || 0);
  for (const y of [200, 380, top + 60]) {
    const k = corner(Math.min(y, top));
    for (const [sx, sz] of y > top ? [[0, 0]] : [[-1, -1], [1, 1]]) {
      B.add('blink', T.sphere(6, 4), [sx * k, y, sz * k], [3.5, 3.5, 3.5], null, '#ff2a1a', { emissive: 3.4 });
      halos.push({ x: ob.x + sx * k * c - sz * k * s, y: ob.y + sx * k * s + sz * k * c, h: y, color: '#ff2a1a', size: 90, blink: 1, strength: 0.8 });
    }
  }
}
