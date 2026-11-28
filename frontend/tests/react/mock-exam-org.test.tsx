// MOCKORG-0086 T032 (G09-T32): Kỳ thi list and "Tổ chức kỳ thi". The pages
// draw what the API returns and read it back after every write.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  window.api = { get, getWith: get, post, patch } as unknown as typeof window.api;
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

  it('Tiếp tục retries one code collision and the saved draft opens again from its URL', async () => {
    routes({
      '/admin/mock-exams/picker': { items: [], total: 0, limit: 25, offset: 0 },
      '/admin/mock-exams/e1/audience': audience(),
      '/admin/mock-exams': { exams: [exam({ title: 'Kỳ thi mới', draft_state: { step: 'audience' } })] },
    });
    post.mockRejectedValueOnce(Object.assign(new Error('Trùng mã'), { status: 409 }))
      .mockResolvedValueOnce({ id: 'e1' });
    window.history.replaceState(null, '', '/admin/mock-tests/new');
    render(<MockExamSetup examId={null} />);
    fireEvent.change(screen.getByLabelText('Tên kỳ thi'), { target: { value: 'Kỳ thi mới' } });
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.5);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
      await screen.findByRole('heading', { name: 'Người thi' });
    } finally {
      random.mockRestore();
    }
    expect(post).toHaveBeenCalledTimes(2);
    const [[firstPath, first], [retryPath, retry]] = post.mock.calls;
    expect(firstPath).toBe('/admin/mock-exams');
    expect(retryPath).toBe(firstPath);
    expect(first).toMatchObject({ title: 'Kỳ thi mới', draft_state: { step: 'audience' } });
    expect(retry.code).not.toBe(first.code);
    expect(retry).toEqual({ ...first, code: retry.code });
    expect(window.location.pathname + window.location.search).toBe('/admin/mock-tests/e1/setup?step=audience');

    cleanup();
    const idFromUrl = window.location.pathname.split('/').at(-2) ?? null;
    render(<MockExamSetup examId={idFromUrl} />);
    expect(await screen.findByRole('heading', { name: /Tổ chức kỳ thi · Kỳ thi mới/ })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Người thi' })).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('allows only one draft POST while saving and keeps the first requested step', async () => {
    routes({
      '/admin/mock-exams/picker': { items: [], total: 0, limit: 25, offset: 0 },
      '/admin/mock-exams/e1/audience': audience(),
      '/admin/mock-exams': { exams: [exam({ title: 'Một bản nháp', draft_state: { step: 'audience' } })] },
    });
    let finishCreate!: (result: { id: string }) => void;
    post.mockImplementation(() => new Promise((resolve) => { finishCreate = resolve; }));
    window.history.replaceState(null, '', '/admin/mock-tests/new');
    render(<MockExamSetup examId={null} />);
    fireEvent.change(screen.getByLabelText('Tên kỳ thi'), { target: { value: 'Một bản nháp' } });
    const next = screen.getByRole('button', { name: 'Tiếp tục' });
    const saveDraft = screen.getByRole('button', { name: 'Lưu nháp' });
    const mode = screen.getByRole('button', { name: /Cách thi/ });

    act(() => {
      fireEvent.click(next);
      fireEvent.click(saveDraft);
      fireEvent.click(mode);
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/admin/mock-exams', expect.objectContaining({ draft_state: { step: 'audience' } }));
    expect(next.hasAttribute('disabled')).toBe(true);
    expect(mode.hasAttribute('disabled')).toBe(true);
    expect(window.location.pathname).toBe('/admin/mock-tests/new');

    await act(async () => { finishCreate({ id: 'e1' }); });
    expect(await screen.findByRole('heading', { name: 'Người thi' })).toBeTruthy();
    expect(window.location.pathname + window.location.search).toBe('/admin/mock-tests/e1/setup?step=audience');
    expect(post).toHaveBeenCalledTimes(1);
    expect(mode.hasAttribute('disabled')).toBe(false);
  });

  it('allows an explicit retry after a failed create releases the save lock', async () => {
    routes({
      '/admin/mock-exams/picker': { items: [], total: 0, limit: 25, offset: 0 },
      '/admin/mock-exams/e1/audience': audience(),
      '/admin/mock-exams': { exams: [exam({ title: 'Kỳ thi thử lại' })] },
    });
    post.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce({ id: 'e1' });
    render(<MockExamSetup examId={null} />);
    fireEvent.change(screen.getByLabelText('Tên kỳ thi'), { target: { value: 'Kỳ thi thử lại' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect(await screen.findByText('Lưu nháp không thành công')).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Lưu lại' }));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/mock-tests/e1/setup'));
    expect(await screen.findByText(/đã lưu lúc/)).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
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

  it('refuses to clear a saved Writing prompt and reload still shows that prompt', async () => {
    routes({
      '/admin/mock-exams/e1/audience': audience(),
      '/admin/mock-exams/picker': { items: [], total: 0, limit: 25, offset: 0 },
      '/admin/mock-exams': { exams: [exam({ skills: ['writing'], writing_task1_prompt_id: 'W1', writing_task2_prompt_id: 'W2' })] },
    });
    render(<MockExamSetup examId="e1" />);
    const prompt = await screen.findByLabelText(/Đề Writing Task 1/) as HTMLSelectElement;
    expect(prompt.value).toBe('W1');
    fireEvent.change(prompt, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect(await screen.findByText(/Không thể bỏ đề Writing Task 1 đã lưu/)).toBeTruthy();
    expect(screen.queryByText(/đã lưu lúc/i)).toBeNull();
    expect(patch).not.toHaveBeenCalled();
    cleanup();
    render(<MockExamSetup examId="e1" />);
    expect((await screen.findByLabelText(/Đề Writing Task 1/) as HTMLSelectElement).value).toBe('W1');
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

  it('review: replacing the rejected paper lets the admin schedule again without reloading', async () => {
    let stored = exam({ skills: ['reading'], reading_test_id: 'R1', starts_at: '2026-11-25T13:00:00Z', draft_state: { step: 'review' } });
    routes({
      '/admin/mock-exams/e1/audience': audience([person()]),
      '/admin/mock-exams/picker': { items: [{ id: 'R2', title: 'Đề thay thế' }], total: 1, limit: 25, offset: 0 },
      '/admin/mock-exams': () => ({ exams: [stored] }),
    });
    patch.mockImplementation(async (_path, body) => { stored = { ...stored, ...body }; return stored; });
    post.mockRejectedValueOnce(Object.assign(new Error('Chưa lên lịch được.'), { status: 422, detail: { code: 'not_ready', missing: ['paper_not_ready'] } }));
    post.mockResolvedValueOnce({ status: 'published', selected: 1 });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=review');
    render(<MockExamSetup examId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lên lịch' }));
    expect(await screen.findByText(/Một đề đã chọn chưa sẵn sàng/)).toBeTruthy();

    const steps = within(screen.getByRole('navigation', { name: 'Các bước tổ chức kỳ thi' }));
    fireEvent.click(steps.getByRole('button', { name: /Kỹ năng và đề/ }));
    await screen.findByRole('option', { name: 'Đề thay thế' });
    fireEvent.change(screen.getByLabelText(/Đề Reading/), { target: { value: 'R2' } });
    fireEvent.click(steps.getByRole('button', { name: /Xem lại/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/mock-exams/e1', expect.objectContaining({ reading_test_id: 'R2' })));
    const scheduleAgain = await screen.findByRole('button', { name: 'Lên lịch' });
    expect(scheduleAgain.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/Một đề đã chọn chưa sẵn sàng/)).toBeNull();
    fireEvent.click(scheduleAgain);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
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

  // CR #2640 (Medium): every selected self-paced row must carry the window.
  const selfPaced = (over: Record<string, unknown> = {}) => exam({
    exam_mode: 'retake', exam_mode_v2: 'self_paced', skills: ['reading'], reading_test_id: 'R1',
    open_until: '2026-11-27T16:59:00Z', ...over,
  });
  const WINDOW = { open_until: '2026-11-27T23:59:00+07:00' };

  it('self-paced: "Cập nhật theo lớp" sends the window, and Lên lịch re-sends it before scheduling', async () => {
    routes({ '/admin/mock-exams/e1/audience': audience([person()]), '/admin/mock-exams': { exams: [selfPaced({ draft_state: { step: 'audience' } })] } });
    patch.mockResolvedValue({ ...audience([person()]), mirror_failed: false });
    post.mockResolvedValue({ ok: true });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=audience');
    render(<MockExamSetup examId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật theo lớp' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/mock-exams/e1/audience', { refresh_cohorts: true, window: WINDOW }));
    patch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Xem lại/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lên lịch' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/mock-exams/e1/schedule', {}));
    expect(patch).toHaveBeenCalledWith('/admin/mock-exams/e1/audience', { window: WINDOW });
    expect(patch.mock.invocationCallOrder.at(-1)!).toBeLessThan(post.mock.invocationCallOrder.at(-1)!);
  });

  it.each([
    ['refused', new Error('không ghi được khoảng mở'), /Chưa cập nhật được khoảng mở cho danh sách người thi: không ghi được khoảng mở/],
    ['not mirrored', null, /Chưa cập nhật được khoảng mở cho danh sách người thi: đã lưu danh sách nhưng chưa ghi được lượt giao/],
  ])('self-paced: a window PATCH that is %s stops Lên lịch', async (_failure, error, notice) => {
    routes({ '/admin/mock-exams/e1/audience': audience([person()]), '/admin/mock-exams': { exams: [selfPaced()] } });
    patch.mockImplementation(async (path: string) => {
      if (path === '/admin/mock-exams/e1') return {};
      if (error) throw error;
      return { ...audience([person()]), mirror_failed: true };
    });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=review');
    render(<MockExamSetup examId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lên lịch' }));
    expect(await screen.findByText(notice)).toBeTruthy();
    expect(patch).toHaveBeenCalledWith('/admin/mock-exams/e1/audience', { window: WINDOW });
    expect(post).not.toHaveBeenCalled();
  });

  it('self-paced: an unread list is not an empty one; the window waits for a read, then goes to every row', async () => {
    let failing = true;
    let stored = selfPaced();
    routes({
      '/admin/mock-exams/e1/audience': () => { if (failing) throw new Error('mất kết nối'); return audience([person()]); },
      '/admin/mock-exams': () => ({ exams: [stored] }),
    });
    patch.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === '/admin/mock-exams/e1') { stored = selfPaced({ open_until: '2026-11-28T16:59:00Z' }); return stored; }
      return { ...audience([person()]), mirror_failed: false, echo: body };
    });
    window.history.replaceState(null, '', '/admin/mock-tests/e1/setup?step=mode');
    render(<MockExamSetup examId="e1" />);
    const until = await screen.findByLabelText('Đến (giờ Việt Nam)');
    fireEvent.change(until, { target: { value: '2026-11-28T23:59' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect(await screen.findByText(/Chưa đọc được danh sách người thi nên chưa đổi khoảng mở/)).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    const next = { window: { open_until: '2026-11-28T23:59:00+07:00' } };
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/mock-exams/e1/audience', next));
    expect(patch).toHaveBeenCalledWith('/admin/mock-exams/e1', expect.objectContaining({ open_until: '2026-11-28T23:59:00+07:00' }));
    expect(patch).not.toHaveBeenCalledWith('/admin/mock-exams/e1/audience', { window: WINDOW });
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
