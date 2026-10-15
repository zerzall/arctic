// Blackwater Depot models (world-hideout.js registry): the bunk boxcars, the dead locomotive,
// the mess tent, the water tower, the forge, the departures board, the rails and their
// sleepers, tyre stacks and a pile of ties.

import {
  T, S, WOOD, RUSTY, CANVAS, METAL, CORR, C, DET, shadeHex, mixHex, hash01, atlasUV,
  post, crate, barrel, jerrycan, mug, stump, sandbagRun, bulb, lantern, pic, pic2, rod, ridgeTent, cot, neonWord, hubUV,
} from './world-hideout-kit.js';

const HALF = Math.PI / 2;

function toWorld(o, lx, lz) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
}

/** A pair of railway trucks (bogies): frame, four wheels with rims and axle boxes. */
function truck(B, x, z, wheelR = 7.6) {
  for (const s of [-1, 1]) {
    B.box('std', x, wheelR + 4, z + s * 15, 44, 5, 3.4, '#1e1f22', null, RUSTY);
    for (const dx of [-13, 13]) {
      B.cyl('std', x + dx, wheelR, z + s * 12.6, wheelR, 3.4, '#2a2b2e', 14, 1, [HALF, 0, 0], RUSTY);
      B.cyl('std', x + dx, wheelR, z + s * 12.6, wheelR * 0.5, 4, '#5a5048', 10, 1, [HALF, 0, 0], RUSTY);
    }
    B.box('std', x, wheelR + 1, z + s * 15, 10, 8, 4, '#3a3028', null, RUSTY);
  }
  for (const dx of [-13, 13]) B.cyl('std', x + dx, wheelR, z, 1.4, 32, '#1a1a1c', 6, 1, [HALF, 0, 0]);
  B.box('std', x, wheelR + 5.4, z, 14, 4, 34, '#1e1f22', null, RUSTY);
}

