import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPricingFixture, verifyPricingFixture } from './fixtures/gate-f-pricing/loader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);

for (const name of ['pricing.html', 'pricing.css', 'index.html']) {
  test(`archived ${name} passes its pinned SHA-256 and byte-length checks`, () => {
    const body = Buffer.from(readPricingFixture(name));
    assert.ok(body.length > 0);
    assert.throws(() => verifyPricingFixture(name, body.toString('utf8')), /requires a Buffer/);
    assert.throws(() => verifyPricingFixture(name, Buffer.from('corrupt')), /integrity mismatch/);
    body[0] ^= 1; // Same byte length: this specifically exercises SHA-256 checking.
    assert.throws(() => verifyPricingFixture(name, body), /integrity mismatch/);
  });
}

test('archive reader rejects unknown names and traversal without public fallback', () => {
  for (const name of ['../pricing.html', '/pricing.html', 'unknown.html', 'https://example.com/a']) {
    assert.throws(() => readPricingFixture(name), /Unknown archived Pricing fixture/);
  }
});

test('historical pricing retains its pre-launch sentinel and dormant controls', () => {
  const legacy = readPricingFixture('pricing.html');
  assert.match(legacy, /window\.location\.replace\('\/'\)/);
  assert.match(legacy, /id="btn-monthly"/);
  assert.match(legacy, /id="faq-list"/);
});

test('archived landing enters the clean canonical pricing route', () => {
  const legacy = readPricingFixture('index.html');
  assert.match(legacy, /href="\/pricing"/);
  assert.doesNotMatch(legacy, /href="\/pricing\.html"/);
});

test('both dedicated Pricing suites pass in an isolated checkout without public HTML/CSS', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aver-pricing-no-public-'));
  const sources = [
    'frontend/tests/pricing-next-behavior.test.mjs',
    'frontend/tests/pricing-redesign.test.mjs',
    'frontend/tests/fixtures/gate-f-pricing/loader.mjs',
    'frontend/tests/fixtures/gate-f-pricing/manifest.json',
    'frontend/tests/fixtures/gate-f-pricing/pricing.html',
    'frontend/tests/fixtures/gate-f-pricing/pricing.css',
    'frontend/tests/fixtures/gate-f-pricing/index.html',
    'frontend/app/(marketing)/pricing/page.tsx',
    'frontend/app/(marketing)/page.tsx',
    'frontend/tooling/verify-pricing-redirect-flow.mjs',
    'docs/ROUTE_LEDGER.md',
    '.github/workflows/next-native-browser.yml',
  ];
  try {
    for (const source of sources) {
      const target = path.join(root, source);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(ROOT, source), target);
    }
    // Only installed dependencies are shared; no original repo source fallback.
    symlinkSync(path.join(ROOT, 'frontend/node_modules'), path.join(root, 'frontend/node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(existsSync(path.join(root, 'frontend/public')), false);
    // Do not forward runner-worker state, NODE_OPTIONS or application credentials.
    const env = Object.fromEntries(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT',
      'WINDIR', 'CI', 'LANG', 'LC_ALL', 'TZ'].filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]));
    const { stdout } = await execFileAsync(process.execPath, [
      '--test', '--test-reporter=tap', 'frontend/tests/pricing-next-behavior.test.mjs',
      'frontend/tests/pricing-redesign.test.mjs',
    ], { cwd: root, env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    assert.ok(Number(stdout.match(/# tests (\d+)/)?.[1]) >= 125,
      'Expected all 119 historical plus six native cases, not a partial nested run');
    assert.match(stdout, /(?:#|ℹ) fail 0/);
    assert.match(stdout, /(?:#|ℹ) skipped 0/);
    assert.match(stdout, /# todo 0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
