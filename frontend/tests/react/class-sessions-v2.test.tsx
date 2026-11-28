// LEARNERCORE-0063 amendment 6 (G07-T30c): "Buổi học và tài liệu lớp" at
// /course/class (`class-sessions-v2.tsx`) and its flag gate (`class-gate.tsx`).
// Cases from plan.md "T30c" and the HOLD patch for FR-119/FR-124.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Activity } from 'react';

import { ClassSessionsV2 } from '@/app/(authed-my-class)/course/class/class-sessions-v2';
import { documentNavigation } from '@/lib/tree-replace';

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('next/dynamic', () => ({
  default: () => function Loaded({ accountId }: { accountId: string }) {
    return <div data-testid="v2">{accountId}</div>;
  },
}));
const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'learner-1' } as { id: string } | null }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
const profiles = vi.hoisted(() => ({ value: null as Record<string, unknown> | null, listeners: new Set<() => void>() }));
vi.mock('@/lib/auth/auth-me-single-flight.mjs', () => ({
  // A fresh copy on every call, like the real store (`clonePayload`).
  getAuthMeProfile: (id: string) => (profiles.value && profiles.value.id === id ? { ...profiles.value } : null),
  subscribeAuthMeProfile: (fn: () => void) => { profiles.listeners.add(fn); return () => profiles.listeners.delete(fn); },
}));

const NOW = Date.parse('2026-11-23T03:00:00Z'); // 10:00 in Vietnam

type Over = Record<string, unknown>;

function lesson(id: string, no: number | null, date: string | null, over: Over = {}) {
  return { id, cohort_id: 'c1', cohort_name: 'Lớp tối', title: `Chủ đề ${id}`, lesson_no: no,
    lesson_date: date, body_md: '', attachments: [], created_at: 'x', ...over };
}

function classMe(over: Over = {}) {
  return {
    has_class: true,
    class: { id: 'c1', name: 'Lớp tối 2-4', description: 'Lớp luyện thi 6.5', course: { code: 'C2', name: 'Course 2' } },
    classes: [
      { id: 'c1', name: 'Lớp tối 2-4', description: 'Lớp luyện thi 6.5', course: { code: 'C2', name: 'Course 2' },
        instructor: { name: 'Trần Thu Hà' }, weekly_schedule: [{ dow: 3, start: '18:30' }, { dow: 1, start: '18:30' }] },
      { id: 'c2', name: 'Lớp cuối tuần', description: null, course: null, instructor: null, weekly_schedule: [] },
    ],
    class_count: 2,
    progress: { total: 0, submitted: 0, todo: 0, missing: 0, late: 0, on_time_pct: null },
    student: { full_name: 'A', student_code: 'S1' },
    lessons: [
      lesson('L1', 1, '2026-11-16', { attachments: [
        { label: 'Slide buổi 1', url: 'https://drive.google.com/file/1' },
        { label: 'Paraphrase Task 2', url: 'https://www.youtube.com/watch?v=1' },
        { label: 'Tệp nội bộ', url: 'javascript:alert(1)' },
      ] }),
      lesson('L2', 2, '2026-11-23', { body_md: 'Nội dung **buổi 2**' }),
      lesson('L3', 3, '2026-11-25'),
      lesson('W1', 1, '2026-11-21', { cohort_id: 'c2', cohort_name: 'Lớp cuối tuần' }),
    ],
    assignments: [],
    ...over,
  };
}

function work(id: string, lessonId: string | null, over: Over = {}) {
  return {
    item_id: id, state: 'assigned', submitted_at: null, score: null, passed_at: null, course_action: null,
    is_late: false, is_missing: false, writing_expected: null,
    assignment: { id: `a-${id}`, cohort_id: 'c1', cohort_name: 'Lớp tối', title: `Bài ${id}`, skill: 'reading',
      due_at: '2026-11-25T10:00:00Z', instructions: null, content_config: {} },
    group: 'todo', action: 'start', accepting: true, self_practice_available: false, lesson_id: lessonId,
    ...over,
  };
}

function assigned(items: unknown[], over: Over = {}) {
  return { has_class: true, items, repractice: [], homework_stale: false, degraded: [], ...over };
}

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;

