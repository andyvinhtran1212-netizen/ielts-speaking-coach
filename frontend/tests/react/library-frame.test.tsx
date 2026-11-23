// LIBRARY-0061 FR-002 / UIBASE-0056 FR-007: /library frames guests with
// PublicShell and a signed-in learner with LearnerShell (G03 follow-up).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/library' }));
const getCurrentUser = vi.fn();
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: (signal?: AbortSignal) => getCurrentUser(signal) }));

import { LibraryFrame, learnerInitials } from '@/app/(public-library)/library-frame';

let session: any = null;
const reportError = vi.fn();

beforeEach(() => {
  session = null;
  getCurrentUser.mockReset();
  reportError.mockReset();
  Object.assign(window, {
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
});

const me = (over: object) => ({ id: 'A', email: 'bao@example.com', display_name: 'Trần Quốc Bảo', role: 'student', ...over });

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
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('signed-in learner: LearnerShell, Thư viện current, name from /auth/me, no admin switch', async () => {
    session = { user: { id: 'A', email: 'bao@example.com' } };
    getCurrentUser.mockResolvedValue(me({}));
    await mount();
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
    getCurrentUser.mockResolvedValue(me({ role: 'admin' }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Trần Quốc Bảo' }));
    expect(screen.getByRole('link', { name: 'Đổi vai trò: sang Quản trị' }).getAttribute('href')).toBe('/admin');
  });

  it('/auth/me fails: learner frame with the email, no admin switch, and the failure reported', async () => {
    session = { user: { id: 'A', email: 'bao@example.com' } };
    getCurrentUser.mockRejectedValue(new Error('HTTP 500'));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: bao@example.com' }));
    expect(screen.queryByRole('link', { name: 'Đổi vai trò: sang Quản trị' })).toBeNull();
    expect(reportError).toHaveBeenCalledWith('library frame: /auth/me failed', expect.objectContaining({ type: 'library_frame_profile_failed' }));
  });

  it('initials: first and last word, else the email', () => {
    expect(learnerInitials('Vũ Thu Trang', 'x@y')).toBe('VT');
    expect(learnerInitials('bảo', 'x@y')).toBe('B');
    expect(learnerInitials(null, 'quocbao@example.com')).toBe('Q');
  });
});
