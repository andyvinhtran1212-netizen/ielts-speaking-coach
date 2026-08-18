import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateListeningPhaseLineage } from '../tooling/gate-e-listening-coexistence-lineage.mjs';
import { validateDictationPreviousPhaseHandoff } from '../tooling/validate-gate-e-dictation-coexistence-handoff.mjs';
import { resolveDictationPushPhase } from '../tooling/resolve-gate-e-dictation-push-phase.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('frontend/tooling/gate-e-dictation-coexistence-drill.json'));
const workflow = read('.github/workflows/dictation-coexistence-drill.yml');
const spec = read('frontend/tests/dictation-coexistence-drill/staging-dictation-coexistence.spec.js');
const config = read('frontend/playwright.dictation-coexistence.config.js');
const pushInputs = JSON.parse(read('frontend/tooling/gate-e-dictation-coexistence-push-inputs.json'));
const FLOOR = '1'.repeat(40); const CUTOVER = '2'.repeat(40); const ROLLBACK = '3'.repeat(40);
const LEGACY = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';
const EMPTY_INPUTS = {
  schema_version: 1, rollback_floor_sha: null, previous_phase_run_id: null,
  previous_legacy_attempt_id: null, previous_legacy_test_id: null,
  previous_next_attempt_id: null, previous_next_test_id: null,
};

