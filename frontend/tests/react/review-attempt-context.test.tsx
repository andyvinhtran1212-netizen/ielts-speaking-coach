import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ReviewContextNotice, ReviewQuestionContext } from '@/components/review-attempt-context';
import { normalizeReadingReview } from '@/lib/reading-review-model.mjs';
import { normalizeListeningReview } from '@/lib/listening-review-model.mjs';
import l025 from '../fixtures/listening-review-l025-map.json';
afterEach(cleanup);
it('distinguishes saved context, current fallback and unavailable context without asserting old source authenticity', () => {
  const view = render(<ReviewContextNotice value={{ provenance: 'submission_snapshot', possibly_changed: false }} />);
  expect(screen.getByText('Ngữ cảnh của lượt làm này đã được lưu.')).toBeTruthy();
  view.rerender(<ReviewContextNotice value={{ provenance: 'current_content_fallback', possibly_changed: true }} />);
  expect(screen.getByText(/có thể khác đề khi bạn làm bài/)).toBeTruthy();
  view.rerender(<ReviewContextNotice value={{ provenance: 'unavailable', possibly_changed: false }} />);
  expect(screen.getByText(/Chưa khôi phục được/)).toBeTruthy();
});
it('renders the frozen heading bank and authored table/flow context without answer-key reconstruction or editable inputs', () => {
  const value = { instruction: 'Choose the correct heading.', options: [{ label: 'i', text: 'Original heading' }, { label: 'ii', text: 'Different original heading' }], paragraph_labels: ['A', 'B'],
    template: { heading: 'Original context', headers: ['Place', 'Arrival'], rows: [['Library', [{ prefix: 'Arrive at', q_num: 1, suffix: 'pm' }]]], steps: [{ text: 'First original step' }, { prefix: 'Go to', q_num: 2 }] },
    response_policy: { accepted_answers: ['PRIVATE_KEY_NEVER_RENDER'] }, context_provenance: { options: 'submission_snapshot' } };
  const { container } = render(<ReviewQuestionContext value={value} />);
  expect(screen.getByText('Original heading')).toBeTruthy(); expect(screen.getByText(/Arrive at/)).toBeTruthy();
  expect(screen.getByText('[Câu 1]')).toBeTruthy(); expect(screen.getByText('First original step')).toBeTruthy();
  expect(within(screen.getByRole('table')).getAllByRole('cell')).toHaveLength(2);
  expect(container.querySelector('input,select,textarea')).toBeNull(); expect(container.textContent).not.toContain('PRIVATE_KEY_NEVER_RENDER');
});
it('a saved empty bank stays empty, and image context retains its authored identity', () => {
  const { container } = render(<ReviewQuestionContext value={{ options: [], image_url: 'https://fixture.test/frozen-map.png', image_alt: 'Original map', context_provenance: { options: 'submission_snapshot' } }} />);
  expect(screen.getByRole('img', { name: 'Original map' }).getAttribute('src')).toBe('https://fixture.test/frozen-map.png');
  expect(container.querySelector('ul')).toBeNull();
});
it('both review normalizers retain top-level and per-field provenance and empty frozen context', () => {
  const context_source = { provenance: 'submission_snapshot', possibly_changed: false, paper_revision: 7 };
  const item = { q_num: 1, correct: false, passage_order: 1, question_context: { options: [], context_provenance: { options: 'submission_snapshot' } } };
  const reading = normalizeReadingReview({ status: 'submitted', attempt_id: 'a', score: 0, max_score: 1, context_source, passages: [{ passage_order: 1 }], review: [item] });
  const listening = normalizeListeningReview({ status: 'submitted', attempt_id: 'a', score: 0, max_score: 1, context_source, sections: [{ section_num: 1 }], review: [item] });
  for (const result of [reading, listening]) {
    expect(result.contextSource).toEqual(context_source); expect(result.review[0].question_context.options).toEqual([]);
    expect(result.review[0].question_context.context_provenance.options).toBe('submission_snapshot');
  }
});
it('renders the persisted L025 authored A–H bank and map through the native review context', () => {
  const result = normalizeListeningReview({ preview: true, status: 'submitted', score: null, max_score: 1,
    sections: [{ section_num: 2 }], review: [{ q_num: 16, correct: false, question_context: l025.expected_context }] });
  const { container } = render(<ReviewQuestionContext value={result.review[0].question_context} />);
  const bank = screen.getByRole('list');
  expect(within(bank).getAllByRole('listitem').map(item => item.textContent?.trim())).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  const image = screen.getByRole('img', { name: 'Sơ đồ của câu hỏi' });
  expect(image.getAttribute('src')).toBe(`data:image/svg+xml;utf8,${encodeURIComponent(l025.authored_question.payload.map_svg)}`);
  expect(container.querySelector('svg')).toBeNull();
  expect(container.textContent).not.toContain('SmartCity Expo venue');
  expect(container.textContent).not.toContain('AI Image Generation');
  expect(container.querySelector('input,select,textarea')).toBeNull();
});
it('keeps authored inline SVG inert and preserves the existing image URL and heading fallback', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>Map</text></svg>';
  const view = render(<ReviewQuestionContext value={{ map_svg: svg, template: { heading: 'Original map' } }} />);
  expect(screen.getByRole('img', { name: 'Original map' }).getAttribute('src')).toBe(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
  expect(view.container.querySelector('svg,script')).toBeNull();
  view.rerender(<ReviewQuestionContext value={{ map_svg: '', map_image_url: 'https://fixture.test/map.png', image_alt: 'Authored map' }} />);
  expect(screen.getByRole('img', { name: 'Authored map' }).getAttribute('src')).toBe('https://fixture.test/map.png');
});
