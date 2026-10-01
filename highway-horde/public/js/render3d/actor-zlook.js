// Per-zombie looks: a deterministic description of one zombie built from its type and sim
// id alone, so every client draws the same person (business suits, hospital gowns, police,
// firefighters, prisoners, tourists, joggers ...), with the same skin tone and stage of
// decay, the same torn hems, wounds, missing parts, gear and gait. Pure JS, no three.js:
// zombies3d.js packs the description into the instance's texture row (packLook) and the
// rig shader (actor-rigmat.js) and the accessory groups of the models (actor-zmodels.js)
// do the rest, so a whole horde is still a handful of draw calls.
//
// zombieLook(type, id, theme) never uses Math.random and reads no clock: same input, same
// output (tests/zlook.test.js). The theme is the map id: who the dead were depends on where the
// story goes (patients and staff at the hospital, workers at the rail yard, soldiers at the
// airbase, shoppers at the mall; THEMES). Corpse colours: the person's own skin tone drained
// and shifted toward ashen grey-green, sallow or bruised blue-grey (never toy colours), clothes
// grimed and sun-faded, eyes clouded and only dimly lit.

import { OPTS, optBit, TEX_W, T_SKIN, T_CLOTH, T_CLOTH2, T_ACCENT, T_HAIR, T_VAR1, T_VAR2, T_WND1, T_WND2, T_OPT, T_COL3, T_COL4, T_COL5, T_VAR3, WOUND } from './actor-consts.js';
import { ZOMBIES } from '../shared/zombies.js';

// ---------------------------------------------------------------------------------------
// tiny helpers

