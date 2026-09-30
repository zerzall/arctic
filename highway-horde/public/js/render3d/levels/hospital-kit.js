// The interior art kit of C2's story levels (Saint Mercy, Westgate, the Underground): the machinery that
// turns a level's layout (shared/levels/<id>.js: wall obstacles tagged with a style, roofs with a room
// style, and the `map.levelArt` items — door frames, windows, free props) into rooms:
//
//   * walls: each face finished like the room it faces (a floor-to-ceiling paint, a wainscot or tiles
//     below a rail, skirting), cut round the windows in it, a façade outside (the level supplies it);
//   * door frames, lintels up to the ceiling, the leaves (open doors, swing doors with portholes, cages,
//     lift doors), windows with real glass you see the night (or the day) through;
//   * floors (their own bucket, polygon-offset onto the ground so combat decals still lie on top),
//     ceilings (tiles on a T-bar grid with missing tiles, plaster, concrete), and the light fixtures,
//     built per section in their own meshes so a section's lights can go out (JOURNEY.md §4.3);
//   * an atlas of canvas-painted signs, posters, labels and grime per level (`createAtlas`);
//   * by day, shafts of sunlight through the windows and bright patches where they land.
//
// A level art module (render3d/levels/<id>.js) calls `createInteriorArt(ctx, deps, level)` with its
// room finishes, façades, obstacle and item models and atlas; the object returned is the art interface
// of JOURNEY.md §5 (obstacle, roof, props, finish, update, setQuality, dispose, material, gateModel).

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01, seededRng } from '../world-geo.js';
import { DET } from '../world-surf.js';
import { patchDetail } from '../world-mat.js';
import { DETAIL } from '../world-arch.js';
import { atlasUV } from '../world-tex.js';
import { dayAmbientFor } from '../daylight.js';

export { T, DET, shadeHex, mixHex, hash01, seededRng, atlasUV, DETAIL };

const HALF = Math.PI / 2;

/** Geo-builder buckets the kit adds (a level's BUCKETS export spreads these). */
export const KIT_BUCKETS = {
  lvfloor: { det: true },                 // floors (polygon-offset onto the ground)
  lvpic: { uv: true },                    // lit atlas pictures: signs, posters, labels (alpha tested)
  lvlit: { uv: true, ao: false },         // unlit atlas pictures: lit signs, screens, EXIT (HDR)
  lvgrime: { uv: true, ao: false },       // blended atlas decals: blood trails, grime, graffiti
  lvplastic: { uv: true, ao: false },     // translucent sheeting (quarantine plastic)
};

/** Surface shorthand `{ surf: [layer, roughness, metalness] }`. */
export const S = (layer = 0, rough = 0.8, metal = 0) => ({ surf: [layer, rough, metal] });
export const STEEL = S(DET.panel, 0.4, 0.75);
export const CHROME = S(0, 0.22, 0.95);
export const PAINT = S(DET.panel, 0.55, 0.15);
export const PLAST = S(DET.plastic, 0.5, 0);
export const FABRIC = S(DET.fabric, 0.92, 0);
export const WOODS = S(DET.wood, 0.75, 0);
export const CONC = S(DET.concrete, 0.88, 0);

// ---------------------------------------------------------------------------------------------
// Atlas

const ATLASES = new Map();

/**
 * A level's picture atlas: cells packed by a shelf packer on a square canvas painted once per page.
 * @param {string} key cache key (the level id)
 * @param {object} cells name → [w, h] (atlas pixels)
 * @param {function} paint (g, name, w, h, rng) paints one cell (clipped, origin at the cell's corner)
 * @param {number} [size] canvas size
 * @returns {{ uv(name): number[], texture(aniso): THREE.Texture, has(name): boolean }}
 */
export function createAtlas(key, cells, paint, size = 2048) {
  let a = ATLASES.get(key);
  if (a) return a;
  const rects = {};
  let x = 0, y = 0, rowH = 0;
  // tallest first keeps the shelves tight
  const order = Object.entries(cells).sort((p, q) => q[1][1] - p[1][1]);
  for (const [k, [w, h]] of order) {
    if (x + w + 2 > size) { x = 0; y += rowH + 2; rowH = 0; }
    rects[k] = [x, y, x + w, y + h];
    x += w + 2;
    rowH = Math.max(rowH, h);
  }
  if (y + rowH > size) console.warn(`level atlas ${key}: cells overflow (${y + rowH} > ${size})`);
  let canvas = null;
  const paintAll = () => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    let seed = 17;
    for (const [name, [x0, y0, x1, y1]] of Object.entries(rects)) {
      g.save();
      g.beginPath();
      g.rect(x0, y0, x1 - x0, y1 - y0);
      g.clip();
      g.translate(x0, y0);
      try { paint(g, name, x1 - x0, y1 - y0, rng01(seed += 7)); } catch (err) { /* a missing font is not fatal */ }
      g.restore();
    }
    return c;
  };
  a = {
    size,
    has: (name) => !!rects[name],
    uv(name) {
      const r = rects[name] || rects.white || Object.values(rects)[0];
      return [r[0] / size, 1 - r[3] / size, r[2] / size, 1 - r[1] / size];
    },
    texture(aniso = 8) {
      if (!canvas) canvas = paintAll();
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    },
  };
  ATLASES.set(key, a);
  return a;
}

/** Small deterministic rng → [0, 1). */
export function rng01(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- painting helpers (shared by the three atlases) --------------------------------------------

export const FONT = '"Arial Black","Helvetica Neue",Arial,"DejaVu Sans","Liberation Sans",sans-serif';
export const SANS = 'Helvetica,Arial,"DejaVu Sans","Liberation Sans",sans-serif';
export const HAND = '"Marker Felt","Comic Sans MS","Segoe Print","DejaVu Sans","Liberation Sans",sans-serif';
export const SERIF = 'Georgia,"DejaVu Serif","Liberation Serif",serif';

/** Text fitted into a box (centred; shrinks to fit the width). */
export function text(g, str, cx, cy, w, h, o = {}) {
  let size = Math.min(o.max || 999, h);
  const font = o.font || FONT;
  const setF = () => { g.font = `${o.italic ? 'italic ' : ''}${o.weight || 'bold'} ${size}px ${font}`; };
  setF();
  const m = g.measureText(str).width;
  if (m > w) { size = Math.max(4, size * (w / m)); setF(); }
  g.textAlign = o.align || 'center';
  g.textBaseline = 'middle';
  if (o.stroke) { g.lineWidth = o.strokeW || Math.max(1, size * 0.12); g.strokeStyle = o.stroke; g.lineJoin = 'round'; g.strokeText(str, cx, cy); }
  if (o.glow) { g.save(); g.shadowColor = o.glow; g.shadowBlur = size * 0.4; g.fillStyle = o.color || '#fff'; g.fillText(str, cx, cy); g.restore(); }
  g.fillStyle = o.color || '#fff';
  g.fillText(str, cx, cy);
  return size;
}

/** Rounded rectangle path. */
export function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Grime over a painted cell: specks, a darkening toward the bottom, scratches. */
export function weather(g, w, h, r, k = 1) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 90 * k; i++) {
    g.fillStyle = `rgba(${r() < 0.6 ? '28,22,16' : '220,210,190'},${0.03 + r() * 0.1})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 3);
  }
  for (let i = 0; i < 6 * k; i++) {
    g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r() * 0.1})`;
    g.lineWidth = 0.6 + r();
    g.beginPath();
    const x = r() * w, y = r() * h;
    g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * w * 0.4, y + (r() - 0.5) * h * 0.2);
    g.stroke();
  }
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(24,18,10,${0.25 * k})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** A wayfinding / door sign: a coloured panel, white lettering, an optional arrow and pictogram. */
export function panelSign(g, w, h, r, o) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = o.bg || '#1d4f8a';
  rrect(g, 1, 1, w - 2, h - 2, Math.min(w, h) * 0.12);
  g.fill();
  if (o.band) { g.fillStyle = o.band; g.fillRect(2, h - h * 0.16, w - 4, h * 0.12); }
  const left = o.icon ? h * 0.9 : w * 0.06;
  if (o.icon) o.icon(g, h * 0.1, h * 0.1, h * 0.8);
  const tw = w - left - (o.arrow ? h : 0) - w * 0.05;
  if (o.sub) {
    text(g, o.text, left + tw / 2, h * 0.38, tw, h * 0.42, { color: o.fg || '#fff', font: o.font || SANS });
    text(g, o.sub, left + tw / 2, h * 0.74, tw, h * 0.22, { color: o.fg2 || 'rgba(255,255,255,0.85)', font: SANS, weight: 'normal' });
  } else {
    text(g, o.text, left + tw / 2, h / 2 + 1, tw, h * 0.56, { color: o.fg || '#fff', font: o.font || SANS });
  }
  if (o.arrow) arrow(g, w - h * 0.62, h / 2, h * 0.36, o.arrow, o.fg || '#fff');
  weather(g, w, h, r, o.dirt ?? 0.4);
}

