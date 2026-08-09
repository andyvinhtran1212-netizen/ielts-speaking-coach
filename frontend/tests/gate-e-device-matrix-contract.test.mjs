/** Gate E device-matrix foundation must stay versioned and evidence-honest. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));

const MANIFEST = json('frontend/tooling/gate-e-device-matrix.json');
const LOCK = json('frontend/package-lock.json');
const CONFIG = read('frontend/playwright.staging.config.js');
const WORKFLOW = read('.github/workflows/staging-e2e.yml');
const SPEC = read('frontend/tests/staging-e2e/device-matrix.spec.js');
const WRITER = read('frontend/tooling/write-gate-e-device-matrix-evidence.mjs');
const DOC = read('docs/GATE_E_DEVICE_MATRIX_2026-08-09.md');

describe('Gate E device matrix is pinned and bounded', () => {
  test('manifest Playwright pin matches the package lock', () => {
    assert.equal(
      MANIFEST.playwright_version,
      LOCK.packages['node_modules/@playwright/test'].version,
    );
    assert.equal(MANIFEST.matrix_id, 'gate-e-device-matrix-v1');
  });

  test('full shared-state suite runs once; the bounded matrix spec runs on three targets', () => {
    assert.match(CONFIG, /name: 'staging-core-chromium',[\s\S]*?testIgnore: MATRIX_SPEC/);
    for (const project of [
      'matrix-chromium-148-desktop',
      'matrix-webkit-26.4-desktop',
      'matrix-webkit-26.4-iphone13',
    ]) {
      assert.match(CONFIG, new RegExp(`name: '${project}',[\\s\\S]*?testMatch: MATRIX_SPEC`));
      assert.ok(MANIFEST.automated_projects.some((item) => item.project === project));
      assert.ok(SPEC.includes(`'${project}'`));
    }
    assert.match(CONFIG, /workers:\s*1/);
    assert.match(CONFIG, /retries:\s*0/);
  });

  test('CI installs both engines and always emits machine-readable evidence', () => {
    assert.match(WORKFLOW, /playwright install --with-deps chromium webkit/);
    assert.match(CONFIG, /staging-e2e-results\.json/);
    assert.match(WORKFLOW, /id: staging_e2e/);
    assert.match(WORKFLOW, /steps\.staging_e2e\.outcome/);
    assert.match(WORKFLOW, /Write versioned device-matrix metadata\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /gate-e-device-matrix-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(WORKFLOW, /if-no-files-found: error/);
    assert.match(WRITER, /GATE_E_RUN_OUTCOME/);
    assert.match(WRITER, /target\.version !== project\.browser_version/);
    assert.ok(WRITER.includes('!= installed target'));
    assert.doesNotMatch(WRITER, /STAGING_BYPASS|E2E_PASSWORD|access_token|refresh_token/);
  });
});

describe('Synthetic WebKit is never reported as real Safari/iOS', () => {
  test('real-device requirements remain explicitly pending', () => {
    assert.deepEqual(
      MANIFEST.real_device_requirements.map((item) => item.id),
      ['safari-floor', 'ios-safari-floor'],
    );
    assert.ok(MANIFEST.real_device_requirements.every((item) => item.status === 'pending'));
    assert.match(DOC, /REAL SAFARI\/iOS PENDING/);
    assert.match(DOC, /WebKit không phải Safari shipping/);
  });

  test('WebKit projects carry a synthetic evidence class', () => {
    const webkit = MANIFEST.automated_projects.filter((item) => item.engine === 'webkit');
    assert.equal(webkit.length, 2);
    assert.ok(webkit.every((item) => item.evidence_class.startsWith('synthetic-webkit-not-real-')));
  });
});
