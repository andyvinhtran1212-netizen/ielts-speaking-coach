// ADMINIA-0074 FR-090…093 (G09-T18b): Việc cần làm on /admin under ADMIN_FRAME_V2.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminTodo } from '@/app/(authed-admin)/(overview)/admin/admin-todo';
import { QUEUE_ROWS } from '@/lib/admin-todo-model.mjs';

const ok = (count: number | null, extra: Record<string, unknown> = {}) => ({
  count, oldest_at: null, overdue: false, error: false, unavailable: false, ...extra,
});
const body = (queues: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  queues: { ...Object.fromEntries(QUEUE_ROWS.map((r) => [r.key, ok(0)])), ...queues },
  classes_week: [{
    cohort_id: 'c1', name: 'IELTS 6.5 T3', has_assignment: false, pending_review: 2, last_assignment_id: null,
    next_lesson: { lesson_id: 'l1', lesson_no: 5, date: '2026-11-25', starts_at: '19:30:00' }, following_lesson: null,
  }],
  attention_learners: [{ ref: 'u1', name: 'Nguyễn An', cohort: { id: 'c1', name: 'IELTS 6.5 T3' }, reasons: [{ code: 'inactive', text: 'Không học 7 ngày' }] }],
  ops_week: { on_time_rate: { value: 0.82, lowest_cohort_id: 'c1' }, inactive_learners: 4, review_wait_median_hours: 5.5 },
  sources_failed: [], generated_at: '2026-11-23T10:00:00Z', ...extra,
});
const api = { getWith: vi.fn() };

