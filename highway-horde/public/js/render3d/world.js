// The static world of the first-person view (WORLD, SPEC §7.5): ground (ground.js), every
// obstacle kind as a detailed model at the canonical heights (vehicles world-veh.js,
// buildings world-bld.js, props world-props.js, vegetation world-veg.js), the objective,
// the supply station, 3D decor, permanent fires, water, the tree line past the bounds,
// the instanced grass field and the night sky, lit through a baked reflection probe.
//
// Everything static is written through the world-geo.js accumulator into a few material
// buckets (world-mat.js: PBR 'std' with per-vertex detail layers, clear-coated 'paint',
// 'glass', lit 'decal', unlit 'glow'/'neon'/'blink'/'flicker', blended chain-link 'fence',
// alpha-tested 'leaves') split into large spatial cells, so the map is a few dozen draw
// calls however many surfaces it shows. Animated bits (flames, smoke, halos, water
// ripples, neon, beacons, flags, grass, rain) animate on the GPU or from update().

import * as THREE from 'three';
import { createGeoBuilder, T, shadeHex } from './world-geo.js';
import { createGround, WATER } from './ground.js';
import { atlasUV, makeAtlasTexture, makeChainLinkTexture, makeWaterNormal, makeLeafTexture } from './world-tex.js';
import { makeDetailArray, DET } from './world-surf.js';
import { createWorldMaterials } from './world-mat.js';
import { buildVehicle, buildSemiCab, buildTrailer, buildTanker, buildBus, buildApc } from './world-veh.js';
import { building, buildingHeight, diner, radio, beam } from './world-bld.js';
import { setDetailLevel } from './world-arch.js';
import {
  jersey, sandbags, guardrail, fence, wall, hesco, container, pump, pillar, buildCanopies, tent, booth, rock,
  lampPost, cone, tires, rubble, debris, roadSign, grassTuft, trafficSignal, pricePylon,
} from './world-props.js';
import { buildOverpass, deckHeightAt, deckRoofs } from './world-overpass.js';
import { trunk, canopy, bush, buildTreeLine, createGrassField, scatterFlora, setBiome } from './world-veg.js';
import { silo, headstone, RURAL_HEIGHT } from './world-rural.js';
import { createDress } from './world-dress.js';
import { normTier, tierAtLeast, anisoFor } from './tier.js';
import { terrainHeight } from '../shared/terrain.js';
import {
  palisade, watchtower, skyscraper, iwall, desk, cabinet, counter, ipillar, stairs, hvac, parapet, mast,
  buildRidgeWorld, makeSkyline, ridgeHeight,
} from './world-ridge.js';
import {
  createFxUniforms, makeSky, makeFlames, makeEmbers, makeSmoke, makeHalos, makeShafts, makePools, makeMarker, makeRain,
} from './world-fx.js';

const WOOD = '#6b4a2c';
const VEHICLE = new Set(['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker']);
// buckets that are pure light (no shadows received, no fake AO)
const UNLIT = new Set(['glow', 'neon', 'blink', 'flicker']);

/**
 * Canonical height (world units) of an obstacle kind (SPEC §7.5), refined by the obstacle
 * itself where the kind covers several shapes (semi cab/trailer, fence/wall, containers,
 * buildings, rocks). Also answers for objective kinds ('bus'|'diner'|'apc'|'radio' via
 * `objectiveHeight`).
 * @param {string} kind
 * @param {object} [o] obstacle
 * @returns {number}
 */
export function obstacleHeight(kind, o) {
  switch (kind) {
    case 'car': return 44;
    case 'suv': return 56;
    case 'pickup': return 58;
    case 'van': return 72;
    case 'truck': return 100;
    case 'bus': return 100;
    case 'tanker': return 112;
    case 'semi': return o && o.w <= 100 ? 110 : 124;
    case 'barrier': return 26;
    case 'sandbags': return 30;
    case 'guardrail': return 22;
    case 'pump': return 52;
    case 'hesco': return 70;
    case 'tent': return 80;
    case 'booth': return 90;
    // dumpsters / generators / the propane cage are the small 'container's
    case 'container': return o && Math.max(o.w, o.h) <= 72 ? 62 : 84;
    case 'wall': return o && o.h <= 8 ? 40 : 90;
    case 'rock': return o ? Math.max(16, Math.min(30, 10 + Math.min(o.w, o.h) * 0.4)) : 22;
    case 'tree': return 70;
    case 'pillar': return 150;
    // overpass columns reach the pier cap; ramp pieces are as tall as their high end
    case 'pier': return o && Number.isFinite(o.top) ? o.top : 138;
    case 'ramp': return o && Number.isFinite(o.top) ? o.top : 100;
    case 'building': return o ? buildingHeight(o) : 180;
    case 'silo': return RURAL_HEIGHT.silo;
    case 'grave': return RURAL_HEIGHT.grave;
    case 'palisade': case 'watchtower': case 'tower': case 'iwall': case 'desk': case 'cabinet': case 'counter':
    case 'ipillar': case 'stairs': case 'hvac': case 'parapet': case 'rim': case 'mast':
      return ridgeHeight(kind, o);
    default: return 40;
  }
}

/** Height of the objective model. */
export function objectiveHeight(obj) {
  switch (obj && obj.kind) {
    case 'bus': return 100;
    case 'diner': return 118;
    case 'apc': return 82;
    case 'radio': return 540;
    default: return 100;
  }
}

function pointInOb(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= o.w / 2 + pad && Math.abs(ly) <= o.h / 2 + pad;
}

/**
 * Height a permanent fire burns at: on top of the wreck it sits on, in a drum when it is a
 * small fire on open ground, else on the ground.
 */
