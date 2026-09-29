// Severed limbs, heads and torso chunks (EFFECTS, SPEC §7.5): when a zombie is blown apart
// (heavy weapons, explosions, the railgun, a bloater) or a heavy hit finishes one, whole body
// parts fly off and tumble. They are simulated here (gravity, bounce off the ground with
// friction, bounce off obstacles, spin that damps out as they settle), trail blood drops in
// the air, splat where they land and smear along the ground where they slide, and stay for
// a while (a fixed pool: the oldest resting piece is recycled first) before sinking away.
//
// Three instanced meshes (limb, torso, head), vertex-coloured: skin with a torn red end and
// white bone at the stump; the instance colour is the zombie's skin tint. Nothing allocates
// per frame.

import * as THREE from 'three';
import { PartBuilder, col } from './actor-kit.js';
import { F_BOUNCE, F_VSTRETCH, FR, DC, DK } from './fx-core.js';

const TAU = Math.PI * 2;
const CAP = { ultra: 110, high: 64, low: 0 };
const LIFE = 26;
const SKIN = '#cdbfa3', FLESH = '#7a1414', BONE = '#e0d8c2', CLOTH = '#3c3c44', GORE = '#5a0e0e';

function limbGeometry() {
  const b = new PartBuilder();
  // an arm along +x: a torn sleeve over the upper arm, bare forearm, a hand with fingers; the stump at -x
  b.add('cyl8', { at: [-4.6, 0, 0], rot: [0, 0, Math.PI / 2], size: [4.4, 10, 4.4], color: CLOTH, taper: [0.85, 0.85] });
  b.add('cyl8', { at: [4.2, 0.1, 0], rot: [0, 0, Math.PI / 2], size: [3.4, 9.4, 3.4], color: SKIN, taper: [0.7, 0.7] });
  b.add('ico1', { at: [9.6, 0.1, 0], size: [3.6, 3.0, 3.4], color: SKIN });
  for (let k = 0; k < 4; k++) b.add('cyl6', { at: [12.4, 0.4 - k * 0.2, -1.5 + k * 1.0], rot: [0, 0, Math.PI / 2 - 0.15 * (k - 1.5)], size: [0.85, 3.2, 0.85], color: SKIN });
  b.add('cyl6', { at: [10.4, -1.2, 2.3], rot: [0.5, 0, 1.0], size: [0.9, 2.6, 0.9], color: SKIN });
  b.add('ico1', { at: [-9.8, 0, 0], size: [4.0, 4.6, 4.6], color: FLESH });
  b.add('cyl6', { at: [-11.4, 0.6, 0.3], rot: [0, 0, Math.PI / 2], size: [1.3, 3.6, 1.3], color: BONE });
  b.add('ico0', { at: [-1, 0.6, 2.0], size: [3, 2.4, 1.6], color: FLESH });
  b.add('ico0', { at: [3, 0.2, -1.8], size: [4.5, 2.0, 1.4], color: GORE });
  b.add('ico0', { at: [-6, -0.4, 1.9], size: [4.2, 2.0, 1.4], color: GORE });
  return b.build();
}

function torsoGeometry() {
  const b = new PartBuilder();
  b.add('ico1', { at: [0, 0, 0], size: [15, 10, 11], color: SKIN });
  b.add('ico1', { at: [-2, -1, 0], size: [11, 8, 12], color: CLOTH });
  b.add('ico1', { at: [6.4, 0, 0], size: [5, 9, 9], color: FLESH });
  for (let k = 0; k < 4; k++) {
    b.add('cyl6', { at: [7.6, -2.6 + k * 1.8, 0], rot: [Math.PI / 2, 0, 0], size: [0.9, 8, 0.9], color: BONE });
  }
  b.add('ico0', { at: [-5, 4.6, 2], size: [4, 3, 3], color: FLESH });
  b.add('ico1', { at: [0, 0.5, 4.6], size: [10, 6, 3], color: GORE });
  b.add('ico1', { at: [-2, -3, -4.6], size: [8, 5, 3], color: GORE });
  return b.build();
}

