import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginBehavior } from '@/app/(public-auth)/login/login-behavior';
import { SIGNED_OUT_SESSION_KEY } from '@/public/js/auth-sign-out-state.js';

// U-07: right after a logout whose revoke failed or was aborted by a
// navigation, supabase-js still had the (server-revoked) session persisted.
// /login booted it, called GET /auth/me, got 401 and showed the raw backend
// detail "Token không hợp lệ hoặc đã hết hạn" to a user who had just logged out.
const STORE_KEY = 'sb-proj-auth-token';
const EXPIRED = 'Token không hợp lệ hoặc đã hết hạn';
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
const fetchMock = vi.fn();
const replace = vi.fn();
const signOut = vi.fn();
const exchangeCodeForSession = vi.fn();
const getSession = vi.fn();
let session: any;

beforeEach(() => {
  fetchMock.mockReset();
  replace.mockReset();
  signOut.mockReset();
  exchangeCodeForSession.mockReset();
  getSession.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/login');
  session = null;
  getSession.mockImplementation(async () => ({ data: { session }, error: null }));
  // supabase-js persists the session that a verified PKCE exchange returns.
  exchangeCodeForSession.mockImplementation(async () => {
    persist('sid-fresh');
    return { data: { session }, error: null };
  });
  signOut.mockImplementation(async () => {
    localStorage.removeItem(STORE_KEY); // an already-revoked session is signed out locally
    return { error: null };
  });
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/public-stats')) return new Response('{}', { status: 200 });
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ detail: EXPIRED }), { status: 401 });
    throw new Error(`unexpected ${url}`);
  });
  const realWindow = window;
  // jsdom's Location.replace is non-configurable: delegate the reads login
  // needs and capture only the navigation.
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
      exchangeCodeForSession,
      signInWithOAuth: async () => ({ error: null }),
      signOut,
    } }),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const persist = (sessionId: string) => {
  session = { access_token: jwt({ session_id: sessionId }) };
  localStorage.setItem(STORE_KEY, JSON.stringify(session));
};
const meCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'));
const renderLogin = () => render(<LoginBehavior googleIcon={null} />);

it('does not send a session this tab just signed out to /auth/me, purges it and offers sign-in', async () => {
  persist('sid-1');
  localStorage.setItem(`${STORE_KEY}-code-verifier`, 'v');
  sessionStorage.setItem(SIGNED_OUT_SESSION_KEY, 'sid-1');
  renderLogin();
  await screen.findByRole('button', { name: 'Đăng nhập bằng Google' });
  expect(meCalls()).toHaveLength(0);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(EXPIRED)).toBeNull();
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(STORE_KEY)).toBeNull();
  expect(localStorage.getItem(`${STORE_KEY}-code-verifier`)).toBeNull();
  expect(sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)).toBeNull();
});

it('purges the signed-out session locally even when the retried revoke fails', async () => {
  persist('sid-1');
  sessionStorage.setItem(SIGNED_OUT_SESSION_KEY, 'sid-1');
  signOut.mockImplementation(async () => ({ error: { message: 'Failed to fetch' } }));
  renderLogin();
  await screen.findByRole('button', { name: 'Đăng nhập bằng Google' });
  expect(meCalls()).toHaveLength(0);
  expect(localStorage.getItem(STORE_KEY)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('no session means no /auth/me', async () => {
  renderLogin();
  await screen.findByRole('button', { name: 'Đăng nhập bằng Google' });
  expect(meCalls()).toHaveLength(0);
});

it('a different session (signed in again elsewhere) still routes from canonical /auth/me', async () => {
  persist('sid-2');
  sessionStorage.setItem(SIGNED_OUT_SESSION_KEY, 'sid-1');
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({
    id: 'A', is_active: true, onboarding_completed: true,
  }), { status: 200 }));
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  expect(meCalls()).toHaveLength(1);
  expect(signOut).not.toHaveBeenCalled();
});

it('an OAuth callback is a fresh sign-in: it reaches /auth/me and clears the logout record', async () => {
  persist('sid-1');
  sessionStorage.setItem(SIGNED_OUT_SESSION_KEY, 'sid-1');
  window.history.replaceState(null, '', '/login?code=abc');
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({
    id: 'A', is_active: true, onboarding_completed: false,
  }), { status: 200 }));
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding'));
  expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
  expect(getSession).not.toHaveBeenCalled();
  expect(meCalls()).toHaveLength(1);
  expect(meCalls()[0][1].headers.Authorization).toBe(`Bearer ${session.access_token}`);
  expect(sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)).toBeNull();
  expect(window.location.search).toBe('');
});

// F06: the client is PKCE-only, so implicit-flow fragments are stale or forged.
it('an implicit #access_token callback is scrubbed and rejected, never exchanged or sent to /auth/me', async () => {
  persist('sid-1');
  window.history.replaceState(null, '', '/login#access_token=forged&refresh_token=r&expires_in=3600&token_type=bearer');
  renderLogin();
  expect((await screen.findByRole('alert')).textContent).toBe('Đăng nhập thất bại. Vui lòng thử lại.');
  expect(window.location.hash).toBe('');
  expect(document.location.href).not.toContain('access_token');
  expect(exchangeCodeForSession).not.toHaveBeenCalled();
  expect(meCalls()).toHaveLength(0);
});

it('a failed PKCE exchange shows the error and does not fall back to a stored session', async () => {
  persist('sid-1');
  exchangeCodeForSession.mockImplementation(async () => ({
    data: { session: null }, error: { message: 'PKCE code verifier not found in storage' },
  }));
  window.history.replaceState(null, '', '/login?code=reused');
  renderLogin();
  expect((await screen.findByRole('alert')).textContent).toBe('Đăng nhập thất bại. Vui lòng thử lại.');
  expect(window.location.search).toBe('');
  expect(getSession).not.toHaveBeenCalled();
  expect(meCalls()).toHaveLength(0);
});

it('a genuinely expired session (no logout in this tab) keeps the existing visible error', async () => {
  persist('sid-1');
  renderLogin();
  expect((await screen.findByRole('alert')).textContent).toBe(EXPIRED);
  expect(meCalls()).toHaveLength(1);
});

it('storage denied by privacy settings: /login neither crashes nor loses its canonical routing', async () => {
  // The window.sessionStorage getter itself throws SecurityError; the sign-out
  // record is unreadable, so /login falls back to canonical /auth/me routing.
  const denied = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  const proxied = window as any;
  vi.stubGlobal('window', new Proxy(proxied, {
    get: (target, key) => (key === 'localStorage' || key === 'sessionStorage'
      ? denied() : Reflect.get(target, key, target)),
  }));
  persist('sid-1');
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({
    id: 'A', is_active: true, onboarding_completed: true,
  }), { status: 200 }));
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  cleanup();
  replace.mockReset();
  window.history.replaceState(null, '', '/login?code=abc'); // the callback path forgets the record
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  expect(screen.queryByRole('alert')).toBeNull();
});
