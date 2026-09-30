// The Rail Yard's track and rolling stock: rails on sleepers (map.levelArt.rails), boxcars, tank cars,
// hoppers, gondolas, flatcars, a caboose and two diesel locomotives (the dead one on the shed's jacks,
// the live one on the main line), derailed wagons thrown over the tracks, the water tower, floodlight
// masts, the main line's catenary and the signal gantries. Obstacles carry `style` (the wagon type),
// `label` ('open', 'derailed', 'dead', 'live', 'crane') and their colour.

import {
  T, DET, S, CONC, RUST, STEEL, PAINTED, WOOD, COL, at, pic, rod, railing, lampGlow, shadeHex, mixHex, hash01, atlasUV, toWorld,
} from './dam-kit.js';

const RAIL = S(DET.rust, 0.35, 0.85);
const SLEEPER = S(DET.wood, 0.92, 0);
const HALF = Math.PI / 2;

/** The rails and sleepers of every track (per 240-unit piece, a frame each so the cells stay local). */
export function tracks(P, rails) {
  const { B, gy, tier } = P;
  const low = tier === 'low';
  const step = low ? 42 : 21;
  let n = 0;
  for (const r of rails) {
    const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1), a = Math.atan2(r.y2 - r.y1, r.x2 - r.x1);
    const pieces = Math.ceil(len / 240);
    for (let i = 0; i < pieces; i++) {
      const t0 = (i * len) / pieces, t1 = ((i + 1) * len) / pieces, tm = (t0 + t1) / 2;
      const L = t1 - t0;
      B.obj(r.x1 + Math.cos(a) * tm, r.y1 + Math.sin(a) * tm, a, 400 + n++);
      B.setJitter(0.04);
      const rustC = mixHex('#8a8c90', '#7a5038', r.rust);
      for (const z of [-11.5, 11.5]) {
        if (!low) B.box('std', 0, 5.4, z, L, 1.2, 4.4, '#5a4a40', null, RAIL);
        B.box('std', 0, 7.4, z, L, 3, 1.8, rustC, null, RAIL);
        B.box('std', 0, 9.6, z, L, 1.6, 3.2, '#b8bcc0', null, S(DET.rust, 0.22, 0.95));
      }
      for (let x = -L / 2 + step / 2; x < L / 2; x += step) {
        const h = hash01(n * 131 + Math.round(x));
        B.box('std', x, 2.4, (h - 0.5) * 1.5, 7.4, 5, 36, mixHex('#3a2c22', '#5a4a3a', h), [0, (h - 0.5) * 0.06, 0], SLEEPER);
      }
    }
  }
}

// ---- rolling stock -----------------------------------------------------------------------------------

/** A two-axle freight truck (bogie) centred at local x. */
function bogie(B, x, R = 7.6, low = false) {
  for (const s of [-1, 1]) {
    B.box('std', x, R + 4, s * 14.5, 44, 6, 3.4, '#242528', null, RUST);
    if (!low) B.add('std', T.cyl(6, 1), [x, R + 4, s * 14.5], [4, 6, 4], [HALF, 0, 0], '#3a2e26', RUST);
    for (const dx of [-13, 13]) B.cylZ('std', x + dx, R, s * 12.6, R, 3, '#2a2b2e', low ? 8 : 14, RUST);
  }
  B.box('std', x, R + 5, 0, 12, 5, 32, '#242528', null, RUST);
  if (!low) for (const dx of [-13, 13]) B.cylZ('std', x + dx, R, 0, 1.6, 30, '#1a1a1c', 6, STEEL);
}

/** Frame, couplers and buffer beams shared by the freight cars. */
function underframe(B, L, W, low) {
  bogie(B, -L * 0.36, 7.6, low);
  bogie(B, L * 0.36, 7.6, low);
  B.box('std', 0, 18, 0, L - 6, 5, W - 8, '#26272a', null, RUST);
  B.box('std', 0, 13, 0, L * 0.5, 6, 8, '#2a2a2c', null, RUST);
  for (const s of [-1, 1]) {
    B.box('std', s * (L / 2 - 2), 16, 0, 5, 8, W - 6, '#2e2f32', null, RUST);
    B.box('std', s * (L / 2 + 3), 15, 0, 8, 5, 8, '#3a3a3c', null, RUST);
  }
}

