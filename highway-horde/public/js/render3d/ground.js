// Ground of the first-person view (WORLD, SPEC §7.5). The flat map layers (areas, road
// paint, flat decor, baked contact shadows) are painted with the top-down renderer's own
// painter (render/maplayer.js prepareMap + paintGround) into chunked canvases that become
// CanvasTextures on ground tiles. A skirt of cheaper tiles continues the roads and fields
// past the playable bounds so the world never ends at a hard edge. Water areas sink below
// the ground: the tiles there are subdivided at the water edges and lowered, with muddy
// banks (or a vertical drop where a bridge deck crosses).
//
// The ground material is a MeshStandardMaterial with a shader patch. A map-wide surface
// mask (asphalt / concrete / grass / loose ground, plus obstacle footprints in alpha)
// picks tiling detail layers from the world's detail texture array (world-surf.js):
// asphalt aggregate, poured slabs with joints, grass and gravel/dirt normals and
// roughness, each sampled at two scales so the ground stays crisp at the eye on a 4K
// screen without visible tiling, with each layer's own colour (stones of different rock,
// dry blades) and height: where surfaces meet, the higher texels win (grass tufts over the
// dirt, stones through the sand), and soft ground meets along a wandering line. Hard
// surfaces are wet: glossy, with dark puddles that fill the surface's low spots first and a
// damp rim, mirroring the lamps (scene.environment + the light pool); the lane paint is
// worn through in places and off the aggregate's tops. 'low' uses a plain Lambert with the
// albedo.
//
// Decals (blood, scorch, acid, oil, gore) are painted into the tile canvases; dirty tiles
// are re-uploaded one per frame, nearest to the camera first. Memory is fixed: the
// canvases are allocated once.

import * as THREE from 'three';
import { prepareMap, paintGround } from '../render/maplayer.js';
import { bloodSplats, scorchSprite } from '../render/textures.js';
import { periodicFbm, createRng } from '../render/util.js';
import { terrainOf } from '../shared/terrain.js';
import { planGroundExtras } from './ground-extra.js';
import { normTier, tierAtLeast, tierRow, anisoFor } from './tier.js';
import { setDetailTier } from './world-mat.js';
import { DET_LAYERS } from './world-surf.js';

const TILE = 1024;              // playable-area tile size (world units): ~10 visible draw calls
const SKIRT = 1300;             // how far the ground continues past the map bounds
const SKIRT_TILE = 2200;        // max skirt tile length
const SKIRT_SCALE = 0.16;       // texels per unit beyond the bounds (fog hides it)
/** Texel budget of the playable ground per tier (every map up to 3000 x 3000 stays under it). */
export const GROUND_TEXELS = { cinematic: 22e6, ultra: 10e6, high: 6e6, low: 3e6 };
/** Texels per world unit at most, per tier (cinematic paints 1.25x the ultra density). */
export const GROUND_DENSITY = { cinematic: 1.25, ultra: 1, high: 0.75, low: 0.5 };
/** Water geometry (units): bed depth, surface height, bank width, drop under a bridge. */
export const WATER = { depth: 70, surface: -16, bank: 46, drop: 2 };
// Decor the 3D world models itself — not painted flat into the ground.
const MODELLED_DECOR = new Set(['bush', 'rock', 'cone', 'tire', 'lamp_post', 'sign', 'flag', 'rubble', 'tree_canopy', 'signal', 'pylon']);
const EXTEND_KINDS = new Set(['asphalt', 'concrete', 'gravel', 'water']);

/**
 * Create the ground.
 * @param {object} o { scene, map, quality, renderer }
 * @returns {{ meshes, decal, update, waters, heightAt, dispose, stats }}
 */
