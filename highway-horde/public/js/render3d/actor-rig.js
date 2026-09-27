// GPU rig for crowds: one InstancedMesh per model type whose vertices are bent by a
// tiny bone hierarchy in the vertex shader. The CPU writes each instance's pose (bone
// Euler angles, root offset, world position/yaw/scale, colours, fx) into one row of a
// float DataTexture; the shader fetches it with gl_InstanceID. That keeps 250 animated
// zombies at one draw call per zombie type (SPEC §7.5 budget: ≤ ~60 for 300) while the
// pose logic stays in plain JS where it is easy to tune.
//
// Model space: +X forward, +Y up, +Z to the model's right. Limbs are modelled hanging
// straight down; bone rotations are applied Z (swing forward/back) → X (spread
// sideways) → Y (twist), child first, each about its rest-pose pivot.

import * as THREE from 'three';

export const RIG_BONES = 13;          // 0..12
export const TEX_W = 20;              // texels per instance row
// texel indices
export const T_ROOT = 13, T_SKIN = 14, T_CLOTH = 15, T_ACCENT = 16, T_FX = 17, T_WORLD = 18, T_SCALE = 19;
// bone ids (a shared skeleton layout; types may leave bones unused)
export const B = {
  HIPS: 0, SPINE: 1, HEAD: 2, UARM_L: 3, FARM_L: 4, UARM_R: 5, FARM_R: 6,
  THIGH_L: 7, SHIN_L: 8, THIGH_R: 9, SHIN_R: 10, X1: 11, X2: 12,
};
// colour slots (per-vertex aSlot)
export const SLOT = { FIXED: 0, SKIN: 1, CLOTH: 2, ACCENT: 3, EYE: 4, GLOW: 5 };

const VERT_HEAD = /* glsl */`
uniform highp sampler2D uRigTex;
uniform vec3 uPivot[${RIG_BONES}];
uniform int uParent[${RIG_BONES}];
attribute float aBone;
attribute float aSlot;
vec4 rigTexel(int i) { return texelFetch(uRigTex, ivec2(i, gl_InstanceID), 0); }
mat3 rigRot(vec3 e) {
  float cx = cos(e.x), sx = sin(e.x), cy = cos(e.y), sy = sin(e.y), cz = cos(e.z), sz = sin(e.z);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  return ry * rx * rz;
}
void rigApply(inout vec3 p, inout vec3 n) {
  int b = int(aBone + 0.5);
  for (int k = 0; k < 5; k++) {
    if (b < 0) break;
    mat3 r = rigRot(rigTexel(b).xyz);
    vec3 pv = uPivot[b];
    p = pv + r * (p - pv);
    n = r * n;
    b = uParent[b];
  }
  p += rigTexel(${T_ROOT}).xyz;
  vec4 w = rigTexel(${T_WORLD});
  vec3 s = rigTexel(${T_SCALE}).xyz;
  p *= s;
  n = n / s;
  float c = cos(w.w), si = sin(w.w);
  p = vec3(c * p.x + si * p.z, p.y, -si * p.x + c * p.z) + w.xyz;
  n = normalize(vec3(c * n.x + si * n.z, n.y, -si * n.x + c * n.z));
}
`;

/**
 * Lambert material bent by the rig (+ a matching depth material for spotlight shadows).
 * Adds: slot tinting, emissive eyes/growths, hit flash, a fresnel rim light added after
 * fog so silhouettes stay readable at night (the visual bar asks for pop against fog).
 * @param {{pivots:number[][], parents:number[]}} rig
 * @param {{rim?:string, rimStrength?:number}} opts
 */
