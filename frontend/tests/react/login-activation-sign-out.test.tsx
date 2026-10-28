import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginBehavior } from '@/app/(public-auth)/login/login-behavior';
import { SIGNED_OUT_SESSION_KEY } from '@/public/js/auth-sign-out-state.js';

// BL-13: a signed-in account that is not activated lands in the activation
// dialog on /login, and the dialog had no way out — a learner who picked the
// wrong Google account could not sign out from there.
const STORE_KEY = 'sb-proj-auth-token';
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
const fetchMock = vi.fn();
const replace = vi.fn();
const signOut = vi.fn();
const getSession = vi.fn();
let session: any;

beforeEach(() => {
  fetchMock.mockReset();
  replace.mockReset();
  signOut.mockReset();
  getSession.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/login');
  session = { access_token: jwt({ session_id: 'sid-inactive' }) };
  localStorage.setItem(STORE_KEY, JSON.stringify(session));
  getSession.mockImplementation(async () => ({ data: { session }, error: null }));
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/public-stats')) return new Response('{}', { status: 200 });
    if (url.endsWith('/auth/me')) {
      return new Response(JSON.stringify({ id: 'user-1', is_active: false, onboarding_completed: false }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
  const realWindow = window;
  const location = {
    get search() { return realWindow.location.search; },
    get hash() { return realWindow.location.hash; },
    get origin() { return realWindow.location.origin; },
    replace,
  };
  vi.stubGlobal('window', new Proxy(realWindow, {
    get: (target, key) => (key === 'location' ? location : Reflect.get(target, key, target)),
  }));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(realWindow, {
    api: { base: 'https://api.test' },
    getSupabase: () => ({ auth: {
      getSession,
      exchangeCodeForSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signOut,
    } }),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const openDialog = async () => {
  render(<LoginBehavior googleIcon={null} />);
  return screen.findByRole('dialog', { name: 'Kích hoạt tài khoản' });
};

it('signs out from the activation dialog: revokes, purges the session and offers Google sign-in again', async () => {
  signOut.mockImplementation(async () => {
    expect(sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)).toBe('sid-inactive'); // remembered BEFORE the revoke (U-07)
    localStorage.removeItem(STORE_KEY);
    session = null;
    return { error: null };
  });
  const dialog = await openDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(dialog.isConnected).toBe(false);
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(STORE_KEY)).toBeNull();
  expect(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

it('still purges the persisted session when the revoke fails', async () => {
  signOut.mockImplementation(async () => ({ error: { message: 'Failed to fetch' } }));
  await openDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(localStorage.getItem(STORE_KEY)).toBeNull();
  expect(sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)).toBe('sid-inactive');
  expect(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeTruthy();
});

it('keeps sign-out unavailable while an activation is in flight', async () => {
  let release: (value: Response) => void = () => {};
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/public-stats')) return new Response('{}', { status: 200 });
    if (url.endsWith('/auth/activate')) return new Promise<Response>((resolve) => { release = resolve; });
    if (url.endsWith('/auth/me')) {
      return new Response(JSON.stringify({ id: 'user-1', is_active: false, onboarding_completed: false }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
  await openDialog();
  fireEvent.change(screen.getByLabelText('Access Code'), { target: { value: 'IELTS-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt' }));
  const signOutButton = await screen.findByRole('button', { name: 'Đăng xuất' });
  await waitFor(() => expect((signOutButton as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(signOutButton);
  expect(signOut).not.toHaveBeenCalled();
  release(new Response(JSON.stringify({ detail: 'Mã không hợp lệ' }), { status: 400 }));
  expect(await screen.findByRole('alert')).toBeTruthy();
});
