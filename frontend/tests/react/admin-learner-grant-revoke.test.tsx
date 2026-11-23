// ADMINIA-0074 G09-T14b (FR-045, FR-046): the profile mounts the shared
// re-practice grant form and the revoke form, fed by G04 /access.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: 'tab=khoa-va-quyen', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/learners/x',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));

import { AdminLearnerProfile } from '@/app/(authed-admin)/(learners)/admin/learners/[ref]/admin-learner-profile';

const UID = '10000000-0000-0000-0000-000000000001';
const SID = '20000000-0000-0000-0000-000000000002';
const C1 = 'c1000000-0000-4000-8000-000000000001';
const C2 = 'c2000000-0000-4000-8000-000000000002';
const E1 = 'e1000000-0000-4000-8000-000000000001';
const U = `u-${UID}`;
const summary = {
  name: 'Nguyễn Minh Anh', cohorts: [], courses: null,
  status: { level: 'ok', reasons: [] }, goal: { target_band: null, exam_date: null, source: 'none' },
  overdue: { count: 0, latest_title: null }, recent_bands: { writing: [], speaking: [] },
  last_active_at: null, latest_note: null,
};
const detail = (extra: Record<string, unknown> = {}) => ({
  ref: U, canonical_ref: U, summary, sources_failed: [], student_id: SID,
  account: { user_id: UID, role: 'student', is_active: true }, ...extra,
});
const products = [
  { id: 'p1', course_id: C1, slug: 'c1-repractice', kind: 'repractice', short_title: 'Course 1', status: 'open', access_days: 14, review_mode: 'ai_instant', archived_at: null },
  { id: 'p2', course_id: C2, slug: 'c2-repractice', kind: 'repractice', short_title: 'Course 2', status: 'open', access_days: 30, review_mode: 'ai_instant', archived_at: null },
];
let accessItems: Record<string, unknown>[] = [];
const api = { getWith: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };

beforeEach(() => {
  nav.search = 'tab=khoa-va-quyen';
  accessItems = [
    { entitlement_id: E1, product_slug: 'c1-repractice', course_code: 'C1', title: 'Course 1 luyện lại', short_title: 'Course 1', kind: 'repractice', state: 'active', expires_at: null },
    { entitlement_id: null, product_slug: null, course_code: 'C3', title: 'Lớp mã cũ', short_title: null, kind: 'class', state: 'active', expires_at: null },
  ];
  api.getWith.mockReset().mockImplementation((path: string) => {
    if (path.endsWith('/access')) return Promise.resolve({ items: accessItems, credits: { total: 0, by_kind: { online: 0, class: 0 } } });
    if (path === '/admin/course-products') return Promise.resolve({ items: products });
    return Promise.resolve(detail());
  });
  api.post.mockReset().mockImplementation((path: string) => {
    if (path.endsWith('/revoke')) { accessItems = accessItems.filter((i) => i.entitlement_id !== E1); return Promise.resolve({ status: 'revoked' }); }
    return Promise.resolve({ status: 'granted' });
  });
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

describe('Hồ sơ: cấp quyền luyện lại và thu hồi quyền (G09-T14b)', () => {
  it('"Cấp quyền luyện lại" leaves out the course the learner holds and grants this one person', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    fireEvent.click(screen.getByRole('button', { name: 'Cấp quyền luyện lại' }));
    const form = await screen.findByRole('dialog', { name: 'Cấp quyền luyện lại' });
    const select = await within(form).findByRole('combobox');
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['Course 2']);
    fireEvent.change(within(form).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Luyện lại trước kỳ thi' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Tiếp tục' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xác nhận cấp quyền' });
    expect(within(confirm).getByText(/cho 1 người/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 1/1 người.');
    expect(api.post).toHaveBeenCalledWith('/admin/entitlements', expect.objectContaining({ user_id: UID, product_id: 'p2' }));
    await screen.findByText('Đã cấp quyền luyện lại cho Nguyễn Minh Anh.');
  });

  it('no login account → the grant button stays off and nothing is read', async () => {
    api.getWith.mockImplementation((path: string) => Promise.resolve(path.endsWith('/access') ? { items: [] } : detail({ account: null })));
    render(<AdminLearnerProfile learnerRef={U} />);
    await screen.findByText('Vùng nguy hiểm');
    expect((screen.getByRole('button', { name: 'Cấp quyền luyện lại' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/chưa có tài khoản đăng nhập nên chưa có quyền học để thu hồi/)).toBeTruthy();
    expect(api.getWith.mock.calls.some(([p]) => String(p).endsWith('/access'))).toBe(false);
  });

  it('the danger zone offers only entitlements in force; revoke needs the full name, then both reads reload', async () => {
    render(<AdminLearnerProfile learnerRef={U} />);
    const zone = await screen.findByRole('region', { name: 'Vùng nguy hiểm' });
    const button = await within(zone).findByRole('button', { name: 'Thu hồi Course 1' });
    expect(within(zone).queryByRole('button', { name: /Thu hồi Lớp mã cũ/ })).toBeNull();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Thu hồi quyền học' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Gõ đúng họ tên/ }), { target: { value: 'Minh Anh' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Học viên xin dừng khoá' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi quyền' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Họ tên gõ vào chưa khớp.');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Gõ đúng họ tên/ }), { target: { value: 'Nguyễn Minh Anh' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi quyền' }));
    await screen.findByText('Đã thu hồi quyền khoá Course 1 của Nguyễn Minh Anh.');
    expect(api.post).toHaveBeenCalledWith(`/admin/entitlements/${E1}/revoke`, { reason: 'Học viên xin dừng khoá' });
    await waitFor(() => expect(within(zone).queryByRole('button', { name: 'Thu hồi Course 1' })).toBeNull());
    expect(api.getWith.mock.calls.filter(([p]) => String(p) === `/admin/learners/${U}`).length).toBe(2);
  });

  it('a failed access read says so with Tải lại, which reads again', async () => {
    let fail = true;
    api.getWith.mockImplementation((path: string) => {
      if (path.endsWith('/access')) return fail ? Promise.reject(new Error('Máy chủ chưa sẵn sàng.')) : Promise.resolve({ items: accessItems });
      return Promise.resolve(detail());
    });
    render(<AdminLearnerProfile learnerRef={U} />);
    const zone = await screen.findByRole('region', { name: 'Vùng nguy hiểm' });
    expect((await within(zone).findByRole('alert')).textContent).toMatch(/Chưa đọc được quyền học: Máy chủ chưa sẵn sàng\./);
    fail = false;
    fireEvent.click(within(zone).getByRole('button', { name: 'Tải lại' }));
    await within(zone).findByRole('button', { name: 'Thu hồi Course 1' });
  });
});
