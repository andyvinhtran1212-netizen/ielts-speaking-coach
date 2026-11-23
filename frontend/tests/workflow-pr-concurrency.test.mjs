// CI queue (23/11): PR runs of the six PR-triggered workflows cancel the
// same PR's older run; push/schedule/dispatch runs never share a group, so a
// staging/main SHA the promotion gate needs is never cancelled or replaced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const WORKFLOWS = ['backend-tests', 'typecheck', 'spec-governance', 'route-manifest', 'e2e', 'legacy-freeze'];
const BLOCK = /^concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| github\.run_id \}\}\n  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m;

for (const name of WORKFLOWS) {
  test(`${name}: PR runs cancel older runs of the same PR; other events get a unique group`, () => {
    assert.match(read(name), BLOCK);
  });
}

test('draft PRs skip the heavy jobs and run them on ready_for_review', () => {
  const backend = read('backend-tests');
  assert.equal((backend.match(/github\.event\.pull_request\.draft && 'false' \|\| steps\.filter\.outputs\.run_tests/g) || []).length, 2);
  assert.match(backend, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  const e2e = read('e2e');
  assert.match(e2e, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(e2e, /if: \$\{\{ github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.draft \}\}/);
});