/** An arrow (dir 'r' | 'l' | 'u' | 'd') centred at (x, y). */
export function arrow(g, x, y, s, dir, color) {
  const rot = { r: 0, d: HALF, l: Math.PI, u: -HALF }[dir] || 0;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(s, 0); g.lineTo(0, -s * 0.8); g.lineTo(0, -s * 0.32); g.lineTo(-s, -s * 0.32); g.lineTo(-s, s * 0.32); g.lineTo(0, s * 0.32); g.lineTo(0, s * 0.8);
  g.closePath();
  g.fill();
  g.restore();
}

/** Blood: drips, smears and splats (alpha on transparent). kind 'splat' | 'trail' | 'hand' | 'drip' | 'pool'. */
export function blood(g, w, h, r, kind) {
  g.clearRect(0, 0, w, h);
  const col = () => `rgba(${90 + (r() * 40) | 0},${(r() * 12) | 0},${(r() * 10) | 0},${0.55 + r() * 0.4})`;
  if (kind === 'trail') {
    // a body dragged along: two smeared tracks, clots, handprints at the edges
    for (let k = 0; k < 2; k++) {
      const y0 = h * (0.34 + k * 0.3);
      for (let x = 0; x < w; x += 2) {
        const th = h * (0.12 + 0.08 * Math.sin(x * 0.05 + k * 3) + r() * 0.05) * (0.4 + 0.6 * Math.min(1, x / (w * 0.2)));
        g.fillStyle = `rgba(${95 + (r() * 30) | 0},6,6,${0.25 + 0.35 * r()})`;
        g.fillRect(x, y0 - th / 2 + Math.sin(x * 0.02 + k) * h * 0.04, 3, th);
      }
    }
    for (let i = 0; i < 26; i++) { g.fillStyle = col(); g.beginPath(); g.ellipse(r() * w, h * (0.25 + r() * 0.5), 2 + r() * 6, 1 + r() * 4, r() * 3, 0, 6.3); g.fill(); }
    for (let i = 0; i < 3; i++) hand(g, w * (0.2 + i * 0.3) + r() * 20, h * (r() < 0.5 ? 0.14 : 0.86), h * 0.13, r() * 6.2, col());
    return;
  }
  if (kind === 'hand') {
    for (let i = 0; i < 5; i++) hand(g, w * (0.18 + r() * 0.64), h * (0.2 + r() * 0.6), Math.min(w, h) * (0.16 + r() * 0.08), (r() - 0.5) * 0.9, col());
    // a smear dragged down from one of them
    g.fillStyle = 'rgba(100,8,8,0.45)';
    for (let y = h * 0.5; y < h; y += 2) g.fillRect(w * 0.5 + Math.sin(y * 0.1) * 3, y, 10 - (y - h * 0.5) / h * 10, 2);
    return;
  }
  if (kind === 'drip') {
    for (let i = 0; i < 9; i++) {
      const x = w * (0.1 + r() * 0.8), len = h * (0.3 + r() * 0.7), wd = 2 + r() * 4;
      g.fillStyle = col();
      g.fillRect(x, 0, wd, len);
      g.beginPath(); g.arc(x + wd / 2, len, wd * 0.9, 0, 6.3); g.fill();
    }
    g.fillStyle = 'rgba(110,8,8,0.8)';
    g.fillRect(0, 0, w, h * 0.08);
    return;
  }
  // a splat / a pool: a blob with satellite drops
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * (kind === 'pool' ? 0.42 : 0.28);
  g.fillStyle = kind === 'pool' ? 'rgba(70,4,4,0.85)' : col();
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * 6.283, rr = R * (0.7 + r() * 0.45);
    if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
  for (let i = 0; i < 30; i++) {
    const a = r() * 6.28, d = R * (1 + r() * 1.1);
    g.fillStyle = col();
    g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + r() * R * 0.12, 0, 6.3); g.fill();
  }
}

function hand(g, x, y, s, rot, color) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = color;
  g.beginPath(); g.ellipse(0, s * 0.25, s * 0.42, s * 0.5, 0, 0, 6.3); g.fill();
  for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(-s * 0.3 + f * s * 0.2, -s * 0.45, s * 0.08, s * 0.32, (f - 1.5) * 0.12, 0, 6.3); g.fill(); }
  g.beginPath(); g.ellipse(s * 0.5, 0.05 * s, s * 0.08, s * 0.28, -0.9, 0, 6.3); g.fill();
  g.restore();
}

/** Spray-paint graffiti words (alpha on transparent). */
export function graffiti(g, w, h, r, str, color, o = {}) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate((r() - 0.5) * 0.12 + (o.tilt || 0));
  const size = text(g, str, 0, 0, w * 0.92, h * 0.7, { color, font: o.font || HAND, max: o.max });
  // overspray and runs
  g.globalAlpha = 0.5;
  for (let i = 0; i < 16; i++) {
    const x = (r() - 0.5) * w * 0.85, y = size * 0.3;
    g.fillStyle = color;
    g.fillRect(x, y, 1.5, size * (0.2 + r() * 0.6));
  }
  g.restore();
}

/** Stained grime: a soft blotch (alpha). */
export function grime(g, w, h, r, color = '40,30,20') {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    const x = w * (0.2 + r() * 0.6), y = h * (0.2 + r() * 0.6), R = Math.min(w, h) * (0.1 + r() * 0.3);
    const grd = g.createRadialGradient(x, y, 0, x, y, R);
    grd.addColorStop(0, `rgba(${color},${0.12 + r() * 0.15})`);
    grd.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }
}

// ---------------------------------------------------------------------------------------------
// Materials

function makeMaterials(deps, atlasTex, day) {
  const shared = deps.mats && deps.mats.shared;
  const all = [];
  const track = (m) => { all.push(m); return m; };
  const std = (o, key) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, envMapIntensity: 0.8, ...o });
    return shared ? patchDetail(m, shared, key) : m;
  };
  const hi = {
    lvfloor: track(std({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, roughness: 0.5 }, 'hh-lvfloor-v1')),
    lvpic: track(new THREE.MeshStandardMaterial({ vertexColors: true, map: atlasTex, alphaTest: 0.5, roughness: 0.62, metalness: 0.02, envMapIntensity: 0.7 })),
    lvlit: track(new THREE.MeshBasicMaterial({ vertexColors: true, map: atlasTex, alphaTest: 0.35 })),
    lvgrime: track(new THREE.MeshStandardMaterial({ vertexColors: true, map: atlasTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: 0.45, metalness: 0, envMapIntensity: 0.9 })),
    lvplastic: track(new THREE.MeshStandardMaterial({ vertexColors: true, map: atlasTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.28, metalness: 0, envMapIntensity: 1.2, opacity: 0.55 })),
  };
  const low = {
    lvfloor: track(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
    lvpic: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex, alphaTest: 0.5 })),
    lvlit: hi.lvlit,
    lvgrime: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })),
    lvplastic: track(new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.5 })),
  };
  // (by day the lit signs are paint in the sun)
  hi.lvlit.color.setScalar(day ? 0.45 : 1);
  return { hi, low, all, get: (b, t) => (t === 'low' ? low : hi)[b] || hi[b] };
}

/** Unlit fixture material whose pieces stutter now and then (failing tubes). */
function fixtureMaterial(uTime, flicker) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  if (!flicker) return m;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vFk;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 hhW = modelMatrix * vec4(position, 1.0);
        float hhPh = fract(sin(dot(floor(hhW.xz / 40.0), vec2(12.9898, 78.233))) * 43758.5453);
        float hhT = uTime * (0.5 + hhPh * 0.9) + hhPh * 17.0;
        float burst = step(0.7, fract(hhT * 0.19));
        float stut = step(0.42, fract(sin(floor(uTime * 24.0 + hhPh * 40.0) * 91.7) * 4375.5));
        vFk = mix(1.0, 0.04 + 0.96 * stut, burst) * (0.92 + 0.08 * sin(uTime * 120.0 + hhPh * 9.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFk;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFk;');
  };
  m.customProgramCacheKey = () => 'hh-lvfix-flicker-v1';
  return m;
}

