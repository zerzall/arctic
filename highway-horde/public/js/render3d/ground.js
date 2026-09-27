// Ground of the first-person view (WORLD, SPEC §7.5). The flat map layers (areas, road
// paint, flat decor, baked contact shadows) are painted with the top-down renderer's own
// painter (render/maplayer.js prepareMap + paintGround) into chunked canvases that become
// CanvasTextures on ground tiles. A skirt of cheaper tiles continues the roads and fields
// past the playable bounds so the world never ends at a hard edge. Water areas sink below
// the ground: the tiles there are subdivided at the water edges and lowered, with muddy
// banks (or a vertical drop where a bridge deck crosses).
//
// The ground material is a MeshStandardMaterial with a small shader patch: a tiling
// detail texture adds grain up close, and grey surfaces (asphalt, concrete, lane paint)
// become glossy and get puddles, so street lamps and the flashlight glint off wet roads.
//
// Decals (blood, scorch, acid, oil, gore) are painted into the tile canvases; dirty tiles
// are re-uploaded a few per frame, nearest to the camera first. Memory is fixed: the
// canvases are allocated once.

import * as THREE from 'three';
import { prepareMap, paintGround } from '../render/maplayer.js';
import { bloodSplats, scorchSprite } from '../render/textures.js';
import { periodicFbm, createRng } from '../render/util.js';

const TILE = 512;               // playable-area tile size (world units)
const SKIRT = 1300;             // how far the ground continues past the map bounds
const SKIRT_TILE = 2200;        // max skirt tile length
const SKIRT_SCALE = 0.16;       // texels per unit beyond the bounds (fog hides it)
/** Water geometry (units): bed depth, surface height, bank width, drop under a bridge. */
export const WATER = { depth: 70, surface: -16, bank: 46, drop: 2 };
// Decor the 3D world models itself — not painted flat into the ground.
const MODELLED_DECOR = new Set(['bush', 'rock', 'cone', 'tire', 'lamp_post', 'sign', 'flag', 'rubble', 'tree_canopy']);
const EXTEND_KINDS = new Set(['asphalt', 'concrete', 'gravel', 'water']);

/**
 * Create the ground.
 * @param {object} o { scene, map, quality, renderer }
 * @returns {{ meshes, decal, update, waters, heightAt, dispose, stats }}
 */
