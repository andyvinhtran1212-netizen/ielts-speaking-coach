import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(FRONTEND, ...parts), 'utf8');
const API = read('lib', 'admin-students-api.ts');
const OPENAPI = read('types', 'api.d.ts');
const DIRECTORY = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');

describe('admin student directory read contract', () => {
  test('derives the list wire shape from generated OpenAPI', () => {
    assert.match(API, /ApiGetJson<'\/admin\/students'>/);
    assert.match(API, /getBrowserJson\('\/admin\/students', query\)/);
    assert.match(OPENAPI, /"application\/json": components\["schemas"\]\["AdminStudentDirectoryRowOut"\]\[\]/);
    assert.match(OPENAPI, /membership_lookup_failed: boolean/);
  });

  test('the directory uses the typed list adapter and retains mutations on the bridge', () => {
    assert.match(DIRECTORY, /getAdminStudents\(\{ limit: LIMIT, search: search \|\| undefined \}\)/);
    assert.doesNotMatch(DIRECTORY, /window\.api\.get<unknown>\(path\)/);
    assert.match(DIRECTORY, /window\.api\.patch\(`\/admin\/students\/\$\{/);
    assert.match(DIRECTORY, /window\.api\.post\('\/admin\/students'/);
  });

  test('query construction keeps server-side search and bounds explicit', () => {
    assert.match(API, /query\.set\('search', options\.search\)/);
    assert.match(API, /query\.set\('limit', String\(options\.limit\)\)/);
    assert.match(API, /query\.set\('offset', String\(options\.offset\)\)/);
  });
});
