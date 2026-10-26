import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadingExamSession } from '@/app/(authed-reading-player)/reading/exam/session/reading-exam-session';
import c20EndingStems from '../fixtures/reading-c20-matching-ending-stems.json';
import c21People from '../fixtures/reading-c21-t1-people.json';

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
  it.each([
    {
      q_num: 10, question_type: 'true_false_not_given',
      prompt: "Hugh Blaker opposed the Davies sisters' decision to buy art by French Impressionists.",
      payload: {}, label: 'True / False / Not Given',
    },
    {
      q_num: 16, question_type: 'matching_information',
      prompt: 'a description of physiological changes in our bodies when we hear sudden noises',
      payload: {
        instruction: 'Reading Passage 2 has 7 sections, A-G. Which section contains the following information? Write the correct letter, A-G.',
        template: { paragraph_labels: letters('G') },
      }, label: 'Matching Information',
    },
  ])('renders C21 T1 Q$q_num without a per-question type label, preserving its prompt and controls', async ({ label, ...question }) => {
    const fixture = { ...paper({}), total_questions: 1, questions: [{ ...question, passage_order: 2 }] };
    const original = JSON.stringify(fixture);
    get.mockResolvedValue(fixture);
    const view = render(<ReadingExamSession />);
    expect(await screen.findByText(question.prompt, { exact: true })).toBeTruthy();
    expect(screen.queryByText(label, { exact: true })).toBeNull();
    const card = view.container.querySelector(`#q-${question.q_num}`)!;
    expect(card.querySelector('.exam-q__body')?.firstElementChild?.textContent).toBe(question.prompt);
    expect(card.querySelector('.exam-q__num')?.textContent).toBe(String(question.q_num));
    expect(card.querySelector('.exam-q__type')).toBeNull();
    const instruction = view.container.querySelector('.exam-questions__instructions--type');
    if (question.question_type === 'true_false_not_given') {
      expect(instruction?.textContent).toContain('Do the following statements agree with the information');
      expect(within(card as HTMLElement).getAllByRole('radio').map(el => el.getAttribute('value'))).toEqual(['TRUE', 'FALSE', 'NOT GIVEN']);
      const answer = within(card as HTMLElement).getByRole('radio', { name: 'FALSE', exact: true });
      fireEvent.click(answer);
      expect((answer as HTMLInputElement).checked).toBe(true);
    } else {
      expect(instruction?.textContent).toContain(question.payload.instruction);
      const answer = screen.getByRole('combobox', { name: 'Answer 16' });
      expect(within(answer).getAllByRole('option').map(el => el.getAttribute('value'))).toEqual(['', ...letters('G')]);
      fireEvent.change(answer, { target: { value: 'A' } });
      expect((answer as HTMLSelectElement).value).toBe('A');
    }
    fireEvent.click(screen.getByRole('button', { name: `Mark question ${question.q_num} for review` }));
    expect(screen.getByRole('button', { name: `Mark question ${question.q_num} for review` }).getAttribute('aria-pressed')).toBe('true');
    expect(JSON.stringify(fixture)).toBe(original);
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it('shows the C21 T1 authored People bank and singular-person rubric while allowing letter reuse', async () => {
    const fixture = { ...paper({}), questions: c21People.questions };
    const original = JSON.stringify(fixture);
    get.mockResolvedValue(fixture);
    render(<ReadingExamSession />);
    const bank = await screen.findByRole('complementary', { name: 'List of People' });
    expect(within(bank).getByText('List of People')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'List of Features' })).toBeNull();
    expect(screen.getByText(/Match each statement with the correct person, A, B, C, or D/)).toBeTruthy();
    expect(screen.getByText(/NB You may use any letter more than once/)).toBeTruthy();
    const first = screen.getByRole('radio', { name: 'Question 22: C' });
    const last = screen.getByRole('radio', { name: 'Question 26: C' });
    fireEvent.click(first); fireEvent.click(last);
    expect((first as HTMLInputElement).checked).toBe(true);
    expect((last as HTMLInputElement).checked).toBe(true);
    expect(within(bank).getAllByRole('listitem')).toHaveLength(4);
    expect(JSON.stringify(fixture)).toBe(original);
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it('keeps the original C20 T1 Q31–35 sentence beginnings visible beside their dropdowns', async () => {
    const fixture = paper({});
    fixture.passages[0].passage_order = 3;
    fixture.questions = c20EndingStems.questions.map(question => ({
      ...fixture.questions[0], ...question, passage_order: 3,
    }));
    const original = JSON.stringify(fixture);
    get.mockResolvedValue(fixture);
    render(<ReadingExamSession />);
    const first = await screen.findByRole('combobox', { name: 'Answer 31' });
    for (const question of c20EndingStems.questions) {
      expect(screen.getByText(question.prompt, { exact: true })).toBeTruthy();
      expect(screen.getByRole('combobox', { name: `Answer ${question.q_num}` })).toBeTruthy();
    }
    fireEvent.change(first, { target: { value: 'G' } });
    expect((first as HTMLSelectElement).value).toBe('G');
    expect(JSON.stringify(fixture)).toBe(original);
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it('keeps each matching radio visibly labelled with its exact authored value when column headers scroll away', async () => {
    const options = [{ label: 'A', text: 'Researcher one' }, { label: 'F', text: 'Researcher six' }];
    const fixture = paper({ options });
    fixture.questions = fixture.questions.map(q => ({ ...q, question_type: 'matching_features' }));
    const original = JSON.stringify(fixture);
    get.mockResolvedValue(fixture);
    const view = render(<ReadingExamSession />);
    const first = await screen.findByRole('radio', { name: 'Question 14: A' });
    const last = screen.getByRole('radio', { name: 'Question 14: F' });
    expect(first.closest('label')?.textContent).toBe('A');
    expect(last.closest('label')?.textContent).toBe('F'); // Do not relabel this as the second alphabetical value.
    expect(view.container.querySelectorAll('.exam-features-box__item')).toHaveLength(2);
    expect(screen.getByRole('complementary', { name: 'List of Features' })).toBeTruthy();
    fireEvent.click(last);
    expect((last as HTMLInputElement).checked).toBe(true);
    expect((last as HTMLInputElement).value).toBe('F');
    expect((first as HTMLInputElement).checked).toBe(false);
    expect(JSON.stringify(fixture)).toBe(original);
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });
  it.each(['sentence_completion', 'summary_completion', 'notes_completion', 'table_completion',
    'form_completion', 'flow_chart_completion', 'diagram_label_completion'])(
    'renders authored %s text once around each controlled gap', async (question_type) => {
      const fixture = paper({ template: { summary_text: 'Water moves through {{14}} toward {{15}}.' } });
      fixture.questions = fixture.questions.map(q => ({ ...q, question_type,
        prompt: q.q_num === 14 ? 'Water moves through ____.' : 'The channel runs toward ____.' }));
      get.mockResolvedValue(fixture);
      const view = render(<ReadingExamSession />);
      const first = await screen.findByRole('textbox', { name: 'Answer 14' });
      const second = screen.getByRole('textbox', { name: 'Answer 15' });
      const template = view.container.querySelector('[data-question-type]');
      expect(template?.textContent?.match(/Water moves through/g)).toHaveLength(1);
      expect(template?.textContent).not.toContain('The channel runs');
      expect(template?.querySelector('.exam-q__prompt')).toBeNull();
      expect(template?.querySelectorAll('input')).toHaveLength(2);
      fireEvent.change(first, { target: { value: 'arches' } });
      fireEvent.change(second, { target: { value: 'Rome' } });
      expect((first as HTMLInputElement).value).toBe('arches');
      expect((second as HTMLInputElement).value).toBe('Rome');
      fireEvent.click(screen.getByRole('button', { name: 'Flag question 14 for review' }));
      expect(screen.getByRole('button', { name: 'Flag question 14 for review' }).getAttribute('aria-pressed')).toBe('true');
      expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
    });

  it('keeps a standalone completion prompt when no shared template exists', async () => {
    const fixture = paper({});
    fixture.questions = fixture.questions.map(q => ({ ...q, question_type: 'notes_completion', prompt: `Standalone ${q.q_num} ____ context.` }));
    get.mockResolvedValue(fixture);
    const view = render(<ReadingExamSession />);
    await screen.findByRole('textbox', { name: 'Answer 14' });
    expect(view.container.querySelector('#q-14 .exam-q__prompt')?.textContent).toBe('Standalone 14  context.');
  });

  it('keeps word-bank selections and repeated values inside authored summary text', async () => {
    const fixture = paper({ template: { summary_text: 'Route: {{14}}, then {{15}}.' }, options: [{ label: 'A', text: 'arches' }, { label: 'B', text: 'tunnels' }] });
    fixture.questions = fixture.questions.map(q => ({ ...q, question_type: 'summary_completion', prompt: 'Per-question ____ copy.' }));
    get.mockResolvedValue(fixture);
    const view = render(<ReadingExamSession />);
    const first = await screen.findByRole('combobox', { name: 'Answer 14' });
    const second = screen.getByRole('combobox', { name: 'Answer 15' });
    fireEvent.change(first, { target: { value: 'A' } }); fireEvent.change(second, { target: { value: 'A' } });
    expect((first as HTMLSelectElement).value).toBe('A'); expect((second as HTMLSelectElement).value).toBe('A');
    expect(view.container.querySelector('[data-question-type]')?.textContent).not.toContain('Per-question');
  });

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

  it.each(['F', 'I'])('uses the native top-level A-%s bank ahead of a conflicting legacy template without changing source data', async (last) => {
    const fixture = paper({ paragraph_labels: letters(last), template: { paragraph_labels: letters('H') } });
    const original = JSON.stringify(fixture);
    get.mockResolvedValue(fixture);
    render(<ReadingExamSession />);
    const first = await screen.findByRole('combobox', { name: 'Answer 14' });
    const second = screen.getByRole('combobox', { name: 'Answer 15' });
    expect(within(first).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', ...letters(last)]);
    fireEvent.change(first, { target: { value: last } });
    fireEvent.change(second, { target: { value: last } });
    expect((first as HTMLSelectElement).value).toBe(last);
    expect((second as HTMLSelectElement).value).toBe(last);
    expect(JSON.stringify(fixture)).toBe(original);
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
