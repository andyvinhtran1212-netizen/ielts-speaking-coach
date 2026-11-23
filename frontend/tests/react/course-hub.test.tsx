// LEARNERCORE-0063 T15 (amendment 1): the Lộ trình page (`course-hub.tsx`).
// Cases from plan.md "T15": class only → replace to the assigned work before
// any group is drawn; online only → the class group folds with aria-expanded;
// n = 0 shows no number; the class card hidden without a class; lessons 404 →
// "Bài học của khoá sẽ mở dần"; lessons 500 → only the lesson block errors;
// an expired course shows "Đã hết hạn" and no lesson list; buy links hidden
// while their pages are not live; one account's data never drawn for another.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CourseHubPage } from '@/app/(authed-v2-course)/course/course-hub';
import CoursePage from '@/app/(authed-v2-course)/course/page';

const learnerMe = vi.hoisted(() => ({ current: { status: 'loading', me: null } as { status: string; me: Record<string, unknown> | null } }));
vi.mock('@/components/learner/learner-frame', () => ({ useLearnerMe: () => learnerMe.current }));

const replace = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ replace, push: () => {} }));
const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  // Stable like Next's router: a new object per render would re-run every effect.
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
}));

function online(code: string, over: Record<string, unknown> = {}) {
  return { course_code: code, product_slug: code.toLowerCase(), title: `Khoá ${code}`, state: 'active',
    days_left: 12, expires_at: null, can_renew: false, progress: null, credits_left: 18, ...over };
}

function payload(over: Record<string, unknown> = {}) {
  return { online: [], other_products: [], class: null, assigned_open: 0, has_online: false,
    has_class: false, selected: null, degraded: [], ...over };
}

const LESSONS = {
  course: { code: 'G1', title: 'Grammar', access: { expires_at: null, can_renew: false } },
  coming_soon: false,
  stages: [{ stage_no: 1, title: 'Câu đơn', lessons: [
    { lesson_id: 'l1', lesson_code: 'b1', lesson_no: 1, title: 'Thì hiện tại', kind: 'video', video_seconds: 300, has_practice: true, state: 'done' },
    { lesson_id: 'l2', lesson_code: 'b2', lesson_no: 2, title: 'Thì quá khứ', kind: 'video', video_seconds: 300, has_practice: false, state: 'next' },
  ] }],
};

let getWith: ReturnType<typeof vi.fn>;