/** A bunk boxcar (obstacle 'bus' 250 × 62, ~100 high). The sliding door is open on the -z face (toward the yard). */
function boxcar(P) {
  const { B, o, L, W, halos, dyn } = P;
  const v = o.variant | 0;
  const paint = o.color || '#7a3a2a';
  const trim = shadeHex(paint, -0.3);
  const floorY = 16, wallTop = 90;
  const plank = { surf: [DET.siding, 0.88, 0], noJitter: true };
  // running gear
  truck(B, -L * 0.34, 0);
  truck(B, L * 0.34, 0);
  B.box('std', 0, 13, 0, L - 8, 4, W - 8, '#2a2620', null, RUSTY);
  for (const s of [-1, 1]) {
    B.box('std', s * (L / 2 - 1), 11, 0, 5, 6, 16, '#3a3630', null, RUSTY);
    rod(B, 'std', [s * (L / 2 - 1), 12, -10], [s * (L / 2 + 4), 12, -10], 1.6, '#1a1a1c', RUSTY, 6);
    rod(B, 'std', [s * (L / 2 - 1), 12, 10], [s * (L / 2 + 4), 12, 10], 1.6, '#1a1a1c', RUSTY, 6);
  }
  // the body: floor, roof, end walls, the south (+z) wall closed, the north (-z) wall with a door opening
  B.rblock('std', 0, floorY - 2, 0, L - 6, 3, W - 6, 0.5, '#5a4a38', null, WOOD);
  const dw = 78, dc = (v === 1 ? -30 : v === 2 ? 10 : 0);
  const d0 = dc - dw / 2, d1 = dc + dw / 2;
  B.block('std', 0, floorY, W / 2 - 1.6, L - 10, wallTop - floorY, 3.2, paint, null, plank);
  for (const [x0, x1] of [[-L / 2 + 5, d0], [d1, L / 2 - 5]]) B.block('std', (x0 + x1) / 2, floorY, -W / 2 + 1.6, x1 - x0, wallTop - floorY, 3.2, paint, null, plank);
  B.block('std', dc, floorY + 64, -W / 2 + 1.6, dw, wallTop - floorY - 64, 3.2, paint, null, plank);
  for (const s of [-1, 1]) B.block('std', s * (L / 2 - 6.4), floorY, 0, 3.2, wallTop - floorY, W - 3, shadeHex(paint, -0.08), null, plank);
  // vertical ribs and a bottom sill
  for (let x = -L / 2 + 14; x < L / 2 - 8; x += 22) {
    B.box('std', x, (floorY + wallTop) / 2, W / 2 + 0.2, 2.4, wallTop - floorY, 1, trim, null, plank);
    if (x < d0 - 4 || x > d1 + 4) B.box('std', x, (floorY + wallTop) / 2, -W / 2 - 0.2, 2.4, wallTop - floorY, 1, trim, null, plank);
  }
  B.box('std', 0, floorY + 1, W / 2 + 0.4, L - 8, 2.4, 1, trim, null, plank);
  // the arched roof: two shallow slabs and a ridge, catwalk boards
  for (const s of [-1, 1]) B.add('std', T.box(), [0, wallTop + 4.6, s * W * 0.25], [L - 2, 1.6, W * 0.52], [s * -0.14, 0, 0], '#5a5a58', S(DET.metalroof, 0.6, 0.5));
  B.box('std', 0, wallTop + 8.6, 0, L - 6, 1.6, 8, '#7a5a38', null, WOOD);
  // the open sliding door: pushed back against the wall on the outside, its bar and rollers
  B.block('std', d1 + dw * 0.46, floorY + 1, -W / 2 - 3.2, dw * 0.92, 58, 2.6, shadeHex(paint, 0.05), null, plank);
  B.box('std', 0, floorY + 66, -W / 2 - 3.6, L - 20, 2.2, 2.4, '#2a2a2c', null, RUSTY);
  B.box('std', d1 + dw * 0.46, floorY + 30, -W / 2 - 4.9, dw * 0.86, 3, 0.8, trim, [0, 0, 0.5], plank);
  // the interior: a dark shell, the lit back wall, bunks, a lantern
  B.box('std', dc, floorY + 32, W / 2 - 4, dw + 20, 62, 1, '#221a14', null, WOOD);
  B.add('glow', T.plane(), [dc, floorY + 32, W / 2 - 4.8], [dw, 56, 1], [0, Math.PI, 0], '#ff9a48', { emissive: 0.42, uv: atlasUV('white'), noAO: true });
  if (v !== 2) {
    cot(B, dc - 26, 12, 0, ['#7a3a3a', '#3a5a7a', '#c98a2e', '#5a7a4a'][v % 4], { L: 38, W: 16, y0: floorY });
    cot(B, dc - 26, 12, 0, ['#c98a2e', '#5a7a4a', '#7a3a3a'][v % 3], { L: 38, W: 16, y0: floorY + 28 });
    for (const sx of [-1, 1]) post(B, dc - 26 + sx * 19, floorY, 4, 1.1, 40, C.woodD, WOOD, 4);
    B.box('std', dc + 14, floorY + 20, W / 2 - 8, 34, 2, 14, '#6a4a2c', null, WOOD);
    B.add('std', T.pillow(8, 5, 0.5), [dc + 14, floorY + 24, W / 2 - 8], [15, 2.4, 6], null, ['#3a5a7a', '#a63d3d'][v % 2], CANVAS);
    B.box('std', dc + 14, floorY + 44, W / 2 - 8, 34, 2, 14, '#6a4a2c', null, WOOD);
    B.add('std', T.pillow(8, 5, 0.5), [dc + 14, floorY + 48, W / 2 - 8], [15, 2.4, 6], null, ['#c98a2e', '#5a7a4a'][v % 2], CANVAS);
  } else {
    // the galley: a table, a stove with a pot, shelves of tins
    B.rblock('std', dc, floorY + 14, 6, 40, 3, 16, 0.4, '#7a5a38', null, WOOD);
    for (const x of [-16, 16]) post(B, dc + x, floorY, 6, 1.4, 14, C.woodD, WOOD, 4);
    B.rblock('std', dc + 26, floorY, 16, 16, 20, 14, 0.8, '#2a2a2e', null, METAL);
    B.cyl('std', dc + 26, floorY + 20, 16, 4.6, 6, '#8a8e92', 10, 1, null, METAL);
    B.box('std', dc - 30, floorY + 30, W / 2 - 6, 18, 2, 8, C.woodD, null, WOOD);
    for (let i = 0; i < 4; i++) B.cyl('std', dc - 36 + i * 4.6, floorY + 32, W / 2 - 6, 1.7, 4.4, ['#c8b078', '#b8c8a8', '#c85a3a', '#a8a8b8'][i], 8, 1, null, METAL);
  }
  const [lx, lz] = toWorld(o, dc, -W / 2 + 6);
  bulb(B, halos, lx, lz, floorY + 52, '#ffc27a', { lx: dc, lz: -W / 2 + 6, r: 2.2, k: 3.6, halo: 90, strength: 0.6 });
  // steps and a plank porch at the door
  B.rblock('std', dc, 8, -W / 2 - 14, dw + 12, 3, 22, 0.4, '#7a5a38', null, WOOD);
  for (let i = 0; i < 2; i++) B.rblock('std', dc, 4 - i * 2, -W / 2 - 26 - i * 6, 40, 4, 8, 0.4, '#8a6a44', null, WOOD);
  for (const s of [-1, 1]) post(B, dc + s * (dw / 2 + 4), 0, -W / 2 - 22, 1.4, 22, C.woodD, WOOD, 5);
  rod(B, 'std', [dc - dw / 2 - 4, 22, -W / 2 - 22], [dc + dw / 2 + 4, 22, -W / 2 - 22], 0.8, C.woodD, WOOD, 4);
  // end ladders, a brake wheel, the number board
  for (const s of [-1, 1]) {
    for (const z of [-9, 9]) rod(B, 'std', [s * (L / 2 + 1), floorY, z], [s * (L / 2 + 1), wallTop + 6, z], 0.8, '#1a1a1c', RUSTY, 4);
    for (let y = floorY + 6; y < wallTop; y += 10) rod(B, 'std', [s * (L / 2 + 1), y, -9], [s * (L / 2 + 1), y, 9], 0.7, '#1a1a1c', RUSTY, 4);
  }
  rod(B, 'std', [L / 2 + 2, wallTop + 8, 0], [L / 2 + 2, wallTop + 20, 0], 1, '#1a1a1c', RUSTY, 5);
  B.add('std', T.torus(12, 0.14, 4), [L / 2 + 2, wallTop + 20, 0], [8, 8, 8], [0, HALF, 0], '#1a1a1c', RUSTY);
  pic(B, v === 2 ? 'p_mess' : 'p_bunks', -L * 0.32, 66, W / 2 + 0.6, 40, 12.5, 0);
  pic(B, 'p_depot', L * 0.26, 62, W / 2 + 0.6, 66, 16.5, 0);
  // variant details: a stove pipe (1, 2) with smoke, a clothes line outside (1), hanging wash
  if (v !== 0) {
    const px = v === 1 ? d1 + 40 : d1 + 30;
    rod(B, 'std', [px, wallTop + 6, 8], [px, wallTop + 26, 8], 3.2, '#3a3a3e', RUSTY, 8);
    B.cyl('std', px, wallTop + 26, 8, 4.4, 2.4, '#3a3a3e', 8, 1.3, null, RUSTY);
    const [sx, sy] = toWorld(o, px, 8);
    dyn.smoke.push({ x: sx, y: sy, h: wallTop + 28, rate: 2.6, r: 3, warm: 1 });
  }
  if (v === 1) {
    const y = 66;
    rod(B, 'std', [d0 - 60, y, -W / 2 - 24], [d0 - 4, y, -W / 2 - 24], 0.3, '#2a2622', S(0, 0.8, 0.1), 3);
    for (let i = 0; i < 5; i++) B.add('std', T.box(), [d0 - 56 + i * 11, y - 8, -W / 2 - 24], [8, 14, 0.5], [0, 0, (i - 2) * 0.05], ['#c0392b', '#e8e2d0', '#2e86c1', '#e0a020', '#6a8a4a'][i], CANVAS);
  }
  // a lantern on a hook by the door, a boot scraper
  const [hx, hy] = toWorld(o, d1 + 12, -W / 2 - 5);
  lantern(B, halos, d1 + 12, 48, -W / 2 - 5, hx, hy, { h: 9, hang: 6, halo: 46, strength: 0.5 });
}

