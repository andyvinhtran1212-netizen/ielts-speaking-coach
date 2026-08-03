/**
 * Bảng tổng kết nộp bài — đọc ra SỰ VẮNG MẶT.
 *
 * Việc của bảng này không phải liệt kê ai đã nộp; giữa lớp 30 em, 26 dấu tick
 * là nhiễu che mất 4 chỗ trống. Nó phải trả lời "ai chưa nộp" trong một cái
 * liếc, và phải phân biệt được TRƯỚC hạn (số còn đổi) với SAU hạn (đã chốt).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');
const CSS = readFileSync(join(HERE, '..', 'public', 'css', 'speaking-assignment.css'), 'utf8');
const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');

function load() {
  const start = SRC.indexOf('const TALLY_WHEN = {');
  const end = SRC.indexOf('async function openTally(');
  assert.ok(start !== -1 && end > start, 'tally block not found');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dueLabel = (iso) => (iso ? '19:00 · 03/08' : 'không hạn');
  return new Function('esc', 'dueLabel', `${SRC.slice(start, end)}
    return { renderTally, tallyRow, hhmm };`)(esc, dueLabel);
}

const { renderTally, tallyRow, hhmm } = load();

const DUE = '2026-08-03T19:00:00+07:00';

function tally(over = {}) {
  return {
    assignment: { id: 'a1', title: 'Bài hôm nay', skill: 'speaking', due_at: DUE },
    sealed: false,
    students: [],
    counts: { total: 0, submitted: 0, late: 0, missing: 0, no_account: 0 },
    ...over,
  };
}

describe('trạng thái từng dòng', () => {
  test('đã nộp đúng hạn hiện giờ nộp', () => {
    const html = tallyRow({ name: 'An', status: 'submitted',
      submitted_at: '2026-08-03T11:00:00+00:00', score: 6.5 });
    assert.match(html, /data-status="submitted"/);
    assert.match(html, /18:00/);           // 11:00Z = 18:00 giờ VN
    assert.match(html, />6\.5</);
  });

  test('nộp trễ được nói rõ là trễ, không chỉ đổi màu', () => {
    const html = tallyRow({ name: 'Bình', status: 'late',
      submitted_at: '2026-08-03T13:00:00+00:00', score: null });
    assert.match(html, /trễ/);
  });

  test('chưa chấm hiện dấu gạch, KHÔNG hiện 0.0', () => {
    // 0.0 là một ĐIỂM SỐ. Hiện nó nghĩa là nói học viên bị 0 điểm.
    const html = tallyRow({ name: 'Cường', status: 'submitted',
      submitted_at: '2026-08-03T11:00:00+00:00', score: null });
    assert.match(html, /data-empty="true"/);
    assert.match(html, />—</);
    assert.doesNotMatch(html, /0\.0/);
  });

  test('điểm 0 THẬT vẫn hiện là 0.0', () => {
    const html = tallyRow({ name: 'D', status: 'submitted',
      submitted_at: '2026-08-03T11:00:00+00:00', score: 0 });
    assert.match(html, />0\.0</);
    assert.match(html, /data-empty="false"/);
  });

  test('chưa kích hoạt tài khoản KHÁC chưa nộp', () => {
    // Em ấy chưa từng thấy bài — nhắc nộp là nhắc nhầm người.
    const html = tallyRow({ name: 'E', status: 'no-account', submitted_at: null, score: null });
    assert.match(html, /data-status="no-account"/);
    assert.match(html, /chưa kích hoạt/);
  });

  test('trước hạn là "chưa nộp", sau hạn là "không nộp"', () => {
    assert.match(tallyRow({ name: 'F', status: 'pending' }), /chưa nộp/);
    assert.match(tallyRow({ name: 'G', status: 'missing' }), /không nộp/);
  });
});

describe('giờ đọc theo giờ Việt Nam', () => {
  test('không đọc theo múi giờ máy admin', () => {
    // Hạn là 19:00 giờ VN; một giờ nộp đọc theo múi khác sẽ mâu thuẫn với chính
    // cột "trễ" ngay bên cạnh.
    assert.equal(hhmm('2026-08-03T11:00:00+00:00'), '18:00');
    assert.match(SRC, /timeZone:\s*'Asia\/Ho_Chi_Minh'/);
  });

  test('giờ hỏng không làm vỡ cả bảng', () => {
    assert.equal(hhmm('hôm nào đó'), '');
  });
});

describe('trước hạn và sau hạn phải phân biệt được', () => {
  test('trước hạn: đang nhận bài, danh sách còn đổi', () => {
    const html = renderTally(tally({ counts: { total: 30, submitted: 24, missing: 0 } }));
    assert.match(html, /data-state="live"/);
    assert.match(html, /Đang nhận bài/);
    assert.match(html, /còn đổi/);
  });

  test('sau hạn: đã chốt, và nói rõ không nhận bài nữa', () => {
    const html = renderTally(tally({
      sealed: true, counts: { total: 30, submitted: 24, missing: 6 } }));
    assert.match(html, /data-state="sealed"/);
    assert.match(html, /Đã chốt/);
    assert.match(html, /6 em không nộp/);
    assert.match(html, /không nhận bài nữa/);
  });

  test('trạng thái là một CHỮ, không chỉ một màu', () => {
    // Người mù màu vẫn phải đọc được khác biệt quan trọng nhất trên màn hình.
    const live = renderTally(tally());
    const sealed = renderTally(tally({ sealed: true }));
    assert.notEqual(
      live.match(/av-tally__state">([^<]+)</)[1],
      sealed.match(/av-tally__state">([^<]+)</)[1],
    );
  });

  test('số chưa kích hoạt được nói riêng', () => {
    const html = renderTally(tally({ counts: { total: 30, submitted: 24, no_account: 3 } }));
    assert.match(html, /3 em chưa kích hoạt/);
  });

  test('sổ chưa đối chiếu được thì nói ra', () => {
    const html = renderTally(tally({ homework_stale: true }));
    assert.match(html, /chưa đối chiếu được/i);
  });
});

describe('style và markup', () => {
  test('cột mép trái đọc dọc: chưa nộp mang mực, đã nộp im lặng', () => {
    assert.match(CSS, /\.av-tally__row\[data-status='missing'\] \.av-tally__mark\s*\{[^}]*background:\s*var\(--av-accent\)/);
    assert.match(CSS, /\.av-tally__mark\s*\{[^}]*transform:\s*scaleY\(0\.35\)/);
  });

  test('trước hạn nét đứt, sau hạn nét liền', () => {
    assert.match(CSS, /\.av-tally\[data-state='live'\] \.av-tally__rows\s*\{[^}]*dashed/);
  });

  test('trang admin có modal và nạp CSS đúng một lần', () => {
    assert.match(HTML, /id="tally-modal"/);
    assert.equal((HTML.match(/speaking-assignment\.css/g) || []).length, 1);
  });
});
