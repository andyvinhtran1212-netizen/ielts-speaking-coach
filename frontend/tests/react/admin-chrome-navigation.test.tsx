import { afterEach, beforeAll, expect, it, vi } from 'vitest';

vi.mock('@/public/js/theme-toggle.js', () => ({ bindToggleButton: () => () => {} }));
vi.mock('@/public/js/components/perf-hints.js', () => ({ installPerfResourceHints: () => {} }));

beforeAll(async () => {
  Object.assign(window, {
    getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
  });
  await import('@/public/js/components/aver-admin-chrome.js');
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

function mount(active = 'overview', subsection?: string) {
  const chrome = document.createElement('aver-admin-chrome');
  chrome.setAttribute('active', active);
  if (subsection) chrome.setAttribute('subsection', subsection);
  document.body.append(chrome);
  return { chrome, root: chrome.shadowRoot! };
}

it('renders one closed QA disclosure on initial mount and after a fresh page mount', () => {
  const { chrome, root } = mount();
  expect(root.querySelectorAll('details')).toHaveLength(1);
  const qa = root.querySelector('details')!;
  expect(qa.open).toBe(false);
  expect(qa.querySelector('summary')?.textContent).toBe('Thí điểm & QA');
  expect(qa.querySelectorAll('a')).toHaveLength(6);
  qa.querySelector('summary')!.click();
  expect(qa.open).toBe(true);
  qa.querySelector('summary')!.click();
  expect(qa.open).toBe(false);
  qa.open = true;
  chrome.remove();
  expect(mount().root.querySelector('details')!.open).toBe(false);
});

it.each([
  ['vocab', 'curated', '/admin/vocab/curated'],
  ['vocab', 'pilot-metrics', '/admin/vocab/pilot-metrics'],
  ['vocab', 'd1-curation', '/admin/vocab/d1-curation'],
  ['vocab', 'exercises', '/admin/vocab/exercises'],
  ['vocab', 'lemmas', '/admin/vocab/lemmas'],
  ['grammar', 'recommend-test', '/admin/grammar/recommend-test'],
])('preserves the %s/%s page contract and href after moving the tool', (active, subsection, href) => {
  const { chrome, root } = mount(active, subsection);
  const current = root.querySelector('details a[aria-current="page"]')!;
  expect(current.getAttribute('href')).toBe(href);
  expect(current.getAttribute('data-section')).toBe(active);
  expect(current.getAttribute('data-subsection')).toBe(subsection);
  expect(root.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  expect(root.querySelector('details')!.open).toBe(false);
  chrome.setAttribute('subsection', 'invalid');
  expect(root.querySelector('details a.active')).toBeNull();
  chrome.setAttribute('subsection', subsection);
  expect(root.querySelector('details a[aria-current="page"]')!.getAttribute('href')).toBe(href);
});

it('keeps ordinary Vocab children active and moved Grammar tools inactive', () => {
  const { root } = mount('vocab', 'sets');
  expect(root.querySelector('a[aria-current="page"]')!.getAttribute('href')).toBe('/admin/vocab/sets');
  expect(root.querySelector('details a.active')).toBeNull();
});

it('closes the mobile drawer after a QA link click, including after reconnect', () => {
  const { chrome, root } = mount();
  chrome.remove();
  document.body.append(chrome);
  root.getElementById('hamburger')!.click();
  expect(chrome.getAttribute('data-mobile-open')).toBe('1');
  root.querySelector('summary')!.click();
  const link = root.querySelector<HTMLAnchorElement>('details a')!;
  link.addEventListener('click', (event) => event.preventDefault());
  link.click();
  expect(chrome.hasAttribute('data-mobile-open')).toBe(false);
  expect(document.body.style.overflow).toBe('');
});

it('traps mobile focus at the summary when closed and the final tool when open', () => {
  // Chromium reports rectangles for links inside closed details even though
  // they cannot receive focus. jsdom has no layout, so reproduce those rects.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.id === 'collapse-btn' ? [] : [new DOMRect(0, 0, 100, 32)]) as unknown as DOMRectList;
  });
  const { chrome, root } = mount();
  chrome.setAttribute('data-mobile-open', '1');
  const summary = root.querySelector('summary')!;
  const first = root.querySelector<HTMLAnchorElement>('a[data-section="overview"]')!;
  const last = root.querySelector<HTMLAnchorElement>('details a:last-child')!;
  const tab = (shiftKey = false) => document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Tab', shiftKey, bubbles: true, cancelable: true,
  }));

  summary.focus();
  tab();
  expect(root.activeElement).toBe(first);
  tab(true);
  expect(root.activeElement).toBe(summary);
  root.querySelector('details')!.open = true;
  last.focus();
  tab();
  expect(root.activeElement).toBe(first);
  tab(true);
  expect(root.activeElement).toBe(last);
});
