// LEARNERCORE-0063 T30a/T30b: the "Bài được giao" v2 page (`assigned-v2.tsx`)
// and the /course/assigned switch. Cases from plan.md "T30a": order of the four
// groups, empty groups hidden, the overdue strip with its count, the button by
// `action`, filters and "Bỏ lọc", the query keeps the choice, flag off renders
// the legacy tree; plus the T30b button.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AssignedV2 } from '@/app/(authed-my-class)/course/assigned/assigned-v2';
import { selfPracticeHref } from '@/app/(authed-my-class)/course/assigned/assigned-v2-open';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const admission = vi.hoisted(() => vi.fn(async (_surface: string, query: Record<string, string>) => `/practice/session?session_id=${query.session_id}`));
vi.mock('@/lib/core-player-affinity.mjs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveCorePlayerAdmissionForNavigation: admission,
}));

const NOW = Date.parse('2026-11-23T03:00:00Z');
const PAST = '2026-11-20T10:00:00Z';
const SOON = '2026-11-25T10:00:00Z';
const LATER = '2026-11-28T10:00:00Z';

type Over = Record<string, unknown>;

function item(id: string, group: string, action: string, over: Over = {}) {
  const { skill = 'reading', due = SOON, submitted = null, assignment = {}, ...rest } = over as Over & {
    skill?: string; due?: string | null; submitted?: string | null; assignment?: Over;
  };
  return {
    item_id: id, state: 'assigned', submitted_at: submitted, score: null, passed_at: null,
    course_action: skill === 'course' ? 'start' : null,
    is_late: false, is_missing: group === 'overdue', writing_expected: null,
    assignment: { id: `a-${id}`, cohort_id: 'c1', cohort_name: 'Lớp 1', title: `Bài ${id}`, skill, due_at: due,
      instructions: null, content_config: {}, ...assignment },
    group, action, accepting: group === 'todo', self_practice_available: action === 'self_practice',
    ...rest,
  };
}

function payload(items: unknown[], over: Over = {}) {
  return { has_class: true, items, repractice: [], homework_stale: false, degraded: [], ...over };
}

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
const assign = vi.fn();
const REAL_LOCATION = window.location;

function mount(body: unknown, search = '') {
  get = vi.fn(async () => body);
  post = vi.fn(async () => undefined);
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith: get, post } });
  window.history.replaceState(null, '', `/course/assigned${search}`);
  return render(<AssignedV2 accountId="learner-1" />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Object.defineProperty(window, 'showToast', { configurable: true, value: vi.fn() });
  // Only `assign` is replaced: `search`, `pathname` stay live for the query tests.
  Object.defineProperty(window, 'location', { configurable: true, value: {
    assign,
    get href() { return REAL_LOCATION.href; },
    get origin() { return REAL_LOCATION.origin; },
    get pathname() { return REAL_LOCATION.pathname; },
    get search() { return REAL_LOCATION.search; },
    get hash() { return REAL_LOCATION.hash; },
  } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  push.mockReset();
  assign.mockReset();
  admission.mockClear();
  Object.defineProperty(window, 'location', { configurable: true, value: REAL_LOCATION });
});

const MIXED = [
  item('done', 'returned', 'result', { skill: 'speaking', submitted: '2026-11-21T10:00:00Z' }),
  item('wait', 'awaiting_review', 'review_submitted', { skill: 'writing', submitted: '2026-11-22T10:00:00Z',
    review_state: 'graded', band: null, result_path: null }),
  item('later', 'todo', 'start', { due: LATER }),
  item('soon', 'todo', 'resume', { due: SOON, state: 'opened' }),
  item('nodue', 'todo', 'start', { due: null }),
  item('late', 'overdue', 'start', { due: PAST, accepting: true }),
  item('closed', 'overdue', 'self_practice', { skill: 'listening', due: PAST }),
];

it('reads /api/student/assigned exactly once and writes nothing on load (FR-095)', async () => {
  mount(payload(MIXED));
  await screen.findByRole('region', { name: 'Cần làm' });
  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0][0]).toBe('/api/student/assigned');
  expect(post).not.toHaveBeenCalled();
});

