import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningDictationSession } from '@/app/(authed-listening-dictation)/listening/dictation/session/listening-dictation-session';
import gold from '../fixtures/dictation-versioned.json';

const route = vi.hoisted(() => ({ params: new URLSearchParams('test_id=test-1&section=1') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => route.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: '00000000-0000-0000-0000-000000000456' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const sessionId = '00000000-0000-4000-8000-000000000123';
const storedTestId = '00000000-0000-4000-8000-000000000789';
const requestId = '550e8400-e29b-41d4-a716-446655440000';
const rawReference = '\uFEFF  “Frozen—reference”  💡  ';
const v2Grade = gold[0].grade;
// The old whitespace grader counts the standalone dash as a missing token.
const v1Grade = { grading_version: 'legacy-whitespace-v1', reference_sha256: null,
  reference: '— Hello there.', user_text: 'Hello there.', score: .6667, is_correct: false,
  correct_words: 2, total_words: 3,
  diff: [{ op: 'miss', expected: '—' }, { op: 'match', expected: 'Hello', actual: 'Hello' },
    { op: 'match', expected: 'there.', actual: 'there.' }] };
type Call = { method: 'GET' | 'POST'; path: string; body?: any };
const calls: Call[] = [];
let capabilities: any;
let freshResponse: any;
let active: any;
let gradeReply: any;
let stored: any;
let flagFailure: Error | null;

function attemptFor(grade: any) {
  return { attempt_id: 'attempt-1', test_id: 'test-1', section_num: 1, status: 'in_progress',
    renderer_affinity: 'next', started_at: '2026-10-01T00:00:00Z',
    units: [{ text: grade.reference }], answers: [],
    grading_version: grade.grading_version, reference_sha256: grade.reference_sha256 };
}

function completionFor(grade: any, submission: any) {
  return { session_id: sessionId, attempt_id: 'attempt-1', client_request_id: submission.client_request_id,
    grading_version: grade.grading_version, reference_sha256: grade.reference_sha256,
    section_num: 1, total_sentences: 1, correct_count: grade.is_correct ? 1 : 0,
    accuracy: grade.score, total_words: grade.total_words, correct_words: grade.correct_words,
    results: [{ ...grade, sentence_idx: 0,
      ...(grade.grading_version === 'lexical-v2' ? { grading_evidence: grade } : {}),
      listen_count: submission.sentences[0].listen_count, time_seconds: submission.sentences[0].time_seconds }],
    error_trends: { op_counts: { miss: grade.grading_version === 'legacy-whitespace-v1' ? 1 : 0, wrong: 0, extra: 0 } } };
}

function history() {
  // Old owned reports may omit totals and preserve sparse original indices.
  return { id: sessionId, session_id: sessionId, test_id: storedTestId,
    test_id_external: 'display-code-is-not-a-canonical-FK', test_title: 'Frozen owned report', section_num: 3,
    grading_version: 'legacy-whitespace-v1', reference_sha256: null,
    total_sentences: null, correct_count: null, total_words: null, correct_words: null, accuracy: null,
    results: [
      { sentence_idx: 4, reference: rawReference, user_text: 'frozen answer', score: null, total_words: null, correct_words: null },
      { sentence_idx: 1, reference: 'Another original sentence.', user_text: 'another answer', score: null, total_words: null, correct_words: null },
    ] };
}

beforeEach(() => {
  localStorage.clear(); calls.length = 0; active = null; stored = null; flagFailure = null;
  capabilities = { new_start_versions: ['legacy-whitespace-v1', 'lexical-v2'], readable_versions: ['legacy-whitespace-v1', 'lexical-v2'] };
  freshResponse = { ...attemptFor(v2Grade), created: true };
  gradeReply = { ...v2Grade, attempt_id: 'attempt-1', sentence_idx: 0 };
  route.params = new URLSearchParams('test_id=test-1&section=1');
  window.history.replaceState(null, '', '/listening/dictation/session?test_id=test-1&section=1');
  vi.stubGlobal('crypto', { randomUUID: () => requestId });
  Object.assign(window, { api: {
    get: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path.endsWith('/dictation/capabilities')) {
        if (capabilities instanceof Error) throw capabilities;
        return structuredClone(capabilities);
      }
      if (path.includes('/session/by-request/')) throw Object.assign(new Error('Not saved yet'), { status: 404 });
      if (path === `/api/listening/tests/dictation/session/${sessionId}`) return structuredClone(stored);
      if (path.includes('/in-progress')) return { attempt: active };
      if (path === '/api/listening/tests/test-1/dictation') return { id: 'test-1', title: 'Current source', audio_url: '/synthetic.wav',
        sections: [{ section_num: 1, title: 'Section 1', sentences: ['conflicting edited current transcript'] }] };
      throw new Error(`Unexpected synthetic GET: ${path}`);
    }),
    post: vi.fn(async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body: structuredClone(body) });
      if (path.endsWith('/renderer-affinity')) return { renderer_affinity: 'next' };
      if (path === '/api/listening/tests/dictation/flag') {
        if (flagFailure) throw flagFailure;
        return { ok: true };
      }
      throw new Error(`Unexpected synthetic POST: ${path}`);
    }),
    postWith: vi.fn(async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body: structuredClone(body) });
      if (path.endsWith('/dictation/attempts?section_num=1')) return structuredClone(freshResponse);
      if (path.endsWith('/sentences/0')) return structuredClone(gradeReply);
      if (path === '/api/listening/tests/dictation/session') {
        const grade = gradeReply.grading_version === 'lexical-v2' ? v2Grade : v1Grade;
        const canonical = completionFor(grade, body);
        stored = { ...canonical, id: sessionId, test_id: 'test-1', test_id_external: 'human-display-code' };
        return structuredClone(canonical);
      }
      throw new Error(`Unexpected synthetic POST with headers: ${path}`);
    }),
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const startCalls = () => calls.filter((call) => call.path.endsWith('/dictation/attempts?section_num=1'));
const rendererCalls = () => calls.filter((call) => call.path.endsWith('/renderer-affinity'));
const flagCalls = () => calls.filter((call) => call.path === '/api/listening/tests/dictation/flag');

