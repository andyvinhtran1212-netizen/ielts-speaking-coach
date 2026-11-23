// MOCKORG-0086 T032 (G09-T32): Kỳ thi list and "Tổ chức kỳ thi". The pages
// draw what the API returns and read it back after every write.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockExamList } from '@/app/(authed-admin)/(mock-tests)/admin/mock-tests/mock-exam-list';
import { MockExamSetup } from '@/app/(authed-admin)/(mock-tests)/admin/mock-tests/mock-exam-setup';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  window.api = { get, post, patch } as unknown as typeof window.api;
  window.history.replaceState(null, '', '/admin/mock-tests');
});

afterEach(() => { cleanup(); vi.clearAllMocks(); get.mockReset(); post.mockReset(); patch.mockReset(); });

const exam = (over: Record<string, unknown> = {}) => ({
  id: 'e1', code: 'KT1', title: 'Thi thử cuối khoá', status: 'draft', exam_mode: 'sequential', exam_mode_v2: 'live',
  is_open: false, active_section: 'not_started', created_at: '2026-11-20T01:00:00Z', review_eligible: false,
  display_state: 'draft', audience_count: 0, skills: ['listening', 'reading', 'writing', 'speaking'], ...over,
});

function routes(table: Record<string, unknown | (() => unknown)>) {
  get.mockImplementation(async (path: string) => {
    const key = Object.keys(table).find((k) => path.startsWith(k));
    if (!key) throw new Error(`unexpected GET ${path}`);
    const value = table[key];
    return typeof value === 'function' ? (value as () => unknown)() : value;
  });
}

