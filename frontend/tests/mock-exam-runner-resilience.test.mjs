/**
 * mock-exam-runner-resilience.test.mjs — the student mock runner's survival
 * behaviour during an exam (audit findings A2 + A3).
 *
 * Source-sentinel (the runner is an IIFE driving a live DOM, and the branches
 * that matter here only fire on a network failure mid-exam — the thing a unit
 * harness cannot honestly reproduce). These pin the SHAPE of the fixes so a
 * later refactor cannot quietly restore the old behaviour:
 *
 *   A2 — the essay reaches the server while the student writes, not only at
 *        submit, and localStorage stays as the offline tier
 *   A3 — a failed call retries instead of killing the exam, and the student is
 *        told the connection is gone instead of watching a stale countdown
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'public', 'js', 'mock-exam-runner.js'), 'utf8');
const HTML = readFileSync(join(__dirname, '..', 'public', 'pages', 'mock-exam.html'), 'utf8');

describe('A2 — Writing autosaves to the server', () => {
  test('posts the draft to the sitting writing endpoint', () => {
    assert.match(JS, /\/sections\/writing\/submit/);          // the final submit
    assert.match(JS, /sittings\/'\s*\+\s*encodeURIComponent\(S\.sittingId\)\s*\+\s*'\/writing'/);
  });

  test('debounced by BOTH idle time and volume of new text', () => {
    assert.match(JS, /WRITE_SAVE_MS\s*=\s*\d+/);
    assert.match(JS, /WRITE_SAVE_CHARS\s*=\s*\d+/);
    // a burst must not wait out the whole idle window
    assert.match(JS, /delta\s*>=\s*WRITE_SAVE_CHARS/);
  });

  test('flushes when the page goes away, with keepalive', () => {
    assert.match(JS, /addEventListener\('pagehide'/);
    assert.match(JS, /visibilityState === 'hidden'/);
    assert.match(JS, /keepalive:/);
  });

  test('localStorage is kept as the offline tier, not replaced', () => {
    assert.match(JS, /localStorage\.setItem\(lsKey\(/);
    assert.match(JS, /function restoreDraft/);
  });

  test('a pre-JSON draft (bare string) is still readable', () => {
    // Students mid-exam when this ships have the old format in storage;
    // dropping it would lose the very text this feature exists to protect.
    assert.match(JS, /return \{ text: String\(raw\), ts: 0, synced: null \}/);
  });

  test('autosave never fires outside the open Writing section', () => {
    assert.match(JS, /S\.renderedSection !== 'writing'/);
    assert.match(JS, /_submitting/);
  });

  test('a failed save stays dirty so the next tick retries', () => {
    assert.match(JS, /catch\(function \(e\) \{[\s\S]*?setSaveCue\('failed'\)/);
    // _wDirty is only cleared on success (the confirmed text is also stamped
    // synced in localStorage on the way past — see mock-writing-autosave)
    assert.match(JS, /_wDirty = false;[\s\S]{0,320}?setSaveCue\('saved'\)/);
  });

  test('save cue element exists and is announced', () => {
    assert.match(HTML, /id="mw-savecue"/);
    assert.match(HTML, /aria-live="polite"/);
  });
});

describe('A3 — a network failure no longer ends the exam', () => {
  test('submit retries on a backoff ladder', () => {
    assert.match(JS, /SUBMIT_RETRY_DELAYS\s*=\s*\[/);
    assert.match(JS, /submitSection\(section, auto, attempt \+ 1\)/);
  });

  test('only 403/404 are terminal — a retry cannot fix those', () => {
    assert.match(JS, /st === 403 \|\| st === 404/);
  });

  test('409 is VERIFIED before being accepted', () => {
    // The backend maps every SittingConflictError to 409 — "already collected"
    // but also "clock hasn't run out" and "prior section not submitted".
    // Accepting all of them stopped the timer and parked the student at 00:00
    // with no further attempt and no warning.
    assert.match(JS, /st === 409/);
    assert.match(JS, /st === 409[\s\S]{0,400}await loadState\(\)/);
    assert.match(JS, /sit\[section \+ '_submitted_at'\] \|\| S\.activeSection !== section/);
  });

  test('a spent retry budget is remembered and finished on reconnect', () => {
    // Polling alone never retried: a successful poll for the same active
    // section only resynced the clock while timerIv stayed null, so the student
    // sat at 00:00 forever and the submit endpoint never ran.
    assert.match(JS, /_owedSubmit = section/);
    assert.match(JS, /function retryOwedSubmit/);
    assert.match(JS, /retryOwedSubmit\(\);/);
    // and it must not fire for a section that is already done
    assert.match(JS, /sit\[section \+ '_submitted_at'\] \|\| S\.activeSection !== section\)[\s\S]{0,80}_owedSubmit = null/);
  });

  test('exhausting the retry budget does NOT call fail()', () => {
    // Answers are already persisted server-side and the admin sweep collects
    // them, so killing the page would strand a student whose work is safe.
    const tail = JS.slice(JS.indexOf('async function submitSection'));
    const body = tail.slice(0, tail.indexOf('\n  }\n'));
    assert.match(body, /setConn\('submit_failed'\)/);
    assert.match(body, /startPolling\(\)/);
  });

  test('poll failures raise a banner instead of being swallowed', () => {
    assert.match(JS, /_pollFails\+\+/);
    assert.match(JS, /_pollFails >= 2[\s\S]{0,80}setConn\('offline'\)/);
    // and polling keeps running — no clearInterval in the failure path
    assert.doesNotMatch(JS, /catch\(function \(\) \{\s*stopPolling\(\)/);
  });

  test('recovery clears the banner', () => {
    assert.match(JS, /if \(_pollFails\) \{ _pollFails = 0; setConn\(null\); \}/);
  });

  test('browser connectivity events drive the banner too', () => {
    assert.match(JS, /addEventListener\('offline'/);
    assert.match(JS, /addEventListener\('online'/);
  });

  test('connection banner is distinct from the time warning', () => {
    assert.match(HTML, /id="conn-banner"/);
    assert.match(HTML, /id="warn-banner"/);
    // amber not red: the exam is still running and the work is still safe
    assert.match(HTML, /\.me-conn-banner \{[^}]*var\(--av-warning\)/);
  });
});

describe('A3 round 3 — a terminal poll response is terminal', () => {
  test('403/404 from the poll fails the page instead of polling forever', () => {
    // Discarding the status classified "sitting deleted / not yours" as an
    // outage: the page polled forever behind a banner promising the work was
    // safe and would reconnect.
    assert.match(JS, /\}\)\.catch\(function \(e\) \{/);
    assert.match(JS, /if \(st === 403 \|\| st === 404\) \{\s*\n\s*return fail\(/);
  });

  test('network / 5xx failures keep the retry banner', () => {
    assert.match(JS, /_pollFails\+\+;\s*\n\s*if \(_pollFails >= 2 && !_submitting\) setConn\('offline'\);/);
  });
});

describe('A3 round 4 — a stale retry must not stop the next section', () => {
  test('a retry for a section the class has left returns immediately', () => {
    // The retry is a delayed timer: the admin can force-collect and a poll can
    // render the NEXT section before it fires. It then cleared the global
    // timerIv, and its own 409 handler — correctly seeing the exam had moved on
    // — returned without restarting it, so the new countdown froze and never
    // auto-submitted.
    assert.match(JS, /if \(attempt > 0 && S\.renderedSection && S\.renderedSection !== section\) \{\s*\n\s*_submitting = false;\s*\n\s*return;\s*\n\s*\}/);
  });

  test('the guard sits BEFORE the timer is cleared', () => {
    const fn = JS.slice(JS.indexOf('async function submitSection(section, auto, attempt)'));
    const guard = fn.indexOf('S.renderedSection !== section');
    const clear = fn.indexOf('if (timerIv) { clearInterval(timerIv); timerIv = null; }');
    assert.ok(guard > 0 && clear > guard, 'bail out before touching the shared timer');
  });

  test('the owed-submit path keeps its own moved-on check', () => {
    assert.match(JS, /if \(sit\[section \+ '_submitted_at'\] \|\| S\.activeSection !== section\) \{/);
  });
});
