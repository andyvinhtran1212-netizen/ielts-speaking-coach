import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningSourceCollection } from '@/app/(authed-listening)/listening/ielts/80-days/source-collection';
import { ListeningSourceDay } from '@/app/(authed-listening)/listening/ielts/80-days/[day]/source-day';
import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';
import { ListeningSourceExplanation } from '@/components/listening-source-explanation';
import { ListeningLandingBehavior } from '@/app/(authed-listening)/listening/listening-landing-behavior';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'source-learner' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (update: () => void) => {
    window.addEventListener('popstate', update);
    window.addEventListener('test:navigation', update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('test:navigation', update); };
  };
  return { useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search, () => '')) };
});

const availability = { questions: 'available', audio: 'missing', transcript: 'available', printed_key: 'missing', explanations: 'reviewed' };
const block = { block_id: 'matching', part_id: 'part1', kind: 'matching', instruction: { source_en: 'Match each word.', student_vi: 'Nối từ theo số audio.' }, item_ids: ['q7', 'q8'], source_question_numbers: [7, 8], images: [{ asset_id: 'question-image', url: '/signed-question.png', expires_in: 7200, width: 1200, height: 300, alt_vi: 'Bốn từ trong nhóm lựa chọn' }], shared_options: [], description: 'Fragile / Surprise / Fast / Lightful', display_kind: 'practice', native: { kind: 'questions', text: 'Native shared context', word_bank: ['Fragile', 'Surprise', 'Fast', 'Lightful'], figures: [], questions: [] } };

beforeEach(() => {
  window.history.replaceState(null, '', '/listening/ielts/80-days');
  const replaceState = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
    replaceState(data, unused, url);
    window.dispatchEvent(new Event('test:navigation'));
  });
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

function navigationCollection() {
  const day = (number: number, group: string) => ({ day: number, lesson_id: `day${number}`, title: `Bài ngày ${number}`, group, availability, practice_item_count: 0, source_position_count: 2, source_only_count: 2, form_count: 0 });
  return { collection_id: '80-days', groups: [
    { id: 'short_practice', title: 'Bài nghe ngắn · Day 1–50', days: [day(2, 'short_practice')] },
    { id: 'teaching', title: 'Luyện kỹ năng · Day 51–60', days: [day(51, 'teaching'), day(52, 'teaching')] },
    { id: 'vocabulary', title: 'Từ vựng · Day 61–70', days: [day(61, 'vocabulary')] },
    { id: 'mock', title: 'Đề mô phỏng · Day 71–80', days: [day(77, 'mock')] },
  ] };
}

