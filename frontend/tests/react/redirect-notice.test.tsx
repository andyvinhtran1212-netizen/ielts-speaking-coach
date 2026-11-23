import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RedirectNotice } from '@/components/redirect-notice';
import { MockResultBehavior } from '@/app/(authed-mock-result)/tests/mock/result/mock-result-behavior';

// G02-T11 (FR-02-010): a page without its parameter sends the learner to its
// parent with `?notice=`; the parent shows one plain line and drops the key.
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-a' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
// The layout strip re-reads the address on navigation; mirror the live URL.
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('shows the parent-page line, keeps other parameters and drops only the notice', () => {
  window.history.replaceState(null, '', '/full-test?tab=live&notice=lien-ket-thieu#top');
  render(<RedirectNotice />);
  expect(screen.getByRole('status').textContent).toContain(
    'Liên kết bạn vừa mở chưa đủ thông tin nên bạn được đưa về trang Thi thử.');
  expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/full-test?tab=live#top');
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('status')).toBeNull();
});

it('shows nothing for an unknown key, and never echoes URL text', () => {
  window.history.replaceState(null, '', '/speaking?notice=%3Cb%3Ehacked%3C%2Fb%3E');
  render(<RedirectNotice />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.body.textContent).not.toContain('hacked');
  expect(window.location.search).toBe('');
});

it('shows nothing without a notice', () => {
  window.history.replaceState(null, '', '/speaking?x=1');
  render(<RedirectNotice />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(window.location.search).toBe('?x=1');
});

// Codex on #2365: Next keeps the layout (and this strip) mounted across
// client-side navigation, so the strip follows the address, not its mount.
it('a soft redirect into an already-mounted layout still shows the line', () => {
  window.history.replaceState(null, '', '/grammar/search');
  const view = render(<RedirectNotice />);
  expect(screen.queryByRole('status')).toBeNull();
  window.history.replaceState(null, '', '/grammar?notice=lien-ket-thieu');
  view.rerender(<RedirectNotice />);
  expect(screen.getByRole('status').textContent).toContain('được đưa về Grammar Wiki.');
  expect(window.location.search).toBe('');
});

it('moving on to another page hides the line and does not bring it back', () => {
  window.history.replaceState(null, '', '/grammar?notice=lien-ket-thieu');
  const view = render(<RedirectNotice />);
  expect(screen.getByRole('status')).toBeTruthy();
  window.history.replaceState(null, '', '/grammar/exercises');
  view.rerender(<RedirectNotice />);
  expect(screen.queryByRole('status')).toBeNull();
  window.history.replaceState(null, '', '/grammar');
  view.rerender(<RedirectNotice />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('a mock result link without its sitting goes to Full Test with the notice', async () => {
  const replace = vi.fn();
  const realWindow = window;
  vi.stubGlobal('location', { ...realWindow.location, replace });
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith: vi.fn() } });
  await act(async () => { render(<MockResultBehavior />); });
  expect(replace).toHaveBeenCalledWith('/full-test?notice=lien-ket-thieu');
  expect((window as any).api.getWith).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toMatch(/Thiếu mã sitting/);
});
