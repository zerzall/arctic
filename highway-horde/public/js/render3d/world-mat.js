// Materials of the static world (WORLD, SPEC §7.5). One material per merged bucket:
//   std    PBR (MeshStandardMaterial) for everything opaque — concrete, brick, rubber, char,
//          wood, canvas, bark, rock...: vertex colour × the per-vertex detail layer
//          (world-surf.js), with per-vertex roughness / metalness, plus a world-space
//          weathering pass (rain streaks, stains, dust on ledges, moss on the north sides,
//          rust on metal, brushed-metal roughness) driven by the detail array's macro layer
//   paint  vehicle paint: MeshPhysicalMaterial with a clear coat over the detail layer, dusty
//          toward the ground, sun-faded on top, with rust specks along the sills
//   glass  dark reflective glass; window panes carry an interior-mapped room behind them
//          (curtains, blinds, furniture: a ray-box "room" per pane, no textures)
//   room   the same rooms, lit and unlit (emissive): lit windows at night, with people
//          and the blue flicker of a TV
//   decal  lit, textured with the world atlas (licence plates, posters, road signs)
//   stain  the atlas as a blended decal (graffiti, water stains)
//   glow / neon / blink / flicker  unlit emissive pieces (values above 1 feed the bloom)
//   fence  blended chain link (mipmapped alpha); leaves: alpha-tested leaf-cluster cards
// 'low' swaps in Lambert / Phong versions without the detail layer (cheap per pixel); the
// interior-mapped rooms are pure ALU on the window pixels only, so 'low' keeps them.
// Every patched material sets customProgramCacheKey, so all meshes of a bucket share one
// program and a mesh created later hits the program cache.

import * as THREE from 'three';

const DETAIL_VERT_PARS = `
attribute vec3 aDet;
attribute vec2 aSurf;
varying vec3 vDet;
varying vec2 vSurf;
`;

