import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReadingReviewWorkspace } from '@/app/(reading-review)/reading/review/reading-review-workspace';
import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';
import { reviewExplanationUnavailableReason } from '@/components/review-attempt-context';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  getWith = vi.fn(); post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag: vi.fn(), mountSurvey: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

const DISABLED = { has_content: true, allowed: false, reason: 'disabled_by_admin', content_version: 'v1' };
const DISABLED_TEXT = 'Lời giải chi tiết đang tắt cho bài này theo cài đặt của giáo viên hoặc quản trị viên.';

// Cambridge heading bank shape (C14R2-04 / C16R2-03): authored options, no
// solution, web explanations disabled for the paper.
const headings = [
  { label: 'i', text: 'The search for a solution' },
  { label: 'iii', text: 'An unexpected outcome' },
  { label: 'vi', text: 'Disagreement about the cause' },
];
const headingContext = { question_id: 'q2', instruction: 'Choose the correct heading for each paragraph.', options: headings,
  context_provenance: { options: 'submission_snapshot' } };

function readingFixture(access: unknown) {
  return {
    attempt_id: 'rv02-reading', status: 'submitted', test_id: 'ILR-RDG-CAM-B14-T2', title: 'Reading RV-02 review',
    score: 0, max_score: 2, band_estimate: 3, skill_breakdown: {},
    context_source: { provenance: 'submission_snapshot', possibly_changed: false },
    web_explanation_access: access,
    passages: [{ passage_order: 1, title: 'Source', body_markdown: 'Source text.' }],
    review: [
      { q_num: 1, passage_order: 1, correct: false, question_type: 'matching_headings', prompt: 'Paragraph A',
        user_answer: 'i', expected: 'iii', question_context: headingContext, solution: { steps: 'Đọc câu chủ đề của đoạn A.' } },
      { q_num: 2, passage_order: 1, correct: false, question_type: 'matching_headings', prompt: 'Paragraph B',
        user_answer: 'vi', expected: 'iii', question_context: headingContext },
    ],
  };
}

it('Reading: a card without a solution shows its option bank unexpanded, names each answer and says why there is no solution', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=rv02-reading');
  const data = readingFixture(DISABLED);
  const original = JSON.stringify(data);
  getWith.mockResolvedValue(data);
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText(data.title);
  const card = (q: number) => view.container.querySelector(`#reading-review-q-${q}`) as HTMLElement;

  // Q1 is the current card; Q2 is neither selected nor expandable.
  expect(card(2).classList.contains('is-current')).toBe(false);
  expect(card(2).querySelector('.rr-card__top')?.getAttribute('role')).toBeNull();
  const bank = card(2).querySelector('.review-question-context');
  expect(bank?.textContent).toContain('Nhóm lựa chọn');
  for (const row of headings) expect(bank?.textContent).toContain(row.text);

  expect(card(2).querySelector('.rr-card__ans.is-user code')?.textContent).toBe('vi');
  expect(card(2).querySelector('.rr-card__ans.is-user .rr-card__ans-text')?.textContent).toBe('— Disagreement about the cause');
  expect(card(2).querySelector('.rr-card__ans.is-correct code')?.textContent).toBe('iii');
  expect(card(2).querySelector('.rr-card__ans.is-correct .rr-card__ans-text')?.textContent).toBe('— An unexpected outcome');
  expect(card(2).querySelector('.rr-card__nosol')?.textContent).toBe(DISABLED_TEXT);

  // A card with a solution keeps the existing collapsed layout and no reason line.
  fireEvent.click(screen.getByRole('button', { name: 'Câu 2 — sai', exact: true }));
  expect(card(1).querySelector('.review-question-context')).toBeNull();
  expect(card(1).querySelector('.rr-card__nosol')).toBeNull();
  expect(card(1).querySelector('.rr-card__top')?.getAttribute('role')).toBe('button');

  expect(JSON.stringify(data)).toBe(original);
  expect(post).not.toHaveBeenCalled();
});

it('Reading: a paper with no web explanation content says only that this question has no solution', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=rv02-reading');
  const data = readingFixture(null);
  getWith.mockResolvedValue(data);
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText(data.title);
  expect(view.container.querySelector('#reading-review-q-2 .rr-card__nosol')?.textContent).toBe('Câu này chưa có lời giải chi tiết.');
});

// Listening multiple choice (C13L1-04 shape): authored A–C bank, no solution.
const listeningOptions = [
  { label: 'A', text: 'the cost of the course' },
  { label: 'B', text: 'the length of the course' },
  { label: 'C', text: 'the location of the course' },
];
function listeningFixture(access: unknown) {
  const context = { question_id: 'l1', options: listeningOptions, context_provenance: { options: 'submission_snapshot' } };
  return {
    attempt_id: 'rv02-listening', status: 'submitted', test_id: 'ILR-LIS-CAM-B13-T1', title: 'Listening RV-02 review',
    score: 0, max_score: 2, band_estimate: 3,
    context_source: { provenance: 'submission_snapshot', possibly_changed: false },
    web_explanation_access: access,
    sections: [{ section_num: 1, title: 'Section 1', theme: '', transcript: 'Speaker: Hello.' }],
    review: [
      { q_num: 1, section: 'S1', correct: false, question_type: 'mcq_single', prompt: 'What worries the man?',
        user_answer: 'C', expected: 'B', question_context: context, solution: { why_correct: 'He says it is too long.' } },
      { q_num: 2, section: 'S1', correct: false, question_type: 'mcq_single', prompt: 'What does the woman recommend?',
        user_answer: 'A', expected: 'C', question_context: context, solution: {} },
    ],
  };
}

