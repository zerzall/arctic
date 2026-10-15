// The baked decal library in the first-person view: graffiti, posters, signs, blood, bullet holes,
// cracks, grime and floor clutter laid on walls, floors and props (scripts/bake-decals.js draws the
// sheets; decals-manifest.js is their atlas; shared/decals.js is the placement data and its helpers;
// decals-auto.js places them on the maps that carry no hand-placed set).
//
// One merged mesh per sheet (four draw calls at most): every decal is a quad (a small grid on the
// floor of a hilly map) a little off its surface, alpha-blended without writing depth and pulled
// toward the camera by a polygon offset, so it never fights the wall it is on. Lit like the world
// (Standard on high and up: the sheet's normal map, its alpha the roughness; Lambert on low) with the
// indoor light mask chained on (indoor.js patchIndoor keeps our onBeforeCompile).
//
// The sheets load after the world is built (fetch + createImageBitmap, resized per tier) and the
// meshes show once their albedo is in. Any failure (no file, no decoder, a node test) leaves them
// hidden: the map simply has no decals. The one-file build embeds the PNGs (window.__HH_FILES).

import * as THREE from 'three';
import { DECALS, DECAL_SHEETS, DECAL_SHEET_SIZE } from './decals-manifest.js';
import { autoDecals } from './decals-auto.js';
import { tierRow, anisoFor } from './tier.js';

/**
 * Per tier: albedo / normal sheet size (0 = no normal map), how many decals at most, the share of
 * the automatic set kept, and whether the hand-placed set is all that is drawn.
 */
export const DECAL_TIERS = Object.freeze({
  low: { albedo: 1024, normal: 0, max: 220, auto: 0 },
  high: { albedo: 2048, normal: 1024, max: 1400, auto: 0.55 },
  ultra: { albedo: 4096, normal: 2048, max: 3200, auto: 1 },
  cinematic: { albedo: 4096, normal: 4096, max: 4800, auto: 1 },
});

const WALL_OFF = 0.55;    // units off a wall (≈ 1.6 cm)
const FLOOR_OFF = 0.42;   // above the ground

/** Where a sheet file comes from: the one-file build's embedded copy, else next to the game. */
export function decalFileURL(file) {
  const key = 'textures/decals/' + file;
  const emb = globalThis.__HH_FILES && globalThis.__HH_FILES[key];
  if (emb) return emb;
  try {
    return new URL('../../textures/decals/' + file, import.meta.url).href;
  } catch {
    return key;
  }
}

/**
 * The decals a map shows on a tier: its hand-placed `map.decals` (unknown ids dropped), then the
 * automatic set (decals-auto.js) on maps without their own, thinned by the tier.
 * @returns {object[]} decal entries (shared/decals.js format)
 */
export function decalList(map, tier, opts = {}) {
  const row = tierRow(DECAL_TIERS, tier);
  const own = (map.decals || []).filter((d) => DECALS[d.id]);
  let list = own;
  if (row.auto > 0 && map.decalsAuto !== false && map.kind !== 'level') {
    const auto = autoDecals(map, { heightOf: opts.heightOf, own, theme: map.decalTheme });
    // (the lowest ranks first: a cap drops the same decals a lower tier never had)
    list = own.concat(auto.filter((d) => d.q < row.auto).sort((a, b) => a.q - b.q));
  }
  return list.length > row.max ? list.slice(0, row.max) : list;
}

/**
 * Merge decals into one geometry per sheet. gy(x, y) is the ground height; topOf(d) the top of the
 * surface a wall decal is on (null: no limit). Returns { geos: [BufferGeometry | null] per sheet,
 * count, tris }.
 */
