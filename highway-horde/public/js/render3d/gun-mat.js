// The gun material (actor-guns.js re-exports createGunMaterial): one MeshStandardMaterial for
// every part of a gun, patched in onBeforeCompile. Each vertex carries `aGun` =
//   (surface class GM, edge wear, family layer + 1 (0: none), carbon soot)
// and the gun-space position / normal are passed on, so the textures need no UVs:
//
// Textured path (#define GUN_TEX, 'high' and up, once gun-tex.js has the baked arrays): the
// family's albedo / roughness / normal / AO / metalness sampled by projection along the gun's
// own axes — box projection (the dominant axis: one sample) or, on the viewmodel at 'ultra' and
// up (#define GUN_TRI), triplanar blending across the edges. Over that: the part's own colour
// (weapons.js colours keep each gun recognisable: `tint` per family), a grip texture where the
// firing hand holds wood (checkering) or polymer (a grip pattern), the player's skin pattern
// (camouflage, carbon, damascus, gold, blood, hazard paint; gun-finish.js GUN_SKINS) on the
// classes it covers, then the ageing from the shared wear overlay: paint chipping off the edges
// first, then the finish worn to bare metal (steel, aluminium, brass) or scuffed pale (polymer,
// rubber) or rubbed to raw wood, scratches, carbon fouling at the muzzle and the ejection port,
// grime in the cavities; on 'cinematic' (#define GUN_CIN) also fingerprints, an oil film round
// the action, and the stamped markings cut into the metal (engraved / paint-filled, with a rim).
//
// Procedural path (no GUN_TEX: 'low'; or until the textures arrive, or if they fail): the small
// atlas of actor-tex.js tiled by the builder's box UVs, as before. Both paths live in the same
// program (a uniform picks), so the textures arriving never recompiles a shader.
//
// The indoor light mask (indoor.js patchIndoor) chains onto this onBeforeCompile; it is set
// once here and never replaced.

import * as THREE from 'three';
import { GUN_FAMILIES, FAMILY_LAYER, GUN_SKINS, PATTERN_LAYER, PATTERN_TILE, skinOf, familyGroup } from '../shared/gun-finish.js';
import { GUN_TEX_UNIFORMS } from './gun-tex.js';

const L = GUN_FAMILIES.length;
const BARE = { steel: 0, alu: 1, brass: 2, scuff: 3, wood: 4 };
const toLin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const f5 = (v) => (Math.round(v * 1e5) / 1e5).toFixed(5);
const FAM_CONST = /* glsl */`
const float FAM_TILE[${L}] = float[${L}](${GUN_FAMILIES.map((f) => f5(1 / f.tile)).join(', ')});
const float FAM_TINT[${L}] = float[${L}](${GUN_FAMILIES.map((f) => f5(f.tint)).join(', ')});
const vec3 FAM_REF[${L}] = vec3[${L}](${GUN_FAMILIES.map((f) => `vec3(${toLin(f.ref).map(f5).join(', ')})`).join(', ')});
const int FAM_BARE[${L}] = int[${L}](${GUN_FAMILIES.map((f) => BARE[f.bare] ?? 0).join(', ')});
const float LAYER_CHECKER = ${f5(FAMILY_LAYER.checker)};
const float LAYER_PGRIP = ${f5(FAMILY_LAYER.poly_grip)};
const float TILE_CHECKER = ${f5(1 / GUN_FAMILIES[FAMILY_LAYER.checker].tile)};
const float TILE_PGRIP = ${f5(1 / GUN_FAMILIES[FAMILY_LAYER.poly_grip].tile)};
`;

const GUN_VERT = /* glsl */`
attribute vec4 aGun;
varying vec4 vGun;
varying vec2 vGUv;
#ifdef GUN_TEX
varying vec3 vGP;
varying vec3 vGN;
varying vec3 vGAx;
varying vec3 vGAy;
varying vec3 vGAz;
#endif
`;

// the gun's axes in view space (an instanced prop turns them by its instance matrix)
const GUN_VERT_MAIN = /* glsl */`
vGun = aGun; vGUv = uv;
#ifdef GUN_TEX
vGP = position; vGN = normal;
mat3 gIm = mat3(1.0);
#ifdef USE_INSTANCING
gIm = mat3(instanceMatrix);
#endif
vGAx = normalize(normalMatrix * (gIm * vec3(1.0, 0.0, 0.0)));
vGAy = normalize(normalMatrix * (gIm * vec3(0.0, 1.0, 0.0)));
vGAz = normalize(normalMatrix * (gIm * vec3(0.0, 0.0, 1.0)));
#endif
`;

