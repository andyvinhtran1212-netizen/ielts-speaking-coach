/**
 * mock-pacing-unknown-order.test.mjs — "—" when there is nothing to conclude.
 *
 * `worked_in_paper_order` is now null for a section with no timestamped
 * answers: comparing two empty lists is trivially equal, so the page used to
 * render "Làm theo thứ tự đề: Có" right beside its own message that no answers
 * were saved. With no observations the order is UNKNOWN, not confirmed (Codex
 * review, PR #848).
 *
 * Source-sentinel.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(
  join(__dirname, '..', 'public', 'js', 'admin-mock-pacing.js'), 'utf8');

describe('pacing — an empty timeline asserts nothing', () => {
  test('null renders as — , not as "Có"', () => {
    assert.match(JS, /d\.worked_in_paper_order == null \? '—'/);
  });

  test('a real verdict still renders Có / Không', () => {
    assert.match(JS, /d\.worked_in_paper_order \? 'Có' : 'Không'/);
  });
});

describe('pacing — a cleared field is activity, not an answer', () => {
  test('cleared saves get their own marker instead of an answer bar', () => {
    // The backend deliberately keeps timestamped clears in the timeline (they
    // move the last-touch time, close a gap and shorten the idle tail), but
    // drawing them as answer bars claimed an answer landed — contradicting both
    // the "Đã trả lời" and final-minutes KPIs.
    assert.match(JS, /var isClear = r\.is_answered === false;/);
    assert.match(JS, /\(isClear \? ' is-cleared' : ''\)/);
  });

  test('the tooltip says which one it was', () => {
    assert.match(JS, /\(isClear \? 'XOÁ ô' : 'lưu đáp án'\)/);
  });

  test('the legend only mentions clears when there are some', () => {
    assert.match(JS, /var cleared = tl\.filter\(function \(r\) \{ return r\.is_answered === false; \}\)\.length;/);
    assert.match(JS, /cleared \? '; cột <span class="mp-bar__legendclear">/);
  });

  test('the strip legend no longer claims every column is an answer', () => {
    assert.match(JS, /Mỗi cột = một lần lưu/);
    assert.doesNotMatch(JS, /Mỗi cột = một đáp án/);
  });
});
