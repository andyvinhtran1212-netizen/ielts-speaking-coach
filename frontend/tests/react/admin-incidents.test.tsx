// ADMINIA-0074 G09-T16 (FR-070…FR-073): Hộp thư sự cố list and group pages.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/incidents',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { AdminIncidents } from '@/app/(authed-admin)/(incidents)/admin/incidents/admin-incidents';
import { AdminIncidentDetail } from '@/app/(authed-admin)/(incidents)/admin/incidents/[source]/[fingerprint]/admin-incident-detail';

const FP1 = '1'.repeat(40);
const FP2 = '2'.repeat(40);
const group = (fp: string, extra: Record<string, unknown> = {}) => ({
  source: 'errors', fingerprint: fp, title: `Lỗi ${fp[0]}`, area: 'Giao diện', count: 4, learners: 2,
  first_at: '2026-11-15T01:00:00Z', last_at: '2026-11-16T02:58:00Z', status: 'new', overdue: false, ...extra,
});
const page = (extra: Record<string, unknown> = {}) => ({
  items: [group(FP1), group(FP2, { count: 6, status: 'in_review', claimed_by_name: 'Andy' })],
  total: 2, page: 1, page_size: 25, counts: { errors: 2, grading: 0, feedback: null },
  review_items_open: 0, sources_failed: [], truncated: false, sources_truncated: [],
  generated_at: '2026-11-23T10:00:00Z', ...extra,
});
const api = { getWith: vi.fn(), post: vi.fn() };

beforeEach(() => {
  nav.search = '';
  nav.push.mockReset();
  api.getWith.mockReset().mockResolvedValue(page());
  api.post.mockReset().mockResolvedValue({ changed: 2, conflicts: [], dismiss_failed: [] });
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

describe('AdminIncidents', () => {
  it('asks for open groups by default and shows counts per source', async () => {
    render(<AdminIncidents />);
    await screen.findByText('Lỗi 1');
    expect(api.getWith).toHaveBeenCalledWith('/admin/incidents/groups?status=open&sort=learners&page=1');
    const tabs = screen.getByRole('navigation', { name: 'Nguồn sự cố' });
    expect(within(tabs).getByRole('link', { name: /Lỗi hệ thống/ }).textContent).toContain('2');
    // A failed source shows no number rather than 0.
    expect(within(tabs).getByRole('link', { name: /Phản hồi học viên/ }).textContent).not.toMatch(/\d/);
    expect(screen.getByRole('link', { name: 'Lỗi 1' }).getAttribute('href')).toBe(`/admin/incidents/errors/${FP1}`);
    expect(screen.queryByText(/câu đang chờ/)).toBeNull();
  });

  it('reads the source from ?source= and links the review queue only when it has items', async () => {
    nav.search = 'source=grading';
    api.getWith.mockResolvedValue(page({ review_items_open: 5 }));
    render(<AdminIncidents />);
    await screen.findByText('Lỗi 1');
    expect(api.getWith).toHaveBeenCalledWith('/admin/incidents/groups?status=open&sort=learners&page=1&source=grading');
    expect(screen.getByRole('link', { name: '5 câu đang chờ ở Câu cần kiểm' }).getAttribute('href')).toBe('/admin/feedback');
  });

  it('confirms a bulk resolve with groups and records, then offers Hoàn tác', async () => {
    render(<AdminIncidents />);
    await screen.findByText('Lỗi 1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả nhóm trên trang' }));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Đánh dấu đã xử lý' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Chuyển 2 nhóm (10 lần ghi nhận) sang Đã xử lý.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' })); });
    expect(api.post).toHaveBeenCalledWith('/admin/incidents/groups/bulk', {
      action: 'resolve',
      groups: [
        { source: 'errors', fingerprint: FP1, expected_count: 4, expected_last_at: '2026-11-16T02:58:00Z' },
        { source: 'errors', fingerprint: FP2, expected_count: 6, expected_last_at: '2026-11-16T02:58:00Z' },
      ],
    });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Hoàn tác' })); });
    expect(api.post).toHaveBeenLastCalledWith('/admin/incidents/groups/bulk',
      expect.objectContaining({ action: 'reopen' }));
  });

  it('says "tải lại" when every group changed meanwhile (409)', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('HTTP 409'), { status: 409 }));
    render(<AdminIncidents />);
    await screen.findByText('Lỗi 1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn nhóm Lỗi 1' }));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Bỏ qua' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' })); });
    await waitFor(() => expect(screen.getByText(/có ghi nhận mới nên chưa đổi; tải lại để xem/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
  });

  it('keeps a visible error and a reload button when the list fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.getWith.mockRejectedValue(new Error('Chưa tải được trạng thái sự cố.'));
    render(<AdminIncidents />);
    expect((await screen.findByRole('alert')).textContent).toContain('Chưa tải được trạng thái sự cố.');
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
    warn.mockRestore();
  });

  it('changing a filter goes back to page 1 in the URL', async () => {
    nav.search = 'page=2';
    render(<AdminIncidents />);
    await screen.findByText('Lỗi 1');
    fireEvent.change(screen.getByRole('combobox', { name: /Trạng thái/ }), { target: { value: 'resolved' } });
    expect(nav.push).toHaveBeenCalledWith('/admin/incidents?status=resolved');
  });
});

describe('AdminIncidentDetail', () => {
  const detail = {
    ...group(FP1), description: 'Lỗi giao diện ở /home: "Lỗi 1". 4 lần ghi nhận, 2 học viên bị ảnh hưởng.',
    learner_list: [{ ref: 'u-abc', name: 'Lan' }], technical: { path: '/home', record_ids: ['r1'] },
    notes: [{ body: 'Tự mở lại vì có ghi nhận mới.', auto: true, created_at: '2026-11-16T03:00:00Z' }],
  };

  it('shows the description, learner links, notes and a collapsed technical block', async () => {
    api.getWith.mockResolvedValue(detail);
    const view = render(<AdminIncidentDetail source="errors" fingerprint={FP1} />);
    await screen.findByText(detail.description);
    expect(api.getWith).toHaveBeenCalledWith(`/admin/incidents/groups/errors/${FP1}`);
    expect(screen.getByRole('link', { name: 'Lan' }).getAttribute('href')).toBe('/admin/learners/u-abc');
    expect(screen.getByText('Tự mở lại vì có ghi nhận mới.')).toBeTruthy();
    const technical = view.container.querySelector('details.inc-technical') as HTMLDetailsElement;
    expect(technical.open).toBe(false);
    expect(screen.getByRole('button', { name: 'Nhận xử lý' })).toBeTruthy();
  });

  it('saves a note alone with the action that changes nothing', async () => {
    api.getWith.mockResolvedValue({ ...detail, status: 'resolved' });
    api.post.mockResolvedValue({ changed: 0, conflicts: [], dismiss_failed: [] });
    render(<AdminIncidentDetail source="errors" fingerprint={FP1} />);
    await screen.findByText(detail.description);
    fireEvent.change(screen.getByLabelText('Ghi chú (không bắt buộc)'), { target: { value: 'Đã báo đội backend' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Chỉ lưu ghi chú' })); });
    expect(api.post).toHaveBeenCalledWith('/admin/incidents/groups/bulk', expect.objectContaining({
      action: 'resolve', note: 'Đã báo đội backend',
    }));
    expect(await screen.findByText('Đã lưu ghi chú.')).toBeTruthy();
  });

  it('says plainly when the group is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.getWith.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }));
    render(<AdminIncidentDetail source="errors" fingerprint={FP1} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không tìm thấy nhóm sự cố này.');
    warn.mockRestore();
  });
});