export function fireBaseHeight(map, x, y) {
  // campaign maps: everything stands on the terrain
  const th = terrainHeight(map, x, y);
  if (th > 0) return th + fireBaseHeight0(map, x, y);
  return fireBaseHeight0(map, x, y);
}

function fireBaseHeight0(map, x, y) {
  // up on an overpass: on the wreck burning there, else on the deck
  const deck = deckHeightAt(map, x, y);
  if (deck > 0) {
    for (const v of map.overpass.vehicles) {
      if (pointInOb(v, x, y, 2)) return Math.round(deck + obstacleHeight(v.kind, v) * (v.kind === 'car' ? 0.62 : 0.55));
    }
    return Math.round(deck);
  }
  for (const o of map.obstacles) {
    if (VEHICLE.has(o.kind) && pointInOb(o, x, y, 2)) return Math.round(obstacleHeight(o.kind, o) * (o.kind === 'car' ? 0.62 : 0.55));
  }
  const f = map.fires.find((ff) => Math.abs(ff.x - x) < 3 && Math.abs(ff.y - y) < 3);
  if (f && f.r <= 16) return 30;
  return 0;
}

// ---------------------------------------------------------------------------------------------

/**
 * Build the static world.
 * @param {object} ctx renderer ctx (THREE, scene, camera, map, quality)
 * @param {object} deps { renderer, lights (lights.js instance), pixelHeight() → drawing-buffer height of the world pass }
 * @returns {{ ground, update(view, frame), setQuality(q), dispose(), stats }}
 */
