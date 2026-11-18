import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginBehavior } from '@/app/(public-auth)/login/login-behavior';

// G02-T15 (FR-02-013): a signed-out visitor sent to /login comes back to the
// page they meant to open, including across the Google OAuth round trip;
// foreign or looping destinations fall back to /home, and activation and
// onboarding still come first.
const NEXT_KEY = 'av-login-next';
const fetchMock = vi.fn();
const replace = vi.fn();
const getSession = vi.fn();
const exchangeCodeForSession = vi.fn();
let profile: { is_active: boolean; onboarding_completed: boolean };
let referrer = '';

beforeEach(() => {
  fetchMock.mockReset();
  replace.mockReset();
  getSession.mockReset();
  exchangeCodeForSession.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/login');
  referrer = '';
  profile = { is_active: true, onboarding_completed: true };
  Object.defineProperty(document, 'referrer', { configurable: true, get: () => referrer });
  getSession.mockImplementation(async () => ({ data: { session: { access_token: 'h.e30.s' } }, error: null }));
  exchangeCodeForSession.mockImplementation(async () => ({ data: { session: { access_token: 'h.e30.s' } }, error: null }));
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/public-stats')) return new Response('{}', { status: 200 });
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ id: 'A', ...profile }), { status: 200 });
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
      exchangeCodeForSession,
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    } }),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (document as any).referrer;
});

const origin = () => window.location.origin;
const renderLogin = () => render(<LoginBehavior googleIcon={null} />);

it('returns a signed-in learner to the same-origin page that sent them to /login', async () => {
  referrer = `${origin()}/writing/dashboard?tab=history`;
  renderLogin();
  expect(await screen.findByText('Đăng nhập để tiếp tục tới trang bạn vừa mở.')).toBeTruthy();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/writing/dashboard?tab=history'));
  expect(sessionStorage.getItem(NEXT_KEY)).toBeNull();
});

it('an explicit ?next= wins over the referrer', async () => {
  referrer = `${origin()}/grammar`;
  window.history.replaceState(null, '', '/login?next=%2Freading%2Fvocab');
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/reading/vocab'));
});

it('keeps the destination across the Google OAuth return, which has no referrer', async () => {
  sessionStorage.setItem(NEXT_KEY, '/writing/result?id=1');
  window.history.replaceState(null, '', '/login?code=abc');
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/writing/result?id=1'));
  expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
  expect(sessionStorage.getItem(NEXT_KEY)).toBeNull();
});

it.each([
  ['a foreign referrer', () => { referrer = 'https://evil.example/writing/dashboard'; }],
  ['a protocol-relative ?next=', () => { window.history.replaceState(null, '', '/login?next=%2F%2Fevil.example'); }],
  ['a ?next= pointing back at /login', () => { window.history.replaceState(null, '', '/login?next=%2Flogin'); }],
  ['the public landing as referrer', () => { referrer = `${origin()}/`; }],
])('falls back to /home for %s', async (_label, arrange) => {
  arrange();
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  expect(screen.queryByText('Đăng nhập để tiếp tục tới trang bạn vừa mở.')).toBeNull();
});

it('onboarding still comes before the remembered page', async () => {
  profile = { is_active: true, onboarding_completed: false };
  referrer = `${origin()}/writing/dashboard`;
  renderLogin();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding'));
});

it('an inactive account still sees activation instead of being redirected', async () => {
  profile = { is_active: false, onboarding_completed: false };
  referrer = `${origin()}/writing/dashboard`;
  renderLogin();
  await screen.findByRole('dialog');
  expect(replace).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(NEXT_KEY)).toBe('/writing/dashboard');
});
