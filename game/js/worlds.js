/* Rainbow Rails — worlds
 * RR.worlds: streamed scenery per world (50 m chunks per side, near 7–25 m, mid 25–80 m, far 80–250 m),
 * landmark set pieces (2–3 per world, 250–400 m apart) and the themed tunnel at every world boundary.
 *
 * Rendering: every prop prototype is baked once (RR.Prop-based Kit: vertex colours + a per-vertex aFx
 * attribute = [wind sway, instance-tint mask, pulse, emissive mode]) and drawn as ONE InstancedMesh
 * (RR.InstancedPool, per-instance colour). Glow parts live inside the same geometry (emissive mode 2 =
 * unlit x glow boost), so a prototype costs one draw call. Towers use a facade shader that draws window
 * grids from the instance scale. Signs, billboards and graffiti share one canvas atlas.
 * No pop-in: content spawns SPAWN_AHEAD (beyond fog far), every vertex 405-518 m ahead of the camera
 * "rises" out of the ground in the vertex shader, fog takes the sky colour behind the fragment, and the
 * next world's far band (|x| > 26 beyond the next boundary) stays down until the camera is in the tunnel.
 * Nothing is created per spawn: chunks and landmarks only add/remove instances; freed slots are
 * compacted (live instances relocated down) so dead instances are not drawn.
 * Hard rules are enforced on rotated footprints at placement (corridor |x| >= 7, far band |x| - r >= 40,
 * tunnel hills, landmarks, city streets, water) and verified per triangle by the scratch clearance test.
 */
