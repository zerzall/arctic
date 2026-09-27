// The static world of the first-person view (WORLD, SPEC §7.5): ground (ground.js), every
// obstacle kind as a low-poly model at the canonical heights, the objective, the supply
// station, 3D decor, permanent fires, water, a tree line past the bounds and the night sky.
//
// Everything static is written through the world-geo.js accumulator into a handful of
// material buckets (painted metal, matte, glass, emissive...) split into large spatial
// cells, so the map is a few dozen draw calls. Colours vary per vertex; there are no
// texture files. Animated bits (flames, smoke, halos, water ripples, neon, beacons, flags)
// are separate single-draw meshes animated from update().

import * as THREE from 'three';
import { createGeoBuilder, T, lin, mixHex, shadeHex, hash01, seededRng } from './world-geo.js';
import { createGround, WATER } from './ground.js';
import { atlasUV, makeAtlasTexture, makeChainLinkTexture, makeWaterNormal } from './world-tex.js';
import {
  createFxUniforms, makeSky, makeFlames, makeEmbers, makeSmoke, makeHalos, makeShafts, makePools, makeMarker,
} from './world-fx.js';

const TIRE = '#151515';
const RIM = '#44474b';
const GLASS = '#1d2a35';
const DARK = '#1b1c1e';
const CHROME = '#b8bec4';
const HEADLIGHT = '#fff1c8';
const TAIL = '#c0141a';
const CONCRETE = '#8a877e';
const POLE = '#34383c';
const WOOD = '#6b4a2c';
const LEAF = ['#16261a', '#1c2f19', '#223619', '#1a2c1c', '#25331c'];
const PINE = ['#15261a', '#1a2e1f', '#1f3322', '#172a1c'];
const GRASS = ['#3d4f26', '#4a5a2c', '#56552f', '#34461f', '#5e5a36'];
const VEHICLE = new Set(['car', 'suv', 'pickup', 'van', 'truck', 'semi', 'bus', 'tanker']);

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
    case 'building': return o ? buildingHeight(o) : 180;
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

function buildingHeight(o) {
  const small = Math.max(o.w, o.h) < 170;
  if (small) return 150 + Math.round(hash01(o.id * 7 + 1) * 20);
  const area = Math.min(1, (o.w * o.h) / 60000);
  return Math.round(150 + area * 70 + hash01(o.id * 13 + 5) * 40);
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
 * @param {object} deps { renderer, lights } (lights = lights.js instance, for pool levels)
 * @returns {{ ground, update(view, frame), setQuality(q), dispose(), stats }}
 */
export function createWorld(ctx, deps) {
  const { scene, map } = ctx;
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };

  const tA = performance.now();
  const ground = createGround({ scene, map, quality: ctx.quality, renderer: deps.renderer });
  const tGround = performance.now() - tA;
  const amb = deps.lights.ambient;
  const fx = createFxUniforms();
  fx.uFog.value = amb.fogDensity;
  fx.uFogColor.value.copy(amb.fog);

  // ---- materials ----
  const atlasTex = track(makeAtlasTexture());
  const chainTex = track(makeChainLinkTexture());
  const mats = {
    paint: track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 })),
    matte: track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
    // smooth-shaded cloth / rubber (sandbags, tyres, tarps)
    soft: track(new THREE.MeshLambertMaterial({ vertexColors: true })),
    glass: track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.75 })),
    glow: track(new THREE.MeshBasicMaterial({ vertexColors: true, map: atlasTex })),
    neon: track(new THREE.MeshBasicMaterial({ vertexColors: true, map: atlasTex })),
    blink: track(new THREE.MeshBasicMaterial({ vertexColors: true })),
    fence: track(new THREE.MeshLambertMaterial({
      vertexColors: true, map: chainTex, alphaTest: 0.4, side: THREE.DoubleSide, alphaToCoverage: true,
    })),
  };
  const B = createGeoBuilder({
    cell: 1600,
    buckets: {
      paint: {}, matte: {}, soft: {}, glass: {}, glow: { uv: true, ao: false }, neon: { uv: true, ao: false },
      blink: { ao: false }, fence: { uv: true },
    },
  });

  // lists for the effect meshes
  const halos = [];
  const shafts = [];
  const flags = [];
  const lightByPos = (x, y) => map.lights.find((l) => Math.abs(l.x - x) < 4 && Math.abs(l.y - y) < 4) || null;

  // ---- obstacles ----
  for (const o of map.obstacles) {
    B.obj(o.x, o.y, o.a || 0, o.id * 31 + (map.seed | 0));
    B.setJitter(0.07);
    try {
      buildObstacle(B, o, map);
    } catch (err) {
      console.warn('world: obstacle model failed', o.kind, err);
    }
  }
  buildCanopies(B, map);

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
    buildDecor(B, d, i, lightByPos(d.x, d.y), halos, shafts, flags);
  });

  // ---- fires ----
  const fires = map.fires.map((f) => ({ x: f.x, y: f.y, r: f.r, base: fireBaseHeight(map, f.x, f.y) }));
  fires.forEach((f, i) => {
    if (f.base === 30) {
      // an oil drum with a fire in it
      B.obj(f.x, f.y, i, 70 + i);
      B.cyl('matte', 0, 0, 0, 11, 30, '#4a3424', 10);
      B.cyl('matte', 0, 29, 0, 11.4, 1.5, '#2b1f16', 10);
      B.cyl('glow', 0, 29.6, 0, 10, 0.6, '#ff7a22', 10, 1, null, { emissive: 1.4, uv: atlasUV('white') });
    }
    halos.push({ x: f.x, y: f.y, h: f.base + f.r * 0.9, color: '#ff7a2a', size: f.r * 5.5, flicker: 0.8, strength: 0.55 });
  });

  // ---- tree line past the bounds ----
  buildTreeLine(B, map, ground.waters);

  // ---- bridge fascias / piers over water edges ----
  for (const w of ground.waters) {
    for (const e of w.edges) {
      if (!e.bridge) continue;
      if (e.axis === 'y') {
        const len = w.x1 - w.x0, cx = (w.x0 + w.x1) / 2;
        B.obj(cx, e.pos + e.dir * 5, 0, 5);
        B.block('matte', 0, -WATER.depth, 0, len + 160, WATER.depth + 3.5, 10, '#6f6c64');
        B.block('matte', 0, -12, e.dir * 3, len + 160, 5, 14, '#5b5953');
        for (let x = -len / 2 + 60; x < len / 2; x += 170) B.block('matte', x, -WATER.depth, e.dir * 16, 30, WATER.depth - 4, 22, '#5f5c55');
      } else {
        const len = w.y1 - w.y0, cy = (w.y0 + w.y1) / 2;
        B.obj(e.pos + e.dir * 5, cy, Math.PI / 2, 5);
        B.block('matte', 0, -WATER.depth, 0, len + 160, WATER.depth + 3.5, 10, '#6f6c64');
      }
    }
  }

  // ---- build static meshes ----
  const staticMeshes = [];
  const built = B.finish();
  const tGeo = performance.now() - tA - tGround;
  for (const { bucket, geometry } of built) {
    const mesh = new THREE.Mesh(geometry, mats[bucket]);
    mesh.matrixAutoUpdate = false;
    // The only shadow-casting light is the flashlight, 7 units off the eye: the shadow of a
    // wall or a car falls almost exactly behind it as seen from the camera, so static casters
    // were invisible but cost a quarter of the frame's triangles (a second pass over the
    // world). Actors still cast (their slivers show on the ground and walls behind them).
    mesh.castShadow = false;
    mesh.receiveShadow = bucket !== 'glow' && bucket !== 'neon' && bucket !== 'blink';
    mesh.name = 'world-' + bucket;
    root.add(mesh);
    staticMeshes.push(mesh);
    disposables.push(geometry);
  }

  // ---- water ----
  const waterNormal = track(makeWaterNormal());
  waterNormal.repeat.set(1, 1);
  const waterMat = track(new THREE.MeshStandardMaterial({
    color: '#0a1517', roughness: 0.14, metalness: 0.1, normalMap: waterNormal, normalScale: new THREE.Vector2(0.16, 0.16), envMapIntensity: 0.7,
  }));
  const waterMeshes = [];
  for (const w of ground.waters) {
    const gw = w.x1 - w.x0, gh = w.y1 - w.y0;
    const geo = new THREE.PlaneGeometry(gw, gh, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * gw / 520, uv.getY(i) * gh / 520);
    geo.translate((w.x0 + w.x1) / 2, WATER.surface, (w.y0 + w.y1) / 2);
    const m = new THREE.Mesh(geo, waterMat);
    m.receiveShadow = true;
    m.name = 'water';
    root.add(m);
    waterMeshes.push(m);
    disposables.push(geo);
  }

  // ---- fx meshes ----
  const far = Math.hypot(map.width, map.height) + 1400;
  const tE = performance.now();
  const sky = makeSky(amb, Math.min(far * 0.9, 6000), fx);
  root.add(sky);
  disposables.push(sky.geometry, sky.material);
  // Environment: the night sky baked once into a PMREM so glass, paint and wet asphalt
  // reflect the dark gradient and the moon (sampled per fragment, no per-frame cost).
  let envRT = null;
  try {
    const pmrem = new THREE.PMREMGenerator(deps.renderer);
    const envScene = new THREE.Scene();
    const envSky = makeSky(amb, 100, fx);
    envScene.add(envSky);
    envRT = pmrem.fromScene(envScene, 0, 0.5, 400, { size: 64 });
    scene.environment = envRT.texture;
    envSky.geometry.dispose();
    envSky.material.dispose();
    pmrem.dispose();
  } catch (err) {
    console.warn('world: environment bake failed', err);
  }
  const tEnv = performance.now() - tE;
  mats.paint.envMapIntensity = 0.9;
  mats.glass.envMapIntensity = 1.6;
  const fxMeshes = [];
  const addFx = (m) => { if (m) { root.add(m); fxMeshes.push(m); disposables.push(m.geometry, m.material); } return m; };
  if (fires.length) {
    addFx(makeFlames(fires, fx));
    addFx(makeEmbers(fires, fx));
    addFx(makeSmoke(fires, fx));
  }
  if (halos.length) addFx(makeHalos(halos, fx));
  if (shafts.length) addFx(makeShafts(shafts, fx));
  const poolList = map.lights.map((l, i) => {
    const src = deps.lights.mapSources[i];
    const fire = l.flicker >= 0.5;
    const lampish = src && src.h > 150;
    return { x: l.x, y: l.y, r: l.r * (lampish ? 0.95 : 0.8), color: l.color, flicker: fire ? l.flicker : 0, strength: fire ? 0.28 : lampish ? 0.34 : 0.2, base: 0 };
  });
  const pools = poolList.length ? makePools(poolList, fx) : null;
  if (pools) addFx(pools.mesh);
  const poolLevels = new Float32Array(poolList.length);
  const marker = ob ? addFx(makeMarker(ob, fx)) : null;

  // flags: one dynamic strip mesh
  const flagMesh = flags.length ? makeFlagMesh(flags) : null;
  if (flagMesh) { root.add(flagMesh.mesh); disposables.push(flagMesh.mesh.geometry, flagMesh.mesh.material); }

  let time = 0;
  const neonBase = new THREE.Color(1, 1, 1);

  function update(view, frame) {
    const dt = Math.min(0.1, frame.dt || 0.016);
    time += dt;
    fx.uTime.value = time;
    const cam = ctx.camera;
    sky.position.copy(cam.position);
    // points sizing: drawing-buffer pixels per world unit at distance 1
    fx.uPx.value = (deps.renderer.domElement.height * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
    waterNormal.offset.set((time * 0.013) % 1, (time * 0.021) % 1);
    // neon: mostly steady with the odd stutter
    const st = Math.sin(time * 1.3) + Math.sin(time * 3.7 + 1) * 0.6;
    const neonK = st > 1.35 ? (Math.sin(time * 60) > 0 ? 0.35 : 1) : 1;
    mats.neon.color.copy(neonBase).multiplyScalar(neonK);
    mats.blink.color.setScalar(((time * 0.8) % 1) > 0.55 ? 1 : 0.08);
    if (pools) {
      const lv = deps.lights.mapLevel;
      for (let i = 0; i < poolLevels.length; i++) poolLevels[i] = 1 - (lv[i] || 0);
      pools.setLevels(poolLevels);
    }
    if (flagMesh) flagMesh.update(time);
    if (supplyLight && ctx.lights) {
      ctx.lights.steady('world:supply', supplyLight.x, supplyLight.y, supplyLight.h, '#ffe2b0', 0.9, 300);
    }
    ground.update(frame);
  }

  let triangles = 0;
  for (const m of staticMeshes) triangles += m.geometry.attributes.position.count / 3;

  return {
    ground,
    root,
    sky,
    fx,
    update,
    setQuality() { /* static world is quality independent after build (ground density fixed) */ },
    get stats() {
      return {
        staticMeshes: staticMeshes.length, staticTriangles: Math.round(triangles), fxMeshes: fxMeshes.length, ground: ground.stats,
        buildMs: { ground: Math.round(tGround), geometry: Math.round(tGeo), env: Math.round(tEnv) },
      };
    },
    dispose() {
      ground.dispose();
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
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'flags';
  mesh.frustumCulled = false;
  const pts = [];
  return {
    mesh,
    update(t) {
      let o = 0;
      for (const f of list) {
        pts.length = 0;
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG;
          const wave = Math.sin(t * 4 + f.ph - u * 5) * 3 * u * f.s;
          const along = u * f.L;
          // flag hangs from the pole top, blowing along the wind (+x), rippling sideways
          const x = f.x + along * 0.97;
          const z = f.y + wave;
          pts.push([x, z, f.h - u * u * 3 * f.s]);
        }
        for (let s = 0; s < SEG; s++) {
          const [x0, z0, t0] = pts[s], [x1, z1, t1] = pts[s + 1];
          const H = f.H;
          const quad = [[x0, t0, z0], [x1, t1, z1], [x1, t1 - H, z1], [x0, t0, z0], [x1, t1 - H, z1], [x0, t0 - H, z0]];
          for (const q of quad) { pos[o++] = q[0]; pos[o++] = q[1]; pos[o++] = q[2]; }
        }
      }
      pa.needsUpdate = true;
      g.computeVertexNormals();
    },
  };
}

// ---- obstacles ------------------------------------------------------------------------------

/** The builder with 'paint' parts sent to the matte bucket (burnt paint has no gloss). */
function wreckBuilder(B) {
  return new Proxy(B, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      return (bucket, ...rest) => v.call(t, bucket === 'paint' ? 'matte' : bucket, ...rest);
    },
  });
}

