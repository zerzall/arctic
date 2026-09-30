// The story levels (JOURNEY.md): long routes of sections joined by gates, one per mission of the
// Road to Haven campaign. Like the hideouts they are not in MAP_LIST (the lobby never offers them);
// buildMap(id) finds them through LEVEL_BUILDERS / LEVEL_DEFS, merged into maps.js.

import * as millroad from './millroad.js';
import * as hollowcreek from './hollowcreek.js';
import * as forest from './forest.js';
import * as hospital from './hospital.js';
import * as mall from './mall.js';
import * as metro from './metro.js';
import * as dam from './dam.js';
import * as railyard from './railyard.js';
import * as airbase from './airbase.js';

const MODULES = { millroad, hollowcreek, forest, hospital, mall, metro, dam, railyard, airbase };

/** Every level, in campaign order: { id, name, kind:'level', chapter, description, sections }. */
export const LEVEL_LIST = Object.freeze(Object.values(MODULES).map((m) => Object.freeze({
  id: m.SPEC.id, name: m.SPEC.name, kind: 'level', modes: ['mission'], chapter: m.SPEC.chapter,
  description: m.SPEC.description, sections: m.SPEC.sections.map((s) => s.id),
})).sort((a, b) => a.chapter - b.chapter));

export const LEVEL_IDS = Object.freeze(LEVEL_LIST.map((l) => l.id));

/** Size and mood of every level (maps.js merges this into MAP_DEFS). */
export const LEVEL_DEFS = Object.freeze(Object.fromEntries(Object.values(MODULES).map((m) => [m.SPEC.id, m.DEF])));

/** Builders by id (maps.js merges this into BUILDERS). */
export const LEVEL_BUILDERS = Object.freeze(Object.fromEntries(Object.values(MODULES).map((m) => [m.SPEC.id, m.build])));

/** The contracts (section ids, anchors, gates) by id. */
export const LEVEL_SPECS = Object.freeze(Object.fromEntries(Object.values(MODULES).map((m) => [m.SPEC.id, m.SPEC])));

/** Is `id` a story level? */
export function isLevelId(id) {
  return typeof id === 'string' && LEVEL_IDS.includes(id);
}
