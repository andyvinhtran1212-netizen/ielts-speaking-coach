import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProgrammeResult } from '@/app/(authed-listening-review)/listening/programmes/result/[attemptId]/programme-result';
import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';
import native from '../fixtures/listening-source-multi-gap.json';
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'native-learner' } }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
const reversed = (fields: Array<{ field_id: string }>, prefix: string) => Object.fromEntries([...fields].reverse().map((f) => [f.field_id, `${prefix}-${f.field_id}`]));
const labelled = (fields: Array<{ field_id: string; prompt: string }>, values: Record<string, unknown>) => fields.map((f) => `${f.prompt}: ${typeof values[f.field_id] === 'string' && values[f.field_id] ? values[f.field_id] : '—'}`).join(' · ');
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('crypto', { randomUUID: () => 'native-claim' });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1; });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  Object.assign(window, { api: { getWith: vi.fn(), postWith: vi.fn(), patchWith: vi.fn(async () => ({})) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('labels all12 canonical positions /25 fields identically in submitted first, final and structured references', async () => {
  window.api.getWith = vi.fn(async () => ({ programme_id: 'ielts-80-days-listening', scoring_policy: 'report_only', title: 'Native multi-gap result', replay_policy: 'allowed', audio_granularity: 'whole_day', audio_url: '/native.mp3', result_summary: { item_count: 12 }, review: native.questions.map((q, index) => ({ q_num: index + 1, source_item_id: q.source_item_id, source_display_number: q.source_display_number, question_type: 'multi_gap_completion', state: 'unscored', prompt: q.prompt, fields: q.fields, first_answer: JSON.stringify(reversed(q.fields, 'FIRST')), user_answer: JSON.stringify(reversed(q.fields, 'FINAL')), audio_window: null, explanation: { answer: Object.fromEntries(Object.entries(q.reference_answer).reverse()), why_vi: 'Native reviewed reference', evidence: [] } })) }));
  render(<ProgrammeResult attemptId="native-attempt" />); await screen.findByRole('heading', { name: 'Native multi-gap result' });
  const articles = document.querySelectorAll('.programme-review-item'); expect(articles).toHaveLength(12);
  native.questions.forEach((q, index) => {
    const article = articles[index]; expect(article.querySelector('.programme-review-item__first')?.textContent).toContain(labelled(q.fields, reversed(q.fields, 'FIRST')));
    expect(article.querySelector('.programme-review-item__answer')?.textContent).toContain(labelled(q.fields, reversed(q.fields, 'FINAL')));
    expect(within(article as HTMLElement).getByText('Đáp án tham khảo:').parentElement?.textContent).toContain(labelled(q.fields, q.reference_answer));
  });
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});

it('submitted malformed/missing/unknown multi-gap values keep empty canonical labels instead of shifted fields', async () => {
  const q = native.questions[0]; const first = { unknown: 'DO_NOT_SHIFT', [q.fields[1].field_id]: 'third' };
  window.api.getWith = vi.fn(async () => ({ programme_id: 'ielts-80-days-listening', scoring_policy: 'report_only', title: 'Damaged multi-gap result', result_summary: {}, review: [{ q_num: 1, state: 'unscored', prompt: q.prompt, question_type: 'multi_gap_completion', fields: q.fields, first_answer: JSON.stringify(first), user_answer: '{', audio_window: null, explanation: { answer: first, why_vi: 'No guessed order', evidence: [] } }] }));
  render(<ProgrammeResult attemptId="damaged-native-attempt" />); await screen.findByText('Damaged multi-gap result');
  expect(document.querySelector('.programme-review-item__first')?.textContent).toContain(labelled(q.fields, first));
  expect(document.querySelector('.programme-review-item__answer')?.textContent).toContain(labelled(q.fields, {}));
  expect(screen.queryByText(/DO_NOT_SHIFT/)).toBeNull(); expect(screen.queryByText(/Chỗ trống 1/)).toBeNull();
});

it('guided save/reveal uses the same native three-field labels and immutable first answer when revised', async () => {
  const q = native.questions.find((item) => item.day === 9 && item.source_display_number === '14')!;
  const first = reversed(q.fields, 'FIRST'); const revised = reversed(q.fields, 'REVISED');
  const feedback = { q_num: 1, source_item_id: q.source_item_id, source_display_number: q.source_display_number, question_type: 'multi_gap_completion', fields: q.fields, state: 'unscored', correct: null, first_answer: JSON.stringify(first), explanation: { answer: Object.fromEntries(Object.entries(q.reference_answer).reverse()), why_vi: 'Native guided reference', evidence: [] }, reference_answers: [] };
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state') ? { items: [] } : { title: 'Native three blanks', programme_id: 'ielts-80-days-listening', source_day: q.day, replay_policy: 'allowed', scoring_policy: 'report_only', audio_url: '/day09.mp3', source_blocks: [], sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: [{ ...q, q_num: 1, options: {} }] } }] }] });
  window.api.postWith = vi.fn(async (url: string) => url.endsWith('/reveal') ? { items: [feedback] } : { attempt_id: 'native-guided', answers: [{ q_num: 1, user_answer: JSON.stringify(first) }] });
  render(<ProgrammeFormRunner testId="native-three-field-form" />);
  for (const field of q.fields) { const input = await screen.findByRole('textbox', { name: new RegExp(field.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }); expect((input as HTMLInputElement).value).toBe(first[field.field_id]); }
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu câu này' }));
  await screen.findByText('Native guided reference');
  expect(screen.getByText(labelled(q.fields, first))).toBeTruthy();
  expect(screen.getByText('Đáp án tham khảo:').parentElement?.textContent).toContain(labelled(q.fields, q.reference_answer));
  for (const field of q.fields) { const input = screen.getByRole('textbox', { name: new RegExp(field.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }); fireEvent.change(input, { target: { value: revised[field.field_id] } }); fireEvent.blur(input); }
  await waitFor(() => expect(window.api.patchWith).toHaveBeenCalled());
  expect(screen.getByText(labelled(q.fields, first))).toBeTruthy(); expect(screen.getByText(labelled(q.fields, revised))).toBeTruthy();
  expect(window.api.postWith).toHaveBeenCalledWith('/api/listening/tests/attempts/native-guided/questions/1/reveal', {}, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
