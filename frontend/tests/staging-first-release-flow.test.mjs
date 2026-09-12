import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const PROMOTION = read('.github/workflows/staging-promotion-gate.yml');
const STAGING_E2E = read('.github/workflows/staging-e2e.yml');
const RELEASE_SMOKE = read('.github/workflows/staging-release-smoke.yml');
const BACKEND = read('.github/workflows/backend-tests.yml');
const TYPECHECK = read('.github/workflows/typecheck.yml');
const ROUTES = read('.github/workflows/route-manifest.yml');
const FREEZE = read('.github/workflows/legacy-freeze.yml');
const RUNBOOK = read('docs/STAGING_FIRST_RELEASE_FLOW.md');
const AGENT_RULES = read('AGENTS.md');

describe('staging-first production release contract', () => {
  test('every staging merge runs exact-release integration gates', () => {
    assert.match(STAGING_E2E, /^  push:\n    branches: \[staging\]$/m);
    assert.match(RELEASE_SMOKE, /^  push:\n    branches: \[staging\]$/m);
    assert.match(
      STAGING_E2E,
      /^    if: github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'$/m,
    );
    for (const workflow of [BACKEND, TYPECHECK, ROUTES, FREEZE]) {
      assert.match(workflow, /^  push:\n    branches: \[main, staging\]$/m);
    }
    assert.match(RELEASE_SMOKE, /run: npm run test:e2e:staging/);
    assert.match(RELEASE_SMOKE, /RELEASE_PROVENANCE_REQUIRED: 'true'/);
    assert.match(RELEASE_SMOKE, /capture-staging-release-provenance\.mjs/);
    assert.doesNotMatch(RELEASE_SMOKE, /Gate E|GATE_E_STREAK|gate-e-streak/);
    assert.doesNotMatch(RELEASE_SMOKE, /^\s+queue:/m);
  });

  test('main accepts only the repository staging head', () => {
    assert.match(PROMOTION, /^  pull_request:\n    branches: \[main\]$/m);
    assert.match(PROMOTION, /HEAD_REF.*!= "staging"/s);
    assert.match(PROMOTION, /HEAD_REPO.*!= "\$GITHUB_REPOSITORY"/s);
    assert.match(PROMOTION, /git\/ref\/heads\/staging/);
    assert.match(PROMOTION, /STAGING_SHA.*!= "\$HEAD_SHA"/s);
  });

  test('promotion requires all integrated checks and a non-skipped E2E job on the same SHA', () => {
    for (const workflow of [
      'backend-tests.yml',
      'typecheck.yml',
      'route-manifest.yml',
      'legacy-freeze.yml',
      'staging-release-smoke.yml',
    ]) {
      assert.ok(PROMOTION.includes(`"${workflow}|`), `missing integrated workflow: ${workflow}`);
    }
    for (const check of [
      'Backend (pytest + anchor drift)',
      'Frontend (node --test)',
      'TypeScript strict + legacy JSDoc',
      'api.d.ts ↔ OpenAPI drift',
      'Build + verify routes-manifest ownership',
      'Public không chứa HTML legacy',
      'Staging release smoke',
    ]) {
      assert.ok(PROMOTION.includes(check), `missing promotion check: ${check}`);
    }
    assert.match(PROMOTION, /actions\/workflows\/\$WORKFLOW\/runs\?branch=staging&event=push/);
    assert.doesNotMatch(PROMOTION, /commits\/\$HEAD_SHA\/check-runs/,
      'PR check-runs must not substitute for staging push evidence');
    assert.match(PROMOTION, /head_sha == \$sha/);
    assert.match(PROMOTION, /event=push/);
    assert.doesNotMatch(PROMOTION, /gh api[\s\S]{0,300}--jq --arg/,
      '`--arg` belongs to jq, not gh api');
    assert.match(PROMOTION, /select\(\.name == "staging-e2e"\)/);
    assert.match(PROMOTION, /E2E_JOB.*!= "success"/s);
  });

  test('operator and agent documentation prohibit direct feature releases to main', () => {
    assert.match(RUNBOOK, /feature branch from `origin\/staging`/);
    assert.match(RUNBOOK, /head `staging`\s+and base `main`/);
    assert.match(AGENT_RULES, /PR base is `staging`, never `main`/);
    assert.match(AGENT_RULES, /head `staging` and base `main`/);
  });
});