const GUN_FRAG = /* glsl */`
uniform sampler2D uGunAtlas;
uniform sampler2D uMark;
varying vec4 vGun;
varying vec2 vGUv;
vec4 gT;
vec4 gT2;
int gM;
float gWear;
float gMarkA = 1.0;
bool gTexOn = false;
vec3 gPerturb(vec3 N, vec3 eyePos, vec2 uv, vec2 nxy) {
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
#ifdef GUN_TEX
precision highp sampler2DArray;
uniform sampler2DArray uFamA;
uniform sampler2DArray uFamB;
uniform sampler2DArray uSkinA;
uniform sampler2DArray uSkinB;
uniform sampler2D uWear;
uniform float uGunTexOn;
uniform float uGunSkinOn;
uniform float uGunWearOn;
uniform vec4 uSkin;       // pattern layer (-1 none), 1 / pattern tile, edge-wear ×, grime ×
uniform vec4 uSkin2;      // scratch ×, metalness override (-1), roughness override (-1), normal strength
uniform int uSkinMask;    // family layers the skin covers (bit per layer)
uniform vec4 uHolster;    // holster wear: from x0 to x1 along the gun, strength
uniform vec4 uSootM;      // muzzle (gun space) + fouling strength
uniform vec4 uSootE;      // ejection port + fouling strength
varying vec3 vGP;
varying vec3 vGN;
varying vec3 vGAx;
varying vec3 vGAy;
varying vec3 vGAz;
${FAM_CONST}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 gW;                  // projection weights (x, y, z planes)
vec3 gAx, gAy, gAz;       // the gun's axes in view space
vec3 gDN;                 // normal perturbation, view space
vec3 gAlb;
float gRough, gMetal, gAO;
vec3 gPdx, gPdy;          // screen derivatives of the gun-space position
// sample a pair of texture arrays by projection; dn: the view-space normal perturbation
void gSample(sampler2DArray A, sampler2DArray B, float layer, float k, out vec4 a, out vec4 b, out vec3 dn) {
  vec3 p = vGP * k, px = gPdx * k, py = gPdy * k;
  a = vec4(0.0); b = vec4(0.0); dn = vec3(0.0);
  if (gW.z > 0.0) {
    vec4 ta = textureGrad(A, vec3(p.xy, layer), px.xy, py.xy), tb = textureGrad(B, vec3(p.xy, layer), px.xy, py.xy);
    vec2 n = tb.xy * 2.0 - 1.0;
    a += ta * gW.z; b += tb * gW.z; dn += gW.z * (n.x * gAx + n.y * gAy);
  }
  if (gW.y > 0.0) {
    vec4 ta = textureGrad(A, vec3(p.xz, layer), px.xz, py.xz), tb = textureGrad(B, vec3(p.xz, layer), px.xz, py.xz);
    vec2 n = tb.xy * 2.0 - 1.0;
    a += ta * gW.y; b += tb * gW.y; dn += gW.y * (n.x * gAx + n.y * gAz);
  }
  if (gW.x > 0.0) {
    vec4 ta = textureGrad(A, vec3(p.zy, layer), px.zy, py.zy), tb = textureGrad(B, vec3(p.zy, layer), px.zy, py.zy);
    vec2 n = tb.xy * 2.0 - 1.0;
    a += ta * gW.x; b += tb * gW.x; dn += gW.x * (n.x * gAz + n.y * gAy);
  }
}
vec4 gWearAt(float k) {
  vec3 p = vGP * k, px = gPdx * k, py = gPdy * k;
  // (the dominant plane only: the overlay is a breakup, a seam in it never shows)
  if (gW.z >= gW.x && gW.z >= gW.y) return textureGrad(uWear, p.xy, px.xy, py.xy);
  if (gW.y >= gW.x) return textureGrad(uWear, p.xz, px.xz, py.xz);
  return textureGrad(uWear, p.zy, px.zy, py.zy);
}
float gGripZone(vec3 p) {
  // where the firing hand wraps the grip (the origin of every gun, actor-guns.js)
  float x = smoothstep(-3.3, -2.8, p.x) * (1.0 - smoothstep(0.9, 1.4, p.x));
  float y = smoothstep(-5.6, -5.1, p.y) * (1.0 - smoothstep(-0.7, -0.3, p.y));
  return x * y;
}
#endif
`;

