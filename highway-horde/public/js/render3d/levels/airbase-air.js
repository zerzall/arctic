// Fort Harlan's aircraft and vehicles: the twin-turboprop cargo plane in hangar 2 (its ramp down), a
// Black Hawk in maintenance, two crashed and burnt Black Hawks, Humvees, the HEMTT refuelers, a tow tug,
// K-loaders, the crash tender and the morgue's reefer trailer. Each is drawn in its obstacle's frame
// (local x along the length, front at +x unless noted, z across, y up).

import { T, DET, S, STEEL, PAINTED, COL, at, pic, rod, lampGlow, shadeHex, mixHex, hash01, toWorld } from './dam-kit.js';

const HALF = Math.PI / 2;
const AIR = S(DET.panel, 0.5, 0.35);
const RUBBER = S(DET.rubber, 0.9, 0);
const BURNT = S(DET.char, 0.95, 0.1);

/** A wheel with a hub, axis along z, at (x, y = radius, z). */
function wheel(B, x, z, r, w, low = false) {
  B.cylZ('std', x, r, z, r, w, '#1c1c1c', low ? 8 : 14, RUBBER);
  B.cylZ('std', x, r, z + Math.sign(z || 1) * (w / 2 + 0.2), r * 0.55, 0.6, '#4a4e44', low ? 6 : 10, STEEL);
}

// ---- the cargo plane ------------------------------------------------------------------------------------------

/**
 * A C-27J-like cargo plane (obstacle style 'c27', local x from the nose at -L/2 to the open ramp at +L/2):
 * a lathed fuselage with an upswept tail, a high wing with two turboprops, the T-less tail, sponsons,
 * the ramp down onto the hangar floor with the dark hold behind it.
 */
