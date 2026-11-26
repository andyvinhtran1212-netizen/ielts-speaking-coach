/**
 * mock-pacing-unknown-order.test.mjs — "—" when there is nothing to conclude.
 *
 * `worked_in_paper_order` is now null for a section with no timestamped
 * answers: comparing two empty lists is trivially equal, so the page used to
 * render "Làm theo thứ tự đề: Có" right beside its own message that no answers
 * were saved. With no observations the order is UNKNOWN, not confirmed (Codex
 * review, PR #848).
 *
 * Model and source-sentinels on the Next pacing page. LEGACYJS-0075 W2 ported
 * these from the retired `admin-mock-pacing.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizePacing } from '../lib/admin-mock-live-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(__dirname, '..', 'app', '(authed-admin)', '(mock-live)', 'admin', 'mock-pacing',
  'admin-mock-pacing.tsx'), 'utf8');

const pacing = (order) => normalizePacing({
  sitting_id: 's', exam_id: 'e', student_name: 'An', exam_code: 'FT', status: 'released',
  caveats: { answered_at_is_last_touch: true, gap_is_time_since_previous_answer: true },
  sections: { listening: { started_at: null, ended_at: null, answered: 0, total: 40, timeline: [], worked_in_paper_order: order } },
});

describe('pacing — an empty timeline asserts nothing', () => {
  test('null stays null in the model, and renders as —, not as "Có"', () => {
    assert.equal(pacing(null).sections.listening.workedInPaperOrder, null);
    assert.equal(pacing(undefined).sections.listening.workedInPaperOrder, null);
    assert.match(PAGE, /data\.workedInPaperOrder == null \? '—'/);
  });

  test('a real verdict still renders Có / Không', () => {
    assert.equal(pacing(true).sections.listening.workedInPaperOrder, true);
    assert.equal(pacing(false).sections.listening.workedInPaperOrder, false);
    assert.match(PAGE, /data\.workedInPaperOrder \? 'Có' : 'Không'/);
  });
});

describe('pacing — a cleared field is activity, not an answer', () => {
  test('cleared saves get their own marker instead of an answer bar', () => {
    // The backend deliberately keeps timestamped clears in the timeline (they
    // move the last-touch time, close a gap and shorten the idle tail), but
    // drawing them as answer bars claimed an answer landed.
    assert.match(PAGE, /\$\{!row\.isAnswered \? 'is-cleared' : ''\}/);
  });

  test('the tooltip says which one it was', () => {
    assert.match(PAGE, /row\.isAnswered \? 'lưu đáp án' : 'xóa ô'/);
  });

  test('the legend only counts clears when there are some', () => {
    assert.match(PAGE, /const cleared = data\.timeline\.filter\(\(row\) => !row\.isAnswered\)\.length;/);
    assert.match(PAGE, /\{cleared \? ` \(\$\{cleared\} lần\)` : ''\}/);
  });

  test('the strip legend does not claim every column is an answer', () => {
    assert.match(PAGE, /Mỗi cột là một lần lưu/);
    assert.doesNotMatch(PAGE, /Mỗi cột (=|là) một đáp án/);
  });
});
