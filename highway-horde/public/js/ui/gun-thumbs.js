// Gun pictures for the buy menu (ui/shop.js): a side view of each gun's 3D model (the light
// variant of render3d/actor-guns.js) painted into a canvas — its triangles projected onto the
// gun's right side and filled back to front with their vertex colour under a simple key light,
// so it reads as a small render — or, where the 3D models can't be loaded, the gun's top-down
// sprite (render/actors.js). Both modules are loaded on first use (this file imports nothing,
// so the shop stays importable without a browser). Pictures are drawn once per gun and size.

const cache = new Map();          // `${id}:${w}x${h}` → canvas
let guns3d = null, sprites = null, loading = null;

function load() {
  if (!loading) {
    loading = import('../render3d/actor-guns.js')
      .then((m) => { guns3d = m; })
      .catch(() => Promise.all([import('../render/actors.js'), import('../shared/weapons.js')])
        .then(([a, w]) => { sprites = { drawWeapon: a.drawWeapon, WEAPONS: w.WEAPONS }; }))
      .catch(() => {});
  }
  return loading;
}

const toSrgb = (c) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2));

/**
 * Paint the side view of a gun model: every triangle of its parts, nearest (+Z: the gun's
 * right side) last, muzzle to the right.
 */
function paintModel(g, model, w, h) {
  const geos = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, nt = 0;
  for (const key in model.geos) {
    const geo = model.geos[key];
    const P = geo.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] < x0) x0 = P[i];
      if (P[i] > x1) x1 = P[i];
      if (P[i + 1] < y0) y0 = P[i + 1];
      if (P[i + 1] > y1) y1 = P[i + 1];
    }
    geos.push({ geo, glow: key.endsWith(':glow') });
    nt += geo.index ? geo.index.count / 3 : P.length / 9;
  }
  if (!nt || !(x1 > x0)) return;
  const pad = 6;
  const s = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
  const ox = (w - (x1 - x0) * s) / 2 - x0 * s, oy = (h + (y1 - y0) * s) / 2 + y0 * s;
  // triangles sorted far to near
  const depth = new Float32Array(nt), ref = new Uint32Array(nt * 2);
  let t = 0;
  for (let gi = 0; gi < geos.length; gi++) {
    const geo = geos[gi].geo;
    const P = geo.attributes.position.array;
    const I = geo.index ? geo.index.array : null;
    const n = I ? I.length / 3 : P.length / 9;
    for (let k = 0; k < n; k++) {
      const a = I ? I[k * 3] : k * 3, b = I ? I[k * 3 + 1] : k * 3 + 1, c = I ? I[k * 3 + 2] : k * 3 + 2;
      depth[t] = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3 + (geos[gi].glow ? 0.02 : 0);
      ref[t * 2] = gi;
      ref[t * 2 + 1] = k;
      t++;
    }
  }
  const order = new Uint32Array(nt);
  for (let i = 0; i < nt; i++) order[i] = i;
  order.sort((p, q) => depth[p] - depth[q]);
  // a key light from above and in front, a little fill from the back
  const lx = -0.25, ly = 0.75, lz = 0.6, ll = Math.hypot(lx, ly, lz);
  g.lineJoin = 'round';
  g.lineWidth = 0.6;
  for (let o = 0; o < nt; o++) {
    const tt = order[o];
    const { geo, glow } = geos[ref[tt * 2]];
    const k = ref[tt * 2 + 1];
    const P = geo.attributes.position.array, N = geo.attributes.normal.array, C = geo.attributes.color.array;
    const I = geo.index ? geo.index.array : null;
    const a = I ? I[k * 3] : k * 3, b = I ? I[k * 3 + 1] : k * 3 + 1, c = I ? I[k * 3 + 2] : k * 3 + 2;
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    const lambert = Math.max(0, (nx * lx + ny * ly + nz * lz) / (nl * ll));
    const rim = Math.max(0, nz / nl) * 0.35;
    // (lifted: most guns are near-black and the cards are dark)
    const k2 = glow ? 1.6 : 0.5 + lambert * 0.95 + rim;
    const r = (C[a * 3] + C[b * 3] + C[c * 3]) / 3 * k2, gg = (C[a * 3 + 1] + C[b * 3 + 1] + C[c * 3 + 1]) / 3 * k2, bb = (C[a * 3 + 2] + C[b * 3 + 2] + C[c * 3 + 2]) / 3 * k2;
    const col = `rgb(${toSrgb(r)},${toSrgb(gg)},${toSrgb(bb)})`;
    g.fillStyle = col;
    g.strokeStyle = col;
    g.beginPath();
    g.moveTo(ox + P[a * 3] * s, oy - P[a * 3 + 1] * s);
    g.lineTo(ox + P[b * 3] * s, oy - P[b * 3 + 1] * s);
    g.lineTo(ox + P[c * 3] * s, oy - P[c * 3 + 1] * s);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** The fallback: the top-down sprite, scaled to fit. */
function paintSprite(g, id, w, h) {
  const sp = sprites && sprites.WEAPONS[id] && sprites.WEAPONS[id].sprite;
  if (!sp) return;
  const len = sp.len + 18;
  const s = Math.min((w - 12) / len, (h - 12) / (sp.width * 2.2));
  g.save();
  g.translate(w / 2 - (sp.len * s) / 2 + 4 * s, h / 2);
  g.scale(s, s);
  sprites.drawWeapon(g, id, 0, 0);
  g.restore();
}

/**
 * A picture of gun `id` (CSS size w × h, drawn at the device pixel ratio), or null while the
 * renderers load; `onReady` is called once it can be had.
 * @param {string} id weapon id
 * @param {number} w CSS pixels
 * @param {number} h CSS pixels
 * @param {Function} [onReady]
 * @returns {HTMLCanvasElement|null}
 */
export function gunThumb(id, w, h, onReady) {
  const key = `${id}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!guns3d && !sprites) {
    load().then(() => { if (onReady && (guns3d || sprites)) onReady(); });
    return null;
  }
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr * 2);
  c.height = Math.round(h * dpr * 2);
  const g = c.getContext('2d');
  // drawn at twice the size and scaled down: the triangle seams vanish
  g.scale(dpr * 2, dpr * 2);
  try {
    if (guns3d) paintModel(g, guns3d.gunModel(id, true), w, h);
    else paintSprite(g, id, w, h);
  } catch (err) {
    console.warn('gun picture failed', id, err);
  }
  const out = document.createElement('canvas');
  out.width = Math.round(w * dpr);
  out.height = Math.round(h * dpr);
  const og = out.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, 0, 0, out.width, out.height);
  cache.set(key, out);
  return out;
}
