import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptCourses, promptContentTags, tagsWithCourses, matchesPromptCourse } from '../lib/writing-prompt-courses.mjs';
import { normalizePromptOptions } from '../lib/admin-writing-assignments-model.mjs';
import { promptMatches, promptsPageHref } from '../lib/admin-writing-prompts-model.mjs';

test('allocates the same prompt to several courses without losing content tags', () => {
  const tags = tagsWithCourses(['education', 'course:2', ' education ', 'course:6'], ['5', '1', '5', '6']);
  assert.deepEqual(tags, ['education', 'course:6', 'course:1', 'course:5']);
  assert.deepEqual(promptCourses(tags), ['1', '5']);
  assert.deepEqual(promptContentTags(tags), ['education', 'course:6']);
  assert.deepEqual(tagsWithCourses(tags, []), ['education', 'course:6']);
});

test('course filtering composes with exam visibility and search without inferring titles', () => {
  const row = { title: 'Course 3 exam', promptText: 'Education policy', tags: ['education', 'course:2'], examOnly: true };
  assert.equal(promptMatches(row, { course: '2', visibility: 'exam', q: 'education' }), true);
  assert.equal(promptMatches(row, { course: '3' }), false);
  assert.equal(promptMatches(row, { course: '2', visibility: 'student' }), false);
  assert.equal(matchesPromptCourse([], 'unassigned'), true);
  assert.equal(promptMatches({ ...row, tags: [] }, { course: 'unassigned' }), true);
  assert.equal(promptMatches({ ...row, tags: [] }, { course: '3' }), false);
  assert.equal(promptsPageHref({ course: '5', lifecycle: 'archived', visibility: 'exam' }), '/admin/writing/prompts?status=archived&visibility=exam&course=5');
  assert.equal(promptsPageHref({ course: '6' }), '/admin/writing/prompts');
});

test('assignment picker reuses persisted course membership and supports legacy unallocated prompts', () => {
  const raw = { id: 'p1', title: 'Course 3 prompt', task_type: 'task2', tags: ['course:2', 'course:5'] };
  assert.deepEqual(normalizePromptOptions({ prompts: [raw] }).rows[0].courses, ['2', '5']);
  assert.deepEqual(normalizePromptOptions({ prompts: [{ ...raw, tags: undefined }] }).rows[0].courses, []);
});
