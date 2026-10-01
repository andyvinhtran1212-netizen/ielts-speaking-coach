import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningDictationSession } from '@/app/(authed-listening-dictation)/listening/dictation/session/listening-dictation-session';
import { normalizeDictationReceipt } from '@/lib/listening-dictation-controller.mjs';
import gold from '../fixtures/dictation-versioned.json';

const scope = vi.hoisted(() => ({ params: new URLSearchParams(), userId: '00000000-0000-4000-8000-000000000456' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => scope.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: scope.userId } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const ownerA = '00000000-0000-4000-8000-000000000456';
const ownerB = '00000000-0000-4000-8000-000000000457';
const testA = '00000000-0000-4000-8000-000000000101';
const attemptA = '00000000-0000-4000-8000-000000000201';
const reportA = '00000000-0000-4000-8000-000000000301';
const reportB = '00000000-0000-4000-8000-000000000302';
const gradeA = gold.find((row) => row.name === 'unicode')!.grade;
const gradeB = gold.find((row) => row.name === 'errors')!.grade;
const policyA = { grading_version: gradeA.grading_version, reference_sha256: gradeA.reference_sha256 };
const policyB = { grading_version: gradeB.grading_version, reference_sha256: gradeB.reference_sha256 };
const receiptKeyA = `av:dictation:v1:${ownerA}:${testA}:1`;
const receiptKeyB = `av:dictation:v1:${ownerB}:test-b:2`;
const initialBReceipt = 'A separate B receipt that this route must never rewrite.';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const calls: Array<{ method: string; path: string; body?: any; account: string }> = [];
let heldRead: ReturnType<typeof deferred<void>>;
let heldPost: ReturnType<typeof deferred<void>>;
let heldRecovery: ReturnType<typeof deferred<void>>;
let delay: 'receipt404' | 'receipt200' | 'completion200' | 'mismatch409' | 'recoveryRead';
let completionBody: any;
let liveAttemptReads: number;

function canonicalAttempt(recovered = false) {
  return { attempt_id: attemptA, test_id: testA, section_num: 1, status: 'in_progress', renderer_affinity: 'next',
    started_at: '2026-10-01T00:00:00Z', units: [{ text: gradeA.reference }], ...policyA,
    answers: recovered ? [{ ...gradeA, sentence_idx: 0, user_transcript: gradeA.user_text, grading_evidence: gradeA,
      listen_count: 5, time_seconds: 8 }] : [] };
}

function completion(body: any) {
  return { session_id: reportA, attempt_id: attemptA, client_request_id: body.client_request_id, section_num: 1, ...policyA,
    total_sentences: 1, correct_count: 1, accuracy: gradeA.score, total_words: gradeA.total_words, correct_words: gradeA.correct_words,
    results: [{ ...gradeA, sentence_idx: 0, grading_evidence: gradeA,
      listen_count: body.sentences[0].listen_count, time_seconds: body.sentences[0].time_seconds }] };
}

const storedB = { id: reportB, session_id: reportB, attempt_id: '00000000-0000-4000-8000-000000000202',
  test_id: '00000000-0000-4000-8000-000000000102', test_title: 'Frozen B', section_num: 2, section_title: 'Frozen section B', ...policyB,
  total_sentences: 1, correct_count: 0, accuracy: gradeB.score, total_words: gradeB.total_words, correct_words: gradeB.correct_words,
  results: [{ ...gradeB, sentence_idx: 0, grading_evidence: gradeB, listen_count: 0, time_seconds: 1 }] };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); calls.length = 0; completionBody = null; liveAttemptReads = 0;
  delay = 'receipt404'; heldRead = deferred<void>(); heldPost = deferred<void>(); heldRecovery = deferred<void>();
  scope.userId = ownerA; scope.params = new URLSearchParams(`test_id=${testA}&section=1`);
  window.history.replaceState(null, '', `/listening/dictation/session?${scope.params}`);
  vi.stubGlobal('crypto', { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' });
  localStorage.setItem(receiptKeyB, initialBReceipt);
  Object.assign(window, { api: {
    get: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path, account: scope.userId });
      if (path === `/api/listening/tests/dictation/session/${reportB}`) return structuredClone(storedB);
      if (path.includes('/session/by-request/')) {
        if (delay === 'receipt200') {
          const original = JSON.parse(localStorage.getItem(receiptKeyA)!);
          await heldRead.promise;
          return completion(original.submission);
        }
        if (delay === 'receipt404') await heldRead.promise;
        throw Object.assign(new Error('Not yet saved'), { status: 404 });
      }
      if (path.includes('/attempts/in-progress')) {
        liveAttemptReads += 1;
        if (liveAttemptReads > 1 && delay === 'recoveryRead') await heldRecovery.promise;
        return { attempt: canonicalAttempt(liveAttemptReads > 1) };
      }
      if (path === `/api/listening/tests/${testA}/dictation`) return { id: testA, title: 'Live A', audio_url: '/synthetic.wav',
        sections: [{ section_num: 1, title: 'Section A', sentences: ['Current text is not the frozen source.'] }] };
      throw new Error(`Unexpected GET ${path}`);
    }),
    post: vi.fn(async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body: structuredClone(body), account: scope.userId });
      if (path.endsWith('/renderer-affinity')) return { renderer_affinity: 'next' };
      throw new Error(`Unexpected POST ${path}`);
    }),
    postWith: vi.fn(async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body: structuredClone(body), account: scope.userId });
      if (path.endsWith('/sentences/0')) return { ...gradeA, attempt_id: attemptA, sentence_idx: 0 };
      if (path === '/api/listening/tests/dictation/session') {
        completionBody = body;
        const postCount = calls.filter((call) => call.path === path && call.method === 'POST').length;
        if (delay === 'completion200') await heldPost.promise;
        if (postCount === 1 && (delay === 'mismatch409' || delay === 'recoveryRead')) {
          if (delay === 'mismatch409') await heldPost.promise;
          throw Object.assign(new Error('Tiến độ canonical không khớp payload hoàn tất.'), { status: 409 });
        }
        return completion(body);
      }
      throw new Error(`Unexpected POST ${path}`);
    }),
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function beginCompletion() {
  const view = render(<ListeningDictationSession />);
  fireEvent.change(await screen.findByLabelText('Câu trả lời câu 1'), { target: { value: gradeA.user_text } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem tổng kết' }));
  await waitFor(() => expect(calls.some((call) => call.path.includes('/session/by-request/'))).toBe(true));
  expect(localStorage.getItem(receiptKeyA)).not.toBeNull();
  return view;
}

async function navigateToB(view: ReturnType<typeof render>, switchAccount = false) {
  if (switchAccount) scope.userId = ownerB;
  scope.params = new URLSearchParams(`session_id=${reportB}`);
  window.history.pushState(null, '', `/listening/dictation/session?${scope.params}`);
  view.rerender(<ListeningDictationSession />);
  await screen.findByText('✓ Đã lưu & xác nhận');
  await waitFor(() => expect(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(gradeB.reference));
  expect(calls.at(-1)?.path).toBe(`/api/listening/tests/dictation/session/${reportB}`);
}

function assertNoNewDispatchOrBMutation(view: ReturnType<typeof render>, priorCalls: number, originalAReceipt: string | null) {
  expect.soft(calls.slice(priorCalls)).toEqual([]);
  expect.soft(new URL(window.location.href).searchParams.get('session_id')).toBe(reportB);
  expect.soft(view.container.querySelector('.dict-next-hero h1')?.textContent).toContain('Frozen B');
  expect.soft(view.container.querySelector('.dict-next-complete-head h2')?.textContent).toBe('Frozen section B');
  expect.soft(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(gradeB.reference);
  expect.soft(view.container.querySelector('[data-dictation-side="user"]')?.textContent).toBe(gradeB.user_text);
  expect.soft(view.container.querySelector('.dict-next-stats')?.textContent).toContain('33%');
  expect.soft(localStorage.getItem(receiptKeyB)).toBe(initialBReceipt);
  // No new completion was authorized in B. A remains pending for a later
  // deliberate return/recovery; this test does not condemn an already sent ACK.
  expect.soft(localStorage.getItem(receiptKeyA)).toBe(originalAReceipt);
}

it.each([false, true])('delayed receipt GET404 cannot dispatch A completion after owned B transition (auth switch=%s)', async (switchAccount) => {
  const view = await beginCompletion();
  expect(calls.filter((call) => call.path === '/api/listening/tests/dictation/session')).toHaveLength(0);
  const receipt = localStorage.getItem(receiptKeyA);
  await navigateToB(view, switchAccount); const priorCalls = calls.length;
  await act(async () => { heldRead.resolve(); await heldRead.promise; });
  assertNoNewDispatchOrBMutation(view, priorCalls, receipt);
});

it('delayed canonical-mismatch409 cannot initiate recovery reads or redispatch completion in owned B', async () => {
  delay = 'mismatch409'; const view = await beginCompletion();
  await waitFor(() => expect(completionBody).not.toBeNull());
  const receipt = localStorage.getItem(receiptKeyA);
  await navigateToB(view); const priorCalls = calls.length;
  await act(async () => { heldPost.resolve(); await heldPost.promise; });
  assertNoNewDispatchOrBMutation(view, priorCalls, receipt);
});

it('an already-dispatched recovery read cannot rewrite pending A or redispatch after owned B settles', async () => {
  delay = 'recoveryRead'; const view = await beginCompletion();
  await waitFor(() => expect(liveAttemptReads).toBe(2));
  const receipt = localStorage.getItem(receiptKeyA);
  await navigateToB(view); const priorCalls = calls.length;
  await act(async () => { heldRecovery.resolve(); await heldRecovery.promise; });
  assertNoNewDispatchOrBMutation(view, priorCalls, receipt);
});

it('unmount after an owned receipt read cannot initiate a new completion dispatch or erase pending recovery', async () => {
  const view = await beginCompletion();
  expect(calls.filter((call) => call.path === '/api/listening/tests/dictation/session')).toHaveLength(0);
  const receipt = localStorage.getItem(receiptKeyA);
  view.unmount(); const priorCalls = calls.length;
  await act(async () => { heldRead.resolve(); await heldRead.promise; });
  expect.soft(calls.slice(priorCalls)).toEqual([]);
  expect.soft(localStorage.getItem(receiptKeyA)).toBe(receipt);
  expect.soft(localStorage.getItem(receiptKeyB)).toBe(initialBReceipt);
  expect.soft(view.container.childElementCount).toBe(0);
});

it('StrictMode cleanup and remount still admits exactly one live fresh attempt with its frozen source', async () => {
  const existingGet = window.api.get;
  const existingPostWith = window.api.postWith;
  window.api.get = vi.fn(async (path: string) => {
    if (path.includes('/attempts/in-progress')) {
      calls.push({ method: 'GET', path, account: scope.userId });
      return { attempt: null };
    }
    if (path.endsWith('/dictation/capabilities')) {
      calls.push({ method: 'GET', path, account: scope.userId });
      return { new_start_versions: ['legacy-whitespace-v1', 'lexical-v2'], readable_versions: ['legacy-whitespace-v1', 'lexical-v2'] };
    }
    return existingGet(path);
  });
  window.api.postWith = vi.fn(async (path: string, body: any, headers: any) => {
    if (path.endsWith('/dictation/attempts?section_num=1')) {
      calls.push({ method: 'POST', path, body: structuredClone(body), account: scope.userId });
      return { ...canonicalAttempt(), created: true };
    }
    return existingPostWith(path, body, headers);
  });
  const view = render(<StrictMode><ListeningDictationSession /></StrictMode>);
  await screen.findByLabelText('Câu trả lời câu 1');
  const startCalls = calls.filter((call) => call.path.endsWith('/dictation/attempts?section_num=1'));
  expect(startCalls).toHaveLength(1);
  expect(startCalls[0].body.grading_version).toBe('lexical-v2');
  expect(calls.filter((call) => call.path.endsWith('/renderer-affinity'))).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: 'Không mở được bài' })).toBeNull();
  expect(view.container.querySelector('.dict-next-shell')?.textContent).toContain('Chấm từ v2');
  expect(calls.some((call) => call.path.includes('/sentences/') || call.path === '/api/listening/tests/dictation/session')).toBe(false);
  expect(localStorage.getItem(receiptKeyA)).toBeNull();
});

it('a held legacy renderer claim A cannot redirect away from owned B after its scope ended', async () => {
  const heldRenderer = deferred<void>();
  const realWindow = window;
  const replace = vi.fn();
  // jsdom's Location.replace is nonconfigurable. Override only this native
  // navigation seam, while keeping the real DOM/history/API and live href.
  const navigation = { get href() { return realWindow.location.href; }, replace };
  vi.stubGlobal('window', new Proxy(realWindow, {
    get(target, key) { return key === 'location' ? navigation : Reflect.get(target, key, target); },
  }));
  const existingGet = window.api.get;
  const existingPost = window.api.post;
  window.api.get = vi.fn(async (path: string) => {
    if (path.includes('/attempts/in-progress')) {
      calls.push({ method: 'GET', path, account: scope.userId });
      return { attempt: { ...canonicalAttempt(), grading_version: 'legacy-whitespace-v1', reference_sha256: null } };
    }
    return existingGet(path);
  });
  window.api.post = vi.fn(async (path: string, body: any) => {
    if (path.endsWith('/renderer-affinity')) {
      calls.push({ method: 'POST', path, body: structuredClone(body), account: scope.userId });
      await heldRenderer.promise;
      return { renderer_affinity: 'legacy' };
    }
    return existingPost(path, body);
  });
  const view = render(<ListeningDictationSession />);
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith('/renderer-affinity'))).toHaveLength(1));
  await navigateToB(view); const priorCalls = calls.length;
  await act(async () => { heldRenderer.resolve(); await heldRenderer.promise; });
  expect.soft(replace).not.toHaveBeenCalled();
  assertNoNewDispatchOrBMutation(view, priorCalls, null);
});

