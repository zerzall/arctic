// Sun shadows of the actors by day (SPEC §7.5.1). The sun's shadow map holds only the static
// world (lights.js renders it on demand, once every few seconds), so zombies and survivors
// would float without a shadow. This sub-system lays a soft, elongated dark streak on the
// ground behind every actor, pointing away from the sun and as long as the actor is tall
// over tan(sun elevation): one InstancedMesh, one draw call, no shadow pass. At night it
// does nothing (the factory returns null).

import * as THREE from 'three';

// body height (world units) of a zombie type; survivors are ~52
const HEIGHT = { walker: 56, runner: 52, crawler: 24, bloater: 64, spitter: 56, screamer: 58, brute: 88, boss: 140 };
const CAP = 384;
const RANGE = 1500;

let tex = null;
function shadowTexture() {
  if (tex) return tex;
  const W = 128, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // u along the shadow (0 = the feet), v across it: dark near the feet, tapering and
  // fading with distance, soft at the sides
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1), v = (y / (H - 1)) * 2 - 1;
      const width = 0.55 + 0.45 * (1 - u) * (1 - u);
      const across = Math.max(0, 1 - Math.pow(Math.abs(v) / width, 2.2));
      const along = Math.pow(1 - u, 1.15) * Math.min(1, u * 14 + 0.35);
      const a = across * across * along;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  g.putImageData(img, 0, 0);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** @param {object} ctx renderer ctx (SPEC §7.5) */
export function createSunShadow(ctx) {
  const amb = ctx.amb;
  if (!amb || amb.time !== 'day' || !amb.sunDir) return null;
  const dir = new THREE.Vector2(-amb.sunDir.x, -amb.sunDir.z).normalize();
  const ang = Math.atan2(dir.y, dir.x);
  const tanEl = Math.max(0.25, amb.sunDir.y / Math.hypot(amb.sunDir.x, amb.sunDir.z));

  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0.5, 0, 0);
  const mat = new THREE.MeshBasicMaterial({
    map: shadowTexture(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.name = 'sun-shadows';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.count = 0;
  ctx.scene.add(mesh);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  q.setFromAxisAngle(up, -ang);
  let n = 0;

  function put(x, y, z, h, w) {
    if (n >= CAP) return;
    const len = Math.min(220, h / tanEl);
    pos.set(x, z + 0.55, y);
    sc.set(len, 1, w);
    m4.compose(pos, q, sc);
    mesh.setMatrixAt(n++, m4);
  }

  return {
    update(view, frame) {
      n = 0;
      const cx = frame.camX, cy = frame.camY;
      const r2 = RANGE * RANGE;
      if (view) {
        for (const z of view.zombies || []) {
          const dx = z.x - cx, dy = z.y - cy;
          if (dx * dx + dy * dy > r2) continue;
          const h = HEIGHT[z.type] || 56;
          put(z.x, z.y, z.z > 0 ? z.z : 0, h, h * 0.36 + 8);
        }
        for (const p of view.players || []) {
          if (p.state === 'dead') continue;
          const dx = p.x - cx, dy = p.y - cy;
          if (dx * dx + dy * dy > r2) continue;
          put(p.x, p.y, p.z > 0 ? p.z : 0, p.state === 'downed' ? 14 : 54, p.state === 'downed' ? 20 : 22);
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      ctx.scene.remove(mesh);
      mesh.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}
