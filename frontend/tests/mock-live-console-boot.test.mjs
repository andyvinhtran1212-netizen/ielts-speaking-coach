/**
 * mock-live-console-boot.test.mjs — the invigilator console must stay LIVE.
 *
 * A bad ?exam_id= (unpublished, archived, typo) shows an error and asks the
 * admin to pick from the list. In the retired script, returning early there
 * wired only the picker: the board then loaded ONCE on selection and silently
 * went stale for the rest of the exam (Codex review, PR #833).
 *
 * Source-sentinels on the Next console. LEGACYJS-0075 W2 ported these from the
 * retired `admin-mock-live.js`; the Next owner wires the picker in JSX and the
 * polling in an effect keyed on the chosen exam, so a bad link cannot leave the
 * board unpolled.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIVE = readFileSync(join(__dirname, '..', 'app', '(authed-admin-mock-live)', 'admin', 'mock-live',
  'admin-mock-live.tsx'), 'utf8');

describe('mock-live console — a bad exam link still leaves a live board', () => {
  test('an unknown exam id is named and the picker stays usable', () => {
    assert.match(LIVE, /Kỳ thi trong URL chưa publish, đã archive hoặc không tồn tại\. Chọn lại từ danh sách\./);
    assert.match(LIVE, /<select value=\{examId\} onChange=\{\(event\) => changeExam\(event\.target\.value\)\}/);
  });

  test('polling follows the chosen exam, so picking one starts it', () => {
    assert.match(LIVE, /if \(!examId \|\| !autoRefresh\) return;\n\s+const timer = window\.setInterval\(/);
    assert.match(LIVE, /\}, \[autoRefresh, examId, loadSnapshot\]\);/);
  });

  test('polling cannot stack: each effect clears its own interval', () => {
    assert.match(LIVE, /\}, 5_000\);\n\s+return \(\) => window\.clearInterval\(timer\);/);
  });
});

describe('mock-live console — the pause has no clock', () => {
  test('a collected-but-not-advanced section shows the break, not a countdown', () => {
    // activeSection deliberately does not change during the break.
    assert.match(LIVE, /const paused = Boolean\(snapshot && snapshot\.exam\.examMode !== 'retake' && snapshot\.exam\.collectedSection === snapshot\.exam\.activeSection\);/);
    assert.match(LIVE, /const seconds = paused \? null : clockSeconds\(/);
    assert.match(LIVE, /paused \? `Đã thu \$\{LABEL\[snapshot\.exam\.activeSection\]\} · đang nghỉ`/);
  });

  test('the local tick stops when the server reports no time left', () => {
    assert.match(LIVE, /snapshot\.exam\.sectionTimeLeftSeconds == null\) return;\n\s+const timer = window\.setInterval\(\(\) => setClockNow\(Date\.now\(\)\), 1_000\);/);
  });
});

describe('mock-live console — the recovery sweep is reachable', () => {
  test('recollect sends from_section, which the endpoint requires', () => {
    assert.match(LIVE, /&from_section=\$\{encodeURIComponent\(exam\.activeSection\)\}/);
  });
});

describe('mock-live console — Advance follows the persisted sweep marker', () => {
  test('Advance is ready only before the start or after the matching sweep marker', () => {
    assert.match(LIVE, /const readyToAdvance = Boolean\(snapshot && \(\n\s+snapshot\.exam\.activeSection === 'not_started'\n\s+\|\| \(paused && snapshot\.exam\.collectionSweepCompletedSection === snapshot\.exam\.activeSection\)\n\s+\)\);/);
  });

  test('an unfinished sweep says so and keeps Advance disabled', () => {
    assert.match(LIVE, /const collecting = Boolean\(paused && snapshot\?\.exam\.collectionSweepCompletedSection !== snapshot\?\.exam\.activeSection\);/);
    assert.match(LIVE, /disabled=\{Boolean\(busyKey\) \|\| snapshotStale \|\| !readyToAdvance\}>\{collecting \? 'Đang thu bài…'/);
  });

  test('Collect is offered while a section runs, and not during the break', () => {
    assert.match(LIVE, /snapshot\.exam\.activeSection !== 'done' && snapshot\.exam\.activeSection !== 'not_started' && !paused && <button[^>]*onClick=\{\(\) => void collect\(\)\}/);
  });
});
