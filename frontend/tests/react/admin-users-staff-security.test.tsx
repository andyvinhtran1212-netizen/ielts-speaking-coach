import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AdminUsersPanel } from '@/app/(authed-admin-users)/admin/users/admin-users-panel';

// ADMINAAL2-0032 T011: suspend/reactivate through the reason dialog, the
// revoke retry, the FR-019 role refusal and "Lịch sử quyền", all against a
// stubbed window.api. Every outcome must come from a canonical list reload.
const ADMIN = 'admin-self';
const INSTRUCTOR = 'inst-1';
const user = (id: string, role: string, isActive: boolean, email: string) => ({
  id, email, display_name: email.split('@')[0], role, is_active: isActive, created_at: '2026-10-01T00:00:00Z',
  sessions_today: 0, cohort_names: [], code_summary: { codes: [], code_count: 0, permissions: [], has_active_code: false },
});

let rows: Record<string, ReturnType<typeof user>>;
let getWith: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let usersReads: number;
const httpError = (status: number, detail: unknown) => Object.assign(
  new Error(typeof detail === 'string' ? detail : (detail as { message: string }).message), { status, detail },
);

beforeEach(() => {
  usersReads = 0;
  rows = {
    [ADMIN]: user(ADMIN, 'admin', true, 'owner@example.com'),
    [INSTRUCTOR]: user(INSTRUCTOR, 'instructor', true, 'teacher@example.com'),
    'student-1': user('student-1', 'student', true, 'learner@example.com'),
  };
  getWith = vi.fn(async (path: string) => {
    if (path === '/admin/users') { usersReads += 1; return Object.values(rows); }
    throw new Error(`unexpected GET ${path}`);
  });
  patch = vi.fn();
  post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, patch, post } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderPanel = async () => {
  render(<AdminUsersPanel profileId={ADMIN} cohorts={[]} cohortsError={null} />);
  await screen.findByText('teacher@example.com');
};
const rowOf = (email: string) => screen.getByText(email).closest('tr') as HTMLElement;
const suspendWith = async (reason: string) => {
  fireEvent.click(within(rowOf('teacher@example.com')).getByRole('button', { name: 'Tạm khóa' }));
  const dialog = await screen.findByRole('dialog', { name: 'Tạm khóa tài khoản' });
  fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: reason } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tạm khóa' }));
  return dialog;
};

it('offers suspension only on other staff rows', async () => {
  await renderPanel();
  expect(within(rowOf('teacher@example.com')).queryByRole('button', { name: 'Tạm khóa' })).toBeTruthy();
  expect(within(rowOf('owner@example.com')).queryByRole('button', { name: /Tạm khóa|Mở khóa/ })).toBeNull();
  expect(within(rowOf('learner@example.com')).queryByRole('button', { name: /Tạm khóa|Mở khóa/ })).toBeNull();
  expect(within(rowOf('learner@example.com')).getByRole('button', { name: 'Lịch sử quyền' })).toBeTruthy();
});

it('suspends through the reason dialog, calls PATCH …/active and reports from the reloaded list', async () => {
  patch.mockImplementation(async () => {
    rows[INSTRUCTOR] = { ...rows[INSTRUCTOR], is_active: false };
    return { ok: true, id: INSTRUCTOR, is_active: false, suspended_at: '2026-10-29T01:00:00Z', changed: true, audit_id: 'a1', sessions_revoked: true, revoke_error: null, sign_in_restored: null };
  });
  await renderPanel();
  const readsBefore = usersReads;
  await suspendWith('  Tài khoản bị lộ mật khẩu  ');
  expect(await screen.findByText('Đã tạm khóa và thu hồi phiên đăng nhập.')).toBeTruthy();
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith(`/admin/users/${INSTRUCTOR}/active`, { is_active: false, reason: 'Tài khoản bị lộ mật khẩu' });
  expect(usersReads).toBe(readsBefore + 1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(rowOf('teacher@example.com')).getByText('Inactive')).toBeTruthy();
  expect(within(rowOf('teacher@example.com')).getByRole('button', { name: 'Mở khóa' })).toBeTruthy();
});

it('refuses a reason under 3 characters without calling the API', async () => {
  await renderPanel();
  const dialog = await suspendWith(' ab ');
  expect(within(dialog).getByRole('alert').textContent).toBe('Lý do phải dài 3–500 ký tự.');
  expect(patch).not.toHaveBeenCalled();
});

