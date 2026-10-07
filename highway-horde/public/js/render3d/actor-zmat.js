// The zombies' part of the rig material (actor-rigmat.js compiles these chunks in only when
// the mesh is a zombie: `#define HH_ZOMBIE`, its own program cache key, so the survivors'
// shader is exactly what it was). This is where a corpse stops looking like a doll:
//
//   skin     desaturated, mottled grey-green and sallow yellow, bruises going from purple to
//            green-yellow, marbled veins, lividity pooled in the feet, legs and hands, sores,
//            slipping skin, grime from the feet up; dry and rough (a weak specular), the
//            "subsurface" wrap kept faint and cold; the grooves between the ribs and the
//            sternum as a bump from the model-space anatomy (no texture needed, any LOD)
//   cloth    threadbare weave, sun-faded, grimed, mud climbing from the feet and on the knees,
//            fluid stains under the arms, seams and button plackets, a matte fabric response
//            (very rough, weak specular) with a grazing fibre sheen
//   blood    a bib of it run down from the mouth over the chin, neck and chest; fresh blood
//            is red and wet only on the newly dead and at the wounds, old blood a matte crust
//   cuts     torn strips below the hems, the trouser shell over a modelled leg, necklines
//            (v-neck, scoop, tank straps, the open back of a hospital gown), one shoe lost
//   eyes     milky, clouded, veined, wet; the glow comes from the look (dim, elites burn)
//
// Per-mesh uniforms: uBody (waist, chest, shoulder y, gaunt), uBody2 (head centre x, y, leg
// gap, width scale), uDay (1 in daylight: no cold rim outline).

import { T_COL4, T_COL5, T_HAIR } from './actor-consts.js';
import { FACE_FRAME as FF, SKIN_TILE, CLOTH_TILE, SCALP_TILE, GRIME_TILE, WOUND_Q } from './actor-ztex.js';