/** End ladders and a brake wheel. */
function endGear(B, L, top, low) {
  if (low) return;
  for (const s of [-1, 1]) for (const z of [-10, 10]) rod(B, 'std', [s * (L / 2 + 0.6), 20, z], [s * (L / 2 + 0.6), top, z], 0.6, '#1c1c1e', RUST, 4);
  for (const s of [-1, 1]) for (let y = 26; y < top; y += 11) rod(B, 'std', [s * (L / 2 + 0.6), y, -10], [s * (L / 2 + 0.6), y, 10], 0.5, '#1c1c1e', RUST, 3);
  rod(B, 'std', [L / 2 + 1.5, top - 6, 0], [L / 2 + 1.5, top + 4, 0], 0.8, '#1c1c1e', RUST, 4);
  B.add('std', T.torus(10, 0.14, 4), [L / 2 + 1.5, top + 4, 0], [6, 6, 6], [0, HALF, 0], '#1c1c1e', RUST);
}

/**
 * A freight car or locomotive obstacle (kind 'bus' / 'tanker') by style. Drawn in the obstacle's frame
 * (world.js placed it); a derailed one is tipped over, the shed's stock stands on the raised floor.
 */
export function wagon(P, o) {
  const { B, gy, tier } = P;
  const low = tier === 'low';
  const L = o.w, W = o.h;
  const col = o.color || '#7a3a2a';
  // derailed: tipped on its side and dug in; stock inside the shed stands on the shed floor
  const der = o.label === 'derailed';
  const floor = P.floorAt ? P.floorAt(o) : 0;
  if (der || floor) {
    const roll = der ? (hash01(o.id * 13) < 0.5 ? 1 : -1) * (0.35 + hash01(o.id * 7) * 0.9) : 0;
    B.obj(o.x, o.y, o.a || 0, o.id * 31, floor - gy(o.x, o.y) + (der ? -6 - Math.abs(roll) * 8 : 0), der ? [roll, (hash01(o.id) - 0.5) * 0.2] : null);
  }
  switch (o.style) {
    case 'boxcar': case 'boxcargate': boxcar(B, o, L, W, col, low); break;
    case 'tankcar': tankcar(B, L, W, col, low); break;
    case 'hopper': hopper(B, L, W, col, low); break;
    case 'gondola': gondola(B, L, W, col, low); break;
    case 'flatcar': flatcar(B, o, L, W, col, low); break;
    case 'caboose': caboose(B, P, o, L, W, col, low); break;
    case 'diesel': diesel(B, P, o, L, W, col, low); break;
    default: return false;
  }
  return true;
}

function boxcar(B, o, L, W, col, low) {
  underframe(B, L, W, low);
  const top = 96, trim = shadeHex(col, -0.3), sd = { surf: [DET.siding, 0.8, 0.2], noJitter: true };
  const open = o.label === 'open';
  const dw = 70;
  // the body with a door opening on the +z side when open
  B.block('std', 0, 20, -W / 2 + 1.6, L - 8, top - 20, 3.2, col, null, sd);
  if (open) {
    for (const [x0, x1] of [[-L / 2 + 4, -dw / 2], [dw / 2, L / 2 - 4]]) B.block('std', (x0 + x1) / 2, 20, W / 2 - 1.6, x1 - x0, top - 20, 3.2, col, null, sd);
    B.block('std', 0, top - 12, W / 2 - 1.6, dw, 12, 3.2, col, null, sd);
    B.block('std', 0, 20, 0, dw + 20, 1, W - 8, '#3a2e24', null, WOOD);
    // inside: crates, a lantern's worth of supplies
    for (let k = 0; k < 4; k++) B.rblock('std', -20 + k * 14, 21, -12 + (k % 2) * 16, 14, 14 + (k % 3) * 4, 14, 0.6, '#7a5a32', [0, k * 0.3, 0], WOOD);
    B.block('std', dw / 2 + dw * 0.45, 22, W / 2 + 2.4, dw * 0.9, 64, 2.4, shadeHex(col, 0.06), null, sd);
  } else {
    B.block('std', 0, 20, W / 2 - 1.6, L - 8, top - 20, 3.2, col, null, sd);
    B.block('std', 0, 22, W / 2 + 1.2, dw, 66, 2.4, shadeHex(col, 0.04), null, sd);
    B.box('std', 0, 56, W / 2 + 2.6, 4, 60, 1, trim, null, RUST);
  }
  for (const s of [-1, 1]) B.block('std', s * (L / 2 - 5.6), 20, 0, 3.2, top - 20, W - 3, shadeHex(col, -0.08), null, sd);
  if (!low) for (let x = -L / 2 + 16; x < L / 2 - 8; x += 20) {
    if (Math.abs(x) < dw / 2 + 4) continue;
    for (const s of [-1, 1]) B.box('std', x, (20 + top) / 2, s * (W / 2 + 0.2), 2, top - 20, 1, trim, null, RUST);
  }
  B.box('std', 0, top + 2, 0, L - 2, 4, W - 2, shadeHex(col, -0.12), null, S(DET.metalroof, 0.6, 0.4));
  if (!low) B.box('std', 0, top + 5, 0, L - 20, 1.4, 8, '#3a3a3a', null, RUST);
  endGear(B, L, top, low);
  pic(B, 'wagon', -L * 0.1, 70, W / 2 + 0.3, 20, 0, { w: 110 });
  pic(B, 'wagon', L * 0.1, 70, -W / 2 - 0.3, 20, Math.PI, { w: 110 });
  if (!low && hash01(o.id * 3) < 0.5) pic(B, hash01(o.id) < 0.5 ? 'd_graf3' : 'd_graf4', L * 0.26, 48, W / 2 + 0.4, 24, 0);
  pic(B, 'd_rust', -L * 0.3, 60, W / 2 + 0.35, 50, 0, { w: 30 });
}

