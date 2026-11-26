// PR #2711 / FR-010: a real Supabase auth notification, rather than an upload
// 401 alone, must leave both the page and its blob-owning queue alive.
import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PracticeSubmissionBridge } from '@/app/(authed-practice)/practice/session/practice-submission-bridge';
import { PracticeFullTestBridge } from '@/app/(authed-practice)/practice/session/practice-full-test-bridge';
import { PracticePageShell } from '@/app/(authed-practice)/practice/session/practice-page-shell';
import { PracticeSessionBoot } from '@/app/(authed-practice)/practice/session/practice-session-boot';
import { AuthProvider } from '@/lib/auth/auth-provider';
import { installPracticePlayerController } from '@/lib/practice-player-lifecycle.mjs';

const runtime = vi.hoisted(() => ({ router: { push: vi.fn() }, bootstrap: null as any }));
vi.mock('next/navigation', () => ({ useRouter: () => runtime.router }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/styles/av2/fonts', () => ({ av2FontClass: 'av2-fonts' }));
vi.mock('@/lib/practice-session-bootstrap.mjs', async (original) => ({
  ...await original<typeof import('@/lib/practice-session-bootstrap.mjs')>(),
  loadPracticeBootstrap: vi.fn(async () => runtime.bootstrap),
}));

const script = readFileSync('public/js/practice.js', 'utf8');
const session = (id: string) => ({ user: { id, email: null } });
let notify: (event: string, session: unknown) => void;
let player: ReturnType<typeof installPracticePlayerController>;
const win = () => window as any;
const replace = vi.fn();
const reload = vi.fn();
const submit = vi.fn();

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  replace.mockReset(); reload.mockReset(); submit.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const actualWindow = window;
  vi.stubGlobal('window', new Proxy(actualWindow, {
    get(target, key) {
      if (key === 'location') return { replace, reload, search: '?session_id=session-one', pathname: '/practice/session' };
      return Reflect.get(target, key, target);
    },
  }));
  win().__AVER_RUNTIME_CONFIG__ = { examRoomSurfaces: ['speaking'] };
  win().getSupabase = () => ({ auth: {
    getSession: async () => ({ data: { session: session('owner-A') } }),
    onAuthStateChange: (fn: typeof notify) => {
      notify = fn;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  } });
  win().api = Object.fromEntries(['get', 'post', 'getWith', 'postWith', 'uploadWith'].map((method) => [method, vi.fn(async () => [])]));
  win().PracticeRecorder = { start: vi.fn(), release: vi.fn() };
  win().PracticeSubmission = { submit, destroy: vi.fn() };
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
  // Run the whole public controller, including its exported retention method.
  new Function('window', script)(window);
  player = installPracticePlayerController(window);
  runtime.bootstrap = {
    source: 'next-native-bootstrap-v1', rendererAffinity: 'next',
    sessionId: 'session-one', userId: 'owner-A',
    sessionData: { mode: 'test_full', part: 1, responses: [] },
    questions: Array.from({ length: 9 }, (_, i) => ({ id: `question-${i}`, question_text: 'What do you enjoy doing?' })),
  };
});

afterEach(() => {
  cleanup();
  player.cleanup();
  for (const key of ['PracticeApp', 'PracticeRecorder', 'PracticeSubmission', 'PracticeFullTest', 'api', 'getSupabase', '__AVER_RUNTIME_CONFIG__']) delete win()[key];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(withSubmission = false) {
  const view = render(<StrictMode><AuthProvider>
    <PracticePageShell player={player.controller} />
    {withSubmission && <PracticeSubmissionBridge />}
    <PracticeFullTestBridge />
    <PracticeSessionBoot />
  </AuthProvider></StrictMode>);
  await waitFor(() => expect(player.controller.getStateSnapshot()).toBe('prep'));
  return view;
}

async function failedTake() {
  const controller = win().PracticeFullTest;
  const blob = new Blob(['synthetic recording'], { type: 'audio/webm' });
  submit.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }));
  await act(async () => {
    await expect(controller.submitAnswer({ sessionId: 'session-one', questionId: 'question-0', blob })).rejects.toThrow('offline');
  });
  expect(controller.getSnapshot().retryCount).toBe(1);
  return { controller, blob };
}

