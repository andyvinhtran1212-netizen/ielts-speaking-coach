import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExerciseBookAssignments } from '@/components/exercise-book/exercise-book-assignments';
import { ExerciseBookLearnerEntry } from '@/components/exercise-book/exercise-book-entry';
import { ExerciseBookReview, LearnerReview } from '@/components/exercise-book/exercise-book-review';
import { ExerciseBookRunner } from '@/components/exercise-book/exercise-book-runner';
import { ExerciseBookApiProvider } from '@/lib/exercise-book/api-context';
import { createExerciseBookApi } from '@/lib/exercise-book/client';
import { ExerciseBookError, type ActivityReview, type ExerciseBookApi } from '@/lib/exercise-book/contract';
import { toExerciseBookError } from '@/lib/exercise-book/http-api';
import { learnerBinding } from '@/lib/exercise-book/model';
import { MOCK_ERROR_NAMES, MOCK_IDS, createMockExerciseBookApi, mockError, type MockOptions } from '@/lib/exercise-book/mock-api';
import errorsFixture from '@/tests/fixtures/exercise-book/errors.json';
import reviewTextFixture from '@/tests/fixtures/exercise-book/review-text.json';
import reviewKeepChangeFixture from '@/tests/fixtures/exercise-book/review-keep-change.json';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: '00000000-0000-4000-8000-000000000011' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));

const SENTINEL = 'SENTINEL_ANSWER_SET';
const TEXT_TEST = '00000000-0000-4000-8000-000000000031'; // U1-A01, no in-progress attempt
const RESUME_TEST = '00000000-0000-4000-8000-000000000032'; // U1-A02, seeded in-progress attempt
const KEEP_CHANGE_TEST = '00000000-0000-4000-8000-000000000033'; // U1-A03
const ITEM = MOCK_IDS.learner_item;

function spyApi(options: MockOptions = {}, override: Partial<ExerciseBookApi> = {}) {
  const base = createMockExerciseBookApi({ now: () => new Date('2026-11-12T09:00:00+07:00'), ...options });
  const api = Object.fromEntries(Object.entries(base).map(([key, fn]) => [key, vi.fn(fn as never)])) as unknown as Record<keyof ExerciseBookApi, ReturnType<typeof vi.fn>>;
  Object.assign(api, override);
  return { api: api as unknown as ExerciseBookApi & typeof api, base };
}

function renderWith(api: ExerciseBookApi, ui: React.ReactElement) {
  return render(<ExerciseBookApiProvider api={api}>{ui}</ExerciseBookApiProvider>);
}

