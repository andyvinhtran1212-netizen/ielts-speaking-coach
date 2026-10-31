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
  expect(card.querySelector('.lr-sol__empty')).toBeNull();
  expect(card.textContent).not.toMatch(/chưa có lời giải chi tiết/i);
  expect(card.querySelector('.lr-card__ans.is-correct code')?.textContent).toBe('{B, C}');
  expect(card.textContent).toContain('chấp nhận mọi thứ tự');
  // PC-J125: the label shows the stored bounds (690.46–702.46 s) to ±0.05 s; the old
  // whole-second label floored the end to 11:42, 0.46 s before the real stop.
  expect(card.textContent).toContain('11:30.5–11:42.5');
  expect(JSON.stringify(raw)).toBe(before);
});

it('shows the accepted Cam19 C/E set beside a correct reversed E/C response without changing either grade', async () => {
  const raw = structuredClone(fixture.group_review);
  raw.preview = false;
  raw.score = 2;
  raw.max_score = 2;
  raw.review = raw.review.map((row, i) => ({ ...row, q_num: 17 + i,
    prompt: 'Which TWO things does David say about the lifeboat volunteer training?',
    correct: true, expected: i ? 'E' : 'C', user_answer: i ? 'C' : 'E',
    question_context: { ...row.question_context, question_id: `ed852bcc-b3c3-57a5-bf60-278d7c4adce2:${17 + i}` },
  }));
  const before = JSON.stringify(raw);
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 17 — đúng', exact: true });
  expect(view.container.querySelector('#listening-review-q-17 .lr-card__ans.is-correct code')?.textContent).toBe('{C, E}');
  expect(view.container.querySelector('#listening-review-q-18 .lr-card__ans.is-correct code')?.textContent).toBe('{C, E}');
  expect(view.container.querySelector('#listening-review-q-17')?.textContent).toContain('chấp nhận mọi thứ tự');
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

it('shows an mcq_multi question once on an opened card when the instruction also carries it (PC-J211, B20-T4 Q21–22)', async () => {
  const raw = structuredClone(fixture.group_review);
  const question = 'Which TWO benefits for children of learning to write did BOTH students find surprising?';
  raw.review = raw.review.map((row: any, i: number) => ({ ...row, q_num: 21 + i, prompt: question,
    question_context: { ...row.question_context, question_id: `728216be-2118-5cab-b063-9f19b7ebfc8e:${21 + i}`,
      instruction: `Choose TWO letters, A–E.\n${question}` },
  }));
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 21 — xem trước', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-21 .lr-card__top')!);
  const card = view.container.querySelector('#listening-review-q-21')!;
  expect(card.querySelector('.review-question-context')?.textContent).toContain('Choose TWO letters, A–E.');
  expect(card.textContent!.split(question)).toHaveLength(2);
});

it('keeps a no-solution mcq_multi card context visible while unopened and still shows its question once (PC-J488: RV-02 + PC-J211)', async () => {
  const raw = structuredClone(fixture.group_review);
  const question = 'Which TWO benefits for children of learning to write did BOTH students find surprising?';
  raw.review = raw.review.map((row: any, i: number) => ({ ...row, q_num: 21 + i, prompt: question, solution: {},
    question_context: { ...row.question_context, question_id: `728216be-2118-5cab-b063-9f19b7ebfc8e:${21 + i}`,
      instruction: `Choose TWO letters, A–E.\n${question}` },
  }));
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 21 — xem trước', exact: true });
  // Q21 is the default current card; Q22 is neither opened nor selected.
  const card = view.container.querySelector('#listening-review-q-22')!;
  expect(card.classList.contains('is-open')).toBe(false);
  expect(card.classList.contains('is-current')).toBe(false);
  expect(card.querySelector('.review-question-context')?.textContent).toContain('Choose TWO letters, A–E.');
  expect(card.textContent!.split(question)).toHaveLength(2);
});
