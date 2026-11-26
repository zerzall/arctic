// GPU crowd rig for the actors (zombies, survivors). Each model (type × LOD) is one mesh
// drawn with instancing; every instance's skeleton is posed in plain JS (Euler angles per
// bone, easy to tune), forward-kinematics runs on the CPU (20 bones, ~1 µs each) and the
// resulting world-space 3×4 bone matrices go into ONE float DataTexture per pool, uploaded
// once per frame. The vertex shader blends two bone matrices per vertex (smooth elbows,
// knees, shoulders and neck — no gaps between rigid boxes), so it does 6 texel fetches
// and no trigonometry. Instances of all of a pool's meshes live in consecutive rows of
// that texture; each mesh reads its own row range (uRowOffset), so a mesh with no
// instances costs nothing and the whole horde is ~one draw call per model.
//
// Shading is MeshStandardMaterial with procedural detail (actor-tex.js): rot mottle,
// fabric weave, grime and blood masks, skin/cloth normal maps, rotted-through clothing
// (discarded holes that reveal the body underneath), charring and embers while burning,
// glowing eyes/pustules in HDR (they bloom), a fresnel rim that survives fog. The material
// lives in actor-rigmat.js and reads each instance's look from the parameter texels
// (actor-consts.js): garment cuts, patterns, wounds, accessory switches, gear colours.
//
// Model space: +X forward, +Y up, +Z to the model's right. Limbs are modelled hanging
// straight down. Bone rotation R = Ry·Rx·Rz about the bone's pivot (Z swings a hanging
// limb forward, X spreads it sideways, Y twists), child after parent.

import * as THREE from 'three';
import { NB, B, DEFAULT_PARENTS, TEX_W, T_SKIN, T_CLOTH, T_CLOTH2, T_ACCENT, T_HAIR, T_FX, T_FX2, T_FX3, T_VAR1, T_VAR2, T_WND1, T_WND2, T_OPT, T_COL3, T_COL4, T_COL5, T_VAR3 } from './actor-consts.js';
import { makeMaterials } from './actor-rigmat.js';

export { NB, B, DEFAULT_PARENTS, TEX_W, T_SKIN, T_CLOTH, T_CLOTH2, T_ACCENT, T_HAIR, T_FX, T_FX2, T_FX3, T_VAR1, T_VAR2, T_WND1, T_WND2, T_OPT, T_COL3, T_COL4, T_COL5, T_VAR3 };

// ---------------------------------------------------------------------------------------
// pose → matrices

/** Per-instance pose parameters (reuse one per caller; reset() between instances). */
export class Pose {
  constructor() {
    this.rot = new Float32Array(NB * 3);
    this.scl = new Float32Array(NB * 3);
    this.root = new Float32Array(3);        // model-space offset applied after rootRot
    this.rootRot = new Float32Array(3);     // whole-body rotation (Euler, rig order)
    this.rootPivot = new Float32Array(3);   // point the body rotates about
    this.reset();
  }

  reset() {
    this.rot.fill(0);
    this.scl.fill(1);
    this.root.fill(0);
    this.rootRot.fill(0);
    this.rootPivot.fill(0);
    this.x = 0; this.h = 0; this.y = 0; this.angle = 0;
    this.sx = 1; this.sy = 1; this.sz = 1;
    return this;
  }

  set(b, x, y, z) {
    const o = b * 3;
    this.rot[o] = x; this.rot[o + 1] = y; this.rot[o + 2] = z;
    return this;
  }

  add(b, x, y, z) {
    const o = b * 3;
    this.rot[o] += x; this.rot[o + 1] += y; this.rot[o + 2] += z;
    return this;
  }

  scale(b, x, y = x, z = x) {
    const o = b * 3;
    this.scl[o] = x; this.scl[o + 1] = y; this.scl[o + 2] = z;
    return this;
  }