beforeEach(() => {
  auth.status = 'signed-in';
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('contract errors', () => {
  it('maps every fixed error body of §0 (v1.3.1) to its code without keeping the server text', () => {
    type Fixture = { status: number; body: { detail: unknown; code?: string; reason?: string }; client_code?: string };
    const fixtures = errorsFixture as unknown as Record<string, Fixture>;
    for (const name of MOCK_ERROR_NAMES) {
      const fixture = fixtures[name];
      const error = mockError(name);
      expect(error).toBeInstanceOf(ExerciseBookError);
      expect(error.status).toBe(fixture.status);
      expect(error.code).toBe(fixture.client_code || name);
      expect(error.reason).toBe(fixture.body.reason ?? null);
      const detail = typeof fixture.body.detail === 'string' ? fixture.body.detail : JSON.stringify(fixture.body.detail);
      expect(error.message).not.toContain(detail);
    }
    // Every code of the §0 set appears at the TOP level of some body; detail is a string except uuid_parsing.
    const codes = new Set(Object.values(fixtures).filter((entry) => typeof entry === 'object').map((entry) => entry.body.code).filter(Boolean));
    for (const code of ['unauthorized', 'not_granted', 'not_owner', 'step_up_required', 'mfa_required', 'not_found', 'stale_revision',
      'idempotency_conflict', 'attempt_changed', 'already_archived', 'grant_state_unchanged', 'activity_locked', 'validation', 'past_due', 'unavailable']) {
      expect(codes.has(code)).toBe(true);
    }
    expect(fixtures.step_up_required.body).toMatchObject({ code: 'step_up_required', max_age_seconds: 600 });
    expect(fixtures.step_up_cooloff.body).toMatchObject({ code: 'step_up_required', reason: 'new_factor_cooloff' });
    expect(fixtures.uuid_parsing.body).not.toHaveProperty('code');
    // api.js rejection shapes: top-level code (v1.3.1), an older object detail, and no code at all.
    expect(toExerciseBookError({ status: 403, detail: 'Cần xác thực lại.', code: 'step_up_required', reason: null }).code).toBe('step_up_required');
    expect(toExerciseBookError({ status: 403, detail: { code: 'step_up_required', message: 'x' } }).code).toBe('step_up_required');
    expect(toExerciseBookError({ status: 403, detail: 'x', code: null }).code).toBe('forbidden');
    expect(toExerciseBookError({ status: 403, detail: 'x', code: 'not_a_contract_code' }).code).toBe('forbidden');
    expect(toExerciseBookError({ status: 502, detail: 'x', code: null }).code).toBe('unavailable');
    expect(toExerciseBookError(new TypeError('Failed to fetch')).code).toBe('network');
  });

  it('deployed builds bind no backend yet: every call is the contract 503', async () => {
    const api = createExerciseBookApi();
    await expect(api.listMyAssignments()).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    await expect(api.getGrants('x')).rejects.toMatchObject({ status: 503, code: 'unavailable' });
  });
});

describe('development mock (contract rules E relies on)', () => {
  const NOW = () => new Date('2026-11-12T09:00:00+07:00');
  const keepChange = (action: 'KEEP' | 'CHANGE' | null, correction = '') =>
    JSON.stringify({ version: 'blackeye_keep_change_v1', action, correction_text: correction });

  async function start(api: ExerciseBookApi, testId: string) {
    return api.startAttempt(testId, ITEM, learnerBinding((await api.getPlayer(testId, ITEM)).activity.binding));
  }

  it('unfinished KEEP/CHANGE cells are blank on submit and in review (Codex r4535896619)', async () => {
    const api = createMockExerciseBookApi({ now: NOW });
    const attempt = await start(api, KEEP_CHANGE_TEST);
    // CHANGE without a correction, and an action chosen then cleared: both still blank.
    await api.saveAnswer(attempt.attempt_id, { q_num: 1, user_answer: keepChange('CHANGE'), client_seq: 1 });
    await api.saveAnswer(attempt.attempt_id, { q_num: 2, user_answer: keepChange(null), client_seq: 2 });
    const expected_answers = [
      { q_num: 1, source_item_id: 'A03-c1', user_answer: keepChange('CHANGE') },
      { q_num: 2, source_item_id: 'A03-c2', user_answer: keepChange(null) },
    ];
    await expect(api.submitAttempt(attempt.attempt_id, { expected_answers, confirm_blank: false })).rejects.toMatchObject({ code: 'validation' });
    const submitted = await api.submitAttempt(attempt.attempt_id, { expected_answers, confirm_blank: true });
    expect(submitted.result_summary?.blank_count).toBe(2);
    const review = await api.getReview(attempt.attempt_id);
    expect(review.items.map((item) => item.blank)).toEqual([true, true]);
  });

  it('a save with an older client_seq is not applied and the ACK reports the stored seq (8.6)', async () => {
    const api = createMockExerciseBookApi({ now: NOW });
    const attemptId = '00000000-0000-4000-8000-000000000062';
    await api.saveAnswer(attemptId, { q_num: 1, user_answer: 'newer', client_seq: 20 });
    const stale = await api.saveAnswer(attemptId, { q_num: 1, user_answer: 'older', client_seq: 19 });
    expect(stale.client_seq).toBe(20);
    expect((await api.getAttempt(attemptId)).answers.find((answer) => answer.q_num === 1)?.user_answer).toBe('newer');
  });

  it('with storage, state survives a new document (start → save → submit → review → reload; Codex r4535785107)', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    const page1 = createMockExerciseBookApi({ now: NOW, storage });
    const attempt = await start(page1, TEXT_TEST);
    await page1.saveAnswer(attempt.attempt_id, { q_num: 1, user_answer: 'Monday', client_seq: 1 });
    const reload = createMockExerciseBookApi({ now: NOW, storage });
    expect((await reload.getInProgress(TEXT_TEST, ITEM)).attempt?.answers).toEqual([expect.objectContaining({ q_num: 1, user_answer: 'Monday' })]);
    const player = await reload.getPlayer(TEXT_TEST, ITEM);
    const expected_answers = player.activity.items.map((item) => ({ q_num: item.q_num, source_item_id: item.source_item_id, user_answer: item.q_num === 1 ? 'Monday' : '' }));
    await reload.submitAttempt(attempt.attempt_id, { expected_answers, confirm_blank: true });
    const reviewPage = createMockExerciseBookApi({ now: NOW, storage });
    expect((await reviewPage.getReview(attempt.attempt_id)).attempt.status).toBe('submitted');
    // Without storage every instance is isolated (tests).
    await expect(createMockExerciseBookApi({ now: NOW }).getReview(attempt.attempt_id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('runner', () => {
  it('resumes the in-progress attempt and never starts one on mount (CR F11)', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    expect(await screen.findByDisplayValue('Monday')).toBeTruthy();
    expect(api.getInProgress).toHaveBeenCalledWith(RESUME_TEST, ITEM);
    expect(api.startAttempt).not.toHaveBeenCalled();
  });

  it('starts only when the learner presses Start', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={TEXT_TEST} classItem={ITEM} />);
    const start = await screen.findByRole('button', { name: 'Bắt đầu làm bài' });
    expect(api.startAttempt).not.toHaveBeenCalled();
    fireEvent.click(start);
    expect(await screen.findByRole('button', { name: 'Nộp bài' })).toBeTruthy();
    expect(api.startAttempt).toHaveBeenCalledTimes(1);
    // The fixture player leaks answer_set_revision; start echoes only the 7 learner fields.
    expect(Object.keys(api.startAttempt.mock.calls[0][2]).sort()).toEqual(
      ['activity_id', 'collection_id', 'content_revision', 'policy_revision', 'programme_id', 'source_contract', 'unit_id']);
  });

  it('labels cells with the source number and table context (QA G13)', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    expect(await screen.findByText('Câu 01 · table · r1 · c2', { selector: 'legend' })).toBeTruthy();
  });

  it('coalesces typing into one save per cell (QA G17)', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    const box = await screen.findByDisplayValue('Monday');
    for (const value of ['T', 'Tu', 'Tue', 'Tuesday']) fireEvent.change(box, { target: { value } });
    await screen.findByText('Đã lưu', {}, { timeout: 2000 });
    expect(api.saveAnswer).toHaveBeenCalledTimes(1);
    expect(api.saveAnswer.mock.calls[0][1]).toMatchObject({ q_num: 1, user_answer: 'Tuesday' });
  });

  it('matches ACKs by client_seq, so an older ACK never clears a newer edit (CR F01)', async () => {
    let call = 0;
    let releaseFirst: () => void = () => {};
    const { api, base } = spyApi();
    // KEEP → CHANGE → KEEP while the first save is in flight. The first ACK carries the
    // same value as the latest edit but an older seq; the save of the latest edit fails.
    api.saveAnswer.mockImplementation(async (attemptId: string, body: never) => {
      call += 1;
      if (call === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return base.saveAnswer(attemptId, body);
      }
      if (call === 2) throw new ExerciseBookError(0, 'network');
      return base.saveAnswer(attemptId, body);
    });
    renderWith(api, <ExerciseBookRunner testId={KEEP_CHANGE_TEST} classItem={ITEM} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu làm bài' }));
    const [select] = await screen.findAllByRole('combobox');
    fireEvent.change(select, { target: { value: 'KEEP' } });
    await waitFor(() => expect(api.saveAnswer).toHaveBeenCalledTimes(1));
    fireEvent.change(select, { target: { value: 'CHANGE' } });
    fireEvent.change(select, { target: { value: 'KEEP' } });
    await act(async () => { releaseFirst(); });
    expect(await screen.findByText(/^Chưa lưu\./)).toBeTruthy();
    const [first, second] = api.saveAnswer.mock.calls.map(([, body]) => body);
    expect(first.user_answer).toBe(second.user_answer);
    expect(second.client_seq).toBeGreaterThan(first.client_seq);

    // Retry sends the LATEST value with a new seq; only then is the cell clean.
    fireEvent.click(screen.getByRole('button', { name: 'Thử lưu lại' }));
    await screen.findByText('Đã lưu');
    const last = api.saveAnswer.mock.calls.at(-1)![1];
    expect(JSON.parse(last.user_answer)).toEqual({ version: 'blackeye_keep_change_v1', action: 'KEEP', correction_text: '' });
    expect(last.client_seq).toBeGreaterThan(second.client_seq);
  });

  it('refuses to submit while a save failed and the retry also fails', async () => {
    const { api } = spyApi({ fail: (method) => (method === 'saveAnswer' ? 'unavailable' : undefined) });
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    const box = await screen.findByDisplayValue('Monday');
    fireEvent.change(box, { target: { value: 'Friday' } });
    await screen.findByText(/^Chưa lưu\./, {}, { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nộp với ô trống' }));
    expect(await screen.findByText(/Còn câu trả lời chưa lưu được nên chưa nộp/)).toBeTruthy();
    expect(api.submitAttempt).not.toHaveBeenCalled();
  });

  it('unmount inside the debounce still saves the latest answer, and reopening shows it (CR P2-1)', async () => {
    const { api } = spyApi();
    const view = renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    fireEvent.change(await screen.findByDisplayValue('Monday'), { target: { value: 'Thursday' } });
    expect(api.saveAnswer).not.toHaveBeenCalled();
    view.unmount();
    expect(api.saveAnswer).toHaveBeenCalledTimes(1);
    const [, body, options] = api.saveAnswer.mock.calls[0];
    expect(body).toMatchObject({ q_num: 1, user_answer: 'Thursday' });
    expect(options).toEqual({ keepalive: true });
    await act(async () => { await api.saveAnswer.mock.results[0].value; });
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    expect(await screen.findByDisplayValue('Thursday')).toBeTruthy();
  });

  it('pagehide sends pending and failed cells at once with keepalive and a newer client_seq (CR P2-1)', async () => {
    let failing = true;
    const { api, base } = spyApi();
    api.saveAnswer.mockImplementation(async (attemptId: string, body: never, options: never) => {
      if (failing) throw new ExerciseBookError(503, 'unavailable');
      return base.saveAnswer(attemptId, body, options);
    });
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    const [first, second] = await screen.findAllByRole('textbox');
    fireEvent.change(first, { target: { value: 'Friday' } });
    await screen.findByText(/^Chưa lưu\./, {}, { timeout: 2000 });
    fireEvent.change(second, { target: { value: 'nine' } });
    failing = false;
    const before = api.saveAnswer.mock.calls.length;
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    const sent = api.saveAnswer.mock.calls.slice(before);
    // Synchronous: the keepalive requests exist before the handler returns.
    expect(sent.map(([, body, options]) => [body.q_num, body.user_answer, options]).sort((left, right) => left[0] - right[0])).toEqual([
      [1, 'Friday', { keepalive: true }],
      [2, 'nine', { keepalive: true }],
    ]);
    const failedSeq = api.saveAnswer.mock.calls[0][1].client_seq;
    expect(sent.find(([, body]) => body.q_num === 1)![1].client_seq).toBeGreaterThan(failedSeq);
    expect(await screen.findByText('Đã lưu')).toBeTruthy();
  });

  it('a hidden tab drains the normal save queue without waiting for the debounce', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    fireEvent.change(await screen.findByDisplayValue('Monday'), { target: { value: 'Saturday' } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await waitFor(() => expect(api.saveAnswer).toHaveBeenCalledTimes(1));
      expect(api.saveAnswer.mock.calls[0][2]).toBeUndefined();
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    expect(await screen.findByText('Đã lưu')).toBeTruthy();
  });

  it('warns before leaving while an answer is unsaved or failed, and not once saved (CR P2-1)', async () => {
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const { api } = spyApi({ fail: (method) => (method === 'saveAnswer' ? 'unavailable' : undefined) });
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    await screen.findByDisplayValue('Monday');
    expect(leave()).toBe(false);
    fireEvent.change(screen.getByDisplayValue('Monday'), { target: { value: 'Sunday' } });
    expect(leave()).toBe(true);
    await screen.findByText(/^Chưa lưu\./, {}, { timeout: 2000 });
    expect(leave()).toBe(true);
    cleanup();
    const ok = spyApi();
    renderWith(ok.api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    fireEvent.change(await screen.findByDisplayValue('Monday'), { target: { value: 'Sunday' } });
    await screen.findByText('Đã lưu', {}, { timeout: 2000 });
    expect(leave()).toBe(false);
  });

  it('confirms blanks, submits the latest answers and opens the review', async () => {
    const navigate = vi.fn();
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} navigate={navigate} />);
    await screen.findByDisplayValue('Monday');
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Các câu còn trống: 02, 03/)).toBeTruthy();
    expect(api.submitAttempt).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nộp với ô trống' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/listening/exercise-book/attempts/${encodeURIComponent('00000000-0000-4000-8000-000000000062')}/review`));
    const body = api.submitAttempt.mock.calls[0][1];
    expect(body.confirm_blank).toBe(true);
    expect(body.expected_answers.map((answer: { user_answer: string }) => answer.user_answer)).toEqual(['Monday', '', '']);
  });

  it('resolves a lost submit ACK from the canonical attempt', async () => {
    const navigate = vi.fn();
    const { api, base } = spyApi();
    api.submitAttempt.mockImplementation(async (id: string, body: never) => {
      await base.submitAttempt(id, body);
      throw new ExerciseBookError(0, 'network');
    });
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} navigate={navigate} />);
    await screen.findByDisplayValue('Monday');
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nộp với ô trống' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(api.getAttempt).toHaveBeenCalled();
  });

  it('past_due freezes the form with the contract message (SA F13)', async () => {
    const { api } = spyApi({ fail: (method) => (method === 'saveAnswer' ? 'past_due' : undefined) });
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    fireEvent.change(await screen.findByDisplayValue('Monday'), { target: { value: 'Sunday' } });
    expect((await screen.findByRole('alert', {}, { timeout: 2000 })).textContent).toMatch(/Bài đã quá hạn nộp/);
    expect((screen.getByRole('button', { name: 'Nộp bài' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Thử lưu lại' })).toBeNull();
  });

  it.each([
    ['activity_locked', /Activity chưa mở/],
    ['unavailable', /chưa sẵn sàng trên hệ thống/],
    ['not_found', /Không tìm thấy mục này/],
  ] as const)('player %s shows its own state', async (code, text) => {
    const { api } = spyApi({ fail: (method) => (method === 'getPlayer' ? code : undefined) });
    renderWith(api, <ExerciseBookRunner testId={TEXT_TEST} classItem={ITEM} />);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(api.startAttempt).not.toHaveBeenCalled();
  });

  it('a locked activity shows its reason and no start (FR-003)', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId="00000000-0000-4000-8000-000000000038" classItem={ITEM} />);
    expect(await screen.findByText('Audio tải chưa hoàn tất')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bắt đầu làm bài' })).toBeNull();
  });

  it('refreshes an expired audio URL once (CR F12)', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    await screen.findByDisplayValue('Monday');
    const before = api.getPlayer.mock.calls.length;
    fireEvent.error(screen.getByLabelText('Audio của activity'));
    await waitFor(() => expect(api.getPlayer.mock.calls.length).toBe(before + 1));
    fireEvent.error(screen.getByLabelText('Audio của activity'));
    expect(await screen.findByRole('button', { name: 'Tải lại audio' })).toBeTruthy();
    expect(api.getPlayer.mock.calls.length).toBe(before + 1);
  });

  it('records playback once per attempt', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    await screen.findByDisplayValue('Monday');
    const audio = screen.getByLabelText('Audio của activity');
    fireEvent.play(audio);
    fireEvent.play(audio);
    await waitFor(() => expect(api.playbackStarted).toHaveBeenCalledTimes(1));
  });

  it('missing class_item fails visibly', () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookRunner testId={TEXT_TEST} classItem={null} />);
    expect(screen.getByRole('alert').textContent).toContain('Thiếu thông tin bài được giao');
    expect(api.getPlayer).not.toHaveBeenCalled();
  });
});

