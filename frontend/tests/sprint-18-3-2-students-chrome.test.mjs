/**
 * frontend/tests/sprint-18-3-2-students-chrome.test.mjs — Sprint 18.3.2
 *
 * Students page cross-chrome migration: Writing-Coach (WC.bootstrap / aw-* /
 * Tailwind / admin-writing.css) → aver-admin chrome + admin-components.css.
 * Source-scan: no WC remnants, av/adm-* consumption, preserved features
 * (CRUD + Tổng quan summary + CSV import + search + auth gate) + the 18.1 tabs.
 * Source-scan sentinel only — it pins markup/wiring, not rendered behaviour;
 * runtime + visual verification is via Andy dogfood (tracked separately).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'pages', 'admin', 'students', 'index.html'), 'utf8');


describe('Sprint 18.3.2 — Writing-Coach chrome removed', () => {
  test('no writing-admin.js / WC.bootstrap call', () => {
    assert.doesNotMatch(HTML, /writing-admin\.js/);
    assert.doesNotMatch(HTML, /WC\.bootstrap\(/);
    assert.doesNotMatch(HTML, /WC\.(escapeHtml|debounce)\(/);
  });
  test('no aw-* classes (admin-writing.css coupling gone)', () => {
    assert.doesNotMatch(HTML, /class="[^"]*\baw-/);
    assert.doesNotMatch(HTML, /<link[^>]*admin-writing\.css/);
  });
  test('no Tailwind CDN / lucide', () => {
    assert.doesNotMatch(HTML, /cdn\.tailwindcss\.com/);
    assert.doesNotMatch(HTML, /lucide/);
  });
});

describe('Sprint 18.3.2 — aver-admin chrome + shared components consumed', () => {
  test('aver-admin chrome + admin-components.css linked', () => {
    assert.match(HTML, /<aver-admin-chrome active="students">/);
    assert.match(HTML, /\/css\/aver-design\/admin-components\.css/);
  });
  test('uses shared .adm-* components (table / button / card / modal / field)', () => {
    assert.match(HTML, /class="adm-table"/);
    assert.match(HTML, /class="adm-btn-primary"/);
    assert.match(HTML, /class="adm-btn-secondary"/);
    assert.match(HTML, /class="adm-btn-danger"/);
    assert.match(HTML, /class="adm-card"/);
    assert.match(HTML, /class="adm-modal-backdrop hidden"/);
    assert.match(HTML, /class="adm-field"/);
  });
  test('no inline colour/bg styles (Pattern #26)', () => {
    assert.doesNotMatch(HTML, /style="[^"]*color\s*:/);
    assert.doesNotMatch(HTML, /style="[^"]*background/);
  });
});

describe('Sprint 18.3.2 — features preserved', () => {
  test('admin auth gate (own inline replacement for WC.bootstrap)', () => {
    assert.match(HTML, /\/auth\/me/);
    assert.match(HTML, /role !== 'admin'/);
    assert.match(HTML, /id="state-denied"/);
    assert.match(HTML, /id="state-ready"/);
  });
  test('CRUD wired (new / edit / delete / save)', () => {
    assert.match(HTML, /id="btn-new"/);
    assert.match(HTML, /id="student-form"/);
    assert.match(HTML, /data-act="edit"/);
    assert.match(HTML, /data-act="delete"/);
    assert.match(HTML, /api\.post\('\/admin\/students'/);
    assert.match(HTML, /api\.patch\('\/admin\/students\//);
    assert.match(HTML, /api\.delete\('\/admin\/students\//);
  });
  test('Tổng quan summary modal preserved', () => {
    assert.match(HTML, /id="summary-modal"/);
    assert.match(HTML, /\/admin\/writing\/students\/'\s*\+\s*studentId\s*\+\s*'\/summary/);
    assert.match(HTML, /id="stat-total"/);
  });
  test('CSV import + New Essay link + search preserved', () => {
    assert.match(HTML, /id="csv-input"/);
    assert.match(HTML, /\/admin\/students\/import/);
    assert.match(HTML, /\/pages\/admin\/writing\/new\.html\?student_id=/);
    assert.match(HTML, /id="search-input"/);
  });
});

describe('Sprint 18.3.2 — Sprint 18.1 tabs preserved', () => {
  test('"Lớp & Học viên" subtabs intact, students active', () => {
    assert.match(HTML, /class="adm-subtab"[^>]*href="\/pages\/admin\/cohorts\/index\.html"/);
    assert.match(HTML, /class="adm-subtab is-active"[^>]*href="\/pages\/admin\/students\/index\.html"/);
  });
});