async function settledAdmission() {
  await waitFor(() => expect(screen.queryByLabelText('Câu trả lời câu 1')
    || screen.queryByRole('heading', { name: 'Không mở được bài' })).toBeTruthy());
}

function rowFlag(index: number) {
  const article = screen.getByText(`Câu ${index + 1}`, { exact: true }).closest('article')!;
  return { article, button: within(article).getByRole('button', { name: '⚑ Báo lỗi' }) as HTMLButtonElement };
}

async function openHistory(value = history()) {
  stored = value;
  route.params = new URLSearchParams(`session_id=${sessionId}&test_id=conflicting-url-test&section=1`);
  const view = render(<ListeningDictationSession />);
  await screen.findByText('✓ Đã lưu & xác nhận');
  expect(calls).toEqual([{ method: 'GET', path: `/api/listening/tests/dictation/session/${sessionId}` }]);
  return view;
}

it.each([
  { name: 'missing-v2', value: undefined, legacy: false },
  { name: 'missing-legacy', value: undefined, legacy: true },
  { name: 'null', value: null, legacy: false },
  { name: 'string-false', value: 'false', legacy: true },
  { name: 'number-zero', value: 0, legacy: false },
  { name: 'object', value: {}, legacy: true },
])('advertised admission rejects $name created evidence before renderer and learner activation', async ({ value, legacy }) => {
  freshResponse = { ...attemptFor(legacy ? v1Grade : v2Grade) };
  if (value !== undefined) freshResponse.created = value;
  render(<ListeningDictationSession />); await settledAdmission();
  expect(startCalls()).toHaveLength(1);
  expect(startCalls()[0].body.grading_version).toBe('lexical-v2');
  expect(rendererCalls()).toHaveLength(0);
  expect(screen.queryByLabelText('Câu trả lời câu 1')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Không mở được bài' })).toBeTruthy();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
});

it('a genuine created:false concurrent legacy admission is retained after explicit v2 negotiation', async () => {
  freshResponse = { ...attemptFor(v1Grade), created: false };
  render(<ListeningDictationSession />); await screen.findByLabelText('Câu trả lời câu 1');
  expect(startCalls()).toHaveLength(1); expect(startCalls()[0].body.grading_version).toBe('lexical-v2');
  expect(rendererCalls()).toHaveLength(1);
  expect(screen.getByText(/Chấm cũ v1/)).toBeTruthy();
  expect(calls.some((call) => call.path.includes('/sentences/') || call.path.endsWith('/dictation/session'))).toBe(false);
});

it('capabilities 404 allows the pre-versioning legacy response with no created field', async () => {
  capabilities = Object.assign(new Error('Capabilities unavailable on N-1'), { status: 404 });
  freshResponse = attemptFor(v1Grade);
  render(<ListeningDictationSession />); await screen.findByLabelText('Câu trả lời câu 1');
  expect(startCalls()).toHaveLength(1); expect(startCalls()[0].body.grading_version).toBe('legacy-whitespace-v1');
  expect(rendererCalls()).toHaveLength(1);
  expect(screen.getByText(/Chấm cũ v1/)).toBeTruthy();
});

it('owned history flags the original sparse index using its stored FK and section despite conflicting URL/source/display ID', async () => {
  await openHistory();
  const { article, button } = rowFlag(4);
  expect(article.textContent).toContain(rawReference);
  expect(screen.queryByText('conflicting edited current transcript')).toBeNull();
  expect(button.disabled).toBe(false);
  expect(rowFlag(0).button.disabled).toBe(true);
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Báo lỗi — câu 5' });
  expect(flagCalls()).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Transcript sai' }));
  fireEvent.change(within(dialog).getByLabelText('Mô tả lỗi'), { target: { value: 'Please inspect this frozen sentence.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi báo lỗi' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(flagCalls()).toEqual([{ method: 'POST', path: '/api/listening/tests/dictation/flag', body: {
    test_id: storedTestId, section_num: 3, sentence_idx: 4, category: 'transcript_wrong', note: 'Please inspect this frozen sentence.',
  } }]);
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(article.textContent).toContain(rawReference);
  expect(within(article).getByRole('button', { name: '✓ Đã báo lỗi' })).toHaveProperty('disabled', true);
});

it.each(['test FK', 'section', 'reference'])('missing original %s makes only the report context unavailable and never guesses a flag target', async (missing) => {
  const value: any = history();
  if (missing === 'test FK') value.test_id = null;
  if (missing === 'section') value.section_num = null;
  if (missing === 'reference') value.results[0].reference = null;
  await openHistory(value);
  const { button } = rowFlag(4);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(flagCalls()).toHaveLength(0);
  expect(screen.getByText('✓ Đã lưu & xác nhận')).toBeTruthy();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

it('an owned-history flag POST failure keeps the note and frozen report; cancelling does not retry or write', async () => {
  flagFailure = Object.assign(new Error('Published source permission denied'), { status: 403 });
  await openHistory();
  const { article, button } = rowFlag(4); expect(button.disabled).toBe(false); fireEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  const note = within(dialog).getByLabelText('Mô tả lỗi') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: 'Keep this note after refusal.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi báo lỗi' }));
  await screen.findByRole('alert');
  expect(flagCalls()).toHaveLength(1); expect(note.value).toBe('Keep this note after refusal.');
  expect(article.textContent).toContain(rawReference); expect(screen.getByText('✓ Đã lưu & xác nhận')).toBeTruthy();
  expect(within(article).queryByRole('button', { name: '✓ Đã báo lỗi' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(flagCalls()).toHaveLength(1);
  fireEvent.click(rowFlag(4).button); await screen.findByRole('dialog');
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
  expect(flagCalls()).toHaveLength(1);
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
});

it.each(['legacy-whitespace-v1', 'lexical-v2'])('fresh %s completion enters owned GET history and keeps explicit one-flag reporting', async (version) => {
  const grade = version === 'lexical-v2' ? v2Grade : v1Grade;
  if (version === 'legacy-whitespace-v1') capabilities = { new_start_versions: [version], readable_versions: [version] };
  freshResponse = { ...attemptFor(grade), created: true };
  gradeReply = { ...grade, attempt_id: 'attempt-1', sentence_idx: 0 };
  const view = render(<ListeningDictationSession />);
  fireEvent.change(await screen.findByLabelText('Câu trả lời câu 1'), { target: { value: grade.user_text } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem tổng kết' }));
  await screen.findByText('✓ Đã lưu & xác nhận');
  expect(startCalls()).toHaveLength(1);
  expect(calls.filter((call) => call.path.endsWith('/sentences/0'))).toHaveLength(1);
  expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/listening/tests/dictation/session')).toHaveLength(1);
  expect(new URL(window.location.href).searchParams.get('session_id')).toBe(sessionId);
  const beforeOwnedBoot = calls.length;
  // Deliver Next's updated search params after retainReportUrl, without a fake
  // history-derived ownership assertion: the page must read the owned report.
  route.params = new URLSearchParams(window.location.search);
  view.rerender(<ListeningDictationSession />);
  await waitFor(() => expect(calls.slice(beforeOwnedBoot)).toEqual([
    { method: 'GET', path: `/api/listening/tests/dictation/session/${sessionId}` },
  ]));
  await screen.findByText('✓ Đã lưu & xác nhận');
  expect(rowFlag(0).article.textContent).toContain(grade.reference);
  expect(rowFlag(0).button.disabled).toBe(false);
  expect(flagCalls()).toHaveLength(0); fireEvent.click(rowFlag(0).button);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Audio khó nghe' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi báo lỗi' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(flagCalls()).toEqual([{ method: 'POST', path: '/api/listening/tests/dictation/flag', body: {
    test_id: 'test-1', section_num: 1, sentence_idx: 0, category: 'audio_unclear', note: null,
  } }]);
  expect(calls.slice(beforeOwnedBoot)).toHaveLength(2);
  expect(localStorage.getItem('av:dictation:v1:00000000-0000-0000-0000-000000000456:test-1:1')).toBeNull();
});
