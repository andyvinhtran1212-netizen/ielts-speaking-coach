// Admin mock report: a retest flag keeps the completed score report.
// LEGACYJS-0075 W2 retired `admin-mock-report.js`; these now pin the Next
// report (`admin-mock-review-report.tsx`) and `reportSkills` in the model.
// The retired HTML fixture assertion stays (ADR-005).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reportSkills } from '../lib/admin-mock-reviews-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const HTML = readFileSync(join(root, 'public', 'pages', 'admin', 'mock-reviews', 'report.html'), 'utf8');
const NEXT = readFileSync(join(root, 'app', '(authed-admin)/(mock-reviews)', 'admin', 'mock-reviews', 'report', 'admin-mock-review-report.tsx'), 'utf8');

const detail = (requiredSkills, finalBands) => ({ requiredSkills, review: { finalBands } });

describe('admin mock report — retest preserves the completed score report', () => {
  test('the report no longer blocks when a retest flag is true', () => {
    assert.doesNotMatch(NEXT, /needsRetest/);
    assert.doesNotMatch(NEXT, /còn kỹ năng cần test lại/);
    // The only block left is a missing final band, not a retest flag.
    assert.match(NEXT, /Chưa nhập band cuối — chưa thể tạo phiếu báo điểm\./);
    assert.match(NEXT, /window\.print\(\)/);
  });

  test('a retest renders a visible instruction while keeping this result official', () => {
    assert.match(NEXT, /const retestSkills = detail \? Object\.keys\(LABEL\)\.filter\(\(skill\) => detail\.review\.retestFlags\[skill\] === true\) : \[\];/);
    assert.match(NEXT, /<strong>Cần test lại: \{retestSkills\.map\(\(skill\) => LABEL\[skill\]\)\.join\(', '\)\}<\/strong>/);
    assert.match(NEXT, /Kết quả trên phiếu vẫn là kết quả chính thức của lần mock test này\./);
  });

  test('no flags keep the banner out of the page', () => {
    assert.match(NEXT, /\{retestSkills\.length > 0 && <aside className="mrr-report-retest" role="note">/);
    assert.doesNotMatch(NEXT, /Object\.values\(detail\.review\.retestFlags\)\.some\(Boolean\)/);
  });

  test('the report owns a semantic retest banner', () => {
    assert.match(HTML, /id="rp-retest" class="rp-retest hidden" role="note"/);
    assert.match(NEXT, /className="mrr-report-retest" role="note"/);
  });

  test('teacher-assessed live Speaking stays visible outside the LRW exam config', () => {
    assert.deepEqual(
      reportSkills(detail(['listening', 'reading', 'writing'], { listening: 6, reading: 5.5, writing: 6, speaking: 5.5, overall: 6 })),
      ['listening', 'reading', 'writing', 'speaking'],
    );
    assert.match(NEXT, /const skills = reportSkills\(detail\) as string\[\];/);
  });

  test('an LRW-only result does not invent a Speaking card', () => {
    assert.deepEqual(
      reportSkills(detail(['listening', 'reading', 'writing'], { listening: 6, reading: 5.5, writing: 6, overall: 6 })),
      ['listening', 'reading', 'writing'],
    );
  });
});
