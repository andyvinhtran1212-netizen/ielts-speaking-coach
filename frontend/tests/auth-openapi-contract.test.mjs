import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const TYPES = read('types', 'api.d.ts');
const AUTH_API = read('lib', 'auth-api.ts');

const operations = [
  ['get_me_auth_me_get', 'AuthMeResponse'],
  ['check_active_auth_check_active_get', 'AuthActiveStatusResponse'],
  ['get_profile_auth_profile_get', 'AuthProfileResponse'],
];

test('authenticated identity GET responses are concrete generated schemas', () => {
  for (const [operation, schema] of operations) {
    const start = TYPES.indexOf(`${operation}: {`);
    const next = TYPES.indexOf('\n    };', start);
    const source = TYPES.slice(start, next);
    assert.ok(start >= 0, operation);
    assert.match(source, new RegExp(`"application/json": components\\["schemas"\\]\\["${schema}"\\]`));
    assert.doesNotMatch(source, /"application\/json": unknown/);
  }
});

test('browser auth reads derive types from OpenAPI through one adapter', () => {
  for (const route of ['/auth/me', '/auth/profile', '/auth/check-active']) {
    assert.match(AUTH_API, new RegExp(`ApiGetJson<'${route}'>`));
    assert.match(AUTH_API, new RegExp(`getBrowserJson\\('${route}'`));
  }
  assert.match(AUTH_API, /normalizeAuthMe/);
  assert.match(AUTH_API, /normalizeAuthRoleIdentity/);
  assert.match(AUTH_API, /normalizeAuthProfile/);
  assert.match(AUTH_API, /normalizeAuthActiveStatus/);
  assert.doesNotMatch(AUTH_API, /interface Auth|:\s*any\b|as any/);
});