it('shows the revoke retry when sessions_revoked is false, and the retry calls POST …/revoke-sessions', async () => {
  patch.mockImplementation(async () => {
    rows[INSTRUCTOR] = { ...rows[INSTRUCTOR], is_active: false };
    return { ok: true, id: INSTRUCTOR, is_active: false, suspended_at: '2026-10-29T01:00:00Z', changed: true, audit_id: 'a1', sessions_revoked: false, revoke_error: 'ban_failed', sign_in_restored: null };
  });
  post.mockResolvedValueOnce({ ok: false, sessions_revoked: false, revoke_error: 'ban_failed', audit_id: 'a2' })
    .mockResolvedValueOnce({ ok: true, sessions_revoked: true, revoke_error: null, audit_id: 'a3' });
  await renderPanel();
  await suspendWith('Nghi bị chiếm tài khoản');
  const notice = await screen.findByTestId('staff-security-notice');
  expect(notice.textContent).toContain('Đã tạm khóa nhưng chưa thu hồi được phiên — bấm Thu hồi phiên lại.');
  expect(notice.getAttribute('role')).toBe('alert');

  fireEvent.click(within(notice).getByRole('button', { name: 'Thu hồi phiên lại' }));
  await waitFor(() => expect(screen.getByTestId('staff-security-notice').textContent).toContain('Vẫn chưa thu hồi được phiên'));
  expect(post).toHaveBeenLastCalledWith(`/admin/users/${INSTRUCTOR}/revoke-sessions`, { reason: 'Nghi bị chiếm tài khoản' });

  fireEvent.click(within(screen.getByTestId('staff-security-notice')).getByRole('button', { name: 'Thu hồi phiên lại' }));
  expect(await screen.findByText('Đã thu hồi phiên đăng nhập.')).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Thu hồi phiên lại' })).toBeNull();
});

it('keeps the dialog and the typed reason when the backend refuses with 409 last_admin', async () => {
  rows[INSTRUCTOR] = user(INSTRUCTOR, 'admin', true, 'teacher@example.com');
  patch.mockRejectedValue(httpError(409, { code: 'last_admin', message: 'Không thể khóa/hạ quyền admin cuối cùng' }));
  await renderPanel();
  const readsBefore = usersReads;
  const dialog = await suspendWith('Thử khóa admin');
  expect(await within(dialog).findByText('Không thể khóa/hạ quyền admin cuối cùng')).toBeTruthy();
  expect((within(dialog).getByLabelText(/Lý do/) as HTMLTextAreaElement).value).toBe('Thử khóa admin');
  await waitFor(() => expect(usersReads).toBe(readsBefore + 1));
  expect(within(rowOf('teacher@example.com')).getByText('Active')).toBeTruthy();
});

it('does not claim an unlock when the unban failed, and Thử lại repeats the reactivation', async () => {
  rows[INSTRUCTOR] = { ...rows[INSTRUCTOR], is_active: false };
  patch.mockResolvedValueOnce({ ok: false, id: INSTRUCTOR, is_active: false, suspended_at: '2026-10-29T01:00:00Z', changed: false, audit_id: null, sessions_revoked: null, revoke_error: null, sign_in_restored: false })
    .mockImplementationOnce(async () => {
      rows[INSTRUCTOR] = { ...rows[INSTRUCTOR], is_active: true };
      return { ok: true, id: INSTRUCTOR, is_active: true, suspended_at: null, changed: true, audit_id: 'a9', sessions_revoked: null, revoke_error: null, sign_in_restored: true };
    });
  await renderPanel();
  fireEvent.click(within(rowOf('teacher@example.com')).getByRole('button', { name: 'Mở khóa' }));
  const dialog = await screen.findByRole('dialog', { name: 'Mở khóa tài khoản' });
  fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: 'Đã xác minh lại' } });
  fireEvent.keyDown(within(dialog).getByLabelText(/Lý do/), { key: 'Enter', ctrlKey: true });
  const notice = await screen.findByTestId('staff-security-notice');
  expect(notice.textContent).toContain('Chưa mở khóa được');
  expect(notice.textContent).not.toContain('Đã mở khóa');
  fireEvent.click(within(notice).getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Đã mở khóa.')).toBeTruthy();
  expect(patch).toHaveBeenNthCalledWith(2, `/admin/users/${INSTRUCTOR}/active`, { is_active: true, reason: 'Đã xác minh lại' });
  expect(within(rowOf('teacher@example.com')).getByText('Active')).toBeTruthy();
});

it('shows the FR-019 message for a suspended account role change and reloads the unchanged role', async () => {
  const message = 'Không thể đổi vai trò của tài khoản đang bị tạm khóa. Hãy mở khóa tài khoản trước, rồi đổi vai trò.';
  rows[INSTRUCTOR] = { ...rows[INSTRUCTOR], is_active: false };
  patch.mockRejectedValue(httpError(409, { code: 'account_suspended_role_change', message }));
  await renderPanel();
  const readsBefore = usersReads;
  fireEvent.change(within(rowOf('teacher@example.com')).getByLabelText(/Đổi vai trò/), { target: { value: 'student' } });
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Đổi vai trò' }));
  const alert = await screen.findByText(message);
  expect(alert.getAttribute('role')).toBe('alert');
  expect(patch).toHaveBeenCalledWith(`/admin/users/${INSTRUCTOR}/role`, { role: 'student' });
  expect(usersReads).toBe(readsBefore + 1);
  expect((within(rowOf('teacher@example.com')).getByLabelText(/Đổi vai trò/) as HTMLSelectElement).value).toBe('instructor');
});

