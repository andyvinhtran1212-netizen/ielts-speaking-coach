import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  filterInstructors,
  formatInstructorCost,
  formatInstructorCount,
  instructorLabel,
  instructorWorkspaceHref,
  normalizeInstructorsPayload,
  summarizeInstructors,
} from '../lib/admin-instructors-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-instructors)', 'admin', 'instructors', 'page.tsx');
const CLIENT = read('app', '(authed-admin-instructors)', 'admin', 'instructors', 'admin-instructors.tsx');
const LAYOUT = read('app', '(authed-admin-instructors)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-instructors-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const WORKSPACE = read('public', 'pages', 'instructor', 'index.html');
const CONFIG = read('next.config.ts');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/admin/instructors native route contract', () => {
  test('owns the canonical route behind the backend-owned admin gate', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="instructors">/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/instructors['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'instructors.html')));
  });

  test('uses the canonical read only and retains stale data after refresh failure', () => {
    assert.match(CLIENT, /window\.api\.get<unknown>\('\/admin\/instructors'\)/);
    assert.match(CLIENT, /requestId === sequence\.current/);
    assert.match(CLIENT, /return \(\) => \{ sequence\.current \+= 1; \}/);
    assert.match(CLIENT, /Không thể làm mới — đang giữ dữ liệu cũ/);
    assert.doesNotMatch(CLIENT, /window\.api\.(post|put|patch|delete)/);
  });

  test('cuts navigation over to native ownership while preserving rollback HTML', () => {
    assert.match(CHROME, /section: 'instructors', label: 'Giảng viên', href: '\/admin\/instructors'/);
    assert.match(WORKSPACE, /href="\/admin\/instructors"[^>]*>Thoát<\/a>/);
    assert.doesNotMatch(CHROME, /section: 'instructors'[^\n]*href: '\/pages\/admin\/instructors\.html'/);
  });

  test('pins responsive UI and CI execution for component-only and CSS-only changes', () => {
    assert.match(LAYOUT, /admin-instructors-next\.css/);
    assert.match(CSS, /calc\(100vw - 328px\)/);
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:440px\)/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-instructors\)\/\*\*/);
    assert.match(WORKFLOW, /frontend\/public\/css\/admin-instructors-next\.css/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-instructors-flow\.mjs/);
  });
});

describe('admin instructor payload truth', () => {
  const payload = normalizeInstructorsPayload([
    { instructor_id: 'gv-1', email: 'teacher@example.com', display_name: 'Cô An', students: 3, prompts: 2, graded: 7, regraded: 1, regrade_events: 4, tokens: 1234, cost_usd: .25 },
    { instructor_id: 'gv-2', email: null, display_name: null, students: 1, prompts: 0, graded: 0, regraded: 0, regrade_events: 0, tokens: 0, cost_usd: 0 },
    { instructor_id: 'gv-1', students: 0, prompts: 0, graded: 0, regraded: 0, regrade_events: 0, tokens: 0, cost_usd: 0 },
    { instructor_id: 'broken', students: -1 },
  ]);

  test('keeps every backend metric distinct and reports invalid or duplicate rows', () => {
    assert.ok(payload);
    assert.equal(payload.rows.length, 2);
    assert.equal(payload.malformedCount, 2);
    assert.equal(payload.rows[0].regraded, 1);
    assert.equal(payload.rows[0].regradeEvents, 4);
    assert.equal(payload.rows[0].tokens, 1234);
  });

  test('rejects a broken top-level contract instead of presenting an empty directory', () => {
    assert.equal(normalizeInstructorsPayload({ rows: [] }), null);
    assert.equal(normalizeInstructorsPayload(null), null);
  });

  test('rejects an impossible regrade relationship instead of showing conflicting facts', () => {
    const impossible = normalizeInstructorsPayload([{
      instructor_id: 'gv-impossible', students: 0, prompts: 0, graded: 0,
      regraded: 2, regrade_events: 1, tokens: 0, cost_usd: 0,
    }]);
    assert.ok(impossible);
    assert.equal(impossible.rows.length, 0);
    assert.equal(impossible.malformedCount, 1);
  });

  test('summarizes canonical rows without inventing instructor attribution', () => {
    const summary = summarizeInstructors(payload.rows);
    assert.deepEqual(summary, { instructors: 2, students: 4, graded: 7, costUsd: .25 });
    assert.equal(formatInstructorCount(1234), '1.234');
    assert.equal(formatInstructorCost(.25), '$0.2500');
  });

  test('searches identity fields and constructs the single sanctioned impersonation target', () => {
    assert.equal(filterInstructors(payload.rows, 'TEACHER@').length, 1);
    assert.equal(filterInstructors(payload.rows, 'gv-2').length, 1);
    assert.equal(instructorLabel(payload.rows[1]), 'gv-2');
    assert.equal(instructorWorkspaceHref('gv/a b'), '/pages/instructor/index.html?as_instructor=gv%2Fa%20b');
  });
});
