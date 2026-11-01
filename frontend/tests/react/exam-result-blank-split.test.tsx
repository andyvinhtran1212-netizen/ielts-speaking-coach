import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingExamSession } from '@/app/(authed-reading-player)/reading/exam/session/reading-exam-session';
import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-a', email: 'learner@example.test' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

// RV-06: 2 correct + 2 incorrect + 3 blank. A blank row stays `correct: false`
// (it earns zero) but must not be reported as an incorrect answer.
const perQuestion = [
  { q_num: 1, correct: true, user_answer: 'A', expected: 'A' },
  { q_num: 2, correct: false, user_answer: 'B', expected: 'C' },
  { q_num: 3, correct: false, user_answer: '', expected: 'D' },
  { q_num: 4, correct: true, user_answer: 'library', expected: 'library' },
  { q_num: 5, correct: false, user_answer: 'museum', expected: 'gallery' },
  { q_num: 6, correct: false, user_answer: '   ', expected: 'river' },
  { q_num: 7, correct: false, user_answer: null, expected: 'bridge' },
];
const questions = perQuestion.map(({ q_num }) => ({ q_num, passage_order: 1, question_type: 'short_answer', prompt: `Prompt ${q_num}` }));
const reading = { test_id: 'paper-a', title: 'Result Reading', time_limit_minutes: 60, total_questions: 7,
  passages: [{ passage_order: 1, title: 'Passage', body_markdown: 'Passage body.' }], questions };
const listening = { id: 'paper-a', title: 'Result Listening', test_type: 'mini', audio_url: 'https://fixture.test/audio.wav',
  sections: [{ section_num: 1, title: 'Part 1', exercises: [{ id: 'exercise-a', exercise_type: 'dictation_gap_fill', payload: {
    questions: perQuestion.map(({ q_num }) => ({ q_num, prompt: `Prompt ${q_num}` })),
    template: { heading: 'Notes', groups: [{ heading: 'Items', items: perQuestion.map(({ q_num }) => ({ q_num, prefix: `Item ${q_num}` })) }] },
  } }] }],
};
const attempt = () => ({ attempt_id: 'attempt-a', started_at: new Date().toISOString(), time_limit_minutes: 60, answers: [], renderer_affinity: 'next', attempt_purpose: 'practice' });
let submitResult: Record<string, unknown>;
let api: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  submitResult = { attempt_id: 'attempt-a', score: 2, max_score: 7, band_estimate: 3.5, per_question: perQuestion };
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  api = {
    getWith: vi.fn(async (path: string) => path.endsWith('/review-flags')
      ? { attempt_id: 'attempt-a', protocol: 'question-cas-v1', review_flags: [] }
      : { test: reading, in_progress: attempt() }),
    get: vi.fn(async (path: string) => path.includes('/in-progress') ? { attempt: attempt() } : listening),
    post: vi.fn(async () => ({ renderer_affinity: 'next' })),
    postWith: vi.fn(async (path: string) => path.endsWith('/renderer-affinity') ? { renderer_affinity: 'next' } : submitResult),
    patchWith: vi.fn(),
  };
  Object.defineProperty(window, 'api', { configurable: true, value: api });
  Object.defineProperty(window, 'MockHook', { configurable: true, value: undefined });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (source: string) => source });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

const metric = (label: string) => within(screen.getByLabelText('Results overview')).getByText(label, { exact: true }).parentElement?.querySelector('strong')?.textContent;

function expectSplitResult(view: ReturnType<typeof render>) {
  expect(metric('Correct')).toBe('2/7');
  expect(metric('Incorrect')).toBe('2');
  expect(metric('Unanswered')).toBe('3');
  expect(screen.queryByText('Review needed')).toBeNull();
  expect(screen.getByRole('heading', { level: 2, name: 'Review 2 incorrect answers and 3 unanswered questions' })).toBeTruthy();
  expect(screen.queryByText(/Review 5 incorrect answers/)).toBeNull();
  const map = [...view.container.querySelectorAll('.exam-result-question-map span')].map((cell) => cell.getAttribute('aria-label'));
  expect(map).toEqual([
    'Question 1: correct', 'Question 2: incorrect', 'Question 3: unanswered', 'Question 4: correct',
    'Question 5: incorrect', 'Question 6: unanswered', 'Question 7: unanswered',
  ]);
}

it('Reading result reports 2 incorrect and 3 unanswered separately and keeps the persisted score', async () => {
  window.history.replaceState(null, '', '/reading/exam/session?test_id=paper-a');
  const original = JSON.stringify(submitResult);
  const view = render(<ReadingExamSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume test' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Submit', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Submit answers', exact: true }));
  await screen.findByRole('heading', { level: 1, name: 'Test results' });
  expectSplitResult(view);
  expect(metric('Accuracy')).toBe('29%');
  expect(JSON.stringify(submitResult)).toBe(original);
});

it('Listening result reports 2 incorrect and 3 unanswered separately and keeps the persisted score', async () => {
  window.history.replaceState(null, '', '/listening/test/session?id=paper-a');
  const view = render(<ListeningTestSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume test' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Submit answers', exact: true }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit answers', exact: true }));
  await screen.findByRole('heading', { level: 1, name: 'Test results' });
  expectSplitResult(view);
});

it.each([
  { rows: perQuestion.filter((row) => row.correct || row.user_answer === 'B'), title: 'Review 1 incorrect answer' },
  { rows: perQuestion.filter((row) => row.correct || row.q_num === 3), title: 'Review 1 unanswered question' },
  { rows: perQuestion.filter((row) => row.correct), title: 'Review your answers' },
])('Reading next step names only the outcomes present ($title)', async ({ rows, title }) => {
  submitResult = { attempt_id: 'attempt-a', score: 2, max_score: rows.length, per_question: rows };
  window.history.replaceState(null, '', '/reading/exam/session?test_id=paper-a');
  render(<ReadingExamSession />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume test' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Submit', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Submit answers', exact: true }));
  expect(await screen.findByRole('heading', { level: 2, name: title })).toBeTruthy();
});
