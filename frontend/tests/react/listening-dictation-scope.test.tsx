import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningDictationSession } from '@/app/(authed-listening-dictation)/listening/dictation/session/listening-dictation-session';
import gold from '../fixtures/dictation-versioned.json';

// Keep the same component/account mounted when only the App Router query changes.
// Only the route/auth/transport seams are mocked; the page and all normalizers
// consume real offline backend grades with different frozen references for A/B.
const route = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => route.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({
  status: 'signed-in', user: { id: '00000000-0000-4000-8000-000000000456' },
}) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const TEST_A = '00000000-0000-4000-8000-000000000101';
const ATTEMPT_A = '00000000-0000-4000-8000-000000000201';
const REPORT_A = '00000000-0000-4000-8000-000000000301';
const REPORT_B = '00000000-0000-4000-8000-000000000302';
const gradeA = gold.find((row) => row.name === 'unicode')!.grade;
const gradeB = gold.find((row) => row.name === 'errors')!.grade;
const policyA = { grading_version: gradeA.grading_version, reference_sha256: gradeA.reference_sha256 };
const policyB = { grading_version: gradeB.grading_version, reference_sha256: gradeB.reference_sha256 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const storedB = {
  id: REPORT_B, session_id: REPORT_B, attempt_id: '00000000-0000-4000-8000-000000000202',
  test_id: '00000000-0000-4000-8000-000000000102', test_title: 'Frozen report B',
  section_num: 2, section_title: 'Frozen section B', ...policyB,
  total_sentences: 1, correct_count: 0, accuracy: gradeB.score,
  total_words: gradeB.total_words, correct_words: gradeB.correct_words,
  results: [{ ...gradeB, sentence_idx: 0, grading_evidence: gradeB, listen_count: 0, time_seconds: 1 }],
  error_trends: { op_counts: { miss: 1, wrong: 1, extra: 1 } },
};

const calls: Array<{ method: string; path: string; body?: any }> = [];
let heldGrade: ReturnType<typeof deferred<any>>;
let heldCompletion: ReturnType<typeof deferred<any>>;
let delayGrade: boolean;
let delayCompletion: boolean;
let completionBody: any;

function completionA(body: any) {
  return {
    session_id: REPORT_A, attempt_id: ATTEMPT_A, client_request_id: body.client_request_id,
    section_num: 1, ...policyA,
    total_sentences: 1, correct_count: 1, accuracy: gradeA.score,
    total_words: gradeA.total_words, correct_words: gradeA.correct_words,
    results: [{ ...gradeA, sentence_idx: 0, grading_evidence: gradeA,
      listen_count: body.sentences[0].listen_count, time_seconds: body.sentences[0].time_seconds }],
    error_trends: { op_counts: { miss: 0, wrong: 0, extra: 0 } },
  };
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); calls.length = 0;
  heldGrade = deferred<any>(); heldCompletion = deferred<any>();
  delayGrade = false; delayCompletion = false; completionBody = null;
  route.params = new URLSearchParams(`test_id=${TEST_A}&section=1`);
  window.history.replaceState(null, '', `/listening/dictation/session?${route.params}`);
  let uuid = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `550e8400-e29b-41d4-a716-${String(++uuid).padStart(12, '0')}` });
  Object.assign(window, { api: {
    get: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path === `/api/listening/tests/dictation/session/${REPORT_B}`) return structuredClone(storedB);
      if (path.includes('/session/by-request/')) throw Object.assign(new Error('Not found'), { status: 404 });
      if (path.includes('/attempts/in-progress')) return { attempt: {
        attempt_id: ATTEMPT_A, test_id: TEST_A, section_num: 1, status: 'in_progress',
        renderer_affinity: 'next', started_at: new Date().toISOString(),
        units: [{ text: gradeA.reference }], answers: [], ...policyA,
      } };
      if (path === `/api/listening/tests/${TEST_A}/dictation`) return {
        id: TEST_A, title: 'Live test A', audio_url: '/synthetic.wav',
        sections: [{ section_num: 1, title: 'Live section A', sentences: ['Current source is deliberately different.'] }],
      };
      throw new Error(`Unexpected GET ${path}`);
    }),
    post: vi.fn(async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body });
      if (path === `/api/listening/tests/dictation/attempts/${ATTEMPT_A}/renderer-affinity`) {
        return { attempt_id: ATTEMPT_A, renderer_affinity: 'next' };
      }
      throw new Error(`Unexpected POST ${path}`);
    }),
    postWith: vi.fn(async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body });
      if (path === `/api/listening/tests/dictation/attempts/${ATTEMPT_A}/sentences/0`) {
        return delayGrade ? heldGrade.promise : { ...gradeA, attempt_id: ATTEMPT_A, sentence_idx: 0 };
      }
      if (path === '/api/listening/tests/dictation/session') {
        completionBody = body;
        return delayCompletion ? heldCompletion.promise : completionA(body);
      }
      throw new Error(`Unexpected POST ${path}`);
    }),
  } });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function answerA() {
  fireEvent.change(await screen.findByLabelText('Câu trả lời câu 1'), { target: { value: gradeA.user_text } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra câu' }));
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith('/sentences/0'))).toHaveLength(1));
}

