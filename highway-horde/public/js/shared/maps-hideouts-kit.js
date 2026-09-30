// The kit the hideouts' layouts are written in (maps-hideouts-*.js): the builder wrapper that
// adds the hub data (stations with their interactables, NPC spots, upgrade slots, props,
// hand placed dressing), the tier record helper and the standard upgrade-slot maker.

import { TAU } from './math.js';

export { TAU };
export const PI = Math.PI;
export const HALF = Math.PI / 2;
export const r1 = (v) => Math.round(v * 10) / 10;
export const r3 = (v) => Math.round(v * 1000) / 1000;

/** Hideout upgrades (STORY.md §4): each has tiers 1..3, all visible in the hub. */
export const UPGRADE_KINDS = Object.freeze(['generator', 'watchtower', 'infirmary', 'armory', 'radiomast', 'garden', 'palisade']);
export const UPGRADE_MAX_TIER = 3;

/** Colours the 2D views (top-down overlay, minimap) give the stations and the upgrade slots. */
export const STATION_COLORS = Object.freeze({
  board: '#ffc94d', workbench: '#ff9a3c', armory: '#ee6a55', infirmary: '#ff7b96',
  upgrades: '#7fd6ff', bed: '#b8a4e8', range: '#ece5d2', campfire: '#ff8a3d',
});
export const UPGRADE_COLORS = Object.freeze({
  generator: '#ffd45a', watchtower: '#c9b28a', infirmary: '#ff7b96', armory: '#ee6a55', radiomast: '#9be0ff', garden: '#7fd36a', palisade: '#c4a06a',
});

/**
 * Prop kinds the 3D renderer models (render3d/world-hideout*.js). `hub.props[].t`, the
 * upgrade tiers' props and the obstacles' `prop` field draw from this list; tests check
 * that the renderer registry has a model for each.
 */
export const HUB_PROP_KINDS = Object.freeze([
  // obstacle overrides (an obstacle's `prop`; 'nodraw' = a collider drawn by another prop)
  'perimeter', 'logseat', 'campring', 'maptable', 'workbench', 'signboard', 'rangebench', 'rhdiner', 'rhoffice', 'couch', 'nodraw',
  'boxcar', 'locomotive', 'messtent', 'departures', 'coop', 'haybale', 'windmill', 'orchardtree',
  // free props
  'stringlights', 'lantern', 'signpole', 'paintedsign', 'picnic', 'guitar', 'cat', 'photowall', 'pinboard', 'bedlamp', 'lookoutnest',
  'roofantenna', 'bunting', 'leanto', 'floodlight', 'gate', 'rails', 'watertower', 'forge', 'tirestack', 'sleeperpile', 'pergola2', 'dock',
  'porchswing', 'scarecrow', 'orchardcrates',
  // upgrade models (parametrised by tier)
  'up_generator', 'up_watchtower', 'up_infirmary', 'up_armory', 'up_radiomast', 'up_garden', 'up_palisade',
]);


export function kit(B, id, name, opts) {
  const map = B.map;
  map.kind = 'hideout';
  map.interactables = [];
  const hub = {
    id, name, chapters: opts.chapters.slice(), defaultTime: opts.defaultTime || 'night',
    spawn: null, bounds: opts.bounds, stations: [], npcs: [], upgradeSlots: {}, range: null,
    props: [], dress: [], look: opts.look || {}, upgrades: Object.fromEntries(UPGRADE_KINDS.map((k) => [k, 0])),
  };
  map.hub = hub;
  const K = {
    hub,
    /** A free prop (no collision). */
    prop(t, x, y, a = 0, o = {}) {
      hub.props.push({ t, x: r1(x), y: r1(y), a: r3(a), ...o });
    },
    /** An obstacle whose model the hub renderer supplies (`prop`). Returns the obstacle. */
    ob(kind, prop, x, y, w, h, a = 0, o = {}) {
      const { arch, lit, top, sign, ...rest } = o;
      const ob = B.ob(kind, x, y, w, h, a, { ...rest, top });
      if (prop) ob.prop = prop;
      if (arch) ob.arch = arch;
      if (lit !== undefined) ob.lit = lit;
      if (sign) ob.sign = sign;
      return ob;
    },
    /** A permanent fire with its own (bigger) light. */
    fire(x, y, r, lightR, color, k) {
      B.fire(x, y, r);
      const l = B.map.lights[B.map.lights.length - 1];
      if (lightR) l.r = lightR;
      if (color) l.color = color;
      if (k !== undefined) l.k = k;
    },
    /** A steady lamp at height h; `k` scales its intensity (1 = a street lamp). */
    lamp(x, y, h, r, color, flicker = 0, k = 1) {
      B.light(x, y, r, color, flicker, h);
      if (k !== 1) B.map.lights[B.map.lights.length - 1].k = k;
    },
    station(id, kind, x, y, r, label, o = {}) {
      const st = { id, kind, x: r1(x), y: r1(y), r, label, h: o.h ?? 90 };
      hub.stations.push(st);
      map.interactables.push({ id, kind, x: st.x, y: st.y, r, label, hold: 0 });
      return st;
    },
    npc(id, name, role, x, y, angle, pose, o = {}) {
      hub.npcs.push({ id, name, role, x: r1(x), y: r1(y), angle: r3(angle), pose, ...o });
    },
    /**
     * An upgrade slot. `tiers` = [site, tier1, tier2, tier3], each { props, lights, fires,
     * obstacles }; the slot's own obstacle (footprint) is created by the caller.
     */
    slot(kind, x, y, a, r, label, tiers) {
      hub.upgradeSlots[kind] = { kind, x: r1(x), y: r1(y), a: r3(a), r, label, maxTier: UPGRADE_MAX_TIER, tiers };
    },
    /** Hand placed set dressing (shared/dress.js kinds): [kind, x, y, angle, scale]. */
    dress(list) {
      for (const d of list) hub.dress.push(d);
    },
    spawns(cx, cy, rad, n, start = 0) {
      hub.spawn = { x: cx, y: cy, r: rad };
      for (let i = 0; i < n; i++) {
        const a = start + (i / n) * TAU;
        B.pspawn(r1(cx + Math.cos(a) * rad), r1(cy + Math.sin(a) * rad));
      }
    },
  };
  return K;
}

/** A tier record, tidy to write. */
export const tier = (o = {}) => ({ props: o.props || [], lights: o.lights || [], fires: o.fires || [], obstacles: o.obstacles || [] });


/** The four tiers of an upgrade slot with a standard model: `props[n]` are extra props of tier n, `lights[n]` / `fires[n]` its lights. */
export function stdSlot(K, kind, x, y, a, r, label, o = {}) {
  const tiers = [0, 1, 2, 3].map((n) => tier({
    props: [{ t: 'up_' + kind, tier: n, x, y, a, ...(o.model || {}), ...(o.modelTier && o.modelTier[n] ? o.modelTier[n] : null) }, ...((o.props && o.props[n]) || [])],
    lights: (o.lights && o.lights[n]) || [],
    fires: (o.fires && o.fires[n]) || [],
  }));
  K.slot(kind, x, y, a, r, label, tiers);
}
