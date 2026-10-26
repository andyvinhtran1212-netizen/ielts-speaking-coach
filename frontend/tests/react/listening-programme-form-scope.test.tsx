import { Activity, StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProgrammeFormRunner } from '@/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'account-a' } as { id: string } | null }));
const route = vi.hoisted(() => ({ params: new URLSearchParams('from=general&filter=in_progress') }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useSearchParams: () => route.params }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
function deferred<T = unknown>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const commits: Array<{ text: string; hrefs: string[]; audio: string | null }> = [];
function CommitProbe({ children }: { children: ReactNode }) {
  // Parent layout effects observe the first DOM commit before passive reset effects.
  useLayoutEffect(() => { const main = document.querySelector('main.programme-runner'); commits.push({ text: main?.textContent || '', hrefs: Array.from(main?.querySelectorAll('a') || []).map(a => a.getAttribute('href') || ''), audio: main?.querySelector('audio')?.getAttribute('src') || null }); });
  return children;
}
let source = false; let once = false; let revealed = false; let written = false;
const navigate = vi.fn(); const redirect = vi.fn();
function attemptId(test: string, user = auth.user?.id) { return `attempt-${user}-${test}`; }
function payload(test: string) {
  const question = { q_num: 1, source_item_id: `source-${test}`, prompt: `${test}_PROMPT`, response_type: written ? 'short_answer' : 'single_choice', options: written ? {} : { A: `${test}_OPTION_A`, B: `${test}_OPTION_B` } };
  return { title: `${test}_TITLE`, scoring_policy: 'report_only', programme_id: source ? 'ielts-80-days-listening' : 'general-listening-practice', source_day: source ? 4 : undefined, listening_lesson_id: `${test}_LESSON`, replay_policy: once ? 'once' : 'allowed', audio_url: `/${test}.mp3`, audio_granularity: source ? 'whole_day' : 'question', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: [question] } }] }] };
}
function item(test: string) { return { q_num: 1, source_item_id: `source-${test}`, first_answer: 'A', state: 'unscored', correct: null, expected: [], reference_answers: [], required_facts: [], optional_facts: [], self_review_rationale: `${test}_PRIVATE_FEEDBACK`, audio_window: source ? null : { start: 2, end: 4 }, explanation: { answer: `${test}_PRIVATE_REFERENCE`, why_vi: `${test}_PRIVATE_WHY`, evidence: [] } }; }
function installAPI() {
  Object.assign(window, { api: {
    postWith: vi.fn(async (url: string) => url.endsWith('/reveal') ? { items: [item('OLD')] } : url.endsWith('/playback-started') ? { accepted: true } : { attempt_id: attemptId(url.match(/tests\/([^/]+)\/attempts/)?.[1] || 'UNKNOWN'), answers: revealed ? [{ q_num: 1, user_answer: 'A' }] : [] }),
    getWith: vi.fn(async (url: string) => url.endsWith('/audio') ? { day: 4, variants: [{ variant_id: 'kokoro-v1', label_vi: 'Bản luyện nghe', url: '/NEW.mp3' }, { variant_id: 'original', label_vi: 'Bản ghi gốc', url: '/OLD.mp3' }] } : url.endsWith('/guided-state') ? { assisted: revealed, items: revealed ? [item(url.includes('-OLD/') ? 'OLD' : 'CURRENT')] : [] } : payload(url.match(/tests\/([^/?]+)/)?.[1] || 'UNKNOWN')),
    patchWith: vi.fn(async () => ({})),
  } });
}
function switchScope(view: ReturnType<typeof render>, test = 'CURRENT') { auth.user = { id: 'account-b' }; view.rerender(<ProgrammeFormRunner testId={test} />); }
async function ready(test = 'OLD') { await screen.findByRole('heading', { name: `${test}_TITLE` }); }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
beforeEach(() => {
  auth.status = 'signed-in'; auth.user = { id: 'account-a' }; route.params = new URLSearchParams('from=general&filter=in_progress');
  source = false; once = false; revealed = false; written = false; commits.length = 0; navigate.mockReset(); redirect.mockReset(); localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const actualWindow = window;
  vi.stubGlobal('window', new Proxy(actualWindow, { get(target, key) { if (key === 'location') return { assign: navigate, replace: redirect }; return Reflect.get(target, key, target); } }));
  installAPI();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('merges source supplements in order while keeping canonical writes and pre-answer clips separate', async () => {
  source = true;
  const get = window.api.getWith;
  window.api.getWith = vi.fn(async (url: string, ...args: unknown[]) => {
    const value = await get(url, ...args);
    if (url.endsWith('/audio')) return { ...value, question_clips: [{ item_id: 'source-OLD', part_id: 'p1', variant_id: 'original', duration_seconds: 8, url: '/original-question.mp3', context_kind: 'question', note_vi: 'Đoạn gốc của câu này.' }] };
    return value;
  });
  const question = { item_id: 'extra-OLD', source_display_number: '0', part_id: 'p1', block_id: 'b1', prompt: 'SUPPLEMENT_PROMPT', options: [{ id: 'A', label: 'EXTRA_OPTION' }], response_type: 'single_choice' as const, reason_vi: 'Chưa có đáp án tin cậy.' };
  const blocks = [{ block_id: 'b1', part_id: 'p1', kind: 'question', instruction: {}, item_ids: ['extra-OLD', 'source-OLD'] }];
  render(<ProgrammeFormRunner testId="OLD" supplements={[question]} sourceBlocks={blocks} manifest="m1" />); await ready();
  expect([...document.querySelectorAll('.programme-question')].map(node => node.textContent)).toEqual([expect.stringContaining('SUPPLEMENT_PROMPT'), expect.stringContaining('OLD_PROMPT')]);
  expect(document.querySelector('audio')?.getAttribute('src')).toBe('/OLD.mp3');
  const clipAudio = screen.getByLabelText('Nghe đoạn gốc của câu này') as HTMLAudioElement;
  expect(clipAudio.src).toContain('/original-question.mp3');
  fireEvent.click(screen.getByRole('button', { name: 'Lặp đoạn liên tục' })); expect(clipAudio.loop).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'A EXTRA_OPTION' })); await settle(); expect(window.api.patchWith).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: /OLD_OPTION_A/ })); await waitFor(() => expect(window.api.patchWith).toHaveBeenCalled());
  expect(vi.mocked(window.api.patchWith).mock.calls.every(call => JSON.stringify(call[1]).includes('"q_num":1'))).toBe(true);
  fireEvent.change(screen.getByLabelText('Phiên bản audio'), { target: { value: 'kokoro-v1' } }); expect(clipAudio.getAttribute('src')).toBeNull(); expect(clipAudio.loop).toBe(false);
});

