// Vegetation of the static world (WORLD, SPEC §7.5).
//   - Trees: bark trunks with limbs, canopies of alpha-tested leaf-cluster cards arranged
//     in jittered clumps (broadleaf) or drooping bough layers (pine) around a dark inner
//     volume, with normals pointing out of the crown so it shades like foliage, not like
//     a pile of paper.
//   - Bushes: small clumps of scrub cards.
//   - The tree line past the map bounds (cheaper cards, merged per side).
//   - A grass field: ONE instanced draw call of blade tufts laid out on a grid that
//     follows the camera; the vertex shader places each tuft from a hash of its world
//     cell (so nothing swims), reads the ground's surface mask to grow only on grass (a
//     few weeds on loose ground, none on roads, in water or under obstacles), sways it
//     in the wind and fades it out with distance. No CPU work per frame.

import * as THREE from 'three';
import { T, shadeHex, hash01, seededRng, lin } from './world-geo.js';
import { DET } from './world-surf.js';
import { LEAF_CELLS } from './world-tex.js';

const LEAF = ['#2a4a26', '#31502a', '#3a5a2c', '#2c4628', '#40582e'];
const PINE = ['#1f3a26', '#24402a', '#2a4630', '#1d3624'];
const BARK = '#4a3a2a';

// ---- card helpers -------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

/** Accumulates leaf cards (quads) with crown-radial normals. */
function cardList() {
  return { pos: [], nor: [], uv: [] };
}

/**
 * One card: centre c, facing direction f (unit), up-ish vector spin, size w×h, crown centre
 * `cc` (normals are blended toward c - cc), atlas rect uv.
 */
function card(list, c, f, spin, w, h, cc, rect, bend = 0) {
  _q.setFromUnitVectors(_z, f);
  const rot = new THREE.Quaternion().setFromAxisAngle(_z, spin);
  _q.multiply(rot);
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const P = corners.map(([x, y]) => {
    _v.set(x * w, y * h, (x * x + y * y) * bend).applyQuaternion(_q);
    return [c[0] + _v.x, c[1] + _v.y, c[2] + _v.z];
  });
  const N = P.map((p) => {
    _n.set(p[0] - cc[0], (p[1] - cc[1]) * 0.8 + 0.25 * Math.abs(cc[1]) * 0.01, p[2] - cc[2]).normalize();
    _v.copy(f).multiplyScalar(0.35);
    _n.multiplyScalar(0.65).add(_v).normalize();
    return [_n.x, _n.y, _n.z];
  });
  const [u0, v0, u1, v1] = rect;
  const U = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (const k of [0, 1, 2, 0, 2, 3]) {
    list.pos.push(...P[k]);
    list.nor.push(...N[k]);
    list.uv.push(...U[k]);
  }
}

function listGeo(list) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(list.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(list.uv, 2));
  return g;
}

const randDir = (r) => {
  const u = r.next() * 2 - 1, a = r.next() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(Math.cos(a) * s, u, Math.sin(a) * s);
};

// ---- trees -----------------------------------------------------------------------------------

/** Trunk with root flare and a few limbs (the 'tree' obstacle: w = trunk size). */
export function trunk(B, size, o) {
  const r = B.rng;
  const rad = size * 0.28;
  const col = o.color || BARK;
  B.cyl('std', 0, 0, 0, rad, 104, col, 9, 0.55, null, { wobble: { amp: 0.07, seed: o.id }, surf: [DET.bark, 0.85, 0] });
  B.cyl('std', 0, 0, 0, rad * 1.45, 9, shadeHex(col, -0.15), 9, 0.68, null, { surf: [DET.bark, 0.9, 0] });
  // limbs fork upward into the crown (they stay inside it: no bare sticks poking out)
  for (let i = 0; i < 4; i++) {
    const a = r.range(0, 6.28) + i * 1.6;
    const y = 96 + i * 10;
    const tilt = 0.55 + r.range(0, 0.2);
    B.add('std', T.cyl(7, 0.25), [Math.cos(a) * (rad * 0.6 + 9), y + 14, Math.sin(a) * (rad * 0.6 + 9)], [rad * 0.3, 34 - i * 3, rad * 0.3], [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt], col, { surf: [DET.bark, 0.85, 0], map: 'cyl' });
  }
}