function buildObstacle(B, o, map) {
  const L = o.w, W = o.h;
  if (o.wrecked) {
    // Burnt-out wrecks: ash and rust over whatever colour the map gave them, on the matte
    // material. (Near-black glossy paint rendered big wrecks next to the spawn as flat
    // black holes in the picture: nothing lit their faces but the dim sky.)
    o = { ...o, color: mixHex(o.color || '#555555', '#4d443b', 0.6) };
    B = wreckBuilder(B);
  }
  switch (o.kind) {
    case 'car': case 'suv': case 'pickup': case 'van': case 'truck':
      vehicle(B, o.kind, L, W, o.color, o.wrecked, o.id);
      break;
    case 'semi':
      if (L <= 100) semiCab(B, L, W, o.color, o.wrecked, o.id);
      else trailer(B, L, W, o.color, o.wrecked);
      break;
    case 'bus': bus(B, L, W, o.color, o.wrecked, false, o.id); break;
    case 'tanker': tanker(B, L, W, o.color, o.wrecked); break;
    case 'barrier': jersey(B, L, W, o.color); break;
    case 'sandbags': sandbags(B, L, W, o.color); break;
    case 'guardrail': guardrail(B, L, W, o.color); break;
    case 'wall': if (W <= 8) fence(B, L, W, o.color); else wall(B, L, W, o.color); break;
    case 'hesco': hesco(B, L, W, o.color); break;
    case 'container': container(B, o, L, W); break;
    case 'building': building(B, o, L, W); break;
    case 'pump': pump(B, L, W, o.color); break;
    case 'pillar': pillar(B, L, W, o.color); break;
    case 'tent': tent(B, L, W, o.color, o.roof); break;
    case 'booth': booth(B, L, W, o.color, o.roof); break;
    case 'tree': trunk(B, L, o); break;
    case 'rock': rock(B, L, W, o.color, obstacleHeight('rock', o)); break;
    default: B.block('matte', 0, 0, 0, L, 40, W, o.color || '#777');
  }
}

const P = (L, pts) => pts.map(([x, y]) => [x * L, y]);

function wheelsAt(B, xs, W, r, width, wrecked, inset = 0) {
  for (const x of xs) {
    for (const s of [-1, 1]) {
      const z = s * (W / 2 - width / 2 - inset);
      if (wrecked) {
        B.cylZ('matte', x, r * 0.78, z, r * 0.72, width * 0.8, '#3d2a1e', 8);
      } else {
        B.cylZ('soft', x, r, z, r, width, TIRE, 10);
        B.cylZ('paint', x, r, z + s * 0.4, r * 0.55, width, RIM, 8);
      }
    }
  }
}

function lamps(B, L, W, y, wrecked, id, front = 0.5, rear = -0.5, spread = 0.34) {
  if (wrecked) return;
  const on = hash01(id * 3 + 11) < 0.18;
  for (const s of [-1, 1]) {
    B.box(on ? 'glow' : 'paint', L * front + 0.3, y, s * W * spread, 1.2, 4, 8, HEADLIGHT, null,
      on ? { emissive: 2.2, uv: atlasUV('white') } : null);
    B.box('glow', L * rear - 0.3, y + 1, s * W * spread, 1.2, 3.5, 7, TAIL, null, { emissive: on ? 1.1 : 0.35, uv: atlasUV('white') });
  }
}

/** Glass (or black holes when wrecked). */
function glassBucket(wrecked) { return wrecked ? 'matte' : 'glass'; }
// (a burnt-out cabin is a sooty hole, not a pure-black cut-out: pure black read as a hole in the picture)
function glassColor(wrecked) { return wrecked ? '#1e1b18' : GLASS; }

function soot(B, L, W, H, wrecked) {
  if (!wrecked) return;
  // charred patches and a caved-in roof line read as "burnt out"
  const r = B.rng;
  for (let i = 0; i < 4; i++) {
    B.box('matte', r.range(-L * 0.35, L * 0.35), H * r.range(0.4, 0.9), r.range(-W * 0.3, W * 0.3), r.range(8, 20), 1.5, r.range(6, 14), '#0e0d0c', [0, r.range(0, 3), 0]);
  }
}

