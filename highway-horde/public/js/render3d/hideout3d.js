// The living part of a story hideout (SPEC §3.10), a renderer3d sub-system created only when the
// map is a hideout (ctx.hideout is set by world.js): smoke from chimneys and the fire ring,
// sparks at the workbench, fireflies and moths round the lamps, station highlights, the
// searchlight of the watchtower, spinning things (windmill, radar dish), a flock of chickens,
// the range's straw dummies with their damage numbers.
//
// Everything cheap: particles and glows go through the shared fx pools (fx-core.js), the
// dummies and spinners are a handful of merged meshes, the flock is one InstancedMesh.

import * as THREE from 'three';
import { acquireFx, releaseFx, F_ADD, F_FLICKER, F_SHRINK, F_BOUNCE, FR } from './fx-core.js';
import { createGeoBuilder, T, shadeHex } from './world-geo.js';
import { tierAtLeast } from './tier.js';
import { DET } from './world-surf.js';

const TAU = Math.PI * 2;

const STATION_COLOR = {
  board: '#ffc860', workbench: '#ff9a48', armory: '#9adf7a', infirmary: '#ff7a70',
  upgrades: '#ffe27a', bed: '#8ab8ff', range: '#f4f0e0', campfire: '#ff9a4a',
};

/** Merge a builder's std output into one mesh with vertex colours. */
function meshFromBuilder(B, mat) {
  const parts = B.finish();
  if (!parts.length) return null;
  const g = parts[0].geometry;
  if (parts.length > 1) {
    // (all pieces are 'std'; anything else is dropped)
  }
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function newStdBuilder() {
  return createGeoBuilder({ cell: 1e6, buckets: { std: { det: false, ao: false } } });
}

/** A target dummy: a plywood man-shaped silhouette with painted rings, on a stand with a sandbag foot, facing local +x. */
function buildDummy(B) {
  B.obj(0, 0, 0, 7);
  B.setJitter(0.04);
  const wood = '#6a4a2c';
  const sil = [[-9, 8], [9, 8], [10, 24], [14, 32], [15, 38], [8, 41], [5.5, 44], [5.5, 51], [0, 55], [-5.5, 51], [-5.5, 44], [-8, 41], [-15, 38], [-14, 32], [-10, 24]];
  // the stand: a base plank, two uprights, a sandbag foot and a strap of rope
  B.box('std', -2, 2.4, 0, 16, 4.8, 30, wood);
  for (const s of [-1, 1]) B.box('std', -3, 24, s * 6, 3, 44, 3.4, wood);
  B.add('std', T.pillow(10, 6, 0.5), [-2, 5.6, 14], [8, 3.4, 6], [0, 0.4, 0], '#8a7a55');
  B.add('std', T.pillow(10, 6, 0.5), [-2, 5.6, -14], [8, 3.4, 6], [0, -0.3, 0], '#7c6c4a');
  // the board: a dark backing outline and the cream face, cut out in the shape of a man
  B.add('std', T.profile('dummysil', sil, 0, 1), [0, -0.5, 0], [1.09, 1.03, 2.4], [0, Math.PI / 2, 0], '#1e1a16');
  B.add('std', T.profile('dummysil', sil, 0, 1), [1.2, 0, 0], [1, 1, 2.0], [0, Math.PI / 2, 0], '#d9d0b0');
  // scoring rings on the chest, the red centre, a head zone in black
  const ring = (r, c, x) => B.cyl('std', x, 31, 0, r, 0.5, c, 16, 1, [0, 0, Math.PI / 2]);
  ring(9.4, '#1e1a16', 2.6);
  ring(8.2, '#f4f0e0', 2.8);
  ring(6.2, '#1e1a16', 3.0);
  ring(5.0, '#f4f0e0', 3.2);
  ring(3.4, '#c62828', 3.4);
  ring(1.4, '#f4f0e0', 3.6);
  B.cyl('std', 2.8, 48, 0, 3.6, 0.5, '#1e1a16', 12, 1, [0, 0, Math.PI / 2]);
  // a few old bullet holes are the gunsmith's problem; a peeling strip of tape on the shoulder
  B.box('std', 2.6, 37, 8, 0.4, 1.6, 6, '#e0b020');
}

/** One chicken (white; the instance colour tints it), facing +x, standing on y = 0. */
function buildChicken(B) {
  B.obj(0, 0, 0, 3);
  B.setJitter(0);
  const white = '#f2eee4';
  B.add('std', T.sphere(10, 8), [0, 6.4, 0], [5.2, 4.6, 3.8], [0, 0, 0.18], white);
  B.add('std', T.sphere(8, 6), [4.6, 10.6, 0], [2.3, 2.7, 2.1], null, white);
  B.add('std', T.cyl(4, 0.05), [7, 10.2, 0], [0.8, 2.2, 0.8], [0, 0, -Math.PI / 2], '#e0a020');
  B.add('std', T.dodeca(), [4.6, 13.2, 0], [1.4, 1.1, 0.5], null, '#c62828');
  B.add('std', T.sphere(5, 4), [6.3, 8.8, 0], [0.7, 1.1, 0.5], null, '#c62828');
  for (let k = -1; k <= 1; k++) B.add('std', T.box(), [-4.6, 9.2 + Math.abs(k) * -0.4, k * 1.3], [1.4, 4.8, 0.5], [k * 0.15, 0, 0.5 + k * 0.05], shadeHex(white, -0.1 * Math.abs(k)));
  for (const s of [-1, 1]) {
    B.cyl('std', 0, 0, s * 1.2, 0.35, 3.2, '#d8a020', 4);
    B.box('std', 0.6, 0.4, s * 1.2, 2.4, 0.4, 0.6, '#d8a020');
  }
}

/**
 * @param {object} ctx renderer ctx (SPEC §7.5); ctx.hideout is the world's hideout object
 */
export function createHideout3D(ctx) {
  const hideout = ctx.hideout;
  if (!hideout) return null;
  const map = ctx.map;
  const hub = map.hub;
  const dyn = hideout.dyn;
  const fx = acquireFx(ctx);
  const R = fx.rng;
  const day = ctx.time === 'day';
  let quality = ctx.quality;
  const G = ctx.groundY || (() => 0);
  const root = new THREE.Group();
  root.name = 'hideout3d';
  ctx.scene.add(root);
  const disposables = [];
  const col = (hex) => new THREE.Color(hex);
  const tmpC = new THREE.Color();

  // ---- the range's dummies ---------------------------------------------------------------------------
  const dummies = [];
  if (hub.range && hub.range.targets.length) {
    const B = newStdBuilder();
    buildDummy(B);
    const geo = B.finish()[0].geometry;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    disposables.push(geo, mat);
    for (const t of hub.range.targets) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(t.x, G(t.x, t.y), t.y);
      mesh.rotation.y = -t.a;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      root.add(mesh);
      dummies.push({ t, mesh, tilt: 0, vel: 0, axis: 0, y0: mesh.position.y });
    }
  }
  const damage = [];   // floating numbers { x, y, h, dmg, age, big }

  // ---- spinners (windmill blades, radar dishes): private meshes turning about local x ------------------
  const spinners = [];
  const seenSpinners = new Set();
  function syncSpinners() {
    // (spinners of an upgrade that was rebuilt are gone from dyn: drop their meshes)
    for (let i = spinners.length - 1; i >= 0; i--) {
      if (dyn.spinners.includes(spinners[i].sp)) continue;
      const s = spinners[i];
      root.remove(s.holder);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      seenSpinners.delete(s.sp);
      spinners.splice(i, 1);
    }
    for (const sp of dyn.spinners || []) {
      if (seenSpinners.has(sp)) continue;
      seenSpinners.add(sp);
      const B = newStdBuilder();
      B.obj(0, 0, 0, 5);
      B.setJitter(0.03);
      sp.build(B);
      const parts = B.finish();
      if (!parts.length) continue;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
      const holder = new THREE.Group();
      holder.position.set(sp.x, sp.h + G(sp.x, sp.y), sp.y);
      holder.rotation.y = -sp.a;
      const mesh = new THREE.Mesh(parts[0].geometry, mat);
      mesh.receiveShadow = true;
      holder.add(mesh);
      root.add(holder);
      disposables.push(parts[0].geometry, mat);
      spinners.push({ sp, mesh, holder, ang: sp.phase || 0 });
    }
  }

  // ---- chickens: one InstancedMesh, wandering in their yards ---------------------------------------------
  const birds = [];
  let chickenMesh = null;
  const seenFlocks = new Set();
  function syncFlocks() {
    let added = false;
    for (const f of dyn.chickens || []) {
      if (seenFlocks.has(f)) continue;
      seenFlocks.add(f);
      for (let i = 0; i < f.n; i++) {
        const a = R() * TAU, d = Math.sqrt(R()) * f.r;
        birds.push({ f, x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d, yaw: R() * TAU, tx: 0, ty: 0, wait: R() * 3, peck: R() * 6, sp: 12 + R() * 10, tint: R(), scare: 0 });
        added = true;
      }
    }
    if (added && !chickenMesh) {
      const B = newStdBuilder();
      buildChicken(B);
      const geo = B.finish()[0].geometry;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      chickenMesh = new THREE.InstancedMesh(geo, mat, 40);
      chickenMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      chickenMesh.frustumCulled = false;
      chickenMesh.count = 0;
      root.add(chickenMesh);
      disposables.push(geo, mat);
    }
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const TINTS = ['#ffffff', '#e8c9a0', '#c98a5a', '#6a4a3a', '#f4e8d0', '#d8d0c0'].map(col);

  function updateFlock(dt, local) {
    if (!chickenMesh) return;
    const n = Math.min(birds.length, 40);
    for (let i = 0; i < n; i++) {
      const b = birds[i];
      const f = b.f;
      // scared by a player walking close
      let flee = 0;
      if (local && local.state !== 'dead') {
        const dx = b.x - local.x, dy = b.y - local.y, d = Math.hypot(dx, dy);
        if (d < 70) { flee = 1; b.tx = b.x + (dx / (d || 1)) * 60; b.ty = b.y + (dy / (d || 1)) * 60; b.wait = 0; }
      }
      b.peck += dt * (2.2 + (i % 3) * 0.4);
      if (b.wait > 0 && !flee) {
        b.wait -= dt;
      } else {
        if (!flee && Math.hypot(b.tx - b.x, b.ty - b.y) < 4) {
          b.wait = 0.8 + R() * 3.5;
          const a = R() * TAU, d = Math.sqrt(R()) * f.r;
          b.tx = f.x + Math.cos(a) * d; b.ty = f.y + Math.sin(a) * d;
        }
        const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy) || 1;
        const sp = b.sp * (flee ? 3.2 : 1);
        const ny = Math.atan2(dy, dx);
        let da = ny - b.yaw;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        b.yaw += da * Math.min(1, dt * 8);
        const nx = b.x + (dx / d) * sp * dt, nyy = b.y + (dy / d) * sp * dt;
        // (stay out of the walls: only the yard rect)
        if (nx > f.x - f.r * 1.4 && nx < f.x + f.r * 1.4 && nyy > f.y - f.r * 1.4 && nyy < f.y + f.r * 1.4) { b.x = nx; b.y = nyy; }
      }
      const walking = b.wait <= 0;
      const bob = walking ? Math.abs(Math.sin(b.peck * 3.2)) * 1.2 : 0;
      const pk = !walking && b.wait > 0 ? Math.max(0, Math.sin(b.peck * 3)) : 0;
      _e.set(0, -b.yaw, pk * 0.75);
      _q.setFromEuler(_e);
      _p.set(b.x, G(b.x, b.y) + bob, b.y);
      _m.compose(_p, _q, _s);
      chickenMesh.setMatrixAt(i, _m);
      chickenMesh.setColorAt(i, TINTS[Math.floor(b.tint * TINTS.length) % TINTS.length]);
    }
    chickenMesh.count = n;
    chickenMesh.instanceMatrix.needsUpdate = true;
    if (chickenMesh.instanceColor) chickenMesh.instanceColor.needsUpdate = true;
  }

  // ---- moths and fireflies --------------------------------------------------------------------------------
  const FLY = { low: 0, high: 18, ultra: 38, cinematic: 72 };
  const flies = [];
  const anchors = [];
  for (const l of map.lights) {
    if (!Number.isFinite(l.h) || l.h > 200) continue;
    anchors.push({ x: l.x, y: l.y, h: l.h - 10, moth: true, warm: true });
  }
  for (const p of hub.props) if (p.t === 'lantern') anchors.push({ x: p.x, y: p.y, h: (p.z || 0) + 14, moth: true, warm: true });
  const grassy = hub.firefly || [];
  function pickAnchor() {
    if (grassy.length && R() < 0.55) {
      const g = grassy[(R() * grassy.length) | 0];
      return { x: g.x + (R() - 0.5) * g.w, y: g.y + (R() - 0.5) * g.h, h: 14 + R() * 30, moth: false };
    }
    if (anchors.length) return anchors[(R() * anchors.length) | 0];
    return { x: hub.spawn.x + (R() - 0.5) * 600, y: hub.spawn.y + (R() - 0.5) * 400, h: 20, moth: false };
  }
  for (let i = 0; i < FLY.cinematic; i++) {
    const a = pickAnchor();
    flies.push({ a, ph: R() * TAU, sp: 0.7 + R() * 1.1, rad: a.moth ? 9 + R() * 22 : 20 + R() * 60, on: true, hue: R() });
  }
  const FLY_C = [col('#c8ff5a'), col('#b8ff7a'), col('#f4ff8a')];
  const MOTH_C = col('#ffe9b0');

  // ---- particles ---------------------------------------------------------------------------------------------
  const acc = { smoke: 0, spark: 0, burst: 0 };
  let now = 0, camX = 0, camY = 0;
  const SMOKE_C = col('#8a8480'), SMOKE_W = col('#e8b080');
  const SPARK_C = new THREE.Color('#ffc060').multiplyScalar(3.4);

  function updateSmoke(dt) {
    for (const s of dyn.smoke) {
      if (Math.abs(s.x - camX) > 1300 || Math.abs(s.y - camY) > 1300) continue;
      const load = fx.load();
      if (load > 0.8) continue;
      s.acc = (s.acc || 0) + dt * s.rate * (quality === 'low' ? 0.4 : 1);
      while (s.acc >= 1) {
        s.acc -= 1;
        const wx = 8 + R() * 6;
        tmpC.copy(s.warm ? SMOKE_W : SMOKE_C);
        fx.spawn(s.x + (R() - 0.5) * s.r, s.h + G(s.x, s.y), s.y + (R() - 0.5) * s.r, wx, 16 + R() * 12, (R() - 0.5) * 6, 4 + R() * 2.5, 3 + s.r * 0.4, 22 + s.r * 2, tmpC, s.warm ? 0.22 : 0.3, FR.SMOKE2 + ((R() * 3) | 0), 0, -1, 0.35);
      }
    }
  }

  function updateSparks(dt) {
    const sp = dyn.sparks;
    if (!sp.length || quality === 'low') return;
    for (const s of sp) {
      if (Math.abs(s.x - camX) > 900 || Math.abs(s.y - camY) > 900) continue;
      // Deke grinds now and then: a burst of sparks for a second, every ~7 s
      const ph = (now + s.x * 0.013) % 7.3;
      if (ph > 1.0) continue;
      acc.spark += dt * 46;
      while (acc.spark >= 1) {
        acc.spark -= 1;
        const a = R() * TAU;
        fx.spawn(s.x + Math.cos(a) * 3, s.h + G(s.x, s.y), s.y + Math.sin(a) * 3, Math.cos(a) * (30 + R() * 50), 20 + R() * 60, Math.sin(a) * (30 + R() * 50), 0.35 + R() * 0.4, 1.5, 0.4, SPARK_C, 1, FR.SPARK, F_ADD | F_BOUNCE, 220, 0.4);
      }
    }
  }

  function updateFlies(dt) {
    if (day || quality === 'low') return;
    const n = tierAtLeast(quality, 'cinematic') ? FLY.cinematic : tierAtLeast(quality, 'ultra') ? FLY.ultra : FLY.high;
    for (let i = 0; i < n; i++) {
      const f = flies[i];
      const a = f.a;
      const dx = a.x - camX, dy = a.y - camY;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1100 * 1100) continue;
      f.ph += dt * f.sp * (a.moth ? 3.4 : 1.6);
      // moths flutter in tight, jittery loops round the light; fireflies drift lazily and pulse
      const wob = a.moth ? Math.sin(f.ph * 2.7) * 4 : Math.sin(f.ph * 0.6) * 12;
      const x = a.x + Math.cos(f.ph * (a.moth ? 1.3 : 0.5)) * (f.rad + wob);
      const y = a.y + Math.sin(f.ph * (a.moth ? 1.1 : 0.42) + i) * (f.rad + wob);
      const h = a.h + G(a.x, a.y) + Math.sin(f.ph * 0.8 + i) * (a.moth ? 10 : 16);
      const dc = Math.sqrt((x - camX) ** 2 + (y - camY) ** 2);
      const near = Math.min(1, Math.max(0, (dc - 40) / 80));
      if (near <= 0) continue;
      if (a.moth) {
        const flick = 0.55 + 0.45 * Math.abs(Math.sin(f.ph * 9));
        fx.glow(x, h, y, Math.min(2.6, 0.006 * dc + 0.9), tmpC.copy(MOTH_C).multiplyScalar(1.6 * flick), 0.85 * near, FR.FIREFLY);
      } else {
        const pulse = Math.max(0, Math.sin(f.ph * 1.3 + i * 2.1));
        const glow = 0.15 + pulse * pulse * 0.85;
        fx.glow(x, h, y, Math.min(2.2 + glow * 2.4, 0.011 * dc + 0.5), tmpC.copy(FLY_C[i % 3]).multiplyScalar(1.9 * glow), 0.9 * near, FR.FIREFLY);
      }
    }
  }

  // ---- stations: ground rings and a soft column, brighter as the player nears ------------------------------
  const stationT = new Map();
  function updateStations(dt, local) {
    const t = now;
    for (const st of hub.stations) {
      const c = col(STATION_COLOR[st.kind] || '#ffffff');
      let near = 0;
      if (local && local.state !== 'dead') {
        const d = Math.hypot(local.x - st.x, local.y - st.y);
        near = Math.max(0, Math.min(1, 1 - (d - st.r * 0.6) / (st.r * 1.1)));
      }
      const cur = stationT.get(st.id) || 0;
      const k = cur + (near - cur) * Math.min(1, dt * 6);
      stationT.set(st.id, k);
      const dcam = Math.hypot(st.x - camX, st.y - camY);
      if (dcam > 1600) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + st.x * 0.01);
      const size = st.r * (1.15 + 0.1 * pulse + 0.1 * k);
      const y = G(st.x, st.y) + 1.5;
      // (flat ring on the ground; faint from afar so the stations can be found, bright when near)
      fx.glow(st.x, y, st.y, size, tmpC.copy(c).multiplyScalar(0.9 + 1.3 * k), 0.10 + 0.05 * pulse + 0.42 * k, FR.SOFTRING, true);
      if (k > 0.05) {
        fx.beam(st.x, y, st.y, st.x, y + 120, st.y, 16, 5, tmpC.copy(c).multiplyScalar(1.1), 0.10 * k + 0.05 * k * pulse, 0.25, 0, 0.5);
      }
    }
  }

  // ---- searchlights (watchtower tier 2+) -----------------------------------------------------------------------
  const seenLights = new Set();
  function updateSearchlights(dt) {
    for (const sl of dyn.searchlights || []) {
      if (!seenLights.has(sl)) seenLights.add(sl);
      if (Math.abs(sl.x - camX) > 2000 || Math.abs(sl.y - camY) > 2000) continue;
      const a = (sl.a0 ?? 0) + Math.sin(now * (sl.speed || 0.35) + (sl.phase || 0)) * (sl.arc || 1.2);
      const range = sl.range || 620;
      const ex = sl.x + Math.cos(a) * range, ey = sl.y + Math.sin(a) * range;
      const h0 = sl.h + G(sl.x, sl.y);
      tmpC.set('#fff2d0').multiplyScalar(1.3);
      fx.beam(sl.x, h0, sl.y, ex, G(ex, ey) + 2, ey, 4, 74, tmpC, 0.22, 0.2, 0, 0.35);
      fx.glow(ex, G(ex, ey) + 2, ey, 190, tmpC.set('#fff2d0').multiplyScalar(0.8), 0.32, FR.GLOW, true);
      fx.glow(sl.x, h0, sl.y, 26, tmpC.set('#fff6e0').multiplyScalar(2.2), 0.9, FR.GLOW);
      if (ctx.lights) ctx.lights.steady('hub:search' + (sl.id || ''), ex, ey, 46, '#fff2d6', 0.9, 300);
    }
  }

  // ---- damage numbers -------------------------------------------------------------------------------------------
  function drawDamage(dt) {
    const o = ctx.overlay;
    if (!o || !damage.length) return;
    o.save();
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    for (let i = damage.length - 1; i >= 0; i--) {
      const d = damage[i];
      d.age += dt;
      if (d.age > 1.1) { damage.splice(i, 1); continue; }
      const p = ctx.project(d.x, d.y, d.h + d.age * 26);
      if (!p.visible) continue;
      const u = d.age / 1.1;
      const size = Math.round((d.big ? 26 : 19) * (1 + (1 - Math.min(1, d.age * 7)) * 0.5));
      o.globalAlpha = 1 - u * u;
      o.font = `800 ${size}px system-ui, sans-serif`;
      o.lineWidth = 4;
      o.strokeStyle = 'rgba(0,0,0,0.75)';
      o.strokeText(String(d.dmg), p.x + d.dx, p.y);
      o.fillStyle = d.big ? '#ffd54a' : '#ffffff';
      o.fillText(String(d.dmg), p.x + d.dx, p.y);
    }
    o.restore();
  }

  function hitDummy(x, y, dmg, dirx, diry) {
    let best = null, bd = 1e9;
    for (const d of dummies) {
      const dd = Math.hypot(d.t.x - x, d.t.y - y);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (!best || bd > 80) return;
    // a kick backwards along the shot, a damped spring brings it back
    best.vel += Math.min(3.2, 0.9 + dmg * 0.02);
    best.axis = Math.atan2(diry, dirx);
    // straw puffs out
    for (let i = 0; i < 6; i++) {
      tmpC.set('#d8c070');
      fx.spawn(best.t.x, G(best.t.x, best.t.y) + 22 + R() * 14, best.t.y, (R() - 0.5) * 60, 20 + R() * 40, (R() - 0.5) * 60, 0.6 + R() * 0.5, 1.6, 1.2, tmpC, 0.9, FR.DOT, F_BOUNCE, 90, 0.6);
    }
  }

  function addEvents(events) {
    if (!events) return;
    for (const e of events) {
      if (e.type !== 'rangehit') continue;
      damage.push({ x: e.x, y: e.y, h: 40 + (e.h || 0), dmg: Math.round(e.dmg), age: 0, dx: (R() - 0.5) * 30, big: !!e.big });
      if (damage.length > 40) damage.shift();
      hitDummy(e.x, e.y, e.dmg, e.dx || 1, e.dy || 0);
    }
  }

  function update(view, frame) {
    fx.begin(frame);
    const dt = Math.min(0.1, frame.dt || 0);
    now = frame.now || now + dt;
    camX = frame.camX; camY = frame.camY;
    const local = frame.local;
    if (!(dt > 0)) { drawDamage(0); return; }
    syncSpinners();
    syncFlocks();
    updateSmoke(dt);
    updateSparks(dt);
    updateFlies(dt);
    updateStations(dt, local);
    updateSearchlights(dt);
    updateFlock(dt, local);
    for (const s of spinners) {
      s.ang += dt * (s.sp.speed ?? 0.5);
      s.mesh.rotation[s.sp.axis || 'x'] = s.ang;
    }
    // dummies: damped spring, leaning away from the shot
    for (const d of dummies) {
      d.vel += (-42 * d.tilt - 5.5 * d.vel) * dt;
      d.tilt += d.vel * dt;
      const k = d.tilt * 0.22;
      d.mesh.rotation.set(0, -d.t.a, 0);
      d.mesh.rotateZ(-k * Math.cos(d.axis + d.t.a));
      d.mesh.rotateX(-k * Math.sin(d.axis + d.t.a));
    }
    drawDamage(dt);
  }

  return {
    update,
    addEvents,
    setQuality(q) { quality = q; },
    dispose() {
      root.removeFromParent();
      for (const d of disposables) d.dispose && d.dispose();
      releaseFx(ctx);
    },
    get stats() { return { dummies: dummies.length, chickens: birds.length, spinners: spinners.length }; },
    /** Test / dev hook: the range dummies (mesh, tilt). */
    get dummies() { return dummies; },
  };
}
void DET;
void F_SHRINK;
void F_FLICKER;
