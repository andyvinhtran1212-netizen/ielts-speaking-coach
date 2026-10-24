import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';
import { ReviewQuestionContext } from '@/components/review-attempt-context';
import fixture from '../fixtures/cam19-audit-regressions.json';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'cam19-qa' } }) }));
let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/listening/test/session?id=cam19-qa&admin_preview=1');
  get = vi.fn(); post = vi.fn(); patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch } });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

function preview(exercise: unknown, section: number) {
  get.mockResolvedValue({ id: 'cam19-qa', title: 'Cam19 captured content', test_type: 'full', audio_url: 'https://audio.fixture.test/cam19.mp3',
    sections: [{ section_num: section, title: `Part ${section}`, exercises: [exercise] }] });
  return render(<ListeningTestSession />);
}

it('keeps the T2 address on three complete rows and saves both numbered fields independently', async () => {
  preview(fixture.listening_t2, 1);
  const college = await screen.findByRole('textbox', { name: 'Answer 3', exact: true });
  const street = screen.getByRole('textbox', { name: 'Answer 4', exact: true });
  expect(college.closest('.ielts-form-row')).not.toBe(street.closest('.ielts-form-row'));
  expect(street.closest('.ielts-form-row')?.textContent).toContain('Street');
  expect(street.closest('.ielts-form-row')?.textContent).not.toContain('First floor');
  expect(screen.getByText('First floor, Room T347')).toBeTruthy();
  fireEvent.change(college, { target: { value: 'college' } });
  fireEvent.change(street, { target: { value: 'New' } });
  expect((college as HTMLInputElement).value).toBe('college');
  expect((street as HTMLInputElement).value).toBe('New');
  expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
});

it('restores the control-group premise before T3 Q28 and retains all five answer slots and A–H options', async () => {
  preview(fixture.listening_t3, 3);
  const flow = await screen.findByRole('list', { name: 'Flow chart stages' });
  const premise = within(flow).getByText(/Feed group A ordinary mouse food/);
  const q28 = screen.getByRole('combobox', { name: 'Answer 28', exact: true });
  expect(premise.compareDocumentPosition(q28) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(flow).getAllByRole('combobox')).toHaveLength(5);
  expect(within(q28).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  fireEvent.change(q28, { target: { value: 'E' } });
  expect((q28 as HTMLSelectElement).value).toBe('E');
  expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
});

it('keeps T4 recommendations whole and attaches the wildlife example to the recovery benefit in player and review', async () => {
  const view = preview(fixture.listening_t4, 4);
  await screen.findByRole('textbox', { name: 'Answer 31', exact: true });
  expect(screen.getByRole('textbox', { name: 'Answer 31', exact: true }).closest('li')?.textContent).not.toContain('aim to capture');
  expect(screen.getByRole('textbox', { name: 'Answer 33', exact: true }).closest('li')?.textContent).toContain('increase resistance to');
  expect(screen.getByRole('textbox', { name: 'Answer 36', exact: true }).closest('li')?.textContent).toContain('endangered by keeping');
  const example = screen.getByRole('textbox', { name: 'Answer 38', exact: true });
  expect(example.closest('li')?.parentElement?.closest('li')?.textContent).toContain('of recovery by attracting animals and birds');
  expect(view.container.querySelectorAll('.ielts-notes-list input')).toHaveLength(10);
  cleanup();
  const review = render(<ReviewQuestionContext value={{ template: fixture.listening_t4.payload.template }} />);
  expect(review.container.querySelector('li ul li ul li')?.textContent).toContain('[Câu 38]');
  expect(review.container.querySelectorAll('input,select')).toHaveLength(0);
});

it('hides metadata-only empty contexts while retaining real instructions', () => {
  const view = render(<ReviewQuestionContext value={{ question_id: 'cam19-q1', template_kind: 'true_false_not_given', template: {}, options: [], context_provenance: {} }} />);
  expect(view.container.querySelector('.review-question-context')).toBeNull();
  view.rerender(<ReviewQuestionContext value={{ instruction: 'Choose TRUE, FALSE or NOT GIVEN.' }} />);
  expect(screen.getByRole('region', { name: 'Ngữ cảnh câu hỏi' })).toBeTruthy();
});
