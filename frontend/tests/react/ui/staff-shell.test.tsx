// UIBASE-0056 G03-T16 (FR-010, FR-018): StaffShell behaviour.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/admin/writing/queue' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/lib/auth/shell-sign-out', () => ({ signOutFromShell: signOut }));

import { StaffShell, type StaffNavGroup, type StaffShellProps } from '@/components/ui/shell/staff-shell';
import {
  SIDEBAR_COLLAPSED_KEY, currentStaffHref, staffEnvironmentFrom,
} from '@/components/ui/shell/staff-nav';
import {
  STAFF_SEARCH_EMPTY, STAFF_SEARCH_FAILED, STAFF_SEARCH_PENDING, type StaffSearchGroup,
} from '@/components/ui/shell/staff-quick-search';
import { routeFor } from '@/lib/route-registry.mjs';
import { StaffShellDemo } from '@/app/(ui-library)/ui-library/staff-demo';
import { SAMPLE_ADMIN_NAV, SAMPLE_INSTRUCTOR_NAV } from '@/app/(ui-library)/ui-library/staff-sample';

const USER = { name: 'Vũ Thanh Tâm', email: 'thanhtam@example.com', initials: 'VT' };

const NAV: StaffNavGroup[] = [
  { id: 'tq', label: 'Tổng quan', icon: 'home', items: [{ label: 'Việc cần làm', href: '/admin' }] },
  { id: 'hv', label: 'Học viên và quyền truy cập', icon: 'users', items: [
    { label: 'Học viên', href: '/admin/students' },
    { label: 'Lớp', href: '/admin/classes' },
    { label: 'Khảo sát và nhận xét', href: '/admin/feedback', count: 4 },
  ] },
  { id: 'cb', label: 'Chấm bài', icon: 'clipboard', items: [
    { label: 'Writing', href: '/admin/writing/queue', count: 3 },
    { label: 'Speaking', href: '/admin/speaking/sessions', count: 2 },
  ] },
  { id: 'ht', label: 'Hệ thống', icon: 'settings', items: [
    { label: 'Hộp thư sự cố', href: '/admin/error-logs', count: 12 },
    { label: 'Bảo mật', href: '/admin/mfa', count: 0 },
  ] },
];

const RESULTS: StaffSearchGroup[] = [
  { group: 'Học viên', items: [
    { title: 'Nguyễn Minh Anh', meta: 'minhanh@example.com', href: '/s/1' },
    { title: 'Trần Minh Quân', href: '/s/2' },
    { title: 'Lê Minh Châu', href: '/s/3' },
    { title: 'Phạm Minh Đức', href: '/s/4' },
  ] },
  { group: 'Lớp', items: [{ title: 'Lớp Tue–Thu 19:30', href: '/c/1' }] },
];

function renderShell(props: Partial<StaffShellProps> = {}) {
  return render(
    <StaffShell role="admin" nav={NAV} environment="production" user={USER} {...props}>
      <p>Nội dung</p>
    </StaffShell>,
  );
}

const sidebar = () => screen.getAllByRole('navigation', { name: 'Điều hướng quản trị' })[0];
const groupButton = (name: RegExp) => within(sidebar()).getAllByRole('button', { name }).find((b) => !b.hasAttribute('data-rail-group'))!;

beforeEach(() => {
  nav.pathname = '/admin/writing/queue';
  window.localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); signOut.mockClear(); });

