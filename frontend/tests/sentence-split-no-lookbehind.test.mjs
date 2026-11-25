/**
 * sentence-split-no-lookbehind.test.mjs — DEBT-2026-07-29-K, review #882 vòng 6.
 *
 * `public/js/**` được phục vụ NGUYÊN XI, không qua bundler, nên một cú pháp
 * vượt sàn ở đó làm CẢ FILE không parse được trên iOS ≤16.3. Đợt quét tìm ra
 * regexp lookbehind ở hai chỗ, trong đó `listening-test-player.js` là file học
 * viên nạp khi làm bài nghe — tức trên iPhone cũ, trình phát bài nghe chết
 * hoàn toàn, không riêng hàm đó.
 *
 * Bản vá thay lookbehind bằng "bắt dấu câu vào nhóm + chèn ký tự mốc". Bài test
 * này chứng minh cách viết mới cho KẾT QUẢ Y HỆT cách cũ: nó ĐỌC biểu thức thật
 * từ file nguồn (không chép lại) rồi so với bản lookbehind chạy trên Node.
 */

// LEGACYJS-0075 W1: admin-listening-segments.js was deleted; the Next splitter
// (lib/admin-listening-segments-model.mjs) keeps the same cases in
// admin-listening-segments-next-behavior.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS = path.join(__dirname, '..', 'public', 'js');

/** Lấy đúng cặp `.replace(...)` + `.split(...)` trong file nguồn ra thành hàm. */
function extractSplitter(file) {
  const src = readFileSync(path.join(JS, file), 'utf8');
  const m = /\.replace\((\/.+?\/g), ('(?:[^'\\]|\\.)*')\)\s*\n\s*\.split\(('(?:[^'\\]|\\.)*')\)/.exec(src);
  assert.ok(m, `${file}: không tìm thấy chuỗi .replace(...).split(...) — bản vá đã bị sửa?`);
  // eslint-disable-next-line no-new-func
  const fn = new Function('raw', `
    return String(raw).replace(${m[1]}, ${m[2]}).split(${m[3]})
      .map((s) => s.trim()).filter(Boolean);
  `);
  return { fn, source: m[0] };
}

const CORPUS = [
  'Write NO MORE THAN TWO WORDS. Answer all questions.',
  'One sentence only',
  'A. B. C.',
  'Đọc kỹ. Sau đó trả lời. OK?',
  'Multiple   spaces. Then text.',
  'Ends with period.',
  '',
  'Câu hỏi? Trả lời! Xong.',
  'no capital after. lowercase stays joined',
  'Dr. Smith went home. He slept.',
];

describe('tách câu không dùng lookbehind (DEBT-2026-07-29-K)', () => {
  const cases = [
    {
      file: 'listening-test-player.js',
      // Bản lookbehind TƯƠNG ĐƯƠNG — chạy được trên Node, dùng làm mốc so sánh.
      //
      // 02/08/2026: mốc đổi từ `(?<=\.)` sang `(?<=[.?!])`. Bài test này pin KỸ
      // THUẬT ("bắt dấu câu vào nhóm + ký tự mốc" phải cho kết quả y hệt
      // lookbehind), KHÔNG pin việc tách ở dấu nào. Khối matching mở đầu bằng
      // chính câu hỏi ("What comment do the students make…?") rồi mới tới câu
      // lệnh, nên chỉ tách ở dấu chấm thì hai thứ dính làm một trên đề học viên
      // đang thi. Đổi mốc theo, phép so tương đương vẫn nguyên vẹn.
      reference: (raw) => String(raw).split(/(?<=[.?!])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean),
    },
  ];

  for (const { file, reference } of cases) {
    test(`${file}: kết quả GIỐNG HỆT bản lookbehind cũ`, () => {
      const { fn } = extractSplitter(file);
      for (const input of CORPUS) {
        assert.deepEqual(fn(input), reference(input), `khác nhau ở: ${JSON.stringify(input)}`);
      }
    });

    test(`${file}: không còn lookbehind trong nguồn`, () => {
      const src = readFileSync(path.join(JS, file), 'utf8');
      assert.ok(!src.includes('(?<='), 'iOS ≤16.3 không parse nổi cả file nếu còn');
      assert.ok(!src.includes('\u0000'), 'ký tự mốc phải viết bằng escape \\u0000, không nhúng byte NUL');
    });
  }
});
