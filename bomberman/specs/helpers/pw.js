// Playwright loader for the e2e specs and developer tooling (docs/SPEC.md section 10.1).
//
// `import 'playwright'` fails in an ES module when the only install is global, because ESM ignores NODE_PATH. This
// helper resolves the package from the places it usually lives and reports "not installed" as data instead of an
// exception, so `specs/e2e/run.e2e.mjs` can print SKIP and exit 0 on a machine without a browser:
//
//   import { launchChromium } from '../helpers/pw.js';
//   const { browser, reason } = await launchChromium();
//   if (!browser) { console.log(`SKIP: ${reason}`); process.exit(0); }
//
// Lookup order for the package: $PLAYWRIGHT_MODULE_DIR (a directory that contains playwright/), `npm root -g`, and
// /opt/node22/lib/node_modules. Browsers come from $PLAYWRIGHT_BROWSERS_PATH, defaulting to /opt/pw-browsers.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const DEFAULT_MODULE_DIR = '/opt/node22/lib/node_modules';
const DEFAULT_BROWSERS_PATH = '/opt/pw-browsers';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(DEFAULT_BROWSERS_PATH)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = DEFAULT_BROWSERS_PATH;
}

function globalRoot() {
  try {
    return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString().trim();
  } catch {
    return '';
  }
}

let cached;   // undefined = not looked up yet, null = looked up and missing

/**
 * The `playwright` module, or null when it cannot be found. The lookup runs once.
 * The `npm root -g` probe is only paid when the cheaper candidates fail.
 */
export function loadPlaywright() {
  if (cached !== undefined) return cached;
  const candidates = [() => process.env.PLAYWRIGHT_MODULE_DIR, globalRoot, () => DEFAULT_MODULE_DIR];
  cached = null;
  for (const candidate of candidates) {
    const dir = candidate();
    if (!dir) continue;
    try {
      // The trailing slash makes createRequire treat the path as a directory, so `<dir>/playwright` is found.
      cached = createRequire(`${dir.replace(/\/+$/, '')}/`)('playwright');
      break;
    } catch {
      // try the next place
    }
  }
  return cached;
}

/**
 * Launches headless Chromium (with --no-sandbox, which containers need).
 * @param {object} [options] extra `chromium.launch` options; `args` are appended to the default ones
 * @returns {Promise<{ browser: import('playwright').Browser | null, playwright: object | null, reason: string }>}
 *   `browser` is null, with a human-readable `reason`, when playwright or the browser binary is missing.
 */
export async function launchChromium(options = {}) {
  const playwright = loadPlaywright();
  if (!playwright) return { browser: null, playwright: null, reason: 'the playwright package was not found (set PLAYWRIGHT_MODULE_DIR)' };
  try {
    const browser = await playwright.chromium.launch({ ...options, args: ['--no-sandbox', ...(options.args ?? [])] });
    return { browser, playwright, reason: '' };
  } catch (err) {
    return { browser: null, playwright, reason: `Chromium could not be launched (${String(err?.message ?? err).split('\n')[0]})` };
  }
}
