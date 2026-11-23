/**
 * Bộ chọn câu hỏi khi giao bài Speaking.
 *
 * Thao tác HẰNG NGÀY, nên mọi phép kiểm ở đây là về việc giáo viên làm nhanh và
 * không bị đánh lừa — không phải về vẻ ngoài.
 *
 * Ý chính: THỨ TỰ CHỌN LÀ THÔNG TIN. Part 1 là một mạch hội thoại và backend
 * giữ đúng thứ tự bấm, nên số thứ tự phải hiện cạnh câu và payload phải mang
 * đúng thứ tự ấy.
 *
 * LEGACYJS-0075 W3b: admin-classes.js đã xoá. Bộ chọn giờ ở
 * admin-class-homework.tsx; `homeworkDraft` / `validateHomeworkDraft` /
 * `normalizeQuestions` (lib/admin-class-homework-model.mjs) được CHẠY THẬT.
 * Ca "đúng số câu sẵn sàng" và trình phát dùng chung còn được ghim ở
 * admin-class-homework-next-behavior.test.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { homeworkDraft, normalizeQuestions, validateHomeworkDraft } from '../lib/admin-class-homework-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-homework.tsx'), 'utf8');

const catalog = [{ id: 'topic-1', title: 'Hometown', ready: true, already_given: false }];
const questions = [
  { id: 'q1', ready: true }, { id: 'q2', ready: true }, { id: 'q3', ready: false },
];
const give = (extra) => validateHomeworkDraft({
  ...homeworkDraft(new Date('2026-08-01T00:00:00Z')),
  kind: 'daily', skill: 'speaking', title: 'Bài 1', contentId: 'topic-1', ...extra,
}, catalog, questions, 2);

describe('thứ tự chọn là thứ tự học viên nghe', () => {
  test('payload mang question_ids ĐÚNG thứ tự bấm', () => {
    assert.deepEqual(give({ questionMode: 'manual', questionIds: ['q2', 'q1'] }).body.question_ids, ['q2', 'q1']);
  });
  test('số thứ tự hiện cạnh câu đã chọn, kèm nhãn cho trình đọc màn hình', () => {
    assert.match(SRC, /const selectedOrder = editor\.questionIds\.indexOf\(question\.id\);/);
    assert.match(SRC, /<strong className="ach-question-order"><span className="sr-only">Thứ tự chọn <\/span>\{selectedOrder \+ 1\}<\/strong>/);
  });
  test('bỏ chọn một câu thì các câu sau dồn lên', () => {
    assert.match(SRC, /questionIds: current\.questionIds\.includes\(id\) \? current\.questionIds\.filter\(\(item\) => item !== id\) : \[\.\.\.current\.questionIds, id\]/);
  });
});

describe('ràng buộc số câu', () => {
  test('sai số câu hoặc câu chưa sẵn sàng bị chặn ở client', () => {
    assert.deepEqual(give({ questionMode: 'manual', questionIds: ['q1'] }), { ok: false, error: 'Chọn đúng 2 câu đã sẵn sàng.' });
    assert.equal(give({ questionMode: 'manual', questionIds: ['q1', 'q3'] }).ok, false);
  });
  test('đủ số rồi thì câu chưa chọn bị khoá (bài hằng ngày)', () => {
    assert.match(SRC, /disabled=\{!question\.ready \|\| \(editor\.kind === 'daily' && selectedOrder < 0 && editor\.questionIds\.length >= questionsPerGive\)\}/);
  });
});

describe('câu chưa sẵn sàng vẫn HIỆN, kèm lý do', () => {
  test('giveable=false thành ready=false, lý do giọng đọc tách khỏi thiếu audio', () => {
    const n = normalizeQuestions({ questions_per_give: 3, items: [
      { id: 'a', question_text: 'A', giveable: false, blocked_by: 'voice' },
      { id: 'b', question_text: 'B', giveable: true, audio_url: 'https://x/b.mp3' },
    ] });
    assert.equal(n.questions_per_give, 3);
    assert.deepEqual(n.items.map((q) => [q.id, q.ready, q.blocked_by]), [['a', false, 'voice'], ['b', true, null]]);
    assert.match(SRC, /question\.blocked_by === 'voice' \? 'Cần đồng bộ giọng đọc của chủ đề' : 'Chưa có audio sẵn sàng'/);
  });
});

describe('chế độ chọn', () => {
  test('hai lựa chọn, mặc định là web bốc', () => {
    assert.equal(homeworkDraft().questionMode, 'random');
    assert.match(SRC, /role="radiogroup" aria-label="Cách chọn câu"/);
    assert.match(SRC, /'Web bốc ngẫu nhiên'/);
    assert.match(SRC, /Tôi tự chọn/);
  });
  test('chỉ gửi question_ids khi giáo viên THẬT SỰ đã chọn', () => {
    assert.equal(give({ questionMode: 'random', questionIds: ['q1', 'q2'] }).body.question_ids, null);
  });
  test('đổi cách chọn thì bỏ lựa chọn cũ', () => {
    assert.match(SRC, /questionMode: 'random', questionIds: \[\], error: ''/);
    assert.match(SRC, /questionMode: 'manual', questionIds: \[\], error: ''/);
  });
  test('phản hồi đến muộn không vẽ đè chủ đề đang chọn', () => {
    assert.match(SRC, /const requestId = \+\+questionSequence\.current;/);
    assert.match(SRC, /if \(requestId !== questionSequence\.current\) return;/);
  });
  test('đổi chủ đề hoặc Part thì tải lại câu', () => {
    assert.match(SRC, /speaking-topics\/\$\{encodeURIComponent\(draft\.contentId\)\}\/questions\?part=\$\{draft\.part\}/);
    assert.match(SRC, /\}, \[editor\?\.questionMode, editor\?\.contentId, editor\?\.kind, editor\?\.skill, editor\?\.part, loadQuestions\]\);/);
  });
});

describe('nghe thử', () => {
  test('nút nghe nằm NGOÀI ô chọn và có nhãn riêng', () => {
    assert.match(SRC, /<\/label>\s*\{question\.audio_url && <button className="adm-btn-secondary adm-btn-sm" type="button" aria-label=\{`\$\{previewingQuestion === question\.id \? 'Dừng nghe' : 'Nghe thử'\}: \$\{question\.text\}`\}/);
  });
  test('một trình phát dùng chung; bấm lại thì dừng; hỏng thì nhả trạng thái', () => {
    assert.match(SRC, /if \(previewingQuestion === question\.id && previewAudio\.current\) \{\s*stopQuestionPreview\(\); return;/);
    assert.match(SRC, /previewAudio\.current\?\.pause\(\);\s*const audio = new Audio\(question\.audio_url\);/);
    assert.match(SRC, /audio\.addEventListener\('error', clear, \{ once: true \}\);\s*void audio\.play\(\)\.catch\(clear\);/);
  });
  test('câu chưa có bản đọc thì không có nút nghe', () => {
    assert.match(SRC, /if \(!question\.audio_url\) return;/);
  });
});
