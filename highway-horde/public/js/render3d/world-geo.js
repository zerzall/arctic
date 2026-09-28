// Static-world geometry accumulator (WORLD). Every model in world.js is written as a
// handful of primitives (boxes, cylinders, extruded profiles, lofts...) placed in an
// obstacle's local frame; this module transforms them straight into per-material, per-cell
// vertex arrays so the whole static map ends up as a few dozen merged, vertex-coloured meshes.
//
// Buckets flagged `det` also carry the surface of every vertex: `aDet` = (u, v, layer) —
// box-projected coordinates in world units divided by the layer's tile size (world-surf.js),
// so bricks, planks and rust keep their real size on every part — and `aSurf` =
// (roughness, metalness), -1 meaning "the material's own value". That is what lets one
// merged draw call hold brick walls, tyres, canvas and char side by side.
//
// Local frame of an object (matches the top-down art): +x along the obstacle's length
// (`w`, the front of vehicles), +z along its width (`h`, sim local +y), +y up. The object
// frame itself sits at sim (x, y) rotated by the sim angle a, i.e. three.js rotation.y = -a.

import * as THREE from 'three';
import { DET_TILE } from './world-surf.js';

const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _obj = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

const colorCache = new Map();
/** Linear THREE.Color for '#rrggbb' (cached; never mutate the result). */
export function lin(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

/** Mix two '#rrggbb' colours in sRGB space, t = 0..1. */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => {
    const x = (pa >> s) & 255, y = (pb >> s) & 255;
    return Math.round(x + (y - x) * t);
  };
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

/** Lighten (amt > 0) or darken (amt < 0) a '#rrggbb' colour. */
export function shadeHex(hex, amt) {
  return amt >= 0 ? mixHex(hex, '#ffffff', amt) : mixHex(hex, '#000000', -amt);
}

/** Cheap deterministic hash → [0, 1). */
export function hash01(n) {
  n = (n | 0) ^ 0x27d4eb2d;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

/** Small seeded rng (mulberry32) for cosmetic variation that must not change per frame. */
export function seededRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
  };
}

// ---- templates ------------------------------------------------------------------------

const templates = new Map();
function tpl(key, make) {
  let g = templates.get(key);
  if (!g) {
    g = make();
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    templates.set(key, g);
  }
  return g;
}

/**
 * Box with smoothly rounded edges: flat faces, one chamfer strip per edge and a triangle
 * per corner, with the adjacent faces' normals on the chamfer's vertices so shading rolls
 * over the edge like a fillet (44 triangles). Exact size — cached per (size, radius).
 */
