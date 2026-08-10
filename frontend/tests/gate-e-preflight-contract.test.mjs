/** Gate E preflight truth contract: evidence must not outrun implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const PREFLIGHT = read('docs/GATE_E_PREFLIGHT_2026-08-09.md');
const SPIKE_3 = read('docs/SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md');
const MASTER_PLAN = read('docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md');
const STAGING_CONFIG = read('frontend/playwright.staging.config.js');
const STAGING_WORKFLOW = read('.github/workflows/staging-e2e.yml');

const citedRepoPaths = (document) => [...new Set(
  [...document.matchAll(/`((?:\.github|docs|frontend)\/[^`]+)`/g)].map((match) => match[1]),
)];

describe('Gate E preflight reports current evidence truthfully', () => {
  test('status remains NOT READY and every master-plan criterion is represented', () => {
    assert.match(PREFLIGHT, /\*\*Trạng thái:\*\* NOT READY\./);
    const section = MASTER_PLAN.match(/### Gate E — Core-flow ready\s+([\s\S]*?)(?=\n### Gate F —)/)?.[1];
    assert.ok(section, 'Gate E section missing from the canonical master plan');
    const criteria = [...section.matchAll(/^- (.+)$/gm)].map((match) => match[1].replace(/\.$/, ''));
    assert.equal(criteria.length, 4, 'review the preflight matrix when canonical Gate E criteria change');
    for (const criterion of criteria) {
      assert.ok(PREFLIGHT.includes(`| ${criterion} |`), `missing canonical Gate E criterion: ${criterion}`);
    }
  });

  test('pins the audited baseline and keeps compiled ownership separate from the behavior cohort', () => {
    assert.match(PREFLIGHT, /main@d292de38919fa5b79854142d4b5053241642cbcd/);
    assert.match(PREFLIGHT, /Compiled ownership graph có 32 App Router route/);
    assert.match(PREFLIGHT, /cohort 29 route[\s\S]{0,100}hard-navigation debt về 0\/29/);
    assert.match(PREFLIGHT, /Hai mẫu số này\s+khác nhau[\s\S]{0,80}không được dùng lẫn nhau/);
  });

  test('every repository path cited as evidence is derived from the docs and exists', () => {
    const evidencePaths = citedRepoPaths(`${PREFLIGHT}\n${SPIKE_3}`);
    assert.ok(evidencePaths.length >= 12, 'unexpectedly few Gate E evidence paths were extracted');
    for (const relativePath of evidencePaths) {
      assert.ok(existsSync(path.join(ROOT, relativePath)), `missing Gate E evidence path: ${relativePath}`);
    }
  });

  test('staging config, install workflow and preflight agree on whether WebKit exists', () => {
    const configCode = STAGING_CONFIG.replace(/^\s*\/\/.*$/gm, '');
    const workflowCode = STAGING_WORKFLOW.replace(/^\s*#.*$/gm, '');
    const projectNames = [...configCode.matchAll(/\bname:\s*'([^']+)'/g)].map((match) => match[1]);
    const hasChromiumProject = projectNames.some((name) => name.includes('chromium'));
    const hasWebkitProject = projectNames.some((name) => name.includes('webkit'));
    const installsWebkit = /playwright install --with-deps[^\n]*\bwebkit\b/.test(workflowCode);
    const claimsChromiumOnly = /staging E2E chỉ chạy\s+Chromium/.test(PREFLIGHT);

    assert.ok(hasChromiumProject, 'staging config must retain a Chromium project');
    assert.match(workflowCode, /playwright install --with-deps chromium/);
    assert.equal(hasWebkitProject, installsWebkit, 'staging config and browser install must add/remove WebKit together');
    assert.equal(claimsChromiumOnly, !hasWebkitProject, 'update preflight when staging WebKit coverage changes');
    assert.match(PREFLIGHT, /Không tìm thấy frozen Gate E threshold\/register/);
  });

  test('retry-reset invariant is fail-closed at the staging runner', () => {
    assert.match(STAGING_CONFIG, /^\s*retries:\s*0,\s*$/m);
    assert.match(PREFLIGHT, /retry vẫn bằng 0/);
  });
});

describe('Spike 3 reflects the remediated speaking resume contract', () => {
  test('does not repeat the obsolete lost-chain or pending-blob claims', () => {
    assert.doesNotMatch(SPIKE_3, /_ftAllSessionIds[^\n]*\*\*MẤT — CRITICAL/);
    assert.doesNotMatch(SPIKE_3, /Full-test: cross-stack resume KHÔNG an toàn cho tới khi chain được persist/);
    assert.match(SPIKE_3, /`_pendingTestAnswers` \| \*\*Không còn tồn tại\.\*\*/);
  });

  test('pins the real same-origin/same-tab boundary instead of claiming multi-device resume', () => {
    assert.match(SPIKE_3, /`ielts_ft_session_ids`/);
    assert.match(SPIKE_3, /cùng origin, cùng tab/);
    assert.match(SPIKE_3, /client hoàn toàn mới, tab mới, origin khác hoặc thiết bị khác/);
    assert.match(SPIKE_3, /backend chưa sở hữu chain/);
  });

  test('labels full-test cross-stack handoff as inference until a browser transition exists', () => {
    assert.match(SPIKE_3, /full-test cross-stack handoff chưa được test/);
    assert.match(SPIKE_3, /Handoff\s+legacy↔Next là inference/);
    assert.doesNotMatch(SPIKE_3, /chain đã sống qua refresh và handoff/);
  });
});
