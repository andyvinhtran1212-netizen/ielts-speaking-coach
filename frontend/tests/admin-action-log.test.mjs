/**
 * Nhật ký thao tác của giáo viên — mặt đọc.
 *
 * Đổi hạn (#1005) và Trả bài (#1000) đều sửa thứ học viên nhìn thấy. Nhật ký
 * này tồn tại để ba tháng sau còn trả lời được "ai đổi, lúc nào, từ gì sang gì"
 * khi một em hỏi vì sao bài mình thành nộp trễ — nên hai điều phải đúng:
 *
 *   · dòng nhật ký nói được TRƯỚC → SAU, không chỉ "đã có người đổi";
 *   · đọc HỎNG phải nói ra, vì một danh sách rỗng đọc ra là "chưa ai đụng gì".
 *
 * LEGACYJS-0075 W3b: the legacy controller `public/js/admin-classes.js` is
 * deleted. The log lives in the Next homework panel
 * (`admin-class-homework.tsx`, `normalizeActionLog` in the model); the same
 * invariants are pinned there.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeActionLog } from '../lib/admin-class-homework-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLASS_DIR = join(HERE, '..', 'app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]');
const HW = readFileSync(join(CLASS_DIR, 'admin-class-homework.tsx'), 'utf8');
const SUB = readFileSync(join(CLASS_DIR, 'admin-class-submissions.tsx'), 'utf8');

describe('dòng nhật ký nói được TRƯỚC → SAU', () => {
  test('đổi hạn: hiện cả hai đầu và số hồ sơ bị viết lại', () => {
    assert.match(HW, /`\$\{formatDue\(typeof details\.previous_due_at === 'string' \? details\.previous_due_at : null\)\} → \$\{formatDue\(typeof details\.due_at === 'string' \? details\.due_at : null\)\}`/);
    assert.match(HW, /lượt trễ thành đúng hạn/);
    assert.match(HW, /lượt đúng hạn thành trễ/);
  });
  test('trả bài: nêu tên em ấy và số câu được đưa lại; không khôi phục được câu nào thì nói thẳng', () => {
    assert.match(HW, /\[row\.assignment_title, row\.student_name\]\.filter\(Boolean\)\.join\(' · '\)/);
    assert.match(HW, /câu được đưa lại vào ô nhập/);
    assert.match(HW, /'Không khôi phục được câu nào'/);
  });
  test('hạn và giờ trong nhật ký theo giờ Việt Nam, không theo giờ máy', () => {
    const tz = HW.match(/timeZone: 'Asia\/Ho_Chi_Minh'/g) || [];
    assert.ok(tz.length >= 2, 'formatDue and formatLogWhen both pin Asia/Ho_Chi_Minh');
  });
  test('nội dung do người khác nhập không được chèn thành HTML', () => {
    assert.doesNotMatch(HW, /dangerouslySetInnerHTML|\.innerHTML/);
  });
  test('bài giao đã bị xoá vẫn gọi được tên nhờ bản chép (assignment_title của dòng log)', () => {
    const log = normalizeActionLog({ actions: [{ id: 'a1', action: 'due_change', assignment_title: 'Grammar 1 (đã xoá)', details: {} }] });
    assert.equal(log.actions[0].assignment_title, 'Grammar 1 (đã xoá)');
  });
});

describe('đọc hỏng KHÁC HẲN chưa ai đụng gì', () => {
  test('lỗi mạng hiện thành lời báo, không thành danh sách rỗng', () => {
    assert.equal(normalizeActionLog({ detail: 'boom' }), null);
    assert.match(HW, /if \(!normalized\) throw new Error\('Dữ liệu nhật ký không đúng định dạng\.'\)/);
    assert.match(HW, /logError \? <div className="acd-inline-error" role="alert">Không đọc được nhật ký: \{logError\}/);
  });
  test('rỗng THẬT thì nói là rỗng', () => {
    assert.match(HW, /actionLog && !actionLog\.actions\.length \? <p className="acd-muted">Chưa có thao tác nào được ghi\.<\/p>/);
  });
});

describe('nhật ký dài hơn một trang', () => {
  test('còn dòng cũ hơn thì nói ra và mời bấm tiếp; hết thật thì không', () => {
    assert.match(HW, /\{actionLog\.has_more && actionLog\.next_before && <button[^>]+onClick=\{\(\) => void loadLog\(actionLog\.next_before\)\}/);
    const log = normalizeActionLog({ actions: [], has_more: 'yes' });
    assert.equal(log.has_more, false, 'only a literal true continues');
  });
  test('trang sau NỐI vào cuối, không vứt phần đang đọc', () => {
    assert.match(HW, /before && current \? \{ \.\.\.normalized, actions: \[\.\.\.current\.actions, \.\.\.normalized\.actions\] \} : normalized/);
    assert.match(HW, /`\/admin\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}\/action-log\$\{before \? `\?before=\$\{encodeURIComponent\(before\)\}` : ''\}`/);
  });
});

describe('hai lượt đọc chồng nhau', () => {
  test('lượt CŨ về sau KHÔNG được đè lên bản mới', () => {
    assert.match(HW, /const requestId = \+\+logSequence\.current;/);
    assert.match(HW, /if \(requestId !== logSequence\.current\) return;/);
  });
});

describe('dây nối ở trang', () => {
  test('mở khung lần đầu là nạp', () => {
    assert.match(HW, /onToggle=\{\(event\) => \{ const open = event\.currentTarget\.open; setLogOpen\(open\); if \(open && !actionLog && !logLoading\) void loadLog\(\); \}\}/);
  });
  test('khung ĐANG MỞ được nạp lại sau khi đổi hạn', () => {
    assert.match(HW, /if \(logOpen\) void loadLog\(\);/);
  });
  test('hai đường ghi đều nói ra khi nhật ký hụt', () => {
    assert.match(HW, /result\?\.audit_logged === false\) setBanner\(\{ kind: 'error', text: 'Đã đổi hạn nhưng không ghi được nhật ký thao tác\.' \}\)/);
    assert.match(SUB, /result\?\.audit_logged === false\) setBanner\(\{ kind: 'error', text: 'Đã trả bài nhưng không ghi được nhật ký thao t/);
  });
});
