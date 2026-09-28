// Materials of the static world (WORLD, SPEC §7.5). One material per merged bucket:
//   std    PBR (MeshStandardMaterial) for everything opaque — concrete, brick, rubber, char,
//          wood, canvas, bark, rock...: vertex colour × the per-vertex detail layer
//          (world-surf.js), with per-vertex roughness / metalness
//   paint  vehicle paint: MeshPhysicalMaterial with a clear coat over the detail layer
//   glass  dark reflective glass (cracked panes through the detail layer)
//   decal  lit, textured with the world atlas (licence plates, posters, road signs)
//   glow / neon / blink / flicker  unlit emissive pieces (values above 1 feed the bloom)
//   fence  blended chain link (mipmapped alpha); leaves: alpha-tested leaf-cluster cards
// 'low' swaps in Lambert / Phong versions without the detail layer (cheap per pixel).
// Every patched material sets customProgramCacheKey, so all meshes of a bucket share one
// program and a mesh created later hits the program cache.

import * as THREE from 'three';

const DETAIL_VERT_PARS = `
attribute vec3 aDet;
attribute vec2 aSurf;
varying vec3 vDet;
varying vec2 vSurf;
`;

const DETAIL_FRAG_PARS = `
uniform highp sampler2DArray uDetail;
uniform float uDetN;
varying vec3 vDet;
varying vec2 vSurf;
vec4 hhD;
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
 * Patch a MeshStandard/Physical material to read the per-vertex surface attributes.
 * @param {THREE.Material} mat
 * @param {object} shared { uDetail, uDetN } uniforms (shared by every world material)
 * @param {string} key program cache key
 */
export function patchDetail(mat, shared, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = shared.uDetail;
    sh.uniforms.uDetN = shared.uDetN;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + DETAIL_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDet = aDet;\nvSurf = aSurf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DETAIL_FRAG_PARS)
      .replace('#include <color_fragment>', `#include <color_fragment>
        hhD = vec4(0.5);
        if (vDet.z > 0.5) {
          hhD = texture(uDetail, vDet);
          // micro grain close to the eye: at 4K the layer alone was magnified ~5x there
          float hhNear = 1.0 - smoothstep(70.0, 260.0, length(vViewPosition));
          if (hhNear > 0.0) {
            vec4 m = texture(uDetail, vec3(vDet.xy * 6.7 + 0.31, 13.0));
            hhD.xy += (m.xy - 0.5) * 0.55 * hhNear;
            hhD.a *= 1.0 + (m.a - 0.5) * 0.35 * hhNear;
          }
        }
        diffuseColor.rgb *= hhD.a * 2.0;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (vSurf.x >= 0.0) roughnessFactor = vSurf.x;
        // floor 0.14: nothing on the map is a mirror under a light carried at the eye
        roughnessFactor = clamp(roughnessFactor + (hhD.b - 0.5) * 0.9, 0.14, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (vSurf.y >= 0.0) metalnessFactor = vSurf.y;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vDet.z > 0.5) {
          vec3 dn = vec3((hhD.xy * 2.0 - 1.0) * uDetN, 1.0);
          normal = normalize(hhTangentFrame(-vViewPosition, normal, vDet.xy) * dn);
        }`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
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
 * Create the world's materials for every tier.
 * @param {{ detail: THREE.DataArrayTexture, atlas: THREE.Texture, chain: THREE.Texture, leaves: THREE.Texture }} tex
 * @returns {{ get(bucket, tier): THREE.Material, uniforms: object, dispose(): void }}
 */
export function createWorldMaterials(tex) {
  const shared = { uDetail: { value: tex.detail }, uDetN: { value: 0.85 } };
  const uniforms = { uTime: { value: 0 } };
  const all = [];
  const track = (m) => { all.push(m); return m; };

  const hi = {
    std: track(patchDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.7 }), shared, 'hh-std-v1')),
    paint: track(patchDetail(new THREE.MeshPhysicalMaterial({
      // the flashlight sits at the eye: its specular peak on a near-mirror coat came straight
      // back into the camera as a blooming glare, so the coat is glossy, not a mirror
      vertexColors: true, roughness: 0.42, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.17, envMapIntensity: 1.1,
    }), shared, 'hh-paint-v1')),
    // glass: mostly Fresnel + the probe; low metalness keeps the flashlight's reflection
    // off camera-facing panes from blowing out
    glass: track(patchDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.32, envMapIntensity: 2.6 }), shared, 'hh-glass-v1')),
    decal: track(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.atlas, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.8 })),
    glow: track(new THREE.MeshBasicMaterial({ vertexColors: true, map: tex.atlas })),
    neon: track(new THREE.MeshBasicMaterial({ vertexColors: true, map: tex.atlas })),
    blink: track(blinkMaterial(uniforms)),
    flicker: track(flickerMaterial(uniforms, tex.atlas)),
    // chain link blends instead of alpha-testing: without MSAA, tested wires crawled and
    // shimmered at range; the mipmapped alpha fades to a soft mesh there instead
    fence: track(new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.chain, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.7, opacity: 0.85,
    })),
    leaves: track(new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.leaves, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, envMapIntensity: 0.4,
    })),
  };
  // 'low': no detail layer, no clear coat, cheap lighting models
  const low = {
    std: track(new THREE.MeshLambertMaterial({ vertexColors: true })),
    paint: track(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: new THREE.Color(0.25, 0.25, 0.25) })),
    glass: track(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: new THREE.Color(0.5, 0.5, 0.5) })),
    decal: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.atlas })),
    glow: hi.glow,
    neon: hi.neon,
    blink: hi.blink,
    flicker: hi.flicker,
    fence: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.chain, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide })),
    leaves: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.leaves, alphaTest: 0.45, side: THREE.DoubleSide })),
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
