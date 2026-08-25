/** Gate E live Speaking drill must remain phased, fail-closed and evidence-honest. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePhaseLineage } from '../tooling/gate-e-speaking-coexistence-lineage.mjs';
import { validatePreviousPhaseHandoff } from '../tooling/validate-gate-e-speaking-coexistence-handoff.mjs';

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
const LINEAGE = read('frontend/tooling/gate-e-speaking-coexistence-lineage.mjs');
const HANDOFF = read('frontend/tooling/validate-gate-e-speaking-coexistence-handoff.mjs');
const HEALTH = read('backend/routers/health.py');
const FLOOR = '1'.repeat(40);
const CUTOVER = '2'.repeat(40);
const OTHER = '3'.repeat(40);
const ROLLBACK = '4'.repeat(40);
const LEGACY_SESSION = '11111111-1111-4111-8111-111111111111';
const NEXT_SESSION = '22222222-2222-4222-8222-222222222222';

describe('Speaking coexistence drill contract', () => {
  test('manifest pins the three ordered phases and required handoff identities', () => {
    assert.equal(MANIFEST.drill_id, 'gate-e-speaking-coexistence-v2');
    assert.deepEqual(MANIFEST.phases.map((item) => item.phase), ['floor', 'cutover', 'rollback']);
    assert.deepEqual(MANIFEST.phases.map((item) => item.expected_admission), ['legacy', 'next', 'legacy']);
    assert.equal(MANIFEST.phases[1].required_previous_session, 'legacy_session_id');
    assert.equal(MANIFEST.phases[2].required_previous_session, 'next_session_id');
    assert.ok(!MANIFEST.required_evidence.includes('floor_dark_next_url'));
    assert.deepEqual(MANIFEST.conditional_evidence.floor, [
      'floor_dark_next_url',
      'floor_dark_next_session_id',
      'floor_dark_next_affinity_before',
      'floor_dark_next_affinity_after',
    ]);
    assert.deepEqual(MANIFEST.conditional_evidence.rollback, ['rollback_mode']);
    assert.equal(MANIFEST.status, 'live-three-phase-artifacts-verified-gate-e-pending');
  });

  test('runner is serial, retry-free and checks deployed SHA before browser evidence', () => {
    assert.match(CONFIG, /workers:\s*1/);
    assert.match(CONFIG, /retries:\s*0/);
    assert.match(CONFIG, /screenshot: 'off'/);
    assert.match(CONFIG, /trace: 'off'/);
    assert.match(SPEC, /deployedFrontend[\s\S]*?toBe\(SOURCE_SHA\)/);
    assert.match(SPEC, /PHASE === 'floor'[\s\S]*?SOURCE_SHA\)\.toBe\(FLOOR_SHA\)/);
    assert.match(SPEC, /PHASE === 'cutover'[\s\S]*?SOURCE_SHA\)\.not\.toBe\(FLOOR_SHA\)/);
    assert.doesNotMatch(SPEC, /PHASE === 'rollback'[\s\S]*?SOURCE_SHA\)\.toBe\(FLOOR_SHA\)/);
    assert.match(SPEC, /LINEAGE_ROLLBACK_MODE[\s\S]*?SOURCE_SHA === FLOOR_SHA \? 'exact-floor' : 'forward-revert'/);
    assert.match(SPEC, /rollback_mode: LINEAGE_ROLLBACK_MODE/);
    assert.match(SPEC, /LINEAGE_VERIFIED\)\.toBe\('true'\)/);
    assert.match(SPEC, /HANDOFF_VERIFIED\)\.toBe\('true'\)/);
    assert.match(SPEC, /assertEvidenceContract\(evidence\)/);
    assert.match(SPEC, /EVIDENCE_MANIFEST\.required_evidence/);
    assert.match(SPEC, /EVIDENCE_MANIFEST\.conditional_evidence\[PHASE\]/);
    assert.match(SPEC, /PREVIOUS_LEGACY\)\.toMatch\(UUID\)/);
    assert.match(SPEC, /PREVIOUS_NEXT\)\.toMatch\(UUID\)/);
    assert.doesNotMatch(SPEC, /test\.skip/);
  });

  test('each phase proves admission, old URL reload/copy and canonical backend truth', () => {
    assert.match(SPEC, /createThroughAdmission/);
    assert.doesNotMatch(SPEC, /created\.(?:text|json)\(\)/);
    assert.match(SPEC, /UUID\.test\(url\.searchParams\.get\('session_id'\)/);
    assert.match(SPEC, /new URL\(page\.url\(\)\)\.searchParams\.get\('session_id'\)/);
    assert.match(SPEC, /createdCanonical\.renderer_affinity\)\.toBe\([\s\S]*?PHASE === 'cutover' \? 'next' : 'legacy'/);
    assert.match(SPEC, /probeStableUrl/);
    assert.match(SPEC, /PHASE === 'floor'[\s\S]*?previousPath = created\.expectedPath/);
    assert.match(SPEC, /createUnclaimedSession/);
    assert.match(SPEC, /renderer_affinity_protocol: 'claim-v1'/);
    assert.match(SPEC, /floorDarkNextBefore\.renderer_affinity\)\.toBeNull\(\)/);
    assert.match(SPEC, /floorDarkNextAfter\.renderer_affinity\)\.toBe\('next'\)/);
    assert.match(SPEC, /await tab\.reload\(\)/);
    assert.match(SPEC, /await copied\.goto\(exactUrl\)/);
    assert.match(SPEC, /canonicalSession/);
    assert.match(SPEC, /expect\(runtimeEnvironment\)\.toBe\('staging'\)/);
    assert.match(SPEC, /expect\(runtimeApiBase\)\.toBe\(STAGING_API\)/);
    assert.match(SPEC, /backend\.git_sha\)\.toBe\(SOURCE_SHA\)/);
    assert.match(SPEC, /backend\.git_branch\)\.toBe\('staging'\)/);
    assert.match(SPEC, /PHASE === 'floor' \? \{[\s\S]*?floor_dark_next_url: floorDarkNextUrl,[\s\S]*?floor_dark_next_affinity_after: floorDarkNextAfter\.renderer_affinity/);
    assert.match(SPEC, /\/health\/runtime/);
    assert.match(SPEC, /reload_and_copy_url_passed:\s*true/);
  });

  test('manual workflow binds staging source, secrets and always-uploaded evidence', () => {
    assert.match(WORKFLOW, /ref: staging/);
    assert.match(WORKFLOW, /fetch-depth: 0/);
    assert.match(WORKFLOW, /group: staging-e2e-shared-env/);
    assert.match(WORKFLOW, /cancel-in-progress: false/);
    assert.doesNotMatch(WORKFLOW, /\bqueue:/);
    assert.match(WORKFLOW, /GATE_E_SOURCE_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /Verify rollback floor lineage/);
    assert.match(WORKFLOW, /Download previous phase evidence/);
    assert.match(WORKFLOW, /gh run view "\$PREVIOUS_PHASE_RUN_ID" --json attempt/);
    assert.match(WORKFLOW, /gh run download "\$PREVIOUS_PHASE_RUN_ID" --name "\$artifact_name"/);
    assert.doesNotMatch(WORKFLOW, /gh run download[\s\S]*?--pattern/);
    assert.match(WORKFLOW, /Verify previous phase handoff/);
    assert.match(WORKFLOW, /Verify previous phase handoff[\s\S]*?GATE_E_SOURCE_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
    assert.match(WORKFLOW, /GATE_E_LINEAGE_VERIFIED: \$\{\{ steps\.lineage\.outputs\.verified \}\}/);
    assert.match(WORKFLOW, /GATE_E_ROLLBACK_MODE: \$\{\{ steps\.lineage\.outputs\.rollback_mode \}\}/);
    assert.match(WORKFLOW, /GATE_E_HANDOFF_VERIFIED: \$\{\{ steps\.handoff\.outputs\.verified \}\}/);
    assert.match(WORKFLOW, /STAGING_BYPASS: \$\{\{ secrets\.STAGING_PROTECTION_BYPASS \}\}/);
    assert.match(WORKFLOW, /E2E_PASSWORD: \$\{\{ secrets\.E2E_PASSWORD \}\}/);
    assert.match(WORKFLOW, /GATE_E_PROVENANCE_REQUIRED: 'true'/);
    assert.match(WORKFLOW, /Capture staging release provenance[\s\S]*?E2E_PASSWORD: \$\{\{ secrets\.E2E_PASSWORD \}\}/);
    assert.match(WORKFLOW, /Preserve verified preflight evidence/);
    assert.match(WORKFLOW, /runner\.temp \}\}\/gate-e-speaking-preflight/);
    assert.match(WORKFLOW, /Verify complete phase evidence bundle\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /test -f "\$EVIDENCE_DIR\/gate-e-speaking-coexistence-lineage\.json"/);
    assert.match(WORKFLOW, /test -f "\$EVIDENCE_DIR\/gate-e-speaking-coexistence-handoff\.json"/);
    assert.ok(WORKFLOW.indexOf('Preserve verified preflight evidence') <
      WORKFLOW.indexOf('npx playwright test -c playwright.speaking-coexistence.config.js'));
    assert.ok(WORKFLOW.indexOf('Verify complete phase evidence bundle') <
      WORKFLOW.indexOf('Upload phase evidence'));
    assert.match(WORKFLOW, /Upload phase evidence\n\s+if: always\(\)/);
    assert.match(WORKFLOW, /if-no-files-found: error/);
    assert.doesNotMatch(WORKFLOW, /playwright-report/);
    assert.match(PROVENANCE, /GATE_E_PROVENANCE_REQUIRED === 'true'[\s\S]*?process\.exitCode = 1/);
    assert.match(PROVENANCE, /evidence\.frontend_release === sourceSha/);
    assert.match(PROVENANCE, /evidence\.backend_release === sourceSha/);
    assert.match(PROVENANCE, /evidence\.backend_git_branch === 'staging'/);
    assert.match(HEALTH, /"git_branch":[\s\S]*?if is_admin else _REDACTED/);
    assert.doesNotMatch(SPEC, /access_token:\s*auth\.access_token/);
  });

  test('lineage accepts exact-floor or forward rollback and rejects unrelated sources', () => {
    const isAncestor = (ancestor, descendant) => (
      ancestor === FLOOR && [CUTOVER, ROLLBACK].includes(descendant)
    );
    assert.equal(validatePhaseLineage({
      phase: 'floor', sourceSha: FLOOR, floorSha: FLOOR, isAncestor,
    }).verified, true);
    assert.equal(validatePhaseLineage({
      phase: 'cutover', sourceSha: CUTOVER, floorSha: FLOOR, isAncestor,
    }).verified, true);
    assert.equal(validatePhaseLineage({
      phase: 'rollback', sourceSha: FLOOR, floorSha: FLOOR, isAncestor,
    }).rollback_mode, 'exact-floor');
    assert.equal(validatePhaseLineage({
      phase: 'rollback', sourceSha: ROLLBACK, floorSha: FLOOR, isAncestor,
    }).rollback_mode, 'forward-revert');
    assert.throws(() => validatePhaseLineage({
      phase: 'cutover', sourceSha: OTHER, floorSha: FLOOR, isAncestor,
    }), /not-floor-descendant/);
    assert.throws(() => validatePhaseLineage({
      phase: 'cutover', sourceSha: FLOOR, floorSha: CUTOVER, isAncestor,
    }), /not-floor-descendant/);
    assert.throws(() => validatePhaseLineage({
      phase: 'rollback', sourceSha: OTHER, floorSha: FLOOR, isAncestor,
    }), /not-floor-descendant/);
    assert.match(LINEAGE, /git', \['merge-base', '--is-ancestor'/);
    assert.match(LINEAGE, /rollback_mode=\$\{evidence\.rollback_mode\}/);
  });

  test('handoff binds the prior successful workflow artifact and canonical release', () => {
    const runMetadata = {
      workflowName: 'Speaking Gate E coexistence drill',
      event: 'workflow_dispatch',
      headBranch: 'main',
      conclusion: 'success',
    };
    const previousEvidence = {
      schema_version: 1,
      drill_id: 'gate-e-speaking-coexistence-v2',
      phase: 'floor',
      status: 'passed',
      ok: true,
      expected_admission: 'legacy',
      rollback_floor_sha: FLOOR,
      source_sha: FLOOR,
      floor_lineage_verified: true,
      deployed_frontend_sha: FLOOR,
      deployed_frontend_branch: 'staging',
      backend_release: FLOOR,
      backend_git_branch: 'staging',
      backend_environment_name: 'staging',
      created_session_id: LEGACY_SESSION,
    };
    const input = {
      phase: 'cutover', sourceSha: CUTOVER, floorSha: FLOOR, previousRunId: '12345',
      previousLegacySessionId: LEGACY_SESSION, previousNextSessionId: '',
      runMetadata, previousEvidence,
    };
    assert.equal(validatePreviousPhaseHandoff(input).verified, true);
    assert.throws(() => validatePreviousPhaseHandoff({
      ...input, previousEvidence: { ...previousEvidence, backend_release: OTHER },
    }), /previous-phase-evidence-invalid/);
    assert.throws(() => validatePreviousPhaseHandoff({
      ...input, previousEvidence: { ...previousEvidence, backend_git_branch: 'main' },
    }), /previous-phase-evidence-invalid/);
    assert.throws(() => validatePreviousPhaseHandoff({
      ...input, runMetadata: { ...runMetadata, headBranch: 'feature' },
    }), /previous-run-provenance-invalid/);

    const cutoverEvidence = {
      ...previousEvidence,
      phase: 'cutover',
      expected_admission: 'next',
      source_sha: CUTOVER,
      deployed_frontend_sha: CUTOVER,
      backend_release: CUTOVER,
      created_session_id: NEXT_SESSION,
    };
    const rollbackInput = {
      phase: 'rollback', sourceSha: ROLLBACK, floorSha: FLOOR, previousRunId: '12346',
      previousLegacySessionId: '', previousNextSessionId: NEXT_SESSION,
      runMetadata, previousEvidence: cutoverEvidence,
      isAncestor: (ancestor, descendant) => ancestor === CUTOVER && descendant === ROLLBACK,
    };
    assert.equal(validatePreviousPhaseHandoff(rollbackInput).verified, true);
    assert.throws(() => validatePreviousPhaseHandoff({
      ...rollbackInput, sourceSha: CUTOVER,
    }), /rollback-source-must-differ-from-cutover/);
    assert.throws(() => validatePreviousPhaseHandoff({
      ...rollbackInput, sourceSha: OTHER,
    }), /forward-rollback-source-is-not-cutover-descendant/);
    assert.equal(validatePreviousPhaseHandoff({
      ...rollbackInput, sourceSha: FLOOR, isAncestor: () => false,
    }).verified, true, 'an exact-floor deployment rollback remains valid');
    assert.match(HANDOFF, /gh', \[[\s\S]*?'run', 'view'/);
    assert.match(HANDOFF, /git', \['merge-base', '--is-ancestor'/);
  });

  test('docs record all real phase artifacts without overclaiming Gate E', () => {
    assert.match(DOC, /three-phase runner/i);
    assert.match(DOC, /THREE-PHASE LIVE CORE DRILL PASSED/);
    assert.match(DOC, /32043317793/);
    assert.match(DOC, /32045284608/);
    assert.match(DOC, /32047774312/);
    assert.match(DOC, /rollback_mode=forward-revert/);
    assert.match(DOC, /không tuyên\s+bố Gate E PASS/);
  });
});
