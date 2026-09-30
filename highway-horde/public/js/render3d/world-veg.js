// Vegetation of the static world (WORLD, SPEC §7.5).
//   - Trees, bushes, undergrowth: world-flora.js (species, crowns of alpha-tested leaf cards).
//   - The tree line past the map bounds (cheaper cards, merged per side): pines, deciduous
//     trees, birches; in the desert boulders with rock strata, dead trees, cacti and agave.
//   - A grass field: ONE instanced draw call of blade tufts laid out on a grid that
//     follows the camera; the vertex shader places each tuft from a hash of its world
//     cell (so nothing swims), reads the ground's surface mask to grow only on grass (a
//     few weeds on loose ground, none on roads, in water or under obstacles), sways it
//     in the wind and fades it out with distance. No CPU work per frame.

import * as THREE from 'three';
import { T, shadeHex, seededRng, lin } from './world-geo.js';
import { DET } from './world-surf.js';
import { LEAF_CELLS } from './world-tex.js';
import { cardList, card, listGeo, PINE, LEAF, desertPiece, setBiome } from './world-flora.js';

// trees, bushes and their species (world-flora.js)
export { trunk, canopy, bush, scatterFlora, setBiome } from './world-flora.js';

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
      if (roll < 0.36 && dist > 200) {
        // boulders of layered sandstone
        const big = dist > 450 ? rng.range(1.6, 3) : rng.range(0.6, 1.3);
        const rc = rng.pick(['#5e4a38', '#6b5642', '#54443a', '#735c44', '#7a5e46']);
        B.add('std', T.dodeca(), [0, 30 * big, 0], [70 * big, 70 * big * rng.range(0.6, 1.1), 55 * big], [0, rng.range(0, 6), 0], rc, { wobble: { amp: 0.3, seed: Math.floor(roll * 999) }, surf: [DET.strata, 0.85, 0] });
        B.add('std', T.dodeca(), [40 * big, 12 * big, 20 * big], [36 * big, 30 * big, 30 * big], [0.4, 1, 0], rc, { wobble: { amp: 0.3, seed: 5 }, surf: [DET.strata, 0.85, 0] });
        if (big > 1.2) B.add('std', T.dodeca(), [-46 * big, 18 * big, -14 * big], [30 * big, 46 * big, 26 * big], [0.2, 2, 0], shadeHex(rc, 0.06), { wobble: { amp: 0.3, seed: 9 }, surf: [DET.strata, 0.85, 0] });
      } else if (roll < 0.5) {
        // a dead tree: split trunk, a few bare limbs
        const s = rng.range(0.8, 1.4);
        B.cyl('std', 0, 0, 0, 5 * s, 110 * s, '#4a3f34', 6, 0.4, null, { surf: [DET.bark, 0.9, 0] });
        for (let k = 0; k < 4; k++) {
          const a = rng.range(0, 6.28);
          B.add('std', T.cyl(4, 0.3), [Math.cos(a) * 8 * s, (60 + k * 14) * s, Math.sin(a) * 8 * s], [3 * s, 50 * s, 3 * s], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], '#4a3f34', { surf: [DET.bark, 0.9, 0], map: 'cyl' });
        }
      } else if (roll < 0.54) {
        desertPiece(B, 'cactus', rng.range(0.9, 1.7), rng);
      } else if (roll < 0.58) {
        desertPiece(B, 'agave', rng.range(1, 1.8), rng);
      } else if (roll < 0.8) {
        B.add('std', T.ico(0), [0, 8, 0], [16, 10, 16], [0, rng.range(0, 6), 0], rng.pick(['#5a5a34', '#6a6238', '#4e5430', '#7a7444']), { wobble: { amp: 0.25, seed: 3 }, surf: [DET.grass, 0.95, 0] });
      }
      return;
    }
    const kind = rng.next();
    const s = rng.range(0.8, 1.5);
    // (a hideout picks how much of its tree line is deciduous: map.look.deciduous)
    if (kind < (map.look && Number.isFinite(map.look.deciduous) ? map.look.deciduous : 0.3)) {
      // deciduous: a trunk under three clumps of leaf cards
      const cards = cardList();
      const R = 46 * s;
      const cc = [0, 175 * s, 0];
      B.cyl('std', 0, 0, 0, 6 * s, 120 * s, '#3f3226', 6, 0.6, null, { surf: [DET.bark, 0.9, 0] });
      B.add('std', T.ico(0), cc, [R * 0.5, R * 0.4, R * 0.5], null, shadeHex('#2f4a26', -0.3), { surf: [DET.grass, 0.95, 0], noAO: true });
      for (let k = 0; k < 4; k++) {
        const dir = k === 0 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(rng.range(-1, 1), rng.range(-0.1, 0.5), rng.range(-1, 1)).normalize();
        const ctr = [cc[0] + dir.x * R * 0.6, cc[1] + dir.y * R * 0.5, cc[2] + dir.z * R * 0.6];
        for (let m = 0; m < 6; m++) {
          const f = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 1), rng.range(-1, 1)).normalize();
          card(cards, [ctr[0] + f.x * R * 0.35, ctr[1] + f.y * R * 0.3, ctr[2] + f.z * R * 0.35], f, rng.range(0, 6.28), R * 0.9, R * 0.9, cc, rng.chance(0.5) ? LEAF_CELLS.broadA : LEAF_CELLS.broadB, 3);
        }
      }
      B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, rng.pick(rng.chance(0.15) ? ['#a8532a', '#c8862a', '#98702a'] : LEAF), { noAO: true });
      return;
    }
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
  const pos = [], nor = [], side = [], kind = [];
  const r = seededRng(4242);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + r.range(-0.4, 0.4);
    const d = r.range(0.3, 2.4);
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const w = r.range(0.6, 1.35), h = r.range(0.55, 1.05);
    const lean = r.range(0.12, 0.5);
    const px = -Math.sin(a) * w * 0.5, pz = Math.cos(a) * w * 0.5;
    // triangle: two base corners, tip leaning outward
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean * 6, h, bz + Math.sin(a) * lean * 6);
    for (let k = 0; k < 3; k++) { nor.push(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3); side.push(k === 2 ? 1 : 0); kind.push(0); }
  }
  // a flower head: one small triangle at the height of a tall stem (y is scaled by the tuft height in
  // the vertex shader, x / z are not: a wide, flat head); the shader hides it on most tufts
  const fx = 0.5, fz = -0.3, fh = 1.15, hs = 1.5;
  pos.push(fx - hs, fh, fz - hs * 0.6, fx + hs, fh, fz - hs * 0.4, fx, fh + 0.05, fz + hs);
  for (let k = 0; k < 3; k++) { nor.push(0, 1, 0); side.push(1); kind.push(2); }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
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
        attribute float aKind;
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
        // some tufts in the lush grass grow a flower (yellow, white, purple, red); the others hide theirs
        float fl = step(0.93, fract(h4 * 7.13 + h1 * 3.7)) * step(0.5, lush) * step(1.5, aKind);
        if (aKind > 1.5 && fl < 0.5) s = 0.0;
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
        vGrass = mix(gcol * 0.45, gcol * 1.35, aTip);
        if (aKind > 1.5) {
          float fk = fract(h2 * 5.3 + h3 * 2.1);
          vGrass = fk < 0.34 ? vec3(0.42, 0.32, 0.03) : fk < 0.6 ? vec3(0.42, 0.42, 0.38) : fk < 0.82 ? vec3(0.2, 0.08, 0.26) : vec3(0.4, 0.04, 0.03);
        }`)
      .replace('#include <fog_vertex>', '#include <fog_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrass;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vGrass;');
  };
  mat.customProgramCacheKey = () => 'hh-grass-v2';
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