function vehicle(B, kind, L, W, color, wrecked, id) {
  const r = B.rng;
  const sag = wrecked ? -2.5 : 0;
  const bodyC = color;
  const gB = glassBucket(wrecked), gC = glassColor(wrecked);
  if (wrecked) B.setJitter(0.15);
  switch (kind) {
    case 'car': {
      const wr = 8;
      B.prism('paint', 'car-body', P(L, [[-0.5, 8], [0.5, 8], [0.5, 18], [0.47, 23.5], [0.22, 25.5], [-0.43, 26.5], [-0.5, 22]]).map(([x, y]) => [x, y + sag]), 0, W * 0.96, bodyC);
      B.prism(gB, 'car-cabin', P(L, [[-0.41, 26], [0.22, 25.5], [0.04, 39.5], [-0.3, 39.5]]).map(([x, y]) => [x, y + sag]), 0, W * 0.84, gC);
      B.box('paint', -0.13 * L, 41 + sag, 0, 0.36 * L, 3, W * 0.86, bodyC);
      B.box('paint', -0.12 * L, 32.5 + sag, 0, 2.5, 14, W * 0.85, bodyC);
      B.box('matte', 0.5 * L, 11 + sag, 0, 3, 5, W * 0.94, DARK);
      B.box('matte', -0.5 * L, 11 + sag, 0, 3, 5, W * 0.94, DARK);
      wheelsAt(B, [0.31 * L, -0.31 * L], W, wr, 7, wrecked);
      lamps(B, L, W, 19 + sag, wrecked, id);
      soot(B, L, W, 40, wrecked);
      if (wrecked && r.chance(0.5)) B.box('paint', 0.36 * L, 30, 0, 0.28 * L, 1.5, W * 0.9, bodyC, [0, 0, 0.5]);   // hood popped
      break;
    }
    case 'suv': {
      B.prism('paint', 'suv-body', P(L, [[-0.5, 10], [0.5, 10], [0.5, 24], [0.46, 30], [-0.5, 31]]).map(([x, y]) => [x, y + sag]), 0, W * 0.96, bodyC);
      B.prism(gB, 'suv-cabin', P(L, [[-0.47, 30.5], [0.24, 30], [0.1, 51.5], [-0.46, 51.5]]).map(([x, y]) => [x, y + sag]), 0, W * 0.86, gC);
      B.box('paint', -0.18 * L, 53.5 + sag, 0, 0.58 * L, 4, W * 0.88, bodyC);
      for (const x of [-0.08, -0.32]) B.box('paint', x * L, 41 + sag, 0, 2.5, 21, W * 0.87, bodyC);
      B.box('paint', -0.18 * L, 56.3 + sag, 0, 0.5 * L, 1.2, W * 0.7, '#2a2a2a');
      B.box('matte', 0.5 * L, 13 + sag, 0, 3, 7, W * 0.94, DARK);
      B.box('matte', -0.5 * L, 13 + sag, 0, 3, 7, W * 0.94, DARK);
      wheelsAt(B, [0.31 * L, -0.31 * L], W, 9.5, 8, wrecked);
      lamps(B, L, W, 23 + sag, wrecked, id);
      soot(B, L, W, 52, wrecked);
      break;
    }
    case 'pickup': {
      B.prism('paint', 'pickup-body', P(L, [[-0.5, 10], [0.5, 10], [0.5, 24], [0.46, 31], [-0.12, 32], [-0.12, 24], [-0.5, 24]]).map(([x, y]) => [x, y + sag]), 0, W * 0.96, bodyC);
      B.prism(gB, 'pickup-cab', P(L, [[-0.12, 31.5], [0.16, 31.5], [0.04, 54], [-0.12, 54]]).map(([x, y]) => [x, y + sag]), 0, W * 0.86, gC);
      B.box('paint', -0.04 * L, 56 + sag, 0, 0.18 * L, 4, W * 0.88, bodyC);
      // the bed: floor, sides and tailgate up to 34
      for (const s of [-1, 1]) B.box('paint', -0.31 * L, 29 + sag, s * W * 0.45, 0.38 * L, 10, 2.5, bodyC);
      B.box('paint', -0.495 * L, 29 + sag, 0, 2.5, 10, W * 0.9, bodyC);
      B.box('matte', -0.31 * L, 24.5 + sag, 0, 0.37 * L, 1, W * 0.86, '#242424');
      if (!wrecked && r.chance(0.5)) B.block('matte', -0.3 * L, 25 + sag, 0, 14, 10, 12, r.pick(['#5a4a38', '#3b4a3a', '#6b6660']));
      B.box('matte', 0.5 * L, 13 + sag, 0, 3, 7, W * 0.94, CHROME);
      wheelsAt(B, [0.3 * L, -0.3 * L], W, 9.5, 8, wrecked);
      lamps(B, L, W, 23 + sag, wrecked, id);
      soot(B, L, W, 50, wrecked);
      break;
    }
    case 'van': {
      B.prism('paint', 'van-body', P(L, [[-0.5, 9], [0.5, 9], [0.5, 30], [0.4, 37], [0.4, 38.5], [-0.5, 38.5]]).map(([x, y]) => [x, y + sag]), 0, W * 0.97, bodyC);
      B.box('paint', -0.06 * L, 55 + sag, 0, 0.88 * L, 34, W * 0.97, bodyC);
      B.prism(gB, 'van-shield', P(L, [[0.38, 38], [0.405, 38], [0.39, 69], [0.37, 69]]).map(([x, y]) => [x, y + sag]), 0, W * 0.88, gC);
      B.prism('paint', 'van-nose', P(L, [[0.37, 38], [0.4, 38], [0.39, 70], [0.37, 72], [0.37, 72]]).map(([x, y]) => [x, y + sag]), 0, W * 0.97, bodyC);
      for (const s of [-1, 1]) B.box(gB, 0.28 * L, 55 + sag, s * (W * 0.485 + 0.3), 0.16 * L, 16, 0.6, gC);
      B.box(gB, -0.5 * L - 0.3, 58 + sag, 0, 0.6, 14, W * 0.6, gC);
      B.box('matte', 0.5 * L, 12 + sag, 0, 3, 6, W * 0.94, DARK);
      wheelsAt(B, [0.32 * L, -0.32 * L], W, 9, 8, wrecked);
      lamps(B, L, W, 26 + sag, wrecked, id);
      if (!wrecked && hash01(id) < 0.5) B.box('paint', -0.06 * L, 50 + sag, 0, 0.7 * L, 4, W * 0.98, shadeHex(bodyC, 0.35));
      soot(B, L, W, 70, wrecked);
      break;
    }
    case 'truck': {
      // military cargo truck: cab + hood in front, canvas-covered bed behind
      B.block('paint', 0.4 * L, 14 + sag, 0, 0.2 * L, 30, W * 0.9, bodyC);
      B.block('paint', 0.21 * L, 14 + sag, 0, 0.18 * L, 58, W * 0.96, bodyC);
      B.box(gB, 0.3 * L + 0.3, 60 + sag, 0, 0.6, 14, W * 0.8, gC);
      for (const s of [-1, 1]) B.box(gB, 0.21 * L, 60 + sag, s * (W * 0.48 + 0.3), 0.12 * L, 12, 0.6, gC);
      B.block('matte', -0.2 * L, 12 + sag, 0, 0.62 * L, 6, W, '#23241e');
      B.block('paint', -0.2 * L, 18 + sag, 0, 0.6 * L, 16, W * 0.98, bodyC);
      const canvasC = wrecked ? '#262620' : mixHex(bodyC, '#6f6a4a', 0.35);
      if (!wrecked || B.rng.chance(0.5)) {
        B.block('matte', -0.2 * L, 34 + sag, 0, 0.58 * L, 36, W * 0.96, canvasC);
        B.add('soft', T.cyl(12, 1, false), [-0.2 * L, 70 + sag, 0], [W * 0.48, 0.58 * L, 22], [0, 0, Math.PI / 2], canvasC);
      } else {
        for (let x = -0.45; x < 0.1; x += 0.13) B.add('matte', T.torus(8, 0.05), [x * L, 62 + sag, 0], [W * 0.46, W * 0.46, W * 0.46], [0, Math.PI / 2, 0], '#1a1a18');
      }
      wheelsAt(B, [0.36 * L, -0.18 * L, -0.36 * L], W, 12, 10, wrecked);
      lamps(B, L, W, 32 + sag, wrecked, id, 0.5, -0.5, 0.36);
      soot(B, L, W, 90, wrecked);
      break;
    }
    default:
      B.block('paint', 0, 0, 0, L, 40, W, bodyC);
  }
  if (wrecked) B.setJitter(0.07);
}

function semiCab(B, L, W, color, wrecked, id) {
  const sag = wrecked ? -3 : 0;
  const gB = glassBucket(wrecked), gC = glassColor(wrecked);
  B.block('paint', 0.33 * L, 18 + sag, 0, 0.34 * L, 44, W * 0.86, color);
  B.box('paint', 0.5 * L, 38 + sag, 0, 2, 30, W * 0.6, wrecked ? '#222' : CHROME);   // grille
  B.block('paint', -0.18 * L, 18 + sag, 0, 0.66 * L, 92, W * 0.98, color);
  B.box(gB, 0.15 * L + 0.4, 84 + sag, 0, 0.8, 22, W * 0.86, gC);
  for (const s of [-1, 1]) {
    B.box(gB, 0.05 * L, 84 + sag, s * (W * 0.49 + 0.3), 0.14 * L, 18, 0.6, gC);
    B.cyl('paint', 0.12 * L, 40 + sag, s * W * 0.51, 2.4, 80, wrecked ? '#2a2826' : CHROME, 6);
    B.box('paint', 0.05 * L, 40 + sag, s * W * 0.5, 0.12 * L, 3, 3, '#333');
  }
  B.box('paint', -0.22 * L, 112 + sag, 0, 0.5 * L, 4, W * 0.9, color);
  B.box('paint', 0.5 * L + 1, 20 + sag, 0, 3, 8, W, wrecked ? '#262626' : CHROME);
  wheelsAt(B, [0.3 * L, -0.34 * L], W, 14, 12, wrecked);
  lamps(B, L, W, 34 + sag, wrecked, id, 0.5, -0.5, 0.38);
  soot(B, L, W, 100, wrecked);
}

function trailer(B, L, W, color, wrecked) {
  const r = B.rng;
  const sag = wrecked ? -3 : 0;
  B.block('matte', 0, 14 + sag, 0, L, 8, W * 0.8, '#1d1d1d');
  B.block('paint', 0, 22 + sag, 0, L, 102, W, color);
  // ribs and the rear doors
  for (let x = -L / 2 + 12; x < L / 2 - 6; x += 24) {
    for (const s of [-1, 1]) B.box('paint', x, 72 + sag, s * (W / 2 + 0.6), 2, 98, 1.2, shadeHex(color, -0.12));
  }
  B.box('paint', -L / 2 - 0.6, 72 + sag, 0, 1.2, 98, W * 0.96, shadeHex(color, -0.18));
  B.box('matte', -L / 2 - 1.2, 72 + sag, 0, 1, 96, 1.5, '#222');
  B.box('matte', -L / 2 - 1, 16 + sag, 0, 3, 5, W * 0.9, '#a01010');
  if (!wrecked && r.chance(0.6)) {
    // a faded stripe of paint along the side
    for (const s of [-1, 1]) B.box('paint', 0, 96 + sag, s * (W / 2 + 0.9), L * 0.9, 10, 0.6, r.pick(['#8a2f2a', '#2f4f6f', '#3f5a3a']));
  }
  wheelsAt(B, [-0.37 * L, -0.29 * L], W, 13, 12, wrecked, 2);
  for (const s of [-1, 1]) B.block('matte', 0.3 * L, 0, s * W * 0.35, 4, 22, 4, '#333');
  if (wrecked) {
    B.setJitter(0.15);
    for (let i = 0; i < 5; i++) B.box('matte', r.range(-L * 0.4, L * 0.4), 124.8, r.range(-W * 0.3, W * 0.3), r.range(20, 50), 1, r.range(10, 30), '#121110');
    B.setJitter(0.07);
  }
}

