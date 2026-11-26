// The gates of a story level in the first-person view (JOURNEY.md §3.2, §4.1). A gate's
// obstacles are left out of the world's merged static meshes (world.js) and drawn here as
// separate meshes that move: a roller shutter rolls up into its housing, a door swings open
// (double doors from both ends), a yard gate slides aside, a cut fence falls flat, a
// barricade is blown apart, rubble explodes into a low mound, bars rise into the ceiling, a
// vehicle rolls out of the way. Each animation takes GATE_ANIM_TIME (1.2 s), driven by the
// snapshot's gate bits and the tick they changed (`view.level.gates[i] = { open, t }`), so a
// late joiner sees an old gate simply open; a change seen live throws dust, debris and sparks
// (the shared fx pools) and a light flash where it fits. The sound is the audio module's
// (`gate` event). A level's art may supply a gate's model (`ctx.level.gateModel(B, gate, o)`,
// drawn in the obstacle's own frame); it is then animated as a whole by the gate's kind.
//
// Models are built in a canonical frame: the gate's span along local +x (length L), its
// thickness along local z, its height up +y; the group sits at the obstacle's centre.

import * as THREE from 'three';
import { T, shadeHex, seededRng } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { buildVehicle, buildBus, buildTrailer } from './world-veh.js';
import { acquireFx, releaseFx, FR, F_ADD, F_STREAK, F_BOUNCE } from './fx-core.js';
import { levelGates, GATE_ANIM_TIME } from '../shared/level.js';

const TICK = 60;
const TAU = Math.PI * 2;

/** Default model height of a gate kind (the obstacle's `top` wins when it is lower). */
const KIND_H = { shutter: 130, door: 108, gate: 104, fence: 100, barricade: 84, rubble: 92, bars: 120, vehicle: 100 };

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @param {object} ctx renderer ctx (map, lights, shake, level art)
 * @param {object} deps { root, newBuilder(), matOf(bucket, tier), tier, gy(x, y), roofs (roofs3d or null), onChange(gate, open) }
 * @returns {object|null} null when the map has no gates
 */
