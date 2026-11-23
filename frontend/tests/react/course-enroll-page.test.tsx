// ENROLL-0060 FR-035/036, G05-T12 màn 1 — `/courses/[slug]/enroll`.
// Fixtures are fake (tests/fixtures/commerce); nothing here calls a backend.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { EnrollPage } from '@/app/(public-commerce)/courses/[slug]/enroll/enroll-page';
import type { CourseDetail } from '@/lib/commerce-types';

import openCourse from '../fixtures/commerce/course-detail-open.json';

const auth = vi.hoisted(() => ({ status: 'signed-in' as 'signed-in' | 'signed-out' | 'initial-loading', id: 'learner-a', email: 'a@example.test' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: auth.status, user: auth.status === 'signed-in' ? { id: auth.id, email: auth.email } : null }),
}));
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: async () => ({ display_name: 'Học viên Giả' }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const OPEN = openCourse as unknown as CourseDetail;
const SUBMIT = 'Tạo đơn và xem thông tin chuyển khoản';

let viewerAnswer: CourseDetail | Error;
let posts: { path: string; body: { product_slug: string; request_key: string } }[];
let postAnswer: () => Promise<unknown>;
let replace: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

function viewer(patch: Partial<CourseDetail['viewer']>, extra: Partial<CourseDetail> = {}): CourseDetail {
  return { ...OPEN, ...extra, viewer: { ...OPEN.viewer, state: 'can_enroll', ...patch } };
}

function apiError(status: number, error_code: string) {
  return Object.assign(new Error('x'), { status, detail: { error_code, message: 'x' } });
}

beforeEach(() => {
  auth.status = 'signed-in';
  auth.id = 'learner-a';
  viewerAnswer = viewer({});
  posts = [];
  postAnswer = async () => ({ order: { order_code: 'AVER-K7QM2X' } });
  replace = vi.fn();
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace, assign });
  Object.assign(window, { api: {
    getWith: async () => {
      if (viewerAnswer instanceof Error) throw viewerAnswer;
      return viewerAnswer;
    },
    postWith: (path: string, body: { product_slug: string; request_key: string }) => {
      posts.push({ path, body });
      return postAnswer();
    },
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const button = () => screen.getByRole('button', { name: SUBMIT });
const agree = () => screen.getByRole('checkbox');

it('signed out: goes to sign in with next back to this step, nothing is created', () => {
  auth.status = 'signed-out';
  render(<EnrollPage course={OPEN} />);
  expect(replace).toHaveBeenCalledWith('/login?next=%2Fcourses%2Fkhoa-a%2Fenroll');
  expect(posts).toEqual([]);
});

it('account details, the three steps, the summary; the box turns the button on and off', async () => {
  render(<EnrollPage course={OPEN} />);
  expect(await screen.findByText('Học viên Giả')).toBeTruthy();
  expect(screen.getByText('a@example.test')).toBeTruthy();
  const steps = within(screen.getByRole('list', { name: 'Các bước đăng ký khoá' })).getAllByRole('listitem');
  expect(steps).toHaveLength(3);
  expect(steps[0].getAttribute('aria-current')).toBe('step');
  const summary = within(screen.getByRole('complementary', { name: 'Bạn đang đăng ký' }));
  expect(summary.getByText('1.200.000 đ')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('link', { name: 'Chính sách hoàn tiền' }).getAttribute('href')).toBe('/terms#hoan-tien');

  expect((button() as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Đánh dấu ô đồng ý điều khoản để tạo đơn.')).toBeTruthy();
  fireEvent.click(agree());
  expect((button() as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(agree());
  expect((button() as HTMLButtonElement).disabled).toBe(true);
  expect(posts).toEqual([]);
});

it('two quick clicks make one request; the order page opens at /enroll/<order_code>', async () => {
  let resolve: (value: unknown) => void = () => undefined;
  postAnswer = () => new Promise((r) => { resolve = r; });
  render(<EnrollPage course={OPEN} />);
  fireEvent.click(await screen.findByRole('checkbox'));
  const first = button();
  fireEvent.click(first);
  fireEvent.click(first);
  expect(first.getAttribute('aria-disabled')).toBe('true');
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  fireEvent.click(first);
  await new Promise((r) => setTimeout(r, 0));
  expect(posts).toHaveLength(1);
  expect(posts[0].path).toBe('/api/enrollment-orders');
  expect(posts[0].body.product_slug).toBe('khoa-a');
  expect(posts[0].body.request_key.length).toBeGreaterThanOrEqual(8);
  await act(async () => { resolve({ order: { order_code: 'AVER-K7QM2X' } }); });
  expect(replace).toHaveBeenCalledWith('/enroll/AVER-K7QM2X');
});

it('a failed create keeps the ticked box; the retry sends the same request_key', async () => {
  postAnswer = async () => { throw apiError(503, 'orders_unavailable'); };
  render(<EnrollPage course={OPEN} />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(button());
  expect(await screen.findByText(/Chưa tạo được đơn đăng ký\. Thông tin bạn đã điền vẫn còn/)).toBeTruthy();
  expect((agree() as HTMLInputElement).checked).toBe(true);
  postAnswer = async () => ({ order: { order_code: 'AVER-K7QM2X' } });
  fireEvent.click(button());
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/enroll/AVER-K7QM2X'));
  expect(posts).toHaveLength(2);
  expect(posts[1].body.request_key).toBe(posts[0].body.request_key);
});

it('orders_paused says so; course_not_open stops the form', async () => {
  postAnswer = async () => { throw apiError(503, 'orders_paused'); };
  render(<EnrollPage course={OPEN} />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(button());
  expect(await screen.findByText('Đăng ký khoá đang tạm dừng. Bạn quay lại sau nhé.')).toBeTruthy();
  expect((button() as HTMLButtonElement).disabled).toBe(false);

  postAnswer = async () => { throw apiError(409, 'course_not_open'); };
  fireEvent.click(button());
  expect(await screen.findByText('Khoá này chưa mở đăng ký.')).toBeTruthy();
  expect((button() as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('link', { name: 'Về trang khoá' }).getAttribute('href')).toBe('/courses/khoa-a');
});

it('an open order for this course goes straight to it (FR-036)', async () => {
  viewerAnswer = viewer({ state: 'open_order', open_order_code: 'AVER-OPEN01' });
  render(<EnrollPage course={OPEN} />);
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/enroll/AVER-OPEN01'));
  expect(posts).toEqual([]);
});

it('still learning without renewal: no form, "Vào học"; renewable: "Đăng ký lại" with the carry sentence', async () => {
  viewerAnswer = viewer({ state: 'enrolled', days_left: 40, can_renew: false });
  const view = render(<EnrollPage course={OPEN} />);
  expect(await screen.findByText('Bạn đang học khoá này')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('link', { name: 'Vào học' }).getAttribute('href')).toBe('/home');
  view.unmount();

  viewerAnswer = viewer({ state: 'enrolled', days_left: 5, can_renew: true });
  render(<EnrollPage course={OPEN} />);
  expect(await screen.findByRole('heading', { level: 1, name: /^Đăng ký lại/ })).toBeTruthy();
  expect(screen.getByText(/toàn bộ lượt chưa dùng/)).toBeTruthy();
});

it('a course that does not take enrolments shows why, with no form', async () => {
  viewerAnswer = viewer({}, { status: 'coming_soon' });
  render(<EnrollPage course={{ ...OPEN, status: 'coming_soon' }} />);
  expect(await screen.findByText('Khoá này chưa mở đăng ký')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('a failed session read creates nothing and offers "Thử lại"', async () => {
  viewerAnswer = Object.assign(new Error('boom'), { status: 503 });
  render(<EnrollPage course={OPEN} />);
  expect(await screen.findByText('Chưa tải được thông tin đăng ký của bạn')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  viewerAnswer = viewer({});
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('checkbox')).toBeTruthy();
  expect(posts).toEqual([]);
});

it('a parent re-render with a new course object keeps the ticked box and the same request_key', async () => {
  postAnswer = async () => { throw apiError(503, 'orders_unavailable'); };
  const view = render(<EnrollPage course={OPEN} />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(button());
  await screen.findByText(/Chưa tạo được đơn đăng ký/);
  view.rerender(<EnrollPage course={{ ...OPEN }} />);
  expect((agree() as HTMLInputElement).checked).toBe(true);
  fireEvent.click(button());
  await vi.waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].body.request_key).toBe(posts[0].body.request_key);
});

it('A → B: the next account starts over with a new request_key and an unticked box', async () => {
  postAnswer = async () => { throw apiError(503, 'orders_unavailable'); };
  const view = render(<EnrollPage course={OPEN} />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(button());
  await screen.findByText(/Chưa tạo được đơn đăng ký/);
  auth.id = 'learner-b';
  auth.email = 'b@example.test';
  view.rerender(<EnrollPage course={OPEN} />);
  expect(await screen.findByText('b@example.test')).toBeTruthy();
  expect((agree() as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByText(/Chưa tạo được đơn đăng ký/)).toBeNull();
  fireEvent.click(agree());
  fireEvent.click(button());
  await vi.waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].body.request_key).not.toBe(posts[0].body.request_key);
  auth.email = 'a@example.test';
});
