import assert from 'node:assert/strict';
import test from 'node:test';

import { needsPermanentIeltsNavigation } from '../lib/listening-programme-navigation.mjs';

test('keeps IELTS hub navigation when no imported package is published', () => {
  assert.equal(needsPermanentIeltsNavigation([]), true);
});

test('keeps IELTS hub navigation when only General is published', () => {
  assert.equal(needsPermanentIeltsNavigation([{ id: 'general-listening-practice' }]), true);
});

test('does not duplicate the IELTS card after its package is published', () => {
  assert.equal(needsPermanentIeltsNavigation([
    { id: 'general-listening-practice' },
    { id: 'ielts-listening-practice' },
  ]), false);
});
