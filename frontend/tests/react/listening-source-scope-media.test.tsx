import { Activity, StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useListeningSource } from '@/lib/use-listening-source';
import { ProgrammeResult } from '@/app/(authed-listening-review)/listening/programmes/result/[attemptId]/programme-result';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'account-a' } as { id: string } | null }));
const route = vi.hoisted(() => ({ params: new URLSearchParams('from=general&filter=in_progress') }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useSearchParams: () => route.params }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
function deferred<T = unknown>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const hookCommits: string[] = [];
function HookProbe({ path }: { path: string }) {
  const { state, retry } = useListeningSource<{ label: string }>(path);
  const visible = state.status === 'ready' ? `ready:${state.data.label}` : state.status === 'error' ? `error:${state.code}` : 'loading';
  // Layout phase sees the very first committed render before passive reset effects.
  useLayoutEffect(() => { hookCommits.push(visible); });
  return <><output data-testid="hook-state">{visible}</output><button onClick={retry}>Retry scope</button></>;
}
const resultCommits: Array<{ text: string; hrefs: string[]; audioSrc: string | null }> = [];
function ResultCommitProbe({ children }: { children: ReactNode }) {
  useLayoutEffect(() => { const main = document.querySelector('.programme-result'); resultCommits.push({ text: main?.textContent || '', hrefs: Array.from(main?.querySelectorAll('a') || []).map((a) => a.getAttribute('href') || ''), audioSrc: main?.querySelector('audio')?.getAttribute('src') || null }); });
  return children;
}
function resultPayload(label: string, source = false, window: unknown = { start: 2, end: 4 }) {
  return { title: `${label}_TITLE`, programme_id: source ? 'ielts-80-days-listening' : 'general-listening-practice', scoring_policy: 'report_only', audio_url: `/${label}.mp3`, replay_policy: 'allowed', audio_granularity: source ? 'whole_day' : 'question', result_summary: { item_count: 1 },
    review: [{ q_num: 1, question_type: 'written', state: 'unscored', prompt: `${label}_PROMPT`, user_answer: `${label}_FINAL`, first_answer: `${label}_FIRST`, audio_window: window, audio_granularity: source ? 'whole_day' : 'question', explanation: { answer: `${label}_REFERENCE`, why_vi: `${label}_WHY`, evidence: [] } }],
    controlled_transcripts: { transcript: [{ text: `${label}_TRANSCRIPT` }] } };
}
beforeEach(() => {
  auth.status = 'signed-in'; auth.user = { id: 'account-a' }; hookCommits.length = 0; resultCommits.length = 0;
  route.params = new URLSearchParams('from=general&filter=in_progress');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.assign(window, { api: { getWith: vi.fn(), postWith: vi.fn(), patchWith: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['account', 'path', 'retry', 'status'] as const)('hides prior ready AND error hook slots in the first layout commit on %s change', async (boundary) => {
  for (const initial of ['ready', 'error']) {
    auth.status = 'signed-in'; auth.user = { id: 'account-a' }; const next = deferred();
    window.api.getWith = vi.fn().mockImplementationOnce(async () => { if (initial === 'error') throw { status: 404 }; return { label: 'OLD_PERSONAL_PROGRESS' }; }).mockImplementation(() => next.promise);
    const view = render(<HookProbe path="/source/day/1" />);
    await screen.findByText(initial === 'ready' ? 'ready:OLD_PERSONAL_PROGRESS' : 'error:404'); hookCommits.length = 0;
    if (boundary === 'account') auth.user = { id: 'account-b' };
    if (boundary === 'status') auth.status = 'loading';
    if (boundary === 'retry') fireEvent.click(screen.getByRole('button', { name: 'Retry scope' }));
    else view.rerender(<HookProbe path={boundary === 'path' ? '/source/day/2' : '/source/day/1'} />);
    expect(hookCommits[0]).toBe('loading'); expect(screen.getByTestId('hook-state').textContent).toBe('loading');
    view.unmount();
  }
});

it.each(['success', 'error'] as const)('rejects delayed old hook %s after new account/path wins', async (outcome) => {
  const old = deferred(); const current = deferred(); window.api.getWith = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
  const view = render(<HookProbe path="/source/day/1" />); await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(1));
  const signal = (window.api.getWith as ReturnType<typeof vi.fn>).mock.calls[0][2].signal;
  auth.user = { id: 'account-b' }; view.rerender(<HookProbe path="/source/day/2" />);
  await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(2)); expect(signal.aborted).toBe(true);
  await act(async () => { current.resolve({ label: 'CURRENT_SCOPE' }); });
  await act(async () => { if (outcome === 'success') old.resolve({ label: 'OLD_SCOPE' }); else old.reject({ status: 404 }); });
  expect(screen.getByTestId('hook-state').textContent).toBe('ready:CURRENT_SCOPE');
});

it.each(['account', 'attempt', 'status'].flatMap((boundary) => ['resolve', 'reject'].map((outcome) => [boundary, outcome])))('resets result/media before passive effects on %s and ignores old play %s', async (boundary, outcome) => {
  window.api.getWith = vi.fn(async () => resultPayload('OLD'));
  const view = render(<ResultCommitProbe><ProgrammeResult attemptId="attempt-a" /></ResultCommitProbe>);
  await screen.findByRole('heading', { name: 'OLD_TITLE' });
  const oldAudio = document.querySelector('audio')!; const removeListener = vi.spyOn(oldAudio, 'removeEventListener');
  const oldPlay = deferred<void>(); vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => oldPlay.promise);
  fireEvent.click(screen.getByRole('button', { name: /Nghe đoạn liên quan/ }));
  const next = deferred(); window.api.getWith = vi.fn(() => next.promise); resultCommits.length = 0;
  if (boundary === 'account') auth.user = { id: 'account-b' };
  if (boundary === 'status') auth.status = 'loading';
  const attempt = boundary === 'attempt' ? 'attempt-b' : 'attempt-a';
  view.rerender(<ResultCommitProbe><ProgrammeResult attemptId={attempt} /></ResultCommitProbe>);
  expect(resultCommits[0].text).not.toContain('OLD_'); expect(resultCommits[0].hrefs).toEqual([]); expect(resultCommits[0].audioSrc).toBeNull();
  expect(oldAudio.isConnected).toBe(false); expect(oldAudio.getAttribute('src')).toBeNull();
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).toContain(oldAudio);
  expect(vi.mocked(HTMLMediaElement.prototype.load).mock.contexts).toContain(oldAudio);
  expect(removeListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
  if (boundary === 'status') { auth.status = 'signed-in'; view.rerender(<ResultCommitProbe><ProgrammeResult attemptId={attempt} /></ResultCommitProbe>); }
  await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(1));
  await act(async () => { next.resolve(resultPayload('CURRENT')); }); await screen.findByRole('heading', { name: 'CURRENT_TITLE' });
  const currentAudio = document.querySelector('audio')!; const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length;
  oldAudio.currentTime = 999; fireEvent(oldAudio, new Event('timeupdate'));
  await act(async () => { if (outcome === 'reject') oldPlay.reject(new Error('old playback unavailable')); else oldPlay.resolve(undefined); });
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls).toHaveLength(pauses);
  expect(currentAudio.getAttribute('src')).toBe('/CURRENT.mp3'); expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/OLD_/)).toBeNull();
});