describe('Kỳ thi list (FR-140)', () => {
  it('draws state, people, mode, time, skills and next step; draft links to its setup', async () => {
    routes({ '/admin/mock-exams': { exams: [
      exam(),
      exam({ id: 'e2', title: 'Thi tháng 11', status: 'published', display_state: 'open', exam_mode: 'retake', exam_mode_v2: 'self_paced', audience_count: 26, skills: ['listening', 'reading'], open_from: '2026-11-25T01:00:00Z', open_until: '2026-11-27T16:59:00Z' }),
      exam({ id: 'e3', title: 'Kỳ cũ', status: 'published', display_state: null, audience_count: null, skills: null }),
    ] } });
    render(<MockExamList />);
    const draft = await screen.findByRole('link', { name: 'Thi thử cuối khoá' });
    expect(draft.getAttribute('href')).toBe('/admin/mock-tests/e1/setup');
    const row = screen.getByRole('link', { name: 'Thi tháng 11' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('26 người')).toBeTruthy();
    expect(within(row).getByText('Làm trong khoảng thời gian')).toBeTruthy();
    expect(within(row).getByText('Đang mở')).toBeTruthy();
    expect(within(row).getByText('08:00 25/11/2026 – 23:59 27/11/2026')).toBeTruthy();
    expect(within(row).getByText('L R')).toBeTruthy();
    const old = screen.getByRole('link', { name: 'Kỳ cũ' }).closest('tr') as HTMLElement;
    expect(within(old).getByText('Chưa xác định')).toBeTruthy();
    expect(within(old).getByText('Chưa có số người')).toBeTruthy();
    expect(screen.getByText(/Chưa đọc được trạng thái/)).toBeTruthy();
    // No machine code on screen.
    expect(screen.queryByText('KT1')).toBeNull();
  });

  it('"Đang diễn ra" holds the open self-paced exam', async () => {
    routes({ '/admin/mock-exams': { exams: [exam(), exam({ id: 'e2', title: 'Đang mở', status: 'published', display_state: 'open', exam_mode_v2: 'self_paced' })] } });
    render(<MockExamList />);
    await screen.findByRole('link', { name: 'Thi thử cuối khoá' });
    fireEvent.click(screen.getByRole('button', { name: /Đang diễn ra/ }));
    expect(screen.queryByRole('link', { name: 'Thi thử cuối khoá' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Đang mở' })).toBeTruthy();
  });

  it('empty and error states', async () => {
    routes({ '/admin/mock-exams': { exams: [] } });
    render(<MockExamList />);
    expect(await screen.findByText('Chưa có kỳ thi nào')).toBeTruthy();
    cleanup();
    get.mockRejectedValue(new Error('mất kết nối'));
    render(<MockExamList />);
    expect(await screen.findByText('Chưa tải được danh sách kỳ thi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  });
});

describe('Tổ chức kỳ thi (FR-141…FR-144)', () => {
  const audience = (items: unknown[] = []) => ({ items, practice_overlap: null });
  const person = (over: Record<string, unknown> = {}) => ({
    user_id: 'u1', student_id: 's1', name: 'Hồ Thiên Ân', cohort: 'Lớp A', source: { kind: 'cohort', label: 'Lớp A' },
    skills: ['listening', 'reading', 'writing', 'speaking'], selected: true, excluded_reason: null, ...over,
  });

  it('a new exam is created on the first save with its papers and a hidden code, then the page reads it back', async () => {
    let created = false;
    routes({
      '/admin/mock-exams/picker': { items: [{ id: 'R1', title: 'Academic Test 2' }], total: 1, limit: 25, offset: 0 },
      '/admin/mock-exams/e1/audience': audience(),
      '/admin/mock-exams': () => ({ exams: created ? [exam({ title: 'Thi thử', skills: ['reading'], reading_test_id: 'R1' })] : [] }),
    });
    post.mockImplementation(async () => { created = true; return { id: 'e1' }; });
    render(<MockExamSetup examId={null} />);
    fireEvent.change(screen.getByLabelText('Tên kỳ thi'), { target: { value: 'Thi thử' } });
    for (const name of ['Listening', 'Writing', 'Speaking']) fireEvent.click(screen.getByRole('button', { name }));
    await screen.findByRole('option', { name: 'Academic Test 2' });
    fireEvent.change(screen.getByLabelText(/Đề Reading/), { target: { value: 'R1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/admin/mock-exams');
    expect(body).toMatchObject({ title: 'Thi thử', skills: ['reading'], reading_test_id: 'R1', exam_mode: 'live', private_content_copy: true });
    expect(body.code).toMatch(/^KT\d{8}-/);
    expect(body).not.toHaveProperty('listening_test_id');
    await waitFor(() => expect(window.location.pathname).toBe('/admin/mock-tests/e1/setup'));
    expect(await screen.findByText(/đã lưu lúc/)).toBeTruthy();
  });

  it('at least one skill: with none the page warns and the save is refused', async () => {
    routes({ '/admin/mock-exams/picker': { items: [], total: 0, limit: 25, offset: 0 } });
    render(<MockExamSetup examId={null} />);
    fireEvent.change(screen.getByLabelText('Tên kỳ thi'), { target: { value: 'X' } });
    for (const name of ['Listening', 'Reading', 'Writing', 'Speaking']) fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByText(/Chưa chọn kỹ năng nào/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect(await screen.findByText(/Chưa lưu được nháp lúc .*: Chọn ít nhất một kỹ năng\. Thay đổi vẫn còn/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('a failed save keeps the edits and says so', async () => {
    routes({ '/admin/mock-exams/e1/audience': audience(), '/admin/mock-exams/picker': { items: [], total: 0, limit: 25, offset: 0 }, '/admin/mock-exams': { exams: [exam()] } });
    patch.mockRejectedValue(new Error('mất kết nối'));
    render(<MockExamSetup examId="e1" />);
    const title = await screen.findByLabelText('Tên kỳ thi');
    fireEvent.change(title, { target: { value: 'Tên mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect(await screen.findByText('Lưu nháp không thành công')).toBeTruthy();
    expect((screen.getByLabelText('Tên kỳ thi') as HTMLInputElement).value).toBe('Tên mới');
  });

  it('people: a row edit goes to the API and the list is read back, a person without an account cannot be selected', async () => {
    let rows = [person(), person({ student_id: 's2', user_id: null, name: 'Chưa có TK', selected: false, source: { kind: 'learner', label: 'Học viên lẻ' } })];
    routes({
      '/admin/mock-exams/e1/audience': () => audience(rows),
      '/admin/mock-exams': { exams: [exam({ draft_state: { step: 'audience' } })] },
    });
    patch.mockImplementation(async () => { rows = [{ ...rows[0], selected: false }, rows[1]]; return audience(rows); });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=audience');
    render(<MockExamSetup examId="e1" />);
    const box = await screen.findByRole('checkbox', { name: 'Chọn Hồ Thiên Ân' });
    expect((screen.getByRole('checkbox', { name: 'Chọn Chưa có TK' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Chưa có tài khoản nên chưa chọn được')).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/mock-exams/e1/audience', { set: [{ student_id: 's1', selected: false }] }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Chọn Hồ Thiên Ân' }) as HTMLInputElement).checked).toBe(false));
    expect(screen.getByRole('button', { name: 'Dùng nhóm đã lưu' }).hasAttribute('disabled')).toBe(true);
  });

  it('review: Lên lịch stays off and names what is missing; the server 422 list wins', async () => {
    routes({
      '/admin/mock-exams/e1/audience': audience([person()]),
      '/admin/mock-exams': { exams: [exam({ skills: ['reading'], reading_test_id: 'R1', starts_at: '2026-11-25T13:00:00Z' })] },
    });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=review');
    render(<MockExamSetup examId="e1" />);
    const button = await screen.findByRole('button', { name: 'Lên lịch' });
    expect(button.hasAttribute('disabled')).toBe(false);
    post.mockRejectedValue(Object.assign(new Error('Chưa lên lịch được.'), { status: 422, detail: { code: 'not_ready', missing: ['paper_not_ready'] } }));
    fireEvent.click(button);
    expect(await screen.findByText(/Một đề đã chọn chưa sẵn sàng/)).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/admin/mock-exams/e1/schedule', {});
  });

  it('review: with Speaking and no paper, and no time, the button is off with the reasons', async () => {
    routes({ '/admin/mock-exams/e1/audience': audience([]), '/admin/mock-exams': { exams: [exam({ skills: ['speaking'] })] } });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=review');
    render(<MockExamSetup examId="e1" />);
    const button = await screen.findByRole('button', { name: 'Lên lịch' });
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(screen.getByText('Speaking chưa có đề')).toBeTruthy();
    expect(screen.getByText('Chưa có người thi nào được chọn')).toBeTruthy();
    expect(screen.getByText('Chưa có ngày giờ thi')).toBeTruthy();
  });

  it('self-paced mode names the one-go time and offers no break between parts', async () => {
    routes({ '/admin/mock-exams/e1/audience': audience([]), '/admin/mock-exams': { exams: [exam({ skills: ['listening', 'reading'] })] } });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=mode');
    render(<MockExamSetup examId="e1" />);
    fireEvent.click(await screen.findByRole('radio', { name: /Làm trong khoảng thời gian/ }));
    expect(screen.getByText('Người thi cần một quãng liền khoảng 92 phút.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/(?<!không )nghỉ giữa các phần|số lần làm/i);
  });

  it('flag off: the people step says the list is not on', async () => {
    routes({ '/admin/mock-exams': { exams: [exam()] } });
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/audience')) throw Object.assign(new Error('off'), { status: 409, code: 'audiences_disabled' });
      return { exams: [exam()] };
    });
    render(<MockExamSetup examId="e1" />);
    expect(await screen.findByText('Danh sách người thi chưa bật')).toBeTruthy();
  });

  it('a scheduled exam is not edited here', async () => {
    routes({ '/admin/mock-exams': { exams: [exam({ status: 'published', display_state: 'scheduled' })] } });
    render(<MockExamSetup examId="e1" />);
    expect(await screen.findByText('Kỳ thi đã lên lịch')).toBeTruthy();
  });
});
