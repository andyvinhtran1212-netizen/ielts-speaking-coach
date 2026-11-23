/**
 * frontend/tests/sprint-18-3-2-students-chrome.test.mjs — Sprint 18.3.2
 *
 * Students page cross-chrome migration: Writing-Coach (WC.bootstrap / aw-* /
 * Tailwind / admin-writing.css) → aver-admin chrome + shared admin components.
 * Source-scan: no WC remnants, adm-* consumption, preserved features
 * (CRUD + Writing summary + CSV import + search + auth gate) + the 18.1 tabs.
 *
 * LEGACYJS-0075 W3b: admin-students-panel.js is deleted. The same invariants
 * are pinned on the native owner, app/(authed-admin-students)/admin/students.
 * Rendered behaviour is covered by admin-students-next-behavior.test.mjs and
 * tooling/verify-admin-students-flow.mjs.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PAGE = read('app', '(authed-admin-students)', 'admin', 'students', 'page.tsx');
const DIR = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');
const SRC = PAGE + DIR;

describe('Sprint 18.3.2 — Writing-Coach chrome removed', () => {
  test('no writing-admin.js / WC.bootstrap call', () => {
    assert.doesNotMatch(SRC, /writing-admin\.js/);
    assert.doesNotMatch(SRC, /WC\.(bootstrap|escapeHtml|debounce)\(/);
  });
  test('no aw-* classes (admin-writing.css coupling gone)', () => {
    assert.doesNotMatch(SRC, /className="[^"]*\baw-/);
    assert.doesNotMatch(SRC, /admin-writing\.css/);
  });
  test('no Tailwind CDN / lucide', () => {
    assert.doesNotMatch(SRC, /cdn\.tailwindcss\.com/);
    assert.doesNotMatch(SRC, /lucide/);
  });
});

describe('Sprint 18.3.2 — aver-admin chrome + shared components consumed', () => {
  test('aver-admin chrome under the merged "Lớp & Học viên" parent', () => {
    assert.match(PAGE, /<aver-admin-chrome active="classes" subsection="students">/);
  });
  test('uses shared components (dialog / field / button / status)', () => {
    assert.match(DIR, /import \{ Dialog, Field, messageOf, StatusBanner \} from '@\/components\/admin-directory-ui'/);
    assert.match(DIR, /className="adm-btn-primary/);
    assert.match(DIR, /className="adm-btn-secondary/);
    assert.match(DIR, /className=\{`adm-status-pill/);
  });
  test('no inline colour/bg styles (Pattern #26)', () => {
    assert.doesNotMatch(DIR, /style=\{\{[^}]*color\s*:/);
    assert.doesNotMatch(DIR, /style=\{\{[^}]*background/);
  });
});

describe('Sprint 18.3.2 — features preserved', () => {
  test('admin auth gate', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
  });
  test('CRUD wired (new / edit / archive / save)', () => {
    assert.match(DIR, /window\.api\.post\('\/admin\/students'/);
    assert.match(DIR, /window\.api\.patch\(`\/admin\/students\/\$\{encodeURIComponent\(draft\.id/);
    assert.match(DIR, /window\.api\.delete\(archiveStudentPath\(student\.id/);
    assert.match(DIR, /aria-label=\{`Sửa hồ sơ \$\{student\.full_name\}`\}/);
  });
  test('Writing summary preserved in the profile dialog', () => {
    assert.match(DIR, /\/admin\/writing\/students\/\$\{encodeURIComponent\(student\.id\)\}\/summary/);
    assert.match(DIR, /<span>Tổng bài<\/span>/);
  });
  test('CSV import + New Essay link + search preserved', () => {
    assert.match(DIR, /type="file" accept="\.csv,text\/csv"/);
    assert.match(DIR, /'\/admin\/students\/import'/);
    assert.match(DIR, /href=\{`\/admin\/writing\/new\?student_id=\$\{encodeURIComponent\(student\.id\)\}`\}/);
    assert.match(DIR, /<Field label="Tìm học viên"><input type="search"/);
  });
});

describe('Sprint 18.3.2 — Sprint 18.1 tabs preserved', () => {
  test('"Lớp & Học viên" subtabs intact, students active', () => {
    assert.match(DIR, /<Link href="\/admin\/classes">/);
    assert.match(DIR, /<Link className="is-active" href="\/admin\/students" aria-current="page">/);
  });
});