function tankcar(B, L, W, col, low) {
  underframe(B, L, W, low);
  const R = 30, cy = 52;
  B.cylX('std', 0, cy, 0, R, L - 20, col, low ? 12 : 24, S(DET.panel, 0.5, 0.4));
  for (const s of [-1, 1]) B.add('std', T.sphere(low ? 10 : 18, low ? 6 : 10), [s * (L / 2 - 10), cy, 0], [8, R, R], null, col, S(DET.panel, 0.5, 0.4));
  if (!low) for (const x of [-L * 0.3, 0, L * 0.3]) B.cylX('std', x, cy, 0, R + 0.8, 3, shadeHex(col, -0.25), 24, RUST);
  // the dome, the walkway around it, a ladder
  B.cyl('std', 0, cy + R - 4, 0, 10, 12, shadeHex(col, -0.1), 12, 1, null, PAINTED);
  B.box('std', 0, cy + R + 2, 0, 44, 2, 36, '#3a3a3a', null, RUST);
  railing(B, -22, -18, 22, -18, cy + R + 3, 16, '#3a3a3a', { step: 22, mid: false });
  railing(B, -22, 18, 22, 18, cy + R + 3, 16, '#3a3a3a', { step: 22, mid: false });
  B.add('decal', T.plane(), [0, cy + 6, R + 0.4], [16, 16, 1], null, '#ffffff', { uv: atlasUV('hazmat'), noAO: true, noJitter: true });
  pic(B, 'wagon', -L * 0.22, cy - 8, R * 0.72 + 0.4, 12, 0, { w: 80, rx: -0.3 });
  pic(B, 'd_rust', L * 0.2, cy - 4, R * 0.9, 30, 0, { w: 20, rx: -0.4 });
  endGear(B, L, cy, low);
}

function hopper(B, L, W, col, low) {
  underframe(B, L, W, low);
  const top = 92;
  const prof = [[-L / 2 + 6, top], [-L / 2 + 6, 44], [-L * 0.3, 24], [-L * 0.1, 44], [L * 0.1, 44], [L * 0.3, 24], [L / 2 - 6, 44], [L / 2 - 6, top]];
  B.prism('std', 'c3hop' + L, prof, 0, W - 4, col, { surf: [DET.panel, 0.6, 0.35] });
  if (!low) for (let x = -L / 2 + 16; x < L / 2 - 8; x += 18) for (const s of [-1, 1]) B.box('std', x, 68, s * (W / 2 - 1.2), 2.4, 46, 1.4, shadeHex(col, -0.25), null, RUST);
  B.box('std', 0, top - 3, 0, L - 12, 3, W - 12, '#1a1814', null, S(DET.char, 0.95, 0));
  if (!low) for (let k = 0; k < 10; k++) B.add('std', T.dodeca(), [-L / 2 + 20 + k * (L - 40) / 9, top - 2, (hash01(k) - 0.5) * 30], [9, 5, 9], [k, k * 2, 0], '#161412', S(DET.char, 0.95, 0));
  for (const x of [-L * 0.3, L * 0.3]) B.box('std', x, 20, 0, 22, 8, 22, '#2a2a2c', null, RUST);
  pic(B, 'wagon', 0, 78, W / 2 - 1.5, 14, 0, { w: 90 });
  endGear(B, L, top, low);
}