it('rejects a delayed old result response after account and attempt replacement', async () => {
  const old = deferred(); const current = deferred(); window.api.getWith = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
  const view = render(<ProgrammeResult attemptId="attempt-a" />); await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(1));
  const signal = (window.api.getWith as ReturnType<typeof vi.fn>).mock.calls[0][2].signal;
  auth.user = { id: 'account-b' }; view.rerender(<ProgrammeResult attemptId="attempt-b" />);
  await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(2));
  await act(async () => { current.resolve(resultPayload('CURRENT')); }); await screen.findByText('CURRENT_TITLE');
  await act(async () => { old.resolve(resultPayload('OLD')); });
  expect(signal.aborted).toBe(true); expect(screen.queryByText(/OLD_/)).toBeNull(); expect(document.querySelector('audio')?.getAttribute('src')).toBe('/CURRENT.mp3');
});

it.each(['allowed', 'once', undefined, 'unknown'])('source null-window result exposes whole-day native controls only for policy %s', async (policy) => {
  window.api.getWith = vi.fn(async () => ({ ...resultPayload('SOURCE', true, null), replay_policy: policy }));
  render(<ProgrammeResult attemptId="source-attempt" />); await screen.findByText('SOURCE_TITLE');
  expect(document.querySelector('audio')?.controls).toBe(policy === 'allowed');
  expect(screen.queryByRole('button', { name: /Nghe đoạn liên quan/ })).toBeNull();
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});

