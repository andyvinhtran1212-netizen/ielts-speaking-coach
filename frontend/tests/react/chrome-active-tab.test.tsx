import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// G02-T09 (FR-02-008): every learner destination that a page names through
// `active` must light its own tab. Reading pages pass `active="reading"`, and
// `/advanced-vocabulary` belongs to the Lớp học tab (`class`).
beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  delete (window as any).getSupabase;
  await import('@/public/js/components/aver-chrome.js');
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).__averAuthMeSingleFlight;
  vi.unstubAllGlobals();
});

function mount(active: string) {
  const chrome = document.createElement('aver-chrome');
  chrome.setAttribute('active', active);
  document.body.appendChild(chrome);
  const links = [...chrome.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.nav-links a[data-tab]')];
  return {
    highlighted: links.filter((a) => a.classList.contains('active')).map((a) => a.dataset.tab),
    current: links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.dataset.tab),
  };
}

it.each(['reading', 'class', 'listening'])('active="%s" highlights only that tab', (tab) => {
  const { highlighted, current } = mount(tab);
  expect(highlighted).toEqual([tab]);
  expect(current).toEqual([tab]);
});

it('an unknown active value highlights no tab', () => {
  const { highlighted } = mount('my-class');
  expect(highlighted).toEqual([]);
});
