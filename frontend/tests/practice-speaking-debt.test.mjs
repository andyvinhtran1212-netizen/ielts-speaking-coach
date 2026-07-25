/**
 * practice-speaking-debt.test.mjs — the Speaking-report debt retry (A5).
 *
 * From the Codex review on PR #847. practice.js is loaded with `defer` while
 * initSupabase() runs in a LATER inline script, so anything at IIFE top level
 * executes before authentication exists. A retry fired there carries no Bearer
 * token: it 401s, api.js redirects to login and resolves null, and the success
 * handler then clears the stored debt — so the student is bounced to login AND
 * loses the only record that the report is still owed.
 *
 * Source-sentinel: the ordering is a load-time property of two files.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(__dirname, '..', 'public', 'js', 'practice.js'), 'utf8');
const HTML = readFileSync(join(__dirname, '..', 'public', 'pages', 'practice.html'), 'utf8');

describe('A5 — the debt retry must wait for authentication', () => {
  test('practice.js is deferred and initSupabase runs separately', () => {
    // The premise. If this stops being true the ordering hazard changes.
    assert.match(HTML, /src="\.\.\/js\/practice\.js"\s+defer/);
    assert.match(HTML, /initSupabase\(/);
  });

  test('the retry is NOT called at IIFE top level', () => {
    // A bare `_retryOwedSpeakingReport();` at column 2 is the top-level call.
    assert.doesNotMatch(JS, /\n {2}_retryOwedSpeakingReport\(\);/);
  });

  test('it runs inside init(), after the session check', () => {
    const init = JS.slice(JS.indexOf('async function init()'));
    const body = init.slice(0, init.indexOf('\n  }\n'));
    const sessionAt = body.indexOf('sb.auth.getSession()');
    const retryAt = body.indexOf('_retryOwedSpeakingReport()');
    assert.ok(sessionAt !== -1, 'session check not found in init()');
    assert.ok(retryAt !== -1, 'retry not called from init()');
    assert.ok(retryAt > sessionAt, 'retry must come AFTER the session check');
  });
});

describe('A5 — an unauthenticated attempt must not look like success', () => {
  test('401 keeps the debt instead of discarding it', () => {
    assert.match(JS, /if \(st === 401\) throw err;/);
  });

  test('a null resolution (redirected request) is treated as failure', () => {
    // api.js resolves null after redirecting a 401; clearing the debt there
    // would throw away the only retry record.
    assert.match(JS, /r === null \|\| r === undefined\) throw new Error\('unauthenticated'\)/);
  });

  test('genuinely terminal statuses still clear the debt', () => {
    // 403/404/409 repeat identically — keeping the debt would retry forever.
    assert.match(JS, /st === 403 \|\| st === 409 \|\| st === 404.*_clearSpeakingDebt/s);
  });
});