it.each(['source', 'generic'].flatMap(kind => ['account', 'test', 'status'].map(boundary => [kind, boundary])))('hides %s old form and releases media in the first layout commit on %s replacement', async (kind, boundary) => {
  source = kind === 'source'; revealed = true;
  const view = render(<CommitProbe><ProgrammeFormRunner testId="OLD" /></CommitProbe>); await ready();
  expect(screen.getByText('OLD_PRIVATE_WHY')).toBeTruthy();
  const oldAudio = document.querySelector('audio')!; const remove = vi.spyOn(oldAudio, 'removeEventListener');
  if (source) await oldAudio.play(); else { fireEvent.click(screen.getByRole('button', { name: /Nghe lại đoạn này/ })); await settle(); }
  const pending = deferred(); window.api.postWith = vi.fn(() => pending.promise); commits.length = 0;
  if (boundary === 'account') auth.user = { id: 'account-b' }; if (boundary === 'status') auth.status = 'loading';
  view.rerender(<CommitProbe><ProgrammeFormRunner testId={boundary === 'test' ? 'CURRENT' : 'OLD'} /></CommitProbe>);
  expect(commits[0].text).not.toContain('OLD_'); expect(commits[0].text).not.toContain('PRIVATE_'); expect(commits[0].hrefs).toEqual([]); expect(commits[0].audio).toBeNull();
  expect(oldAudio.isConnected).toBe(false); expect(oldAudio.getAttribute('src')).toBeNull();
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).toContain(oldAudio); expect(vi.mocked(HTMLMediaElement.prototype.load).mock.contexts).toContain(oldAudio);
  if (!source) expect(remove).toHaveBeenCalledWith('timeupdate', expect.any(Function));
});

