// W-09: a tip tagged task_type 'both' ("Cả hai") must appear under the Task 1
// AND the Task 2 filter chips on /writing/dashboard?tab=tips.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writingTipMatchesFilters } from '../lib/writing-tip-filter.mjs';
import { selectWritingTips } from '../lib/writing-result-model.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TIPS = [
  { id: 't1', task_type: 'task_1', content_type: 'tip' },
  { id: 't2', task_type: 'task_2', content_type: 'outline' },
  { id: 'b1', task_type: 'both', content_type: 'tip' },
  { id: 'b2', task_type: 'both', content_type: 'knowledge' },
  { id: 'legacy', task_type: 'task_2' }, // no content_type → treated as 'tip'
];
const ids = (task, type) => TIPS.filter((t) => writingTipMatchesFilters(t, task, type)).map((t) => t.id);

describe('writingTipMatchesFilters — task axis', () => {
  test('Tất cả shows every tip', () => {
    assert.deepEqual(ids('all', 'all'), ['t1', 't2', 'b1', 'b2', 'legacy']);
  });
  test('Task 1 shows task_1 + both, never task_2', () => {
    assert.deepEqual(ids('task_1', 'all'), ['t1', 'b1', 'b2']);
  });
  test('Task 2 shows task_2 + both, never task_1', () => {
    assert.deepEqual(ids('task_2', 'all'), ['t2', 'b1', 'b2', 'legacy']);
  });
  test('Cả hai still shows only both-tagged tips', () => {
    assert.deepEqual(ids('both', 'all'), ['b1', 'b2']);
  });
});

describe('writingTipMatchesFilters — content-type axis (AND with task)', () => {
  test('both-tagged tip under Task 1 still respects the type chip', () => {
    assert.deepEqual(ids('task_1', 'knowledge'), ['b2']);
    assert.deepEqual(ids('task_2', 'tip'), ['b1', 'legacy']);
    assert.deepEqual(ids('task_2', 'outline'), ['t2']);
  });
  test('missing content_type counts as tip', () => {
    assert.equal(writingTipMatchesFilters({ task_type: 'task_2' }, 'all', 'tip'), true);
    assert.equal(writingTipMatchesFilters({ task_type: 'task_2' }, 'all', 'sample'), false);
  });
  test('an unknown task tag is not widened by the both rule', () => {
    assert.equal(writingTipMatchesFilters({ task_type: 'task_3', content_type: 'tip' }, 'task_1', 'all'), false);
    assert.equal(writingTipMatchesFilters(null, 'all', 'all'), false);
  });
});

test('dashboard filter agrees with the result-page tip recommendations for both-tagged tips', () => {
  for (const [essayTask, chip] of [['task1_academic', 'task_1'], ['task1_general', 'task_1'], ['task2', 'task_2']]) {
    const reco = selectWritingTips(TIPS, essayTask, 99).map((t) => t.id);
    assert.deepEqual(reco, ids(chip, 'all'), `${essayTask} ↔ ${chip}`);
  }
});

test('renderTips filters through writingTipMatchesFilters (no exact task_type match left)', () => {
  const behavior = readFileSync(path.join(__dirname, '..', 'app', '(authed-writing)', 'writing', 'dashboard', 'writing-behavior.tsx'), 'utf8');
  const render = behavior.match(/function renderTips\(ps: PageState\) \{([\s\S]*?)\n\}/);
  assert.ok(render, 'renderTips must exist');
  assert.match(render[1], /ps\.allTips\.filter\(\(t: any\) => writingTipMatchesFilters\(t, ps\.tipFilter, ps\.tipTypeFilter\)\)/);
  assert.doesNotMatch(behavior, /t\.task_type === ps\.tipFilter/);
});
