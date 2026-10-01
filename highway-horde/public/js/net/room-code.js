// Room codes: ROOM_CODE_LENGTH characters from ROOM_CODE_ALPHABET (no 0/O/1/I/L).

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/constants.js';

/**
 * A random room code. Uses crypto.getRandomValues so codes are not guessable in sequence.
 * @returns {string}
 */
export function randomRoomCode() {
  const bytes = new Uint32Array(ROOM_CODE_LENGTH);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 0x100000000);
  }
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  return code;
}

/**
 * Normalise what a player typed (case, spaces, dashes).
 * @param {string} input
 * @returns {string|null} a well-formed code, or null if it cannot be one
 */
export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}
