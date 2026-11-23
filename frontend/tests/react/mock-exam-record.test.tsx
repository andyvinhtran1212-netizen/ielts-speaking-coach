// MOCKORG-0086 T034 PR 1 (G09-T34): trang một kỳ thi. Every write is read back.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockExamRecord } from '@/app/(authed-admin)/(mock-tests)/admin/mock-tests/[examId]/mock-exam-record';

const get = vi.fn();
const post = vi.fn();

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  window.api = { get, post } as unknown as typeof window.api;
  window.history.replaceState(null, '', '/admin/mock-tests/e1');
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); get.mockReset(); post.mockReset(); });

const exam = (over: Record<string, unknown> = {}) => ({
  id: 'e1', code: 'KT1', title: 'Thi tháng 11', status: 'published', exam_mode: 'sequential', exam_mode_v2: 'live',
  is_open: true, active_section: 'reading', created_at: '2026-11-20T01:00:00Z', display_state: 'running',
  audience_count: 2, skills: ['listening', 'reading'], listening_test_id: 'L1', reading_test_id: 'R1',
  starts_at: '2026-11-25T13:00:00Z', ...over,
});
const liveExam = (over: Record<string, unknown> = {}) => ({
  id: 'e1', title: 'Thi tháng 11', exam_mode: 'sequential', exam_mode_v2: 'live', is_open: true,
  active_section: 'reading', configured_sections: ['listening', 'reading'], section_time_left_seconds: 600, ...over,
});
const student = (over: Record<string, unknown> = {}) => ({
  sitting_id: 's1', user_id: 'u1', student_name: 'Hồ Thiên Ân', started: true, in_roster: true,
  sections: { listening: { state: 'submitted', submitted_at: '2026-11-25T13:40:00Z' }, reading: { state: 'working', answered: 12, total: 40, last_activity_at: new Date().toISOString(), live: true } },
  ...over,
});

function routes(table: Record<string, unknown | (() => unknown)>) {
  get.mockImplementation(async (path: string) => {
    const key = Object.keys(table).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
    if (!key) throw new Error(`unexpected GET ${path}`);
    const value = table[key];
    return typeof value === 'function' ? (value as () => unknown)() : value;
  });
}

