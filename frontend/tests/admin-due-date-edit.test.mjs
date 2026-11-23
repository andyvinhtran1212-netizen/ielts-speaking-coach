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
 *     hộp, và chỉ lần bấm thứ hai (cùng ngày, cùng giờ) mới mang cờ xác nhận.
 *
 * LEGACYJS-0075 W3b: admin-classes.js đã xoá. Hộp đổi hạn giờ nằm trong
 * admin-class-homework.tsx; `dueParts` (lib/admin-class-homework-model.mjs)
 * được CHẠY THẬT, còn luồng `saveDue` được ghim trên mã nguồn Next. Ca vòng
 * 19:00 và xung đột `current_due_at` còn được chạy ở
 * admin-class-homework-next-behavior.test.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dueParts } from '../lib/admin-class-homework-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-homework.tsx'), 'utf8');
const SAVE_AT = SRC.indexOf('const saveDue = async');
const SAVE = SRC.slice(SAVE_AT, SRC.indexOf('\n  };\n', SAVE_AT));
const DIALOG = SRC.slice(SRC.indexOf('<Dialog open={Boolean(dueEditor)}'), SRC.indexOf('</Dialog>', SRC.indexOf('<Dialog open={Boolean(dueEditor)}')));
const DUE = '2026-08-07T12:00:00+00:00';

describe('giờ hạn đọc theo giờ Việt Nam', () => {
  test('19:00 giờ Việt Nam hiện ra là 19:00, không đổi theo múi giờ máy', () => {
    assert.deepEqual(dueParts(DUE), { date: '2026-08-07', time: '19:00' });
  });
  test('mốc qua nửa đêm giờ UTC vẫn ra ĐÚNG ngày ở Việt Nam', () => {
    assert.deepEqual(dueParts('2026-08-09T00:30:00+07:00'), { date: '2026-08-09', time: '00:30' });
  });
  test('không hạn (hoặc mốc hỏng) thì ô ngày để trống, giờ về mặc định 19:00', () => {
    assert.deepEqual(dueParts(null), { date: '', time: '19:00' });
    assert.deepEqual(dueParts('not-a-date'), { date: '', time: '19:00' });
  });
});

describe('gửi lệnh đổi hạn', () => {
  test('mở hộp là QUÊN lời xác nhận cũ', () => {
    assert.match(SRC, /const openDue = \(assignment: ClassAssignment\) => \{\s*const parts = dueParts\(assignment\.due_at\);\s*setDueEditor\(\{ assignment, dueDate: parts\.date, dueTime: parts\.time, confirmed: null,/);
  });
  test('cờ xác nhận chỉ đi kèm khi ngày VÀ giờ trùng đúng lần đã cảnh báo', () => {
    assert.match(SAVE, /const confirmed = dueEditor\.confirmed\?\.date === date && dueEditor\.confirmed\?\.time === time \? dueEditor\.confirmed : null;/);
    assert.match(SAVE, /confirm_rewrites: Boolean\(confirmed\), confirmed_flips: confirmed\?\.flips \|\| null/);
  });
  test('nêu hạn của SỔ (expected_due_at) và bỏ hạn gửi due_date rỗng', () => {
    assert.match(SAVE, /\/assignments\/\$\{encodeURIComponent\(dueEditor\.assignment\.id\)\}\/due`/);
    assert.match(SAVE, /due_date: date, due_time: time, expected_due_at: dueEditor\.assignment\.due_at/);
    assert.match(SAVE, /const date = dueEditor\.dueDate \|\| null;\s*const time = date \? dueEditor\.dueTime \|\| '19:00' : null;/);
  });
  test('đổi được thì đóng hộp và ĐỌC LẠI bảng', () => {
    assert.match(SAVE, /setDueEditor\(null\);\s*await canonicalMutation\(result\?\.due_at \? 'Đã đổi hạn theo giờ Việt Nam\.' : 'Đã bỏ hạn nộp\.'\)/);
  });
});

describe('máy chủ đếm được bao nhiêu hồ sơ bị viết lại thì phải NÓI RA', () => {
  test('hiện con số hai chiều, giữ hộp mở, ghi nhớ ngày/giờ đã cảnh báo', () => {
    assert.match(SAVE, /if \(detail\?\.needs_confirm && detail\.flips\)/);
    assert.match(SAVE, /setDueEditor\(\{ \.\.\.dueEditor, confirmed: \{ date, time, flips \}/);
    assert.match(SAVE, /\$\{flips\.to_ontime\} lượt trễ sẽ thành đúng hạn; \$\{flips\.to_late\} lượt đúng hạn sẽ thành trễ\./);
    assert.match(SAVE, /detail\.stale_confirmation \? 'Số lượt vừa thay đổi\. ' : ''/);
  });
  test('nút đổi chữ khi đang chờ xác nhận', () => {
    assert.match(DIALOG, /\{dueEditor\?\.confirmed \? 'Vẫn đổi hạn' : 'Đổi hạn'\}/);
  });
  test('sửa NGÀY hoặc GIỜ thì lời xác nhận và cảnh báo hết hiệu lực', () => {
    assert.match(DIALOG, /dueDate: event\.target\.value, confirmed: null, warning: '', error: ''/);
    assert.match(DIALOG, /dueTime: event\.target\.value, confirmed: null, warning: '', error: ''/);
  });
});

describe('tranh chấp: người khác vừa đổi hạn', () => {
  test('nạp mốc hiện tại, bỏ xác nhận cũ, đọc lại bảng', () => {
    assert.match(SAVE, /detail\?\.conflict && Object\.prototype\.hasOwnProperty\.call\(detail, 'current_due_at'\)/);
    assert.match(SAVE, /assignment: \{ \.\.\.dueEditor\.assignment, due_at: current \},\s*confirmed: null,/);
    assert.match(SAVE, /void loadAssignments\(true\)/);
  });
});

describe('dây nối ở trang', () => {
  test('mỗi bài giao có nút Đổi hạn nối vào openDue', () => {
    assert.match(SRC, /onClick=\{\(\) => openDue\(assignment\)\} disabled=\{busy\}>Đổi hạn<\/button>/);
  });
  test('hộp có ô ngày, ô giờ (giờ Việt Nam) và lối bỏ hạn', () => {
    assert.match(DIALOG, /title="Đổi hạn nộp"/);
    assert.match(DIALOG, /<Field label="Ngày hạn"><input type="date"/);
    assert.match(DIALOG, /<Field label="Giờ hạn"><input type="time"[^>]*disabled=\{!dueEditor\?\.dueDate\}/);
    assert.match(DIALOG, /Mọi giờ dưới đây là giờ Việt Nam\./);
    assert.match(DIALOG, /Để trống ngày để bỏ hạn/);
  });
});
