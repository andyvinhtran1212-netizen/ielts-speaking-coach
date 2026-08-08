/**
 * Nhật ký thao tác của giáo viên — mặt đọc.
 *
 * Đổi hạn (#1005) và Trả bài (#1000) đều sửa thứ học viên nhìn thấy. Nhật ký
 * này tồn tại để ba tháng sau còn trả lời được "ai đổi, lúc nào, từ gì sang gì"
 * khi một em hỏi vì sao bài mình thành nộp trễ — nên hai điều phải đúng:
 *
 *   · dòng nhật ký nói được TRƯỚC → SAU, không chỉ "đã có người đổi";
 *   · đọc HỎNG phải nói ra, vì một danh sách rỗng đọc ra là "chưa ai đụng gì".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');

function load({ actions = [], fail = null } = {}) {
  const start = SRC.indexOf('/* ── Nhật ký thao tác ');
  const end = SRC.indexOf('/* ── Đổi hạn nộp ');
  assert.ok(start !== -1 && end > start, 'không tìm thấy khối nhật ký');

  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '' });
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const api = { async get() { if (fail) throw fail; return { actions }; } };
  const dueText = (d) => (d ? new Date(d).toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }) : 'không hạn');

  const fn = new Function('$', 'api', 'esc', 'dueText', '_cohortId',
    `${SRC.slice(start, end)}
     return { loadActionLog, logWhen, logDetail };`)(el, api, esc, dueText, 'coh-1');
  return { ...fn, el };
}

const DUE_ROW = {
  id: 'lg1', action: 'due_change', created_at: '2026-08-08T12:03:00Z',
  actor_email: 'co.giao@averlearning.com', assignment_title: 'Grammar 1',
  student_name: null,
  details: {
    previous_due_at: '2026-08-07T19:00:00+07:00',
    due_at: '2026-08-09T19:00:00+07:00',
    flips: { to_ontime: 3, to_late: 0 },
  },
};

const RETURN_ROW = {
  id: 'lg2', action: 'return_work', created_at: '2026-08-08T01:20:00Z',
  actor_email: 'co.giao@averlearning.com', assignment_title: 'Grammar 1',
  student_name: 'Lê Ngọc Hà Linh',
  details: { artifact_kind: 'course_writing', draft_restored: 10, score_cleared: false },
};

describe('dòng nhật ký nói được TRƯỚC → SAU', () => {
  test('đổi hạn: hiện cả hai đầu và số hồ sơ bị viết lại', async () => {
    const { loadActionLog, el } = load({ actions: [DUE_ROW] });
    await loadActionLog();
    const html = el('action-log-body').innerHTML;
    assert.match(html, /đổi hạn nộp/);
    assert.match(html, /Grammar 1/);
    assert.match(html, /→/, 'thiếu một đầu thì không đọc lại được thao tác');
    assert.match(html, /3 lượt nộp trễ thành đúng hạn/);
    assert.match(html, /co\.giao@averlearning\.com/);
  });

  test('trả bài: nêu tên em ấy và em ấy mở ra thấy gì', async () => {
    const { loadActionLog, el } = load({ actions: [RETURN_ROW] });
    await loadActionLog();
    const html = el('action-log-body').innerHTML;
    assert.match(html, /trả bài/);
    assert.match(html, /Lê Ngọc Hà Linh/);
    assert.match(html, /10 câu được đưa lại vào ô nhập/);
  });

  test('trả bài mà không khôi phục được câu nào thì nói thẳng', async () => {
    const { loadActionLog, el } = load({
      actions: [{ ...RETURN_ROW, details: { draft_restored: 0 } }],
    });
    await loadActionLog();
    assert.match(el('action-log-body').innerHTML, /KHÔNG khôi phục được câu nào/);
  });

  test('giờ hiện theo giờ Việt Nam', () => {
    const { logWhen } = load();
    // 12:03 UTC = 19:03 giờ VN. Đọc theo giờ máy (CI chạy UTC) sẽ ra 12:03.
    assert.match(logWhen('2026-08-08T12:03:00Z'), /19:03/);
  });

  test('nội dung do người khác nhập được thoát HTML', async () => {
    const { loadActionLog, el } = load({
      actions: [{ ...RETURN_ROW, student_name: '<img src=x onerror=alert(1)>' }],
    });
    await loadActionLog();
    const html = el('action-log-body').innerHTML;
    assert.ok(!html.includes('<img'), 'tên học viên là dữ liệu, không phải thẻ');
    assert.match(html, /&lt;img/);
  });
});

describe('đọc hỏng KHÁC HẲN chưa ai đụng gì', () => {
  test('lỗi mạng hiện thành lời báo, không thành danh sách rỗng', async () => {
    const { loadActionLog, el } = load({ fail: new Error('mạng hỏng') });
    await loadActionLog();
    const html = el('action-log-body').innerHTML;
    assert.match(html, /Không đọc được nhật ký/);
    assert.match(html, /mạng hỏng/);
    assert.ok(!/Chưa có thao tác nào/.test(html));
  });

  test('rỗng THẬT thì nói là rỗng', async () => {
    const { loadActionLog, el } = load({ actions: [] });
    await loadActionLog();
    assert.match(el('action-log-body').innerHTML, /Chưa có thao tác nào/);
  });
});

describe('dây nối ở trang', () => {
  test('mở khung là nạp, mở lại là nạp lại', () => {
    // Vừa đổi hạn xong mà nhật ký hiện bản cũ thì nó nói sai về chính thao tác
    // vừa rồi.
    assert.match(SRC, /addEventListener\('toggle'[\s\S]{0,80}loadActionLog\(\)/);
  });

  test('hai đường ghi đều nói ra khi nhật ký hụt', () => {
    const hits = SRC.match(/audit_logged === false/g) || [];
    assert.equal(hits.length, 2, 'cả đổi hạn lẫn trả bài đều phải nói');
    assert.match(SRC, /KHÔNG ghi được vào nhật ký thao tác/);
  });
});
