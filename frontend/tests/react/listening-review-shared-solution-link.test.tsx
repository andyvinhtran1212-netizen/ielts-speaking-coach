import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';
import fixture from '../fixtures/listening-review-group-and-editorial.json';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/listening/review?admin_test_id=7746fb2e-4718-5979-8f4e-2125d1aa31e4');
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith } });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: {
    attachCardFlag: vi.fn(), mountSurvey: vi.fn(),
  } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

// Staging B20-T1 Q17/18 shape: no response_type, so question_type is null.
function b20Pair() {
  const raw = structuredClone(fixture.group_review);
  raw.review = raw.review.map((row: any, index: number) => ({ ...row, q_num: 17 + index, question_type: null,
    question_context: { ...row.question_context, question_id: `aee36f37-5675-5370-9834-b49013380ca4:${17 + index}` } }));
  return raw;
}

it('C20L1-06: Q18 keeps its own rationale and opens the shared solution on Q17', async () => {
  const raw = b20Pair();
  raw.review[1].solution = { ...raw.review[1].solution, why_correct: 'E: participants may use the kilns.' };
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 18 — xem trước', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-18 .lr-card__top')!);
  const second = view.container.querySelector('#listening-review-q-18')!;
  expect(second.textContent).toContain('Lời giải chung cho câu 17, 18 nằm ở Câu 17; dưới đây là phần riêng của câu 18.');
  expect(second.textContent).toContain('E: participants may use the kilns.');
  expect(second.textContent).not.toContain('never consume mushrooms picked by friends or neighbours');
  const first = view.container.querySelector('#listening-review-q-17')!;
  expect(first.querySelector('.lr-card__detail')?.hasAttribute('hidden')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Mở Câu 17' }));
  expect(first.querySelector('.lr-card__detail')?.hasAttribute('hidden')).toBe(false);
  expect(first.textContent).toContain('Lời giải chung cho câu 17, 18.');
  expect(first.textContent).toContain('never consume mushrooms picked by friends or neighbours');
  expect(first.querySelector('.lr-sol__group-link')).toBeNull();
});

it('C20L4-06: an empty second slot shows the shared body with a link to its source card', async () => {
  getWith.mockResolvedValue(b20Pair());
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 18 — xem trước', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-18 .lr-card__top')!);
  const second = view.container.querySelector('#listening-review-q-18')!;
  expect(second.textContent).toContain('Lời giải chung cho câu 17, 18.');
  expect(second.textContent).toContain('Dan gives exactly two warnings');
  expect(second.querySelector('.lr-sol__group-link')?.textContent).toBe('Mở Câu 17');
});

it.each([0, 1])('keeps Q17 as the source when slot index %i has the fuller solution', async (fullerSlot) => {
  const raw = b20Pair();
  const shared = raw.review[0].solution;
  raw.review[fullerSlot].solution = shared;
  raw.review[1 - fullerSlot].solution = { why_correct: 'A: she explains what a kiln does.' } as any;
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 18 — xem trước', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-18 .lr-card__top')!);
  const second = view.container.querySelector('#listening-review-q-18')!;
  expect(second.querySelector('.lr-sol__group-link')?.textContent).toBe('Mở Câu 17');
  fireEvent.click(screen.getByRole('button', { name: 'Mở Câu 17' }));
  const first = view.container.querySelector('#listening-review-q-17')!;
  expect(first.querySelector('.lr-card__detail')?.hasAttribute('hidden')).toBe(false);
  expect(first.textContent).toContain('Lời giải chung cho câu 17, 18.');
  expect(first.textContent).not.toContain('phần riêng');
  expect(first.textContent).toContain('never consume mushrooms picked by friends or neighbours');
  expect(first.querySelector('.lr-sol__group-link')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mở Câu 18' })).toBeNull();
});