// ---- interior mapping ----------------------------------------------------------------------------
// A pane's (u, v) in 0..1, its size in world units and a room id; `rid` = type * 256 + id
// (type 0 flat, 1 shop, 2 office, 3 warehouse, 4 derelict, 5 diner). The ray leaves the pane plane into
// an axis-aligned room; walls, floor, ceiling, a piece of furniture and (lit rooms) a person
// are hit analytically. `lamp` is the ceiling lamp's strength, `amb` the daylight fill.
export const INTERIOR_GLSL = /* glsl */`
float hhH1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec2 hhBox(vec3 o, vec3 d, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (bmin - o) * inv, t1 = (bmax - o) * inv;
  vec3 a = min(t0, t1), b = max(t0, t1);
  return vec2(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}
vec3 hhRoom(vec2 uv, vec2 sz, vec3 d, float rid, float lamp, float amb, float tm, float px) {
  float type = floor(rid / 256.0);
  float id = mod(rid, 256.0);
  float h0 = hhH1(id + 1.0), h1 = hhH1(id + 17.0), h2 = hhH1(id + 31.0), h3 = hhH1(id + 47.0), h4 = hhH1(id + 63.0), h5 = hhH1(id + 79.0);
  float W = sz.x, H = sz.y;
  float D = W * mix(0.9, 1.5, h0);
  // fine patterns (slats, tiles, shelves) dissolve into their average as the pane shrinks on screen
  float bl = smoothstep(0.003, 0.014, px);
  vec3 o = vec3(uv.x * W, uv.y * H, 0.0);
  d = normalize(d);
  d.z = max(d.z, 0.025);
  d.x = abs(d.x) < 1e-3 ? (d.x < 0.0 ? -1e-3 : 1e-3) : d.x;
  d.y = abs(d.y) < 1e-3 ? (d.y < 0.0 ? -1e-3 : 1e-3) : d.y;
  float tx = (d.x > 0.0 ? W - o.x : -o.x) / d.x;
  float ty = (d.y > 0.0 ? H - o.y : -o.y) / d.y;
  float tz = D / d.z;
  float t = min(min(tx, ty), tz);
  vec3 p = o + d * t;
  bool back = tz <= min(tx, ty);
  bool side = !back && tx <= ty;
  vec3 pal = h1 < 0.2 ? vec3(0.78, 0.70, 0.55) : h1 < 0.4 ? vec3(0.55, 0.65, 0.58) : h1 < 0.6 ? vec3(0.60, 0.66, 0.76) : h1 < 0.8 ? vec3(0.78, 0.58, 0.55) : vec3(0.82, 0.78, 0.70);
  if (type > 0.5 && type < 1.5) pal = vec3(0.86, 0.85, 0.80);
  if (type > 1.5 && type < 2.5) pal = vec3(0.74, 0.77, 0.80);
  if (type > 2.5 && type < 3.5) pal = vec3(0.45, 0.46, 0.44);
  if (type > 3.5 && type < 4.5) pal = pal * 0.55 + vec3(0.04, 0.03, 0.02);
  if (type > 4.5) pal = vec3(0.9, 0.85, 0.76);
  vec3 alb;
  vec3 nrm;
  if (back) {
    nrm = vec3(0.0, 0.0, -1.0);
    alb = pal * (0.94 + 0.06 * step(0.5, fract(p.x / (W * 0.16))));
    // a picture / a shelf / a notice board on the back wall
    if (type < 0.5 || type > 3.5) {
      vec2 pf = abs(vec2(p.x - W * (0.25 + 0.5 * h2), p.y - H * 0.62)) / vec2(W * 0.12, H * 0.16);
      if (max(pf.x, pf.y) < 1.0) alb = mix(vec3(0.16, 0.10, 0.06), vec3(0.42, 0.5, 0.55) * (0.6 + 0.6 * hhH1(floor(p.x * 0.7) + id)), step(0.15, 1.0 - max(pf.x, pf.y)));
    }
    if (type > 0.5 && type < 1.5) {
      // shelving: rows of goods
      vec2 sc = vec2(p.x / (W * 0.085), p.y / (H * 0.24));
      float shelf = step(0.1, fract(sc.y));
      vec3 good = 0.42 + 0.36 * vec3(hhH1(floor(sc.x) * 3.1 + floor(sc.y)), hhH1(floor(sc.x) * 5.7 + floor(sc.y) + 1.0), hhH1(floor(sc.x) * 7.9 + floor(sc.y) + 2.0));
      alb = mix(vec3(0.3, 0.2, 0.12), good, shelf * step(0.3, hhH1(floor(sc.x) + floor(sc.y) * 13.0 + id)) * step(H * 0.08, p.y));
      alb = mix(alb, vec3(0.5, 0.42, 0.34), bl * 0.85);
    }
  } else if (side) {
    nrm = vec3(d.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0);
    alb = pal * 0.9;
    if (type > 0.5 && type < 1.5) {
      vec2 sc = vec2(p.z / (W * 0.085), p.y / (H * 0.24));
      float shelf = step(0.1, fract(sc.y));
      vec3 good = 0.42 + 0.36 * vec3(hhH1(floor(sc.x) * 2.3 + floor(sc.y)), hhH1(floor(sc.x) * 4.1 + floor(sc.y) + 1.0), hhH1(floor(sc.x) * 6.7 + floor(sc.y) + 2.0));
      alb = mix(vec3(0.3, 0.2, 0.12), good, shelf * step(0.35, hhH1(floor(sc.x) + floor(sc.y) * 11.0 + id)) * step(H * 0.08, p.y));
      alb = mix(alb, vec3(0.5, 0.42, 0.34), bl * 0.85);
    }
  } else if (d.y < 0.0) {
    nrm = vec3(0.0, 1.0, 0.0);
    // boards, tiles or carpet
    // (a floor pattern seen at a grazing angle is a moire of stripes: it fades with the angle and the distance)
    float fa = smoothstep(0.03, 0.2, abs(d.y)) * (1.0 - bl);
    vec3 fl;
    fl = vec3(0.30, 0.19, 0.11) * mix(0.875, 0.75 + 0.25 * step(0.5, fract(p.x / (W * 0.09))), fa);
    if ((type > 0.5 && type < 1.5) || type > 4.5) fl = vec3(0.7, 0.7, 0.66) * mix(0.9, 0.8 + 0.2 * mod(floor(p.x / (W * 0.12)) + floor(p.z / (W * 0.12)), 2.0), fa);
    if (type > 1.5 && type < 2.5) fl = vec3(0.24, 0.27, 0.32);
    if (type > 2.5 && type < 3.5) fl = vec3(0.34, 0.33, 0.31);
    alb = fl;
  } else {
    nrm = vec3(0.0, -1.0, 0.0);
    alb = vec3(0.82, 0.80, 0.75);
    // ceiling tube on offices and shops
    if (type > 0.5 && type < 2.5 && abs(p.x - W * 0.5) < W * 0.3 && abs(p.z - D * 0.5) < D * 0.06) alb = vec3(3.0);
  }
  // furniture: a block against the back wall (sofa / bed / counter / desk), sometimes a second one
  bool lit = lamp > 0.05;
  if (type < 3.5 || type > 4.5) {
    float fw = W * mix(0.25, 0.5, h2), fh = H * mix(0.24, 0.46, h3), fd = D * mix(0.14, 0.28, h4);
    float fx = mix(0.04, 0.96 - fw / W, hhH1(id + 5.0)) * W;
    vec2 hb = hhBox(o, d, vec3(fx, 0.0, D - fd), vec3(fx + fw, fh, D));
    if (hb.x < hb.y && hb.x > 0.0 && hb.x < t) {
      t = hb.x;
      vec3 q = o + d * t;
      bool top = q.y > fh - 0.02;
      vec3 fc = type > 1.5 && type < 2.5 ? vec3(0.32, 0.30, 0.26) : 0.35 + 0.35 * vec3(hhH1(id + 9.0), hhH1(id + 10.0), hhH1(id + 11.0));
      alb = fc * (top ? 1.15 : 0.85);
      nrm = top ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, -1.0);
      // an office monitor glowing on the desk
      if (type > 1.5 && type < 2.5 && top && lit && abs(q.x - (fx + fw * 0.5)) < fw * 0.18 && q.z > D - fd * 0.55) alb = vec3(0.5, 0.75, 1.0) * 1.6;
      p = q;
      back = false; side = false;
    }
    if (type > 0.5) {
      // a counter / a partition in the middle of the room
      float cx = W * mix(0.1, 0.4, h5), cw = W * mix(0.3, 0.55, h4);
      vec2 hc = hhBox(o, d, vec3(cx, 0.0, D * 0.42), vec3(cx + cw, H * ((type < 1.5 || type > 4.5) ? 0.36 : 0.6), D * 0.5));
      if (hc.x < hc.y && hc.x > 0.0 && hc.x < t) {
        t = hc.x;
        vec3 q = o + d * t;
        bool top = q.y > H * ((type < 1.5 || type > 4.5) ? 0.36 : 0.6) - 0.02;
        alb = ((type < 1.5 || type > 4.5) ? vec3(0.55, 0.16, 0.14) : vec3(0.5, 0.52, 0.55)) * (top ? 1.2 : 0.8);
        nrm = top ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, -1.0);
        p = q;
      }
    }
  }
  // a person standing in a lit room
  if (lit && (type < 3.5 || type > 4.5) && hhH1(id + 91.0) > 0.4) {
    float px0 = W * mix(0.2, 0.8, hhH1(id + 92.0)), pz0 = D * mix(0.4, 0.75, hhH1(id + 93.0));
    float bw = W * 0.055, bh = H * 0.6;
    vec2 hp = hhBox(o, d, vec3(px0 - bw, 0.0, pz0 - bw * 0.7), vec3(px0 + bw, bh, pz0 + bw * 0.7));
    vec2 hh2 = hhBox(o, d, vec3(px0 - bw * 0.62, bh, pz0 - bw * 0.62), vec3(px0 + bw * 0.62, bh + H * 0.17, pz0 + bw * 0.62));
    float ph = hp.x < hp.y && hp.x > 0.0 ? hp.x : 1e9;
    float pg = hh2.x < hh2.y && hh2.x > 0.0 ? hh2.x : 1e9;
    float pt = min(ph, pg);
    if (pt < t) { t = pt; alb = pt == pg ? vec3(0.32, 0.22, 0.17) : vec3(0.08, 0.09, 0.12); nrm = vec3(0.0, 0.0, -1.0); p = o + d * t; back = false; side = false; }
  }
  // curtains / blinds just inside the glass catch the daylight from the window
  float ambK = 1.0;
  float gapDim = 1.0;
  float ct = hhH1(id + 71.0);
  float tc = W * 0.05 / d.z;
  if (tc < t && type < 3.5) {
    vec3 pc = o + d * tc;
    if (ct < 0.38) {
      float cw = mix(0.12, 0.34, hhH1(id + 72.0)) * W;
      if (pc.x < cw || pc.x > W - cw) {
        float fold = 0.7 + 0.3 * sin(pc.x * (18.0 / W) * 6.2832 * 0.5);
        vec3 cc = 0.4 + 0.45 * vec3(hhH1(id + 73.0), hhH1(id + 74.0), hhH1(id + 75.0));
        alb = cc * fold; nrm = vec3(0.0, 0.0, -1.0); t = tc; p = pc; ambK = 2.3;
      }
    } else if (ct < 0.62) {
      float cover = mix(0.25, 1.0, hhH1(id + 76.0));
      if (pc.y > H * (1.0 - cover)) {
        float slat = fract(pc.y / (H * 0.075));
        gapDim = 0.4;
        if (slat < 0.8 || bl > 0.5) { alb = vec3(0.86, 0.82, 0.72) * (0.8 + 0.2 * slat); nrm = vec3(0.0, 0.0, -1.0); t = tc; p = pc; ambK = 2.3; gapDim = 1.0; }
      }
    }
  }
  // light: a ceiling lamp (lit rooms) and the daylight fill
  vec3 lp = vec3(W * 0.5, H * 0.94, D * 0.5);
  vec3 tl = lp - p;
  float dl = length(tl);
  float diff = clamp(dot(nrm, tl / max(dl, 1e-3)), 0.0, 1.0) * 0.7 + 0.3;
  float fall = 1.0 / (1.0 + dl * dl / (W * W * 0.9));
  float flick = 1.0;
  vec3 tint = vec3(1.0);
  if (lit) {
    // a TV's blue flicker in some rooms, a failing tube in a few
    float tv = step(0.82, h5);
    tint = mix(vec3(1.0), vec3(0.55, 0.72, 1.15), tv);
    flick = mix(1.0, 0.72 + 0.28 * sin(tm * (7.0 + h4 * 6.0) + h2 * 30.0) * sin(tm * 2.3 + h3 * 9.0), tv);
    float burst = step(0.86, fract(tm * 0.11 + h3 * 7.0)) * step(0.9, h2);
    flick *= mix(1.0, 0.25 + 0.75 * step(0.5, fract(sin(floor(tm * 20.0 + h3 * 50.0) * 91.7) * 4375.5)), burst);
  }
  vec3 col = gapDim * alb * (amb * ambK * (0.6 + 0.4 * (nrm.y < 0.0 ? 0.6 : 1.0)) + tint * lamp * flick * diff * fall);
  // the reveal shades the pane's edges
  float edge = min(min(uv.x * W, (1.0 - uv.x) * W), min(uv.y * H, (1.0 - uv.y) * H));
  col *= 0.55 + 0.45 * smoothstep(0.0, 2.6, edge);
  // far away the room dissolves into its average colour (no shimmer)
  vec3 avg = pal * (amb * 0.8 + lamp * tint * 0.35);
  return mix(col, avg, smoothstep(0.008, 0.06, px));
}
`;

