import assert from 'node:assert/strict';
import test from 'node:test';

import { needsPermanentIeltsNavigation, programmeLibraryPath, programmeLessonPath } from '../lib/listening-programme-navigation.mjs';

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

test('source collection backlinks use day numbers and never feed lesson UUIDs to the day route', () => {
  assert.equal(programmeLibraryPath('ielts-80-days-listening'), '/listening/ielts/80-days');
  assert.equal(programmeLessonPath('ielts-80-days-listening', 'lesson-uuid', 61), '/listening/ielts/80-days/61');
  for (const invalid of [undefined, null, 0, 81, 1.5]) assert.equal(programmeLessonPath('ielts-80-days-listening', 'lesson-uuid', invalid), '/listening/ielts/80-days');
  assert.equal(programmeLessonPath('ielts-listening-practice', 'lesson-uuid'), '/listening/ielts/lesson-uuid');
  assert.equal(programmeLibraryPath('unknown'), '/listening');
});
