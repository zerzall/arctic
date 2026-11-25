// MakeHuman (CC0, https://github.com/makehumancommunity/makehuman) asset access for the zombie body
// builder (scripts/build-zbody.js): fetches the files it needs from raw.githubusercontent.com into a
// local cache, and parses the base mesh (OBJ, with its helper groups), morph targets, the default
// skeleton's joints and its skin weights.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export const MH_BASE = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/';
export const CACHE = process.env.MH_CACHE || join(tmpdir(), 'hh-makehuman-cache');

/** A MakeHuman data file (path under makehuman/data/), fetched once into the cache. */
export async function mhFile(path) {
  const local = join(CACHE, path);
  if (!existsSync(local)) {
    const res = await fetch(MH_BASE + path);
    if (!res.ok) throw new Error(`MakeHuman file ${path}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(local), { recursive: true });
    await writeFile(local, buf);
  }
  return readFile(local, 'utf8');
}

/**
 * The base mesh: v (Float64Array xyz), vt (uv), faces [{ v: [..], t: [..], g: group }], groups.
 * MakeHuman units are decimetres, +Y up, the body faces +Z.
 */
export async function loadBase() {
  const txt = await mhFile('3dobjs/base.obj');
  const v = [], vt = [], faces = [];
  let g = '';
  for (const line of txt.split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('vt ')) { const p = line.split(/\s+/); vt.push(+p[1], +p[2]); }
    else if (line.startsWith('g ')) g = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1);
      faces.push({ v: p.map((s) => (s.split('/')[0] | 0) - 1), t: p.map((s) => (s.split('/')[1] | 0) - 1), g });
    }
  }
  return { v: Float64Array.from(v), vt: Float64Array.from(vt), faces, nv: v.length / 3 };
}

/** A target: Map vertex → [dx, dy, dz]. */
export async function loadTarget(path) {
  const txt = await mhFile(path);
  const m = new Map();
  for (const line of txt.split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    m.set(p[0] | 0, [+p[1], +p[2], +p[3]]);
  }
  return m;
}

/** Skeleton: { bones: { name: { head, tail, parent } }, joints: { name: [verts] } } and the weights { bone: [[v, w]...] }. */
export async function loadRig() {
  const skel = JSON.parse(await mhFile('rigs/default.mhskel'));
  const w = JSON.parse(await mhFile('rigs/default_weights.mhw'));
  return { bones: skel.bones, joints: skel.joints, weights: w.weights };
}

/** A joint's position on a mesh: the mean of its helper vertices. */
export function jointPos(rig, pos, name) {
  const vs = rig.joints[name];
  let x = 0, y = 0, z = 0;
  for (const i of vs) { x += pos[i * 3]; y += pos[i * 3 + 1]; z += pos[i * 3 + 2]; }
  return [x / vs.length, y / vs.length, z / vs.length];
}