function headGeometry() {
  const b = new PartBuilder();
  b.add('ico1', { at: [0, 0, 0], size: [12.5, 13.5, 12], color: SKIN });
  b.add('ico1', { at: [1.6, -6.4, 0], size: [8, 4.4, 8.5], color: SKIN });
  b.add('ico1', { at: [-1.5, 4.4, 0], size: [10.5, 6.5, 11], color: '#3a2a22' });
  b.add('ico0', { at: [5.6, 1.8, 2.7], size: [2.5, 2.2, 1.6], color: '#0d0d0d' });
  b.add('ico0', { at: [5.6, 1.8, -2.7], size: [2.5, 2.2, 1.6], color: '#0d0d0d' });
  b.add('ico1', { at: [0, -8, 0], size: [8, 4, 8], color: FLESH });
  b.add('ico1', { at: [2, 1, 5.4], size: [8, 7, 2.4], color: GORE });
  b.add('ico1', { at: [-2, 4, -5.2], size: [7, 6, 2.4], color: GORE });
  b.add('cyl6', { at: [0, -9.4, 0.4], size: [1.8, 3.4, 1.8], color: BONE });
  return b.build();
}

/**
 * @param {object} ctx renderer ctx
 * @param {object} fx shared fx pools
 * @param {{ G: (x:number,y:number)=>number, surf: Function, blood: object, high: boolean, ultra: boolean }} env
 */
