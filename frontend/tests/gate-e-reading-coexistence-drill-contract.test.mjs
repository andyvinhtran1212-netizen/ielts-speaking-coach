import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReadingPhaseLineage } from '../tooling/gate-e-reading-coexistence-lineage.mjs';
import { validateReadingPreviousPhaseHandoff } from '../tooling/validate-gate-e-reading-coexistence-handoff.mjs';
import { resolveReadingPushPhase } from '../tooling/resolve-gate-e-reading-push-phase.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('frontend/tooling/gate-e-reading-coexistence-drill.json'));
const workflow = read('.github/workflows/reading-coexistence-drill.yml');
const spec = read('frontend/tests/reading-coexistence-drill/staging-reading-coexistence.spec.js');
const config = read('frontend/playwright.reading-coexistence.config.js');
const FLOOR = '1'.repeat(40); const CUTOVER = '2'.repeat(40); const ROLLBACK = '3'.repeat(40);
const LEGACY = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';

describe('Reading coexistence drill contract', () => {
  test('pins ordered floor, cutover and rollback phases', () => {
    assert.equal(manifest.drill_id, 'gate-e-reading-coexistence-v1');
    assert.deepEqual(manifest.phases.map((x) => x.phase), ['floor', 'cutover', 'rollback']);
    assert.deepEqual(manifest.phases.map((x) => x.expected_admission), ['legacy', 'next', 'legacy']);
    assert.match(config, /workers:\s*1/); assert.match(config, /retries:\s*0/);
    assert.match(config, /screenshot: 'off'/); assert.match(config, /trace: 'off'/);
  });

  test('workflow is staging-bound, serial and always uploads provenance', () => {
    assert.match(workflow, /ref: staging/);
    assert.match(workflow, /push:\n\s+branches: \[staging\]/);
    assert.match(workflow, /GITHUB_EVENT_NAME" = push[\s\S]*?resolve-gate-e-reading-push-phase\.mjs/);
    assert.match(workflow, /group: staging-e2e-shared-env/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /GATE_E_PROVENANCE_REQUIRED: 'true'/);
    assert.match(workflow, /Upload phase evidence\n\s+if: always\(\)/);
    assert.match(workflow, /if-no-files-found: error/);
    assert.doesNotMatch(workflow, /playwright-report|trace\.zip/);
  });

  test('push resolver derives floor, cutover and rollback from policy + checked handoff', () => {
    const empty = { schema_version: 1, rollback_floor_sha: null,
      previous_phase_run_id: null, previous_legacy_attempt_id: null,
      previous_legacy_test_id: null, previous_next_attempt_id: null,
      previous_next_test_id: null };
    assert.equal(resolveReadingPushPhase({ sourceSha: FLOOR, admission: 'legacy',
      inputs: empty }).phase, 'floor');
    const cutover = { ...empty, rollback_floor_sha: FLOOR, previous_phase_run_id: '123',
      previous_legacy_attempt_id: LEGACY, previous_legacy_test_id: 'READ-1' };
    assert.equal(resolveReadingPushPhase({ sourceSha: CUTOVER, admission: 'next',
      inputs: cutover }).phase, 'cutover');
    const rollback = { ...empty, rollback_floor_sha: FLOOR, previous_phase_run_id: '124',
      previous_next_attempt_id: NEXT, previous_next_test_id: 'READ-2' };
    assert.equal(resolveReadingPushPhase({ sourceSha: ROLLBACK, admission: 'legacy',
      inputs: rollback }).phase, 'rollback');
    assert.throws(() => resolveReadingPushPhase({ sourceSha: CUTOVER, admission: 'next',
      inputs: empty }), /cutover-push-input-invalid/);
  });

  test('browser evidence proves admission, persisted affinity and stable reopen', () => {
    assert.match(spec, /core-player\/launch\?surface=reading_exam/);
    assert.match(spec, /expectedPath === '\/reading\/exam\/session'/);
    assert.match(spec, /getByRole\('button', \{ name: 'Bắt đầu lại từ đầu' \}\)/);
    assert.match(spec, /getByRole\('button', \{ name: 'Bắt đầu bài thi' \}\)/);
    assert.match(spec, /page\.once\('dialog', \(dialog\) => dialog\.accept\(\)\)/);
    assert.match(spec, /page\.locator\('#exam-start-btn'\)/);
    assert.match(spec, /page\.on\('response', captureClaim\)/);
    assert.match(spec, /claimPaths\.includes\(expectedClaim\)/);
    assert.match(spec, /body\.attempt_id\}\/renderer-affinity/);
    assert.match(spec, /const affinity = inProgress\?\.renderer_affinity \?\? null/);
    assert.match(spec, /affinity !== compatibleRenderer/);
    assert.match(spec, /!inProgress \? 0 : affinity === compatibleRenderer \? 1/);
    assert.match(spec, /if \(rank === 0\) return \[testId\]/);
    assert.match(spec, /candidates\.sort\(\(a, b\) => a\.rank - b\.rank\)/);
    assert.match(spec, /maxRedirects: 0/);
    assert.match(spec, /response\.status\(\), await response\.text\(\)\)\.toBe\(307\)/);
    assert.match(spec, /new URL\(location, baseURL\)\.pathname\)\.toBe\(expectedPath\)/);
    assert.ok(manifest.required_evidence.includes('admission_location'));
    assert.match(spec, /Next Reading prestart controls did not become ready/);
    assert.match(spec, /return `redirect:\$\{pathname\}`/);
    assert.match(spec, /PHASE === 'cutover' \? 'next' : 'legacy'/);
    assert.match(spec, /renderer_affinity_protocol: 'claim-v1'/);
    assert.match(spec, /floor_dark_next_affinity_before/);
    assert.match(spec, /floor_dark_next_affinity_after/);
    assert.match(spec, /await action\(\)/);
    assert.match(spec, /await copied\.goto\(tab\.url\(\)\)/);
    assert.match(spec, /backend\.git_sha\)\.toBe\(SOURCE_SHA\)/);
    assert.match(spec, /reload_and_copy_url_passed: true/);
    assert.doesNotMatch(spec, /access_token:\s*auth\.access_token/);
  });

  test('lineage accepts descendants and only explicit rollback modes', () => {
    const ancestor = (a, d) => a === FLOOR && [CUTOVER, ROLLBACK].includes(d);
    assert.equal(validateReadingPhaseLineage({ phase: 'floor', sourceSha: FLOOR,
      floorSha: FLOOR, isAncestor: ancestor }).verified, true);
    assert.equal(validateReadingPhaseLineage({ phase: 'cutover', sourceSha: CUTOVER,
      floorSha: FLOOR, isAncestor: ancestor }).verified, true);
    assert.equal(validateReadingPhaseLineage({ phase: 'rollback', sourceSha: ROLLBACK,
      floorSha: FLOOR, isAncestor: ancestor }).rollback_mode, 'forward-revert');
    assert.throws(() => validateReadingPhaseLineage({ phase: 'cutover', sourceSha: FLOOR,
      floorSha: FLOOR, isAncestor: ancestor }), /not-floor-descendant/);
  });

  test('handoff is bound to prior successful artifact and attempt/test pair', () => {
    const metadata = { workflowName: 'Reading Gate E coexistence drill', event: 'workflow_dispatch',
      headBranch: 'main', conclusion: 'success' };
    const evidence = { schema_version: 1, drill_id: manifest.drill_id, phase: 'floor',
      status: 'passed', ok: true, expected_admission: 'legacy', rollback_floor_sha: FLOOR,
      source_sha: FLOOR, floor_lineage_verified: true, deployed_frontend_sha: FLOOR,
      deployed_frontend_branch: 'staging', backend_release: FLOOR,
      backend_git_branch: 'staging', backend_environment_name: 'staging',
      created_attempt_id: LEGACY, created_test_id: 'READ-1' };
    assert.equal(validateReadingPreviousPhaseHandoff({ phase: 'cutover', sourceSha: CUTOVER,
      floorSha: FLOOR, previousRunId: '123', previousLegacyAttemptId: LEGACY,
      previousLegacyTestId: 'READ-1', previousNextAttemptId: '', previousNextTestId: '',
      runMetadata: metadata, previousEvidence: evidence }).verified, true);
    const cutover = { ...evidence, phase: 'cutover', expected_admission: 'next',
      source_sha: CUTOVER, deployed_frontend_sha: CUTOVER, backend_release: CUTOVER,
      created_attempt_id: NEXT, created_test_id: 'READ-2' };
    assert.equal(validateReadingPreviousPhaseHandoff({ phase: 'rollback', sourceSha: ROLLBACK,
      floorSha: FLOOR, previousRunId: '124', previousLegacyAttemptId: '', previousLegacyTestId: '',
      previousNextAttemptId: NEXT, previousNextTestId: 'READ-2', runMetadata: metadata,
      previousEvidence: cutover, isAncestor: (a, d) => a === CUTOVER && d === ROLLBACK }).verified, true);
    assert.throws(() => validateReadingPreviousPhaseHandoff({ phase: 'cutover', sourceSha: CUTOVER,
      floorSha: FLOOR, previousRunId: '123', previousLegacyAttemptId: LEGACY,
      previousLegacyTestId: 'WRONG', previousNextAttemptId: '', previousNextTestId: '',
      runMetadata: metadata, previousEvidence: evidence }), /evidence-invalid/);
    const pushMetadata = { ...metadata, event: 'push', headBranch: 'staging' };
    assert.equal(validateReadingPreviousPhaseHandoff({ phase: 'cutover', sourceSha: CUTOVER,
      floorSha: FLOOR, previousRunId: '123', previousLegacyAttemptId: LEGACY,
      previousLegacyTestId: 'READ-1', previousNextAttemptId: '', previousNextTestId: '',
      runMetadata: pushMetadata, previousEvidence: evidence }).verified, true);
    assert.throws(() => validateReadingPreviousPhaseHandoff({ phase: 'cutover',
      sourceSha: CUTOVER, floorSha: FLOOR, previousRunId: '123',
      previousLegacyAttemptId: LEGACY, previousLegacyTestId: 'READ-1',
      previousNextAttemptId: '', previousNextTestId: '',
      runMetadata: { ...pushMetadata, headBranch: 'main' }, previousEvidence: evidence }),
    /provenance-invalid/);
  });
});
