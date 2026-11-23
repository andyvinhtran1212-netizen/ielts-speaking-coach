// ADMINIA-0074 G09-T08 (FR-001…FR-014, plan 5.2): the new admin frame.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/admin/writing/grade', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('@/lib/auth/shell-sign-out', () => ({ signOutFromShell: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'u1', email: 'andy@example.test' }, signOut: vi.fn() }),
}));

import { AdminFrame } from '@/components/admin/admin-frame';
import { ADMIN_ROUTES } from '@/lib/admin-nav-registry.mjs';
import { ADMIN_FRAME_V2_BODY_CLASS, HIDDEN_IMPORT_COPY } from '@/lib/admin-frame-model.mjs';

const api = { getWith: vi.fn(), post: vi.fn() };

function attention(queues: Record<string, unknown>) {
  return { queues, generated_at: '2026-11-23T10:00:00Z' };
}

function renderFrame() {
  return render(<AdminFrame><p>Nội dung trang</p></AdminFrame>);
}

const sidebar = () => screen.getAllByRole('navigation', { name: 'Điều hướng quản trị' })[0];

beforeEach(() => {
  nav.pathname = '/admin/writing/grade';
  nav.search = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.getWith.mockReset().mockResolvedValue(attention({
    writing_review: { count: 3, oldest_at: null, overdue: false, error: false, unavailable: false },
    regrade_new: { count: null, oldest_at: null, overdue: false, error: true, unavailable: false },
    incident_groups_open: { count: 9, oldest_at: null, overdue: false, error: false, unavailable: false },
  }));
  api.post.mockReset().mockResolvedValue({ ok: true });
  Object.assign(window, { api, __AVER_RUNTIME_CONFIG__: { environment: 'staging' } });
});
afterEach(() => { cleanup(); });