async function navigateToB(view: ReturnType<typeof render>) {
  route.params = new URLSearchParams(`session_id=${REPORT_B}`);
  window.history.pushState(null, '', `/listening/dictation/session?${route.params}`);
  view.rerender(<ListeningDictationSession />);
  await screen.findByText('✓ Đã lưu & xác nhận');
  await waitFor(() => expect(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(gradeB.reference));
  expect(calls.filter((call) => call.path === `/api/listening/tests/dictation/session/${REPORT_B}`)).toHaveLength(1);
  expect(calls.at(-1)).toMatchObject({ method: 'GET', path: `/api/listening/tests/dictation/session/${REPORT_B}` });
}

function assertBUnchanged(view: ReturnType<typeof render>, writesBeforeRelease: number) {
  expect.soft(new URL(window.location.href).searchParams.get('session_id')).toBe(REPORT_B);
  expect.soft(view.container.querySelector('.dict-next-hero h1')?.textContent).toContain('Frozen report B');
  expect.soft(view.container.querySelector('.dict-next-complete-head h2')?.textContent).toBe('Frozen section B');
  expect.soft(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(gradeB.reference);
  expect.soft(view.container.querySelector('[data-dictation-side="user"]')?.textContent).toBe(gradeB.user_text);
  expect.soft(view.container.querySelector('.dict-next-stats')?.textContent).toContain('33%');
  expect.soft(view.container.querySelector('.dict-next-stats')?.textContent).toContain('1/3');
  expect.soft(calls.filter((call) => call.method !== 'GET')).toHaveLength(writesBeforeRelease);
}

it('a delayed live grade A cannot replace frozen owned report B after a same-account query transition', async () => {
  delayGrade = true;
  const view = render(<ListeningDictationSession />);
  await answerA();
  expect(screen.queryByText('100% · 4/4 từ được chấm')).toBeNull();
  await navigateToB(view);
  const writes = calls.filter((call) => call.method !== 'GET').length;
  await act(async () => { heldGrade.resolve({ ...gradeA, attempt_id: ATTEMPT_A, sentence_idx: 0 }); await heldGrade.promise; });
  assertBUnchanged(view, writes);
});

it('a delayed completion ACK A cannot hijack the URL or frozen report B after a same-account query transition', async () => {
  delayCompletion = true;
  const view = render(<ListeningDictationSession />);
  await answerA(); await screen.findByText('100% · 4/4 từ được chấm');
  fireEvent.click(screen.getByRole('button', { name: 'Xem tổng kết' }));
  await waitFor(() => expect(completionBody).not.toBeNull());
  expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/listening/tests/dictation/session')).toHaveLength(1);
  await navigateToB(view);
  const writes = calls.filter((call) => call.method !== 'GET').length;
  await act(async () => { heldCompletion.resolve(completionA(completionBody)); await heldCompletion.promise; });
  assertBUnchanged(view, writes);
});
