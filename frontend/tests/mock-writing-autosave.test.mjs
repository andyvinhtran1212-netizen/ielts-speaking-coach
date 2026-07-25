/**
 * mock-writing-autosave.test.mjs — the Writing draft's three race fixes (A2).
 *
 * All three came out of the Codex review on PR #835, and all three are the same
 * shape of bug: the autosave and the final submit are two writers to one row,
 * and `submit_writing` updates unconditionally. Source-sentinel, because these
 * branches only fire on request timing a unit harness cannot honestly stage.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'public', 'js', 'mock-exam-runner.js'), 'utf8');

describe('A2 — autosave must not race the final submit', () => {
  test('the in-flight save is tracked, not fire-and-forget', () => {
    assert.match(JS, /_wInFlight\s*=\s*window\.api\.postWith/);
    assert.match(JS, /_wInFlight = null/);
  });

  test('submitting Writing AWAITS the draft already on the wire', () => {
    // Without this, a draft POST can land AFTER the final submit and overwrite
    // the submitted essay, or be the copy promoted for grading.
    assert.match(JS, /if \(_wInFlight\) \{ try \{ await _wInFlight; \}/);
  });

  test('the wait cannot itself block submission', () => {
    // A failed draft must not stop the student submitting.
    assert.match(JS, /await _wInFlight; \} catch \(e\) \{[^}]*\}/);
  });
});

describe('A2 — edits during an in-flight save are not lost', () => {
  test('the draft is only marked clean if the textareas still match what was sent', () => {
    // Clearing _wDirty unconditionally lost every keystroke typed while the
    // request was in flight: the follow-up saw a clean draft and exited, so a
    // later crash persisted the OLDER essay while the cue said "Đã lưu".
    assert.match(JS, /el\('essay-task1'\)\.value === body\.task1_text/);
    assert.match(JS, /el\('essay-task2'\)\.value === body\.task2_text/);
  });

  test('a mismatch reschedules instead of dropping the newer text', () => {
    assert.match(JS, /\} else \{\s*\n\s*scheduleWritingSave\(\);/);
  });
});

describe('A2 — a failed save actually retries', () => {
  test('failure schedules a real timer, not just a dirty flag', () => {
    // The cue promises an automatic retry; before this, nothing retried until
    // the student typed again, went offline→online, or left the page.
    assert.match(JS, /WRITE_RETRY_MS/);
    assert.match(JS, /_wRetries < WRITE_MAX_RETRIES/);
    assert.match(JS, /setTimeout\(function \(\) \{[\s\S]{0,120}flushWritingSave\(\);/);
  });

  test('the retry budget is bounded and refreshed by a new edit', () => {
    assert.match(JS, /WRITE_MAX_RETRIES\s*=\s*\d+/);
    assert.match(JS, /_wRetries = 0;\s*\/\/ a fresh edit earns a fresh retry budget/);
  });
});
