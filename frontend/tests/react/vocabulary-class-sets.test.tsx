import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VocabularyHubBehavior } from '@/app/(authed-vocabulary-hub)/vocabulary/hub/vocabulary-hub-behavior';
import { VocabularyStudy } from '@/app/(authed-vocabulary-hub)/vocabulary/study/[sessionId]/study';
import { AdminVocabularySetEditor } from '@/app/(authed-admin-vocab)/admin/vocab/sets/sets-console';
import { VocabularySetDetail } from '@/app/(authed-vocabulary-hub)/vocabulary/sets/[setId]/set-detail';
import { FlashcardStudyPlayer } from '@/app/(flashcard-study)/flashcard-study/flashcard-study-player';

vi.mock('client-only', () => ({}));
const mocks = vi.hoisted(() => ({ view: 'today', push: vi.fn(), replace: vi.fn(), auth: { status: 'signed-in', user: { id: 'learner-a' } as { id: string } | null } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`view=${mocks.view}`), useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: async () => ({ flashcard_enabled: true, d1_enabled: true, vocab_curated_enabled: false }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const card = { id: 'card-1', headword: 'acquire', slug: 'acquire', category: 'education', gloss_vi: 'tiếp thu', example: 'We acquire skills.', pronunciation: '', definition_en: '', level: 'B2', part_of_speech: 'v', audio_headword: '', audio_example: '' };
const set = { id: 'set-1', title: 'C2 · Education', description: 'Bộ từ lớp C2', status: 'published', version: 2, published_revision: 1,
  library: false, course_ids: ['course-2'], cohort_ids: [], card_ids: [card.id], cards: [card], progress: [], mode_counts: { flashcards: 1, learn: 1, cloze: 1, test: 1 } };
const catalog = { sets: [set], courses: [{ id: 'course-2', name: 'Khóa C2' }], cohorts: [], sessions: [] };
function session(mode = 'learn') { return { id: 'session-1', set_id: 'set-1', title: 'Education', revision: 1, mode,
  items: [{ card_id: card.id, prompt: 'tiếp thu', card: mode === 'flashcards' ? card : null }], answers: [], completed: false, correct: null }; }
function api(get: (url: string) => unknown, post: (url: string, body: any) => unknown = async () => ({})) {
  const transport = { getWith: vi.fn(get), post: vi.fn(post) };
  Object.defineProperty(window, 'api', { configurable: true, value: transport }); return transport;
}
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/'); mocks.auth.status = 'signed-in'; mocks.auth.user = { id: 'learner-a' }; mocks.view = 'today'; vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('keeps navigation and the learning action before truthful metrics', async () => {
  api(async url => url.includes('home-summary') ? { skills: { vocabulary: { wallet_words: 68, quiz_words_mastered: 0, quiz_sessions: 0 } } } : catalog);
  render(<VocabularyHubBehavior />);
  const action = await screen.findByRole('link', { name: 'Xem bộ từ của lớp' });
  expect(screen.getByRole('navigation', { name: 'Điều hướng từ vựng' }).querySelectorAll('a')).toHaveLength(4);
  expect(action.compareDocumentPosition(screen.getByText('Từ đã lưu')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText('Từ đã thuộc')).toBeNull();
  expect(await screen.findByRole('link', { name: 'C2 · Education' })).toBeTruthy();
});

it('hides prior account data immediately while the next account read is pending', async () => {
  let resolveB: (value: unknown) => void = () => {};
  api(url => url.includes('home-summary') ? Promise.resolve({}) : mocks.auth.user?.id === 'learner-a' ? Promise.resolve(catalog) : new Promise(resolve => { resolveB = resolve; }));
  const view = render(<VocabularyHubBehavior />);
  await screen.findByRole('link', { name: 'C2 · Education' });
  mocks.auth.user = { id: 'learner-b' }; view.rerender(<VocabularyHubBehavior />);
  expect(screen.queryByRole('link', { name: 'C2 · Education' })).toBeNull();
  await waitFor(() => expect(screen.getByText('Đang tải bộ từ của bạn…')).toBeTruthy());
  resolveB({ ...catalog, sets: [] });
  await screen.findByText('Chưa có bộ từ được phân. Bạn vẫn có thể tra cứu và ôn từ đã lưu.');
});

it('explains missing cloze examples and starts only a chosen set mode', async () => {
  const transport = api(async () => ({ ...set, mode_counts: { ...set.mode_counts, cloze: 0 } }), async (_, body) => ({ ...session(body.mode), id: 'session-1' }));
  render(<VocabularySetDetail setId="set-1" />);
  expect((await screen.findByRole('button', { name: 'Chưa đủ nội dung' })).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu luyện nhớ' }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/vocabulary/study/session-1'));
  expect(transport.post.mock.calls[0][0]).toBe('/api/vocabulary-sets/set-1/sessions');
  expect(transport.post.mock.calls[0][1].mode).toBe('learn');
});

it('course filtering includes class-only assignments and the common library', async () => {
  mocks.view = 'sets';
  api(async url => url.includes('home-summary') ? {} : { ...catalog,
    cohorts: [{ id: 'class-2', name: 'C2 evening', course_id: 'course-2' }],
    sets: [{ ...set, title: 'Class-only set', course_ids: [], cohort_ids: ['class-2'] },
      { ...set, id: 'common', title: 'Common set', library: true, course_ids: [] },
      { ...set, id: 'other', title: 'Other course', course_ids: ['course-3'] }],
  });
  render(<VocabularyHubBehavior />);
  await screen.findByRole('link', { name: 'Class-only set' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'course-2' } });
  expect(screen.getByRole('link', { name: 'Class-only set' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Common set' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Other course' })).toBeNull();
});