/** The texturing part of color_fragment (GUN_TEX): fills gAlb / gRough / gMetal / gAO / gDN. */
const TEX_COLOR = /* glsl */`
#ifdef GUN_TEX
  int gL = int(vGun.z + 0.5) - 1;
  gTexOn = uGunTexOn > 0.5 && gL >= 0 && gM != 6;
  if (gTexOn) {
    vec3 an = abs(normalize(vGN));
    #ifdef GUN_TRI
    vec3 w = pow(an, vec3(6.0));
    w /= (w.x + w.y + w.z);
    w = max(w - 0.06, 0.0);
    gW = w / (w.x + w.y + w.z);
    #else
    gW = an.z >= an.x && an.z >= an.y ? vec3(0.0, 0.0, 1.0) : an.y >= an.x ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    #endif
    gAx = normalize(vGAx); gAy = normalize(vGAy); gAz = normalize(vGAz);
    gPdx = dFdx(vGP); gPdy = dFdy(vGP);
    float layer = float(gL);
    vec4 a, b;
    gSample(uFamA, uFamB, layer, FAM_TILE[gL], a, b, gDN);
    vec3 ref = FAM_REF[gL];
    vec3 vc = vColor.rgb;
    float lr = clamp(dot(vc, LUMA) / max(dot(ref, LUMA), 1e-4), 0.06, 2.4);
    vec3 tint = mix(vec3(lr), clamp(vc / max(ref, vec3(1e-4)), 0.0, 3.0), FAM_TINT[gL]);
    gAlb = a.rgb * tint;
    gRough = a.a; gAO = b.z; gMetal = b.w;
    // the grip: checkering on wood, a moulded grip pattern on polymer
    if (gM == 2 || gM == 3) {
      float gz = gGripZone(vGP);
      if (gz > 0.01) {
        vec4 ga, gb; vec3 gdn;
        gSample(uFamA, uFamB, gM == 3 ? LAYER_CHECKER : LAYER_PGRIP, gM == 3 ? TILE_CHECKER : TILE_PGRIP, ga, gb, gdn);
        gAlb *= mix(vec3(1.0), ga.rgb / 0.2159, gz);
        gRough = mix(gRough, ga.a, gz);
        gAO *= mix(1.0, gb.z, gz);
        gDN = mix(gDN, gdn, gz);
      }
    }
    vec4 wt = uGunWearOn > 0.5 ? gWearAt(0.07) : vec4(0.0, 0.5, 0.0, 0.5);
    float holster = uHolster.z * smoothstep(uHolster.x, uHolster.y, vGP.x);
    float edge = clamp(gWear * uSkin.z + holster * 0.4, 0.0, 1.8);
    float brk = wt.g - 0.5;
    float wm = smoothstep(0.42, 0.74, edge + brk * 0.95 + holster * (wt.g - 0.3) * 0.5);
    float scr = smoothstep(0.22, 0.85, wt.r * uSkin2.x * 0.75);
    // the skin, over the classes it covers; its paint wears off the edges before the finish does
    float cov = 0.0;
    if (uSkin.x >= 0.0 && uGunSkinOn > 0.5 && ((uSkinMask >> gL) & 1) != 0) {
      vec4 sa, sb; vec3 sdn;
      gSample(uSkinA, uSkinB, uSkin.x, uSkin.y, sa, sb, sdn);
      float chip = smoothstep(0.28, 0.56, edge + brk * 0.95);
      cov = sa.a * (1.0 - chip) * (1.0 - scr * 0.8);
      gAlb = mix(gAlb, sa.rgb, cov);
      gRough = mix(gRough, uSkin2.z >= 0.0 ? uSkin2.z : sb.z, cov);
      gMetal = mix(gMetal, uSkin2.y >= 0.0 ? uSkin2.y : sb.w, cov);
      gDN = mix(gDN, gDN * 0.25 + sdn * uSkin2.w, cov);
    }
    // what the wear exposes: bare metal, pale scuffed polymer / rubber, raw wood
    int bare = FAM_BARE[gL];
    float wk = (0.85 + wt.a * 0.25);
    if (bare <= 2) {
      vec3 bc = bare == 1 ? vec3(0.80, 0.81, 0.83) : bare == 2 ? vec3(0.95, 0.73, 0.38) : vec3(0.56, 0.57, 0.59);
      gAlb = mix(gAlb, bc * wk, wm);
      gMetal = mix(gMetal, 1.0, wm);
      gRough = mix(gRough, 0.24 + wt.a * 0.12, wm);
      float s = scr * (1.0 - wm) * (1.0 - cov * 0.5);
      gAlb = mix(gAlb, bc, s * 0.5);
      gMetal = mix(gMetal, 1.0, s * 0.6);
      gRough = mix(gRough, 0.3, s * 0.5);
    } else if (bare == 3) {
      float s = max(wm * 0.65, scr * 0.45);
      gAlb = mix(gAlb, gAlb * 1.7 + 0.03, s);
      gRough = mix(gRough, min(1.0, gRough + 0.12), s);
    } else {
      float s = max(wm * 0.7, scr * 0.4);
      gAlb = mix(gAlb, gAlb * 1.45 + vec3(0.035, 0.022, 0.01), s);
      gRough = mix(gRough, 0.72, s);
    }
    // carbon fouling at the muzzle and the ejection port, grime in the cavities
    float soot = vGun.w;
    soot = max(soot, uSootM.w * exp(-length(vGP - uSootM.xyz) * 0.6));
    soot = max(soot, uSootE.w * exp(-length(vGP - uSootE.xyz) * 0.9));
    soot = clamp(soot * uSkin.w * (0.45 + wt.a * 0.9), 0.0, 1.0);
    gAlb = mix(gAlb, vec3(0.022, 0.02, 0.018), soot * 0.85);
    gRough = mix(gRough, 0.86, soot * 0.75);
    gMetal = mix(gMetal, 0.0, soot * 0.75);
    gAlb *= mix(1.0, 0.62, clamp((1.0 - gAO) * uSkin.w * 0.8, 0.0, 1.0));
    #ifdef GUN_CIN
    // fingerprints and smudges (matte on gloss, greasy on matte), an oil film round the action
    float fp = wt.b * (gM <= 1 || gM == 7 ? 0.8 : 0.45) * (1.0 - soot);
    gRough = mix(gRough, gRough < 0.42 ? gRough + 0.2 : gRough - 0.16, fp);
    float oil = uSootE.w * exp(-length(vGP - uSootE.xyz) * 0.45) * (1.0 - wm) * (gM <= 1 ? 1.0 : 0.4);
    gRough = mix(gRough, gRough * 0.5, oil * 0.75);
    gAlb *= 1.0 - oil * 0.18;
    #endif
    // stamped markings: the surface they are on, cut into it (dark) or paint-filled
    if (gM == 8) {
      if (vGun.y > 0.5) { gAlb = vec3(0.70, 0.69, 0.64); gRough = 0.6; gMetal = 0.0; }
      else { gAlb *= 0.28; gRough = min(1.0, gRough + 0.25); gMetal *= 0.6; }
    }
    diffuseColor.rgb = gAlb;
  }
#endif
`;

