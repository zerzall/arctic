// The walk-in buildings of the open maps (shared/maps-walkin.js): one model per `map.walkins` record,
// drawn into the world's static builder in the building's own frame (local x along its width, local z
// along its depth; the front is +z):
//   the shell   outer walls as skins around the real doorways and the ground floor's windows (see-through
//               glass, a broken pane or boards), reveals through the wall's thickness, the storeys above
//               the ceiling with recessed windows of interior-mapped rooms, the roof (flat with a parapet
//               and plant, a gable or a metal roof: world-bld.js walkinTop) and a sign over the shop door
//   the inside  the inner faces of the outer walls (plaster, drywall, wallpaper, block), skirting, the
//               floor (linoleum, carpet, boards, tile, concrete), the partitions with door frames and an
//               open leaf in every doorway; the ceiling and its fixtures are the roof's (roofs3d.js, a
//               `shell` roof), the lamps are map lights
//   furniture   every 'wi:*' styled obstacle (shelves, the till, coolers, pallet racks, crates, sofas,
//               beds, desks, filing cabinets, kitchens, workbenches...) drawn in its own frame
//   the stair   a roof terrace's wing (shared/maps-walkin.js roofTerrace): its walls, the flight's treads
//               and stringer, the parapet coping and a railing
// The obstacles of a walk-in (walls, partitions, furniture) are drawn here, never by world.js's generic
// models.

