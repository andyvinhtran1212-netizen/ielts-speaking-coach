import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { D1ExercisePlayer } from '@/app/(authed-d1-exercise)/d1-exercise/d1-exercise-player';
import { VocabularyHubBehavior } from '@/app/(authed-vocabulary-hub)/vocabulary/hub/vocabulary-hub-behavior';

// PC-J147 — one /auth/me per page load. Since PC-J06 the chrome's role lookup
// overlaps the page's opening reads, and staging serves requests one at a time,
// so a second /auth/me delayed what paints /d1-exercise and /vocabulary/hub.
vi.mock('client-only', () => ({}));
const mocks = vi.hoisted(() => ({
  auth: { status: 'signed-in', user: { id: 'learner-a' } },
  getCurrentUser: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('view=today'), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const profile = (role: string, extra: Record<string, unknown> = {}) => ({
  id: 'learner-a', role, d1_enabled: false, flashcard_enabled: false, vocab_curated_enabled: false, ...extra,
});
let meRole = 'admin';
let fetchMock: ReturnType<typeof vi.fn>;
const authMeCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'));

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  await import('@/public/js/components/aver-chrome.js');
});

beforeEach(() => {
  meRole = 'admin';
  const session = { access_token: 'token-a', user: { id: 'learner-a', email: 'a@example.test', user_metadata: {} } };
  Object.defineProperty(window, 'getSupabase', {
    configurable: true,
    value: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }) } }),
  });
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/auth/me')) {
      await new Promise((r) => setTimeout(r, 30)); // still in flight when the second reader asks
      return new Response(JSON.stringify(profile(meRole)), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (window as any).__averAuthMeSingleFlight;
});

function mountChrome(attrs: Record<string, string> = {}) {
  const chrome = document.createElement('aver-chrome') as any;
  for (const [k, v] of Object.entries(attrs)) chrome.setAttribute(k, v);
  document.body.appendChild(chrome);
  return () => (chrome.shadowRoot as ShadowRoot).querySelectorAll('#instructor-link').length;
}

it('D1: the page and the chrome share one /auth/me; the page state and the staff link both resolve', async () => {
  Object.defineProperty(window, 'api', { configurable: true, value: { base: 'https://api.test', get: vi.fn() } });
  const staffLinks = mountChrome();
  render(<D1ExercisePlayer />);
  expect(await screen.findByText('Tính năng chưa được bật')).toBeTruthy();
  await vi.waitFor(() => expect(staffLinks()).toBe(1));
  expect(authMeCalls()).toHaveLength(1);
});

it('D1: a learner still gets no staff link, with one /auth/me', async () => {
  meRole = 'user';
  Object.defineProperty(window, 'api', { configurable: true, value: { base: 'https://api.test', get: vi.fn() } });
  const staffLinks = mountChrome();
  render(<D1ExercisePlayer />);
  expect(await screen.findByText('Tính năng chưa được bật')).toBeTruthy();
  await new Promise((r) => setTimeout(r, 60));
  expect(staffLinks()).toBe(0);
  expect(authMeCalls()).toHaveLength(1);
});

function hubApi({ summary = async () => ({}) }: { summary?: () => Promise<unknown> } = {}) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      base: 'https://api.test',
      getWith: vi.fn(async (url: string) => (url.includes('home-summary') ? summary() : { sets: [], courses: [], cohorts: [], sessions: [] })),
    },
  });
}

it('hub: the chrome sends no /auth/me of its own and takes the staff role from the page read', async () => {
  hubApi();
  mocks.getCurrentUser.mockResolvedValue(profile('instructor'));
  const staffLinks = mountChrome({ 'role-source': 'page' });
  render(<VocabularyHubBehavior />);
  await vi.waitFor(() => expect(staffLinks()).toBe(1));
  expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1);
  expect(authMeCalls()).toHaveLength(0);
});

it('hub: a learner gets no staff link, and a failed page read leaves it unrendered (fail-closed)', async () => {
  hubApi();
  mocks.getCurrentUser.mockResolvedValueOnce(profile('user'));
  let staffLinks = mountChrome({ 'role-source': 'page' });
  render(<VocabularyHubBehavior />);
  expect(await screen.findByText(/^Chưa có bộ từ/)).toBeTruthy();
  await new Promise((r) => setTimeout(r, 60));
  expect(staffLinks()).toBe(0);
  cleanup();
  document.body.innerHTML = '';

  mocks.getCurrentUser.mockRejectedValueOnce(new Error('HTTP 500'));
  staffLinks = mountChrome({ 'role-source': 'page' });
  render(<VocabularyHubBehavior />);
  expect(await screen.findByText(/^Chưa có bộ từ/)).toBeTruthy();
  await new Promise((r) => setTimeout(r, 60));
  expect(staffLinks()).toBe(0);
  expect(authMeCalls()).toHaveLength(0);
});

it('hub: the staff role reaches the chrome even while home-summary is still pending', async () => {
  hubApi({ summary: () => new Promise(() => {}) });
  mocks.getCurrentUser.mockResolvedValue(profile('admin'));
  const staffLinks = mountChrome({ 'role-source': 'page' });
  render(<VocabularyHubBehavior />);
  await vi.waitFor(() => expect(staffLinks()).toBe(1));
  expect(authMeCalls()).toHaveLength(0);
});
