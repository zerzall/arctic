import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix, QR_MAX_BYTES } from '../../shared/qr.js';

// shared/qr.js is checked by decoding what it produces with a decoder written here from the standard's point of view
// (no code shared with the encoder), plus fixed oracles: the published format-information words for level L, and the
// data capacities of versions 1-6. The encoder was additionally round-tripped through the third-party jsQR decoder for
// every payload length 0..134 while it was written; a golden hash below pins that verified output.

// ---- An independent decoder --------------------------------------------------------------------------------

// The 15-bit format words for level L and masks 0..7, as printed in the standard (ISO/IEC 18004, table C.1).
const FORMAT_WORDS_L = [0b111011111000100, 0b111001011110011, 0b111110110101010, 0b111100010011101,
  0b110011000101111, 0b110001100011000, 0b110110001000001, 0b110100101110110];

const MASK_TESTS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// (data codewords, ecc codewords per block, blocks) of versions 1..6 at level L, from the standard's table 9.
const TABLE_L = [null, [19, 7, 1], [34, 10, 1], [55, 15, 1], [80, 20, 1], [108, 26, 1], [136, 18, 2]];

// Multiplication in GF(2^8) mod 0x11D without lookup tables (shift and add), unlike the encoder's log tables.
function mulSlow(a, b) {
  let product = 0;
  while (b) {
    if (b & 1) product ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>= 1;
  }
  return product;
}

// A codeword sequence is a valid Reed-Solomon word iff it evaluates to zero at alpha^0 .. alpha^(ecc-1).
function syndromesAreZero(block, ecc) {
  let alphaPower = 1;
  for (let i = 0; i < ecc; i++) {
    let acc = 0;
    for (const word of block) acc = mulSlow(acc, alphaPower) ^ word;
    if (acc !== 0) return false;
    alphaPower = mulSlow(alphaPower, 2);
  }
  return true;
}

function isFunctionModule(row, col, size, version) {
  if (row <= 8 && col <= 8) return true;                    // top-left finder, separator, format strips
  if (row <= 8 && col >= size - 8) return true;             // top-right finder, separator, format strip
  if (row >= size - 8 && col <= 8) return true;             // bottom-left finder, separator, format strip, dark module
  if (row === 6 || col === 6) return true;                  // timing patterns
  if (version >= 2 && Math.abs(row - (size - 7)) <= 2 && Math.abs(col - (size - 7)) <= 2) return true;
  return false;
}

