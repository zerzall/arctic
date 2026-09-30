// Cinematic-tier detail for the obstacle props of world-props.js (WORLD): real corrugated steel
// on shipping containers with door hinges, handles, seams and forklift pockets, dumpsters with
// ribs, lid hinges, handles and wheels, jersey barriers with joint loops, cracks and exposed
// rebar, sandbags with tied ends and seams, guard rails with splice plates and bolt heads,
// fences with post caps, bands, barbed wire and nail heads, fuel pumps with keypads, screens and
// nozzle holsters, lamp bases with anchor nuts and a hand-hole, road signs with bolts and channel
// rails, treaded tyres with a rim dish, and real rocks (a noisy subdivided icosphere with ridged
// crevices instead of a dodecahedron). Everything goes through the same geo builder buckets, so
// a map's props stay a handful of draw calls; the level-2 code paths do not call this file.

import * as THREE from 'three';
import { T, shadeHex } from './world-geo.js';
import { DET } from './world-surf.js';

const DOME = () => T.custom('pdome', () => new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2));
const lowCyl = (seg) => T.custom('plowcyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1));
const RUSTY = [DET.rust, 0.6, 0.7];
const rot = { up: [0, 0, 0], px: [0, 0, -Math.PI / 2], nx: [0, 0, Math.PI / 2], pz: [Math.PI / 2, 0, 0], nz: [-Math.PI / 2, 0, 0] };

/** A domed bolt / rivet head at (x, y, z) pointing along one of up, px, nx, pz, nz. */
export function bolt(B, x, y, z, dir = 'up', r = 0.5, color = '#6a6d70', rough = 0.45) {
  B.add('std', DOME(), [x, y, z], [r, r, r], rot[dir], color, { surf: [0, rough, 0.8], noAO: true, noJitter: true });
}

// ---- rocks ----------------------------------------------------------------------------------------

function hash3(x, y, z, s) {
  let h = Math.imul((x * 1013) | 0, 73856093) ^ Math.imul((y * 1009) | 0, 19349663) ^ Math.imul((z * 1021) | 0, 83492791) ^ Math.imul(s + 1, 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth 3-D value noise, -1..1. */
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d, s) * 2 - 1;
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * u, x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * u;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * u, x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/**
 * A rock template: an icosphere pushed by three octaves of noise, the crevices ridged, the top
 * flattened a little and the base slabbed off; flat-shaded facets with detail 5 (720 faces).
 */
export function rockTemplate(seed, detail = 5) {
  return T.custom(`rock${seed}:${detail}`, () => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    const seedI = seed * 7919;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      const n1 = vnoise(x * 1.6 + seed, y * 1.6, z * 1.6, seedI);
      const n2 = vnoise(x * 3.7, y * 3.7 + seed, z * 3.7, seedI + 5);
      const n3 = vnoise(x * 8.2, y * 8.2, z * 8.2 + seed, seedI + 9);
      const ridge = 1 - Math.abs(vnoise(x * 2.6 + 3, y * 2.6, z * 2.6 + seed, seedI + 2));
      let rad = 1 + 0.26 * n1 + 0.13 * n2 + 0.05 * n3 - 0.12 * ridge * ridge;
      // strata: the surface steps in layers up the rock
      rad += 0.03 * Math.sin(y * 9 + n1 * 3);
      if (y < -0.45) { y = -0.45 - (-0.45 - y) * 0.15; }        // the flat bed
      if (y > 0.6) y = 0.6 + (y - 0.6) * 0.7;
      p.setXYZ(i, x * rad, y * rad, z * rad);
    }
    g.deleteAttribute('normal');
    g.computeVertexNormals();      // (non-indexed: flat facets)
    return g;
  });
}