export function buildDecalGeometry(list, gy = () => 0, topOf = null, opts = {}) {
  const per = DECAL_SHEETS.map(() => ({ pos: [], nor: [], uv: [], tan: [], col: [], idx: [], n: 0 }));
  const S = DECAL_SHEET_SIZE;
  const hilly = !!opts.hilly;
  let count = 0;
  for (const d of list) {
    const e = DECALS[d.id];
    if (!e) continue;
    const [sheet, px, py, pw, ph, ww, wh] = e;
    // (a negative width mirrors the decal: an arrow pointing the other way; -0.001 = its own width)
    let w = d.w ? (Math.abs(d.w) < 0.01 ? -ww : d.w) : ww, h = d.h || wh;
    const k = Number.isFinite(d.k) ? d.k : 1;
    const g = per[sheet];
    const u0 = px / S, v0 = py / S, u1 = (px + pw) / S, v1 = (py + ph) / S;
    const wall = !!(d.nx || d.ny);
    // (a wall decal stands on the ground in front of its wall: on a level of terraces the wall's
    // own footprint may belong to the terrace above)
    const base = wall ? gy(d.x + d.nx * 10, d.y + d.ny * 10) : gy(d.x, d.y);
    if (wall) {
      let zc = d.z || h / 2;
      // stay under the top of the wall it is on (shrink if it does not fit)
      const top = topOf ? topOf(d) : null;
      if (Number.isFinite(top) && top > 0) {
        if (h > top - 2) { const s = Math.max(0.2, (top - 2) / h); w *= s; h *= s; }
        if (zc + h / 2 > top - 1) zc = top - 1 - h / 2;
      }
      if (zc - h / 2 < 0.3) zc = h / 2 + 0.3;
      const nx = d.nx, nz = d.ny;
      const nl = Math.hypot(nx, nz) || 1;
      const Nx = nx / nl, Nz = nz / nl;
      // right (image +x) and down (image +y) seen from outside the wall, rolled by a
      const ca = Math.cos(d.a || 0), sa = Math.sin(d.a || 0);
      const Tx = Nz * ca, Ty = -sa, Tz = -Nx * ca;
      const Bx = Nz * sa, By = -ca, Bz = -Nx * sa;
      const cx = d.x + Nx * WALL_OFF, cy = base + zc, cz = d.y + Nz * WALL_OFF;
      quad(g, cx, cy, cz, Tx * w / 2, Ty * w / 2, Tz * w / 2, Bx * h / 2, By * h / 2, Bz * h / 2, Nx, 0, Nz, u0, v0, u1, v1, k, 1, 1, null);
    } else {
      const ca = Math.cos(d.a || 0), sa = Math.sin(d.a || 0);
      const Tx = ca, Tz = sa, Bx = -sa, Bz = ca;
      const n = hilly ? Math.min(6, Math.max(1, Math.ceil(Math.max(w, h) / 36))) : 1;
      quad(g, d.x, base + FLOOR_OFF, d.y, Tx * w / 2, 0, Tz * w / 2, Bx * h / 2, 0, Bz * h / 2, 0, 1, 0, u0, v0, u1, v1, k, n, n, hilly ? gy : null);
    }
    count++;
  }
  let tris = 0;
  const geos = per.map((g) => {
    if (!g.n) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('tangent', new THREE.Float32BufferAttribute(g.tan, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 4));
    geo.setIndex(g.n > 65535 ? new THREE.Uint32BufferAttribute(g.idx, 1) : new THREE.Uint16BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    tris += g.idx.length / 3;
    return geo;
  });
  return { geos, count, tris };
}

/** A (nu × nv)-cell quad centred at c with half-axes T (image +x) and B (image +y). */
function quad(g, cx, cy, cz, Tx, Ty, Tz, Bx, By, Bz, Nx, Ny, Nz, u0, v0, u1, v1, k, nu, nv, follow) {
  const start = g.n;
  // handedness: the normal map's +y runs down the image (along B)
  const crx = Ny * Tz - Nz * Ty, cry = Nz * Tx - Nx * Tz, crz = Nx * Ty - Ny * Tx;
  const wsign = crx * Bx + cry * By + crz * Bz >= 0 ? 1 : -1;
  const tl = Math.hypot(Tx, Ty, Tz) || 1;
  for (let j = 0; j <= nv; j++) {
    const t = j / nv, sv = t * 2 - 1;
    for (let i = 0; i <= nu; i++) {
      const s = i / nu, su = s * 2 - 1;
      const x = cx + Tx * su + Bx * sv, z = cz + Tz * su + Bz * sv;
      const y = follow ? follow(x, z) + FLOOR_OFF : cy + Ty * su + By * sv;
      g.pos.push(x, y, z);
      g.nor.push(Nx, Ny, Nz);
      g.uv.push(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t);
      g.tan.push(Tx / tl, Ty / tl, Tz / tl, wsign);
      g.col.push(1, 1, 1, k);
      g.n++;
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = start + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      // front faces wind counter-clockwise seen along -N
      g.idx.push(a, c, b, b, c, d);
    }
  }
}

function placeholder(rgba, colorSpace) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}

/** The sheet material of a tier (shared program: the four sheets compile once). */
function makeMaterial(tier, withNormal) {
  const common = {
    vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.012,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    map: placeholder([255, 255, 255, 0], THREE.SRGBColorSpace),
  };
  if (tier === 'low') return new THREE.MeshLambertMaterial(common);
  const m = new THREE.MeshStandardMaterial({
    ...common, roughness: 0.85, metalness: 0, envMapIntensity: 0.55,
    ...(withNormal ? { normalMap: placeholder([128, 128, 255, 217], THREE.NoColorSpace), normalScale: new THREE.Vector2(1, 1) } : null),
  });
  if (withNormal) {
    // the normal sheet's alpha is the roughness (wet blood, glossy paint, matte paper)
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef USE_NORMALMAP
	roughnessFactor = clamp( texture2D( normalMap, vNormalMapUv ).a, 0.04, 1.0 );
#endif`);
    };
    m.customProgramCacheKey = () => 'hhDecal1';
  }
  return m;
}

async function fetchBitmap(url, size, normal) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`decals: ${res.status} ${url.slice(0, 80)}`);
  const blob = await res.blob();
  const base = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  if (size && size < DECAL_SHEET_SIZE) {
    try {
      return await createImageBitmap(blob, { ...base, resizeWidth: size, resizeHeight: size, resizeQuality: normal ? 'medium' : 'high' });
    } catch { /* (no resize support: the full sheet) */ }
  }
  return createImageBitmap(blob, base);
}

