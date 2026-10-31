import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VocabularyHubBehavior } from '@/app/(authed-vocabulary-hub)/vocabulary/hub/vocabulary-hub-behavior';
import { D1ExercisePlayer, D1_LOAD_TIMEOUT_MS } from '@/app/(authed-d1-exercise)/d1-exercise/d1-exercise-player';
import { VOCAB_GENERIC_ERROR_MESSAGE, VOCAB_NETWORK_ERROR_MESSAGE, VOCAB_READ_EMPTY_MESSAGE, VOCAB_READ_TIMEOUT_MESSAGE, VOCAB_READ_TIMEOUT_MS, messageOf } from '@/components/vocabulary-workspace';

// U-13 / V-HUB / BL-17 — a read that never settles, or settles with nothing,
// must end in a visible error with a retry instead of an endless "Đang tải".
vi.mock('client-only', () => ({}));
const mocks = vi.hoisted(() => ({ view: 'today', auth: { status: 'signed-in', user: { id: 'learner-a' } } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`view=${mocks.view}`), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: async () => ({ flashcard_enabled: false, d1_enabled: false, vocab_curated_enabled: false }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const catalog = { sets: [], courses: [], cohorts: [], sessions: [] };
const never = () => new Promise<never>(() => {});
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const elapse = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function hubApi(read: (url: string) => unknown) {
  const transport = { getWith: vi.fn(async (url: string) => url.includes('home-summary') ? {} : read(url)) };
  Object.defineProperty(window, 'api', { configurable: true, value: transport });
  return transport;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear();
  mocks.view = 'today'; history.replaceState(null, '', '/');
  delete (window as any).__averAuthMeSingleFlight; // each test is a fresh page load (PC-J147)
});

it.each(['today', 'sets', 'review'])('hub %s: a hung catalog read ends in Retry, and Retry reads again', async view => {
  mocks.view = view;
  let hang = true;
  const transport = hubApi(() => hang ? never() : catalog);
  render(<VocabularyHubBehavior />);
  await flush();
  expect(screen.queryByRole('alert')).toBeNull();
  await elapse(VOCAB_READ_TIMEOUT_MS - 1);
  expect(screen.queryByRole('alert')).toBeNull();
  await elapse(1);
  expect(screen.getByRole('alert').textContent).toContain(VOCAB_READ_TIMEOUT_MESSAGE);
  expect(screen.queryByText(/^Đang tải/)).toBeNull();
  hang = false;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await flush();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(transport.getWith.mock.calls.filter(([url]) => url === '/api/vocabulary-sets')).toHaveLength(2);
  expect(screen.getByText(view === 'review' ? 'Chưa có từ trong bộ lớp đến hạn ôn.' : /^Chưa có bộ từ/)).toBeTruthy();
});

it('hub: the abort signal reaches the transport when the deadline fires', async () => {
  const transport = hubApi(never);
  render(<VocabularyHubBehavior />);
  await elapse(VOCAB_READ_TIMEOUT_MS);
  const opts = transport.getWith.mock.calls.find(([url]) => url === '/api/vocabulary-sets')?.[2] as { signal: AbortSignal };
  expect(opts.signal.aborted).toBe(true);
});

it('hub: a null read (401 bounce or empty body) is an error with Retry, not loading', async () => {
  hubApi(async () => null);
  render(<VocabularyHubBehavior />);
  await flush();
  expect(screen.getByRole('alert').textContent).toContain(VOCAB_READ_EMPTY_MESSAGE);
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  expect(screen.queryByText('Đang tải bộ từ của bạn…')).toBeNull();
});

// PC-J148 — an offline fetch rejects with the browser's English TypeError text;
// the learner sees the Vietnamese connection line, never the raw message.
it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])('hub sets: an offline read (%s) shows the Vietnamese connection error with Retry', async raw => {
  mocks.view = 'sets';
  let offline = true;
  const transport = hubApi(async () => { if (offline) throw new TypeError(raw); return catalog; });
  render(<VocabularyHubBehavior />);
  await flush();
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain(VOCAB_NETWORK_ERROR_MESSAGE);
  expect(alert.textContent).not.toContain(raw);
  offline = false;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await flush();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(transport.getWith.mock.calls.filter(([url]) => url === '/api/vocabulary-sets')).toHaveLength(2);
});

