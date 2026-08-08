/**
 * Bản chấm tự luận: mặt GIÁO VIÊN phải nói cùng một câu với mặt HỌC VIÊN.
 *
 * Lỗi HÌNH THỨC (viết hoa đầu câu, dấu chấm cuối, khoảng trắng) không làm câu
 * bị tính là sai — máy chủ quyết điều đó (`course_writing_grader._classify`), và
 * hai mặt vẽ chỉ việc nói lại cho đúng. Chúng là hai đoạn mã KHÁC NHAU, chép
 * tay từ nhau, nên đây đúng là chỗ để trôi khỏi nhau; mà cái trôi ấy không kêu:
 * một câu hiện "đúng" ở màn của em, "sai" ở màn của thầy, rồi hai bên ngồi lại
 * và cãi nhau về cùng một bài.
 *
 * Chạy THẬT hàm vẽ, không dò chuỗi trong mã nguồn: lỗi ở đây là về NGHĨA của
 * thứ hiện ra, mà một biểu thức chính quy thì không phân biệt được "đúng ngữ
 * pháp, còn lỗi trình bày" với "sai".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');

/** Bóc khối vẽ bản chấm ra khỏi module (module có side effect ở tầng cao nhất). */
function loadRenderer() {
  const start = SRC.indexOf('const CW_KIND');
  const end = SRC.indexOf('async function openStudentWriting');
  assert.ok(start !== -1 && end > start,
    'không tìm thấy khối vẽ bản chấm — module bị dựng lại?');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const hhmm = () => '08:22';

  return new Function('esc', 'hhmm',
    `${SRC.slice(start, end)}
     return { renderStudentWriting, cwFormOnly };`)(esc, hhmm);
}

// Bài thật của em Lê Ngọc Hà Linh, 07/08 — cùng dữ liệu bộ test phía học viên.
const FORM_ONLY = {
  qid: 'B01-E1-03', prompt: 'Viết lại theo khung SVOC',
  answer: 'i find the new timetable confusing',
  corrected: 'I find the new timetable confusing.', ok: true,
  issues: [{ type: 'mechanics', before: 'i', after: 'I',
             note: "Đại từ 'I' luôn phải viết hoa." }],
};
const REAL_ERROR = {
  qid: 'B01-E1-04', prompt: 'Viết MỘT câu khung SVOC',
  answer: 'air pollution make him tired',
  corrected: 'Air pollution makes him tired.', ok: false,
  issues: [{ type: 'mechanics', before: 'air', after: 'Air' },
           { type: 'grammar', before: 'make', after: 'makes', note: 'Chủ ngữ số ít.' }],
};
const CLEAN = {
  qid: 'B01-E1-05', prompt: 'Viết lại', answer: 'Most economists consider it risky.',
  corrected: 'Most economists consider it risky.', ok: true, issues: [],
};

const draw = (items) => loadRenderer().renderStudentWriting({
  submission: { items, total: items.length, clean: items.filter((g) => g.ok).length,
                model: 'gemini-3.1-flash-lite', graded_at: '2026-08-07T01:22:06Z' },
});

describe('mặt giáo viên: lỗi hình thức không đọc thành lỗi ngữ pháp', () => {
  test('câu đúng ngữ pháp mà còn lỗi trình bày vẫn hiện chỗ sửa, và tính là đúng', () => {
    const html = draw([FORM_ONLY]);
    assert.match(html, /data-ok="true"/);
    assert.match(html, /data-form="true"/, 'phải phân biệt được với câu sạch hẳn');
    assert.match(html, /hình thức/, 'nhãn loại lỗi phải nói đúng tên nó');
    assert.match(html, /Đại từ &#39;I&#39; luôn phải viết hoa/,
      'lời nhắc phải tới được mắt giáo viên, không bị nuốt');
    assert.match(html, /tính là đúng/);
    assert.doesNotMatch(html, /Không có lỗi/,
      'còn chỗ phải sửa thì đừng nói là không có lỗi');
  });

  test('câu sai thật vẫn là sai, dù lỗi hình thức đứng ngay cạnh', () => {
    const html = draw([REAL_ERROR]);
    assert.match(html, /data-ok="false"/);
    assert.doesNotMatch(html, /data-form="true"/);
    assert.match(html, /ngữ pháp/);
  });

  test('câu sạch hẳn KHÔNG bị gắn nhãn lỗi trình bày', () => {
    const html = draw([CLEAN]);
    assert.match(html, /data-ok="true"/);
    assert.doesNotMatch(html, /data-form="true"/);
    assert.match(html, /Không có lỗi/);
  });

  test('con số đếm theo NGỮ PHÁP, và nói ra còn bao nhiêu câu vướng trình bày', () => {
    const html = draw([FORM_ONLY, REAL_ERROR, CLEAN]);
    assert.match(html, /2<small>\/ 3 câu đúng ngữ pháp/);
    assert.match(html, /<strong>1<\/strong> câu đúng ngữ pháp nhưng còn lỗi trình bày/);
  });

  test('bản chấm CŨ (nhãn grammar cho lỗi viết hoa) vẫn vẽ y như trước', () => {
    // Không có bản chuyển đổi nào chạy sau lưng: những lượt nộp trước 07/08 giữ
    // nguyên `ok:false`, và màn hình phải kể lại đúng thứ đã được ghi.
    const html = draw([{ ...FORM_ONLY, ok: false,
                         issues: [{ type: 'grammar', before: 'i', after: 'I' }] }]);
    assert.match(html, /data-ok="false"/);
    assert.doesNotMatch(html, /data-form="true"/);
  });
});
