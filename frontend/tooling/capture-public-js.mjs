// LEGACYJS-0075 T001 (G10-T06), layer 2 evidence: which `/js/*` files a real
// browser journey requests. ESM preload, no deletion and no product change:
//
//   cd frontend
//   NODE_OPTIONS="--import ./tooling/capture-public-js.mjs" CAPTURE_OUT=/tmp/js-req.txt \
//     node tooling/verify-admin-classes-flow.mjs http://127.0.0.1:3000
//   sort -u /tmp/js-req.txt
//
// Wraps `chromium.launch` / `launchPersistentContext` on the shared
// playwright-core object (used by `playwright` and `@playwright/test`, and in
// every test worker, since NODE_OPTIONS is inherited). Each context created
// from it appends one request URL per line whose path contains `/js/`.
// The flow's own launch options (e.g. `executablePath` on macOS) pass through.
// An unwritable CAPTURE_OUT fails at start; a failed write later makes the
// process exit 70 even if the flow passed. Use only captures of runs that
// exited 0.
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const out = process.env.CAPTURE_OUT;
if (!out) throw new Error('capture-public-js: set CAPTURE_OUT to the file that collects /js/ request URLs');

// The capture is evidence for keeping or deleting files, so a lost write must
// never read as "no request". Check the file is writable before the flow
// starts, and make the run exit non-zero if any later write fails.
try {
  appendFileSync(out, '');
} catch (error) {
  throw new Error(`capture-public-js: cannot write CAPTURE_OUT ${out}: ${error.message}`);
}

let writeFailures = 0;
/** True once any append to CAPTURE_OUT failed; the capture is then incomplete. */
export const captureFailed = () => writeFailures > 0;

process.on('exit', (code) => {
  if (writeFailures === 0) return;
  console.error(`capture-public-js: ${writeFailures} write(s) to ${out} failed; this capture is incomplete and is not evidence.`);
  if (code === 0) process.exitCode = 70;
});

/** Append one URL if its path contains `/js/`. URL parsing and I/O fail separately. */
export function recordUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return; // data:, blob: and other non-URL requests carry no path
  }
  if (!pathname.includes('/js/')) return;
  try {
    appendFileSync(out, `${url}\n`);
  } catch (error) {
    writeFailures += 1;
    if (writeFailures === 1) console.error(`capture-public-js: write to ${out} failed: ${error.message}`);
  }
}

const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('playwright-core');

const record = (request) => recordUrl(request.url());
const watched = new WeakSet();
const watch = (context) => {
  if (!watched.has(context)) { watched.add(context); context.on('request', record); }
  return context;
};

const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => watch(await newContext(...a));
  // browser.newPage() makes its own context; watch it whichever path made it
  // (the WeakSet keeps a context from being recorded twice).
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => { const page = await newPage(...a); watch(page.context()); return page; };
  return browser;
};
const persistent = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = async (...args) => watch(await persistent(...args));
