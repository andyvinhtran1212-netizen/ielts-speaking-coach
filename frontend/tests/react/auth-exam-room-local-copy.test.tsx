// EXAMROOM-0066 FR-035 (Scenario 6a), R162: the AuthProvider drops exam-room
// local copies on an explicit sign-out (that account's) and when another
// account signs in (every other owner's, from the key alone). An expired or
// refreshed-away session clears nothing, because FR-015 restores that copy
// after the same account signs in again.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';
import { localCopyKey, writeLocalCopy } from '@/lib/exam-room/local-copy.mjs';

let notify: (event: string, session: unknown) => void;
const session = (id: string) => ({ user: { id, email: null } });
const signOutRevoke = vi.fn(async () => ({ error: null }));

let signOut: () => Promise<void> = async () => {};
function View() {
  const auth = useAuth();
  signOut = auth.signOut;
  return <span>{auth.status}:{auth.user?.id || ''}</span>;
}
const mount = () => render(<AuthProvider><View /></AuthProvider>);

const scope = (ownerKey: string, attemptKey = 'att-1') => ({ surface: 'reading', ownerKey, attemptKey });
function leaveCopy(ownerKey: string, attemptKey = 'att-1') {
  const ok = writeLocalCopy(window.localStorage, {
    ...scope(ownerKey, attemptKey),
    answers: { 7: { value: 'dozen pie', baseValue: '', baseSavedAt: null } },
    expiresAt: Date.now() + 60_000,
  });
  expect(ok).toBe(true);
  return localCopyKey(scope(ownerKey, attemptKey));
}
const has = (key: string) => window.localStorage.getItem(key) !== null;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  signOutRevoke.mockClear();
  Object.defineProperty(window, 'getSupabase', {
    configurable: true,
    value: () => ({
      auth: {
        getSession: vi.fn(async () => ({ data: { session: session('A') } })),
        signOut: signOutRevoke,
        onAuthStateChange: (fn: typeof notify) => {
          notify = fn;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it('an expired session keeps the copy; the same account signing in again still has it (FR-015)', async () => {
  mount();
  await screen.findByText('signed-in:A');
  const key = leaveCopy('A');
  act(() => notify('SIGNED_OUT', null)); // refresh failed / token expired
  await screen.findByText('signed-out:');
  expect(has(key)).toBe(true);
  act(() => notify('SIGNED_IN', session('A')));
  await screen.findByText('signed-in:A');
  expect(has(key)).toBe(true);
});

it('signing out from the chrome or the shell drops that account\'s copies, nothing else', async () => {
  mount();
  await screen.findByText('signed-in:A');
  const first = leaveCopy('A', 'att-1');
  const second = leaveCopy('A', 'att-2');
  window.localStorage.setItem('unrelated', 'keep');
  act(() => { document.dispatchEvent(new CustomEvent('av-chrome-signed-out', { bubbles: true })); });
  expect(has(first)).toBe(false);
  expect(has(second)).toBe(false);
  expect(window.localStorage.getItem('unrelated')).toBe('keep');
});

it('useAuth().signOut() drops that account\'s copies', async () => {
  mount();
  await screen.findByText('signed-in:A');
  const key = leaveCopy('A');
  await act(async () => { await signOut(); });
  expect(signOutRevoke).toHaveBeenCalled();
  expect(has(key)).toBe(false);
});

it('an expired session followed by an explicit sign-out still drops the copy', async () => {
  mount();
  await screen.findByText('signed-in:A');
  const key = leaveCopy('A');
  act(() => notify('SIGNED_OUT', null));
  expect(has(key)).toBe(true);
  act(() => { document.dispatchEvent(new CustomEvent('av-chrome-signed-out', { bubbles: true })); });
  expect(has(key)).toBe(false);
});

it('Scenario 6a: account B signing in removes A\'s copy without reading it and keeps B\'s', async () => {
  const keyA = leaveCopy('A');
  const keyB = leaveCopy('B');
  mount();
  await screen.findByText('signed-in:A');
  expect(has(keyA)).toBe(true);
  expect(has(keyB)).toBe(false); // A signed in: B's copy went the same way
  const keyB2 = leaveCopy('B', 'att-2');
  const reads = vi.spyOn(Storage.prototype, 'getItem');
  act(() => notify('SIGNED_IN', session('B')));
  await screen.findByText('signed-in:B');
  const readA = reads.mock.calls.some(([k]) => k === keyA);
  reads.mockRestore();
  expect(readA).toBe(false);
  expect(has(keyA)).toBe(false);
  expect(has(keyB2)).toBe(true);
});
