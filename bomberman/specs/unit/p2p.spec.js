import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  CODE_PREFIX, SignalError, encodeSignal, decodeSignal, extractCode, checkSdp, validateBlob, checksum, b64urlEncode, b64urlDecode,
  HostSession, GuestConnection, GuestSession, createTicker, guestHello, gatherCandidates, MAX_BLOB_BYTES, P2P_TIMEOUTS,
} from '../../client/js/p2p.js';
import { FakeClock } from '../helpers/fake-clock.js';

// ==================================================================================================
// Realistic session descriptions (what Chrome writes for a data-channel-only connection) and helpers
// ==================================================================================================

const FP = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase()).join(':');
const OFFER = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:842163049 1 udp 1677729535 203.0.113.7 51234 typ srflx raddr 192.168.1.20 rport 51234 generation 0 ufrag abcd network-cost 999',
  'a=candidate:1 1 udp 2113937151 192.168.1.20 51234 typ host generation 0 network-cost 999',
  'a=candidate:2 1 udp 2113937151 3f2a8c1e-aaaa-bbbb-cccc-1234567890ab.local 51234 typ host generation 0 network-cost 999',
  'a=candidate:3 1 udp 2113939711 2001:db8::1 51236 typ host generation 0',
  'a=ice-ufrag:abcd', 'a=ice-pwd:0123456789abcdef0123456789abcdef', 'a=ice-options:trickle', `a=fingerprint:sha-256 ${FP}`, 'a=setup:actpass', 'a=mid:0',
  'a=sctp-port:5000', 'a=max-message-size:262144',
];
const ANSWER = OFFER.map((l) => (l === 'a=setup:actpass' ? 'a=setup:active' : l));
const sdpOf = (lines) => `${lines.join('\r\n')}\r\n`;
const withLine = (lines, extra, at = lines.length) => [...lines.slice(0, at), extra, ...lines.slice(at)];

/** Builds a code from an arbitrary blob, the way encodeSignal would, so hostile payloads can be crafted. */
function craft(blob, { compress = true } = {}) {
  const raw = Buffer.from(typeof blob === 'string' ? blob : JSON.stringify(blob));
  const body = compress ? deflateRawSync(raw) : raw;
  const payload = b64urlEncode(Buffer.concat([Buffer.from([compress ? 1 : 0]), body]));
  return `${CODE_PREFIX}${payload}.${checksum(payload)}`;
}
const goodBlob = (over = {}) => ({ v: 1, t: 'o', i: 'abc123XY', h: 'Ada', s: OFFER.join('\n'), ...over });

async function rejects(fn, code) {
  await assert.rejects(fn, (err) => {
    assert.ok(err instanceof SignalError, `expected a SignalError, got ${err?.stack ?? err}`);
    assert.ok(err.message.length > 10 && !/undefined|\[object/.test(err.message), err.message);
    if (code) assert.equal(err.code, code, err.message);
    return true;
  });
}

// ==================================================================================================
// Codes
// ==================================================================================================

describe('p2p codes: encode and decode', () => {
  it('round-trips an offer and an answer, on one line, with the versioned prefix', async () => {
    const offer = await encodeSignal({ type: 'offer', sdp: sdpOf(OFFER), id: 'abc123XY', host: 'Ada' });
    assert.match(offer, /^BP1-[A-Za-z0-9_-]+\.[2-9A-HJ-NP-Z]{4}$/);
    assert.ok(!/\s/.test(offer));
    const back = await decodeSignal(offer, 'offer');
    assert.deepEqual({ ...back }, { type: 'offer', id: 'abc123XY', host: 'Ada', game: '', sdp: sdpOf(OFFER) });
    const tagged = await decodeSignal(await encodeSignal({ type: 'offer', sdp: sdpOf(OFFER), id: 'abc123XY', host: 'Ada', game: 'Game123x' }), 'offer');
    assert.equal(tagged.game, 'Game123x');
    const answer = await encodeSignal({ type: 'answer', sdp: sdpOf(ANSWER), id: 'abc123XY' });
    const got = await decodeSignal(answer, 'answer');
    assert.equal(got.type, 'answer');
    assert.equal(got.host, '');
    assert.equal(got.sdp, sdpOf(ANSWER));
  });

  it('is compact: a typical invite is well under 1 KB of text', async () => {
    const offer = await encodeSignal({ type: 'offer', sdp: sdpOf(OFFER), id: 'abc123XY', host: 'Ada' });
    assert.ok(offer.length < 900, `${offer.length} characters`);
    assert.ok(offer.length < sdpOf(OFFER).length);
  });

  it('decodes an uncompressed code too (browsers without CompressionStream)', async () => {
    const code = craft(goodBlob(), { compress: false });
    const back = await decodeSignal(code, 'offer');
    assert.equal(back.id, 'abc123XY');
  });

  it('base64url is strict', () => {
    assert.deepEqual([...b64urlDecode(b64urlEncode(Uint8Array.from([0, 1, 2, 250, 251, 252, 253])))], [0, 1, 2, 250, 251, 252, 253]);
    assert.equal(b64urlDecode('ab+/'), null);
    assert.equal(b64urlDecode('abc='), null);
    assert.equal(b64urlDecode('a'), null);
    assert.equal(b64urlDecode('éééé'), null);
  });

  it('checksum is 4 unambiguous characters and changes with the text', () => {
    assert.match(checksum('hello'), /^[2-9A-HJ-NP-Z]{4}$/);
    assert.notEqual(checksum('hello'), checksum('hellp'));
  });
});

describe('p2p codes: pasted text', () => {
  let code;
  it('setup', async () => { code = await encodeSignal({ type: 'offer', sdp: sdpOf(OFFER), id: 'abc123XY', host: 'Ada' }); });

  it('finds the code inside a sentence and ignores what follows it', async () => {
    assert.equal(extractCode(`Hey! Here is my code: ${code} thanks, see you soon :)`), code);
    assert.equal(extractCode(`${code}thanks`), code);
    assert.equal(extractCode(`Join my game!\n\n${code}\n\nBring snacks`), code);
  });

  it('survives line wrapping, quotes, backticks, zero-width characters and fancy dashes', () => {
    const wrapped = code.replace(/(.{40})/g, '$1\n');
    assert.equal(extractCode(wrapped), code);
    assert.equal(extractCode(`“${code}”`), code);
    assert.equal(extractCode(`\`${code}\``), code);
    assert.equal(extractCode(`  ​${code.slice(0, 10)}​‍${code.slice(10)}﻿  `), code);
    assert.equal(extractCode(code.replace('BP1-', 'BP1–')), code);
    assert.equal(extractCode(code.replace('BP1-', 'BP1—')), code);
    assert.equal(extractCode(code.replace('BP1-', 'bp1-')), code);
    assert.equal(extractCode(`<${code}>`), code);
  });

  it('a lower-cased checksum still matches', async () => {
    const dot = code.lastIndexOf('.');
    const lowered = code.slice(0, dot + 1) + code.slice(dot + 1).toLowerCase();
    assert.equal(extractCode(lowered), code);
    await decodeSignal(lowered, 'offer');
  });

  it('returns nothing for text without a complete code', () => {
    assert.equal(extractCode(''), '');
    assert.equal(extractCode(null), '');
    assert.equal(extractCode('hello there'), '');
    assert.equal(extractCode('BP1-'), '');
    assert.equal(extractCode('BP1-abcdef'), '');
    assert.equal(extractCode('BP1-abcdef.AB'), '');
    assert.equal(extractCode(code.slice(0, -2)), '');
  });
});

describe('p2p codes: friendly errors for what people really paste', () => {
  it('empty and nonsense', async () => {
    await rejects(() => decodeSignal('', 'offer'), 'empty');
    await rejects(() => decodeSignal('   \n ', 'offer'), 'empty');
    await rejects(() => decodeSignal(undefined, 'offer'), 'empty');
    await rejects(() => decodeSignal('hello world', 'offer'), 'not_code');
    await rejects(() => decodeSignal('https://example.com/r/ABCD', 'offer'), 'not_code');
    await rejects(() => decodeSignal('ABCD', 'offer'), 'not_code');
  });

  it('a cut-off or altered code is "damaged", never a crash', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: sdpOf(OFFER), id: 'abc123XY', host: 'Ada' });
    await rejects(() => decodeSignal(code.slice(0, 60), 'offer'), 'damaged');
    await rejects(() => decodeSignal(code.slice(0, -1), 'offer'), 'damaged');
    const at = 30;
    const flipped = code.slice(0, at) + (code[at] === 'A' ? 'B' : 'A') + code.slice(at + 1);
    await rejects(() => decodeSignal(flipped, 'offer'), 'damaged');
    await rejects(() => decodeSignal(`BP1-....`, 'offer'), 'damaged');
  });

  it('a code from a later version says so', async () => {
    await rejects(() => decodeSignal('BP2-abcdefgh.ABCD', 'offer'), 'version');
    const payload = b64urlEncode(Uint8Array.from([7, 1, 2, 3]));
    await rejects(() => decodeSignal(`BP1-${payload}.${checksum(payload)}`, 'offer'), 'version');
    await rejects(() => decodeSignal(craft(goodBlob({ v: 2 })), 'offer'), 'version');
  });

  it('a reply pasted where an invite belongs, and the other way round', async () => {
    const offer = await encodeSignal({ type: 'offer', sdp: sdpOf(OFFER), id: 'abc123XY', host: 'Ada' });
    const answer = await encodeSignal({ type: 'answer', sdp: sdpOf(ANSWER), id: 'abc123XY' });
    await assert.rejects(() => decodeSignal(answer, 'offer'), (e) => e.code === 'wrong_kind' && /reply/.test(e.message) && /host/i.test(e.message));
    await assert.rejects(() => decodeSignal(offer, 'answer'), (e) => e.code === 'wrong_kind' && /joining/.test(e.message));
  });
});

