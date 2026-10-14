import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VocabularyHubBehavior } from '@/app/(authed-vocabulary-hub)/vocabulary/hub/vocabulary-hub-behavior';
import { VocabularyStudy } from '@/app/(authed-vocabulary-hub)/vocabulary/study/[sessionId]/study';
import { AdminVocabularySetEditor } from '@/app/(authed-admin-vocab)/admin/vocab/sets/sets-console';
import { VocabularySetDetail } from '@/app/(authed-vocabulary-hub)/vocabulary/sets/[setId]/set-detail';

vi.mock('client-only', () => ({}));
const mocks = vi.hoisted(() => ({ view: 'today', push: vi.fn(), replace: vi.fn(), auth: { status: 'signed-in', user: { id: 'learner-a' } } }));
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
afterEach(() => { cleanup(); sessionStorage.clear(); mocks.auth.user = { id: 'learner-a' }; mocks.view = 'today'; vi.clearAllMocks(); });

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
  api(url => url.includes('home-summary') ? Promise.resolve({}) : mocks.auth.user.id === 'learner-a' ? Promise.resolve(catalog) : new Promise(resolve => { resolveB = resolve; }));
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
