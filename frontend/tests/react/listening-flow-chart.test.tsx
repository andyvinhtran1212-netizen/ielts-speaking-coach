import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'admin-fixture', email: 'fixture@example.test' } }) }));

const stages = ['Initial aim', 'Literature review', 'Product development', 'Product production'];
const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
function paper(withBank = true, withSteps = true) {
  return {
    id: 'flow-fixture', title: 'Flow fixture', test_type: 'mini', audio_url: 'https://audio.fixture.test/flow.wav',
    sections: [{ section_num: 3, title: 'Part 3', exercises: [{ id: 'flow-exercise', exercise_type: 'dictation_gap_fill', payload: {
      template_kind: 'flow_chart_completion', variant: 'flow_chart_completion',
      instruction: 'Complete the flow-chart below. Choose FOUR answers from the box and write the correct letter, A-F, next to Questions 27-30.',
      questions: stages.map((prompt, index) => ({ q_num: 27 + index, prompt })),
      metadata: { flow_direction: 'top_to_bottom', ...(withBank ? { match_options: letters.map(letter => ({ letter, text: `Option ${letter}` })) } : {}) },
      template: { heading: 'Student project', ...(withSteps ? { steps: stages.map((prefix, index) => ({ q_num: 27 + index, prefix, suffix: '' })) } : {}) },
      answers: [{ q_num: 27, answer: 'PRIVATE_KEY' }], solutions: { 27: { why_correct: 'PRIVATE_RATIONALE' } },
    } }] }],
  };
}
beforeEach(() => {
  window.history.replaceState(null, '', '/listening/test/session?id=flow-fixture&admin_preview=1');
  get = vi.fn(); post = vi.fn(); patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch } });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('Listening flow-chart preserves authored stage relationships', () => {
  it('renders the printed letter bank and four stages with three transitions, retaining answer identities', async () => {
    get.mockResolvedValue(paper());
    const view = render(<ListeningTestSession />);
    const flow = await screen.findByRole('list', { name: 'Flow chart stages' });
    expect(within(flow).getAllByRole('listitem')).toHaveLength(4);
    expect([...flow.querySelectorAll('.listening-next-flow-step')].map(step => step.textContent?.includes(stages[Number(step.id.slice(2)) - 27]))).toEqual([true, true, true, true]);
    expect(flow.querySelectorAll('.listening-next-flow-arrow')).toHaveLength(3);
    expect(within(screen.getByRole('complementary', { name: 'Flow chart options' })).getAllByRole('listitem')).toHaveLength(6);
    for (const qNum of [27, 28, 29, 30]) {
      const control = screen.getByRole('combobox', { name: `Answer ${qNum}`, exact: true });
      expect(within(control).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', ...letters]);
      fireEvent.change(control, { target: { value: 'F' } });
      expect((control as HTMLSelectElement).value).toBe('F');
    }
    expect(view.container.querySelector('.listening-next-match-table')).toBeNull();
    expect(view.container.textContent).not.toContain('PRIVATE_KEY'); expect(view.container.textContent).not.toContain('PRIVATE_RATIONALE');
    expect(get).toHaveBeenCalledWith('/admin/listening/tests/flow-fixture/player-preview');
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it('retains free-text controls for a structured flow-chart without a letter bank', async () => {
    get.mockResolvedValue(paper(false)); render(<ListeningTestSession />);
    await screen.findByRole('list', { name: 'Flow chart stages' });
    for (const qNum of [27, 28, 29, 30]) expect(screen.getByRole('textbox', { name: `Answer ${qNum}` })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('preserves existing fallback controls for papers without authored flow steps', async () => {
    get.mockResolvedValue(paper(false, false)); render(<ListeningTestSession />);
    await screen.findByRole('textbox', { name: 'Answer 27' });
    expect(screen.queryByRole('list', { name: 'Flow chart stages' })).toBeNull();
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });
});
