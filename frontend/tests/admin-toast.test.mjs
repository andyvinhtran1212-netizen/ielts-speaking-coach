/**
 * admin-toast.test.mjs — notification arc PR-1 (toast consolidation).
 *
 * Pins the shared window.showToast helper (aver-design, NOT ds.css), its CSS
 * primitive, and the MECHANICAL migration of the 22 showBanner + 4 setAlert
 * impls — preserving each site's variant + timing (auto 4s/5s · persist ·
 * hybrid error-persist) and that toast.js is loaded on every migrated page.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const TOAST = read('js', 'toast.js');
const ADMINCSS = read('css', 'aver-design', 'admin-components.css');


describe('toast helper — shared, aver-design (not ds.css)', () => {
  test('exposes window.showToast + window.clearToasts', () => {
    assert.match(TOAST, /window\.showToast = showToast/);
    assert.match(TOAST, /window\.clearToasts = clearToasts/);
  });
  test('renders into an .av-toast stack (not .ds-toast)', () => {
    assert.match(TOAST, /av-toast-stack/);
    assert.match(TOAST, /'av-toast av-toast-'/);
    assert.doesNotMatch(TOAST, /ds-toast/);
  });
  test('aria-live: polite/status default, assertive/alert for error|persist', () => {
    assert.match(TOAST, /variant === 'error' \|\| persist/);
    assert.match(TOAST, /aria-live'?,?\s*loud \? 'assertive' : 'polite'/);
    assert.match(TOAST, /'role', loud \? 'alert' : 'status'/);
  });
  test('auto-dismiss unless persist; persist gets a × close', () => {
    assert.match(TOAST, /if \(!persist && timeout > 0\)/);
    assert.match(TOAST, /av-toast__close/);
  });
  test('persist replaces prior persist (no pileup)', () => {
    assert.match(TOAST, /querySelectorAll\('\.av-toast\[data-persist="1"\]'\)/);
  });
  test('CSS primitive defines all four variants (token-driven)', () => {
    for (const v of ['success', 'error', 'info', 'warn']) {
      assert.match(ADMINCSS, new RegExp(`\\.av-toast-${v}`), `missing .av-toast-${v}`);
    }
    assert.match(ADMINCSS, /\.av-toast-stack/);
  });
});


describe('migration — mechanical, timing preserved', () => {
  const delegates = (f) => assert.match(read('js', f), /function showBanner[\s\S]*?showToast\(/);

  // admin-listening-upload.js + admin-listening-render.js dropped from the
  // list 2026-07-17 — those admin surfaces were decommissioned (usage audit).
  // LEGACYJS-0075 W1 (2026-11-23): the 7 admin-listening-* scripts were deleted;
  // their Next owners under app/(authed-admin-listening) use inline banners.
  // LEGACYJS-0075 W3a: admin-access-codes.js and admin-users.js were deleted;
  // the Next /admin/users panels show inline role="status"/"alert" banners.
  // LEGACYJS-0075 W4a: admin-dashboard.js is deleted; the Next Tổng quan owner
  // shows its load error as an inline role="alert" banner (below).
  // LEGACYJS-0075 W4b: admin-error-logs, admin-speaking-sessions/-topics,
  // admin-vocab-d1/-exercises/-lemmas/-stats and admin-writing-queue are
  // deleted; their Next owners use the inline StatusBanner (pinned below).
  test('remaining showBanner delegates to showToast', () => {
    for (const f of ['admin-reading-attempts.js']) delegates(f);
  });

  // LEGACYJS-0075 W3b: admin-classes.js is deleted. The Next class directory
  // and class detail panels report through the shared inline StatusBanner
  // (role="alert" for errors, "status" otherwise) and never native dialogs.
  test('Next class surfaces use StatusBanner, never native dialogs', () => {
    assert.match(read('components', 'admin-directory-ui.tsx'), /role=\{banner\.kind === 'error' \? 'alert' : 'status'\}/);
    for (const f of [
      ['app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx'],
      ['app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx'],
      ['app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-homework.tsx'],
      ['app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-submissions.tsx'],
    ]) {
      const src = read(...f);
      assert.match(src, /<StatusBanner banner=\{/, f.at(-1));
      assert.doesNotMatch(src, /(?<![.\w])alert\(/, f.at(-1));
      assert.doesNotMatch(src, /(?<![.\w])confirm\(/, f.at(-1));
    }
  });
  // The Next speaking-sessions and writing-queue pages keep the banner until the
  // next action (no 5 s auto-dismiss); errors still persist.
  test('Next speaking-sessions + writing-queue report through StatusBanner, no timer', () => {
    for (const f of [
      ['app', '(authed-admin-speaking-sessions)', 'admin', 'speaking', 'sessions', 'admin-speaking-sessions.tsx'],
      ['app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx'],
    ]) {
      const src = read(...f);
      assert.match(src, /<StatusBanner banner=\{banner\} \/>/, f.at(-1));
      assert.match(src, /setBanner\(\{ kind: 'error', text: /, f.at(-1));
      assert.doesNotMatch(src, /setTimeout\(\(\) => \{?\s*setBanner\(null\);?\s*\}?, \d+\)/, f.at(-1));
      assert.doesNotMatch(src, /(?<![.\w])alert\(/, f.at(-1));
    }
  });
  test('persist preserved: overview load error stays until the next load', () => {
    const o = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
    assert.match(o, /\{opsError && <div className="db-banner" role="alert">\{opsError\}<\/div>\}/);
    assert.equal((o.match(/setOpsError\(null\)/g) || []).length, 1, 'only a new load clears the error');
    assert.doesNotMatch(o, /setTimeout\([^)]*setOpsError/);
  });
  test('hideBanner/clearBanner now clear toasts', () => {
    assert.match(read('js', 'admin-reading-attempts.js'), /function clearBanner[\s\S]*?clearToasts\(\)/);
  });
});


describe('migration — setAlert (4 pages), error-persist not swallowed', () => {
  test('grade.html setAlert: error persists, others auto-dismiss', () => {
    const g = read('pages', 'admin', 'writing', 'grade.html');
    assert.match(g, /function setAlert\(kind, msg\)[\s\S]*?showToast\(/);
    assert.match(g, /kind === 'error'\)\s*\{?\s*showToast\(msg, 'error', \{ persist: true \}\)/);
    assert.match(g, /timeout: 4000/);
  });
  // LEGACYJS-0075 W3b: admin-students-panel.js is deleted. The students
  // directory keeps an error banner until the next action (no auto-dismiss).
  test('students directory error banner persists (no timer clears it)', () => {
    const s = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');
    assert.match(s, /<StatusBanner banner=\{banner\} \/>/);
    assert.match(s, /setBanner\(\{ kind: 'error', text: messageOf\(/);
    assert.doesNotMatch(s, /setTimeout\([^)]*setBanner/);
  });
});


describe('migration — toast.js loaded on migrated pages', () => {
  for (const p of [
    ['pages','admin','writing','queue.html'],
    ['pages','admin','writing','grade.html'],
    ['pages','admin','classes','index.html'],   // GĐ 1b: bảng Học viên đã chuyển vào đây
  ]) {
    test(`${p.slice(2).join('/')} loads /js/toast.js`, () => {
      assert.match(read(...p), /src="\/js\/toast\.js"/);
    });
  }
});
