import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// ADMINIA-0074 FR-003 / FR-004 (G09-T09): the learner chrome's account menu
// shows "Sang khu giáo viên" to instructors and admins, and "Sang khu quản trị"
// to admins only; a learner's DOM carries neither link (Q-40). The role comes
// from /auth/me (unchanged), or from a page's setUser({role}).
let role: string;
const session = { access_token: 't', user: { id: 'A', email: 'a@example.test', user_metadata: { display_name: 'Bảo' } } };

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  await import('@/public/js/components/aver-chrome.js');
});

beforeEach(() => {
  Object.assign(window, {
    api: { base: 'https://api.example.test' },
    getSupabase: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ role }), { status: 200 })));
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__averAuthMeSingleFlight;
  vi.unstubAllGlobals();
});

function menuLinks(chrome: any) {
  const menu = (chrome.shadowRoot as ShadowRoot).querySelector('.user-menu-dropdown')!;
  return [...menu.querySelectorAll('a, button')].map((el) => [el.textContent?.trim(), el.getAttribute('href')]);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

it.each([
  ['admin', [['Hồ sơ', '/profile'], ['Sang khu giáo viên', '/instructor'], ['Sang khu quản trị', '/admin'], ['Đăng xuất', null]]],
  ['instructor', [['Hồ sơ', '/profile'], ['Sang khu giáo viên', '/instructor'], ['Đăng xuất', null]]],
  ['student', [['Hồ sơ', '/profile'], ['Đăng xuất', null]]],
])('%s from /auth/me: role links in order, before Đăng xuất', async (who, expected) => {
  role = who;
  const chrome = document.createElement('aver-chrome') as any;
  document.body.appendChild(chrome);
  await vi.waitFor(() => expect(menuLinks(chrome)).toEqual(expected));
  await settle();
  expect(menuLinks(chrome)).toEqual(expected);
});

it('a role change removes links from the DOM, and re-applying never duplicates them', () => {
  const chrome = document.createElement('aver-chrome') as any;
  chrome.setAttribute('role-source', 'page');
  document.body.appendChild(chrome);
  const root = chrome.shadowRoot as ShadowRoot;
  const count = () => [root.querySelectorAll('#instructor-link').length, root.querySelectorAll('#admin-link').length];
  chrome.setRole('admin');
  chrome.setRole('admin');
  expect(count()).toEqual([1, 1]);
  chrome.setRole('instructor');
  expect(count()).toEqual([1, 0]);
  chrome.setRole('student');
  expect(count()).toEqual([0, 0]);
  expect(root.querySelector('a[href="/admin"], a[href="/instructor"]')).toBeNull();
});