/** Two boulders: the big rock and a leaning second, with a chip pile. */
export function cinRock(B, L, W, color, H) {
  const r = B.rng;
  const s1 = Math.floor(r.next() * 4);
  B.add('std', rockTemplate(s1), [0, H * 0.34, 0], [L * 0.54, H * 0.7, W * 0.54], [0, r.range(0, 6), 0], color, { surf: [DET.rock, 0.82, 0] });
  B.add('std', rockTemplate((s1 + 1) % 4), [L * 0.28, H * 0.14, W * 0.2], [L * 0.24, H * 0.34, W * 0.26], [0.2, r.range(0, 6), 0.1], shadeHex(color, -0.08), { surf: [DET.rock, 0.82, 0] });
  B.add('std', rockTemplate((s1 + 2) % 4, 3), [-L * 0.32, H * 0.08, -W * 0.28], [L * 0.16, H * 0.2, W * 0.16], [0.3, r.range(0, 6), 0], shadeHex(color, 0.06), { surf: [DET.rock, 0.82, 0] });
  for (let k = 0; k < 5; k++) {
    const a = r.range(0, 6.28), d = r.range(0.55, 0.85);
    const sz = r.range(1.4, 3.4);
    B.add('std', rockTemplate((s1 + k) % 4, 1),[Math.cos(a) * L * d * 0.5, sz * 0.3, Math.sin(a) * W * d * 0.5], [sz * 1.3, sz, sz * 1.1], [r.range(0, 1), r.range(0, 6), 0], shadeHex(color, r.range(-0.12, 0.1)), { surf: [DET.rock, 0.85, 0] });
  }
}

// ---- containers -----------------------------------------------------------------------------------

/** A corrugated wall panel: trapezoid waves along u, extruded up, sunk into the box behind it. */
function corrugation(L, pitch = 7) {
  const n = Math.max(2, Math.floor(L / pitch));
  const p = L / n;
  return T.profile(`corr${n}:${p.toFixed(2)}`, (() => {
    const pts = [[-L / 2, -0.6]];
    for (let i = 0; i < n; i++) {
      const u = -L / 2 + i * p;
      pts.push([u, 0], [u + p * 0.16, 0], [u + p * 0.3, 1.25], [u + p * 0.64, 1.25], [u + p * 0.78, 0]);
    }
    pts.push([L / 2, 0], [L / 2, -0.6]);
    return pts;
  })());
}