describe('Dictation coexistence drill contract', () => {
  test('pins ordered floor, cutover and rollback phases', () => {
    assert.equal(manifest.drill_id, 'gate-e-dictation-coexistence-v1');
    assert.equal(manifest.surface, 'listening_dictation');
    assert.deepEqual(manifest.phases.map((x) => x.phase), ['floor', 'cutover', 'rollback']);
    assert.deepEqual(manifest.phases.map((x) => x.expected_admission), ['legacy', 'next', 'legacy']);
    assert.match(config, /workers:\s*1/); assert.match(config, /retries:\s*0/);
    assert.match(config, /screenshot: 'off'/); assert.match(config, /trace: 'off'/);
  });

  test('rollback push inputs bind the successful Dictation cutover evidence', () => {
    assert.deepEqual(pushInputs, {
      schema_version: 1,
      rollback_floor_sha: '4ae51064e49a83210910fa2a7e86c0a5402a164f',
      previous_phase_run_id: '32106478117',
      previous_legacy_attempt_id: null, previous_legacy_test_id: null,
      previous_next_attempt_id: '4beb8dfd-6e5e-4925-a8f7-2ae4c0f350ec',
      previous_next_test_id: 'ee300003-0000-4000-8000-000000000003',
    });
    assert.match(workflow, /gate-e-dictation-coexistence-/);
    assert.doesNotMatch(workflow, /gate-e-listening-coexistence-\$\{\{/);
  });

  test('workflow is staging-bound, serial and always uploads provenance', () => {
    assert.match(workflow, /name: Dictation Gate E coexistence drill/);
    assert.match(workflow, /ref: staging/);
    assert.match(workflow, /push:\n\s+branches: \[staging\]/);
    assert.match(workflow, /GITHUB_EVENT_NAME" = push[\s\S]*?resolve-gate-e-dictation-push-phase\.mjs/);
    assert.match(workflow, /group: staging-e2e-shared-env/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /GATE_E_PROVENANCE_REQUIRED: 'true'/);
    assert.match(workflow, /Upload phase evidence\n\s+if: always\(\)/);
    assert.match(workflow, /if-no-files-found: error/);
    assert.match(workflow, /run: npx playwright install chromium/);
    assert.doesNotMatch(workflow, /playwright install --with-deps chromium/);
    assert.doesNotMatch(workflow, /playwright-report|trace\.zip/);
  });

  test('push resolver derives all phases from Dictation admission plus checked handoff', () => {
    const empty = { ...EMPTY_INPUTS };
    assert.equal(resolveDictationPushPhase({ sourceSha: FLOOR, admission: 'legacy',
      inputs: empty }).phase, 'floor');
    const cutover = { ...empty, rollback_floor_sha: FLOOR, previous_phase_run_id: '123',
      previous_legacy_attempt_id: LEGACY, previous_legacy_test_id: 'DICTATION-1' };
    assert.equal(resolveDictationPushPhase({ sourceSha: CUTOVER, admission: 'next',
      inputs: cutover }).phase, 'cutover');
    const rollback = { ...empty, rollback_floor_sha: FLOOR, previous_phase_run_id: '124',
      previous_next_attempt_id: NEXT, previous_next_test_id: 'DICTATION-2' };
    assert.equal(resolveDictationPushPhase({ sourceSha: ROLLBACK, admission: 'legacy',
      inputs: rollback }).phase, 'rollback');
    assert.throws(() => resolveDictationPushPhase({ sourceSha: CUTOVER, admission: 'next',
      inputs: empty }), /cutover-push-input-invalid/);
  });

  test('browser evidence proves admission, canonical affinity and stable reopen', () => {
    assert.match(spec, /core-player\/launch\?surface=listening_dictation/);
    assert.match(spec, /expectedPath === '\/listening\/dictation\/session'/);
    assert.match(spec, /page\.getByLabel\('Câu trả lời câu 1'\)/);
    assert.match(spec, /page\.locator\('#answer'\)/);
    assert.match(spec, /page\.on\('response', captureClaim\)/);
    assert.match(spec, /claimPaths\.includes\(expectedClaim\)/);
    assert.match(spec, /dictation\/attempts\/\$\{body\.attempt_id\}\/renderer-affinity/);
    assert.match(spec, /renderer_affinity_protocol: 'claim-v1'/);
    assert.match(spec, /FIXTURE_TESTS = \[1, 2, 3, 4\]/);
    assert.match(spec, /!inProgress \? 0 : affinity === compatibleRenderer \? 1/);
    assert.match(spec, /maxRedirects: 0/);
    assert.match(spec, /response\.status\(\), await response\.text\(\)\)\.toBe\(307\)/);
    assert.match(spec, /PHASE === 'cutover' \? 'next' : 'legacy'/);
    assert.match(spec, /\?test_id=\$\{encodeURIComponent\(testId\)\}&section=1/);
    assert.match(spec, /floor_dark_next_affinity_before/);
    assert.match(spec, /floor_dark_next_affinity_after/);
    assert.match(spec, /await copied\.goto\(tab\.url\(\)\)/);
    assert.match(spec, /backend\.git_sha\)\.toBe\(SOURCE_SHA\)/);
    assert.match(spec, /reload_and_copy_url_passed: true/);
    assert.doesNotMatch(spec, /access_token:\s*auth\.access_token/);
  });

  test('lineage accepts descendants and only explicit rollback modes', () => {
    const ancestor = (a, d) => a === FLOOR && [CUTOVER, ROLLBACK].includes(d);
    assert.equal(validateListeningPhaseLineage({ phase: 'floor', sourceSha: FLOOR,
      floorSha: FLOOR, isAncestor: ancestor }).verified, true);
    assert.equal(validateListeningPhaseLineage({ phase: 'cutover', sourceSha: CUTOVER,
      floorSha: FLOOR, isAncestor: ancestor }).verified, true);
    assert.equal(validateListeningPhaseLineage({ phase: 'rollback', sourceSha: ROLLBACK,
      floorSha: FLOOR, isAncestor: ancestor }).rollback_mode, 'forward-revert');
    assert.throws(() => validateListeningPhaseLineage({ phase: 'cutover', sourceSha: FLOOR,
      floorSha: FLOOR, isAncestor: ancestor }), /not-floor-descendant/);
  });

  test('handoff binds prior successful Dictation artifact and attempt/test pair', () => {
    const metadata = { workflowName: 'Dictation Gate E coexistence drill', event: 'push',
      headBranch: 'staging', conclusion: 'success' };
    const evidence = { schema_version: 1, drill_id: manifest.drill_id, phase: 'floor',
      status: 'passed', ok: true, expected_admission: 'legacy', rollback_floor_sha: FLOOR,
      source_sha: FLOOR, floor_lineage_verified: true, deployed_frontend_sha: FLOOR,
      deployed_frontend_branch: 'staging', backend_release: FLOOR,
      backend_git_branch: 'staging', backend_environment_name: 'staging',
      created_attempt_id: LEGACY, created_test_id: 'DICTATION-1' };
    assert.equal(validateDictationPreviousPhaseHandoff({ phase: 'cutover', sourceSha: CUTOVER,
      floorSha: FLOOR, previousRunId: '123', previousLegacyAttemptId: LEGACY,
      previousLegacyTestId: 'DICTATION-1', previousNextAttemptId: '', previousNextTestId: '',
      runMetadata: metadata, previousEvidence: evidence }).verified, true);
    const cutover = { ...evidence, phase: 'cutover', expected_admission: 'next',
      source_sha: CUTOVER, deployed_frontend_sha: CUTOVER, backend_release: CUTOVER,
      created_attempt_id: NEXT, created_test_id: 'DICTATION-2' };
    assert.equal(validateDictationPreviousPhaseHandoff({ phase: 'rollback', sourceSha: ROLLBACK,
      floorSha: FLOOR, previousRunId: '124', previousLegacyAttemptId: '', previousLegacyTestId: '',
      previousNextAttemptId: NEXT, previousNextTestId: 'DICTATION-2', runMetadata: metadata,
      previousEvidence: cutover, isAncestor: (a, d) => a === CUTOVER && d === ROLLBACK }).verified, true);
    assert.throws(() => validateDictationPreviousPhaseHandoff({ phase: 'cutover', sourceSha: CUTOVER,
      floorSha: FLOOR, previousRunId: '123', previousLegacyAttemptId: LEGACY,
      previousLegacyTestId: 'WRONG', previousNextAttemptId: '', previousNextTestId: '',
      runMetadata: metadata, previousEvidence: evidence }), /evidence-invalid/);
  });
});