// ---------------------------------------------------------------------------------------------
// The art

/**
 * The interior art of a level.
 * @param {object} ctx renderer ctx (ctx.map)
 * @param {object} deps world deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder, matOf }
 * @param {object} level {
 *   id, atlas (createAtlas result),
 *   rooms: { [roofStyle]: finish },          the look of each room style (see `finishOf`)
 *   walls: { [wallStyle]: { face, top?, draw? } },  wall styles: a finish for faces with no room (`face`),
 *                                               the wall's own top height, or a draw(P) that draws it all
 *   facade(P, F, seg): draws an exterior face segment (F: a face of the wall piece),
 *   obstacles: { [style]: fn(P) },              models of obstacles by o.style (P = prop context)
 *   items: { [t]: fn(P) },                      models of map.levelArt items by t
 *   gate(P): the model of a gate piece (closed), in the piece's frame
 *   ceilings: { [kind]: fn(P, r, fin) }         special ceilings by finish.ceil.kind
 * }
 */
export function createInteriorArt(ctx, deps, level) {
  const map = ctx.map;
  const day = !!deps.day;
  const gy = deps.gy || (() => 0);
  const aniso = deps.aniso || 8;
  const atlas = level.atlas;
  const tex = atlas.texture(aniso);
  const M = makeMaterials(deps, tex, day);
  let tier = deps.tier || 'high';
  const lod = () => DETAIL.level;
  const uTime = { value: 0 };
  const halos = deps.halos || [];
  const items = map.levelArt || [];
  const rng = seededRng((map.seed | 0) * 7919 + 13);

  // ---- rooms: a grid index of the roofs ----------------------------------------------------------
  const roofs = map.roofs || [];
  const CELL = 400;
  const grid = new Map();
  roofs.forEach((r, i) => {
    for (let cy = Math.floor((r.y - r.h / 2) / CELL); cy <= Math.floor((r.y + r.h / 2) / CELL); cy++) {
      for (let cx = Math.floor((r.x - r.w / 2) / CELL); cx <= Math.floor((r.x + r.w / 2) / CELL); cx++) {
        const k = cx + ',' + cy;
        const l = grid.get(k);
        if (l) l.push(i); else grid.set(k, [i]);
      }
    }
  });
  /** The roof (room) over a point, or null. */
  function roomAt(x, y) {
    const l = grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
    if (!l) return null;
    let best = null;
    for (const i of l) {
      const r = roofs[i];
      if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(y - r.y) <= r.h / 2) {
        if (!best || r.w * r.h < best.w * best.h) best = r;   // the smallest room wins (nested)
      }
    }
    return best;
  }
  /** The floor height of a room (the terrain under its centre: the upper level of a mall stands on a plateau). */
  const baseCache = new WeakMap();
  function roomBase(r) {
    let b = baseCache.get(r);
    if (b === undefined) { b = gy(r.x, r.y); baseCache.set(r, b); }
    return b;
  }
  /** The floor height at a window (cached; the map's own items are never written). */
  function winBase(it) {
    let b = baseCache.get(it);
    if (b === undefined) { b = sideBase(it, it.th || 16); baseCache.set(it, b); }
    return b;
  }
  const FIN_DEFAULT = { floor: '#8a877e', upper: '#cfcac0', lower: null, skirt: '#3a3a38', ceil: '#d8d6ce', ceilKind: 'plain' };
  /** The finish (look) of a room. */
  function finishOf(r) {
    if (!r) return null;
    return (level.rooms && level.rooms[r.style]) || FIN_DEFAULT;
  }

  // ---- windows and doors on the walls ------------------------------------------------------------
  const windows = items.filter((it) => it.t === 'window');
  const doors = items.filter((it) => it.t === 'door');
  /** The floor height beside a wall item (door, window): the higher of its two sides (a raised floor stands on terrain). */
  function sideBase(it, th) {
    const [ax, ay] = toWorld(it, 0, th / 2 + 16), [bx, by] = toWorld(it, 0, -th / 2 - 16);
    return Math.max(gy(ax, ay), gy(bx, by), gy(it.x, it.y));
  }

  /** Windows lying in wall piece o (normalised by wallFrame), as holes in its local frame: { t, y0, y1, w, it }. */
  function holesOf(o) {
    const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
    const out = [];
    for (const it of windows) {
      const dx = it.x - o.x, dy = it.y - o.y;
      const lx = dx * c + dy * s, lz = -dx * s + dy * c;
      if (Math.abs(lz) > o.h / 2 + 2 || Math.abs(lx) > o.w / 2) continue;
      // (a window's own axis must run along the wall)
      if (Math.abs(Math.sin((it.a || 0) - (o.a || 0))) > 0.1) continue;
      const wb = winBase(it);
      out.push({ t: lx, y0: wb + it.sill, y1: wb + it.sill + it.h, w: it.w, it });
    }
    return out.sort((p, q) => p.t - q.t);
  }

  // ---- placing a frame at an absolute height (the terrain lifts object frames) ---------------------
  /** B.obj at sim (x, y) with the frame's y = 0 at world height `base` (ignoring the terrain). */
  function at(B, x, y, a = 0, seed = 0, base = 0) {
    B.obj(x, y, a, seed, base - gy(x, y));
    return B;
  }
  /** World position of a local point of an object (o.x, o.y, o.a). */
  function toWorld(o, lx, lz) {
    const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
    return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
  }

  // ---- the prop context and the picture helpers ----------------------------------------------------
  const api = {
    map, day, gy, halos, atlas, rng, at, toWorld, roomAt, finishOf, lod, S, STEEL, CHROME, PAINT, PLAST, FABRIC, WOODS, CONC,
    get tier() { return tier; },
    full: deps.full || deps.tier,
    /** An atlas picture on a plane facing local +z (ry turns it), in the lit or the unlit bucket. */
    pic(B, cell, x, y, z, w, h, ry = 0, o = {}) {
      B.add(o.lit ? 'lvlit' : 'lvpic', T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry, o.rz || 0], o.color || '#ffffff', { uv: atlas.uv(cell), noAO: true, noJitter: true, emissive: o.lit ? (o.k ?? 2.2) : undefined });
    },
    /** A picture lying on the floor or on a surface (facing up), rotated `rot` about y. */
    flat(B, cell, x, y, z, w, d, rot = 0, o = {}) {
      B.add(o.bucket || 'lvgrime', T.plane(), [x, y, z], [w, d, 1], [-HALF, rot, 0], o.color || '#ffffff', { uv: atlas.uv(cell), noAO: true, noJitter: true, emissive: o.k });
    },
    /** A blended decal on a vertical face (grime, blood, graffiti) facing local +z. */
    decal(B, cell, x, y, z, w, h, ry = 0, o = {}) {
      B.add('lvgrime', T.plane(), [x, y, z], [w, h, 1], [0, ry, o.rz || 0], o.color || '#ffffff', { uv: atlas.uv(cell), noAO: true, noJitter: true });
    },
    /** An emissive glow box (unlit, world 'glow' bucket). */
    glow(B, x, y, z, sx, sy, sz, color, k = 3, r = null) {
      B.add('glow', T.box(), [x, y, z], [sx, sy, sz], r, color, { emissive: k, uv: atlasUV('white'), noAO: true, noJitter: true });
    },
    /** A halo sprite at a world point (height h). */
    halo(x, y, h, color, size = 60, strength = 0.5, flicker = 0) {
      halos.push({ x, y, h, color, size, strength, flicker });
    },
  };

  /** A prop context for an obstacle or an item. */
  const P = (B, it, extra) => ({ ...api, B, it, o: it, L: it.w || 0, W: it.h || 0, ...extra });

  // ---- walls ---------------------------------------------------------------------------------------
  const warned = new Set();
  function warnOnce(k, err) {
    if (warned.has(k)) return;
    warned.add(k);
    console.warn('level art:', k, err || '');
  }

  /** A wall piece in its own frame: local x along the wall (w = the length), z across it (h = the thickness). */
  function wallFrame(o) {
    if (o.w >= o.h) return o;
    return { ...o, w: o.h, h: o.w, a: (o.a || 0) + HALF };
  }

  /**
   * Draw a wall piece: both faces finished per room, the top and the ends. Faces and bands are
   * quads (their detail runs on across neighbouring pieces), cut round the windows.
   */
  function drawWall(B, o0) {
    const o = wallFrame(o0);
    const ws = (level.walls && level.walls[o.style]) || {};
    const L = o.w, W = o.h;
    const base = 0;
    at(B, o.x, o.y, o.a || 0, o.id * 31, base);
    B.setJitter(0.012);
    const holes = holesOf(o);
    const faces = [];
    let top = ws.top || 0;
    const n = Math.max(1, Math.round(L / 50));
    for (const s of [1, -1]) {
      // sample the rooms along the face
      const segs = [];
      const bins = [];
      for (let i = 0; i < n; i++) {
        const t0 = -L / 2 + (i * L) / n, t1 = -L / 2 + ((i + 1) * L) / n;
        const [wx, wy] = toWorld(o, (t0 + t1) / 2, s * (W / 2 + 16));
        const room = roomAt(wx, wy);
        const last = segs[segs.length - 1];
        if (last && last.room === room) last.t1 = t1; else segs.push({ t0, t1, room });
        bins.push(segs[segs.length - 1]);
      }
      for (const sg of segs) {
        sg.fin = finishOf(sg.room);
        sg.h = sg.room ? (sg.fin.tall || sg.room.height) : 0;
        sg.base = sg.room && !sg.fin.tall ? roomBase(sg.room) : 0;
        if (sg.base + sg.h > top) top = sg.base + sg.h;
      }
      faces.push({ s, segs, bins });
    }
    if (!top) top = ws.h || 120;
    for (const f of faces) {
      for (const sg of f.segs) {
        if (sg.room) interiorFace(B, o, f.s, sg.t0, sg.t1, sg.h, sg.fin, holes, ws, top, sg.base);
        else if (level.facade) {
          try { level.facade(P(B, o, { ws }), f.s, sg.t0, sg.t1, holes, top); } catch (err) { warnOnce('facade ' + o.style, err); }
        } else plainFace(B, o, f.s, sg.t0, sg.t1, 0, top, ws.face || FIN_DEFAULT.upper, holes, S(DET.drywall, 0.85, 0));
      }
    }
    // the top, in runs of one height (a wall between a tall hall and a low shop steps down), and the ends
    const binTop = (i) => {
      let h = 0;
      for (const f of faces) {
        const sg = f.bins[i];
        const t = -L / 2 + ((i + 0.5) * L) / n;
        h = Math.max(h, sg.room ? sg.base + sg.h : facadeTopAt(ws, o, t, top));
      }
      return h;
    };
    const runs = [];
    for (let i = 0; i < n; i++) {
      const h = binTop(i), t0 = -L / 2 + (i * L) / n, t1 = -L / 2 + ((i + 1) * L) / n;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last.h - h) < 0.5) last.t1 = t1; else runs.push({ t0, t1, h });
    }
    const topH = Math.max(top, ...runs.map((r) => r.h));
    if (ws.after) { try { ws.after(P(B, o, { ws, faces, top: topH })); } catch (err) { warnOnce('wall after ' + o.style, err); } at(B, o.x, o.y, o.a || 0, o.id * 31, base); }
    const capC = shadeHex(ws.face || '#8a877e', -0.2), endC = shadeHex(ws.face || '#9a968c', -0.1);
    runs.forEach((r, i) => {
      B.quad('std', [(r.t0 + r.t1) / 2, r.h, 0], [r.t1 - r.t0, 0, 0], [0, 0, -W], capC, S(DET.concrete, 0.9, 0));
      const nx = runs[i + 1];
      if (nx) {
        // the step between two runs, facing the lower one
        const lo = Math.min(r.h, nx.h), hi = Math.max(r.h, nx.h), e = nx.h > r.h ? -1 : 1;
        B.quad('std', [r.t1, (lo + hi) / 2, 0], [0, 0, -e * W], [0, hi - lo, 0], endC, S(DET.drywall, 0.9, 0));
      }
    });
    const h0 = runs[0].h, h1 = runs[runs.length - 1].h;
    B.quad('std', [-L / 2, h0 / 2, 0], [0, 0, W], [0, h0, 0], endC, S(DET.drywall, 0.9, 0));
    B.quad('std', [L / 2, h1 / 2, 0], [0, 0, -W], [0, h1, 0], endC, S(DET.drywall, 0.9, 0));
  }

  /** The height a wall's outside face rises to at t along it: `ws.facadeTop` (a number, or fn(x, y) of the world point). */
  function facadeTopAt(ws, o, t, fallback) {
    const f = ws.facadeTop;
    if (typeof f === 'function') { const [wx, wy] = toWorld(o, t, 0); return f(wx, wy); }
    return f || fallback;
  }

  /** A face quad (along the wall, t0..t1, y0..y1) at the face s·W/2 (+ out), cut round the holes. */
  function plainFace(B, o, s, t0, t1, y0, y1, color, holes, surf, out = 0.05) {
    const z = s * (o.h / 2 + out);
    let cur = t0;
    const band = (a, b, ya, yb) => {
      if (b - a < 0.05 || yb - ya < 0.05) return;
      B.quad('std', [(a + b) / 2, (ya + yb) / 2, z], [s * (b - a), 0, 0], [0, yb - ya, 0], color, surf);
    };
    for (const hl of holes) {
      const h0 = hl.t - hl.w / 2, h1 = hl.t + hl.w / 2;
      if (h1 <= t0 || h0 >= t1) continue;
      const a = Math.max(t0, h0), b = Math.min(t1, h1);
      band(cur, a, y0, y1);
      band(a, b, y0, Math.min(y1, Math.max(y0, hl.y0)));
      band(a, b, Math.max(y0, Math.min(y1, hl.y1)), y1);
      cur = b;
    }
    band(cur, t1, y0, y1);
  }

  /** An interior face segment: skirting, the lower finish (tiles / wainscot) to the rail, the upper paint. */
  function interiorFace(B, o, s, t0, t1, h, fin, holes, ws, top, base = 0) {
    if (fin.tall) { plainFace(B, o, s, t0, t1, 0, fin.tall, fin.upper, holes, fin.upperSurf || S(fin.upperDet ?? DET.drywall, 0.85, 0)); return; }
    const b0 = base;
    const lowH = fin.lowerH || 0;
    const skirtH = fin.skirtH ?? 5;
    const upSurf = fin.upperSurf || S(fin.upperDet ?? DET.drywall, fin.upperRough ?? 0.82, 0);
    const lowSurf = fin.lowerSurf || S(fin.lowerDet ?? DET.tile, fin.lowerRough ?? 0.45, 0);
    if (lowH > 0) {
      plainFace(B, o, s, t0, t1, b0, b0 + lowH, fin.lower || fin.upper, holes, lowSurf);
      plainFace(B, o, s, t0, t1, b0 + lowH, b0 + h, fin.upper, holes, upSurf);
    } else {
      plainFace(B, o, s, t0, t1, b0, b0 + Math.min(h, 34), fin.upper, holes, upSurf);
      plainFace(B, o, s, t0, t1, b0 + Math.min(h, 34), b0 + h, fin.upper, holes, upSurf);
    }
    const len = t1 - t0, mid = (t0 + t1) / 2, z = s * o.h / 2;
    // skirting and the rail (a bumper rail in hospitals, a dado rail elsewhere)
    if (skirtH > 0) B.box('std', mid, b0 + skirtH / 2, z + s * 0.6, len, skirtH, 1.2, fin.skirt || '#3a3a38', null, S(DET.plastic, 0.5, 0));
    if (fin.rail && lod() >= 1) {
      const railY = b0 + (fin.railY ?? (lowH || 32));
      for (const [a, b] of spansAround(t0, t1, holes, railY)) {
        B.rbox('std', (a + b) / 2, railY, z + s * 1.4, b - a, fin.railH || 3.2, 2.8, 0.8, fin.rail, null, fin.railSurf || S(DET.plastic, 0.4, 0.05));
      }
    }
    // a cornice / shadow gap at the ceiling
    if (fin.cornice && lod() >= 1) B.box('std', mid, b0 + h - 1.2, z + s * 0.9, len, 2.4, 1.8, fin.cornice, null, S(DET.plaster, 0.8, 0));
    // the room's wall dressing: grime near the floor, a stain
    if (fin.grime && lod() >= 1 && len > 60) {
      const r = hash01(o.id * 13 + (s > 0 ? 1 : 0) + Math.round(t0));
      if (r < fin.grime) {
        const gx = t0 + len * (0.2 + 0.6 * hash01(o.id * 7 + Math.round(t1)));
        const cells = fin.grimeCells || level.grimeCells || ['grime'];
        const cell = cells[Math.floor(hash01(o.id + Math.round(gx)) * cells.length)];
        const gw = 40 + 50 * hash01(o.id * 3 + Math.round(gx));
        const hit = holes.some((hl) => Math.abs(hl.t - gx) < hl.w / 2 + gw / 2);
        if (!hit) api.decal(B, cell, gx, b0 + (fin.grimeY ?? 34), z + s * 0.35, gw, fin.grimeH ?? 50, s > 0 ? 0 : Math.PI);
      }
    }
    // the things on the walls: dispensers, extinguishers, posters, clocks, bins below (the level draws them)
    if (fin.wallProps && level.wallProp && lod() >= 1 && len > 90) {
      const step = fin.wallStep || 150;
      const n = Math.max(1, Math.floor(len / step));
      for (let i = 0; i < n; i++) {
        const seed = o.id * 31 + i * 7 + (s > 0 ? 3 : 0) + Math.round(t0);
        const t = t0 + (i + 0.5) * (len / n) + (hash01(seed + 1) - 0.5) * 30;
        if (hash01(seed) > (fin.wallPropK ?? 0.65)) continue;
        if (t - t0 < 34 || t1 - t < 34) continue;
        if (holes.some((hl) => Math.abs(hl.t - t) < hl.w / 2 + 24)) continue;
        const kind = fin.wallProps[Math.floor(hash01(seed + 5) * fin.wallProps.length)];
        try { level.wallProp({ ...api, B, o, s, t, z: z + s * 0.08, ry: s > 0 ? 0 : Math.PI, base: b0, h, kind, fin, seed }); } catch (err) { warnOnce('wall prop ' + kind, err); }
      }
    }
    void top; void ws;
  }

  /** Spans of t0..t1 not interrupted by a hole reaching height y. */
  function spansAround(t0, t1, holes, y) {
    const out = [];
    let cur = t0;
    for (const hl of holes) {
      if (hl.y0 > y || hl.y1 < y) continue;
      const a = hl.t - hl.w / 2, b = hl.t + hl.w / 2;
      if (b <= t0 || a >= t1) continue;
      if (a > cur) out.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < t1) out.push([cur, t1]);
    return out;
  }

  // ---- doors -----------------------------------------------------------------------------------------
  /** A door frame: jambs, head, the lintel up to the ceiling on both sides, and the leaves by kind. */
  function drawDoor(B, it) {
    const w = it.w, th = it.th || 16, h = it.h || 78;
    const base = sideBase(it, th);
    at(B, it.x, it.y, it.a || 0, Math.round(it.x * 3 + it.y), base);
    B.setJitter(0.01);
    // the rooms either side
    const [ax, ay] = toWorld(it, 0, th / 2 + 16), [bx, by] = toWorld(it, 0, -th / 2 - 16);
    const ra = roomAt(ax, ay), rb = roomAt(bx, by);
    const fa = finishOf(ra), fb = finishOf(rb);
    const ws = (level.walls && level.walls[it.style]) || {};
    const topOf = (rm, fin) => (rm ? (fin.tall || roomBase(rm) + rm.height) : facadeTopAt(ws, it, 0, ws.top || 150)) - base;
    const topA = topOf(ra, fa), topB = topOf(rb, fb);
    const top = Math.max(topA, topB);
    const frame = (level.doorFrame && level.doorFrame(it)) || { color: '#8a8f94', surf: STEEL, jamb: 3.2 };
    const J = frame.jamb;
    if (it.kind !== 'arch') {
      for (const e of [-1, 1]) B.rblock('std', e * (w / 2 - J / 2), 0, 0, J, h, th + 2.4, 0.5, frame.color, null, frame.surf);
      B.rbox('std', 0, h + J / 2, 0, w, J, th + 2.4, 0.5, frame.color, null, frame.surf);
    } else {
      // an opening: plastered reveals
      for (const e of [-1, 1]) B.quad('std', [e * w / 2, h / 2, 0], [0, 0, e * th], [0, h, 0], shadeHex((fa || fb || FIN_DEFAULT).upper, -0.08), S(DET.drywall, 0.85, 0));
      B.quad('std', [0, h, 0], [w, 0, 0], [0, 0, th], shadeHex((fa || fb || FIN_DEFAULT).upper, -0.15), S(DET.drywall, 0.85, 0));
    }
    // the lintel: each face in its room's finish (or the façade's)
    const L0 = it.kind === 'arch' ? h : h + J;
    const lint = (s, fin, topS) => {
      if (topS <= L0) return;
      const color = fin ? fin.upper : (ws.face || '#bdb8ac');
      B.quad('std', [0, (L0 + topS) / 2, s * (th / 2 + 0.05)], [s * w, 0, 0], [0, topS - L0, 0], color, fin ? (fin.upperSurf || S(fin.upperDet ?? DET.drywall, 0.82, 0)) : S(DET.concrete, 0.9, 0));
    };
    lint(1, fa, topA);
    lint(-1, fb, topB);
    B.quad('std', [0, top, 0], [w, 0, 0], [0, 0, -th], '#6a6862', S(DET.concrete, 0.9, 0));
    // leaves
    const D = { B, it, w, th, h, J, fa, fb, frame, ...api };
    try {
      if (level.doorLeaves && level.doorLeaves(D)) return;
      doorLeaves(D);
    } catch (err) { warnOnce('door ' + it.kind, err); }
  }

  /** The default leaves by kind (open, pushed back against the wall). */
  function doorLeaves(D) {
    const { B, it, w, th, h, J } = D;
    const flip = it.flip ? -1 : 1;
    const leafC = (level.leafColor && level.leafColor(it)) || '#7d8a92';
    const leaf = (hx, len, ang, side) => {
      // a leaf hinged at local x = hx, swung `ang` (0 = shut across the doorway) toward side z
      const cx = hx + Math.cos(ang) * len / 2 * Math.sign(-hx || 1), cz = side * Math.sin(ang) * len / 2;
      B.rblock('std', cx, 1, cz, len - 1, h - 2, 3.4, 0.6, leafC, [0, side * ang * -Math.sign(-hx || 1), 0], PAINT);
      if (lod() >= 1) {
        B.box('std', cx, 3.5, cz, len - 3, 6, 3.8, '#9aa0a4', [0, side * ang * -Math.sign(-hx || 1), 0], CHROME);   // kick plate
      }
    };
    switch (it.kind) {
      case 'leaf': leaf(-w / 2 + J, w - 2 * J, 1.45, flip); break;
      case 'double': leaf(-w / 2 + J, w / 2 - J, 1.5, flip); leaf(w / 2 - J, w / 2 - J, 1.5, flip); break;
      case 'swing': {
        // double swing doors with portholes, one pushed wide, one ajar
        const hw = w / 2 - J;
        for (const [hx, ang] of [[-w / 2 + J, 1.2], [w / 2 - J, 0.55]]) {
          const sg = Math.sign(-hx);
          const cx = hx + Math.cos(ang) * hw / 2 * sg, cz = flip * Math.sin(ang) * hw / 2;
          const rot = [0, flip * ang * -sg, 0];
          B.rblock('std', cx, 1, cz, hw - 1, h - 2, 3.4, 0.6, leafC, rot, PAINT);
          B.add('glass', T.cyl(14), [cx, h * 0.68, cz], [hw * 0.16, 3.8, hw * 0.16], new THREE.Euler(HALF, rot[1], 0, 'YXZ'), '#1c262e', { surf: [0, 0.1, 0.3] });
          B.box('std', cx, 3.5, cz, hw - 3, 7, 3.9, '#a3a8ac', rot, CHROME);
        }
        break;
      }
      case 'glass': {
        // sliding glass doors, shattered: the frames pushed aside
        for (const e of [-1, 1]) {
          B.box('std', e * (w / 2 - 6), h / 2, -th / 2 - 3, 4, h, 3, '#5a6066', null, STEEL);
          B.box('std', e * (w / 2 - 6) + e * 20, 3, -th / 2 - 3, 40, 6, 3, '#5a6066', null, STEEL);
        }
        break;
      }
      case 'cage': {
        const len = w - 2 * J;
        const ang = 1.35 * flip;
        const cx = -w / 2 + J + Math.cos(ang) * len / 2, cz = Math.sin(ang) * len / 2;
        B.rblock('std', cx, 2, cz, len, h - 4, 1.6, 0.3, '#5d6468', [0, -ang, 0], STEEL);
        break;
      }
      case 'lift': {
        // lift doors slid into their pockets, the landing sill
        for (const e of [-1, 1]) B.box('std', e * (w / 2 + 14), h / 2, -th / 2 - 2.2, 28, h, 2.2, '#9aa1a6', null, CHROME);
        B.box('std', 0, 0.6, 0, w, 1.2, th + 6, '#6d7277', null, CHROME);
        break;
      }
      case 'gate': case 'arch': case 'open': default: break;
    }
  }

  // ---- windows -----------------------------------------------------------------------------------------
  const glassPanes = [];      // collected for finish(): real see-through panes (not shadow casters)
  function drawWindow(B, it) {
    const w = it.w, th = it.th || 16, y0 = it.sill, y1 = it.sill + it.h;
    const wbase = winBase(it);
    at(B, it.x, it.y, it.a || 0, Math.round(it.x + it.y * 7), wbase);
    B.setJitter(0.01);
    const [ax, ay] = toWorld(it, 0, th / 2 + 16), [bx, by] = toWorld(it, 0, -th / 2 - 16);
    const fa = finishOf(roomAt(ax, ay)), fb = finishOf(roomAt(bx, by));
    const wf = (level.windowFrame && level.windowFrame(it)) || { color: '#8a9096', surf: STEEL };
    const reveal = shadeHex((fa || fb || FIN_DEFAULT).upper, -0.12);
    const rs = S(DET.drywall, 0.85, 0);
    // reveals through the wall
    for (const e of [-1, 1]) B.quad('std', [e * w / 2, (y0 + y1) / 2, 0], [0, 0, e * th], [0, y1 - y0, 0], reveal, rs);
    B.quad('std', [0, y1, 0], [w, 0, 0], [0, 0, th], shadeHex(reveal, -0.1), rs);
    // sills inside and out
    B.rbox('std', 0, y0 - 0.8, 0, w + 4, 1.6, th + 5, 0.5, fa ? (fa.sill || '#d8d4ca') : '#b8b4aa', null, S(DET.concrete, 0.6, 0));
    // the frame: a perimeter and a mullion
    const fz = -th * 0.1;
    const F = 2.2;
    B.box('std', 0, y1 - F / 2, fz, w, F, 3, wf.color, null, wf.surf);
    B.box('std', 0, y0 + F / 2, fz, w, F, 3, wf.color, null, wf.surf);
    for (const e of [-1, 1]) B.box('std', e * (w / 2 - F / 2), (y0 + y1) / 2, fz, F, y1 - y0, 3, wf.color, null, wf.surf);
    if (w > 70) B.box('std', 0, (y0 + y1) / 2, fz, 1.6, y1 - y0, 2.6, wf.color, null, wf.surf);
    const broken = it.kind === 'broken' || hash01(Math.round(it.x * 13 + it.y)) < (level.brokenWindows ?? 0.12);
    const boarded = it.kind === 'boarded';
    if (boarded) {
      for (let p = 0; p < 3; p++) B.box('std', (hash01(it.x + p) - 0.5) * 4, y0 + (p + 0.5) * (it.h / 3), -th / 2 - 0.8, w + 6, it.h / 3 - 1, 1, ['#6b5a44', '#5a4632', '#75604a'][p], [0, 0, (hash01(it.y + p) - 0.5) * 0.12], S(DET.wood, 0.85, 0));
    } else if (!broken) {
      const [wx, wy] = toWorld(it, 0, fz);
      glassPanes.push({ x: wx, y: wy, a: it.a || 0, w: w - 2 * F, h: it.h - 2 * F, yc: wbase + (y0 + y1) / 2 });
    } else if (lod() >= 1) {
      // glass teeth left in the frame
      for (let k = 0; k < 5; k++) {
        const side = k % 2 ? 1 : -1;
        const tx = side * (w / 2 - 3 - hash01(it.x + k) * w * 0.2);
        B.add('glass', T.plane(), [tx, y1 - 5 - hash01(it.y + k) * 8, fz], [4 + hash01(k + it.x) * 5, 9, 1], [0, 0, (hash01(k) - 0.5) * 0.6], '#1a2228', { surf: [DET.glass, -1, -1] });
      }
    }
    // blinds on the inside (hospitals), a sticker
    if (it.inside !== 0 && fa && fa.blinds && lod() >= 1 && hash01(it.x * 3 + it.y) < fa.blinds && !boarded) {
      const drop = (y1 - y0) * (0.25 + 0.6 * hash01(it.x + 3));
      for (let yy = y1 - 2; yy > y1 - drop; yy -= 2.4) B.box('std', 0, yy, th / 2 + 1.5, w - 4, 0.5, 2.4, '#d8d6cc', [0.4, 0, 0], PLAST);
    }
    if (level.windowExtras) level.windowExtras({ B, it, fa, fb, th, y0, y1, ...api });
  }

  // ---- rooms: floor, ceiling -------------------------------------------------------------------------
  const roomsDrawn = new Set();
  function drawRoom(B, r) {
    const fin = finishOf(r);
    if (!fin) return;
    const base = fin.base !== undefined ? fin.base : roomBase(r);
    at(B, r.x, r.y, 0, Math.round(r.x + r.y), base);
    B.setJitter(0);
    // floor
    if (fin.floor && !fin.noFloor) {
      const fs = { noAO: true, surf: [fin.floorDet ?? DET.linoleum, fin.floorRough ?? 0.4, 0] };
      B.quad('lvfloor', [0, 0, 0], [r.w, 0, 0], [0, 0, -r.h], fin.floor, fs);
      if (fin.floorFx) fin.floorFx({ B, r, fin, ...api });
      // stains and trails on the floor
      if (fin.floorDecals && lod() >= 1) {
        const rr = seededRng(Math.round(r.x * 13 + r.y * 7) + 5);
        const n = Math.round((r.w * r.h) / (fin.decalArea || 160000) * (0.6 + rr.next()));
        for (let i = 0; i < n; i++) {
          const cell = fin.floorDecals[Math.floor(rr.next() * fin.floorDecals.length)];
          const sz = 50 + rr.next() * 90;
          api.flat(B, cell, (rr.next() - 0.5) * (r.w - sz), 0.25 + i * 0.002, (rr.next() - 0.5) * (r.h - sz), sz * (cell === 'blood_trail' ? 2.2 : 1), sz * (cell === 'blood_trail' ? 0.55 : 1), rr.next() * 6.28);
        }
      }
    }
    // ceiling
    if (fin.ceilKind === 'none') return;
    const H = r.height;
    const special = level.ceilings && level.ceilings[fin.ceilKind];
    if (special) { special({ B, r, fin, H, ...api }); return; }
    const cs = { noAO: true, surf: [fin.ceilDet ?? DET.ceiltile, 0.9, 0] };
    B.quad('std', [0, H, 0], [r.w, 0, 0], [0, 0, r.h], fin.ceil || '#d8d6ce', cs);
    if (fin.ceilKind === 'grid' && lod() >= 1) tileGrid(B, r, H, fin);
  }

  /** The T-bar grid of a dropped ceiling, with missing and hanging tiles. */
  function tileGrid(B, r, H, fin) {
    const step = fin.tile || 40;
    const nx = Math.floor(r.w / step), nz = Math.floor(r.h / step);
    const tb = fin.tbar || '#b9b8b2';
    const x0 = -r.w / 2 + (r.w - nx * step) / 2, z0 = -r.h / 2 + (r.h - nz * step) / 2;
    for (let i = 0; i <= nx; i++) B.box('std', x0 + i * step, H - 0.35, 0, 0.9, 0.7, r.h, tb, null, S(0, 0.5, 0.4));
    for (let j = 0; j <= nz; j++) B.box('std', 0, H - 0.35, z0 + j * step, r.w, 0.7, 0.9, tb, null, S(0, 0.5, 0.4));
    // holes and fallen tiles
    const miss = fin.missing ?? 0.04;
    const rr = seededRng(Math.round(r.x * 7 + r.y * 3));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const q = rr.next();
        if (q > miss) continue;
        const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
        B.quad('std', [cx, H + 0.2, cz], [step - 1, 0, 0], [0, 0, step - 1], '#16140f', { noAO: true, surf: [0, 1, 0] });
        if (lod() >= 1) B.cyl('std', cx + step * 0.2, H - 14, cz - step * 0.1, 0.35, 14, '#1a1a1a', 4, 1, null, S(0, 0.6, 0.1));
        if (q < miss * 0.3 && lod() >= 2) {
          // a tile hanging from one edge
          const th = 0.8 + rr.next() * 0.5, sz = step - 3;
          B.box('std', cx, H - Math.sin(th) * sz / 2, cz - sz / 2 + Math.cos(th) * sz / 2, sz, 1, sz, fin.ceil, [th, 0, 0], S(DET.ceiltile, 0.9, 0));
        }
      }
    }
  }

  // ---- fixtures (per section, switchable) ----------------------------------------------------------
  const sections = (map.sections || []).map((s) => s.id);
  const fixMats = new Map();       // section → { on: MeshBasicMaterial, fl: ... , k }
  const fixMeshes = [];
  const extraMeshes = [];
  function fixMat(sec) {
    let m = fixMats.get(sec);
    if (!m) {
      m = { on: fixtureMaterial(uTime, false), fl: fixtureMaterial(uTime, true), k: 1, want: 1 };
      fixMats.set(sec, m);
    }
    return m;
  }

  /** The fixtures of every room (lit where a map light is, dark elsewhere), and the level's own lamps. */
  function buildFixtures() {
    const byKey = new Map();         // `${sec}|${kind}` → builder
    const builderFor = (sec, flick) => {
      const k = (sec || '_') + '|' + (flick ? 'f' : 'n');
      let b = byKey.get(k);
      if (!b) { b = deps.newBuilder(); byKey.set(k, b); }
      return b;
    };
    const lights = map.lights;
    for (const r of roofs) {
      const fin = finishOf(r);
      if (!fin || !fin.fixture || fin.ceilKind === 'none') continue;
      const fx = fin.fixture;
      const H = r.height, rb = roomBase(r);
      const mine = lights.filter((l) => Math.abs(l.x - r.x) <= r.w / 2 && Math.abs(l.y - r.y) <= r.h / 2 && Number.isFinite(l.h) && l.h - rb >= H - 40 && l.h - rb <= H + 12);
      // a regular grid of fixtures across the room; the ones by a map light are lit
      const along = r.w >= r.h;
      const len = along ? r.w : r.h, wid = along ? r.h : r.w;
      const stepA = fx.step || 170, rows = Math.max(1, Math.round(wid / (fx.rowStep || 220)));
      const nA = Math.max(1, Math.round(len / stepA));
      for (let i = 0; i < nA; i++) {
        for (let j = 0; j < rows; j++) {
          const la = -len / 2 + (i + 0.5) * (len / nA), lw = -wid / 2 + (j + 0.5) * (wid / rows);
          const wx = r.x + (along ? la : lw), wy = r.y + (along ? lw : la);
          let near = null, nd = 1e9;
          for (const l of mine) { const d = Math.hypot(l.x - wx, l.y - wy); if (d < nd) { nd = d; near = l; } }
          const lit = near && nd < Math.max(stepA, 120) * 0.9 ? near : (hash01(Math.round(wx * 3 + wy)) < (fx.stray ?? 0.12) ? { color: fx.color || '#e8f0ff', flicker: 0.6 } : null);
          const flick = lit && lit.flicker > 0.3;
          const Bf = builderFor(r.section, flick);
          at(Bf, wx, wy, along ? 0 : HALF, Math.round(wx + wy), rb);
          const color = lit ? lit.color : null;
          try {
            if (level.fixture) level.fixture({ B: Bf, r, fin, fx, lit: !!lit, color, H, wx, wy, ...api });
            else troffer(Bf, H, fx, color);
          } catch (err) { warnOnce('fixture', err); }
          if (lit && lit.color && near === lit && lod() >= 1) api.halo(wx, wy, rb + H - 2, lit.color, fx.halo ?? 46, fx.haloK ?? 0.3, lit.flicker || 0);
        }
      }
    }
    if (level.lamps) {
      // the level's own switchable lamps: level.lamps(builderFor) draws them into per-section builders
      try { level.lamps({ builderFor, ...api }); } catch (err) { warnOnce('lamps', err); }
    }
    for (const [key, b] of byKey) {
      const [sec, kind] = key.split('|');
      const m = fixMat(sec === '_' ? null : sec);
      for (const { bucket, geometry } of b.finish()) {
        // the housings (std) go into ordinary meshes; the lit panels (glow) into the section's switchable material
        const unlit = bucket === 'glow' || bucket === 'flicker';
        const mat = unlit ? (kind === 'f' ? m.fl : m.on) : deps.matOf(bucket, tier);
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.matrixAutoUpdate = false;
        mesh.name = 'lv-fix-' + sec + '-' + bucket;
        mesh.userData.bucket = bucket;
        mesh.userData.fixture = unlit;
        mesh.receiveShadow = !unlit;
        deps.root.add(mesh);
        fixMeshes.push(mesh);
      }
    }
  }

  /** A recessed 2x4 troffer: a frame and a diffuser (lit or dead). */
  function troffer(B, H, fx, color) {
    const w = fx.w || 60, d = fx.d || 26;
    B.box('std', 0, H - 0.6, 0, w + 3, 1.2, d + 3, '#c9c9c4', null, S(0, 0.4, 0.5));
    if (color) api.glow(B, 0, H - 1.3, 0, w, 0.4, d, mixHex(color, '#ffffff', 0.35), fx.k ?? 2.6);
    else B.box('std', 0, H - 1.3, 0, w, 0.4, d, '#9a9d9e', null, S(DET.plastic, 0.4, 0));
    if (lod() >= 1) for (const e of [-1, 1]) B.box('std', 0, H - 1.6, e * d / 4, w, 0.5, 0.7, '#b0b2b2', null, S(0, 0.4, 0.6));
  }

  // ---- daylight: shafts through the windows, sun patches --------------------------------------------
  function buildDaylight() {
    if (!day) return;
    const amb = dayAmbientFor(map);
    const sd = amb.sunDir;          // three axes: toward the sun
    const sx = sd.x, sz = sd.z, sy = Math.max(0.15, sd.y);
    const hl = Math.hypot(sx, sz) || 1;
    const pos = [], col = [];
    const quad = (p0, p1, p2, p3, a0, a1) => {
      // a0 at p0/p1, a1 at p2/p3
      pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
      col.push(a0, a0, a1, a0, a1, a1);
    };
    let n = 0;
    for (const it of windows) {
      if (n > 260) break;
      const nxw = -Math.sin(it.a || 0), nyw = Math.cos(it.a || 0);     // the wall's +z normal in sim axes
      // which side is outside? (no room there)
      const [ox, oy] = [it.x + nxw * 30, it.y + nyw * 30];
      const outSign = roomAt(ox, oy) ? -1 : 1;
      const onx = nxw * outSign, ony = nyw * outSign;
      const facing = (onx * sx + ony * sz) / hl;
      if (facing < 0.15) continue;
      const room = roomAt(it.x - onx * 30, it.y - ony * 30);
      if (!room) continue;
      n++;
      // the window's opening corners in world space, cast along -sun onto the floor
      const tx = Math.cos(it.a || 0), ty = Math.sin(it.a || 0);
      const fb = roomBase(room), wb = winBase(it);
      const y0 = wb + it.sill, y1 = wb + it.sill + it.h;
      const corner = (t, y) => [it.x + tx * t, y, it.y + ty * t];
      const proj = (p) => { const k = (p[1] - fb) / sy; return [p[0] - sx * k, fb + 0.4, p[2] - sz * k]; };
      const w2 = it.w / 2 - 3;
      const a = corner(-w2, y1), b = corner(w2, y1), c = corner(w2, y0), d = corner(-w2, y0);
      const A = proj(a), Bp = proj(b), C = proj(c), Dp = proj(d);
      const s = 0.07 * Math.min(1, facing * 1.5);
      // the shaft's four long faces and the patch on the floor
      quad(a, b, Bp, A, s, 0);
      quad(d, c, C, Dp, s, 0);
      quad(a, d, Dp, A, s * 0.8, 0);
      quad(b, c, C, Bp, s * 0.8, 0);
      quad(A, Bp, C, Dp, 0.22 * facing, 0.22 * facing);
    }
    // skylights and glass roofs: level.skylights [{ x0, y0, x1, y1, h, floor?, k?, clip? }] (horizontal openings)
    for (const sk of level.skylights || []) {
      const fb = sk.floor ?? gy((sk.x0 + sk.x1) / 2, (sk.y0 + sk.y1) / 2);
      const kk = (sk.k ?? 1) * Math.min(1, sy * 1.4);
      const y = sk.h, k = (y - fb) / sy;
      const dx = -sx * k, dz = -sz * k;
      const a = [sk.x0, y, sk.y0], b = [sk.x1, y, sk.y0], c = [sk.x1, y, sk.y1], d = [sk.x0, y, sk.y1];
      const low = (p) => [p[0] + dx, fb + 0.4, p[2] + dz];
      const A = low(a), Bp = low(b), C = low(c), Dp = low(d);
      const s = 0.06 * kk;
      quad(a, b, Bp, A, s, 0);
      quad(c, d, Dp, C, s, 0);
      quad(b, c, C, Bp, s * 0.8, 0);
      quad(d, a, A, Dp, s * 0.8, 0);
      // the patch on the floor, clipped to the room below (a vault's patch must not spill outside)
      const cl = sk.clip || { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
      const px0 = Math.max(cl.x0, sk.x0 + dx), px1 = Math.min(cl.x1, sk.x1 + dx), pz0 = Math.max(cl.y0, sk.y0 + dz), pz1 = Math.min(cl.y1, sk.y1 + dz);
      if (px1 > px0 && pz1 > pz0) {
        const pk = (sk.patch ?? 0.12) * kk;
        quad([px0, fb + 0.4, pz0], [px1, fb + 0.4, pz0], [px1, fb + 0.4, pz1], [px0, fb + 0.4, pz1], pk, pk);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(col, 1));
    const sun = amb.moon.clone();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3(sun.r, sun.g * 0.97, sun.b * 0.9) } },
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol * vA, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'lv-sunshafts';
    mesh.renderOrder = 6;
    deps.root.add(mesh);
    extraMeshes.push(mesh);
  }

  // ---- glass (built after the static meshes: see-through, casts no sun shadow) -----------------------
  function buildGlass() {
    if (!glassPanes.length) return;
    const b = deps.newBuilder();
    for (const p of glassPanes) {
      at(b, p.x, p.y, p.a, 1, 0);
      b.add('vglass', T.plane(), [0, p.yc, 0], [p.w, p.h, 1], null, day ? '#9fb4c0' : '#44545e', { noAO: true, noJitter: true });
      b.add('vglass', T.plane(), [0, p.yc, 0], [p.w, p.h, 1], [0, Math.PI, 0], day ? '#9fb4c0' : '#44545e', { noAO: true, noJitter: true });
    }
    for (const { bucket, geometry } of b.finish()) {
      const mesh = new THREE.Mesh(geometry, deps.matOf(bucket, tier));
      mesh.matrixAutoUpdate = false;
      mesh.name = 'lv-glass';
      mesh.userData.bucket = bucket;
      deps.root.add(mesh);
      extraMeshes.push(mesh);
    }
  }

  // ---- the art interface ------------------------------------------------------------------------------
  let roofCalls = 0;
  let fallbackMeshes = [];
  const art = {
    buckets: level.buckets || KIT_BUCKETS,
    material(bucket, t) { return M.get(bucket, t) || deps.mats.get(bucket, t); },
    obstacle(B, o) {
      try {
        if (o.gate) {
          at(B, o.x, o.y, o.a || 0, o.id * 31, gy(o.x, o.y));
          if (level.gate) { level.gate(P(B, o, { gate: map.gates.find((g) => g.id === o.gate) })); return true; }
          return false;
        }
        const ws = level.walls && level.walls[o.style];
        if (ws && o.kind === 'wall') {
          if (ws.draw) ws.draw(P(B, o, { drawWall: () => drawWall(B, o), ws }));
          else drawWall(B, o);
          return true;
        }
        const fn = level.obstacles && (level.obstacles[o.style] || level.obstacles[o.prop]);
        if (fn) { B.setJitter(0.03); return fn(P(B, o)) !== false; }
      } catch (err) {
        warnOnce('obstacle ' + (o.style || o.kind), err);
      }
      return false;
    },
    objective() { return false; },
    roof(B, r) {
      if (!r.style || !(level.rooms && level.rooms[r.style])) return false;
      roofCalls++;
      try { drawRoom(B, r); } catch (err) { warnOnce('room ' + r.style, err); }
      roomsDrawn.add(r);
      return true;
    },
    props(B) {
      for (const it of items) {
        try {
          if (it.t === 'door') drawDoor(B, it);
          else if (it.t === 'window') drawWindow(B, it);
          else {
            const fn = level.items && level.items[it.t];
            if (!fn) { warnOnce('no model for item ' + it.t); continue; }
            B.obj(it.x, it.y, it.a || 0, Math.round(it.x * 7 + it.y * 3));
            B.setJitter(0.03);
            fn(P(B, it, { L: it.w || 0, W: it.d || 0 }));
          }
        } catch (err) {
          warnOnce('item ' + it.t, err);
        }
      }
      if (level.props) {
        try { level.props({ B, ...api }); } catch (err) { warnOnce('level props', err); }
      }
    },
    finish() {
      // rooms the engine did not ask for (before JOURNEY §4.4 lands, or roofs without art.roof calls)
      if (!roofCalls) {
        const b = deps.newBuilder();
        for (const r of roofs) if (!roomsDrawn.has(r)) { try { drawRoom(b, r); } catch (err) { warnOnce('room ' + r.style, err); } }
        for (const { bucket, geometry } of b.finish()) {
          const mesh = new THREE.Mesh(geometry, art.material(bucket, tier) || deps.matOf(bucket, tier));
          mesh.matrixAutoUpdate = false;
          mesh.name = 'lv-rooms-' + bucket;
          mesh.userData.bucket = bucket;
          mesh.receiveShadow = true;
          deps.root.add(mesh);
          fallbackMeshes.push(mesh);
        }
      }
      try { buildFixtures(); } catch (err) { warnOnce('fixtures', err); }
      try { buildGlass(); } catch (err) { warnOnce('glass', err); }
      try { buildDaylight(); } catch (err) { warnOnce('daylight', err); }
      if (level.finish) { try { level.finish({ ...api, root: deps.root, newBuilder: deps.newBuilder, matOf: deps.matOf, extraMeshes }); } catch (err) { warnOnce('level finish', err); } }
      // (halos pushed here join the world's halo mesh: world.js builds it after finish())
    },
    update(view, frame) {
      const dt = Math.min(0.1, (frame && frame.dt) || 0.016);
      uTime.value += dt;
      // a section's lights: the engine's lights action (JOURNEY §4.3) via setLights, or the view
      const off = view && (view.lightsOff || (view.level && view.level.lightsOff));
      for (const [sec, m] of fixMats) {
        let want = m.want;
        if (off && sec) want = (Array.isArray(off) ? off.includes(sec) : off[sec]) ? 0 : 1;
        m.k += (want - m.k) * Math.min(1, dt * 6);
        const k = (day ? 0.3 : 1) * m.k;
        m.on.color.setScalar(k);
        m.fl.color.setScalar(k);
      }
      if (level.update) level.update(view, frame, api);
    },
    /** Switch the fixtures of a section on or off (the engine's lights action). */
    setLights(section, on) {
      fixMat(section).want = on ? 1 : 0;
    },
    setQuality(q) {
      tier = q === 'low' ? 'low' : 'high';
      for (const m of fixMeshes) if (!m.userData.fixture) m.material = deps.matOf(m.userData.bucket, tier);
      for (const m of fallbackMeshes) m.material = art.material(m.userData.bucket, tier) || deps.matOf(m.userData.bucket, tier);
      for (const m of extraMeshes) if (m.userData.bucket) m.material = deps.matOf(m.userData.bucket, tier);
    },
    gateModel(B, gate, o) {
      if (!level.gate) return false;
      level.gate(P(B, o, { gate }));
      return true;
    },
    dispose() {
      for (const m of [...fixMeshes, ...fallbackMeshes, ...extraMeshes]) { deps.root.remove(m); m.geometry.dispose(); if (m.name === 'lv-sunshafts') m.material.dispose(); }
      for (const m of fixMats.values()) { m.on.dispose(); m.fl.dispose(); }
      for (const m of M.all) m.dispose();
      tex.dispose();
      if (level.dispose) level.dispose();
    },
    /** (tests, the sandbox) */
    get stats() { return { fixtures: fixMeshes.length, glass: glassPanes.length, rooms: roofs.length, roofCalls }; },
  };
  return art;
}
