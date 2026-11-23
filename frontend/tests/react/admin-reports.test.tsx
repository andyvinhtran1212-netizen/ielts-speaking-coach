// ADMINIA-0074 G09-T41 (FR-164): Báo cáo /admin/reports, one page with four tabs.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/reports',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { AdminReports } from '@/app/(authed-admin)/(reports)/admin/reports/admin-reports';

const overview = (extra: Record<string, unknown> = {}) => ({
  students: { total: 40, active_7d: 12, active_30d: 25, by_cohort: [{ cohort_id: 'c1', cohort_name: 'Lớp Tue–Thu 19:30', count: 14 }] },
  skills: {
    speaking: { sessions_total: 300, sessions_7d: 18, avg_band_7d: 6 },
    writing: { essays_total: 120, essays_7d: 9, feedback_pending: 3 },
    listening: { attempts_total: 80, attempts_7d: 0, content_count: 10, avg_score_7d: null, dictation_total: 5, dictation_7d: 1 },
    reading: { attempts_total: 60, attempts_7d: 4, avg_score_7d: 0.7 },
    vocab: { words_total: 1, due_review_today: 0 },
    grammar: { articles_viewed_7d: 0 },
  },
  errors: { undismissed: 0, last_24h: 0, last_7d: 0 },
  access_codes: { active: 1, by_type: { mass: 1, direct: 0, staff: 0 } },
  recent_activity: [], generated_at: '2026-11-23T03:00:00Z', partial_failures: [], ...extra,
});
const usage = {
  overall: { calls: 10, priced_calls: 8, unpriced_calls: 2, failed_calls: 1, cost_usd: 1.5, by_service: { claude: { calls: 8, cost_usd: 1.2 }, gemini: { calls: 2, cost_usd: 0.3 } } },
  per_user: [],
  meta: { query_limit: 10000, returned_rows: 10, total_matching_rows: 10, truncated: false },
};
const traffic = (extra: Record<string, unknown> = {}) => ({
  date_from: '2026-11-17T00:00:00+00:00', date_to: null, route: null,
  snapshot_to: '2026-11-23T02:59:55+00:00', effective_to: '2026-11-23T02:59:55+00:00',
  data_status: 'complete', total_views: 50, unique_visitors: 20, anonymous_hits: 8,
  top_pages: [{ path: '/', views: 30 }], daily: [], truncated: false, ...extra,
});

const api = { getWith: vi.fn() };
let blobs: Blob[] = [];

async function settle() {
  await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
}

