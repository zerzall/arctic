import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

// SPEC 0.4 / 0.5 / 1.2: shared/ runs unchanged in Node and in every browser, the simulation is deterministic, and nothing may use
// syntax an iOS 16.0 Safari cannot parse (one SyntaxError in a shared module would kill the page, and no Node test could notice).
// The rules are enforced by scanning the sources; the scanner below is itself tested against samples.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ---- A small JavaScript scanner --------------------------------------------------------------------

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'await', 'yield']);
const REGEX_AFTER_CHAR = '(,=:[!&|?{};+-*%<>~^';
const blank = (text) => text.replace(/[^\n]/g, ' ');

/**
 * Splits a source into views that keep offsets and line numbers:
 *  code:  comments, string contents, template text and regex literals blanked (safe for identifier greps)
 *  keep:  only comments blanked (strings and regexes intact, for syntax greps)
 *  regexes: every regex literal { body, flags }
 */
export function scan(src) {
  let code = '';
  let keep = '';
  const regexes = [];
  const stack = [];                          // open ${ } template expressions: { depth }
  let mode = 'code';
  let prev = '';
  let prevWord = '';
  let i = 0;
  const n = src.length;
  const emit = (both, kept = both) => { code += both; keep += kept; };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'tpl') {
      if (c === '\\') { emit(blank(src.slice(i, i + 2)), src.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { emit('`'); mode = 'code'; prev = '`'; i++; continue; }
      if (c === '$' && d === '{') { emit('${'); stack.push({ depth: 0 }); mode = 'code'; prev = '{'; i += 2; continue; }
      emit(blank(c), c);
      i++;
      continue;
    }
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      emit(blank(src.slice(i, j)), blank(src.slice(i, j)));
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      emit(blank(src.slice(i, j)), blank(src.slice(i, j)));
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      emit(c + blank(src.slice(i + 1, j - 1)) + c, src.slice(i, j));
      i = j;
      prev = c;
      continue;
    }
    if (c === '`') { emit('`'); mode = 'tpl'; i++; continue; }
    if (c === '/' && (prev === '' || REGEX_AFTER_CHAR.includes(prev) || prev === '}' || REGEX_AFTER_WORD.has(prevWord) && /[A-Za-z]/.test(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n' && (inClass || src[j] !== '/')) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j++;
      }
      const body = src.slice(i + 1, j);
      let k = j + 1;
      while (k < n && /[a-z]/.test(src[k])) k++;
      regexes.push({ body, flags: src.slice(j + 1, k) });
      emit(blank(src.slice(i, k)), src.slice(i, k));
      i = k;
      prev = ')';
      prevWord = '';
      continue;
    }
    if (c === '{' && stack.length) stack[stack.length - 1].depth++;
    if (c === '}' && stack.length) {
      if (stack[stack.length - 1].depth === 0) { stack.pop(); emit('}'); mode = 'tpl'; i++; continue; }
      stack[stack.length - 1].depth--;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      prevWord = src.slice(i, j);
      emit(src.slice(i, j));
      prev = src[j - 1];
      i = j;
      continue;
    }
    emit(c);
    if (!/\s/.test(c)) { prev = c; prevWord = ''; }
    i++;
  }
  return { code, keep, regexes };
}

// ---- Rules ---------------------------------------------------------------------------------------

const MATH_ALLOWED = new Set(['floor', 'ceil', 'round', 'trunc', 'abs', 'min', 'max', 'sign', 'sqrt', 'imul']);
const SIM_FILES = new Set(['world.js', 'mapgen.js', 'rng.js', 'bots.js']);

const lineOf = (text, at) => text.slice(0, at).split('\n').length;