/** Canopy for a 'tree_canopy' decor (centred on the trunk). Pines 40% of the time. */
export function canopy(B, d, i) {
  const R = 44 * (d.s || 1);
  const r = seededRng(i * 7919 + 17);
  const pine = hash01(i * 7 + 3) < 0.4;
  const cards = cardList();
  if (pine) {
    const top = 200 + R * 1.4;
    const col = r.pick(PINE);
    const layers = 7;
    B.cyl('std', 0, 60, 0, R * 0.55, top - 70, shadeHex(col, -0.45), 8, 0.05, null, { surf: [DET.bark, 0.95, 0], noAO: true });
    for (let k = 0; k < layers; k++) {
      const t = k / (layers - 1);
      const y = 70 + t * (top - 95);
      const rad = R * (1.15 - t * 0.9);
      const n = Math.max(5, Math.round(12 - t * 6));
      for (let m = 0; m < n; m++) {
        const a = (m / n) * Math.PI * 2 + r.range(-0.25, 0.25) + k * 0.7;
        const out = rad * r.range(0.45, 0.7);
        const c = [Math.cos(a) * out, y - rad * 0.15, Math.sin(a) * out];
        // boughs droop: the card faces up and out
        const f = new THREE.Vector3(Math.cos(a) * 0.55, 0.8, Math.sin(a) * 0.55).normalize();
        card(cards, c, f, a + Math.PI / 2 + r.range(-0.3, 0.3), rad * 1.15, rad * 0.8, [0, y + 10, 0], LEAF_CELLS.pine, -0.1);
      }
    }
    B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
    return;
  }
  const top = 160 + R * 1.3;
  const col = r.pick(LEAF);
  const cc = [0, top - R * 1.2, 0];
  // a small dark inner mass: the crown never reads as see-through paper
  B.add('std', T.ico(1), cc, [R * 0.55, R * 0.45, R * 0.55], [0, r.range(0, 3), 0], shadeHex(col, -0.4), { wobble: { amp: 0.25, seed: i }, surf: [DET.grass, 0.95, 0], noAO: true });
  // clumps spread wide and low: an irregular crown, not a ball on a stick
  const clumps = 7 + Math.floor(r.next() * 4);
  for (let k = 0; k < clumps; k++) {
    const dir = k === 0 ? new THREE.Vector3(0, 1, 0) : randDir(r);
    dir.y = dir.y * 0.55 - (k === 0 ? 0 : 0.08);
    const cr = R * (k === 0 ? 0.62 : r.range(0.45, 0.66));
    const ctr = [cc[0] + dir.x * R * 0.8, cc[1] + dir.y * R * 0.7, cc[2] + dir.z * R * 0.8];
    const n = 14 + Math.floor(r.next() * 6);
    for (let m = 0; m < n; m++) {
      const f = randDir(r);
      if (f.y < -0.4) f.y = -f.y * 0.5;
      const c = [ctr[0] + f.x * cr * 0.75, ctr[1] + f.y * cr * 0.65, ctr[2] + f.z * cr * 0.75];
      const sz = cr * r.range(1.1, 1.6);
      card(cards, c, f, r.range(0, 6.28), sz, sz, cc, r.chance(0.5) ? LEAF_CELLS.broadA : LEAF_CELLS.broadB, sz * 0.12);
    }
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
}

/** A bush: a few scrub clumps around a dark core. */
export function bush(B, d, i) {
  const s = d.s || 1;
  const R = 15 * s;
  const r = seededRng(i * 131 + 7);
  const col = r.pick(LEAF);
  const cards = cardList();
  B.add('std', T.ico(0), [0, R * 0.45, 0], [R * 0.7, R * 0.5, R * 0.7], [0, r.range(0, 6), 0], shadeHex(col, -0.5), { wobble: { amp: 0.2, seed: i }, surf: [DET.grass, 0.95, 0] });
  const cc = [0, R * 0.4, 0];
  const n = 10 + (i % 5);
  for (let m = 0; m < n; m++) {
    const f = randDir(r);
    if (f.y < 0) f.y = -f.y * 0.4;
    const c = [f.x * R * 0.6, R * 0.35 + f.y * R * 0.55, f.z * R * 0.6];
    const sz = R * r.range(0.9, 1.3);
    card(cards, c, f, r.range(0, 6.28), sz, sz, cc, LEAF_CELLS.scrub, sz * 0.1);
  }
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
}

// ---- tree line past the map bounds ---------------------------------------------------------------

/** Forest (or desert rocks and dead trees) around the map, merged into one strip per side. */
export function buildTreeLine(B, map, waters) {
  const W = map.width, H = map.height;
  const rng = seededRng((map.seed | 0) * 7 + 99);
  // keep road corridors open where roads leave the map
  const corridors = [];
  for (const a of map.areas) {
    if (a.kind !== 'asphalt' && a.kind !== 'concrete' && a.kind !== 'gravel') continue;
    const hw = a.w / 2, hh = a.h / 2;
    if (a.x - hw <= 2 || a.x + hw >= W - 2 || a.y - hh <= 2 || a.y + hh >= H - 2) {
      corridors.push({ x0: a.x - hw - 50, x1: a.x + hw + 50, y0: a.y - hh - 50, y1: a.y + hh + 50, ex: a.x - hw <= 2 || a.x + hw >= W - 2, ey: a.y - hh <= 2 || a.y + hh >= H - 2 });
    }
  }
  const blocked = (x, y) => {
    for (const c of corridors) {
      if (c.ex && y > c.y0 && y < c.y1) return true;
      if (c.ey && x > c.x0 && x < c.x1) return true;
    }
    for (const w of waters) if (x > w.x0 - 30 && x < w.x1 + 30 && y > w.y0 - 30 && y < w.y1 + 30) return true;
    return false;
  };
  const gc = lin(map.ground);
  const desert = gc.r > gc.g * 1.05;
  // one strip per side; a very long side is cut in chunks the fog culling can drop
  const chunk = W > 6000 ? 2600 : Infinity;
  const place = (x, y, dist) => {
    if (blocked(x, y)) return;
    B.setCell((y < 0 ? 'tl-n' : y > H ? 'tl-s' : x < 0 ? 'tl-w' : 'tl-e') + (y < 0 || y > H ? Math.floor((x + 1000) / chunk) : ''));
    B.obj(x, y, rng.range(0, 6.28), Math.floor(rng.next() * 1e6));
    B.setCell(null);
    if (desert) {
      const roll = rng.next();
      if (roll < 0.45 && dist > 200) {
        const big = dist > 450 ? rng.range(1.6, 3) : rng.range(0.6, 1.3);
        const rc = rng.pick(['#5e4a38', '#6b5642', '#54443a', '#735c44']);
        B.add('std', T.dodeca(), [0, 30 * big, 0], [70 * big, 70 * big * rng.range(0.6, 1.1), 55 * big], [0, rng.range(0, 6), 0], rc, { wobble: { amp: 0.3, seed: Math.floor(roll * 999) }, surf: [DET.rock, 0.85, 0] });
        B.add('std', T.dodeca(), [40 * big, 12 * big, 20 * big], [36 * big, 30 * big, 30 * big], [0.4, 1, 0], rc, { wobble: { amp: 0.3, seed: 5 }, surf: [DET.rock, 0.85, 0] });
      } else if (roll < 0.62) {
        const s = rng.range(0.8, 1.4);
        B.cyl('std', 0, 0, 0, 5 * s, 110 * s, '#3a2e24', 6, 0.4, null, { surf: [DET.bark, 0.9, 0] });
        for (let k = 0; k < 3; k++) {
          const a = rng.range(0, 6.28);
          B.add('std', T.cyl(4, 0.3), [Math.cos(a) * 8 * s, (60 + k * 16) * s, Math.sin(a) * 8 * s], [3 * s, 50 * s, 3 * s], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], '#3a2e24', { surf: [DET.bark, 0.9, 0], map: 'cyl' });
        }
      } else if (roll < 0.8) {
        B.add('std', T.ico(0), [0, 8, 0], [16, 10, 16], [0, rng.range(0, 6), 0], rng.pick(['#4a4a2a', '#5a5230', '#3e4426']), { wobble: { amp: 0.25, seed: 3 }, surf: [DET.grass, 0.95, 0] });
      }
      return;
    }
    const s = rng.range(0.8, 1.5);
    const col = rng.pick(PINE);
    const top = rng.range(220, 330) * s;
    B.cyl('std', 0, 0, 0, 5 * s, 70 * s, '#2a2118', 5, 0.7, null, { surf: [DET.bark, 0.9, 0] });
    B.cyl('std', 0, 40 * s, 0, 44 * s, top - 40 * s, shadeHex(col, -0.35), 7, 0.04, null, { surf: [DET.grass, 0.95, 0], noAO: true });
    // two rings of drooping bough cards over the cone: a ragged, needled silhouette
    const cards = cardList();
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      const y = 50 * s + t * (top - 90 * s);
      const rad = (58 - t * 36) * s;
      for (let m = 0; m < 5; m++) {
        const a = (m / 5) * Math.PI * 2 + k + rng.range(-0.3, 0.3);
        const f = new THREE.Vector3(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5).normalize();
        card(cards, [Math.cos(a) * rad * 0.55, y, Math.sin(a) * rad * 0.55], f, a + Math.PI / 2, rad * 1.2, rad * 0.9, [0, y + 20, 0], LEAF_CELLS.pine);
      }
    }
    B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  };
  const band = [60, 700];
  const step = 58;
  for (let x = -band[1]; x < W + band[1]; x += step) {
    for (const edge of [0, 1]) {
      for (let row = 0; row < 3; row++) {
        const dist = band[0] + row * 150 + rng.range(0, 150);
        const y = edge ? H + dist : -dist;
        place(x + rng.range(-20, 20), y, dist);
      }
    }
  }
  for (let y = 0; y < H; y += step) {
    for (const edge of [0, 1]) {
      for (let row = 0; row < 3; row++) {
        const dist = band[0] + row * 150 + rng.range(0, 150);
        place(edge ? W + dist : -dist, y + rng.range(-20, 20), dist);
      }
    }
  }
}

