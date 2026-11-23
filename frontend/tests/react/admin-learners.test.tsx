// ADMINIA-0074 G09-T10 (FR-020, FR-021, FR-034, FR-035): Danh bạ học viên.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/learners',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));

import { AdminLearners } from '@/app/(authed-admin)/(learners)/admin/learners/admin-learners';

const C = '30000000-0000-0000-0000-000000000001';
const row = (ref: string, extra: Record<string, unknown> = {}) => ({
  ref, student_id: `s-${ref}`, name: `Người ${ref}`, email: `${ref}@example.test`, student_code: null,
  account_state: 'active', profile_state: 'active', kind: null, courses: null, credits_left: null,
  cohorts: [{ id: C, name: 'Tue–Thu 19:30' }], attention: [], last_active_at: null, ...extra,
});
const page = (extra: Record<string, unknown> = {}) => ({
  items: [row('u-1'), row('s-2', { account_state: 'none', email: null, student_id: 's2' }),
    row('u-3', { profile_state: 'none', student_id: null, cohorts: [] })],
  total: 3, page: 1, page_size: 25, sources_failed: [], undecided: [], ...extra,
});
const summary = {
  name: 'Người u-1', cohorts: [{ id: C, name: 'Tue–Thu 19:30' }], courses: null,
  status: { level: 'attention', reasons: [{ code: 'inactive', text: 'Không hoạt động 9 ngày' }] },
  goal: { target_band: 6.5, exam_date: null, source: 'admin' }, overdue: { count: 0, latest_title: null },
  recent_bands: { writing: [6, 6.5], speaking: [] }, last_active_at: null, latest_note: null, sources_failed: [],
};
const api = { getWith: vi.fn(), post: vi.fn(), upload: vi.fn() };