export function createGates(ctx, deps) {
  const map = ctx.map;
  const list = levelGates(map);
  if (!list.length) return null;
  const { root, newBuilder, matOf, roofs } = deps;
  let tier = deps.tier;
  const gy = deps.gy || (() => 0);
  const group = new THREE.Group();
  group.name = 'gates3d';
  root.add(group);
  const meshes = [];
  const disposables = [];
  let fx = null;
  const fxOf = () => fx || (fx = acquireFx(ctx));
  let clock = 0;
  const secs = map.sections || [];

  /** A builder's geometry as meshes of the world's materials, under a fresh group. */
  function meshesOf(b) {
    const g = new THREE.Group();
    for (const { bucket, geometry } of b.finish()) {
      const m = new THREE.Mesh(geometry, matOf(bucket, tier));
      m.userData.bucket = bucket;
      m.castShadow = false;
      m.receiveShadow = bucket !== 'glow';
      m.name = 'gate-' + bucket;
      g.add(m);
      meshes.push(m);
      disposables.push(geometry);
    }
    return g;
  }

  /** The gate's canonical frame: angle with the span along local x, span, thickness, height. */
  function frameOf(o) {
    const across = o.h > o.w;
    return { a: (o.a || 0) + (across ? Math.PI / 2 : 0), L: across ? o.h : o.w, Tk: across ? o.w : o.h, across };
  }

  /** +1 when the section this gate leads to lies on the frame's +z side, else -1. */
  function sideOf(gt, o, a) {
    const to = secs[gt.to] || null;
    if (!to) return 1;
    const zx = -Math.sin(a), zy = Math.cos(a);
    return (to.x - o.x) * zx + (to.y - o.y) * zy >= 0 ? 1 : -1;
  }

  const pieces = [];
  list.forEach((gt) => {
    gt.obs.forEach((o, k) => {
      try {
        pieces.push(makePiece(gt, o, k));
      } catch (err) {
        console.warn('gates3d: gate model failed', gt.id, err);
      }
    });
  });
  const state = list.map(() => ({ target: false, p: 0, from: 0, start: -1e9, live: false, fxDone: 0 }));

  // ---- the models ----------------------------------------------------------------------------

  function makePiece(gt, o, k) {
    const { a, L, Tk, across } = frameOf(o);
    const H = Math.min(KIND_H[gt.kind] || 110, Number.isFinite(o.top) && o.top > 20 ? o.top : 999);
    const side = sideOf(gt, o, a);
    const rootG = new THREE.Group();
    rootG.position.set(o.x, gy(o.x, o.y), o.y);
    rootG.rotation.y = -a;
    group.add(rootG);
    const seed = (gt.i * 131 + k * 17 + 7) >>> 0;
    const rng = seededRng(seed);
    const piece = { gt, o, k, L, Tk, H, side, a, root: rootG, parts: [], kind: gt.kind, rng };
    const color = o.color || '#5d6166';
    // a gate under a roof gets a lintel up to the ceiling (static)
    const ceil = roofs ? roofs.ceilingAt(o.x, o.y) : 0;
    const frameB = newBuilder();
    frameB.obj(0, 0, 0, seed);
    if (ceil > H + 2) frameB.block('std', 0, H, 0, L + 2, ceil - H + 1, Math.max(Tk, 10), '#8a877e', null, { surf: [DET.plaster, 0.9, 0] });

    // the level's own model, animated as a whole
    const art = ctx.level;
    if (art && typeof art.gateModel === 'function') {
      const b = newBuilder();
      b.obj(0, 0, 0, seed);
      let drew = false;
      try { drew = !!art.gateModel(b, gt, o); } catch (err) { console.warn('gates3d: level gate model failed', err); }
      if (drew) {
        const inner = meshesOf(b);
        if (across) inner.rotation.y = Math.PI / 2;
        const leaf = new THREE.Group();
        leaf.add(inner);
        rootG.add(leaf);
        addPartsFor(piece, leaf);
        rootG.add(meshesOf(frameB));
        return piece;
      }
    }
    const B = frameB;
    switch (gt.kind) {
      case 'shutter': shutter(piece, B, color); break;
      case 'door': door(piece, B, color); break;
      case 'gate': slideGate(piece, B, color); break;
      case 'fence': fence(piece, B); break;
      case 'barricade': barricade(piece, B); break;
      case 'rubble': rubble(piece, B); break;
      case 'bars': bars(piece, B, color); break;
      case 'vehicle': vehicle(piece, B, color); break;
      default: shutter(piece, B, color);
    }
    rootG.add(meshesOf(B));
    return piece;
  }

  /** A leaf that moves as a whole by the piece's kind (the level's own model). */
  function addPartsFor(piece, leaf) {
    const { L, H, side } = piece;
    switch (piece.kind) {
      case 'door': piece.parts.push({ g: leaf, anim: 'swingWhole', side }); break;
      case 'gate': piece.parts.push({ g: leaf, anim: 'slide', dist: L * 0.96 }); break;
      case 'fence': piece.parts.push({ g: leaf, anim: 'fall', side }); break;
      case 'bars': piece.parts.push({ g: leaf, anim: 'rise', dist: H + 6 }); break;
      case 'vehicle': piece.parts.push({ g: leaf, anim: 'roll', dist: L + 40 }); break;
      case 'barricade': case 'rubble': piece.parts.push({ g: leaf, anim: 'sink', side }); break;
      default: piece.parts.push({ g: leaf, anim: 'rise', dist: H + 6 });
    }
  }

  function leafBuilder(seed) {
    const b = newBuilder();
    b.obj(0, 0, 0, seed);
    return b;
  }

  function shutter(piece, B, color) {
    const { L, Tk, H, root } = piece;
    const steel = '#6f7477', S = { surf: [DET.rust, 0.55, 0.7] };
    const hc = H - 18;
    // guides at both ends, the drum housing on top
    for (const s of [-1, 1]) B.block('std', s * (L / 2 - 3), 0, 0, 6, hc, Math.min(Tk, 14), steel, null, S);
    B.rblock('std', 0, hc, 0, L + 6, 18, Math.max(12, Math.min(Tk + 6, 26)), 3, shadeHex(steel, -0.1), null, S);
    // the curtain: slats, a bottom bar with a lock, a stencil
    const b = leafBuilder(piece.gt.i * 7 + 1);
    const cc = shadeHex(color, 0.1);
    const w = L - 10;
    b.block('std', 0, 0, 0, w, hc, 3, cc, null, { surf: [DET.panel, 0.55, 0.55] });
    // horizontal slats: a rounded rib every 6 units, alternately lit and shaded
    for (let y = 5, k = 0; y < hc - 2; y += 6, k++) b.box('std', 0, y, 0, w, 2.2, 4.2, shadeHex(cc, k % 2 ? -0.16 : 0.06), null, { surf: [DET.panel, 0.5, 0.6] });
    b.block('std', 0, 0, 0, w + 1, 4, 5, '#3c3f41', null, S);
    b.box('std', w * 0.3, 3, 2.8, 4, 5, 1.4, '#9a8b52', null, { surf: [DET.rust, 0.5, 0.8] });
    b.add('decal', T.plane(), [0, hc * 0.55, 1.7], [Math.min(w * 0.6, 60), 14, 1], null, '#ffffff', { uv: atlasUV('stripeYB'), noAO: true });
    b.add('decal', T.plane(), [0, hc * 0.55, -1.7], [Math.min(w * 0.6, 60), 14, 1], [0, Math.PI, 0], '#ffffff', { uv: atlasUV('stripeYB'), noAO: true });
    const leaf = meshesOf(b);
    root.add(leaf);
    piece.parts.push({ g: leaf, anim: 'roll-up', hc });
  }

  function door(piece, B, color) {
    const { L, Tk, H, root, side, rng } = piece;
    const frame = '#5a5652', S = { surf: [DET.panel, 0.5, 0.5] };
    // jambs and head
    for (const s of [-1, 1]) B.block('std', s * (L / 2 - 2.5), 0, 0, 5, H, Math.max(Tk, 10) + 2, frame, null, S);
    B.block('std', 0, H - 6, 0, L, 6, Math.max(Tk, 10) + 2, frame, null, S);
    const dbl = L > 110;
    const w = (L - 5) / (dbl ? 2 : 1) - 1;
    const hd = H - 7;
    const wood = /^#(6|7|8|9)[0-9a-f]{1}[4-6]/i.test(color);
    const leafColor = shadeHex(color, 0.15);
    const makeLeaf = (sgn) => {
      // built from the hinge (x = 0) toward +x (sgn 1) or -x (sgn -1)
      const b = leafBuilder(piece.gt.i * 11 + sgn + 3 + piece.k * 5);
      const cx = sgn * w / 2;
      b.block('std', cx, 0.5, 0, w, hd, 3.2, leafColor, null, { surf: [wood ? DET.wood : DET.panel, 0.55, wood ? 0 : 0.45] });
      // kick plate, vision panel, push bar / handle
      b.block('std', cx, 0.5, 0, w - 4, 16, 3.6, '#7e8286', null, { surf: [DET.panel, 0.4, 0.8] });
      b.box('glass', cx, hd * 0.68, 0, w * 0.34, hd * 0.24, 3.6, '#46545c', null, { surf: [DET.glass, 0.1, 0.2] });
      b.box('std', cx + sgn * w * 0.2, hd * 0.45, 2.6, w * 0.5, 2.4, 2, '#b8bcbf', null, { surf: [DET.panel, 0.3, 0.9] });
      b.box('std', cx + sgn * w * 0.2, hd * 0.45, -2.6, w * 0.5, 2.4, 2, '#b8bcbf', null, { surf: [DET.panel, 0.3, 0.9] });
      for (const y of [8, hd - 10]) b.cyl('std', 0, y, 0, 1.2, 8, '#8a8d8f', 6, 1, null, { surf: [DET.panel, 0.4, 0.8] });
      return meshesOf(b);
    };
    const left = new THREE.Group();
    left.position.set(-L / 2 + 5, 0, 0);
    left.add(makeLeaf(1));
    root.add(left);
    piece.parts.push({ g: left, anim: 'swing', dir: -side, max: dbl ? 1.55 : 1.7 });
    if (dbl) {
      const right = new THREE.Group();
      right.position.set(L / 2 - 5, 0, 0);
      right.add(makeLeaf(-1));
      root.add(right);
      piece.parts.push({ g: right, anim: 'swing', dir: side, max: 1.55 });
    }
  }

  function slideGate(piece, B, color) {
    const { L, H, root } = piece;
    const steel = shadeHex(color, 0.05), S = { surf: [DET.rust, 0.55, 0.75] };
    for (const s of [-1, 1]) B.block('std', s * (L / 2 - 3), 0, 0, 7, H + 6, 7, '#5c6064', null, S);
    B.block('std', 0, 0, 0, L, 2, 8, '#3a3c3d', null, S);
    const b = leafBuilder(piece.gt.i * 13 + 5);
    const w = L - 12, hh = H - 6;
    b.box('std', 0, hh, 0, w, 3.2, 3.2, steel, null, S);
    b.box('std', 0, 6, 0, w, 3.2, 3.2, steel, null, S);
    for (const s of [-1, 1]) b.box('std', s * w / 2, hh / 2 + 3, 0, 3.2, hh, 3.2, steel, null, S);
    // a diagonal brace, the chain link
    const dl = Math.hypot(w, hh - 6), da = Math.atan2(hh - 6, w);
    b.box('std', 0, hh / 2 + 3, 0.6, dl, 2, 2, steel, [0, 0, da], S);
    b.add('fence', T.plane(), [0, hh / 2 + 3, 0], [w, hh - 4, 1], null, '#7d8387', { uvScale: [w / 16, (hh - 4) / 16] });
    for (const s of [-1, 1]) b.cylZ('std', s * w * 0.35, 3, 0, 3, 5, '#2a2a2a', 10);
    // a sign on the gate
    b.add('decal', T.plane(), [w * 0.2, hh * 0.6, 2], [26, 16, 1], null, '#ffffff', { uv: atlasUV('sign'), noAO: true });
    const leaf = meshesOf(b);
    root.add(leaf);
    piece.parts.push({ g: leaf, anim: 'slide', dist: L * 0.96 });
  }

  function fence(piece, B) {
    const { L, H, root, side } = piece;
    const S = { surf: [DET.rust, 0.45, 0.9] };
    for (const s of [-1, 1]) B.cyl('std', s * (L / 2 - 2), 0, 0, 2.2, H + 4, '#8c9296', 8, 1, null, S);
    const b = leafBuilder(piece.gt.i * 17 + 9);
    const w = L - 6;
    b.cylX('std', 0, H - 2, 0, 1.4, w, '#8c9296', 8, S);
    b.cylX('std', 0, 3, 0, 0.9, w, '#8c9296', 6, S);
    b.add('fence', T.plane(), [0, H / 2, 0], [w, H - 4, 1], null, '#7a8084', { uvScale: [w / 16, (H - 4) / 16] });
    // barbed wire on top
    for (let x = -w / 2; x < w / 2; x += 9) b.box('std', x, H + 1.5, 0, 6, 0.6, 0.6, '#6c7073', [0, 0, 0.6], S);
    const leaf = meshesOf(b);
    root.add(leaf);
    piece.parts.push({ g: leaf, anim: 'fall', side });
  }

  /** Chunks that fly apart: a leaf per chunk with its resting place on the ground. */
  function scatterParts(piece, chunks, spread) {
    const { L, side, rng } = piece;
    chunks.forEach((c, i) => {
      const g = meshesOf(c.b);
      g.position.set(c.x, 0, c.z);
      piece.root.add(g);
      const fwd = side * (40 + rng.next() * spread);
      piece.parts.push({
        g, anim: 'fly', x0: c.x, z0: c.z,
        x1: c.x + (rng.next() - 0.5) * L * 0.9, z1: c.z + fwd, y1: c.rest || 0,
        up: 30 + rng.next() * 50, rx: (rng.next() - 0.5) * 2.4, rz: (rng.next() - 0.5) * 2.4, ry: (rng.next() - 0.5) * 3, delay: i * 0.03,
      });
    });
  }

  function barricade(piece, B) {
    const { L, Tk, H, rng } = piece;
    const woodS = { surf: [DET.wood, 0.85, 0] };
    const chunks = [];
    // sandbags along the bottom (stay: they are knocked flat, not blown away)
    for (let x = -L / 2 + 12; x < L / 2 - 6; x += 22) B.add('std', T.pillow(10, 5, 0.5), [x, 6, 0], [11, 6, Math.max(8, Tk * 0.35)], [0, rng.range(-0.2, 0.2), 0], '#8a7a55', { surf: [DET.fabric, 0.95, 0] });
    // planks across (three chunks), a car door, an oil drum, a pallet
    const n = Math.max(3, Math.round(L / 60));
    for (let i = 0; i < n; i++) {
      const b = leafBuilder(piece.gt.i * 19 + i);
      const x = -L / 2 + (i + 0.5) * (L / n), w = L / n + 8;
      for (let k = 0; k < 4; k++) b.box('std', 0, 18 + k * 16 + rng.range(-3, 3), rng.range(-2, 2), w + rng.range(-6, 10), 7, 2.6, shadeHex('#6b4f33', rng.range(-0.15, 0.1)), [0, 0, rng.range(-0.25, 0.25)], woodS);
      b.block('std', rng.range(-w * 0.3, w * 0.3), 0, -3, 6, H - 8, 5, '#5b4128', [rng.range(-0.1, 0.1), 0, rng.range(-0.08, 0.08)], woodS);
      if (i % 2 === 0) b.rblock('std', 0, 0, 5, 30, 38, 4, 1.5, '#7a2f24', [0, 0, rng.range(-0.3, 0.3)], { surf: [DET.panel, 0.5, 0.5] });
      else b.cyl('std', 0, 0, 6, 11, 32, '#3d4a3a', 12, 1, null, { surf: [DET.rust, 0.7, 0.6] });
      chunks.push({ b, x, z: 0, rest: 0 });
    }
    scatterParts(piece, chunks, 120);
  }

  function rubble(piece, B) {
    const { L, Tk, H, rng } = piece;
    const conc = ['#7d7a73', '#6f6c66', '#8a867e', '#5f5c57'];
    // the low mound left behind (static)
    for (let i = 0; i < Math.max(3, L / 30); i++) {
      B.add('std', T.dodeca(), [rng.range(-L / 2, L / 2), 4, rng.range(-Tk, Tk)], [rng.range(14, 24), rng.range(6, 10), rng.range(12, 20)], [0, rng.range(0, 6), 0], rng.pick(conc), { wobble: { amp: 0.3, seed: i }, surf: [DET.cracked, 0.9, 0] });
    }
    // the pile: slabs, blocks, rebar, in chunks that blow out
    const chunks = [];
    const n = Math.max(4, Math.round(L / 45));
    for (let i = 0; i < n; i++) {
      const b = leafBuilder(piece.gt.i * 23 + i);
      const x = -L / 2 + (i + 0.5) * (L / n);
      const hh = H * rng.range(0.55, 1);
      b.add('std', T.dodeca(), [0, hh * 0.4, 0], [L / n * 0.75, hh * 0.45, Math.max(20, Tk * 0.7)], [0, rng.range(0, 6), 0], rng.pick(conc), { wobble: { amp: 0.35, seed: i + 3 }, surf: [DET.cracked, 0.9, 0] });
      b.box('std', rng.range(-8, 8), hh * 0.75, 0, L / n * 0.9, 9, Math.max(14, Tk * 0.5), shadeHex(rng.pick(conc), -0.05), [rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), rng.range(-0.5, 0.5)], { surf: [DET.concrete, 0.9, 0] });
      for (let k = 0; k < 2; k++) b.box('std', rng.range(-10, 10), hh * rng.range(0.5, 0.9), rng.range(-4, 4), 1.2, 1.2, 40, '#5a3a28', [rng.range(-0.6, 0.6), rng.range(0, 3), rng.range(-0.6, 0.6)], { surf: [DET.rust, 0.6, 0.8] });
      chunks.push({ b, x, z: 0, rest: 0 });
    }
    scatterParts(piece, chunks, 180);
  }

  function bars(piece, B, color) {
    const { L, Tk, H, root } = piece;
    const S = { surf: [DET.rust, 0.5, 0.85] };
    for (const s of [-1, 1]) B.block('std', s * (L / 2 - 3), 0, 0, 6, H, Math.max(Tk, 10), '#4a4d50', null, S);
    const b = leafBuilder(piece.gt.i * 29 + 3);
    const w = L - 12, steel = shadeHex(color, -0.1);
    for (let x = -w / 2 + 5; x <= w / 2 - 5; x += 11) b.cyl('std', x, 0, 0, 1.6, H - 2, steel, 8, 1, null, S);
    for (const y of [10, H * 0.5, H - 8]) b.box('std', 0, y, 0, w, 4, 4.5, steel, null, S);
    b.box('std', w * 0.3, H * 0.5, 3, 8, 12, 3, '#3a3c3e', null, S);
    const leaf = meshesOf(b);
    root.add(leaf);
    piece.parts.push({ g: leaf, anim: 'rise', dist: H + 4 });
  }

  function vehicle(piece, B, color) {
    const { L, Tk, root, o } = piece;
    const b = leafBuilder(piece.gt.i * 31 + 11);
    const depth = Math.max(Tk, L >= 200 ? 78 : 70);
    const vo = { id: o.id, x: o.x, y: o.y, a: 0, w: L, h: depth, color: color === '#5d6166' ? '#8a8e6a' : color, wrecked: true, kind: 'truck' };
    if (/train|box|freight|rail/i.test(o.style || '')) buildTrailer(b, { ...vo, kind: 'semi', w: L });
    else if (L >= 200) buildBus(b, { ...vo, kind: 'bus', color: '#b8902a' }, false);
    else buildVehicle(b, { ...vo, kind: L >= 150 ? 'truck' : 'van' });
    const leaf = meshesOf(b);
    root.add(leaf);
    piece.parts.push({ g: leaf, anim: 'roll', dist: L + 40 });
    void B;
  }

  // ---- animation -----------------------------------------------------------------------------

  /** Pose every part of `piece` for open progress p (0 shut .. 1 open). */
  function pose(piece, p) {
    for (const part of piece.parts) {
      const g = part.g;
      switch (part.anim) {
        case 'roll-up': {
          const e = easeInOut(p);
          const s = 1 - 0.93 * e;
          g.scale.y = s;
          g.position.y = part.hc * (1 - s);
          g.position.x = p > 0 && p < 1 ? Math.sin(p * 90) * 0.4 : 0;
          break;
        }
        case 'swing': g.rotation.y = part.dir * easeOut(p) * part.max; break;
        case 'swingWhole': {
          g.position.x = -piece.L / 2;
          g.children[0].position.x = piece.L / 2;
          g.rotation.y = -part.side * easeOut(p) * 1.6;
          break;
        }
        case 'slide': g.position.x = easeInOut(p) * part.dist; break;
        case 'rise': g.position.y = easeInOut(p) * part.dist; break;
        case 'roll': {
          const e = easeInOut(p);
          g.position.x = e * part.dist;
          g.rotation.y = Math.sin(e * Math.PI) * 0.05;
          break;
        }
        case 'fall': {
          // cut free, it tips slowly, then falls fast and bounces once on the ground
          const f = p < 0.85 ? (p / 0.85) ** 2 : 1 - Math.sin(((p - 0.85) / 0.15) * Math.PI) * 0.06;
          g.rotation.x = part.side * f * (Math.PI / 2 - 0.05);
          break;
        }
        case 'fly': {
          const t = clamp01((p - part.delay) / (1 - part.delay));
          const e = easeOut(t);
          g.position.set(part.x0 + (part.x1 - part.x0) * e, part.up * 4 * t * (1 - t) + part.y1 * e, part.z0 + (part.z1 - part.z0) * e);
          g.rotation.set(part.rx * e, part.ry * e, part.rz * e);
          break;
        }
        case 'sink': {
          const e = easeOut(p);
          g.scale.y = 1 - 0.8 * e;
          g.position.z = part.side * e * 20;
          break;
        }
        default: break;
      }
    }
  }

  // ---- effects ----------------------------------------------------------------------------------

  const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
  const DUST = C('#8a8074'), DUST2 = C('#6e665c'), SPARK = C('#ffd08a', 3.2), EMBER = C('#ff9a40', 2.4), CHUNK = C('#5e5a54');

  /** World point of the piece's local (lx, lz). */
  function at(piece, lx, lz) {
    const c = Math.cos(piece.a), s = Math.sin(piece.a);
    return [piece.o.x + lx * c - lz * s, piece.o.y + lx * s + lz * c];
  }

  function burstFx(piece, open) {
    const f = fxOf();
    if (!f) return;
    const R = Math.random;
    const { L, H, kind, side } = piece;
    const base = gy(piece.o.x, piece.o.y);
    const dust = (n, h0, h1, spread, sz, life = 1.6) => {
      for (let i = 0; i < n; i++) {
        const [x, y] = at(piece, (R() - 0.5) * L, (R() - 0.5) * 30);
        f.spawn(x, base + h0 + R() * (h1 - h0), y, (R() - 0.5) * spread, 10 + R() * 30, (R() - 0.5) * spread + side * 20, life * (0.7 + R() * 0.6), sz * 0.6, sz * 2.2, R() < 0.5 ? DUST : DUST2, 0.5, R() < 0.5 ? FR.DUST : FR.SMOKE2, 0, -6, 1.4);
      }
    };
    const sparks = (n, lx, h, spread = 1) => {
      for (let i = 0; i < n; i++) {
        const [x, y] = at(piece, lx + (R() - 0.5) * 6, (R() - 0.5) * 6);
        const k = f.spawn(x, base + h, y, (R() - 0.5) * 260 * spread, 40 + R() * 180, (R() - 0.5) * 260 * spread, 0.35 + R() * 0.4, 1.4, 0.5, R() < 0.3 ? EMBER : SPARK, 1, FR.SPARK, F_ADD | F_STREAK | F_BOUNCE, 700, 0.8);
        f.stretchLast(k, 1.8);
      }
    };
    const chunks = (n, h, speed) => {
      for (let i = 0; i < n; i++) {
        const [x, y] = at(piece, (R() - 0.5) * L, (R() - 0.5) * 20);
        const a = R() * TAU;
        f.spawn(x, base + h * R(), y, Math.cos(a) * speed * R() + side * 60, 80 + R() * 200, Math.sin(a) * speed * R(), 1.2 + R() * 0.8, 3 + R() * 4, 3, CHUNK, 1, FR.CHUNK, F_BOUNCE, 900, 0.5);
      }
    };
    switch (kind) {
      case 'shutter':
        dust(open ? 10 : 6, H * 0.8, H, 40, 16, 1.4);
        dust(6, 0, 6, 70, 12);
        break;
      case 'door': dust(4, 0, 4, 50, 10, 1.1); break;
      case 'gate':
        sparks(8, -L / 2, 4, 0.6);
        dust(5, 0, 5, 60, 12);
        break;
      case 'fence':
        sparks(14, -L / 2 + 2, H * 0.5);
        sparks(14, L / 2 - 2, H * 0.5);
        break;
      case 'bars':
        sparks(6, 0, H - 4, 0.5);
        dust(8, H - 10, H + 10, 40, 14, 1.8);
        break;
      case 'vehicle':
        dust(14, 0, 8, 120, 18, 1.8);
        sparks(10, L / 2, 6, 0.8);
        break;
      case 'barricade':
        dust(16, 0, H * 0.6, 160, 20, 1.8);
        chunks(18, H * 0.8, 220);
        break;
      case 'rubble': {
        dust(28, 0, H, 260, 30, 2.6);
        chunks(26, H, 320);
        if (ctx.lights && open) ctx.lights.flash(piece.o.x, piece.o.y, base + 40, '#ffb060', 3.5, 420, 0.4);
        break;
      }
      default: break;
    }
    // heavy ones shake the camera when it is close
    if (kind === 'rubble' || kind === 'barricade' || kind === 'vehicle') {
      const cam = ctx.camera.position;
      const d = Math.hypot(cam.x - piece.o.x, cam.z - piece.o.y);
      if (d < 900) ctx.shake((kind === 'rubble' ? 0.7 : 0.4) * (1 - d / 900));
    }
  }

  /** The fence lands: a puff of dust along it. */
  function landFx(piece) {
    const f = fxOf();
    if (!f) return;
    const R = Math.random;
    const base = gy(piece.o.x, piece.o.y);
    for (let i = 0; i < 12; i++) {
      const [x, y] = at(piece, (R() - 0.5) * piece.L, piece.side * (20 + R() * piece.H * 0.8));
      f.spawn(x, base + 2, y, (R() - 0.5) * 80, 10 + R() * 20, (R() - 0.5) * 80, 1.2 + R() * 0.6, 10, 26, DUST, 0.45, FR.DUST, 0, -4, 1.4);
    }
  }

  // ---- per frame ----------------------------------------------------------------------------------

  function update(view, frame) {
    const dt = Math.min(0.1, Math.max(0, frame.dt || 0));
    clock += dt;
    const lv = view && view.level;
    if (lv && Array.isArray(lv.gates)) {
      for (let i = 0; i < state.length; i++) {
        const g = lv.gates[i];
        if (!g) continue;
        const st = state[i];
        const want = !!g.open;
        if (want !== st.target) {
          const age = Math.max(0, ((view.tick || 0) - (g.t || 0)) / TICK);
          st.from = st.p;
          st.target = want;
          st.start = clock - age;
          st.live = age < 0.8;
          st.fxDone = 0;
          if (deps.onChange) deps.onChange(list[i], want);
        }
      }
    }
    if (fx) fx.begin(frame);
    for (let i = 0; i < state.length; i++) {
      const st = state[i];
      const k = clamp01((clock - st.start) / GATE_ANIM_TIME);
      const p = st.target ? st.from + (1 - st.from) * k : st.from * (1 - k);
      if (st.live && st.fxDone === 0 && k > 0) {
        st.fxDone = 1;
        if (fx || (fx = acquireFx(ctx))) fx.begin(frame);
        for (const pc of pieces) if (pc.gt.i === i) burstFx(pc, st.target);
      }
      if (st.live && st.fxDone === 1 && k >= 1) {
        st.fxDone = 2;
        for (const pc of pieces) if (pc.gt.i === i && pc.kind === 'fence' && st.target) landFx(pc);
      }
      if (p === st.p && st.poseDone) continue;
      st.p = p;
      st.poseDone = true;
      for (const pc of pieces) if (pc.gt.i === i) pose(pc, p);
    }
  }

  // shut as built
  for (const pc of pieces) pose(pc, 0);

  return {
    group,
    pieces,
    /** Visual open progress of gate i (0..1). */
    progress(i) { return state[i] ? state[i].p : 0; },
    /** True for an obstacle drawn here (world.js leaves it out of the static meshes). */
    owns(o) { return !!o && !!o.gate; },
    update,
    setQuality(t) {
      tier = t;
      for (const m of meshes) m.material = matOf(m.userData.bucket, tier);
    },
    get stats() { return { gates: list.length, pieces: pieces.length, meshes: meshes.length }; },
    dispose() {
      for (const d of disposables) d.dispose();
      root.remove(group);
      if (fx) releaseFx(ctx);
      fx = null;
    },
  };
}
