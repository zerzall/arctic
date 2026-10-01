// Mill Road, section 3 (Shady Acres): the single-wide trailers (lived-in, burned, crushed by a tree),
// the entrance arch, the office double-wide's porch and insides, the laundry, the playground, the
// mailboxes, the drained pool with its deck and pool house, Ozzy's radio shack with its mast, and the
// park's gates (the rolling gate from the gas station, the chain-link panel into the corn).

import {
  T, S, WOOD, RUSTY, METAL, CORR, CONC, FABRIC, PLAST, RUBBER, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, atlasUV, rod, plank, sign, sign2, decal, floorDecal, glowBox, carton, crate, drum, tyre, toWorld, litter, pendant, lvUV,
} from './millroad-kit.js';
import { roomId } from '../world-arch.js';

// ---- the trailers ----------------------------------------------------------------------------------------------

/** A window in a trailer's side (face at z, facing sign sd): frame, an interior-mapped room behind, curtains. */
function twin(B, x, y, z, sd, w, h, seed, state, lod) {
  const f = { noJitter: true, ...S(DET.panel, 0.5, 0.2) };
  B.box('std', x, y, z, w + 3, h + 3, 0.8, '#d8d4c8', null, f);
  const ry = sd > 0 ? 0 : PI;
  const zz = z + sd * 0.5;
  if (state === 'boarded') {
    B.box('std', x, y, zz + sd * 0.4, w + 4, h + 2, 0.8, '#8a7a5c', null, WOOD);
    return;
  }
  if (state === 'lit') B.add('room', T.plane(), [x, y, zz], [w, h, 1], [0, ry, 0], '#ffd9a0', { pane: { id: roomId(0, seed), w, h }, emissive: 1.1 });
  else B.add('glass', T.plane(), [x, y, zz], [w, h, 1], [0, ry, 0], state === 'broken' ? '#05070a' : '#101820', { pane: { id: roomId(state === 'broken' ? 4 : 0, seed), w, h } });
  if (lod >= 1) B.box('std', x, y, zz + sd * 0.2, 1, h, 0.6, '#d8d4c8', null, f);
}

/**
 * A single-wide mobile home ('building' obstacle: L long, W wide, the door side local +z). `burnt`:
 * a charred shell; `tree`: crushed by a fallen oak.
 */
