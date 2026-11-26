// LEARNERNAV-0062 FR-003 (G07-T03s): the account menu's role switches come
// only from the server profile (/auth/me). Admin sees "sang Quản trị" then
// "sang Giáo viên"; an instructor sees only "sang Giáo viên"; a student sees
// none; an unconfirmed role (/auth/me failed) or an expired session sees none.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/library' }));

type Reply = { status: number; body?: unknown };
let reply: Reply;
const getWith = vi.fn(async (_path: string, _hdrs?: unknown, opts?: any) => {
  if (reply.status === 401 && !opts?.noRedirect) return null;
  if (reply.status !== 200) throw Object.assign(new Error(`HTTP ${reply.status}`), { status: reply.status });
  return reply.body;
});

import { LibraryFrame } from '@/app/(public-library)/library-frame';

const me = (over: object) => ({
  id: 'A', email: 'bao@example.com', display_name: 'Trần Quốc Bảo', avatar_url: null, role: 'student',
  is_active: true, onboarding_completed: true, target_band: null, exam_date: null, self_level: null,
  preferred_topics: [], permissions: [], vocab_bank_enabled: false, d1_enabled: false, d3_enabled: false,
  flashcard_enabled: false, vocab_curated_enabled: false, ...over,
});

beforeEach(() => {
  reply = { status: 200, body: me({}) };
  Object.assign(window, {
    api: { getWith },
    aver: { reportError: vi.fn() },
    getSupabase: () => ({ auth: {
      getSession: async () => ({ data: { session: { user: { id: 'A', email: 'bao@example.com' } } } }),
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

async function openMenu(accountName: string) {
  render(<LibraryFrame><p>kệ sách</p></LibraryFrame>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  fireEvent.click(screen.getByRole('button', { name: `Tài khoản: ${accountName}` }));
}

const switches = () => screen.queryAllByRole('link', { name: /^Đổi vai trò/ })
  .map((a) => [a.textContent, a.getAttribute('href')]);

describe('account menu role switches', () => {
  it('admin: sang Quản trị, then sang Giáo viên', async () => {
    reply = { status: 200, body: me({ role: 'admin' }) };
    await openMenu('Trần Quốc Bảo');
    expect(switches()).toEqual([
      ['Đổi vai trò: sang Quản trị', '/admin'],
      ['Đổi vai trò: sang Giáo viên', '/instructor'],
    ]);
  });

  it('instructor: only sang Giáo viên', async () => {
    reply = { status: 200, body: me({ role: 'instructor' }) };
    await openMenu('Trần Quốc Bảo');
    expect(switches()).toEqual([['Đổi vai trò: sang Giáo viên', '/instructor']]);
  });

  it('student: no switch', async () => {
    await openMenu('Trần Quốc Bảo');
    expect(screen.getByRole('link', { name: 'Hồ sơ' })).toBeTruthy();
    expect(switches()).toEqual([]);
  });

  it('role not confirmed (/auth/me fails): no switch', async () => {
    reply = { status: 503 };
    await openMenu('bao@example.com');
    expect(switches()).toEqual([]);
  });

  it('expired session (/auth/me 401): guest frame, no account menu, no switch', async () => {
    reply = { status: 401 };
    render(<LibraryFrame><p>kệ sách</p></LibraryFrame>);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByRole('button', { name: /^Tài khoản/ })).toBeNull();
    expect(screen.queryByText(/Đổi vai trò/)).toBeNull();
  });
});
