// COURSEACCESS-0055 FR-019 (G04-T07b): a course-only learner opens the Speaking tabs
// the backend admits. /auth/me sends `speaking_course_access`; the page merges it
// into the permissions it gates on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PERMISSIONS, effectiveSpeakingPermissions, hasPermission, TAB_DEFS } from '../lib/speaking-copy.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEHAVIOR = readFileSync(path.join(FRONTEND, 'app/(authed-speaking)/speaking/speaking-behavior.tsx'), 'utf8');
const API = readFileSync(path.join(FRONTEND, 'types/api.d.ts'), 'utf8');

test('a course-only learner gets every Speaking tab', () => {
  const perms = effectiveSpeakingPermissions({ permissions: [], speaking_course_access: true });
  for (const def of TAB_DEFS) assert.equal(hasPermission(perms, def.scope), true, def.tab);
  assert.deepEqual(perms, DEFAULT_PERMISSIONS);
});

test('without course access the access-code list is used as is', () => {
  assert.deepEqual(effectiveSpeakingPermissions({ permissions: ['practice_single'] }), ['practice_single']);
  assert.deepEqual(effectiveSpeakingPermissions({ permissions: [], speaking_course_access: false }), []);
  // Only a strict `true` opens access (default-deny, like the other /auth/me flags).
  assert.deepEqual(effectiveSpeakingPermissions({ permissions: [], speaking_course_access: 'true' }), []);
});

test('course access adds the missing modes without duplicating codes', () => {
  assert.deepEqual(
    effectiveSpeakingPermissions({ permissions: ['practice_single', 'writing'], speaking_course_access: true }),
    ['practice_single', 'writing', 'practice_part', 'practice_full'],
  );
});

test('a response without a permissions list keeps the current permissions', () => {
  assert.equal(effectiveSpeakingPermissions({}), null);
  assert.equal(effectiveSpeakingPermissions(null), null);
});

test('the Speaking page gates on the effective permissions, and the contract carries the field', () => {
  assert.match(BEHAVIOR, /const perms = effectiveSpeakingPermissions\(user\);\n  if \(perms\) st\.perms = perms;/);
  assert.doesNotMatch(BEHAVIOR, /st\.perms = user\.permissions/);
  assert.match(API, /speaking_course_access: boolean;/);
});