it('four groups in a fixed order, sorted inside, the overdue strip counts (FR-096)', async () => {
  mount(payload(MIXED));
  await screen.findByRole('region', { name: 'Cần làm' });
  const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(titles.slice(0, 4)).toEqual(['Quá hạn · 2', 'Cần làm · 3', 'Chờ giáo viên duyệt · 1', 'Đã trả · 1']);
  expect(screen.getByText('Quá hạn · 2 bài chưa nộp')).toBeTruthy();
  const todo = within(screen.getByRole('region', { name: 'Cần làm' })).getAllByRole('listitem');
  expect(todo.map((li) => li.textContent?.match(/Bài ([a-z]+)/)?.[1])).toEqual(['soon', 'later', 'nodue']);
  expect(within(todo[2]).getByText('Không có hạn nộp')).toBeTruthy();
  // The card counts work not handed in that the server still takes.
  expect(screen.getByRole('link', { name: 'Bài được giao (4)' }).getAttribute('aria-current')).toBe('page');
});

it('an empty group is hidden; no work at all says so, with no filters (FR-096)', async () => {
  const view = mount(payload([item('x', 'todo', 'start')]));
  await screen.findByRole('region', { name: 'Cần làm' });
  expect(screen.queryByRole('region', { name: 'Quá hạn' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Đã trả' })).toBeNull();
  view.unmount();
  mount(payload([]));
  expect(await screen.findByText('Giáo viên chưa giao bài nào cho lớp của bạn.')).toBeTruthy();
  expect(screen.queryByLabelText('Kỹ năng')).toBeNull();
  expect(screen.getByRole('link', { name: 'Bài được giao' })).toBeTruthy();
});

it('one button per action, none for `none`; a closed row says so (FR-097, FR-099)', async () => {
  mount(payload([
    ...MIXED,
    item('gone', 'overdue', 'none', { skill: 'speaking', due: PAST }),
  ]));
  const overdue = await screen.findByRole('region', { name: 'Quá hạn' });
  const rows = within(overdue).getAllByRole('listitem');
  const byTitle = (id: string) => rows.find((li) => li.textContent?.includes(`Bài ${id}`))!;
  expect(within(byTitle('late')).getByRole('button', { name: 'Làm bài' })).toBeTruthy();
  expect(within(byTitle('late')).getByText('Quá hạn')).toBeTruthy();
  expect(within(byTitle('closed')).getByText('Không còn nhận bài')).toBeTruthy();
  expect(within(byTitle('closed')).getByRole('button', { name: 'Tự luyện bài này' })).toBeTruthy();
  expect(within(byTitle('gone')).queryByRole('button')).toBeNull();
  const todo = screen.getByRole('region', { name: 'Cần làm' });
  expect(within(todo).getByRole('button', { name: 'Làm tiếp' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Chờ giáo viên duyệt' })).getByRole('button', { name: 'Xem bài đã nộp' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Đã trả' })).getByRole('button', { name: 'Xem kết quả' })).toBeTruthy();
});

it('late hand-in label, Vietnam time, band only when returned (FR-097)', async () => {
  mount(payload([
    item('w1', 'returned', 'result', { skill: 'writing', due: '2026-11-13T10:00:00Z', submitted: '2026-11-16T14:10:00Z',
      is_late: true, review_state: 'returned', band: 6.5, result_path: '/writing/result?id=w1' }),
    item('w2', 'awaiting_review', 'review_submitted', { skill: 'writing', submitted: '2026-11-22T10:00:00Z',
      review_state: 'graded', band: null, result_path: null }),
  ]));
  const returned = await screen.findByRole('region', { name: 'Đã trả' });
  expect(within(returned).getByText('Nộp trễ 4 ngày')).toBeTruthy();
  expect(within(returned).getByText(/nộp 21:10, 16\/11/)).toBeTruthy();
  expect(within(returned).getByText('Hạn 17:00, 13/11')).toBeTruthy();
  expect(within(returned).getByText(/Band 6\.5/)).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Chờ giáo viên duyệt' }).textContent).not.toMatch(/Band/);
});

it('a row opens its exact item through the class start route (FR-097)', async () => {
  mount(payload([item('soon', 'todo', 'start')]));
  const todo = await screen.findByRole('region', { name: 'Cần làm' });
  post.mockImplementation(async () => ({ item_id: 'soon', assignment_id: 'a-soon', skill: 'reading',
    player_surface: 'reading_exam', player_query: { test_id: 'cam18-t1', class_item: 'soon' } }));
  fireEvent.click(within(todo).getByRole('button', { name: 'Làm bài' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/class/assignments/soon/start'));
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(String(assign.mock.calls[0][0])).toContain('class_item=soon');
});

it('filters: counts over the whole list, AND, "Bỏ lọc", kept in the query (FR-098)', async () => {
  mount(payload(MIXED));
  await screen.findByRole('region', { name: 'Cần làm' });
  const skill = screen.getByLabelText('Kỹ năng') as HTMLSelectElement;
  const state = screen.getByLabelText('Trạng thái') as HTMLSelectElement;
  expect([...skill.options].map((o) => o.textContent)).toEqual(
    ['Tất cả (7)', 'Writing (1)', 'Speaking (1)', 'Listening (1)', 'Reading (4)']);
  expect([...state.options].map((o) => o.textContent)).toEqual(
    ['Tất cả (7)', 'Quá hạn (2)', 'Cần làm (3)', 'Chờ giáo viên duyệt (1)', 'Đã trả (1)']);
  expect(screen.getByText('Cả 7 bài')).toBeTruthy();

  fireEvent.change(skill, { target: { value: 'reading' } });
  expect(window.location.search).toBe('?skill=reading');
  expect(screen.getByText(/Hiện 4 trên 7 bài/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Đã trả' })).toBeNull();

  fireEvent.change(state, { target: { value: 'returned' } });
  expect(window.location.search).toBe('?skill=reading&state=returned');
  expect(screen.getByText('Không có bài nào khớp bộ lọc')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Bỏ lọc' })[0]);
  expect(window.location.search).toBe('');
  expect(screen.getByText('Cả 7 bài')).toBeTruthy();
});

it('a reload keeps the filters from the query; an unknown value falls back to all (FR-098)', async () => {
  const view = mount(payload(MIXED), '?skill=writing&state=awaiting_review');
  await screen.findByRole('region', { name: 'Chờ giáo viên duyệt' });
  expect((screen.getByLabelText('Kỹ năng') as HTMLSelectElement).value).toBe('writing');
  expect(screen.queryByRole('region', { name: 'Cần làm' })).toBeNull();
  view.unmount();
  mount(payload(MIXED), '?skill=vocab');
  await screen.findByRole('region', { name: 'Cần làm' });
  expect((screen.getByLabelText('Kỹ năng') as HTMLSelectElement).value).toBe('all');
});

it('a failed read is an error with retry, never "no work" (FR-103)', async () => {
  const view = mount(payload([], { degraded: ['items'] }));
  expect(await screen.findByText('Chưa tải được bài được giao.')).toBeTruthy();
  expect(screen.queryByText('Giáo viên chưa giao bài nào cho lớp của bạn.')).toBeNull();
  view.unmount();
  get = vi.fn(async () => { throw Object.assign(new Error('boom'), { status: 500 }); });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith: get, post } });
  render(<AssignedV2 accountId="learner-1" />);
  expect(await screen.findByText('Bài bạn đã nộp không mất.')).toBeTruthy();
  get.mockImplementation(async () => payload([item('x', 'todo', 'start')]));
  fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại' }));
  expect(await screen.findByRole('region', { name: 'Cần làm' })).toBeTruthy();
});

it('no class: the sheet sentence, no groups; stale ledger: a note (FR-103)', async () => {
  const view = mount(payload([], { has_class: false }));
  expect(await screen.findByText(/Bạn chưa vào lớp nào\./)).toBeTruthy();
  expect(screen.queryByText('Bài của lớp được chấm thế nào')).toBeNull();
  view.unmount();
  mount(payload([item('x', 'todo', 'start')], { homework_stale: true }));
  expect(await screen.findByText(/Bài bạn vừa nộp có thể chưa hiện ở đây\./)).toBeTruthy();
});

it('re-practice block hidden when empty, shown with the sheet sentence; grading steps (FR-102)', async () => {
  const view = mount(payload([item('x', 'todo', 'start')]));
  await screen.findByRole('region', { name: 'Cần làm' });
  expect(screen.queryByRole('region', { name: 'Khoá được cấp quyền luyện lại' })).toBeNull();
  const steps = within(screen.getByRole('region', { name: 'Bài của lớp được chấm thế nào' })).getAllByRole('listitem');
  expect(steps).toHaveLength(4);
  view.unmount();
  mount(payload([item('x', 'todo', 'start')], { repractice: [{ code: 'C1', title: 'Course 1' }] }));
  const block = await screen.findByRole('region', { name: 'Khoá được cấp quyền luyện lại' });
  expect(within(block).getByText('Course 1')).toBeTruthy();
  expect(within(block).getByText(/không phải bài được giao/)).toBeTruthy();
});

// ── "Tự luyện bài này" (T30b, FR-100) ─────────────────────────────────────────

it('self-practice: Listening opens the public launch without the class item', async () => {
  mount(payload([item('closed', 'overdue', 'self_practice', { skill: 'listening', due: PAST })]));
  const overdue = await screen.findByRole('region', { name: 'Quá hạn' });
  post.mockImplementation(async () => ({ skill: 'listening', launch: { href: '/core-player/launch?surface=listening_test&id=L1' } }));
  fireEvent.click(within(overdue).getByRole('button', { name: 'Tự luyện bài này' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/core-player/launch?surface=listening_test&id=L1'));
  expect(post).toHaveBeenCalledWith('/api/class/assignments/closed/self-practice');
  expect(post).not.toHaveBeenCalledWith('/api/class/assignments/closed/start');
});

it('self-practice: Speaking creates a plain session (no class item) and opens the player', async () => {
  mount(payload([item('sp', 'overdue', 'self_practice', { skill: 'speaking', due: PAST })]));
  const overdue = await screen.findByRole('region', { name: 'Quá hạn' });
  post.mockImplementation(async (url: string) => (url === '/sessions'
    ? { id: 'sess-1' }
    : { skill: 'speaking', launch: { session_params: { mode: 'practice', part: 1, topic: 'T1' } } }));
  fireEvent.click(within(overdue).getByRole('button', { name: 'Tự luyện bài này' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/practice/session?session_id=sess-1'));
  expect(post).toHaveBeenCalledWith('/sessions', { mode: 'practice', part: 1, topic: 'T1' });
});

it('self-practice: an empty Speaking topic is refused before any session is created', async () => {
  mount(payload([item('sp', 'overdue', 'self_practice', { skill: 'speaking', due: PAST })]));
  const overdue = await screen.findByRole('region', { name: 'Quá hạn' });
  post.mockImplementation(async () => ({ skill: 'speaking', launch: { session_params: { mode: 'practice', part: 1, topic: '  ' } } }));
  fireEvent.click(within(overdue).getByRole('button', { name: 'Tự luyện bài này' }));
  await waitFor(() => expect(window.showToast).toHaveBeenCalled());
  expect(post).not.toHaveBeenCalledWith('/sessions', expect.anything());
  expect(push).not.toHaveBeenCalled();
});

it('back from the player via the bfcache releases the open lock', async () => {
  mount(payload([item('a', 'todo', 'self_practice', { skill: 'listening' }), item('b', 'todo', 'self_practice', { skill: 'listening' })]));
  const todo = await screen.findByRole('region', { name: 'Cần làm' });
  post.mockImplementation(async () => ({ skill: 'listening', launch: { href: '/core-player/launch?surface=listening_test&id=L1' } }));
  const [first, second] = within(todo).getAllByRole('button', { name: 'Tự luyện bài này' });
  fireEvent.click(first);
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  fireEvent.click(second);
  expect(post).toHaveBeenCalledTimes(1);
  const shown = new Event('pageshow') as PageTransitionEvent;
  Object.defineProperty(shown, 'persisted', { value: true });
  window.dispatchEvent(shown);
  await waitFor(() => expect(within(todo).getAllByRole('button', { name: 'Tự luyện bài này' })).toHaveLength(2));
  fireEvent.click(within(todo).getAllByRole('button', { name: 'Tự luyện bài này' })[1]);
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
});

it('a pending open is dropped when the page unmounts: no session, no navigation', async () => {
  const view = mount(payload([item('sp', 'overdue', 'self_practice', { skill: 'speaking', due: PAST })]));
  const overdue = await screen.findByRole('region', { name: 'Quá hạn' });
  let release: (value: unknown) => void = () => {};
  post.mockImplementation((url: string) => (url === '/sessions' ? Promise.resolve({ id: 'sess-1' })
    : new Promise((resolve) => { release = resolve; })));
  fireEvent.click(within(overdue).getByRole('button', { name: 'Tự luyện bài này' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  view.unmount();
  release({ skill: 'speaking', launch: { session_params: { mode: 'practice', part: 1, topic: 'T1' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(post).not.toHaveBeenCalledWith('/sessions', expect.anything());
  expect(push).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
});

it('returned Speaking shows its score as the band; a course percentage never does', async () => {
  mount(payload([
    item('s1', 'returned', 'result', { skill: 'speaking', submitted: '2026-11-22T10:00:00Z', score: 6.5 }),
    item('c1', 'returned', 'result', { skill: 'course', submitted: '2026-11-21T10:00:00Z', score: 80, course_action: 'review' }),
  ]));
  const returned = await screen.findByRole('region', { name: 'Đã trả' });
  expect(within(returned).getByText(/Band 6\.5/)).toBeTruthy();
  expect(within(returned).queryByText(/Band 80/)).toBeNull(); expect(within(returned).getAllByRole('listitem').length).toBe(2);
});

it('self-practice: a refusal shows the server sentence and keeps the page', async () => {
  mount(payload([item('closed', 'overdue', 'self_practice', { skill: 'reading', due: PAST })]));
  const overdue = await screen.findByRole('region', { name: 'Quá hạn' });
  post.mockImplementation(async () => {
    throw Object.assign(new Error('x'), { status: 409, code: null,
      detail: { error: 'homework_attempt_in_progress', message: 'x' } });
  });
  fireEvent.click(within(overdue).getByRole('button', { name: 'Tự luyện bài này' }));
  await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
    'Không mở được bài: Bạn còn một lượt làm bài được giao đang dở trên đề này.', 'error', { timeout: 6000 }));
  expect(assign).not.toHaveBeenCalled();
  expect(within(overdue).getByRole('button', { name: 'Tự luyện bài này' })).toBeTruthy();
});

it('a launch href that carries the class item is refused', () => {
  expect(selfPracticeHref('/core-player/launch?surface=reading_exam&test_id=r1')).toBe('/core-player/launch?surface=reading_exam&test_id=r1');
  expect(selfPracticeHref('/core-player/launch?surface=reading_exam&test_id=r1&class_item=i1')).toBeNull();
  expect(selfPracticeHref('https://evil.example/core-player/launch?x=1')).toBeNull();
});

it('a load is dropped when the account changes or the page unmounts', async () => {
  let release: (value: unknown) => void = () => {};
  get = vi.fn(() => new Promise((resolve) => { release = resolve; }));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith: get, post } });
  const view = render(<AssignedV2 accountId="learner-1" />);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  const signal = get.mock.calls[0][2]?.signal as AbortSignal | undefined;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  release(payload([item('x', 'todo', 'start')]));
});

// ── /course/assigned switch (FR-095) ──────────────────────────────────────────

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'learner-1', email: null } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
const profile = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/lib/auth/auth-me-single-flight.mjs', () => ({
  getAuthMeProfile: (id: string | null) => (id && profile.current?.id === id ? profile.current : null),
  subscribeAuthMeProfile: () => () => {},
}));
vi.mock('next/dynamic', () => ({
  default: () => function LazyAssigned({ accountId }: { accountId: string }) {
    return <p>new tree for {accountId}</p>;
  },
}));

it('flag off or profile not loaded: MyClassWorkspace, unchanged', async () => {
  const { AssignedTreeSwitch } = await import('@/app/(authed-my-class)/course/assigned/assigned-tree-switch');
  profile.current = null;
  const view = render(<AssignedTreeSwitch><p>legacy my class</p></AssignedTreeSwitch>);
  expect(screen.getByText('legacy my class')).toBeTruthy();
  view.unmount();
  profile.current = { id: 'learner-1', learner_v2_enabled: false };
  render(<AssignedTreeSwitch><p>legacy my class</p></AssignedTreeSwitch>);
  expect(screen.getByText('legacy my class')).toBeTruthy();
  expect(screen.queryByText(/new tree/)).toBeNull();
});

it('flag on for this account only: the new tree', async () => {
  const { AssignedTreeSwitch } = await import('@/app/(authed-my-class)/course/assigned/assigned-tree-switch');
  profile.current = { id: 'someone-else', learner_v2_enabled: true };
  const view = render(<AssignedTreeSwitch><p>legacy my class</p></AssignedTreeSwitch>);
  expect(screen.getByText('legacy my class')).toBeTruthy();
  view.unmount();
  profile.current = { id: 'learner-1', learner_v2_enabled: true };
  render(<AssignedTreeSwitch><p>legacy my class</p></AssignedTreeSwitch>);
  expect(screen.getByText('new tree for learner-1')).toBeTruthy();
  expect(screen.queryByText('legacy my class')).toBeNull();
});
