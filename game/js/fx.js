/* Rainbow Rails — fx
 * Particles (per-world ambient weather, event bursts, footstep dust, power-up trails, debris), camera
 * speed lines, the post-processing chain (HDR scene target -> bloom -> grade (+FXAA)) and render().
 *
 * Draw calls: ambient (1), bursts + trails + dust (1), debris cubes (1, only while alive), speed lines (1,
 * only while visible). Post: bloom 12 quads + 1 grade quad; FXAA is folded into the grade pass.
 * Everything is built once in init; update() only writes uniforms and ring-buffer slots (no allocation).
 * Particles never render within 4 m of the camera and their on-screen size is capped in the shader.
 */
(function (RR) {
  'use strict';
  if (!RR) return;
  const C = RR.C;
  const TAU = Math.PI * 2;
  const NW = (RR.WORLDS && RR.WORLDS.length) || 5;

  // ------------------------------------------------------------------ per-world tuning (fx only)
  // amb: ambient particle kind. dust: footstep/landing colour (+ alt). dustKind: extra flavour for dust bursts.
  // shadow/high: split-toning tints; split: their strength. sat: grade saturation. bloomK: bloom strength = atmo.bloom * bloomK.
  // lineA/lineB: speed-line tints.
  const WORLD_FX = {
    sunset: { amb: 'motes', dust: [0.84, 0.6, 0.55], dustAlt: [0.98, 0.8, 0.62], dustKind: 'dust', shadow: 0x5a3a8a, high: 0xffd9a0, split: 0.16, sat: 1.08, bloomK: 0.7, lineA: [1, 0.92, 0.82], lineB: [1, 0.78, 0.72] },
    coast: { amb: 'spray', dust: [0.97, 0.87, 0.66], dustAlt: [1, 0.95, 0.82], dustKind: 'sand', shadow: 0x1f6f80, high: 0xfff6e0, split: 0.14, sat: 1.1, bloomK: 0.7, lineA: [0.92, 1, 1], lineB: [1, 1, 0.9] },
    candy: { amb: 'confetti', dust: [1, 0.78, 0.9], dustAlt: [1, 0.92, 0.97], dustKind: 'sprinkles', shadow: 0xb06ee8, high: 0xfff0f8, split: 0.14, sat: 1.08, bloomK: 0.7, lineA: [1, 0.9, 0.97], lineB: [0.85, 0.95, 1] },
    neon: { amb: 'glow', dust: [0.45, 0.35, 0.8], dustAlt: [0.3, 0.95, 1], dustKind: 'sparks', shadow: 0x140a3a, high: 0x7cf6ff, split: 0.18, sat: 1.14, bloomK: 0.72, lineA: [0.45, 0.95, 1], lineB: [1, 0.4, 0.9] },
    frost: { amb: 'snow', dust: [0.93, 0.96, 1], dustAlt: [1, 1, 1], dustKind: 'powder', shadow: 0x6d8fd6, high: 0xfff8ee, split: 0.16, sat: 1.04, bloomK: 0.7, lineA: [0.9, 0.96, 1], lineB: [1, 1, 1] }
  };
  const FX_BY_KIND = { city: 'sunset', beach: 'coast', candy: 'candy', neon: 'neon', snow: 'frost' };
  const worldFx = (i) => {
    const w = RR.WORLDS[((i % NW) + NW) % NW] || RR.WORLDS[0];
    return WORLD_FX[w.id] || WORLD_FX[FX_BY_KIND[w.kind]] || WORLD_FX.sunset;
  };

  // Ambient kinds (shader ids). Each world picks one through WORLD_FX[].amb (fallback: RR.WORLDS[].particles).
  const AMB = { motes: 0, spray: 1, confetti: 2, glow: 3, snow: 4 };
  const AMB_ALIAS = { motes: 'motes', petals: 'motes', spray: 'spray', confetti: 'confetti', glow: 'glow', snow: 'snow' };
  // per kind: 4 palette colours, sizes (half-size in metres: near min/max, far min/max),
  // look (alpha, additive 0..1, fragment shape, density 0..1)
  const AMB_KIND = [
    { pal: [0xffe2a0, 0xffc98a, 0xffb0b8, 0xfff2cf], size: [0.035, 0.075, 0.09, 0.17], look: [0.8, 0.75, 0, 0.55] }, // motes (warm dust in the golden light)
    { pal: [0xf2fbff, 0xdff6ff, 0xffffff, 0xc9f0ff], size: [0.03, 0.065, 0.07, 0.14], look: [0.6, 0.25, 0, 0.5] }, // spray
    { pal: [0xff5fa2, 0x5ee0c8, 0xffd84d, 0xa87bff], size: [0.07, 0.11, 0.15, 0.24], look: [0.95, 0.0, 3, 0.5] }, // confetti
    { pal: [0x5ef2ff, 0xff4fd8, 0xffe14d, 0x9c7bff], size: [0.055, 0.11, 0.13, 0.26], look: [1.0, 1.0, 0, 0.72] }, // glow (additive, blooms)
    { pal: [0xffffff, 0xf4f8ff, 0xe8f1ff, 0xffffff], size: [0.04, 0.085, 0.1, 0.2], look: [0.9, 0.05, 8, 1.0] } // snow
  ];
  // Near layer (dense, around the camera) and far layer (sparser, big). Sizes in metres.
  const BOX_NEAR = [30, 17, 46], BOX_FAR = [120, 40, 200];
  const AMB_MAX = 2000; // instances allocated (high tier); quality.particles scales the drawn count
  const BURST_CAP = 2048;
  const DEBRIS_CAP = 48;
  const LINES_MAX = 64;
  const BASE_VIG = 0.3;
  const NEAR_HIDE = 4.0; // ambient particles are never drawn closer than this to the camera
  const NEAR_HIDE_B = 3.5; // bursts (always emitted near the runner, ~10 m from the camera)

  // ------------------------------------------------------------------ state
  let renderer = null, scene = null, camera = null, quality = RR.QUALITY ? RR.QUALITY.high : null;
  let ready = false;
  let T = 0; // fx clock (s)
  let lastSpeed = 0;
  const lastP = { x: 0, y: 0, z: 0, ok: false, grounded: true, state: 'title' };
  const camVel = new THREE.Vector3(), camPrev = new THREE.Vector3(), camFwd = new THREE.Vector3();
  let camPrevOk = false;
  let reduceMotion = false;
  let particleQ = 1;
  const wind = new THREE.Vector3(); // integrated wind offset (m)
  let windVx = 0.4;
  // grade / bloom state (damped)
  const G = { sat: 1, satT: 1, vig: BASE_VIG, vigT: BASE_VIG, speedFx: 0, bloom: 0.4, world: 0, snapped: false };
  const gShadow = new THREE.Color(), gHigh = new THREE.Color(), gVigCol = new THREE.Color(), _c = new THREE.Color(), _c2 = new THREE.Color();
  let gWorldSat = 1;
  let burstCoinFrame = -1, burstPickupFrame = -1, frameNo = 0, poofsThisFrame = 0;

  // ------------------------------------------------------------------ shaders
  const SHARED_FRAG = [
    'varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vAdd; varying float vShape; varying float vPx; varying float vW;',
    'void main() {',
    '  vec2 uv = vUv; float r2 = dot(uv, uv); float a; float s = vShape;',
    '  if (s < 0.5) { a = exp(-r2 * 4.2); }', // soft dot
    '  else if (s < 1.5) {', // four-point star sparkle
    '    vec2 q = abs(uv);',
    '    float rays = max(0.0, 1.0 - q.x * 6.0) * (1.0 - q.y) + max(0.0, 1.0 - q.y * 6.0) * (1.0 - q.x);',
    '    a = min(1.0, exp(-r2 * 7.0) + rays * 0.95);',
    '  }',
    '  else if (s < 2.5 || (s > 5.5 && s < 6.5)) { float r = sqrt(r2); float w = vW > 0.0 ? vW : 0.26; a = smoothstep(w, w * 0.25, abs(r - 0.76)) * (1.0 - smoothstep(0.96, 1.0, r)); }', // ring (width vW)
    '  else if (s < 3.5) { vec2 q = abs(uv) - vec2(1.0, 0.62); float e = -max(q.x, q.y) * max(vPx, 1.0); a = clamp(e + 0.5, 0.0, 1.0); }', // chip / confetti
    '  else if (s < 4.5) { a = 1.0 - smoothstep(0.0, 1.0, r2); a *= a * (0.85 + 0.15 * sin(uv.x * 5.0 + uv.y * 3.0)); }', // puff
    '  else if (s < 5.5) { a = (1.0 - uv.x * uv.x) * (1.0 - smoothstep(0.2, 1.0, abs(uv.y))); }', // streak
    '  else if (s < 7.5) { a = exp(-r2 * 3.0) * 0.65 + exp(-r2 * 22.0) * 0.6; }', // flare
    '  else { float r = sqrt(r2); a = (1.0 - smoothstep(0.35, 1.0, r)) * 0.85 + exp(-r2 * 10.0) * 0.25; }', // snowflake
    '  a *= vA;',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(vCol * a, a * (1.0 - vAdd));', // premultiplied: vAdd=1 -> additive, 0 -> alpha blend
    '}'
  ].join('\n');

  const CULL = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return;';

  const AMB_VERT = [
    '#define NW ' + NW,
    'attribute vec4 aSeed; attribute vec4 aSeed2;',
    'uniform float uTime, uAspect, uMaxNdc, uMinNdc, uHalfH, uAlpha, uBoost;',
    'uniform vec3 uCam, uWind;',
    'uniform vec3 uBoxO[2]; uniform vec3 uBoxS[2];',
    'uniform float uKind[NW];',
    'uniform vec3 uPal[20]; uniform vec4 uKSize[5]; uniform vec4 uKLook[5];',
    'varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vAdd; varying float vShape; varying float vPx; varying float vW;',
    'void main() {',
    '  vUv = position.xy; vCol = vec3(0.0); vAdd = 0.0; vShape = 0.0; vPx = 1.0; vW = 0.0;',
    '  float layer = aSeed2.x;',
    '  vec3 O = layer < 0.5 ? uBoxO[0] : uBoxO[1];',
    '  vec3 S = layer < 0.5 ? uBoxS[0] : uBoxS[1];',
    '  float r1 = aSeed2.y, r2 = aSeed2.z, r3 = aSeed2.w, ph = r2 * 6.2831853, T = uTime;',
    '  float zu = aSeed.z * S.z + uWind.z * (0.8 + 0.4 * r1) + sin(T * 0.37 + ph) * 0.6;',
    '  float z = O.z + mod(zu - O.z, S.z);',
    '  int w = int(mod(floor(max(0.0, -z) / 1000.0), float(NW)) + 0.5);',
    '  float kind = uKind[w];',
    '  if (kind < -0.5) { ' + CULL + ' }',
    '  int k = int(kind + 0.5);',
    '  vec4 look = uKLook[k];',
    '  if (aSeed.w > look.w) { ' + CULL + ' }',
    '  float sx = aSeed.x * S.x, sy = aSeed.y * S.y, wx = uWind.x, xu, yu;',
    '  if (k == 4) { xu = sx + wx * (0.7 + 0.6 * r3) + sin(T * (0.6 + 0.5 * r1) + ph) * 0.45; yu = sy - (1.1 + 0.9 * r1) * T + cos(T * 0.9 + ph) * 0.15; }',
    '  else if (k == 2) { xu = sx + wx * (0.5 + 0.5 * r3) + sin(T * (0.7 + 0.6 * r1) + ph) * 0.9; yu = sy - (0.55 + 0.45 * r1) * T; }',
    '  else if (k == 3) { xu = sx + wx * 0.25 + sin(T * (0.4 + 0.4 * r1) + ph) * 0.5; yu = sy + (0.35 + 0.7 * r1) * T; }',
    '  else if (k == 1) { xu = sx + wx * (0.8 + 0.6 * r3) + sin(T * 0.5 + ph) * 0.3; yu = sy + (0.15 + 0.3 * r1) * T + sin(T * (0.8 + r3) + ph) * 0.4; }',
    '  else { xu = sx + wx * 0.35 * (0.5 + r3) + sin(T * (0.25 + 0.3 * r1) + ph) * 0.9; yu = sy + sin(T * (0.3 + 0.2 * r3) + ph * 1.7) * 0.7 + 0.12 * T; }',
    '  vec3 p = vec3(O.x + mod(xu - O.x, S.x), O.y + mod(yu - O.y, S.y), z);',
    '  vec3 q = (p - O) / S; vec3 e = min(q, 1.0 - q);',
    '  float a = look.x * uAlpha * smoothstep(0.0, 0.1, e.x) * smoothstep(0.0, 0.08, e.y) * smoothstep(0.0, 0.1, e.z);',
    '  float d = distance(p, uCam);',
    '  if (d < ' + NEAR_HIDE.toFixed(2) + ') { ' + CULL + ' }',
    '  a *= smoothstep(' + NEAR_HIDE.toFixed(2) + ', 7.5, d);',
    '  float kb = max(1.0, floor(-z / 1000.0 + 0.5));',
    '  a *= smoothstep(60.0, 70.0, abs(z + kb * 1000.0));', // nothing inside tunnels
    '  a *= smoothstep(-0.3, 0.4, p.y);',
    '  if (k == 1) a *= (1.0 - smoothstep(2.0, 7.0, p.y)) * (0.25 + 0.75 * smoothstep(-6.0, -20.0, p.x));',
    '  else if (k == 0) a *= 1.0 - smoothstep(12.0, 20.0, p.y);',
    '  else if (k == 3) a *= 1.0 - smoothstep(16.0, 24.0, p.y);',
    '  if (k == 0 || k == 3) a *= 0.62 + 0.38 * sin(T * (2.0 + 3.0 * r2) + ph * 5.0);',
    '  if (a < 0.004) { ' + CULL + ' }',
    '  vec3 col = uPal[k * 4 + int(r3 * 3.999)];',
    '  vec4 ks = uKSize[k];',
    '  float size = layer < 0.5 ? mix(ks.x, ks.y, r1) : mix(ks.z, ks.w, r1);',
    '  float rot = ph + T * (k == 2 ? (1.5 + 2.5 * r3) * (r1 > 0.5 ? 1.0 : -1.0) : 0.25);',
    '  float flip = 1.0;',
    '  if (k == 2) { float f = cos(T * (3.0 + 4.0 * r2) + ph * 3.0); col *= 0.62 + 0.38 * abs(f) + 0.3 * pow(abs(f), 16.0); flip = f < 0.0 ? min(f, -0.18) : max(f, 0.18); }',
    '  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);',
    '  float ndc = size * projectionMatrix[1][1] / max(clip.w, 0.05);',
    '  float ndcC = clamp(ndc, uMinNdc, uMaxNdc);',
    '  a *= min(1.0, (ndc * ndc) / (uMinNdc * uMinNdc));',
    '  vec2 c = position.xy * vec2(flip, 1.0);',
    '  float cs = cos(rot), sn = sin(rot);',
    '  clip.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * ndcC * clip.w * vec2(1.0 / uAspect, 1.0);',
    '  gl_Position = clip;',
    '  vCol = col * (1.0 + (uBoost - 1.0) * look.y * 0.5); vA = a; vAdd = look.y; vShape = look.z; vPx = ndcC * uHalfH * abs(flip);',
    '}'
  ].join('\n');

  const BURST_VERT = [
    'attribute vec3 aP0; attribute vec3 aVel; attribute vec4 aT; attribute vec4 aS; attribute vec4 aC; attribute vec4 aM;',
    'uniform float uTime, uClear, uAspect, uMaxNdc, uMaxNdcRing, uMinNdc, uHalfH, uBoost;',
    'uniform vec3 uCam, uCamVel;',
    'varying vec2 vUv; varying vec3 vCol; varying float vA; varying float vAdd; varying float vShape; varying float vPx; varying float vW;',
    'void main() {',
    '  vUv = position.xy; vCol = aC.rgb; vAdd = aC.a; vShape = aM.x; vPx = 1.0;',
    '  vW = (aM.x > 1.5 && aM.x < 2.5) || (aM.x > 5.5 && aM.x < 6.5) ? aS.z : 0.0;', // rings: rot0 carries the band width
    '  float age = uTime - aT.x;',
    '  if (age < 0.0 || age > aT.y || aT.x < uClear) { ' + CULL + ' }',
    '  float u = age / aT.y, drag = aT.z, grav = aT.w;',
    '  float kd = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;',
    '  vec3 p = aP0 + aVel * kd;',
    '  p.y -= 0.5 * grav * age * age;',
    '  p.z += aM.z * age;',
    '  p.y = max(p.y, aM.w);',
    '  float shape = aM.x;',
    '  float size = mix(aS.x, aS.y, aS.y < aS.x ? u * u : 1.0 - (1.0 - u) * (1.0 - u));', // shrink late, grow early
    '  float a = aM.y * min(1.0, age / 0.03);',
    '  if (shape > 3.5 && shape < 4.5) a *= smoothstep(0.0, 0.12, u) * (1.0 - u);', // puff
    '  else if (shape > 6.5) a *= (1.0 - u) * (1.0 - u);', // flare
    '  else if (shape > 1.5 && shape < 2.5 || shape > 5.5) a *= pow(1.0 - u, 1.5);', // rings
    '  else a *= 1.0 - u * u;',
    '  if (shape > 0.5 && shape < 1.5) a *= 0.7 + 0.3 * sin(age * 38.0 + aS.z * 9.0);', // star twinkle
    '  float d = distance(p, uCam);',
    '  if (d < ' + NEAR_HIDE_B.toFixed(2) + ') { ' + CULL + ' }',
    '  a *= smoothstep(' + NEAR_HIDE_B.toFixed(2) + ', 6.5, d);',
    '  vec4 clip;',
    '  vec2 corner = position.xy;',
    '  if (shape > 5.5 && shape < 6.5) {', // flat ring on the ground plane
    '    clip = projectionMatrix * viewMatrix * vec4(p + vec3(corner.x, 0.03, corner.y) * size, 1.0);',
    '    vPx = size * projectionMatrix[1][1] / max(clip.w, 0.05) * uHalfH;',
    '  } else {',
    '    clip = projectionMatrix * viewMatrix * vec4(p, 1.0);',
    '    float ndc = size * projectionMatrix[1][1] / max(clip.w, 0.05);',
    '    float ndcC = clamp(ndc, uMinNdc, shape > 1.5 && shape < 2.5 ? uMaxNdcRing : uMaxNdc);', // shockwave rings may grow large
    '    a *= min(1.0, (ndc * ndc) / (uMinNdc * uMinNdc));',
    '    vec2 off;',
    '    if (shape > 4.5 && shape < 5.5) {', // streak: stretched along its screen-space motion relative to the camera
    '      vec3 vcur = aVel * exp(-drag * age) - vec3(0.0, grav * age, 0.0) + vec3(0.0, 0.0, aM.z) - uCamVel;',
    '      vec4 c2 = projectionMatrix * viewMatrix * vec4(p - vcur * 0.035, 1.0);',
    '      vec2 dir = clip.xy / max(clip.w, 0.05) - c2.xy / max(c2.w, 0.05); dir.x *= uAspect;',
    '      float L = length(dir);',
    '      vec2 dn = L > 1e-5 ? dir / L : vec2(0.0, 1.0);',
    '      vec2 cc = vec2(corner.x, corner.y * (1.0 + min(L / max(ndcC, 1e-4), 7.0)));',
    '      off = vec2(cc.x * dn.y + cc.y * dn.x, -cc.x * dn.x + cc.y * dn.y);',
    '    } else {',
    '      float rot = aS.z + aS.w * age; float cs = cos(rot), sn = sin(rot);',
    '      off = vec2(corner.x * cs - corner.y * sn, corner.x * sn + corner.y * cs);',
    '    }',
    '    clip.xy += off * ndcC * clip.w * vec2(1.0 / uAspect, 1.0);',
    '    vPx = ndcC * uHalfH;',
    '  }',
    '  gl_Position = clip;',
    '  vCol = aC.rgb * (1.0 + (uBoost - 1.0) * aC.a);',
    '  vA = a;',
    '}'
  ].join('\n');

  const LINES_VERT = [
    'attribute vec4 aL; attribute vec4 aL2;',
    'uniform float uTravel, uInt, uAspect, uTanHalf;',
    'uniform vec3 uTintA, uTintB;',
    'varying float vA; varying vec2 vUv; varying vec3 vCol;',
    'void main() {',
    '  float span = 12.0;',
    '  float z = -3.5 - mod(aL.z * span + uTravel * aL.w, span);',
    '  float r = mix(3.3, 6.2, aL.y);',
    '  vec2 dir = vec2(cos(aL.x) * max(uAspect, 0.6), sin(aL.x));',
    '  float len = (1.6 + 3.2 * uInt) * aL2.x;',
    '  float t = position.y * 0.5 + 0.5;',
    '  vec3 p = vec3(dir * r, z - len * t);',
    '  vec2 perp = normalize(vec2(-dir.y, dir.x));',
    '  p.xy += perp * position.x * 0.02 * aL2.y * (1.0 - t * 0.7);',
    '  gl_Position = projectionMatrix * vec4(p, 1.0);',
    '  float nr = r / (max(-p.z, 0.1) * uTanHalf);', // radius on screen (1 = top edge): keep the centre clear
    '  vA = uInt * aL2.z * smoothstep(-15.5, -11.5, z) * smoothstep(-3.5, -6.0, z) * (1.0 - t) * smoothstep(0.55, 0.85, nr);',
    '  vUv = position.xy; vCol = mix(uTintA, uTintB, aL2.w);',
    '}'
  ].join('\n');
  const LINES_FRAG = [
    'varying float vA; varying vec2 vUv; varying vec3 vCol;',
    'void main() { float a = vA * (1.0 - vUv.x * vUv.x); if (a < 0.003) discard; gl_FragColor = vec4(vCol * a, 0.0); }'
  ].join('\n');

  // Grade: HDR in -> (bloom add) -> optional radial speed blur + chromatic aberration -> split tone, saturation ->
  // hue-preserving shoulder -> vignette -> dither. FXAA (define) samples neighbours on the tone-compressed luma.
  const QUAD_VERT = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const GRADE_FRAG = [
    'uniform sampler2D tDiffuse; uniform sampler2D tBloom;',
    'uniform vec2 uTexel; uniform float uAspect;',
    'uniform float uSat, uVig, uSpeedFx, uCA, uBloomOn, uFrame;',
    'uniform vec3 uShadowT, uHighT, uVigCol;',
    'varying vec2 vUv;',
    // NaN/Inf guard: a stray NaN (e.g. MSAA varying extrapolation in another module's shader) must never reach the
    // blur or the neighbour taps, where it would spread into a box.
    'vec3 san(vec3 c) { float m = c.r + c.g + c.b; return (m < 1.0e4 && m > -1.0e4) ? min(max(c, 0.0), vec3(16.0)) : vec3(0.0); }',
    'vec3 tex(vec2 uv) { vec3 c = san(texture2D(tDiffuse, uv).rgb);',
    '#if BLOOM',
    '  c += texture2D(tBloom, uv).rgb * uBloomOn;',
    '#endif',
    '  return c; }',
    'float lumT(vec3 c) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return l / (1.0 + l * 0.35); }',
    '#if FXAA',
    'vec3 fxaa(vec2 uv) {',
    '  vec3 cNW = tex(uv + vec2(-1.0, -1.0) * uTexel), cNE = tex(uv + vec2(1.0, -1.0) * uTexel);',
    '  vec3 cSW = tex(uv + vec2(-1.0, 1.0) * uTexel), cSE = tex(uv + vec2(1.0, 1.0) * uTexel), cM = tex(uv);',
    '  float lNW = lumT(cNW), lNE = lumT(cNE), lSW = lumT(cSW), lSE = lumT(cSE), lM = lumT(cM);',
    '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
    '  if (lMax - lMin < max(0.03, lMax * 0.12)) return cM;',
    '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));',
    '  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);',
    '  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);',
    '  dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;',
    '  vec3 cA = 0.5 * (tex(uv + dir * (1.0 / 3.0 - 0.5)) + tex(uv + dir * (2.0 / 3.0 - 0.5)));',
    '  vec3 cB = cA * 0.5 + 0.25 * (tex(uv - dir * 0.5) + tex(uv + dir * 0.5));',
    '  float lB = lumT(cB);',
    '  return (lB < lMin || lB > lMax) ? cA : cB;',
    '}',
    '#endif',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main() {',
    '  vec2 uv = vUv;',
    '  vec3 c;',
    '#if GRADE',
    '  if (uSpeedFx > 0.002) {',
    '    vec2 d = uv - 0.5;',
    '    float r = length(d * vec2(uAspect, 1.0));',
    '    float m = smoothstep(0.2, 0.8, r) * uSpeedFx;',
    '    vec2 st = d * m * 0.018;',
    '    c = vec3(0.0);',
    '    for (int i = 0; i < 6; i++) { c += tex(uv - st * (float(i) / 5.0)); }',
    '    c /= 6.0;',
    '    vec2 ca = d * m * uCA;',
    '    c.r = mix(c.r, tex(uv + ca).r, 0.8);',
    '    c.b = mix(c.b, tex(uv - ca).b, 0.8);',
    '  } else {',
    '#endif',
    '#if FXAA',
    '    c = fxaa(uv);',
    '#else',
    '    c = tex(uv);',
    '#endif',
    '#if GRADE',
    '  }',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  float ln = l / (1.0 + l);',
    '  c += uShadowT * (1.0 - smoothstep(0.05, 0.42, ln)) + uHighT * smoothstep(0.28, 0.5, ln);',
    '  c = max(mix(vec3(l), c, uSat), 0.0);',
    '  float mx = max(max(c.r, c.g), c.b);',
    '  const float K = 0.84;',
    '  if (mx > K) {',
    '    float mm = K + (1.0 - K) * (1.0 - exp(-(mx - K) / (1.0 - K)));',
    '    c *= mm / mx;',
    '    c = mix(c, vec3(mm), smoothstep(1.7, 4.5, mx) * 0.55);', // very hot cores bleed toward white
    '  }',
    '  vec2 vd = (vUv - 0.5) * vec2(uAspect, 1.0);',
    '  float v = smoothstep(0.3, 1.0, length(vd) / length(vec2(uAspect, 1.0) * 0.5));',
    '  c *= mix(vec3(1.0), uVigCol, v * uVig);',
    '#endif',
    '  c += (hash(gl_FragCoord.xy + uFrame) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');
  // Bloom bright-pass on the max channel (a saturated neon tube is as "bright" as a white one).
  const HIGHPASS_FRAG = [
    'uniform sampler2D tDiffuse; uniform float luminosityThreshold; uniform float smoothWidth;',
    'varying vec2 vUv;',
    'void main() { vec3 t = texture2D(tDiffuse, vUv).rgb; float s = t.r + t.g + t.b;',
    '  t = (s < 1.0e4 && s > -1.0e4) ? clamp(t, 0.0, 8.0) : vec3(0.0);', // NaN/Inf/outlier guard (see grade)
    '  float m = max(max(t.r, t.g), t.b);',
    '  gl_FragColor = vec4(t * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, m), 1.0); }'
  ].join('\n');
  const HIGHPASS_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

  // ------------------------------------------------------------------ helpers
  const premulBlend = (m) => {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    return m;
  };
  function quadGeo() { // unit quad, corners at +-1
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }
  function hex3(h, out, k) { _c.set(h); out.push(_c.r * (k || 1), _c.g * (k || 1), _c.b * (k || 1)); return out; }
  function computeReducedMotion() {
    try {
      const s = RR.store && RR.store.data && RR.store.data.settings;
      const pref = s ? s.reducedMotion : 'auto';
      if (pref === 'on' || pref === true) return true;
      if (pref === 'off' || pref === false) return false;
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ ambient particles
  const amb = { mesh: null, mat: null, geo: null, U: null };
  function buildAmbient() {
    const g = quadGeo();
    const seed = new Float32Array(AMB_MAX * 4), seed2 = new Float32Array(AMB_MAX * 4);
    const rng = RR.makeRng(90210);
    for (let i = 0; i < AMB_MAX; i++) {
      seed[i * 4] = rng.next(); seed[i * 4 + 1] = rng.next(); seed[i * 4 + 2] = rng.next(); seed[i * 4 + 3] = rng.next();
      seed2[i * 4] = i % 20 < 12 ? 0 : 1; // 60 % near layer, interleaved so a lower tier keeps both layers
      seed2[i * 4 + 1] = rng.next(); seed2[i * 4 + 2] = rng.next(); seed2[i * 4 + 3] = rng.next();
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.setAttribute('aSeed2', new THREE.InstancedBufferAttribute(seed2, 4));
    g.instanceCount = AMB_MAX;
    const pal = [], ksize = [], klook = [];
    AMB_KIND.forEach((k) => {
      k.pal.forEach((h) => { _c.set(h); pal.push(new THREE.Vector3(_c.r, _c.g, _c.b)); });
      ksize.push(new THREE.Vector4(k.size[0], k.size[1], k.size[2], k.size[3]));
      klook.push(new THREE.Vector4(k.look[0], k.look[1], k.look[2], k.look[3]));
    });
    const kinds = [];
    for (let i = 0; i < NW; i++) {
      const w = RR.WORLDS[i], fxw = worldFx(i);
      const name = AMB_ALIAS[fxw.amb] || AMB_ALIAS[w.particles];
      kinds.push(name ? AMB[name] : -1);
    }
    const U = {
      uTime: { value: 0 }, uAspect: { value: 1.6 }, uMaxNdc: { value: 0.035 }, uMinNdc: { value: 0.004 }, uHalfH: { value: 270 },
      uAlpha: { value: 1 }, uBoost: { value: 1 }, uCam: { value: new THREE.Vector3() }, uWind: { value: wind },
      uBoxO: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uBoxS: { value: [new THREE.Vector3().fromArray(BOX_NEAR), new THREE.Vector3().fromArray(BOX_FAR)] },
      uKind: { value: kinds }, uPal: { value: pal }, uKSize: { value: ksize }, uKLook: { value: klook }
    };
    const mat = premulBlend(new THREE.ShaderMaterial({ uniforms: U, vertexShader: AMB_VERT, fragmentShader: SHARED_FRAG, transparent: true, depthWrite: false, depthTest: true, fog: false }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20; // after sky, horizon strips, clouds, contrails (all < 0) and ordinary transparents
    mesh.name = 'fx-ambient';
    scene.add(mesh);
    amb.mesh = mesh; amb.mat = mat; amb.geo = g; amb.U = U; amb.kinds = kinds;
    amb.seed = seed; amb.seed2 = seed2;
  }
  const _fwd = new THREE.Vector3();
  function updateAmbientBoxes(cam) {
    const U = amb.U;
    cam.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1); else _fwd.normalize();
    camFwd.copy(_fwd);
    const p = cam.position;
    U.uCam.value.copy(p);
    // near layer: 6 m behind to 40 m ahead of the camera; far layer: 12 m behind to 188 m ahead
    const on = U.uBoxO.value[0], of = U.uBoxO.value[1];
    const dn = BOX_NEAR[2] * 0.5 - 6, df = BOX_FAR[2] * 0.5 - 12;
    on.set(p.x + _fwd.x * dn - BOX_NEAR[0] * 0.5, p.y - 7, p.z + _fwd.z * dn - BOX_NEAR[2] * 0.5);
    of.set(p.x + _fwd.x * df - BOX_FAR[0] * 0.5, Math.max(-2, p.y - 14), p.z + _fwd.z * df - BOX_FAR[2] * 0.5);
  }

  // ------------------------------------------------------------------ bursts (ring buffer, one draw call)
  const bur = { mesh: null, U: null, head: 0, used: 0, lastDeath: -1, lo: 1e9, hi: -1, attrs: null, list: null };
  const E = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, drag: 0, grav: 0, s0: 0.1, s1: 0.1, rot: 0, spin: 0, r: 1, g: 1, b: 1, add: 0, shape: 0, alpha: 1, carry: 0, floor: -1000 };
  function buildBursts() {
    const g = quadGeo();
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(BURST_CAP * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const A = { p0: mk(3), vel: mk(3), t: mk(4), s: mk(4), c: mk(4), m: mk(4) };
    for (let i = 0; i < BURST_CAP; i++) { A.t.array[i * 4] = -1e6; A.t.array[i * 4 + 1] = 0; }
    g.setAttribute('aP0', A.p0); g.setAttribute('aVel', A.vel); g.setAttribute('aT', A.t); g.setAttribute('aS', A.s); g.setAttribute('aC', A.c); g.setAttribute('aM', A.m);
    g.instanceCount = 0;
    const U = {
      uTime: { value: 0 }, uClear: { value: -1e5 }, uAspect: { value: 1.6 }, uMaxNdc: { value: 0.24 }, uMaxNdcRing: { value: 1.1 }, uMinNdc: { value: 0.004 }, uHalfH: { value: 270 },
      uBoost: { value: 1 }, uCam: { value: new THREE.Vector3() }, uCamVel: { value: camVel }
    };
    const mat = premulBlend(new THREE.ShaderMaterial({ uniforms: U, vertexShader: BURST_VERT, fragmentShader: SHARED_FRAG, transparent: true, depthWrite: false, depthTest: true, fog: false }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    mesh.visible = false;
    mesh.name = 'fx-bursts';
    scene.add(mesh);
    bur.mesh = mesh; bur.U = U; bur.attrs = A; bur.geo = g; bur.list = [A.p0, A.vel, A.t, A.s, A.c, A.m];
  }
  function push() {
    const i = bur.head;
    bur.head = (bur.head + 1) % BURST_CAP;
    const A = bur.attrs, i3 = i * 3, i4 = i * 4;
    A.p0.array[i3] = E.x; A.p0.array[i3 + 1] = E.y; A.p0.array[i3 + 2] = E.z;
    A.vel.array[i3] = E.vx; A.vel.array[i3 + 1] = E.vy; A.vel.array[i3 + 2] = E.vz;
    A.t.array[i4] = T; A.t.array[i4 + 1] = E.life; A.t.array[i4 + 2] = E.drag; A.t.array[i4 + 3] = E.grav;
    A.s.array[i4] = E.s0; A.s.array[i4 + 1] = E.s1; A.s.array[i4 + 2] = E.rot; A.s.array[i4 + 3] = E.spin;
    A.c.array[i4] = E.r; A.c.array[i4 + 1] = E.g; A.c.array[i4 + 2] = E.b; A.c.array[i4 + 3] = E.add;
    A.m.array[i4] = E.shape; A.m.array[i4 + 1] = E.alpha; A.m.array[i4 + 2] = E.carry; A.m.array[i4 + 3] = E.floor;
    if (i < bur.lo) bur.lo = i;
    if (i > bur.hi) bur.hi = i;
    if (i + 1 > bur.used) bur.used = i + 1;
    if (T + E.life > bur.lastDeath) bur.lastDeath = T + E.life;
  }
  function flushBursts() {
    if (bur.hi < 0) return;
    const L = bur.list, lo = bur.lo, n = bur.hi - lo + 1;
    for (let k = 0; k < L.length; k++) {
      const at = L[k];
      at.updateRange.offset = lo * at.itemSize; at.updateRange.count = n * at.itemSize;
      at.needsUpdate = true;
    }
    bur.lo = 1e9; bur.hi = -1;
    bur.geo.instanceCount = bur.used;
  }
  // emitter helpers (write into E; no allocation)
  const rnd = Math.random;
  const rr = (a, b) => a + rnd() * (b - a);
  function base(x, y, z, life, shape) {
    E.x = x; E.y = y; E.z = z; E.vx = E.vy = E.vz = 0; E.life = life; E.drag = 0; E.grav = 0; E.s0 = 0.1; E.s1 = 0.1;
    E.rot = rnd() * TAU; E.spin = 0; E.r = E.g = E.b = 1; E.add = 0; E.shape = shape; E.alpha = 1; E.carry = 0; E.floor = -1000;
  }
  function dirRand(sMin, sMax, upBias) { // random direction on a sphere, optionally biased up
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u), sp = rr(sMin, sMax);
    E.vx = s * Math.cos(th) * sp; E.vy = (u * (1 - upBias) + upBias * Math.abs(u) + upBias * 0.5) * sp; E.vz = s * Math.sin(th) * sp;
  }
  function col(arr, k) { const j = (rnd() * (arr.length / 3)) | 0; E.r = arr[j * 3] * (k || 1); E.g = arr[j * 3 + 1] * (k || 1); E.b = arr[j * 3 + 2] * (k || 1); }
  const nq = (n) => Math.max(1, Math.round(n * particleQ));
  // palettes (flat rgb arrays, built once)
  const PAL = {
    gold: [1, 0.86, 0.32, 1, 0.95, 0.62, 1, 0.78, 0.2, 1, 1, 0.9],
    rainbow: [1, 0.35, 0.45, 1, 0.62, 0.25, 1, 0.9, 0.3, 0.4, 1, 0.5, 0.3, 0.8, 1, 0.65, 0.45, 1, 1, 0.45, 0.85],
    white: [1, 1, 1, 0.95, 0.97, 1],
    fire: [1, 0.72, 0.25, 1, 0.5, 0.15, 1, 0.9, 0.5],
    smoke: [0.86, 0.86, 0.9, 0.78, 0.78, 0.84, 0.92, 0.9, 0.92],
    board: [0.35, 0.95, 1, 1, 0.4, 0.85, 1, 0.9, 0.35, 1, 1, 1],
    lime: [0.55, 1, 0.4, 0.85, 1, 0.45, 0.4, 1, 0.75],
    spark: [1, 0.95, 0.7, 1, 0.8, 0.4, 1, 1, 1],
    sprinkles: [1, 0.37, 0.64, 0.37, 0.88, 0.78, 1, 0.85, 0.3, 0.66, 0.48, 1, 1, 1, 1, 0.5, 0.84, 1],
    neon: [0.37, 0.95, 1, 1, 0.31, 0.85, 1, 0.88, 0.3],
    confetti: [1, 0.37, 0.64, 0.37, 0.88, 0.78, 1, 0.85, 0.3, 0.66, 0.48, 1, 1, 0.54, 0.36, 0.5, 0.84, 1],
    debrisN: [0.9, 0.9, 0.95, 0.55, 0.56, 0.62, 0.35, 0.36, 0.42, 1, 0.76, 0.2]
  };
  const KIND_PAL = { magnet: [1, 0.3, 0.35, 0.55, 0.7, 1, 1, 1, 1], sneakers: [0.5, 1, 0.45, 0.9, 1, 0.5, 1, 1, 1], double: [1, 0.85, 0.3, 0.75, 0.5, 1, 1, 1, 1], jetpack: [1, 0.6, 0.2, 1, 0.9, 0.4, 1, 1, 1], board: [0.35, 0.95, 1, 1, 0.4, 0.85, 1, 1, 1] };

  function sparkles(x, y, z, n, pal, sMin, sMax, spd, carry, life) {
    for (let i = 0; i < n; i++) {
      base(x, y, z, life * rr(0.7, 1.2), 1);
      dirRand(spd * 0.4, spd, 0.3);
      E.drag = 3.2; E.grav = 1.5; E.s0 = rr(sMin, sMax); E.s1 = 0; E.add = 1; E.carry = carry; E.spin = rr(-3, 3);
      col(pal); push();
    }
  }
  function flare(x, y, z, size, life, r, g, b, carry, alpha) {
    base(x, y, z, life, 7); E.s0 = size * 0.6; E.s1 = size; E.r = r; E.g = g; E.b = b; E.add = 1; E.carry = carry; E.alpha = alpha || 1; push();
  }
  function puffs(x, y, z, n, rgb, alt, spd, sMin, sMax, life, carry, alpha, up) {
    for (let i = 0; i < n; i++) {
      base(x + rr(-0.25, 0.25), y + rr(0, 0.15), z + rr(-0.25, 0.25), life * rr(0.75, 1.25), 4);
      const th = rnd() * TAU, sp = rr(spd * 0.4, spd);
      E.vx = Math.cos(th) * sp; E.vz = Math.sin(th) * sp * 0.7 + rr(0.5, 1.5); E.vy = rr(0.3, 1.0) * (up || 1);
      E.drag = 2.6; E.grav = -0.25; E.s0 = sMin; E.s1 = rr(sMin * 1.5, sMax); E.carry = carry; E.alpha = alpha;
      const t = rnd(); E.r = rgb[0] + (alt[0] - rgb[0]) * t; E.g = rgb[1] + (alt[1] - rgb[1]) * t; E.b = rgb[2] + (alt[2] - rgb[2]) * t;
      push();
    }
  }
  function chips(x, y, z, n, pal, spd, size, life, carry, floor, grav) {
    for (let i = 0; i < n; i++) {
      base(x, y, z, life * rr(0.7, 1.2), 3);
      dirRand(spd * 0.4, spd, 0.55);
      E.drag = 0.8; E.grav = grav || 14; E.s0 = size * rr(0.7, 1.3); E.s1 = E.s0 * 0.6; E.spin = rr(-14, 14); E.carry = carry; E.floor = floor;
      col(pal); push();
    }
  }
  function streaks(x, y, z, n, pal, spd, size, life, carry, grav, add) {
    for (let i = 0; i < n; i++) {
      base(x, y, z, life * rr(0.7, 1.2), 5);
      dirRand(spd * 0.5, spd, 0.45);
      E.drag = 2.0; E.grav = grav; E.s0 = size; E.s1 = size * 0.3; E.carry = carry; E.add = add === undefined ? 1 : add;
      col(pal); push();
    }
  }
  function ring(x, y, z, s0, s1, life, r, g, b, carry, flat, alpha, width) {
    base(x, y, z, life, flat ? 6 : 2); E.s0 = s0; E.s1 = s1; E.r = r; E.g = g; E.b = b; E.add = 1; E.carry = carry; E.alpha = alpha || 1; E.rot = width || 0.26; push();
  }
  function rainbowRing(x, y, z, s0, s1, life, carry, alpha) { // 7 thin concentric bands
    for (let i = 0; i < 7; i++) { // red outermost; bands ~0.045 apart in ring space so they stay distinct
      const k = 1 + 0.06 * (6 - i), j = i * 3;
      ring(x, y, z, s0 * k, s1 * k, life, PAL.rainbow[j] * 0.95, PAL.rainbow[j + 1] * 0.95, PAL.rainbow[j + 2] * 0.95, carry, false, alpha, 0.03);
    }
  }

  // ------------------------------------------------------------------ debris cubes (instanced, CPU physics)
  const deb = { mesh: null, n: 0, pos: new Float32Array(DEBRIS_CAP * 3), vel: new Float32Array(DEBRIS_CAP * 3), rot: new Float32Array(DEBRIS_CAP * 3), av: new Float32Array(DEBRIS_CAP * 3), scl: new Float32Array(DEBRIS_CAP * 3), life: new Float32Array(DEBRIS_CAP), age: new Float32Array(DEBRIS_CAP), floor: new Float32Array(DEBRIS_CAP), col: new Float32Array(DEBRIS_CAP * 3) };
  function buildDebris() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, DEBRIS_CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_CAP * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.name = 'fx-debris';
    scene.add(mesh);
    deb.mesh = mesh;
  }
  function addDebris(x, y, z, vx, vy, vz, sx, sy, sz, r, g, b, life, floor) {
    let i = deb.n;
    if (i >= DEBRIS_CAP) { // replace the oldest
      let best = 0; for (let j = 1; j < DEBRIS_CAP; j++) if (deb.age[j] - deb.life[j] > deb.age[best] - deb.life[best]) best = j;
      i = best;
    } else deb.n++;
    const i3 = i * 3;
    deb.pos[i3] = x; deb.pos[i3 + 1] = y; deb.pos[i3 + 2] = z;
    deb.vel[i3] = vx; deb.vel[i3 + 1] = vy; deb.vel[i3 + 2] = vz;
    deb.rot[i3] = rnd() * TAU; deb.rot[i3 + 1] = rnd() * TAU; deb.rot[i3 + 2] = rnd() * TAU;
    deb.av[i3] = rr(-12, 12); deb.av[i3 + 1] = rr(-12, 12); deb.av[i3 + 2] = rr(-12, 12);
    deb.scl[i3] = sx; deb.scl[i3 + 1] = sy; deb.scl[i3 + 2] = sz;
    deb.col[i3] = r; deb.col[i3 + 1] = g; deb.col[i3 + 2] = b;
    deb.life[i] = life; deb.age[i] = 0; deb.floor[i] = floor;
  }
  const _o = new THREE.Object3D();
  function updateDebris(dt) {
    if (!deb.n) { if (deb.mesh.visible) { deb.mesh.visible = false; deb.mesh.count = 0; } return; }
    let i = 0;
    while (i < deb.n) {
      deb.age[i] += dt;
      if (deb.age[i] >= deb.life[i]) { // swap-remove
        const last = deb.n - 1;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            deb.pos[i * 3 + k] = deb.pos[last * 3 + k]; deb.vel[i * 3 + k] = deb.vel[last * 3 + k]; deb.rot[i * 3 + k] = deb.rot[last * 3 + k];
            deb.av[i * 3 + k] = deb.av[last * 3 + k]; deb.scl[i * 3 + k] = deb.scl[last * 3 + k]; deb.col[i * 3 + k] = deb.col[last * 3 + k];
          }
          deb.life[i] = deb.life[last]; deb.age[i] = deb.age[last]; deb.floor[i] = deb.floor[last];
        }
        deb.n--;
        continue;
      }
      const i3 = i * 3;
      deb.vel[i3 + 1] -= 24 * dt;
      const dragK = Math.exp(-0.6 * dt);
      deb.vel[i3] *= dragK; deb.vel[i3 + 2] *= dragK;
      deb.pos[i3] += deb.vel[i3] * dt; deb.pos[i3 + 1] += deb.vel[i3 + 1] * dt; deb.pos[i3 + 2] += deb.vel[i3 + 2] * dt;
      const fl = deb.floor[i] + deb.scl[i3 + 1] * 0.5;
      if (deb.pos[i3 + 1] < fl) {
        deb.pos[i3 + 1] = fl;
        if (deb.vel[i3 + 1] < 0) deb.vel[i3 + 1] = -deb.vel[i3 + 1] * 0.32;
        deb.vel[i3] *= 0.6; deb.vel[i3 + 2] *= 0.6;
        deb.av[i3] *= 0.6; deb.av[i3 + 1] *= 0.6; deb.av[i3 + 2] *= 0.6;
      }
      deb.rot[i3] += deb.av[i3] * dt; deb.rot[i3 + 1] += deb.av[i3 + 1] * dt; deb.rot[i3 + 2] += deb.av[i3 + 2] * dt;
      const left = deb.life[i] - deb.age[i], sk = left < 0.35 ? Math.max(0.001, left / 0.35) : 1;
      _o.position.set(deb.pos[i3], deb.pos[i3 + 1], deb.pos[i3 + 2]);
      _o.rotation.set(deb.rot[i3], deb.rot[i3 + 1], deb.rot[i3 + 2]);
      _o.scale.set(deb.scl[i3] * sk, deb.scl[i3 + 1] * sk, deb.scl[i3 + 2] * sk);
      _o.updateMatrix();
      deb.mesh.setMatrixAt(i, _o.matrix);
      _c2.setRGB(deb.col[i3], deb.col[i3 + 1], deb.col[i3 + 2]);
      deb.mesh.setColorAt(i, _c2);
      i++;
    }
    deb.mesh.count = deb.n;
    deb.mesh.visible = deb.n > 0;
    deb.mesh.instanceMatrix.needsUpdate = true;
    deb.mesh.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ speed lines (view space, one draw call)
  const lines = { mesh: null, U: null, travel: 0, int: 0, geo: null };
  function buildLines() {
    const g = quadGeo();
    const a = new Float32Array(LINES_MAX * 4), b = new Float32Array(LINES_MAX * 4);
    const rng = RR.makeRng(4242);
    for (let i = 0; i < LINES_MAX; i++) {
      a[i * 4] = (i / LINES_MAX) * TAU + rng.range(-0.05, 0.05); // evenly around the screen edge
      a[i * 4 + 1] = rng.next(); a[i * 4 + 2] = rng.next(); a[i * 4 + 3] = rng.range(0.7, 1.25);
      b[i * 4] = rng.range(0.6, 1.4); b[i * 4 + 1] = rng.range(0.6, 1.5); b[i * 4 + 2] = rng.range(0.35, 1.0); b[i * 4 + 3] = rng.next() < 0.35 ? 1 : 0;
    }
    // shuffle so a lower instance count still spreads around the edge
    for (let i = LINES_MAX - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); for (let k = 0; k < 4; k++) { let t = a[i * 4 + k]; a[i * 4 + k] = a[j * 4 + k]; a[j * 4 + k] = t; t = b[i * 4 + k]; b[i * 4 + k] = b[j * 4 + k]; b[j * 4 + k] = t; } }
    g.setAttribute('aL', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aL2', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = LINES_MAX;
    const U = { uTravel: { value: 0 }, uInt: { value: 0 }, uAspect: { value: 1.6 }, uTanHalf: { value: 0.577 }, uTintA: { value: new THREE.Vector3(1, 1, 1) }, uTintB: { value: new THREE.Vector3(1, 1, 1) } };
    const mat = premulBlend(new THREE.ShaderMaterial({ uniforms: U, vertexShader: LINES_VERT, fragmentShader: LINES_FRAG, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    mesh.visible = false;
    mesh.name = 'fx-speedlines';
    scene.add(mesh);
    lines.mesh = mesh; lines.U = U; lines.geo = g;
  }

  // ------------------------------------------------------------------ post-processing
  const post = {
    mode: 'plain', rt: null, bloom: null, hpMat: null, hpU: null, gradeMat: null, quad: null, qcam: null,
    half: false, ms: false, fxaa: false, bloomScale: 1, threshold: 1, w: 1, h: 1, pr: 1, black: null, frame: 0
  };
  const _oldClear = new THREE.Color(), _black = new THREE.Color(0, 0, 0);
  const DIR_X = new THREE.Vector2(1, 0), DIR_Y = new THREE.Vector2(0, 1);
  function disposePost() {
    if (post.rt) { post.rt.dispose(); post.rt = null; }
    if (post.bloom) { post.bloom.dispose(); post.bloom = null; }
    if (post.gradeMat) { post.gradeMat.dispose(); post.gradeMat = null; }
  }
  function rtStatusOk(rt) {
    let ok = false;
    try {
      renderer.setRenderTarget(rt);
      const gl = renderer.getContext();
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    } catch (e) { ok = false; }
    renderer.setRenderTarget(null);
    return ok;
  }
  function halfFloatRenderable() {
    const caps = renderer.capabilities, ex = renderer.extensions;
    if (caps.isWebGL2) return ex.has('EXT_color_buffer_float') || ex.has('EXT_color_buffer_half_float');
    return ex.has('OES_texture_half_float') && ex.has('EXT_color_buffer_half_float');
  }
  function makeSceneRT(W, H, half, ms) {
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false };
    if (half && !renderer.capabilities.isWebGL2 && !renderer.extensions.has('OES_texture_half_float_linear')) { opts.minFilter = opts.magFilter = THREE.NearestFilter; }
    let rt;
    if (ms) { rt = new THREE.WebGLMultisampleRenderTarget(W, H, opts); rt.samples = 4; } else rt = new THREE.WebGLRenderTarget(W, H, opts);
    rt.texture.generateMipmaps = false;
    rt.texture.name = 'fx-scene';
    return rt;
  }
  function buildPost(q) {
    disposePost();
    const attrs = renderer.getContextAttributes ? renderer.getContextAttributes() : null;
    const ctxAA = !!(attrs && attrs.antialias);
    const W = Math.max(1, Math.floor(post.w * post.pr)), H = Math.max(1, Math.floor(post.h * post.pr));
    if (q && q.post) {
      post.mode = 'post';
      let half = halfFloatRenderable();
      let ms = !!(renderer.capabilities.isWebGL2 && typeof THREE.WebGLMultisampleRenderTarget === 'function' && q.name === 'high');
      let rt = makeSceneRT(W, H, half, ms);
      if (!rtStatusOk(rt)) { rt.dispose(); ms = false; rt = makeSceneRT(W, H, half, false); if (!rtStatusOk(rt)) { rt.dispose(); half = false; rt = makeSceneRT(W, H, false, false); } }
      post.rt = rt; post.half = half; post.ms = ms; post.fxaa = !ms;
      post.threshold = half ? 1.0 : 0.92;
      post.bloomScale = q.name === 'high' ? 1 : 0.5;
      const bloomLibs = q.bloom !== false && THREE.UnrealBloomPass && THREE.Pass && THREE.FullScreenQuad && THREE.CopyShader && THREE.LuminosityHighPassShader;
      if (bloomLibs) {
        try {
          const bp = new THREE.UnrealBloomPass(new THREE.Vector2(Math.max(2, Math.round(W * post.bloomScale)), Math.max(2, Math.round(H * post.bloomScale))), 0.4, 0.5, post.threshold);
          if (half && renderer.capabilities.isWebGL2) { // HDR bloom mips: very bright sources spread wider without clipping
            bp.renderTargetBright.texture.type = THREE.HalfFloatType;
            bp.renderTargetsHorizontal.forEach((t) => (t.texture.type = THREE.HalfFloatType));
            bp.renderTargetsVertical.forEach((t) => (t.texture.type = THREE.HalfFloatType));
          }
          post.bloom = bp;
          if (!post.hpMat) {
            post.hpU = { tDiffuse: { value: null }, luminosityThreshold: { value: 1 }, smoothWidth: { value: 0.3 } };
            post.hpMat = new THREE.ShaderMaterial({ uniforms: post.hpU, vertexShader: HIGHPASS_VERT, fragmentShader: HIGHPASS_FRAG, depthTest: false, depthWrite: false });
          }
          post.hpU.smoothWidth.value = half ? 0.3 : 0.08;
        } catch (e) { post.bloom = null; }
      }
      post.gradeMat = makeGradeMat(true, post.fxaa, !!post.bloom);
    } else if (!ctxAA) {
      post.mode = 'fxaa'; // no MSAA on the canvas and no post chain: still anti-alias with one FXAA pass
      post.rt = makeSceneRT(W, H, false, false);
      post.half = false; post.ms = false; post.fxaa = true; post.bloom = null;
      post.gradeMat = makeGradeMat(false, true, false);
    } else {
      post.mode = 'plain'; post.half = false; post.ms = false; post.fxaa = false; post.bloom = null;
    }
    if (post.quad) post.quad.material = post.gradeMat || post.quad.material;
    applyGlowBoost();
    resizePost();
  }
  function makeGradeMat(grade, fxaa, bloom) {
    if (!post.black) { post.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat); post.black.needsUpdate = true; }
    const U = {
      tDiffuse: { value: null }, tBloom: { value: post.black }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) }, uAspect: { value: 1.6 },
      uSat: { value: 1 }, uVig: { value: BASE_VIG }, uSpeedFx: { value: 0 }, uCA: { value: 0.002 }, uBloomOn: { value: 0 }, uFrame: { value: 0 },
      uShadowT: { value: new THREE.Vector3() }, uHighT: { value: new THREE.Vector3() }, uVigCol: { value: new THREE.Vector3(0.2, 0.15, 0.3) }
    };
    return new THREE.ShaderMaterial({
      uniforms: U, vertexShader: QUAD_VERT, fragmentShader: GRADE_FRAG, depthTest: false, depthWrite: false,
      defines: { GRADE: grade ? 1 : 0, FXAA: fxaa ? 1 : 0, BLOOM: bloom ? 1 : 0 }
    });
  }
  function resizePost() {
    const W = Math.max(1, Math.floor(post.w * post.pr)), H = Math.max(1, Math.floor(post.h * post.pr));
    if (post.rt) post.rt.setSize(W, H);
    if (post.bloom) post.bloom.setSize(Math.max(2, Math.round(W * post.bloomScale)), Math.max(2, Math.round(H * post.bloomScale)));
    if (post.gradeMat) { post.gradeMat.uniforms.uTexel.value.set(1 / W, 1 / H); post.gradeMat.uniforms.uAspect.value = W / H; }
    const halfH = H * 0.5, asp = W / H;
    if (amb.U) { amb.U.uHalfH.value = halfH; amb.U.uAspect.value = asp; amb.U.uMinNdc.value = 0.75 / halfH; amb.U.uMaxNdc.value = 0.034; }
    if (bur.U) { bur.U.uHalfH.value = halfH; bur.U.uAspect.value = asp; bur.U.uMinNdc.value = 0.9 / halfH; bur.U.uMaxNdc.value = 0.24; }
    if (lines.U) lines.U.uAspect.value = asp;
  }
  function glowBoost() { return post.mode === 'post' && post.half ? C.GLOW_BOOST_POST : 1; }
  function applyGlowBoost() {
    const mats = RR.getMats ? RR.getMats() : RR.mats;
    const k = glowBoost();
    if (mats && mats.glow) mats.glow.color.setScalar(k);
    api.glowBoost = k;
    if (amb.U) amb.U.uBoost.value = k;
    if (bur.U) bur.U.uBoost.value = k;
  }
  function runBloom(tex, strength, radius) {
    const bp = post.bloom;
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.getClearColor(_oldClear);
    const oldA = renderer.getClearAlpha();
    renderer.setClearColor(_black, 0);
    post.hpU.tDiffuse.value = tex;
    post.hpU.luminosityThreshold.value = post.threshold;
    bp.fsQuad.material = post.hpMat;
    renderer.setRenderTarget(bp.renderTargetBright);
    bp.fsQuad.render(renderer);
    let input = bp.renderTargetBright;
    for (let i = 0; i < bp.nMips; i++) {
      const m = bp.separableBlurMaterials[i];
      bp.fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture; m.uniforms.direction.value = DIR_X;
      renderer.setRenderTarget(bp.renderTargetsHorizontal[i]); bp.fsQuad.render(renderer);
      m.uniforms.colorTexture.value = bp.renderTargetsHorizontal[i].texture; m.uniforms.direction.value = DIR_Y;
      renderer.setRenderTarget(bp.renderTargetsVertical[i]); bp.fsQuad.render(renderer);
      input = bp.renderTargetsVertical[i];
    }
    bp.fsQuad.material = bp.compositeMaterial;
    bp.compositeMaterial.uniforms.bloomStrength.value = strength;
    bp.compositeMaterial.uniforms.bloomRadius.value = radius;
    renderer.setRenderTarget(bp.renderTargetsHorizontal[0]);
    bp.fsQuad.render(renderer);
    renderer.setClearColor(_oldClear, oldA);
    renderer.autoClear = oldAuto;
    return bp.renderTargetsHorizontal[0].texture;
  }
  function render() {
    if (!renderer) return;
    if (post.mode === 'plain' || !post.rt || !post.gradeMat) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    renderer.setRenderTarget(post.rt);
    renderer.render(scene, camera);
    const U = post.gradeMat.uniforms;
    U.tDiffuse.value = post.rt.texture;
    if (post.mode === 'post') {
      let btex = null;
      const bs = G.bloom;
      if (post.bloom && bs > 0.004) {
        const radius = 0.45 + 0.15 * RR.clamp(((RR.atmo ? RR.atmo.bloom : 0.5) - 0.5) / 0.6, 0, 1);
        btex = runBloom(post.rt.texture, bs, radius);
      }
      U.tBloom.value = btex || post.black; U.uBloomOn.value = btex ? 1 : 0;
      U.uSat.value = G.sat * gWorldSat;
      U.uVig.value = G.vig;
      U.uSpeedFx.value = reduceMotion ? 0 : G.speedFx;
      U.uShadowT.value.set(gShadow.r, gShadow.g, gShadow.b);
      U.uHighT.value.set(gHigh.r, gHigh.g, gHigh.b);
      U.uVigCol.value.set(gVigCol.r, gVigCol.g, gVigCol.b);
    }
    post.frame = (post.frame + 1) % 64;
    U.uFrame.value = post.frame * 1.618;
    const oldAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    post.quad.material = post.gradeMat;
    renderer.render(post.quad, post.qcam);
    renderer.autoClear = oldAuto;
  }

  // ------------------------------------------------------------------ DOM overlays: flash + fallback vignette
  const dom = { flash: null, vig: null, satStrs: null, lastSatI: -1, lastVig: -1 };
  function buildDom() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('app') || document.body;
    const fixed = host === document.body;
    const mk = (id, css) => {
      let el = document.getElementById(id);
      if (!el) { el = document.createElement('div'); el.id = id; host.appendChild(el); }
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = (fixed ? 'position:fixed;' : 'position:absolute;') + 'left:0;top:0;right:0;bottom:0;pointer-events:none;' + css;
      return el;
    };
    dom.flash = mk('fx-flash', 'z-index:6;opacity:0;background:#fff;will-change:opacity;');
    dom.vig = mk('fx-vignette', 'z-index:5;opacity:0;background:radial-gradient(125% 95% at 50% 50%, rgba(0,0,0,0) 52%, rgba(24,12,48,0.62) 100%);');
    dom.satStrs = [];
    for (let i = 0; i <= 20; i++) dom.satStrs.push(i === 20 ? '' : 'saturate(' + (i / 20).toFixed(2) + ')');
  }
  function flash(cssColor, ms) {
    if (!dom.flash || reduceMotion) return;
    const el = dom.flash, dur = Math.max(60, ms || 150);
    el.style.background = cssColor || '#fff';
    if (el.animate) {
      try { el.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: dur * 1.6, easing: 'cubic-bezier(.15,.7,.3,1)' }); return; } catch (e) { /* fall through */ }
    }
    el.style.transition = 'none'; el.style.opacity = '0.85';
    void el.offsetWidth;
    el.style.transition = 'opacity ' + (dur * 1.6) + 'ms ease-out'; el.style.opacity = '0';
  }
  function updateDomGrade() {
    if (!dom.vig) return;
    const postGrade = post.mode === 'post';
    const vq = postGrade ? 0 : Math.round(RR.clamp(G.vig / 0.35, 0, 1.8) * 0.55 * 50); // opacity in 1/50 steps
    if (vq !== dom.lastVig) { dom.lastVig = vq; dom.vig.style.opacity = String(vq / 50); } // string only on change
    // death desaturation without the grade pass: CSS filter on the canvas (only while it differs from 1)
    const satI = postGrade ? 20 : Math.round(RR.clamp(G.sat, 0, 1) * 20);
    if (satI !== dom.lastSatI && renderer && renderer.domElement) {
      dom.lastSatI = satI;
      renderer.domElement.style.filter = dom.satStrs[satI];
    }
  }

  // ------------------------------------------------------------------ burst recipes
  function dustRgb(z, alt) { const w = worldFx(RR.worldIndexAt(z)); return alt ? w.dustAlt : w.dust; }
  function burst(kind, x, y, z) {
    if (!ready) return;
    const fwdCarry = -lastSpeed; // bursts at the runner travel with them for a moment
    const wfx = worldFx(RR.worldIndexAt(z));
    switch (kind) {
      case 'coin': {
        burstCoinFrame = frameNo;
        flare(x, y, z, 0.7, 0.2, 1, 0.84, 0.35, fwdCarry * 0.92, 0.85);
        ring(x, y, z, 0.15, 0.95, 0.24, 1, 0.85, 0.35, fwdCarry * 0.92, false, 0.7, 0.12);
        sparkles(x, y, z, nq(8), PAL.gold, 0.14, 0.26, 4.6, fwdCarry * 0.92, 0.45);
        break;
      }
      case 'pickup': {
        burstPickupFrame = frameNo;
        flare(x, y, z, 1.4, 0.3, 1, 0.95, 0.85, fwdCarry * 0.9, 0.9);
        rainbowRing(x, y, z, 0.3, 2.6, 0.42, fwdCarry * 0.92, 0.85);
        ring(x, Math.max(0.16, y - 1), z, 0.4, 3.4, 0.5, 1, 0.95, 0.85, fwdCarry * 0.85, true, 0.55, 0.1);
        sparkles(x, y, z, nq(16), PAL.rainbow, 0.12, 0.24, 6.5, fwdCarry * 0.9, 0.6);
        break;
      }
      case 'crash': {
        flare(x, y, z, 2.8, 0.22, 1, 1, 0.95, 0, 1);
        ring(x, y, z, 0.4, 3.6, 0.35, 1, 0.9, 0.7, 0, false, 0.8);
        const floor = Math.max(0, y - 1.1);
        const acc = RR.WORLDS[RR.worldIndexAt(z)].accents || [0xffffff];
        const nd = Math.max(6, Math.round(16 * Math.max(0.5, particleQ)));
        for (let i = 0; i < nd; i++) {
          const s = rr(0.1, 0.24), c = i % 3 === 0 ? 0xffffff : acc[i % acc.length];
          _c.set(c);
          const th = rnd() * TAU, sp = rr(3, 8);
          addDebris(x + rr(-0.3, 0.3), y + rr(-0.3, 0.3), z + rr(-0.2, 0.2), Math.cos(th) * sp, rr(3, 9), Math.sin(th) * sp * 0.6 + rr(1, 4), s, s * rr(0.7, 1.1), s, _c.r, _c.g, _c.b, rr(1.1, 1.7), floor);
        }
        streaks(x, y, z, nq(12), PAL.spark, 9, 0.08, 0.45, 0, 9, 1);
        puffs(x, y - 0.6, z, nq(10), wfx.dust, wfx.dustAlt, 3.5, 0.3, 1.3, 0.9, 0, 0.55, 1.2);
        break;
      }
      case 'dust': {
        dustBurst(x, y, z, wfx, 0.6, fwdCarry * 0.7);
        break;
      }
      case 'land': {
        dustBurst(x, y, z, wfx, 1.4, fwdCarry * 0.8);
        ring(x, Math.max(y, 0.16) + 0.02, z, 0.35, 2.3, 0.45, wfx.dustAlt[0], wfx.dustAlt[1], wfx.dustAlt[2], fwdCarry * 0.85, true, 0.75, 0.22);
        break;
      }
      case 'board-break': {
        flare(x, y, z, 1.6, 0.2, 0.8, 1, 1, fwdCarry * 0.8, 0.9);
        ring(x, y, z, 0.3, 2.6, 0.35, 0.5, 0.95, 1, fwdCarry * 0.8, false, 0.8);
        const floor = Math.max(0, y - 0.45);
        const n = Math.max(6, Math.round(14 * Math.max(0.5, particleQ)));
        for (let i = 0; i < n; i++) {
          const j = i % 4, p = PAL.board;
          const th = rnd() * TAU, sp = rr(3, 7);
          addDebris(x + rr(-0.4, 0.4), y, z + rr(-0.5, 0.5), Math.cos(th) * sp, rr(4, 8), Math.sin(th) * sp * 0.5 + fwdCarry * 0.55, rr(0.18, 0.34), 0.035, rr(0.1, 0.22), p[j * 3], p[j * 3 + 1], p[j * 3 + 2], rr(0.9, 1.4), floor);
        }
        sparkles(x, y, z, nq(12), PAL.board, 0.1, 0.2, 6, fwdCarry * 0.8, 0.5);
        break;
      }
      case 'portal': {
        const n = nq(36);
        for (let i = 0; i < n; i++) {
          const th = (i / n) * TAU + rr(-0.1, 0.1), rad = rr(3.5, 6.5);
          base(x + Math.cos(th) * rad, y + 2 + Math.sin(th) * rad * 0.8, z, rr(0.7, 1.2), 1);
          E.vx = Math.cos(th) * rr(2, 5); E.vy = Math.sin(th) * rr(2, 5); E.vz = rr(-2, 2);
          E.drag = 1.5; E.grav = 0.8; E.s0 = rr(0.18, 0.36); E.s1 = 0; E.add = 1; E.carry = fwdCarry * 0.85; E.spin = rr(-2, 2);
          const j = i % 7; E.r = PAL.rainbow[j * 3]; E.g = PAL.rainbow[j * 3 + 1]; E.b = PAL.rainbow[j * 3 + 2];
          push();
        }
        rainbowRing(x, y + 2, z, 1.5, 9.5, 0.8, fwdCarry * 0.85, 0.75);
        break;
      }
      case 'sparkle': {
        flare(x, y, z, 1.0, 0.24, 1, 1, 0.9, fwdCarry * 0.92, 0.7);
        sparkles(x, y, z, nq(16), PAL.rainbow, 0.13, 0.26, 5, fwdCarry * 0.92, 0.6);
        break;
      }
      case 'poof': {
        if (poofsThisFrame > 14) return;
        poofsThisFrame++;
        puffs(x, y + 0.4, z, nq(7), [1, 1, 1], wfx.dustAlt, 2.8, 0.4, 1.4, 0.7, 0, 0.7, 1.5);
        sparkles(x, y + 0.8, z, nq(4), PAL.white, 0.12, 0.2, 3, 0, 0.4);
        break;
      }
      default: {
        sparkles(x, y, z, nq(8), PAL.white, 0.1, 0.2, 3.5, fwdCarry * 0.9, 0.45);
      }
    }
  }
  function dustBurst(x, y, z, wfx, k, carry) {
    y = Math.max(y, 0.16); // the ballast/sleepers sit a little above y = 0
    const n = nq(Math.round(6 * k));
    puffs(x, y + 0.05, z, n, wfx.dust, wfx.dustAlt, 2.4 * k, 0.3, 0.62 + 0.3 * k, 0.65, carry, wfx.dustKind === 'powder' ? 0.7 : 0.6, 0.8);
    if (wfx.dustKind === 'sprinkles') chips(x, y + 0.1, z, nq(Math.round(5 * k)), PAL.sprinkles, 3.5, 0.045, 0.6, carry, y, 16);
    else if (wfx.dustKind === 'sparks') streaks(x, y + 0.1, z, nq(Math.round(6 * k)), PAL.neon, 5, 0.05, 0.35, carry, 10, 1);
    else if (wfx.dustKind === 'powder') puffs(x, y + 0.05, z, nq(Math.round(3 * k)), [1, 1, 1], [0.9, 0.95, 1], 3 * k, 0.1, 0.3, 0.45, carry, 0.5, 1.6);
    else if (wfx.dustKind === 'sand') chips(x, y + 0.08, z, nq(Math.round(3 * k)), [0.95, 0.82, 0.58, 0.85, 0.7, 0.48], 3, 0.03, 0.5, carry, y, 14);
  }

  // ------------------------------------------------------------------ trails & footsteps (read frame.player)
  const trail = { sneak: 0, board: 0, jet: 0, step: 0, stepSide: 1 };
  function updateTrails(dt, frame) {
    const P = frame.player;
    if (!P || frame.state !== 'run') return;
    const x = frame.px, y = frame.py, z = frame.pz, sp = frame.speed || 0, carry = -sp;
    const k = particleQ;
    if (P.jetpack) { // player.js draws the flames and smoke; fx adds ember sparks and hot glints
      trail.jet += dt * 36 * k;
      while (trail.jet >= 1) {
        trail.jet -= 1;
        const side = rnd() < 0.5 ? -1 : 1;
        base(x + side * 0.2, y + 0.5, z + 0.3, rr(0.2, 0.36), 5);
        E.vx = rr(-1.2, 1.2); E.vy = rr(-9, -6); E.vz = rr(0.5, 2.5); E.drag = 1.5; E.grav = 4; E.s0 = 0.08; E.s1 = 0.025; E.add = 1; E.carry = carry * 0.9;
        col(PAL.fire, 1.3); push();
        if (rnd() < 0.25) { base(x + side * 0.2, y + 0.35, z + 0.35, rr(0.3, 0.5), 1); E.vx = rr(-1, 1); E.vy = rr(-5, -3); E.vz = rr(1, 2); E.drag = 2; E.s0 = rr(0.1, 0.16); E.s1 = 0; E.add = 1; E.carry = carry * 0.9; col(PAL.fire, 1.2); push(); }
      }
    } else trail.jet = 0;
    if (P.board && !P.jetpack) {
      trail.board += dt * 30 * k;
      while (trail.board >= 1) {
        trail.board -= 1;
        base(x + rr(-0.22, 0.22), y + 0.22, z + 0.8, rr(0.28, 0.42), 5);
        E.vx = rr(-1.4, 1.4); E.vy = rr(0.6, 2.4); E.vz = rr(2, 4); E.drag = 1.2; E.grav = 9; E.s0 = 0.09; E.s1 = 0.03; E.add = 1; E.carry = carry * 0.85; E.floor = y + 0.16;
        col(PAL.board, 1.2); push();
        if (rnd() < 0.3) { base(x + rr(-0.2, 0.2), y + 0.3, z + 0.7, rr(0.3, 0.5), 1); E.vx = rr(-0.5, 0.5); E.vy = rr(0.3, 1); E.vz = rr(1.5, 3); E.drag = 2; E.s0 = rr(0.13, 0.2); E.s1 = 0; E.add = 1; E.carry = carry * 0.88; col(PAL.board, 1.1); push(); }
      }
    } else trail.board = 0;
    if (P.sneakers && !P.jetpack) {
      trail.sneak += dt * 24 * k;
      while (trail.sneak >= 1) {
        trail.sneak -= 1;
        const side = rnd() < 0.5 ? -1 : 1;
        base(x + side * 0.13, y + 0.24, z + 0.05, rr(0.35, 0.55), 1);
        E.vx = rr(-0.4, 0.4); E.vy = rr(0.4, 1.4); E.vz = rr(1, 2.2); E.drag = 2; E.s0 = rr(0.14, 0.22); E.s1 = 0; E.add = 1; E.carry = carry * 0.9; E.spin = rr(-3, 3);
        col(PAL.lime); push();
      }
    } else trail.sneak = 0;
    // footstep dust on the ground (not on roofs, boards or in the air)
    if (P.grounded && !P.board && !P.jetpack && y < 0.3 && sp > 1 && !frame.inTunnel) {
      trail.step += dt * (4.5 + sp * 0.08) * Math.max(0.5, k);
      while (trail.step >= 1) {
        trail.step -= 1;
        trail.stepSide = -trail.stepSide;
        const wfx = worldFx(RR.worldIndexAt(z));
        base(x + trail.stepSide * 0.14, 0.2, z + 0.2, rr(0.45, 0.65), 4);
        E.vx = trail.stepSide * rr(0.2, 0.7); E.vy = rr(0.3, 0.8); E.vz = rr(1, 2); E.drag = 2.5; E.grav = -0.2;
        E.s0 = 0.1; E.s1 = rr(0.32, 0.5); E.carry = carry * 0.55; E.alpha = wfx.dustKind === 'powder' ? 0.42 : 0.26;
        const t = rnd(); E.r = wfx.dust[0] + (wfx.dustAlt[0] - wfx.dust[0]) * t; E.g = wfx.dust[1] + (wfx.dustAlt[1] - wfx.dust[1]) * t; E.b = wfx.dust[2] + (wfx.dustAlt[2] - wfx.dust[2]) * t;
        push();
        if (wfx.dustKind === 'sparks' && rnd() < 0.8) { base(x + trail.stepSide * 0.14, 0.2, z + 0.1, 0.28, 5); E.vx = rr(-1.5, 1.5); E.vy = rr(1.5, 3); E.vz = rr(1, 3); E.drag = 1; E.grav = 12; E.s0 = 0.06; E.s1 = 0.02; E.add = 1; E.carry = carry * 0.6; E.floor = 0.16; col(PAL.neon, 1.2); push(); }
        else if (wfx.dustKind === 'sprinkles' && rnd() < 0.7) { base(x + trail.stepSide * 0.14, 0.22, z + 0.1, 0.45, 3); E.vx = rr(-1, 1); E.vy = rr(1.5, 3); E.vz = rr(1, 2); E.drag = 0.5; E.grav = 14; E.s0 = 0.05; E.s1 = 0.035; E.spin = rr(-12, 12); E.carry = carry * 0.6; E.floor = 0.17; col(PAL.sprinkles); push(); }
      }
    } else trail.step = 0;
  }

  // ------------------------------------------------------------------ events (extra juice; guarded against doubles)
  function onEvents() {
    RR.on('coin', () => {
      if (!ready || burstCoinFrame === frameNo || !lastP.ok) return;
      burst('coin', lastP.x, lastP.y + 1.1, lastP.z - 0.6);
    });
    RR.on('pickup', (d) => {
      if (!ready || !lastP.ok) return;
      const pal = KIND_PAL[d && d.kind] || PAL.rainbow;
      if (burstPickupFrame !== frameNo) burst('pickup', lastP.x, lastP.y + 1.1, lastP.z - 0.6);
      sparkles(lastP.x, lastP.y + 1.0, lastP.z - 0.3, nq(10), pal, 0.12, 0.22, 5, -lastSpeed * 0.9, 0.55);
    });
    RR.on('jump', () => { if (ready && lastP.ok && lastP.grounded) burst('dust', lastP.x, lastP.y, lastP.z + 0.1); });
    RR.on('roll', () => { if (ready && lastP.ok && lastP.y < 0.1) burst('dust', lastP.x, lastP.y, lastP.z + 0.2); });
    RR.on('stumble', () => {
      if (!ready || !lastP.ok) return;
      streaks(lastP.x, lastP.y + 1, lastP.z - 0.2, nq(8), PAL.spark, 6, 0.06, 0.3, -lastSpeed * 0.8, 8, 1);
      puffs(lastP.x, lastP.y + 0.2, lastP.z, nq(4), [1, 1, 1], [0.9, 0.9, 0.95], 2, 0.2, 0.6, 0.45, -lastSpeed * 0.6, 0.45);
    });
    RR.on('near-miss', () => {
      if (!ready || !lastP.ok) return;
      for (let i = 0; i < nq(8); i++) {
        base(lastP.x + rr(-1.2, 1.2), lastP.y + rr(0.4, 2.2), lastP.z + rr(-0.5, 0.5), rr(0.2, 0.35), 5);
        E.vx = 0; E.vy = 0; E.vz = rr(14, 22); E.drag = 3; E.s0 = 0.06; E.s1 = 0.02; E.add = 1; E.carry = -lastSpeed * 0.85; col(PAL.white); push();
      }
    });
    RR.on('jetpack-end', () => { if (ready && lastP.ok) burst('land', lastP.x, 0, lastP.z); });
    RR.on('revive', () => { if (ready && lastP.ok) { rainbowRing(lastP.x, lastP.y + 1, lastP.z, 0.4, 3.2, 0.7, 0, 0.8); sparkles(lastP.x, lastP.y + 1, lastP.z, nq(24), PAL.rainbow, 0.12, 0.26, 5, 0, 0.8); } });
    const celebrate = (big) => {
      if (!ready || !lastP.ok) return;
      const n = nq(big ? 40 : 22);
      for (let i = 0; i < n; i++) {
        base(lastP.x + rr(-3.5, 3.5), lastP.y + rr(3.5, 6), lastP.z - rr(2, 7), rr(1.2, 1.8), 3);
        E.vx = rr(-1, 1); E.vy = rr(-0.5, 1.5); E.vz = rr(-1, 1); E.drag = 1.8; E.grav = 3.2; E.s0 = rr(0.07, 0.11); E.s1 = E.s0 * 0.8; E.spin = rr(-9, 9);
        E.carry = -lastSpeed * 0.95; col(PAL.confetti); push();
      }
    };
    RR.on('mission-done', () => celebrate(false));
    RR.on('level-up', () => celebrate(true));
    RR.on('new-best', () => { celebrate(true); if (ready && lastP.ok) sparkles(lastP.x, lastP.y + 1.5, lastP.z - 1, nq(16), PAL.gold, 0.14, 0.26, 5, -lastSpeed * 0.9, 0.7); });
    RR.on('combo', (d) => { if (ready && lastP.ok && d && d.n && d.n % 10 === 0) burst('sparkle', lastP.x, lastP.y + 1.4, lastP.z - 0.8); });
    RR.on('run-start', () => { setGrade({ saturation: 1, vignette: BASE_VIG }); G.sat = 1; G.vig = BASE_VIG; });
    RR.on('ui:setting', () => { reduceMotion = computeReducedMotion(); });
  }

  // ------------------------------------------------------------------ grade helpers
  const L = (c) => c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  function gradeTargetsFor(world, dt, snap) {
    const w = worldFx(world);
    const k = snap ? 1 : 1 - Math.exp(-1.6 * dt);
    _c.set(w.shadow); const ls = L(_c); _c.setRGB((_c.r - ls) * w.split, (_c.g - ls) * w.split, (_c.b - ls) * w.split);
    gShadow.lerp(_c, k);
    _c.set(w.high); const lh = L(_c); _c.setRGB((_c.r - lh) * w.split * 0.8, (_c.g - lh) * w.split * 0.8, (_c.b - lh) * w.split * 0.8);
    gHigh.lerp(_c, k);
    _c.set(w.shadow); _c.lerp(_black, 0.35); _c2.setRGB(0.25, 0.2, 0.3); _c.lerp(_c2, 0.3);
    gVigCol.lerp(_c, k);
    gWorldSat += (w.sat - gWorldSat) * k;
    const bt = (RR.atmo ? RR.atmo.bloom : RR.WORLDS[world].bloom) * w.bloomK * (quality && quality.name === 'medium' ? 0.9 : 1);
    G.bloom = snap ? bt : G.bloom + (bt - G.bloom) * (1 - Math.exp(-2.5 * dt));
  }
  function setGrade(o) {
    if (!o) return;
    if (typeof o.saturation === 'number') G.satT = RR.clamp(o.saturation, 0, 2);
    if (typeof o.vignette === 'number') G.vigT = RR.clamp(o.vignette, 0, 1.2);
  }

  // ------------------------------------------------------------------ lifecycle
  function init(ctx) {
    renderer = ctx.renderer; scene = ctx.scene; camera = ctx.camera; quality = ctx.quality || RR.quality;
    if (RR.getMats) RR.getMats();
    post.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    post.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    post.quad.frustumCulled = false;
    try {
      const sz = new THREE.Vector2();
      renderer.getSize(sz);
      post.w = sz.x || 1; post.h = sz.y || 1; post.pr = renderer.getPixelRatio();
    } catch (e) { /* resize() will set it */ }
    buildAmbient();
    buildBursts();
    buildDebris();
    buildLines();
    buildDom();
    reduceMotion = computeReducedMotion();
    onEvents();
    ready = true;
    setQuality(quality);
  }
  function setQuality(q) {
    if (!q) return;
    quality = q;
    particleQ = q.particles !== undefined ? q.particles : 1;
    if (!ready) return;
    amb.geo.instanceCount = Math.max(64, Math.round(AMB_MAX * particleQ));
    lines.geo.instanceCount = Math.max(24, Math.round(LINES_MAX * (q.name === 'low' ? 0.5 : q.name === 'medium' ? 0.75 : 1)));
    buildPost(q);
  }
  function resize(w, h, pixelRatio) {
    post.w = Math.max(1, w | 0); post.h = Math.max(1, h | 0); post.pr = pixelRatio || (renderer ? renderer.getPixelRatio() : 1);
    if (ready) resizePost();
  }
  function reset(pz) {
    if (!ready) return;
    bur.U.uClear.value = T + 5e-4; // everything emitted so far is culled...
    T += 1e-3; // ...and anything emitted from now on is newer than the clear mark
    bur.head = 0; bur.used = 0; bur.lastDeath = -1; bur.geo.instanceCount = 0; bur.mesh.visible = false;
    deb.n = 0; deb.mesh.count = 0; deb.mesh.visible = false;
    trail.sneak = trail.board = trail.jet = trail.step = 0;
    G.sat = G.satT = 1; G.vig = G.vigT = BASE_VIG; G.speedFx = 0;
    lines.int = 0; lines.mesh.visible = false;
    const w = RR.worldIndexAt(pz || 0);
    G.world = w;
    gradeTargetsFor(w, 0, true);
    camPrevOk = false;
    lastP.ok = false;
    reduceMotion = computeReducedMotion();
    updateDomGrade();
  }
  function update(dt, frame) {
    if (!ready) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    T += dt;
    frameNo++;
    poofsThisFrame = 0;
    const cam = (frame && frame.camera) || camera;
    const st = frame ? frame.state : 'run';
    lastSpeed = frame && frame.speed ? frame.speed : 0;
    if (frame) { lastP.x = frame.px || 0; lastP.y = frame.py || 0; lastP.z = frame.pz || 0; lastP.grounded = !!(frame.player && frame.player.grounded); lastP.ok = true; lastP.state = st; }
    // camera velocity (streak orientation)
    if (camPrevOk && dt > 1e-4) {
      const k = 1 - Math.exp(-12 * dt);
      camVel.x += ((cam.position.x - camPrev.x) / dt - camVel.x) * k;
      camVel.y += ((cam.position.y - camPrev.y) / dt - camVel.y) * k;
      camVel.z += ((cam.position.z - camPrev.z) / dt - camVel.z) * k;
    } else camVel.set(0, 0, -lastSpeed);
    camPrev.copy(cam.position); camPrevOk = true;
    // wind: a slow breeze with occasional gusts (strong in Frost)
    const world = frame ? frame.world : RR.worldIndexAt(cam.position.z);
    const wid = RR.WORLDS[world] ? RR.WORLDS[world].id : '';
    const gust = Math.max(0, Math.sin(T * 0.21) * Math.sin(T * 0.53 + 1.3)) * (wid === 'frost' ? 5.5 : 1.6);
    const wTarget = (wid === 'coast' ? 1.4 : wid === 'frost' ? 0.9 : 0.45) + gust;
    windVx += (wTarget - windVx) * (1 - Math.exp(-1.5 * dt));
    wind.x += windVx * dt; wind.z += (0.15 + gust * 0.1) * dt;
    // ambient
    amb.U.uTime.value = T;
    updateAmbientBoxes(cam);
    const ambTarget = st === 'dying' || st === 'over' || st === 'revive' ? 0.8 : 1;
    amb.U.uAlpha.value += (ambTarget - amb.U.uAlpha.value) * (1 - Math.exp(-3 * dt));
    // bursts
    bur.U.uTime.value = T;
    bur.U.uCam.value.copy(cam.position);
    updateTrails(dt, frame || {});
    flushBursts();
    bur.mesh.visible = T < bur.lastDeath;
    updateDebris(dt);
    // speed lines: faster than ~30 m/s, strong on the jetpack
    const P = frame && frame.player;
    const jet = !!(P && P.jetpack) && st === 'run';
    const sp = st === 'run' ? lastSpeed : 0;
    const lt = reduceMotion ? 0 : RR.smoothstep(28, 48, sp) * 0.55 + (jet ? 0.75 : 0) + (P && P.board && st === 'run' ? 0.08 : 0);
    lines.int += (lt - lines.int) * (1 - Math.exp(-(lt > lines.int ? 4 : 2.5) * dt));
    lines.travel += (sp > 0 ? sp : 0) * dt * 0.9 + dt * 6 * lines.int;
    lines.U.uTravel.value = lines.travel;
    lines.U.uInt.value = Math.min(1, lines.int);
    lines.mesh.visible = lines.int > 0.01;
    if (lines.mesh.visible) {
      const w = worldFx(world);
      lines.U.uTintA.value.set(w.lineA[0], w.lineA[1], w.lineA[2]);
      lines.U.uTintB.value.set(w.lineB[0], w.lineB[1], w.lineB[2]);
      lines.U.uTanHalf.value = Math.tan(((cam.fov || 60) * Math.PI) / 360);
    }
    // grade: world tint, death desaturation, speed blur
    G.world = world;
    gradeTargetsFor(world, dt, false);
    const kg = 1 - Math.exp(-6 * dt);
    G.sat += (G.satT - G.sat) * kg;
    G.vig += (G.vigT - G.vig) * kg;
    const sfx = jet ? 0.55 : RR.smoothstep(44, 50, sp) * 0.2;
    G.speedFx += (sfx - G.speedFx) * (1 - Math.exp(-3 * dt));
    if (G.speedFx < 0.003) G.speedFx = 0;
    updateDomGrade();
  }

  // ------------------------------------------------------------------ debug (tests)
  // CPU mirror of the ambient vertex shader: returns the closest visible particle and its projected size.
  const _v = new THREE.Vector3();
  function debugAmbient() {
    if (!ready) return null;
    const U = amb.U, n = amb.geo.instanceCount, Tm = U.uTime.value, cam = U.uCam.value;
    const mod = (a, b) => a - b * Math.floor(a / b);
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    camera.updateMatrixWorld();
    const P11 = camera.projectionMatrix.elements[5];
    let visible = 0, minD = 1e9, maxPx = 0, minDAll = 1e9;
    for (let i = 0; i < n; i++) {
      const s = amb.seed, s2 = amb.seed2, i4 = i * 4;
      const layer = s2[i4], r1 = s2[i4 + 1], r2 = s2[i4 + 2], r3 = s2[i4 + 3], ph = r2 * TAU;
      const O = U.uBoxO.value[layer < 0.5 ? 0 : 1], S = U.uBoxS.value[layer < 0.5 ? 0 : 1];
      const zu = s[i4 + 2] * S.z + wind.z * (0.8 + 0.4 * r1) + Math.sin(Tm * 0.37 + ph) * 0.6;
      const z = O.z + mod(zu - O.z, S.z);
      const w = Math.round(mod(Math.floor(Math.max(0, -z) / 1000), NW));
      const kind = U.uKind.value[w];
      if (kind < -0.5) continue;
      const look = U.uKLook.value[kind];
      if (s[i4 + 3] > look.w) continue;
      const sx = s[i4] * S.x, sy = s[i4 + 1] * S.y, wx = wind.x;
      let xu, yu;
      if (kind === 4) { xu = sx + wx * (0.7 + 0.6 * r3) + Math.sin(Tm * (0.6 + 0.5 * r1) + ph) * 0.45; yu = sy - (1.1 + 0.9 * r1) * Tm + Math.cos(Tm * 0.9 + ph) * 0.15; }
      else if (kind === 2) { xu = sx + wx * (0.5 + 0.5 * r3) + Math.sin(Tm * (0.7 + 0.6 * r1) + ph) * 0.9; yu = sy - (0.55 + 0.45 * r1) * Tm; }
      else if (kind === 3) { xu = sx + wx * 0.25 + Math.sin(Tm * (0.4 + 0.4 * r1) + ph) * 0.5; yu = sy + (0.35 + 0.7 * r1) * Tm; }
      else if (kind === 1) { xu = sx + wx * (0.8 + 0.6 * r3) + Math.sin(Tm * 0.5 + ph) * 0.3; yu = sy + (0.15 + 0.3 * r1) * Tm + Math.sin(Tm * (0.8 + r3) + ph) * 0.4; }
      else { xu = sx + wx * 0.35 * (0.5 + r3) + Math.sin(Tm * (0.25 + 0.3 * r1) + ph) * 0.9; yu = sy + Math.sin(Tm * (0.3 + 0.2 * r3) + ph * 1.7) * 0.7 + 0.12 * Tm; }
      _v.set(O.x + mod(xu - O.x, S.x), O.y + mod(yu - O.y, S.y), z);
      const d = _v.distanceTo(cam);
      if (d < minDAll) minDAll = d;
      if (d < NEAR_HIDE) continue; // culled in the shader
      const kb = Math.max(1, Math.floor(-z / 1000 + 0.5));
      let a = look.x * smooth(NEAR_HIDE, 7.5, d) * smooth(60, 70, Math.abs(z + kb * 1000)) * smooth(-0.3, 0.4, _v.y);
      if (a < 0.004) continue;
      // in front of the camera?
      _v.applyMatrix4(camera.matrixWorldInverse);
      if (_v.z > -camera.near) continue;
      const size = layer < 0.5 ? U.uKSize.value[kind].x + (U.uKSize.value[kind].y - U.uKSize.value[kind].x) * r1 : U.uKSize.value[kind].z + (U.uKSize.value[kind].w - U.uKSize.value[kind].z) * r1;
      const ndc = Math.min(U.uMaxNdc.value, size * P11 / Math.max(-_v.z, 0.05));
      visible++;
      if (d < minD) minD = d;
      const px = ndc * U.uHalfH.value * 2;
      if (px > maxPx) maxPx = px;
    }
    return { count: n, visible, minDist: minD, minDistAny: minDAll, maxDiameterPx: maxPx, capPx: U.uMaxNdc.value * U.uHalfH.value * 2 };
  }
  function info() {
    return {
      mode: post.mode, halfFloat: post.half, msaa: post.ms, fxaa: post.fxaa, bloom: !!post.bloom, bloomStrength: +G.bloom.toFixed(3),
      glowBoost: glowBoost(), ambient: amb.geo ? amb.geo.instanceCount : 0, burstsAlive: bur.mesh && bur.mesh.visible ? bur.used : 0,
      debris: deb.n, speedLines: lines.mesh && lines.mesh.visible ? +lines.int.toFixed(2) : 0, speedFx: +G.speedFx.toFixed(2),
      saturation: +(G.sat * gWorldSat).toFixed(3), vignette: +G.vig.toFixed(3), reducedMotion: reduceMotion
    };
  }

  const api = {
    init, reset, update, setQuality, resize, render, burst, flash, setGrade,
    glowBoost: 1,
    info, debugAmbient,
    _internals: () => ({ post, amb, bur, deb, lines, G }),
    get postMode() { return post.mode; }
  };
  RR.register('fx', api);
})(window.RR);
