import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { installLegacyFixtureRoutes, readFixture, verifyBytes, validateOrigin } =
  require('./fixtures/gate-e-legacy/loader.cjs');
const manifest = require('./fixtures/gate-e-legacy/manifest.json');
const frontend = new URL('../', import.meta.url);

test('all five archived HTML snapshots are byte-exact and checksum verified', () => {
  assert.equal(manifest.source_release, '17159ba0eaa8a2e889f981ba49abfe43101d0601');
  assert.equal(manifest.files.length, 5);
  for (const entry of manifest.files) {
    const fixture = readFixture(entry.url);
    assert.equal(fixture.sha256, entry.sha256);
    assert.equal(fixture.body.length, entry.bytes);
    assert.throws(() => verifyBytes(entry, Buffer.from('corrupt')), /integrity mismatch/);
    const changed = Buffer.from(fixture.body);
    changed[0] ^= 1;
    assert.throws(() => verifyBytes(entry, changed), /integrity mismatch/);
  }
  assert.throws(() => readFixture('/pages/admin.html'), /Unknown Legacy fixture/);
  assert.throws(() => readFixture('../practice.html'), /Unknown Legacy fixture/);
});

test('fixture transport rejects remote origins, credentials and unexpected ports', () => {
  for (const origin of ['https://www.averlearning.com', 'http://localhost:8100',
    'http://localhost.evil:3210', 'http://user:pass@localhost:3210',
    'http://localhost:3210/pages/', 'http://localhost:3210?foo=1',
    'http://localhost:3210#fragment', 'https://localhost:3210']) {
    assert.throws(() => validateOrigin(origin), /explicit local Gate E origin/);
  }
  for (const port of [3210, 3212, 3213, 3214]) {
    assert.equal(validateOrigin('http://localhost:' + port), 'http://localhost:' + port);
    assert.equal(validateOrigin('http://127.0.0.1:' + port), 'http://127.0.0.1:' + port);
  }
});

test('browser route serves only selected navigation without changing query identity', async () => {
  let predicate, handler;
  const page = { route: async (match, fn) => { predicate = match; handler = fn; } };
  await installLegacyFixtureRoutes(page, 'http://localhost:3210', ['/pages/practice.html']);
  const url = 'http://localhost:3210/pages/practice.html?session_id=fixture-123';
  assert.equal(predicate(new URL(url)), true);
  for (const other of ['http://localhost:3210/speaking/practice?session_id=fixture-123',
    'http://localhost:3210/pages/reading-exam.html',
    'http://localhost:3212/pages/practice.html',
    'https://www.averlearning.com/pages/practice.html']) {
    assert.equal(predicate(new URL(other)), false);
  }
  const outcomes = [];
  function route(method = 'GET', navigation = true) {
    return {
      request: () => ({ method: () => method, isNavigationRequest: () => navigation, url: () => url }),
      fulfill: async (response) => outcomes.push(response),
      abort: async (reason) => outcomes.push(reason),
    };
  }
  await handler(route());
  assert.equal(outcomes[0].status, 200);
  assert.equal(outcomes[0].headers['cache-control'], 'no-store');
  assert.equal(outcomes[0].headers['x-aver-test-fixture-sha256'], manifest.files[0].sha256);
  assert.deepEqual(outcomes[0].body, readFixture('/pages/practice.html').body);
  await handler(route('POST'));
  await handler(route('GET', false));
  assert.deepEqual(outcomes.slice(1), ['blockedbyclient', 'blockedbyclient']);
});

test('invalid fixture selection fails before any route is installed', async () => {
  let installed = 0;
  const page = { route: async () => { installed++; } };
  await assert.rejects(installLegacyFixtureRoutes(page, 'http://localhost:3210', []), /URLs required/);
  await assert.rejects(installLegacyFixtureRoutes(page, 'http://localhost:3210',
    ['/pages/practice.html', '/unknown.html']), /Unknown Legacy fixture/);
  assert.equal(installed, 0);
});

test('every surface harness explicitly loads its archive outside the public tree', () => {
  const bindings = [
    ['gate-e/native-speaking-harness.js', '/pages/practice.html'],
    ['gate-e-reading/reading-gate-e-harness.js', '/pages/reading-exam.html'],
    ['gate-e-listening/listening-gate-e-harness.js', '/pages/listening-test.html'],
    ['gate-e-listening/dictation-gate-e-harness.js', '/pages/listening-test-dictation.html'],
    ['gate-e-writing/writing-gate-e-harness.js', '/pages/writing-dashboard.html'],
  ];
  for (const [harness, url] of bindings) {
    const source = readFileSync(new URL('tests/' + harness, frontend), 'utf8');
    assert.ok(source.includes("require('../fixtures/gate-e-legacy/loader.cjs')"), harness);
    assert.ok(source.includes("await installLegacyFixtureRoutes(page, ORIGIN, ['" + url + "'])"), harness);
  }
  assert.ok(fileURLToPath(new URL('tests/fixtures/gate-e-legacy/', frontend)).includes('/tests/fixtures/'));
});
