import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';
import { WebExplanationPanel } from '@/components/web-explanation-panel';
import fixture from '../fixtures/listening-review-group-and-editorial.json';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/listening/review?admin_test_id=1d1a52a8-5f4e-5c3a-9a43-6d2c4d0b0c21');
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith } });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: {
    attachCardFlag: vi.fn(), mountSurvey: vi.fn(),
  } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

// Staging ILR-LIS-CAM-B21-T1 Q12 (RPL-01, PC-J200 STT): the stored replay
// window is 819.06–828.86 s while the frozen explanation's evidence says
// 602.28–622.92 s. The two ranges do not intersect.
const B21_T1_Q12_WINDOW = { start: 819.06, end: 828.86, section: 'S2' };
const B21_T1_Q12_OBJECT = {
  object_id: 'cambridge-21-test-1-listening-q12',
  item: {
    answer: { canonical: 'B', accepted_forms: ['B'], comparison_mode: 'single_value' },
    options: { A: 'makeup for special effects.', B: 'working with different ethnicities.', C: 'creating a variety of hair styles.' },
  },
  explanation: {
    answer_summary: 'Đáp án chuẩn: B.',
    source_evidence: [{
      quote: "WOMAN: But you're likely to get the opportunity to work with a range of age groups, as well as different ethnicities.",
      location: 'Section 2; cambridge_ielts_21_test_1_audioscript.md',
      relation: 'Transcript evidence (token containment 1.000).',
      timestamp: '602.28-622.92s',
    }, {
      quote: 'Doing makeup for special effects is highly specialised.',
      location: 'Section 2',
      timestamp: '622.92-630.00s',
    }],
    evidence_location_or_audio_anchor: { start_seconds: 602.28, end_seconds: 622.92, provenance: 'authored_solution' },
  },
};

function audioChips(root: ParentNode) {
  return [...root.querySelectorAll('.wex-evidence__meta span')]
    .filter((node) => node.querySelector('b')?.textContent === 'Audio')
    .map((node) => node.textContent?.replace(/^Audio/, ''));
}

it('labels the Listening "Audio" evidence with the replayed window, once, not the stored timestamp', () => {
  const { container } = render(<WebExplanationPanel object={B21_T1_Q12_OBJECT} skill="listening" attemptId={null}
    questionNumber={12} persistenceEnabled={false} correctionRequired={false}
    replayWindow={B21_T1_Q12_WINDOW} onReplayAudio={vi.fn()} />);
  expect(audioChips(container)).toEqual(['S2 · 13:39.1–13:48.9']);
  expect(container.textContent).not.toContain('10:02');
  expect(container.textContent).not.toContain('10:22');
  // Both evidence quotes are still shown.
  expect(container.querySelectorAll('.wex-evidence blockquote')).toHaveLength(2);
});

it('shows neither an "Audio" label nor a replay button when the question has no replay window', () => {
  const { container } = render(<WebExplanationPanel object={B21_T1_Q12_OBJECT} skill="listening" attemptId={null}
    questionNumber={12} persistenceEnabled={false} onReplayAudio={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Nghe đoạn câu này' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Đánh dấu mốc đang nghe' })).toBeTruthy();
  expect(audioChips(container)).toEqual([]);
});

it('leaves Reading evidence untouched', () => {
  const object = { explanation: { source_evidence: [{ location: 'Paragraph C', quote: 'x', timestamp: '1-2s' }] } };
  const { container } = render(<WebExplanationPanel object={object} skill="reading" attemptId={null}
    questionNumber={1} persistenceEnabled={false} correctionRequired={false} />);
  expect(audioChips(container)).toEqual(['0:01–0:02']);
});

function b21Review(correct: boolean) {
  const raw = structuredClone(fixture.group_review) as any;
  const base = raw.review[0];
  raw.review = [{
    ...base, q_num: 12, correct, user_answer: correct ? 'B' : 'A', expected: 'B',
    question_type: 'mcq', prompt: 'According to the speaker, on big budget films trainees may get experience of',
    audio_window: B21_T1_Q12_WINDOW, section: 'S2', solution: {}, web_explanation_object: B21_T1_Q12_OBJECT,
    unordered_answer_group: undefined, solution_group: undefined,
    question_context: { ...base.question_context, question_id: 'b21t1:12' },
  }];
  raw.max_score = 1;
  return raw;
}

it('RPL-01 contract: card label, explanation "Audio" label and the played segment are one range', async () => {
  getWith.mockResolvedValue(b21Review(true));
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 12 — xem trước', exact: true });
  const card = view.container.querySelector('#listening-review-q-12')!;
  fireEvent.click(card.querySelector('.lr-card__top')!);
  expect(card.querySelector('.lr-card__ts')?.textContent).toBe('▶ Nghe đoạn S2 · 13:39.1–13:48.9');
  expect(audioChips(card)).toEqual(['S2 · 13:39.1–13:48.9']);
});

it('RPL-01 contract: the explanation replay button plays exactly the labelled window', async () => {
  getWith.mockResolvedValue(b21Review(false));
  const view = render(<ListeningReviewWorkspace />);
  await screen.findByRole('button', { name: 'Câu 12 — xem trước', exact: true });
  const card = view.container.querySelector('#listening-review-q-12')!;
  fireEvent.click(card.querySelector('.lr-card__top')!);
  fireEvent.click(screen.getByRole('button', { name: 'Nghe đoạn câu này' }));
  const player = view.container.querySelector('audio-player')!;
  expect(player.getAttribute('segment-start')).toBe('819.06');
  expect(player.getAttribute('segment-end')).toBe('828.86');
});
