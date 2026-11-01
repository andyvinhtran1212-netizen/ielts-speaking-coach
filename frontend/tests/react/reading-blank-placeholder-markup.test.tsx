import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingExamSession } from '@/app/(authed-reading-player)/reading/exam/session/reading-exam-session';
import { ReadingReviewWorkspace } from '@/app/(reading-review)/reading/review/reading-review-workspace';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'admin-fixture', email: 'fixture@example.test' } }) }));

// Staging ILR-RDG-CAM-B15-T1 Q19–22 summary_text, read 2026-10-29 (job PC-J112
// dump): Q21 keeps the printed underscore run after its marker (RV-05).
const B15_T1_SUMMARY = [
  'Complete the summary using words from the passage. Limit: NO MORE THAN TWO WORDS.',
  'Figures from the Transport Research Laboratory indicate that most motor accidents',
  'are partly due to {{19}} , so the introduction of driverless vehicles',
  'will result in greater safety. In addition to the direct benefits of automation, it may bring',
  'other advantages. For example, schemes for {{20}} will be more',
  'workable, especially in towns and cities, resulting in fewer cars on the road.',
  'According to the University of Michigan Transportation Research Institute, there could',
  'be a 43 percent drop in {{21}} ________ of cars. However, this would mean',
  'that the yearly {{22}} of each car would, on average, be twice as',
  'high as it currently is. This would lead to a higher turnover of vehicles, and therefore no',
  'reduction in automotive manufacturing.',
].join('\n');

// Staging ILR-RDG-CAM-B21-T4 Q8 prompt (T-DIAG): the whole flow chart, a
// markdown image and every marker live in a single diagram row prompt.
const B21_T4_Q8_PROMPT = [
  'Complete the flow chart using words from the passage. Limit: NO MORE THAN TWO WORDS.',
  '![Sơ đồ tiến trình — Generating biogas for domestic use in Dunga (Câu 8–10)](assets/cambridge_ielts_21_test_4_reading_q8-10_flowchart.png)',
  'Generating biogas for domestic use in Dunga',
  'First, place water hyacinth together with some',
  '{{8}} into a digester',
  'Leave the mixture until the {{9}} is completed',
  'Capture the gas emitted by the digester and',
  'use {{10}} ____ to transport it to individual homes',
  '',
  '![Sơ đồ tiến trình — Generating biogas for domestic use in Dunga (Câu 8–10)](assets/cambridge_ielts_21_test_4_reading_q8-10_flowchart.png)',
].join('\n');

let get: ReturnType<typeof vi.fn>;
let getWith: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  get = vi.fn(); getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith, post: vi.fn(), patch: vi.fn() } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag: vi.fn(), mountSurvey: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

function previewPaper(questions: unknown[]) {
  return { test_id: 'b15-t1-fixture', title: 'Placeholder fixture', time_limit_minutes: 60, total_questions: questions.length,
    passages: [{ passage_order: 2, title: 'Passage', body_markdown: 'Passage body.' }], questions };
}

it('Reading player renders B15-T1 {{21}} ________ as one answer gap with no extra blank', async () => {
  window.history.replaceState(null, '', '/reading/exam/session?test_id=b15-t1-fixture&admin_preview=1');
  const questions = [19, 20, 21, 22].map((q_num) => ({ q_num, passage_order: 2, question_type: 'summary_completion', prompt: B15_T1_SUMMARY,
    payload: q_num === 19 ? { template: { summary_text: B15_T1_SUMMARY } } : {} }));
  const fixture = previewPaper(questions);
  const original = JSON.stringify(fixture);
  get.mockResolvedValue(fixture);
  const view = render(<ReadingExamSession />);
  const gap = await screen.findByRole('textbox', { name: 'Answer 21' });
  const prose = view.container.querySelector('.exam-summary__prose') as HTMLElement;
  expect(prose.querySelectorAll('.reading-next-flow-gap')).toHaveLength(4);
  expect(prose.textContent).not.toMatch(/_{3,}/);
  expect(prose.textContent).not.toMatch(/\{\{\s*\d+\s*\}\}/);
  const slot = gap.closest('.reading-next-flow-gap') as HTMLElement;
  expect(slot.previousSibling?.textContent?.endsWith('be a 43 percent drop in ')).toBe(true);
  expect(slot.nextSibling?.textContent?.startsWith(' of cars. However')).toBe(true);
  expect(JSON.stringify(fixture)).toBe(original);
});

