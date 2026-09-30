// Shared plumbing of the audio rig (developer tooling): a throwaway static server for this folder and client/js, and a headless
// Chromium page on it. render.mjs and live.mjs both start from here.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../../specs/helpers/pw.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');

const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
// /__audio/* is this folder, /js/* is the game's client code, so the pages import the real '/js/audio.js'.
const MOUNTS = [['/__audio/', here], ['/js/', path.join(repo, 'client/js')]];

function serve() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x').pathname;
    const mount = MOUNTS.find(([prefix]) => url.startsWith(prefix));
    const file = mount && path.join(mount[1], path.normalize(url.slice(mount[0].length)));
    try {
      if (!file || !file.startsWith(mount[1])) throw new Error('outside the mounts');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Opens `pageName` (a file in this folder) in headless Chromium. Prints SKIP and exits 0 when Playwright or the browser is missing,
 * like the e2e runner. Page errors are collected in `problems` rather than thrown, so a run can report all of them.
 * @returns {Promise<{ page: import('playwright').Page, problems: string[], close(): Promise<void> }>}
 */
export async function openRig(pageName, { launchArgs = [] } = {}) {
  const { browser, reason } = await launchChromium({ args: launchArgs });
  if (!browser) {
    console.log(`SKIP: ${reason}`);
    process.exit(0);
  }
  const server = await serve();
  const problems = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/__audio/${pageName}`);
  return {
    page,
    problems,
    async close() {
      await browser.close();
      server.close();
    },
  };
}
