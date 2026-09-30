import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningDictationSession } from '@/app/(authed-listening-dictation)/listening/dictation/session/listening-dictation-session';
import gold from '../fixtures/dictation-versioned.json';
import fillerGold from '../fixtures/dictation-filler-gold.json';
import { coreInputDigest } from '@/lib/core-operation-intent.mjs';

const route = vi.hoisted(() => ({ params: new URLSearchParams('test_id=test-1&section=1') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => route.params }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: '00000000-0000-0000-0000-000000000456' } }) }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

const g = gold[0].grade;
const policy = { grading_version: 'lexical-v2', reference_sha256: g.reference_sha256 };
const current = { attempt_id: 'attempt-1', test_id: 'test-1', section_num: 1, status: 'in_progress', renderer_affinity: 'next',
  started_at: new Date().toISOString(), units: gold[0].units, answers: [], ...policy };
const gradeReply = { ...g, attempt_id: 'attempt-1', sentence_idx: 0 };
const canonical = (requestId: string, submitted: any[] = []) => ({ session_id: '00000000-0000-4000-8000-000000000123', attempt_id: 'attempt-1', client_request_id: requestId,
  ...policy, section_num: 1, total_sentences: 1, correct_count: 1, accuracy: 1, total_words: g.total_words, correct_words: g.correct_words,
  results: [{ ...g, sentence_idx: 0, grading_evidence: g, listen_count: submitted[0]?.listen_count ?? 0, time_seconds: submitted[0]?.time_seconds ?? 0 }], error_trends: { op_counts: { miss: 0, wrong: 0, extra: 0 } } });
let active: any; let reply: any; let stored: any; let capabilities: any;
let freshResponse: any;
const calls: Array<{ method: string; path: string; body?: any }> = [];

