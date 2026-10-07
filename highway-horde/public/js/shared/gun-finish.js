// Gun materials and finishes (pure data, no three.js): the baked material families of
// public/textures/guns/ (scripts/bake-guns.js draws them), which family every part of every
// gun is made of, and the cosmetic gun skins a player can pick (shown on their first-person gun
// and on their gun as teammates see it; the choice rides in the lobby roster as `skin`).
//
// A family is one layer of the renderer's gun texture arrays (render3d/gun-tex.js): albedo,
// normal and packed AO / roughness / metalness, tiling every `tile` gun units (1 unit ≈ 3 cm).
// `tint` says how much of the part's own colour (weapons.js sprite colours, the builders'
// shades) colours the texture: 0 = the texture's colour (only its brightness follows the
// part), 1 = the part's colour (a neutral texture: paint, Cerakote). `ref` is the part colour
// the texture is drawn for (a part of exactly that colour shows the texture as baked).
// `ns` scales the baked normals (grainy finishes are kept subtle at arm's length).
// `bare` is what shows where the finish wears through: 'steel' | 'alu' | 'brass' | 'scuff'
// (polymer / rubber go pale) | 'wood' (raw wood under the lacquer).

/** Surface classes of actor-guns.js (GM), repeated here so the data needs no renderer import. */
export const GUN_CLASS = Object.freeze({ STEEL: 0, ALLOY: 1, POLY: 2, WOOD: 3, RUBBER: 4, BRASS: 5, LENS: 6, PAINT: 7, MARK: 8 });

/**
 * The material families, in texture-array layer order. size: the baked PNG size (the renderer
 * resizes every layer to its tier's size).
 */
export const GUN_FAMILIES = Object.freeze([
  { id: 'parkerized', name: 'Parkerised steel', group: 'metal', size: 2048, tile: 22, tint: 0.15, ref: '#2a2c2e', bare: 'steel', ns: 0.35 },
  { id: 'phosphate', name: 'Zinc-phosphate steel', group: 'metal', size: 2048, tile: 22, tint: 0.15, ref: '#34362f', bare: 'steel', ns: 0.4 },
  { id: 'blued', name: 'Blued steel', group: 'metal', size: 2048, tile: 24, tint: 0.1, ref: '#23262b', bare: 'steel', ns: 0.5 },
  { id: 'anod_black', name: 'Anodised aluminium, black', group: 'metal', size: 2048, tile: 22, tint: 0.1, ref: '#1e1f21', bare: 'alu', ns: 0.3 },
  { id: 'anod_tan', name: 'Anodised aluminium, tan', group: 'metal', size: 2048, tile: 22, tint: 0.1, ref: '#8a7656', bare: 'alu', ns: 0.3 },
  { id: 'anod_od', name: 'Anodised aluminium, OD', group: 'metal', size: 2048, tile: 22, tint: 0.1, ref: '#3a3e2c', bare: 'alu', ns: 0.3 },
  { id: 'stainless', name: 'Bead-blasted stainless', group: 'metal', size: 2048, tile: 20, tint: 0.1, ref: '#8d8d8d', bare: 'steel', ns: 0.4 },
  { id: 'brushed', name: 'Brushed steel', group: 'metal', size: 2048, tile: 26, tint: 0.1, ref: '#8a8c8e', bare: 'steel', ns: 0.6 },
  { id: 'poly_black', name: 'Black polymer, stippled', group: 'polymer', size: 2048, tile: 20, tint: 0.1, ref: '#1c1c1c', bare: 'scuff', ns: 0.55 },
  { id: 'poly_fde', name: 'FDE polymer, stippled', group: 'polymer', size: 2048, tile: 20, tint: 0.1, ref: '#8a7350', bare: 'scuff', ns: 0.55 },
  { id: 'poly_od', name: 'OD polymer, stippled', group: 'polymer', size: 2048, tile: 20, tint: 0.1, ref: '#4a4f3a', bare: 'scuff', ns: 0.55 },
  { id: 'poly_grip', name: 'Polymer grip texture', group: 'grip', size: 1024, tile: 9, tint: 1, ref: '#808080', bare: 'scuff', ns: 1.0 },
  { id: 'walnut', name: 'Walnut, oiled and lacquered', group: 'wood', size: 2048, tile: 30, tint: 0.3, ref: '#4a3020', bare: 'wood', ns: 0.6 },
  { id: 'birch', name: 'Birch laminate', group: 'wood', size: 2048, tile: 30, tint: 0.3, ref: '#9a7a52', bare: 'wood', ns: 0.6 },
  { id: 'rubber', name: 'Pebbled rubber', group: 'grip', size: 1024, tile: 12, tint: 0.6, ref: '#1a1a1a', bare: 'scuff', ns: 0.85 },
  { id: 'checker', name: 'Checkering', group: 'grip', size: 1024, tile: 8, tint: 1, ref: '#808080', bare: 'scuff', ns: 1.0 },
  { id: 'knurl', name: 'Knurled steel', group: 'grip', size: 1024, tile: 3.2, tint: 0.4, ref: '#2a2c2e', bare: 'steel', ns: 1.0 },
  { id: 'cerakote', name: 'Cerakote', group: 'coating', size: 2048, tile: 22, tint: 1, ref: '#808080', bare: 'steel', ns: 0.4 },
  { id: 'brass', name: 'Brass and copper', group: 'metal', size: 1024, tile: 14, tint: 0.55, ref: '#c9a24a', bare: 'brass', ns: 0.5 },
  { id: 'paint', name: 'Enamel paint over steel', group: 'coating', size: 1024, tile: 18, tint: 1, ref: '#808080', bare: 'steel', ns: 0.5 },
  { id: 'sight', name: 'Blackened sight steel', group: 'metal', size: 1024, tile: 6, tint: 0.2, ref: '#1b1c1e', bare: 'steel', ns: 0.8 },
]);