describe('p2p codes: hostile input never reaches RTCPeerConnection', () => {
  const bad = async (blob, code = 'invalid', opts) => rejects(() => decodeSignal(craft(blob, opts), 'offer'), code);

  it('non-objects, arrays, extra fields and prototype tricks', async () => {
    await bad('null');
    await bad('[]');
    await bad('42');
    await bad('"BP1"');
    await bad('{not json', 'damaged');
    await bad({ ...goodBlob(), extra: 1 });
    await bad(JSON.parse('{"v":1,"t":"o","i":"abc123XY","__proto__":{"x":1},"s":"v=0"}'));
    await bad(goodBlob({ constructor: 'x' }));
  });

  it('wrong field types and values', async () => {
    await bad(goodBlob({ t: 'x' }));
    await bad(goodBlob({ t: 1 }));
    await bad(goodBlob({ i: 5 }));
    await bad(goodBlob({ i: 'a b c d e f' }));
    await bad(goodBlob({ i: '<script>' }));
    await bad(goodBlob({ i: 'x'.repeat(40) }));
    await bad(goodBlob({ h: { a: 1 } }));
    await bad(goodBlob({ h: 'x'.repeat(200) }));
    await bad(goodBlob({ s: 12 }));
    await bad(goodBlob({ s: '' }));
    await bad(goodBlob({ s: null }));
  });

  it('the host name is cleaned of control and bidi characters', () => {
    const got = validateBlob(goodBlob({ h: '‮Ada\u0007​' }), 'offer');
    assert.equal(got.host, 'Ada');
  });

  it('SDP: only the expected line types', async () => {
    const withExtra = (extra, at) => goodBlob({ s: withLine(OFFER, extra, at).join('\n') });
    await bad(withExtra('m=audio 9 UDP/TLS/RTP/SAVPF 111'));
    await bad(withExtra('m=video 9 UDP/TLS/RTP/SAVPF 96'));
    await bad(withExtra('a=candidate:9 1 udp 1 1.2.3.4 5 typ host; rm -rf /'));
    await bad(withExtra('a=candidate:9 1 sctp 1 1.2.3.4 5 typ host'));
    await bad(withExtra('a=candidate:9 1 udp 1 http://evil.example 5 typ host'));
    await bad(withExtra('a=candidate:9 1 udp 1 evil.example.com 5 typ host'));
    await bad(withExtra('a=fingerprint:md5 AA:BB'));
    await bad(withExtra('k=clear:secret'));
    await bad(withExtra('z=2882844526 -1h'));
    await bad(withExtra('\u0000'));
    await bad(withExtra('a=ice-ufrag:ab\tcd'));
    await bad(withExtra('a=ice-ufrag:café'));
    await bad(withExtra('', 5));
  });

  it('SDP: harmless extra attributes and bandwidth lines are dropped, not refused; a malformed line of a kind that matters still is', () => {
    const extras = ['a=rtpmap:111 opus/48000/2', 'a=ssrc:1 cname:evil', 'a=identity:abc', 'b=AS:1000000', 'a=rtcp-mux', 'a=sendonly'];
    const got = validateBlob(goodBlob({ s: [...OFFER.slice(0, 8), ...extras, ...OFFER.slice(8)].join('\n') }), 'offer');
    for (const line of extras) assert.ok(!got.sdp.includes(line), `${line} must not reach RTCPeerConnection`);
    assert.equal(got.sdp, sdpOf(OFFER));
    assert.throws(() => validateBlob(goodBlob({ s: withLine(OFFER, 'a=ice-pwd:x y').join('\n') }), 'offer'), SignalError);
  });

  it('SDP: descriptions shaped like Firefox and Safari are accepted (hand-written from their known output; not captured from the real browsers)', () => {
    const FF_FP = Array.from({ length: 32 }, (_, i) => (255 - i * 5).toString(16).padStart(2, '0').toUpperCase()).join(':');
    for (const version of ['99.0', '115.0.2', '128.0.3', '131.0.2', '140.1.0', '141.0.3', '133.0a1']) {
      const firefox = [
        'v=0', `o=mozilla...THIS_IS_SDPARTA-${version} 3926456792395349301 0 IN IP4 0.0.0.0`, 's=-', 't=0 0', `a=fingerprint:sha-256 ${FF_FP}`, 'a=group:BUNDLE 0',
        'a=ice-options:trickle', 'a=msid-semantic:WMS *', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
        'a=candidate:0 1 UDP 2122252543 192.168.1.5 55317 typ host', 'a=candidate:1 1 TCP 2105524479 192.168.1.5 9 typ host tcptype active',
        'a=candidate:2 1 UDP 1686052863 203.0.113.9 55317 typ srflx raddr 192.168.1.5 rport 55317',
        'a=sendrecv', 'a=ice-pwd:0123456789abcdef0123456789abcdef', 'a=ice-ufrag:1a2b3c4d', 'a=mid:0', 'a=setup:actpass', 'a=sctp-port:5000', 'a=max-message-size:1073741823',
      ];
      const got = validateBlob(goodBlob({ s: firefox.join('\n') }), 'offer');
      assert.equal(got.sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:')).length, 3, version);
    }
    const safari = [
      'v=0', 'o=- 8160287412391123456 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=ice-ufrag:kZ3T', 'a=ice-pwd:0123456789abcdef01234567', 'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${FP}`, 'a=setup:active', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
      'a=candidate:1994888765 1 udp 2113937151 3f2a8c1e-aaaa-bbbb-cccc-1234567890ab.local 61234 typ host generation 0 ufrag kZ3T network-cost 999',
    ];
    assert.equal(validateBlob(goodBlob({ t: 'a', h: undefined, s: safari.join('\n') }), 'answer').type, 'answer');
  });

  it('SDP: shape and roles', async () => {
    await bad(goodBlob({ s: OFFER.filter((l) => !l.startsWith('a=fingerprint')).join('\n') }));
    await bad(goodBlob({ s: OFFER.filter((l) => !l.startsWith('a=ice-pwd')).join('\n') }));
    await bad(goodBlob({ s: OFFER.filter((l) => !l.startsWith('a=ice-ufrag')).join('\n') }));
    await bad(goodBlob({ s: OFFER.filter((l) => !l.startsWith('m=')).join('\n') }));
    await bad(goodBlob({ s: [...OFFER, 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel'].join('\n') }));
    await bad(goodBlob({ s: OFFER.slice(1).join('\n') }));
    await bad(goodBlob({ s: ANSWER.join('\n') }));                                     // an answer's roles inside an offer
    await bad(goodBlob({ t: 'a', s: OFFER.join('\n') }), 'wrong_kind');                 // and the other way round: also refused
    await bad(goodBlob({ s: OFFER.map((l) => (l.startsWith('a=fingerprint') ? 'a=fingerprint:sha-256 AA:BB' : l)).join('\n') }));
  });

  it('SDP: size limits', async () => {
    const many = Array.from({ length: 31 }, (_, i) => `a=candidate:${i} 1 udp 1 10.0.0.${i} 5000 typ host`);
    await bad(goodBlob({ s: withLine(OFFER, many.join('\n'), 9).join('\n') }));
    const lines = Array.from({ length: 90 }, () => 'a=mid:0');
    await bad(goodBlob({ s: [...OFFER, ...lines].join('\n') }));
    await bad(goodBlob({ s: `${OFFER.join('\n')}\n${'a'.repeat(6000)}` }), 'too_big');
    await bad(goodBlob({ s: `${OFFER.join('\n')}\na=ice-ufrag:${'a'.repeat(300)}` }));
  });

  it('a decompression bomb is stopped at the size limit, not expanded', async () => {
    const raw = Buffer.alloc(9_000_000, 0x20);
    const packed = deflateRawSync(raw);
    assert.ok(packed.length < 9000, `${packed.length} compressed bytes`);
    const payload = b64urlEncode(Buffer.concat([Buffer.from([1]), packed]));
    assert.ok(payload.length <= 12288, 'small enough to pass the length check, so the stream limit is what stops it');
    const started = Date.now();
    await rejects(() => decodeSignal(`BP1-${payload}.${checksum(payload)}`, 'offer'), 'too_big');
    const paste = 'BP1-' + 'A'.repeat(30000) + '.ABCD';
    await rejects(() => decodeSignal(paste, 'offer'), 'too_big');
    assert.ok(Date.now() - started < 3000);
  });

  it('invalid UTF-8 and oversized plain payloads', async () => {
    const payload = b64urlEncode(Buffer.concat([Buffer.from([0]), Buffer.from([0xff, 0xfe, 0xfd, 0x7b, 0x7d])]));
    await rejects(() => decodeSignal(`BP1-${payload}.${checksum(payload)}`, 'offer'), 'damaged');
    const huge = b64urlEncode(Buffer.concat([Buffer.from([0]), Buffer.alloc(MAX_BLOB_BYTES + 10, 0x20)]));
    await rejects(() => decodeSignal(`BP1-${huge}.${checksum(huge)}`, 'offer'), 'too_big');
  });

  it('checkSdp accepts real-world variations', () => {
    assert.equal(checkSdp(OFFER.join('\n'), 'offer'), 4);
    assert.equal(checkSdp(ANSWER.join('\n'), 'answer'), 4);
    assert.equal(checkSdp(ANSWER.join('\n').replace('a=setup:active', 'a=setup:passive'), 'answer'), 4);
    const firefox = [
      'v=0', 'o=mozilla...THIS_IS_SDPARTA-99.0 6254 0 IN IP4 0.0.0.0', 's=-', 't=0 0', 'a=sendrecv', `a=fingerprint:sha-256 ${FP}`, 'a=group:BUNDLE 0',
      'a=ice-options:trickle', 'a=msid-semantic:WMS *', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
      'a=candidate:0 1 UDP 2122252543 192.168.1.5 55555 typ host', 'a=sendrecv', 'a=end-of-candidates', 'a=ice-pwd:0123456789abcdef0123456789abcdef',
      'a=ice-ufrag:1a2b3c4d', 'a=mid:0', 'a=setup:actpass', 'a=sctp-port:5000', 'a=max-message-size:1073741823',
    ];
    assert.equal(checkSdp(firefox.join('\n'), 'offer'), 1);
  });
});

// ==================================================================================================
// The host: friends behind data channels
// ==================================================================================================

class FakeChannel {
  constructor() {
    this.readyState = 'open';
    this.bufferedAmount = 0;
    this.sent = [];
    this.handlers = new Map();
    this.closed = false;
  }

  addEventListener(type, fn) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== fn)); }
  fire(type, ev = {}) { for (const fn of this.handlers.get(type) ?? []) fn(ev); }
  send(text) { if (this.readyState !== 'open') throw new Error('InvalidStateError'); this.sent.push(text); }
  close() { this.closed = true; this.readyState = 'closed'; queueMicrotask(() => this.fire('close')); }
  say(obj) { this.fire('message', { data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  frames() { return this.sent.map((s) => JSON.parse(s)); }
  types() { return this.frames().map((f) => f.t); }
}

function makeHost(env = {}) {
  const clock = new FakeClock(1000);
  const ticker = { kind: 'fake', setTimer: clock.setTimer, clearTimer: clock.clearTimer, dispose() {} };
  const session = new HostSession({ name: 'Ada', env: { now: clock.now, ticker, ...env } });
  const events = [];
  session.on((ev) => events.push(ev));
  const local = session.localConnection();
  const inbox = [];
  local.onmessage = (m) => inbox.push(m);
  return { session, clock, events, local, inbox };
}

const seatHost = async (h) => {
  h.local.send({ t: 'create', v: 1, name: 'Ada' });
  await Promise.resolve();
  return h.local.pid;
};
const join = (h, name = 'Bo', extra = {}) => {
  const dc = new FakeChannel();
  const peer = h.session.adoptChannel(dc, null, 'inv1');
  dc.say({ t: 'join', v: 1, name, code: 'P2P', ...extra });
  return { dc, peer };
};

describe('p2p host: the Room and its friends', () => {
  it('seats the host as player 0 and a friend behind a data channel as player 1, with the ordinary joined/lobby frames', async () => {
    const h = makeHost();
    assert.equal(await seatHost(h), 0);
    assert.equal(h.inbox[0].t, 'joined');
    assert.equal(h.inbox[0].code, 'P2P');
    assert.equal(h.inbox[1].t, 'lobby');
    assert.equal(h.inbox[1].hostId, 0);
    const { dc } = join(h);
    assert.deepEqual(dc.types().slice(0, 2), ['joined', 'lobby']);
    const joined = dc.frames()[0];
    assert.equal(joined.id, 1);
    assert.match(joined.token, /^[0-9a-f]{32}$/);
    const lobby = dc.frames()[1];
    assert.equal(lobby.players.length, 2);
    assert.equal(lobby.hostId, 0);
    assert.equal(lobby.you, 1);
    assert.equal(h.events.find((e) => e.state === 'joined').pid, 1);
    assert.equal(h.session.friendCount, 1);
    h.session.shutdown();
  });

  it('a friend cannot get in before the host is seated', () => {
    const h = makeHost();
    const { dc } = join(h);
    assert.deepEqual(dc.frames()[0], { t: 'error', code: 'no_room', msg: 'That room does not exist.' });
    assert.equal(dc.closed, true);
    h.session.shutdown();
  });

  it('a friend messages go to the Room: chat reaches the host, host-only commands are refused', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc } = join(h);
    dc.say({ t: 'chat', text: 'hi Ada' });
    await Promise.resolve();
    assert.ok(h.inbox.some((m) => m.t === 'chat' && m.text === 'hi Ada' && m.from === 1));
    dc.say({ t: 'addBot', level: 'easy' });
    assert.ok(dc.frames().some((f) => f.t === 'error' && f.code === 'not_host'));
    dc.say({ t: 'ping', ts: 5 });
    assert.deepEqual(dc.frames().at(-1), { t: 'pong', ts: 5 });
    h.session.shutdown();
  });

  it('first-frame rules of server/ws.js: bad json, wrong version, stray frames, oversize and binary frames', async () => {
    const h = makeHost();
    await seatHost(h);
    const a = new FakeChannel();
    h.session.adoptChannel(a, null, 'a');
    a.say('not json');
    assert.deepEqual(a.frames()[0].code, 'bad_msg');
    assert.equal(a.closed, true);

    const b = new FakeChannel();
    h.session.adoptChannel(b, null, 'b');
    b.say({ t: 'join', v: 99, name: 'x', code: 'P2P' });
    assert.equal(b.frames()[0].code, 'version');
    assert.equal(b.closed, true);

    const c = new FakeChannel();
    h.session.adoptChannel(c, null, 'c');
    for (let i = 0; i < 8; i++) c.say({ t: 'ping', ts: i });
    assert.equal(c.closed, false);                      // valid but useless frames get a small allowance
    c.say({ t: 'ping', ts: 9 });
    assert.equal(c.closed, true);

    const d = new FakeChannel();
    h.session.adoptChannel(d, null, 'd');
    d.fire('message', { data: new ArrayBuffer(8) });
    assert.equal(d.closed, false);                      // a binary frame is dropped, not fatal
    d.say({ t: 'join', v: 1, name: 'Dee', code: 'P2P' });
    assert.equal(d.types()[0], 'joined');

    const e = new FakeChannel();
    h.session.adoptChannel(e, null, 'e');
    e.say('x'.repeat(5000));
    assert.equal(e.closed, true);                       // the first oversize frame ends the friendship (server/ws.js maxPayload does the same)
    h.session.shutdown();
  });

  it('a silent hello is closed after the deadline', async () => {
    const h = makeHost();
    await seatHost(h);
    const dc = new FakeChannel();
    h.session.adoptChannel(dc, null, 'x');
    h.clock.advance(9000);
    assert.equal(dc.closed, false);
    h.clock.advance(2000);
    assert.equal(dc.closed, true);
    h.session.shutdown();
  });

  it('a flood of junk frames after joining closes the channel', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc } = join(h);
    for (let i = 0; i < 60; i++) dc.say('x'.repeat(5000));
    assert.equal(dc.closed, true);
    h.session.shutdown();
  });

  it('snapshots are dropped for a channel that is not draining; other frames still go out; a huge backlog closes it', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc } = join(h);
    const before = dc.sent.length;
    dc.bufferedAmount = 200 * 1024;
    h.session.room._send(h.session.room._byId.get(1), '{"t":"snap","x":1}');
    h.session.room._send(h.session.room._byId.get(1), '{"t":"chat","text":"y"}');
    assert.equal(dc.sent.length, before + 1);
    dc.bufferedAmount = 2 * 1024 * 1024;
    h.session.room._send(h.session.room._byId.get(1), '{"t":"chat","text":"z"}');
    assert.equal(dc.closed, true);
    h.session.shutdown();
  });

  it('a channel that closes marks the friend as reconnecting; a NEW channel with the same token brings the character back', async () => {
    const h = makeHost();
    await seatHost(h);
    const first = join(h, 'Bo');
    const token = first.dc.frames()[0].token;
    first.dc.close();
    await Promise.resolve();
    const room = h.session.room;
    assert.equal(room._byId.get(1).connected, false);
    assert.ok(h.events.some((e) => e.state === 'lost'));
    const second = join(h, 'Bo', { token });
    const joined = second.dc.frames()[0];
    assert.equal(joined.t, 'joined');
    assert.equal(joined.id, 1);
    assert.equal(joined.token, token);
    assert.equal(room._byId.get(1).connected, true);
    assert.equal(room.entries.filter((e) => !e.isBot).length, 2);
    h.session.shutdown();
  });

  it('the old channel of a reconnecting friend is closed as replaced, and its late close changes nothing', async () => {
    const h = makeHost();
    await seatHost(h);
    const first = join(h, 'Bo');
    const token = first.dc.frames()[0].token;
    const second = join(h, 'Bo', { token });
    assert.equal(first.dc.closed, true);
    first.dc.fire('close');
    assert.equal(h.session.room._byId.get(1).connected, true);
    assert.equal(second.dc.frames()[0].id, 1);
    h.session.shutdown();
  });

  it('a friend nobody hears from for 25 s is dropped', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc } = join(h);
    h.clock.advance(10000);
    dc.say({ t: 'ping', ts: 1 });
    h.clock.advance(20000);
    assert.equal(dc.closed, false);
    h.clock.advance(6000);
    assert.equal(dc.closed, true);
    assert.equal(h.session.room._byId.get(1).connected, false);
    h.session.shutdown();
  });

  it('a frozen host does not judge its friends by its own silence', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc, peer } = join(h);
    h.clock.ms += 60000;                               // the whole page slept for a minute: no timer ran
    h.clock.advance(2000);                             // the first sweep after waking up
    assert.equal(dc.closed, false);
    assert.ok(h.clock.now() - peer.lastRx < 3000);
    h.session.shutdown();
  });

  it('the host ending the game tells every friend and closes every channel', async () => {
    const h = makeHost();
    await seatHost(h);
    const a = join(h, 'Bo');
    const b = join(h, 'Cy');
    const closed = [];
    h.local.onclose = (info) => closed.push(info);
    h.local.close();
    await Promise.resolve();
    for (const { dc } of [a, b]) {
      assert.ok(dc.frames().some((f) => f.t === 'error' && f.code === 'closed'));
      assert.equal(dc.closed, true);
    }
    assert.deepEqual(closed.map((c) => c.byUser), [true]);
    assert.equal(h.session.room.closed, true);
  });

  it('gives longer graces than the server (a reconnect needs a whole new handshake)', () => {
    const h = makeHost();
    assert.equal(h.session.room.timeouts.GRACE_MATCH_MS, P2P_TIMEOUTS.GRACE_MATCH_MS);
    assert.ok(h.session.room.timeouts.GRACE_MATCH_MS >= 120000);
    assert.ok(h.session.room.timeouts.GRACE_LOBBY_MS >= 300000);
    h.session.shutdown();
  });

  it('the Room runs on the injected ticker: a match advances with the clock and the host page never pumps it', async () => {
    const h = makeHost();
    await seatHost(h);
    join(h, 'Bo');
    h.local.send({ t: 'addBot', level: 'easy' });
    h.local.send({ t: 'settings', patch: { rounds: 1 } });
    h.local.send({ t: 'start' });
    assert.equal(h.session.room.phase, 'match');
    const seq = () => h.inbox.filter((m) => m.t === 'snap').length;
    h.clock.advance(1000);
    await Promise.resolve();
    assert.ok(seq() >= 15, `${seq()} snapshots in a second of clock`);
    h.session.shutdown();
  });

  it('a guest conn round-trips the whole join as GuestConnection sees it', async () => {
    const h = makeHost();
    await seatHost(h);
    const dc = new FakeChannel();
    h.session.adoptChannel(dc, null, 'i');
    // the friend's side of the same channel: whatever it sends arrives at the host, whatever the host sends arrives at the friend
    const friend = new FakeChannel();
    const realSend = friend.send.bind(friend);
    friend.send = (text) => { realSend(text); dc.say(text); };
    const origSend = dc.send.bind(dc);
    dc.send = (text) => { origSend(text); friend.say(text); };
    const clock = new FakeClock(0);
    const conn = new GuestConnection(friend, null, { now: clock.now, doc: null, setRepeat: () => 1, clearRepeat: () => {} });
    const got = [];
    conn.onmessage = (m) => got.push(m);
    let opened = 0;
    conn.onopen = () => opened++;
    await Promise.resolve();
    assert.equal(opened, 1);
    assert.equal(conn.send({ t: 'chat', text: 'early' }), false, 'nothing but create/join/ping before joined');
    assert.equal(conn.send(guestHello({ name: 'Bo', token: '' })), true);
    assert.deepEqual(got.map((m) => m.t).slice(0, 2), ['joined', 'lobby']);
    assert.equal(conn.send({ t: 'chat', text: 'hello host' }), true);
    await Promise.resolve();
    assert.ok(h.inbox.some((m) => m.t === 'chat' && m.text === 'hello host'));
    h.session.shutdown();
  });
});