export function createWorld(ctx, deps) {
  const { scene, map } = ctx;
  let tier = normTier(ctx.quality);
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };
  const maxAniso = deps.renderer ? deps.renderer.capabilities.getMaxAnisotropy() : 1;
  const aniso = anisoFor(tier, maxAniso);

  const tA = performance.now();
  // the detail layers only feed the PBR tiers: 'low' (Lambert) skips the ~0.4 s generation
  // and gets them the first time the player picks a higher tier
  let detailTex = tier === 'low' ? null : track(makeDetailArray(aniso));
  const tDetail = performance.now() - tA;
  const ground = createGround({ scene, map, quality: ctx.quality, renderer: deps.renderer, detail: detailTex });
  const tGround = performance.now() - tA - tDetail;
  const amb = deps.lights.ambient;
  const day = amb.time === 'day';
  const fx = createFxUniforms();
  fx.uFog.value = amb.fogDensity;
  fx.uFogColor.value.copy(amb.fog);

  // ---- materials ----
  const atlasTex = track(makeAtlasTexture());
  atlasTex.anisotropy = aniso;
  const chainTex = track(makeChainLinkTexture());
  const leafTex = track(makeLeafTexture(Math.min(4, maxAniso)));
  const mats = createWorldMaterials({ detail: detailTex, atlas: atlasTex, chain: chainTex, leaves: leafTex });
  if (day) {
    // by day the lit windows, street lamps, tubes and signs are just dim glass and paint
    // (the unlit emissive pieces are multiplied down; beacons and vehicle lamps stay a bit)
    mats.hi.glow.color.setRGB(0.11, 0.14, 0.19);
    mats.hi.flicker.color.setScalar(0.16);
    mats.hi.blink.color.setScalar(0.55);
    ground.uniforms.wetness.value = amb.wet;
    // rooms behind the windows: dim but readable in daylight (curtains, furniture), lit ones washed out
    mats.shared.uRoomAmb.value = 0.3;
    mats.uniforms.uRoomK.value = 0.32;
  } else {
    mats.shared.uRoomAmb.value = 0.03;
  }
  // a long map (the highway) cuts its heavy buckets finer: looking down the road, the
  // frustum and the fog then drop most of the pileup behind and beside the camera
  const fine = map.width > 6000 ? 1000 : undefined;
  const gy = ctx.groundY || (() => 0);
  const hasTerrain = !!ctx.terrain && !ctx.terrain.flat;
  const B = createGeoBuilder({
    cell: 1600,
    buckets: {
      std: { det: true, cell: fine }, paint: { det: true, cell: fine }, glass: { det: true }, decal: { uv: true },
      glow: { uv: true, ao: false }, neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false },
      fence: { uv: true }, leaves: { uv: true, ao: false }, sign: { uv: true },
      // interior-mapped rooms behind lit windows, and blended decals (graffiti, stains)
      room: { det: true, ao: false }, stain: { uv: true },
    },
  });

  if (hasTerrain) B.setGround(gy);
  // geometry detail of the buildings follows the tier the world is built for
  setDetailLevel(tier === 'low' ? 0 : tierAtLeast(tier, 'ultra') ? 2 : 1);
  // lists for the effect meshes
  const halos = [];
  const shafts = [];
  const flags = [];
  const lightByPos = (x, y) => map.lights.find((l) => Math.abs(l.x - x) < 4 && Math.abs(l.y - y) < 4) || null;

  // ---- obstacles ----
  setBiome(map);   // tree species by map (the trunks agree with their crowns)
  // one building per map carries a neon sign (the truck stop's, a motel's on the highway)
  const signCell = map.id === 'truckstop' ? 'truckSign' : map.id === 'highway' ? 'motel' : null;
  let signBuilding = null;
  const tObs = performance.now();
  if (signCell) for (const o of map.obstacles) if (o.kind === 'building' && Math.max(o.w, o.h) >= 170 && (!signBuilding || o.w * o.h > signBuilding.w * signBuilding.h)) signBuilding = o;
  for (const o of map.obstacles) {
    B.obj(o.x, o.y, o.a || 0, o.id * 31 + (map.seed | 0));
    B.setJitter(0.06);
    try {
      buildObstacle(B, o, o === signBuilding ? { cell: signCell } : null, !!map.overpass, halos);
    } catch (err) {
      console.warn('world: obstacle model failed', o.kind, err);
    }
  }
  const canopies = buildCanopies(B, map);
  // the overpass: decks, bents, ramps, deck lamps and signs, wrecks up top
  try {
    buildOverpass(B, map, { halos });
  } catch (err) {
    console.warn('world: overpass model failed', err);
  }
  const tObsMs = performance.now() - tObs;
  const tDec = performance.now();

  // ---- objective, supply ----
  const ob = map.objective;
  if (ob) {
    B.obj(ob.x, ob.y, ob.a || 0, 999);
    B.setJitter(0.03);
    buildObjective(B, ob, halos);
  }
  let supplyLight = null;
  if (map.supply) {
    B.obj(map.supply.x, map.supply.y, 0.35, 555);
    supplyLight = buildSupply(B, map.supply, flags, halos);
  }

  // ---- decor ----
  map.decor.forEach((d, i) => {
    B.obj(d.x, d.y, d.a || 0, i * 17 + 3);
    B.setJitter(0.1);
    try {
      buildDecor(B, d, i, lightByPos(d.x, d.y), halos, shafts, flags);
    } catch (err) {
      console.warn('world: decor model failed', d.kind, err);
    }
  });

  // ---- undergrowth: ferns and logs under trees, weeds along fences and walls, ivy, verges ----
  const tFlora = performance.now();
  try {
    scatterFlora(B, map, ground.waters);
  } catch (err) {
    console.warn('world: undergrowth failed', err);
  }
  const tFloraMs = performance.now() - tFlora;

  // ---- fires ----
  const fires = map.fires.map((f) => ({ x: f.x, y: f.y, r: f.r, base: fireBaseHeight(map, f.x, f.y) }));
  fires.forEach((f, i) => {
    if (f.base - gy(f.x, f.y) === 30) {
      // an oil drum with a fire in it
      B.obj(f.x, f.y, i, 70 + i);
      B.cyl('std', 0, 0, 0, 11, 30, '#4a3424', 16, 1, null, { surf: [DET.rust, 0.8, 0.6] });
      for (const y of [9, 20]) B.cyl('std', 0, y, 0, 11.4, 1.4, '#3a2a1c', 16, 1, null, { surf: [DET.rust, 0.8, 0.6] });
      B.cyl('std', 0, 29, 0, 11.4, 1.5, '#2b1f16', 16, 1, null, { surf: [DET.char, 0.9, 0.5] });
      B.cyl('glow', 0, 29.6, 0, 10, 0.6, '#ff7a22', 16, 1, null, { emissive: 3.2, uv: atlasUV('white') });
    }
    halos.push({ x: f.x, y: f.y, h: f.base + f.r * 0.9, color: '#ff7a2a', size: f.r * 5.5, flicker: 0.8, strength: 0.55, base: f.base });
  });

  // ---- set dressing (world-dress.js): props laid over the layout, rebuilt per quality tier ----
  const cullDistFog = Math.sqrt(-Math.log(0.002)) / Math.max(1e-5, amb.fogDensity);
  let dress = null;
  try {
    dress = createDress(ctx, { root, mats, fx, halos, tier, aniso, day, gy, hasTerrain, cullDist: cullDistFog });
  } catch (err) {
    console.warn('world: set dressing failed', err);
  }

  // ---- the campaign's floors, roof, zip line and landing (world-ridge.js) ----
  let ridge = null;
  if (map.campaign) {
    try {
      ridge = buildRidgeWorld(B, map, { halos, shafts });
    } catch (err) {
      console.warn('world: campaign dressing failed', err);
    }
  }
  // campaign maps: light sprites, shafts and flags built in object frames stand on the ground too
  if (hasTerrain) {
    for (const hl of halos) if (hl.base === undefined && !hl.abs) hl.h += gy(hl.x, hl.y);
    for (const sh of shafts) if (!sh.abs) { sh.h += gy(sh.x, sh.y); sh.base = gy(sh.x, sh.y); }
    for (const fl of flags) fl.h += gy(fl.x, fl.y);
    if (supplyLight) supplyLight.h += gy(supplyLight.x, supplyLight.y);
  }
  const tDecMs = performance.now() - tDec;
  // ---- tree line past the bounds ----
  const tTl = performance.now();
  buildTreeLine(B, map, ground.waters);
  const tTlMs = performance.now() - tTl;

  // ---- bridge fascias / piers over water edges ----
  for (const w of ground.waters) {
    for (const e of w.edges) {
      if (!e.bridge) continue;
      const S = { surf: [DET.concrete, 0.88, 0] };
      if (e.axis === 'y') {
        const len = w.x1 - w.x0, cx = (w.x0 + w.x1) / 2;
        B.obj(cx, e.pos + e.dir * 5, 0, 5);
        B.block('std', 0, -WATER.depth, 0, len + 160, WATER.depth + 3.5, 10, '#6f6c64', null, S);
        B.block('std', 0, -12, e.dir * 3, len + 160, 5, 14, '#5b5953', null, S);
        for (let x = -len / 2 + 60; x < len / 2; x += 170) B.block('std', x, -WATER.depth, e.dir * 16, 30, WATER.depth - 4, 22, '#5f5c55', null, S);
      } else {
        const len = w.y1 - w.y0, cy = (w.y0 + w.y1) / 2;
        B.obj(e.pos + e.dir * 5, cy, Math.PI / 2, 5);
        B.block('std', 0, -WATER.depth, 0, len + 160, WATER.depth + 3.5, 10, '#6f6c64', null, S);
      }
    }
  }

  // ---- build static meshes ----
  // ('sign': vehicle liveries and lettering, painted in the set dressing's atlas, dress-atlas.js)
  const matOf = (bucket, t) => (bucket === 'sign' ? (dress ? dress.signMaterial(t) : mats.get('decal', t)) : mats.get(bucket, t));
  const staticMeshes = [];
  const moonCasters = [];
  const built = B.finish();
  const tGeo = performance.now() - tA - tGround - tDetail;
  for (const { bucket, geometry } of built) {
    const mesh = new THREE.Mesh(geometry, matOf(bucket, tier));
    mesh.matrixAutoUpdate = false;
    // The only shadow-casting light is the flashlight, 7 units off the eye: the shadow of a
    // wall or a car falls almost exactly behind it as seen from the camera, so static casters
    // were invisible but cost a quarter of the frame's triangles (a second pass over the
    // world). Actors still cast (their slivers show on the ground and walls behind them).
    mesh.castShadow = false;
    mesh.receiveShadow = !UNLIT.has(bucket);
    mesh.name = 'world-' + bucket;
    mesh.userData.bucket = bucket;
    // moon shadows: the static world casts (lights.js draws only these into the moon's map)
    if (!UNLIT.has(bucket)) moonCasters.push(mesh);
    root.add(mesh);
    staticMeshes.push(mesh);
    disposables.push(geometry);
  }

  // ---- water ----
  const waterNormal = track(makeWaterNormal());
  waterNormal.repeat.set(1, 1);
  const waterMat = track(new THREE.MeshStandardMaterial({
    // near-black water: the lamps' glints (light pool specular) and a dim, rippled copy of
    // the probe; a strong probe reflection smeared the far bank's colours across the river
    color: day ? '#16404f' : '#03080a', roughness: 0.04, metalness: 0.1, normalMap: waterNormal, normalScale: new THREE.Vector2(day ? 0.3 : 0.22, day ? 0.3 : 0.22), envMapIntensity: day ? 1.0 : 0.45,
  }));
  const waterMeshes = [];
  for (const w of ground.waters) {
    const gw = w.x1 - w.x0, gh = w.y1 - w.y0;
    const geo = new THREE.PlaneGeometry(gw, gh, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * gw / 360, uv.getY(i) * gh / 360);
    geo.translate((w.x0 + w.x1) / 2, WATER.surface, (w.y0 + w.y1) / 2);
    const m = new THREE.Mesh(geo, waterMat);
    m.receiveShadow = true;
    m.name = 'water';
    root.add(m);
    waterMeshes.push(m);
    disposables.push(geo);
  }

  // ---- campaign meshes: painted signs, the helipad disc, the skyline ----
  if (ridge) {
    const t = map.campaign.tower;
    const [safe, zipSign, towerSign] = ridge.signs;
    towerSign.position.set(t.x + Math.cos(t.a) * (t.w / 2 + 1.4), 300 + gy(t.x, t.y), t.y + Math.sin(t.a) * (t.w / 2 + 1.4));
    towerSign.rotation.y = Math.PI / 2 - t.a;
    zipSign.rotation.y = Math.PI;
    for (const m of [...ridge.signs, ridge.helipad]) {
      if (!m) continue;
      root.add(m);
      disposables.push(m.geometry, m.material);
      if (m.material.map) disposables.push(m.material.map);
    }
    void safe;
    if (map.campaign.skyline && map.campaign.skyline.length) {
      const sky2 = makeSkyline(map.campaign.skyline);
      root.add(sky2);
      disposables.push(sky2.geometry, sky2.material, sky2.material.map);
    }
  }

  // ---- fx meshes ----
  const far = Math.hypot(map.width, map.height) + 1400;
  const tE = performance.now();
  const sky = makeSky(amb, Math.min(far * 0.9, 6000), fx, fires);
  root.add(sky);
  disposables.push(sky.geometry, sky.material);
  const fxMeshes = [];
  const addFx = (m) => { if (m) { root.add(m); fxMeshes.push(m); disposables.push(m.geometry, m.material); } return m; };
  if (fires.length) {
    addFx(makeFlames(fires, fx));
    addFx(makeEmbers(fires, fx));
    addFx(makeSmoke(fires, fx));
  }
  // (by day: no lamp halos or light shafts; fires and mast beacons keep a faint glow)
  const dayHalos = day ? halos.filter((h) => h.flicker > 0 || h.blink > 0).map((h) => ({ ...h, strength: (h.strength ?? 1) * 0.25 })) : halos;
  if (dayHalos.length) addFx(makeHalos(dayHalos, fx));
  if (shafts.length && !day) addFx(makeShafts(shafts, fx));
  const poolList = map.lights.map((l, i) => {
    const src = deps.lights.mapSources[i];
    const fire = l.flicker >= 0.5;
    const lampish = src && src.h > 150;
    // a fire up on an overpass deck lights the deck, not the ground under it: no fake pool
    const aloft = !Number.isFinite(l.h) && deckHeightAt(map, l.x, l.y) > 0;
    return { x: l.x, y: l.y, r: l.r * (lampish ? 0.95 : 0.8), color: l.color, flicker: fire ? l.flicker : 0, strength: aloft ? 0 : fire ? 0.28 : lampish ? 0.34 : 0.2, base: gy(l.x, l.y) };
  });
  // the canopies' fluorescent strips light the forecourt under them
  for (const c of canopies) poolList.push({ x: c.x, y: c.y, r: Math.max(c.w, c.h) * 0.62, color: '#dfe8ff', flicker: 0, strength: 0.14, base: gy(c.x, c.y) });
  const pools = poolList.length && !day ? makePools(poolList, fx) : null;
  if (pools) addFx(pools.mesh);
  const poolLevels = new Float32Array(poolList.length).fill(1);
  // (the campaign defends a hill, not the map's old objective: no beacon over it)
  const marker = ob && !map.campaign ? addFx(makeMarker(ob, fx)) : null;

  // flags: one dynamic strip mesh
  const flagMesh = flags.length ? makeFlagMesh(flags) : null;
  if (flagMesh) { root.add(flagMesh.mesh); disposables.push(flagMesh.mesh.geometry, flagMesh.mesh.material); }

  // ---- grass field (camera-following, instanced; none on 'low') ----
  const grass = createGrassField(scene, ground, tier);

  // ---- light rain ('ultra' and up): streaks lit by the lamps, rings in the puddles ----
  let rain = null;
  const setRain = () => {
    const on = tierAtLeast(tier, 'ultra') && !day;   // (a sunny day is dry)
    if (on && !rain) {
      rain = makeRain(fx, tier === 'cinematic' ? 9000 : 5000);
      rain.setRoofs(deckRoofs(map));
      root.add(rain.mesh);
      disposables.push(rain.mesh.geometry, rain.mesh.material);
    }
    if (rain) rain.mesh.visible = on;
    ground.uniforms.uRain.value = on ? 1 : 0;
  };

  // ---- reflection probe ----
  // The night sky alone made glass, paint and wet asphalt reflect a black void. A cube
  // capture of the finished world from above the objective (lamps, fires, neon and lit
  // windows included, in HDR) prefiltered into a PMREM gives every glossy surface
  // plausible reflections of the actual map at no per-frame cost. 'low' keeps the sky
  // alone; a game started on 'low' captures the world when it first leaves 'low'.
  let envRT = null;
  let envWorld = false;   // envRT holds the world capture (not just the sky)
  function bakeEnvironment() {
    let pmrem = null, next = null;
    try {
      pmrem = new THREE.PMREMGenerator(deps.renderer);
      // 1) the sky alone: what the probe's own glossy surfaces reflect while it is captured
      const envScene = new THREE.Scene();
      const envSky = makeSky(amb, 100, fx, fires);
      envSky.userData.updateGlow(ob ? ob.x : map.width / 2, ob ? ob.y : map.height / 2);
      envScene.add(envSky);
      const skyRT = pmrem.fromScene(envScene, 0, 0.5, 400, { size: 64 });
      envSky.geometry.dispose();
      envSky.material.dispose();
      next = skyRT;
      if (tier !== 'low') {
        const prevEnv = scene.environment;
        scene.environment = skyRT.texture;
        // 2) the world, lit by the pool around the probe
        // beside the objective (not in it, not next to the radio mast's beacons), toward the map centre
        let px = map.width / 2, py = map.height / 2;
        if (ob) {
          const dx = map.width / 2 - ob.x, dy = map.height / 2 - ob.y, dl = Math.hypot(dx, dy) || 1;
          const off = Math.max(ob.w, ob.h) * 0.5 + 160;
          px = ob.x + (dl > 1 ? dx / dl : 1) * off;
          py = ob.y + (dl > 1 ? dy / dl : 0) * off;
        }
        const ph = 96;
        for (let k = 0; k < 12; k++) deps.lights.update({ dt: 0.1, camX: px, camY: py, flashlight: false, lightingBoost: 1 });
        // the moon's map is drawn on demand only: without it every lit draw of the capture
        // sampled a missing shadow texture (GL "sampler type mismatch" warnings)
        if (deps.lights.updateMoonShadow) deps.lights.updateMoonShadow(deps.renderer, scene, moonCasters);
        const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
        const cubeCam = new THREE.CubeCamera(4, far, cubeRT);
        cubeCam.position.set(px, ph, py);
        sky.position.set(px, ph, py);
        sky.userData.updateGlow(px, py);
        scene.add(cubeCam);
        // point-like and blinking lights stay out: blurred into the probe, one nearby beacon
        // or halo tinted every glossy surface on the map (wet asphalt went blood red); so do
        // the actors and effects of a game already running (a capture made mid-game)
        const hidden = [];
        const hide = (m) => { if (m && m.visible) { m.visible = false; hidden.push(m); } };
        hide(grass.mesh);
        for (const m of staticMeshes) if (m.userData.bucket === 'blink') hide(m);
        // set dressing is a few hundred thousand triangles of small props: invisible in a 128 px blurred probe, costly to draw six times
        if (dress) for (const m of dress.meshes) hide(m);
        for (const m of fxMeshes) if (m.name === 'halos' || m.name === 'light-shafts' || m.name === 'light-pools' || m.name === 'objective-marker' || m.name === 'fire-embers') hide(m);
        for (const c of scene.children) if (c !== root && c !== cubeCam && c.name !== 'lights' && !c.isLight && !c.isCamera) hide(c);
        if (rain) hide(rain.mesh);
        try {
          cubeCam.update(deps.renderer, scene);
        } finally {
          for (const h of hidden) h.visible = true;
          scene.remove(cubeCam);
          scene.environment = prevEnv;
        }
        next = pmrem.fromCubemap(cubeRT.texture);
        cubeRT.dispose();
        skyRT.dispose();
        envWorld = true;
      }
    } catch (err) {
      console.warn('world: environment bake failed', err);
    }
    if (pmrem) pmrem.dispose();
    if (next && next !== envRT) {
      const old = envRT;
      envRT = next;
      scene.environment = envRT.texture;
      if (old) old.dispose();
    }
  }
  bakeEnvironment();
  const tEnv = performance.now() - tE;

  setRain();   // after the probe: rain must not be baked into the reflections

  let time = 0;
  const neonBase = new THREE.Color(1, 1, 1).multiplyScalar(day ? 0.25 : 1);

  // Static meshes and ground tiles wholly past the fog are skipped: every world material
  // fogs, and beyond this range the fog lets through < 0.2 % of a surface (a long map
  // looking down its road would otherwise draw every cell to the horizon).
  const cullDist = Math.sqrt(-Math.log(0.002)) / Math.max(1e-5, amb.fogDensity);
  const culled = staticMeshes.concat(ground.meshes);
  function cullFar(cam) {
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (const m of culled) {
      const s = m.geometry.boundingSphere;
      if (!s) continue;
      const dx = s.center.x - cx, dy = s.center.y - cy, dz = s.center.z - cz;
      m.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) - s.radius < cullDist;
    }
  }

  function update(view, frame) {
    const dt = Math.min(0.1, frame.dt || 0.016);
    time += dt;
    fx.uTime.value = time;
    mats.uniforms.uTime.value = time;
    const cam = ctx.camera;
    cullFar(cam);
    if (dress) { dress.cull(cam); dress.update(view, frame); }
    sky.position.copy(cam.position);
    sky.userData.updateGlow(cam.position.x, cam.position.z);
    // points sizing: drawing-buffer pixels per world unit at distance 1
    const ph = deps.pixelHeight ? deps.pixelHeight() : deps.renderer.domElement.height;
    fx.uPx.value = (ph * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
    waterNormal.offset.set((time * 0.013) % 1, (time * 0.021) % 1);
    // neon: mostly steady with the odd stutter
    const st = Math.sin(time * 1.3) + Math.sin(time * 3.7 + 1) * 0.6;
    const neonK = st > 1.35 ? (Math.sin(time * 60) > 0 ? 0.35 : 1) : 1;
    mats.hi.neon.color.copy(neonBase).multiplyScalar(neonK);
    if (pools) {
      const lv = deps.lights.mapLevel;
      for (let i = 0; i < lv.length && i < poolLevels.length; i++) poolLevels[i] = 1 - (lv[i] || 0);
      pools.setLevels(poolLevels);
    }
    if (flagMesh) flagMesh.update(time);
    if (supplyLight && ctx.lights) {
      ctx.lights.steady('world:supply', supplyLight.x, supplyLight.y, supplyLight.h, '#ffe2b0', 0.9, 300);
    }
    for (let i = 0; i < canopies.length; i++) {
      const c = canopies[i];
      if (Math.abs(c.x - frame.camX) < 900 && Math.abs(c.y - frame.camY) < 900) ctx.lights.steady('world:canopy' + i, c.x, c.y, 140 + gy(c.x, c.y), '#e8f0ff', 0.36, Math.max(c.w, c.h) * 0.75);
    }
    grass.update(cam, dt);
    if (rain && rain.mesh.visible) rain.update(deps.lights.poolLights, deps.lights.flashlight, cam);
    ground.update(frame);
  }

  let triangles = 0;
  for (const m of staticMeshes) triangles += m.geometry.attributes.position.count / 3;

  return {
    ground,
    root,
    sky,
    /** Static meshes that cast the moon's shadow (lights.updateMoonShadow). */
    moonCasters,
    fx,
    update,
    /** Swap every static mesh to the tier's materials; the grass field follows the tier. */
    setQuality(q) {
      const nt = normTier(q);
      if (nt === tier) return;
      tier = nt;
      if (tier !== 'low' && !detailTex) {
        detailTex = track(makeDetailArray(anisoFor(tier === 'high' ? 'high' : 'ultra', maxAniso)));
        mats.shared.uDetail.value = detailTex;
        ground.uniforms.uDetail.value = detailTex;
      }
      for (const m of staticMeshes) m.material = matOf(m.userData.bucket, tier);
      grass.setQuality(tier);
      ground.setQuality(tier);
      if (dress) dress.setQuality(tier);
      setRain();
      // a game started on 'low' only had the sky to reflect: capture the world now (one hitch)
      if (tier !== 'low' && !envWorld) bakeEnvironment();
    },
    get stats() {
      return {
        staticMeshes: staticMeshes.length, staticTriangles: Math.round(triangles), fxMeshes: fxMeshes.length, ground: ground.stats,
        grass: grass.instances,
        dress: dress ? dress.stats : null,
        buildMs: {
          detail: Math.round(tDetail), ground: Math.round(tGround), geometry: Math.round(tGeo), env: Math.round(tEnv),
          obstacles: Math.round(tObsMs), decor: Math.round(tDecMs), treeLine: Math.round(tTlMs), flora: Math.round(tFloraMs),
        },
      };
    },
    dispose() {
      if (dress) dress.dispose();
      ground.dispose();
      grass.dispose();
      mats.dispose();
      for (const d of disposables) d.dispose && d.dispose();
      if (envRT) { if (scene.environment === envRT.texture) scene.environment = null; envRT.dispose(); }
      scene.remove(root);
    },
  };
}

