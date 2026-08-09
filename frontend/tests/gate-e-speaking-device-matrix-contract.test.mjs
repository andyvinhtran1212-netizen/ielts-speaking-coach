/** Speaking Gate E browser matrix must stay pinned and evidence-honest. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));

const MANIFEST = json('frontend/tooling/gate-e-speaking-device-matrix.json');
const LOCK = json('frontend/package-lock.json');
const CONFIG = read('frontend/playwright.gate-e.config.js');
const WORKFLOW = read('.github/workflows/e2e.yml');
const SPEC = read('frontend/tests/gate-e/native-speaking-device-mic.spec.js');
const DOC = read('docs/GATE_E_SPEAKING_CORE_2026-08-09.md');
const VERIFIER = read('frontend/tooling/verify-gate-e-speaking-device-matrix.mjs');

describe('Speaking Gate E device matrix is pinned and auditable', () => {
  test('manifest matches the lockfile and all configured projects', () => {
    assert.equal(
      MANIFEST.playwright_version,
      LOCK.packages['node_modules/@playwright/test'].version,
    );
    assert.equal(MANIFEST.matrix_id, 'gate-e-speaking-device-matrix-v1');
    for (const project of MANIFEST.automated_projects) {
      assert.match(CONFIG, new RegExp(`name: '${project.project}'`));
    }
    assert.match(CONFIG, /gate-e-speaking-device-matrix-results\.json/);
  });

  test('CI installs both engines and always uploads the versioned result', () => {
    assert.match(WORKFLOW, /playwright install --with-deps chromium webkit/);
    assert.match(WORKFLOW, /runs-on: ubuntu-24\.04/);
    assert.match(WORKFLOW, /node tooling\/verify-gate-e-speaking-device-matrix\.mjs/);
    assert.match(WORKFLOW, /GATE_E_RUNNER_IMAGE: ubuntu24\.04-x64/);
    assert.match(WORKFLOW, /Run Speaking Gate E native fixtures\n\s+id: speaking_gate_e\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /Upload Speaking Gate E device-matrix evidence\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /gate-e-speaking-device-matrix-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(WORKFLOW, /if-no-files-found: error/);
    assert.match(VERIFIER, /node_modules\/playwright-core\/browsers\.json/);
    assert.match(VERIFIER, /revisionOverrides\?\.\[runnerImage\] \|\| item\.revision/);
    assert.match(VERIFIER, /target\.version !== project\.browser_version/);
    assert.match(VERIFIER, /target\.revision !== project\.browser_revision/);
  });

  test('automated mic scope includes retry/audio/cleanup without faking background state', () => {
    assert.match(SPEC, /NotAllowedError/);
    assert.match(SPEC, /createMediaStreamDestination/);
    assert.match(SPEC, /gate-e-mic-stop-count/);
    assert.match(SPEC, /practice-back-link/);
    assert.doesNotMatch(SPEC, /Object\.defineProperty\(document, ['"]visibilityState/);
    assert.doesNotMatch(SPEC, /dispatchEvent\(new Event\(['"]visibilitychange/);
  });
});

describe('Synthetic WebKit never becomes real Safari/iOS evidence', () => {
  test('both real-device rows remain pending and documented', () => {
    assert.deepEqual(
      MANIFEST.real_device_requirements.map((item) => item.id),
      ['safari-floor', 'ios-safari-floor'],
    );
    assert.ok(MANIFEST.real_device_requirements.every((item) => item.status === 'pending'));
    assert.match(DOC, /Safari\/iOS thật vẫn PENDING/);
    assert.match(DOC, /không phải bằng chứng background thật/);
  });
});