/** The dead locomotive: a steam engine shell and its tender, rusted, windows broken, grass on top. */
function locomotive(P) {
  const { B, it, L, halos } = P;
  const black = '#1e1e20', rust = '#5a3a28', green = '#2f4a3a';
  // frame and running gear (x runs from the tender at -L/2 to the cow-catcher at +L/2)
  B.box('std', 0, 16, 0, L - 20, 6, 40, '#26272a', null, RUSTY);
  const drivers = [-20, 20, 60, 100];
  for (const s of [-1, 1]) {
    for (const x of drivers) {
      B.cyl('std', x, 15.6, s * 22, 15.6, 5, '#26272a', 20, 1, [HALF, 0, 0], RUSTY);
      B.cyl('std', x, 15.6, s * 24.6, 5.4, 2, '#5a3a28', 10, 1, [HALF, 0, 0], RUSTY);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        rod(B, 'std', [x + Math.cos(a) * 3, 15.6 + Math.sin(a) * 3, s * 24.8], [x + Math.cos(a) * 13.6, 15.6 + Math.sin(a) * 13.6, s * 24.8], 0.9, '#26272a', RUSTY, 4);
      }
    }
    B.cyl('std', 140, 9.6, s * 22, 9.6, 5, '#26272a', 16, 1, [HALF, 0, 0], RUSTY);
    rod(B, 'std', [-20, 15.6, s * 27], [100, 15.6, s * 27], 1.6, '#4a4038', RUSTY, 6);
    for (const x of [-135, -118]) B.cyl('std', x, 9.6, s * 20, 9.6, 5, '#26272a', 16, 1, [HALF, 0, 0], RUSTY);
    B.cyl('std', 128, 22, s * 27, 3, 40, '#3a3630', 8, 1, [0, 0, HALF], RUSTY);
  }
  // the boiler with its bands, the smoke box, the stack and the domes
  B.cyl('std', 55, 46, 0, 24, 190, black, 22, 1, [0, 0, HALF], S(DET.rust, 0.7, 0.4));
  for (const x of [-20, 30, 80, 130]) B.cyl('std', x, 46, 0, 25, 6, '#3a3630', 22, 1, [0, 0, HALF], RUSTY);
  B.cyl('std', 158, 46, 0, 26, 18, '#2a2a2c', 22, 1, [0, 0, HALF], RUSTY);
  B.cyl('std', 150, 66, 0, 6.4, 34, '#1e1e20', 12, 1.7, null, RUSTY);
  B.cyl('std', 150, 98, 0, 10.6, 4, '#2a2a2c', 12, 1, null, RUSTY);
  B.add('std', T.sphere(12, 8), [30, 72, 0], [11, 8, 11], null, '#8a6a30', S(DET.panel, 0.4, 0.7));
  B.add('std', T.sphere(10, 6), [90, 70, 0], [7, 5, 7], null, '#3a3630', RUSTY);
  // cow-catcher and the buffer beam
  for (let i = -3; i <= 3; i++) rod(B, 'std', [L / 2 - 6, 14, i * 5], [L / 2 + 16, 5, i * 12], 1, '#3a3630', RUSTY, 4);
  B.box('std', L / 2 - 2, 15, 0, 5, 5, 44, '#3a3630', null, RUSTY);
  // the headlamp and a number plate
  B.cyl('std', 166, 54, 0, 8, 6, '#2a2a2c', 12, 1, [0, 0, HALF], RUSTY);
  B.cyl('std', 169.4, 54, 0, 6, 1, '#8a8a80', 12, 1, [0, 0, HALF], METAL);
  B.box('std', 168, 34, 0, 1, 10, 16, '#c9a02a', null, METAL);
  // the cab: walls, roof, dark broken windows; the tender behind it with a heap of coal
  const cabX = -72;
  B.block('std', cabX, 16, 0, 64, 68, 40, green, null, S(DET.panel, 0.7, 0.3));
  B.block('std', cabX, 84, 0, 74, 5, 46, '#2a2a2c', null, RUSTY);
  for (const s of [-1, 1]) {
    B.box('std', cabX + 6, 60, s * 20.4, 26, 22, 1, '#0c0e10', null, S(DET.glass, 0.1, 0.5));
    B.box('std', cabX + 6, 60, s * 21.2, 30, 3, 1, black, null, RUSTY);
    B.box('std', cabX - 18, 46, s * 20.4, 10, 14, 1, '#0c0e10', null, S(DET.glass, 0.1, 0.5));
  }
  B.box('std', cabX + 32.4, 48, 0, 1, 36, 30, '#0c0e10', null, S(DET.glass, 0.1, 0.5));
  B.block('std', -135, 14, 0, 60, 34, 40, '#26272a', null, RUSTY);
  B.box('std', -135, 50, 0, 64, 4, 44, '#3a3630', null, RUSTY);
  for (let i = 0; i < 14; i++) B.add('std', T.dodeca(), [-152 + (i % 5) * 9, 56 + (i % 3) * 2, -12 + Math.floor(i / 5) * 12], [5, 4, 5], [i, i * 2, 0], '#111214', S(DET.char, 0.95, 0));
  // rust streaks down the boiler, grass and a vine on the roof
  for (let i = 0; i < 7; i++) B.box('std', -10 + i * 28, 44, 24.6, 3, 30 - (i % 3) * 8, 0.4, rust, null, RUSTY);
  for (let i = 0; i < 14; i++) B.add('std', T.blade(), [cabX - 24 + (i % 7) * 8, 89, -14 + Math.floor(i / 7) * 14], [3, 9 + (i % 3) * 2, 1], [0, i, 0.2], '#6a8a3a', S(DET.grass, 0.9, 0));
  pic(B, 'p_depot', cabX, 76, 20.9, 48, 12, 0);
  // a lantern in the cab window: somebody keeps watch up there at night
  const [lx, ly] = toWorld(it, cabX + 12, 6);
  lantern(B, halos, cabX + 12, 60, 6, lx, ly, { h: 9, hang: 6, halo: 56, strength: 0.6 });
}

