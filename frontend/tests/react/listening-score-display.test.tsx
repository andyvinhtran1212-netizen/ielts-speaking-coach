import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResultView } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';
import { AdminClassStudentWork } from '@/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-student-work';
import { MockResultBehavior } from '@/app/(authed-mock-result)/mock/result/mock-result-behavior';
import { ListeningTestsBehavior } from '@/app/(authed-listening)/listening/tests/listening-tests-behavior';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('sitting=s1') }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('self-check submission has completion, review action and no score metrics', () => {
  const view = render(<ResultView result={{ score: null, max_score: 0, score_mode: 'self_check_only', self_check_count: 2,
    per_question: [1, 2].map((q_num) => ({ q_num, self_check: true, correct: null })),
    section_breakdown: { s1: { total: 0, correct: 0 } } }}
    attempt={{ attempt_id: 'a1', started_at: '' }} test={{ id: 't1', title: 'Self-check' }} from={null} sittingId={null} />);
  expect(screen.getByText('Không chấm điểm')).toBeTruthy();
  expect(screen.getByText('Đã hoàn thành · 2 câu tự đối chiếu')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Đối chiếu đáp án' }).getAttribute('href')).toContain('attempt_id=a1');
  for (const label of ['Correct', 'Accuracy', 'Incorrect', 'Unanswered']) expect(screen.queryByText(label, { exact: true })).toBeNull();
  expect(view.container.textContent).not.toMatch(/0\/0|0\/40|<4.0/);
});

it.each([{ max: 36, checks: 4 }, { max: 12, checks: 0 }])('mixed/short submission suppresses band even from historical payload: $max', ({ max, checks }) => {
  const view = render(<ResultView result={{ score: max, max_score: max, self_check_count: checks,
    score_mode: checks ? 'mixed' : 'scored', band_estimate: 8,
    per_question: Array.from({ length: max + checks }, (_, i) => ({ q_num: i + 1, self_check: i >= max, correct: i < max })) }}
    attempt={null} test={{ id: 't1', title: 'Mixed' }} from={null} sittingId={null} />);
  expect(screen.getByText(checks ? 'Không quy đổi band · 4 câu tự đối chiếu' : 'Không quy đổi band')).toBeTruthy();
  expect(view.container.querySelector('.exam-result-metrics')?.textContent).toContain(`${max}/${max}`);
  expect(screen.queryByText('8.0', { exact: true })).toBeNull();
});

it('teacher reads the same self-check label immediately and after reload', async () => {
  Object.defineProperty(window, 'api', { configurable: true, value: { get: vi.fn(async () => ({
    student: { id: 's1', name: 'Learner', activated: true }, items: [{ assignment_id: 'a1', title: 'Listening',
      skill: 'listening', status: 'submitted', score: null, score_mode: 'self_check_only', max_score: 0, self_check_count: 2 }],
  })) } });
  for (let load = 0; load < 2; load += 1) {
    const view = render(<AdminClassStudentWork cohortId="c1" subject={{ student_id: 's1', name: 'Learner', student_code: null, user_id: 'u1' }} onClose={() => {}} onOpenAssignment={() => {}} />);
    expect(await screen.findByText('Đã nộp · tự đối chiếu')).toBeTruthy();
    view.unmount();
  }
});

it('catalog uses the best attempt denominator and distinguishes self-check completion', async () => {
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith: vi.fn(async () => ({ items: [
    { id: 'self', title: 'Self', score_mode: 'self_check_only', max_score: 0, user_best_score: null, user_submitted_attempt_count: 1 },
    { id: 'mixed', title: 'Mixed', score_mode: 'mixed', max_score: 36, user_best_score: 36, user_submitted_attempt_count: 1 },
  ] })) } });
  const view = render(<ListeningTestsBehavior />);
  expect(await screen.findByText('Đã làm · Tự đối chiếu')).toBeTruthy();
  expect(screen.getByText('36/36')).toBeTruthy();
  expect(view.container.textContent).not.toContain('/40');
});

it('catalog shows known paper size before submission without inventing a score denominator', async () => {
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith: vi.fn(async () => ({ items: [
    { id: 'draft', title: 'Draft', source_item_count: 40, user_best_score: null,
      user_attempt_count: 2, user_submitted_attempt_count: 0 },
    { id: 'mixed', title: 'Mixed', source_item_count: 40, max_score: 36, score_mode: 'mixed',
      user_best_score: 36, user_submitted_attempt_count: 1 },
    { id: 'unknown', title: 'Unknown', user_submitted_attempt_count: 0 },
  ] })) } });
  const view = render(<ListeningTestsBehavior />);
  await screen.findByText('Draft');
  const draft = view.container.querySelector('[data-test-id="draft"]')!;
  expect(draft.querySelector('.lt-card-facts')?.textContent).toContain('40 câu');
  expect(draft.getAttribute('data-status')).toBe('new');
  expect(draft.querySelector('.lt-card-stats')?.textContent).not.toContain('/40');
  const mixed = view.container.querySelector('[data-test-id="mixed"]')!;
  expect(mixed.querySelector('.lt-card-facts')?.textContent).toContain('40 câu');
  expect(mixed.querySelector('.lt-card-stats')?.textContent).toContain('36/36');
  expect(mixed.querySelector('.lt-card-stats')?.textContent).not.toContain('/40');
  expect(view.container.querySelector('[data-test-id="unknown"] .lt-card-facts')?.textContent).not.toContain('câu');
});

it.each(['self_check_only', 'mixed_no_band'])('mock gap explains %s without the /40 fallback', async (state) => {
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith: vi.fn(async () => ({
    final_bands: {}, lr_skills: [{ skill: 'listening', state, score: state === 'self_check_only' ? null : 36,
      max: state === 'self_check_only' ? 0 : 36, self_check_count: state === 'self_check_only' ? 40 : 4 }],
  })) } });
  const view = render(<MockResultBehavior />);
  expect(await screen.findByText(state === 'self_check_only' ? 'Listening — Tự đối chiếu: đề này không tính band' : 'Listening — Không quy đổi band · 4 câu tự đối chiếu')).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/0\/40|36\/40|dưới mức thấp nhất/);
});
