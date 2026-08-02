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

describe('ô bảng — mỗi ý một dòng', () => {
  test('các phần tử trong một ô được bọc thành dòng riêng, không nối bằng dấu cách', () => {
    assert.match(JS, /c\.map\(\(seg\) =>\s*\n?\s*`<div class="ielts-table-line">\$\{tableGapSegment\(seg\)\}<\/div>`\)\.join\(''\)/);
    assert.doesNotMatch(JS, /c\.map\(tableGapSegment\)\.join\(' '\)/,
      'vẫn còn kiểu nối bằng dấu cách');
  });

  test('CSS làm .ielts-table-line thành block và có khoảng cách giữa các dòng', () => {
    assert.match(CSS, /\.ielts-table-line \{[^}]*display:\s*block/);
    assert.match(CSS, /\.ielts-table-line \+ \.ielts-table-line \{[^}]*margin-top/);
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