// ==================================================================================================
// The friend's connection, the ticker and the handshake plumbing
// ==================================================================================================

describe('p2p guest connection', () => {
  const make = () => {
    const dc = new FakeChannel();
    const clock = new FakeClock(0);
    const handlers = [];
    const doc = { hidden: false, addEventListener: (t, f) => handlers.push(f), removeEventListener() {}, show() { this.hidden = false; handlers.forEach((f) => f()); } };
    const beats = [];
    const conn = new GuestConnection(dc, null, { now: clock.now, doc, setRepeat: (fn) => { beats.push(fn); return beats.length; }, clearRepeat: () => {} });
    const closes = [];
    conn.onclose = (info) => closes.push(info);
    return { dc, clock, doc, conn, closes, beat: () => beats.forEach((fn) => fn()) };
  };

  it('reports a fatal join error once, then closes', () => {
    const { dc, conn, closes } = make();
    conn.send({ t: 'join', v: 1, name: 'x', code: 'P2P' });
    dc.say({ t: 'error', code: 'full', msg: 'full' });
    assert.equal(closes.length, 1);
    assert.deepEqual({ fatal: closes[0].fatal, reason: closes[0].reason }, { fatal: true, reason: 'full' });
    assert.equal(conn.readyState, 3);
    assert.equal(dc.closed, true);
  });

  it('"closed" then the channel closing is the host ending the game; a bare channel close is a lost link', async () => {
    const a = make();
    a.dc.say({ t: 'joined', id: 1, token: 't', code: 'P2P', seq: 0 });
    a.dc.say({ t: 'error', code: 'closed', msg: 'Room closed.' });
    a.dc.fire('close');
    assert.equal(a.closes.length, 1);
    assert.equal(a.closes[0].hostEnded, true);
    assert.equal(a.closes[0].lost, false);
    const b = make();
    b.dc.fire('close');
    assert.equal(b.closes[0].lost, true);
    assert.equal(b.closes[0].hostEnded, false);
  });

  it('a kicked frame is final', () => {
    const { dc, closes } = make();
    dc.say({ t: 'joined', id: 1, token: 't', code: 'P2P', seq: 0 });
    dc.say({ t: 'kicked' });
    assert.equal(closes[0].reason, 'kicked');
    assert.equal(closes[0].fatal, true);
  });

  it('close() by the player reports byUser once', () => {
    const { conn, closes } = make();
    conn.close();
    conn.close();
    assert.equal(closes.length, 1);
    assert.equal(closes[0].byUser, true);
  });

  it('pings on every beat and declares a silent link dead only while visible', () => {
    const { dc, clock, doc, conn, closes, beat } = make();
    dc.say({ t: 'joined', id: 1, token: 't', code: 'P2P', seq: 0 });
    beat();
    assert.equal(dc.types().filter((t) => t === 'ping').length, 1);
    doc.hidden = true;
    clock.advance(60000);
    conn.checkLiveness();
    assert.equal(closes.length, 0);
    doc.show();
    conn.checkLiveness();
    assert.equal(closes.length, 0, 'the clock of a page that was hidden restarts at "visible"');
    clock.advance(11000);
    conn.checkLiveness();
    assert.equal(closes.length, 1);
    assert.equal(closes[0].lost, true);
  });

  it('garbage frames are ignored', () => {
    const { dc, closes } = make();
    dc.say('not json');
    dc.say('null');
    dc.say('42');
    dc.fire('message', { data: new ArrayBuffer(4) });
    assert.equal(closes.length, 0);
  });
});