beforeEach(() => {
  api.getWith.mockReset();
  Object.assign(window, { api });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const row = (name: RegExp) => screen.getByRole('rowheader', { name }).closest('tr') as HTMLElement;

describe('AdminTodo', () => {
  it('reads /admin/attention and draws queues, classes, learners and ops', async () => {
    api.getWith.mockResolvedValue(body({
      writing_review: ok(3, { ai_failed: 1, oldest_at: new Date(Date.now() - 3 * 3600_000).toISOString(), overdue: true }),
    }));
    render(<AdminTodo />);
    await screen.findByRole('heading', { name: 'Việc cần làm' });
    await screen.findByText(/1 loại việc đang chờ/);
    expect(api.getWith).toHaveBeenCalledWith('/admin/attention');
    const writing = row(/^Bài chờ duyệt$/);
    expect(writing.textContent).toContain('Writing 3 · AI lỗi cần chấm tay 1');
    expect(writing.textContent).toContain('3 giờ · quá hạn');
    expect(writing.className).toBe('is-overdue');
    expect(within(writing).getByRole('link').getAttribute('href')).toBe('/admin/writing/queue');
    // A zero row says Không có; exams_today is hidden on a day without exams.
    expect(row(/^Yêu cầu chấm lại$/).textContent).toContain('Không có');
    expect(screen.queryByRole('rowheader', { name: /Kỳ thi hôm nay/ })).toBeNull();
    // Links only for live pages.
    expect(within(row(/^Bài Speaking thi thử chờ chấm$/)).queryByRole('link')).toBeNull();
    expect(within(row(/^Đơn đăng ký$/)).queryByRole('link')).toBeNull();
    expect(screen.getByRole('rowheader', { name: 'Lớp IELTS 6.5 T3' }).closest('tr')?.textContent).toContain('Chưa có bài giao');
    expect(screen.getByRole('link', { name: 'Mở lớp' }).getAttribute('href')).toBe('/admin/classes/c1');
    // FR-091: Giao bài… opens the class's Bài tập tab; no last assignment, no results link.
    expect(screen.getByRole('link', { name: 'Giao bài…' }).getAttribute('href')).toBe('/admin/classes/c1?tab=homework');
    expect(screen.queryByRole('link', { name: 'Xem kết quả bài giao' })).toBeNull();
    expect(screen.getByText('Không học 7 ngày')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Mở hồ sơ' })).toBeNull();
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('4 học viên')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Gửi nhắc/ })).toBeNull();
  });

  it('FR-091: a class with a last assignment links its results', async () => {
    const data = body();
    (data.classes_week[0] as Record<string, unknown>).last_assignment_id = 'a 9';
    api.getWith.mockResolvedValue(data);
    render(<AdminTodo />);
    const link = await screen.findByRole('link', { name: 'Xem kết quả bài giao' });
    expect(link.getAttribute('href')).toBe('/admin/classes/c1?tab=homework&assignment_id=a%209');
  });

  it('a failed source turns only its row into a warning, and Tải lại dòng này replaces that row', async () => {
    api.getWith
      .mockResolvedValueOnce(body({ regrade_new: ok(null, { error: true }), feedback_open: ok(2), incident_groups_open: ok(null, { unavailable: true }) }))
      .mockResolvedValueOnce(body({ regrade_new: ok(6), feedback_open: ok(99) }));
    render(<AdminTodo />);
    await screen.findByText(/1 loại việc đang chờ, 1 nguồn chưa tải được/);
    const failed = row(/Yêu cầu chấm lại/);
    expect(failed.className).toBe('is-warning');
    expect(failed.textContent).toContain('chưa có');
    expect(failed.textContent).not.toMatch(/\b0\b/);
    expect(row(/^Sự cố$/).textContent).toContain('chưa có trên hệ thống');
    fireEvent.click(within(failed).getByRole('button', { name: 'Tải lại dòng này' }));
    await waitFor(() => expect(row(/^Yêu cầu chấm lại$/).textContent).toContain('6'));
    // Only that row came from the second read.
    expect(row(/^Phản hồi$/).textContent).toContain('2');
    expect(row(/^Phản hồi$/).textContent).not.toContain('99');
  });

  it('shows Kỳ thi hôm nay on an exam day, and does not mark overdue when thresholds failed', async () => {
    api.getWith.mockResolvedValue(body(
      { exams_today: ok(2), regrade_new: ok(1, { overdue: true, oldest_at: new Date(Date.now() - 45 * 60_000).toISOString() }) },
      { sources_failed: ['thresholds'] },
    ));
    render(<AdminTodo />);
    await screen.findByText(/Chưa đọc được ngưỡng vận hành/);
    expect(row(/Kỳ thi hôm nay/).textContent).toContain('2');
    const regrade = row(/^Yêu cầu chấm lại$/);
    expect(regrade.className).toBe('');
    expect(regrade.textContent).not.toContain('quá hạn');
  });

  it('a null block says chưa có, never an empty list; calm state when nothing waits', async () => {
    api.getWith.mockResolvedValue(body({}, {
      classes_week: null, attention_learners: null,
      ops_week: { on_time_rate: null, inactive_learners: null, review_wait_median_hours: null },
    }));
    render(<AdminTodo />);
    await screen.findByText('Không còn việc nào đang chờ', { selector: 'p' });
    expect(screen.getByText(/chưa đọc được buổi học của các lớp/)).toBeTruthy();
    expect(screen.getByText(/chưa đọc được danh sách cần chú ý/)).toBeTruthy();
    expect(screen.queryByText(/Không lớp nào có buổi học/)).toBeNull();
    expect(screen.getAllByText('chưa có', { selector: '.todo-tile-value' })).toHaveLength(3);
  });

  it('a failed read or a foreign shape is an error with Tải lại, and retry fills the page', async () => {
    api.getWith.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ queues: [] }).mockResolvedValueOnce(body());
    render(<AdminTodo />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Chưa tải được việc cần làm');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Tải lại' }));
    await waitFor(() => expect(api.getWith).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toContain('Chưa tải được');
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await screen.findByText('Không còn việc nào đang chờ', { selector: 'p' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a row retry that comes back after a full Làm mới is dropped', async () => {
    let stale: (v: unknown) => void = () => {};
    let full: (v: unknown) => void = () => {};
    api.getWith
      .mockResolvedValueOnce(body({ regrade_new: ok(null, { error: true }) }))
      .mockReturnValueOnce(new Promise((r) => { stale = r; }))
      .mockReturnValueOnce(new Promise((r) => { full = r; }));
    render(<AdminTodo />);
    await screen.findByRole('button', { name: 'Tải lại dòng này' });
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại dòng này' }));
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    full(body({ regrade_new: ok(7) }));
    await waitFor(() => expect(row(/^Yêu cầu chấm lại$/).textContent).toContain('7'));
    stale(body({ regrade_new: ok(1) }));
    await new Promise((r) => setTimeout(r, 0));
    expect(row(/^Yêu cầu chấm lại$/).textContent).toContain('7');
    expect(row(/^Yêu cầu chấm lại$/).textContent).not.toContain('Lần thử cuối');
  });

  it('a row retry that fails again keeps the warning; the next one fills the row', async () => {
    let older: (v: unknown) => void = () => {};
    let newer: (v: unknown) => void = () => {};
    api.getWith
      .mockResolvedValueOnce(body({ regrade_new: ok(null, { error: true }) }))
      .mockReturnValueOnce(new Promise((r) => { older = r; }))
      .mockReturnValueOnce(new Promise((r) => { newer = r; }));
    render(<AdminTodo />);
    const button = await screen.findByRole('button', { name: 'Tải lại dòng này' });
    fireEvent.click(button);
    // The row is busy while its retry runs, so one row has one retry at a time.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    older(body({ regrade_new: ok(null, { error: true }) }));
    const again = await screen.findByRole('button', { name: 'Tải lại dòng này' });
    fireEvent.click(again);
    newer(body({ regrade_new: ok(3) }));
    await waitFor(() => expect(row(/^Yêu cầu chấm lại$/).textContent).toContain('3'));
  });

  it('only the newest read fills the page', async () => {
    let first: (v: unknown) => void = () => {};
    api.getWith.mockReturnValueOnce(new Promise((r) => { first = r; })).mockResolvedValueOnce(body({ regrade_new: ok(5) }));
    render(<AdminTodo />);
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await waitFor(() => expect(row(/^Yêu cầu chấm lại$/).textContent).toContain('5'));
    first(body({ regrade_new: ok(1) }));
    await new Promise((r) => setTimeout(r, 0));
    expect(row(/^Yêu cầu chấm lại$/).textContent).toContain('5');
  });
});