describe('sidebar groups', () => {
  it('opens the group holding the current page and marks the entry', () => {
    renderShell();
    expect(groupButton(/Chấm bài/).getAttribute('aria-expanded')).toBe('true');
    const group = within(sidebar()).getByRole('group', { name: 'Chấm bài' });
    const current = within(group).getByRole('link', { name: /Writing/ });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(sidebar().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(groupButton(/Hệ thống/).getAttribute('aria-expanded')).toBe('false');
    expect(within(sidebar()).queryByRole('group', { name: 'Hệ thống' })).toBeNull();
  });

  it('a folded group shows the sum of its counts; an open one does not', () => {
    renderShell();
    expect(groupButton(/Hệ thống/).textContent).toBe('Hệ thống12');
    expect(groupButton(/Học viên và quyền truy cập/).textContent).toBe('Học viên và quyền truy cập4');
    expect(groupButton(/Tổng quan/).textContent).toBe('Tổng quan');
    expect(groupButton(/Chấm bài/).textContent).toBe('Chấm bài');
  });

  it('a heading click folds and unfolds a group', () => {
    renderShell();
    fireEvent.click(groupButton(/Hệ thống/));
    expect(groupButton(/Hệ thống/).getAttribute('aria-expanded')).toBe('true');
    expect(within(sidebar()).getByRole('group', { name: 'Hệ thống' })).toBeTruthy();
    fireEvent.click(groupButton(/Chấm bài/));
    expect(within(sidebar()).queryByRole('group', { name: 'Chấm bài' })).toBeNull();
  });

  it('derives the current entry from the pathname, through registry parents', () => {
    nav.pathname = '/admin/classes/42';
    renderShell();
    expect(groupButton(/Học viên và quyền truy cập/).getAttribute('aria-expanded')).toBe('true');
    const group = within(sidebar()).getByRole('group', { name: 'Học viên và quyền truy cập' });
    expect(within(group).getByRole('link', { name: 'Lớp' }).getAttribute('aria-current')).toBe('page');
    expect(currentStaffHref(NAV, '/admin/writing/queue?status=grading')).toBe('/admin/writing/queue');
    expect(currentStaffHref(NAV, '/admin/vocab')).toBeNull();
  });

  it('the rail has one named icon per group with the summed count', () => {
    renderShell();
    const rail = sidebar().querySelectorAll<HTMLButtonElement>('[data-rail-group]');
    expect([...rail].map((b) => [b.getAttribute('aria-label'), b.getAttribute('title')])).toEqual([
      ['Tổng quan', 'Tổng quan'], ['Học viên và quyền truy cập, 4 việc chờ', 'Học viên và quyền truy cập'],
      ['Chấm bài, 5 việc chờ', 'Chấm bài'], ['Hệ thống, 12 việc chờ', 'Hệ thống'],
    ]);
  });

  it('FR-018: at 768–1199px every entry stays reachable through the rail flyouts', () => {
    const { container } = renderShell();
    const rail = container.querySelector('[data-rail-group]')!.closest('div[class]')!.parentElement as HTMLElement;
    const reached = new Set<string>();
    for (const button of [...rail.querySelectorAll<HTMLButtonElement>('[data-rail-group]')]) {
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      const flyout = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement;
      expect(flyout.getAttribute('aria-label')).toBe(button.getAttribute('title'));
      for (const a of flyout.querySelectorAll('a')) reached.add(a.getAttribute('href') as string);
    }
    expect([...reached].sort()).toEqual(NAV.flatMap((g) => g.items.map((i) => i.href)).sort());
  });

  it('a rail flyout: one open at a time, current entry marked, Esc closes and returns focus', () => {
    renderShell();
    const grading = within(sidebar()).getByRole('button', { name: 'Chấm bài, 5 việc chờ' });
    const system = within(sidebar()).getByRole('button', { name: 'Hệ thống, 12 việc chờ' });
    fireEvent.click(system);
    fireEvent.click(grading);
    expect(system.getAttribute('aria-expanded')).toBe('false');
    const flyout = document.getElementById(grading.getAttribute('aria-controls') as string) as HTMLElement;
    expect(within(flyout).getByRole('link', { name: /Writing/ }).getAttribute('aria-current')).toBe('page');
    expect(within(flyout).getByRole('link', { name: /Speaking/ }).getAttribute('href')).toBe('/admin/speaking/sessions');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(grading.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(grading);
    fireEvent.click(grading);
    fireEvent.pointerDown(document.body);
    expect(grading.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('collapse', () => {
  it('is remembered under the <aver-admin-chrome> key and read back on mount', () => {
    renderShell();
    const toggle = within(sidebar()).getByRole('button', { name: 'Thu hẹp thanh bên' });
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    expect(sidebar().getAttribute('data-collapsed')).toBe('true');
    cleanup();
    renderShell();
    expect(sidebar().getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Mở rộng thanh bên' }));
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBeNull();
  });

  it('keeps the environment label when the sidebar is collapsed', () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    renderShell({ environment: 'staging' });
    expect(sidebar().getAttribute('data-collapsed')).toBe('true');
    const bar = screen.getByRole('banner');
    expect(within(bar).getByText('Staging · dữ liệu thử')).toBeTruthy();
    expect(within(bar).getByText('Quản trị · Staging · dữ liệu thử')).toBeTruthy(); // phone strip
  });
});

describe('top bar', () => {
  it('shows role and environment in words; production and staging differ', () => {
    renderShell();
    const bar = screen.getByRole('banner');
    expect(within(bar).getByText('Quản trị')).toBeTruthy();
    const badge = within(bar).getByText('Production · dữ liệu thật');
    expect(badge.getAttribute('data-env')).toBe('production');
    expect(bar.getAttribute('data-env')).toBe('production');
    expect(within(bar).getByRole('link', { name: 'Xem như học viên' }).getAttribute('href')).toBe('/home');
    expect(within(bar).getByRole('link', { name: 'Aver Learning' }).getAttribute('href')).toBe('/admin');
    expect(within(bar).getByRole('button', { name: /Đổi giao diện/ })).toBeTruthy();
  });

  it('maps the runtime environment, never calling unknown config test data', () => {
    expect(staffEnvironmentFrom('production')).toBe('production');
    expect(staffEnvironmentFrom('staging')).toBe('staging');
    expect(staffEnvironmentFrom(null, 'localhost')).toBe('local');
    expect(staffEnvironmentFrom(null, 'www.averlearning.com')).toBe('production');
    expect(staffEnvironmentFrom('preview', 'x.vercel.app')).toBe('production');
  });

  it('account menu: role switch only when given, sign-out through the shared flow', () => {
    renderShell({ switchTo: [{ label: 'sang Giáo viên', href: '/instructor' }] });
    fireEvent.click(screen.getByRole('button', { name: /^Tài khoản:/ }));
    const menu = screen.getByRole('dialog', { name: 'Tài khoản' });
    expect(within(menu).getByRole('link', { name: 'Đổi vai trò: sang Giáo viên' }).getAttribute('href')).toBe('/instructor');
    fireEvent.click(within(menu).getByRole('button', { name: 'Đăng xuất' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(within(menu).getByRole('button', { name: 'Đang đăng xuất…' })).toBeTruthy();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();
    cleanup();
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: /^Tài khoản:/ }));
    expect(within(screen.getByRole('dialog', { name: 'Tài khoản' })).queryByText(/Đổi vai trò/)).toBeNull();
  });

  it('instructor: "Giáo viên", five flat entries, no group headings', () => {
    nav.pathname = '/instructor';
    render(
      <StaffShell role="instructor" nav={SAMPLE_INSTRUCTOR_NAV} environment="production" user={USER}>
        <p>Nội dung</p>
      </StaffShell>,
    );
    const bar = screen.getByRole('banner');
    expect(within(bar).getByText('Giáo viên')).toBeTruthy();
    expect(within(bar).queryByText('Quản trị')).toBeNull();
    const side = screen.getAllByRole('navigation', { name: 'Điều hướng giáo viên' })[0];
    expect(within(side).queryAllByRole('button', { expanded: true })).toHaveLength(1); // only the collapse toggle
    expect(within(side).getAllByRole('link', { current: 'page' })[0].textContent).toBe('Việc của tôi');
  });
});

describe('quick search', () => {
  it('Ctrl+K focuses it; results grouped, three rows a group; arrows and Enter open', async () => {
    const search = vi.fn(async () => RESULTS);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderShell({ search });
    const box = screen.getByRole('combobox', { name: 'Tìm nhanh' });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(box);
    await act(async () => { fireEvent.change(box, { target: { value: 'minh' } }); });
    expect(search).toHaveBeenCalledWith('minh');
    const list = screen.getByRole('listbox', { name: 'Kết quả tìm nhanh' });
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    expect(within(within(list).getByRole('group', { name: 'Học viên' })).getAllByRole('option')).toHaveLength(3);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(within(list).getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).toHaveBeenCalledWith('/s/2');
  });

  it('Esc closes the results and clears the field', async () => {
    renderShell({ search: async () => RESULTS });
    const box = screen.getByRole('combobox', { name: 'Tìm nhanh' }) as HTMLInputElement;
    fireEvent.focus(box);
    await act(async () => { fireEvent.change(box, { target: { value: 'minh' } }); });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box.value).toBe('');
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });

  it('a failed search says so; an empty one says nothing was found', async () => {
    let fail = true;
    renderShell({ search: async () => { if (fail) throw new Error('offline'); return []; } });
    const box = screen.getByRole('combobox', { name: 'Tìm nhanh' });
    await act(async () => { fireEvent.change(box, { target: { value: 'xy' } }); });
    expect(screen.getByRole('alert').textContent).toBe(STAFF_SEARCH_FAILED);
    fail = false;
    await act(async () => { fireEvent.change(box, { target: { value: 'xyz' } }); });
    expect(screen.getByRole('status').textContent).toBe(STAFF_SEARCH_EMPTY);
  });

  it('under two characters it never calls search, so no false network error', async () => {
    const search = vi.fn(async () => RESULTS);
    renderShell({ search });
    const box = screen.getByRole('combobox', { name: 'Tìm nhanh' });
    await act(async () => { fireEvent.change(box, { target: { value: 'm' } }); });
    await act(async () => { fireEvent.change(box, { target: { value: ' m ' } }); });
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    await act(async () => { fireEvent.change(box, { target: { value: 'mi' } }); });
    expect(search).toHaveBeenCalledWith('mi');
  });

  it('while a newer query is pending, the old results cannot be clicked or opened with Enter', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const single: StaffSearchGroup[] = [{ group: 'Học viên', items: [{ title: 'Nguyễn Minh Anh', href: '/s/old' }] }];
    let resolveSecond: (value: readonly StaffSearchGroup[]) => void = () => {};
    const search = vi.fn()
      .mockImplementationOnce(async () => single)
      .mockImplementationOnce(() => new Promise<readonly StaffSearchGroup[]>((resolve) => { resolveSecond = resolve; }));
    renderShell({ search });
    const box = screen.getByRole('combobox', { name: 'Tìm nhanh' });
    await act(async () => { fireEvent.change(box, { target: { value: 'minh' } }); });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await act(async () => { fireEvent.change(box, { target: { value: 'minh q' } }); });
    // Second request still pending: no old option to click, Enter opens nothing.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe(STAFF_SEARCH_PENDING);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).not.toHaveBeenCalled();
    await act(async () => { resolveSecond([{ group: 'Học viên', items: [{ title: 'Trần Minh Quân', href: '/s/new' }] }]); });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('href'))).toEqual(['/s/new']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).toHaveBeenCalledWith('/s/new');
  });

  it('searchSlot (G09-T19 dialog trigger) replaces the built-in field, so ⌘K opens one search only', async () => {
    const search = vi.fn(async () => RESULTS);
    renderShell({ search, searchSlot: <button type="button">Tìm nhanh (G09)</button> });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm nhanh (G09)' })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document, { key: 'k', ctrlKey: true }); });
    expect(search).not.toHaveBeenCalled();
  });

  it('no search function, no field', () => {
    renderShell();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('phone drawer', () => {
  it('the menu button opens a modal with the groups; Esc closes it', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Mở menu quản trị' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu quản trị' });
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    const group = within(drawer).getByRole('group', { name: 'Chấm bài' });
    expect(within(group).getByRole('link', { name: /Writing/ }).getAttribute('aria-current')).toBe('page');
    expect(within(drawer).getAllByRole('button', { expanded: true })).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu quản trị' })).toBeNull();
  });
});

describe('live links only (registry Q53)', () => {
  it('every href the /ui-library staff demos render is a live route-registry entry', () => {
    render(<><StaffShellDemo /><StaffShellDemo role="instructor" /></>);
    for (const head of screen.getAllByRole('button', { expanded: false })) {
      if (head.textContent && !head.getAttribute('aria-label')) fireEvent.click(head); // unfold every group
    }
    fireEvent.click(screen.getAllByRole('button', { name: /^Tài khoản:/ })[0]);
    const collect = () => [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href') as string)
      .filter((href) => href.startsWith('/'));
    const hrefs = collect();
    for (const railButton of document.querySelectorAll<HTMLButtonElement>('[data-rail-group]')) {
      fireEvent.click(railButton); // each rail flyout in turn (one open at a time)
      hrefs.push(...collect());
    }
    expect(hrefs.length).toBeGreaterThan(40);
    expect(hrefs.filter((href) => routeFor(href)?.status !== 'live')).toEqual([]);
  });

  it('the admin sample keeps the eight groups in the sheet order', () => {
    expect(SAMPLE_ADMIN_NAV.map((g) => g.label)).toEqual([
      'Tổng quan', 'Học viên và quyền truy cập', 'Khoá học và đăng ký', 'Chấm bài', 'Nội dung', 'Thi thử', 'Báo cáo', 'Hệ thống',
    ]);
  });
});