/** Problems in a source that must run in the browser too (`file` is a path relative to bomberman/). */
export function browserSyntaxProblems(src, file) {
  const { code, keep, regexes } = scan(src);
  const problems = [];
  const flag = (re, why, text = code) => {
    for (const m of text.matchAll(re)) problems.push(`${file}:${lineOf(text, m.index)}: ${why} (${m[0].trim()})`);
  };
  flag(/\(\?<[=!]/g, 'regex lookbehind is not supported before Safari 16.4', keep);
  for (const r of regexes) if (r.flags.includes('v')) problems.push(`${file}: regex v flag (/${r.body}/${r.flags})`);
  flag(/new\s+RegExp\s*\([^)]*,\s*['"][a-z]*v[a-z]*['"]\s*\)/g, 'regex v flag', keep);
  flag(/\bstatic\s*\{/g, 'class static blocks');
  flag(/\b(?:isWellFormed|toWellFormed)\b/g, 'well-formed string methods');
  flag(/\bArray\s*\.\s*fromAsync\b/g, 'Array.fromAsync');
  flag(/\b(?:Object|Map)\s*\.\s*groupBy\b/g, 'groupBy');
  flag(/\bPromise\s*\.\s*withResolvers\b/g, 'Promise.withResolvers');
  flag(/\.\s*(?:union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\s*\(/g, 'Set methods');
  // top-level await: `await` outside every brace pair, not inside an async arrow/function head on the same statement
  let depth = 0;
  let statementStart = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) statementStart = i + 1; }
    else if (ch === ';' && depth === 0) statementStart = i + 1;
    else if (depth === 0 && code.startsWith('await', i) && !/[\w$]/.test(code[i - 1] ?? ' ') && !/[\w$]/.test(code[i + 5] ?? ' ')) {
      if (!/\basync\b/.test(code.slice(statementStart, i))) problems.push(`${file}:${lineOf(code, i)}: top-level await`);
    }
  }
  return problems;
}

/** Extra rules for shared/*.js. */
export function sharedProblems(src, file) {
  const base = file.split('/').pop();
  const { code, keep } = scan(src);
  const problems = browserSyntaxProblems(src, file);
  const flag = (re, why, text = code) => {
    for (const m of text.matchAll(re)) problems.push(`${file}:${lineOf(text, m.index)}: ${why} (${m[0].trim()})`);
  };
  for (const m of keep.matchAll(/(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+[^'"();]*?\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g)) {
    if (!/^\.\/[A-Za-z0-9_-]+\.js$/.test(m[2])) problems.push(`${file}:${lineOf(keep, m.index)}: shared/ may import only sibling ./*.js files (${m[2]})`);
  }
  flag(/\b(?:process|Buffer|require|document|window|localStorage|sessionStorage|setImmediate)\b/g, 'forbidden global');
  flag(/\bcrypto\s*\.\s*(?:randomUUID|subtle)\b/g, 'crypto.randomUUID / crypto.subtle');
  flag(/\bcrypto\s*\.\s*(?!getRandomValues\b)\w+/g, 'only crypto.getRandomValues is allowed');
  flag(/\bMath\s*\.\s*random\b/g, 'Math.random');
  flag(/\bDate\b/g, 'Date (time enters through injected seams)');
  flag(/\b(?:eval|Function)\s*\(|\bnew\s+Function\b/g, 'eval / new Function');
  flag(/\bperformance\b(?!\s*\.\s*now\b)/g, 'performance is allowed only as performance.now');
  if (base !== 'room.js') flag(/\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\b/g, 'timers only in room.js, via setTimer/clearTimer');
  if (SIM_FILES.has(base)) {
    flag(/\bperformance\b/g, 'the simulation reads no clock');
    flag(/\*\*/g, '** is banned in the simulation');
    flag(/\bFloat32Array\b|\bMath\s*\.\s*fround\b/g, 'sim state is float64 only');
    for (const m of code.matchAll(/\bMath\s*\.\s*(\w+)/g)) {
      if (!MATH_ALLOWED.has(m[1])) problems.push(`${file}:${lineOf(code, m.index)}: Math.${m[1]} is not in the deterministic whitelist`);
    }
    for (const m of code.matchAll(/\bMath\s*\[/g)) problems.push(`${file}:${lineOf(code, m.index)}: computed Math access`);
  }
  return problems;
}

/** Rules for client/js/*.js. */
export function clientProblems(src, file) {
  const base = file.split('/').pop();
  const { code, keep } = scan(src);
  const problems = base === 'boot.js' || base === 'legacy.js' ? [] : browserSyntaxProblems(src, file);
  const flag = (re, why, text = code) => {
    for (const m of text.matchAll(re)) problems.push(`${file}:${lineOf(text, m.index)}: ${why} (${m[0].trim()})`);
  };
  flag(/\beval\s*\(|\bnew\s+Function\b|(?<![\w$.])Function\s*\(/g, 'eval / new Function (CSP)');
  flag(/\b(?:setImmediate|Buffer|require)\b/g, 'Node-only global');
  for (const m of keep.matchAll(/(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+[^'"();]*?\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g)) {
    if (!/^(?:\.\/[A-Za-z0-9_-]+\.js|\.\.\/\.\.\/shared\/[A-Za-z0-9_-]+\.js)$/.test(m[2])) problems.push(`${file}:${lineOf(keep, m.index)}: client imports are './x.js' or '../../shared/x.js' (${m[2]})`);
  }
  if (base === 'game.js') flag(/\bDate\b|\bperformance\b|\bMath\s*\.\s*random\b/g, 'game.js reads no global clock or RNG (inject now/send)');
  if (base === 'boot.js') flag(/=>|\b(?:let|const|class|async|await)\b|`|\.\.\./g, 'boot.js must be plain ES5');
  return problems;
}

/** Rules for client/**.html: no inline scripts, no inline event handlers, no <base>. */
export function htmlProblems(src, file) {
  const problems = [];
  for (const m of src.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\bsrc\s*=/.test(m[1])) problems.push(`${file}:${lineOf(src, m.index)}: inline <script> (CSP)`);
  }
  for (const m of src.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)) problems.push(`${file}:${lineOf(src, m.index)}: inline ${m[1]}= handler (CSP)`);
  for (const m of src.matchAll(/<base\b/gi)) problems.push(`${file}:${lineOf(src, m.index)}: <base> breaks /r/CODE (SPEC 1.2)`);
  for (const m of src.matchAll(/\b(?:src|href)\s*=\s*"([^"#]*)"/gi)) {
    if (m[1] && !/^(?:\/|https?:|data:|mailto:)/.test(m[1])) problems.push(`${file}:${lineOf(src, m.index)}: asset reference must be root-absolute (${m[1]})`);
  }
  return problems;
}

function filesUnder(dir, test) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  const visit = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (test(name)) out.push(relative(ROOT, full).split(sep).join('/'));
    }
  };
  visit(abs);
  return out.sort();
}
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// ---- The repository obeys the rules --------------------------------------------------------------

test('shared/ sources: sibling imports only, no Node or DOM globals, no clocks or global randomness, Safari 16 syntax floor', () => {
  const files = filesUnder('shared', (n) => n.endsWith('.js'));
  assert.ok(files.includes('shared/world.js') && files.includes('shared/protocol.js') && files.includes('shared/constants.js'));
  assert.deepEqual(files.flatMap((f) => sharedProblems(read(f), f)), []);
});

test('the deterministic modules use only + - * / % and the whitelisted Math functions', () => {
  for (const f of ['shared/world.js', 'shared/mapgen.js', 'shared/rng.js', 'shared/bots.js']) {
    if (!existsSync(join(ROOT, f))) continue;
    assert.deepEqual(sharedProblems(read(f), f).filter((p) => /Math\.|\*\*|Float32|fround|performance/.test(p)), [], f);
  }
});

test('client/js sources: relative .js imports only, no eval, Safari 16 syntax floor, game.js reads no clock', () => {
  const files = filesUnder('client/js', (n) => n.endsWith('.js'));
  assert.deepEqual(files.flatMap((f) => clientProblems(read(f), f)), []);
});

test('client html: no inline scripts or handlers, root-absolute assets, no <base>', () => {
  const files = filesUnder('client', (n) => n.endsWith('.html'));
  assert.deepEqual(files.flatMap((f) => htmlProblems(read(f), f)), []);
});

test('client: no eval / new Function anywhere under client/ (CSP)', () => {
  const files = filesUnder('client', (n) => /\.(?:js|mjs|html)$/.test(n));
  const bad = files.filter((f) => /\beval\s*\(|\bnew\s+Function\b/.test(scan(read(f)).code));
  assert.deepEqual(bad, []);
});

// ---- The scanner and the rules catch what they should ---------------------------------------------

test('scanner: comments, strings, templates and regexes do not leak into the code view', () => {
  const src = [
    "const a = 'process document'; // window Date",
    '/* Math.random() */ const b = "require(x)";',
    'const c = `Buffer ${1 + 2} localStorage ${`nested ${3}`}`;',
    'const d = /(?<=x)y\\/window/g; const e = x / 2 / y;',
    'const f = a.process;',
  ].join('\n');
  const { code, keep, regexes } = scan(src);
  assert.equal(code.split('\n').length, 5, 'line numbers are preserved');
  assert.doesNotMatch(code, /document|window|Date|Math|require|Buffer|localStorage|\(\?<=/);
  assert.match(code, /a\.process/, 'real identifiers stay');
  assert.match(keep, /\(\?<=x\)y/, 'the keep view retains regex text for syntax greps');
  assert.deepEqual(regexes, [{ body: '(?<=x)y\\/window', flags: 'g' }]);
  assert.match(code, /x \/ 2 \/ y/, 'division is not a regex');
});

test('rules: every forbidden construct is reported, for the right reason', () => {
  const bad = [
    ["import fs from 'node:fs';", /sibling/],
    ["import x from '../client/js/ui.js';", /sibling/],
    ['const x = require("y");', /forbidden global \(require\)/],
    ['const p = process.env.X;', /forbidden global \(process\)/],
    ['const b = Buffer.from("x");', /Buffer/],
    ['document.body;', /document/],
    ['window.foo;', /window/],
    ['localStorage.x;', /localStorage/],
    ['setImmediate(f);', /setImmediate/],
    ['const r = Math.random();', /Math\.random/],
    ['const t = Date.now();', /Date/],
    ['const t = performance.timeOrigin;', /performance is allowed only as performance\.now/],
    ['crypto.randomUUID();', /randomUUID/],
    ['crypto.subtle.digest();', /subtle/],
    ['const c = crypto.getRandomValues(x); crypto.foo();', /only crypto\.getRandomValues/],
    ['setTimeout(f, 1);', /timers only in room\.js/],
    ['setInterval(f, 1);', /timers only in room\.js/],
    ['const re = /(?<=a)b/;', /lookbehind/],
    ['const re = /(?<!a)b/;', /lookbehind/],
    ['const re = new RegExp("(?<=a)b");', /lookbehind/],
    ['const re = /[\\p{L}--[a-z]]/v;', /v flag/],
    ['class A { static { init(); } }', /static blocks/],
    ['const s = str.isWellFormed();', /well-formed/],
    ['const s = str.toWellFormed();', /well-formed/],
    ['Object.groupBy(xs, f);', /groupBy/],
    ['Map.groupBy(xs, f);', /groupBy/],
    ['const r = Promise.withResolvers();', /withResolvers/],
    ['const u = a.union(b);', /Set methods/],
    ['const u = a.isSubsetOf(b);', /Set methods/],
    ['const a = Array.fromAsync(x);', /fromAsync/],
    ['const m = await import("./x.js");', /top-level await/],
    ['for await (const x of y) {}', /top-level await/],
    ['eval("1");', /eval/],
    ['const f = new Function("return 1");', /eval \/ new Function/],
  ];
  for (const [src, why] of bad) {
    const problems = sharedProblems(src, 'shared/x.js');
    assert.ok(problems.some((p) => why.test(p)), `${src} -> ${JSON.stringify(problems)}`);
  }
  for (const [src, why] of [
    ['const a = Math.pow(2, 3);', /Math\.pow/], ['const a = 2 ** 3;', /\*\*/], ['const a = Math.sin(1);', /Math\.sin/], ['const a = Math.hypot(1, 2);', /Math\.hypot/],
    ['const a = Math.atan2(1, 2);', /Math\.atan2/], ['const a = new Float32Array(2);', /float64/], ['const a = Math.fround(1);', /Math\.fround|float64/],
    ['const t = performance.now();', /simulation reads no clock/], ['const a = Math["pow"](1, 2);', /computed Math/],
  ]) {
    for (const file of SIM_FILES) {
      const problems = sharedProblems(src, `shared/${file}`);
      assert.ok(problems.some((p) => why.test(p)), `${file}: ${src} -> ${JSON.stringify(problems)}`);
    }
    assert.deepEqual(sharedProblems(src, 'shared/room.js').filter((p) => /whitelist|\*\*|float64|simulation|computed Math/.test(p)), [], `only the simulation is restricted: ${src}`);
  }
});

test('rules: allowed constructs pass', () => {
  const good = [
    "import { A } from './constants.js';",
    "export { WIRE_VERSION } from './constants.js';",
    "export * from './rng.js';",
    'const n = Math.floor(x) + Math.ceil(x) + Math.round(x) + Math.abs(x) + Math.min(a, b) + Math.max(a, b) + Math.imul(a, b) + Math.sqrt(c) + Math.sign(d) + Math.trunc(e);',
    'const r = globalThis.crypto.getRandomValues(new Uint32Array(1));',
    'const s = new Intl.Segmenter(undefined, { granularity: "grapheme" });',
    'queueMicrotask(f);',
    'const x = a?.b ?? c; class K { field = 1; static create() { return new K(); } }',
    "const re = /\\p{Cc}/gu; // (?<=ignored in comments) and Date.now()",
    'const text = "Date.now() and window are only words here";',
    'const f = async () => { await g(); };',
    'const f = async (x) => await g(x);',
    'const t = `${a} document ${b}`;',
  ];
  for (const src of good) assert.deepEqual(sharedProblems(src, 'shared/world.js'), [], src);
  for (const src of ['const t = performance.now();', 'const t = setTimeout(f, 1);', 'const a = Math.pow(2, 3);']) {
    assert.deepEqual(sharedProblems(src, 'shared/room.js').filter((p) => !/whitelist/.test(p)), [], src);
  }
});

test('rules: client files', () => {
  for (const [src, file] of [
    ["import x from '/shared/world.js';", 'game.js'], ["import x from 'ws';", 'net.js'], ["import x from './net';", 'main.js'], ["import x from 'node:fs';", 'main.js'],
    ["import x from '../shared/world.js';", 'main.js'], ['const now = Date.now();', 'game.js'], ['const now = performance.now();', 'game.js'],
    ['const r = Math.random();', 'game.js'], ['eval("x");', 'ui.js'], ['const f = new Function("x");', 'ui.js'], ['const re = /(?<=a)b/;', 'render.js'],
    ['const f = () => 1;', 'boot.js'], ['let x = 1;', 'boot.js'], ['const s = `t`;', 'boot.js'],
  ]) {
    assert.notDeepEqual(clientProblems(src, `client/js/${file}`), [], `${file}: ${src}`);
  }
  assert.deepEqual(clientProblems("import { movePlayer } from '../../shared/world.js';\nimport { UI } from './ui.js';\nconst r = Math.random(); const t = Date.now();", 'client/js/particles.js'), [], 'cosmetic randomness and clocks are fine outside game.js');
  assert.deepEqual(clientProblems('var f = function () { return 1; };', 'client/js/boot.js'), []);
  for (const html of ['<script>alert(1)</script>', '<button onclick="go()">x</button>', '<base href="/">', '<link rel="stylesheet" href="css/style.css">']) {
    assert.notDeepEqual(htmlProblems(html, 'client/index.html'), [], html);
  }
  assert.deepEqual(htmlProblems('<script src="/js/boot.js"></script><script type="module" src="/js/main.js"></script><script nomodule src="/js/legacy.js"></script><link rel="manifest" href="/manifest.webmanifest">', 'client/index.html'), []);
});
