// ADMINIA-0074 G09-T23 (FR-080, FR-081, FR-084): trang Cài đặt và ThresholdsProvider.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/settings',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { AdminSettings } from '@/app/(authed-admin)/(settings)/admin/settings/admin-settings';
import { ThresholdsProvider, useThresholds } from '@/components/admin/thresholds-provider';

const row = (key: string, group: string, label: string, value: number | null, extra: Record<string, unknown> = {}) => ({
  key, group, label, anchor: 'mốc tính', value, unit: 'giờ', min: 1, max: 336, fixed: false, ...extra,
});
const items = (writing = 48) => [
  row('writing_review_hours', 'Quá hạn xử lý', 'Bài Writing chờ giáo viên duyệt', writing),
  row('regrade_hours', 'Quá hạn xử lý', 'Yêu cầu chấm lại', 48),
  row('too_fast_sec_per_question', 'Kết quả bài giao', 'Làm quá nhanh', null, { unit: 'giây / câu', min: 1, max: 60 }),
  row('audio_retention_days', 'Lưu dữ liệu', 'Giữ bản ghi âm Speaking', null, { unit: 'ngày', min: null, max: null, fixed: true }),
  row('import_error_report_days', 'Lưu dữ liệu', 'Giữ báo cáo lỗi nhập liệu', 30, { unit: 'ngày', min: 7, max: 365 }),
];
const log = {
  items: [{
    id: 7, at: '2026-11-23T03:05:00Z', actor_name: 'Andy', section: 'thresholds',
    changes: [{ key: 'regrade_hours', label: 'Yêu cầu chấm lại', old: 72, new: 48 }], reason: 'Rút ngắn cho đợt thi',
  }],
  next_cursor: null,
};
const api = { getWith: vi.fn(), patch: vi.fn() };
const calls = (suffix: string) => api.getWith.mock.calls.filter(([p]) => String(p).startsWith(suffix)).length;

