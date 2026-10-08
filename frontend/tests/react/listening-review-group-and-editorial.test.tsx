import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';
import fixture from '../fixtures/listening-review-group-and-editorial.json';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/listening/review?admin_test_id=2191dcd5-d99f-5874-856f-87ebdc4486a9');
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith } });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: {
    attachCardFlag: vi.fn(), mountSurvey: vi.fn(),
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

it('opens the real Q12 second slot with shared script, translation and rationale while retaining its answer and own replay', async () => {
  const raw = structuredClone(fixture.group_review);
  const before = JSON.stringify(raw);
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 12 — xem trước', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-12 .lr-card__top')!);
  const card = view.container.querySelector('#listening-review-q-12')!;
  expect(card.textContent).toContain('Lời giải chung cho câu 11, 12.');
  expect(card.textContent).toContain('never consume mushrooms picked by friends or neighbours');
  expect(card.textContent).toContain('Đừng bao giờ ăn nấm do bạn bè hay hàng xóm hái');
  expect(card.textContent).toContain('Dan gives exactly two warnings');
  expect(card.textContent).not.toContain('Chưa có lời giải chi tiết.');
  expect(card.querySelector('.lr-card__ans.is-correct code')?.textContent).toBe('C');
  expect(card.textContent).toContain('11:30–11:42');
  expect(JSON.stringify(raw)).toBe(before);
});

it.each(fixture.editorial_scripts)('renders the exact captured Script at Q$q_num with editorial language retained', async ({ q_num, script }) => {
  const raw = structuredClone(fixture.group_review);
  raw.review = [{ ...raw.review[0], q_num, question_type: 'gap_fill', solution: { script } }];
  raw.sections = [{ section_num: 2, title: 'Section 2', theme: '', transcript: '**Narrator:** Hopefully that[will]change; [I] saw birds [alight]. [emotion:hopeful] [pause:1s]' }];
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: `Câu ${q_num} — xem trước`, exact: true });
  fireEvent.click(view.container.querySelector(`#listening-review-q-${q_num} .lr-card__top`)!);
  const rendered = view.container.querySelector('.lr-sol__sec--script')!.textContent!;
  const word = q_num === 21 ? 'I' : q_num === 27 ? 'will' : 'alight';
  const expectedPhrase = q_num === 21 ? 'especially as I had so many people'
    : q_num === 27 ? 'Hopefully that will change.' : 'birds are alight on roads';
  expect(rendered).toContain(expectedPhrase);
  expect(rendered).not.toContain(`[${word}]`);
  const transcript = view.container.querySelector('.lr-transcript__body')?.textContent || '';
  expect(transcript).toContain('Hopefully that will change; I saw birds alight.');
  expect(transcript).not.toMatch(/emotion:|pause:/);
});

it('keeps known speaker/stress cues readable while hiding emotion and pause controls', async () => {
  const raw = structuredClone(fixture.group_review);
  raw.review = [{ ...raw.review[0], solution: { script: '[M-BrE-30s-professional]\n[sfx:phone-ring] [ambience:room:3s] [tone:serious] [emotion:polite] I [hesitate] heard [stress:arc lamp] [breath] [pause:1s] today. Call [digits:07700 924168].' } }];
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 11 — xem trước', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-11 .lr-card__top')!);
  const script = view.container.querySelector('.lr-sol__sec--script')!;
  expect(script.textContent).toContain('Man:');
  expect(script.querySelector('strong.lr-stress')?.textContent).toBe('arc lamp');
  expect(script.textContent).not.toMatch(/emotion:|pause:|breath|hesitate|M-BrE|sfx:|ambience:|tone:|digits:/);
  expect(script.textContent).toContain('Call 07700 924168.');
});