describe('p2p misc', () => {
  it('guestHello has the shape parseClientMessage accepts, with an optional token', () => {
    assert.deepEqual(guestHello({ name: 'Bo', token: '' }), { t: 'join', v: 1, name: 'Bo', code: 'P2P' });
    assert.equal(guestHello({ name: 'Bo', token: 'abc' }).token, 'abc');
  });

  it('a hosted Room is never a "local" one and its code is not a valid 4-letter room code', async () => {
    const h = makeHost();
    await seatHost(h);
    assert.equal(h.inbox[1].local, undefined);
    assert.ok(!/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(h.inbox[0].code));
    h.session.shutdown();
  });

  it('createTicker falls back to plain timers without Workers, and runs them', async () => {
    const ticker = createTicker({});
    assert.equal(ticker.kind, 'timers');
    const fired = await new Promise((resolve) => { ticker.setTimer(() => resolve('yes'), 5); });
    assert.equal(fired, 'yes');
    let ran = false;
    const h = ticker.setTimer(() => { ran = true; }, 5);
    ticker.clearTimer(h);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ran, false);
    ticker.dispose();
  });

  it('createTicker uses a worker when it answers and falls back when it does not', async () => {
    class GoodWorker {
      constructor() { this.timers = new Map(); }
      postMessage(m) {
        if (m[0] === 's') this.timers.set(m[1], setTimeout(() => this.onmessage({ data: m[1] }), m[2]));
        else if (m[0] === 'c') clearTimeout(this.timers.get(m[1]));
      }
      terminate() { this.dead = true; }
    }
    const env = { Worker: GoodWorker, Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, probeMs: 50 };
    const good = createTicker(env);
    assert.equal(good.kind, 'worker');
    const got = await new Promise((resolve) => { good.setTimer(() => resolve('tick'), 5); });
    assert.equal(got, 'tick');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(good.kind, 'worker', 'the probe was answered, so no fallback');
    good.dispose();

    class DeafWorker { postMessage() {} terminate() { this.dead = true; } }
    const deaf = createTicker({ ...env, Worker: DeafWorker, probeMs: 30 });
    assert.equal(deaf.kind, 'worker');
    const pendingTick = new Promise((resolve) => { deaf.setTimer(() => resolve('rescued'), 10); });
    assert.equal(await pendingTick, 'rescued', 'a timer armed before the fallback still fires');
    assert.equal(deaf.kind, 'timers');
    deaf.dispose();

    class ThrowingWorker { constructor() { throw new Error('blocked'); } }
    const blocked = createTicker({ ...env, Worker: ThrowingWorker });
    assert.equal(blocked.kind, 'timers');
    blocked.dispose();
  });

  it('gatherCandidates finishes on completion, on the first public candidate, or on the deadline', async () => {
    const makePc = () => {
      const handlers = new Map();
      return {
        iceGatheringState: 'gathering',
        addEventListener: (t, f) => handlers.set(t, f),
        removeEventListener: (t) => handlers.delete(t),
        fire: (t, ev) => handlers.get(t)?.(ev),
      };
    };
    const a = makePc();
    const pa = gatherCandidates(a, 100000);
    a.fire('icecandidate', { candidate: null });
    assert.ok(typeof (await pa) === 'number');
    const b = makePc();
    const t0 = Date.now();
    const pb = gatherCandidates(b, 100000);
    b.fire('icecandidate', { candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host' } });
    b.fire('icecandidate', { candidate: { candidate: 'candidate:2 1 udp 1 5.6.7.8 5 typ srflx raddr 0.0.0.0 rport 0' } });
    await pb;
    assert.ok(Date.now() - t0 < 2000);
    const c = makePc();
    const t1 = Date.now();
    await gatherCandidates(c, 60);
    assert.ok(Date.now() - t1 >= 50);
  });

  it('GuestSession rejects a bad paste before creating any peer connection', async () => {
    let created = 0;
    const session = new GuestSession({ env: { RTCPeerConnection: class { constructor() { created++; } } } });
    await rejects(() => session.acceptInvite('hello'), 'not_code');
    const answer = await encodeSignal({ type: 'answer', sdp: sdpOf(ANSWER), id: 'abc123XY' });
    await rejects(() => session.acceptInvite(answer), 'wrong_kind');
    assert.equal(created, 0);
  });

  it('HostSession.acceptReply rejects hostile and mismatched replies before touching the connection', async () => {
    const h = makeHost();
    let remote = 0;
    const pcs = [];
    class FakePc {
      constructor() { this.iceGatheringState = 'complete'; this.handlers = new Map(); pcs.push(this); }
      addEventListener(t, f) { this.handlers.set(t, f); }
      removeEventListener() {}
      createDataChannel() { return new FakeChannel(); }
      async createOffer() { return { type: 'offer', sdp: sdpOf(OFFER) }; }
      async setLocalDescription() { this.localDescription = { type: 'offer', sdp: sdpOf(OFFER) }; }
      async setRemoteDescription() { remote++; }
      close() { this.closed = true; }
    }
    h.session.env.RTCPeerConnection = FakePc;
    h.session.env.pcCloseMs = 5;
    const invite = await h.session.createInvite();
    assert.match(invite.code, /^BP1-/);
    const decoded = await decodeSignal(invite.code, 'offer');
    assert.equal(decoded.host, 'Ada');
    assert.equal(decoded.id, invite.id);
    await rejects(() => h.session.acceptReply(invite.code), 'wrong_kind');
    await rejects(() => h.session.acceptReply('nonsense'), 'not_code');
    const other = await encodeSignal({ type: 'answer', sdp: sdpOf(ANSWER), id: 'zzzzzzzz' });
    await rejects(() => h.session.acceptReply(other), 'unknown_invite');
    assert.equal(remote, 0);
    const reply = await encodeSignal({ type: 'answer', sdp: sdpOf(ANSWER), id: invite.id });
    await h.session.acceptReply(`here you go: ${reply}`);
    assert.equal(remote, 1);
    assert.ok(h.events.some((e) => e.type === 'friend' && e.state === 'connecting'));
    await rejects(() => h.session.acceptReply(reply), 'unknown_invite');           // a reply is good for one connection
    h.session.shutdown();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(pcs.every((pc) => pc.closed));
  });
});

// ==================================================================================================
// Failure paths the first build never exercised
// ==================================================================================================

describe('p2p host: a friend the Room turns away is reported to the host', () => {
  it('a locked game: the friend gets the error frame and the host gets a "refused" event with the reason', async () => {
    const h = makeHost();
    await seatHost(h);
    h.local.send({ t: 'settings', patch: { locked: true } });
    const { dc } = join(h);
    assert.equal(dc.frames()[0].code, 'locked');
    assert.equal(dc.closed, true);
    const refused = h.events.filter((e) => e.type === 'friend' && e.state === 'refused');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'locked');
    assert.equal(refused[0].id, 'inv1');
    h.session.shutdown();
  });

  it('a full game (8 seats) is reported the same way', async () => {
    const h = makeHost();
    await seatHost(h);
    for (let i = 0; i < 7; i++) join(h, `F${i}`);
    const { dc } = join(h, 'Late');
    assert.equal(dc.frames()[0].code, 'full');
    assert.equal(h.events.filter((e) => e.state === 'refused').at(-1).code, 'full');
    h.session.shutdown();
  });

  it('a channel that opens but never says hello is reported once, when the deadline passes', async () => {
    const h = makeHost();
    await seatHost(h);
    const dc = new FakeChannel();
    h.session.adoptChannel(dc, null, 'quiet');
    h.clock.advance(11000);
    const refused = h.events.filter((e) => e.state === 'refused');
    assert.deepEqual(refused.map((e) => [e.id, e.code]), [['quiet', 'hello']]);
    h.session.shutdown();
  });

  it('a friend who is seated and later leaves is "lost", never "refused"', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc } = join(h);
    dc.fire('close');
    assert.ok(h.events.some((e) => e.state === 'lost'));
    assert.ok(!h.events.some((e) => e.state === 'refused'));
    h.session.shutdown();
  });
});

