import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminReadingPreview } from '@/app/(authed-admin-reading-preview)/admin/reading/preview/admin-reading-preview';
import canonical from '../fixtures/reading-admin-canonical-solutions.json';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('test_id=authored-preview') }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));

const paper = () => ({
  id: 'paper-1', test_id: 'authored-preview', title: 'Authored preview', passage_count: 1, total_questions: 3,
  passages: [{ id: 'p1', passage_order: 1, title: 'Passage one', body_markdown: 'Source passage' }],
  questions: [
    { id: 'q11', q_num: 11, passage_id: 'p1', question_type: 'notes_completion', prompt: 'The strings came from animals.',
      answer: { answer: 'intestines', alternatives: ['gut'] }, explanation: null as string | null,
      payload: { instruction: 'Complete the notes.', word_limit: 'ONE WORD ONLY', solution: {
        question_text: 'The strings came from the ____ of animals.',
        steps: 'Locate natural gut.\nChoose intestines.', source_excerpt: 'The outer layer of sheep or cow intestines.',
        vocab: ['intestines = ruột', 'natural gut = dây ruột tự nhiên'], paraphrase: 'animals ↔ sheep or cow',
        trap_analysis: 'Do not write cow intestines: that is two words.', tips: 'Keep the plural.', skill_code: 'LEX', band: 6.5,
      } } },
    { id: 'q12', q_num: 12, passage_id: 'p1', question_type: 'short_answer', prompt: 'Legacy question',
      answer: { answer: 'weights' }, explanation: 'Legacy explanation remains visible.', payload: {} },
    { id: 'q13', q_num: 13, passage_id: 'p1', question_type: 'short_answer', prompt: 'No explanation yet',
      answer: { answer: 'grips' }, explanation: null, payload: {} },
  ],
});

let get: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let markdown: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/admin/reading/preview?test_id=authored-preview');
  get = vi.fn(); patch = vi.fn(); post = vi.fn(); markdown = vi.fn((value: string) => value);
  Object.defineProperty(window, 'api', { configurable: true, value: { get, patch, post } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: markdown });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('admin inspector authored Reading solutions', () => {
  it('shows all three actual L3 Q10 instructions and the canonical MCQ distractor before and after reload', async () => {
    const source = { ...paper(), total_questions: 2, questions: [canonical.q10, canonical.mcq] };
    const original = JSON.stringify(source);
    get.mockResolvedValue(source);
    const view = render(<AdminReadingPreview />);
    await screen.findByText(canonical.q10.prompt);
    const assertCanonical = () => {
      const q10 = within(view.container.querySelector('#q10') as HTMLElement);
      expect(q10.queryByText('Chưa có lời giải')).toBeNull();
      const steps = q10.getByRole('region', { name: 'Các bước giải' });
      expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual(
        canonical.q10.payload.solution.solution_steps.map((step) => step.instruction_vi));
      expect(q10.getByText('coal', { selector: 'code' })).toBeTruthy();
      const mcq = within(view.container.querySelector('#q1') as HTMLElement);
      expect(mcq.getByText('B — ' + canonical.mcq.payload.solution.distractor_analysis[0].why_wrong_vi)).toBeTruthy();
    };
    assertCanonical();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    assertCanonical();
    expect(JSON.stringify(source)).toBe(original);
    expect(patch).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });

  it('shows a C19R1-shaped authored solution and rubric instead of the empty fallback, while retaining legacy and genuine empty states', async () => {
    const source = paper(); const original = JSON.stringify(source);
    get.mockResolvedValue(source);
    const view = render(<AdminReadingPreview />);
    expect(await screen.findByText('Locate natural gut. Choose intestines.')).toBeTruthy();
    const card = within(view.container.querySelector('#q11') as HTMLElement);
    expect(card.queryByText('Chưa có lời giải')).toBeNull();
    for (const text of ['Complete the notes.', 'ONE WORD ONLY', 'The outer layer of sheep or cow intestines.',
      'intestines = ruột', 'animals ↔ sheep or cow', 'Do not write cow intestines: that is two words.', 'LEX', '6.5']) {
      expect(card.getByText(text)).toBeTruthy();
    }
    expect(card.getByText('intestines', { selector: 'code' })).toBeTruthy();
    expect(card.getByText('gut', { selector: 'code' })).toBeTruthy();
    expect(screen.getByText('Legacy explanation remains visible.')).toBeTruthy();
    expect(screen.getAllByText('Chưa có lời giải')).toHaveLength(1);
    expect(JSON.stringify(source)).toBe(original);
    expect(patch).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });

  it('renders hostile canonical instructions and distractor reasons as literal text', async () => {
    const fixture = structuredClone(canonical);
    fixture.q10.payload.solution.solution_steps[0].instruction_vi = '<script>alert(1)</script>';
    fixture.mcq.payload.solution.distractor_analysis[0].why_wrong_vi = '<img src=x onerror=alert(2)>';
    get.mockResolvedValue({ ...paper(), total_questions: 2, questions: [fixture.q10, fixture.mcq] });
    const view = render(<AdminReadingPreview />);
    expect(await screen.findByText('<script>alert(1)</script>')).toBeTruthy();
    expect(screen.getByText('B — <img src=x onerror=alert(2)>')).toBeTruthy();
    expect(view.container.querySelector('#q10 script, #q1 img')).toBeNull();
    expect(markdown.mock.calls.every(([value]) => value === 'Source passage')).toBe(true);
  });

  it('renders both explanation sources and literal hostile markup as text without invoking the passage Markdown renderer', async () => {
    const source = paper();
    source.questions[0].explanation = 'Legacy and authored explanation coexist.';
    source.questions[0].payload.solution!.steps = '<img src=x onerror=alert(1)>\n<script>alert(2)</script>';
    source.questions[0].payload.instruction = '<b>Do not interpret this markup</b>';
    get.mockResolvedValue(source);
    const view = render(<AdminReadingPreview />);
    expect(await screen.findByText('Legacy and authored explanation coexist.')).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)> <script>alert(2)</script>')).toBeTruthy();
    expect(screen.getByText('<b>Do not interpret this markup</b>')).toBeTruthy();
    expect(view.container.querySelector('#q11 img, #q11 script, #q11 b')).toBeNull();
    expect(markdown.mock.calls.every(([value]) => value === 'Source passage')).toBe(true);
  });

  it('replaces authored explanation text only after the existing canonical reload', async () => {
    const current = paper(); const refreshed = paper();
    refreshed.questions[0].payload.solution!.steps = 'New canonical solution.';
    get.mockResolvedValueOnce(current).mockResolvedValueOnce(refreshed);
    render(<AdminReadingPreview />);
    expect(await screen.findByText('Locate natural gut. Choose intestines.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    expect(await screen.findByText('New canonical solution.')).toBeTruthy();
    expect(screen.queryByText('Locate natural gut. Choose intestines.')).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    expect(patch).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
});