/** The container's long walls as real corrugated steel, the roof ribs, and the door end's hardware. */
export function cinContainer(B, L, W, H, color, r) {
  const wallL = L - 12;
  const geo = corrugation(wallL);
  const paint = { surf: [DET.rust, 0.55, 0.55] };
  for (const sd of [-1, 1]) {
    // rotating the extrusion axis onto y: (u, v, t) -> (u, t, -v) for -x rotation, (u, -t, v) for +x
    B.add('std', geo, [0, H / 2, sd * (W / 2 + 0.2)], [1, 1, H - 12], [sd < 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0], shadeHex(color, -0.04), paint);
  }
  // roof ribs across the width
  for (let x = -L / 2 + 14; x < L / 2 - 8; x += 13) B.box('std', x, H + 2.1, 0, 3.4, 0.9, W - 8, shadeHex(color, -0.12), null, { surf: RUSTY, noAO: true });
  // fork pockets under the flanks and the corner casting eyes
  for (const sd of [-1, 1]) for (const x of [-0.16, 0.16]) B.box('std', x * L, 3, sd * (W / 2 + 0.55), 20, 4, 0.6, '#0b0b0a', null, { surf: [0, 0.9, 0], noAO: true });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (const y of [2.6, H - 2.4]) {
      B.box('std', (sx * (L - 4)) / 2 + sx * 2.7, y, (sz * (W - 4)) / 2, 0.4, 2.2, 3.4, '#050505', null, { surf: [0, 0.9, 0], noAO: true });
      B.box('std', (sx * (L - 4)) / 2, y, (sz * (W - 4)) / 2 + sz * 2.7, 3.4, 2.2, 0.4, '#050505', null, { surf: [0, 0.9, 0], noAO: true });
    }
  }
  // the doors: centre seam, gaskets, hinges, cam handles and their keepers
  for (const s of [-1, 1]) {
    const x = s * (L / 2 + 1.1);
    B.box('std', x, H / 2, 0, 0.4, H - 8, 0.7, '#0e0e0d', null, { surf: [0, 0.9, 0], noAO: true });
    for (const z of [-0.45, 0.45]) B.box('std', x, H / 2, z * W * 0.5, 0.35, H - 8, 0.5, '#141413', null, { surf: [0, 0.9, 0], noAO: true });
    for (const y of [14, H / 2, H - 14]) for (const z of [-1, 1]) B.cyl('std', s * (L / 2 + 1.2), y - 2.5, z * (W / 2 - 3.5), 1.05, 5, '#3a3d40', 6, 1, null, { surf: RUSTY, noAO: true });
    for (const z of [-0.3, -0.12, 0.12, 0.3]) {
      B.box('std', s * (L / 2 + 2.3), H * 0.42, z * W, 0.9, 9, 1.3, '#8a8e92', [0, 0, 0.0], { surf: [DET.rust, 0.4, 0.85], noAO: true });   // the cam handle
      B.box('std', s * (L / 2 + 2.3), 8, z * W, 1, 2.6, 2.6, '#6a6e72', null, { surf: RUSTY, noAO: true });
      B.box('std', s * (L / 2 + 2.3), H - 10, z * W, 1, 2.6, 2.6, '#6a6e72', null, { surf: RUSTY, noAO: true });
    }
    B.box('std', s * (L / 2 + 1.7), 24, W * 0.42, 1.2, 6, 4.2, '#7a7e82', null, { surf: RUSTY, noAO: true });   // the lock box
    B.add('std', T.torus(8, 0.16, 4), [s * (L / 2 + 2.5), 23, W * 0.42], [1.7, 1.7, 1.7], [0, Math.PI / 2, 0], '#b8bcc0', { surf: [0, 0.3, 0.95], noAO: true });   // the padlock shackle
  }
}

/** A dumpster: ribs, rim, lid hinges and handles, fork tubes and casters. */
export function cinDumpster(B, L, W, color, r) {
  const F = { surf: [DET.rust, 0.7, 0.4] };
  const dark = shadeHex(color, -0.16);
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = -L / 2 + (i + 0.5) * (L / 6);
      const top = 50 - ((x + L / 2) / L) * 4.5 - 4;
      B.rbox('std', x, 4 + (top - 4) / 2, sd * (W / 2 + 0.6), 2.6, top - 4, 1.4, 0.5, dark, null, { ...F, noAO: true });
    }
    B.box('std', 0, 6, sd * (W / 2 + 0.6), L, 2.4, 1.4, dark, null, { ...F, noAO: true });
    B.rbox('std', 0, 46.5, sd * (W / 2 + 0.6), L + 1, 3.6, 1.6, 0.6, dark, [0, 0, -0.09], { ...F, noAO: true });
  }
  // the split plastic lids: a dark seam, hinge barrel at the back, a pull handle at the front
  B.box('std', 0, 54.2, 0, L + 1, 0.4, 0.8, '#0c0c0c', null, { surf: [0, 0.9, 0], noAO: true });
  B.cylZ('std', -L / 2 - 0.6, 53.4, 0, 1.3, W * 0.9, '#2c2e30', 8, { surf: RUSTY, noAO: true });
  for (const z of [-W * 0.25, W * 0.25]) B.rbox('std', L / 2 + 0.8, 52.4, z, 2.4, 1.4, 9, 0.5, shadeHex(color, -0.4), null, { surf: [DET.plastic, 0.5, 0], noAO: true });
  // fork tubes through the base and two small casters
  for (const x of [-0.3, 0.3]) B.cylZ('std', x * L, 9, 0, 1.9, W + 4, '#26282a', 8, { surf: RUSTY, noAO: true });
  for (const sd of [-1, 1]) {
    B.cylZ('std', -L * 0.4, 2.6, sd * (W * 0.38), 2.6, 1.8, '#101012', 10, { surf: [DET.rubber, 0.8, 0], noAO: true });
    B.box('std', -L * 0.4, 5.4, sd * (W * 0.38), 2, 3, 2.6, '#3a3d40', null, { surf: RUSTY, noAO: true });
  }
  for (let k = 0; k < 4; k++) {
    if (!r.chance(0.7)) continue;
    const a = r.range(0, 6.28);
    B.add('std', lowCyl(8), [L / 2 + 6 + r.range(0, 9), 2.6, r.range(-W / 2, W / 2)], [1.6, 4.6, 1.6], [0, a, Math.PI / 2], r.pick(['#c0c4c8', '#b81c1c', '#2a6ab0', '#c8a020']), { surf: [DET.panel, 0.3, 0.85], noAO: true });
  }
}