beforeEach(() => {
  nav.search = '';
  nav.push.mockReset();
  api.getWith.mockReset().mockImplementation((path: string) => {
    if (path.startsWith('/admin/cohorts')) return Promise.resolve({ cohorts: [{ id: C, name: 'Tue–Thu 19:30', is_active: true }] });
    if (path.endsWith('/summary')) return Promise.resolve(summary);
    return Promise.resolve(page());
  });
  api.post.mockReset().mockResolvedValue({ assigned: 2 });
  api.upload.mockReset();
  window.sessionStorage.clear();
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

const table = () => screen.getByRole('table');

describe('AdminLearners', () => {
  it('asks for learners by default, one row per person, missing halves said plainly', async () => {
    render(<AdminLearners />);
    await screen.findByText('Người u-1');
    expect(api.getWith).toHaveBeenCalledWith('/admin/learners?role=user%2Cstudent&page=1', undefined, undefined);
    expect(within(table()).getByText('Chưa có tài khoản')).toBeTruthy();
    expect(within(table()).getByText('Chưa có hồ sơ học viên')).toBeTruthy();
    expect(within(table()).getAllByText('chưa có').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Người u-1' }).getAttribute('href')).toBe('/admin/learners/u-1');
    expect(screen.getByText('3 người · sắp theo tên')).toBeTruthy();
  });

  it('puts filters in the URL from page 1, and course filters wait for G04', async () => {
    nav.search = 'page=2';
    render(<AdminLearners />);
    await screen.findByText('Người u-1');
    fireEvent.change(screen.getByRole('combobox', { name: /Cần chú ý/ }), { target: { value: 'late_streak' } });
    expect(nav.push).toHaveBeenCalledWith('/admin/learners?attention=late_streak');
    expect((screen.getByRole('combobox', { name: /Dạng học viên/ }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('option', { name: /Sắp hết hạn/ }) as HTMLOptionElement).disabled).toBe(true);
  });

  it('searches after a pause in typing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<AdminLearners />);
      await screen.findByText('Người u-1');
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lan@example.test' } });
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(nav.push).toHaveBeenCalledWith('/admin/learners?q=lan%40example.test');
    } finally { vi.useRealTimers(); }
  });

  it('adds the selected people to a class, leaving out those with no profile', async () => {
    render(<AdminLearners />);
    await screen.findByText('Người u-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả trên trang' }));
    const bar = screen.getByRole('toolbar');
    await waitFor(() => expect(within(bar).getByRole('option', { name: 'Tue–Thu 19:30' })).toBeTruthy());
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Lớp cần gán' }), { target: { value: C } });
    await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: 'Gán' })); });
    expect(api.post).toHaveBeenCalledWith(`/admin/cohorts/${C}/students/bulk`, { student_ids: ['s-u-1', 's2'] });
    expect(await screen.findByText(/Bỏ qua 1 người chưa có hồ sơ học viên: Người u-3/)).toBeTruthy();
  });

  it('hands the reminder over with refs only', async () => {
    render(<AdminLearners />);
    await screen.findByText('Người u-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Người u-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi nhắc đăng ký lại…' }));
    expect(nav.push).toHaveBeenCalledWith('/admin/notifications?from=learners&template=renewal&ids=u-1');
    expect(window.sessionStorage.getItem('av-notify-from-learners')).toBe('[{"ref":"u-1","name":"Người u-1"}]');
  });

  it('opens "Xem nhanh" with the shared block, closes with Esc and gives focus back', async () => {
    render(<AdminLearners />);
    await screen.findByText('Người u-1');
    const opener = screen.getByRole('button', { name: 'Xem nhanh Người u-1' });
    opener.focus();
    await act(async () => { fireEvent.click(opener); });
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText(/Cần chú ý: Không hoạt động 9 ngày/);
    expect(within(drawer).getByText(/Writing: 6 · 6\.5/)).toBeTruthy();
    expect(within(drawer).getByRole('link', { name: 'Mở hồ sơ' }).getAttribute('href')).toBe('/admin/learners/u-1');
    expect(api.getWith).toHaveBeenCalledWith('/admin/learners/u-1/summary', undefined, undefined);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('shows an error with Tải lại, and an empty filter result keeps the filters', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.getWith.mockImplementation((path: string) => (path.startsWith('/admin/learners')
      ? Promise.reject(new Error('Chưa tải được danh bạ học viên.')) : Promise.resolve({ cohorts: [] })));
    const view = render(<AdminLearners />);
    expect((await screen.findByRole('alert')).textContent).toContain('Chưa tải được danh bạ học viên.');
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
    view.unmount();
    nav.search = 'q=zzz';
    api.getWith.mockImplementation((path: string) => (path.startsWith('/admin/learners')
      ? Promise.resolve(page({ items: [], total: 0 })) : Promise.resolve({ cohorts: [] })));
    render(<AdminLearners />);
    expect(await screen.findByText(/Không có ai khớp bộ lọc/)).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('zzz');
    warn.mockRestore();
  });

  it('drops an older answer that arrives after the newer query', async () => {
    let releaseOld: (v: unknown) => void = () => {};
    api.getWith.mockImplementation((path: string) => {
      if (path.startsWith('/admin/cohorts')) return Promise.resolve({ cohorts: [] });
      if (path.includes('q=lan')) return Promise.resolve(page({ items: [row('u-9', { name: 'Lan mới' })], total: 1 }));
      return new Promise((resolve) => { releaseOld = resolve; });
    });
    const view = render(<AdminLearners />);
    nav.search = 'q=lan';
    view.rerender(<AdminLearners />);
    await screen.findByText('Lan mới');
    await act(async () => { releaseOld(page()); });
    expect(screen.queryByText('Người u-1')).toBeNull();
    expect(screen.getByText('Lan mới')).toBeTruthy();
  });

  it('pages on the server, 25 per page', async () => {
    api.getWith.mockImplementation((path: string) => (path.startsWith('/admin/learners')
      ? Promise.resolve(page({ total: 60 })) : Promise.resolve({ cohorts: [] })));
    render(<AdminLearners />);
    await screen.findByText('Trang 1 trên 3');
    fireEvent.click(screen.getByRole('button', { name: 'Sau ›' }));
    expect(nav.push).toHaveBeenCalledWith('/admin/learners?page=2');
  });
});
