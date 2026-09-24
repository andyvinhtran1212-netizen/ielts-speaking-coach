import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-1' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const questions = [
  { q_num: 1, source_item_id: 'manus:A0.2-018.P1', source_stimulus_ids: ['clip-1'], prompt: 'Mai đang rủ cả hai cùng làm hay yêu cầu riêng Ben làm?', response_type: 'single_choice', options: { A: 'Rủ cả hai cùng làm', B: 'Chỉ yêu cầu Ben làm' } },
  { q_num: 2, source_item_id: 'manus:A0.2-018.P2', source_stimulus_ids: ['clip-1'], prompt: 'Mai rủ luyện gì?', response_type: 'single_choice', options: { A: 'Viết tên', B: 'Tiếng Anh' } },
];
const guidedItem = { q_num: 1, first_answer: 'A', state: 'checked', correct: true, expected: ['A'], rationale: 'Mai đang rủ cả hai.', reference_answers: [], required_facts: [], optional_facts: [], self_review_rationale: '', core_info: '', answer_sentence: '', audio_window: { start: 12, end: 18 } };
const programmeTest = { scoring_policy: 'report_only', title: 'Let’s — Luyện tập', programme_id: 'general-listening-practice', listening_lesson_id: 'lesson-1', replay_policy: 'allowed', audio_url: '/audio.wav', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions } }] }] };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', { randomUUID: () => 'playback-claim' });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.assign(window, {
    api: {
      postWith: vi.fn(async (url: string) => url.endsWith('/reveal')
        ? { attempt_id: 'attempt-1', assisted: true, items: [guidedItem] }
        : { attempt_id: 'attempt-1', answers: [] }),
      getWith: vi.fn(async (url: string) => url.endsWith('/guided-state')
        ? { attempt_id: 'attempt-1', assisted: false, items: [] }
        : programmeTest),
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
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state')
    ? { attempt_id: 'attempt-1', assisted: false, items: [] }
    : { ...programmeTest, title: 'Practice', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: untranslated } }] }] });
  render(<ProgrammeFormRunner testId="test-2" />);
  await screen.findByText('Original question');
  expect(screen.queryByRole('button', { name: 'English' })).toBeNull();
  expect(screen.getByText(/Đang hiển thị bản gốc/)).toBeTruthy();
});

it('explains written-answer language and preserves a draft when switching bilingual prompts', async () => {
  const written = [{
    q_num: 1, source_item_id: 'written-1', prompt: 'Which word did you hear?',
    response_type: 'short_answer', options: {},
    editorial_translation: {
      status: 'approved', source_item_id: 'written-1', source_language: 'en', target_language: 'vi',
      source_prompt: 'Which word did you hear?', source_options: {}, prompt: 'Bạn nghe từ nào?',
    },
  }];
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state')
    ? { attempt_id: 'attempt-1', assisted: false, items: [] }
    : { ...programmeTest, sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: written } }] }] });
  render(<ProgrammeFormRunner testId="test-written-bilingual" />);
  await screen.findByText('Bạn nghe từ nào?');
  expect(screen.getByText(/Đổi ngôn ngữ chỉ đổi câu hỏi/)).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('Nhập câu trả lời của bạn'), { target: { value: 'river' } });
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByText('Which word did you hear?')).toBeTruthy();
  expect((screen.getByPlaceholderText('Nhập câu trả lời của bạn') as HTMLTextAreaElement).value).toBe('river');
});

it('does not partially translate a form when another question is still pending', async () => {
  const mixed = [
    {
      q_num: 1, source_item_id: 'place-1', prompt: 'Which place is mentioned?', response_type: 'single_choice',
      options: { A: 'Library', B: 'Museum' },
      editorial_translation: {
        status: 'approved', source_item_id: 'place-1', source_language: 'en', target_language: 'vi',
        source_prompt: 'Which place is mentioned?', source_options: { A: 'Library', B: 'Museum' },
        prompt: 'Địa điểm nào được nhắc đến?', options: { A: 'Thư viện', B: 'Bảo tàng' },
      },
    },
    { q_num: 2, source_item_id: 'place-2', prompt: 'What else is mentioned?', response_type: 'written', options: {} },
  ];
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state')
    ? { attempt_id: 'attempt-1', assisted: false, items: [] }
    : { ...programmeTest, sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: mixed } }] }] });
  render(<ProgrammeFormRunner testId="test-mixed" />);
  await screen.findByText('Which place is mentioned?');
  expect(screen.getByText('What else is mentioned?')).toBeTruthy();
  expect(screen.queryByText('Địa điểm nào được nhắc đến?')).toBeNull();
  expect(screen.queryByRole('button', { name: 'English' })).toBeNull();
});