// ---- barriers -------------------------------------------------------------------------------------

/** Jersey barrier segment extras: joint loops, cracks, exposed rebar, the chipped foot. */
export function cinJersey(B, x, seg, W, r) {
  for (const sd of [-1, 1]) B.add('std', T.torus(10, 0.22, 4), [x + seg / 2, 22, sd * W * 0.12], [2.6, 2.6, 2.6], [0, Math.PI / 2, 0], '#5a5c5e', { surf: RUSTY, noAO: true });
  for (let k = 0; k < 2; k++) {
    const sd = r.chance(0.5) ? -1 : 1;
    B.box('std', x + r.range(-seg * 0.35, seg * 0.35), 14 + r.range(-4, 5), sd * (W * 0.17 + 0.5), 0.3, r.range(8, 16), 0.4, '#25241f', [0, 0, r.range(-0.7, 0.7)], { surf: [0, 0.95, 0], noAO: true, noJitter: true });
  }
  if (r.chance(0.3)) {
    for (let k = 0; k < 3; k++) B.add('std', lowCyl(5), [x + r.range(-seg * 0.3, seg * 0.3), 27, r.range(-W * 0.08, W * 0.08)], [0.5, r.range(4, 9), 0.5], [r.range(-0.5, 0.5), 0, r.range(-0.6, 0.6)], '#6a4a38', { surf: [DET.rust, 0.7, 0.8], noAO: true });
    B.add('std', rockTemplate(1, 2), [x + r.range(-4, 4), 1.2, W * 0.5], [2.6, 1.6, 2.2], [0, r.range(0, 6), 0], '#8a877e', { surf: [DET.concrete, 0.9, 0] });
  }
}

/** Sandbag extras: the tied end, a seam ridge along the top. */
export function cinSandbag(B, x, y, z, bagL, bagH, depth, ang, color, r) {
  B.box('std', x, y + bagH * 0.55, z, bagL * 0.78, 0.5, 0.7, shadeHex(color, -0.16), [0, ang, 0], { surf: [DET.fabric, 0.95, 0], noAO: true });
  if (r.chance(0.5)) {
    const sd = r.chance(0.5) ? 1 : -1;
    B.add('std', T.cyl(6, 0), [x + Math.cos(ang) * sd * (bagL * 0.5 + 0.6), y + 0.2, z - Math.sin(ang) * sd * (bagL * 0.5 + 0.6)], [1.3, 2.6, 1.3], [0, ang, -sd * Math.PI / 2], shadeHex(color, -0.1), { surf: [DET.fabric, 0.95, 0], noAO: true });
  }
}