function chamferBox(sx, sy, sz, r) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  r = Math.max(0.01, Math.min(r, hx * 0.95, hy * 0.95, hz * 0.95));
  const ix = hx - r, iy = hy - r, iz = hz - r;
  const pos = [], nor = [];
  const tri = (a, na, b, nb, c, nc) => {
    // wind counter-clockwise seen from outside (along the mean normal)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const mx = na[0] + nb[0] + nc[0], my = na[1] + nb[1] + nc[1], mz = na[2] + nb[2] + nc[2];
    if (cx * mx + cy * my + cz * mz < 0) { const t = b; b = c; c = t; const tn = nb; nb = nc; nc = tn; }
    pos.push(...a, ...b, ...c);
    nor.push(...na, ...nb, ...nc);
  };
  const quad = (a, na, b, nb, c, nc, d, nd) => { tri(a, na, b, nb, c, nc); tri(a, na, c, nc, d, nd); };
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const neg = (v) => [-v[0], -v[1], -v[2]];
  // faces
  for (const s of [-1, 1]) {
    const nx = s > 0 ? X : neg(X), ny = s > 0 ? Y : neg(Y), nz = s > 0 ? Z : neg(Z);
    quad([s * hx, -iy, -iz], nx, [s * hx, iy, -iz], nx, [s * hx, iy, iz], nx, [s * hx, -iy, iz], nx);
    quad([-ix, s * hy, -iz], ny, [ix, s * hy, -iz], ny, [ix, s * hy, iz], ny, [-ix, s * hy, iz], ny);
    quad([-ix, -iy, s * hz], nz, [ix, -iy, s * hz], nz, [ix, iy, s * hz], nz, [-ix, iy, s * hz], nz);
  }
  // edges (between two faces) and corners
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      const nxa = a > 0 ? X : neg(X), nyb = b > 0 ? Y : neg(Y), nzb = b > 0 ? Z : neg(Z), nya = a > 0 ? Y : neg(Y);
      // x-y edge along z
      quad([a * hx, b * iy, -iz], nxa, [a * ix, b * hy, -iz], nyb, [a * ix, b * hy, iz], nyb, [a * hx, b * iy, iz], nxa);
      // x-z edge along y
      quad([a * hx, -iy, b * iz], nxa, [a * ix, -iy, b * hz], nzb, [a * ix, iy, b * hz], nzb, [a * hx, iy, b * iz], nxa);
      // y-z edge along x
      quad([-ix, a * hy, b * iz], nya, [-ix, a * iy, b * hz], nzb, [ix, a * iy, b * hz], nzb, [ix, a * hy, b * iz], nya);
      for (const c of [-1, 1]) {
        const nzc = c > 0 ? Z : neg(Z);
        tri([a * hx, b * iy, c * iz], nxa, [a * ix, b * hy, c * iz], nyb, [a * ix, b * iy, c * hz], nzc);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** A filled sack / pillow: a sphere pushed toward a rounded box (flat-ish faces, soft edges). */
function pillow(w = 10, h = 6, p = 0.35) {
  const g = new THREE.SphereGeometry(1, w, h);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), p);
    a.setXYZ(i, f(x), f(y) * 0.92, f(z));
  }
  g.computeVertexNormals();
  return g;
}

