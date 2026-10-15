// Procedural surface detail of the static world (WORLD, SPEC §7.5): one mipmapped texture
// array of tileable layers (brick, stained concrete, siding, corrugated metal, char, wood,
// canvas, bark, tyre rubber, shingles, HESCO mesh, rock, cracked glass, the ground's asphalt
// aggregate, concrete slabs, grass and gravel, and the interiors' linoleum, carpet tiles,
// drywall, ceiling tiles, wallpaper and terrazzo). Every lit world material samples it
// through a per-vertex (u, v, layer) attribute, so a merged bucket carries many surfaces in
// one draw call.
//
// The array holds two slices per layer:
//   layer L              R, G = tangent-space normal (x, y), B = roughness modifier (0.5 =
//                        none), A = albedo brightness (0.5 = none, multiplied by 2)
//   layer L + DET_LAYERS R = warm/cool shift, G = green/magenta shift (0.5 = none: the
//                        vertex colour is scaled by (1 + co - cg, 1 + cg, 1 - co - cg)),
//                        B = desaturation toward grey (mortar, bare metal, ash), A = height
//                        (parallax, water pooling in the low spots)
// Rows run up the surface: v grows upward on walls (world-mat.js flips it on faces whose
// v runs down, so a shingle's butt edge and a rust run always point down).
//
// The texel data is generated once per page and kept on the CPU; each renderer makes its
// own GPU texture from it. 256² layers are generated synchronously (world-surf-gen.js has the
// recipes); the cinematic tier regenerates them at 512² in a worker (world-surf-worker.js), or
// where workers are missing (the one-file build, Node) in slices of a few ms spread over frames.
//
// On 'high' and up the baked texture library (world-surf-bake.js, public/textures/) replaces these
// layers once it has loaded; the procedural array stays bound for the weathering's noise fields
// (layer 23) and as the fallback.

import * as THREE from 'three';
import { DET, DET_LAYERS, DET_COUNT, DET_BASE, DET_NAMES, DET_TILE, DET_PARAMS, DET_CELLS, DET_SHIFT, generateLayers, generateSteps, cachedLayers, keepLayers, genStats, now } from './world-surf-gen.js';

export { DET, DET_LAYERS, DET_COUNT, DET_BASE, DET_NAMES, DET_TILE, DET_PARAMS, DET_CELLS, DET_SHIFT };

const LAYERS = DET_LAYERS;

/** A mipmapped, repeating GPU array of both slices of every layer from the texel data. */
function arrayTexture(data, n, anisotropy) {
  const tex = new THREE.DataArrayTexture(data, n, n, LAYERS * 2);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A new GPU texture array with every detail layer (the texel data is shared and cached).
 * @param {number} [anisotropy]
 * @returns {THREE.DataArrayTexture}
 */
export function makeDetailArray(anisotropy = 1) {
  return arrayTexture(generateLayers(256), 256, anisotropy);
}

/** Longest stretch of work per slice of the 512² generation (ms). */
const SLICE_MS = 5;

let pending512 = null;
/**
 * The cinematic 512² detail array, generated in a worker (about a second or two off the main
 * thread), or without one in time slices of a few ms spread over frames. Resolves with a fresh GPU
 * texture array once done; every layer keeps its tile size in world units (DET_TILE), so swapping
 * it in just sharpens the surfaces.
 * @param {number} [anisotropy]
 * @returns {Promise<THREE.DataArrayTexture>}
 */
export async function makeDetailArrayAsync(anisotropy = 1) {
  // (one generation at a time: a second renderer asking meanwhile waits for the same one)
  if (!cachedLayers(512)) await (pending512 || (pending512 = generate512().finally(() => { pending512 = null; })));
  return arrayTexture(cachedLayers(512), 512, anisotropy);
}

function generate512() {
  return viaWorker().catch(() => viaSlices());
}

/** The 512² set generated in a worker (off the main thread: no frame pays for it). */
function viaWorker() {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') { reject(new Error('no workers')); return; }
    let w;
    try {
      w = new Worker(new URL('./world-surf-worker.js', import.meta.url), { type: 'module' });
    } catch (err) { reject(err); return; }
    w.onmessage = (e) => {
      w.terminate();
      const m = e.data || {};
      if (m.data && m.data.length) {
        keepLayers(512, m.data);
        genStats.ms512 = m.ms || 0;
        genStats.worker = true;
        resolve();
      } else reject(new Error(m.error || 'the surface worker failed'));
    };
    // (module workers unsupported, or the script failed to load: slice it on the main thread)
    w.onerror = (err) => { w.terminate(); reject(err); };
    w.postMessage({ n: 512 });
  });
}

/** The 512² set generated here in slices of a few ms, one per frame (no worker available). */
function viaSlices() {
  const g = generateSteps(512);
  return new Promise((resolve, reject) => {
    const step = () => {
      try {
        const t0 = now();
        let r;
        do r = g.next(); while (!r.done && now() - t0 < SLICE_MS);
        const dt = now() - t0;
        genStats.slices++;
        if (dt > genStats.maxSliceMs) genStats.maxSliceMs = dt;
        if (r.done) resolve(); else setTimeout(step, 0);
      } catch (err) { reject(err); }
    };
    step();
  });
}

/** Milliseconds the one-time 256² generation took (0 until it ran). */
export function detailGenMs() { return genStats.ms; }
/** Per-layer generation times (ms), the noise-field time and the 512² slicing, for the dev tools. */
export function detailGenBreakdown() {
  return {
    fields: genStats.fieldsMs, layers: genStats.layerMs, ms512: genStats.ms512, slices512: genStats.slices,
    maxSliceMs: Math.round(genStats.maxSliceMs * 10) / 10, maxStepMs: Math.round(genStats.maxStepMs * 10) / 10, maxStepAt: genStats.maxStepAt, worker512: !!genStats.worker,
  };
}
