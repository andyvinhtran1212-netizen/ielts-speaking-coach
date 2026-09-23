import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-1' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const questions = [
  { q_num: 1, source_item_id: 'manus:A0.2-018.P1', source_stimulus_ids: ['clip-1'], prompt: 'Mai đang rủ cả hai cùng làm hay yêu cầu riêng Ben làm?', response_type: 'single_choice', options: { A: 'Rủ cả hai cùng làm', B: 'Chỉ yêu cầu Ben làm' } },
  { q_num: 2, source_item_id: 'manus:A0.2-018.P2', source_stimulus_ids: ['clip-1'], prompt: 'Mai rủ luyện gì?', response_type: 'single_choice', options: { A: 'Viết tên', B: 'Tiếng Anh' } },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', { randomUUID: () => 'playback-claim' });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.assign(window, {
    api: {
      postWith: vi.fn(async () => ({ attempt_id: 'attempt-1', answers: [] })),
      getWith: vi.fn(async () => ({ scoring_policy: 'report_only', title: 'Let’s — Luyện tập', programme_id: 'general-listening-practice', listening_lesson_id: 'lesson-1', replay_policy: 'allowed', audio_url: '/audio.wav', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions } }] }] })),
      patchWith: vi.fn(async () => ({})),
    },
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lets a learner answer one question at a time, revise it, and change verified question language', async () => {
  render(<ProgrammeFormRunner testId="test-1" />);
  await screen.findByText(questions[0].prompt);

  fireEvent.click(screen.getByRole('button', { name: 'Luyện từng bước' }));
  expect(screen.queryByText(questions[1].prompt)).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: /Rủ cả hai cùng làm/ }));
  await waitFor(() => expect(window.api.patchWith).toHaveBeenCalled());

  fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
  expect(screen.getByText(questions[1].prompt)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Câu trước' }));
  expect((screen.getByRole('radio', { name: /Rủ cả hai cùng làm/ }) as HTMLInputElement).checked).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByText(/Is Mai inviting both of them/)).toBeTruthy();
  expect((screen.getByRole('radio', { name: /Inviting both to act together/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText(/Đáp án đối chiếu|Transcript tham khảo/)).toBeNull();
});

it('keeps source language when a form has no complete reviewed translation', async () => {
  const untranslated = [{ ...questions[0], source_item_id: 'untranslated', prompt: 'Original question' }];
  window.api.getWith = vi.fn(async () => ({ scoring_policy: 'report_only', title: 'Practice', replay_policy: 'allowed', audio_url: '/audio.wav', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: untranslated } }] }] }));
  render(<ProgrammeFormRunner testId="test-2" />);
  await screen.findByText('Original question');
  expect(screen.queryByRole('button', { name: 'English' })).toBeNull();
  expect(screen.getByText(/Đang hiển thị bản gốc/)).toBeTruthy();
});