describe('pre-submit payloads never reach the DOM, SSR or RSC (FR-013)', () => {
  it('runner and learner list DOM do not contain the sentinel', async () => {
    const { api } = spyApi();
    const first = renderWith(api, <ExerciseBookRunner testId={RESUME_TEST} classItem={ITEM} />);
    await screen.findByDisplayValue('Monday');
    expect(document.documentElement.outerHTML).not.toContain(SENTINEL);
    first.unmount();
    renderWith(api, <ExerciseBookRunner testId={TEXT_TEST} classItem={ITEM} />);
    await screen.findByRole('button', { name: 'Bắt đầu làm bài' });
    expect(document.documentElement.outerHTML).not.toContain(SENTINEL);
    cleanup();
    renderWith(api, <ExerciseBookAssignments />);
    await screen.findByText(/Đã nộp 1\/6 activity/);
    expect(document.documentElement.outerHTML).not.toContain(SENTINEL);
    expect(document.documentElement.outerHTML).not.toContain('answer_set_revision');
  });

  it('server render fetches nothing and carries no answer material', () => {
    const { api } = spyApi();
    for (const ui of [<ExerciseBookRunner key="r" testId={TEXT_TEST} classItem={ITEM} />, <ExerciseBookAssignments key="a" />, <LearnerReview key="v" attemptId="x" />]) {
      const html = renderToString(<ExerciseBookApiProvider api={api}>{ui}</ExerciseBookApiProvider>);
      for (const text of [SENTINEL, 'answer_set_revision', 'Đáp án tham chiếu', 'Transcript']) expect(html).not.toContain(text);
    }
    expect(api.getPlayer).not.toHaveBeenCalled();
    expect(api.listMyAssignments).not.toHaveBeenCalled();
    expect(api.getReview).not.toHaveBeenCalled();
  });
});

