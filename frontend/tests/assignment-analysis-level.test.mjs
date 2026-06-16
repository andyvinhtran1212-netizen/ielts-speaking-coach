/**
 * assignment-analysis-level.test.mjs — grading-level PR-2 (FE).
 *
 * The assign create-modal has an L1–L5 picker (default L3) sent in BOTH the
 * individual + fan-out payloads; the level shows read-only on the queue rows
 * (#486) + the grade.html header. Markup/attribute-only — no grade-logic touch.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const ASSIGN = read('pages', 'admin', 'writing', 'assignments.html');
const QUEUE_HTML = read('pages', 'admin', 'writing', 'queue.html');
const QUEUE_JS = read('js', 'admin-writing-queue.js');
const GRADE = read('pages', 'admin', 'writing', 'grade.html');


describe('assign modal — L1–L5 picker (default L3)', () => {
  test('picker present with all 5 levels + L3 selected', () => {
    assert.match(ASSIGN, /id="form-analysis-level"/);
    for (let i = 1; i <= 5; i++) assert.match(ASSIGN, new RegExp(`<option value="${i}"`));
    assert.match(ASSIGN, /<option value="3" selected>/);
  });
  test('reset defaults the picker back to L3', () => {
    assert.match(ASSIGN, /getElementById\('form-analysis-level'\)\.value = '3'/);
  });
  test('analysis_level read + sent in BOTH payloads', () => {
    assert.match(ASSIGN, /var analysisLevel = parseInt\(document\.getElementById\('form-analysis-level'\)\.value, 10\) \|\| 3/);
    // exactly two payloads carry it: individual + fan-out
    assert.equal((ASSIGN.match(/analysis_level:\s*analysisLevel/g) || []).length, 2);
  });
});


describe('read-only level surfaced on queue + grade', () => {
  test('queue row renders an L{n} pill from analysis_level', () => {
    assert.match(QUEUE_JS, /e\.analysis_level/);
    assert.match(QUEUE_JS, /q-lvl/);
    assert.match(QUEUE_JS, /\$\{escapeHtml\(task\)\}\$\{lvl\}/);
    assert.match(QUEUE_HTML, /\.q-lvl \{/);
  });
  test('grade.html header shows a read-only level badge from detail.analysis_level', () => {
    assert.match(GRADE, /id="level-badge"/);
    assert.match(GRADE, /detail\.analysis_level/);
    assert.match(GRADE, /level-badge'\)\.textContent = 'L' \+ lvl/);
  });
  test('grade.html save path untouched (still PATCHes /feedback)', () => {
    assert.match(GRADE, /window\.api\.patch\('\/admin\/writing\/essays\/'\s*\+\s*_essayId\s*\+\s*'\/feedback'/);
  });
});