const f1 = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Declarations and helpers (fragment shader, after actor-rigmat's own head). */
export const Z_HEAD = /* glsl */`
uniform vec4 uBody;
uniform vec4 uBody2;
uniform float uDay;
uniform float uCin;
uniform float uZLite;   // the low tier: no relief bump, no bib streaks (a cheaper fragment)
float zSpec = 1.0;
float zDry = 0.0;
float zCav = 0.0;
float zSheen = 0.0;
vec3 zSheenCol = vec3(0.0);
float zHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
// bump from a height field in view units (Mikkelsen's surface gradient, unnormalised so a
// relief in model units keeps its slope whatever the distance)
vec3 zPerturb(vec3 N, vec3 pos, float h) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 r1 = cross(sy, N), r2 = cross(N, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * N - g);
}
// anatomy relief of bare skin (model units): ribs round the sides and front of the ribcage,
// sloping down toward the sternum, and the groove of the sternum → (height, cavity 0..1)
vec2 zRelief(vec3 p, int part) {
  if (part != 15) return vec2(0.0);
  float W = max(0.5, uBody2.w);
  float az = abs(p.z) / W;
  float fr = p.x / (3.4 * W);
  float zone = smoothstep(uBody.x + 2.2, uBody.x + 4.4, p.y) * smoothstep(uBody.z - 0.4, uBody.z - 3.0, p.y);
  float ph = (p.y + max(fr, 0.0) * 1.9 - az * 0.08) / 1.3;
  float rib = 0.5 + 0.5 * cos(ph * 6.2832);
  rib *= rib;
  float w = zone * (0.35 + 0.65 * smoothstep(0.5, 3.4, az)) * (1.0 - 0.85 * smoothstep(-0.2, -0.75, fr));
  float stern = exp(-az * az * 2.2) * zone * step(0.0, fr);
  float g = uBody.w;
  return vec2((rib * w * 0.24 - 0.1 * stern) * g, ((1.0 - rib) * w + stern * 0.6) * min(1.0, g));
}
// a wound on a corpse (in place of the survivors' painted disc): a ragged outline, bruised
// skin round it, a dark coagulated crust at the edge, raw flesh gone dark and dull inside,
// wet only toward the middle and less so the longer it has been dead (age = rot)
void zWoundPaint(vec4 W, float d, float age, inout vec3 col, inout float wet, inout vec3 glow) {
  if (W.w <= 0.0) return;
  float type = floor(W.w / 8.0);
  if (type > 4.5) { hhWoundPaint(W, d, col, wet, glow); return; }
  float r = W.w - type * 8.0;
  d += (hhD.a - 0.5) * 0.42 + (hhD.g - 0.5) * 0.2;
  if (d > 1.75) return;
  float halo = smoothstep(1.75, 1.0, d);
  col = mix(col, col * vec3(0.56, 0.43, 0.48), halo * 0.5);
  float crust = smoothstep(1.22, 0.98, d);
  col = mix(col, vec3(0.05, 0.022, 0.015) * (0.75 + hhD.r * 0.5), crust * 0.88);
  zDry = max(zDry, crust * smoothstep(0.62, 0.9, d));
  float rim = smoothstep(0.98, 0.8, d);
  vec3 fl = type > 3.5 ? vec3(0.03, 0.025, 0.02) : mix(vec3(0.16, 0.03, 0.028), vec3(0.09, 0.03, 0.022), age) * (0.6 + hhD.b * 0.7);
  col = mix(col, fl, rim * 0.92);
  float core = smoothstep(0.64, 0.3, d);
  if (type < 0.5) col = mix(col, vec3(0.07, 0.006, 0.008), core);
  else if (type < 1.5) {
    col = mix(col, vec3(0.05, 0.006, 0.008), smoothstep(0.78, 0.56, d));
    col = mix(col, vec3(0.7, 0.64, 0.5) * (0.7 + hhD.r * 0.5), smoothstep(0.44, 0.3, d));
  } else if (type < 2.5) {
    vec3 dv2 = vMP - W.xyz;
    float ang = atan(dv2.y, dv2.z + dv2.x * 0.8);
    float ring = smoothstep(0.2, 0.0, abs(d - 0.62));
    float teeth = smoothstep(0.55, 0.95, cos(ang * 7.0));
    col = mix(col, vec3(0.035, 0.0, 0.004), ring * teeth * 0.95);
    col = mix(col, vec3(0.08, 0.008, 0.01), core * 0.6);
  } else if (type < 3.5) {
    col = mix(col, vec3(0.03, 0.0, 0.004), smoothstep(0.55, 0.3, d));
    vec3 dv = vMP - W.xyz;
    float st = smoothstep(r * 0.5, 0.0, abs(dv.z) + abs(dv.x) * 0.6) * step(dv.y, 0.0) * smoothstep(-r * 5.0, -r * 0.5, dv.y);
    col = mix(col, vec3(0.1, 0.008, 0.01), st * 0.85);
    wet = max(wet, st * 0.6 * (1.0 - age * 0.6));
  } else {
    col = mix(col, vec3(0.012, 0.01, 0.009), smoothstep(0.9, 0.5, d));
  }
  wet = max(wet, smoothstep(0.9, 0.45, d) * (type > 3.5 ? 0.15 : 0.6 * (1.0 - age * 0.55)));
}
`;

/**
 * Garment cuts beyond actor-rigmat's (after its if-chain): torn strips, the trouser shell of
 * the near models, necklines and one lost shoe. Reads rag, ragK, v1, tCloth, tCol3 and sets
 * garment / hemEdge like the base cuts do.
 */
export const Z_CUTS = /* glsl */`
  {
    vec4 tC4 = hhT(${T_COL4}), tC5 = hhT(${T_COL5});
    float seed = hhT(${T_HAIR}).w;
    if (hhPart == 18 || hhPart == 19) {
      // a torn strip: kept only in a band below the hem, its length per strip and zombie
      float cut = hhPart == 18 ? v1.x : v1.z;
      if (cut < 0.0 || cut > 90.0) discard;
      float cz = hhPart == 19 ? sign(vMP.z) * uBody2.z : 0.0;
      float ang = atan(vMP.z - cz, vMP.x);
      float sid = floor((ang + 3.1416) / 0.3);
      float hs = zHash(sid * 7.13 + seed * 3.7 + float(hhPart));
      float len = hs < 0.3 ? 0.0 : (0.8 + hs * 3.8) * (0.35 + tear * 1.1);
      float top = cut - 0.15;
      float bot = top - len + (hhD.r - 0.5) * 1.4;
      if (vMP.y > top || vMP.y < bot) discard;
      // torn into tongues (narrowing toward the end, a slit between neighbours: no square
      // flaps), ragged sides and a frayed end
      float fs = abs(fract((ang + 3.1416) / 0.3) - 0.5);
      float along = clamp((top - vMP.y) / max(top - bot, 0.1), 0.0, 1.0);
      if (fs > 0.47 - along * (0.2 + hs * 0.16) + (hhD.g - 0.5) * 0.08) discard;
      if (hhD.a * 0.65 + hhD.g * 0.35 > 0.74 - 0.12 * smoothstep(bot + 1.0, bot, vMP.y)) discard;
      garment = true;
      hemEdge = min(vMP.y - bot, 1.2);
    } else if (hhPart == 21) {
      // trouser shell over a modelled leg: gone below the hem
      float cut = v1.z + rag * ragK;
      if (vMP.y < cut) discard;
      garment = true;
      hemEdge = vMP.y - cut;
    } else if (hhPart == 1 && tC5.w > 0.5) {
      // necklines: 1 v-neck / open collar, 2 scoop, 3 tank (straps and deep armholes), 4 the open back of a gown
      float nk = tC5.w, az = abs(vMP.z) / max(0.5, uBody2.w);
      float yN = uBody.z + 1.4;
      if (nk < 1.5) { if (vMP.x > 0.0 && vMP.y > yN - max(0.0, 3.4 - az * 2.2) + rag * 0.3) discard; }
      else if (nk < 2.5) { if (vMP.x > -0.5 && vMP.y > yN - max(0.0, 2.6 - az * az * 0.3) + rag * 0.3) discard; }
      else if (nk < 3.5) {
        if (vMP.y > yN - max(0.0, 3.0 - az * az * 0.22) + rag * 0.3 && az < 2.3) discard;
        if (az > 2.9 && vMP.y > uBody.y + 1.2 + rag * 0.4) discard;
      } else if (vMP.x < -1.0 && abs(vMP.z) < 0.7 + (hhD.r - 0.5) * 0.8 + smoothstep(uBody.x, uBody.x - 6.0, vMP.y) * 1.4 && vMP.y < uBody.z - 1.0) discard;
    }
    // one shoe lost somewhere: the left foot bare
    if ((hhPart == 6 || hhPart == 10 || hhPart == 11) && mod(tC4.w, 2.0) > 0.5 && vMP.z < 0.0) discard;
    // long hair: each strand card splits into lank clumps with gaps between them
    if (hhPart == 9 && abs(fract(vDUv.x * 6.0 + hhD.r * 0.5) - 0.5) > 0.28 + hhD.g * 0.16) discard;
    // hair falling out in patches (scalp, buns, afros)
    if (hhM == 5 && hhPart != 9 && hhD2.b * 0.7 + hhD.r * 0.5 < 0.4 + rot * 0.12) discard;
  }
`;

// the per-material shading of a zombie, in pieces (the baked-texture variant swaps the skin and
// cloth branches: actor-ztex.js / Z_SHADE_TEX below)
const SHADE_PRE = /* glsl */`
  zCav = hhM == 0 ? zRelief(vMP, hhPart).y * 0.2 : 0.0;
`;
const SKIN_PROC = /* glsl */`    vec3 c = diffuseColor.rgb;
    float m = hhD.r;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(lum), 0.16);
    // mottle: blotches of grey-green and sallow yellow over a waxy pallor
    c *= mix(vec3(0.86, 0.94, 0.86), vec3(1.04, 1.0, 0.86), smoothstep(0.3, 0.75, hhD2.b)) * (0.68 + 0.52 * m);
    // relief cavity (between the ribs) and rot darkening
    c *= 1.0 - zCav;
    c = mix(c, c * vec3(0.55, 0.5, 0.42), smoothstep(0.55, 0.92, hhD.b) * rot * 0.6);
    // bruises: purple when fresh, green-yellow when old
    float br = smoothstep(0.64, 0.9, hhD2.b * 0.75 + hhD.a * 0.4) * (0.35 + rot * 0.6);
    vec3 bc = mix(vec3(0.46, 0.26, 0.5), vec3(0.7, 0.72, 0.36), smoothstep(0.35, 0.75, hhD.g));
    c = mix(c, c * bc * 1.2, br * 0.85);
    // marbling: the veins darken under the skin as it decomposes
    float vn = smoothstep(0.5, 0.88, hhD2.r);
    c = mix(c, c * mix(vec3(0.46, 0.54, 0.7), vec3(0.3, 0.38, 0.3), rot), vn * (0.25 + v2.y * 0.65));
    // lividity: settled blood, purple-red low on the legs, in the feet and the hands
    float liv = smoothstep(17.0, 1.0, vMP.y) * 0.85 + (hhPart == 5 ? 0.55 : 0.0);
    liv *= 0.45 + 0.55 * smoothstep(0.2, 0.8, m);
    c = mix(c, c * vec3(0.62, 0.36, 0.5), clamp(liv, 0.0, 1.0) * 0.75);
    // sores, blisters (wet), peeling skin on the rotten
    float sore = smoothstep(0.72, 0.86, hhD2.g) * v2.z * smoothstep(0.35, 0.7, hhD.b * 0.7 + hhD2.b * 0.5);
    c = mix(c, vec3(0.3, 0.17, 0.12) * (0.6 + hhD.r * 0.5), sore * 0.85);
    hhWet = max(hhWet, sore * 0.55);
    float slip = smoothstep(0.8, 0.92, hhD.r * 0.55 + hhD2.a * 0.55) * rot;
    c = mix(c, c * vec3(1.3, 1.22, 1.08) + 0.012, slip * 0.55);
    // grime from the feet up, on the hands, in the creases
    float dirt = smoothstep(24.0, 2.0, vMP.y) * (0.3 + hhD.b * 0.8) + (hhPart == 5 ? hhD.b * 0.7 : 0.0) + hhD.b * 0.12;
    c = mix(c, c * vec3(0.5, 0.42, 0.32), clamp(dirt, 0.0, 1.0) * 0.72);
    diffuseColor.rgb = c;
    zWoundPaint(wA, dA, rot, diffuseColor.rgb, hhWet, hhGlow);
    zWoundPaint(wB, dB, rot, diffuseColor.rgb, hhWet, hhGlow);
    // dead skin: barely any light gets under it
    hhSSS = 0.22; hhSSSCol = vec3(0.3, 0.26, 0.24);
    zSpec = 0.5;
`;
const CLOTH_PROC = /* glsl */`    vec3 c = diffuseColor.rgb;
    int pat = (hhPart == 1 || hhPart == 2 || hhPart == 18) ? int(v1.w + 0.5) : ((hhPart == 3 || hhPart == 4 || hhPart == 19 || hhPart == 21) ? int(v2.x + 0.5) : 0);
    if (pat > 0) c = hhPattern(pat, c, vDUv * 2.0, vMP.y);
    if (shirtFront) {
      // the shirt under an open jacket: paler, its own weave, a shadowed edge along the lapel
      c = baseCol * vec3(0.4, 0.39, 0.36) * (0.85 + hhD.g * 0.3);
      c *= mix(1.0, 0.35, lapelK);
    }
    // weave and wear: threadbare spots, darker slubs
    c *= 0.72 + hhD.g * 0.46;
    // a garment is sewn: seams down the sides of a top and the outside of a trouser leg, a
    // button placket down a shirt that buttons
    if (hhPart == 1 || hhPart == 18) {
      c *= 1.0 - 0.28 * smoothstep(0.16, 0.03, abs(vMP.x - 0.1)) * step(2.4 * uBody2.w, abs(vMP.z));
      float nkS = hhT(${T_COL5}).w;
      if (nkS > 0.5 && nkS < 1.5 && vMP.x > 1.0 && !shirtFront) {
        float pl = smoothstep(0.22, 0.12, abs(vMP.z));
        c *= 1.0 - 0.22 * pl * smoothstep(0.04, 0.0, abs(abs(vMP.z) - 0.17));
        vec2 bq = vec2(vMP.z, (fract(vMP.y / 1.8) - 0.5) * 1.8);
        c = mix(c, vec3(0.2, 0.19, 0.17), smoothstep(0.13, 0.08, length(bq)) * 0.8);
      }
    } else if (hhPart == 3 || hhPart == 19 || hhPart == 21) {
      c *= 1.0 - 0.25 * smoothstep(0.16, 0.03, abs(vMP.x - 0.3)) * step(uBody2.z + 0.4, abs(vMP.z));
    }
    // faded by sun and washing toward a dusty grey
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(lum) * vec3(1.03, 1.0, 0.94), 0.22 + 0.22 * hhD.r);
    // grime in blotches
    c = mix(c, c * vec3(0.52, 0.47, 0.38), hhD.b * 0.55);
    // dirt and mud climbing from the feet, caked on the knees
    float dirtK = smoothstep(34.0, 3.0, vMP.y) * (0.3 + hhD.b * 0.7);
    float kn = exp(-pow((vMP.y - 15.6) / 2.4, 2.0)) * smoothstep(-0.5, 1.2, vMP.x) * smoothstep(0.3, 0.65, hhD.b + hhD.r * 0.3);
    c = mix(c, c * vec3(0.4, 0.34, 0.26), clamp(dirtK * 0.8 + kn * 0.75, 0.0, 1.0));
    // body fluids: stains under the arms and seeping through from the rot
    float W = max(0.5, uBody2.w);
    float pits = exp(-pow((vMP.y - (uBody.z - 3.2)) / 2.4, 2.0)) * smoothstep(3.2 * W, 5.0 * W, abs(vMP.z));
    float fluid = smoothstep(0.5, 0.74, hhD2.b + (hhD.a - 0.5) * 0.3) * (0.2 + rot * 0.5) + pits * 0.55 * smoothstep(0.25, 0.6, hhD2.b);
    c = mix(c, c * vec3(0.5, 0.47, 0.3), clamp(fluid, 0.0, 1.0) * 0.6);
    diffuseColor.rgb = c;
    zSpec = 0.28;
    // fibres: a soft grazing sheen (full on cinematic, lighter on ultra, none below)
    zSheen = uCin > 0.5 ? 1.0 : uZLite > 0.5 ? 0.0 : 0.6;
    zSheenCol = c * 0.6 + 0.004;
`;
const SHADE_REST = /* glsl */`  } else if (hhM == 3 || hhM == 10) {
    diffuseColor.rgb *= 0.78 + hhD.r * 0.3;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.5, 0.42), hhD.b * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.4, 0.32), smoothstep(12.0, 1.0, vMP.y) * 0.5);
    if (hhM == 3 && hhPart == 5) {
      zWoundPaint(wA, dA, rot, diffuseColor.rgb, hhWet, hhGlow);
    }
    zSpec = hhM == 3 ? 0.6 : 0.4;
  } else if (hhM == 4) {
    // bone: dry, stained ivory with dark pits
    diffuseColor.rgb *= 0.8 + hhD.r * 0.25;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.14, 0.08), hhD.b * 0.4);
    zSpec = 0.6;
  } else if (hhM == 5) {
    // matted, greasy, dusty hair in strands; where it is falling out it thins to the scalp
    // (no hard-edged patches: they read as paint)
    vec3 c = diffuseColor.rgb * (0.5 + hhD.r * 0.45) * (0.75 + 0.5 * hhD.g);
    c = mix(c, c * vec3(0.7, 0.66, 0.58), hhD.b * 0.5);
    if (hhPart != 9) {
      float thin = smoothstep(0.4 + rot * 0.12, 0.62 + rot * 0.12, hhD2.b * 0.7 + hhD.r * 0.5);
      c = mix(tSkin.rgb * baseCol * 0.55, c, thin * (0.55 + 0.45 * hhD.g));
    }
    diffuseColor.rgb = c;
    zSpec = 0.45;
  } else if (hhM == 6) {
    diffuseColor.rgb *= 0.7 + hhD.r * 0.5;
    hhWet = max(hhWet, 0.7);
  } else if (hhM == 7) {
    // milky eyes: a clouded cornea over a faded iris, red veins, wet
    vec3 milk = vec3(0.6, 0.6, 0.55);
    vec3 c = mix(milk, tAcc.rgb * 0.35 + milk * 0.4, 0.35);
    float sv = smoothstep(0.45, 0.8, hhD2.r + hhD.a * 0.2);
    c = mix(c, vec3(0.36, 0.05, 0.04), sv * 0.45);
    diffuseColor.rgb = hhEyeK < 0.05 ? vec3(0.02, 0.005, 0.005) : c;
    hhWet = 1.0;
  } else if (hhM == 13) {
    // wet sclera: yellowed, with a network of red veins that thickens with the rot
    float sv = smoothstep(0.42, 0.8, hhD2.r + hhD.a * 0.18) * (0.45 + rot * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.9, 0.86, 0.72) * (0.8 + hhD.r * 0.2), vec3(0.4, 0.04, 0.035), sv * 0.75);
    hhWet = 1.0;
  } else if (hhM == 14) {
    // enamel: yellow-brown, stained toward the gum line and by the grime mask
    float gum = smoothstep(0.0, 0.7, vI.y);
    diffuseColor.rgb *= 0.8 + hhD.r * 0.25;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.44, 0.26), (hhD.b * 0.6 + gum * 0.3));
    zSpec = 0.7;
  } else if (hhM == 9) {
    diffuseColor.rgb *= 0.85 + hhD.r * 0.25;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.08, 0.03), smoothstep(0.5, 0.85, hhD.b + hhD2.b * 0.3) * 0.75);
  }
`;

/** Per-material shading of a zombie (replaces actor-rigmat's survivor chain). */
export const Z_SHADE = SHADE_PRE + '  if (hhM == 0) {\n' + SKIN_PROC + '  } else if (hhM == 1 || hhM == 2) {\n' + CLOTH_PROC + SHADE_REST;

/** Blood (replaces the base): the paint mask plus the bib from the mouth; fresh vs dried. */
export const Z_BLOOD = /* glsl */`
  float bib = 0.0;
  if (vMP.x > 0.2 && vMP.y > uBody.x - 1.5 && vMP.y < uBody2.y - 1.2 && (hhM <= 2 || hhM == 3)) {
    float streak = uZLite > 0.5 ? hhD2.b : texture2D(uDetail2, vDUv * vec2(2.4, 0.3) + vec2(0.37, 0.11)).b;
    float w = (0.9 + streak * 2.0 + (hhD.a - 0.5) * 1.4) * max(0.5, uBody2.w);
    bib = smoothstep(w, w * 0.35, abs(vMP.z)) * smoothstep(uBody.x - 1.5, uBody.y + 1.0 + streak * 4.0, vMP.y) * (0.55 + streak * 0.6);
  }
  float bl = max(vI.y * blood, bib * blood * 1.1);
  // (soaked-in stains that spread through the weave, a few splashes: not polka dots)
  float bm = smoothstep(0.46, 0.6, bl + (hhD2.b - 0.5) * 0.5 + (hhD.a - 0.5) * 0.3 + (hhD.b - 0.5) * 0.15);
#ifdef HH_ZTEX
  // (with the baked sets: the stain's edge ragged and tide-lined by the grime set's soak mask)
  if (zG.r > 0.0) {
    float bf = bl + (zG.r - 0.5) * 0.8 + (hhD.b - 0.5) * 0.2;
    bm = smoothstep(0.48, 0.58, bf);
    diffuseColor.rgb *= 1.0 - 0.35 * smoothstep(0.42, 0.48, bf) * (1.0 - bm);
  }
#endif
  if (hhM != 7 && hhM != 8 && hhM != 13) {
    // fresh (red, wet) on the newly dead and where it still runs; old blood dries to a brown-black crust
    float fresh = clamp((1.0 - rot) * 0.8 + smoothstep(0.75, 1.0, vI.y) * 0.3 - bib * 0.3, 0.0, 1.0);
    vec3 bc = mix(vec3(0.05, 0.018, 0.011), vec3(0.085, 0.009, 0.007), fresh);
    bc = mix(bc, bc * 0.55, hhD.b * 0.6);
#ifdef HH_ZTEX
    bc *= 0.75 + 0.5 * zG.b;
#endif
    diffuseColor.rgb = mix(diffuseColor.rgb, bc, bm * 0.94);
    hhWet = max(hhWet, bm * fresh * smoothstep(0.5, 0.75, bl) * 0.7);
    zDry = max(zDry, bm * (1.0 - fresh));
  }
`;

/** Roughness (replaces the base): dry skin, matte cloth, wet only where it is wet. */
export const Z_ROUGH = /* glsl */`
  float roughnessFactor = 0.8;
  if (hhM == 0) roughnessFactor = 0.68 + hhD.b * 0.16 + hhD.r * 0.08;
  else if (hhM == 1 || hhM == 2) roughnessFactor = 0.96;
  else if (hhM == 3) roughnessFactor = 0.58 + hhD.b * 0.3;
  else if (hhM == 4) roughnessFactor = 0.62;
  else if (hhM == 5) roughnessFactor = 0.74;
  else if (hhM == 6) roughnessFactor = 0.32;
  else if (hhM == 7) roughnessFactor = 0.07;
  else if (hhM == 9) roughnessFactor = 0.35 + hhD.b * 0.4;
  else if (hhM == 10) roughnessFactor = 0.86;
  else if (hhM == 12) roughnessFactor = 0.05;
  else if (hhM == 13) roughnessFactor = 0.09;
  else if (hhM == 14) roughnessFactor = 0.38 + hhD.b * 0.3;
#ifdef HH_ZTEX
  if (zRoughT >= 0.0) roughnessFactor = zRoughT;
#endif
  roughnessFactor = mix(roughnessFactor, 0.15, hhWet);
  roughnessFactor = mix(roughnessFactor, 0.97, max(hhChar, zDry * 0.85));
  zSpec = mix(zSpec, 1.0, hhWet);`;

/** Detail normals (replaces the base): skin creases without the orange-peel lumps, weave on cloth. */
export const Z_NORMAL_DETAIL = /* glsl */`
  {
    vec4 nn = texture2D(uNrm, vDUv);
    vec2 nxy;
    if (hhM == 1 || hhM == 2) nxy = (nn.ba * 2.0 - 1.0) * 0.8;
    else if (hhM == 5) nxy = (nn.rg * 2.0 - 1.0) * 0.25;
    else if (hhM == 0) nxy = (nn.rg * 2.0 - 1.0) * (uCin > 0.5 ? 0.85 : 0.55);
    else if (hhM == 6 || hhM == 3 || hhM == 10) nxy = (nn.rg * 2.0 - 1.0) * 0.6;
    else if (hhM == 7 || hhM == 8 || hhM == 12 || hhM == 13) nxy = vec2(0.0);
    else if (hhM == 14) nxy = (nn.rg * 2.0 - 1.0) * 0.12;
    else nxy = (nn.rg * 2.0 - 1.0) * 0.3;
    normal = hhPerturb(normal, -vViewPosition, vDUv, nxy);
  }`;

/** The anatomy relief (after the detail normal), faded out where it would alias. */
export const Z_NORMAL = /* glsl */`
  if (hhM == 0 && hhPart == 15 && uZLite < 0.5) {
    float fw = length(fwidth(vMP));
    float k = smoothstep(0.7, 0.2, fw);
    if (k > 0.0) {
      float h = zRelief(vMP, hhPart).x * k;
      normal = zPerturb(normal, -vViewPosition, h);
    }
  }`;

/**
 * Cloth fuzz (inside three's direct light, after the diffuse): fibres catch light at grazing
 * angles, a soft sheen rolling round the silhouette of a garment instead of a specular
 * highlight — what makes a sleeve read as cloth rather than a painted shell. Full on
 * cinematic, lighter on high and ultra, none on low (zSheen is 0 on everything but cloth).
 */
export const Z_SHEEN = /* glsl */`
	if (zSheen > 0.0) {
		float zNoV = saturate( dot( geometryNormal, geometryViewDir ) );
		float zFuzz = pow( 1.0 - zNoV, 3.0 ) * 0.7 + 0.06;
		reflectedLight.directDiffuse += directLight.color * saturate( dotNL * 0.75 + 0.25 ) * zFuzz * zSheen * zSheenCol;
	}`;

/** Specular scale (after lights_physical_fragment): no plastic sheen on dry skin and cloth. */
export const Z_SPEC = /* glsl */`
  material.specularColor *= zSpec;
  material.specularColorBlended *= zSpec;
  material.specularF90 = mix(0.35, 1.0, zSpec);`;

// ---------------------------------------------------------------------------------------------
// The baked texture sets (actor-ztex.js) on high and up: `#define HH_ZTEX` swaps the skin and cloth
// branches above for these, maps the sets by triplanar projection in rest-pose model space
// (vMP, the rest normal vMN: a texture sticks to the body as it moves) and the faces by a front
// projection on the head's anchors, and lays the baked normals through a per-plane screen-space
// frame. The procedural pieces that depend on where a texel is on the body (lividity, mud from
// the feet, blood soaking down from the collar, sweat under the arms) threshold the grime set's
// masks, so their edges are tide-lined and ragged instead of smooth gradients.

/** Declarations and helpers (fragment shader, after Z_HEAD and the layout's samplers). */
export const Z_TEX_HEAD = /* glsl */`
uniform vec4 uZTex;    // x the special's skin layer (−1: by decay stage), y 1 on the spitter, z tile scale, w 1 on the bloater
uniform vec4 uZFace;   // this type's face anchors (unit head coordinates): eye z, eye y, mouth y, chin y
uniform vec4 uZHead;   // the head's radii (model units)
varying vec3 vMN;
vec3 zW = vec3(0.0);
vec2 zNP[3];
vec3 zDpx = vec3(0.0), zDpy = vec3(0.0), zDEx = vec3(0.0), zDEy = vec3(0.0);
float zRoughT = -1.0;
const vec3 ZLUMA = vec3(0.2126, 0.7152, 0.0722);
// sRGB → linear (a cubic fit, good to 8 bits)
vec3 zLin(vec3 c) { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
vec3 zTriW(vec3 n) {
  vec3 w = n * n;
  w *= w;
  w /= max(1e-5, w.x + w.y + w.z);
  w = max(w - 0.06, 0.0);
  return w / max(1e-5, w.x + w.y + w.z);
}
// triplanar look-up (p in tiles, k tiles per model unit for the gradients); every plane has its
// own offset so the planes do not repeat each other
vec4 zTri(highp sampler2DArray s, float L, vec3 p, float k, vec2 off) {
  vec4 c = vec4(0.0);
  if (zW.x > 0.0) c += zW.x * textureGrad(s, vec3(p.zy + off, L), zDpx.zy * k, zDpy.zy * k);
  if (zW.y > 0.0) c += zW.y * textureGrad(s, vec3(p.xz + off + vec2(0.37, 0.61), L), zDpx.xz * k, zDpy.xz * k);
  if (zW.z > 0.0) c += zW.z * textureGrad(s, vec3(p.xy + off + vec2(0.71, 0.29), L), zDpx.xy * k, zDpy.xy * k);
  return c;
}
// the same, and the layer's normal (xy, or zw when zw) blended into each plane's accumulator by mk
vec4 zTriN(highp sampler2DArray s, float L, vec3 p, float k, vec2 off, float amt, bool zw, float mk) {
  vec4 c = vec4(0.0), t;
  if (zW.x > 0.0) { t = textureGrad(s, vec3(p.zy + off, L), zDpx.zy * k, zDpy.zy * k); c += zW.x * t; zNP[0] = mix(zNP[0], ((zw ? t.zw : t.xy) * 2.0 - 1.0) * amt, mk); }
  if (zW.y > 0.0) { t = textureGrad(s, vec3(p.xz + off + vec2(0.37, 0.61), L), zDpx.xz * k, zDpy.xz * k); c += zW.y * t; zNP[1] = mix(zNP[1], ((zw ? t.zw : t.xy) * 2.0 - 1.0) * amt, mk); }
  if (zW.z > 0.0) { t = textureGrad(s, vec3(p.xy + off + vec2(0.71, 0.29), L), zDpx.xy * k, zDpy.xy * k); c += zW.z * t; zNP[2] = mix(zNP[2], ((zw ? t.zw : t.xy) * 2.0 - 1.0) * amt, mk); }
  return c;
}
// a tangent-space normal through the screen-space frame of a planar projection (st0 / st1: the
// projection's uv per screen pixel)
vec3 zPerturb2(vec3 N, vec2 st0, vec2 st1, vec2 nxy) {
  vec3 q1p = cross(zDEy, N), q0p = cross(N, zDEx);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 Bt = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(Bt, Bt));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  float l = length(nxy);
  if (l > 0.95) nxy *= 0.95 / l;
  float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  return normalize(T * (nxy.x * s) + Bt * (nxy.y * s) + N * nz);
}
// unit head coordinates of a rest-pose point (x forward, y up, z right)
vec3 zHeadQ(vec3 p) { return vec3((p.x - uBody2.x) / uZHead.x, (p.y - uBody2.y) / uZHead.y, p.z / uZHead.z); }
// the face frame was painted on the walker's anchors: stretch this type's onto them
float zFaceYk(float uy) { return uy > uZFace.z ? (${f1(FF.EY)} - (${f1(FF.MY)})) / (uZFace.y - uZFace.z) : (${f1(FF.MY)} - (${f1(FF.CY)})) / (uZFace.z - uZFace.w); }
float zFaceY(float uy) { return uy > uZFace.z ? ${f1(FF.EY)} + (uy - uZFace.y) * zFaceYk(uy) : ${f1(FF.MY)} + (uy - uZFace.z) * zFaceYk(uy); }
// the face set at a head point → false outside the frame
bool zFaceAt(float face, vec3 q, out vec4 A, out vec4 B) {
  float kz = ${f1(FF.EZ)} / uZFace.x, ky = zFaceYk(q.y);
  vec2 uv = vec2((q.z * kz - (${f1(FF.Z0)})) / ${f1(FF.SPAN)}, (zFaceY(q.y) - (${f1(FF.Y0)})) / ${f1(FF.SPAN)});
  A = vec4(0.0); B = vec4(0.5, 0.5, 0.6, 0.0);
  // (outside the frame, or on the eye spots in its bottom corners)
  if (uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.995 || (uv.y < 0.15 && abs(uv.x - 0.5) > 0.33)) return false;
  vec2 gx = vec2(zDpx.z / uZHead.z * kz, zDpx.y / uZHead.y * ky) / ${f1(FF.SPAN)};
  vec2 gy = vec2(zDpy.z / uZHead.z * kz, zDpy.y / uZHead.y * ky) / ${f1(FF.SPAN)};
  A = textureGrad(ZS_faceA, vec3(uv, ZB_faceA + face), gx, gy);
  B = textureGrad(ZS_faceB, vec3(uv, ZB_faceB + face), gx, gy);
  return true;
}
// an eye: its painted spot in the face frame, in eye-local coordinates (x outward, y up)
vec4 zEyeAt(float face, vec3 q) {
  float sd = q.z < 0.0 ? -1.0 : 1.0;
  float kz = ${f1(FF.EZ)} / uZFace.x, ky = zFaceYk(q.y);
  vec2 l = vec2((q.z * kz - sd * ${f1(FF.EZ)}) * sd / ${f1(FF.EYE_RZ)}, (zFaceY(q.y) - ${f1(FF.EY)}) / ${f1(FF.EYE_RY)});
  float ll = length(l);
  if (ll > 1.1) l *= 1.1 / ll;
  vec2 spot = sd < 0.0 ? vec2(${f1(FF.SPOT_L[0])}, ${f1(FF.SPOT_L[1])}) : vec2(${f1(FF.SPOT_R[0])}, ${f1(FF.SPOT_R[1])});
  vec2 uv = spot + l * ${f1(FF.SPOT_R0)};
  float g = ${f1(FF.SPOT_R0)} / ${f1(FF.EYE_RZ)};
  vec2 gx = vec2(zDpx.z / uZHead.z * kz * sd, zDpx.y / uZHead.y * ky) * g;
  vec2 gy = vec2(zDpy.z / uZHead.z * kz * sd, zDpy.y / uZHead.y * ky) * g;
  return textureGrad(ZS_faceA, vec3(uv, ZB_faceA + face), gx, gy);
}
// a wound from the atlas, projected along the dominant axis of the rest normal; its normal goes
// into that plane's accumulator (age = rot dries it)
void zWoundTex(vec4 W, float stage, float age, inout vec3 col, inout float rough, inout float wet) {
  if (W.w <= 0.0) return;
  float type = floor(W.w / 8.0), r = W.w - type * 8.0;
  vec3 dv = (vMP - W.xyz) / r;
  vec3 an = abs(vMN);
  vec2 q, gx, gy;
  int pl;
  float depth;
  if (an.x >= an.y && an.x >= an.z) { q = dv.zy; gx = zDpx.zy; gy = zDpy.zy; pl = 0; depth = dv.x; }
  else if (an.y >= an.z) { q = dv.xz; gx = zDpx.xz; gy = zDpy.xz; pl = 1; depth = dv.y; }
  else { q = dv.xy; gx = zDpx.xy; gy = zDpy.xy; pl = 2; depth = dv.z; }
  // (only the surface at the wound: the projection must not shine through to the far side of the body)
  if (abs(q.x) > ${f1(WOUND_Q)} || abs(q.y) > ${f1(WOUND_Q)} || abs(depth) > 1.2) return;
  // gashes: on the long dead some are maggot-pocked rot, some a torn flap
  float cell = type;
  float hs = fract(sin(dot(W.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  if (type < 0.5) cell = stage > 1.5 && hs < 0.55 ? 6.0 : hs > 0.6 ? 7.0 : 0.0;
  vec2 k = vec2(0.98 / (2.0 * ${f1(WOUND_Q)} * r)) / vec2(4.0, 2.0);
  vec2 uv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + 0.5) / vec2(4.0, 2.0) + q * r * k;
  vec4 A = textureGrad(ZS_woundA, vec3(uv, ZB_woundA), gx * k, gy * k);
  vec4 B = textureGrad(ZS_woundB, vec3(uv, ZB_woundB), gx * k, gy * k);
  float cov = A.a * smoothstep(1.2, 0.7, abs(depth));
  if (cov <= 0.0) return;
  float dry = age * 0.55;
  col = mix(col, zLin(A.rgb), cov);
  rough = mix(rough, mix(B.z, max(B.z, 0.72), dry), cov);
  wet = max(wet, B.w * cov * (1.0 - dry));
  zNP[pl] = mix(zNP[pl], B.xy * 2.0 - 1.0, cov);
}
`;

/** The setup of the textured shading (top level, before the material branches: the derivatives). */
const TEX_PRE = /* glsl */`
  zDpx = dFdx(vMP); zDpy = dFdy(vMP);
  zDEx = dFdx(-vViewPosition); zDEy = dFdy(-vViewPosition);
  zNP[0] = vec2(0.0); zNP[1] = vec2(0.0); zNP[2] = vec2(0.0);
  zW = vec3(0.0);
  float zCode = floor(hhT(${T_COL4}).w / 2.0);
  float zFace = mod(zCode, 6.0);
  float zStage = floor(zFace / 2.0);
  float zSeed = hhT(${T_HAIR}).w;
  vec2 zOff = fract(vec2(zSeed * 0.3719, zSeed * 0.6133));
  vec4 zG = vec4(0.0);
  zCav = 0.0;
`;

/** Skin: the stage (or the special's) set, the person's tone, the face, the scalp, wounds, lividity, mud. */
const SKIN_TEX = /* glsl */`
    zW = zTriW(vMN);
    float kS = 1.0 / (${f1(SKIN_TILE)} * uZTex.z);
    vec4 A, B;
    if (uZTex.x >= 0.0) {
      A = zTri(ZS_specA, ZB_specA + uZTex.x, vMP * kS, kS, zOff);
      B = zTriN(ZS_specB, ZB_specB + uZTex.x, vMP * kS, kS, zOff, 1.0, false, 1.0);
    } else {
      A = zTri(ZS_skinA, ZB_skinA + zStage, vMP * kS, kS, zOff);
      B = zTriN(ZS_skinB, ZB_skinB + zStage, vMP * kS, kS, zOff, 1.0, false, 1.0);
    }
    // the person's own skin tone: its lightness and a share of its hue (the decay colours stay)
    float tl = max(0.004, dot(tSkin.rgb, ZLUMA));
    vec3 toneK = mix(vec3(1.0), tSkin.rgb / tl, 0.15) * clamp(tl / 0.33, 0.3, 1.2);
    vec3 c = zLin(A.rgb) * toneK * mix(vec3(1.0), baseCol * 1.12, 0.75);
    // (a mottle at another scale from the procedural detail, so no two tiles of skin match)
    c *= 0.84 + 0.28 * hhD.r;
    // (dead skin is a drained colour: the decay tints stay, but greyed; dark skin goes ashen)
    c = mix(c, vec3(dot(c, ZLUMA)) * (1.0 + 0.5 * smoothstep(0.2, 0.05, tl)), 0.25 + 0.15 * smoothstep(0.2, 0.05, tl));
    float rough = B.z, wet = 0.0, thick = A.a;
    float ao = B.w;
    if (hhPart == 17) {
      vec3 q = zHeadQ(vMP);
      // the face: the head skin in front (and under the chin)
      float front = smoothstep(0.0, 0.35, vMN.x + max(0.0, -vMN.y) * step(q.y, uZFace.z) * 0.6) * step(-0.25, q.x);
      vec4 FA, FB;
      if (front > 0.0 && zFaceAt(zFace, q, FA, FB)) {
        float fk = FA.a * front;
        vec3 fc = zLin(FA.rgb);
        fc = mix(fc * toneK, fc, FB.w);
        c = mix(c, fc, fk);
        rough = mix(rough, FB.z, fk);
        wet = max(wet, smoothstep(0.4, 0.12, FB.z) * fk * FB.w);
        zNP[0] = mix(zNP[0], FB.xy * 2.0 - 1.0, fk);
        thick = mix(thick, thick * 0.6, fk);
      }
      // an ear torn off on the faces that lost one (d, f): the left ear's outer part is gone
      if ((zFace > 2.5 && zFace < 3.5 || zFace > 4.5) && q.z < -0.9 && q.x > -0.5 && q.x < 0.4 && q.y > -0.5 && q.y < 0.6
          && dot(q, q) > 1.02 + (hhD.r - 0.5) * 0.08) discard;
      // the scalp: thinning, matted hair over grey skin on the top and back of the head
      float line = mix(0.62, -0.35, smoothstep(0.15, -0.65, q.x));
      float hm = smoothstep(line - 0.05, line + 0.12, q.y);
      if (hm > 0.0) {
        float kH = 1.0 / ${f1(SCALP_TILE)};
        vec4 SA = zTri(ZS_scalpA, ZB_scalpA, vMP * kH, kH, zOff);
        vec3 hc = hhT(${T_HAIR}).rgb * (0.4 + SA.r * 1.4);
        c = mix(c, mix(zLin(SA.rgb) * toneK, hc, SA.a * 0.9), hm);
        rough = mix(rough, 0.6, hm * SA.a);
      }
    }
    // wounds from the atlas (the cloth over them is torn away)
    zWoundTex(wA, zStage, rot, c, rough, wet);
    zWoundTex(wB, zStage, rot, c, rough, wet);
    // lividity: blood settled low in the legs and the hands, purple-red (less on the long dead)
    float liv = smoothstep(17.0, 1.0, vMP.y) * 0.7 + (hhPart == 5 ? 0.45 : 0.0);
    c = mix(c, c * vec3(0.66, 0.42, 0.55), clamp(liv, 0.0, 1.0) * 0.55 * (1.0 - zStage * 0.3));
    // mud and grime from the feet up and on the hands, ragged (the grime set's mask)
    float gk = 1.0 / ${f1(GRIME_TILE)};
    zG = zTri(ZS_grimeA, ZB_grimeA, vMP * gk, gk, zOff);
    float mudT = clamp(smoothstep(22.0, 1.0, vMP.y) * 0.85 + (hhPart == 5 ? 0.45 : 0.0), 0.0, 1.0);
    float mud = smoothstep(1.0 - mudT, 1.12 - mudT, zG.g);
    c = mix(c, vec3(0.045, 0.036, 0.026) + c * 0.3, mud * 0.8);
    c *= mix(vec3(1.0), vec3(0.74, 0.68, 0.58), smoothstep(0.45, 0.8, zG.b) * 0.45);
    rough = mix(rough, 0.95, mud);
    // dirt smeared over the body (dragged through the road, hands wiped on it) and old blood
    // smeared on the hands, forearms and chest: big, ragged patches that read from afar
    float smear = smoothstep(0.48, 0.74, zG.b * 0.55 + hhD.b * 0.45) * 0.6;
    c = mix(c, c * vec3(0.52, 0.45, 0.36), smear);
    rough = mix(rough, 0.88, smear);
    float bodyB = blood * (hhPart == 5 ? 1.0 : smoothstep(18.0, 30.0, vMP.y) * smoothstep(-1.0, 2.0, vMP.x) * 0.6 + 0.3);
    float bs = smoothstep(1.0 - bodyB * 0.55, 1.08 - bodyB * 0.55, zG.r * 0.75 + zG.a * 0.25 + (hhD.b - 0.5) * 0.15);
    c = mix(c, mix(vec3(0.045, 0.014, 0.01), vec3(0.08, 0.01, 0.007), (1.0 - rot) * 0.6), bs * 0.85);
    rough = mix(rough, 0.7, bs);
    // the spitter: throat and chest stained green-yellow by what it brings up
    if (uZTex.y > 0.5) {
      vec3 dq = vMP - vec3(uBody2.x + 1.2, uBody.z + 2.0, 0.0);
      float th = exp(-dot(dq * vec3(0.6, 0.18, 0.45), dq * vec3(0.6, 0.18, 0.45))) * smoothstep(-1.0, 1.5, vMP.x);
      float st = smoothstep(1.0 - th, 1.1 - th, zG.r);
      c = mix(c, c * vec3(0.92, 1.05, 0.42) * 1.2 + vec3(0.02, 0.025, 0.0), st * 0.8);
      rough = mix(rough, 0.42, st * 0.6);
    }
    diffuseColor.rgb = c * mix(1.0, ao, 0.45);
#ifdef ZDBG
    if (ZDBG == 1) diffuseColor.rgb = zLin(A.rgb);
    if (ZDBG == 2) diffuseColor.rgb = vec3(zW);
    if (ZDBG == 3) diffuseColor.rgb = vec3(fract(vMP * kS));
#endif
    zRoughT = rough;
    hhWet = max(hhWet, wet);
    // subsurface: a faint cold wrap through fresh, thin skin; nothing through the desiccated; the
    // bloater's stretched skin glows a sick yellow-green
    hhSSS = thick * 0.32;
    hhSSSCol = uZTex.w > 0.5 ? vec3(0.44, 0.46, 0.26) : vec3(0.3, 0.33, 0.38);
    zSpec = mix(0.45, 1.0, smoothstep(0.4, 0.12, rough));
`;

/** Cloth: the zombie's fabric, then holes, blood from the collar, mud from the hem, sweat stains. */
const CLOTH_TEX = /* glsl */`
    vec3 c = diffuseColor.rgb;
    bool topG = hhPart == 1 || hhPart == 2 || hhPart == 18;
    bool botG = hhPart == 3 || hhPart == 4 || hhPart == 19 || hhPart == 21;
    float fab = botG ? floor(zCode / 66.0) : mod(floor(zCode / 6.0), 11.0);
    zW = zTriW(vMN);
    float kC = 1.0 / ${f1(CLOTH_TILE)};
    vec4 T = zTriN(ZS_cloth, ZB_cloth + fab, vMP * kC, kC, zOff, 0.9, true, 1.0);
    int pat = (hhPart == 1 || hhPart == 2 || hhPart == 18) ? int(v1.w + 0.5) : ((hhPart == 3 || hhPart == 4 || hhPart == 19 || hhPart == 21) ? int(v2.x + 0.5) : 0);
    // (plaid, camo and prints are woven into their fabrics; pinstripes, hi-vis bands, stripes and grease stay painted)
    if (pat == 1 || pat == 4 || pat == 6 || pat == 7) c = hhPattern(pat, c, vDUv * 2.0, vMP.y);
    if (shirtFront) { c = baseCol * vec3(0.4, 0.39, 0.36); c *= mix(1.0, 0.35, lapelK); }
    float rel = T.x * 2.0;
    c *= rel;
    float lum = dot(c, ZLUMA);
    c = mix(c, vec3(lum * 1.12 + 0.01) * vec3(1.0, 0.97, 0.9), T.y * 0.5);
    // seams down the sides, a button placket
    if (hhPart == 1 || hhPart == 18) c *= 1.0 - 0.28 * smoothstep(0.16, 0.03, abs(vMP.x - 0.1)) * step(2.4 * uBody2.w, abs(vMP.z));
    else if (botG) c *= 1.0 - 0.25 * smoothstep(0.16, 0.03, abs(vMP.x - 0.3)) * step(uBody2.z + 0.4, abs(vMP.z));
    // the grime set: masks and the crust, and the holes torn in the garment
    float gk = 1.0 / ${f1(GRIME_TILE)};
    zG = zTri(ZS_grimeA, ZB_grimeA, vMP * gk, gk, zOff);
    float W = max(0.5, uBody2.w);
    float fresh = clamp(1.0 - rot * 1.25, 0.0, 1.0);
    // blood soaked down from the collar and the front of a top (and dripping below it)
    float neckY = uBody.z + 1.2;
    float soakH = (2.0 + blood * 15.0) * (0.45 + 0.9 * (0.5 + 0.5 * sin(vMP.z * 0.9 + zSeed * 3.0)) * (0.6 + 0.4 * sin(vMP.z * 2.3 + zSeed)));
    float frontK = smoothstep(-0.5, 2.5, vMP.x) * smoothstep(4.5 * W, 0.8 * W, abs(vMP.z));
    float soakT = topG ? clamp(1.0 - (neckY - vMP.y) / soakH, 0.0, 1.0) * (0.15 + 0.85 * frontK) * smoothstep(0.15, 0.45, blood) : 0.0;
    // (the soak's edge broken up finer by the procedural splatter)
    float soakF = zG.r * 0.8 + hhD.b * 0.2;
    float sk = soakT > 0.0 ? smoothstep(1.0 - soakT, 1.08 - soakT, soakF) : 0.0;
    float tide = soakT > 0.0 ? smoothstep(0.96 - soakT, 1.0 - soakT, soakF) * (1.0 - sk) : 0.0;
    float drip = topG ? zG.a * clamp(1.0 - (neckY - vMP.y) / (soakH * 1.9), 0.0, 1.0) * frontK * blood : 0.0;
    sk = max(sk, smoothstep(0.25, 0.6, drip));
    vec3 bc = mix(vec3(0.04, 0.014, 0.009), vec3(0.085, 0.008, 0.006), fresh);
    c = mix(c, bc * (0.7 + rel * 0.3), sk * 0.92);
    c = mix(c, c * vec3(0.5, 0.36, 0.32), tide * 0.75);
    // mud from the hem up, caked on the knees; a top's lower edge picks some up too
    float kn = botG ? exp(-pow((vMP.y - 15.6) / 2.4, 2.0)) * smoothstep(-0.5, 1.2, vMP.x) * 0.6 : 0.0;
    float mudT = clamp((topG ? smoothstep(v1.x + 4.0, v1.x, vMP.y) * 0.35 : smoothstep(30.0, 2.0, vMP.y) * 0.9) + kn, 0.0, 1.0);
    float md = smoothstep(1.0 - mudT, 1.12 - mudT, zG.g * 0.8 + hhD.b * 0.2);
    c = mix(c, vec3(0.05, 0.04, 0.028) + c * 0.25, md * 0.85);
    // sweat and body fluids: under the arms, down the back, seeping through from the rot
    float pits = exp(-pow((vMP.y - (uBody.z - 3.2)) / 2.6, 2.0)) * smoothstep(3.0 * W, 5.0 * W, abs(vMP.z));
    float backK = smoothstep(0.5, -2.0, vMP.x) * smoothstep(uBody.x, uBody.z, vMP.y) * 0.45;
    float flT = clamp((topG ? pits + backK : 0.0) + rot * 0.22, 0.0, 1.0);
    float fl = smoothstep(1.0 - flT, 1.08 - flT, zG.b);
    c = mix(c, c * vec3(0.6, 0.55, 0.34), fl * 0.6);
    // holes: opened wider the more torn the clothes (frayed, dirty rims)
    vec4 GB = zTriN(ZS_grimeB, ZB_grimeB, vMP * gk, gk, zOff, 1.0, false, clamp(max(sk * (1.0 - fresh * 0.6), md) * 0.85, 0.0, 1.0));
    float th = 1.02 - tear * 0.5;
    if (GB.w > th) discard;
    c *= mix(1.0, 0.5, smoothstep(th - 0.05, th, GB.w));
    // dinginess: everything they wear has gone a dirty yellow-grey, sun-faded where it was bright
    float dl = dot(c, ZLUMA);
    c = mix(c, vec3(dl) * vec3(1.02, 0.98, 0.9), 0.18 + 0.2 * smoothstep(0.1, 0.4, dl));
    c *= mix(1.0, 0.62, smoothstep(0.05, 0.3, dl));
    // grime worked into the cloth in blotches, wiped hands, dragged through the dirt
    c *= mix(vec3(1.0), vec3(0.42, 0.37, 0.3), smoothstep(0.4, 0.68, zG.b * 0.55 + hhD.b * 0.45) * 0.85);
    // smears and runs of old blood anywhere on it, more the bloodier the zombie (ragged
    // shapes from the soak mask and the drip runs: no polka dots)
    float spat = smoothstep(0.74 - blood * 0.12, 0.8 - blood * 0.12, zG.r * 0.7 + zG.a * 0.45);
    c = mix(c, mix(vec3(0.04, 0.014, 0.009), vec3(0.075, 0.01, 0.007), fresh) * (0.7 + 0.6 * zG.b), spat * 0.85);
    sk = max(sk, spat * 0.6);
    // sun-faded across the shoulders and the top of the back
    c = mix(c, vec3(dot(c, ZLUMA)) * vec3(1.05, 1.02, 0.95), (topG ? smoothstep(uBody.y, uBody.z + 1.0, vMP.y) * 0.3 : 0.0));
    c *= mix(vec3(1.0), vec3(0.64, 0.57, 0.46), 0.45 + 0.45 * zG.b);
    diffuseColor.rgb = c;
    float rough = mix(0.93, 0.74, sk * (1.0 - fresh));
    rough = mix(rough, 0.3, sk * fresh);
    rough = mix(rough, 0.97, md);
    zRoughT = rough;
    hhWet = max(hhWet, sk * fresh * 0.55);
    zSpec = 0.28;
    zSheen = uCin > 0.5 ? 1.0 : 0.6;
    zSheenCol = c * 0.6 + 0.004;
`;

/**
 * After the material branches: the eyes from their painted spots, the face's blood on the lips,
 * gums and teeth, the hair shell thinned to matted clumps.
 */
const TEX_POST = /* glsl */`
  if ((hhM == 7 || hhM == 13) && hhEyeK > 0.05) {
    vec4 E = zEyeAt(zFace, zHeadQ(vMP));
    diffuseColor.rgb = zLin(E.rgb) * (hhM == 13 ? 0.95 : 0.85);
  } else if (hhM == 6 || hhM == 14) {
    vec3 q = zHeadQ(vMP);
    vec4 FA, FB;
    if (dot(q, q) < 1.7 && q.x > -0.1 && zFaceAt(zFace, q, FA, FB)) {
      float fk = FA.a * (hhM == 14 ? FB.w : 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, zLin(FA.rgb) * mix(0.9, 1.0, FB.w), fk);
      hhWet = max(hhWet, smoothstep(0.4, 0.12, FB.z) * fk * FB.w);
    }
  } else if (hhM == 5 && hhPart != 9) {
    zW = zTriW(vMN);
    float kH = 1.0 / ${f1(SCALP_TILE)};
    vec4 SA = zTri(ZS_scalpA, ZB_scalpA, vMP * kH, kH, zOff + 0.5);
    if (SA.a < 0.1 + rot * 0.18) discard;
    diffuseColor.rgb *= 0.55 + SA.r * 1.1;
    zW = vec3(0.0);
  }
`;

/** The zombie shading with the baked sets (replaces Z_SHADE under HH_ZTEX). */
export const Z_SHADE_TEX = TEX_PRE + '  if (hhM == 0) {\n' + SKIN_TEX + '  } else if (hhM == 1 || hhM == 2) {\n' + CLOTH_TEX + SHADE_REST + TEX_POST;

/** Normals with the baked sets: the per-plane accumulators through each plane's frame; else the detail map. */
export const Z_TEX_NORMAL = /* glsl */`
  if (zW.x + zW.y + zW.z > 0.0) {
    vec3 N0 = normal, acc = vec3(0.0);
    if (zW.x > 0.0) acc += zW.x * (zPerturb2(N0, zDpx.zy, zDpy.zy, zNP[0]) - N0);
    if (zW.y > 0.0) acc += zW.y * (zPerturb2(N0, zDpx.xz, zDpy.xz, zNP[1]) - N0);
    if (zW.z > 0.0) acc += zW.z * (zPerturb2(N0, zDpx.xy, zDpy.xy, zNP[2]) - N0);
    normal = normalize(N0 + acc);
  } else ` + Z_NORMAL_DETAIL.trimStart();