function mount(me: unknown, work_: unknown, search = '', page = <ClassSessionsV2 accountId="learner-1" />) {
  get = vi.fn(async (path: string) => {
    const body = path === '/api/class/me' ? me : path === '/api/student/assigned' ? work_ : null;
    if (body instanceof Error) throw body;
    return body;
  });
  post = vi.fn(async () => undefined);
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith: get, post } });
  window.history.replaceState(null, '', `/course/class${search}`);
  return render(page);
}

const calls = (path: string) => get.mock.calls.filter(([p]) => p === path).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Object.defineProperty(window, 'showToast', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  replace.mockReset();
  push.mockReset();
  profiles.value = null;
  auth.status = 'signed-in';
  vi.restoreAllMocks();
  auth.user = { id: 'learner-1' };
});

it('stops checking for the Markdown renderer when the lesson closes (FR-121)', async () => {
  const view = mount(classMe(), assigned([]));
  await screen.findByText('Nội dung **buổi 2**');
  view.unmount();

  const renderer = vi.fn(() => vi.fn());
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, get: renderer });
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(renderer).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(window, 'renderMarkdown');
  }
});

it('reads each API exactly once; changing session or class reads nothing more (FR-124)', async () => {
  mount(classMe(), assigned([work('i1', 'L2')]));
  await screen.findByRole('region', { name: 'Các buổi học' });
  fireEvent.click(screen.getByRole('button', { name: /Buổi 3/ }));
  fireEvent.change(screen.getByLabelText('Lớp'), { target: { value: 'c2' } });
  await screen.findByRole('button', { name: /Chủ đề W1/ });
  expect(calls('/api/class/me')).toBe(1);
  expect(calls('/api/student/assigned')).toBe(1);
  expect(post).not.toHaveBeenCalled();
});

it('header: class, course, teacher, schedule, description and the learned count (FR-120)', async () => {
  mount(classMe(), assigned([]));
  await screen.findByRole('heading', { name: 'Lớp tối 2-4' });
  expect(screen.getByText('Course 2 · giáo viên Trần Thu Hà · Thứ Hai và Thứ Tư, 18:30')).toBeTruthy();
  expect(screen.getByText('Lớp luyện thi 6.5')).toBeTruthy();
  expect(screen.getByText('Đã học 1 buổi')).toBeTruthy();
});

it('class_meta degraded hides teacher and schedule but keeps the rest', async () => {
  mount(classMe({ degraded: ['class_meta'] }), assigned([]));
  await screen.findByRole('heading', { name: 'Lớp tối 2-4' });
  expect(screen.getByText('Course 2')).toBeTruthy();
  expect(screen.queryByText(/giáo viên Trần Thu Hà/)).toBeNull();
  expect(screen.queryByText(/18:30/)).toBeNull();
  expect(screen.getByRole('region', { name: 'Các buổi học' })).toBeTruthy();
});

it('sessions in API order with labels; today opens by default; ?session= wins (FR-121)', async () => {
  mount(classMe(), assigned([]));
  const list = await screen.findByRole('region', { name: 'Các buổi học' });
  const rows = within(list).getAllByRole('button').map((b) => b.textContent);
  expect(rows).toEqual([
    'Buổi 1Chủ đề L1Thứ Hai 16/11/2026 · Đã học',
    'Buổi 2Chủ đề L2Thứ Hai 23/11/2026 · Hôm nay',
    'Buổi 3Chủ đề L3Thứ Tư 25/11/2026 · Sắp tới',
  ]);
  expect(screen.getByRole('heading', { level: 2, name: 'Chủ đề L2' })).toBeTruthy();
  cleanup();
  mount(classMe(), assigned([]), '?session=L3');
  expect(await screen.findByRole('heading', { level: 2, name: 'Chủ đề L3' })).toBeTruthy();
  cleanup();
  mount(classMe(), assigned([]), '?session=W1');
  expect(await screen.findByRole('heading', { level: 2, name: 'Chủ đề L2' })).toBeTruthy();
});