function mount(course: unknown, lessons: (path: string) => unknown = () => LESSONS, accountId = 'learner-1') {
  getWith = vi.fn(async (path: string) => {
    if (path === '/api/student/course') return course;
    const answer = lessons(path);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  return render(<CourseHubPage accountId={accountId} />);
}

function httpError(status: number, code: string | null = null) {
  return Object.assign(new Error(`HTTP ${status}`), { status, code });
}

beforeEach(() => { search.value = ''; });
afterEach(() => { cleanup(); replace.mockReset(); });

it('class only (no online grant at all): replaces to the assigned work and draws no group (FR-035)', async () => {
  mount(payload({ has_class: true, class: { name: 'A1', teacher_name: null, course_title: null, repractice: [] } }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/course/assigned'));
  expect(screen.queryByRole('region', { name: 'Khoá online của bạn' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Khoá của lớp' })).toBeNull();
});

it('class only but the online part failed: no redirect, the online group shows its error', async () => {
  mount(payload({ has_class: true, class: { name: 'A1', teacher_name: null, course_title: null, repractice: [] },
    degraded: ['online'] }));
  const group = await screen.findByRole('region', { name: 'Khoá online của bạn' });
  expect(within(group).getByText('Phần này chưa tải được. Các phần khác vẫn dùng được; tải lại trang để thử lại.')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});

it('online only: the class group folds to one line that opens with aria-expanded (FR-033)', async () => {
  mount(payload({ online: [online('G1')], has_online: true, selected: 'G1' }));
  const group = await screen.findByRole('region', { name: 'Khoá của lớp' });
  const toggle = within(group).getByRole('button', { name: 'Khoá của lớp' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(within(group).queryByText(/Bạn chưa vào lớp nào/)).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(within(group).getByText(/Bạn chưa vào lớp nào/)).toBeTruthy();
  // The flow note stays under the group (FR-036).
  expect(within(group).getByText('Speaking: AI chấm và trả ngay. Writing: AI chấm, giáo viên duyệt rồi mới trả')).toBeTruthy();
});

it('cards: n = 0 shows no number, n > 0 shows it, the class card is hidden without a class (FR-030)', async () => {
  mount(payload({ online: [online('G1')], has_online: true, assigned_open: 0 }));
  const cards = await screen.findByRole('navigation', { name: 'Lộ trình' });
  expect(within(cards).getByRole('link', { name: 'Bài được giao' }).getAttribute('href')).toBe('/course/assigned');
  expect(within(cards).queryByText('Buổi học và tài liệu lớp')).toBeNull();
  cleanup();
  mount(payload({ online: [online('G1')], has_online: true, assigned_open: 3, has_class: true,
    class: { name: 'A1', teacher_name: 'Cô Lan', course_title: 'IELTS 6.5', repractice: [] } }));
  const again = await screen.findByRole('navigation', { name: 'Lộ trình' });
  expect(within(again).getByRole('link', { name: 'Bài được giao (3)' })).toBeTruthy();
  // /course/class is not live yet, so its card is not drawn either.
  expect(within(again).queryByText('Buổi học và tài liệu lớp')).toBeNull();
  expect(screen.getByText('Lớp A1 · giáo viên Cô Lan · IELTS 6.5')).toBeTruthy();
});

it('online row: days left, this grant\'s own credits, lessons by stage with text states (FR-031, FR-034)', async () => {
  mount(payload({ online: [online('G1', { progress: { done: 3, total: 24 } })], has_online: true, selected: 'G1' }));
  const group = await screen.findByRole('region', { name: 'Khoá online của bạn' });
  expect(within(group).getByText('còn 12 ngày · 3/24 bài · Còn 18 lượt chấm AI')).toBeTruthy();
  const lessons = await screen.findByRole('region', { name: 'Bài học của khoá' });
  await within(lessons).findByText('Bài 1. Thì hiện tại');
  expect(within(lessons).getByText('Đã xong')).toBeTruthy();
  expect(within(lessons).getByText('Tiếp theo')).toBeTruthy();
  // /course/learn/... is not live: the lesson is text, not a link.
  expect(within(lessons).queryByRole('link')).toBeNull();
  expect(getWith).toHaveBeenCalledWith('/api/course/G1/lessons', undefined, expect.anything());
});

it('lessons 404: "Bài học của khoá sẽ mở dần", never an empty block', async () => {
  mount(payload({ online: [online('G1')], has_online: true, selected: 'G1' }), () => httpError(404, 'course_not_found'));
  expect(await screen.findByText('Bài học của khoá sẽ mở dần.')).toBeTruthy();
});

it('lessons 500: only the lesson block errors and retries; the groups stay', async () => {
  let calls = 0;
  mount(payload({ online: [online('G1')], has_online: true, selected: 'G1' }), () => {
    calls += 1;
    return calls === 1 ? httpError(500) : LESSONS;
  });
  const lessons = await screen.findByRole('region', { name: 'Bài học của khoá' });
  expect(await within(lessons).findByText('Chưa tải được bài học')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Khoá online của bạn' })).toBeTruthy();
  fireEvent.click(within(lessons).getByRole('button', { name: 'Thử lại' }));
  expect(await within(lessons).findByText('Bài 2. Thì quá khứ')).toBeTruthy();
});

it('expired course: "Đã hết hạn", no renew button without the labels module, no lesson list (FR-037)', async () => {
  search.value = 'course=OLD';
  mount(payload({ online: [online('OLD', { state: 'expired', days_left: null, can_renew: true, progress: { done: 5, total: 20 } })],
    has_online: true, selected: null }));
  const group = await screen.findByRole('region', { name: 'Khoá online của bạn' });
  expect(within(group).getByText('Đã hết hạn · 5/20 bài · Còn 18 lượt chấm AI')).toBeTruthy();
  expect(within(group).getByText('Đăng ký lại để học tiếp từ bài đang dở.')).toBeTruthy();
  expect(within(group).queryByRole('button', { name: /Đăng ký lại/ })).toBeNull();
  expect(await screen.findByText('Khoá đã hết hạn. Đăng ký lại để học tiếp từ bài đang dở.')).toBeTruthy();
  expect(getWith).not.toHaveBeenCalledWith('/api/course/OLD/lessons', undefined, expect.anything());
});

it('no course, no class: two empty groups; buy and activation links hidden while not live', async () => {
  mount(payload());
  const onlineGroup = await screen.findByRole('region', { name: 'Khoá online của bạn' });
  expect(within(onlineGroup).getByText(/Bạn chưa đăng ký khoá online nào/)).toBeTruthy();
  expect(screen.getByText(/Bạn chưa vào lớp nào/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Xem các khoá' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Nhập mã kích hoạt' })).toBeNull();
  expect(screen.queryByText('Khoá online khác · dự kiến')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it('?course= picks a course on the page; "Xem bài học" replaces the query', async () => {
  search.value = 'course=G2';
  mount(payload({ online: [online('G1'), online('G2')], has_online: true, selected: 'G1' }));
  await waitFor(() => expect(getWith).toHaveBeenCalledWith('/api/course/G2/lessons', undefined, expect.anything()));
  fireEvent.click(screen.getByRole('button', { name: 'Xem bài học' }));
  expect(replace).toHaveBeenCalledWith('/course?course=G1');
});

it('a failed page load shows one notice with a retry', async () => {
  getWith = vi.fn().mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(payload());
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  render(<CourseHubPage accountId="learner-1" />);
  expect(await screen.findByText('Chưa tải được Lộ trình')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('region', { name: 'Khoá online của bạn' })).toBeTruthy();
});

it('an account switch drops the previous account\'s pending answer', async () => {
  let releaseA: (value: unknown) => void = () => {};
  const signals: AbortSignal[] = [];
  getWith = vi.fn((path: string, _q: unknown, opts?: { signal?: AbortSignal }) => {
    if (path !== '/api/student/course') return new Promise(() => {});
    if (opts?.signal) signals.push(opts.signal);
    if (signals.length === 1) return new Promise((resolve) => { releaseA = resolve; });
    return Promise.resolve(payload());
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  const view = render(<CourseHubPage accountId="account-a" />);
  await waitFor(() => expect(signals.length).toBe(1));
  view.rerender(<CourseHubPage accountId="account-b" />);
  await waitFor(() => expect(signals.length).toBe(2));
  expect(signals[0].aborted).toBe(true);
  await act(async () => { releaseA(payload({ online: [online('A-ONLY')], has_online: true })); });
  await screen.findByRole('region', { name: 'Khoá online của bạn' });
  expect(screen.queryByText('Khoá A-ONLY')).toBeNull();
});

// ── page gate (flag) ──────────────────────────────────────────────────────────

it('flag off: replaces the URL with the stand-in page and never calls the Lộ trình API', async () => {
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  learnerMe.current = { status: 'ready', me: { id: 'learner-1', learner_v2_enabled: false } };
  render(<CoursePage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/course/assigned'));
  expect(getWith).not.toHaveBeenCalled();
});

it('profile still loading: neither the page nor a redirect yet', async () => {
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  learnerMe.current = { status: 'loading', me: null };
  render(<CoursePage />);
  expect(screen.getByRole('status')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(getWith).not.toHaveBeenCalled();
});

it('flag on: the Lộ trình page loads for this account', async () => {
  learnerMe.current = { status: 'ready', me: { id: 'learner-1', learner_v2_enabled: true } };
  getWith = vi.fn(async () => payload());
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  render(<CoursePage />);
  expect(await screen.findByRole('region', { name: 'Khoá online của bạn' })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});
