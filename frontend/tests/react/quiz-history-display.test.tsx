import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { QuizProgressBehavior } from '@/app/(authed-quiz-progress)/quiz/progress/quiz-progress-behavior';
import wire from '../fixtures/grammar-history-public-wire.json';

const owner = vi.hoisted(() => ({ user: { id: 'history-fixture-user' }, params: new URLSearchParams('skill_area=grammar') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => owner.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: owner.user }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
const progress = wire.requests[0].response as any;
const mistakes = wire.requests[1].response as any;
const clone = <T,>(value: T): T => structuredClone(value);
beforeEach(() => {
  owner.user = { id: 'history-fixture-user' }; owner.params = new URLSearchParams('skill_area=grammar');
  Object.assign(window, { api: {
    getWith: vi.fn(async (url: string) => clone(url.includes('/mistakes') ? mistakes : progress)),
    post: vi.fn(), postWith: vi.fn(), patch: vi.fn(), patchWith: vi.fn(),
  } });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function noWrites() {
  for (const method of ['post', 'postWith', 'patch', 'patchWith'] as const) expect(window.api[method]).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}
function expectOwnQuestions() {
  const cards = document.querySelectorAll('.pg-mk');
  expect(cards.length).toBe(mistakes.items.length);
  mistakes.items.forEach((item: any, index: number) => {
    const card = cards[index];
    fireEvent.click(card.querySelector('button')!);
    for (const q of item.questions) {
      const text = card.textContent || '';
      expect(text).toContain(q.prompt.replaceAll('**', ''));
      expect(text).toContain(q.your_answer); expect(text).toContain(q.correct_answer);
      expect(card.querySelector('a')?.getAttribute('href')).toBe(q.article_url);
    }
  });
}

it('renders captured original and corrected stems/keys/results separately; hides physical codes in every label without mutating payloads', async () => {
  const before = JSON.stringify(wire);
  render(<QuizProgressBehavior />); await screen.findByRole('heading', { name: 'Phiên gần đây' });
  await waitFor(() => expect(document.querySelectorAll('.pg-mk').length).toBe(2));
  expectOwnQuestions();
  const text = document.querySelector('main')!.textContent!;
  for (const bank of progress.banks) {
    expect(text).toContain(bank.title); expect(text).not.toContain(bank.code);
  }
  for (const node of document.querySelectorAll('[aria-label]')) expect(node.getAttribute('aria-label')).not.toContain('~');
  expect(document.querySelectorAll('.pg-track[aria-label="Tiến độ Quick Check — Present Simple"]').length).toBe(2);
  expect(document.querySelectorAll('td[data-label="Bộ"]')[0].textContent).toBe('Quick Check — Present Simple');
  expect(document.querySelectorAll('td[data-label="Chính xác"]')[0].textContent).toBe(`${Math.round(progress.recent_sessions[0].accuracy * 100)}%`);
  expect(JSON.stringify(wire)).toBe(before); noWrites();
});

it('known-managed missing history is unavailable rather than empty; mistakes retry preserves loaded totals and performs only the owned read', async () => {
  let attempts = 0;
  window.api.getWith = vi.fn(async (url: string) => {
    if (url.includes('/mistakes') && ++attempts === 1) throw Object.assign(new Error('Unavailable'), { status: 503, data: wire.requests[2].response });
    return clone(url.includes('/mistakes') ? mistakes : progress);
  });
  render(<QuizProgressBehavior />);
  await screen.findByText('Chưa tải được câu cần ôn'); await screen.findByRole('heading', { name: 'Phiên gần đây' });
  expect(screen.queryByText('Chưa có câu nào cần ôn')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(document.querySelectorAll('.pg-mk').length).toBe(2));
  expect((window.api.getWith as any).mock.calls.filter(([url]: [string]) => url.includes('/progress')).length).toBe(1);
  expect((window.api.getWith as any).mock.calls.filter(([url]: [string]) => url.includes('/mistakes')).length).toBe(2);
  expectOwnQuestions(); noWrites();
});

it('remount reads the same owned immutable history with no admission, progress, end or reset', async () => {
  const view = render(<QuizProgressBehavior />); await screen.findByRole('heading', { name: 'Phiên gần đây' });
  view.unmount(); render(<QuizProgressBehavior />); await screen.findByRole('heading', { name: 'Phiên gần đây' });
  await waitFor(() => expect(document.querySelectorAll('.pg-mk').length).toBe(2));
  expectOwnQuestions(); expect(window.api.getWith).toHaveBeenCalledTimes(4); noWrites();
});

it('an old account’s held history cannot appear after the new owner’s failed read', async () => {
  const pending: ((value: unknown) => void)[] = [];
  window.api.getWith = vi.fn(() => owner.user.id === 'history-fixture-user'
    ? new Promise((resolve) => pending.push(resolve)) : Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })));
  const view = render(<QuizProgressBehavior />); await waitFor(() => expect(pending.length).toBe(2));
  owner.user = { id: 'another-owner' }; view.rerender(<QuizProgressBehavior />);
  await screen.findByText('Chưa tải được thống kê');
  await act(async () => { pending[0](progress); pending[1](mistakes); });
  expect(screen.queryByRole('heading', { name: 'Phiên gần đây' })).toBeNull();
  expect(document.querySelectorAll('.pg-mk').length).toBe(0); noWrites();
});

// Actual existing shared API: controlled promise + navigation observer, not HTTP.
describe('history GET ownership through actual shared transport', () => {
  const scope = owner;
  const shared = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../public/js/api.js'), 'utf8');
  let redirects: { method: string; value: string }[];
  let fetched: { path: string; method: string; signal: AbortSignal; dispatched: boolean }[];
  let release: ((value: Response) => void) | undefined;
  let target: 'progress' | 'mistakes';
  let held = false;
  let tokenHold = false;
  let tokenWaiters: ((value: unknown) => void)[];
  const fresh = (kind: string) => {
    // An isolated owner contrast, preserving actual questions/answers/results.
    // This renamed display title is not an approved-bank/source publication proof.
    const value = clone(kind === 'progress' ? progress : mistakes);
    for (const item of value.banks || value.items || []) item.title = 'FRESH_OWN_HISTORY';
    return value;
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  beforeEach(() => {
    scope.user = { id: 'owner-a' }; scope.params = new URLSearchParams('skill_area=grammar');
    redirects = []; fetched = []; release = undefined; held = false; tokenHold = false; tokenWaiters = [];
    const location = {
      hostname: 'history-fixture.invalid', pathname: '/quiz/progress',
      get href() { return 'https://history-fixture.invalid/quiz/progress?skill_area=grammar'; },
      set href(value: string) { redirects.push({ method: 'href', value }); },
      replace(value: string) { redirects.push({ method: 'replace', value }); },
    };
    const domWindow = window;
    const proxy = new Proxy(domWindow, { get(object, key, receiver) { return key === 'location' ? location : Reflect.get(object, key, receiver); } });
    vi.stubGlobal('window', proxy);
    Object.assign(window, {
      __AVER_RUNTIME_CONFIG__: { apiBase: 'https://history-fixture.invalid' },
      __AVER_SUPABASE_CLIENT__: { auth: { getSession: () => {
        const value = { data: { session: { access_token: `synthetic-${scope.user.id}`, user: { id: scope.user.id } } } };
        return tokenHold ? new Promise((resolve) => tokenWaiters.push(resolve)) : Promise.resolve(value);
      } } },
    });
    const fetch = async (url: string, options: { method: string; signal: AbortSignal }) => {
      const path = new URL(url).pathname, kind = path.endsWith('/progress') ? 'progress' : 'mistakes';
      fetched.push({ path, method: options.method, signal: options.signal, dispatched: !options.signal.aborted });
      // Native fetch rejects an already-aborted signal before HTTP dispatch.
      // This case records the invocation separately from an outgoing request.
      if (options.signal.aborted) throw new DOMException('Pre-aborted', 'AbortError');
      if (!held && kind === target) { held = true; return new Promise<Response>((resolve) => { release = resolve; }); }
      return json(fresh(kind));
    };
    // Exact existing shared transport. Controlled fetch promise and location
    // navigation seam only; no HTTP/browser/auth/RLS/PG execution.
    vm.runInNewContext(shared, { window, fetch, console });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function transition(view: ReturnType<typeof render>, kind: string) {
    if (kind === 'unmount') { view.unmount(); return; }
    if (kind === 'account') scope.user = { id: 'owner-b' };
    else scope.params = new URLSearchParams('skill_area=vocab');
    if (kind === 'ABA') {
      // Both owner generations must commit; batching B→A into one render is an
      // active A request, not a stale-response counterexample.
      flushSync(() => view.rerender(<QuizProgressBehavior />));
      scope.params = new URLSearchParams('skill_area=grammar');
      flushSync(() => view.rerender(<QuizProgressBehavior />));
    } else view.rerender(<QuizProgressBehavior />);
  }
  function writes() { return fetched.filter((r) => r.method !== 'GET').length; }

  for (const endpoint of ['progress', 'mistakes'] as const) {
    it(`${endpoint}: active fulfilled401 keeps existing login navigation`, async () => {
      target = endpoint; render(<QuizProgressBehavior />); await waitFor(() => expect(release).toBeDefined());
      await act(async () => { release!(json({ detail: 'Controlled unauthorized' }, 401)); });
      const pass = redirects.length === 1 && redirects[0].method === 'href' && redirects[0].value === '/login' && writes() === 0;
      expect(pass).toBe(true);
    });
    it(`${endpoint}: active403 keeps the ordinary visible error without login or business writes`, async () => {
      target = endpoint; render(<QuizProgressBehavior />); await waitFor(() => expect(release).toBeDefined());
      await act(async () => { release!(json({ detail: 'Controlled forbidden' }, 403)); });
      await waitFor(() => expect(document.querySelector('.pg-state.is-error')).not.toBeNull());
      const error = document.querySelector('.pg-state.is-error')!.textContent || '';
      const pass = redirects.length === 0 && writes() === 0 && error.includes(endpoint === 'progress' ? 'Chưa tải được thống kê' : 'Chưa tải được câu cần ôn');
      expect(pass).toBe(true);
    });
    for (const change of ['account', 'filter', 'unmount', 'ABA']) {
      it(`${endpoint}: fulfilled old401 cannot redirect after ${change}`, async () => {
        target = endpoint; const view = render(<QuizProgressBehavior />); await waitFor(() => expect(release).toBeDefined());
        const signal = fetched.find((r) => r.path.endsWith(`/${endpoint}`))!.signal;
        const abortedAtFulfillment = signal.aborted;
        // Fulfill first, then dispose. Aborting the old fetch cannot un-fulfill
        // its promise; this is the same real transport ordering as Root's RED.
        await act(async () => { release!(json({ detail: 'Controlled old unauthorized' }, 401)); transition(view, change); });
        const pass = redirects.length === 0 && writes() === 0;
        expect(abortedAtFulfillment).toBe(false);
        expect(signal.aborted).toBe(true);
        expect(pass).toBe(true);
      });
      it(`${endpoint}: fulfilled old200 cannot publish after ${change}`, async () => {
        target = endpoint; const view = render(<QuizProgressBehavior />); await waitFor(() => expect(release).toBeDefined());
        await act(async () => { release!(json(endpoint === 'progress' ? progress : mistakes)); transition(view, change); });
        if (change !== 'unmount') await waitFor(() => expect(document.querySelector(endpoint === 'progress' ? '.pg-bank__name' : '.pg-mk__head')).not.toBeNull());
        const labels = [...document.querySelectorAll(endpoint === 'progress' ? '.pg-bank__name' : '.pg-mk__head')].map((r) => r.textContent || '');
        const pass = redirects.length === 0 && writes() === 0 && (change === 'unmount' ? labels.length === 0 : labels.length === 2 && labels.every((label) => label.includes('FRESH_OWN_HISTORY')));
        expect(pass).toBe(true);
      });
      it(`${endpoint}: fulfilled old403 cannot publish an error after ${change}`, async () => {
        target = endpoint; const view = render(<QuizProgressBehavior />); await waitFor(() => expect(release).toBeDefined());
        await act(async () => { release!(json({ detail: 'Controlled old forbidden' }, 403)); transition(view, change); });
        if (change !== 'unmount') await waitFor(() => expect(document.querySelector(endpoint === 'progress' ? '.pg-bank__name' : '.pg-mk__head')).not.toBeNull());
        const labels = [...document.querySelectorAll(endpoint === 'progress' ? '.pg-bank__name' : '.pg-mk__head')].map((r) => r.textContent || '');
        const pass = redirects.length === 0 && writes() === 0 && !document.querySelector('.pg-state.is-error') && (change === 'unmount' ? labels.length === 0 : labels.length === 2 && labels.every((label) => label.includes('FRESH_OWN_HISTORY')));
        expect(pass).toBe(true);
      });
    }
    it(`${endpoint}: delayed token after unmount has only pre-aborted fetch invocations and no outgoing request/write`, async () => {
      target = endpoint; tokenHold = true; const view = render(<QuizProgressBehavior />); await waitFor(() => expect(tokenWaiters.length).toBe(2));
      view.unmount();
      await act(async () => { for (const resolve of tokenWaiters) resolve({ data: { session: { access_token: 'late-token' } } }); });
      const outgoing = fetched.filter((r) => r.dispatched).length;
      const pass = fetched.length === 2 && outgoing === 0 && redirects.length === 0 && writes() === 0;
      expect(pass).toBe(true);
    });
  }
  it('unmount while readiness is settling prevents both initial GET dispatches', async () => {
    target = 'progress';
    const getWith = vi.spyOn(window.api, 'getWith');
    const view = render(<QuizProgressBehavior />);
    view.unmount();
    await act(async () => {});
    expect(getWith).not.toHaveBeenCalled();
    expect(fetched).toHaveLength(0);
    expect(redirects).toHaveLength(0);
  });
});