/** The mess tent: a long ridge tent, its south side rolled up, tables, a stove and lamps. */
function messtent(P) {
  const { B, o, L, W, halos, dyn } = P;
  const wh = 44, rh = 88, half = W / 2;
  const col = o.color || '#6b6a44';
  const slope = Math.atan2(rh - wh, half);
  const slen = Math.hypot(half, rh - wh) + 1.4;
  // north roof pane down to a wall; south pane rolled up on a pole line
  B.add('std', T.box(), [0, (wh + rh) / 2, -half / 2], [L + 4, 1.0, slen], [-slope, 0, 0], col, CANVAS);
  B.add('std', T.box(), [0, (wh + rh) / 2 + 2, half / 2], [L + 4, 1.0, slen], [slope, 0, 0], shadeHex(col, 0.06), CANVAS);
  B.box('std', 0, wh / 2, -half, L, wh, 1, shadeHex(col, -0.08), null, CANVAS);
  B.box('std', 0, wh + 3, half + 1, L + 4, 6, 3, shadeHex(col, -0.18), null, CANVAS);     // rolled valance
  for (const s of [-1, 1]) {
    // gable ends, open in the middle (a doorway)
    B.add('std', T.profile('mess' + W, [[-half, wh], [half, wh], [0, rh]], 0, 1), [s * L / 2, 0, 0], [1, 1, 1], [0, HALF, 0], shadeHex(col, -0.14), CANVAS);
    for (const z of [-half, half]) post(B, s * (L / 2 - 2), 0, z, 1.8, wh + 4, C.woodD, WOOD, 5);
    post(B, s * (L / 2 - 2), 0, 0, 2.2, rh - 2, C.woodD, WOOD, 6);
  }
  post(B, 0, 0, half, 1.8, wh + 4, C.woodD, WOOD, 5);
  B.add('std', T.cyl(5), [0, rh, 0], [1, L + 6, 1], [0, 0, HALF], C.woodD, WOOD);
  // two long tables with benches, plates and mugs
  for (const z of [-24, 26]) {
    B.rblock('std', -10, 22, z, L * 0.6, 2.6, 18, 0.4, '#7a5a38', null, WOOD);
    for (const x of [-L * 0.28, L * 0.05, L * 0.26]) { post(B, x - 10, 0, z - 6, 1.3, 22, C.woodD, WOOD, 4); post(B, x - 10, 0, z + 6, 1.3, 22, C.woodD, WOOD, 4); }
    for (const s of [-1, 1]) B.rblock('std', -10, 12, z + s * 15, L * 0.58, 2, 8, 0.4, '#6a4a2c', null, WOOD);
    for (let i = 0; i < 6; i++) {
      B.cyl('std', -70 + i * 22, 24.6, z - 3, 3, 0.6, '#e8e2d0', 10, 1, null, S(DET.plastic, 0.4, 0));
      mug(B, -66 + i * 22, 24.6, z + 4, ['#c8b078', '#7a9ab0', '#b6543a'][i % 3]);
    }
  }
  // the stove at the far end with a pipe through the roof
  B.rblock('std', L / 2 - 26, 0, -26, 26, 24, 20, 1, '#2a2a2e', null, METAL);
  B.cyl('std', L / 2 - 26, 24, -26, 4.6, 8, '#8a8e92', 10, 1, null, METAL);
  rod(B, 'std', [L / 2 - 26, 30, -26], [L / 2 - 26, rh + 14, -26], 2.6, '#3a3a3e', RUSTY, 8);
  B.cyl('std', L / 2 - 26, rh + 14, -26, 4, 2.4, '#3a3a3e', 8, 1.3, null, RUSTY);
  const [sx, sy] = toWorld(o, L / 2 - 26, -26);
  dyn.smoke.push({ x: sx, y: sy, h: rh + 16, rate: 3, r: 3, warm: 1 });
  // hanging lamps in a row along the ridge, a sign at the door, a board of the day's soup
  for (let i = -2; i <= 2; i++) {
    const [bx, by] = toWorld(o, i * 44, 0);
    B.cyl('std', i * 44, rh - 10, 0, 0.5, 8, '#2a2622', 5, 1, null, S(0, 0.7, 0.2));
    bulb(B, halos, bx, by, rh - 12, i % 2 ? '#ffd9a0' : '#ffc27a', { lx: i * 44, lz: 0, r: 2.6, k: 3.6, halo: 70, strength: 0.55 });
  }
  pic2(B, 'p_mess', -L / 2 - 6, 60, half + 6, 46, 15, 0);
  pic(B, 'chalk', L / 2 - 50, 26, -half + 2, 30, 15, 0);
  crate(B, -L / 2 + 22, 0, -26, 16, 0.2);
  barrel(B, -L / 2 + 22, 0, -8, '#3b5f8a', 30, 10, true);
}