export function createGround({ scene, map, quality, renderer }) {
  const high = quality !== 'low';
  const scale = high ? 0.75 : 0.5;
  const maxAniso = renderer ? Math.min(high ? 8 : 2, renderer.capabilities.getMaxAnisotropy()) : 1;
  const W = map.width, H = map.height;

  // ---- painting source: the map with edge-touching roads/rivers carried into the skirt
  const ext = extendMap(map, SKIRT);
  const prep = prepareMap(ext);
  const waters = buildWaters(ext.areas.filter((a) => a.kind === 'water'), W, H);

  // ---- tiles
  const tiles = [];
  for (let y0 = 0; y0 < H; y0 += TILE) {
    for (let x0 = 0; x0 < W; x0 += TILE) {
      tiles.push({ x0, y0, x1: Math.min(W, x0 + TILE), y1: Math.min(H, y0 + TILE), scale, inner: true });
    }
  }
  const addSkirt = (x0, y0, x1, y1) => {
    const nx = Math.ceil((x1 - x0) / SKIRT_TILE), ny = Math.ceil((y1 - y0) / SKIRT_TILE);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        tiles.push({
          x0: x0 + ((x1 - x0) * i) / nx, x1: x0 + ((x1 - x0) * (i + 1)) / nx,
          y0: y0 + ((y1 - y0) * j) / ny, y1: y0 + ((y1 - y0) * (j + 1)) / ny,
          scale: SKIRT_SCALE, inner: false,
        });
      }
    }
  };
  addSkirt(-SKIRT, -SKIRT, W + SKIRT, 0);
  addSkirt(-SKIRT, H, W + SKIRT, H + SKIRT);
  addSkirt(-SKIRT, 0, 0, H);
  addSkirt(W, 0, W + SKIRT, H);

  const detail = makeDetailTexture();
  detail.anisotropy = maxAniso;
  const uniforms = { detailMap: { value: detail }, wetness: { value: 1 } };
  const meshes = [];
  const group = new THREE.Group();
  group.name = 'ground';
  scene.add(group);

  for (const t of tiles) {
    const pw = Math.ceil((t.x1 - t.x0) * t.scale) + 2, ph = Math.ceil((t.y1 - t.y0) * t.scale) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    t.canvas = canvas;
    t.g = canvas.getContext('2d');
    t.pw = pw; t.ph = ph;
    paintTile(t);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = maxAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    t.texture = tex;
    const mat = makeGroundMaterial(tex, uniforms);
    const geo = tileGeometry(t, waters);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = t.inner ? 'ground-tile' : 'ground-skirt';
    group.add(mesh);
    t.mesh = mesh;
    t.dirty = false;
    meshes.push(mesh);
  }

  function paintTile(t) {
    const g = t.g;
    g.setTransform(t.scale, 0, 0, t.scale, 1 - t.x0 * t.scale, 1 - t.y0 * t.scale);
    const m = 2 / t.scale;
    const rect = { x0: t.x0 - m, y0: t.y0 - m, x1: t.x1 + m, y1: t.y1 + m };
    paintGround(g, prep, rect, t.inner ? 1 : 0);
    // muddy banks inside the water edges (the bank slopes down under the surface)
    for (const w of waters) {
      if (w.x1 < rect.x0 || w.x0 > rect.x1 || w.y1 < rect.y0 || w.y0 > rect.y1) continue;
      for (const e of w.edges) {
        if (e.bridge || e.outside) continue;
        const inset = WATER.bank * 0.7;
        let grad;
        if (e.axis === 'x') grad = g.createLinearGradient(e.pos, 0, e.pos + e.dir * inset, 0);
        else grad = g.createLinearGradient(0, e.pos, 0, e.pos + e.dir * inset);
        grad.addColorStop(0, 'rgba(38,31,22,0.95)');
        grad.addColorStop(0.45, 'rgba(26,24,18,0.85)');
        grad.addColorStop(1, 'rgba(14,20,20,0)');
        g.fillStyle = grad;
        if (e.axis === 'x') g.fillRect(Math.min(e.pos, e.pos + e.dir * inset), w.y0, inset, w.y1 - w.y0);
        else g.fillRect(w.x0, Math.min(e.pos, e.pos + e.dir * inset), w.x1 - w.x0, inset);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- decals ----------------------------------------------------------------------
  const innerCols = Math.ceil(W / TILE);
  const innerRows = Math.ceil(H / TILE);
  const maxUploads = high ? 2 : 1;
  let uploads = 0, decals = 0;
  const _dirty = [];

  function stampInto(t, img, x, y, angle, sx, sy, alpha, op) {
    const g = t.g;
    const s = t.scale;
    const c = Math.cos(angle) * s, sn = Math.sin(angle) * s;
    g.setTransform(c, sn, -sn, c, 1 + (x - t.x0) * s, 1 + (y - t.y0) * s);
    g.globalAlpha = alpha;
    if (op) g.globalCompositeOperation = op;
    g.drawImage(img, -sx / 2, -sy / 2, sx, sy);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    t.dirty = true;
  }

  let decalSeq = 0;
  /**
   * Paint a persistent ground mark.
   * @param {'blood'|'scorch'|'acid'|'oil'|'gore'} kind
   * @param {number} x world x
   * @param {number} y world y
   * @param {number} r radius (world units)
   * @param {number} [angle] rotation
   * @param {number} [alpha] 0..1 strength
   */
  function decal(kind, x, y, r, angle = 0, alpha = 1) {
    if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < -r || y < -r || x > W + r || y > H + r) return;
    decalSeq++;
    let img, size = r * 2, op = null;
    switch (kind) {
      case 'scorch': img = scorchSprite(); size = r * 2.3; alpha *= 0.9; break;
      case 'acid': { const a = bloodSplats('green'); img = a[decalSeq % a.length]; size = r * 3.2; alpha *= 0.8; break; }
      case 'oil': img = oilSprite(); size = r * 2.2; alpha *= 0.7; break;
      case 'gore': { const a = bloodSplats('red'); img = a[decalSeq % a.length]; size = r * 3.6; break; }
      case 'blood': default: { const a = bloodSplats(decalSeq % 3 ? 'red' : 'dark'); img = a[decalSeq % a.length]; size = r * 3.2; alpha *= 0.85; break; }
    }
    const ext = size * 0.75;
    const c0 = Math.max(0, Math.floor((x - ext) / TILE)), c1 = Math.min(innerCols - 1, Math.floor((x + ext) / TILE));
    const r0 = Math.max(0, Math.floor((y - ext) / TILE)), r1 = Math.min(innerRows - 1, Math.floor((y + ext) / TILE));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const t = tiles[rr * innerCols + cc];
        stampInto(t, img, x, y, angle, size, size, Math.max(0, Math.min(1, alpha)), op);
        if (kind === 'gore') {
          const b = bloodSplats('dark');
          stampInto(t, b[(decalSeq + 3) % b.length], x + Math.cos(angle) * r * 0.6, y + Math.sin(angle) * r * 0.6, angle + 1.3, size * 0.55, size * 0.55, alpha * 0.9, null);
        }
      }
    }
    decals++;
  }

  /** Upload dirty tiles (rate-limited, nearest to the camera first). */
  function update(frame) {
    _dirty.length = 0;
    for (let i = 0; i < innerCols * innerRows; i++) if (tiles[i].dirty) _dirty.push(tiles[i]);
    if (!_dirty.length) return;
    const cx = frame ? frame.camX : 0, cy = frame ? frame.camY : 0;
    const d2 = (t) => {
      const dx = (t.x0 + t.x1) / 2 - cx, dy = (t.y0 + t.y1) / 2 - cy;
      return dx * dx + dy * dy;
    };
    if (_dirty.length > maxUploads) _dirty.sort((a, b) => d2(a) - d2(b));
    for (let i = 0; i < Math.min(maxUploads, _dirty.length); i++) {
      _dirty[i].texture.needsUpdate = true;
      _dirty[i].dirty = false;
      uploads++;
    }
  }

  /** Ground height at a sim point (0 except inside water areas). */
  function heightAt(x, y) {
    return groundHeight(x, y, waters);
  }

  function dispose() {
    for (const t of tiles) {
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      t.texture.dispose();
      t.canvas.width = 1; t.canvas.height = 1;
    }
    detail.dispose();
    scene.remove(group);
    tiles.length = 0;
  }

  return {
    meshes, group, decal, update, waters, heightAt, dispose,
    get stats() { return { tiles: tiles.length, uploads, decals }; },
    /** Wetness 0..1 of hard surfaces (shader uniform). */
    setWetness(v) { uniforms.wetness.value = v; },
  };
}

