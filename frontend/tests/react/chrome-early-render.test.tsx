import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// PC-J06 (U-21/U-15/U-06): the student chrome is no longer loaded behind the
// Supabase runtime boundary, so it renders before `window.getSupabase` exists.
// It must still fill the account pill, revoke on an early logout, keep the
// guest account placeholder out of public pages, and never warm the
// production fallback origins before runtime-config/api.js are known.
const READY = 'aver:supabase-runtime-ready';
const PROD_API = 'https://ielts-speaking-coach-production.up.railway.app';
let session: any;
let signOut: ReturnType<typeof vi.fn>;
let href = '';

const client = () => ({ auth: { getSession: async () => ({ data: { session } }), signOut } });
const hintHrefs = () => [...document.head.querySelectorAll('link[rel="preconnect"]')]
  .map((link) => link.getAttribute('href'));

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  delete (window as any).getSupabase;
  await import('@/public/js/components/aver-chrome.js');
});

beforeEach(() => {
  session = { access_token: 't', user: { id: 'A', email: 'learner@example.com', user_metadata: { display_name: 'Lan' } } };
  signOut = vi.fn(async () => ({ error: null }));
  href = '';
  delete (window as any).getSupabase;
  const realWindow = window;
  const navigation = { set href(value: string) { href = value; } };
  vi.stubGlobal('window', new Proxy(realWindow, {
    get: (target, key) => (key === 'location' ? navigation : Reflect.get(target, key, target)),
  }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__averAuthMeSingleFlight; // each test is a fresh page load (PC-J147)
  document.head.querySelectorAll('meta[name="aver-auth-gated"]').forEach((meta) => meta.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(authGated: boolean) {
  if (authGated) {
    const meta = document.createElement('meta');
    meta.name = 'aver-auth-gated';
    meta.content = '1';
    document.head.appendChild(meta);
  }
  const chrome = document.createElement('aver-chrome');
  document.body.appendChild(chrome);
  const root = chrome.shadowRoot!;
  return {
    root,
    menu: root.querySelector('.user-menu') as HTMLElement,
    pill: () => root.getElementById('user-pill-name')!.textContent,
  };
}

function runtimeReady() {
  Object.assign(window, {
    __AVER_RUNTIME_CONFIG__: { supabaseUrl: 'https://staging-project.supabase.co' },
    api: { base: 'https://staging-api.example.test', clearAuthCache() {} },
    getSupabase: client,
  });
  window.dispatchEvent(new Event(READY));
}

it('renders nav and hamburger before the runtime, then fills the pill when the boundary signals ready', async () => {
  vi.useFakeTimers();
  const { root, menu, pill } = mount(true);
  expect(root.querySelectorAll('.nav-links a').length).toBe(8);
  expect(root.getElementById('mobile-nav-toggle')).toBeTruthy();
  expect(menu.hidden).toBe(false); // signed-in skeleton on auth-gated routes
  expect(hintHrefs()).not.toContain(PROD_API);

  await vi.advanceTimersByTimeAsync(5_000); // longer than the old 3s poll ceiling
  expect(pill()).toBe('…');

  vi.useRealTimers();
  runtimeReady();
  await vi.waitFor(() => expect(pill()).toBe('Lan'));
  expect(hintHrefs()).toContain('https://staging-api.example.test');
  expect(hintHrefs()).toContain('https://staging-project.supabase.co');
  expect(hintHrefs()).not.toContain(PROD_API);
});

it('public routes hide the account placeholder from guests', async () => {
  session = null;
  Object.assign(window, { getSupabase: client });
  const { menu, pill } = mount(false);
  expect(menu.hidden).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(menu.hidden).toBe(true);
  expect(pill()).toBe('…');
});

it('public routes reveal the account menu once a session is confirmed', async () => {
  Object.assign(window, { getSupabase: client });
  const { menu, pill } = mount(false);
  await vi.waitFor(() => expect(pill()).toBe('Lan'));
  expect(menu.hidden).toBe(false);
});

it('a logout clicked before the runtime is ready waits and still revokes the session', async () => {
  const { root } = mount(true);
  root.getElementById('user-menu-logout')!.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(signOut).not.toHaveBeenCalled();
  expect(href).toBe('');

  runtimeReady();
  await vi.waitFor(() => expect(href).toBe('/'));
  expect(signOut).toHaveBeenCalledTimes(1);
});

it('a page setUser({name}) before the runtime keeps the pill but still resolves the /auth/me role', async () => {
  const fetchRole = vi.fn(async () => new Response(JSON.stringify({ role: 'instructor' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchRole);
  const { root, pill } = mount(true);
  (document.querySelector('aver-chrome') as any).setUser({ name: 'Trang' }); // /home passes no role
  runtimeReady();
  await vi.waitFor(() => expect(root.getElementById('instructor-link')?.hasAttribute('hidden')).toBe(false));
  expect(pill()).toBe('Trang');
  expect(fetchRole).toHaveBeenCalledTimes(1);
});

it('a page that passes its own role does not trigger a second /auth/me', async () => {
  const fetchRole = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchRole);
  mount(true);
  (document.querySelector('aver-chrome') as any).setUser({ name: 'Trang', role: 'user' });
  runtimeReady();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(fetchRole).not.toHaveBeenCalled();
});

it('does not load the error reporter before runtime-config (it would post to the production fallback)', () => {
  delete (window as any).__AVER_RUNTIME_CONFIG__;
  document.head.querySelectorAll('script[data-aver-error-reporter]').forEach((s) => s.remove());
  mount(true);
  expect(document.head.querySelector('script[data-aver-error-reporter]')).toBeNull();

  (window as any).__AVER_RUNTIME_CONFIG__ = { apiBase: 'https://staging-api.example.test' };
  document.body.appendChild(document.createElement('aver-chrome'));
  expect(document.head.querySelector('script[data-aver-error-reporter]')).not.toBeNull();
});
