// The hideouts' part of the static world (WORLD, SPEC §3.10): world.js hands every obstacle,
// the objective and the hideout's free props to this module, which draws the hero models
// (world-hideout-props.js, -roadhouse.js, -depot.js, -farmstead.js) through the world's own
// geo builder, and owns the UPGRADE LAYER — the parts of the hideout the crew builds up,
// which are separate merged meshes so a purchase rebuilds only them (`setUpgrades`).
//
// Seams with world.js (all additive, every one a no-op on a normal map):
//   hub.buckets              extra geo-builder buckets: 'hub' (lit atlas pictures), 'hubneon'
//                            (unlit HDR words) and 'hubflick' (a neon that stutters)
//   hub.material(bucket, t)  their materials
//   hub.obstacle(B, o)       true when it drew the obstacle (o.prop), false = draw the default
//   hub.objective(B, ob)     the same for the objective
//   hub.props(B)             the free props (map.hub.props)
//   hub.finish()             build the upgrade layer once the static meshes exist
//   hub.update(view, frame)  per frame: neon flicker, upgrade lights, dynamic emitters
//   hub.setUpgrades(tiers)   live upgrade purchase
//
// The dynamic sub-system (hideout3d.js) reads `ctx.hideout` (this object) for the emitters
// the models registered: smoke, sparks, chimneys, lights, chickens.

import * as THREE from 'three';
import { hubUV, makeHubTexture } from './world-hideout-atlas.js';
import { COMMON_MODELS } from './world-hideout-props.js';
import { ROADHOUSE_MODELS } from './world-hideout-roadhouse.js';
import { DEPOT_MODELS } from './world-hideout-depot.js';
import { FARM_MODELS } from './world-hideout-farmstead.js';
import { UP_MODELS } from './world-hideout-up.js';
import { hideoutUpgradeSet, normalizeUpgrades, UPGRADE_KINDS } from '../shared/maps-hideouts.js';
import { makeFlames, makeEmbers, makeSmoke, makeHalos, makePools } from './world-fx.js';
import { tierAtLeast, baseTier } from './tier.js';

const MODELS = { ...COMMON_MODELS, ...ROADHOUSE_MODELS, ...DEPOT_MODELS, ...FARM_MODELS, ...UP_MODELS };
/** Obstacles/objectives whose model adds to the default one instead of replacing it. */
const EXTRAS = new Set(['rhoffice', 'rhdiner', 'orchardtree']);

/** The geo-builder buckets this module adds (world.js merges them into its own). */
export const HUB_BUCKETS = {
  hub: { uv: true },
  hubneon: { uv: true, ao: false },
  hubflick: { uv: true, ao: false },
};

/**
 * @param {object} ctx renderer ctx
 * @param {object} deps { root, mats, fx, halos, day, aniso, gy, tier, newBuilder(), matOf(bucket, tier) }
 */
