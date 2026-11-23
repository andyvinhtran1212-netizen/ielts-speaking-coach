// UIBASE-0056 G03-T14 (FR-007, FR-008, FR-016, FR-017): LearnerShell behaviour.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/speaking' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

import { LearnerShell, type LearnerShellProps } from '@/components/ui/shell/learner-shell';
import { useLearnerShellPanel } from '@/components/ui/shell/learner-panel';
import { LOOKUP_EMPTY, LOOKUP_FAILED, type LookupGroup } from '@/components/ui/shell/quick-lookup';
import { LEARNER_NAV, liveHref } from '@/components/ui/shell/learner-sections';
import { routeFor } from '@/lib/route-registry.mjs';

const USER = { name: 'Trần Quốc Bảo', email: 'quocbao@example.com', initials: 'QB' };
const GROUPS: LookupGroup[] = [
  { group: 'writing', items: [{ title: 'Task 2 — Working from home', href: '/w/1' }] },
  { group: 'vocabulary', items: [
    { title: 'agree', meta: 'động từ', href: '/v/agree' },
    { title: 'agreement', href: '/v/agreement' },
    { title: 'agreeable', href: '/v/agreeable' },
  ] },
  { group: 'grammar', items: [{ title: 'Sự hoà hợp chủ ngữ và động từ', href: '/g/sva' }] },
];

function Bell() {
  const [open, setOpen] = useLearnerShellPanel('notifications');
  return (
    <>
      <button type="button" aria-label="Thông báo" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open ? <div role="dialog" aria-label="Ngăn thông báo" /> : null}
    </>
  );
}

function renderShell(props: Partial<LearnerShellProps> = {}) {
  return render(
    <LearnerShell user={USER} canSwitchToAdmin={false} {...props}>
      <input aria-label="Ô trong trang" />
    </LearnerShell>,
  );
}

const sections = () => screen.getByRole('navigation', { name: 'Mục chính' });
const accountButton = () => screen.getByRole('button', { name: `Tài khoản: ${USER.name}` });

