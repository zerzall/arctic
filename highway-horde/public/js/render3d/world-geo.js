// Static-world geometry accumulator (WORLD). Every model in world.js is written as a
// handful of primitives (boxes, cylinders, extruded profiles...) placed in an obstacle's
// local frame; this module transforms them straight into per-material, per-cell vertex
// arrays so the whole static map ends up as a few dozen merged, vertex-coloured meshes.
//
// Local frame of an object (matches the top-down art): +x along the obstacle's length
// (`w`, the front of vehicles), +z along its width (`h`, sim local +y), +y up. The object
// frame itself sits at sim (x, y) rotated by the sim angle a, i.e. three.js rotation.y = -a.

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _obj = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
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

/** Unit primitives (centred at the origin, size 1). Cached for the page's lifetime. */
export const T = {
  box: () => tpl('box', () => new THREE.BoxGeometry(1, 1, 1)),
  /** Cylinder along +y, height 1, bottom radius 1, top radius `top`. */
  cyl: (seg = 8, top = 1, open = false) => tpl(`cyl${seg}:${top.toFixed(2)}:${open}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1, open)),
  ico: (detail = 0) => tpl('ico' + detail, () => new THREE.IcosahedronGeometry(1, detail)),
  dodeca: () => tpl('dodeca', () => new THREE.DodecahedronGeometry(1, 0)),
  sphere: (w = 8, h = 6) => tpl(`sph${w}:${h}`, () => new THREE.SphereGeometry(1, w, h)),
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
  torus: (seg = 10, tube = 0.35) => tpl('torus' + seg + tube, () => new THREE.TorusGeometry(1, tube, 5, seg)),
  /**
   * A side profile (array of [x, y] points, counter-clockwise) extruded along z by 1,
   * centred on z = 0. Cached by `key`.
   */
  profile: (key, pts) => tpl('prof:' + key, () => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -0.5);
    return g;
  }),
};

// ---- accumulator ---------------------------------------------------------------------

/**
 * Create a geometry accumulator.
 * @param {{ cell: number, buckets: Object<string, {uv?: boolean, ao?: boolean}> }} opts
 *   cell: spatial cell size (world units) used to split every bucket so off-screen parts
 *   of the map are frustum culled; buckets: which material groups exist.
 */
export function createGeoBuilder(opts) {
  const cellSize = opts.cell || 1200;
  const bucketDefs = opts.buckets;
  const store = new Map();   // bucket → Map(cellKey → {pos, nor, col, uv})
  for (const b of Object.keys(bucketDefs)) store.set(b, new Map());
  let cellKey = '0,0';
  let jitter = 0.08;
  let rng = seededRng(1);
  let aoH = 34, aoMin = 0.42;
  let triCount = 0;
  let cellOverride = null;

  function target(bucket) {
    const cells = store.get(bucket);
    if (!cells) throw new Error('unknown bucket ' + bucket);
    let t = cells.get(cellKey);
    if (!t) {
      t = { pos: [], nor: [], col: [], uv: [] };
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
      return B;
    },
    get rng() { return rng; },
    /** Force following objects into a named cell (null = by position). */
    setCell(key) { cellOverride = key; return B; },
    /** Per-call colour variation amplitude (0 = exact colours). */
    setJitter(j) { jitter = j; return B; },
    /** Fake ambient occlusion: vertices near the ground are darkened (below `h` units). */
    setAO(h, min) { aoH = h; aoMin = min; return B; },
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
     *   deterministic vertex displacement (rocks, foliage) }
     */
    add(bucket, g, p, s, r, color, o = null) {
      _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
      _q.setFromEuler(_e);
      _s.set(s[0], s[1], s[2]);
      _p.set(p[0], p[1], p[2]);
      _local.compose(_p, _q, _s);
      _m.multiplyMatrices(_obj, _local);
      B.addMatrix(bucket, g, _m, color, o);
    },

    /** Append a template with a full world matrix. */
    addMatrix(bucket, g, m, color, o = null) {
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
        t.pos.push(_v.x, _v.y, _v.z);
        t.nor.push(_n.x, _n.y, _n.z);
        let ao = 1;
        if (useAO && aoH > 0) {
          const hh = Math.max(0, Math.min(1, _v.y / aoH));
          ao = aoMin + (1 - aoMin) * hh * hh * (3 - 2 * hh);
        }
        t.col.push(cr * ao, cg * ao, cb * ao);
        if (def.uv) {
          const u = ua ? ua[i * 2] : 0, vv = ua ? ua[i * 2 + 1] : 0;
          if (uvr) t.uv.push(uvr[0] + (uvr[2] - uvr[0]) * u, uvr[1] + (uvr[3] - uvr[1]) * vv);
          else if (uvs) t.uv.push(u * uvs[0], vv * uvs[1]);
          else t.uv.push(u, vv);
        }
      }
      triCount += n / 3;
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
    /** Vertical cylinder standing on y0; `top` = top radius / bottom radius. */
    cyl(bucket, x, y0, z, rad, h, color, seg = 8, top = 1, r = null, o = null) {
      if (!r) B.add(bucket, T.cyl(seg, top), [x, y0 + h / 2, z], [rad, h, rad], null, color, o);
      else B.add(bucket, T.cyl(seg, top), [x, y0, z], [rad, h, rad], r, color, o);
    },
    /** Horizontal cylinder along local z (wheels, axles), centred at (x, y, z). */
    cylZ(bucket, x, y, z, rad, len, color, seg = 8, o = null) {
      B.add(bucket, T.cyl(seg), [x, y, z], [rad, len, rad], [Math.PI / 2, 0, 0], color, o);
    },
    /** Horizontal cylinder along local x, centred at (x, y, z). */
    cylX(bucket, x, y, z, rad, len, color, seg = 8, o = null) {
      B.add(bucket, T.cyl(seg), [x, y, z], [rad, len, rad], [0, 0, Math.PI / 2], color, o);
    },
    /** Profile [[x, y]...] (already in units) extruded along z by `depth`, centred at z. */
    prism(bucket, key, pts, z, depth, color, o = null) {
      B.add(bucket, T.profile(key, pts), [0, 0, z], [1, 1, depth], null, color, o);
    },

    /**
     * Build one BufferGeometry per (bucket, cell).
     * @returns {Array<{bucket: string, geometry: THREE.BufferGeometry}>}
     */
    finish() {
      const out = [];
      for (const [bucket, cells] of store) {
        for (const t of cells.values()) {
          if (!t.pos.length) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
          g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
          if (bucketDefs[bucket].uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
          g.computeBoundingSphere();
          g.computeBoundingBox();
          out.push({ bucket, geometry: g });
        }
      }
      store.clear();
      return out;
    },
  };
  return B;
}