function trailerModel(P, variant) {
  const { B, o, L, W, lod, day } = P;
  const r = B.rng;
  const seed = Math.round(o.x * 3 + o.y * 7);
  const burnt = variant === 'burnt', crushed = variant === 'tree';
  const col = burnt ? '#2a2624' : o.color || '#e8e2d2';
  const trim = burnt ? '#141210' : mixHex(col, ['#3a5a7a', '#7a3a2a', '#3a5a3a', '#6a5a3a'][Math.floor(hash01(seed) * 4)], 0.8);
  const y0 = 14, H = 70;
  const sid = { noJitter: true, surf: burnt ? [DET.char, 0.95, 0.1] : [DET.siding, 0.8, 0.1] };
  // skirting (vinyl lattice or sheet), a few panels kicked in
  B.box('std', 0, y0 / 2, 0, L - 2, y0, W - 4, burnt ? '#1a1816' : shadeHex(col, -0.25), null, { noJitter: true, surf: [DET.siding, 0.9, 0] });
  if (lod >= 1 && !burnt) for (let k = 0; k < 2; k++) B.box('std', r.range(-L / 3, L / 3), y0 / 2, (W / 2 - 1.4) * (k ? 1 : -1), 14, y0 - 2, 0.4, '#0c0c0c', null, NJ);
  // the body: siding, the stripe, the end caps
  B.rblock('std', 0, y0, 0, L, H - y0, W, 1.4, col, null, sid);
  if (!burnt) for (const sd of [-1, 1]) B.box('std', 0, y0 + 16, sd * (W / 2 + 0.2), L - 2, 5, 0.4, trim, null, S(DET.panel, 0.5, 0.2));
  // the roof: a low curved metal roof, the rim
  if (!crushed) {
    B.add('std', T.cyl(18, 1, false), [0, H - 2, 0], [5, L + 1, W / 2 + 1], [0, 0, HALF], burnt ? '#1a1816' : '#a8aca8', { surf: [burnt ? DET.char : DET.metalroof, 0.55, 0.5], map: 'cyl' });
  }
  B.box('std', 0, H - 0.6, 0, L + 1.6, 1.6, W + 1.6, burnt ? '#141210' : '#c8ccc8', null, METAL);
  // windows on both long sides and one end, the door on the +z side with its steps and a little porch
  const doorX = L * (hash01(seed + 3) < 0.5 ? -0.22 : 0.18);
  for (const sd of [-1, 1]) {
    for (const f of [-0.4, -0.12, 0.12, 0.38]) {
      const x = f * L;
      if (sd > 0 && Math.abs(x - doorX) < 24) continue;
      const k = hash01(seed + f * 100 + sd * 7);
      const st = burnt ? 'broken' : k < 0.12 ? 'boarded' : k < 0.3 ? 'broken' : !day && k > 0.88 ? 'lit' : 'dark';
      twin(B, x, 44, sd * (W / 2 + 0.2), sd, f === 0.12 || f === -0.12 ? 26 : 18, 18, seed + f * 10, st, lod);
      if (burnt && lod >= 1) decal(B, 'grime', x, 60, sd * (W / 2 + 0.9), 30, 30, sd > 0 ? 0 : PI, { color: '#000000' });
    }
  }
  // the door, steps, porch
  const dz = W / 2 + 0.3;
  B.box('std', doorX, y0 + 24, dz, 16, 46, 0.6, burnt ? '#0c0a08' : hash01(seed + 9) < 0.5 ? '#e8e4dc' : trim, null, S(DET.panel, 0.5, 0.2));
  if (!burnt) B.box('std', doorX + 5, y0 + 22, dz + 0.4, 1.2, 1.2, 1, '#c8b060', null, CHROME);
  if (hash01(seed + 5) < 0.55 && lod >= 1) {
    // a wooden porch deck with a rail and steps down
    B.rblock('std', doorX, 10, dz + 16, 50, 3, 30, 0.4, burnt ? '#1a1612' : '#8a6a44', null, WOOD);
    for (const [x, z] of [[-24, 30], [24, 30], [-24, 2], [24, 2]]) B.box('std', doorX + x, 5, dz + z, 3, 10, 3, '#6a4a30', null, WOOD);
    for (const sd of [-1, 1]) {
      B.box('std', doorX + sd * 24, 22, dz + 16, 2, 22, 2, '#8a6a44', null, WOOD);
      B.box('std', doorX + sd * 24, 32, dz + 16, 2, 2, 30, '#8a6a44', null, WOOD);
    }
    B.box('std', doorX, 32, dz + 30, 50, 2, 2, '#8a6a44', null, WOOD);
    // an awning over it on thin posts
    if (!burnt && hash01(seed + 11) < 0.6) {
      B.add('std', T.box(), [doorX, 74, dz + 18], [60, 1, 38], [-0.08, 0, 0], hash01(seed + 12) < 0.5 ? '#2f6a4a' : '#8a3a2a', CORR);
      for (const sd of [-1, 1]) B.cyl('std', doorX + sd * 28, 13, dz + 34, 1, 58, '#c8ccd0', 6, 1, null, CHROME);
    }
  } else {
    for (let k = 0; k < 3; k++) B.rblock('std', doorX, k * 4.4, dz + 6 + (2 - k) * 6, 22, 4.4, 8, 0.6, '#8a8680', null, CONC);
  }
  // the hitch tongue at one end, a propane pair at the other, a window AC, a dish on the roof
  plank(B, 'std', [L / 2, 10, -W * 0.3], [L / 2 + 24, 6, 0], 3, 3, '#2a2a2c', RUSTY);
  plank(B, 'std', [L / 2, 10, W * 0.3], [L / 2 + 24, 6, 0], 3, 3, '#2a2a2c', RUSTY);
  B.cyl('std', L / 2 + 24, 0, 0, 1.6, 6, '#2a2a2c', 6, 1, null, RUSTY);
  if (!burnt && lod >= 1) {
    for (const z of [-8, 8]) B.cyl('std', -L / 2 - 8, 0, z, 5, 26, '#e8e8e4', 12, 1, null, METAL);
    if (hash01(seed + 13) < 0.5) B.rblock('std', L * 0.1, 30, -W / 2 - 5, 18, 12, 10, 1, '#c8c8c0', null, METAL);
    if (hash01(seed + 17) < 0.45) {
      B.cyl('std', -L * 0.3, H, -W * 0.2, 0.8, 10, '#8a8e92', 6, 1, null, METAL);
      B.add('std', T.sphere(10, 5), [-L * 0.3, H + 12, -W * 0.2], [7, 3, 7], [0.9, 0.7, 0], '#d8d8d0', METAL);
    }
  }
  // the yard: a lawn chair, a grill, a flamingo, a kiddie pool, laundry line, a car port
  if (!burnt && lod >= 1) {
    const k = hash01(seed + 21);
    const yz = W / 2 + 46;
    if (k < 0.35) {
      for (const sd of [-1, 1]) B.cyl('std', L * 0.3 + sd * 6, 0, yz + 6, 0.5, 26, '#e84a8a', 5, 1, null, PLAST);
      B.add('std', T.sphere(8, 5), [L * 0.3, 30, yz + 6], [4, 5, 3], null, '#f06aa0', PLAST);
      B.add('std', T.sphere(8, 5), [L * 0.3 + 12, 28, yz + 2], [4, 5, 3], null, '#f06aa0', PLAST);
    } else if (k < 0.6) {
      B.cyl('std', L * 0.25, 0, yz, 20, 6, '#3a8ad8', 16, 1, null, PLAST);
      B.cyl('std', L * 0.25, 5, yz, 18.5, 0.6, '#5a7a4a', 16, 1, null, S(0, 0.1, 0));
    } else if (k < 0.8) {
      for (const x of [-L * 0.3, L * 0.3]) B.cyl('std', x, 0, yz + 10, 1, 60, '#8a8e92', 6, 1, null, METAL);
      rod(B, 'std', [-L * 0.3, 58, yz + 10], [L * 0.3, 58, yz + 10], 0.2, '#e8e8e0', PLAST, 3);
      for (let i = 0; i < 5; i++) B.add('std', T.box(), [-L * 0.2 + i * 18, 50, yz + 10], [12, 14, 0.4], [0, 0, (i - 2) * 0.05], r.pick(['#c0392b', '#e8e2d0', '#2e86c1', '#e0a020', '#6a8a4a']), FABRIC);
    }
    if (hash01(seed + 23) < 0.5) {
      // a folding chair, a cooler
      B.box('std', -L * 0.25, 10, yz, 12, 1, 12, '#2a6a4a', [0, 0.3, 0], FABRIC);
      B.box('std', -L * 0.25 - 5, 18, yz, 1, 16, 12, '#2a6a4a', [0, 0.3, 0.2], FABRIC);
    }
  }
  // burnt: the roof fallen in at one end, soot up the walls, ash; crushed: the oak across it
  if (burnt) {
    for (let i = 0; i < 6; i++) B.add('std', T.box(), [r.range(-L / 2, L / 2), H + r.range(-8, 2), r.range(-W / 3, W / 3)], [r.range(20, 40), 1, r.range(10, 30)], [r.range(-0.4, 0.4), r.range(0, 3), r.range(-0.4, 0.4)], '#141210', S(DET.char, 0.95, 0.2));
    if (lod >= 1) for (const sd of [-1, 1]) decal(B, 'grime', 0, 50, sd * (W / 2 + 1), L * 0.8, 60, sd > 0 ? 0 : PI, { color: '#000000' });
  }
  if (crushed) {
    // the roof broken in a V under the trunk, the oak's trunk and crown across
    for (const s of [-1, 1]) B.add('std', T.box(), [s * L * 0.25, H - 12, 0], [L * 0.52, 2, W + 2], [0, 0, s * 0.22], '#a8aca8', S(DET.metalroof, 0.55, 0.5));
    B.add('std', T.cyl(14, 0.7), [0, H - 6, -20], [16, 360, 16], [0.25, 0.3, HALF - 0.06], '#4a3a28', { ...S(DET.bark, 0.92, 0), map: 'cyl', wobble: { amp: 0.06, seed: 5 } });
    for (let i = 0; i < 16; i++) B.add('std', T.cyl(6, 0.3), [r.range(40, 170), H + r.range(-10, 30), r.range(-60, 30)], [3, r.range(30, 60), 3], [r.range(-1, 1), r.range(0, 6), r.range(-1, 1)], '#4a3a28', { ...S(DET.bark, 0.92, 0), map: 'cyl' });
    B.add('std', T.cyl(14), [-L / 2 - 90, 20, -120], [28, 30, 28], [0.2, 0, 0.3], '#3a2c1e', { ...S(DET.bark, 0.92, 0), map: 'cyl' });
  }
}

