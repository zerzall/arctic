#!/usr/bin/env node
// Builds the zombies' human body from MakeHuman (CC0): public/js/render3d/actor-zbody-data.js.
//
//   node scripts/build-zbody.js [--obj <dir>]      (--obj also writes OBJ previews of the levels)
//
// The MakeHuman base mesh (scripts/zbody/mh.js fetches it and the rest from raw.githubusercontent.com
// into a cache, $MH_CACHE or the system temp dir) is morphed to a neutral adult (half the young male,
// half the young female macro target), posed by MakeHuman's own skeleton and weights from its A-pose
// into the rig's rest pose (arms down, legs straight: scripts/zbody/pose.js), converted to model
// units and its weights folded onto the rig's 20 bones. The morph targets the runtime mixes (sex,
// age, fat, emaciation, muscle, a swollen belly) are posed the same way and stored as deltas, with
// the joints' deltas. The body is simplified (meshoptimizer, MIT) into six nested levels over one
// vertex pool (the levels are index lists); the eyes, teeth and tongue helpers ride along. Per
// vertex: position, MakeHuman UV, two rig bones and a weight, ambient occlusion (ray-marched through
// a voxelisation of the full-resolution body), the helper group.
//
// The output is one base64 blob in an ES module (no fetch at run time, so the model build stays
// synchronous and the one-file standalone build keeps working); actor-zbody.js decodes it.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBase, loadRig, loadTarget, jointPos } from './zbody/mh.js';
import { B, poseBones, vertexWeights, skin, toModel, pointToModel, rigWeights } from './zbody/pose.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/js/render3d/actor-zbody-data.js');
const objDir = process.argv.includes('--obj') ? process.argv[process.argv.indexOf('--obj') + 1] : null;

/** Simplification levels (body triangles). */
export const LEVELS = [16000, 9000, 6000, 3000, 1200, 500];
const QPOS = 400;          // int16 position quantisation (units × 400: ±81 units, 0.0025 resolution)
const HELPERS = ['helper-l-eye', 'helper-r-eye', 'helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue'];

/**
 * The posed, weighted MakeHuman body at full resolution and its simplified levels (also used by the
 * skin atlas baker, scripts/zbake/body.js): render vertices (rpos, ruv, rnrm, rao), the MakeHuman
 * vertex of each (RV), the rig weights (RW), the groups, the morph deltas, the joints, the levels.
 */
