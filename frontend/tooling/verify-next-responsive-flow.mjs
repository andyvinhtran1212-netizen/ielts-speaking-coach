// Representative browser-width regression for permanent Next ownership.
// Route-specific source contracts cover every surface; this live check proves
// the built app remains usable at the two viewport classes the retired visual
// parity runner used to exercise.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3000';
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 375, height: 812 },
];
// The root not-found renders under the bare root layout (no shell reset), so
// it is checked directly: a real 404 whose card and page fit the viewport.
const NOT_FOUND_ROUTE = '/__aver-responsive-missing-route';
const ROUTES = ['/', '/login', '/grammar', NOT_FOUND_ROUTE];
const PRODUCTION_MARKERS = [
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx.supabase.co',
];

const failures = [];
async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) {
      return chromium.launch({ executablePath: localChrome });
    }
    throw error;
  }
}

const browser = await launchChromium();
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const productionRequests = [];
    page.on('request', (request) => {
      if (PRODUCTION_MARKERS.some((marker) => request.url().includes(marker))) {
        productionRequests.push(request.url());
      }
    });

    for (const route of ROUTES) {
      const expectNotFound = route === NOT_FOUND_ROUTE;
      const response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      if (expectNotFound ? response?.status() !== 404 : !response?.ok()) {
        failures.push(`${viewport.name} ${route}: HTTP ${response?.status() ?? 'none'}`);
        continue;
      }
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        viewportHeight: window.innerHeight,
        body: document.body.scrollWidth,
        root: document.documentElement.scrollWidth,
        rootHeight: document.documentElement.scrollHeight,
        hasHeading: Boolean(document.querySelector('h1')),
        card: document.querySelector('[aria-labelledby="not-found-title"]')?.getBoundingClientRect().toJSON(),
      }));
      if (expectNotFound) {
        if (!layout.card) {
          failures.push(`${viewport.name} ${route}: not-found card missing`);
        } else if (layout.card.left < 0 || layout.card.right > layout.viewport + 1) {
          failures.push(
            `${viewport.name} ${route}: not-found card spans ` +
            `${Math.round(layout.card.left)}–${Math.round(layout.card.right)}px of ${layout.viewport}px`,
          );
        }
        // The card fits these viewports, so a min-height: 100vh page must not scroll.
        if (layout.rootHeight > layout.viewportHeight + 1) {
          failures.push(
            `${viewport.name} ${route}: vertical overflow ${layout.rootHeight}px > ${layout.viewportHeight}px`,
          );
        }
      }
      if (!layout.hasHeading) failures.push(`${viewport.name} ${route}: missing h1`);
      if (Math.max(layout.body, layout.root) > layout.viewport + 1) {
        failures.push(
          `${viewport.name} ${route}: horizontal overflow ` +
          `${Math.max(layout.body, layout.root)}px > ${layout.viewport}px`,
        );
      }
    }
    if (productionRequests.length) {
      failures.push(`${viewport.name}: production egress ${productionRequests.join(', ')}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`✓ ${ROUTES.length} Next routes × ${VIEWPORTS.length} viewport classes`);
}
