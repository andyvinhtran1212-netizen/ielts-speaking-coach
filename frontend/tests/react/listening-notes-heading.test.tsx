import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'admin-fixture', email: 'fixture@example.test' } }) }));

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
function paper(headingSegments: unknown = [{ q_num: 3, prefix: '', suffix: 'Cottage' }]) {
  const structured = Array.isArray(headingSegments) && headingSegments.length > 0;
  return {
    id: 'notes-fixture', title: 'Notes fixture', test_type: 'mini', audio_url: 'https://audio.fixture.test/notes.wav',
    sections: [{ section_num: 1, title: 'Part 1', exercises: [{ id: 'notes-exercise', exercise_type: 'dictation_gap_fill', payload: {
      template_kind: 'notes_completion', instruction: 'Complete the notes below. Write ONE WORD AND/OR A NUMBER for each answer.',
      questions: Array.from({ length: 10 }, (_, index) => ({ q_num: index + 1, prompt: `Prompt ${index + 1}` })),
      template: { heading: 'Holiday rental', groups: [
        { heading: 'Owners', items: [{ text: 'Meet the owners on arrival' }] },
        { heading: 'Granary Cottage', items: [{ q_num: 1, prefix: 'Available for weeks beginning' }, { q_num: 2, prefix: 'Cost for the week: £' }] },
        { heading: structured ? 'STALE_TEXT_HEADING' : '**Cottage**', heading_segments: headingSegments, items: [
          { text: 'Cost for the week: £480' },
          ...Array.from({ length: structured ? 6 : 7 }, (_, index) => ({ q_num: (structured ? 4 : 3) + index, prefix: `Detail ${(structured ? 4 : 3) + index}` })),
        ] },
        { heading: 'Payment', items: [{ q_num: 10, prefix: 'Payment method' }] },
      ] },
      answers: [{ q_num: 3, answer: 'Chervil' }], solutions: { 3: { why_correct: 'PRIVATE_RATIONALE' } },
    } }] }],
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/listening/test/session?id=notes-fixture&admin_preview=1');
  get = vi.fn(); post = vi.fn(); patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch } });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('Listening notes preserve an editable authored group heading', () => {
  it('places Question 3 in the second cottage heading above Questions 4–9 and retains the numbered answer control', async () => {
    get.mockResolvedValue(paper());
    const view = render(<ListeningTestSession />);
    const input = await screen.findByRole('textbox', { name: 'Answer 3', exact: true });
    const heading = input.closest('.ielts-notes-group-heading')!;
    const group = heading.parentElement!;
    expect(heading.textContent).toBe('3 Cottage');
    expect(input.closest('li')).toBeNull();
    expect(input.closest('#q-3')).toBeTruthy();
    expect(input.getAttribute('data-q-num')).toBe('3');
    expect((input as HTMLInputElement).value).toBe('');
    expect(within(heading as HTMLElement).getAllByRole('textbox')).toHaveLength(1);
    expect([...group.querySelectorAll('li input')].map(control => control.getAttribute('data-q-num'))).toEqual(['4', '5', '6', '7', '8', '9']);
    const granary = screen.getByText('Granary Cottage').parentElement!;
    expect([...granary.querySelectorAll('input')].map(control => control.getAttribute('data-q-num'))).toEqual(['1', '2']);
    expect(group.firstElementChild).toBe(heading);
    expect(group.querySelector('ul')?.textContent).toContain('Cost for the week: £480');
    expect(screen.getAllByRole('textbox')).toHaveLength(10);

    fireEvent.change(input, { target: { value: 'learner cottage' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer 4', exact: true }), { target: { value: 'learner detail' } });
    expect((screen.getByRole('textbox', { name: 'Answer 3', exact: true }) as HTMLInputElement).value).toBe('learner cottage');
    expect(screen.getByRole('button', { name: 'Question 3, answered', exact: true })).toBeTruthy();
    expect(view.container.innerHTML).not.toContain('Chervil');
    expect(view.container.innerHTML).not.toContain('PRIVATE_RATIONALE');
    expect(view.container.textContent).not.toContain('STALE_TEXT_HEADING');
    expect(get).toHaveBeenCalledWith('/admin/listening/tests/notes-fixture/player-preview');
    expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });

  it('renders authored text and gap segments in order using the existing inline emphasis', async () => {
    get.mockResolvedValue(paper([{ text: '**Rental**' }, { q_num: 3, prefix: '*Type*', suffix: '**Cottage**' }]));
    render(<ListeningTestSession />);
    const input = await screen.findByRole('textbox', { name: 'Answer 3', exact: true });
    const heading = input.closest('.ielts-notes-group-heading')!;
    expect(heading.textContent).toBe('Rental Type 3 Cottage');
    expect([...heading.querySelectorAll('strong')].map(element => element.textContent)).toEqual(['Rental', 'Cottage']);
    expect(heading.querySelector('em')?.textContent).toBe('Type');
  });

  it.each([undefined, [], 'invalid'])('preserves string headings and item controls when heading segments are %j', async headingSegments => {
    const fixture = paper(headingSegments === undefined ? null : headingSegments);
    // Explicit undefined tests legacy payloads without the optional field.
    if (headingSegments === undefined) delete (fixture.sections[0].exercises[0].payload.template.groups[2] as { heading_segments?: unknown }).heading_segments;
    get.mockResolvedValue(fixture);
    render(<ListeningTestSession />);
    const input = await screen.findByRole('textbox', { name: 'Answer 3', exact: true });
    const group = input.closest('.ielts-notes-group')!;
    expect(input.closest('.ielts-notes-group-heading')).toBeNull();
    expect(group.querySelector('.ielts-notes-group-heading strong')?.textContent).toBe('Cottage');
    expect(screen.getAllByRole('textbox')).toHaveLength(10);
  });
});