export async function buildBody({ levels: wantLevels = true, log = console.log } = {}) {
  const t0 = Date.now();
  const base = await loadBase();
  const rig = await loadRig();
  const MD = 'targets/macrodetails/';
  const tg = async (p) => loadTarget(p);
  const T = {
    M: await tg(MD + 'caucasian-male-young.target'), F: await tg(MD + 'caucasian-female-young.target'),
    Mo: await tg(MD + 'caucasian-male-old.target'), Fo: await tg(MD + 'caucasian-female-old.target'),
    uMfat: await tg(MD + 'universal-male-young-averagemuscle-maxweight.target'), uFfat: await tg(MD + 'universal-female-young-averagemuscle-maxweight.target'),
    uMthin: await tg(MD + 'universal-male-young-minmuscle-minweight.target'), uFthin: await tg(MD + 'universal-female-young-minmuscle-minweight.target'),
    uMmus: await tg(MD + 'universal-male-young-maxmuscle-averageweight.target'), uFmus: await tg(MD + 'universal-female-young-maxmuscle-averageweight.target'),
    belly: await tg('targets/stomach/stomach-pregnant-incr.target'),
  };
  log(`MakeHuman assets in ${Date.now() - t0} ms`);

  const nv = base.nv;
  /** Dense delta Σ k·target over the whole vertex list. */
  function dense(pairs) {
    const d = new Float64Array(nv * 3);
    for (const [t, k] of pairs) for (const [v, [x, y, z]] of t) { d[v * 3] += x * k; d[v * 3 + 1] += y * k; d[v * 3 + 2] += z * k; }
    return d;
  }
  // the neutral adult: half male, half female (MakeHuman's own default mix)
  const neutral = dense([[T.M, 0.5], [T.F, 0.5]]);
  const restPos = base.v.map((x, i) => x + neutral[i]);
  // the runtime's morphs (from the neutral adult)
  const MORPHS = {
    sex: dense([[T.F, 1], [T.M, -1]]),                                       // weight −0.5 male .. +0.5 female
    old: dense([[T.Mo, 0.5], [T.Fo, 0.5], [T.M, -0.5], [T.F, -0.5]]),
    fat: dense([[T.uMfat, 0.5], [T.uFfat, 0.5]]),
    thin: dense([[T.uMthin, 0.5], [T.uFthin, 0.5]]),
    muscle: dense([[T.uMmus, 0.5], [T.uFmus, 0.5]]),
    belly: dense([[T.belly, 1]]),
  };
  const MORPH_NAMES = Object.keys(MORPHS);

  // ---- groups --------------------------------------------------------------------------------
  const groupOf = new Int8Array(nv).fill(-1);    // -1 unused, 0 body, 1.. helpers (HELPERS index + 1)
  const faces = base.faces.filter((f) => f.g === 'body' || HELPERS.includes(f.g));
  for (const f of faces) { const g = f.g === 'body' ? 0 : HELPERS.indexOf(f.g) + 1; for (const v of f.v) groupOf[v] = g; }

  // ---- pose ----------------------------------------------------------------------------------
  const W = vertexWeights(rig, nv);
  const helperBone = (v) => (groupOf[v] === 4 || groupOf[v] === 5 ? 'jaw' : 'head');
  const { G, order } = poseBones(rig, restPos);
  const posed = skin(restPos, W, G, helperBone);
  let floor = Infinity;
  for (let v = 0; v < nv; v++) if (groupOf[v] === 0) floor = Math.min(floor, posed[v * 3 + 1]);
  const P = toModel(posed, floor);
  const zero = new Float64Array(nv * 3);
  const posedDelta = (d) => { const a = skin(d, W, G, helperBone), z = skin(zero, W, G, helperBone); return toModel(a.map((x, i) => x - z[i]), 0); };
  const MD_POSED = Object.fromEntries(MORPH_NAMES.map((n) => [n, posedDelta(MORPHS[n])]));
  const RW = rigWeights(W, rig.bones, (v) => (helperBone(v) === 'jaw' ? B.JAW : B.HEAD));

  // joints (rig pivots) in model space, posed, and their deltas per morph
  const PIV = {
    HIPS: ['upperleg01.L', 'upperleg01.R'], SPINE: ['spine03'], CHEST: ['spine02'], NECK: ['neck01'], HEAD: ['head'], JAW: ['jaw'],
    UARM_L: ['upperarm01.L'], FARM_L: ['lowerarm01.L'], HAND_L: ['wrist.L'], UARM_R: ['upperarm01.R'], FARM_R: ['lowerarm01.R'], HAND_R: ['wrist.R'],
    THIGH_L: ['upperleg01.L'], SHIN_L: ['lowerleg01.L'], FOOT_L: ['foot.L'], THIGH_R: ['upperleg01.R'], SHIN_R: ['lowerleg01.R'], FOOT_R: ['foot.R'],
    // landmarks: the eyes, the toes' tips, the finger tips (middle), the top of the skull
    EYE_L: ['eye.L'], EYE_R: ['eye.R'], TOE_L: ['toe3-1.L'], TOE_R: ['toe3-1.R'], TIP_L: ['finger3-3.L'], TIP_R: ['finger3-3.R'],
  };
  const PIV_NAMES = Object.keys(PIV);
  const applyG = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  function joints(pos) {
    return PIV_NAMES.map((k) => {
      const names = PIV[k];
      let x = 0, y = 0, z = 0;
      for (const n of names) {
        const tip = k.startsWith('TIP') || k.startsWith('TOE');
        const p = applyG(G[n], jointPos(rig, pos, tip ? rig.bones[n].tail : rig.bones[n].head));
        x += p[0] / names.length; y += p[1] / names.length; z += p[2] / names.length;
      }
      return pointToModel([x, y, z], floor);
    });
  }
  const J0 = joints(restPos);
  const JD = Object.fromEntries(MORPH_NAMES.map((n) => {
    const j = joints(restPos.map((x, i) => x + MORPHS[n][i]));
    return [n, j.map((p, i) => [p[0] - J0[i][0], p[1] - J0[i][1], p[2] - J0[i][2]])];
  }));
  log('pivots', Object.fromEntries(PIV_NAMES.map((k, i) => [k, J0[i].map((x) => +x.toFixed(2))])));

  // ---- render vertices (position × uv) and triangles --------------------------------------------
  const key = new Map(), RV = [];   // [mhVertex, uvIndex]
  const vid = (v, t) => { const k = v * 65536 + t; let i = key.get(k); if (i === undefined) { i = RV.length; RV.push([v, t]); key.set(k, i); } return i; };
  const bodyTris = [], helperTris = [];
  const dist2 = (a, b) => { const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz; };
  for (const f of faces) {
    const ids = f.v.map((v, k) => vid(v, f.t[k]));
    const out = f.g === 'body' ? bodyTris : helperTris;
    // MakeHuman faces are counter-clockwise seen from outside, as three's front faces
    if (ids.length === 3) out.push(ids[0], ids[1], ids[2]);
    else if (dist2(f.v[0], f.v[2]) <= dist2(f.v[1], f.v[3])) out.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    else out.push(ids[0], ids[1], ids[3], ids[1], ids[2], ids[3]);
  }
  const nR = RV.length;
  const rpos = new Float32Array(nR * 3), ruv = new Float32Array(nR * 2);
  RV.forEach(([v, t], i) => { rpos.set([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], i * 3); ruv[i * 2] = base.vt[t * 2]; ruv[i * 2 + 1] = base.vt[t * 2 + 1]; });

  /** Smooth normals of triangles over render vertices, welded by MakeHuman vertex. */
  function normals(tris) {
    const acc = new Float64Array(nv * 3);
    for (let i = 0; i < tris.length; i += 3) {
      const a = RV[tris[i]][0], b = RV[tris[i + 1]][0], c = RV[tris[i + 2]][0];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; }
    }
    const n = new Float32Array(nR * 3);
    RV.forEach(([v], i) => { const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1; n.set([acc[v * 3] / l, acc[v * 3 + 1] / l, acc[v * 3 + 2] / l], i * 3); });
    return n;
  }
  const rnrm = normals(bodyTris.concat(helperTris));

  // ---- ambient occlusion (full-resolution body, voxels) -----------------------------------------
  function bakeAO() {
    const R = 0.5;    // voxel size (units)
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < nR; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], rpos[i * 3 + k]); mx[k] = Math.max(mx[k], rpos[i * 3 + k]); }
    mn = mn.map((x) => x - 4); mx = mx.map((x) => x + 4);
    const dims = mn.map((m, k) => Math.ceil((mx[k] - m) / R));
    const vox = new Uint8Array(dims[0] * dims[1] * dims[2]);
    const at = (x, y, z) => { const i = Math.floor((x - mn[0]) / R), j = Math.floor((y - mn[1]) / R), k = Math.floor((z - mn[2]) / R); return i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2] ? -1 : (k * dims[1] + j) * dims[0] + i; };
    // surface voxels (dense sampling of every triangle)
    const tris = bodyTris;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const n = Math.ceil(Math.max(Math.hypot(rpos[b] - rpos[a], rpos[b + 1] - rpos[a + 1], rpos[b + 2] - rpos[a + 2]), Math.hypot(rpos[c] - rpos[a], rpos[c + 1] - rpos[a + 1], rpos[c + 2] - rpos[a + 2])) / (R * 0.5)) + 1;
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        const q = at(rpos[a] * w + rpos[b] * u + rpos[c] * v, rpos[a + 1] * w + rpos[b + 1] * u + rpos[c + 1] * v, rpos[a + 2] * w + rpos[b + 2] * u + rpos[c + 2] * v);
        if (q >= 0) vox[q] = 1;
      }
    }
    // flood the outside; everything else (the surface and the inside) is solid
    const out = new Uint8Array(vox.length), stack = [0];
    out[0] = 1;
    while (stack.length) {
      const q = stack.pop();
      const i = q % dims[0], j = Math.floor(q / dims[0]) % dims[1], k = Math.floor(q / (dims[0] * dims[1]));
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= dims[0] || b >= dims[1] || c >= dims[2]) continue;
        const r = (c * dims[1] + b) * dims[0] + a;
        if (!out[r] && !vox[r]) { out[r] = 1; stack.push(r); }
      }
    }
    // rays: 48 directions over the hemisphere of the normal, 12 units long
    const dirs = [];
    for (let i = 0; i < 96; i++) { const y = 1 - (i + 0.5) / 48, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996; dirs.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    const ao = new Float32Array(nR);
    for (let v = 0; v < nR; v++) {
      const n = [rnrm[v * 3], rnrm[v * 3 + 1], rnrm[v * 3 + 2]];
      let open = 0, cnt = 0;
      for (const d of dirs) {
        const c = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        if (c <= 0.05) continue;
        cnt += c;
        let hit = false;
        for (let s = 1.2; s < 12; s += R * 0.8) {
          const q = at(rpos[v * 3] + n[0] * 0.6 + d[0] * s, rpos[v * 3 + 1] + n[1] * 0.6 + d[1] * s, rpos[v * 3 + 2] + n[2] * 0.6 + d[2] * s);
          if (q >= 0 && !out[q]) { hit = true; break; }
        }
        if (!hit) open += c;
      }
      ao[v] = cnt > 0 ? open / cnt : 1;
    }
    return ao;
  }
  const rao = bakeAO();
  log(`posed, ${nR} render vertices, ${bodyTris.length / 3} body triangles, AO in ${Date.now() - t0} ms`);

  // ---- levels -----------------------------------------------------------------------------------
  // (a dev dependency, loaded only when the levels are wanted: the atlas baker and the tests never need it)
  const { MeshoptSimplifier } = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  if (!wantLevels) return { base, rig, nv, RV, nR, rpos, ruv, rnrm, rao, bodyTris, helperTris, groupOf, RW, P, J0, JD, MD_POSED, MORPH_NAMES, PIV_NAMES, levels: [], t0 };
  const attrs = new Float32Array(nR * 5);
  for (let i = 0; i < nR; i++) attrs.set([ruv[i * 2] * 4, ruv[i * 2 + 1] * 4, rnrm[i * 3], rnrm[i * 3 + 1], rnrm[i * 3 + 2]], i * 5);
  const levels = [];
  let prev = Uint32Array.from(bodyTris);
  for (const target of LEVELS) {
    const [idx, err] = MeshoptSimplifier.simplifyWithAttributes(prev, rpos, 3, attrs, 5, [1, 1, 0.4, 0.4, 0.4], null, target * 3, 0.05, []);
    levels.push(idx);
    log(`level ${target}: ${idx.length / 3} triangles (error ${err.toFixed(4)})`);
    prev = idx;
  }
  // pool: the vertices of the first level and the helpers
  const used = new Int32Array(nR).fill(-1), pool = [];
  for (const idx of [levels[0], Uint32Array.from(helperTris)]) for (const i of idx) if (used[i] < 0) { used[i] = pool.length; pool.push(i); }
  const nP = pool.length;
  log(`pool ${nP} vertices`);

  return { base, rig, nv, RV, nR, rpos, ruv, rnrm, rao, bodyTris, helperTris, groupOf, RW, P, J0, JD, MD_POSED, MORPH_NAMES, PIV_NAMES, levels, t0, pool, used, nP };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { RV, nR, rpos, ruv, rao, helperTris, groupOf, RW, J0, JD, MD_POSED, MORPH_NAMES, PIV_NAMES, levels, t0, pool, used, nP } = await buildBody();
  // ---- pack -----------------------------------------------------------------------------------
  const parts = [];
  const header = { nP, levels: [], helpers: 0, morphs: MORPH_NAMES, pivots: PIV_NAMES, QPOS, j0: J0.map((p) => p.map((x) => +x.toFixed(4))), jd: {}, groups: ['body', ...HELPERS] };
  for (const n of MORPH_NAMES) header.jd[n] = JD[n].map((p) => p.map((x) => +x.toFixed(4)));
  const q16 = (x) => Math.max(-32767, Math.min(32767, Math.round(x * QPOS)));
  const pos16 = new Int16Array(nP * 3), uv16 = new Uint16Array(nP * 2), info = new Uint8Array(nP * 5);
  pool.forEach((r, i) => {
    const mv = RV[r][0];
    for (let k = 0; k < 3; k++) pos16[i * 3 + k] = q16(rpos[r * 3 + k]);
    uv16[i * 2] = Math.round(Math.min(1, Math.max(0, ruv[r * 2])) * 65535);
    uv16[i * 2 + 1] = Math.round(Math.min(1, Math.max(0, ruv[r * 2 + 1])) * 65535);
    const w = RW[mv];
    info.set([w.a, w.b, Math.round(w.w * 255), Math.round(Math.min(1, rao[r]) * 255), groupOf[mv]], i * 5);
  });
  parts.push(['pos', pos16], ['uv', uv16], ['info', info]);
  for (const n of MORPH_NAMES) {
    const d = new Int16Array(nP * 3);
    pool.forEach((r, i) => { const mv = RV[r][0]; for (let k = 0; k < 3; k++) d[i * 3 + k] = q16(MD_POSED[n][mv * 3 + k]); });
    parts.push(['m_' + n, d]);
  }
  levels.forEach((idx, k) => { const a = new Uint16Array(idx.length); idx.forEach((v, i) => { a[i] = used[v]; }); parts.push(['lv' + k, a]); header.levels.push(idx.length / 3); });
  { const a = Uint16Array.from(helperTris.map((v) => used[v])); parts.push(['helpers', a]); header.helpers = a.length / 3; }
  // one buffer, each part 4-byte aligned
  let size = 0;
  header.parts = {};
  for (const [n, a] of parts) { header.parts[n] = [size, a.length, a.constructor.name]; size += Math.ceil(a.byteLength / 4) * 4; }
  const buf = Buffer.alloc(size);
  for (const [n, a] of parts) Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(buf, header.parts[n][0]);
  const b64 = buf.toString('base64');
  const src = `// GENERATED by scripts/build-zbody.js from the MakeHuman base mesh, skeleton, weights and macro targets
  // (CC0, makehumancommunity/makehuman: see public/textures/CREDITS.md). Do not edit: rebuild.
  // The zombies' human body in the rig's rest pose (model units): ${nP} vertices, levels of ${header.levels.join(' / ')} body
  // triangles, morph deltas (${MORPH_NAMES.join(', ')}). Decoded by actor-zbody.js.
  export const ZBODY_HEADER = ${JSON.stringify(header)};
  export const ZBODY_DATA = '${b64}';
  `;
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, src);
  console.log(`wrote ${OUT} (${(src.length / 1024).toFixed(0)} KB) in ${Date.now() - t0} ms`);

  if (objDir) {
    await mkdir(objDir, { recursive: true });
    for (let k = 0; k < levels.length; k++) {
      let s = '';
      for (let i = 0; i < nR; i++) s += `v ${rpos[i * 3].toFixed(3)} ${rpos[i * 3 + 1].toFixed(3)} ${rpos[i * 3 + 2].toFixed(3)}\n`;
      const idx = levels[k];
      for (let i = 0; i < idx.length; i += 3) s += `f ${idx[i] + 1} ${idx[i + 1] + 1} ${idx[i + 2] + 1}\n`;
      await writeFile(join(objDir, `zbody-lv${k}.obj`), s);
    }
  }
}
