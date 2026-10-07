// Vehicles of the static world (WORLD, SPEC §7.5): cars, SUVs, pickups, vans, military
// trucks, semi cabs and trailers, tankers, school buses / RVs and the APC, at the canonical
// heights (they match the sim's collision and `solid` rule).
//
// Cars are lofted: a ring cross-section (underside, bulging flanks, shoulder, beltline,
// tumbling greenhouse, domed roof or hood) is swept through stations taken from a side
// profile, so hoods slope into windshields, roofs round off and wheel arches are cut into
// the rocker line. Each loft quad goes to paint or glass by where it is (pillars stay
// paint), so one body is a few hundred triangles in the merged buckets. Burnt wrecks swap
// the clear-coated paint for char, their window openings are recessed dark holes, and
// they sit on bare rims.

import * as THREE from 'three';
import { T, mixHex, shadeHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { DETAIL } from './world-arch.js';
import * as CIN from './world-veh-cin.js';
import { ROLE_COLOR, roleFor, damageFor, vehicleExtras, fireTruck, busLettering, trailerLivery } from './world-veh-extras.js';

const TIRE = '#1b1b1c';
const RIM = '#9aa0a6';
const STEEL_RIM = '#3a3530';
const GLASS = '#1a242e';
const DARK = '#1c1d1f';
const TRIM = '#222324';
const CHROME = '#c9ced3';
const HEAD = '#fff3d6';
const TAIL = '#d01418';
const AMBER = '#ff9a1a';
const CHAR = ['#2c2622', '#3a2f27', '#2a2521', '#453628'];
const INTERIOR = '#0c0b0a';
/** Window glass: see-through (the cabin shows) on the cinematic tier, dark reflective glass below it. */
const GL = () => (DETAIL.level >= 3 ? 'vglass' : 'glass');

// ---- loft --------------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/** Piecewise-linear lookup in [[x, y]...] sorted by x. */
function pw(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

const inRanges = (ranges, x) => ranges.some(([a, b]) => x > a && x < b);

// ring point indices: 0 underside centre, 1 underside edge, 2 lower bulge, 3 widest flank,
// 4 shoulder, 5 beltline, 6 glass top / hood edge, 7 roof edge, 8 roof centre
// smoothing groups: creases at the sill, the shoulder line and the glass edges
const GROUPS = [[0, 1], [1, 2], [2, 4], [4, 5], [5, 6], [6, 8]];

/**
 * Sweep a vehicle body. All x/y/z in units in the vehicle's local frame.
 * @param {object} s spec: { L, W, x0, x1, top, belt, rocker, wheels: [{x, r}], wind: [[a,b]],
 *   side: [[a,b]] side-window spans, tumble, taper, bed: {floor} (open pickup bed), recess }
 * @returns {{ paint: object, glass: object, under: object, recess: object }} triangle lists
 */
function loftBody(s) {
  const L = s.L, W = s.W;
  const x0 = s.x0 ?? -L / 2, x1 = s.x1 ?? L / 2;
  const top = s.top, belt = s.belt;
  const arches = (s.wheels || []).map((w) => ({ x: w.x, y: w.r, R: w.r + 1.7 }));
  const bottom = (x) => {
    let y = s.rocker;
    for (const a of arches) {
      const d = Math.abs(x - a.x);
      if (d < a.R) y = Math.max(y, a.y + Math.sqrt(a.R * a.R - d * d));
    }
    return y;
  };
  const halfW = (x) => {
    const xn = Math.abs(x) / (L / 2);
    return (W / 2) * (0.985 - (s.taper ?? 0.1) * smooth01((xn - 0.62) / 0.38) ** 1.6);
  };
  // stations: profile breakpoints, arch samples, glass edges, and a regular fill
  const xs = new Set([x0, x1]);
  for (const [x] of top) if (x > x0 && x < x1) xs.add(x);
  for (const [x] of belt) if (x > x0 && x < x1) xs.add(x);
  for (const a of arches) {
    for (let k = 0; k <= 8; k++) {
      const x = a.x + a.R * Math.cos((k / 8) * Math.PI);
      if (x > x0 && x < x1) xs.add(x);
    }
    for (const e of [a.x - a.R - 0.6, a.x + a.R + 0.6]) if (e > x0 && e < x1) xs.add(e);
  }
  for (const rg of [...(s.wind || []), ...(s.side || [])]) for (const x of rg) if (x > x0 && x < x1) xs.add(x);
  // panel gaps: a narrow groove (three stations) at each door edge
  const seams = s.seams || [];
  for (const x of seams) for (const d of [-0.45, 0, 0.45]) if (x + d > x0 && x + d < x1) xs.add(x + d);
  const step = (x1 - x0) / 14;
  for (let x = x0 + step; x < x1 - 1e-3; x += step) xs.add(x);
  // rounded ends: extra stations close to the bumpers
  for (const f of [0.012, 0.035]) { xs.add(x0 + (x1 - x0) * f); xs.add(x1 - (x1 - x0) * f); }
  const X = [...xs].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 0.2);

  const tum = s.tumble ?? 0.8;
  const rings = X.map((x) => {
    const yb = bottom(x);
    const yB = pw(belt, x);
    const yT = Math.max(pw(top, x), yB + 0.3);
    const hw = halfW(x);
    // the very ends pull in a little more (rounded bumpers)
    const endK = Math.min(x - x0, x1 - x) < (x1 - x0) * 0.02 ? 0.965 : 1;
    const h = hw * endK;
    const gh = yT - yB;
    const g = smooth01((gh - 1.5) / 7);
    const ht = h * tum;
    const gap = seams.some((sx) => Math.abs(x - sx) < 0.05) ? 0.5 : 0;
    const P = [
      [0, yb], [h - 2.4, yb], [h - 0.7 - gap, yb + 1.6], [h - gap, lerp(yb, yB, 0.5)], [h - 0.2 - gap, yB - 1.5], [h - 1.2, yB],
    ];
    if (s.bed && x < s.bed.x) {
      // open pickup bed: rail, inner wall, floor
      const fl = s.bed.floor;
      P.push([h - 3.2, yB], [h - 3.4, fl], [0, fl]);
    } else {
      const hood6 = [h - 2.6, yB + gh * 0.55], hood7 = [h * 0.55, yT - 0.12];
      const gh6 = [ht + 0.9, yT - 2.6], gh7 = [ht - 1.4, yT - 0.35];
      P.push([lerp(hood6[0], gh6[0], g), lerp(hood6[1], gh6[1], g)], [lerp(hood7[0], gh7[0], g), lerp(hood7[1], gh7[1], g)], [0, yT]);
    }
    return { x, P, gh };
  });

  // recessed openings (wrecks: glass gone, the frame's inside is dark)
  const out = { paint: newList(), glass: newList(), under: newList(), recess: newList(), sill: newList() };
  const S = rings.length;
  const V = (i, j, side) => { const p = rings[i].P[j]; return [rings[i].x, p[1], side * p[0]]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // per smoothing group, per station, per ring point: the right-side normal (computed once)
  const NJ = rings[0].P.length;
  const normals = GROUPS.map(([g0, g1]) => {
    const arr = new Float32Array(S * NJ * 3);
    for (let i = 0; i < S; i++) {
      const ia = Math.max(0, i - 1), ib = Math.min(S - 1, i + 1);
      for (let j = g0; j <= g1; j++) {
        const ja = Math.max(g0, j - 1), jb = Math.min(g1, j + 1);
        const pa = rings[ia].P[j], pb = rings[ib].P[j];
        const tx = [rings[ib].x - rings[ia].x, pb[1] - pa[1], pb[0] - pa[0]];
        const qa = rings[i].P[ja], qb = rings[i].P[jb];
        const tr = [0, qb[1] - qa[1], qb[0] - qa[0]];
        const n = cross(tx, tr);
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        const o = (i * NJ + j) * 3;
        arr[o] = n[0] / l; arr[o + 1] = n[1] / l; arr[o + 2] = n[2] / l;
      }
    }
    return arr;
  });
  // arc length along the ring (detail v coordinate)
  const arc = rings.map((r) => {
    const a = [0];
    for (let j = 1; j < r.P.length; j++) a.push(a[j - 1] + Math.hypot(r.P[j][0] - r.P[j - 1][0], r.P[j][1] - r.P[j - 1][1]));
    return a;
  });
  const wind = s.wind || [], side = s.side || [];
  // one vertex into a list: position, normal (mirrored for the left side), detail uv
  const put = (l, i, j, sd, nArr) => {
    const p = rings[i].P[j], o = (i * NJ + j) * 3;
    l.pos.push(rings[i].x, p[1], sd * p[0]);
    l.nor.push(nArr[o], nArr[o + 1], nArr[o + 2] * sd);
    l.uv.push(rings[i].x, arc[i][j]);
  };
  for (let i = 0; i < S - 1; i++) {
    const xm = (rings[i].x + rings[i + 1].x) / 2;
    const ghm = (rings[i].gh + rings[i + 1].gh) / 2;
    const sideGlass = inRanges(side, xm) && ghm > 3;
    const topGlass = inRanges(wind, xm);
    GROUPS.forEach(([g0, g1], gi) => {
      const nArr = normals[gi];
      for (let j = g0; j < g1; j++) {
        let list = out.paint;
        if (g0 === 0) list = out.under;
        else if (g0 === 1) list = out.sill;
        else if (g0 === 5 && sideGlass) list = s.recess ? out.recess : out.glass;
        else if (g0 === 6 && j === 7 && topGlass) list = s.recess ? out.recess : out.glass;
        if (s.bed && xm < s.bed.x && g0 === 6) list = j === 7 ? out.under : out.paint;
        // right side (a b d, b c d) and the mirrored left side (a d b, b d c)
        put(list, i, j, 1, nArr); put(list, i + 1, j, 1, nArr); put(list, i, j + 1, 1, nArr);
        put(list, i + 1, j, 1, nArr); put(list, i + 1, j + 1, 1, nArr); put(list, i, j + 1, 1, nArr);
        put(list, i, j, -1, nArr); put(list, i, j + 1, -1, nArr); put(list, i + 1, j, -1, nArr);
        put(list, i + 1, j, -1, nArr); put(list, i, j + 1, -1, nArr); put(list, i + 1, j + 1, -1, nArr);
      }
    });
  }
  // end caps: fans from the ring's centroid
  for (const [i, dir] of [[0, -1], [S - 1, 1]]) {
    const r = rings[i];
    const poly = [];
    for (let j = 0; j < r.P.length; j++) poly.push(V(i, j, 1));
    for (let j = r.P.length - 1; j >= 0; j--) poly.push(V(i, j, -1));
    let cy = 0;
    for (const p of poly) cy += p[1];
    cy /= poly.length;
    const c = [r.x, cy, 0];
    const n = [dir, 0, 0];
    for (let k = 0; k < poly.length - 1; k++) {
      const a = poly[k], b = poly[k + 1];
      const e = cross(sub(a, c), sub(b, c));
      if (e[0] * dir >= 0) pushTri(out.paint, c, n, [c[2], c[1]], a, n, [a[2], a[1]], b, n, [b[2], b[1]]);
      else pushTri(out.paint, c, n, [c[2], c[1]], b, n, [b[2], b[1]], a, n, [a[2], a[1]]);
    }
  }
  out.rings = rings;
  out.halfW = halfW;
  out.bottom = bottom;
  return out;
}

function newList() { return { pos: [], nor: [], uv: [] }; }
function pushTri(l, a, na, ua, b, nb, ub, c, nc, uc) {
  l.pos.push(...a, ...b, ...c);
  l.nor.push(...na, ...nb, ...nc);
  l.uv.push(...ua, ...ub, ...uc);
}
function toGeo(l) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(l.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(l.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(l.uv, 2));
  return g;
}

/** Emit a loft into the builder with the vehicle's materials. */
function emitBody(B, body, v) {
  const lists = [
    ['paint', body.paint, v.paintBucket, v.color, v.paintSurf],
    ['glass', body.glass, GL(), GLASS, [v.cracked ? DET.glass : 0, v.cracked ? 0.2 : -1, -1]],
    ['under', body.under, 'std', DARK, [DET.rust, 0.85, 0.2]],
    // the sill below the lower crease: dark plastic cladding (reads as a rocker panel)
    ['sill', body.sill, v.wrecked ? 'std' : 'std', v.wrecked ? '#171412' : '#1d1e20', v.wrecked ? [DET.char, 0.9, 0.2] : [DET.plastic, 0.6, 0]],
    ['recess', body.recess, 'std', INTERIOR, [DET.char, 0.95, 0]],
  ];
  for (const [, list, bucket, color, surf] of lists) {
    if (!list.pos.length) continue;
    B.add(bucket, toGeo(list), [0, 0, 0], [1, 1, 1], null, color, { map: 'uv', surf });
  }
}

// ---- wheels ----------------------------------------------------------------------------------

const TYRE_PROFILE = [[0.6, -0.5], [0.86, -0.5], [0.96, -0.44], [1.0, -0.3], [1.0, 0.3], [0.96, 0.44], [0.86, 0.5], [0.6, 0.5]];

/** Five-spoke alloy (or plain steel) wheel face, unit radius, facing +y, centred on y = 0. */
function rimTemplate(spokes) {
  return T.custom('rim' + spokes, () => {
    const parts = [];
    const barrel = new THREE.CylinderGeometry(1, 1, 0.9, 16, 1, true);
    parts.push(barrel);
    const lip = new THREE.TorusGeometry(0.97, 0.06, 4, 16);
    lip.rotateX(Math.PI / 2);
    lip.translate(0, 0.42, 0);
    parts.push(lip);
    const hub = new THREE.CylinderGeometry(0.22, 0.26, 0.3, 10);
    hub.translate(0, 0.3, 0);
    parts.push(hub);
    const back = new THREE.CylinderGeometry(0.98, 0.98, 0.05, 16);
    back.translate(0, -0.1, 0);
    parts.push(back);
    if (spokes > 0) {
      for (let k = 0; k < spokes; k++) {
        const sp = new THREE.BoxGeometry(0.2, 0.12, 0.8);
        sp.translate(0, 0.28, 0.58);
        sp.rotateY((k / spokes) * Math.PI * 2);
        parts.push(sp);
      }
    } else {
      // steel wheel: a dished disc with holes suggested by a ring of bumps
      const disc = new THREE.CylinderGeometry(0.9, 0.95, 0.12, 16);
      disc.translate(0, 0.22, 0);
      parts.push(disc);
    }
    const merged = mergeParts(parts);
    return merged;
  });
}

function mergeParts(parts) {
  const pos = [], nor = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * One wheel at (x, r, z) with its axle along local z; `sd` = +1 right side, -1 left.
 * @param {object} o { wrecked, spokes, rim colour, width }
 */
function wheel(B, x, r, z, width, sd, o = {}) {
  if (DETAIL.level >= 3 && !o.wrecked) { CIN.cinWheel(B, x, r, z, width, sd, o); return; }
  const rot = [sd > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0];
  if (o.wrecked) {
    // tyre burnt away: a scorched steel rim sitting on the ground, tilted a little
    B.add('std', rimTemplate(0), [x, r * 0.66, z], [r * 0.66, width * 0.9, r * 0.66], [rot[0], 0, (B.rng.next() - 0.5) * 0.2], STEEL_RIM, { surf: [DET.char, 0.9, 0.5], map: 'cyl' });
    return;
  }
  if (o.flat) {
    // a flat tyre: squashed onto the rim, bulging out at the sidewall
    B.add('std', T.lathe('tyre', TYRE_PROFILE, 18), [x, r * 0.7, z], [r * 1.02, width * 1.08, r * 0.72], rot, TIRE, { surf: [DET.rubber, 0.82, 0], map: 'cyl' });
    const rf = r * 0.56;
    B.add('std', rimTemplate(o.spokes ?? 5), [x, r * 0.66, z + sd * width * 0.05], [rf, width * 0.9, rf], rot, o.rim || RIM, { surf: [DET.panel, 0.32, 0.85], map: 'cyl' });
    return;
  }
  B.add('std', T.lathe('tyre', TYRE_PROFILE, 18), [x, r, z], [r, width, r], rot, TIRE, { surf: [DET.rubber, 0.82, 0], map: 'cyl' });
  const rr = r * 0.6;
  B.add('std', rimTemplate(o.spokes ?? 5), [x, r, z + sd * width * 0.02], [rr, width * 0.9, rr], rot, o.rim || RIM, { surf: [DET.panel, 0.32, 0.85], map: 'cyl' });
}

// ---- lights, plates, mirrors ------------------------------------------------------------------

/** Head + tail lamps, optional hazards (blink) and a lit state (emissive > 1 → bloom). */
function lamps(B, v, frontX, rearX, yF, yR, spread, sizeF = [1.4, 3.6, 8], sizeR = [1.2, 3.6, 7]) {
  if (DETAIL.level >= 3) { CIN.cinLamps(B, v, frontX, rearX, yF, yR, spread, sizeF, sizeR); return; }
  const lit = v.lightsOn;
  for (const sd of [-1, 1]) {
    const z = sd * spread;
    // front: a clear lens housing with the lamp inside
    B.rbox('glass', frontX - 0.3, yF, z, sizeF[0] + 0.8, sizeF[1] + 0.6, sizeF[2] + 0.8, 0.5, '#aab4bc', null, { surf: [0, 0.05, 0.1] });
    B.box('glow', frontX + 0.25, yF, z, sizeF[0] * 0.4, sizeF[1], sizeF[2], HEAD, null, { emissive: lit ? 3.2 : 0.28, uv: atlasUV('white') });
    // rear: red lens
    B.box('glow', rearX - 0.25, yR, z, sizeR[0] * 0.5, sizeR[1], sizeR[2], TAIL, null, { emissive: lit ? 2.2 : 0.45, uv: atlasUV('white') });
    if (v.hazards) {
      B.box('blink', frontX + 0.2, yF - sizeF[1] * 0.5 - 1.2, z * 1.02, 0.6, 1.4, 3.2, AMBER, null, { emissive: 3.2 });
      B.box('blink', rearX - 0.3, yR + sizeR[1] * 0.5 + 1.1, z, 0.6, 1.4, 3.2, AMBER, null, { emissive: 3.2 });
    }
  }
}

let plateSeq = 0;
function plate(B, x, y, sd) {
  const k = (plateSeq++) % 4;
  B.add('decal', T.plane(), [x + sd * 0.15, y, 0], [10.5, 5.2, 1], [0, sd * Math.PI / 2, 0], '#ffffff', { uv: atlasUV('plate' + k), noAO: true });
}

/** Wing mirrors on stalks, housings in the body's paint (bucket + surface). */
function mirrors(B, x, y, hw, color, bucket = 'std', surf = null) {
  for (const sd of [-1, 1]) {
    B.box('std', x, y, sd * (hw + 1.2), 1.2, 1.2, 2.6, TRIM, null, { surf: [0, 0.5, 0.1] });
    B.rbox(bucket, x - 0.6, y + 1.6, sd * (hw + 3.2), 2, 3.4, 4.2, 0.6, color, null, surf ? { surf } : null);
  }
}

// ---- vehicle kinds ----------------------------------------------------------------------------

/** The cinematic extras of a road vehicle: undercarriage always, the cabin unless it is a burnt-out wreck. */
function cinExtras(B, o, v, L, W, R, wx, sag, rocker, cab) {
  CIN.cinUnder(B, L, W, R, [-wx, wx], rocker + sag);
  if (!v.wrecked) CIN.cinInterior(B, o.id, { ...cab, hw: W / 2 - 2.8 }, v.lightsOn);
}

/**
 * Build a road vehicle ('car' | 'suv' | 'pickup' | 'van' | 'truck').
 * @param {object} B builder (object frame already placed)
 * @param {object} o obstacle { kind, w, h, color, wrecked, id }
 */
export function buildVehicle(B, o) {
  const L = o.w, W = o.h;
  const r = B.rng;
  const v = vehicleLook(B, o);
  const sag = o.wrecked ? -2.2 : 0;
  switch (o.kind) {
    case 'car': {
      const R = 8.2;
      const wx = 0.31 * L;
      const spec = {
        L, W, rocker: 9.5 + sag, wheels: [{ x: -wx, r: R }, { x: wx, r: R }], tumble: 0.8, taper: 0.12,
        // a sedan: long raked windshield and backlight, short roof, trunk deck and hood
        top: P(L, [[-0.5, 22], [-0.47, 26.4], [-0.33, 28.2], [-0.27, 29], [-0.12, 40.4], [0.06, 41.8], [0.28, 30], [0.44, 27.4], [0.5, 23]], sag),
        belt: P(L, [[-0.5, 22], [-0.42, 26.8], [-0.27, 28.4], [0.28, 29.2], [0.44, 26.6], [0.5, 22.4]], sag),
        wind: [[0.06 * L, 0.28 * L], [-0.27 * L, -0.12 * L]],
        side: [[-0.235 * L, -0.03 * L], [-0.005 * L, 0.255 * L]],
        seams: o.wrecked ? [] : [0.27 * L, -0.015 * L, -0.25 * L],
        recess: o.wrecked,
      };
      const body = loftBody(spec);
      if (!o.wrecked) handles(B, body, [0.2 * L, -0.08 * L], 25 + sag, v.color);
      finishBody(B, body, v, L, W, { spec, frontY: 18 + sag, rearY: 21 + sag, spread: W * 0.34, plateY: 13 + sag, bumperY: 12 + sag, mirrorX: 0.2 * L, mirrorY: 30 + sag });
      wheels4(B, [-wx, wx], W, R, 7, v);
      if (DETAIL.level >= 3) cinExtras(B, o, v, L, W, R, wx, sag, 9.5, { x0: -0.27 * L, x1: 0.26 * L, floor: 14 + sag, roof: 39.5 + sag, rows: [0.1 * L, -0.13 * L] });
      vehicleExtras(B, o, v);
      if (o.wrecked && r.chance(0.5)) B.rbox('std', 0.33 * L, 31 + sag, 0, 0.28 * L, 1.4, W * 0.86, 0.5, v.color, [0, 0, 0.55], { surf: [DET.char, 0.9, 0.3] });
      if (!o.wrecked && v.doorOpen) door(B, 0.02 * L, 0.21 * L, 12 + sag, 28 + sag, W, v);
      break;
    }
    case 'suv': {
      const R = 9.6;
      const wx = 0.31 * L;
      const spec = {
        L, W, rocker: 12 + sag, wheels: [{ x: -wx, r: R }, { x: wx, r: R }], tumble: 0.84, taper: 0.1,
        top: P(L, [[-0.5, 30], [-0.49, 52.5], [-0.46, 54.6], [0.12, 55.2], [0.3, 35.6], [0.46, 33], [0.5, 29]], sag),
        belt: P(L, [[-0.5, 30], [-0.47, 34.5], [0.3, 35.2], [0.46, 32.4], [0.5, 29]], sag),
        wind: [[0.12 * L, 0.3 * L], [-0.495 * L, -0.465 * L]],
        side: [[-0.44 * L, -0.23 * L], [-0.2 * L, 0.0], [0.03 * L, 0.27 * L]],
        seams: o.wrecked ? [] : [0.29 * L, 0.015 * L, -0.215 * L],
        recess: o.wrecked,
      };
      const body = loftBody(spec);
      if (!o.wrecked) handles(B, body, [0.22 * L, -0.06 * L], 32 + sag, v.color);
      finishBody(B, body, v, L, W, { spec, frontY: 26 + sag, rearY: 38 + sag, spread: W * 0.35, plateY: 18 + sag, bumperY: 15 + sag, mirrorX: 0.26 * L, mirrorY: 38 + sag });
      wheels4(B, [-wx, wx], W, R, 8, v);
      if (DETAIL.level >= 3) cinExtras(B, o, v, L, W, R, wx, sag, 12, { x0: -0.46 * L, x1: 0.28 * L, floor: 17 + sag, roof: 52.5 + sag, rows: [0.13 * L, -0.08 * L] });
      vehicleExtras(B, o, v);
      if (!o.wrecked && r.chance(0.45)) roofRack(B, -0.15 * L, 55.4 + sag, 0.5 * L, W * 0.76, r);
      // spare wheel on the tailgate
      if (r.chance(0.5)) B.add('std', T.lathe('tyre', TYRE_PROFILE, 18), [-0.5 * L - 3.4, 30 + sag, 0], [8, 5, 8], [0, 0, Math.PI / 2], o.wrecked ? '#1a1614' : TIRE, { surf: [DET.rubber, 0.85, 0], map: 'cyl' });
      if (!o.wrecked && v.doorOpen) door(B, 0.03 * L, 0.25 * L, 15 + sag, 36 + sag, W, v);
      break;
    }
    case 'pickup': {
      const R = 9.8;
      const wx = 0.3 * L;
      const spec = {
        L, W, rocker: 12 + sag, wheels: [{ x: -wx, r: R }, { x: wx, r: R }], tumble: 0.84, taper: 0.08,
        top: P(L, [[-0.5, 33], [-0.14, 33], [-0.135, 54], [-0.11, 56.4], [0.1, 57], [0.23, 37.4], [0.45, 34.6], [0.5, 30]], sag),
        belt: P(L, [[-0.5, 34], [-0.14, 34], [0.23, 36.2], [0.45, 34], [0.5, 30]], sag),
        bed: { x: -0.14 * L, floor: 23 + sag },
        wind: [[0.1 * L, 0.23 * L], [-0.137 * L, -0.12 * L]],
        side: [[-0.11 * L, 0.21 * L]],
        seams: o.wrecked ? [] : [0.23 * L, -0.125 * L],
        recess: o.wrecked,
      };
      const body = loftBody(spec);
      if (!o.wrecked) handles(B, body, [0.14 * L], 32 + sag, v.color);
      finishBody(B, body, v, L, W, { spec, frontY: 28 + sag, rearY: 29 + sag, spread: W * 0.36, plateY: 19 + sag, bumperY: 16 + sag, mirrorX: 0.18 * L, mirrorY: 40 + sag, chromeBumper: true });
      // tailgate closing the bed
      B.rblock(v.paintBucket, -0.5 * L + 1.2, 23 + sag, 0, 2.2, 11, W * 0.86, 0.6, v.color, null, { surf: v.paintSurf });
      if (!o.wrecked && r.chance(0.55)) {
        // cargo: a tarp-covered load or a few boxes
        if (r.chance(0.5)) B.add('std', T.pillow(10, 6, 0.5), [-0.3 * L, 28 + sag, 0], [0.15 * L, 6, W * 0.34], null, r.pick(['#3b4a3a', '#5a4a38', '#2f4858']), { surf: [DET.plastic, 0.4, 0] });
        else for (let k = 0; k < 3; k++) B.rblock('std', -0.36 * L + k * 9, 23 + sag, r.range(-8, 8), 10, 8 + k * 2, 11, 0.5, '#7a5a32', [0, r.range(-0.3, 0.3), 0], { surf: [DET.wood, 0.8, 0] });
      }
      wheels4(B, [-wx, wx], W, R, 8, v);
      if (DETAIL.level >= 3) cinExtras(B, o, v, L, W, R, wx, sag, 12, { x0: -0.13 * L, x1: 0.21 * L, floor: 17 + sag, roof: 54.5 + sag, rows: [0.08 * L, -0.06 * L] });
      vehicleExtras(B, o, v);
      if (!o.wrecked && v.doorOpen) door(B, -0.1 * L, 0.2 * L, 15 + sag, 36 + sag, W, v);
      break;
    }
    case 'van': {
      const R = 9.2;
      const wx = 0.33 * L;
      const spec = {
        L, W, rocker: 11 + sag, wheels: [{ x: -wx, r: R }, { x: wx, r: R }], tumble: 0.93, taper: 0.07,
        top: P(L, [[-0.5, 68], [-0.485, 71.4], [0.3, 71.6], [0.36, 69.5], [0.43, 42], [0.48, 38.5], [0.5, 32]], sag),
        belt: P(L, [[-0.5, 40], [0.36, 41], [0.44, 39.5], [0.5, 32]], sag),
        wind: [[0.36 * L, 0.43 * L]],
        side: [[0.22 * L, 0.38 * L]],
        recess: o.wrecked,
      };
      const body = loftBody(spec);
      finishBody(B, body, v, L, W, { spec, frontY: 30 + sag, rearY: 30 + sag, spread: W * 0.38, plateY: 19 + sag, bumperY: 14 + sag, mirrorX: 0.35 * L, mirrorY: 44 + sag });
      // rear door windows and the split between the doors
      for (const sd of [-1, 1]) B.box(o.wrecked ? 'std' : GL(), -0.5 * L - 0.15, 56 + sag, sd * W * 0.2, 0.5, 13, W * 0.3, o.wrecked ? INTERIOR : GLASS, null, o.wrecked ? { surf: [DET.char, 0.95, 0] } : null);
      B.box('std', -0.5 * L - 0.2, 42 + sag, 0, 0.5, 52, 0.8, TRIM);
      if (!o.wrecked && hash01(o.id * 5) < 0.5) {
        // a livery stripe (plumber / delivery van)
        for (const sd of [-1, 1]) B.box('paint', -0.05 * L, 47 + sag, sd * (W * 0.492), 0.8 * L, 5, 0.4, shadeHex(v.color, 0.45), null, { surf: v.paintSurf });
      }
      wheels4(B, [-wx, wx], W, R, 8, v);
      if (DETAIL.level >= 3) cinExtras(B, o, v, L, W, R, wx, sag, 11, { x0: 0.18 * L, x1: 0.42 * L, floor: 17 + sag, roof: 68 + sag, rows: [0.3 * L], bench: false });
      vehicleExtras(B, o, v);
      if (!o.wrecked && v.doorOpen) {
        // sliding side door pulled back: a dark opening and the door outside the body line
        B.box('std', 0.05 * L, 40 + sag, W / 2 + 0.2, 0.26 * L, 44, 0.4, INTERIOR, null, { surf: [0, 0.95, 0] });
        B.rbox(v.paintBucket, -0.22 * L, 40 + sag, W / 2 + 2.2, 0.26 * L, 44, 1.6, 0.5, v.color, null, { surf: v.paintSurf });
      }
      break;
    }
    case 'truck': militaryTruck(B, o, v, L, W, sag); break;
    default: B.rblock(v.paintBucket, 0, 0, 0, L, 40, W, 2, v.color);
  }
}

/** Door handles on both flanks (tiny, darker than the paint, just proud of the body). */
function handles(B, body, xs, y, color) {
  if (DETAIL.level >= 3) { CIN.cinDoorFurniture(B, body, xs, y, color); return; }
  for (const x of xs) {
    const h = body.halfW(x);
    for (const sd of [-1, 1]) B.rbox('std', x, y, sd * (h + 0.1), 3.4, 0.9, 0.7, 0.3, shadeHex(color, -0.45), null, { surf: [0, 0.35, 0.6] });
  }
}

/** Profile points given as fractions of L → units (y shifted by sag). */
function P(L, pts, sag = 0) { return pts.map(([x, y]) => [x * L, y + sag]); }

/** Per-vehicle look: paint vs char, lights, hazards, doors, glass state. */
function vehicleLook(B, o) {
  const r = B.rng;
  const wrecked = !!o.wrecked;
  let color = o.color || '#555555';
  if (wrecked) color = mixHex(r.pick(CHAR), color, 0.18);
  const v = {
    wrecked,
    color,
    paintBucket: wrecked ? 'std' : 'paint',
    paintSurf: wrecked ? [DET.char, 0.92, 0.25] : [DET.panel, -1, -1],
    lightsOn: !wrecked && hash01(o.id * 3 + 11) < 0.22,
    hazards: !wrecked && hash01(o.id * 7 + 5) < 0.35,
    doorOpen: !wrecked && hash01(o.id * 13 + 1) < 0.2,
    cracked: !wrecked && hash01(o.id * 17 + 9) < 0.3,
    brake: false,
  };
  // special jobs (taxi, police, ambulance, deliveries...) repaint the body; damage picks (flat tyre, open hood, dents)
  v.role = roleFor(o);
  if (v.role && ROLE_COLOR[v.role]) v.color = ROLE_COLOR[v.role];
  v.dmg = damageFor(o);
  if (v.role === 'police' || v.role === 'ambulance' || v.role === 'fire') v.lightsOn = hash01(o.id * 3 + 11) < 0.6;
  return v;
}

function finishBody(B, body, v, L, W, o) {
  emitBody(B, body, v);
  const hwF = body.halfW(L / 2 - 1), hwR = body.halfW(-L / 2 + 1);
  // bumpers: black plastic (or chrome on work trucks), wrapping round the corners
  const bumperC = o.chromeBumper && !v.wrecked ? CHROME : TRIM;
  const bSurf = o.chromeBumper && !v.wrecked ? [0, 0.18, 1] : [DET.plastic, 0.55, 0];
  B.rbox('std', L / 2 - 0.6, o.bumperY, 0, 4.4, 5, hwF * 2 + 0.6, 1.6, v.wrecked ? '#1a1715' : bumperC, null, { surf: v.wrecked ? [DET.char, 0.9, 0.2] : bSurf });
  B.rbox('std', -L / 2 + 0.6, o.bumperY, 0, 4.4, 5, hwR * 2 + 0.6, 1.6, v.wrecked ? '#1a1715' : TRIM, null, { surf: v.wrecked ? [DET.char, 0.9, 0.2] : [DET.plastic, 0.55, 0] });
  // grille
  if (DETAIL.level >= 3 && !v.wrecked) CIN.cinGrille(B, L, W, o.frontY, hwF);
  else B.box('std', L / 2 + 0.1, o.frontY - 1, 0, 1, 5, W * 0.36, '#0e0f10', null, { surf: [DET.corrugated, 0.5, 0.6] });
  if (v.wrecked) return;
  if (DETAIL.level >= 3 && o.spec) CIN.cinWipers(B, o.spec, W);
  lamps(B, v, L / 2, -L / 2, o.frontY, o.rearY, o.spread);
  plate(B, L / 2 + 1.7, o.plateY, 1);
  plate(B, -L / 2 - 1.7, o.plateY, -1);
  mirrors(B, o.mirrorX, o.mirrorY, body.halfW(o.mirrorX), v.color, v.paintBucket, v.paintSurf);
}

function wheels4(B, xs, W, R, width, v) {
  let i = 0;
  for (const x of xs) for (const sd of [-1, 1]) wheel(B, x, R, sd * (W / 2 - width / 2 - 0.6), width, sd, { wrecked: v.wrecked, spokes: 5, flat: v.dmg && v.dmg.flat === i++ });
}

/** A door swung open at ~50° from its front hinge. */
function door(B, x0, x1, y0, y1, W, v) {
  const len = x1 - x0;
  const ang = 0.9;
  const sd = B.rng.chance(0.5) ? 1 : -1;
  const hx = x1, hz = sd * W / 2;
  const cx = hx - Math.cos(ang) * len / 2, cz = hz + sd * Math.sin(ang) * len / 2;
  B.rbox(v.paintBucket, cx, (y0 + y1) / 2, cz, len, y1 - y0, 2, 0.6, v.color, [0, sd * ang, 0], { surf: v.paintSurf });
  // the opening: dark cabin behind
  B.box('std', (x0 + x1) / 2, (y0 + y1) / 2 + 2, sd * (W / 2 - 0.4), len * 0.9, (y1 - y0) * 0.7, 0.6, INTERIOR, null, { surf: [0, 0.95, 0] });
}

function roofRack(B, x, y, len, w, r) {
  for (const sd of [-1, 1]) B.box('std', x, y + 1.2, sd * w / 2, len, 1.2, 1.4, '#1c1c1c', null, { surf: [0, 0.4, 0.8] });
  for (let k = -1; k <= 1; k += 2) B.box('std', x + k * len * 0.3, y + 2, 0, 1.4, 1.2, w, '#1c1c1c', null, { surf: [0, 0.4, 0.8] });
  if (r.chance(0.6)) B.add('std', T.pillow(10, 6, 0.45), [x, y + 5, 0], [len * 0.34, 3.4, w * 0.4], null, r.pick(['#2f3a44', '#4a3b2a', '#3b4a3a']), { surf: [DET.fabric, 0.8, 0] });
}

// ---- military truck --------------------------------------------------------------------------

function militaryTruck(B, o, v, L, W, sag) {
  if (v.role === 'fire') { fireTruck(B, o, v, L, W, wheel); return; }
  const r = B.rng;
  const olive = v.wrecked ? v.color : o.color;
  const bb = v.paintBucket;
  const ps = v.wrecked ? v.paintSurf : [DET.panel, 0.7, 0.2];
  // chassis rails and bumper
  B.block('std', 0, 13 + sag, 0, L * 0.98, 5, W * 0.62, '#1a1b16', null, { surf: [DET.rust, 0.8, 0.5] });
  B.rbox('std', L / 2 - 1, 18 + sag, 0, 3, 6, W, 0.8, '#23241e', null, { surf: [DET.rust, 0.7, 0.4] });
  // hood + cab (flat military sheet metal, rounded seams)
  B.rblock(bb, 0.39 * L, 20 + sag, 0, 0.22 * L, 22, W * 0.8, 2.4, olive, null, { surf: ps });
  B.rblock(bb, 0.2 * L, 20 + sag, 0, 0.17 * L, 58, W * 0.96, 2.2, olive, null, { surf: ps });
  // fenders over the front wheels
  for (const sd of [-1, 1]) B.rblock(bb, 0.36 * L, 22 + sag, sd * W * 0.42, 0.24 * L, 3, W * 0.2, 1.2, olive, null, { surf: ps });
  // windshield (two panes), side windows
  for (const sd of [-1, 1]) B.box(v.wrecked ? 'std' : GL(), 0.285 * L + 0.2, 62 + sag, sd * W * 0.22, 0.6, 14, W * 0.38, v.wrecked ? INTERIOR : GLASS, [0, 0, -0.08], v.wrecked ? { surf: [DET.char, 0.95, 0] } : null);
  for (const sd of [-1, 1]) B.box(v.wrecked ? 'std' : GL(), 0.2 * L, 62 + sag, sd * (W * 0.48 + 0.3), 0.1 * L, 12, 0.6, v.wrecked ? INTERIOR : GLASS, null, v.wrecked ? { surf: [DET.char, 0.95, 0] } : null);
  // grille: vertical slots
  B.box('std', 0.5 * L + 0.2, 31 + sag, 0, 1, 14, W * 0.5, '#15160f', null, { surf: [DET.corrugated, 0.6, 0.5] });
  // bed with canvas tilt on bows
  B.rblock(bb, -0.2 * L, 18 + sag, 0, 0.6 * L, 14, W * 0.98, 1, olive, null, { surf: ps });
  const canvasC = v.wrecked ? '#24221c' : mixHex(olive, '#6f6a4a', 0.35);
  if (!v.wrecked || r.chance(0.5)) {
    B.rblock('std', -0.2 * L, 32 + sag, 0, 0.58 * L, 40, W * 0.96, 2.5, canvasC, null, { surf: [DET.fabric, 0.9, 0] });
    B.add('std', T.cyl(14, 1, false), [-0.2 * L, 70 + sag, 0], [W * 0.48, 0.58 * L, 20], [0, 0, Math.PI / 2], canvasC, { surf: [DET.fabric, 0.9, 0], map: 'box' });
    // the bows under the canvas show as ribs; a tie-down rope along the bottom edge
    for (let x = -0.46; x < 0.07; x += 0.1) B.rbox('std', x * L, 54 + sag, 0, 1.6, 42, W * 0.975, 0.7, shadeHex(canvasC, -0.22), null, { surf: [DET.fabric, 0.9, 0] });
    for (const sd of [-1, 1]) B.box('std', -0.2 * L, 34 + sag, sd * W * 0.485, 0.58 * L, 1, 0.8, '#3a3526', null, { surf: [0, 0.9, 0] });
  } else {
    for (let x = -0.45; x < 0.1; x += 0.13) B.add('std', T.torus(8, 0.05), [x * L, 62 + sag, 0], [W * 0.46, W * 0.46, W * 0.46], [0, Math.PI / 2, 0], '#1a1a18', { surf: [DET.char, 0.9, 0.5] });
  }
  if (DETAIL.level >= 3 && !v.wrecked) {
    CIN.cinInterior(B, o.id, { x0: 0.12 * L, x1: 0.285 * L, floor: 30 + sag, roof: 74 + sag, hw: W * 0.42, rows: [0.2 * L], bench: false }, v.lightsOn);
    CIN.cinRibs(B, 0.13 * L, 0.27 * L, [42 + sag], W * 0.48, shadeHex(olive, -0.06), ps);
    for (let x = -0.44; x < 0.06; x += 0.1) for (const sd of [-1, 1]) B.rbox('std', x * L, 50 + sag, sd * W * 0.488, 1.8, 30, 0.5, 0.2, shadeHex(canvasC, -0.32), null, { surf: [DET.fabric, 0.9, 0], noAO: true });   // the canvas ties
    for (const sd of [-1, 1]) {
      B.box('std', 0.31 * L, 60 + sag, sd * (W * 0.5 + 3), 0.8, 0.8, 5, '#1a1a18', null, { surf: [DET.rust, 0.5, 0.7] });     // mirror arms
      B.rbox('std', 0.31 * L, 62 + sag, sd * (W * 0.5 + 6), 1.2, 8, 4, 0.5, '#23251c', null, { surf: [DET.rust, 0.5, 0.6] });
    }
    for (let k = 0; k < 5; k++) B.box('std', 0.44 * L, 30 + sag + k * 2.2, 0, 0.5, 0.6, W * 0.4, '#0a0a08', null, { surf: [0, 0.6, 0.3], noAO: true });                       // grille slots
  }
  // fuel tank, spare wheel, jerrycans
  B.cylX('std', 0.05 * L, 20 + sag, W * 0.44, 5, 0.14 * L, shadeHex(olive, -0.2), 10, { surf: [DET.panel, 0.6, 0.4] });
  if (!v.wrecked) for (let k = 0; k < 2; k++) B.rblock('std', -0.5 * L + 3, 20 + sag, -W * 0.3 + k * 6, 3, 10, 5, 0.6, '#3a4a2a', null, { surf: [DET.panel, 0.6, 0.3] });
  // wheels: single front, dual rear
  const R = 12;
  for (const [x, dual] of [[0.36, false], [-0.18, true], [-0.36, true]]) {
    for (const sd of [-1, 1]) {
      wheel(B, x * L, R, sd * (W / 2 - 5.5), 10, sd, { wrecked: v.wrecked, spokes: 0, rim: '#3a3f2a' });
      if (dual && !v.wrecked) wheel(B, x * L, R, sd * (W / 2 - 15), 9, sd, { spokes: 0, rim: '#3a3f2a' });
    }
  }
  if (!v.wrecked) {
    lamps(B, v, 0.5 * L + 0.2, -0.5 * L, 30 + sag, 24 + sag, W * 0.38, [1.4, 5, 5], [1.2, 3, 5]);
    // blackout marker and a white star
    for (const sd of [-1, 1]) B.add('decal', T.plane(), [0.2 * L, 45 + sag, sd * (W * 0.48 + 0.35)], [12, 12, 1], [0, sd > 0 ? 0 : Math.PI, 0], '#ffffff', { uv: atlasUV('star'), noAO: true });
  }
}

// ---- semi cab / trailer / tanker ----------------------------------------------------------------

/** Cab-over semi tractor (the 'semi' obstacle of length ≤ 100). */
export function buildSemiCab(B, o) {
  const L = o.w, W = o.h;
  const v = vehicleLook(B, o);
  const sag = o.wrecked ? -3 : 0;
  const bb = v.paintBucket, ps = v.paintSurf;
  // chassis + fifth wheel
  B.block('std', -0.1 * L, 12 + sag, 0, L * 1.02, 6, W * 0.6, '#161616', null, { surf: [DET.rust, 0.8, 0.5] });
  // cab box with big rounded edges, a roof fairing and a sleeper step
  B.rblock(bb, 0.12 * L, 22 + sag, 0, 0.74 * L, 70, W * 0.97, 4, v.color, null, { surf: ps });
  B.rblock(bb, 0.06 * L, 92 + sag, 0, 0.62 * L, 16, W * 0.9, 5, shadeHex(v.color, 0.06), [0, 0, 0.12], { surf: ps });
  B.rblock(bb, -0.3 * L, 22 + sag, 0, 0.2 * L, 60, W * 0.9, 3, shadeHex(v.color, -0.1), null, { surf: ps });
  // windshield (split), side windows
  if (v.wrecked) {
    B.box('std', 0.49 * L, 76 + sag, 0, 0.6, 22, W * 0.84, INTERIOR, null, { surf: [DET.char, 0.95, 0] });
  } else {
    B.box(GL(), 0.49 * L + 0.15, 76 + sag, 0, 0.6, 22, W * 0.84, GLASS, [0, 0, -0.06], { surf: [v.cracked ? DET.glass : 0, -1, -1] });
    B.box('std', 0.49 * L + 0.5, 76 + sag, 0, 0.6, 22, 1.2, TRIM);
  }
  for (const sd of [-1, 1]) {
    B.box(v.wrecked ? 'std' : GL(), 0.3 * L, 76 + sag, sd * (W * 0.485 + 0.3), 0.24 * L, 18, 0.6, v.wrecked ? INTERIOR : GLASS, null, v.wrecked ? { surf: [DET.char, 0.95, 0] } : null);
    // exhaust stack, fuel tank, steps, air horn
    B.cyl('std', -0.18 * L, 30 + sag, sd * W * 0.5, 2.3, 88, v.wrecked ? '#2a2826' : CHROME, 10, 1, null, { surf: [0, v.wrecked ? 0.9 : 0.15, 1] });
    B.cylX('std', 0.05 * L, 20 + sag, sd * W * 0.44, 6.5, 0.34 * L, v.wrecked ? '#262322' : CHROME, 12, { surf: [DET.panel, v.wrecked ? 0.9 : 0.2, 1] });
    B.box('std', 0.34 * L, 16 + sag, sd * W * 0.5, 8, 1.2, 4, '#2a2a2a', null, { surf: [DET.corrugated, 0.5, 0.8] });
    if (!v.wrecked) mirrors(B, 0.42 * L, 70 + sag, W / 2, TRIM);
  }
  if (DETAIL.level >= 3 && !v.wrecked) {
    CIN.cinInterior(B, o.id, { x0: -0.16 * L, x1: 0.47 * L, floor: 30 + sag, roof: 91 + sag, hw: W * 0.44, rows: [0.24 * L], bench: false }, v.lightsOn);
    for (const sd of [-1, 1]) {
      CIN.cinRibs(B, -0.24 * L, 0.42 * L, [40 + sag], W * 0.485, shadeHex(v.color, -0.06), ps);
      B.rbox('std', 0.42 * L, 19 + sag, sd * (W * 0.5 + 1), 6, 1.4, 5, 0.4, '#2a2a2a', null, { surf: [DET.corrugated, 0.5, 0.8] });    // the second step
      B.cylX('std', 0.5 * L + 2.6, 24 + sag, sd * W * 0.44, 1.7, 3, '#e8e8e0', 10, { surf: [0, 0.3, 0.3] });                            // fog lamps
    }
  }
  // grille and bumper
  B.rbox('std', 0.5 * L + 0.6, 40 + sag, 0, 1.6, 32, W * 0.62, 0.6, v.wrecked ? '#222' : CHROME, null, { surf: [DET.corrugated, v.wrecked ? 0.9 : 0.25, 1] });
  B.rbox('std', 0.5 * L + 1.4, 20 + sag, 0, 3.4, 9, W * 1.01, 1.2, v.wrecked ? '#262626' : CHROME, null, { surf: [0, v.wrecked ? 0.9 : 0.2, 1] });
  const R = 14;
  for (const x of [0.28, -0.34]) for (const sd of [-1, 1]) wheel(B, x * L, R, sd * (W / 2 - 6.5), 12, sd, { wrecked: v.wrecked, spokes: 0, rim: '#aeb4ba' });
  if (!v.wrecked) {
    lamps(B, v, 0.5 * L + 1.2, -0.5 * L, 30 + sag, 30 + sag, W * 0.4, [1.4, 5, 9], [1, 3, 5]);
    // amber cab-roof marker lights
    for (let k = -2; k <= 2; k++) B.box('glow', 0.43 * L, 100 + sag, k * W * 0.12, 1.2, 1.6, 3, AMBER, null, { emissive: v.lightsOn ? 3 : 0.6, uv: atlasUV('white') });
  }
}

/** Box trailer (the 'semi' obstacle longer than 100). */
export function buildTrailer(B, o) {
  const L = o.w, W = o.h;
  const r = B.rng;
  const v = vehicleLook(B, o);
  const sag = o.wrecked ? -3 : 0;
  const body = v.wrecked ? v.color : o.color;
  const surf = v.wrecked ? [DET.char, 0.9, 0.3] : [DET.panel, 0.45, 0.55];
  B.block('std', 0, 14 + sag, 0, L, 8, W * 0.8, '#161616', null, { surf: [DET.rust, 0.85, 0.5] });
  B.rblock('std', 0, 22 + sag, 0, L, 102, W, 1.6, body, null, { surf });
  // vertical posts along the sides, top and bottom rails
  for (let x = -L / 2 + 10; x < L / 2 - 6; x += 20) {
    for (const sd of [-1, 1]) B.box('std', x, 73 + sag, sd * (W / 2 + 0.35), 1.6, 100, 0.8, shadeHex(body, -0.1), null, { surf });
  }
  for (const y of [23, 123]) for (const sd of [-1, 1]) B.box('std', 0, y + sag, sd * (W / 2 + 0.5), L, 3, 1, shadeHex(body, -0.2), null, { surf: [0, 0.5, 0.8] });
  // rear doors with lock bars, reflective tape, under-ride guard
  B.box('std', -L / 2 - 0.6, 73 + sag, 0, 1.2, 98, W * 0.96, shadeHex(body, -0.08), null, { surf });
  B.box('std', -L / 2 - 1.3, 73 + sag, 0, 0.6, 98, 1, '#1a1a1a');
  for (const z of [-0.3, -0.12, 0.12, 0.3]) B.cyl('std', -L / 2 - 1.8, 26 + sag, z * W, 0.7, 94, '#8a8f94', 6, 1, null, { surf: [0, 0.35, 1] });
  B.box('glow', -L / 2 - 1.2, 30 + sag, 0, 0.3, 2.2, W * 0.9, '#d01418', null, { emissive: 0.9, uv: atlasUV('stripeRW') });
  B.rbox('std', -L / 2 - 4, 14 + sag, 0, 3, 4, W * 0.9, 0.8, '#1d1d1d', null, { surf: [DET.rust, 0.8, 0.6] });
  for (const sd of [-1, 1]) {
    B.box('glow', -L / 2 - 1.4, 22 + sag, sd * W * 0.38, 0.6, 4, 6, TAIL, null, { emissive: v.lightsOn ? 2 : 0.5, uv: atlasUV('white') });
    // side marker lights and a strip of conspicuity tape
    for (let x = -0.45; x <= 0.45; x += 0.3) B.box('glow', x * L, 27 + sag, sd * (W / 2 + 0.9), 2, 1.6, 0.4, AMBER, null, { emissive: v.wrecked ? 0.2 : 1.6, uv: atlasUV('white') });
    if (!v.wrecked) B.box('glow', 0, 30 + sag, sd * (W / 2 + 0.95), L * 0.94, 1.4, 0.3, '#ffffff', null, { emissive: 0.5, uv: atlasUV('stripeRW') });
  }
  if (DETAIL.level >= 3) {
    if (!v.wrecked) {
      for (const sd of [-1, 1]) {
        CIN.cinRivets(B, -L / 2 + 6, L / 2 - 6, 24.6 + sag, sd * (W / 2 + 1.08), sd);
        CIN.cinRivets(B, -L / 2 + 6, L / 2 - 6, 122.4 + sag, sd * (W / 2 + 1.08), sd);
        CIN.cinMudflap(B, -0.37 * L, sd * (W / 2 - 6), 13);
      }
      B.rbox('std', -L / 2 - 1.8, 84 + sag, 0, 0.6, 3, 8, 0.3, '#1a1a1a', null, { surf: [DET.rust, 0.6, 0.6] });                        // the rear door handle
    }
    CIN.cinChassis(B, L, W, 16 + sag, [-0.37 * L, -0.29 * L]);
  }
  if (!v.wrecked) trailerLivery(B, o, L, W, sag);
  if (!v.wrecked && r.chance(0.6)) {
    // a faded company livery along the side
    const lc = r.pick(['#8a2f2a', '#2f4f6f', '#3f5a3a', '#6a5a2a']);
    for (const sd of [-1, 1]) B.box('std', 0, 92 + sag, sd * (W / 2 + 0.7), L * 0.8, 14, 0.4, lc, null, { surf: [DET.panel, 0.5, 0.3] });
  }
  // landing legs, tandem axle
  for (const sd of [-1, 1]) B.block('std', 0.3 * L, 0, sd * W * 0.35, 4, 22, 4, '#2a2a2a', null, { surf: [DET.rust, 0.8, 0.6] });
  for (const x of [-0.37, -0.29]) for (const sd of [-1, 1]) {
    wheel(B, x * L, 13, sd * (W / 2 - 6), 11, sd, { wrecked: v.wrecked, spokes: 0, rim: '#b0b5ba' });
  }
  if (v.wrecked) {
    B.setJitter(0.15);
    for (let i = 0; i < 5; i++) B.box('std', r.range(-L * 0.4, L * 0.4), 124.8, r.range(-W * 0.3, W * 0.3), r.range(20, 50), 1, r.range(10, 30), '#121110', null, { surf: [DET.char, 0.95, 0] });
    B.setJitter(0.07);
  }
}

/** Fuel tanker trailer. */
export function buildTanker(B, o) {
  const L = o.w, W = o.h;
  const v = vehicleLook(B, o);
  const sag = o.wrecked ? -3 : 0;
  const R = W * 0.47;
  const cy = 112 - R + sag;
  const tankC = v.wrecked ? v.color : o.color;
  const surf = v.wrecked ? [DET.char, 0.9, 0.4] : [DET.panel, 0.38, 0.85];
  B.block('std', 0, 16 + sag, 0, L, 10, W * 0.7, '#1c1c1c', null, { surf: [DET.rust, 0.85, 0.5] });
  B.add('std', T.cyl(28), [0, cy, 0], [R, L * 0.9, R], [0, 0, Math.PI / 2], tankC, { surf, map: 'cyl' });
  for (const s of [-1, 1]) B.add('std', T.sphere(20, 10), [s * L * 0.45, cy, 0], [R * 0.3, R, R], null, tankC, { surf });
  // bands, cradles, catwalk with hatches, a ladder at the back
  for (const x of [-0.3, -0.1, 0.1, 0.3]) B.add('std', T.cyl(28, 1, true), [x * L, cy, 0], [R + 0.5, 3, R + 0.5], [0, 0, Math.PI / 2], shadeHex(tankC, -0.15), { surf, map: 'cyl' });
  for (const x of [-0.35, 0.15, 0.38]) B.block('std', x * L, 24 + sag, 0, 8, cy - 24 - R * 0.6 - sag, W * 0.6, '#262626', null, { surf: [DET.rust, 0.8, 0.5] });
  B.box('std', 0, cy + R + 1, 0, L * 0.8, 1.5, 10, '#6a6d70', null, { surf: [DET.corrugated, 0.5, 0.9] });
  for (const sd of [-1, 1]) B.box('std', 0, cy + R + 5, sd * 5, L * 0.8, 0.8, 0.8, '#8a8d90', null, { surf: [0, 0.4, 1] });
  for (let x = -0.4; x <= 0.4; x += 0.2) B.cyl('std', x * L, cy + R - 2, 0, 5, 5, '#7a7d80', 10, 1, null, { surf: [0, 0.4, 0.9] });
  for (let y = 30; y < cy + R; y += 8) B.box('std', -L / 2 - 1, y + sag, W * 0.2, 1, 0.8, 8, '#888', null, { surf: [0, 0.4, 1] });
  // hazard band and placards
  for (const s of [-1, 1]) {
    B.box('std', 0, cy, s * (R + 0.3), L * 0.5, 7, 0.8, v.wrecked ? '#2a2420' : '#b0301c', null, { surf: [0, 0.5, 0.2] });
    if (!v.wrecked) B.add('decal', T.plane(), [L * 0.3, cy + 2, s * (R + 0.5)], [11, 11, 1], [0, s > 0 ? 0 : Math.PI, Math.PI / 4], '#ffffff', { uv: atlasUV('hazmat'), noAO: true });
  }
  if (!v.wrecked) B.add('decal', T.plane(), [-L / 2 - 0.4 - R * 0.3, cy, 0], [11, 11, 1], [0, -Math.PI / 2, Math.PI / 4], '#ffffff', { uv: atlasUV('hazmat'), noAO: true });
  for (const x of [-0.36, -0.28]) for (const sd of [-1, 1]) wheel(B, x * L, 13, sd * (W / 2 - 6), 11, sd, { wrecked: v.wrecked, spokes: 0 });
  if (DETAIL.level >= 3) {
    CIN.cinChassis(B, L, W, 16 + sag, [-0.36 * L, -0.28 * L]);
    if (!v.wrecked) {
      for (const sd of [-1, 1]) CIN.cinMudflap(B, -0.36 * L, sd * (W / 2 - 6), 13);
      CIN.cinManifold(B, -L / 2 - 4, 40 + sag, W);
      for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) CIN.cinRivets(B, x * L - 8, x * L + 8, cy + R + 0.4, 5.5, 1, '#8a8d90', 4, 0.5);   // the manway bolts
    }
  }
  for (const sd of [-1, 1]) B.box('glow', -L / 2 - 0.6, 22 + sag, sd * W * 0.36, 0.6, 3, 6, TAIL, null, { emissive: v.wrecked ? 0.2 : 0.8, uv: atlasUV('white') });
}

// ---- bus / RV -------------------------------------------------------------------------------------

/**
 * School bus (yellow, black rub rails, stop arm, flashers) or RV / coach in its colour.
 * @param {boolean} objective lit windows with survivors, hazards on
 */
export function buildBus(B, o, objective) {
  const L = o.w, W = o.h;
  const r = B.rng;
  const color = objective ? '#e3a41a' : o.color;
  const school = objective || /^#d9a|^#e3a|^#d8a/i.test(color);
  // the objective bus: weathered enamel, not metallic flake (everyone aims at it with a flashlight)
  const v = objective ? { wrecked: false, color, paintBucket: 'paint', paintSurf: [DET.panel, 0.55, 0.12], lightsOn: true, hazards: true, doorOpen: false, cracked: false } : vehicleLook(B, { ...o, color });
  const sag = v.wrecked ? -3 : 0;
  const bb = v.paintBucket, ps = v.paintSurf;
  const bc = v.wrecked ? v.color : color;
  // chassis skirt, body with a well-rounded roof, hood at the front (school bus)
  B.block('std', 0, 10 + sag, 0, L * 0.98, 6, W * 0.9, '#161616', null, { surf: [DET.rust, 0.85, 0.5] });
  const hood = school ? 0.09 * L : 0;
  B.rblock(bb, -hood / 2, 14 + sag, 0, L - hood, 84, W, 5.5, bc, null, { surf: ps });
  if (school) {
    B.rblock(bb, L / 2 - hood / 2, 14 + sag, 0, hood + 1, 34, W * 0.78, 3.2, bc, null, { surf: ps });
    B.box('std', L / 2 + 0.6, 30 + sag, 0, 0.8, 12, W * 0.42, '#101010', null, { surf: [DET.corrugated, 0.4, 0.8] });
  }
  B.block('std', 0, 13 + sag, 0, L * 1.002, 12, W * 1.01, shadeHex(bc, -0.4), null, { surf: [DET.rust, 0.8, 0.3] });
  // windows
  const x0 = -0.44 * L, x1 = (school ? 0.3 : 0.36) * L;
  const n = Math.max(3, Math.round((x1 - x0) / 26));
  const step = (x1 - x0) / n;
  for (const sd of [-1, 1]) {
    const z = sd * (W / 2 + 0.3);
    const zr = sd > 0 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * step;
      if (objective) {
        const cell = hash01(i * 7 + (sd > 0 ? 3 : 0)) < 0.7 ? 'busWin' : 'win';
        B.add('glow', T.plane(), [x, 67 + sag, z], [step - 4, 22, 1], [0, zr, 0], '#ffffff', { emissive: 1.0, uv: atlasUV(cell) });
      } else if (v.wrecked) {
        B.box('std', x, 67 + sag, z - sd * 0.6, step - 4, 22, 0.6, INTERIOR, null, { surf: [DET.char, 0.95, 0] });
      } else if (school || i % 2 === 0 || r.chance(0.4)) {
        B.box(GL(), x, 67 + sag, z, step - 4, 22, 0.5, GLASS, null, { surf: [v.cracked && r.chance(0.3) ? DET.glass : 0, -1, -1] });
      }
      // window frames
      B.box('std', x - step / 2, 67 + sag, z * 1.002, 2.4, 24, 0.9, school ? shadeHex(bc, -0.05) : '#202020', null, { surf: [0, 0.5, 0.3] });
    }
    if (school) for (const y of [44, 52, 29]) B.box('std', 0, y + sag, sd * (W / 2 + 0.55), L * 0.96, 2.5, 0.8, '#0e0e0e', null, { surf: [0, 0.5, 0.4] });
    else B.box(bb, -0.02 * L, 44 + sag, sd * (W / 2 + 0.4), L * 0.94, 7, 0.5, r.pick(['#8a2f2a', '#2f4f6f', '#7a6a4f', '#3f5a3a']), null, { surf: ps });
    B.rbox('std', 0.5 * L + 5, 72 + sag, sd * (W / 2 + 4), 2, 12, 5, 0.8, '#1a1a1a', null, { surf: [0, 0.5, 0.2] });   // mirrors
  }
  if (DETAIL.level >= 3 && !v.wrecked && !objective) CIN.cinBusInterior(B, o.id || 3, L, W, sag, x0, (school ? 0.3 : 0.36) * L, hood);
  if (DETAIL.level >= 3 && !v.wrecked) {
    CIN.cinRibs(B, -L / 2 + 6, L / 2 - hood - 4, school ? [22 + sag, 60 + sag] : [24 + sag], W / 2, shadeHex(bc, -0.05), ps);
    for (const sd of [-1, 1]) for (const y of school ? [44 + sag, 52 + sag] : [44 + sag]) CIN.cinRivets(B, -L * 0.46, L / 2 - hood - 6, y + 1.7, sd * (W / 2 + 0.6), sd, shadeHex(bc, -0.3));
    B.rbox('std', -L * 0.05, 91 + sag, 0, 16, 2.6, 14, 0.8, shadeHex(bc, -0.08), null, { surf: ps });                              // roof hatch
    B.rbox('std', -L * 0.05, 93.4 + sag, 0, 12, 1.4, 10, 0.6, shadeHex(bc, -0.14), null, { surf: ps });
    for (const sd of [-1, 1]) B.box('std', -L / 2 - 1.4, 44 + sag, sd * W * 0.32, 1, 60, 0.8, '#2a2c2e', null, { surf: [DET.rust, 0.6, 0.7] });   // the rear ladder
    for (let y = 22; y < 80; y += 7) B.box('std', -L / 2 - 1.5, y + sag, 0, 1, 0.8, W * 0.64, '#2a2c2e', null, { surf: [DET.rust, 0.6, 0.7] });
  }
  // windshield, door, rear emergency door
  const fx = L / 2 - hood;
  if (!v.wrecked) {
    B.box(GL(), fx + 0.3, 66 + sag, 0, 0.7, 28, W * 0.88, objective ? '#2a2a24' : GLASS, null, null);
    B.box(GL(), fx - 6, 50 + sag, W / 2 + 0.3, 12, 56, 0.5, GLASS);
  } else {
    B.box('std', fx + 0.3, 66 + sag, 0, 0.7, 28, W * 0.88, INTERIOR, null, { surf: [DET.char, 0.95, 0] });
  }
  B.box(v.wrecked ? 'std' : GL(), -L / 2 - 0.3, 68 + sag, 0, 0.7, 22, W * 0.34, objective ? '#3a2a18' : v.wrecked ? INTERIOR : GLASS);
  B.box(bb, -L / 2 - 0.5, 50 + sag, 0, 0.8, 70, W * 0.4, shadeHex(bc, -0.12), null, { surf: ps });
  B.rbox('std', L / 2 + 1, 18 + sag, 0, 3, 8, W * 0.98, 1, '#161616', null, { surf: [DET.plastic, 0.5, 0.2] });
  B.rbox('std', -L / 2 - 1, 18 + sag, 0, 3, 8, W * 0.98, 1, '#161616', null, { surf: [DET.plastic, 0.5, 0.2] });
  if (objective) B.add('glow', T.plane(), [fx + 0.75, 88 + sag, 0], [W * 0.6, 7, 1], [0, Math.PI / 2, 0], '#ffcf6a', { emissive: 1.6, uv: atlasUV('white') });
  if (school) {
    busLettering(B, L, W, hood, sag);
    B.cyl('std', 0.34 * L, 50 + sag, -W / 2 - 3, 7, 1.2, '#b01818', 12, 1, [Math.PI / 2, 0, 0], { surf: [0, 0.5, 0.1] });
    // eight-way flashers on the roof cap
    for (const x of [-1, 1]) for (const z of [-1, 1]) B.box(objective ? 'blink' : 'glow', (x * L) / 2 * 0.97 - (x > 0 ? hood : 0), 92 + sag, z * W * 0.3, 1.4, 4, 6, x > 0 ? AMBER : '#ff2a1a', null, objective ? { emissive: 3.2 } : { emissive: 0.6, uv: atlasUV('white') });
  }
  if (!v.wrecked) {
    lamps(B, v, L / 2 + 0.6, -L / 2 - 0.4, 24 + sag, 26 + sag, W * 0.4, [1.4, 5, 7], [1.2, 5, 5]);
    plate(B, -L / 2 - 1, 22 + sag, -1);
  }
  const R = 15;
  for (const x of [0.33, -0.28]) for (const sd of [-1, 1]) wheel(B, x * L, R, sd * (W / 2 - 7), 12, sd, { wrecked: v.wrecked, spokes: 0, rim: school ? '#c9a21a' : '#b0b5ba' });
}

// ---- APC --------------------------------------------------------------------------------------------

export function buildApc(B, L, W) {
  const olive = '#46502a';
  const dark = shadeHex(olive, -0.25);
  const S = [DET.panel, 0.62, 0.35];
  const R = 14.5;
  // lower hull: narrow, between the wheels
  B.rblock('std', 0, 12, 0, L * 0.94, 20, W * 0.56, 2, shadeHex(olive, -0.12), null, { surf: [DET.rust, 0.75, 0.3] });
  // upper hull: faceted body flaring out over the wheels (sponsons), pointed glacis
  B.prism('std', 'apc-hull2', P(L, [[-0.5, 27], [0.44, 27], [0.5, 34], [0.3, 52], [-0.44, 56], [-0.5, 50]]), 0, W * 0.92, olive, { surf: S }, 1.4);
  B.prism('std', 'apc-deck', P(L, [[-0.42, 55.5], [0.26, 52.5], [0.2, 57], [-0.38, 59]]), 0, W * 0.7, shadeHex(olive, 0.04), { surf: S }, 0.8);
  // wheels under the sponsons, with hubs and bump stops showing
  for (const x of [-0.37, -0.13, 0.13, 0.37]) {
    for (const sd of [-1, 1]) {
      wheel(B, x * L, R, sd * (W * 0.4), 12, sd, { spokes: 0, rim: '#39402a' });
      B.rbox('std', x * L, 27.5, sd * W * 0.4, 16, 2, 13, 0.6, dark, null, { surf: S });   // wheel-arch lip
    }
  }
  for (const sd of [-1, 1]) {
    // bolt rows along the sponson edge, stowage bins, a side door, vision blocks
    for (let x = -0.44; x <= 0.44; x += 0.055) B.box('std', x * L, 28.4, sd * (W * 0.46 + 0.2), 1, 1, 1, shadeHex(olive, -0.35), null, { surf: [0, 0.5, 0.6] });
    B.rbox('std', -0.2 * L, 43, sd * (W * 0.43), 26, 9, 5, 0.8, dark, null, { surf: S });
    B.rbox('std', 0.06 * L, 43, sd * (W * 0.43), 18, 9, 5, 0.8, dark, null, { surf: S });
    B.box('std', 0.2 * L, 39, sd * (W * 0.455 + 0.3), 16, 14, 0.8, shadeHex(olive, -0.15), [sd * 0.18, 0, 0], { surf: S });
    for (const x of [0.28, 0.1, -0.1]) B.box('glass', x * L, 52, sd * W * 0.33, 3, 3, 6, GLASS, [0, 0, 0.6]);
    // tool rack: a shovel and a crowbar
    B.box('std', -0.36 * L, 38, sd * (W * 0.46 + 0.8), 30, 1.4, 1, '#5a4a32', null, { surf: [DET.wood, 0.8, 0] });
    B.box('std', -0.24 * L, 38, sd * (W * 0.46 + 0.8), 10, 5, 0.6, '#3a3a38', null, { surf: [DET.rust, 0.6, 0.7] });
    // headlight clusters in cages on the glacis, tow hooks
    const hz = sd * W * 0.3;
    B.rbox('std', 0.46 * L, 36, hz, 3, 6, 9, 0.8, dark, null, { surf: S });
    B.box('glow', 0.48 * L, 36.5, hz, 0.8, 3.2, 6, '#ffe7b0', null, { emissive: 3, uv: atlasUV('white') });
    for (const dz of [-5, 5]) B.box('std', 0.49 * L + 1, 36, hz + dz, 3.4, 8, 0.8, '#23251c', null, { surf: [DET.rust, 0.6, 0.7] });
    B.add('std', T.torus(8, 0.25), [0.5 * L + 1, 26, sd * W * 0.2], [3, 3, 3], [0, Math.PI / 2, 0], '#23251c', { surf: [DET.rust, 0.6, 0.8] });
  }
  // trim vane folded on the glacis, driver's hatch with periscopes
  B.rbox('std', 0.37 * L, 44.5, 0, 3, 12, W * 0.7, 0.6, shadeHex(olive, -0.06), [0, 0, 0.95], { surf: S });
  B.rbox('std', 0.22 * L, 54, W * 0.18, 12, 3, 12, 1, dark, null, { surf: S });
  for (const dz of [-6, 0, 6]) B.box('glass', 0.29 * L, 54, W * 0.18 + dz, 2, 2.4, 4, GLASS, [0, 0, 0.5]);
  // turret: low cone, cupola, gun with a mantlet and a coaxial, smoke launchers
  B.cyl('std', -0.06 * L, 58.5, 0, 17, 11, shadeHex(olive, 0.06), 16, 0.82, null, { surf: S });
  B.rbox('std', 0.03 * L, 64, 0, 14, 9, 13, 1.4, shadeHex(olive, 0.02), null, { surf: S });
  B.cylX('std', 0.24 * L, 67, 0, 2.2, 0.5 * L, '#23251c', 10, { surf: [0, 0.4, 0.8] });
  B.cylX('std', 0.48 * L, 67, 0, 3.2, 8, '#23251c', 10, { surf: [DET.corrugated, 0.4, 0.8] });
  B.cylX('std', 0.12 * L, 71.5, 4, 1, 0.16 * L, '#23251c', 8, { surf: [0, 0.4, 0.8] });
  for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) B.add('std', T.cyl(8), [-0.02 * L, 62 + k * 2.6, sd * 13], [1.1, 5, 1.1], [0, 0, Math.PI / 2 - 0.4], '#23251c', { surf: [DET.rust, 0.6, 0.7], map: 'cyl' });
  B.cyl('std', -0.18 * L, 66, -7, 5, 5, dark, 12, 0.9, null, { surf: S });
  // open rear hatch with the crew's blue work light inside
  B.rbox('std', -0.34 * L, 62, W * 0.2, 16, 2, 16, 0.5, dark, [0, 0, 0.9], { surf: S });
  B.box('glow', -0.34 * L, 58.2, 0, 14, 0.5, 14, '#a8d8ff', null, { emissive: 2.4, uv: atlasUV('white') });
  // markings, radio whips, rolled camo net, jerrycans on the back
  for (const s2 of [-1, 1]) B.add('decal', T.plane(), [0.0 * L, 45, s2 * (W * 0.46 + 1.3)], [10, 10, 1], [s2 * 0.18, s2 > 0 ? 0 : Math.PI, 0], '#ffffff', { uv: atlasUV('star'), noAO: true });
  B.cyl('std', -0.4 * L, 58, -W * 0.3, 0.8, 80, '#222', 5, 1, null, { surf: [0, 0.5, 0.8] });
  B.cyl('std', -0.4 * L, 58, W * 0.3, 0.7, 60, '#222', 5, 1, null, { surf: [0, 0.5, 0.8] });
  B.add('std', T.cyl(10), [-0.2 * L, 60, -W * 0.3], [4.5, 0.36 * L, 4.5], [0, 0, Math.PI / 2], '#3e3a26', { surf: [DET.fabric, 0.9, 0], map: 'cyl' });
  for (let k = 0; k < 3; k++) B.rblock('std', -0.5 * L - 2.4, 30, -W * 0.24 + k * 7, 4, 13, 6, 0.6, '#3a4a2a', null, { surf: [DET.panel, 0.6, 0.3] });
}