const DETAIL_FRAG_PARS = `
uniform highp sampler2DArray uDetail;
uniform float uDetN;
varying vec3 vDet;
varying vec2 vSurf;
vec4 hhD;
float hhRust = 0.0;
float hhIs(float a, float b) { return 1.0 - step(0.5, abs(a - b)); }
// three's derivative tangent frame (no tangent attribute needed for the detail normals)
mat3 hhTangentFrame(vec3 eyePos, vec3 N, vec2 uv) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * sc, B * sc, N);
}
`;

/**
 * World-space weathering: macro variation that hides the tiling, rain streaks and stains on
 * masonry, dust on ledges, moss on the north side, rust on metal. Reads the detail array's
 * macro layer (id 23: R broad, G mid, B vertical streaks, A blotches) and the surface class
 * from the vertex's layer id.
 */
const WEATHER_GLSL = `
{
  vec3 hhWp = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
  vec3 hhWn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  float L = vDet.z > 0.5 && vDet.z < 50.0 ? floor(vDet.z + 0.5) : 0.0;
  float nY = hhWn.y;
  float horiz = step(0.6, abs(nY));
  bool alongX = abs(hhWn.x) <= abs(hhWn.z);
  vec2 pw = horiz > 0.5 ? hhWp.xz : (alongX ? hhWp.xy : hhWp.zy);
  float along = horiz > 0.5 ? hhWp.x : (alongX ? hhWp.x : hhWp.z);
  vec4 m1 = texture(uDetail, vec3(pw / 230.0, 23.0));
  vec4 m2 = texture(uDetail, vec3(pw / 57.0 + 0.31, 23.0));
  float st = texture(uDetail, vec3(along / 66.0, hhWp.y / 340.0, 23.0)).b;
  float wall = 1.0 - smoothstep(0.35, 0.7, abs(nY));
  float cMason = hhIs(L, 1.0) + hhIs(L, 2.0) + hhIs(L, 3.0) + hhIs(L, 13.0) + hhIs(L, 24.0) + hhIs(L, 17.0) + hhIs(L, 27.0);
  float cMetal = min(1.0, hhIs(L, 4.0) + hhIs(L, 20.0) + hhIs(L, 26.0) + step(0.45, vSurf.y));
  float cWood = hhIs(L, 7.0);
  float cRock = hhIs(L, 14.0) + hhIs(L, 29.0);
  float cGround = hhIs(L, 18.0) + hhIs(L, 19.0) + hhIs(L, 22.0) + hhIs(L, 9.0) + hhIs(L, 16.0) + hhIs(L, 15.0) + hhIs(L, 10.0) + hhIs(L, 8.0);
  float cSolid = 1.0 - cGround;
  // large-scale tone: the same tile never reads as a tile
  diffuseColor.rgb *= 0.84 + 0.32 * mix(m1.r, m2.g, 0.4) * cSolid + 0.16 * cGround;
  // rain streaks under ledges and parapets, water stains
  float streak = wall * (cMason + cWood * 0.6) * smoothstep(0.5, 0.9, st) * (0.3 + 0.7 * smoothstep(0.35, 0.7, m1.g));
  diffuseColor.rgb *= 1.0 - 0.2 * streak;
  float stain = wall * (cMason + cRock) * smoothstep(0.52, 0.8, m1.r * 0.5 + m2.a * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 0.91, 0.84) * 0.9, stain * 0.22);
  // dust and grit settled on ledges, roofs and the tops of things
  float up = smoothstep(0.65, 0.95, nY);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62 + vec3(0.075, 0.063, 0.046), up * 0.42 * (0.45 + 0.55 * m2.g) * cSolid);
  // moss / lichen on the shaded (north, -z) side of stone, brick and wood
  float north = smoothstep(0.05, -0.7, hhWn.z) * wall;
  float moss = (north * (cMason * 0.85 + cRock + cWood * 0.6) + up * cRock * 0.4) * smoothstep(0.56, 0.78, m1.a * 0.55 + m2.g * 0.45) * smoothstep(110.0, 8.0, hhWp.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.2, 0.06) * (0.7 + 0.6 * m2.a), moss * 0.55);
  // rust: blooms and runs on metal
  hhRust = cMetal * smoothstep(0.66, 0.9, m1.g * 0.5 + st * 0.38 + m2.a * 0.3) * (1.0 - 0.7 * step(0.7, vSurf.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.14, 0.05) * (0.6 + 0.9 * m2.a), hhRust * 0.45);
#ifdef HH_PAINT
  // vehicle paint: road dust rising from the ground, sun-bleached roofs, rust in the sills
  float dust = smoothstep(24.0, 0.0, hhWp.y) * (0.5 + 0.5 * m2.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.29, 0.22) * (0.6 + 0.6 * m1.r), dust * 0.36);
  float lowRust = smoothstep(0.62, 0.8, m2.a * 0.6 + m1.g * 0.4) * smoothstep(16.0, 2.0, hhWp.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.12, 0.05), lowRust * 0.75);
  float bleach = up * smoothstep(0.4, 0.7, m1.r);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * 1.2, bleach * 0.35);
#endif
}
`;

