/**
 * frontend/tests/reading-access-share.test.mjs
 *
 * reading-access-tracking Part B2 — share-link UI + anonymous student flow.
 * Wires B1's live backend (#387) into the UI: admin generate/rotate/revoke a
 * time-limited link; an anonymous (`?share=token`) taker boots, takes, submits,
 * and reviews via the share + anon endpoints, owning the attempt with the
 * minted anon_id (sent as X-Reading-Anon). Static-analysis sentinels (matching
 * the Part A reading-access-lock style) pin the BEHAVIOURAL contracts — the
 * share-mode branch points, the anon_id persistence, the headers, the
 * no-login-redirect guard — not just markup.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const apiJs = read('frontend/js/api.js');
const examJs = read('frontend/js/reading-exam.js');
const reviewJs = read('frontend/js/reading-review.js');
const adminJs = read('frontend/js/admin-reading.js');
const adminCss = read('frontend/css/admin-reading.css');
const adminRouter = read('backend/routers/admin_reading.py');
const studentRouter = read('backend/routers/reading_student.py');


describe('B2 — api client: per-call headers + no-login-redirect option', () => {
  test('patchWith exists (anon auto-save needs PATCH + headers)', () => {
    assert.match(apiJs, /patchWith:\s*function\s*\(path,\s*body,\s*hdrs,\s*opts\)/);
  });
  test('the *With helpers thread an opts arg through to _apiRequest', () => {
    assert.match(apiJs, /getWith:\s*function\s*\(path,\s*hdrs,\s*opts\)/);
    assert.match(apiJs, /postWith:\s*function\s*\(path,\s*body,\s*hdrs,\s*opts\)/);
  });
  test('401 redirects to login ONLY when opts.noRedirect is not set', () => {
    // The anonymous share path must surface 401 as an error, never bounce to
    // /login.html (the user has no account). This is the core no-auth-gating
    // guard for share mode.
    assert.match(apiJs, /response\.status === 401 && !\(opts && opts\.noRedirect\)/);
  });
});


describe('B2 — exam share mode: ?share=token boots anonymously, lock-bypassed', () => {
  test('shareTokenFromUrl reads the ?share= param', () => {
    assert.match(examJs, /function shareTokenFromUrl\(\)/);
    assert.match(examJs, /URLSearchParams\(window\.location\.search\)\.get\('share'\)/);
  });
  test('boot() branches into share mode (no test_id required)', () => {
    const fn = examJs.slice(examJs.indexOf('function boot()'));
    assert.match(fn, /shareTokenFromUrl\(\)/);
    assert.match(fn, /SESSION\.share_mode = true/);
    assert.match(fn, /SESSION\.share_token = shareToken/);
  });
  test('_doBoot hits the share boot endpoint (no auth) with noRedirect', () => {
    assert.match(examJs, /\/api\/reading\/test\/share\/'\s*\+\s*encodeURIComponent\(SESSION\.share_token\)\s*\+\s*'\/boot'/);
    assert.match(examJs, /_anonHeaders\(\),\s*\{\s*noRedirect:\s*true\s*\}/);
  });
  test('the authed boot path is unchanged (X-Reading-Password preserved)', () => {
    // Part A regression guard — share mode is additive, not a rewrite.
    assert.match(examJs, /getWith\('\/api\/reading\/test\/'\s*\+\s*encodeURIComponent\(testId\)\s*\+\s*'\/boot',\s*_pwHeaders\(\)\)/);
  });
});


describe('B2 — exam share mode: anon_id capability-token persistence', () => {
  test('anon_id is keyed by share token in localStorage', () => {
    assert.match(examJs, /function _anonKey\(\)\s*\{\s*return 'reading-anon:' \+ SESSION\.share_token/);
    assert.match(examJs, /function _getAnonId\(\)/);
    assert.match(examJs, /function _setAnonId\(id\)/);
    assert.match(examJs, /localStorage\.setItem\(_anonKey\(\), id\)/);
  });
  test('_anonHeaders sends X-Reading-Anon only in share mode', () => {
    const fn = examJs.slice(examJs.indexOf('function _anonHeaders()'));
    assert.match(fn, /if \(!SESSION\.share_mode\) return null/);
    assert.match(fn, /'X-Reading-Anon': id/);
  });
  test('start mints + STORES the anon_id, then creates the attempt', () => {
    assert.match(examJs, /\/api\/reading\/test\/share\/'\s*\+\s*encodeURIComponent\(SESSION\.share_token\)\s*\+\s*'\/attempts'/);
    assert.match(examJs, /_setAnonId\(res && res\.anon_id\)/);
  });
});


describe('B2 — exam share mode: submit + auto-save carry ownership; no login bounce', () => {
  test('submit branches to postWith + X-Reading-Anon + noRedirect in share mode', () => {
    assert.match(examJs, /SESSION\.share_mode\s*\?\s*window\.api\.postWith\([\s\S]{0,160}\/submit'/);
    assert.match(examJs, /_anonHeaders\(\),\s*\{\s*noRedirect:\s*true\s*\}/);
  });
  test('authed submit literal is preserved (sprint-20-6 contract)', () => {
    assert.match(examJs, /window\.api\.post\(\s*\n?\s*'\/api\/reading\/test\/attempts\/'\s*\+\s*encodeURIComponent\(SESSION\.attempt_id\)\s*\+\s*'\/submit'/);
  });
  test('auto-save branches to patchWith in share mode, keeps authed patch', () => {
    assert.match(examJs, /window\.api\.patchWith\(answersUrl, answerBody, _anonHeaders\(\), \{ noRedirect: true \}\)/);
    assert.match(examJs, /window\.api\.patch\('\/api\/reading\/test\/attempts\/'/);
  });
});


describe('B2 — exam share mode: expired/invalid link + diagnostic + review CTA', () => {
  test('a rejected share token shows a friendly state, NOT the password prompt', () => {
    assert.match(examJs, /if \(SESSION\.share_mode\)\s*\{[\s\S]{0,200}403 \|\| e\.status === 404/);
    assert.match(examJs, /hết hạn hoặc không hợp lệ/);
  });
  test('the auth-only diagnostic is skipped in share mode (would 401)', () => {
    const fn = examJs.slice(examJs.indexOf('function loadDiagnostic'));
    assert.match(fn, /if \(SESSION\.share_mode\)\s*\{[\s\S]{0,260}return;/);
  });
  test('chữa-bài CTA carries the anon_id so the review page can own it', () => {
    assert.match(examJs, /SESSION\.share_mode && _getAnonId\(\)/);
    assert.match(examJs, /'&anon=' \+ encodeURIComponent\(_getAnonId\(\)\)/);
    // authed CTA literal preserved (reading-rich-chuabai contract)
    assert.match(examJs, /reading-review\.html\?attempt_id=' \+ encodeURIComponent\(result\.attempt_id\)/);
  });
});


describe('B2 — review page: anonymous ownership via anon_id', () => {
  test('reads the ?anon= param', () => {
    assert.match(reviewJs, /function anonIdFromUrl\(\)/);
    assert.match(reviewJs, /URLSearchParams\(window\.location\.search\)\.get\('anon'\)/);
  });
  test('sends X-Reading-Anon + noRedirect when an anon_id is present', () => {
    assert.match(reviewJs, /window\.api\.getWith\(reviewUrl, \{ 'X-Reading-Anon': anonId \}, \{ noRedirect: true \}\)/);
    assert.match(reviewJs, /window\.api\.get\(reviewUrl\)/);   // authed path preserved
  });
  test('403/401 surface a clear ownership message (no raw error / no login)', () => {
    assert.match(reviewJs, /e\.status === 403 \|\| e\.status === 401/);
    assert.match(reviewJs, /không còn hiệu lực hoặc thuộc phiên khác/);
  });
});


describe('B2 — admin: generate / rotate / revoke link control', () => {
  test('L3 row renders a share button reflecting it.share_active', () => {
    assert.match(adminJs, /data-action="share-test"[\s\S]{0,160}data-share-active="/);
    assert.match(adminJs, /it\.share_active \? '🔗 Đang chia sẻ' : '🔗 Link'/);
    assert.match(adminJs, /action === 'share-test'\)\s*return handleShareTest/);
  });
  test('generate/rotate posts expires_in_days; revoke posts {revoke:true}', () => {
    assert.match(adminJs, /\/admin\/reading\/content\/tests\/' \+ encodeURIComponent\(testId\) \+ '\/share'/);
    assert.match(adminJs, /\{ expires_in_days: days \}/);
    assert.match(adminJs, /\{ revoke: true \}/);
  });
  test('the link is built for the student exam page in share mode', () => {
    assert.match(adminJs, /function _shareUrl\(token\)/);
    assert.match(adminJs, /pages\/reading-exam\.html'\)\s*\+\s*\n?\s*'\?share=' \+ encodeURIComponent\(token\)/);
  });
  test('the modal warns that generating/rotating kills the old link', () => {
    assert.match(adminJs, /huỷ liên kết cũ ngay lập tức/);
    assert.match(adminJs, /liên kết cũ.{0,40}chết/i);
  });
  test('modal CSS is token-clean + theme-aware (injected modal styled)', () => {
    assert.match(adminCss, /\.ar-modal\s*\{/);
    assert.match(adminCss, /\.ar-row-action\.is-shared/);
    // no hardcoded hex colours in the new modal block (theme via tokens).
    // Bound the slice to just the B2 block (is-shared → end of .ar-modal__actions)
    // so it doesn't catch hex in unrelated rules later in the file.
    const start = adminCss.indexOf('.ar-row-action.is-shared');
    const after = adminCss.indexOf('.ar-modal__actions', start);
    const block = adminCss.slice(start, after + 200);
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block), 'share modal CSS must use tokens, not hex');
  });
});


describe('B2 — backend cross-ref (live from B1 #387)', () => {
  test('admin share endpoint generate/rotate/revoke exists', () => {
    assert.match(adminRouter, /@router\.post\("\/tests\/\{test_id\}\/share"\)/);
    assert.match(adminRouter, /body\.get\("revoke"\)/);
    assert.match(adminRouter, /metadata\["share"\] = \{/);
  });
  test('admin list row surfaces share_active + expiry (never the token)', () => {
    assert.match(adminRouter, /"share_active":\s*bool\(\(\(r\.get\("metadata"\)/);
    assert.match(adminRouter, /"share_expires_at":/);
  });
  test('student share boot + attempts endpoints are no-auth', () => {
    assert.match(studentRouter, /@router\.get\("\/test\/share\/\{share_token\}\/boot"\)/);
    assert.match(studentRouter, /@router\.post\("\/test\/share\/\{share_token\}\/attempts"\)/);
    assert.match(studentRouter, /alias="X-Reading-Anon"/);
  });
});