// ---- map extension ------------------------------------------------------------------------

/** Copy of the map for painting: edge-touching roads/rivers extended by `m` past the bounds. */
function extendMap(map, m) {
  const W = map.width, H = map.height;
  const areas = map.areas.map((a) => {
    if (!EXTEND_KINDS.has(a.kind)) return a;
    const ang = a.a || 0;
    const axis = Math.abs(Math.sin(ang)) < 1e-3 ? 0 : Math.abs(Math.cos(ang)) < 1e-3 ? 1 : -1;
    if (axis < 0) return a;
    const hw = (axis ? a.h : a.w) / 2, hh = (axis ? a.w : a.h) / 2;
    let x0 = a.x - hw, x1 = a.x + hw, y0 = a.y - hh, y1 = a.y + hh;
    if (x0 <= 2) x0 = -m;
    if (x1 >= W - 2) x1 = W + m;
    if (y0 <= 2) y0 = -m;
    if (y1 >= H - 2) y1 = H + m;
    return { kind: a.kind, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, a: 0 };
  });
  const lines = map.lines.map((l) => {
    if (l.kind === 'crosswalk' || l.kind === 'stop') return l;
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const out = { ...l };
    const edge = (x, y) => x <= 2 || y <= 2 || x >= W - 2 || y >= H - 2;
    if (edge(l.x1, l.y1)) { out.x1 = l.x1 - ux * m; out.y1 = l.y1 - uy * m; }
    if (edge(l.x2, l.y2)) { out.x2 = l.x2 + ux * m; out.y2 = l.y2 + uy * m; }
    return out;
  });
  return {
    ...map,
    areas,
    lines,
    decor: map.decor.filter((d) => !MODELLED_DECOR.has(d.kind)),
  };
}

