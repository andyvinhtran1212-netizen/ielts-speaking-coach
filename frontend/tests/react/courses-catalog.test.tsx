// PUBLICSITE-0059 T04 — `/courses` catalogue body (FR-004, 005, 006, 022, 023).
// Fixtures are fake (tests/fixtures/commerce); nothing here calls a backend.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CourseCatalog } from '@/app/(public-commerce)/courses/course-catalog';
import type { CourseItem } from '@/lib/commerce-types';

import oneOpen from '../fixtures/commerce/catalog-one-open.json';
import twoOpen from '../fixtures/commerce/catalog-two-open.json';

const auth = vi.hoisted(() => ({ status: 'signed-out' as 'signed-in' | 'signed-out' | 'initial-loading', id: 'learner-a' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: auth.status, user: auth.status === 'signed-in' ? { id: auth.id } : null }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const GUEST = oneOpen.items as unknown as CourseItem[];

function withViewer(items: CourseItem[], states: Record<string, Partial<CourseItem['viewer']>>): CourseItem[] {
  return items.map((item) => (states[item.slug]
    ? { ...item, viewer: { ...item.viewer, ...states[item.slug] } as CourseItem['viewer'] }
    : item));
}

let calls: string[];
let catalogs: Record<string, CourseItem[] | Error>;
let holds: Record<string, Promise<void>>;

beforeEach(() => {
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '1');
  calls = [];
  catalogs = {};
  holds = {};
  auth.status = 'signed-out';
  auth.id = 'learner-a';
  Object.assign(window, { api: {
    getWith: async (path: string) => {
      const who = auth.id;
      calls.push(`GET ${path} as ${who}`);
      if (path === '/api/me/open-alerts') return { slugs: [] };
      if (holds[who]) await holds[who];
      const answer = catalogs[who] ?? GUEST;
      if (answer instanceof Error) throw answer;
      return { items: answer };
    },
  } });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

function list() {
  return within(screen.getByRole('list'));
}

function rows() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

it('one course open, five upcoming: six rows, a fee only on the open one, no bundle block', () => {
  render(<CourseCatalog initialItems={GUEST} />);
  expect(rows()).toHaveLength(6);
  expect(screen.getByText('1 khoá đang mở đăng ký · 5 khoá sắp mở')).toBeTruthy();

  const [open, ...upcoming] = rows();
  expect(within(open).getByText('Đang mở đăng ký')).toBeTruthy();
  expect(within(open).getByText('1.200.000 đ')).toBeTruthy();
  for (const row of upcoming) {
    expect(within(row).getByText('Sắp mở')).toBeTruthy();
    expect(within(row).queryByText(/\d\.\d{3}\.\d{3} đ/)).toBeNull();
    expect(within(row).getByText('Học phí công bố khi mở đăng ký')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Báo cho tôi khi mở' })).toBeTruthy();
  }
  expect(within(open).queryByRole('button', { name: 'Báo cho tôi khi mở' })).toBeNull();
  expect(within(upcoming[0]).getByText('Dự kiến mở: 15/01/2027')).toBeTruthy();
  expect(screen.queryByText(/bộ \d+ khoá|mua bộ/i)).toBeNull();
  // FR-004: no zero or placeholder for a missing number.
  expect(within(upcoming[0]).queryByText(/0 lượt chấm AI|XXX/)).toBeNull();
});

it('a guest sends no request and the activation link goes through login', () => {
  render(<CourseCatalog initialItems={GUEST} />);
  expect(calls).toEqual([]);
  expect(screen.getByRole('link', { name: 'Nhập mã' }).getAttribute('href')).toBe('/login?next=%2Factivate');
  expect(within(rows()[0]).getByRole('link', { name: 'Khoá giả A' }).getAttribute('href')).toBe('/courses/khoa-a');
});

it('signed in: own states from the session read, one primary "Vào học", "Đăng ký lại" for an expired course', async () => {
  auth.status = 'signed-in';
  catalogs['learner-a'] = withViewer(twoOpen.items as unknown as CourseItem[], {
    'khoa-a': { state: 'enrolled', days_left: 30 },
    'khoa-b': { state: 'enrolled', days_left: 120 },
    'khoa-c': { state: 'expired', days_left: 0, can_renew: true },
  });
  render(<CourseCatalog initialItems={twoOpen.items as unknown as CourseItem[]} />);

  expect(await list().findByText('Bạn đang học · còn 120 ngày')).toBeTruthy();
  expect(list().getByText('Bạn đang học · còn 30 ngày')).toBeTruthy();
  const learn = screen.getAllByRole('link', { name: 'Vào học' });
  expect(learn).toHaveLength(2);
  expect(learn.filter((a) => /primary/.test(a.className))).toHaveLength(1);
  const [rowA, rowB, rowC] = rows();
  expect(/primary/.test(within(rowB).getByRole('link', { name: 'Vào học' }).className)).toBe(true);
  expect(/primary/.test(within(rowA).getByRole('link', { name: 'Vào học' }).className)).toBe(false);
  expect(within(rowC).getByText('Hết hạn')).toBeTruthy();
  expect(within(rowC).getByRole('link', { name: 'Đăng ký lại' }).getAttribute('href')).toBe('/courses/khoa-c');
  expect(screen.getByRole('link', { name: 'Nhập mã' }).getAttribute('href')).toBe('/activate');
});

it('a failed session read says so, keeps the general rows, and "Thử lại" reads again', async () => {
  auth.status = 'signed-in';
  catalogs['learner-a'] = Object.assign(new Error('boom'), { status: 503 });
  render(<CourseCatalog initialItems={GUEST} />);
  expect(await screen.findByText(/Chưa tải được trạng thái khoá học của bạn/)).toBeTruthy();
  expect(rows()).toHaveLength(6);
  expect(list().queryByText(/Bạn đang học/)).toBeNull();

  catalogs['learner-a'] = withViewer(GUEST, { 'khoa-a': { state: 'enrolled', days_left: 10 } });
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await list().findByText('Bạn đang học · còn 10 ngày')).toBeTruthy();
  expect(screen.queryByText(/Chưa tải được trạng thái/)).toBeNull();
});

it('A → B: an answer for A that arrives after the switch is dropped; sign-out returns to the guest rows', async () => {
  auth.status = 'signed-in';
  let releaseA!: () => void;
  holds['learner-a'] = new Promise<void>((resolve) => { releaseA = resolve; });
  catalogs['learner-a'] = withViewer(GUEST, { 'khoa-a': { state: 'enrolled', days_left: 77 } });
  catalogs['learner-b'] = withViewer(GUEST, { 'khoa-a': { state: 'enrolled', days_left: 5 } });
  const view = render(<CourseCatalog initialItems={GUEST} />);

  auth.id = 'learner-b';
  view.rerender(<CourseCatalog initialItems={GUEST} />);
  expect(await list().findByText('Bạn đang học · còn 5 ngày')).toBeTruthy();
  releaseA();
  await new Promise((r) => setTimeout(r, 0));
  expect(list().queryByText('Bạn đang học · còn 77 ngày')).toBeNull();
  expect(list().getByText('Bạn đang học · còn 5 ngày')).toBeTruthy();

  auth.status = 'signed-out';
  view.rerender(<CourseCatalog initialItems={GUEST} />);
  await waitFor(() => expect(list().queryByText(/Bạn đang học/)).toBeNull());
  expect(within(rows()[0]).getByText('Đang mở đăng ký')).toBeTruthy();
});

it('compare table: a row nobody has is left out, a missing cell reads "Chưa công bố"', () => {
  render(<CourseCatalog initialItems={GUEST} />);
  const table = screen.getByRole('table');
  expect(within(table).queryByText('Số bài học')).toBeNull();
  expect(within(table).getByText('Giả A')).toBeTruthy();
  expect(within(table).getAllByText('Chưa công bố').length).toBeGreaterThan(0);
  expect(within(table).queryByText(/^0/)).toBeNull();
  // FR-023: the upcoming columns of the fee and trial rows.
  const fee = within(table).getByText('Học phí').closest('tr') as HTMLElement;
  expect(within(fee).getByText('1.200.000 đ')).toBeTruthy();
  expect(within(fee).getAllByText('Công bố khi mở đăng ký')).toHaveLength(5);
  const trial = within(table).getByText('Bài học thử').closest('tr') as HTMLElement;
  expect(within(trial).getAllByText('Khi mở đăng ký')).toHaveLength(5);
});

it('chooser: the first answer is picked, a change updates the suggestion, nothing is sent', () => {
  const items = GUEST.map((item, i) => ({ ...item, summary: `Mô tả giả ${i + 1}` }));
  render(<CourseCatalog initialItems={items} />);
  const suggestion = screen.getByText('Gợi ý cho bạn').parentElement as HTMLElement;
  expect(within(suggestion).getByText('Khoá giả A')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'Mô tả giả 2' }));
  expect(within(suggestion).getByText('Khoá giả B')).toBeTruthy();
  expect(within(suggestion).getByText(/Khoá này sắp mở/)).toBeTruthy();
  expect(calls).toEqual([]);
});

it('build flag off: course links are not rendered as /courses targets', () => {
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '0');
  render(<CourseCatalog initialItems={GUEST} />);
  expect(screen.queryAllByRole('link').some((a) => (a.getAttribute('href') ?? '').startsWith('/courses'))).toBe(false);
});

it('FR-029: the page is a real 404 while the build flag is off', async () => {
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '0');
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/commerce-api', () => ({ getCatalog: async () => ({ items: GUEST }) }));
  const { default: CoursesPage } = await import('@/app/(public-commerce)/courses/page');
  expect(() => CoursesPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  vi.stubEnv('AVER_PUBLIC_COMMERCE', '1');
  expect(() => CoursesPage()).not.toThrow();
});
