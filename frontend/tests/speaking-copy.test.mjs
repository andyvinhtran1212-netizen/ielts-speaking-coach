// Mọi CHUỖI NGƯỜI DÙNG ĐỌC ĐƯỢC của bản Next phải trùng bản legacy.
//
// VÌ SAO: cổng parity G1 so CHỮ trên màn hình. Lệch một dấu ba chấm là
// `line-missing`. Nhưng cổng chỉ chạy được khi cặp parity đã có (PR 3) và chỉ
// so được TRẠNG THÁI RỖNG — nhiều chuỗi dưới đây chỉ hiện sau khi người dùng
// bấm (lỗi modal, nhãn nút lúc đang tải, cảnh báo cue card), tức NẰM NGOÀI tầm
// parity vĩnh viễn. Đây là lớp che duy nhất cho chúng.
//
// Nguồn sự thật là `public/pages/speaking.html` — so trực tiếp, không chép tay
// vào test (chép tay là tạo ra bản thứ ba để trôi).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as copy from '../lib/speaking-copy.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = readFileSync(path.join(FRONTEND, 'public/pages/speaking.html'), 'utf8');
const BEHAVIOR = readFileSync(
  path.join(FRONTEND, 'app/(authed-speaking)/speaking/speaking-behavior.tsx'), 'utf8');

/** Chuỗi phải có mặt ở CẢ legacy lẫn bản Next (module hằng số hoặc tầng hành vi). */
const SHARED_STRINGS = [
  'Daily Life & Personal Interests',
  'Describing a Person or Experience',
  'Society, Technology & Modern Issues',
  'Tài khoản không có quyền truy cập',
  'Gói truy cập của bạn không bao gồm tính năng này. Liên hệ admin để nâng cấp.',
  'Vui lòng nhập ít nhất một câu hỏi.',
  'Không tìm thấy câu hỏi hợp lệ.',
  'Vui lòng chọn một chủ đề từ danh sách.',
  'Vui lòng nhập chủ đề trước khi bắt đầu.',
  'Vui lòng chọn hoặc nhập chủ đề.',
  'Server không trả về session hợp lệ.',
  'Đang tạo cue card...',
  'Đang tạo session...',
  'Đang chuẩn bị...',
  '✍️ Bắt đầu luyện tập',
  '🚀 Bắt đầu tạo câu hỏi',
  '🏆 Bắt đầu Full Test',
  '— Đang tải danh sách... —',
  '— Không có chủ đề nào —',
  '— Chọn một chủ đề —',
  '— Không thể tải danh sách —',
  '— Đang tải... —',
  '— Không có chủ đề —',
  '— Chọn chủ đề —',
  '— Không thể tải —',
  'Bạn muốn luyện tập Part ',
  'Chủ đề cho Part ',
  'thẻ đến hạn',
  'Ôn từ vựng theo lịch tự động',
  'Bài tập từ vựng ngắn',
];

// Gom CẢ chuỗi lồng trong object export (`DEFAULT_TOPICS`) — bản đầu chỉ lấy
// export kiểu chuỗi nên báo thiếu 3 chủ đề mặc định một cách sai.
const NEXT_SIDE = JSON.stringify(copy, (_k, v) => v) + '\n' + BEHAVIOR;

// CỐ Ý KHÔNG có ở bản Next: `'Không thể tạo session: '` là thông báo `alert()`
// của `startPractice()` — hàm mà KHÔNG nút nào trong markup legacy gọi (quét:
// 0 handler). Bỏ nó đi là bỏ mã chết, không phải mất tính năng; chốt chặn
// `speaking-behavior-hooks.test.mjs` giữ quyết định đó khỏi bị đảo ngược.

describe('chuỗi hiển thị Speaking — Next khớp legacy', () => {
  test('mọi chuỗi đều có ở CẢ HAI bản', () => {
    const onlyLegacy = SHARED_STRINGS.filter((s) => LEGACY.includes(s) && !NEXT_SIDE.includes(s));
    const inNeither = SHARED_STRINGS.filter((s) => !LEGACY.includes(s));
    assert.deepEqual(inNeither, [],
      'chuỗi không còn trong legacy ⇒ danh sách này đã cũ, cập nhật lại');
    assert.deepEqual(onlyLegacy, [],
      'bản Next thiếu chuỗi legacy có ⇒ cổng parity sẽ báo line-missing');
  });

  test('ngưỡng cảnh báo cue card trùng legacy', () => {
    assert.match(LEGACY, new RegExp('_CUE_CARD_LENGTH_WARN_CHARS\\s*=\\s*'
      + copy.CUE_CARD_LENGTH_WARN_CHARS + '\\b'));
    assert.match(LEGACY, new RegExp('_CUE_CARD_LENGTH_WARN_WORDS\\s*=\\s*'
      + copy.CUE_CARD_LENGTH_WARN_WORDS + '\\b'));
  });

  test('cảnh báo cue card: trạng thái + số đếm đúng hình dạng legacy', () => {
    // Trạng thái là 'visible'/'hidden' — KHÔNG phải 'warn'. Tôi đoán sai một lần
    // rồi mới đối chiếu; ghim lại để khỏi đoán lần nữa.
    const long = copy.cueCardLengthWarning('x'.repeat(250), 2);
    assert.equal(long.state, 'visible');
    assert.match(long.html, /250 ký tự \/ 1 từ/);
    assert.equal(copy.cueCardLengthWarning('ngắn', 2).state, 'hidden');
    assert.equal(copy.cueCardLengthWarning('x'.repeat(250), 1).state, 'hidden',
      'Part 1/3 cố ý nhận nhiều dòng — cảnh báo ở đó là nhiễu');
  });

  test('quyền: `all` bao trùm, mặc định an toàn cho tới khi /auth/me trả về', () => {
    assert.ok(copy.hasPermission(['all'], 'practice_full'));
    assert.ok(!copy.hasPermission(['practice_single'], 'practice_full'));
    assert.deepEqual(copy.DEFAULT_PERMISSIONS,
      ['practice_single', 'practice_part', 'practice_full']);
  });

  test('lời chào lấy TỪ CUỐI, không dùng API cần Safari 15.4', () => {
    // `.at(-1)` cần Safari 15.4; sàn dự án là iOS 15.0 và script legacy không
    // qua bundler (DEBT-2026-07-29-K, review #882).
    assert.equal(copy.greetingName({ display_name: 'Nguyễn Văn A' }).short, 'A');
    assert.equal(copy.greetingName({ email: 'lan@example.com' }).short, 'lan');
    assert.equal(copy.greetingName({}).short, 'Bạn');
    // PHẢI bỏ chú thích trước khi quét: chính dòng giải thích "KHÔNG dùng
    // `.at(-1)`" bị tính là vi phạm. Bẫy này đã dính năm lần trong dự án.
    const src = readFileSync(path.join(FRONTEND, 'lib/speaking-copy.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/\.at\(\s*-1\s*\)/.test(src), 'không dùng .at(-1) — sàn iOS 15.0');
  });
});