beforeEach(() => { nav.pathname = '/speaking'; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('sections', () => {
  it('shows the five fixed sections, in order, on the bar and the phone bar', () => {
    renderShell();
    const labels = ['Hôm nay', 'Lộ trình', 'Luyện tập', 'Thi thử', 'Thư viện'];
    expect(within(sections()).getAllByRole('link').map((a) => a.textContent)).toEqual(labels);
    const bottom = screen.getByRole('navigation', { name: 'Thanh mục chính' });
    expect(within(bottom).getAllByRole('link').map((a) => a.textContent)).toEqual(labels);
  });

  it('derives the current section from the pathname via the route registry', () => {
    renderShell();
    expect(within(sections()).getByRole('link', { name: 'Luyện tập' }).getAttribute('aria-current')).toBe('page');
    expect(within(sections()).getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
    cleanup();
    nav.pathname = '/grammar';
    renderShell();
    expect(within(sections()).getByRole('link', { name: 'Thư viện' }).getAttribute('aria-current')).toBe('page');
    cleanup();
    nav.pathname = '/ui-library';
    renderShell();
    expect(sections().querySelector('[aria-current]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
  });

  it('every section is a keyboard stop: five links with an href and no negative tabindex', () => {
    renderShell();
    for (const link of within(sections()).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\//);
      expect(link.getAttribute('tabindex')).not.toBe('-1');
    }
  });

  it('the tablet menu names the current section, lists all five and closes on Esc with focus back', () => {
    renderShell();
    const button = screen.getByRole('button', { name: 'Menu: Luyện tập' });
    fireEvent.click(button);
    const list = screen.getByRole('navigation', { name: 'Menu mục chính' });
    expect(within(list).getAllByRole('link')).toHaveLength(5);
    expect(within(list).getByRole('link', { name: 'Luyện tập' }).getAttribute('aria-current')).toBe('page');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Menu mục chính' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('hides the phone bar while the on-screen keyboard is open', () => {
    const listeners: Array<() => void> = [];
    const vv = { height: 800, addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener() {} };
    vi.stubGlobal('visualViewport', vv);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    renderShell();
    const bar = () => document.querySelector('nav[aria-label="Thanh mục chính"]') as HTMLElement;
    expect(bar().hidden).toBe(false);
    act(() => { vv.height = 450; listeners.forEach((fn) => fn()); });
    expect(bar().hidden).toBe(true);
    act(() => { vv.height = 790; listeners.forEach((fn) => fn()); });
    expect(bar().hidden).toBe(false);
  });
});

describe('account menu', () => {
  it('learner: fixed order, no "Đổi vai trò" and no empty row for it', () => {
    renderShell();
    fireEvent.click(accountButton());
    const menu = screen.getByRole('dialog', { name: 'Tài khoản' });
    expect(menu.textContent).toContain(USER.name);
    expect(menu.textContent).toContain(USER.email);
    expect(within(menu).getAllByRole('link').map((a) => a.textContent))
      // Registry Q53: a link shows only once its route is live. All four are
      // live since G07-T17 (/help, then /progress and /account).
      .toEqual(['Tiến độ', 'Khoá học và lượt AI', 'Hồ sơ', 'Trợ giúp']);
    expect(within(menu).queryByText(/Đổi vai trò/)).toBeNull();
    expect(menu.querySelectorAll('li')).toHaveLength(4);
    expect(within(menu).getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
    expect(within(menu).getByRole('group', { name: 'Giao diện' })).toBeTruthy();
  });

  it('admin confirmed by the server: "Đổi vai trò: sang Quản trị" right before Đăng xuất', () => {
    renderShell({ canSwitchToAdmin: true });
    fireEvent.click(accountButton());
    const menu = screen.getByRole('dialog', { name: 'Tài khoản' });
    const links = within(menu).getAllByRole('link');
    expect(links.at(-1)?.textContent).toBe('Đổi vai trò: sang Quản trị');
    expect(links.at(-1)?.getAttribute('href')).toBe('/admin');
  });

  it('closes on the button, a click outside and Esc; Esc returns focus to the button', () => {
    renderShell();
    fireEvent.click(accountButton());
    expect(accountButton().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(accountButton());
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();

    fireEvent.click(accountButton());
    fireEvent.pointerDown(screen.getByLabelText('Ô trong trang'));
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();

    fireEvent.click(accountButton());
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Tài khoản' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();
    expect(document.activeElement).toBe(accountButton());
  });
});

describe('one overlay at a time', () => {
  it('opening the lookup, the bell or the account menu closes the other two', () => {
    renderShell({ lookup: async () => [], notificationsSlot: <Bell /> });
    fireEvent.click(screen.getByRole('button', { name: 'Tra nhanh (phím /)' }));
    expect(screen.getByRole('combobox', { name: 'Tra nhanh' })).toBeTruthy();
    fireEvent.click(accountButton());
    expect(screen.queryByRole('combobox', { name: 'Tra nhanh' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Tài khoản' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Ngăn thông báo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tra nhanh (phím /)' }));
    expect(screen.queryByRole('dialog', { name: 'Ngăn thông báo' })).toBeNull();
  });
});

describe('slots and credits', () => {
  it('slots not passed take no space; passed slots sit in the sheet order before the account button', () => {
    const { container } = renderShell();
    expect(screen.queryByRole('button', { name: /Tra nhanh/ })).toBeNull();
    expect(container.querySelectorAll('header span:empty')).toHaveLength(0);
    cleanup();
    renderShell({
      credits: { remaining: 12, low: false },
      overdueSlot: <a href="/home">3 quá hạn</a>,
      notificationsSlot: <Bell />,
      lookup: async () => [],
    });
    // The right-hand group: the account button's wrapper sits in it, last.
    const actions = accountButton().parentElement!.parentElement!;
    const order = [...actions.querySelectorAll('a, button')]
      .map((el) => el.getAttribute('aria-label') || el.textContent?.trim());
    expect(order).toEqual(['Lượt chấm AI còn Lượt AI 12', '3 quá hạn', 'Tra nhanh (phím /)', 'Thông báo', `Tài khoản: ${USER.name}`]);
  });

  it('credits: hidden when not passed, XXX while unknown, "Sắp hết" words when low, trial text without a course', () => {
    renderShell();
    expect(screen.getByRole('banner').textContent).not.toMatch(/Lượt/);
    cleanup();
    renderShell({ credits: { remaining: null, low: false } });
    expect(screen.getByRole('banner').textContent).toContain('XXX');
    cleanup();
    renderShell({ credits: { remaining: 2, low: true } });
    expect(screen.getByRole('link', { name: 'Sắp hết · còn 2 lượt' })).toBeTruthy();
    cleanup();
    renderShell({ credits: { remaining: 12, low: false }, trialLeft: 1 });
    expect(screen.getByRole('banner').textContent).toContain('Chấm thử hôm nay còn 1 bài');
    expect(screen.getByRole('banner').textContent).not.toContain('Lượt chấm AI');
  });
});

describe('account menu on a phone', () => {
  it('is a modal sheet: Tab and Shift+Tab stay inside, Esc closes from anywhere, focus returns', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767px)', media: query,
      addEventListener: () => {}, removeEventListener: () => {},
    }));
    // jsdom has no layout; report a box so the trap sees the controls as visible.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    renderShell();
    fireEvent.click(accountButton());
    const sheet = screen.getByRole('dialog', { name: 'Tài khoản' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');

    const close = within(sheet).getByRole('button', { name: 'Đóng' });
    const first = within(sheet).getAllByRole('link')[0];
    close.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    // Focus somewhere outside the sheet's wrapper: Esc still closes it.
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Tài khoản' })).toBeNull();
    expect(document.activeElement).toBe(accountButton());
  });
});

describe('quick lookup', () => {
  it('"/" opens it with focus in the field, but not while typing in a field', () => {
    renderShell({ lookup: async () => [] });
    fireEvent.keyDown(screen.getByLabelText('Ô trong trang'), { key: '/' });
    expect(screen.queryByRole('combobox', { name: 'Tra nhanh' })).toBeNull();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Tra nhanh' }));
  });

  it('groups in sheet order, 2 rows each; arrows choose, Enter opens, Esc closes with focus back', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderShell({ lookup: async () => GROUPS });
    const trigger = screen.getByRole('button', { name: 'Tra nhanh (phím /)' });
    fireEvent.click(trigger);
    const box = screen.getByRole('combobox', { name: 'Tra nhanh' });
    await act(async () => { fireEvent.change(box, { target: { value: 'agr' } }); });
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label')))
      .toEqual(['Từ · Từ vựng', 'Bài ngữ pháp · Grammar Wiki', 'Đề bài mẫu · Writing']);
    expect(within(list).getAllByRole('option').map((o) => o.getAttribute('href')))
      .toEqual(['/v/agree', '/v/agreement', '/g/sva', '/w/1']);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(within(list).getAllByRole('option')[2].id);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).toHaveBeenCalledWith('/g/sva');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Tra nhanh' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('no suggestion: the sheet sentence', async () => {
    renderShell({ lookup: async () => [] });
    fireEvent.click(screen.getByRole('button', { name: 'Tra nhanh (phím /)' }));
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Tra nhanh' }), { target: { value: 'zzz' } });
    });
    expect(screen.getByRole('status').textContent).toBe(LOOKUP_EMPTY);
  });

  it('a failed search says so and is not "Không thấy kết quả"', async () => {
    renderShell({ lookup: () => Promise.reject(new Error('offline')) });
    fireEvent.click(screen.getByRole('button', { name: 'Tra nhanh (phím /)' }));
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Tra nhanh' }), { target: { value: 'agr' } });
    });
    expect(screen.getByRole('alert').textContent).toBe(LOOKUP_FAILED);
    expect(screen.queryByText(LOOKUP_EMPTY)).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a request still pending when the panel closes cannot refill it or be opened with Enter', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    let resolve: (groups: LookupGroup[]) => void = () => {};
    renderShell({ lookup: () => new Promise<LookupGroup[]>((done) => { resolve = done; }) });
    const trigger = screen.getByRole('button', { name: 'Tra nhanh (phím /)' });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox', { name: 'Tra nhanh' }), { target: { value: 'agr' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Tra nhanh' }), { key: 'Escape' });
    await act(async () => { resolve([{ group: 'grammar', items: [{ title: 'SVA', href: '/g/sva' }] }]); });

    fireEvent.click(trigger);
    const box = screen.getByRole('combobox', { name: 'Tra nhanh' });
    expect(box).toHaveProperty('value', '');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('live links only (registry Q53)', () => {
  it('every rendered href, admin switch and footer included, is a live route-registry entry', () => {
    renderShell({ canSwitchToAdmin: true });
    fireEvent.click(accountButton());
    const hrefs = [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href') as string)
      .filter((href) => href.startsWith('/'));
    expect(hrefs.length).toBeGreaterThan(10);
    expect(hrefs.filter((href) => routeFor(href)?.status !== 'live')).toEqual([]);
  });

  it('the five sections are all shown, each on a page of its own section', () => {
    expect(LEARNER_NAV.map((s) => [s.label, s.href])).toEqual([
      ['Hôm nay', '/home'], ['Lộ trình', '/my-class'], ['Luyện tập', '/speaking'],
      ['Thi thử', '/full-test'], ['Thư viện', '/library'],
    ]);
    for (const s of LEARNER_NAV) expect(routeFor(s.href)?.section).toBe(s.id);
  });

  it('a planned route wins once live, and a link with no live page is hidden', () => {
    expect(liveHref({ href: '/library', today: '/home' })).toBe('/library');
    expect(liveHref({ href: '/course', today: '/my-class' })).toBe('/my-class');
    expect(liveHref({ href: '/help', today: null })).toBe('/help');
    expect(liveHref({ href: '/progress', today: null })).toBe('/progress');
    expect(liveHref({ href: '/tests', today: null })).toBeNull();
    expect(liveHref({ href: '/tests', today: '/nowhere' })).toBeNull();
  });
});