const trailer = (P) => trailerModel(P, null);
const trailerBurnt = (P) => trailerModel(P, 'burnt');
const trailerTree = (P) => trailerModel(P, 'tree');

// ---- the entrance, the office, the laundry, the playground ------------------------------------------------------

/** The entrance arch: brick piers, an iron arch with the park's board, planters. */
function parkarch(P) {
  const { B, o } = P;
  const w = o.w;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 16);
    B.rblock('std', x, 0, 0, 26, 110, 26, 1, '#8a4a38', null, S(DET.brick, 0.9, 0));
    B.rblock('std', x, 110, 0, 32, 6, 32, 1, '#c8c0b0', null, CONC);
    B.add('std', T.sphere(10, 6), [x, 124, 0], [9, 9, 9], null, '#c8c0b0', CONC);
    B.rblock('std', x + s * 30, 0, 0, 34, 14, 22, 1, '#8a4a38', null, S(DET.brick, 0.9, 0));
    for (let i = 0; i < 6; i++) B.add('std', T.sphere(6, 4), [x + s * 30 + (i % 3 - 1) * 9, 18, (Math.floor(i / 3) - 0.5) * 8], [5, 5, 5], null, i % 2 ? '#c84a6a' : '#3a6a2a', FABRIC);
  }
  // the arch: two curved iron bars, the board hung between
  for (const y of [150, 162]) {
    let prev = null;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, x = -w / 2 - 16 + t * (w + 32), yy = y + Math.sin(t * PI) * 26;
      if (prev) rod(B, 'std', [prev[0], prev[1], 0], [x, yy, 0], 1.2, '#1a1a1a', METAL, 5);
      prev = [x, yy];
    }
  }
  for (const s of [-1, 1]) rod(B, 'std', [s * (w / 2 + 16), 110, 0], [s * (w / 2 + 16), 164, 0], 1.4, '#1a1a1a', METAL, 5);
  for (const x of [-60, 60]) rod(B, 'std', [x, 176, 0], [x, 150, 0], 0.4, '#1a1a1a', METAL, 4);
  B.rblock('std', 0, 122, 0, 136, 44, 3, 1, '#2f4a3a', null, WOOD);
  sign2(B, 'mr_shady', 0, 144, 0, 128, 40, 0);
}

/** The office double-wide: siding outside, the porch at its door, the flag; inside, the board, a sofa, a cooler. */
function officetrailer(P) {
  const { B, o, halos } = P;
  const w = o.w, h = o.h;
  // skirting around the base, the roof rim, an OFFICE sign over the door (west side)
  for (const [x, z, sx, sz] of [[0, -h / 2 - 1, w, 2], [0, h / 2 + 1, w, 2], [-w / 2 - 1, 0, 2, h], [w / 2 + 1, 0, 2, h]]) B.box('std', x, 7, z, sx, 14, sz, '#8a8478', null, S(DET.siding, 0.9, 0));
  sign(B, 'mr_office', -w / 2 - 7, 88, -20, 60, 15, -HALF);
  // the porch: a deck, rails, steps, a bench, planters, a flag pole
  B.rblock('std', -w / 2 - 40, 10, -20, 70, 3, 110, 0.5, '#8a6a44', null, WOOD);
  for (const z of [-70, 30]) for (const x of [-72, -8]) B.box('std', -w / 2 + x, 5, -20 + z, 3, 10, 3, '#6a4a30', null, WOOD);
  for (const z of [-74, 34]) B.box('std', -w / 2 - 40, 30, -20 + z, 70, 2, 2, '#e8e2d0', null, WOOD);
  B.rblock('std', -w / 2 - 30, 13, -60, 12, 12, 36, 1, '#6a4a30', null, WOOD);
  B.cyl('std', -w / 2 - 70, 0, 50, 1.4, 150, '#c8ccd0', 6, 1, null, CHROME);
  B.add('std', T.box(), [-w / 2 - 58, 140, 50], [24, 14, 0.4], [0, 0, -0.05], '#1a3a8a', FABRIC);
  // inside: the bulletin board and the park map, key rack, a sofa, a water cooler, a box fan
  sign(B, 'mr_parkmap', 0, 70, -h / 2 + 6.8, 60, 45, 0);
  sign(B, 'notice', -60, 70, -h / 2 + 6.8, 16, 20, 0);
  sign(B, 'poster3', 60, 68, -h / 2 + 6.8, 16, 24, 0);
  B.rblock('std', 120, 0, h / 2 - 22, 70, 22, 26, 3, '#6a3a2a', null, FABRIC);
  B.rblock('std', 120, 22, h / 2 - 12, 70, 16, 8, 3, '#6a3a2a', null, FABRIC);
  B.cyl('std', -130, 0, h / 2 - 20, 8, 34, '#e8e8e4', 10, 1, null, PLAST);
  B.cyl('std', -130, 34, h / 2 - 20, 7, 16, '#6ab0e0', 10, 1, null, S(0, 0.1, 0));
  litter(B, -w / 2 + 20, -h / 2 + 20, w / 2 - 20, h / 2 - 20, P.lod >= 2 ? 30 : 10);
  if (P.lod >= 1) floorDecal(B, 'blood2', 40, 20, 40, 60, 0.8, 0.62);
  pendant(B, halos, 20, 90, 0, ...toWorld(o, 20, 0), '#ffe0b0');
}

