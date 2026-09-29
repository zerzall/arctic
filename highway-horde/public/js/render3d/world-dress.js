// Set dressing of the static world (WORLD, SPEC §7.5.2): the props of shared/dress.js
// turned into merged, vertex-coloured meshes — road debris, abandoned belongings, street
// furniture, industrial clutter, signs of the apocalypse, nature — plus the little animated
// life (dress-life.js).
//
// The props go through their own geo builder (world-geo.js) so a quality tier can rebuild
// them with its own density (ultra 100 %, high 60 %, low 25 % of the ranked items; the
// thinned sets are nested). They use the world's material buckets (std, leaves, glow,
// blink) and four of their own: 'sign' (the text atlas of dress-atlas.js, alpha-tested),
// 'flat' and 'wet' (skid marks, puddles, stains: blended, polygon-offset onto the ground)
// and 'cloth' (tarps, banners and flags that wave on the GPU). Cells are large (the
// world's frustum and fog culling still drops what is behind you).

import * as THREE from 'three';
import { createGeoBuilder } from './world-geo.js';
import { buildDress, dressDensity } from '../shared/dress.js';
import { makeDressTexture } from './dress-atlas.js';
import { DEBRIS, FLATS } from './dress-debris.js';
import { STREET } from './dress-street.js';
import { INDUSTRIAL } from './dress-industrial.js';
import { LIFE_PROPS } from './dress-life-props.js';
import { NATURE } from './dress-nature.js';
import { APOCALYPSE } from './dress-apoc.js';
import { createLife } from './dress-life.js';

const BUILDERS = { ...FLATS, ...DEBRIS, ...STREET, ...INDUSTRIAL, ...LIFE_PROPS, ...NATURE, ...APOCALYPSE };

/** Kinds that have a model (tests compare this with DRESS_KINDS). */
export const DRESS_MODELLED = Object.freeze(Object.keys(BUILDERS));

/** Triangles the dressing may add per tier (only the biggest maps reach it). */
const TRI_BUDGET = { ultra: 650000, high: 400000, low: 170000 };
/** Tall props that make the skyline: built into the far set. */
const FAR = new Set(['pole', 'wire', 'billboard', 'watertower', 'flagpole', 'banner', 'deadtree']);
/** The small props are not drawn past this distance (the far set is). */
const NEAR_MAX = 2800;
const OWN = new Set(['sign', 'lit', 'flat', 'wet', 'cloth']);
const UNLIT = new Set(['glow', 'blink']);