function tanker(B, L, W, color, wrecked) {
  const sag = wrecked ? -3 : 0;
  const R = W * 0.47;
  const cy = 112 - R + sag;
  B.block('matte', 0, 16 + sag, 0, L, 10, W * 0.7, '#1c1c1c');
  B.add('paint', T.cyl(16), [0, cy, 0], [R, L * 0.9, R], [0, 0, Math.PI / 2], color);
  for (const s of [-1, 1]) B.add('paint', T.sphere(12, 8), [s * L * 0.45, cy, 0], [R * 0.35, R, R], null, color);
  for (const x of [-0.35, -0.1, 0.15, 0.38]) B.block('matte', x * L, 24 + sag, 0, 8, cy - 24 - R * 0.6 - sag, W * 0.6, '#262626');
  B.box('paint', 0, cy + R + 1, 0, L * 0.8, 1.5, 10, '#555');
  for (let x = -0.4; x <= 0.4; x += 0.2) B.cyl('paint', x * L, cy + R - 2, 0, 5, 5, '#6b6b6b', 8);
  // hazard band
  for (const s of [-1, 1]) B.box('paint', 0, cy, s * (R + 0.3), L * 0.5, 7, 0.8, wrecked ? '#2a2420' : '#b0301c', [0, 0, 0]);
  wheelsAt(B, [-0.36 * L, -0.28 * L, 0.3 * L], W, 13, 12, wrecked, 2);
  soot(B, L, W, 110, wrecked);
}

/**
 * Bus body: school bus (yellow, black bands, stop arm), or RV / coach in its own colour.
 * @param {boolean} objective lit windows with survivors
 */
function bus(B, L, W, color, wrecked, objective, id) {
  const r = B.rng;
  const school = objective || /^#d9a|^#e3a|^#d8a/i.test(color);
  const sag = wrecked ? -3 : 0;
  B.block('matte', 0, 10 + sag, 0, L * 0.98, 6, W * 0.9, '#1c1c1c');
  B.block('paint', 0, 14 + sag, 0, L, 78, W, color);
  B.block('paint', 0, 92 + sag, 0, L * 0.97, 5, W * 0.92, color);
  B.block('paint', 0, 97 + sag, 0, L * 0.9, 3, W * 0.7, shadeHex(color, -0.08));
  B.block('paint', 0, 13 + sag, 0, L * 1.002, 14, W * 1.01, shadeHex(color, -0.35));      // grimy skirt
  for (const s of [-1, 1]) {
    B.box('paint', 0.5 * L + 6, 70 + sag, s * (W / 2 + 4), 2, 12, 5, '#1a1a1a');          // mirrors
    B.box('glow', -L / 2 - 0.3, 30 + sag, s * W * 0.38, 0.6, 6, 6, TAIL, null, { emissive: 0.5, uv: atlasUV('white') });
    B.box('paint', 0, 30 + sag, s * (W / 2 + 0.5), L * 0.97, 1.6, 0.8, shadeHex(color, -0.4));
  }
  const x0 = -0.44 * L, x1 = 0.34 * L;
  const n = Math.max(3, Math.round((x1 - x0) / 26));
  const step = (x1 - x0) / n;
  for (const s of [-1, 1]) {
    const z = s * (W / 2 + 0.35);
    if (objective) {
      // lit windows, survivors' silhouettes inside
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5) * step;
        const cell = hash01(i * 7 + (s > 0 ? 3 : 0)) < 0.7 ? 'busWin' : 'win';
        B.add('glow', T.plane(), [x, 67 + sag, z], [step - 4, 22, 1], [0, s > 0 ? 0 : Math.PI, 0], '#ffffff', { emissive: 1.05, uv: atlasUV(cell) });
      }
    } else if (!school) {
      // RV: a few separate windows + a stripe
      for (let i = 0; i < n; i += 2) B.box(glassBucket(wrecked), x0 + (i + 0.5) * step, 64 + sag, z, step * 1.4, 18, 0.6, glassColor(wrecked));
      B.box('paint', 0, 44 + sag, z, L * 0.96, 7, 0.6, r.pick(['#8a2f2a', '#2f4f6f', '#7a6a4f', '#3f5a3a']));
    } else {
      B.box(glassBucket(wrecked), (x0 + x1) / 2, 66 + sag, z, x1 - x0, 22, 0.6, glassColor(wrecked));
    }
    if (school) {
      for (let i = 0; i <= n; i++) B.box('paint', x0 + i * step, 66 + sag, z * 1.004, 3, 24, 0.8, color);
      for (const y of [44, 52]) B.box('paint', 0, y + sag, z * 1.006, L * 0.98, 2.5, 0.8, '#111');
    }
  }
  // front: windshield, door, lights
  B.box(glassBucket(wrecked), L / 2 + 0.35, 66 + sag, 0, 0.7, 26, W * 0.86, objective ? '#2a2a24' : glassColor(wrecked));
  if (objective) B.add('glow', T.plane(), [L / 2 + 0.75, 88 + sag, 0], [W * 0.6, 7, 1], [0, Math.PI / 2, 0], '#ffcf6a', { emissive: 1.3, uv: atlasUV('white') });
  B.box('paint', L / 2 + 1, 18 + sag, 0, 3, 8, W * 0.98, '#1a1a1a');
  // rear: emergency door with its window, bumper
  B.box(glassBucket(wrecked), -L / 2 - 0.35, 68 + sag, 0, 0.7, 22, W * 0.34, objective ? '#3a2a18' : glassColor(wrecked));
  B.box('paint', -L / 2 - 0.5, 50 + sag, 0, 0.8, 70, W * 0.4, shadeHex(color, -0.12));
  B.box('paint', -L / 2 - 1, 18 + sag, 0, 3, 8, W * 0.98, '#1a1a1a');
  if (school) {
    // stop arm, hood-less flat nose
    B.cyl('paint', 0.36 * L, 50 + sag, -W / 2 - 3, 7, 1.2, '#b01818', 8, 1, [Math.PI / 2, 0, 0]);
  }
  lamps(B, L, W, 24 + sag, wrecked, objective ? 1 : id, 0.5, -0.5, 0.4);
  wheelsAt(B, [0.33 * L, -0.28 * L], W, 15, 12, wrecked, 1);
  soot(B, L, W, 98, wrecked);
}

function jersey(B, L, W, color) {
  const pts = [[-W / 2, 0], [W / 2, 0], [W / 2, 5], [W * 0.2, 12], [W * 0.15, 26], [-W * 0.15, 26], [-W * 0.2, 12], [-W / 2, 5]];
  const n = Math.max(1, Math.round(L / 60));
  const seg = L / n;
  const r = B.rng;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * seg;
    const c = r.chance(0.2) ? shadeHex(color, -0.25) : color;
    B.add('matte', T.profile('jersey' + W, pts), [x, 0, 0], [1, 1, seg - 1.5], [0, Math.PI / 2, r.range(-0.015, 0.015)], c);
    if (r.chance(0.35)) B.box('glow', x, 20, W * 0.17 + 0.3, 6, 3, 0.4, '#ff9a30', null, { emissive: 0.5, uv: atlasUV('white') });
  }
}

function sandbags(B, L, W, color) {
  const r = B.rng;
  const rows = 4, bagL = 21, bagH = 7.8;
  const depth = Math.min(W, 26);
  color = mixHex(color, '#4a4232', 0.3);
  for (let row = 0; row < rows; row++) {
    const n = Math.max(1, Math.round(L / (bagL - 1.5)));
    const off = row % 2 ? 0.5 : 0;
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + ((i + 0.5 + off * (i < n - 1 ? 1 : 0)) * L) / n;
      const c = mixHex(color, r.chance(0.5) ? '#a09070' : '#5e5238', r.range(0, 0.35));
      B.add('soft', T.sphere(8, 5), [x, bagH * 0.5 + row * (bagH - 0.6), r.range(-1, 1)], [bagL / 2, bagH * 0.6, depth / 2 - row * 1.2], [r.range(-0.05, 0.05), r.range(-0.1, 0.1), r.range(-0.06, 0.06)], c);
    }
  }
}

function guardrail(B, L, W, color) {
  const n = Math.max(2, Math.round(L / 38) + 1);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i * L) / (n - 1);
    B.block('paint', x, 0, 0, 3.5, 19, 3.5, '#5b6166');
  }
  B.box('paint', 0, 16, W * 0.12, L, 3, 1.4, color);
  B.box('paint', 0, 19.5, W * 0.18, L, 3, 1.4, color);
  B.box('paint', 0, 12.5, W * 0.18, L, 3, 1.4, color);
}

function fence(B, L, W, color) {
  const r = B.rng;
  const wood = parseInt(color.slice(1, 3), 16) > parseInt(color.slice(5, 7), 16) + 12;
  if (wood) {
    const n = Math.max(2, Math.round(L / 42) + 1);
    for (let i = 0; i < n; i++) B.block('matte', -L / 2 + (i * L) / (n - 1), 0, 0, 5, 40 + r.range(-3, 2), 5, shadeHex(color, -0.1), [0, 0, r.range(-0.05, 0.05)]);
    for (const y of [13, 25, 36]) {
      if (r.chance(0.15)) continue;   // a missing rail here and there
      B.box('matte', 0, y, 2.4, L, 4, 1.6, color, [r.range(-0.01, 0.01), 0, 0]);
    }
  } else {
    const n = Math.max(2, Math.round(L / 60) + 1);
    for (let i = 0; i < n; i++) B.cyl('paint', -L / 2 + (i * L) / (n - 1), 0, 0, 1.8, 42, '#8c9296', 6);
    B.cylX('paint', 0, 41, 0, 1.2, L, '#8c9296', 6);
    B.add('fence', T.plane(), [0, 20.5, 0], [L, 39, 1], null, '#aab0b5', { uvScale: [L / 16, 39 / 16] });
  }
}

function wall(B, L, W, color) {
  B.block('matte', 0, 0, 0, L, 86, W, color);
  B.block('matte', 0, 86, 0, L + 2, 4, W + 4, shadeHex(color, 0.12));
  const n = Math.max(1, Math.round(L / 90));
  for (let i = 0; i <= n; i++) B.block('matte', -L / 2 + (i * L) / n, 0, 0, 8, 88, W + 4, shadeHex(color, -0.06));
}

