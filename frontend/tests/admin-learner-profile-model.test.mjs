// G09-T11a (ADMINIA-0074 FR-022…FR-024, FR-030, FR-031): learner profile model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  PROFILE_TABS, ROLE_OPTIONS, TAB_PENDING, alertsView, removeConfirmText, roleChangeBlocked, roleConfirmText,
  roleErrorText, roleLabel, roleResultText, assignedView, canonicalHref, continuityView, failedText,
  goalConfirmText, goalErrorText, goalSeen, goalView, parseTab, scoresView, sideView, tabHref,
} from '../lib/admin-learner-profile-model.mjs';
import { adminRouteFor } from '../lib/admin-nav-registry.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const U = 'u-10000000-0000-0000-0000-000000000001';
const S = 's-20000000-0000-0000-0000-000000000002';
const NOW = new Date('2026-11-17T03:00:00Z'); // 10:00 Tuesday 17/11 in Vietnam

describe('tabs in the URL (FR-023)', () => {
  it('has exactly five tabs, Tổng quan without ?tab=', () => {
    assert.deepEqual(PROFILE_TABS.map((t) => t.id), ['tong-quan', 'hoc-tap', 'ghi-chu', 'khoa-va-quyen', 'nhat-ky']);
    assert.equal(tabHref(U, 'tong-quan'), `/admin/learners/${U}`);
    assert.equal(tabHref(U, 'nhat-ky'), `/admin/learners/${U}?tab=nhat-ky`);
    assert.equal(parseTab('?tab=khoa-va-quyen'), 'khoa-va-quyen');
    assert.equal(parseTab('?tab=xoa'), 'tong-quan');
    assert.equal(parseTab(''), 'tong-quan');
    for (const t of PROFILE_TABS.slice(1)) assert.ok(TAB_PENDING[t.id], t.id);
  });

  it('an s- ref of a person with an account moves to the u- ref and keeps the tab (FR-022)', () => {
    assert.equal(canonicalHref(S, U, 'tab=hoc-tap'), `/admin/learners/${U}?tab=hoc-tap`);
    assert.equal(canonicalHref(U, U, ''), null);
    assert.equal(canonicalHref(U.toUpperCase(), U, ''), null);
  });
});