function reception(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 36, W, 1, '#6a5038', null, WOOD);
  B.rblock('std', 0, 36, 0, L + 3, 2, W + 3, 0.6, '#c8b890', null, S(DET.plastic, 0.4, 0));
  B.rblock('std', L * 0.2, 38, 0, 16, 10, 12, 1, '#2a2a2c', null, PLAST);
  B.box('std', -L * 0.2, 38.6, 0, 12, 1, 16, '#ece6d6', [0, 0.3, 0], FABRIC);
  B.cyl('std', -L * 0.35, 38, 0, 3, 3, '#c8a040', 10, 1, null, CHROME);
}

function files(P) {
  const { B, L, W } = P;
  const n = Math.max(1, Math.round(L / 28));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    B.rblock('std', x, 0, 0, L / n - 1, 56, W, 1, '#7a8078', null, METAL);
    for (let k = 0; k < 4; k++) {
      const out = hash01(i * 5 + k) < 0.3 ? 12 : 0;
      B.box('std', x, 7 + k * 13.4, W / 2 + 0.4 + out / 2, L / n - 4, 12, 0.8 + out, '#8a9088', null, METAL);
    }
  }
  for (let i = 0; i < 8; i++) B.add('std', T.box(), [B.rng.range(-L, L), 0.6, W / 2 + B.rng.range(10, 60)], [9, 0.3, 12], [0, B.rng.range(0, 6), 0], '#ece6d6', FABRIC);
}

function desk(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 28, W, 1, '#8a6a48', null, WOOD);
  B.rblock('std', -L * 0.2, 28, -W * 0.1, 22, 18, 18, 2, '#d8d4c8', null, PLAST);
  B.box('std', -L * 0.2, 38, -W * 0.1 + 9.2, 16, 12, 0.4, '#1a2028', null, S(0, 0.1, 0.3));
  B.box('std', L * 0.2, 28.4, 0, 20, 0.8, 8, '#2a2a2c', null, PLAST);
  B.cyl('std', L * 0.35, 28, -W * 0.2, 2.2, 5, '#c62828', 8, 1, null, PLAST);
}

function laundry(P) {
  const { B, o } = P;
  const w = o.w, h = o.h;
  // washers and dryers along the north wall, a folding table, carts, a vending machine
  for (let i = 0; i < 6; i++) {
    const x = -w / 2 + 26 + i * 32;
    B.rblock('std', x, 0, -h / 2 + 22, 28, 38, 26, 2, '#e8e8e4', null, METAL);
    B.cyl('std', x, 20, -h / 2 + 35.4, 9, 1, i % 2 ? '#1a1a1c' : '#8a9aa4', 16, 1, [HALF, 0, 0], S(0, 0.2, 0.3));
    if (hash01(i * 3) < 0.4) B.add('std', T.cyl(16), [x + 10, 20, -h / 2 + 46], [9, 1, 9], [HALF, 1.2, 0], '#c8ccd0', { ...CHROME, map: 'cyl' });
  }
  B.rblock('std', 0, 0, h / 2 - 34, 100, 30, 34, 1, '#c8c0a8', null, S(DET.plastic, 0.4, 0));
  for (let i = 0; i < 5; i++) B.add('std', T.box(), [B.rng.range(-40, 40), 31, h / 2 - 34 + B.rng.range(-10, 10)], [14, 2, 12], [0, B.rng.range(0, 3), 0], B.rng.pick(['#c0392b', '#e8e2d0', '#2e86c1', '#e0a020']), FABRIC);
  sign(B, 'notice', 60, 60, h / 2 - 6.8, 14, 18, PI);
  litter(B, -w / 2 + 10, -h / 2 + 40, w / 2 - 10, h / 2 - 10, P.lod >= 2 ? 16 : 6);
}

