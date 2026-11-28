import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';

// next/dynamic resolves the lazy screen asynchronously; render it directly here.
vi.mock('next/dynamic', async () => {
  const screenModule = await import('@/components/ui/needs-course-screen');
  return { default: () => screenModule.NeedsCourseScreen };
});

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

it.each([500, 503])('a %i from /auth/check-active fails open and is not remembered', async (status) => {
  // ASYNCAUTH-0036 Revision 2: a DB error is now 503 (was 500); both are 'unknown'.
  const getWith = vi.fn(async () => {
    throw Object.assign(new Error('Đã xảy ra lỗi nội bộ, vui lòng thử lại.'), { status });
  });
  installApi(getWith);
  const first = mount();
  await screen.findByText('signed-in:A');
  first.unmount();
  mount();
  await screen.findByText('signed-in:A');
  expect(getWith).toHaveBeenCalledTimes(2);
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

it('does not gate the exempt /login path', async () => {
  location.pathname = '/login';
  const getWith = respond({ is_active: false });
  installApi(getWith);
  mount();
  await screen.findByText('signed-in:A');
  expect(getWith).not.toHaveBeenCalled();
});

// Q-13 — staff consoles: an inactive instructor/admin is sent to /login
// (activation) instead of rendering the console around 403s.
it.each(['/admin/users', '/instructor', '/instructor/students'])('redirects an inactive account away from staff path %s', async (path) => {
  location.pathname = path;
  const getWith = respond({ is_active: false });
  installApi(getWith);
  mount();
  await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/login'));
  expect(getWith).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/^signed-in:/)).toBeNull();
});

it('an active staff account still opens the staff console', async () => {
  location.pathname = '/instructor';
  installApi(respond({ is_active: true }));
  mount();
  await screen.findByText('signed-in:A');
  expect(location.replace).not.toHaveBeenCalled();
});

it('hybrid/public layouts (no activationGate) are never redirected', async () => {
  const getWith = respond({ is_active: false });
  installApi(getWith);
  mount(false);
  await screen.findByText('signed-in:A');
  expect(getWith).not.toHaveBeenCalled();
  expect(location.replace).not.toHaveBeenCalled();
});


// ── LEARNERCORE-0063 FR-091…FR-093 (G07-T26) ────────────────────────────────

const OPEN = { is_active: false, suspended: false, learner_v2_enabled: true };

function Page() {
  const auth = useAuth();
  return <span>page:{auth.status}:{auth.user?.id || ''}</span>;
}
const mountPage = () => render(<AuthProvider activationGate><Page /></AuthProvider>);

it.each(['/home', '/start', '/account/orders', '/profile', '/help'])(
  'an inactive learner_v2 account opens %s, signed in, without a redirect', async (path) => {
    location.pathname = path;
    installApi(respond(OPEN));
    mountPage();
    await screen.findByText('page:signed-in:A');
    expect(location.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Cần có khoá')).toBeNull();
  });

it.each(['/listening', '/practice', '/tests', '/homework', '/profile/v2'])(
  'an inactive learner_v2 account sees "Cần có khoá" at %s and the page never mounts', async (path) => {
    location.pathname = path;
    installApi(respond(OPEN));
    mountPage();
    await screen.findByText('Cần có khoá');
    expect(screen.queryByText(/^page:/)).toBeNull();
    expect(location.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Nhập mã kích hoạt' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'Về Hôm nay' }).getAttribute('href')).toBe('/home');
    // /courses is not live yet: the link is hidden, as with the commerce flag off.
    expect(screen.queryByRole('link', { name: 'Xem các khoá' })).toBeNull();
  });

it('inactive_open is never remembered: the next load probes again', async () => {
  const getWith = respond(OPEN);
  installApi(getWith);
  const first = mountPage();
  await screen.findByText('page:signed-in:A');
  first.unmount();
  mountPage();
  await screen.findByText('page:signed-in:A');
  expect(getWith).toHaveBeenCalledTimes(2);
});

it.each([
  ['suspended', { is_active: false, suspended: true, learner_v2_enabled: true }],
  ['flag off', { is_active: false, suspended: false, learner_v2_enabled: false }],
  ['field missing (old backend)', { is_active: false, suspended: false }],
])('an inactive account goes to /login as today when %s', async (_label, body) => {
  installApi(respond(body));
  mountPage();
  await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/login'));
  expect(screen.queryByText(/^page:signed-in/)).toBeNull();
  expect(screen.queryByText('Cần có khoá')).toBeNull();
});

it('switching to another account drops the open-page state', async () => {
  location.pathname = '/listening';
  const getWith = vi.fn()
    .mockResolvedValueOnce(OPEN)
    .mockResolvedValueOnce({ is_active: true });
  installApi(getWith);
  mountPage();
  await screen.findByText('Cần có khoá');
  act(() => notify('SIGNED_IN', session('B')));
  await screen.findByText('page:signed-in:B');
  expect(screen.queryByText('Cần có khoá')).toBeNull();
});
