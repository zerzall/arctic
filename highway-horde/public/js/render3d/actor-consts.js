// Constants shared by the rig (actor-rig.js), its material (actor-rigmat.js), the model
// builders and the per-instance look generators. No imports: pure data, safe for Node tests.

export const NB = 20;
export const B = {
  HIPS: 0, SPINE: 1, CHEST: 2, NECK: 3, HEAD: 4, JAW: 5,
  UARM_L: 6, FARM_L: 7, HAND_L: 8, UARM_R: 9, FARM_R: 10, HAND_R: 11,
  THIGH_L: 12, SHIN_L: 13, FOOT_L: 14, THIGH_R: 15, SHIN_R: 16, FOOT_R: 17, X1: 18, X2: 19,
};
export const DEFAULT_PARENTS = [-1, 0, 1, 2, 3, 4, 2, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16, 2, 2];

// Row layout of the rig texture: 3 texels (matrix rows) per bone, then per-instance parameters.
// Every parameter texel is zero for an instance that sets nothing, and zero means "off"
// (no garment cuts, no wounds, no hidden options shown) — survivors use them sparingly.
export const TEX_W = 76;
export const T_SKIN = 60;     // rgb skin, w = rot (0 healthy .. 1 rotten)
export const T_CLOTH = 61;    // rgb shirt/jacket, w = tear (0 intact .. 1 shredded)
export const T_CLOTH2 = 62;   // rgb trousers, w = blood (0 clean .. 1 soaked)
export const T_ACCENT = 63;   // rgb accent / eye colour, w = eye glow (HDR)
export const T_HAIR = 64;     // rgb hair, w = pattern seed (offsets the detail textures)
export const T_FX = 65;       // x buff pulse, y char, z hit flash, w rim strength
export const T_FX2 = 66;      // x burning, y glow parts (HDR), z wet, w frost (cryo: 0.45 chilled, 1 frozen)
export const T_VAR1 = 67;     // x hem of the top (model y; the shell below it is cut away), y sleeve end (cut below), z trouser hem (skin below), w top pattern
export const T_VAR2 = 68;     // x trouser pattern, y veins, z sores/pustules, w eye style
export const T_WND1 = 69;     // wound A: xyz model-space centre, w = radius + 8 * type
export const T_WND2 = 70;     // wound B
export const T_OPT = 71;      // xyz = three 24-bit words of option bits (which accessory groups show), w = gloves (0/1) + 2 * barefoot
export const T_COL3 = 72;     // rgb gear colour (shoes, hats, bags), w = wear
export const T_COL4 = 73;     // rgb trim colour (shoes, belts), w = spare
export const T_COL5 = 74;     // rgb glove colour
export const T_VAR3 = 75;     // x hair strand cut (model y; strands below are cut away), y hair sparseness, z shoe kind (0 dress, 1 sneaker, 2 boot) + 10 if the cap is a visor, w lens darkness
export const T_FX3 = T_VAR1;  // (old name of the first spare texel)

/** Colour source of a vertex (the rig tints it with the instance's colour for the slot). */
export const SLOT = { FIXED: 0, SKIN: 1, CLOTH: 2, CLOTH2: 3, ACCENT: 4, HAIR: 5, GLOW: 6, GEAR: 7, TRIM: 8 };
/** Surface class of a vertex (roughness, normal map channel, special shading). */
export const MAT = {
  SKIN: 0, CLOTH: 1, TEAR: 2, LEATHER: 3, BONE: 4, HAIR: 5, FLESH: 6, EYE: 7, GLOW: 8, METAL: 9, RUBBER: 10, SKIN_TEAR: 11, GLASS: 12,
  // cinematic tier: wet sclera / cornea, glossy tooth enamel, hair cards (alpha-cut strands)
  SCLERA: 13, TEETH: 14, CARD: 15,
};
/** What a vertex is, for per-instance garment logic (vertex attribute aExt.y). */
export const PART = {
  NONE: 0, TOP: 1, SLEEVE: 2, LEG: 3, PELVIS: 4, HAND: 5, SHOE: 6, EYE: 7, HAT: 8, HAIR: 9, SOLE: 10, SHAFT: 11, CROWN: 12, LENS: 13, CARD: 14,
  // zombie skin regions (the corpse shading and the anatomy relief of actor-zmat.js), the
  // torn strips that hang below a garment's per-instance hem, and the trouser shell of the
  // near models (over a modelled leg: cut away below the hem instead of turning into skin)
  TORSO: 15, LIMB: 16, HEAD: 17, TATTER: 18, LTATTER: 19, FOOT: 20, TROUSER: 21,
};

export const WOUND = { GASH: 0, BONE: 1, BITE: 2, BULLET: 3, BURN: 4, ACID: 5 };

/**
 * Accessory groups that a model may contain and an instance may switch on. A vertex of a
 * group carries (bit + 1) in aExt.x; the vertex shader collapses it unless the instance's
 * option words (T_OPT) have the bit set. Order is the wire between the look generator and
 * the model builders: append only.
 */
export const OPTS = [
  // headwear ('hat_cap' is also the visor: the crown is cut away per instance)
  'hat_cap', 'hat_hard', 'hat_peak', 'hat_helmet', 'hat_fire', 'hat_beanie', 'hat_straw', 'hat_hood',
  // hair (the strands' length and sparseness are per instance: long, shoulder, bob, shaggy, wispy)
  'hair_scalp', 'hair_strands', 'hair_pony', 'hair_bun', 'hair_mohawk', 'hair_afro',
  // face
  'face_glasses', 'face_mask', 'face_gasmask', 'face_beard', 'face_eyepatch',
  // neck and chest
  'tie', 'lanyard', 'stetho', 'scarf', 'camera', 'dogtags', 'badge',
  // torso
  'vest_plate', 'suspenders', 'apron', 'belt_duty', 'belt_tool', 'fanny',
  // back
  'pack_small', 'pack_big', 'bag_msg', 'tank_o2', 'bag_medic',
  // hands and legs
  'cuffs', 'watch', 'pompom', 'bandage_hand', 'kneepads', 'holster', 'skirt',
  // feet (dress shoe, sneaker or boot: the shaft and the sole colour are per instance)
  'shoe',
  // gore
  'ribs', 'entrails', 'spine', 'stump_l', 'stump_r', 'stump_hand_l', 'stump_hand_r', 'bone_arm', 'rebar', 'arrow',
  // brute armour
  'plate_chest', 'plate_shoulder', 'plate_arm', 'shield', 'spikes', 'chains',
  // the nose (zombies: the skull carries only the rotted cavity; most still have their nose)
  'nose',
];
const OPT_INDEX = new Map(OPTS.map((n, i) => [n, i]));
/** Bit index of an option name (-1 when unknown). */
export function optBit(name) {
  const i = OPT_INDEX.get(name);
  return i === undefined ? -1 : i;
}
