// Test-runner-only transport. No Next route, rewrite or deployed server imports this.
const { createHash } = require('node:crypto');
const { readFileSync, lstatSync } = require('node:fs');
const path = require('node:path');
const manifest = require('./manifest.json');

const URLS = Object.freeze([
  '/pages/practice.html', '/pages/reading-exam.html', '/pages/listening-test.html',
  '/pages/listening-test-dictation.html', '/pages/writing-dashboard.html',
]);
const PORTS = new Set(['3210', '3212', '3213', '3214']);

function validateOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
      || !PORTS.has(url.port) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Legacy fixtures require an explicit local Gate E origin');
  }
  return url.origin;
}

function verifyBytes(entry, body) {
  if (body.length !== entry.bytes
      || createHash('sha256').update(body).digest('hex') !== entry.sha256) {
    throw new Error(`Legacy fixture integrity mismatch: ${entry.url}`);
  }
  return body;
}

function readFixture(url) {
  if (manifest.schema_version !== 1 || manifest.files.length !== URLS.length
      || new Set(manifest.files.map((entry) => entry.url)).size !== URLS.length
      || manifest.files.some((entry) => !URLS.includes(entry.url))) {
    throw new Error('Invalid Legacy fixture manifest');
  }
  const entry = manifest.files.find((item) => item.url === url);
  if (!entry || !URLS.includes(url) || entry.file !== `html/${path.posix.basename(url)}`) {
    throw new Error('Unknown Legacy fixture');
  }
  const file = path.join(__dirname, entry.file);
  if (!lstatSync(file).isFile()) throw new Error('Legacy fixture must be a regular file');
  return { body: verifyBytes(entry, readFileSync(file)), sha256: entry.sha256 };
}

async function installLegacyFixtureRoutes(page, origin, urls) {
  const localOrigin = validateOrigin(origin);
  if (!Array.isArray(urls) || urls.length === 0) throw new Error('Fixture URLs required');
  // Load and hash-check before registering any route. No partial fallback to public HTML.
  const fixtures = new Map(urls.map((url) => [url, readFixture(url)]));
  await page.route(
    (url) => url.origin === localOrigin && fixtures.has(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() !== 'GET' || !request.isNavigationRequest()) {
        return route.abort('blockedbyclient');
      }
      const fixture = fixtures.get(new URL(request.url()).pathname);
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'x-aver-test-fixture-sha256': fixture.sha256 },
        body: fixture.body,
      });
    },
  );
}

module.exports = { installLegacyFixtureRoutes, readFixture, verifyBytes, validateOrigin };
