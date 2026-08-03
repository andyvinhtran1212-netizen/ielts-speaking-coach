/**
 * admin-classes.js — ma trận tiến độ 4 kỹ năng (GĐ 4).
 *
 * Executes the cell renderer rather than matching its source: what can be wrong
 * here is what a cell MEANS. "—" for a skill whose query failed and "—" for a
 * student who genuinely has not started look identical on screen, and only one
 * of them is true.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const PAGE = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');

const codeOnly = (s) => s.replace(/\/\/[^\n]*/g, '');

function loadHelpers() {
  const start = SRC.indexOf('function skillCell');
  const end = SRC.indexOf('function renderProgress');
  assert.ok(start !== -1 && end > start, 'progress helpers not found');
  const esc = (s) => String(s == null ? '' : s);
  const countLabel = (n) => String(n);
  return new Function('esc', 'countLabel', `${SRC.slice(start, end)}
    return { skillCell, lastAcrossSkills };`)(esc, countLabel);
}

const { skillCell, lastAcrossSkills } = loadHelpers();


describe('a skill cell keeps "unknown" apart from "nothing yet"', () => {
  test('a failed skill says so — it must never read as zero', () => {
    const html = skillCell(null);
    assert.match(html, /không đọc được/);
    assert.doesNotMatch(html, /lượt/);
    assert.doesNotMatch(html, /^—$/);
  });

  test('genuinely nothing yet is a plain dash', () => {
    const html = skillCell({ attempts: 0, last_band: null, last_activity: null });
    assert.match(html, /—/);
    assert.doesNotMatch(html, /không đọc được/);
  });

  test('attempts show with the last real band', () => {
    const html = skillCell({ attempts: 4, last_band: 6.5, last_activity: '2026-08-01' });
    assert.match(html, /4 lượt/);
    assert.match(html, /band 6.5/);
  });

  test('attempts with no band yet show the count alone', () => {
    const html = skillCell({ attempts: 2, last_band: null, last_activity: '2026-08-01' });
    assert.match(html, /2 lượt/);
    assert.doesNotMatch(html, /band/);
  });

  test('undefined is treated as unknown, not as empty', () => {
    assert.match(skillCell(undefined), /không đọc được/);
  });
});


describe('last activity is the newest across all four skills', () => {
  test('picks the latest stamp', () => {
    assert.equal(lastAcrossSkills({
      speaking: { last_activity: '2026-08-01' },
      writing: { last_activity: '2026-08-05' },
      reading: { last_activity: '2026-08-03' },
      listening: { last_activity: null },
    }), '2026-08-05');
  });

  test('a failed (null) skill does not break the scan', () => {
    assert.equal(lastAcrossSkills({
      speaking: null,
      writing: { last_activity: '2026-08-02' },
    }), '2026-08-02');
  });

  test('nothing anywhere yields nothing', () => {
    assert.equal(lastAcrossSkills({ speaking: null, writing: null }), '');
    assert.equal(lastAcrossSkills({}), '');
  });
});


describe('the tab reports failure instead of an empty class', () => {
  const fn = codeOnly(SRC.slice(SRC.indexOf('async function loadProgress'),
                                SRC.indexOf('// ── Sub-tabs')));

  test('a failed load shows an error and hides the table', () => {
    assert.match(fn, /progress-degraded/);
    assert.match(fn, /Không đọc được tiến độ lớp/);
    assert.match(fn, /\$\('progress-table-wrap'\)\.hidden = true/);
    assert.match(fn, /\$\('progress-empty'\)\.hidden = true/,
      '"chưa có học viên" must not stand in for a failed request');
  });

  test('a failure releases the once-only latch so the tab can retry', () => {
    assert.match(fn, /_progressLoaded = false/);
  });
});


describe('the panel is wired like the others', () => {
  test('the tab and panel exist', () => {
    assert.match(PAGE, /id="tab-progress"/);
    assert.match(PAGE, /id="panel-progress"/);
  });

  test('it loads lazily, on first open only', () => {
    const fn = codeOnly(SRC.slice(SRC.indexOf('function showPanel'),
                                  SRC.indexOf('function bindModalBackdrop')));
    assert.match(fn, /'progress'/);
    assert.match(fn, /_progressLoaded/);
  });

  test('the four skill columns are all present', () => {
    for (const s of ['Speaking', 'Writing', 'Reading', 'Listening']) {
      assert.match(PAGE, new RegExp(`<th>${s}</th>`));
    }
  });
});


describe('a roster change invalidates the cached progress (Codex review)', () => {
  // The tab loads once and caches. Adding or removing a student made that cache
  // wrong, and reopening the tab showed the old class until a full page reload.
  const between = (from, to) => codeOnly(SRC.slice(SRC.indexOf(from), SRC.indexOf(to)));

  test('adding a student invalidates it', () => {
    const fn = between('async function submitMember', 'function removeMember');
    assert.match(fn, /invalidateProgress\(\)/);
  });

  test('removing a student invalidates it too', () => {
    // Pinned separately: the two mutations are different functions and fixing
    // one is exactly the shape of miss this whole programme kept repeating.
    const fn = between('function removeMember', '// ── Chi tiết lớp: buổi học');
    assert.match(fn, /invalidateProgress\(\)/);
  });

  test('invalidation clears the latch AND the stale rows', () => {
    const fn = between('function invalidateProgress', 'async function loadProgress');
    assert.match(fn, /_progressLoaded = false/);
    assert.match(fn, /_progress = \{ students: \[\], degraded: \[\] \}/,
      'leaving the old rows would flash the previous class on reopen');
  });

  test('an open tab refreshes immediately rather than on next open', () => {
    const fn = between('function invalidateProgress', 'async function loadProgress');
    assert.match(fn, /panel-progress'\)\.hidden/);
    assert.match(fn, /loadProgress\(\)/);
  });
});
