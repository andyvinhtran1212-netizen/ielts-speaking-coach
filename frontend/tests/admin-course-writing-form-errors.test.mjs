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
 *
 * LEGACYJS-0075 W3b: `public/js/admin-classes.js` is deleted; the teacher-side
 * report is `WritingReport` in the Next submissions panel. The same rules are
 * pinned on it (the student side is pinned by its own tests).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'app', '(authed-admin-classes)', 'admin', 'classes',
  '[cohortId]', 'admin-class-submissions.tsx'), 'utf8');
const start = SRC.indexOf('function WritingReport');
const REPORT = SRC.slice(start, SRC.indexOf('\n}\n', start));

describe('mặt giáo viên: lỗi hình thức không đọc thành lỗi ngữ pháp', () => {
  test('câu đúng ngữ pháp mà còn lỗi trình bày: data-form, vẫn tính là đúng, vẫn hiện chỗ sửa và lời nhắc', () => {
    assert.ok(start !== -1, 'WritingReport not found');
    assert.match(REPORT, /const formOnly = ok === true && issues\.length > 0;/);
    assert.match(REPORT, /data-ok=\{ok == null \? 'unknown' : String\(ok\)\} data-form=\{formOnly \|\| undefined\}/);
    assert.match(REPORT, /\{formOnly && <p[^>]*>Đúng ngữ pháp, còn lỗi trình bày — tính là đúng\.<\/p>\}/);
    assert.match(REPORT, /\{note \? ` · \$\{note\}` : ''\}/);
  });
  test('nhãn loại lỗi nói đúng tên nó', () => {
    assert.match(SRC, /const ISSUE_KIND = \{ grammar: 'ngữ pháp', spelling: 'chính tả', mechanics: 'hình thức' \}/);
  });
  test('câu sai thật vẫn là sai (ok:false không bao giờ là form-only)', () => {
    assert.doesNotMatch(REPORT, /formOnly = [^;]*ok === false/);
  });
  test('câu sạch hẳn mới nói "Không có lỗi", còn chỗ sửa thì không', () => {
    assert.match(REPORT, /\{ok === true && !formOnly && <p[^>]*>Không có lỗi ngữ pháp hay chính tả\.<\/p>\}/);
  });
  test('con số đếm theo NGỮ PHÁP (clean / total do máy chủ quyết)', () => {
    assert.match(REPORT, /<strong>\{submission\.clean\}<\/strong><span>\/ \{submission\.total\} câu đúng ngữ pháp<\/span>/);
  });
  test('bản chấm CŨ được kể lại đúng như đã ghi: ok đọc thẳng từ bản ghi, không suy lại', () => {
    assert.match(REPORT, /const ok = item\.ok;/);
  });
});
