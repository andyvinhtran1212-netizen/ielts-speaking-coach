/**
 * writing-admin-escaper-recursion.test.mjs
 *
 * Regression: the admin Writing grade page (/pages/admin/writing/grade.html)
 * showed the overall band but rendered EVERY detailed-feedback section blank.
 * Root cause: writing-admin.js reassigned `window.WC` wholesale, dropping the
 * canonical `window.WC.escapeHtml` that api.js installs first, and left its own
 * escaper — which delegated to `window.WC.escapeHtml` — pointing at itself.
 * Calling it recursed forever → `RangeError: Maximum call stack size exceeded`,
 * caught per-section by grade.html's renderSection() → blank sections while the
 * band (rendered via textContent, no escaping) still showed.
 *
 * These pin the fix: MERGE into window.WC (never clobber it) and keep the local
 * escaper a DIRECT, non-delegating implementation so it is recursion-safe even
 * when it is the value stored at window.WC.escapeHtml.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const code = read('js', 'writing-admin.js');

// Run writing-admin.js's IIFE against a supplied `window`. At load it only
// defines helpers and merges them onto window.WC — it touches neither document
// nor window.location until a helper is actually called.
function loadWritingAdmin(win) {
  new Function('window', 'document', code)(win, undefined);
  return win;
}

describe('writing-admin escapeHtml — grade-page recursion regression', () => {
  test('merges into window.WC and preserves api.js canonical escaper', () => {
    // Simulate api.js having run first (it installs the canonical escaper).
    const canonical = (s) => 'CANON:' + String(s);
    const win = { WC: { escapeHtml: canonical } };
    loadWritingAdmin(win);

    // The canonical escaper must survive — not be clobbered by a wholesale
    // window.WC reassignment.
    assert.equal(win.WC.escapeHtml, canonical, 'canonical escapeHtml must be preserved');
    // ...and the module's own helpers must still be attached.
    assert.equal(typeof win.WC.bootstrap, 'function');
    assert.equal(typeof win.WC.debounce, 'function');
    assert.equal(typeof win.WC.notify, 'function');
  });

  test('escapeHtml does not recurse and escapes the 5 HTML chars (api.js absent)', () => {
    const win = {};
    loadWritingAdmin(win);
    assert.equal(typeof win.WC.escapeHtml, 'function', 'fallback escaper installed');
    assert.equal(
      win.WC.escapeHtml('<a href="x">&\'</a>'),
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  test('escapeHtml stays recursion-safe on large input (would RangeError before fix)', () => {
    // The old self-delegating wrapper blew the stack on any non-empty value.
    const win = {};
    loadWritingAdmin(win);
    const fn = win.WC.escapeHtml;
    const big = '<&>'.repeat(50000);
    assert.doesNotThrow(() => fn(big), 'escapeHtml must not recurse into itself');
  });

  test('source no longer reassigns window.WC wholesale', () => {
    // Guard the structural fix directly: a `window.WC = { … }` object-literal
    // assignment is what dropped api.js\'s canonical escaper.
    assert.ok(
      !/window\.WC\s*=\s*\{/.test(code),
      'writing-admin.js must merge into window.WC, not reassign it',
    );
  });
});