it('keeps group and search through day links, explicit return, Back and reload without writes', async () => {
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/days/52') ? studyDay(52) : navigationCollection());
  let view = render(<ListeningSourceCollection />);
  await screen.findByText('Bài ngày 52');
  fireEvent.click(screen.getByRole('button', { name: 'Luyện kỹ năng · Day 51–60' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm ngày' }), { target: { value: '52' } });
  expect(window.location.pathname + window.location.search).toBe('/listening/ielts/80-days?group=teaching&q=52');
  expect(screen.queryByText('Bài ngày 51')).toBeNull();
  expect(screen.queryByText('Bài ngày 2')).toBeNull();
  const dayHref = screen.getByRole('link', { name: /Ngày 52/ }).getAttribute('href')!;
  expect(dayHref).toBe('/listening/ielts/80-days/52?group=teaching&q=52');
  expect(window.api.getWith).toHaveBeenCalledTimes(1);
  view.unmount();
  window.history.pushState(null, '', dayHref);
  view = render(<ListeningSourceDay day={52} />);
  await screen.findByText('Ngày 52 đang học');
  const returnHref = screen.getByRole('link', { name: '← 80 ngày Listening' }).getAttribute('href')!;
  expect(returnHref).toBe('/listening/ielts/80-days?group=teaching&q=52');
  expect(screen.getByRole('link', { name: 'Ngày 53 →' }).getAttribute('href')).toBe('/listening/ielts/80-days/53?group=teaching&q=52');
  await act(async () => {
    const popped = new Promise<void>((done) => window.addEventListener('popstate', () => done(), { once: true }));
    window.history.back();
    await popped;
  });
  view.unmount();
  view = render(<ListeningSourceCollection />);
  await screen.findByText('Bài ngày 52');
  expect(screen.getByRole('button', { name: 'Luyện kỹ năng · Day 51–60' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByRole('textbox', { name: 'Tìm ngày' }) as HTMLInputElement).value).toBe('52');
  view.unmount();
  window.history.replaceState(null, '', returnHref);
  render(<ListeningSourceCollection />);
  await screen.findByText('Bài ngày 52');
  expect(screen.queryByText('Bài ngày 51')).toBeNull();
  expect((screen.getByRole('textbox', { name: 'Tìm ngày' }) as HTMLInputElement).value).toBe('52');
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});

it('encodes search text and responds to URL changes while ignoring foreign and duplicate filters', async () => {
  window.api.getWith = vi.fn(async () => navigationCollection());
  render(<ListeningSourceCollection />);
  await screen.findByText('Bài ngày 52');
  const input = screen.getByRole('textbox', { name: 'Tìm ngày' });
  fireEvent.change(input, { target: { value: '  ' } });
  expect((input as HTMLInputElement).value).toBe('  ');
  fireEvent.change(input, { target: { value: '  ngày 52 & +?  ' } });
  expect(new URLSearchParams(window.location.search).get('q')).toBe('  ngày 52 & +?  ');
  await act(async () => { window.history.replaceState(null, '', '/listening/ielts/80-days?group=vocabulary&q=61'); });
  expect(screen.getByText('Bài ngày 61')).toBeTruthy();
  expect(screen.queryByText('Bài ngày 52')).toBeNull();
  await act(async () => { window.history.replaceState(null, '', '/listening/ielts/80-days?from=general&filter=new&group=teaching&group=mock&q=52&q=61&return_to=https://evil.test'); });
  expect(screen.getByRole('button', { name: 'Tất cả' }).getAttribute('aria-pressed')).toBe('true');
  expect((input as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('link', { name: /Ngày 52/ }).getAttribute('href')).toBe('/listening/ielts/80-days/52');
  expect(screen.getByText('Bài ngày 61')).toBeTruthy();
  expect(window.api.getWith).toHaveBeenCalledTimes(1);
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});

it('routes the three programme cards and a source next action to their own libraries', async () => {
  window.api.getWith = vi.fn(async () => ({ programmes: [
    { id: 'ielts-80-days-listening', title: '80 ngày luyện Listening', lesson_count: 80, form_count: 195 },
    { id: 'general-listening-practice', title: 'General Listening', lesson_count: 12, form_count: 36 },
    { id: 'ielts-listening-practice', title: 'IELTS Listening', lesson_count: 10, form_count: 30 },
  ] }));
  render(<ListeningLandingBehavior />);
  await screen.findByRole('heading', { name: '80 ngày luyện Listening' });
  for (const [title, href] of [['80 ngày luyện Listening', '/listening/ielts/80-days'], ['General Listening', '/listening/general'], ['IELTS Listening', '/listening/ielts']]) {
    expect(screen.getByRole('heading', { name: title }).closest('a')?.getAttribute('href')).toBe(href);
  }
  expect(screen.getByRole('link', { name: 'Bắt đầu luyện' }).getAttribute('href')).toBe('/listening/ielts/80-days');
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});

function studyDay(day: number) {
  return { collection_id: '80-days', package_id: 'release', manifest_sha256: 'hash', day, lesson_id: `day${day}`, title: `Ngày ${day} đang học`, group: 'mock', availability, source_position_count: 2, practice_item_count: 0, source_only_count: 2, parts: [], blocks: [{ ...block, display_kind: 'source_study', images: [] }], vocabulary_groups: [], source_only_positions: [] };
}
it('keeps unsupported days as audio-only without exposing source documents or starting an attempt', async () => {
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/audio') ? { day: 77, variants: [{ variant_id: 'kokoro-v1', label_vi: 'Bản luyện nghe', url: '/new77.mp3' }] } : studyDay(77));
  render(<ListeningSourceDay day={77} />);
  await screen.findByText('Ngày 77 đang học');
  expect(screen.getByText(/chưa có bài tập đủ dữ kiện/)).toBeTruthy();
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mở tài liệu tự học' })).toBeNull();
  expect(screen.queryByText('Đề và tài liệu nguồn')).toBeNull();
  expect(screen.queryByText('Native shared context')).toBeNull();
  expect(window.api.postWith).not.toHaveBeenCalled();
});

function practiceDay(day = 1) {
  return { ...studyDay(day), practice_item_count: 3, parts: [1, 2, 3].map((n) => ({ part_id: `p${n}`, source_label: `Part ${n}`, item_count: 1, form: { id: `form${n}`, status: 'new' } })) };
}
function installPracticeApi() {
  window.api.getWith = vi.fn(async (url: string) => {
    if (url.endsWith('/audio')) return { day: 1, variants: [{ variant_id: 'original', label_vi: 'Bản ghi gốc', url: '/original.mp3' }, { variant_id: 'kokoro-v1', label_vi: 'Bản luyện nghe', url: '/new.mp3' }] };
    if (url.includes('/source-collections/')) return practiceDay();
    if (url.endsWith('/guided-state')) return { items: [] };
    const id = url.match(/tests\/(form\d)/)?.[1] || 'form1';
    return { title: id, programme_id: 'ielts-80-days-listening', source_day: 1, scoring_policy: 'report_only', replay_policy: 'allowed', audio_url: '/original.mp3', source_blocks: [], sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: [{ q_num: 1, source_item_id: `${id}-q1`, prompt: `Question ${id}`, response_type: 'short_answer', options: {} }] } }] }] };
  });
  window.api.postWith = vi.fn(async (url: string) => ({ attempt_id: `attempt-${url.match(/tests\/(form\d)/)?.[1]}`, answers: [] }));
}