export function cargoPlane(P, o) {
  const { B, tier } = P;
  const L = o.w;
  const nose = -L / 2;
  const grey = '#7c838a', greyD = '#5e656c';
  const seg = tier === 'low' ? 10 : 20;
  // the fuselage: nose to the start of the upsweep (a lathe along x), and the tail cone swept up
  const R = 46, cy = 72;
  const body = [[0, 0], [14, 6], [26, 18], [36, 40], [42, 70], [46, 110], [46, 560], [45, 600]];
  B.add('std', T.lathe('c3c27body', body.map(([r, y]) => [r, y]), seg), [nose, cy, 0], [1, 1, 1], [0, 0, -HALF], grey, AIR);
  B.add('std', T.lathe('c3c27hold', body.slice(4).reverse().map(([r, y]) => [r * 0.94, y]), seg), [nose, cy, 0], [1, 1, 1], [0, 0, -HALF], '#1a1c1e', S(0, 0.9, 0));
  const tx = nose + 600;
  const tail = [[45, 0], [40, 60], [30, 130], [18, 190], [8, 215]];
  B.add('std', T.lathe('c3c27tail', tail, seg), [tx, cy + 8, 0], [1, 1, 1], [0, 0, -HALF + 0.22], grey, AIR);
  // (the tail cone's open belly: the ramp hinges at the hold's floor and lies down to the hangar floor)
  const hingeX = tx + 6, hingeY = cy - 30;
  const rampEnd = L / 2 - 4;
  const ramp = Math.atan2(hingeY - 2, rampEnd - hingeX);
  B.add('std', T.box(), [(hingeX + rampEnd) / 2, hingeY / 2 + 1, 0], [Math.hypot(rampEnd - hingeX, hingeY) , 3, 70], [0, 0, -ramp], greyD, AIR);
  for (const s of [-1, 1]) B.add('std', T.box(), [(hingeX + rampEnd) / 2, hingeY / 2 + 3, s * 30], [Math.hypot(rampEnd - hingeX, hingeY), 3, 4], [0, 0, -ramp], '#c8a020', PAINTED);
  B.box('std', tx - 40, cy - 34, 0, 120, 2, 70, '#3a3c3a', null, STEEL);    // the hold's floor
  B.box('std', tx - 30, cy - 33, 0, 90, 30, 50, '#5a6040', null, S(DET.fabric, 0.95, 0));  // a pallet still lashed in
  // windows: the cockpit's panes, the side door and its window
  for (const s of [-1, 1]) {
    B.add('glass', T.box(), [nose + 44, cy + 26, s * 26], [26, 12, 14], [s * -0.5, 0, 0.35], '#141c22');
    B.add('glass', T.box(), [nose + 66, cy + 32, s * 30], [18, 10, 10], [s * -0.6, 0, 0.1], '#141c22');
    B.box('std', nose + 140, cy - 6, s * (R - 0.5), 34, 64, 1.4, greyD, null, AIR);
    B.box('glass', nose + 140, cy + 12, s * (R + 0.2), 10, 10, 0.6, '#141c22');
    for (let x = nose + 220; x < nose + 520; x += 60) B.cylZ('glass', x, cy + 18, s * (R - 1), 5, 2, '#141c22', 10);
    pic(B, 'usarmy', nose + 330, cy + 22, s * (R + 0.6), 10, s > 0 ? 0 : Math.PI, { w: 70 });
  }
  // the high wing on the fuselage's back, the two turboprops
  const wx = nose + 300, wy = cy + R + 8;
  B.add('std', T.profile('c3c27wing', [[-60, -450], [10, -450], [40, 0], [10, 450], [-60, 450], [-80, 0]], 0, 1), [wx, wy, 0], [1, 1, 8], [HALF, 0, 0], grey, AIR);
  B.rblock('std', wx - 20, cy + 30, 0, 140, 26, 70, 10, grey, null, AIR);
  for (const s of [-1, 1]) {
    const z = s * 150, ny = wy - 14;
    B.cylX('std', wx - 30, ny, z, 17, 170, greyD, seg, AIR);
    B.add('std', T.cyl(seg, 0.2), [wx - 128, ny, z], [14, 26, 14], [0, 0, HALF], '#3a3e42', STEEL);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + (s > 0 ? 0.3 : 0.9);
      B.add('std', T.box(), [wx - 132, ny + Math.cos(a) * 36, z + Math.sin(a) * 36], [2, 70, 9], [a, 0, 0], '#2a2c2e', STEEL);
    }
    B.box('std', wx - 30, ny - 16, z, 120, 6, 18, greyD, null, AIR);
    // the main gear sponson and wheels, the wingtip
    B.rblock('std', nose + 330, 6, s * 48, 160, 40, 22, 8, grey, null, AIR);
    for (const x of [nose + 300, nose + 360]) wheel(B, x, s * 46, 13, 10, tier === 'low');
    B.add('std', T.sphere(8, 4), [wx - 20, wy, s * 450], [30, 4, 4], null, '#c8261c', AIR);
  }
  // the nose gear
  rod(B, 'std', [nose + 70, cy - 30, 0], [nose + 74, 10, 0], 2.4, '#4a4e52', STEEL, 6);
  for (const s of [-1, 1]) wheel(B, nose + 74, s * 7, 10, 6, tier === 'low');
  // the tail: fin and rudder, the tailplane on top of the cone, the markings
  const fx = tx + 120;
  B.add('std', T.profile('c3c27fin', [[-70, 0], [70, 0], [95, 200], [40, 200]], 0, 1), [fx, cy + 50, 0], [1, 1, 6], null, grey, AIR);
  B.add('std', T.profile('c3c27stab', [[-30, -170], [20, -170], [40, 0], [20, 170], [-30, 170], [-50, 0]], 0, 1), [fx + 30, cy + 62, 0], [1, 1, 5], [HALF, 0, 0], grey, AIR);
  for (const s of [-1, 1]) {
    pic(B, 'tail', fx + 30, cy + 150, s * 3.4, 12, s > 0 ? 0 : Math.PI, { w: 80 });
    pic(B, 'usarmy', fx + 40, cy + 120, s * 3.4, 10, s > 0 ? 0 : Math.PI, { w: 60 });
  }
  // a stain of hydraulic fluid on the floor, wheel chocks
  B.box('std', nose + 330, 3, 70, 10, 6, 14, '#c8a020', null, PAINTED);
  void COL; void mixHex;
  return true;
}

// ---- helicopters ------------------------------------------------------------------------------------------------

