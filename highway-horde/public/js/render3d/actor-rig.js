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
// glowing eyes/pustules in HDR (they bloom), a fresnel rim that survives fog.
//
// Model space: +X forward, +Y up, +Z to the model's right. Limbs are modelled hanging
// straight down. Bone rotation R = Ry·Rx·Rz about the bone's pivot (Z swings a hanging
// limb forward, X spreads it sideways, Y twists), child after parent.

import * as THREE from 'three';

export const NB = 20;
export const B = {
  HIPS: 0, SPINE: 1, CHEST: 2, NECK: 3, HEAD: 4, JAW: 5,
  UARM_L: 6, FARM_L: 7, HAND_L: 8, UARM_R: 9, FARM_R: 10, HAND_R: 11,
  THIGH_L: 12, SHIN_L: 13, FOOT_L: 14, THIGH_R: 15, SHIN_R: 16, FOOT_R: 17, X1: 18, X2: 19,
};
export const DEFAULT_PARENTS = [-1, 0, 1, 2, 3, 4, 2, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16, 2, 2];

// row layout: 3 texels (matrix rows) per bone, then per-instance parameters
export const TEX_W = 68;
export const T_SKIN = 60;     // rgb skin, w = rot (0 healthy .. 1 rotten)
export const T_CLOTH = 61;    // rgb shirt/jacket, w = tear (0 intact .. 1 shredded)
export const T_CLOTH2 = 62;   // rgb trousers, w = blood (0 clean .. 1 soaked)
export const T_ACCENT = 63;   // rgb accent / eye colour, w = eye glow (HDR)
export const T_HAIR = 64;     // rgb hair, w = pattern seed (offsets the detail textures)
export const T_FX = 65;       // x buff pulse, y char, z hit flash, w rim strength
export const T_FX2 = 66;      // x burning, y glow parts (HDR), z wet, w frost (cryo: 0.45 chilled, 1 frozen)
export const T_FX3 = 67;      // spare

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
// material

const RIG_VERT_HEAD = /* glsl */`
uniform highp sampler2D uRigTex;
uniform float uRowOffset;
attribute vec2 aBones;
attribute vec4 aInfo;
int rigRow;
vec4 rigT(int i) { return texelFetch(uRigTex, ivec2(i, rigRow), 0); }
vec3 rigP;
vec3 rigN;
void rigSkin() {
  rigRow = gl_InstanceID + int(uRowOffset + 0.5);
  int ba = int(aBones.x + 0.5) * 3;
  vec4 r0 = rigT(ba), r1 = rigT(ba + 1), r2 = rigT(ba + 2);
  float w = aInfo.x;
  if (w > 0.001) {
    int bb = int(aBones.y + 0.5) * 3;
    r0 = mix(r0, rigT(bb), w);
    r1 = mix(r1, rigT(bb + 1), w);
    r2 = mix(r2, rigT(bb + 2), w);
  }
  vec4 p = vec4(position, 1.0);
  rigP = vec3(dot(r0, p), dot(r1, p), dot(r2, p));
  rigN = normalize(vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal)));
}
`;

const VARYINGS = /* glsl */`
varying vec2 vDUv;
varying vec4 vInfo;     // material class, blood mask strength, tear, rot
varying vec4 vFx;       // buff, char, hit flash, rim
varying vec4 vFx2;      // burning, glow, wet, frost
varying vec3 vGlowCol;  // emissive (eyes, pustules) — HDR, blooms
varying vec3 vRimCol;
`;

const FRAG_HEAD = /* glsl */`
uniform sampler2D uDetail;
uniform sampler2D uNrm;
uniform float uTime;
${VARYINGS}
vec4 hhD;
float hhWet;
float hhChar;
int hhM;
vec3 hhPerturb(vec3 N, vec3 eyePos, vec2 uv, vec2 nxy) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, N), q0p = cross(N, q0);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 Bt = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(Bt, Bt));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  return normalize(T * (nxy.x * s) + Bt * (nxy.y * s) + N * nz);
}
`;

/**
 * Standard material bent by the rig, plus the matching shadow depth material. One pair
 * per mesh (they share programs; only uRowOffset differs).
 * @param {object} shared { uRigTex, uDetail, uNrm, uTime } uniform objects shared by the pool
 * @param {object} opts { rim, rimStrength }
 */
