/**
 * mock-admin-done-exam-toggle.test.mjs — a finished exam offers no "Mở kỳ".
 *
 * The server refuses reopening a `done` exam (409) and every student gate
 * rejects entry anyway. Leaving the toggle on screen meant the admin could
 * press it, be told nothing was wrong, and believe the room was open while it
 * was not (Codex review, PR #858).
 *
 * Source-sentinels.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIVE = readFileSync(
  join(__dirname, '..', 'public', 'js', 'admin-mock-live.js'), 'utf8');
const LIST = readFileSync(
  join(__dirname, '..', 'public', 'js', 'admin-mock-exams.js'), 'utf8');

describe('done exam — no reopen control', () => {
  test('the live console drops the toggle once the exam is done', () => {
    const fn = LIVE.slice(LIVE.indexOf('function sequentialActions(ex)'));
    const body = fn.slice(0, fn.indexOf("if (done) return openBtn;"));
    assert.match(body, /var done = ex\.active_section === 'done';/);
    assert.match(body, /done && !ex\.is_open/);
    assert.match(body, /Kỳ thi đã kết thúc/);
  });

  test('the exam list drops it too', () => {
    assert.match(LIST, /ex\.active_section === 'done' && !ex\.is_open/);
    assert.match(LIST, /Đã kết thúc/);
  });

  test('CLOSING a done exam is still offered', () => {
    // Closing is the safe direction — an exam left open by an older build must
    // stay closable. Both guards are `done && !is_open`, not `done` alone.
    assert.doesNotMatch(LIVE, /ex\.active_section === 'done'\s*\?\s*'<span/);
    assert.doesNotMatch(LIST, /ex\.active_section === 'done'\)\s*\n?\s*\?\s*'<span/);
  });
});