describe('AdminFrame', () => {
  it('opens the group of the current page and marks exactly one entry', () => {
    renderFrame();
    const group = within(sidebar()).getByRole('group', { name: 'Chấm bài' });
    const writing = within(group).getByRole('link', { name: /Writing/ });
    expect(writing.getAttribute('href')).toBe('/admin/writing/queue');
    expect(writing.getAttribute('aria-current')).toBe('page');
    expect(sidebar().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByText('Nội dung trang')).toBeTruthy();
  });

  it('shows queue counts from /admin/attention; a failed queue and a closed item show none', async () => {
    renderFrame();
    const group = within(sidebar()).getByRole('group', { name: 'Chấm bài' });
    await waitFor(() => expect(within(group).getByRole('link', { name: /Writing/ }).textContent).toContain('3'));
    expect(api.getWith).toHaveBeenCalledWith('/admin/attention');
    expect(within(group).getByRole('link', { name: /Yêu cầu chấm lại/ }).textContent).not.toMatch(/\d/);
    // "Speaking" grading has no page yet: dimmed, not a link, no number.
    const speaking = within(group).getByText('Speaking').closest('[aria-disabled="true"]');
    expect(speaking?.getAttribute('title')).toBe('Chưa mở');
    expect(speaking?.textContent).not.toMatch(/\d/);
  });

  it('keeps the frame and no numbers when /admin/attention fails', async () => {
    api.getWith.mockRejectedValue(new Error('503'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderFrame();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    const group = within(sidebar()).getByRole('group', { name: 'Chấm bài' });
    expect(within(group).getByRole('link', { name: /Writing/ }).textContent).not.toMatch(/\d/);
  });

  it('never hides the environment label', async () => {
    renderFrame();
    await waitFor(() => expect(screen.getByText('Staging · dữ liệu thử')).toBeTruthy());
  });

  it('closes the phone drawer with Esc', () => {
    renderFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Mở menu quản trị' }));
    expect(screen.getByRole('dialog', { name: 'Menu quản trị' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu quản trị' })).toBeNull();
  });

  it('offers both other areas in the account menu', () => {
    renderFrame();
    fireEvent.click(screen.getByRole('button', { name: /andy@example.test|Tài khoản/ }));
    expect(screen.getByRole('link', { name: 'Sang khu học viên' }).getAttribute('href')).toBe('/home');
    expect(screen.getByRole('link', { name: 'Sang khu giáo viên' }).getAttribute('href')).toBe('/instructor');
  });

  it('draws no frame for ?embed=1', () => {
    nav.search = 'embed=1';
    renderFrame();
    expect(screen.queryByRole('navigation', { name: 'Điều hướng quản trị' })).toBeNull();
    expect(screen.getByText('Nội dung trang')).toBeTruthy();
    expect(api.getWith).not.toHaveBeenCalled();
  });
});

describe('hidden import banner (FR-013)', () => {
  const concrete = ADMIN_ROUTES.filter((r) => !r.pattern.includes('['));

  it('shows on exactly the four hidden routes', () => {
    const shown: string[] = [];
    for (const route of concrete) {
      nav.pathname = route.pattern;
      const view = renderFrame();
      if (view.container.querySelector('[data-hidden-import]')) shown.push(route.pattern);
      view.unmount();
    }
    expect(shown.sort()).toEqual(['/admin/listening/import-drills', '/admin/listening/import-fulltest',
      '/admin/vocab/content', '/admin/vocab/quiz']);
  });

  it('hides the page until "Vẫn mở", then remembers it for the tab and logs it', async () => {
    nav.pathname = '/admin/vocab/quiz';
    const view = renderFrame();
    expect(screen.getByText(HIDDEN_IMPORT_COPY.title)).toBeTruthy();
    expect(screen.queryByText('Nội dung trang')).toBeNull();
    expect(screen.getByRole('link', { name: HIDDEN_IMPORT_COPY.back }).getAttribute('href')).toBe('/admin/vocab');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: HIDDEN_IMPORT_COPY.open })); });
    expect(screen.getByText('Nội dung trang')).toBeTruthy();
    expect(window.sessionStorage.getItem('av-hidden-import-open:/admin/vocab/quiz')).toBe('1');
    expect(api.post).toHaveBeenCalledWith('/api/analytics/events',
      { event_name: 'admin_hidden_import_opened', event_data: { route: '/admin/vocab/quiz' } });
    view.unmount();
    renderFrame();
    await waitFor(() => expect(screen.getByText('Nội dung trang')).toBeTruthy());
    expect(screen.queryByRole('button', { name: HIDDEN_IMPORT_COPY.open })).toBeNull();
  });
});

describe('<aver-admin-chrome> under the new frame', () => {
  beforeAll(async () => {
    Object.assign(window, {
      getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
    });
    await import('@/public/js/components/aver-admin-chrome.js');
  });

  it('renders only its slot when <body> has the v2 class', async () => {
    const mod = await import('@/public/js/components/aver-admin-chrome.js');
    expect(mod.ADMIN_FRAME_V2_BODY_CLASS).toBe(ADMIN_FRAME_V2_BODY_CLASS);
    document.body.classList.add(ADMIN_FRAME_V2_BODY_CLASS);
    const chrome = document.createElement('aver-admin-chrome');
    chrome.setAttribute('active', 'overview');
    document.body.append(chrome);
    const root = chrome.shadowRoot!;
    expect(root.querySelectorAll('slot')).toHaveLength(1);
    expect(root.querySelector('nav, aside, header')).toBeNull();
    chrome.remove();
    document.body.classList.remove(ADMIN_FRAME_V2_BODY_CLASS);
  });

  it('still draws the old frame without the class', () => {
    const chrome = document.createElement('aver-admin-chrome');
    chrome.setAttribute('active', 'overview');
    document.body.append(chrome);
    expect(chrome.shadowRoot!.querySelector('nav, aside, header')).not.toBeNull();
    chrome.remove();
  });
});