export function createHideout(ctx, deps) {
  const { map } = ctx;
  const hub = map.hub;
  const day = deps.day;
  let tier = deps.tier;
  const tex = makeHubTexture(deps.aniso || 8);
  const neonK = day ? 0.34 : 1;
  const own = {
    hi: {
      hub: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, roughness: 0.75, metalness: 0, envMapIntensity: 0.55 }),
      hubneon: neonMaterial(tex, neonK),
      hubflick: neonMaterial(tex, neonK),
    },
    low: {
      hub: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, alphaTest: 0.5 }),
      hubneon: neonMaterial(tex, neonK),
      hubflick: neonMaterial(tex, neonK),
    },
  };
  // (the two neon sets share materials: a tier switch must not restart the flicker)
  own.low.hubneon = own.hi.hubneon;
  own.low.hubflick = own.hi.hubflick;

  const dyn = {
    smoke: [], sparks: [], chimneys: [], chickens: [], searchlights: [], spinners: [],
  };
  const warned = new Set();
  let seedN = 0;

  function ctxFor(B, it, o, L, W) {
    return { B, it, o: o || null, L: L || 0, W: W || 0, halos: deps.halos, dyn, day, tier: ctx.quality, hub, map, ctx, gy: deps.gy };
  }
  function run(B, t, it, o, L, W) {
    const fn = MODELS[t];
    if (!fn) {
      if (!warned.has(t)) { warned.add(t); console.warn('hideout: no model for', t); }
      return false;
    }
    try {
      fn(ctxFor(B, it, o, L, W));
      return true;
    } catch (err) {
      if (!warned.has('!' + t)) { warned.add('!' + t); console.warn('hideout: model failed', t, err); }
      return false;
    }
  }

  // ---- the static parts --------------------------------------------------------------------------
  function obstacle(B, o) {
    const t = o.prop;
    if (!t) return false;
    if (t.startsWith('slot:')) return true;      // drawn by the upgrade layer
    const ok = run(B, t, o, o, o.w, o.h);
    return ok && !EXTRAS.has(t);
  }

  function objective(B, ob) {
    if (!ob.prop) return false;
    const ok = run(B, ob.prop, ob, ob, ob.w, ob.h);
    return ok && !EXTRAS.has(ob.prop);
  }

  /** The objective's extras run in the objective's own frame after the default model. */
  function objectiveExtras(B, ob) {
    if (ob.prop && EXTRAS.has(ob.prop)) run(B, ob.prop, ob, ob, ob.w, ob.h);
  }

  function props(B) {
    for (const p of hub.props) {
      const line = p.t === 'stringlights' || p.t === 'bunting';
      if (line) B.obj(0, 0, 0, 900 + (seedN++));
      else B.obj(p.x, p.y, p.a || 0, 900 + (seedN++) * 7 + Math.round(p.x + p.y));
      B.setJitter(0.03);
      run(B, p.t, p, null, p.w || 0, p.d || 0);
    }
  }

  // ---- the upgrade layer -----------------------------------------------------------------------------
  let tiers = normalizeUpgrades(hub.upgrades);
  let upMeshes = [];
  let upFxMeshes = [];
  let upLights = [];
  let upFires = [];
  let upPools = null;
  const upDisposables = [];

  function clearUpgrades() {
    for (const m of upMeshes) { deps.root.remove(m); m.geometry.dispose(); }
    for (const m of upFxMeshes) { deps.root.remove(m); m.geometry.dispose(); m.material.dispose(); }
    upMeshes = []; upFxMeshes = []; upLights = []; upFires = []; upPools = null;
    for (const key of ['searchlights', 'spinners', 'smoke', 'sparks', 'chickens']) dyn[key] = dyn[key].filter((e) => !e.up);
  }

  function buildUpgrades() {
    clearUpgrades();
    const set = hideoutUpgradeSet(map, tiers);
    const B = deps.newBuilder();
    B.setJitter(0.03);
    const upHalos = [];
    const local = { ...dyn };
    void local;
    let n = 0;
    for (const p of set.props) {
      const line = p.t === 'stringlights' || p.t === 'bunting';
      if (line) B.obj(0, 0, 0, 5000 + n++);
      else B.obj(p.x, p.y, p.a || 0, 5000 + n++ * 3);
      B.setJitter(0.03);
      const fn = MODELS[p.t];
      if (!fn) continue;
      try {
        fn({ B, it: p, o: null, L: p.w || 0, W: p.h || 0, halos: upHalos, dyn, day, tier: ctx.quality, hub, map, ctx, gy: deps.gy, up: p.up });
      } catch (err) {
        if (!warned.has('!' + p.t)) { warned.add('!' + p.t); console.warn('hideout: upgrade model failed', p.t, err); }
      }
    }
    for (const o of set.obstacles) {
      B.obj(o.x, o.y, o.a || 0, 6000 + n++);
      const fn = o.prop && MODELS[o.prop];
      if (fn) fn({ B, it: o, o, L: o.w, W: o.h, halos: upHalos, dyn, day, tier: ctx.quality, hub, map, ctx, gy: deps.gy, up: o.up });
    }
    for (const { bucket, geometry } of B.finish()) {
      const mesh = new THREE.Mesh(geometry, deps.matOf(bucket, tier));
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = !['glow', 'neon', 'blink', 'flicker', 'hubneon', 'hubflick'].includes(bucket);
      mesh.name = 'hub-up-' + bucket;
      mesh.userData.bucket = bucket;
      mesh.userData.hubUp = true;
      deps.root.add(mesh);
      upMeshes.push(mesh);
    }
    upLights = set.lights;
    upFires = set.fires.map((f) => ({ x: f.x, y: f.y, r: f.r, base: deps.gy(f.x, f.y) + (f.r <= 16 ? 30 : 0) }));
    const add = (m) => { if (m) { deps.root.add(m); upFxMeshes.push(m); } return m; };
    if (upFires.length) {
      add(makeFlames(upFires, deps.fx));
      add(makeEmbers(upFires, deps.fx));
      add(makeSmoke(upFires, deps.fx));
    }
    const hl = day ? upHalos.filter((h) => h.flicker > 0 || h.blink > 0).map((h) => ({ ...h, strength: (h.strength ?? 1) * 0.25 })) : upHalos;
    if (hl.length) add(makeHalos(hl, deps.fx));
    if (!day && set.lights.length) {
      const pl = set.lights.map((l) => ({ x: l.x, y: l.y, r: l.r * 0.8, color: l.color, flicker: l.flicker >= 0.5 ? l.flicker : 0, strength: 0.22, base: deps.gy(l.x, l.y) }));
      upPools = makePools(pl, deps.fx);
      add(upPools.mesh);
      upPools.setLevels(new Float32Array(pl.length).fill(1));
    }
  }

  // ---- per frame --------------------------------------------------------------------------------------
  let time = 0;
  function update(view, frame) {
    const dt = Math.min(0.1, frame.dt || 0.016);
    time += dt;
    // the neon words: mostly steady, the "NO" of VACANCY stutters on its own schedule
    const st = Math.sin(time * 1.3) + Math.sin(time * 3.7 + 1) * 0.6;
    const k = (day ? 0.34 : 1) * (st > 1.35 ? (Math.sin(time * 60) > 0 ? 0.35 : 1) : 1);
    own.hi.hubneon.color.setScalar(k);
    const flick = Math.sin(time * 0.9) + Math.sin(time * 2.3 + 2) * 0.7;
    const nk = (day ? 0.34 : 1) * (flick > 0.6 ? (Math.sin(time * 41) > -0.2 ? 1 : 0.05) : flick > -0.9 ? 1 : 0.12);
    own.hi.hubflick.color.setScalar(nk);
    // upgrade lights within reach of the camera join the light pool (it picks the best few)
    const L = ctx.lights;
    if (L && upLights.length) {
      for (let i = 0; i < upLights.length; i++) {
        const l = upLights[i];
        if (Math.abs(l.x - frame.camX) > 1500 || Math.abs(l.y - frame.camY) > 1500) continue;
        L.steady('hub:up' + i, l.x, l.y, l.h ?? 90, l.color, l.intensity ?? 1.15, l.r);
      }
    }
  }

  buildUpgradesLater();
  function buildUpgradesLater() { /* built by finish(), after the static meshes exist */ }

  return {
    hub,
    dyn,
    buckets: HUB_BUCKETS,
    /** The upgrade tiers being shown (normalised). */
    get upgrades() { return tiers; },
    get upgradeLights() { return upLights; },
    material(bucket, t) {
      if (!own.hi[bucket]) return null;
      return (t === 'low' ? own.low : own.hi)[bucket];
    },
    obstacle, objective, objectiveExtras, props,
    /** The view without the range's dummy zombies (hideout3d draws those). */
    stripDummies(view) {
      const rt = hub.range && hub.range.targets;
      if (!rt || !rt.length || !view || !view.zombies || !view.zombies.length) return view;
      const isDummy = (z) => { for (let i = 0; i < rt.length; i++) if (Math.abs(z.x - rt[i].x) < 1.5 && Math.abs(z.y - rt[i].y) < 1.5) return true; return false; };
      let any = false;
      for (let i = 0; i < view.zombies.length; i++) if (isDummy(view.zombies[i])) { any = true; break; }
      return any ? { ...view, zombies: view.zombies.filter((z) => !isDummy(z)) } : view;
    },
    finish() { buildUpgrades(); },
    update,
    setUpgrades(raw) {
      const nt = normalizeUpgrades(raw);
      if (UPGRADE_KINDS.every((k) => nt[k] === tiers[k])) return false;
      tiers = nt;
      hub.upgrades = nt;
      buildUpgrades();
      return true;
    },
    setQuality(q) {
      tier = baseTier(q);
      for (const m of upMeshes) m.material = deps.matOf(m.userData.bucket, tier);
    },
    dispose() {
      clearUpgrades();
      for (const set of [own.hi, own.low]) for (const m of Object.values(set)) m.dispose();
      tex.dispose();
      for (const d of upDisposables) d.dispose && d.dispose();
    },
  };
}

function neonMaterial(tex, k) {
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, alphaTest: 0.02, side: THREE.FrontSide,
  });
  m.color.setScalar(k);
  return m;
}

export { hubUV, tierAtLeast };
