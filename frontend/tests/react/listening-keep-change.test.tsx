import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';
import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'synthetic-owner' } }) }));

let get: ReturnType<typeof vi.fn>;
let getWith: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
const paper = { id: 'synthetic-kc', title: 'Contact check', test_type: 'mini', audio_url: 'https://audio.fixture.test/contact.wav',
  sections: [{ section_num: 1, exercises: [{ id: 'kc-ex', exercise_type: 'dictation', payload: {
    template_kind: 'keep_change', variant: 'keep_change',
    questions: [{ q_num: 1, printed_value: 'Cedar Avenue.' }, { q_num: 2, printed_value: 'Northfield ZX4 8QP' }],
    answers: [{ q_num: 2, answer: 'PRIVATE_CORRECTION' }], solutions: { 2: { why_correct: 'PRIVATE_RATIONALE' } },
  } }] }] };

beforeEach(() => {
  get = vi.fn(); getWith = vi.fn(); post = vi.fn(); patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith, post, patch } });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag: vi.fn(), mountSurvey: vi.fn() } });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

it('shows printed values, requires correction for CHANGE and clears/disables text for KEEP', async () => {
  window.history.replaceState(null, '', '/listening/test/session?id=synthetic-kc&admin_preview=1');
  get.mockResolvedValue(paper);
  const view = render(<ListeningTestSession />);
  const input = await screen.findByRole('textbox', { name: 'Corrected value — Question 2' }) as HTMLInputElement;
  expect(input.disabled).toBe(true);
  expect(screen.getByRole('group', { name: /2 Northfield ZX4 8QP/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'CHANGE — Question 2' }));
  expect(input.disabled).toBe(false); expect(input.required).toBe(true);
  fireEvent.change(input, { target: { value: 'Westfield ' } });
  expect(input.value).toBe('Westfield ');
  fireEvent.change(input, { target: { value: 'Westfield ZX4 9QP' } });
  expect(input.value).toBe('Westfield ZX4 9QP');
  fireEvent.click(screen.getByRole('radio', { name: 'KEEP — Question 2' }));
  expect(input.value).toBe(''); expect(input.disabled).toBe(true); expect(input.required).toBe(false);
  fireEvent.click(screen.getByRole('radio', { name: 'CHANGE — Question 2' }));
  expect(input.value).toBe('');
  expect(view.container.textContent).not.toContain('PRIVATE_CORRECTION');
  expect(view.container.textContent).not.toContain('PRIVATE_RATIONALE');
  expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
});

it('reviews printed values, chosen answer, expected text and Vietnamese explanation with canonical verdict', async () => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=synthetic-kc');
  getWith.mockResolvedValue({ attempt_id: 'synthetic-kc', status: 'submitted', title: 'Contact check', score: 0, max_score: 1,
    sections: [{ section_num: 1, title: 'Part 1', transcript: '' }], review: [{ q_num: 2, question_type: 'keep_change', correct: false,
      printed_value: 'Northfield ZX4 8QP', user_answer: 'CHANGE: 8QP', expected: 'Westfield ZX4 9QP',
      solution: { why_correct: 'Người nói sửa mã bưu điện thành 9QP.' } }] });
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 2 — sai' });
  const card = view.container.querySelector('#listening-review-q-2') as HTMLElement;
  expect(within(card).getByText('Northfield ZX4 8QP')).toBeTruthy();
  expect(within(card).getByText('CHANGE: 8QP')).toBeTruthy();
  expect(within(card).getByText('Westfield ZX4 9QP')).toBeTruthy();
  expect(card.textContent).toContain('✗ Sai');
  expect(card.textContent).toContain('Người nói sửa mã bưu điện thành 9QP.');
});

it('keeps printed values and reference alternatives on a neutral self-check review card', async () => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=synthetic-kc');
  getWith.mockResolvedValue({ attempt_id: 'synthetic-kc', status: 'submitted', title: 'Contact check', score: 0, max_score: 0,
    sections: [{ section_num: 1, title: 'Part 1', transcript: '' }], review: [{ q_num: 2, question_type: 'keep_change',
      self_check: true, correct: null, printed_value: 'Northfield ZX4 8QP', user_answer: 'CHANGE: 9QP',
      expected: 'Westfield ZX4 9QP', alternatives: ['ZX4 9QP', '9QP'],
      solution: { why_correct: 'Người nói sửa mã bưu điện thành 9QP.' } }] });
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 2 — Tự đối chiếu' });
  const card = view.container.querySelector('#listening-review-q-2') as HTMLElement;
  expect(within(card).getByText('Northfield ZX4 8QP')).toBeTruthy();
  expect(within(card).getByText('CHANGE: 9QP')).toBeTruthy();
  expect(within(card).getByText('Westfield ZX4 9QP')).toBeTruthy();
  expect(card.textContent).toContain('Đáp án tham khảo:');
  expect(card.textContent).toContain('ZX4 9QP / 9QP');
  expect(card.textContent).toContain('Người nói sửa mã bưu điện thành 9QP.');
  expect(card.hasAttribute('data-correct')).toBe(false);
});

it('legacy claimed attempts restore KEEP/CHANGE and save the same string contract', () => {
  vi.useFakeTimers();
  const source = readFileSync(resolve(process.cwd(), 'public/js/listening-test-player.js'), 'utf8');
  const hooks = new Function('window', 'document', `${source}\nreturn { renderKeepChange, attachQuestionHandlers, restoreAnswersIntoPaper, STATE };`)(window, document);
  document.body.innerHTML = hooks.renderKeepChange(paper.sections[0].exercises[0].payload.questions);
  hooks.STATE.totalQuestions = 2;
  hooks.STATE.answers.set(2, 'CHANGE: Westfield ZX4 9QP');
  hooks.attachQuestionHandlers(); hooks.restoreAnswersIntoPaper();
  const input = screen.getByRole('textbox', { name: 'Corrected value — Question 2' }) as HTMLInputElement;
  expect(input.value).toBe('Westfield ZX4 9QP'); expect(input.disabled).toBe(false);
  fireEvent.click(screen.getByRole('radio', { name: 'KEEP — Question 2' }));
  expect(hooks.STATE.answers.get(2)).toBe('KEEP'); expect(input.value).toBe(''); expect(input.disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'CHANGE — Question 2' }));
  fireEvent.input(input, { target: { value: '9QP' } });
  expect(hooks.STATE.answers.get(2)).toBe('CHANGE: 9QP'); expect(input.required).toBe(true);
  vi.clearAllTimers(); document.body.innerHTML = '';
});
