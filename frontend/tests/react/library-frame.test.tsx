// LIBRARY-0061 FR-002 / UIBASE-0056 FR-007: /library frames guests with
// PublicShell and a signed-in learner with LearnerShell (G03 follow-up).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/library' }));

// The real auth-api → browser-api adapter runs; only the api.js transport is
// faked, with api.js's 401 rule (redirect to /login unless opts.noRedirect).
type Reply = { status: number; body?: unknown };
let reply: Reply;
const calls: { path: string; opts: any }[] = [];
let redirectedTo: string | null = null;
const getWith = vi.fn(async (path: string, _hdrs?: unknown, opts?: any) => {
  calls.push({ path, opts });
  if (reply.status === 401 && !opts?.noRedirect) { redirectedTo = '/login'; return null; }
  if (reply.status !== 200) throw Object.assign(new Error(`HTTP ${reply.status}`), { status: reply.status });
  return reply.body;
});

import { LibraryFrame, learnerInitials } from '@/app/(public-library)/library-frame';

let session: any = null;
const reportError = vi.fn();

beforeEach(() => {
  session = null;
  reportError.mockReset();
  calls.length = 0;
  redirectedTo = null;
  reply = { status: 200, body: me({}) };
  Object.assign(window, {
    api: { getWith },
    aver: { reportError },
    getSupabase: () => ({ auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }),
  });
});

afterEach(() => {
  cleanup();
  delete (window as any).getSupabase;
  delete (window as any).aver;
  delete (window as any).api;
});

// A full /auth/me body as normalizeAuthMe requires it.
const me = (over: object) => ({
  id: 'A', email: 'bao@example.com', display_name: 'Trần Quốc Bảo', avatar_url: null, role: 'student',
  is_active: true, onboarding_completed: true, target_band: null, exam_date: null, self_level: null,
  preferred_topics: [], permissions: [], vocab_bank_enabled: false, d1_enabled: false, d3_enabled: false,
  flashcard_enabled: false, vocab_curated_enabled: false, ...over,
});

async function mount() {
  render(<LibraryFrame><p>kệ sách</p></LibraryFrame>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('LibraryFrame', () => {
  it('guest: PublicShell with Thư viện marked, and no /auth/me call', async () => {
    await mount();
    const nav = screen.getByRole('navigation', { name: 'Khu công khai' });
    expect(within(nav).getByRole('link', { name: 'Thư viện' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('navigation', { name: 'Mục chính' })).toBeNull();
    expect(screen.getByRole('main').textContent).toBe('kệ sách');
    expect(calls).toEqual([]);
  });

  it('signed-in learner: LearnerShell, Thư viện current, name from /auth/me, no admin switch', async () => {
    session = { user: { id: 'A', email: 'bao@example.com' } };
    await mount();
    expect(calls).toEqual([{ path: '/auth/me', opts: expect.objectContaining({ noRedirect: true }) }]);
    const nav = screen.getByRole('navigation', { name: 'Mục chính' });
    expect(within(nav).getByRole('link', { name: 'Thư viện' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('navigation', { name: 'Khu công khai' })).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main').textContent).toBe('kệ sách');
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Trần Quốc Bảo' }));
    expect(screen.queryByRole('link', { name: 'Đổi vai trò: sang Quản trị' })).toBeNull();
  });

  it('admin: the role switch comes from /auth/me', async () => {
    session = { user: { id: 'A', email: 'bao@example.com' } };
    reply = { status: 200, body: me({ role: 'admin' }) };
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Trần Quốc Bảo' }));
    expect(screen.getByRole('link', { name: 'Đổi vai trò: sang Quản trị' }).getAttribute('href')).toBe('/admin');
  });

  it('/auth/me fails: learner frame with the email, no admin switch, and the failure reported', async () => {
    session = { user: { id: 'A', email: 'bao@example.com' } };
    reply = { status: 500 };
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: bao@example.com' }));
    expect(screen.queryByRole('link', { name: 'Đổi vai trò: sang Quản trị' })).toBeNull();
    expect(reportError).toHaveBeenCalledWith('library frame: /auth/me failed', expect.objectContaining({ type: 'library_frame_profile_failed' }));
  });

  it('expired session (/auth/me 401): stays on /library with the guest shell, nothing reported', async () => {
    session = { user: { id: 'A', email: 'bao@example.com' } };
    reply = { status: 401 };
    await mount();
    expect(redirectedTo).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Khu công khai' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Mục chính' })).toBeNull();
    expect(screen.queryByText(/Đổi vai trò/)).toBeNull();
    expect(screen.getByRole('main').textContent).toBe('kệ sách');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('initials: first and last word, else the email', () => {
    expect(learnerInitials('Vũ Thu Trang', 'x@y')).toBe('VT');
    expect(learnerInitials('bảo', 'x@y')).toBe('B');
    expect(learnerInitials(null, 'quocbao@example.com')).toBe('Q');
  });
});
