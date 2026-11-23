// ADMINIA-0074 G09-T11b (FR-033): Khoá và quyền: role change and danger zone.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: 'tab=khoa-va-quyen', push: vi.fn(), replace: vi.fn() }));
const me = vi.hoisted(() => ({ id: 'admin-1' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/learners/x',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => me }));

import { AdminLearnerProfile } from '@/app/(authed-admin)/(learners)/admin/learners/[ref]/admin-learner-profile';

const UID = '10000000-0000-0000-0000-000000000001';
const SID = '20000000-0000-0000-0000-000000000002';
const C = '30000000-0000-0000-0000-000000000003';
const U = `u-${UID}`;
const summary = {
  name: 'Nguyễn Minh Anh', cohorts: [{ id: C, name: 'Tue–Thu 19:30' }], courses: null,
  status: { level: 'ok', reasons: [] }, goal: { target_band: null, exam_date: null, source: 'none' },
  overdue: { count: 0, latest_title: null }, recent_bands: { writing: [], speaking: [] },
  last_active_at: null, latest_note: null,
};
const detail = (extra: Record<string, unknown> = {}) => ({
  ref: U, canonical_ref: U, summary, sources_failed: [], student_id: SID,
  account: { user_id: UID, role: 'student', is_active: true }, ...extra,
});
const api = { getWith: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };

beforeEach(() => {
  nav.search = 'tab=khoa-va-quyen';
  me.id = 'admin-1';
  api.getWith.mockReset().mockResolvedValue(detail());
  api.patch.mockReset().mockResolvedValue({ ok: true, id: UID, role: 'instructor', changed: true, audit_id: 'a1', sessions_revoked: null, revoke_error: null });
  api.delete.mockReset().mockResolvedValue(undefined);
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

const dialog = () => screen.getByRole('dialog');
// G09-T14b adds the G04 /access read; the profile's own reloads are counted on their own.
const detailCalls = () => api.getWith.mock.calls.filter(([p]) => String(p) === `/admin/learners/${U}`).length;

describe('Khoá và quyền (G09-T11b)', () => {
  it('shows the role and a danger zone at the end, with no account lock; no access in force → nothing to revoke', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    expect(screen.getByText('Học viên', { selector: 'strong' })).toBeTruthy();
    const zone = screen.getByRole('region', { name: 'Vùng nguy hiểm' });
    await within(zone).findByText(/Không có quyền học nào đang hiệu lực/);
    expect(within(zone).queryByRole('button', { name: /^Thu hồi/ })).toBeNull();
    expect((within(zone).getByRole('button', { name: 'Khoá tài khoản' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(zone).getByRole('button', { name: 'Gỡ khỏi Tue–Thu 19:30' })).toBeTruthy();
    const sections = Array.from(document.querySelectorAll('.lp-access > section'));
    expect(sections[sections.length - 1].getAttribute('aria-labelledby')).toBe('lp-danger');
  });

  it('changes the role only after the confirm, then reloads the canonical profile', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    const change = screen.getByRole('button', { name: 'Đổi vai trò' }) as HTMLButtonElement;
    expect(change.disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: /Vai trò mới/ }), { target: { value: 'instructor' } });
    fireEvent.click(change);
    expect(dialog().textContent).toMatch(/từ Học viên sang Giảng viên\?/);
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Đổi vai trò' }));
    await screen.findByText('Đã đổi vai trò sang Giảng viên.');
    expect(api.patch).toHaveBeenCalledWith(`/admin/users/${UID}/role`, { role: 'instructor' });
    expect(detailCalls()).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('after a reload the role select follows the server, and an unactivated learner can still change role', async () => {
    api.getWith.mockResolvedValueOnce(detail({ account: { user_id: UID, role: 'student', is_active: false } }))
      .mockResolvedValue(detail({ account: { user_id: UID, role: 'instructor', is_active: false } }));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    const select = screen.getByRole('combobox', { name: /Vai trò mới/ }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'instructor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi vai trò' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Đổi vai trò' }));
    await screen.findByText('Giảng viên', { selector: 'strong' });
    expect((screen.getByRole('combobox', { name: /Vai trò mới/ }) as HTMLSelectElement).value).toBe('instructor');
    expect((screen.getByRole('button', { name: 'Đổi vai trò' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('demoting staff warns that sessions are revoked, and a failed revocation is not called a success', async () => {
    api.getWith.mockResolvedValue(detail({ account: { user_id: UID, role: 'instructor', is_active: true } }));
    api.patch.mockResolvedValue({ ok: true, id: UID, role: 'student', changed: true, audit_id: 'a2', sessions_revoked: false, revoke_error: 'gotrue' });
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    fireEvent.change(screen.getByRole('combobox', { name: /Vai trò mới/ }), { target: { value: 'student' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi vai trò' }));
    expect(dialog().textContent).toMatch(/Mọi phiên đăng nhập của người này bị thu hồi ngay/);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Đổi vai trò' }));
    await screen.findByText(/chưa thu hồi được phiên đăng nhập/);
    expect(screen.queryByText('Đã đổi vai trò sang Học viên.')).toBeNull();
  });

  it('a refused change (step-up not done, last admin) keeps the dialog with the reason and reloads', async () => {
    api.patch.mockRejectedValue(Object.assign(new Error('Cần xác minh'), { status: 403, code: 'step_up_required' }));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    fireEvent.change(screen.getByRole('combobox', { name: /Vai trò mới/ }), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đổi vai trò' }));
    expect(dialog().textContent).toMatch(/vào được toàn bộ khu quản trị/);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Đổi vai trò' }));
    await waitFor(() => expect(within(dialog()).getByRole('alert').textContent).toMatch(/cần xác minh mã hai bước/));
    await waitFor(() => expect(detailCalls()).toBe(2));
  });

  it('no role change for oneself, a suspended account or a profile without an account', async () => {
    me.id = UID;
    const { unmount } = render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Không đổi vai trò của chính mình ở đây.');
    expect(screen.queryByRole('button', { name: 'Đổi vai trò' })).toBeNull();
    unmount();
    me.id = 'admin-1';
    api.getWith.mockResolvedValue(detail({ account: null }));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText(/chưa có tài khoản, nên chưa có vai trò để đổi/);
  });

  it('"Gỡ khỏi lớp" asks once, names what stays, removes by the profile id and reloads', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi Tue–Thu 19:30' }));
    expect(dialog().textContent).toMatch(/Quyền khoá học và lịch sử bài làm giữ nguyên/);
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Gỡ khỏi lớp' }));
    await screen.findByText('Đã gỡ Nguyễn Minh Anh khỏi lớp Tue–Thu 19:30.');
    expect(api.delete).toHaveBeenCalledWith(`/admin/cohorts/${C}/students/${SID}`);
    expect(detailCalls()).toBe(2);
  });

  it('Huỷ sends nothing; a person without a learner profile has no class to leave', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi Tue–Thu 19:30' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Huỷ' }));
    expect(api.delete).not.toHaveBeenCalled();
    cleanup();
    api.getWith.mockResolvedValue(detail({ student_id: null }));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText(/chưa có hồ sơ học viên nên không thuộc lớp nào/);
    expect(screen.queryByRole('button', { name: /^Gỡ khỏi / })).toBeNull();
  });

  describe('a pick or a confirm belongs to the profile it was made on', () => {
    const UID2 = '10000000-0000-0000-0000-0000000000b2';
    const SID2 = '20000000-0000-0000-0000-0000000000b2';
    const C2 = '30000000-0000-0000-0000-0000000000b2';
    const U2 = `u-${UID2}`;
    const detailB = () => ({
      ...detail(), ref: U2, canonical_ref: U2, student_id: SID2,
      summary: { ...summary, name: 'Trần Bảo Ngọc', cohorts: [{ id: C2, name: 'Tue–Thu 19:30' }] },
      account: { user_id: UID2, role: 'student', is_active: true },
    });
    const byRef = (path: string) => (String(path).includes(UID2) ? detailB() : detail());
    // Profile reads only: the G04 access read of the tab (#2660) is not a reload of the profile.
    const readsOf = (uid: string) => api.getWith.mock.calls.filter(([p]) => String(p).includes(uid) && !String(p).endsWith('/access')).length;

    beforeEach(() => { api.getWith.mockImplementation((path: string) => Promise.resolve(byRef(path))); });

    it('a role confirm open on A is gone after a switch to B with the same role, and does not come back on A', async () => {
      const { rerender } = render(<AdminLearnerProfile learnerRef={U} />);
      await screen.findByText('Vùng nguy hiểm');
      fireEvent.change(screen.getByRole('combobox', { name: /Vai trò mới/ }), { target: { value: 'instructor' } });
      fireEvent.click(screen.getByRole('button', { name: 'Đổi vai trò' }));
      expect(dialog().textContent).toMatch(/Nguyễn Minh Anh/);
      rerender(<AdminLearnerProfile learnerRef={U2} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      await screen.findByText(/Trần Bảo Ngọc/, { selector: '.lp-crumb' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect((screen.getByRole('combobox', { name: /Vai trò mới/ }) as HTMLSelectElement).value).toBe('student');
      expect((screen.getByRole('button', { name: 'Đổi vai trò' }) as HTMLButtonElement).disabled).toBe(true);
      rerender(<AdminLearnerProfile learnerRef={U} />);
      await screen.findByText(/Nguyễn Minh Anh/, { selector: '.lp-crumb' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect((screen.getByRole('combobox', { name: /Vai trò mới/ }) as HTMLSelectElement).value).toBe('student');
      expect(api.patch).not.toHaveBeenCalled();
    });

    it('a remove confirm open on A is gone after a switch to B; B removes with its own ids', async () => {
      const { rerender } = render(<AdminLearnerProfile learnerRef={U} />);
      await screen.findByText('Vùng nguy hiểm');
      fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi Tue–Thu 19:30' }));
      expect(dialog().textContent).toMatch(/Gỡ Nguyễn Minh Anh khỏi lớp/);
      rerender(<AdminLearnerProfile learnerRef={U2} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      await screen.findByText(/Trần Bảo Ngọc/, { selector: '.lp-crumb' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(api.delete).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi Tue–Thu 19:30' }));
      expect(dialog().textContent).toMatch(/Gỡ Trần Bảo Ngọc khỏi lớp/);
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Gỡ khỏi lớp' }));
      await screen.findByText('Đã gỡ Trần Bảo Ngọc khỏi lớp Tue–Thu 19:30.');
      expect(api.delete).toHaveBeenCalledWith(`/admin/cohorts/${C2}/students/${SID2}`);
    });

    it('while B is still loading, nothing of A is on screen and no action can start', async () => {
      let answerB: (v: unknown) => void = () => undefined;
      api.getWith.mockImplementation((path: string) => (String(path).includes(UID2)
        ? new Promise((resolve) => { answerB = resolve; })
        : Promise.resolve(detail())));
      const { rerender } = render(<AdminLearnerProfile learnerRef={U} />);
      await screen.findByText('Vùng nguy hiểm');
      rerender(<AdminLearnerProfile learnerRef={U2} />);
      expect(screen.getByText('Đang tải…')).toBeTruthy();
      expect(screen.queryByText(/Nguyễn Minh Anh/)).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Vai trò mới/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Đổi vai trò$|^Gỡ khỏi / })).toBeNull();
      expect(api.patch).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
      answerB(detailB());
      await screen.findByText(/Trần Bảo Ngọc/, { selector: '.lp-crumb' });
      fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi Tue–Thu 19:30' }));
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Gỡ khỏi lớp' }));
      await screen.findByText('Đã gỡ Trần Bảo Ngọc khỏi lớp Tue–Thu 19:30.');
      expect(api.delete).toHaveBeenCalledWith(`/admin/cohorts/${C2}/students/${SID2}`);
    });

    it('an answer that arrives after the switch shows nothing on B and does not reload A over B', async () => {
      let answer: (v: unknown) => void = () => undefined;
      api.patch.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      const { rerender } = render(<AdminLearnerProfile learnerRef={U} />);
      await screen.findByText('Vùng nguy hiểm');
      fireEvent.change(screen.getByRole('combobox', { name: /Vai trò mới/ }), { target: { value: 'instructor' } });
      fireEvent.click(screen.getByRole('button', { name: 'Đổi vai trò' }));
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Đổi vai trò' }));
      expect(api.patch).toHaveBeenCalledWith(`/admin/users/${UID}/role`, { role: 'instructor' });
      rerender(<AdminLearnerProfile learnerRef={U2} />);
      await screen.findByText(/Trần Bảo Ngọc/, { selector: '.lp-crumb' });
      answer({ ok: true, id: UID, role: 'instructor', changed: true, audit_id: 'a1', sessions_revoked: null, revoke_error: null });
      await waitFor(() => expect((screen.getByRole('button', { name: 'Đổi vai trò' }) as HTMLButtonElement).disabled).toBe(true));
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByText(/Đã đổi vai trò/)).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(readsOf(UID)).toBe(1);
      expect(screen.getByText(/Trần Bảo Ngọc/, { selector: '.lp-crumb' })).toBeTruthy();
    });
  });
});
