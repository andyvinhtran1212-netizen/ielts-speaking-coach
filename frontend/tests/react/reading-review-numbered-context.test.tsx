import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingReviewWorkspace } from '@/app/(reading-review)/reading/review/reading-review-workspace';
import contexts from '../fixtures/reading-mock-repair-contexts.json';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }) }));

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

it.each([true, false])('keeps the actual C13 R1 source table, options, translation and solution in review (preview=%s)', async (preview) => {
  const source = contexts.cases.find(item => item.revised_uuid === '6c8922a4-1a9e-47f2-9505-c3f9429a8a5a')!;
  window.history.replaceState(null, '', preview ? `/reading/review?admin_test_id=${source.revised_uuid}` : '/reading/review?attempt_id=numbered-context');
  const fixture = {
    preview, status: 'submitted', attempt_id: preview ? null : 'numbered-context', test_id: source.test_id, title: 'Numbered C13 R1 review',
    score: preview ? null : 0, max_score: 1, context_source: { provenance: 'submission_snapshot', possibly_changed: false }, skill_breakdown: {},
    passages: [{ passage_order: 1, title: 'New Zealand tourism', body_markdown: 'Original source passage.', translation_vi: 'Bản dịch nguồn vẫn được giữ.' }],
    review: [{ q_num: 1, passage_order: 1, correct: false, question_type: 'table_completion', prompt: '(see summary above)', expected: 'update', user_answer: '',
      question_context: { ...source.context, options: [{ label: 'A', text: 'Authored display bank' }] },
      solution: { question_text: 'Allowed businesses to 1 ____ information regularly.', steps: 'Định vị thông tin trong bảng.', source_excerpt: 'Businesses were able to update the details they gave on a regular basis.' },
    }],
  };
  const original = JSON.stringify(fixture);
  getWith.mockResolvedValue(fixture);
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText(fixture.title);
  fireEvent.click(screen.getByRole('button', { name: preview ? 'Câu 1 — xem trước' : 'Câu 1 — bỏ trống', exact: true }));
  const context = within(view.container.querySelector('.review-question-context') as HTMLElement);
  expect(context.getByRole('table')).toBeTruthy();
  expect(context.getAllByLabelText('Chỗ trống câu 1')).toHaveLength(1);
  expect(context.getByText('Authored display bank')).toBeTruthy();
  expect(view.container.textContent).not.toMatch(/\{\{\s*\d+\s*\}\}/);
  expect(screen.getByText('Định vị thông tin trong bảng.')).toBeTruthy();
  expect(screen.getByText('Businesses were able to update the details they gave on a regular basis.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Bài dịch', exact: true }));
  await screen.findByText('Bản dịch nguồn vẫn được giữ.');
  expect(JSON.stringify(fixture)).toBe(original);
  expect(post).not.toHaveBeenCalled();
});