it('Listening: a card without a solution shows its option bank unexpanded, names each answer and says why there is no solution', async () => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=rv02-listening');
  const data = listeningFixture({ has_content: true, allowed: false, reason: 'waiting_for_admin_explanation_release', content_version: 'v1' });
  const original = JSON.stringify(data);
  getWith.mockResolvedValue(data);
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 2 — sai', exact: true });
  const card = (q: number) => view.container.querySelector(`#listening-review-q-${q}`) as HTMLElement;

  expect(card(2).classList.contains('is-current')).toBe(false);
  const bank = card(2).querySelector('.review-question-context');
  expect(bank?.textContent).toContain('Nhóm lựa chọn');
  for (const row of listeningOptions) expect(bank?.textContent).toContain(row.text);
  expect(card(2).querySelector('.lr-card__ans.is-user code')?.textContent).toBe('A');
  expect(card(2).querySelector('.lr-card__ans.is-user .lr-card__ans-text')?.textContent).toBe('— the cost of the course');
  expect(card(2).querySelector('.lr-card__ans.is-correct code')?.textContent).toBe('C');
  expect(card(2).querySelector('.lr-card__ans.is-correct .lr-card__ans-text')?.textContent).toBe('— the location of the course');

  fireEvent.click(card(2).querySelector('.lr-card__top')!);
  expect(card(2).querySelector('.lr-sol__empty')?.textContent)
    .toBe('Lời giải chi tiết sẽ mở khi giáo viên hoặc quản trị viên công bố lời giải.');

  // A card with a solution keeps its context behind expansion.
  expect(card(1).classList.contains('is-current')).toBe(false);
  expect(card(1).querySelector('.review-question-context')).toBeNull();
  expect(JSON.stringify(data)).toBe(original);
  expect(post).not.toHaveBeenCalled();
});

it('Listening: disabled mode names the reason instead of a bare "no solution"', async () => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=rv02-listening');
  getWith.mockResolvedValue(listeningFixture(DISABLED));
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 2 — sai', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-2 .lr-card__top')!);
  expect(view.container.querySelector('#listening-review-q-2 .lr-sol__empty')?.textContent).toBe(DISABLED_TEXT);
});

it('Listening: a report_only paper says it has no detailed solution, not that one will open later', async () => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=rv02-listening');
  // Exact shape from backend/routers/listening.py for scoring_policy == "report_only".
  getWith.mockResolvedValue(listeningFixture({ available: false, reason: 'report_only' }));
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 2 — sai', exact: true });
  fireEvent.click(view.container.querySelector('#listening-review-q-2 .lr-card__top')!);
  expect(view.container.querySelector('#listening-review-q-2 .lr-sol__empty')?.textContent)
    .toBe('Bài này chỉ báo cáo kết quả, không có lời giải chi tiết.');
});

it.each([
  [null, 'Câu này chưa có lời giải chi tiết.'],
  [{ allowed: true, reason: 'released_with_result' }, 'Câu này chưa có lời giải chi tiết.'],
  [{ allowed: true, reason: 'admin_preview' }, 'Câu này chưa có lời giải chi tiết.'],
  [DISABLED, DISABLED_TEXT],
  [{ allowed: false, reason: 'waiting_for_admin_result_release' }, 'Lời giải chi tiết sẽ mở khi kết quả bài thi được công bố.'],
  [{ allowed: false, reason: 'waiting_for_admin_explanation_release' }, 'Lời giải chi tiết sẽ mở khi giáo viên hoặc quản trị viên công bố lời giải.'],
  [{ allowed: false, reason: 'post_test_capture_required' }, 'Lời giải chi tiết sẽ mở sau khi bạn hoàn thành phần tự đánh giá sau bài làm.'],
  [{ allowed: false, reason: 'content_release_gates_blocked' }, 'Lời giải chi tiết của đề này đang được biên tập, chưa phát hành.'],
  [{ allowed: false, reason: 'content_version_unavailable' }, 'Phiên bản lời giải dành cho bài này chưa sẵn sàng.'],
  [{ allowed: false, reason: 'invalid_policy' }, 'Lời giải chi tiết chưa mở cho bài này.'],
  // Listening report_only papers (backend/routers/listening.py) use `available`, not `allowed`.
  [{ available: false, reason: 'report_only' }, 'Bài này chỉ báo cáo kết quả, không có lời giải chi tiết.'],
  [{ allowed: false, reason: 'report_only' }, 'Bài này chỉ báo cáo kết quả, không có lời giải chi tiết.'],
  [{ available: true }, 'Câu này chưa có lời giải chi tiết.'],
  [{ available: false, reason: 'disabled_by_admin' }, DISABLED_TEXT],
  [{ available: false }, 'Lời giải chi tiết chưa mở cho bài này.'],
])('explains web_explanation_access %j in Vietnamese', (access, expected) => {
  expect(reviewExplanationUnavailableReason(access)).toBe(expected);
});