it('does not GET an old form when a delayed admission resolves after account/test replacement', async () => {
  const admission = deferred(); const ordinaryPost = window.api.postWith;
  window.api.postWith = vi.fn((url: string, ...args: unknown[]) => url.includes('/tests/OLD/') ? admission.promise : ordinaryPost(url, ...args));
  const view = render(<ProgrammeFormRunner testId="OLD" />); await waitFor(() => expect(window.api.postWith).toHaveBeenCalled());
  switchScope(view); await ready('CURRENT');
  await act(async () => { admission.resolve({ attempt_id: 'late-old-attempt', answers: [] }); }); await settle();
  expect(vi.mocked(window.api.getWith).mock.calls.map(call => call[0]).filter(url => String(url).includes('/tests/OLD') || String(url).includes('late-old-attempt'))).toEqual([]);
  expect(screen.queryByText('OLD_TITLE')).toBeNull();
});

it('never sends the queued old answer using the new account after its prior PATCH settles', async () => {
  const firstWrite = deferred(); const writes: Array<{ url: string; user: string | undefined; value: unknown }> = [];
  window.api.patchWith = vi.fn((url: string, body: unknown) => { writes.push({ url, user: auth.user?.id, value: body }); return writes.length === 1 ? firstWrite.promise : Promise.resolve({}); });
  const view = render(<ProgrammeFormRunner testId="OLD" />); await ready();
  fireEvent.click(screen.getByRole('radio', { name: /OLD_OPTION_A/ })); await waitFor(() => expect(writes.length).toBe(1));
  fireEvent.click(screen.getByRole('radio', { name: /OLD_OPTION_B/ }));
  switchScope(view); await ready('CURRENT'); await act(async () => { firstWrite.resolve({}); }); await settle();
  expect(writes.filter(write => write.url.includes('account-a-OLD'))).toHaveLength(1); expect(writes.some(write => write.url.includes('account-a-OLD') && write.user === 'account-b')).toBe(false);
  expect(screen.queryByText(/chưa lưu được/)).toBeNull();
});

it.each(['reveal', 'submit'] as const)('cancels the old flush continuation before %s POST when Auth changes', async action => {
  const write = deferred(); window.api.patchWith = vi.fn(() => write.promise);
  const view = render(<ProgrammeFormRunner testId="OLD" />); await ready(); fireEvent.click(screen.getByRole('radio', { name: /OLD_OPTION_A/ }));
  await waitFor(() => expect(window.api.patchWith).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: action === 'reveal' ? 'Đối chiếu câu này' : 'Hoàn thành và xem lại', exact: true }));
  switchScope(view); await ready('CURRENT'); await act(async () => { write.resolve({}); }); await settle();
  const oldProtected = vi.mocked(window.api.postWith).mock.calls.filter(call => String(call[0]).includes('account-a-OLD') && String(call[0]).endsWith(action === 'reveal' ? '/reveal' : '/submit'));
  expect(oldProtected).toEqual([]); expect(navigate).not.toHaveBeenCalled(); expect(screen.queryByText(/OLD_PRIVATE/)).toBeNull();
});

