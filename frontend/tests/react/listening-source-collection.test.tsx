import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningSourceCollection } from '@/app/(authed-listening)/listening/ielts/80-days/source-collection';
import { ListeningSourceDay } from '@/app/(authed-listening)/listening/ielts/80-days/[day]/source-day';
import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';
import { ListeningSourceExplanation } from '@/components/listening-source-explanation';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'source-learner' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const availability = { questions: 'available', audio: 'missing', transcript: 'available', printed_key: 'missing', explanations: 'reviewed' };
const block = { block_id: 'matching', part_id: 'part1', kind: 'matching', instruction: { source_en: 'Match each word.', student_vi: 'Nối từ theo số audio.' }, item_ids: ['q7', 'q8'], source_question_numbers: [7, 8], images: [{ asset_id: 'question-image', url: '/signed-question.png', expires_in: 7200, width: 1200, height: 300, alt_vi: 'Bốn từ trong nhóm lựa chọn' }], shared_options: [], description: 'Fragile / Surprise / Fast / Lightful', display_kind: 'practice' };

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  auth.status = 'signed-in'; auth.user = { id: 'source-learner' };
  localStorage.clear();
  vi.stubGlobal('crypto', { randomUUID: () => 'source-claim' });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.assign(window, { api: { getWith: vi.fn(), postWith: vi.fn(), patchWith: vi.fn(async () => ({})) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps a disputed original printed key separate from the editorial reference answer', () => {
  render(<ListeningSourceExplanation reviewStatus="SUSPECT" explanation={{ answer: 'wreaths', printed_key: { answer: 'wreath', evidence_tier: 'PRINTED', source_pdf_page: 203, source_ocr_line_index_1_based: 10 }, why_vi: 'Cần đối chiếu số ít và số nhiều.', source_answer_warning_vi: 'Key in dùng số ít, transcript dùng số nhiều.', evidence: [] }} />);
  expect(screen.getByText('Đáp án tham khảo:').parentElement?.textContent).toContain('wreaths');
  expect(screen.getByText('Đáp án in trong sách:').parentElement?.textContent).toContain('wreath · PDF trang 203, dòng 10');
  expect(screen.getByText('Key in dùng số ít, transcript dùng số nhiều.')).toBeTruthy();
});

it.each([
  ['PRINTED_EMBEDDED_KEY', 'Đáp án in trong sách:'],
  ['EXPLANATION_DERIVED', 'Đáp án suy ra từ phần giảng giải:'],
  ['UNKNOWN', 'Đáp án nguồn cần đối chiếu:'],
])('shows the %s key tier and preserves all protected source citations', (tier, label) => {
  render(<ListeningSourceExplanation reviewStatus="UNRESOLVED" provenance={tier === 'EXPLANATION_DERIVED' ? 'explanation_derived_verified' : 'provisional'} explanation={{
    answer: null, printed_key: { answer: ['A', 'C', 'E', 'G'], evidence_tier: tier,
      source_lines: [{ pdf_page: 143, line_index_1_based: 27 }, { pdf_page: 143, line_index_1_based: 31 }, { pdf_page: 144, line_index_1_based: 5 }] },
    why_vi: 'Đối chiếu với phần giảng giải; chưa chứng nhận chấm tự động.', evidence: [],
  }} />);
  expect(screen.getByText(label).parentElement?.textContent).toContain('A · C · E · G');
  expect(screen.getByText(/PDF trang 143, dòng 27/).textContent).toContain('PDF trang 143, dòng 31 · PDF trang 144, dòng 5');
  expect(screen.queryByText('Đáp án tham khảo:')).toBeNull();
  if (tier === 'EXPLANATION_DERIVED') {
    expect(screen.queryByText('Đáp án in trong sách:')).toBeNull();
    expect(screen.getByText(/Đáp án suy ra từ giảng giải đã được đối chiếu/)).toBeTruthy();
  }
});

it('keeps vocabulary/no-audio days reachable and filters the actual canonical groups', async () => {
  window.api.getWith = vi.fn(async () => ({ collection_id: '80-days', title: '80 days', package_id: 'release', manifest_sha256: 'hash', partial_data: true, groups: [
    { id: 'short_practice', title: 'Luyện ngắn', days: [{ day: 1, lesson_id: 'day1', title: 'Nghe từ', group: 'short_practice', availability: { ...availability, audio: 'available' }, source_position_count: 25, practice_item_count: 24, source_only_count: 1, form_count: 3, completed_form_count: 1, in_progress_form_count: 1 }] },
    { id: 'vocabulary', title: 'Từ vựng', days: [{ day: 61, lesson_id: 'day61', title: 'Chọn khóa học', group: 'vocabulary', availability: { ...availability, audio: 'not_expected' }, source_position_count: 0, practice_item_count: 0, source_only_count: 0, form_count: 0 }] },
    { id: 'mock', title: 'Đề mô phỏng', days: [{ day: 77, lesson_id: 'day77', title: 'Mock 7', group: 'mock', availability, source_position_count: 40, practice_item_count: 0, source_only_count: 40, form_count: 0 }] },
  ] }));
  render(<ListeningSourceCollection />);
  await screen.findByText('Chọn khóa học');
  expect(screen.getByRole('link', { name: /Ngày 77/ }).getAttribute('href')).toBe('/listening/ielts/80-days/77');
  expect(screen.getByText(/Tiến độ hiện chưa tải đầy đủ/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Từ vựng' }));
  expect(screen.queryByText('Mock 7')).toBeNull();
  expect(screen.getByText('Chọn khóa học')).toBeTruthy();
});

it('opens missing-audio study explicitly without starting or completing a practice attempt', async () => {
  const studyBlock = { ...block, display_kind: 'source_study', images: [] };
  window.api.getWith = vi.fn(async () => ({ collection_id: '80-days', package_id: 'release', manifest_sha256: 'hash', day: 77, lesson_id: 'day77', title: 'Ngày thiếu audio', group: 'mock', availability, source_position_count: 2, practice_item_count: 0, source_only_count: 2, parts: [{ part_id: 'part1', source_label: 'Section 1', item_count: 0, source_position_count: 2, audio_status: 'missing', timing_granularity: 'none', form: null }], blocks: [studyBlock], vocabulary_groups: [], source_only_positions: [] }));
  window.api.postWith = vi.fn(async () => ({ mode: 'source_study', independent_practice: false, day: 77, blocks: [{ ...studyBlock, items: [{ item_id: 'q7', source_display_number: '7', review_status: 'AMBIGUOUS', answer_provenance: 'Tài liệu nguồn', explanation: { answer: 'reference-only', why_vi: 'Giải thích của tài liệu.', evidence: [] } }], transcript: [] }] }));
  render(<ListeningSourceDay day={77} />);
  await screen.findByText('Ngày thiếu audio');
  expect(screen.queryByRole('link', { name: /Bắt đầu luyện/ })).toBeNull();
  expect(screen.queryByText('reference-only')).toBeNull();
  expect(window.api.postWith).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Mở tài liệu tự học' }));
  await screen.findByText(/reference-only/);
  expect(window.api.postWith).toHaveBeenCalledWith('/api/listening/source-collections/80-days/days/77/study', { block_ids: ['matching'] }, undefined, { signal: expect.any(AbortSignal) });
  expect(screen.getByText(/không phải lượt làm độc lập/)).toBeTruthy();
});

function studyDay(day: number) {
  return { collection_id: '80-days', package_id: 'release', manifest_sha256: 'hash', day, lesson_id: `day${day}`, title: `Ngày ${day} đang học`, group: 'mock', availability, source_position_count: 2, practice_item_count: 0, source_only_count: 2, parts: [], blocks: [{ ...block, display_kind: 'source_study', images: [] }], vocabulary_groups: [], source_only_positions: [] };
}
function studyReply(day: number, answer: string) {
  return { mode: 'source_study', independent_practice: false, day, blocks: [{ ...block, images: [], items: [{ item_id: 'q7', source_display_number: '7', explanation: { answer, why_vi: 'Chỉ tài liệu đúng ngày và tài khoản mới được hiển thị.', evidence: [] } }], transcript: [] }] };
}

it.each(['day', 'account'])('discards an old study POST when the %s changes', async (boundary) => {
  let resolve!: (value: unknown) => void;
  window.api.getWith = vi.fn(async (url: string) => studyDay(Number(url.split('/').pop())));
  window.api.postWith = vi.fn(() => new Promise((done) => { resolve = done; }));
  const view = render(<ListeningSourceDay day={77} />);
  await screen.findByText('Ngày 77 đang học');
  fireEvent.click(screen.getByRole('button', { name: 'Mở tài liệu tự học' }));
  const signal = (window.api.postWith as ReturnType<typeof vi.fn>).mock.calls[0][3].signal;
  if (boundary === 'account') auth.user = { id: 'another-learner' };
  view.rerender(<ListeningSourceDay day={boundary === 'day' ? 78 : 77} />);
  await screen.findByRole('button', { name: 'Mở tài liệu tự học' });
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(studyReply(77, 'OLD_SCOPE_ANSWER')); });
  expect(screen.queryByText(/OLD_SCOPE_ANSWER/)).toBeNull();
  window.api.postWith = vi.fn(async () => studyReply(boundary === 'day' ? 78 : 77, 'CURRENT_SCOPE_ANSWER'));
  fireEvent.click(screen.getByRole('button', { name: 'Mở tài liệu tự học' }));
  await screen.findByText(/CURRENT_SCOPE_ANSWER/);
});

it('clears already opened study immediately when the authenticated account changes', async () => {
  window.api.getWith = vi.fn(async () => studyDay(77));
  window.api.postWith = vi.fn(async () => studyReply(77, 'FIRST_ACCOUNT_ANSWER'));
  const view = render(<ListeningSourceDay day={77} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mở tài liệu tự học' }));
  await screen.findByText(/FIRST_ACCOUNT_ANSWER/);
  auth.user = { id: 'second-account' };
  view.rerender(<ListeningSourceDay day={77} />);
  expect(screen.queryByText(/FIRST_ACCOUNT_ANSWER/)).toBeNull();
  await screen.findByRole('button', { name: 'Mở tài liệu tự học' });
});

it('translates canonical explanation provenance and retains precise evidence references', () => {
  render(<ListeningSourceExplanation provenance="editorial_verified" explanation={{ answer: 'C', why_vi: 'Đối chiếu với nguồn.', evidence: [{ source_kind: 'printed_transcript', pdf_page: 249, line_index_1_based: 6, quote: 'Crown.' }] }} />);
  expect(screen.getByText(/Đáp án biên tập đã được đối chiếu/)).toBeTruthy();
  expect(screen.getByText('Transcript in trong sách · PDF trang 249, dòng 6')).toBeTruthy();
  expect(screen.queryByText(/editorial_verified|printed_transcript/)).toBeNull();
});

it('groups a matching block once, hides solutions until saved reveal, and preserves source numbering', async () => {
  const sourceQuestions = [7, 8].map((number, index) => ({ q_num: index + 1, source_item_id: `q${number}`, source_display_number: String(number), source_block_id: 'matching', prompt: `Từ audio ${number}`, response_type: 'single_choice', options: { fragile: 'Fragile', fast: 'Fast' } }));
  window.api.postWith = vi.fn(async (url: string) => url.endsWith('/reveal') ? { items: [{ q_num: 1, state: 'unscored', correct: null, first_answer: 'fast', explanation: { answer: 'Fast', why_vi: 'Quick và fast cùng chỉ tốc độ.', evidence: [{ source_kind: 'printed_transcript', pdf_page: 249, line_index_1_based: 6, quote: '7. Quick' }] } }] } : { attempt_id: 'source-attempt', answers: [] });
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state') ? { items: [] } : { title: 'Ngày 1 — Part 1', programme_id: 'ielts-80-days-listening', source_day: 1, listening_lesson_id: 'lesson-uuid', audio_granularity: 'whole_day', replay_policy: 'allowed', scoring_policy: 'report_only', audio_url: '/day01.mp3', source_blocks: [block], sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: sourceQuestions } }] }] });
  render(<ProgrammeFormRunner testId="source-form" />);
  await screen.findByText('Từ audio 7');
  expect(screen.getAllByText('Nối từ theo số audio.')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '← Bài học' }).getAttribute('href')).toBe('/listening/ielts/80-days/1');
  fireEvent.click(screen.getByRole('button', { name: 'Luyện từng bước' }));
  expect(screen.getByText('Tập trung vào câu 7–8')).toBeTruthy();
  expect(screen.queryByText('7. Quick')).toBeNull();
  fireEvent.click(screen.getAllByRole('radio', { name: 'Fast' })[0]);
  await waitFor(() => expect(window.api.patchWith).toHaveBeenCalledWith('/api/listening/tests/attempts/source-attempt/answers', { q_num: 1, user_answer: 'fast' }, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) })));
  fireEvent.click(screen.getAllByRole('button', { name: 'Đối chiếu câu này' })[0]);
  await screen.findByText('7. Quick');
  expect(screen.getByText(/Tự đối chiếu với gợi ý/)).toBeTruthy();
});

