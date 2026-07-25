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