export function createGround({ scene, map, quality, renderer, detail }) {
  const high = quality !== 'low';
  const ultra = tierAtLeast(quality, 'ultra');
  let tier = normTier(quality);
  // (the world materials' parallax follows the tier: world.js tells the ground about tier changes)
  setDetailTier(tier);
  // texels per world unit: ultra paints the ground at full detail; a very long map is
  // painted a little coarser (a texel budget per tier: the detail layers carry the close-up
  // grain) so its canvases and textures stay near the other maps' memory
  const scale = Math.min(tierRow(GROUND_DENSITY, tier), Math.sqrt(tierRow(GROUND_TEXELS, tier) / (map.width * map.height)));
  const maxAniso = renderer ? anisoFor(tier, renderer.capabilities.getMaxAnisotropy()) : 1;
  const W = map.width, H = map.height;

  // ---- painting source: the map with edge-touching roads/rivers carried into the skirt
  const terrain = terrainOf(map);
  const ext = extendMap(map, SKIRT);
  const prep = prepareMap(ext);
  const extras = high ? planGroundExtras(map) : null;
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

  const noiseTex = makeDetailTexture();
  noiseTex.anisotropy = maxAniso;
  const mask = buildMask(prep, ext, map, SKIRT);
  const uniforms = {
    detailMap: { value: noiseTex }, wetness: { value: 1 }, uDetail: { value: detail || null },
    uMask: { value: mask.texture }, uMaskRect: { value: new THREE.Vector4(mask.x0, mask.y0, mask.w, mask.h) },
    uTime: { value: 0 }, uRain: { value: 0 }, uDesert: { value: isDesert(map) ? 1 : 0 },
  };
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
    const mat = tier !== 'low' ? makeGroundMaterial(tex, uniforms) : makeLowMaterial(tex);
    const geo = tileGeometry(t, waters, terrain);
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
    // tyre tracks, drains, arrows, ruts, leaf litter (the PBR tiers only)
    if (extras && t.inner) extras.paint(g, rect, { detail: ultra ? 1 : 0 });
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
  // One tile re-upload (≈1.3–2.4 MB plus its mipmaps) every UPLOAD_EVERY frames at most: in
  // a big fight a zombie dies nearly every frame, and a full tile upload per frame was the
  // largest single item in the frame's JS time. Blood shows up ~50 ms late at worst.
  const maxUploads = 1;
  const UPLOAD_EVERY = 3;
  let uploadWait = 0;
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
    uniforms.uTime.value = (uniforms.uTime.value + Math.min(0.1, (frame && frame.dt) || 0.016)) % 1000;
    if (uploadWait > 0) { uploadWait--; return; }
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
    uploadWait = UPLOAD_EVERY - 1;
  }

  /** Ground height at a sim point (0 except inside water areas). */
  function heightAt(x, y) {
    return groundHeight(x, y, waters) + (terrain.flat ? 0 : terrain.height(x, y));
  }

  function dispose() {
    for (const t of tiles) {
      t.mesh.geometry.dispose();
      if (t.hiMat) t.hiMat.dispose();
      if (t.lowMat) t.lowMat.dispose();
      t.mesh.material.dispose();
      t.texture.dispose();
      t.canvas.width = 1; t.canvas.height = 1;
    }
    noiseTex.dispose();
    mask.texture.dispose();
    scene.remove(group);
    tiles.length = 0;
  }

  /** 'low' swaps every tile to a plain Lambert (and back); the PBR materials are kept. */
  function setQuality(q) {
    const nt = normTier(q);
    if (nt === tier) return;
    tier = nt;
    setDetailTier(tier);
    for (const t of tiles) {
      const cur = t.mesh.material;
      if (tier === 'low') {
        if (!cur.isMeshLambertMaterial) { t.hiMat = cur; t.mesh.material = t.lowMat || (t.lowMat = makeLowMaterial(t.texture)); }
      } else if (cur.isMeshLambertMaterial && uniforms.uDetail.value) {
        t.lowMat = cur;
        t.mesh.material = t.hiMat || (t.hiMat = makeGroundMaterial(t.texture, uniforms));
      }
    }
  }

  return {
    meshes, group, decal, update, waters, heightAt, dispose, setQuality, terrain,
    /** Surface mask: RGBA = asphalt, concrete, grass, free of obstacles; rect in world units. */
    mask,
    uniforms,
    get stats() { return { tiles: tiles.length, uploads, decals, mask: [mask.texture.image.width, mask.texture.image.height] }; },
    /** Wetness 0..1 of hard surfaces (shader uniform). */
    setWetness(v) { uniforms.wetness.value = v; },
  };
}