it('restores multiple blanks and saves them under one original source position', async () => {
  const question = { q_num: 1, source_item_id: 'q16', source_display_number: '16', source_block_id: 'gaps', prompt: 'Complete both blanks.', response_type: 'multi_gap_completion', options: {}, fields: [{ field_id: 'activity', prompt: 'Hoạt động', word_limit: 2 }, { field_id: 'place', prompt: 'Địa điểm', word_limit: 2 }] };
  window.api.postWith = vi.fn(async () => ({ attempt_id: 'gap-attempt', answers: [{ q_num: 1, user_answer: '{"activity":"dinner","place":""}' }] }));
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state') ? { items: [] } : { title: 'Hai chỗ trống', programme_id: 'ielts-80-days-listening', source_day: 4, replay_policy: 'allowed', scoring_policy: 'report_only', audio_url: '/day04.mp3', source_blocks: [], sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: [question] } }] }] });
  render(<ProgrammeFormRunner testId="gap-form" />);
  const place = await screen.findByRole('textbox', { name: /Địa điểm/ });
  expect((screen.getByRole('textbox', { name: /Hoạt động/ }) as HTMLInputElement).value).toBe('dinner');
  fireEvent.change(place, { target: { value: 'New York' } });
  fireEvent.blur(place);
  await waitFor(() => expect(window.api.patchWith).toHaveBeenCalledWith('/api/listening/tests/attempts/gap-attempt/answers', { q_num: 1, user_answer: '{"activity":"dinner","place":"New York"}' }, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect(screen.getAllByText('Không quá 2 từ cho chỗ trống này.')).toHaveLength(2);
  expect(screen.getByText('1/1 câu đã thử')).toBeTruthy();
});