describe('p2p host: one friend cannot starve the others', () => {
  it('a burst of frames beyond what a real client sends is dropped unread, and a habit of it ends the friendship', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc, peer } = join(h);
    const before = dc.sent.length;
    for (let i = 0; i < 2000; i++) dc.say({ t: 'chat', text: 'spam' });          // all inside one millisecond of the fake clock
    assert.equal(dc.closed, true, 'dropped after the bad-frame allowance');
    assert.ok(dc.sent.length - before < 400, `${dc.sent.length - before} replies: the Room only saw the burst allowance`);
    assert.equal(peer.dead, true);
    h.session.shutdown();
  });

  it('a normal client (60 input frames a second for a minute) is never limited', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc } = join(h);
    for (let i = 0; i < 60 * 30; i++) {
      h.clock.advance(1000 / 60 + 0.1);
      dc.say({ t: 'ping', ts: i });
    }
    assert.equal(dc.closed, false);
    h.session.shutdown();
  });

  it('the first oversize frame closes the channel', async () => {
    const h = makeHost();
    await seatHost(h);
    const { dc } = join(h);
    dc.say('x'.repeat(5000));
    assert.equal(dc.closed, true);
    h.session.shutdown();
  });
});

describe('p2p guest: waiting for the host to paste the reply', () => {
  class FakeGuestPc {
    constructor() {
      this.iceGatheringState = 'complete';
      this.handlers = new Map();
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      FakeGuestPc.last = this;
    }

    addEventListener(t, f) { this.handlers.set(t, [...(this.handlers.get(t) ?? []), f]); }
    removeEventListener() {}
    fire(t, ev = {}) { for (const f of this.handlers.get(t) ?? []) f(ev); }
    async createAnswer() { return { type: 'answer', sdp: sdpOf(ANSWER) }; }
    async setLocalDescription() { this.localDescription = { type: 'answer', sdp: sdpOf(ANSWER) }; }
    async setRemoteDescription() {}
    close() { this.closed = true; }
  }
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const invite = () => encodeSignal({ type: 'offer', sdp: sdpOf(OFFER), id: 'abc123XY', host: 'Ada', game: 'GameAaaa1' });

  it('ICE checking or even a failed probe while the host has not pasted the reply yet is NOT a failure (the reply is pasted late)', async () => {
    const session = new GuestSession({ env: { RTCPeerConnection: FakeGuestPc, connectMs: 30 } });
    const events = [];
    session.on((e) => events.push(e));
    const { code, game } = await session.acceptInvite(await invite());
    assert.match(code, /^BP1-/);
    assert.equal(game, 'GameAaaa1');
    const pc = FakeGuestPc.last;
    pc.iceConnectionState = 'checking';
    pc.fire('iceconnectionstatechange');
    pc.connectionState = 'connecting';
    pc.fire('connectionstatechange');
    await later(80);                                              // far longer than connectMs
    pc.iceConnectionState = 'failed';
    pc.fire('iceconnectionstatechange');
    pc.connectionState = 'failed';
    pc.fire('connectionstatechange');
    await later(80);
    assert.equal(session.state, 'waiting');
    assert.ok(!events.some((e) => e.state === 'failed' || e.state === 'connecting'), JSON.stringify(events));
    assert.equal(pc.closed, undefined, 'the peer connection is still there for the host to reach');
    // The host finally pastes: the channel arrives and opens.
    const dc = new FakeChannel();
    dc.readyState = 'connecting';
    pc.fire('datachannel', { channel: dc });
    dc.readyState = 'open';
    dc.fire('open');
    assert.equal(session.state, 'open');
    session.close();
  });

  it('a finished handshake starts the connect clock, and a channel that never opens then fails with the network help', async () => {
    const session = new GuestSession({ env: { RTCPeerConnection: FakeGuestPc, connectMs: 30 } });
    const events = [];
    session.on((e) => events.push(e));
    await session.acceptInvite(await invite());
    const pc = FakeGuestPc.last;
    pc.connectionState = 'connected';
    pc.fire('connectionstatechange');
    assert.equal(session.state, 'connecting');
    await later(80);
    assert.equal(session.state, 'failed');
    assert.match(events.at(-1).message, /does not work on every network/);
    assert.equal(pc.closed, true);
  });

  it('after a while of waiting the guest is told what to check, without failing', async () => {
    const session = new GuestSession({ env: { RTCPeerConnection: FakeGuestPc, waitHintMs: 20 } });
    const events = [];
    session.on((e) => events.push(e));
    await session.acceptInvite(await invite());
    await later(60);
    assert.equal(session.state, 'waiting');
    assert.match(events.at(-1).message, /fresh code/);
    session.close();
  });

  it('a link that already failed while waiting says so softly (the host may still reach us)', async () => {
    const session = new GuestSession({ env: { RTCPeerConnection: FakeGuestPc } });
    const events = [];
    session.on((e) => events.push(e));
    await session.acceptInvite(await invite());
    const pc = FakeGuestPc.last;
    pc.iceConnectionState = 'failed';
    pc.fire('iceconnectionstatechange');
    assert.equal(session.state, 'waiting');
    assert.match(events.at(-1).message, /not connecting yet/);
    session.close();
  });
});

