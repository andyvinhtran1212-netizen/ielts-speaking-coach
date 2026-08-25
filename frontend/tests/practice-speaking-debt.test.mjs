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
const DEBT = readFileSync(join(__dirname, '..', 'public', 'js', 'speaking-debt.js'), 'utf8');
const HOME_JS = readFileSync(join(__dirname, '..', 'public', 'js', 'home.js'), 'utf8');
const RUNNER = readFileSync(join(__dirname, '..', 'public', 'js', 'mock-exam-runner.js'), 'utf8');
const HOME = readFileSync(join(__dirname, '..', 'public', 'pages', 'home.html'), 'utf8');
const MOCK = readFileSync(join(__dirname, '..', 'public', 'pages', 'mock-exam.html'), 'utf8');
const HTML = readFileSync(join(__dirname, '..', 'public', 'pages', 'practice.html'), 'utf8');
const NEXT_BOOT = readFileSync(
  join(__dirname, '..', 'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx'),
  'utf8',
);

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

  test('it runs after authentication on both legacy and Next bootstrap paths', () => {
    const initStart = JS.indexOf('async function init(bootstrap)');
    const initEnd = JS.indexOf('// ── PDF Export', initStart);
    const body = JS.slice(initStart, initEnd);
    const sessionAt = body.indexOf('sb.auth.getSession()');
    const handoffAt = body.indexOf('if (hasNextBootstrap)');
    const retryAt = body.indexOf('_retryOwedSpeakingReport()');
    assert.ok(sessionAt !== -1, 'session check not found in init()');
    assert.ok(handoffAt !== -1, 'Next bootstrap branch not found in init()');
    assert.ok(retryAt !== -1, 'retry not called from init()');
    assert.ok(retryAt > sessionAt, 'retry must come AFTER the session check');
    assert.ok(retryAt > handoffAt, 'retry must come AFTER the checked Next handoff');

    const signedInAt = NEXT_BOOT.indexOf("status === 'signed-out'");
    const loadAt = NEXT_BOOT.indexOf('loadPracticeBootstrap({');
    const initAt = NEXT_BOOT.indexOf('PracticeApp.init(bootstrap)');
    assert.ok(signedInAt !== -1 && signedInAt < loadAt && loadAt < initAt,
      'Next must prove auth before loading and handing off the session');
  });
});

describe('A5 — an unauthenticated attempt must not look like success', () => {
  test('401 keeps the debt instead of discarding it', () => {
    assert.match(DEBT, /if \(st === 401\) throw err;/);
  });

  test('a null resolution (redirected request) is treated as failure', () => {
    // api.js resolves null after redirecting a 401; clearing the debt there
    // would throw away the only retry record.
    assert.match(DEBT, /r === null \|\| r === undefined\) throw new Error\('unauthenticated'\)/);
  });

  test('genuinely terminal statuses still clear the debt', () => {
    // 403/404/409 repeat identically — keeping the debt would retry forever.
    assert.match(DEBT, /st === 403 \|\| st === 409 \|\| st === 404.*clear\(sittingId\)/s);
  });
});

describe('A5 round 3 — the debt is a per-sitting queue, not one slot', () => {
  test('a new debt is appended, never overwriting another sitting', () => {
    // speaking_pending deliberately does NOT block the student starting another
    // exam, so two debts can genuinely be outstanding at once. One slot meant
    // the second mock erased the first, which could then sit unreleased
    // forever.
    assert.match(DEBT, /function read\(\)/);
    assert.match(DEBT, /function write\(list\)/);
    assert.match(DEBT, /list\.push\(\{ sitting_id: sittingId, session_ids: ids, user_id: userId \|\| null \}\)/);
  });

  test('only the settled sitting is removed', () => {
    assert.match(DEBT, /function clear\(sittingId\)/);
    assert.match(DEBT, /clear\(sittingId\);/);
    assert.doesNotMatch(DEBT, /clear\(\);/);
  });

  test('the single-object shape written before this change still loads', () => {
    assert.match(DEBT, /if \(!Array\.isArray\(raw\)\) return raw\.sitting_id \? \[raw\] : \[\];/);
  });

  test('every outstanding debt is retried on load, independently', () => {
    assert.match(DEBT, /debts\.forEach\(function \(owed\) \{/);
  });
});

describe('A5 round 4 — the debt is settled from pages students revisit', () => {
  test('the queue lives in a shared module, not inside practice.js', () => {
    // practice.js is loaded ONLY by the practice pages: a student who closed
    // the completion tab and came back through Home or the mock-exam page
    // never processed the debt, so the sitting stayed speaking_pending.
    assert.match(JS, /if \(window\.SpeakingDebt\) window\.SpeakingDebt\.retryAll\(\);/);
    assert.match(DEBT, /window\.SpeakingDebt = \(function \(\)/);
  });

  test('home and the mock runner load it and call it after authenticating', () => {
    assert.match(HOME, /speaking-debt\.js/);
    assert.match(MOCK, /speaking-debt\.js/);
    assert.match(HOME_JS, /if \(window\.SpeakingDebt\) window\.SpeakingDebt\.retryAll\(\);/);
    assert.match(RUNNER, /if \(window\.SpeakingDebt\) window\.SpeakingDebt\.retryAll\(\);/);
    // the runner's call must sit AFTER its session check
    const boot = RUNNER.slice(RUNNER.indexOf('async function boot()'));
    assert.ok(boot.indexOf('sb.auth.getSession()') < boot.indexOf('SpeakingDebt.retryAll()'));
  });

  test('a debt is stamped with its owner', () => {
    assert.match(DEBT, /user_id: userId \|\| null/);
  });

  test("another account's debt is skipped, never cleared", () => {
    // localStorage is origin-wide: user B's retry gets a 403 for user A's debt,
    // and clearing on that response destroyed A's only record.
    assert.match(DEBT, /if \(me && owed\.user_id && String\(owed\.user_id\) !== String\(me\)\) return;/);
  });
});