describe('learner list and progress', () => {
  it('shows own status per activity, excludes locked from completion and explains locks', async () => {
    const { api } = spyApi();
    renderWith(api, <ExerciseBookAssignments />);
    expect(await screen.findByText('Đã nộp 1/6 activity')).toBeTruthy();
    expect(screen.getByText('Hạn nộp: 21:00 25/11/2026 (giờ VN)')).toBeTruthy();
    const locked = screen.getAllByRole('button', { name: 'Bắt đầu' }).find((button) => button.getAttribute('aria-describedby')?.includes('U1-A05'))!;
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById(locked.getAttribute('aria-describedby')!)!.textContent).toBe('Chưa có audio');
    const resume = screen.getByRole('link', { name: 'Làm tiếp' });
    expect(resume.getAttribute('href')).toBe(`/listening/exercise-book/tests/${RESUME_TEST}?class_item=${ITEM}`);
    expect(screen.getByRole('link', { name: 'Xem tự đối chiếu' }).getAttribute('href')).toContain('/attempts/00000000-0000-4000-8000-000000000061/review');
    expect(screen.getByText('Đã quá hạn nộp.')).toBeTruthy();
  });

  it('empty and error states are distinct', async () => {
    const empty = spyApi();
    empty.api.listMyAssignments.mockResolvedValue({ items: [], next_cursor: null });
    renderWith(empty.api, <ExerciseBookAssignments />);
    expect(await screen.findByText('Bạn chưa được giao bài nào trong sách bài tập.')).toBeTruthy();
    cleanup();
    const failing = spyApi({ fail: (method) => (method === 'listMyAssignments' ? 'unavailable' : undefined) });
    renderWith(failing.api, <ExerciseBookAssignments />);
    expect((await screen.findByRole('alert')).textContent).toContain('chưa sẵn sàng');
  });

  it('My Class shows the entry only when the learner has a book assignment', async () => {
    const { api } = spyApi();
    render(<ExerciseBookLearnerEntry api={api} />);
    expect(await screen.findByRole('link', { name: 'Sách bài tập Listening được giao' })).toBeTruthy();
    cleanup();
    const failing = spyApi({ fail: () => 'unavailable' });
    const { container } = render(<ExerciseBookLearnerEntry api={failing.api} />);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });
});