it('preserves generic exact-clip stop and never upgrades null windows to whole-day controls', async () => {
  const payload = resultPayload('GENERIC'); payload.review.push({ ...payload.review[0], q_num: 2, prompt: 'Second clip', audio_window: { start: 6, end: 9 } });
  window.api.getWith = vi.fn(async () => payload); render(<ProgrammeResult attemptId="generic-attempt" />); await screen.findByText('GENERIC_TITLE');
  const audio = document.querySelector('audio')!; expect(audio.controls).toBe(false);
  const buttons = screen.getAllByRole('button', { name: /Nghe đoạn liên quan/ });
  fireEvent.click(buttons[0]); await act(async () => {}); expect(audio.currentTime).toBe(2);
  fireEvent.click(buttons[1]); await act(async () => {}); expect(audio.currentTime).toBe(6);
  const pause = vi.mocked(HTMLMediaElement.prototype.pause); const previous = pause.mock.calls.length;
  audio.currentTime = 4; fireEvent(audio, new Event('timeupdate')); expect(pause.mock.calls).toHaveLength(previous);
  audio.currentTime = 9; fireEvent(audio, new Event('timeupdate')); expect(pause.mock.calls).toHaveLength(previous + 1);
});


it('StrictMode callback-ref reattachment restores the actual signed audio src after teardown', async () => {
  const signedUrl = '/signed/day01.mp3?token=fixture-only';
  window.api.getWith = vi.fn(async () => ({ ...resultPayload('STRICT_SOURCE', true, null), audio_url: signedUrl }));
  const view = render(<StrictMode><ProgrammeResult attemptId="strict-source" /></StrictMode>);
  await screen.findByText('STRICT_SOURCE_TITLE');
  const audio = screen.getByLabelText('Audio của ngày') as HTMLAudioElement;
  // StrictMode really detached this node; this assertion prevents a vacuous reattachment test.
  await waitFor(() => expect(vi.mocked(HTMLMediaElement.prototype.load).mock.contexts).toContain(audio));
  expect(audio.isConnected).toBe(true); expect(audio.getAttribute('src')).toBe(signedUrl); expect(audio.controls).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
  view.unmount(); expect(audio.getAttribute('src')).toBeNull();
});

it.each([
  ['general-listening-practice', 'whole_day'],
  ['ielts-80-days-listening', 'question'],
  ['ielts-80-days-listening', undefined],
])('does not infer whole-day playback from programme %s and granularity %s', async (programmeId, granularity) => {
  window.api.getWith = vi.fn(async () => ({ ...resultPayload('NULL_WINDOW', true, null), programme_id: programmeId, audio_granularity: granularity }));
  render(<ProgrammeResult attemptId="null-window" />); await screen.findByText('NULL_WINDOW_TITLE');
  expect(document.querySelector('audio')?.controls).toBe(false);
  expect(screen.queryByRole('button', { name: /Nghe đoạn liên quan/ })).toBeNull();
});

