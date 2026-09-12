import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = readFileSync(
  path.join(ROOT, '.github', 'workflows', 'next-native-browser.yml'),
  'utf8',
);

describe('permanent Next-native browser regression workflow', () => {
  test('runs for pull requests and both integration branches', () => {
    assert.match(WORKFLOW, /^name: Next-native browser regression$/m);
    assert.match(WORKFLOW, /^  pull_request:$/m);
    assert.match(WORKFLOW, /^  push:\n    branches: \[main, staging\]$/m);
    assert.match(WORKFLOW, /^  schedule:$/m);
    assert.match(WORKFLOW, /^  workflow_dispatch:$/m);
    assert.match(WORKFLOW, /- '\.github\/workflows\/next-native-browser\.yml'/);
    assert.doesNotMatch(WORKFLOW, /\.github\/workflows\/parity-gate\.yml/);
  });

  test('builds and starts the production Next server in an isolated environment', () => {
    assert.match(WORKFLOW, /run: npm run build/);
    assert.match(WORKFLOW, /npx next start -p "\$TEST_PORT"/);
    assert.match(WORKFLOW, /AVER_API_BASE: http:\/\/127\.0\.0\.1:9/);
    assert.match(WORKFLOW, /AVER_SUPABASE_URL: https:\/\/example\.supabase\.co/);
    assert.doesNotMatch(WORKFLOW, /ielts-speaking-coach-production|huwsmtubwulikhlmcirx/);
  });

  test('keeps broad product coverage and every critical skill family', () => {
    for (const pathGlob of [
      "frontend/app/**",
      "frontend/components/**",
      "frontend/lib/**",
      "frontend/public/css/**",
      "frontend/public/js/**",
      "frontend/tests/**",
      "backend/**",
    ]) {
      assert.ok(WORKFLOW.includes(`- '${pathGlob}'`), `missing trigger ${pathGlob}`);
    }

    const invoked = [...WORKFLOW.matchAll(/run: node tooling\/(verify-[^\s"]+\.mjs)/g)]
      .map((match) => match[1]);
    assert.ok(invoked.length >= 90, `expected at least 90 browser verifiers, got ${invoked.length}`);
    assert.equal(new Set(invoked).size, invoked.length, 'browser verifiers must not run twice');
    for (const required of [
      'verify-speaking-flow.mjs',
      'verify-reading-test-flow.mjs',
      'verify-listening-test-session-flow.mjs',
      'verify-mock-exam-flow.mjs',
      'verify-writing-admission-flow.mjs',
      'verify-next-responsive-flow.mjs',
      'verify-admin-classes-flow.mjs',
      'verify-admin-writing-flow.mjs',
      'verify-write-flows.mjs',
    ]) {
      assert.ok(invoked.includes(required), `missing critical verifier ${required}`);
    }
  });

  test('is Next-only and cannot silently retain a migration phase', () => {
    assert.match(WORKFLOW, /verify-onboarding-flow\.mjs[^\n]+--next-only/);
    assert.match(WORKFLOW, /verify-admin-feedback-flow\.mjs[^\n]+--next-only/);
    assert.doesNotMatch(WORKFLOW, /parity-diff|steps\.gate_f|WF_LEGACY|PROBE_EMAIL|legacy ↔ Next/);
  });

  test('always stops its local server and preserves failure evidence', () => {
    assert.match(WORKFLOW, /name: Nộp log server khi lỗi\n\s+if: \$\{\{ failure\(\) \}\}/);
    assert.match(WORKFLOW, /name: Dừng Next\n\s+if: \$\{\{ always\(\) \}\}/);
  });
});