function blackHawk(B, o, wrecked, low) {
  // nose at -x; the cabin, the cockpit glazing, the engine cowlings, the tail boom and pylon
  const col = wrecked ? '#24241f' : '#3e4630', colD = shadeHex(col, -0.2);
  const surf = wrecked ? BURNT : AIR;
  B.rblock('std', -10, 12, 0, 150, 66, 60, 14, col, null, surf);
  B.add('std', T.box(), [-92, 44, 0], [40, 46, 54], [0, 0, -0.35], col, surf);
  B.rblock('std', -20, 74, 0, 110, 18, 40, 8, colD, null, surf);
  if (!wrecked) {
    for (const s of [-1, 1]) {
      B.add('glass', T.box(), [-98, 54, s * 20], [26, 22, 16], [s * -0.3, 0, -0.5], '#141c22');
      B.box('glass', -50, 52, s * 30.2, 30, 22, 0.6, '#141c22');
      B.box('glass', 10, 52, s * 30.2, 22, 18, 0.6, '#141c22');
    }
  }
  // the tail boom (broken off on a wreck: drawn apart, at an angle), the pylon and the stabilator
  const boom = (dx, dz, ry) => {
    B.add('std', T.cyl(low ? 6 : 10, 0.5), [65 + dx, 54, dz], [14, 160, 12], [0, ry, -HALF], col, surf);
    B.add('std', T.box(), [150 + dx, 80, dz + Math.sin(ry) * -80], [26, 70, 6], [0, ry, -0.3], col, surf);
    B.add('std', T.box(), [146 + dx, 52, dz + Math.sin(ry) * -80], [20, 2, 70], [0, ry, 0], col, surf);
  };
  if (wrecked) boom(30, -20, 0.35);
  else boom(0, 0, 0);
  // the rotor: four blades folded back along the boom in the hangar; bent and thrown off on a wreck
  B.cyl('std', -20, 92, 0, 6, 10, '#2a2c2e', 8, 1, null, STEEL);
  if (!wrecked) {
    for (const s of [-1, 0.33, -0.33, 1]) B.add('std', T.box(), [100, 100 + s, s * 5], [260, 1.4, 9], [0, s * 0.03, 0], '#2a2c2e', STEEL);
  } else {
    B.add('std', T.box(), [40, 96, 30], [200, 1.4, 9], [0.1, 0.5, 0.15], '#1a1a1a', STEEL);
    B.add('std', T.box(), [-140, 6, -80], [220, 1.4, 9], [0.05, -0.9, 0.02], '#1a1a1a', STEEL);
    B.add('std', T.box(), [-60, 4, 110], [160, 1.4, 9], [0.08, 1.3, 0], '#1a1a1a', STEEL);
  }
  // landing gear: two mains and the tail wheel
  for (const s of [-1, 1]) {
    rod(B, 'std', [-40, 20, s * 28], [-40, 10, s * 42], 2, '#3a3c3e', STEEL, 5);
    wheel(B, -40, s * 42, 10, 7, low);
  }
  wheel(B, 220, 0, 6, 4, low);
  if (!wrecked) {
    for (const s of [-1, 1]) pic(B, 'usarmy', -10, 30, s * 30.6, 8, s > 0 ? 0 : Math.PI, { w: 50 });
    B.box('std', 0, 1, 70, 60, 2, 40, '#3a3c3a', null, STEEL);      // a drip tray under it
  }
}