function hesco(B, L, W, color) {
  const n = Math.max(1, Math.round(L / 44));
  const cell = L / n;
  const r = B.rng;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * cell;
    const c = mixHex(color, r.chance(0.5) ? '#b8a57a' : '#7c6a48', r.range(0, 0.3));
    B.block('matte', x, 0, 0, cell - 1.6, 66, W - 1, c);
    B.block('matte', x, 66, 0, cell - 5, 3, W - 5, mixHex(c, '#5a4a30', 0.3));
    // wire mesh frame
    for (const s of [-1, 1]) {
      B.block('paint', x + s * (cell / 2 - 1), 0, W / 2 - 0.5, 1.2, 70, 1.2, '#6e706c');
      B.block('paint', x + s * (cell / 2 - 1), 0, -W / 2 + 0.5, 1.2, 70, 1.2, '#6e706c');
    }
    B.box('paint', x, 69.5, W / 2 - 0.4, cell, 1, 1, '#6e706c');
    B.box('paint', x, 69.5, -W / 2 + 0.4, cell, 1, 1, '#6e706c');
  }
}

function container(B, o, L, W) {
  const r = B.rng;
  const color = o.color;
  if (Math.max(L, W) <= 72) {
    const light = parseInt(color.slice(1, 3), 16) > 190;
    if (light) {
      // propane cage: wire cage with white cylinders inside
      for (let x = -L / 2 + 8; x < L / 2 - 4; x += 12) B.cyl('paint', x, 0, 0, 5.5, 44, '#e8e6e0', 8, 0.85);
      B.block('paint', 0, 60, 0, L, 3, W, '#9aa0a4');
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('paint', (x * L) / 2, 0, (z * W) / 2, 2, 62, 2, '#9aa0a4');
      for (const s of [-1, 1]) {
        B.add('fence', T.plane(), [0, 30, (s * W) / 2], [L, 60, 1], null, '#c8ccd0', { uvScale: [L / 12, 60 / 12] });
        B.add('fence', T.plane(), [(s * L) / 2, 30, 0], [W, 60, 1], [0, Math.PI / 2, 0], '#c8ccd0', { uvScale: [W / 12, 60 / 12] });
      }
      B.box('glow', L / 2 + 0.3, 44, 0, 0.4, 10, 18, '#c02020', null, { emissive: 0.5, uv: atlasUV('white') });
    } else if (L >= 55 && W >= 40) {
      // generator
      B.block('paint', 0, 0, 0, L, 8, W, '#222');
      B.block('paint', 0, 8, 0, L * 0.96, 48, W * 0.96, color);
      for (let y = 20; y < 50; y += 6) B.box('matte', L * 0.2, y, W * 0.48 + 0.3, L * 0.4, 2, 0.8, '#1c1c1c');
      B.cyl('paint', -L * 0.3, 56, W * 0.2, 3, 12, '#3a3a3a', 6);
      B.box('glow', -L * 0.2, 44, W * 0.48 + 0.4, 5, 3, 0.4, '#7dff7a', null, { emissive: 1.4, uv: atlasUV('white') });
    } else {
      // dumpster with a sloped lid
      B.block('matte', 0, 0, 0, L * 0.9, 4, W * 0.9, '#1a1a1a');
      B.add('paint', T.profile('dumpster' + L, [[-L / 2, 4], [L / 2, 4], [L / 2, 52], [-L / 2, 46]]), [0, 0, 0], [1, 1, W], null, color);
      B.box('paint', 0, 53, 0, L + 2, 2, W + 2, shadeHex(color, -0.25), [0.0, 0, 0.1]);
      if (r.chance(0.5)) for (let i = 0; i < 3; i++) B.box('matte', r.range(-L / 2, L / 2), r.range(4, 8), W / 2 + r.range(4, 14), r.range(6, 12), r.range(6, 10), r.range(6, 12), r.pick(['#2a2a2a', '#3a3530', '#1e2a1e']), [0, r.range(0, 3), 0]);
    }
    return;
  }
  // shipping container
  const H = 84;
  B.block('paint', 0, 0, 0, L, H, W, color);
  B.block('paint', 0, H, 0, L - 2, 1.5, W - 2, o.roof || color);
  for (let x = -L / 2 + 6; x < L / 2 - 4; x += 8) {
    for (const s of [-1, 1]) B.box('paint', x, H / 2, s * (W / 2 + 0.5), 3, H - 8, 1, shadeHex(color, -0.1));
  }
  for (const s of [-1, 1]) {
    B.box('paint', s * (L / 2 + 0.5), H / 2, 0, 1, H - 6, W - 6, shadeHex(color, -0.15));
    for (const z of [-0.2, 0.2]) B.box('paint', s * (L / 2 + 1.2), H / 2, z * W, 1, H - 10, 1.4, '#555');
  }
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('paint', (x * (L - 4)) / 2, 0, (z * (W - 4)) / 2, 5, H + 1, 5, shadeHex(color, -0.3));
  if (r.chance(0.5)) B.box('paint', 0, H * 0.72, W / 2 + 1.1, L * 0.3, 8, 0.4, '#e8e4d8');
}

function building(B, o, L, W) {
  const r = B.rng;
  const H = buildingHeight(o);
  const small = Math.max(L, W) < 170;
  const wallH = small ? H - 50 : H;
  const color = o.color;
  B.block('matte', 0, 0, 0, L, wallH, W, color);
  B.block('matte', 0, 0, 0, L + 3, 12, W + 3, shadeHex(color, -0.35));   // plinth
  // windows on every face, a few lit
  const floorH = 46;
  const floors = Math.max(1, Math.floor((wallH - 20) / floorH));
  const faces = [
    { len: L, z: W / 2, rot: 0, ax: 'x' }, { len: L, z: -W / 2, rot: Math.PI, ax: 'x' },
    { len: W, z: L / 2, rot: Math.PI / 2, ax: 'z' }, { len: W, z: -L / 2, rot: -Math.PI / 2, ax: 'z' },
  ];
  const litRate = small ? 0.22 : 0.13;
  faces.forEach((f, fi) => {
    const n = Math.max(1, Math.floor((f.len - 20) / 34));
    const step = (f.len - 20) / n;
    const doorAt = fi === 0 ? Math.floor(n / 2) : -1;
    for (let fl = 0; fl < floors; fl++) {
      const y = 22 + fl * floorH + 16;
      for (let i = 0; i < n; i++) {
        const t = -f.len / 2 + 10 + (i + 0.5) * step;
        const lx = f.ax === 'x' ? t : Math.sign(f.z) * (Math.abs(f.z) + 0.4);
        const lz = f.ax === 'x' ? Math.sign(f.z) * (Math.abs(f.z) + 0.4) : -t * Math.sign(f.z);
        if (fl === 0 && i === doorAt) {
          B.add('matte', T.plane(), [lx, 19, lz], [16, 38, 1], [0, f.rot, 0], '#2a1e16');
          B.add('glow', T.plane(), [f.ax === 'x' ? lx : lx * 1.001, 41, f.ax === 'x' ? lz * 1.001 : lz], [8, 3, 1], [0, f.rot, 0], '#ffd79a', { emissive: 1.6, uv: atlasUV('white') });
          continue;
        }
        const lit = hash01(o.id * 131 + fi * 37 + fl * 11 + i) < litRate;
        if (lit) {
          const cell = hash01(o.id + i * 3 + fl) < 0.3 ? 'winCool' : hash01(o.id * 7 + i) < 0.3 ? 'winDim' : 'win';
          B.add('glow', T.plane(), [lx, y, lz], [15, 22, 1], [0, f.rot, 0], '#ffffff', { emissive: cell === 'winDim' ? 0.9 : 0.8, uv: atlasUV(cell) });
        } else {
          const boarded = hash01(o.id * 53 + i + fl * 5) < 0.15;
          B.add(boarded ? 'matte' : 'glass', T.plane(), [lx, y, lz], [15, 22, 1], [0, f.rot, 0], boarded ? '#5a4632' : GLASS);
        }
      }
    }
  });
  if (small) {
    // pitched roof along the long side
    const long = L >= W;
    const span = long ? W : L, len = long ? L : W;
    const pts = [[-span / 2 - 6, 0], [span / 2 + 6, 0], [0, 50]];
    B.add('matte', T.profile('roof' + span, pts), [0, wallH, 0], [1, 1, len + 10], [0, long ? Math.PI / 2 : 0, 0], o.roof || '#4e4a45');
    B.cyl('matte', L * 0.25, wallH + 20, 0, 6, 42, shadeHex(color, -0.25), 6);
  } else {
    // flat roof with parapet and plant
    B.block('matte', 0, wallH, 0, L - 6, 1, W - 6, o.roof || '#4e4a45');
    for (const s of [-1, 1]) {
      B.block('matte', 0, wallH, s * (W / 2 - 2), L, 7, 4, shadeHex(color, -0.1));
      B.block('matte', s * (L / 2 - 2), wallH, 0, 4, 7, W, shadeHex(color, -0.1));
    }
    const nAC = 1 + Math.floor(r.next() * 3);
    for (let i = 0; i < nAC; i++) B.block('paint', r.range(-L * 0.3, L * 0.3), wallH + 1, r.range(-W * 0.25, W * 0.25), 22, 12, 16, '#8e9294');
    if (r.chance(0.5)) B.block('matte', r.range(-L * 0.3, L * 0.3), wallH + 1, r.range(-W * 0.2, W * 0.2), 26, 20, 26, shadeHex(color, -0.15));
  }
  // an outside wall lamp over the door
  B.box('glow', 0, 50, W / 2 + 2, 6, 3, 3, '#ffd79a', null, { emissive: 2, uv: atlasUV('white') });
}

function pump(B, L, W, color) {
  B.block('matte', 0, 0, 0, L + 4, 6, W + 8, CONCRETE);
  B.block('paint', 0, 6, 0, L * 0.7, 44, W * 0.62, color);
  B.block('paint', 0, 50, 0, L * 0.8, 4, W * 0.7, shadeHex(color, -0.25));
  for (const s of [-1, 1]) {
    B.add('glow', T.plane(), [s * (L * 0.35 + 0.3), 38, 0], [W * 0.4, 9, 1], [0, s * Math.PI / 2, 0], '#ffffff', { emissive: 1.1, uv: atlasUV('pump') });
    B.box('paint', s * (L * 0.35 + 1.2), 24, W * 0.18, 2, 10, 4, '#1a1a1a');
    B.cyl('matte', s * (L * 0.35 + 2), 8, W * 0.2, 1, 16, '#111', 5);
  }
}

