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
      // ragged sides and a frayed end
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

/** Per-material shading of a zombie (replaces actor-rigmat's survivor chain). */
export const Z_SHADE = /* glsl */`
  zCav = hhM == 0 ? zRelief(vMP, hhPart).y * 0.2 : 0.0;
  if (hhM == 0) {
    vec3 c = diffuseColor.rgb;
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
    hhWoundPaint(wA, dA, diffuseColor.rgb, hhWet, hhGlow);
    hhWoundPaint(wB, dB, diffuseColor.rgb, hhWet, hhGlow);
    // dead skin: barely any light gets under it
    hhSSS = 0.22; hhSSSCol = vec3(0.3, 0.26, 0.24);
    zSpec = 0.5;
  } else if (hhM == 1 || hhM == 2) {
    vec3 c = diffuseColor.rgb;
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
  } else if (hhM == 3 || hhM == 10) {
    diffuseColor.rgb *= 0.78 + hhD.r * 0.3;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.5, 0.42), hhD.b * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.4, 0.32), smoothstep(12.0, 1.0, vMP.y) * 0.5);
    if (hhM == 3 && hhPart == 5) {
      hhWoundPaint(wA, dA, diffuseColor.rgb, hhWet, hhGlow);
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
  if (hhM != 7 && hhM != 8 && hhM != 13) {
    // fresh (red, wet) on the newly dead and where it still runs; old blood dries to a brown-black crust
    float fresh = clamp((1.0 - rot) * 0.8 + smoothstep(0.75, 1.0, vI.y) * 0.3 - bib * 0.3, 0.0, 1.0);
    vec3 bc = mix(vec3(0.05, 0.018, 0.011), vec3(0.11, 0.01, 0.008), fresh);
    bc = mix(bc, bc * 0.55, hhD.b * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, bc, bm * 0.94);
    hhWet = max(hhWet, bm * fresh * 0.8);
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
