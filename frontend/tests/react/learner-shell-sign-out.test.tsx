import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { SIGNED_OUT_SESSION_KEY } from '@/public/js/auth-sign-out-state.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/home' }));

import { LearnerShell } from '@/components/ui/shell/learner-shell';

// UIBASE-0056 G03-T14: the LearnerShell's "Đăng xuất" runs the same flow, in
// the same order, as the legacy chrome (chrome-logout-session-purge.test.tsx):
// announce signing-out, record the session, revoke, purge storage and the API
// token cache even when the revoke fails, announce signed-out, then go to '/'.
const STORE_KEY = 'sb-proj-auth-token';
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
const order: string[] = [];
let href = '';
let signOutResult: any;

beforeEach(() => {
  order.length = 0;
  href = '';
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(STORE_KEY, JSON.stringify({ access_token: jwt({ session_id: 'sid-1' }) }));
  localStorage.setItem(`${STORE_KEY}-code-verifier`, 'v');
  localStorage.setItem('av-theme', 'dark');
  signOutResult = { error: { message: 'Failed to fetch' } };
  const realWindow = window;
  const navigation = { set href(value: string) { order.push(`navigate:${value}`); href = value; } };
  vi.stubGlobal('window', new Proxy(realWindow, {
    get: (target, key) => (key === 'location' ? navigation : Reflect.get(target, key, target)),
  }));
  Object.assign(realWindow, {
    api: { base: 'https://api.test', clearAuthCache: vi.fn(() => { order.push('clear-api-cache'); }) },
    aver: { reportError: vi.fn(() => { order.push('report'); }) },
    getSupabase: () => ({ auth: {
      getSession: async () => {
        const raw = localStorage.getItem(STORE_KEY);
        return { data: { session: raw ? { ...JSON.parse(raw), user: { id: 'A' } } : null } };
      },
      signOut: async () => {
        order.push(`revoke:marker=${sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)}`);
        return signOutResult;
      },
    } }),
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  document.addEventListener('av-chrome-signing-out', onSigningOut);
  document.addEventListener('av-chrome-signed-out', onSignedOut);
});

afterEach(() => {
  document.removeEventListener('av-chrome-signing-out', onSigningOut);
  document.removeEventListener('av-chrome-signed-out', onSignedOut);
  cleanup();
  vi.unstubAllGlobals();
  delete (window as any).getSupabase;
  delete (window as any).aver;
  delete (window as any).api;
});

function onSigningOut() { order.push('signing-out'); }
function onSignedOut() {
  order.push(`signed-out:session=${localStorage.getItem(STORE_KEY) ? 'kept' : 'purged'}`
    + `,verifier=${localStorage.getItem(`${STORE_KEY}-code-verifier`) ? 'kept' : 'purged'}`);
}

async function clickSignOut() {
  render(
    <LearnerShell user={{ name: 'Bảo', email: 'b@example.com', initials: 'B' }} canSwitchToAdmin={false}>
      <p />
    </LearnerShell>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Bảo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  await vi.waitFor(() => expect(href).toBe('/'));
}

it('a failed revoke is reported and still purges the session and token cache before sign-out is announced', async () => {
  await clickSignOut();
  expect(order).toEqual([
    'signing-out',
    'revoke:marker=sid-1',
    'report',
    'clear-api-cache',
    'signed-out:session=purged,verifier=purged',
    'navigate:/',
  ]);
  expect(localStorage.getItem('av-theme')).toBe('dark');
});

it('a successful revoke settles before the announcement and the navigation', async () => {
  signOutResult = { error: null };
  await clickSignOut();
  expect(order).toEqual([
    'signing-out',
    'revoke:marker=sid-1',
    'clear-api-cache',
    'signed-out:session=purged,verifier=purged',
    'navigate:/',
  ]);
  expect(sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)).toBe('sid-1');
});

it('runtime not loaded yet: waits for it, then still revokes', async () => {
  const getSupabase = (window as any).getSupabase;
  delete (window as any).getSupabase;
  setTimeout(() => {
    (window as any).getSupabase = getSupabase;
    window.dispatchEvent(new Event('aver:supabase-runtime-ready'));
  }, 20);
  signOutResult = { error: null };
  await clickSignOut();
  expect(order[1]).toBe('revoke:marker=sid-1');
  expect(order.at(-1)).toBe('navigate:/');
});
