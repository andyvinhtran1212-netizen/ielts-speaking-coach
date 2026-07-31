/**
 * admin-exam-content-ui.test.mjs — bảng "Đề kỳ thi" (Đợt 3).
 *
 * The whole feature exists so an admin stops choosing papers from memory. That
 * only works if the table is WHERE the choosing happens and if it never lies
 * about what it is showing — a short list rendered silently is worse than no
 * list, because the admin acts on it (Codex review, PR #864).
 *
 * Source-sentinels: this is an IIFE driving a live admin DOM behind auth.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (...p) => readFileSync(join(__dirname, '..', 'public', ...p), 'utf8');

const JS = pub('js', 'admin-exam-content.js');
const HTML = pub('pages', 'admin', 'mock-exams', 'index.html');

describe('nó nằm ĐÚNG chỗ admin đang chọn đề', () => {
  test('bảng nằm trên trang Full Test, không phải một trang riêng', () => {
    // A separate page is one more place to remember — and the thing this
    // replaces was remembering.
    assert.match(HTML, /id="ec-list"/);
    assert.match(HTML, /admin-exam-content\.js/);
  });

  test('script tự thoát khi không phải trang này', () => {
    assert.match(JS, /if \(!document\.getElementById\('ec-list'\)\) return;/);
  });
});

describe('không bao giờ nói dối về danh sách', () => {
  test('thư viện lỗi được GỌI TÊN, không render thành rỗng', () => {
    assert.match(JS, /d\.failed_kinds/);
    assert.match(JS, /Không tải được/);
    assert.match(JS, /THIẾU/);
  });

  test('cảnh báo ẩn khi mọi thứ bình thường', () => {
    assert.match(JS, /warn\.hidden = !failed\.length;/);
    assert.match(HTML, /id="ec-warn"[^>]*hidden/);
  });
});

describe('sửa lớp phản ánh đúng việc máy chủ làm', () => {
  test('sửa CẢ TẬP, vì endpoint thay thế cả tập', () => {
    // Offering "add one" would misdescribe the server.
    assert.match(JS, /THAY THẾ toàn bộ/);
    assert.match(JS, /cohort_ids: ids/);
  });

  test('bấm Huỷ không bị hiểu thành "xoá hết"', () => {
    // prompt() returns null on cancel and '' on empty — collapsing the two
    // would silently unassign every class.
    assert.match(JS, /if \(picked === null\) return;/);
  });

  test('dùng PATCH — api.js không có put\\(\\) và PUT không nằm trong CORS', () => {
    assert.match(JS, /window\.api\.patch\(/);
    assert.doesNotMatch(JS, /window\.api\.put\(/);
  });
});

describe('an toàn hiển thị', () => {
  test('mọi giá trị từ máy chủ đều đi qua escape', () => {
    // Titles and codes are admin-authored content rendered into innerHTML.
    const render = JS.slice(JS.indexOf('function render()'));
    const body = render.slice(0, render.indexOf('host.querySelectorAll'));
    for (const field of ['r.kind', 'r.title', 'r.code', 'r.status', 'r.course_level']) {
      assert.match(body, new RegExp('esc\\(' + field.replace('.', '\\.')));
    }
  });

  test('dùng escaper dùng chung, không tự chế', () => {
    assert.match(JS, /window\.WC && window\.WC\.escapeHtml/);
  });
});