export function createGore3D(ctx, fx, env) {
  const { G, surf } = env;
  let tier = ctx.quality === 'ultra' ? 'ultra' : ctx.quality === 'low' ? 'low' : 'high';
  const MAXN = CAP.ultra;
  const geos = [limbGeometry(), torsoGeometry(), headGeometry()];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
  const meshes = geos.map((g, i) => {
    const m = new THREE.InstancedMesh(g, mat, MAXN);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = false;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 3), 3);
    m.name = 'gore-' + ['limb', 'torso', 'head'][i];
    ctx.scene.add(m);
    return m;
  });

  // structure of arrays
  const X = new Float32Array(MAXN), H = new Float32Array(MAXN), Y = new Float32Array(MAXN);
  const VX = new Float32Array(MAXN), VH = new Float32Array(MAXN), VY = new Float32Array(MAXN);
  const RX = new Float32Array(MAXN), RY = new Float32Array(MAXN), RZ = new Float32Array(MAXN);
  const WX = new Float32Array(MAXN), WY = new Float32Array(MAXN), WZ = new Float32Array(MAXN);
  const AGE = new Float32Array(MAXN), SC = new Float32Array(MAXN), RAD = new Float32Array(MAXN);
  const KIND = new Uint8Array(MAXN), REST = new Uint8Array(MAXN), CR = new Float32Array(MAXN * 3);
  const TRAIL = new Float32Array(MAXN), SLX = new Float32Array(MAXN), SLY = new Float32Array(MAXN);
  const BOUNCES = new Uint8Array(MAXN);
  let n = 0;
  const K0 = [0, 0, 0];
  const stats = { pieces: 0, spawned: 0 };

  const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
  // bloody grey-green flesh (lit by the flashlight it reads paler than it is)
  const skins = ['#8f9878', '#8a9470', '#9a8a72', '#7f8a68', '#968c78', '#88806c'].map((h) => col(h));
  const _sf = { nx: 0, ny: 0, top: 0, kind: '', d: 0, s0: 0, s1: 0 };

  function cap() { return CAP[tier]; }

  /** Spawn a body part at (x, h, y) flying along `dir` (radians, sim angle) at `speed`. */
  function piece(kind, x, h, y, dir, speed, size = 1, tintIdx = 0) {
    const C = cap();
    if (C <= 0) return -1;
    let i;
    if (n < C) i = n++;
    else {
      // recycle the oldest piece that has come to rest, else the oldest overall
      let best = -1, ba = -1;
      for (let k = 0; k < n; k++) if (REST[k] && AGE[k] > ba) { ba = AGE[k]; best = k; }
      if (best < 0) for (let k = 0; k < n; k++) if (AGE[k] > ba) { ba = AGE[k]; best = k; }
      i = best;
    }
    const spread = (fx.rng() - 0.5) * 0.8;
    const sp = speed * (0.6 + fx.rng() * 0.6);
    X[i] = x; H[i] = h; Y[i] = y;
    VX[i] = Math.cos(dir + spread) * sp; VY[i] = Math.sin(dir + spread) * sp; VH[i] = 120 + fx.rng() * 260;
    RX[i] = fx.rng() * TAU; RY[i] = dir; RZ[i] = fx.rng() * TAU;
    WX[i] = (fx.rng() - 0.5) * 16; WY[i] = (fx.rng() - 0.5) * 10; WZ[i] = (fx.rng() - 0.5) * 16;
    AGE[i] = 0; SC[i] = size; KIND[i] = kind; REST[i] = 0; BOUNCES[i] = 0; TRAIL[i] = 0;
    RAD[i] = kind === 2 ? 6 : kind === 1 ? 5.5 : 3;
    SLX[i] = x; SLY[i] = y;
    const c = skins[(tintIdx + i) % skins.length];
    CR[i * 3] = c.r; CR[i * 3 + 1] = c.g; CR[i * 3 + 2] = c.b;
    stats.spawned++;
    return i;
  }

  function landSplat(i, big) {
    if (fx.gore.k <= 0) return;
    const gx = X[i], gy = Y[i];
    env.blood.groundSplat(gx, gy, (big ? 26 : 16) * (0.8 + fx.rng() * 0.5), big ? 0.85 : 0.7);
    if (env.high) {
      for (let k = 0; k < (big ? 5 : 2); k++) {
        const a = fx.rng() * TAU, s = 40 + fx.rng() * 120;
        fx.spawn(gx, H[i] + 1, gy, Math.cos(a) * s, 30 + fx.rng() * 90, Math.sin(a) * s, 0.35 + fx.rng() * 0.3, 1.5 + fx.rng(), 0.9, fx.gore.blood2, 0.95, FR.DROP, F_BOUNCE | F_VSTRETCH, 700, 0.6);
      }
    }
  }

  function step(dt) {
    let w = 0;
    const k0 = K0;
    k0[0] = k0[1] = k0[2] = 0;
    for (let i = 0; i < n; i++) {
      AGE[i] += dt;
      if (AGE[i] > LIFE + 2) continue;
      if (w !== i) {
        X[w] = X[i]; H[w] = H[i]; Y[w] = Y[i]; VX[w] = VX[i]; VH[w] = VH[i]; VY[w] = VY[i];
        RX[w] = RX[i]; RY[w] = RY[i]; RZ[w] = RZ[i]; WX[w] = WX[i]; WY[w] = WY[i]; WZ[w] = WZ[i];
        AGE[w] = AGE[i]; SC[w] = SC[i]; RAD[w] = RAD[i]; KIND[w] = KIND[i]; REST[w] = REST[i]; BOUNCES[w] = BOUNCES[i];
        TRAIL[w] = TRAIL[i]; SLX[w] = SLX[i]; SLY[w] = SLY[i];
        CR[w * 3] = CR[i * 3]; CR[w * 3 + 1] = CR[i * 3 + 1]; CR[w * 3 + 2] = CR[i * 3 + 2];
      }
      const j = w++;
      const fl = G(X[j], Y[j]) + RAD[j] * 0.55;
      if (!REST[j]) {
        VH[j] -= 900 * dt;
        const px = X[j], py = Y[j];
        X[j] += VX[j] * dt; Y[j] += VY[j] * dt; H[j] += VH[j] * dt;
        RX[j] += WX[j] * dt; RY[j] += WY[j] * dt; RZ[j] += WZ[j] * dt;
        // an obstacle in the way: bounce off its face, leave a splat on it
        const sf = surf(X[j], Y[j], _sf);
        if (sf && sf.d < 0 && H[j] < sf.top) {
          X[j] = px; Y[j] = py;
          const vn = VX[j] * sf.nx + VY[j] * sf.ny;
          if (vn < 0) {
            VX[j] -= 1.5 * vn * sf.nx; VY[j] -= 1.5 * vn * sf.ny;
            VX[j] *= 0.5; VY[j] *= 0.5; WX[j] *= 0.6; WZ[j] *= 0.6;
            if (Math.abs(vn) > 60) env.blood.wallSplat(X[j] + sf.nx * 1, H[j], Y[j] + sf.ny * 1, sf, 18 + fx.rng() * 10, 0.85);
          }
        }
        // blood drops shed in the air
        TRAIL[j] -= dt;
        if (TRAIL[j] <= 0 && fx.gore.k > 0 && AGE[j] < 3) {
          TRAIL[j] = 0.05;
          fx.spawn(X[j], H[j], Y[j], VX[j] * 0.15 + (fx.rng() - 0.5) * 20, VH[j] * 0.1, VY[j] * 0.15 + (fx.rng() - 0.5) * 20, 0.35 + fx.rng() * 0.25, 1.1, 0.8, fx.gore.blood, 0.9, FR.DROP, F_BOUNCE | F_VSTRETCH, 600, 0.7);
        }
        if (H[j] < fl) {
          H[j] = fl;
          const impact = -VH[j];
          if (impact > 90) {
            if (BOUNCES[j] < 2) landSplat(j, BOUNCES[j] === 0);
            BOUNCES[j]++;
            VH[j] = impact * 0.28;
            VX[j] *= 0.6; VY[j] *= 0.6;
            WX[j] *= 0.55; WY[j] *= 0.55; WZ[j] *= 0.55;
          } else {
            VH[j] = 0;
            // sliding on the ground: friction, and a smear behind it
            const sp = Math.hypot(VX[j], VY[j]);
            const f = Math.exp(-4.2 * dt);
            VX[j] *= f; VY[j] *= f;
            WX[j] *= Math.exp(-6 * dt); WY[j] *= Math.exp(-6 * dt); WZ[j] *= Math.exp(-6 * dt);
            if (sp > 34 && fx.gore.k > 0) {
              const d = Math.hypot(X[j] - SLX[j], Y[j] - SLY[j]);
              if (d > 15) {
                env.blood.smear(SLX[j], SLY[j], X[j], Y[j], 9 + SC[j] * 3, 0.75);
                SLX[j] = X[j]; SLY[j] = Y[j];
              }
            }
            if (sp < 8) { REST[j] = 1; VX[j] = VY[j] = 0; WX[j] = WY[j] = WZ[j] = 0; landSplat(j, true); }
          }
        }
      } else {
        // settled: ease into a lying pose
        const t = 1 - Math.exp(-dt * 8);
        RX[j] += (Math.round(RX[j] / Math.PI) * Math.PI - RX[j]) * t;
        RZ[j] += (Math.round(RZ[j] / Math.PI) * Math.PI - RZ[j]) * t;
        H[j] += (fl - H[j]) * t;
      }
      // pose
      const sink = AGE[j] > LIFE ? Math.min(1, (AGE[j] - LIFE) / 2) : 0;
      _e.set(RX[j], RY[j], RZ[j], 'YXZ');
      _q.setFromEuler(_e);
      _p.set(X[j], H[j] - sink * 6, Y[j]);
      const sc = SC[j] * (1 - sink * 0.6);
      _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s);
      const m = meshes[KIND[j]];
      const ci = k0[KIND[j]]++;
      m.setMatrixAt(ci, _m);
      m.instanceColor.setXYZ(ci, CR[j * 3], CR[j * 3 + 1], CR[j * 3 + 2]);
    }
    n = w;
    for (let m = 0; m < 3; m++) {
      const mesh = meshes[m], c = k0[m];
      mesh.count = c;
      mesh.visible = c > 0;
      if (c) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, c * 16);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, c * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
    stats.pieces = n;
  }

  /**
   * A zombie blown apart: limbs, a torso chunk and (usually) the head fly out.
   * @param {number} dir sim angle the force pushes toward (NaN = all directions)
   * @param {number} power 0..1 how violent
   */
  function burst(x, y, dir, power, radius = 14, tint = 0) {
    if (fx.gore.k < 1 || cap() <= 0) return;       // limbs only with gore on
    const h0 = 26 + G(x, y);
    const heavy = 220 + 320 * power;
    const around = !Number.isFinite(dir);
    const limbs = tier === 'ultra' ? 4 : 3;
    for (let k = 0; k < limbs; k++) {
      const d = around ? fx.rng() * TAU : dir + (fx.rng() - 0.5) * 1.6;
      piece(0, x, h0 + fx.rng() * 8, y, d, heavy * 0.8, k < 2 ? 0.9 : 1.15, tint);
    }
    piece(1, x, h0 - 4, y, around ? fx.rng() * TAU : dir + (fx.rng() - 0.5) * 1.0, heavy * 0.5, radius / 14, tint);
    if (fx.rng() < 0.75) piece(2, x, h0 + 18, y, around ? fx.rng() * TAU : dir + (fx.rng() - 0.5) * 1.4, heavy * 0.7, radius / 14 * 0.95, tint);
  }

  /** One torn-off arm or leg (a heavy hit that finishes a zombie). */
  function limb(x, y, dir, power, tint = 0) {
    if (fx.gore.k < 1 || cap() <= 0) return;
    piece(0, x, 30 + G(x, y), y, dir, 200 + 240 * power, 1, tint);
    if (fx.gore.k >= 1 && fx.rng() < 0.4) piece(0, x, 24 + G(x, y), y, dir + (fx.rng() - 0.5), 180 + 200 * power, 1.1, tint + 1);
  }

  return {
    step,
    burst,
    limb,
    piece,
    get count() { return n; },
    stats,
    setQuality(q) {
      tier = q === 'ultra' ? 'ultra' : q === 'low' ? 'low' : 'high';
      if (n > cap()) n = cap();
    },
    clear() { n = 0; },
    dispose() {
      for (const m of meshes) { m.removeFromParent(); m.dispose(); }
      for (const g of geos) g.dispose();
      mat.dispose();
    },
  };
}

export { DC, DK };
