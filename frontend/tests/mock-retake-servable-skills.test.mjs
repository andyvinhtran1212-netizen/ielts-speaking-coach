/**
 * mock-retake-servable-skills.test.mjs — a retake skill you can be assigned is
 * a skill you can actually OPEN.
 *
 * The per-student skills come off the SOURCE exam's retest flags, but they are
 * sat on the TARGET exam, and nothing tied the two together. Ticking Listening
 * for a retake exam with no listening test produced a "Bắt đầu Listening"
 * button that stamped the student's per-section clock and then loaded an iframe
 * with `id=undefined` — the time drained against a blank panel and the reaper
 * collected the empty paper.
 *
 * The backend now refuses such an assign outright (UnservableSkillError); these
 * pin the admin-side half, whose job is to make it visible BEFORE the button is
 * pressed rather than as a rejected request.
 *
 * Model and source-sentinels on the Next retake dialog. LEGACYJS-0075 W2 ported
 * these from the retired `admin-mock-exams.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeRetestCandidates, retakeServableSkills } from '../lib/admin-mock-exams-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIALOG = readFileSync(join(__dirname, '..', 'app', '(authed-admin)', '(mock-exams)', 'admin', 'mock-exams',
  'retake-assignment-dialog.tsx'), 'utf8');

describe('retake assign — only skills this exam can serve', () => {
  test('servable skills come from the exam row', () => {
    assert.deepEqual(retakeServableSkills({ listeningTestId: 'l', readingTestId: 'r' }), ['listening', 'reading', 'writing']);
    assert.deepEqual(retakeServableSkills({ readingTestId: 'r' }), ['reading', 'writing']);
  });

  test('Writing is always servable — a missing prompt is not a missing paper', () => {
    // Same rule as _configured_sections() in mock_exam_service.py: the Writing
    // panel is native textareas and the runner renders "(Không có đề Task N)".
    assert.deepEqual(retakeServableSkills({}), ['writing']);
    assert.deepEqual(retakeServableSkills(null), ['writing']);
  });

  test('an unservable skill is rendered disabled AND unchecked', () => {
    // Unchecked matters as much as disabled: a checked-but-disabled box still
    // reads as "this student is getting Listening".
    assert.match(DIALOG, /disabled=\{!servable\.includes\(skill\.id\)\}/);
    assert.deepEqual(
      mergeRetestCandidates([{ userId: 'u1', studentName: 'An', skills: ['listening', 'writing'] }], ['reading', 'writing']),
      [{ userId: 'u1', studentName: 'An', skills: ['writing'] }],
    );
    assert.match(DIALOG, /skills\.filter\(\(skill\) => servable\.includes\(skill\)\)/);
  });

  test('the dialog says which skills the exam can serve, before any click', () => {
    assert.match(DIALOG, /Kỹ năng phục vụ được: \{servable\.join\(', '\)\}\. Kỹ năng thiếu đề bị khóa trước khi gửi\./);
  });

  test('the roster is built against the TARGET exam, not the source', () => {
    // `exam` is the exam being assigned TO; the source only feeds candidates.
    assert.match(DIALOG, /const servable = useMemo\(\(\) => retakeServableSkills\(exam\), \[exam\]\);/);
    assert.match(DIALOG, /mergeRetestCandidates\(rows as Candidate\[\], servable\)/);
  });
});

describe('retake assign — aiming at the right class', () => {
  test('the source-exam picker names the cohort that sat it', () => {
    assert.match(DIALOG, /row\.cohortId \? ` · \$\{cohortNames\.get\(row\.cohortId\) \|\| row\.cohortId\}` : ''/);
  });

  test('the cohort names come from the cohorts already loaded, not refetched', () => {
    assert.match(DIALOG, /const cohortNames = useMemo\(\(\) => new Map\(cohorts\.map\(\(row\) => \[row\.id, row\.name \|\| row\.id\]\)\), \[cohorts\]\);/);
  });
});
