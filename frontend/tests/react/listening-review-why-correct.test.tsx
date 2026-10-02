import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=why-correct-attempt');
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith } });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: {
    attachCardFlag: vi.fn(), mountSurvey: vi.fn(),
  } });
});

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/');
});

async function review(whyCorrect: string, vocab = '') {
  const raw = {
    attempt_id: 'why-correct-attempt', test_id: 'synthetic-why-correct',
    title: 'Explanation formatting', status: 'submitted', preview: false,
    score: 0, max_score: 1, audio_url: '', audio_duration: 0,
    sections: [{ section_num: 1, transcript: '', title: 'Part 1' }],
    review: [{ q_num: 2, correct: false, user_answer: 'other', expected: 'target',
      section: '1', solution: { why_correct: whyCorrect, vocab_focus: vocab } }],
  };
  const before = JSON.stringify(raw);
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 2 — sai', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-2 .lr-card__top')!);
  const blocks = Array.from(view.container.querySelectorAll('.lr-why'));
  expect(JSON.stringify(raw)).toBe(before);
  expect(getWith).toHaveBeenCalledTimes(1);
  return { view, blocks };
}

it('keeps literal semicolons in one authored English prose paragraph', async () => {
  const prose = 'The speaker confirms the detail; the blank needs an adjective; copy that word.';
  const { blocks } = await review(prose);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].querySelector('.lr-why__lang')?.textContent).toBe('EN');
  expect(blocks[0].querySelector('ul')).toBeNull();
  expect(blocks[0].textContent).toBe(`EN${prose}`);
});

it.each([
  'First authored row; keep its clause.\nSecond authored row; keep that clause.',
  '- First authored row; keep its clause.\n• Second authored row; keep that clause.',
])('uses authored newlines as list boundaries, retaining semicolons within each row: %s', async (prose) => {
  const { blocks } = await review(prose);
  expect(Array.from(blocks[0].querySelectorAll('li'), li => li.textContent)).toEqual([
    'First authored row; keep its clause.', 'Second authored row; keep that clause.',
  ]);
});

it('keeps separate English and Vietnamese prose paragraphs and their literal semicolons', async () => {
  const english = 'The detail answers the question; it completes the table.';
  const vietnamese = 'Chi tiết trả lời câu hỏi; nó hoàn thành bảng.';
  const { blocks } = await review(`${english}\n\n${vietnamese}`);
  expect(blocks.map(block => block.querySelector('.lr-why__lang')?.textContent)).toEqual(['EN', 'VN']);
  expect(blocks.map(block => block.textContent)).toEqual([`EN${english}`, `VN${vietnamese}`]);
  expect(blocks.every(block => block.querySelector('ul') === null)).toBe(true);
});

it('leaves the vocabulary consumer semicolon list behavior unchanged', async () => {
  const { view, blocks } = await review('Keep this sentence; keep its continuation.', 'first term; second term');
  const vocabSection = Array.from(view.container.querySelectorAll('.lr-sol__sec'))
    .find(section => section.querySelector('.lr-sol__label')?.textContent === 'Từ vựng');
  expect(vocabSection).toBeTruthy();
  expect(Array.from(vocabSection!.querySelectorAll('li'), li => li.textContent)).toEqual(['first term', 'second term']);
  expect(blocks[0].querySelector('ul')).toBeNull();
});

it('retains inline emphasis and code inside prose without interpreting a semicolon as a row break', async () => {
  const { blocks } = await review('Use **detail** in the table; write `target` after the *label*.');
  expect(blocks[0].querySelector('strong')?.textContent).toBe('detail');
  expect(blocks[0].querySelector('code')?.textContent).toBe('target');
  expect(blocks[0].querySelector('em')?.textContent).toBe('label');
  expect(blocks[0].querySelector('ul')).toBeNull();
  expect(blocks[0].textContent).toBe('ENUse detail in the table; write target after the label.');
});