it('picking a class writes ?class= and opens that class\'s default session (FR-120)', async () => {
  mount(classMe(), assigned([]));
  await screen.findByRole('region', { name: 'Các buổi học' });
  fireEvent.change(screen.getByLabelText('Lớp'), { target: { value: 'c2' } });
  expect(await screen.findByRole('heading', { level: 2, name: 'Lớp cuối tuần' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: 'Chủ đề W1' })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get('class')).toBe('c2');
  expect(new URLSearchParams(window.location.search).get('session')).toBe('W1');
  expect(screen.queryByText(/giáo viên Trần/)).toBeNull();
});

it('an unknown ?class= falls back to the first class', async () => {
  mount(classMe(), assigned([]), '?class=zzz');
  expect(await screen.findByRole('heading', { level: 2, name: 'Lớp tối 2-4' })).toBeTruthy();
});

it('materials: YouTube and document rows open a new tab; an unopenable one shows no path (FR-122)', async () => {
  mount(classMe(), assigned([]), '?session=L1');
  const block = await screen.findByRole('region', { name: 'Tài liệu buổi học' });
  const video = within(block).getByRole('link', { name: 'Xem trên YouTube' });
  expect(video.getAttribute('href')).toBe('https://www.youtube.com/watch?v=1');
  expect(video.getAttribute('target')).toBe('_blank');
  expect(video.getAttribute('rel')).toBe('noopener noreferrer');
  expect(within(block).getByText('Video · YouTube')).toBeTruthy();
  expect(within(block).getByRole('link', { name: 'Mở tài liệu' }).getAttribute('href')).toBe('https://drive.google.com/file/1');
  expect(within(block).getByText('Chưa mở được tài liệu này. Các tài liệu khác vẫn dùng được.')).toBeTruthy();
  expect(block.innerHTML).not.toContain('javascript:');
  expect(within(block).getAllByRole('link')).toHaveLength(2);
});

it('a session without materials says so; its Markdown body renders through window.renderMarkdown', async () => {
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (md: string) => `<p>${md.replace(/\*\*(.+)\*\*/, '<strong>$1</strong>')}</p>` });
  mount(classMe(), assigned([]));
  await screen.findByText('Buổi này chưa có tài liệu.');
  await waitFor(() => expect(document.querySelector('strong')?.textContent).toBe('buổi 2'));
  delete (window as any).renderMarkdown;
});

it('homework of the open session by lesson_id, with the FR-097 button (FR-123)', async () => {
  mount(classMe(), assigned([work('i1', 'L2'), work('i2', null), work('i3', 'L3')]));
  const block = await screen.findByRole('region', { name: 'Bài tập về nhà của buổi' });
  expect(within(block).getByText('Bài i1')).toBeTruthy();
  expect(within(block).queryByText('Bài i2')).toBeNull();
  expect(within(block).queryByText('Bài i3')).toBeNull();
  expect(within(block).getByRole('button', { name: 'Làm bài' })).toBeTruthy();
  expect(within(block).getByRole('link', { name: 'Xem trong Bài được giao ›' }).getAttribute('href')).toBe('/course/assigned');
  fireEvent.click(screen.getByRole('button', { name: /Buổi 1/ }));
  expect(await screen.findByText('Buổi này chưa có bài tập về nhà.')).toBeTruthy();
});

it('a stale homework read warns alongside the linked assignment button', async () => {
  mount(classMe(), assigned([work('i1', 'L2')], { homework_stale: true }));
  const block = await screen.findByRole('region', { name: 'Bài tập về nhà của buổi' });
  expect(within(block).getByText('Bài bạn vừa nộp có thể chưa hiện ở đây. Nếu đã làm xong, không cần làm lại.')).toBeTruthy();
  expect(within(block).getByText('Bài i1')).toBeTruthy();
  expect((within(block).getByRole('button', { name: 'Làm bài' }) as HTMLButtonElement).disabled).toBe(false);
});