it('ignores a delayed old reveal response after the new form is ready', async () => {
  const reply = deferred(); const post = window.api.postWith;
  window.api.postWith = vi.fn((url: string, ...args: unknown[]) => url.endsWith('/reveal') ? reply.promise : post(url, ...args));
  const view = render(<ProgrammeFormRunner testId="OLD" />); await ready(); fireEvent.click(screen.getByRole('radio', { name: /OLD_OPTION_A/ })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu câu này', exact: true })); await waitFor(() => expect(vi.mocked(window.api.postWith).mock.calls.some(c => String(c[0]).endsWith('/reveal'))).toBe(true));
  switchScope(view); await ready('CURRENT'); await act(async () => { reply.resolve({ items: [item('OLD')] }); }); await settle();
  expect(screen.queryByText(/OLD_PRIVATE/)).toBeNull(); expect(document.querySelector('.programme-question-feedback')).toBeNull();
});

it('a delayed old submit cannot navigate or clear the current scope draft', async () => {
  const submitted = deferred(); const post = window.api.postWith;
  window.api.postWith = vi.fn((url: string, ...args: unknown[]) => url.endsWith('/submit') ? submitted.promise : post(url, ...args));
  const view = render(<ProgrammeFormRunner testId="OLD" />); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành và xem lại', exact: true }));
  await waitFor(() => expect(vi.mocked(window.api.postWith).mock.calls.some(c => String(c[0]).endsWith('/submit'))).toBe(true));
  written = true; switchScope(view); await ready('CURRENT'); fireEvent.change(screen.getByPlaceholderText('Nhập câu trả lời của bạn'), { target: { value: 'CURRENT_DRAFT_KEEP' } });
  const key = `listening-programme-draft:${attemptId('CURRENT')}`; expect(localStorage.getItem(key)).toContain('CURRENT_DRAFT_KEEP');
  await act(async () => { submitted.resolve({}); }); await settle();
  expect(navigate).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toContain('CURRENT_DRAFT_KEEP'); expect((screen.getByPlaceholderText('Nhập câu trả lời của bạn') as HTMLTextAreaElement).value).toBe('CURRENT_DRAFT_KEEP');
});

it('an old pending once-play cannot acknowledge under new Auth or change the new form', async () => {
  once = true; const play = deferred<void>(); vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => play.promise);
  const view = render(<ProgrammeFormRunner testId="OLD" />); await ready(); fireEvent.click(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(); switchScope(view); await ready('CURRENT');
  await act(async () => { play.resolve(undefined); }); await settle();
  expect(vi.mocked(window.api.postWith).mock.calls.filter(call => String(call[0]).endsWith('/playback-started'))).toEqual([]);
  expect(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Tạm dừng' })).toBeNull();
});

it.each(['accept', 'deny', 'reject'] as const)('ignores the old once acknowledgement %s after scope replacement', async outcome => {
  once = true; const ack = deferred(); const post = window.api.postWith;
  window.api.postWith = vi.fn((url: string, ...args: unknown[]) => url.endsWith('/playback-started') ? ack.promise : post(url, ...args));
  const view = render(<ProgrammeFormRunner testId="OLD" />); await ready(); fireEvent.click(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ }));
  await waitFor(() => expect(vi.mocked(window.api.postWith).mock.calls.some(call => String(call[0]).endsWith('/playback-started'))).toBe(true));
  switchScope(view); await ready('CURRENT'); const currentAudio = document.querySelector('audio')!; const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(a => a === currentAudio).length;
  await act(async () => { if (outcome === 'reject') ack.reject(new Error('OLD_PRIVATE_ACK_ERROR')); else ack.resolve({ accepted: outcome === 'accept' }); }); await settle();
  expect(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ })).toBeTruthy(); expect(screen.queryByText(/cửa sổ hoặc thiết bị khác|chưa xác nhận được/)).toBeNull();
  expect(currentAudio.getAttribute('src')).toBe('/CURRENT.mp3'); expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(a => a === currentAudio)).toHaveLength(pauses);
});

it.each(['source', 'generic', 'once'] as const)('releases %s media in hidden Activity and restores usable source on return', async kind => {
  source = kind === 'source'; once = kind === 'once'; revealed = true;
  const view = render(<Activity mode="visible"><ProgrammeFormRunner testId="OLD" /></Activity>); await ready();
  const audio = document.querySelector('audio')!; const remove = vi.spyOn(audio, 'removeEventListener');
  if (kind === 'source') await audio.play(); else if (kind === 'generic') { fireEvent.click(screen.getByRole('button', { name: /Nghe lại đoạn này/ })); await settle(); }
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear(); vi.mocked(HTMLMediaElement.prototype.load).mockClear();
  view.rerender(<Activity mode="hidden"><ProgrammeFormRunner testId="OLD" /></Activity>);
  expect(audio.isConnected).toBe(true); expect(audio.getAttribute('src')).toBeNull(); expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).toContain(audio); expect(vi.mocked(HTMLMediaElement.prototype.load).mock.contexts).toContain(audio);
  if (kind === 'generic') expect(remove).toHaveBeenCalledWith('timeupdate', expect.any(Function));
  fireEvent.error(audio); fireEvent.ended(audio);
  view.rerender(<Activity mode="visible"><ProgrammeFormRunner testId="OLD" /></Activity>); await ready();
  await waitFor(() => expect(document.querySelector('audio')?.getAttribute('src')).toBe('/OLD.mp3'));
  expect(screen.getByText('OLD_PRIVATE_WHY')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
  if (once) expect(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ }).hasAttribute('disabled')).toBe(false);
  expect(window.api.patchWith).not.toHaveBeenCalled(); expect(vi.mocked(window.api.postWith).mock.calls.every(call => String(call[0]) === '/api/listening/tests/OLD/attempts?standalone=true')).toBe(true);
});

