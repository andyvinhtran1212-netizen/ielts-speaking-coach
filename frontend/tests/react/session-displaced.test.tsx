// ENROLL-0060 G05-T20 (FR-052): a device whose session another device took
// keeps its drafts, signs out locally and lands on screen 8c of /login.
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';
import { registerDraftSaver, resetDraftSavers } from '@/lib/auth/draft-savers.mjs';
import { rememberDisplaced, SESSION_DISPLACED_EVENT } from '@/lib/auth/session-claim.mjs';
import { LoginBehavior } from '@/app/(public-auth)/login/login-behavior';

const order: string[] = [];
const replace = vi.fn((path: string) => { order.push(`replace:${path}`); });
const signOut = vi.fn(async (opts?: unknown) => { order.push(`signOut:${JSON.stringify(opts)}`); return { error: null }; });
const getSession = vi.fn();

function View() { const a = useAuth(); return <span>{a.status}:{a.user?.id || ''}</span>; }

function stubLocation() {
  const realWindow = window;
  const location = {
    get search() { return realWindow.location.search; },
    get hash() { return realWindow.location.hash; },
    get origin() { return realWindow.location.origin; },
    get pathname() { return realWindow.location.pathname; },
    replace,
  };
  vi.stubGlobal('window', new Proxy(realWindow, {
    get: (target, key) => (key === 'location' ? location : Reflect.get(target, key, target)),
  }));
}

beforeEach(() => {
  order.length = 0;
  replace.mockClear();
  signOut.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  resetDraftSavers();
  getSession.mockImplementation(async () => ({ data: { session: { user: { id: 'A', email: 'minhanh@example.com' } } } }));
  Object.defineProperty(window, 'getSupabase', {
    configurable: true,
    value: () => ({ auth: { getSession, signOut, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } }),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetDraftSavers(); sessionStorage.clear(); });

describe('AuthProvider on session_displaced', () => {
  it('claims the event; drafts are saved before the local sign-out and before navigating to 8c', async () => {
    stubLocation();
    registerDraftSaver(async () => { order.push('draft'); });
    render(<AuthProvider><View /></AuthProvider>);
    await screen.findByText('signed-in:A');
    let notPrevented = true;
    await act(async () => {
      notPrevented = window.dispatchEvent(new CustomEvent(SESSION_DISPLACED_EVENT, {
        cancelable: true, detail: { displacedAt: '2026-11-23T02:05:00Z' },
      }));
      for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
    });
    expect(notPrevented).toBe(false);
    expect(order).toEqual(['draft', 'signOut:{"scope":"local"}', 'replace:/login?notice=displaced']);
    expect(JSON.parse(sessionStorage.getItem('aver:session-displaced:v1')!)).toEqual({
      email: 'minhanh@example.com', at: '2026-11-23T02:05:00Z', draftsSaved: true,
    });
  });

  it('a second refusal does not run the sign-out twice', async () => {
    stubLocation();
    render(<AuthProvider><View /></AuthProvider>);
    await screen.findByText('signed-in:A');
    await act(async () => {
      window.dispatchEvent(new CustomEvent(SESSION_DISPLACED_EVENT, { cancelable: true }));
      window.dispatchEvent(new CustomEvent(SESSION_DISPLACED_EVENT, { cancelable: true }));
      for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('/login screen 8c', () => {
  function loginWindow() {
    stubLocation();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    getSession.mockImplementation(async () => ({ data: { session: null }, error: null }));
    Object.assign(window, { api: { base: 'https://api.test' } });
  }

  it('?notice=displaced shows who, when and that drafts were kept, once (Strict Mode)', async () => {
    loginWindow();
    rememberDisplaced({ email: 'minhanh@example.com', at: '2026-11-23T02:05:00Z', draftsSaved: true });
    window.history.replaceState(null, '', '/login?notice=displaced');
    render(<StrictMode><LoginBehavior googleIcon={null} /></StrictMode>);
    const block = await screen.findByTestId('login-displaced');
    expect(block.textContent).toContain('Bạn đã được đăng xuất trên thiết bị này');
    expect(block.textContent).toContain('Tài khoản minhanh@example.com vừa được chọn “Tiếp tục ở đây” trên thiết bị khác lúc 09:05, 23/11/2026.');
    expect(block.textContent).toContain('Bài bạn đang viết dở đã được lưu nháp.');
    expect(sessionStorage.getItem('aver:session-displaced:v1')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Đăng nhập bằng Google' })).toBeTruthy();
  });

  it('no saved draft → no draft sentence; nothing remembered → still the notice, without details', async () => {
    loginWindow();
    window.history.replaceState(null, '', '/login?notice=displaced');
    render(<LoginBehavior googleIcon={null} />);
    const block = await screen.findByTestId('login-displaced');
    expect(block.textContent).toContain('Tài khoản của bạn vừa được chọn “Tiếp tục ở đây” trên thiết bị khác.');
    expect(block.textContent).not.toContain('lưu nháp');
  });

  it('any other notice value, or none, shows nothing', async () => {
    loginWindow();
    window.history.replaceState(null, '', '/login?notice=hacked');
    render(<LoginBehavior googleIcon={null} />);
    await screen.findByRole('button', { name: 'Đăng nhập bằng Google' });
    expect(screen.queryByTestId('login-displaced')).toBeNull();
  });
});
