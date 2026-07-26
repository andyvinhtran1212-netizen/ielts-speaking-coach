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

describe('A2 round 3 — the local copy carries a sync verdict, not a clock', () => {
  test('every local write records whether the server confirmed it', () => {
    assert.match(JS, /function saveLocalDraft\(task, text, synced\)/);
    assert.match(JS, /synced: !!synced/);
    // the keystroke path writes UNSYNCED (2-arg call)
    assert.match(JS, /saveLocalDraft\(t, ta\.value\);/);
  });

  test('a confirmed save marks the local copy synced', () => {
    assert.match(JS, /markLocalSynced\(body\.task1_text, body\.task2_text\)/);
  });

  test('an unsynced local record wins outright — no timestamp comparison', () => {
    // Client edit time vs server receipt time are different clocks measuring
    // different moments, so an edit that BEAT a request looked older than it.
    assert.match(JS, /if \(local\.synced === false\) \{ _localDraftWon\[task\] = true; return local\.text; \}/);
  });

  test('a deliberately cleared draft is restored, not resurrected from the server', () => {
    // `if (!local || !local.text) return serverText` discarded the deletion.
    assert.match(JS, /if \(!local\) return serverText;/);
    const i = JS.indexOf('if (local.synced === false)');
    const j = JS.indexOf('if (!local.text) return serverText;');
    assert.ok(i > 0 && j > i, 'the unsynced branch is reached before the empty-text bail-out');
  });

  test('records predating the flag fall back to the timestamp comparison', () => {
    assert.match(JS, /if \(typeof d\.synced !== 'boolean'\) d\.synced = null;/);
  });
});

describe('A2 round 3 — pagehide always issues a keepalive request', () => {
  test('a normal save on the wire does not suppress the keepalive re-send', () => {
    // Returning _wInFlight here meant the lifecycle flush issued NO keepalive
    // replacement, and the navigation could kill the non-keepalive request.
    assert.match(JS, /if \(_wSaving && !keepalive\) return _wInFlight \|\| Promise\.resolve\(\);/);
  });

  test('only the newest request clears the in-flight tracking', () => {
    assert.match(JS, /var gen = \+\+_wGen;/);
    assert.match(JS, /if \(gen === _wGen\) \{ _wSaving = false; _wInFlight = null; _wAbort = null; \}/);
  });
});

describe('A2 round 4 — a superseded save is cancelled, not raced', () => {
  test('the request on the wire is abortable', () => {
    // The endpoint is last-writer-wins. A keepalive replacement issued from
    // pagehide while a normal save is pending must CANCEL the earlier request:
    // otherwise the older body can commit last and a force-collection grades
    // stale text.
    assert.match(JS, /var _wAbort = null;/);
    assert.match(JS, /if \(_wAbort\) \{ try \{ _wAbort\.abort\(\); \} catch \(e\) \{\} _wAbort = null; \}/);
    assert.match(JS, /signal: ctrl \? ctrl\.signal : undefined,/);
  });

  test('a deliberately cancelled save is not reported as a failure', () => {
    assert.match(JS, /if \(e && \(e\.name === 'AbortError' \|\| e\.code === 20\)\) return;/);
  });

  test('the abort handle is cleared with the rest of the in-flight state', () => {
    assert.match(JS, /_wSaving = false; _wInFlight = null; _wAbort = null;/);
  });
});
