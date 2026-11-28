// EXAMLISTENT-0070 FR-010 (CR #2557): the Listening test session with the exam
// room on. A submit cut off while the browser stays online must not wait for an
// `online` event that never comes: it backs off, re-reads the attempt, and ends
// at the result or at "Try again".
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-a', email: 'learner@example.test' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const listening = { id: 'paper-a', title: 'Room Listening', test_type: 'mini', audio_url: 'https://fixture.test/audio.wav',
  sections: [{ section_num: 1, title: 'Part 1', exercises: [{ id: 'exercise-a', exercise_type: 'dictation_gap_fill', payload: {
    questions: [{ q_num: 1, prompt: 'Prompt 1' }],
    template: { heading: 'Notes', groups: [{ heading: 'Items', items: [{ q_num: 1, prefix: 'Item 1' }] }] },
  } }] }],
};
const attempt = () => ({ attempt_id: 'attempt-a', started_at: new Date().toISOString(), time_limit_minutes: 60, answers: [], renderer_affinity: 'next', attempt_purpose: 'practice' });
const submitResult = { attempt_id: 'attempt-a', score: 1, max_score: 1, band_estimate: 5, per_question: [{ q_num: 1, correct: true, user_answer: 'a', expected: 'a' }] };
let api: Record<string, ReturnType<typeof vi.fn>>;
let submits: number;
let submitFails: number;

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear(); sessionStorage.clear();
  submits = 0;
  (window as any).__AVER_RUNTIME_CONFIG__ = { environment: 'staging', examRoomSurfaces: ['listening'] };
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  api = {
    getWith: vi.fn(async (path: string) => {
      if (path.endsWith('/review-flags')) return { attempt_id: 'attempt-a', protocol: 'question-cas-v1', review_flags: [] };
      // The re-read: the attempt is still open, so the room submits again.
      return { attempt_id: 'attempt-a', status: 'in_progress' };
    }),
    get: vi.fn(async (path: string) => path.includes('/in-progress') ? { attempt: attempt() } : listening),
    post: vi.fn(async () => ({ renderer_affinity: 'next' })),
    postWith: vi.fn(async (path: string) => {
      if (path.endsWith('/renderer-affinity')) return { renderer_affinity: 'next' };
      submits += 1;
      // No HTTP status: the POST was cut off while the browser stayed online.
      if (submits <= submitFails) throw new TypeError('Failed to fetch');
      return submitResult;
    }),
    patchWith: vi.fn(async () => ({ ok: true })),
    putWith: vi.fn(async () => ({ ok: true })),
  };
  Object.defineProperty(window, 'api', { configurable: true, value: api });
  Object.defineProperty(window, 'MockHook', { configurable: true, value: undefined });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  delete (window as any).__AVER_RUNTIME_CONFIG__;
  delete (navigator as any).onLine;
  window.history.replaceState(null, '', '/');
});

async function submitInRoom() {
  window.history.replaceState(null, '', '/listening/test/session?id=paper-a');
  render(<ListeningTestSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume test' }));
  // The tab lock answers first; until then nothing submits.
  const open = await waitFor(() => {
    const button = screen.getAllByRole('button', { name: 'Submit answers', exact: true })[0] as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    return button;
  });
  fireEvent.click(open);
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit answers' }));
}

it('a POST cut off while online backs off, re-reads, submits again and shows the result', async () => {
  submitFails = 1;
  await submitInRoom();
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  await screen.findByRole('heading', { level: 1, name: 'Test results' });
  // The shared request layer may retry once inside one attempt; the room adds
  // the backed-off attempt after the re-read.
  expect(submits).toBeGreaterThan(submitFails);
});

it('recovers a committed mock submit via its sealed receipt without opening scores', async () => {
  const sittingId = 'sitting-a';
  const mockAttempt = { ...attempt(), attempt_purpose: 'mock_delivery', mock_sitting_id: sittingId };
  api.get.mockImplementation(async (path: string) =>
    path.includes('/in-progress') ? { attempt: mockAttempt } : listening);
  const committed = new Set<string>();
  let posts = 0;
  api.postWith.mockImplementation(async (path: string) => {
    if (!path.endsWith('/submit')) return { renderer_affinity: 'next' };
    expect(path).toBe('/api/listening/tests/attempts/attempt-a/submit');
    posts++;
    if (!committed.has(path)) {
      committed.add(path);
      throw new TypeError('Submit response lost');
    }
    return { received: true, sealed: true, sitting_id: sittingId };
  });
  api.getWith.mockImplementation(async (path: string) => {
    if (path.endsWith('/review-flags')) return { attempt_id: 'attempt-a', protocol: 'question-cas-v1', review_flags: [] };
    if (path.includes('/in-progress')) return { attempt: mockAttempt };
    throw Object.assign(new Error('Sealed'), { status: 403 });
  });
  await submitInRoom();
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(await screen.findByText(/Listening answers collected/)).toBeTruthy();
  expect(posts).toBe(2);
  expect(committed.size).toBe(1);
  expect(screen.queryByRole('heading', { name: 'Test results' })).toBeNull();
  expect(api.getWith.mock.calls.some(([path]) => path === '/api/listening/tests/attempts/attempt-a')).toBe(false);
});

it('a POST that keeps failing while online ends at "Try again", never waiting forever', async () => {
  submitFails = 99;
  await submitInRoom();
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  }
  expect(await screen.findByRole('button', { name: /Try again/ })).toBeTruthy();
  // Bounded: nothing more is sent on its own once "Try again" is shown.
  const settled = submits;
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(submits).toBe(settled);
  expect(api.getWith.mock.calls.some(([path]) => path === '/api/listening/tests/attempts/attempt-a')).toBe(true);
});
