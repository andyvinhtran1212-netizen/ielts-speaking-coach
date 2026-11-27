// LEARNERCORE-0063 FR-090: LearnerShell with the real profile for v2 learner pages.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/help' }));

let reply: { status: number; body?: unknown };
const calls: string[] = [];
const getWith = vi.fn(async (path: string) => {
  calls.push(path);
  if (reply.status !== 200) throw Object.assign(new Error(`HTTP ${reply.status}`), { status: reply.status });
  return reply.body;
});

import { LearnerFrame, useLearnerMe } from '@/components/learner/learner-frame';
import { AuthProvider } from '@/lib/auth/auth-provider';

const reportError = vi.fn();
const me = (over: object) => ({
  id: 'A', email: 'bao@example.com', display_name: 'Trần Quốc Bảo', avatar_url: null, role: 'student',
  is_active: true, onboarding_completed: true, target_band: null, exam_date: null, self_level: null,
  preferred_topics: [], permissions: [], vocab_bank_enabled: false, d1_enabled: false, d3_enabled: false,
  flashcard_enabled: false, vocab_curated_enabled: false, ...over,
});

function Probe() {
  const { status, me: profile } = useLearnerMe();
  return <p>{status}:{profile?.display_name ?? '-'}</p>;
}

async function mount() {
  render(<AuthProvider><LearnerFrame><Probe /></LearnerFrame></AuthProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  calls.length = 0;
  reportError.mockReset();
  reply = { status: 200, body: me({}) };
  Object.assign(window, {
    api: { getWith },
    aver: { reportError },
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

describe('LearnerFrame', () => {
  it('reads /auth/me once, names the learner and hands the profile to the page', async () => {
    await mount();
    expect(calls).toEqual(['/auth/me']);
    expect(screen.getByText('ready:Trần Quốc Bảo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Trần Quốc Bảo' }));
    expect(screen.queryByRole('link', { name: 'Đổi vai trò: sang Quản trị' })).toBeNull();
  });

  it('admin switch only from the server role', async () => {
    reply = { status: 200, body: me({ role: 'admin' }) };
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Trần Quốc Bảo' }));
    expect(screen.getByRole('link', { name: 'Đổi vai trò: sang Quản trị' })).toBeTruthy();
  });

  it('/auth/me fails: frame kept with the email, no admin switch, failure reported', async () => {
    reply = { status: 500 };
    await mount();
    expect(screen.getByText('error:-')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: bao@example.com' }));
    expect(screen.queryByRole('link', { name: 'Đổi vai trò: sang Quản trị' })).toBeNull();
    expect(reportError).toHaveBeenCalledWith('learner frame: /auth/me failed', expect.objectContaining({ type: 'learner_frame_profile_failed' }));
  });
});
