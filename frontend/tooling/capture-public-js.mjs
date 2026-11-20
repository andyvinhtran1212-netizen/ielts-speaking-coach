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
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const out = process.env.CAPTURE_OUT;
if (!out) throw new Error('capture-public-js: set CAPTURE_OUT to the file that collects /js/ request URLs');

const require = createRequire(`${process.cwd()}/`);
const { chromium } = require('playwright-core');

const record = (request) => {
  const url = request.url();
  try {
    if (new URL(url).pathname.includes('/js/')) appendFileSync(out, `${url}\n`);
  } catch { /* data:, blob: and other non-URL requests carry no path */ }
};
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
