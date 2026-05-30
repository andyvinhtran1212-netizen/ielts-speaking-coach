/**
 * frontend/tests/design-fix-1-admin-primitives.test.mjs — Design-Fix Sprint 1.
 *
 * Sentinels for the shared admin status-pill + action-group primitives (B1+B2)
 * and the legacy-bridge governance note (B6), from the design-consistency audit
 * (docs/audits/design_consistency_audit.md, rows 1,3,4,5,6-11,26).
 *
 * Contract pinned here:
 *   • A single .adm-status-pill primitive (token-driven, bordered, one size)
 *     lives in admin-status.css, with the legacy chip classes ALIASED onto it
 *     so JS renderers keep emitting their old class names (Lesson 9).
 *   • A single .adm-action-group primitive groups row actions.
 *   • The shared admin danger button + banner use the canonical --av-error
 *     token (not the non-existent --av-color-error — audit row 5).
 *   • Access-code type chips use .adm-chip; status uses .adm-status-pill
 *     state modifiers (no more is-direct overload — rows 3,4).
 *   • Every consuming page reaches the primitive without adopting an
 *     unintended box-model flip.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

let statusCss, adminCss, readingCss, writingCss, codesJs, readingJs;
const listening = {};
let readingHtml, tipsHtml;

before(() => {
  statusCss  = read('frontend/css/aver-design/admin-status.css');
  adminCss   = read('frontend/css/aver-design/admin-components.css');
  readingCss = read('frontend/css/admin-reading.css');
  writingCss = read('frontend/css/admin-writing.css');
  codesJs    = read('frontend/js/admin-access-codes.js');
  readingJs  = read('frontend/js/admin-reading.js');
  for (const p of ['index', 'tests', 'content-detail', 'tests-detail']) {
    listening[p] = read(`frontend/pages/admin/listening/${p}.html`);
  }
  readingHtml = read('frontend/pages/admin/reading/content.html');
  tipsHtml    = read('frontend/pages/admin/writing/tips.html');
});


describe('admin-status.css / shared status-pill primitive (B1)', () => {
  test('.adm-status-pill base declared', () => {
    assert.match(statusCss, /\.adm-status-pill\b/);
  });

  test('covers all ten audit-listed states as modifiers', () => {
    for (const s of ['draft', 'published', 'archived', 'active', 'inactive',
                     'revoked', 'readonly', 'live', 'new', 'soon']) {
      assert.match(statusCss, new RegExp(`\\.adm-status-pill\\.is-${s}\\b`),
        `missing .adm-status-pill.is-${s}`);
    }
  });

  test('legacy chip classes are aliased onto the primitive (Lesson 9)', () => {
    for (const cls of ['lst-chip', 'tl-chip', 'det-chip', 'td-chip', 'ar-status-pill']) {
      assert.match(statusCss, new RegExp(`\\.${cls}\\b`), `missing alias for .${cls}`);
    }
  });

  test('token-driven only — no hardcoded semantic hex colors', () => {
    const stripped = statusCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(stripped),
      'admin-status.css must not hardcode hex colors — use --av-* tokens');
  });

  test('consistent size — pill padding matches canonical .adm-chip (2px 10px)', () => {
    assert.match(statusCss, /\.adm-status-pill[\s\S]*?padding:\s*2px 10px/);
  });
});


describe('admin-status.css / action-group primitive (B2)', () => {
  test('.adm-action-group declared with flex-wrap', () => {
    assert.match(statusCss, /\.adm-action-group\b/);
    assert.match(statusCss, /\.adm-action-group[\s\S]*?flex-wrap:\s*wrap/);
  });

  test('compact variant + small button size declared', () => {
    assert.match(statusCss, /\.adm-action-group--compact\b/);
    assert.match(statusCss, /\.adm-btn-sm\b/);
  });
});


describe('admin-components.css / danger token fix (B2, audit row 5)', () => {
  test('imports the no-reset status primitives', () => {
    assert.match(adminCss, /@import\s+url\(['"]admin-status\.css['"]\)/);
  });

  test('danger button + banner use canonical --av-error, not --av-color-error', () => {
    const code = adminCss.replace(/\/\*[\s\S]*?\*\//g, '');  // ignore explanatory comments
    assert.ok(!/--av-color-error/.test(code),
      'the non-existent --av-color-error token must be gone from live rules');
    assert.match(adminCss, /\.adm-btn-danger[\s\S]*?color:\s*var\(--av-error\)/);
    assert.match(adminCss, /\.adm-banner\.is-error\s*\{[^}]*var\(--av-error\)/);
  });
});


describe('access codes / chip + action semantics (B2, audit rows 1,3,4)', () => {
  test('type chip uses canonical .adm-chip (no unstyled ac-chip)', () => {
    assert.ok(!/['"]ac-chip/.test(codesJs), 'ac-chip had no CSS rule — must use adm-chip');
    assert.match(codesJs, /class="\$\{cls\}"/);
    assert.match(codesJs, /'adm-chip is-direct'\s*:\s*'adm-chip'/);
  });

  test('status uses .adm-status-pill state modifiers, not is-direct overload', () => {
    assert.match(codesJs, /adm-status-pill is-revoked/);
    assert.match(codesJs, /adm-status-pill is-inactive/);
    assert.match(codesJs, /adm-status-pill is-active/);
  });

  test('row actions wrapped in .adm-action-group with consistent sizing', () => {
    assert.match(codesJs, /<div class="adm-action-group">/);
    assert.match(codesJs, /adm-btn-secondary adm-btn-sm/);
  });
});


describe('consuming pages reach the primitive (no box-model flip)', () => {
  test('listening pages link admin-status.css and drop their local chip CSS', () => {
    for (const p of ['index', 'tests', 'content-detail', 'tests-detail']) {
      assert.match(listening[p], /css\/aver-design\/admin-status\.css/, `${p} links admin-status.css`);
    }
    // The duplicated, hardcoded-color chip rules are gone (consolidated).
    assert.ok(!/\.lst-chip\s*\{/.test(listening.index));
    assert.ok(!/\.tl-chip\s*\{/.test(listening.tests));
    assert.ok(!/\.det-chip\s*\{/.test(listening['content-detail']));
    assert.ok(!/\.td-chip\s*\{/.test(listening['tests-detail']));
  });

  test('reading links admin-status.css; .ar-status-pill rules removed (no mono status)', () => {
    assert.match(readingHtml, /css\/aver-design\/admin-status\.css/);
    assert.ok(!/\.ar-status-pill\s*\{/.test(readingCss), '.ar-status-pill base must be retired');
    // Reading still emits the aliased class name from JS.
    assert.match(readingJs, /ar-status-pill is-/);
    // Row actions wrap in the shared group div (a <td> must not be inline-flex).
    assert.match(readingJs, /<td class="ar-row-actions"><div class="adm-action-group">/);
  });

  test('writing tips links admin-status.css and emits the shared pill', () => {
    assert.match(tipsHtml, /css\/aver-design\/admin-status\.css/);
    assert.match(tipsHtml, /adm-status-pill is-published/);
    assert.ok(!/\.aw-pill--published/.test(writingCss), '.aw-pill--published retired');
    // The .aw-pill mono-tag family (task/difficulty metadata) intentionally stays.
    assert.match(writingCss, /\.aw-pill--task\b/);
  });
});
