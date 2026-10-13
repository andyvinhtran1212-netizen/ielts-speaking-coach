import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningLandingBehavior } from '@/app/(authed-listening)/listening/listening-landing-behavior';
import { ListeningProgrammeLibrary } from '@/app/(authed-listening)/listening/programme-library';
import { ListeningBrowseBehavior } from '@/app/(authed-listening)/listening/browse/listening-browse-behavior';
import { ListeningMiniTestBehavior } from '@/app/(authed-listening)/listening/mini-test/listening-mini-test-behavior';
import { listeningReviewParams, listeningReviewBackTarget } from '@/lib/listening-review-model.mjs';
import { listeningTestParams, listeningLibraryHref, listeningReviewHref } from '@/lib/listening-test-controller.mjs';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'listening-learner' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const lessons = { items: [{ id: 'lesson1', title: 'Bài nghe đã tải', sequence_num: 1, form_count: 2, completed_form_count: 1 }], partial_data: false };
const props = { programmeId: 'ielts-listening-practice', title: 'IELTS Listening', description: 'Thư viện', showIeltsModes: true };
beforeEach(() => {
  auth.status = 'signed-in'; auth.user = { id: 'listening-learner' };
  Object.assign(window, { api: { getWith: vi.fn(), postWith: vi.fn(), patchWith: vi.fn() } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens General and IELTS navigation while overview is still pending without inventing counts', () => {
  window.api.getWith = vi.fn(() => new Promise(() => {}));
  render(<ListeningLandingBehavior />);
  expect(screen.getByRole('link', { name: /General Listening/ }).getAttribute('href')).toBe('/listening/general');
  expect(screen.getByRole('link', { name: /IELTS Listening/ }).getAttribute('href')).toBe('/listening/ielts');
  expect(screen.getAllByText('Đang tải số bài…')).toHaveLength(2);
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('shows lessons and exam navigation before a delayed overview, without downloading the 80-day collection', async () => {
  const overview = pending<unknown>();
  window.api.getWith = vi.fn((url: string) => url === '/api/listening/overview' ? overview.promise : Promise.resolve(lessons));
  render(<ListeningProgrammeLibrary {...props} />);
  const lesson = await screen.findByRole('heading', { name: 'Bài nghe đã tải' });
  for (const name of ['Luyện kĩ năng', 'Mini Test', 'Full Test']) expect(screen.getByRole('link', { name: new RegExp(name) })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Luyện nhanh/ })).toBeNull();
  const modes = screen.getByRole('heading', { name: 'Chọn mức độ mô phỏng đề thi' });
  expect(modes.compareDocumentPosition(lesson) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(window.api.getWith).toHaveBeenCalledTimes(2);
  expect(vi.mocked(window.api.getWith).mock.calls.some(([url]) => String(url).includes('source-collections'))).toBe(false);
  await act(async () => overview.resolve({ tests: { drill: 176, mini: 32, full: 3, practice: 0 }, programmes: [{ id: 'ielts-80-days-listening' }] }));
  expect(await screen.findByRole('link', { name: /80 ngày Listening/ })).toBeTruthy();
  expect(screen.getByText('176 bài')).toBeTruthy();
  expect(window.api.getWith).toHaveBeenCalledTimes(2);
});

it('keeps loaded lessons usable after overview fails', async () => {
  window.api.getWith = vi.fn((url: string) => url === '/api/listening/overview' ? Promise.reject(new Error('count unavailable')) : Promise.resolve(lessons));
  render(<ListeningProgrammeLibrary {...props} />);
  await screen.findByRole('heading', { name: 'Bài nghe đã tải' });
  expect(await screen.findByText(/Số lượng bài tạm thời chưa tải được/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Mở bài/ }).getAttribute('href')).toContain('/listening/ielts/lesson1');
  expect(screen.queryByText('Không tải được thư viện. Hãy thử lại.')).toBeNull();
});

it('clears a previous account lesson list before the new account read completes', async () => {
  const next = pending<unknown>();
  window.api.getWith = vi.fn(() => auth.user.id === 'listening-learner' ? Promise.resolve(lessons) : next.promise);
  const view = render(<ListeningProgrammeLibrary {...props} showIeltsModes={false} />);
  await screen.findByRole('heading', { name: 'Bài nghe đã tải' });
  auth.user = { id: 'next-account' };
  view.rerender(<ListeningProgrammeLibrary {...props} showIeltsModes={false} />);
  expect(screen.queryByRole('heading', { name: 'Bài nghe đã tải' })).toBeNull();
  expect(screen.getByText('Đang tải bài học…')).toBeTruthy();
});

it('opens a published parent drill when its section has no standalone mode', async () => {
  const parent = '00000000-0000-0000-0000-000000000012';
  window.api.getWith = vi.fn(async () => ({ items: [{ id: 'section', title: 'Bài luyện có thể mở', available_modes: [], practice_test_id: parent, practice_test_type: 'drill' }], total: 1 }));
  render(<ListeningBrowseBehavior />);
  const link = await screen.findByRole('link', { name: 'Mở bài luyện kỹ năng' });
  const destination = new URL(link.getAttribute('href')!, 'https://example.test');
  expect(destination.searchParams.get('id')).toBe(parent);
  expect(destination.searchParams.get('from')).toBe('drill');
  const player = listeningTestParams(destination.search);
  expect(listeningLibraryHref(player.from)).toBe('/listening/skills');
  const review = new URL(listeningReviewHref('completed', player.from), 'https://example.test');
  expect(listeningReviewBackTarget(listeningReviewParams(review.search)).href).toBe('/listening/skills');
  expect(screen.queryByText('Chưa có dạng luyện nào cho bài này')).toBeNull();
});

it('keeps a partial overview source entry in a visible retry state until publication is known', async () => {
  let recovered = false;
  window.api.getWith = vi.fn(async (url: string) => url === '/api/listening/overview'
    ? { tests: { full: 4 }, programmes: recovered ? [{ id: 'ielts-80-days-listening' }] : [], partial_data: !recovered }
    : lessons);
  render(<ListeningProgrammeLibrary {...props} />);
  await screen.findByRole('heading', { name: 'Bài nghe đã tải' });
  expect(await screen.findByText('Chưa tải được bộ luyện 80 ngày.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  recovered = true;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('link', { name: /80 ngày Listening/ })).toBeTruthy();
  expect(vi.mocked(window.api.getWith).mock.calls.some(([url]) => String(url).includes('source-collections'))).toBe(false);
});

it('preserves authored standalone controls on a section that also has a parent test', async () => {
  window.api.getWith = vi.fn(async () => ({ items: [{ id: 'section', title: 'Bài nghe', available_modes: ['dictation'], practice_test_id: 'parent', practice_test_type: 'full' }], total: 1 }));
  render(<ListeningBrowseBehavior />);
  expect((await screen.findByRole('link', { name: 'Chép chính tả' })).getAttribute('href')).toBe('/listening/dictation?content_id=section');
});

it('uses natural lesson order and distinct Mini Test names while preserving authored titles', async () => {
  window.api.getWith = vi.fn(async () => ({ items: [30, 2, 1].map((n) => ({ id: `test${n}`, test_id: `ILR-LIS-LSN-L${String(n).padStart(2, '0')}`, title: `ILR-LIS-LSN-L${String(n).padStart(2, '0')}` })).concat([{ id: 'foundation', test_id: 'ILR-LIS-FND-LESSON-L02', title: 'Bài nghe nền tảng riêng' }]) }));
  const view = render(<ListeningMiniTestBehavior />);
  await screen.findByText('Mini test · Bài 30');
  expect(Array.from(view.container.querySelectorAll('.lt-card-code')).map((e) => e.textContent)).toEqual(['ILR-LIS-FND-LESSON-L02', 'ILR-LIS-LSN-L01', 'ILR-LIS-LSN-L02', 'ILR-LIS-LSN-L30']);
  expect(screen.getByText('Bài nghe nền tảng riêng')).toBeTruthy();
  expect(screen.getByText('Mini test · Bài 1')).toBeTruthy();
  expect(screen.getByText('Mini test · Bài 2')).toBeTruthy();
});

it.each([0, 1])('uses playable content (%s) for the landing CTA and library card', async (count) => {
  window.api.getWith = vi.fn(async () => ({ content: 7, playable_content: count, exercise_modes: { gist: 1 }, tests: {}, programmes: [] }));
  render(<ListeningLandingBehavior />);
  const action = await screen.findByRole('link', { name: /Bắt đầu luyện/ });
  expect(action.getAttribute('href')).toBe(count ? '/listening/browse' : '/listening/analytics');
  const library = screen.queryByRole('link', { name: /Kho bài nghe/ });
  if (count) expect(library?.textContent).toContain('1 bài');
  else expect(library).toBeNull();
});
