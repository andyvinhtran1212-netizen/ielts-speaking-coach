import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GrammarCheckup } from '@/app/(authed)/grammar-checkup/grammar-checkup';

// BL-08: the Supabase session is shared by every tab. Signing in as another
// account in a second tab left /grammar-checkup showing — and acting on — the
// first account's session, because the page booted once per mount.
const route = vi.hoisted(() => ({ search: '' }));
const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(route.search),
}));
const auth = vi.hoisted(() => ({
  status: 'signed-in' as 'initial-loading' | 'signed-in' | 'signed-out',
  user: { id: 'learner-a', email: null } as { id: string; email: string | null } | null,
}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));

const SESSION_A = { id: 'session-a', status: 'in_progress', test_length: 'QUICK' };
const itemFor = (prompt: string) => ({
  complete: false,
  item: { item_id: `${prompt}-item`, ordinal: 1, total: 28, phase: 'BASELINE', prompt, options: ['one', 'two'] },
});

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  route.search = 'session=session-a';
  auth.status = 'signed-in';
  auth.user = { id: 'learner-a', email: null };
  replace.mockReset();
  get = vi.fn(async (path: string) => {
    if (path === '/api/grammar/diagnostics/sessions/session-a') return SESSION_A;
    if (path === '/api/grammar/diagnostics/availability') return { assigned_only: false };
    throw new Error(`unexpected GET ${path}`);
  });
  post = vi.fn(async (path: string) => {
    if (path === '/api/grammar/diagnostics/sessions/session-a/next') return itemFor('Prompt owned by A');
    throw new Error(`unexpected POST ${path}`);
  });
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: { get, post } });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'api'); });

const switchTo = (id: string) => { auth.user = { id, email: null }; };

it('restarts for the new account and drops the previous account session from the URL', async () => {
  const view = render(<GrammarCheckup />);
  expect(await screen.findByText('Prompt owned by A')).toBeTruthy();

  switchTo('learner-b');
  view.rerender(<GrammarCheckup />);
  // Never one frame of A's question under B.
  expect(screen.queryByText('Prompt owned by A')).toBeNull();
  expect(await screen.findByRole('heading', { name: 'Chọn độ sâu phù hợp' })).toBeTruthy();
  expect(replace).toHaveBeenCalledWith('/grammar-checkup');
  expect(get).toHaveBeenLastCalledWith('/api/grammar/diagnostics/availability');
  // A's session is not reopened with B's token.
  expect(get.mock.calls.filter(([path]) => path === '/api/grammar/diagnostics/sessions/session-a')).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('drops a reply that was still in flight for the previous account', async () => {
  let releaseA: (value: unknown) => void = () => {};
  post.mockImplementation((path: string) => {
    if (path === '/api/grammar/diagnostics/sessions/session-a/next') return new Promise((resolve) => { releaseA = resolve; });
    throw new Error(`unexpected POST ${path}`);
  });
  const view = render(<GrammarCheckup />);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

  switchTo('learner-b');
  view.rerender(<GrammarCheckup />);
  expect(await screen.findByRole('heading', { name: 'Chọn độ sâu phù hợp' })).toBeTruthy();

  await act(async () => { releaseA(itemFor('Prompt owned by A')); await Promise.resolve(); });
  expect(screen.queryByText('Prompt owned by A')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Chọn độ sâu phù hợp' })).toBeTruthy();
});

it('a token refresh for the same account does not restart the page', async () => {
  const view = render(<GrammarCheckup />);
  expect(await screen.findByText('Prompt owned by A')).toBeTruthy();
  auth.user = { id: 'learner-a', email: null }; // new object, same account
  view.rerender(<GrammarCheckup />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('Prompt owned by A')).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
});