function gondola(B, L, W, col, low) {
  underframe(B, L, W, low);
  const top = 56;
  for (const s of [-1, 1]) {
    B.block('std', 0, 20, s * (W / 2 - 1.5), L - 8, top - 20, 3, col, null, { surf: [DET.panel, 0.6, 0.35] });
    B.block('std', s * (L / 2 - 5.5), 20, 0, 3, top - 20, W - 3, col, null, { surf: [DET.panel, 0.6, 0.35] });
  }
  if (!low) for (let x = -L / 2 + 14; x < L / 2 - 8; x += 22) for (const s of [-1, 1]) B.box('std', x, 38, s * (W / 2 + 0.4), 2.4, 36, 1.2, shadeHex(col, -0.25), null, RUST);
  // scrap: twisted girders, a car door, drums
  B.box('std', 0, 24, 0, L - 16, 8, W - 12, '#3a2e26', null, RUST);
  if (!low) {
    for (let k = 0; k < 6; k++) B.add('std', T.box(), [-L / 2 + 30 + k * 34, 36, (hash01(k * 3) - 0.5) * 30], [60, 6, 8], [hash01(k) - 0.5, hash01(k * 5) * 3, 0.3], '#5a4a3a', RUST);
    B.cyl('std', 60, 28, 10, 10, 26, '#3b5f8a', 12, 1, [0.4, 0, 1.2], RUST);
  }
  pic(B, 'wagon', 0, 42, W / 2 + 0.3, 12, 0, { w: 90 });
  endGear(B, L, top, low);
}

function flatcar(B, o, L, W, col, low) {
  underframe(B, L, W, low);
  B.box('std', 0, 23, 0, L - 4, 5, W, '#4a3a2c', null, WOOD);
  for (const s of [-1, 1]) for (let x = -L / 2 + 20; x < L / 2; x += 40) B.box('std', x, 30, s * (W / 2 - 1), 3, 10, 3, '#2a2a2c', null, RUST);
  if (o.label === 'crane') {
    // a small rail crane: the turntable, the cab, a lattice jib resting on a support
    B.cyl('std', -40, 26, 0, 24, 6, '#3a3a3c', 16, 1, null, STEEL);
    B.rblock('std', -40, 32, 0, 50, 40, 36, 2, '#c89818', null, PAINTED);
    B.box('vglass', -14.5, 58, 0, 1, 14, 24, '#1a2a30');
    for (const z of [-8, 8]) {
      rod(B, 'std', [-20, 60, z], [100, 44, z * 0.5], 1.6, '#c89818', PAINTED, 5);
      rod(B, 'std', [-20, 42, z], [100, 40, z * 0.5], 1.6, '#c89818', PAINTED, 5);
    }
    for (let k = 0; k < 6; k++) rod(B, 'std', [-10 + k * 18, 58 - k * 2.4, 0], [-1 + k * 18, 41, 0], 0.8, '#c89818', PAINTED, 4);
    B.box('std', 100, 26, 0, 8, 16, 20, '#3a3a3c', null, STEEL);
    rod(B, 'std', [100, 44, 0], [100, 28, 0], 0.4, '#1a1a1a', STEEL, 3);
  } else if (!low) {
    // a load of pipes chained down
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4 - r; k++) B.cylX('std', 0, 34 + r * 11, -18 + k * 12 + r * 6, 5.5, L - 30, '#6a6e70', 10, RUST);
    for (const x of [-60, 0, 60]) B.box('std', x, 42, 0, 1, 22, W - 4, '#8a8a2a', null, STEEL);
  }
}

