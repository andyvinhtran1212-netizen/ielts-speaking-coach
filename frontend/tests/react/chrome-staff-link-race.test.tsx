import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// Q-82: /home calls the chrome's setUser({name}) when home-summary arrives.
// That page-owned pill flag also cancelled the chrome's own /auth/me role
// lookup, so a staff member lost "Trang giảng viên" whenever the page won the
// race (CI run 40630894114, admin at 390px). setUser() without a role owns the
// pill only; the role still comes from /auth/me, and learners never get the
// anchor (Q-40).
let releaseSession: () => void;
let sessionGate: Promise<void>;
let role: string;
let fetchRole: ReturnType<typeof vi.fn>;

const session = { access_token: 't', user: { id: 'A', email: 'a@example.test', user_metadata: { display_name: 'Session Name' } } };

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  await import('@/public/js/components/aver-chrome.js');
});

beforeEach(() => {
  sessionGate = new Promise((resolve) => { releaseSession = resolve; });
  Object.assign(window, {
    api: { base: 'https://api.example.test' },
    getSupabase: () => ({ auth: { getSession: async () => { await sessionGate; return { data: { session } }; } } }),
  });
  fetchRole = vi.fn(async () => new Response(JSON.stringify({ role }), { status: 200 }));
  vi.stubGlobal('fetch', fetchRole);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount() {
  const chrome = document.createElement('aver-chrome') as any;
  document.body.appendChild(chrome);
  const root = chrome.shadowRoot as ShadowRoot;
  return {
    chrome,
    anchors: () => root.querySelectorAll('#instructor-link, a[href="/instructor"]').length,
    pill: () => root.getElementById('user-pill-name')!.textContent,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it('admin: without a page setUser() the chrome fills the pill and renders the link', async () => {
  role = 'admin';
  const { anchors, pill } = mount();
  releaseSession();
  await vi.waitFor(() => expect(anchors()).toBe(1));
  expect(pill()).toBe('Session Name');
  expect(fetchRole).toHaveBeenCalledTimes(1);
});

it.each(['admin', 'instructor'])('%s: setUser({name}) during the chrome session read still renders the link', async (staff) => {
  role = staff;
  const { chrome, anchors, pill } = mount();
  await settle(); // the chrome's tick is now awaiting getSession()
  chrome.setUser({ name: 'Trang' });
  releaseSession();
  await vi.waitFor(() => expect(anchors()).toBe(1));
  expect(pill()).toBe('Trang'); // the page still owns the pill
  expect(fetchRole).toHaveBeenCalledTimes(1);
});

it.each(['admin', 'instructor'])('%s: setUser({name}) before the chrome tick still renders the link', async (staff) => {
  role = staff;
  const { chrome, anchors, pill } = mount();
  chrome.setUser({ name: 'Trang' });
  releaseSession();
  await vi.waitFor(() => expect(anchors()).toBe(1));
  expect(pill()).toBe('Trang');
  expect(fetchRole).toHaveBeenCalledTimes(1);
});

it('learner: the role is resolved and the anchor is never in the DOM', async () => {
  role = 'user';
  const { chrome, anchors } = mount();
  chrome.setUser({ name: 'Trang' });
  releaseSession();
  await vi.waitFor(() => expect(fetchRole).toHaveBeenCalledTimes(1));
  await settle();
  expect(anchors()).toBe(0);
});

it('a page that passes its own role keeps owning it — no /auth/me', async () => {
  role = 'admin';
  const { chrome, anchors } = mount();
  chrome.setUser({ name: 'Trang', role: 'user' });
  releaseSession();
  await settle();
  expect(fetchRole).not.toHaveBeenCalled();
  expect(anchors()).toBe(0);
});