function playground(P) {
  const { B } = P;
  // the swing set: an A-frame, two swings (one wrapped round the bar)
  for (const s of [-1, 1]) {
    rod(B, 'std', [s * 60, 0, -20], [s * 60, 70, 0], 1.6, '#c62828', METAL, 6);
    rod(B, 'std', [s * 60, 0, 20], [s * 60, 70, 0], 1.6, '#c62828', METAL, 6);
  }
  rod(B, 'std', [-62, 70, 0], [62, 70, 0], 1.8, '#c62828', METAL, 6);
  for (const x of [-26, 26]) {
    for (const z of [-5, 5]) rod(B, 'std', [x, 70, z], [x, x > 0 ? 50 : 22, z], 0.3, '#8a8e92', METAL, 3);
    B.box('std', x, x > 0 ? 50 : 22, 0, 16, 1.4, 8, '#1a1a1a', null, RUBBER);
  }
  // a slide, a merry-go-round, the sandbox with a pail
  B.rblock('std', 150, 0, 40, 30, 50, 30, 1, '#2a5ac4', null, PLAST);
  for (let k = 0; k < 5; k++) B.box('std', 130 - k * 2, k * 10, 40, 2, 1.4, 22, '#8a8e92', null, METAL);
  B.add('std', T.box(), [190, 25, 40], [90, 2, 20], [0, 0, -0.52], '#e0c020', PLAST);
  B.cyl('std', -150, 0, 60, 34, 8, '#2f8a4a', 18, 1, null, METAL);
  B.cyl('std', -150, 8, 60, 3, 20, '#c8ccd0', 8, 1, null, CHROME);
  B.rblock('std', 20, 0, 110, 90, 8, 70, 1, '#8a6a44', null, WOOD);
  B.box('std', 20, 7, 110, 84, 1, 64, '#d8c8a0', null, S(DET.sand, 0.95, 0));
  B.cyl('std', 30, 8, 120, 4, 6, '#e0641c', 10, 1.2, null, PLAST);
}

function mailboxes(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 10, 20, 10, 1, '#8a8680', null, CONC);
  B.rblock('std', 0, 20, 0, 60, 44, 16, 1.4, '#6a7a8a', null, METAL);
  for (let i = 0; i < 12; i++) {
    const x = -24 + (i % 6) * 9.6, y = 28 + Math.floor(i / 6) * 16;
    const open = hash01(i * 7) < 0.35;
    B.add('std', T.box(), [x, y, 8.2 + (open ? 3 : 0)], [8.4, 14, 0.6], [open ? 0.9 : 0, 0, 0], '#8a9aa8', METAL);
  }
  B.box('std', 0, 66, 0, 64, 3, 20, '#5a6a78', null, METAL);
}

// ---- the pool ---------------------------------------------------------------------------------------------------

/** The pool: tiled walls down into the water, the coping, ladders, a board, sludge and junk in it. */
function pool(P) {
  const { B, o } = P;
  const w = o.w, d = o.d;
  const tile = { noJitter: true, ...S(DET.tile, 0.25, 0) };
  // walls from the deck down into the water (their bottoms hide the sloped bank)
  for (const [x, z, sx, sz] of [[0, -d / 2, w, 1], [0, d / 2, w, 1], [-w / 2, 0, 1, d], [w / 2, 0, 1, d]]) {
    B.box('std', x, -34, z, sx, 68, sz, '#b8d0d8', null, tile);
    B.box('std', x, -6, z, sx + (sx > 1 ? 0 : 0.2), 8, sz + 0.2, '#2a5a8a', null, tile);
  }
  // the coping round the edge
  for (const [x, z, sx, sz] of [[0, -d / 2 - 6, w + 24, 12], [0, d / 2 + 6, w + 24, 12], [-w / 2 - 6, 0, 12, d], [w / 2 + 6, 0, 12, d]]) B.rblock('std', x, 0, z, sx, 2, sz, 0.6, '#e8e2d4', null, CONC);
  // depth marks, ladders, the diving board
  for (const x of [-w / 2 + 40, w / 2 - 40]) sign(B, 'white', x, 1.2, -d / 2 - 6, 20, 5, 0, { rx: -HALF, color: '#2a4a8a' });
  for (const x of [-w / 2 + 70, w / 2 - 70]) {
    for (const s of [-1, 1]) {
      rod(B, 'std', [x + s * 8, 2, d / 2 + 4], [x + s * 8, 24, d / 2 + 4], 0.9, '#d8dcdc', CHROME, 6);
      rod(B, 'std', [x + s * 8, 24, d / 2 + 4], [x + s * 8, 20, d / 2 - 8], 0.9, '#d8dcdc', CHROME, 6);
      rod(B, 'std', [x + s * 8, 20, d / 2 - 8], [x + s * 8, -30, d / 2 - 8], 0.9, '#d8dcdc', CHROME, 6);
    }
    for (let k = 0; k < 4; k++) B.box('std', x, -2 - k * 10, d / 2 - 8, 16, 1, 3, '#d8dcdc', null, CHROME);
  }
  B.rblock('std', -w / 2 - 20, 0, 0, 20, 10, 16, 1, '#a8a498', null, CONC);
  B.add('std', T.rbox(70, 2.4, 16, 1), [-w / 2 + 16, 12, 0], [1, 1, 1], [0, 0, -0.04], '#e8e8e0', PLAST);
  // the scum: green sludge on the water, leaves, a sunk lounge chair, a floating ring, a noodle
  const r = B.rng;
  for (let i = 0; i < (P.lod >= 1 ? 12 : 4); i++) B.add('lvdecal', T.plane(), [r.range(-w / 2 + 20, w / 2 - 20), -15.2 + i * 0.01, r.range(-d / 2 + 20, d / 2 - 20)], [r.range(60, 140), r.range(40, 90), 1], [-HALF, 0, r.range(0, 6)], '#3a6a1a', { uv: lvUV('grime'), noAO: true, noJitter: true });
  B.add('std', T.box(), [w * 0.2, -14, d * 0.1], [40, 1.6, 16], [0.2, 0.6, 0.3], '#e8e4dc', PLAST);
  B.add('std', T.torus(14, 0.3, 6), [-w * 0.15, -15.6, -d * 0.2], [8, 8, 8], [HALF, 0, 0], '#e84a2a', PLAST);
  B.add('std', T.cyl(8), [w * 0.3, -15.6, -d * 0.25], [1.8, 40, 1.8], [HALF, 1.1, 0], '#f0d020', { ...PLAST, map: 'cyl' });
}