it('retries lost answer acknowledgement with the same ID and does not advance early', async () => {
  let saved = session(); let failed = false;
  const transport = api(async () => saved, async (_, body) => {
    saved = { ...session(), answers: [{ index: 0, answer: body.answer, expected: 'acquire', correct: true, rating: null }] as any, completed: true, correct: 1 };
    if (!failed) { failed = true; throw new Error('Mất xác nhận lưu'); }
    return saved;
  });
  const view = render(<VocabularyStudy sessionId="session-1" />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'acquire' } });
  expect(screen.queryByText('Đáp án: acquire')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra và lưu' }));
  await screen.findByText('Mất xác nhận lưu');
  expect(screen.queryByText('Phiên học đã hoàn tất')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await screen.findByText('Đáp án: acquire');
  expect(transport.post.mock.calls[0][1].client_id).toBe(transport.post.mock.calls[1][1].client_id);
  view.unmount(); render(<VocabularyStudy sessionId="session-1" />);
  await screen.findByText('Phiên học đã hoàn tất');
  expect(screen.getByText('1/1 câu đúng. Kết quả đã lưu vào tài khoản.')).toBeTruthy();
});

it('keeps Test answers hidden until immutable submission and restores its input draft', async () => {
  let saved = session('test');
  const transport = api(async () => saved, async (_, body) => { saved = { ...saved, completed: true, correct: 1, answers: [{ index: 0, answer: body.answers[0], expected: 'acquire', correct: true, rating: null }] as any }; return saved; });
  const view = render(<VocabularyStudy sessionId="session-1" />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'acquire' } });
  view.unmount(); render(<VocabularyStudy sessionId="session-1" />);
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('acquire'));
  expect(screen.queryByText('acquire')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Nộp bài kiểm tra' }));
  await screen.findByText('Phiên học đã hoàn tất');
  expect(transport.post).toHaveBeenCalledTimes(1);
  expect(transport.post.mock.calls[0][0]).toMatch(/\/submit$/);
});