it('shows only the revealed question, preserves the first answer, and allows a later revision', async () => {
  render(<ProgrammeFormRunner testId="test-1" />);
  await screen.findByText(questions[0].prompt);
  fireEvent.click(screen.getByRole('radio', { name: /Rủ cả hai cùng làm/ }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Đối chiếu câu này' })[0]);
  await screen.findByText('Bạn nghe đúng từ lần đầu');
  expect((screen.getByRole('button', { name: 'Hoàn thành và xem lại' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('Mai đang rủ cả hai.')).toBeTruthy();
  expect(screen.queryByText('Đáp án đối chiếu')).toBeNull();
  expect(window.api.postWith).toHaveBeenCalledWith('/api/listening/tests/attempts/attempt-1/questions/1/reveal', {});
  fireEvent.click(screen.getByRole('radio', { name: /Chỉ yêu cầu Ben làm/ }));
  const comparison = within(screen.getByRole('region', { name: 'Đối chiếu câu 1' }));
  expect(comparison.getByText('B')).toBeTruthy();
  expect(comparison.getAllByText('A')).toHaveLength(2);
  expect(screen.getByText(/Lượt học có hỗ trợ/)).toBeTruthy();
});

it('does not request protected feedback when saving the first answer fails', async () => {
  window.api.patchWith = vi.fn(async () => { throw new Error('save unavailable'); });
  render(<ProgrammeFormRunner testId="test-1" />);
  await screen.findByText(questions[0].prompt);
  fireEvent.click(screen.getByRole('radio', { name: /Rủ cả hai cùng làm/ }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Đối chiếu câu này' })[0]);
  await screen.findByText(/Chưa đối chiếu được/);
  expect(window.api.postWith).not.toHaveBeenCalledWith('/api/listening/tests/attempts/attempt-1/questions/1/reveal', {});
});

it('restores persisted feedback after reopening an attempt', async () => {
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state')
    ? { attempt_id: 'attempt-1', assisted: true, items: [guidedItem] }
    : programmeTest);
  window.api.postWith = vi.fn(async () => ({ attempt_id: 'attempt-1', answers: [{ q_num: 1, user_answer: 'B' }] }));
  render(<ProgrammeFormRunner testId="test-1" />);
  await screen.findByText('Bạn nghe đúng từ lần đầu');
  expect((screen.getByRole('radio', { name: /Chỉ yêu cầu Ben làm/ }) as HTMLInputElement).checked).toBe(true);
  const comparison = within(screen.getByRole('region', { name: 'Đối chiếu câu 1' }));
  expect(comparison.getAllByText('A')).toHaveLength(2);
  expect(comparison.getByText('B')).toBeTruthy();
  expect(window.api.postWith).not.toHaveBeenCalledWith('/api/listening/tests/attempts/attempt-1/questions/1/reveal', {});
});

it('shows written feedback as self-review and never offers question replay for once-only audio', async () => {
  const written = [{ q_num: 1, source_item_id: 'written-1', prompt: 'What did you hear?', response_type: 'written', options: {} }];
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state')
    ? { attempt_id: 'attempt-1', assisted: false, items: [] }
    : { ...programmeTest, replay_policy: 'once', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: written } }] }] });
  window.api.postWith = vi.fn(async (url: string) => url.endsWith('/reveal')
    ? { attempt_id: 'attempt-1', assisted: true, items: [{ ...guidedItem, state: 'unscored', correct: null, expected: [], reference_answers: ['The train is late.'], required_facts: ['train', 'late'], audio_window: null }] }
    : { attempt_id: 'attempt-1', answers: [] });
  render(<ProgrammeFormRunner testId="test-written" />);
  await screen.findByText('What did you hear?');
  fireEvent.change(screen.getByPlaceholderText('Nhập câu trả lời của bạn'), { target: { value: 'The train was delayed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu câu này' }));
  await screen.findByText('Tự đối chiếu với gợi ý');
  expect(screen.getByText('The train is late.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Nghe lại đoạn này/ })).toBeNull();
  expect(screen.queryByText('Bạn nghe đúng từ lần đầu')).toBeNull();
});

it('explains when a reveal is no longer permitted and keeps the typed answer', async () => {
  window.api.postWith = vi.fn(async (url: string) => {
    if (url.endsWith('/reveal')) throw Object.assign(new Error('closed'), { status: 409 });
    return { attempt_id: 'attempt-1', answers: [] };
  });
  render(<ProgrammeFormRunner testId="test-1" />);
  await screen.findByText(questions[0].prompt);
  fireEvent.click(screen.getByRole('radio', { name: /Rủ cả hai cùng làm/ }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Đối chiếu câu này' })[0]);
  await screen.findByText(/không còn cho phép đối chiếu/);
  expect((screen.getByRole('radio', { name: /Rủ cả hai cùng làm/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getAllByRole('button', { name: 'Đối chiếu câu này' })[0] as HTMLButtonElement).disabled).toBe(true);
});

it('keeps the existing answer-and-submit flow available during a guided endpoint outage', async () => {
  window.api.getWith = vi.fn(async (url: string) => {
    if (url.endsWith('/guided-state')) throw Object.assign(new Error('not deployed'), { status: 404 });
    return programmeTest;
  });
  render(<ProgrammeFormRunner testId="test-1" />);
  await screen.findByText(questions[0].prompt);
  expect(screen.getByText(/Đối chiếu từng câu tạm thời chưa sẵn sàng/)).toBeTruthy();
  expect((screen.getAllByRole('button', { name: 'Đối chiếu câu này' })[0] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /Rủ cả hai cùng làm/ }));
  await waitFor(() => expect(window.api.patchWith).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Hoàn thành và xem lại' })).toBeTruthy();
});
