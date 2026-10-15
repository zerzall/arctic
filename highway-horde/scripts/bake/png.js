// A minimal PNG codec on node's zlib (no dependencies): 8-bit grey / RGB / RGBA images, written
// with a per-row adaptive filter (the one with the smallest sum of absolute residuals, as libpng
// does) and read back for the tests and the preview tool. Output is a pure function of the pixels:
// the same image always gives the same bytes.

import { deflateSync, inflateSync, crc32 as zcrc32, constants } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_OF = { 0: 1, 2: 3, 6: 4 };
const TYPE_OF = { 1: 0, 3: 2, 4: 6 };

// (zlib.crc32 exists from node 20.15 / 22.2; a table otherwise)
let CRC_T = null;
function crc32(buf) {
  if (typeof zcrc32 === 'function') return zcrc32(buf) >>> 0;
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Encode 8-bit pixels as a PNG.
 * @param {Uint8Array} px width × height × channels bytes, rows top to bottom
 * @param {number} w
 * @param {number} h
 * @param {number} ch 1 (grey), 3 (RGB) or 4 (RGBA)
 * @param {{ level?: number }} [opt] zlib level (default 9)
 * @returns {Buffer}
 */
export function encodePNG(px, w, h, ch, opt = {}) {
  if (!TYPE_OF[ch] && TYPE_OF[ch] !== 0) throw new Error('channels must be 1, 3 or 4');
  if (px.length !== w * h * ch) throw new Error(`pixel buffer is ${px.length} bytes, expected ${w * h * ch}`);
  const stride = w * ch;
  const out = Buffer.alloc((stride + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = y * stride, prev = (y - 1) * stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = px[row + i];
        const a = i >= ch ? px[row + i - ch] : 0;
        const b = y > 0 ? px[prev + i] : 0;
        const cc = y > 0 && i >= ch ? px[prev + i - ch] : 0;
        let v;
        switch (f) {
          case 0: v = x; break;
          case 1: v = x - a; break;
          case 2: v = x - b; break;
          case 3: v = x - ((a + b) >> 1); break;
          default: v = x - paeth(a, b, cc);
        }
        v &= 255;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // (the early exit above leaves the best candidate complete only if it ran to the end: redo it)
    const o = y * (stride + 1);
    out[o] = best;
    const c = cand[best];
    for (let i = 0; i < stride; i++) {
      const x = px[row + i];
      const a = i >= ch ? px[row + i - ch] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const cc = y > 0 && i >= ch ? px[prev + i - ch] : 0;
      let v;
      switch (best) {
        case 0: v = x; break;
        case 1: v = x - a; break;
        case 2: v = x - b; break;
        case 3: v = x - ((a + b) >> 1); break;
        default: v = x - paeth(a, b, cc);
      }
      c[i] = v & 255;
    }
    c.copy(out, o + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = TYPE_OF[ch];
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(out, { level: opt.level ?? 9, memLevel: 9, strategy: constants.Z_FILTERED });
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Decode an 8-bit, non-interlaced grey / RGB / RGBA PNG (what encodePNG writes).
 * @param {Buffer|Uint8Array} buf
 * @returns {{ width: number, height: number, channels: number, data: Uint8Array }}
 */
export function decodePNG(buf) {
  buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    const crc = buf.readUInt32BE(p + 8 + len);
    if (crc32(buf.subarray(p + 4, p + 8 + len)) !== crc) throw new Error(`bad CRC in ${type}`);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs');
      ch = CHANNELS_OF[data[9]];
      if (!ch) throw new Error(`colour type ${data[9]} unsupported`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length !== (stride + 1) * h) throw new Error('bad image data length');
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= ch ? px[row + i - ch] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const c = y > 0 && i >= ch ? px[prev + i - ch] : 0;
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${f}`);
      }
      px[row + i] = v & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: px };
}