/** The procedural atlas path (as the guns were before the baked textures). */
const ATLAS_COLOR = /* glsl */`
  if (!gTexOn) {
    vec2 tile = gM == 2 ? vec2(0.5, 0.0) : gM == 3 ? vec2(0.0, 0.5) : gM == 4 ? vec2(0.5, 0.5) : vec2(0.0);
    float aN = float(textureSize(uGunAtlas, 0).x);
    vec2 f = fract(vGUv);
    vec2 a = tile + f * (0.5 - 4.0 / aN) + 2.0 / aN;
    gT = textureGrad(uGunAtlas, a, dFdx(vGUv) * 0.5, dFdy(vGUv) * 0.5);
    gT2 = gT;
    #ifdef GUN_CIN
    vec2 f2 = fract(vGUv * 3.7 + vec2(0.37, 0.11));
    vec2 a2 = tile + f2 * (0.5 - 4.0 / aN) + 2.0 / aN;
    gT2 = textureGrad(uGunAtlas, a2, dFdx(vGUv) * 0.5 * 3.7, dFdy(vGUv) * 0.5 * 3.7);
    #endif
    float alb = gM == 3 ? 0.45 + gT.r * 0.75 : 0.72 + gT.r * 0.36;
    diffuseColor.rgb *= alb;
    float wm = smoothstep(0.3, 0.75, gWear + (gT.a - 0.45) * 0.6);
    if (gM <= 1 || gM == 7) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.52, 0.53, 0.55), wm * 0.75);
    if (gM == 8) diffuseColor.rgb = diffuseColor.rgb / max(alb, 0.001);
    else if (gM == 2 || gM == 4) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.7 + 0.03, wm * 0.45);
    else if (gM == 3) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5, wm * 0.5);
  }
`;

