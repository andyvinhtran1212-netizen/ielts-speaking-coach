/**
 * Nút TRẢ BÀI trong khu Nhận bài của giáo viên.
 *
 * Ngày 07/08 em Lê Ngọc Hà Linh nộp nhầm phần tự luận sau bốn giây, và mở lại
 * cho em ấy phải chạy SQL tay trên máy chủ thật. Đây là đường trong sản phẩm
 * cho đúng việc ấy — nên nó phải có ba tính chất, và cả ba đều dễ đánh rơi:
 *
 *   · HỎI TRƯỚC — nó vứt lượt nộp hiện tại khỏi sổ;
 *   · ĐỌC LẠI bảng từ máy chủ sau khi ghi, không tự sửa dòng đang cầm trên tay;
 *   · lỗi thì kể NGUYÊN CÂU của máy chủ, vì câu ấy nói phải làm gì trước
 *     ("dời hạn nộp trước đã").
 *
 * LEGACYJS-0075 W3b: admin-classes.js đã xoá. Nút và hộp hỏi giờ ở
 * admin-class-submissions.tsx; `canReturnSubmission` được CHẠY THẬT, luồng
 * `returnWork` được ghim trên mã nguồn Next.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { canReturnSubmission } from '../lib/admin-class-submissions-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-submissions.tsx'), 'utf8');
const AT = SRC.indexOf('const returnWork = async');
const FLOW = SRC.slice(AT, SRC.indexOf('\n  };\n', AT));
const DIALOG = SRC.slice(SRC.indexOf('<Dialog open={Boolean(returning)}'));

describe('trả bài: hỏi trước, ghi sau, rồi đọc lại', () => {
  test('bấm nút chỉ MỞ hộp hỏi — chưa ghi gì', () => {
    assert.match(SRC, /onClick=\{\(\) => setReturning\(row\)\} disabled=\{loading\}>Trả bài<\/button>/);
    // Lệnh ghi chỉ có trong returnWork, và returnWork chỉ chạy từ nút của hộp hỏi.
    assert.equal((SRC.match(/\/return\/\$\{/g) || []).length, 1);
    assert.match(DIALOG, /onClick=\{\(\) => void returnWork\(\)\} disabled=\{loading\}>Trả bài<\/button>/);
  });

  test('hộp hỏi nói rõ chuyện gì xảy ra, kể cả chỗ bài viết vẫn được giữ', () => {
    assert.match(DIALOG, /title="Trả bài cho học viên làm lại\?"/);
    assert.match(DIALOG, /không còn tính là đã nộp/);
    assert.match(DIALOG, /Bài cũ và bản chấm vẫn được giữ/);
    assert.match(DIALOG, /câu đã viết sẽ được khôi phục/);
    assert.match(DIALOG, /Chỉ thực hiện được khi bài còn nhận nộp\./);
  });

  test('xác nhận rồi mới gọi đúng đường của lớp/bài giao/học viên ấy', () => {
    assert.match(FLOW, /window\.api\.post<[^>]+>\(`\/admin\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}\/assignments\/\$\{encodeURIComponent\(assignment\.id\)\}\/return\/\$\{encodeURIComponent\(row\.student_id\)\}`, \{\}\)/);
  });

  test('ghi xong thì ĐỌC LẠI bảng tổng kết, không tự sửa dòng đang cầm', () => {
    assert.match(FLOW, /const canonical = await loadTally\(true\); await onMutation\(\);/);
    assert.match(FLOW, /'Đã trả bài nhưng chưa đọc lại được sổ chuẩn\.'/);
  });

  test('nói luôn em ấy mở ra thấy BÀI CŨ hay TRANG TRẮNG', () => {
    assert.match(FLOW, /`Đã trả bài\. \$\{restored\} câu đã được đưa lại vào ô nhập của học viên\.`/);
    assert.match(FLOW, /kind: restored \? 'success' : 'error'/);
    assert.match(FLOW, /'Đã trả bài nhưng không khôi phục được câu nào; học viên phải viết lại\.'/);
  });

  test('máy chủ từ chối thì kể NGUYÊN CÂU, và KHÔNG báo là đã trả', () => {
    assert.match(FLOW, /catch \(caught\) \{ setBanner\(\{ kind: 'error', text: `Chưa trả được bài: \$\{messageOf\(caught\)\}` \}\); \}/);
    const tryBody = FLOW.slice(FLOW.indexOf('try {'), FLOW.indexOf('catch (caught)'));
    assert.ok(tryBody.indexOf('window.api.post') < tryBody.indexOf('loadTally(true)'), 'đọc lại bảng chỉ sau khi ghi thành công');
  });
});

describe('nút chỉ hiện khi CÓ bài để trả', () => {
  test('chỉ trả được khi bài giao đang mở và chưa khoá sổ', () => {
    assert.equal(canReturnSubmission('published', false), true);
    assert.equal(canReturnSubmission('published', true), false);
    assert.equal(canReturnSubmission('published', undefined), false, 'không đọc được trạng thái sổ thì không mở nút');
    assert.equal(canReturnSubmission('archived', false), false);
  });
  test('nút gắn theo bài tự luận đã nộp và canReturnWork, không gắn vô điều kiện', () => {
    assert.match(SRC, /const canReturnWork = canReturnSubmission\(assignment\.status, tally\?\.sealed\);/);
    assert.match(SRC, /\{row\.has_writing && canReturnWork && <button/);
    assert.match(FLOW, /if \(!canReturnWork\) \{[\s\S]*?'Mở lại bài giao trước khi trả bài cho học viên\.' : 'Dời hạn nộp trước khi trả bài cho học viên\.'/);
  });
});