describe('Tổng quan blocks (FR-024)', () => {
  it('alerts: open ones, those checked off and those a read cannot decide', () => {
    const v = alertsView({ open: [{ code: 'inactive', text: 'Không hoạt động 9 ngày', action: 'Gửi nhắc' }],
      checked_off: ['course_expiring', 'low_credits'], undecided: ['late_streak'] });
    assert.equal(v?.open.length, 1);
    assert.equal(v?.off, 'Không bật: quyền khoá sắp hết hạn · sắp hết lượt chấm.');
    assert.equal(v?.undecided, 'Chưa xác định được: nộp trễ liên tiếp.');
    assert.equal(alertsView(null), null);
  });

  it('goal: both sources labelled, the gap in days, and no band estimate without a full mock (FR-030)', () => {
    const goal = { admin: { target_band: 6.5, target_date: '2027-03-20' }, learner: { target_band: 7, exam_date: '2026-11-17' },
      conflict: true, estimated_band: null };
    const v = goalView(goal, NOW);
    assert.deepEqual(v?.rows.map((r) => [r.source, r.band, r.date]), [['Admin nhập', '6.5', '20/03/2027'], ['Học viên khai', '7.0', '17/11/2026']]);
    assert.equal(v?.rows[1].left, 'hôm nay');
    assert.match(v?.rows[0].left ?? '', /^còn \d+ ngày$/);
    assert.equal(v?.conflict, true);
    assert.match(v?.estimated ?? '', /^Chưa có band ước tính/);
    assert.match(goalConfirmText(v, 'learner'), /band 7\.0, ngày thi 17\/11\/2026 \(học viên khai\) vào cả hồ sơ lớp và trang Tài khoản/);
    assert.deepEqual(goalSeen(goal), { admin: { target_band: 6.5, target_date: '2027-03-20' }, learner: { target_band: 7, exam_date: '2026-11-17' } });
    assert.equal(goalView({ ...goal, estimated_band: 6 }, NOW)?.estimated.startsWith('Band ước tính hiện tại: 6.0'), true);
  });

  it('a refused or failed goal write keeps the API sentence and never says saved', () => {
    assert.equal(goalErrorText({ code: 'goal_changed', message: 'Mục tiêu vừa được sửa sau khi trang mở.' }), 'Mục tiêu vừa được sửa sau khi trang mở.');
    // A 5xx (code replaced by internal_error) or a network failure may have
    // committed: never "nothing was written".
    for (const err of [new Error('Network down'), { status: 503, code: 'internal_error', message: 'Lỗi máy chủ.' }, { status: 503, code: 'goal_saved_unreadable', message: 'x' }]) {
      const text = goalErrorText(err);
      assert.match(text, /^Chưa chắc mục tiêu đã được lưu/);
      assert.doesNotMatch(text, /Không có gì được ghi/);
    }
  });

  it('continuity: 8 × 7 grid, future days empty, minutes compared (FR-031)', () => {
    const weeks = Array.from({ length: 8 }, (_, w) => Array.from({ length: 7 }, (_, d) => (w === 7 && d > 1 ? null : d % 2 === 0)));
    const v = continuityView({ weeks, streak_days: 3, minutes_this_week: 65, minutes_last_week: 180 });
    assert.equal(v?.weeks.length, 8);
    assert.deepEqual(v?.weeks[7].cells, ['on', 'off', 'future', 'future', 'future', 'future', 'future']);
    assert.equal(v?.pastDays, 51);
    assert.equal(v?.streak, 'Chuỗi ngày học hiện tại: 3 ngày.');
    assert.equal(v?.minutes, 'Tuần này 65 phút, tuần trước 180 phút (giảm 115 phút).');
  });

  it('assigned work: counts, and undecided lesson items said, not counted', () => {
    const v = assignedView({ on_time: 15, late: 1, missing: 0, undecided: 2, open: [], overdue: [] });
    assert.deepEqual(v?.counts.map((c) => c.value), [15, 1, 0]);
    assert.match(v?.undecided ?? '', /^2 bài của buổi học chưa xác định được/);
  });

  it('scores: one line per series, "Chưa có bài đã trả" when empty, milestones not yet built', () => {
    const v = scoresView({ grammar: [{ at: '2026-11-10T00:00:00Z', pct: 66, lesson_no: 12 }], writing: [{ at: null, band: 6 }],
      speaking: [], mock: [], milestones: null });
    assert.deepEqual(v?.series.map((s) => s.points), ['B12 66%', '6.0', 'Chưa có bài đã trả', 'Chưa có bài đã trả']);
    assert.equal(v?.milestones, 'Mốc giữa kỳ, cuối kỳ: chưa có.');
  });

  it('right column: no source yet reads "chưa có", carried credits get their own end date (FR-056)', () => {
    const empty = sideView({ due_notes: null, courses: null, credits_left: null, credits_carried: null });
    assert.equal(empty.dueNotes, 'Việc đã hẹn: chưa có.');
    assert.match(empty.credits, /^chưa có/);
    assert.equal(empty.carried, '');
    const carried = sideView({ due_notes: [], courses: [], credits_left: 12, credits_carried: { amount: 6, expires_at: '2027-01-20' } });
    assert.equal(carried.credits, '12 lượt');
    assert.equal(carried.carried, 'trong đó 6 lượt chuyển từ khoá trước, dùng tới 20/01/2027');
    assert.doesNotMatch(JSON.stringify(carried), /50%/);
  });

  it('names the blocks that failed', () => {
    assert.equal(failedText(['scores', 'assignments']), 'Chưa đọc được: Điểm theo thời gian, Bài được giao (có bài chưa xác định được). Các khối khác vẫn đúng.');
    assert.equal(failedText([]), '');
  });
});

