// Graphics quality tiers, lowest to highest. 'cinematic' sits above 'ultra' and is meant for
// strong desktop GPUs (RTX 30/40-class and up) at 1080p / 1440p / 4K: everything 'ultra' does,
// plus heavier variants (bigger shadow maps, more lights and particles, MSAA, denser world,
// higher-detail models). Code that keeps a per-tier table must have a 'cinematic' entry, or
// fall back to 'ultra' through baseTier().

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

/** The tier to use for a table that predates 'cinematic': cinematic reads as ultra. */
export function baseTier(q) {
  return q === 'cinematic' ? 'ultra' : q;
}
