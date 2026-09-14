import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');
const API = read('lib', 'admin-courses-api.ts');
const OPENAPI = read('types', 'api.d.ts');
const DIRECTORY = read('app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const DETAIL = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');

describe('admin course ladder read contract', () => {
  test('derives the course envelope from generated OpenAPI', () => {
    assert.match(API, /ApiGetJson<'\/admin\/courses'>/);
    assert.match(API, /getBrowserJson\('\/admin\/courses', query\)/);
    assert.match(OPENAPI, /"application\/json": components\["schemas"\]\["AdminCourseListOut"\]/);
    assert.match(OPENAPI, /sort_order: number/);
  });

  test('both class surfaces use the shared adapter', () => {
    for (const source of [DIRECTORY, DETAIL]) {
      assert.match(source, /getAdminCourses\(\)/);
      assert.doesNotMatch(source, /window\.api\.get<unknown>\('\/admin\/courses'\)/);
    }
  });

  test('query construction preserves the optional active filter', () => {
    assert.match(API, /query\.set\('is_active', String\(options\.isActive\)\)/);
  });
});