it('offers the revoke retry after a demotion whose revocation failed', async () => {
  patch.mockImplementation(async () => {
    rows[INSTRUCTOR] = { ...rows[INSTRUCTOR], role: 'student' };
    return { ok: true, id: INSTRUCTOR, role: 'student', changed: true, audit_id: 'r1', sessions_revoked: false, revoke_error: 'session_delete_failed' };
  });
  post.mockResolvedValue({ ok: true, sessions_revoked: true, revoke_error: null, audit_id: 'r2' });
  await renderPanel();
  fireEvent.change(within(rowOf('teacher@example.com')).getByLabelText(/Đổi vai trò/), { target: { value: 'student' } });
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Đổi vai trò' }));
  const notice = await screen.findByTestId('staff-security-notice');
  expect(notice.textContent).toContain('chưa thu hồi được phiên');
  fireEvent.click(within(notice).getByRole('button', { name: 'Thu hồi phiên lại' }));
  expect(await screen.findByText('Đã thu hồi phiên đăng nhập.')).toBeTruthy();
  expect(post).toHaveBeenCalledWith(`/admin/users/${INSTRUCTOR}/revoke-sessions`, {});
});

it('renders "Lịch sử quyền" from the security-audit API, newest first, in Vietnam time', async () => {
  getWith.mockImplementation(async (path: string) => {
    if (path === '/admin/users') return Object.values(rows);
    if (path === `/admin/users/${INSTRUCTOR}/security-audit?limit=50`) {
      return { lookup_failed: false, rows: [
        { id: 'h1', occurred_at: '2026-10-28T17:00:00Z', event: 'role_changed', source: 'out_of_band', actor_user_id: null, actor_email: null, before: { role: 'student', is_active: true }, after: { role: 'instructor', is_active: true }, reason: null, alert_status: null },
        { id: 'h2', occurred_at: '2026-10-29T01:30:00Z', event: 'active_changed', source: 'admin_api', actor_user_id: ADMIN, actor_email: 'owner@example.com', before: { role: 'instructor', is_active: true, suspended_at: null }, after: { role: 'instructor', is_active: false, suspended_at: '2026-10-29T01:30:00Z' }, reason: 'Lộ mật khẩu', alert_status: 'failed' },
      ] };
    }
    throw new Error(`unexpected GET ${path}`);
  });
  await renderPanel();
  fireEvent.click(within(rowOf('teacher@example.com')).getByRole('button', { name: 'Lịch sử quyền' }));
  const dialog = await screen.findByRole('dialog', { name: 'Lịch sử quyền' });
  await within(dialog).findByText('Lộ mật khẩu');
  const bodyRows = within(dialog).getAllByRole('row').slice(1);
  expect(bodyRows).toHaveLength(2);
  expect(bodyRows[0].textContent).toContain('29/10/2026');
  expect(bodyRows[0].textContent).toContain('08:30');
  expect(bodyRows[0].textContent).toContain('instructor · Active → instructor · Bị tạm khóa');
  expect(bodyRows[0].textContent).toContain('owner@example.com');
  expect(bodyRows[0].textContent).toContain('⚠ gửi lỗi');
  expect(bodyRows[1].textContent).toContain('không rõ (ngoài ứng dụng)');
  expect(bodyRows[1].textContent).toContain('Ngoài ứng dụng');
  expect(bodyRows[1].textContent).toContain('29/10/2026');
  expect(bodyRows[1].textContent).toContain('00:00');
});

it('shows a lookup failure with Thử lại instead of an empty history, and an empty history when there is none', async () => {
  let historyCalls = 0;
  getWith.mockImplementation(async (path: string) => {
    if (path === '/admin/users') return Object.values(rows);
    historyCalls += 1;
    if (historyCalls === 1) throw httpError(503, { error_code: 'lookup_failed', message: '⚠ không tải được lịch sử' });
    return { rows: [], lookup_failed: false };
  });
  await renderPanel();
  fireEvent.click(within(rowOf('teacher@example.com')).getByRole('button', { name: 'Lịch sử quyền' }));
  const dialog = await screen.findByRole('dialog', { name: 'Lịch sử quyền' });
  const failure = await within(dialog).findByTestId('security-history-error');
  expect(failure.textContent).toContain('⚠ không tải được lịch sử');
  expect(within(dialog).queryByText('Chưa có thay đổi quyền nào')).toBeNull();
  fireEvent.click(within(failure).getByRole('button', { name: 'Thử lại' }));
  expect(await within(dialog).findByText('Chưa có thay đổi quyền nào')).toBeTruthy();
});