function caboose(B, P, o, L, W, col, low) {
  bogie(B, -L * 0.3, 7.6, low);
  bogie(B, L * 0.3, 7.6, low);
  B.box('std', 0, 18, 0, L - 6, 5, W - 8, '#26272a', null, RUST);
  const body = L - 40;
  B.rblock('std', 0, 22, 0, body, 60, W - 6, 2, col, null, { surf: [DET.siding, 0.8, 0.1] });
  B.rblock('std', 0, 82, 0, body + 6, 4, W - 2, 2, '#2a2a2c', null, S(DET.metalroof, 0.6, 0.4));
  // the cupola, windows, end platforms with railings
  B.rblock('std', 0, 86, 0, 44, 26, W - 16, 2, col, null, { surf: [DET.siding, 0.8, 0.1] });
  B.box('std', 0, 114, 0, 50, 3, W - 10, '#2a2a2c', null, STEEL);
  for (const s of [-1, 1]) {
    for (const x of [-body * 0.3, body * 0.3]) B.box('glass', x, 58, s * (W / 2 - 2.8), 16, 14, 0.6, '#141a1e');
    B.box('glass', 0, 98, s * (W / 2 - 7.8), 30, 10, 0.6, '#141a1e');
    B.box('std', s * (body / 2 + 10), 21, 0, 18, 2, W - 4, '#3a3a3a', null, RUST);
    railing(B, s * (L / 2 - 2), -W / 2 + 4, s * (L / 2 - 2), W / 2 - 4, 22, 24, '#d8d0b0', { step: 14 });
  }
  if (!low) pic(B, 'd_graf1', -10, 50, W / 2 - 2.8, 14, 0, { w: 80 });
  void P; void o;
}