/**
 * Water rectangles (axis aligned) with their edges classified: an edge facing another
 * water rect across a narrow strip is a bridge (vertical drop), an edge on the map bound
 * continues outside, anything else is a sloping bank.
 */
function buildWaters(areas, W, H) {
  const rects = areas.map((a) => ({ x0: a.x - a.w / 2, x1: a.x + a.w / 2, y0: a.y - a.h / 2, y1: a.y + a.h / 2 }));
  for (const r of rects) {
    r.edges = [];
    const sides = [
      { axis: 'x', pos: r.x0, dir: 1, side: 'x0' }, { axis: 'x', pos: r.x1, dir: -1, side: 'x1' },
      { axis: 'y', pos: r.y0, dir: 1, side: 'y0' }, { axis: 'y', pos: r.y1, dir: -1, side: 'y1' },
    ];
    for (const e of sides) {
      e.outside = (e.axis === 'x' && (e.pos < 0 || e.pos > W)) || (e.axis === 'y' && (e.pos < 0 || e.pos > H));
      e.bridge = false;
      if (!e.outside) {
        for (const o of rects) {
          if (o === r) continue;
          if (e.axis === 'y') {
            const overlap = Math.min(r.x1, o.x1) - Math.max(r.x0, o.x0);
            const gap = e.dir < 0 ? o.y0 - r.y1 : r.y0 - o.y1;
            if (overlap > 100 && gap > 0 && gap < 700) e.bridge = true;
          } else {
            const overlap = Math.min(r.y1, o.y1) - Math.max(r.y0, o.y0);
            const gap = e.dir < 0 ? o.x0 - r.x1 : r.x0 - o.x1;
            if (overlap > 100 && gap > 0 && gap < 700) e.bridge = true;
          }
        }
      }
      // an edge past the bounds needs no slope (1e-3: vertical, far out of sight)
      e.inset = e.outside ? 1e-3 : e.bridge ? WATER.drop : WATER.bank;
      r.edges.push(e);
    }
    r.inset = { x0: r.edges[0].inset, x1: r.edges[1].inset, y0: r.edges[2].inset, y1: r.edges[3].inset };
  }
  return rects;
}

function groundHeight(x, y, waters) {
  let h = 0;
  for (const w of waters) {
    if (x <= w.x0 || x >= w.x1 || y <= w.y0 || y >= w.y1) continue;
    const k = Math.min(1, (x - w.x0) / w.inset.x0, (w.x1 - x) / w.inset.x1, (y - w.y0) / w.inset.y0, (w.y1 - y) / w.inset.y1);
    h = Math.min(h, -WATER.depth * k);
  }
  return h;
}

// ---- tile geometry ------------------------------------------------------------------------