it('soft Back from a result releases the session homework button', async () => {
  const page = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}><ClassSessionsV2 accountId="learner-1" /></Activity>
  );
  const row = work('i1', 'L2', { action: 'result', group: 'returned' });
  row.assignment.skill = 'speaking';
  const view = mount(classMe(), assigned([row]), '', page('visible'));
  const block = await screen.findByRole('region', { name: 'Bài tập về nhà của buổi' });
  post.mockResolvedValue({ item_id: 'i1', assignment_id: 'a-i1', skill: 'speaking', result_session_id: 'speaking-1' });
  fireEvent.click(within(block).getByRole('button', { name: 'Xem kết quả' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/result?id=speaking-1'));

  view.rerender(page('hidden'));
  view.rerender(page('visible'));
  const restored = await screen.findByRole('region', { name: 'Bài tập về nhà của buổi' });
  fireEvent.click(within(restored).getByRole('button', { name: 'Xem kết quả' }));
  await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
});

it('a start answered after unmount does nothing (no navigation, no toast)', async () => {
  const view = mount(classMe(), assigned([work('i1', 'L2')]));
  const block = await screen.findByRole('region', { name: 'Bài tập về nhà của buổi' });
  let answer: (value: unknown) => void = () => {};
  post.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
  fireEvent.click(within(block).getByRole('button', { name: 'Làm bài' }));
  expect(post).toHaveBeenCalledWith('/api/class/assignments/i1/start');
  view.unmount();
  await act(async () => { answer({ bogus: true }); });
  expect(push).not.toHaveBeenCalled();
  expect(window.showToast).not.toHaveBeenCalled();
});

it('no work of the class tied to a session hides the block at every session', async () => {
  mount(classMe(), assigned([work('i1', null), work('i9', 'L9', {
    assignment: { id: 'a-i9', cohort_id: 'c2', title: 'Bài i9', skill: 'reading', due_at: null, content_config: {} } })]));
  await screen.findByRole('region', { name: 'Các buổi học' });
  await screen.findByRole('link', { name: 'Bài tập của lớp ở Bài được giao ›' });
  expect(screen.queryByRole('region', { name: 'Bài tập về nhà của buổi' })).toBeNull();
  expect(screen.queryByText('Buổi này chưa có bài tập về nhà.')).toBeNull();
});

it('lesson_links degraded hides the block like no links', async () => {
  mount(classMe(), assigned([work('i1', 'L2')], { degraded: ['lesson_links'] }));
  await screen.findByRole('link', { name: 'Bài tập của lớp ở Bài được giao ›' });
  expect(screen.queryByRole('region', { name: 'Bài tập về nhà của buổi' })).toBeNull();
});

it('assigned read failing shows an error only in the homework block, retry re-reads only it', async () => {
  mount(classMe(), new Error('down'));
  await screen.findByText('Chưa tải được bài tập của buổi.');
  expect(screen.getByRole('region', { name: 'Tài liệu buổi học' })).toBeTruthy();
  get.mockImplementation(async (path: string) => (path === '/api/student/assigned' ? assigned([work('i1', 'L2')]) : classMe()));
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Bài i1')).toBeTruthy();
  expect(calls('/api/class/me')).toBe(1);
  expect(calls('/api/student/assigned')).toBe(2);
});

it('degraded lessons: only the session block reports it (FR-124)', async () => {
  mount(classMe({ lessons: [], degraded: ['lessons'] }), assigned([]));
  expect(await screen.findByText('Chưa tải được buổi học')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Lớp tối 2-4' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
});

it('a class with no published session says so and keeps the card', async () => {
  mount(classMe({ lessons: [] }), assigned([]));
  expect(await screen.findByText('Giáo viên chưa đăng buổi học nào.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Lớp tối 2-4' })).toBeTruthy();
});

it('degraded class (HOLD patch): no per-class block, a Notice with retry', async () => {
  mount(classMe({ degraded: ['class'], classes: [...classMe().classes, { id: 'archived', name: 'Lớp cũ', course: null }],
    lessons: [lesson('A1', 1, '2026-10-01', { cohort_id: 'archived', attachments: [{ label: 'x', url: 'https://x.test' }] })] }),
  assigned([work('i1', 'A1')]));
  expect(await screen.findByText('Chưa xác minh được lớp của bạn.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Các buổi học' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Tài liệu buổi học' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Bài tập về nhà của buổi' })).toBeNull();
  expect(document.querySelector('a[href="https://x.test/"]')).toBeNull();
});

