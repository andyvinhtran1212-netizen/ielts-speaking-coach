// EXAMLISTENP-0069 T002: the exam-room branch of the Listening practice runner.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';
import { createProgrammeLocalCopyStore } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-room-store';
import { localCopyKey, planLocalCopyReplay, readLocalCopy, writeLocalCopy } from '@/lib/exam-room/local-copy.mjs';
import { writerTokenKey } from '@/lib/exam-room/tab-guard.mjs';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-1' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const questions = [
  { q_num: 1, source_item_id: 'item-1', prompt: 'Mai rủ ai?', response_type: 'single_choice', options: { A: 'Cả hai', B: 'Ben' } },
  { q_num: 2, source_item_id: 'item-2', prompt: 'Mai rủ luyện gì?', response_type: 'single_choice', options: { A: 'Viết tên', B: 'Tiếng Anh' } },
];
const guidedItem = { q_num: 1, first_answer: 'A', state: 'checked', correct: true, expected: ['A'], rationale: 'Đúng.', reference_answers: [], required_facts: [], optional_facts: [], self_review_rationale: '', core_info: '', answer_sentence: '' };
const programmeTest = (replay = 'allowed') => ({ scoring_policy: 'report_only', title: 'Bài luyện 1', programme_id: 'general-listening-practice', listening_lesson_id: 'lesson-1', replay_policy: replay, audio_url: '/audio.wav', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions } }] }] });
const copyScope = { surface: 'listening-practice', ownerKey: 'learner-1', attemptKey: 'attempt-1' };

type Api = { postWith: ReturnType<typeof vi.fn>; getWith: ReturnType<typeof vi.fn>; patchWith: ReturnType<typeof vi.fn> };
let api: Api;
let assign: ReturnType<typeof vi.fn>;

let server: { answers: Array<{ q_num: number; user_answer: string }> };

function setup({ answers = [] as Array<{ q_num: number; user_answer: string }>, replay = 'allowed', flag = true } = {}) {
  server = { answers };
  Object.assign(window, { __AVER_RUNTIME_CONFIG__: flag ? { environment: 'production', examRoomSurfaces: ['listening-practice'] } : { environment: 'production', examRoomSurfaces: [] } });
  api = {
    postWith: vi.fn(async (url: string) => {
      if (url.endsWith('/reveal')) return { attempt_id: 'attempt-1', items: [guidedItem] };
      if (url.endsWith('/submit')) return {};
      if (url.endsWith('/playback-started')) return { accepted: true };
      return { attempt_id: 'attempt-1', answers };
    }),
    getWith: vi.fn(async (url: string) => {
      if (url.endsWith('/guided-state')) return { attempt_id: 'attempt-1', items: [] };
      // FR-012: the read under the write lock; `server` is what the database holds now.
      if (url === '/api/listening/tests/attempts/attempt-1') return { attempt_id: 'attempt-1', answers: server.answers };
      return programmeTest(replay);
    }),
    patchWith: vi.fn(async () => ({})),
  };
  Object.assign(window, { api });
}

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  localStorage.clear();
  vi.stubGlobal('crypto', { randomUUID: () => 'playback-claim' });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign, replace: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { __AVER_RUNTIME_CONFIG__?: unknown }).__AVER_RUNTIME_CONFIG__;
});

