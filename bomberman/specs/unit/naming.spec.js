import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

// SPEC 1.1: the repo root's `npm test` is a bare `node --test` that auto-discovers test files. Nothing under
// bomberman/ may match Node's discovery patterns, or the unrelated Electron app's CI would run our specs.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** Every file and directory below `dir`, as paths relative to bomberman/ (with `/` separators). */
function walk(dir = ROOT, found = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join('/');
    const isDir = statSync(full).isDirectory();
    found.push({ rel, name, isDir });
    if (isDir) walk(full, found);
  }
  return found;
}

// Node 22 discovery: `**/*.test.?(c|m)js`, `**/*-test.?(c|m)js`, `**/*_test.?(c|m)js`, `**/test-*.?(c|m)js`, `**/test.?(c|m)js`, `**/test/**/*.?(c|m)js`.
const DISCOVERED = [/\.test\.[cm]?js$/, /-test\.[cm]?js$/, /_test\.[cm]?js$/, /^test-.*\.[cm]?js$/, /^test\.[cm]?js$/];

const entries = walk();

test('nothing below bomberman/ matches a pattern that `node --test` auto-discovers', () => {
  const offenders = entries.filter((e) => !e.isDir && DISCOVERED.some((re) => re.test(e.name))).map((e) => e.rel);
  assert.deepEqual(offenders, []);
});

test('there is no directory called `test` (Node runs every .js file inside one)', () => {
  assert.deepEqual(entries.filter((e) => e.isDir && e.name === 'test').map((e) => e.rel), []);
});

test('the pattern list itself catches the names it should (and only those)', () => {
  const matches = (name) => DISCOVERED.some((re) => re.test(name));
  for (const bad of ['test.js', 'test.mjs', 'test.cjs', 'test-room.js', 'room-test.js', 'room_test.js', 'room.test.js', 'room.test.mjs']) assert.ok(matches(bad), bad);
  for (const good of ['room.spec.js', 'flow.e2e.mjs', 'latest.js', 'contest.js', 'attest-things.js', 'testing.js', 'protest.spec.js']) assert.ok(!matches(good), good);
});

test('specs live where SPEC 10.1 says: *.spec.js in unit/ and integration/, *.e2e.mjs in e2e/, plain modules in helpers/', () => {
  const misplaced = entries.filter((e) => {
    if (e.isDir || !e.rel.startsWith('specs/')) return false;
    if (e.rel.startsWith('specs/unit/') || e.rel.startsWith('specs/integration/')) return !e.name.endsWith('.spec.js') && /\.[cm]?js$/.test(e.name);
    if (e.rel.startsWith('specs/e2e/')) return !e.name.endsWith('.e2e.mjs') && /\.[cm]?js$/.test(e.name);
    return false;
  });
  assert.deepEqual(misplaced.map((e) => e.rel), []);
});

test('package.json runs the specs through quoted globs and keeps the documented scripts', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.test, /^node --test /);
  assert.ok(pkg.scripts.test.includes('"specs/unit/**/*.spec.js"'), 'inner quotes keep the shell from expanding **');
  assert.ok(pkg.scripts.test.includes('"specs/integration/**/*.spec.js"'));
  assert.equal(pkg.scripts['test:e2e'], 'node specs/e2e/run.e2e.mjs');
  assert.ok(Number(pkg.engines.node.replace(/\D+/, '')) >= 22);
});