describe('p2p codes: addresses and games', () => {
  class NoAddressPc {
    constructor() { this.iceGatheringState = 'complete'; }
    addEventListener() {}
    removeEventListener() {}
    createDataChannel() { return new FakeChannel(); }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
    async setLocalDescription() { this.localDescription = { type: 'offer', sdp: sdpOf(OFFER.filter((l) => !l.startsWith('a=candidate'))) }; }
    close() { this.closed = true; }
  }

  it('an invite without a single network address is refused with advice, not handed out', async () => {
    const h = makeHost({ RTCPeerConnection: NoAddressPc });
    await rejects(() => h.session.createInvite(), 'no_address');
    assert.equal(h.session.pending.size, 0);
    h.session.shutdown();
  });

  it('each hosted game has its own id, and its invites carry it', async () => {
    const a = makeHost();
    const b = makeHost();
    assert.match(a.session.gameId, /^[A-Za-z0-9]{6,16}$/);
    assert.notEqual(a.session.gameId, b.session.gameId);
    a.session.shutdown();
    b.session.shutdown();
  });

  it('a game id that is not a plain id is refused', () => {
    assert.throws(() => validateBlob(goodBlob({ g: '<script>' }), 'offer'), SignalError);
    assert.throws(() => validateBlob({ ...goodBlob({ g: 'abcdefgh' }), t: 'a' }, 'answer'), SignalError);
  });

  it('a browser that cannot unpack a compressed code says so', async () => {
    const code = craft(goodBlob());
    const saved = globalThis.DecompressionStream;
    globalThis.DecompressionStream = undefined;
    try {
      await rejects(() => decodeSignal(code, 'offer'), 'no_unpack');
    } finally {
      globalThis.DecompressionStream = saved;
    }
  });
});
