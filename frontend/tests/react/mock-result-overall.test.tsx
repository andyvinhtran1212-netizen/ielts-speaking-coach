import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockResultBehavior } from '@/app/(authed-mock-result)/mock/result/mock-result-behavior';

// G02-T05 (FR-02-004): the TRF draws an Overall only once enough skills carry
// a band. A one-skill result must not show "9.0 Overall" next to three blanks.
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-a' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('sitting=sitting-a') }));

let payload: Record<string, unknown>;
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { getWith: vi.fn(async () => payload) },
  });
});
afterEach(() => cleanup());

const overallArea = () => document.getElementById('overall') as HTMLElement;

it('shows no Overall number while only Writing is banded', async () => {
  payload = { final_bands: { writing: 9, overall: 9 }, overall_min_skills: 4, banded_skill_count: 1 };
  render(<MockResultBehavior />);
  expect(await screen.findByText('Chưa có Overall · còn thiếu Listening, Reading, Speaking')).toBeTruthy();
  expect(screen.getByText('Overall cần đủ bốn kỹ năng trong cùng đề thi thử.')).toBeTruthy();
  expect(overallArea().querySelector('.trf-ring')).toBeNull();
  expect(screen.queryByRole('img', { name: /Overall/ })).toBeNull();
  // The skill bar keeps its own band.
  expect(overallArea().querySelector('.trf-sk__val')?.textContent).toBe('9.0');
  expect(overallArea().querySelectorAll('.trf-sk__val')).toHaveLength(1);
});

it('a payload without the readiness fields still needs all four skills', async () => {
  payload = { final_bands: { listening: 6, reading: 7, writing: 6, overall: 6.5 } };
  render(<MockResultBehavior />);
  expect(await screen.findByText('Chưa có Overall · còn thiếu Speaking')).toBeTruthy();
  expect(screen.queryByRole('img', { name: /Overall/ })).toBeNull();
});

it('draws the Overall ring once all four skills are banded', async () => {
  payload = {
    final_bands: { listening: 6, reading: 7, writing: 6, speaking: 6.5, overall: 6.5 },
    overall_min_skills: 4,
    banded_skill_count: 4,
  };
  render(<MockResultBehavior />);
  expect(await screen.findByRole('img', { name: 'Overall 6.5' })).toBeTruthy();
  expect(screen.queryByTestId('overall-missing')).toBeNull();
});