/** The deck: lounge chairs, umbrellas, the lifeguard chair, a life ring on the fence, the rules board. */
function pooldeck(P) {
  const { B, o } = P;
  const r = B.rng;
  const x0 = o.x0 - o.x, x1 = o.x1 - o.x, y0 = o.y0 - o.y, y1 = o.y1 - o.y;
  const lounge = (x, z, rot, col) => {
    B.add('std', T.box(), [x, 8, z], [36, 1.4, 14], [0, rot, 0], col, PLAST);
    B.add('std', T.box(), [x + Math.cos(rot) * 16, 14, z - Math.sin(rot) * 16], [12, 1.4, 14], [0, rot, 0.7], col, PLAST);
    for (const s of [-1, 1]) B.box('std', x + Math.cos(rot) * s * 14, 4, z - Math.sin(rot) * s * 14, 1, 8, 12, '#c8ccd0', [0, rot, 0], CHROME);
  };
  for (let i = 0; i < 6; i++) lounge(-300 + i * 60, y1 - 60, HALF + r.range(-0.3, 0.3), r.pick(['#e8e8e0', '#2a8ad8', '#e8e8e0']));
  lounge(x0 + 60, -60, 0.3, '#e8e8e0');
  lounge(x0 + 60, 20, -0.4, '#2a8ad8');
  for (const [x, z, c] of [[-200, y1 - 100, '#c62828'], [150, y1 - 100, '#2a5ac4']]) {
    B.cyl('std', x, 0, z, 1.2, 70, '#e8e8e0', 6, 1, null, CHROME);
    B.add('std', T.cyl(8, 0.05), [x, 70, z], [36, 14, 36], null, c, { ...FABRIC, map: 'cyl' });
  }
  // the lifeguard chair
  for (const [dx, dz] of [[-10, -8], [10, -8], [-10, 8], [10, 8]]) rod(B, 'std', [x1 - 60 + dx * 1.5, 0, -40 + dz * 1.5], [x1 - 60 + dx, 60, -40 + dz], 1.2, '#e8e8e0', WOOD, 5);
  B.rblock('std', x1 - 60, 60, -40, 24, 3, 20, 0.6, '#e8e8e0', null, WOOD);
  B.rblock('std', x1 - 60, 63, -48, 24, 20, 3, 0.6, '#e8e8e0', null, WOOD);
  // on the fence: the rules board, a life ring
  sign(B, 'mr_poolrules', -100, 44, y0 + 7, 30, 45, 0);
  B.add('std', T.torus(16, 0.3, 6), [80, 40, y0 + 8], [10, 10, 10], null, '#e84a2a', PLAST);
  // towels, a cooler, bottles, blood on the deck where something happened
  for (let i = 0; i < 6; i++) B.add('std', T.box(), [r.range(x0 + 40, x1 - 40), 0.5, r.range(y0 + 30, y1 - 30)], [16, 0.4, 28], [0, r.range(0, 6), 0], r.pick(['#e84a8a', '#2a8ad8', '#f0d020', '#e8e8e0']), FABRIC);
  if (P.lod >= 1) floorDecal(B, 'blood2', 100, y1 - 150, 50, 80, 0.6, 0.5);
}

/** The pool house inside and its sign: showers, a bench, lockers. */
function poolhouse(P) {
  const { B } = P;
  for (let i = 0; i < 3; i++) {
    const x = -60 + i * 40;
    rod(B, 'std', [x, 90, -86], [x, 80, -80], 0.8, '#c8ccd0', CHROME, 5);
    B.cyl('std', x, 78, -78, 3, 2, '#c8ccd0', 8, 1, null, CHROME);
  }
  B.rblock('std', 0, 10, 60, 120, 4, 20, 1, '#8a6a44', null, WOOD);
  for (let i = 0; i < 5; i++) {
    const z = -60 + i * 26;
    B.rblock('std', 86, 0, z, 18, 80, 24, 1, '#3a6a8a', null, METAL);
    if (hash01(i) < 0.4) B.add('std', T.box(), [96, 40, z + 10], [1, 70, 22], [0, -1, 0], '#3a6a8a', METAL);
  }
  sign(B, 'notice', -106 - 1.2, 80, 60, 14, 18, -HALF);
}

// ---- Ozzy's radio shack ----------------------------------------------------------------------------------------------

