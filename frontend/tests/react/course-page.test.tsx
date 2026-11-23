// PUBLICSITE-0059 T05 — `/courses/[slug]` body (FR-007, 008, 022, 024, 025, 028).
// Fixtures are fake (tests/fixtures/commerce); nothing here calls a backend.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CoursePage } from '@/app/(public-commerce)/courses/[slug]/course-page';
import type { CourseDetail } from '@/lib/commerce-types';

import openCourse from '../fixtures/commerce/course-detail-open.json';
import bareCourse from '../fixtures/commerce/course-detail-bare.json';

const auth = vi.hoisted(() => ({ status: 'signed-out' as 'signed-in' | 'signed-out' | 'initial-loading', id: 'learner-a' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: auth.status, user: auth.status === 'signed-in' ? { id: auth.id } : null }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const OPEN = openCourse as unknown as CourseDetail;
const BARE = bareCourse as unknown as CourseDetail;

function viewer(course: CourseDetail, patch: Partial<CourseDetail['viewer']>, extra: Partial<CourseDetail> = {}): CourseDetail {
  return { ...course, ...extra, viewer: { ...course.viewer, ...patch } };
}

let calls: string[];
let detail: Record<string, CourseDetail | Error>;
let mine: Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '1');
  calls = [];
  detail = {};
  mine = {};
  auth.status = 'signed-out';
  auth.id = 'learner-a';
  Object.assign(window, { api: {
    getWith: async (path: string) => {
      const who = auth.id;
      calls.push(`GET ${path}`);
      if (path === '/api/me/open-alerts') return { slugs: [] };
      if (path === '/api/me/courses') return mine[who] ?? { items: [], content_visible_until: null };
      const answer = detail[who] ?? OPEN;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  } });
  window.history.replaceState(null, '', '/courses/khoa-a');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

const panel = () => within(screen.getByRole('complementary', { name: 'Đăng ký khoá học' }));

it('guest, open course: one primary "Đăng ký khoá này" through login, the fee, and the three FR-024 points', () => {
  render(<CoursePage course={OPEN} />);
  expect(panel().getByText('Đang mở đăng ký')).toBeTruthy();
  expect(panel().getByText('1.200.000 đ')).toBeTruthy();
  const enrol = panel().getByRole('link', { name: 'Đăng ký khoá này' });
  expect(enrol.getAttribute('href')).toBe('/login?next=%2Fcourses%2Fkhoa-a%2Fenroll');
  const get = within(panel().getByRole('heading', { name: 'Đăng ký khoá này bạn có gì' }).parentElement as HTMLElement);
  const points = get.getAllByRole('listitem');
  expect(points).toHaveLength(3);
  expect(points[1].textContent).toMatch(/40 lượt chấm AI/);
  expect(points[2].textContent).toMatch(/toàn bộ lượt chưa dùng/);
  expect(points[2].textContent).toMatch(/60 ngày/);
  expect(calls).toEqual([]);
});

it('guest: chapters 1 and 2 open, buttons toggle with aria-expanded, only "Học thử" lessons are links', () => {
  render(<CoursePage course={OPEN} />);
  const one = screen.getByRole('button', { name: /Chương 1 · Chương 1 \(giả\)/ });
  const two = screen.getByRole('button', { name: /Chương 2 · Chương 2 \(giả\)/ });
  expect(one.getAttribute('aria-expanded')).toBe('true');
  expect(two.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('link', { name: 'Bài 1.1' }).getAttribute('href')).toBe('/course/lesson/gia-1-1');
  expect(screen.queryByRole('link', { name: 'Bài 1.2' })).toBeNull();
  expect(screen.getByText('Bài 1.2')).toBeTruthy();
  fireEvent.click(one);
  expect(one.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById(one.getAttribute('aria-controls') as string)?.hidden).toBe(true);
  // A native <button>: Enter and Space toggle it from the keyboard.
  expect(one.tagName).toBe('BUTTON');
});

it('signed in with an open order: "Tiếp tục thanh toán" to the order', async () => {
  auth.status = 'signed-in';
  detail['learner-a'] = viewer(OPEN, { state: 'open_order', open_order_code: 'AV-GIA-01' });
  render(<CoursePage course={OPEN} />);
  const pay = await panel().findByRole('link', { name: 'Tiếp tục thanh toán' });
  expect(pay.getAttribute('href')).toBe('/enroll/AV-GIA-01');
  expect(panel().queryByRole('link', { name: 'Đăng ký khoá này' })).toBeNull();
});

it('learning: "Bạn đang học · còn N ngày", "Vào học", and "Đăng ký lại" with the carry sentence when renewable', async () => {
  auth.status = 'signed-in';
  detail['learner-a'] = viewer(OPEN, { state: 'enrolled', days_left: 12, can_renew: true });
  render(<CoursePage course={OPEN} />);
  expect(await panel().findByText('Bạn đang học · còn 12 ngày')).toBeTruthy();
  expect(panel().getByRole('link', { name: 'Vào học' }).getAttribute('href')).toBe('/home');
  expect(panel().getByRole('link', { name: 'Đăng ký lại' }).getAttribute('href')).toBe('/courses/khoa-a/enroll');
  expect(panel().getByText(/toàn bộ lượt chưa dùng/)).toBeTruthy();
});

it('expired (days_left 0): "Hết hạn", "Đăng ký lại", and the content_visible_until line from /api/me/courses', async () => {
  auth.status = 'signed-in';
  detail['learner-a'] = viewer(OPEN, { state: 'enrolled', days_left: 0 });
  mine['learner-a'] = { items: [], content_visible_until: '2027-03-01' };
  render(<CoursePage course={OPEN} />);
  expect(await panel().findByText('Hết hạn')).toBeTruthy();
  expect(panel().getByRole('link', { name: 'Đăng ký lại' })).toBeTruthy();
  expect(await panel().findByText('Bài đã nộp và nhận xét vẫn xem được trong Tiến độ đến 01/03/2027.')).toBeTruthy();
});

it('expired with content_visible_until null: no "still readable" line, no placeholder', async () => {
  auth.status = 'signed-in';
  detail['learner-a'] = viewer(OPEN, { state: 'expired', days_left: null });
  render(<CoursePage course={OPEN} />);
  expect(await panel().findByText('Hết hạn')).toBeTruthy();
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toContain('GET /api/me/courses');
  expect(screen.queryByText(/vẫn xem được trong Tiến độ/)).toBeNull();
  expect(screen.queryByText(/XXX/)).toBeNull();
});

it('expired on a course that no longer takes enrolments: no "Đăng ký lại", the alert instead', async () => {
  auth.status = 'signed-in';
  detail['learner-a'] = viewer(OPEN, { state: 'expired', days_left: null }, { status: 'closed' });
  render(<CoursePage course={{ ...OPEN, status: 'closed' }} />);
  expect(await panel().findByText('Hết hạn')).toBeTruthy();
  expect(panel().queryByRole('link', { name: 'Đăng ký lại' })).toBeNull();
  expect(panel().getByRole('button', { name: 'Báo cho tôi khi mở' })).toBeTruthy();
});

it('upcoming course with missing fields: no author, chapters, FAQ, credits or feedback blocks, no "0", alert in the panel', () => {
  render(<CoursePage course={BARE} />);
  expect(panel().getByText('Sắp mở')).toBeTruthy();
  expect(panel().getByText('Học phí công bố khi mở đăng ký')).toBeTruthy();
  expect(panel().getByRole('button', { name: 'Báo cho tôi khi mở' })).toBeTruthy();
  expect(panel().queryByRole('link', { name: 'Đăng ký khoá này' })).toBeNull();
  for (const heading of ['Người soạn và giảng', 'Chương trình', 'Chương trình dự kiến', 'Câu hỏi thường gặp về khoá', 'Lượt chấm AI dùng vào đâu', 'Nhận xét trông thế nào']) {
    expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  }
  expect(screen.queryByText(/XXX|\b0 lượt|\b0 ngày/)).toBeNull();
  // FR-028: no short_title → the bar and breadcrumb use the title.
  expect(screen.getAllByText('Khoá giả C').length).toBeGreaterThan(1);
});

it('FR-025: author block and feedback sample on a Writing/Speaking course; FR-028 short_title in narrow places', () => {
  render(<CoursePage course={OPEN} />);
  expect(screen.getByRole('heading', { name: 'Người soạn và giảng' })).toBeTruthy();
  expect(screen.getByText('Người soạn giả')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Nhận xét trông thế nào' })).toBeTruthy();
  expect(within(screen.getByRole('navigation', { name: 'Đường dẫn' })).getByText('Giả A')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Khoá giả A');

  cleanup();
  render(<CoursePage course={{ ...OPEN, features: ['reading'] }} />);
  expect(screen.queryByRole('heading', { name: 'Nhận xét trông thế nào' })).toBeNull();
});

it('FAQ: one answer open at a time', () => {
  const course = { ...OPEN, faq: [{ q: 'Hỏi 1?', a: 'Đáp 1.' }, { q: 'Hỏi 2?', a: 'Đáp 2.' }] };
  render(<CoursePage course={course} />);
  const q1 = screen.getByRole('button', { name: /Hỏi 1\?/ });
  const q2 = screen.getByRole('button', { name: /Hỏi 2\?/ });
  expect(q1.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(q2);
  expect(q2.getAttribute('aria-expanded')).toBe('true');
  expect(q1.getAttribute('aria-expanded')).toBe('false');
});

it('a failed session read keeps the guest view and offers "Thử lại"; A → B drops the old answer', async () => {
  auth.status = 'signed-in';
  detail['learner-a'] = Object.assign(new Error('boom'), { status: 503 });
  const view = render(<CoursePage course={OPEN} />);
  expect(await screen.findByText(/Chưa tải được trạng thái khoá học của bạn/)).toBeTruthy();
  expect(panel().getByText('Đang mở đăng ký')).toBeTruthy();

  detail['learner-b'] = viewer(OPEN, { state: 'enrolled', days_left: 3 });
  auth.id = 'learner-b';
  view.rerender(<CoursePage course={OPEN} />);
  expect(await panel().findByText('Bạn đang học · còn 3 ngày')).toBeTruthy();
  expect(screen.queryByText(/Chưa tải được trạng thái/)).toBeNull();
});

it('the mail unsubscribe strip is mounted on the course page', async () => {
  window.history.replaceState(null, '', '/courses/khoa-a#bo-nhan=not-a-valid-token');
  render(<CoursePage course={OPEN} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(window.location.hash).toBe('');
});
