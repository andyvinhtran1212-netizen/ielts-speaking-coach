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
import { documentNavigation } from '@/lib/tree-replace';

const learnerMe = vi.hoisted(() => ({ current: { status: 'loading', me: null } as { status: string; me: Record<string, unknown> | null } }));
vi.mock('@/components/learner/learner-frame', () => ({ useLearnerMe: () => learnerMe.current }));

const auth = vi.hoisted(() => ({ status: 'signed-in' }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));

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

let docReplace: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  search.value = '';
  auth.status = 'signed-in';
  learnerMe.current = { status: 'loading', me: null };
  // `/my-class` is in the legacy tree: a full document replacement (UIBASE-0056 FR-015).
  docReplace = vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {});
});
afterEach(() => { cleanup(); replace.mockReset(); docReplace.mockRestore(); vi.unstubAllEnvs(); });

it('class only (no online grant at all): replaces to the assigned work and draws no group (FR-035)', async () => {
  mount(payload({ has_class: true, class: { name: 'A1', teacher_name: null, course_title: null, repractice: [] } }));
  await waitFor(() => expect(docReplace).toHaveBeenCalledWith('/my-class'));
  // Into the legacy tree: never a soft replace that keeps the v2 stylesheets.
  expect(replace).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Khoá online của bạn' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Khoá của lớp' })).toBeNull();
});

it('class only but the online part failed: no redirect, the online group shows its error', async () => {
  mount(payload({ has_class: true, class: { name: 'A1', teacher_name: null, course_title: null, repractice: [] },
    degraded: ['online'] }));
  const group = await screen.findByRole('region', { name: 'Khoá online của bạn' });
  expect(within(group).getByText('Phần này chưa tải được. Các phần khác vẫn dùng được; tải lại trang để thử lại.')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(docReplace).not.toHaveBeenCalled();
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
  expect(within(cards).getByRole('link', { name: 'Bài được giao' }).getAttribute('href')).toBe('/my-class');
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

it('expired course: "Đã hết hạn", no renewal with commerce off, no lesson list (FR-037)', async () => {
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '');
  search.value = 'course=OLD';
  mount(payload({ online: [online('OLD', { state: 'expired', days_left: null, can_renew: true, progress: { done: 5, total: 20 } })],
    has_online: true, selected: null }));
  const group = await screen.findByRole('region', { name: 'Khoá online của bạn' });
  expect(within(group).getByText('Đã hết hạn · 5/20 bài · Còn 18 lượt chấm AI')).toBeTruthy();
  expect(within(group).getByText('Đăng ký lại để học tiếp từ bài đang dở.')).toBeTruthy();
  expect(within(group).queryByRole('link', { name: 'Đăng ký lại' })).toBeNull();
  expect(await screen.findByText('Khoá đã hết hạn. Đăng ký lại để học tiếp từ bài đang dở.')).toBeTruthy();
  expect(getWith).not.toHaveBeenCalledWith('/api/course/OLD/lessons', undefined, expect.anything());
});

it('eligible expired courses link to the public catalogue when commerce is on (FR-037)', async () => {
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '1');
  mount(payload({
    online: [
      online('OLD', { state: 'expired', can_renew: true }),
      online('OLDER', { state: 'expired', can_renew: false }),
    ],
    other_products: [{ slug: 'unowned-course', title: 'Khoá khác', status: 'coming_soon' }],
    has_online: true,
  }));

  expect((await screen.findByRole('link', { name: 'Đăng ký lại' })).getAttribute('href')).toBe('/courses');
  expect(screen.getByRole('link', { name: 'Xem khoá' }).getAttribute('href')).toBe('/courses/unowned-course');
});

it('switching to an expired course drops the pending lessons of the previous one (FR-037)', async () => {
  let releaseG1: (value: unknown) => void = () => {};
  const lessonSignals: AbortSignal[] = [];
  const course = payload({ online: [online('G1'), online('OLD', { state: 'expired', days_left: null })],
    has_online: true, selected: 'G1' });
  getWith = vi.fn((path: string, _q: unknown, opts?: { signal?: AbortSignal }) => {
    if (path === '/api/student/course') return Promise.resolve(course);
    if (opts?.signal) lessonSignals.push(opts.signal);
    return new Promise((resolve) => { releaseG1 = resolve; });
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  const view = render(<CourseHubPage accountId="learner-1" />);
  await waitFor(() => expect(lessonSignals.length).toBe(1));
  search.value = 'course=OLD';
  view.rerender(<CourseHubPage accountId="learner-1" />);
  expect(await screen.findByText('Khoá đã hết hạn. Đăng ký lại để học tiếp từ bài đang dở.')).toBeTruthy();
  expect(lessonSignals[0].aborted).toBe(true);
  await act(async () => { releaseG1(LESSONS); });
  expect(screen.getByText('Khoá đã hết hạn. Đăng ký lại để học tiếp từ bài đang dở.')).toBeTruthy();
  expect(screen.queryByText('Bài 2. Thì quá khứ')).toBeNull();
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
  expect(docReplace).not.toHaveBeenCalled();
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
  await waitFor(() => expect(docReplace).toHaveBeenCalledWith('/my-class'));
  expect(replace).not.toHaveBeenCalled();
  expect(getWith).not.toHaveBeenCalled();
});

it('profile still loading: neither the page nor a redirect yet', async () => {
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  learnerMe.current = { status: 'loading', me: null };
  render(<CoursePage />);
  expect(screen.getByRole('status')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(docReplace).not.toHaveBeenCalled();
  expect(getWith).not.toHaveBeenCalled();
});

it('flag on: the Lộ trình page loads for this account', async () => {
  learnerMe.current = { status: 'ready', me: { id: 'learner-1', learner_v2_enabled: true } };
  getWith = vi.fn(async () => payload());
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  render(<CoursePage />);
  expect(await screen.findByRole('region', { name: 'Khoá online của bạn' })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(docReplace).not.toHaveBeenCalled();
});

it('opening Lộ trình signed out replaces the document with login without reading the course', () => {
  auth.status = 'signed-out';
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  render(<CoursePage />);

  expect(docReplace).toHaveBeenCalledExactlyOnceWith('/login');
  expect(replace).not.toHaveBeenCalled();
  expect(getWith).not.toHaveBeenCalled();
});

it('signing out in another tab removes the open learner page and sends this tab to login', async () => {
  learnerMe.current = { status: 'ready', me: { id: 'learner-1', learner_v2_enabled: true } };
  getWith = vi.fn(async () => payload());
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
  const view = render(<CoursePage />);
  expect(await screen.findByRole('region', { name: 'Khoá online của bạn' })).toBeTruthy();

  auth.status = 'signed-out';
  view.rerender(<CoursePage />);

  expect(screen.queryByRole('region', { name: 'Khoá online của bạn' })).toBeNull();
  expect(docReplace).toHaveBeenCalledExactlyOnceWith('/login');
  expect(replace).not.toHaveBeenCalled();
  expect(getWith).toHaveBeenCalledTimes(1);
});
