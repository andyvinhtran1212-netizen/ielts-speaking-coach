import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectUnsavedDrafts,
  INSTRUCTOR_INACTIVE_DETAIL,
  INSTRUCTOR_INACTIVE_TITLE,
  isInstructorInactiveError,
} from '../app/(authed-instructor)/instructor/instructor-inactive-model.mjs';

// ADMINAAL2-0032 FR-014 (T011). Rendered behaviour of the three clients lives
// in tests/react/instructor-inactive-state.test.tsx.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_GATE = readFileSync(join(ROOT, '..', 'backend', 'services', 'activation_gate.py'), 'utf8');
const CLIENTS = [
  ['(authed-instructor)', 'instructor', 'instructor-dashboard.tsx'],
  ['(authed-instructor-grade)', 'instructor', 'grade', 'instructor-grade.tsx'],
  ['(authed-instructor-compare)', 'instructor', 'compare', 'instructor-compare.tsx'],
].map((parts) => [parts.at(-1), readFileSync(join(ROOT, 'app', ...parts), 'utf8')]);

describe('inactive 403 detection', () => {
  test('matches the backend INACTIVE_DETAIL exactly', () => {
    assert.match(BACKEND_GATE, new RegExp(`INACTIVE_DETAIL = "${INSTRUCTOR_INACTIVE_DETAIL}"`));
    assert.equal(INSTRUCTOR_INACTIVE_TITLE, 'Tài khoản chưa được kích hoạt — liên hệ admin');
  });

  test('only the inactive 403 trips the denied state', () => {
    assert.equal(isInstructorInactiveError({ status: 403, detail: INSTRUCTOR_INACTIVE_DETAIL }), true);
    for (const other of [
      { status: 403, detail: 'Bài này không thuộc bạn' },
      { status: 403, detail: { code: 'mfa_required' } },
      { status: 401, detail: INSTRUCTOR_INACTIVE_DETAIL },
      new Error(INSTRUCTOR_INACTIVE_DETAIL),
      null,
      undefined,
    ]) assert.equal(isInstructorInactiveError(other), false);
  });
});

describe('unsaved drafts', () => {
  const field = (value, { defaultValue = '', label = null, aria = null, name = null, readOnly = false } = {}) => ({
    value, defaultValue, readOnly,
    closest: () => (label ? { querySelector: () => ({ textContent: label }) } : null),
    getAttribute: (key) => (key === 'aria-label' ? aria : key === 'name' ? name : null),
  });
  const root = (fields) => ({ querySelectorAll: () => fields });

  test('keeps typed free text with its label, skips untouched, blank and read-only fields', () => {
    assert.deepEqual(collectUnsavedDrafts(root([
      field('Lớp tối', { label: 'Tên lớp mới' }),
      field('Kept', { defaultValue: 'Kept', label: 'Untouched' }),
      field('   ', { label: 'Blank' }),
      field('copy', { readOnly: true, label: 'Draft copy' }),
      field('Đề mới', { aria: 'Đề bài' }),
      field('x', { name: 'title' }),
    ])), [
      { label: 'Tên lớp mới', value: 'Lớp tối' },
      { label: 'Đề bài', value: 'Đề mới' },
      { label: 'title', value: 'x' },
    ]);
    assert.deepEqual(collectUnsavedDrafts(null), []);
  });
});

describe('the three instructor clients', () => {
  for (const [name, source] of CLIENTS) {
    test(`${name} renders the denied state before any instructor content`, () => {
      assert.match(source, /useInstructorInactiveGuard\(/);
      const denied = source.indexOf('<InstructorInactiveState');
      assert.ok(denied > 0, 'renders InstructorInactiveState');
      assert.ok(denied < source.lastIndexOf('return ('), 'early return before the main tree');
      assert.match(source, /resetInactive\(\);/, 'an account change clears the state');
      assert.match(source, /deny\(/);
    });
  }
});