/** The tab lock is taken right after the room mounts; answers wait for it. */
async function ready() {
  await screen.findByText(questions[0].prompt);
  await waitFor(() => expect(screen.getByRole('radio', { name: /Cả hai/ }).matches(':disabled')).toBe(false));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

const calls = (fn: ReturnType<typeof vi.fn>, suffix: string) => fn.mock.calls.filter(([url]) => String(url).endsWith(suffix));

describe('flag off (FR-001)', () => {
  it('keeps the current runner: native audio controls, own footer, no exam room', async () => {
    setup({ flag: false });
    const { container } = render(<ProgrammeFormRunner testId="t1" />);
    await screen.findByText(questions[0].prompt);
    expect(container.querySelector('[data-exam-room]')).toBeNull();
    expect(container.querySelector('audio[controls]')).toBeTruthy();
    expect(container.querySelector('footer.programme-submit')).toBeTruthy();
    expect(api.postWith.mock.calls[0][3]).toEqual({ signal: expect.any(AbortSignal) });
  });
});

describe('flag on', () => {
  it('renders the exam room with the same requests, and every call passes noRedirect (FR-001, FR-010, FR-014)', async () => {
    setup();
    const { container } = render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    const room = container.querySelector('[data-exam-room]');
    expect(room?.getAttribute('data-surface')).toBe('listening-practice');
    expect(container.querySelector('audio[controls]')).toBeNull();
    expect(container.querySelector('footer.programme-submit')).toBeNull();
    expect(api.postWith.mock.calls[0][0]).toBe('/api/listening/tests/t1/attempts?standalone=true');
    // FR-001: taking the lock right after opening sends no second resume request.
    expect(calls(api.postWith, '/attempts?standalone=true')).toHaveLength(1);
    for (const [, , , opts] of [...api.postWith.mock.calls, ...api.getWith.mock.calls.map(([u, h, o]) => [u, undefined, h, o])]) {
      expect(opts).toMatchObject({ noRedirect: true });
    }
    fireEvent.click(screen.getByRole('radio', { name: /Cả hai/ }));
    await waitFor(() => expect(api.patchWith).toHaveBeenCalled());
    expect(api.patchWith.mock.calls[0][3]).toMatchObject({ noRedirect: true });
  });

  it('submit box lists blank questions; Esc sends nothing; confirm runs the existing submit once (FR-002, FR-004)', async () => {
    setup();
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Cả hai/ }));
    await waitFor(() => expect(api.patchWith).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Hoàn thành và xem lại' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành và xem lại' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Nộp bài khi còn 1 câu chưa trả lời?')).toBeTruthy();
    expect(within(dialog).getByText(/Câu 2/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quay lại làm tiếp' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls(api.postWith, '/submit')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành và xem lại' }));
    const again = await screen.findByRole('alertdialog');
    const confirm = within(again).getByRole('button', { name: 'Hoàn thành và xem lại' });
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(() => expect(calls(api.postWith, '/submit')).toHaveLength(1));
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('FR-002: Esc closes the box without submitting and focus returns to the submit button', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }, { q_num: 2, user_answer: 'B' }] });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    const open = screen.getByRole('button', { name: 'Hoàn thành và xem lại' });
    open.focus();
    fireEvent.click(open);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Nộp bài?')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls(api.postWith, '/submit')).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hoàn thành và xem lại' })));
  });

  it('a failed submit keeps the box open and does not navigate (FR-004)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }, { q_num: 2, user_answer: 'B' }] });
    api.postWith.mockImplementation(async (url: string) => {
      if (url.endsWith('/submit')) throw Object.assign(new Error('boom'), { status: 500 });
      return { attempt_id: 'attempt-1', answers: [{ q_num: 1, user_answer: 'A' }, { q_num: 2, user_answer: 'B' }] };
    });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành và xem lại' }));
    const dialog = await screen.findByRole('alertdialog');
    // FR-002: with nothing blank, the shell's plain title and stay button.
    expect(within(dialog).getByText('Nộp bài?')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Quay lại làm tiếp' })).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Hoàn thành và xem lại' });
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toBeTruthy());
    expect(assign).not.toHaveBeenCalled();
  });

  it('a confirm during a check waits for it instead of being swallowed (FR-003)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }, { q_num: 2, user_answer: 'B' }] });
    let finishReveal!: () => void;
    api.getWith.mockImplementation(async (url: string) => (url.endsWith('/guided-state') ? { attempt_id: 'attempt-1', items: [] } : programmeTest()));
    api.postWith.mockImplementation(async (url: string) => {
      if (url.endsWith('/reveal')) { await new Promise<void>((resolve) => { finishReveal = resolve; }); return { attempt_id: 'attempt-1', items: [guidedItem] }; }
      if (url.endsWith('/submit')) return {};
      return { attempt_id: 'attempt-1', answers: [{ q_num: 1, user_answer: 'A' }, { q_num: 2, user_answer: 'B' }] };
    });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: 'Đối chiếu câu này' })[0]);
    await waitFor(() => expect(calls(api.postWith, '/reveal')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành và xem lại' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Đang đối chiếu, chờ một chút/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Hoàn thành và xem lại' });
    await act(async () => { fireEvent.click(confirm); });
    expect(calls(api.postWith, '/submit')).toHaveLength(0);
    await act(async () => { finishReveal(); });
    await waitFor(() => expect(calls(api.postWith, '/submit')).toHaveLength(1));
  });

  it('Scenario 7: a legacy answer that differs is asked about, with no PATCH before the choice (FR-009)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }] });
    localStorage.setItem('listening-programme-draft:attempt-1', JSON.stringify({ 1: 'B', 2: '' }));
    render(<ProgrammeFormRunner testId="t1" />);
    await screen.findByText(/Câu 1: trên máy này là “B”, đã lưu là “A”/);
    await ready();
    expect(api.patchWith).not.toHaveBeenCalled();
    expect(localStorage.getItem('listening-programme-draft:attempt-1')).toBeNull();
    const copy = readLocalCopy(localStorage, copyScope);
    expect(Object.prototype.hasOwnProperty.call(copy?.answers['1'] ?? {}, 'baseValue')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng câu trên máy này' }));
    await waitFor(() => expect(api.patchWith).toHaveBeenCalled());
    expect(api.patchWith.mock.calls[0].slice(0, 2)).toEqual(['/api/listening/tests/attempts/attempt-1/answers', { q_num: 1, user_answer: 'B' }]);
    await waitFor(() => expect(readLocalCopy(localStorage, copyScope)).toBeNull());
  });

  it('"Keep saved" drops the device value and sends nothing (FR-009)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }] });
    localStorage.setItem('listening-programme-draft:attempt-1', JSON.stringify({ 1: 'B' }));
    render(<ProgrammeFormRunner testId="t1" />);
    await screen.findByText(/Câu 1: trên máy này là “B”/);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Giữ câu đã lưu' }));
    expect(screen.queryByText(/trên máy này là/)).toBeNull();
    expect(api.patchWith).not.toHaveBeenCalled();
    expect(readLocalCopy(localStorage, copyScope)).toBeNull();
    expect((screen.getByRole('radio', { name: /Cả hai/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('replay re-sends a copy only while the server still holds its base, and keeps a newer server value (FR-009)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }, { q_num: 2, user_answer: 'B' }] });
    writeLocalCopy(localStorage, { ...copyScope, expiresAt: Date.now() + 60_000, answers: { 1: { value: 'B', baseValue: 'A' }, 2: { value: 'A', baseValue: null } } });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    await waitFor(() => expect(api.patchWith).toHaveBeenCalledTimes(1));
    expect(api.patchWith.mock.calls[0][1]).toEqual({ q_num: 1, user_answer: 'B' });
    await waitFor(() => expect(readLocalCopy(localStorage, copyScope)).toBeNull());
  });

  it('a read-only tab sends no PATCH for its copy while another tab writes (FR-012)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }] });
    localStorage.setItem(writerTokenKey('listening-practice', 'attempt-1'), JSON.stringify({ tabId: 'other-tab', at: Date.now() }));
    writeLocalCopy(localStorage, { ...copyScope, expiresAt: Date.now() + 60_000, answers: { 1: { value: 'B', baseValue: 'A' } } });
    render(<ProgrammeFormRunner testId="t1" />);
    await screen.findByText('Bài này đang mở ở tab khác.');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(api.patchWith).not.toHaveBeenCalled();
    expect(readLocalCopy(localStorage, copyScope)).not.toBeNull();
  });

  it('taking the write right over re-reads the server and re-sends what the other tab kept only on this device (FR-012)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }] });
    const token = writerTokenKey('listening-practice', 'attempt-1');
    localStorage.setItem(token, JSON.stringify({ tabId: 'other-tab', at: Date.now() }));
    render(<ProgrammeFormRunner testId="t1" />);
    await screen.findByText('Bài này đang mở ở tab khác.');
    const opens = calls(api.postWith, '/attempts?standalone=true').length;
    // The writing tab secured "B" for question 1 in the local copy (its PATCH failed), then let go.
    writeLocalCopy(localStorage, { ...copyScope, expiresAt: Date.now() + 60_000, answers: { 1: { value: 'B', baseValue: 'A' } } });
    localStorage.removeItem(token);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng tab này' }));
    await waitFor(() => expect(api.patchWith).toHaveBeenCalledTimes(1));
    expect(api.patchWith.mock.calls[0][1]).toEqual({ q_num: 1, user_answer: 'B' });
    // The re-read is a plain read: the page still admits exactly once (FR-001).
    expect(calls(api.postWith, '/attempts?standalone=true').length).toBe(opens);
    expect(calls(api.getWith, '/api/listening/tests/attempts/attempt-1').length).toBeGreaterThan(0);
    await waitFor(() => expect((screen.getByRole('radio', { name: /Ben/ }) as HTMLInputElement).checked).toBe(true));
  });

  it('the first grant after opening reads the server again: an answer saved by a tab that closed after this page loaded is shown, not overwritten (CR #2558)', async () => {
    // This page's own open read nothing for question 1; before it took the lock the
    // other tab saved "B" and closed.
    setup({ answers: [] });
    server.answers = [{ q_num: 1, user_answer: 'B' }];
    render(<ProgrammeFormRunner testId="t1" />);
    await waitFor(() => expect((screen.getByRole('radio', { name: /Ben/ }) as HTMLInputElement).checked).toBe(true));
    expect(calls(api.getWith, '/api/listening/tests/attempts/attempt-1')).toHaveLength(1);
    expect(calls(api.postWith, '/attempts?standalone=true')).toHaveLength(1);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Hoàn thành và xem lại' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành và xem lại' }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Hoàn thành và xem lại' })); });
    await waitFor(() => expect(calls(api.postWith, '/submit')).toHaveLength(1));
    // Nothing stale was written over the other tab's saved answer: the final flush
    // sends what the server now holds.
    for (const [, body] of api.patchWith.mock.calls) expect(body).toEqual({ q_num: 1, user_answer: 'B' });
  });

  it('another account signing in removes the previous copies without reading them (FR-009)', async () => {
    setup();
    const other = { ...copyScope, ownerKey: 'someone-else' };
    writeLocalCopy(localStorage, { ...other, expiresAt: Date.now() + 60_000, answers: { 1: { value: 'X', baseValue: null } } });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    expect(localStorage.getItem(localCopyKey(other))).toBeNull();
  });

  it('a 401 on save never redirects and opens the sign-in-again dialog (FR-010)', async () => {
    setup();
    api.patchWith.mockRejectedValue(Object.assign(new Error('401'), { status: 401 }));
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Cả hai/ }));
    await screen.findByText('Phiên đăng nhập đã hết hạn');
    expect((window.location.replace as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(readLocalCopy(localStorage, copyScope)?.answers['1']?.value).toBe('A');
  });

  it('save status shows the time of the last confirmed save (FR-005)', async () => {
    setup();
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Cả hai/ }));
    await screen.findByText(/Đã lưu lúc \d{2}:\d{2}/);
  });

  it('a question cell switches to guided mode on that group (FR-006)', async () => {
    setup();
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    const nav = screen.getByRole('navigation', { name: 'Danh sách câu' });
    fireEvent.click(within(nav).getByRole('button', { name: /Phần 2/ }));
    await waitFor(() => expect(screen.queryByText(questions[0].prompt)).toBeNull());
    expect(screen.getByText(questions[1].prompt)).toBeTruthy();
  });

  it('a once track has no pause control and reports its start (FR-008)', async () => {
    setup({ replay: 'once' });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    expect(screen.queryByRole('button', { name: /Tạm dừng/ })).toBeNull();
    const play = screen.getAllByRole('button').find((b) => /Bắt đầu nghe|Nghe/.test(b.getAttribute('aria-label') || b.textContent || ''));
    expect(play).toBeTruthy();
    await act(async () => { fireEvent.click(play!); });
    await waitFor(() => expect(calls(api.postWith, '/playback-started')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Tạm dừng|Pause/ })).toBeNull();
  });

  it('retrying a once track after an error resumes where it stopped, not from 0 (Codex P2 #2592)', async () => {
    setup({ replay: 'once' });
    const { container } = render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    const media = container.querySelector('audio') as HTMLAudioElement;
    let position = 0;
    Object.defineProperty(media, 'currentTime', { configurable: true, get: () => position, set: (v: number) => { position = v; } });
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(() => { position = 0; });
    const play = screen.getAllByRole('button').find((b) => /Bắt đầu nghe|Nghe/.test(b.getAttribute('aria-label') || b.textContent || ''));
    await act(async () => { fireEvent.click(play!); });
    await waitFor(() => expect(calls(api.postWith, '/playback-started')).toHaveLength(1));
    position = 42;
    await act(async () => { fireEvent(media, new Event('timeupdate')); fireEvent(media, new Event('error')); });
    const retry = await screen.findByRole('button', { name: 'Tải lại bài nghe' });
    await act(async () => { fireEvent.click(retry); });
    expect(position).toBe(0);
    await act(async () => { fireEvent(media, new Event('loadedmetadata')); });
    expect(position).toBe(42);
  });

  it('leaving sends no PATCH for answers the server already acked', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }] });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(api.patchWith).not.toHaveBeenCalled();
  });

  it('leaving waits for the PATCHes in flight before deciding what is unacked: a value changed back is still sent (CR #2558)', async () => {
    const written = { q_num: 3, source_item_id: 'item-3', prompt: 'Mai viết gì?', response_type: 'short_answer', options: {} };
    setup({ answers: [{ q_num: 3, user_answer: 'A' }] });
    api.getWith.mockImplementation(async (url: string) => {
      if (url.endsWith('/guided-state')) return { attempt_id: 'attempt-1', items: [] };
      if (url === '/api/listening/tests/attempts/attempt-1') return { attempt_id: 'attempt-1', answers: server.answers };
      return { ...programmeTest(), sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: [...questions, written] } }] }] };
    });
    let landB: () => void = () => {};
    api.patchWith.mockImplementation(async (_url: string, body: { user_answer: string }) => {
      if (body.user_answer === 'B') await new Promise<void>((resolve) => { landB = resolve; });
      return {};
    });
    render(<ProgrammeFormRunner testId="t1" />);
    await ready();
    const box = screen.getByPlaceholderText('Nhập câu trả lời của bạn');
    fireEvent.change(box, { target: { value: 'B' } });
    fireEvent.blur(box, { target: { value: 'B' } });
    await waitFor(() => expect(api.patchWith).toHaveBeenCalledTimes(1));
    // Changed back to the saved value while "B" is still on its way (its debounce is pending).
    fireEvent.change(box, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    await act(async () => { landB(); });
    await waitFor(() => expect(api.patchWith).toHaveBeenCalledTimes(2));
    expect(api.patchWith.mock.calls[1][1]).toEqual({ q_num: 3, user_answer: 'A' });
  });

  it('80-day page: switching to another Part and back reads the server again before writing (CR #2518 P1)', async () => {
    setup({ answers: [{ q_num: 1, user_answer: 'A' }] });
    const { rerender } = render(<ProgrammeFormRunner testId="t1" embedded active />);
    await ready();
    await waitFor(() => expect(calls(api.getWith, '/api/listening/tests/attempts/attempt-1')).toHaveLength(1));
    rerender(<ProgrammeFormRunner testId="t1" embedded active={false} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    // Another tab opened this Part meanwhile, saved "B" and closed.
    server.answers = [{ q_num: 1, user_answer: 'B' }];
    rerender(<ProgrammeFormRunner testId="t1" embedded active />);
    await waitFor(() => expect(calls(api.getWith, '/api/listening/tests/attempts/attempt-1')).toHaveLength(2));
    await waitFor(() => expect((screen.getByRole('radio', { name: /Ben/ }) as HTMLInputElement).checked).toBe(true));
    expect(calls(api.postWith, '/attempts?standalone=true')).toHaveLength(1);
    expect(api.patchWith).not.toHaveBeenCalled();
  });

  it('an inactive runner offers no submit (FR-011)', async () => {
    setup();
    render(<ProgrammeFormRunner testId="t1" active={false} />);
    await screen.findByText(questions[0].prompt);
    expect(screen.queryByRole('button', { name: 'Hoàn thành và xem lại' })).toBeNull();
  });

  it('the 80-day lesson page (embedded) uses the room without a second top bar (FR-011)', async () => {
    setup();
    const { container } = render(<ProgrammeFormRunner testId="t1" embedded />);
    await ready();
    expect(container.querySelector('[data-exam-room]')).toBeTruthy();
    expect(container.querySelector('[data-exam-room-bare]')).toBeTruthy();
    expect(container.querySelector('footer.programme-submit')).toBeNull();
    expect(screen.queryByRole('button', { name: /Thoát/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Cả hai/ }));
    await waitFor(() => expect(api.patchWith).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Hoàn thành và xem lại' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành và xem lại' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('on the 80-day page only the active part offers submit (FR-011)', async () => {
    setup();
    render(<><ProgrammeFormRunner testId="t1" embedded /><ProgrammeFormRunner testId="t2" embedded active={false} /></>);
    await waitFor(() => expect(screen.getAllByText(questions[0].prompt)).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'Hoàn thành và xem lại' })).toHaveLength(1);
  });

  it('flag off: the 80-day page keeps the current runner', async () => {
    setup({ flag: false });
    const { container } = render(<ProgrammeFormRunner testId="t1" embedded />);
    await screen.findByText(questions[0].prompt);
    expect(container.querySelector('[data-exam-room]')).toBeNull();
    expect(container.querySelector('footer.programme-submit')).toBeTruthy();
  });
});

