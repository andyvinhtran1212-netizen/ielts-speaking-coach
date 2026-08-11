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

function load({ actions = [], fail = null, holds = [], hasMore = false,
               nextBefore = null } = {}) {
  const start = SRC.indexOf('/* ── Nhật ký thao tác ');
  const end = SRC.indexOf('/* ── Đổi hạn nộp ');
  assert.ok(start !== -1 && end > start, 'không tìm thấy khối nhật ký');

  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '' });
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // `holds[i]` giữ lượt đọc thứ i lơ lửng — để dựng cảnh hai lượt chồng nhau.
  //
  // Dữ liệu phải được CHỤP LÚC GỌI, không phải lúc trả về: nếu cả hai lượt cùng
  // đọc một biến ở thời điểm resolve thì chúng trả về y hệt nhau, và cuộc đua
  // trở nên vô hình — bản test đầu của tôi đúng như thế, nên phá chốt mà vẫn
  // xanh.
  let calls = 0;
  const api = {
    async get() {
      const i = calls++;
      const payload = typeof actions === 'function' ? actions() : actions;
      if (holds[i]) await holds[i];
      if (fail) throw fail;
      return { actions: payload, has_more: !!hasMore, next_before: nextBefore };
    },
  };

  const fn = new Function('$', 'api', 'esc', '_cohortId',
    `${SRC.slice(start, end)}
     return { loadActionLog, logWhen, logDetail, logDue };`)(el, api, esc, 'coh-1');
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

  test('HẠN NỘP trong nhật ký cũng theo giờ Việt Nam, không theo giờ máy', () => {
    // Cùng MỘT dòng mà giờ thao tác theo giờ VN còn hạn nộp theo giờ bản địa
    // thì 19:00 hiện thành 05:00, không nhãn nào nói ra.
    const { logDue } = load();
    // `vi-VN` xếp giờ trước ngày ("19:00 09/08/2026") — giống hệt `dueText()`
    // đang dùng ở bảng bài giao, nên hai chỗ đọc ra cùng một dạng.
    assert.equal(logDue('2026-08-09T19:00:00+07:00'), '19:00 09/08/2026');
    assert.equal(logDue(null), 'không hạn');
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

  test('bài giao đã bị xoá thì vẫn gọi được tên nhờ bản chép', async () => {
    // Khoá ngoại là ON DELETE SET NULL: xoá bài giao xong `assignment_id` thành
    // NULL, mặt đọc hết đường tra tên sống. Bản chép lúc thao tác là thứ duy
    // nhất còn lại (codex #1010).
    const { loadActionLog, el } = load({
      actions: [{ ...DUE_ROW, assignment_id: null, assignment_title: 'Grammar 1' }],
    });
    await loadActionLog();
    assert.match(el('action-log-body').innerHTML, /Grammar 1/);
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

describe('nhật ký dài hơn một trang', () => {
  test('còn dòng cũ hơn thì NÓI RA và mời bấm tiếp', async () => {
    const { loadActionLog, el } = load({
      actions: [DUE_ROW], hasMore: true, nextBefore: '2026-08-08T09:00:00Z',
    });
    await loadActionLog();
    const html = el('action-log-body').innerHTML;
    assert.match(html, /Xem thao tác cũ hơn/);
    assert.match(html, /data-log-more="2026-08-08T09:00:00Z"/);
  });

  test('hết thật thì KHÔNG mời bấm tiếp', async () => {
    const { loadActionLog, el } = load({ actions: [DUE_ROW], hasMore: false });
    await loadActionLog();
    assert.ok(!/Xem thao tác cũ hơn/.test(el('action-log-body').innerHTML));
  });

  test('trang sau NỐI vào cuối, không vứt phần đang đọc', async () => {
    const { loadActionLog, el } = load({ actions: [DUE_ROW], hasMore: true,
                                         nextBefore: '2026-08-08T09:00:00Z' });
    await loadActionLog();
    await loadActionLog('2026-08-08T09:00:00Z');
    const rows = el('action-log-body').innerHTML.match(/cl-log__row/g) || [];
    assert.equal(rows.length, 2, 'trang sau phải nối, không thay');
  });

  test('nút "xem thêm" của trang trước không nằm lại giữa danh sách', async () => {
    const { loadActionLog, el } = load({ actions: [DUE_ROW], hasMore: true,
                                         nextBefore: '2026-08-08T09:00:00Z' });
    await loadActionLog();
    await loadActionLog('2026-08-08T09:00:00Z');
    const btns = el('action-log-body').innerHTML.match(/data-log-more/g) || [];
    assert.equal(btns.length, 1, 'chỉ được còn MỘT nút, ở cuối');
  });
});

describe('hai lượt đọc chồng nhau', () => {
  test('lượt CŨ về sau KHÔNG được đè lên bản mới', async () => {
    // Mở khung xong bấm luôn một thao tác: lượt đầu còn đang bay, lượt sau về
    // trước và vẽ dòng mới — rồi lượt đầu về sau và đè lại bằng bản CŨ (nhật ký
    // rỗng), mất đúng dòng vừa tạo.
    let release;
    const gate = new Promise((r) => { release = r; });
    let batch = [];                                  // lượt 1 chụp: rỗng
    const h = load({ holds: [gate], actions: () => batch });

    const slow = h.loadActionLog();                  // treo ở cổng
    batch = [DUE_ROW];                               // thao tác vừa xảy ra
    await h.loadActionLog();                         // lượt 2 về TRƯỚC, vẽ dòng mới
    assert.match(h.el('action-log-body').innerHTML, /Grammar 1/);

    release();
    await slow;                                      // lượt 1 về SAU
    assert.match(h.el('action-log-body').innerHTML, /Grammar 1/,
      'bản cũ đã đè lên bản mới — mất đúng dòng người ta vừa tạo');
    assert.ok(!/Chưa có thao tác nào/.test(h.el('action-log-body').innerHTML));
  });
});

describe('dây nối ở trang', () => {
  test('mở khung là nạp, mở lại là nạp lại', () => {
    // Vừa đổi hạn xong mà nhật ký hiện bản cũ thì nó nói sai về chính thao tác
    // vừa rồi.
    assert.match(SRC, /addEventListener\('toggle'[\s\S]{0,80}loadActionLog\(\)/);
  });

  test('khung ĐANG MỞ được vẽ lại sau mỗi thao tác ghi', () => {
    // `toggle` chỉ bắn khi đóng/mở, nên khung đang mở sẽ đứng nguyên bản cũ
    // ngay sau khi vừa đổi hạn — thiếu đúng dòng người ta vừa tạo.
    assert.match(SRC, /function refreshActionLogIfOpen\(\)[\s\S]{0,160}box\.open\) loadActionLog\(\)/);
    const calls = SRC.match(/refreshActionLogIfOpen\(\);/g) || [];
    assert.equal(calls.length, 2, 'cả đổi hạn lẫn trả bài đều phải vẽ lại');
  });

  test('hai đường ghi đều nói ra khi nhật ký hụt', () => {
    const hits = SRC.match(/audit_logged === false/g) || [];
    assert.equal(hits.length, 2, 'cả đổi hạn lẫn trả bài đều phải nói');
    assert.match(SRC, /KHÔNG ghi được vào nhật ký thao tác/);
  });
});
