/**
 * Đổi hạn nộp trong trang quản trị.
 *
 * Ngày 07/08 muốn dời hạn Grammar 1 phải viết SQL rồi chạy tay trên máy chủ
 * thật — và cái thiếu ấy còn khoá luôn nút Trả bài, vì trả bài đòi bài giao còn
 * nhận bài. Ba tính chất được ghim ở đây, cả ba đều hỏng lặng nếu sai:
 *
 *   · giờ đọc và hiện theo GIỜ VIỆT NAM, không theo múi giờ máy đang mở trang;
 *   · lần bấm ĐẦU không mang cờ xác nhận — để máy chủ còn kịp đếm và từ chối;
 *   · máy chủ từ chối kèm con số thì màn hình phải NÓI RA con số ấy, không đóng
 *     hộp, và chỉ lần bấm thứ hai mới mang cờ xác nhận.
 *
 * Chạy THẬT các hàm ấy với DOM/api giả: đây là chuyện của luồng chạy, và một
 * biểu thức chính quy trên mã nguồn không phân biệt được "có gửi cờ" với "gửi
 * cờ đúng lúc".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');

const DUE = '2026-08-07T19:00:00+07:00';

function load({ patchFails = null, homework = null } = {}) {
  const start = SRC.indexOf('/* ── Đổi hạn nộp ');
  const end = SRC.indexOf('let _bfPick');
  assert.ok(start !== -1 && end > start, 'không tìm thấy khối đổi hạn — module bị dựng lại?');

  const els = {};
  const el = (id) => (els[id] = els[id] || {
    id, value: '', textContent: '', innerHTML: '', hidden: false,
    focus() { this.focused = true; },
  });
  const seen = { patches: [], toasts: [], reloads: 0 };

  const box = { fail: patchFails };          // đổi được giữa hai lần bấm
  const api = {
    async patch(path, body) {
      seen.patches.push({ path, body });
      if (box.fail) throw box.fail;
      return { due_at: body.due_date ? DUE : null };
    },
  };
  const fn = new Function(
    '$', 'api', 'toast', 'dueText', '_homework', '_cohortId',
    'loadHomework', 'invalidateProgress',
    `${SRC.slice(start, end)}
     return { openDueEdit, closeDueEdit, saveDue, dueParts,
              peek: () => ({ asg: _dueAsg, flips: _dueFlips }) };`,
  )(
    el, api, (m, k) => seen.toasts.push({ m, k }), (d) => String(d || 'không hạn'),
    homework || [{ id: 'a1', title: 'Grammar 1', due_at: DUE }],
    'coh-1',
    async () => { seen.reloads += 1; },
    () => {},
  );
  return { ...fn, els, seen, el, box };
}

describe('giờ hạn đọc theo giờ Việt Nam', () => {
  test('19:00 giờ Việt Nam hiện ra là 19:00, không đổi theo múi giờ máy', () => {
    // Máy CI chạy ở UTC: đọc theo giờ máy thì mốc này thành 12:00 ngày 07/08.
    const { dueParts } = load();
    assert.deepEqual(dueParts(DUE), { date: '2026-08-07', time: '19:00' });
  });

  test('mốc qua nửa đêm giờ UTC vẫn ra ĐÚNG ngày ở Việt Nam', () => {
    // 00:30 ngày 09/08 giờ VN = 17:30 ngày 08/08 giờ UTC. Đọc theo giờ máy là
    // lùi mất một ngày — và một ngày ở đây là cả một buổi học.
    const { dueParts } = load();
    assert.deepEqual(dueParts('2026-08-09T00:30:00+07:00'),
      { date: '2026-08-09', time: '00:30' });
  });

  test('không hạn thì ô ngày để trống, giờ về mặc định 19:00', () => {
    const { dueParts } = load();
    assert.deepEqual(dueParts(null), { date: '', time: '19:00' });
  });
});

describe('gửi lệnh đổi hạn', () => {
  test('lần bấm ĐẦU không mang cờ xác nhận', async () => {
    const { openDueEdit, saveDue, el, seen } = load();
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '2026-08-09';
    el('due-time').value = '19:00';
    await saveDue();
    assert.equal(seen.patches.length, 1);
    assert.equal(seen.patches[0].body.confirm_rewrites, false,
      'gửi sẵn cờ xác nhận là bỏ qua chính cái chốt đang canh');
    assert.equal(seen.patches[0].body.due_date, '2026-08-09');
    assert.match(seen.patches[0].path, /\/assignments\/a1\/due$/);
  });

  test('nêu hạn của SỔ, không nêu hạn trên thuộc tính nút đã cũ', async () => {
    // Bảng vừa được vẽ lại sau một lượt đọc mới; thuộc tính trên nút có thể là
    // của lần vẽ trước. So-sánh-rồi-đổi mà nêu một giá trị cũ thì máy chủ từ
    // chối oan, hoặc tệ hơn — trùng hợp mà lọt.
    const { openDueEdit, saveDue, el, seen } = load({
      homework: [{ id: 'a1', title: 'Grammar 1', due_at: '2026-08-10T19:00:00+07:00' }],
    });
    openDueEdit('a1', DUE, 'Grammar 1');       // nút mang hạn CŨ
    el('due-date').value = '2026-08-11';
    await saveDue();
    assert.equal(seen.patches[0].body.expected_due_at, '2026-08-10T19:00:00+07:00');
  });

  test('bỏ hạn gửi due_date rỗng', async () => {
    const { openDueEdit, saveDue, el, seen } = load();
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '';
    await saveDue();
    assert.equal(seen.patches[0].body.due_date, null);
  });

  test('đổi được thì đóng hộp và ĐỌC LẠI bảng', async () => {
    const { openDueEdit, saveDue, el, seen, peek } = load();
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '2026-08-09';
    await saveDue();
    assert.equal(el('due-modal').hidden, true);
    assert.equal(seen.reloads, 1);
    assert.equal(peek().asg, null);
  });
});

describe('máy chủ đếm được bao nhiêu hồ sơ bị viết lại thì phải NÓI RA', () => {
  const refuse = (flips) => {
    const e = new Error('409');
    e.detail = { message: 'Đổi hạn này viết lại hồ sơ đúng-hạn của những em đã nộp.',
      needs_confirm: true, flips };
    return e;
  };

  test('hiện con số, giữ hộp mở, đổi chữ trên nút', async () => {
    const { openDueEdit, saveDue, el, seen } = load({
      patchFails: refuse({ to_ontime: 3, to_late: 0 }),
    });
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '2026-08-09';
    await saveDue();

    assert.equal(el('due-modal').hidden, false, 'đóng hộp là nuốt mất lời cảnh báo');
    assert.equal(el('due-warn').hidden, false);
    assert.match(el('due-warn').innerHTML, /<strong>3<\/strong>/);
    assert.match(el('due-warn').innerHTML, /NỘP TRỄ/);
    assert.equal(el('btn-due-ok').textContent, 'Vẫn đổi hạn');
    assert.equal(seen.reloads, 0);
  });

  test('nói cả chiều ngược lại: đúng hạn thành nộp trễ', async () => {
    const { openDueEdit, saveDue, el } = load({
      patchFails: refuse({ to_ontime: 0, to_late: 2 }),
    });
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '2026-08-06';
    await saveDue();
    assert.match(el('due-warn').innerHTML, /<strong>2<\/strong>/);
    assert.match(el('due-warn').innerHTML, /ĐÚNG HẠN/);
  });

  test('lần bấm THỨ HAI mới mang cờ xác nhận, và lúc ấy mới đổi thật', async () => {
    const { openDueEdit, saveDue, el, seen, box } =
      load({ patchFails: refuse({ to_ontime: 3, to_late: 0 }) });
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '2026-08-09';

    await saveDue();                                  // lần 1 — máy chủ từ chối
    assert.equal(seen.patches[0].body.confirm_rewrites, false);
    assert.equal(el('due-modal').hidden, false);
    assert.equal(seen.reloads, 0);

    box.fail = null;                                  // giáo viên đã đọc con số
    await saveDue();                                  // lần 2 — bấm "Vẫn đổi hạn"
    assert.equal(seen.patches.length, 2);
    assert.equal(seen.patches[1].body.confirm_rewrites, true);
    assert.equal(el('due-modal').hidden, true, 'đổi xong thì hộp phải đóng');
    assert.equal(seen.reloads, 1);
  });

  test('mở lại hộp là QUÊN lời xác nhận cũ', async () => {
    // Xác nhận là cho ĐÚNG cái hạn vừa nhìn thấy con số. Giữ nó qua lần mở sau
    // nghĩa là lần đổi kế tiếp bỏ qua chốt đếm mà không ai bấm gì.
    const { openDueEdit, saveDue, el, seen, box, peek } =
      load({ patchFails: refuse({ to_ontime: 3, to_late: 0 }) });
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '2026-08-09';
    await saveDue();
    assert.deepEqual(peek().flips, { to_ontime: 3, to_late: 0 });

    openDueEdit('a1', DUE, 'Grammar 1');              // mở lại
    assert.equal(peek().flips, null);
    box.fail = null;
    el('due-date').value = '2026-08-09';
    await saveDue();
    assert.equal(seen.patches[1].body.confirm_rewrites, false,
      'mở lại mà vẫn mang cờ là lọt chốt đếm');
  });
});

describe('tranh chấp: người khác vừa đổi hạn', () => {
  test('đóng hộp và đọc lại bảng, không hỏi lại một tiền đề đã sai', async () => {
    const e = new Error('409');
    e.detail = { message: 'Hạn đã đổi từ lúc mở trang.', conflict: true };
    const { openDueEdit, saveDue, el, seen } = load({ patchFails: e });
    openDueEdit('a1', DUE, 'Grammar 1');
    el('due-date').value = '2026-08-09';
    await saveDue();
    assert.equal(el('due-modal').hidden, true);
    assert.equal(seen.reloads, 1);
    assert.match(seen.toasts[0].m, /Hạn đã đổi từ lúc mở trang/);
    assert.equal(seen.toasts[0].k, 'error');
  });
});

describe('dây nối ở trang', () => {
  test('mỗi bài giao có nút Đổi hạn, mang theo hạn hiện tại', () => {
    assert.match(SRC, /data-action="edit-due"/);
    assert.match(SRC, /data-due="\$\{esc\(a\.due_at \|\| ''\)\}"/);
  });

  test('nút được nối vào đúng hàm mở hộp', () => {
    assert.match(SRC, /'edit-due'\)\s*\{\s*\n\s*openDueEdit\(/);
  });

  test('hộp có ô ngày, ô giờ và lối bỏ hạn', () => {
    const HTML = readFileSync(join(HERE, '..', 'public', 'pages', 'admin',
      'classes', 'index.html'), 'utf8');
    assert.match(HTML, /id="due-date"[^>]*type="date"|type="date"[^>]*id="due-date"/);
    assert.match(HTML, /id="due-time"/);
    assert.match(HTML, /id="btn-due-clear"/);
    assert.match(HTML, /id="due-warn"/);
  });
});
