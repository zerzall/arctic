// The material of the GPU crowd rig (actor-rig.js): MeshStandardMaterial bent by the bone
// texture, plus the depth material for the flashlight shadows. The fragment shader is where
// most of the per-instance variety lives, so every zombie can look different from the same
// mesh and the same draw call:
//
//   garment cuts     the top shell is cut off at a per-instance hem (tee, jacket, coat, gown),
//                    sleeves end where the instance says, trousers turn into bare skin below
//                    their hem (shorts, capris, torn at the knee), all with a ragged torn edge
//   cloth patterns   pinstripe, plaid, camo, hi-vis bands, floral, horizontal stripes, grease
//   wounds           two per instance, painted in rest-pose model space: gashes, exposed bone,
//                    bite punctures, bullet holes with a blood streak, burns, acid craters;
//                    the cloth over them is torn away
//   skin             rot, veins, sores, bruises, a wrapped "subsurface" light term
//                    (lights_physical_pars patch) and a warm rim, wet blood sheen
//   accessories      groups of vertices (aExt.x) that the instance's option words switch on;
//                    the others collapse in the vertex shader
//   eyes / gloves    one-eyed, milky and glowing eyes; gloved hands
//
// Everything reads its parameters from the instance's texture row (actor-consts.js T_*), so
// only a flat row index and a few small varyings cross from the vertex to the fragment
// shader.

import * as THREE from 'three';
import {
  T_SKIN, T_CLOTH, T_CLOTH2, T_ACCENT, T_HAIR, T_FX, T_FX2, T_VAR1, T_VAR2, T_WND1, T_WND2, T_OPT, T_COL3, T_COL4, T_COL5, T_VAR3,
} from './actor-consts.js';

const RIG_VERT_HEAD = /* glsl */`
uniform highp sampler2D uRigTex;
uniform float uRowOffset;
uniform float uTime;
uniform float uCin;
attribute vec2 aBones;
attribute vec4 aInfo;
attribute vec2 aExt;
int rigRow;
bool rigHide;
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
  if (uCin > 0.5) {
    // cinematic secondary motion: hair hangs and drifts, hems and skirts trail (cheap sine sway
    // weighted by how far the vertex is below its anchor; each instance has its own phase)
    int prt = int(aExt.y + 0.5);
    float ph = float(gl_InstanceID) * 1.618;
    if (prt == 9) {
      float w = clamp((58.0 - position.y) / 18.0, 0.0, 1.0);
      w *= w;
      rigP += vec3(sin(uTime * 2.3 + ph + position.y * 0.35), 0.0, cos(uTime * 1.9 + ph * 1.3 + position.y * 0.3)) * 0.5 * w;
    } else if (prt == 1) {
      float w = smoothstep(32.0, 10.0, position.y);
      rigP += vec3(sin(uTime * 1.7 + ph + position.z * 0.25), 0.0, sin(uTime * 1.3 + ph * 0.7 + position.x * 0.25)) * 0.42 * w;
    }
  }
  rigN = normalize(vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal)));
  // accessory groups: hidden unless the instance switched the group's bit on
  rigHide = false;
  int ob = int(aExt.x + 0.5);
  if (ob > 0) {
    int bi = ob - 1;
    vec4 om = rigT(${T_OPT});
    float wd = bi < 24 ? om.x : (bi < 48 ? om.y : om.z);
    int sh = bi < 24 ? bi : (bi < 48 ? bi - 24 : bi - 48);
    rigHide = ((int(wd + 0.5) >> sh) & 1) == 0;
  }
}
`;

const VARYINGS = /* glsl */`
flat varying int vRow;
varying vec2 vDUv;
varying vec4 vI;        // material class, paint, part, colour slot
varying vec3 vMP;       // rest-pose model position
`;