const ROUGH = /* glsl */`
  float roughnessFactor = 0.5;
  #ifdef GUN_TEX
  if (gTexOn) roughnessFactor = clamp(gRough, 0.04, 1.0);
  #endif
  if (!gTexOn) {
    float wm = smoothstep(0.3, 0.75, gWear + (gT.a - 0.45) * 0.6);
    if (gM == 0) roughnessFactor = 0.38 + gT.a * 0.5;
    else if (gM == 1) roughnessFactor = 0.45 + gT.a * 0.4;
    else if (gM == 2) roughnessFactor = 0.35 + gT.a * 0.55;
    else if (gM == 3) roughnessFactor = 0.3 + gT.a * 0.5;
    else if (gM == 4) roughnessFactor = 0.55 + gT.a * 0.4;
    else if (gM == 5) roughnessFactor = 0.22 + gT.a * 0.2;
    else if (gM == 6) roughnessFactor = 0.04;
    else if (gM == 7) roughnessFactor = 0.38 + gT.a * 0.35;
    else if (gM == 8) roughnessFactor = 0.7;
    if (gM <= 1 || gM == 7) roughnessFactor = mix(roughnessFactor, 0.24, wm);
    #ifdef GUN_CIN
    if (gM != 6 && gM != 8) roughnessFactor = clamp(roughnessFactor + (gT2.a - 0.5) * 0.22 + (gT.r - 0.5) * 0.08, 0.04, 1.0);
    #endif
  }
`;

const METAL = /* glsl */`
  float metalnessFactor = 0.0;
  #ifdef GUN_TEX
  if (gTexOn) metalnessFactor = clamp(gMetal, 0.0, 1.0);
  #endif
  if (!gTexOn) {
    // parkerized steel and anodised alloy are finishes over the metal: mostly matte and
    // dark; only the worn edges show bare, fully metallic steel
    float wm = smoothstep(0.3, 0.75, gWear + (gT.a - 0.45) * 0.6);
    metalnessFactor = gM == 0 ? 0.5 + wm * 0.5 : gM == 1 ? 0.3 + wm * 0.7 : gM == 5 ? 1.0 : gM == 6 ? 0.3 : gM == 7 ? 0.15 + wm * 0.8 : 0.0;
  }
`;

const NORMAL = /* glsl */`
  #ifdef GUN_TEX
  if (gTexOn) {
    normal = normalize(normal + gDN);
    #ifdef GUN_CIN
    if (gM == 8) {
      // the cut's rim: the label's alpha ramps up over its edge
      vec2 g = vec2(dFdx(gMarkA), dFdy(gMarkA));
      normal = normalize(normal + vec3(-g, 0.0) * (vGun.y > 0.5 ? 0.6 : 1.4));
    }
    #endif
  }
  #endif
  if (!gTexOn) {
    float ns = gM == 3 ? 0.7 : gM == 4 ? 1.1 : gM == 6 || gM == 8 ? 0.0 : gM == 2 ? 0.8 : 0.55;
    vec2 nxy = (gT.gb * 2.0 - 1.0) * ns;
    #ifdef GUN_CIN
    nxy += (gT2.gb * 2.0 - 1.0) * ns * 0.45;
    #endif
    normal = gPerturb(normal, -vViewPosition, vGUv, nxy);
  }
`;

/** Per-material uniform values of a skin (the skin texture array layer, wear / grime / overrides). */
function skinUniforms(skinId) {
  const s = skinOf(skinId);
  const layer = s.pattern ? PATTERN_LAYER[s.pattern] : -1;
  let mask = 0;
  GUN_FAMILIES.forEach((f, i) => { if (s.covers.includes(familyGroup(f.id))) mask |= 1 << i; });
  return {
    skin: [layer ?? -1, s.pattern ? 1 / PATTERN_TILE[s.pattern] : 0, s.wear, s.grime],
    skin2: [s.scratch, s.metal ?? -1, s.rough ?? -1, s.pattern === 'carbon' || s.pattern === 'damascus' ? 0.9 : 0.6],
    mask,
  };
}

