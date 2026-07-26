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
 * Source-sentinels.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(
  join(__dirname, '..', 'public', 'js', 'admin-mock-exams.js'), 'utf8');

describe('retake assign — only skills this exam can serve', () => {
  test('the admin page derives servable skills from the exam row', () => {
    assert.match(JS, /function servableSkills\(ex\)/);
    assert.match(JS, /if \(ex\.listening_test_id\) out\.push\('listening'\)/);
    assert.match(JS, /if \(ex\.reading_test_id\) out\.push\('reading'\)/);
  });

  test('Writing is always servable — a missing prompt is not a missing paper', () => {
    // Same rule as _configured_sections() in mock_exam_service.py: the Writing
    // panel is native textareas and the runner renders "(Không có đề Task N)".
    // Gating Writing on a prompt would break the ordinary retake, which is
    // mostly Writing.
    const fn = JS.slice(JS.indexOf('function servableSkills(ex)'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    assert.match(body, /out\.push\('writing'\)/);
    assert.doesNotMatch(body, /writing_task1_prompt_id/);
  });

  test('an unservable skill is rendered disabled AND unchecked', () => {
    // Unchecked matters as much as disabled: a checked-but-disabled box still
    // reads as "this student is getting Listening".
    const at = JS.slice(JS.indexOf("RETAKE_SKILLS.map(function (sk) {\n              //"));
    const cell = at.slice(0, at.indexOf('}).join(\'\')'));
    assert.match(cell, /var ok = can\.indexOf\(sk\.key\) !== -1;/);
    assert.match(cell, /ok && flagged\.indexOf\(sk\.key\) !== -1 \? ' checked' : ''/);
    assert.match(cell, /ok \? '' : ' disabled/);
  });

  test('the modal says which skills the exam cannot serve, before any click', () => {
    assert.match(JS, /Đề này chưa có nội dung cho/);
    assert.match(JS, /var missing = RETAKE_SKILLS\.filter\(/);
  });

  test('the roster is built against the TARGET exam, not the source', () => {
    // loadRetestStudents renders the skill cells, so it needs the exam being
    // assigned TO — passing only the source id is what let the mismatch exist.
    assert.match(JS, /function loadRetestStudents\(sourceId, targetEx\)/);
    assert.match(JS, /var can = servableSkills\(targetEx \|\| \{\}\);/);
    assert.match(JS, /loadRetestStudents\(el\('a-source'\)\.value, ex\)/);
  });
});

describe('retake assign — aiming at the right class', () => {
  test('the source-exam picker names the cohort that sat it', () => {
    // A retake targets the students of ONE previous exam; the class name is how
    // the admin confirms the target group before the roster loads.
    assert.match(JS, /_cohortName\[e\.cohort_id\]/);
    assert.match(JS, /' · lớp ' \+ cls/);
  });

  test('the cohort map is filled from the picker load, not refetched', () => {
    assert.match(JS, /_cohortName = \{\};/);
    assert.match(JS, /_cohortName\[c\.id\] = c\.name \|\| c\.id;/);
  });
});
