import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { SessionResultBehavior } from '@/app/(authed-session-result)/result/session-result-behavior';
import { AuthProvider } from '@/lib/auth/auth-provider';

const fixture = vi.hoisted(() => ({ sessionId: 's1' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`id=${fixture.sessionId}`) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
vi.mock('@/lib/session-api', () => ({
  getSessionDetail: async () => ({
    id: fixture.sessionId, status: 'completed', part: 1, mode: 'practice',
    topic: 'Hometown', overall_band: 6, questions: [], responses: [],
  }),
  getSessionAudioUrls: async () => [],
}));

const PENDING = '/api/vocabulary/bank/pending';
const items = [
  { id: 'v1', headword: 'resilient', session_id: 's1' },
  { id: 'v2', headword: 'adaptable', session_id: 's1' },
];
let account: string;
let notifyAuth: (event: string, session: unknown) => void;
let completeProfile: (body: object, status?: number) => void;
let fetchMock: ReturnType<typeof vi.fn>;
let getWith: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
const authSession = () => ({ access_token: `token-${account}`, user: { id: account, email: `${account}@example.test` } });
const meCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'));
const pendingCalls = () => getWith.mock.calls.filter(([url]) => url === PENDING);
const tree = (visible = true) => <AuthProvider>{visible ? <SessionResultBehavior /> : null}</AuthProvider>;

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  await import('@/public/js/components/aver-chrome.js');
});

beforeEach(() => {
  fixture.sessionId = 's1';
  account = 'u1';
  Object.defineProperty(window, 'getSupabase', {
    configurable: true,
    value: () => ({ auth: {
      getSession: async () => ({ data: { session: account ? authSession() : null } }),
      onAuthStateChange: (fn: typeof notifyAuth) => {
        notifyAuth = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    } }),
  });
  getWith = vi.fn(async (path) => path === PENDING ? [...items] : []);
  post = vi.fn(async () => ({}));
  Object.defineProperty(window, 'api', {
    configurable: true, value: { base: 'https://api.test', getWith, get: vi.fn(async () => []), post },
  });
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/auth/me')) {
      return new Promise<Response>((resolve) => {
        completeProfile = (body, status = 200) => resolve(new Response(JSON.stringify(body), { status }));
      });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  delete (window as any).__averAuthMeSingleFlight;
  vi.unstubAllGlobals();
});

async function startChrome() {
  document.body.appendChild(document.createElement('aver-chrome'));
  await vi.waitFor(() => expect(meCalls()).toHaveLength(1));
}

async function profile(body: object, status = 200) {
  await act(async () => { completeProfile(body, status); });
}

it.each([undefined, false, 'true', 1])('missing/false/nonboolean flag %j sends no pending request and renders no panel', async (flag) => {
  await startChrome();
  await profile({ id: 'u1', vocab_bank_enabled: flag });
  render(tree());
  await screen.findByText('Overall Band Score');
  expect(pendingCalls()).toHaveLength(0);
  expect(document.querySelector('[data-pending-panel]')).toBeNull();
  expect(meCalls()).toHaveLength(1);
});

it('does not accept an enabled profile belonging to another account', async () => {
  await startChrome();
  await profile({ id: 'u2', vocab_bank_enabled: true });
  render(tree());
  await screen.findByText('Overall Band Score');
  expect(pendingCalls()).toHaveLength(0);
  expect(document.querySelector('[data-pending-panel]')).toBeNull();
});

it.each(['chrome-first', 'result-first'])('true shows the panel using one shell profile across mount and later navigation: %s', async (order) => {
  let view: ReturnType<typeof render>;
  if (order === 'chrome-first') {
    await startChrome();
    await profile({ id: 'u1', vocab_bank_enabled: true });
    view = render(tree());
  } else {
    view = render(tree());
    await screen.findByText('Overall Band Score');
    expect(pendingCalls()).toHaveLength(0);
    expect(meCalls()).toHaveLength(0);
    await startChrome();
    await profile({ id: 'u1', vocab_bank_enabled: true });
  }
  await screen.findByText('resilient');
  expect(pendingCalls()).toHaveLength(1);
  view.rerender(tree(false));
  const now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now + 60_000);
  fixture.sessionId = 's2';
  view.rerender(tree());
  await screen.findByText('resilient');
  expect(pendingCalls()).toHaveLength(2);
  expect(meCalls()).toHaveLength(1);
});