describe('self-check review', () => {
  it('labels every source status, shows "chưa có" for missing material and never a verdict or score', () => {
    render(<ExerciseBookReview review={reviewTextFixture as ActivityReview} />);
    expect(screen.getByText('Tình trạng nguồn: Đáp án nguồn đã được xác nhận')).toBeTruthy();
    expect(screen.getByText('Tình trạng nguồn: Các nguồn đáp án chưa thống nhất')).toBeTruthy();
    expect(screen.getByText('Tình trạng nguồn: Chưa xác định được đáp án nguồn')).toBeTruthy();
    expect(screen.getByText('Đáp án tham chiếu: Thursday / Thu')).toBeTruthy();
    expect(screen.getByText('Đáp án tham chiếu: chưa có')).toBeTruthy();
    expect(screen.getByText('Giải thích: chưa có')).toBeTruthy();
    expect(screen.getByText('Câu trả lời của bạn: để trống')).toBeTruthy();
    expect(screen.getByText('Nguồn đáp án: Lấy nguyên từ đáp án của sách')).toBeTruthy();
    const text = document.body.textContent || '';
    for (const raw of ['literal_key', 'UNRESOLVED', 'DISAGREEMENT', 'Sai', 'Đúng', 'điểm:', 'Band']) expect(text).not.toContain(raw);
  });

  it('shows KEEP/CHANGE answers and references in words', () => {
    render(<ExerciseBookReview review={reviewKeepChangeFixture as ActivityReview} />);
    expect(screen.getByText('Câu trả lời của bạn: Sửa (CHANGE): ten')).toBeTruthy();
    expect(screen.getByText('Đáp án tham chiếu: Sửa (CHANGE): ten')).toBeTruthy();
    expect(screen.getByText('Đáp án tham chiếu: Giữ nguyên (KEEP)')).toBeTruthy();
  });

  it('a non-SELF-CHECK item fails closed: no reference and no inferred verdict', () => {
    const review = JSON.parse(JSON.stringify(reviewTextFixture));
    review.items[0].scoring_mode = 'AUTO';
    render(<ExerciseBookReview review={review} />);
    expect(screen.getByText(/Chế độ chấm của câu này chưa được hỗ trợ/)).toBeTruthy();
    expect(screen.queryByText('Đáp án tham chiếu: double room')).toBeNull();
  });

  it('learner review reuses the runner labels and refuses before submit', async () => {
    const { api } = spyApi();
    renderWith(api, <LearnerReview attemptId="00000000-0000-4000-8000-000000000061" />);
    expect(await screen.findByText('Câu 01 · table · r1 · c2 · Tự đối chiếu')).toBeTruthy();
    cleanup();
    renderWith(api, <LearnerReview attemptId="00000000-0000-4000-8000-000000000062" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Trạng thái đã thay đổi');
  });
});