/** The departures board: a big chalk timetable on a wall-side frame, a station clock, a signal lantern. */
function departures(P) {
  const { B, it, halos } = P;
  const w = 118;
  for (const s of [-1, 1]) post(B, -1, 0, s * (w / 2 - 4), 2, 96, C.woodD);
  B.rblock('std', 0, 34, 0, 3, 56, w, 0.5, '#1f2a26', null, WOOD);
  B.box('std', 0.6, 91, 0, 3.4, 3, w + 4, C.woodD, null, WOOD);
  B.box('std', 0.6, 33, 0, 3.4, 3, w + 4, C.woodD, null, WOOD);
  pic(B, 'p_board', 2.4, 82, 0, 70, 20, HALF);
  pic(B, 'tally', 2.4, 58, -w * 0.28, 36, 45, HALF);
  pic(B, 'map', 2.4, 58, w * 0.16, 56, 42, HALF);
  // an old station clock above
  B.cyl('std', 1, 104, 0, 9, 3, '#3a3630', 16, 1, [0, 0, HALF], RUSTY);
  B.cyl('std', 2.6, 104, 0, 8, 0.6, '#f0ece0', 16, 1, [0, 0, HALF], S(DET.plastic, 0.4, 0));
  rod(B, 'std', [3, 104, 0], [3.2, 104, -4], 0.4, '#1c1c1e', METAL, 4);
  rod(B, 'std', [3, 104, 0], [3.2, 108, 1], 0.4, '#1c1c1e', METAL, 4);
  // a signal lantern on a bracket
  lantern(B, halos, 8, 100, w / 2 - 6, it.x + 8 * Math.cos(it.a) - (w / 2 - 6) * Math.sin(it.a), it.y + 8 * Math.sin(it.a) + (w / 2 - 6) * Math.cos(it.a), { h: 9, halo: 50, strength: 0.5, color: '#ff9a48' });
}