function pillar(B, L, W, color) {
  B.block('matte', 0, 0, 0, L + 6, 8, W + 6, CONCRETE);
  B.block('paint', 0, 8, 0, L * 0.8, 142, W * 0.8, color);
}

/** Canopy slabs over clusters of forecourt pillars (called once for all pillars). */
function buildCanopies(B, map) {
  const pillars = map.obstacles.filter((o) => o.kind === 'pillar');
  const used = new Set();
  for (const p of pillars) {
    if (used.has(p)) continue;
    const group = [p];
    used.add(p);
    for (let k = 0; k < group.length; k++) {
      for (const q of pillars) {
        if (!used.has(q) && Math.hypot(q.x - group[k].x, q.y - group[k].y) < 420) { used.add(q); group.push(q); }
      }
    }
    if (group.length < 2) continue;
    const xs = group.map((g) => g.x), ys = group.map((g) => g.y);
    const x0 = Math.min(...xs) - 70, x1 = Math.max(...xs) + 70, y0 = Math.min(...ys) - 70, y1 = Math.max(...ys) + 70;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    B.obj(cx, cy, 0, 4242);
    B.block('paint', 0, 150, 0, w, 16, h, '#dcd8cc');
    for (const s of [-1, 1]) {
      B.box('paint', 0, 158, s * (h / 2 + 0.6), w + 1, 12, 1, '#b3261e');
      B.box('paint', s * (w / 2 + 0.6), 158, 0, 1, 12, h + 1, '#b3261e');
      B.box('paint', 0, 152, s * (h / 2 + 0.7), w + 1, 2, 1, '#1f4f8a');
    }
    // light panels under the canopy
    for (let x = -w / 2 + 50; x < w / 2 - 20; x += 90) {
      for (let y = -h / 2 + 50; y < h / 2 - 20; y += 90) B.box('glow', x, 149.6, y, 30, 0.6, 12, '#f2f6ff', null, { emissive: 1.8, uv: atlasUV('white') });
    }
  }
}

function tent(B, L, W, color, roof) {
  const pts = [[-W / 2, 0], [W / 2, 0], [W / 2, 34], [0, 80], [-W / 2, 34]];
  B.add('matte', T.profile('tent' + W, pts), [0, 0, 0], [1, 1, L], [0, Math.PI / 2, 0], roof || color);
  B.box('matte', L / 2 + 0.4, 22, 0, 0.6, 44, W * 0.3, '#1c1f14');
  B.box('matte', -L / 2 - 0.4, 22, 0, 0.6, 44, W * 0.3, '#1c1f14');
  // warm light spilling out of the door
  B.add('glow', T.plane(), [L / 2 + 0.8, 20, 0], [W * 0.22, 36, 1], [0, Math.PI / 2, 0], '#ffcf8a', { emissive: 0.55, uv: atlasUV('white') });
  for (const s of [-1, 1]) B.cyl('matte', 0, 0, s * (W / 2 + 12), 1.2, 12, '#3a3a2a', 4);
}

function booth(B, L, W, color, roof) {
  B.block('matte', 0, 0, 0, L, 40, W, color);
  B.block('glow', 0, 40, 0, L - 2, 32, W - 2, '#ffffff', null, { emissive: 0.55, uv: atlasUV('winCool') });
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('matte', (x * (L - 3)) / 2, 40, (z * (W - 3)) / 2, 3.5, 34, 3.5, shadeHex(color, -0.2));
  B.block('matte', 0, 74, 0, L + 10, 5, W + 10, roof || '#44493c');
  B.block('matte', 0, 79, 0, L - 4, 11, W - 4, shadeHex(color, -0.1));
  B.box('blink', 0, 92, 0, 4, 4, 4, '#ff3a2a');
}

function trunk(B, size, o) {
  const r = B.rng;
  const rad = size * 0.28;
  B.cyl('matte', 0, 0, 0, rad, 96, o.color || '#4a3826', 7, 0.55, null, { wobble: { amp: 0.08, seed: o.id } });
  B.cyl('matte', 0, 0, 0, rad * 1.4, 8, shadeHex(o.color || '#4a3826', -0.2), 7, 0.7);
  // a branch or two
  for (let i = 0; i < 2; i++) {
    const a = r.range(0, 6.28);
    B.add('matte', T.cyl(5, 0.4), [Math.cos(a) * rad, 70 + i * 14, Math.sin(a) * rad], [rad * 0.4, 40, rad * 0.4], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], o.color || '#4a3826');
  }
}

/** Canopies for every 'tree_canopy' decor (centred on the trunk). */
function canopy(B, d, i) {
  const R = 40 * (d.s || 1);
  const r = B.rng;
  const pine = hash01(i * 7 + 3) < 0.4;
  if (pine) {
    const top = 200 + R * 1.3;
    const layers = 4;
    for (let k = 0; k < layers; k++) {
      const t = k / layers;
      const y0 = 60 + t * (top - 110);
      const rad = R * (1.05 - t * 0.7);
      B.cyl('matte', 0, y0, 0, rad, 90 - t * 30, r.pick(PINE), 7, 0.08, null, { wobble: { amp: 0.12, seed: i * 5 + k } });
    }
  } else {
    const n = 4 + Math.floor(r.next() * 3);
    const top = 170 + R * 1.2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.28 + r.range(0, 0.8);
      const dd = k === 0 ? 0 : R * r.range(0.35, 0.6);
      const rad = R * (k === 0 ? 0.75 : r.range(0.45, 0.62));
      const y = k === 0 ? top - rad * 0.9 : r.range(100 + rad * 0.5, top - rad);
      B.add('matte', T.ico(1), [Math.cos(a) * dd, y, Math.sin(a) * dd], [rad, rad * 0.78, rad], [0, r.range(0, 3), 0], r.pick(LEAF), { wobble: { amp: 0.22, seed: i * 11 + k } });
    }
  }
}

function rock(B, L, W, color, H) {
  B.add('matte', T.dodeca(), [0, H * 0.32, 0], [L * 0.52, H * 0.75, W * 0.52], [0, B.rng.range(0, 6), 0], color, { wobble: { amp: 0.28, seed: Math.floor(B.rng.next() * 1000) } });
  B.add('matte', T.dodeca(), [L * 0.25, H * 0.15, W * 0.2], [L * 0.25, H * 0.4, W * 0.25], [0.3, 1, 0], shadeHex(color, -0.1), { wobble: { amp: 0.3, seed: 7 } });
}

// ---- objective / supply -----------------------------------------------------------------------

function buildObjective(B, ob, halos) {
  const L = ob.w, W = ob.h;
  switch (ob.kind) {
    case 'bus': {
      bus(B, L, W, '#e3a41a', false, true, 1);
      // hazard flashers
      for (const x of [-1, 1]) for (const z of [-1, 1]) B.box('blink', (x * L) / 2 + x * 0.4, 88, (z * W) / 2 * 0.8, 1, 4, 5, '#ffae2a', null, null);
      B.box('paint', 0, 101.5, 0, 50, 3, 30, '#d19514');
      break;
    }
    case 'diner': diner(B, L, W, halos, ob); break;
    case 'apc': apc(B, L, W); break;
    case 'radio': radio(B, L, W, halos, ob); break;
    default: B.block('paint', 0, 0, 0, L, 80, W, '#888');
  }
}

function diner(B, L, W, halos, ob) {
  const H = 96;
  B.block('matte', 0, 0, 0, L + 4, 10, W + 4, '#6a5f55');
  B.block('paint', 0, 10, 0, L, H - 10, W, '#d9d0bd');
  B.box('paint', 0, 22, W / 2 + 0.6, L, 8, 1, '#a51f25');
  B.box('paint', 0, 22, -W / 2 - 0.6, L, 8, 1, '#a51f25');
  B.box('paint', 0, 84, W / 2 + 0.7, L, 5, 1, CHROME);
  // front windows (+z = sim +y side, where the neon sign light is)
  const n = 5;
  const span = L * 0.8;
  for (let i = 0; i < n; i++) {
    const x = -span / 2 + ((i + 0.5) * span) / n;
    if (i === 2) {
      B.add('glow', T.plane(), [x, 30, W / 2 + 0.8], [24, 44, 1], null, '#fff0c8', { emissive: 1.1, uv: atlasUV('win') });
      continue;
    }
    B.add('glow', T.plane(), [x, 52, W / 2 + 0.8], [span / n - 6, 40, 1], null, '#ffffff', { emissive: 1.05, uv: atlasUV('dinerWin') });
  }
  for (let i = 0; i < 3; i++) B.add('glow', T.plane(), [-L / 4 + (i * L) / 4, 55, -W / 2 - 0.8], [30, 30, 1], [0, Math.PI, 0], '#ffffff', { emissive: 0.8, uv: atlasUV('win') });
  // awning
  B.add('paint', T.profile('awning', [[0, 0], [22, -10], [22, -8], [0, 2]]), [0, 80, W / 2], [1, 1, span + 20], [0, -Math.PI / 2, 0], '#b3261e');
  // roof, parapet, neon sign on posts
  B.block('matte', 0, H, 0, L - 4, 2, W - 4, '#4a4744');
  B.block('paint', 0, H, W / 2 - 2, L + 2, 8, 4, '#c8c0b0');
  for (const x of [-60, 60]) B.block('paint', x, H + 2, W / 2 - 16, 4, 30, 4, '#333');
  B.box('paint', 0, H + 46, W / 2 - 16, 170, 44, 6, '#1a0c12');
  B.add('neon', T.plane(), [0, H + 46, W / 2 - 12.8], [164, 40, 1], null, '#ffffff', { emissive: 1.6, uv: atlasUV('neonDiner') });
  B.add('neon', T.plane(), [0, H + 46, W / 2 - 19.2], [164, 40, 1], [0, Math.PI, 0], '#ffffff', { emissive: 1.4, uv: atlasUV('neonDiner') });
  // "EAT" blade sign on the corner
  B.box('paint', L / 2 + 20, 70, W / 2 - 10, 4, 34, 60, '#1a0c12');
  B.add('neon', T.plane(), [L / 2 + 22.2, 70, W / 2 - 10], [56, 30, 1], [0, Math.PI / 2, 0], '#ffffff', { emissive: 1.6, uv: atlasUV('neonEat') });
  B.add('neon', T.plane(), [L / 2 + 17.8, 70, W / 2 - 10], [56, 30, 1], [0, -Math.PI / 2, 0], '#ffffff', { emissive: 1.6, uv: atlasUV('neonEat') });
  B.block('paint', L * 0.2, H + 2, -W * 0.2, 26, 14, 20, '#8e9294');
  const c = Math.cos(ob.a || 0), s = Math.sin(ob.a || 0);
  const wx = (lx, lz) => ob.x + lx * c - lz * s, wy = (lx, lz) => ob.y + lx * s + lz * c;
  halos.push({ x: wx(0, W / 2 - 10), y: wy(0, W / 2 - 10), h: H + 46, color: '#ff3d8b', size: 260, strength: 0.35 });
  halos.push({ x: wx(L / 2 + 20, W / 2 - 10), y: wy(L / 2 + 20, W / 2 - 10), h: 70, color: '#ff7a1a', size: 120, strength: 0.3 });
}

