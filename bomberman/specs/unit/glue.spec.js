import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  roomCodeFromLocation, parseSession, sessionRecord, mayRejoin, SESSION_MAX_AGE_MS, helloFor, closeOutcome, ERROR_COPY, errorToast, RELOAD_GUARD_MS,
  deathText, deathAnnouncement, worthToasting, countdownBand, secondsLeft, panOf, wonMatch, lobbyChanges,
} from '../../client/js/glue.js';
import { isLoopbackHost, loopbackHint } from '../../client/js/ui.js';

// The decisions main.js makes, as plain functions (main.js itself needs a browser: specs/e2e drives it for real).

describe('glue: the room code an address carries', () => {
  it('reads /r/CODE (upper- or lower-case, with or without a trailing slash) and #CODE', () => {
    assert.equal(roomCodeFromLocation({ pathname: '/r/KQXZ', hash: '' }), 'KQXZ');
    assert.equal(roomCodeFromLocation({ pathname: '/r/kqxz/', hash: '' }), 'KQXZ');
    assert.equal(roomCodeFromLocation({ pathname: '/', hash: '#kqxz' }), 'KQXZ');
    assert.equal(roomCodeFromLocation({ pathname: '/', hash: '#/KQXZ' }), 'KQXZ');
  });

  it('accepts only well-formed codes: no vowels, exactly four letters, nothing after', () => {
    for (const pathname of ['/', '/r/', '/r/ABCD', '/r/KQX', '/r/KQXZZ', '/r/KQXZ/x', '/r/K1XZ', '/x/KQXZ', '/r/KQXZ%20']) {
      assert.equal(roomCodeFromLocation({ pathname, hash: '' }), '', pathname);
    }
    assert.equal(roomCodeFromLocation({ pathname: '/', hash: '#ABCD' }), '', 'a code with vowels is not a room');
    assert.equal(roomCodeFromLocation(undefined), '');
    assert.equal(roomCodeFromLocation({}), '');
  });
});

