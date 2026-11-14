import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingExamSession } from '@/app/(authed-reading-player)/reading/exam/session/reading-exam-session';
import correction from '../../../backend/content_mock_correction/cam20_r3_c01.json';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'admin-fixture', email: 'fixture@example.test' } }),
}));

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/reading/exam/session?test_id=c01-fixture&admin_preview=1');
  get = vi.fn(); post = vi.fn(); patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith: vi.fn(), post, patch } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

it('renders four distinct complete source option banks with independent A-D selections', async () => {
  const fixture = {
    test_id: 'c01-fixture', title: 'Cam20 C01 source fixture', time_limit_minutes: 60,
    total_questions: 4,
    passages: [{ passage_order: 3, title: 'Passage fixture', body_markdown: 'Fixture text.' }],
    questions: correction.questions.map(q => ({
      q_num: q.q_num, passage_order: 3, question_type: 'mcq_single', prompt: q.prompt,
      payload: { options: q.options },
    })),
  };
  const original = JSON.stringify(fixture);
  get.mockResolvedValue(fixture);
  const view = render(<ReadingExamSession />);
  await screen.findByText(correction.questions[0].prompt, { exact: true });
  for (const q of correction.questions) {
    const card = view.container.querySelector(`#q-${q.q_num}`) as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByText(q.prompt, { exact: true })).toBeTruthy();
    const radios = within(card).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map(r => r.value)).toEqual(['A', 'B', 'C', 'D']);
    for (const option of q.options) expect(card.textContent).toContain(option.text);
    fireEvent.click(radios.find(r => r.value === q.answer.answer)!);
  }
  for (const q of correction.questions) {
    const card = view.container.querySelector(`#q-${q.q_num}`) as HTMLElement;
    const radios = within(card).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.filter(r => r.checked).map(r => r.value)).toEqual([q.answer.answer]);
    for (const other of correction.questions.filter(other => other.q_num !== q.q_num)) {
      expect(card.textContent).not.toContain(other.options[0].text);
    }
  }
  expect(JSON.stringify(fixture)).toBe(original);
  expect(post).not.toHaveBeenCalled();
  expect(patch).not.toHaveBeenCalled();
});
