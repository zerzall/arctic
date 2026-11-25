// Photo-scanned prop models (Poly Haven, CC0 1.0; scripts/fetch-models.js) for the set dressing (SPEC
// §7.5.2): steel drums, wooden and military crates, cardboard boxes, propane cylinders, jerrycans, trash
// cans, a fire hydrant, a park bench, a generator, tyres, trash bags, a picnic table, a garden chair, a
// stump, a fallen trunk, a boulder, a wheelchair.
//
// The geometry (models/props.bin + props.json: two levels of detail per model) is drawn as one
// BatchedMesh — every instance shows LOD 0 near, LOD 1 farther, nothing past FAR (switched from the
// camera's distance every few frames), culled per instance: one draw call. Every model's maps are a layer of two texture arrays (A: sRGB albedo + AO, B:
// normal xy + roughness + metalness) decoded and packed by the texture worker (tex-worker.js) off the
// main thread, uploaded once with mipmaps; one material (a patched MeshStandardMaterial: the layer per
// vertex, a normal map without tangents) draws them all, tinted per instance.
//
// Tier-aware: 'low' draws none of it (world-dress.js keeps the procedural props); high / ultra load the
// 512² layers, cinematic too (the props are at most a metre or two across). `?props=0` turns them off
// (before / after screenshots). Until the library has arrived — or when it fails — the procedural props
// stand in; world-dress rebuilds once when it is ready.

import * as THREE from 'three';
import { tierRow, anisoFor, tierRank } from './tier.js';
import { textureQueue, textureSource } from './tex-files.js';
import { makeTexWorker, decodeRGBA } from './tex-worker.js';

/** Texture layer size per tier (null: no models on that tier). */
export const PROP_TEX_TIERS = Object.freeze({ low: null, high: 512, ultra: 512, cinematic: 512 });
/** Distances (world units): LOD 0 inside NEAR, LOD 1 inside FAR, nothing past it. */
export const PROP_LOD = Object.freeze({ low: [0, 0], high: [420, 2200], ultra: [620, 2800], cinematic: [900, 3200] });
/** World units per metre (1 unit ≈ 3 cm). */
export const UNITS_PER_M = 1 / 0.03;

const BASE = (() => {
  try { return new URL('../../models/', import.meta.url).href; } catch { return 'models/'; }
})();

// ---- the library (module-level: geometry and textures outlive a renderer; releasePropModels drops them) ----

const lib = { status: 'off', promise: null, man: null, geos: null, texA: null, texB: null, size: 0, ms: 0, error: null, bytes: 0 };

function propsDisabled() {
  try { return typeof location !== 'undefined' && /[?&]props=0\b/.test(location.search || ''); } catch { return false; }
}

/** Are the models drawn on this tier (and in this page)? */
export function propModelsEnabled(tier) {
  return !!tierRow(PROP_TEX_TIERS, tier) && !propsDisabled() && typeof fetch === 'function';
}

/** The page's load state for the dev tools: 'off' | 'loading' | 'ready' | 'failed'. */
export function propModelsState() {
  return { status: lib.status, ms: Math.round(lib.ms), error: lib.error, layers: lib.man ? lib.man.layers.length : 0, models: lib.man ? Object.keys(lib.man.models).length : 0, bytes: lib.bytes };
}

async function fetchFile(name, kind) {
  const emb = typeof window !== 'undefined' && window.__HH_MODELS ? window.__HH_MODELS : null;
  if (emb && emb[name]) {
    const b64 = emb[name];
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return kind === 'json' ? JSON.parse(new TextDecoder().decode(bin)) : bin.buffer;
  }
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`${r.status} ${name}`);
  return kind === 'json' ? r.json() : r.arrayBuffer();
}

/** The geometry of one level from the bin. */
function levelGeometry(buf, L, layer0) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, L.pos, L.verts * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, L.nor, L.verts * 3), 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, L.uv, L.verts * 2), 2));
  // (the bin holds the model's own material index: offset to its layers in the arrays)
  const lay = new Uint8Array(buf, L.layer, L.verts).map((v) => v + layer0);
  g.setAttribute('aLayer', new THREE.BufferAttribute(lay, 1));
  g.setIndex(new THREE.BufferAttribute(L.index32 ? new Uint32Array(buf, L.idx, L.tris * 3) : new Uint16Array(buf, L.idx, L.tris * 3), 1));
  g.computeBoundingSphere();
  return g;
}