it.each(['learn', 'test'])('Retry reads canonical accepted work after a second tab wins: %s', async mode => {
  let saved = session(mode);
  let finishRead: ((value: unknown) => void) | null = null;
  const conflict = Object.assign(new Error('Phiên đã được cập nhật ở tab khác.'), { status: 409 });
  const transport = api(() => transport.getWith.mock.calls.length === 1 ? Promise.resolve(saved) : new Promise(resolve => { finishRead = resolve; }),
    async () => { saved = { ...saved, completed: true, correct: 1, answers: [{ index: 0, answer: 'acquire', expected: 'acquire', correct: true, rating: null }] as any }; throw conflict; });
  render(<VocabularyStudy sessionId="session-1" />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'acquire' } });
  fireEvent.click(screen.getByRole('button', { name: mode === 'test' ? 'Nộp bài kiểm tra' : 'Kiểm tra và lưu' }));
  await screen.findByText(conflict.message);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(transport.getWith).toHaveBeenCalledTimes(2));
  expect(transport.post).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  await act(async () => { finishRead!(saved); });
  await screen.findByRole('heading', { name: 'Phiên học đã hoàn tất' });
  expect(transport.post).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem('vocab-study:learner-a:session-1')!).pending).toBeNull();
});

it('a failed conflict refetch remains retryable without replaying a stale answer', async () => {
  const saved = { ...session(), completed: true, correct: 1, answers: [{ index: 0, answer: 'acquire', expected: 'acquire', correct: true, rating: null }] };
  const transport = api(async () => { if (transport.getWith.mock.calls.length === 1) return session(); if (transport.getWith.mock.calls.length === 2) throw new Error('Không tải được trạng thái mới'); return saved; },
    async () => { throw Object.assign(new Error('Câu đã lưu ở tab khác'), { status: 409 }); });
  render(<VocabularyStudy sessionId="session-1" />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'acquire' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra và lưu' }));
  await screen.findByText('Câu đã lưu ở tab khác'); fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await screen.findByText('Không tải được trạng thái mới');
  expect(JSON.parse(sessionStorage.getItem('vocab-study:learner-a:session-1')!).pending).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' })); await screen.findByRole('heading', { name: 'Phiên học đã hoàn tất' });
  expect(transport.post).toHaveBeenCalledTimes(1);
});

it('conflict reconciliation advances to the next canonical item with a fresh request', async () => {
  let saved = { ...session(), items: [...session().items, { card_id: 'card-2', prompt: 'giữ lại', card: null }] };
  const firstAnswer = { index: 0, answer: 'acquire', expected: 'acquire', correct: true, rating: null };
  const transport = api(async () => saved, async (_, body) => {
    if (transport.post.mock.calls.length === 1) {
      saved = { ...saved, answers: [firstAnswer] as any };
      throw Object.assign(new Error('Câu đã lưu ở tab khác'), { status: 409 });
    }
    saved = { ...saved, completed: true, correct: 2, answers: [firstAnswer, { index: 1, answer: body.answer, expected: 'retain', correct: true, rating: null }] as any };
    return saved;
  });
  render(<VocabularyStudy sessionId="session-1" />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'acquire' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra và lưu' }));
  await screen.findByText('Câu đã lưu ở tab khác'); fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  const next = await screen.findByRole('textbox', { name: '2. giữ lại' });
  expect((next as HTMLInputElement).disabled).toBe(false);
  fireEvent.change(next, { target: { value: 'retain' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra và lưu' }));
  await screen.findByText('Đáp án: retain');
  expect(transport.post.mock.calls[1][1].index).toBe(1);
  expect(transport.post.mock.calls[1][1].client_id).not.toBe(transport.post.mock.calls[0][1].client_id);
});

it('a progress conflict without an accepted answer retains the original request for retry', async () => {
  const transport = api(async () => session(), async (_, body) => {
    if (transport.post.mock.calls.length === 1) throw Object.assign(new Error('Tiến độ đang cập nhật'), { status: 409 });
    return { ...session(), completed: true, correct: 1, answers: [{ index: 0, answer: body.answer, expected: 'acquire', correct: true, rating: null }] };
  });
  render(<VocabularyStudy sessionId="session-1" />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'acquire' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra và lưu' }));
  await screen.findByText('Tiến độ đang cập nhật'); fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await screen.findByText('Phiên chưa ghi yêu cầu này. Thử lại để lưu cùng yêu cầu.');
  expect(transport.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' })); await screen.findByText('Đáp án: acquire');
  expect(transport.post.mock.calls[1][1]).toEqual(transport.post.mock.calls[0][1]);
});

it('saves draft order and audience before publishing and uses the acknowledged revision', async () => {
  const posts: any[] = [];
  api(async url => url.endsWith('/outcomes') ? { learners: [] } : url.includes('/cards') ? { cards: [card] } : url.endsWith('/set-1') ? { ...set, status: 'draft', version: 1 } : catalog,
    async (url, body) => { posts.push({ url, body }); return { ...set, title: body.title || 'Renamed', version: posts.length + 1 }; });
  render(<AdminVocabularySetEditor setId="set-1" />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Tên bộ' }), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu và xuất bản' }));
  await screen.findByText('Đã xuất bản. Học viên trong phạm vi được phân có thể mở bộ từ.');
  expect(posts).toHaveLength(2);
  expect(posts[0].body).toMatchObject({ expected_version: 1, title: 'Renamed', card_ids: ['card-1'], course_ids: ['course-2'] });
  expect(posts[1].body).toEqual({ expected_version: 2, action: 'publish' });
});

it.each([
  { first: 'Bắt đầu luyện nhớ', next: 'Bắt đầu kiểm tra', mode: 'test', review: false },
  { first: 'Bắt đầu thẻ ghi nhớ', next: 'Ôn 1 từ đến hạn', mode: 'flashcards', review: true },
])('a failed start does not replace the next selected action: $next', async ({ first, next, mode, review }) => {
  const transport = api(async () => ({ ...set, progress: [{ card_id: card.id, familiar: false, recall_attempts: 0, recall_correct: 0, next_review_at: '2020-01-01T00:00:00Z', review_count: 1 }] }),
    async (_, body) => { if (transport.post.mock.calls.length === 1) throw new Error('Start response lost'); return { ...session(body.mode), id: 'next-session' }; });
  const view = render(<VocabularySetDetail setId="set-1" />);
  fireEvent.click(await screen.findByRole('button', { name: first }));
  await screen.findByText('Start response lost');
  const previous = transport.post.mock.calls[0][1];
  view.unmount(); render(<VocabularySetDetail setId="set-1" />);
  fireEvent.click(await screen.findByRole('button', { name: next }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/vocabulary/study/next-session'));
  expect(transport.post.mock.calls[1][1]).toMatchObject({ mode, review_only: review });
  expect(transport.post.mock.calls[1][1].client_id).not.toBe(previous.client_id);
});

function publicFetch() {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ category: 'education', cards: [card] }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  Object.defineProperty(window, 'api', { configurable: true, value: { base: 'https://fixture.invalid' } });
  history.replaceState(null, '', '/flashcard-study?stack=wiki:education');
  return fetcher;
}

it('public flashcards wait for initial auth and store marks under the resolved account', async () => {
  const fetcher = publicFetch();
  mocks.auth.status = 'initial-loading'; mocks.auth.user = null;
  const view = render(<FlashcardStudyPlayer />);
  await act(async () => {});
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Tự đánh giá nhớ/ })).toBeNull();
  mocks.auth.status = 'signed-in'; mocks.auth.user = { id: 'learner-a' }; view.rerender(<FlashcardStudyPlayer />);
  fireEvent.click(await screen.findByRole('button', { name: /Tự đánh giá nhớ/ }));
  await screen.findByText('Đã hoàn thành 1 thẻ');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('vocabflash:wiki:education:account:learner-a')).toContain('known');
  expect(localStorage.getItem('vocabflash:wiki:education:account:guest')).toBeNull();
});

it('confirmed signed-out visitors can still study public flashcards', async () => {
  const fetcher = publicFetch(); mocks.auth.status = 'signed-out'; mocks.auth.user = null;
  render(<FlashcardStudyPlayer />);
  expect(await screen.findByRole('button', { name: /Tự đánh giá nhớ/ })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('invalid legacy stack links show an error instead of a permanent loading state', async () => {
  history.replaceState(null, '', '/flashcard-study?stack=invalid');
  render(<FlashcardStudyPlayer />);
  await screen.findByText('Liên kết học thiếu hoặc có stack không hợp lệ.');
  expect(screen.queryByText('Đang chuẩn bị bộ thẻ…')).toBeNull();
});