/** The water tower: legs, bracing, a stave tank with iron hoops, a conical roof, a catwalk and ladder, a spout and trough. */
function watertower(P) {
  const { B, it, halos } = P;
  const legTop = 200, tankH = 92;
  const legs = [[-44, -44], [44, -44], [44, 44], [-44, 44]];
  for (const [x, z] of legs) {
    rod(B, 'std', [x, 0, z], [x * 0.84, legTop, z * 0.84], 3.4, '#5a4a3a', S(DET.wood, 0.85, 0), 7);
    B.box('std', x, 2, z, 18, 4, 18, '#8a877e', null, S(DET.concrete, 0.9, 0));
  }
  for (let k = 0; k < 3; k++) {
    const y0 = 20 + k * 58, y1 = y0 + 54, r0 = 44 * (1 - (y0 / legTop) * 0.16), r1 = 44 * (1 - (y1 / legTop) * 0.16);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      rod(B, 'std', [ax * r0, y0, az * r0], [bx * r1, y1, bz * r1], 0.9, '#3a3630', RUSTY, 5);
      rod(B, 'std', [bx * r0, y0, bz * r0], [ax * r1, y1, az * r1], 0.9, '#3a3630', RUSTY, 5);
    }
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) rod(B, 'std', [ax * r0, y0, az * r0], [bx * r0, y0, bz * r0], 1.4, '#5a4a3a', WOOD, 5);
  }
  // the platform under the tank and the catwalk ring with a rail
  B.cyl('std', 0, legTop - 4, 0, 66, 4, '#4a3a2c', 20, 1, null, WOOD);
  for (let a = 0; a < 20; a++) {
    const t = (a / 20) * Math.PI * 2;
    post(B, Math.cos(t) * 64, legTop, Math.sin(t) * 64, 0.9, 22, '#3a3630', RUSTY, 4);
  }
  for (const y of [legTop + 10, legTop + 22]) B.add('std', T.torus(24, 0.012, 4), [0, y, 0], [64, 1, 64], [HALF, 0, 0], '#3a3630', RUSTY);
  // the tank: staves, hoops, a conical roof and a finial
  B.cyl('std', 0, legTop, 0, 56, tankH, '#8a6a44', 26, 1, null, S(DET.wood, 0.85, 0));
  for (const y of [legTop + 8, legTop + 34, legTop + 60, legTop + 84]) B.cyl('std', 0, y, 0, 57.4, 2.8, '#2a2620', 26, 1, null, RUSTY);
  B.add('std', T.cyl(26, 0.08), [0, legTop + tankH + 20, 0], [60, 40, 60], null, '#5a3a2a', S(DET.metalroof, 0.6, 0.4));
  B.cyl('std', 0, legTop + tankH + 40, 0, 1.2, 12, '#2a2620', 6, 1, null, RUSTY);
  B.add('std', T.sphere(6, 4), [0, legTop + tankH + 53, 0], [3, 3, 3], null, '#c9a02a', METAL);
  for (const k of [0, 1, 2, 3]) {
    const a = k * HALF + 0.4;
    B.add('hub', T.plane(), [Math.cos(a) * 57.2, legTop + 50, Math.sin(a) * 57.2], [64, 16, 1], [0, HALF - a, 0], '#ffffff', { uv: hubUV_('p_depot'), noAO: true, noJitter: true });
  }
  // a ladder up one leg and a cage
  for (const s of [-1, 1]) rod(B, 'std', [-6 + s * 5, 0, 52], [-4 + s * 5, legTop - 2, 46], 1, '#3a3630', RUSTY, 5);
  for (let y = 8; y < legTop - 4; y += 9) rod(B, 'std', [-11, y, 52 - (y / legTop) * 6], [-1, y, 52 - (y / legTop) * 6], 0.8, '#3a3630', RUSTY, 4);
  // the down-pipe, its valve wheel and the trough under the spout
  rod(B, 'std', [30, legTop - 4, 30], [30, 18, 30], 2, '#4a4e52', RUSTY, 8);
  B.cyl('std', 30, 30, 30, 3.2, 3, '#7a3a2a', 10, 1, [HALF, 0, 0], RUSTY);
  rod(B, 'std', [30, 18, 30], [44, 18, 40], 1.8, '#4a4e52', RUSTY, 8);
  B.rblock('std', 46, 0, 48, 50, 14, 18, 0.8, '#5a4a3a', null, S(DET.wood, 0.85, 0));
  B.box('std', 46, 12.4, 48, 44, 1, 12, '#3a5a72', null, S(DET.glass, 0.1, 0.4));
  // a lantern hung on the catwalk
  const lx = it.x + Math.cos(it.a) * 0 + 0, ly = it.y - 64;
  lantern(B, halos, 0, legTop + 12, -64, lx, ly, { h: 9, hang: 8, halo: 60, strength: 0.6 });
}

