/**
 * feedback-admin-inbox.test.mjs — Feedback PR-3 (admin inbox).
 *
 * Pins the admin Feedback page: nav registration, the box-sizing-safe link set,
 * filter + group-by-test + status-PATCH + deep-link contract, and the
 * token-mapped CSS. The pure helpers (filter/group/deepLink/avg) are EXECUTED
 * by extracting them from source; the rest are source-assertion sentinels.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const HTML = read('pages', 'admin', 'feedback', 'index.html');
const JS = read('js', 'admin-feedback.js');
const CSS = read('css', 'admin-feedback.css');
const CHROME = read('js', 'components', 'aver-admin-chrome.js');


describe('Admin feedback — nav registration', () => {
  it('chrome registers a "feedback" section + nav item + message icon', () => {
    assert.match(CHROME, /'feedback'/);                                  // VALID_ACTIVE
    assert.match(CHROME, /section:\s*'feedback'[\s\S]*?href:\s*'\/pages\/admin\/feedback\/index\.html'[\s\S]*?icon:\s*'message'/);
    assert.match(CHROME, /message:\s*'<path/);                            // icon glyph added
  });
});


describe('Admin feedback — page shell (box-sizing-safe)', () => {
  it('mounts aver-admin-chrome active="feedback" + loads admin-feedback.js', () => {
    assert.match(HTML, /<aver-admin-chrome\s+active="feedback">/);
    assert.match(HTML, /src="\/js\/admin-feedback\.js"/);
    assert.match(HTML, /src="\/js\/components\/aver-admin-chrome\.js"/);
  });
  it('links admin-status.css but NOT admin-components.css (box-sizing gotcha)', () => {
    assert.match(HTML, /href="\/css\/aver-design\/admin-status\.css"/);
    assert.match(HTML, /href="\/css\/admin-feedback\.css"/);
    assert.doesNotMatch(HTML, /href="[^"]*admin-components\.css"/);   // the box-model-flipping reset
  });
  it('has the segmented type filter + skill + status selects + count badge', () => {
    assert.match(HTML, /id="fbx-type"[\s\S]*?data-type=""[\s\S]*?data-type="report"[\s\S]*?data-type="flag"[\s\S]*?data-type="rating"/);
    assert.match(HTML, /id="fbx-skill"[\s\S]*?value="reading"[\s\S]*?value="listening"/);
    assert.match(HTML, /id="fbx-status"[\s\S]*?value="new"[\s\S]*?value="resolved"/);
    assert.match(HTML, /id="fbx-count-n"/);
  });
});


describe('Admin feedback — endpoint contract (#458)', () => {
  it('GETs the grouped list + PATCHes status', () => {
    assert.match(JS, /window\.api\.get\('\/api\/admin\/feedback'\)/);
    assert.match(JS, /window\.api\.patch\('\/api\/admin\/feedback\/'\s*\+\s*encodeURIComponent\(id\),\s*\{\s*status:\s*next\s*\}\)/);
  });
  it('status toggle is optimistic + reverts on error', () => {
    assert.match(JS, /row\.status = next;\s*\/\/ optimistic/);
    assert.match(JS, /row\.status = prev;\s*\/\/ revert/);
  });
});


describe('Admin feedback — pure helpers (executed)', () => {
  // extract the self-contained helpers + the DEEP_LINK map from source and run them
  function loadHelpers() {
    const dl = JS.match(/var DEEP_LINK = \{[\s\S]*?\};/)[0];
    const rmf = JS.match(/function rowMatchesFilters\(r, f\) \{[\s\S]*?\n  \}/)[0];
    const grp = JS.match(/function groupByTest\(rows\) \{[\s\S]*?\n  \}/)[0];
    const dlf = JS.match(/function deepLink\(r\) \{[\s\S]*?\n  \}/)[0];
    const avg = JS.match(/function avg\(nums\) \{[\s\S]*?\n  \}/)[0];
    return new Function(
      dl + '\n' + rmf + '\n' + grp + '\n' + dlf + '\n' + avg +
      '\nreturn { rowMatchesFilters, groupByTest, deepLink, avg };'
    )();
  }
  const H = loadHelpers();

  it('rowMatchesFilters honours type + status + skill', () => {
    const r = { type: 'flag', status: 'new', skill: 'listening' };
    assert.equal(H.rowMatchesFilters(r, { type: '', status: '', skill: '' }), true);
    assert.equal(H.rowMatchesFilters(r, { type: 'flag', status: '', skill: '' }), true);
    assert.equal(H.rowMatchesFilters(r, { type: 'report', status: '', skill: '' }), false);
    assert.equal(H.rowMatchesFilters(r, { type: '', status: 'resolved', skill: '' }), false);
    assert.equal(H.rowMatchesFilters(r, { type: '', status: '', skill: 'reading' }), false);
  });
  it('groupByTest groups rows under their test_id', () => {
    const groups = H.groupByTest([
      { test_id: 'A', skill: 'listening', type: 'rating' },
      { test_id: 'A', skill: 'listening', type: 'flag' },
      { test_id: 'B', skill: 'reading', type: 'report' },
    ]);
    assert.equal(groups.length, 2);
    const a = groups.find((g) => g.test_id === 'A');
    assert.equal(a.items.length, 2);
  });
  it('deepLink targets the right admin page per skill (+ #q anchor)', () => {
    assert.equal(H.deepLink({ skill: 'reading', test_id: 'RD-1', q_num: 3 }),
      '/pages/admin/reading/content.html?test=RD-1#q3');
    assert.equal(H.deepLink({ skill: 'listening', test_id: 'LIS-1' }),
      '/pages/admin/listening/tests.html?test=LIS-1');
    assert.equal(H.deepLink({ skill: 'listening' }), null);   // no test_id → no link
  });
  it('avg ignores nulls', () => {
    assert.equal(H.avg([5, null, 4]), 4.5);
    assert.equal(H.avg([null, null]), null);
  });
});


describe('Admin feedback — CSS (real tokens, scoped box-sizing, a11y)', () => {
  it('scopes border-box to .fbx (no global reset) + maps to --av-*', () => {
    assert.match(CSS, /\.fbx,\s*\.fbx \* \{ box-sizing: border-box;/);
    assert.match(CSS, /--fbx-surface:\s*var\(--av-surface-card\)/);
    assert.match(CSS, /--fbx-brand:\s*var\(--av-primary\)/);
  });
  it('terracotta flag scoped token with dark override + reduced-motion + focus', () => {
    assert.match(CSS, /--fbx-flag:\s*#d8643b/);
    assert.match(CSS, /\[data-theme="dark"\]\s*\.fbx\s*\{[\s\S]*?--fbx-flag:\s*#e8794f/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(CSS, /:focus-visible/);
  });
});