/** The Black Hawk in hangar 1 (style 'uh60'), the burnt wrecks (style 'helowreck', lying on their side). */
export function helicopter(P, o) {
  const { B, tier } = P;
  if (o.style === 'uh60') { blackHawk(B, o, false, tier === 'low'); return true; }
  // the wreck: the cabin rolled over onto its side, the floor and seats showing, soot and scorch around
  B.add('std', T.box(), [0, 1, 0], [300, 1, 160], null, '#141412', BURNT);
  B.add('std', T.box(), [-20, 30, 0], [150, 56, 66], [1.3, 0, 0.08], '#24241f', BURNT);
  B.add('std', T.box(), [-95, 26, 8], [40, 40, 50], [1.3, 0, -0.3], '#24241f', BURNT);
  B.add('std', T.box(), [-20, 36, 26], [140, 4, 50], [1.3, 0, 0.08], '#3a3a32', BURNT);
  for (let k = 0; k < 3; k++) B.rblock('std', -60 + k * 40, 10, 24, 20, 20, 16, 3, '#2a2a26', [0, 0, 0.2], BURNT);
  blackHawkTail(B, tier === 'low');
  for (const [x, z, ry] of [[40, -60, 0.5], [-160, -90, -0.9], [-70, 110, 1.3], [120, 60, 2.2]]) B.add('std', T.box(), [x, 3, z], [180, 1.4, 9], [0.06, ry, 0.03], '#1a1a1a', STEEL);
  return true;
}

function blackHawkTail(B, low) {
  // the broken boom lying beside the cabin, the pylon on its side
  const col = '#24241f';
  B.add('std', T.cyl(low ? 6 : 10, 0.55), [175, 12, -20], [12, 130, 11], [0, 0.35, -HALF], col, BURNT);
  B.add('std', T.box(), [235, 18, -42], [24, 64, 6], [1.2, 0.35, -0.2], col, BURNT);
}

// ---- vehicles ----------------------------------------------------------------------------------------------------

/** An HMMWV (style 'humvee'): wide hull, sloped hood, the cab, a hard-top cargo bed or a gun turret. */
export function humvee(P, o) {
  const { B, tier } = P;
  const L = o.w, W = o.h;
  const wr = !!o.wrecked;
  const col = wr ? mixHex(o.color, '#1e1c1a', 0.5) : o.color;
  const colD = shadeHex(col, -0.18);
  const surf = wr ? BURNT : S(DET.panel, 0.7, 0.2);
  const low = tier === 'low';
  B.rblock('std', 0, 12, 0, L - 4, 18, W - 10, 3, col, null, surf);
  B.add('std', T.box(), [L * 0.3, 33, 0], [L * 0.36, 8, W - 12], [0, 0, -0.12], col, surf);
  B.rblock('std', -L * 0.04, 30, 0, L * 0.34, 26, W - 12, 3, col, null, surf);
  B.rblock('std', -L * 0.32, 30, 0, L * 0.3, 22, W - 12, 3, colD, null, surf);
  if (!wr) {
    B.add('glass', T.box(), [L * 0.13, 44, 0], [1, 14, W - 18], [0, 0, 0.15], '#141c22');
    for (const s of [-1, 1]) B.box('glass', -L * 0.04, 46, s * (W / 2 - 5.5), L * 0.26, 10, 0.6, '#141c22');
  }
  for (const s of [-1, 1]) {
    B.box('std', L * 0.33, 24, s * (W / 2 - 3), L * 0.3, 3, 6, colD, null, surf);
    B.box('std', -L * 0.34, 24, s * (W / 2 - 3), L * 0.3, 3, 6, colD, null, surf);
  }
  // the turret: a ring and a gunner's shield on some
  if (hash01(o.id * 7) < 0.6) {
    B.cyl('std', -L * 0.04, 56, 0, 13, 4, '#2a2c26', 12, 1, null, STEEL);
    B.add('std', T.box(), [-L * 0.04 + 12, 66, 0], [3, 18, 26], [0, 0, 0.15], colD, surf);
    if (!wr) rod(B, 'std', [-L * 0.04 + 6, 66, 0], [-L * 0.04 + 34, 68, 0], 1.2, '#1a1a1a', STEEL, 5);
  }
  B.box('std', L / 2 - 1, 22, 0, 2, 8, W - 14, '#2a2a28', null, STEEL);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (wr && sx * sz > 0 && hash01(o.id) < 0.5) continue;        // a wheel gone
    wheel(B, sx * L * 0.31, sz * (W / 2 - 4), 10, 8, low);
  }
  if (!wr) {
    for (const s of [-1, 1]) lampGlow(B, null, L / 2, 30, s * (W / 2 - 8), 0, 0, '#ffe8c8', { size: [0.8, 3, 4], k: P.day ? 0.2 : 1.5, halo: 0 });
    pic(B, 'usarmy', -L * 0.32, 36, W / 2 - 5.7, 5, 0, { w: 26 });
  } else {
    B.add('std', T.box(), [-L * 0.04, 34, W / 2 + 10], [L * 0.2, 22, 2], [0, 0.9, 0.2], colD, surf);   // a door blown off
  }
  return true;
}

