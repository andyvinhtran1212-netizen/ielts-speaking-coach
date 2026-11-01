import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReadingReviewWorkspace } from '@/app/(reading-review)/reading/review/reading-review-workspace';
import { ReviewQuestionContext, reviewAnswerChoices } from '@/components/review-attempt-context';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=c14r4-review');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  getWith = vi.fn(); post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag: vi.fn(), mountSurvey: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

// Shape the backend now returns for ILR-RDG-CAM-B14-T4 Q14–17 (C14R4-04):
// no authored options, paragraph letters derived from the frozen passage.
const previews = [
  { label: 'A', text: 'In my view, it is perfectly possible for many species of animals living in zoos or…' },
  { label: 'B', text: 'Firstly, zoos aid conservation. Colossal numbers of species are becoming extinct across…' },
  { label: 'C', text: 'Zoos also provide education. Many children and adults, especially those in cities, will…' },
  { label: 'D', text: 'In addition to this, there is also the education that can take place in zoos through…' },
  { label: 'E', text: 'Zoos also play a key role in research. If we are to save wild species and restore and…' },
  { label: 'F', text: 'In conclusion, considering the many ongoing global threats to the environment, it is hard…' },
];
const questionContext = {
  question_id: 'q14', options: null, paragraph_labels: previews.map(row => row.label), paragraph_previews: previews,
  context_provenance: { options: 'unavailable', paragraph_labels: 'submission_snapshot', paragraph_previews: 'submission_snapshot' },
};
const text = (label: string) => previews.find(row => row.label === label)!.text;

function fixture() {
  const keys = { 14: 'B', 15: 'E', 16: 'C', 17: 'A' } as Record<number, string>;
  const answers = { 14: 'E', 15: 'E', 16: '', 17: 'D' } as Record<number, string>;
  return {
    attempt_id: 'c14r4-review', status: 'submitted', test_id: 'ILR-RDG-CAM-B14-T4', title: 'C14 R4 review',
    score: 1, max_score: 4, band_estimate: 3, skill_breakdown: {},
    context_source: { provenance: 'submission_snapshot', possibly_changed: false },
    passages: [{ passage_order: 2, title: 'Zoos', body_markdown: 'A In my view…' }],
    review: [14, 15, 16, 17].map(q_num => ({
      q_num, passage_order: 2, question_type: 'matching_information', prompt: `Statement ${q_num}`,
      user_answer: answers[q_num], expected: keys[q_num], correct: answers[q_num] === keys[q_num],
      question_context: questionContext, solution: { steps: `Locate paragraph ${keys[q_num]}.` },
    })),
  };
}

it('shows the paragraph list and the chosen/correct paragraph on C14R4 Q14–17 without changing keys or grades', async () => {
  const data = fixture();
  const original = JSON.stringify(data);
  getWith.mockResolvedValue(data);
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText(data.title);

  fireEvent.click(screen.getByRole('button', { name: /^Tất cả/ }));
  const card = (q: number) => view.container.querySelector(`#reading-review-q-${q}`) as HTMLElement;
  // Collapsed cards: letters only, no paragraph text in the summary.
  const summary = card(15).querySelector('.review-context-summary');
  expect(summary?.textContent).toBe('Đoạn: A, B, C, D, E, F');
  expect(card(15).querySelector('.review-question-context')).toBeNull();

  const q14 = card(14);
  expect(q14.querySelector('.rr-card__ans.is-user code')?.textContent).toBe('E');
  expect(q14.querySelector('.rr-card__ans.is-user .rr-card__ans-text')?.textContent).toBe(`— ${text('E')}`);
  expect(q14.querySelector('.rr-card__ans.is-correct code')?.textContent).toBe('B');
  expect(q14.querySelector('.rr-card__ans.is-correct .rr-card__ans-text')?.textContent).toBe(`— ${text('B')}`);
  expect(q14.className).toContain('is-incorrect');
  expect(card(15).className).toContain('is-correct');
  // A blank answer names no paragraph.
  expect(card(16).querySelector('.rr-card__ans.is-user code')?.textContent).toBe('—');
  expect(card(16).querySelector('.rr-card__ans.is-user .rr-card__ans-text')).toBeNull();

  // Expanded: the full list with each paragraph's opening.
  fireEvent.click(screen.getByRole('button', { name: 'Câu 17 — sai', exact: true }));
  const context = within(card(17).querySelector('.review-question-context') as HTMLElement);
  expect(context.getByText('Đoạn')).toBeTruthy();
  for (const row of previews) expect(context.getByText(row.text)).toBeTruthy();
  expect(card(17).querySelector('.review-context-summary')).toBeNull();

  expect(JSON.stringify(data)).toBe(original);
  expect(post).not.toHaveBeenCalled();
});

it('keeps authored option banks and names the chosen option', () => {
  const context = { options: [{ label: 'A', text: 'authored first' }, { label: 'B', text: 'authored second' }], paragraph_previews: previews };
  expect(reviewAnswerChoices(context, 'b')).toEqual([{ label: 'B', text: 'authored second' }]);
  expect(reviewAnswerChoices(context, 'A, B').map(choice => choice.label)).toEqual(['A', 'B']);
  // A partial match names nothing rather than half an answer.
  expect(reviewAnswerChoices(context, 'A, Z')).toEqual([]);
  const view = render(<ReviewQuestionContext value={context} />);
  expect(view.getByText('Nhóm lựa chọn')).toBeTruthy();
  expect(view.queryByText(previews[0].text)).toBeNull();
});

it('renders an old snapshot without letters or previews as before', async () => {
  expect(reviewAnswerChoices({ paragraph_labels: ['A', 'B'] }, 'A')).toEqual([]);
  const labelsOnly = render(<ReviewQuestionContext value={{ paragraph_labels: ['A', 'B', 'C'] }} />);
  expect(labelsOnly.container.textContent).toBe('Đoạn: A, B, C');
  labelsOnly.unmount();

  const data = fixture();
  data.review = data.review.map(item => ({ ...item, question_context: { question_id: 'q', options: null, paragraph_labels: null, context_provenance: {} } as any }));
  getWith.mockResolvedValue(data);
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText(data.title);
  const q14 = view.container.querySelector('#reading-review-q-14') as HTMLElement;
  expect(q14.querySelector('.review-context-summary')).toBeNull();
  expect(q14.querySelector('.rr-card__ans-text')).toBeNull();
  expect(q14.querySelector('.rr-card__ans.is-correct code')?.textContent).toBe('B');
});
