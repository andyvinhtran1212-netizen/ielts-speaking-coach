// GOI-11 §5.6 — one label source for the course actions (created by G05-T02).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COURSE_ACCESS_ACTIONS, accessActionLabel } from '../lib/course-access-labels.mjs';

test('accessActionLabel (GOI-11 §5.6)', () => {
  assert.equal(accessActionLabel('expired'), 'Đăng ký lại');
  assert.equal(accessActionLabel('guest'), COURSE_ACCESS_ACTIONS.enroll);
  assert.equal(accessActionLabel('can_enroll'), 'Đăng ký khoá này');
  assert.equal(accessActionLabel('enrolled'), 'Vào học');
  assert.equal(accessActionLabel('open_order'), null);
  assert.equal(accessActionLabel(undefined), null);
});
