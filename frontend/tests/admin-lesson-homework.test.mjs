/**
 * Giao bài Speaking SAU BUỔI HỌC (ô giao bài, trang Lớp học).
 *
 * Khác bài hằng ngày ở ba chỗ, và cả ba đều hỏng được trong im lặng:
 *   · nguồn đề là kho THEO BUỔI của khoá, không phải kho chủ đề chung;
 *   · số câu do bộ đề quyết, mặc định giao trọn bộ (giáo viên TRỪ đi);
 *   · hạn nhập bằng SỐ NGÀY (1–90), và không bao giờ gửi kèm due_date.
 *
 * LEGACYJS-0075 W3b: admin-classes.js đã xoá. Ô giao bài giờ ở
 * admin-class-homework.tsx; `homeworkDraft` / `validateHomeworkDraft` /
 * `normalizeCatalog` (lib/admin-class-homework-model.mjs) được CHẠY THẬT.
 * Cờ "cần xem lại" và bảng tiến độ ghim ở phần cuối, trên
 * admin-class-submissions.tsx.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { homeworkDraft, normalizeCatalog, validateHomeworkDraft } from '../lib/admin-class-homework-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]');
const SRC = readFileSync(join(DIR, 'admin-class-homework.tsx'), 'utf8');
const SUB = readFileSync(join(DIR, 'admin-class-submissions.tsx'), 'utf8');

const sets = normalizeCatalog({ items: [
  { id: 'set-1', title: 'Hometown', lesson_no: 3, ready: true },
  { id: 'set-2', title: 'Work', lesson_no: 4, ready: true, already_given: true },
  { id: 'set-3', title: 'Travel', lesson_no: 5, ready: false, missing_audio: 2 },
] }, 'lesson');
const questions = [{ id: 'q1', ready: true }, { id: 'q2', ready: true }, { id: 'q3', ready: false }];
const lesson = (extra = {}) => validateHomeworkDraft({
  ...homeworkDraft(new Date('2026-08-01T00:00:00Z')),
  kind: 'lesson', skill: 'speaking', title: 'Sau buổi 3', contentId: 'set-1', ...extra,
}, sets, questions, 1);

describe('chọn loại bài', () => {
  test('dải chọn loại là radiogroup có nhãn; bài theo buổi ép Kỹ năng về Speaking', () => {
    assert.match(SRC, /<div className="ach-kind" role="radiogroup" aria-label="Loại bài">/);
    assert.match(SRC, /kind: 'lesson', skill: 'speaking', contentId: '', questionIds: \[\], error: ''/);
  });
  test('bài theo buổi: ô Kỹ năng biến mất, nguồn đề là kho theo buổi', () => {
    assert.match(SRC, /\{editor\?\.kind === 'daily' && <Field label="Kỹ năng">/);
    assert.match(SRC, /path = `\/admin\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}\/speaking-lesson-sets`; kind = 'lesson';/);
    assert.match(SRC, /editor\?\.kind === 'lesson' \? 'Bộ đề của buổi'/);
  });
  test('đổi loại bài giữa chừng thì bỏ nội dung và câu đã chọn', () => {
    assert.match(SRC, /kind: 'daily', contentId: '', questionIds: \[\], error: ''/);
  });
  test('hai cách nhập hạn không cùng hiện: số ngày cho bài theo buổi, ngày cho bài hằng ngày', () => {
    assert.match(SRC, /\{editor\?\.kind === 'lesson' \? <div className="acx-form-row"><Field label="Số ngày được nộp"><input type="number" min="1" max="90"/);
  });
});

describe('danh sách buổi', () => {
  test('buổi đã giao và buổi thiếu bản đọc vẫn hiện, bị khoá, kèm LÝ DO TÁCH RIÊNG', () => {
    assert.deepEqual(sets.map((s) => [s.id, s.ready && !s.already_given, s.reason]), [
      ['set-1', true, null],
      ['set-2', false, 'Đã giao cho lớp này'],
      ['set-3', false, 'Thiếu audio cho 2 câu'],
    ]);
    assert.match(SRC, /disabled=\{!item\.ready \|\| item\.already_given\}>/);
    assert.match(SRC, /item\.lesson_no != null \? `Buổi \$\{item\.lesson_no\} · ` : ''/);
  });
  test('kho đọc hỏng thì nói ra, không để danh sách rỗng im lặng', () => {
    assert.equal(normalizeCatalog({}, 'lesson'), null);
    assert.match(SRC, /if \(!normalized\) throw new Error\('Dữ liệu kho nội dung không đúng định dạng\.'\);/);
    assert.match(SRC, /setCatalogError\(messageOf\(caught\)\);/);
  });
});

describe('bấm Giao cho cả lớp', () => {
  test('gửi kind=lesson và due_days, TUYỆT ĐỐI không gửi due_date', () => {
    const v = lesson({ dueDays: '7' });
    assert.equal(v.ok, true);
    assert.equal(v.body.kind, 'lesson');
    assert.equal(v.body.skill, 'speaking');
    assert.equal(v.body.due_days, 7);
    assert.equal('due_date' in v.body, false);
  });
  test('giao TRỌN BỘ thì không gửi danh sách câu', () => {
    assert.equal(lesson().body.question_ids, null);
    assert.match(SRC, /editor\.kind === 'lesson' \? 'Giao cả bộ' : 'Web bốc ngẫu nhiên'/);
  });
  test('bớt câu thì gửi đúng danh sách còn lại, không có trần số câu', () => {
    assert.deepEqual(lesson({ questionMode: 'manual', questionIds: ['q2', 'q1'] }).body.question_ids, ['q2', 'q1']);
    assert.match(SRC, /editor\.kind === 'daily' && selectedOrder < 0 && editor\.questionIds\.length >= questionsPerGive/);
  });
  test('chưa chọn buổi, buổi đã giao, bỏ hết câu, hay số ngày ngoài khoảng: chặn tại chỗ', () => {
    assert.equal(lesson({ contentId: '' }).ok, false);
    assert.equal(lesson({ contentId: 'set-2' }).error, 'Đã giao cho lớp này');
    assert.deepEqual(lesson({ questionMode: 'manual', questionIds: [] }), { ok: false, error: 'Chọn ít nhất một câu đã sẵn sàng trong bộ đề.' });
    assert.equal(lesson({ questionMode: 'manual', questionIds: ['q3'] }).ok, false);
    for (const dueDays of ['0', '91', '1.5', '']) {
      assert.deepEqual(lesson({ dueDays }), { ok: false, error: 'Số ngày được nộp phải từ 1 đến 90.' }, dueDays);
    }
  });
  test('nút Giao được bật lại kể cả khi gửi hỏng', () => {
    assert.match(SRC, /catch \(caught\) \{ setEditor\(\{ \.\.\.editor, error: messageOf\(caught\) \}\); \}\s*finally \{ setBusy\(false\); \}/);
  });
});

describe('cờ trong bảng tổng kết', () => {
  test('mỗi cờ nói ĐỦ ba thứ: chuyện gì, vì sao, làm gì tiếp — có dấu mũi tên', () => {
    assert.match(SUB, /<li key=\{flag\.code \|\| flag\.label\} data-severity=\{flag\.severity\}><strong>\{flag\.label\}<\/strong><span>\{flag\.why\}<\/span><em>→ \{flag\.action/);
  });
  test('cờ đầu tiên hiện NGAY DƯỚI TÊN; số cần xem lại KHÔNG trừ vào số đã nộp', () => {
    assert.match(SUB, /\{row\.flags\.length > 0 && <small className="acs-row-flag">\{row\.flags\[0\]\.label\}<\/small>\}/);
    assert.match(SUB, /\{tally\.counts\.flagged > 0 && <em>\{tally\.counts\.flagged\} bài cần xem lại<\/em>\}/);
  });
  test('nội dung cờ không bao giờ đi qua HTML thô', () => {
    assert.doesNotMatch(SUB, /dangerouslySetInnerHTML/);
  });
});