const FRAG_HEAD = /* glsl */`
uniform highp sampler2D uRigTex;
uniform sampler2D uDetail;
uniform sampler2D uDetail2;
uniform sampler2D uNrm;
uniform float uTime;
uniform vec3 uRimColor;
uniform float uRimStrength;
${VARYINGS}
vec4 hhD;
vec4 hhD2;
float hhWet;
float hhChar;
int hhM;
vec3 hhGlow;
vec3 hhRimCol;
float hhSSS = 0.0;
vec3 hhSSSCol = vec3(0.0);
float hhEyeK = 1.0;
vec4 hhT(int i) { return texelFetch(uRigTex, ivec2(i, vRow), 0); }
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
// normalised distance to a wound (0 at the centre, 1 at the edge; 9 when there is none)
float hhWDist(vec4 W) {
  if (W.w <= 0.0) return 9.0;
  float type = floor(W.w / 8.0);
  float r = W.w - type * 8.0;
  return (length(vMP - W.xyz) + (hhD.r - 0.5) * r * 0.9 + (hhD.a - 0.5) * r * 0.6) / r;
}
void hhWoundPaint(vec4 W, float d, inout vec3 col, inout float wet, inout vec3 glow) {
  if (W.w <= 0.0 || d > 1.7) return;
  float type = floor(W.w / 8.0);
  float r = W.w - type * 8.0;
  float halo = smoothstep(1.7, 1.0, d);
  col = mix(col, col * vec3(0.62, 0.42, 0.55), halo * 0.55);
  float rim = smoothstep(1.02, 0.84, d);
  vec3 fl = vec3(0.3, 0.03, 0.035);
  if (type > 3.5 && type < 4.5) fl = vec3(0.03, 0.025, 0.02);
  else if (type > 4.5) fl = vec3(0.32, 0.46, 0.05);
  col = mix(col, fl, rim * 0.95);
  float core = smoothstep(0.64, 0.3, d);
  if (type < 0.5) col = mix(col, vec3(0.09, 0.005, 0.01), core);
  else if (type < 1.5) {
    col = mix(col, vec3(0.06, 0.005, 0.008), smoothstep(0.78, 0.56, d));
    col = mix(col, vec3(0.78, 0.72, 0.56) * (0.7 + hhD.r * 0.5), smoothstep(0.44, 0.3, d));
  } else if (type < 2.5) {
    // bite: two arcs of punctures round a torn middle
    vec3 dv2 = vMP - W.xyz;
    float ang = atan(dv2.y, dv2.z + dv2.x * 0.8);
    float ring = smoothstep(0.2, 0.0, abs(d - 0.62));
    float teeth = smoothstep(0.55, 0.95, cos(ang * 7.0));
    col = mix(col, vec3(0.04, 0.0, 0.004), ring * teeth * 0.95);
    col = mix(col, vec3(0.1, 0.008, 0.012), core * 0.6);
  } else if (type < 3.5) {
    col = mix(col, vec3(0.03, 0.0, 0.004), smoothstep(0.55, 0.3, d));
    vec3 dv = vMP - W.xyz;
    float st = smoothstep(r * 0.5, 0.0, abs(dv.z) + abs(dv.x) * 0.6) * step(dv.y, 0.0) * smoothstep(-r * 5.0, -r * 0.5, dv.y);
    col = mix(col, vec3(0.16, 0.008, 0.012), st * 0.9);
    wet = max(wet, st * 0.8);
  } else if (type < 4.5) {
    col = mix(col, vec3(0.012, 0.01, 0.009), smoothstep(0.9, 0.5, d));
  } else {
    glow += vec3(0.3, 0.9, 0.05) * core * 1.3;
  }
  wet = max(wet, rim * (type > 3.5 && type < 4.5 ? 0.25 : 0.95));
}
// cloth patterns: id 1 pinstripe, 2 plaid, 3 camo, 4 hi-vis bands, 5 floral, 6 stripes, 7 grease
vec3 hhPattern(int pat, vec3 c, vec2 uv, float y) {
  if (pat == 1) {
    float s = smoothstep(0.82, 0.95, fract(uv.x * 9.0 + 0.3));
    return mix(c, c * 0.35 + 0.16, s * 0.6);
  } else if (pat == 2) {
    float a = smoothstep(0.35, 0.5, abs(fract(uv.x * 4.0) - 0.5)) ;
    float b = smoothstep(0.35, 0.5, abs(fract(uv.y * 5.0) - 0.5)) ;
    vec3 t = mix(c, c * vec3(1.6, 0.5, 0.4), a * 0.7);
    t = mix(t, t * vec3(0.5, 0.45, 0.55), b * 0.7);
    float th = smoothstep(0.46, 0.5, abs(fract(uv.x * 12.0) - 0.5)) * 0.3;
    return t * (1.0 - th);
  } else if (pat == 3) {
    float n = hhD.r * 0.6 + hhD.b * 0.5 + (hhD.a - 0.5) * 0.35;
    vec3 tanC = vec3(0.34, 0.29, 0.18), olive = c, dark = vec3(0.045, 0.05, 0.03);
    return n < 0.4 ? dark : (n < 0.62 ? olive : tanC);
  } else if (pat == 4) {
    float bnd = smoothstep(0.1, 0.0, abs(fract(y * 0.14 + 0.2) - 0.5) - 0.06);
    return mix(c, vec3(0.62, 0.64, 0.6), bnd);
  } else if (pat == 5) {
    float f = smoothstep(0.5, 0.58, hhD.a + (hhD.r - 0.5) * 0.4);
    float g = smoothstep(0.62, 0.68, hhD.a * 0.8 + hhD.g * 0.3);
    vec3 t = mix(c, vec3(0.85, 0.75, 0.6), f * 0.85);
    return mix(t, vec3(0.75, 0.18, 0.3), g * 0.8);
  } else if (pat == 6) {
    float s = smoothstep(0.48, 0.52, abs(fract(y * 0.2) - 0.5));
    return mix(c, c * vec3(0.12), s);
  } else if (pat == 7) {
    float g = smoothstep(0.48, 0.74, hhD.b + (hhD.a - 0.5) * 0.4);
    return mix(c, vec3(0.03, 0.03, 0.025), g * 0.75);
  }
  return c;
}
`;

