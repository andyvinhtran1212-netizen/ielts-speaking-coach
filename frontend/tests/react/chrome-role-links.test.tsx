import { afterEach, beforeAll, expect, it } from 'vitest';

// ADMINIA-0074 FR-004 (G09-T09): in the learner chrome, "Sang khu quản trị"
// only for role admin; "Sang khu giáo viên" (was "Trang giảng viên") for
// instructor and admin. A link a role may not see is absent from the DOM (Q-40).
beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  await import('@/public/js/components/aver-chrome.js');
});

afterEach(() => { document.body.innerHTML = ''; });

function mount(role: string | null) {
  const chrome = document.createElement('aver-chrome') as any;
  chrome.setAttribute('role-source', 'page'); // the page owns the role: no /auth/me
  document.body.appendChild(chrome);
  chrome.setRole(role);
  const root = chrome.shadowRoot as ShadowRoot;
  const links = () => [...root.querySelectorAll('.user-menu-dropdown a')]
    .map((a) => [a.textContent, a.getAttribute('href')]);
  return { chrome, root, links };
}

it('admin sees both staff links, before logout, teacher area first', () => {
  const { root, links } = mount('admin');
  expect(links()).toEqual([
    ['Hồ sơ', '/profile'],
    ['Sang khu giáo viên', '/instructor'],
    ['Sang khu quản trị', '/admin'],
  ]);
  const items = [...root.querySelectorAll('.user-menu-dropdown [role="menuitem"]')].map((n) => n.id || n.textContent);
  expect(items.at(-1)).toBe('user-menu-logout');
});

it('instructor sees only "Sang khu giáo viên"', () => {
  const { root, links } = mount('instructor');
  expect(links()).toEqual([['Hồ sơ', '/profile'], ['Sang khu giáo viên', '/instructor']]);
  expect(root.getElementById('admin-link')).toBeNull();
});

it.each(['student', null])('%s sees no staff link at all', (role) => {
  const { root, links } = mount(role);
  expect(links()).toEqual([['Hồ sơ', '/profile']]);
  expect(root.querySelector('a[href="/admin"], a[href="/instructor"]')).toBeNull();
});

it('a role change removes the links it no longer allows and never duplicates them', () => {
  const { chrome, root, links } = mount('admin');
  chrome.setRole('admin');
  expect(root.querySelectorAll('#admin-link').length).toBe(1);
  expect(root.querySelectorAll('#instructor-link').length).toBe(1);
  chrome.setRole('instructor');
  expect(links().map(([, href]) => href)).toEqual(['/profile', '/instructor']);
  chrome.setRole('student');
  expect(links().map(([, href]) => href)).toEqual(['/profile']);
});
