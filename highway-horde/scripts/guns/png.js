// PNG writer / reader for the gun textures on node's zlib: 8-bit grey, grey+alpha, RGB or RGBA,
// non-interlaced. Deterministic (fixed filter heuristic, fixed zlib settings): the same pixels
// always give the same bytes.

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

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };
const CHANNELS = { 0: 1, 4: 2, 2: 3, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Encode 8-bit pixels (Uint8Array w*h*ch, ch = 1..4) as a PNG Buffer. Each row takes the filter
 * (none, sub, up, average, paeth) with the smallest sum of absolute residuals.
 */
export function encodePNG(w, h, ch, px, level = 6) {
  if (!COLOR_TYPE[ch] && COLOR_TYPE[ch] !== 0) throw new Error(`png: ${ch} channels`);
  const stride = w * ch;
  if (px.length !== stride * h) throw new Error(`png: ${px.length} bytes for ${w}x${h}x${ch}`);
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  const score = new Float64Array(5);
  for (let y = 0; y < h; y++) {
    const o = y * stride, po = o - stride;
    score.fill(0);
    for (let i = 0; i < stride; i++) {
      const x = px[o + i];
      const a = i >= ch ? px[o + i - ch] : 0;
      const b = y > 0 ? px[po + i] : 0;
      const c = i >= ch && y > 0 ? px[po + i - ch] : 0;
      const r0 = x, r1 = (x - a) & 255, r2 = (x - b) & 255, r3 = (x - ((a + b) >> 1)) & 255, r4 = (x - paeth(a, b, c)) & 255;
      cand[0][i] = r0; cand[1][i] = r1; cand[2][i] = r2; cand[3][i] = r3; cand[4][i] = r4;
      score[0] += r0 < 128 ? r0 : 256 - r0;
      score[1] += r1 < 128 ? r1 : 256 - r1;
      score[2] += r2 < 128 ? r2 : 256 - r2;
      score[3] += r3 < 128 ? r3 : 256 - r3;
      score[4] += r4 < 128 ? r4 : 256 - r4;
    }
    let best = 0;
    for (let f = 1; f < 5; f++) if (score[f] < score[best]) best = f;
    raw[y * (stride + 1)] = best;
    raw.set(cand[best], y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = COLOR_TYPE[ch]; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decode an 8-bit non-interlaced PNG (any of the colour types above).
 * @returns {{ w, h, ch, data: Uint8Array }}
 */
export function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('png: bad signature');
  let p = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const crc = buf.readUInt32BE(p + 8 + len);
    if (crc32(buf, p + 4, p + 8 + len) !== crc) throw new Error(`png: bad crc in ${type}`);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('png: only 8-bit non-interlaced');
      ch = CHANNELS[data[9]];
      if (!ch) throw new Error(`png: colour type ${data[9]}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length !== (stride + 1) * h) throw new Error('png: bad data length');
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const ri = y * (stride + 1) + 1, o = y * stride, po = o - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[ri + i];
      const a = i >= ch ? out[o + i - ch] : 0;
      const b = y > 0 ? out[po + i] : 0;
      const c = i >= ch && y > 0 ? out[po + i - ch] : 0;
      out[o + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }
  return { w, h, ch, data: out };
}
