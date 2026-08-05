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
    return { skillCell, punctualityCell, lastAcrossSkills };`)(esc, countLabel);
}

const { skillCell, punctualityCell, lastAcrossSkills } = loadHelpers();


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
    // Qua trạng thái chung + renderProgressBanner, KHÔNG ghi thẳng DOM: ghi
    // thẳng sẽ xoá lời cảnh báo của bảng bài hằng ngày (chạy song song).
    assert.match(fn, /_progressNotes = \[/);
    assert.match(fn, /renderProgressBanner\(\)/);
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


describe('% nộp đúng hạn keeps "unknown" apart from "always late"', () => {
  test('a failed ledger read says so', () => {
    assert.match(punctualityCell(null), /không đọc được/);
    assert.doesNotMatch(punctualityCell(null), /%/);
  });

  test('nothing handed in yet is a dash, never 0%', () => {
    const html = punctualityCell({ assigned: 3, submitted: 0, late: 0, missing: 3, on_time_pct: null });
    assert.match(html, /—/);
    assert.doesNotMatch(html, /0%/,
      '0% reads as "always late" for someone who may simply be new');
  });

  test('a rate shows, with overdue work flagged beside it', () => {
    const html = punctualityCell({ assigned: 5, submitted: 4, late: 1, missing: 1, on_time_pct: 75 });
    assert.match(html, /75%/);
    assert.match(html, /1 chưa nộp/);
    assert.match(html, /cl-roster-gap/, 'overdue work is the part worth acting on');
  });

  test('a clean record shows the rate with no alarm', () => {
    const html = punctualityCell({ assigned: 4, submitted: 4, late: 0, missing: 0, on_time_pct: 100 });
    assert.match(html, /100%/);
    assert.doesNotMatch(html, /cl-roster-gap/);
  });

  test('the column exists in the table', () => {
    assert.match(PAGE, /<th>Nộp đúng hạn<\/th>/);
  });
});


// ── hai kiểu hỏng, hai câu khác nhau ─────────────────────────────────────
//
// A skill that failed to load shows "—" and the fix is to reload. A stale
// homework column is the opposite: the numbers ARE there and look canonical,
// but a Reading/Listening hand-in may not be folded in yet. Telling the admin
// to reload would send them chasing a number that is not wrong, just behind.

function loadBanner() {
  const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
  const start = SRC.indexOf('  const DEGRADED_LABEL = {');
  const end = SRC.indexOf("  $('progress-empty')");
  const rb0 = SRC.indexOf('function renderProgressBanner');
  const rb1 = SRC.indexOf('async function loadDailyBoard');
  assert.ok(start !== -1 && end > start && rb0 !== -1 && rb1 > rb0,
    'degraded banner block not found');

  // Băng nay do renderProgressBanner vẽ, gộp ghi chú của CẢ HAI nguồn (tiến độ
  // + bảng bài hằng ngày) — hai lượt gọi chạy song song, bên nào ghi thẳng DOM
  // cũng sẽ xoá lời bên kia. Nên khung phải chạy qua đúng đường ấy.
  return (degraded, boardNote = '') => {
    const node = { hidden: null, textContent: '' };
    const $ = () => node;
    new Function('$', 'degraded', '_boardNote', `
      let _progressNotes = [];
      ${SRC.slice(rb0, rb1)}
      ${SRC.slice(start, end)}
    `)($, degraded, boardNote);
    return node;
  };
}

const banner = loadBanner();

describe('progress banner', () => {
  test('nothing wrong → no banner', () => {
    assert.equal(banner([]).hidden, true);
  });

  test('a failed skill read asks for a reload', () => {
    const n = banner(['listening']);
    assert.equal(n.hidden, false);
    assert.match(n.textContent, /Chưa đọc được số liệu: Listening/);
    assert.match(n.textContent, /Tải lại/);
  });

  test('a stale homework column says stale, not "reload"', () => {
    const n = banner(['homework_stale']);
    assert.equal(n.hidden, false);
    assert.match(n.textContent, /chưa cập nhật/);
    assert.doesNotMatch(n.textContent, /Tải lại/,
      'the numbers are behind, not unreadable — reloading is not the fix');
    assert.doesNotMatch(n.textContent, /homework_stale/,
      'the raw flag name must not reach the screen');
  });

  test('both at once → both sentences', () => {
    const n = banner(['writing', 'homework_stale']);
    assert.match(n.textContent, /Writing/);
    assert.match(n.textContent, /chưa cập nhật/);
  });

  test('ghi chú của bảng bài hằng ngày KHÔNG bị lời của tiến độ xoá mất', () => {
    // /speaking-daily hỏng trước, /progress xong sau — trước đây lời cảnh báo
    // của bảng biến mất, đúng thứ giáo viên cần thấy nhất (codex #931).
    const n = banner([], 'Không đọc được bảng bài hằng ngày: mạng lỗi.');
    assert.equal(n.hidden, false);
    assert.match(n.textContent, /bảng bài hằng ngày/);
  });

  test('cả hai nguồn cùng có chuyện thì nói CẢ HAI', () => {
    const n = banner(['listening'], 'Không đọc được bảng bài hằng ngày: mạng lỗi.');
    assert.match(n.textContent, /Listening/);
    assert.match(n.textContent, /bảng bài hằng ngày/);
  });
});