function decode(matrix) {
  const size = matrix.length;
  assert.ok(matrix.every((row) => row.length === size), 'square');
  const version = (size - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 6, `size ${size} is a version 1-6 size`);
  const bit = (row, col) => (matrix[row][col] ? 1 : 0);

  // Format information, first copy (around the top-left finder) and second copy (split between the other two).
  let first = 0;
  const firstCells = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  firstCells.forEach(([row, col], i) => { first |= bit(row, col) << (14 - i); });   // most significant bit first
  let second = 0;
  const secondCells = [];
  for (let i = 0; i < 7; i++) secondCells.push([size - 1 - i, 8]);
  for (let i = 0; i < 8; i++) secondCells.push([8, size - 8 + i]);
  secondCells.forEach(([row, col], i) => { second |= bit(row, col) << (14 - i); });
  assert.equal(second, first, 'both format copies agree');
  const mask = FORMAT_WORDS_L.indexOf(first);
  assert.notEqual(mask, -1, `format word ${first.toString(2)} is a level-L word`);
  assert.equal(matrix[size - 8][8], true, 'the dark module');

  // Data modules in reading order: column pairs from the right, upward first, alternating, skipping the timing column.
  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) {
      const row = upward ? size - 1 - n : n;
      for (const col of [right, right - 1]) {
        if (isFunctionModule(row, col, size, version)) continue;
        bits.push(bit(row, col) ^ (MASK_TESTS[mask](row, col) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const [dataWords, ecc, blocks] = TABLE_L[version];
  const total = dataWords + ecc * blocks;
  assert.ok(bits.length >= total * 8 && bits.length - total * 8 === (version === 1 ? 0 : 7), 'remainder bits');
  const words = [];
  for (let i = 0; i < total; i++) words.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));

  // De-interleave into blocks and check every block against the Reed-Solomon definition.
  const perBlock = dataWords / blocks;
  const data = [];
  for (let b = 0; b < blocks; b++) {
    const block = [];
    for (let i = 0; i < perBlock; i++) block.push(words[i * blocks + b]);
    const eccWords = [];
    for (let i = 0; i < ecc; i++) eccWords.push(words[dataWords + i * blocks + b]);
    assert.ok(syndromesAreZero([...block, ...eccWords], ecc), `block ${b} is a valid Reed-Solomon codeword`);
    data.push(...block);
  }

  // Byte mode: 0100, an 8-bit length, the bytes, a terminator, zero padding to a byte, then EC 11 EC 11 ...
  const stream = data.map((w) => w.toString(2).padStart(8, '0')).join('');
  assert.equal(stream.slice(0, 4), '0100', 'byte mode indicator');
  const length = parseInt(stream.slice(4, 12), 2);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(parseInt(stream.slice(12 + i * 8, 20 + i * 8), 2));
  let used = 12 + length * 8;
  const terminator = Math.min(4, stream.length - used);
  used += terminator;
  const alignedTo = Math.ceil(used / 8) * 8;
  assert.equal(stream.slice(used - terminator, alignedTo), '0'.repeat(alignedTo - used + terminator), 'terminator and padding bits are zero');
  for (let w = alignedTo / 8, pad = 0xec; w < data.length; w++, pad = pad === 0xec ? 0x11 : 0xec) assert.equal(data[w], pad, `pad codeword ${w}`);
  return { version, mask, text: Buffer.from(bytes).toString('utf8'), bytes: bytes.length };
}

// ---- Tests -------------------------------------------------------------------------------------------------

const invite = 'https://small-frog-42.trycloudflare.com/r/KQXZ';

test('the invite link encodes to a symbol an independent decoder reads back', () => {
  const m = qrMatrix(invite);
  assert.ok(Array.isArray(m) && m.every((row) => Array.isArray(row) && row.every((v) => typeof v === 'boolean')));
  const d = decode(m);
  assert.equal(d.text, invite);
  assert.equal(d.version, 3, '46 bytes fit version 3-L (53 bytes)');
});

test('capacities of versions 1-6 at level L: the smallest version that fits is chosen', () => {
  const expected = [[0, 21], [17, 21], [18, 25], [32, 25], [33, 29], [53, 29], [54, 33], [78, 33], [79, 37], [106, 37], [107, 41], [134, 41]];
  for (const [bytes, size] of expected) {
    const m = qrMatrix('x'.repeat(bytes));
    assert.equal(m.length, size, `${bytes} bytes -> ${size}x${size}`);
    assert.equal(decode(m).text, 'x'.repeat(bytes));
  }
  assert.equal(QR_MAX_BYTES, 134);
});

test('too long text and non-strings give null instead of a wrong symbol', () => {
  assert.equal(qrMatrix('x'.repeat(135)), null);
  assert.equal(qrMatrix('\u00e9'.repeat(68)), null, '68 two-byte characters are 136 bytes');
  assert.notEqual(qrMatrix('\u00e9'.repeat(67)), null, '134 bytes still fit');
  for (const v of [undefined, null, 42, {}, ['a']]) assert.equal(qrMatrix(v), null);
});

test('every version round-trips ASCII, punctuation and UTF-8 (lengths count bytes, not characters)', () => {
  const samples = [
    'K', 'BCDFGHJKLMNPQRSTVWXZ', 'http://192.168.1.23:3000/r/BCDF', ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
    'h\u00e9llo w\u00f6rld', 'Blast Party \u{1F389}\u{1F4A3}', '\u3042\u3044\u3046', '\u0000\u0001\u007f', 'A'.repeat(106), 'z9'.repeat(67),
  ];
  for (const text of samples) {
    const d = decode(qrMatrix(text));
    assert.equal(d.text, text);
  }
});

test('a lone surrogate is replaced by U+FFFD rather than producing invalid UTF-8', () => {
  assert.equal(decode(qrMatrix('a\ud800b')).text, 'a\ufffdb');
});

test('the fixed patterns are where the standard puts them', () => {
  for (const text of ['a', 'x'.repeat(40), 'x'.repeat(134)]) {
    const m = qrMatrix(text);
    const size = m.length;
    const finderAt = (top, left) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          assert.equal(m[top + r][left + c], ring !== 2, `finder ${top},${left} module ${r},${c}`);
        }
      }
    };
    finderAt(0, 0);
    finderAt(0, size - 7);
    finderAt(size - 7, 0);
    for (let i = 8; i < size - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, `horizontal timing ${i}`);
      assert.equal(m[i][6], i % 2 === 0, `vertical timing ${i}`);
    }
    for (let i = 0; i < 8; i++) {   // light separators
      assert.equal(m[7][i], false);
      assert.equal(m[i][7], false);
      assert.equal(m[7][size - 1 - i], false);
      assert.equal(m[i][size - 8], false);
      assert.equal(m[size - 8][i], false);
      assert.equal(m[size - 1 - i][7], false);
    }
    assert.equal(m[size - 8][8], true, 'always-dark module');
    if (size > 21) {
      const c = size - 7;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) assert.equal(m[c + dr][c + dc], Math.max(Math.abs(dr), Math.abs(dc)) !== 1, 'alignment pattern');
    }
  }
});

test('the format information carries level L and the mask the encoder used', () => {
  const masks = new Set();
  for (let n = 0; n < 60; n++) {
    const d = decode(qrMatrix(`${n}:${'ab'.repeat(n % 40)}`));
    masks.add(d.mask);
  }
  assert.ok(masks.size >= 3, `several masks get chosen over varied payloads (saw ${[...masks]})`);
  assert.deepEqual(FORMAT_WORDS_L.map((w) => w.toString(16)), ['77c4', '72f3', '7daa', '789d', '662f', '6318', '6c41', '6976'], 'oracle table transcribed correctly');
});

test('encoding is deterministic and returns fresh arrays each time', () => {
  const a = qrMatrix(invite);
  const b = qrMatrix(invite);
  assert.deepEqual(a, b);
  a[0][0] = !a[0][0];
  assert.notDeepEqual(a, qrMatrix(invite));
  assert.deepEqual(b, qrMatrix(invite));
});

test('golden: the invite symbol is byte-for-byte the one verified with jsQR', () => {
  const rows = qrMatrix('https://192.168.1.23:3000/r/KQXZ').map((row) => row.map((v) => (v ? '#' : '.')).join('')).join('\n');
  assert.equal(createHash('sha1').update(rows).digest('hex'), 'dae870114ee48fcb1089bcfefc8f128571b1aa3b');
});