/** Copy channels of an RGBA image into a layer: map[c] = the source channel of c (-1: keep). */
function propPut(dst, layer, size, px, map) {
  const o = layer * size * size * 4;
  for (let i = 0, n = size * size; i < n; i++) {
    const s = i * 4, d = o + s;
    for (let c = 0; c < 4; c++) { const src = map[c]; if (src >= 0) dst[d + c] = px[s + src]; }
  }
}

/** The decode worker's job (tex-worker.js runs it as source): every map decoded and packed into A / B. */
async function propPackJob(d) {
  const arrays = { A: new Uint8Array(d.size * d.size * 4 * d.layers), B: new Uint8Array(d.size * d.size * 4 * d.layers) };
  const failed = [];
  let next = 0;
  const run = async () => {
    while (next < d.files.length) {
      const f = d.files[next++];
      try {
        const img = await decodeRGBA(f.src, d.size);
        if (img.w !== d.size || img.h !== d.size) throw new Error(`decoded at ${img.w}x${img.h}`);
        for (const [dst, layer, map] of f.puts) propPut(arrays[dst], layer, d.size, img.px, map);
      } catch (err) {
        failed.push(`${f.name}: ${String((err && err.message) || err).slice(0, 60)}`);
      }
    }
  };
  await Promise.all([run(), run(), run()]);
  return { out: { A: arrays.A.buffer, B: arrays.B.buffer, failed }, transfer: [arrays.A.buffer, arrays.B.buffer] };
}

function makeArray(data, size, layers, srgb, aniso) {
  const t = new THREE.DataArrayTexture(data, size, size, layers);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.unpackAlignment = 4;
  t.onUpdate = () => { t.image.data = null; };
  t.needsUpdate = true;
  return t;
}

/**
 * Load the library (idempotent): geometry, then the maps through the decode worker.
 * @param {string} tier
 * @param {number} [maxAniso]
 * @returns {Promise<boolean>} true once the models can be drawn
 */
export function loadPropModels(tier, maxAniso = 16) {
  const size = tierRow(PROP_TEX_TIERS, tier);
  if (!size || propsDisabled()) return Promise.resolve(false);
  if (lib.promise && lib.size >= size) return lib.promise;
  lib.size = size;
  lib.status = 'loading';
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const aniso = anisoFor(tierRank(tier) >= tierRank('ultra') ? tier : 'high', maxAniso);
  lib.promise = (async () => {
    const [man, bin] = await Promise.all([fetchFile('props.json', 'json'), fetchFile('props.bin', 'bin')]);
    const geos = {};
    for (const [name, m] of Object.entries(man.models)) geos[name] = m.lods.map((L) => levelGeometry(bin, L, m.layer0));
    // (after the world's texture library: tex-files.js orders the downloads)
    await textureQueue();
    const n = man.layers.length;
    const files = [];
    man.layers.forEach((L, i) => {
      files.push({ name: L.files.albedo, puts: [['A', i, [0, 1, 2, -1]]] });
      files.push({ name: L.files.normal, puts: [['B', i, [0, 1, -1, -1]]] });
      // orm: AO → A.a, roughness → B.b, metalness → B.a
      files.push({ name: L.files.orm, puts: [['A', i, [-1, -1, -1, 0]], ['B', i, [-1, -1, 1, 2]]] });
    });
    await Promise.all(files.map(async (f) => { f.src = await textureSource(f.name, size); }));
    let A = null, B = null;
    const tw = makeTexWorker(propPackJob, [propPut], 1);
    if (tw) {
      try {
        const r = await tw.run({ size, layers: n, files });
        if (r.failed.length) throw new Error(r.failed[0]);
        A = new Uint8Array(r.A); B = new Uint8Array(r.B);
      } finally { tw.close(); }
    } else {
      A = new Uint8Array(size * size * 4 * n); B = new Uint8Array(size * size * 4 * n);
      for (const f of files) {
        const img = await decodeRGBA(f.src, size);
        for (const [dst, layer, map] of f.puts) propPut(dst === 'A' ? A : B, layer, size, img.px, map);
      }
    }
    lib.texA = makeArray(A, size, n, true, aniso);
    lib.texB = makeArray(B, size, n, false, Math.min(aniso, 8));
    lib.man = man;
    lib.geos = geos;
    lib.bytes = Math.round(size * size * 4 * n * 2 * 4 / 3 + bin.byteLength);
    lib.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    lib.status = 'ready';
    return true;
  })().catch((err) => {
    lib.status = 'failed';
    lib.error = String((err && err.message) || err);
    lib.promise = null;
    if (typeof console !== 'undefined') console.warn('prop models: unavailable, the procedural props stay', lib.error);
    return false;
  });
  return lib.promise;
}

