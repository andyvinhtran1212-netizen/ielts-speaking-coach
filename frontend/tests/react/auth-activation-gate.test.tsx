import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';

// W-03: learner layouts (AuthedShell → <AuthProvider activationGate>) must send
// an INACTIVE account to /login (activation dialog) before `signed-in` is ever
// exposed, so a learner page never renders or calls learner APIs first. The
// backend is the real gate; a failed probe fails OPEN.
let notify: (event: string, session: any) => void;
const location = { pathname: '/home', replace: vi.fn() };
const session = (id: string) => ({ user: { id, email: null }, access_token: `token-${id}` });

function View() {
  const auth = useAuth();
  return <span>{auth.status}:{auth.user?.id || ''}</span>;
}
const mount = (gate = true) => render(<AuthProvider activationGate={gate}><View /></AuthProvider>);

function installSupabase(initial: any) {
  Object.defineProperty(window, 'getSupabase', {
    configurable: true,
    value: () => ({ auth: {
      getSession: vi.fn(async () => ({ data: { session: initial } })),
      onAuthStateChange: (fn: any) => { notify = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
    } }),
  });
}

// window.api.getWith resolves the parsed body on 2xx and rejects otherwise.
function respond(body: unknown, ok = true) {
  return vi.fn(async () => { if (!ok) throw new Error('500'); return body; });
}
function installApi(getWith: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'api', { configurable: true, writable: true, value: { base: 'https://api.test', getWith } });
  return getWith;
}

beforeEach(() => {
  window.sessionStorage.clear();
  location.pathname = '/home';
  location.replace = vi.fn();
  installApi(respond({ is_active: true }));
  const actualWindow = window;
  vi.stubGlobal('window', new Proxy(actualWindow, {
    get(target, key) {
      if (key === 'location') return location;
      return Reflect.get(target, key, target);
    },
  }));
  installSupabase(session('A'));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
  window.sessionStorage.clear();
});

it('redirects an inactive account to /login and never exposes signed-in', async () => {
  const getWith = respond({ is_active: false });
  installApi(getWith);
  mount();
  await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/login'));
  expect(getWith).toHaveBeenCalledWith('/auth/check-active', undefined, undefined);
  expect(screen.getByText('initial-loading:')).toBeTruthy();
  expect(screen.queryByText(/signed-in/)).toBeNull();
});

it('an active account signs in, is remembered per tab, and is not re-probed', async () => {
  const getWith = respond({ is_active: true });
  installApi(getWith);
  const first = mount();
  expect(screen.getByText('initial-loading:')).toBeTruthy();
  await screen.findByText('signed-in:A');
  expect(location.replace).not.toHaveBeenCalled();
  first.unmount();

  mount();
  await screen.findByText('signed-in:A');
  expect(getWith).toHaveBeenCalledTimes(1);
});

it('fails open on a network error (backend still 403s an inactive account)', async () => {
  installApi(vi.fn(async () => { throw new TypeError('network down'); }));
  mount();
  await screen.findByText('signed-in:A');
  expect(location.replace).not.toHaveBeenCalled();
});

it('fails open without window.api, on a non-2xx or a malformed reply, and never remembers it', async () => {
  Reflect.deleteProperty(window, 'api');
  const noTransport = mount();
  await screen.findByText('signed-in:A');
  noTransport.unmount();
  installApi(respond({ detail: 'boom' }, false));
  const view = mount();
  await screen.findByText('signed-in:A');
  view.unmount();
  const getWith = respond({ unexpected: true });
  installApi(getWith);
  mount();
  await screen.findByText('signed-in:A');
  expect(getWith).toHaveBeenCalledTimes(1);          // not remembered → probed again
  expect(location.replace).not.toHaveBeenCalled();
});

it('a token refresh for the settled account never drops back to loading', async () => {
  installApi(respond({ is_active: true }));
  mount();
  await screen.findByText('signed-in:A');
  window.sessionStorage.clear();                   // even without the tab memo
  act(() => notify('TOKEN_REFRESHED', session('A')));
  expect(screen.getByText('signed-in:A')).toBeTruthy();
});

it('a newer sign-out supersedes a pending probe (no late redirect)', async () => {
  let resolve!: (value: any) => void;
  installApi(vi.fn(() => new Promise((r) => { resolve = r; })));
  mount();
  await waitFor(() => expect(notify).toBeTypeOf('function'));
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  act(() => notify('SIGNED_OUT', null));
  await act(async () => resolve({ is_active: false }));
  expect(screen.getByText('signed-out:')).toBeTruthy();
  expect(location.replace).not.toHaveBeenCalled();
});

it.each(['/login', '/admin/users', '/instructor/students'])('does not gate exempt path %s', async (path) => {
  location.pathname = path;
  const getWith = respond({ is_active: false });
  installApi(getWith);
  mount();
  await screen.findByText('signed-in:A');
  expect(getWith).not.toHaveBeenCalled();
});

it('hybrid/public layouts (no activationGate) are never redirected', async () => {
  const getWith = respond({ is_active: false });
  installApi(getWith);
  mount(false);
  await screen.findByText('signed-in:A');
  expect(getWith).not.toHaveBeenCalled();
  expect(location.replace).not.toHaveBeenCalled();
});