  /** World placement: sim (x, y) at height h, facing sim angle, scaled. */
  place(x, h, y, angle, sx = 1, sy = sx, sz = sx) {
    this.x = x; this.h = h; this.y = y; this.angle = angle;
    this.sx = sx; this.sy = sy; this.sz = sz;
    return this;
  }
}

// 3×4 affine helpers on plain arrays (row-major: r0 r1 r2, each [a b c t])
function eulerMat(o, x, y, z, sx, sy, sz) {
  const cx = Math.cos(x), snx = Math.sin(x), cy = Math.cos(y), sny = Math.sin(y), cz = Math.cos(z), snz = Math.sin(z);
  // R = Ry · Rx · Rz, then scaled per column (S applied first)
  o[0] = (cy * cz + sny * snx * snz) * sx; o[1] = (-cy * snz + sny * snx * cz) * sy; o[2] = sny * cx * sz;
  o[4] = cx * snz * sx; o[5] = cx * cz * sy; o[6] = -snx * sz;
  o[8] = (-sny * cz + cy * snx * snz) * sx; o[9] = (sny * snz + cy * snx * cz) * sy; o[10] = cy * cx * sz;
}

/** out = a · b (3×4 affine), out may not alias a or b. */
function mul(out, a, b) {
  for (let r = 0; r < 12; r += 4) {
    const a0 = a[r], a1 = a[r + 1], a2 = a[r + 2];
    out[r] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    out[r + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    out[r + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    out[r + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a[r + 3];
  }
}

// ---------------------------------------------------------------------------------------

/**
 * A pool of rigged models sharing one bone texture. Usage per frame:
 *   pool.begin(); for each actor: k = pool.push(model); pool.solve(k, model, pose);
 *   pool.color(k, T_SKIN, color, w) ...; pool.end();
 */
export class RigPool {
  /**
   * @param {object} o { capacity, textures: { detail, normal } }
   */
  constructor(o) {
    this.capacity = o.capacity;
    this.models = [];
    this.stage = new Float32Array(o.capacity * TEX_W * 4);
    this.stageModel = new Int32Array(o.capacity);
    this.n = 0;
    this.rows = 0;
    this.shared = {
      uRigTex: { value: null },
      uDetail: { value: o.textures.detail },
      uDetail2: { value: o.textures.detail2 },
      uNrm: { value: o.textures.normal },
      uTime: { value: 0 },
      uCin: { value: 0 },
    };
    this.texture = null;
    this.data = null;
    this._grow(64);
    // FK scratch
    this._w = new Float64Array(12);
    this._l = new Float64Array(12);
    this._t = new Float64Array(12);
    this._rootM = new Float64Array(12);
    this._mats = new Float64Array(NB * 12);
  }

  _grow(rows) {
    let r = this.rows || 64;
    while (r < rows) r *= 2;
    if (r === this.rows) return;
    const data = new Float32Array(TEX_W * r * 4);
    const tex = new THREE.DataTexture(data, TEX_W, r, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    if (this.texture) this.texture.dispose();
    this.texture = tex;
    this.data = data;
    this.rows = r;
    this.shared.uRigTex.value = tex;
  }

  /**
   * Register a model (one mesh).
   * @param {THREE.InstancedBufferGeometry} geometry
   * @param {{pivots:number[][], parents:number[]}} rig
   * @param {object} opts { rim, rimStrength, castShadow, receiveShadow, name }
   */
  addModel(geometry, rig, opts = {}) {
    const m = makeMaterials(this.shared, opts);
    const mesh = new THREE.Mesh(geometry, m.material);
    mesh.customDepthMaterial = m.depth;
    mesh.frustumCulled = false;          // vertices are placed by the rig, not the mesh
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = !!opts.castShadow;
    mesh.receiveShadow = !!opts.receiveShadow;
    mesh.name = opts.name || 'rig';
    geometry.instanceCount = 0;
    const piv = new Float64Array(NB * 3);
    for (let b = 0; b < NB; b++) {
      const p = rig.pivots[b] || [0, 0, 0];
      piv[b * 3] = p[0]; piv[b * 3 + 1] = p[1]; piv[b * 3 + 2] = p[2];
    }
    const model = {
      id: this.models.length, mesh, geometry, material: m.material, depth: m.depth, uniforms: m.uniforms,
      pivots: piv, parents: rig.parents.slice(), count: 0, offset: 0, fill: 0,
    };
    this.models.push(model);
    return model;
  }

  begin(time = 0) {
    this.n = 0;
    this.shared.uTime.value = time;
    for (const m of this.models) m.count = 0;
  }

  /** Claim a staging slot for an instance of `model` (-1 when full). */
  push(model) {
    if (this.n >= this.capacity) return -1;
    const k = this.n++;
    this.stageModel[k] = model.id;
    model.count++;
    const o = k * TEX_W * 4 + T_SKIN * 4;
    this.stage.fill(0, o, (k + 1) * TEX_W * 4);
    this.stage[k * TEX_W * 4 + T_FX * 4 + 3] = 1;     // rim on
    return k;
  }

  /** Drop the most recent push (e.g. culled after posing). */
  pop(model) {
    if (this.n > 0) { this.n--; model.count--; }
  }

  /**
   * Forward kinematics: pose → world bone matrices in staging slot k.
   * @param {number} k
   * @param {object} model from addModel
   * @param {Pose} pose
   */
  solve(k, model, pose) {
    const W = this._w, L = this._l, T = this._t, RM = this._rootM, M = this._mats;
    // world: translate(x, h, y) · rotY(-angle) · scale
    const a = -pose.angle, c = Math.cos(a), s = Math.sin(a);
    W[0] = c * pose.sx; W[1] = 0; W[2] = s * pose.sz; W[3] = pose.x;
    W[4] = 0; W[5] = pose.sy; W[6] = 0; W[7] = pose.h;
    W[8] = -s * pose.sx; W[9] = 0; W[10] = c * pose.sz; W[11] = pose.y;
    // root: offset · pivot · rootRot · -pivot
    const rp = pose.rootPivot, rr = pose.rootRot, ro = pose.root;
    eulerMat(L, rr[0], rr[1], rr[2], 1, 1, 1);
    L[3] = rp[0] - (L[0] * rp[0] + L[1] * rp[1] + L[2] * rp[2]) + ro[0];
    L[7] = rp[1] - (L[4] * rp[0] + L[5] * rp[1] + L[6] * rp[2]) + ro[1];
    L[11] = rp[2] - (L[8] * rp[0] + L[9] * rp[1] + L[10] * rp[2]) + ro[2];
    mul(RM, W, L);
    const piv = model.pivots, par = model.parents, rot = pose.rot, scl = pose.scl;
    const st = this.stage;
    const base = k * TEX_W * 4;
    for (let b = 0; b < NB; b++) {
      const o3 = b * 3;
      eulerMat(L, rot[o3], rot[o3 + 1], rot[o3 + 2], scl[o3], scl[o3 + 1], scl[o3 + 2]);
      const px = piv[o3], py = piv[o3 + 1], pz = piv[o3 + 2];
      L[3] = px - (L[0] * px + L[1] * py + L[2] * pz);
      L[7] = py - (L[4] * px + L[5] * py + L[6] * pz);
      L[11] = pz - (L[8] * px + L[9] * py + L[10] * pz);
      const p = par[b];
      const mo = b * 12;
      if (p < 0) mul(T, RM, L);
      else {
        // parent matrix from the scratch array
        const po = p * 12;
        for (let r = 0; r < 12; r += 4) {
          const a0 = M[po + r], a1 = M[po + r + 1], a2 = M[po + r + 2];
          T[r] = a0 * L[0] + a1 * L[4] + a2 * L[8];
          T[r + 1] = a0 * L[1] + a1 * L[5] + a2 * L[9];
          T[r + 2] = a0 * L[2] + a1 * L[6] + a2 * L[10];
          T[r + 3] = a0 * L[3] + a1 * L[7] + a2 * L[11] + M[po + r + 3];
        }
      }
      for (let i = 0; i < 12; i++) M[mo + i] = T[i];
      const so = base + b * 12;
      for (let i = 0; i < 12; i++) st[so + i] = T[i];
    }
  }

  /** World position of model-space point (x, y, z) carried by bone b of slot k. */
  point(k, b, x, y, z, out) {
    const o = k * TEX_W * 4 + b * 12, d = this.stage;
    out.x = d[o] * x + d[o + 1] * y + d[o + 2] * z + d[o + 3];
    out.y = d[o + 4] * x + d[o + 5] * y + d[o + 6] * z + d[o + 7];
    out.z = d[o + 8] * x + d[o + 9] * y + d[o + 10] * z + d[o + 11];
    return out;
  }

  /** Bone b's world matrix of slot k into a THREE.Matrix4. */
  boneMatrix(k, b, m4) {
    const o = k * TEX_W * 4 + b * 12, d = this.stage;
    m4.set(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6], d[o + 7], d[o + 8], d[o + 9], d[o + 10], d[o + 11], 0, 0, 0, 1);
    return m4;
  }

  texel(k, t, x, y, z, w) {
    const o = k * TEX_W * 4 + t * 4, d = this.stage;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = w;
  }

  color(k, t, c, w = 0) {
    this.texel(k, t, c.r, c.g, c.b, w);
  }

  /** Lay the staged instances out per model and upload. */
  end() {
    let off = 0;
    for (const m of this.models) {
      m.offset = off;
      m.fill = 0;
      off += m.count;
    }
    if (off > this.rows) this._grow(off);
    const st = this.stage, d = this.data, W4 = TEX_W * 4;
    for (let k = 0; k < this.n; k++) {
      const m = this.models[this.stageModel[k]];
      const row = m.offset + m.fill++;
      d.set(st.subarray(k * W4, (k + 1) * W4), row * W4);
    }
    for (const m of this.models) {
      m.geometry.instanceCount = m.count;
      m.mesh.visible = m.count > 0;
      m.uniforms.uRowOffset.value = m.offset;
    }
    if (this.n > 0) this.texture.needsUpdate = true;
  }

  /** Make every mesh visible (for shader warm-up) until the next end(). */
  warm() {
    for (const m of this.models) m.mesh.visible = true;
  }

  dispose() {
    for (const m of this.models) {
      m.mesh.removeFromParent();
      m.geometry.dispose();
      m.material.dispose();
      m.depth.dispose();
    }
    this.models.length = 0;
    if (this.texture) this.texture.dispose();
  }
}

/** Default humanoid skeleton from a pivot table { name: [x,y,z] } (missing → origin). */
export function skeletonFrom(piv, parents = DEFAULT_PARENTS) {
  const pivots = [];
  for (const k in B) pivots[B[k]] = piv[k] || [0, 0, 0];
  return { pivots, parents: parents.slice() };
}

/**
 * Decompose a rotation matrix (rows r0..r2 as THREE.Matrix4 elements, column-major) into
 * the rig's Euler order (R = Ry·Rx·Rz) → out [x, y, z].
 */
export function rigEulerFromMatrix(m4, out) {
  const e = m4.elements;
  // row-major view: R[i][j] = e[j * 4 + i]
  const r02 = e[8], r10 = e[1], r11 = e[5], r12 = e[9], r22 = e[10];
  const sx = Math.max(-1, Math.min(1, -r12));
  out[0] = Math.asin(sx);
  if (Math.abs(sx) < 0.9999) {
    out[2] = Math.atan2(r10, r11);
    out[1] = Math.atan2(r02, r22);
  } else {
    out[2] = 0;
    out[1] = Math.atan2(-e[2], e[0]);
  }
  return out;
}
