/**
 * Bảng bài Speaking hằng ngày (học viên × ngày) + đường mở thẳng bài làm.
 *
 * Hai thứ giáo viên trước đây KHÔNG làm được: nhìn một phát ra "em nào đứt
 * quãng", và nghe bài của một em mà không phải mò trong danh sách phiên toàn
 * hệ thống.
 *
 * LEGACYJS-0075 W3b: admin-classes.js đã xoá. Lưới ngày (`renderDailyBoard`)
 * CHƯA có bản Next — ghi là gap trong docs/TEST_INVARIANT_LEDGER.md, không dựng
 * lại ở đây. Đường mở thẳng bài làm và màn đọc bài tự luận nay ở
 * admin-class-submissions.tsx và được ghim bên dưới; trang phiên Speaking giữ
 * nguyên các ghim của nó.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUB = readFileSync(join(HERE, '..', 'app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]', 'admin-class-submissions.tsx'), 'utf8');
// LEGACYJS-0075 W4b: admin-speaking-sessions.js is deleted; the Next sessions
// page and its model own the deep link and the feedback report.
const SESS = readFileSync(join(HERE, '..', 'app', '(authed-admin)', '(speaking-sessions)', 'admin', 'speaking', 'sessions', 'admin-speaking-sessions.tsx'), 'utf8');
const SESS_MODEL = readFileSync(join(HERE, '..', 'lib', 'admin-speaking-sessions-model.mjs'), 'utf8');
const ARTIFACT = SUB.slice(SUB.indexOf('function openArtifact'), SUB.indexOf('function InlineMd'));
const WRITING = SUB.slice(SUB.indexOf('function WritingReport'), SUB.indexOf('function evidenceText'));

describe('mở thẳng bài làm từ bảng tổng kết', () => {
  test('có phiên thì mở trang phiên Speaking theo ?session=', () => {
    assert.match(ARTIFACT, /if \(row\.artifact_kind === 'session' && row\.artifact_id\) return `\/admin\/speaking\/sessions\?session=\$\{encodeURIComponent\(row\.artifact_id\)\}`;/);
    assert.match(SUB, /grammarLesson \? 'Xem từng câu' : 'Nghe & xem'/);
  });
  test('chưa có bài thì KHÔNG có liên kết dẫn tới trang trống', () => {
    assert.match(ARTIFACT, /return null;\s*\}\s*$/);
    assert.match(SUB, /\{href && <a className="adm-btn-secondary adm-btn-sm" href=\{href\}/);
  });
  test('mỗi kỹ năng mở ở trang của nó, không đoán từ id', () => {
    for (const kind of ['session', 'reading_attempt', 'listening_attempt', 'grammar_diagnostic', 'grammar_lesson_attempt']) {
      assert.match(ARTIFACT, new RegExp(`row\\.artifact_kind === '${kind}' && row\\.artifact_id`), kind);
    }
  });
});

describe('trang phiên Speaking', () => {
  test('nhận deep-link ?session=', () => {
    assert.match(SESS, /const selectedId = params\?\.get\('session'\)\?\.trim\(\) \|\| null/);
    assert.match(SESS, /if \(selectedId\) void loadDetail\(selectedId\)/);
  });
  test('modal phiên có BÁO CÁO NHẬN XÉT, không chỉ band + audio', () => {
    assert.match(SESS, /function FeedbackReport\(/);
    assert.match(SESS, /<FeedbackReport feedback=\{response\.feedback\} \/>/);
    for (const k of ['fc_feedback', 'lr_feedback', 'gra_feedback', 'p_feedback',
                     'strengths', 'improvements', 'grammar_issues']) {
      assert.ok(SESS_MODEL.includes(k), `báo cáo phải đọc ${k}`);
    }
  });
});

describe('màn đọc bài tự luận của admin', () => {
  test('chưa nộp thì NÓI RÕ, không hiện một khung rỗng', () => {
    assert.match(WRITING, /if \(!submission\) return <p className="acd-muted">Học viên này chưa nộp phần tự luận\.<\/p>;/);
  });
  test('nút chỉ hiện khi THẬT SỰ có bài để đọc', () => {
    assert.match(SUB, /row\.has_writing \? 'Xem bài' : 'Xem từng câu'/);
    assert.match(SUB, /\{row\.has_writing && canReturnWork && <button/);
  });
  test('đề được dựng (không hiện ** thô); bài HỌC VIÊN VIẾT để nguyên chữ', () => {
    assert.match(WRITING, /<p><InlineMd text=\{prompt\} \/><\/p><blockquote>\{answer\}<\/blockquote>/);
  });
  test('không dựng HTML thô từ bài người khác viết', () => {
    assert.doesNotMatch(SUB, /dangerouslySetInnerHTML/);
  });
});