/**
 * The gun material. opts: { envMap, envIntensity, mark, cinematic, textured (compile the
 * baked-texture path), triplanar, skin }.
 */
export function createGunMaterial(atlas, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5, envMap: opts.envMap || null, envMapIntensity: opts.envIntensity ?? 1 });
  const textured = !!opts.textured;
  const tri = textured && !!opts.triplanar;
  const su = skinUniforms(opts.skin);
  const own = {
    uGunAtlas: { value: atlas },
    uMark: { value: opts.mark || atlas },
    uSkin: { value: new THREE.Vector4(...su.skin) },
    uSkin2: { value: new THREE.Vector4(...su.skin2) },
    uSkinMask: { value: su.mask },
    uHolster: { value: new THREE.Vector4(0, 1, 0, 0) },
    uSootM: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSootE: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, own);
    if (textured) Object.assign(sh.uniforms, GUN_TEX_UNIFORMS);
    let defs = '';
    if (opts.cinematic) defs += '#define GUN_CIN\n';
    if (textured) defs += '#define GUN_TEX\n';
    if (tri) defs += '#define GUN_TRI\n';
    sh.vertexShader = defs + sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GUN_VERT)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + GUN_VERT_MAIN);
    sh.fragmentShader = defs + sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GUN_FRAG)
      .replace('#include <color_fragment>', /* glsl */`
  #include <color_fragment>
  gM = int(vGun.x + 0.5);
  gWear = vGun.y;
  if (gM == 8) {
    // stamped markings: drawn where the label texture has ink
    gMarkA = texture2D(uMark, vGUv).a;
    if (gMarkA < 0.42) discard;
  }
  ${TEX_COLOR}
  ${ATLAS_COLOR}`)
      .replace('#include <roughnessmap_fragment>', ROUGH)
      .replace('#include <metalnessmap_fragment>', METAL)
      .replace('#include <normal_fragment_maps>', NORMAL)
      .replace('#include <aomap_fragment>', /* glsl */`
  #include <aomap_fragment>
  #ifdef GUN_TEX
  if (gTexOn) {
    reflectedLight.indirectDiffuse *= gAO;
    reflectedLight.indirectSpecular *= mix(1.0, gAO, 0.75);
  }
  #endif`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
  #include <emissivemap_fragment>
  if (gM == 6) totalEmissiveRadiance += diffuseColor.rgb * 0.35;`);
  };
  mat.customProgramCacheKey = () => 'hh-gun-std3' + (opts.envMap ? (opts.envMap.mapping === THREE.CubeUVReflectionMapping ? '-cube' : '-env') : '') + (opts.cinematic ? '-cin' : '') + (textured ? '-tex' : '') + (tri ? '-tri' : '');
  mat.userData.gun = { own, textured, triplanar: tri, skin: opts.skin || 'factory' };
  return mat;
}

/** Point a gun material at a skin (no recompile: uniforms only). */
export function setGunMaterialSkin(mat, skinId) {
  const g = mat && mat.userData.gun;
  if (!g) return;
  const su = skinUniforms(skinId);
  g.own.uSkin.value.set(...su.skin);
  g.own.uSkin2.value.set(...su.skin2);
  g.own.uSkinMask.value = su.mask;
  g.skin = skinId;
}

/**
 * The per-gun ageing of a material that draws one gun at a time (the viewmodel): holster wear
 * toward the muzzle of a handgun, carbon at the muzzle and the ejection port.
 */
export function setGunMaterialModel(mat, model) {
  const g = mat && mat.userData.gun;
  if (!g || !model) return;
  const hand = model.style === 'pistol' || model.style === 'revolver' || model.style === 'dual' || model.style === 'flare';
  g.own.uHolster.value.set(model.length * 0.35, model.length, hand ? 1 : 0.35, 0);
  const fires = model.casing && model.style !== 'chainsaw' && model.style !== 'crossbow';
  g.own.uSootM.value.set(model.muzzle[0], model.muzzle[1], model.muzzle[2], fires ? 0.9 : 0);
  const e = model.eject;
  g.own.uSootE.value.set(e[0], e[1], Math.abs(e[2]) > 0.2 ? Math.sign(e[2]) * Math.max(0.6, Math.abs(e[2]) - 0.2) : e[2], fires && model.style !== 'revolver' && model.style !== 'double' ? 0.75 : 0);
}

export const GUN_SKIN_LIST = GUN_SKINS;
