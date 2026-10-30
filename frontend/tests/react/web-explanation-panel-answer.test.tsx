import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WebExplanationPanel } from '@/components/web-explanation-panel';
import overrides from '../../../backend/content_mock_correction/cambridge_release_overrides_v1.json';

afterEach(cleanup);

// The seven G-01 questions: the importer overrides item.answer without
// rewriting the authored answer_summary. Keep expectations explicit.
const cases = [
  ['cambridge-13-test-1-listening-q03', 'twenty percent', '20% / 20 percent / 20'],
  ['cambridge-15-test-3-listening-q05', 'one year', '1 year'],
  ['cambridge-19-test-2-listening-q05', 'eleven am', '11 / 11 am / 11 a.m.'],
  ['cambridge-19-test-3-listening-q03', 'three thirty', '3.30 / 3:30'],
  ['cambridge-21-test-2-listening-q01', '13(th) January', '13 January / 13th January / 13 Jan / 13th Jan / 13/01'],
  ['cambridge-21-test-2-listening-q06', '6(th) April', '6 April / 6th April / 6 Apr / 6th Apr / 06/04 / 6/04'],
  ['cambridge-21-test-3-listening-q03', 'two hundred and fifty', '250 / £250'],
];

function adjudicatedObject(objectId: string, staleAnswer: string) {
  return {
    object_id: objectId,
    item: { answer: overrides.items[objectId as keyof typeof overrides.items].answer },
    audit: { release_adjudication: { override_version: overrides.schema_version } },
    explanation: { answer_summary: `Đáp án chuẩn: ${staleAnswer}.` },
  };
}

function renderPanel(object: unknown, correctionRequired = false) {
  return render(<WebExplanationPanel object={object} skill="listening" attemptId={null}
    questionNumber={1} persistenceEnabled={false} correctionRequired={correctionRequired} />);
}

it.each(cases)('%s displays the adjudicated key instead of stale prose', (objectId, staleAnswer, expected) => {
  const { container } = renderPanel(adjudicatedObject(objectId, staleAnswer));
  expect(container.querySelector('.wex-answer > p')?.textContent).toBe(expected);
  expect(container.querySelectorAll('.wex-answer > span')).toHaveLength(1);
  expect(container.textContent).not.toContain(`Đáp án chuẩn: ${staleAnswer}.`);
});

it('puts canonical first, removes duplicate/empty forms and preserves answer text verbatim', () => {
  const { container } = renderPanel({
    item: { answer: { canonical: 'speaker notes', accepted_forms: ['notes', 'speaker notes', '', null, 'notes'] } },
    explanation: { answer_summary: 'outdated answer' },
  });
  expect(container.querySelector('.wex-answer > p')?.textContent).toBe('speaker notes / notes');
});

it.each([
  [{ canonical: 'A' }, 'A'],
  [{ accepted_forms: ['B', 'C'] }, 'B / C'],
  [{ canonical: 'A', accepted_forms: 'stale string' }, 'A'],
  [undefined, 'Chưa có đáp án chuẩn.'],
])('handles partial structured answers without reverting to prose: %j', (answer, expected) => {
  const { container } = renderPanel({ item: { answer }, explanation: { answer_summary: 'outdated answer' } });
  expect(container.querySelector('.wex-answer > p')?.textContent).toBe(expected);
  expect(container.textContent).not.toContain('outdated answer');
});

it('keeps the key hidden until the full explanation opens in the correction flow', async () => {
  const { container } = renderPanel(adjudicatedObject(cases[0][0], cases[0][1]), true);
  expect(container.querySelector('.wex-answer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tôi chưa tìm được' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chốt và tiếp tục' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem vị trí nguồn' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Mở gợi ý quyết định' }));
  const reveal = await screen.findByRole('button', { name: 'Mở lời giải đầy đủ' });
  expect(container.querySelector('.wex-answer')).toBeNull();
  fireEvent.click(reveal);
  await screen.findByText('Đáp án chuẩn');
  expect(container.querySelector('.wex-answer > p')?.textContent).toBe(cases[0][2]);
});

it.each([
  ['cambridge-20-test-1-listening-q24', ['A', 'C'], 'A, C'],
  ['cambridge-13-test-3-listening-q20', ['B', 'D'], 'B, D'],
])('%s joins an unordered_set ("choose TWO") key with commas, not alternatives', (objectId, letters, expected) => {
  const { container } = renderPanel({
    object_id: objectId,
    item: { answer: { canonical: letters, accepted_forms: letters, comparison_mode: 'unordered_set' } },
    explanation: { answer_summary: 'outdated answer' },
  });
  expect(container.querySelector('.wex-answer > p')?.textContent).toBe(expected);
});

it.each([
  [{ canonical: ['colour', 'color'], accepted_forms: ['color'], comparison_mode: 'any_of' }, 'colour / color'],
  [{ canonical: ['A', ['B', '', null]], comparison_mode: 'any_of' }, 'A / B'],
  [{ canonical: ['A', 'C'], comparison_mode: 'unordered_set' }, 'A, C'],
])('flattens an array canonical key like backend _flat(): %j', (answer, expected) => {
  const { container } = renderPanel({ item: { answer }, explanation: { answer_summary: 'outdated answer' } });
  expect(container.querySelector('.wex-answer > p')?.textContent).toBe(expected);
});