it('Reading review shows B15-T1 Q21 as one blank in both the prompt and the authored context', async () => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=b15-t1-review');
  const fixture = {
    status: 'submitted', attempt_id: 'b15-t1-review', test_id: 'ILR-RDG-CAM-B15-T1', title: 'B15-T1 review',
    score: 0, max_score: 1, skill_breakdown: {}, context_source: { provenance: 'submission_snapshot', possibly_changed: false },
    passages: [{ passage_order: 2, title: 'Driverless cars', body_markdown: 'Passage body.' }],
    review: [{ q_num: 21, passage_order: 2, correct: false, user_answer: '', expected: 'ownership', question_type: 'summary_completion',
      prompt: B15_T1_SUMMARY, question_context: { template: { summary_text: B15_T1_SUMMARY } } }],
  };
  const original = JSON.stringify(fixture);
  getWith.mockResolvedValue(fixture);
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText(fixture.title);
  fireEvent.click(screen.getByRole('button', { name: 'Câu 21 — bỏ trống', exact: true }));
  const card = view.container.querySelector('#reading-review-q-21') as HTMLElement;
  expect(card.textContent).toContain('be a 43 percent drop in ____ of cars.');
  expect(card.textContent).not.toMatch(/_{3,}\s+_{3,}/);
  expect(card.textContent).not.toMatch(/\{\{\s*\d+\s*\}\}/);
  const context = within(view.container.querySelector('.review-question-context') as HTMLElement);
  const blank = context.getByLabelText('Chỗ trống câu 21');
  expect(blank.textContent).toBe('[Câu 21] ______');
  expect(blank.nextSibling?.textContent?.startsWith(' of cars.')).toBe(true);
  expect(JSON.stringify(fixture)).toBe(original);
});

it.each([
  { label: 'B21-T4 Q8 flow chart', type: 'flow_chart_completion', prompt: B21_T4_Q8_PROMPT },
  { label: 'image only', type: 'diagram_label_completion', prompt: '![Diagram](assets/q1.png)' },
  { label: 'spaced marker', type: 'diagram_label_completion', prompt: 'Label {{ 8 }}___ and ![x](y)' },
])('DiagramImageRun never prints markdown images or {{n}} markers ($label)', async ({ type, prompt }) => {
  window.history.replaceState(null, '', '/reading/exam/session?test_id=b15-t1-fixture&admin_preview=1');
  const questions = [8, 9, 10].map((q_num) => ({ q_num, passage_order: 2, question_type: type, prompt,
    payload: { image_url: 'https://fixture.test/flowchart.png' } }));
  get.mockResolvedValue(previewPaper(questions));
  const view = render(<ReadingExamSession />);
  await screen.findByRole('textbox', { name: 'Answer 8' });
  const prompts = [...view.container.querySelectorAll('.exam-diagram-row__prompt')].map((node) => node.textContent || '');
  expect(prompts).toHaveLength(3);
  for (const text of prompts) {
    expect(text).not.toContain('![');
    expect(text).not.toMatch(/\{\{\s*\d+\s*\}\}/);
    expect(text).not.toMatch(/\]\(/);
  }
  if (type === 'flow_chart_completion') {
    expect(prompts[0]).toContain('(8) ______ into a digester');
    expect(prompts[0]).toContain('use (10) ______ to transport it');
    expect(prompts[0]).toContain('Generating biogas for domestic use in Dunga');
  }
  expect(view.container.querySelectorAll('img.exam-diagram-image')).toHaveLength(1);
});