/** Layer index of a family id (-1: none). */
export const FAMILY_LAYER = Object.freeze(Object.fromEntries(GUN_FAMILIES.map((f, i) => [f.id, i])));

/**
 * The ageing overlay every gun shares (one 2048² texture, scripts/bake-guns.js 'wear'):
 * R fine scratches, G edge-chip breakup, B fingerprints and smudges, A grime / carbon breakup.
 */
export const GUN_WEAR_FILE = 'wear';

/**
 * Per weapon: the family of each kind of part. steel / alloy / poly / wood: the families of the
 * builders' STEEL / ALLOY / POLY / WOOD parts ('auto' poly picks black / FDE / OD from the part's
 * colour); grip: the texture laid over wood and polymer where the firing hand holds the gun
 * (checkering on wood, a grip pattern on polymer); colour: the family of brightly coloured parts
 * (the gun's identity colour: a flare gun's orange, a cryo blaster's white).
 */
export const WEAPON_FINISH = Object.freeze({
  pistol: { steel: 'parkerized', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  magnum: { steel: 'stainless', alloy: 'stainless', poly: 'poly_black', wood: 'walnut', grip: 'checker', colour: 'cerakote' },
  sawedoff: { steel: 'blued', alloy: 'blued', poly: 'poly_black', wood: 'walnut', grip: 'checker', colour: 'cerakote' },
  uzi: { steel: 'parkerized', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  shotgun: { steel: 'blued', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'checker', colour: 'cerakote' },
  rifle: { steel: 'phosphate', alloy: 'anod_od', poly: 'auto', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  flare: { steel: 'parkerized', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'paint' },
  tommy: { steel: 'blued', alloy: 'blued', poly: 'poly_black', wood: 'walnut', grip: 'checker', colour: 'cerakote' },
  burst_rifle: { steel: 'phosphate', alloy: 'anod_black', poly: 'poly_fde', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  dual_smg: { steel: 'parkerized', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  crossbow: { steel: 'phosphate', alloy: 'anod_black', poly: 'auto', wood: 'birch', grip: 'poly_grip', colour: 'cerakote' },
  dmr: { steel: 'phosphate', alloy: 'anod_tan', poly: 'poly_fde', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  lever: { steel: 'blued', alloy: 'blued', poly: 'poly_black', wood: 'walnut', grip: 'checker', colour: 'cerakote' },
  sniper: { steel: 'parkerized', alloy: 'anod_black', poly: 'auto', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  chainsaw: { steel: 'brushed', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'paint' },
  auto_shotgun: { steel: 'parkerized', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  flamethrower: { steel: 'brushed', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'paint' },
  harpoon: { steel: 'stainless', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'paint' },
  cryo: { steel: 'stainless', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  lmg: { steel: 'parkerized', alloy: 'anod_od', poly: 'poly_od', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  grenade_launcher: { steel: 'phosphate', alloy: 'anod_od', poly: 'poly_od', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  rocket: { steel: 'phosphate', alloy: 'anod_od', poly: 'poly_od', wood: 'walnut', grip: 'poly_grip', colour: 'paint' },
  tesla: { steel: 'brushed', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  minigun: { steel: 'phosphate', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  railgun: { steel: 'brushed', alloy: 'anod_black', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  amr: { steel: 'parkerized', alloy: 'anod_od', poly: 'poly_black', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
  hmg: { steel: 'parkerized', alloy: 'anod_od', poly: 'poly_od', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' },
});

/** The finish of a gun without its own entry (a weapon added later, a turret, a pickup). */
export const DEFAULT_FINISH = Object.freeze({ steel: 'parkerized', alloy: 'anod_black', poly: 'auto', wood: 'walnut', grip: 'poly_grip', colour: 'cerakote' });

export function finishOf(weaponId) {
  return WEAPON_FINISH[weaponId] || DEFAULT_FINISH;
}

// ---- colour helpers (sRGB hex → HSL) ----
function rgbOf(hex) {
  let s = String(hex || '#888888').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
/** [h (0..360), s, l] of an sRGB colour. */
export function hslOf(hex) {
  const [r, g, b] = rgbOf(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** A brightly coloured part (saturated and not near black): the gun's identity colour. */
function vivid(hex) {
  const [, s, l] = hslOf(hex);
  return s > 0.42 && l > 0.14 && l < 0.92;
}

/**
 * The family of one part: its surface class (GUN_CLASS), its colour and the gun it is on.
 * `hint` is a builder's explicit choice ('sight', 'knurl', or any family id).
 * @returns {string|null} family id, or null for parts drawn without a texture (lenses, markings)
 */
export function familyFor(cls, color, weaponId, hint = null) {
  if (hint && FAMILY_LAYER[hint] !== undefined) return hint;
  const f = finishOf(weaponId);
  const [h, s, l] = hslOf(color);
  switch (cls) {
    case GUN_CLASS.STEEL:
      if (vivid(color)) return f.colour;
      // pale grey steel on a dark gun: springs, rods, bolt faces, barrels left in the white
      if (l > 0.42 && s < 0.2 && f.steel !== 'stainless' && f.steel !== 'brushed') return 'stainless';
      return f.steel;
    case GUN_CLASS.ALLOY:
      if (vivid(color)) return f.colour;
      return f.alloy;
    case GUN_CLASS.POLY: {
      if (vivid(color)) return f.colour;
      if (f.poly !== 'auto') return f.poly;
      // by colour: tan / brown → FDE, olive / green → OD, else black
      if (l > 0.16 && s > 0.12 && h >= 20 && h < 55) return 'poly_fde';
      if (l > 0.1 && s > 0.08 && h >= 55 && h < 160) return 'poly_od';
      return 'poly_black';
    }
    case GUN_CLASS.WOOD:
      return l > 0.42 ? 'birch' : f.wood;
    case GUN_CLASS.RUBBER:
      // pale "rubber" is cord, string or tape: plain painted look
      if (l > 0.6) return 'cerakote';
      return vivid(color) ? f.colour : 'rubber';
    case GUN_CLASS.BRASS:
      return 'brass';
    case GUN_CLASS.PAINT:
      return vivid(color) || l > 0.6 ? 'paint' : f.colour === 'paint' ? 'paint' : 'cerakote';
    default:
      return null;
  }
}

/** The grip texture laid over a class inside the firing hand's grip (null: none). */
export function gripFamilyFor(cls, weaponId) {
  const f = finishOf(weaponId);
  if (cls === GUN_CLASS.WOOD) return 'checker';
  if (cls === GUN_CLASS.POLY) return f.grip === 'checker' ? 'poly_grip' : f.grip;
  return null;
}

// ---------------------------------------------------------------------------------------
// skins: cosmetic finishes over any gun

/**
 * The selectable gun skins. pattern: the baked pattern layer (skin texture array; null: none);
 * covers: which surface classes the finish is applied to; wear: edge-wear multiplier; grime:
 * dirt / carbon multiplier; scratch: scratch strength; metal: the finish's own metalness where
 * it covers (null: the pattern's); roughMin: a roughness floor (polished finishes stay off a
 * mirror: the sun's highlight in a mirror-gloss barrel blooms the whole gun); swatch: UI colours.
 */
export const GUN_SKINS = Object.freeze([
  { id: 'factory', name: 'Factory', desc: 'The finish it left the factory with: light holster wear.', pattern: null, covers: [], wear: 0.55, grime: 0.6, scratch: 0.6, swatch: ['#2a2c2e', '#4a4f3a', '#6b5136'] },
  { id: 'battleworn', name: 'Battle-worn', desc: 'Years of hard use: finish worn to bare metal on every edge, scratched, carbon-fouled.', pattern: null, covers: [], wear: 2.2, grime: 1.7, scratch: 2.2, swatch: ['#3a3b3c', '#8a8a86', '#5a4a3a'] },
  { id: 'woodland', name: 'Woodland camo', desc: 'Four-colour woodland blotches, hand-sprayed.', pattern: 'woodland', covers: ['metal', 'polymer', 'coating'], wear: 1.0, grime: 0.9, scratch: 0.8, swatch: ['#3d4a2a', '#5e5232', '#22261a'] },
  { id: 'desert', name: 'Desert camo', desc: 'Sand, khaki and brown: the colours of Sandstone.', pattern: 'desert', covers: ['metal', 'polymer', 'coating'], wear: 1.0, grime: 0.9, scratch: 0.8, swatch: ['#c8ad7f', '#9c7f56', '#6e5536'] },
  { id: 'urban', name: 'Urban digital', desc: 'Pixelated greys for concrete and asphalt.', pattern: 'urban', covers: ['metal', 'polymer', 'coating'], wear: 0.9, grime: 0.9, scratch: 0.8, swatch: ['#8a8d90', '#55595e', '#2e3134'] },
  { id: 'arctic', name: 'Arctic', desc: 'Winter white over grey, chipped where the hands go.', pattern: 'arctic', covers: ['metal', 'polymer', 'coating'], wear: 1.1, grime: 0.7, scratch: 0.8, swatch: ['#e6eaec', '#b8c0c6', '#7e8890'] },
  { id: 'tiger', name: 'Tiger stripe', desc: 'Jungle tiger stripes, brushed on.', pattern: 'tiger', covers: ['metal', 'polymer', 'coating'], wear: 1.0, grime: 0.9, scratch: 0.8, swatch: ['#5a6a3a', '#2a2a1c', '#8a7a4a'] },
  { id: 'carbon', name: 'Carbon fibre', desc: 'Twill-woven carbon under a gloss clear coat.', pattern: 'carbon', covers: ['metal', 'polymer', 'coating'], wear: 0.5, grime: 0.6, scratch: 0.7, roughMin: 0.22, swatch: ['#1a1b1d', '#3a3c40', '#0c0c0d'] },
  { id: 'damascus', name: 'Damascus', desc: 'Pattern-welded steel, etched and polished.', pattern: 'damascus', covers: ['metal'], wear: 0.4, grime: 0.4, scratch: 0.6, metal: 1, roughMin: 0.32, swatch: ['#9a9ea4', '#4a4e54', '#c8ccd0'] },
  { id: 'gold', name: 'Gold', desc: 'Every metal part plated in polished gold.', pattern: 'gold', covers: ['metal'], wear: 0.35, grime: 0.3, scratch: 0.5, metal: 1, roughMin: 0.26, swatch: ['#e8b84a', '#ffd97a', '#8a6a2a'] },
  { id: 'zombie', name: 'Zombie hunter', desc: 'Caked in grime and dried blood. It has seen things.', pattern: 'blood', covers: ['metal', 'polymer', 'coating', 'wood', 'grip'], wear: 1.6, grime: 2.0, scratch: 1.6, swatch: ['#4a1a14', '#2a2420', '#6a2a1e'] },
  { id: 'hazard', name: 'Hazard', desc: 'Hand-painted yellow and black stripes, chipped and scuffed.', pattern: 'hazard', covers: ['metal', 'polymer', 'coating'], wear: 1.3, grime: 1.0, scratch: 1.0, swatch: ['#f2b705', '#1a1a1a', '#c8920a'] },
]);

export const GUN_SKIN_IDS = Object.freeze(GUN_SKINS.map((s) => s.id));
export const DEFAULT_SKIN = 'factory';

/** The baked skin patterns, in skin-texture-array layer order. */
export const SKIN_PATTERNS = Object.freeze(['woodland', 'desert', 'urban', 'arctic', 'tiger', 'carbon', 'damascus', 'gold', 'blood', 'hazard']);
/** Pattern layer of a pattern id (-1: none). */
export const PATTERN_LAYER = Object.freeze(Object.fromEntries(SKIN_PATTERNS.map((p, i) => [p, i])));
/** World units per repeat of a skin pattern on the gun. */
export const PATTERN_TILE = Object.freeze({ woodland: 30, desert: 26, urban: 18, arctic: 26, tiger: 28, carbon: 4.5, damascus: 14, gold: 12, blood: 24, hazard: 16 });
/** Size of the baked skin PNGs. */
export const SKIN_SIZE = 1024;

/** A valid skin id (anything else → the default). */
export function sanitizeSkin(id) {
  return typeof id === 'string' && GUN_SKIN_IDS.includes(id) ? id : DEFAULT_SKIN;
}

export function skinOf(id) {
  return GUN_SKINS.find((s) => s.id === id) || GUN_SKINS[0];
}

/** The groups a family belongs to for a skin's `covers` list. */
export function familyGroup(familyId) {
  const f = GUN_FAMILIES[FAMILY_LAYER[familyId]];
  return f ? f.group : null;
}
