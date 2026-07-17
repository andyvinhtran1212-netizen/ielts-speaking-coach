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
  test('all 20 showBanner now delegate to showToast', () => {
    for (const f of [
      'admin-access-codes.js','admin-cohorts.js','admin-dashboard.js','admin-error-logs.js',
      'admin-listening-content-detail.js','admin-listening-content-list.js','admin-listening-content-meta.js',
      'admin-listening-gist.js','admin-listening-mcq.js','admin-listening-segments.js',
      'admin-listening-tf.js','admin-reading-attempts.js','admin-speaking-sessions.js',
      'admin-speaking-topics.js','admin-users.js','admin-vocab-d1.js','admin-vocab-exercises.js',
      'admin-vocab-lemmas.js','admin-vocab-stats.js','admin-writing-queue.js',
    ]) delegates(f);
  });
  test('auto-dismiss timing preserved: 4s (access-codes) · 5s (speaking-sessions)', () => {
    assert.match(read('js', 'admin-access-codes.js'), /showToast\(msg, kind === 'error' \? 'error' : 'success', \{ timeout: 4000 \}\)/);
    assert.match(read('js', 'admin-speaking-sessions.js'), /timeout: 5000/);
  });
  test('persist preserved: dashboard keeps persist:true', () => {
    assert.match(read('js', 'admin-dashboard.js'), /persist: true/);
  });
  test('hybrid preserved: writing-queue error→persist, else 5s', () => {
    const q = read('js', 'admin-writing-queue.js');
    assert.match(q, /if \(kind === 'error'\) showToast\(msg, 'error', \{ persist: true \}\)/);
    assert.match(q, /else showToast\(msg, kind === 'warn' \? 'warn' : 'success', \{ timeout: 5000 \}\)/);
  });
  test('hideBanner/clearBanner now clear toasts', () => {
    assert.match(read('js', 'admin-listening-segments.js'), /clearToasts\(\)/);
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
  test('students setAlert delegates; error persists', () => {
    const s = read('pages', 'admin', 'students', 'index.html');
    assert.match(s, /function setAlert\(kind, msg\)[\s\S]*?showToast\(/);
    assert.match(s, /kind === 'error'\) showToast\(msg, 'error', \{ persist: true \}\)/);
  });
});


describe('migration — toast.js loaded on migrated pages', () => {
  for (const p of [
    ['pages','admin','access-codes','index.html'],
    ['pages','admin','writing','queue.html'],
    ['pages','admin','writing','grade.html'],
    ['pages','admin','students','index.html'],
  ]) {
    test(`${p.slice(2).join('/')} loads /js/toast.js`, () => {
      assert.match(read(...p), /src="\/js\/toast\.js"/);
    });
  }
});