beforeEach(() => {
  nav.search = '';
  nav.push.mockReset();
  api.getWith.mockReset().mockImplementation(async (path: string) => {
    if (path === '/admin/overview') return overview();
    if (path.startsWith('/admin/ai-usage')) return usage;
    if (path.startsWith('/admin/analytics/foot-traffic')) return traffic();
    throw new Error(`unexpected ${path}`);
  });
  Object.assign(window, { api });
  blobs = [];
  Object.assign(URL, {
    createObjectURL: vi.fn((b: Blob) => { blobs.push(b); return 'blob:x'; }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AdminReports', () => {
  it('opens Hoạt động học viên for 30 days by default: tiles, tables, gaps with reasons, detail links', async () => {
    render(<AdminReports />);
    await settle();
    expect(api.getWith).toHaveBeenCalledWith('/admin/overview');
    const tabs = screen.getByRole('navigation', { name: 'Thẻ báo cáo' });
    expect(within(tabs).getByRole('link', { name: 'Hoạt động học viên' }).getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByRole('link', { name: 'Chi phí AI' }).getAttribute('href')).toBe('/admin/reports?tab=chi-phi-ai&range=30');
    expect(screen.getByRole('button', { name: '30 ngày' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Học viên hoạt động').nextElementSibling?.textContent).toBe('25');
    expect(screen.getByRole('heading', { name: 'Bảng 1 · Bài làm theo kỹ năng' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Lớp Tue–Thu 19:30' })).toBeTruthy();
    const weekly = screen.getByRole('region', { name: 'Hình 1 · Người hoạt động theo tuần' });
    expect(weekly.textContent).toContain('chưa có');
    expect(screen.getByRole('link', { name: 'Bài Reading' }).getAttribute('href')).toBe('/admin/dashboard/reading-attempts');
    expect(document.body.textContent).not.toMatch(/\b0\/0\b/);
  });

  it('90 days: the active tile says "chưa có" with the reason instead of a number', async () => {
    nav.search = 'tab=hoat-dong&range=90';
    render(<AdminReports />);
    await settle();
    const label = screen.getByText('Học viên hoạt động');
    expect(label.nextElementSibling?.textContent).toBe('chưa có');
    expect(label.parentElement?.textContent).toContain('nguồn chỉ tính sẵn 7 và 30 ngày');
  });

  it('range and tab changes go through the URL, so a reload keeps both', async () => {
    nav.search = 'tab=luu-luong&range=30';
    render(<AdminReports />);
    await settle();
    expect(api.getWith).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/analytics\/foot-traffic\?date_from=\d{4}-\d{2}-\d{2}&date_to=\d{4}-\d{2}-\d{2}$/));
    fireEvent.click(screen.getByRole('button', { name: '7 ngày' }));
    expect(nav.push).toHaveBeenLastCalledWith('/admin/reports?tab=luu-luong&range=7');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Thẻ báo cáo' })).getByRole('link', { name: 'Chi phí AI' }));
    expect(nav.push).toHaveBeenLastCalledWith('/admin/reports?tab=chi-phi-ai&range=30');
  });

  it('Chi phí AI asks for ?days= of the range and shows unpriced calls on their own', async () => {
    nav.search = 'tab=chi-phi-ai&range=7';
    render(<AdminReports />);
    await settle();
    expect(api.getWith).toHaveBeenCalledWith('/admin/ai-usage?days=7');
    expect(screen.getByText('Chi phí trong kỳ').nextElementSibling?.textContent).toBe('1,50 US$');
    expect(screen.getByText('Lượt gọi chưa có chi phí đơn vị').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByRole('rowheader', { name: 'Claude' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Ngân sách AI tháng này' }).textContent).toContain('chưa có');
  });

  it('a failed source breaks only its tab: error with Tải lại, no number, and a retry reads again', async () => {
    nav.search = 'tab=chi-phi-ai';
    api.getWith.mockRejectedValueOnce(new Error('503'));
    render(<AdminReports />);
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Chưa tải được chi phí AI');
    expect(screen.queryByText('Chi phí trong kỳ')).toBeNull();
    expect((screen.getByRole('button', { name: 'Xuất CSV' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(within(alert).getByRole('button', { name: 'Tải lại' })); });
    await settle();
    expect(screen.getByText('Chi phí trong kỳ')).toBeTruthy();
    expect(api.getWith).toHaveBeenCalledTimes(2);
  });

  it('a foreign shape is an error, never an empty report', async () => {
    api.getWith.mockResolvedValue({ unexpected: true });
    render(<AdminReports />);
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Chưa tải được hoạt động học viên');
  });

  it('partial traffic warns above the figure and leaves missing days as "không có dữ liệu"', async () => {
    nav.search = 'tab=luu-luong&range=7';
    api.getWith.mockResolvedValue(traffic({ data_status: 'partial', truncated: true }));
    render(<AdminReports />);
    await settle();
    expect(screen.getByRole('note').textContent).toMatch(/Thiếu một phần dữ liệu/);
    expect(screen.getByText('Lượt xem trang').nextElementSibling?.textContent).toBe('≥ 50');
    expect(screen.getAllByText('không có dữ liệu').length).toBe(7);
  });

  it('Chất lượng nội dung shows three "chưa có" numbers and loads nothing', async () => {
    nav.search = 'tab=chat-luong';
    render(<AdminReports />);
    await settle();
    expect(api.getWith).not.toHaveBeenCalled();
    for (const label of ['Câu đang chờ kiểm', 'Học viên báo lỗi đáp án', 'Tỉ lệ sai bất thường']) {
      expect(screen.getByText(label).nextElementSibling?.textContent).toBe('chưa có');
    }
  });

  it('Xuất CSV writes the open tab\'s tables and says so', async () => {
    nav.search = 'tab=chi-phi-ai&range=7';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<AdminReports />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Xuất CSV' }));
    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });
    expect(text).toContain('Hình 7 · Chi phí AI theo dịch vụ');
    expect(text).toContain('Claude,8,1.20,0.1500,80.0');
    expect(screen.getByRole('status').textContent).toBe('Đã tạo file CSV của thẻ Chi phí AI cho 7 ngày gần nhất: mỗi bảng số liệu là một phần trong file.');
  });

  it('only the newest read fills the page', async () => {
    let release: (v: unknown) => void = () => {};
    api.getWith.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const view = render(<AdminReports />);
    nav.search = 'tab=chi-phi-ai&range=7';
    view.rerender(<AdminReports />);
    await settle();
    release(overview());
    await settle();
    expect(screen.getByText('Chi phí trong kỳ')).toBeTruthy();
    expect(screen.queryByText('Học viên hoạt động')).toBeNull();
  });
});