/** A diesel road locomotive: long hood, cab, short hood, six-wheel trucks, tanks, rails, lights, livery. */
function diesel(B, P, o, L, W, col, low) {
  const { halos } = P;
  const live = o.label === 'live', dead = o.label === 'dead';
  const R = 8.4;
  for (const tx of [-L * 0.33, L * 0.33]) {
    for (const s of [-1, 1]) {
      B.box('std', tx, R + 5, s * 15, 76, 9, 4, '#1e1f22', null, RUST);
      for (const dx of [-24, 0, 24]) B.cylZ('std', tx + dx, R, s * 12.6, R, 3, '#2a2b2e', low ? 8 : 14, RUST);
      if (!low) for (const dx of [-12, 12]) B.add('std', T.cyl(6), [tx + dx, R + 4, s * 16.2], [3.2, 9, 3.2], null, '#3a2e26', RUST);
    }
    B.box('std', tx, R + 8, 0, 70, 6, 30, '#1e1f22', null, RUST);
  }
  // frame, walkways, the fuel tank, the pilots
  B.box('std', 0, 22, 0, L - 4, 6, W, '#2a2a2c', null, RUST);
  B.box('std', 0, 26, 0, L, 1.4, W + 6, '#3a3a3a', null, S(DET.panel, 0.6, 0.6));
  B.rblock('std', 0, 10, 0, L * 0.34, 12, W - 20, 3, '#2a2a2c', null, RUST);
  for (const s of [-1, 1]) {
    B.box('std', s * (L / 2 - 2), 14, 0, 6, 14, W, '#d8a21c', null, PAINTED);
    B.add('decal', T.plane(), [s * (L / 2 + 1.2), 14, 0], [W - 4, 12, 1], [0, s * HALF, 0], '#ffffff', { uv: atlasUV('stripeYB'), noAO: true, noJitter: true });
  }
  // the long hood (engine), cab and short hood
  const cabX = -L / 2 + 70, hoodW = W - 22;
  const hood0 = cabX + 22, hood1 = L / 2 - 12;
  B.rblock('std', (hood0 + hood1) / 2, 27, 0, hood1 - hood0, 58, hoodW, 3, col, null, S(DET.panel, 0.5, 0.35));
  B.rblock('std', cabX, 27, 0, 44, 76, W - 6, 3, col, null, S(DET.panel, 0.5, 0.35));
  B.rblock('std', cabX, 103, 0, 48, 3, W - 2, 1.5, shadeHex(col, -0.3), null, PAINTED);
  B.rblock('std', -L / 2 + 30, 27, 0, 36, 46, hoodW, 3, col, null, S(DET.panel, 0.5, 0.35));
  // the livery: a yellow stripe along the hood, the number boards, the lettering
  for (const s of [-1, 1]) {
    B.box('std', (hood0 + hood1) / 2, 44, s * (hoodW / 2 + 0.3), hood1 - hood0, 5, 0.6, '#e0b020', null, PAINTED);
    B.box('std', cabX, 44, s * ((W - 6) / 2 + 0.3), 44, 5, 0.6, '#e0b020', null, PAINTED);
    pic(B, 'loco', cabX, 64, s * ((W - 6) / 2 + 0.4), 12, s > 0 ? 0 : Math.PI);
    pic(B, 'd_rust', hood0 + 40, 50, s * (hoodW / 2 + 0.4), 30, s > 0 ? 0 : Math.PI, { w: 26 });
    // cab windows, side louvres, handrails
    B.box('glass', cabX + 6, 84, s * ((W - 6) / 2 + 0.2), 26, 16, 0.6, '#141a1e');
    if (!low) {
      for (let x = hood0 + 30; x < hood1 - 30; x += 60) for (let k = 0; k < 4; k++) B.box('std', x, 38 + k * 6, s * (hoodW / 2 + 0.3), 26, 2, 1, shadeHex(col, -0.3), null, STEEL);
      rod(B, 'std', [-L / 2 + 10, 50, s * (W / 2 + 1)], [L / 2 - 10, 50, s * (W / 2 + 1)], 0.8, '#e8e0c0', PAINTED, 4);
      for (let x = -L / 2 + 14; x < L / 2; x += 40) rod(B, 'std', [x, 27, s * (W / 2 + 1)], [x, 50, s * (W / 2 + 1)], 0.6, '#e8e0c0', PAINTED, 4);
    }
  }
  for (const s of [-1, 1]) B.box('glass', cabX + s * 22.4, 84, 0, 0.6, 18, W - 20, '#141a1e');
  // radiator fans, exhaust stacks, horns
  if (!low) for (const x of [hood1 - 40, hood1 - 90]) { B.cyl('std', x, 85, 0, 14, 2, '#2a2a2c', 16, 1, null, STEEL); B.cyl('std', x, 86, 0, 12, 1, '#1a1a1a', 16, 1, null, STEEL); }
  B.rblock('std', hood0 + 60, 85, 0, 18, 8, 10, 2, '#1a1a1a', null, S(DET.char, 0.9, 0.2));
  B.cyl('std', cabX + 10, 106, 8, 1.6, 8, '#8a8e92', 6, 1, null, STEEL);
  // headlights and ditch lights at both ends (lit on the live one)
  for (const s of [-1, 1]) {
    const x = s > 0 ? L / 2 - 11.5 : -L / 2 + 11;
    const y = s > 0 ? 76 : 64;
    const [wx, wy] = toWorld(o, x + s * 2, 0);
    if (live) lampGlow(B, halos, x + s * 1.2, y, 0, wx, wy, '#fff4d8', { size: [1, 5, 10], k: 5, halo: 110, strength: 0.8, y0: 0 });
    else B.box('glass', x + s * 1.2, y, 0, 1, 5, 10, '#2a3036');
    for (const z of [-18, 18]) B.box(live ? 'glow' : 'glass', x + s * 2, 30, z, 1, 4, 4, live ? '#fff0c8' : '#2a3036', null, live ? { emissive: 4, uv: atlasUV('white'), noAO: true } : null);
  }
  if (dead) {
    // panels off, a traction motor on the floor beside it, chain hoist hanging
    B.add('std', T.box(), [hood0 + 100, 30, W / 2 + 22], [60, 3, 40], [0, 0.2, 0.1], col, S(DET.panel, 0.5, 0.35));
    B.box('std', hood0 + 100, 60, hoodW / 2 - 0.5, 60, 30, 1, '#1a1a1c', null, STEEL);
    B.cylX('std', hood0 + 40, 12, W / 2 + 40, 12, 30, '#3a3a3c', 12, RUST);
  }
  if (live) P.dyn && P.dyn.push({ t: 'exhaust', x: o.x + Math.cos(o.a || 0) * (hood0 + 60), y: o.y + Math.sin(o.a || 0) * (hood0 + 60), h: 95 });
}

// ---- yard furniture ----------------------------------------------------------------------------------