// Patch three's physical direct light: wrapped diffuse for skin ("subsurface": the terminator
// is soft and reddish instead of a hard line).
function withSSS(chunk) {
  const needle = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  if (!chunk.includes(needle)) return chunk;
  return chunk.replace(needle, needle + `
	if (hhSSS > 0.0) {
		float rawNL = dot( geometryNormal, directLight.direction );
		float wrapNL = saturate( ( rawNL + hhSSS ) / ( 1.0 + hhSSS ) );
		reflectedLight.directDiffuse += directLight.color * ( wrapNL - dotNL ) * hhSSSCol * BRDF_Lambert( material.diffuseContribution );
	}`);
}

/**
 * Standard material bent by the rig, plus the matching shadow depth material. One pair
 * per mesh (they share programs; only uRowOffset differs).
 * @param {object} shared { uRigTex, uDetail, uDetail2, uNrm, uTime } uniform objects shared by the pool
 * @param {object} opts { rim, rimStrength }
 */
export function makeMaterials(shared, opts = {}) {
  const uniforms = {
    uRigTex: shared.uRigTex, uDetail: shared.uDetail, uDetail2: shared.uDetail2, uNrm: shared.uNrm, uTime: shared.uTime,
    uRowOffset: { value: 0 },
    uCin: shared.uCin,
    uRimColor: { value: new THREE.Color(opts.rim || '#8fb4ff') },
    uRimStrength: { value: opts.rimStrength ?? 0.35 },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_VERT_HEAD + VARYINGS)
      .replace('#include <beginnormal_vertex>', /* glsl */`
  rigSkin();
  vRow = rigRow;
  vec3 objectNormal = rigN;
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
  {
    vec4 hair = rigT(${T_HAIR});
    vI = vec4(aInfo.z, aInfo.w, aExt.y, aInfo.y);
    vMP = position;
    vDUv = uv + vec2(fract(hair.w * 0.3719), fract(hair.w * 0.6133));
  }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = rigP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  if (rigHide) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <lights_physical_pars_fragment>', withSSS(THREE.ShaderChunk.lights_physical_pars_fragment))
      .replace('#include <color_fragment>', /* glsl */`
  #include <color_fragment>
  hhD = texture2D(uDetail, vDUv);
  hhD2 = texture2D(uDetail2, vDUv * 0.5 + vec2(0.13, 0.31));
  hhM = int(vI.x + 0.5);
  int hhPart = int(vI.z + 0.5);
  int hhSlot = int(vI.w + 0.5);
  vec4 tSkin = hhT(${T_SKIN}), tCloth = hhT(${T_CLOTH}), tCloth2 = hhT(${T_CLOTH2}), tAcc = hhT(${T_ACCENT});
  vec4 tFx = hhT(${T_FX}), tFx2 = hhT(${T_FX2});
  vec4 tCol3 = hhT(${T_COL3});
  vec4 v1 = hhT(${T_VAR1}), v2 = hhT(${T_VAR2}), v3 = hhT(${T_VAR3}), wA = hhT(${T_WND1}), wB = hhT(${T_WND2}), tOpt = hhT(${T_OPT});
  float rot = tSkin.w, tear = tCloth.w, blood = tCloth2.w;
  vec3 baseCol = diffuseColor.rgb;
  {
    vec3 sc = vec3(1.0);
    if (hhSlot == 1) sc = tSkin.rgb;
    else if (hhSlot == 2) sc = tCloth.rgb;
    else if (hhSlot == 3) sc = tCloth2.rgb;
    else if (hhSlot == 4) sc = tAcc.rgb;
    else if (hhSlot == 5) sc = hhT(${T_HAIR}).rgb;
    else if (hhSlot == 7) sc = hhT(${T_COL3}).rgb;
    else if (hhSlot == 8) sc = hhT(${T_COL4}).rgb;
    diffuseColor.rgb *= sc;
  }
  hhWet = tFx2.z;
  hhGlow = vec3(0.0);
  float hemEdge = 9.0;
  bool garment = false;
  bool shirtFront = false;
  float lapelK = 0.0;
  // ---- garment cuts: hems, sleeves, trouser legs that turn into skin ----
  float rag = (hhD.a - 0.5) * 1.2 + (hhD.r - 0.5) * 0.8;
  float ragK = 0.5 + tear * 1.6;
  if (hhPart == 1) {
    float cut = v1.x + rag * ragK;
    if (vMP.y < cut) discard;
    hemEdge = vMP.y - cut;
    garment = true;
    if (tCol3.w > 0.5 && vMP.x > 0.5) {
      // open jacket / coat: a V of shirt down the front between the lapels
      float halfW = 3.7 - (vMP.y - 24.0) * 0.2;
      float edge = abs(vMP.z) - halfW;
      if (halfW > 0.3 && edge < 0.0 && vMP.y < 44.0) { shirtFront = true; if (edge > -0.55) lapelK = 1.0; }
    }
  } else if (hhPart == 2) {
    float cut = v1.y + rag * ragK;
    if (vMP.y < cut) discard;
    hemEdge = vMP.y - cut;
    garment = true;
  } else if (hhPart == 3 || hhPart == 4) {
    garment = true;
    if (hhPart == 3) {
      float cut = v1.z + rag * ragK;
      if (vMP.y < cut) {
        diffuseColor.rgb = baseCol * tSkin.rgb;
        hhM = 0;
        garment = false;
      } else hemEdge = vMP.y - cut;
    }
  } else if (hhPart == 5 && tOpt.w > 0.5 && mod(tOpt.w, 2.0) > 0.5) {
    // gloves
    diffuseColor.rgb = baseCol * hhT(${T_COL5}).rgb;
    hhM = 3;
  } else if (hhPart == 7) {
    // eyes: one missing / milky (the cinematic eye also has a sclera and a pupil: only the iris goes milky)
    if ((v2.w > 0.5 && v2.w < 1.5 && vMP.z < 0.0) || (v2.w > 1.5 && v2.w < 2.5 && vMP.z > 0.0)) { hhEyeK = 0.0; diffuseColor.rgb = vec3(0.02, 0.005, 0.005); }
    else if (v2.w > 2.5 && hhM == 7) { diffuseColor.rgb = vec3(0.75, 0.78, 0.74); hhEyeK = 0.55; }
  } else if (hhPart == 9) {
    // hair strands: cut to length (long, shoulder, bob, shaggy), thinned out for wispy hair
    if (vMP.y < v3.x + (hhD.r - 0.5) * 1.4) discard;
    if (v3.y > 0.0 && hhD.g * 0.6 + hhD.r * 0.5 < v3.y * 0.95) discard;
  } else if (hhPart == 10) {
    int sk = int(mod(v3.z, 10.0) + 0.5);
    diffuseColor.rgb = baseCol * (sk == 1 ? vec3(0.72, 0.7, 0.64) : vec3(0.02));
  } else if (hhPart == 11) {
    if (int(mod(v3.z, 10.0) + 0.5) != 2) discard;
  } else if (hhPart == 12) {
    if (v3.z >= 10.0) discard;
  } else if (hhPart == 13) {
    diffuseColor.rgb = baseCol * mix(vec3(0.16, 0.24, 0.28), vec3(0.008), v3.w);
    hhM = 12;
  }
  // wounds tear the cloth open
  float dA = hhWDist(wA), dB = hhWDist(wB);
  if (garment && (hhM == 1 || hhM == 2) && (dA < 1.3 || dB < 1.3)) discard;
  if (hemEdge < 0.9) diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.9, hemEdge));
  if (hhM == 2) {
    // rotted-through clothing: blotchy holes that grow with the tear amount
    float tm = hhD.b * 0.55 + hhD.r * 0.25 + hhD.a * 0.2;
    float lim = 1.02 - tear * 0.5;
    if (tm > lim) discard;
    diffuseColor.rgb *= mix(1.0, 0.35, smoothstep(lim - 0.1, lim, tm));
  }
  if (hhM == 5) {
    // thinning, matted hair: bald patches show the scalp through it
    if (hhD.r * 0.8 + hhD.b * 0.3 < 0.2 + v3.y * 0.4) discard;
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
    // veins, sores, freckles
    float vein = smoothstep(0.5, 0.86, hhD2.r) * v2.y;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.4, 0.72), vein * 0.8);
    float sore = smoothstep(0.72, 0.86, hhD2.g) * v2.z;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.26, 0.2) * (0.6 + hhD.r * 0.5), sore * 0.85);
    hhWet = max(hhWet, sore * 0.7);
    diffuseColor.rgb *= 1.0 - smoothstep(0.8, 0.95, hhD2.g) * 0.15 * (1.0 - v2.z);
    hhWoundPaint(wA, dA, diffuseColor.rgb, hhWet, hhGlow);
    hhWoundPaint(wB, dB, diffuseColor.rgb, hhWet, hhGlow);
    hhSSS = 0.55; hhSSSCol = vec3(0.95, 0.3, 0.2) * 0.9;
  } else if (hhM == 1 || hhM == 2) {
    diffuseColor.rgb *= 0.74 + hhD.g * 0.42;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.45, 0.36), hhD.b * 0.6);
    // road dirt climbs the lower body; wet dark stains under the arms
    float dirtK = smoothstep(36.0, 4.0, vMP.y) * (0.3 + hhD.b * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.37, 0.3), dirtK * 0.75);
    int pat = (hhPart == 1 || hhPart == 2) ? int(v1.w + 0.5) : ((hhPart == 3 || hhPart == 4) ? int(v2.x + 0.5) : 0);
    if (pat > 0) diffuseColor.rgb = hhPattern(pat, diffuseColor.rgb, vDUv * 2.0, vMP.y);
    if (shirtFront) {
      // the shirt under an open jacket: paler, its own weave, a shadowed edge along the lapel
      diffuseColor.rgb = baseCol * vec3(0.4, 0.39, 0.36) * (0.85 + hhD.g * 0.3);
      diffuseColor.rgb *= mix(1.0, 0.35, lapelK);
    }
  } else if (hhM == 3 || hhM == 10) {
    diffuseColor.rgb *= 0.8 + hhD.r * 0.3;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.6, hhD.b * 0.5);
    hhWoundPaint(wA, dA, diffuseColor.rgb, hhWet, hhGlow);
  } else if (hhM == 4) {
    diffuseColor.rgb *= 0.82 + hhD.r * 0.25;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.22, 0.12), hhD.b * 0.35);
  } else if (hhM == 5) {
    diffuseColor.rgb *= 0.55 + hhD.r * 0.5;
  } else if (hhM == 6) {
    diffuseColor.rgb *= 0.7 + hhD.r * 0.5;
    hhWet = max(hhWet, 0.75);
  } else if (hhM == 13) {
    // wet sclera: yellowed, with a network of red veins that thickens with the rot
    float sv = smoothstep(0.42, 0.8, hhD2.r + hhD.a * 0.18) * (0.35 + rot * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + hhD.r * 0.2), vec3(0.42, 0.04, 0.035), sv * 0.7);
    hhWet = 1.0;
  } else if (hhM == 14) {
    // enamel: stained toward the gum line and by the grime mask, blood from the painted mouth
    float gum = smoothstep(0.0, 0.7, vI.y);
    diffuseColor.rgb *= 0.86 + hhD.r * 0.22;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.48, 0.3), (hhD.b * 0.55 + gum * 0.25));
  } else if (hhM == 9) {
    diffuseColor.rgb *= 0.85 + hhD.r * 0.25;
    // rust and dirt streaks on armour
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.09, 0.03), smoothstep(0.55, 0.85, hhD.b + hhD2.b * 0.3) * 0.7);
  }
  // blood: soaks the painted areas (mouth, hands, wounds, hems) with a ragged splatter
  // edge; old blood dries dark brown where the grime mask is high
  float bl = vI.y * blood;
  float bm = smoothstep(0.46, 0.6, bl + (hhD.a - 0.5) * 0.55 + (hhD.b - 0.5) * 0.25);
  if (hhM != 7 && hhM != 8) {
    vec3 bc = mix(vec3(0.13, 0.009, 0.007), vec3(0.06, 0.018, 0.012), smoothstep(0.25, 0.7, hhD.b));
    diffuseColor.rgb = mix(diffuseColor.rgb, bc, bm * 0.94);
    hhWet = max(hhWet, bm * 0.7 * (1.0 - hhD.b));
  }
  // charring while/after burning: black, cracked
  float ch = tFx.y;
  hhChar = smoothstep(1.0 - ch, 1.0 - ch + 0.22, hhD.r * 0.55 + hhD.b * 0.45 + ch * 0.25);
  if (hhM != 7 && hhM != 8) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.018, 0.016), hhChar * 0.94);
  // frost (cryo, tFx2.w): a pale blue-white crust that creeps over the body, glassy
  if (tFx2.w > 0.001 && hhM != 7) {
    float frost = smoothstep(0.2, 0.7, tFx2.w + (hhD.r - 0.5) * 0.6 + (hhD.b - 0.5) * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.78, 0.92), frost * 0.88);
    hhWet = max(hhWet, frost * 0.7);
  }
  // glow and rim colours (used after the fog too)
  hhRimCol = (uRimColor * uRimStrength + vec3(1.0, 0.06, 0.02) * tFx.x * 0.9 + vec3(1.0, 0.45, 0.1) * tFx2.x * 0.5) * tFx.w;
  if (hhM == 0) hhRimCol += vec3(0.5, 0.14, 0.09) * 0.16 * tFx.w;
  if (hhSlot == 6) hhGlow += baseCol * tFx2.y;
  if (hhM == 7) hhGlow += tAcc.rgb * tAcc.w * hhEyeK;`)
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
  else if (hhM == 12) roughnessFactor = 0.05;
  else if (hhM == 13) roughnessFactor = 0.09;
  else if (hhM == 14) roughnessFactor = 0.26 + hhD.b * 0.3;
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
    else if (hhM == 7 || hhM == 8 || hhM == 12 || hhM == 13) nxy = vec2(0.0);
    else if (hhM == 14) nxy = (nn.rg * 2.0 - 1.0) * 0.12;
    else nxy = (nn.rg * 2.0 - 1.0) * 0.3;
    normal = hhPerturb(normal, -vViewPosition, vDUv, nxy);
  }`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
  #include <emissivemap_fragment>
  // hit flash: lit surfaces here are ~0.02-0.1 linear (night), and ACES runs at exposure
  // 1.15 / 0.6, so 0.5 read as a white glow and a teammate's per-shot 0.25 turned him pale
  totalEmissiveRadiance += hhGlow + vec3(1.0, 0.55, 0.4) * tFx.z * 0.16;
  if (tFx2.x > 0.001) {
    // embers glowing in the char cracks while it burns
    float flick = 0.65 + 0.35 * sin(uTime * 17.0 + vDUv.x * 40.0 + vDUv.y * 23.0);
    float emb = smoothstep(0.58, 0.7, hhD.r) * smoothstep(0.1, 0.6, hhChar);
    totalEmissiveRadiance += vec3(3.2, 0.95, 0.18) * emb * tFx2.x * flick;
  }
  // a faint cold glow off the ice so a frozen zombie reads in the dark
  totalEmissiveRadiance += vec3(0.03, 0.09, 0.15) * tFx2.w;`)
      .replace('#include <fog_fragment>', /* glsl */`
  float rigRim = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  rigRim = rigRim * rigRim * rigRim;
  #include <fog_fragment>
  #ifdef USE_FOG
    // glowing eyes and silhouettes hold up in the fog: a pair of eyes in the murk is how
    // a zombie should announce itself
    gl_FragColor.rgb += hhGlow * fogFactor * 0.8 + hhRimCol * rigRim * fogFactor * 1.1;
  #endif
  gl_FragColor.rgb += hhRimCol * rigRim;`);
  };
  mat.customProgramCacheKey = () => 'hh-rig5-std';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_VERT_HEAD)
      .replace('#include <begin_vertex>', 'rigSkin(); vec3 transformed = rigP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  if (rigHide) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
  };
  depth.customProgramCacheKey = () => 'hh-rig5-depth';
  return { material: mat, depth, uniforms };
}