import { T, shadeHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { Face, DETAIL, skinBand, windowUnit, signBoard, shutter, downspout, railing, roomId } from './world-arch.js';
import { walkinTop } from './world-bld.js';
import { SIGN_NAMES } from './world-tex.js';
import { WALKIN_STOREY, WALKIN_TI } from '../shared/maps-walkin.js';

/** Doorway height (the frame's head). */
const DOOR_H = 100;
/** Ground floor windows: sill and head. */
const WIN_SILL = 34, WIN_HEAD = 92;

/** Floor finishes: [colour, detail layer, roughness]. */
const FLOORS = {
  linoleum: ['#b9b4a6', DET.linoleum, 0.55], carpet: ['#6a6a72', DET.carpet, 0.95], wood: ['#7a5a3c', DET.wood, 0.7],
  tile: ['#c9c2b4', DET.tileceramic, 0.45], concrete: ['#8c8a84', DET.concrete, 0.85], terrazzo: ['#bdb8ae', DET.terrazzo, 0.4],
};
/** Wall finishes inside: [colour, detail layer, roughness]. */
const WALLS = {
  plaster: ['#d8d0c0', DET.plaster, 0.9], drywall: ['#cfcbc0', DET.drywall, 0.9], wallpaper: ['#b9a98a', DET.wallpaper, 0.9],
  block: ['#a9a69e', DET.cinder, 0.9], brick: ['#8a5a44', DET.brick, 0.9],
};

/** Face index of a side ('s' front +z, 'n', 'e' +x, 'w') and the face coordinate t of a local offset along it. */
const FACE_OF = { s: 0, n: 1, e: 2, w: 3 };
const tOf = (side, at) => (side === 's' || side === 'w' ? at : -at);

/** A face of the inside of the outer walls: the inner plane, facing into the room. */
class InFace extends Face {
  constructor(B, i, L, W, t) {
    super(B, i, L, W);
    this.half -= t;
    this.len -= 2 * t;
  }
  rect(bucket, t, y, out, w, h, color, o) {
    this.B.quad(bucket, this.P(t, y, out), [-this.a[0] * w, 0, -this.a[2] * w], [0, h, 0], color, o);
  }
}

/**
 * The walk-in buildings' art.
 * @param {object} ctx renderer ctx (map)
 * @param {object} deps { gy(x, y) → ground height }
 * @returns {{ obstacle(B, o): boolean, build(B), stats }}
 */
export function createWalkins(ctx, deps = {}) {
  const map = ctx.map;
  const recs = map.walkins || [];
  const gy = deps.gy || (() => 0);
  let tris = 0;

  /** Walls of a walk-in are drawn with its shell; its furniture here, in the obstacle's frame. */
  function obstacle(B, o) {
    if (o.walkin === undefined) return false;
    const st = typeof o.style === 'string' ? o.style.slice(3) : '';
    if (st === 'ext' || st === 'part' || st === 'wing' || st === 'stairwall') return true;
    const t0 = B.triangles;
    try { prop(B, st, o); } catch (err) { console.warn('walkin: prop failed', st, err); }
    tris += B.triangles - t0;
    return true;
  }

  function build(B) {
    for (const rec of recs) {
      const t0 = B.triangles;
      try {
        B.obj(rec.x, rec.y, rec.a, 7700 + rec.i * 13);
        B.setJitter(0.02);
        shell(B, rec);
        if (rec.stair) stair(B, rec);
      } catch (err) {
        console.warn('walkin: building failed', rec.id, err);
      }
      tris += B.triangles - t0;
    }
  }

  // ---- the shell -------------------------------------------------------------------------------------

  function shell(B, rec) {
    const L = rec.w, W = rec.h, t = rec.t, ceil = rec.ceil, H = rec.H;
    const adobe = rec.look === 'adobe';
    const outSurf = adobe ? [DET.stucco, 0.92, 0] : rec.type === 'warehouse' || rec.type === 'garage' ? [DET.corrugated, 0.6, 0.45] : hash01(rec.i * 7 + 3) < 0.5 ? [DET.brick, 0.88, 0] : [DET.plaster, 0.86, 0];
    const wo = { noJitter: true, surf: outSurf };
    const [fc, fl, fr] = FLOORS[rec.floor] || FLOORS.concrete;
    const [ic, il, ir] = WALLS[rec.wall] || WALLS.plaster;
    const io = { noJitter: true, surf: [il, ir, 0] };
    const frame = shadeHex(rec.trim, -0.1), FS = { noJitter: true, surf: [DET.wood, 0.75, 0] };
    // the floor
    B.block('std', 0, 0, 0, L - 2 * t + 0.5, 1.6, W - 2 * t + 0.5, fc, null, { noJitter: true, surf: [fl, fr, 0] });
    // the storeys over the ceiling (a dark core behind their skins hides the building's inside)
    if (H > ceil + 8) B.block('std', 0, ceil + 7, 0, L - 2 * t, H - ceil - 8, W - 2 * t, '#0c0d0f', null, { noJitter: true, surf: [0, 0.95, 0] });
    for (const side of ['s', 'n', 'e', 'w']) {
      const fi = FACE_OF[side];
      const F = new Face(B, fi, L, W);
      const In = new InFace(B, fi, L, W, t);
      const doors = rec.doors.filter((d) => d.side === side);
      const wins = rec.windows.filter((q) => q.side === side);
      const holes = [], inHoles = [];
      for (const d of doors) {
        const tc = tOf(side, d.at);
        holes.push({ t0: tc - d.w / 2, t1: tc + d.w / 2, y0: 0, y1: DOOR_H });
        inHoles.push({ t0: tc - d.w / 2, t1: tc + d.w / 2, y0: 0, y1: DOOR_H });
      }
      for (const q of wins) {
        const tc = tOf(side, q.at);
        holes.push({ t0: tc - q.w / 2, t1: tc + q.w / 2, y0: WIN_SILL, y1: WIN_HEAD });
        inHoles.push({ t0: tc - q.w / 2, t1: tc + q.w / 2, y0: WIN_SILL, y1: WIN_HEAD });
      }
      holes.sort((p, q) => p.t0 - q.t0);
      inHoles.sort((p, q) => p.t0 - q.t0);
      // outside: a plinth, the ground storey, the storeys above
      skinBand(F, 0, ceil, holes, rec.color, wo);
      if (!adobe) {
        const base = holes.filter((h) => h.y0 <= 0);
        skinBand(F, 0, 9, base, shadeHex(rec.color, -0.3), { noJitter: true, surf: [DET.concrete, 0.9, 0] });
      }
      upper(B, rec, F, side, wo);
      // inside: the wall's inner face, skirting between the openings
      skinBand(In, 0, ceil, inHoles, ic, io);
      let cur = -In.len / 2;
      for (const h of inHoles.filter((q) => q.y0 <= 0).concat([{ t0: In.len / 2, t1: In.len / 2 }])) {
        if (h.t0 - cur > 2) In.box('std', (cur + h.t0) / 2, 3, -1.4, h.t0 - cur, 6, 1.4, shadeHex(ic, -0.35), { noJitter: true, surf: [DET.wood, 0.7, 0] });
        cur = h.t1;
      }
      // doorways: reveals through the wall, the frame on both faces, the threshold, open leaves inside
      for (const d of doors) {
        const tc = tOf(side, d.at), dw = d.w;
        const rc = shadeHex(rec.color, -0.25);
        F.reveal('std', 0, tc - dw / 2, DOOR_H / 2, 0, 0, DOOR_H, t, rc, wo);
        F.reveal('std', 1, tc + dw / 2, DOOR_H / 2, 0, 0, DOOR_H, t, rc, wo);
        F.reveal('std', 2, tc, DOOR_H, 0, dw, 0, t, shadeHex(rc, -0.1), wo);
        F.box('std', tc, 0.8, -t, dw, 1.6, t, '#77736b', { noJitter: true, surf: [DET.concrete, 0.8, 0] });
        if (d.shutter) {
          // a roll-up shutter wound up under the head: the drum and the guides
          F.box('std', tc, DOOR_H + 7, 1, dw + 8, 12, 9, '#4a4e52', { noJitter: true, surf: [DET.rust, 0.6, 0.6] });
          for (const sd of [-1, 1]) F.box('std', tc + sd * (dw / 2 + 2), DOOR_H / 2, 1, 3, DOOR_H, 4, '#3a3d40', { noJitter: true, surf: [DET.rust, 0.6, 0.7] });
          F.span('decal', tc - dw / 2, tc + dw / 2, DOOR_H - 14, DOOR_H, -0.8, '#ffffff', { uv: atlasUV('garage'), noAO: true });
          continue;
        }
        for (const [Fx, out] of [[F, 0], [In, 0]]) {
          Fx.box('std', tc - dw / 2 - 2, DOOR_H / 2, out, 4, DOOR_H, 1.6, frame, FS);
          Fx.box('std', tc + dw / 2 + 2, DOOR_H / 2, out, 4, DOOR_H, 1.6, frame, FS);
          Fx.box('std', tc, DOOR_H + 2, out, dw + 8, 4, 1.6, frame, FS);
        }
        const dbl = dw >= 96;
        const leaf = dbl ? dw / 2 - 2 : dw - 4;
        const glazed = rec.type === 'kiosk' || rec.type === 'shop' || rec.type === 'office';
        for (const sd of dbl ? [-1, 1] : [hash01(rec.i * 5 + fi) < 0.5 ? -1 : 1]) {
          // swung right round against the wall inside (the leaf's face along the wall, its edge in the opening)
          const ht = tc + sd * (dw / 2 - 1);
          const lt = ht + sd * (leaf / 2 + 3);
          In.box('std', lt, DOOR_H / 2 - 1, -5.5, leaf, DOOR_H - 4, 3, glazed ? '#3a4046' : shadeHex(rec.trim, -0.35), { noJitter: true, surf: glazed ? [DET.panel, 0.4, 0.6] : [DET.wood, 0.75, 0] });
          if (glazed) In.rect('vglass', lt, DOOR_H / 2 + 6, -3.9, leaf - 10, DOOR_H - 30, '#b8c4cc', { uv: atlasUV('white') });
        }
      }
      // ground floor windows: reveals, a sill both sides, a frame and glass (intact, broken or boarded)
      for (const q of wins) {
        const tc = tOf(side, q.at), ww = q.w, wh = WIN_HEAD - WIN_SILL, yc = (WIN_SILL + WIN_HEAD) / 2;
        const rc = shadeHex(rec.color, -0.3);
        F.reveal('std', 0, tc - ww / 2, yc, 0, 0, wh, t, rc, wo);
        F.reveal('std', 1, tc + ww / 2, yc, 0, 0, wh, t, rc, wo);
        F.reveal('std', 2, tc, WIN_HEAD, 0, ww, 0, t, rc, wo);
        F.reveal('std', 3, tc, WIN_SILL, 0, ww, 0, t, rc, wo);
        F.box('std', tc, WIN_SILL - 1.2, -1, ww + 6, 2.4, 4, rec.trim, { noJitter: true, surf: [DET.concrete, 0.85, 0] });
        In.box('std', tc, WIN_SILL - 1.2, -4, ww + 4, 2.4, 4, shadeHex(ic, 0.05), { noJitter: true, surf: [DET.wood, 0.7, 0] });
        const roll = hash01(rec.i * 131 + fi * 17 + Math.round(q.at));
        const state = rec.look === 'adobe' ? (roll < 0.5 ? 'shutter' : 'open') : roll < 0.16 ? 'boarded' : roll < 0.34 ? 'broken' : 'glass';
        const S = { noJitter: true, surf: [DET.panel, 0.6, 0.2] };
        const fcol = rec.look === 'adobe' ? '#5a3e26' : '#e8e2d4';
        const mid = -t / 2;
        if (state !== 'open') {
          F.box('std', tc, WIN_HEAD - 1, mid - 1, ww, 2, 3, fcol, S);
          F.box('std', tc, WIN_SILL + 1, mid - 1, ww, 2, 3, fcol, S);
          F.box('std', tc - ww / 2 + 1, yc, mid - 1, 2, wh, 3, fcol, S);
          F.box('std', tc + ww / 2 - 1, yc, mid - 1, 2, wh, 3, fcol, S);
          F.box('std', tc, yc, mid - 1, 1.6, wh, 2.4, fcol, S);
        }
        if (state === 'glass') {
          F.rect('vglass', tc, yc, mid, ww - 2, wh - 2, '#a8b8c4', { uv: atlasUV('white') });
        } else if (state === 'broken') {
          for (let k = 0; k < 4; k++) {
            const sd = k % 2 ? 1 : -1;
            F.rect('vglass', tc + sd * (ww / 2 - 4 - hash01(roll * 9 + k) * 4), WIN_HEAD - 6 - hash01(k + roll) * 8, mid, 5, 9, '#a8b8c4', { uv: atlasUV('white') });
          }
        } else if (state === 'boarded') {
          const woods = ['#5a4632', '#6b5a44', '#4a3a2a', '#75604a'];
          for (let p = 0; p < 4; p++) F.box('std', tc + (hash01(roll + p) - 0.5) * 3, WIN_SILL + 6 + p * 15, 0.2, ww + 10, 11, 1.4, woods[p], { noJitter: true, surf: [DET.wood, 0.85, 0] });
        } else if (state === 'shutter') {
          // wooden shutters swung open against the outside wall
          for (const sd of [-1, 1]) F.box('std', tc + sd * (ww * 0.75 + 1), yc, 0.2, ww / 2, wh, 1.4, '#3e6a7a', { noJitter: true, surf: [DET.wood, 0.85, 0] });
        }
      }
      // a sign over the main door of a shop, a kiosk or an office
      if (side === 's' && rec.sign && doors.length) {
        const name = String(rec.sign).toUpperCase();
        const k = SIGN_NAMES.indexOf(name);
        const cell = 'sign' + (k >= 0 ? k : Math.floor(hash01(rec.i * 3 + 1) * SIGN_NAMES.length));
        const sw = Math.min(L * 0.6, 150);
        signBoard(F, tOf(side, doors[0].at), Math.min(ceil - 2, DOOR_H + 6 + sw / 8 + 4), sw, cell, { frame: '#2a2622', lamp: DETAIL.level >= 1 });
      }
      if (side === 's' || side === 'n') downspout(F, (side === 's' ? 1 : -1) * (L / 2 - 6), H);
    }
    // the corners: inside, a wall that meets another along a partition line needs nothing more
    // ---- the partitions: blocks with door frames and an open leaf in each doorway
    for (const p of rec.parts) {
      const along = Math.abs(p.y2 - p.y1) < 0.5;
      const len = along ? Math.abs(p.x2 - p.x1) : Math.abs(p.y2 - p.y1);
      const dir = along ? Math.sign(p.x2 - p.x1) : Math.sign(p.y2 - p.y1);
      const at = (s) => (along ? [p.x1 + dir * s, p.y1] : [p.x1, p.y1 + dir * s]);
      let cur = 0;
      const piece = (s0, s1, y0, y1) => {
        const [ax, az] = at(s0), [bx, bz] = at(s1);
        const cx = (ax + bx) / 2, cz = (az + bz) / 2;
        const sx = along ? Math.abs(bx - ax) : WALKIN_TI, sz = along ? WALKIN_TI : Math.abs(bz - az);
        B.block('std', cx, y0, cz, sx, y1 - y0, sz, ic, null, io);
        if (y0 === 0) B.block('std', cx, 0, cz, sx + (along ? 0 : 2.8), 6, sz + (along ? 2.8 : 0), shadeHex(ic, -0.35), null, { noJitter: true, surf: [DET.wood, 0.7, 0] });
      };
      for (const [g0, g1] of p.gaps) {
        if (g0 > cur + 0.5) piece(cur, g0, 0, ceil);
        piece(g0, g1, DOOR_H, ceil);
        // the frame round the doorway and a leaf swung open along the partition
        const [ax, az] = at(g0), [bx, bz] = at(g1);
        for (const [x, z] of [[ax, az], [bx, bz]]) B.block('std', x, 0, z, along ? 4 : WALKIN_TI + 3, DOOR_H, along ? WALKIN_TI + 3 : 4, frame, null, FS);
        const gw = g1 - g0, sd = hash01(rec.i * 7 + Math.round(g0)) < 0.5 ? 1 : -1;
        const [hx, hz] = at(g0 + 2);
        if (along) B.block('std', hx + dir * (gw / 2), 0, hz + sd * (WALKIN_TI / 2 + 2.5), gw - 6, DOOR_H - 3, 3, shadeHex(rec.trim, -0.3), null, { noJitter: true, surf: [DET.wood, 0.75, 0] });
        else B.block('std', hx + sd * (WALKIN_TI / 2 + 2.5), 0, hz + dir * (gw / 2), 3, DOOR_H - 3, gw - 6, shadeHex(rec.trim, -0.3), null, { noJitter: true, surf: [DET.wood, 0.75, 0] });
        cur = g1;
      }
      if (len > cur + 0.5) piece(cur, len, 0, ceil);
    }
    // ---- the top
    const style = rec.top === 'gable' ? 'gable' : rec.top === 'metal' ? 'metal' : 'flat';
    walkinTop(B, { id: 7700 + rec.i, color: rec.color, roof: rec.roof, surf: outSurf, cornice: !adobe && rec.type !== 'warehouse' && rec.type !== 'garage', parapet: adobe ? 22 : undefined }, L, W, H, style, rec.storeys);
    if (style === 'flat' && adobe && DETAIL.level >= 1) {
      // rain spouts through the parapet, a ladder of poles
      for (const sd of [-1, 1]) B.box('std', sd * L * 0.3, H + 8, W / 2 + 6, 4, 4, 14, '#7a5a36', null, { noJitter: true, surf: [DET.wood, 0.85, 0] });
    }
  }

  /** The storeys above the ground floor on one face: recessed windows of interior-mapped rooms. */
  function upper(B, rec, F, side, wo) {
    const { ceil, H } = rec;
    const L = F.len;
    if (H - ceil < 30) {
      if (H > ceil) skinBand(F, ceil, H, [], rec.color, wo);
      return;
    }
    const n = Math.max(1, Math.floor((L - 50) / 74));
    const step = (L - 50) / n;
    const adobe = rec.look === 'adobe';
    for (let y0 = ceil; y0 < H - 1; y0 += WALKIN_STOREY) {
      const y1 = Math.min(H, y0 + WALKIN_STOREY);
      const holes = [];
      const wins = [];
      if (y1 - y0 > 60) {
        for (let i = 0; i < n; i++) {
          const tc = -L / 2 + 25 + (i + 0.5) * step;
          const ww = adobe ? 22 : 28, wh = adobe ? 32 : 44, yc = y0 + 26 + wh / 2;
          holes.push({ t0: tc - ww / 2, t1: tc + ww / 2, y0: yc - wh / 2, y1: yc + wh / 2 });
          wins.push({ tc, ww, wh, yc, seed: rec.i * 977 + F.i * 131 + Math.round(y0) * 3 + i });
        }
      }
      skinBand(F, y0, y1, holes, rec.color, wo);
      for (const q of wins) {
        const roll = hash01(q.seed), roll2 = hash01(q.seed + 7);
        const state = roll < 0.16 ? 'lit' : roll2 < 0.1 ? 'boarded' : roll2 < 0.18 ? 'broken' : 'dark';
        windowUnit(F, {
          t: q.tc, yc: q.yc, ww: q.ww, wh: q.wh, R: 5.5, state, room: roomId(state === 'boarded' || state === 'broken' ? 4 : rec.type === 'office' ? 2 : 0, q.seed), k: 1.2 + hash01(q.seed + 3) * 0.4,
          frame: adobe ? '#5a3e26' : '#2a2622', wall: rec.color, sill: true, lintel: !adobe, trim: rec.trim, mullion: adobe ? 0 : 1, seed: q.seed,
          shutters: adobe ? '#3e6a7a' : null,
        });
      }
    }
    void side;
  }

  // ---- the roof terrace's wing and stair (world frame: the wing's walls are obstacles too) ------------

  function stair(B, rec) {
    const s = rec.stair;
    const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
    // (the frame stands at ground 0: the terrain under the wing's centre is the terrace)
    B.obj(cx, cy, 0, 7900 + rec.i, (s.base || 0) - gy(cx, cy));
    B.setJitter(0.02);
    const t = rec.t, rise = s.rise;
    const L = s.x1 - s.x0, W = s.y1 - s.y0;
    const wo = { noJitter: true, surf: [DET.concrete, 0.88, 0] };
    const col = shadeHex(rec.color, -0.06);
    const lx = (x) => x - cx, lz = (y) => y - cy;
    // the wing's outer walls up to the parapet (the building's own wall closes the stair side)
    const top = rise + 34;
    const west = s.side === 'w';
    const farX = west ? s.x1 - t / 2 : s.x0 + t / 2;
    B.block('std', lx(cx), 0, lz(s.y0 + t / 2), L, top, t, col, null, wo);
    B.block('std', lx(farX), 0, lz((s.y0 + s.y1) / 2 + t / 2), t, top, W - t, col, null, wo);
    const fx0 = west ? s.sx1 : s.x0 + t, fx1 = west ? s.x1 - t : s.sx0;
    B.block('std', lx((fx0 + fx1) / 2), 0, lz(s.y1 - t / 2), fx1 - fx0, top, t, col, null, wo);
    // a roll-up door into the store under the terrace (shut) and a lamp
    const F = { len: fx1 - fx0 };
    void F;
    B.box('decal', lx((fx0 + fx1) / 2), 50, lz(s.y1) + 0.6, Math.min(110, fx1 - fx0 - 30), 96, 0.4, '#ffffff', null, { uv: atlasUV('garage'), noAO: true });
    // the stair's inner wall, stepping down with the flight, a handrail on it
    const ix = west ? s.sx1 + WALKIN_TI / 2 : s.sx0 - WALKIN_TI / 2;
    const n = 16, run = s.run;
    for (let k = 0; k < n; k++) {
      const y0 = s.y1 - t - ((k + 1) * (s.y1 - t - s.top)) / n, y1 = s.y1 - t - (k * (s.y1 - t - s.top)) / n;
      const h = Math.min(top, ((rise * (s.y1 - y1)) / run) + 36);
      B.block('std', lx(ix), 0, lz((y0 + y1) / 2), WALKIN_TI, Math.max(36, h), y1 - y0 + 0.2, col, null, wo);
    }
    // treads: fine steps up the lane (the terrain's 40 steps under them), a stringer along the open side
    const steps = 18;
    for (let k = 0; k < steps; k++) {
      const yA = s.y1 - (run * k) / steps, yB = s.y1 - (run * (k + 1)) / steps;
      const h = (rise * (k + 1)) / steps;
      B.block('std', lx((s.sx0 + s.sx1) / 2), 0, lz((yA + yB) / 2), s.sx1 - s.sx0 - 0.5, h, yA - yB + 0.2, '#8f8b82', null, { noJitter: true, surf: [DET.slab, 0.86, 0] });
      B.box('std', lx((s.sx0 + s.sx1) / 2), h - 0.6, lz(yA) - 1, s.sx1 - s.sx0 - 0.5, 1.2, 2.4, '#5e5b55', null, { noJitter: true, surf: [DET.rust, 0.6, 0.6] });
    }
    // parapet coping round the terrace, a railing along the landing's open edge
    for (const [x, z, sx, sz] of [[lx(cx), lz(s.y0 + t / 2), L + 2, t + 2], [lx(farX), lz((s.y0 + s.y1) / 2), t + 2, W + 2], [lx((fx0 + fx1) / 2), lz(s.y1 - t / 2), fx1 - fx0 + 2, t + 2]]) {
      B.box('std', x, top + 1, z, sx, 2, sz, '#8a8a84', null, { noJitter: true, surf: [DET.concrete, 0.7, 0.2] });
    }
    if (DETAIL.level >= 1) {
      // a handrail up the flight on the building's side
      const hx = west ? s.sx0 + 3 : s.sx1 - 3;
      for (let k = 0; k <= 6; k++) {
        const y = s.y1 - 8 - ((run - 16) * k) / 6, h = (rise * (s.y1 - y)) / run;
        B.box('std', lx(hx), h + 18, lz(y), 1.6, 36, 1.6, '#3a3d40', null, { noJitter: true, surf: [DET.rust, 0.5, 0.7] });
      }
      const ang = Math.atan2(rise, run);
      B.add('std', T.box(), [lx(hx), rise / 2 + 36, lz(s.y1 - run / 2)], [2, 2, Math.hypot(run, rise)], [ang, 0, 0], '#3a3d40', { noJitter: true, surf: [DET.rust, 0.5, 0.7] });
      // terrace furniture: an old plastic chair, a water tank, an antenna
      B.cyl('std', lx(west ? s.x1 - 50 : s.x0 + 50), rise, lz(s.y0 + 50), 20, 40, '#3a5a6a', 12, 1, null, { surf: [DET.plastic, 0.6, 0] });
      B.box('std', lx(cx), rise + 12, lz(s.y0 + 90), 20, 2, 20, '#d8d4c8', null, { surf: [DET.plastic, 0.5, 0] });
    }
  }

  // ---- furniture ---------------------------------------------------------------------------------------

  function prop(B, st, o) {
    const L = o.w, W = o.h;
    const wood = (c) => ({ noJitter: false, surf: [DET.wood, 0.8, 0] });
    const panel = { surf: [DET.panel, 0.5, 0.35] };
    const fab = { surf: [DET.fabric, 0.95, 0] };
    const metal = { surf: [DET.rust, 0.55, 0.6] };
    const long = L >= W;
    const len = long ? L : W, dep = long ? W : L;
    const BX = (x, y0, z, sx, sy, sz, c, o2, rot) => (long ? B.block('std', x, y0, z, sx, sy, sz, c, rot || null, o2) : B.block('std', z, y0, -x, sz, sy, sx, c, rot || null, o2));
    const DEC = (x, y, z, sx, sy, face, cell) => {
      // a decal quad on the long side `face` (±1) of a long-ish prop
      if (long) B.add('decal', T.plane(), [x, y, face * z], [sx, sy, 1], face > 0 ? null : [0, Math.PI, 0], '#ffffff', { uv: atlasUV(cell), noAO: true });
      else B.add('decal', T.plane(), [face * z, y, -x], [sx, sy, 1], [0, face > 0 ? Math.PI / 2 : -Math.PI / 2, 0], '#ffffff', { uv: atlasUV(cell), noAO: true });
    };
    switch (st) {
      case 'shelf': {
        // a gondola: base, a pegboard spine, three shelves of goods each side
        BX(0, 0, 0, len, 8, dep, '#3a3d40', metal);
        BX(0, 8, 0, len, 62, 2, '#c9c4b6', panel);
        for (const y of [20, 38, 56]) BX(0, y, 0, len, 1.4, dep, '#b8b4a8', panel);
        for (const sd of [-1, 1]) DEC(0, 40, dep / 2 + 0.2, len - 4, 52, sd, 'shop');
        break;
      }
      case 'till': case 'reception': {
        BX(0, 0, 0, len, 38, dep, st === 'till' ? '#6a2a24' : '#6a5440', st === 'till' ? panel : wood());
        BX(0, 38, 0, len + 2, 2.4, dep + 2, '#d8d2c4', panel);
        BX(len * 0.25, 40.4, 0, 14, 10, 12, '#2a2c2e', panel);
        if (st === 'till') BX(-len * 0.2, 40.4, 0, 20, 24, 6, '#4a4e52', panel);
        else BX(-len * 0.2, 40.4, -2, 18, 14, 2, '#1a1c1e', panel);
        break;
      }
      case 'cooler': {
        BX(0, 0, 0, len, 92, dep, '#c8ccd0', panel);
        B.add('glow', T.plane(), long ? [0, 50, dep / 2 + 0.3] : [dep / 2 + 0.3, 50, 0], long ? [len - 6, 70, 1] : [len - 6, 70, 1], long ? null : [0, Math.PI / 2, 0], '#ffffff', { uv: atlasUV('shop'), emissive: 0.9, noAO: true });
        BX(0, 90, dep / 2 - 1, len, 8, 2, '#1d4a7a', panel);
        break;
      }
      case 'rack': {
        // a pallet rack: orange uprights, blue beams, pallets with boxes on three levels
        for (const x of [-len / 2 + 2, 0, len / 2 - 2]) for (const sd of [-1, 1]) BX(x, 0, sd * (dep / 2 - 2), 3, 150, 3, '#c46a1e', metal);
        for (const y of [4, 54, 104]) {
          for (const sd of [-1, 1]) BX(0, y + 8, sd * (dep / 2 - 2), len, 4, 2.5, '#1d4a8a', metal);
          for (const x of [-len / 4, len / 4]) {
            BX(x, y + 12, 0, len / 2 - 8, 4, dep - 6, '#8a6a42', wood());
            if (hash01(o.id * 7 + y + x) < 0.8) BX(x, y + 16, 0, len / 2 - 12, 26 + hash01(o.id + y) * 10, dep - 10, ['#a8885a', '#9a7a4a', '#b89a6a'][Math.floor(hash01(o.id * 3 + y + x) * 3)], { surf: [DET.panel, 0.9, 0] });
          }
        }
        break;
      }
      case 'crate': case 'pallet': case 'tyres': case 'jars': {
        if (st === 'tyres') {
          for (let k = 0; k < 4; k++) B.add('std', T.torus(12, 0.45, 6), [0, 5 + k * 9, 0], [len * 0.4, len * 0.4, 9], [Math.PI / 2, 0, 0], '#1a1a1c', { surf: [DET.rubber, 0.9, 0] });
          break;
        }
        if (st === 'jars') {
          for (let k = 0; k < 5; k++) B.cyl('std', (hash01(o.id + k) - 0.5) * L * 0.7, 0, (hash01(o.id * 3 + k) - 0.5) * W * 0.7, 5 + hash01(k) * 3, 16 + hash01(o.id + k * 5) * 10, ['#a8643a', '#8a5a36', '#c8a070'][k % 3], 10, 0.6, null, { surf: [DET.stucco, 0.8, 0] });
          break;
        }
        BX(0, 0, 0, len, 5, dep, '#7a5a32', wood());
        BX(-len * 0.2, 5, 0, len * 0.55, 28, dep * 0.8, '#8a6a3a', wood());
        BX(len * 0.25, 5, 0, len * 0.42, 22, dep * 0.7, st === 'pallet' ? '#d8cfb8' : '#7a5a32', st === 'pallet' ? fab : wood());
        if (st === 'crate') BX(-len * 0.2, 33, 0, len * 0.4, 18, dep * 0.6, '#6a4a2a', wood(), [0, 0.3, 0]);
        break;
      }
      case 'sofa': {
        BX(0, 0, 0, len, 18, dep, '#5a3a3a', fab);
        BX(0, 18, -dep / 2 + 5, len, 18, 10, '#4e3232', fab);
        for (const sd of [-1, 1]) BX(sd * (len / 2 - 5), 18, 0, 10, 8, dep, '#4e3232', fab);
        break;
      }
      case 'table': case 'lowtable': {
        const h = st === 'lowtable' ? 14 : 28;
        BX(0, h - 2.5, 0, len, 2.5, dep, '#6a4a2c', wood());
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) BX(sx * (len / 2 - 3), 0, sz * (dep / 2 - 3), 2.4, h - 2.5, 2.4, '#4a3420', wood());
        if (st === 'table') {
          for (const sd of [-1, 1]) {
            BX(sd * len * 0.2, 0, -sd * (dep / 2 + 8), 14, 16, 14, '#5a3e26', wood());
            BX(sd * len * 0.2, 16, -sd * (dep / 2 + 14), 14, 18, 2, '#5a3e26', wood());
          }
        } else B.cyl('std', 0, h, 0, 5, 3, '#c8a070', 10, 1);
        break;
      }
      case 'bed': case 'bedroll': {
        if (st === 'bedroll') { BX(0, 0, 0, len, 6, dep * 0.8, '#8a3a2a', fab); BX(len * 0.35, 6, 0, len * 0.2, 6, dep * 0.6, '#d8cfb8', fab); break; }
        BX(0, 0, 0, len, 14, dep, '#4a3420', wood());
        BX(0, 14, 0, len - 4, 9, dep - 4, '#d8d4c8', fab);
        BX(-len * 0.1, 23, 0, len * 0.7, 3, dep - 3, '#5a6a8a', fab);
        BX(len / 2 - 10, 23, 0, 14, 5, dep * 0.6, '#eeeae0', fab);
        BX(len / 2 - 1, 0, 0, 3, 40, dep, '#4a3420', wood());
        break;
      }
      case 'wardrobe': case 'filing': case 'mailbox': case 'niche': case 'toolwall': {
        const h = st === 'filing' ? 54 : st === 'mailbox' ? 70 : st === 'niche' ? 64 : st === 'toolwall' ? 90 : 88;
        const col = st === 'filing' ? '#7d8489' : st === 'mailbox' ? '#8a8e72' : st === 'niche' ? '#c8b088' : st === 'toolwall' ? '#5a5e62' : '#6a4a2c';
        BX(0, 0, 0, len, h, dep, col, st === 'filing' || st === 'mailbox' || st === 'toolwall' ? panel : wood());
        const rows = st === 'filing' ? 4 : st === 'mailbox' ? 6 : 2;
        for (const sd of [-1, 1]) {
          for (let k = 0; k < rows; k++) {
            const y = 4 + ((k + 0.5) * (h - 8)) / rows;
            BX(0, y - 0.6, sd * (dep / 2 + 0.3), len - 6, 1.2, 0.8, shadeHex(col, -0.3), panel);
          }
        }
        break;
      }
      case 'kitchen': case 'bench': {
        BX(0, 0, 0, len, 36, dep, st === 'bench' ? '#5a4a3a' : '#e0dcd0', st === 'bench' ? wood() : panel);
        BX(0, 36, 0, len + 2, 3, dep + 2, st === 'bench' ? '#6a5440' : '#4a4e52', st === 'bench' ? wood() : { surf: [DET.terrazzo, 0.4, 0] });
        if (st === 'kitchen') {
          BX(len * 0.2, 36.5, 0, 26, 3, dep * 0.6, '#9aa0a4', metal);
          BX(-len * 0.3, 39, 0, 22, 2, dep * 0.7, '#1a1c1e', panel);
          BX(-len / 2 + 10, 39, -dep / 2 + 4, 18, 50, 6, '#c8ccd0', panel);
        } else {
          BX(-len * 0.3, 39, 0, 16, 10, 10, '#a51f25', metal);
          BX(len * 0.2, 39, 0, 24, 6, 8, '#3a3d40', metal);
        }
        break;
      }
      case 'desk': {
        BX(0, 26, 0, len, 3, dep, '#6a5a48', wood());
        for (const sd of [-1, 1]) BX(sd * (len / 2 - 2), 0, 0, 3, 26, dep - 2, '#4a4e52', panel);
        BX(len * 0.15, 29, -dep * 0.15, 20, 14, 2, '#1a1c1e', panel);
        BX(len * 0.15, 29, -dep * 0.15 + 3, 6, 2, 6, '#2a2c2e', panel);
        BX(-len * 0.25, 29, dep * 0.1, 14, 1.4, 10, '#e8e4d8', panel);
        BX(0, 0, dep / 2 + 12, 16, 18, 16, '#2a2c2e', fab);
        BX(0, 18, dep / 2 + 19, 16, 20, 3, '#2a2c2e', fab);
        break;
      }
      default:
        B.block('std', 0, 0, 0, L, 36, W, o.color || '#8a8478', null, panel);
    }
  }

  return {
    obstacle,
    build,
    get stats() { return { buildings: recs.length, triangles: tris }; },
  };
}