it.each(['source', 'once'] as const)('StrictMode exercises cleanup and restores %s audio without losing the current claim', async kind => {
  source = kind === 'source'; once = kind === 'once'; const view = render(<StrictMode><ProgrammeFormRunner testId="OLD" /></StrictMode>); await ready();
  const audio = document.querySelector('audio')!;
  await waitFor(() => {
    expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts).toContain(audio);
    expect(vi.mocked(HTMLMediaElement.prototype.load).mock.contexts).toContain(audio);
  });
  expect(audio.getAttribute('src')).toBe('/OLD.mp3');
  if (once) { fireEvent.click(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ })); await screen.findByRole('button', { name: 'Tạm dừng' }); expect(vi.mocked(window.api.postWith).mock.calls.filter(call => String(call[0]).endsWith('/playback-started'))).toHaveLength(1); fireEvent.ended(audio); const ended = await screen.findByRole('button', { name: 'Đã sử dụng lượt nghe' }); expect(ended.hasAttribute('disabled')).toBe(true); }
  view.unmount(); expect(audio.getAttribute('src')).toBeNull();
});

it('query-only library context preserves the same admission, answers and media without new network/write', async () => {
  const view = render(<ProgrammeFormRunner testId="OLD" />); await ready(); fireEvent.click(screen.getByRole('radio', { name: /OLD_OPTION_A/ })); await waitFor(() => expect(window.api.patchWith).toHaveBeenCalled());
  const audio = document.querySelector('audio'); const calls = [vi.mocked(window.api.postWith).mock.calls.length, vi.mocked(window.api.getWith).mock.calls.length, vi.mocked(window.api.patchWith).mock.calls.length];
  route.params = new URLSearchParams('from=general&filter=completed'); view.rerender(<ProgrammeFormRunner testId="OLD" />); await settle();
  expect(screen.getByRole('link', { name: /Bài học/ }).getAttribute('href')).toBe('/listening/general/OLD_LESSON?from=general&filter=completed'); expect((screen.getByRole('radio', { name: /OLD_OPTION_A/ }) as HTMLInputElement).checked).toBe(true); expect(document.querySelector('audio')).toBe(audio);
  expect([vi.mocked(window.api.postWith).mock.calls.length, vi.mocked(window.api.getWith).mock.calls.length, vi.mocked(window.api.patchWith).mock.calls.length]).toEqual(calls);
});

