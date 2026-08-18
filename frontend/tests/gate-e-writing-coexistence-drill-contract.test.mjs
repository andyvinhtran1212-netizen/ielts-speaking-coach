import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveWritingPushPhase,
  validateWritingPhaseLineage,
  validateWritingPreviousPhaseHandoff,
} from '../tooling/gate-e-writing-coexistence.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = JSON.parse(read('frontend/tooling/gate-e-writing-coexistence-drill.json'));
const inputs = JSON.parse(read('frontend/tooling/gate-e-writing-coexistence-push-inputs.json'));
const workflow = read('.github/workflows/writing-coexistence-drill.yml');
const spec = read('frontend/tests/writing-coexistence-drill/staging-writing-coexistence.spec.js');
const config = read('frontend/playwright.writing-coexistence.config.js');
const seed = read('backend/scripts/seed_staging_writing_coexistence.py');
const FLOOR = '1'.repeat(40);
const ROLLBACK = '2'.repeat(40);
const RESTORE = '3'.repeat(40);
const NEXT_ASSIGNMENT = '11111111-1111-4111-8111-111111111111';
const LEGACY_ASSIGNMENT = '22222222-2222-4222-8222-222222222222';

describe('Writing coexistence drill contract', () => {
  test('pins product-aligned floor, rollback and restore phases', () => {
    assert.equal(manifest.drill_id, 'gate-e-writing-coexistence-v1');
    assert.equal(manifest.surface, 'writing_assignment');
    assert.deepEqual(manifest.phases.map((item) => item.phase), ['floor', 'rollback', 'restore']);
    assert.deepEqual(manifest.phases.map((item) => item.expected_admission), ['next', 'legacy', 'next']);
    assert.match(config, /workers:\s*1/);
    assert.match(config, /retries:\s*0/);
    assert.match(config, /screenshot: 'off'/);
    assert.match(config, /trace: 'off'/);
  });

  test('floor inputs are empty and resolver requires exact phase handoffs', () => {
    assert.deepEqual(inputs, {
      schema_version: 1, rollback_floor_sha: null, previous_phase_run_id: null,
      previous_legacy_assignment_id: null, previous_next_assignment_id: null,
    });
    assert.equal(resolveWritingPushPhase({ sourceSha: FLOOR, admission: 'next', inputs }).phase, 'floor');
    const rollback = { ...inputs, rollback_floor_sha: FLOOR, previous_phase_run_id: '123',
      previous_next_assignment_id: NEXT_ASSIGNMENT };
    assert.equal(resolveWritingPushPhase({ sourceSha: ROLLBACK, admission: 'legacy',
      inputs: rollback }).phase, 'rollback');
    const restore = { ...inputs, rollback_floor_sha: FLOOR, previous_phase_run_id: '124',
      previous_legacy_assignment_id: LEGACY_ASSIGNMENT };
    assert.equal(resolveWritingPushPhase({ sourceSha: RESTORE, admission: 'next',
      inputs: restore }).phase, 'restore');
    assert.throws(() => resolveWritingPushPhase({ sourceSha: ROLLBACK, admission: 'legacy',
      inputs }), /writing-floor-push-input-invalid/);
  });

  test('workflow is staging-bound, serial and always uploads evidence', () => {
    assert.match(workflow, /name: Writing Gate E coexistence drill/);
    assert.match(workflow, /push:\n\s+branches: \[staging\]/);
    assert.match(workflow, /with: \{ ref: staging, fetch-depth: 0 \}/);
    assert.match(workflow, /group: staging-e2e-shared-env/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /gate-e-writing-coexistence\.mjs resolve/);
    assert.match(workflow, /GATE_E_PROVENANCE_REQUIRED: 'true'/);
    assert.match(workflow, /Upload phase evidence\n\s+if: always\(\)/);
    assert.match(workflow, /if-no-files-found: error/);
    assert.match(workflow, /run: npx playwright install chromium/);
    assert.doesNotMatch(workflow, /playwright install --with-deps chromium/);
    assert.doesNotMatch(workflow, /playwright-report|trace\.zip/);
  });

  test('browser proof uses fresh canonical assignments and both stable URLs', () => {
    assert.match(spec, /POST|post/);
    assert.match(spec, /admin\/writing\/assignments/);
    assert.match(spec, /admin\/writing\/assignments\/\$\{ANCHOR_ID\}/);
    assert.doesNotMatch(spec, /assignments\?limit=/);
    assert.match(spec, /request_id: requestId/);
    assert.match(spec, /core-player\/launch\?surface=writing_assignment/);
    assert.match(spec, /maxRedirects: 0/);
    assert.match(spec, /renderer-affinity/);
    assert.match(spec, /'\/writing\/dashboard'/);
    assert.match(spec, /'\/pages\/writing-dashboard\.html'/);
    assert.match(spec, /modal-essay-textarea/);
    assert.match(spec, /writeDraftThroughPlayer/);
    assert.match(spec, /floor_dark_legacy_affinity_before/);
    assert.match(spec, /floor_dark_legacy_affinity_after/);
    assert.match(spec, /await open\(copied, \(\) => copied\.goto\(tab\.url\(\)\)\)/);
    assert.match(spec, /backend\.git_sha\)\.toBe\(SOURCE_SHA\)/);
    assert.match(spec, /reload_and_copy_url_passed: true/);
    assert.doesNotMatch(spec, /access_token:\s*(student|admin)\.access_token/);
    assert.match(seed, /Existing assignment state is\nnever reset/);
  });

  test('lineage accepts only descendants and names rollback/restore modes', () => {
    const ancestor = (a, d) => a === FLOOR && [ROLLBACK, RESTORE].includes(d);
    assert.equal(validateWritingPhaseLineage({ phase: 'floor', sourceSha: FLOOR,
      floorSha: FLOOR, isAncestor: ancestor }).verified, true);
    assert.equal(validateWritingPhaseLineage({ phase: 'rollback', sourceSha: ROLLBACK,
      floorSha: FLOOR, isAncestor: ancestor }).transition_mode, 'staging-admission-override');
    assert.equal(validateWritingPhaseLineage({ phase: 'restore', sourceSha: RESTORE,
      floorSha: FLOOR, isAncestor: ancestor }).transition_mode, 'forward-restore');
    assert.throws(() => validateWritingPhaseLineage({ phase: 'rollback', sourceSha: FLOOR,
      floorSha: FLOOR, isAncestor: ancestor }), /not-floor-descendant/);
  });

  test('handoff binds the prior successful artifact and assignment id', () => {
    const metadata = { workflowName: 'Writing Gate E coexistence drill', event: 'push',
      headBranch: 'staging', conclusion: 'success' };
    const base = { schema_version: 1, drill_id: manifest.drill_id, status: 'passed', ok: true,
      rollback_floor_sha: FLOOR, floor_lineage_verified: true,
      previous_phase_handoff_verified: true, deployed_frontend_branch: 'staging',
      backend_git_branch: 'staging', backend_environment_name: 'staging',
      created_draft_text: 'canonical draft' };
    const floorEvidence = { ...base, phase: 'floor', expected_admission: 'next',
      source_sha: FLOOR, deployed_frontend_sha: FLOOR, backend_release: FLOOR,
      created_assignment_id: NEXT_ASSIGNMENT };
    assert.equal(validateWritingPreviousPhaseHandoff({ phase: 'rollback', sourceSha: ROLLBACK,
      floorSha: FLOOR, previousRunId: '123', previousLegacyAssignmentId: '',
      previousNextAssignmentId: NEXT_ASSIGNMENT, runMetadata: metadata,
      previousEvidence: floorEvidence, isAncestor: (a, d) => a === FLOOR && d === ROLLBACK }).verified, true);
    const rollbackEvidence = { ...base, phase: 'rollback', expected_admission: 'legacy',
      source_sha: ROLLBACK, deployed_frontend_sha: ROLLBACK, backend_release: ROLLBACK,
      created_assignment_id: LEGACY_ASSIGNMENT };
    assert.equal(validateWritingPreviousPhaseHandoff({ phase: 'restore', sourceSha: RESTORE,
      floorSha: FLOOR, previousRunId: '124', previousLegacyAssignmentId: LEGACY_ASSIGNMENT,
      previousNextAssignmentId: '', runMetadata: metadata, previousEvidence: rollbackEvidence,
      isAncestor: (a, d) => a === ROLLBACK && d === RESTORE }).verified, true);
    assert.throws(() => validateWritingPreviousPhaseHandoff({ phase: 'restore', sourceSha: RESTORE,
      floorSha: FLOOR, previousRunId: '124', previousLegacyAssignmentId: NEXT_ASSIGNMENT,
      previousNextAssignmentId: '', runMetadata: metadata, previousEvidence: rollbackEvidence,
      isAncestor: () => true }), /evidence-invalid/);
  });
});