// ---- flags ----------------------------------------------------------------------------------

function makeFlagMesh(list) {
  const SEG = 8;
  const pos = new Float32Array(list.length * SEG * 6 * 3);
  const col = new Float32Array(list.length * SEG * 6 * 3);
  const c = new THREE.Color();
  list.forEach((f, i) => {
    c.set(f.color);
    for (let k = 0; k < SEG * 6; k++) {
      const shade = 0.85 + 0.15 * Math.sin(k);
      col.set([c.r * shade, c.g * shade, c.b * shade], (i * SEG * 6 + k) * 3);
    }
  });
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3);
  pa.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'flags';
  mesh.frustumCulled = false;
  const px = new Float32Array(SEG + 1), pz = new Float32Array(SEG + 1), py = new Float32Array(SEG + 1);
  return {
    mesh,
    update(t) {
      let o = 0;
      for (const f of list) {
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG;
          // flag hangs from the pole top, blowing along the wind (+x), rippling sideways
          px[s] = f.x + u * f.L * 0.97;
          pz[s] = f.y + Math.sin(t * 4 + f.ph - u * 5) * 3 * u * f.s;
          py[s] = f.h - u * u * 3 * f.s;
        }
        for (let s = 0; s < SEG; s++) {
          const H = f.H;
          const x0 = px[s], z0 = pz[s], t0 = py[s], x1 = px[s + 1], z1 = pz[s + 1], t1 = py[s + 1];
          pos[o++] = x0; pos[o++] = t0; pos[o++] = z0;
          pos[o++] = x1; pos[o++] = t1; pos[o++] = z1;
          pos[o++] = x1; pos[o++] = t1 - H; pos[o++] = z1;
          pos[o++] = x0; pos[o++] = t0; pos[o++] = z0;
          pos[o++] = x1; pos[o++] = t1 - H; pos[o++] = z1;
          pos[o++] = x0; pos[o++] = t0 - H; pos[o++] = z0;
        }
      }
      pa.needsUpdate = true;
      g.computeVertexNormals();
    },
  };
}

