/**
 * admin-student-listening.test.mjs — audit 2026-07-17 đợt 3: mục Listening
 * trong hồ sơ học viên (drawer). Source sentinels.
 *
 * LEGACYJS-0075 W3b: admin-students-panel.js đã xoá; hồ sơ học viên giờ là
 * dialog hồ sơ trong /admin/students (admin-students-directory.tsx). Hai
 * deep-link sang báo cáo listening và kiểu cảnh báo cho "Bỏ dở" chưa có trên
 * Next — ghi là gap trong docs/TEST_INVARIANT_LEDGER.md, không sửa ở đây.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PAGE = read('app', '(authed-admin)', '(students)', 'admin', 'students', 'admin-students-directory.tsx');

describe('hồ sơ học viên — mục Listening', () => {
  test('có 4 stat: lượt làm, đúng TB, bỏ dở, chép chính tả', () => {
    assert.match(PAGE, /<h3>Listening<\/h3>/);
    for (const [label, field] of [['Tổng lượt', 'attempts_total'], ['Bỏ dở', 'attempts_abandoned'], ['Chép chính tả', 'dictation_total']]) {
      assert.match(PAGE, new RegExp(`<span>${label}</span><strong>\\{String\\(listening\\.${field} \\?\\? 0\\)\\}`), `thiếu ${label}`);
    }
    assert.match(PAGE, /<span>Độ chính xác TB<\/span>/);
  });
  test('render từ detail.listening; độ chính xác rỗng hiện —, không thành 0%', () => {
    assert.match(PAGE, /const listening = record\(profile\?\.detail\?\.listening\)/);
    assert.match(PAGE, /listening\.avg_accuracy == null \? '—' : `\$\{Math\.round\(Number\(listening\.avg_accuracy\) \* 100\)\}%`/);
  });
  test('chưa kích hoạt tài khoản hoặc đọc lỗi → nói rõ, không im lặng', () => {
    assert.match(PAGE, /Chưa kích hoạt tài khoản — chưa có dữ liệu listening\./);
    assert.match(PAGE, /Không đọc được dữ liệu listening\./);
  });
});
