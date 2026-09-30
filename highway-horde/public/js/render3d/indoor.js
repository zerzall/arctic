// The indoor light mask of a story level (JOURNEY.md §4.4). Under a roof (`map.roofs`) the sky
// is gone: the hemisphere, the environment probe and (where the sun's shadow map does not
// already do it) the sun or moon light lose `dark` of their strength, so a room reads as a
// room lit by its own lamps, and the fog thins indoors so a big hall is not washed out by
// the bright haze of the day outside. The flashlight and the point lights are untouched.
//
// The mask is a world-space texture (a texel every 8 units or so, linear filtered):
//   R  how much sky light is lost there: the roof's `dark`, less near an opening. Light from
//      outside diffuses in through gaps in the walls (doorways, open gates, a mall's
//      skylights) and fades over a few metres (a max-propagation of "openness" that walls
//      and shut gates block), so a doorway throws daylight onto the floor inside.
//   G  the ceiling height (/ 1020): only what is below it is indoors (the roof's top and a
//      tall building beside it stay in the sun).
// Materials opt in with patchIndoor(): a `#define HH_INDOOR`, the mask's uniforms and a global
// variable `hhUnder`; the chunk patches below (installed once per page, inert without the
// define) evaluate it at the start of the lighting and apply it to the indirect light, the
// directional lights and the fog. The uniforms are page-global: one renderer at a time.

import * as THREE from 'three';

/** World units per mask texel at most (a big level uses coarser texels, ≤ 2048 a side). */
const TEXEL = 8;
const MAX_TEX = 2048;
/** How far daylight carries into a room through an opening (units: e-folding length). */
const SPILL = 46;
/** Obstacles at least this tall (3D model height) stop the light at a room's edge. */
const WALL_H = 60;
/** Extra darkness of the roofs of a section whose lights are out. */
const DARK_OFF = 0.12;

const MASK_PARS = /* glsl */`
uniform sampler2D uIndoorMap;
uniform vec4 uIndoorRect;
uniform float uIndoorSun;
float hhUnder = 0.0;
float hhSunK = 1.0;
`;

// (a single black texel: nothing is indoors; the uniforms point at it until a level sets its mask)
const EMPTY = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
EMPTY.needsUpdate = true;

/** The mask uniforms every patched material shares (page-global). */
export const INDOOR_UNIFORMS = {
  uIndoorMap: { value: EMPTY },
  uIndoorRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uIndoorSun: { value: 0 },
};

