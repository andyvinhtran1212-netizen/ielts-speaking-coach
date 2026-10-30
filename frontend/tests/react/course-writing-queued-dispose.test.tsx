// PC-J353: a sender queued before dispose must not start with account B's auth.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ userId: 'student-A', status: 'signed-in' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: auth.status, user: { id: auth.userId } }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

import { CourseBehavior } from '@/app/(authed)/course-exercises/course-behavior';
import { CourseShell } from '@/app/(authed)/course-exercises/page-shell';
import { createWriting, draftKey, PUSH_DELAY_MS } from '@/public/js/course-writing.js';

const questions = [{ qid: 'E1', type: 'writing', prompt: 'Write a sentence.', subtype: 'E1' }];
const state = { questions, submitted: false, item_id: 'shared-item', draft: null };
const draftPath = '/api/quiz/course/writing/draft';
const firstText = 'Account A: first version';
const lastText = 'Account A: unsent version';

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Flush the promise chain without releasing the deliberately hanging request.
async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

beforeEach(() => {
  auth.userId = 'student-A';
  auth.status = 'signed-in';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('queued Writing autosave across dispose', () => {
  function transport() {
    const first = deferred();
    const sent: Array<{ userId: string; body: any; keepalive: boolean }> = [];
    // Both accounts are allowed to write the SAME bank/class_item. Never use
    // a simulated 403 to hide cross-account requests; every later write succeeds.
    const saved = new Map<string, unknown>([['student-B', { E1: 'B own draft' }]]);
    const post = (keepalive: boolean) => vi.fn((_path: string, body: any) => {
      const userId = auth.userId;
      sent.push({ userId, body, keepalive });
      const result = sent.length === 1 ? first.promise : Promise.resolve({});
      return result.then(() => { saved.set(userId, body.answers); return {}; });
    });
    const api = {
      get: vi.fn(async () => state), post: post(false), postWith: post(true),
    };
    return { api, first, sent, saved };
  }

  async function queued() {
    vi.useFakeTimers();
    const transportState = transport();
    const writing = createWriting({ api: transportState.api, storage: window.localStorage, userId: auth.userId });
    await writing.load('shared-bank', 'shared-item');
    writing.write('E1', firstText);
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS);
    expect(transportState.sent).toHaveLength(1);
    writing.write('E1', lastText);
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS);
    expect(transportState.sent).toHaveLength(1); // Second send is queued, not a pending timer.
    return { writing, ...transportState };
  }

  it.each(['resolve', 'reject'] as const)('drops a queued send after dispose when the first autosave %ss', async (outcome) => {
    const { writing, first, sent } = await queued();
    writing.dispose();
    auth.userId = 'student-B';
    if (outcome === 'resolve') first.resolve({});
    else first.reject(new Error('autosave failed'));
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS * 2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: 'student-A', body: { answers: { E1: firstText } } });
  });

  it('protects B even when B can save the same bank and class_item', async () => {
    const { writing, first, api, sent, saved } = await queued();
    writing.dispose();
    auth.userId = 'student-B';
    const b = createWriting({ api, storage: window.localStorage, userId: auth.userId });
    await b.load('shared-bank', 'shared-item');
    expect(b.draft).toEqual({});
    first.reject(new Error('A first autosave failed'));
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS * 2);
    expect(sent.filter((request) => request.userId === 'student-B')).toEqual([]);
    expect(saved.get('student-B')).toEqual({ E1: 'B own draft' });

    // Prove B is authorized in this fixture, and can still save their own work.
    b.write('E1', 'B own revision');
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS);
    expect(saved.get('student-B')).toEqual({ E1: 'B own revision' });
    expect(sent[1]).toMatchObject({ userId: 'student-B', body: {
      bank_id: 'shared-bank', class_item: 'shared-item', answers: { E1: 'B own revision' },
    } });
    expect(window.localStorage.getItem(draftKey('shared-bank', 'student-A', 'shared-item')))
      .toBe(JSON.stringify({ E1: lastText }));
    b.dispose();
  });

  it('creates page-leave keepalive immediately while an autosave is hanging', async () => {
    const { writing, first, sent } = await queued();
    const flushing = writing.flushDraft();
    expect(sent).toHaveLength(2); // No await: request must exist before page closes.
    expect(sent[1]).toMatchObject({ keepalive: true, body: { answers: { E1: lastText } } });
    writing.dispose();
    await flushing;
    first.reject(new Error('in-flight autosave failed during leave'));
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS * 2);
    expect(sent).toHaveLength(2);
  });

  it('still sends the queued latest draft without disposal', async () => {
    const { writing, first, sent } = await queued();
    first.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ userId: 'student-A', body: { answers: { E1: lastText } } });
    writing.dispose();
  });
});

describe('Writing cleanup reason in the actual course behavior', () => {
  async function openPage() {
    const api = {
      get: vi.fn(async (path: string) => {
        if (path.includes('/course-resume')) return { session_id: null, answered: [], completed: [], item_id: null };
        if (path.startsWith('/api/quiz/course/writing')) return state;
        return { bank: { id: 'shared-bank', title: 'Writing' }, questions };
      }),
      post: vi.fn(async (_path: string, _body: unknown) => ({})),
      postWith: vi.fn(async (_path: string, _body: unknown, _headers: unknown, _options: unknown) => ({})),
    };
    (window as unknown as { api: unknown }).api = api;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.history.replaceState({}, '', '/course-exercises?bank=shared-bank');
    const view = render(<><CourseShell /><CourseBehavior /></>);
    await waitFor(() => expect(document.querySelector('.cw-write')).not.toBeNull());
    // Listeners are installed just after the form renders.
    await settle();
    vi.useFakeTimers();
    fireEvent.input(document.querySelector('.cw-write')!, { target: { value: lastText } });
    return { view, api };
  }

  it.each(['student-B', 'initial-loading'])('does not flush A with changed auth (%s)', async (next) => {
    const { view, api } = await openPage();
    if (next === 'initial-loading') {
      // initial-loading also tears down the signed-in effect, without invoking
      // jsdom's unimplemented location.replace for the redirect effect.
      auth.status = 'initial-loading';
    } else auth.userId = next;
    view.rerender(<><CourseShell /><CourseBehavior /></>);
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS * 2);
    const writes = [...api.post.mock.calls, ...api.postWith.mock.calls]
      .filter(([path]) => path === draftPath);
    expect(writes).toEqual([]);
    expect(window.localStorage.getItem(draftKey('shared-bank', 'student-A', 'shared-item')))
      .toBe(JSON.stringify({ E1: lastText }));
  });

  it.each(['pagehide', 'soft-navigation'])('still flushes immediately for %s with the same account', async (reason) => {
    const { view, api } = await openPage();
    if (reason === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    else view.unmount();
    expect(api.postWith).toHaveBeenCalledWith(draftPath, {
      bank_id: 'shared-bank', class_item: 'shared-item', answers: { E1: lastText },
    }, null, { keepalive: true });
  });
});