// ---- map extension ------------------------------------------------------------------------

/** Copy of the map for painting: edge-touching roads/rivers extended by `m` past the bounds. */
/** True for a sandy / reddish map ground (the truck stop's desert). */
function isDesert(map) {
  const c = new THREE.Color(map.ground);
  return c.r > c.g * 1.05;
}

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

/** Grid step (units) of the ground mesh over a hill. */
const HILL_STEP = 40;

/** Add the grid lines a terrain feature needs inside tile t (hills: a regular grid; plateaus: their eased edges). */
function terrainLines(t, terrain, xs, ys) {
  const spec = terrain.spec;
  let any = false;
  const hit = (x0, y0, x1, y1) => !(x1 < t.x0 || x0 > t.x1 || y1 < t.y0 || y0 > t.y1);
  for (const h of spec.hills || []) {
    if (!hit(h.x - h.r, h.y - h.r, h.x + h.r, h.y + h.r)) continue;
    any = true;
    for (let v = Math.ceil((h.x - h.r) / HILL_STEP) * HILL_STEP; v < h.x + h.r; v += HILL_STEP) if (v > t.x0 && v < t.x1) xs.add(v);
    for (let v = Math.ceil((h.y - h.r) / HILL_STEP) * HILL_STEP; v < h.y + h.r; v += HILL_STEP) if (v > t.y0 && v < t.y1) ys.add(v);
  }
  for (const p of spec.plateaus || []) {
    if (!hit(p.x0 - p.edge, p.y0 - p.edge, p.x1 + p.edge, p.y1 + p.edge)) continue;
    any = true;
    for (let k = 0; k <= 10; k++) {
      const e = (p.edge * k) / 10;
      for (const v of [p.x0 - e, p.x1 + e]) if (v > t.x0 && v < t.x1) xs.add(v);
      for (const v of [p.y0 - e, p.y1 + e]) if (v > t.y0 && v < t.y1) ys.add(v);
    }
  }
  return any;
}