const hubUV_ = hubUV;

/** The forge: a brick hearth with a hood and chimney, glowing coals, bellows, a quench trough. */
function forge(P) {
  const { B, it, halos, dyn } = P;
  B.rblock('std', 0, 0, 0, 62, 34, 44, 1, '#7a4a3a', null, S(DET.brick, 0.9, 0));
  B.box('std', 0, 34, 0, 66, 3, 48, '#4a4038', null, S(DET.concrete, 0.9, 0));
  // the fire pot: glowing coal bed and a low flame of embers
  B.box('std', 6, 36.4, 0, 40, 1, 30, '#1c1a18', null, S(DET.char, 0.95, 0));
  B.box('glow', 6, 37, 0, 34, 0.8, 24, '#ff7a1c', null, { emissive: 3.2, uv: atlasUV('white'), noAO: true });
  for (let i = 0; i < 8; i++) B.add('glow', T.dodeca(), [-8 + (i % 4) * 9, 38, -6 + Math.floor(i / 4) * 12], [2.8, 2, 2.8], [i, i * 2, 0], '#ffb040', { emissive: 4, uv: atlasUV('white'), noAO: true });
  // the hood and chimney
  B.add('std', T.profile('forgehood', [[-24, 0], [24, 0], [10, 30], [-10, 30]], 0, 1), [-2, 60, 0], [1, 1, 30], [0, HALF, 0], '#3a3630', RUSTY);
  rod(B, 'std', [0, 90, -14], [0, 150, -14], 8, '#7a4a3a', S(DET.brick, 0.9, 0), 8);
  B.cyl('std', 0, 90, -14, 9.4, 3, '#4a4038', 8, 1, null, S(DET.concrete, 0.9, 0));
  // bellows, tongs, a hammer rack
  B.add('std', T.profile('bellows', [[0, 0], [16, 5], [16, 11], [0, 16]], 0.5, 12), [-14, 22, 26], [1, 1, 1], [0, HALF * 0.3, 0], '#5a3a2a', WOOD);
  rod(B, 'std', [-20, 24, 26], [-40, 24, 32], 1.2, '#3a3630', RUSTY, 5);
  for (let i = 0; i < 3; i++) rod(B, 'std', [30, 14 + i * 8, 20], [30, 26 + i * 8, 22], 0.8, '#4a4e52', METAL, 4);
  // the quench trough with a dull red-hot bar
  B.rblock('std', 46, 0, -8, 30, 12, 16, 0.6, '#3a3630', null, RUSTY);
  B.box('std', 46, 11.4, -8, 26, 1, 12, '#1a2a34', null, S(DET.glass, 0.1, 0.4));
  rod(B, 'std', [38, 14, -10], [58, 16, -4], 0.9, '#8a3a1a', METAL, 5);
  const wx = it.x, wy = it.y;
  halos.push({ x: wx + 6, y: wy, h: 40, color: '#ff8a2a', size: 150, strength: 0.75, flicker: 0.9 });
  dyn.smoke.push({ x: wx, y: wy - 14, h: 152, rate: 3.4, r: 4, warm: 1 });
  dyn.sparks.push({ x: wx + 6, y: wy, h: 44 });
}

