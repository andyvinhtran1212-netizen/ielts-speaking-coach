// LEARNERCORE-0063 T16 (amendment 1, FR-079): the Luyện tập hub (`practice-hub.tsx`).
// Cases from plan.md "T16": four cards in order through liveHref; only the
// "Làm tiếp" block reports a resume failure; no band or credit count on the
// cards; flag off replaces the URL with /speaking (a full document load) and
// makes no request; one account's answer is never drawn for another.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PracticeHubPage } from '@/app/(authed-v2-practice-hub)/practice/practice-hub';
import PracticePage from '@/app/(authed-v2-practice-hub)/practice/page';
import { documentNavigation } from '@/lib/tree-replace';

const learnerMe = vi.hoisted(() => ({ current: { status: 'loading', me: null } as { status: string; me: Record<string, unknown> | null } }));
vi.mock('@/components/learner/learner-frame', () => ({ useLearnerMe: () => learnerMe.current }));
const auth = vi.hoisted(() => ({ status: 'signed-in' }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));

const replace = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ replace, push: () => {} }));
vi.mock('next/navigation', () => ({
  // Stable like Next's router: a new object per render would re-run every effect.
  useRouter: () => router,
}));

function today(over: Record<string, unknown> = {}) {
  return { resume: [], degraded: [], ...over };
}

const RESUME = [{ kind: 'listening', title: 'Test 2', href: '/core-player/launch?surface=listening_test&id=lt1', progress: { done: 1, total: 4 } }];

let getWith: ReturnType<typeof vi.fn>;
let docReplace: ReturnType<typeof vi.spyOn>;

function install(fn: (...args: unknown[]) => unknown) {
  getWith = vi.fn(fn);
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post: vi.fn() } });
}

beforeEach(() => {
  auth.status = 'signed-in';
  learnerMe.current = { status: 'loading', me: null };
  docReplace = vi.spyOn(documentNavigation, 'replace').mockImplementation(() => {});
});
afterEach(() => { cleanup(); replace.mockReset(); docReplace.mockRestore(); });

it('four skill cards in the order Speaking, Writing, Listening, Reading, to the existing hubs, with no band or credit count', async () => {
  install(async () => today({ resume: RESUME }));
  render(<PracticeHubPage accountId="learner-1" />);
  const skills = screen.getByRole('region', { name: 'Kỹ năng' });
  const links = within(skills).getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['/speaking', '/writing/dashboard', '/listening', '/reading']);
  expect(links.map((link) => link.querySelector('span')?.textContent)).toEqual(['Speaking', 'Writing', 'Listening', 'Reading']);
  await screen.findByRole('region', { name: 'Làm tiếp' });
  expect(skills.textContent).not.toMatch(/band|lượt|\b7\b/i);
});

it('"Làm tiếp" lists the resume rows from Today', async () => {
  install(async () => today({ resume: RESUME }));
  render(<PracticeHubPage accountId="learner-1" />);
  const block = await screen.findByRole('region', { name: 'Làm tiếp' });
  expect(within(block).getByText('Test 2')).toBeTruthy();
  expect(within(block).getByText(/1 trên 4 phần/)).toBeTruthy();
  expect(within(block).getByRole('link', { name: 'Làm tiếp' }).getAttribute('href')).toBe(RESUME[0].href);
  expect(getWith).toHaveBeenCalledWith('/api/student/today?view=resume', undefined, expect.anything());
});

it('nothing in progress: no "Làm tiếp" block, the cards stay', async () => {
  install(async () => today());
  render(<PracticeHubPage accountId="learner-1" />);
  await waitFor(() => expect(getWith).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('main').getAttribute('aria-busy')).toBeNull());
  expect(screen.queryByRole('region', { name: 'Làm tiếp' })).toBeNull();
  expect(within(screen.getByRole('region', { name: 'Kỹ năng' })).getAllByRole('link')).toHaveLength(4);
});