(function (RR) {
  'use strict';
  if (!RR || typeof THREE === 'undefined') return;
  const C = RR.C;
  const TAU = Math.PI * 2;
  const CH = 50; // chunk length, aligned to multiples of 50 (never straddles a world boundary)
  const FLAT = C.TERRAIN_FLAT; // 18
  const TUN = C.TUNNEL_HALF; // 60
  const NEAR_MIN = 7.0; // |x| - r of the closest props (fences at 6.3, masts at 6.8)
  const MOUND_W = 46; // tunnel hill half width
  const BUILD_MS = 2.5; // per-frame streaming budget
  const CHUNK_ITEMS = 1400; // max instances per chunk (both sides) or landmark

  // ------------------------------------------------------------------ small helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // Non-allocating reseedable mulberry32 (same generator as RR.makeRng; chunk layouts must repeat).
  const R = { s: 1 };
  function rseed(a, b, c) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); R.s = (h ^ (h >>> 15)) >>> 0;
  }
  function rnd() { R.s = (R.s + 0x6d2b79f5) >>> 0; let t = R.s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  const rr = (a, b) => a + rnd() * (b - a);
  const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
  const rp = (arr) => arr[(rnd() * arr.length) | 0];
  const rc = (p) => rnd() < p;
  function hashU(a, b) { let h = Math.imul((a | 0) ^ 0x51ed270b, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae3d); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const _tc = new THREE.Color(), _tc2 = new THREE.Color();
  function mulHex(h, k) { _tc.set(h); return _tc.setRGB(Math.min(1, _tc.r * k), Math.min(1, _tc.g * k), Math.min(1, _tc.b * k)).getHex(); }
  function mixHex(a, b, t) { _tc.set(a); _tc2.set(b); return _tc.lerp(_tc2, t).getHex(); }

  // ------------------------------------------------------------------ shared uniforms
  const U = {
    uTime: { value: 0 }, uGlowBoost: { value: 1 },
    uRRHor: { value: new THREE.Color(0xffa27a) }, uRRMid: { value: new THREE.Color(0xc85c9c) }, uRRTop: { value: new THREE.Color(0x3d2f8f) },
    uRRHaze: { value: new THREE.Color(0xffd49a) }, uRRHazeK: { value: 0.45 },
    uFogNear: { value: 50 }, uFogFar: { value: 480 },
    uCam: { value: new THREE.Vector3() }, // camera world position (r128 only uploads cameraPosition for Phong/Standard/Shader materials)
    uRise: { value: new THREE.Vector2(C.SPAWN_AHEAD - 2, C.SPAWN_AHEAD - 115) } // (fully down at, fully up at) metres ahead of the camera
  };
  // Sky haze band per kind (mirrors sky.js so fully fogged tall props take exactly the sky colour behind them).
  const HAZE_BY_KIND = { city: [0xffd49a, 0.45], beach: [0xf6feff, 0.5], candy: [0xfff6fb, 0.5], neon: [0xff3fb4, 0.55], snow: [0xffd9e6, 0.45] };

  // ------------------------------------------------------------------ GLSL patch (Lambert / Basic)
  const VS_DECL = [
    'attribute vec4 aFx;', 'varying vec4 vFx;', 'varying vec3 vRRW;', 'varying float vRRDepth;', 'uniform float uTime;', 'uniform vec2 uRise;', 'uniform vec3 uCam;',
    '#ifdef RR_CELL', 'attribute vec4 aCell;', '#endif',
    '#ifdef RR_FACADE', 'attribute vec4 aWin;', 'varying vec4 vWinUV;', 'varying vec4 vWinP;', 'varying float vWinM;', '#endif'
  ].join('\n');
  const VS_UV = [
    '#ifdef USE_UV',
    '  #ifdef RR_CELL',
    '    vUv = aCell.xy + uv * aCell.zw;',
    '  #else',
    '    vUv = ( uvTransform * vec3( uv, 1 ) ).xy;',
    '  #endif',
    '#endif'
  ].join('\n');
  const VS_COLOR = [
    '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )',
    '  vColor = vec3( 1.0 );',
    '#endif',
    '#ifdef USE_COLOR',
    '  vColor *= color;',
    '#endif',
    '#ifdef USE_INSTANCING_COLOR',
    '  vColor *= mix( vec3( 1.0 ), instanceColor, aFx.y );',
    '#endif',
    'vFx = aFx;'
  ].join('\n');
  const VS_BEGIN = [
    'vec3 transformed = vec3( position );',
    'if ( aFx.x > 0.0 ) {',
    '  vec4 rrB = vec4( position, 1.0 );',
    '  #ifdef USE_INSTANCING',
    '  rrB = instanceMatrix * rrB;',
    '  #endif',
    '  rrB = modelMatrix * rrB;',
    '  float rrPh = rrB.x * 0.11 + rrB.z * 0.07;',
    '  float rrS = sin( uTime * 1.7 + rrPh ) + 0.35 * sin( uTime * 3.1 + rrPh * 1.9 );',
    '  transformed.x += aFx.x * rrS;',
    '  transformed.z += aFx.x * 0.6 * cos( uTime * 1.3 + rrPh * 1.3 );',
    '}',
    '#ifdef RR_FACADE',
    '{',
    '  vec3 rs = vec3( 1.0 );',
    '  #ifdef USE_INSTANCING',
    '  rs = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );',
    '  #endif',
    '  float isZ = step( 0.5, abs( normal.z ) );',
    '  float isX = step( 0.5, abs( normal.x ) );',
    '  vWinUV = vec4( mix( ( position.z + 0.5 ) * rs.z, ( position.x + 0.5 ) * rs.x, isZ ), position.y * rs.y, mix( rs.z, rs.x, isZ ), rs.y );',
    '  vWinM = max( isZ, isX ) + step( 0.5, normal.y ) * 2.0;',
    '  vWinP = aWin;',
    '  #ifdef USE_INSTANCING',
    '  vWinP.z += dot( instanceMatrix[ 3 ].xz, vec2( 0.0137, 0.0071 ) ) + normal.x * 0.31 + normal.z * 0.17;',
    '  #endif',
    '}',
    '#endif'
  ].join('\n');
  // Replaces project_vertex: world position, then the "rise" (no pop-in): vertices 400-520 m ahead of the
  // camera grow out of the ground, and far-band vertices (|x| > 30) beyond the next tunnel stay down until
  // the camera is inside that tunnel (the next world's skyline never shows over the current one).
  const VS_PROJECT = [
    'vec4 rrW = vec4( transformed, 1.0 );',
    '#ifdef USE_INSTANCING',
    'rrW = instanceMatrix * rrW;',
    '#endif',
    'rrW = modelMatrix * rrW;',
    '{',
    '  float rrD = uCam.z - rrW.z;',
    '  float rrF = 1.0 - smoothstep( uRise.y, uRise.x, rrD );',
    '  float rrK = max( 0.0, floor( - uCam.z * 0.001 ) );',
    '  float rrBn = - ( rrK + 1.0 ) * 1000.0;',
    '  if ( rrW.z < rrBn - 1.0 && abs( rrW.x ) > 26.0 ) rrF = min( rrF, smoothstep( rrBn + 60.0, rrBn + 25.0, uCam.z ) );',
    '  rrW.y *= rrF;',
    '}',
    'vRRW = rrW.xyz;',
    'vec4 mvPosition = viewMatrix * rrW;',
    'gl_Position = projectionMatrix * mvPosition;',
    'vRRDepth = - mvPosition.z;'
  ].join('\n');
  const FS_DECL = [
    'varying vec4 vFx;', 'varying vec3 vRRW;', 'varying float vRRDepth;',
    'uniform float uTime;', 'uniform float uGlowBoost;', 'uniform vec3 uCam;',
    'uniform vec3 uRRHor;', 'uniform vec3 uRRMid;', 'uniform vec3 uRRTop;', 'uniform vec3 uRRHaze;', 'uniform float uRRHazeK;',
    'float rrH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }',
    'vec3 rrSky( vec3 d ) {',
    '  float e = d.y;',
    '  if ( e <= 0.0 ) return uRRHor;',
    '  vec3 c = mix( uRRHor, uRRMid, pow( smoothstep( 0.0, 0.24, e ), 0.75 ) );',
    '  c = mix( c, uRRTop, smoothstep( 0.1, 0.8, e ) );',
    '  float band = smoothstep( 0.0, 0.025, e ) * exp( - e * 13.0 );',
    '  return mix( c, uRRHaze, band * uRRHazeK );',
    '}',
    '#ifdef RR_FACADE', 'varying vec4 vWinUV;', 'varying vec4 vWinP;', 'varying float vWinM;', '#endif'
  ].join('\n');
  // Window grid for unit-box towers. vWinP: x style (0 city dusk, 1 neon, 2 pastel hotel), y lit ratio, z seed, w lobby flag.
  const FS_FACADE = [
    '#ifdef RR_FACADE',
    'float rrWinE = 0.0; vec3 rrWinC = vec3( 0.0 );',
    'if ( vWinM > 1.5 ) { diffuseColor.rgb *= 0.55; }',
    'else if ( vWinM > 0.5 ) {',
    '  float st = vWinP.x;',
    '  bool neon = st > 0.5 && st < 1.5;',
    '  vec2 cell = neon ? vec2( 2.4, 3.1 ) : ( st > 1.5 ? vec2( 3.2, 3.2 ) : vec2( 3.0, 3.4 ) );',
    '  float W = vWinUV.z, H = vWinUV.w, lob = vWinP.w * 3.8;',
    '  float nx = max( 1.0, floor( ( W - 1.0 ) / cell.x ) );',
    '  float ny = max( 0.0, floor( ( H - lob - 1.4 ) / cell.y ) );',
    '  float u = vWinUV.x - ( W - nx * cell.x ) * 0.5, v = vWinUV.y - lob;',
    '  vec2 q = vec2( u, v ) / cell, c = floor( q ), f = q - c;',
    '  float aa = clamp( vRRDepth * 0.0025, 0.02, 0.2 );',
    '  float inG = step( 0.0, q.x ) * step( q.x, nx ) * step( 0.0, q.y ) * step( q.y, ny );',
    '  float win = inG * smoothstep( 0.16 - aa, 0.16 + aa, f.x ) * smoothstep( 0.84 + aa, 0.84 - aa, f.x ) * smoothstep( 0.2 - aa, 0.2 + aa, f.y ) * smoothstep( 0.86 + aa, 0.86 - aa, f.y );',
    '  float h = rrH( c + vec2( vWinP.z * 7.13, vWinP.z * 3.71 ) );',
    '  float fl = neon ? step( 0.985, rrH( c + floor( uTime * 3.0 ) ) ) : 0.0;',
    '  float lit = step( 1.0 - vWinP.y, h ) * ( 1.0 - fl );',
    '  float fade = 1.0 - smoothstep( 170.0, 360.0, vRRDepth );',
    '  vec3 glass, litC;',
    '  if ( neon ) {',
    '    glass = vec3( 0.06, 0.05, 0.14 ) + vec3( 0.05, 0.02, 0.08 ) * f.y;',
    '    float hh = fract( h * 7.7 + vWinP.z );',
    '    litC = hh < 0.3 ? vec3( 0.35, 0.95, 1.0 ) : ( hh < 0.55 ? vec3( 1.0, 0.35, 0.9 ) : ( hh < 0.75 ? vec3( 1.0, 0.88, 0.45 ) : vec3( 0.85, 0.8, 1.0 ) ) );',
    '  } else if ( st > 1.5 ) {',
    '    glass = mix( vec3( 0.42, 0.62, 0.78 ), vec3( 0.72, 0.86, 0.95 ), f.y );',
    '    litC = vec3( 1.0, 0.93, 0.78 );',
    '  } else {',
    '    glass = mix( uRRHor, uRRMid, 0.25 + 0.55 * f.y ) * 0.62 + vec3( 0.02, 0.02, 0.06 );',
    '    litC = mix( vec3( 1.0, 0.8, 0.5 ), vec3( 1.0, 0.92, 0.72 ), fract( h * 5.3 ) );',
    '  }',
    '  float lum = lit * 1.35;',
    '  vec3 avg = mix( glass, litC, vWinP.y * 0.6 );',
    '  rrWinE = mix( 0.0, win, fade ) + ( 1.0 - fade ) * inG * 0.55;',
    '  rrWinC = mix( avg, mix( glass, litC * lum, lit ), fade );',
    '  if ( neon ) {',
    '    float e = min( vWinUV.x, W - vWinUV.x );',
    '    float edge = smoothstep( 0.42 + aa, 0.3 - aa, e ) + smoothstep( H - 0.7 - aa, H - 0.5 + aa, vWinUV.y ) * 0.9;',
    '    vec3 nc = 0.5 + 0.5 * cos( 6.2831 * ( fract( vWinP.z * 0.37 ) + vec3( 0.0, 0.33, 0.67 ) ) );',
    '    nc = mix( nc, vec3( 1.0, 0.25, 0.85 ), 0.35 );',
    '    rrWinC = mix( rrWinC, nc * 1.6, clamp( edge, 0.0, 1.0 ) );',
    '    rrWinE = max( rrWinE, clamp( edge, 0.0, 1.0 ) );',
    '  }',
    '  if ( vWinP.w > 0.5 && vWinUV.y < lob - 0.4 && vWinUV.y > 0.3 ) {',
    '    float d = step( 0.7, vWinUV.x ) * step( vWinUV.x, W - 0.7 );',
    '    rrWinC = neon ? vec3( 0.55, 0.9, 1.0 ) * 1.2 : vec3( 1.0, 0.86, 0.6 ) * 1.1;',
    '    rrWinE = d * ( 0.35 + 0.65 * step( 0.5, fract( vWinUV.x / 2.2 ) ) );',
    '  }',
    '}',
    '#endif'
  ].join('\n');
  const FS_EMIT = [
    '{',
    '  float rrU = clamp( vFx.w, 0.0, 1.0 );',
    '  float rrBo = 1.0 + ( uGlowBoost - 1.0 ) * clamp( vFx.w - 1.0, 0.0, 1.0 );',
    '  float rrP = 1.0;',
    '  if ( vFx.z > 0.0 ) rrP = 1.0 + vFx.z * sin( vRRW.z * 0.42 - uTime * 7.0 );',
    '  else if ( vFx.z < 0.0 ) rrP = 0.1 + 0.9 * step( 0.55, fract( uTime * 0.8 + vRRW.x * 0.013 + vRRW.z * 0.021 ) );',
    '  outgoingLight = mix( outgoingLight, diffuseColor.rgb * rrBo * rrP, rrU );',
    '  #ifdef RR_FACADE',
    '  outgoingLight = mix( outgoingLight, rrWinC * mix( 1.0, uGlowBoost, 0.6 ), rrWinE );',
    '  #endif',
    '}',
    '#include <envmap_fragment>'
  ].join('\n');
  const FS_FOG = [
    '#ifdef USE_FOG',
    '  float fogFactor = smoothstep( fogNear, fogFar, fogDepth );',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, rrSky( normalize( vRRW - uCam ) ), fogFactor );',
    '#endif'
  ].join('\n');

  function patchMaterial(mat, key) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime; sh.uniforms.uGlowBoost = U.uGlowBoost; sh.uniforms.uRise = U.uRise; sh.uniforms.uCam = U.uCam;
      sh.uniforms.uRRHor = U.uRRHor; sh.uniforms.uRRMid = U.uRRMid; sh.uniforms.uRRTop = U.uRRTop;
      sh.uniforms.uRRHaze = U.uRRHaze; sh.uniforms.uRRHazeK = U.uRRHazeK;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VS_DECL)
        .replace('#include <uv_vertex>', VS_UV)
        .replace('#include <color_vertex>', VS_COLOR)
        .replace('#include <begin_vertex>', VS_BEGIN)
        .replace('#include <project_vertex>', VS_PROJECT);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FS_DECL)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + FS_FACADE)
        .replace('#include <envmap_fragment>', FS_EMIT)
        .replace('#include <fog_fragment>', FS_FOG);
    };
    mat.customProgramCacheKey = () => key;
    return mat;
  }

  // Hologram billboard (additive, scanlines, glitch, hue cycling) — reads text from the sign atlas.
  const HOLO_VS = [
    'attribute vec4 aCell;',
    'varying vec2 vUv; varying vec2 vQ; varying float vDepth; varying vec3 vTint; varying float vSeed; varying vec4 vCell;',
    'void main() {',
    '  vQ = uv; vCell = aCell; vUv = aCell.xy + uv * aCell.zw;',
    '  vec4 p = vec4( position, 1.0 );',
    '  vSeed = 0.0;',
    '  #ifdef USE_INSTANCING',
    '  p = instanceMatrix * p;',
    '  vSeed = fract( instanceMatrix[ 3 ].x * 0.137 + instanceMatrix[ 3 ].z * 0.0113 );',
    '  #endif',
    '  vTint = vec3( 1.0 );',
    '  #ifdef USE_INSTANCING_COLOR',
    '  vTint = instanceColor;',
    '  #endif',
    '  vec4 mv = modelViewMatrix * p;',
    '  vDepth = - mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  const HOLO_FS = [
    'uniform sampler2D map; uniform float uTime; uniform float uGlowBoost; uniform float uFogNear; uniform float uFogFar;',
    'varying vec2 vUv; varying vec2 vQ; varying float vDepth; varying vec3 vTint; varying float vSeed; varying vec4 vCell;',
    'float hh( float n ) { return fract( sin( n * 91.345 ) * 47453.5453 ); }',
    'void main() {',
    '  float t = uTime + vSeed * 17.0;',
    '  float g = step( 0.86, hh( floor( t * 2.3 ) ) );',
    '  float row = floor( vQ.y * 24.0 );',
    '  float off = ( hh( row + floor( t * 14.0 ) ) - 0.5 ) * 0.12 * g;',
    '  vec2 uv = clamp( vUv + vec2( off * vCell.z, 0.0 ), vCell.xy, vCell.xy + vCell.zw );',
    '  float a = texture2D( map, uv ).a;',
    '  float sl = 0.72 + 0.28 * sin( vQ.y * 150.0 - t * 9.0 );',
    '  vec3 hue = 0.5 + 0.5 * cos( 6.2831 * ( t * 0.07 + vQ.x * 0.35 + vec3( 0.0, 0.33, 0.67 ) ) );',
    '  vec3 col = mix( hue, vec3( 1.0 ), 0.3 ) * vTint;',
    '  float edge = max( step( vQ.x, 0.012 ) + step( 0.988, vQ.x ), step( vQ.y, 0.03 ) + step( 0.97, vQ.y ) );',
    '  float ph = fract( vQ.y * 3.0 - t * 0.6 );',
    '  float band = smoothstep( 0.0, 0.02, ph ) * smoothstep( 0.2, 0.02, ph );',
    '  float I = a * sl * ( 1.0 + 0.4 * band ) + edge * 0.8 + 0.07 + 0.06 * band;',
    '  I *= 0.85 + 0.15 * sin( t * 31.0 ) * g;',
    '  float fog = 1.0 - smoothstep( uFogNear, uFogFar, vDepth );',
    '  gl_FragColor = vec4( col * I * mix( 1.0, uGlowBoost, 0.7 ) * fog, 1.0 );',
    '}'
  ].join('\n');
  // Lighthouse / stadium light beams (additive, fades along the beam).
  const BEAM_VS = 'varying vec2 vQ; varying float vDepth; void main() { vQ = uv; vec4 mv = modelViewMatrix * vec4( position, 1.0 ); vDepth = - mv.z; gl_Position = projectionMatrix * mv; }';
  const BEAM_FS = [
    'uniform vec3 uColor; uniform float uAlpha; uniform float uFogNear; uniform float uFogFar;',
    'varying vec2 vQ; varying float vDepth;',
    'void main() {',
    '  float a = pow( 1.0 - vQ.y, 1.6 ) * uAlpha * ( 0.55 + 0.45 * sin( vQ.x * 6.2831 ) * sin( vQ.x * 6.2831 ) );',
    '  float fog = 1.0 - smoothstep( uFogNear, uFogFar, vDepth );',
    '  gl_FragColor = vec4( uColor * a * fog, 1.0 );',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------ Kit (baked prop builder)
  // Extends RR.Prop: every part also records [sway, tint, pulse, emissive] which becomes the aFx attribute.
  // Modes are sticky: k.T(1) tints following parts with the instance colour, k.E(2) makes them glow, k.S(a)
  // makes them sway (amplitude a metres at the prop's top), k.P(p) pulses (p < 0 blinks). k.L() resets.
  const GC = {};
  const unitGeo = (key, make) => GC[key] || (GC[key] = make());
  const gBox = () => unitGeo('box', () => new THREE.BoxGeometry(1, 1, 1));
  const gCyl = (seg, ratio, open) => unitGeo('cyl' + seg + ':' + ratio.toFixed(3) + (open ? 'o' : ''), () => new THREE.CylinderGeometry(ratio, 1, 1, seg, 1, !!open));
  const gCone = (seg, open) => unitGeo('cone' + seg + (open ? 'o' : ''), () => new THREE.ConeGeometry(1, 1, seg, 1, !!open));
  const gSph = (w, h) => unitGeo('sph' + w + ':' + h, () => new THREE.SphereGeometry(1, w, h));
  const gHemi = (w, h) => unitGeo('hemi' + w + ':' + h, () => new THREE.SphereGeometry(1, w, h, 0, TAU, 0, Math.PI / 2));
  const gIco = (d) => unitGeo('ico' + d, () => new THREE.IcosahedronGeometry(1, d));
  const gOct = () => unitGeo('oct', () => new THREE.OctahedronGeometry(1, 0));
  const gDod = () => unitGeo('dod', () => new THREE.DodecahedronGeometry(1, 0));
  const gTor = (ratio, rs, ts, arc) => unitGeo('tor' + ratio.toFixed(3) + ':' + rs + ':' + ts + ':' + (arc || TAU).toFixed(3), () => new THREE.TorusGeometry(1, ratio, rs, ts, arc || TAU));
  const gWedge = (seg, t0, tl) => unitGeo('wedge' + seg + ':' + t0.toFixed(3) + ':' + tl.toFixed(3), () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, false, t0, tl));

  class Kit extends RR.Prop {
    constructor() { super(); this.fx = []; this.m = [0, 0, 0, 0]; }
    S(v) { this.m[0] = v; return this; }
    T(v) { this.m[1] = v === undefined ? 1 : v; return this; }
    P(v) { this.m[2] = v; return this; }
    E(v) { this.m[3] = v === undefined ? 2 : v; return this; }
    L() { this.m[1] = 0; this.m[2] = 0; this.m[3] = 0; return this; }
    add(geo, color, pos, rot, scale) {
      const fn = typeof color === 'function' ? color : null;
      super.add(geo, fn ? 0xffffff : color, pos, rot, scale, false);
      const g = this.solid[this.solid.length - 1];
      if (fn) {
        const p = g.attributes.position.array, c = g.attributes.color.array;
        for (let i = 0; i < p.length; i += 3) { fn(p[i], p[i + 1], p[i + 2], _tc); c[i] = _tc.r; c[i + 1] = _tc.g; c[i + 2] = _tc.b; }
      }
      this.fx.push(this.m[0], this.m[1], this.m[2], this.m[3]);
      return this;
    }
    // centre-based primitives
    box(c, w, h, d, x, y, z, rx, ry, rz) { return this.add(gBox(), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [w, h, d]); }
    boxB(c, w, h, d, x, y0, z, rx, ry, rz) { return this.box(c, w, h, d, x, y0 + h / 2, z, rx, ry, rz); }
    cyl(c, rt, rb, h, seg, x, y, z, rx, ry, rz, open) { const rbb = Math.max(rb, 1e-4); return this.add(gCyl(seg || 8, rt / rbb, open), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [rbb, h, rbb]); }
    cylB(c, rt, rb, h, seg, x, y0, z) { return this.cyl(c, rt, rb, h, seg, x, y0 + h / 2, z); }
    cone(c, r, h, seg, x, y, z, rx, ry, rz) { return this.add(gCone(seg || 8), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [r, h, r]); }
    coneB(c, r, h, seg, x, y0, z) { return this.cone(c, r, h, seg, x, y0 + h / 2, z); }
    coneO(c, r, h, seg, x, y0, z) { return this.add(gCone(seg || 8, true), c, [x, y0 + h / 2, z], null, [r, h, r]); } // open base, bottom at y0
    cylO(c, rt, rb, h, seg, x, y0, z) { const rbb = Math.max(rb, 1e-4); return this.add(gCyl(seg || 8, rt / rbb, true), c, [x, y0 + h / 2, z], null, [rbb, h, rbb]); }
    sph(c, sx, sy, sz, x, y, z, w, h, rx, ry, rz) { return this.add(gSph(w || 8, h || 6), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [sx, sy, sz]); }
    hemi(c, sx, sy, sz, x, y, z, w, h) { return this.add(gHemi(w || 10, h || 4), c, [x, y, z], null, [sx, sy, sz]); }
    ico(c, r, x, y, z, sx, sy, sz, det, rx, ry, rz) { return this.add(gIco(det || 0), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [r * (sx || 1), r * (sy || 1), r * (sz || 1)]); }
    oct(c, sx, sy, sz, x, y, z, rx, ry, rz) { return this.add(gOct(), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [sx, sy, sz]); }
    dod(c, sx, sy, sz, x, y, z, rx, ry, rz) { return this.add(gDod(), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [sx, sy, sz]); }
    tor(c, R, t, x, y, z, rx, ry, rz, rs, ts, arc) { return this.add(gTor(t / R, rs || 6, ts || 16, arc), c, [x, y, z], [rx || 0, ry || 0, rz || 0], R); }
    wedge(c, r, h, t0, tl, x, y, z, rx, ry, rz, seg) { return this.add(gWedge(seg || 2, t0, tl), c, [x, y, z], [rx || 0, ry || 0, rz || 0], [r, h, r]); }
    // box from point A to point B (struts, cables, rails, ribs)
    beam(c, x0, y0, z0, x1, y1, z1, w, h) {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      return this.add(gBox(), c, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [0, Math.atan2(-dz, dx), Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)), 'YZX'], [L, h, w === undefined ? h : w]);
    }
    // double-sided triangle (sails, flags, fronds)
    tri(c, ax, ay, az, bx, by, bz, cx, cy, cz) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, bx, by, bz], 3));
      return this.add(g, c, null, null, null);
    }
    geo(g, c, pos, rot, scale) { return this.add(g, c, pos, rot, scale); }
    // Merge into one BufferGeometry: position, color, aFx (+ normals). ao: darken near the ground.
    bake(o) {
      o = o || {};
      const parts = this.solid;
      let n = 0, minY = 1e9, maxY = -1e9;
      for (const g of parts) { n += g.attributes.position.count; const a = g.attributes.position.array; for (let i = 1; i < a.length; i += 3) { if (a[i] < minY) minY = a[i]; if (a[i] > maxY) maxY = a[i]; } }
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), fx = new Float32Array(n * 4);
      const H = Math.max(0.5, o.swayH || maxY), aoH = o.aoH || Math.min(2.4, Math.max(0.6, maxY * 0.35)), aoK = o.ao === false ? 0 : (o.aoK || 0.3);
      let v = 0;
      parts.forEach((g, pi) => {
        const a = g.attributes.position.array, cc = g.attributes.color.array, cnt = a.length / 3;
        const s = this.fx[pi * 4], t = this.fx[pi * 4 + 1], p = this.fx[pi * 4 + 2], e = this.fx[pi * 4 + 3];
        for (let i = 0; i < cnt; i++, v++) {
          const y = a[i * 3 + 1];
          pos[v * 3] = a[i * 3]; pos[v * 3 + 1] = y; pos[v * 3 + 2] = a[i * 3 + 2];
          const ao = e > 0 ? 1 : 1 - aoK * (1 - sstep(0, aoH, y));
          col[v * 3] = cc[i * 3] * ao; col[v * 3 + 1] = cc[i * 3 + 1] * ao; col[v * 3 + 2] = cc[i * 3 + 2] * ao;
          const w = s > 0 ? s * Math.pow(clamp(y / H, 0, 1.2), 2) : 0;
          fx[v * 4] = w; fx[v * 4 + 1] = t; fx[v * 4 + 2] = p; fx[v * 4 + 3] = e;
        }
        g.dispose();
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
      geo.computeVertexNormals();
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      this.solid = []; this.fx = [];
      return geo;
    }
  }

  // ------------------------------------------------------------------ sign atlas (one canvas for every world)
  const ATLAS_W = 1024, ATLAS_H = 2048, UNIT_W = 128, UNIT_H = 64;
  const SIGNS = {}; // id -> { u0, v0, du, dv, x, y, w, h, draw }
  const signList = [];
  let atlasTex = null, atlasCanvas = null;
  function defSign(id, wu, hu, draw) { const s = { id, wu, hu, draw, x: 0, y: 0, w: wu * UNIT_W, h: hu * UNIT_H, u0: 0, v0: 0, du: 0, dv: 0 }; SIGNS[id] = s; signList.push(s); return s; }
  function packAtlas() { // first-fit shelves, tallest first
    const list = signList.slice().sort((a, b) => b.hu - a.hu || b.wu - a.wu);
    const shelves = [];
    let bottom = 0;
    for (const s of list) {
      let sh = null;
      for (const q of shelves) if (q.h >= s.h && q.x + s.w <= ATLAS_W) { sh = q; break; }
      if (!sh) { sh = { y: bottom, h: s.h, x: 0 }; shelves.push(sh); bottom += s.h; }
      s.x = sh.x; s.y = sh.y; sh.x += s.w;
      const pad = 3;
      s.u0 = (s.x + pad) / ATLAS_W; s.du = (s.w - 2 * pad) / ATLAS_W;
      s.dv = (s.h - 2 * pad) / ATLAS_H; s.v0 = 1 - (s.y + s.h - pad) / ATLAS_H;
    }
    if (bottom > ATLAS_H) console.warn('[RR.worlds] sign atlas overflow ' + bottom);
  }
  const FD = () => RR.FONT_DISPLAY || '"Lilita One", sans-serif';
  function fitText(x, text, maxW, size, font) { let s = size; x.font = s + 'px ' + font; while (s > 8 && x.measureText(text).width > maxW) { s -= 2; x.font = s + 'px ' + font; } return s; }
  function txt(x, text, cx, cy, maxW, size, fill, stroke, sw, font) {
    fitText(x, text, maxW, size, font || FD());
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (stroke) { x.lineJoin = 'round'; x.strokeStyle = stroke; x.lineWidth = sw || 6; x.strokeText(text, cx, cy); }
    if (fill) { x.fillStyle = fill; x.fillText(text, cx, cy); }
  }
  function boardSign(bg1, bg2, fg, text, border) {
    return (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, bg1); g.addColorStop(1, bg2);
      const r = Math.min(12, h * 0.2), b = h < 100 ? 5 : 8;
      x.fillStyle = g; RR.roundRect(x, 2, 2, w - 4, h - 4, r); x.fill();
      x.strokeStyle = border || 'rgba(255,255,255,0.85)'; x.lineWidth = h < 100 ? 3 : 5; RR.roundRect(x, b, b, w - 2 * b, h - 2 * b, r * 0.7); x.stroke();
      txt(x, text, w / 2, h / 2 + 2, w - 30, h * 0.64, fg, 'rgba(0,0,0,0.35)', h < 100 ? 4 : 7);
    };
  }
  function neonSign(text, c1, c2) { // glowing tube text on transparent (alpha-tested, glow material)
    return (x, w, h) => {
      x.clearRect(0, 0, w, h);
      fitText(x, text, w - 26, h * 0.66, FD());
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      x.strokeStyle = c1; x.lineWidth = 9; x.strokeText(text, w / 2, h / 2 + 2);
      x.strokeStyle = c2; x.lineWidth = 3.5; x.strokeText(text, w / 2, h / 2 + 2);
      x.strokeStyle = c1; x.lineWidth = 4; RR.roundRect(x, 5, 5, w - 10, h - 10, 12); x.stroke();
    };
  }
  function holoText(text) { return (x, w, h) => { x.clearRect(0, 0, w, h); txt(x, text, w / 2, h / 2 + 3, w - 30, h * 0.7, '#fff', null); }; }
  function nameSign(i) {
    return (x, w, h) => {
      const W = RR.WORLDS[i];
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a1c5c'); g.addColorStop(1, '#170f3a');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = W.cssColor; x.lineWidth = 8; RR.roundRect(x, 8, 8, w - 16, h - 16, 18); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 2.5; RR.roundRect(x, 16, 16, w - 32, h - 32, 12); x.stroke();
      txt(x, W.name.toUpperCase(), w / 2, h / 2 + 4, w - 70, h * 0.58, '#ffffff', W.cssColor, 12);
      x.fillStyle = W.cssColor; for (const sx of [34, w - 34]) { x.beginPath(); x.arc(sx, h / 2, 7, 0, TAU); x.fill(); }
    };
  }
  function billboard(kind) {
    return (x, w, h) => {
      let g;
      if (kind === 0) { // Rainbow Rails ad
        g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#6fd3ff'); g.addColorStop(1, '#c9f1ff'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        const cols = ['#ff5a5f', '#ff9f43', '#ffd84d', '#5ee07a', '#3fa7ff', '#8a6bff'];
        cols.forEach((c, i) => { x.strokeStyle = c; x.lineWidth = 14; x.beginPath(); x.arc(w * 0.78, h * 1.05, h * 0.9 - i * 14, Math.PI, TAU); x.stroke(); });
        txt(x, 'RAINBOW', w * 0.36, h * 0.36, w * 0.62, h * 0.3, '#fff', '#3b2a7a', 10);
        txt(x, 'RAILS', w * 0.36, h * 0.66, w * 0.5, h * 0.3, '#ffd84d', '#3b2a7a', 10);
        txt(x, 'RIDE THE COLOURS', w * 0.36, h * 0.88, w * 0.6, h * 0.1, '#3b2a7a', null, 0, RR.FONT_UI);
      } else if (kind === 1) { // soda
        g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#ff5fa2'); g.addColorStop(1, '#ff9a5b'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgba(255,255,255,0.25)'; for (let i = 0; i < 26; i++) { x.beginPath(); x.arc((i * 97) % w, (i * 53) % h, 6 + (i % 5) * 4, 0, TAU); x.fill(); }
        x.fillStyle = '#39f0ff'; RR.roundRect(x, w * 0.1, h * 0.14, w * 0.14, h * 0.74, 20); x.fill();
        x.fillStyle = '#fff'; x.fillRect(w * 0.1, h * 0.42, w * 0.14, h * 0.14);
        txt(x, 'POP!', w * 0.6, h * 0.4, w * 0.6, h * 0.46, '#fff', '#7a1f5c', 12);
        txt(x, 'FIZZY SODA', w * 0.6, h * 0.78, w * 0.6, h * 0.16, '#fff8c0', '#7a1f5c', 6);
      } else if (kind === 2) { // radio
        g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3d2f8f'); g.addColorStop(0.55, '#c85c9c'); g.addColorStop(1, '#ffb27a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = '#ffe08a'; x.beginPath(); x.arc(w * 0.2, h * 0.62, h * 0.3, 0, TAU); x.fill();
        x.fillStyle = '#c85c9c'; for (let i = 0; i < 4; i++) x.fillRect(w * 0.05, h * (0.62 + i * 0.07), w * 0.3, h * 0.025);
        txt(x, 'SUNSET FM', w * 0.64, h * 0.4, w * 0.6, h * 0.3, '#fff', '#3d2f8f', 10);
        txt(x, '101.5', w * 0.64, h * 0.74, w * 0.4, h * 0.26, '#ffe08a', '#3d2f8f', 8);
      } else { // burger
        g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffd84d'); g.addColorStop(1, '#ffb13b'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        const bx = w * 0.22, by = h * 0.55;
        x.fillStyle = '#e8923a'; x.beginPath(); x.ellipse(bx, by - 40, 70, 42, 0, Math.PI, TAU); x.fill();
        x.fillStyle = '#5ec24a'; x.fillRect(bx - 74, by - 40, 148, 12);
        x.fillStyle = '#7a3b1f'; x.fillRect(bx - 70, by - 28, 140, 24);
        x.fillStyle = '#e8923a'; RR.roundRect(x, bx - 70, by - 4, 140, 26, 10); x.fill();
        txt(x, 'MEGA', w * 0.66, h * 0.36, w * 0.56, h * 0.3, '#fff', '#b3261e', 10);
        txt(x, 'BURGER', w * 0.66, h * 0.7, w * 0.6, h * 0.3, '#fff', '#b3261e', 10);
      }
    };
  }
  function graffiti(text, cols) {
    return (x, w, h) => {
      x.fillStyle = '#b9b3bd'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { x.fillStyle = 'rgba(' + (80 + (i * 37) % 60) + ',' + (70 + (i * 13) % 50) + ',' + (90 + (i * 29) % 60) + ',0.08)'; x.fillRect((i * 131) % w, (i * 71) % h, 20 + (i % 7) * 12, 6 + (i % 5) * 5); }
      x.strokeStyle = 'rgba(80,70,90,0.25)'; x.lineWidth = 2; for (let yy = h / 4; yy < h; yy += h / 4) { x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke(); }
      // back splash
      x.fillStyle = cols[2]; x.beginPath(); x.ellipse(w / 2, h / 2, w * 0.44, h * 0.38, -0.06, 0, TAU); x.fill();
      x.fillStyle = cols[3]; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; x.beginPath(); x.arc(w / 2 + Math.cos(a) * w * 0.44, h / 2 + Math.sin(a) * h * 0.38, 5 + (i % 3) * 3, 0, TAU); x.fill(); }
      const size = fitText(x, text, w * 0.8, h * 0.78, FD());
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      x.save(); x.translate(w / 2, h / 2 + 4); x.rotate(-0.05);
      x.strokeStyle = '#1b1030'; x.lineWidth = 18; x.strokeText(text, 0, 0);
      const g = x.createLinearGradient(0, -size / 2, 0, size / 2); g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]);
      x.fillStyle = g; x.fillText(text, 0, 0);
      x.fillStyle = 'rgba(255,255,255,0.55)'; x.font = size + 'px ' + FD(); x.save(); x.beginPath(); x.rect(-w, -size / 2, 2 * w, size * 0.28); x.clip(); x.fillText(text, 0, 0); x.restore();
      // drips
      x.fillStyle = cols[1]; for (let i = 0; i < 9; i++) { const dx = -w * 0.35 + i * w * 0.087, dl = 8 + ((i * 7) % 5) * 7; x.fillRect(dx, size * 0.34, 5, dl); x.beginPath(); x.arc(dx + 2.5, size * 0.34 + dl, 4, 0, TAU); x.fill(); }
      x.restore();
      x.fillStyle = '#fff'; for (const [sx, sy] of [[w * 0.08, h * 0.22], [w * 0.93, h * 0.3], [w * 0.88, h * 0.82]]) { x.save(); x.translate(sx, sy); x.beginPath(); for (let i = 0; i < 8; i++) { const r = i & 1 ? 5 : 14, a = i / 8 * TAU; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.fill(); x.restore(); }
    };
  }
  function defineSigns() {
    RR.WORLDS.forEach((w, i) => defSign('name' + i, 6, 2, nameSign(i)));
    defSign('bb0', 4, 4, billboard(0)); defSign('bb1', 4, 4, billboard(1)); defSign('bb2', 4, 4, billboard(2)); defSign('bb3', 4, 4, billboard(3));
    defSign('gr0', 4, 2, graffiti('RUN!', ['#ffe14d', '#ff5fa2', '#7c5cff', '#39f0ff']));
    defSign('gr1', 4, 2, graffiti('WOW', ['#5ef2ff', '#3fa7ff', '#ff5fa2', '#ffe14d']));
    defSign('gr2', 4, 2, graffiti('RAINBOW', ['#ffd84d', '#ff7a45', '#2ec27e', '#ff5fa2']));
    [['PIZZA', '#d7263d', '#9e1b2c'], ['DINER', '#2b7de9', '#1c4fa0'], ['BOOKS', '#2e9e6b', '#1d6b48'], ['CAFE', '#8a5a3c', '#5e3b26'],
      ['RECORDS', '#6b3fd0', '#46288c'], ['BAKERY', '#ff8a5b', '#d0613a'], ['FLOWERS', '#ff6fb5', '#c7488a'], ['ARCADE', '#ffb000', '#c77d00']]
      .forEach((s, i) => defSign('shop' + i, 2, 1, boardSign(s[1], s[2], '#fff', s[0])));
    defSign('station', 4, 2, (x, w, h) => { x.fillStyle = '#1f3f8f'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(10, 10, w - 20, 6); x.fillRect(10, h - 16, w - 20, 6); txt(x, 'SUNSET BLVD', w / 2 + 20, h / 2 + 2, w - 110, h * 0.5, '#fff', null); x.fillStyle = '#ff5a5f'; x.beginPath(); x.arc(42, h / 2, 22, 0, TAU); x.fill(); txt(x, 'R', 42, h / 2 + 2, 30, 30, '#fff', null); });
    [['SURF SHOP', '#1fb8d6', '#127e94'], ['ICE CREAM', '#ff7ac6', '#d04f98'], ['TIKI BAR', '#f0a13a', '#a8631a'], ['LIFEGUARD', '#e8453c', '#a8261f']]
      .forEach((s, i) => defSign('beach' + i, 2, 1, boardSign(s[1], s[2], '#fff', s[0])));
    defSign('pier', 4, 2, boardSign('#ffffff', '#e8f6ff', '#1f7fe0', 'PALM PIER', '#ff5a5f'));
    [['SWEETS', '#ff5fa2', '#c93d7c'], ['FUDGE', '#8a4b2a', '#5e2f18'], ['TAFFY', '#5ee0c8', '#2fa892']].forEach((s, i) => defSign('candy' + i, 2, 1, boardSign(s[1], s[2], '#fff', s[0])));
    [['ARCADE', '#ff3fd2', '#ffffff'], ['HOTEL', '#39f0ff', '#ffffff'], ['RAMEN', '#ffe14d', '#fffbe0'], ['OPEN 24H', '#7cff6b', '#f0fff0'], ['DISCO', '#ff5a5f', '#ffe0e0'], ['8-BIT', '#8a6bff', '#ffffff']]
      .forEach((s, i) => defSign('neon' + i, 2, 2, neonSign(s[0], s[1], s[2])));
    defSign('holo0', 4, 2, holoText('RAINBOW COLA')); defSign('holo1', 4, 2, holoText('NEON NIGHT'));
    defSign('holo2', 2, 2, holoText('RUN!')); defSign('holo3', 2, 2, holoText('JUMP!')); defSign('holo4', 4, 2, holoText('HIGH SCORE'));
    [['SKI LODGE', '#8a4b2a', '#5e2f18'], ['HOT COCOA', '#c93d3d', '#8f2424']].forEach((s, i) => defSign('frost' + i, 2, 1, boardSign(s[1], s[2], '#fff', s[0])));
    packAtlas();
  }
  function drawAtlas() {
    if (!atlasCanvas) { atlasCanvas = document.createElement('canvas'); atlasCanvas.width = ATLAS_W; atlasCanvas.height = ATLAS_H; }
    const x = atlasCanvas.getContext('2d');
    x.clearRect(0, 0, ATLAS_W, ATLAS_H);
    for (const s of signList) { x.save(); x.beginPath(); x.rect(s.x, s.y, s.w, s.h); x.clip(); x.translate(s.x, s.y); try { s.draw(x, s.w, s.h); } catch (e) { /* keep going */ } x.restore(); }
    if (atlasTex) atlasTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ materials
  const M = {};
  function makeMaterials() {
    RR.getMats();
    M.solid = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), 'rrw-solid');
    M.facade = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), 'rrw-facade');
    M.facade.defines = { RR_FACADE: '' };
    atlasTex = new THREE.CanvasTexture(atlasCanvas);
    atlasTex.anisotropy = Math.min(4, RR.maxAniso || 4);
    M.tex = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex }), 'rrw-tex');
    M.tex.defines = { RR_CELL: '' };
    M.texGlow = patchMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, map: atlasTex, alphaTest: 0.5 }), 'rrw-texglow');
    M.texGlow.defines = { RR_CELL: '' };
    M.holo = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlasTex }, uTime: U.uTime, uGlowBoost: U.uGlowBoost, uFogNear: U.uFogNear, uFogFar: U.uFogFar },
      vertexShader: HOLO_VS, fragmentShader: HOLO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    M.beam = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xfff2c0) }, uAlpha: { value: 0.3 }, uFogNear: U.uFogNear, uFogFar: U.uFogFar },
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
  }

  // ------------------------------------------------------------------ prototypes + pools
  // proto: { name, idx, geo, pool, mesh, live, r (footprint radius), h, far, mat }
  const PROTOS = [];
  const P = {};
  const BUILDERS = []; // each world kit registers its prototype builder here (run in init)
  let root = null;
  function quadGeo(emis, tint) {
    const g = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const fx = new Float32Array(n * 4); for (let i = 0; i < n; i++) { fx[i * 4 + 1] = tint === undefined ? 1 : tint; fx[i * 4 + 3] = emis; }
    g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function defProto(name, cap, geo, o) {
    o = o || {};
    const mat = o.mat || M.solid;
    if (o.cell) geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    if (o.win) geo.setAttribute('aWin', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const pool = new RR.InstancedPool(geo, mat, cap, root, { colors: true });
    pool.mesh.name = 'rrw-' + name;
    pool.mesh.visible = false;
    pool.mesh.matrixAutoUpdate = false;
    if (o.order) pool.mesh.renderOrder = o.order;
    const bb = geo.boundingBox;
    const r = o.r !== undefined ? o.r : Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z));
    const rad = Math.max(Math.hypot(bb.min.x, bb.min.z), Math.hypot(bb.min.x, bb.max.z), Math.hypot(bb.max.x, bb.min.z), Math.hypot(bb.max.x, bb.max.z));
    let sway = 0; const fxa = geo.attributes.aFx; if (fxa) for (let i = 0; i < fxa.count; i++) sway = Math.max(sway, fxa.array[i * 4]);
    const pr = { name, idx: PROTOS.length, geo, pool, mesh: pool.mesh, live: 0, r, rad, sway: sway * 1.4, h: bb.max.y, far: !!o.far, span: !!o.span, cap, hi: 0, o, farMark: new Uint8Array(cap), owner: new Int32Array(cap).fill(-1), pinned: !!o.pinned, touched: false };
    PROTOS.push(pr); P[name] = pr;
    return pr;
  }
  function kitProto(name, cap, build, o) {
    const k = new Kit();
    rseed(name.length * 7919, name.charCodeAt(0) | 0, (name.charCodeAt(name.length - 1) | 0) * 31);
    const bo = build(k) || {};
    const geo = k.bake(Object.assign({}, o || {}, bo));
    const pr = defProto(name, cap, geo, Object.assign({}, o || {}, bo));
    pr.spec = bo;
    return pr;
  }

  // instance helpers --------------------------------------------------
  const stats = { full: 0, lastMs: 0, maxMs: 0, resetMs: 0, chunks: 0, built: 0, initMs: 0 };
  function addInst(pr, x, y, z, ry, s, color, rx, rz) {
    const id = pr.pool.add(x, y, z, ry || 0, s === undefined ? 1 : s, rx, rz);
    if (id < 0) { stats.full++; return -1; }
    pr.live++;
    if (!pr.mesh.visible) pr.mesh.visible = true;
    pr.pool.setColor(id, color === undefined || color === null ? 0xffffff : color);
    if (pr.pool.used > pr.hi) pr.hi = pr.pool.used;
    return id;
  }
  // Item lists (chunks and landmarks) live in numbered slots so an instance can find its owner entry.
  const LISTS = [];
  function newList() { const l = new Int32Array(CHUNK_ITEMS * 2); LISTS.push(l); return { list: l, slot: LISTS.length - 1 }; }
  function record(pr, id) {
    if (!G.list) { pr.owner[id] = -1; return; }
    pr.owner[id] = G.slot * 65536 + G.n;
    G.list[G.n++] = pr.idx; G.list[G.n++] = id;
  }
  const _mm = new THREE.Matrix4(), _mc = new THREE.Color(), INST_ATTRS = ['aCell', 'aWin'];
  function moveInst(pr, from, to) {
    const pool = pr.pool, mesh = pool.mesh;
    mesh.getMatrixAt(from, _mm); mesh.setMatrixAt(to, _mm); mesh.setMatrixAt(from, pool.zero);
    if (mesh.instanceColor) { mesh.getColorAt(from, _mc); mesh.setColorAt(to, _mc); mesh.instanceColor.needsUpdate = true; }
    mesh.instanceMatrix.needsUpdate = true;
    for (let q = 0; q < INST_ATTRS.length; q++) { const a = pr.geo.attributes[INST_ATTRS[q]]; if (a) { a.setXYZW(to, a.getX(from), a.getY(from), a.getZ(from), a.getW(from)); a.needsUpdate = true; } }
    pr.farMark[to] = pr.farMark[from];
    const ref = pr.owner[from];
    pr.owner[to] = ref; pr.owner[from] = -1;
    if (ref >= 0) LISTS[(ref / 65536) | 0][(ref & 65535) + 1] = to;
    pool.alive[to] = 1; pool.alive[from] = 0;
  }
  const touched = [];
  function remInst(pr, id) {
    if (id < 0 || !pr.pool.alive[id]) return;
    pr.pool.remove(id); pr.live--; pr.owner[id] = -1;
    if (pr.live <= 0) { pr.live = 0; pr.mesh.visible = false; if (pr.pool.free.length === pr.pool.used) pr.pool.clear(); }
    if (!pr.touched) { pr.touched = true; touched.push(pr); }
  }
  // Keep instance ids compact after removals: trim dead slots off the top (mesh.count drops, so dead
  // instances are not submitted) and hand out the lowest free id first (the pool pops from the end).
  const cmpDesc = (a, b) => b - a;
  function compactTouched() {
    for (let t = 0; t < touched.length; t++) {
      const pr = touched[t], pool = pr.pool, f = pool.free, alive = pool.alive;
      pr.touched = false;
      if (f.length > 1) f.sort(cmpDesc);
      if (!pr.pinned) { // relocate the highest live instances into the lowest holes
        let top = pool.used - 1;
        while (f.length) {
          while (top >= 0 && !alive[top]) top--;
          const h = f[f.length - 1];
          if (top < 0 || h >= top || pr.owner[top] < 0) break;
          f.pop(); moveInst(pr, top, h); top--;
        }
      }
      let u = pool.used;
      while (u > 0 && !pool.alive[u - 1]) u--;
      if (u !== pool.used) { let j = 0; for (let i = 0; i < f.length; i++) if (f[i] < u) f[j++] = f[i]; f.length = j; pool.used = u; pool.mesh.count = u; }
      if (f.length > 1) f.sort(cmpDesc);
    }
    touched.length = 0;
  }
  function setCell(pr, id, sign) {
    const s = SIGNS[sign]; if (!s || id < 0) return;
    const a = pr.geo.attributes.aCell; a.setXYZW(id, s.u0, s.v0, s.du, s.dv); a.needsUpdate = true;
  }
  function setWin(pr, id, style, lit, seed, lobby) { if (id < 0) return; const a = pr.geo.attributes.aWin; a.setXYZW(id, style, lit, seed, lobby); a.needsUpdate = true; }

  // ------------------------------------------------------------------ world queries
  const hasTrack = () => !!(RR.track && RR.track.heightAt);
  const groundH = (x, z) => (Math.abs(x) < FLAT || !hasTrack() ? 0 : RR.track.heightAt(x, z));
  const waterLv = (x, z) => (RR.track && RR.track.waterAt ? RR.track.waterAt(x, z) : null);
  const kindAt = (wi) => RR.WORLDS[wi].kind;
  function streetAt(z, pad) { return RR.track && RR.track.streetAt ? RR.track.streetAt(z, pad) : false; }
  function trackReserved(x, z, r) { return RR.track && RR.track.reservedAt ? RR.track.reservedAt(x, z, r) : false; }
  // Tunnel hill footprint: nothing but tunnel parts within |x| < MOUND_W + 4 over the tunnel span (+ portal decks).
  function inTunnelZone(x, z, r) {
    const b = -RR.nearestBoundaryK(z) * C.WORLD_LEN;
    return Math.abs(z - b) < TUN + 7 + r && Math.abs(x) - r < MOUND_W + 4;
  }

  // ------------------------------------------------------------------ placement context
  const G = { c: 0, z0: 0, z1: 0, k: 0, wi: 0, kind: 'city', rel0: 0, dens: 1, list: null, slot: 0, n: 0, farQ: 1, sparse: 1, occ: new Float32Array(4 * 700), nOcc: 0, far: false, lms: null };
  // flags
  const F_WATER = 1, F_NOOCC = 2, F_ANYZ = 4, F_STREET = 8, F_ONWATER = 16, F_NOSEAT = 32;
  function occupied(x0, x1, z0, z1) {
    const o = G.occ;
    for (let i = 0, n = G.nOcc * 4; i < n; i += 4) if (x1 > o[i] && x0 < o[i + 1] && z1 > o[i + 2] && z0 < o[i + 3]) return true;
    return false;
  }
  function occupy(x0, x1, z0, z1) { if (G.nOcc < 700) { const o = G.occ, i = G.nOcc++ * 4; o[i] = x0; o[i + 1] = x1; o[i + 2] = z0; o[i + 3] = z1; } }
  function reservedLm(x0, x1, z0, z1) {
    const L = G.lms; if (!L) return false;
    for (let i = 0; i < L.length; i++) {
      const rs = L[i].rects;
      for (let j = 0; j < rs.length; j += 4) if (x1 > rs[j] && x0 < rs[j + 1] && z1 > rs[j + 2] && z0 < rs[j + 3]) return true;
    }
    return false;
  }
  function wetBox(x0, x1, z0, z1) {
    if (Math.max(Math.abs(x0), Math.abs(x1)) < FLAT) return false;
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    return waterLv(xm, zm) !== null || waterLv(x0, z0) !== null || waterLv(x1, z0) !== null || waterLv(x0, z1) !== null || waterLv(x1, z1) !== null || waterLv(x0, zm) !== null || waterLv(x1, zm) !== null;
  }
  function seatBox(x0, x1, z0, z1) {
    if (Math.max(Math.abs(x0), Math.abs(x1)) < FLAT || !hasTrack()) return 0;
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    return Math.min(groundH(xm, zm), groundH(x0, z0), groundH(x1, z0), groundH(x0, z1), groundH(x1, z1)) - 0.04;
  }
  function seatY(x, z, r) { return seatBox(x - r, x + r, z - r, z + r); }
  // Rotated footprint of prototype pr (scale s, rotation ry) -> FP = [x0, x1, z0, z1] relative to the origin.
  const FP = [0, 0, 0, 0];
  function footprint(pr, s, ry) {
    const bb = pr.geo.boundingBox;
    const sx = typeof s === 'number' ? s : s[0], sz = typeof s === 'number' ? s : s[2];
    const q = Math.round(ry / (Math.PI / 2)), exact = Math.abs(ry - q * (Math.PI / 2)) < 1e-3, m = ((q % 4) + 4) % 4;
    const ax0 = bb.min.x * sx, ax1 = bb.max.x * sx, az0 = bb.min.z * sz, az1 = bb.max.z * sz;
    if (!exact) { const r = pr.rad * Math.max(sx, sz); FP[0] = -r; FP[1] = r; FP[2] = -r; FP[3] = r; return FP; }
    // three.js rotation.y by a: x' = x cos a + z sin a, z' = -x sin a + z cos a
    if (m === 0) { FP[0] = ax0; FP[1] = ax1; FP[2] = az0; FP[3] = az1; }
    else if (m === 2) { FP[0] = -ax1; FP[1] = -ax0; FP[2] = -az1; FP[3] = -az0; }
    else if (m === 1) { FP[0] = az0; FP[1] = az1; FP[2] = -ax1; FP[3] = -ax0; }
    else { FP[0] = -az1; FP[1] = -az0; FP[2] = ax0; FP[3] = ax1; }
    return FP;
  }
  // Place one instance of prototype pr (checks every hard rule on its rotated footprint). Returns the id or -1.
  let lastY = 0, lastX = 0;
  function put(pr, x, z, ry, s, color, flags, yOff, rx, rz) {
    flags = flags | 0; ry = ry || 0;
    if (G.list && G.n + 2 > G.list.length) return -1; // list full (never expected: ~250 per chunk)
    footprint(pr, s, ry);
    const x0 = x + FP[0], x1 = x + FP[1], z0 = z + FP[2], z1 = z + FP[3];
    const minAx = x0 > 0 ? x0 : x1 < 0 ? -x1 : 0;
    if (minAx - (pr.sway || 0) < NEAR_MIN) return -1;
    const far = pr.far || G.far;
    if (far && minAx < C.FAR_CLEAR) return -1;
    if (!(flags & F_ANYZ) && (z > G.z0 || z <= G.z1)) return -1;
    const b = -RR.nearestBoundaryK(z) * C.WORLD_LEN;
    if (z1 > b - TUN - 7 && z0 < b + TUN + 7 && minAx < MOUND_W + 4) return -1;
    if (reservedLm(x0, x1, z0, z1)) return -1;
    if (G.kind === 'city' && !(flags & F_STREET) && (streetAt(z0, 1.2) || streetAt(z1, 1.2) || streetAt(z, 1.2))) return -1;
    if (minAx < 9.5 && trackReserved(x, z, Math.max(FP[1] - FP[0], FP[3] - FP[2]) / 2)) return -1;
    let y;
    if (flags & F_ONWATER) {
      const w = waterLv(x, z); if (w === null) return -1;
      if (waterLv(x0, z) === null || waterLv(x1, z) === null || waterLv(x, z0) === null || waterLv(x, z1) === null) return -1;
      y = w;
    } else {
      if (!(flags & F_WATER) && wetBox(x0, x1, z0, z1)) return -1;
      y = flags & F_NOSEAT ? 0 : seatBox(x0, x1, z0, z1);
    }
    if (!(flags & F_NOOCC)) {
      const sh = 0.08 * Math.min(x1 - x0, z1 - z0);
      if (occupied(x0 + sh, x1 - sh, z0 + sh, z1 - sh)) return -1;
      occupy(x0, x1, z0, z1);
    }
    lastY = y + (yOff || 0); lastX = x;
    const id = addInst(pr, x, lastY, z, ry, s, color, rx, rz);
    if (id >= 0) { pr.farMark[id] = far ? 1 : 0; record(pr, id); }
    return id;
  }
  // Unchecked add (for parts of a placed group: roofs on towers, signs on shops) recorded in the current list.
  function putRaw(pr, x, y, z, ry, s, color, rx, rz) {
    if (G.list && G.n + 2 > G.list.length) return -1;
    const id = addInst(pr, x, y, z, ry, s, color, rx, rz);
    if (id >= 0) { pr.farMark[id] = pr.far || G.far ? 1 : 0; record(pr, id); }
    return id;
  }
  function putSign(pr, sign, x, y, z, ry, w, h, color, rx) {
    const id = putRaw(pr, x, y, z, ry, [w, h, 1], color, rx);
    setCell(pr, id, sign);
    return id;
  }

  // ------------------------------------------------------------------ palettes
  const PAL = {
    cityWall: [0xf2b49a, 0xf3d4a6, 0xc9b6e8, 0xa9d8cc, 0xf5bccb, 0xeee2cf, 0xbccbea, 0xe6a9a0, 0xf7c98f, 0xd7c2f0],
    cityTower: [0xd8c7ea, 0xc3cfe8, 0xf0c9b8, 0xe8d8c0, 0xbfd9d2, 0xf2c4d4, 0xd0c0a8],
    cityTree: [0x6fae4a, 0x5f9e45, 0x88b852, 0xf4a7c4, 0xf7b9d0, 0x7cb85a, 0xe98fb3],
    car: [0xe8453c, 0x3fa7ff, 0xffc233, 0x2ec27e, 0xff7ac6, 0xf2f2f2, 0x7c5cff, 0xff8a3d, 0x39c6c6],
    beachHut: [0xff6b6b, 0x3fa7ff, 0xffc233, 0x2ec27e, 0xff7ac6, 0x7c5cff, 0x2fd0c0],
    umbrella: [0xff5a5f, 0x3fa7ff, 0xffc233, 0x2ec27e, 0xff7ac6, 0xff8a3d],
    palm: [0x3e9e4a, 0x4aab52, 0x5cb85a, 0x359048],
    candy: [0xff5fa2, 0x5ee0c8, 0xffd84d, 0xa87bff, 0xff8a5b, 0x7fd6ff, 0xff9ad0, 0xb8f06a],
    neon: [0xff3fd2, 0x39f0ff, 0xffe14d, 0x7cff6b, 0xff5a5f, 0x8a6bff],
    neonWall: [0x2a1f55, 0x221a48, 0x33205e, 0x1f2450, 0x2d1840],
    pine: [0x2f7d52, 0x2a6e4a, 0x3a8a5a, 0x346f58, 0x2d7a60],
    frostAcc: [0xff3b5c, 0x3fa7ff, 0x2fbf71, 0xffc233, 0xff7ac6],
    hotel: [0xf6e0c8, 0xf8d0d8, 0xd8f0e8, 0xfff0c0, 0xd8e0f8],
    crystal: [0x9ff0ff, 0xffb0e8, 0xb0c0ff, 0xc0ffe8]
  };
  const SETS = {}; // prototype pick lists, filled after the prototypes are built

  // ================================================================== PROTOTYPES
  // Conventions: origin at the ground centre of the footprint, +y up. Buildings face +x (toward the track
  // when placed on the left, x < 0); right-side instances use ry = PI. Details on both z faces (the +z face
  // is the one the runner sees while approaching, and ry = PI swaps the z faces).
  const DARK_METAL = 0x2e2838, TRIM = 0xf4ead8, GLASS = 0x6f78b8, GLASS2 = 0x8a86c8, WARM = 0xffcf8a, WARM2 = 0xffe2a8;
  // window on a face: nx/nz outward normal, plane = face coordinate, a = along coordinate
  function win(k, nx, nz, plane, a, y, w, h, lit, fr, gl, lc) {
    k.L();
    if (nx) { k.box(fr, 0.1, h + 0.26, w + 0.26, plane + nx * 0.05, y, a); k.box(fr, 0.28, 0.1, w + 0.44, plane + nx * 0.14, y - h / 2 - 0.18, a); }
    else { k.box(fr, w + 0.26, h + 0.26, 0.1, a, y, plane + nz * 0.05); k.box(fr, w + 0.44, 0.1, 0.28, a, y - h / 2 - 0.18, plane + nz * 0.14); }
    k.E(lit ? 1.45 : 1);
    const gc = lit ? (lc || WARM) : (gl || GLASS);
    if (nx) k.box(gc, 0.16, h, w, plane + nx * 0.08, y, a); else k.box(gc, w, h, 0.16, a, y, plane + nz * 0.08);
    k.L();
    if (nx) k.box(fr, 0.08, h, 0.07, plane + nx * 0.2, y, a); else k.box(fr, 0.07, h, 0.08, a, y, plane + nz * 0.2);
  }
  function rowWindows(k, face, W, D, y, n, w, h, litP, fr, gl, skipFn) {
    for (let i = 0; i < n; i++) {
      const a = -W / 2 + (W / n) * (i + 0.5);
      if (skipFn && skipFn(a)) continue;
      const lit = rc(litP), lc = rc(0.5) ? WARM : WARM2;
      if (face === 'x') win(k, 1, 0, D / 2, a, y, w, h, lit, fr, gl, lc);
      else if (face === 'z+') win(k, 0, 1, W / 2, (a / W) * D, y, w, h, lit, fr, gl, lc);
      else win(k, 0, -1, -W / 2, (a / W) * D, y, w, h, lit, fr, gl, lc);
    }
  }
  function sideWindows(k, W, D, y, n, w, h, litP, fr, gl) {
    for (let i = 0; i < n; i++) {
      const a = -D / 2 + (D / n) * (i + 0.5);
      win(k, 0, 1, W / 2, a, y, w, h, rc(litP), fr, gl, rc(0.5) ? WARM : WARM2);
      win(k, 0, -1, -W / 2, a, y, w, h, rc(litP), fr, gl, rc(0.5) ? WARM : WARM2);
    }
  }
  function awning(k, D, a0, a1, y, out, drop, c1, c2, n) {
    const L = Math.sqrt(out * out + drop * drop), ang = -Math.atan2(drop, out), sw = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const c = i & 1 ? c2 : c1, a = a0 + sw * (i + 0.5);
      k.box(c, L, 0.08, sw, D / 2 + out / 2, y - drop / 2, a, 0, 0, ang);
      k.box(c, 0.06, 0.38, sw, D / 2 + out + 0.02, y - drop - 0.16, a);
    }
    k.box(DARK_METAL, 0.1, 0.1, a1 - a0, D / 2 + 0.05, y + 0.04, (a0 + a1) / 2);
  }
  function shopfront(k, D, a0, a1, glowC) {
    const w = a1 - a0, c = (a0 + a1) / 2;
    k.L().box(0x3b2f45, 0.14, 2.9, w + 0.3, D / 2 + 0.07, 1.55, c);
    k.E(1.45).box(glowC || WARM2, 0.2, 2.2, w - 0.3, D / 2 + 0.1, 1.55, c).L();
    const nm = Math.max(1, Math.round(w / 1.8));
    for (let i = 1; i < nm; i++) k.box(0x3b2f45, 0.26, 2.2, 0.09, D / 2 + 0.13, 1.55, a0 + (w / nm) * i);
    k.box(0x6b5570, 0.3, 0.45, w + 0.3, D / 2 + 0.15, 0.22, c);
  }
  function door(k, D, a, dark) {
    k.L().box(0x3b2f45, 0.12, 2.6, 1.5, D / 2 + 0.06, 1.3, a);
    k.box(dark || 0x7a4a3a, 0.18, 2.35, 1.2, D / 2 + 0.09, 1.2, a);
    k.E(1.45).box(WARM, 0.24, 0.8, 0.8, D / 2 + 0.12, 1.75, a).L();
  }
  function waterTank(k, x, y, z, s) {
    s = s || 1;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0x4a3a36, 0.14 * s, 1.6 * s, 0.14 * s, x + dx * 0.9 * s, y + 0.8 * s, z + dz * 0.9 * s);
    k.cylB(0x9a6a48, 1.35 * s, 1.35 * s, 2.4 * s, 12, x, y + 1.5 * s, z);
    for (let i = 0; i < 3; i++) k.cyl(0x3e3036, 1.39 * s, 1.39 * s, 0.1 * s, 12, x, y + (1.9 + i * 0.75) * s, z);
    k.coneB(0x6e4c3c, 1.55 * s, 1.0 * s, 12, x, y + 3.9 * s, z);
  }
  function acUnit(k, x, y, z, s) {
    s = s || 1;
    k.boxB(0xb8b4c4, 1.6 * s, 0.9 * s, 1.1 * s, x, y, z);
    k.cyl(0x5a566a, 0.36 * s, 0.36 * s, 0.08 * s, 10, x, y + 0.92 * s, z);
    k.box(0x8a8698, 0.2 * s, 0.4 * s, 0.6 * s, x - 0.9 * s, y + 0.3 * s, z);
  }
  function fireEscape(k, D, a0, a1, floors) {
    const x0 = D / 2, dep = 1.25, w = a1 - a0, c = (a0 + a1) / 2;
    for (let i = 0; i < floors.length; i++) {
      const y = floors[i];
      k.box(DARK_METAL, dep, 0.08, w, x0 + dep / 2, y, c);
      k.box(DARK_METAL, 0.06, 0.06, w, x0 + dep - 0.03, y + 0.95, c);
      k.box(DARK_METAL, dep, 0.06, 0.06, x0 + dep / 2, y + 0.95, a0 + 0.03); k.box(DARK_METAL, dep, 0.06, 0.06, x0 + dep / 2, y + 0.95, a1 - 0.03);
      for (let j = 0; j <= 4; j++) k.box(DARK_METAL, 0.05, 0.95, 0.05, x0 + dep - 0.03, y + 0.47, a0 + 0.05 + (w - 0.1) * j / 4);
      if (i > 0) { const yp = floors[i - 1]; k.beam(DARK_METAL, x0 + dep * 0.5, yp + 0.05, i & 1 ? a0 + 0.4 : a1 - 0.4, x0 + dep * 0.5, y, i & 1 ? a1 - 1.4 : a0 + 1.4, 0.55, 0.08); }
    }
    k.beam(DARK_METAL, x0 + dep * 0.5, floors[0] - 2.4, a1 - 0.5, x0 + dep * 0.5, floors[0], a1 - 0.5, 0.45, 0.06);
  }
  function balcony(k, D, a, y, w, potC) {
    k.box(TRIM, 1.1, 0.16, w, D / 2 + 0.55, y, a);
    k.box(0xe8e2f0, 0.06, 0.9, w, D / 2 + 1.07, y + 0.5, a);
    k.box(DARK_METAL, 0.08, 0.08, w + 0.04, D / 2 + 1.07, y + 0.98, a);
    k.boxB(0xb86a4a, 0.4, 0.35, 0.4, D / 2 + 0.5, y + 0.08, a - w / 2 + 0.4);
    k.T(1).ico(potC || 0x6fae4a, 0.35, D / 2 + 0.5, y + 0.62, a - w / 2 + 0.4, 1, 0.9, 1, 0).T(0);
  }
  // Generic city block: floors = heights; o.front: 'shop' | 'plain'; o.fe: fire escape; o.balc: balconies; o.roof: [...]
  function cityBlock(k, o) {
    const W = o.W, D = o.D, fl = o.floors;
    let H = 0; const ys = []; for (const h of fl) { ys.push(H); H += h; }
    // body (tinted) + trims
    k.T(1).boxB(0xf2ede6, D, H + 0.5, W, 0, -0.5, 0).T(0);
    for (let i = 1; i < fl.length; i++) k.box(TRIM, D + 0.16, 0.18, W + 0.16, 0, ys[i] - 0.05, 0);
    k.boxB(TRIM, D + 0.5, 0.35, W + 0.5, 0, H, 0);
    k.T(1).boxB(0xf2ede6, D + 0.1, 0.7, W + 0.1, 0, H + 0.35, 0).T(0);
    k.boxB(o.cap || 0xd8cfc0, D + 0.3, 0.14, W + 0.3, 0, H + 1.05, 0);
    k.boxB(0x7a7486, D - 0.4, 0.06, W - 0.4, 0, H + 0.36, 0); // roof surface
    // ground floor front
    if (o.front === 'shop') {
      const a0 = -W / 2 + 0.7, a1 = W / 2 - 2.4;
      shopfront(k, D, a0, a1, o.shopGlow);
      door(k, D, W / 2 - 1.4);
      awning(k, D, a0 - 0.2, a1 + 0.2, 3.7, 1.6, 0.65, o.aw1 || 0xe8453c, o.aw2 || 0xfff4ea, 8);
      k.box(0x2b2440, 0.16, 1.0, (a1 - a0) * 0.72, D / 2 + 0.1, 4.45, (a0 + a1) / 2); // sign backing (text quad is an instance)
    } else {
      door(k, D, 0, 0x4a5a8a);
      rowWindows(k, 'x', W, D, 1.9, 4, 1.2, 1.7, 0.3, TRIM, GLASS, (a) => Math.abs(a) < 1.3);
    }
    // upper floors
    for (let i = 1; i < fl.length; i++) {
      const yc = ys[i] + fl[i] * 0.5 + 0.05;
      const n = Math.max(2, Math.round(W / 3));
      rowWindows(k, 'x', W, D, yc, n, 1.25, 1.75, o.lit || 0.35, TRIM, i % 2 ? GLASS : GLASS2, o.fe ? (a) => a < -W / 2 + 4.2 && false : null);
      if (o.sideWin !== false) sideWindows(k, W, D, yc, Math.max(1, Math.round(D / 3.4)), 1.1, 1.6, o.lit || 0.35, TRIM, GLASS);
      if (o.balc && i >= 1) { balcony(k, D, -W / 4, ys[i] + 0.06, 3.0, rp(PAL.cityTree)); balcony(k, D, W / 4, ys[i] + 0.06, 3.0, rp(PAL.cityTree)); }
    }
    if (o.fe) fireEscape(k, D, -W / 2 + 0.6, -W / 2 + 4.6, ys.slice(1).map((y) => y + 0.05));
    // ground-floor side windows
    if (o.sideWin !== false) { win(k, 0, 1, W / 2, D / 4, 2.0, 1.3, 1.6, rc(0.5), TRIM, GLASS, WARM); win(k, 0, -1, -W / 2, D / 4, 2.0, 1.3, 1.6, rc(0.5), TRIM, GLASS, WARM); }
    // roof clutter
    const R0 = H + 0.42;
    (o.roof || []).forEach((r) => {
      if (r[0] === 'tank') waterTank(k, r[1], R0, r[2], r[3]);
      else if (r[0] === 'ac') acUnit(k, r[1], R0, r[2], r[3]);
      else if (r[0] === 'hut') { k.boxB(0xd8d0c8, 2.4, 2.2, 2.6, r[1], R0, r[2]); k.boxB(0x8a8296, 2.7, 0.2, 2.9, r[1], R0 + 2.2, r[2]); k.box(0x5a4a60, 0.1, 1.9, 0.9, r[1] + 1.21, R0 + 0.95, r[2]); }
      else if (r[0] === 'ant') { k.cylB(0x6a6478, 0.05, 0.08, 4.5, 5, r[1], R0, r[2]); k.E(2).P(-1).sph(0xff3344, 0.14, 0.14, 0.14, r[1], R0 + 4.55, r[2], 6, 4).P(0).L(); }
    });
    return { W, D, H: H + 1.2, sign: o.front === 'shop' ? { x: D / 2 + 0.2, y: 4.45, w: (W - 3.1) * 0.66, h: 0.86, z: (-W / 2 + 0.7 + W / 2 - 2.4) / 2 } : null };
  }

  function buildCityProtos() {
    kitProto('cShop2', 90, (k) => cityBlock(k, { W: 10, D: 9, floors: [4.3, 3.4], front: 'shop', aw1: 0xe8453c, roof: [['ac', -1.5, 2], ['ac', 1.4, -2.5, 0.8]], lit: 0.4 }));
    kitProto('cShop3', 90, (k) => cityBlock(k, { W: 12, D: 10, floors: [4.3, 3.3, 3.3], front: 'shop', aw1: 0x2f7fd8, aw2: 0xffffff, fe: true, roof: [['tank', -1.6, 2.2, 0.9], ['ac', 2, -3]], lit: 0.35 }));
    kitProto('cShop4', 70, (k) => cityBlock(k, { W: 13, D: 11, floors: [4.3, 3.3, 3.3, 3.3], front: 'shop', aw1: 0x2ea86b, aw2: 0xfff4ea, balc: true, roof: [['ac', -2, 3], ['ac', 1.5, 3.2], ['hut', 0, -3], ['ant', 3, -4]], lit: 0.3 }));
    kitProto('cFlat3', 70, (k) => cityBlock(k, { W: 11, D: 10, floors: [3.6, 3.3, 3.3], front: 'plain', balc: true, roof: [['tank', 1.5, -2, 0.85]], lit: 0.4 }));
    // diner: 1 storey, chrome bands, big glowing windows, roof sign frame
    kitProto('cDiner', 50, (k) => {
      const W = 13, D = 7.5;
      k.T(1).boxB(0xf6f0ea, D, 3.6, W, 0, -0.4, 0).T(0);
      k.cylB(0xf6f0ea, D / 2, D / 2, 4.0, 14, 0, -0.4, W / 2); k.cylB(0xf6f0ea, D / 2, D / 2, 4.0, 14, 0, -0.4, -W / 2);
      k.box(0xd9dde8, D + 0.2, 0.35, W, 0, 1.05, 0); k.box(0xe8453c, D + 0.22, 0.14, W, 0, 1.32, 0);
      k.cyl(0xd9dde8, D / 2 + 0.1, D / 2 + 0.1, 0.35, 14, 0, 1.05, W / 2); k.cyl(0xd9dde8, D / 2 + 0.1, D / 2 + 0.1, 0.35, 14, 0, 1.05, -W / 2);
      k.E(1.45).box(WARM2, 0.2, 1.5, W - 3.4, D / 2 + 0.02, 2.25, -0.4).L();
      for (let i = 0; i < 6; i++) k.box(0xc8ccd8, 0.28, 1.5, 0.1, D / 2 + 0.06, 2.25, -W / 2 + 1.3 + i * 1.9);
      door(k, D, W / 2 - 1.3, 0xe8453c);
      k.boxB(0xb8bcc8, D + 0.8, 0.3, W + D + 0.6, 0, 3.6, 0);
      k.box(0x3a3348, 0.3, 1.6, 6.2, 0.6, 4.95, 0); k.box(0x9a96a8, 0.14, 0.8, 0.14, 0.6, 4.0, -2.4); k.box(0x9a96a8, 0.14, 0.8, 0.14, 0.6, 4.0, 2.4);
      k.E(2).box(0xff5fa2, 0.34, 0.1, 6.4, 0.6, 5.8, 0).box(0xff5fa2, 0.34, 0.1, 6.4, 0.6, 4.1, 0).L();
      acUnit(k, -1.8, 3.9, -4, 0.9);
      return { W: 13 + 7.5, D: 7.5, H: 6, sign: { x: 0.77, y: 4.95, w: 5.6, h: 1.4, z: 0 } };
    });
    // street tree (canopy tinted: greens or blossom)
    kitProto('cTree', 400, (k) => {
      k.cylB(0x7a5a48, 0.16, 0.24, 2.6, 6, 0, 0, 0);
      k.S(0.12).T(1);
      k.ico(0xffffff, 1.55, 0, 3.6, 0, 1, 0.95, 1, 1);
      k.ico(0xf0f0f0, 1.05, 0.8, 3.1, 0.5, 1, 0.9, 1, 0);
      k.ico(0xe8e8e8, 1.0, -0.7, 3.3, -0.6, 1, 0.9, 1, 0);
      k.ico(0xf8f8f8, 0.9, 0.1, 4.6, -0.2, 1, 0.9, 1, 0);
      k.L().S(0);
      k.cylB(0x6a6a72, 0.75, 0.75, 0.25, 10, 0, 0, 0);
    });
    kitProto('cTreeS', 300, (k) => {
      k.cylB(0x7a5a48, 0.12, 0.18, 2.4, 6, 0, 0, 0);
      k.S(0.1).T(1);
      k.ico(0xffffff, 1.05, 0, 3.3, 0, 1, 1.1, 1, 1);
      k.ico(0xf0f0f0, 0.7, 0.35, 4.1, 0.2, 1, 1, 1, 0);
      k.ico(0xe8e8e8, 0.7, -0.35, 2.9, -0.3, 1, 0.9, 1, 0);
      k.L().S(0);
      k.cylB(0x6a6a72, 0.55, 0.55, 0.2, 8, 0, 0, 0);
    });
    kitProto('cLamp', 260, (k) => {
      k.cylO(0x3e3a52, 0.2, 0.26, 0.5, 6, 0, 0, 0);
      k.cylO(0x3e3a52, 0.07, 0.1, 4.6, 5, 0, 0.4, 0);
      k.box(0x3e3a52, 0.1, 0.1, 1.6, 0, 4.9, 0);
      for (const s of [-1, 1]) {
        k.cylO(0x3e3a52, 0.05, 0.05, 0.3, 4, 0, 4.9, s * 0.78);
        k.E(2).sph(0xffe3a0, 0.24, 0.3, 0.24, 0, 4.72, s * 0.78, 6, 4).L();
        k.coneO(0x3e3a52, 0.3, 0.25, 6, 0, 4.98, s * 0.78);
      }
      k.sph(0x3e3a52, 0.12, 0.12, 0.12, 0, 5.1, 0, 5, 3);
    }, { r: 0.4 });
    kitProto('cTraffic', 60, (k) => {
      k.cylB(0x4a4658, 0.12, 0.14, 5.4, 8, 0, 0, 0);
      k.beam(0x4a4658, 0, 5.1, 0, 4.2, 5.1, 0, 0.14, 0.14);
      for (const [x, y] of [[3.0, 4.55], [0.28, 2.8]]) {
        k.boxB(0x2a2632, 0.45, 1.25, 0.45, x, y, 0);
        k.E(2).sph(0xff3b3b, 0.13, 0.13, 0.06, x, y + 1.0, 0.24, 6, 4);
        k.E(1).sph(0x5a4a2a, 0.13, 0.13, 0.06, x, y + 0.62, 0.24, 6, 4);
        k.E(1).sph(0x2a4a3a, 0.13, 0.13, 0.06, x, y + 0.24, 0.24, 6, 4).L();
      }
      k.boxB(0x2a2632, 0.35, 0.5, 0.3, 0.3, 2.0, 0.15);
    }, { r: 0.4 });
    kitProto('cCar', 180, (k) => {
      k.T(1).boxB(0xffffff, 4.3, 0.72, 1.86, 0, 0.32, 0);
      k.boxB(0xffffff, 2.3, 0.62, 1.7, -0.25, 1.04, 0).T(0);
      k.E(1).boxB(0x3a4470, 2.1, 0.5, 1.74, -0.25, 1.08, 0).boxB(0x4a5490, 0.1, 0.46, 1.5, 0.93, 1.08, 0).L();
      k.box(0xd8d8e0, 0.2, 0.2, 1.9, 2.15, 0.45, 0); k.box(0xd8d8e0, 0.2, 0.2, 1.9, -2.15, 0.45, 0);
      for (const [x, z] of [[1.35, 0.9], [-1.35, 0.9], [1.35, -0.9], [-1.35, -0.9]]) { k.cyl(0x26222e, 0.36, 0.36, 0.26, 8, x, 0.36, z, Math.PI / 2); k.cyl(0xc8c8d0, 0.18, 0.18, 0.28, 6, x, 0.36, z, Math.PI / 2); }
      k.E(2).box(0xfff4d8, 0.08, 0.16, 0.36, 2.16, 0.72, 0.62).box(0xfff4d8, 0.08, 0.16, 0.36, 2.16, 0.72, -0.62);
      k.box(0xff2a3a, 0.08, 0.16, 0.36, -2.16, 0.72, 0.62).box(0xff2a3a, 0.08, 0.16, 0.36, -2.16, 0.72, -0.62).L();
    }, { r: 2.2, aoH: 0.5, pinned: true });
    kitProto('cBus', 40, (k) => {
      k.boxB(0x4a4658, 0.12, 2.6, 0.12, -0.8, 0, -2.2); k.boxB(0x4a4658, 0.12, 2.6, 0.12, -0.8, 0, 2.2);
      k.boxB(0x4a4658, 0.12, 2.6, 0.12, 0.7, 0, -2.2); k.boxB(0x4a4658, 0.12, 2.6, 0.12, 0.7, 0, 2.2);
      k.T(1).boxB(0xffffff, 1.9, 0.16, 4.9, 0, 2.6, 0).T(0);
      k.E(1).boxB(0xbfe2f0, 0.06, 1.9, 4.3, -0.8, 0.4, 0).L();
      k.E(1.6).boxB(0xfff0f8, 0.1, 1.7, 1.2, -0.8, 0.5, 1.5).L();
      k.boxB(0x8a5a48, 0.5, 0.08, 3, -0.45, 0.5, -0.4); k.boxB(0x4a4658, 0.08, 0.5, 3, -0.2, 0.0, -0.4);
      k.cylB(0x4a4658, 0.05, 0.05, 2.6, 5, 0.8, 0, -3.0); k.T(1).boxB(0xffffff, 0.06, 0.6, 0.6, 0.8, 2.6, -3.0).T(0);
    }, { r: 2.6 });
    kitProto('cBench', 160, (k) => {
      k.boxB(0x8a5a48, 0.6, 0.1, 2.2, 0, 0.45, 0); k.box(0x8a5a48, 0.1, 0.5, 2.2, -0.3, 0.8, 0, 0, 0, -0.15);
      k.boxB(0x3e3a52, 0.5, 0.45, 0.1, 0, 0, -0.95); k.boxB(0x3e3a52, 0.5, 0.45, 0.1, 0, 0, 0.95);
      k.cylB(0x3e8a5a, 0.3, 0.26, 0.9, 8, 0.1, 0, 1.8); k.cylB(0x2e6a44, 0.32, 0.32, 0.08, 8, 0.1, 0.9, 1.8);
      k.cylB(0xe8453c, 0.14, 0.17, 0.6, 7, 0.2, 0, -1.9); k.sph(0xe8453c, 0.15, 0.12, 0.15, 0.2, 0.62, -1.9, 7, 4); k.cyl(0xd0c8c0, 0.06, 0.06, 0.34, 5, 0.2, 0.42, -1.9, Math.PI / 2);
    }, { r: 1.9 });
    kitProto('cHedge', 260, (k) => {
      k.boxB(0x8a7a70, 3.2, 0.5, 1.2, 0, 0, 0);
      k.T(1); for (let i = 0; i < 4; i++) k.ico(0xffffff, 0.62, -1.15 + i * 0.77, 0.85, 0, 1, 0.8, 1.1, 0); k.T(0);
      k.E(2).T(1).sph(0xffd6e8, 0.12, 0.12, 0.12, -0.8, 1.35, 0.35, 5, 4).sph(0xffd6e8, 0.12, 0.12, 0.12, 0.6, 1.3, -0.4, 5, 4).L();
    }, { r: 1.6 });
    kitProto('cBoard', 60, (k) => {
      const w = 9, h = 4.6, y0 = 5.2;
      k.boxB(0x5a5468, 0.5, y0, 0.5, 0, 0, -2.6); k.boxB(0x5a5468, 0.5, y0, 0.5, 0, 0, 2.6);
      k.box(0x3a3448, 0.3, h + 0.5, w + 0.5, -0.05, y0 + h / 2, 0);
      k.box(0x5a5468, 1.1, 0.1, w, 0.55, y0 - 0.05, 0); k.box(0x5a5468, 0.05, 0.6, w, 1.08, y0 + 0.25, 0);
      for (const z of [-3, 0, 3]) { k.beam(0x5a5468, 1.0, y0 + 0.1, z, 0.7, y0 + 0.9, z, 0.06, 0.06); k.E(2).sph(0xfff4d8, 0.2, 0.12, 0.3, 0.7, y0 + 0.9, z, 6, 4).L(); }
    }, { r: 4.8 });
    kitProto('cWall', 90, (k) => {
      k.boxB(0xb9b3bd, 0.5, 3.4, 12, 0, -0.3, 0);
      k.boxB(0x8a8494, 0.7, 0.2, 12.2, 0, 3.1, 0);
      for (const z of [-6, 6]) k.boxB(0x9a94a4, 0.8, 3.6, 0.5, 0, -0.3, z);
    }, { r: 6.1 });
    kitProto('cKiosk', 60, (k) => {
      k.T(1).boxB(0xffffff, 2.4, 2.5, 2.8, 0, 0, 0).T(0);
      k.E(1.45).boxB(WARM2, 0.12, 1.0, 2.2, 1.2, 1.1, 0).L();
      k.box(0xe8453c, 1.2, 0.08, 3.0, 1.6, 2.45, 0, 0, 0, -0.3);
      k.boxB(0x3a3448, 2.8, 0.2, 3.1, 0, 2.5, 0);
      k.boxB(0xd8d0c0, 0.5, 0.9, 2.2, 1.45, 0, 0);
    }, { r: 1.8 });
    // unit-box facade (towers / mid-rise): window grid comes from the facade shader
    kitProto('cFacade', 420, (k) => { k.T(1).boxB(0xffffff, 1, 1, 1, 0, 0, 0); }, { mat: M.facade, win: true, ao: false, r: 0.71 });
    kitProto('cRoof', 300, (k) => { // rooftop clutter for towers (fixed size)
      acUnit(k, -2, 0, -2); acUnit(k, 1.5, 0, 2.2, 0.8);
      k.boxB(0x8a8296, 2.2, 2.0, 2.4, 2.2, 0, -1.6); k.boxB(0x6a6478, 2.5, 0.2, 2.7, 2.2, 2.0, -1.6);
      k.cylB(0x6a6478, 0.06, 0.1, 6, 5, -2.5, 0, 2.5); k.E(2).P(-1).sph(0xff3344, 0.18, 0.18, 0.18, -2.5, 6.1, 2.5, 6, 4).P(0).L();
    }, { r: 3.5 });
    kitProto('cRoofTank', 200, (k) => { waterTank(k, 0, 0, 0, 1.1); acUnit(k, 2.6, 0, 1.2, 0.9); }, { r: 2.8 });
  }

  // ================================================================== TUNNEL
  // Interior: walls at |x| = 7.6 up to y = 10.5, elliptical ceiling to y = 14 (clear: |x| <= 7 below 11.8).
  const T_WX = 7.6, T_WY = 10.5, T_CR = 3.5, T_SEG = 6, T_NSEG = (2 * TUN) / T_SEG; // 20 segments
  const arcPt = (a, b, th) => [a * Math.cos(th), T_WY + b * Math.sin(th)];
  const RAINBOW = [0xff4d6d, 0xff9f43, 0xffe14d, 0x5ee07a, 0x39c6ff, 0x5b7cff, 0xb36bff];
  function tunnelOutline() { // hill cross-section (x from -MOUND_W to MOUND_W)
    const pts = [];
    for (let i = 0; i <= 22; i++) { const x = -MOUND_W + (2 * MOUND_W * i) / 22, t = Math.abs(x) / MOUND_W; pts.push([x, -3 + 25 * Math.pow(Math.max(0, 1 - t * t), 0.85)]); }
    return pts;
  }
  const moundY = (x) => { const t = Math.abs(x) / MOUND_W; return -3 + 25 * Math.pow(Math.max(0, 1 - t * t), 0.85); };
  // Lofted hill: low at the portal plane (hidden behind the facade), full outline from 24 m in.
  const HILL_FRONT_H = 19.2;
  const hillFrontY = (x, y) => (Math.abs(x) <= 22.5 ? Math.min(y, HILL_FRONT_H) : Math.min(y, Math.max(-3, HILL_FRONT_H - (Math.abs(x) - 22.5) * 6)));
  const HILL_ROWS = [[0, 0], [-9, 0.5], [-24, 1], [-TUN, 1]];
  const hillRowY = (x, y, t) => hillFrontY(x, y) + (y - hillFrontY(x, y)) * t;
  let HILL_OUT = null;
  // Surface height of the hill at x, zl (zl <= 0: metres behind the portal plane), matching the built mesh.
  function hillY(x, zl) {
    const out = HILL_OUT || (HILL_OUT = tunnelOutline());
    let i = 0; while (i < out.length - 2 && out[i + 1][0] < x) i++;
    const [x0, y0] = out[i], [x1, y1] = out[i + 1], f = clamp((x - x0) / (x1 - x0), 0, 1);
    let r = 0; while (r < HILL_ROWS.length - 2 && HILL_ROWS[r + 1][0] > zl) r++;
    const [za, ta] = HILL_ROWS[r], [zb, tb] = HILL_ROWS[r + 1], g = clamp((zl - za) / (zb - za), 0, 1);
    const ya = hillRowY(x0, y0, ta) + (hillRowY(x1, y1, ta) - hillRowY(x0, y0, ta)) * f;
    const yb = hillRowY(x0, y0, tb) + (hillRowY(x1, y1, tb) - hillRowY(x0, y0, tb)) * f;
    return ya + (yb - ya) * g;
  }
  function openingPath(path, wx, wy, cr, yb) { // tunnel opening outline (counter-clockwise), used as a shape hole
    path.moveTo(-wx, yb); path.lineTo(wx, yb); path.lineTo(wx, wy);
    for (let i = 1; i <= 12; i++) { const p = arcPt(wx, cr, (i / 12) * Math.PI / 2); path.lineTo(p[0], p[1]); }
    for (let i = 11; i >= 0; i--) { const p = arcPt(wx, cr, (i / 12) * Math.PI / 2); path.lineTo(-p[0], p[1]); }
    path.lineTo(-wx, yb);
  }
  // Half width of the portal opening at height y (0 above the crown).
  function openHalf(y) { if (y <= T_WY) return T_WX; const t = (y - T_WY) / T_CR; return t >= 1 ? 0 : T_WX * Math.sqrt(1 - t * t); }
  // Horizontal band across a portal face, split around the opening. y0 = bottom, h = height.
  function across(k, c, y0, h, z, d, half) {
    const xo = Math.max(openHalf(y0), openHalf(y0 + h)) + 0.25;
    if (xo <= 0.25 && y0 >= T_WY + T_CR) { k.boxB(c, 2 * half, h, d, 0, y0, z); return; }
    const w = half - xo; if (w <= 0) return;
    k.boxB(c, w, h, d, -(xo + w / 2), y0, z); k.boxB(c, w, h, d, xo + w / 2, y0, z);
  }
  function buildTunnelProtos() {
    kitProto('tSeg', 44, (k) => {
      const hz = T_SEG / 2;
      k.E(1);
      for (const s of [-1, 1]) {
        k.boxB(0x1d1832, 1.8, 10.8, T_SEG, s * (T_WX + 0.9), -0.3, 0);
        for (let i = 0; i < 8; i++) {
          const a = arcPt(T_WX + 0.6, T_CR + 0.6, (i / 8) * Math.PI / 2), b = arcPt(T_WX + 0.6, T_CR + 0.6, ((i + 1) / 8) * Math.PI / 2);
          k.beam(i & 1 ? 0x221c3c : 0x1f1936, s * a[0], a[1], 0, s * b[0], b[1], 0, T_SEG, 1.25);
        }
        k.box(0x2a2446, 0.26, 0.3, T_SEG, s * (T_WX - 0.12), 5.6, 0); // cable tray
        k.box(0x2a2446, 0.26, 0.3, T_SEG, s * (T_WX - 0.12), 6.2, 0);
        k.box(0x15122a, 0.12, 10.4, 0.5, s * (T_WX - 0.05), 5.3, -hz + 0.3); // panel seam rib
      }
      // rainbow light bands (pulse flows toward +z)
      k.E(2).P(0.55);
      for (const s of [-1, 1]) RAINBOW.forEach((c, i) => k.box(c, 0.08, 0.17, T_SEG, s * (T_WX - 0.04), 1.3 + i * 0.3, 0));
      k.box(0xfff0ff, 0.6, 0.08, T_SEG, 0, T_WY + T_CR - 0.05, 0);
      k.P(0);
      // ring light (tinted per instance)
      k.T(1);
      for (const s of [-1, 1]) {
        k.box(0xffffff, 0.14, T_WY - 0.2, 0.3, s * (T_WX - 0.1), T_WY / 2 + 0.15, hz - 0.2);
        for (let i = 0; i < 8; i++) {
          const a = arcPt(T_WX - 0.1, T_CR - 0.1, (i / 8) * Math.PI / 2), b = arcPt(T_WX - 0.1, T_CR - 0.1, ((i + 1) / 8) * Math.PI / 2);
          k.beam(0xffffff, s * a[0], a[1], hz - 0.2, s * b[0], b[1], hz - 0.2, 0.3, 0.14);
        }
      }
      k.L();
    }, { ao: false, span: true });
    ['city', 'beach', 'candy', 'neon', 'snow'].forEach((kind) => kitProto('tPortal_' + kind, 3, (k) => buildPortal(k, kind), { ao: false, span: true }));
    kitProto('tSignFrame', 6, (k) => {
      k.box(0x2a2140, 14.4, 3.0, 0.5, 0, 0, -0.3);
      for (const x of [-5.5, 5.5]) k.box(0x3a3150, 0.3, 0.3, 1.9, x, 0, -1.3);
      k.E(2).T(1).box(0xffffff, 14.8, 0.18, 0.3, 0, 1.55, -0.1).box(0xffffff, 14.8, 0.18, 0.3, 0, -1.55, -0.1).L();
    }, { ao: false });
  }
  // Portal + half hill. Local: portal plane at z = 0 facing +z, hill from z = 0 to z = -TUN.
  function buildPortal(k, kind) {
    const S = {
      city: { face: 0xb65a4a, trim: 0xeadcc4, top: 0x6fa044, side: 0x9a6a50, cap: 0xa85a48 },
      beach: { face: 0xc98e5c, trim: 0x8a5a3a, top: 0x6ea452, side: 0xc58e5c, cap: 0xb88050 },
      candy: { face: 0xe8b878, trim: 0xff8ac0, top: 0xff9ccf, side: 0xd986b3, cap: 0xe8a0c8 },
      neon: { face: 0x1c1638, trim: 0x2e2658, top: 0x221750, side: 0x1a1240, cap: 0x201a44 },
      snow: { face: 0xbfe0f4, trim: 0xe8f6ff, top: 0xf2f7ff, side: 0x9fb2cc, cap: 0xa8bcd6 }
    }[kind];
    // hill: lofted surface that rises from the facade top (z = 0) to the full outline (z <= -24), plus a small
    // front cap (with the tube hole) that stays hidden behind the facade
    const out = tunnelOutline();
    const frontY = hillFrontY, rows = HILL_ROWS, rowY = hillRowY;
    const pos = [];
    for (let r = 0; r < rows.length - 1; r++) {
      const [za, ta] = rows[r], [zb, tb] = rows[r + 1];
      for (let i = 0; i < out.length - 1; i++) {
        const [x0, y0] = out[i], [x1, y1] = out[i + 1];
        const a0 = rowY(x0, y0, ta), a1 = rowY(x1, y1, ta), b0 = rowY(x0, y0, tb), b1 = rowY(x1, y1, tb);
        pos.push(x0, a0, za, x1, a1, za, x1, b1, zb, x0, a0, za, x1, b1, zb, x0, b0, zb);
      }
    }
    const hill = new THREE.BufferGeometry(); hill.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const topC = S.top, sideC = S.side;
    k.geo(hill, (x, y, z, c) => {
      const t = sstep(1, 7, y + (Math.sin(x * 0.4 + z * 0.3) * 1.2));
      c.set(sideC).lerp(_tc2.set(topC), t);
      if (kind === 'candy') { const b = ((Math.floor((y + 3) / 1.6) % 4) + 4) % 4; if (y < 6) c.set([0xd4a060, 0xf0e2c8, 0xc0466f, 0x7a4428][b]); }
      if (kind === 'neon') { const g = Math.abs(((z % 6) + 6) % 6 - 3) < 0.25 || Math.abs(((x % 6) + 6) % 6 - 3) < 0.25; if (g) c.set(0x5a2a9a); }
      if (kind === 'snow' && y > 4) c.set(0xf4f8ff);
    });
    const shape = new THREE.Shape();
    shape.moveTo(out[0][0], frontY(out[0][0], out[0][1])); for (let i = 1; i < out.length; i++) shape.lineTo(out[i][0], frontY(out[i][0], out[i][1])); shape.lineTo(out[0][0], frontY(out[0][0], out[0][1]));
    const hole = new THREE.Path(); openingPath(hole, T_WX + 2.0, T_WY, T_CR + 1.6, -1); shape.holes.push(hole);
    k.geo(new THREE.ShapeGeometry(shape, 1), S.cap, [0, 0, -0.9]);
    // facade slab with the exact opening (extruded, hole walls included)
    const fs = new THREE.Shape();
    fs.moveTo(-22, -0.6); fs.lineTo(22, -0.6); fs.lineTo(22, 19.6); fs.lineTo(-22, 19.6); fs.lineTo(-22, -0.6);
    const fh = new THREE.Path(); openingPath(fh, T_WX, T_WY, T_CR, -0.6); fs.holes.push(fh);
    const fg = new THREE.ExtrudeGeometry(fs, { depth: 1.6, bevelEnabled: false, curveSegments: 1 });
    fg.translate(0, 0, -1.0);
    k.geo(fg, S.face);
    // arch voussoirs around the opening
    const ring = (c1, c2, off, dz, th, n) => {
      for (let i = 0; i < n; i++) {
        const a = arcPt(T_WX + off, T_CR + off, (i / n) * Math.PI), b = arcPt(T_WX + off, T_CR + off, ((i + 1) / n) * Math.PI);
        k.beam(i & 1 ? c2 : c1, a[0], a[1], 0.6 + dz, b[0], b[1], 0.6 + dz, 0.5, th);
      }
      for (const s of [-1, 1]) k.boxB(c1, th, T_WY + 0.6, 0.5, s * (T_WX + off), -0.6, 0.6 + dz + 0.0);
    };
    if (kind === 'city') {
      ring(S.trim, 0xd8c8b0, 0.55, 0.05, 1.0, 12);
      k.box(0xf4e8d4, 1.4, 2.0, 0.8, 0, T_WY + T_CR + 1.2, 0.8); // keystone
      for (const s of [-1, 1]) { k.boxB(S.trim, 1.6, 19.6, 0.7, s * 11.2, -0.6, 0.85); k.boxB(S.trim, 1.6, 19.6, 0.7, s * 21.0, -0.6, 0.85); }
      k.boxB(S.trim, 45, 0.9, 1.4, 0, 19.2, 0.3); k.boxB(0xc86a58, 44, 1.4, 1.0, 0, 20.1, 0.1);
      for (let i = -5; i <= 5; i++) k.boxB(S.trim, 1.2, 0.8, 1.1, i * 4, 21.5, 0.1);
      across(k, 0x8a7a70, -0.6, 1.2, 0.4, 1.3, 22.5);
      for (const s of [-1, 1]) { k.box(0x3e3a52, 0.3, 0.3, 1.2, s * 11.2, 8.2, 1.5); k.E(2).sph(0xffe3a0, 0.45, 0.6, 0.45, s * 11.2, 7.6, 2.0, 8, 6).L(); k.coneB(0x3e3a52, 0.55, 0.45, 8, s * 11.2, 8.1, 2.0); }
      for (const s of [-1, 1]) for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) win(k, 0, 1, 0.6, s * (14.6 + c * 3.4), 5 + r * 4.2, 1.2, 1.9, (r + c) % 2 === 0, S.trim, GLASS, WARM);
    } else if (kind === 'beach') {
      rseed(77, 5, 1);
      for (let i = 0; i < 26; i++) {
        const th = (i / 25) * Math.PI, rad = 1.6 + rnd() * 1.4;
        const p = arcPt(T_WX + rad + 0.3, T_CR + rad + 0.3, th);
        if (Math.abs(p[0]) < 8.6 && p[1] + rad > 14.6) { k.ico(mixHex(0xc98e5c, 0x9a6a48, rnd()), 1.0, p[0], 14.9, 0.4, 1.1, 0.6, 0.8, 0, rnd(), rnd(), rnd()); continue; }
        k.ico(mixHex(0xc98e5c, 0x9a6a48, rnd()), rad, p[0], p[1], 0.9, 1.1, 0.9, 0.8, 0, rnd(), rnd(), rnd());
      }
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const rad = 1.3 + rnd() * 1.3; k.ico(mixHex(0xc98e5c, 0x8a5a3a, rnd()), rad, s * (T_WX + 0.35 + rad * 1.05), 1 + i * 2.2, 0.9, 1, 1, 0.8, 0, rnd(), rnd(), rnd()); }
      for (let i = 0; i < 14; i++) {
        const rad = 2 + rnd() * 2.2, x = (rnd() * 2 - 1) * 20;
        let y = 12 + rnd() * 8;
        if (Math.abs(x) - rad * 1.1 < 8.8) y = Math.max(y, 18.9 + rad * 0.8);
        k.ico(mixHex(0xd9a46c, 0xa87048, rnd()), rad, x, y, 0.5, 1.1, 0.8, 0.7, 0, rnd(), rnd(), rnd());
      }
      for (const s of [-1, 1]) { k.boxB(0x7a5238, 0.6, 14.8, 0.6, s * (T_WX + 0.35), -0.6, 1.2); }
      k.box(0x7a5238, 2 * T_WX + 2.2, 0.7, 0.7, 0, 14.65, 1.2);
      for (const s of [-1, 1]) { k.cylB(0x7a5238, 0.12, 0.14, 3.2, 6, s * 12.5, -0.3, 2.5); k.E(2).cone(0xffa030, 0.35, 0.9, 6, s * 12.5, 3.4, 2.5).cone(0xffe070, 0.2, 0.6, 6, s * 12.5, 3.3, 2.5).L(); }
      k.T(0).hemi(0x6ea452, 13, 3, 3, 0, 19.2, -2.5, 10, 3);
    } else if (kind === 'candy') {
      [0xd4a060, 0xf0e2c8, 0xc0466f, 0xf0e2c8, 0xd4a060].forEach((c, i) => across(k, c, 0.65 + i * 3.9, 1.1, -0.1, 1.8, 22.2));
      for (let i = 0; i < 12; i++) { const x = -20.9 + i * 3.8; if (Math.abs(x) < T_WX + 0.6) continue; k.box(0xc89858, 0.25, 19.6, 1.7, x, 9.4, -0.1); }
      k.box(0xff9ccf, 45, 1.4, 2.2, 0, 19.9, -0.1);
      for (let i = 0; i < 16; i++) { const x = -21 + i * 2.8; k.sph(0xff9ccf, 0.7, 1.1 + (i % 3) * 0.5, 0.7, x, 19.0 - (i % 3) * 0.5, 0.9, 6, 5); }
      ring(0xff8ac0, 0xffffff, 0.55, 0.05, 1.0, 14);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 9; i++) k.cyl(i & 1 ? 0xffffff : 0xe8364a, 0.7, 0.7, 2.2, 10, s * 10.2, 1.1 + i * 2.2, 1.6);
        k.tor(0xe8364a, 1.4, 0.7, s * 11.6, 20.8, 1.6, 0, 0, s > 0 ? 0 : Math.PI, 6, 10, Math.PI);
      }
      for (let i = 0; i < 9; i++) k.T(0).hemi(PAL.candy[i % PAL.candy.length], 1.5, 1.8, 1.5, -18 + i * 4.5, 20.6, 0, 8, 4);
      for (const s of [-1, 1]) { k.cylB(0xffffff, 0.2, 0.2, 6, 6, s * 18.5, 20.5, -1); k.cyl(s > 0 ? 0x5ee0c8 : 0xffd84d, 2.4, 2.4, 0.6, 16, s * 18.5, 27.5, -1, Math.PI / 2); k.tor(0xffffff, 1.6, 0.18, s * 18.5, 27.5, -0.65, 0, 0, 0, 4, 16); }
    } else if (kind === 'neon') {
      k.E(2);
      [[0.5, 0xff3fd2], [1.25, 0x39f0ff], [2.0, 0xffe14d]].forEach(([off, c]) => ring(c, c, off, 0.1 + off * 0.1, 0.22, 16));
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const y = 2 + i * 2.4; k.beam(0x39f0ff, s * 12, y, 0.75, s * 13.4, y + 1.0, 0.75, 0.2, 0.22); k.beam(0x39f0ff, s * 13.4, y + 1.0, 0.75, s * 12, y + 2.0, 0.75, 0.2, 0.22); }
      k.box(0xff3fd2, 44.2, 0.25, 0.3, 0, 19.5, 0.75);
      across(k, 0x39f0ff, 0.05, 0.25, 0.75, 0.3, 22.1);
      for (const s of [-1, 1]) k.box(0xff3fd2, 0.25, 19.8, 0.3, s * 22, 9.5, 0.75);
      k.L();
      for (const s of [-1, 1]) { k.box(0x0d0a1e, 5.4, 3.2, 0.3, s * 16.5, 12.5, 0.75); k.E(1.6).box(s > 0 ? 0x2a6aa8 : 0x8a2a8a, 5.0, 2.8, 0.2, s * 16.5, 12.5, 0.85).L(); }
      k.boxB(0x2e2658, 46, 1.6, 2.4, 0, 19.6, -0.4);
      k.E(2).P(-1).sph(0xff3344, 0.3, 0.3, 0.3, -20, 21.6, 0, 6, 4).sph(0xff3344, 0.3, 0.3, 0.3, 20, 21.6, 0, 6, 4).L();
    } else { // snow: ice cave mouth
      rseed(91, 3, 7);
      for (let i = 0; i < 22; i++) {
        const th = (i / 21) * Math.PI, e = arcPt(T_WX, T_CR, th);
        let nx = Math.cos(th) / T_WX, ny = Math.sin(th) / T_CR; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
        const sy = 1.8 + rnd() * 1.8, off = 0.35 + sy;
        if (Math.abs(e[0] + nx * off) < 8.4 && e[1] + ny * off + sy > 14.6) continue;
        k.oct(mixHex(0xbfe4f8, 0x8fc8ee, rnd()), 0.9, sy, 0.9, e[0] + nx * off, e[1] + ny * off, 0.9, 0, 0, Math.atan2(ny, nx) - Math.PI / 2);
      }
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const sy = 1.4 + rnd() * 1.2; k.oct(mixHex(0xbfe4f8, 0x8fc8ee, rnd()), 0.8, sy, 0.8, s * (T_WX + 0.35 + sy), 1.4 + i * 2.4, 0.9, 0, 0, s * Math.PI / 2); }
      for (let i = 0; i < 16; i++) { const x = -20 + i * 2.7; if (Math.abs(x) < 9) continue; k.cone(0xe8f6ff, 0.35 + (i % 3) * 0.12, 1.4 + (i % 4) * 0.7, 6, x, 18.6 - (i % 4) * 0.35, 0.9, Math.PI); }
      for (let i = 0; i < 11; i++) {
        const x = -6.5 + i * 1.3, ye = T_WY + T_CR * Math.sqrt(Math.max(0, 1 - (x / T_WX) * (x / T_WX)));
        const len = Math.min(1.7, ye + 0.3 - 11.4), top = ye + 0.3;
        if (len > 0.3) k.cone(0xe8f6ff, 0.2 + (i % 3) * 0.05, len, 5, x, top - len / 2, 0.95, Math.PI);
      }
      k.box(0xf6faff, 45, 1.8, 2.8, 0, 20.2, -0.2);
      for (let i = 0; i < 10; i++) k.sph(0xffffff, 2.2, 1.2, 1.6, -20 + i * 4.4, 21.0, 0.2, 8, 4);
      for (const s of [-1, 1]) { k.E(2).T(1).oct(0xffffff, 0.7, 2.4, 0.7, s * 13.5, 3.2, 1.6, 0, 0, s * 0.2).oct(0xffffff, 0.5, 1.6, 0.5, s * 14.8, 2.2, 1.6, 0, 0, -s * 0.3).L(); }
    }
    return { span: true };
  }

  // ================================================================== CITY LANDMARK PROTOTYPES
  function buildCityLandmarkProtos() {
    // Station platform (left side, world coordinates relative to the station centre; right side = ry PI)
    kitProto('lStation', 4, (k) => {
      const L = 56, x0 = -6.75, x1 = -12.2;
      k.boxB(0xb8b0bc, x0 - x1 - 0.5, 1.1, L, (x0 + x1) / 2 - 0.25, -0.3, 0);
      k.boxB(0xffd23a, 0.5, 1.1, L, x0 - 0.25, -0.3, 0);
      k.boxB(0x8a8294, 0.33, 0.75, L, x0 + 0.13 - 0.165, -0.3, 0);
      k.T(1).boxB(0xffffff, 0.5, 3.4, L, x1 + 0.25, 0.8, 0).T(0); // back wall (tinted)
      k.boxB(TRIM, 0.7, 0.3, L, x1 + 0.3, 4.2, 0);
      for (let i = 0; i < 8; i++) { const z = -L / 2 + 3.5 + i * 7; win(k, 1, 0, x1 + 0.5, z, 2.5, 1.6, 1.6, i % 3 !== 1, TRIM, GLASS, WARM); }
      for (let i = 0; i < 8; i++) {
        const z = -L / 2 + 3.5 + i * 7;
        k.cylB(0x4a4460, 0.14, 0.16, 4.2, 8, -10.3, 1.1, z);
        k.beam(0x4a4460, -10.3, 4.6, z, -7.3, 5.2, z, 0.14, 0.2);
      }
      k.box(0xe8453c, 5.6, 0.22, L + 1, -9.6, 5.45, 0, 0, 0, -0.08);
      k.box(0xf4ead8, 5.4, 0.12, L + 0.8, -9.6, 5.3, 0, 0, 0, -0.08);
      k.E(2).box(0xfff0d8, 0.3, 0.08, L - 2, -8.4, 5.12, 0).box(0xfff0d8, 0.3, 0.08, L - 2, -10.8, 5.28, 0).L();
      for (const z of [-16, 2, 16]) { k.boxB(0x8a5a48, 0.6, 0.1, 2.4, -10.9, 1.55, z); k.box(0x8a5a48, 0.1, 0.5, 2.4, -11.2, 1.95, z); k.boxB(0x3e3a52, 0.5, 0.45, 0.1, -10.9, 1.1, z - 1); k.boxB(0x3e3a52, 0.5, 0.45, 0.1, -10.9, 1.1, z + 1); }
      k.boxB(0xe8453c, 0.9, 1.9, 1.0, -11.3, 1.1, -8); k.E(1.6).boxB(0xfff4d8, 0.06, 1.1, 0.8, -10.84, 1.6, -8).L();
      k.cylB(0x4a4460, 0.05, 0.05, 0.7, 5, -9.0, 4.2, 8.5); k.cyl(0x2a2440, 0.55, 0.55, 0.2, 14, -9.0, 3.9, 8.5, Math.PI / 2); k.E(1.4).cyl(0xfffbe8, 0.47, 0.47, 0.22, 14, -9.0, 3.9, 8.5, Math.PI / 2).L();
      // stair towers up to the two footbridges (z = +-22)
      for (const zt of [-22, 22]) {
        k.T(1).boxB(0xffffff, 3.6, 15.4, 5.2, -10.0, 0, zt).T(0);
        k.boxB(0x4a4460, 3.9, 0.4, 5.5, -10.0, 15.4, zt);
        for (let i = 0; i < 4; i++) win(k, 1, 0, -8.2, zt, 3 + i * 3.4, 2.4, 1.6, i % 2 === 0, TRIM, GLASS2, WARM2);
        win(k, 0, 1, zt + 2.6, -10, 8, 1.4, 1.6, true, TRIM, GLASS, WARM); win(k, 0, 1, zt + 2.6, -10, 12.6, 1.4, 1.6, false, TRIM, GLASS, WARM);
        win(k, 0, -1, zt - 2.6, -10, 8, 1.4, 1.6, false, TRIM, GLASS, WARM); win(k, 0, -1, zt - 2.6, -10, 12.6, 1.4, 1.6, true, TRIM, GLASS, WARM);
      }
      return { span: false };
    }, { ao: true });
    kitProto('lFoot', 4, (k) => { // footbridge deck over the track (x from -8.2 to 8.2), underside at y 12.1
      k.boxB(0x8a8298, 16.8, 0.7, 4.4, 0, 12.1, 0);
      k.E(1).boxB(0xbfe2f0, 16.4, 1.9, 0.08, 0, 12.8, 2.1).boxB(0xbfe2f0, 16.4, 1.9, 0.08, 0, 12.8, -2.1).L();
      for (let i = 0; i <= 6; i++) { const x = -8 + i * (16 / 6); k.boxB(0x4a4460, 0.14, 2.0, 0.14, x, 12.8, 2.12); k.boxB(0x4a4460, 0.14, 2.0, 0.14, x, 12.8, -2.12); }
      k.boxB(0xe8453c, 17.0, 0.3, 4.9, 0, 14.8, 0);
      k.E(2).box(0xfff0d8, 16, 0.08, 0.3, 0, 14.75, 0).L();
      k.box(0x2a2140, 6.4, 1.3, 0.3, 0, 13.5, 2.35);
      return { span: true };
    }, { ao: false });
    // Steel truss road bridge over the track (deck underside y 12.2), road ramps down to x = +-72
    kitProto('lTruss', 3, (k) => {
      const Y = 12.2, RED = 0xd8553a;
      k.boxB(0x8a8298, 28, 0.9, 9.4, 0, Y, 0); // main span deck
      k.boxB(0x4e4a5c, 28, 0.08, 7.4, 0, Y + 0.9, 0);
      for (const zz of [-4.5, 4.5]) {
        k.beam(RED, -14, Y + 5.8, zz, 14, Y + 5.8, zz, 0.5, 0.6);
        k.beam(RED, -14, Y + 0.9, zz, 14, Y + 0.9, zz, 0.5, 0.5);
        for (let i = 0; i <= 8; i++) { const x = -14 + i * 3.5; k.beam(RED, x, Y + 0.9, zz, x, Y + 5.8, zz, 0.36, 0.36); if (i < 8) k.beam(RED, x + (i & 1 ? 3.5 : 0), Y + 0.9, zz, x + (i & 1 ? 0 : 3.5), Y + 5.8, zz, 0.3, 0.3); }
      }
      for (let i = 0; i <= 4; i++) k.beam(RED, -14 + i * 7, Y + 5.8, -4.5, -14 + i * 7, Y + 5.8, 4.5, 0.3, 0.3);
      for (const s of [-1, 1]) {
        k.boxB(0xb8aeb4, 3.2, Y, 10, s * 9.2, 0, 0); // piers (inner face at |x| = 7.6)
        k.boxB(0x9a909a, 3.8, 0.6, 10.6, s * 9.2, Y - 0.6, 0);
        k.boxB(0x8a8298, 26, 0.9, 9.4, s * 27, Y, 0);
        k.boxB(0x4e4a5c, 26, 0.08, 7.4, s * 27, Y + 0.9, 0);
        for (const x of [20, 32]) { k.cylB(0xb8aeb4, 0.9, 1.0, Y, 10, s * x, 0, -2.6); k.cylB(0xb8aeb4, 0.9, 1.0, Y, 10, s * x, 0, 2.6); }
        k.beam(0x8a8298, s * 40, Y + 0.45, 0, s * 76, 0.2, 0, 9.4, 0.9); // ramp
        k.beam(0x4e4a5c, s * 40, Y + 0.95, 0, s * 76, 0.7, 0, 7.4, 0.08);
        for (const x of [48, 58]) { const yy = Y * (1 - (x - 40) / 36); k.cylB(0xb8aeb4, 0.8, 0.9, yy, 10, s * x, -0.5, 0); }
        for (const zz of [-4.6, 4.6]) { k.beam(0x6a6478, s * 14, Y + 1.8, zz, s * 40, Y + 1.8, zz, 0.12, 0.12); k.beam(0x6a6478, s * 40, Y + 1.8, zz, s * 76, 1.6, zz, 0.12, 0.12); }
        for (const x of [18, 30]) { k.cylB(0x3e3a52, 0.08, 0.1, 4, 6, s * x, Y + 0.9, 4.4); k.E(2).sph(0xffe3a0, 0.3, 0.2, 0.3, s * x, Y + 4.9, 4.4, 6, 4).L(); }
      }
      for (let i = 0; i < 12; i++) k.box(0xffffff, 1.4, 0.02, 0.18, -60 + i * 11, Y + 0.95, 0);
      return { span: true };
    }, { ao: false, span: true });
    // Ferris wheel (hub at y 0 of the wheel proto; base proto stands on the ground)
    kitProto('fwBase', 4, (k) => {
      const H = 27;
      for (const zz of [-3.2, 3.2]) { k.beam(0xf4f0f8, -11, 0, zz * 1.7, 0, H, zz, 0.6, 0.6); k.beam(0xf4f0f8, 11, 0, zz * 1.7, 0, H, zz, 0.6, 0.6); k.beam(0xd0c8d8, -6, H * 0.45, zz * 1.35, 6, H * 0.45, zz * 1.35, 0.3, 0.3); }
      k.cyl(0xd0c8d8, 1.2, 1.2, 7.4, 12, 0, H, 0, Math.PI / 2);
      k.boxB(0x8a7aa0, 26, 0.6, 14, 0, -0.3, 0);
      k.T(1).boxB(0xffffff, 4, 2.6, 3, 0, 0.3, 6).T(0); k.boxB(0xe8453c, 4.4, 0.3, 3.4, 0, 2.9, 6);
      k.E(2).box(0xfff0a8, 4.2, 0.2, 0.1, 0, 2.2, 7.55).L();
      return { H };
    }, { ao: false, r: 13 });
    kitProto('fwWheel', 4, (k) => {
      const R = 22, n = 16;
      for (const zz of [-1.3, 1.3]) { k.tor(0xf4f0f8, R, 0.35, 0, 0, zz, 0, 0, 0, 5, 48); k.tor(0xd0c8d8, R * 0.62, 0.22, 0, 0, zz, 0, 0, 0, 4, 32); }
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, c = Math.cos(a), s = Math.sin(a);
        for (const zz of [-1.3, 1.3]) k.beam(0xe8e2f0, 0, 0, zz * 0.3, c * R, s * R, zz, 0.16, 0.16);
        k.beam(0xd0c8d8, c * R, s * R, -1.3, c * R, s * R, 1.3, 0.2, 0.2);
      }
      k.E(2);
      for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; k.sph(RAINBOW[i % 7], 0.32, 0.32, 0.32, Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45), 1.5, 5, 4); k.sph(RAINBOW[(i + 3) % 7], 0.32, 0.32, 0.32, Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45), -1.5, 5, 4); }
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; k.sph(0xfff4d8, 0.26, 0.26, 0.26, Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, 1.4, 5, 4); }
      k.L().cyl(0xff5fa2, 2.2, 2.2, 3.4, 16, 0, 0, 0, Math.PI / 2);
      k.E(2).cyl(0xffe14d, 1.2, 1.2, 3.5, 12, 0, 0, 0, Math.PI / 2).L();
    }, { ao: false, r: 23, pinned: true });
    kitProto('fwGond', 64, (k) => {
      k.box(0x8a8298, 0.12, 1.2, 0.12, 0, -0.6, 0);
      k.T(1).boxB(0xffffff, 1.9, 1.5, 1.7, 0, -2.9, 0).T(0);
      k.E(1.4).boxB(0xfff0c8, 1.95, 0.6, 1.2, 0, -2.2, 0).L();
      k.T(1).cone(0xffffff, 1.35, 0.7, 6, 0, -1.05, 0).T(0);
      k.boxB(0xd0c8d8, 2.0, 0.12, 1.8, 0, -3.0, 0);
    }, { ao: false, r: 1.4, pinned: true });
  }

  // ================================================================== LANDMARK SYSTEM
  const LM_CACHE = new Map();
  const lmActive = [];
  const LM_EMPTY = [];
  function mkLm(type, k, z, zNear, zFar, o) {
    return Object.assign({ type, k, z, zNear, zFar, side: -1, x: 0, rects: [], items: null, n: 0, active: false, anim: null }, o || {});
  }
  function landmarksFor(k) {
    if (k < 0) return LM_EMPTY;
    let L = LM_CACHE.get(k);
    if (L) return L;
    L = [];
    const wi = k % RR.WORLDS.length, kind = RR.WORLDS[wi].kind, zs = -k * C.WORLD_LEN;
    rseed(k * 131 + 7, 4099, 17);
    const side = rc(0.5) ? -1 : 1;
    const DEF = LM_DEFS[kind];
    if (DEF) DEF(L, k, zs, side);
    if (k >= 1) L.push(mkLm('tunnel', k, zs, zs + TUN + 3, zs - TUN - 3));
    LM_CACHE.set(k, L);
    if (LM_CACHE.size > 10) { for (const key of LM_CACHE.keys()) { const arr = LM_CACHE.get(key); if (key !== k && !arr.some((l) => l.active)) { LM_CACHE.delete(key); break; } } }
    return L;
  }
  const LM_DEFS = {
    city(L, k, zs, side) {
      const zS = zs - 220, zF = zs - 500, zB = zs - 780;
      L.push(mkLm('station', k, zS, zS + 30, zS - 30, { rects: [-13, 13, zS - 30, zS + 30] }));
      L.push(mkLm('ferris', k, zF, zF + 20, zF - 20, { side, x: side * 78, rects: [side * 78 - 16, side * 78 + 16, zF - 12, zF + 12] }));
      L.push(mkLm('truss', k, zB, zB + 6, zB - 6, { rects: [-80, 80, zB - 7, zB + 7] }));
    }
  };
  const LM_SPAWN = {};
  const LM_ANIM = {};
  const _ferrisAngle = (t, lm) => t * 0.09 + lm.z * 0.01;
  LM_SPAWN.tunnel = (lm) => {
    const b = lm.z, kFrom = (lm.k - 1) % RR.WORLDS.length, kTo = lm.k % RR.WORLDS.length;
    const kinA = RR.WORLDS[kFrom].kind, kinB = RR.WORLDS[kTo].kind;
    for (let i = 0; i < T_NSEG; i++) {
      const zc = b + TUN - T_SEG / 2 - i * T_SEG;
      putRaw(P.tSeg, 0, 0, zc, 0, 1, RAINBOW[i % 7]);
    }
    putRaw(P['tPortal_' + kinA], 0, 0, b + TUN, 0, 1, 0xffffff);
    putRaw(P['tPortal_' + kinB], 0, 0, b - TUN, Math.PI, 1, 0xffffff);
    putRaw(P.tSignFrame, 0, 16.6, b + TUN + 1.7, 0, 1, RR.WORLDS[kTo].cssColor);
    putSign(P.sUnl, 'name' + kTo, 0, 16.6, b + TUN + 1.8, 0, 13.6, 2.27, 0xffffff);
    // props on the hill (entrance half styled for the world being left, exit half for the world entered)
    rseed(lm.k, 777, 3);
    for (let h = 0; h < 2; h++) {
      const kind = h ? kinB : kinA, zc0 = h ? b - 8 : b + 8, dir = h ? -1 : 1;
      for (let i = 0; i < 12; i++) {
        const x = (rc(0.5) ? -1 : 1) * rr(13, 38), z = zc0 + dir * rr(0, TUN - 20);
        const zl = -(TUN - Math.abs(z - b)); // metres behind this half's portal plane
        const y = Math.min(hillY(x - 1.2, zl), hillY(x + 1.2, zl), hillY(x, zl - 1.2), hillY(x, zl + 1.2)) - 0.35;
        if (y > 0.5) hillProp(kind, x, y, z);
      }
    }
  };
  LM_ANIM.tunnel = null;
  function hillProp(kind, x, y, z) {
    const ry = rnd() * TAU;
    switch (kind) {
      case 'city': putRaw(P.cTree, x, y, z, ry, rr(1.2, 1.7), rp(PAL.cityTree)); break;
      case 'beach': if (P.bPalm) putRaw(rc(0.5) ? P.bPalm : P.bPalm2, x, y, z, ry, rr(0.9, 1.2), rp(PAL.palm)); break;
      case 'candy': if (P.kLolly) putRaw(rc(0.5) ? P.kLolly : P.kCotton, x, y, z, ry, rr(1.1, 1.6), rp(PAL.candy)); break;
      case 'neon': if (P.nPalm) putRaw(P.nPalm, x, y, z, ry, rr(1.0, 1.3), rp(PAL.neon)); break;
      case 'snow': if (P.fPine) putRaw(P.fPine, x, y, z, ry, rr(1.0, 1.6), rp(PAL.pine)); break;
    }
  }
  LM_SPAWN.station = (lm) => {
    const z = lm.z;
    putRaw(P.lStation, 0, 0, z, 0, 1, rp(PAL.cityWall));
    putRaw(P.lStation, 0, 0, z, Math.PI, 1, rp(PAL.cityWall));
    putRaw(P.lFoot, 0, 0, z + 22, 0, 1, 0xffffff);
    putRaw(P.lFoot, 0, 0, z - 22, 0, 1, 0xffffff);
    for (const s of [-1, 1]) for (const dz of [-14, 14]) putSign(P.sUnl, 'station', s * 9.6, 4.35, z + dz, s < 0 ? Math.PI / 2 : -Math.PI / 2, 3.2, 0.8, 0xffffff);
    putSign(P.sUnl, 'station', 0, 13.5, z + 24.55, 0, 5.8, 1.2, 0xffffff);
    putSign(P.sUnl, 'station', 0, 13.5, z - 19.45, 0, 5.8, 1.2, 0xffffff);
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) putSign(P.sTex, 'bb' + ((i + (s > 0 ? 2 : 0)) % 4), s * 11.93, 2.5, z - 21 + i * 12, s < 0 ? Math.PI / 2 : -Math.PI / 2, 3.2, 1.6, 0xffffff);
  };
  LM_SPAWN.ferris = (lm) => {
    const x = lm.x, z = lm.z, y = seatY(x, z, 12) + 0.3;
    lm.hubY = y + 27;
    putRaw(P.fwBase, x, y, z, 0, 1, 0xffffff);
    lm.wheel = putRaw(P.fwWheel, x, lm.hubY, z, 0, 1, 0xffffff);
    lm.gonds = [];
    for (let i = 0; i < 16; i++) lm.gonds.push(putRaw(P.fwGond, x, lm.hubY, z, 0, 1, PAL.car[i % PAL.car.length]));
    for (let i = 0; i < 5; i++) { const t = rr(-1, 1); putRaw(P.cTree, x + t * 18, seatY(x + t * 18, z + 11, 1.2), z + rr(9, 13), rnd() * TAU, rr(1, 1.5), rp(PAL.cityTree)); }
    LM_ANIM.ferris(lm, 0);
  };
  LM_ANIM.ferris = (lm, t) => {
    if (lm.wheel < 0) return;
    const a = _ferrisAngle(t, lm), R = 22;
    P.fwWheel.pool.set(lm.wheel, lm.x, lm.hubY, lm.z, 0, 1, 0, a);
    for (let i = 0; i < lm.gonds.length; i++) {
      const g = lm.gonds[i]; if (g < 0) continue;
      const b = a + (i / lm.gonds.length) * TAU;
      P.fwGond.pool.set(g, lm.x + Math.cos(b) * R, lm.hubY + Math.sin(b) * R, lm.z, 0, 1);
    }
  };
  LM_SPAWN.truss = (lm) => {
    const z = lm.z;
    putRaw(P.lTruss, 0, 0, z, 0, 1, 0xffffff);
    lm.cars = [];
    for (let i = 0; i < 4; i++) lm.cars.push(putRaw(P.cCar, 0, 13.18, z, 0, 1, PAL.car[(i * 3 + lm.k) % PAL.car.length]));
    LM_ANIM.truss(lm, 0);
    putSign(P.sTex, 'bb0', 0, 16.4, z + 4.8, 0, 8, 3.2, 0xffffff);
  };
  LM_ANIM.truss = (lm, t) => {
    for (let i = 0; i < lm.cars.length; i++) {
      const id = lm.cars[i]; if (id < 0) continue;
      const dir = i & 1 ? 1 : -1, u = ((t * 9 + i * 37.3) % 150) - 75, x = dir * u;
      const ax = Math.abs(x), y = ax < 40 ? 13.18 : 13.18 - 12.45 * (ax - 40) / 36;
      const slope = ax < 40 ? 0 : Math.atan2(12.2, 36) * (x > 0 ? -1 : 1);
      P.cCar.pool.set(id, x, y, lm.z + (dir > 0 ? -1.9 : 1.9), dir > 0 ? 0 : Math.PI, 1, 0, dir > 0 ? slope : -slope);
    }
  };

  // ================================================================== GENERATORS
  // Called once per chunk side with the placement context G (z0 near end, z1 far end, k, wi, rel0, dens).
  const GEN = {};
  const sideRy = (s) => (s < 0 ? 0 : Math.PI); // front faces the track
  // world position of a local offset on a building placed at (xc, zc) with ry = sideRy(s)
  function shopSign(pr, s, xc, y0, zc, signId) {
    const sg = pr.spec && pr.spec.sign; if (!sg) return;
    const lx = s < 0 ? sg.x : -sg.x, lz = s < 0 ? sg.z : -sg.z;
    putSign(P.sUnl, signId, xc + lx, y0 + sg.y, zc + lz, s < 0 ? Math.PI / 2 : -Math.PI / 2, sg.w, sg.h, 0xffffff);
  }
  // Fixed grids (so both sides and neighbouring chunks line up): grid points z = -(n*step + off) inside the chunk.
  //   for (let z = zg0(step, off); z > G.z1; z -= step) { ...; gridN(z, step, off) gives n }
  const zg0 = (step, off) => -(Math.ceil((-G.z0 - off) / step) * step + off);
  const gridN = (z, step, off) => Math.round((-z - off) / step);
  function towerAt(x, z, w, d, h, color, style, lit, roofP) {
    const id = put(P.cFacade, x, z, 0, [w, h, d], color);
    if (id < 0) return false;
    setWin(P.cFacade, id, style, lit, rnd() * 50, 1);
    const top = lastY + h;
    if (rc(0.35) && h > 30) { // stepped crown
      const w2 = w * rr(0.55, 0.75), d2 = d * rr(0.55, 0.75), h2 = h * rr(0.12, 0.3);
      const id2 = putRaw(P.cFacade, x, top, z, 0, [w2, h2, d2], color); setWin(P.cFacade, id2, style, lit, rnd() * 50, 0);
      if (roofP && rc(0.8 * Math.min(1, G.farQ * 1.5))) putRaw(roofP, x, top + h2, z, ri(0, 3) * Math.PI / 2, 1, 0xffffff);
    } else if (roofP && rc(0.85 * Math.min(1, G.farQ * 1.5)) && w > 8 && d > 8) putRaw(roofP, x + rr(-1, 1), top, z + rr(-1, 1), ri(0, 3) * Math.PI / 2, 1, 0xffffff);
    return true;
  }

  GEN.city = function (s) {
    const ry = sideRy(s), dens = G.dens;
    // sidewalk furniture first (fixed grids so both sides line up): lamps, benches, bus stops
    { const st = dens < 0.7 ? 37.5 : 25; for (let z = zg0(st, 12.5); z > G.z1; z -= st) put(P.cLamp, s * 7.7, z, ry, 1, 0xffffff); }
    for (let z = zg0(50, s > 0 ? 37 : 30); z > G.z1; z -= 50) if (rc(0.55)) put(P.cBench, s * 7.9, z, ry, 1, 0xffffff);
    for (let z = zg0(150, s > 0 ? 64 : 139); z > G.z1; z -= 150) put(P.cBus, s * 8.3, z, ry, 1, rp(PAL.car));
    // street corners: traffic lights + cars queued at the level crossing + parked cars
    for (let n = Math.ceil((-G.z0 - 125) / 250); ; n++) {
      const rel = 125 + n * 250, zs = -(G.k * C.WORLD_LEN + rel);
      if (rel > 1000 || zs <= G.z1) break;
      if (zs > G.z0 || !streetAt(zs, 0)) continue;
      addRaw(P.cTraffic, s * 8.4, 0, zs + 6.6 * -s, s < 0 ? -Math.PI / 2 : Math.PI / 2);
      addRaw(P.cTraffic, s * 8.4, 0, zs - 6.6 * -s, s < 0 ? -Math.PI / 2 : Math.PI / 2 + Math.PI);
      const lane = zs + (s < 0 ? 2.1 : -2.1);
      for (let i = 0; i < 3; i++) if (rc(0.75 - i * 0.2)) addRaw(P.cCar, s * (11.5 + i * 5.6), 0, lane, s < 0 ? 0 : Math.PI, 1, rp(PAL.car));
      for (let i = 0; i < 4; i++) if (rc(0.5)) addRaw(P.cCar, s * (34 + i * 6 + rr(-0.5, 0.5)), 0, zs + (s < 0 ? -3.6 : 3.6), s < 0 ? Math.PI : 0, 1, rp(PAL.car));
    }
    // near band: 2-4 storey shops and flats with gaps and setbacks, pocket parks, parking, graffiti walls
    const shops = SETS.cityShops;
    let z = G.z0 - rr(0.5, 5);
    let guard = 0;
    while (z > G.z1 + 4 && guard++ < 14) {
      const t = rnd();
      if (t < 0.62 * (0.6 + 0.4 * dens)) {
        const pr = rp(shops), W = pr.spec.W, D = pr.spec.D;
        const zc = z - W / 2 - 0.2;
        if (zc - W / 2 < G.z1) { z -= 3; continue; }
        const setback = rr(10.3, 15.5), x = s * (setback + D / 2);
        const id = put(pr, x, zc, ry, 1, rp(PAL.cityWall), 0);
        if (id >= 0) { shopSign(pr, s, x, lastY, zc, 'shop' + ri(0, 7)); z -= W + rr(3, 9) + (1 - dens) * 14; }
        else z -= 3;
      } else if (t < 0.8) { // pocket park / plaza
        const zc = z - 7;
        for (let i = 0; i < 4; i++) put(P.cTree, s * rr(11.5, 22), zc + rr(-6, 6), rnd() * TAU, rr(1.0, 1.4), rp(PAL.cityTree));
        put(P.cHedge, s * rr(10.5, 13), zc + rr(-4, 4), Math.PI / 2, 1, rp(PAL.cityTree));
        if (rc(0.6)) put(P.cKiosk, s * rr(12.5, 15), zc + rr(-3, 3), ry, 1, rp(PAL.umbrella));
        put(P.cBench, s * rr(11, 14), zc + rr(-5, 5), ry + Math.PI / 2, 1, 0xffffff);
        z -= 15;
      } else if (t < 0.9) { // parking
        const zc = z - 6;
        for (let i = 0; i < 3; i++) if (rc(0.8)) put(P.cCar, s * rr(11.6, 12.4), zc - 3 + i * 2.9, s < 0 ? Math.PI / 2 : -Math.PI / 2, 1, rp(PAL.car));
        z -= 11;
      } else { // graffiti wall
        const zc = z - 6.5;
        const id = put(P.cWall, s * rr(9.6, 11), zc, 0, 1, 0xffffff);
        if (id >= 0) putSign(P.sTex, 'gr' + ri(0, 2), lastX - s * 0.27, lastY + 1.55, zc, s < 0 ? Math.PI / 2 : -Math.PI / 2, 11.4, 2.85, 0xffffff);
        z -= 15;
      }
    }
    // slim street trees fill the sidewalk gaps between shop fronts
    for (let z = zg0(12.5, 6.25); z > G.z1; z -= 12.5) if (rc(0.7 * dens + 0.2)) put(P.cTreeS, s * rr(8.5, 8.9), z + rr(-1, 1), rnd() * TAU, rr(0.9, 1.1), rp(PAL.cityTree));
    // mid band: a few mid-rise blocks, trees, billboards (open: lots of space)
    const midN = Math.round(rr(1, 3) * G.farQ);
    for (let i = 0; i < midN; i++) {
      const w = rr(10, 16), d = rr(10, 18), h = rr(10, 22);
      towerAt(s * rr(30, 72), rr(G.z1 + d / 2 + 1, G.z0 - d / 2 - 1), w, d, h, rp(PAL.cityTower), 0, rr(0.2, 0.4), rc(0.5) ? P.cRoofTank : P.cRoof);
    }
    for (let i = 0; i < Math.round(6 * G.farQ); i++) put(P.cTree, s * rr(22, 75), rr(G.z1, G.z0), rnd() * TAU, rr(1.1, 1.7), rp(PAL.cityTree));
    if (rc(0.45)) { const zb = rr(G.z1 + 6, G.z0 - 6), x = s * rr(24, 34), a = s < 0 ? -0.35 : Math.PI + 0.35, id = put(P.cBoard, x, zb, a, 1, 0xffffff); if (id >= 0) putSign(P.sTex, 'bb' + ri(0, 3), x + Math.sin(a + Math.PI / 2) * 0.12, lastY + 7.5, zb + Math.cos(a + Math.PI / 2) * 0.12, a + Math.PI / 2, 9, 4.5, 0xffffff); }
    // far band: towers with gaps
    const farN = Math.round(rr(2, 4) * (0.4 + 0.6 * G.farQ));
    G.far = true;
    for (let i = 0; i < farN; i++) {
      const w = rr(12, 24), d = rr(12, 24), h = rr(32, 95);
      towerAt(s * rr(85, 240), rr(G.z1 + d / 2, G.z0 - d / 2), w, d, h, rp(PAL.cityTower), 0, rr(0.25, 0.45), P.cRoof);
    }
    G.far = false;
  };
  function addRaw(pr, x, y, z, ry, s, color) { if (G.kind === 'city' && Math.abs(x) - pr.r < NEAR_MIN) return -1; return putRaw(pr, x, y, z, ry, s === undefined ? 1 : s, color === undefined ? 0xffffff : color); }

  // ================================================================== PALM COAST
  // helpers shared by trees: cylinder between two points in the xy plane, drooping leaf strip
  function cylSeg(k, c, r0, r1, ax, ay, bx, by, seg, z) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    return k.cyl(c, r1, r0, L, seg || 6, (ax + bx) / 2, (ay + by) / 2, z || 0, 0, 0, Math.atan2(-dx, dy));
  }
  // leaf: list of points along the midrib [[x,y,z]...] in local frame, widths per point; folded V (rib raised)
  function leaf(k, c, pts, wid, yaw, fold) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const P3 = (p, off) => { const x = p[0], z = p[2] + off; return [x * cy + z * sy, p[1], -x * sy + z * cy]; };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], wa = wid[i], wb = wid[i + 1];
      const aL = P3([a[0], a[1] - fold * wa, a[2]], -wa), aR = P3([a[0], a[1] - fold * wa, a[2]], wa), aC = P3(a, 0);
      const bL = P3([b[0], b[1] - fold * wb, b[2]], -wb), bR = P3([b[0], b[1] - fold * wb, b[2]], wb), bC = P3(b, 0);
      k.tri(c, aC[0], aC[1], aC[2], aL[0], aL[1], aL[2], bL[0], bL[1], bL[2]);
      k.tri(c, aC[0], aC[1], aC[2], bL[0], bL[1], bL[2], bC[0], bC[1], bC[2]);
      k.tri(c, aC[0], aC[1], aC[2], bC[0], bC[1], bC[2], bR[0], bR[1], bR[2]);
      k.tri(c, aC[0], aC[1], aC[2], bR[0], bR[1], bR[2], aR[0], aR[1], aR[2]);
    }
  }
  function palm(k, H, bend, nFr, frL, trunkC) {
    const n = 7; let px = 0, py = 0;
    k.S(0.05);
    for (let i = 0; i < n; i++) {
      const t1 = (i + 1) / n, x1 = bend * t1 * t1, y1 = H * t1;
      cylSeg(k, i & 1 ? trunkC : mulHex(trunkC, 0.86), 0.34 - 0.2 * (i / n), 0.34 - 0.2 * t1, px, py, x1, y1, 6);
      px = x1; py = y1;
    }
    const tx = px, ty = py;
    k.S(0.32).T(1);
    for (let f = 0; f < nFr; f++) {
      const yaw = (f / nFr) * TAU + (f & 1) * 0.3, L = frL * (0.85 + 0.3 * ((f * 7) % 5) / 5), up = (f % 3) * 0.25;
      leaf(k, f & 1 ? 0xffffff : 0xe4ecd8, [[0, 0, 0], [L * 0.3, 0.45 + up, 0], [L * 0.65, 0.2 + up, 0], [L, -0.9 + up * 0.5, 0]].map((p) => [p[0] + tx, p[1] + ty, p[2]]), [0.05, 0.42, 0.34, 0.03], yaw, 0.35);
    }
    k.T(0).S(0.2);
    for (let i = 0; i < 3; i++) { const a = i * 2.1; k.sph(0x6a4a2a, 0.2, 0.22, 0.2, tx + Math.cos(a) * 0.28, ty - 0.25, Math.sin(a) * 0.28, 6, 4); }
    k.S(0).L();
    return { swayH: H + 1 };
  }
  function buildBeachProtos() {
    kitProto('bPalm', 420, (k) => palm(k, 8.5, 1.6, 9, 3.6, 0xb08a60));
    kitProto('bPalm2', 420, (k) => palm(k, 5.6, 0.7, 8, 3.0, 0xa8845a));
    kitProto('bUmb', 220, (k) => { // umbrella + towel + two loungers
      k.cylB(0xf2f2f2, 0.04, 0.05, 2.5, 5, 0, 0, 0);
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU;
        if (i & 1) k.T(0); else k.T(1);
        k.tri(i & 1 ? 0xffffff : 0xffffff, 0, 2.62, 0, Math.cos(a0) * 1.7, 2.05, Math.sin(a0) * 1.7, Math.cos(a1) * 1.7, 2.05, Math.sin(a1) * 1.7);
      }
      k.T(0).sph(0xf2f2f2, 0.07, 0.07, 0.07, 0, 2.66, 0, 5, 4);
      k.T(1).boxB(0xffffff, 0.95, 0.07, 1.5, 0.9, 0, -0.1).T(0);
      k.boxB(0xffffff, 0.95, 0.07, 0.4, 0.9, 0, 0.85);
      for (const zz of [-1.25, 1.35]) {
        k.boxB(0xf4f4f4, 0.7, 0.08, 1.4, -0.7, 0.3, zz); k.box(0xf4f4f4, 0.7, 0.08, 0.7, -0.7, 0.55, zz - 0.95, -0.7, 0, 0);
        k.boxB(0x3fa7ff, 0.62, 0.06, 1.3, -0.7, 0.38, zz);
        for (const [dx, dz] of [[-0.3, -0.6], [0.3, -0.6], [-0.3, 0.6], [0.3, 0.6]]) k.boxB(0xd0d0d8, 0.05, 0.3, 0.05, -0.7 + dx, 0, zz + dz);
      }
      k.sph(0xff5a5f, 0.22, 0.22, 0.22, 1.6, 0.22, -1.1, 8, 6);
    });
    kitProto('bLife', 30, (k) => { // lifeguard tower
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.boxB(0xf4f4f4, 0.16, 2.2, 0.16, x * 1.1, 0, z * 1.1);
      k.boxB(0xe8e2d8, 3.0, 0.16, 3.0, 0, 2.2, 0);
      k.boxB(0xf8f8f8, 2.6, 1.8, 2.4, -0.1, 2.36, 0);
      k.E(1).boxB(0x3a4a70, 0.06, 0.8, 1.9, 1.21, 3.1, 0).L();
      k.boxB(0xe8453c, 2.7, 0.14, 2.6, -0.1, 3.0, 0);
      k.box(0xe8453c, 3.2, 0.14, 3.2, -0.1, 4.35, 0, 0, 0, 0.12); k.box(0xe8453c, 3.2, 0.14, 3.2, -0.1, 4.35, 0, 0, 0, -0.12);
      k.box(0xe8453c, 2.0, 1.5, 0.08, -0.1, 4.8, 0);
      k.beam(0xd8c8a8, 1.5, 2.3, 0, 3.4, 0, 0, 0.9, 0.08);
      k.cylB(0xd0d0d8, 0.04, 0.04, 3.2, 5, 1.3, 2.3, 1.3); k.tri(0xe8453c, 1.3, 5.5, 1.3, 1.3, 4.9, 1.3, 2.3, 5.2, 1.3);
      k.tor(0xe8453c, 0.35, 0.1, 1.25, 1.2, 0.2, 0, Math.PI / 2, 0, 5, 10);
      return {};
    });
    kitProto('bSurf', 90, (k) => {
      k.boxB(0x9a6a48, 0.2, 1.0, 2.8, 0, 0, 0); k.box(0x9a6a48, 0.5, 0.12, 2.9, 0, 0.9, 0);
      [0xff5a5f, 0x3fa7ff, 0xffc233, 0x2ec27e].forEach((c, i) => {
        const z = -1.05 + i * 0.7;
        k.sph(c, 0.3, 1.2, 0.07, 0.25, 1.15, z, 8, 6, -0.18, 0, 0);
        k.sph(0xffffff, 0.08, 1.1, 0.075, 0.25, 1.15, z, 5, 5, -0.18, 0, 0);
      });
    });
    kitProto('bCastle', 90, (k) => {
      const SC = 0xe2c490;
      k.cylB(SC, 1.2, 1.4, 0.5, 10, 0, 0, 0); k.boxB(SC, 1.6, 0.6, 1.6, 0, 0.4, 0);
      for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) { k.cylB(SC, 0.3, 0.34, 0.9, 7, x, 0.4, z); k.coneB(0xd8b880, 0.36, 0.45, 7, x, 1.3, z); }
      k.cylB(SC, 0.4, 0.45, 1.4, 8, 0, 0.9, 0); k.coneB(0xd8b880, 0.48, 0.6, 8, 0, 2.3, 0);
      k.cylB(0x6a6a72, 0.015, 0.015, 0.5, 3, 0, 2.8, 0); k.T(1).tri(0xffffff, 0, 3.3, 0, 0, 3.05, 0, 0.35, 3.18, 0).T(0);
      k.T(1).cylB(0xffffff, 0.22, 0.17, 0.35, 8, 1.6, 0, 0.6).T(0); k.box(0x3fa7ff, 0.06, 0.5, 0.18, 1.5, 0.3, -0.5, 0, 0, 0.5);
    });
    kitProto('bHut', 90, (k) => { // beach hut, front +x, stripes tinted
      const W = 3.2, D = 3.0, H = 2.8;
      k.boxB(0xb08a60, D + 0.6, 0.3, W + 0.4, 0.3, 0, 0);
      for (let i = 0; i < 7; i++) { const z = -W / 2 + (W / 7) * (i + 0.5); k.T(i & 1 ? 0 : 1).boxB(0xffffff, D, H, W / 7, 0, 0.3, z); }
      k.T(0);
      k.box(0xffffff, D + 0.9, 0.12, W / 2 + 0.7, 0, 3.55, W / 4 + 0.05, 0.62, 0, 0); k.box(0xffffff, D + 0.9, 0.12, W / 2 + 0.7, 0, 3.55, -W / 4 - 0.05, -0.62, 0, 0);
      k.T(1).box(0xffffff, 0.14, 0.9, W, D / 2 + 0.3, 3.35, 0).T(0);
      k.boxB(0x5a3f2c, 0.08, 1.9, 1.0, D / 2, 0.3, 0.6); k.E(1.4).cyl(WARM2, 0.28, 0.28, 0.1, 10, D / 2 + 0.02, 1.9, -0.7, 0, 0, Math.PI / 2).L();
      k.boxB(0xc8a070, 1.2, 0.12, W + 0.4, D / 2 + 0.6, 0.18, 0);
    });
    kitProto('bSnack', 50, (k) => { // surf shop / snack bar: thatched roof, counter, torches
      k.boxB(0xb08a60, 5.2, 0.3, 6.2, 0, 0, 0);
      for (const [x, z] of [[-2.2, -2.7], [2.2, -2.7], [-2.2, 2.7], [2.2, 2.7]]) k.cylB(0x8a6a48, 0.14, 0.16, 3.2, 6, x, 0.3, z);
      k.T(1).boxB(0xffffff, 4.0, 2.2, 5.0, -0.5, 0.3, 0).T(0);
      k.boxB(0xc89a60, 0.8, 1.05, 5.4, 1.9, 0.3, 0); k.boxB(0x9a6a48, 1.0, 0.1, 5.6, 1.9, 1.35, 0);
      k.E(1.4).boxB(WARM2, 0.1, 0.9, 3.6, 1.52, 1.45, 0).L();
      k.add(gCone(4), 0xd8b060, [0, 4.4, 0], [0, Math.PI / 4, 0], [4.6, 2.2, 4.6]);
      k.add(gCone(4), 0xc8a050, [0, 3.95, 0], [0, Math.PI / 4, 0], [4.9, 1.2, 4.9]);
      k.box(0x2b2440, 0.14, 0.8, 3.2, 2.62, 3.45, 0);
      for (const z of [-3.4, 3.4]) { k.cylB(0x7a5238, 0.07, 0.09, 2.2, 5, 2.6, 0, z); k.E(2).cone(0xffa030, 0.18, 0.5, 6, 2.6, 2.45, z).L(); }
      return { sign: { x: 2.72, y: 3.45, w: 3.0, h: 0.72, z: 0 } };
    });
    kitProto('bTorch', 200, (k) => {
      k.cylB(0x7a5238, 0.06, 0.09, 2.4, 5, 0, 0, 0);
      k.cylB(0x5a3a26, 0.14, 0.1, 0.35, 6, 0, 2.3, 0);
      k.E(2).S(0.06).cone(0xffa030, 0.14, 0.55, 6, 0, 2.95, 0).cone(0xffe070, 0.08, 0.35, 5, 0, 2.9, 0).L().S(0);
    });
    kitProto('bBoat', 120, (k) => { // sailboat (tinted sails), sits at water level
      k.S(0.08);
      k.boxB(0xf4f4f4, 5.2, 0.9, 1.9, 0, -0.35, 0);
      k.add(gCone(4), 0xf4f4f4, [3.2, 0.1, 0], [0, 0, -Math.PI / 2, 'XYZ'], [0.95, 1.3, 0.95]);
      k.boxB(0x3fa7ff, 5.3, 0.14, 1.95, 0, 0.35, 0);
      k.boxB(0xc8a070, 4.0, 0.08, 1.6, -0.2, 0.55, 0);
      k.S(0.25);
      k.cylB(0xd8d8e0, 0.07, 0.08, 7.2, 5, 0.4, 0.55, 0);
      k.T(1).tri(0xffffff, 0.5, 7.5, 0, 0.5, 1.3, 0, -2.4, 1.3, 0).T(0);
      k.tri(0xffffff, 0.35, 7.0, 0, 0.35, 1.5, 0, 3.4, 1.4, 0);
      k.S(0).L();
      return { swayH: 7.5 };
    }, { ao: false });
    kitProto('bGrass', 400, (k) => {
      k.S(0.12);
      for (let i = 0; i < 7; i++) { const a = i * 0.9, r = 0.25; k.cone(i & 1 ? 0x9ab85a : 0x7a9a48, 0.07, 1.1 + (i % 3) * 0.3, 3, Math.cos(a) * r, 0.5, Math.sin(a) * r, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); }
      k.S(0);
    });
    kitProto('bRock', 160, (k) => {
      k.ico(0xb88a62, 1.4, 0, 0.5, 0, 1.2, 0.8, 1, 0, 0.3, 0.8, 0.1);
      k.ico(0xa07650, 0.9, 1.3, 0.3, 0.6, 1, 0.8, 1, 0, 0.6, 0.2, 0.4);
      k.ico(0xc89a70, 0.7, -1.1, 0.25, -0.5, 1, 0.8, 1, 0, 0.1, 1.2, 0.3);
    });
    // landmarks: pier (+ Ferris wheel from the city kit) and lighthouse
    kitProto('lPier', 3, (k) => { // local: runs from x = 0 (shore end) to x = -118 (sea end), deck top y 1.9
      const L = 118, Y = 1.9;
      k.boxB(0xc8a070, L, 0.3, 7, -L / 2, Y - 0.3, 0);
      for (let i = 0; i < 40; i++) k.boxB(i & 1 ? 0xb89060 : 0xd0a878, 0.12, 0.07, 7, -1.5 - i * 2.9, Y, 0);
      k.boxB(0xc8a070, 30, 0.3, 30, -L - 12, Y - 0.3, 0);
      for (let i = 0; i <= 20; i++) { const x = -3 - i * 6; if (x < -L) break; for (const z of [-3.1, 3.1]) k.cylB(0x7a5a40, 0.22, 0.26, Y + 9, 6, x, -9, z); }
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) k.cylB(0x7a5a40, 0.26, 0.3, Y + 9, 6, -L + 1 - i * 6, -9, -12 + j * 6);
      for (const z of [-3.4, 3.4]) { k.box(0xf4f4f4, L, 0.12, 0.12, -L / 2, Y + 1.0, z); for (let i = 0; i <= 39; i++) k.boxB(0xf4f4f4, 0.1, 1.0, 0.1, -i * 3, Y, z); }
      for (let i = 1; i < 7; i++) { const x = -i * 16; for (const z of [-3.3, 3.3]) { k.cylB(0x3e3a52, 0.06, 0.08, 3.6, 6, x, Y, z); k.E(2).sph(0xffe3a0, 0.26, 0.3, 0.26, x, Y + 3.8, z, 6, 4).L(); } }
      // entrance arch (sign quad is an instance)
      for (const z of [-3.6, 3.6]) k.cylB(0xf4f4f4, 0.25, 0.3, 6.5, 8, -2, 0, z);
      k.box(0xff5a5f, 0.5, 1.8, 8.4, -2, 6.1, 0);
      k.E(2); for (let i = 0; i < 9; i++) k.sph(RAINBOW[i % 7], 0.16, 0.16, 0.16, -1.72, 7.1, -3.6 + i * 0.9, 5, 4); k.L();
      // kiosks on the pier
      for (const x of [-40, -78]) { k.T(1).boxB(0xffffff, 3, 2.6, 3, x, Y, -1.9).T(0); k.boxB(0xffffff, 3.6, 0.2, 3.6, x, Y + 2.6, -1.9); k.E(1.4).boxB(WARM2, 0.1, 1.0, 2.2, x + 1.52, Y + 1.0, -1.9).L(); }
      return { span: false };
    }, { ao: false });
    kitProto('lLight', 3, (k) => { // rocky islet + striped lighthouse; lantern at y 29
      rseed(4, 4, 4);
      for (let i = 0; i < 14; i++) { const a = rnd() * TAU, r = rnd() * 9; k.ico(mixHex(0x9a8a80, 0x6a625e, rnd()), 3 + rnd() * 4, Math.cos(a) * r, -3 + rnd() * 5, Math.sin(a) * r, 1.2, 0.8 + rnd() * 0.5, 1.1, 0, rnd(), rnd(), rnd()); }
      k.T(0).hemi(0x6ea452, 7, 2.5, 7, 0, 3.2, 0, 10, 3);
      for (let i = 0; i < 6; i++) { const y0 = 4 + i * 3.6, t0 = i / 6, t1 = (i + 1) / 6; k.cylB(i & 1 ? 0xe8453c : 0xf8f8f8, 2.3 - 0.8 * t1, 2.3 - 0.8 * t0, 3.6, 14, 0, y0, 0); }
      k.cylB(0x3e3a52, 2.2, 2.2, 0.35, 14, 0, 25.6, 0);
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; k.boxB(0x3e3a52, 0.06, 0.9, 0.06, Math.cos(a) * 2.05, 25.95, Math.sin(a) * 2.05); }
      k.tor(0x3e3a52, 2.05, 0.05, 0, 26.85, 0, Math.PI / 2, 0, 0, 3, 14);
      k.E(2).cylB(0xfff2b0, 1.15, 1.15, 2.0, 10, 0, 25.95, 0).L();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.boxB(0x3e3a52, 0.1, 2.0, 0.1, Math.cos(a) * 1.2, 25.95, Math.sin(a) * 1.2); }
      k.coneB(0xe8453c, 1.7, 1.6, 12, 0, 27.95, 0); k.sph(0x3e3a52, 0.25, 0.25, 0.25, 0, 29.7, 0, 6, 4);
      k.T(1).boxB(0xffffff, 3.5, 2.6, 3.2, 3.2, 4, 0).T(0); k.boxB(0xe8453c, 4.0, 0.25, 3.6, 3.2, 6.6, 0);
      return { lamp: 27 };
    }, { ao: false });
  }
  BUILDERS.push(buildBeachProtos);
  const beamGeo = () => { // two opposite beam cones along +x/-x from the origin
    const g = new THREE.CylinderGeometry(7, 0.4, 70, 16, 1, true);
    g.translate(0, 35, 0); g.rotateZ(-Math.PI / 2);
    const g2 = g.clone(); g2.rotateY(Math.PI);
    const m = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries ? THREE.BufferGeometryUtils.mergeBufferGeometries([g, g2]) : g;
    return m;
  };
  LM_DEFS.beach = (L, k, zs) => {
    const zP = zs - 300, zL = zs - 640;
    L.push(mkLm('pier', k, zP, zP + 18, zP - 18, { rects: [-172, -16, zP - 17, zP + 17] }));
    L.push(mkLm('lighthouse', k, zL, zL + 20, zL - 20, { x: -72, rects: [-92, -52, zL - 20, zL + 20] }));
  };
  LM_SPAWN.pier = (lm) => {
    const z = lm.z, x0 = -19;
    putRaw(P.lPier, x0, 0, z, 0, 1, 0xffffff);
    putSign(P.sUnl, 'pier', x0 - 1.72, 6.1, z, Math.PI / 2, 7.2, 1.55, 0xffffff);
    const cx = x0 - 118 - 12;
    lm.x = cx; lm.hubY = 1.9 + 27; lm.z2 = z;
    putRaw(P.fwBase, cx, 1.9, z, 0, 1, 0xffffff);
    lm.wheel = putRaw(P.fwWheel, cx, lm.hubY, z, 0, 1, 0xffffff);
    lm.gonds = [];
    for (let i = 0; i < 16; i++) lm.gonds.push(putRaw(P.fwGond, cx, lm.hubY, z, 0, 1, PAL.umbrella[i % PAL.umbrella.length]));
    for (const x of [x0 - 40, x0 - 78]) putSign(P.sUnl, rc(0.5) ? 'beach1' : 'beach0', x + 1.56, 1.9 + 2.3, z - 1.9, Math.PI / 2, 2.4, 0.55, 0xffffff);
    LM_ANIM.ferris(lm, 0);
  };
  LM_ANIM.pier = (lm, t) => LM_ANIM.ferris(lm, t);
  let beamMesh = null;
  LM_SPAWN.lighthouse = (lm) => {
    const x = lm.x, z = lm.z;
    const y = -1.2;
    putRaw(P.lLight, x, y, z, 0.4, 1, 0xf4f0f8);
    lm.beamY = y + 26.95;
    for (let i = 0; i < 4; i++) putRaw(P.bBoat, x + rr(-40, 30), -0.7, z + rr(-60, 60), rnd() * TAU, rr(0.9, 1.3), rp(PAL.umbrella));
    if (beamMesh) { beamMesh.visible = true; beamMesh.position.set(x, lm.beamY, z); }
  };
  LM_ANIM.lighthouse = (lm, t) => { if (beamMesh) { beamMesh.visible = true; beamMesh.position.set(lm.x, lm.beamY, lm.z); beamMesh.rotation.set(0, t * 0.7, 0); beamMesh.updateMatrix(); beamMesh.updateMatrixWorld(); } };

  GEN.beach = function (s) {
    const ry = sideRy(s), dens = G.dens;
    const rel = (z) => -z - G.k * C.WORLD_LEN;
    const seaSide = s < 0;
    for (let z = zg0(25, 12.5); z > G.z1; z -= 25) put(P.bTorch, s * 7.6, z, 0, 1, 0xffffff);
    if (seaSide) {
      for (let z = zg0(160, 70); z > G.z1; z -= 160) put(P.bLife, -rr(11.5, 14), z, 0, 1, 0xffffff);
      // beach life between the boardwalk and the water line
      let z = G.z0 - rr(0, 4), guard = 0;
      while (z > G.z1 + 2 && guard++ < 20) {
        const t = rnd(), x = -rr(9.5, 19.5);
        if (t < 0.45) put(P.bUmb, x, z, rnd() * TAU, rr(0.95, 1.1), rp(PAL.umbrella));
        else if (t < 0.58) put(P.bCastle, x, z, rnd() * TAU, rr(0.9, 1.3), rp(PAL.umbrella));
        else if (t < 0.68) put(P.bSurf, x, z, rr(-0.5, 0.5), 1, 0xffffff);
        else if (t < 0.9) put(rc(0.6) ? P.bPalm : P.bPalm2, x, z, rnd() * TAU, rr(0.8, 1.1), rp(PAL.palm));
        else put(P.bGrass, x, z, rnd() * TAU, rr(0.8, 1.2), 0xffffff);
        z -= rr(3.5, 7.5) * G.sparse;
      }
      // sailboats on the sea
      G.far = false;
      for (let i = 0; i < Math.round(rr(1, 3) * dens + 0.4); i++) put(P.bBoat, -rr(45, 230), rr(G.z1, G.z0), rnd() * TAU, rr(0.9, 1.4), rp(PAL.umbrella), F_ONWATER);
      // where the sea has not started yet (world ends), palms on the sand
      if (rel(G.z0) < 200 || rel(G.z1) > 800) for (let i = 0; i < 6 * dens; i++) put(rc(0.5) ? P.bPalm : P.bPalm2, -rr(20, 70), rr(G.z1, G.z0), rnd() * TAU, rr(0.9, 1.3), rp(PAL.palm));
      return;
    }
    // land side: palms, huts, snack bars, dune grass
    let z = G.z0 - rr(0, 5), guard = 0;
    while (z > G.z1 + 3 && guard++ < 14) {
      const t = rnd();
      if (t < 0.34) { const id = put(P.bHut, s * rr(11, 15), z - 2, ry, 1, rp(PAL.beachHut)); z -= id >= 0 ? rr(4.5, 7) : 2; }
      else if (t < 0.46) {
        const x = s * rr(13, 16), id = put(P.bSnack, x, z - 4, ry, 1, rp(PAL.beachHut));
        if (id >= 0) { const sg = P.bSnack.spec.sign; putSign(P.sUnl, 'beach' + ri(0, 2), x - s * sg.x, lastY + sg.y, z - 4, s < 0 ? Math.PI / 2 : -Math.PI / 2, sg.w, sg.h, 0xffffff); }
        z -= 9;
      } else { put(rc(0.55) ? P.bPalm : P.bPalm2, s * rr(9.2, 17), z, rnd() * TAU, rr(0.85, 1.25), rp(PAL.palm)); z -= rr(2.5, 5) * G.sparse; }
    }
    for (let i = 0; i < Math.round(8 * dens); i++) put(P.bGrass, s * rr(9, 26), rr(G.z1, G.z0), rnd() * TAU, rr(0.8, 1.3), 0xffffff);
    // mid band: palm groves on the dunes, a few huts and rocks
    for (let i = 0; i < Math.round(9 * G.farQ); i++) put(rc(0.6) ? P.bPalm : P.bPalm2, s * rr(24, 80), rr(G.z1, G.z0), rnd() * TAU, rr(1.0, 1.5), rp(PAL.palm));
    for (let i = 0; i < 2; i++) put(P.bRock, s * rr(26, 80), rr(G.z1, G.z0), rnd() * TAU, rr(1, 2.2), 0xffffff);
    // far band: pastel hotels and big palms on the hills
    G.far = true;
    if (rc(0.55)) { const w = rr(14, 22), d = rr(12, 20), h = rr(18, 42); towerAt(s * rr(90, 200), rr(G.z1 + d / 2, G.z0 - d / 2), w, d, h, rp(PAL.hotel), 2, 0.3, rc(0.5) ? P.cRoof : null); }
    for (let i = 0; i < Math.round(8 * G.farQ); i++) put(P.bPalm, s * rr(82, 240), rr(G.z1, G.z0), rnd() * TAU, rr(1.5, 2.3), rp(PAL.palm));
    G.far = false;
  };

  // ================================================================== CANDY CANYON
  const CHOC = 0x6a3a22, WAFER = 0xe0b070, CREAM = 0xfff2e2, JAM = 0xd0406a;
  const SPRINK = [0xff5fa2, 0x5ee0c8, 0xffd84d, 0xa87bff, 0xff8a5b, 0x7fd6ff, 0xffffff];
  function sprinkles(k, n, cx, cy, cz, r, yMin, spread) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, e = rr(yMin, 1) * (spread || 1.2);
      const dx = Math.cos(a) * Math.cos(e), dy = Math.sin(e), dz = Math.sin(a) * Math.cos(e);
      k.box(SPRINK[i % SPRINK.length], 0.07, 0.07, 0.3, cx + dx * r, cy + dy * r, cz + dz * r, rnd() * 3, rnd() * 3, 0);
    }
  }
  function buildCandyProtos() {
    kitProto('kLolly', 360, (k) => {
      k.cylB(0xf8f4f8, 0.09, 0.11, 3.4, 6, 0, 0, 0);
      k.S(0.14);
      for (let i = 0; i < 12; i++) { k.T(i & 1 ? 0 : 1); k.wedge(0xffffff, 1.35, 0.34, (i / 12) * TAU, TAU / 12, 0, 4.45, 0, Math.PI / 2, 0, 0, 2); }
      k.T(0).tor(0xffffff, 1.35, 0.1, 0, 4.45, 0, 0, 0, 0, 3, 16);
      k.T(1).sph(0xffffff, 0.22, 0.22, 0.22, 0, 4.45, 0.2, 6, 4).T(0);
      k.box(0xff5fa2, 0.5, 0.2, 0.1, 0, 3.1, 0.08, 0, 0, 0.4).box(0xff5fa2, 0.5, 0.2, 0.1, 0, 3.1, 0.08, 0, 0, -0.4);
      k.S(0).L();
      return { swayH: 5.8 };
    });
    kitProto('kLolly2', 300, (k) => {
      k.cylB(0xf8f4f8, 0.08, 0.1, 2.8, 6, 0, 0, 0);
      k.S(0.12).T(1).sph(0xffffff, 0.95, 0.95, 0.95, 0, 3.6, 0, 9, 7).T(0);
      for (let i = 0; i < 2; i++) k.tor(0xffffff, 0.94 * Math.cos((i - 0.5) * 0.7), 0.08, 0, 3.6 + Math.sin((i - 0.5) * 0.7) * 0.94, 0, Math.PI / 2 + 0.3, 0, 0.2, 3, 12);
      k.S(0).L();
      return { swayH: 4.6 };
    });
    kitProto('kCotton', 300, (k) => {
      k.cylB(0xfff4f8, 0.1, 0.16, 2.6, 6, 0, 0, 0);
      for (let i = 0; i < 4; i++) k.cyl(0xff9ad0, 0.13, 0.14, 0.12, 6, 0, 0.4 + i * 0.6, 0);
      k.S(0.12).T(1);
      k.ico(0xffffff, 1.4, 0, 3.7, 0, 1, 0.85, 1, 1);
      k.ico(0xf8f0ff, 1.0, 0.9, 3.4, 0.3, 1, 0.8, 1, 0);
      k.ico(0xfff8fc, 0.9, -0.8, 3.5, -0.4, 1, 0.8, 1, 0);
      k.ico(0xffffff, 0.8, 0.1, 4.6, -0.3, 1, 0.8, 1, 0);
      k.S(0).L();
    });
    kitProto('kCane', 260, (k) => {
      const segs = 9, H = 4.2, r = 0.22;
      for (let i = 0; i < segs; i++) k.cylO(i & 1 ? 0xffffff : 0xe8364a, r, r, H / segs, 6, 0, i * (H / segs), 0);
      k.add(gTor(r / 0.7, 6, 12, Math.PI), (x, y, z, c) => { const a = Math.atan2(y - H, x - 0.7); c.set(Math.floor((a / Math.PI) * 7 + 10) & 1 ? 0xffffff : 0xe8364a); }, [0.7, H, 0], [0, 0, 0], 0.7);
    });
    kitProto('kFence', 200, (k) => { // candy-cane fence along z (5 m) with licorice rope
      for (let i = 0; i < 5; i++) {
        const z = -2 + i;
        for (let j = 0; j < 4; j++) k.cyl(j & 1 ? 0xffffff : 0xe8364a, 0.08, 0.08, 0.3, 6, 0, 0.15 + j * 0.3, z);
        k.tor(i & 1 ? 0xffffff : 0xe8364a, 0.2, 0.08, 0, 1.2, z + 0.2, 0, Math.PI / 2, 0, 4, 8, Math.PI);
      }
      k.beam(0x3a1a2a, 0, 0.9, -2.4, 0, 0.9, 2.4, 0.08, 0.08);
    });
    kitProto('kCupcake', 80, (k) => { // cupcake house (cup tinted, frosting white/pink)
      const R = 3.0, Hc = 3.4;
      for (let i = 0; i < 16; i++) { k.T(i & 1 ? 1 : 0); k.wedge(i & 1 ? 0xffffff : 0xfff4f8, R, Hc, (i / 16) * TAU, TAU / 16, 0, Hc / 2, 0, 0, 0, 0, 1); }
      k.T(0);
      k.cyl(0xfff4f8, R + 0.15, R + 0.15, 0.3, 16, 0, Hc, 0);
      k.add(gHemi(12, 3), 0xffd0e8, [0, Hc + 0.15, 0], null, [R + 0.5, 1.4, R + 0.5]);
      k.add(gHemi(11, 3), 0xffe4f0, [0, Hc + 1.1, 0], null, [R - 0.2, 1.3, R - 0.2]);
      k.add(gHemi(10, 3), 0xffd0e8, [0, Hc + 2.1, 0], null, [R - 1.1, 1.2, R - 1.1]);
      k.cone(0xffe4f0, 0.9, 1.4, 10, 0, Hc + 3.7, 0);
      k.sph(0xe8264a, 0.55, 0.55, 0.55, 0, Hc + 4.6, 0, 8, 6); k.beam(0x3a8a3a, 0, Hc + 5.1, 0, 0.35, Hc + 5.8, 0.1, 0.06, 0.06);
      rseed(3, 9, 1); sprinkles(k, 16, 0, Hc + 0.9, 0, R + 0.35, 0.05, 0.6);
      k.boxB(0x7a4428, 0.2, 2.1, 1.2, R - 0.08, 0, 0); k.E(1.4).cyl(WARM2, 0.25, 0.25, 0.1, 8, R + 0.02, 1.4, 0, 0, 0, Math.PI / 2).L();
      for (const a of [0.9, -0.9, 2.2]) { const x = Math.cos(a) * (R + 0.02), z = Math.sin(a) * (R + 0.02); k.E(1.45).cyl(WARM, 0.45, 0.45, 0.12, 8, x, 2.1, z, 0, -a, Math.PI / 2).L(); k.tor(0xffffff, 0.5, 0.08, x * 1.01, 2.1, z * 1.01, 0, Math.PI / 2 - a, 0, 3, 10); }
      k.cylB(0xff9ad0, 0.2, 0.2, 1.8, 6, 1.2, Hc + 2.2, -1.0);
      return { sign: null };
    });
    kitProto('kCone', 160, (k) => { // ice cream cone statue on a cookie
      k.cylB(0xc8905a, 1.2, 1.3, 0.35, 12, 0, 0, 0);
      k.add(gCone(10), (x, y, z, c) => { const a = Math.atan2(z, x); const g = (Math.floor(y * 2.2) + Math.floor((a + 4) * 3)) & 1; c.set(g ? 0xe8b070 : 0xd49a58); }, [0, 2.2, 0], [Math.PI, 0, 0], [0.9, 3.7, 0.9]);
      k.S(0.04).T(1).sph(0xffffff, 1.1, 0.95, 1.1, 0, 4.4, 0, 9, 6).T(0);
      k.sph(0xfff0f4, 0.95, 0.85, 0.95, 0.1, 5.5, 0.05, 8, 6);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; k.T(1).cone(0xffffff, 0.2, 0.55, 4, Math.cos(a) * 1.0, 3.95, Math.sin(a) * 1.0, Math.PI).T(0); }
      k.sph(0xe8264a, 0.3, 0.3, 0.3, 0.1, 6.45, 0.05, 6, 4);
      k.S(0);
      return { swayH: 6.6 };
    });
    kitProto('kGum', 360, (k) => {
      k.T(1).sph(0xffffff, 0.9, 1.0, 0.9, 0, 0.35, 0, 8, 5).T(0);
      rseed(8, 1, 2); for (let i = 0; i < 7; i++) { const a = rnd() * TAU, e = rr(0.1, 1.2); k.T(1).oct(0xf8f8f8, 0.07, 0.07, 0.07, Math.cos(a) * Math.cos(e) * 0.92, 0.35 + Math.sin(e) * 1.02, Math.sin(a) * Math.cos(e) * 0.92).T(0); }
    });
    kitProto('kGumHill', 90, (k) => {
      k.T(1).add(gHemi(14, 5), 0xffffff, [0, -2.5, 0], null, [7, 8, 7]).T(0);
      k.add(gHemi(12, 3), 0xfff4fa, [0, 3.35, 0], null, [5.3, 2.2, 5.3]);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; k.cone(0xfff4fa, 0.6, 1.2 + (i % 3) * 0.5, 5, Math.cos(a) * 5.0, 3.1 - (i % 3) * 0.25, Math.sin(a) * 5.0, Math.PI); }
      rseed(5, 5, 5); sprinkles(k, 14, 0, 4.2, 0, 3.4, 0.2, 1.3);
    }, { ao: false });
    kitProto('kBonbon', 260, (k) => {
      k.T(1).sph(0xffffff, 0.7, 0.62, 0.62, 0, 0.62, 0, 10, 7);
      k.cone(0xffffff, 0.45, 0.8, 7, 1.0, 0.62, 0, 0, 0, Math.PI / 2); k.cone(0xffffff, 0.45, 0.8, 7, -1.0, 0.62, 0, 0, 0, -Math.PI / 2).T(0);
      k.tor(0xffffff, 0.62, 0.06, 0.25, 0.62, 0, 0, Math.PI / 2, 0, 3, 14).tor(0xffffff, 0.62, 0.06, -0.25, 0.62, 0, 0, Math.PI / 2, 0, 3, 14);
    });
    kitProto('kMush', 200, (k) => {
      k.cylB(0xfff4e8, 0.35, 0.5, 1.6, 8, 0, 0, 0);
      k.T(1).add(gHemi(12, 4), 0xffffff, [0, 1.5, 0], null, [1.5, 1.1, 1.5]).T(0);
      k.cyl(0xfff0f4, 1.45, 1.45, 0.1, 12, 0, 1.5, 0);
      rseed(6, 6, 6); for (let i = 0; i < 7; i++) { const a = rnd() * TAU, e = rr(0.2, 1.1); k.sph(0xffffff, 0.2, 0.08, 0.2, Math.cos(a) * Math.cos(e) * 1.5, 1.5 + Math.sin(e) * 1.1, Math.sin(a) * Math.cos(e) * 1.5, 6, 3, 0, 0, 0); }
    });
    kitProto('kMesa', 60, (k) => { // layered cake mesa (far band): stacked strata rings, frosting, drips, cherries, candles
      const tiers = [[27, 12], [21, 9], [14, 8]];
      let y = -14;
      const bands = [0xe0a868, CREAM, JAM, CREAM, CHOC, 0xe0a868];
      tiers.forEach(([R, H], ti) => {
        const h0 = ti === 0 ? H + 14 : H, n = ti === 0 ? 9 : 5, bh = h0 / n;
        for (let b = 0; b < n; b++) k.cylO(bands[(b + ti) % bands.length], R, R, bh, 16, 0, y + b * bh, 0);
        k.cyl(0xffb0d8, R + 0.4, R + 0.4, 1.2, 16, 0, y + h0 - 0.1, 0);
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + ti; k.cone(0xffb0d8, 1.3, 2.2 + (i % 3) * 1.2, 5, Math.cos(a) * (R + 0.2), y + h0 - 1.4 - (i % 3) * 0.6, Math.sin(a) * (R + 0.2), Math.PI); }
        y += h0;
      });
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.sph(0xe8264a, 1.3, 1.3, 1.3, Math.cos(a) * 10, y + 1.0, Math.sin(a) * 10, 6, 4); }
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; k.cylB(SPRINK[i], 0.5, 0.5, 5, 8, Math.cos(a) * 5, y, Math.sin(a) * 5); k.E(2).cone(0xffc040, 0.45, 1.3, 6, Math.cos(a) * 5, y + 5.7, Math.sin(a) * 5).L(); }
    }, { ao: false, far: true });
    kitProto('kDonut', 160, (k) => { // small donut lying on the ground
      k.tor(0xe0a060, 1.1, 0.5, 0, 0.5, 0, Math.PI / 2, 0, 0, 8, 18);
      k.T(1).tor(0xffffff, 1.1, 0.42, 0, 0.62, 0, Math.PI / 2, 0, 0, 6, 18, TAU).T(0);
      rseed(9, 9, 9); for (let i = 0; i < 16; i++) { const a = rnd() * TAU, rr_ = 1.1 + rr(-0.3, 0.3); k.box(SPRINK[i % 7], 0.06, 0.06, 0.25, Math.cos(a) * rr_, 1.02, Math.sin(a) * rr_, 0, rnd() * 3, 0); }
    });
    // gingerbread house (village landmark)
    kitProto('kGinger', 30, (k) => {
      const W = 6, D = 5.2, H = 3.4, GB = 0xb06a38, IC = 0xfffaf4;
      k.boxB(GB, D, H, W, 0, -0.3, 0);
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.boxB(IC, 0.22, H + 0.3, 0.22, x * D / 2, -0.3, z * W / 2);
      k.box(IC, D + 0.2, 0.2, W + 0.2, 0, H - 0.2, 0);
      for (const sgn of [-1, 1]) {
        k.box(0x8a4a24, D + 1.2, 0.35, 3.9, 0, H + 1.25, sgn * 1.6, sgn * -0.72, 0, 0);
        k.box(IC, D + 1.3, 0.14, 0.3, 0, H - 0.05 + 0.02, sgn * (W / 2 + 0.25), 0, 0, 0);
        for (let i = 0; i < 9; i++) k.sph(IC, 0.3, 0.22, 0.22, -D / 2 - 0.4 + i * (D + 0.8) / 8, H - 0.05, sgn * (W / 2 + 0.3), 5, 4);
      }
      k.box(IC, D + 1.3, 0.25, 0.3, 0, H + 2.5, 0);
      for (let i = 0; i < 5; i++) k.sph(SPRINK[i], 0.3, 0.35, 0.3, -2 + i, H + 2.8, 0, 6, 4);
      // gable ends (triangles) + window
      for (const sgn of [-1, 1]) { k.tri(GB, -D / 2, H - 0.3, sgn * W / 2 * 0.999, D / 2, H - 0.3, sgn * W / 2 * 0.999, 0, H + 2.4, sgn * W / 2 * 0.999); }
      k.E(1.45).cyl(WARM, 0.4, 0.4, 0.1, 10, 0, H + 0.8, W / 2 + 0.03, Math.PI / 2, 0, 0).L(); k.tor(IC, 0.45, 0.08, 0, H + 0.8, W / 2 + 0.06, 0, 0, 0, 4, 12);
      // front (+x): door, windows, candy cane posts
      k.boxB(0x5a2a14, 0.12, 2.2, 1.2, D / 2 + 0.03, 0, 0); k.tor(IC, 0.6, 0.07, D / 2 + 0.08, 2.2, 0, 0, Math.PI / 2, 0, 3, 10, Math.PI);
      for (const z of [-1.9, 1.9]) { k.E(1.45).boxB(WARM2, 0.12, 1.1, 1.1, D / 2 + 0.03, 1.1, z).L(); k.box(IC, 0.16, 0.12, 1.3, D / 2 + 0.07, 2.25, z); k.box(IC, 0.16, 0.12, 1.3, D / 2 + 0.07, 1.05, z); k.box(IC, 0.16, 1.1, 0.1, D / 2 + 0.08, 1.65, z); }
      for (const z of [-0.95, 0.95]) for (let j = 0; j < 5; j++) k.cyl(j & 1 ? 0xffffff : 0xe8364a, 0.12, 0.12, 0.5, 6, D / 2 + 0.5, 0.25 + j * 0.5, z);
      for (let i = 0; i < 7; i++) k.sph(SPRINK[i], 0.18, 0.18, 0.12, D / 2 + 0.05, 2.95, -2.7 + i * 0.9, 5, 4);
      k.boxB(0xa05a30, 0.9, 1.6, 0.9, -1.3, H + 1.3, -1.6); k.boxB(IC, 1.05, 0.25, 1.05, -1.3, H + 2.9, -1.6);
    });
    // donut arch over the track: ring radius 18.2, tube 2.2, centre y -3 (inner edge >= 11.6 over |x| <= 6.5)
    kitProto('lDonut', 6, (k) => {
      const R = 18.2, r = 2.2, cy = -3, d = Math.asin(4 / R) + 0.1, arc = Math.PI + 2 * d;
      k.T(1);
      k.add(new THREE.TorusGeometry(R, r, 10, 44, arc), (x, y, z, c) => {
        const ph = Math.atan2(y - cy, x), cx0 = Math.cos(ph) * R, cy0 = cy + Math.sin(ph) * R;
        const ox = x - cx0, oy = y - cy0, rad = ox * Math.cos(ph) + oy * Math.sin(ph);
        const front = z + 0.35 * r * Math.sin(ph * 17) - 0.1 * rad;
        if (front > -0.25 * r) c.setRGB(1, 1, 1); else c.setRGB(0.88, 0.63, 0.38);
      }, [0, cy, 0], [0, 0, -d], 1);
      k.T(0);
      rseed(12, 3, 4);
      for (let i = 0; i < 90; i++) {
        const ph = rr(0.12, Math.PI - 0.12), psi = rr(-0.6, 1.3);
        const rad = Math.cos(psi), fz = Math.sin(psi);
        const x = Math.cos(ph) * (R + rad * r * 1.02), y = cy + Math.sin(ph) * (R + rad * r * 1.02), z = fz * r * 1.02;
        k.box(SPRINK[i % 7], 0.1, 0.1, 0.5, x, y, z, rnd() * 3, rnd() * 3, 0);
      }
      return { span: true };
    }, { ao: false, span: true });
    // wafer footbridge (spans a river along x; local centre at the river axis)
    kitProto('lWafer', 3, (k) => {
      const L = 28, Wd = 4.4;
      for (let i = 0; i < 14; i++) {
        const x0 = -L / 2 + i * 2, x1 = x0 + 2, y0 = 1.3 + 1.4 * Math.sin(Math.PI * (i / 14)), y1 = 1.3 + 1.4 * Math.sin(Math.PI * ((i + 1) / 14));
        k.add(gBox(), (x, y, z, c) => { const g = (Math.floor((z + 5) * 2.2) + Math.floor((x + 40) * 2.2)) & 1; c.set(g ? WAFER : 0xc88f50); }, [(x0 + x1) / 2, (y0 + y1) / 2, 0], [0, 0, Math.atan2(y1 - y0, 2)], [2.05, 0.7, Wd]);
        for (const z of [-Wd / 2, Wd / 2]) { k.cyl(i & 1 ? 0xffffff : 0xe8364a, 0.11, 0.11, 1.1, 6, x0, y0 + 0.9, z); }
        for (const z of [-Wd / 2, Wd / 2]) k.beam(0xff9ad0, x0, y0 + 1.45, z, x1, y1 + 1.45, z, 0.14, 0.14);
      }
      for (const x of [-L / 2 - 1, L / 2 + 1]) { k.boxB(0xf0e2c8, 3, 1.4, Wd + 1, x, -1, 0); k.boxB(JAM, 3.1, 0.35, Wd + 1.1, x, 0.4, 0); }
      for (const [x, z] of [[-L / 2, -Wd / 2 - 0.6], [-L / 2, Wd / 2 + 0.6], [L / 2, -Wd / 2 - 0.6], [L / 2, Wd / 2 + 0.6]]) {
        k.cylB(0xffffff, 0.12, 0.12, 4.2, 6, x, 0, z); k.E(2).T(1).sph(0xffffff, 0.55, 0.55, 0.55, x, 4.6, z, 8, 6).L();
      }
      for (let i = 0; i < 8; i++) k.cylB(0xc88f50, 0.35, 0.4, 3, 6, -L / 2 + 3.5 + i * 3, -2.2, i & 1 ? 1.6 : -1.6);
      return { span: false };
    }, { ao: false });
  }
  BUILDERS.push(buildCandyProtos);
  LM_DEFS.candy = (L, k, zs) => {
    const zV = zs - 250, zW = zs - 520, zD = zs - 780;
    L.push(mkLm('ginger', k, zV, zV + 40, zV - 40, { rects: [-70, -10, zV - 40, zV + 40] }));
    L.push(mkLm('wafer', k, zW, zW + 8, zW - 8, { rects: [14, 80, zW - 8, zW + 8] }));
    L.push(mkLm('donuts', k, zD, zD + 5, zD - 55, { rects: [-24, 24, zD - 54, zD + 4] }));
  };
  LM_SPAWN.ginger = (lm) => {
    const z = lm.z;
    const spots = [[-15, 22], [-16, 6], [-16, -12], [-17, -28], [-30, 14], [-31, -6], [-32, -24], [-46, 4]];
    spots.forEach(([x, dz], i) => { const zz = z + dz, y = seatY(x, zz, 4) ; putRaw(P.kGinger, x, y, zz, (x < -25 ? rr(-0.4, 0.4) : 0), rr(0.9, 1.1), 0xffffff); });
    for (let i = 0; i < 14; i++) { const x = -rr(10, 60), zz = z + rr(-38, 38); let ok = true; for (const [sx, sdz] of spots) if (Math.abs(x - sx) < 5 && Math.abs(zz - (z + sdz)) < 5) ok = false; if (ok) putRaw(rc(0.5) ? P.kGum : P.kLolly, x, seatY(x, zz, 1), zz, rnd() * TAU, rr(0.8, 1.3), rp(PAL.candy)); }
    for (let i = 0; i < 6; i++) putRaw(P.kCane, -9.5, 0, z + 30 - i * 12, 0, 1.0, 0xffffff);
    putSign(P.sUnl, 'candy' + ri(0, 2), -16 + 2.72, 3.6, z + 6, Math.PI / 2, 2.4, 0.6, 0xffffff);
  };
  LM_SPAWN.wafer = (lm) => {
    const z = lm.z;
    let x0 = null, x1 = null;
    for (let x = 18; x < 90; x += 0.5) { if (waterLv(x, z) !== null) { if (x0 === null) x0 = x; x1 = x; } else if (x0 !== null) break; }
    const cx = x0 === null ? 36 : (x0 + x1) / 2;
    putRaw(P.lWafer, cx, 0, z, 0, 1, 0xffffff);
    for (const dx of [-19, 19]) for (const dz of [-5, 5]) putRaw(P.kLolly, cx + dx, seatY(cx + dx, z + dz, 1), z + dz, rnd() * TAU, 1.3, rp(PAL.candy));
  };
  LM_SPAWN.donuts = (lm) => {
    const cols = [0xff9ccf, 0x7a4a2a, 0x8ae8d0];
    for (let i = 0; i < 3; i++) putRaw(P.lDonut, 0, 0, lm.z - i * 24, 0, 1, cols[(i + lm.k) % 3]);
  };
  GEN.candy = function (s) {
    const ry = sideRy(s), dens = G.dens;
    for (let z = zg0(50, s < 0 ? 18 : 43); z > G.z1; z -= 50) if (rc(0.6)) put(P.kFence, s * 8.2, z, 0, 1, 0xffffff);
    let z = G.z0 - rr(0, 4), guard = 0;
    const near = SETS.candyNear;
    while (z > G.z1 + 2 && guard++ < 22) {
      if (rc(0.07 * dens)) { const id = put(P.kCupcake, s * rr(12.5, 17), z - 3.5, ry, rr(0.9, 1.1), rp(PAL.candy)); z -= id >= 0 ? 9 : 2; continue; }
      const pr = rp(near);
      if (rc(0.5 + 0.5 * dens)) put(pr, s * rr(9, 17), z, rnd() * TAU, rr(0.8, 1.25), rp(PAL.candy));
      z -= rr(2.2, 4.5) * G.sparse;
    }
    // mid band: gumdrop hills, cupcake houses, big lollipops and cotton trees
    for (let i = 0; i < Math.round(rr(1.5, 3) * dens); i++) put(P.kGumHill, s * rr(26, 80), rr(G.z1, G.z0), rnd() * TAU, rr(0.7, 1.3), rp(PAL.candy));
    for (let i = 0; i < Math.round(8 * G.farQ); i++) put(rp(SETS.candyMid), s * rr(19, 80), rr(G.z1, G.z0), rnd() * TAU, rr(1.2, 2.2), rp(PAL.candy));
    if (rc(0.35)) put(P.kCupcake, s * rr(24, 60), rr(G.z1 + 4, G.z0 - 4), rnd() * TAU, rr(1.1, 1.5), rp(PAL.candy));
    // far band: layered cake mesas (canyon walls) and giant lollipops
    G.far = true;
    if (rc(0.55 * Math.min(1, G.farQ * 1.4))) put(P.kMesa, s * rr(110, 230), rr(G.z1, G.z0), rnd() * TAU, rr(0.8, 1.2), 0xffffff, 0, 0);
    for (let i = 0; i < Math.round(5 * G.farQ); i++) put(rp(SETS.candyFar), s * rr(82, 240), rr(G.z1, G.z0), rnd() * TAU, rr(2.5, 4), rp(PAL.candy));
    G.far = false;
  };

  // ================================================================== NEON NIGHT
  const NDARK = 0x2a2250, NDARK2 = 0x1c1638;
  // neon edge strips around a box (tinted glow): x0..x1, y0..y1, z0..z1
  function neonEdges(k, x0, x1, y0, y1, z0, z1, t) {
    k.E(2).T(1);
    const w = t || 0.12;
    for (const x of [x0, x1]) for (const z of [z0, z1]) k.box(0xffffff, w, y1 - y0, w, x, (y0 + y1) / 2, z);
    for (const y of [y1]) { k.box(0xffffff, x1 - x0 + w, w, w, (x0 + x1) / 2, y, z0); k.box(0xffffff, x1 - x0 + w, w, w, (x0 + x1) / 2, y, z1); k.box(0xffffff, w, w, z1 - z0, x0, y, (z0 + z1) / 2); k.box(0xffffff, w, w, z1 - z0, x1, y, (z0 + z1) / 2); }
    k.L();
  }
  function buildNeonProtos() {
    kitProto('nLow', 90, (k) => { // 2-storey neon shop, front +x
      const W = 11, D = 9, H = 7.6;
      k.boxB(NDARK, D, H + 0.5, W, 0, -0.5, 0);
      k.boxB(NDARK2, D + 0.4, 0.5, W + 0.4, 0, H, 0);
      neonEdges(k, -D / 2 - 0.02, D / 2 + 0.02, 0, H + 0.5, -W / 2 - 0.02, W / 2 + 0.02, 0.14);
      k.E(1.5).boxB(0x39f0ff, 0.14, 2.4, W - 4, D / 2 + 0.02, 0.5, -1).L();
      for (let i = 0; i < 4; i++) k.box(0x15102a, 0.2, 2.4, 0.1, D / 2 + 0.06, 1.7, -1 - (W - 4) / 2 + (i + 1) * (W - 4) / 5);
      k.boxB(0x3a3060, 0.14, 2.6, 1.6, D / 2 + 0.02, 0, W / 2 - 1.6); k.E(2).T(1).box(0xffffff, 0.2, 0.1, 1.8, D / 2 + 0.06, 2.65, W / 2 - 1.6).L();
      k.box(NDARK2, 1.4, 0.12, W - 1, D / 2 + 0.7, 3.2, 0, 0, 0, -0.15); k.E(2).T(1).box(0xffffff, 0.1, 0.1, W - 1, D / 2 + 1.38, 3.1, 0).L();
      for (let i = 0; i < 4; i++) { const z = -W / 2 + 1.5 + i * 2.7; k.E(1.4).box(i % 2 ? 0xff7ad8 : 0x8a7aff, 0.12, 1.5, 1.6, D / 2 + 0.02, 5.4, z).L(); k.box(0x15102a, 0.16, 0.1, 1.8, D / 2 + 0.05, 4.6, z); }
      for (const sgn of [-1, 1]) for (let i = 0; i < 3; i++) { k.E(1.4).box(i % 2 ? 0x39f0ff : 0xffe14d, 1.4, 1.4, 0.12, -D / 2 + 1.5 + i * 3, 5.4, sgn * (W / 2 + 0.02)).L(); }
      k.box(0x1a1430, 0.3, 1.5, 5.4, D / 2 + 0.16, 8.8, 0); // sign backing (text quad instance)
      for (const z of [-2.2, 2.2]) k.boxB(0x3a3060, 0.2, 1.0, 0.2, D / 2 + 0.16, H + 0.5, z);
      acUnit(k, -1.5, H + 0.5, -2.5, 0.9); k.cylB(0x5a5070, 0.05, 0.08, 4, 5, -3, H + 0.5, 3.5); k.E(2).P(-1).sph(0xff3344, 0.15, 0.15, 0.15, -3, H + 4.55, 3.5, 6, 4).P(0).L();
      return { W, D, sign: { x: D / 2 + 0.33, y: 8.8, w: 5.0, h: 2.4, z: 0 } };
    });
    kitProto('nLow2', 90, (k) => { // 3-storey block with a big glowing screen facade
      const W = 12, D = 10, H = 11;
      k.boxB(NDARK2, D, H + 0.5, W, 0, -0.5, 0);
      neonEdges(k, -D / 2 - 0.02, D / 2 + 0.02, 0, H + 0.5, -W / 2 - 0.02, W / 2 + 0.02, 0.16);
      k.box(0x100c20, 0.3, 5.4, W - 2.4, D / 2 + 0.1, 7.2, 0);
      k.E(1.8).add(gBox(), (x, y, z, c) => { const t = (y - 4.5) / 5.4; c.setRGB(0.9 - 0.5 * t, 0.25 + 0.3 * t, 0.85 + 0.15 * t); }, [D / 2 + 0.22, 7.2, 0], null, [0.1, 5.0, W - 2.8]).L();
      for (let i = 0; i < 6; i++) k.box(0x100c20, 0.14, 5.0, 0.08, D / 2 + 0.28, 7.2, -W / 2 + 1.4 + i * (W - 2.8) / 5);
      k.E(1.5).boxB(0xffe14d, 0.14, 2.6, W - 3, D / 2 + 0.02, 0.4, 0).L();
      for (const sgn of [-1, 1]) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const lit = (i + j + (sgn > 0 ? 1 : 0)) % 3 !== 0; k.E(lit ? 1.45 : 1).box(lit ? (j % 2 ? 0x39f0ff : 0xff7ad8) : 0x2a2448, 1.5, 1.6, 0.12, -D / 2 + 1.8 + i * 3.2, 2.2 + j * 3.2, sgn * (W / 2 + 0.02)).L(); }
      k.boxB(0x3a3060, 2.2, 3, 2.2, -2, H + 0.5, 2.5); k.E(2).T(1).box(0xffffff, 2.3, 0.14, 2.3, -2, H + 3.4, 2.5).L();
      return { W, D };
    });
    kitProto('nLamp', 260, (k) => {
      k.cylB(0x2a2448, 0.18, 0.24, 0.5, 8, 0, 0, 0);
      k.cylB(0x2a2448, 0.07, 0.1, 6.2, 6, 0, 0.4, 0);
      k.beam(0x2a2448, 0, 6.5, 0, 0, 6.9, 0.9, 0.1, 0.1);
      k.E(2).T(1).cylB(0xffffff, 0.12, 0.12, 1.6, 6, 0, 5.0, 0.12).box(0xffffff, 0.14, 0.14, 1.2, 0, 6.85, 1.0).L();
      k.E(2).T(1).cylB(0xffffff, 0.24, 0.24, 0.08, 8, 0, 0.5, 0).L();
    });
    kitProto('nPalm', 260, (k) => {
      const H = 7, n = 6;
      for (let i = 0; i < n; i++) { const y0 = (i / n) * H, y1 = ((i + 1) / n) * H, x0 = 0.9 * (i / n) * (i / n), x1 = 0.9 * ((i + 1) / n) * ((i + 1) / n); k.S(0.05); cylSeg(k, 0x2a2244, 0.3 - 0.15 * i / n, 0.3 - 0.15 * (i + 1) / n, x0, y0, x1, y1, 6); if (i % 2 === 1) { k.E(2).T(1); cylSeg(k, 0xffffff, 0.3 - 0.15 * i / n + 0.03, 0.3 - 0.15 * i / n + 0.03, x0, y0 - 0.06, x0 + 0.01, y0 + 0.06, 6); k.L(); } }
      k.S(0.3);
      for (let f = 0; f < 8; f++) { const yaw = (f / 8) * TAU, L = 2.9; leaf(k, 0x3a2a68, [[0.9, H, 0], [0.9 + L * 0.3, H + 0.4, 0], [0.9 + L * 0.65, H + 0.1, 0], [0.9 + L, H - 0.9, 0]].map((p) => [p[0] - 0.9, p[1], p[2]]).map((p) => [p[0] + 0.9, p[1], p[2]]), [0.05, 0.4, 0.3, 0.03], yaw, 0.3); }
      k.E(2).T(1); for (let f = 0; f < 8; f++) { const yaw = (f / 8) * TAU + 0.2, L = 2.6, cy = Math.cos(yaw), sy = Math.sin(yaw); k.beam(0xffffff, 0.9, H + 0.05, 0, 0.9 + cy * L * 0.6, H + 0.35, -sy * L * 0.6, 0.05, 0.05); } k.L();
      k.S(0);
      return { swayH: H + 1 };
    });
    kitProto('nKiosk', 120, (k) => {
      k.boxB(NDARK, 1.6, 2.4, 1.4, 0, 0, 0);
      k.E(1.8).T(1).boxB(0xffffff, 0.08, 1.5, 1.1, 0.82, 0.7, 0).L();
      k.E(1.4).boxB(0x39f0ff, 0.09, 0.5, 1.0, 0.83, 1.75, 0).L();
      k.boxB(NDARK, 1.8, 2.2, 1.4, 0, 0, 1.8); k.E(1.8).boxB(0xff3fd2, 0.08, 1.2, 1.1, 0.92, 0.8, 1.8).L();
      k.E(2).T(1).box(0xffffff, 1.9, 0.1, 3.4, 0, 2.5, 0.9).L();
    });
    kitProto('nPylon', 60, (k) => { // hologram emitter pylon (quad hovers at y 9..15)
      k.boxB(NDARK, 1.4, 0.6, 1.4, 0, 0, 0);
      k.cylB(0x3a3060, 0.22, 0.3, 8.2, 8, 0, 0.6, 0);
      k.boxB(0x3a3060, 1.2, 0.5, 1.2, 0, 8.6, 0);
      k.E(2).T(1).cylB(0xffffff, 0.35, 0.5, 0.3, 8, 0, 9.1, 0).box(0xffffff, 0.08, 7.8, 0.08, 0.16, 4.6, 0.16).L();
    });
    // light ring over the track: radius 11.5 x 1.5 (vertical), centre y -2 => inner edge > 11.6 over |x| <= 6.5
    kitProto('nRing', 30, (k) => {
      const R = 11.5, sy = 1.5, a0 = -0.06, arc = Math.PI + 0.12;
      k.E(2).T(1).P(0.35).add(new THREE.TorusGeometry(R, 0.3, 6, 60, arc), 0xffffff, [0, -2, 0], [0, 0, a0], [1, sy, 1]).L();
      k.add(new THREE.TorusGeometry(R + 0.55, 0.12, 4, 60, arc), 0x2a2250, [0, -2, 0], [0, 0, a0], [1, sy, 1]);
      for (const x of [-11.2, 11.2]) { k.boxB(0x2a2250, 1.4, 0.6, 1.4, x, 0, 0); k.E(2).T(1).boxB(0xffffff, 1.5, 0.1, 1.5, x, 0.6, 0).L(); }
      return { span: true };
    }, { ao: false, span: true });
    kitProto('nRoof', 260, (k) => {
      k.boxB(0x2a2448, 3, 1.4, 3, 0, 0, 0);
      k.cylB(0x5a5070, 0.08, 0.14, 9, 5, 0.5, 1.4, 0.5); k.E(2).P(-1).sph(0xff3344, 0.28, 0.28, 0.28, 0.5, 10.5, 0.5, 6, 4).P(0).L();
      k.cyl(0x8a80a0, 1.1, 1.1, 0.14, 10, -1.6, 2.3, -0.5, 0.6, 0, 0.3);
      k.E(2).T(1).tor(0xffffff, 1.6, 0.1, 0, 1.4, 0, Math.PI / 2, 0, 0, 3, 16).L();
    }, { r: 2 });
    // stadium dome (far): R 40
    kitProto('lStadium', 3, (k) => {
      const R = 40;
      k.cylB(0x241a48, R, R + 1.5, 14, 32, 0, -3, 0);
      k.add(gHemi(28, 6), (x, y, z, c) => { const a = Math.atan2(z, x), g = Math.abs(((a / TAU) * 32 % 1 + 1) % 1 - 0.5) < 0.04; c.set(g ? 0x5a4a9a : 0x2e2360); }, [0, 11, 0], null, [R - 1, 16, R - 1]);
      k.E(2).T(1);
      for (const [y, rr_] of [[3, R + 1.6], [8, R + 1.2], [11.2, R - 0.6]]) k.tor(0xffffff, rr_, 0.35, 0, y, 0, Math.PI / 2, 0, 0, 4, 64);
      k.L().E(2);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.box(RAINBOW[i % 7], 0.5, 60, 0.5, Math.cos(a) * (R - 6), 55, Math.sin(a) * (R - 6), Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25); }
      k.L();
      k.boxB(0x1a1430, 18, 8, 1, 0, 14, -R + 3); k.E(1.8).T(1).boxB(0xffffff, 17, 7, 0.2, 0, 14.5, -R + 3.5).L();
      return { span: false };
    }, { ao: false });
    kitProto('lGate', 3, (k) => { // twin pylons + beam over the track (all corridor geometry above y 12.5)
      for (const s of [-1, 1]) {
        k.boxB(NDARK, 3, 24, 3, s * 12, 0, 0);
        neonEdges(k, s * 12 - 1.52, s * 12 + 1.52, 0, 24, -1.52, 1.52, 0.18);
        for (let i = 0; i < 6; i++) { k.E(1.6).box(i % 2 ? 0x39f0ff : 0xff3fd2, 0.12, 1.6, 2.2, s * 12 - s * 1.52, 3 + i * 3.4, 0).L(); }
      }
      k.boxB(NDARK2, 27, 2.2, 2.2, 0, 17.5, 0);
      k.E(2).T(1).box(0xffffff, 27, 0.18, 0.2, 0, 17.4, 1.2).box(0xffffff, 27, 0.18, 0.2, 0, 19.8, 1.2).L();
      k.E(2).P(0.6); for (let i = 0; i < 12; i++) k.box(RAINBOW[i % 7], 1.6, 0.4, 0.2, -9.9 + i * 1.8, 18.6, 1.2); k.L();
      k.box(0x1a1430, 16, 0.3, 0.3, 0, 16.2, 0); for (const x of [-7, 7]) k.box(0x5a5070, 0.12, 1.2, 0.12, x, 16.8, 0);
      return { span: true };
    }, { ao: false, span: true });
  }
  BUILDERS.push(buildNeonProtos);
  LM_DEFS.neon = (L, k, zs) => {
    const zH = zs - 230, zS = zs - 520, zG = zs - 800;
    L.push(mkLm('holo', k, zH, zH + 30, zH - 30, { rects: [-26, -12, zH - 30, zH + 30, 12, 26, zH - 30, zH + 30] }));
    L.push(mkLm('stadium', k, zS, zS + 48, zS - 48, { x: 112, rects: [64, 160, zS - 48, zS + 48] }));
    L.push(mkLm('gate', k, zG, zG + 3, zG - 3, { rects: [-15, 15, zG - 3, zG + 3] }));
  };
  const HOLO_TXT = ['holo0', 'holo1', 'holo2', 'holo3', 'holo4'];
  LM_SPAWN.holo = (lm) => {
    const z = lm.z;
    [[-1, 18], [1, 2], [-1, -16], [1, -24]].forEach(([s, dz], i) => {
      const x = s * 16, zz = z + dz;
      putRaw(P.nPylon, x, 0, zz, 0, 1, PAL.neon[i % 4]);
      const wide = HOLO_TXT[(i + lm.k) % 5], w = wide === 'holo2' || wide === 'holo3' ? 7 : 13;
      putSign(P.sHolo, wide, x, 12.2, zz, s < 0 ? 0.45 : -0.45, w, w === 7 ? 7 : 6.5, PAL.neon[(i + 1) % 4]);
      for (let j = 0; j < 2; j++) putRaw(P.nKiosk, x - s * 2.5, 0, zz + 3 + j * 2.2, s < 0 ? 0 : Math.PI, 1, PAL.neon[(i + j) % 6]);
    });
  };
  LM_SPAWN.stadium = (lm) => {
    const x = lm.x, z = lm.z;
    putRaw(P.lStadium, x, seatY(x, z, 30) - 0.5, z, 0, 1, 0xff3fd2);
    putSign(P.sHolo, 'holo4', x, seatY(x, z, 30) + 18, z - 36.9, 0, 16, 6.5, 0xffffff);
  };
  LM_SPAWN.gate = (lm) => {
    putRaw(P.lGate, 0, 0, lm.z, 0, 1, PAL.neon[lm.k % 4]);
    putSign(P.sHolo, 'holo1', 0, 14.2, lm.z + 0.4, 0, 12, 3.6, 0xffffff);
  };
  // span props (rings/arches) are placed once per chunk, only with the tunnel zone and landmarks checked
  function spanPut(pr, z, color) {
    const bb = pr.geo.boundingBox, z0 = z + bb.min.z, z1 = z + bb.max.z;
    const b = -RR.nearestBoundaryK(z) * C.WORLD_LEN;
    if (z1 > b - TUN - 12 && z0 < b + TUN + 12) return -1;
    if (reservedLm(-30, 30, z0 - 4, z1 + 4)) return -1;
    return putRaw(pr, 0, 0, z, 0, 1, color);
  }
  GEN.neon = function (s) {
    const ry = sideRy(s), dens = G.dens;
    { const off = s < 0 ? 12.5 : 0; for (let z = zg0(25, off); z > G.z1; z -= 25) put(P.nLamp, s * 7.6, z, s < 0 ? Math.PI / 2 : -Math.PI / 2, 1, gridN(z, 25, off) & 1 ? 0xff3fd2 : 0x39f0ff); }
    if (s < 0) for (let z = zg0(75, 37); z > G.z1; z -= 75) spanPut(P.nRing, z, PAL.neon[gridN(z, 75, 37) % 4]);
    let z = G.z0 - rr(0, 4), guard = 0;
    const nearMax = s < 0 ? 24.5 : 30;
    while (z > G.z1 + 3 && guard++ < 16) {
      const t = rnd();
      if (t < 0.5) {
        const pr = rc(0.55) ? P.nLow : P.nLow2, W = pr.spec.W, D = pr.spec.D, zc = z - W / 2 - 0.2;
        if (zc - W / 2 < G.z1) { z -= 3; continue; }
        const x = s * Math.min(nearMax - D / 2, rr(10.5, 13.5) + D / 2);
        const id = put(pr, x, zc, ry, 1, rp(PAL.neon));
        if (id >= 0) { if (pr.spec.sign) { const sg = pr.spec.sign; putSign(P.sGlow, 'neon' + ri(0, 5), x - s * sg.x, lastY + sg.y, zc, s < 0 ? Math.PI / 2 : -Math.PI / 2, sg.w, sg.h, 0xffffff); } z -= W + rr(2, 6) + (1 - dens) * 10; }
        else z -= 3;
      } else if (t < 0.75) { put(P.nPalm, s * rr(9.5, 14), z, rnd() * TAU, rr(0.9, 1.2), rp(PAL.neon)); z -= rr(4, 7); }
      else if (t < 0.9) { put(P.nKiosk, s * rr(9, 12), z, ry, 1, rp(PAL.neon)); z -= 5; }
      else { const x = s * rr(13, 18), id = put(P.nPylon, x, z - 3, 0, 1, rp(PAL.neon)); if (id >= 0) putSign(P.sHolo, rp(HOLO_TXT), x, lastY + 12.2, z - 3, s < 0 ? 0.5 : -0.5, 11, 5.5, rp(PAL.neon)); z -= 10; }
    }
    // mid band: towers 20-60 m (beyond the canal on the left)
    for (let i = 0; i < Math.round(rr(3, 5) * (0.4 + 0.6 * G.farQ)); i++) {
      const w = rr(10, 18), d = rr(10, 18), h = rr(18, 34);
      towerAt(s * rr(s < 0 ? 46 : 28, 80), rr(G.z1 + d / 2 + 1, G.z0 - d / 2 - 1), w, d, h, rp(PAL.neonWall), 1, rr(0.4, 0.6), P.nRoof);
    }
    for (let i = 0; i < Math.round(4 * G.farQ); i++) put(P.nPalm, s * rr(s < 0 ? 44 : 22, 80), rr(G.z1, G.z0), rnd() * TAU, rr(1.1, 1.5), rp(PAL.neon));
    // far band: skyscrapers
    G.far = true;
    for (let i = 0; i < Math.round(rr(3, 5) * (0.4 + 0.6 * G.farQ)); i++) {
      const w = rr(14, 26), d = rr(14, 26), h = rr(45, 130);
      towerAt(s * rr(84, 240), rr(G.z1 + d / 2, G.z0 - d / 2), w, d, h, rp(PAL.neonWall), 1, rr(0.45, 0.65), P.nRoof);
    }
    G.far = false;
  };

  // ================================================================== FROST PEAKS
  const SNOW = 0xf4f8ff, LOG = 0x8a5a3a, LOG2 = 0x6e4630;
  function pine(k, tiers, H, R, seg) {
    k.cylO(0x6a4a34, 0.16, 0.26, H * 0.25, 5, 0, 0, 0);
    k.S(0.1);
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, y0 = H * (0.14 + 0.72 * t), h = H * (0.42 - 0.12 * t), r = R * (1 - 0.62 * t);
      k.T(1).coneO(0xffffff, r, h, seg, 0, y0, 0).T(0);
      k.coneO(SNOW, r * 0.6, h * 0.5 + 0.06, seg, 0, y0 + h * 0.52, 0);
      k.add(gCone(seg, true), SNOW, [0, y0 + 0.02, 0], [0, Math.PI / seg, 0], [r * 1.02, 0.04, r * 1.02]);
    }
    k.S(0);
    return { swayH: H };
  }
  function buildFrostProtos() {
    kitProto('fPine', 900, (k) => pine(k, 4, 8, 2.4, 7));
    kitProto('fPine2', 700, (k) => pine(k, 5, 11, 2.2, 7));
    kitProto('fPineS', 1400, (k) => { // cheap pine for the far band
      k.cylO(0x6a4a34, 0.2, 0.3, 2, 4, 0, 0, 0);
      k.S(0.08).T(1).coneO(0xffffff, 2.6, 5.5, 6, 0, 1.4, 0).coneO(0xffffff, 1.8, 4.5, 6, 0, 4.6, 0).T(0);
      k.coneO(SNOW, 1.15, 2.4, 6, 0, 7.0, 0).S(0);
      return { swayH: 9 };
    });
    kitProto('fCabin', 70, (k) => { // log cabin, front +x
      const W = 7, D = 6, H = 3.2;
      k.add(gBox(), (x, y, z, c) => { c.set((Math.floor((y + 0.6) / 0.42) & 1) ? LOG : LOG2); }, [0, H / 2 - 0.3, 0], null, [D, H + 0.6, W]);
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.add(gBox(), (xx, yy, zz, c) => c.set((Math.floor((yy + 0.6) / 0.42) & 1) ? 0x9a6a48 : 0x7a5038), [x * (D / 2 + 0.05), H / 2 - 0.3, z * (W / 2 + 0.05)], null, [0.5, H + 0.6, 0.5]);
      for (const sgn of [-1, 1]) {
        k.box(0x5a3a2a, D + 1.6, 0.3, W / 2 + 1.1, 0, H + 1.05, sgn * (W / 4 + 0.35), sgn * 0.62, 0, 0);
        k.box(SNOW, D + 1.7, 0.3, W / 2 + 1.0, 0, H + 1.3, sgn * (W / 4 + 0.28), sgn * 0.62, 0, 0);
        k.tri(LOG, -D / 2, H - 0.3, sgn * (W / 2 - 0.001), D / 2, H - 0.3, sgn * (W / 2 - 0.001), 0, H + 1.9, sgn * (W / 2 - 0.001));
      }
      for (let i = 0; i < 8; i++) k.cone(0xe8f6ff, 0.08, 0.4 + (i % 3) * 0.2, 4, -D / 2 - 0.6 + i * (D + 1.2) / 7, H + 0.2 - (i % 3) * 0.1, W / 2 + 1.2, Math.PI);
      k.boxB(0x7a7a88, 1.0, 3.2, 1.0, -1.3, H, -1.6); k.boxB(SNOW, 1.15, 0.3, 1.15, -1.3, H + 3.2, -1.6);
      k.boxB(0x4a2e20, 0.14, 2.2, 1.2, D / 2 + 0.02, 0, 0.9);
      for (const z of [-1.8, 3]) { k.E(1.45).boxB(WARM, 0.14, 1.1, 1.2, D / 2 + 0.02, 1.2, z === 3 ? 2.6 : z).L(); k.box(0xf4ead8, 0.2, 0.12, 1.4, D / 2 + 0.06, 1.2, z === 3 ? 2.6 : z); k.box(0xf4ead8, 0.2, 1.1, 0.1, D / 2 + 0.07, 1.75, z === 3 ? 2.6 : z); }
      for (const sgn of [-1, 1]) { k.E(1.45).boxB(WARM2, 1.2, 1.1, 0.14, 0.2, 1.2, sgn * (W / 2 + 0.02)).L(); k.box(0xf4ead8, 1.4, 0.12, 0.2, 0.2, 1.75, sgn * (W / 2 + 0.06)); }
      k.boxB(0x9a6a48, 1.4, 0.2, W, D / 2 + 0.7, 0, 0);
      k.cylB(0x3e3a52, 0.05, 0.05, 1.8, 5, D / 2 + 1.2, 0.2, -2.6); k.E(2).sph(0xffd080, 0.18, 0.24, 0.18, D / 2 + 1.2, 2.2, -2.6, 6, 4).L();
      for (let i = 0; i < 4; i++) k.cyl(0x9a6a48, 0.18, 0.18, 1.3, 6, -D / 2 - 0.4, 0.2 + (i % 2) * 0.34 + (i > 1 ? 0.34 : 0), -1 + (i % 2) * 0.36, 0, 0, Math.PI / 2);
      k.boxB(SNOW, D + 2.4, 0.12, W + 2.4, 0, -0.06, 0);
    });
    kitProto('fSnowman', 160, (k) => {
      k.sph(0xf8fbff, 0.8, 0.72, 0.8, 0, 0.62, 0, 9, 6); k.sph(0xf8fbff, 0.58, 0.54, 0.58, 0, 1.68, 0, 8, 6); k.sph(0xf8fbff, 0.42, 0.42, 0.42, 0, 2.5, 0, 8, 6);
      k.cone(0xff8a2a, 0.08, 0.5, 6, 0.62, 2.5, 0, 0, 0, -Math.PI / 2);
      for (const z of [-0.15, 0.15]) k.sph(0x1a1a22, 0.05, 0.05, 0.05, 0.38, 2.62, z, 4, 3);
      for (let i = 0; i < 3; i++) k.sph(0x1a1a22, 0.06, 0.06, 0.06, 0.55 - Math.abs(i - 1) * 0.02, 1.45 + i * 0.25, 0, 4, 3);
      k.T(1).tor(0xffffff, 0.42, 0.12, 0, 2.12, 0, Math.PI / 2, 0, 0, 4, 12).box(0xffffff, 0.14, 0.6, 0.22, 0.25, 1.85, 0.3, 0, 0, 0.3).T(0);
      k.cylB(0x1a1a22, 0.36, 0.36, 0.08, 10, 0, 2.82, 0).cylB(0x1a1a22, 0.25, 0.26, 0.45, 10, 0, 2.86, 0);
      k.beam(0x6a4a34, 0, 1.75, 0.5, 0.1, 2.3, 1.25, 0.05, 0.05); k.beam(0x6a4a34, 0, 1.75, -0.5, 0.1, 2.2, -1.2, 0.05, 0.05);
    });
    kitProto('fCrystal', 260, (k) => {
      k.ico(0xdfe8f4, 0.9, 0, 0.2, 0, 1.2, 0.6, 1, 0);
      k.E(2).T(1);
      k.oct(0xffffff, 0.35, 1.6, 0.35, 0, 1.3, 0, 0, 0, 0);
      k.oct(0xe8f4ff, 0.25, 1.1, 0.25, 0.45, 0.9, 0.2, 0.2, 0, -0.45);
      k.oct(0xe8f4ff, 0.28, 1.2, 0.28, -0.4, 0.95, -0.25, -0.2, 0, 0.5);
      k.oct(0xffffff, 0.2, 0.8, 0.2, 0.1, 0.7, -0.5, -0.5, 0, 0);
      k.L();
    });
    kitProto('fLamp', 200, (k) => {
      k.cylB(0x2e2a3a, 0.08, 0.1, 3.4, 6, 0, 0, 0);
      k.box(0x2e2a3a, 0.08, 0.08, 0.7, 0, 3.3, 0.3);
      k.boxB(0x2e2a3a, 0.36, 0.08, 0.36, 0, 2.6, 0.62); k.E(2).boxB(0xffc870, 0.28, 0.46, 0.28, 0, 2.68, 0.62).L(); k.coneB(0x2e2a3a, 0.3, 0.3, 4, 0, 3.14, 0.62);
      k.coneB(SNOW, 0.26, 0.12, 4, 0, 3.4, 0.62);
    });
    kitProto('fFence', 200, (k) => {
      for (let i = 0; i < 3; i++) k.boxB(0x7a5238, 0.16, 1.2, 0.16, 0, 0, -2 + i * 2);
      k.box(0x8a6242, 0.1, 0.14, 4.4, 0, 0.9, 0); k.box(0x8a6242, 0.1, 0.14, 4.4, 0, 0.5, 0);
      k.box(SNOW, 0.16, 0.08, 4.4, 0, 1.0, 0);
    });
    kitProto('fRock', 260, (k) => {
      k.ico(0x8a96a8, 1.2, 0, 0.4, 0, 1.3, 0.8, 1.1, 0, 0.4, 0.2, 0.1);
      k.add(gHemi(8, 3), SNOW, [0, 0.95, 0], null, [1.25, 0.45, 1.1]);
      k.ico(0x7a8698, 0.7, 1.1, 0.2, 0.5, 1, 0.8, 1, 0);
    });
    // ski lift parts
    kitProto('fLiftTower', 60, (k) => {
      k.cylB(0x8a8a98, 0.3, 0.4, 10, 8, 0, -1, 0);
      k.box(0x5a5a68, 0.4, 0.4, 4.2, 0, 9.3, 0);
      for (const z of [-1.8, 1.8]) { k.cyl(0x3a3a48, 0.35, 0.35, 0.2, 10, 0, 9.0, z, Math.PI / 2, 0, 0); }
      k.E(2).P(-1).sph(0xff3344, 0.14, 0.14, 0.14, 0, 9.7, 0, 6, 4).L();
    });
    kitProto('fChair', 120, (k) => {
      k.box(0x3a3a48, 0.08, 1.8, 0.08, 0, -0.9, 0);
      k.T(1).boxB(0xffffff, 0.8, 0.12, 1.5, 0.1, -2.1, 0).box(0xffffff, 0.12, 0.7, 1.5, -0.3, -1.75, 0).T(0);
      k.box(0x3a3a48, 0.7, 0.05, 0.05, 0.1, -1.6, -0.75).box(0x3a3a48, 0.7, 0.05, 0.05, 0.1, -1.6, 0.75);
    }, { ao: false, pinned: true });
    kitProto('fCable', 60, (k) => { k.box(0x2a2a34, 1, 0.07, 0.07, 0.5, 0, 0); }, { ao: false });
    kitProto('fStation', 6, (k) => {
      k.boxB(LOG, 7, 4, 8, 0, -1, 0);
      k.box(0x5a3a2a, 8.4, 0.3, 9.4, 0, 3.4, 0, 0, 0, 0.15); k.box(SNOW, 8.5, 0.25, 9.5, 0, 3.62, 0, 0, 0, 0.15);
      k.E(1.45).boxB(WARM, 0.14, 1.2, 4, 3.52, 1.2, 0).L();
      k.cyl(0x5a5a68, 2.1, 2.1, 0.3, 16, 0, 5.2, 0, 0, 0, 0);
      k.boxB(0x8a8a98, 0.6, 5.2, 0.6, 0, 0, 0);
      return {};
    });
    // ice castle (far landmark)
    kitProto('lIce', 3, (k) => {
      const ICE = 0xbfdff2, ICE2 = 0x9fc8e8;
      k.boxB(ICE, 30, 12, 30, 0, -8, 0);
      for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
        k.cylB(ICE2, 3.4, 3.8, 20, 10, x, -8, z);
        k.coneB(0xe8f6ff, 4.2, 9, 10, x, 12, z);
        k.E(2).T(1).oct(0xffffff, 0.5, 1.8, 0.5, x, 22.6, z).L();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.boxB(ICE, 1, 1.2, 1, x + Math.cos(a) * 3.4, 12, z + Math.sin(a) * 3.4); }
      }
      for (let i = 0; i < 12; i++) { const t = -13 + i * 2.4; for (const [x, z] of [[t, -15], [t, 15], [-15, t], [15, t]]) k.boxB(ICE, 1.1, 1.3, 1.1, x, 4, z); }
      k.boxB(ICE2, 12, 16, 12, 0, -8, 0);
      k.cylB(ICE, 3.2, 3.6, 12, 10, 0, 8, 0); k.coneB(0xe8f6ff, 4.2, 14, 10, 0, 20, 0);
      k.E(2).T(1).oct(0xffffff, 0.8, 3, 0.8, 0, 35.5, 0).L();
      k.E(1.6).T(1);
      for (const [x, z] of [[15, 0], [-15, 0], [0, 15], [0, -15]]) { const nx = Math.sign(x), nz = Math.sign(z); k.box(0xffffff, nx ? 0.2 : 2.2, 3.4, nz ? 0.2 : 2.2, x + nx * 0.02, 0.8, z + nz * 0.02); }
      for (const [x, z] of [[6.02, 2], [6.02, -2], [-2, 6.02], [2, 6.02]]) k.box(0xffffff, x > 6 ? 0.2 : 1.2, 1.8, x > 6 ? 1.2 : 0.2, x, 11, z);
      k.L();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; k.oct(0xe8f6ff, 0.9, 2.6, 0.9, Math.cos(a) * 19, -0.5, Math.sin(a) * 19, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3); }
      return { span: false };
    }, { ao: false });
  }
  BUILDERS.push(buildFrostProtos);
  LM_DEFS.snow = (L, k, zs) => {
    const zV = zs - 250, zL = zs - 520, zC = zs - 800;
    L.push(mkLm('village', k, zV, zV + 40, zV - 40, { rects: [9, 60, zV - 40, zV + 40] }));
    L.push(mkLm('lift', k, zL, zL + 10, zL - 10, { rects: [18, 250, zL - 9, zL + 9] }));
    L.push(mkLm('castle', k, zC, zC + 30, zC - 30, { x: 96, rects: [64, 128, zC - 32, zC + 32] }));
  };
  LM_SPAWN.village = (lm) => {
    const z = lm.z;
    const spots = [[13, 26], [14, 8], [13, -10], [15, -28], [28, 18], [30, -2], [29, -22], [44, 8]];
    spots.forEach(([x, dz]) => { const zz = z + dz; putRaw(P.fCabin, x, seatY(x, zz, 4.5), zz, Math.PI + (x > 25 ? rr(-0.3, 0.3) : 0), rr(0.9, 1.1), 0xffffff); });
    for (let i = 0; i < 8; i++) { const zz = z + 32 - i * 9; putRaw(P.fLamp, 9.4, 0, zz, -Math.PI / 2, 1, 0xffffff); }
    for (let i = 0; i < 5; i++) { const x = rr(18, 40), zz = z + rr(-35, 35); putRaw(rc(0.6) ? P.fSnowman : P.fCrystal, x, seatY(x, zz, 1), zz, rr(-1, 1) + Math.PI, rr(0.9, 1.2), rp(PAL.frostAcc)); }
    for (let i = 0; i < 14; i++) { const x = rr(22, 58), zz = z + rr(-38, 38); let ok = true; for (const [sx, sdz] of spots) if (Math.abs(x - sx) < 6.5 && Math.abs(zz - (z + sdz)) < 6.5) ok = false; if (ok) putRaw(P.fPine, x, seatY(x, zz, 1.5), zz, rnd() * TAU, rr(0.9, 1.4), rp(PAL.pine)); }
    putSign(P.sUnl, 'frost' + ri(0, 1), 14 - 3.25, 2.9, z + 8, -Math.PI / 2, 2.6, 0.65, 0xffffff);
  };
  LM_SPAWN.lift = (lm) => {
    const z = lm.z, n = 8, x0 = 26, x1 = 222;
    lm.pts = []; // cable anchor points (x, y) for the up line
    putRaw(P.fStation, x0 - 4, seatY(x0 - 4, z, 5), z, 0, 1, 0xffffff);
    for (let i = 0; i <= n; i++) {
      const x = x0 + (i / n) * (x1 - x0), y = seatY(x, z, 0.5);
      if (i > 0 && i < n) putRaw(P.fLiftTower, x, y, z, 0, 1, 0xffffff);
      lm.pts.push(x, y + (i === 0 || i === n ? 5.2 : 9.0));
    }
    putRaw(P.fStation, x1 + 4, seatY(x1 + 4, z, 5), z, Math.PI, 1, 0xffffff);
    for (let i = 0; i < n; i++) for (const dz of [-1.8, 1.8]) {
      const ax = lm.pts[i * 2], ay = lm.pts[i * 2 + 1], bx = lm.pts[i * 2 + 2], by = lm.pts[i * 2 + 3];
      putRaw(P.fCable, ax, ay, z + dz, 0, [Math.hypot(bx - ax, by - ay), 1, 1], 0xffffff, 0, Math.atan2(by - ay, bx - ax));
    }
    lm.chairs = []; lm.nChair = 22;
    for (let i = 0; i < lm.nChair; i++) lm.chairs.push(putRaw(P.fChair, x0, 0, z, 0, 1, PAL.frostAcc[i % PAL.frostAcc.length]));
    LM_ANIM.lift(lm, 0);
  };
  LM_ANIM.lift = (lm, t) => {
    const pts = lm.pts, n = pts.length / 2 - 1;
    let total = 0; for (let i = 0; i < n; i++) total += Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]);
    for (let c = 0; c < lm.chairs.length; c++) {
      const id = lm.chairs[c]; if (id < 0) continue;
      const up = c < lm.chairs.length / 2;
      let d = ((t * 2.2 + (c % (lm.chairs.length / 2)) * (total / (lm.chairs.length / 2))) % total);
      if (!up) d = total - d;
      let i = 0; for (; i < n - 1; i++) { const L = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]); if (d <= L) break; d -= L; }
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[i * 2 + 2], by = pts[i * 2 + 3], L = Math.hypot(bx - ax, by - ay) || 1, f = Math.min(1, d / L);
      P.fChair.pool.set(id, ax + (bx - ax) * f, ay + (by - ay) * f - 0.05, lm.z + (up ? -1.8 : 1.8), up ? 0 : Math.PI, 1);
    }
  };
  LM_SPAWN.castle = (lm) => {
    const x = lm.x, z = lm.z;
    putRaw(P.lIce, x, seatY(x, z, 16), z, 0.2, 1, 0x9ff0ff);
    for (let i = 0; i < 6; i++) { const a = rnd() * TAU, r = rr(22, 30), xx = x + Math.cos(a) * r, zz = z + Math.sin(a) * r; if (Math.abs(xx) > 50) putRaw(P.fCrystal, xx, seatY(xx, zz, 1), zz, rnd() * TAU, rr(1.5, 2.5), rp(PAL.crystal)); }
  };
  GEN.snow = function (s) {
    const ry = sideRy(s), dens = G.dens;
    for (let z = zg0(30, s < 0 ? 15 : 0); z > G.z1; z -= 30) put(P.fLamp, s * 7.6, z, s < 0 ? Math.PI / 2 : -Math.PI / 2, 1, 0xffffff);
    let z = G.z0 - rr(0, 3), guard = 0;
    while (z > G.z1 + 2 && guard++ < 26) {
      const t = rnd();
      if (t < 0.1) { const id = put(P.fCabin, s * rr(13, 18), z - 4, ry, rr(0.9, 1.05), 0xffffff); z -= id >= 0 ? 9 : 2; continue; }
      if (t < 0.2) put(P.fSnowman, s * rr(9, 16), z, ry + rr(-0.6, 0.6), rr(0.9, 1.2), rp(PAL.frostAcc));
      else if (t < 0.3) put(P.fCrystal, s * rr(9, 18), z, rnd() * TAU, rr(0.8, 1.4), rp(PAL.crystal));
      else if (t < 0.36) put(P.fRock, s * rr(9, 20), z, rnd() * TAU, rr(0.8, 1.4), 0xffffff);
      else if (t < 0.42) put(P.fFence, s * rr(11, 20), z, rr(-0.5, 0.5) + (rc(0.5) ? Math.PI / 2 : 0), 1, 0xffffff);
      else put(rc(0.6) ? P.fPine : P.fPine2, s * rr(9.5, 22), z, rnd() * TAU, rr(0.8, 1.2), rp(PAL.pine));
      z -= rr(1.6, 3.6) * G.sparse;
    }
    // mid band: dense pine forest with clearings
    const nMid = Math.round(34 * G.farQ);
    for (let i = 0; i < nMid; i++) put(rc(0.55) ? P.fPine : P.fPine2, s * rr(22, 82), rr(G.z1, G.z0), rnd() * TAU, rr(0.9, 1.6), rp(PAL.pine));
    for (let i = 0; i < 3; i++) put(P.fRock, s * rr(22, 80), rr(G.z1, G.z0), rnd() * TAU, rr(1.2, 2.6), 0xffffff);
    if (rc(0.25)) put(P.fCrystal, s * rr(24, 70), rr(G.z1, G.z0), rnd() * TAU, rr(1.5, 2.5), rp(PAL.crystal));
    // far band: forests climbing the mountains
    G.far = true;
    const nFar = Math.round(46 * G.farQ);
    for (let i = 0; i < nFar; i++) put(P.fPineS, s * rr(82, 250), rr(G.z1, G.z0), rnd() * TAU, rr(1.2, 2.2), rp(PAL.pine), F_NOOCC);
    G.far = false;
  };

  // ================================================================== STREAMING
  const chunks = []; // active chunk records sorted by c
  const chunkFree = [];
  let cLo = 0, cHi = -1; // built range
  let lastPz = 0, inited = false, quality = null, sceneRef = null, rendererRef = null, cameraRef = null;
  function newChunk() { const ch = chunkFree.pop(); if (ch) return ch; const l = newList(); return { c: 0, list: l.list, slot: l.slot, n: 0 }; }
  function buildChunk(c) {
    const ch = newChunk();
    ch.c = c; ch.n = 0;
    const z0 = -c * CH, zc = z0 - CH / 2;
    const k = Math.floor(Math.max(0, -zc) / C.WORLD_LEN), wi = RR.worldIndexAt(zc), kind = kindAt(wi);
    G.c = c; G.z0 = z0; G.z1 = z0 - CH; G.k = k; G.wi = wi; G.kind = kind; G.rel0 = -z0 - k * C.WORLD_LEN;
    G.dens = quality ? quality.density : 1; G.farQ = quality ? (quality.far || 1) * quality.density : 1; G.sparse = 1 / Math.sqrt(G.dens);
    G.list = ch.list; G.slot = ch.slot; G.n = 0; G.far = false;
    G.lms = landmarksFor(k);
    const gen = GEN[kind];
    if (gen) for (let s = -1; s <= 1; s += 2) { rseed(c, s, 1234); G.nOcc = 0; try { gen(s); } catch (e) { console.error('[RR.worlds] gen', kind, e); } }
    ch.n = G.n; G.list = null;
    stats.built++;
    return ch;
  }
  function freeChunk(ch) {
    const L = ch.list;
    for (let i = 0; i < ch.n; i += 2) remInst(PROTOS[L[i]], L[i + 1]);
    ch.n = 0; chunkFree.push(ch);
    compactTouched();
  }
  const lmListFree = [];
  function spawnLm(lm) {
    const L = lmListFree.pop() || newList();
    lm.items = L.list; lm.slot = L.slot; lm.listRec = L;
    G.list = lm.items; G.slot = lm.slot; G.n = 0; G.kind = 'lm'; G.dens = quality ? quality.density : 1;
    const f = LM_SPAWN[lm.type];
    const saved = R.s;
    rseed(lm.k * 7 + 3, Math.round(lm.z), 99);
    try { if (f) f(lm); } catch (e) { console.error('[RR.worlds] landmark', lm.type, e); }
    R.s = saved;
    lm.n = G.n; G.list = null; lm.active = true;
    lmActive.push(lm);
  }
  function despawnLm(lm) {
    const L = lm.items;
    for (let i = 0; i < lm.n; i += 2) remInst(PROTOS[L[i]], L[i + 1]);
    lm.n = 0; lm.active = false;
    if (lm.listRec) { lmListFree.push(lm.listRec); lm.listRec = null; lm.items = null; }
    compactTouched();
    if (lm.type === 'lighthouse' && beamMesh) beamMesh.visible = false;
    const i = lmActive.indexOf(lm); if (i >= 0) lmActive.splice(i, 1);
  }
  const cLow = (pz) => Math.floor((-pz - C.DESPAWN_BEHIND) / CH), cHigh = (pz) => Math.floor((-pz + C.SPAWN_AHEAD) / CH);
  function streamLandmarks(pz) {
    for (let i = lmActive.length - 1; i >= 0; i--) { const lm = lmActive[i]; if (!(lm.zNear > pz - C.SPAWN_AHEAD && lm.zFar < pz + C.DESPAWN_BEHIND)) despawnLm(lm); }
    const k0 = Math.floor(Math.max(0, -pz) / C.WORLD_LEN);
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const L = landmarksFor(k);
      for (let i = 0; i < L.length; i++) { const lm = L[i]; if (!lm.active && lm.zNear > pz - C.SPAWN_AHEAD && lm.zFar < pz + C.DESPAWN_BEHIND) spawnLm(lm); }
    }
  }
  function clearAll() {
    for (const ch of chunks) { ch.n = 0; chunkFree.push(ch); }
    chunks.length = 0;
    for (const lm of lmActive) { lm.active = false; lm.n = 0; if (lm.listRec) { lmListFree.push(lm.listRec); lm.listRec = null; lm.items = null; } }
    lmActive.length = 0;
    if (beamMesh) beamMesh.visible = false;
    for (const pr of PROTOS) { pr.pool.clear(); pr.live = 0; pr.mesh.visible = false; pr.touched = false; }
    touched.length = 0;
    cLo = 0; cHi = -1;
  }

  // ================================================================== LIFECYCLE
  function init(ctx) {
    if (inited) return;
    const t0 = performance.now();
    sceneRef = ctx.scene; rendererRef = ctx.renderer; cameraRef = ctx.camera; quality = ctx.quality || RR.quality;
    root = new THREE.Group(); root.name = 'rr-worlds'; root.matrixAutoUpdate = false;
    sceneRef.add(root);
    defineSigns(); drawAtlas();
    makeMaterials();
    defProto('sTex', 160, quadGeo(0), { mat: M.tex, cell: true, r: 0.5 });
    defProto('sUnl', 160, quadGeo(1), { mat: M.texGlow, cell: true, r: 0.5 });
    defProto('sGlow', 120, quadGeo(2), { mat: M.texGlow, cell: true, r: 0.5 });
    defProto('sHolo', 60, quadGeo(2), { mat: M.holo, cell: true, r: 0.5, order: 2 });
    buildCityProtos();
    buildCityLandmarkProtos();
    buildTunnelProtos();
    BUILDERS.forEach((f) => f());
    SETS.cityShops = [P.cShop2, P.cShop3, P.cShop4, P.cFlat3, P.cShop2, P.cShop3, P.cDiner];
    SETS.candyNear = [P.kLolly, P.kLolly, P.kLolly2, P.kCotton, P.kCotton, P.kCane, P.kGum, P.kGum, P.kBonbon, P.kMush, P.kCone, P.kDonut];
    SETS.candyMid = [P.kLolly, P.kLolly2, P.kCotton, P.kCane, P.kCone, P.kMush, P.kGum];
    SETS.candyFar = [P.kLolly, P.kLolly2, P.kCotton];
    beamMesh = new THREE.Mesh(beamGeo(), M.beam); beamMesh.name = 'rrw-beam'; beamMesh.visible = false; beamMesh.matrixAutoUpdate = false; beamMesh.frustumCulled = false; beamMesh.renderOrder = 3; root.add(beamMesh);
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('64px "Lilita One"'), document.fonts.load('40px "Fredoka"')]).then(() => drawAtlas(), () => {});
      if (document.fonts.ready) document.fonts.ready.then(() => drawAtlas());
    }
    inited = true;
    stats.initMs = performance.now() - t0;
  }
  function reset(pz) {
    if (!inited) return;
    const t0 = performance.now();
    lastPz = pz;
    clearAll();
    const a = cLow(pz), b = cHigh(pz);
    cLo = a; cHi = a - 1;
    for (let c = a; c <= b; c++) { chunks.push(buildChunk(c)); cHi = c; }
    streamLandmarks(pz);
    updateUniforms(0, null);
    stats.resetMs = performance.now() - t0;
  }
  function updateUniforms(dt, frame) {
    U.uTime.value = frame ? frame.t : U.uTime.value;
    const cam = (frame && frame.camera) || cameraRef;
    if (cam) { cam.updateMatrixWorld(); U.uCam.value.setFromMatrixPosition(cam.matrixWorld); }
    const mats = RR.mats;
    U.uGlowBoost.value = mats && mats.glow ? Math.max(1, mats.glow.color.r) : 1;
    const A = RR.atmo;
    if (A) { U.uRRHor.value.copy(A.horizon); U.uRRMid.value.copy(A.skyMid); U.uRRTop.value.copy(A.skyTop); }
    // haze band colour blended with the sky's per-world weights
    const Wt = RR.sky && RR.sky.weights;
    const hz = U.uRRHaze.value; hz.setRGB(0, 0, 0); let hk = 0, tw = 0;
    for (let i = 0; i < RR.WORLDS.length; i++) {
      const w = Wt ? Wt[i] : (A && A.index === i ? 1 : 0); if (!(w > 0)) continue;
      const hzd = HAZE_BY_KIND[RR.WORLDS[i].kind]; _tc.set(hzd[0]);
      hz.r += _tc.r * w; hz.g += _tc.g * w; hz.b += _tc.b * w; hk += hzd[1] * w; tw += w;
    }
    if (tw > 0) { hz.multiplyScalar(1 / tw); U.uRRHazeK.value = hk / tw; } else { hz.set(0xffd49a); U.uRRHazeK.value = 0.45; }
    const fog = sceneRef && sceneRef.fog;
    if (fog && fog.isFog) { U.uFogNear.value = fog.near; U.uFogFar.value = fog.far; }
  }
  function update(dt, frame) {
    if (!inited || !frame) return;
    const t0 = performance.now();
    const pz = frame.pz;
    if (Math.abs(pz - lastPz) > 400) { reset(pz); return; }
    lastPz = pz;
    updateUniforms(dt, frame);
    const a = cLow(pz), b = cHigh(pz);
    while (chunks.length && chunks[0].c < a) { freeChunk(chunks.shift()); cLo = chunks.length ? chunks[0].c : a; }
    if (!chunks.length) { cLo = a; cHi = a - 1; }
    while (cHi < b) {
      chunks.push(buildChunk(cHi + 1)); cHi++;
      if (performance.now() - t0 > BUILD_MS) break;
    }
    streamLandmarks(pz);
    const t = frame.t || 0;
    for (let i = 0; i < lmActive.length; i++) { const lm = lmActive[i], f = LM_ANIM[lm.type]; if (f) f(lm, t); }
    stats.lastMs = performance.now() - t0;
    if (stats.lastMs > stats.maxMs) stats.maxMs = stats.lastMs;
  }
  function setQuality(q) {
    if (!q) return;
    const prev = quality;
    quality = q;
    if (inited && prev && prev.density !== q.density) reset(lastPz);
  }
  const api = {
    init, reset, update, setQuality,
    stats,
    info() { let live = 0, vis = 0, tris = 0; for (const pr of PROTOS) { live += pr.live; if (pr.mesh.visible) { vis++; tris += pr.mesh.count * (pr.geo.attributes.position.count / 3); } } return { protos: PROTOS.length, visibleMeshes: vis, instances: live, trianglesDrawn: Math.round(tris), chunks: chunks.length, landmarks: lmActive.length, full: stats.full, lastMs: +stats.lastMs.toFixed(2), maxMs: +stats.maxMs.toFixed(2), resetMs: +stats.resetMs.toFixed(1), initMs: +stats.initMs.toFixed(1) }; },
    // test hooks
    _protos: PROTOS,
    _check() { // every list entry must point at a live instance whose owner points back
      let bad = 0, n = 0;
      const lists = chunks.map((c) => [c.list, c.n, c.slot]).concat(lmActive.map((l) => [l.items, l.n, l.slot]));
      for (const [L, len, slot] of lists) for (let i = 0; i < len; i += 2) { const pr = PROTOS[L[i]], id = L[i + 1]; n++; if (id < 0) continue; if (!pr.pool.alive[id] || (!pr.pinned && pr.owner[id] !== slot * 65536 + i && pr.owner[id] !== -1)) bad++; }
      let dead = 0, live = 0; for (const pr of PROTOS) { live += pr.live; for (let i = 0; i < pr.pool.used; i++) if (!pr.pool.alive[i]) dead++; }
      return { entries: n, bad, live, deadSlots: dead };
    }, _landmarks: () => lmActive, _moundY: moundY,
    TUNNEL: { WALL_X: T_WX, WALL_Y: T_WY, CROWN_Y: T_WY + T_CR, SEG: T_SEG }
  };
  RR.register('worlds', api);
})(window.RR);