/** The yard's water tower (a mark): steel legs, a riveted tank, a spout arm swung over the track. */
export function waterTower(P, m) {
  const { B, gy, halos } = P;
  at(B, gy, m.x, m.y, 0, m.a, 900);
  const top = 220;
  for (const [x, z] of [[-40, -40], [40, -40], [40, 40], [-40, 40]]) {
    rod(B, 'std', [x, 0, z], [x * 0.8, top, z * 0.8], 4, '#3e4246', RUST, 8);
    B.block('std', x, 0, z, 20, 6, 20, COL.concD, null, CONC);
  }
  for (let k = 0; k < 3; k++) {
    const y0 = 16 + k * 66, y1 = y0 + 62;
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      rod(B, 'std', [ax * 40 * (1 - y0 / 1100), y0, az * 40 * (1 - y0 / 1100)], [bx * 40 * (1 - y1 / 1100), y1, bz * 40 * (1 - y1 / 1100)], 0.9, '#3e4246', RUST, 4);
      rod(B, 'std', [bx * 40 * (1 - y0 / 1100), y0, bz * 40 * (1 - y0 / 1100)], [ax * 40 * (1 - y1 / 1100), y1, az * 40 * (1 - y1 / 1100)], 0.9, '#3e4246', RUST, 4);
    }
  }
  B.cyl('std', 0, top, 0, 58, 90, '#5a6468', 28, 1, null, S(DET.panel, 0.55, 0.5));
  for (const y of [top + 20, top + 45, top + 70]) B.cyl('std', 0, y, 0, 59, 2, '#3e4648', 28, 1, null, RUST);
  B.add('std', T.cyl(28, 0.05), [0, top + 106, 0], [62, 32, 62], null, '#4a5458', S(DET.metalroof, 0.6, 0.4));
  B.add('std', T.sphere(24, 12), [0, top, 0], [58, 16, 58], [Math.PI, 0, 0], '#5a6468', S(DET.panel, 0.55, 0.5));
  pic(B, 'yardname', 0, top + 45, 59.5, 20, 0, { w: 110 });
  pic(B, 'd_rust', 30, top + 40, 58, 60, 0.5, { w: 30 });
  // the spout arm and its counterweight
  rod(B, 'std', [0, top + 10, -58], [0, top - 60, -150], 5, '#3e4246', RUST, 8);
  rod(B, 'std', [0, top + 10, -58], [0, top + 30, -40], 1, '#1a1a1a', STEEL, 4);
  B.cyl('std', 0, top - 70, -150, 7, 12, '#3e4246', 10, 1, null, RUST);
  // a ladder and the catwalk ring
  for (const s of [-5, 5]) rod(B, 'std', [s, 0, 52], [s, top, 58], 0.8, '#3e4246', RUST, 4);
  for (let y = 10; y < top; y += 11) rod(B, 'std', [-5, y, 52 + y * 0.027], [5, y, 52 + y * 0.027], 0.6, '#3e4246', RUST, 4);
  B.add('std', T.torus(28, 0.02, 4), [0, top + 8, 0], [70, 70, 70], [HALF, 0, 0], '#3e4246', RUST);
  lampGlow(B, halos, 0, top + 124, 0, m.x, m.y, '#ff3a2a', { size: [4, 4, 4], k: 6, halo: 90, strength: 0.7, blink: 1, y0: 0, shape: 'sphere' });
}

/** A floodlight mast (obstacle 'pillar' style 'mast'): a lattice tower with a lamp head at 360. */
export function mast(P, o) {
  const { B, halos } = P;
  const H = 350;
  for (const [x, z] of [[-9, -9], [9, -9], [9, 9], [-9, 9]]) rod(B, 'std', [x, 0, z], [x * 0.4, H, z * 0.4], 1.6, '#6a6e72', S(DET.panel, 0.45, 0.6), 5);
  for (let y = 20; y < H - 10; y += 34) {
    const k0 = 1 - (y / H) * 0.6, k1 = 1 - ((y + 34) / H) * 0.6;
    for (const [ax, az, bx, bz] of [[-9, -9, 9, -9], [9, -9, 9, 9], [9, 9, -9, 9], [-9, 9, -9, -9]]) rod(B, 'std', [ax * k0, y, az * k0], [bx * k1, y + 34, bz * k1], 0.6, '#6a6e72', STEEL, 3);
  }
  B.block('std', 0, 0, 0, 30, 8, 30, COL.concD, null, CONC);
  // the head: a frame of six lamps facing the yard
  B.box('std', 0, H, 0, 50, 4, 20, '#4a4e52', null, STEEL);
  for (let k = 0; k < 6; k++) {
    const x = -20 + (k % 3) * 20, z = k < 3 ? -6 : 6;
    B.rbox('std', x, H + 10, z, 14, 12, 8, 1.5, '#3a3c3e', [0.5, 0, 0], STEEL);
    lampGlow(B, k === 0 ? halos : null, x, H + 9, z + (z < 0 ? -4.4 : 4.4), o.x, o.y, '#ffc070', { size: [11, 9, 1], k: P.day ? 0.6 : 5, halo: 170, strength: 0.8, y0: 0, rot: [0.5, 0, 0] });
  }
  return true;
}