// ---- obstacles ------------------------------------------------------------------------------

function buildObstacle(B, o, sign, overpass, halos) {
  const L = o.w, W = o.h;
  switch (o.kind) {
    // the campaign's kinds (world-ridge.js)
    case 'palisade': palisade(B, L, W); break;
    case 'watchtower': watchtower(B, o, halos); break;
    case 'tower': skyscraper(B, o, L, W, halos); break;
    case 'iwall': iwall(B, o, L, W); break;
    case 'desk': desk(B, o, L, W); break;
    case 'cabinet': cabinet(B, o, L, W); break;
    case 'counter': counter(B, o, L, W); break;
    case 'ipillar': ipillar(B, o, L, W); break;
    case 'stairs': stairs(B, o, L, W); break;
    case 'hvac': hvac(B, o, L, W); break;
    case 'parapet': parapet(B, o, L, W); break;
    case 'mast': mast(B, o, L, W, halos); break;
    case 'rim': break;
    // overpass piers and ramp embankments are built with their decks (world-overpass.js)
    case 'pier': if (!overpass) B.rblock('std', 0, 0, 0, L, obstacleHeight('pier', o), W, 4, o.color || '#8e8a82', null, { surf: [DET.concrete, 0.9, 0] }); break;
    case 'ramp': if (!overpass) B.block('std', 0, 0, 0, L, obstacleHeight('ramp', o), W, o.color || '#8a867d', null, { surf: [DET.concrete, 0.9, 0] }); break;
    case 'car': case 'suv': case 'pickup': case 'van': case 'truck': buildVehicle(B, o); break;
    case 'semi': if (L <= 100) buildSemiCab(B, o); else buildTrailer(B, o); break;
    case 'bus': buildBus(B, o, false); break;
    case 'tanker': buildTanker(B, o); break;
    case 'barrier': jersey(B, L, W, o.color || '#9a968c'); break;
    case 'sandbags': sandbags(B, L, W, o.color || '#8a7a5a'); break;
    case 'guardrail': guardrail(B, L, W, o.color || '#9aa0a4'); break;
    case 'wall': if (W <= 8) fence(B, L, W, o.color || '#8a8f93'); else wall(B, L, W, o.color || '#8a877e'); break;
    case 'hesco': hesco(B, L, W, o.color || '#a08a60'); break;
    case 'container': container(B, o, L, W); break;
    case 'building': building(B, o, L, W, sign); break;
    case 'pump': pump(B, L, W, o.color || '#c43a2a'); break;
    case 'pillar': pillar(B, L, W, o.color || '#d8d4c8'); break;
    case 'tent': tent(B, L, W, o.color, o.roof); break;
    case 'booth': booth(B, L, W, o.color, o.roof); break;
    case 'tree': trunk(B, L, o); break;
    case 'rock': rock(B, L, W, o.color || '#6d6a63', obstacleHeight('rock', o)); break;
    case 'silo': silo(B, L, W, o.color || '#b8bcbf'); break;
    case 'grave': headstone(B, L, W, o.color || '#8e8c86', o.id); break;
    default: B.block('std', 0, 0, 0, L, 40, W, o.color || '#777');
  }
}

