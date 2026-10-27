// TASK B2 — transport + gate wiring for the staging test-data toggle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (...parts) => readFileSync(new URL(`../${parts.join('/')}`, import.meta.url), 'utf8');

test('api.js sends X-Show-Test-Data only when this browser opted in', () => {
  const api = read('public', 'js', 'api.js');
  assert.match(api, /localStorage\.getItem\('aver\.showTestData'\) === '1'\) headers\['X-Show-Test-Data'\] = '1'/);
  // Wrapped: blocked storage must never break a request.
  assert.match(api, /try \{\s*if \(window\.localStorage\.getItem\('aver\.showTestData'\)/);
});

test('the storage key matches the toggle and the gate renders it for admins only', () => {
  assert.match(read('lib', 'admin-test-data-api.ts'), /SHOW_TEST_DATA_STORAGE_KEY = 'aver\.showTestData'/);
  const gate = read('components', 'admin-access-gate.tsx');
  assert.match(gate, /<AdminProfileContext\.Provider value=\{access\.profile\}><AdminTestDataToggle \/>\{children\}/);
});

test('the typed contract carries the visibility route', () => {
  const types = read('types', 'api.d.ts');
  assert.match(types, /"\/admin\/test-data\/visibility": \{/);
  assert.match(types, /AdminTestDataVisibilityOut: \{\s*\/\*\* Hiding Enabled \*\/\s*hiding_enabled: boolean;\s*\/\*\* Showing Test Data \*\/\s*showing_test_data: boolean;/);
});
