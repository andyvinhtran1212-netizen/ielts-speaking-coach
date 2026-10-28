// C-04 — on the staging site a failed runtime-config.js used to leave both
// landing stat tiles on '—': the host fallback resolved null for staging. The
// fallback now reaches the staging API, waits for the runtime-config signal,
// and stays silent on unknown preview hosts.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LandingBehavior } from '@/app/(marketing)/landing-behavior';

declare const jsdom: { reconfigure(options: { url: string }): void };

const STAGING_API = 'https://ielts-speaking-coach-staging.up.railway.app';
const PROD_API = 'https://ielts-speaking-coach-production.up.railway.app';

let fetchMock: ReturnType<typeof vi.fn>;

function renderOn(url: string) {
  jsdom.reconfigure({ url });
  document.body.innerHTML = `
    <span data-stat="total_users">—</span>
    <span data-stat="sessions_completed">—</span>`;
  render(<LandingBehavior />);
}

const stat = (key: string) => document.querySelector(`[data-stat="${key}"]`)?.textContent;
const calledUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  delete window.__AVER_RUNTIME_CONFIG__;
  fetchMock = vi.fn(async (url: string) => (
    String(url).endsWith('/api/public-stats')
      ? new Response(JSON.stringify({ total_users: 1250, sessions_completed: 42 }), { status: 200 })
      : new Response('{}', { status: 200 })
  ));
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no matchMedia; the behavior binds the mobile-menu breakpoint.
  vi.stubGlobal('matchMedia', () => ({ addEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  delete window.__AVER_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
  jsdom.reconfigure({ url: 'http://localhost:3000/' });
});

it('fills the stats from the staging API when runtime-config.js fails on staging', async () => {
  renderOn('https://staging.averlearning.com/');
  // No guess while runtime-config.js is still in flight.
  expect(fetchMock).not.toHaveBeenCalled();

  window.dispatchEvent(new Event('aver:runtime-config-failed'));

  await waitFor(() => expect(stat('total_users')).toBe('1.3K+'));
  expect(stat('sessions_completed')).toBe('42+');
  expect(calledUrls()).toContain(`${STAGING_API}/api/public-stats`);
  expect(calledUrls().some((url) => url.startsWith(PROD_API))).toBe(false);
});

it('uses the staging API when a loaded runtime config carries apiBase=null on staging', async () => {
  window.__AVER_RUNTIME_CONFIG__ = { apiBase: null, environment: null } as typeof window.__AVER_RUNTIME_CONFIG__;
  renderOn('https://staging.averlearning.com/');

  await waitFor(() => expect(stat('total_users')).toBe('1.3K+'));
  expect(calledUrls()[0]).toBe(`${STAGING_API}/api/public-stats`);
});

it('stays fail-closed on an unknown preview host', async () => {
  renderOn('https://ielts-speaking-coach-git-feature-x.vercel.app/');
  window.dispatchEvent(new Event('aver:runtime-config-failed'));

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(stat('total_users')).toBe('—');
});