/** A pair of rails on sleepers from (x1, y1) to (x2, y2) on the ballast. */
function rails(P) {
  const { B, it } = P;
  const { x1, y1, x2, y2 } = it;
  const len = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
  const seg = 220;
  const n = Math.ceil(len / seg);
  for (let i = 0; i < n; i++) {
    const t0 = i * seg, t1 = Math.min(len, t0 + seg), tm = (t0 + t1) / 2;
    B.obj(x1 + Math.cos(a) * tm, y1 + Math.sin(a) * tm, a, 40 + i);
    B.setJitter(0.05);
    const L = t1 - t0;
    for (const z of [-11.5, 11.5]) {
      B.box('std', 0, 6.2, z, L, 1.4, 4.4, '#6a6a6c', null, S(DET.rust, 0.4, 0.8));   // base
      B.box('std', 0, 8, z, L, 3.6, 1.7, '#8a8c90', null, S(DET.rust, 0.32, 0.85));   // web
      B.box('std', 0, 10.4, z, L, 1.4, 3.4, '#a4a6aa', null, S(DET.rust, 0.28, 0.9)); // head
    }
    for (let x = -L / 2 + 8; x < L / 2; x += 21) {
      B.rblock('std', x, 0, 0, 7.2, 5.4, 36, 0.5, mixHex('#3a2a20', '#5a4634', hash01(i * 31 + x)), [0, (hash01(x + i) - 0.5) * 0.05, 0], S(DET.wood, 0.9, 0));
    }
  }
}

/** A stack of tyres with a board across: a seat / table by the fire. */
function tirestack(P) {
  const { B } = P;
  for (let i = 0; i < 3; i++) {
    B.add('std', T.torus(14, 0.44, 6), [0, 5 + i * 9, 0], [13, 13, 13], [HALF, 0, 0], '#1b1b1c', S(DET.rubber, 0.9, 0));
  }
  B.rblock('std', 0, 28, 0, 34, 2.6, 22, 0.4, '#7a5a38', [0, 0.3, 0], WOOD);
  mug(B, 6, 30.6, 2, '#b6543a');
}

/** A pile of railway sleepers. */
function sleeperpile(P) {
  const { B } = P;
  for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - (row > 2 ? 1 : 0); i++) {
    B.rblock('std', 0, row * 6.4, (i - 1.5) * 8 + (row % 2) * 4, 62, 6, 8, 0.5, mixHex('#3a2a20', '#5a4634', hash01(row * 7 + i)), [0, (hash01(row + i * 3) - 0.5) * 0.06, 0], S(DET.wood, 0.9, 0));
  }
}

function nodraw() { /* a collider drawn by another prop */ }

export const DEPOT_MODELS = { boxcar, locomotive, messtent, departures, watertower, forge, rails, tirestack, sleeperpile, nodraw };
void neonWord; void stump; void sandbagRun; void jerrycan; void ridgeTent; void pic2; void CORR; void hash01; void mixHex;
