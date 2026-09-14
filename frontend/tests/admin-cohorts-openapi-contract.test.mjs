import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');
const API = read('lib', 'admin-cohorts-api.ts');
const OPENAPI = read('types', 'api.d.ts');
const CONSUMERS = [
  ['app', '(authed-admin-users)', 'admin', 'users', 'admin-users.tsx'],
  ['app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx'],
  ['app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx'],
  ['app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx'],
  ['app', '(authed-admin-mock-exams)', 'admin', 'mock-exams', 'admin-mock-exams.tsx'],
];

describe('shared admin cohort read contract', () => {
  test('derives the picker/rollup superset from generated OpenAPI', () => {
    assert.match(API, /ApiGetJson<'\/admin\/cohorts'>/);
    assert.match(API, /getBrowserJson\('\/admin\/cohorts', query\)/);
    assert.match(OPENAPI, /"application\/json": components\["schemas"\]\["AdminCohortListOut"\]/);
    assert.match(OPENAPI, /member_count\?: number \| null/);
    assert.match(OPENAPI, /rollup_failed\?: boolean \| null/);
  });

  test('all shared picker and directory consumers use the adapter', () => {
    for (const parts of CONSUMERS) {
      const source = read(...parts);
      assert.match(source, /getAdminCohorts\(/, parts.join('/'));
      assert.doesNotMatch(source, /window\.api\.get<unknown>\('\/admin\/cohorts\?/,
        parts.join('/'));
    }
  });

  test('query construction distinguishes picker and rollup modes', () => {
    assert.match(API, /query\.set\('is_active', String\(options\.isActive\)\)/);
    assert.match(API, /query\.set\('with_rollup', String\(options\.withRollup\)\)/);
    assert.match(API, /query\.set\('course_id', options\.courseId\)/);
  });
});