/** Guard rail: bolt heads, splice plates every other post, terminal caps. */
export function cinGuardrail(B, xs, L, W) {
  const zf = W * 0.18;
  xs.forEach((x, i) => {
    bolt(B, x, 16, zf - 0.5, 'nz', 0.7, '#4a4e52');
    bolt(B, x, 16, zf + 0.3, 'pz', 0.7, '#4a4e52');
    B.box('std', x, 20.6, -1, 3.6, 0.6, 3, '#4e5458', null, { surf: RUSTY, noAO: true });   // the post cap
    B.box('std', x, 0.6, -1, 6, 0.5, 6, '#40454a', null, { surf: RUSTY, noAO: true });      // the ground plate
    if (i % 2 === 1 && i < xs.length - 1) {
      const sx = x + (xs[i + 1] - x) * 0.5;
      B.box('std', sx, 16, zf - 1.2, 6, 8.6, 0.35, '#7a8084', null, { surf: RUSTY, noAO: true });
      for (let k = -2; k <= 2; k += 2) for (const j of [-1, 1]) bolt(B, sx + k * 1.15, 16 + j * 2.6, zf - 1.38, 'nz', 0.35, '#3e4246');
    }
  });
  for (const x of [xs[0], xs[xs.length - 1]]) B.cylX('std', x + (x < 0 ? -1.2 : 1.2), 16, zf - 0.3, 1.2, 2.4, '#5a6064', 8, { surf: RUSTY, noAO: true });
}

/** Chain-link and wood fence extras. */
export function cinFence(B, L, wood, xs, r, color) {
  if (wood) {
    for (const x of xs) {
      for (const y of [13, 25, 36]) {
        bolt(B, x, y, 3.2, 'pz', 0.45, '#5a5d5f');
        bolt(B, x, y, -2.5, 'nz', 0.45, '#5a5d5f');
      }
    }
    for (let x = -L / 2 + 3; x < L / 2; x += 6.5) for (const y of [13, 25, 36]) if (r.chance(0.7)) bolt(B, x, y, 4.1, 'pz', 0.32, '#4a4c4e');
    return;
  }
  const S = { surf: [DET.rust, 0.45, 0.9], noAO: true };
  for (const x of xs) {
    B.add('std', T.sphere(8, 5), [x, 43, 0], [2.1, 2.1, 2.1], null, '#8c9296', S);
    for (const y of [10, 22, 34]) B.cyl('std', x, y, 0, 1.95, 1.2, '#9aa0a4', 8, 1, null, S);
  }
  if (r.chance(0.6)) {
    // barbed wire on the top: three strands and their barbs
    for (const y of [44.5, 46.2, 47.9]) B.cylX('std', 0, y, 0, 0.22, L, '#5a5e60', 5, S);
    for (let x = -L / 2 + 3; x < L / 2; x += 5) for (const y of [44.5, 46.2, 47.9]) B.add('std', T.cyl(4, 0), [x, y, 0.5], [0.4, 1.4, 0.4], [0, 0, 1.2 * (x % 10 < 5 ? 1 : -1)], '#5a5e60', S);
    for (const x of xs) B.box('std', x, 45, 0, 1.1, 5.4, 1.1, '#8c9296', null, S);
  }
  B.cylX('std', 0, 1.3, 0, 0.35, L, '#7a7e82', 5, S);
}

// ---- forecourt / lamps / signs ---------------------------------------------------------------------

/** Fuel pump: screen bezels, keypad, grade buttons, card reader, nozzle holsters. */
export function cinPump(B, L, W) {
  const dark = '#141516';
  for (const s of [-1, 1]) {
    const x = s * (L * 0.36 + 0.35);
    // the display's frame (the lit plane sits inside it)
    const dw = W * 0.42;
    for (const dy of [-5.4, 5.4]) B.box('std', x, 37 + dy, 0, 0.8, 0.9, dw + 1.8, dark, null, { surf: [DET.plastic, 0.4, 0.1], noAO: true });
    for (const dz of [-1, 1]) B.box('std', x, 37, dz * (dw / 2 + 0.45), 0.8, 11.4, 0.9, dark, null, { surf: [DET.plastic, 0.4, 0.1], noAO: true });
    // keypad, grade buttons and the card reader on the left half of the face
    for (let i = 0; i < 12; i++) B.box('std', s * (L * 0.36 + 0.2), 27 - Math.floor(i / 3) * 2.2, -W * 0.3 + (i % 3) * 2.4, 0.4, 1.5, 2, '#8a8e92', null, { surf: [DET.plastic, 0.4, 0.3], noAO: true });
    for (let k = 0; k < 3; k++) B.box('std', s * (L * 0.36 + 0.25), 15, -W * 0.3 + k * 5.4, 0.5, 2.6, 4, ['#2a8a3a', '#2a5ac4', '#c8281e'][k], null, { surf: [DET.plastic, 0.4, 0.1], noAO: true });
    B.box('std', s * (L * 0.36 + 0.3), 11, -W * 0.1, 0.6, 2.2, 6.4, '#0a0a0a', null, { surf: [0, 0.6, 0.2], noAO: true });
  }
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bolt(B, x * (L / 2 + 3.4), 6, z * (W / 2 + 5), 'up', 0.8, '#7a7e82');
}

