/** Speaking Gate E browser matrix must stay pinned and evidence-honest. */
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

const MANIFEST = json('frontend/tooling/gate-e-speaking-device-matrix.json');
const LOCK = json('frontend/package-lock.json');
const CONFIG = read('frontend/playwright.gate-e.config.js');
const WORKFLOW = read('.github/workflows/e2e.yml');
const SPEC = read('frontend/tests/gate-e/native-speaking-device-mic.spec.js');
const RECOVERY_SPEC = read('frontend/tests/gate-e/native-speaking-resume-finalize.spec.js');
const WEBKIT_SPEC = read('frontend/tests/gate-e/native-speaking-webkit-capability.spec.js');
const DOC = read('docs/GATE_E_SPEAKING_CORE_2026-08-09.md');
const VERIFIER = read('frontend/tooling/verify-gate-e-speaking-device-matrix.mjs');
const runVerifier = (runnerImage) => spawnSync(
  process.execPath,
  ['tooling/verify-gate-e-speaking-device-matrix.mjs'],
  {
    cwd: FRONTEND,
    encoding: 'utf8',
    env: { ...process.env, GATE_E_RUNNER_IMAGE: runnerImage },
  },
);

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
    assert.match(WORKFLOW, /playwright install chromium webkit/);
    assert.doesNotMatch(WORKFLOW, /playwright install --with-deps chromium webkit/);
    assert.match(WORKFLOW, /runs-on: ubuntu-24\.04/);
    assert.match(WORKFLOW, /node tooling\/verify-gate-e-speaking-device-matrix\.mjs/);
    assert.match(WORKFLOW, /GATE_E_RUNNER_IMAGE: ubuntu24\.04-x64/);
    assert.match(WORKFLOW, /Run Speaking Gate E native fixtures\n\s+id: speaking_gate_e\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /Upload Speaking Gate E device-matrix evidence\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /gate-e-speaking-device-matrix-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(WORKFLOW, /if-no-files-found: error/);
    assert.match(VERIFIER, /node_modules\/playwright-core\/browsers\.json/);
    assert.match(VERIFIER, /revisionOverrides\?\.\[runnerImage\] \|\| item\.revision/);
    assert.match(VERIFIER, /configuredRunnerImage !== manifest\.ci_runner/);
    assert.match(VERIFIER, /target\.version !== project\.browser_version/);
    assert.match(VERIFIER, /target\.revision !== project\.browser_revision/);
  });

  test('runner pin rejects a typo instead of silently using the default browser revision', () => {
    const pinned = runVerifier(MANIFEST.ci_runner);
    assert.equal(pinned.status, 0, pinned.stderr);

    const typo = runVerifier('ubuntu24.04-typo');
    assert.notEqual(typo.status, 0);
    assert.match(typo.stderr, /Speaking matrix runner ubuntu24\.04-typo != manifest ubuntu24\.04-x64/);
  });

  test('automated mic scope includes retry/audio/cleanup without faking background state', () => {
    assert.match(SPEC, /NotAllowedError/);
    assert.match(SPEC, /createMediaStreamDestination/);
    assert.match(SPEC, /page\.exposeFunction\('__gateETrackStopped'/);
    assert.match(SPEC, /Object\.defineProperty\(media, 'getUserMedia'/);
    assert.match(SPEC, /expect\.poll\(stoppedTracks\)/);
    assert.match(SPEC, /practice-back-link/);
    assert.equal((SPEC.match(/^test\('/gm) || []).length, 2);
    assert.doesNotMatch(SPEC, /Object\.defineProperty\(document, ['"]visibilityState/);
    assert.doesNotMatch(SPEC, /dispatchEvent\(new Event\(['"]visibilitychange/);
    assert.match(CONFIG, /name: 'gate-e-chromium-desktop',[\s\S]*?testIgnore: WEBKIT_CAPABILITY_SPEC/);
    assert.match(CONFIG, /name: 'gate-e-webkit-desktop',[\s\S]*?testIgnore: MIC_SPEC/);
    assert.match(CONFIG, /name: 'gate-e-webkit-iphone13',[\s\S]*?testIgnore: MIC_SPEC/);
    assert.match(WEBKIT_SPEC, /process\.platform === 'linux' && process\.env\.CI/);
    assert.match(WEBKIT_SPEC, /testInfo\.annotations\.push/);
    assert.doesNotMatch(WEBKIT_SPEC, /expect\(await page\.evaluate[\s\S]*?\)\.toBe\('undefined'\)/);
    assert.deepEqual(MANIFEST.synthetic_webkit_exclusions, [
      'microphone-lifecycle-requires-real-safari-or-ios-device',
    ]);
  });

  test('blob identity is captured before transport without replacing multipart fetch', () => {
    assert.match(RECOVERY_SPEC, /body instanceof FormData/);
    assert.match(RECOVERY_SPEC, /body\.get\('audio_file'\)/);
    assert.match(RECOVERY_SPEC, /return nativeFetch\(\.\.\.args\)/);
    assert.doesNotMatch(RECOVERY_SPEC, /postDataBuffer\(\)\?\.toString\('utf8'\)[\s\S]*?toContain\('only-copy-audio-q5'\)/);
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
    assert.match(DOC, /không phải bằng chứng background\/microphone thật/);
  });
});
