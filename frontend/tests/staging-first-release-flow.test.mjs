import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const PROMOTION = read('.github/workflows/staging-promotion-gate.yml');
const RELEASE_SMOKE = read('.github/workflows/staging-release-smoke.yml');
const PRODUCTION_DRIFT = read('.github/workflows/production-release-drift.yml');
const BACKEND = read('.github/workflows/backend-tests.yml');
const SPEC_GOVERNANCE = read('.github/workflows/spec-governance.yml');
const TYPECHECK = read('.github/workflows/typecheck.yml');
const ROUTES = read('.github/workflows/route-manifest.yml');
const FREEZE = read('.github/workflows/legacy-freeze.yml');
const RUNBOOK = read('docs/STAGING_FIRST_RELEASE_FLOW.md');
const AGENT_RULES = read('AGENTS.md');

describe('staging-first production release contract', () => {
  test('every staging merge runs exact-release integration gates', () => {
    assert.match(RELEASE_SMOKE, /^  push:\n    branches: \[staging\]$/m);
    assert.match(RELEASE_SMOKE, /^  workflow_dispatch:$/m);
    for (const workflow of [BACKEND, SPEC_GOVERNANCE, TYPECHECK, ROUTES, FREEZE]) {
      assert.match(workflow, /^  push:\n    branches: \[main, staging\]$/m);
    }
    assert.match(RELEASE_SMOKE, /run: npm run test:e2e:staging/);
    assert.match(RELEASE_SMOKE, /RELEASE_PROVENANCE_REQUIRED: 'true'/);
    assert.match(RELEASE_SMOKE, /capture-staging-release-provenance\.mjs/);
    assert.doesNotMatch(RELEASE_SMOKE, /Gate E|GATE_E_STREAK|gate-e-streak/);
    assert.doesNotMatch(RELEASE_SMOKE, /^\s+queue:/m);
    assert.match(RELEASE_SMOKE, /ref: \$\{\{ github\.event_name == 'push' && github\.sha \|\| 'staging' \}\}/);
    assert.match(RELEASE_SMOKE, /SOURCE_SHA.*!=.*EXPECTED_SHA/s);
    assert.match(RELEASE_SMOKE, /^concurrency:\n  group: staging-release-smoke\n  cancel-in-progress: false$/m);
    const preDeploy = RELEASE_SMOKE.indexOf('Wait for exact frontend and backend staging release');
    const browserSuite = RELEASE_SMOKE.indexOf('Run live staging release smoke');
    const postDeploy = RELEASE_SMOKE.indexOf('Verify exact frontend and backend staging release');
    assert.ok(preDeploy > -1 && preDeploy < browserSuite,
      'exact frontend/backend deployment must be proven before browser tests');
    assert.ok(postDeploy > browserSuite,
      'exact frontend/backend deployment must be rechecked after browser tests');
  });

  test('main accepts only the repository staging head or a pinned release cut', () => {
    assert.match(PROMOTION, /^  pull_request:\n    branches: \[main\]$/m);
    assert.match(PROMOTION, /HEAD_REPO.*!= "\$GITHUB_REPOSITORY"/s);
    assert.match(PROMOTION, /if \[ "\$HEAD_REF" = "staging" \]/);
    assert.match(PROMOTION, /git\/ref\/heads\/staging/);
    assert.match(PROMOTION, /STAGING_SHA.*!= "\$HEAD_SHA"/s);
    // release/<sha>: the name pins the head, the commit is already in staging,
    // and the pinned branch may not move while the gate waits.
    assert.ok(PROMOTION.includes('"$HEAD_REF" =~ ^release/([0-9a-f]{7,40})$'),
      'release cuts must be named release/<hex sha>');
    assert.ok(PROMOTION.includes('"$HEAD_SHA" != "$PIN"*'),
      'the release branch name must pin its head commit');
    assert.ok(PROMOTION.includes('compare/$HEAD_SHA...staging'),
      'a release cut must be contained in staging');
    assert.match(PROMOTION, /"\$RELATION" != "identical" \] && \[ "\$RELATION" != "ahead"/);
    assert.ok(PROMOTION.includes('git/ref/heads/$HEAD_REF'),
      'the pinned release branch must not move while the gate waits');
    // Any other head is rejected outright.
    const head = PROMOTION.split(/\n      - name: /)
      .find((body) => body.startsWith('Require the repository staging branch or a pinned release cut\n'));
    assert.ok(head, 'head step');
    assert.match(head, /else\n\s+echo "::error::Production accepts only[^\n]*"\n\s+exit 1\n\s+fi/);
  });

  test('the head step accepts staging and pinned release cuts and rejects the rest', () => {
    const head = PROMOTION.split(/\n      - name: /)
      .find((body) => body.startsWith('Require the repository staging branch or a pinned release cut\n'));
    const script = head.split('        run: |\n')[1]
      .split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'promotion-gate-'));
    // Stub gh: answers the two API reads the step makes from environment values.
    writeFileSync(path.join(dir, 'gh'), [
      '#!/usr/bin/env bash',
      'case "$*" in',
      '  *git/ref/heads/staging*) echo "$STUB_STAGING" ;;',
      '  *compare/*) echo "$STUB_RELATION" ;;',
      '  *) echo "unexpected gh call: $*" >&2; exit 9 ;;',
      'esac',
    ].join('\n'));
    chmodSync(path.join(dir, 'gh'), 0o755);
    const cut = 'caf42e6bd278d8cf32c751523c585b5c38077fbd';
    const run = (env) => {
      const output = path.join(dir, `out-${Math.random()}`);
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-e', '-c', script], {
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'owner/repo',
          HEAD_REPO: 'owner/repo',
          GITHUB_OUTPUT: output,
          STUB_STAGING: cut,
          STUB_RELATION: 'ahead',
          ...env,
        },
        encoding: 'utf8',
      });
      return { status: result.status, out: readFileSync(output, 'utf8'), log: result.stdout + result.stderr };
    };
    const ok = (env, mode) => {
      const result = run(env);
      assert.equal(result.status, 0, result.log);
      assert.equal(result.out.trim(), `mode=${mode}`);
    };
    const rejected = (env, pattern) => {
      const result = run(env);
      assert.notEqual(result.status, 0, result.log);
      assert.match(result.log, pattern);
      assert.equal(result.out.trim(), '');
    };
    ok({ HEAD_REF: 'staging', HEAD_SHA: cut }, 'staging');
    ok({ HEAD_REF: 'release/caf42e6b', HEAD_SHA: cut }, 'release');
    ok({ HEAD_REF: `release/${cut}`, HEAD_SHA: cut, STUB_RELATION: 'identical' }, 'release');
    rejected({ HEAD_REF: 'staging', HEAD_SHA: cut, STUB_STAGING: 'f'.repeat(40) }, /stale/);
    rejected({ HEAD_REF: 'release/caf42e6b', HEAD_SHA: cut, HEAD_REPO: 'fork/repo' }, /only a promotion PR/);
    rejected({ HEAD_REF: 'release/7a2d826b', HEAD_SHA: cut }, /must point at the commit it names/);
    rejected({ HEAD_REF: 'release/caf42e6b', HEAD_SHA: cut, STUB_RELATION: 'diverged' }, /not contained in staging/);
    rejected({ HEAD_REF: 'release/caf42e6b', HEAD_SHA: cut, STUB_RELATION: 'behind' }, /not contained in staging/);
    for (const ref of ['release/7a2d826b-hotfix-2457', 'release/CAF42E6B', 'release/latest', 'feature/x', 'main']) {
      rejected({ HEAD_REF: ref, HEAD_SHA: cut }, /only a promotion PR/);
    }
  });

  test('the merge result must deploy exactly the smoked tree', () => {
    const step = PROMOTION.split(/\n      - name: /)
      .find((body) => body.startsWith('Require the merge result to deploy exactly the smoked tree\n'));
    assert.ok(step, 'merge-tree step');
    assert.ok(PROMOTION.indexOf('Require the merge result to deploy exactly the smoked tree')
      < PROMOTION.indexOf('Require green integrated staging evidence for the exact SHA'));
    assert.match(PROMOTION, /uses: actions\/checkout@v\d+\n\s+with:\n\s+fetch-depth: 0/);
    const script = step.split('        run: |\n')[1]
      .split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
    const repo = mkdtempSync(path.join(os.tmpdir(), 'promotion-tree-'));
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const commit = (file, text, message) => {
      writeFileSync(path.join(repo, file), text);
      git('add', '-A');
      git('commit', '-q', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    git('init', '-q', '-b', 'main');
    const base = commit('app.txt', 'v1\n', 'base');
    git('checkout', '-q', '-b', 'staging');
    commit('feature.txt', 'feature\n', 'feature');
    const cut = commit('fix.txt', 'fix\n', 'fix in staging');
    const run = (mainSha) => {
      git('update-ref', 'refs/remotes/origin/main', mainSha);
      const result = spawnSync('bash', ['-e', '-c', script], {
        cwd: repo, env: { PATH: process.env.PATH, BASE_REF: 'main', HEAD_SHA: cut }, encoding: 'utf8' });
      return { status: result.status, log: result.stdout + result.stderr };
    };
    // main still at the old base: the merge result is the cut's tree.
    assert.equal(run(base).status, 0, run(base).log);
    // main got the same fix as its own hotfix (other SHA, same content): still the cut's tree.
    git('checkout', '-q', '-b', 'hotfix-same', base);
    const sameHotfix = commit('fix.txt', 'fix\n', 'same hotfix on main');
    assert.notEqual(sameHotfix, cut);
    const same = run(sameHotfix);
    assert.equal(same.status, 0, same.log);
    assert.match(same.log, /equals the smoked tree/);
    // main got a hotfix the cut does not contain: the merge would deploy an unsmoked tree.
    git('checkout', '-q', '-b', 'hotfix-own', base);
    const ownHotfix = commit('hotfix.txt', 'only on main\n', 'own hotfix on main');
    const own = run(ownHotfix);
    assert.notEqual(own.status, 0, own.log);
    assert.match(own.log, /differs from the smoked cut/);
    assert.match(own.log, /hotfix\.txt/);
    // main changed the same file differently: a conflict is refused too.
    git('checkout', '-q', '-b', 'hotfix-conflict', base);
    const conflicting = commit('fix.txt', 'other fix\n', 'conflicting hotfix');
    const conflict = run(conflicting);
    assert.notEqual(conflict.status, 0, conflict.log);
    assert.match(conflict.log, /conflicts/);
  });

  test('release cuts need existing staging push runs and a smoke that really ran', () => {
    assert.match(PROMOTION, /runs\?branch=staging&event=push&head_sha=\$HEAD_SHA/);
    assert.match(PROMOTION, /"\$RUN_ID" = "missing" \] && \[ "\$MODE" = "release" \]/);
    assert.ok(PROMOTION.includes('select(.name == "Run live staging release smoke")'),
      'a superseded smoke run must not count as promotion evidence');
    assert.match(PROMOTION, /"\$SMOKE_STEP" != "success"/);
  });

  test('only proven supersession skips old smoke; current SHA keeps the full checks and timeout', () => {
    const step = (name) => RELEASE_SMOKE.split(/\n      - name: /)
      .find((body) => body.startsWith(`${name}\n`));
    const wait = step('Wait for exact frontend and backend staging release');
    assert.match(wait, /id: wait_for_release/);
    assert.match(wait, /timeout-minutes: 12/);
    assert.match(wait, /seq 1 60/);
    assert.match(wait, /sleep 10/);
    for (const name of ['Grammar checker runs on the staging backend', 'Run live staging release smoke']) {
      assert.match(step(name), /if: steps\.wait_for_release\.outputs\.superseded != 'true'/);
    }
    const verify = step('Verify exact frontend and backend staging release');
    assert.match(verify, /if: always\(\) && steps\.wait_for_release\.outputs\.superseded != 'true'/);
    for (const body of [wait, verify]) {
      assert.match(body, /STAGING_RELEASE_ALLOW_SUPERSEDED: 'true'/);
      assert.match(body, /RELEASE_PROVENANCE_REQUIRED: 'true'/);
    }
    // A failed browser suite must stay red even if the final verification is superseded.
    assert.doesNotMatch(RELEASE_SMOKE, /continue-on-error/);
  });

  test('promotion requires all integrated checks and the permanent smoke on the same SHA', () => {
    for (const workflow of [
      'backend-tests.yml',
      'spec-governance.yml',
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
      'Spec and PR metadata',
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
    assert.equal(
      (PROMOTION.match(/\[ "\$RUN_STATUS" = "pending" \]/g) || []).length,
      1,
      'integrated workflow polling must wait through GitHub pending state',
    );
    assert.doesNotMatch(PROMOTION, /staging-e2e\.yml|release-smoke \/ Staging release smoke/);
  });

  test('operator and agent documentation prohibit direct feature releases to main', () => {
    assert.match(RUNBOOK, /feature branch from `origin\/staging`/);
    assert.match(RUNBOOK, /head `staging`\s+and base `main`/);
    assert.match(AGENT_RULES, /PR base is `staging`, never `main`/);
    assert.match(AGENT_RULES, /head `staging` and base `main`/);
  });

  test('production drift compares the serving release with repository main', () => {
    assert.match(PRODUCTION_DRIFT, /^  schedule:\n    - cron:/m);
    assert.match(PRODUCTION_DRIFT, /^  workflow_dispatch:$/m);
    assert.match(PRODUCTION_DRIFT, /git\/ref\/heads\/main/);
    assert.match(PRODUCTION_DRIFT, /runtime-config\.js/);
    assert.match(PRODUCTION_DRIFT, /SERVING.*!=.*MAIN_SHA/s);
    assert.doesNotMatch(PRODUCTION_DRIFT, /GITHUB_SHA/);
  });
});