function replaceWithValidNewReceipt() {
  const newer = JSON.parse(localStorage.getItem(receiptKeyA)!);
  newer.requestId = '550e8400-e29b-41d4-a716-446655440099';
  newer.submission.client_request_id = newer.requestId;
  const normalized = normalizeDictationReceipt(newer, { accountId: ownerA, testId: testA, sectionNum: 1 });
  expect(normalized?.requestId).toBe(newer.requestId);
  const serialized = JSON.stringify(newer);
  // Existing browser storage is the only cross-tab seam: a newer valid
  // request occupies the same owner/test/section slot, not a forged grade.
  localStorage.setItem(receiptKeyA, serialized);
  return serialized;
}

it('a held valid receipt GET200 A cannot erase a newer same-slot C receipt after owned B settles', async () => {
  delay = 'receipt200'; const view = await beginCompletion();
  const newer = replaceWithValidNewReceipt();
  await navigateToB(view); const priorCalls = calls.length;
  await act(async () => { heldRead.resolve(); await heldRead.promise; });
  assertNoNewDispatchOrBMutation(view, priorCalls, newer);
});

it('a held successful completion ACK A cannot erase a newer same-slot C receipt from another owned tab', async () => {
  delay = 'completion200'; const view = await beginCompletion();
  await waitFor(() => expect(completionBody).not.toBeNull());
  expect(calls.filter((call) => call.path === '/api/listening/tests/dictation/session')).toHaveLength(1);
  const newer = replaceWithValidNewReceipt(); const priorCalls = calls.length;
  await act(async () => { heldPost.resolve(); await heldPost.promise; });
  await screen.findByText('✓ Đã lưu & xác nhận');
  expect.soft(localStorage.getItem(receiptKeyA)).toBe(newer);
  expect.soft(localStorage.getItem(receiptKeyB)).toBe(initialBReceipt);
  expect.soft(calls.slice(priorCalls)).toEqual([]);
  expect.soft(new URL(window.location.href).searchParams.get('session_id')).toBe(reportA);
  expect.soft(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(gradeA.reference);
  expect.soft(view.container.querySelector('.dict-next-stats')?.textContent).toContain('100%');
});
