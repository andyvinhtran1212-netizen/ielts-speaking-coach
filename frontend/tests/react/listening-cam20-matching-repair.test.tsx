import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';
import payload from '../fixtures/cam20-t2-reviewed-matching.json';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'synthetic-owner' } }) }));
let post: ReturnType<typeof vi.fn>;
let patch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const paper = { id: 'c20-matching-fixture', title: 'Cam20 matching fixture', test_type: 'mini', audio_url: 'https://audio.fixture.test/matching.wav',
    sections: [{ section_num: 2, exercises: [{ id: 'matching-fixture', exercise_type: 'dictation', payload }] }] };
  post = vi.fn(); patch = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get: vi.fn().mockResolvedValue(paper), getWith: vi.fn(), post, patch } });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag: vi.fn(), mountSurvey: vi.fn() } });
  window.history.replaceState(null, '', '/listening/test/session?id=c20-matching-fixture&admin_preview=1');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

it('keeps all six source-labelled matching rows editable after two selections', async () => {
  const original = JSON.stringify(payload);
  const view = render(<ListeningTestSession />);
  await screen.findByRole('radio', { name: 'Question 11: D' });
  for (const question of payload.questions) expect(view.container.textContent).toContain(question.prompt);
  for (const option of payload.metadata.match_options) expect(view.container.textContent).toContain(option.text);
  expect(view.container.textContent).toContain('Choose SIX answers');
  expect(view.container.textContent).not.toContain('Choose TWO');
  const radios = screen.getAllByRole('radio') as HTMLInputElement[];
  expect(radios).toHaveLength(54);
  expect(radios.filter(r => r.checked)).toHaveLength(0);
  fireEvent.click(screen.getByRole('radio', { name: 'Question 11: D' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Question 12: I' }));
  expect(radios.filter(r => r.checked)).toHaveLength(2);
  expect(radios.every(r => !r.disabled)).toBe(true);
  for (const [q, letter] of [[13, 'H'], [14, 'E'], [15, 'A'], [16, 'B']]) {
    fireEvent.click(screen.getByRole('radio', { name: `Question ${q}: ${letter}` }));
  }
  expect(radios.filter(r => r.checked).map(r => r.value)).toEqual(['D', 'I', 'H', 'E', 'A', 'B']);
  fireEvent.click(screen.getByRole('radio', { name: 'Question 13: A' }));
  expect(radios.filter(r => r.checked).map(r => r.value)).toEqual(['D', 'I', 'A', 'E', 'A', 'B']);
  expect(JSON.stringify(payload)).toBe(original);
  expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
});