it('messageOf: non-network TypeErrors get the generic line; HTTP and own errors keep their text', () => {
  expect(messageOf(new TypeError("Cannot read properties of undefined (reading 'sets')"))).toBe(VOCAB_GENERIC_ERROR_MESSAGE);
  expect(messageOf(Object.assign(new Error('Không tìm thấy bộ từ.'), { status: 404 }))).toBe('Không tìm thấy bộ từ.');
  expect(messageOf(new Error(VOCAB_READ_TIMEOUT_MESSAGE))).toBe(VOCAB_READ_TIMEOUT_MESSAGE);
  expect(messageOf('boom')).toBe(VOCAB_GENERIC_ERROR_MESSAGE);
});

it('hub lookup: a hung topic library read ends in Retry', async () => {
  mocks.view = 'lookup';
  hubApi(url => url === '/api/vocabulary/categories' ? never() : catalog);
  render(<VocabularyHubBehavior />);
  await elapse(VOCAB_READ_TIMEOUT_MS);
  expect(screen.getByRole('alert').textContent).toContain(VOCAB_READ_TIMEOUT_MESSAGE);
  expect(screen.queryByText('Đang tải chủ đề…')).toBeNull();
});

function d1Runtime({ getSession, me }: { getSession?: () => Promise<unknown>; me: () => Promise<Response> }) {
  const session = { access_token: 'token-a', user: { id: 'learner-a' } };
  const sb = { auth: { getSession: vi.fn(getSession || (async () => ({ data: { session }, error: null }))) } };
  Object.defineProperty(window, 'getSupabase', { configurable: true, value: () => sb });
  Object.defineProperty(window, 'api', { configurable: true, value: { get: vi.fn(), base: 'https://api.test' } });
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) return me();
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, sb };
}

it('D1: a hung /auth/me ends in the error state after the deadline and aborts the request', async () => {
  const { fetch } = d1Runtime({ me: never });
  render(<D1ExercisePlayer />);
  await elapse(D1_LOAD_TIMEOUT_MS - 1);
  expect(screen.getByText('Đang tải phiên luyện tập…')).toBeTruthy();
  await elapse(1);
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('Không tải được phiên');
  expect(alert.textContent).toContain('Tải dữ liệu quá lâu. Bạn kiểm tra kết nối mạng rồi thử lại nhé.');
  expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
  expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
});

it('D1: a stuck Supabase token read (no fetch yet) still ends in the error state', async () => {
  const { fetch } = d1Runtime({ getSession: never, me: never });
  render(<D1ExercisePlayer />);
  await elapse(D1_LOAD_TIMEOUT_MS);
  expect(screen.getByRole('alert').textContent).toContain('Tải dữ liệu quá lâu. Bạn kiểm tra kết nối mạng rồi thử lại nhé.');
  expect(fetch).not.toHaveBeenCalled();
});

it('D1: an empty /auth/me body is an error, not "feature off"', async () => {
  d1Runtime({ me: async () => new Response('', { status: 200 }) });
  render(<D1ExercisePlayer />);
  await flush();
  expect(screen.getByRole('alert').textContent).toContain('Không tải được phiên');
  expect(screen.queryByText('Tính năng chưa được bật')).toBeNull();
});

it('D1: a persistent 401 ends in the error state and bounces to /login', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, href: 'http://localhost/d1-exercise', replace });
  d1Runtime({ me: async () => new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }) });
  render(<D1ExercisePlayer />);
  await flush();
  expect(replace).toHaveBeenCalledWith('/login');
  expect(screen.getByRole('alert').textContent).toContain('Không tải được phiên');
  expect(screen.queryByText('Đang tải phiên luyện tập…')).toBeNull();
});

it('D1: a fast load clears the deadline so it cannot overwrite the start screen', async () => {
  d1Runtime({ me: async () => new Response(JSON.stringify({ d1_enabled: true }), { status: 200 }) });
  render(<D1ExercisePlayer />);
  await flush();
  expect(screen.getByRole('button', { name: 'Bắt đầu phiên mới' })).toBeTruthy();
  await elapse(D1_LOAD_TIMEOUT_MS * 2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Bắt đầu phiên mới' })).toBeTruthy();
});