export function createRigMaterial(rig, opts = {}) {
  const pivots = [];
  for (let i = 0; i < RIG_BONES; i++) {
    const p = rig.pivots[i] || [0, 0, 0];
    pivots.push(new THREE.Vector3(p[0], p[1], p[2]));
  }
  const parents = [];
  for (let i = 0; i < RIG_BONES; i++) parents.push(rig.parents[i] ?? -1);
  const uniforms = {
    uRigTex: { value: null },
    uPivot: { value: pivots },
    uParent: { value: parents },
    uRimColor: { value: new THREE.Color(opts.rim || '#8fb4ff') },
    uRimStrength: { value: opts.rimStrength ?? 0.35 },
  };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD + 'varying vec3 vRigGlow;\nvarying vec3 vRimCol;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nvec3 rigP; vec3 rigN;\n')
      .replace('#include <color_vertex>', `#include <color_vertex>
  {
    int sl = int(aSlot + 0.5);
    vec4 fx = rigTexel(${T_FX});
    vec3 slotC = vec3(1.0);
    vRigGlow = vec3(0.0);
    if (sl == 1) slotC = rigTexel(${T_SKIN}).rgb;
    else if (sl == 2) slotC = rigTexel(${T_CLOTH}).rgb;
    else if (sl == 3) slotC = rigTexel(${T_ACCENT}).rgb;
    else if (sl == 4) { slotC = rigTexel(${T_ACCENT}).rgb; vRigGlow = slotC * rigTexel(${T_SKIN}).w; }
    else if (sl == 5) vRigGlow = color * 0.35;
    vColor.rgb *= slotC * (1.0 - fx.y * 0.75);
    vRigGlow += vec3(1.0, 0.35, 0.25) * fx.z * 0.5 + vec3(0.5, 0.02, 0.0) * fx.x * 0.25;
    vRimCol = (uRimColor * uRimStrength + vec3(1.0, 0.08, 0.02) * fx.x * 0.9 + vec3(1.0, 0.45, 0.1) * fx.y * 0.6) * fx.w;
  }`)
      .replace('#include <beginnormal_vertex>', 'rigP = position; rigN = normal; rigApply(rigP, rigN);\nvec3 objectNormal = rigN;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = rigP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRigGlow;\nvarying vec3 vRimCol;\n')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vRigGlow;')
      .replace('#include <fog_fragment>', `float rigRim = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  rigRim = rigRim * rigRim * rigRim;
  #include <fog_fragment>
  #ifdef USE_FOG
    // Readability in the fog: glowing eyes, hit flashes and flames shine through it (a
    // pair of eyes in the murk is how a zombie should announce itself) and the rim holds
    // up with distance instead of sinking into the fog colour with the body.
    gl_FragColor.rgb += vRigGlow * fogFactor * 0.85 + vRimCol * rigRim * fogFactor * 1.2;
  #endif
  gl_FragColor.rgb += vRimCol * rigRim;`);
  };
  mat.customProgramCacheKey = () => 'hh-rig-lambert';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', 'vec3 transformed = position; vec3 rigN0 = vec3(0.0, 1.0, 0.0); rigApply(transformed, rigN0);');
  };
  depth.customProgramCacheKey = () => 'hh-rig-depth';
  return { material: mat, depthMaterial: depth, uniforms };
}

/**
 * Per-instance pose storage for one InstancedMesh (rows grow in powers of two up to
 * `capacity`, so only the rows in use are uploaded each frame).
 */
export class RigInstances {
  /**
   * @param {THREE.BufferGeometry} geometry built with PartBuilder.build({rig:true})
   * @param {{pivots:number[][], parents:number[]}} rig
   * @param {number} capacity max instances
   * @param {object} matOpts createRigMaterial options
   */
  constructor(geometry, rig, capacity, matOpts) {
    this.rig = rig;
    this.capacity = capacity;
    this.rows = 0;
    this.count = 0;
    const m = createRigMaterial(rig, matOpts);
    this.uniforms = m.uniforms;
    this.material = m.material;
    this.mesh = new THREE.InstancedMesh(geometry, m.material, capacity);
    this.mesh.customDepthMaterial = m.depthMaterial;
    this.mesh.frustumCulled = false;   // vertices move far from the rest-pose bounds
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.depthMaterial = m.depthMaterial;
    this._grow(16);
  }