beforeEach(() => {
  localStorage.clear(); calls.length = 0; active = structuredClone(current); reply = structuredClone(gradeReply); stored = null;
  route.params = new URLSearchParams('test_id=test-1&section=1');
  capabilities = { new_start_versions: ['legacy-whitespace-v1', 'lexical-v2'], readable_versions: ['legacy-whitespace-v1', 'lexical-v2'] };
  freshResponse = { ...current, created: true };
  vi.stubGlobal('crypto', { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' });
  Object.assign(window, { api: {
    get: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path.includes('capabilities')) return capabilities;
      if (path.includes('/dictation/session/') && !path.includes('/by-request/')) { if (stored instanceof Error) throw stored; return { ...stored, id: stored?.session_id }; }
      if (path.includes('/by-request/')) { if (stored) return stored; throw Object.assign(new Error('404'), { status: 404 }); }
      if (path.includes('/in-progress')) return { attempt: active };
      return { id: 'test-1', title: 'Synthetic', audio_url: '/synthetic.wav', sections: [{ section_num: 1, title: 'Section 1', sentences: ['edited current source'] }] };
    }),
    post: vi.fn(async () => ({ renderer_affinity: 'next' })),
    postWith: vi.fn(async (path: string, body: any) => {
      calls.push({ method: 'POST', path, body });
      if (path.endsWith('/dictation/attempts?section_num=1')) { active = freshResponse; return freshResponse; }
      if (path.includes('/sentences/')) return reply;
      stored = canonical(body.client_request_id, body.sentences); return stored;
    }),
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function answer() {
  const input = await screen.findByLabelText('Câu trả lời câu 1');
  fireEvent.change(input, { target: { value: g.user_text } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra câu' }));
}

it('resumes frozen v2 while new starts are disabled; grades/complete ACK and codepoint rendering are exact', async () => {
  capabilities.new_start_versions = ['legacy-whitespace-v1'];
  const view = render(<ListeningDictationSession />); await answer();
  await screen.findByText('100% · 4/4 từ được chấm');
  expect(calls.some((call) => call.path.includes('capabilities'))).toBe(false);
  expect(calls.find((call) => call.path.includes('/sentences/'))?.body).toMatchObject(policy);
  const raw = view.container.querySelector('[data-dictation-side="reference"]');
  expect(raw?.textContent).toBe(g.reference);
  expect(Array.from(raw?.querySelectorAll('[data-kind="unscored"]') || []).every((element) => !element.className.includes('miss') && !element.className.includes('wrong'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Xem tổng kết' })); await screen.findByText('✓ Đã lưu & xác nhận');
  expect(calls.find((call) => call.path.endsWith('/dictation/session'))?.body).toMatchObject(policy);
  expect(localStorage.getItem('av:dictation:v1:00000000-0000-0000-0000-000000000456:test-1:1')).toBeNull();
});

it.each(['F01', 'F02', 'F05', 'F06', 'unicode15-outline-u-miss', 'unicode15-bom-wrong', 'unicode15-square-mm-miss'])('canonical filler boundary %s keeps raw evidence, scored denominator and receipt across resume and owned reload', async (name) => {
  const row = fillerGold.cases.find((row) => row.name === name)!;
  const grade = row.grade;
  const frozen = { grading_version: grade.grading_version, reference_sha256: grade.reference_sha256 };
  active = { ...current, ...frozen, units: row.units,
    answers: name === 'F05' ? [{ ...grade, sentence_idx: 0, user_transcript: grade.user_text, grading_evidence: grade }] : [] };
  reply = { ...grade, attempt_id: 'attempt-1', sentence_idx: 0 };
  window.api.postWith = vi.fn(async (path: string, body: any) => {
    calls.push({ method: 'POST', path, body });
    if (path.includes('/sentences/')) return reply;
    stored = { ...canonical(body.client_request_id, body.sentences), ...frozen,
      correct_count: grade.score === 1 ? 1 : 0, accuracy: grade.score, total_words: grade.total_words, correct_words: grade.correct_words,
      results: [{ ...grade, sentence_idx: 0, grading_evidence: grade, listen_count: body.sentences[0].listen_count, time_seconds: body.sentences[0].time_seconds }] };
    return stored;
  });
  let view = render(<ListeningDictationSession />);
  if (name !== 'F05') {
    fireEvent.change(await screen.findByLabelText('Câu trả lời câu 1'), { target: { value: grade.user_text } });
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra câu' }));
  }
  await screen.findByText(`${Math.round(grade.score * 100)}% · ${grade.correct_words}/${grade.total_words} từ được chấm`);
  expect(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(grade.reference);
  const operation = grade.diff.find((op) => op.op !== 'match')!;
  if (operation.filler) {
    expect(view.container.querySelector('[data-dictation-side="reference"] .is-filler[data-kind="lexical"]')?.textContent).toBe(operation.expected);
    expect(view.container.querySelector('[data-dictation-side="reference"] .is-miss, [data-dictation-side="reference"] .is-wrong')).toBeNull();
  } else {
    expect(view.container.querySelector('[data-dictation-side="reference"] .is-filler')).toBeNull();
    expect(view.container.querySelector('[data-dictation-side="reference"] .is-miss, [data-dictation-side="reference"] .is-wrong')?.textContent).toBe(operation.expected);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Xem tổng kết' })); await screen.findByText('✓ Đã lưu & xác nhận');
  expect(calls.find((call) => call.path.endsWith('/dictation/session'))?.body).toMatchObject(frozen);
  expect(localStorage.getItem('av:dictation:v1:00000000-0000-0000-0000-000000000456:test-1:1')).toBeNull();
  view.unmount(); route.params = new URLSearchParams(`session_id=${stored.session_id}`); const before = calls.length;
  view = render(<ListeningDictationSession />); await screen.findByText('✓ Đã lưu & xác nhận');
  expect(screen.getByText(`${Math.round(grade.score * 100)}%`, { exact: true })).toBeTruthy();
  expect(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(grade.reference);
  expect(calls.slice(before)).toHaveLength(1); expect(calls[before].method).toBe('GET');
});

it.each(['version', 'hash', 'identity', 'source', 'score', 'evidence'])('rejects stale/wrong %s ACK and keeps the learner input editable', async (fault) => {
  if (fault === 'version') reply.grading_version = 'legacy-whitespace-v1';
  if (fault === 'hash') reply.reference_sha256 = 'a'.repeat(64);
  if (fault === 'identity') reply.sentence_idx = 9;
  if (fault === 'source') reply.reference = 'changed';
  if (fault === 'score') { reply.score = 0; reply.is_correct = false; }
  if (fault === 'evidence') reply.grading_evidence = { ...g, is_correct: false };
  render(<ListeningDictationSession />); await answer();
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Câu trả lời câu 1') as HTMLTextAreaElement).value).toBe(g.user_text);
  expect((screen.getByLabelText('Câu trả lời câu 1') as HTMLTextAreaElement).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: 'Xem tổng kết' })).toBeNull();
});

it('new start negotiates v2 explicitly and preserves a legacy attempt won by a concurrent start', async () => {
  active = null;
  freshResponse = { ...current, created: false, grading_version: 'legacy-whitespace-v1', reference_sha256: null };
  render(<ListeningDictationSession />); await screen.findByLabelText('Câu trả lời câu 1');
  expect(calls.find((call) => call.path.endsWith('/dictation/attempts?section_num=1'))?.body.grading_version).toBe('lexical-v2');
  expect(screen.getByText(/Chấm cũ v1/)).toBeTruthy();
});

it('legacy in-progress keeps punctuation denominator and saved score without capability negotiation', async () => {
  active = { ...current, grading_version: 'legacy-whitespace-v1', reference_sha256: null,
    units: [{ text: '— Hello there.' }], answers: [{ sentence_idx: 0, user_transcript: 'Hello there.', score: .6667,
      correct_words: 2, total_words: 3, diff: [{ op: 'miss', expected: '—' }] }] };
  render(<ListeningDictationSession />); await screen.findByText('67% · 2/3 token theo cách chấm cũ');
  expect(calls.some((call) => call.path.includes('capabilities'))).toBe(false);
  expect(screen.getByText(/Chấm cũ v1/)).toBeTruthy();
});

it.each(['policy', 'mean', 'evidence'])('wrong-%s completion keeps receipt pending; reload confirms canonical v2 without regrading', async (fault) => {
  window.api.postWith = vi.fn(async (path: string, body: any) => {
    calls.push({ method: 'POST', path, body });
    if (path.includes('/sentences/')) return reply;
    stored = fault === 'evidence' ? structuredClone(canonical(body.client_request_id, body.sentences))
      : fault === 'mean' ? { ...canonical(body.client_request_id, body.sentences), accuracy: 0 }
      : { ...canonical(body.client_request_id, body.sentences), grading_version: 'legacy-whitespace-v1', reference_sha256: null };
    if (fault === 'evidence') stored.results[0].grading_evidence.is_correct = false;
    return stored;
  });
  let view = render(<ListeningDictationSession />); await answer(); await screen.findByText('100% · 4/4 từ được chấm');
  fireEvent.click(screen.getByRole('button', { name: 'Xem tổng kết' })); await screen.findByText('Kết quả chưa được xác nhận.');
  expect((screen.getByRole('button', { name: 'Làm lại section' }) as HTMLButtonElement).disabled).toBe(true);
  const key = 'av:dictation:v1:00000000-0000-0000-0000-000000000456:test-1:1';
  const receipt = JSON.parse(localStorage.getItem(key)!); expect(receipt.submission).toMatchObject(policy);
  stored = canonical(receipt.requestId, receipt.submission.sentences); view.unmount(); view = render(<ListeningDictationSession />);
  await screen.findByText('✓ Đã lưu & xác nhận');
  await waitFor(() => expect(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(g.reference));
  expect(localStorage.getItem(key)).toBeNull();
});

it.each(['legacy', 'v2'])('reads owned stored %s reports only, with no capabilities or learner POST', async (version) => {
  const id = '00000000-0000-4000-8000-000000000123';
  route.params = new URLSearchParams(`session_id=${id}`);
  stored = { ...canonical('request-1'), session_id: id };
  if (version === 'legacy') stored = { ...stored, grading_version: 'legacy-whitespace-v1', reference_sha256: null,
    accuracy: .6667, total_words: 3, correct_words: 2, correct_count: 0,
    results: [{ sentence_idx: 0, reference: '— Hello there.', user_text: 'Hello there.', score: .6667, total_words: 3, correct_words: 2, diff: [{ op: 'miss', expected: '—' }] }] };
  render(<ListeningDictationSession />); await screen.findByText('✓ Đã lưu & xác nhận');
  expect(calls).toHaveLength(1); expect(calls[0].path).toBe(`/api/listening/tests/dictation/session/${id}`);
  expect(screen.getByText(version === 'legacy' ? '67%' : '100%', { exact: true })).toBeTruthy();
});

it('owned v2 report with erased canonical parent retains frozen evidence and remains GET-only', async () => {
  const id = '00000000-0000-4000-8000-000000000123';
  route.params = new URLSearchParams(`session_id=${id}`);
  stored = { ...canonical('request-1'), session_id: id, attempt_id: null, test_id: null };
  const view = render(<ListeningDictationSession />); await screen.findByText('✓ Đã lưu & xác nhận');
  expect(screen.getByText('100%', { exact: true })).toBeTruthy();
  expect(view.container.querySelector('[data-dictation-side="reference"]')?.textContent).toBe(g.reference);
  expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ method: 'GET', path: `/api/listening/tests/dictation/session/${id}` });
});

it('owned legacy nullable sentence values stay unavailable without current-source substitution or writes', async () => {
  const id = '00000000-0000-4000-8000-000000000123';
  route.params = new URLSearchParams(`session_id=${id}`);
  stored = { session_id: id, grading_version: 'legacy-whitespace-v1', reference_sha256: null,
    results: [{ sentence_idx: 0, reference: null, user_text: 'hello', score: null, correct_words: null, total_words: null }] };
  render(<ListeningDictationSession />); await screen.findByText('✓ Đã lưu & xác nhận');
  expect(screen.getByText('— · —/—', { exact: true })).toBeTruthy();
  expect(screen.queryByText(/0%/)).toBeNull(); expect(screen.queryByText('edited current source')).toBeNull();
  expect(screen.getByText('Nguyên văn transcript không có trong bản lưu.', { exact: false })).toBeTruthy();
  expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ method: 'GET', path: `/api/listening/tests/dictation/session/${id}` });
});

it.each(['403', '404', 'invalid', 'duplicate'])('report %s fails visibly and never falls back to a new attempt', async (fault) => {
  const id = '00000000-0000-4000-8000-000000000123';
  route.params = new URLSearchParams(`session_id=${fault === 'invalid' ? 'bad' : id}${fault === 'duplicate' ? `&session_id=${id}` : ''}`);
  stored = Object.assign(new Error(fault === '403' ? 'Phiên này thuộc người dùng khác.' : 'Không tìm thấy phiên chép chính tả.'), { status: Number(fault) });
  render(<ListeningDictationSession />); await screen.findByRole('heading', { name: 'Không mở được bài' });
  expect(calls.every((call) => call.method === 'GET' && call.path.includes('/dictation/session/'))).toBe(true);
  expect(calls).toHaveLength(['invalid', 'duplicate'].includes(fault) ? 0 : 1);
});

it('N-1 missing-both receipt restores authoritative v1 hash and original evidence without negotiating or regrading', async () => {
  const reference = '— Hello there.';
  const hash = coreInputDigest('dictation-texts-v1\n' + coreInputDigest(reference));
  const requestId = '550e8400-e29b-41d4-a716-446655440000';
  const submission = { attempt_id: 'attempt-1', test_id: 'test-1', section_num: 1,
    sentences: [{ sentence_idx: 0, user_transcript: 'Hello there.', listen_count: 2, time_seconds: 8 }] };
  localStorage.setItem('av:dictation:v1:00000000-0000-0000-0000-000000000456:test-1:1', JSON.stringify({
    requestId, submission, accountId: '00000000-0000-0000-0000-000000000456', testId: 'test-1', sectionNum: 1,
    createdAt: new Date().toISOString(), localResults: [] }));
  stored = { ...canonical(requestId), grading_version: 'legacy-whitespace-v1', reference_sha256: hash,
    accuracy: .6667, correct_count: 0, correct_words: 2, total_words: 3,
    results: [{ sentence_idx: 0, reference, user_text: 'Hello there.', score: .6667, correct_words: 2, total_words: 3,
      diff: [{ op: 'miss', expected: '—' }], listen_count: 2, time_seconds: 8, grading_version: 'legacy-whitespace-v1', reference_sha256: hash }] };
  render(<ListeningDictationSession />); await screen.findByText('✓ Đã lưu & xác nhận');
  expect(screen.getByText(reference, { exact: false })).toBeTruthy(); expect(screen.getByText('67%', { exact: true })).toBeTruthy();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