/** Unit primitives (centred at the origin, size 1 unless noted). Cached for the page's lifetime. */
export const T = {
  box: () => tpl('box', () => new THREE.BoxGeometry(1, 1, 1)),
  /** Rounded box of an exact size (not unit): place it with scale [1, 1, 1]. */
  rbox: (sx, sy, sz, r) => tpl(`rb${sx.toFixed(1)}:${sy.toFixed(1)}:${sz.toFixed(1)}:${r.toFixed(2)}`, () => chamferBox(sx, sy, sz, r)),
  /** Cylinder along +y, height 1, bottom radius 1, top radius `top`. */
  cyl: (seg = 8, top = 1, open = false) => tpl(`cyl${seg}:${top.toFixed(2)}:${open}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1, open)),
  ico: (detail = 0) => tpl('ico' + detail, () => new THREE.IcosahedronGeometry(1, detail)),
  dodeca: () => tpl('dodeca', () => new THREE.DodecahedronGeometry(1, 0)),
  sphere: (w = 8, h = 6) => tpl(`sph${w}:${h}`, () => new THREE.SphereGeometry(1, w, h)),
  /** Sack: unit-radius pillow shape (sandbags, trash bags). */
  pillow: (w = 10, h = 6, p = 0.35) => tpl(`pil${w}:${h}:${p}`, () => pillow(w, h, p)),
  /** Quad in the XY plane facing +z. */
  plane: () => tpl('plane', () => new THREE.PlaneGeometry(1, 1)),
  /** A grass blade: a thin upright triangle (base width 1 on x, height 1), both sides. */
  blade: () => tpl('blade', () => {
    const g = new THREE.BufferGeometry();
    const p = [-0.5, 0, 0, 0.5, 0, 0, 0.05, 1, 0, 0.5, 0, 0, -0.5, 0, 0, 0.05, 1, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
    return g;
  }),
  torus: (seg = 10, tube = 0.35, rad = 5) => tpl('torus' + seg + ':' + tube + ':' + rad, () => new THREE.TorusGeometry(1, tube, rad, seg)),
  /** Surface of revolution around +y from [[radius, y]...] (bottom to top). */
  lathe: (key, pts, seg = 12) => tpl('lathe:' + key + ':' + seg, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)),
  /**
   * A side profile (array of [x, y] points, counter-clockwise) extruded along z, centred
   * on z = 0. Cached by `key`. Without a bevel the depth is 1 (scale z to size it). With
   * `bevel` (units) the outline's edges are rounded and the template is built at its real
   * `depth` — place it with scale z = 1: scaling would stretch the bevel along z (a
   * beveled unit extrusion is 1 + 2 × bevel deep, which made barriers 2.8x too long).
   */
  profile: (key, pts, bevel = 0, depth = 1) => tpl('prof:' + key + ':' + bevel + (bevel > 0 ? ':' + depth.toFixed(1) : ''), () => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    if (bevel > 0) {
      const b = Math.min(bevel, depth * 0.45);
      const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, depth - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, steps: 1 });
      g.translate(0, 0, -(depth / 2 - b));
      return g;
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -0.5);
    return g;
  }),
  /** Wrap a caller-built geometry as a cached template. */
  custom: (key, make) => tpl('custom:' + key, make),
};

// ---- growable float storage -------------------------------------------------------------

class FBuf {
  constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; }
  need(k) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Float32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  view() { return this.a.slice(0, this.n); }
}

function packSigned(buf, Type, max) {
  const n = buf.n, a = buf.a, out = new Type(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.max(-1, Math.min(1, a[i])) * max);
  return out;
}
function packUnsigned(buf, Type, max) {
  const n = buf.n, a = buf.a, out = new Type(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.max(0, Math.min(1, a[i])) * max);
  return out;
}

// ---- accumulator ---------------------------------------------------------------------

/**
 * Create a geometry accumulator.
 * @param {{ cell: number, buckets: Object<string, {uv?: boolean, ao?: boolean, det?: boolean}> }} opts
 *   cell: spatial cell size (world units) used to split every bucket so off-screen parts
 *   of the map are frustum culled; buckets: which material groups exist.
 */
export function createGeoBuilder(opts) {
  const cellSize = opts.cell || 1200;
  const bucketDefs = opts.buckets;
  const store = new Map();   // bucket → Map(cellKey → {pos, nor, col, uv, det, surf})
  for (const b of Object.keys(bucketDefs)) store.set(b, new Map());
  let cellKey = '0,0';
  let jitter = 0.08;
  let rng = seededRng(1);
  let aoH = 34, aoMin = 0.42;
  let triCount = 0;
  let cellOverride = null;
  // surface state: detail layer, roughness, metalness (-1 = material default)
  let sLayer = 0, sRough = -1, sMetal = -1;
  let uvOffU = 0, uvOffV = 0;

  function target(bucket) {
    const cells = store.get(bucket);
    if (!cells) throw new Error('unknown bucket ' + bucket);
    let t = cells.get(cellKey);
    if (!t) {
      const def = bucketDefs[bucket];
      t = { pos: new FBuf(), nor: new FBuf(), col: new FBuf(), uv: def.uv ? new FBuf() : null, det: def.det ? new FBuf() : null, surf: def.det ? new FBuf() : null };
      cells.set(cellKey, t);
    }
    return t;
  }

  const B = {
    /** Place the object frame at sim (x, y) with sim angle a; seeds colour jitter. */
    obj(x, y, a = 0, seed = 0, groundY = 0) {
      _obj.makeRotationY(-a);
      _obj.setPosition(x, groundY, y);
      cellKey = cellOverride || Math.floor(x / cellSize) + ',' + Math.floor(y / cellSize);
      rng = seededRng((seed * 2654435761) >>> 0);
      sLayer = 0; sRough = -1; sMetal = -1;
      // a per-object texture offset: repeated models never show the same bricks
      uvOffU = rng.next(); uvOffV = rng.next();
      return B;
    },
    get rng() { return rng; },
    /** Force following objects into a named cell (null = by position). */
    setCell(key) { cellOverride = key; return B; },
    /** Per-call colour variation amplitude (0 = exact colours). */
    setJitter(j) { jitter = j; return B; },
    /** Fake ambient occlusion: vertices near the ground are darkened (below `h` units). */
    setAO(h, min) { aoH = h; aoMin = min; return B; },
    /**
     * Surface of the following parts (det buckets): detail layer (world-surf.js DET),
     * roughness and metalness (-1 = the bucket material's own value).
     */
    surf(layer = 0, rough = -1, metal = -1) { sLayer = layer; sRough = rough; sMetal = metal; return B; },
    get triangles() { return triCount; },

    /**
     * Append a template with a local transform (position, euler rotation, scale).
     * @param {string} bucket material group
     * @param {THREE.BufferGeometry} g template
     * @param {number[]} p [x, y, z] local position
     * @param {number[]} s [sx, sy, sz] scale
     * @param {number[]|null} r [rx, ry, rz] euler (XYZ) or null
     * @param {string|THREE.Color} color '#rrggbb' or a linear Color
     * @param {object} [o] { emissive: k (colour multiplier, may exceed 1), uv: [u0,v0,u1,v1]
     *   atlas rect, uvScale: [su, sv] world-repeat, noAO, noJitter, wobble: amplitude of
     *   deterministic vertex displacement (rocks, foliage), surf: [layer, rough, metal],
     *   map: 'box' | 'cyl' | 'uv' (how detail coordinates are projected; default box) }
     */
    add(bucket, g, p, s, r, color, o = null) {
      _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
      _q.setFromEuler(_e);
      _s.set(s[0], s[1], s[2]);
      _p.set(p[0], p[1], p[2]);
      _local.compose(_p, _q, _s);
      _m.multiplyMatrices(_obj, _local);
      write(bucket, g, _m, color, o, p, s);
    },

    /** Append a template with a full world matrix (detail coordinates in world space). */
    addMatrix(bucket, g, m, color, o = null) {
      write(bucket, g, m, color, o, null, null);
    },

    // ---- conveniences (all in the object's local frame) ----

    /** Box centred at (x, y, z) with size (sx, sy, sz). */
    box(bucket, x, y, z, sx, sy, sz, color, r = null, o = null) {
      B.add(bucket, T.box(), [x, y, z], [sx, sy, sz], r, color, o);
    },
    /** Box standing on y0 (bottom face at y0). */
    block(bucket, x, y0, z, sx, sy, sz, color, r = null, o = null) {
      B.add(bucket, T.box(), [x, y0 + sy / 2, z], [sx, sy, sz], r, color, o);
    },
    /** Rounded-edge box standing on y0 (edge radius `rad`). */
    rblock(bucket, x, y0, z, sx, sy, sz, rad, color, r = null, o = null) {
      B.add(bucket, T.rbox(sx, sy, sz, rad), [x, y0 + sy / 2, z], [1, 1, 1], r, color, o);
    },
    /** Rounded-edge box centred at (x, y, z). */
    rbox(bucket, x, y, z, sx, sy, sz, rad, color, r = null, o = null) {
      B.add(bucket, T.rbox(sx, sy, sz, rad), [x, y, z], [1, 1, 1], r, color, o);
    },
    /** Vertical cylinder standing on y0; `top` = top radius / bottom radius. */
    cyl(bucket, x, y0, z, rad, h, color, seg = 8, top = 1, r = null, o = null) {
      const oo = o && o.map ? o : { ...(o || {}), map: 'cyl' };
      if (!r) B.add(bucket, T.cyl(seg, top), [x, y0 + h / 2, z], [rad, h, rad], null, color, oo);
      else B.add(bucket, T.cyl(seg, top), [x, y0, z], [rad, h, rad], r, color, oo);
    },
    /** Horizontal cylinder along local z (wheels, axles), centred at (x, y, z). */
    cylZ(bucket, x, y, z, rad, len, color, seg = 8, o = null) {
      B.add(bucket, T.cyl(seg), [x, y, z], [rad, len, rad], [Math.PI / 2, 0, 0], color, o && o.map ? o : { ...(o || {}), map: 'cyl' });
    },
    /** Horizontal cylinder along local x, centred at (x, y, z). */
    cylX(bucket, x, y, z, rad, len, color, seg = 8, o = null) {
      B.add(bucket, T.cyl(seg), [x, y, z], [rad, len, rad], [0, 0, Math.PI / 2], color, o && o.map ? o : { ...(o || {}), map: 'cyl' });
    },
    /** Profile [[x, y]...] (already in units) extruded along z by `depth`, centred at z. */
    prism(bucket, key, pts, z, depth, color, o = null, bevel = 0) {
      if (bevel > 0) B.add(bucket, T.profile(key, pts, bevel, depth), [0, 0, z], [1, 1, 1], null, color, o);
      else B.add(bucket, T.profile(key, pts), [0, 0, z], [1, 1, depth], null, color, o);
    },

    /**
     * Build one BufferGeometry per (bucket, cell).
     * @returns {Array<{bucket: string, geometry: THREE.BufferGeometry}>}
     */
    finish() {
      const out = [];
      for (const [bucket, cells] of store) {
        const hdr = bucketDefs[bucket].ao === false;   // emissive buckets carry colours > 1
        for (const t of cells.values()) {
          if (!t.pos.n) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(t.pos.view(), 3));
          // packed attributes (~37% less vertex memory): normals in bytes, colours in
          // 16-bit (dark colours keep their precision), surface params in bytes
          g.setAttribute('normal', new THREE.BufferAttribute(packSigned(t.nor, Int8Array, 127), 3, true));
          g.setAttribute('color', hdr ? new THREE.BufferAttribute(t.col.view(), 3) : new THREE.BufferAttribute(packUnsigned(t.col, Uint16Array, 65535), 3, true));
          if (t.uv) g.setAttribute('uv', new THREE.BufferAttribute(t.uv.view(), 2));
          if (t.det) {
            g.setAttribute('aDet', new THREE.BufferAttribute(t.det.view(), 3));
            g.setAttribute('aSurf', new THREE.BufferAttribute(packSigned(t.surf, Int8Array, 127), 2, true));
          }
          g.computeBoundingSphere();
          g.computeBoundingBox();
          out.push({ bucket, geometry: g });
        }
      }
      store.clear();
      return out;
    },
  };

  /**
   * Transform a template into the bucket. `p`/`s` (part position / scale, unrotated) give
   * the detail projection its frame: bricks follow each part's own faces.
   */
  function write(bucket, g, m, color, o, p, s) {
    const t = target(bucket);
    const def = bucketDefs[bucket];
    _nm.getNormalMatrix(m);
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    const ua = g.attributes.uv ? g.attributes.uv.array : null;
    const c = typeof color === 'string' ? lin(color) : color;
    const k = (o && o.emissive) || 1;
    const j = (o && o.noJitter) || !jitter ? 1 : 1 + (rng.next() - 0.5) * 2 * jitter;
    const cr = c.r * k * j, cg = c.g * k * j, cb = c.b * k * j;
    const useAO = def.ao !== false && !(o && o.noAO);
    const wob = o && o.wobble;
    const uvr = o && o.uv, uvs = o && o.uvScale;
    const n = pa.length / 3;
    const n3 = n * 3;
    t.pos.need(n3); t.nor.need(n3); t.col.need(n3);
    if (t.uv) t.uv.need(n * 2);
    let layer = sLayer, rough = sRough, metal = sMetal;
    if (o && o.surf) { layer = o.surf[0]; rough = o.surf[1] ?? -1; metal = o.surf[2] ?? -1; }
    const det = t.det && layer > 0;
    if (t.det) { t.det.need(n3); t.surf.need(n * 2); }
    const tile = DET_TILE[layer] || 64;
    const mode = (o && o.map) || 'box';
    const sx = s ? s[0] : 1, sy = s ? s[1] : 1, sz = s ? s[2] : 1;
    const px0 = p ? p[0] : 0, py0 = p ? p[1] : 0, pz0 = p ? p[2] : 0;
    const P = t.pos.a, NN = t.nor.a, C = t.col.a;
    let pi = t.pos.n;
    for (let i = 0; i < n; i++) {
      let x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
      if (wob) {
        // hash of the template-space vertex: coincident vertices move together (no cracks)
        const h = Math.imul((x * 997 + 13) | 0, 73856093) ^ Math.imul((y * 991 + 7) | 0, 19349663) ^ Math.imul((z * 983 + 3) | 0, 83492791);
        const f = 1 + (hash01(h + (wob.seed | 0)) - 0.5) * 2 * wob.amp;
        x *= f; y *= f; z *= f;
      }
      _v.set(x, y, z).applyMatrix4(m);
      _n.set(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]).applyMatrix3(_nm).normalize();
      P[pi] = _v.x; P[pi + 1] = _v.y; P[pi + 2] = _v.z;
      NN[pi] = _n.x; NN[pi + 1] = _n.y; NN[pi + 2] = _n.z;
      let ao = 1;
      if (useAO && aoH > 0) {
        const hh = Math.max(0, Math.min(1, _v.y / aoH));
        ao = aoMin + (1 - aoMin) * hh * hh * (3 - 2 * hh);
      }
      C[pi] = cr * ao; C[pi + 1] = cg * ao; C[pi + 2] = cb * ao;
      if (t.uv) {
        const U = t.uv.a, ui = t.uv.n;
        const u = ua ? ua[i * 2] : 0, vv = ua ? ua[i * 2 + 1] : 0;
        if (uvr) { U[ui] = uvr[0] + (uvr[2] - uvr[0]) * u; U[ui + 1] = uvr[1] + (uvr[3] - uvr[1]) * vv; }
        else if (uvs) { U[ui] = u * uvs[0]; U[ui + 1] = vv * uvs[1]; }
        else { U[ui] = u; U[ui + 1] = vv; }
        t.uv.n += 2;
      }
      if (t.det) {
        const D = t.det.a, di = t.det.n, S = t.surf.a, si = t.surf.n;
        let du = 0, dv = 0;
        if (det) {
          if (mode === 'uv' && ua) {
            // template uv already in units (lofts), scaled by the part's scale
            du = ua[i * 2] * sx; dv = ua[i * 2 + 1] * sy;
          } else if (mode === 'cyl') {
            const r0 = (sx + sz) * 0.5;
            du = Math.atan2(z, x) * r0; dv = y * sy;
          } else if (s) {
            // box projection in the part's unrotated frame, by the dominant scaled normal
            const lx = px0 + x * sx, ly = py0 + y * sy, lz = pz0 + z * sz;
            const nx = Math.abs(na[i * 3] / sx), ny = Math.abs(na[i * 3 + 1] / sy), nz = Math.abs(na[i * 3 + 2] / sz);
            if (ny >= nx && ny >= nz) { du = lx; dv = lz; } else if (nx >= nz) { du = lz; dv = ly; } else { du = lx; dv = ly; }
          } else {
            const nx = Math.abs(_n.x), ny = Math.abs(_n.y), nz = Math.abs(_n.z);
            if (ny >= nx && ny >= nz) { du = _v.x; dv = _v.z; } else if (nx >= nz) { du = _v.z; dv = _v.y; } else { du = _v.x; dv = _v.y; }
          }
        }
        D[di] = du / tile + uvOffU; D[di + 1] = dv / tile + uvOffV; D[di + 2] = det ? layer : 0;
        S[si] = rough; S[si + 1] = metal;
        t.det.n += 3; t.surf.n += 2;
      }
      pi += 3;
    }
    t.pos.n = pi; t.nor.n = pi; t.col.n = pi;
    triCount += n / 3;
  }

  return B;
}