it('true plus initial pending 403 hides quietly without toast or application console.error', async () => {
  getWith.mockImplementation(async (path) => {
    if (path === PENDING) throw Object.assign(new Error('Forbidden'), { status: 403 });
    return [];
  });
  const errors = vi.spyOn(console, 'error');
  await startChrome();
  await profile({ id: 'u1', vocab_bank_enabled: true });
  render(tree());
  await screen.findByText('Overall Band Score');
  await vi.waitFor(() => expect(pendingCalls()).toHaveLength(1));
  expect(document.querySelector('[data-pending-panel]')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(errors).not.toHaveBeenCalled();
});

it.each(['switch', 'logout'])('clears the visible panel and retained profile on %s, including returning to the original account', async (event) => {
  const { getAuthMeProfile } = await import('@/lib/auth/auth-me-single-flight.mjs');
  await startChrome();
  await profile({ id: 'u1', vocab_bank_enabled: true });
  render(tree());
  await screen.findByText('resilient');
  await act(async () => {
    account = event === 'switch' ? 'u2' : '';
    // Chrome sign-out holds navigation; no browser navigation is needed here.
    if (!account) document.dispatchEvent(new CustomEvent('av-chrome-signing-out'));
    notifyAuth(account ? 'SIGNED_IN' : 'SIGNED_OUT', account ? authSession() : null);
  });
  expect(document.querySelector('[data-pending-panel]')).toBeNull();
  expect(getAuthMeProfile('u1')).toBeNull();
  await act(async () => { account = 'u1'; notifyAuth('SIGNED_IN', authSession()); });
  await screen.findByText('Overall Band Score');
  expect(pendingCalls()).toHaveLength(1);
  expect(meCalls()).toHaveLength(1);
});

it.each(['switch', 'logout'])('ignores an old profile completing after %s', async (event) => {
  const { getAuthMeProfile } = await import('@/lib/auth/auth-me-single-flight.mjs');
  await startChrome();
  render(tree());
  await screen.findByText('Overall Band Score');
  await act(async () => {
    account = event === 'switch' ? 'u2' : '';
    if (!account) document.dispatchEvent(new CustomEvent('av-chrome-signing-out'));
    notifyAuth(account ? 'SIGNED_IN' : 'SIGNED_OUT', account ? authSession() : null);
  });
  await profile({ id: 'u1', vocab_bank_enabled: true });
  expect(getAuthMeProfile('u1')).toBeNull();
  expect(document.querySelector('[data-pending-panel]')).toBeNull();
  expect(pendingCalls()).toHaveLength(0);
  expect(meCalls()).toHaveLength(1);
});

it.each(['confirm', 'drop', 'bulk-confirm'])('preserves the existing %s action for enabled accounts', async (action) => {
  await startChrome();
  await profile({ id: 'u1', vocab_bank_enabled: true });
  render(tree());
  await screen.findByText('resilient');
  const label = action === 'bulk-confirm' ? 'Giữ tất cả' : action === 'confirm' ? 'Giữ' : 'Bỏ';
  fireEvent.click(screen.getAllByRole('button', { name: label, exact: true })[0]);
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(
    action === 'bulk-confirm' ? `${PENDING}/bulk-confirm` : `${PENDING}/v1/${action}`,
    action === 'bulk-confirm' ? { ids: ['v1', 'v2'] } : {},
  ));
  expect(screen.queryByText('resilient')).toBeNull();
  if (action === 'bulk-confirm') expect(screen.queryByText('adaptable')).toBeNull();
  else expect(screen.getByText('adaptable')).toBeTruthy();
});