describe('page wiring', () => {
  it('is a context page of Học viên, 404 with the flag off; the danger zone lives only in Khoá và quyền', () => {
    assert.equal(adminRouteFor('/admin/learners/[ref]')?.kind, 'context');
    const page = read('app/(authed-admin)/(learners)/admin/learners/[ref]/page.tsx');
    assert.match(page, /requireAdminFrameV2\(\);/);
    const view = read('app/(authed-admin)/(learners)/admin/learners/[ref]/admin-learner-profile.tsx');
    assert.doesNotMatch(view, /Vùng nguy hiểm|Thu hồi quyền|Gỡ khỏi lớp|changeUserRole|removeFromCohort/);
    const access = read('app/(authed-admin)/(learners)/admin/learners/[ref]/learner-access-tab.tsx');
    assert.match(access, /Vùng nguy hiểm/);
    // No new write route, and no account lock for learners (the route accepts staff only).
    const api = read('lib/admin-learners-api.ts');
    assert.doesNotMatch(api + access, /\/active'|\/active`|revoke-sessions/);
  });
});

describe('Khoá và quyền (FR-033; G09-T11b)', () => {
  it('offers the three roles the API accepts, and says a self-signed-up account is a learner', () => {
    assert.deepEqual(ROLE_OPTIONS.map((o) => o.value), ['student', 'instructor', 'admin']);
    assert.equal(roleLabel('user'), 'Học viên (tự đăng ký)');
    assert.equal(roleLabel('instructor'), 'Giảng viên');
  });

  it('blocks a role change for no account, oneself and a suspended account', () => {
    const account = { user_id: 'u1', role: 'student', is_active: true };
    assert.equal(roleChangeBlocked(account, 'admin-1'), '');
    assert.match(roleChangeBlocked(null, 'admin-1'), /chưa có tài khoản/);
    assert.match(roleChangeBlocked(account, 'u1'), /chính mình/);
    // is_active is the activation flag for a learner, not a suspension: never a block.
    assert.equal(roleChangeBlocked({ ...account, is_active: false }, 'admin-1'), '');
  });

  it('the confirm says what happens: demotion revokes sessions, admin opens everything', () => {
    assert.match(roleConfirmText('Lan', 'instructor', 'student'), /từ Giảng viên sang Học viên\? Mọi phiên đăng nhập/);
    assert.match(roleConfirmText('Lan', 'student', 'admin'), /toàn bộ khu quản trị/);
    assert.match(roleConfirmText('Lan', 'student', 'instructor'), /nhật ký bảo mật\.$/);
  });

  it('the result is truthful: unchanged, revocation failed, refused', () => {
    assert.equal(roleResultText({ changed: false }, 'student').text, 'Vai trò đã là Học viên; không có gì thay đổi.');
    assert.equal(roleResultText({ changed: true, sessions_revoked: false }, 'student').kind, 'error');
    assert.equal(roleResultText({ changed: true, sessions_revoked: true }, 'student').text, 'Đã đổi vai trò sang Học viên.');
    assert.match(roleErrorText({ code: 'step_up_required' }), /mã hai bước/);
    assert.equal(roleErrorText({ code: 'step_up_required', reason: 'new_factor_cooloff', message: 'Mã hai bước vừa đổi; thử lại sau 23 giờ.' }),
      'Chưa đổi vai trò: Mã hai bước vừa đổi; thử lại sau 23 giờ.');
    assert.equal(roleErrorText({ code: 'last_admin', message: 'Phải còn ít nhất một admin.' }), 'Chưa đổi vai trò: Phải còn ít nhất một admin.');
  });

  it('"Gỡ khỏi lớp" names what stays', () => {
    assert.match(removeConfirmText('Lan', 'Tue–Thu'), /Quyền khoá học và lịch sử bài làm giữ nguyên/);
  });
});
