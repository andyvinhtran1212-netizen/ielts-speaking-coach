import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';

// The <aver-chrome> logout redirects to its canonical '/' itself. Pages own a
// fail-closed `if (status === 'signed-out') location.replace('/login')`
// effect; it runs after the chrome's redirect and overrides it, so the
// provider must not report 'signed-out' while that navigation is pending.
let notify: (event: string, session: any) => void;
let stored: any;
const redirectToLogin = vi.fn();
function Page() {
  const { status, user } = useAuth();
  useEffect(() => { if (status === 'signed-out') redirectToLogin(); }, [status]);
  return <span>{status}:{user?.id || ''}</span>;
}
const chromeEvent = (name: string) =>
  act(() => { document.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })); });
const mountSignedIn = async () => {
  render(<AuthProvider><Page /></AuthProvider>);
  await screen.findByText('signed-in:A');
};

beforeEach(() => {
  redirectToLogin.mockClear();
  stored = { user: { id: 'A', email: null } };
  Object.defineProperty(window, 'getSupabase', { configurable: true, value: () => ({ auth: {
    getSession: async () => ({ data: { session: stored } }),
    onAuthStateChange: (fn: any) => { notify = fn; return { data: { subscription: { unsubscribe() {} } } }; },
  } }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('user-initiated chrome logout drops private state without triggering the page /login redirect', async () => {
  await mountSignedIn();
  vi.useFakeTimers();
  chromeEvent('av-chrome-signing-out');
  act(() => notify('SIGNED_OUT', null)); // supabase-js fires this inside signOut()
  chromeEvent('av-chrome-signed-out');
  expect(screen.getByText('initial-loading:')).toBeTruthy();
  expect(redirectToLogin).not.toHaveBeenCalled();
});

it('falls back to fail-closed signed-out when the chrome navigation never unloads the page', async () => {
  await mountSignedIn();
  vi.useFakeTimers();
  chromeEvent('av-chrome-signing-out');
  chromeEvent('av-chrome-signed-out');
  act(() => { vi.advanceTimersByTime(9_999); });
  expect(redirectToLogin).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(screen.getByText('signed-out:')).toBeTruthy();
  expect(redirectToLogin).toHaveBeenCalledTimes(1);
});

it('session expiry and cross-tab sign-out still fail closed to /login', async () => {
  await mountSignedIn();
  act(() => notify('SIGNED_OUT', null));
  expect(screen.getByText('signed-out:')).toBeTruthy();
  expect(redirectToLogin).toHaveBeenCalledTimes(1);
});

it('a bfcache-restored page after chrome logout fails closed again', async () => {
  await mountSignedIn();
  chromeEvent('av-chrome-signing-out');
  stored = null;
  chromeEvent('av-chrome-signed-out');
  expect(redirectToLogin).not.toHaveBeenCalled();
  act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await screen.findByText('signed-out:');
  // The re-validated session settles outside act(), so the DOM can show
  // 'signed-out' before React flushes the page's passive redirect effect.
  await waitFor(() => expect(redirectToLogin).toHaveBeenCalledTimes(1));
});
