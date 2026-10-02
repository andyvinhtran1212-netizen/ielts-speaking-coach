import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadingExamSession } from '@/app/(authed-reading-player)/reading/exam/session/reading-exam-session';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'admin-fixture', email: 'fixture@example.test' } }),
}));

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
const letters = (last: string) => Array.from({ length: last.charCodeAt(0) - 64 }, (_, index) => String.fromCharCode(65 + index));
const sourceInstruction = 'Reading Passage 2 has 7 paragraphs, A-G. Which paragraph contains the following information? Write the correct letter, A-G. NB You may use any letter more than once.';

function paper(payload: Record<string, unknown>) {
  return {
    test_id: 'authored-reading-fixture', title: 'Authored Reading fixture', time_limit_minutes: 60,
    total_questions: 2,
    passages: [{ passage_order: 2, title: 'Passage fixture', body_markdown: 'A Fixture paragraph.' }],
    questions: [14, 15].map((q_num) => ({
      q_num, passage_order: 2, question_type: 'matching_information', prompt: `Statement ${q_num}`,
      payload: { solution: 'DO_NOT_RENDER_OR_INFER_LABELS', ...payload },
    })),
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/reading/exam/session?test_id=authored-reading-fixture&admin_preview=1');
  get = vi.fn(); post = vi.fn(); patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith: vi.fn(), post, patch } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('source-authored Reading controls in the native player', () => {
  it.each(['F', 'G', 'I', 'J'])('renders exactly the authored A-%s paragraph bank and retains a selected answer', async (last) => {
    get.mockResolvedValue(paper({ template: { paragraph_labels: letters(last) } }));
    render(<ReadingExamSession />);
    const control = await screen.findByRole('combobox', { name: 'Answer 14' });
    expect(within(control).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', ...letters(last)]);
    fireEvent.change(control, { target: { value: last } });
    expect((control as HTMLSelectElement).value).toBe(last);
    expect(screen.queryByText('DO_NOT_RENDER_OR_INFER_LABELS')).toBeNull();
    expect(get).toHaveBeenCalledWith('/admin/reading/content/tests/authored-reading-fixture');
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it('uses explicit option labels when a paragraph template is absent, while retaining repeated answers', async () => {
    get.mockResolvedValue(paper({ options: letters('I').map((label) => ({ label, text: `Paragraph ${label}` })) }));
    render(<ReadingExamSession />);
    const first = await screen.findByRole('combobox', { name: 'Answer 14' });
    const second = screen.getByRole('combobox', { name: 'Answer 15' });
    expect(within(first).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', ...letters('I')]);
    fireEvent.change(first, { target: { value: 'I' } }); fireEvent.change(second, { target: { value: 'I' } });
    expect((first as HTMLSelectElement).value).toBe('I'); expect((second as HTMLSelectElement).value).toBe('I');
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it('prioritizes paragraph labels over unrelated option text and preserves the existing legacy fallback', async () => {
    get.mockResolvedValue(paper({ options: ['UNRELATED'], template: { paragraph_labels: letters('F') } }));
    const view = render(<ReadingExamSession />);
    const first = await screen.findByRole('combobox', { name: 'Answer 14' });
    expect(within(first).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', ...letters('F')]);
    view.unmount(); get.mockResolvedValue(paper({}));
    render(<ReadingExamSession />);
    const legacy = await screen.findByRole('combobox', { name: 'Answer 14' });
    expect(within(legacy).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', ...letters('H')]);
  });

  it('shows the complete authored reuse instruction as text without rendering hidden solutions or markup', async () => {
    get.mockResolvedValue(paper({ instruction: `  ${sourceInstruction} <img src=x onerror=alert(1)>  `, template: { paragraph_labels: letters('G') } }));
    const view = render(<ReadingExamSession />);
    await screen.findByRole('combobox', { name: 'Answer 14' });
    const instruction = view.container.querySelector('.exam-questions__instructions--type');
    expect(instruction?.textContent).toBe(`Questions 14–15: ${sourceInstruction} <img src=x onerror=alert(1)>`);
    expect(instruction?.querySelector('img')).toBeNull();
    expect(screen.queryByText('DO_NOT_RENDER_OR_INFER_LABELS')).toBeNull();
  });
});
