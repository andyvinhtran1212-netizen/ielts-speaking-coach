/**
 * frontend/tests/admin-progressive-loading-toggle.test.mjs
 *
 * Regression guard for the PR #611 progressive-loading "toggle-back" bugs.
 *
 * Progressive loading made each admin table/list wrapper visible by default in
 * HTML (with a "Đang tải…" placeholder row) so the page chrome paints at the
 * CSS floor. But the render functions still HIDE the wrapper on an empty /
 * zero-result render (`wrap.hidden = true`). The first cut of that work also
 * removed the success-path reveal (`wrap.hidden = false`) — so once a render
 * hit the empty branch (filter → 0 matches, or a failed fetch), the wrapper
 * stayed hidden forever: clearing the filter rebuilt the <tbody> but the table
 * never reappeared until a full reload. The codex bot caught five of these.
 *
 * Invariant pinned here: if a module HIDES a wrapper on empty, it MUST also
 * REVEAL it on success (literal `= false`, or a conditional `= rows.length
 * === 0` form that handles both states).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readJs = (name) => readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');

// (js file, wrapper id) — every admin list/table wrapper whose render path
// toggles visibility by empty/non-empty result.
const WRAPS = [
  ['admin-error-logs.js', 'logs-table-wrap'],
  ['admin-grammar-analytics.js', 'top-wrap'],
  ['admin-grammar-analytics.js', 'saved-wrap'],
  ['admin-grammar-analytics.js', 'zero-wrap'],
  ['admin-grammar-articles.js', 'gra-table-wrap'],
  ['admin-reading.js', 'ar-list-table'],
];

for (const [file, wrap] of WRAPS) {
  test(`${file}: #${wrap} recovers visibility on success (no toggle-back bug)`, () => {
    const src = readJs(file);
    const e = wrap.replace(/-/g, '\\-');
    const hideTrue    = new RegExp(`['"]${e}['"]\\)\\.hidden\\s*=\\s*true`).test(src);
    const revealFalse = new RegExp(`['"]${e}['"]\\)\\.hidden\\s*=\\s*false`).test(src);
    const conditional = new RegExp(`['"]${e}['"]\\)\\.hidden\\s*=\\s*[^;\\n]*\\blength\\b`).test(src);

    // Sanity: the module actually controls this wrapper's visibility.
    assert.ok(
      hideTrue || revealFalse || conditional,
      `${file} references #${wrap} but never toggles its visibility`,
    );
    // The bug: hide-on-empty with no reveal-on-success.
    if (hideTrue) {
      assert.ok(
        revealFalse || conditional,
        `${file} hides #${wrap} on empty but never reveals it on success — progressive-loading toggle-back bug (PR #611)`,
      );
    }
  });
}

// LEGACYJS-0075 W1: the listening test DETAIL guard (danger zone only after a
// successful fetch) moved to admin-listening-test-detail-next-behavior.test.mjs
// with the deletion of admin-listening-tests-detail.js.

// LEGACYJS-0075 W3a: admin-access-codes.js (#codes-table-wrap) and
// admin-users.js (#usr-table-wrap) are deleted; the Next /admin/users panels
// render their tables from React state, with no hidden-toggle wrapper.
// LEGACYJS-0075 W3b: admin-classes.js (#list-table-wrap, #roster-table-wrap)
// is deleted; the Next class directory and class detail render their tables
// from React state, with no hidden-toggle wrapper (admin-classes-next-behavior,
// admin-class-detail-next-behavior).
// LEGACYJS-0075 W4a: admin-ai-usage.js (#users-wrap), admin-alerts.js
// (#alr-sessions-wrap, #alr-grading-wrap), admin-foot-traffic.js (#ft-body) and
// admin-usage.js (#usage-table-wrap, #code-usage-table-wrap) are deleted; the
// Next /admin/system/ai-usage, /admin/system/alerts, /admin/foot-traffic and
// /admin/usage owners render their tables from React state, with no
// hidden-toggle wrapper (admin-ai-usage-next-behavior, admin-alerts-next-behavior,
// admin-foot-traffic-next-behavior, admin-usage-next-behavior).
