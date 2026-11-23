import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEBOUNCE_MS,
  QUICK_SEARCH_OPEN_EVENT,
  QuickSearchButton,
  SEARCH_EMPTY,
  SEARCH_FAILED,
  SEARCH_HINT,
  StaffQuickSearch,
} from '@/components/staff-quick-search';
import { shapeStaffSearch } from '@/lib/staff-search';

vi.mock('client-only', () => ({}));

const ADMIN_RESULT = {
  learners: [
    { title: 'Nguyễn Thị Lan', meta: 'HV001', href: '/admin/students' },
    { title: 'Lan Phạm', meta: null, href: '/admin/students' },
  ],
  classes: [{ title: 'Tue–Thu 19:30', meta: 'TT19', href: '/admin/classes/c-1' }],
  submissions: [],
  content: [{ title: 'Lan chart', meta: 'Writing', href: '/admin/writing/prompts?q=x' }],
  orders: [],
  sources_failed: [],
  unavailable: ['orders'],
};

let post: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  post = vi.fn(async () => ADMIN_RESULT);
  Object.assign(window, { api: { post } });
  assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function type(value: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
  await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });
  await act(async () => { await Promise.resolve(); });
}

async function openWith(init: KeyboardEventInit) {
  await act(async () => { fireEvent.keyDown(document.body, init); });
  await act(async () => { vi.runOnlyPendingTimers(); });
}

describe('StaffQuickSearch', () => {
  it.each([{ key: 'k', ctrlKey: true }, { key: 'k', metaKey: true }])('opens on %o, Esc closes and returns focus', async (init) => {
    render(<><button type="button">before</button><StaffQuickSearch door="admin" /></>);
    const before = screen.getByText('before');
    before.focus();
    await openWith(init);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(screen.getByText(SEARCH_HINT)).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('leaves Ctrl+K alone while the cursor is in a field', async () => {
    render(<><input aria-label="other" /><StaffQuickSearch door="admin" /></>);
    const field = screen.getByLabelText('other');
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { field.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the header button event', async () => {
    render(<><QuickSearchButton /><StaffQuickSearch door="instructor" /></>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Tìm nhanh/ })); });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('waits for two characters and 250 ms, then posts q in the body', async () => {
    render(<StaffQuickSearch door="admin" />);
    await act(async () => { window.dispatchEvent(new CustomEvent(QUICK_SEARCH_OPEN_EVENT)); });
    await type('l');
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'la' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lan ' } });
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS - 1); });
    expect(post).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    await act(async () => { await Promise.resolve(); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/admin/search', { q: 'lan' });
    // Groups in order, empty groups hidden (no Bài nộp, no Đơn đăng ký).
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Học viên', 'Lớp', 'Đề']);
  });

  it('↑ ↓ choose and Enter opens the chosen href', async () => {
    render(<StaffQuickSearch door="admin" />);
    await act(async () => { window.dispatchEvent(new CustomEvent(QUICK_SEARCH_OPEN_EVENT)); });
    await type('lan');
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(options[2].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[2].id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[3].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(assign).toHaveBeenCalledWith('/admin/students');
  });

  it('teacher door uses /instructor/search and never shows Đề or Đơn đăng ký', async () => {
    post.mockResolvedValueOnce({ ...ADMIN_RESULT });
    render(<StaffQuickSearch door="instructor" />);
    await act(async () => { window.dispatchEvent(new CustomEvent(QUICK_SEARCH_OPEN_EVENT)); });
    await type('lan');
    expect(post).toHaveBeenCalledWith('/instructor/search', { q: 'lan' });
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Học viên', 'Lớp']);
  });

  it('says so when nothing matches, when the search fails, and when a group could not be read', async () => {
    render(<StaffQuickSearch door="admin" />);
    await act(async () => { window.dispatchEvent(new CustomEvent(QUICK_SEARCH_OPEN_EVENT)); });
    post.mockResolvedValueOnce({ learners: [], classes: [], submissions: [], content: [], orders: [], sources_failed: [], unavailable: [] });
    await type('zz');
    expect(screen.getByText(SEARCH_EMPTY)).toBeTruthy();
    post.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }));
    await type('zzz');
    expect(screen.getByRole('alert').textContent).toBe(SEARCH_FAILED);
    expect(screen.queryByText(SEARCH_EMPTY)).toBeNull();
    post.mockResolvedValueOnce({ ...ADMIN_RESULT, sources_failed: ['submissions'] });
    await type('lan');
    expect(screen.getByRole('alert').textContent).toContain('Bài nộp');
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('ignores a slower earlier answer', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    post.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    render(<StaffQuickSearch door="admin" />);
    await act(async () => { window.dispatchEvent(new CustomEvent(QUICK_SEARCH_OPEN_EVENT)); });
    await type('ng');
    post.mockResolvedValueOnce({ ...ADMIN_RESULT, learners: [], classes: [], content: [] });
    await type('ngx');
    await act(async () => { resolveFirst(ADMIN_RESULT); await Promise.resolve(); });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(SEARCH_EMPTY)).toBeTruthy();
  });

  it.each([
    ['Enter with one old hit', ['Enter']],
    ['↓ then Enter', ['ArrowDown', 'Enter']],
  ])('never opens an old hit while a new query is pending (%s)', async (_label, keys) => {
    post.mockResolvedValueOnce({ ...ADMIN_RESULT, learners: [{ title: 'Old', meta: null, href: '/admin/old' }], classes: [], content: [] });
    render(<StaffQuickSearch door="admin" />);
    await act(async () => { window.dispatchEvent(new CustomEvent(QUICK_SEARCH_OPEN_EVENT)); });
    await type('old');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    let resolveNext: (v: unknown) => void = () => {};
    post.mockImplementationOnce(() => new Promise((r) => { resolveNext = r; }));
    const input = screen.getByRole('combobox');
    // During the debounce…
    fireEvent.change(input, { target: { value: 'olde' } });
    for (const key of keys) fireEvent.keyDown(input, { key });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    // …and while the request is in flight.
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    for (const key of keys) fireEvent.keyDown(input, { key });
    expect(assign).not.toHaveBeenCalled();
    await act(async () => { resolveNext({ ...ADMIN_RESULT, learners: [], classes: [], content: [] }); await Promise.resolve(); });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('shapeStaffSearch', () => {
  it('keeps door groups in order, drops unsafe hrefs and empty groups, names unreadable groups', () => {
    const out = shapeStaffSearch('instructor', {
      learners: [{ title: 'A', href: '//evil.example' }, { title: 'B', meta: null, href: '/instructor' }],
      content: [{ title: 'C', href: '/admin/x' }],
      sources_failed: ['submissions', 'content'],
    });
    expect(out.groups).toEqual([{ group: 'Học viên', items: [{ title: 'B', meta: undefined, href: '/instructor' }] }]);
    expect(out.failed).toEqual(['Bài nộp']);
  });
});
