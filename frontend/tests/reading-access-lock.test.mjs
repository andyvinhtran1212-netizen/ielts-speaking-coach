/**
 * frontend/tests/reading-access-lock.test.mjs
 *
 * reading-access-tracking Part A — per-test password lock UI.
 *   • Admin: an L3 row lock/unlock button → POST .../tests/{id}/lock; on lock,
 *     the new password is shown (old dies).
 *   • Student: the exam gate sends X-Reading-Password on boot + start; a 403
 *     (locked / wrong) prompts for the password and retries. The password is
 *     held per-test in sessionStorage. Server-side is the real gate (backend
 *     tests) — this pins the client plumbing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const adminJs = read('frontend/js/admin-reading.js');
const examJs = read('frontend/js/reading-exam.js');
const apiJs = read('frontend/js/api.js');
const router = read('backend/routers/admin_reading.py');
const studentRouter = read('backend/routers/reading_student.py');


describe('A — admin lock/unlock control', () => {
  test('L3 row renders a lock button reflecting it.locked', () => {
    assert.match(adminJs, /data-action="lock-test"[\s\S]{0,120}data-locked="/);
    assert.match(adminJs, /it\.locked \? '🔒 Đang khoá' : '🔓 Khoá'/);
    assert.match(adminJs, /action === 'lock-test'\)\s*return handleLockTest/);
  });
  test('handleLockTest posts {locked} + surfaces the NEW password (old dies)', () => {
    const fn = adminJs.slice(adminJs.indexOf('function handleLockTest'));
    assert.match(fn, /'\/admin\/reading\/content\/tests\/' \+ encodeURIComponent\(testId\) \+ '\/lock'/);
    assert.match(fn, /\{ locked: wantLock \}/);
    assert.match(fn, /res\.password/);
    assert.match(fn, /mật khẩu cũ/i);   // warns the old password dies
  });
});

describe('A — student password gate (sends header, retries on 403)', () => {
  test('boot uses getWith + the X-Reading-Password header', () => {
    assert.match(examJs, /function _pwHeaders\(\)/);
    assert.match(examJs, /'X-Reading-Password'/);
    assert.match(examJs, /api\.getWith\('\/api\/reading\/test\/' \+ encodeURIComponent\(testId\) \+ '\/boot', _pwHeaders\(\)\)/);
  });
  test('a 403 prompts for the password + retries boot', () => {
    assert.match(examJs, /status === 403[\s\S]{0,60}_promptPasswordThenRetry/);
    const fn = examJs.slice(examJs.indexOf('function _promptPasswordThenRetry'));
    assert.match(fn, /window\.prompt/);
    assert.match(fn, /sessionStorage\.setItem\(_pwKey\(\)/);
    assert.match(fn, /_doBoot\(\)/);
  });
  test('start carries the password too (postWith)', () => {
    assert.match(examJs, /api\.postWith\('\/api\/reading\/test\/' \+ encodeURIComponent\(SESSION\.test_id\) \+ '\/attempts', null, _pwHeaders\(\)\)/);
  });
  test('api client supports per-call headers without dropping auth', () => {
    assert.match(apiJs, /getWith:\s*function/);
    assert.match(apiJs, /postWith:\s*function/);
    // extra headers merged AFTER auth so a caller can't override Authorization
    assert.match(apiJs, /if \(token\) headers\['Authorization'\][\s\S]{0,400}extraHeaders/);
  });
});

describe('A — backend gate is server-side (cross-ref)', () => {
  test('admin lock endpoint mints/clears the password in metadata.access', () => {
    assert.match(router, /@router\.post\("\/tests\/\{test_id\}\/lock"\)/);
    assert.match(router, /_gen_test_password\(\)/);
    assert.match(router, /metadata\["access"\]/);
  });
  test('student fetch/start/unlock enforce the password (403)', () => {
    assert.match(studentRouter, /def _require_test_unlocked\(test: dict, password/);
    assert.match(studentRouter, /raise HTTPException\(403[\s\S]{0,80}khoá/);
    // threaded into the gated entry points
    assert.match(studentRouter, /alias="X-Reading-Password"/);
    assert.match(studentRouter, /@router\.post\("\/test\/\{test_id\}\/unlock"\)/);
    // the bundle never leaks the password (metadata stripped)
    assert.match(studentRouter, /test\.pop\("metadata", None\)/);
  });
});
