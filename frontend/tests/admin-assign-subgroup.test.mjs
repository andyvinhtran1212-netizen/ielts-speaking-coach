/**
 * Giao bài cho MỘT NHÓM, và bù học viên mới vào bài đã giao.
 *
 * Hai lỗ hổng có thật: em vào lớp sau ngày giao thì bài vô hình với em, và
 * muốn giao riêng cho vài em thì phải giao cả lớp rồi dặn miệng.
 *
 * LEGACYJS-0075 W3b: `public/js/admin-classes.js` is deleted. Giving, backfill
 * and the effort report live in the Next class panels
 * (`admin-class-homework.tsx`, `admin-class-submissions.tsx`) and their models;
 * the same invariants are pinned there.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { homeworkDraft, validateHomeworkDraft } from '../lib/admin-class-homework-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]');
const HW = readFileSync(join(DIR, 'admin-class-homework.tsx'), 'utf8');
const SUB = readFileSync(join(DIR, 'admin-class-submissions.tsx'), 'utf8');

const catalog = [{ id: 'topic-1', ready: true, already_given: false }];
const give = (extra) => validateHomeworkDraft({
  ...homeworkDraft(new Date('2026-08-01T00:00:00Z')),
  kind: 'daily', skill: 'speaking', title: 'Bài 1', contentId: 'topic-1', ...extra,
}, catalog, [], 1);

describe('giao cho một nhóm', () => {
  test('mọi lệnh giao đi qua MỘT payload, luôn mang người nhận', () => {
    assert.equal(give({}).body.student_ids, null);
    assert.deepEqual(give({ recipientScope: 'subset', studentIds: ['s1', 's2'] }).body.student_ids, ['s1', 's2']);
  });
  test('bỏ trống = CẢ LỚP, gửi null chứ không phải mảng rỗng', () => {
    const body = give({ recipientScope: 'class', studentIds: [] }).body;
    assert.equal(body.student_ids, null);
  });
  test('mở hộp thoại thì quay về cả lớp', () => {
    assert.equal(homeworkDraft().recipientScope, 'class');
    assert.deepEqual(homeworkDraft().studentIds, []);
  });
  test('chọn nhóm mà chưa chọn ai thì không giao được', () => {
    const out = give({ recipientScope: 'subset', studentIds: [] });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'Chọn ít nhất một học viên nhận bài.');
  });
  test('khối chọn người nhận có trong hộp thoại, đọc từ sĩ số đã nạp', () => {
    assert.ok(HW.includes('<Field label="Giao cho"><select aria-label="Giao cho" value={editor?.recipientScope || \'class\'}'));
    assert.ok(HW.includes("{editor?.recipientScope === 'subset' && <div className=\"ach-recipient-list\">{members.map((member) =>"));
  });
});

describe('nút nói rõ nó sắp giao cho ai', () => {
  test('cả lớp hay số em được chọn', () => {
    assert.ok(HW.includes("editor?.recipientScope === 'subset' ? `Giao cho ${editor.studentIds.length} học viên` : 'Giao cho cả lớp'"));
  });
  test('danh sách đọc đúng hình dạng /members (tên + student_id), không gọi mạng khi mở hộp thoại', () => {
    assert.ok(HW.includes('<label key={member.student_id}><input type="checkbox" checked={editor.studentIds.includes(member.student_id)}') || /editor\.studentIds\.includes\(member\.student_id\)/.test(HW));
    assert.ok(HW.includes('<span>{member.name}</span>'));
    assert.doesNotMatch(HW, /member\.(display_name|email)/);
  });
});

describe('bù học viên vào bài đã giao', () => {
  test('gọi đúng đường, cả lớp gửi body rỗng, nhóm gửi danh sách', () => {
    assert.ok(HW.includes('/assignments/${encodeURIComponent(backfill.assignment.id)}/backfill`, subset ? { student_ids: backfill.studentIds } : {})'));
  });
  test('không có ai để bù thì NÓI RA, không im lặng', () => {
    assert.ok(HW.includes("'Mọi học viên phù hợp đều đã có bài này.'"));
  });
  test('bù xong nạp lại theo dữ liệu chuẩn', () => {
    assert.match(HW, /setBackfill\(null\);\s*await canonicalMutation\(/);
  });
});

describe('bù người nhận không được mở rộng phạm vi bài giao', () => {
  test('bài giao theo NHÓM thì mở BẢNG TICK theo phạm vi của chính bài giao', () => {
    assert.ok(HW.includes("const subset = backfill.assignment.recipient_scope === 'subset';"));
    assert.ok(HW.includes("{backfill?.assignment.recipient_scope === 'subset' && <div className=\"ach-recipient-list\">"));
    assert.ok(HW.includes('<input type="checkbox" checked={backfill.studentIds.includes(member.student_id)}'));
    assert.doesNotMatch(HW, /window\.prompt/);
  });
  test('chưa chọn ai thì không gửi', () => {
    assert.ok(HW.includes("if (subset && !backfill.studentIds.length) { setBackfill({ ...backfill, error: 'Chọn ít nhất một học viên cần thêm.' }); return; }"));
  });
  test('Huỷ thì không gửi gì', () => {
    assert.ok(HW.includes('onClick={() => setBackfill(null)} disabled={busy}>Hủy</button>'));
  });
});

describe('chi tiết làm bài', () => {
  test('mở theo BANK, kèm id bài giao', () => {
    assert.ok(SUB.includes('/admin/quiz/banks/${encodeURIComponent(bankId)}/attempt-report?assignment_id=${encodeURIComponent(assignment.id)}'));
  });
  test('mọi tình trạng đều có chữ tiếng Việt riêng', () => {
    const line = SUB.split('\n').find((l) => l.startsWith('const EFFORT_BASE'));
    for (const s of ['stalled', 'doing', 'done', 'untouched', 'completing_sections', 'needs_retry']) {
      assert.ok(line.includes(`${s}: '`), `thiếu nhãn cho '${s}'`);
    }
    assert.ok(line.includes("completing_sections: 'Còn phần chưa xong'"));
    assert.ok(line.includes("needs_retry: 'Chưa đạt · cần làm lại'"));
  });
  test('em chưa kích hoạt vẫn có tên và được đánh dấu', () => {
    assert.ok(HW.includes('{!member.user_id && <small>chưa kích hoạt</small>}'));
    assert.ok(SUB.includes("no_account: 'Chưa kích hoạt'"));
  });
});

describe('rỗng-vì-hỏng khác rỗng-thật', () => {
  test('báo cáo thiếu thì cảnh báo; đọc hỏng không nói "chưa có ai mở bài"', () => {
    assert.ok(SUB.includes('{effort.stale && <div className="acd-warning">'));
    assert.ok(SUB.includes("{effort.stale ? 'Chưa đọc được danh sách lượt làm' : 'Chưa có ai mở bài này'}"));
  });
});

describe('xong chặng chưa phải xong toàn bộ bài', () => {
  test('bảng tổng hợp số phần, lượt, điểm gộp và tổng thời gian', () => {
    assert.ok(SUB.includes('{row.sections_done}/{row.sections_total} phần'));
    assert.ok(SUB.includes('row.combined_pct == null'));
    assert.ok(SUB.includes("′ tổng"));
  });
  test('bảng "Xem ai nộp" nói ra khi chưa nộp tự luận', () => {
    assert.ok(SUB.includes('Học viên này chưa nộp phần tự luận.'));
  });
});