/** The radio desk: a bench of rigs, a mic, logbooks, a lamp; the scanner flickering. */
function radiodesk(P) {
  const { B, L, W, o, halos } = P;
  B.rblock('std', 0, 0, 0, L, 34, W, 1, '#6a5038', null, WOOD);
  B.rblock('std', 0, 34, -W * 0.2, L - 20, 36, 16, 1, '#2a2a2c', null, METAL);
  B.add('lvglow', T.plane(), [0, 52, -W * 0.2 + 8.4], [L - 30, 30, 1], null, '#ffffff', { emissive: 1.2, uv: lvUV('mr_radio'), noAO: true });
  B.cyl('std', L * 0.1, 34, W * 0.2, 4, 1.4, '#2a2a2c', 10, 1, null, METAL);
  rod(B, 'std', [L * 0.1, 35, W * 0.2], [L * 0.1, 50, W * 0.2], 0.6, '#2a2a2c', METAL, 4);
  B.add('std', T.sphere(8, 6), [L * 0.1, 52, W * 0.22], [2.4, 3.4, 2.4], null, '#1a1a1a', PLAST);
  for (let i = 0; i < 4; i++) B.add('std', T.box(), [-L * 0.3 + i * 12, 34.6, W * 0.25], [10, 1.4 + i * 0.3, 14], [0, B.rng.range(-0.3, 0.3), 0], B.rng.pick(['#2a4a6a', '#6a2a2a', '#e8e2d0']), FABRIC);
  B.cyl('std', L * 0.4, 34, 0, 4, 1, '#2a2a2c', 10, 1, null, METAL);
  rod(B, 'std', [L * 0.4, 35, 0], [L * 0.36, 58, 6], 0.5, '#2a2a2c', METAL, 4);
  glowBox(B, L * 0.36, 58, 8, 5, 3, 5, '#ffd9a0', 2.2);
  const [wx, wz] = toWorld(o, 0, -W * 0.2 + 10);
  halos.push({ x: wx, y: wz, h: 52, color: '#7affc8', size: 50, strength: 0.4, flicker: 0.4 });
}

/** Ozzy's lattice mast: tapering sections, a yagi and a vertical up top, guy wires, the red light. */
function mast(P) {
  const { B, o, halos } = P;
  const H = 520;
  const r0 = 12, r1 = 5;
  const R = (y) => r0 + (r1 - r0) * (y / H);
  B.rblock('std', 0, 0, 0, 30, 8, 30, 1, '#a8a498', null, CONC);
  const legs = [0, 2.1, 4.2];
  for (const a of legs) rod(B, 'std', [Math.cos(a) * r0, 8, Math.sin(a) * r0], [Math.cos(a) * r1, H, Math.sin(a) * r1], 1.2, '#c8ccd0', CHROME, 5);
  const step = P.lod >= 1 ? 26 : 52;
  for (let y = 8; y < H - 10; y += step) {
    for (let k = 0; k < 3; k++) {
      const a = legs[k], b = legs[(k + 1) % 3];
      rod(B, 'std', [Math.cos(a) * R(y), y, Math.sin(a) * R(y)], [Math.cos(b) * R(y + step), y + step, Math.sin(b) * R(y + step)], 0.4, '#c8ccd0', CHROME, 3);
    }
  }
  // the yagi and a vertical whip on top, a rotator box
  B.rblock('std', 0, H, 0, 8, 8, 8, 1, '#3a3c3e', null, METAL);
  B.cyl('std', 0, H + 8, 0, 1, 40, '#c8ccd0', 6, 1, null, CHROME);
  rod(B, 'std', [-50, H + 36, 0], [50, H + 36, 0], 0.8, '#c8ccd0', CHROME, 4);
  for (let x = -46; x <= 46; x += 13) rod(B, 'std', [x, H + 36, -20 + Math.abs(x) * 0.1], [x, H + 36, 20 - Math.abs(x) * 0.1], 0.4, '#c8ccd0', CHROME, 3);
  B.cyl('std', 0, H + 48, 0, 0.5, 90, '#c8ccd0', 5, 1, null, CHROME);
  B.add('blink', T.sphere(6, 4), [0, H + 140, 0], [2.6, 2.6, 2.6], null, '#ff2a1a', { emissive: 3.4 });
  halos.push({ x: o.x, y: o.y, h: H + 140, color: '#ff2a1a', size: 80, strength: 0.8, blink: 1 });
  // guy wires to three anchors
  for (const a of [0.8, 2.9, 5.0]) {
    const ax = Math.cos(a) * 190, az = Math.sin(a) * 190;
    for (const y of [H * 0.4, H * 0.8]) rod(B, 'std', [Math.cos(a) * R(y), y, Math.sin(a) * R(y)], [ax, 4, az], 0.18, '#8a8e92', METAL, 3);
    B.rblock('std', ax, 0, az, 10, 5, 10, 1, '#8a8680', null, CONC);
  }
  // the feed line down to the shack
  rod(B, 'std', [0, H * 0.3, 4], [-230, 90, 60], 0.8, '#1a1a1a', RUBBER, 4);
}

/** The shack's dressing: the sign, solar panels on a rack, a generator, the cot and maps inside. */
function shack(P) {
  const { B, o, halos } = P;
  const w = o.w, h = o.h;
  sign(B, 'mr_ozzy', -40, 70, h / 2 + 7.4, 56, 28, 0);
  decal(B, 'graf5', 90, 50, h / 2 + 7.2, 60, 30, 0);
  // solar panels on a frame beside it, the generator, jerry cans, a satellite dish
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 - 30 - i * 32;
    for (const z of [-20, 20]) B.box('std', x, 12, z, 2, 24, 2, '#8a8e92', null, METAL);
    B.add('std', T.box(), [x, 26, 0], [30, 1.2, 50], [0.5, 0, 0], '#1a2a4a', S(DET.glass, 0.15, 0.5));
  }
  B.rblock('std', w / 2 + 30, 0, 40, 36, 26, 22, 2, '#c8a020', null, METAL);
  for (let i = 0; i < 3; i++) B.rblock('std', w / 2 + 18 + i * 10, 0, 64, 8, 13, 5, 0.8, '#c62828', null, METAL);
  // inside: a cot, maps and a frequency list on the walls, a chair, tins, a coffee pot
  B.rblock('std', w / 2 - 50, 0, 40, 70, 12, 26, 1, '#5a6340', null, FABRIC);
  B.add('std', T.pillow(8, 5, 0.5), [w / 2 - 70, 14, 40], [10, 3, 10], null, '#e8e4d4', FABRIC);
  sign(B, 'mr_parkmap', -60, 70, -h / 2 + 5.6, 50, 38, 0);
  sign(B, 'notice', 40, 74, -h / 2 + 5.6, 14, 18, 0);
  sign(B, 'poster2', -w / 2 + 5.6, 70, 20, 16, 24, HALF);
  B.rblock('std', -30, 0, 10, 16, 18, 16, 1, '#3a3a3c', null, FABRIC);
  litter(B, -w / 2 + 20, -h / 2 + 40, w / 2 - 20, h / 2 - 20, P.lod >= 2 ? 20 : 6);
  pendant(B, halos, 0, 88, 20, ...toWorld(o, 0, 20), '#ffc27a');
}

