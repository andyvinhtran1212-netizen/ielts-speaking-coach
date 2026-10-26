import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SIGNED_OUT_SESSION_KEY } from '@/public/js/auth-sign-out-state.js';

// U-07: supabase-js v2 signOut() clears its persisted session only after the
// revoke succeeds. On a failed or aborted revoke the session stays in
// localStorage (possibly already revoked server-side), and /login then sent it
// to /auth/me and showed "Token không hợp lệ hoặc đã hết hạn". The chrome
// logout must purge it — and record which session it ended — before it
// announces sign-out and navigates.
const STORE_KEY = 'sb-proj-auth-token';
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
const order: string[] = [];
let href = '';
let clearAuthCache: ReturnType<typeof vi.fn>;
let signOutResult: any;

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  await import('@/public/js/components/aver-chrome.js');
});

beforeEach(() => {
  order.length = 0;
  href = '';
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(STORE_KEY, JSON.stringify({ access_token: jwt({ session_id: 'sid-1' }) }));
  localStorage.setItem(`${STORE_KEY}-code-verifier`, 'v');
  localStorage.setItem('av-theme', 'dark');
  clearAuthCache = vi.fn(() => { order.push('clear-api-cache'); });
  signOutResult = { error: { message: 'Failed to fetch' } };
  const realWindow = window;
  const navigation = { set href(value: string) { order.push(`navigate:${value}`); href = value; } };
  vi.stubGlobal('window', new Proxy(realWindow, {
    get: (target, key) => (key === 'location' ? navigation : Reflect.get(target, key, target)),
  }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  Object.assign(realWindow, {
    api: { base: 'https://api.test', clearAuthCache },
    getSupabase: () => ({ auth: {
      getSession: async () => {
        const raw = localStorage.getItem(STORE_KEY);
        return { data: { session: raw ? { ...JSON.parse(raw), user: { id: 'A' } } : null } };
      },
      // A failed revoke resolves { error } and leaves storage untouched.
      signOut: async () => {
        order.push(`revoke:marker=${sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)}`);
        return signOutResult;
      },
    } }),
  });
  document.addEventListener('av-chrome-signing-out', onSigningOut);
  document.addEventListener('av-chrome-signed-out', onSignedOut);
});

afterEach(() => {
  document.removeEventListener('av-chrome-signing-out', onSigningOut);
  document.removeEventListener('av-chrome-signed-out', onSignedOut);
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function onSigningOut() { order.push('signing-out'); }
function onSignedOut() {
  order.push(`signed-out:session=${localStorage.getItem(STORE_KEY) ? 'kept' : 'purged'}`
    + `,verifier=${localStorage.getItem(`${STORE_KEY}-code-verifier`) ? 'kept' : 'purged'}`);
}

async function clickLogout() {
  const chrome = document.createElement('aver-chrome');
  document.body.appendChild(chrome);
  chrome.shadowRoot!.getElementById('user-menu-logout')!.click();
  await vi.waitFor(() => expect(href).toBe('/'));
}

it('a failed revoke still purges the persisted session and token cache before sign-out is announced', async () => {
  await clickLogout();
  expect(order).toEqual([
    'signing-out',
    'revoke:marker=sid-1',
    'clear-api-cache',
    'signed-out:session=purged,verifier=purged',
    'navigate:/',
  ]);
  expect(localStorage.getItem('av-theme')).toBe('dark'); // only auth keys are purged
});

it('a successful revoke keeps the review #762 order: revoke settles before the announcement and navigation', async () => {
  signOutResult = { error: null };
  await clickLogout();
  expect(order.indexOf('revoke:marker=sid-1')).toBeLessThan(order.findIndex((step) => step.startsWith('signed-out')));
  expect(order.at(-1)).toBe('navigate:/');
  expect(sessionStorage.getItem(SIGNED_OUT_SESSION_KEY)).toBe('sid-1');
});
