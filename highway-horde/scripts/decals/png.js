// Minimal PNG encoder / decoder (RGBA 8-bit, non-interlaced) on node's zlib. Deterministic: the same
// pixels always give the same bytes (fixed filter choice per row, fixed zlib level).

import { deflateSync, inflateSync } from 'node:zlib';

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}
export function crc32(buf, start = 0, end = buf.length) {
  let c = -1;
  for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Encode RGBA pixels (Uint8Array w*h*4) as a PNG Buffer. Each row picks the filter (none, sub, up,
 * paeth) with the smallest sum of absolute residuals.
 */
export function encodePNG(w, h, rgba, level = 9) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    const o = y * stride, po = o - stride;
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 4; f++) {
      const out = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const x = rgba[o + i];
        const a = i >= 4 ? rgba[o + i - 4] : 0;
        const b = y > 0 ? rgba[po + i] : 0;
        const c = i >= 4 && y > 0 ? rgba[po + i - 4] : 0;
        const v = f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : x - paeth(a, b, c);
        const r = v & 255;
        out[i] = r;
        score += r < 128 ? r : 256 - r;
        if (score >= bestScore) break;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    // (re-run the winner: the early exit may have left its buffer partly written)
    const out = cand[best];
    for (let i = 0; i < stride; i++) {
      const x = rgba[o + i];
      const a = i >= 4 ? rgba[o + i - 4] : 0;
      const b = y > 0 ? rgba[po + i] : 0;
      const c = i >= 4 && y > 0 ? rgba[po + i - 4] : 0;
      out[i] = (best === 0 ? x : best === 1 ? x - a : best === 2 ? x - b : x - paeth(a, b, c)) & 255;
    }
    raw[y * (stride + 1)] = [0, 1, 2, 4][best];
    out.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decode an 8-bit RGBA (colour type 6) or RGB (2) non-interlaced PNG; checks every CRC.
 * @returns {{ w, h, data: Uint8Array }} RGBA
 */
export function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, type = 0;
  const idat = [];
  let ended = false;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const t = buf.toString('ascii', p + 4, p + 8);
    const crc = buf.readUInt32BE(p + 8 + len);
    if (crc32(buf, p + 4, p + 8 + len) !== crc) throw new Error(`bad CRC in ${t}`);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || (type !== 6 && type !== 2) || data[12] !== 0) throw new Error('unsupported PNG');
    } else if (t === 'IDAT') idat.push(data);
    else if (t === 'IEND') { ended = true; break; }
    p += 12 + len;
  }
  if (!ended) throw new Error('PNG without IEND');
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  if (raw.length !== (stride + 1) * h) throw new Error('PNG data size mismatch');
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, o = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[o + i - bpp] : 0;
      const b = y > 0 ? px[o - stride + i] : 0;
      const c = i >= bpp && y > 0 ? px[o - stride + i - bpp] : 0;
      px[o + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }
  if (bpp === 4) return { w, h, data: px };
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = px[i * 3]; out[i * 4 + 1] = px[i * 3 + 1]; out[i * 4 + 2] = px[i * 3 + 2]; out[i * 4 + 3] = 255; }
  return { w, h, data: out };
}
