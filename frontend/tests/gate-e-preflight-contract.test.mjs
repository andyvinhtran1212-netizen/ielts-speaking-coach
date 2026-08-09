/** Gate E preflight truth contract: evidence must not outrun implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const PREFLIGHT = read('docs/GATE_E_PREFLIGHT_2026-08-09.md');
const SPIKE_3 = read('docs/SPIKE_3_CROSS_STACK_RESUME_2026-07-14.md');
const STAGING_CONFIG = read('frontend/playwright.staging.config.js');
const STAGING_WORKFLOW = read('.github/workflows/staging-e2e.yml');

describe('Gate E preflight reports current evidence truthfully', () => {
  test('status remains NOT READY and every master-plan criterion is represented', () => {
    assert.match(PREFLIGHT, /\*\*Trạng thái:\*\* NOT READY\./);
    for (const criterion of [
      'Versioned Safari/iOS/Chromium device matrix',
      'Reload/resume, ambiguous commit, partial persistence',
      'Sticky active-session hoặc drain strategy',
      '20 consecutive clean critical-suite executions',
    ]) {
      assert.ok(PREFLIGHT.includes(criterion), `missing Gate E criterion: ${criterion}`);
    }
  });

  test('automated matrix and ledger are partial, without inventing qualifying evidence', () => {
    assert.match(STAGING_CONFIG, /name: 'staging-core-chromium'/);
    assert.match(STAGING_CONFIG, /name: 'matrix-webkit-26\.4-desktop'/);
    assert.match(STAGING_WORKFLOW, /playwright install --with-deps chromium webkit/);
    assert.match(PREFLIGHT, /\| Versioned Safari\/iOS\/Chromium device matrix xanh \| \*\*PARTIAL\*\*/);
    assert.match(PREFLIGHT, /Chưa có real-device Safari 15\.6\/iOS 15\.8\.5 evidence/);
    assert.match(PREFLIGHT, /Critical-suite v1 freeze 33 tests/);
    assert.match(PREFLIGHT, /Chưa có qualifying 20-run artifact/);
  });

  test('retry-reset invariant is fail-closed at the staging runner', () => {
    assert.match(STAGING_CONFIG, /retries:\s*0/);
    assert.match(PREFLIGHT, /ledger reset trên fail\/skip\/flake\/rerun/);
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
});
