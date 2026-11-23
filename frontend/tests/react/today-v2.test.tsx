// LEARNERCORE-0063 T14: the new Today page (`today-v2.tsx`) and the /home
// switch. Cases from plan.md "T14": the four states, the three banners, one
// broken block, N = 0, overdue first, legacy class code without credits, goal
// without an exam date, every null source hides its block, and the seen call
// only after "Vừa có kết quả" rendered.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { TodayV2 } from '@/app/(authed-home)/home/today-v2';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const NOW = Date.parse('2026-11-23T03:00:00Z');

function row(id: string, { due, missing = false, skill = 'reading' }: { due: string | null; missing?: boolean; skill?: string }) {
  return {
    item_id: id, state: 'assigned', submitted_at: null, score: null, passed_at: null,
    is_late: false, is_missing: missing, writing_expected: null,
    assignment: { id: `a-${id}`, cohort_id: 'c1', title: `Bài ${id}`, skill, due_at: due, content_config: {} },
  };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    student: { name: 'Minh Anh' },
    next_lesson: null,
    assigned: [], assigned_total_open: 0, assigned_due_soon: 0, assigned_due_later: 0,
    resume: [], state: 'learning', banner: null, access: [], credits: null, orders_open: [],
    goal: null, new_results: [], new_results_cursor: null, repeat_error: null,
    trial_today_left: null, open_surveys: [], mock_exams: [], degraded: [],
    ...over,
  };
}

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;

