import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LoginBehavior } from '@/app/(public-auth)/login/login-behavior';

// ADMINAAL2-0032 FR-018 (T011): a suspended account sees "Tài khoản đang bị
// tạm khóa — liên hệ admin" and a sign-out button instead of the activation
// dialog — from /auth/me, or from a direct /auth/activate 403 account_suspended —
// and nothing internal (codes, reasons, ids) is shown.
const MESSAGE = 'Tài khoản đang bị tạm khóa — liên hệ admin';
const STORE_KEY = 'sb-proj-auth-token';
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
const fetchMock = vi.fn();
const replace = vi.fn();
const signOut = vi.fn();
let me: () => Response;
let activate: () => Response;

beforeEach(() => {
  fetchMock.mockReset();
  replace.mockReset();
  signOut.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/login');
  const session = { access_token: jwt({ session_id: 'sid-suspended' }) };
  localStorage.setItem(STORE_KEY, JSON.stringify(session));
  me = () => new Response(JSON.stringify({ id: 'inst-1', is_active: false, onboarding_completed: true, suspended: true }), { status: 200 });
  activate = () => new Response('{}', { status: 200 });
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/public-stats')) return new Response('{}', { status: 200 });
    if (url.endsWith('/auth/me')) return me();
    if (url.endsWith('/auth/activate')) return activate();
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
  signOut.mockResolvedValue({ error: null });
  Object.assign(realWindow, {
    api: { base: 'https://api.test' },
    getSupabase: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      exchangeCodeForSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signOut,
    } }),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const activateCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/activate'));

it('shows the suspended message with a sign-out button instead of the activation dialog', async () => {
  render(<LoginBehavior googleIcon={null} />);
  const alert = await screen.findByTestId('login-suspended');
  expect(alert.getAttribute('role')).toBe('alert');
  expect(alert.textContent).toBe(`${MESSAGE}Đăng xuất`);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Đăng nhập bằng Google' })).toBeNull();
  expect(replace).not.toHaveBeenCalled();
  expect(activateCalls()).toHaveLength(0);

  fireEvent.click(within(alert).getByRole('button', { name: 'Đăng xuất' }));
  expect(await screen.findByRole('button', { name: 'Đăng nhập bằng Google' })).toBeTruthy();
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('login-suspended')).toBeNull();
  expect(localStorage.getItem(STORE_KEY)).toBeNull();
});

it('a never-activated account still gets the activation dialog', async () => {
  me = () => new Response(JSON.stringify({ id: 'user-1', is_active: false, onboarding_completed: false, suspended: false }), { status: 200 });
  render(<LoginBehavior googleIcon={null} />);
  expect(await screen.findByRole('dialog', { name: 'Kích hoạt tài khoản' })).toBeTruthy();
  expect(screen.queryByTestId('login-suspended')).toBeNull();
});

it('maps a direct /auth/activate 403 account_suspended to the same message', async () => {
  me = () => new Response(JSON.stringify({ id: 'inst-1', is_active: false, onboarding_completed: true, suspended: false }), { status: 200 });
  render(<LoginBehavior googleIcon={null} />);
  const dialog = await screen.findByRole('dialog', { name: 'Kích hoạt tài khoản' });
  // The suspension lands between the boot read and the activation.
  me = () => new Response(JSON.stringify({ id: 'inst-1', is_active: false, onboarding_completed: true, suspended: true }), { status: 200 });
  activate = () => new Response(JSON.stringify({ detail: { code: 'account_suspended', message: MESSAGE } }), { status: 403 });
  fireEvent.change(within(dialog).getByLabelText('Access Code'), { target: { value: 'ielts-code-01' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Kích hoạt' }));
  const alert = await screen.findByTestId('login-suspended');
  expect(alert.textContent).toContain(MESSAGE);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(activateCalls()).toHaveLength(1);
  expect(JSON.parse(String(activateCalls()[0][1].body))).toEqual({ access_code: 'IELTS-CODE-01' });
  expect(replace).not.toHaveBeenCalled();
});

it('keeps the suspended message when the readback after the 403 fails', async () => {
  me = () => new Response(JSON.stringify({ id: 'inst-1', is_active: false, onboarding_completed: true, suspended: false }), { status: 200 });
  render(<LoginBehavior googleIcon={null} />);
  const dialog = await screen.findByRole('dialog', { name: 'Kích hoạt tài khoản' });
  me = () => new Response(JSON.stringify({ detail: 'boom' }), { status: 500 });
  activate = () => new Response(JSON.stringify({ detail: { code: 'account_suspended', message: MESSAGE } }), { status: 403 });
  fireEvent.change(within(dialog).getByLabelText('Access Code'), { target: { value: 'IELTS-CODE-02' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Kích hoạt' }));
  await waitFor(() => expect(screen.getByTestId('login-suspended').textContent).toContain(MESSAGE));
  expect(screen.queryByText(/boom/)).toBeNull();
});