it('degraded resume: only the "Làm tiếp" block reports it, with a retry; the four cards stay', async () => {
  install(async () => today({ degraded: ['resume'] }));
  render(<PracticeHubPage accountId="learner-1" />);
  const block = await screen.findByRole('region', { name: 'Làm tiếp' });
  expect(within(block).getByText('Chưa tải được bài đang làm')).toBeTruthy();
  expect(within(block).getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Kỹ năng' })).getAllByRole('link')).toHaveLength(4);
});

it('a failed read: the block reports it and "Thử lại" reloads; the cards never disappear', async () => {
  let calls = 0;
  install(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('HTTP 500'), { status: 500 });
    return today({ resume: RESUME });
  });
  render(<PracticeHubPage accountId="learner-1" />);
  const block = await screen.findByRole('region', { name: 'Làm tiếp' });
  expect(await within(block).findByText('Chưa tải được bài đang làm')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Kỹ năng' })).getAllByRole('link')).toHaveLength(4);
  fireEvent.click(within(block).getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Test 2')).toBeTruthy();
});

it('an account switch drops the previous account\'s pending answer', async () => {
  let releaseA: (value: unknown) => void = () => {};
  const signals: AbortSignal[] = [];
  install((_path: unknown, _q: unknown, opts?: unknown) => {
    const signal = (opts as { signal?: AbortSignal } | undefined)?.signal;
    if (signal) signals.push(signal);
    if (signals.length === 1) return new Promise((resolve) => { releaseA = resolve; });
    return Promise.resolve(today());
  });
  const view = render(<PracticeHubPage accountId="account-a" />);
  await waitFor(() => expect(signals.length).toBe(1));
  view.rerender(<PracticeHubPage accountId="account-b" />);
  await waitFor(() => expect(signals.length).toBe(2));
  expect(signals[0].aborted).toBe(true);
  await act(async () => { releaseA(today({ resume: [{ ...RESUME[0], title: 'A-ONLY' }] })); });
  expect(screen.queryByText('A-ONLY')).toBeNull();
});

// ── page gate (flag) ──────────────────────────────────────────────────────────

it('flag off: a full document replacement to /speaking and no Today request', async () => {
  install(async () => today());
  learnerMe.current = { status: 'ready', me: { id: 'learner-1', learner_v2_enabled: false } };
  render(<PracticePage />);
  await waitFor(() => expect(docReplace).toHaveBeenCalledWith('/speaking'));
  expect(replace).not.toHaveBeenCalled();
  expect(getWith).not.toHaveBeenCalled();
});

it('profile error: treated as flag off', async () => {
  install(async () => today());
  learnerMe.current = { status: 'error', me: null };
  render(<PracticePage />);
  await waitFor(() => expect(docReplace).toHaveBeenCalledWith('/speaking'));
  expect(getWith).not.toHaveBeenCalled();
});

it('flag on but no account id: treated as a profile error, never stuck loading', async () => {
  install(async () => today());
  learnerMe.current = { status: 'ready', me: { id: '', learner_v2_enabled: true } };
  render(<PracticePage />);
  await waitFor(() => expect(docReplace).toHaveBeenCalledWith('/speaking'));
  expect(getWith).not.toHaveBeenCalled();
});

it('profile still loading: neither the page nor a redirect yet', () => {
  install(async () => today());
  learnerMe.current = { status: 'loading', me: null };
  render(<PracticePage />);
  expect(screen.getByRole('status')).toBeTruthy();
  expect(docReplace).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(getWith).not.toHaveBeenCalled();
});

it('flag on: the hub loads for this account', async () => {
  install(async () => today({ resume: RESUME }));
  learnerMe.current = { status: 'ready', me: { id: 'learner-1', learner_v2_enabled: true } };
  render(<PracticePage />);
  expect(await screen.findByText('Test 2')).toBeTruthy();
  expect(docReplace).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});


it('a signed-out visit replaces the document with login without reading Today', () => {
  auth.status = 'signed-out';
  install(async () => today());
  render(<PracticePage />);

  expect(docReplace).toHaveBeenCalledExactlyOnceWith('/login');
  expect(replace).not.toHaveBeenCalled();
  expect(getWith).not.toHaveBeenCalled();
});

it('another tab signing out removes the learner’s practice data and sends this tab to login', async () => {
  install(async () => today({ resume: RESUME }));
  learnerMe.current = { status: 'ready', me: { id: 'learner-1', learner_v2_enabled: true } };
  const view = render(<PracticePage />);
  await screen.findByText('Test 2');

  auth.status = 'signed-out';
  view.rerender(<PracticePage />);
  expect(screen.queryByText('Test 2')).toBeNull();
  expect(docReplace).toHaveBeenCalledExactlyOnceWith('/login');
  expect(getWith).toHaveBeenCalledTimes(1);
});