it('has_class false shows the Notice with a link back to /course (FR-119)', async () => {
  mount({ has_class: false }, assigned([], { has_class: false }));
  expect(await screen.findByText('Bạn chưa ở lớp nào. Bài và tài liệu của lớp hiện ở đây khi giáo viên thêm bạn vào lớp.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Về Lộ trình' }).getAttribute('href')).toBe('/course');
  expect(screen.queryByRole('link', { name: 'Buổi học và tài liệu lớp' })).toBeNull();
});

it('a failed class read is an error with retry, never "no class"', async () => {
  mount(new Error('500'), assigned([]));
  expect(await screen.findByText('Chưa tải được trang lớp.')).toBeTruthy();
  expect(screen.queryByText(/Bạn chưa ở lớp nào/)).toBeNull();
});

it('draws no block the spec leaves out (FR-125)', async () => {
  mount(classMe(), assigned([work('i1', 'L2')]));
  await screen.findByRole('region', { name: 'Bài tập về nhà của buổi' });
  const text = document.body.textContent || '';
  for (const absent of ['Nhận xét của giáo viên', 'Báo cáo bài kiểm tra', 'sắp có', 'Tải về']) {
    expect(text).not.toContain(absent);
  }
  expect(document.querySelector('iframe')).toBeNull();
});

it('the three Lộ trình cards, the class card current', async () => {
  mount(classMe(), assigned([work('i1', 'L2')]));
  const nav = await screen.findByRole('navigation', { name: 'Lộ trình' });
  await waitFor(() => expect(within(nav).getByRole('link', { name: 'Bài được giao (1)' })).toBeTruthy());
  expect(within(nav).getByRole('link', { name: 'Buổi học và tài liệu lớp' }).getAttribute('aria-current')).toBe('page');
});

// ── gate ──────────────────────────────────────────────────────────────────────

it('gate: flag off replaces the URL with /my-class and makes no class request', async () => {
  const { ClassGate } = await import('@/app/(authed-my-class)/course/class/class-gate');
  get = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, getWith: get } });
  profiles.value = { id: 'learner-1', learner_v2_enabled: false };
  render(<ClassGate />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/my-class'));
  expect(screen.queryByTestId('v2')).toBeNull();
  expect(get).not.toHaveBeenCalled();
});

it('gate: waits for the profile, then flag on mounts the page for that account', async () => {
  const { ClassGate } = await import('@/app/(authed-my-class)/course/class/class-gate');
  render(<ClassGate />);
  expect(screen.queryByTestId('v2')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
  act(() => {
    profiles.value = { id: 'learner-1', learner_v2_enabled: true };
    profiles.listeners.forEach((fn) => fn());
  });
  expect((await screen.findByTestId('v2')).textContent).toBe('learner-1');
  expect(replace).not.toHaveBeenCalled();
});

it('gate: another account\'s enabled profile is not accepted', async () => {
  const { ClassGate } = await import('@/app/(authed-my-class)/course/class/class-gate');
  profiles.value = { id: 'other', learner_v2_enabled: true };
  render(<ClassGate />);
  expect(screen.queryByTestId('v2')).toBeNull();
});


it('gate: a direct signed-out visit replaces the whole document with login', async () => {
  const docReplace = vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {});
  const { ClassGate } = await import('@/app/(authed-my-class)/course/class/class-gate');
  auth.status = 'signed-out';
  auth.user = null;
  render(<ClassGate />);

  expect(docReplace).toHaveBeenCalledExactlyOnceWith('/login');
  expect(screen.queryByTestId('v2')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it('gate: a cross-tab sign-out clears the open class page and replaces it with login', async () => {
  const docReplace = vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {});
  const { ClassGate } = await import('@/app/(authed-my-class)/course/class/class-gate');
  profiles.value = { id: 'learner-1', learner_v2_enabled: true };
  const view = render(<ClassGate />);
  expect((await screen.findByTestId('v2')).textContent).toBe('learner-1');

  auth.status = 'initial-loading';
  auth.user = null;
  view.rerender(<ClassGate />);
  expect(screen.getByRole('status')).toBeTruthy();
  expect(docReplace).not.toHaveBeenCalled();

  auth.status = 'signed-out';
  view.rerender(<ClassGate />);
  expect(docReplace).toHaveBeenCalledExactlyOnceWith('/login');
  expect(screen.queryByTestId('v2')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});