(function patchChunks() {
  const C = THREE.ShaderChunk;
  if (!C.lights_fragment_begin || C.lights_fragment_begin.includes('hhIndoor')) return;
  // where the fragment is and how much of the sky it loses (before any light is added up)
  C.lights_fragment_begin = /* glsl */`// hhIndoor
#ifdef HH_INDOOR
{
  vec3 hhIwp = cameraPosition + ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz;
  vec4 hhIm = texture2D( uIndoorMap, ( hhIwp.xz - uIndoorRect.xy ) * uIndoorRect.zw );
  float hhCeil = hhIm.g * 1020.0;
  hhUnder = hhIm.r * ( 1.0 - smoothstep( hhCeil - 2.0, hhCeil + 4.0, hhIwp.y ) );
  hhSunK = 1.0 - hhUnder * uIndoorSun;
}
#endif
` + C.lights_fragment_begin
    .replace('getSunLightInfo( sunLight, directLight );', 'getSunLightInfo( sunLight, directLight );\n\t\t#ifdef HH_INDOOR\n\t\tdirectLight.color *= hhSunK;\n\t\t#endif')
    .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\t#ifdef HH_INDOOR\n\t\tdirectLight.color *= hhSunK;\n\t\t#endif');
  // the sky's share of the indirect light (hemisphere, probe irradiance and reflections)
  C.lights_fragment_end = /* glsl */`#ifdef HH_INDOOR
  #if defined( RE_IndirectDiffuse )
    irradiance *= 1.0 - hhUnder;
    iblIrradiance *= 1.0 - hhUnder;
  #endif
  #if defined( RE_IndirectSpecular )
    radiance *= 1.0 - hhUnder;
    clearcoatRadiance *= 1.0 - hhUnder;
  #endif
#endif
` + C.lights_fragment_end;
  // indoors the haze of the day (or the night's blue fog) mostly stays outside
  C.fog_fragment = C.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', `#ifdef HH_INDOOR
\tfogFactor *= 1.0 - 0.72 * hhUnder;
\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * ( 1.0 - 0.6 * hhUnder ), fogFactor );
#else
\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`);
}());

/**
 * Make a lit material (Standard / Physical / Lambert / Phong) read the indoor mask. Keeps the
 * material's own onBeforeCompile and program key (both extended). Idempotent.
 * @param {THREE.Material} mat
 * @returns {boolean} true when the material was patched now
 */
export function patchIndoor(mat) {
  if (!mat || !mat.isMaterial || (mat.userData && mat.userData.hhIndoor)) return false;
  if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial)) return false;
  const base = mat.customProgramCacheKey();
  const prev = mat.onBeforeCompile;
  mat.userData.hhIndoor = true;
  mat.onBeforeCompile = function (sh, renderer) {
    if (prev) prev.call(this, sh, renderer);
    Object.assign(sh.uniforms, INDOOR_UNIFORMS);
    sh.fragmentShader = '#define HH_INDOOR\n' + sh.fragmentShader.replace('#include <common>', '#include <common>\n' + MASK_PARS);
  };
  mat.customProgramCacheKey = () => base + '|hhIndoor';
  mat.needsUpdate = true;
  return true;
}

/**
 * Patch every lit material under `root` (an Object3D) that is not patched yet.
 * @returns {number} how many were patched
 */
export function patchIndoorTree(root) {
  let n = 0;
  root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) { for (const x of m) if (patchIndoor(x)) n++; } else if (patchIndoor(m)) n++;
  });
  return n;
}

/** Point in an oriented rect { x, y, w, h, a } grown by `pad`. */
function inRect(r, x, y, pad = 0) {
  const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
  const dx = x - r.x, dy = y - r.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= r.w / 2 + pad && Math.abs(ly) <= r.h / 2 + pad;
}

/** Axis-aligned bounds of an oriented rect. */
function boundsOf(r, pad = 0) {
  const c = Math.abs(Math.cos(r.a || 0)), s = Math.abs(Math.sin(r.a || 0));
  const ex = (r.w * c + r.h * s) / 2 + pad, ey = (r.w * s + r.h * c) / 2 + pad;
  return [r.x - ex, r.y - ey, r.x + ex, r.y + ey];
}

/**
 * The skylights of a roof (a mall's glass strips): [{ x, y, w, h, a }] in world space. Shared by
 * the mask (light pours in there) and roofs3d.js (glass panes in the ceiling).
 */
export function skylightsOf(r) {
  if (r.kind !== 'mall' || r.skylights === false) return [];
  const along = r.w >= r.h, L = Math.max(r.w, r.h), Wd = Math.min(r.w, r.h);
  const out = [];
  const n = Math.max(1, Math.floor(L / 260));
  const ca = Math.cos(r.a || 0), sa = Math.sin(r.a || 0);
  for (let i = 0; i < n; i++) {
    const t = -L / 2 + (i + 0.5) * (L / n);
    const lx = along ? t : 0, ly = along ? 0 : t;
    const w = along ? Math.min(90, L / n * 0.45) : Wd * 0.55, h = along ? Wd * 0.55 : Math.min(90, L / n * 0.45);
    out.push({ x: r.x + lx * ca - ly * sa, y: r.y + lx * sa + ly * ca, w, h, a: r.a || 0 });
  }
  return out;
}

/**
 * Build the indoor mask of a level map and point the page-global uniforms at it.
 * @param {object} map the level (roofs, obstacles, sections, gates)
 * @param {object} opts { heightOf(kind, o) → model height, sectionOf(x, y) → index, gateObstacles: Set of gate obstacle ids,
 *   sunK: share of the sun / moon removed indoors (1 without sun shadows) }
 * @returns {{ texture, at(x, y, h): number, setDark(bits), setGateOpen(ids, open), setSunK(k), rects, dispose() } | null}
 */
export function createIndoor(map, opts = {}) {
  const roofs = (map.roofs || []).filter((r) => r.w > 0 && r.h > 0);
  if (!roofs.length) return null;
  const T = Math.max(TEXEL, Math.ceil(Math.max(map.width, map.height) / (MAX_TEX - 4)));
  const x0 = -T * 2, y0 = -T * 2;
  const cw = Math.ceil((map.width + T * 4) / T), ch = Math.ceil((map.height + T * 4) / T);
  const n = cw * ch;
  const dark = new Float32Array(n);     // the roof's own darkness (0 = open sky)
  const ceil = new Float32Array(n);     // ceiling height (+3: its underside counts as indoors)
  const sec = new Int8Array(n).fill(-1); // section of the roof over the texel (lights out)
  const wall = new Uint8Array(n);       // 1 = light stops here (a wall; 2 = a gate's piece)
  const open = new Float32Array(n);     // 1 = open sky, falling off into the rooms
  const heightOf = opts.heightOf || (() => 90);
  const gateIds = opts.gateObstacles || new Set();
  const gateOpen = new Set();
  const texel = (x, y) => [Math.floor((x - x0) / T), Math.floor((y - y0) / T)];
  const eachTexel = (r, pad, fn) => {
    const [bx0, by0, bx1, by1] = boundsOf(r, pad);
    const [tx0, ty0] = texel(bx0, by0), [tx1, ty1] = texel(bx1, by1);
    for (let ty = Math.max(0, ty0); ty <= Math.min(ch - 1, ty1); ty++) {
      for (let tx = Math.max(0, tx0); tx <= Math.min(cw - 1, tx1); tx++) {
        const wx = x0 + (tx + 0.5) * T, wy = y0 + (ty + 0.5) * T;
        if (inRect(r, wx, wy, pad)) fn(ty * cw + tx, wx, wy);
      }
    }
  };
  for (const r of roofs) {
    const d = Math.max(0, Math.min(1, Number.isFinite(r.dark) ? r.dark : 0.75));
    const h = (r.height > 0 ? r.height : 150) + 3;
    const si = opts.sectionOf ? opts.sectionOf(r) : -1;
    eachTexel(r, 0, (i) => {
      if (d > dark[i]) dark[i] = d;
      if (h > ceil[i]) ceil[i] = h;
      if (si >= 0) sec[i] = si;
    });
    // skylights: the sky is (mostly) there
    for (const s of skylightsOf(r)) eachTexel(s, 0, (i) => { dark[i] *= 0.3; });
  }
  // walls (and the gates, shut as built) stop the light
  for (const o of map.obstacles) {
    if (heightOf(o.kind, o) < WALL_H && !o.gate) continue;
    if (o.kind === 'car' || o.kind === 'tree' || o.kind === 'rock') continue;
    const isGate = gateIds.has(o.id);
    eachTexel(o, -Math.min(2, Math.min(o.w, o.h) * 0.25), (i) => { wall[i] = isGate ? 2 : 1; });
  }

  /** Openness everywhere (or inside [tx0..tx1] × [ty0..ty1]): sky = 1, walls = 0, rooms fed by their openings. */
  function solveOpen(tx0 = 0, ty0 = 0, tx1 = cw - 1, ty1 = ch - 1) {
    const blocked = (i) => wall[i] === 1 || (wall[i] === 2 && !gateOpen.has(i));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * cw + tx;
        open[i] = blocked(i) ? 0 : dark[i] > 0 ? 0 : 1;
      }
    }
    const kS = Math.exp(-T / SPILL), kD = Math.exp(-T * Math.SQRT2 / SPILL);
    const relax = (i, j, k) => {
      const v = open[j] * k;
      if (v > open[i]) open[i] = v;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const i = ty * cw + tx;
          if (dark[i] <= 0 || blocked(i)) continue;
          if (tx > 0) relax(i, i - 1, kS);
          if (ty > 0) {
            relax(i, i - cw, kS);
            if (tx > 0) relax(i, i - cw - 1, kD);
            if (tx < cw - 1) relax(i, i - cw + 1, kD);
          }
        }
      }
      for (let ty = ty1; ty >= ty0; ty--) {
        for (let tx = tx1; tx >= tx0; tx--) {
          const i = ty * cw + tx;
          if (dark[i] <= 0 || blocked(i)) continue;
          if (tx < cw - 1) relax(i, i + 1, kS);
          if (ty < ch - 1) {
            relax(i, i + cw, kS);
            if (tx < cw - 1) relax(i, i + cw + 1, kD);
            if (tx > 0) relax(i, i + cw - 1, kD);
          }
        }
      }
    }
  }

  const data = new Uint8Array(n * 4);
  let darkBits = 0;
  /** Write R and G of the texels in the window into the texture data. */
  function writeTexels(tx0 = 0, ty0 = 0, tx1 = cw - 1, ty1 = ch - 1) {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * cw + tx;
        let r = dark[i] * (1 - open[i]);
        if (r > 0 && sec[i] >= 0 && (darkBits & (1 << sec[i]))) r = Math.min(1, r + DARK_OFF * dark[i]);
        data[i * 4] = Math.round(r * 255);
        data[i * 4 + 1] = Math.round(Math.min(1020, ceil[i]) / 4);
        data[i * 4 + 3] = 255;
      }
    }
  }
  solveOpen();
  writeTexels();
  const texture = new THREE.DataTexture(data, cw, ch, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  INDOOR_UNIFORMS.uIndoorMap.value = texture;
  // (sampling at texel centres: uv = (xz - (x0 - T / 2 + T / 2)) / size)
  INDOOR_UNIFORMS.uIndoorRect.value.set(x0, y0, 1 / (cw * T), 1 / (ch * T));
  INDOOR_UNIFORMS.uIndoorSun.value = Number.isFinite(opts.sunK) ? opts.sunK : 0.35;

  return {
    texture,
    /** Sky light lost at (x, y) at height h (0 outside .. 1), as the shaders see it (nearest texel). */
    at(x, y, h = 40) {
      const [tx, ty] = texel(x, y);
      if (tx < 0 || ty < 0 || tx >= cw || ty >= ch) return 0;
      const i = ty * cw + tx;
      if (h > data[i * 4 + 1] * 4 + 2) return 0;
      return data[i * 4] / 255;
    },
    /** Sections whose lights are out (bit i = section i): their rooms get darker. */
    setDark(bits) {
      if ((bits >>> 0) === darkBits) return;
      darkBits = bits >>> 0;
      writeTexels();
      texture.needsUpdate = true;
    },
    /** Gate obstacles opened (or shut): light comes in (or stops) there; re-solved around them. */
    setGateOpen(obstacles, isOpen) {
      let any = false;
      for (const o of obstacles) {
        eachTexel(o, -Math.min(2, Math.min(o.w, o.h) * 0.25), (i) => {
          if (isOpen) gateOpen.add(i); else gateOpen.delete(i);
          any = true;
        });
      }
      if (!any) return;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const o of obstacles) {
        const b = boundsOf(o, 420);
        bx0 = Math.min(bx0, b[0]); by0 = Math.min(by0, b[1]); bx1 = Math.max(bx1, b[2]); by1 = Math.max(by1, b[3]);
      }
      const [tx0, ty0] = texel(bx0, by0), [tx1, ty1] = texel(bx1, by1);
      const w = [Math.max(0, tx0), Math.max(0, ty0), Math.min(cw - 1, tx1), Math.min(ch - 1, ty1)];
      solveOpen(...w);
      writeTexels(...w);
      texture.needsUpdate = true;
    },
    /** Share of the sun / moon light removed under a roof (1 where no shadow map keeps it out). */
    setSunK(k) {
      INDOOR_UNIFORMS.uIndoorSun.value = Math.max(0, Math.min(1, k));
    },
    size: { cw, ch, texel: T },
    dispose() {
      if (INDOOR_UNIFORMS.uIndoorMap.value === texture) {
        INDOOR_UNIFORMS.uIndoorMap.value = EMPTY;
        INDOOR_UNIFORMS.uIndoorSun.value = 0;
      }
      texture.dispose();
    },
  };
}