  _grow(rows) {
    let r = this.rows || 16;
    while (r < rows) r *= 2;
    r = Math.min(r, Math.max(16, this.capacity));
    if (r === this.rows) return;
    const data = new Float32Array(TEX_W * r * 4);
    if (this.data) data.set(this.data.subarray(0, Math.min(this.data.length, data.length)));
    const tex = new THREE.DataTexture(data, TEX_W, r, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    if (this.texture) this.texture.dispose();
    this.texture = tex;
    this.data = data;
    this.rows = r;
    this.uniforms.uRigTex.value = tex;
  }

  /** Start a frame: instances will be written from row 0. */
  begin() { this.count = 0; }

  /** Claim the next row (or -1 when full) and reset it to the rest pose. */
  push() {
    if (this.count >= this.capacity) return -1;
    if (this.count >= this.rows) this._grow(this.count + 1);
    const i = this.count++;
    this.data.fill(0, i * TEX_W * 4, (i + 1) * TEX_W * 4);
    const o = (i * TEX_W + T_SCALE) * 4;
    this.data[o] = this.data[o + 1] = this.data[o + 2] = 1;
    this.data[(i * TEX_W + T_FX) * 4 + 3] = 1;  // rim on
    return i;
  }

  /** Finish a frame: set the draw count and upload. */
  end() {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) this.texture.needsUpdate = true;
  }

  bone(i, b, x, y, z) {
    const o = (i * TEX_W + b) * 4;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
  }

  texel(i, t, x, y, z, w) {
    const o = (i * TEX_W + t) * 4;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = w;
  }

  /** World placement: sim (x, y) → three (x, h, y), facing sim angle `angle`. */
  place(i, x, h, y, angle, sx, sy = sx, sz = sx) {
    this.texel(i, T_WORLD, x, h, y, -angle);
    this.texel(i, T_SCALE, sx, sy, sz, 0);
  }

  color(i, t, c, w = 0) {
    this.texel(i, t, c.r, c.g, c.b, w);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    if (this.texture) this.texture.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * CPU mirror of the shader's forward kinematics: where does model-space point `p` on
 * bone `bone` of instance `i` end up in world space? Used to put guns in hands.
 * @param {RigInstances} inst
 * @param {number[]} p [x, y, z] model space (mutated copy returned in `out`)
 */
export function rigPoint(inst, i, bone, p, out) {
  const d = inst.data, rig = inst.rig;
  let x = p[0], y = p[1], z = p[2];
  let b = bone;
  for (let k = 0; k < 5 && b >= 0; k++) {
    const o = (i * TEX_W + b) * 4;
    const pv = rig.pivots[b] || [0, 0, 0];
    let vx = x - pv[0], vy = y - pv[1], vz = z - pv[2];
    // Rz
    let c = Math.cos(d[o + 2]), s = Math.sin(d[o + 2]);
    let tx = c * vx - s * vy, ty = s * vx + c * vy;
    vx = tx; vy = ty;
    // Rx
    c = Math.cos(d[o]); s = Math.sin(d[o]);
    ty = c * vy - s * vz; let tz = s * vy + c * vz;
    vy = ty; vz = tz;
    // Ry
    c = Math.cos(d[o + 1]); s = Math.sin(d[o + 1]);
    tx = c * vx + s * vz; tz = -s * vx + c * vz;
    vx = tx; vz = tz;
    x = pv[0] + vx; y = pv[1] + vy; z = pv[2] + vz;
    b = rig.parents[b] ?? -1;
  }
  const ro = (i * TEX_W + T_ROOT) * 4;
  x += d[ro]; y += d[ro + 1]; z += d[ro + 2];
  const wo = (i * TEX_W + T_WORLD) * 4, so = (i * TEX_W + T_SCALE) * 4;
  x *= d[so]; y *= d[so + 1]; z *= d[so + 2];
  const c = Math.cos(d[wo + 3]), s = Math.sin(d[wo + 3]);
  out.x = c * x + s * z + d[wo];
  out.y = y + d[wo + 1];
  out.z = -s * x + c * z + d[wo + 2];
  return out;
}
