import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeWritingNavigation,
  normalizeWritingQueueContext,
  writingNavigationHref,
  writingQueueSearch,
} from '../lib/admin-writing-navigation-model.mjs';
import { readAdminGradeQueue } from '../lib/admin-writing-grade-model.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

describe('canonical Writing navigation', () => {
  const queue = {
    lane: 'mock', queueStatus: 'grading', cohortId: 'c/1', overdue: true,
    query: 'Lan Anh', embed: true, page: 2, pageSize: 50,
  };

  test('round-trips every Queue field through Status, Grade, next, and return', () => {
    const search = writingQueueSearch(queue);
    assert.equal(search, 'mocklane=1&cohort_id=c%2F1&overdue=1&embed=1&queue_status=grading&q=Lan+Anh&page=2&page_size=50');
    const restored = normalizeWritingQueueContext(new URLSearchParams(search));
    assert.deepEqual(restored, queue);
    const status = writingNavigationHref('status', { ...restored, from: 'queue', essayId: 'essay/1' });
    assert.equal(status, `/admin/writing/status?essay_id=essay%2F1&from=queue&${search}`);
    const parsedStatus = normalizeWritingNavigation(new URL(status, 'https://example.test').searchParams);
    assert.equal(writingNavigationHref('grade', parsedStatus), `/admin/writing/grade?essay_id=essay%2F1&from=queue&${search}`);
    assert.equal(writingNavigationHref('grade', { ...parsedStatus, essayId: 'essay/2' }), `/admin/writing/grade?essay_id=essay%2F2&from=queue&${search}`);
    assert.equal(writingNavigationHref('queue', parsedStatus), `/admin/writing/queue?${search}`);
  });

  test('page and size are URL state with safe old-link defaults', () => {
    assert.deepEqual(normalizeWritingQueueContext(new URLSearchParams('status=reviewed&page=2')).pageSize, 25);
    assert.equal(writingQueueSearch({ ...queue, page: 1, pageSize: 25 }), 'mocklane=1&cohort_id=c%2F1&overdue=1&embed=1&queue_status=grading&q=Lan+Anh');
    assert.equal(normalizeWritingQueueContext(new URLSearchParams('page=2oops&page_size=100')).page, 1);
    assert.equal(normalizeWritingQueueContext(new URLSearchParams('page=999999999999&page_size=50.0')).page, 100000);
    assert.equal(normalizeWritingQueueContext(new URLSearchParams('page_size=50.0')).pageSize, 25);
    assert.equal(normalizeWritingQueueContext(new URLSearchParams('status=bad&queue_status=failed')).lane, 'graded');
    assert.equal(normalizeWritingQueueContext(new URLSearchParams('mocklane=1&queue_status=bad')).queueStatus, '');
    assert.equal(normalizeWritingQueueContext(new URLSearchParams('q=first&q=second')).query, 'first');
  });

  test('Instructor and direct entries never acquire an ordinary Queue return', () => {
    const instructor = normalizeWritingNavigation(new URLSearchParams('essay_id=e1&from=instructor&view=my_claims&embed=1&mocklane=1'));
    assert.equal(writingNavigationHref('queue', instructor), '/admin/writing/instructor-queue?view=my_claims&embed=1&mocklane=1');
    assert.equal(writingNavigationHref('grade', instructor), '/admin/writing/grade?essay_id=e1&from=instructor&view=my_claims&embed=1&mocklane=1');
    const direct = normalizeWritingNavigation(new URLSearchParams('id=e1&from=https%3A%2F%2Fevil.test&status=reviewed'));
    assert.equal(direct.source, 'direct');
    assert.equal(direct.essayId, 'e1');
    assert.equal(writingNavigationHref('workspace', direct), '/admin/writing');
    assert.equal(writingNavigationHref('grade', direct), '/admin/writing/grade?essay_id=e1');
  });

  test('next essay requires matching account and exact Queue context', () => {
    const expected = { accountId: 'a1', contextKey: writingQueueSearch(queue) };
    const stored = JSON.stringify({ ...expected, ids: ['e1', 'e2'], i: 999 });
    assert.deepEqual(readAdminGradeQueue(stored, 'e1', expected), { inQueue: true, nextId: 'e2' });
    assert.equal(readAdminGradeQueue(stored, 'e1', { ...expected, accountId: 'a2' }), null);
    assert.equal(readAdminGradeQueue(stored, 'e1', { ...expected, contextKey: writingQueueSearch({ ...queue, pageSize: 25 }) }), null);
    assert.equal(readAdminGradeQueue(stored, 'e3', expected), null);
    assert.equal(readAdminGradeQueue(JSON.stringify({ ids: ['e1'] }), 'e1', expected), null);
  });

  test('all UI consumers use the shared route contract', () => {
    const queueComponent = read('app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx');
    const statusComponent = read('app', '(authed-admin-writing-status)', 'admin', 'writing', 'status', 'admin-writing-status.tsx');
    const gradeComponent = read('app', '(authed-admin-writing-grade)', 'admin', 'writing', 'grade', 'writing-grade-behavior.tsx');
    assert.match(queueComponent, /page_size: params\?\.get\('page_size'\)/);
    assert.match(queueComponent, /const pageSize = filters\.pageSize/);
    assert.match(queueComponent, /contextKey: writingQueueSearch\(filters\)/);
    assert.match(statusComponent, /from: params\?\.get\('from'\)/);
    assert.match(statusComponent, /page_size: params\?\.get\('page_size'\)/);
    assert.match(gradeComponent, /normalizeWritingNavigation\(params \?\? undefined\)/);
    assert.match(gradeComponent, /navigation\.source === 'queue' \? <button id="btn-save-next"/);
    assert.doesNotMatch(gradeComponent, /const withEmbed =/);
  });
});
