import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const MANIFEST = JSON.parse(read('frontend/tooling/gate-e-writing-device-matrix.json'));
const LOCK = JSON.parse(read('frontend/package-lock.json'));
const CONFIG = read('frontend/playwright.gate-e-writing.config.js');
const WORKFLOW = read('.github/workflows/staging-e2e.yml');
const SPEC = read('frontend/tests/gate-e-writing/writing-failure-matrix.spec.js');
const HARNESS = read('frontend/tests/gate-e-writing/writing-gate-e-harness.js');
const runVerifier = (image) => spawnSync(process.execPath, ['tooling/verify-gate-e-writing-device-matrix.mjs'], {
  cwd: FRONTEND, encoding: 'utf8', env: { ...process.env, GATE_E_RUNNER_IMAGE: image },
});

describe('Writing Gate E failure matrix is pinned and auditable', () => {
  test('manifest matches lockfile, projects and exact four paths', () => {
    assert.equal(MANIFEST.playwright_version, LOCK.packages['node_modules/@playwright/test'].version);
    assert.equal(MANIFEST.matrix_id, 'gate-e-writing-device-matrix-v1');
    assert.equal(MANIFEST.expected_total_tests, 12);
    for (const project of MANIFEST.automated_projects) {
      assert.match(CONFIG, new RegExp(`name: '${project.project}'`));
      assert.equal(MANIFEST.expected_project_counts[project.project], 4);
    }
    for (const title of MANIFEST.expected_tests) assert.match(SPEC, new RegExp(`test\\('${title}'`));
    assert.equal((SPEC.match(/^test\('/gm) || []).length, 4);
    assert.match(CONFIG, /^\s*retries:\s*0,\s*$/m);
  });

  test('faults assert canonical essay/job/text, reload, both stacks and zero production egress', () => {
    assert.match(SPEC, /route\.abort\('connectionreset'\)/);
    assert.match(SPEC, /status: 422/);
    assert.match(SPEC, /essayCount\)\.toBe\(1\)/);
    assert.match(SPEC, /jobCount\)\.toBe\(1\)/);
    assert.match(SPEC, /submittedText\)\.toBe\(LATEST\)/);
    assert.ok((SPEC.match(/openLegacyAssignment\(page\)/g) || []).length >= 2);
    assert.ok((SPEC.match(/openNextAssignment\(page\)/g) || []).length >= 1);
    assert.match(HARNESS, /PRODUCTION_ORIGINS/);
    assert.match(SPEC, /WritingSubmitReceipt/);
  });

  test('workflow runs and verifies Writing before streak metadata', () => {
    assert.match(WORKFLOW, /Verify Writing Gate E matrix pins/);
    assert.match(WORKFLOW, /Run Gate E Writing failure matrix[\s\S]*?npm run test:e2e:gate-e:writing/);
    assert.match(WORKFLOW, /Verify Writing failure-matrix evidence/);
    assert.ok(WORKFLOW.indexOf('Verify Writing failure-matrix evidence') < WORKFLOW.indexOf('Write versioned device-matrix metadata'));
    assert.match(WORKFLOW, /Upload Writing failure-matrix evidence/);
  });

  test('runner pin accepts exact image and rejects typo', () => {
    assert.equal(runVerifier(MANIFEST.ci_runner).status, 0);
    const typo = runVerifier('ubuntu24.04-typo');
    assert.notEqual(typo.status, 0);
    assert.match(typo.stderr, /Writing matrix runner/);
  });
});