/** The shack's tin roof (its own style): a low lean-to with solar cells and the mast's cable. */
function shackRoof(P) {
  const { B, o } = P;
  B.add('std', T.box(), [0, 106, 0], [o.w + 16, 2, o.h + 20], [0.08, 0, 0], '#8a7a6a', S(DET.corrugated, 0.6, 0.4));
  B.box('std', 0, 98, 0, o.w - 10, 1, o.h - 10, '#a8885a', null, S(DET.wood, 0.85, 0));
  for (let i = 0; i < 3; i++) B.add('std', T.box(), [-o.w * 0.3 + i * 50, 110, -10], [44, 1.4, 60], [0.2, 0, 0], '#1a2a4a', S(DET.glass, 0.15, 0.5));
}

// ---- the park's gates --------------------------------------------------------------------------------------------------

/** The rolling gate from the gas station (the gate obstacle: slides along its length). */
function slidegate(P) {
  const { B, L } = P;
  const H = 96;
  for (const y of [4, H / 2, H - 2]) B.add('std', T.cyl(6), [0, y, 0], [1.4, L, 1.4], [0, 0, HALF], '#9aa0a4', { ...CHROME, map: 'cyl' });
  for (const x of [-L / 2 + 2, -L / 6, L / 6, L / 2 - 2]) B.box('std', x, H / 2, 0, 2.6, H, 2.6, '#9aa0a4', null, CHROME);
  B.add('fence', T.plane(), [0, H / 2, 0], [L - 4, H - 6, 1], null, '#8a9094', { uvScale: [L / 16, (H - 6) / 16] });
  for (let x = -L / 2 + 5; x < L / 2 - 3; x += 5.4) B.box('std', x, H / 2, 0.8, 3.6, H - 10, 0.5, '#3a5a4a', null, PLAST);
  for (const x of [-L / 2 + 14, L / 2 - 14]) B.cyl('std', x, 0, 0, 4, 2, '#2a2a2c', 10, 1, [HALF, 0, 0], RUBBER);
  sign2(B, 'mr_shady', 0, 58, 0, 90, 28, 0);
  // barbed wire up top
  for (const z of [-3, 3]) rod(B, 'std', [-L / 2, H + 8, z], [L / 2, H + 8, z], 0.25, '#4a4c4e', RUSTY, 3);
}

/** Its track across the drive and the receiving post. */
function gatetrack(P) {
  const { B, o } = P;
  const w = o.w;
  B.box('std', 0, 0.6, 0, w + 240, 1.2, 4, '#4a4c4e', null, RUSTY);
  for (const s of [-1, 1]) B.box('std', s * (w / 2 + 6), 55, 0, 8, 110, 8, '#6a6e72', null, CHROME);
  B.rblock('std', w / 2 + 30, 0, -20, 16, 40, 14, 1, '#3a3c3e', null, METAL);
}

/** The chain-link panel into the corn (kind 'fence': cut and falls), a hole already started. */
function fencepanel(P) {
  const { B, L } = P;
  const H = 96;
  for (const x of [-L / 2 + 1, L / 2 - 1]) B.cyl('std', x, 0, 0, 1.8, H + 6, '#8a8e92', 8, 1, null, CHROME);
  B.add('std', T.cyl(6), [0, H - 1, 0], [1.1, L, 1.1], [0, 0, HALF], '#8a8e92', { ...CHROME, map: 'cyl' });
  B.add('fence', T.plane(), [0, H / 2, 0], [L - 2, H - 2, 1], null, '#8a9094', { uvScale: [L / 16, (H - 2) / 16] });
  sign2(B, 'mr_haskell', 0, 64, 1.6, 70, 17.5, 0);
  sign(B, 'notice', -L * 0.3, 40, -1.2, 14, 18, PI);
}

/** Models by obstacle style or prop name: fn(P), P the kit's model context (createKitArt). */
export const PARK_MODELS = {
  'mr-trailer': trailer, 'mr-trailer-burnt': trailerBurnt, 'mr-trailer-tree': trailerTree, 'mr-parkarch': parkarch, 'mr-officetrailer': officetrailer,
  'mr-reception': reception, 'mr-files': files, 'mr-desk': desk, 'mr-laundry': laundry, 'mr-playground': playground, 'mr-mailboxes': mailboxes,
  'mr-pool': pool, 'mr-pooldeck': pooldeck, 'mr-poolhouse': poolhouse, 'mr-radiodesk': radiodesk, 'mr-mast': mast, 'mr-shack': shack, 'mr-gatetrack': gatetrack,
};
/** Gate models by style, drawn in the gate obstacle's frame (the engine animates them open). */
export const PARK_GATES = { 'mr-slidegate': slidegate, 'mr-fencepanel': fencepanel };
/** Roof models by style, drawn in the roof's frame (the art draws that ceiling itself). */
export const PARK_ROOFS = { 'mr-shackroof': shackRoof };
void [CORR, RUSTY, NJ, crate, drum, tyre, carton, atlasUV, sign2];