function apc(B, L, W) {
  const olive = '#434a22';
  const dark = shadeHex(olive, -0.25);
  // welded hull: sloped glacis, flat deck, sloped rear; side skirts over the wheels
  B.prism('paint', 'apc-hull', P(L, [[-0.5, 16], [0.5, 16], [0.5, 30], [0.3, 55], [-0.44, 58], [-0.5, 48]]), 0, W * 0.9, olive);
  B.prism('paint', 'apc-upper', P(L, [[-0.42, 57], [0.26, 55.5], [0.2, 60], [-0.38, 61]]), 0, W * 0.72, shadeHex(olive, 0.04));
  for (const s of [-1, 1]) {
    B.box('paint', 0, 33, s * (W * 0.47), L * 0.86, 12, 2, dark, [s * 0.12, 0, 0]);
    B.box('paint', -0.1 * L, 50, s * (W * 0.42), 16, 8, 3, dark);          // stowage boxes
    B.box('paint', 0.18 * L, 50, s * (W * 0.42), 12, 7, 3, dark);
    B.box('glass', 0.3 * L, 50, s * W * 0.3, 3, 4, 8, GLASS, [0, 0, 0.6]);   // vision blocks
  }
  const xs = [-0.36, -0.12, 0.12, 0.36].map((v) => v * L);
  wheelsAt(B, xs, W, 13, 11, false);
  // turret + gun
  B.cyl('paint', -0.06 * L, 60, 0, 17, 12, shadeHex(olive, 0.06), 8, 0.85);
  B.box('paint', 0.02 * L, 67, 0, 16, 9, 14, shadeHex(olive, 0.02));
  B.cylX('paint', 0.22 * L, 67, 0, 2.2, 0.5 * L, '#23251c', 6);
  B.cylX('paint', 0.46 * L, 67, 0, 3.2, 8, '#23251c', 6);
  // open rear hatch with the crew's blue work light inside
  B.box('paint', -0.34 * L, 64, W * 0.2, 16, 2, 16, dark, [0, 0, 0.9]);
  B.box('glow', -0.34 * L, 61.2, 0, 14, 0.5, 14, '#a8d8ff', null, { emissive: 1.4, uv: atlasUV('white') });
  for (const s of [-1, 1]) B.box('paint', 0.02 * L, 42, s * (W * 0.47 + 1.2), 9, 9, 0.4, '#c9c9b8', [s * 0.12, 0, 0]);   // markings
  B.box('glow', 0.5 * L + 0.4, 26, W * 0.33, 1, 3, 6, '#ffe7b0', null, { emissive: 1.1, uv: atlasUV('white') });
  B.box('glow', 0.5 * L + 0.4, 26, -W * 0.33, 1, 3, 6, '#ffe7b0', null, { emissive: 1.1, uv: atlasUV('white') });
  B.cyl('paint', -0.4 * L, 60, -W * 0.3, 0.8, 80, '#222', 4);   // radio whip
  B.add('soft', T.cyl(8), [-0.48 * L, 40, 0], [7, W * 0.6, 7], [Math.PI / 2, 0, 0], '#3a3a2a');   // spare wheel / rolled tarp
}

function beam(B, bucket, x0, y0, z0, x1, y1, z1, rad, color) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  B.add(bucket, T.cyl(4), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [rad, len, rad], [e.x, e.y, e.z], color);
}

function radio(B, L, W, halos, ob) {
  // equipment hut and a lattice mast with blinking red beacons
  B.block('matte', 0, 0, 0, L * 0.9, 58, W * 0.9, '#8d8a80');
  B.block('matte', 0, 58, 0, L * 0.96, 4, W * 0.96, '#5d5a52');
  B.add('matte', T.plane(), [0, 20, W * 0.45 + 0.4], [14, 38, 1], null, '#39352c');
  B.box('glow', 0, 44, W * 0.45 + 1, 5, 3, 2, '#ffd9a0', null, { emissive: 2, uv: atlasUV('white') });
  const top = 540;
  const w0 = L * 0.34, w1 = 8;
  const corner = (y) => w0 + (w1 - w0) * ((y - 62) / (top - 62));
  const col = '#9a9ea2';
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, 'paint', sx * w0, 62, sz * w0, sx * w1, top, sz * w1, 2, col);
  let lvl = 0;
  for (let y = 62; y < top - 30; y += 48, lvl++) {
    const y2 = Math.min(top, y + 48);
    const a = corner(y), b = corner(y2);
    for (const [px, pz, qx, qz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      beam(B, 'paint', px * a, y, pz * a, qx * b, y2, qz * b, 0.9, col);
      beam(B, 'paint', px * a, y, pz * a, qx * a, y, qz * a, 0.9, col);
    }
  }
  B.cyl('paint', 0, top, 0, 1.5, 60, col, 5);
  // dishes and antennas
  B.add('paint', T.cyl(10, 1), [corner(300) + 6, 300, 0], [14, 4, 14], [0, 0, Math.PI / 2], '#d8d8d0');
  B.add('paint', T.cyl(10, 1), [0, 380, -corner(380) - 5], [10, 3, 10], [Math.PI / 2, 0, 0], '#d8d8d0');
  const c = Math.cos(ob.a || 0), s = Math.sin(ob.a || 0);
  for (const y of [200, 380, top + 60]) {
    const k = corner(Math.min(y, top));
    for (const [sx, sz] of y > top ? [[0, 0]] : [[-1, -1], [1, 1]]) {
      B.add('blink', T.sphere(6, 4), [sx * k, y, sz * k], [3.5, 3.5, 3.5], null, '#ff2a1a', { emissive: 1.8 });
      halos.push({ x: ob.x + sx * k * c - sz * k * s, y: ob.y + sx * k * s + sz * k * c, h: y, color: '#ff2a1a', size: 90, blink: 1, strength: 0.8 });
    }
  }
}

