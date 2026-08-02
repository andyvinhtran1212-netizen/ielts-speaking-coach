/**
 * frontend/tests/listening-paper-layout.test.mjs
 *
 * Ba lỗi trình bày trên trang làm bài Listening, phát hiện khi mở Cambridge 18
 * Test 2 cho học viên thi thật (02/08/2026):
 *
 *  1. Ô bảng nối các ý bằng dấu cách ⇒ hai ý độc lập trên đề gốc đọc thành một
 *     câu vô nghĩa: "Checking portions, etc. are correct Making sure ___ is
 *     clean".
 *  2. Câu chọn-nhiều còn một dòng tiếng Việt ("Chọn 2 đáp án (11 + 12).") —
 *     đề IELTS thật thuần tiếng Anh — và các lựa chọn A-E xếp ngang thành đoạn
 *     văn nên không đọc nổi đâu là A đâu là B.
 *  3. Khối matching gộp câu hỏi và câu lệnh vào một đoạn vì bộ tách câu chỉ bắt
 *     dấu CHẤM, trong khi câu hỏi kết thúc bằng dấu HỎI ⇒ học viên không phân
 *     biệt được đâu là đề bài, đâu là hướng dẫn.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const JS = read('frontend/js/listening-test-player.js');
const CSS = read('frontend/css/ielts-test-paper.css');

/** Lấy chính hàm cellLines trong file nguồn ra chạy — test hành vi, không so chuỗi. */
function loadCellLines() {
  const m = JS.match(/function cellLines\(segments\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'không tìm thấy cellLines');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return cellLines;`)();
}

describe('ô bảng — ngắt dòng theo dữ liệu, không ngắt bừa', () => {
  const cellLines = loadCellLines();

  test('hai Ý ĐỘC LẬP tách thành hai dòng (gap tự mang prefix)', () => {
    const cell = ['Checking portions, etc. are correct',
                  { q_num: 7, prefix: 'Making sure', suffix: 'is clean' }];
    assert.deepEqual(cellLines(cell), [
      ['Checking portions, etc. are correct'],
      [{ q_num: 7, prefix: 'Making sure', suffix: 'is clean' }],
    ]);
  });

  test('MẨU NỐI LIỀN quanh chỗ trống phải ở NGUYÊN một dòng (gap trần)', () => {
    // _cell_segments() dùng hình dạng này cho "Good for people who are
    // especially keen on (1) ………" — tách ra là vỡ câu và tách ô nhập khỏi
    // phần dẫn của nó.
    const cell = ['Good for people who are especially keen on', { q_num: 1 }];
    assert.equal(cellLines(cell).length, 1);
    assert.deepEqual(cellLines(cell)[0], cell);
  });

  test('ô hai chỗ trống kiểu nối liền vẫn là một dòng', () => {
    const cell = ['Set lunch costs', { q_num: 9 }, 'per person'];
    assert.equal(cellLines(cell).length, 1);
  });

  test('chữ đứng sau một chỗ trống ĐÃ CÓ đuôi thì mở ý mới', () => {
    // "Starting salary £ ___ per hour" đã trọn nghĩa, nên "Start work at 5.30
    // a.m." là ý riêng — không được dính đuôi vào.
    const cell = [{ q_num: 8, prefix: 'Starting salary £', suffix: 'per hour' },
                  'Start work at 5.30 a.m.'];
    assert.deepEqual(cellLines(cell), [
      [{ q_num: 8, prefix: 'Starting salary £', suffix: 'per hour' }],
      ['Start work at 5.30 a.m.'],
    ]);
  });

  test('nhưng chữ sau một chỗ trống KHÔNG có đuôi vẫn nối liền', () => {
    // Đó chính là hình dạng "Set lunch costs (9) ……… per person": phần đuôi
    // nằm ở segment kế tiếp chứ không nằm trong gap.
    assert.equal(cellLines([{ q_num: 9 }, 'per person']).length, 1);
    assert.equal(cellLines([{ q_num: 9, suffix: '' }, 'per person']).length, 1);
  });

  test('prefix rỗng/trắng KHÔNG được tính là mở dòng mới', () => {
    assert.equal(cellLines(['x', { q_num: 2, prefix: '' }]).length, 1);
    assert.equal(cellLines(['x', { q_num: 2, prefix: '   ' }]).length, 1);
  });

  test('gap mở đầu ô có prefix vẫn chỉ là một dòng', () => {
    const cell = [{ q_num: 1, prefix: 'Good for people who are especially keen on' }];
    assert.equal(cellLines(cell).length, 1);
  });

  test('CSS làm .ielts-table-line thành block và có khoảng cách giữa các dòng', () => {
    assert.match(CSS, /\.ielts-table-line \{[^}]*display:\s*block/);
    assert.match(CSS, /\.ielts-table-line \+ \.ielts-table-line \{[^}]*margin-top/);
  });

  test('khối `th, td` KHÔNG bị chèn vỡ — ô tiêu đề giữ nguyên viền/padding', () => {
    // Chèn quy tắc mới vào giữa `.ielts-table th,` và `.ielts-table td {…}` thì
    // trình duyệt đọc thành `.ielts-table th, .ielts-table-line {…}` và toàn bộ
    // ô tiêu đề mất định dạng (Codex review PR #895).
    assert.match(CSS, /\.ielts-table th,\s*\n\s*\.ielts-table td \{[^}]*border:/);
    const shared = CSS.indexOf('.ielts-table th,\n.ielts-table td {');
    const line = CSS.indexOf('.ielts-table-line {');
    assert.ok(shared > -1 && line > shared,
      '.ielts-table-line phải nằm SAU khối th/td đã đóng');
  });
});

describe('câu chọn-nhiều — thuần tiếng Anh, mỗi lựa chọn một dòng', () => {
  test('không còn dòng gợi ý tiếng Việt trong đề', () => {
    assert.doesNotMatch(JS, /ielts-mc-hint/, 'dòng "Chọn N đáp án" vẫn còn');
    assert.doesNotMatch(JS, /Chọn \$\{esc\(choose\)\} đáp án/);
  });

  test('mỗi lựa chọn xuống dòng riêng', () => {
    assert.match(CSS, /\.ielts-mc-opt \{[^}]*display:\s*flex/);
    assert.match(CSS, /\.ielts-mc-opt \{[^}]*margin-top/);
  });

  test('vẫn giữ nguyên cơ chế gán slot cho bộ chấm', () => {
    // data-mm-slots/data-mm-choose là thứ handler dùng để map N ô tích vào N
    // q_num; bỏ dòng tiếng Việt không được đụng tới chúng.
    assert.match(JS, /data-mm-slots="\$\{esc\(slots\.join\(','\)\)\}"/);
    assert.match(JS, /data-mm-choose="\$\{esc\(choose\)\}"/);
  });
});

describe('hướng dẫn — tách câu hỏi khỏi câu lệnh', () => {
  test('bộ tách câu bắt cả dấu hỏi và chấm than', () => {
    assert.match(JS, /replace\(\/\(\[\.\?!\]\)\\s\+\(\?=\[A-Z\]\)\/g/);
  });

  test('vẫn KHÔNG dùng lookbehind (iOS ≤16.3 không parse nổi cả file)', () => {
    const fn = JS.match(/function formatInstruction\(raw\)[\s\S]{0,1600}?\n\}/);
    assert.ok(fn, 'không tìm thấy formatInstruction');
    assert.doesNotMatch(fn[0], /\(\?<=/, 'lookbehind sẽ làm iOS ≤16.3 chết cả trình phát');
  });

  test('đánh dấu theo vai trò: câu lệnh vs câu hỏi', () => {
    const fn = JS.match(/function formatInstruction\(raw\)[\s\S]{0,1600}?\n\}/)[0];
    assert.match(fn, /DIRECTIVE_RE = \/\^\(Choose\|Write\|Complete\|Label\|Match\|Answer\|Select\)/);
    assert.match(fn, /is-directive/);
    assert.match(fn, /is-question/);
  });

  test('CSS bám vai trò và thắng quy tắc theo-vị-trí', () => {
    const iDir = CSS.indexOf('.ielts-instruction p.is-directive');
    const iSeq = CSS.indexOf('.ielts-instruction p + p');
    assert.ok(iDir > -1 && iSeq > -1, 'thiếu quy tắc');
    assert.ok(iDir > iSeq,
      'quy tắc theo vai trò phải đứng SAU quy tắc theo vị trí mới thắng được');
    assert.match(CSS, /\.ielts-instruction p\.is-directive \{[^}]*font-style:\s*normal/);
    assert.match(CSS, /\.ielts-instruction p\.is-question\s+\{[^}]*font-style:\s*italic/);
  });
});
