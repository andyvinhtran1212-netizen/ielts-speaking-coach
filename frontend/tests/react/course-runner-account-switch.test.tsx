// PC-J362 (CR P3-1/P3-2 on #2056, CR P3 on #2049): quiz answers account A
// queued in course-runner.js must never be sent once account B owns the auth.
//
// The cleanup used to call `runner.leave()` for every reason. That keepalive
// flush takes `api.js` `_lastToken` (or a fresh getSession), which after an
// account switch is B's token. A queued `inflight.then(flush)` behind a hanging
// batch, or a timed retry timer, also starts its request AFTER the switch.
// A disposed runner sends nothing; A's rows stay in A's own outbox key and are
// replayed the next time A opens the bank.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ userId: 'student-A', status: 'signed-in' }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: auth.status, user: { id: auth.userId } }),
}));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

import { CourseBehavior } from '@/app/(authed)/course-exercises/course-behavior';
import { CourseShell } from '@/app/(authed)/course-exercises/page-shell';
import { createRunner } from '@/public/js/course-runner.js';

type Sent = { userId: string; status: string; path: string; body: any; keepalive: boolean };

function mcq(i: number) {
  return { qid: `Q${i}`, type: 'mcq', subtype: 'A1', skill: 'X', item_key: `k${i}`,
    prompt: `Câu ${i}?`, options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', points: 1 };
}
const questions = Array.from({ length: 10 }, (_, i) => mcq(i + 1));
const progress = (path: string) => /\/api\/quiz\/sessions\/[^/]+\/progress$/.test(path);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Flush promise chains without releasing a deliberately hanging request.
async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** Who is signed in when each request STARTS — that is whose token it takes. */
function transport({ mastery = null as any, hangFirstProgress = false } = {}) {
  const sent: Sent[] = [];
  const first = deferred<unknown>();
  let progressCalls = 0;
  const record = (keepalive: boolean) => vi.fn(async (path: string, body: any) => {
    sent.push({ userId: auth.userId, status: auth.status, path, body, keepalive });
    if (path === '/api/quiz/sessions') return { id: `sess-${auth.userId}` };
    if (progress(path)) {
      progressCalls += 1;
      if (hangFirstProgress && progressCalls === 1) await first.promise;
      return { ok: true, attempts: body.attempts.length };
    }
    return {};
  });
  const api = {
    get: vi.fn(async (path: string) => {
      if (path.includes('/course-resume')) return { session_id: null, answered: [], completed: [], item_id: null };
      if (path.includes('/course-timer')) return { item_id: null, timer: mastery };
      if (path.startsWith('/api/quiz/course/writing')) return { questions: [], submitted: false, item_id: null, draft: null };
      return { bank: { id: 'shared-bank', title: 'Buổi 1' }, questions, mastery };
    }),
    post: record(false),
    postWith: record(true),
    patch: vi.fn(async (path: string, body: any) => {
      sent.push({ userId: auth.userId, status: auth.status, path, body, keepalive: false });
      return {};
    }),
  };
  const progressOf = (userId: string) => sent.filter((r) => progress(r.path) && r.path.includes(`sess-${userId}`));
  return { api, sent, first, progressOf };
}

/** A request with A's quiz rows that starts while someone else is signed in. */
const leakedRows = (sent: Sent[]) => sent.filter((r) => progress(r.path)
  && r.path.includes('sess-student-A') && !(r.userId === 'student-A' && r.status === 'signed-in'));

const outboxRowsOf = (userId: string) => Object.keys(window.localStorage)
  .filter((key) => key.startsWith('cx-outbox:') && key.includes(JSON.stringify(userId)));

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

describe('course-runner.js dispose()', () => {
  async function loaded(options: Parameters<typeof transport>[0] = {}) {
    const wire = transport(options);
    const runner = createRunner({ api: wire.api, storage: window.localStorage, userId: auth.userId });
    await runner.load('shared-bank');
    return { runner, ...wire };
  }
  async function answer(runner: any, n: number) {
    for (let i = 0; i < n; i += 1) { await runner.answer(0); runner.next(); runner.show(); }
  }

  it('drops a flush queued behind a hanging batch once the runner is disposed', async () => {
    const { runner, sent, first } = await loaded({ hangFirstProgress: true });
    await answer(runner, 10); // batch 1 hangs, batch 2 is chained behind it
    expect(sent.filter((r) => progress(r.path))).toHaveLength(1);

    runner.dispose();
    auth.userId = 'student-B';
    first.resolve({});
    await settle();

    expect(leakedRows(sent)).toEqual([]);
    expect(sent.filter((r) => progress(r.path))).toHaveLength(1);
    // Batch 2 is not lost: it stays in A's outbox for A's next visit.
    expect(outboxRowsOf('student-A')).toHaveLength(5);
  });

  it('a disposed runner leave()s, sync()s and finishes a stage without any request', async () => {
    const { runner, sent } = await loaded();
    await answer(runner, 2);
    runner.dispose();
    auth.userId = 'student-B';

    await runner.leave();
    await expect(runner.sync()).rejects.toThrow();
    const result = await runner.finishStage();
    // The time-cap PATCH skips flush() but carries every queued attempt.
    const timeCap = await runner.finishStage({ endedBy: 'time_cap' });

    expect(result.persisted).toBe(false);
    expect(timeCap.persisted).toBe(false);
    expect(sent.filter((r) => r.userId === 'student-B')).toEqual([]);
    expect(outboxRowsOf('student-A')).toHaveLength(2);
  });

  it('a timed retry scheduled before dispose does not fire a request after it', async () => {
    vi.useFakeTimers();
    const mastery = { is_timed: true, time_remaining_seconds: 600, expires_at: null, item_id: null };
    const wire = transport({ mastery });
    let failNext = true;
    const post = wire.api.post;
    wire.api.post = vi.fn(async (path: string, body: any) => {
      if (progress(path) && failNext) {
        failNext = false;
        wire.sent.push({ userId: auth.userId, status: auth.status, path, body, keepalive: false });
        throw new Error('network');
      }
      return post(path, body);
    });
    const runner = createRunner({ api: wire.api, storage: window.localStorage, userId: auth.userId, random: () => 0 });
    await runner.load('shared-bank');
    await runner.answer(0); // timed: pushes at once and fails → retry timer
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.sent.filter((r) => progress(r.path))).toHaveLength(1);

    runner.dispose();
    auth.userId = 'student-B';
    await vi.advanceTimersByTimeAsync(10_000);

    expect(leakedRows(wire.sent)).toEqual([]);
    expect(outboxRowsOf('student-A')).toHaveLength(1);
  });

  it('without dispose the queued batch and leave() still send (negative control)', async () => {
    const { runner, sent, first } = await loaded({ hangFirstProgress: true });
    await answer(runner, 10);
    first.resolve({});
    await settle();
    expect(sent.filter((r) => progress(r.path) && !r.keepalive)).toHaveLength(2);

    const again = await loaded();
    await answer(again.runner, 2);
    await again.runner.leave();
    expect(again.sent.filter((r) => progress(r.path) && r.keepalive)).toHaveLength(1);
    expect(again.sent.at(-1)!.body.attempts).toHaveLength(2);
  });
});

