/**
 * Mặt đọc kết quả quiz phải đọc được CẢ hai phạm vi.
 *
 * Trang này vốn đóng cứng `skill_area=vocab` ở ba lời gọi, nên kết quả bài tập
 * theo buổi có ghi vào cùng bảng cũng KHÔNG AI ĐỌC ĐƯỢC — dữ liệu đủ, thiếu mỗi
 * mặt đọc. Tôi đã nêu chuyện này ba lần qua ba PR mà không sửa; bộ test này là
 * thứ giữ cho nó không quay lại.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(
  join(HERE, '..', 'public', 'pages', 'admin', 'vocab', 'quiz-analytics.html'), 'utf8');

describe('phạm vi không còn đóng cứng', () => {
  test('KHÔNG lời gọi API nào còn đóng cứng phạm vi', () => {
    // Soi trong LỜI GỌI, không soi chữ trần: câu chú thích giải thích bản vá
    // cũng chứa chuỗi ấy, và một phép đếm thô sẽ đỏ vì chính lời giải thích.
    // (Bẫy "bộ quét đọc cả comment" đã ghi trong bộ nhớ dự án — vẫn dính.)
    const calls = HTML.match(/api\.get\('[^']*'/g) || [];
    const hard = calls.filter((c) => c.includes('skill_area=vocab'));
    assert.deepEqual(hard, [], 'còn lời gọi đóng cứng');
  });

  test('cả BA lời gọi đều đọc phạm vi đang chọn', () => {
    // Sót một cái nghĩa là trang trộn số của hai kho — tệ hơn không đổi gì.
    assert.equal((HTML.match(/skill_area=' \+ scope\(\)/g) || []).length, 3);
  });

  test('ô chọn có cả hai phạm vi', () => {
    assert.match(HTML, /<option value="vocab">/);
    assert.match(HTML, /<option value="course">/);
  });

  test('scope() đọc từ Ô CHỌN, không nhớ ở biến', () => {
    // Nhớ ở biến thì hai lời gọi trong cùng một lượt có thể thấy hai giá trị.
    assert.match(HTML, /function scope\(\)[\s\S]{0,200}?getElementById\('qa-scope'\)/);
  });

  test('mặc định là vocab khi ô chọn chưa có', () => {
    assert.match(HTML, /return \(el && el\.value\) \|\| 'vocab';/);
  });
});

describe('đổi phạm vi thì đổi TẤT CẢ', () => {
  const wire = HTML.slice(HTML.indexOf("$('qa-scope').onchange"));

  test('có dây nối — nếu không thì ô chọn chỉ để nhìn', () => {
    assert.ok(wire.startsWith("$('qa-scope').onchange"), 'thiếu hẳn dây nối');
    assert.match(wire.slice(0, 500), /loadStudents\(\)/);
  });

  test('dọn cả tab "dễ sai", không chỉ bảng học viên', () => {
    // Tab ấy nhớ đã tải bằng `_banksLoaded`; không đặt lại thì người dùng chuyển
    // sang bài tập theo buổi mà vẫn thấy danh sách bộ TỪ VỰNG.
    assert.match(wire.slice(0, 500), /_banksLoaded = false/);
    assert.match(wire.slice(0, 500), /qa-bank'\)\.innerHTML = ''/);
  });

  test('tiêu đề đổi theo phạm vi, không để "từ vựng" cứng', () => {
    assert.match(HTML, /id="qa-title"/);
    assert.match(HTML, /Kết quả bài tập theo buổi/);
    assert.match(wire.slice(0, 500), /applyScope\(\)/);
  });

  test('applyScope chạy NGAY khi mở trang', () => {
    const boot = HTML.slice(HTML.indexOf("$('qa-refresh').onclick"));
    assert.match(boot, /applyScope\(\);\s*\n\s*loadStudents\(\);/);
  });
});
