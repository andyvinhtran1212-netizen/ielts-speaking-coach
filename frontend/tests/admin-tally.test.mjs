/**
 * Bảng tổng kết nộp bài — đọc ra SỰ VẮNG MẶT.
 *
 * Việc của bảng này không phải liệt kê ai đã nộp; giữa lớp 30 em, 26 dấu tick
 * là nhiễu che mất 4 chỗ trống. Nó phải trả lời "ai chưa nộp" trong một cái
 * liếc, và phải phân biệt được TRƯỚC hạn (số còn đổi) với SAU hạn (đã chốt).
 *
 * LEGACYJS-0075 W3b: admin-classes.js đã xoá. Khu nhận bài giờ là
 * admin-class-submissions.tsx; `normalizeTally` (lib/admin-class-submissions-
 * model.mjs) được CHẠY THẬT. Phần course (đạt / gần đạt / làm lại), effort và
 * báo cáo từng em được ghim ở admin-class-submissions-next-behavior.test.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTally } from '../lib/admin-class-submissions-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-submissions.tsx'), 'utf8');

const tally = (students, extra = {}) => normalizeTally({
  assignment: { id: 'a1', title: 'Bài hôm nay', skill: 'speaking', due_at: '2026-08-03T19:00:00+07:00' },
  counts: { total: students.length, submitted: 1, late: 0, missing: 0, no_account: 0 },
  students, ...extra,
});

describe('trạng thái từng dòng', () => {
  test('mỗi trạng thái có CHỮ riêng: chưa nộp / không nộp / nộp trễ / chưa kích hoạt', () => {
    assert.match(SRC, /const STATUS = \{ 'no-account': 'Chưa kích hoạt', missing: 'Không nộp', pending: 'Chưa nộp', late: 'Nộp trễ', submitted: 'Đã nộp' \}/);
  });
  test('dòng thiếu trạng thái đọc là "chưa nộp", không bịa ra đã nộp', () => {
    assert.equal(tally([{ student_id: 's1', name: 'An' }]).students[0].status, 'pending');
  });
  test('chưa chấm hiện dấu gạch, KHÔNG hiện 0.0; điểm 0 THẬT vẫn là 0.0', () => {
    const t = tally([{ student_id: 's1', name: 'An', score: null }, { student_id: 's2', name: 'Bình', score: 0 }]);
    assert.equal(t.students[0].score, null);
    assert.equal(t.students[1].score, 0);
    assert.match(SRC, /row\.score == null \? '—' : assignment\.skill === 'course' \? [\s\S]*? : row\.score\.toFixed\(1\)/);
  });
  test('bài course hiện PHẦN TRĂM, không phải band', () => {
    assert.match(SRC, /<strong>\{Math\.round\(row\.score\)\}%<\/strong>/);
  });
});

describe('giờ đọc theo giờ Việt Nam', () => {
  test('giờ nộp và hạn đọc theo Asia/Ho_Chi_Minh; giờ hỏng không làm vỡ bảng', () => {
    const fn = SRC.slice(SRC.indexOf('function formatVietnam'), SRC.indexOf('function openArtifact'));
    assert.match(fn, /timeZone: 'Asia\/Ho_Chi_Minh'/);
    assert.match(fn, /Number\.isNaN\(date\.getTime\(\)\) \? 'Không rõ'/);
  });
});

describe('trước hạn và sau hạn phải phân biệt được', () => {
  test('sổ chỉ "đã chốt" khi máy chủ nói đúng true', () => {
    assert.equal(tally([], { sealed: true }).sealed, true);
    assert.equal(tally([], { sealed: 'yes' }).sealed, false);
  });
  test('trạng thái là một CHỮ: Đang nhận bài / Đã chốt / Đã đóng bài', () => {
    assert.match(SRC, /\{assignment\.status !== 'published' \? 'Đã đóng bài' : tally\.sealed \? 'Đã chốt' : 'Đang nhận bài'\}/);
  });
  test('đếm đã nộp trên tổng, và số cần xem lại không trừ vào đã nộp', () => {
    assert.match(SRC, /<strong>\{tally\.counts\.submitted\}<\/strong><span>\/ \{tally\.counts\.total\} đã nộp<\/span>\{tally\.counts\.flagged > 0 && <em>\{tally\.counts\.flagged\} bài cần xem lại<\/em>\}/);
  });
  test('sổ chưa đối chiếu được, hoặc chưa rõ cấu trúc phần, thì nói ra', () => {
    const t = tally([], { homework_stale: true, sections_shape_unknown: true });
    assert.equal(t.homework_stale, true);
    assert.equal(t.sections_shape_unknown, true);
    assert.match(SRC, /Chưa xác định được các phần bắt buộc của bộ bài; không dùng mẫu số hoàn thành/);
    assert.match(SRC, /Chưa đối chiếu được một phần dữ liệu; các con số có thể còn thiếu\./);
  });
  test('payload hỏng là lỗi, không phải bảng rỗng', () => {
    assert.equal(normalizeTally({ assignment: { id: 'a1', title: 'T', skill: 'speaking' } }), null);
  });
});

describe('nhận bài là một KHU, không phải popup', () => {
  test('các tab dùng role=tab trong một tablist có nhãn', () => {
    assert.match(SRC, /<nav className="acs-tabs" role="tablist" aria-label="Cách xem bài nộp">/);
    assert.match(SRC, /id="acs-tab-tally" type="button" role="tab"/);
  });
  test('đổi bài hay đổi em giữa chừng: phản hồi cũ không ghi đè', () => {
    assert.match(SRC, /const requestId = \+\+sequence\.current;/);
    assert.match(SRC, /if \(requestId !== sequence\.current\) return false;/);
    assert.match(SRC, /return \(\) => \{ sequence\.current \+= 1; \};/);
  });
});

describe('lỗi đọc bảng tổng kết là LỜI MỜI, không phải ngõ cụt', () => {
  test('có nút Thử lại được nối', () => {
    assert.match(SRC, /<strong>Không đọc được dữ liệu mới nhất<\/strong><span>\{error\}<\/span><button className="adm-btn-secondary" type="button" onClick=\{retryCurrent\}>Thử lại<\/button>/);
  });
});