/** Deterministic PRNG (mulberry32) seeded from the type and id. */
export function rngFor(id, salt = 0) {
  let a = (Math.imul((id | 0) + 1, 0x9e3779b1) ^ Math.imul(salt + 0x85ebca6b, 0xc2b2ae35)) >>> 0;
  a = (a ^ (a >>> 15)) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const chance = (r, p) => r() < p;
const range = (r, a, b) => a + (b - a) * r();
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const s2l = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
/** '#rrggbb' → linear [r, g, b]. */
export function lin(hex) { const [r, g, b] = hexToRgb(hex); return [s2l(r), s2l(g), s2l(b)]; }
const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const luma = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
/** Scale a linear colour down so its luminance is at most `max` (near-white cloth blooms under the flashlight). */
function capL(c, max) { const l = luma(c); if (l > max) { const k = max / l; return [c[0] * k, c[1] * k, c[2] * k]; } return c; }
function weighted(r, list, mul = null) {
  const w = (a) => a.w * (mul && mul[a.name] ? mul[a.name] : 1);
  let t = 0;
  for (const a of list) t += w(a);
  let x = r() * t;
  for (const a of list) { x -= w(a); if (x <= 0) return a; }
  return list[list.length - 1];
}
/** [[value, weight], ...] → value */
function pickW(r, pairs) {
  let t = 0;
  for (const p of pairs) t += p[1];
  let x = r() * t;
  for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}

// ---------------------------------------------------------------------------------------
// palettes (sRGB hex)

const SKIN_TONES = ['#f0d2b8', '#e3b899', '#d9a57c', '#c68e6a', '#b9835a', '#a8825e', '#8d5a3b', '#6f4a33', '#5a3b28', '#3f271c'];
// what death does to a skin tone: an ashen grey-green, a sallow yellow-grey, a bruised blue-grey, a waxy mauve
const DECAY = ['#8a9a80', '#8e9088', '#a3a47a', '#80889a', '#8a7a86', '#7d8f68', '#a8a08a', '#9a9c8c'];
const HAIR = [['#14100c', 5], ['#2a1a10', 5], ['#4a3020', 4], ['#6a3018', 1.5], ['#a08850', 2], ['#888680', 2], ['#c8c8c0', 1], ['#7a2a14', 1], ['#284a8a', 0.3], ['#a03070', 0.3]];
// clouded, milky eyes with a trace of their tint; the glow (look.eyeGlow) is a dim sheen, not a lamp
const EYES = {
  walker: ['#d8cfa0', '#e0d8b8', '#c8c8b0', '#e0c890', '#b8c0a0', '#d8b890'],
  runner: ['#e0c8a0', '#d8a878', '#e8b890', '#d0d0c0'],
  crawler: ['#d8c090', '#e0d8b0', '#c8b890'],
  bloater: ['#c8d890', '#d0d8a8', '#b8c890'],
  spitter: ['#a8d860', '#b8e080', '#98c860'],
  screamer: ['#c8d8e8', '#dce4ec', '#b8c8dc'],
  brute: ['#e09048', '#d87840', '#e8a860'],
  boss: ['#ff5a28'],
};

const SHIRT_LIGHT = ['#e8e8e4', '#cfd8e0', '#b9cde0', '#e6d3d8', '#d9d2bf', '#c8d8c0', '#f0ead8'];
const SHIRT_MID = ['#7a8fa8', '#8a9a7a', '#a89078', '#9a7a8a', '#6a7a9a'];
const TEE = ['#b33a3a', '#3a5ea0', '#2f7a4a', '#d4a82a', '#7a3a8a', '#e0e0e0', '#2a2a2a', '#d8702a', '#3a8a9a', '#8a8a8a', '#c86a8a', '#5a3a2a'];
const FLANNEL = ['#9a2a24', '#2a5a3a', '#2a3a6a', '#7a5a2a', '#5a2a3a', '#3a3a3a'];
const SUMMER = ['#e8c878', '#e88a7a', '#7ac8d0', '#f0e8c8', '#c8e0a0', '#e8a0c0', '#f0d0a0'];
const DENIM = ['#3a4c6a', '#4c5a78', '#2f3f5a', '#5a6a88'];
const DARK = ['#26262c', '#33333a', '#1f2a3a', '#3a2f2a', '#2a2f2a', '#1c1c1c'];
const JEANS = ['#3a4c6a', '#2a3850', '#4c5a78', '#232a38', '#5a6a88', '#2f3f5a'];
const KHAKI = ['#8a7a58', '#6a6248', '#9a8a68', '#5a5a48', '#7a6a4a'];
const SUIT = ['#26282e', '#1f2634', '#3a3a3e', '#2c2622', '#40434a'];
const SHOE_DARK = ['#1c1612', '#2a2019', '#141210', '#3a2a1c'];
const SNEAKER = ['#e8e8e4', '#c62828', '#1565c0', '#2a2a2a', '#f0c020', '#3a8a4a', '#d8d4c8'];
const BOOT = ['#231b14', '#2a2622', '#3a2c1c', '#1a1a1a'];
const CAP = ['#c62828', '#1565c0', '#2a2a2a', '#e0e0e0', '#2e7d32', '#f9a825', '#4e342e', '#6a6a6a'];
const PACK = ['#3b3226', '#2a3a2a', '#4a2a22', '#22303a', '#5a5040', '#2a2a2e', '#7a3a2a', '#c8a020'];
const HIVIS = ['#d8c020', '#e07a10', '#a0d020'];

// ---------------------------------------------------------------------------------------
// garment kinds: hem = model y below which the top is cut away, sleeve = y below which the
// sleeve is cut (99: none). Model heights: shoulder 44.6, chest 38, waist 32, hip 28.5,
// knee 15, ankle 3.

const TOPS = {
  tee: [28.4, 39.6], polo: [28.0, 39.0], long: [27.4, 0], sweater: [26.0, 0], hoodie: [24.5, 0], jacket: [23.0, 0], coat: [12.0, 0],
  lab: [14.5, 0], gown: [16.5, 38.5], tank: [29.0, 99], crop: [33.5, 99], bare: [99, 99], rags: [33, 41], apron: [28, 39.6],
  flannel: [26.5, 0], dress: [17.5, 99], scrubs: [27.8, 38.8],
};
/** Neckline of a top kind (actor-zmat.js): 0 crew, 1 v-neck / open collar, 2 scoop, 3 tank straps, 4 a gown's open back. */
const NECK = { polo: 1, long: 1, jacket: 1, coat: 1, lab: 1, flannel: 1, scrubs: 1, rags: 2, tank: 3, crop: 3, dress: 2, gown: 4 };
const LEGS = { jeans: -1, trousers: -1, shorts: 20.0, capri: 9.0, torn: 15.0, bare: 99, skirt: 99, rag: 12.0 };

// ---------------------------------------------------------------------------------------
// archetypes: who the zombie was. Fields: w weight; top/bot kind; topC/botC colour lists;
// topPat/botPat [[pattern id, weight]]; shoe 'dress' | 'boot' | 'sneaker' | 'bare'; shoeC;
// hat [[option, chance]] (first that hits wins); gear [[option, chance]]; gearC; glove chance
// (a colour from gloveC); hairs allowed; tear/blood ranges; extra: fixed options.

/** Hair looks: strands = [cut height, sparseness] of the shared strand group, opt = an extra group. */
const HAIR_STYLES = {
  short: {}, patchy: { strands: [50.6, 0.62] }, shaggy: { strands: [50.6, 0.1] }, bob: { strands: [46.8, 0.05] },
  shoulder: { strands: [41.6, 0.05] }, long: { strands: [0, 0.03] }, stringy: { strands: [0, 0.5] },
  pony: { opt: 'hair_pony' }, bun: { opt: 'hair_bun' },
  // (on the dead a mohawk or an afro is a matted, patchy crop: the big wig-like shells read as a doll's)
  mohawk: { strands: [50.6, 0.45] }, afro: {},
};

const A = (name, w, o) => ({ name, w, top: 'tee', bot: 'jeans', shoe: 'sneaker', topPat: [[0, 1]], botPat: [[0, 1]], ...o });

const ARCH = {
  walker: [
    A('commuter', 11, { top: 'long', topC: SHIRT_LIGHT, topPat: [[0, 8], [1, 1]], bot: 'trousers', botC: [...DARK, ...KHAKI], shoe: 'dress', shoeC: SHOE_DARK, gear: [['tie', 0.6], ['lanyard', 0.5], ['bag_msg', 0.25], ['face_glasses', 0.25], ['watch', 0.3]], gearC: PACK }),
    A('exec', 6, { top: 'jacket', topC: SUIT, topPat: [[0, 5], [1, 4]], bot: 'trousers', botC: SUIT, botPat: [[0, 5], [1, 4]], shoe: 'dress', shoeC: SHOE_DARK, sync: true, gear: [['tie', 0.95], ['face_glasses', 0.3], ['watch', 0.4], ['lanyard', 0.2]], gearC: PACK }),
    A('casual', 20, { top: 'tee', topC: TEE, bot: 'jeans', botC: JEANS, shoeC: SNEAKER, hat: [['hat_cap', 0.22], ['hat_beanie', 0.08]], gear: [['pack_small', 0.18], ['face_glasses', 0.12], ['watch', 0.2], ['bag_msg', 0.08]], gearC: CAP }),
    A('hoodie', 9, { top: 'hoodie', topC: [...TEE, '#3a3f48', '#4a4a4e'], bot: 'jeans', botC: JEANS, shoeC: SNEAKER, hat: [['hat_hood', 0.45], ['hat_beanie', 0.12]], gear: [['pack_small', 0.4]], gearC: PACK }),
    A('worker', 7, { top: 'long', topC: [...HIVIS, '#c0c0b8', '#9a6a30'], topPat: [[4, 5], [0, 3]], bot: 'trousers', botC: [...KHAKI, ...JEANS], shoe: 'boot', shoeC: BOOT, hat: [['hat_hard', 0.75]], gear: [['belt_tool', 0.55], ['face_glasses', 0.1]], glove: 0.4, gloveC: ['#a08040', '#c8a040', '#3a3a3a'], gearC: ['#f0c020', '#e0e0e0', '#e07a10', '#2a6ab0'] }),
    A('mechanic', 4, { top: 'long', topC: ['#2a4a7a', '#4a5a3a', '#7a2a22', '#3a3a3e'], topPat: [[7, 5], [0, 1]], bot: 'trousers', botC: ['#2a4a7a', '#4a5a3a', '#7a2a22', '#3a3a3e'], sync: true, shoe: 'boot', shoeC: BOOT, hat: [['hat_cap', 0.4]], gear: [['face_glasses', 0.15]], glove: 0.3, gloveC: ['#3a3a3a'], gearC: CAP }),
    A('farmer', 5, { top: 'long', topC: ['#a03030', '#3a6a3a', '#c8a040', '#6a5a8a'], topPat: [[2, 5], [0, 2]], bot: 'jeans', botC: JEANS, shoe: 'boot', shoeC: BOOT, hat: [['hat_straw', 0.65], ['hat_cap', 0.2]], gear: [['suspenders', 0.6], ['face_beard', 0.3]], gearC: ['#c8a860', '#8a6a3a', '#c62828'] }),
    A('scrubs', 4, { top: 'scrubs', topC: ['#4a9aa8', '#3a7a5a', '#4a6aa8', '#8a5a9a'], bot: 'trousers', botC: null, sync: true, shoe: 'sneaker', shoeC: ['#e8e8e4', '#d8d4c8', '#2a2a2a'], hat: [['hat_beanie', 0.25]], gear: [['stetho', 0.55], ['lanyard', 0.7], ['face_mask', 0.35]], gearC: ['#4a9aa8', '#e8e8e4'] }),
    A('labcoat', 3, { top: 'lab', topC: ['#e8e8e6', '#d8dcdc', '#cfd6d0'], bot: 'trousers', botC: [...DARK, ...KHAKI], shoe: 'dress', shoeC: SHOE_DARK, gear: [['lanyard', 0.8], ['face_glasses', 0.5], ['stetho', 0.3], ['badge', 0.0]], gearC: PACK }),
    A('patient', 8, { top: 'gown', topC: ['#bcd4e0', '#a8c8d8', '#c8dce4', '#b0ccc8'], topPat: [[0, 3], [5, 0]], bot: 'bare', botC: ['#bcd4e0', '#a8c8d8'], shoe: 'bare', hair: 'any', gear: [['bandage_hand', 0.35], ['watch', 0.0]], tearMul: 1.4 }),
    A('police', 6, { top: 'long', topC: ['#1f2a44', '#2a3a5a', '#3a4a62'], bot: 'trousers', botC: ['#1a2236', '#232a3a'], sync: false, shoe: 'boot', shoeC: ['#141210'], hat: [['hat_peak', 0.55]], gear: [['belt_duty', 0.9], ['badge', 0.85], ['holster', 0.3], ['watch', 0.3]], gearC: ['#1a2236', '#1c1c20'], glove: 0.1, gloveC: ['#141414'] }),
    A('soldier', 4, { top: 'long', topC: ['#4a5236', '#5a5a3a', '#3f4a34'], topPat: [[3, 1]], bot: 'trousers', botC: ['#4a5236', '#5a5a3a', '#3f4a34'], botPat: [[3, 1]], shoe: 'boot', shoeC: BOOT, hat: [['hat_helmet', 0.7]], gear: [['vest_plate', 0.55], ['pack_big', 0.3], ['kneepads', 0.5], ['dogtags', 0.6]], glove: 0.4, gloveC: ['#1c1c1c', '#3a3a30'], gearC: ['#4a5236', '#3a3f2c', '#5a5a3a'] }),
    A('firefighter', 3, { top: 'coat', topC: ['#c8a030', '#3a3a34', '#8a6a20'], topPat: [[4, 1]], bot: 'trousers', botC: ['#c8a030', '#3a3a34', '#8a6a20'], botPat: [[4, 1]], sync: true, shoe: 'boot', shoeC: ['#c8a030', '#1c1c1c'], hat: [['hat_fire', 0.85]], gear: [['tank_o2', 0.4], ['belt_duty', 0.2]], glove: 0.6, gloveC: ['#3a3a30'], gearC: ['#d8c020', '#c62828', '#e0e0e0'] }),
    A('emt', 3, { top: 'polo', topC: ['#1f2a44', '#3a3f48'], topPat: [[4, 1]], bot: 'trousers', botC: ['#1f2a44', '#2a2f38'], shoe: 'boot', shoeC: ['#141210'], gear: [['bag_medic', 0.5], ['stetho', 0.3], ['lanyard', 0.5], ['belt_duty', 0.4]], glove: 0.5, gloveC: ['#2a5aa8', '#e8e8e4'], gearC: ['#c62828', '#1f2a44'] }),
    A('prisoner', 4, { top: 'long', topC: ['#e07a10', '#d8700c', '#e88a20'], topPat: [[0, 3], [6, 1]], bot: 'trousers', botC: ['#e07a10', '#d8700c'], sync: true, shoe: 'sneaker', shoeC: ['#e8e8e4', '#c8c8c0'], gear: [['cuffs', 0.35]] }),
    A('tourist', 5, { top: 'polo', topC: ['#e8d8a8', '#e07a8a', '#4ab8c8', '#f0f0d0'], topPat: [[5, 6], [0, 2]], bot: 'shorts', botC: KHAKI, shoe: 'sneaker', shoeC: SNEAKER, hat: [['hat_visor', 0.3], ['hat_straw', 0.3], ['hat_cap', 0.15]], gear: [['camera', 0.55], ['fanny', 0.35], ['face_shades', 0.35], ['pack_small', 0.2]], gearC: ['#e8e8d8', '#c8a860', '#3a8a9a'] }),
    A('hiker', 4, { top: 'long', topC: ['#6a7a4a', '#a06a3a', '#3a6a8a', '#8a2a2a'], topPat: [[2, 3], [0, 2]], bot: 'trousers', botC: KHAKI, shoe: 'boot', shoeC: BOOT, hat: [['hat_cap', 0.3], ['hat_straw', 0.2], ['hat_beanie', 0.2]], gear: [['pack_big', 0.85], ['face_shades', 0.2]], glove: 0.2, gloveC: ['#3a3a3a'], gearC: ['#c86a20', '#2a6a4a', '#a02a2a', '#3a4a8a'] }),
    A('vagrant', 3, { top: 'coat', topC: ['#4a4038', '#3a3a34', '#5a4a3a'], bot: 'torn', botC: ['#3a3a34', '#4a4038'], shoe: 'boot', shoeC: BOOT, hat: [['hat_beanie', 0.55], ['hat_hood', 0.2]], gear: [['scarf', 0.55], ['face_beard', 0.5], ['bag_msg', 0.25]], glove: 0.4, gloveC: ['#3a3a3a'], gearC: ['#5a3a2a', '#3a4a3a', '#8a8a80'], tearMul: 1.5 }),
    A('cheer', 2, { top: 'tank', topC: ['#c62828', '#1565c0', '#f9a825'], bot: 'skirt', botC: ['#c62828', '#1565c0', '#f9a825'], shoe: 'sneaker', shoeC: ['#e8e8e4'], hair: 'long', gear: [['pompom', 0.8], ['skirt', 1]], gearC: ['#f0f0f0', '#f9a825'] }),
    A('student', 6, { top: 'hoodie', topC: [...TEE], bot: 'jeans', botC: JEANS, shoeC: SNEAKER, hat: [['hat_beanie', 0.12], ['hat_cap', 0.15]], gear: [['pack_small', 0.8], ['face_glasses', 0.2]], gearC: PACK }),
    // bib overalls: the apron and straps in the trousers' denim
    A('overalls', 5, { top: 'tee', topC: ['#c8c0b0', '#8a8a80', '#a03030', '#e0d8c8', '#6a7a5a'], bot: 'jeans', botC: DENIM, shoe: 'boot', shoeC: BOOT, hat: [['hat_cap', 0.35], ['hat_straw', 0.1]], gear: [['apron', 1], ['suspenders', 1], ['face_beard', 0.25]], gearFromBot: true }),
    // an open flannel shirt over a tee
    A('flannel', 7, { top: 'flannel', topC: FLANNEL, topPat: [[2, 1]], bot: 'jeans', botC: JEANS, shoe: 'boot', shoeC: BOOT, hat: [['hat_cap', 0.3], ['hat_beanie', 0.12]], gear: [['face_beard', 0.3], ['watch', 0.2]], gearC: CAP, open: true }),
    A('summer', 6, { top: 'tank', topC: SUMMER, topPat: [[5, 2], [0, 3], [6, 1]], bot: 'shorts', botC: [...KHAKI, ...DENIM, '#e8e0d0'], shoe: 'sneaker', shoeC: SNEAKER, hat: [['hat_straw', 0.15], ['hat_cap', 0.2]], gear: [['face_shades', 0.3], ['fanny', 0.1], ['watch', 0.2]], gearC: SUMMER }),
    A('sundress', 3, { top: 'dress', topC: SUMMER, topPat: [[5, 3], [0, 2]], bot: 'bare', botC: SUMMER, shoe: 'sneaker', shoeC: ['#e8e4d8', '#c8a060'], hair: 'long', female: true, gear: [['face_shades', 0.2]] }),
    A('shopper', 5, { top: 'sweater', topC: [...SHIRT_MID, '#8a3a4a', '#3a4a6a'], bot: 'jeans', botC: JEANS, shoeC: SNEAKER, gear: [['bag_msg', 0.5], ['face_glasses', 0.25], ['scarf', 0.2]], gearC: PACK }),
  ],
  runner: [
    A('jogger', 24, { top: 'tank', topC: ['#e07a10', '#2ac0c0', '#c62828', '#5ad040', '#e8e8e4', '#f0c020', '#3a6ad0'], bot: 'shorts', botC: ['#1c1c22', '#2a2f38', '#3a3a40'], shoeC: SNEAKER, hat: [['hat_visor', 0.3], ['hat_cap', 0.15]], gear: [['watch', 0.5], ['face_shades', 0.15]], gearC: CAP, glove: 0.0 }),
    A('athlete', 14, { top: 'tee', topC: ['#c62828', '#1565c0', '#2e7d32', '#e0e0e0', '#f9a825'], topPat: [[6, 3], [0, 4]], bot: 'shorts', botC: ['#1565c0', '#c62828', '#1c1c22'], shoeC: SNEAKER, gear: [['watch', 0.3]], hat: [], gearC: CAP }),
    A('teen', 14, { top: 'hoodie', topC: TEE, bot: 'jeans', botC: JEANS, shoeC: SNEAKER, hat: [['hat_hood', 0.3], ['hat_cap', 0.2]], gear: [['pack_small', 0.3]], gearC: PACK }),
    A('courier', 6, { top: 'long', topC: ['#e07a10', '#d8c020', '#3a3f48'], topPat: [[4, 2], [0, 3]], bot: 'shorts', botC: ['#1c1c22'], shoeC: SNEAKER, hat: [['hat_helmet', 0.0], ['hat_cap', 0.4]], gear: [['bag_msg', 0.85], ['face_shades', 0.3]], gearC: ['#2a2a2e', '#1565c0', '#e07a10'] }),
    A('shirtless', 9, { top: 'bare', topC: TEE, bot: 'shorts', botC: [...JEANS, ...KHAKI], shoeC: SNEAKER, shoe: 'sneaker', gear: [['dogtags', 0.2]], tearMul: 1.2 }),
    A('casual', 14, { top: 'tee', topC: TEE, bot: 'jeans', botC: JEANS, shoeC: SNEAKER, hat: [['hat_cap', 0.25]], gear: [['pack_small', 0.15]], gearC: CAP }),
    A('biker', 4, { top: 'tank', topC: ['#1c1c1c', '#2a2a2a'], bot: 'jeans', botC: ['#1c1c22', '#232a38'], shoe: 'boot', shoeC: ['#141210'], gear: [['chains', 0.6], ['vest_plate', 0.0], ['face_beard', 0.4], ['face_shades', 0.3]], glove: 0.7, gloveC: ['#141414'] }),
  ],
  crawler: [
    A('rags', 30, { top: 'rags', topC: [...TEE, '#5a4a3a'], bot: 'bare', botC: DARK, shoe: 'bare', tearMul: 1.5, hair: 'any', gear: [['bandage_hand', 0.2]] }),
    A('gown', 18, { top: 'gown', topC: ['#bcd4e0', '#a8c8d8', '#c8dce4'], bot: 'bare', botC: ['#bcd4e0'], shoe: 'bare', tearMul: 1.3, gear: [['bandage_hand', 0.4]] }),
    A('casual', 26, { top: 'tee', topC: TEE, bot: 'torn', botC: JEANS, shoe: 'bare', tearMul: 1.3, hat: [['hat_beanie', 0.1]], gear: [['watch', 0.2]] }),
    A('prisoner', 8, { top: 'long', topC: ['#e07a10'], bot: 'trousers', botC: ['#e07a10'], sync: true, shoe: 'bare', tearMul: 1.3, gear: [['cuffs', 0.5]] }),
    A('soldier', 6, { top: 'long', topC: ['#4a5236', '#5a5a3a'], topPat: [[3, 1]], bot: 'torn', botC: ['#4a5236'], botPat: [[3, 1]], shoe: 'boot', shoeC: BOOT, hat: [['hat_helmet', 0.3]], gear: [['dogtags', 0.6]], tearMul: 1.3 }),
  ],
  bloater: [
    A('xl_tee', 24, { top: 'tee', topC: TEE, bot: 'jeans', botC: [...JEANS, ...KHAKI], shoeC: SHOE_DARK, shoe: 'sneaker', hat: [['hat_cap', 0.2]], gear: [['watch', 0.2]], gearC: CAP }),
    A('gown', 18, { top: 'gown', topC: ['#bcd4e0', '#a8c8d8', '#c8dce4'], bot: 'bare', botC: ['#bcd4e0'], shoe: 'bare', gear: [['bandage_hand', 0.4]] }),
    A('sweater', 14, { top: 'sweater', topC: ['#6a4a3a', '#3a4a6a', '#4a6a4a', '#8a8a80'], bot: 'trousers', botC: KHAKI, shoe: 'dress', shoeC: SHOE_DARK, gear: [['face_glasses', 0.3], ['face_beard', 0.3]] }),
    A('cook', 10, { top: 'apron', topC: ['#e8e8e4', '#d8d4c8'], topPat: [[0, 1]], bot: 'trousers', botC: [...DARK, '#8a8a80'], shoe: 'sneaker', shoeC: ['#e8e8e4', '#2a2a2a'], hat: [['hat_cap', 0.5]], gear: [['apron', 0.95]], gearC: ['#e8e8e4'] }),
    A('coverall', 9, { top: 'long', topC: ['#4a5a3a', '#2a4a7a', '#7a4a22'], topPat: [[7, 4], [0, 2]], bot: 'trousers', botC: ['#4a5a3a', '#2a4a7a', '#7a4a22'], sync: true, shoe: 'boot', shoeC: BOOT, hat: [['hat_hard', 0.4]] }),
    A('shirtless', 9, { top: 'bare', topC: TEE, bot: 'trousers', botC: [...JEANS, ...KHAKI, ...DARK], shoe: 'bare', gear: [] }),
    A('suit', 6, { top: 'jacket', topC: SUIT, bot: 'trousers', botC: SUIT, sync: true, shoe: 'dress', shoeC: SHOE_DARK, gear: [['tie', 0.8], ['lanyard', 0.3]] }),
  ],
  spitter: [
    A('janitor', 16, { top: 'long', topC: ['#4a6a8a', '#5a7a5a', '#8a8a80'], bot: 'trousers', botC: ['#4a6a8a', '#5a7a5a', '#8a8a80'], sync: true, shoe: 'boot', shoeC: BOOT, hat: [['hat_cap', 0.3]], gear: [['belt_tool', 0.3]], glove: 0.6, gloveC: ['#e0d020', '#c62828'], gearC: CAP }),
    A('hazmat', 16, { top: 'long', topC: ['#d8c020', '#c8b820', '#e8d040'], bot: 'trousers', botC: ['#d8c020', '#c8b820'], sync: true, shoe: 'boot', shoeC: ['#1c1c1c', '#c8b820'], hat: [['hat_hood', 0.75]], gear: [['face_gasmask', 0.6], ['tank_o2', 0.15]], glove: 0.9, gloveC: ['#2a2a2a', '#c8b820'], tearMul: 1.5, gearC: ['#d8c020'] }),
    A('labcoat', 12, { top: 'lab', topC: ['#e8e8e6', '#cfd6d0'], bot: 'trousers', botC: DARK, shoe: 'dress', shoeC: SHOE_DARK, gear: [['face_glasses', 0.5], ['lanyard', 0.6], ['face_mask', 0.3]], glove: 0.4, gloveC: ['#3a70c8', '#e8e8e4'] }),
    A('farmer', 12, { top: 'long', topC: ['#a03030', '#3a6a3a', '#c8a040'], topPat: [[2, 5], [0, 1]], bot: 'jeans', botC: JEANS, shoe: 'boot', shoeC: BOOT, hat: [['hat_straw', 0.5], ['hat_cap', 0.3]], gear: [['suspenders', 0.6]], gearC: ['#c8a860', '#8a6a3a'] }),
    A('attendant', 8, { top: 'polo', topC: ['#c62828', '#1565c0', '#2e7d32'], bot: 'trousers', botC: DARK, shoe: 'sneaker', shoeC: SNEAKER, hat: [['hat_cap', 0.6]], gear: [['lanyard', 0.4], ['watch', 0.2]], gearC: CAP }),
    A('worker', 10, { top: 'long', topC: HIVIS, topPat: [[4, 5], [0, 1]], bot: 'trousers', botC: KHAKI, shoe: 'boot', shoeC: BOOT, hat: [['hat_hard', 0.6]], gear: [['belt_tool', 0.3]], glove: 0.5, gloveC: ['#a08040'], gearC: ['#f0c020', '#e07a10'] }),
    A('nurse', 8, { top: 'tee', topC: ['#7ab8c8', '#a8d0a8', '#c8a8d0'], bot: 'trousers', botC: null, sync: true, shoe: 'sneaker', shoeC: ['#e8e8e4'], gear: [['stetho', 0.4], ['face_mask', 0.4], ['lanyard', 0.6]] }),
  ],
  screamer: [
    A('gown', 32, { top: 'gown', topC: ['#bcd4e0', '#a8c8d8', '#c8dce4', '#d0d8d8'], bot: 'bare', botC: ['#bcd4e0'], shoe: 'bare', hair: 'long', gear: [['bandage_hand', 0.3]], tearMul: 1.2 }),
    A('nurse', 14, { top: 'tee', topC: ['#e8e8e4', '#a8d0d8'], bot: 'skirt', botC: ['#e8e8e4', '#a8d0d8'], shoe: 'sneaker', shoeC: ['#e8e8e4'], hair: 'long', hat: [], gear: [['stetho', 0.5], ['lanyard', 0.6], ['skirt', 1]], gearC: ['#e8e8e4'] }),
    A('dress', 12, { top: 'gown', topC: ['#e8e4d8', '#c8c8d8', '#d8c8c8'], bot: 'bare', botC: ['#e8e4d8'], shoe: 'bare', hair: 'long', tearMul: 1.6, gear: [] }),
    A('pajamas', 14, { top: 'long', topC: ['#a8c0e0', '#e0c0c8', '#c0d8c0'], topPat: [[6, 3], [0, 2]], bot: 'trousers', botC: ['#a8c0e0', '#e0c0c8', '#c0d8c0'], botPat: [[6, 3], [0, 2]], shoe: 'bare', hair: 'long', gear: [] }),
    A('office', 12, { top: 'long', topC: SHIRT_LIGHT, bot: 'skirt', botC: DARK, shoe: 'dress', shoeC: SHOE_DARK, hair: 'long', gear: [['lanyard', 0.6], ['skirt', 1], ['face_glasses', 0.3]] }),
    A('casual', 16, { top: 'tee', topC: TEE, bot: 'jeans', botC: JEANS, shoeC: SNEAKER, hair: 'long', gear: [] }),
  ],
  brute: [
    A('riot', 30, { top: 'long', topC: ['#1a2236', '#1c1c20'], bot: 'trousers', botC: ['#1a2236', '#1c1c20'], sync: true, shoe: 'boot', shoeC: ['#141210'], hat: [['hat_helmet', 0.85]], gear: [['plate_chest', 0.95], ['plate_shoulder', 0.9], ['plate_arm', 0.8], ['shield', 0.3], ['badge', 0.4]], glove: 0.9, gloveC: ['#141414'], tearMul: 1.4, gearC: ['#1c2028', '#262a30'], big: true }),
    A('bouncer', 18, { top: 'tank', topC: ['#1c1c1c', '#2a2a2a'], bot: 'trousers', botC: DARK, shoe: 'boot', shoeC: ['#141210'], gear: [['chains', 0.7], ['plate_shoulder', 0.5], ['face_shades', 0.5], ['spikes', 0.4]], glove: 0.6, gloveC: ['#141414'], tearMul: 1.4, big: true }),
    A('inmate', 16, { top: 'bare', topC: ['#e07a10'], bot: 'trousers', botC: ['#e07a10'], shoe: 'bare', gear: [['cuffs', 0.7], ['chains', 0.6], ['spikes', 0.3], ['plate_arm', 0.3]], tearMul: 1.2, big: true }),
    A('butcher', 12, { top: 'apron', topC: ['#e8e8e4'], bot: 'trousers', botC: DARK, shoe: 'boot', shoeC: BOOT, gear: [['apron', 1], ['plate_shoulder', 0.3], ['spikes', 0.3]], glove: 0.9, gloveC: ['#c8a020', '#3a3a3a'], tearMul: 1.3, big: true, gearC: ['#e8e8e4', '#8a2a22'] }),
    A('welded', 24, { top: 'rags', topC: ['#3a3a34', '#4a4038'], bot: 'torn', botC: ['#3a3a34'], shoe: 'boot', shoeC: BOOT, gear: [['plate_chest', 0.9], ['plate_shoulder', 1], ['plate_arm', 0.9], ['spikes', 0.8], ['chains', 0.5]], glove: 0.7, gloveC: ['#3a3a30'], tearMul: 1.5, big: true, gearC: ['#5a4030'] }),
  ],
  boss: [A('abomination', 1, { top: 'coat', topC: ['#3a2a2c', '#2a2420', '#3a3230'], bot: 'bare', shoe: 'bare', big: true, tearMul: 1.3 })],
};

/**
 * Who the dead were where the story goes (JOURNEY.md §2): archetype weight multipliers per
 * map id (patients at the hospital, workers at the rail yard, soldiers at the airbase,
 * shoppers at the mall ...). Every client has the same map, so the look stays the same.
 */
const THEMES = {
  hospital: { patient: 7, scrubs: 5, labcoat: 4, emt: 3, gown: 5, nurse: 5, dress: 2, pajamas: 3, police: 1.5 },
  mall: { casual: 2, shopper: 6, student: 3, hoodie: 2, cheer: 2, exec: 1.5, summer: 3, sundress: 3, teen: 3, athlete: 2, cook: 4, attendant: 4, office: 2, xl_tee: 2 },
  railyard: { worker: 6, mechanic: 5, overalls: 6, flannel: 3, vagrant: 3, coverall: 5, janitor: 2, hiker: 1.5 },
  airbase: { soldier: 9, police: 2, mechanic: 3, emt: 2, riot: 2, hazmat: 2 },
  metro: { commuter: 6, exec: 4, student: 3, vagrant: 4, hoodie: 2, office: 3, courier: 3, janitor: 2 },
  hollowcreek: { casual: 2, farmer: 2, police: 3, student: 3, flannel: 3, prisoner: 2, shopper: 2 },
  millroad: { farmer: 4, flannel: 4, overalls: 4, casual: 2, mechanic: 2, vagrant: 2 },
  forest: { hiker: 7, flannel: 4, farmer: 2, vagrant: 2 },
  dam: { worker: 5, overalls: 3, mechanic: 3, hazmat: 3, janitor: 2 },
};

// ---------------------------------------------------------------------------------------
// wound sites in rest-pose model space (+X forward, +Y up, +Z right; feet at 0, 56 tall).
// [x, y, z-sign-times-1, radius, kinds]; z is mirrored by a random side.

const SITES = {
  chest: { p: [3.6, 39.5, 2.2], r: [2.1, 3.0] },
  belly: { p: [3.0, 33.0, 1.7], r: [1.9, 2.8] },
  shoulder: { p: [0.4, 43.6, 6.3], r: [1.8, 2.5] },
  upperArm: { p: [0.2, 38.5, 7.4], r: [1.6, 2.3] },
  foreArm: { p: [0.5, 28.5, 7.2], r: [1.5, 2.1] },
  neck: { p: [1.6, 48.0, 1.2], r: [1.3, 1.8] },
  thigh: { p: [2.0, 22.0, 3.2], r: [2.0, 2.8] },
  calf: { p: [1.3, 9.0, 3.2], r: [1.5, 2.0] },
  back: { p: [-3.2, 39.0, 2.0], r: [1.8, 2.7] },
  cheek: { p: [3.3, 51.2, 1.7], r: [1.1, 1.5] },
  hip: { p: [2.0, 27.5, 4.6], r: [1.8, 2.5] },
};
const SITE_NAMES = Object.keys(SITES);
const BELLY_SITE = { p: [10.3, 35.0, 3.8], r: [2, 3] };

function makeWound(r, type, siteName, T) {
  let s = SITES[siteName];
  if (T === 'bloater' && (siteName === 'belly' || siteName === 'chest')) s = BELLY_SITE;
  if (T === 'crawler' && (siteName === 'thigh' || siteName === 'calf' || siteName === 'hip')) s = SITES.back;
  const side = r() < 0.5 ? -1 : 1;
  const rad = range(r, s.r[0], s.r[1]);
  const x = s.p[0] + (r() - 0.5) * 0.8, y = s.p[1] + (r() - 0.5) * 1.6, z = (Math.abs(s.p[2]) < 0.5 ? 0 : side * s.p[2]) + (r() - 0.5) * 0.8;
  return { x, y, z, r: rad, type, site: siteName, side };
}

// ---------------------------------------------------------------------------------------

/** All option names as a set-style lookup for tests. */
export const OPTION_NAMES = OPTS;

/**
 * @param {string} type zombies.js id
 * @param {number} id sim id
 * @param {string} [theme] the map id: biases who the dead were (THEMES); '' or unknown = the general mix
 * @returns {object} the look (see the fields below); arrays are linear RGB
 */
export function zombieLook(type, id, theme = '') {
  const T = ARCH[type] ? type : 'walker';
  const r = rngFor(id, T.length * 131 + T.charCodeAt(0));
  const arch = weighted(r, ARCH[T], THEMES[theme] || null);
  const def = ZOMBIES[T];
  const look = { type: T, id: id | 0, arch: arch.name };
  const big = !!arch.big;

  // ---- body: height, build, head, arms ----
  const tall = range(r, 0.93, 1.08), thin = range(r, 0.88, 1.16);
  look.height = big ? range(r, 0.96, 1.06) : tall;
  look.girthW = thin * (T === 'runner' ? 0.97 : 1);
  look.girthD = range(r, 0.92, 1.12) * (T === 'runner' ? 0.98 : 1);
  look.headK = range(r, 0.94, 1.06);
  look.armK = range(r, 0.95, 1.1);
  look.female = arch.female || chance(r, T === 'screamer' ? 0.9 : arch.name === 'cheer' || arch.name === 'nurse' ? 0.85 : 0.42);
  if (look.female) { look.girthW *= 0.94; look.girthD *= 0.96; }

  // ---- skin: the person's own tone, drained (pallor), then shifted by decay toward an ashen
  // grey-green, sallow yellow-grey or bruised blue-grey (hue, not brightness); runners are fresh ----
  const human = lin(pick(r, SKIN_TONES));
  // (the freshly dead go grey-blue before they go green)
  const tint = lin(T === 'runner' ? pick(r, ['#80889a', '#8e9088', '#9a9c8c', '#8a8a96']) : chance(r, 0.25) ? def.look.skin : pick(r, DECAY));
  const stage = T === 'runner' ? pickW(r, [[0.08, 3], [0.2, 3], [0.35, 1]]) : pickW(r, [[0.25, 2], [0.45, 4], [0.7, 4], [0.95, 2]]);
  const hl = luma(human);
  let skin = mixRgb(human, [hl, hl, hl], 0.42 + stage * 0.3);
  const tl = luma(tint) || 1;
  skin = mixRgb(skin, [tint[0] * hl / tl, tint[1] * hl / tl, tint[2] * hl / tl], 0.2 + stage * 0.35);
  if (hl < 0.1) skin = mixRgb(skin, [0.085, 0.082, 0.074], 0.25 + stage * 0.3);   // dark skin goes ashen grey
  const dark = 0.92 - stage * 0.16;
  skin = [skin[0] * dark, skin[1] * dark, skin[2] * dark];
  // (and never so dark the face's hollows stop reading in daylight)
  const sl = luma(skin);
  if (sl < 0.04) { const k = 0.04 / Math.max(1e-4, sl); skin = [skin[0] * k, skin[1] * k, skin[2] * k]; }
  look.skin = capL(skin, 0.2);
  look.rot = Math.min(1, stage + r() * 0.12);
  look.veins = stage > 0.6 ? range(r, 0.4, 1) : chance(r, 0.35) ? range(r, 0.2, 0.6) : 0;
  look.sores = chance(r, T === 'spitter' || T === 'bloater' ? 0.6 : 0.16) ? range(r, 0.3, 1) : 0;

  // ---- clothes ----
  const topKind = arch.top;
  const tk = TOPS[topKind] || TOPS.tee;
  const topC = lin(pick(r, arch.topC || TEE));
  look.topKind = topKind;
  look.openFront = T !== 'boss' && (topKind === 'jacket' || topKind === 'coat' || topKind === 'lab' || !!arch.open);
  look.neck = NECK[topKind] ?? (topKind === 'tee' && chance(r, 0.35) ? 2 : 0);
  look.topPat = pickW(r, arch.topPat);
  look.hemTop = tk[0] + (topKind === 'bare' ? 0 : (r() - 0.5) * 2.2);
  look.sleeveEnd = tk[1] === 99 || tk[1] === 0 ? tk[1] : tk[1] + (r() - 0.5) * 3;
  // (a bloater's top rides up its belly: the lower belly hangs out under the hem; a gown, dress
  // or long coat still covers it)
  if (T === 'bloater' && look.hemTop < 31 && !['bare', 'gown', 'dress', 'coat', 'lab'].includes(topKind)) look.hemTop = 31.5 + r() * 3.5;
  const legKind = arch.bot;
  look.legKind = legKind;
  look.legHem = LEGS[legKind] ?? -1;
  if (look.legHem > 0 && look.legHem < 90) look.legHem += (r() - 0.5) * 2.5;
  const botList = arch.botC;
  let botC = botList ? lin(pick(r, botList)) : topC;
  if (arch.sync) botC = mixRgb(topC, botC, 0.15);
  look.botPat = arch.sync ? look.topPat : pickW(r, arch.botPat);
  if (arch.sync && topKind === 'jacket') look.botPat = look.topPat;
  // everything has been lying in the road for weeks: grimed, sun-faded, darker (no toy colours)
  const fresh = T === 'runner' ? 0.6 : 1;
  const grime = (c, lo, hi, cap) => {
    let q = mixRgb(c, [0.045, 0.038, 0.03], range(r, lo, hi) * fresh);
    const gy = luma(q);
    q = mixRgb(q, [gy * 1.02, gy, gy * 0.94], range(r, 0.22, 0.5) * fresh);
    return capL(q, cap);
  };
  look.top = grime(topC, 0.25, 0.55, 0.2);
  look.bottom = grime(botC, 0.25, 0.55, 0.17);
  const tearBase = T === 'brute' || T === 'boss' ? 0.8 : T === 'runner' ? 0.15 + r() * 0.35 : 0.25 + r() * 0.6;
  look.tear = Math.min(1, tearBase * (arch.tearMul || 1));
  look.blood = Math.min(1, 0.25 + r() * 0.55 + (T === 'crawler' ? 0.15 : 0) + (T === 'runner' ? 0.15 : 0));
  look.wet = 0;

  // ---- gear colours and shoes ----
  const gearC = arch.gearFromBot ? botC : lin(pick(r, arch.gearC || CAP));
  look.gear = grime(gearC, 0.25, 0.5, 0.2);
  const shoeList = arch.shoeC || (arch.shoe === 'boot' ? BOOT : arch.shoe === 'sneaker' ? SNEAKER : SHOE_DARK);
  look.trim = grime(lin(pick(r, shoeList)), 0.15, 0.4, 0.18);
  const gloveC = arch.gloveC ? lin(pick(r, arch.gloveC)) : null;
  look.glove = !!(gloveC && chance(r, arch.glove ?? 0));
  look.gloveCol = capL(gloveC || [0.02, 0.02, 0.02], 0.22);
  look.shoe = arch.shoe === 'bare' ? null : arch.shoe;
  look.shoeKind = arch.shoe === 'sneaker' ? 1 : arch.shoe === 'boot' ? 2 : 0;
  // one shoe lost somewhere along the way
  look.shoeLost = !!look.shoe && chance(r, T === 'runner' ? 0.05 : 0.14);

  // ---- hats, hair ----
  look.hairCol = lin(pickW(r, HAIR));
  const opts = new Set();
  let hat = null;
  for (const [o, p] of arch.hat || []) if (!hat && chance(r, p)) hat = o;
  look.visor = hat === 'hat_visor';
  if (look.visor) hat = 'hat_cap';
  if (hat) opts.add(hat);
  const under = hat === 'hat_hard' || hat === 'hat_helmet' || hat === 'hat_fire' || hat === 'hat_beanie' || hat === 'hat_hood' || hat === 'hat_peak';
  let hairStyles;
  if (arch.hair === 'long') hairStyles = [['long', 5], ['stringy', 2], ['shoulder', 2], ['bob', 2], [null, 0.5]];
  else if (under) hairStyles = [[null, 3], ['short', 3], ['patchy', 2]];
  else if (hat === 'hat_cap' || hat === 'hat_straw') hairStyles = [[null, 1.5], ['short', 3], ['patchy', 2], ['pony', look.female ? 3 : 0.5], ['shoulder', 1]];
  else hairStyles = look.female
    ? [['long', 4], ['stringy', 2.5], ['bob', 3], ['shoulder', 2], ['pony', 2.5], ['bun', 1.5], ['afro', 0.8], ['patchy', 1.5], [null, 0.4]]
    : [['short', 5], ['patchy', 3], [null, 3], ['shaggy', 2], ['stringy', 1.2], ['mohawk', 0.5], ['afro', 0.6], ['shoulder', 1], ['pony', 0.4]];
  if (T === 'bloater') hairStyles = [[null, 4], ['patchy', 2], ['short', 2]];
  if (T === 'brute' || T === 'boss') hairStyles = [[null, 1]];
  const hs = pickW(r, hairStyles);
  look.hairStyle = hs;
  look.hairCut = 0; look.hairSparse = 0;
  if (hs) {
    const st = HAIR_STYLES[hs];
    if (st.scalp !== false) opts.add('hair_scalp');
    if (st.opt) opts.add(st.opt);
    if (st.strands) { opts.add('hair_strands'); look.hairCut = st.strands[0]; look.hairSparse = st.strands[1]; }
  }

  // ---- gear options ----
  for (const [o, p] of arch.gear || []) if (chance(r, p)) opts.add(o);
  // back items exclude each other
  const backs = ['pack_small', 'pack_big', 'bag_msg', 'tank_o2', 'bag_medic'].filter((o) => opts.has(o));
  for (let i = 1; i < backs.length; i++) opts.delete(backs[i]);
  look.lensDark = 0;
  if (opts.has('face_shades')) { opts.delete('face_shades'); opts.add('face_glasses'); look.lensDark = 1; }
  if (opts.has('face_gasmask')) { opts.delete('face_mask'); opts.delete('face_glasses'); }
  if (look.shoe) opts.add('shoe');
  if (legKind === 'skirt') opts.add('skirt');
  look.hat = hat;
  // most still have their nose; on some it has rotted (or been bitten) down to the cavity
  if (T !== 'brute' && T !== 'boss' && chance(r, T === 'runner' ? 0.95 : T === 'crawler' ? 0.45 : T === 'screamer' ? 0.6 : 0.78)) opts.add('nose');

  // ---- eyes ----
  look.eyeCol = lin(pick(r, EYES[T] || EYES.walker));
  const es = r();
  look.eyeStyle = es < 0.09 ? 3 : es < 0.2 ? (r() < 0.5 ? 1 : 2) : 0;
  // a dim wet sheen that catches the dark, not a lamp (the boss and elites still burn)
  look.eyeGlow = T === 'boss' ? 2.4 : T === 'spitter' ? 0.8 : T === 'brute' ? 0.6 : 0.32 * range(r, 0.75, 1.3);
  if (look.eyeStyle === 3) look.eyeGlow *= 0.5;

  // ---- wounds and missing parts ----
  const wounds = [];
  const nW = pickW(r, [[0, T === 'boss' ? 4 : 3.5], [1, 4], [2, 2.5]]);
  const kinds = [WOUND.GASH, WOUND.GASH, WOUND.BITE, WOUND.BITE, WOUND.BULLET, WOUND.BONE, WOUND.BURN];
  for (let i = 0; i < nW; i++) {
    let site = pick(r, SITE_NAMES);
    let type = pick(r, kinds);
    if (site === 'cheek' && type !== WOUND.BITE) type = WOUND.BITE;
    if (site === 'neck') type = chance(r, 0.7) ? WOUND.BITE : WOUND.GASH;
    if (type === WOUND.BONE && site !== 'foreArm' && site !== 'upperArm' && site !== 'calf' && site !== 'thigh') type = WOUND.GASH;
    if (T === 'spitter' && chance(r, 0.5)) type = WOUND.ACID;
    if (T === 'crawler' && (site === 'thigh' || site === 'calf' || site === 'hip')) site = 'back';
    wounds.push(makeWound(r, type, site, T));
  }
  look.wounds = wounds;
  look.missing = { jaw: false, armL: false, armR: false, handL: false, handR: false };
  if (T === 'walker' || T === 'runner' || T === 'bloater') {
    if (chance(r, 0.05)) look.missing.jaw = true;
    const lim = chance(r, 0.09);
    if (lim) {
      const which = r();
      if (which < 0.34) look.missing.armL = true;
      else if (which < 0.68) look.missing.armR = true;
      else if (which < 0.84) look.missing.handL = true;
      else look.missing.handR = true;
    }
  }
  if (look.missing.armL) opts.add('stump_l');
  if (look.missing.armR) opts.add('stump_r');
  if (look.missing.handL) opts.add('stump_hand_l');
  if (look.missing.handR) opts.add('stump_hand_r');
  // gore geometry: ribs / entrails hang out of chest and belly wounds; a bone through an arm
  for (const w of wounds) {
    if (T === 'brute' || T === 'boss') continue;
    if (w.type === WOUND.GASH && (w.site === 'chest') && T !== 'bloater' && chance(r, 0.6)) { opts.add('ribs'); w.x = 3.3; w.y = 39.2; w.z = -2.8; w.r = 3.0; }
    else if (w.type === WOUND.GASH && w.site === 'belly' && T !== 'bloater' && chance(r, 0.55)) { opts.add('entrails'); w.x = 3.0; w.y = 32.6; w.z = 1.0; w.r = 2.7; }
    else if (w.type === WOUND.BONE && w.site === 'foreArm' && chance(r, 0.6) && !look.missing.armL && !look.missing.armR) opts.add('bone_arm');
  }
  if (T !== 'brute' && T !== 'boss' && chance(r, 0.025)) opts.add(chance(r, 0.5) ? 'rebar' : 'arrow');
  if (T === 'walker' && chance(r, 0.05) && !opts.has('spine')) opts.add('spine');
  look.opts = opts;

  // ---- gait ----
  look.gait = {
    armsMode: pickW(r, [[0, 4], [1, 3], [2, 1.5], [3, 1.2], [4, 0.6]]),   // 0 both up, 1 dangling, 2 one arm reaching, 3 clawing, 4 hugging itself
    limp: chance(r, 0.32) ? (chance(r, 0.5) ? 1 : -1) : 0,
    lurch: range(r, 0, 1),           // irregular stride
    headJerk: range(r, 0, 1),
    sway: range(r, 0.6, 1.5),
    stiff: range(r, 0, 1),
    speedK: range(r, 0.92, 1.1),
    phase: r() * Math.PI * 2,
    tilt: (r() - 0.5) * 0.6,
    hunch: range(r, 0, 1),
    twitchRate: range(r, 0, 1),
    lookSide: r() < 0.5 ? -1 : 1,
    // asymmetry: one shoulder lower, an arm hanging out of its socket, a neck too weak to hold
    // the head, the head jutting forward, the lame foot dragging its toes
    drop: (r() - 0.5) * 0.4,
    disloc: chance(r, 0.14) ? (r() < 0.5 ? -1 : 1) : 0,
    loll: range(r, 0.15, 1),
    jut: range(r, 0.2, 1),
    drag: 0,
  };
  look.gait.drag = look.gait.limp && chance(r, 0.6) ? 1 : 0;
  if (look.missing.armL && look.gait.disloc < 0) look.gait.disloc = 0;
  if (look.missing.armR && look.gait.disloc > 0) look.gait.disloc = 0;
  return look;
}

const typeOpts = new Map();
/**
 * Every accessory group a type's zombies can wear (the model builder only builds those, so
 * a brute does not carry a hairdresser's worth of hidden geometry).
 * @returns {Set<string>}
 */
export function optionsForType(type) {
  let set = typeOpts.get(type);
  if (set) return set;
  set = new Set();
  const T = ARCH[type] ? type : 'walker';
  const norm = (o) => (o === 'hat_visor' ? 'hat_cap' : o === 'face_shades' ? 'face_glasses' : o);
  for (const a of ARCH[T]) {
    for (const [o] of a.hat || []) set.add(norm(o));
    for (const [o] of a.gear || []) set.add(norm(o));
    if (a.shoe !== 'bare') set.add('shoe');
    if (a.bot === 'skirt') set.add('skirt');
  }
  if (T !== 'brute' && T !== 'boss') {
    for (const o of ['hair_scalp', 'hair_strands', 'nose']) set.add(o);
    if (T !== 'bloater') for (const o of ['hair_pony', 'hair_bun']) set.add(o);
    for (const o of ['ribs', 'entrails', 'rebar', 'arrow', 'bone_arm']) set.add(o);
    if (T === 'walker' || T === 'runner' || T === 'bloater') for (const o of ['stump_l', 'stump_r', 'stump_hand_l', 'stump_hand_r']) set.add(o);
    if (T === 'walker') set.add('spine');
  }
  typeOpts.set(type, set);
  return set;
}

// ---------------------------------------------------------------------------------------
// packing

/** The three 24-bit option words of a look. */
export function optionWords(opts, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  for (const name of opts) {
    const b = optBit(name);
    if (b >= 0) out[(b / 24) | 0] |= 1 << (b % 24);
  }
  return out;
}

/**
 * Write a look into a rig-texture row. `stage` is the pool's staging array and `base` the
 * row's first float (k * TEX_W * 4). The fx texels (T_FX, T_FX2) are left to the caller.
 */
export function packLook(look, stage, base, eliteEye = null) {
  const put = (t, x, y, z, w) => { const o = base + t * 4; stage[o] = x; stage[o + 1] = y; stage[o + 2] = z; stage[o + 3] = w; };
  const s = look.skin, c = look.top, b = look.bottom, h = look.hairCol, e = look.eyeCol, g = look.gear, tr = look.trim, gl = look.gloveCol;
  put(T_SKIN, s[0], s[1], s[2], look.rot);
  put(T_CLOTH, c[0], c[1], c[2], look.tear);
  put(T_CLOTH2, b[0], b[1], b[2], look.blood);
  put(T_ACCENT, eliteEye ? eliteEye[0] : e[0], eliteEye ? eliteEye[1] : e[1], eliteEye ? eliteEye[2] : e[2], eliteEye ? 7 : look.eyeGlow);
  put(T_HAIR, h[0], h[1], h[2], (look.id % 97) + (look.id % 13) * 0.0713);
  put(T_VAR1, look.hemTop, look.sleeveEnd, look.legHem, look.topPat);
  put(T_VAR2, look.botPat, look.veins, look.sores, look.eyeStyle);
  const w0 = look.wounds[0], w1 = look.wounds[1];
  if (w0) put(T_WND1, w0.x, w0.y, w0.z, w0.r + 8 * w0.type); else put(T_WND1, 0, 0, 0, 0);
  if (w1) put(T_WND2, w1.x, w1.y, w1.z, w1.r + 8 * w1.type); else put(T_WND2, 0, 0, 0, 0);
  const words = look._words || (look._words = optionWords(look.opts, [0, 0, 0]));
  put(T_OPT, words[0], words[1], words[2], look.glove ? 1 : 0);
  put(T_VAR3, look.hairCut, look.hairSparse, look.shoeKind + (look.visor ? 10 : 0), look.lensDark);
  put(T_COL3, g[0], g[1], g[2], look.openFront ? 1 : 0);
  put(T_COL4, tr[0], tr[1], tr[2], look.shoeLost ? 1 : 0);
  put(T_COL5, gl[0], gl[1], gl[2], look.neck || 0);
}
const _words = [0, 0, 0];

export { TEX_W };