/** The main line's catenary (a mark): portal masts every 300 with cantilevers, the contact and messenger wires. */
export function catenary(P, m) {
  const { B, gy, tier } = P;
  const step = 300;
  const y0 = 2590, y1 = 2820;
  let prev = null;
  for (let x = m.x0 + 100, k = 0; x < m.x1; x += step, k++) {
    if (x > 6440 && x < 7780) { prev = null; continue; }   // (the bridge's trusses carry their own)
    at(B, gy, x, (y0 + y1) / 2, 0, 0, 1000 + k);
    for (const z of [y0 - (y0 + y1) / 2, y1 - (y0 + y1) / 2]) {
      B.box('std', 0, 90, z, 6, 180, 10, '#6a6e72', null, S(DET.panel, 0.45, 0.6));
      B.block('std', 0, 0, z, 18, 8, 22, COL.concD, null, CONC);
    }
    B.box('std', 0, 182, 0, 8, 10, y1 - y0 + 10, '#6a6e72', null, STEEL);
    for (const tz of [2650 - 2705, 2760 - 2705]) {
      rod(B, 'std', [0, 170, tz], [0, 150, tz], 0.6, '#2a2a2a', STEEL, 3);
      B.box('std', 0, 150, tz, 3, 3, 3, '#8a7a5a', null, STEEL);
    }
    if (prev !== null && tier !== 'low') {
      for (const tz of [2650, 2760]) {
        const a = [prev - x, 176, tz - 2705], b = [0, 176, tz - 2705];
        // messenger (sagging) and contact wire (level), with droppers
        const mid = [(a[0] + b[0]) / 2, 166, a[2]];
        rod(B, 'std', a, mid, 0.35, '#2a2622', STEEL, 3);
        rod(B, 'std', mid, b, 0.35, '#2a2622', STEEL, 3);
        rod(B, 'std', [a[0], 150, a[2]], [b[0], 150, b[2]], 0.3, '#6a5a3a', STEEL, 3);
      }
    }
    prev = x;
  }
}

/** A signal gantry over the throat (a mark): a lattice bridge on two legs with signal heads per track. */
export function gantry(P, m, halos) {
  const { B, gy } = P;
  at(B, gy, m.x, m.y, 0, m.a, 1100);
  const half = m.w / 2, H = 170;
  for (const s of [-1, 1]) {
    for (const dx of [-8, 8]) rod(B, 'std', [dx, 0, s * half], [dx * 0.6, H, s * half], 1.4, '#5a5e62', STEEL, 5);
    B.block('std', 0, 0, s * half, 24, 8, 24, COL.concD, null, CONC);
  }
  for (const y of [H, H + 16]) for (const dx of [-8, 8]) B.box('std', dx, y, 0, 2, 2, m.w, '#5a5e62', null, STEEL);
  for (let z = -half; z < half; z += 20) rod(B, 'std', [-8, H, z], [8, H + 16, z + 20], 0.6, '#5a5e62', STEEL, 3);
  B.box('std', 0, H + 18, 0, 20, 1.4, m.w, '#4a4e52', null, STEEL);
  // one signal head over each main track: a black target with red / yellow / green lamps (red lit)
  for (const tz of [2650 - m.y, 2760 - m.y]) {
    B.rblock('std', 0, H - 50, tz, 8, 44, 18, 2, '#1c1c1e', null, PAINTED);
    B.cyl('std', 0, H - 6, tz, 14, 2, '#1c1c1e', 16, 1, [0, 0, HALF], PAINTED);
    const [wx, wy] = toWorld(m, -5, tz);
    lampGlow(B, halos, -4.4, H - 18, tz, wx, wy, '#ff3020', { size: [1, 6, 6], k: 5, halo: 50, strength: 0.6, y0: 0 });
    B.box('glass', -4.4, H - 32, tz, 1, 6, 6, '#3a3a1a');
    B.box('glass', -4.4, H - 46, tz, 1, 6, 6, '#1a3a22');
  }
}
