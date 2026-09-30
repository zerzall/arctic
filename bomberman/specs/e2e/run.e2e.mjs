// Runs the browser specs (docs/SPEC.md section 10): `npm run test:e2e`, or `node specs/e2e/run.e2e.mjs [name ...]` for a subset.
//
// Starts the real server (`node server/index.js` with PORT set) and real headless Chromium, runs every specs/e2e/*.e2e.mjs scenario in
// turn (each exports `name` and a default async function({ base, browser, playwright, server, ok }), on a fresh server), and exits
// non-zero if any check failed or any scenario threw. Without Playwright or its browser it prints SKIP and exits 0 (SPEC 10.1).
//
// single.e2e.mjs is the odd one out: it builds download/blast-party.html into a temp folder and opens it over file:// with the network blocked
// (no server involved; it launches its own Chromium with mDNS candidate hiding off, so two pages on one machine can find each other by WebRTC).
//
// Screenshots of every screen go to $E2E_SHOTS (default: <tmpdir>/blast-party-e2e), e.g. E2E_SHOTS=/tmp/shots npm run test:e2e.
// SOAK_S sets the length of the soak in seconds (default 60).

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as H from '../helpers/e2e-harness.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const wanted = process.argv.slice(2);
const files = readdirSync(here).filter((f) => f.endsWith('.e2e.mjs') && f !== 'run.e2e.mjs').sort()
  .filter((f) => wanted.length === 0 || wanted.some((w) => f.startsWith(w)));

const { browser, playwright, reason } = await H.openBrowser();
if (!browser) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

// Every scenario gets a fresh server: the server limits room creation per client address (3 live rooms, a burst of 3), and every
// simulated player here connects from the same address, so a scenario keeps to three rooms and starts from an unused server.
console.log(`screenshots in ${H.SHOTS}`);
const failures = [];
let checks = 0;
let serverFailed = false;

for (const file of files) {
  const scenario = await import(`./${file}`);
  console.log(`\n== ${scenario.name ?? file}`);
  const started = Date.now();
  const server = await H.startServer();
  const { ok, results } = H.makeChecks();
  try {
    await scenario.default({ base: server.url, browser, playwright, server, ok });
  } catch (err) {
    ok(`scenario ran to the end without throwing (${file})`, false, String(err?.stack ?? err).split('\n').slice(0, 6).join(' / '));
  }
  const exit = await server.stop();
  if (exit !== 0) {
    serverFailed = true;
    failures.push(`${file}: the server exited with code ${exit}\n${server.log()}`);
  }
  checks += results.length;
  for (const r of results) if (!r.pass) failures.push(`${file}: ${r.name}${r.detail ? ` -> ${r.detail}` : ''}`);
  console.log(`   ${results.filter((r) => r.pass).length}/${results.length} checks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await browser.close();
console.log(`\n${checks - failures.length + (serverFailed ? 1 : 0)}/${checks} checks passed${serverFailed ? ' (a server exited badly)' : ''}`);
if (failures.length) {
  console.log('\nFAILED:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