describe('quiz queue cleanup reason in the actual course behavior', () => {
  async function aAnsweredOne() {
    const wire = transport();
    (window as unknown as { api: unknown }).api = wire.api;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    window.history.replaceState({}, '', '/course-exercises?bank=shared-bank');
    const view = render(<><CourseShell /><CourseBehavior /></>);
    await waitFor(() => expect(document.querySelector('.cx-opt')).not.toBeNull());
    await settle(); // listeners are installed right after the first question renders
    fireEvent.click(document.querySelector('.cx-opt')!);
    await waitFor(() => expect(outboxRowsOf('student-A')).toHaveLength(1));
    // One answer stays queued (< BATCH): only a flush on leave would send it.
    expect(wire.sent.filter((r) => progress(r.path))).toEqual([]);
    return { view, ...wire };
  }

  const rerender = (view: ReturnType<typeof render>) => view.rerender(<><CourseShell /><CourseBehavior /></>);

  it('switching to B in another tab (status stays signed-in) sends none of A\'s answers', async () => {
    const { view, sent } = await aAnsweredOne();
    auth.userId = 'student-B';
    rerender(view);
    await waitFor(() => expect(sent.some((r) => r.path === '/api/quiz/sessions' && r.userId === 'student-B')).toBe(true));
    await settle();

    expect(leakedRows(sent)).toEqual([]);
    expect(sent.filter((r) => progress(r.path))).toEqual([]);
    expect(outboxRowsOf('student-A')).toHaveLength(1);
  });

  // P3-2: signed-in → initial-loading sets the account ref to null before the
  // cleanup runs; it must be treated as "not A any more", like a switch.
  it('signed-in → initial-loading (ref = null) sends none of A\'s answers, also after B signs in', async () => {
    const { view, sent } = await aAnsweredOne();
    auth.status = 'initial-loading';
    rerender(view);
    await settle();
    expect(sent.filter((r) => progress(r.path))).toEqual([]);

    auth.userId = 'student-B';
    auth.status = 'signed-in';
    rerender(view);
    await waitFor(() => expect(sent.some((r) => r.path === '/api/quiz/sessions' && r.userId === 'student-B')).toBe(true));
    await settle();

    expect(leakedRows(sent)).toEqual([]);
    expect(outboxRowsOf('student-A')).toHaveLength(1);
  });

  it.each(['pagehide', 'soft-navigation'])('still flushes A\'s queued answer for %s with the same account', async (reason) => {
    const { view, api } = await aAnsweredOne();
    if (reason === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    else view.unmount();
    const keepalive = api.postWith.mock.calls.filter(([path]) => progress(path));
    expect(keepalive).toHaveLength(1);
    expect(keepalive[0][0]).toBe('/api/quiz/sessions/sess-student-A/progress');
    expect(keepalive[0][1].attempts).toHaveLength(1);
  });
});