beforeEach(() => {
  nav.search = '';
  api.getWith.mockReset().mockImplementation((path: string) =>
    Promise.resolve(String(path).startsWith('/admin/settings/log') ? log : { items: items() }));
  api.patch.mockReset().mockResolvedValue({ items: items(24) });
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

async function editWriting(value: string) {
  render(<AdminSettings />);
  const input = await screen.findByLabelText('Bài Writing chờ giáo viên duyệt');
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('AdminSettings', () => {
  it('opens on the threshold table with seven tabs, grouped rows, a fixed row and the log', async () => {
    render(<AdminSettings />);
    await screen.findByLabelText('Bài Writing chờ giáo viên duyệt');
    const tabs = within(screen.getByRole('navigation', { name: 'Các thẻ cài đặt' })).getAllByRole('link');
    expect(tabs.map((t) => t.getAttribute('href'))).toEqual([
      '/admin/settings?tab=payment', '/admin/settings?tab=email', '/admin/settings?tab=legal', '/admin/settings?tab=features',
      '/admin/settings?tab=trial', '/admin/settings?tab=notices', '/admin/settings?tab=thresholds',
    ]);
    expect(tabs[6].getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Quá hạn xử lý', 'Kết quả bài giao', 'Lưu dữ liệu']);
    const fixed = screen.getByText('Giữ bản ghi âm Speaking').closest('tr')!;
    expect(within(fixed).queryByRole('textbox')).toBeNull();
    expect(fixed.textContent).toMatch(/chưa có/);
    expect((screen.getByLabelText('Làm quá nhanh') as HTMLInputElement).value).toBe('');
    await screen.findByText('Rút ngắn cho đợt thi');
    expect(screen.getByText('Yêu cầu chấm lại: 72 → 48')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu…' }).hasAttribute('disabled')).toBe(true);
  });

  it('a pending tab opened by URL says what it waits on and reads no thresholds', async () => {
    nav.search = 'tab=email';
    render(<AdminSettings />);
    expect(screen.getByText(/^Chưa mở: cần API đọc và ghi loại thư/).getAttribute('role')).toBe('status');
    await screen.findByText('Rút ngắn cho đợt thi');
    expect(calls('/admin/settings/thresholds')).toBe(0);
  });

  it('field checks stop the save and keep what was typed', async () => {
    const input = await editWriting('0');
    fireEvent.change(screen.getByLabelText('Yêu cầu chấm lại'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu…' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Chưa lưu: 2 ô cần sửa/);
    expect(screen.getByText('Từ 1 đến 336.')).toBeTruthy();
    expect(screen.getByText('Chỉ nhập số nguyên, không có chữ hay dấu.')).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('0');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('saves only after the confirm with a reason, then shows the values the server answered and reads the log again', async () => {
    await editWriting('24');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Bài Writing chờ giáo viên duyệt: 48 giờ → 24 giờ')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Ghi lý do thay đổi.');
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: 'Lớp offline trả bài trong ngày' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
    await screen.findByText(/Đã lưu 1 ngưỡng vận hành\. Đã ghi vào nhật ký cài đặt\./);
    expect(api.patch).toHaveBeenCalledWith('/admin/settings/thresholds', {
      changes: [{ key: 'writing_review_hours', value: 24 }], reason: 'Lớp offline trả bài trong ngày',
    });
    expect((screen.getByLabelText('Bài Writing chờ giáo viên duyệt') as HTMLInputElement).value).toBe('24');
    await waitFor(() => expect(calls('/admin/settings/log')).toBe(2));
  });

  it('a shorter retention warns that deleted data cannot be brought back', async () => {
    render(<AdminSettings />);
    fireEvent.change(await screen.findByLabelText('Giữ báo cáo lỗi nhập liệu'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Giữ báo cáo lỗi nhập liệu.*không lấy lại được/);
  });

  it('a refusal keeps the dialog, names the field and reloads nothing', async () => {
    api.patch.mockRejectedValue(Object.assign(new Error('“Bài Writing chờ giáo viên duyệt” phải là số nguyên từ 1 đến 336.'), {
      status: 422, code: 'out_of_range', detail: { code: 'out_of_range', key: 'writing_review_hours' },
    }));
    await editWriting('24');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: 'thử' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
    await within(dialog).findByText(/^Chưa lưu: “Bài Writing/);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(calls('/admin/settings/thresholds')).toBe(1);
    expect(screen.queryByText(/Đã lưu/)).toBeNull();
  });

  it.each([
    ['server error', () => api.patch.mockRejectedValue(Object.assign(new Error('Lỗi máy chủ.'), { status: 503, code: 'internal_error' }))],
    ['empty response', () => api.patch.mockResolvedValue(null)],
    ['missing changed threshold', () => api.patch.mockResolvedValue({ items: [] })],
    ['previous value', () => api.patch.mockResolvedValue({ items: items(48) })],
  ] as const)('an uncertain save (%s) reloads the table and the log', async (_scenario, arrange) => {
    arrange();
    await editWriting('24');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Lý do/), { target: { value: 'thử' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
    await screen.findByText(/Chưa chắc các ngưỡng đã được lưu/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Đã lưu|Không có thay đổi nào được ghi/)).toBeNull();
    await waitFor(() => expect(calls('/admin/settings/thresholds')).toBe(2));
    await waitFor(() => expect(calls('/admin/settings/log')).toBe(2));
    expect((screen.getByLabelText('Bài Writing chờ giáo viên duyệt') as HTMLInputElement).value).toBe('48');
  });

  it('a failed read says so with Tải lại', async () => {
    api.getWith.mockImplementation((path: string) =>
      String(path).startsWith('/admin/settings/log') ? Promise.resolve(log) : Promise.reject(new Error('Mạng lỗi')));
    render(<AdminSettings />);
    await screen.findByText(/Chưa đọc được bảng ngưỡng: Mạng lỗi/);
    api.getWith.mockImplementation((path: string) =>
      Promise.resolve(String(path).startsWith('/admin/settings/log') ? log : { items: items() }));
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await screen.findByLabelText('Bài Writing chờ giáo viên duyệt');
  });
});

function Probe() {
  const t = useThresholds();
  return <p data-testid="probe">{t.status}:{String(t.values.writing_review_hours ?? 'null')}</p>;
}

describe('ThresholdsProvider', () => {
  it('serves the API values, and nothing (not a guess) when the read fails', async () => {
    render(<ThresholdsProvider enabled><Probe /></ThresholdsProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready:48'));
    cleanup();
    api.getWith.mockRejectedValue(new Error('down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<ThresholdsProvider enabled><Probe /></ThresholdsProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('error:null'));
    warn.mockRestore();
  });

  it('treats an empty transport response as a failed read', async () => {
    api.getWith.mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      render(<ThresholdsProvider enabled><Probe /></ThresholdsProvider>);
      await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('error:null'));
    } finally { warn.mockRestore(); }
  });

  it('reads nothing while disabled', () => {
    render(<ThresholdsProvider enabled={false}><Probe /></ThresholdsProvider>);
    expect(screen.getByTestId('probe').textContent).toBe('off:null');
    expect(api.getWith).not.toHaveBeenCalled();
  });
});
