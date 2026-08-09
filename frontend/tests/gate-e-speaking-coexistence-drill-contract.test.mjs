/** Gate E live Speaking drill must remain phased, fail-closed and evidence-honest. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));

const MANIFEST = json('frontend/tooling/gate-e-speaking-coexistence-drill.json');
const CONFIG = read('frontend/playwright.speaking-coexistence.config.js');
const SPEC = read('frontend/tests/speaking-coexistence-drill/staging-speaking-coexistence.spec.js');
const WORKFLOW = read('.github/workflows/speaking-coexistence-drill.yml');
const DOC = read('docs/GATE_E_ACTIVE_SESSION_AFFINITY_2026-08-09.md');
const PROVENANCE = read('frontend/tooling/capture-gate-e-staging-provenance.mjs');

describe('Speaking coexistence drill contract', () => {
  test('manifest pins the three ordered phases and required handoff identities', () => {
    assert.equal(MANIFEST.drill_id, 'gate-e-speaking-coexistence-v1');
    assert.deepEqual(MANIFEST.phases.map((item) => item.phase), ['floor', 'cutover', 'rollback']);
    assert.deepEqual(MANIFEST.phases.map((item) => item.expected_admission), ['legacy', 'next', 'legacy']);
    assert.equal(MANIFEST.phases[1].required_previous_session, 'legacy_session_id');
    assert.equal(MANIFEST.phases[2].required_previous_session, 'next_session_id');
    assert.match(MANIFEST.status, /artifacts-pending/);
  });

  test('runner is serial, retry-free and checks deployed SHA before browser evidence', () => {
    assert.match(CONFIG, /workers:\s*1/);
    assert.match(CONFIG, /retries:\s*0/);
    assert.match(CONFIG, /screenshot: 'off'/);
    assert.match(CONFIG, /trace: 'off'/);
    assert.match(SPEC, /deployedFrontend[\s\S]*?toBe\(SOURCE_SHA\)/);
    assert.match(SPEC, /PHASE === 'floor'\) expect\(SOURCE_SHA\)\.toBe\(FLOOR_SHA\)/);
    assert.match(SPEC, /PHASE === 'cutover'[\s\S]*?SOURCE_SHA\)\.not\.toBe\(FLOOR_SHA\)/);
    assert.match(SPEC, /PREVIOUS_LEGACY\)\.toMatch\(UUID\)/);
    assert.match(SPEC, /PREVIOUS_NEXT\)\.toMatch\(UUID\)/);
    assert.doesNotMatch(SPEC, /test\.skip/);
  });

  test('each phase proves admission, old URL reload/copy and canonical backend truth', () => {
    assert.match(SPEC, /createThroughAdmission/);
    assert.match(SPEC, /probeStableUrl/);
    assert.match(SPEC, /PHASE === 'floor'[\s\S]*?previousPath = created\.expectedPath/);
    assert.match(SPEC, /probeStableUrl\(context, '\/practice\/session', created\.sessionId\)/);
    assert.match(SPEC, /await tab\.reload\(\)/);
    assert.match(SPEC, /await copied\.goto\(exactUrl\)/);
    assert.match(SPEC, /canonicalSession/);
    assert.match(SPEC, /expect\(runtimeEnvironment\)\.toBe\('staging'\)/);
    assert.match(SPEC, /expect\(runtimeApiBase\)\.toBe\(STAGING_API\)/);
    assert.match(SPEC, /reload_and_copy_url_passed:\s*true/);
  });

  test('manual workflow binds staging source, secrets and always-uploaded evidence', () => {
    assert.match(WORKFLOW, /ref: staging/);
    assert.match(WORKFLOW, /cancel-in-progress: false/);
    assert.doesNotMatch(WORKFLOW, /\bqueue:/);
    assert.match(WORKFLOW, /GATE_E_SOURCE_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /STAGING_BYPASS: \$\{\{ secrets\.STAGING_PROTECTION_BYPASS \}\}/);
    assert.match(WORKFLOW, /E2E_PASSWORD: \$\{\{ secrets\.E2E_PASSWORD \}\}/);
    assert.match(WORKFLOW, /GATE_E_PROVENANCE_REQUIRED: 'true'/);
    assert.match(WORKFLOW, /Upload phase evidence\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /if-no-files-found: error/);
    assert.doesNotMatch(WORKFLOW, /playwright-report/);
    assert.match(PROVENANCE, /GATE_E_PROVENANCE_REQUIRED === 'true'[\s\S]*?process\.exitCode = 1/);
    assert.doesNotMatch(SPEC, /access_token:\s*auth\.access_token/);
  });

  test('docs keep the live drill pending until all real phase artifacts exist', () => {
    assert.match(DOC, /three-phase runner/i);
    assert.match(DOC, /LIVE CORE DRILL PENDING/);
    assert.match(DOC, /không tuyên\s+bố Gate E PASS/);
  });
});
