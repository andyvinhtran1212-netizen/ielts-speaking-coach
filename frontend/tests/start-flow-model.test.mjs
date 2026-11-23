// LEARNERCORE-0063 FR-065: decisions of "Lần đầu vào" at /start.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  goalPayload,
  hasActiveOnlineCourse,
  hasClass,
  startRedirect,
  startingPoint,
} from '../lib/start-flow-model.mjs';

describe('start flow model', () => {
  test('shown once: done → /home; a valid next wins; an unsafe next is ignored', () => {
    assert.equal(startRedirect({ onboarding_completed: false }, null), null);
    assert.equal(startRedirect({ onboarding_completed: true }, null), '/home');
    assert.equal(startRedirect({ onboarding_completed: false }, '/enroll/writing-6'), '/enroll/writing-6');
    assert.equal(startRedirect({ onboarding_completed: false }, '//evil.com'), null);
    assert.equal(startRedirect({ onboarding_completed: false }, 'https://evil.com'), null);
  });

  test('online course only from an active online item of /api/me/courses', () => {
    assert.equal(hasActiveOnlineCourse({ items: [{ kind: 'online', state: 'active' }] }), true);
    assert.equal(hasActiveOnlineCourse({ items: [{ kind: 'online', state: 'expired' }] }), false);
    assert.equal(hasActiveOnlineCourse({ items: [{ kind: 'class', state: 'active' }] }), false);
    assert.equal(hasActiveOnlineCourse(null), false);
    assert.equal(hasActiveOnlineCourse({ detail: 'Not Found' }), false);
  });

  test('class from has_class === true only', () => {
    assert.equal(hasClass({ has_class: true }), true);
    assert.equal(hasClass({ has_class: 'true' }), false);
    assert.equal(hasClass(null), false);
  });

  test('pre-chosen point: class hides step 3, then online, else none', () => {
    assert.equal(startingPoint({ online: true, inClass: true }), 'class');
    assert.equal(startingPoint({ online: true, inClass: false }), 'online');
    assert.equal(startingPoint({ online: false, inClass: false }), 'none');
  });

  test('goal body carries only what was set and valid', () => {
    assert.deepEqual(goalPayload({ band: '', examDate: '' }), {});
    assert.deepEqual(goalPayload({ band: '6.5', examDate: '' }), { target_band: 6.5 });
    assert.deepEqual(goalPayload({ band: '9.5', examDate: '2027-03-01' }), { exam_date: '2027-03-01' });
    assert.deepEqual(goalPayload({ band: '7.0', examDate: '2027-13-45' }), { target_band: 7 });
  });
});