describe('createProgrammeLocalCopyStore', () => {
  it('writes each answer with the acked base, and clears only the acked value', () => {
    const base: Record<number, string | null> = { 1: 'A' };
    const store = createProgrammeLocalCopyStore(localStorage, { ownerKey: 'learner-1', attemptId: 'attempt-1', baseFor: (q) => (q in base ? base[q] : null) });
    store.remember(1, 'B');
    store.remember(2, 'C');
    expect(readLocalCopy(localStorage, copyScope)?.answers).toMatchObject({ 1: { value: 'B', baseValue: 'A' }, 2: { value: 'C', baseValue: null } });
    store.clearIfCurrent(1, 'old');
    expect(store.load()).toEqual({ 1: 'B', 2: 'C' });
    store.clearIfCurrent(1, 'B');
    expect(store.load()).toEqual({ 2: 'C' });
    expect(store.secure({ 2: 'C', 3: 'D' })).toBe(true);
    store.clear();
    expect(store.load()).toEqual({});
  });

  it('an ack of an earlier save moves the base of the newer answer still waiting, so a replay re-sends it (Codex P1 #2592)', () => {
    const base: Record<number, string | null> = { 1: 'X' };
    const store = createProgrammeLocalCopyStore(localStorage, { ownerKey: 'learner-1', attemptId: 'attempt-1', baseFor: (q) => (q in base ? base[q] : null) });
    store.remember(1, 'A');   // PATCH "A" goes out
    store.remember(1, 'B');   // typed again while "A" is in flight
    store.clearIfCurrent(1, 'A');   // "A" acked; "B" (its PATCH then fails) stays
    expect(readLocalCopy(localStorage, copyScope)?.answers[1]).toMatchObject({ value: 'B', baseValue: 'A' });
    const plan = planLocalCopyReplay(readLocalCopy(localStorage, copyScope), { open: true, answers: { 1: { value: 'A' } } });
    expect(plan.resend).toEqual([{ q: '1', value: 'B' }]);
  });
});