/** Drop the library's GPU objects (renderer3d destroy()). */
export function releasePropModels() {
  if (lib.texA) lib.texA.dispose();
  if (lib.texB) lib.texB.dispose();
  if (lib.geos) for (const g of Object.values(lib.geos)) for (const x of g) x.dispose();
  Object.assign(lib, { status: 'off', promise: null, man: null, geos: null, texA: null, texB: null, size: 0, bytes: 0 });
}

// ---- the material -----------------------------------------------------------------------------------

/** One standard material for every model: the arrays' layer per vertex, tangent-free normal mapping. */
function propMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, envMapIntensity: 0.75 });
  const uniforms = { uPropA: { value: lib.texA }, uPropB: { value: lib.texB } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLayer;\nvarying float vPLayer;\nvarying vec2 vPUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPLayer = aLayer;\nvPUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uPropA;\nuniform highp sampler2DArray uPropB;\nvarying float vPLayer;\nvarying vec2 vPUv;')
      .replace('#include <map_fragment>', `
        vec4 pA = texture(uPropA, vec3(vPUv, floor(vPLayer + 0.5)));
        vec4 pB = texture(uPropB, vec3(vPUv, floor(vPLayer + 0.5)));
        diffuseColor.rgb *= pA.rgb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(pB.b, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pB.a;')
      .replace('#include <normal_fragment_maps>', `
        {
          // (glTF normal maps sampled with the stored uv, rows top first: green points down the image)
          vec3 mapN = vec3(pB.x * 2.0 - 1.0, 1.0 - pB.y * 2.0, 0.0);
          mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vPUv), st1 = dFdy(vPUv);
          vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
          vec3 T = q1p * st0.x + q0p * st1.x, Bt = q1p * st0.y + q0p * st1.y;
          float dt = max(dot(T, T), dot(Bt, Bt));
          if (dt > 1e-12) normal = normalize(mat3(T * inversesqrt(dt), Bt * inversesqrt(dt), normal) * mapN);
        }`)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= pA.a;
        reflectedLight.indirectSpecular *= pA.a;
        reflectedLight.directDiffuse *= mix(1.0, pA.a, 0.35);`);
  };
  m.customProgramCacheKey = () => 'hh-props-v1';
  return m;
}

// ---- the instances ----------------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * The prop models of one world: placements collected while the set dressing builds, drawn as ONE
 * BatchedMesh (every model's two levels are geometries of it; each instance shows LOD 0, LOD 1 or
 * nothing by its distance): a single draw call with
 * WEBGL_multi_draw.
 * @param {object} ctx renderer ctx
 * @param {{ root: THREE.Object3D, tier: string }} deps
 */