/**
 * Build the decal meshes of a map and start loading their sheets.
 * @param {object} ctx renderer ctx (map, groundY, terrain)
 * @param {object} deps { root, tier (full tier name), gy, heightOf(o) → top, patchIndoor?, maxAniso, load (false: never fetch) }
 */
export function createDecals(ctx, deps) {
  const map = ctx.map;
  const tier = deps.tier || 'high';
  const row = tierRow(DECAL_TIERS, tier);
  const base = tier === 'low' ? 'low' : 'hi';
  const gy = deps.gy || ctx.groundY || (() => 0);
  const byId = new Map(map.obstacles.map((o) => [o.id, o]));
  const topOf = (d) => {
    if (!deps.heightOf) return null;
    if (d.o !== undefined) { const o = byId.get(d.o); return o ? deps.heightOf(o) : null; }
    return null;
  };
  const list = decalList(map, tier, { heightOf: deps.heightOf });
  const hilly = !!ctx.terrain && !ctx.terrain.flat;
  const { geos, count, tris } = buildDecalGeometry(list, gy, topOf, { hilly });
  const withNormal = base === 'hi' && row.normal > 0;
  const meshes = [];
  geos.forEach((geo, i) => {
    if (!geo) { meshes.push(null); return; }
    const mat = makeMaterial(base === 'low' ? 'low' : 'hi', withNormal);
    if (deps.patchIndoor) deps.patchIndoor(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'decals-' + DECAL_SHEETS[i];
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    // first among the blended things: glass, fences and particles in front of a decal draw over it
    mesh.renderOrder = -2;
    mesh.visible = false;
    mesh.userData.bucket = 'decals';
    if (deps.root) deps.root.add(mesh);
    meshes.push(mesh);
  });

  const stats = { count, tris, drawCalls: meshes.filter(Boolean).length, loaded: 0, failed: 0, state: count ? 'loading' : 'empty' };
  const textures = [];
  let disposed = false;
  const pending = [];   // [mesh index, kind, texture] waiting for their upload slot
  const aniso = anisoFor(tier, deps.maxAniso || 16);

  // (dev: ?decals=0 in the page's address leaves them off, for before / after screenshots)
  const off = typeof location !== 'undefined' && /[?&]decals=0\b/.test(location.search || '');
  const canLoad = !off && deps.load !== false && count > 0 && typeof fetch === 'function' && typeof createImageBitmap === 'function';
  if (!canLoad && count) stats.state = 'off';
  if (canLoad) {
    meshes.forEach((mesh, i) => {
      if (!mesh) return;
      const name = DECAL_SHEETS[i];
      const jobs = [['map', `decals-${name}.png`, row.albedo]];
      if (withNormal) jobs.push(['normalMap', `decals-${name}-n.png`, row.normal]);
      for (const [slot, file, size] of jobs) {
        fetchBitmap(decalFileURL(file), size, slot === 'normalMap').then((bmp) => {
          if (disposed) { if (bmp.close) bmp.close(); return; }
          const t = new THREE.Texture(bmp);
          t.flipY = false;
          t.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.anisotropy = slot === 'map' ? aniso : Math.min(aniso, 4);
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          t.needsUpdate = true;
          textures.push(t);
          pending.push([i, slot, t]);
          schedule();
        }).catch((err) => {
          stats.failed++;
          if (stats.failed === 1) console.warn('decals: sheets unavailable, drawing none', err && err.message ? err.message : err);
          // (a sheet without its albedo stays hidden; without its normal map it keeps the flat one)
          if (slot === 'map') stats.state = 'failed';
        });
      }
    });
  }

  // one texture swap at a time, a little apart: a 4096² upload and its mips is a frame's worth of
  // work (the swap happens on a timer so a paused view, a screenshot, still gets its decals)
  let timer = null;
  function schedule() {
    if (timer || disposed || !pending.length) return;
    timer = setTimeout(() => { timer = null; swap(); schedule(); }, 90);
  }
  /** (per frame: nothing to do; the swaps run on their timer) */
  function update() {}
  function swap() {
    if (pending.length) {
      const [i, slot, t] = pending.shift();
      const mat = meshes[i] && meshes[i].material;
      if (mat) {
        const old = mat[slot];
        mat[slot] = t;
        if (old && old.isDataTexture) old.dispose();
        if (slot === 'map') { meshes[i].visible = true; stats.loaded++; if (stats.loaded === stats.drawCalls) stats.state = 'ready'; }
      }
    }
  }

  function dispose() {
    disposed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    for (const m of meshes) {
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
      if (m.material.map) m.material.map.dispose();
      if (m.material.normalMap) m.material.normalMap.dispose();
      m.material.dispose();
    }
    for (const t of textures) t.dispose();
  }

  return { meshes: meshes.filter(Boolean), list, stats, update, dispose };
}