function buildSupply(B, sp, flags, halos) {
  const r = B.rng;
  B.block('matte', 0, 0, 0, 64, 5, 46, WOOD);
  for (let i = 0; i < 4; i++) B.box('matte', -24 + i * 16, 5.5, 0, 12, 1, 46, shadeHex(WOOD, -0.15));
  const crates = [[-16, -10, 24], [12, -10, 22], [-2, 12, 20]];
  for (const [x, z, s] of crates) {
    B.block('matte', x, 5, z, s, s, s, '#7a5a32', [0, r.range(-0.2, 0.2), 0]);
    B.box('matte', x, 5 + s / 2, z + s / 2 + 0.3, s + 0.5, 3, 0.8, '#5b4124');
  }
  B.block('matte', -16, 29, -10, 18, 16, 18, '#86653a', [0, 0.3, 0]);
  // ammo boxes with a yellow stencil band
  for (let i = 0; i < 3; i++) {
    B.block('paint', 22 + (i % 2) * 2, 5 + i * 9, 12, 20, 9, 12, '#4b5320', [0, 0.1 * i, 0]);
    B.box('paint', 22 + (i % 2) * 2, 9.5 + i * 9, 18.2, 12, 2, 0.5, '#d8b43a');
  }
  // work light on a tripod
  const lx = 36, lz = -26, lh = 92;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * 6.28;
    beam(B, 'paint', lx + Math.cos(a) * 16, 0, lz + Math.sin(a) * 16, lx, lh - 10, lz, 1, '#2a2a2a');
  }
  B.cyl('paint', lx, lh - 12, lz, 1.4, 14, '#2a2a2a', 5);
  B.box('paint', lx, lh, lz, 14, 10, 7, '#e0b020', [0.4, 0.8, 0]);
  B.box('glow', lx - 2, lh - 2, lz + 3, 11, 7, 0.6, '#fff4d8', [0.4, 0.8, 0], { emissive: 2.5, uv: atlasUV('white') });
  // flag
  const fx = -30, fz = 24;
  B.cyl('paint', fx, 0, fz, 1.6, 150, '#9a9ea2', 6);
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
  const r = B.rng;
  switch (d.kind) {
    case 'tree_canopy': canopy(B, d, i); break;
    case 'bush': {
      const R = 14 * s;
      const n = 2 + (i % 2);
      for (let k = 0; k < n; k++) {
        B.add('matte', T.ico(0), [r.range(-R * 0.4, R * 0.4), R * 0.5, r.range(-R * 0.4, R * 0.4)], [R * r.range(0.6, 0.85), R * r.range(0.55, 0.8), R * r.range(0.6, 0.85)], [0, r.range(0, 6), 0], r.pick(LEAF), { wobble: { amp: 0.2, seed: i + k } });
      }
      break;
    }
    case 'rock': {
      const R = 6 * s;
      B.add('matte', T.dodeca(), [0, R * 0.25, 0], [R, R * 0.7, R * 0.85], [0, r.range(0, 6), 0], r.pick(['#6d6a63', '#77726a', '#5f5b55']), { wobble: { amp: 0.3, seed: i } });
      break;
    }
    case 'cone': {
      const R = 6 * s;
      if (r.chance(0.3)) {
        B.add('paint', T.cyl(8, 0.18), [0, R * 0.8, 0], [R, R * 3, R], [0, r.range(0, 6), Math.PI / 2], '#e8641c');
      } else {
        B.block('matte', 0, 0, 0, R * 2.1, 1.5, R * 2.1, '#1c1c1c');
        B.cyl('paint', 0, 1.5, 0, R * 0.95, R * 3, '#e8641c', 8, 0.18);
        B.cyl('paint', 0, R * 1.6, 0, R * 0.62, R * 0.55, '#f0f0f0', 8, 0.85);
      }
      break;
    }
    case 'tire': {
      const R = 7.5 * s;
      const stack = r.chance(0.35) ? 2 : 1;
      for (let k = 0; k < stack; k++) B.add('soft', T.torus(10, 0.42), [k * 2, R * 0.42 + k * R * 0.84, 0], [R, R, R], [Math.PI / 2, 0, 0], TIRE);
      break;
    }
    case 'rubble': {
      const R = 22 * s;
      for (let k = 0; k < 11; k++) {
        const sz = r.range(3, 9) * s;
        B.add('matte', r.chance(0.5) ? T.box() : T.dodeca(), [r.range(-R, R) * 0.8, sz * 0.3, r.range(-R, R) * 0.7], [sz * r.range(1, 2), sz, sz * r.range(0.8, 1.5)], [r.range(0, 1), r.range(0, 6), r.range(0, 1)], r.pick(['#7a766e', '#5f5b54', '#8d887d', '#6b5a48']));
      }
      if (r.chance(0.5)) B.add('paint', T.cyl(4), [0, 4, 0], [0.8, R * 1.6, 0.8], [0, r.range(0, 3), 1.3], '#6a4a38');
      break;
    }
    case 'lamp_post': {
      const flood = s > 1.1;
      const H = 230 * s;
      const lit = !!light;
      if (flood) {
        // floodlight mast: pole with a bank of four lamps angled down
        B.cyl('paint', 0, 0, 0, 3.2, H, POLE, 6, 0.7);
        B.block('matte', 0, 0, 0, 12, 6, 12, CONCRETE);
        B.box('paint', 0, H, 0, 34, 3, 4, POLE);
        for (const x of [-12, 0, 12]) {
          B.box('paint', x, H - 5, 3, 10, 9, 5, '#2a2c2e', [0.6, 0, 0]);
          if (lit) B.box('glow', x, H - 7, 5.4, 8.5, 7, 0.5, '#f4f8ff', [0.6, 0, 0], { emissive: 2.6, uv: atlasUV('white') });
        }
        if (lit) {
          halos.push({ x: d.x, y: d.y, h: H - 6, color: light.color, size: 150, strength: 0.7 });
          shafts.push({ x: d.x, y: d.y, h: H - 8, color: light.color, radius: Math.min(170, light.r * 0.55), strength: 0.8 });
        }
        break;
      }
      // pole foot is 16 behind the head (the top-down convention), arm reaches out
      B.cyl('paint', -16, 0, 0, 2.6, H - 4, POLE, 6, 0.7);
      B.block('paint', -16, 0, 0, 7, 10, 7, '#2a2d30');
      B.box('paint', -7, H - 4, 0, 20, 2.2, 2.2, POLE, [0, 0, -0.08]);
      B.box('paint', 3, H - 4, 0, 16, 4.5, 8, '#3a3d40');
      if (lit) {
        B.box('glow', 3, H - 6.6, 0, 12, 0.6, 6, light.color, null, { emissive: 2.8, uv: atlasUV('white') });
        const wx = d.x + Math.cos(d.a || 0) * 3, wy = d.y + Math.sin(d.a || 0) * 3;
        halos.push({ x: wx, y: wy, h: H - 9, color: light.color, size: 110, strength: 0.75 });
        shafts.push({ x: wx, y: wy, h: H - 8, color: light.color, radius: Math.min(120, light.r * 0.42), strength: 1 });
      } else {
        B.box('paint', 3, H - 6.6, 0, 12, 0.6, 6, '#50545a');
      }
      break;
    }
    case 'sign': {
      const Ls = 44 * s;
      for (const x of [-Ls * 0.35, Ls * 0.35]) B.cyl('paint', x, 0, 0, 1.6, 70, '#7a7e82', 5);
      B.box('paint', 0, 64, -0.6, Ls, 24, 1.2, '#b0b4b8');
      B.add('glow', T.plane(), [0, 64, 0.1], [Ls - 1, 23, 1], null, '#ffffff', { emissive: 0.32, uv: atlasUV('sign') });
      break;
    }
    case 'grass_tuft': {
      // a few thin blades (double-sided triangles): near-field detail on the fields
      const n = 4 + (i % 4);
      for (let k = 0; k < n; k++) {
        const h = r.range(7, 15) * s;
        B.add('matte', T.blade(), [r.range(-5, 5) * s, 0, r.range(-5, 5) * s], [r.range(1.6, 2.6), h, 1], [r.range(-0.35, 0.35), r.range(0, 6.28), r.range(-0.35, 0.35)], r.pick(GRASS), { noAO: true });
      }
      break;
    }
    case 'flag': {
      B.cyl('paint', 0, 0, 0, 1.4, 130 * s, '#8a8e92', 6);
      flags.push({ x: d.x, y: d.y, h: 128 * s, L: 32 * s, H: 20 * s, s, color: ['#8a1c1c', '#1c3a8a', '#e3e3e3', '#2e5d2e'][Math.floor(hash01(i) * 4)], ph: hash01(i + 3) * 6 });
      break;
    }
    default:
      break;
  }
}

// ---- tree line past the map bounds ---------------------------------------------------------------

function buildTreeLine(B, map, waters) {
  const W = map.width, H = map.height;
  const rng = seededRng((map.seed | 0) * 7 + 99);
  // keep road corridors open where roads leave the map
  const corridors = [];
  for (const a of map.areas) {
    if (a.kind !== 'asphalt' && a.kind !== 'concrete' && a.kind !== 'gravel') continue;
    const hw = a.w / 2, hh = a.h / 2;
    if (a.x - hw <= 2 || a.x + hw >= W - 2 || a.y - hh <= 2 || a.y + hh >= H - 2) {
      corridors.push({ x0: a.x - hw - 50, x1: a.x + hw + 50, y0: a.y - hh - 50, y1: a.y + hh + 50, ex: a.x - hw <= 2 || a.x + hw >= W - 2, ey: a.y - hh <= 2 || a.y + hh >= H - 2 });
    }
  }
  const blocked = (x, y) => {
    for (const c of corridors) {
      if (c.ex && y > c.y0 && y < c.y1) return true;
      if (c.ey && x > c.x0 && x < c.x1) return true;
    }
    for (const w of waters) if (x > w.x0 - 30 && x < w.x1 + 30 && y > w.y0 - 30 && y < w.y1 + 30) return true;
    return false;
  };
  // sandy ground (red above green) = desert: rock formations and dead trees, no forest
  const gc = lin(map.ground);
  const desert = gc.r > gc.g * 1.05;
  const place = (x, y, dist) => {
    if (blocked(x, y)) return;
    // one merged strip per map side: 2–3 draw calls for the whole tree line
    B.setCell(y < 0 ? 'tl-n' : y > H ? 'tl-s' : x < 0 ? 'tl-w' : 'tl-e');
    B.obj(x, y, rng.range(0, 6.28), Math.floor(rng.next() * 1e6));
    B.setCell(null);
    if (desert) {
      const roll = rng.next();
      if (roll < 0.45 && dist > 200) {
        // weathered rock outcrop, bigger further out (buttes on the horizon)
        const big = dist > 450 ? rng.range(1.6, 3) : rng.range(0.6, 1.3);
        const rc = rng.pick(['#5e4a38', '#6b5642', '#54443a', '#735c44']);
        B.add('matte', T.dodeca(), [0, 30 * big, 0], [70 * big, 70 * big * rng.range(0.6, 1.1), 55 * big], [0, rng.range(0, 6), 0], rc, { wobble: { amp: 0.3, seed: Math.floor(roll * 999) } });
        B.add('matte', T.dodeca(), [40 * big, 12 * big, 20 * big], [36 * big, 30 * big, 30 * big], [0.4, 1, 0], rc, { wobble: { amp: 0.3, seed: 5 } });
      } else if (roll < 0.62) {
        // dead tree: bare trunk and a few crooked limbs
        const s = rng.range(0.8, 1.4);
        B.cyl('matte', 0, 0, 0, 5 * s, 110 * s, '#3a2e24', 5, 0.4);
        for (let k = 0; k < 3; k++) {
          const a = rng.range(0, 6.28);
          B.add('matte', T.cyl(4, 0.3), [Math.cos(a) * 8 * s, (60 + k * 16) * s, Math.sin(a) * 8 * s], [3 * s, 50 * s, 3 * s], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], '#3a2e24');
        }
      } else if (roll < 0.8) {
        B.add('matte', T.ico(0), [0, 8, 0], [16, 10, 16], [0, rng.range(0, 6), 0], rng.pick(['#4a4a2a', '#5a5230', '#3e4426']), { wobble: { amp: 0.25, seed: 3 } });
      }
      return;
    }
    const s = rng.range(0.8, 1.5);
    B.cyl('matte', 0, 0, 0, 5 * s, 60 * s, '#2a2118', 5);
    const top = rng.range(220, 330) * s;
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      B.cyl('matte', 0, 40 * s + t * (top - 120 * s), 0, (48 - t * 26) * s, 110 * s * (1 - t * 0.3), rng.pick(PINE), 6, 0.05);
    }
  };
  const band = [60, 700];
  const step = 58;
  for (let x = -band[1]; x < W + band[1]; x += step) {
    for (const edge of [0, 1]) {
      for (let row = 0; row < 3; row++) {
        const dist = band[0] + row * 150 + rng.range(0, 150);
        const y = edge ? H + dist : -dist;
        place(x + rng.range(-20, 20), y, dist);
      }
    }
  }
  for (let y = 0; y < H; y += step) {
    for (const edge of [0, 1]) {
      for (let row = 0; row < 3; row++) {
        const dist = band[0] + row * 150 + rng.range(0, 150);
        place(edge ? W + dist : -dist, y + rng.range(-20, 20), dist);
      }
    }
  }
}