/** An M978 HEMTT refueler (style 'refueler'): the cab, the tank, four axles; o.wrecked burns it out. */
export function refueler(P, o) {
  const { B, tier } = P;
  const L = o.w, W = o.h;
  const wr = !!o.wrecked;
  const col = wr ? '#2a2824' : (o.color || '#c8c2a8');
  const surf = wr ? BURNT : S(DET.panel, 0.7, 0.2);
  const low = tier === 'low';
  B.block('std', 0, 16, 0, L - 6, 8, W - 20, '#2a2a28', null, STEEL);
  B.rblock('std', L / 2 - 26, 24, 0, 46, 44, W - 6, 3, col, null, surf);
  if (!wr) B.add('glass', T.box(), [L / 2 - 3, 56, 0], [1, 14, W - 14], [0, 0, 0.12], '#141c22');
  B.add('std', T.cyl(low ? 10 : 18, 1), [-12, 52, 0], [W / 2 - 4, L - 64, W / 2 - 6], [0, 0, HALF], col, surf);
  for (const x of [-L / 2 + 40, L / 2 - 120]) B.add('std', T.torus(low ? 10 : 18, 0.06, 4), [x, 52, 0], [W / 2 - 3, W / 2 - 5, W / 2 - 3], [0, HALF, 0], shadeHex(col, -0.15), surf);
  B.box('std', -12, 52 + W / 2 - 4, 0, L - 80, 3, 10, '#4a4a46', null, STEEL);
  for (let k = 0; k < 4; k++) {
    const x = -L / 2 + 26 + k * ((L - 60) / 3) + (k > 1 ? 0 : 0);
    for (const s of [-1, 1]) wheel(B, x, s * (W / 2 - 6), 13, 10, low);
  }
  for (const s of [-1, 1]) pic(B, 'fuel', -20, 52, s * (W / 2 - 3.6), 16, s > 0 ? 0 : Math.PI);
  if (wr) B.add('std', T.box(), [0, 1, 0], [L + 40, 1, W + 60], null, '#121210', BURNT);
  return true;
}

/** A crash tender (style 'crashtender'): the big box body, a roof turret, three axles, the light bar. */
export function crashTender(P, o) {
  const { B, halos, tier } = P;
  const L = o.w, W = o.h;
  const col = o.color || '#b8c21a';
  const low = tier === 'low';
  B.rblock('std', 0, 18, 0, L - 4, 66, W - 4, 6, col, null, S(DET.panel, 0.55, 0.25));
  B.rblock('std', L / 2 - 30, 18, 0, 50, 76, W - 6, 8, col, null, S(DET.panel, 0.55, 0.25));
  B.add('glass', T.box(), [L / 2 - 5, 74, 0], [1, 22, W - 14], [0, 0, 0.25], '#141c22');
  for (const s of [-1, 1]) {
    for (let x = -L / 2 + 30; x < L / 2 - 70; x += 36) B.box('std', x, 50, s * (W / 2 - 1.6), 30, 44, 1, shadeHex(col, -0.12), null, PAINTED);
    pic(B, 'hazard', -10, 22, s * (W / 2 - 1.4), 6, s > 0 ? 0 : Math.PI, { w: L - 20 });
  }
  B.cyl('std', 10, 84, 0, 8, 8, '#d8d8d4', 10, 1, null, STEEL);
  rod(B, 'std', [10, 92, 0], [50, 96, 0], 3, '#d8d8d4', STEEL, 8);
  B.box('std', L / 2 - 30, 96, 0, 12, 4, 40, '#2a2a2a', null, STEEL);
  for (const s of [-1, 1]) lampGlow(B, halos, L / 2 - 30, 99, s * 12, ...toWorld(o, L / 2 - 30, s * 12), s > 0 ? '#ff3a2a' : '#3a6aff', { size: [10, 3, 6], k: 5, halo: 70, strength: 0.6, blink: 1, y0: 0 });
  for (const x of [-L / 2 + 30, -L / 2 + 70, L / 2 - 40]) for (const s of [-1, 1]) wheel(B, x, s * (W / 2 - 6), 16, 12, low);
  return true;
}