it('SIGNED_OUT retains a failed take and the page; signing back into A retries the identical blob', async () => {
  await mount();
  const { controller, blob } = await failedTake();
  act(() => notify('SIGNED_OUT', null));
  expect(await screen.findByRole('alertdialog')).toBeTruthy();
  expect(screen.getByText(/Unsent recordings exist only on this page/)).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(win().PracticeFullTest).toBe(controller);
  expect(controller.disposed).toBe(false);
  expect(controller.getSnapshot().retryCount).toBe(1);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);

  act(() => notify('SIGNED_IN', session('owner-A')));
  expect(win().PracticeFullTest).toBe(controller);
  submit.mockResolvedValueOnce({ id: 'synthetic-response' });
  await act(async () => { await controller.retryFailed(); });
  expect(submit.mock.calls[1][0].blob).toBe(blob);
  expect(controller.getSnapshot().retryCount).toBe(0);
  expect(replace).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('signing into B disposes A’s retained queue and reloads at the ownership boundary', async () => {
  await mount();
  const { controller } = await failedTake();
  act(() => notify('SIGNED_OUT', null));
  act(() => notify('SIGNED_IN', session('owner-B')));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(controller.disposed).toBe(true);
  expect(win().PracticeFullTest).not.toBe(controller);
  expect(submit).toHaveBeenCalledTimes(1);
  await expect(controller.retryFailed()).rejects.toMatchObject({ code: 'answers_pending' });
  expect(submit).toHaveBeenCalledTimes(1); // a disposed queue cannot send A's blob as B
});

it('unmount still disposes a retained queue and its navigation guard', async () => {
  const view = await mount();
  const { controller } = await failedTake();
  act(() => notify('SIGNED_OUT', null));
  view.unmount();
  expect(controller.disposed).toBe(true);
  expect(win().PracticeFullTest).toBeUndefined();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('with no unsent audio, SIGNED_OUT redirects and disposes as before', async () => {
  await mount();
  const controller = win().PracticeFullTest;
  act(() => notify('SIGNED_OUT', null));
  expect(replace).toHaveBeenCalledWith('/login');
  expect(controller.disposed).toBe(true);
});

it('flag off: SIGNED_OUT redirects and disposes even with a failed take', async () => {
  win().__AVER_RUNTIME_CONFIG__ = { examRoomSurfaces: [] };
  await mount();
  const { controller } = await failedTake();
  act(() => notify('SIGNED_OUT', null));
  expect(replace).toHaveBeenCalledWith('/login');
  expect(controller.disposed).toBe(true);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});


it.each(['owner-A', 'owner-B'])('lost upload response then reauthentication as %s', async (owner) => {
  const view = await mount(true);
  const submission = win().PracticeSubmission;
  const queue = win().PracticeFullTest;
  let receipt: Record<string, unknown> | undefined;
  let readbackFails = true;
  win().api.getWith.mockImplementation(async () => {
    if (receipt && readbackFails) throw new Error('session expired');
    return { submission_retry_safe: true, response_receipts: receipt ? [receipt] : [] };
  });
  win().api.uploadWith.mockImplementation(async (_path: string, form: FormData) => {
    receipt = { id: 'saved-response', question_id: 'question-0', submission_id: form.get('submission_id') };
    throw new Error('connection lost');
  });
  await act(async () => {
    await expect(queue.submitAnswer({
      sessionId: 'session-one', questionId: 'question-0', blob: new Blob(['audio'], { type: 'audio/webm' }),
    })).rejects.toMatchObject({ code: 'ambiguous_commit' });
  });
  expect(receipt?.submission_id).toEqual(expect.any(String));
  act(() => notify('SIGNED_OUT', null));
  readbackFails = false;
  act(() => notify('SIGNED_IN', session(owner)));
  if (owner === 'owner-A') {
    expect(win().PracticeSubmission).toBe(submission);
    await act(async () => { await queue.retryFailed(); });
    expect(queue.getSnapshot().retryCount).toBe(0);
  } else {
    expect(win().PracticeSubmission).not.toBe(submission);
    expect(submission.disposed).toBe(true);
    expect(queue.disposed).toBe(true);
  }
  expect(win().api.uploadWith).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(submission.disposed).toBe(true);
  expect(win().PracticeSubmission).toBeUndefined();
});
