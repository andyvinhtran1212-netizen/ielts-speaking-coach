/**
 * listening-player-durability.test.mjs — the Listening runner's answer safety
 * (audit findings A1 + A4a).
 *
 * Source-sentinel: the player is a module driving a live DOM, and the branches
 * that matter here only fire on a failed request or an interrupted attempt.
 * These pin the SHAPE of the fixes so a refactor cannot restore the old
 * behaviour, which was silent in every direction.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'public', 'js', 'listening-test-player.js'), 'utf8');
const HOOK = readFileSync(join(__dirname, '..', 'public', 'js', 'mock-exam-hook.js'), 'utf8');
const HTML = readFileSync(join(__dirname, '..', 'public', 'pages', 'listening-test.html'), 'utf8');

describe('A1 — an interrupted Listening attempt can be resumed', () => {
  test('pre-start asks the server for an open attempt', () => {
    assert.match(JS, /function detectResumable/);
    assert.match(JS, /\/attempts\/in-progress/);
  });

  test('resume reuses the attempt instead of minting a new one', () => {
    const body = JS.slice(JS.indexOf('async function resumeAttempt'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.match(fn, /STATE\.attemptId = att\.attempt_id/);
    // the destructive path is POST /attempts — it must not appear here
    assert.doesNotMatch(fn, /api\.post\(\s*`?\/api\/listening\/tests\/\$\{/);
  });

  test('recovered answers are painted back onto the paper', () => {
    assert.match(JS, /function restoreAnswersIntoPaper/);
    assert.match(JS, /restoreAnswersIntoPaper\(\)/);
  });

  test('the mock embed auto-click prefers resume over start', () => {
    // This auto-click is WHY a refresh used to be destructive.
    assert.match(HOOK, /getElementById\('ft-resume-btn'\)/);
    assert.match(HOOK, /resume && resume\.offsetParent !== null/);
  });

  test('audio rejoins the shared class clock, not the student start click', () => {
    assert.match(JS, /function seekAudioToRoom/);
    assert.match(HOOK, /function sectionElapsedSeconds/);
    // self-timed retake has no shared anchor — must not guess an offset
    assert.match(HOOK, /=== 'retake'\) return null/);
  });

  test('resume UI states how much work is being recovered', () => {
    assert.match(HTML, /id="ft-resume-btn"/);
    assert.match(HTML, /id="ft-resume-note"/);
    assert.match(JS, /câu đã lưu/);
  });
});

describe('A4a — autosave no longer drops answers silently', () => {
  test('an in-flight collision RE-QUEUES instead of discarding the new value', () => {
    // The old bug: `if (STATE.inflight.has(qNum)) return;` threw the newer text
    // away with nothing scheduled to send it.
    assert.match(JS, /if \(STATE\.inflight\.has\(qNum\)\) \{\s*\n\s*scheduleAutoSave\(qNum, value\);/);
  });

  test('errors are retried, not swallowed', () => {
    assert.match(JS, /SAVE_RETRY_DELAYS\s*=\s*\[/);
    assert.match(JS, /function isRetriableSaveError/);
    // The old catch body did nothing at all. Assert on the CODE rather than on
    // the absence of the old comment — the header still quotes that comment to
    // explain what was wrong, and a prose match would flag its own changelog.
    const fn = JS.slice(JS.indexOf('async function saveAnswer'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /catch \(e\) \{[\s\S]*?setSaveState\(qNum/);
  });

  test('only retriable errors are retried — a 4xx fails fast', () => {
    assert.match(JS, /return Number\(status\) >= 500/);
  });

  test('a generation counter stops an older save clearing a newer failure', () => {
    assert.match(JS, /STATE\.saveGen/);
    assert.match(JS, /gen !== STATE\.saveGen\.get\(qNum\)\) return/);
  });

  test('a fresh edit cancels the pending retry chain', () => {
    assert.match(JS, /saveRetryTimers\.has\(qNum\)[\s\S]{0,140}clearTimeout/);
  });

  test('debounce is tightened to Reading parity', () => {
    assert.match(JS, /SAVE_DEBOUNCE_MS\s*=\s*500/);
    assert.doesNotMatch(JS, /}, 2000\);/);
  });

  test('unsaved answers are visible, with retrying vs given-up distinguished', () => {
    assert.match(JS, /'retrying'/);
    assert.match(JS, /'failed'/);
    assert.match(HTML, /id="ft-unsaved-note"/);
    assert.match(HTML, /\.progress-square\.is-unsaved/);
    assert.match(HTML, /\.progress-square\.is-save-failed/);
  });

  test('re-rendering the tracker does not wipe the unsaved cue', () => {
    // renderProgressTracker rebuilds every square via innerHTML; without this
    // the page would silently claim the answers are safe.
    assert.match(JS, /STATE\.unsaved\.forEach\(\(state, qNum\) => setSaveState\(qNum, state\)\)/);
  });

  test('coming back online retries the given-up saves', () => {
    assert.match(JS, /addEventListener\('online', retryFailedSaves\)/);
  });

  test('the pre-start rules no longer promise the old 2s save', () => {
    assert.doesNotMatch(HTML, /lưu tự động sau mỗi 2 giây/);
  });
});