/**
 * Patch a MeshStandard/Physical material to read the per-vertex surface attributes.
 * @param {THREE.Material} mat
 * @param {object} shared { uDetail, uDetN, uRoomAmb, uTime } uniforms (shared by every world material)
 * @param {string} key program cache key
 * @param {{ weather?: boolean, paint?: boolean, rooms?: boolean }} [opts]
 */
export function patchDetail(mat, shared, key, opts = {}) {
  const { weather = true, paint = false, rooms = false } = opts;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = shared.uDetail;
    sh.uniforms.uDetN = shared.uDetN;
    if (rooms) {
      sh.uniforms.uRoomAmb = shared.uRoomAmb;
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + DETAIL_VERT_PARS + (rooms ? 'varying vec3 vHhP;\nvarying vec3 vHhN;\n' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDet = aDet;\nvSurf = aSurf;' + (rooms ? '\nvHhP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvHhN = normalize(mat3(modelMatrix) * normal);' : ''));
    let head = '#include <common>\n' + DETAIL_FRAG_PARS;
    if (paint) head = '#define HH_PAINT\n' + head;
    if (rooms) head += 'varying vec3 vHhP;\nvarying vec3 vHhN;\nuniform float uRoomAmb;\n' + INTERIOR_GLSL;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', head)
      .replace('#include <color_fragment>', `#include <color_fragment>
        hhD = vec4(0.5);
        bool hhPane = vDet.z >= 100.0;
        if (vDet.z > 0.5 && !hhPane) {
          hhD = texture(uDetail, vDet);
          // micro grain close to the eye: at 4K the layer alone was magnified ~5x there
          float hhNear = 1.0 - smoothstep(70.0, 260.0, length(vViewPosition));
          if (hhNear > 0.0) {
            vec4 m = texture(uDetail, vec3(vDet.xy * 6.7 + 0.31, 13.0));
            hhD.xy += (m.xy - 0.5) * 0.55 * hhNear;
            hhD.a *= 1.0 + (m.a - 0.5) * 0.35 * hhNear;
          }
        }
        diffuseColor.rgb *= hhD.a * 2.0;
        ${weather ? 'if (!hhPane) ' + WEATHER_GLSL : ''}
        ${rooms ? `
        vec3 hhRoomCol = vec3(0.0);
        float hhPx = max(fwidth(vDet.x), fwidth(vDet.y));
        if (hhPane) {
          vec3 V = normalize(vHhP - cameraPosition);
          vec3 N = normalize(vHhN);
          vec3 R = normalize(vec3(N.z, 0.0, -N.x));
          vec3 dd = vec3(dot(V, R), V.y, dot(V, -N));
          float rr = vDet.z - 100.0;
          vec2 sz = abs(vSurf) * 128.0;
          hhRoomCol = hhRoom(vDet.xy, sz, dd, rr, 0.0, uRoomAmb, 0.0, hhPx);
        }` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (vSurf.x >= 0.0 && !hhPane) roughnessFactor = vSurf.x;
        // floor 0.14: nothing on the map is a mirror under a light carried at the eye
        roughnessFactor = clamp(roughnessFactor + (hhD.b - 0.5) * 0.9, 0.14, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.86, hhRust * 0.8);
        ${rooms ? 'if (hhPane) roughnessFactor = 0.14;' : ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (vSurf.y >= 0.0 && !hhPane) metalnessFactor = vSurf.y;
        metalnessFactor *= 1.0 - hhRust * 0.92;
        ${rooms ? 'if (hhPane) metalnessFactor = 0.28;' : ''}
        // brushed metal: roughness varies along the grain (a stretched highlight, no smooth mirror)
        {
          float hhBrush = texture(uDetail, vec3(vDet.x * 2.6, vDet.y * 0.06, 23.0)).b;
          roughnessFactor += (hhBrush - 0.5) * 0.36 * step(0.5, metalnessFactor) * step(0.5, vDet.z) * (1.0 - step(50.0, vDet.z));
        }
        // bare chrome square to the flashlight threw it straight back into the eye as a
        // blooming glare: polished metal gets a higher floor than paint or glass
        roughnessFactor = max(roughnessFactor, 0.14 + 0.1 * metalnessFactor);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vDet.z > 0.5 && !hhPane) {
          vec3 dn = vec3((hhD.xy * 2.0 - 1.0) * uDetN, 1.0);
          normal = normalize(hhTangentFrame(-vViewPosition, normal, vDet.xy) * dn);
        }
        // edge wear: rounded edges (where the interpolated normal turns quickly) are rubbed bright and dry
        if (!hhPane) {
          float hhE = clamp(length(fwidth(nonPerturbedNormal)) * 5.0, 0.0, 1.0) * (1.0 - smoothstep(30.0, 190.0, length(vViewPosition)));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.025, hhE * 0.4);
        }`);
    if (rooms) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += hhRoomCol;');
    }
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * Unlit emissive rooms (the lit windows): interior-mapped like the glass, the ceiling lamp
 * lighting the walls, brightness = the vertex colour (lamp colour x strength) x uRoomK.
 */
function roomMaterial(uniforms) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uRoomK = uniforms.uRoomK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aDet;\nattribute vec2 aSurf;\nvarying vec3 vDet;\nvarying vec2 vSurf;\nvarying vec3 vHhP;\nvarying vec3 vHhN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDet = aDet; vSurf = aSurf;
        vHhP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vHhN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uRoomK;
        varying vec3 vDet; varying vec2 vSurf; varying vec3 vHhP; varying vec3 vHhN;
        ${INTERIOR_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float pxs = max(fwidth(vDet.x), fwidth(vDet.y));
          vec3 V = normalize(vHhP - cameraPosition);
          vec3 N = normalize(vHhN);
          vec3 R = normalize(vec3(N.z, 0.0, -N.x));
          vec3 dd = vec3(dot(V, R), V.y, dot(V, -N));
          diffuseColor.rgb *= hhRoom(vDet.xy, abs(vSurf) * 128.0, dd, vDet.z - 100.0, 1.0, 0.09, uTime, pxs) * uRoomK;
        }`);
  };
  m.customProgramCacheKey = () => 'hh-room-v2';
  return m;
}

/** Unlit emissive material whose pieces blink with a per-position phase (hazards, beacons). */
function blinkMaterial(uniforms) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vBlink;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 hhW = modelMatrix * vec4(position, 1.0);
        // one phase per ~48-unit neighbourhood: a vehicle's lamps blink together
        float hhPh = fract(sin(dot(floor(hhW.xz / 48.0), vec2(12.9898, 78.233))) * 43758.5453);
        float hhRate = 0.75 + hhPh * 0.5;
        vBlink = step(0.5, fract(uTime * hhRate + hhPh)) * 0.92 + 0.08;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBlink;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vBlink;');
  };
  m.customProgramCacheKey = () => 'hh-blink-v2';
  return m;
}

/** Atlas-textured emissive material whose pieces flicker now and then (failing tubes, windows). */
function flickerMaterial(uniforms, map) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, map });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vFlick;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 hhW = modelMatrix * vec4(position, 1.0);
        float hhPh = fract(sin(dot(floor(hhW.xz / 12.0) + floor(hhW.y / 30.0), vec2(12.9898, 78.233))) * 43758.5453);
        float hhT = uTime * (0.6 + hhPh) + hhPh * 20.0;
        // long steady stretches, then a burst of stutter
        float burst = step(0.82, fract(hhT * 0.13));
        float stut = step(0.45, fract(sin(floor(uTime * 22.0 + hhPh * 50.0) * 91.7) * 4375.5));
        vFlick = mix(1.0, 0.18 + 0.82 * stut, burst);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlick;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFlick;');
  };
  m.customProgramCacheKey = () => 'hh-flicker-v1';
  return m;
}

/**
 * Alpha-tested foliage that keeps its coverage at a distance: mipmapping averages the
 * needles' alpha toward the gaps, so past ~150 units most texels fell under the test and a
 * card broke into a few flickering specks. The alpha is scaled up with the mip level
 * (texels per pixel), which holds each card about as solid as it looks up close.
 */
function coverageLeaves(m, key) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      #ifdef USE_MAP
      {
        vec2 hhTs = vec2(textureSize(map, 0));
        vec2 hhDx = dFdx(vMapUv * hhTs), hhDy = dFdy(vMapUv * hhTs);
        float hhLod = max(0.0, 0.5 * log2(max(dot(hhDx, hhDx), dot(hhDy, hhDy))));
        diffuseColor.a *= 1.0 + hhLod * 0.32;
      }
      #endif
      #include <alphatest_fragment>`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/**
 * Create the world's materials for every tier.
 * @param {{ detail: THREE.DataArrayTexture, atlas: THREE.Texture, chain: THREE.Texture, leaves: THREE.Texture }} tex
 * @returns {{ get(bucket, tier): THREE.Material, uniforms: object, dispose(): void }}
 */
export function createWorldMaterials(tex) {
  const uniforms = { uTime: { value: 0 }, uRoomK: { value: 1 } };
  const shared = { uDetail: { value: tex.detail }, uDetN: { value: 0.95 }, uRoomAmb: { value: 0.05 } };
  const all = [];
  const track = (m) => { all.push(m); return m; };

  const hi = {
    std: track(patchDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.7 }), shared, 'hh-std-v2')),
    paint: track(patchDetail(new THREE.MeshPhysicalMaterial({
      // the flashlight sits at the eye: its specular peak on a near-mirror coat came straight
      // back into the camera as a blooming glare (a white disc on the bus at the crosshair),
      // so the coat is glossy, not a mirror
      vertexColors: true, roughness: 0.42, metalness: 0.4, clearcoat: 0.85, clearcoatRoughness: 0.22, envMapIntensity: 1.1,
    }), shared, 'hh-paint-v2', { paint: true })),
    // glass: mostly Fresnel + the probe; low metalness keeps the flashlight's reflection
    // off camera-facing panes from blowing out. Panes show a dim interior-mapped room.
    glass: track(patchDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.32, envMapIntensity: 2.6 }), shared, 'hh-glass-v2', { weather: false, rooms: true })),
    decal: track(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.atlas, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.8 })),
    // graffiti and stains: the atlas blended over the wall (its alpha), just off the surface
    stain: track(new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.atlas, transparent: true, depthWrite: false, alphaTest: 0.02, roughness: 0.8, metalness: 0, envMapIntensity: 0.4,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })),
    glow: track(new THREE.MeshBasicMaterial({ vertexColors: true, map: tex.atlas })),
    room: track(roomMaterial(uniforms)),
    neon: track(new THREE.MeshBasicMaterial({ vertexColors: true, map: tex.atlas })),
    blink: track(blinkMaterial(uniforms)),
    flicker: track(flickerMaterial(uniforms, tex.atlas)),
    // chain link blends instead of alpha-testing: without MSAA, tested wires crawled and
    // shimmered at range; the mipmapped alpha fades to a soft mesh there instead
    fence: track(new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.chain, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.7, opacity: 0.85,
    })),
    leaves: track(coverageLeaves(new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.leaves, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, envMapIntensity: 0.4,
    }), 'hh-leaves-v2')),
  };
  // 'low': no detail layer, no clear coat, cheap lighting models
  const low = {
    std: track(new THREE.MeshLambertMaterial({ vertexColors: true })),
    paint: track(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: new THREE.Color(0.25, 0.25, 0.25) })),
    glass: track(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: new THREE.Color(0.5, 0.5, 0.5) })),
    decal: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.atlas })),
    stain: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.atlas, transparent: true, depthWrite: false, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    glow: hi.glow,
    room: hi.room,
    neon: hi.neon,
    blink: hi.blink,
    flicker: hi.flicker,
    fence: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.chain, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide })),
    leaves: track(coverageLeaves(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.leaves, alphaTest: 0.45, side: THREE.DoubleSide }), 'hh-leaves-low-v2')),
  };
  return {
    uniforms,
    shared,
    hi,
    low,
    /** The material of a bucket on a tier. */
    get(bucket, tier) { return (tier === 'low' ? low : hi)[bucket] || hi[bucket]; },
    dispose() { for (const m of all) m.dispose(); },
  };
}
