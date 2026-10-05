import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingExamSession } from '@/app/(authed-reading-player)/reading/exam/session/reading-exam-session';
import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-a', email: 'learner@example.test' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
const scope = { attempt_id: 'attempt-a', protocol: 'question-cas-v1' };
const flag = { q_num: 1, question_id: 'question-a', flagged: true, revision: 2, updated_at: null };
const reading = { test_id: 'paper-a', title: 'Frozen Reading', time_limit_minutes: 60, total_questions: 1,
  passages: [{ passage_order: 1, title: 'Passage', body_markdown: 'FROZEN_PASSAGE_CONTEXT' }],
  questions: [{ q_num: 1, passage_order: 1, question_type: 'mcq_single', prompt: 'Choose a place.', payload: { options: [{ label: 'A', text: 'Library' }, { label: 'B', text: 'Museum' }] } }],
};
const listening = { id: 'paper-a', title: 'Frozen Listening', test_type: 'mini', audio_url: 'https://fixture.test/audio.wav',
  sections: [{ section_num: 1, title: 'Part 1', exercises: [{ id: 'exercise-a', exercise_type: 'dictation_gap_fill', payload: { questions: [{ q_num: 1, prompt: 'Place' }], template: { heading: 'Place', groups: [{ heading: 'Destination', items: [{ q_num: 1, prefix: 'Visit' }] }] } } }] }],
};
const admitted = () => ({ attempt_id: 'attempt-a', started_at: new Date().toISOString(), time_limit_minutes: 60, answers: [{ q_num: 1, user_answer: 'saved answer' }], renderer_affinity: 'next', attempt_purpose: 'mock_delivery', mock_sitting_id: 'sitting-a' });
let bound: boolean; let savedFlag: typeof flag; let failFlag: boolean;
let api: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  bound = false; savedFlag = { ...flag }; failFlag = false; localStorage.clear(); sessionStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  api = {
    getWith: vi.fn(async (path: string) => {
      if (path.endsWith('/review-flags')) return { ...scope, review_flags: [savedFlag] };
      if (!bound) throw Object.assign(new Error('Admission required'), { status: 409, detail: { reason: 'admission_required' } });
      return { test: reading, in_progress: admitted() };
    }),
    get: vi.fn(async (path: string) => {
      if (path.includes('/in-progress')) return { attempt: bound ? admitted() : null };
      if (!bound) throw Object.assign(new Error('Admission required'), { status: 409, detail: { reason: 'admission_required' } });
      return listening;
    }),
    postWith: vi.fn(async () => { bound = true; return admitted(); }),
    post: vi.fn(async () => ({ renderer_affinity: 'next' })),
    patchWith: vi.fn(async (_path: string, body: any) => {
      if (failFlag) throw Object.assign(new Error('Offline'), { status: 503 });
      savedFlag = { ...savedFlag, flagged: body.flagged, revision: savedFlag.revision + 1 };
      return { ...scope, ...savedFlag, operation_id: body.operation_id, accepted: true, reason: 'applied' };
    }),
  };
  Object.defineProperty(window, 'api', { configurable: true, value: api });
  Object.defineProperty(window, 'MockHook', { configurable: true, value: undefined });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (source: string) => source });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
it('Reading waits for Start, admits the exact sitting, then loads bound context and saved Review flags', async () => {
  window.history.replaceState(null, '', '/reading/exam/session?test_id=paper-a&sitting_id=sitting-a');
  render(<ReadingExamSession />);
  const start = await screen.findByRole('button', { name: 'Bắt đầu bài thi', exact: true });
  expect(api.postWith).not.toHaveBeenCalled(); expect(screen.queryByText('FROZEN_PASSAGE_CONTEXT')).toBeNull();
  fireEvent.click(start); await screen.findByText('FROZEN_PASSAGE_CONTEXT');
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Review', exact: true }) as HTMLInputElement).checked).toBe(true));
  expect(api.postWith.mock.calls[0][1]).toMatchObject({ purpose: 'mock_delivery', mock_sitting_id: 'sitting-a' });
  expect(api.patchWith).not.toHaveBeenCalled();
  expect(api.getWith.mock.calls.filter(([path]) => path.includes('/boot')).every(([path]) => path.includes('sitting_id=sitting-a'))).toBe(true);
});
it('Listening admission exposes frozen context, restores flags and preserves saved answers', async () => {
  window.history.replaceState(null, '', '/listening/test/session?id=paper-a&sitting_id=sitting-a');
  render(<ListeningTestSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu bài thi', exact: true }));
  const input = await screen.findByRole('textbox', { name: 'Answer 1', exact: true });
  expect((input as HTMLInputElement).value).toBe('saved answer');
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Review', exact: true }) as HTMLInputElement).checked).toBe(true));
  expect(api.postWith.mock.calls[0][1]).toMatchObject({ purpose: 'mock_delivery', mock_sitting_id: 'sitting-a' });
  expect(api.patchWith).not.toHaveBeenCalled();
  expect(api.get.mock.calls.filter(([path]) => !path.includes('/in-progress')).every(([path]) => path.includes('sitting_id=sitting-a'))).toBe(true);
});
it('failed Review save stays visible, explicit retry saves it, and reload does not create another attempt', async () => {
  bound = true; window.history.replaceState(null, '', '/listening/test/session?id=paper-a&sitting_id=sitting-a');
  const first = render(<ListeningTestSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục bài đang làm' }));
  const review = await screen.findByRole('checkbox', { name: 'Review', exact: true });
  await waitFor(() => expect((review as HTMLInputElement).checked).toBe(true));
  failFlag = true; fireEvent.click(review); expect((review as HTMLInputElement).checked).toBe(false);
  expect(await screen.findByText(/cờ Review chưa lưu được/)).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Answer 1', exact: true }) as HTMLInputElement).value).toBe('saved answer');
  failFlag = false; fireEvent.click(screen.getByRole('button', { name: 'Thử lại cờ Review' }));
  await waitFor(() => expect(savedFlag.flagged).toBe(false));
  expect(api.patchWith.mock.calls.every(([path]) => path.endsWith('/review-flags'))).toBe(true);
  first.unmount(); render(<ListeningTestSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục bài đang làm' }));
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Review', exact: true }) as HTMLInputElement).checked).toBe(false));
  expect(api.postWith).not.toHaveBeenCalled();
});