it('opens the first actual part immediately, retains drafts and pauses hidden media across mouse and keyboard tabs', async () => {
  installPracticeApi();
  const view = render(<ListeningSourceDay day={1} />);
  await screen.findByText('Question form1');
  expect(window.api.postWith).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link', { name: /Bắt đầu luyện/ })).toBeNull();
  expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('/new.mp3');
  const first = view.container.querySelector('audio')!;
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'unsent draft' } });
  fireEvent.click(screen.getByRole('tab', { name: /Part 2/ }));
  await screen.findByText('Question form2');
  expect(first.getAttribute('src')).toBeNull();
  await waitFor(() => expect(window.api.patchWith).toHaveBeenCalledWith('/api/listening/tests/attempts/attempt-form1/answers', { q_num: 1, user_answer: 'unsent draft' }, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) })));
  fireEvent.keyDown(screen.getByRole('tab', { name: /Part 2/ }), { key: 'ArrowLeft' });
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('unsent draft');
  expect(screen.getByRole('tab', { name: /Part 1/ }).getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Part 1/ }));
  expect(window.api.postWith).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/Kokoro|Đề và tài liệu nguồn|Tài liệu tự học/)).toBeNull();
});

it.each(['day', 'account'] as const)('aborts pending practice and discards stale answers on %s boundary', async (boundary) => {
  installPracticeApi();
  let resolve!: (value: unknown) => void;
  window.api.postWith = vi.fn(() => new Promise((done) => { resolve = done; }));
  const view = render(<ListeningSourceDay day={1} />);
  await waitFor(() => expect(window.api.postWith).toHaveBeenCalledTimes(1));
  const signal = (window.api.postWith as ReturnType<typeof vi.fn>).mock.calls[0][3].signal;
  const oldResolve = resolve;
  if (boundary === 'account') auth.user = { id: 'another-learner' };
  view.rerender(<ListeningSourceDay day={boundary === 'day' ? 2 : 1} />);
  expect(signal.aborted).toBe(true);
  await act(async () => oldResolve({ attempt_id: 'OLD_ATTEMPT', answers: [{ q_num: 1, user_answer: 'OLD_SCOPE_ANSWER' }] }));
  expect(view.container.textContent).not.toContain('OLD_SCOPE_ANSWER');
  expect((window.api.getWith as ReturnType<typeof vi.fn>).mock.calls.every((call) => !String(call[0]).includes('OLD_ATTEMPT'))).toBe(true);
});

it('translates canonical explanation provenance and retains precise evidence references', () => {
  render(<ListeningSourceExplanation provenance="editorial_verified" explanation={{ answer: 'C', why_vi: 'Đối chiếu với nguồn.', evidence: [{ source_kind: 'printed_transcript', pdf_page: 249, line_index_1_based: 6, quote: 'Crown.' }] }} />);
  expect(screen.getByText(/Đáp án biên tập đã được đối chiếu/)).toBeTruthy();
  expect(screen.getByText('Transcript in trong sách · PDF trang 249, dòng 6')).toBeTruthy();
  expect(screen.queryByText(/editorial_verified|printed_transcript/)).toBeNull();
});

it('keeps answer provenance and printed-key distinction without exposing PDF document references', () => {
  render(<ListeningSourceExplanation showSourceReferences={false} provenance="editorial_verified" explanation={{ answer: 'wreaths', printed_key: { answer: 'wreath', evidence_tier: 'PRINTED', source_pdf_page: 203 }, why_vi: 'Nghe số nhiều.', evidence: [{ source_kind: 'printed_transcript', pdf_page: 203, line_index_1_based: 10, quote: 'wreaths' }] }} />);
  expect(screen.getByText('Đáp án in trong sách:').parentElement?.textContent).toContain('wreath');
  expect(screen.getByText(/Đáp án biên tập đã được đối chiếu/)).toBeTruthy();
  expect(screen.getByText('Transcript in trong sách')).toBeTruthy();
  expect(screen.queryByText(/PDF trang|dòng 10/)).toBeNull();
});