// ---- objective / supply -----------------------------------------------------------------------

function buildObjective(B, ob, halos) {
  const L = ob.w, W = ob.h;
  switch (ob.kind) {
    case 'bus': {
      buildBus(B, { ...ob, id: 1, color: '#e3a41a' }, true);
      B.rblock('paint', 0, 100.5, 0, 50, 3, 30, 1, '#d19514', null, { surf: [DET.panel, -1, -1] });
      break;
    }
    case 'diner': diner(B, L, W, halos, ob); break;
    case 'apc': buildApc(B, L, W); break;
    case 'radio': radio(B, L, W, halos, ob); break;
    default: B.block('std', 0, 0, 0, L, 80, W, '#888');
  }
}

function buildSupply(B, sp, flags, halos) {
  const r = B.rng;
  const woodS = { surf: [DET.wood, 0.85, 0] };
  // pallet
  B.block('std', 0, 0, 0, 64, 5, 46, WOOD, null, woodS);
  for (let i = 0; i < 4; i++) B.box('std', -24 + i * 16, 5.5, 0, 12, 1, 46, shadeHex(WOOD, -0.15), null, woodS);
  const crates = [[-16, -10, 24], [12, -10, 22], [-2, 12, 20]];
  for (const [x, z, s] of crates) {
    const rot = [0, r.range(-0.2, 0.2), 0];
    B.rblock('std', x, 5, z, s, s, s, 0.6, '#7a5a32', rot, woodS);
    B.box('std', x, 5 + s / 2, z, s + 0.6, 3, s + 0.6, '#5b4124', rot, woodS);
    B.box('std', x, 5 + s - 1, z, s + 0.6, 2, s + 0.6, '#5b4124', rot, woodS);
    B.add('decal', T.plane(), [x, 5 + s * 0.3, z + s / 2 + 0.35], [s * 0.7, s * 0.26, 1], null, '#ffffff', { uv: atlasUV('stripeYB'), noAO: true });
  }
  B.rblock('std', -16, 29, -10, 18, 16, 18, 0.6, '#86653a', [0, 0.3, 0], woodS);
  // ammo boxes with a yellow stencil band
  for (let i = 0; i < 3; i++) {
    B.rblock('std', 22 + (i % 2) * 2, 5 + i * 9, 12, 20, 9, 12, 0.8, '#4b5320', [0, 0.1 * i, 0], { surf: [DET.panel, 0.6, 0.4] });
    B.box('std', 22 + (i % 2) * 2, 9.5 + i * 9, 18.2, 12, 2, 0.5, '#d8b43a', null, { surf: [0, 0.6, 0] });
  }
  // work light on a tripod
  const lx = 36, lz = -26, lh = 92;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * 6.28;
    beam(B, 'std', lx + Math.cos(a) * 16, 0, lz + Math.sin(a) * 16, lx, lh - 10, lz, 1, '#2a2a2a', [DET.rust, 0.5, 0.8]);
  }
  B.cyl('std', lx, lh - 12, lz, 1.4, 14, '#2a2a2a', 6, 1, null, { surf: [DET.rust, 0.5, 0.8] });
  B.rbox('std', lx, lh, lz, 14, 10, 7, 1, '#e0b020', [0.4, 0.8, 0], { surf: [DET.panel, 0.45, 0.3] });
  B.box('glow', lx - 2, lh - 2, lz + 3, 11, 7, 0.6, '#fff4d8', [0.4, 0.8, 0], { emissive: 5, uv: atlasUV('white') });
  // flag
  const fx = -30, fz = 24;
  B.cyl('std', fx, 0, fz, 1.6, 150, '#9a9ea2', 8, 1, null, { surf: [DET.rust, 0.45, 0.85] });
  const cosA = Math.cos(0.35), sinA = Math.sin(0.35);
  const wx = sp.x + fx * cosA - fz * sinA, wy = sp.y + fx * sinA + fz * cosA;
  flags.push({ x: wx, y: wy, h: 148, L: 44, H: 26, s: 1.2, color: '#d9661c', ph: 1.3 });
  const px = sp.x + lx * cosA - lz * sinA, py = sp.y + lx * sinA + lz * cosA;
  halos.push({ x: px, y: py, h: lh, color: '#fff0d0', size: 80, strength: 0.6 });
  return { x: px, y: py, h: lh + 10 };
}