function tileGeometry(t, waters) {
  const xs = new Set([t.x0, t.x1]), ys = new Set([t.y0, t.y1]);
  let wet = false;
  for (const w of waters) {
    if (w.x1 < t.x0 || w.x0 > t.x1 || w.y1 < t.y0 || w.y0 > t.y1) continue;
    wet = true;
    for (const v of [w.x0, w.x0 + w.inset.x0, w.x1 - w.inset.x1, w.x1]) if (v > t.x0 && v < t.x1) xs.add(v);
    for (const v of [w.y0, w.y0 + w.inset.y0, w.y1 - w.inset.y1, w.y1]) if (v > t.y0 && v < t.y1) ys.add(v);
  }
  if (wet) {
    // a few regular steps as well so the banks' normals interpolate smoothly
    for (let v = t.x0 + 128; v < t.x1; v += 128) xs.add(v);
    for (let v = t.y0 + 128; v < t.y1; v += 128) ys.add(v);
  }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const nx = X.length, ny = Y.length;
  const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = X[i];
      pos[k * 3 + 1] = wet ? groundHeight(X[i], Y[j], waters) : 0;
      pos[k * 3 + 2] = Y[j];
      uv[k * 2] = (1 + (X[i] - t.x0) * t.scale) / t.pw;
      uv[k * 2 + 1] = (1 + (Y[j] - t.y0) * t.scale) / t.ph;
    }
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = (j + 1) * nx + i, c = j * nx + i + 1, d = (j + 1) * nx + i + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---- material -----------------------------------------------------------------------------

function makeGroundMaterial(tex, uniforms) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = uniforms.detailMap;
    shader.uniforms.wetness = uniforms.wetness;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;\nuniform sampler2D detailMap;\nuniform float wetness;\nfloat gHard;\nfloat gPuddle;\nvec4 gDet;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        gDet = texture2D(detailMap, vGroundXZ / 90.0);
        vec4 gDet2 = texture2D(detailMap, vGroundXZ / 820.0 + vec2(0.37, 0.61));
        float gMax = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float gMin = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float gSat = (gMax - gMin) / max(gMax, 0.001);
        // grey = asphalt, concrete, white paint; yellow paint is saturated but bright
        gHard = (1.0 - smoothstep(0.2, 0.42, gSat)) + smoothstep(0.25, 0.4, gMax) * step(0.42, gSat) * 0.8;
        gHard = clamp(gHard, 0.0, 1.0);
        // the painted tiles were tuned for a darkness overlay; lift them for real lighting
        diffuseColor.rgb *= (0.72 + 0.56 * gDet.r) * 1.45;
        diffuseColor.rgb *= 0.86 + 0.28 * gDet2.b;
        gPuddle = smoothstep(0.56, 0.66, gDet2.g) * gHard * wetness;
        diffuseColor.rgb *= 1.0 - gPuddle * 0.55 - gHard * wetness * 0.12;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, 0.42 - 0.12 * gDet.g, gHard * wetness);
        roughnessFactor = mix(roughnessFactor, 0.05, gPuddle);`);
  };
  // every tile uses the same patched program
  mat.customProgramCacheKey = () => 'hh-ground-v1';
  return mat;
}

let detailCanvas = null;
/** Tiling detail texture: R fine grain, G mid blotches, B broad variation. */
function makeDetailTexture() {
  if (!detailCanvas) {
    const N = 256;
    detailCanvas = document.createElement('canvas');
    detailCanvas.width = detailCanvas.height = N;
    const g = detailCanvas.getContext('2d');
    const img = g.createImageData(N, N);
    const rng = createRng(4242);
    const fine = periodicFbm(32, 3, rng, 0.6);
    const mid = periodicFbm(4, 4, rng, 0.55);
    const broad = periodicFbm(3, 3, rng, 0.5);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N, v = y / N;
        const i = (y * N + x) * 4;
        const speck = rng.next() < 0.04 ? (rng.next() - 0.5) * 0.5 : 0;
        img.data[i] = Math.max(0, Math.min(255, (fine(u, v) + speck) * 255));
        img.data[i + 1] = mid(u, v) * 255;
        img.data[i + 2] = broad(u, v) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(detailCanvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

let oil = null;
function oilSprite() {
  if (oil) return oil;
  oil = document.createElement('canvas');
  oil.width = oil.height = 64;
  const g = oil.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  grad.addColorStop(0, 'rgba(6,6,8,0.8)');
  grad.addColorStop(0.7, 'rgba(8,8,10,0.55)');
  grad.addColorStop(1, 'rgba(8,8,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return oil;
}
