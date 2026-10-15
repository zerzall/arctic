// Graphics quality tiers, lowest to highest. 'cinematic' sits above 'ultra' and is meant for
// strong desktop GPUs (RTX 30/40-class and up) at 1080p / 1440p / 4K: everything 'ultra' does,
// plus heavier variants (bigger shadow maps, more lights and particles, MSAA, denser world,
// higher-detail models). Code that keeps a per-tier table must have a 'cinematic' entry, or
// fall back to 'ultra' through baseTier(). tests/render3d-tiers.test.js keeps every table in
// render3d honest.

export const TIERS = Object.freeze(['low', 'high', 'ultra', 'cinematic']);

/** 0 (low) .. 3 (cinematic); unknown values rank as 'high'. */
export function tierRank(q) {
  const i = TIERS.indexOf(q);
  return i < 0 ? 1 : i;
}

/** Is tier `q` at least `min`? tierAtLeast(q, 'ultra') is true for ultra and cinematic. */
export function tierAtLeast(q, min) {
  return tierRank(q) >= tierRank(min);
}

/** A valid tier name: 'low' | 'high' | 'ultra' | 'cinematic' (anything unknown is 'high'). */
export function normTier(q) {
  return TIERS.includes(q) ? q : 'high';
}

/**
 * The tier to use for a table that predates 'cinematic': cinematic reads as ultra, an
 * unknown value as 'high'. Result is always 'low' | 'high' | 'ultra'.
 */
export function baseTier(q) {
  return q === 'cinematic' ? 'ultra' : q === 'low' || q === 'ultra' ? q : 'high';
}

/** A per-tier table's row for `q` (a missing 'cinematic' row falls back to 'ultra'). */
export function tierRow(table, q) {
  const t = normTier(q);
  return table[t] !== undefined ? table[t] : table[baseTier(t)];
}

/**
 * Texture-atlas resolution multiplier that asset generators may apply (canvas-painted atlases
 * and detail textures): 1 on low / high / ultra, 2 on cinematic.
 * @param {string} q tier
 * @returns {1|2}
 */
export function texScale(q) {
  return q === 'cinematic' ? 2 : 1;
}

/**
 * Anisotropic filtering level for a tier, clamped to what the GPU supports (0/undefined max
 * → 1): 2 low, 8 high, 16 ultra and cinematic.
 */
export function anisoFor(q, maxAniso = 16) {
  const want = q === 'cinematic' || q === 'ultra' ? 16 : q === 'low' ? 2 : 8;
  return Math.max(1, Math.min(want, Number(maxAniso) || 1));
}