/** Small apron machines: the tow tug, the K-loader, the reefer trailer. */
export function apronMachine(P, o) {
  const { B, tier } = P;
  const low = tier === 'low';
  switch (o.style) {
    case 'tug': {
      const L = o.w, W = o.h;
      B.rblock('std', 0, 6, 0, L, 18, W, 3, '#c8a020', null, S(DET.panel, 0.6, 0.2));
      B.rblock('std', -L / 4, 24, 0, L / 3, 12, W - 10, 2, '#2a2a2a', null, S(DET.fabric, 0.9, 0));
      B.box('std', -L / 4 - 8, 34, 0, 3, 16, W - 12, '#2a2a2a', null, STEEL);
      rod(B, 'std', [L / 2, 12, 0], [L / 2 + 30, 6, 0], 2, '#3a3a3a', STEEL, 5);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(B, sx * L * 0.3, sz * (W / 2 - 3), 7, 6, low);
      return true;
    }
    case 'kloader': {
      const along = o.w >= o.h, L = along ? o.w : o.h, W = along ? o.h : o.w;
      if (!along) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
      B.block('std', 0, 14, 0, L - 6, 12, W - 8, '#4a4e44', null, STEEL);
      B.block('std', -16, 46, 0, L - 40, 6, W, '#c8a020', null, PAINTED);
      for (let x = -L / 2 + 30; x < L / 2 - 50; x += 14) B.cylZ('std', x, 53, 0, 2.4, W - 10, '#3a3a3a', 6, STEEL);
      for (const s of [-1, 1]) rod(B, 'std', [-L / 4, 26, s * (W / 2 - 10)], [L / 4 - 20, 46, s * (W / 2 - 10)], 2.4, '#3a3a3a', STEEL, 5);
      B.rblock('std', L / 2 - 20, 26, 0, 34, 40, W - 20, 3, '#c8a020', null, PAINTED);
      B.box('glass', L / 2 - 2.5, 54, 0, 1, 14, W - 28, '#141c22');
      for (const x of [-L / 2 + 26, L / 2 - 26]) for (const s of [-1, 1]) wheel(B, x, s * (W / 2 - 6), 12, 10, low);
      pic(B, 'hazard', -16, 46, W / 2 + 0.4, 5, 0, { w: L - 44 });
      return true;
    }
    case 'reefer': {
      const L = o.w, W = o.h;
      B.rblock('std', -6, 24, 0, L - 20, 80, W - 4, 2, o.color || '#d8d8d4', null, S(DET.panel, 0.5, 0.3));
      B.rblock('std', L / 2 - 14, 60, 0, 14, 36, W - 20, 2, '#8a8e92', null, STEEL);
      for (let k = 0; k < 4; k++) B.box('std', L / 2 - 6.8, 66 + k * 7, 0, 0.6, 4, W - 26, '#3a3a3a', null, STEEL);
      for (const x of [-L / 2 + 30, -L / 2 + 60]) for (const s of [-1, 1]) wheel(B, x, s * (W / 2 - 6), 11, 9, low);
      for (const s of [-1, 1]) B.box('std', L / 2 - 40, 12, s * (W / 2 - 8), 3, 24, 3, '#3a3a3a', null, STEEL);
      for (const s of [-1, 1]) pic(B, 'quarantine', -10, 64, s * (W / 2 - 1.6), 18, s > 0 ? 0 : Math.PI, { w: 90 });
      // the rear doors ajar, a body bag on the floor before them
      B.add('std', T.box(), [-L / 2 + 2, 64, W / 4 + 6], [2, 76, W / 2 - 2], [0, 0.5, 0], o.color || '#d8d8d4', STEEL);
      B.add('std', T.pillow(10, 6, 0.4), [-L / 2 - 30, 5, 0], [20, 6, 40], [0, 0.3, 0], '#1e2224', S(DET.plastic, 0.35, 0));
      return true;
    }
    default: return false;
  }
}