it.each(['accept', 'deny', 'reject'] as const)('a late once acknowledgement %s cannot pause the SAME returned Activity node during newer accepted playback', async outcome => {
  once = true;
  const oldAck = deferred(); const post = window.api.postWith; let claims = 0;
  window.api.postWith = vi.fn((url: string, ...args: unknown[]) => url.endsWith('/playback-started') && claims++ === 0 ? oldAck.promise : post(url, ...args));
  const view = render(<Activity mode="visible"><ProgrammeFormRunner testId="OLD" /></Activity>); await ready();
  const audio = document.querySelector('audio')!;
  fireEvent.click(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ }));
  await waitFor(() => expect(vi.mocked(window.api.postWith).mock.calls.filter(call => String(call[0]).endsWith('/playback-started'))).toHaveLength(1));
  view.rerender(<Activity mode="hidden"><ProgrammeFormRunner testId="OLD" /></Activity>);
  expect(audio.isConnected).toBe(true); expect(audio.getAttribute('src')).toBeNull();
  view.rerender(<Activity mode="visible"><ProgrammeFormRunner testId="OLD" /></Activity>); await ready();
  expect(document.querySelector('audio')).toBe(audio); expect(audio.getAttribute('src')).toBe('/OLD.mp3');
  fireEvent.click(screen.getByRole('button', { name: /Bắt đầu lượt nghe duy nhất/ })); await screen.findByRole('button', { name: 'Tạm dừng' });
  const calls = vi.mocked(window.api.postWith).mock.calls.filter(call => String(call[0]).endsWith('/playback-started'));
  expect(calls).toHaveLength(2); expect(calls[0][1]).not.toEqual(calls[1][1]);
  const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio).length;
  await act(async () => { if (outcome === 'reject') oldAck.reject(new Error('old acknowledgement unavailable')); else oldAck.resolve({ accepted: outcome === 'accept' }); }); await settle();
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio)).toHaveLength(pauses);
  expect(screen.getByRole('button', { name: 'Tạm dừng' })).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(/cửa sổ hoặc thiết bị khác|chưa xác nhận được/)).toBeNull(); expect(audio.getAttribute('src')).toBe('/OLD.mp3');
  expect(vi.mocked(window.api.postWith).mock.calls.filter(call => String(call[0]).endsWith('/playback-started'))).toHaveLength(2);
});

it.each(['Activity return', 'direct replacement'] as const)('late generic Form clip rejection after %s preserves the newer exact stop boundary and no stale alert', async boundary => {
  revealed = true;
  const oldPlay = deferred<void>(); vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => oldPlay.promise);
  const originalGet = window.api.getWith;
  const newItem = { ...item('OLD'), q_num: 2, source_item_id: 'source-SECOND', audio_window: { start: 6, end: 9 } };
  window.api.getWith = vi.fn(async (url: string, ...args: unknown[]) => {
    if (boundary === 'direct replacement') {
      if (url.endsWith('/guided-state')) return { assisted: true, items: [item('OLD'), newItem] };
      const data = payload('OLD'); data.sections[0].exercises[0].payload.questions.push({ ...data.sections[0].exercises[0].payload.questions[0], q_num: 2, source_item_id: 'source-SECOND', prompt: 'SECOND_PROMPT' }); return data;
    }
    return originalGet(url, ...args);
  });
  const view = render(<Activity mode="visible"><ProgrammeFormRunner testId="OLD" /></Activity>); await ready();
  const audio = document.querySelector('audio')!;
  fireEvent.click(screen.getAllByRole('button', { name: /Nghe lại đoạn này/ })[0]); expect(audio.currentTime).toBe(2);
  if (boundary === 'Activity return') {
    view.rerender(<Activity mode="hidden"><ProgrammeFormRunner testId="OLD" /></Activity>);
    expect(audio.isConnected).toBe(true); expect(audio.getAttribute('src')).toBeNull();
    window.api.getWith = vi.fn(async (url: string) => url.endsWith('/guided-state') ? { assisted: true, items: [{ ...item('OLD'), audio_window: { start: 6, end: 9 } }] } : payload('OLD'));
    view.rerender(<Activity mode="visible"><ProgrammeFormRunner testId="OLD" /></Activity>); await ready();
  }
  expect(document.querySelector('audio')).toBe(audio);
  fireEvent.click(screen.getAllByRole('button', { name: /Nghe lại đoạn này/ })[boundary === 'direct replacement' ? 1 : 0]); await settle(); expect(audio.currentTime).toBe(6);
  const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio).length;
  await act(async () => { oldPlay.reject(new Error('old clip unavailable')); }); await settle();
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/Không phát được đoạn nghe/)).toBeNull(); expect(audio.getAttribute('src')).toBe('/OLD.mp3');
  audio.currentTime = 4; fireEvent(audio, new Event('timeupdate'));
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio)).toHaveLength(pauses);
  audio.currentTime = 9; fireEvent(audio, new Event('timeupdate'));
  expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.contexts.filter(node => node === audio)).toHaveLength(pauses + 1);
});