function mount(body: unknown) {
  get = vi.fn(async () => body);
  post = vi.fn(async () => undefined);
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  return render(<TodayV2 accountId="learner-1" />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Object.defineProperty(window, 'showToast', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  push.mockReset();
});

it('reads /api/student/today exactly once and writes nothing on load', async () => {
  mount(payload());
  await screen.findByRole('heading', { level: 1 });
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('/api/student/today');
  expect(post).not.toHaveBeenCalled();
});

it('N = 0 says there is nothing due, never "0 việc" (FR-020)', async () => {
  mount(payload());
  expect(await screen.findByRole('heading', { name: 'Hôm nay không có bài đến hạn.' })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/0 việc/);
});

it('N counts due-soon work before the cap plus the next lesson (FR-020, FR-021)', async () => {
  mount(payload({
    assigned_due_soon: 7, assigned: [row('x', { due: '2026-11-23T10:00:00Z' })],
    next_lesson: { title: 'Bài 3: Mở bài Task 2', href: '/course/lesson?id=l3', course_name: 'IELTS 6.5',
      stage_no: 1, lesson_no: 3, lesson_count: 24, video_seconds: 720, practice_items: 8, resume_seconds: 250 },
  }));
  expect(await screen.findByRole('heading', { name: 'Chào Minh Anh. Hôm nay bạn có 8 việc.' })).toBeTruthy();
  const lesson = screen.getByRole('region', { name: 'Bài tiếp theo trong lộ trình' });
  expect(within(lesson).getByRole('link', { name: 'Học tiếp từ phút 4' }).getAttribute('href')).toBe('/course/lesson?id=l3');
  expect(within(lesson).getByText('IELTS 6.5 · Chặng 1 · Bài 3 trên 24')).toBeTruthy();
});

it('next_lesson null hides the lesson card (FR-021)', async () => {
  mount(payload());
  await screen.findByRole('heading', { level: 1 });
  expect(screen.queryByRole('region', { name: 'Bài tiếp theo trong lộ trình' })).toBeNull();
});

it('assigned: overdue first with a text label, later count, exact item opened (FR-022)', async () => {
  mount(payload({
    assigned_due_soon: 2, assigned_due_later: 3,
    assigned: [row('late', { due: '2026-11-22T10:00:00Z', missing: true }), row('soon', { due: '2026-11-24T10:00:00Z' })],
  }));
  const block = await screen.findByRole('region', { name: 'Bài được giao, hạn hôm nay và ngày mai' });
  const items = within(block).getAllByRole('listitem');
  expect(items[0].textContent).toMatch(/Bài late/);
  expect(within(items[0]).getByText('Quá hạn')).toBeTruthy();
  expect(within(items[1]).queryByText('Quá hạn')).toBeNull();
  expect(within(block).getByText(/Còn 3 bài hạn sau ngày mai, không tính vào việc hôm nay\./)).toBeTruthy();

  post.mockImplementation(async (url: string) => {
    expect(url).toBe('/api/class/assignments/soon/start');
    return { item_id: 'soon', assignment_id: 'a-soon', skill: 'reading', player_surface: 'reading_exam',
      player_query: { test_id: 'cam18-t1', class_item: 'soon' },
      open_url: '/core-player/launch?surface=reading_exam&test_id=cam18-t1&class_item=soon' };
  });
  const assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
  fireEvent.click(within(items[1]).getByRole('button', { name: 'Làm bài' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/class/assignments/soon/start'));
});

it('a broken part fails only its own block (FR-026)', async () => {
  mount(payload({
    degraded: ['assigned'],
    resume: [{ kind: 'listening', title: 'Test 2', href: '/core-player/launch?surface=listening_test&id=lt1', progress: null }],
  }));
  const assigned = await screen.findByRole('region', { name: 'Bài được giao, hạn hôm nay và ngày mai' });
  expect(within(assigned).getByText('Phần này chưa tải được. Các phần khác vẫn dùng được; tải lại trang để thử lại.')).toBeTruthy();
  const resume = screen.getByRole('region', { name: 'Làm tiếp khi rảnh' });
  expect(within(resume).getByRole('link', { name: 'Làm tiếp' }).getAttribute('href')).toBe('/core-player/launch?surface=listening_test&id=lt1');
});

it('credits: one total, two rows by kind, hidden for a legacy class code (FR-024)', async () => {
  const view = mount(payload({ credits: { total: 5, by_kind: { online: 3, class: 2 } } }));
  const block = await screen.findByRole('region', { name: 'Lượt chấm AI' });
  expect(within(block).getByText('Lượt chấm AI lớp cấp cho bạn · cấp kèm mã lớp')).toBeTruthy();
  expect(within(block).getByText('Lượt chấm AI của khoá')).toBeTruthy();
  expect(within(block).getByText('Hết lượt thì liên hệ giáo viên để được cấp thêm.')).toBeTruthy();
  view.unmount();

  mount(payload({ credits: null }));
  await screen.findByRole('heading', { level: 1 });
  expect(screen.queryByRole('region', { name: 'Lượt chấm AI' })).toBeNull();
  expect(document.body.textContent).not.toMatch(/0\/0/);
});

it('goal without an exam date shows only the target (FR-070)', async () => {
  mount(payload({ goal: { target_band: 6.5, exam_date: null, weeks_left: null } }));
  expect(await screen.findByText('Mục tiêu 6.5')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/tuần tới ngày thi/);
});

it('every null source hides its block (FR-026, FR-077)', async () => {
  mount(payload());
  await screen.findByRole('heading', { level: 1 });
  for (const name of ['Bài được giao, hạn hôm nay và ngày mai', 'Làm tiếp khi rảnh', 'Lượt chấm AI',
    'Vừa có kết quả', 'Lỗi đang lặp lại', 'Bài tiếp theo trong lộ trình']) {
    expect(screen.queryByRole('region', { name })).toBeNull();
  }
  expect(document.body.textContent).not.toMatch(/(^|\s)—(\s|$)/);
});

it('sends the seen cursor once, only after "Vừa có kết quả" rendered (FR-078)', async () => {
  mount(payload({
    new_results: [{ kind: 'writing', title: 'Writing Task 2', returned_at: '2026-11-23T01:00:00Z',
      key: 'writing:e2', href: '/writing/result?essay_id=e2' }],
    new_results_cursor: { seen_until: '2026-11-23T01:00:00Z', seen_key: 'writing:e2' },
  }));
  const block = await screen.findByRole('region', { name: 'Vừa có kết quả' });
  expect(within(block).getByRole('link', { name: 'Mở phiếu' }).getAttribute('href')).toBe('/writing/result?essay_id=e2');
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith('/api/student/today/seen',
    { seen_until: '2026-11-23T01:00:00Z', seen_key: 'writing:e2' });
});

it('no new results: no seen call', async () => {
  mount(payload({ new_results_cursor: null }));
  await screen.findByRole('heading', { level: 1 });
  await act(async () => { await Promise.resolve(); });
  expect(post).not.toHaveBeenCalled();
});

it('a failed seen call is not shown to the learner', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mount(payload({
    new_results: [{ kind: 'speaking', title: 'Speaking Part 2', returned_at: '2026-11-23T01:00:00Z',
      key: 'speaking:s1', href: '/result?id=s1' }],
    new_results_cursor: { seen_until: '2026-11-23T01:00:00Z', seen_key: 'speaking:s1' },
  }));
  post.mockRejectedValueOnce(new Error('HTTP 503'));
  await screen.findByRole('region', { name: 'Vừa có kết quả' });
  await waitFor(() => expect(warn).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('three banners: out of credits, expiring, expired (FR-029)', async () => {
  for (const [banner, title] of [
    ['out_of_credits', 'Bạn đã dùng hết lượt chấm AI.'],
    ['expiring', 'Khoá học của bạn sắp hết hạn.'],
    ['expired', 'Khoá học của bạn đã hết hạn.'],
  ] as const) {
    const view = mount(payload({ banner }));
    expect(await screen.findByText(title)).toBeTruthy();
    view.unmount();
  }
});

it('first_day renders the learning layout from the server state (FR-019)', async () => {
  mount(payload({ state: 'first_day' }));
  expect(await screen.findByRole('heading', { name: 'Hôm nay không có bài đến hạn.' })).toBeTruthy();
});

it('no_course: course and activation paths only when live, trial line when known (FR-027)', async () => {
  const view = mount(payload({ state: 'no_course', trial_today_left: 2 }));
  const block = await screen.findByRole('region', { name: 'Bạn chưa có khoá học' });
  expect(within(block).getByText('Chấm thử hôm nay còn 2 bài.')).toBeTruthy();
  // /courses and /activate are planned, not live: no link to a 404.
  expect(within(block).queryByRole('link', { name: 'Xem các khoá' })).toBeNull();
  expect(within(block).queryByRole('link', { name: 'Nhập mã kích hoạt của lớp' })).toBeNull();
  expect(within(block).getByRole('link', { name: 'Đọc thư viện miễn phí' }).getAttribute('href')).toBe('/library');
  view.unmount();

  mount(payload({ state: 'no_course', trial_today_left: null }));
  await screen.findByRole('region', { name: 'Bạn chưa có khoá học' });
  expect(screen.queryByText(/Chấm thử hôm nay/)).toBeNull();
});

it('order_pending: order card with a warning and supplement date for needs_info (FR-028)', async () => {
  mount(payload({
    state: 'order_pending',
    orders_open: [{ order_code: 'AV-1029', status: 'needs_info', product_title: 'IELTS 6.5 online', supplement_by: '2026-11-25T10:00:00Z' }],
  }));
  const block = await screen.findByRole('region', { name: 'Đơn đăng ký của bạn' });
  expect(within(block).getByText('Mã đơn AV-1029 · Cần bổ sung thông tin')).toBeTruthy();
  expect(within(block).getByText('Bổ sung trước 25/11/2026 để đơn được xác nhận.')).toBeTruthy();
  expect(within(block).getByText('Cảnh báo')).toBeTruthy();
  expect(screen.queryByText(/Lượt chấm AI/)).toBeNull();
});

it('order_pending with a failed order list shows the order block error, not "no course"', async () => {
  mount(payload({ state: 'order_pending', orders_open: [], degraded: ['orders_open'] }));
  const block = await screen.findByRole('region', { name: 'Đơn đăng ký của bạn' });
  expect(within(block).getByText('Đơn đăng ký')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Bạn chưa có khoá học' })).toBeNull();
});

it('a failed load shows one notice with a retry that calls the API again', async () => {
  get = vi.fn().mockRejectedValueOnce(Object.assign(new Error('HTTP 500'), { status: 500 }))
    .mockResolvedValueOnce(payload());
  post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  render(<TodayV2 accountId="learner-1" />);
  expect(await screen.findByText('Chưa tải được việc hôm nay')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('heading', { name: 'Hôm nay không có bài đến hạn.' })).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});

it('a response outside the contract is an error, not a blank page', async () => {
  mount({ state: 'unknown' });
  expect(await screen.findByText('Chưa tải được việc hôm nay')).toBeTruthy();
});

// ── /home switch (FR-075) ─────────────────────────────────────────────────────

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'learner-1', email: null } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
const profile = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/lib/auth/auth-me-single-flight.mjs', () => ({
  getAuthMeProfile: (id: string | null) => (id && profile.current?.id === id ? profile.current : null),
  subscribeAuthMeProfile: () => () => {},
}));
vi.mock('next/dynamic', () => ({
  default: () => function LazyToday({ accountId }: { accountId: string }) {
    return <p>new tree for {accountId}</p>;
  },
}));

it('flag off or profile not loaded: the legacy tree, unchanged', async () => {
  const { HomeTreeSwitch } = await import('@/app/(authed-home)/home/home-tree-switch');
  profile.current = null;
  const view = render(<HomeTreeSwitch><p>legacy home</p></HomeTreeSwitch>);
  expect(screen.getByText('legacy home')).toBeTruthy();
  view.unmount();
  profile.current = { id: 'learner-1', learner_v2_enabled: false };
  render(<HomeTreeSwitch><p>legacy home</p></HomeTreeSwitch>);
  expect(screen.getByText('legacy home')).toBeTruthy();
  expect(screen.queryByText(/new tree/)).toBeNull();
});

it('flag on for this account: the new tree replaces the legacy one', async () => {
  const { HomeTreeSwitch } = await import('@/app/(authed-home)/home/home-tree-switch');
  profile.current = { id: 'learner-1', learner_v2_enabled: true };
  render(<HomeTreeSwitch><p>legacy home</p></HomeTreeSwitch>);
  expect(screen.getByText('new tree for learner-1')).toBeTruthy();
  expect(screen.queryByText('legacy home')).toBeNull();
});

it("another account's profile never turns the new tree on", async () => {
  const { HomeTreeSwitch } = await import('@/app/(authed-home)/home/home-tree-switch');
  profile.current = { id: 'someone-else', learner_v2_enabled: true };
  render(<HomeTreeSwitch><p>legacy home</p></HomeTreeSwitch>);
  expect(screen.getByText('legacy home')).toBeTruthy();
});