void COL;

// ---- the failed drop ------------------------------------------------------------------------------------------

/**
 * A burnt-out four-engine transport past the runway's end (a mark, art only: it lies beyond the playable
 * map): the fuselage broken in three, the tail standing on its ramp, a wing torn off, engines thrown
 * clear, a field of scorched ground, embers still glowing.
 */
export function planeWreck(P, m) {
  const { B, gy, halos, tier } = P;
  const seg = tier === 'low' ? 10 : 18;
  const col = '#2a2a26', colL = '#46463f';
  at(B, gy, m.x, m.y, 0, m.a || 0, 8501);
  B.add('std', T.cyl(18, 1), [0, 0.6, 0], [620, 1, 300], null, '#121210', BURNT);
  // the forward fuselage on its belly, nose crushed, the flight deck's windows gone dark
  B.add('std', T.lathe('c3wreckfwd', [[0, 0], [24, 10], [44, 34], [58, 80], [62, 130], [62, 440]], seg), [-620, 64, 0], [1, 1, 1], [0.06, 0, -HALF - 0.05], col, BURNT);
  B.cylX('std', -180, 60, 6, 58, 8, '#141412', seg, BURNT);
  // the centre box broken off and turned across, the torn wing root and the left wing on the ground
  B.add('std', T.cyl(seg, 1), [-40, 62, 70], [62, 260, 62], [0.12, 0.45, -HALF], col, BURNT);
  B.add('std', T.profile('c3wreckwing', [[-70, 0], [40, 0], [10, 520], [-60, 520]], 0, 1), [-30, 118, 90], [1, 1, 10], [HALF, 0, 0], colL, BURNT);
  B.add('std', T.profile('c3wreckwing2', [[-60, 0], [30, 0], [0, 380], [-50, 380]], 0, 1), [-90, 14, -150], [1, 1, 9], [HALF - 0.06, 0.5, 0], col, BURNT);
  // the tail section standing on its ramp, fin up against the sky
  B.add('std', T.lathe('c3wrecktail', [[62, 0], [54, 90], [38, 190], [18, 270]], seg), [190, 66, 120], [1, 1, 1], [0, 0.55, -HALF + 0.3], colL, BURNT);
  B.add('std', T.profile('c3wreckfin', [[-80, 0], [80, 0], [110, 230], [50, 230]], 0, 1), [360, 170, 220], [1, 1, 8], [0, 0.55, 0.12], colL, BURNT);
  pic(B, 'tail', 360, 300, 226, 14, 0.55, { w: 90, color: '#8a8a80' });
  // engines thrown clear, a propeller blade standing in the dirt, debris
  for (const [x, z, ry] of [[-260, -260, 0.4], [80, -330, 1.9], [-420, 210, 2.6]]) {
    B.add('std', T.cyl(seg, 0.8), [x, 18, z], [20, 120, 20], [0.1, ry, HALF], '#1e1e1c', BURNT);
    B.add('std', T.box(), [x + 40, 30, z + 20], [3, 80, 12], [0.3, ry, 0.2], '#1a1a1a', STEEL);
  }
  for (let k = 0; k < 14; k++) {
    const a = hash01(k * 7 + 3) * Math.PI * 2, d = 200 + hash01(k * 11) * 260;
    B.add('std', T.box(), [Math.cos(a) * d, 3, Math.sin(a) * d * 0.6], [20 + hash01(k) * 40, 3, 10 + hash01(k + 1) * 30], [hash01(k + 2) * 0.4, a, 0], k % 3 ? '#2a2a26' : '#5a5e62', BURNT);
  }
  // embers in the wreck (fires burn at the map's edge; these glow beyond it)
  for (const [x, y, z] of [[-200, 40, 10], [-40, 70, 90], [180, 50, 130]]) lampGlow(B, halos, x, y, z, ...toWorld(m, x, z), '#ff7a2a', { size: [8, 4, 8], k: 5, halo: 160, strength: 0.7, flicker: 0.8, y0: 0, shape: 'sphere' });
}