function makeMaterials(shared, opts = {}) {
  const uniforms = {
    uRigTex: shared.uRigTex, uDetail: shared.uDetail, uNrm: shared.uNrm, uTime: shared.uTime,
    uRowOffset: { value: 0 },
    uRimColor: { value: new THREE.Color(opts.rim || '#8fb4ff') },
    uRimStrength: { value: opts.rimStrength ?? 0.35 },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_VERT_HEAD + VARYINGS + 'uniform vec3 uRimColor;\nuniform float uRimStrength;\n')
      .replace('#include <beginnormal_vertex>', /* glsl */`
  rigSkin();
  vec3 objectNormal = rigN;
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
  {
    int sl = int(aInfo.y + 0.5);
    vec4 skin = rigT(${T_SKIN}), cloth = rigT(${T_CLOTH}), cloth2 = rigT(${T_CLOTH2}), acc = rigT(${T_ACCENT});
    vec4 hair = rigT(${T_HAIR}), fx = rigT(${T_FX}), fx2 = rigT(${T_FX2});
    vec3 sc = vec3(1.0);
    if (sl == 1) sc = skin.rgb;
    else if (sl == 2) sc = cloth.rgb;
    else if (sl == 3) sc = cloth2.rgb;
    else if (sl == 4) sc = acc.rgb;
    else if (sl == 5) sc = hair.rgb;
    vColor.rgb *= sc;
    float mc = aInfo.z;
    vInfo = vec4(mc, aInfo.w * cloth2.w, cloth.w, skin.w);
    vGlowCol = vec3(0.0);
    if (sl == 6) vGlowCol = color * fx2.y;
    if (abs(mc - 7.0) < 0.5) vGlowCol = acc.rgb * acc.w;
    vFx = fx;
    vFx2 = fx2;
    vDUv = uv + vec2(fract(hair.w * 0.3719), fract(hair.w * 0.6133));
    vRimCol = (uRimColor * uRimStrength + vec3(1.0, 0.06, 0.02) * fx.x * 0.9 + vec3(1.0, 0.45, 0.1) * fx2.x * 0.5) * fx.w;
  }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = rigP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', /* glsl */`
  #include <color_fragment>
  hhD = texture2D(uDetail, vDUv);
  hhM = int(vInfo.x + 0.5);
  hhWet = vFx2.z;
  float rot = vInfo.w;
  if (hhM == 5) {
    // thinning, matted hair: bald patches show the scalp through it
    if (hhD.r * 0.8 + hhD.b * 0.3 < 0.44) discard;
  }
  if (hhM == 2) {
    // rotted-through clothing: blotchy holes that grow with the tear amount
    float tm = hhD.b * 0.55 + hhD.r * 0.25 + hhD.a * 0.2;
    float lim = 1.02 - vInfo.z * 0.5;
    if (tm > lim) discard;
    diffuseColor.rgb *= mix(1.0, 0.35, smoothstep(lim - 0.1, lim, tm));
  }
  if (hhM == 11) {
    // skin stretched over something glowing: split along cracks that show the light
    float tm = hhD.r * 0.7 + hhD.a * 0.3;
    if (tm > 0.5) discard;
    diffuseColor.rgb *= mix(1.0, 0.3, smoothstep(0.4, 0.5, tm));
    hhM = 0;
  }
  if (hhM == 0) {
    vec3 rotTint = mix(vec3(1.0), vec3(0.8, 0.76, 0.6), rot);
    diffuseColor.rgb *= mix(vec3(0.9), (0.52 + hhD.r * 0.6) * rotTint, 0.3 + rot * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.36, 0.44), smoothstep(0.5, 0.92, hhD.b) * rot * 0.75);
  } else if (hhM == 1 || hhM == 2) {
    diffuseColor.rgb *= 0.74 + hhD.g * 0.42;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.45, 0.36), hhD.b * 0.6);
  } else if (hhM == 3 || hhM == 10) {
    diffuseColor.rgb *= 0.8 + hhD.r * 0.3;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.6, hhD.b * 0.5);
  } else if (hhM == 4) {
    diffuseColor.rgb *= 0.82 + hhD.r * 0.25;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.22, 0.12), hhD.b * 0.35);
  } else if (hhM == 5) {
    diffuseColor.rgb *= 0.55 + hhD.r * 0.5;
  } else if (hhM == 6) {
    diffuseColor.rgb *= 0.7 + hhD.r * 0.5;
    hhWet = max(hhWet, 0.75);
  } else if (hhM == 9) {
    diffuseColor.rgb *= 0.85 + hhD.r * 0.25;
  }
  // blood: soaks the painted areas (mouth, hands, wounds, hems) with a ragged splatter
  // edge; old blood dries dark brown where the grime mask is high
  float bl = vInfo.y;
  float bm = smoothstep(0.46, 0.6, bl + (hhD.a - 0.5) * 0.55 + (hhD.b - 0.5) * 0.25);
  if (hhM != 7 && hhM != 8) {
    vec3 bc = mix(vec3(0.2, 0.014, 0.01), vec3(0.075, 0.022, 0.014), smoothstep(0.3, 0.8, hhD.b));
    diffuseColor.rgb = mix(diffuseColor.rgb, bc, bm * 0.94);
    hhWet = max(hhWet, bm * 0.7 * (1.0 - hhD.b));
  }
  // charring while/after burning: black, cracked
  float ch = vFx.y;
  hhChar = smoothstep(1.0 - ch, 1.0 - ch + 0.22, hhD.r * 0.55 + hhD.b * 0.45 + ch * 0.25);
  if (hhM != 7 && hhM != 8) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.018, 0.016), hhChar * 0.94);
  // frost (cryo, vFx2.w): a pale blue-white crust that creeps over the body, glassy
  if (vFx2.w > 0.001 && hhM != 7) {
    float frost = smoothstep(0.2, 0.7, vFx2.w + (hhD.r - 0.5) * 0.6 + (hhD.b - 0.5) * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.78, 0.92), frost * 0.88);
    hhWet = max(hhWet, frost * 0.7);
  }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
  float roughnessFactor = 0.8;
  if (hhM == 0) roughnessFactor = 0.56 + hhD.r * 0.22;
  else if (hhM == 1 || hhM == 2) roughnessFactor = 0.93;
  else if (hhM == 3) roughnessFactor = 0.48 + hhD.b * 0.3;
  else if (hhM == 4) roughnessFactor = 0.42;
  else if (hhM == 5) roughnessFactor = 0.75;
  else if (hhM == 6) roughnessFactor = 0.3;
  else if (hhM == 7) roughnessFactor = 0.12;
  else if (hhM == 9) roughnessFactor = 0.3 + hhD.b * 0.35;
  else if (hhM == 10) roughnessFactor = 0.82;
  roughnessFactor = mix(roughnessFactor, 0.16, hhWet);
  roughnessFactor = mix(roughnessFactor, 0.95, hhChar);`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = hhM == 9 ? 0.8 : 0.0;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
  {
    vec4 nn = texture2D(uNrm, vDUv);
    vec2 nxy;
    if (hhM == 1 || hhM == 2) nxy = (nn.ba * 2.0 - 1.0) * 0.7;
    else if (hhM == 5) nxy = (nn.rg * 2.0 - 1.0) * 0.25;
    else if (hhM == 0) nxy = (nn.rg * 2.0 - 1.0);
    else if (hhM == 6 || hhM == 3 || hhM == 10) nxy = (nn.rg * 2.0 - 1.0) * 0.6;
    else if (hhM == 7 || hhM == 8) nxy = vec2(0.0);
    else nxy = (nn.rg * 2.0 - 1.0) * 0.3;
    normal = hhPerturb(normal, -vViewPosition, vDUv, nxy);
  }`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
  #include <emissivemap_fragment>
  // hit flash: lit surfaces here are ~0.02-0.1 linear (night), and ACES runs at exposure
  // 1.15 / 0.6, so 0.5 read as a white glow and a teammate's per-shot 0.25 turned him pale
  totalEmissiveRadiance += vGlowCol + vec3(1.0, 0.55, 0.4) * vFx.z * 0.16;
  if (vFx2.x > 0.001) {
    // embers glowing in the char cracks while it burns
    float flick = 0.65 + 0.35 * sin(uTime * 17.0 + vDUv.x * 40.0 + vDUv.y * 23.0);
    float emb = smoothstep(0.58, 0.7, hhD.r) * smoothstep(0.1, 0.6, hhChar);
    totalEmissiveRadiance += vec3(3.2, 0.95, 0.18) * emb * vFx2.x * flick;
  }
  // a faint cold glow off the ice so a frozen zombie reads in the dark
  totalEmissiveRadiance += vec3(0.03, 0.09, 0.15) * vFx2.w;`)
      .replace('#include <fog_fragment>', /* glsl */`
  float rigRim = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  rigRim = rigRim * rigRim * rigRim;
  #include <fog_fragment>
  #ifdef USE_FOG
    // glowing eyes and silhouettes hold up in the fog: a pair of eyes in the murk is how
    // a zombie should announce itself
    gl_FragColor.rgb += vGlowCol * fogFactor * 0.8 + vRimCol * rigRim * fogFactor * 1.1;
  #endif
  gl_FragColor.rgb += vRimCol * rigRim;`);
  };
  mat.customProgramCacheKey = () => 'hh-rig2-std';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_VERT_HEAD)
      .replace('#include <begin_vertex>', 'rigSkin(); vec3 transformed = rigP;');
  };
  depth.customProgramCacheKey = () => 'hh-rig2-depth';
  return { material: mat, depth, uniforms };
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
      uNrm: { value: o.textures.normal },
      uTime: { value: 0 },
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
