/**
 * mock-admin-done-exam-toggle.test.mjs — a finished exam offers no "Mở kỳ".
 *
 * The server refuses reopening a `done` exam (409) and every student gate
 * rejects entry anyway. Leaving the toggle on screen meant the admin could
 * press it, be told nothing was wrong, and believe the room was open while it
 * was not (Codex review, PR #858).
 *
 * Source-sentinels on the Next owners. LEGACYJS-0075 W2 ported these from the
 * retired `admin-mock-live.js` / `admin-mock-exams.js` scripts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = (...p) => readFileSync(join(__dirname, '..', 'app', ...p), 'utf8');
const LIVE = app('(authed-admin)', '(mock-live)', 'admin', 'mock-live', 'admin-mock-live.tsx');
const LIST = app('(authed-admin)', '(mock-exams)', 'admin', 'mock-exams', 'admin-mock-exams.tsx');

describe('done exam — no reopen control', () => {
  test('the live console drops the toggle once the exam is done', () => {
    assert.match(LIVE, /!\(snapshot\.exam\.activeSection === 'done' && !snapshot\.exam\.isOpen\) \? <button[^>]*onClick=\{\(\) => void toggleOpen\(\)\}/);
    assert.match(LIVE, /Kỳ thi đã kết thúc/);
  });

  test('the exam list drops it too', () => {
    assert.match(LIST, /\{!\(active === 'done' && !exam\.isOpen\) && <button[^>]*onClick=\{\(\) => void toggleOpen\(exam\)\}/);
    assert.match(LIST, /\{active === 'done' && !exam\.isOpen && <span className="mex-ended">Kỳ thi đã kết thúc<\/span>\}/);
  });

  test('CLOSING a done exam is still offered', () => {
    // Closing is the safe direction — an exam left open by an older build must
    // stay closable. Both guards are `done && !isOpen`, not `done` alone.
    assert.doesNotMatch(LIVE, /activeSection === 'done' \? <span/);
    assert.doesNotMatch(LIST, /\{active === 'done' && <span/);
  });
});