it.each(['source', 'generic'] as const)('clears %s media while Next retains an inactive Activity and restores it on return', async (kind) => {
  window.api.getWith = vi.fn(async () => resultPayload('ACTIVITY', kind === 'source', kind === 'source' ? null : { start: 2, end: 4 }));
  const view = render(<Activity mode="visible"><ProgrammeResult attemptId="activity-attempt" /></Activity>);
  await screen.findByRole('heading', { name: 'ACTIVITY_TITLE' });
  const audio = document.querySelector('audio')!;
  const removeListener = vi.spyOn(audio, 'removeEventListener');
  if (kind === 'generic') { fireEvent.click(screen.getByRole('button', { name: /Nghe đoạn liên quan/ })); await act(async () => {}); }
  else await audio.play();
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
  vi.mocked(HTMLMediaElement.prototype.load).mockClear();
  view.rerender(<Activity mode="hidden"><ProgrammeResult attemptId="activity-attempt" /></Activity>);
  // Activity retains the DOM; effect teardown must release media even without a ref detach.
  expect(audio.isConnected).toBe(true);
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).toContain(audio);
  expect(vi.mocked(HTMLMediaElement.prototype.load).mock.contexts).toContain(audio);
  expect(audio.getAttribute('src')).toBeNull();
  if (kind === 'generic') expect(removeListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
  view.rerender(<Activity mode="visible"><ProgrammeResult attemptId="activity-attempt" /></Activity>);
  await screen.findByRole('heading', { name: 'ACTIVITY_TITLE' });
  expect(document.querySelector('audio')).toBe(audio);
  expect(audio.getAttribute('src')).toBe('/ACTIVITY.mp3');
  expect(window.api.getWith).toHaveBeenCalledTimes(2);
  expect(window.api.postWith).not.toHaveBeenCalled(); expect(window.api.patchWith).not.toHaveBeenCalled();
});

it.each(['Activity return', 'direct replacement'] as const)('late generic Result clip rejection after %s preserves the newer exact stop boundary and no stale alert', async boundary => {
  let clip = { start: 2, end: 4 };
  window.api.getWith = vi.fn(async () => {
    const payload = resultPayload('ACTIVITY_CLIP', false, clip);
    if (boundary === 'direct replacement') payload.review.push({ ...payload.review[0], q_num: 2, prompt: 'Second clip', audio_window: { start: 6, end: 9 } });
    return payload;
  });
  const oldPlay = deferred<void>(); vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => oldPlay.promise);
  const view = render(<Activity mode="visible"><ProgrammeResult attemptId="activity-clip-attempt" /></Activity>);
  await screen.findByRole('heading', { name: 'ACTIVITY_CLIP_TITLE' }); const audio = document.querySelector('audio')!;
  fireEvent.click(screen.getAllByRole('button', { name: /Nghe đoạn liên quan/ })[0]); expect(audio.currentTime).toBe(2);
  if (boundary === 'Activity return') {
    view.rerender(<Activity mode="hidden"><ProgrammeResult attemptId="activity-clip-attempt" /></Activity>);
    expect(audio.isConnected).toBe(true); expect(audio.getAttribute('src')).toBeNull();
    clip = { start: 6, end: 9 };
    view.rerender(<Activity mode="visible"><ProgrammeResult attemptId="activity-clip-attempt" /></Activity>); await screen.findByRole('heading', { name: 'ACTIVITY_CLIP_TITLE' });
  }
  expect(document.querySelector('audio')).toBe(audio);
  fireEvent.click(screen.getAllByRole('button', { name: /Nghe đoạn liên quan/ })[boundary === 'direct replacement' ? 1 : 0]); await act(async () => {}); expect(audio.currentTime).toBe(6);
  const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio).length;
  await act(async () => { oldPlay.reject(new Error('old result clip unavailable')); });
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/Không phát được đoạn nghe/)).toBeNull(); expect(audio.getAttribute('src')).toBe('/ACTIVITY_CLIP.mp3');
  audio.currentTime = 4; fireEvent(audio, new Event('timeupdate'));
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio)).toHaveLength(pauses);
  audio.currentTime = 9; fireEvent(audio, new Event('timeupdate'));
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio)).toHaveLength(pauses + 1);
});