describe('exam record (FR-145)', () => {
  it('opens on the tab of its state, and a tab click moves the URL', async () => {
    routes({ '/admin/mock-exams/e1/live': { exam: liveExam(), students: [student()], idle_threshold_minutes: 5 }, '/admin/mock-exams': { exams: [exam()] } });
    render(<MockExamRecord examId="e1" initialTab={null} />);
    expect(await screen.findByRole('heading', { name: 'Thi tháng 11' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Theo dõi' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Đề', 'Thí sinh', 'Theo dõi', 'Chấm', 'Phân tích', 'Trả kết quả', 'Nhật ký']);
    fireEvent.click(screen.getByRole('tab', { name: 'Đề' }));
    expect(window.location.search).toBe('?tab=de');
    expect(screen.getByText('Đề đã khoá vì kỳ thi đã lên lịch. Muốn đổi đề thì tạo kỳ thi khác.')).toBeTruthy();
  });

  it('an unknown exam and a failed read are drawn, not left blank', async () => {
    routes({ '/admin/mock-exams': { exams: [] } });
    render(<MockExamRecord examId="e1" initialTab={null} />);
    expect(await screen.findByText('Không tìm thấy kỳ thi')).toBeTruthy();
    cleanup();
    get.mockRejectedValue(new Error('mất kết nối'));
    render(<MockExamRecord examId="e1" initialTab={null} />);
    expect(await screen.findByText('Chưa tải được kỳ thi')).toBeTruthy();
  });

  it('Chấm, Phân tích, Trả kết quả point to the current console; no release button here', async () => {
    routes({ '/admin/mock-exams': { exams: [exam({ display_state: 'grading' })] } });
    render(<MockExamRecord examId="e1" initialTab={null} />);
    const link = await screen.findByRole('link', { name: 'Mở bảng chấm hiện tại' });
    expect(link.getAttribute('href')).toBe('/admin/mock-tests?view=console&tab=review&exam_id=e1');
    expect(screen.queryByRole('button', { name: /Trả kết quả/ })).toBeNull();
  });

  it('Nhật ký reads the events, filters by kind and shows a failed read', async () => {
    routes({
      '/admin/mock-exams/e1/events': { items: [{ id: 'v1', kind: 'extra_time', payload: { section: 'reading', seconds: 300, reason: 'mất điện' }, actor_name: 'Andy', created_at: '2026-11-25T13:10:00Z' }] },
      '/admin/mock-exams': { exams: [exam()] },
    });
    render(<MockExamRecord examId="e1" initialTab="nhat-ky" />);
    expect(await screen.findByText('Reading · +5 phút · lý do: mất điện')).toBeTruthy();
    get.mockRejectedValueOnce(new Error('máy chủ lỗi'));
    fireEvent.change(screen.getByLabelText('Loại sự kiện'), { target: { value: 'released' } });
    expect(await screen.findByText('Chưa đọc được nhật ký')).toBeTruthy();
    expect(get).toHaveBeenLastCalledWith('/admin/mock-exams/e1/events?kind=released');
  });
});

describe('Theo dõi (FR-146, FR-151)', () => {
  it('live: collect asks first, then the room is read again', async () => {
    let collected = false;
    routes({
      '/admin/mock-exams/e1/live': () => ({ exam: liveExam(collected ? { collected_section: 'reading' } : {}), students: [student()], idle_threshold_minutes: 5 }),
      '/admin/mock-exams': { exams: [exam()] },
    });
    post.mockImplementation(async () => { collected = true; return {}; });
    render(<MockExamRecord examId="e1" initialTab="theo-doi" />);
    const row = (await screen.findByText('Hồ Thiên Ân')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Đang làm · 12/40')).toBeTruthy();
    expect(screen.getByText('Không có cảnh báo.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thu bài và sang phần sau…' }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Thu bài' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/mock-exams/e1/collect?from_section=reading', {}));
    expect(await screen.findByText('Đang thu bài…')).toBeTruthy();
  });

  it('a failed poll keeps the last read dimmed and locks the controls', async () => {
    let fail = false;
    routes({
      '/admin/mock-exams/e1/live': () => { if (fail) throw new Error('mất mạng'); return { exam: liveExam(), students: [student()] }; },
      '/admin/mock-exams': { exams: [exam()] },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MockExamRecord examId="e1" initialTab="theo-doi" />);
    await screen.findByText('Hồ Thiên Ân');
    fail = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(await screen.findByText('Mất cập nhật')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thu bài và sang phần sau…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Hồ Thiên Ân')).toBeTruthy();
  });

  it('self-paced: four counts; extra time needs a reason and goes to the running part', async () => {
    routes({
      '/admin/mock-exams/e1/live': { exam: liveExam({ exam_mode: 'retake', exam_mode_v2: 'self_paced', active_section: 'not_started' }), students: [
        student({ self_paced_state: 'in_progress', current_section: 'reading', section_time_left_seconds: 900, expected_end_at: '2026-11-25T14:30:00Z' }),
        student({ sitting_id: null, user_id: 'u2', student_name: 'Bình', started: false, self_paced_state: 'not_started', sections: {} }),
      ] },
      '/admin/mock-exams': { exams: [exam({ exam_mode: 'retake', exam_mode_v2: 'self_paced', display_state: 'open' })] },
    });
    post.mockResolvedValue({});
    render(<MockExamRecord examId="e1" initialTab={null} />);
    const counts = await screen.findByRole('region', { name: 'Tổng quan' });
    expect(within(counts).getAllByText('1')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Nhắc' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cộng giờ…' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Cộng giờ' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Lý do (bắt buộc)'), { target: { value: 'mất điện' } });
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/mock-exams/e1/extra-time', { sitting_id: 's1', section: 'reading', seconds: 300, reason: 'mất điện' }));
    expect(await screen.findByText('Đã cộng 5 phút cho Hồ Thiên Ân.')).toBeTruthy();
  });
});

describe('Thí sinh (FR-149)', () => {
  const base = (flags: Record<string, boolean>) => ({
    '/admin/mock-exams/e1/live': { exam: liveExam({ active_section: 'done' }), students: [student({ assigned_skills: ['listening', 'reading'] })] },
    '/admin/mock-exams/e1/audience': { items: [{ user_id: 'u1', student_id: 'st1', name: 'Hồ Thiên Ân', source: { kind: 'cohort', label: 'Lớp A' }, skills: ['listening', 'reading'], selected: true }] },
    '/admin/mock-exams/e1/roster': { roster: [{ sitting_id: 's1', review_id: 'r1', retest_flags: flags, retest_skills: ['listening', 'reading'] }] },
    '/admin/mock-exams': { exams: [exam({ display_state: 'grading' }), exam({ id: 'm1', title: 'Thi bù tháng 11', exam_mode: 'retake', exam_mode_v2: 'self_paced', display_state: 'open' })] },
  });

  it('flag for retest: the ticked skills go to the server and the roster is read back', async () => {
    let flags: Record<string, boolean> = {};
    routes({ ...base({}), '/admin/mock-exams/e1/roster': () => ({ roster: [{ sitting_id: 's1', review_id: 'r1', retest_flags: flags, retest_skills: ['listening', 'reading'] }] }) });
    post.mockImplementation(async () => { flags = { reading: true }; return {}; });
    render(<MockExamRecord examId="e1" initialTab="thi-sinh" />);
    const row = (await screen.findByText('Lớp A')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Đánh dấu cần thi bù' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Reading'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/mock-exams/sittings/s1/retest-flags', { retest_flags: { listening: false, reading: true } }));
    await waitFor(() => expect(within(screen.getByText('Lớp A').closest('tr') as HTMLElement).getByText('Reading')).toBeTruthy());
  });

  it('make-up: assigns the separate self-paced exam with the window and the source exam', async () => {
    routes(base({ reading: true }));
    post.mockResolvedValue({});
    render(<MockExamRecord examId="e1" initialTab="thi-sinh" />);
    const row = (await screen.findByText('Lớp A')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Cho thi bù…' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Cho thi bù' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Đóng lúc (giờ Việt Nam, bắt buộc)'), { target: { value: '2026-11-30T23:59' } });
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/admin/mock-exams/m1/assignments');
    expect(body).toEqual({ assignments: [{ user_id: 'u1', skills: ['reading'], open_from: null, open_until: expect.stringMatching(/^2026-11-30T/) }], source_exam_id: 'e1' });
    expect(await screen.findByText('Đã cho Hồ Thiên Ân thi bù.')).toBeTruthy();
  });

  it('a roster that cannot be read locks the flag button and says why', async () => {
    routes({ ...base({}), '/admin/mock-exams/e1/roster': () => { throw new Error('bảng chấm lỗi'); } });
    render(<MockExamRecord examId="e1" initialTab="thi-sinh" />);
    expect(await screen.findByText('Chưa đọc được dấu thi bù')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đánh dấu cần thi bù' }).hasAttribute('disabled')).toBe(true);
  });
});