// ---- grass field -------------------------------------------------------------------------------

// height stays well under a crawler's back (~20): grass must never hide a zombie
const GRASS = {
  ultra: { grid: 180, cell: 4.6, height: 9.5, density: 0.95 },
  high: { grid: 128, cell: 6, height: 9.5, density: 0.9 },
};

function tuftGeometry(blades = 6) {
  const pos = [], nor = [], side = [];
  const r = seededRng(4242);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + r.range(-0.4, 0.4);
    const d = r.range(0.4, 2.2);
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const w = r.range(0.7, 1.2), h = r.range(0.65, 1.0);
    const lean = r.range(0.15, 0.45);
    const px = -Math.sin(a) * w * 0.5, pz = Math.cos(a) * w * 0.5;
    // triangle: two base corners, tip leaning outward
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean * 6, h, bz + Math.sin(a) * lean * 6);
    for (let k = 0; k < 3; k++) { nor.push(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3); side.push(k === 2 ? 1 : 0); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(side, 1));
  return g;
}

/**
 * The camera-following grass field (none on 'low').
 * @param {object} ground ground.js instance (mask)
 * @param {string} quality
 * @returns {{ mesh: THREE.Mesh|null, update(camera, dt), setQuality(q), dispose() }}
 */
export function createGrassField(scene, ground, quality) {
  const uniforms = {
    uMask: { value: ground.mask.texture },
    uMaskRect: { value: new THREE.Vector4(ground.mask.x0, ground.mask.y0, ground.mask.w, ground.mask.h) },
    uCenter: { value: new THREE.Vector2() },
    uCell: { value: 6 },
    uRadius: { value: 300 },
    uHeight: { value: 12 },
    uDensity: { value: 0.9 },
    uTime: { value: 0 },
    // campaign maps: the blades stand on the (first) hill: x, y, plateau radius, foot radius; its height
    uHill: { value: new THREE.Vector4(0, 0, 1, 2) },
    uHillH: { value: 0 },
  };
  const hill0 = ground.terrain && !ground.terrain.flat && ground.terrain.spec.hills && ground.terrain.spec.hills[0];
  if (hill0) {
    uniforms.uHill.value.set(hill0.x, hill0.y, hill0.plateau, hill0.r);
    uniforms.uHillH.value = hill0.h;
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uMask;
        uniform vec4 uMaskRect;
        uniform vec2 uCenter;
        uniform float uCell, uRadius, uHeight, uDensity, uTime;
        uniform vec4 uHill;
        uniform float uHillH;
        float hillEase(float u) { u = clamp(u, 0.0, 1.0); return u * u * u * (u * (u * 6.0 - 15.0) + 10.0); }
        float hillHeight(vec2 p) {
          if (uHillH <= 0.0) return 0.0;
          float d = distance(p, uHill.xy);
          return d <= uHill.z ? uHillH : d >= uHill.w ? 0.0 : uHillH * hillEase(1.0 - (d - uHill.z) / (uHill.w - uHill.z));
        }
        attribute vec2 iOff;
        attribute float aTip;
        varying vec3 vGrass;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = normalize(objectNormal);`)
      .replace('#include <begin_vertex>', `
        vec2 wc = uCenter + iOff;
        float h1 = gHash(wc), h2 = gHash(wc + 17.31), h3 = gHash(wc + 41.73), h4 = gHash(wc + 7.7);
        vec2 base = (wc + 0.1 + 0.8 * vec2(h1, h2)) * uCell;
        vec4 mk = textureLod(uMask, (base - uMaskRect.xy) / uMaskRect.zw, 0.0);
        float loose = max(0.0, 1.0 - mk.r - mk.g - mk.b);
        float lush = smoothstep(0.35, 0.8, mk.b);
        float dens = (lush + loose * 0.14) * smoothstep(0.7, 0.95, mk.a);
        float fade = smoothstep(uRadius, uRadius * 0.7, distance(base, cameraPosition.xz));
        float s = step(h3, dens * uDensity) * fade * (0.65 + 0.7 * h4) * (0.55 + 0.45 * lush);
        float ang = h1 * 6.2831;
        float ca = cos(ang), sa = sin(ang);
        vec3 transformed = position;
        transformed.xz = mat2(ca, -sa, sa, ca) * transformed.xz * (0.8 + 0.5 * h2);
        transformed.y *= uHeight * s;
        transformed.xz *= step(0.001, s);
        // wind: the tips sway, gusts roll across the field
        float gust = sin(uTime * 0.7 + base.x * 0.006 + base.y * 0.004) * 0.5 + 0.5;
        float sway = sin(uTime * 2.1 + base.x * 0.05 + base.y * 0.037) * (0.6 + gust * 1.6);
        transformed.x += aTip * sway * s * 1.4;
        transformed.z += aTip * sway * s * 0.7;
        transformed.xz += base;
        transformed.y += hillHeight(base) * step(0.001, s);
        // colour: green on grass, straw on loose ground, lighter tips
        vec3 gcol = mix(vec3(0.05, 0.085, 0.03), vec3(0.11, 0.1, 0.05), 1.0 - lush);
        gcol *= 0.75 + 0.5 * h2;
        vGrass = mix(gcol * 0.45, gcol * 1.35, aTip);`)
      .replace('#include <fog_vertex>', '#include <fog_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrass;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vGrass;');
  };
  mat.customProgramCacheKey = () => 'hh-grass-v1';
  let mesh = null;
  let geo = null;
  let tier = null;
  let time = 0;

  function build(q) {
    const t = q === 'ultra' ? 'ultra' : q === 'low' ? 'low' : 'high';
    if (t === tier) return;
    tier = t;
    if (mesh) { scene.remove(mesh); geo.dispose(); mesh = null; geo = null; }
    const cfg = GRASS[t];
    if (!cfg) return;
    geo = tuftGeometry(6);
    const G = cfg.grid;
    const off = new Float32Array(G * G * 2);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { off[(j * G + i) * 2] = i - G / 2; off[(j * G + i) * 2 + 1] = j - G / 2; }
    geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(off, 2));
    geo.instanceCount = G * G;
    uniforms.uCell.value = cfg.cell;
    uniforms.uHeight.value = cfg.height;
    uniforms.uDensity.value = cfg.density;
    // the grid is pushed ahead of the camera (see update): cover the fade radius in front
    uniforms.uRadius.value = (G * cfg.cell) / 2 / 1.3;
    mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'grass';
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }
  build(quality);
  const _f = new THREE.Vector3();
  return {
    get mesh() { return mesh; },
    get instances() { return mesh ? geo.instanceCount : 0; },
    update(camera, dt) {
      if (!mesh) return;
      time += dt;
      uniforms.uTime.value = time % 1000;
      camera.getWorldDirection(_f);
      const lead = uniforms.uRadius.value * 0.3;
      const l = Math.hypot(_f.x, _f.z) || 1;
      const cx = camera.position.x + (_f.x / l) * lead, cz = camera.position.z + (_f.z / l) * lead;
      uniforms.uCenter.value.set(Math.floor(cx / uniforms.uCell.value), Math.floor(cz / uniforms.uCell.value));
    },
    setQuality: build,
    dispose() {
      if (mesh) scene.remove(mesh);
      if (geo) geo.dispose();
      mat.dispose();
    },
  };
}