it('shows safe authored limitations alongside eligible practice without source previews', async () => {
  installPracticeApi();
  const get = window.api.getWith;
  window.api.getWith = vi.fn(async (url: string, ...args: unknown[]) => url.endsWith('/days/29') ? { ...practiceDay(29), source_only_positions: [{ item_id: 'q13', part_id: 'p2', source_display_number: '13', reason_vi: 'Audio không nêu giờ khởi hành được hỏi ở câu này; chưa đủ dữ kiện để mở luyện.' }] } : get(url, ...args));
  render(<ListeningSourceDay day={29} />);
  await screen.findByText('Question form1');
  fireEvent.click(screen.getByText('1 câu chưa mở luyện — xem lý do'));
  expect(screen.getByText('Part 2 · Câu 13:')).toBeTruthy();
  expect(screen.getByText(/Audio không nêu giờ khởi hành/)).toBeTruthy();
  expect(screen.queryByText('Đề và tài liệu nguồn')).toBeNull();
});

it('allows an explicit original fallback after variants fail and retry restores the new default without a new attempt', async () => {
  installPracticeApi();
  const get = window.api.getWith;
  let unavailable = true;
  window.api.getWith = vi.fn(async (url: string, ...args: unknown[]) => { if (url.endsWith('/audio') && unavailable) throw new Error('temporary outage'); return get(url, ...args); });
  const view = render(<ListeningSourceDay day={1} />);
  await screen.findByText('Question form1');
  expect(view.container.querySelector('audio')?.getAttribute('src')).toBeNull();
  expect(screen.getByText(/Bạn có thể chọn Bản ghi gốc hoặc tải lại/)).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Phiên bản audio' }), { target: { value: 'original' } });
  expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('/original.mp3');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'retained during retry' } });
  unavailable = false;
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại audio' }));
  await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('/new.mp3'));
  expect((screen.getByRole('combobox', { name: 'Phiên bản audio' }) as HTMLSelectElement).value).toBe('kokoro-v1');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('retained during retry');
  expect(window.api.postWith).toHaveBeenCalledTimes(1);
});

it('groups a matching block once, hides solutions until saved reveal, and preserves source numbering', async () => {
  const sourceQuestions = [7, 8].map((number, index) => ({ q_num: index + 1, source_item_id: `q${number}`, source_display_number: String(number), source_block_id: 'matching', prompt: `Từ audio ${number}`, visual_url: '/legacy-pdf-crop.png', response_type: 'single_choice', options: { fragile: 'Fragile', fast: 'Fast' } }));
  window.api.postWith = vi.fn(async (url: string) => url.endsWith('/reveal') ? { items: [{ q_num: 1, state: 'unscored', correct: null, first_answer: 'fast', explanation: { answer: 'Fast', why_vi: 'Quick và fast cùng chỉ tốc độ.', evidence: [{ source_kind: 'printed_transcript', pdf_page: 249, line_index_1_based: 6, quote: '7. Quick' }] } }] } : { attempt_id: 'source-attempt', answers: [] });
  window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state') ? { items: [] } : { title: 'Ngày 1 — Part 1', programme_id: 'ielts-80-days-listening', source_day: 1, listening_lesson_id: 'lesson-uuid', audio_granularity: 'whole_day', replay_policy: 'allowed', scoring_policy: 'report_only', audio_url: '/day01.mp3', source_blocks: [block], sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: sourceQuestions } }] }] });
  render(<ProgrammeFormRunner testId="source-form" />);
  await screen.findByText('Từ audio 7');
  expect(screen.getAllByText('Nối từ theo số audio.')).toHaveLength(1);
  expect(screen.getByText('Native shared context')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
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

it('replays the new recording from zero and retains original timing only after explicitly choosing the original', async () => {
  installPracticeApi();
  const get = window.api.getWith;
  window.api.getWith = vi.fn(async (url: string, ...args: unknown[]) => url.endsWith('/guided-state') ? { items: [{ q_num: 1, source_item_id: 'form1-q1', first_answer: 'draft', state: 'unscored', correct: null, audio_window: { start: 12, end: 16 }, audio_granularity: 'question', explanation: { answer: 'reference', why_vi: 'AUDIO_TIMING_REFERENCE', evidence: [] } }] } : get(url, ...args));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const view = render(<ListeningSourceDay day={1} />);
  await screen.findByText('AUDIO_TIMING_REFERENCE');
  const audio = view.container.querySelector('audio')!;
  audio.currentTime = 5;
  fireEvent.click(screen.getByRole('button', { name: /Nghe toàn ngày/ }));
  expect(audio.currentTime).toBe(0);
  expect(audio.getAttribute('src')).toBe('/new.mp3');
  fireEvent.change(screen.getByRole('combobox', { name: 'Phiên bản audio' }), { target: { value: 'original' } });
  expect(audio.getAttribute('src')).toBe('/original.mp3');
  fireEvent.click(screen.getByRole('button', { name: /Nghe lại đoạn này/ }));
  expect(audio.currentTime).toBe(12);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
});