function tileGeometry(t, waters, terrain) {
  const xs = new Set([t.x0, t.x1]), ys = new Set([t.y0, t.y1]);
  let wet = false;
  const hilly = !!terrain && !terrain.flat && t.inner && terrainLines(t, terrain, xs, ys);
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
      pos[k * 3 + 1] = (wet ? groundHeight(X[i], Y[j], waters) : 0) + (hilly ? terrain.height(X[i], Y[j]) : 0);
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

// ---- surface mask ---------------------------------------------------------------------------

const MASK_SCALE = 0.2;   // texels per world unit (1 texel = 5 units ≈ 15 cm, blended linearly)

/**
 * Paint the surface kinds of the (extended) map into an RGBA mask: R asphalt, G concrete,
 * B grass (grass-coloured base ground included), A = 1 where no obstacle stands (grass is
 * not grown inside cars and walls). Loose ground (dirt, gravel, sand) is what is left.
 */
function buildMask(prep, ext, map, skirt) {
  const x0 = -skirt, y0 = -skirt, w = map.width + skirt * 2, h = map.height + skirt * 2;
  const cw = Math.ceil(w * MASK_SCALE), ch = Math.ceil(h * MASK_SCALE);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  const gc = new THREE.Color(map.ground);
  const grassy = gc.g >= gc.r * 0.95;
  g.fillStyle = grassy ? 'rgb(0,0,255)' : 'rgb(0,0,0)';
  g.fillRect(0, 0, cw, ch);
  g.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, -x0 * MASK_SCALE, -y0 * MASK_SCALE);
  const col = { asphalt: 'rgb(255,0,0)', concrete: 'rgb(0,255,0)', grass: 'rgb(0,0,255)', dirt: 'rgb(0,0,0)', gravel: 'rgb(0,0,0)', sand: 'rgb(0,0,0)', water: 'rgb(0,0,0)' };
  for (const A of prep.areas) {
    g.fillStyle = col[A.def.kind] || 'rgb(0,0,0)';
    g.fill(A.path);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, cw, ch);
  c.width = 1; c.height = 1;
  const data = new Uint8Array(img.data.buffer.slice(0));
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  // obstacle footprints (+ a small margin) → alpha 0
  const obs = map.obstacles.concat(map.objective ? [map.objective] : []);
  for (const o of obs) {
    const ca = Math.cos(o.a || 0), sa = Math.sin(o.a || 0);
    const hw = o.w / 2 + 3, hh = o.h / 2 + 3;
    const ex = Math.abs(ca) * hw + Math.abs(sa) * hh, ey = Math.abs(sa) * hw + Math.abs(ca) * hh;
    const px0 = Math.max(0, Math.floor((o.x - ex - x0) * MASK_SCALE)), px1 = Math.min(cw - 1, Math.ceil((o.x + ex - x0) * MASK_SCALE));
    const py0 = Math.max(0, Math.floor((o.y - ey - y0) * MASK_SCALE)), py1 = Math.min(ch - 1, Math.ceil((o.y + ey - y0) * MASK_SCALE));
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const wx = x0 + (px + 0.5) / MASK_SCALE - o.x, wy = y0 + (py + 0.5) / MASK_SCALE - o.y;
        const lx = wx * ca + wy * sa, ly = -wx * sa + wy * ca;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) data[(py * cw + px) * 4 + 3] = 0;
      }
    }
  }
  // water (+ its banks) → alpha 0 too: nothing grows on the river
  for (const a of ext.areas) {
    if (a.kind !== 'water') continue;
    const m = WATER.bank + 10;
    const px0 = Math.max(0, Math.floor((a.x - a.w / 2 - m - x0) * MASK_SCALE)), px1 = Math.min(cw - 1, Math.ceil((a.x + a.w / 2 + m - x0) * MASK_SCALE));
    const py0 = Math.max(0, Math.floor((a.y - a.h / 2 - m - y0) * MASK_SCALE)), py1 = Math.min(ch - 1, Math.ceil((a.y + a.h / 2 + m - y0) * MASK_SCALE));
    for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) data[(py * cw + px) * 4 + 3] = 0;
  }
  const tex = new THREE.DataTexture(data, cw, ch, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, x0, y0, w, h, data, cw, ch };
}

// ---- material -----------------------------------------------------------------------------