/** Wave the cloth on the GPU: the vertex is pushed along its normal by a travelling wave that grows away from the pinned edge (uv.x = 0). */
function clothPatch(mat, uniforms, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float hhPh = (position.x + position.z) * 0.045 + position.y * 0.03;
          float hhAmp = uv.x * uv.x * 3.2 + uv.x * 0.8;
          float hhW = sin(uTime * 3.1 + uv.x * 5.0 + hhPh) + 0.5 * sin(uTime * 5.3 + uv.x * 9.0 - hhPh * 2.0);
          transformed += normal * hhW * hhAmp;
          transformed.y -= uv.x * 1.4 * (0.6 + 0.4 * sin(uTime * 2.1 + hhPh));
        }`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * Create the set dressing.
 * @param {object} ctx renderer ctx { map, quality, groundY, terrain }
 * @param {object} deps { root, mats, fx, halos, tier, aniso, day, gy, hasTerrain }
 */
export function createDress(ctx, deps) {
  const { map } = ctx;
  const { root, mats, gy, hasTerrain } = deps;
  let tier = deps.tier;
  const tex = makeDressTexture(deps.aniso || 8);
  const own = {
    hi: {
      sign: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, roughness: 0.62, metalness: 0.12, envMapIntensity: 0.8 }),
      // (backlit ads and machine fronts: unlit, dim at night, the power is out)
      lit: new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, color: new THREE.Color().setScalar(deps.day ? 0.95 : 0.3) }),
      flat: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 }),
      wet: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: 0.04, metalness: 0.0, envMapIntensity: 2.0, opacity: 0.92 }),
      cloth: clothPatch(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88, metalness: 0, envMapIntensity: 0.5 }), mats.uniforms, 'hh-cloth-v1'),
    },
    low: {
      sign: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, alphaTest: 0.5 }),
      lit: new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, color: new THREE.Color().setScalar(deps.day ? 0.95 : 0.3) }),
      flat: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      wet: new THREE.MeshPhongMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, shininess: 120, specular: new THREE.Color(0.5, 0.5, 0.5) }),
      cloth: clothPatch(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), mats.uniforms, 'hh-cloth-low-v1'),
    },
  };
  const matFor = (bucket) => (OWN.has(bucket) ? (tier === 'low' ? own.low : own.hi)[bucket] : mats.get(bucket, tier));

  // (map.dressItems: a dev hook, the prop gallery of dev/fps-sandbox.html?gallery=... lays its own list)
  const items = map.dressItems || buildDress(map);
  const ranked = items.slice().sort((a, b) => a.q - b.q);
  let meshes = [];
  let triangles = 0;
  let shown = 0;
  let buildMs = 0;
  let built = false;
  const halos = [];
  const missing = new Set();

  /** One geo builder: `cells` gives the bucket cell sizes (the near set is cut fine, the far set is one lump per bucket). */
  function makeBuilder(cells) {
    const D = createGeoBuilder({
      cell: cells.mid,
      buckets: {
        std: { det: true, cell: cells.std }, leaves: { uv: true, ao: false }, glow: { uv: true, ao: false, cell: cells.all }, blink: { ao: false, cell: cells.all },
        sign: { uv: true }, lit: { uv: true, ao: false }, fence: { uv: true }, flat: { uv: true, ao: false, cell: cells.all }, wet: { uv: true, ao: false, cell: cells.all }, cloth: { uv: true, cell: cells.all },
      },
    });
    // (vehicle-style 'paint' and 'glass' pieces of the props are ordinary opaque std with the right surface)
    const add0 = D.add;
    D.add = (bucket, g, p, sc, r, color, o = null) => {
      if (bucket === 'paint') add0('std', g, p, sc, r, color, o && o.surf ? o : { ...(o || {}), surf: [0, 0.42, 0.35] });
      else if (bucket === 'glass') add0('std', g, p, sc, r, color, o && o.surf ? { ...o, surf: [o.surf[0], o.surf[1] < 0 ? 0.14 : o.surf[1], 0.3] } : { ...(o || {}), surf: [0, 0.14, 0.3] });
      else add0(bucket, g, p, sc, r, color, o);
    };
    if (hasTerrain) D.setGround(gy);
    D.setJitter(0.06);
    return D;
  }

  function build() {
    const t0 = performance.now();
    const density = dressDensity(tier);
    // near: the small things, cut into 1200-unit cells (culled past NEAR_MAX); far: poles, wires, billboards, the
    // water tower and the dead trees, which make the skyline and are always drawn (a few hundred triangles each)
    // (a small map is one cell per bucket: its whole dressing is a few hundred thousand triangles and culling would save little)
    const small = Math.max(map.width, map.height) <= 4100;
    const Dnear = makeBuilder(small ? { std: 40000, mid: 40000, all: 40000 } : { std: 1600, mid: 3200, all: 40000 });
    const Dfar = makeBuilder({ std: 40000, mid: 40000, all: 40000 });
    shown = 0;
    const hl = built ? [] : halos;
    const budget = TRI_BUDGET[tier];
    for (let i = 0; i < ranked.length; i++) {
      const it = ranked[i];
      if (it.q >= density) break;
      // a huge map (Harlan County) stops at the tier's triangle budget: the least important props go first
      if (Dnear.triangles + Dfar.triangles > budget) break;
      const fn = BUILDERS[it.k];
      if (!fn) {
        if (!missing.has(it.k)) { missing.add(it.k); }
        continue;
      }
      const D = FAR.has(it.k) ? Dfar : Dnear;
      D.obj(it.x, it.y, it.a, it.v * 31 + it.k.length + i);
      try {
        fn({ D, it, s: it.s, halos: hl, map });
        shown++;
      } catch (err) {
        if (!missing.has('!' + it.k)) { missing.add('!' + it.k); console.warn('dress: prop model failed', it.k, err); }
      }
    }
    triangles = 0;
    for (const [D, far] of [[Dnear, false], [Dfar, true]]) {
      for (const { bucket, geometry } of D.finish()) {
        const mesh = new THREE.Mesh(geometry, matFor(bucket));
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.receiveShadow = !UNLIT.has(bucket);
        mesh.name = 'dress-' + (far ? 'far-' : '') + bucket;
        mesh.userData.bucket = bucket;
        mesh.userData.far = far;
        mesh.frustumCulled = true;
        root.add(mesh);
        meshes.push(mesh);
        triangles += geometry.attributes.position.count / 3;
      }
    }
    buildMs = performance.now() - t0;
    if (!built) {
      for (const h of halos) if (deps.halos) deps.halos.push(h);
      built = true;
    }
  }
  function clear() {
    for (const m of meshes) { root.remove(m); m.geometry.dispose(); }
    meshes = [];
  }
  build();

  const life = createLife(ctx, deps, items, () => tier);

  const cullDist = deps.cullDist || 3000;
  return {
    get meshes() { return meshes; },
    /** The lettering material for the world's own 'sign' bucket (vehicle liveries). */
    signMaterial(t) { return (t === 'low' ? own.low : own.hi).sign; },
    life,
    /** Frustum-independent fog culling of the dress cells (the world's cullFar does the same for its meshes). */
    cull(cam) {
      const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
      for (const m of meshes) {
        const s = m.geometry.boundingSphere;
        if (!s) continue;
        const dx = s.center.x - cx, dy = s.center.y - cy, dz = s.center.z - cz;
        m.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) - s.radius < (m.userData.far ? cullDist : Math.min(cullDist, NEAR_MAX));
      }
    },
    update(view, frame) { life.update(view, frame); },
    setQuality(q) {
      const nt = q === 'low' || q === 'ultra' ? q : 'high';
      if (nt === tier) return;
      const dOld = dressDensity(tier), dNew = dressDensity(nt);
      tier = nt;
      if (dOld !== dNew) { clear(); build(); } else for (const m of meshes) m.material = matFor(m.userData.bucket);
      life.setQuality(nt);
    },
    get stats() { return { items: items.length, shown, triangles: Math.round(triangles), meshes: meshes.length, buildMs: Math.round(buildMs), unmodelled: [...missing].filter((k) => k[0] !== '!') }; },
    items,
    dispose() {
      clear();
      life.dispose();
      for (const set of [own.hi, own.low]) for (const m of Object.values(set)) m.dispose();
      tex.dispose();
    },
  };
}