describe('glue: the stored session', () => {
  const rec = { code: 'KQXZ', token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', name: 'Ana', id: 3 };

  it('round-trips while it is fresh', () => {
    const now = 1_000_000;
    assert.deepEqual(parseSession(sessionRecord(rec, now), now + 5000), { ...rec, ts: now });
  });

  it('expires after ten minutes and never comes from the future', () => {
    const now = 1_000_000;
    const raw = sessionRecord(rec, now);
    assert.ok(parseSession(raw, now + SESSION_MAX_AGE_MS - 1));
    assert.equal(parseSession(raw, now + SESSION_MAX_AGE_MS), null);
    assert.equal(parseSession(raw, now - 1), null);
  });

  it('shrugs off anything malformed instead of throwing', () => {
    for (const raw of [null, undefined, '', 'nope', '[]', '42', '{"code":"KQXZ"}', JSON.stringify({ ...rec, ts: 1, code: 'ABCD' }), JSON.stringify({ ...rec, ts: 1, token: 'has space' }),
      JSON.stringify({ ...rec, ts: 'x' }), JSON.stringify({ ...rec, ts: 1, name: 5 })]) {
      assert.equal(parseSession(raw, 2), null, String(raw));
    }
  });

  it('a record from before ids were stored still resumes (id -1)', () => {
    const raw = JSON.stringify({ code: 'KQXZ', token: 'abc', name: 'Ana', ts: 10 });
    assert.equal(parseSession(raw, 20).id, -1);
  });

  it('may rejoin when the address names no room or the stored one', () => {
    const s = parseSession(sessionRecord(rec, 1), 2);
    assert.equal(mayRejoin(s, ''), true);
    assert.equal(mayRejoin(s, 'KQXZ'), true);
    assert.equal(mayRejoin(s, 'BCDF'), false);
    assert.equal(mayRejoin(null, ''), false);
  });
});

describe('glue: the first frame of a connection', () => {
  it('a token always means the token join, whatever the intent was', () => {
    assert.deepEqual(helloFor({ token: 'tok', code: 'KQXZ', name: 'Ana', wire: 1, create: true }), { t: 'join', v: 1, name: 'Ana', code: 'KQXZ', token: 'tok' });
  });
  it('without a token: create, or a join by code', () => {
    assert.deepEqual(helloFor({ token: '', code: '', name: 'Ana', wire: 1, create: true }), { t: 'create', v: 1, name: 'Ana' });
    assert.deepEqual(helloFor({ token: '', code: 'KQXZ', name: 'Ana', wire: 1, create: false }), { t: 'join', v: 1, name: 'Ana', code: 'KQXZ' });
  });
});

describe('glue: what a connection that ended means', () => {
  const ctx = (over = {}) => ({ practice: false, tokenJoin: false, serverClosed: false, sinceReload: null, ...over });
  const end = (over) => ({ code: 1000, reason: '', fatal: false, gaveUp: false, replaced: false, byUser: false, ...over });

  it('leaving on purpose needs no explanation', () => {
    assert.deepEqual(closeOutcome(end({ byUser: true }), ctx()), { kind: 'none' });
  });

  it('a room that vanished under a token join is "that party has ended"; a wrong code typed by hand is a title error', () => {
    assert.equal(closeOutcome(end({ fatal: true, reason: 'no_room' }), ctx({ tokenJoin: true })).kind, 'ended');
    const typed = closeOutcome(end({ fatal: true, reason: 'no_room' }), ctx());
    assert.equal(typed.kind, 'title');
    assert.equal(typed.text, ERROR_COPY.no_room);
  });

  it('full, locked, busy and rate-limited send the player home with a plain sentence', () => {
    for (const reason of ['full', 'locked', 'busy', 'rate_limited', 'bad_msg']) {
      const out = closeOutcome(end({ fatal: true, reason }), ctx());
      assert.deepEqual(out, { kind: 'title', text: ERROR_COPY[reason] }, reason);
      assert.ok(out.text.length > 10);
    }
    assert.equal(closeOutcome(end({ fatal: true, reason: 'something_new' }), ctx()).kind, 'title');
  });

  it('kicked and replaced are their own stories', () => {
    assert.equal(closeOutcome(end({ fatal: true, reason: 'kicked' }), ctx()).kind, 'kicked');
    assert.equal(closeOutcome(end({ fatal: true, reason: 'replaced', replaced: true }), ctx()).kind, 'replaced');
  });

  it('giving up: after the server said "closed" the party ended, otherwise the server is unreachable', () => {
    assert.equal(closeOutcome(end({ gaveUp: true, reason: 'unreachable' }), ctx({ serverClosed: true })).kind, 'ended');
    assert.equal(closeOutcome(end({ gaveUp: true, reason: 'unreachable' }), ctx()).kind, 'unreachable');
  });

  it('a version mismatch reloads once, then asks the player to refresh (no reload loop)', () => {
    assert.equal(closeOutcome(end({ fatal: true, reason: 'version' }), ctx()).kind, 'reload');
    assert.equal(closeOutcome(end({ fatal: true, reason: 'version' }), ctx({ sinceReload: RELOAD_GUARD_MS - 1 })).kind, 'refresh');
    assert.equal(closeOutcome(end({ fatal: true, reason: 'version' }), ctx({ sinceReload: RELOAD_GUARD_MS + 1 })).kind, 'reload');
  });

  it('Practice never reconnects: any unexpected end is a "practice ended"', () => {
    assert.equal(closeOutcome(end({ code: 1011 }), ctx({ practice: true })).kind, 'practice-ended');
    assert.equal(closeOutcome(end({ byUser: true }), ctx({ practice: true })).kind, 'none');
  });

  it('every error code has copy, and unknown ones fall back to the server text', () => {
    for (const code of ['no_room', 'full', 'locked', 'busy', 'rate_limited', 'bad_msg', 'version', 'not_host', 'bad_phase', 'need_players', 'need_teams', 'kicked']) {
      assert.ok(ERROR_COPY[code], code);
    }
    assert.equal(errorToast('not_host'), ERROR_COPY.not_host);
    assert.equal(errorToast('zzz', 'From the server'), 'From the server');
    assert.equal(errorToast('zzz'), 'Something went wrong.');
  });
});

describe('glue: kill feed', () => {
  const names = new Map([[0, 'Ana'], [1, 'Ben'], [2, 'Cy']]);
  const teams = new Map([[0, 0], [1, 0], [2, 1]]);
  const ctx = (over = {}) => ({ name: (id) => names.get(id) ?? 'Someone', team: (id) => teams.get(id) ?? -1, teams: false, suddenDeath: false, ...over });

  it('says who blasted whom, who blew themselves up, and what crushed the rest', () => {
    assert.equal(deathText(['death', 1, 0, 3, 3], ctx()), 'Ana blasted Ben');
    assert.equal(deathText(['death', 1, 1, 3, 3], ctx()), 'Ben blew themselves up');
    assert.equal(deathText(['death', 1, -1, 3, 3], ctx()), 'Ben was caught in a blast');
    assert.equal(deathText(['death', 1, -1, 3, 3], ctx({ suddenDeath: true })), 'Ben was crushed by the walls');
    assert.equal(deathText(['death', 9, 0, 3, 3], ctx()), 'Ana blasted Someone');
  });

  it('a teammate is called out in team matches only', () => {
    assert.equal(deathText(['death', 1, 0, 3, 3], ctx({ teams: true })), 'Ana blasted their teammate Ben');
    assert.equal(deathText(['death', 2, 0, 3, 3], ctx({ teams: true })), 'Ana blasted Cy');
  });

  it('a screen reader hears the player\'s own death in the second person', () => {
    const name = (id) => names.get(id);
    assert.equal(deathAnnouncement(['death', 1, 0, 0, 0], name), 'You were blasted by Ana.');
    assert.equal(deathAnnouncement(['death', 1, 1, 0, 0], name), 'You blew yourself up.');
    assert.equal(deathAnnouncement(['death', 1, -1, 0, 0], name), 'You were crushed by the walls.');
  });

  it('departures are not toasted twice (the feed has "left" events)', () => {
    assert.equal(worthToasting('Ana left'), false);
    assert.equal(worthToasting('Ben was kicked'), false);
    assert.equal(worthToasting('Ben is now the host'), true);
    assert.equal(worthToasting('Host ended the match'), true);
    assert.equal(worthToasting('Ann joined'), true);
    assert.equal(worthToasting('Leftover left-handed'), true);
  });
});

describe('glue: numbers the sound triggers watch', () => {
  it('countdown bands are 3, 2, 1 for cd 180..1 and 0 outside a countdown', () => {
    assert.deepEqual([180, 121, 120, 61, 60, 1, 0, -1].map(countdownBand), [3, 3, 2, 2, 1, 1, 0, 0]);
  });

  it('whole seconds left: ceil of ticks/60, and nothing without a clock', () => {
    assert.deepEqual([600, 599, 60, 59, 1, 0, -1].map(secondsLeft), [10, 10, 1, 1, 1, 0, 0]);
  });

  it('pan follows the arena x: centre 0, edges at +-0.85, never outside -1..1', () => {
    assert.equal(panOf(7.5), 0);
    assert.ok(Math.abs(panOf(0) + 0.85) < 1e-9);
    assert.ok(Math.abs(panOf(15) - 0.85) < 1e-9);
    assert.equal(panOf(-50), -1);
    assert.equal(panOf(50), 1);
  });

  it('winning a match: a solo win, a joint win, a team win; never a match nobody could finish', () => {
    const standings = [{ id: 0, team: 0, place: 1 }, { id: 1, team: 1, place: 2 }, { id: 2, team: 0, place: 1 }];
    assert.equal(wonMatch({ winnerId: 0, winnerTeam: null, reason: 'wins', standings }, 0), true);
    assert.equal(wonMatch({ winnerId: 0, winnerTeam: null, reason: 'wins', standings }, 1), false);
    assert.equal(wonMatch({ winnerId: null, winnerTeam: null, reason: 'cap', standings }, 2), true, 'a joint winner');
    assert.equal(wonMatch({ winnerId: null, winnerTeam: null, reason: 'cap', standings }, 1), false);
    assert.equal(wonMatch({ winnerId: null, winnerTeam: 1, reason: 'wins', standings }, 1), true);
    assert.equal(wonMatch({ winnerId: null, winnerTeam: 1, reason: 'wins', standings }, 0), false);
    assert.equal(wonMatch({ winnerId: null, winnerTeam: 0, reason: 'wins', standings }, 5), false, 'not in the standings');
    assert.equal(wonMatch({ winnerId: null, winnerTeam: null, reason: 'not_enough_players', standings }, 0), false);
    assert.equal(wonMatch(null, 0), false);
  });

  it('lobby changes list who arrived and who left', () => {
    const a = { players: [{ id: 0 }, { id: 1 }] };
    const b = { players: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    assert.deepEqual(lobbyChanges(a, b), { joined: [2, 3], left: [0] });
    assert.deepEqual(lobbyChanges(null, b), { joined: [1, 2, 3], left: [] });
    assert.deepEqual(lobbyChanges(a, a), { joined: [], left: [] });
  });
});

describe('ui: addresses only this computer can open', () => {
  it('recognises localhost, 127.x, [::1] and 0.0.0.0', () => {
    for (const h of ['localhost', 'LOCALHOST', 'foo.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', '0.0.0.0', 'localhost.']) assert.equal(isLoopbackHost(h), true, h);
  });

  it('lets every other host through: LAN addresses, tunnels, real domains', () => {
    for (const h of ['192.168.1.20', '10.0.0.5', '172.16.0.9', 'blast-party.onrender.com', 'abc.trycloudflare.com', 'my-localhost.example.com', '128.0.0.1', '', undefined, null]) assert.equal(isLoopbackHost(h), false, String(h));
  });

  it('the hint names the real port and both ways out', () => {
    const hint = loopbackHint('3000');
    assert.match(hint, /can't reach "localhost"/);
    assert.match(hint, /192\.168\.x\.x:3000/);
    assert.match(hint, /npm run share/);
    assert.doesNotMatch(loopbackHint(''), /:undefined|:\)/);
  });
});