/** A street lamp's base plate nuts and hand-hole. */
export function cinLampBase(B, px, H) {
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bolt(B, px + x * 3.0, 5, z * 3.0, 'up', 0.55, '#9aa0a4');
  B.box('std', px + 2.5, 32, 0, 0.5, 14, 3.2, '#5a5e62', null, { surf: [DET.panel, 0.45, 0.6], noAO: true });
  for (const y of [26, 38]) bolt(B, px + 3.0, y, 0, 'px', 0.5, '#9aa0a4');
  B.cyl('std', px, H * 0.5, 0, 3.0, 1.2, '#6e757b', 10, 1.05, null, { surf: [DET.panel, 0.48, 0.6], noAO: true });   // the joint band
}

/** A road sign's channel rails, corner bolts and post clamps. */
export function cinSign(B, w, h, y, zBack, xs) {
  for (const x of xs) B.box('std', x, y, zBack - 0.5, 1.6, h + 2, 0.9, '#6c7074', null, { surf: RUSTY, noAO: true });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bolt(B, sx * (w / 2 - 1.2), y + sy * (h / 2 - 1.2), zBack + 1.4, 'pz', 0.35, '#9aa0a4');
  for (const x of xs) for (const yy of [y - h * 0.3, y + h * 0.3]) B.box('std', x, yy, zBack - 1.2, 2.6, 1.4, 1.2, '#7a7e82', null, { surf: RUSTY, noAO: true });
}

// ---- tyres ------------------------------------------------------------------------------------------

const TYRE = (() => {
  const half = [[0.6, -0.5], [0.8, -0.5], [0.9, -0.49], [0.965, -0.44], [0.995, -0.36], [1.0, -0.26], [1.0, -0.17], [0.955, -0.15], [1.0, -0.13], [1.0, -0.01]];
  const pts = half.map(([r, y]) => [r, y]);
  for (let i = half.length - 2; i >= 0; i--) pts.push([half[i][0], -half[i][1]]);
  return pts;
})();
const RIM = [[0.64, -0.28], [0.64, 0.24], [0.6, 0.3], [0.56, 0.3], [0.52, 0.22], [0.34, 0.18], [0.3, 0.26], [0.16, 0.26], [0.13, 0.3], [0.0, 0.3]];

/** A tyre with grooved tread, a lettering band and a rim dish showing through the hole. */
const lathe = (key, pts, seg) => T.custom(key + seg, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));
export function cinTyre(B, pos, sc, rota) {
  B.add('std', lathe('tyrec', TYRE, 28), pos, sc, rota, '#1b1b1c', { surf: [DET.rubber, 0.85, 0], map: 'cyl' });
  B.add('std', lathe('rimc', RIM, 20), pos, sc, rota, '#7c8288', { surf: [DET.rust, 0.5, 0.8], map: 'cyl' });
}

// ---- rubble ------------------------------------------------------------------------------------------

/** A concrete chunk / brick as a rock template instead of a bare dodecahedron. */
export function chunk(k) { return rockTemplate(k % 4, 2); }