export function createPropModels(ctx, deps) {
  const { root } = deps;
  let tier = deps.tier;
  /** placements: { name, m: Float32Array(16), c: [r, g, b] } */
  let list = [];
  let bm = null;
  /** instance → { id, name, x, z, lod } */
  let insts = [];
  let geoIds = null;
  let material = null;
  let lastX = Infinity, lastZ = Infinity, frame = 0;

  function drop() {
    if (bm) { root.remove(bm); bm.dispose(); }
    bm = null; insts = []; geoIds = null;
  }

  return {
    /** The library is in and this tier draws models: world-dress may place them. */
    get ready() { return lib.status === 'ready' && !!tierRow(PROP_TEX_TIERS, tier) && !propsDisabled(); },
    /** Has a model of this name? */
    has(name) { return !!(lib.man && lib.man.models[name]); },
    /** Size (metres: x, y, z) of a model. */
    size(name) { return lib.man.models[name].size; },
    /** Start over (the dressing rebuilds). */
    clear() { list = []; drop(); },
    /**
     * One instance: model `name` at world (x, y, z) with euler rotation `rot` ([x, y, z], radians, order
     * YXZ: the heading first), scale `s` (a number or [x, y, z]) and a tint (linear colour multiplier).
     */
    add(name, x, y, z, rot, s, tint) {
      _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'YXZ');
      _q.setFromEuler(_e);
      if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
      _m.compose(_p.set(x, y, z), _q, _s);
      list.push({ name, m: Float32Array.from(_m.elements), c: tint ? [tint[0], tint[1], tint[2]] : [1, 1, 1] });
    },
    /** Make the batch for what was placed. */
    finish() {
      drop();
      if (!lib.geos || !list.length) return;
      if (!material) material = propMaterial();
      const used = [...new Set(list.map((p) => p.name))].filter((n) => lib.geos[n]);
      let nv = 0, ni = 0;
      for (const n of used) for (const g of lib.geos[n]) { nv += g.attributes.position.count; ni += g.index.count; }
      bm = new THREE.BatchedMesh(list.length, nv, ni, material);
      bm.name = 'props';
      bm.frustumCulled = false;
      // (no per-instance frustum test: three would walk every instance every frame; the levels' switch is the culling)
      bm.perObjectFrustumCulled = false;
      bm.sortObjects = false;
      bm.castShadow = false;
      bm.receiveShadow = true;
      geoIds = {};
      for (const n of used) geoIds[n] = lib.geos[n].map((g) => bm.addGeometry(g));
      for (const p of list) {
        const ids = geoIds[p.name];
        if (!ids) continue;
        const id = bm.addInstance(ids[1]);
        _m.fromArray(p.m);
        bm.setMatrixAt(id, _m);
        bm.setColorAt(id, _c.setRGB(p.c[0], p.c[1], p.c[2]));
        bm.setVisibleAt(id, false);
        insts.push({ id, name: p.name, x: p.m[12], z: p.m[14], lod: -1 });
      }
      root.add(bm);
      lastX = Infinity;
    },
    /** Each instance's level by the camera's distance (after a move of 24 units, or every 30 frames). */
    update(camera) {
      if (!bm) return;
      frame++;
      const cx = camera.position.x, cz = camera.position.z;
      if (Math.hypot(cx - lastX, cz - lastZ) < 24 && frame % 30) return;
      lastX = cx; lastZ = cz;
      const [near, far] = tierRow(PROP_LOD, tier);
      const n2 = near * near, f2 = far * far;
      for (const it of insts) {
        const dx = it.x - cx, dz = it.z - cz, d2 = dx * dx + dz * dz;
        const lod = d2 < n2 ? 0 : d2 < f2 ? 1 : -1;
        if (lod === it.lod) continue;
        if (lod < 0) bm.setVisibleAt(it.id, false);
        else {
          if (it.lod < 0) bm.setVisibleAt(it.id, true);
          bm.setGeometryIdAt(it.id, geoIds[it.name][lod]);
        }
        it.lod = lod;
      }
    },
    setQuality(q) { tier = q; lastX = Infinity; },
    get stats() {
      let tris = 0, shown = 0;
      for (const it of insts) if (it.lod >= 0) { shown++; tris += lib.man.models[it.name].lods[it.lod].tris; }
      return { instances: list.length, shown, models: geoIds ? Object.keys(geoIds).length : 0, draws: shown ? 1 : 0, triangles: tris, ...propModelsState() };
    },
    dispose() {
      this.clear();
      if (material) material.dispose();
      material = null;
    },
  };
}
