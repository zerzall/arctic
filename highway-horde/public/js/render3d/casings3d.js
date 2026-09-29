// Ejected shell casings (EFFECTS, SPEC §7.5): brass cartridges and red shotgun hulls fly
// out of the ejection port, tumble, bounce on the ground (each bounce is smaller and spins
// less), roll and settle lying flat, and stay for a while before they are recycled. One
// instanced mesh, a fixed pool (the oldest casing is replaced first), no per-frame
// allocation.

import * as THREE from 'three';
import { col } from './actor-kit.js';

const CAP = { ultra: 140, high: 80, low: 22 };
const LIFE = 40;
const BRASS = ['#c9a24a', '#d6b25a', '#b98f3c'], HULL = '#b02a24', STEEL = '#8a8f94';

function casingGeometry() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.9, 1.0, 3.2, 8);
  body.translate(0, -0.2, 0);
  parts.push(body);
  const neck = new THREE.CylinderGeometry(0.62, 0.9, 0.9, 8);
  neck.translate(0, 1.85, 0);
  parts.push(neck);
  const rim = new THREE.CylinderGeometry(1.12, 1.12, 0.35, 8);
  rim.translate(0, -1.9, 0);
  parts.push(rim);
  // merge (all non-indexed with the same attributes)
  let pos = [], nor = [];
  for (const g of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos = pos.concat(Array.from(ng.attributes.position.array));
    nor = nor.concat(Array.from(ng.attributes.normal.array));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  // vertex colours (white): the same shader program as the vertex-coloured gibs, so no new compile
  out.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  return out;
}

export function createCasings3D(ctx, fx, env) {
  const { G } = env;
  let tier = ctx.quality === 'ultra' ? 'ultra' : ctx.quality === 'low' ? 'low' : 'high';
  const MAXN = CAP.ultra;
  const geo = casingGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.3 });
  const mesh = new THREE.InstancedMesh(geo, mat, MAXN);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 3), 3);
  mesh.name = 'casings';
  ctx.scene.add(mesh);

  const X = new Float32Array(MAXN), H = new Float32Array(MAXN), Y = new Float32Array(MAXN);
  const VX = new Float32Array(MAXN), VH = new Float32Array(MAXN), VY = new Float32Array(MAXN);
  const RX = new Float32Array(MAXN), RY = new Float32Array(MAXN), RZ = new Float32Array(MAXN);
  const WX = new Float32Array(MAXN), WZ = new Float32Array(MAXN), AGE = new Float32Array(MAXN), SC = new Float32Array(MAXN);
  const REST = new Uint8Array(MAXN), CR = new Float32Array(MAXN * 3), SCY = new Float32Array(MAXN);
  let n = 0;
  const stats = { casings: 0 };
  const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

  /**
   * Eject one casing from (x, h, y) for a shooter aiming along sim angle `aim`.
   * @param {number} kind 0 brass (pistol, smg, rifle), 1 shotgun hull, 2 heavy rifle / MG brass
   */
  function eject(x, h, y, aim, kind) {
    const cap = CAP[tier];
    if (cap <= 0) return;
    let i;
    if (n < cap) i = n++;
    else {
      let best = 0, ba = -1;
      for (let k = 0; k < n; k++) if (AGE[k] > ba) { ba = AGE[k]; best = k; }
      i = best;
    }
    const R = fx.rng;
    const ra = aim + Math.PI / 2;               // to the shooter's right
    const cr = Math.cos(ra), sr = Math.sin(ra), ca = Math.cos(aim), sa = Math.sin(aim);
    const side = 70 + R() * 70, back = -20 + R() * 30;
    X[i] = x + cr * 3; Y[i] = y + sr * 3; H[i] = h;
    VX[i] = cr * side + ca * back; VY[i] = sr * side + sa * back; VH[i] = 80 + R() * 90;
    RX[i] = R() * 6.28; RY[i] = R() * 6.28; RZ[i] = R() * 6.28;
    WX[i] = (R() - 0.5) * 60; WZ[i] = (R() - 0.5) * 60;
    AGE[i] = 0; REST[i] = 0;
    SC[i] = kind === 1 ? 1.5 : kind === 2 ? 1.5 : 0.85;
    SCY[i] = kind === 1 ? 1.8 : kind === 2 ? 1.6 : 0.9;
    const c = col(kind === 1 ? HULL : R() < 0.06 ? STEEL : BRASS[(R() * BRASS.length) | 0]);
    CR[i * 3] = c.r; CR[i * 3 + 1] = c.g; CR[i * 3 + 2] = c.b;
  }

  function step(dt) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      AGE[i] += dt;
      if (AGE[i] > LIFE) continue;
      if (w !== i) {
        X[w] = X[i]; H[w] = H[i]; Y[w] = Y[i]; VX[w] = VX[i]; VH[w] = VH[i]; VY[w] = VY[i];
        RX[w] = RX[i]; RY[w] = RY[i]; RZ[w] = RZ[i]; WX[w] = WX[i]; WZ[w] = WZ[i]; AGE[w] = AGE[i];
        SC[w] = SC[i]; SCY[w] = SCY[i]; REST[w] = REST[i];
        CR[w * 3] = CR[i * 3]; CR[w * 3 + 1] = CR[i * 3 + 1]; CR[w * 3 + 2] = CR[i * 3 + 2];
      }
      const j = w++;
      const fl = G(X[j], Y[j]) + 0.9;
      if (!REST[j]) {
        VH[j] -= 900 * dt;
        X[j] += VX[j] * dt; Y[j] += VY[j] * dt; H[j] += VH[j] * dt;
        RX[j] += WX[j] * dt; RZ[j] += WZ[j] * dt;
        if (H[j] < fl) {
          H[j] = fl;
          if (VH[j] < -50) {
            VH[j] = -VH[j] * 0.42;
            VX[j] *= 0.62; VY[j] *= 0.62; WX[j] *= 0.5; WZ[j] *= 0.5;
          } else {
            VH[j] = 0;
            const f = Math.exp(-7 * dt);
            VX[j] *= f; VY[j] *= f; WX[j] *= f; WZ[j] *= f;
            if (Math.hypot(VX[j], VY[j]) < 6) REST[j] = 1;
          }
        }
      } else {
        const t = 1 - Math.exp(-dt * 14);
        RX[j] += (Math.PI / 2 - RX[j]) * t;
        RZ[j] += (0 - RZ[j]) * t;
        H[j] += (fl - H[j]) * t;
      }
      const sink = AGE[j] > LIFE - 2 ? (AGE[j] - (LIFE - 2)) / 2 : 0;
      _e.set(RX[j], RY[j], RZ[j], 'YXZ');
      _q.setFromEuler(_e);
      _p.set(X[j], H[j] - sink * 2, Y[j]);
      _s.set(SC[j], SCY[j], SC[j]);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(j, _m);
      mesh.instanceColor.setXYZ(j, CR[j * 3], CR[j * 3 + 1], CR[j * 3 + 2]);
    }
    n = w;
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
    }
    stats.casings = n;
  }

  return {
    step, eject, stats,
    get count() { return n; },
    setQuality(q) {
      tier = q === 'ultra' ? 'ultra' : q === 'low' ? 'low' : 'high';
      if (n > CAP[tier]) n = CAP[tier];
    },
    dispose() { mesh.removeFromParent(); mesh.dispose(); geo.dispose(); mat.dispose(); },
  };
}
