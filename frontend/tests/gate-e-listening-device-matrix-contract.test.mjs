import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));

const MANIFEST = json('frontend/tooling/gate-e-listening-device-matrix.json');
const LOCK = json('frontend/package-lock.json');
const CONFIG = read('frontend/playwright.gate-e-listening.config.js');
const WORKFLOW = read('.github/workflows/staging-e2e.yml');
const SPEC = read('frontend/tests/gate-e-listening/listening-failure-matrix.spec.js');
const HARNESS = read('frontend/tests/gate-e-listening/listening-gate-e-harness.js');
const DICTATION_SPEC = read('frontend/tests/gate-e-listening/dictation-failure-matrix.spec.js');
const DICTATION_HARNESS = read('frontend/tests/gate-e-listening/dictation-gate-e-harness.js');
const VERIFIER = read('frontend/tooling/verify-gate-e-listening-device-matrix.mjs');
const runVerifier = (runnerImage) => spawnSync(
  process.execPath,
  ['tooling/verify-gate-e-listening-device-matrix.mjs'],
  {
    cwd: FRONTEND,
    encoding: 'utf8',
    env: { ...process.env, GATE_E_RUNNER_IMAGE: runnerImage },
  },
);

describe('Listening Gate E failure matrix is pinned and auditable', () => {
  test('manifest matches lockfile, config projects and exact twelve-path matrix', () => {
    assert.equal(MANIFEST.playwright_version, LOCK.packages['node_modules/@playwright/test'].version);
    assert.equal(MANIFEST.matrix_id, 'gate-e-listening-device-matrix-v5');
    assert.equal(MANIFEST.expected_total_tests, 36);
    assert.equal(MANIFEST.expected_tests.length, 12);
    for (const project of MANIFEST.automated_projects) {
      assert.match(CONFIG, new RegExp(`name: '${project.project}'`));
      assert.equal(MANIFEST.expected_project_counts[project.project], 12);
    }
    for (const title of MANIFEST.expected_tests.slice(0, 6)) {
      assert.match(SPEC, new RegExp(`test\\('${title}'`));
    }
    for (const title of MANIFEST.expected_tests.slice(6)) {
      assert.match(DICTATION_SPEC, new RegExp(`test\\('${title}'`));
    }
    assert.equal((SPEC.match(/^test\('/gm) || []).length, 6);
    assert.equal((DICTATION_SPEC.match(/^test\('/gm) || []).length, 6);
    assert.match(CONFIG, /^\s*retries:\s*0,\s*$/m);
    assert.match(CONFIG, /gate-e-listening-device-matrix-results\.json/);
  });

  test('fault paths assert canonical state, submit blocking, audio resume and zero production egress', () => {
    assert.match(SPEC, /route\.abort\('connectionreset'\)/);
    assert.match(SPEC, /status: 422/);
    assert.match(SPEC, /submitCalls\)\.toHaveLength\(0\)/);
    assert.match(SPEC, /page\.reload\(\)/);
    assert.match(SPEC, /allowCrossRendererFixture:\s*true/);
    assert.match(SPEC, /rendererAffinity\)\.toBe\('legacy'\)/);
    assert.match(SPEC, /dispatchAudioMetadata/);
    assert.ok((SPEC.match(/openLegacy\(page\)/g) || []).length >= 3);
    assert.match(SPEC, /Object\.fromEntries\(state\.answers\)/);
    assert.match(HARNESS, /PRODUCTION_ORIGINS/);
    assert.match(HARNESS, /productionRequests/);
    assert.match(HARNESS, /state\.answers\.set/);
    assert.match(DICTATION_SPEC, /RECEIPT_KEY/);
    assert.match(DICTATION_SPEC, /page\.reload\(\)/);
    assert.match(DICTATION_SPEC, /completionCalls\)\.toHaveLength\(1\)/);
    assert.match(DICTATION_HARNESS, /PRODUCTION_ORIGINS/);
    assert.match(DICTATION_HARNESS, /state\.byRequest/);
  });

  test('workflow runs and semantically verifies Listening before streak metadata', () => {
    assert.match(WORKFLOW, /Verify Listening Gate E matrix pins/);
    assert.match(WORKFLOW, /Run Gate E Listening failure matrix[\s\S]*?npm run test:e2e:gate-e:listening/);
    assert.match(WORKFLOW, /Verify Listening failure-matrix evidence/);
    assert.ok(
      WORKFLOW.indexOf('Verify Listening failure-matrix evidence')
      < WORKFLOW.indexOf('Write versioned device-matrix metadata'),
    );
    assert.match(WORKFLOW, /Upload Listening failure-matrix evidence/);
    assert.match(WORKFLOW, /gate-e-listening-failure-matrix-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  });

  test('runner pin is derived from Playwright and rejects a typo', () => {
    const pinned = runVerifier(MANIFEST.ci_runner);
    assert.equal(pinned.status, 0, pinned.stderr);
    const typo = runVerifier('ubuntu24.04-typo');
    assert.notEqual(typo.status, 0);
    assert.match(typo.stderr, /Listening matrix runner ubuntu24\.04-typo != manifest ubuntu24\.04-x64/);
    assert.match(VERIFIER, /node_modules\/playwright-core\/browsers\.json/);
  });
});
