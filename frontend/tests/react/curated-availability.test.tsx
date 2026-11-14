import React from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { CuratedAvailabilityBadge } from '@/components/curated-availability-badge';
import AdminVocabPage from '@/app/(authed-admin-vocab)/admin/vocab/page';

vi.mock('@/lib/browser-api', () => ({ getBrowserJson: (...args: any[]) => window.api.getWith(...args) }));
vi.mock('@/components/admin-access-gate', () => ({ AdminAccessGate: ({ children }: any) => children }));

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  await import('@/public/js/components/aver-admin-chrome.js');
});
beforeEach(() => {
  (window as any).getSupabase = () => ({ auth: { getSession: async () => ({ data: { session: { user: { email: 'admin@example.test' } } } }) } });
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

for (const ready of [false, true]) {
  it(`labels the menu and exactly two hub cards when schema ready=${ready}`, async () => {
    const getWith = vi.fn(() => ready ? Promise.resolve({ available: true }) : Promise.reject({ status: 503, detail: { error_code: 'feature_unavailable' } }));
    (window as any).api = { getWith };
    const { container } = render(<AdminVocabPage />);
    const chrome = container.querySelector('aver-admin-chrome')!;
    const menu = chrome.shadowRoot!.querySelector('[data-subsection="curated"]')!;
    await waitFor(() => expect(getWith).toHaveBeenCalledTimes(3));
    await waitFor(() => {
      expect(menu.textContent?.includes('Chưa khả dụng')).toBe(!ready);
      expect(screen.queryAllByText('Chưa khả dụng')).toHaveLength(ready ? 0 : 2);
    });
    expect(menu.getAttribute('href')).toBe('/admin/vocab/curated');
    for (const href of ['/admin/vocab/curated', '/admin/vocab/pilot-metrics']) {
      expect(container.querySelector(`a[href="${href}"]`)?.textContent?.includes(ready ? 'PILOT' : 'Chưa khả dụng')).toBe(true);
    }
    // Reactive sidebar redraw keeps the capability label.
    chrome.setAttribute('subsection', 'curated');
    await waitFor(() => expect(chrome.shadowRoot!.querySelector('[data-curated-availability]')?.textContent).toBe(ready ? '' : 'Chưa khả dụng'));
  });
}

it('shows a visible lookup failure without inventing a missing-schema result', async () => {
  (window as any).api = { getWith: vi.fn().mockRejectedValue({ status: 503, detail: 'network failure' }) };
  render(<CuratedAvailabilityBadge />);
  expect(await screen.findByText('Không kiểm tra được khả dụng')).toBeTruthy();
  expect(screen.queryByText('Chưa khả dụng')).toBeNull();
});
