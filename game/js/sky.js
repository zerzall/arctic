/* Rainbow Rails — sky
 * Sky dome shader (gradient + haze band, sun, fbm clouds, stars, rainbow, synthwave sun, aurora),
 * camera-following horizon silhouette strips per world, instanced cloud banks, distant life
 * (balloons, bird flocks, blimp, planes with contrails, Neon flying cars), the hemisphere + shadowed
 * sun lights and the scene fog. Everything here either follows the camera (never reachable) or keeps
 * |x| >= 25 / y >= 25, so nothing can block the track. Built once in init; no per-frame allocation.
 */
(function (RR) {
  'use strict';
  if (!RR) return;
  const C = RR.C;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ per-world tuning
  // hemi/dir: target light intensities so a sun-facing albedo-0.85 surface peaks near 1.0 (scaled from RR.atmo).
  // gndLift: hemisphere ground colour pulled this far toward the sky colour (softer shadow sides, same hue family).
  // lElev: light elevation (rad). fog: [near, far] (far <= 520: content spawning 520 m ahead is already fogged).
  // haze/hazeK: glow band just above the horizon. cover/cloudAmt: dome clouds. banks: 3D cloud banks.
  const TUNE_BY_KIND = {
    city: {
      hemi: 0.56, dir: 0.68, gndLift: 0.25, lElev: 0.74, fog: [45, 470], haze: 0xffd49a, hazeK: 0.45, sunGlow: 0.3, sunDisc: 1,
      cover: 0.5, cloudAmt: 0.95, rainK: 1.3, starsK: 1.0, winK: 1.0, strip: [0.5, 0.36, 0.2],
      banks: 14, balloons: 3, birds: 'pigeon', flocks: 2, blimp: 1, planes: 1, cars: 0, bankTint: 0xffd2c0
    },
    beach: {
      hemi: 0.54, dir: 0.7, gndLift: 0.25, lElev: 0.95, fog: [70, 510], haze: 0xf6feff, hazeK: 0.5, sunGlow: 0.2, sunDisc: 1,
      cover: 0.54, cloudAmt: 1.0, rainK: 1.0, starsK: 0, winK: 0.3, strip: [0.5, 0.34, 0.2],
      banks: 18, balloons: 3, birds: 'gull', flocks: 3, blimp: 1, planes: 2, cars: 0, bankTint: 0xffffff
    },
    candy: {
      hemi: 0.54, dir: 0.68, gndLift: 0.25, lElev: 0.85, fog: [55, 490], haze: 0xfff6fb, hazeK: 0.5, sunGlow: 0.32, sunDisc: 1,
      cover: 0.5, cloudAmt: 1.0, rainK: 1.0, starsK: 0, winK: 0.3, strip: [0.42, 0.28, 0.14],
      banks: 20, balloons: 7, birds: 'songbird', flocks: 2, blimp: 1, planes: 1, cars: 0, bankTint: 0xffeefa
    },
    neon: {
      hemi: 0.62, dir: 0.5, gndLift: 0.15, lElev: 1.0, fog: [30, 440], haze: 0xff3fb4, hazeK: 0.55, sunGlow: 0.0, sunDisc: 0,
      cover: 0.6, cloudAmt: 0.8, rainK: 0, starsK: 1.0, winK: 1.0, strip: [0.34, 0.22, 0.1],
      banks: 9, balloons: 0, birds: null, flocks: 0, blimp: 1, planes: 0, cars: 1, bankTint: 0x241448
    },
    snow: {
      hemi: 0.52, dir: 0.68, gndLift: 0.25, lElev: 0.7, fog: [60, 500], haze: 0xffd9e6, hazeK: 0.45, sunGlow: 0.32, sunDisc: 1,
      cover: 0.56, cloudAmt: 0.85, rainK: 0, starsK: 0, winK: 0.6, strip: [0.46, 0.3, 0.16],
      banks: 14, balloons: 2, birds: 'goose', flocks: 1, blimp: 0, planes: 2, cars: 0, bankTint: 0xffffff
    }
  };
  const SUN_ELEV_K = 0.6; // displayed sun elevation = RR.atmo.sunElev * this (keeps the disc inside the follow view)
  // azimuths: rad, 0 = down the track (-z), + = right (+x). The sun sits ahead-left (derived from the camera FOV).
  const SUN_AZ_LIT = -0.45; // strip facets facing this azimuth are drawn sun-lit
  const RAIN_AZ_RUN = 0.36, RAIN_AZ_TITLE = -2.72, RAIN_EL = -0.42, RAIN_R = 0.6;
  const SYN_AZ_RUN = -0.2, SYN_AZ_TITLE = 2.95, SYN_EL = 0.075, SYN_R = 0.18;
  const L_AZ_RUN = 2.6, L_AZ_TITLE = -0.55; // key light azimuth: behind-right in the run, camera side for a +z camera
  const STRIP_R = [930, 820, 700];
  const LIFE_CFG = {
    pigeon: { col: 0x8f98b3, wing: 0x5d6680, scale: 1.9, flapF: 12, flapA: 0.55, glide: 0.15, speed: 12, form: 'cluster', n: 12 },
    gull: { col: 0xfbfcff, wing: 0x9aa3b5, scale: 2.3, flapF: 6.5, flapA: 0.7, glide: 0.8, speed: 10, form: 'loose', n: 9 },
    songbird: { col: 0xff7ab8, wing: 0x7fd6ff, scale: 1.7, flapF: 15, flapA: 0.5, glide: 0.3, speed: 13, form: 'cluster', n: 12 },
    goose: { col: 0x6d6258, wing: 0x3e3833, scale: 2.5, flapF: 5.5, flapA: 0.75, glide: 0.1, speed: 14, form: 'v', n: 11 }
  };

  // ------------------------------------------------------------------ GLSL
  const GLSL_COMMON = [
    'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uHaze; uniform float uHazeK;',
    'uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunGlow; uniform float uGlowBoost; uniform float uTime;',
    'float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    // The sky colour without sun disc / clouds / stars. Below the horizon it is exactly the fog colour (uHor).
    'vec3 skyGrad(vec3 d) {',
    '  float e = d.y;',
    '  if (e <= 0.0) return uHor;',
    '  vec3 c = mix(uHor, uMid, pow(smoothstep(0.0, 0.24, e), 0.75));',
    '  c = mix(c, uTop, smoothstep(0.1, 0.8, e));',
    '  float band = smoothstep(0.0, 0.025, e) * exp(-e * 13.0);',
    '  c = mix(c, uHaze, band * uHazeK);',
    '  float s = max(dot(d, uSunDir), 0.0);',
    '  float s2 = s * s; float s4 = s2 * s2; float s8 = s4 * s4; float s16 = s8 * s8;',
    '  c = mix(c, uSunCol, clamp((s16 * s8 * 0.9 + s8 * 0.22) * uSunGlow, 0.0, 1.0) * smoothstep(0.0, 0.05, e));',
    '  return c;',
    '}'
  ].join('\n');

  const DOME_VS = [
    'varying vec3 vDir;',
    'void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');

  const DOME_FS = [
    GLSL_COMMON,
    'uniform vec3 uCloud; uniform float uCover; uniform float uCloudAmt; uniform vec2 uCloudOff;',
    'uniform float uStars; uniform float uRainbow; uniform vec3 uRainDir; uniform float uRainR;',
    'uniform float uNeon; uniform vec3 uSynDir; uniform vec3 uSynRight; uniform vec3 uSynUp; uniform float uSynR;',
    'uniform float uFrost; uniform float uSunDisc;',
    'varying vec3 vDir;',
    'float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }',
    'float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(11.3, 7.9); a *= 0.5; } return s; }',
    'vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }',
    'float starLayer(vec3 d, float scale, float thr, float rad) {',
    '  vec3 p = d * scale; vec3 id = floor(p); vec3 f = fract(p);',
    '  float h = hash13(id);',
    '  if (h < thr) return 0.0;',
    '  vec3 sp = vec3(hash13(id + 7.1), hash13(id + 3.7), hash13(id + 1.3)) * 0.6 + 0.2;',
    '  float r = length(f - sp);',
    '  float tw = 0.6 + 0.4 * sin(uTime * (1.3 + 4.0 * fract(h * 13.1)) + h * 60.0);',
    '  return smoothstep(rad, rad * 0.15, r) * tw * (0.45 + 0.55 * fract(h * 91.7));',
    '}',
    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  vec3 col = skyGrad(d);',
    '  float e = d.y;',
    '  if (e > 0.0) {',
    // stars (dimmed where the sky is bright)
    '    if (uStars > 0.003) {',
    '      float st = starLayer(d, 160.0, 0.972, 0.34) + starLayer(d, 55.0, 0.972, 0.2) * 1.5;',
    '      float lum = dot(col, vec3(0.3, 0.55, 0.15));',
    '      col += vec3(0.92, 0.95, 1.0) * st * uStars * smoothstep(0.03, 0.3, e) * clamp(1.3 - lum * 1.35, 0.0, 1.0);',
    '    }',
    // aurora curtains: rings around the viewer, sharp lower edge, rays, green -> magenta upward
    '    if (uFrost > 0.003 && e > 0.015) {',
    '      float az = atan(d.x, -d.z);',
    '      float rr = length(d.xz) / (e + 0.12);',
    '      float acc = 0.0; float topw = 0.0;',
    '      for (int i = 0; i < 3; i++) {',
    '        float fi = float(i);',
    '        float rc = 3.1 + fi * 0.85 + sin(az * (2.0 + fi) + uTime * 0.06 + fi * 1.7) * 0.45 + (vnoise(vec2(az * 3.0 + fi * 5.0, uTime * 0.05)) - 0.5) * 0.9;',
    '        float dd = rc - rr;',
    '        float band = smoothstep(-0.06, 0.08, dd) * exp(-max(dd, 0.0) * (1.5 + fi * 0.4));',
    '        float rays = 0.45 + 0.55 * vnoise(vec2(az * 46.0 + fi * 13.0, uTime * 0.35 + fi));',
    '        acc += band * rays * (1.0 - fi * 0.22);',
    '        topw += band * smoothstep(0.0, 1.3, dd);',
    '      }',
    '      vec3 aCol = mix(vec3(0.2, 1.0, 0.62), vec3(0.95, 0.4, 1.0), clamp(topw / max(acc, 0.001), 0.0, 1.0));',
    '      float a = clamp(acc * 1.1, 0.0, 0.9) * uFrost * smoothstep(0.015, 0.07, e);',
    '      col = mix(col, aCol * mix(1.0, uGlowBoost, 0.5), a * 0.72) + aCol * a * 0.15;',
    '    }',
    // synthwave sun (Neon Night): striped yellow -> magenta disc sitting on the horizon
    '    if (uNeon > 0.003) {',
    '      float fw = dot(d, uSynDir);',
    '      if (fw > 0.0) {',
    '        vec2 lp = vec2(dot(d, uSynRight), dot(d, uSynUp)) / uSynR;',
    '        float r = length(lp);',
    '        float disc = smoothstep(1.0, 0.985, r);',
    '        float v = lp.y;',
    '        float gap = clamp((0.42 - v) / 1.3, 0.0, 1.0) * 0.78 + step(v, 0.42) * 0.06;',
    '        float k = fract(v * 5.5 + uTime * 0.12);',
    '        float cut = smoothstep(1.0 - gap - 0.02, 1.0 - gap + 0.02, k) * step(0.001, gap);',
    '        vec3 top = vec3(1.0, 0.9, 0.3); vec3 bot = vec3(1.0, 0.16, 0.7);',
    '        vec3 sc = mix(bot, top, smoothstep(-0.85, 0.8, v));',
    '        col = mix(col, sc * mix(1.0, uGlowBoost, 0.55), disc * (1.0 - cut) * uNeon);',
    '        float halo = exp(-max(r - 1.0, 0.0) * 2.6) * (1.0 - disc);',
    '        col += mix(bot, top, 0.3) * halo * 0.42 * uNeon;',
    '      }',
    '    }',
    // sun: disc + corona (wide glow is in skyGrad)
    '    float s = dot(d, uSunDir);',
    '    float ang = sqrt(max(2.0 - 2.0 * s, 0.0));',
    '    float disc = smoothstep(0.037, 0.031, ang);',
    '    float corona = exp(-ang * 30.0) * 0.5 + exp(-ang * 9.0) * 0.12;',
    '    col += uSunCol * corona * uSunDisc;',
    '    col = mix(col, uSunCol * 1.3 * uGlowBoost, disc * uSunDisc);',
    // rainbow
    '    if (uRainbow > 0.003) {',
    '      float ra = acos(clamp(dot(d, uRainDir), -1.0, 1.0));',
    '      float t = (ra - uRainR) / 0.08;',
    '      col += vec3(0.05) * (1.0 - smoothstep(-2.5, 0.0, t)) * smoothstep(-6.0, -2.5, t) * uRainbow * smoothstep(0.0, 0.1, e);',
    '      if (t > -0.4 && t < 1.4) {',
    '        vec3 rc = hue(0.78 * (1.0 - clamp(t, 0.0, 1.0)));',
    '        rc = mix(vec3(1.0), rc, 0.78);',
    '        float a = smoothstep(-0.2, 0.15, t) * smoothstep(1.2, 0.85, t) * uRainbow * smoothstep(0.0, 0.12, e);',
    '        col = mix(col, rc, clamp(a * 0.6, 0.0, 0.85));',
    '      }',
    '    }',
    // fbm clouds projected on a plane, lit sun-side / shadow-side
    '    if (uCloudAmt > 0.003 && e > 0.008) {',
    '      vec2 cp = d.xz / (e + 0.09) * 0.42 + uCloudOff;',
    '      float n = fbm(cp);',
    '      float sn = max(dot(d, uSunDir), 0.0); sn *= sn; sn *= sn; sn *= sn; sn *= sn; sn *= sn;',
    '      float dens = smoothstep(uCover + sn * 0.25 * uSunDisc, uCover + 0.17 + sn * 0.25 * uSunDisc, n);',
    '      if (dens > 0.0) {',
    '#if CLOUDQ > 1',
    '        vec2 sx = normalize(uSunDir.xz + vec2(0.0001));',
    '        float n2 = fbm(cp + sx * 0.2);',
    '        float lit = clamp(0.55 + (n - n2) * 3.2, 0.0, 1.0);',
    '#else',
    '        float lit = 0.35 + 0.5 * smoothstep(uCover, uCover + 0.4, n);',
    '#endif',
    '        vec3 cLit = mix(uCloud, uSunCol, 0.28) * 1.05;',
    '        vec3 cSh = mix(uCloud, uMid, 0.42) * 0.8 + uTop * 0.05;',
    '        vec3 cc = mix(cSh, cLit, lit);',
    '        float sd = max(dot(d, uSunDir), 0.0);',
    '        float sd2 = sd * sd; float sd8 = sd2 * sd2 * sd2 * sd2;',
    '        cc += uSunCol * sd8 * sd2 * 0.55 * (1.0 - dens * 0.5) * uSunDisc;',
    '        float hf = smoothstep(0.01, 0.26, e);',
    '        cc = mix(col, cc, 0.3 + 0.7 * hf);',
    '        col = mix(col, cc, dens * uCloudAmt * smoothstep(0.008, 0.06, e));',
    '      }',
    '    }',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // Horizon silhouette strips: vertex-coloured, lit windows, glowing wireframe, haze by height.
  const STRIP_VS = [
    'attribute vec4 aFx; attribute vec3 aBary; attribute float aU;',
    'varying vec3 vCol; varying vec4 vFx; varying vec3 vB; varying float vU; varying vec3 vRel;',
    'void main() {',
    '  vCol = color; vFx = aFx; vB = aBary; vU = aU;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vRel = wp.xyz - cameraPosition;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');
  const STRIP_FS = [
    GLSL_COMMON,
    'uniform float uLayerHaze; uniform float uHazeLo; uniform float uHazeHi; uniform float uAlpha; uniform float uWinK;',
    'uniform vec3 uWinCol; uniform vec3 uWinCol2; uniform vec3 uWireCol; uniform vec3 uWireCol2; uniform float uWireH;',
    'varying vec3 vCol; varying vec4 vFx; varying vec3 vB; varying float vU; varying vec3 vRel;',
    'void main() {',
    '  vec3 c = vCol;',
    '  float y = vRel.y;',
    '  float emit = vFx.z;',
    '  c *= mix(1.0, uGlowBoost, vFx.z);',
    '  if (vFx.x > 0.001) {',
    '    vec2 g = vec2(vU / 6.5, y / 5.2);',
    '    vec2 id = floor(g); vec2 f = fract(g);',
    '    float h = hash12(id);',
    '    float on = step(1.0 - vFx.x, h) * step(0.0, y);',
    '    float r = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.72);',
    '    vec3 wc = mix(uWinCol, uWinCol2, step(0.5, fract(h * 7.13)));',
    '    float w = on * r * uWinK;',
    '    c = mix(c, wc * uGlowBoost, clamp(w, 0.0, 1.0));',
    '    emit = max(emit, w);',
    '  }',
    '  if (vFx.y > 0.001) {',
    '    float ed = min(min(vB.x, vB.y), vB.z);',
    '    float fw = fwidth(ed);',
    '    float line = 1.0 - smoothstep(fw * 0.5, fw * 1.6, ed);',
    '    vec3 wc = mix(uWireCol, uWireCol2, clamp(y / uWireH, 0.0, 1.0));',
    '    c = mix(c, wc * uGlowBoost, line * vFx.y);',
    '    emit = max(emit, line * vFx.y);',
    '  }',
    '  float hz = mix(1.0, uLayerHaze, smoothstep(uHazeLo, uHazeHi, y));',
    '  hz = mix(hz, uLayerHaze, vFx.w);',
    '  hz *= 1.0 - clamp(emit, 0.0, 1.0) * 0.6 * smoothstep(uHazeLo, uHazeHi * 0.7, y);',
    '  c = mix(c, skyGrad(normalize(vRel)), hz);',
    '  gl_FragColor = vec4(c, uAlpha);',
    '}'
  ].join('\n');

  // Distant life: simple hemisphere + key light, per-instance tints, wing flap, fade into the sky colour.
  const LIFE_VS = [
    'attribute vec2 aTint;',
    '#ifdef TWO_TONE',
    'attribute vec3 aColB;',
    '#endif',
    '#ifdef VIS_ATTR',
    'attribute float aVis;',
    '#endif',
    '#ifdef FLAP',
    'attribute float aWing; attribute float aPhase;',
    'uniform float uFlapF; uniform float uFlapA; uniform float uGlide;',
    '#endif',
    'uniform float uTime;',
    'varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying float vVis;',
    'void main() {',
    '  vec3 p = position;',
    '  vVis = 1.0;',
    '#ifdef FLAP',
    '  float ph = uTime * uFlapF + aPhase;',
    '  float gl = mix(1.0, smoothstep(-0.3, 0.7, sin(uTime * 0.8 + aPhase * 0.37)), uGlide);',
    '  float fl = sin(ph) * gl;',
    '  p.y += aWing * fl * uFlapA;',
    '  p.x *= 1.0 - 0.18 * aWing * max(-fl, 0.0);',
    '#endif',
    '  vec3 c = color;',
    '#ifdef VIS_ATTR',
    '  vVis = aVis;',
    '#endif',
    '#ifdef USE_INSTANCING_COLOR',
    '#ifdef VIS_FROM_INSTANCE',
    '  vVis = instanceColor.r;',
    '#else',
    '  c = mix(c, c * instanceColor, aTint.x);',
    '#endif',
    '#endif',
    '#ifdef TWO_TONE',
    '  c = mix(c, c * aColB, aTint.y);',
    '#endif',
    '  vCol = c;',
    '  mat4 m = modelMatrix;',
    '#ifdef USE_INSTANCING',
    '  m = m * instanceMatrix;',
    '#endif',
    '  vec4 wp = m * vec4(p, 1.0);',
    '  vN = normalize(mat3(m) * normal);',
    '  vRel = wp.xyz - cameraPosition;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');
  const LIFE_FS = [
    GLSL_COMMON,
    'uniform vec3 uLDir; uniform vec3 uLCol; uniform vec3 uHemiS; uniform vec3 uHemiG;',
    'uniform float uFogN; uniform float uFogF; uniform float uFogMin; uniform float uFogMax;',
    'uniform vec3 uCloudCol; uniform vec3 uUnder;',
    'varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying float vVis;',
    'void main() {',
    '  vec3 n = normalize(vN);',
    '#ifdef DOUBLE',
    '  if (!gl_FrontFacing) n = -n;',
    '#endif',
    '#ifdef GLOW',
    '  vec3 c = vCol * uGlowBoost;',
    '#elif defined(CLOUD)',
    '  float sl = max(dot(n, uSunDir), 0.0);',
    '  float lit = clamp(0.5 + 0.55 * dot(n, uLDir) + 0.25 * n.y, 0.0, 1.0);',
    '  vec3 cSh = uCloudCol * mix(uMid, vec3(1.0), 0.6) * 0.84;',
    '  vec3 cLt = mix(uCloudCol, vec3(1.0), 0.2) * 1.04;',
    '  vec3 c = mix(cSh, cLt, lit) * mix(0.82, 1.0, vCol.g) + uSunCol * sl * sl * sl * 0.22 + uUnder * max(-n.y, 0.0) * max(-n.y, 0.0);',
    '#else',
    '  vec3 irr = mix(uHemiG, uHemiS, 0.5 + 0.5 * n.y) + uLCol * (0.38 + 0.62 * max(dot(n, uLDir), 0.0));',
    '  vec3 c = vCol * irr;',
    '#endif',
    '  float dist = length(vRel);',
    '  float f = clamp(uFogMin + smoothstep(uFogN, uFogF, dist), 0.0, uFogMax);',
    '  f = max(f, 1.0 - vVis);',
    '  c = mix(c, skyGrad(vRel / dist), f);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  // Contrails / light streaks: ribbons that face the camera around their long axis, fading along their length.
  const TRAIL_VS = [
    'uniform float uWide;',
    'varying float vU; varying float vV; varying float vA; varying vec3 vRel;',
    'void main() {',
    '  mat4 m = modelMatrix * instanceMatrix;',
    '  vec3 axis = (m * vec4(1.0, 0.0, 0.0, 0.0)).xyz;',
    '  float w = length((m * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
    '  vec3 o = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
    '  float u = -position.x;',
    '  vec3 cpos = o + axis * position.x;',
    '  vec3 view = cpos - cameraPosition;',
    '  vec3 side = normalize(cross(normalize(axis), view));',
    '  vec3 wp = cpos + side * position.y * w * (1.0 + u * uWide);',
    '  vU = u; vV = position.y * 2.0;',
    '#ifdef USE_INSTANCING_COLOR',
    '  vA = instanceColor.r;',
    '#else',
    '  vA = 1.0;',
    '#endif',
    '  vRel = wp - cameraPosition;',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);',
    '}'
  ].join('\n');
  const TRAIL_FS = [
    GLSL_COMMON,
    'uniform vec3 uColA; uniform vec3 uColB; uniform float uAlpha; uniform float uFogN; uniform float uFogF; uniform float uSkyMix;',
    'varying float vU; varying float vV; varying float vA; varying vec3 vRel;',
    'void main() {',
    '  float dist = length(vRel);',
    '  float a = pow(1.0 - clamp(vU, 0.0, 1.0), 1.4) * (1.0 - vV * vV) * smoothstep(0.0, 0.03, vU) * vA * uAlpha;',
    '  a *= 1.0 - smoothstep(uFogN, uFogF, dist);',
    '  vec3 c = mix(uColA, uColB, vU);',
    '  c = mix(c, skyGrad(vRel / dist), uSkyMix);',
    '  gl_FragColor = vec4(c * mix(1.0, uGlowBoost, step(uSkyMix, 0.001)), a);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------ state
  let ctx = null, scene = null, camera = null, quality = RR.QUALITY ? RR.QUALITY.high : null;
  let TUNE = null, NW = 5;
  let inited = false;
  const W = new Float32Array(8); // smoothed per-world weights (derived from frame.world)
  let titleW = 0; // 1 when the camera looks toward +z (sandbox/front title camera)
  let yawOff = 0; // smoothed camera yaw relative to the canonical view (keeps the sun in frame for orbiting cameras)
  let halfH = 0.8; // camera horizontal half-FOV (rad), smoothed: the sun sits ~70% toward the left edge on any aspect
  let lastWorld = 0;
  let group = null, dome = null, domeMat = null;
  const strips = []; // [world][layer] = mesh
  const U = {}; // shared sky uniforms
  const LU = {}; // shared life-light uniforms
  let fog = null, hemi = null, sun = null;
  const api = {
    sunLight: null, hemiLight: null,
    weights: W,
    fogColor: null, // THREE.Color (the horizon colour)
    sunDir: null, // displayed sun direction (unit)
    lightDir: null, // direction toward the key light (unit)
    init, reset, update, setQuality
  };

  // scratch (no allocation in update)
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  const _obj = new THREE.Object3D();
  const _up = new THREE.Vector3(0, 1, 0);
  const lightDir = new THREE.Vector3(0.4, 0.8, 0.4).normalize();
  const shadowBasis = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), ex: 20, ey: 20, ez: 40, valid: false, map: 0 };
  const sunDir = new THREE.Vector3(), rainDir = new THREE.Vector3(), synDir = new THREE.Vector3(), synRight = new THREE.Vector3(), synUp = new THREE.Vector3();
  const blend = { hemi: 0.5, dir: 0.74, lElev: 0.8, fogN: 50, fogF: 480, hazeK: 0.5, sunGlow: 0.3, sunDisc: 1, cover: 0.5, cloudAmt: 1, rainK: 1, starsK: 1, winK: 1 };
  const hazeCol = new THREE.Color();
  const cloudOff = new THREE.Vector2(3.1, 7.7);
  let camZprev = null;
  let planeK = 1; // blended "this world has planes" weight

  function dirFromAzEl(out, az, el) {
    const ce = Math.cos(el);
    return out.set(Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce);
  }
  function lerpAngle(a, b, t) {
    let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
    return a + d * t;
  }
  const smooth01 = (x) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------------ geometry helpers (init only)
  const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const FX0 = [0, 0, 0, 0], FXG = [0, 0, 1, 0], FXN = [0, 0, 0, 1];
  const B0 = [1, 0, 0], B1 = [0, 1, 0], B2 = [0, 0, 1], BN = [1, 1, 1];

  function Strip(R) { return { R, yb: -R * 0.05, p: [], c: [], fx: [], b: [], u: [] }; }
  function vtx(s, t, y, col, fx, bary) {
    s.p.push(s.R * Math.sin(t), y, -s.R * Math.cos(t));
    s.c.push(col[0], col[1], col[2]);
    s.fx.push(fx[0], fx[1], fx[2], fx[3]);
    s.b.push(bary[0], bary[1], bary[2]);
    s.u.push(t * s.R);
  }
  function tri(s, t1, y1, c1, t2, y2, c2, t3, y3, c3, fx, wire) {
    vtx(s, t1, y1, c1, fx, wire ? B0 : BN); vtx(s, t2, y2, c2, fx, wire ? B1 : BN); vtx(s, t3, y3, c3, fx, wire ? B2 : BN);
  }
  function quad(s, t0, t1, y0, ytL, ytR, cb, ct, fx) {
    tri(s, t0, y0, cb, t1, y0, cb, t1, ytR, ct, fx);
    tri(s, t0, y0, cb, t1, ytR, ct, t0, ytL, ct, fx);
  }
  // polygon fan around a centre point (pts = [[t, y, col], ...] in order)
  function fan(s, ct, cy, ccol, pts, fx, closed) {
    const n = pts.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % n]; tri(s, ct, cy, ccol, a[0], a[1], a[2], b[0], b[1], b[2], fx); }
  }
  function buildStripGeo(s) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(s.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(s.c, 3));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(s.fx, 4));
    g.setAttribute('aBary', new THREE.Float32BufferAttribute(s.b, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(s.u, 1));
    g.computeBoundingSphere();
    return g;
  }

  // faceted mountain: two faces split by a crease, optional snow/frosting cap with a jagged edge,
  // optional wireframe subdivision (Neon).
  function subTri(s, A, Bv, Cv, fx, n, rng) {
    if (!n || n <= 1) { tri(s, A[0], A[1], A[2], Bv[0], Bv[1], Bv[2], Cv[0], Cv[1], Cv[2], fx, false); return; }
    const jit = {};
    const P = (i, j) => {
      const u = i / n, v = j / n, w0 = 1 - u - v;
      let t = A[0] * w0 + Bv[0] * u + Cv[0] * v, y = A[1] * w0 + Bv[1] * u + Cv[1] * v;
      if (i > 0 && j > 0 && i + j < n) {
        const k = i + ',' + j;
        if (!jit[k]) jit[k] = [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)];
        const du = (Bv[0] - A[0]) / n, dv = (Cv[1] - A[1]) / n;
        t += jit[k][0] * du; y += jit[k][1] * Math.abs(dv) * 0.8;
      }
      return [t, y, mixc(mixc(A[2], Bv[2], u / Math.max(1e-6, u + w0)), Cv[2], v)];
    };
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      const p1 = P(i, j), p2 = P(i + 1, j), p3 = P(i, j + 1);
      tri(s, p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], fx, true);
      if (i + j < n - 1) { const p4 = P(i + 1, j + 1); tri(s, p2[0], p2[1], p2[2], p4[0], p4[1], p4[2], p3[0], p3[1], p3[2], fx, true); }
    }
  }
  function mountain(s, o, rng) {
    const yb = o.yb !== undefined ? o.yb : s.yb;
    const P = [o.t, o.h], BL = [o.t - o.wl, yb], BR = [o.t + o.wr, yb];
    const cr = o.t + (o.wr - o.wl) * 0.25 + rng.range(-0.15, 0.15) * Math.min(o.wl, o.wr);
    const CB = [cr, yb];
    const leftLit = o.leftLit;
    const cL = leftLit ? o.lit : o.shade, cR = leftLit ? o.shade : o.lit;
    const fx = o.fx || FX0;
    subTri(s, [P[0], P[1], cL], [BL[0], BL[1], o.base], [CB[0], CB[1], mixc(o.base, cL, 0.35)], fx, o.wire, rng);
    subTri(s, [P[0], P[1], cR], [CB[0], CB[1], mixc(o.base, cR, 0.35)], [BR[0], BR[1], o.base], fx, o.wire, rng);
    if (o.cap) {
      const f = o.cap; // fraction of the height (from the peak) that is capped
      const yC = o.h - (o.h - yb) * f * 0.5;
      const at = (A, Bp, y) => { const k = (A[1] - y) / (A[1] - Bp[1]); return A[0] + (Bp[0] - A[0]) * k; };
      const tL = at(P, BL, yC), tC = at(P, CB, yC), tR = at(P, BR, yC);
      const teeth = o.teeth || 4;
      const dip = (o.h - yC) * 0.55;
      const edge = (t0, t1, cap) => {
        const pts = [];
        for (let i = 0; i <= teeth * 2; i++) {
          const k = i / (teeth * 2);
          let y = yC - (i % 2 ? rng.range(0.25, 1) * dip : rng.range(-0.15, 0.2) * dip);
          if (i === 0 || i === teeth * 2) y = yC;
          pts.push([t0 + (t1 - t0) * k, y, cap]);
        }
        return pts;
      };
      const cLc = leftLit ? o.capLit : o.capShade, cRc = leftLit ? o.capShade : o.capLit;
      fan(s, P[0], P[1], cLc, edge(tL, tC, cLc), o.capFx || FX0, false);
      fan(s, P[0], P[1], cRc, edge(tC, tR, cRc), o.capFx || FX0, false);
    }
  }
  // rounded hill (gumdrop), optional frosting cap with drips
  function gumdrop(s, o, rng) {
    const yb = o.yb !== undefined ? o.yb : s.yb, N = o.seg || 14;
    const arc = [];
    for (let i = 0; i <= N; i++) {
      const a = Math.PI - (i / N) * Math.PI;
      const x = Math.cos(a), y = Math.pow(Math.sin(a), o.pow || 0.7);
      const col = x < 0 ? mixc(o.top, o.lit, -x * 0.9) : mixc(o.top, o.shade, x * 0.9);
      arc.push([o.t + x * o.w, o.y0 + y * o.h, col]);
    }
    const pts = [[o.t - o.w, yb, o.base]].concat(arc, [[o.t + o.w, yb, o.base]]);
    fan(s, o.t, yb, o.base, pts, o.fx || FX0, false);
    if (o.cap) {
      const capY = o.y0 + o.h * (1 - o.cap);
      const upper = arc.filter((p) => p[1] >= capY);
      if (upper.length >= 2) {
        const tl = upper[0][0], tr = upper[upper.length - 1][0];
        const cc = o.capCol, M = o.drips || 9;
        const lower = [];
        for (let i = 0; i <= M; i++) {
          const k = i / M;
          let y = capY - (i % 2 ? rng.range(0.05, 0.16) : rng.range(0.0, 0.04)) * o.h;
          if (i === 0 || i === M) y = capY + 0.01 * o.h;
          lower.push([tl + (tr - tl) * k, y, mulc(cc, 0.94)]);
        }
        const top = upper.slice().reverse().map((p) => [p[0], p[1], p[0] < o.t ? cc : mulc(cc, 0.9)]);
        const ring = lower.concat(top);
        fan(s, o.t, capY + (o.h * o.cap) * 0.35, cc, ring, o.capFx || FX0, true);
      }
    }
  }
  function disc(s, t, y, rw, rh, N, colA, colB, fx) { // pinwheel disc (lollipop)
    const pts = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * TAU; pts.push([t + Math.cos(a) * rw, y + Math.sin(a) * rh, colA]); }
    for (let i = 0; i < N; i++) { const a = pts[i], b = pts[(i + 1) % N], col = i % 2 ? colA : colB; tri(s, t, y, col, a[0], a[1], col, b[0], b[1], col, fx); }
  }
  function tower(s, o, rng) {
    const yb = s.yb, R = s.R;
    const t0 = o.t - o.w / 2, t1 = o.t + o.w / 2;
    const fxW = [o.win || 0, 0, 0, 0];
    quad(s, t0, t1, yb, o.h, o.h, o.base, o.col, fxW);
    const rim = o.rim || mulc(o.col, 1.15);
    quad(s, t0, t1, o.h - Math.max(0.6, o.h * 0.02), o.h, o.h, rim, rim, o.rimFx || FX0);
    const r = rng.next();
    if (r < 0.28) { // setback tier
      const w2 = o.w * rng.range(0.4, 0.72), h2 = o.h * rng.range(0.1, 0.28);
      const c = o.t + rng.range(-0.25, 0.25) * (o.w - w2);
      quad(s, c - w2 / 2, c + w2 / 2, o.h - 0.4, o.h + h2, o.h + h2, o.col, mulc(o.col, 1.06), fxW);
      quad(s, c - w2 / 2, c + w2 / 2, o.h + h2 - 0.6, o.h + h2, o.h + h2, rim, rim, FX0);
      if (rng.chance(0.5)) antenna(s, c, o.h + h2, rng.range(6, 18), o, rng);
    } else if (r < 0.42) { // spire
      tri(s, o.t - o.w * 0.2, o.h, o.col, o.t + o.w * 0.2, o.h, o.col, o.t, o.h + o.h * rng.range(0.18, 0.4), rim, FX0);
    } else if (r < 0.58) {
      antenna(s, o.t + rng.range(-0.3, 0.3) * o.w, o.h, rng.range(8, 22), o, rng);
    } else if (r < 0.7 && o.tank) { // rooftop water tank on legs
      const tw = 5 / R, c = o.t + rng.range(-0.25, 0.25) * o.w;
      quad(s, c - tw * 0.4, c - tw * 0.3, o.h, o.h + 4, o.h + 4, o.col, o.col, FX0);
      quad(s, c + tw * 0.3, c + tw * 0.4, o.h, o.h + 4, o.h + 4, o.col, o.col, FX0);
      quad(s, c - tw / 2, c + tw / 2, o.h + 4, o.h + 9, o.h + 9, o.col, mulc(o.col, 1.1), FX0);
      tri(s, c - tw * 0.58, o.h + 9, o.col, c + tw * 0.58, o.h + 9, o.col, c, o.h + 12, rim, FX0);
    } else if (r < 0.8 && o.dome) {
      const pts = [];
      for (let i = 0; i <= 8; i++) { const a = Math.PI - (i / 8) * Math.PI; pts.push([o.t + Math.cos(a) * o.w * 0.4, o.h + Math.sin(a) * o.w * R * 0.3, rim]); }
      fan(s, o.t, o.h, o.col, pts, FX0, false);
    }
  }
  function antenna(s, t, y, h, o, rng) {
    const aw = 0.7 / s.R;
    quad(s, t - aw, t + aw, y - 0.5, y + h, y + h, o.col, o.col, FX0);
    if (o.beacon) { const bw = 1.5 / s.R; quad(s, t - bw, t + bw, y + h - 0.6, y + h + 1.8, y + h + 1.8, o.beacon, o.beacon, FXG); }
  }
  function palm(s, t, y, h, trunk, leaf, fx, rng) {
    const R = s.R, lean = rng.range(-0.25, 0.25) * h / R;
    let pt = t, py = y;
    for (let i = 0; i < 4; i++) {
      const nt = t + lean * Math.pow((i + 1) / 4, 1.6), ny = y + h * (i + 1) / 4;
      const tw = (0.9 - i * 0.12) / R;
      quad(s, pt - tw, pt + tw, py, ny, ny, trunk, trunk, fx);
      pt = nt; py = ny;
    }
    for (let k = 0; k < 7; k++) {
      const a = Math.PI * (0.02 + k / 6 * 0.96) + rng.range(-0.1, 0.1);
      const len = h * rng.range(0.45, 0.6);
      const tx = pt + Math.cos(a) * len / R, ty = py + Math.sin(a) * len * 0.45 - len * 0.25 * Math.abs(Math.cos(a));
      const mx = pt + Math.cos(a) * len * 0.5 / R, my = py + Math.sin(a) * len * 0.45 + 1.2;
      tri(s, pt, py, leaf, mx, my, mulc(leaf, 1.12), tx, ty, mulc(leaf, 0.9), fx);
      tri(s, pt, py - 0.8, leaf, mx, my - 1.4, leaf, tx, ty, mulc(leaf, 0.9), fx);
    }
  }
  function pine(s, t, y, h, col, snow, rng) {
    const R = s.R, w = h * 0.36 / R;
    quad(s, t - 0.5 / R, t + 0.5 / R, y - 1, y + h * 0.2, y + h * 0.2, mulc(col, 0.7), mulc(col, 0.7), FX0);
    for (let k = 0; k < 3; k++) {
      const b = y + h * (0.15 + k * 0.26), top = y + h * (0.52 + k * 0.24), ww = w * (1 - k * 0.24);
      tri(s, t - ww, b, col, t + ww, b, mulc(col, 0.82), t, top, mulc(col, 1.1), FX0);
      const sy = top - (top - b) * 0.32;
      tri(s, t - ww * 0.32, sy, snow, t + ww * 0.32, sy, mulc(snow, 0.9), t, top, snow, FX0);
    }
  }

  // --------------------------------------------------------------- per-world silhouettes
  function sortByHeight(items) { return items.sort((a, b) => b.h - a.h); }
  function ringItems(rng, minW, maxW, gapChance, gapMin, gapMax, R, fill) {
    const items = []; let t = -Math.PI;
    while (t < Math.PI) {
      const w = rng.range(minW, maxW) / R;
      items.push(fill(t + w / 2, w));
      t += w * rng.range(0.55, 1.05) + (rng.chance(gapChance) ? rng.range(gapMin, gapMax) / R : 0);
    }
    return items;
  }
  // how "downtown" an azimuth is (tall clusters where the sun and the title view look)
  const cluster = (t, centres) => { let m = 0; for (const c of centres) { let d = Math.abs(((t - c + Math.PI) % TAU + TAU) % TAU - Math.PI); m = Math.max(m, Math.exp(-d * d / 0.09)); } return m; };

  function genCity(layer, s, rng) {
    const R = s.R;
    if (layer === 0) {
      const base = rgb(0x6d4a8a), c1 = rgb(0x9a6aa8), c2 = rgb(0x7f5c9e), c3 = rgb(0xb07aa6);
      const items = ringItems(rng, 16, 44, 0.12, 10, 50, R, (t, w) => {
        const k = cluster(t, [-0.95, 0.3, 2.9, -2.5]);
        return { t, w, h: rng.range(28, 62) + k * rng.range(25, 105), col: rng.pick([c1, c2, c3]) };
      });
      sortByHeight(items).forEach((it) => tower(s, { t: it.t, w: it.w, h: it.h, col: it.col, base, win: 0.05, beacon: rgb(0xff5a6a), dome: true }, rng));
    } else if (layer === 1) {
      const base = rgb(0x5a3c78), cs = [rgb(0x86589a), rgb(0x9d628f), rgb(0x74528f), rgb(0xa7708e)];
      const items = ringItems(rng, 12, 32, 0.1, 6, 30, R, (t, w) => {
        const k = cluster(t, [-0.2, 0.7, 3.0]);
        return { t, w, h: rng.range(16, 40) + k * rng.range(10, 45), col: rng.pick(cs) };
      });
      sortByHeight(items).forEach((it) => tower(s, { t: it.t, w: it.w, h: it.h, col: it.col, base, win: 0.08, tank: true, beacon: rgb(0xff5a6a), rim: rgb(0xe8a0a0) }, rng));
    } else {
      const base = rgb(0x4a2f60), cs = [rgb(0x6c4880), rgb(0x7a4a78), rgb(0x5f4a86)], tree = rgb(0x5a4a78);
      const items = ringItems(rng, 9, 26, 0.18, 4, 20, R, (t, w) => ({ t, w, h: rng.range(7, 22), col: rng.pick(cs) }));
      sortByHeight(items).forEach((it) => tower(s, { t: it.t, w: it.w, h: it.h, col: it.col, base, win: 0.1, tank: true, rim: rgb(0xd49aa2) }, rng));
      for (let i = 0; i < 70; i++) { // tree blobs in front of the rooftops
        const t = rng.range(-Math.PI, Math.PI), r = rng.range(3, 6), y = rng.range(1, 5);
        disc(s, t, y + r * 0.6, r / R, r * 0.8, 7, tree, mulc(tree, 0.9), FX0);
        quad(s, t - 0.5 / R, t + 0.5 / R, s.yb, y, y, base, base, FX0);
      }
    }
  }

  function genCoast(layer, s, rng) {
    const R = s.R;
    const seaA = -Math.PI, seaB = 0.1; // ocean on the left (-x)
    const inSea = (t) => t > seaA && t < seaB;
    if (layer === 0) {
      const sea = rgb(0x1788c2), seaTop = rgb(0x2aa6d8);
      const N = 90;
      for (let i = 0; i < N; i++) {
        const t0 = seaA + (seaB - seaA) * i / N, t1 = seaA + (seaB - seaA) * (i + 1) / N;
        quad(s, t0, t1, -R * 0.014, 0, 0, sea, seaTop, FXN);
      }
      const mtn = [];
      for (let i = 0; i < 16; i++) mtn.push({ t: rng.range(0.2, 3.1), h: rng.range(30, 85), w: rng.range(90, 200) / R });
      sortByHeight(mtn).forEach((m) => mountain(s, { t: m.t, h: m.h, wl: m.w * rng.range(0.8, 1.2), wr: m.w * rng.range(0.8, 1.2), leftLit: m.t > SUN_AZ_LIT,
        lit: rgb(0x58b89a), shade: rgb(0x2f7f78), base: rgb(0x2a6f73), cap: m.h > 65 ? 0.25 : 0, capLit: rgb(0x9ee6b8), capShade: rgb(0x6fbfa0), teeth: 3 }, rng));
      for (let i = 0; i < 6; i++) { // far flat islands on the sea line
        const t = rng.range(-2.9, -0.35), w = rng.range(30, 90) / R, h = rng.range(4, 12);
        gumdrop(s, { t, w, h, y0: -0.6, yb: -R * 0.004, pow: 0.55, top: rgb(0x3f9f86), lit: rgb(0x58b890), shade: rgb(0x2d7f70), base: rgb(0x3f8f7a), fx: FXN, seg: 10 }, rng);
      }
    } else if (layer === 1) {
      for (let i = 0; i < 7; i++) { // islands with palms
        const t = -0.35 - i * 0.38 + rng.range(-0.1, 0.1), w = rng.range(40, 90) / R, h = rng.range(6, 16);
        gumdrop(s, { t, w, h, y0: -0.5, yb: -R * 0.003, pow: 0.6, top: rgb(0x2fae7f), lit: rgb(0x5fcf8f), shade: rgb(0x1f8f6f), base: rgb(0xe8c486), fx: FXN, seg: 12 }, rng);
        quad(s, t - w * 0.85, t + w * 0.85, -R * 0.003, 0.6, 0.6, rgb(0xf5d9a0), rgb(0xf5d9a0), FXN); // beach rim
        const np = rng.range(2, 5) | 0;
        for (let k = 0; k < np; k++) palm(s, t + rng.range(-0.5, 0.5) * w, h * 0.6, rng.range(12, 20), rgb(0x7a5a40), rgb(0x1f8f5f), FXN, rng);
        if (i === 2) { // lighthouse
          const lt = t + w * 0.3, y0 = h * 0.7, lh = 34;
          for (let b = 0; b < 5; b++) { const wb = (3.6 - b * 0.4) / R, wt = (3.6 - (b + 1) * 0.4) / R, col = b % 2 ? rgb(0xff4f5a) : rgb(0xffffff);
            tri(s, lt - wb, y0 + b * lh / 5, col, lt + wb, y0 + b * lh / 5, col, lt + wt, y0 + (b + 1) * lh / 5, col, FXN);
            tri(s, lt - wb, y0 + b * lh / 5, col, lt + wt, y0 + (b + 1) * lh / 5, col, lt - wt, y0 + (b + 1) * lh / 5, col, FXN); }
          quad(s, lt - 2.2 / R, lt + 2.2 / R, y0 + lh, y0 + lh + 3.5, y0 + lh + 3.5, rgb(0xfff2a0), rgb(0xfff2a0), [0, 0, 1, 1]);
          tri(s, lt - 2.8 / R, y0 + lh + 3.5, rgb(0xd83a48), lt + 2.8 / R, y0 + lh + 3.5, rgb(0xd83a48), lt, y0 + lh + 7, rgb(0xd83a48), FXN);
        }
      }
      const hills = []; // green headland on the right
      for (let i = 0; i < 20; i++) hills.push({ t: rng.range(0.25, 3.05), h: rng.range(14, 38), w: rng.range(60, 130) / R });
      sortByHeight(hills).forEach((m) => gumdrop(s, { t: m.t, w: m.w, h: m.h, y0: 0, pow: 0.75, top: rgb(0x46b37f), lit: rgb(0x6fd08f), shade: rgb(0x2f8f6f), base: rgb(0x2f7f6a) }, rng));
      for (let i = 0; i < 40; i++) { const t = rng.range(0.3, 3.0); palm(s, t, rng.range(2, 10), rng.range(10, 16), rgb(0x6a5040), rgb(0x1f7f5a), FX0, rng); }
    } else {
      for (let i = 0; i < 9; i++) { // sailboats on the sea line
        const t = rng.range(-2.95, -0.25), hw = rng.range(4, 7) / R, sh = rng.range(9, 15);
        quad(s, t - hw, t + hw, -1.6, 0.6, 0.6, rgb(0xffffff), rgb(0xffffff), FXN);
        tri(s, t - hw * 0.1, 0.8, rgb(0xffffff), t + hw * 0.9, 0.8, rgb(0xf2f6ff), t, 0.8 + sh, rgb(0xffffff), FXN);
        tri(s, t - hw * 0.9, 0.8, rgb(0xff6f7a), t - hw * 0.2, 0.8, rgb(0xff6f7a), t - hw * 0.15, 0.8 + sh * 0.75, rgb(0xff8a90), FXN);
      }
      const dunes = [];
      for (let i = 0; i < 18; i++) dunes.push({ t: rng.range(0.2, 3.1), h: rng.range(6, 16), w: rng.range(40, 90) / R });
      sortByHeight(dunes).forEach((m) => gumdrop(s, { t: m.t, w: m.w, h: m.h, y0: 0, pow: 0.9, top: rgb(0xf0cf8a), lit: rgb(0xf8e0a8), shade: rgb(0xd9ac70), base: rgb(0xd9b07a), cap: 0.3, capCol: rgb(0x5fbf7f), drips: 7 }, rng));
    }
  }

  function genCandy(layer, s, rng) {
    const R = s.R;
    if (layer === 0) {
      const bodies = [[rgb(0xb88af0), rgb(0x8a5fd0)], [rgb(0xe08ad8), rgb(0xb060b8)], [rgb(0xa0a8f8), rgb(0x7078d8)]];
      const items = [];
      for (let i = 0; i < 18; i++) items.push({ t: rng.range(-Math.PI, Math.PI), h: rng.range(50, 115), w: rng.range(60, 120) / R, b: rng.pick(bodies) });
      sortByHeight(items).forEach((m) => {
        if (rng.chance(0.3)) { // ice-cream scoops
          const cols = [rgb(0xffb3d9), rgb(0xfff0c0), rgb(0xa8f0d8)];
          let y = 0;
          for (let k = 0; k < 3; k++) {
            const w = m.w * (1 - k * 0.22), h = m.h * 0.34;
            gumdrop(s, { t: m.t, w, h, y0: y, pow: 0.6, top: cols[k], lit: mulc(cols[k], 1.05), shade: mulc(cols[k], 0.82), base: mulc(cols[k], 0.8), cap: k === 2 ? 0.35 : 0, capCol: rgb(0xffffff) }, rng);
            y += h * 0.72;
          }
        } else {
          gumdrop(s, { t: m.t, w: m.w, h: m.h, y0: 0, pow: 0.62, top: m.b[0], lit: mulc(m.b[0], 1.12), shade: m.b[1], base: m.b[1], cap: rng.range(0.3, 0.45), capCol: rgb(0xffffff), drips: 11 }, rng);
        }
      });
    } else if (layer === 1) {
      const cols = [rgb(0xff8ac8), rgb(0x7fd6ff), rgb(0x8ef0c8), rgb(0xffd84d), rgb(0xc59bff), rgb(0xff9a7a)];
      const items = [];
      for (let i = 0; i < 30; i++) items.push({ t: rng.range(-Math.PI, Math.PI), h: rng.range(18, 48), w: rng.range(35, 75) / R, c: rng.pick(cols) });
      sortByHeight(items).forEach((m) => gumdrop(s, { t: m.t, w: m.w, h: m.h, y0: 0, pow: 0.66, top: m.c, lit: mixc(m.c, [1, 1, 1], 0.25), shade: mulc(m.c, 0.78), base: mulc(m.c, 0.75), cap: rng.range(0.25, 0.4), capCol: rng.chance(0.5) ? rgb(0xffffff) : rgb(0xffd6ec), drips: 9 }, rng));
      for (let i = 0; i < 14; i++) { // lollipops
        const t = rng.range(-Math.PI, Math.PI), h = rng.range(18, 34), r = rng.range(6, 10);
        quad(s, t - 0.6 / R, t + 0.6 / R, s.yb, h, h, rgb(0xffffff), rgb(0xffffff), FX0);
        const c = rng.pick(cols);
        disc(s, t, h + r * 0.9, r / R, r, 12, c, rgb(0xffffff), FX0);
      }
    } else {
      const hills = [];
      for (let i = 0; i < 40; i++) hills.push({ t: rng.range(-Math.PI, Math.PI), h: rng.range(5, 14), w: rng.range(30, 60) / R });
      sortByHeight(hills).forEach((m) => gumdrop(s, { t: m.t, w: m.w, h: m.h, y0: 0, pow: 0.8, top: rgb(0xff9ccf), lit: rgb(0xffb8dc), shade: rgb(0xe070b0), base: rgb(0xe070b0) }, rng));
      for (let i = 0; i < 16; i++) { // cupcakes
        const t = rng.range(-Math.PI, Math.PI), w = rng.range(6, 9) / R, h = rng.range(6, 9), y0 = rng.range(2, 6);
        const wc = rng.pick([rgb(0x7fd6ff), rgb(0xffd84d), rgb(0x8ef0c8)]);
        for (let k = 0; k < 6; k++) {
          const a = t - w + (2 * w) * k / 6, b = t - w + (2 * w) * (k + 1) / 6, ta = t - w * 0.8 + (1.6 * w) * k / 6, tb = t - w * 0.8 + (1.6 * w) * (k + 1) / 6, col = k % 2 ? wc : mulc(wc, 0.82);
          tri(s, ta, y0, col, tb, y0, col, b, y0 + h, col, FX0); tri(s, ta, y0, col, b, y0 + h, col, a, y0 + h, col, FX0);
        }
        gumdrop(s, { t, w: w * 1.15, h: h * 0.9, y0: y0 + h, yb: y0 + h, pow: 0.7, top: rgb(0xfff0f8), lit: rgb(0xffffff), shade: rgb(0xf0c8e0), base: rgb(0xf0c8e0), seg: 10 }, rng);
        disc(s, t, y0 + h * 1.95, 1.4 / R, 1.4, 6, rgb(0xff2a5a), rgb(0xff4a6a), FX0);
      }
      for (let i = 0; i < 12; i++) { // candy canes
        const t = rng.range(-Math.PI, Math.PI), h = rng.range(14, 24), wd = 0.9 / R;
        for (let k = 0; k < 6; k++) { const col = k % 2 ? rgb(0xff3050) : rgb(0xffffff); quad(s, t - wd, t + wd, h * k / 6, h * (k + 1) / 6 + 0.3, h * (k + 1) / 6 - 0.3, col, col, FX0); }
        const r = 3.2 / R;
        for (let k = 0; k < 6; k++) {
          const a0 = Math.PI - k / 6 * Math.PI, a1 = Math.PI - (k + 1) / 6 * Math.PI, col = k % 2 ? rgb(0xff3050) : rgb(0xffffff);
          const x0 = t + r + Math.cos(a0) * r, y0 = h + Math.sin(a0) * r * R, x1 = t + r + Math.cos(a1) * r, y1 = h + Math.sin(a1) * r * R;
          const xi0 = t + r + Math.cos(a0) * (r - 2 * wd), yi0 = h + Math.sin(a0) * (r - 2 * wd) * R, xi1 = t + r + Math.cos(a1) * (r - 2 * wd), yi1 = h + Math.sin(a1) * (r - 2 * wd) * R;
          tri(s, x0 - wd, y0, col, x1 - wd, y1, col, xi1 + wd, yi1, col, FX0); tri(s, x0 - wd, y0, col, xi1 + wd, yi1, col, xi0 + wd, yi0, col, FX0);
        }
      }
    }
  }

  function genNeon(layer, s, rng) {
    const R = s.R;
    const valley = (t) => Math.min(1, cluster(t, [SYN_AZ_RUN, SYN_AZ_TITLE]) * 1.2);
    if (layer === 0 || layer === 1) {
      const items = [];
      const n = layer === 0 ? 20 : 26;
      for (let i = 0; i < n; i++) {
        const t = rng.range(-Math.PI, Math.PI);
        const v = valley(t);
        const h = (layer === 0 ? rng.range(70, 165) : rng.range(34, 80)) * (1 - v * 0.75);
        items.push({ t, h, w: (layer === 0 ? rng.range(110, 210) : rng.range(60, 120)) / R });
      }
      const body = layer === 0 ? rgb(0x1c0c40) : rgb(0x160936);
      sortByHeight(items).forEach((m) => mountain(s, { t: m.t, h: m.h, wl: m.w * rng.range(0.8, 1.2), wr: m.w * rng.range(0.8, 1.2), leftLit: m.t > SYN_AZ_RUN,
        lit: mulc(body, 1.5), shade: body, base: mulc(body, 0.8), wire: layer === 0 ? 6 : 4, fx: [0, 1, 0, 0] }, rng));
    } else {
      const base = rgb(0x0e0626), cs = [rgb(0x1d0f42), rgb(0x251252), rgb(0x170b38)];
      const items = ringItems(rng, 10, 30, 0.16, 8, 40, R, (t, w) => ({ t, w, h: (rng.range(9, 26) + cluster(t, [0.45, -0.95, 2.5]) * rng.range(8, 36)) * (1 - 0.6 * cluster(t, [SYN_AZ_RUN])), col: rng.pick(cs) }));
      sortByHeight(items).forEach((it) => {
        tower(s, { t: it.t, w: it.w, h: it.h, col: it.col, base, win: 0.3, beacon: rgb(0xff3050), rim: rng.chance(0.5) ? rgb(0x39f0ff) : rgb(0xff4fd8), rimFx: rng.chance(0.6) ? FXG : FX0 }, rng);
        if (rng.chance(0.25)) { // neon sign on the facade
          const sw = it.w * 0.6, sy = it.h * rng.range(0.4, 0.75), sh = rng.range(3, 5);
          const col = rng.pick([rgb(0xff3fd2), rgb(0x39f0ff), rgb(0xffe14d)]);
          quad(s, it.t - sw / 2, it.t + sw / 2, sy, sy + sh, sy + sh, col, col, FXG);
        }
      });
    }
  }

  function genFrost(layer, s, rng) {
    const R = s.R;
    if (layer === 0 || layer === 1) {
      const items = [];
      const n = layer === 0 ? 26 : 30;
      for (let i = 0; i < n; i++) items.push({ t: rng.range(-Math.PI, Math.PI), h: layer === 0 ? rng.range(70, 170) : rng.range(35, 90), w: (layer === 0 ? rng.range(80, 170) : rng.range(50, 110)) / R });
      const lit = layer === 0 ? rgb(0x8fa6cc) : rgb(0x6f88b4), shade = layer === 0 ? rgb(0x5f739c) : rgb(0x475a86), base = layer === 0 ? rgb(0x6a7fa6) : rgb(0x55698f);
      sortByHeight(items).forEach((m) => {
        mountain(s, { t: m.t, h: m.h, wl: m.w * rng.range(0.7, 1.3), wr: m.w * rng.range(0.7, 1.3), leftLit: m.t > SUN_AZ_LIT,
          lit, shade, base, cap: rng.range(0.42, 0.62), capLit: rgb(0xfff2f6), capShade: rgb(0xc4d4ef), teeth: 4 }, rng);
        if (rng.chance(0.5)) { // sub-peak shoulder
          const t2 = m.t + rng.range(-0.8, 0.8) * m.w, h2 = m.h * rng.range(0.55, 0.8);
          mountain(s, { t: t2, h: h2, wl: m.w * 0.6, wr: m.w * 0.6, leftLit: t2 > SUN_AZ_LIT, lit, shade, base, cap: 0.4, capLit: rgb(0xfff2f6), capShade: rgb(0xc4d4ef), teeth: 3 }, rng);
        }
      });
    } else {
      const hills = [];
      for (let i = 0; i < 36; i++) hills.push({ t: rng.range(-Math.PI, Math.PI), h: rng.range(5, 14), w: rng.range(35, 70) / R });
      sortByHeight(hills).forEach((m) => gumdrop(s, { t: m.t, w: m.w, h: m.h, y0: 0, pow: 0.8, top: rgb(0xeef4fc), lit: rgb(0xffffff), shade: rgb(0xc8d8ee), base: rgb(0xc8d8ee) }, rng));
      for (let i = 0; i < 190; i++) {
        const t = rng.range(-Math.PI, Math.PI);
        pine(s, t, rng.range(0, 8), rng.range(9, 20), rng.chance(0.5) ? rgb(0x2e5d63) : rgb(0x24505a), rgb(0xf4f8ff), rng);
      }
    }
  }
  const GEN = { city: genCity, beach: genCoast, candy: genCandy, neon: genNeon, snow: genFrost };
  const STRIP_COLS = {
    city: { win: 0xffd08a, win2: 0xffb070, wire: 0xff4fd8, wire2: 0x39f0ff },
    beach: { win: 0xfff0c0, win2: 0xffe0a0, wire: 0xffffff, wire2: 0xffffff },
    candy: { win: 0xfff0c0, win2: 0xffe0a0, wire: 0xffffff, wire2: 0xffffff },
    neon: { win: 0x5ef2ff, win2: 0xff5fd8, wire: 0xff3fd2, wire2: 0x39f0ff },
    snow: { win: 0xffd08a, win2: 0xffc070, wire: 0xffffff, wire2: 0xffffff }
  };

  // ------------------------------------------------------------------ life geometry (init only)
  // Kit: like RR.Prop, but also bakes an aTint (vec2) attribute for per-instance colour A / B.
  const _km = new THREE.Matrix4(), _kq = new THREE.Quaternion(), _ke = new THREE.Euler(), _kp = new THREE.Vector3(), _ks = new THREE.Vector3(), _kc = new THREE.Color();
  function Kit() { this.parts = []; }
  Kit.prototype.add = function (geo, color, pos, rot, scale, tint) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    _ke.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    _kq.setFromEuler(_ke);
    if (typeof scale === 'number') _ks.set(scale, scale, scale); else _ks.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
    _km.compose(_kp.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _kq, _ks);
    g.applyMatrix4(_km);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), tn = new Float32Array(n * 2);
    _kc.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _kc.r; col[i * 3 + 1] = _kc.g; col[i * 3 + 2] = _kc.b; tn[i * 2] = tint ? tint[0] : 0; tn[i * 2 + 1] = tint ? tint[1] : 0; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(tn, 2));
    this.parts.push(g);
    return g;
  };
  Kit.prototype.build = function (extra) {
    let n = 0;
    this.parts.forEach((g) => (n += g.attributes.position.count));
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), tn = new Float32Array(n * 2), ex = extra ? new Float32Array(n) : null;
    let o = 0;
    this.parts.forEach((g) => {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); tn.set(g.attributes.aTint.array, o * 2);
      if (ex && g.userData.extra) ex.set(g.userData.extra, o);
      o += c; g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tn, 2));
    if (ex) geo.setAttribute(extra, new THREE.BufferAttribute(ex, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  };

  function cloudGeo(rng, kind) {
    const k = new Kit();
    const blobs = kind === 0
      ? [[0, 0, 0, 14], [-13, -3, 2, 10], [12, -2, -1, 11], [-4, 6, -2, 10], [6, 5, 3, 9], [-23, -5, 0, 7], [22, -5, 2, 7], [0, -3, 8, 9]]
      : [];
    if (kind === 1) for (let i = -5; i <= 5; i++) blobs.push([i * 10 + rng.range(-3, 3), rng.range(-2, 2), rng.range(-5, 5), rng.range(7, 11) * (1 - Math.abs(i) * 0.06)]);
    blobs.forEach((b) => k.add(new THREE.IcosahedronGeometry(b[3], 1), 0xffffff, [b[0], b[1], b[2]], [rng.range(0, 3), rng.range(0, 3), 0], [1, kind === 0 ? 0.85 : 0.6, 1]));
    const geo = k.build();
    const p = geo.attributes.position, c = geo.attributes.color;
    const floor = kind === 0 ? -6 : -4;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i);
      if (y < floor) { y = floor + (y - floor) * 0.18; p.setY(i, y); }
      const t = RR.smoothstep(floor, kind === 0 ? 14 : 8, y);
      c.setXYZ(i, 0.74 + 0.26 * t, 0.77 + 0.23 * t, 0.88 + 0.12 * t);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
  function balloonGeo() {
    const prof = [[1.2, -7.8], [2.6, -6.4], [4.4, -4.4], [5.9, -2.2], [6.8, 0.2], [7.0, 2.4], [6.6, 4.4], [5.6, 6.1], [4.0, 7.4], [2.1, 8.2], [0.01, 8.5]];
    const lathe = new THREE.LatheGeometry(prof.map((q) => new THREE.Vector2(q[0], q[1])), 12);
    const k = new Kit();
    const env = k.add(lathe, 0xffffff, [0, 0, 0], null, 1, [1, 0]);
    const p = env.attributes.position, t = env.attributes.aTint, c = env.attributes.color;
    for (let f = 0; f < p.count; f += 3) { // alternate gores A/B, darker skirt
      const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3, cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
      const seg = Math.floor(((Math.atan2(cx, cz) + Math.PI) / TAU) * 12) % 12;
      const b = seg % 2 === 1;
      for (let j = 0; j < 3; j++) {
        t.setXY(f + j, b ? 0 : 1, b ? 1 : 0);
        if (cy < -6.2) c.setXYZ(f + j, 0.72, 0.72, 0.72);
        else if (cy > 3.6 && cy < 5.0) c.setXYZ(f + j, 1.0, 0.97, 0.9);
      }
    }
    k.add(new THREE.BoxGeometry(1.7, 1.2, 1.7), 0x8a5a36, [0, -10.4, 0]);
    k.add(new THREE.BoxGeometry(1.9, 0.18, 1.9), 0x6a4026, [0, -9.8, 0]);
    k.add(new THREE.CylinderGeometry(0.35, 0.45, 0.6, 6), 0x444455, [0, -9.2, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(new THREE.BoxGeometry(0.08, 2.2, 0.08), 0x6a4a30, [sx * 0.85, -8.7, sz * 0.85], [sz * 0.12, 0, -sx * 0.12]);
    return k.build();
  }
  function birdGeo() {
    // body along z (nose at -z), wings along x with aWing = 0 at the root .. 1 at the tip
    const pos = [], col = [], wing = [];
    const body = [1, 1, 1], wc = [0.9, 0.9, 0.92], tip = [0.55, 0.55, 0.6];
    const T = (a, b, c, ca, cb, cc, wa, wb, wcw) => { pos.push(...a, ...b, ...c); col.push(...ca, ...cb, ...cc); wing.push(wa, wb, wcw); };
    const nose = [0, 0, -0.5], tail = [0, 0.02, 0.45], top = [0, 0.13, -0.02], bot = [0, -0.1, 0], l = [-0.12, 0, 0], r = [0.12, 0, 0];
    T(nose, l, top, body, body, body, 0, 0, 0); T(nose, top, r, body, body, body, 0, 0, 0); T(nose, bot, l, body, body, body, 0, 0, 0); T(nose, r, bot, body, body, body, 0, 0, 0);
    T(tail, top, l, body, body, body, 0, 0, 0); T(tail, r, top, body, body, body, 0, 0, 0); T(tail, l, bot, body, body, body, 0, 0, 0); T(tail, bot, r, body, body, body, 0, 0, 0);
    for (const sx of [-1, 1]) {
      const rootF = [sx * 0.1, 0.02, -0.18], rootB = [sx * 0.1, 0.02, 0.2], mid = [sx * 0.55, 0.16, -0.08], midB = [sx * 0.5, 0.14, 0.22], tipP = [sx * 1.08, -0.02, 0.2];
      T(rootF, rootB, mid, wc, wc, wc, 0, 0, 0.5); T(rootB, midB, mid, wc, wc, wc, 0, 0.5, 0.5); T(mid, midB, tipP, wc, wc, tip, 0.5, 0.5, 1);
    }
    T([-0.14, 0.02, 0.4], [0.14, 0.02, 0.4], [0, 0.02, 0.62], body, body, body, 0, 0, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    const tn = new Float32Array(wing.length * 2); for (let i = 0; i < wing.length; i++) tn[i * 2] = 1;
    geo.setAttribute('aTint', new THREE.BufferAttribute(tn, 2));
    geo.computeVertexNormals();
    return geo;
  }
  function blimpGeo() {
    const k = new Kit();
    k.add(new THREE.SphereGeometry(1, 18, 10), 0xffffff, [0, 0, 0], null, [7.5, 7.5, 30], [1, 0]);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      k.add(new THREE.BoxGeometry(0.5, 7, 8), 0xffffff, [Math.sin(a) * 6.2, Math.cos(a) * 6.2, 24], [0, 0, -a], 1, [0, 1]);
    }
    k.add(new THREE.BoxGeometry(3.2, 2.2, 8), 0xe8e8f0, [0, -8.0, -3]);
    k.add(new THREE.BoxGeometry(3.3, 0.8, 7), 0x3a4a70, [0, -7.6, -3.2]);
    for (const sx of [-1, 1]) k.add(new THREE.CylinderGeometry(0.7, 0.9, 2.4, 8), 0x9aa0b0, [sx * 3.2, -7.3, 1], [Math.PI / 2, 0, 0]);
    k.add(new THREE.SphereGeometry(1.2, 8, 6), 0xffffff, [0, 0, -29.6], null, 1, [0, 1]);
    return k.build();
  }
  function billboardGeo() {
    const pos = [], uv = [], nrm = [], idx = [];
    const L = 34, Hh = 8, NX = 16, NY = 4;
    for (const side of [1, -1]) {
      const o = pos.length / 3;
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
        const z = -L / 2 + L * i / NX, y = -Hh / 2 + Hh * j / NY;
        const rx = 7.5 * Math.sqrt(Math.max(0.02, 1 - (z / 30) * (z / 30) - (y / 7.5) * (y / 7.5)));
        pos.push(side * (rx + 0.12), y, z);
        uv.push(side > 0 ? 1 - i / NX : i / NX, j / NY);
        nrm.push(side, 0, 0);
      }
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const a = o + j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    return g;
  }
  function planeGeo() {
    const k = new Kit();
    k.add(new THREE.CylinderGeometry(1.7, 1.7, 30, 8), 0xffffff, [0, 0, 0], [Math.PI / 2, 0, 0]);
    k.add(new THREE.ConeGeometry(1.7, 5, 8), 0xffffff, [0, 0, -17.5], [-Math.PI / 2, 0, 0]);
    k.add(new THREE.ConeGeometry(1.7, 6, 8), 0xf0f0f4, [0, 0.4, 18], [Math.PI / 2, 0, 0]);
    k.add(new THREE.BoxGeometry(34, 0.45, 5.5), 0xe8ecf4, [0, -0.4, 1], [0, 0, 0]);
    k.add(new THREE.BoxGeometry(11, 0.35, 3), 0xe8ecf4, [0, 0.6, 18.5]);
    k.add(new THREE.BoxGeometry(0.45, 6.5, 4.5), 0xffffff, [0, 3.8, 18], null, 1, [1, 0]);
    for (const sx of [-1, 1]) k.add(new THREE.CylinderGeometry(0.9, 0.9, 3.5, 7), 0xc8ccd8, [sx * 6.5, -1.4, -0.5], [Math.PI / 2, 0, 0]);
    return k.build();
  }
  function trailGeo(segs) {
    const g = new THREE.PlaneGeometry(1, 1, segs, 1);
    g.translate(-0.5, 0, 0);
    return g;
  }
  function carGeo() {
    const k = new Kit();
    k.add(new THREE.BoxGeometry(2.4, 0.75, 5.0), 0xffffff, [0, 0, 0], null, 1, [1, 0]);
    k.add(new THREE.BoxGeometry(1.8, 0.62, 2.3), 0x1a2340, [0, 0.62, 0.3]);
    k.add(new THREE.BoxGeometry(2.0, 0.3, 1.4), 0xffffff, [0, 0.12, -2.2], [0.35, 0, 0], 1, [1, 0]);
    for (const sx of [-1, 1]) k.add(new THREE.CylinderGeometry(0.42, 0.42, 3.8, 6), 0x2a3050, [sx * 1.45, -0.2, 0.3], [Math.PI / 2, 0, 0]);
    k.add(new THREE.BoxGeometry(0.2, 0.7, 1.2), 0xffffff, [0, 0.55, 2.2], null, 1, [1, 0]);
    return k.build();
  }
  function carGlowGeo() {
    const k = new Kit();
    k.add(new THREE.BoxGeometry(1.9, 0.18, 0.1), 0xd8fbff, [0, 0.05, -2.56]);
    k.add(new THREE.BoxGeometry(2.3, 0.2, 0.1), 0xff2a6a, [0, 0.08, 2.56]);
    for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.22, 0.06, 3.8), 0x39f0ff, [sx * 0.75, -0.41, 0.1]);
    for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.1, 0.1, 3.6), 0xff4fd8, [sx * 1.22, 0.2, 0.2]);
    return k.build();
  }

  // ------------------------------------------------------------------ materials
  function skyUniforms(extra) { return Object.assign({}, U, extra || {}); }
  function lifeMat(defines, extraU, opts) {
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, LU, extraU || {}),
      vertexShader: LIFE_VS, fragmentShader: LIFE_FS, vertexColors: true, defines: defines || {}, fog: false
    });
    if (opts) Object.assign(m, opts);
    return m;
  }
  function fogU(n, f, min, max) { return { uFogN: { value: n }, uFogF: { value: f }, uFogMin: { value: min || 0 }, uFogMax: { value: max === undefined ? 1 : max } }; }

  // ------------------------------------------------------------------ life systems
  const life = { clouds: [], cloudPools: [], balloons: [], balloonPool: null, flocks: [], birdPool: null, blimp: null, planes: [], planePool: null, contrailPool: null, cars: [], carPools: null, timers: { plane: 4, blimpCd: 0 } };
  const rngLife = RR.makeRng(90210);
  const R_ = (a, b) => a + rngLife.next() * (b - a);
  const heightAt = (x, z) => { try { return RR.track && RR.track.heightAt ? RR.track.heightAt(x, z) || 0 : 0; } catch (e) { return 0; } };
  const tuneAt = (z) => TUNE[RR.worldIndexAt(z)];

  function setM(pools, id, x, y, z, ry, s, rx, rz) {
    _obj.position.set(x, y, z);
    _obj.rotation.set(rx || 0, ry || 0, rz || 0);
    if (typeof s === 'number') _obj.scale.setScalar(s); else _obj.scale.set(s[0], s[1], s[2]);
    _obj.updateMatrix();
    for (let i = 0; i < pools.length; i++) { pools[i].mesh.setMatrixAt(id, _obj.matrix); pools[i].mesh.instanceMatrix.needsUpdate = true; }
  }
  const _s3 = [1, 1, 1];

  function buildLife() {
    const rng = RR.makeRng(4242);
    // ---- cloud banks (2 prototypes, instanced)
    const cloudMats = [0, 1].map(() => lifeMat({ CLOUD: 1, VIS_FROM_INSTANCE: 1 }, fogU(420, 1060)));
    for (let kind = 0; kind < 2; kind++) {
      const cap = kind === 0 ? 14 : 10;
      const pool = new RR.InstancedPool(cloudGeo(rng, kind), cloudMats[kind], cap, scene, { colors: true });
      pool.mesh.name = 'sky-clouds-' + kind;
      for (let i = 0; i < cap; i++) { const id = pool.add(0, -9999, 0, 0, 0); pool.setColor(id, 0x000000); life.clouds.push({ pool, id, kind, x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, ry: 0, vx: 0, on: false, vis: 0, slot: life.clouds.length }); }
      life.cloudPools.push(pool);
    }
    // ---- balloons
    const bGeo = balloonGeo();
    const colB = new THREE.InstancedBufferAttribute(new Float32Array(8 * 3).fill(1), 3);
    bGeo.setAttribute('aColB', colB);
    life.balloonVis = new THREE.InstancedBufferAttribute(new Float32Array(8).fill(1), 1);
    life.balloonVis.setUsage(THREE.DynamicDrawUsage);
    bGeo.setAttribute('aVis', life.balloonVis);
    life.balloonPool = new RR.InstancedPool(bGeo, lifeMat({ TWO_TONE: 1, VIS_ATTR: 1 }, fogU(380, 880)), 8, scene, { colors: true });
    life.balloonPool.mesh.name = 'sky-balloons';
    life.balloonColB = colB;
    for (let i = 0; i < 8; i++) { const id = life.balloonPool.add(0, -9999, 0, 0, 0); life.balloons.push({ id, on: false, x: 0, y: 0, z: 0, ph: R_(0, 6), ry: 0, vr: 0, vx: 0, wi: 0 }); }
    // ---- birds
    const gBird = birdGeo();
    const cap = 40;
    const ph = new Float32Array(cap); for (let i = 0; i < cap; i++) ph[i] = rng.range(0, TAU);
    gBird.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    life.birdMat =    lifeMat({ FLAP: 1, DOUBLE: 1 }, Object.assign(fogU(170, 350), { uFlapF: { value: 10 }, uFlapA: { value: 0.6 }, uGlide: { value: 0.2 } }), { side: THREE.DoubleSide });
    life.birdPool = new RR.InstancedPool(gBird, life.birdMat, cap, scene, { colors: true });
    life.birdPool.mesh.name = 'sky-birds';
    for (let i = 0; i < cap; i++) life.birdPool.add(0, -9999, 0, 0, 0);
    for (let f = 0; f < 3; f++) life.flocks.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, n: 0, base: f * 13, kind: null, t: 0, timer: 1 + f * 3, off: [] });
    life.flocks.forEach((fl) => { for (let j = 0; j < 13; j++) fl.off.push([0, 0, 0, rng.range(0, TAU)]); });
    // ---- blimp (body + curved billboard)
    const bl = { on: false, x: 0, y: 0, z: 0, vz: -6, pools: [], wi: 0 };
    const gBlimp = blimpGeo();
    bl.vis = new THREE.InstancedBufferAttribute(new Float32Array([1]), 1);
    bl.vis.setUsage(THREE.DynamicDrawUsage);
    gBlimp.setAttribute('aVis', bl.vis);
    const blimpBody = new RR.InstancedPool(gBlimp, lifeMat({ TWO_TONE: 1, VIS_ATTR: 1 }, fogU(420, 900)), 1, scene, { colors: true });
    const bc = new THREE.InstancedBufferAttribute(new Float32Array([0.3, 0.8, 1.0]), 3);
    blimpBody.mesh.geometry.setAttribute('aColB', bc);
    bl.colB = bc;
    blimpBody.add(0, -9999, 0, 0, 0);
    life.boardTex = RR.canvasTex(512, 128, drawBoard);
    life.boardTex.generateMipmaps = true;
    const boardMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, LU, fogU(420, 900), { uMap: { value: life.boardTex }, uEmit: { value: 0.3 }, uVis: { value: 1 } }),
      vertexShader: [
        'varying vec2 vUv; varying vec3 vN; varying vec3 vRel;',
        'void main() { vUv = uv; mat4 m = modelMatrix * instanceMatrix; vec4 wp = m * vec4(position, 1.0); vN = normalize(mat3(m) * normal); vRel = wp.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * wp; }'
      ].join('\n'),
      fragmentShader: [
        GLSL_COMMON,
        'uniform sampler2D uMap; uniform float uEmit; uniform float uVis; uniform vec3 uLDir; uniform vec3 uLCol; uniform vec3 uHemiS; uniform vec3 uHemiG; uniform float uFogN; uniform float uFogF;',
        'varying vec2 vUv; varying vec3 vN; varying vec3 vRel;',
        'void main() { vec3 n = normalize(vN); vec3 irr = mix(uHemiG, uHemiS, 0.5 + 0.5 * n.y) + uLCol * max(dot(n, uLDir), 0.0);',
        '  vec3 c = texture2D(uMap, vUv).rgb; c *= mix(irr, vec3(uGlowBoost), uEmit);',
        '  float dist = length(vRel); c = mix(c, skyGrad(vRel / dist), max(smoothstep(uFogN, uFogF, dist), 1.0 - uVis)); gl_FragColor = vec4(c, 1.0); }'
      ].join('\n'),
      fog: false
    });
    const blimpBoard = new RR.InstancedPool(billboardGeo(), boardMat, 1, scene, {});
    blimpBoard.add(0, -9999, 0, 0, 0);
    blimpBody.mesh.name = 'sky-blimp'; blimpBoard.mesh.name = 'sky-blimp-board';
    bl.pools = [blimpBody, blimpBoard];
    bl.boardMat = boardMat;
    life.blimp = bl;
    // ---- planes + contrails (camera-relative, in the sky group)
    const gPlane = planeGeo();
    gPlane.setAttribute('aColB', new THREE.InstancedBufferAttribute(new Float32Array(9).fill(1), 3));
    life.planePool = new RR.InstancedPool(gPlane, lifeMat({ TWO_TONE: 1 }, fogU(860, 1090, 0.18)), 3, group, { colors: true });
    life.planePool.mesh.name = 'sky-planes';
    const trailMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { uColA: { value: new THREE.Color(0xffffff) }, uColB: { value: new THREE.Color(0xf4f6ff) }, uAlpha: { value: 0.62 }, uFogN: { value: 860 }, uFogF: { value: 1090 }, uSkyMix: { value: 0.22 }, uWide: { value: 2.6 } }),
      vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide
    });
    life.trailMat = trailMat;
    life.contrailPool = new RR.InstancedPool(trailGeo(16), trailMat, 3, group, { colors: true });
    life.contrailPool.mesh.name = 'sky-contrails';
    life.contrailPool.mesh.renderOrder = -40;
    for (let i = 0; i < 3; i++) {
      life.planePool.add(0, -9999, 0, 0, 0); life.contrailPool.add(0, -9999, 0, 0, 0);
      life.planes.push({ id: i, on: false, fx: 0, fz: 0, dx: 0, dz: 0, y: 0, s: 0, smax: 900, v: 70, yaw: 0 });
    }
    // ---- flying cars (Neon): body, glow strips, additive light streaks
    const CAR_N = 24;
    const carVis = new THREE.InstancedBufferAttribute(new Float32Array(CAR_N).fill(1), 1);
    carVis.setUsage(THREE.DynamicDrawUsage);
    life.carVis = carVis;
    const gBody = carGeo(), gGlow = carGlowGeo();
    gBody.setAttribute('aVis', carVis); gGlow.setAttribute('aVis', carVis);
    const carBody = new RR.InstancedPool(gBody, lifeMat({ VIS_ATTR: 1 }, fogU(230, 520)), CAR_N, scene, { colors: true });
    const carGlow = new RR.InstancedPool(gGlow, lifeMat({ GLOW: 1, VIS_ATTR: 1 }, fogU(260, 540)), CAR_N, scene, {});
    const streakMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { uColA: { value: new THREE.Color(0xff3f9a) }, uColB: { value: new THREE.Color(0x7a3cff) }, uAlpha: { value: 0.75 }, uFogN: { value: 240 }, uFogF: { value: 520 }, uSkyMix: { value: 0 }, uWide: { value: 0.2 } }),
      vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide
    });
    const carTrail = new RR.InstancedPool(trailGeo(6), streakMat, CAR_N, scene, { colors: true });
    carBody.mesh.name = 'sky-cars'; carGlow.mesh.name = 'sky-cars-glow'; carTrail.mesh.name = 'sky-cars-trail';
    life.carPools = [carBody, carGlow];
    life.carTrail = carTrail;
    const LANES = [[-38, 28, -1], [-56, 36, 1], [-82, 47, -1], [42, 30, 1], [62, 39, -1], [94, 52, 1]];
    life.lanes = LANES.map((l) => ({ x: l[0], y: l[1], dir: l[2], timer: R_(0, 2) }));
    for (let i = 0; i < CAR_N; i++) {
      carBody.add(0, -9999, 0, 0, 0); carGlow.add(0, -9999, 0, 0, 0); carTrail.add(0, -9999, 0, 0, 0);
      life.cars.push({ id: i, on: false, x: 0, y: 0, z: 0, v: 0, ph: R_(0, 6), lane: 0 });
    }
  }

  function drawBoard(x, w, h) {
    const g = x.createLinearGradient(0, 0, w, 0);
    ['#ff5a7a', '#ffb347', '#ffe066', '#5ee6a0', '#4fc3ff', '#9d7bff'].forEach((c, i) => g.addColorStop(i / 5, c));
    x.fillStyle = '#1b1340'; x.fillRect(0, 0, w, h);
    x.fillStyle = g; x.fillRect(0, 0, w, 14); x.fillRect(0, h - 14, w, 14);
    x.font = '64px ' + RR.FONT_DISPLAY; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 8; x.strokeStyle = '#0d0826'; x.strokeText('RAINBOW RAILS', w / 2, h / 2 + 3);
    x.fillStyle = '#ffffff'; x.fillText('RAINBOW RAILS', w / 2, h / 2 + 3);
    x.fillStyle = '#ffc233';
    for (const sx of [26, w - 26]) { x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 7 : 17; x.lineTo(sx + Math.cos(a) * r, h / 2 + Math.sin(a) * r); } x.closePath(); x.fill(); }
  }

  // cloud banks: world space, recycled ahead; per-slot activity by the world at the cloud's own z
  function placeCloud(cl, z, init) {
    const T = tuneAt(z);
    const wantK = Math.round(T.banks * (0.55 + 0.45 * (quality ? quality.density : 1)));
    // slot ranks: kind 0 slots 0..13, kind 1 slots 14..23 => interleave so both kinds are used
    const rank = cl.kind === 0 ? cl.slot * 1.6 : (cl.slot - 14) * 2.2 + 0.8;
    cl.on = rank < wantK;
    const side = rngLife.next() < 0.5 ? -1 : 1;
    cl.x = side * R_(30, 480);
    cl.z = z;
    const s = R_(0.8, 1.9);
    cl.sx = s * R_(0.9, 1.5); cl.sy = s * R_(0.7, 1.1); cl.sz = s * R_(0.8, 1.2);
    cl.y = Math.max(R_(62, 150), heightAt(cl.x, z) + 55) + cl.sy * 6;
    cl.ry = R_(-0.5, 0.5) + (rngLife.next() < 0.5 ? 0 : Math.PI);
    cl.vx = R_(0.6, 2.2) * (rngLife.next() < 0.7 ? 1 : -1);
  }
  function updateClouds(dt, camX, camZ) {
    const SPAN = 1400, BEHIND = 380;
    for (let i = 0; i < life.clouds.length; i++) {
      const cl = life.clouds[i];
      if (cl.z > camZ + BEHIND) placeCloud(cl, cl.z - SPAN, false);
      else if (cl.z < camZ - SPAN + BEHIND - 50) placeCloud(cl, cl.z + SPAN, false);
      cl.x += cl.vx * dt;
      const ax = Math.abs(cl.x);
      if (ax > 640) { cl.x = -Math.sign(cl.x) * 600; }
      cl.vis = 1 - RR.smoothstep(470, 600, ax);
      if (!cl.on) { cl.pool.mesh.setMatrixAt(cl.id, cl.pool.zero); cl.pool.mesh.instanceMatrix.needsUpdate = true; continue; }
      _s3[0] = cl.sx; _s3[1] = cl.sy; _s3[2] = cl.sz;
      cl.pool.set(cl.id, cl.x, cl.y, cl.z, cl.ry, _s3);
      _c1.setRGB(cl.vis, 0, 0); cl.pool.setColor(cl.id, _c1);
    }
  }

  function placeBalloon(b, z) {
    const T = tuneAt(z), wi = RR.worldIndexAt(z);
    const want = Math.round(T.balloons * (0.5 + 0.5 * (quality ? quality.density : 1)));
    b.on = b.id < want;
    b.z = z; b.wi = wi;
    if (!b.on) return;
    const side = rngLife.next() < 0.5 ? -1 : 1;
    const city = RR.WORLDS[wi].kind === 'city';
    b.x = side * R_(city ? 70 : 55, 240);
    b.y = Math.max(R_(city ? 60 : 35, city ? 125 : 105), heightAt(b.x, z) + 40);
    b.ry = R_(0, TAU); b.vr = R_(-0.08, 0.08); b.vx = R_(-1.2, 1.2);
    const acc = RR.WORLDS[wi].accents;
    const a = acc[(rngLife.next() * acc.length) | 0];
    let bb = acc[(rngLife.next() * acc.length) | 0]; if (bb === a) bb = 0xffffff;
    life.balloonPool.setColor(b.id, a);
    _c1.set(bb); life.balloonColB.setXYZ(b.id, _c1.r, _c1.g, _c1.b); life.balloonColB.needsUpdate = true;
  }
  function updateBalloons(dt, t, camZ) {
    const pool = life.balloonPool;
    let any = false;
    for (let i = 0; i < life.balloons.length; i++) {
      const b = life.balloons[i];
      if (b.z > camZ + 70) placeBalloon(b, camZ - R_(880, 1000));
      else if (b.z < camZ - 1100) placeBalloon(b, camZ - R_(880, 1000));
      b.x += b.vx * dt; b.ry += b.vr * dt;
      if (!b.on || W[b.wi] < 0.02) { pool.mesh.setMatrixAt(b.id, pool.zero); pool.mesh.instanceMatrix.needsUpdate = true; continue; }
      any = true;
      pool.set(b.id, b.x, b.y + Math.sin(t * 0.35 + b.ph) * 2.2, b.z, b.ry, 1.25);
      life.balloonVis.setX(b.id, W[b.wi]); // another world's balloons stay hidden until the sky has switched (tunnel)
    }
    life.balloonVis.needsUpdate = true;
    pool.mesh.visible = any;
  }

  function spawnFlock(fl, camX, camZ) {
    const z = camZ - R_(300, 360);
    const T = tuneAt(z);
    if (!T.birds || T.flocks <= 0 || W[RR.worldIndexAt(z)] < 0.9) return false;
    const idx = life.flocks.indexOf(fl);
    if (idx >= T.flocks) return false;
    const cfg = LIFE_CFG[T.birds];
    const wk = RR.WORLDS[RR.worldIndexAt(z)].kind;
    let side = rngLife.next() < 0.5 ? -1 : 1;
    if (wk === 'beach' && rngLife.next() < 0.75) side = -1; // gulls over the sea
    fl.on = true; fl.kind = T.birds; fl.cfg = cfg; fl.t = 0;
    fl.x = side * R_(36, 85); fl.z = z;
    fl.y = Math.max(R_(30, 44), heightAt(fl.x, z) + 22); // >= 27 with formation offsets: may drift over the track
    const ang = R_(-0.6, 0.6) + (rngLife.next() < 0.5 ? 0 : Math.PI);
    fl.vx = Math.sin(ang) * cfg.speed * 0.5 + side * R_(0, 3); fl.vz = -Math.cos(ang) * cfg.speed;
    fl.heading = Math.atan2(-fl.vx, -fl.vz);
    fl.n = Math.min(13, cfg.n);
    for (let j = 0; j < fl.n; j++) {
      const o = fl.off[j];
      if (cfg.form === 'v') { const k = (j + 1) >> 1, sd = j % 2 ? 1 : -1; o[0] = sd * k * 2.0; o[1] = R_(-0.2, 0.2); o[2] = k * 1.7; }
      else if (cfg.form === 'loose') { o[0] = R_(-9, 9); o[1] = R_(-3, 3); o[2] = R_(-9, 9); }
      else { o[0] = R_(-5, 5); o[1] = R_(-2.5, 2.5); o[2] = R_(-5, 5); }
    }
    for (let j = 0; j < fl.n; j++) life.birdPool.setColor(fl.base + j, j % 3 === 0 ? cfg.wing : cfg.col);
    return true;
  }
  function updateBirds(dt, t, camX, camZ) {
    const pool = life.birdPool;
    let any = false, fw = 0, flapF = 0, flapA = 0, glide = 0;
    for (let f = 0; f < life.flocks.length; f++) {
      const fl = life.flocks[f];
      if (!fl.on) {
        fl.timer -= dt;
        if (fl.timer <= 0) { if (!spawnFlock(fl, camX, camZ)) fl.timer = R_(2, 5); }
        for (let j = 0; j < 13; j++) pool.mesh.setMatrixAt(fl.base + j, pool.zero);
        pool.mesh.instanceMatrix.needsUpdate = true;
        if (!fl.on) continue;
      }
      fl.t += dt;
      fl.x += fl.vx * dt; fl.z += fl.vz * dt;
      const dz = fl.z - camZ, dx = fl.x - camX;
      if (dz > 25 || dz < -520 || Math.abs(dx) > 460) { fl.on = false; fl.timer = R_(3, 9); continue; }
      any = true;
      const cfg = fl.cfg, ch = Math.cos(fl.heading), sh = Math.sin(fl.heading);
      for (let j = 0; j < 13; j++) {
        const id = fl.base + j;
        if (j >= fl.n) { pool.mesh.setMatrixAt(id, pool.zero); continue; }
        const o = fl.off[j];
        const wx = o[0] + Math.sin(t * 0.9 + o[3]) * 0.7, wy = o[1] + Math.sin(t * 1.3 + o[3] * 2) * 0.5, wz = o[2] + Math.cos(t * 0.7 + o[3]) * 0.6;
        const x = fl.x + wx * ch + wz * sh, z = fl.z - wx * sh + wz * ch;
        pool.set(id, x, fl.y + wy, z, fl.heading, cfg.scale, 0, Math.sin(t * 0.8 + o[3]) * 0.15);
      }
      fw += 1; flapF += cfg.flapF; flapA += cfg.flapA; glide += cfg.glide;
    }
    if (fw > 0) { life.birdMat.uniforms.uFlapF.value = flapF / fw; life.birdMat.uniforms.uFlapA.value = flapA / fw; life.birdMat.uniforms.uGlide.value = glide / fw; }
    pool.mesh.visible = any;
  }

  const BLIMP_TINT = { city: [0xf2e6ff, 0xff7a9a], beach: [0xffffff, 0x2f8fff], candy: [0xffc2e6, 0x7fd6ff], neon: [0x2a1a55, 0xff3fd2], snow: [0xffffff, 0xff3b5c] };
  function updateBlimp(dt, t, camX, camZ) {
    const bl = life.blimp;
    if (!bl.on) {
      life.timers.blimpCd -= dt;
      if (life.timers.blimpCd <= 0) {
        const z = camZ - R_(880, 960);
        const T = tuneAt(z);
        if (T.blimp && (quality ? quality.density : 1) > 0.4) {
          const wk = RR.WORLDS[RR.worldIndexAt(z)].kind;
          bl.wi = RR.worldIndexAt(z);
          bl.on = true; bl.z = z; const side = rngLife.next() < 0.5 ? -1 : 1;
          bl.x = side * R_(95, 150);
          bl.y = Math.max(R_(68, 88), heightAt(bl.x, z) + 45);
          bl.vz = -R_(5, 8);
          const tint = BLIMP_TINT[wk] || BLIMP_TINT.city;
          bl.pools[0].setColor(0, tint[0]);
          _c1.set(tint[1]); bl.colB.setXYZ(0, _c1.r, _c1.g, _c1.b); bl.colB.needsUpdate = true;
          bl.boardMat.uniforms.uEmit.value = wk === 'neon' ? 0.85 : 0.3;
        } else life.timers.blimpCd = R_(4, 8);
      }
    }
    if (!bl.on) { bl.pools[0].mesh.visible = bl.pools[1].mesh.visible = false; return; }
    bl.z += bl.vz * dt;
    if (bl.z > camZ + 140 || bl.z < camZ - 1150) { bl.on = false; life.timers.blimpCd = R_(6, 16); return; }
    bl.pools[0].mesh.visible = bl.pools[1].mesh.visible = W[bl.wi] > 0.02;
    bl.vis.setX(0, W[bl.wi]); bl.vis.needsUpdate = true; bl.boardMat.uniforms.uVis.value = W[bl.wi];
    setM(bl.pools, 0, bl.x, bl.y + Math.sin(t * 0.3) * 1.5, bl.z, Math.sin(t * 0.07) * 0.06, 1, 0, Math.sin(t * 0.25) * 0.02);
  }

  const PLANE_TINT = [0xff4f5a, 0x2f8fff, 0x7c5cff, 0x2fbf71, 0xffa133];
  function updatePlanes(dt, frame, cam) {
    const pp = life.planePool, cp = life.contrailPool;
    const Tw = TUNE[frame.world];
    life.timers.plane -= dt;
    let active = 0, free = null;
    for (let i = 0; i < life.planes.length; i++) { if (life.planes[i].on) active++; else if (!free) free = life.planes[i]; }
    if (life.timers.plane <= 0) {
      life.timers.plane = R_(6, 16);
      if (active < Tw.planes && W[frame.world] > 0.9) {
        const p = free;
        if (p) {
          cam.getWorldDirection(_fwd);
          const yaw = Math.atan2(_fwd.x, -_fwd.z) + R_(-0.35, 0.35);
          const D = R_(600, 780);
          p.fx = Math.sin(yaw) * D; p.fz = -Math.cos(yaw) * D;
          const dirS = rngLife.next() < 0.5 ? 1 : -1;
          p.dx = Math.cos(yaw) * dirS; p.dz = Math.sin(yaw) * dirS;
          p.y = R_(95, 150); p.smax = 950; p.s = -p.smax; p.v = R_(60, 78); p.on = true;
          p.yaw = Math.atan2(-p.dx, -p.dz);
          pp.setColor(p.id, PLANE_TINT[(rngLife.next() * PLANE_TINT.length) | 0]);
        }
      }
    }
    let any = false;
    for (let i = 0; i < life.planes.length; i++) {
      const p = life.planes[i];
      if (!p.on) { pp.mesh.setMatrixAt(p.id, pp.zero); cp.mesh.setMatrixAt(p.id, cp.zero); pp.mesh.instanceMatrix.needsUpdate = cp.mesh.instanceMatrix.needsUpdate = true; continue; }
      p.s += p.v * dt;
      if (p.s > p.smax) { p.on = false; continue; }
      any = true;
      const x = p.fx + p.dx * p.s, z = p.fz + p.dz * p.s;
      pp.set(p.id, x, p.y, z, p.yaw, 1);
      const L = Math.min(420, p.s + p.smax);
      // contrail ribbon: local +x points along the flight direction; length L, half width 2.2
      _obj.position.set(x - p.dx * 20, p.y + 0.3, z - p.dz * 20);
      _obj.rotation.set(0, Math.atan2(-p.dz, p.dx), 0);
      _obj.scale.set(L, 4.4, 1);
      _obj.updateMatrix();
      cp.mesh.setMatrixAt(p.id, _obj.matrix); cp.mesh.instanceMatrix.needsUpdate = true;
      const fade = RR.smoothstep(0, 60, p.s + p.smax) * planeK;
      _c1.setRGB(fade, 0, 0); cp.setColor(p.id, _c1);
    }
    pp.mesh.visible = cp.mesh.visible = any;
    pp.mesh.material.uniforms.uFogMin.value = 0.18 + (1 - planeK); // planes dissolve when entering a world without them
  }

  const CAR_COLS = [0xff3fd2, 0x39f0ff, 0xffe14d, 0x7cff6b, 0xffffff, 0xff7a3d];
  let carWorld = 3;
  const neonW = () => W[carWorld];
  function updateCars(dt, t, camX, camZ, speed) {
    const body = life.carPools[0], glow = life.carPools[1], trail = life.carTrail;
    let any = false;
    // spawn per lane
    for (let l = 0; l < life.lanes.length; l++) {
      const ln = life.lanes[l];
      ln.timer -= dt;
      if (ln.timer > 0) continue;
      ln.timer = R_(1.2, 3.5);
      const sameDir = ln.dir < 0;
      const v = sameDir ? Math.max(22, speed) * R_(0.55, 1.45) : R_(26, 46);
      const fromBehind = sameDir && v > speed + 4;
      const z = fromBehind ? camZ + R_(530, 570) : camZ - R_(530, 580); // both lane ends are inside the fog
      if (RR.WORLDS[RR.worldIndexAt(z)].kind !== 'neon' || neonW() < 0.02 || (quality && quality.density < 0.6 && l % 2)) continue;
      let car = null;
      for (let k = 0; k < life.cars.length; k++) if (!life.cars[k].on) { car = life.cars[k]; break; }
      if (!car) continue;
      car.on = true; car.lane = l; car.x = ln.x + R_(-2, 2); car.y = Math.max(ln.y, heightAt(ln.x, z) + 20) + R_(-1.5, 1.5); car.z = z; car.v = v * (sameDir ? -1 : 1);
      body.setColor(car.id, CAR_COLS[(rngLife.next() * CAR_COLS.length) | 0]);
    }
    const vis = life.carVis;
    for (let i = 0; i < life.cars.length; i++) {
      const c = life.cars[i];
      let fade = 1, climb = 0;
      if (c.on) {
        c.z += c.v * dt;
        if (c.z > camZ + 600 || c.z < camZ - 640) c.on = false;
        // sky lanes end before the tunnels: near either end of the Neon zone the car climbs away and dissolves
        const k = Math.floor(Math.max(0, -c.z) / C.WORLD_LEN);
        const zEnd = c.v < 0 ? -(k + 1) * C.WORLD_LEN + 70 : -k * C.WORLD_LEN - 70;
        const d = c.v < 0 ? c.z - zEnd : zEnd - c.z;
        if (d < 170) { const u = RR.clamp(1 - d / 170, 0, 1); climb = u * u * 110; fade = 1 - u; }
        if (d <= 0 || RR.WORLDS[RR.worldIndexAt(c.z)].kind !== 'neon') c.on = false;
      }
      if (!c.on) { body.mesh.setMatrixAt(c.id, body.zero); glow.mesh.setMatrixAt(c.id, glow.zero); trail.mesh.setMatrixAt(c.id, trail.zero); continue; }
      fade *= neonW();
      if (fade < 0.02) { body.mesh.setMatrixAt(c.id, body.zero); glow.mesh.setMatrixAt(c.id, glow.zero); trail.mesh.setMatrixAt(c.id, trail.zero); continue; }
      any = true;
      vis.setX(c.id, fade);
      trail.setColor(c.id, _c1.setRGB(fade, 0, 0));
      const ry = c.v < 0 ? 0 : Math.PI;
      const y = c.y + climb + Math.sin(t * 1.6 + c.ph) * 0.35;
      setM(life.carPools, c.id, c.x, y, c.z, ry, 1.6, 0, Math.sin(t * 1.1 + c.ph) * 0.05);
      // light streak behind the car (points against the motion)
      _obj.position.set(c.x, y + 0.1, c.z + (c.v < 0 ? 4 : -4));
      _obj.rotation.set(0, c.v < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      _obj.scale.set(RR.clamp(Math.abs(c.v) * 0.45, 8, 26), 1.1, 1);
      _obj.updateMatrix();
      trail.mesh.setMatrixAt(c.id, _obj.matrix);
    }
    body.mesh.instanceMatrix.needsUpdate = glow.mesh.instanceMatrix.needsUpdate = trail.mesh.instanceMatrix.needsUpdate = true;
    vis.needsUpdate = true;
    body.mesh.visible = glow.mesh.visible = trail.mesh.visible = any;
  }

  function resetLife(pz) {
    const camZ = pz + 9;
    life.clouds.forEach((cl, i) => placeCloud(cl, camZ + 380 - ((i * 0.618) % 1) * 1400 - R_(0, 30), true));
    life.balloons.forEach((b) => placeBalloon(b, camZ - R_(160, 1000)));
    life.flocks.forEach((fl, i) => { fl.on = false; fl.timer = 0.5 + i * R_(2, 4); });
    if (life.flocks[0]) { life.flocks[0].timer = 0; }
    const bl = life.blimp; bl.on = false; life.timers.blimpCd = 0;
    // start the blimp already in view
    const T0 = tuneAt(pz - 300);
    if (T0.blimp) { life.timers.blimpCd = 0; updateBlimp(0, 0, 0, camZ + 560); if (bl.on) bl.z = pz - R_(420, 520); }
    life.planes.forEach((p) => (p.on = false));
    life.timers.plane = 1.5;
    life.cars.forEach((c) => (c.on = false));
    life.lanes.forEach((l) => (l.timer = 0));
    // pre-populate cars along the lanes
    if (RR.WORLDS[RR.worldIndexAt(pz - 200)].kind === 'neon') {
      for (let k = 0; k < 14; k++) {
        const car = life.cars[k], ln = life.lanes[k % life.lanes.length];
        car.on = true; car.lane = k % life.lanes.length; car.x = ln.x + R_(-2, 2); car.y = ln.y + R_(-1.5, 1.5); car.z = camZ - R_(40, 520);
        if (RR.WORLDS[RR.worldIndexAt(car.z)].kind !== 'neon') { car.on = false; continue; }
        car.v = (ln.dir < 0 ? -1 : 1) * R_(26, 46);
        life.carPools[0].setColor(car.id, [0xff3fd2, 0x39f0ff, 0xffe14d, 0x7cff6b][k % 4]);
      }
    }
  }

  // ------------------------------------------------------------------ init
  function init(c) {
    ctx = c; scene = c.scene; camera = c.camera; quality = c.quality || quality || RR.QUALITY.high;
    if (!RR.atmo) RR.atmoSet(0);
    RR.getMats();
    NW = RR.WORLDS.length;
    carWorld = Math.max(0, RR.WORLDS.findIndex((w) => w.kind === 'neon'));
    TUNE = RR.WORLDS.map((w) => {
      const t = Object.assign({}, TUNE_BY_KIND[w.kind] || TUNE_BY_KIND.city);
      t.hemiK = t.hemi / Math.max(0.01, w.hemiI); t.dirK = t.dir / Math.max(0.01, w.dirI);
      t.hazeC = new THREE.Color(t.haze);
      return t;
    });

    // shared uniforms
    Object.assign(U, {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uHaze: { value: hazeCol }, uHazeK: { value: 0.5 }, uSunDir: { value: sunDir }, uSunCol: { value: new THREE.Color() },
      uSunGlow: { value: 0.3 }, uGlowBoost: { value: 1 }, uTime: { value: 0 }
    });
    Object.assign(LU, {
      uLDir: { value: lightDir }, uLCol: { value: new THREE.Color() }, uHemiS: { value: new THREE.Color() }, uHemiG: { value: new THREE.Color() },
      uCloudCol: { value: new THREE.Color() }, uUnder: { value: new THREE.Color() }
    });
    api.fogColor = U.uHor.value; api.sunDir = sunDir; api.lightDir = lightDir;

    group = new THREE.Group();
    group.name = 'sky';
    scene.add(group);

    // dome
    domeMat = new THREE.ShaderMaterial({
      uniforms: skyUniforms({
        uCloud: { value: new THREE.Color() }, uCover: { value: 0.5 }, uCloudAmt: { value: 1 }, uCloudOff: { value: cloudOff },
        uStars: { value: 0 }, uRainbow: { value: 0 }, uRainDir: { value: rainDir }, uRainR: { value: RAIN_R },
        uNeon: { value: 0 }, uSynDir: { value: synDir }, uSynRight: { value: synRight }, uSynUp: { value: synUp }, uSynR: { value: SYN_R },
        uFrost: { value: 0 }, uSunDisc: { value: 1 }
      }),
      vertexShader: DOME_VS, fragmentShader: DOME_FS,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      defines: { OCT: 5, CLOUDQ: 2 }
    });
    dome = new THREE.Mesh(new THREE.SphereGeometry(C.SKY_RADIUS || 1100, 32, 16), domeMat);
    dome.name = 'sky-dome';
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    group.add(dome);

    // horizon strips per world x layer
    for (let wi = 0; wi < NW; wi++) {
      const kind = RR.WORLDS[wi].kind;
      const gen = GEN[kind] || genCity;
      const cols = STRIP_COLS[kind] || STRIP_COLS.city;
      strips[wi] = [];
      for (let layer = 0; layer < 3; layer++) {
        const R = STRIP_R[layer] - wi * 3;
        const s = Strip(R);
        gen(layer, s, RR.makeRng(1000 + wi * 77 + layer * 13));
        const geo = buildStripGeo(s);
        const mat = new THREE.ShaderMaterial({
          uniforms: skyUniforms({
            uLayerHaze: { value: TUNE[wi].strip[layer] }, uHazeLo: { value: -R * 0.006 }, uHazeHi: { value: R * [0.04, 0.026, 0.018][layer] },
            uAlpha: { value: 1 }, uWinK: { value: 1 },
            uWinCol: { value: new THREE.Color(cols.win) }, uWinCol2: { value: new THREE.Color(cols.win2) },
            uWireCol: { value: new THREE.Color(cols.wire) }, uWireCol2: { value: new THREE.Color(cols.wire2) }, uWireH: { value: layer === 0 ? 110 : 60 }
          }),
          vertexShader: STRIP_VS, fragmentShader: STRIP_FS, vertexColors: true,
          transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false
        });
        mat.extensions = { derivatives: true };
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'sky-strip-' + kind + '-' + layer;
        mesh.renderOrder = -60 + layer;
        mesh.frustumCulled = false;
        mesh.visible = false;
        group.add(mesh);
        strips[wi][layer] = mesh;
      }
    }

    // lights
    hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.5);
    hemi.name = 'sky-hemi';
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.name = 'sky-sun';
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    api.sunLight = sun; api.hemiLight = hemi;

    // fog
    fog = new THREE.Fog(0xffffff, 50, 480);
    scene.fog = fog;

    buildLife();
    // redraw the blimp board once the display font has loaded
    try {
      if (document.fonts && document.fonts.load) document.fonts.load('64px "Lilita One"').then(() => {
        const cv = life.boardTex.image; drawBoard(cv.getContext('2d'), cv.width, cv.height); life.boardTex.needsUpdate = true;
      }).catch(() => {});
    } catch (e) { /* fonts API unavailable */ }

    inited = true;
    setQuality(quality);
    reset(0);
  }

  // ------------------------------------------------------------------ quality
  function setQuality(q) {
    if (!q) return;
    quality = q;
    if (!inited) return;
    const oct = q.name === 'low' ? 3 : q.name === 'medium' ? 4 : 5, cq = q.name === 'low' ? 1 : 2;
    if (domeMat.defines.OCT !== oct || domeMat.defines.CLOUDQ !== cq) { domeMat.defines.OCT = oct; domeMat.defines.CLOUDQ = cq; domeMat.needsUpdate = true; }
    sun.castShadow = !!q.shadows;
    const ms = q.shadowMap || 1024;
    if (sun.shadow.mapSize.x !== ms) {
      sun.shadow.mapSize.set(ms, ms);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      shadowBasis.valid = false;
    }
  }

  // ------------------------------------------------------------------ reset
  function reset(pz) {
    if (!inited) return;
    const wi = RR.worldIndexAt(pz);
    for (let i = 0; i < W.length; i++) W[i] = i === wi ? 1 : 0;
    lastWorld = wi;
    if (camera) {
      camera.getWorldDirection(_fwd); titleW = RR.smoothstep(-0.1, 0.35, _fwd.z);
      let dy = (Math.atan2(_fwd.x, -_fwd.z) - (titleW > 0.5 ? Math.PI : 0)) % TAU; if (dy > Math.PI) dy -= TAU; if (dy < -Math.PI) dy += TAU;
      yawOff = RR.clamp(dy, -0.9, 0.9) * 0.75;
      if (camera.isPerspectiveCamera) halfH = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * (camera.aspect || 1));
    }
    camZprev = null;
    shadowBasis.valid = false;
    if (camera) { camera.getWorldPosition(_v3); group.position.copy(_v3); group.updateMatrixWorld(); }
    resetLife(pz);
    applyBlend(0, { t: 0, world: wi, pz, px: 0, speed: 0, camera }, true);
  }

  // ------------------------------------------------------------------ per-frame
  function applyBlend(dt, frame, snap) {
    const A = RR.atmo;
    // blended tuning scalars
    planeK = 0;
    let gl = 0, hk = 0, dk = 0, le = 0, fn = 0, ff = 0, hz = 0, sg = 0, sdk = 0, cv = 0, ca = 0, rk = 0, sk = 0, wk = 0, neon = 0, frost = 0;
    hazeCol.setRGB(0, 0, 0);
    for (let i = 0; i < NW; i++) {
      const w = W[i]; if (w <= 0) continue;
      const T = TUNE[i];
      gl += T.gndLift * w; hk += T.hemiK * w; dk += T.dirK * w; planeK += T.planes > 0 ? w : 0; le += T.lElev * w; fn += T.fog[0] * w; ff += T.fog[1] * w; hz += T.hazeK * w;
      sg += T.sunGlow * w; sdk += T.sunDisc * w; cv += T.cover * w; ca += T.cloudAmt * w; rk += T.rainK * w; sk += T.starsK * w; wk += T.winK * w;
      hazeCol.r += T.hazeC.r * w; hazeCol.g += T.hazeC.g * w; hazeCol.b += T.hazeC.b * w;
      const kind = RR.WORLDS[i].kind;
      if (kind === 'neon') neon += w; else if (kind === 'snow') frost += w;
    }
    // colours from the shared atmosphere
    U.uTop.value.copy(A.skyTop); U.uMid.value.copy(A.skyMid); U.uHor.value.copy(A.horizon); U.uSunCol.value.copy(A.sun);
    U.uHazeK.value = hz; U.uSunGlow.value = sg;
    U.uTime.value = frame.t || 0;
    U.uGlowBoost.value = RR.mats && RR.mats.glow ? Math.max(1, RR.mats.glow.color.r) : 1;
    const du = domeMat.uniforms;
    du.uCloud.value.copy(A.cloud);
    du.uCover.value = cv; du.uCloudAmt.value = ca;
    du.uStars.value = RR.clamp(A.stars * sk, 0, 1.5);
    du.uRainbow.value = RR.clamp(A.rainbow * rk * 1.35, 0, 1);
    du.uNeon.value = neon; du.uFrost.value = frost; du.uSunDisc.value = sdk;

    // sun / rainbow / synthwave placement (run layout vs camera-looking-at-+z layout)
    const tw = smooth01(titleW);
    const el = RR.clamp(A.sunElev * SUN_ELEV_K, 0.085, 0.5);
    const sunOff = Math.min(0.52, halfH * 0.7);
    dirFromAzEl(sunDir, lerpAngle(-sunOff, Math.PI - sunOff * 0.65, tw) + yawOff, el + tw * 0.03);
    dirFromAzEl(rainDir, lerpAngle(RAIN_AZ_RUN, RAIN_AZ_TITLE, tw) + yawOff, RAIN_EL);
    const saz = lerpAngle(SYN_AZ_RUN, SYN_AZ_TITLE, tw) + yawOff * 0.5;
    dirFromAzEl(synDir, saz, SYN_EL);
    synRight.set(Math.cos(saz), 0, Math.sin(saz));
    synUp.crossVectors(synRight, synDir).normalize();
    if (synUp.y < 0) synUp.negate();

    // lights (per-world scaled so lit albedo 0.85 peaks near 1.0)
    const laz = lerpAngle(L_AZ_RUN, L_AZ_TITLE, tw);
    dirFromAzEl(lightDir, laz, le);
    hemi.color.copy(A.hemiSky); hemi.groundColor.copy(A.hemiGround).lerp(A.hemiSky, gl); hemi.intensity = A.hemiI * hk;
    sun.color.copy(A.light); sun.intensity = A.dirI * dk;
    LU.uLCol.value.copy(A.light).multiplyScalar(sun.intensity);
    LU.uHemiS.value.copy(A.hemiSky).multiplyScalar(hemi.intensity);
    LU.uHemiG.value.copy(A.hemiGround).lerp(A.hemiSky, 0.7).multiplyScalar(hemi.intensity * 0.95); // sky objects are seen from below
    LU.uCloudCol.value.copy(A.cloud);
    // TUNE bank tint (warm sunset clouds)
    _c2.setRGB(0, 0, 0);
    for (let i = 0; i < NW; i++) if (W[i] > 0) { _c1.set(TUNE[i].bankTint); _c2.r += _c1.r * W[i]; _c2.g += _c1.g * W[i]; _c2.b += _c1.b * W[i]; }
    LU.uCloudCol.value.lerp(_c2, 0.35);
    LU.uUnder.value.setRGB(0.62, 0.12, 0.5).multiplyScalar(neon * 0.5);

    // fog
    fog.color.copy(A.horizon); fog.near = fn; fog.far = ff;
    if (scene.fog !== fog) scene.fog = fog;

    // strips: fade + rise per world
    for (let i = 0; i < NW; i++) {
      const w = W[i], vis = w > 0.004;
      const a = smooth01(w);
      for (let l = 0; l < 3; l++) {
        const m = strips[i][l];
        m.visible = vis;
        if (!vis) continue;
        m.material.uniforms.uAlpha.value = a;
        m.material.uniforms.uWinK.value = RR.clamp(A.glow, 0.25, 1.4) * wk;
        m.scale.y = 0.45 + 0.55 * a;
      }
    }
  }

  function updateShadow(frame) {
    if (!sun.castShadow) {
      sun.target.position.set(0, 0, frame.pz - 15);
      sun.position.copy(sun.target.position).addScaledVector(lightDir, 80);
      sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
      return;
    }
    const sb = shadowBasis;
    const ms = sun.shadow.mapSize.x;
    if (!sb.valid || sb.z.dot(lightDir) < 0.999999 || sb.map !== ms) {
      sb.z.copy(lightDir);
      sb.x.crossVectors(_up, sb.z).normalize();
      sb.y.crossVectors(sb.z, sb.x);
      let ex = 0, ey = 0, ez = 0;
      for (let i = 0; i < 8; i++) {
        _v1.set(i & 1 ? 14 : -14, i & 2 ? 8 : -4, i & 4 ? 27.5 : -27.5);
        ex = Math.max(ex, Math.abs(_v1.dot(sb.x))); ey = Math.max(ey, Math.abs(_v1.dot(sb.y))); ez = Math.max(ez, Math.abs(_v1.dot(sb.z)));
      }
      sb.ex = ex; sb.ey = ey; sb.ez = ez; sb.valid = true; sb.map = ms;
      const cam = sun.shadow.camera;
      cam.left = -ex; cam.right = ex; cam.top = ey; cam.bottom = -ey;
      cam.near = Math.max(0.5, 80 - ez - 6); cam.far = 80 + ez + 6;
      cam.updateProjectionMatrix();
    }
    // box centre: x 0, y 4, from 10 m behind to 45 m ahead of the player; snapped to shadow texels
    _v2.set(0, 4, frame.pz - 17.5);
    const tx = (2 * sb.ex) / ms, ty = (2 * sb.ey) / ms;
    const px = _v2.dot(sb.x), py = _v2.dot(sb.y);
    _v2.addScaledVector(sb.x, Math.round(px / tx) * tx - px).addScaledVector(sb.y, Math.round(py / ty) * ty - py);
    sun.target.position.copy(_v2);
    sun.position.copy(_v2).addScaledVector(lightDir, 80);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  function update(dt, frame) {
    if (!inited || !frame) return;
    const cam = frame.camera || camera;
    dt = Math.min(dt || 0, 0.1);
    // smoothed per-world weights (blend happens while the player is in the tunnel)
    const wi = frame.world | 0;
    const rate = 2.4;
    for (let i = 0; i < NW; i++) W[i] = RR.damp(W[i], i === wi ? 1 : 0, rate, dt);
    lastWorld = wi;
    cam.getWorldDirection(_fwd);
    titleW = RR.damp(titleW, RR.smoothstep(-0.1, 0.35, _fwd.z), 2.5, dt);
    {
      const yawCam = Math.atan2(_fwd.x, -_fwd.z), yawRef = lerpAngle(0, Math.PI, smooth01(titleW));
      let dy = (yawCam - yawRef) % TAU; if (dy > Math.PI) dy -= TAU; if (dy < -Math.PI) dy += TAU;
      yawOff = RR.damp(yawOff, RR.clamp(dy, -0.9, 0.9) * 0.75, 1.5, dt);
      if (cam.isPerspectiveCamera) halfH = RR.damp(halfH, Math.atan(Math.tan((cam.fov * Math.PI) / 360) * (cam.aspect || 1)), 0.5, dt); // slow: ignores FOV kicks, follows resizes
    }

    applyBlend(dt, frame, false);

    // sky group follows the camera
    cam.getWorldPosition(_v3);
    group.position.copy(_v3);
    group.updateMatrixWorld();

    // cloud scroll: wind + parallax from forward motion
    const camZ = _v3.z, camX = _v3.x;
    const moved = camZprev === null ? 0 : RR.clamp(camZ - camZprev, -60, 60);
    camZprev = camZ;
    cloudOff.x += dt * 0.006;
    cloudOff.y += dt * 0.004 + moved * 0.00042;

    updateShadow(frame);

    const t = frame.t || 0;
    updateClouds(dt, camX, camZ);
    updateBalloons(dt, t, camZ);
    updateBirds(dt, t, camX, camZ);
    updateBlimp(dt, t, camX, camZ);
    updatePlanes(dt, frame, cam);
    updateCars(dt, t, camX, camZ, frame.speed || 0);
  }

  RR.register('sky', api);
})(window.RR);