// ---- decor ------------------------------------------------------------------------------------

function buildDecor(B, d, i, light, halos, shafts, flags) {
  const s = d.s || 1;
  switch (d.kind) {
    case 'tree_canopy': canopy(B, d, i); break;
    case 'bush': bush(B, d, i); break;
    case 'rock': {
      const R = 6 * s;
      B.add('std', T.dodeca(), [0, R * 0.25, 0], [R, R * 0.7, R * 0.85], [0, B.rng.range(0, 6), 0], B.rng.pick(['#6d6a63', '#77726a', '#5f5b55']), { wobble: { amp: 0.3, seed: i }, surf: [DET.rock, 0.85, 0] });
      break;
    }
    case 'cone': cone(B, d); break;
    case 'tire': tires(B, d); break;
    case 'rubble': rubble(B, d); break;
    case 'debris': if (i % 2 === 0) debris(B, d); break;
    case 'lamp_post': {
      const head = lampPost(B, d, !!light, light ? light.color : '#fff');
      if (head) {
        const flood = s > 1.1;
        const ca = Math.cos(d.a || 0), sa = Math.sin(d.a || 0);
        const wx = d.x + ca * head.x, wy = d.y + sa * head.x;
        halos.push({ x: wx, y: wy, h: head.h, color: light.color, size: flood ? 150 : 115, strength: flood ? 0.7 : 0.8 });
        shafts.push({ x: wx, y: wy, h: head.h - 2, color: light.color, radius: Math.min(flood ? 170 : 125, light.r * (flood ? 0.55 : 0.44)), strength: flood ? 0.8 : 1 });
      }
      break;
    }
    case 'sign': roadSign(B, d, i); break;
    case 'signal': trafficSignal(B, d, i, halos); break;
    case 'pylon': pricePylon(B, d); break;
    case 'grass_tuft': grassTuft(B, d, i); break;
    case 'flag': {
      B.cyl('std', 0, 0, 0, 1.4, 130 * s, '#8a8e92', 8, 1, null, { surf: [DET.rust, 0.45, 0.85] });
      flags.push({ x: d.x, y: d.y, h: 128 * s, L: 32 * s, H: 20 * s, s, color: ['#8a1c1c', '#1c3a8a', '#e3e3e3', '#2e5d2e'][Math.floor(((i * 2654435761) >>> 0) / 4294967296 * 4)], ph: (i * 0.37) % 6 });
      break;
    }
    default:
      break;
  }
}