function makeLowMaterial(tex) {
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  // the same lift of the dark painted surfaces as the PBR version (else 'low' is murkier)
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb *= mix(1.45, 1.0, smoothstep(0.08, 0.35, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))));`);
  };
  mat.customProgramCacheKey = () => 'hh-ground-low-v1';
  return mat;
}

/**
 * The ground tiles' PBR material: the painted tile colour under the world's detail layers, picked by
 * the surface mask and height-blended where surfaces meet, with wet hard ground, puddles in the low
 * spots, worn lane paint and curbs. Exported for the shader tests.
 * @param {THREE.Texture} tex the tile's painted canvas
 * @param {object} uniforms the ground's shared uniforms (createGround)
 */
export function makeGroundMaterial(tex, uniforms) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0, envMapIntensity: 0.7 });
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(uniforms)) shader.uniforms[k] = uniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGroundXZ;
        uniform sampler2D detailMap;
        uniform highp sampler2DArray uDetail;
        uniform sampler2D uMask;
        uniform vec4 uMaskRect;
        uniform float wetness, uTime, uRain, uDesert;
        float gHard, gPuddle, gMip, gEdge, gCurb, gDamp, gPaintK;
        vec4 gD, gLC, gCc;
        vec2 gCurbN;
        float gH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // one detail layer at two scales (the second rotated) so it never visibly tiles; the layer's
        // colour / height slice at the first scale goes to gLC
        vec4 gLayer(float layer, float tile, vec2 xz) {
          vec4 a = texture(uDetail, vec3(xz / tile, layer));
          vec2 r = vec2(xz.x * 0.8 - xz.y * 0.6, xz.x * 0.6 + xz.y * 0.8);
          vec4 b = texture(uDetail, vec3(r / (tile * 3.7) + 0.37, layer));
          gLC = texture(uDetail, vec3(xz / tile, layer + ${DET_LAYERS}.0));
          // (the second scale's normals count less: its 3.7x stones read as cobbles in a wet road's reflections)
          return vec4(mix(a.xy, b.xy, 0.16), (a.b + b.b) * 0.5, a.a * 0.7 + b.a * 0.3);
        }
        // a big-scale wear layer (cracks, seams, patches, oil) at two incommensurate scales and angles:
        // returns its deviation from neutral in xy (normal), z (roughness) and w (albedo)
        vec4 gWear(float layer, float tile, vec2 xz, float far) {
          vec4 a = texture(uDetail, vec3(xz / tile, layer));
          vec2 r = vec2(xz.x * 0.6 - xz.y * 0.8, xz.x * 0.8 + xz.y * 0.6);
          vec4 b = texture(uDetail, vec3(r / (tile * 1.63) + 0.21, layer));
          return vec4(((a.xy - 0.5) + (b.xy - 0.5) * 0.7) * far, ((a.b - 0.5) + (b.b - 0.5) * 0.7) * far, (a.a - 0.5) + (b.a - 0.5) * 0.7);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 xz = vGroundXZ;
        vec4 gN = texture2D(detailMap, xz / 820.0 + vec2(0.37, 0.61));
        vec4 gF = texture2D(detailMap, xz / 90.0);
        vec4 mk = texture2D(uMask, (xz - uMaskRect.xy) / uMaskRect.zw);
        // soft ground (grass / dirt) meets along a wandering line; the hard surfaces keep their straight edges
        float wGw = texture2D(uMask, (xz + (gF.rg - 0.5) * 14.0 + (gN.gb - 0.5) * 26.0 - uMaskRect.xy) / uMaskRect.zw).b;
        float wA = mk.r, wC = mk.g, wG = min(mix(mk.b, wGw, 1.0 - clamp(wA + wC, 0.0, 1.0)), max(0.0, 1.0 - wA - wC)), wL = max(0.0, 1.0 - wA - wC - wG);
        float gDist = length(vViewPosition);
        float wearFar = 1.0 - smoothstep(420.0, 1000.0, gDist);
        vec4 sA = vec4(0.5), sC = vec4(0.5), sG = vec4(0.5), sL = vec4(0.5);
        vec4 cA = vec4(0.5, 0.5, 0.0, 0.5), cC = cA, cG = cA, cL = cA;
        if (wA > 0.02) {
          sA = gLayer(16.0, 30.0, xz); cA = gLC;
          vec4 cw = gWear(30.0, 240.0, xz, wearFar);
          sA.xy += cw.xy; sA.b += cw.z; sA.a += cw.w;
          cA.a += cw.w * 0.6;
        }
        if (wC > 0.02) {
          sC = gLayer(17.0, 128.0, xz); cC = gLC;
          vec4 cw = gWear(30.0, 310.0, xz, wearFar);
          sC.xy += cw.xy * 0.6; sC.b += cw.z * 0.6; sC.a += cw.w * 0.6;
          // each poured slab (one per 128 units) a shade of its own; the finer concrete layer on top
          // (pores, fines, trowel marks) so a slab is not a smooth blur at the feet
          sC.a *= 0.9 + 0.2 * gH(floor(xz / 128.0) + 0.5);
          vec4 c1 = texture(uDetail, vec3(xz / 37.0 + 0.19, 2.0));
          sC.xy = mix(sC.xy, c1.xy, 0.45); sC.b = mix(sC.b, c1.b, 0.4); sC.a *= 0.82 + 0.36 * c1.a;
        }
        if (wG > 0.02) { sG = gLayer(18.0, 40.0, xz); cG = gLC; }
        if (wL > 0.02) {
          // loose ground: dirt with patches of gravel; in the desert wind-rippled sand and plates of cracked earth
          float gv = smoothstep(0.4, 0.6, gN.r);
          sL = gLayer(22.0, 44.0, xz); cL = gLC;
          vec4 s2 = gLayer(19.0, 26.0, xz);
          // (the stones stand out of the dirt: the gravel wins where it is higher)
          float gvh = clamp(gv * 1.6 - 0.3 + (gLC.a - cL.a) * 1.2, 0.0, 1.0);
          sL = mix(sL, s2, gvh); cL = mix(cL, gLC, gvh);
          if (uDesert > 0.5) {
            float plates = smoothstep(0.5, 0.64, gN.g * 0.7 + gN.b * 0.3);
            vec4 sd = gLayer(31.0, 44.0, xz); vec4 cd = gLC;
            vec4 sk = gLayer(28.0, 90.0, xz);
            sd = mix(sd, sk, plates); cd = mix(cd, gLC, plates);
            sL = mix(sd, sL, gvh * 0.3); cL = mix(cd, cL, gvh * 0.3);
          }
        }
        // height-blended transitions: where two surfaces meet, the higher texels win (tufts of grass
        // over the dirt, stones through the sand, the road's crumbling edge) instead of a soft fade
        {
          float bA = wA > 0.02 ? wA + cA.a * 0.6 : 0.0, bC = wC > 0.02 ? wC + cC.a * 0.6 : 0.0;
          float bG = wG > 0.02 ? wG + cG.a * 0.6 : 0.0, bL = wL > 0.02 ? wL + cL.a * 0.6 : 0.0;
          float top = max(max(bA, bC), max(bG, bL)) - 0.22;
          bA = max(bA - top, 0.0); bC = max(bC - top, 0.0); bG = max(bG - top, 0.0); bL = max(bL - top, 0.0);
          float bs = max(bA + bC + bG + bL, 1e-4);
          gD = (sA * bA + sC * bC + sG * bG + sL * bL) / bs;
          gCc = (cA * bA + cC * bC + cG * bG + cL * bL) / bs;
        }
        // road edges: asphalt crumbling into the verge, dirt washed onto it; curbs where it meets concrete
        gEdge = smoothstep(0.03, 0.32, wA) * (1.0 - smoothstep(0.6, 0.96, wA));
        gCurb = smoothstep(0.32, 0.5, min(wA, wC)) * (1.0 - smoothstep(0.5, 0.62, abs(wA - wC)));
        gCurbN = vec2(0.0);
        if (gEdge > 0.01 || gCurb > 0.01) {
          vec2 e = vec2(6.0, 0.0);
          float ax = texture2D(uMask, (xz + e.xy - uMaskRect.xy) / uMaskRect.zw).r - texture2D(uMask, (xz - e.xy - uMaskRect.xy) / uMaskRect.zw).r;
          float ay = texture2D(uMask, (xz + e.yx - uMaskRect.xy) / uMaskRect.zw).r - texture2D(uMask, (xz - e.yx - uMaskRect.xy) / uMaskRect.zw).r;
          gCurbN = vec2(ax, ay);
        }
        // minification level of the detail (texels per pixel): far away the averaged normal
        // map would sparkle on the glossy wet road, so detail fades and roughness rises
        vec2 gDx = dFdx(xz), gDy = dFdy(xz);
        gMip = clamp(log2(max(length(gDx), length(gDy)) * float(textureSize(uDetail, 0).x) / 30.0), 0.0, 8.0);
        {
          // fine grain at the player's feet (4K: the layers alone were magnified there)
          float near = 1.0 - smoothstep(60.0, 240.0, gDist);
          if (near > 0.0) {
            vec4 m = texture(uDetail, vec3(xz / 8.5 + 0.13, 23.0 + ${DET_LAYERS}.0));
            gD.xy += (m.xy - 0.5) * 0.55 * near * (1.0 - 0.6 * wetness * clamp(wA + wC, 0.0, 1.0));
            gD.a *= 1.0 + (m.b - 0.5) * 0.3 * near;
          }
        }
        float gMax = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float gMin = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float gSat = (gMax - gMin) / max(gMax, 0.001);
        gHard = clamp(wA + wC, 0.0, 1.0);
        // lane paint: bright, grey or yellow, on a hard surface — worn through in patches, and off the
        // tops of the aggregate everywhere (the paint survives in the low spots)
        float gPaint = smoothstep(0.2, 0.34, gMax) * gHard * (1.0 - smoothstep(0.55, 0.8, gSat) * step(gMax, 0.3));
        float gWear2 = smoothstep(0.46, 0.64, texture2D(detailMap, xz / 11.0).g * 0.6 + gF.r * 0.4);
        gWear2 = max(gWear2, smoothstep(0.62, 0.8, gCc.a + (gF.g - 0.5) * 0.3) * 0.7);
        gPaintK = gPaint * (1.0 - gWear2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.036, 0.04), gPaint * gWear2 * 0.75);
        // the painted tiles were tuned for a darkness overlay: lift the dark surfaces for
        // real lighting, but leave bright paint and litter as they are (no glare)
        float gLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb *= mix(1.45, 1.0, smoothstep(0.08, 0.35, gLum));
        // the layers' albedo: firmer on the hard surfaces (slab joints, stains, aggregate read in the sun),
        // gentler on the soft ground whose painted colour already varies
        diffuseColor.rgb *= mix(0.74 + 0.52 * gD.a, 0.62 + 0.76 * gD.a, gHard * (1.0 - gPaint * 0.7)) * (0.9 + 0.2 * gN.b);
        // the layers' own colour (stones of different rock, dry blades in the grass, rusty soil), not on paint
        {
          vec3 c = diffuseColor.rgb;
          float k = 1.0 - gPaintK;
          c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), gCc.b * k);
          float co = (gCc.r - 0.5) * k, cg = (gCc.g - 0.5) * k;
          diffuseColor.rgb = c * max(vec3(1.0 + co - cg, 1.0 + cg, 1.0 - co - cg), 0.0);
        }
        // large-scale colour: mottled tone everywhere, dry / lush patches in the grass, bleached and rusty
        // patches in the dirt, so a field never reads as one tiling texture
        {
          vec4 mA = texture(uDetail, vec3(xz / 1450.0 + 0.11, 23.0));
          vec4 mB = texture(uDetail, vec3(xz / 380.0 + 0.47, 23.0));
          vec4 mC = texture(uDetail, vec3(xz / 97.0 + 0.83, 23.0));
          float tone = 0.84 + 0.32 * (mA.r * 0.45 + mB.g * 0.35 + mC.g * 0.2);
          diffuseColor.rgb *= tone;
          diffuseColor.rgb *= 1.0 - 0.1 * wC;
          float dryK = smoothstep(0.38, 0.72, mA.a * 0.55 + mB.a * 0.45);
          diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.86, 1.06, 0.88), vec3(1.2, 1.06, 0.7), dryK), wG * 0.85);
          diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.92, 0.9, 0.94), vec3(1.14, 1.0, 0.86), dryK), wL * 0.7);
          // hard surfaces: old tarmac fades to grey in the sun, dark where it is fresher
          diffuseColor.rgb *= 1.0 + (mB.r - 0.5) * 0.3 * (wA + wC);
        }
        // the road edge: crumbled, sanded over; a curb line and gutter where asphalt meets concrete
        {
          float ed = gEdge * (0.55 + 0.9 * texture2D(detailMap, xz / 23.0).r);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.12) * (0.7 + 0.6 * gF.r), clamp(ed, 0.0, 1.0) * 0.55);
          gD.xy += (gF.rg - 0.5) * 0.7 * ed;
          float gut = smoothstep(0.1, 0.4, wA) * (1.0 - smoothstep(0.42, 0.5, wC)) * wC * 2.0;
          diffuseColor.rgb *= 1.0 - 0.32 * clamp(gut, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.33, 0.31) * (0.9 + 0.2 * gF.g), gCurb * 0.75);
        }
        // meadow flowers and pebbles near the eye
        {
          float nearG = (1.0 - smoothstep(110.0, 330.0, gDist)) * smoothstep(0.55, 0.9, wG) * step(0.5, mk.a);
          if (nearG > 0.0) {
            vec2 fc = xz / 6.0;
            vec2 fi = floor(fc);
            float hh = gH(fi);
            if (hh > 0.9) {
              vec2 off = (vec2(gH(fi + 3.1), gH(fi + 7.7)) - 0.5) * 0.7;
              float dm = smoothstep(0.1, 0.035, length(fract(fc) - 0.5 - off));
              vec3 fcol = hh > 0.985 ? vec3(0.9, 0.78, 0.12) : hh > 0.95 ? vec3(0.9, 0.9, 0.86) : hh > 0.925 ? vec3(0.6, 0.28, 0.66) : vec3(0.32, 0.26, 0.14);
              diffuseColor.rgb = mix(diffuseColor.rgb, fcol, dm * nearG * 0.85);
            }
          }
        }
        // puddles: low spots of a broad noise on hard ground (and some on packed dirt); the water fills
        // the surface's own low spots first, so the aggregate's tops stand out of a shallow puddle's rim,
        // and a damp dark margin rings each one
        float gPv = gN.g * 0.85 + gF.g * 0.15 + (0.5 - gCc.a) * 0.16;
        float gSurfW = (wA + wC * 0.6 + wL * 0.08) * wetness * (1.0 - gPaint * 0.5);
        gPuddle = smoothstep(0.585, 0.64, gPv) * gSurfW;
        gDamp = smoothstep(0.53, 0.6, gPv) * gSurfW * (1.0 - gPuddle);
        diffuseColor.rgb *= 1.0 - gPuddle * 0.75 - gDamp * 0.3 - gHard * wetness * 0.1;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // damp concrete stays rougher than wet asphalt: glossier, a fire's reflection on the
        // forecourt broke into streaks that read as wood grain
        float gWetR = mix(0.5, 0.64, clamp(wC / max(wA + wC, 1e-3), 0.0, 1.0));
        float gR = mix(0.92, gWetR, gHard * wetness) + (gD.b - 0.5) * 0.5;
        gR = mix(gR, 0.32, gPaint * 0.5);
        gR = mix(gR, 0.95, clamp(gEdge, 0.0, 1.0) * 0.6);
        gR = max(gR, clamp(gMip * 0.09 - 0.05, 0.0, 0.3));
        gR = mix(gR, gR * 0.6, gDamp);
        roughnessFactor = mix(clamp(gR, 0.08, 1.0), 0.06, gPuddle);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // world-aligned tangent frame: u = +x, v = +z, the flat ground's normal = +y
          // (wet hard ground: a film of water fills between the stones, so the lamps' reflections stay long
          // smooth streaks instead of a glitter of every grain)
          vec2 dn = (gD.xy * 2.0 - 1.0) * (1.0 - gPuddle * 0.97) * 0.9 * (1.0 - clamp(gMip * 0.12 - 0.1, 0.0, 0.55));
          dn *= 1.0 - 0.5 * wetness * gHard - 0.3 * gDamp;
          // a curb's face leans toward the road, its top edge back the other way
          dn += gCurbN * gCurb * 1.5;
          if (uRain > 0.0) {
            // rain rings on the puddles
            vec2 cell = floor(xz / 9.0);
            vec2 f = fract(xz / 9.0) - 0.5;
            float ph = fract(uTime * 0.9 + fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
            float rr = length(f) - ph * 0.45;
            dn += normalize(f + 1e-4) * sin(rr * 40.0) * exp(-abs(rr) * 30.0) * (1.0 - ph) * gPuddle * uRain * 0.6;
          }
          vec3 wN = normalize(vec3(dn.x, 1.0, dn.y));
          vec3 vN = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
          // sloped banks keep their own orientation: tilt the geometric normal instead
          normal = normalize(normal + (vN - (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
        }`);
  };
  // every tile uses the same patched program
  mat.customProgramCacheKey = () => 'hh-ground-v4';
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
