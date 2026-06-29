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
const readHtml = (...rel) => readFileSync(path.join(__dirname, '..', 'pages', ...rel), 'utf8');

// (js file, wrapper id) — every admin list/table wrapper whose render path
// toggles visibility by empty/non-empty result.
const WRAPS = [
  ['admin-access-codes.js', 'codes-table-wrap'],
  ['admin-ai-usage.js', 'users-wrap'],
  ['admin-alerts.js', 'alr-sessions-wrap'],
  ['admin-alerts.js', 'alr-grading-wrap'],
  ['admin-foot-traffic.js', 'ft-body'],
  ['admin-users.js', 'usr-table-wrap'],
  ['admin-error-logs.js', 'logs-table-wrap'],
  ['admin-grammar-analytics.js', 'top-wrap'],
  ['admin-grammar-analytics.js', 'saved-wrap'],
  ['admin-grammar-analytics.js', 'zero-wrap'],
  ['admin-grammar-articles.js', 'gra-table-wrap'],
  ['admin-reading.js', 'ar-list-table'],
  ['admin-usage.js', 'usage-table-wrap'],
  ['admin-usage.js', 'code-usage-table-wrap'],
  ['admin-cohorts.js', 'cohorts-table-wrap'],
  ['admin-cohorts.js', 'members-table-wrap'],
  // NOTE: admin-listening-tests-list.js (tl-table-wrap) is intentionally not
  // listed — renderRows() fetches the element into a local `tableWrap` var and
  // toggles `tableWrap.hidden` (both true on empty and false on success), a
  // different idiom from the `$('id').hidden = …` inline pattern this regex
  // checks. It was never affected by the toggle-back bug.
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

// Category B — destructive controls on the listening test DETAIL page must be
// gated on a successful fetch, never shown by default. A failed/unauthorized/
// 404 load must not present archive + hard-delete buttons over un-loaded data
// for the id taken from the URL.
test('admin-listening-tests-detail: destructive section is gated on successful fetch', () => {
  const html = readHtml('admin', 'listening', 'tests-detail.html');
  const js = readJs('admin-listening-tests-detail.js');
  // Hidden by default in HTML…
  assert.match(
    html,
    /id="td-delete"[^>]*\shidden/,
    '#td-delete (archive + hard-delete) must be hidden by default',
  );
  // …and revealed only inside render(), which runs only after fetchTest() succeeds.
  assert.match(
    js,
    /getElementById\('td-delete'\)\.hidden\s*=\s*false/,
    'render() must reveal #td-delete after a successful fetch',
  );
});
