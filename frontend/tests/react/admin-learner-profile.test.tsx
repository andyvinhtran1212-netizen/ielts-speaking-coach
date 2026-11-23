// ADMINIA-0074 G09-T11a (FR-022…FR-024, FR-030, FR-031, FR-034): Hồ sơ học viên.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/learners/x',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

import { AdminLearnerProfile } from '@/app/(authed-admin)/(learners)/admin/learners/[ref]/admin-learner-profile';

const U = 'u-10000000-0000-0000-0000-000000000001';
const S = 's-20000000-0000-0000-0000-000000000002';
const summary = {
  name: 'Nguyễn Minh Anh', cohorts: [{ id: 'c1', name: 'Tue–Thu 19:30' }], courses: null,
  status: { level: 'ok', reasons: [] }, goal: { target_band: 6.5, exam_date: null, source: 'admin' },
  overdue: { count: 0, latest_title: null }, recent_bands: { writing: [6], speaking: [] },
  last_active_at: null, latest_note: null,
};
const detail = (ref = U, canonical = ref) => ({ ref, canonical_ref: canonical, summary, sources_failed: [] });
const goal = (conflict = true) => ({
  admin: { target_band: 6.5, target_date: '2027-03-20' }, learner: { target_band: conflict ? 7 : 6.5, exam_date: '2027-03-20' },
  conflict, estimated_band: null,
});
const overview = (extra: Record<string, unknown> = {}) => ({
  alerts: { open: [{ code: 'inactive', text: 'Không hoạt động 9 ngày', action: 'Gửi nhắc' }], checked_off: ['low_credits'], undecided: [] },
  goal: goal(),
  continuity: { weeks: Array.from({ length: 8 }, () => [true, false, true, false, true, false, false]), streak_days: 0, minutes_this_week: 10, minutes_last_week: 0 },
  assigned: { on_time: 3, late: 1, missing: 0, undecided: 0, open: [{ assignment_id: 'a1', title: 'Writing Task 2', due_at: '2026-11-19T16:59:00Z' }], overdue: [] },
  scores: { grammar: [], writing: [], speaking: [], mock: [], milestones: null },
  side: { due_notes: null, courses: null, credits_left: null, credits_carried: null },
  sources_failed: [], ...extra,
});
const api = { getWith: vi.fn(), post: vi.fn() };

beforeEach(() => {
  nav.search = '';
  nav.push.mockReset();
  nav.replace.mockReset();
  api.getWith.mockReset().mockImplementation((path: string) =>
    Promise.resolve(path.endsWith('/overview') ? overview() : detail()));
  api.post.mockReset().mockResolvedValue({ goal: goal(false) });
  window.sessionStorage.clear();
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

describe('AdminLearnerProfile', () => {
  it('shows the shared learner block, five tabs and the Tổng quan blocks', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Không hoạt động 9 ngày');
    expect(api.getWith).toHaveBeenCalledWith(`/admin/learners/${U}`, undefined, undefined);
    expect(api.getWith).toHaveBeenCalledWith(`/admin/learners/${U}/overview`, undefined, undefined);
    expect(screen.getByRole('region', { name: 'Tóm tắt học viên Nguyễn Minh Anh' })).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Thẻ hồ sơ' })).getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual(['Tổng quan', 'Học tập', 'Ghi chú chăm sóc', 'Khoá và quyền', 'Nhật ký hệ thống']);
    expect(tabs[0].getAttribute('aria-current')).toBe('page');
    expect(tabs[4].getAttribute('href')).toBe(`/admin/learners/${U}?tab=nhat-ky`);
    expect(screen.getByText(/Không bật: sắp hết lượt chấm\./)).toBeTruthy();
    expect(screen.getByText(/Writing Task 2 · Hạn 19\/11\/2026/)).toBeTruthy();
    expect(screen.getByText(/Chưa có band ước tính/)).toBeTruthy();
    expect(screen.getByText('Việc đã hẹn: chưa có.')).toBeTruthy();
    expect(screen.getAllByText('Chưa có bài đã trả').length).toBe(4);
    expect(screen.queryByText(/Vùng nguy hiểm|Thu hồi quyền học|Khoá tài khoản/)).toBeNull();
    // /admin/notifications is not live yet: no "Gửi nhắc" link to a 404.
    expect(screen.queryByRole('link', { name: 'Gửi nhắc' })).toBeNull();
  });

  it('moves an s- ref of a person with an account to the u- ref, keeping the tab (FR-022)', async () => {
    nav.search = 'tab=hoc-tap';
    api.getWith.mockResolvedValue(detail(S, U));
    render(<AdminLearnerProfile learnerRef={S} />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/admin/learners/${U}?tab=hoc-tap`));
  });

  it('opens another tab by its URL and says what it waits on, without loading the overview', async () => {
    nav.search = 'tab=khoa-va-quyen';
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText(/Chưa mở\. Khoá, hạn, quyền luyện lại và lượt chấm cần dữ liệu khoá học/);
    expect(api.getWith).not.toHaveBeenCalledWith(`/admin/learners/${U}/overview`, undefined, undefined);
    fireEvent.click(screen.getByRole('link', { name: 'Nhật ký hệ thống' }));
    expect(nav.push).toHaveBeenCalledWith(`/admin/learners/${U}?tab=nhat-ky`);
  });

  it('"Dùng giá trị này" asks again, sends the goals as shown, then shows the goal read back (FR-030)', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText(/Hai nguồn đang lệch/);
    const buttons = screen.getAllByRole('button', { name: 'Dùng giá trị này' });
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[1]);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/band 7\.0.*học viên khai/);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByText(/Đã ghi mục tiêu vào cả hồ sơ lớp và trang Tài khoản/);
    expect(api.post).toHaveBeenCalledWith(`/admin/learners/${U}/goal/resolve`, {
      use: 'learner',
      seen: { admin: { target_band: 6.5, target_date: '2027-03-20' }, learner: { target_band: 7, exam_date: '2027-03-20' } },
    });
    expect(screen.queryAllByRole('button', { name: 'Dùng giá trị này' }).length).toBe(0);
  });

  it('a refused goal write says why, writes nothing on screen and reloads the canonical goal', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('Mục tiêu vừa được sửa sau khi trang mở. Chưa ghi gì; tải lại trang rồi chọn lại.'), { status: 409, code: 'goal_changed' }));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText(/Hai nguồn đang lệch/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Dùng giá trị này' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByText(/Mục tiêu vừa được sửa sau khi trang mở/);
    expect(screen.queryByText(/Đã ghi mục tiêu/)).toBeNull();
    await waitFor(() => expect(api.getWith.mock.calls.filter(([p]) => String(p).endsWith('/overview')).length).toBe(2));
  });

  it('a failed block reports itself with Tải lại; the other blocks still show', async () => {
    api.getWith.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/overview') ? overview({ scores: null, sources_failed: ['scores'] }) : detail()));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText(/Chưa đọc được: Điểm theo thời gian\./);
    const block = screen.getByRole('region', { name: 'Điểm theo thời gian' });
    expect(within(block).getByRole('alert').textContent).toMatch(/Chưa đọc được khối này/);
    expect(screen.getByText('Không hoạt động 9 ngày')).toBeTruthy();
    fireEvent.click(within(block).getByRole('button', { name: 'Tải lại' }));
    await waitFor(() => expect(api.getWith.mock.calls.filter(([p]) => String(p).endsWith('/overview')).length).toBe(2));
  });

  it('an unknown learner says so plainly', async () => {
    api.getWith.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText(/Không tìm thấy học viên này\./);
  });
});
